/**
 * Typed wrappers around the /v1/signals endpoints.
 * Schema-validated with zod at the boundary so bad server responses surface
 * as parse errors with a useful path, not "undefined is not a function" 3
 * components deep.
 */

import { z } from "zod";
import { api } from "./client";

export const SignalView = z.object({
  id: z.string().uuid(),
  raw_text: z.string(),
  captured_at: z.string(),
  inference_status: z.enum(["pending", "done", "failed"]),
  inference_summary: z.string().nullable().optional(),
  inference_tags: z.array(z.string()).optional(),
});
export type SignalView = z.infer<typeof SignalView>;

export const SignalList = z.object({
  signals: z.array(SignalView),
  has_more: z.boolean(),
});
export type SignalList = z.infer<typeof SignalList>;

const CaptureResp = z.object({
  signal_id: z.string().uuid(),
  event_id: z.number(),
  inference_status: z.enum(["pending", "done", "failed"]),
  duplicate: z.boolean(),
});
export type CaptureResp = z.infer<typeof CaptureResp>;

export interface CaptureInput {
  client_event_id: string;
  raw_text: string;
  occurred_at?: string;
}

export async function captureSignal(input: CaptureInput): Promise<CaptureResp> {
  const json = await api.post("v1/signals", { json: input }).json();
  return CaptureResp.parse(json);
}

export interface ListInput {
  limit?: number;
  before?: string; // RFC3339
  q?: string; // 子串匹配 raw_text / inference_summary, server ILIKE
}

export async function listSignals(input: ListInput = {}): Promise<SignalList> {
  const searchParams: Record<string, string> = {};
  if (input.limit != null) searchParams.limit = String(input.limit);
  if (input.before) searchParams.before = input.before;
  if (input.q && input.q.trim().length > 0) searchParams.q = input.q.trim();
  const json = await api.get("v1/signals", { searchParams }).json();
  return SignalList.parse(json);
}

export async function getSignal(id: string): Promise<SignalView> {
  const json = await api.get(`v1/signals/${id}`).json();
  return SignalView.parse(json);
}

const ReinferResp = z.object({
  signal_id: z.string().uuid(),
  inference_status: z.enum(["pending", "done", "failed"]),
  reinfer_enqueued: z.boolean(),
});
export type ReinferResp = z.infer<typeof ReinferResp>;

/**
 * reinferSignal — 用户主动触发 server 重推这条 signal.
 * 用例: signal 卡在 pending 超过 60s (mastra LLM 概率性失败进 DLQ 了).
 * server 不开新 event 行, 只在 outbox 重发一条 signal.captured 给 NATS,
 * mastra worker 消费后重跑 analyst.
 *
 * 失败:
 *   - 404 不属于该 user
 *   - 409 inference 已 done, 没必要重跑
 */
export async function reinferSignal(id: string): Promise<ReinferResp> {
  const json = await api.post(`v1/signals/${id}/reinfer`).json();
  return ReinferResp.parse(json);
}
