/**
 * commitment-draft workflow.
 *
 * 触发: gate.passed 事件 — gate engine 全票过会后写 outbox, 经 iii 的
 *       /v1/events/gate-passed shim 入 q:commitment-draft 队列 (ADR 0004, 非 NATS).
 *
 * 步骤:
 *   1. fetchRefinement — 拿 raw_text + r5 (commitment_setup 选项 + open_text) + ticker
 *   2. parseR5 — 从 r5 choice_ids 解析 action (act_*) 和 duration (dur_*); 从 open_text 提 exit_condition hints
 *   3. runNarrator — 生成 Thesis (含 verbatim 校验), action 用 hint 不再自己推
 *   4. postCommitmentDraft — 写回 Go server
 *
 * 失败语义:
 *   - r5 选项缺失 → 走 fallback (act_buy / 6 months), 记日志; 不阻断签字流程
 *   - verbatim 校验失败 → 返回 ok=false, missing_quotes 记录; consumer nak 重试一次,
 *     第二次仍失败 → term, 工程 review 决定如何处理 (Phase 2 没自动 fallback)
 */

import { runNarrator } from "../agents/narrator.js";
import type { CommitmentActionT } from "../agents/narrator.js";
import { getRefinementSession, postCommitmentDraft } from "../tools/alphax-api.js";
import { config } from "../config/env.js";

const DEFAULT_POSITION_PCT = 5;
const DEFAULT_DURATION_MONTHS = 6;
const DEFAULT_ACTION: CommitmentActionT = "buy";

const ACTION_BY_ID: Record<string, CommitmentActionT> = {
  act_buy: "buy",
  act_sell: "sell",
  act_hold: "hold",
};
const DURATION_BY_ID: Record<string, number> = {
  dur_1m: 1,
  dur_3m: 3,
  dur_6m: 6,
  dur_12m: 12,
  dur_24m: 24,
  dur_36m: 36,
};

// 兼容历史 r5=open 的数据: open_text 里"x 个月"的正则 fallback.
const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:个月|月|months?|mo)/;
// 从 open_text 抠退出条件 hints (新版用户专门在 prompt 2 写退出条件, 这里更可靠).
const EXIT_LINE_RE = /(?:如果|当|跌|破|超过|低于|exit|stop)[^,;。\n]{4,}/g;

export interface CommitmentDraftInput {
  evaluation_id: string;
  refinement_id: string;
  user_id: string;
}

export interface CommitmentDraftResult {
  evaluation_id: string;
  ok: boolean;
  commitment_id?: string;
  verbatim_ok?: boolean;
  missing_quotes?: string[];
  error?: string;
}

export async function runCommitmentDraft(input: CommitmentDraftInput): Promise<CommitmentDraftResult> {
  // 1) 拉 refinement view
  let view;
  try {
    view = await getRefinementSession({
      session_id: input.refinement_id,
      user_id: input.user_id,
    });
  } catch (err) {
    return { evaluation_id: input.evaluation_id, ok: false, error: `fetch refinement: ${errMsg(err)}` };
  }

  if (view.status !== "completed") {
    return { evaluation_id: input.evaluation_id, ok: false, error: `refinement not completed (status=${view.status})` };
  }

  const r5 = (view.rounds ?? []).find((r) => r.round === 5);
  const r5Text = r5?.user_answer?.open_text ?? "";
  const r5ChoiceIds = r5?.user_answer?.choice_ids ?? [];

  // 2) parseR5 — action / duration 走规范 id, 不再用正则
  let action: CommitmentActionT = DEFAULT_ACTION;
  let durationMonths = DEFAULT_DURATION_MONTHS;
  for (const id of r5ChoiceIds) {
    const a = ACTION_BY_ID[id];
    if (a) action = a;
    const d = DURATION_BY_ID[id];
    if (d) durationMonths = d;
  }
  // 兼容历史 r5=open 数据 (没有规范 id, 只有 open_text 文本): 从文本抠 duration.
  if (!r5ChoiceIds.some((id) => DURATION_BY_ID[id])) {
    const m = r5Text.match(DURATION_RE);
    if (m && m[1]) {
      durationMonths = Math.max(1, Math.min(36, Math.round(parseFloat(m[1]))));
    }
  }
  const exitMatches = r5Text.match(EXIT_LINE_RE) ?? [];
  const exitConditionHints = exitMatches.slice(0, 4).map((s) => s.trim());

  const signalTexts = view.primary_signal_raw_text ? [view.primary_signal_raw_text] : [];
  if (signalTexts.length === 0) {
    return { evaluation_id: input.evaluation_id, ok: false, error: "no signal raw_text available for verbatim quotes" };
  }

  const roundSummaries = (view.rounds ?? []).map((r) => ({
    round: r.round,
    text: r.question_text,
    user_answer: r.user_answer.open_text ?? (r.user_answer.choice_ids ?? []).join(", "),
  }));

  // 3) runNarrator
  let narratorRes;
  try {
    narratorRes = await runNarrator({
      primary_asset: view.primary_asset ?? undefined,
      signal_raw_texts: signalTexts,
      round_summaries: roundSummaries,
      action_hint: action,
      duration_months_hint: durationMonths,
      exit_condition_hints: exitConditionHints,
      position_pct_hint: DEFAULT_POSITION_PCT,
      project_name: view.project_name,
      project_guidance: view.project_guidance,
      language: view.language,
    });
  } catch (err) {
    return { evaluation_id: input.evaluation_id, ok: false, error: `narrator: ${errMsg(err)}` };
  }

  if (!narratorRes.verbatim_ok) {
    return {
      evaluation_id: input.evaluation_id,
      ok: false,
      verbatim_ok: false,
      missing_quotes: narratorRes.missing_quotes,
      error: "verbatim check failed",
    };
  }

  // 4) postCommitmentDraft
  try {
    const res = await postCommitmentDraft({
      user_id: input.user_id,
      evaluation_id: input.evaluation_id,
      thesis: narratorRes.thesis,
      model: config.analyst.model,
    });
    return {
      evaluation_id: input.evaluation_id,
      ok: true,
      commitment_id: res.commitment_id,
      verbatim_ok: true,
    };
  } catch (err) {
    return {
      evaluation_id: input.evaluation_id,
      ok: false,
      error: `persist: ${errMsg(err)}`,
      verbatim_ok: true,
    };
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
