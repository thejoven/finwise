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
  // 信号归属判断: 仅当下发了候选分类 (未分类/provisional) 时有意义 —— analyst 从候选 id
  // 里选最匹配的一个; 都不匹配 / 未下发候选 → null. workflow 与 Go 端都按 null = 弃权处理.
  chosen_project_id: z.string().uuid().nullable(),
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
  // 分类上下文 (capture 时快照): analyst 据此"根据分类"推理. 可空.
  project_id: z.string().uuid().optional().nullable(),
  project_name: z.string().optional().nullable(),
  project_guidance: z.string().optional().nullable(),
  // 系统临时归类标记 (promote 兜底). 仅作镜像; 回写决策在 Go 端.
  project_auto_assigned: z.boolean().optional(),
  // 候选分类集: 信号未分类 / provisional 时下发, analyst 据此判断 chosen_project_id.
  candidate_projects: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        guidance: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
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
