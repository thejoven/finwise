/**
 * /v1/commitments/:id/open + /companion · 客户端封装.
 * 与 server/internal/module/companion/handler.go 对齐.
 */

import { z } from "zod";
import { api } from "./client";

export const CompanionReason = z.enum(["anxiety_3x", "anxiety_5x", "manual"]);
export type CompanionReasonT = z.infer<typeof CompanionReason>;

export const CompanionView = z.object({
  commitment_id: z.string().uuid(),
  reason: CompanionReason,
  editor_text: z.string(),
  editor_model: z.string(),
  shown_at: z.string(),
});
export type CompanionView = z.infer<typeof CompanionView>;

export const OpenResponse = z.object({
  opens_today: z.number().int(),
  classified: z.string(),
  should_show_companion: z.boolean(),
  companion: CompanionView.optional(),
});
export type OpenResponse = z.infer<typeof OpenResponse>;

export async function recordOpen(input: {
  commitment_id: string;
  client_event_id: string;
  origin?: "deeplink" | "tab" | "trigger_card";
  opened_at?: string;
}): Promise<OpenResponse> {
  const { commitment_id, ...body } = input;
  const json = await api.post(`v1/commitments/${commitment_id}/open`, { json: body }).json();
  return OpenResponse.parse(json);
}

export async function getCompanion(commitmentId: string): Promise<CompanionView | null> {
  const res = await api.get(`v1/commitments/${commitmentId}/companion`, { throwHttpErrors: false });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`getCompanion failed: ${res.status}`);
  return CompanionView.parse(await res.json());
}
