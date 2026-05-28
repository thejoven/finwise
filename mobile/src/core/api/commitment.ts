/**
 * /v1/commitments + /v1/holdings 的 typed 客户端封装.
 * 与 server/internal/module/commitment/handler.go 的 DTO 对齐.
 */

import { z } from "zod";
import { api } from "./client";

export const CommitmentAction = z.enum(["buy", "sell", "hold"]);
export type CommitmentActionT = z.infer<typeof CommitmentAction>;

export const Thesis = z.object({
  asset_ticker: z.string(),
  asset_name: z.string(),
  action: CommitmentAction,
  position_pct: z.number().min(0).max(100),
  duration_months: z.number().int().min(1).max(36),
  entry_method: z.string(),
  exit_conditions: z.array(z.string()).min(2).max(4),
  reasons_for_future_self: z.array(z.string()).min(3).max(5),
});
export type Thesis = z.infer<typeof Thesis>;

export const CommitmentStatus = z.enum(["drafted", "signed", "postponed", "abandoned"]);

export const Commitment = z.object({
  id: z.string().uuid(),
  evaluation_id: z.string().uuid(),
  status: CommitmentStatus,
  thesis: Thesis,
  pdf_path: z.string().nullable().optional(),
  postpone_count: z.number().int(),
  signed_at: z.string().nullable().optional(),
  drafted_at: z.string(),
});
export type Commitment = z.infer<typeof Commitment>;

export const HoldingStatus = z.enum(["active", "triggered", "expired", "closed", "archived"]);

export const Holding = z.object({
  id: z.string().uuid(),
  status: HoldingStatus,
  signed_at: z.string(),
  exit_conditions: z.array(z.string()),
  expires_at: z.string(),
  exit_check_state: z.unknown(),
  triggered_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
});
export type Holding = z.infer<typeof Holding>;

export const SignResponse = z.object({
  commitment: Commitment,
  holding: Holding.optional(),
});
export type SignResponse = z.infer<typeof SignResponse>;

// ───── Calls ─────

export async function getCommitment(id: string): Promise<Commitment> {
  const json = await api.get(`v1/commitments/${id}`).json();
  return Commitment.parse(json);
}

export async function getActiveCommitment(): Promise<Commitment | null> {
  const res = await api.get("v1/commitments/active", { throwHttpErrors: false });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`getActiveCommitment failed: ${res.status}`);
  return Commitment.parse(await res.json());
}

export async function signCommitment(input: { id: string; signing_client_id: string }): Promise<SignResponse> {
  const json = await api.post(`v1/commitments/${input.id}/sign`, {
    json: { signing_client_id: input.signing_client_id },
  }).json();
  return SignResponse.parse(json);
}

export async function postponeCommitment(input: {
  id: string;
  client_event_id: string;
  reason?: string;
}): Promise<Commitment> {
  const json = await api.post(`v1/commitments/${input.id}/postpone`, {
    json: { client_event_id: input.client_event_id, reason: input.reason },
  }).json();
  return Commitment.parse(json);
}

export async function getActiveHolding(): Promise<Holding | null> {
  const res = await api.get("v1/holdings/active", { throwHttpErrors: false });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`getActiveHolding failed: ${res.status}`);
  return Holding.parse(await res.json());
}

export async function getHolding(id: string): Promise<Holding> {
  const json = await api.get(`v1/holdings/${id}`).json();
  return Holding.parse(json);
}
