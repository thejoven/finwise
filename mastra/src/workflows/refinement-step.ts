/**
 * refinement-step workflow.
 *
 * 触发: NATS refinement.started 或 refinement.answered.
 *
 * 步骤:
 *   1. fetchState — 调 /v1/internal/refinement/sessions/:id 拿完整 session view
 *   2. computeRound — 根据 rounds_done 确定要出的下一轮 (rounds_done + 1)
 *   3. roundResearch — round 1-4 按本轮 lens 做定向 Exa.ai 检索 (失败不阻断),
 *                       结果同时落 signal_research 表 (供 mobile "学习卡片"读).
 *                       round 5 (commitment_setup) 不检索 — 它不是测验, 是承诺采集.
 *   4. runSocratic — 出题 + zod 校验, round_research 注入 prompt
 *   5. postRefinementQuestion — 写回 Go server, 客户端下次 poll 看到
 *
 * 端到端早退:
 *   - rounds_done = 5 → session 已完成, ack message, 不出题
 *   - rounds_done < 0 or > 5 → 不合法状态, term message (不重试)
 */

import { runSocratic, type PriorRound } from "../agents/socratic.js";
import {
  getRefinementSession,
  postRefinementQuestion,
  postResearch,
  type SessionView,
} from "../tools/alphax-api.js";
import { webSearch, type SearchResult } from "../tools/exa-search.js";
import { searchPredictionMarkets } from "../tools/polymarket.js";
import { config } from "../config/env.js";

const RESEARCH_MODEL = "exa+polymarket-v1";

export interface RefinementStepInput {
  refinement_id: string;
  user_id: string;
}

export interface RefinementStepResult {
  refinement_id: string;
  ok: boolean;
  next_round?: number;
  question_id?: string;
  research_count?: number;
  /** 'completed' 表示 session 已 5 轮全答完, 没下一题可出. 'invalid' 表示状态异常, term 不重投. */
  early?: "completed" | "invalid";
  error?: string;
}

