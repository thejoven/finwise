/**
 * /v1/retrospects 客户端封装.
 */

import { z } from "zod";
import { api } from "./client";

export const RetrospectDim = z.enum(["perception", "inference", "evaluation", "execution"]);
export type RetrospectDimT = z.infer<typeof RetrospectDim>;

export const RetrospectState = z.enum(["pending", "in_progress", "finalized"]);

export const AnswerEntry = z.object({
  q: z.number().int().min(1).max(4),
  dim: RetrospectDim,
  choice: z.string(),
  open_text: z.string().nullable().optional(),
});
export type AnswerEntry = z.infer<typeof AnswerEntry>;

export const Retrospect = z.object({
  id: z.string().uuid(),
  commitment_id: z.string().uuid(),
  state: RetrospectState,
  started_at: z.string(),
  finalized_at: z.string().nullable().optional(),
  answers: z.array(AnswerEntry),
  focus_dim: z.string().nullable().optional(),
  focus_text: z.string().nullable().optional(),
  diagnostician_model: z.string().nullable().optional(),
});
export type Retrospect = z.infer<typeof Retrospect>;

export const RetrospectList = z.object({
  retrospects: z.array(Retrospect),
});

// ───── Calls ─────

export async function startRetrospect(input: { commitment_id: string; trigger?: "expired" | "closed" | "manual" }): Promise<Retrospect> {
  const json = await api.post("v1/retrospects", { json: input }).json();
  return Retrospect.parse(json);
}

export async function getRetrospect(id: string): Promise<Retrospect> {
  const json = await api.get(`v1/retrospects/${id}`).json();
  return Retrospect.parse(json);
}

export async function listRetrospects(): Promise<Retrospect[]> {
  const json = await api.get("v1/retrospects").json();
  return RetrospectList.parse(json).retrospects;
}

export async function submitRetrospectAnswer(input: {
  retrospect_id: string;
  client_event_id: string;
  question_no: number;
  question_dim: RetrospectDimT;
  choice: string;
  open_text?: string;
}): Promise<Retrospect> {
  const { retrospect_id, ...body } = input;
  const json = await api.post(`v1/retrospects/${retrospect_id}/answers`, { json: body }).json();
  return Retrospect.parse(json);
}

export async function finalizeRetrospect(id: string): Promise<Retrospect> {
  const json = await api.post(`v1/retrospects/${id}/finalize`, { json: {} }).json();
  return Retrospect.parse(json);
}
