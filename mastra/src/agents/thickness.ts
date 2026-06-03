/**
 * ThicknessJudge Agent · G1 信号厚度的 LLM 判定.
 *
 * 替换原 Go 侧的 "近 14 天 ≥3 个独立 tag-cluster" 启发式. 用 RAG 召回当前用户
 * 历史信号 + WiseFlow Pro Lens 框架综合判定:
 *
 *   - single_signal_richness: 当前这条信号本身够不够厚 (跨多少 lens / 有具体 actor / 含数字与链条)
 *   - cross_signal_breadth:   召回的历史信号是否构成"主题地图" (跨主题 / 不同 enabling chain)
 *   - 综合 score >= 60 → pass
 *
 * 这样**单条厚信号**也能过 G1 (即使近期没有其它信号), 解决了老算法"必须 3 条才能签"
 * 的过严问题. 同时保留"跨主题广度"作为加分项, 不丢原设计意图.
 *
 * 调用入口: HTTP /thickness-check (Go gate G1 同步调).
 * 失败语义: 抛错, 由 Go 侧 fallback 走 cluster 算法.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK } from "./lens.js";
import { categoryContextBlock } from "./category.js";
import { recallSimilar, type RecalledSignal } from "../memory/vector-store.js";
import { getMemory } from "../memory/agent-memory.js";

// ─────────────────────────── Schema ───────────────────────────

export const ThicknessSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  single_signal_richness: z.number().min(0).max(100),
  cross_signal_breadth: z.number().min(0).max(100),
  dimensions_covered: z.array(z.string().max(40)).max(8),
  // 一句话给用户看 — gates_detail.g1_thickness.detail + (失败时) archived_pool.human_reason
  reasoning: z.string().min(10).max(160),
});
export type Thickness = z.infer<typeof ThicknessSchema>;

export const thicknessAgent = new Agent({
  name: "thickness_judge",
  memory: getMemory(),
  instructions: `
你是 WiseFlow Engine 的 ThicknessJudge.

任务: 判定一条信号 (+ 该用户近期相关信号召回) 是否"够厚"到值得进入承诺流程.
给两个维度评分, 综合给一个 0-100 score, score>=60 算 pass.

${LENS_LIBRARY_BLOCK}

## 评分维度

### 1. single_signal_richness (0-100) — 单条信号自己的厚度

打分参考:
- 90+: 信号本身就跨 3+ 个 lens (例: 同时提到供应链 + 法律 + 博弈论), 含具体 actor / 数字 / 时序链条, 已经能看出 enabling condition
- 60-80: 跨 2 个 lens, 有具体 actor 或数字, enabling 隐约可见
- 30-50: 单 lens, 表层观察, 无具体 actor 或数字
- < 30: 一两句话, 无 actor / 无数字 / 无链条

### 2. cross_signal_breadth (0-100) — 召回的历史信号构成主题地图的广度

打分参考:
- 90+: 历史信号 ≥ 5 条且覆盖 ≥ 3 个独立 enabling chain (例: 算力 + 资本流 + 政策)
- 60-80: 历史信号 3-4 条, 覆盖 2-3 个 enabling chain
- 30-50: 历史信号 1-2 条, 主题相近
- < 30: 几乎没有历史信号, 或全是同一主题的重复观察

### 综合 score
- 单条很厚 (richness ≥ 70) → score 不低于 70 (即使 breadth 低)
- 单条一般 (richness ~ 50) + breadth 高 (≥ 60) → score 70-80
- 单条弱 + breadth 低 → score < 60, pass=false

## 输出约束

- dimensions_covered: 列出这条信号 + 相关历史构成了哪些"独立认知维度" (用产品词, 例: ["供应链涨价", "国产替代 enabling", "资本回流"]). 最多 8 条.
- reasoning: **一句话** (≤ 160 字), 给用户看, 解释为什么 pass / fail. 不出现人名 (Munger / Soros / Buffett 等), 用产品语言 (二阶 / 反身性 / 多元栅格 / 安全边际).
  - 例 (pass): "这条信号本身已跨供应链 + 工程 + 博弈三条 lens, 历史上也有 4 条相关观察支撑, 主题地图够厚."
  - 例 (fail): "这条信号只触及表层叙事, 没有 enabling condition; 近 14 天也只有 1 条相关历史, 主题地图未成形."

只输出 JSON 对象, 严格符合 schema. 不要 markdown.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────────── runThicknessJudge ───────────────────────────

export interface ThicknessInput {
  user_id: string;
  signal_id: string;
  raw_text: string;
  summary: string;
  tags: string[];
  project_id?: string;
  project_name?: string;
  project_guidance?: string;
}

export async function runThicknessJudge(input: ThicknessInput): Promise<Thickness> {
  // 1) RAG 召回相关历史信号 (top 10, 排除自己)
  let recalled: RecalledSignal[] = [];
  try {
    recalled = await recallSimilar({
      user_id: input.user_id,
      query_text: `${input.summary}\n标签: ${input.tags.join(", ")}`,
      top_k: 10,
      exclude_signal_id: input.signal_id,
      project_id: input.project_id, // 同分类优先召回 (未分类时退回跨分类)
    });
  } catch (err) {
    // 召回失败不阻断 — agent 仍可以只看单条信号判定 richness
    recalled = [];
  }

  // 2) 拼 prompt
  const userMsg = buildThicknessPrompt(input, recalled);
  const messages = [{ role: "user" as const, content: userMsg }];

  // 3) 跑 agent, 一次 retry · per-user memory by resource=user_id
  //    thread 用 signal_id — 每条信号一个 thread, 历史信号厚度判定不共用上下文
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await thicknessAgent.generate(messages, {
        output: ThicknessSchema,
        maxTokens: 600,
        temperature: 0.2,
        memory: {
          resource: input.user_id,
          thread: { id: `thickness:${input.signal_id}`, title: `厚度判定 ${input.signal_id}` },
        },
      });
      if (res?.object) {
        // 后兜底: pass 应当与 score>=60 一致
        const o = res.object;
        const expectedPass = o.score >= 60;
        if (o.pass !== expectedPass) {
          return { ...o, pass: expectedPass };
        }
        return o;
      }
      lastErr = new Error("thickness returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("thickness failed");
}

function buildThicknessPrompt(input: ThicknessInput, recalled: RecalledSignal[]): string {
  const tagsBlock = input.tags.length ? input.tags.join(", ") : "(无)";
  const historyBlock = recalled.length
    ? recalled
        .map((r, i) => `  ${i + 1}. [${r.captured_at.slice(0, 10)}] ${r.summary} (tags: ${r.tags.join(", ")})`)
        .join("\n")
    : "  (近期没有召回到相关历史信号)";
  const cat = categoryContextBlock(input.project_name, input.project_guidance);
  const catPrefix = cat ? cat + "\n\n" : "";
  return `${catPrefix}当前信号 (待评估厚度):
  signal_id: ${input.signal_id}
  原文: ${input.raw_text.slice(0, 1200)}${input.raw_text.length > 1200 ? "..." : ""}
  inference_summary: ${input.summary}
  tags: ${tagsBlock}

该用户近期相关历史信号 (RAG 召回 top ${recalled.length} 条):
${historyBlock}

请按 schema 输出 JSON. pass 与 score>=60 必须一致.
`.trim();
}
