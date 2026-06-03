/**
 * /v1/refinement/sessions/:id/research 与 /v1/signals/:id/research client.
 * 与 server/internal/module/research/handler.go DTO 对齐.
 */

import { z } from "zod";
import { api } from "./client";

export const MarketOutcome = z.object({
  label: z.string(),
  /** 市场隐含概率, 0..1. */
  probability: z.number(),
});
export type MarketOutcome = z.infer<typeof MarketOutcome>;

export const MarketData = z.object({
  outcomes: z.array(MarketOutcome),
  /** 累计成交额 (USD). */
  volumeUsd: z.number().optional(),
  /** 市场截止时间, ISO-8601. */
  endDate: z.string().optional(),
});
export type MarketData = z.infer<typeof MarketData>;

export const ResearchResult = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  age: z.string().optional(),
  domain: z.string().optional(),
  /** 线索类型. 缺省视作 "web" (向后兼容旧数据). */
  kind: z.enum(["web", "market"]).optional(),
  /** 仅 kind==="market" 时存在: 结构化市场概率, 渲染概率条用. */
  market: MarketData.optional(),
});
export type ResearchResult = z.infer<typeof ResearchResult>;

export const ResearchRecord = z.object({
  id: z.string().uuid(),
  scope: z.enum(["signal", "refinement_round"]),
  signal_id: z.string().uuid().optional(),
  refinement_id: z.string().uuid().optional(),
  round: z.number().int().min(1).max(5).optional(),
  query: z.string(),
  results: z.array(ResearchResult),
  model: z.string(),
  created_at: z.string(),
});
export type ResearchRecord = z.infer<typeof ResearchRecord>;

export const ResearchListResponse = z.object({
  items: z.array(ResearchRecord),
});
export type ResearchListResponse = z.infer<typeof ResearchListResponse>;

export async function listResearchBySession(sessionId: string): Promise<ResearchListResponse> {
  const json = await api.get(`v1/refinement/sessions/${sessionId}/research`).json();
  return ResearchListResponse.parse(json);
}

export async function listResearchBySignal(signalId: string): Promise<ResearchListResponse> {
  const json = await api.get(`v1/signals/${signalId}/research`).json();
  return ResearchListResponse.parse(json);
}
