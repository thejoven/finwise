/**
 * /v1/refinement/sessions/:id/research 与 /v1/signals/:id/research client.
 * 与 server/internal/module/research/handler.go DTO 对齐.
 */

import { z } from "zod";
import { api } from "./client";

export const ResearchResult = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string(),
  age: z.string().optional(),
  domain: z.string().optional(),
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
