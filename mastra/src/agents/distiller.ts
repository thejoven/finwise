/**
 * Distiller · 降噪综述.
 *
 * 用户答完五轮追问后, 把"这条信号 + 用户五轮里暴露的认知"蒸成一段"降噪后的内容".
 * 刻意 gate 在追问之后 (产品需求): 先逼用户做认知的 reps, 再给降噪综述, 避免认知惰性.
 *
 * 产品哲学:
 *   - 降噪 = 去掉噪音, 留下判断核心 (哲学 2). 不堆信息 (哲学 3).
 *   - 克制 (哲学 11): 一段话, 判断式, 不是要点列表, 不是评分.
 *   - 是把用户自己刚暴露的认知收敛成一句清醒的话, 不另起炉灶讲新东西 (接住, 不替代思考).
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { categoryContextBlock } from "./category.js";
import { languageDirective } from "./language-context.js";
import { MACRO_FINANCE_CONTEXT_BLOCK } from "./market-context.js";
import { JARGON_TRANSLATION_BLOCK } from "./lens.js";

// ─────────────────────── Schema ───────────────────────

export const DistilledSchema = z.object({
  content: z.string().min(20).max(900),
});
export type Distilled = z.infer<typeof DistilledSchema>;

// ─────────────────────── Agent ───────────────────────

export const distiller = new Agent({
  name: "distiller",
  instructions: `
你是 WiseFlow Engine 的 Distiller (降噪).

用户刚答完五轮追问. 你的任务: 把"这条信号 + 用户五轮里暴露的认知"降噪成一段清醒的判断.

什么叫降噪:
- 去掉情绪、噪音、可有可无的信息, 只留下"这条信号到底意味着什么"的核心判断.
- 判断式, 不是信息堆砌. 例: "二阶推演还是漏了供电环节", 不是 "以下是三个要点".
- 要"接住"用户在五轮里答对 / 答错 / 没想到的地方 — 降噪后的内容反映他刚才的认知,
  而不是另起炉灶讲一堆新东西.

${MACRO_FINANCE_CONTEXT_BLOCK}

怎么用上面这套基底 (关键 —— 别用错): 它是给你**精准命名**用户在五轮里已经触到 / 该触到却漏掉的那条机制用的, 让降噪那句话**落到具体机制上、不说套话** (例: 不写 "你的二阶推演还不够深", 而写 "你把链停在 SK Hynix, 没追问到 CoWoS 封装产能这层 enabling"). **但它不改变你的本职: 接住, 不替代.** 只命名用户认知里**已经出现 / 该出现却漏掉**的机制, 绝不另起炉灶, 给他补一套他根本没碰过的宏观大论述 —— 那就成了"替他思考", 违背降噪的本意.

严格约束:
- 一段话 (可 2-3 个短自然段), 不要要点列表, 不要小标题, 不要 markdown.
- 第二人称"你". 不预测涨跌, 不"建议买入/卖出", 不写目标价, 不写免责声明.
- 克制. 没把握的不硬说. 降噪的价值在"少而准", 不在"全".
- 中文, 报刊书面语, 不要口语化感叹.

${JARGON_TRANSLATION_BLOCK}

输出 JSON: { "content": "..." }. 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runner ───────────────────────

export interface DistillerRound {
  round: number;
  kind: string;
  question_text: string;
  user_answer: string;
  diagnosis_kind: string;
  diagnosis_note?: string;
}

export interface DistillerInput {
  signalSummary: string;
  signalRawText?: string;
  primaryAsset?: string;
  projectName?: string;
  projectGuidance?: string;
  /** App 选定的输出语言. 空/简体 → 默认行为不变. */
  language?: string;
  rounds: DistillerRound[];
}

export async function runDistiller(input: DistillerInput): Promise<Distilled> {
  const messages = [{ role: "user" as const, content: buildPrompt(input) }];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await distiller.generate(messages, {
        output: DistilledSchema,
        maxTokens: 1200,
        temperature: 0.3,
      });
      if (res?.object) return res.object;
      lastErr = new Error("distiller returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("distiller failed");
}

function buildPrompt(input: DistillerInput): string {
  const cat = categoryContextBlock(input.projectName, input.projectGuidance);
  const rounds = input.rounds
    .map(
      (r) =>
        `  R${r.round} ${r.kind} · ${r.diagnosis_kind}\n    问: ${r.question_text}\n    你答: ${r.user_answer}` +
        (r.diagnosis_note ? `\n    诊断: ${r.diagnosis_note}` : ""),
    )
    .join("\n");
  const lang = languageDirective(input.language).trimEnd();
  return [
    ...(lang ? [lang, ""] : []),
    ...(cat ? [cat, ""] : []),
    `信号 (本次追问基于这条):`,
    `  ${input.signalRawText ?? input.signalSummary}`,
    ...(input.primaryAsset ? [`  主资产: ${input.primaryAsset}`] : []),
    "",
    `你刚才的五轮:`,
    rounds,
    "",
    `把上面降噪成一段清醒的判断 (接住你刚暴露的认知). 按 schema 输出 { "content": "..." }.`,
  ].join("\n");
}
