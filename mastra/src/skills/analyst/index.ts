/**
 * Analyst Skill · 目录化的 prompt + few-shot + schema 模块.
 *
 * 文件结构:
 *   instructions.md       — Agent system prompt 主体 (任务定义 + 严格约束)
 *   strict-output.md      — 反复强调输出格式约束 (避免 markdown / 前后缀)
 *   examples/*.md         — few-shot 例子, 按序号排序混合呈现给 LLM
 *   index.ts              — 这里; 装配 prompt + 跑 Agent
 *
 * 增强方式:
 *   - 想让 analyst 在新领域/新语种更稳: 加一条 examples/0N-*.md, 不动其它文件
 *   - 想改主任务定义: 改 instructions.md
 *   - 想加格式约束: 改 strict-output.md
 *
 * Runtime: mastra 走 tsx 直接跑 TS, examples/*.md 在 src/ 目录就能 readFileSync.
 *
 * 复用模式: 同套结构以后可给 socratic / consensus / thickness / editor /
 * diagnostician 各开一个 skills/<name>/, 收敛 prompt 管理方式.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@mastra/core/agent";

import { config } from "../../config/env.js";
import { defaultModel } from "../../llm/model.js";
import { InferenceSchema } from "../../agents/schema.js";
import { JARGON_TRANSLATION_BLOCK } from "../../agents/lens.js";
import { categoryContextBlock } from "../../agents/category.js";
import type { SearchResult } from "../../tools/exa-search.js";

export interface CategoryContext {
  name?: string | null;
  guidance?: string | null;
}

// ───────────────────── prompt assembly ─────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMd(rel: string): string {
  return readFileSync(join(__dirname, rel), "utf8");
}

function loadExamples(): string {
  const dir = join(__dirname, "examples");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort(); // 01-, 02-, ... 保证顺序稳定
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n\n---\n\n");
}

/** 构造 Agent 的 system instructions — module load 时一次性拼好 */
function buildInstructions(): string {
  const parts = [
    loadMd("instructions.md"),
    "---",
    "## Few-shot 参考 (按真实输入照搬风格, 但严格输出 schema 形式)",
    loadExamples(),
    "---",
    JARGON_TRANSLATION_BLOCK,
    "---",
    loadMd("strict-output.md"),
  ];
  return parts.join("\n\n").trim();
}

const INSTRUCTIONS = buildInstructions();

// ───────────────────── Agent ─────────────────────

export const analyst = new Agent({
  name: "analyst",
  instructions: INSTRUCTIONS,
  model: defaultModel,
});

// ───────────────────── runner ─────────────────────

/**
 * runAnalyst — 跑 Agent + zod 校验 + 一次 retry.
 *
 * Mastra agent.generate({ output: zodSchema }) 要么返回 { object } (schema 通过),
 * 要么抛错. 我们再加一层最多 2 次的 retry, 第二次仍失败 → 抛错让 NATS 消费者 nak,
 * 由 maxDeliver 3 兜底 → DLQ.
 *
 * searchContext 可选: 来自 Exa.ai 的实时检索. 注入 prompt 后让 Analyst
 * 用真实新闻做 grounding (避免靠预训练记忆瞎编). 空时按原行为跑.
 */
export async function runAnalyst(
  rawText: string,
  searchContext?: SearchResult[],
  category?: CategoryContext,
) {
  const userContent = buildAnalystPrompt(rawText, searchContext, category);
  const messages = [{ role: "user" as const, content: userContent }];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await analyst.generate(messages, {
        output: InferenceSchema,
        maxTokens: config.analyst.maxTokens,
        temperature: config.analyst.temperature,
      });
      if (res?.object) return res.object;
      lastErr = new Error("analyst returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("analyst failed without an error");
}

function buildAnalystPrompt(
  rawText: string,
  searchContext?: SearchResult[],
  category?: CategoryContext,
): string {
  const cat = categoryContextBlock(category?.name, category?.guidance);
  const catPrefix = cat ? cat + "\n\n" : "";
  if (!searchContext || searchContext.length === 0) return catPrefix + rawText;

  // 按线索类型分流: 网页新闻 (Exa) 做背景 grounding; 预测市场 (Polymarket) 做 consensus 参照.
  const webItems = searchContext.filter((r) => r.kind !== "market");
  const marketItems = searchContext.filter((r) => r.kind === "market" && r.market);

  const sections: string[] = ["信号原文:", rawText, ""];

  if (webItems.length > 0) {
    const block = webItems
      .slice(0, 5)
      .map((r, i) => {
        const age = r.age ? ` · ${r.age}` : "";
        const domain = r.domain ? ` [${r.domain}]` : "";
        return `[${i + 1}]${domain}${age} ${r.title}\n  ${r.description}\n  ${r.url}`;
      })
      .join("\n");
    sections.push(
      "实时检索到的相关新闻 (Exa.ai, 仅作背景 grounding, 不要直接复述也不要引用编号):",
      block,
      "",
    );
  }

  if (marketItems.length > 0) {
    const block = marketItems
      .slice(0, 5)
      .map((r, i) => {
        const outs = (r.market?.outcomes ?? [])
          .map((o) => `${o.label} ${formatPct(o.probability)}`)
          .join(" · ");
        return `[${i + 1}] ${r.title} → ${outs}`;
      })
      .join("\n");
    sections.push(
      "Polymarket 预测市场的实时隐含概率 (这是真实的「市场共识」, 据此判断 consensus_check):",
      block,
      "",
      "把上面的市场概率当作当前共识参照来定 consensus_check: 你的判断比市场更早/更激进 → leading; 与市场基本一致 → aligned; 慢于市场 → lagging. 没有相关市场时按你自己的理解判断.",
      "",
    );
  }

  sections.push(
    "用上面的真实材料校准你对信号的理解, 但严格按 schema 输出. 不要在 rationale 里出现 url / 来源名.",
  );
  return catPrefix + sections.join("\n");
}

/** 0.62 → "62%"; 极小概率折成 "<1%". 与 polymarket.ts 同语义, 这里本地一份避免工具耦合. */
function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export { InferenceSchema };
