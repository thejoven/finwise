import { z } from "zod";

/**
 * InferenceSchema — what the Analyst Agent is allowed to return.
 *
 * Strict on purpose:
 *   - max 5 tags (no taxonomy explosion)
 *   - max 6 related assets (no shotgun lists)
 *   - 60-char one-line summary (forces the model to extract the kernel)
 *   - empty arrays allowed (the agent SHOULD return [] on weak signals,
 *     per AGENT_BRIEF "当信号不够清晰时, 返回空数组(不要瞎编)")
 */
export const CognitiveLayer = z.enum(["first", "second", "third"]);
export const ConsensusCheck = z.enum(["leading", "aligned", "lagging"]);

export const RelatedAsset = z.object({
  ticker: z.string().min(1).max(20),
  rationale: z.string().min(1).max(140),
  order: CognitiveLayer,
});

export const InferenceSchema = z.object({
  tags: z.array(z.string().min(1).max(20)).max(5),
  related_assets: z.array(RelatedAsset).max(6),
  cognitive_layer: CognitiveLayer,
  consensus_check: ConsensusCheck,
  one_line_summary: z.string().min(1).max(60),
});

export type Inference = z.infer<typeof InferenceSchema>;

/**
 * Inputs the workflow receives off NATS. Mirrors the Go publish payload
 * shape — keep these in sync with server/internal/domain/signal.go +
 * server/internal/domain/phase2.go.
 */
export const SignalCapturedPayload = z.object({
  signal_id: z.string().uuid(),
  user_id: z.string().uuid(),
  raw_text: z.string().min(1),
  captured_at: z.string(), // ISO-8601 timestamp
});

export type SignalCaptured = z.infer<typeof SignalCapturedPayload>;

// ───── Phase 2 · refinement ─────

export const RefinementStartedPayload = z.object({
  refinement_id: z.string().uuid(),
  user_id: z.string().uuid(),
  signal_ids: z.array(z.string().uuid()).min(1),
  primary_asset: z.string().optional().nullable(),
  started_at: z.string(),
});
export type RefinementStarted = z.infer<typeof RefinementStartedPayload>;

export const RefinementAnsweredPayload = z.object({
  refinement_id: z.string().uuid(),
  user_id: z.string().uuid(),
  round: z.number().int().min(1).max(5),
  question_id: z.string(),
  // 不全 schema 校验, 因为 Mastra 用不到 (workflow 拉 view 取上下文)
  answered_at: z.string(),
}).passthrough();
export type RefinementAnswered = z.infer<typeof RefinementAnsweredPayload>;
