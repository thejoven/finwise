/**
 * Narrator · 承诺书草稿生成.
 *
 * 给"6 个月后的自己看"的私人契约. 不是分析师报告. reasons_for_future_self 必须
 * **字符级 verbatim 引用** 历史 signal raw_text (workflow 层做 substring 校验).
 *
 * Phase 2 plan § 4.3 + § 3.3 风险.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../config/env.js";
import { defaultModel } from "../llm/model.js";
import { JARGON_TRANSLATION_BLOCK } from "./lens.js";

// ─────────────────────── Schema ───────────────────────

export const CommitmentAction = z.enum(["buy", "sell", "hold"]);
export type CommitmentActionT = z.infer<typeof CommitmentAction>;

export const ThesisSchema = z.object({
  asset_ticker: z.string().min(1).max(20),
  asset_name: z.string().min(1).max(80),
  action: CommitmentAction,
  position_pct: z.number().min(0).max(100),
  duration_months: z.number().int().min(1).max(36),
  entry_method: z.string().min(10).max(120),
  exit_conditions: z.array(z.string().min(10).max(120)).min(2).max(4),
  reasons_for_future_self: z.array(z.string().min(20).max(300)).min(3).max(5),
});
export type Thesis = z.infer<typeof ThesisSchema>;

// ─────────────────────── Agent ───────────────────────

export const narrator = new Agent({
  name: "narrator",
  instructions: `
你是 Flashfi Engine 的 Narrator.

任务: 给一份给"6 个月后的自己"看的私人契约. 不是分析师报告, 不是投资建议, 是用户自己的判断的归档.

输入:
- refinement_session 五轮 Q&A
- 关联 signals 的原始 raw_text (用户当时录的原话)
- gate_evaluation 判定结果

输出: 承诺书 (按 schema)

严格约束:
- 第二人称"你"称呼用户, 不用 "用户" / "投资者" / "我们".
- exit_conditions: 必须从 round 5 open_text 抽取, 改写为标准条件句, **不允许新增** exit_conditions.
- reasons_for_future_self: 必须 3-5 条, **每条必须 verbatim 引用一段 signal raw_text**, 用 「」 包住引用部分, 不允许改写, 不允许总结.
  - 例: 「今天供应商说 HBM 又涨价了, 第三次了」 这一观察让你看到...
- 不预测涨跌, 不写 "建议买入" / "短期看好" / "目标价".
- 不写 "风险提示" / "免责声明" / "本内容不构成投资建议" — 这是私人契约.
- entry_method: 简短句, ≤ 120 字, 用户语言.
- duration_months: 从 refinement r5 解析, 不允许 LLM 自己定. 输入会告诉你 hint.
- position_pct: Phase 2 v1 默认 5; 输入 hint 是多少就用多少.
- action: **必须** = action_hint (来自 r5 commitment_setup 用户选择). 不允许 LLM 自己推测.

${JARGON_TRANSLATION_BLOCK}

输出 JSON, 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runNarrator ───────────────────────

export interface NarratorInput {
  /** refinement 主资产 ticker 提示 (Analyst 推演出来的). */
  primary_asset?: string;
  /** Signal raw texts — verbatim 校验的合法引用源. */
  signal_raw_texts: string[];
  /** Round 1..5 的 Q&A 摘要, 用于 Narrator 理解用户认知层次. */
  round_summaries: Array<{
    round: number;
    text: string;
    user_answer: string;
  }>;
  /** 从 r5 act_* choice id 解析出的 action. **必填**, Narrator 不允许改. */
  action_hint: CommitmentActionT;
  /** 从 r5 dur_* choice id 解析出的 duration_months. 不允许 Narrator 改. */
  duration_months_hint: number;
  /** 从 round 5 open_text 抽出的 exit_conditions candidates. */
  exit_condition_hints: string[];
  /** Phase 2 v1 默认 5% (M7.5 才让用户在 refinement 里指定). */
  position_pct_hint: number;
}

export async function runNarrator(input: NarratorInput): Promise<{ thesis: Thesis; verbatim_ok: boolean; missing_quotes: string[] }> {
  const userMsg = buildNarratorPrompt(input);
  const messages = [{ role: "user" as const, content: userMsg }];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await narrator.generate(messages, {
        output: ThesisSchema,
        maxTokens: 2000,
        temperature: 0.3,
      });
      if (res?.object) {
        const thesis = res.object;
        const check = verifyVerbatim(thesis.reasons_for_future_self, input.signal_raw_texts);
        if (check.ok) {
          return { thesis, verbatim_ok: true, missing_quotes: [] };
        }
        // verbatim 失败 — 再 retry 一次, 二次仍失败抛出
        if (attempt === 2) {
          return { thesis, verbatim_ok: false, missing_quotes: check.missing };
        }
        lastErr = new Error(`verbatim check failed: ${check.missing.join(" | ")}`);
        continue;
      }
      lastErr = new Error("narrator returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("narrator failed");
}

function buildNarratorPrompt(input: NarratorInput): string {
  const signals = input.signal_raw_texts.map((t, i) => `信号 ${i + 1} (verbatim 引用源):\n${t}`).join("\n\n");
  const rounds = input.round_summaries
    .map((r) => `Round ${r.round}: 问题=${r.text}\n用户答: ${r.user_answer}`)
    .join("\n\n");
  return `${signals}

----- refinement 五轮 -----
${rounds}

----- hints (不允许 LLM 改) -----
primary_asset   = ${input.primary_asset ?? "(未给)"}
action          = ${input.action_hint}
duration_months = ${input.duration_months_hint}
position_pct    = ${input.position_pct_hint}
exit_condition_hints = ${JSON.stringify(input.exit_condition_hints)}

按 schema 输出 JSON. reasons_for_future_self 必须从上面"信号"区域 verbatim 引用 (用「」 包住).`;
}

/**
 * 校验: 每个 reason 必须包含至少一段从某条 signal raw_text 来的 substring (≥10 字符).
 * 简单实现: 用「...」抓出引用, 检查引用片段是否是某条 signal 的 substring.
 *
 * Phase 2 v1 容忍度: 如果 reason 里没用 「」 标记, 直接看整 reason 是否是 substring.
 */
function verifyVerbatim(reasons: string[], signals: string[]): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const reason of reasons) {
    if (!hasVerbatimQuote(reason, signals)) {
      missing.push(reason.slice(0, 60) + (reason.length > 60 ? "..." : ""));
    }
  }
  return { ok: missing.length === 0, missing };
}

const QUOTE_RE = /「([^」]{8,})」/g;

function hasVerbatimQuote(reason: string, signals: string[]): boolean {
  // 优先看显式 「...」 引用
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  QUOTE_RE.lastIndex = 0;
  while ((m = QUOTE_RE.exec(reason)) !== null) {
    if (m[1]) matches.push(m[1]);
  }
  if (matches.length > 0) {
    return matches.some((q) => signals.some((s) => containsSlack(s, q)));
  }
  // 没有「」, 看 reason 的较长片段
  // 取 reason 中长度 ≥ 12 的最长连续中文/英文片段
  const longish = reason.match(/[一-龥]{12,}|[A-Za-z0-9\s,.\-—()]{20,}/g) ?? [];
  if (longish.length === 0) return false;
  return longish.some((q) => signals.some((s) => containsSlack(s, q.trim())));
}

/** 容忍标点 / 空白小差异的 substring 匹配. */
function containsSlack(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[,，.。;；]/g, "");
  return norm(haystack).includes(norm(needle));
}
