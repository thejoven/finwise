/**
 * wiseflow-api — HTTP client for the Go server's /v1/internal/* surface.
 * Used by the workflow to write inferences back.
 *
 * 重试策略 (M2 critical fix):
 *   - 5xx / 网络错误 / 超时 → 重试, 1s/4s/16s 指数退避, 最多 3 次
 *   - 4xx → 不重试 (client error, 重试也不会变好)
 *   - 这样如果只是 Go server 临时不可达, Analyst 推演结果不会因为 NATS workflow
 *     整体 nak() 而被重跑 (省 token).
 */

import { config } from "../config/env.js";
import type { Inference } from "../agents/schema.js";
import type { Question, PriorRound } from "../agents/socratic.js";
import type { Thesis } from "../agents/narrator.js";
import type { SearchResult } from "./exa-search.js";

export class WiseFlowApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "WiseFlowApiError";
  }
}

export interface PostInferenceArgs {
  signal_id: string;
  user_id: string;
  inference: Inference;
  model: string;
}

const MAX_HTTP_ATTEMPTS = 3;
const HTTP_TIMEOUT_MS = 10_000;

export async function postInference(args: PostInferenceArgs): Promise<void> {
  const url = `${config.wiseflowApiUrl}/v1/internal/inferences`;
  const body = JSON.stringify({
    signal_id: args.signal_id,
    user_id: args.user_id,
    summary: args.inference.one_line_summary,
    tags: args.inference.tags,
    model: args.model,
    related_assets: args.inference.related_assets,
    cognitive_layer: args.inference.cognitive_layer,
    consensus_check: args.inference.consensus_check,
    // AI 判断的分类 (可空). undefined → JSON.stringify 丢弃 → 服务端视作弃权走兜底.
    project_id: args.inference.chosen_project_id ?? undefined,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt++) {
    try {
      await postOnce(url, body);
      return;
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === MAX_HTTP_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr;
}

async function postOnce(url: string, body: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalToken,
      },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WiseFlowApiError(
        `POST /v1/internal/inferences failed: ${res.status}`,
        res.status,
        text,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof WiseFlowApiError) return err.status >= 500;
  // AbortError / network error / DNS / connection refused → retry.
  return true;
}

function backoffMs(attempt: number): number {
  // 1s, 4s, 16s
  return 1000 * Math.pow(4, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────── Refinement (M5) ───────────────────────────

export interface PostRefinementQuestionArgs {
  session_id: string;
  user_id: string;
  round: number;
  question: Question;
  model: string;
}

/** 把 Socratic 出好的题目 POST 回 Go server, 让 server 缓存 + 客户端可见. */
export async function postRefinementQuestion(
  args: PostRefinementQuestionArgs,
): Promise<void> {
  const url = `${config.wiseflowApiUrl}/v1/internal/refinement/sessions/${args.session_id}/question`;
  const body = JSON.stringify({
    user_id: args.user_id,
    round: args.round,
    payload: {
      ...args.question,
      model: args.model,
    },
  });
  await retryingPost(url, body);
}

/**
 * 拉 refinement session 的完整状态 (含已答轮次 + 当前等待的题目).
 * Mastra 用这个组装 Socratic 的 prior_rounds 上下文.
 */
export interface SessionView {
  id: string;
  primary_signal_id: string;
  primary_asset?: string;
  primary_signal_raw_text?: string;
  primary_signal_summary?: string;
  /** 分类上下文 (经 signal.project_id JOIN projects). 注入 socratic/narrator/attention prompt. */
  project_name?: string;
  project_guidance?: string;
  status: "active" | "completed" | "abandoned";
  rounds_done: number;
  decision?: string;
  started_at: string;
  /** M11.5 闭环: 用户最新复盘的训练重点. 空时不注入 Socratic prompt. */
  training_focus_dim?: string;
  training_focus_text?: string;
  rounds: Array<{
    round: number;
    question_id: string;
    question_kind: PriorRound["kind"];
    question_text: string;
    options?: PriorRound["options"];
    user_answer: PriorRound["user_answer"];
    diagnosis: { kind: string; note?: string };
    answered_at: string;
  }>;
  pending_question?: { round: number; payload: unknown };
}

export async function getRefinementSession(args: {
  session_id: string;
  user_id: string;
}): Promise<SessionView> {
  const url = `${config.wiseflowApiUrl}/v1/internal/refinement/sessions/${args.session_id}?user_id=${encodeURIComponent(args.user_id)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "X-Internal-Token": config.internalToken },
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WiseFlowApiError(
        `GET refinement session failed: ${res.status}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as SessionView;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────── Commitment (M7) ───────────────────────────

export interface PostCommitmentDraftArgs {
  user_id: string;
  evaluation_id: string;
  thesis: Thesis;
  model: string;
}

export interface PostCommitmentDraftResult {
  commitment_id: string;
}

export async function postCommitmentDraft(
  args: PostCommitmentDraftArgs,
): Promise<PostCommitmentDraftResult> {
  const url = `${config.wiseflowApiUrl}/v1/internal/commitments/draft`;
  const body = JSON.stringify({
    user_id: args.user_id,
    evaluation_id: args.evaluation_id,
    thesis: args.thesis,
    model: args.model,
  });
  return retryingPostJSON(url, body);
}

async function retryingPostJSON<T>(url: string, body: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt++) {
    try {
      return await postOnceReturning<T>(url, body);
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === MAX_HTTP_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr;
}

async function postOnceReturning<T>(url: string, body: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": config.internalToken,
      },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WiseFlowApiError(
        `POST ${url} failed: ${res.status}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function retryingPost(url: string, body: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt++) {
    try {
      await postOnce(url, body);
      return;
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === MAX_HTTP_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastErr;
}

// ─────────────────────────── Research (signal_research 表) ───────────────────────────

/**
 * Mastra 把 Exa.ai 搜索结果落库, mobile 在出题前 poll 出来渲染"学习卡片".
 *
 * 两种 scope:
 *   - 'signal'           : Analyst 阶段对 signal raw_text 做的 broad search.
 *                          signal_id 必填.
 *   - 'refinement_round' : Socratic 每轮按 lens 定向 search.
 *                          refinement_id + round 必填; signal_id 也填上 (= 主信号).
 *
 * 失败策略: 检索结果是"增强材料", 不是核心路径. 我们仍然走 retryingPost (5xx/网络重试),
 *   但调用方应 catch + 静默 (整个搜索路径失败时不该让 Analyst/Socratic 跑挂).
 */
export interface PostResearchArgs {
  user_id: string;
  scope: "signal" | "refinement_round";
  signal_id?: string;
  refinement_id?: string;
  round?: number;
  query: string;
  results: SearchResult[];
  model: string;
}

export async function postResearch(args: PostResearchArgs): Promise<void> {
  const url = `${config.wiseflowApiUrl}/v1/internal/research`;
  const body = JSON.stringify({
    user_id: args.user_id,
    scope: args.scope,
    signal_id: args.signal_id,
    refinement_id: args.refinement_id,
    round: args.round,
    query: args.query,
    results: args.results,
    model: args.model,
  });
  await retryingPost(url, body);
}

// ─────────────────────────── Attention (M11-bis) ───────────────────────────

export interface PostAttentionArgs {
  refinement_id: string;
  user_id: string;
  focus_score: number;
  depth_score: number;
  breadth_score: number;
  execution_score: number;
  insight: string;
  blindspot: string;
  model: string;
}

export async function postAttention(args: PostAttentionArgs): Promise<void> {
  const url = `${config.wiseflowApiUrl}/v1/internal/attention`;
  await retryingPost(url, JSON.stringify(args));
}

// ─────────────────────────── Distillation (降噪页) ───────────────────────────

/**
 * Mastra post-refinement workflow 把降噪综述 / 收益标的信号写回. distiller 与
 * beneficiary 各调一次, 只带自己那部分字段 (省略的 server 用 COALESCE 保留已有值).
 *   - distilled_content : distiller 的降噪综述
 *   - beneficiary        : 收益标的数组. [] = 沉默 (推演完无映射); 省略 = 这次不更新
 *   - beneficiary_note   : 受益链整体框架句
 *
 * JSON.stringify 会丢掉 undefined 字段 → distiller 那次不带 beneficiary, server 端
 * 收到的 beneficiary 即缺省 (nil), COALESCE 不动它.
 */
export interface PostDistillationArgs {
  refinement_id: string;
  user_id: string;
  distilled_content?: string;
  beneficiary?: unknown[];
  beneficiary_note?: string;
  model: string;
}

export async function postDistillation(
  args: PostDistillationArgs,
): Promise<void> {
  const url = `${config.wiseflowApiUrl}/v1/internal/distillation`;
  const body = JSON.stringify({
    refinement_id: args.refinement_id,
    user_id: args.user_id,
    distilled_content: args.distilled_content,
    beneficiary: args.beneficiary,
    beneficiary_note: args.beneficiary_note,
    model: args.model,
  });
  await retryingPost(url, body);
}
