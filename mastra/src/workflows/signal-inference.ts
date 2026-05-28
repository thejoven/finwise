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
import { postInference, postResearch } from "../tools/flashfi-api.js";
import { webSearch, type SearchResult } from "../tools/exa-search.js";
import type { SignalCaptured } from "../agents/schema.js";
import { config } from "../config/env.js";
import { indexSignal } from "../memory/vector-store.js";

const SEARCH_MODEL = "exa-search-v1";

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

  // Step 2: analyze (含 grounding)
  let inference;
  try {
    inference = await runAnalyst(input.raw_text, research);
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
  const results = await webSearch(query, { count: 5, freshness: "month", type: "auto" });
  if (results.length === 0) return results;

  // 落库不阻塞主流程 — 写失败只 log
  try {
    await postResearch({
      user_id: input.user_id,
      scope: "signal",
      signal_id: input.signal_id,
      query,
      results,
      model: SEARCH_MODEL,
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
