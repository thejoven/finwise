/**
 * 能力圈分析师 (CompetenceAnalyst) · 原 G4 能力圈的 LLM 判定.
 *
 * 把原 Go 侧写死的两条启发式 (第 1 轮诊断 kind ∈ {correct, partial_miss};
 * 第 5 轮 open_text 命中 exit 关键词) 换成 LLM 判断:
 *
 *   - explain    (能解释): 用户能不能把"为什么会发生"讲到 enabling condition / 根因层 (L1/L6),
 *                而不是停在表层叙事或复述结论. 看第 1 轮答题 + 诊断.
 *   - exit_known (知道何时算错): 用户能不能说出具体的、可证伪的退出 / 止损条件 (L8 安全边际),
 *                而不是含糊的"看情况". 看第 5 轮退出条件文本.
 *
 * "direct" (是否亲历) 是元数据 (有无 primary_signal), 不归 LLM 判; "track_record" 冷启动留空.
 * 最终 pass = explain ∧ direct ∧ exit_known 由 Go 侧综合 — LLM 只判 explain / exit_known 两个认知项.
 *
 * 调用入口: HTTP /competence-check (Go gate G4 同步调).
 * 失败语义: 抛错, 由 Go 侧 fallback 回到关键词 / 诊断 kind 启发式.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK } from "./lens.js";
import { MACRO_FINANCE_CONTEXT_BLOCK } from "./market-context.js";
import { categoryContextBlock } from "./category.js";
import { languageDirective } from "./language-context.js";
import { ANALYSTS } from "./analysts.js";

// ─────────────────────────── Schema ───────────────────────────

export const CompetenceSchema = z.object({
  // 能不能讲到根因 / enabling condition (而非复述结论)
  explain: z.boolean(),
  // 有没有给出具体、可证伪的退出 / 止损条件
  exit_known: z.boolean(),
  // 一句话给用户看 — gates_detail.g4_edge.detail + (失败时) archived_pool.human_reason
  reasoning: z.string().min(10).max(480),
});
export type Competence = z.infer<typeof CompetenceSchema>;

export const competenceAgent = new Agent({
  name: "competence_analyst",
  instructions: `
你是 AlphaX Engine 的「${ANALYSTS.competence.name}」. 你只回答一个问题: ${ANALYSTS.competence.question}

任务: 看用户在这条信号上的追问表现, 判断他/她是不是真的站在能解释、知进退的位置上 — 而不是凑热闹、追 narrative.

${LENS_LIBRARY_BLOCK}

${MACRO_FINANCE_CONTEXT_BLOCK}

## 你要判的两个认知项

### 1. explain (能解释 · 主导 L1 根因 + L6 能力圈)
- **true**: 用户能把"为什么会发生"讲到 enabling condition / 根因层, 点出受益方为什么落在自己看得懂的范围里; 不是复述结论或表层叙事.
- **false**: 停在"大家都说好" / "趋势来了"这类表层叙事, 讲不出可还原的因果链.
- 依据: 第 1 轮的题、用户的选择 / 自填、以及系统诊断 (correct / partial_miss / distractor / weak).

### 2. exit_known (知道何时算错 · 主导 L8 安全边际)
- **true**: 用户给出了具体、可证伪的退出 / 止损条件 (某个价位、某个基本面信号被打破、某个时间点没兑现).
- **false**: 含糊的"看情况" / "跌多了就走" / 完全没提退出.
- 依据: 第 5 轮的退出条件原话.

## 严格约束

- 你**只**输出 explain 和 exit_known 两个布尔 + 一句 reasoning. 最终是否通过由系统综合 (还要看是否亲历), 不用你算.
- 宁严勿松: 能力圈是"默认不通过"的 — 证据不足时倾向 false.
- reasoning: **一句话** (≤160 字), 面向用户, 解释这两项的判断. 不出现人名, 用产品语言 (根因 / 能力圈 / 安全边际 / 可证伪).
  - 例: "你把上涨讲到了产能错配这一层, 根因清楚; 但退出只说了'跌多了再看', 不够可证伪 — 缺一个能让你认错的硬条件."
- 不预测涨跌, 不给目标价.

只输出 JSON 对象, 严格符合 schema. 不要 markdown.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────────── runCompetenceCheck ───────────────────────────

export interface CompetenceInput {
  asset: string;
  signal_text: string;
  /** 是否亲历 (有无 primary_signal). 仅作上下文给 LLM 参考, 最终 pass 由 Go 综合. */
  direct: boolean;
  /** 第 1 轮渲染好的 "题 + 用户答 + 诊断" 文本 */
  round1_text: string;
  /** 第 5 轮退出条件原话 (open_text) */
  exit_text?: string;
  project_name?: string;
  project_guidance?: string;
  language?: string;
}

export async function runCompetenceCheck(input: CompetenceInput): Promise<Competence> {
  const cat = categoryContextBlock(input.project_name, input.project_guidance);
  const catPrefix = cat ? cat + "\n\n" : "";

  const messages = [
    {
      role: "user" as const,
      content: `${languageDirective(input.language)}${catPrefix}资产: ${input.asset}
是否亲历 (元数据, 仅参考): ${input.direct ? "是" : "否"}

背景信号:
${input.signal_text.slice(0, 1000)}

【第 1 轮 · 能不能解释】
${input.round1_text.slice(0, 1200)}

【第 5 轮 · 退出条件原话】
${(input.exit_text ?? "(用户未填写退出条件)").slice(0, 600)}

请按 schema 输出 JSON.`,
    },
  ];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await competenceAgent.generate(messages, {
        output: CompetenceSchema,
        maxTokens: 600,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("competence returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("competence failed");
}