export async function runRefinementStep(input: RefinementStepInput): Promise<RefinementStepResult> {
  // Step 1: fetchState
  let view: SessionView;
  try {
    view = await getRefinementSession({
      session_id: input.refinement_id,
      user_id: input.user_id,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `fetchState: ${errMsg(err)}`,
    };
  }

  // Step 2: computeRound + 早退
  if (view.status !== "active") {
    return {
      refinement_id: input.refinement_id,
      ok: true,
      early: "completed",
    };
  }
  const nextRound = view.rounds_done + 1;
  if (nextRound < 1 || nextRound > 5) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      early: "invalid",
      error: `invalid next_round=${nextRound} (rounds_done=${view.rounds_done})`,
    };
  }

  // 如果题目已经缓存 (Mastra 重投递, server 已收到上次的题), 直接 ack 不重出.
  if (view.pending_question && view.pending_question.round === nextRound) {
    return {
      refinement_id: input.refinement_id,
      ok: true,
      next_round: nextRound,
    };
  }

  // Step 3: build prior_rounds
  const priorRounds: PriorRound[] = view.rounds.map((r) => ({
    round: r.round,
    question_id: r.question_id,
    kind: r.question_kind,
    text: r.question_text,
    options: r.options,
    user_answer: r.user_answer,
  }));

  // Phase 2 v1 单信号: backend GET /v1/internal/refinement/sessions/:id 已经 join 出了 raw_text.
  const signalRawText = view.primary_signal_raw_text ?? "(signal raw_text not loaded)";

  // Step 4: roundResearch — round 1-4 按 lens 定向检索, round 5 跳过.
  let roundResearch: SearchResult[] = [];
  if (nextRound >= 1 && nextRound <= 4) {
    roundResearch = await researchRound({
      refinement_id: input.refinement_id,
      user_id: input.user_id,
      primary_signal_id: view.primary_signal_id,
      primary_asset: view.primary_asset,
      signal_raw_text: signalRawText,
      round: nextRound,
    }).catch((err) => {
      logWarn("round research step crashed (continuing without grounding)", {
        refinement_id: input.refinement_id,
        round: nextRound,
        err: errMsg(err),
      });
      return [] as SearchResult[];
    });
  }

  // Step 5: runSocratic (含 M11.5 训练重点注入 + round_research)
  let question;
  try {
    question = await runSocratic({
      refinement_id: input.refinement_id,
      signal_raw_texts: [signalRawText],
      primary_asset: view.primary_asset,
      round: nextRound,
      prior_rounds: priorRounds,
      training_focus_dim: view.training_focus_dim,
      training_focus_text: view.training_focus_text,
      round_research: roundResearch,
      project_name: view.project_name,
      project_guidance: view.project_guidance,
      language: view.language,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `socratic: ${errMsg(err)}`,
      research_count: roundResearch.length,
    };
  }

  // Step 6: postRefinementQuestion
  try {
    await postRefinementQuestion({
      session_id: input.refinement_id,
      user_id: input.user_id,
      round: nextRound,
      question,
      model: config.analyst.model,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `persist: ${errMsg(err)}`,
      next_round: nextRound,
      question_id: question.question_id,
      research_count: roundResearch.length,
    };
  }

  return {
    refinement_id: input.refinement_id,
    ok: true,
    next_round: nextRound,
    question_id: question.question_id,
    research_count: roundResearch.length,
  };
}

// ─────────────────────────── round research ───────────────────────────

/**
 * 每一轮的 lens-定向查询模板. base 用 primary_asset (没有时用信号原文截取片段) 拼角度词.
 * 不让 LLM 改写 query — 多一次 token 调用而且容易产生幻觉术语.
 *
 * 每个角度词都是中文常用搜索词, Exa 自动改写 + neural 检索能命中.
 *
 * round 5 不在这里 — commitment_setup 不需要 grounding.
 */
const ROUND_QUERY_ANGLE: Record<number, string> = {
  1: "上游 供应链 enabling 原因",                       // L1 根因 + L6 护城河
  2: "监管 法律 政策 心理 博弈 历史",                   // L2 多元栅格 + L7 10x
  3: "影响 二阶 后续 受益方 行业链",                    // L3 二阶 + L4 反身性
  4: "市场共识 分析师 预期 narrative 反共识",           // L4 反身性 + L5 base rate + L10 叙事
};

interface RoundResearchInput {
  refinement_id: string;
  user_id: string;
  primary_signal_id: string;
  primary_asset?: string;
  signal_raw_text: string;
  round: number;
}

async function researchRound(in_: RoundResearchInput): Promise<SearchResult[]> {
  const angle = ROUND_QUERY_ANGLE[in_.round];
  if (!angle) return [];
  const base = (in_.primary_asset ?? extractTopicHint(in_.signal_raw_text)).trim();
  if (!base) return [];
  const query = `${base} ${angle}`;

  // Exa 定向新闻 (lens query) + Polymarket 市场概率 (按信号主题, 跨轮稳定) 并发.
  // 两者都是增强材料, 各自失败静默. market 排前, 与 Analyst/Socratic 的 slice 优先级一致.
  const [webResults, marketResults] = await Promise.all([
    webSearch(query, { count: 8, freshness: "month", type: "auto" }),
    searchPredictionMarkets(in_.signal_raw_text).catch(() => [] as SearchResult[]),
  ]);
  const results = [...marketResults, ...webResults];
  if (results.length === 0) return results;

  try {
    await postResearch({
      user_id: in_.user_id,
      scope: "refinement_round",
      signal_id: in_.primary_signal_id,
      refinement_id: in_.refinement_id,
      round: in_.round,
      query,
      results,
      model: RESEARCH_MODEL,
    });
  } catch (err) {
    logWarn("postResearch failed (refinement_round scope)", {
      refinement_id: in_.refinement_id,
      round: in_.round,
      err: errMsg(err),
    });
  }

  return results;
}

/**
 * primary_asset 缺时, 从信号原文里抽一个 hint — 简单取前 30 个字符.
 * Exa 自然语言查询能力足够, 不需要 NER.
 */
function extractTopicHint(rawText: string): string {
  return (rawText ?? "").trim().slice(0, 30);
}

function logWarn(msg: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg, ...fields }));
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
