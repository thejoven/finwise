/**
 * /v1/attention/summary 客户端封装. 与 server/internal/module/attention 对齐.
 */

import { z } from "zod";
import { api } from "./client";

export const AttentionSummaryRow = z.object({
  refinement_id: z.string().uuid(),
  focus_score: z.number().int().min(0).max(100),
  depth_score: z.number().int().min(0).max(100),
  breadth_score: z.number().int().min(0).max(100),
  execution_score: z.number().int().min(0).max(100),
  insight: z.string(),
  blindspot: z.string(),
  created_at: z.string(),
});
export type AttentionSummaryRow = z.infer<typeof AttentionSummaryRow>;

export const TagFreq = z.object({
  tag: z.string(),
  count: z.number().int().nonnegative(),
});
export type TagFreq = z.infer<typeof TagFreq>;

export const AttentionSummary = z.object({
  window: z.string(),
  total_completed: z.number().int().nonnegative(),
  average_focus_score: z.number().int().min(0).max(100),
  average_depth_score: z.number().int().min(0).max(100),
  average_breadth_score: z.number().int().min(0).max(100),
  average_execution_score: z.number().int().min(0).max(100),
  latest_summaries: z.array(AttentionSummaryRow),
  top_tags: z.array(TagFreq),
});
export type AttentionSummary = z.infer<typeof AttentionSummary>;

export type WindowKey = "7d" | "30d" | "all";

export async function getAttentionSummary(
  window: WindowKey = "30d",
  projectID?: string | null,
): Promise<AttentionSummary> {
  const searchParams: Record<string, string> = { window };
  if (projectID) searchParams.project_id = projectID;
  const json = await api.get("v1/attention/summary", { searchParams }).json();
  return AttentionSummary.parse(json);
}
