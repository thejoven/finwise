/**
 * signal-inference workflow.
 *
 * Input: a signal.captured payload (off NATS).
 * Steps:
 *   1. research  — Exa.ai 搜 signal.raw_text, 拿到最新 3-5 条相关新闻 (失败不阻断).
 *                   把结果写到 Go server 的 signal_research 表 (供 mobile "学习卡片"读).
 *   2. analyze   — runAnalyst(raw_text, searchContext) — Exa 结果作 grounding.
 *   3. persist   — POST inference 回 Go server.
 *
 * 三步独立 try/catch:
 *   - research 失败 → log + 继续 (没有 grounding 也能跑, 只是题目质量降级).
 *   - analyze / persist 失败 → 返回 ok:false, NATS 走 maxDeliver 重试.
 */

import { runAnalyst } from "../agents/analyst.js";
import { postInference, postResearch } from "../tools/wiseflow-api.js";
import { webSearch, type SearchResult } from "../tools/exa-search.js";
import { searchPredictionMarkets } from "../tools/polymarket.js";
import type { SignalCaptured } from "../agents/schema.js";
import { config } from "../config/env.js";
import { indexSignal } from "../memory/vector-store.js";

const RESEARCH_MODEL = "exa+polymarket-v1";

export interface RunResult {
  signal_id: string;
  ok: boolean;
  summary?: string;
  research_count?: number;
  error?: string;
}

export async function runSignalInference(
  input: SignalCaptured,
): Promise<RunResult> {
  // Step 1: research (失败静默)
  const research = await researchSignal(input).catch((err) => {
    logWarn("research step crashed (continuing without grounding)", {
      signal_id: input.signal_id,
      err: errMsg(err),
    });
    return [] as SearchResult[];
  });

  // Step 2: analyze (含 grounding + 分类指引)
  let inference;
  try {
    inference = await runAnalyst(
      input.raw_text,
      research,
      { name: input.project_name, guidance: input.project_guidance },
      input.candidate_projects ?? undefined,
    );
  } catch (err) {
    return {
      signal_id: input.signal_id,
      ok: false,
      research_count: research.length,
      error: `analyst: ${errMsg(err)}`,
    };
  }

  // Step 3: persist
  try {
    await postInference({
      signal_id: input.signal_id,
      user_id: input.user_id,
      inference,
      model: config.analyst.model,
    });
  } catch (err) {
    return {
      signal_id: input.signal_id,
      ok: false,
      summary: inference.one_line_summary,
      research_count: research.length,
      error: `persist: ${errMsg(err)}`,
    };
  }

  // Step 4: index 到 vector store (RAG 用, 失败静默不阻断主流程)
  indexSignal({
    user_id: input.user_id,
    signal_id: input.signal_id,
    summary: inference.one_line_summary,
    tags: inference.tags ?? [],
    captured_at: new Date().toISOString(),
    // AI re-home 后用最终分类索引 (chosen 优先), 否则用 capture 时的; 都无则不写 metadata.
    project_id: inference.chosen_project_id ?? input.project_id ?? undefined,
  }).catch((err) => {
    logWarn("index signal to vector store failed (continuing)", {
      signal_id: input.signal_id,
      err: errMsg(err),
    });
  });

  return {
    signal_id: input.signal_id,
    ok: true,
    summary: inference.one_line_summary,
    research_count: research.length,
  };
}

/**
 * 把 signal.raw_text 当查询打 Exa.ai; 写表后返回结果给 Analyst 用.
 * type='auto' + useAutoprompt: Exa 自己决定 neural/keyword, 对自然语言信号最稳.
 * freshness='month' — signal 大多和近一两周的新闻挂钩; 拉太久远反而稀释相关性.
 */
async function researchSignal(input: SignalCaptured): Promise<SearchResult[]> {
  const query = (input.raw_text ?? "").trim();
  if (!query) return [];

  // Exa 新闻 + Polymarket 市场概率并发跑. 两者都是增强材料, 各自失败静默不阻断.
  const [webResults, marketResults] = await Promise.all([
    webSearch(query, { count: 8, freshness: "month", type: "auto" }),
    searchPredictionMarkets(input.raw_text).catch(() => [] as SearchResult[]),
  ]);
  // market 排在前面: 它是差异化价值, 且要在 Analyst prompt 的 .slice 里优先保留.
  const results = [...marketResults, ...webResults];
  if (results.length === 0) return results;

  // 合并成"一条" signal-scope 记录落库 — mobile LearningTimeline 只取首条 signal-scope,
  // Exa + Polymarket 必须同记录, 否则只显示其一. 客户端按每条 result 的 kind 区分渲染.
  try {
    await postResearch({
      user_id: input.user_id,
      scope: "signal",
      signal_id: input.signal_id,
      query,
      results,
      model: RESEARCH_MODEL,
    });
  } catch (err) {
    logWarn("postResearch failed (signal scope)", {
      signal_id: input.signal_id,
      err: errMsg(err),
    });
  }

  return results;
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
