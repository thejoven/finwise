/**
 * attention-analyze workflow.
 *
 * 触发: NATS refinement.completed event.
 *
 * 步骤:
 *   1. fetchState — GET /v1/internal/refinement/sessions/:id 拿全 5 轮 + diagnoses
 *   2. fetchSignalTags — session view 已含 primary_signal_summary; tags 从 view 推断
 *      (或者 view 已经 join 出 signal.inference_tags). 这里简化用 summary 当 tags 兜底.
 *   3. runAttentionAnalyst — 跑 LLM, zod 校验
 *   4. postAttention — POST 回 /v1/internal/attention 写入 db
 *
 * 失败语义:
 *   - fetchState 失败 → nak 重投
 *   - runAnalyst schema 失败 → 1 次内部 retry, 都失败 → nak (上层 maxDeliver=3)
 *   - postAttention 失败 → retryingPost 自己 5xx 重试; 网络真不通 → nak
 *
 * 早退: session 不是 completed → term (不该触发到这, 但兜底).
 */

import { runAttentionAnalyst, type AttentionInput } from "../skills/attention-analyst/index.js";
import {
  getRefinementSession,
  postAttention,
  type SessionView,
} from "../tools/flashfi-api.js";
import { config } from "../config/env.js";

export interface AttentionWorkflowInput {
  refinement_id: string;
  user_id: string;
}

export interface AttentionWorkflowResult {
  refinement_id: string;
  ok: boolean;
  /** "invalid" → term, 状态机异常不重试 */
  early?: "invalid";
  scores?: { focus: number; depth: number; breadth: number; execution: number };
  error?: string;
}

export async function runAttentionAnalyze(
  input: AttentionWorkflowInput,
): Promise<AttentionWorkflowResult> {
  // Step 1: fetchState
  let view: SessionView;
  try {
    view = await getRefinementSession({
      session_id: input.refinement_id,
      user_id: input.user_id,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `fetchState: ${errMsg(err)}`,
    };
  }

  if (view.status !== "completed" || view.rounds.length < 5) {
    // 没答完不该触发到这, 但兜底
    return {
      refinement_id: input.refinement_id,
      ok: false,
      early: "invalid",
      error: `session not completed (status=${view.status}, rounds=${view.rounds.length})`,
    };
  }

  // Step 2: 构造 analyst input
  const analystInput: AttentionInput = {
    signalSummary: view.primary_signal_summary ?? view.primary_signal_raw_text ?? "(无 summary)",
    signalTags: [], // 简化: 当前 SessionView 没暴露 inference_tags; 让 LLM 从 summary 推断
    rounds: view.rounds.map((r) => {
      // server 实际 user_answer JSON 含 time_ms; SessionView 类型上没暴露, 这里 cast.
      const ua = r.user_answer as { choice_ids?: string[]; open_text?: string; time_ms?: number };
      return {
        round: r.round,
        kind: r.question_kind,
        question_text: r.question_text,
        user_choice_ids: ua.choice_ids ?? [],
        user_open_text: ua.open_text,
        diagnosis_kind: r.diagnosis.kind,
        diagnosis_note: r.diagnosis.note,
        time_ms: ua.time_ms ?? 0,
      };
    }),
  };

  // Step 3: runAnalyst
  let result;
  try {
    result = await runAttentionAnalyst(analystInput);
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `analyst: ${errMsg(err)}`,
    };
  }

  // Step 4: postAttention
  try {
    await postAttention({
      refinement_id: input.refinement_id,
      user_id: input.user_id,
      focus_score: result.focus_score,
      depth_score: result.depth_score,
      breadth_score: result.breadth_score,
      execution_score: result.execution_score,
      insight: result.insight,
      blindspot: result.blindspot,
      model: config.analyst.model,
    });
  } catch (err) {
    return {
      refinement_id: input.refinement_id,
      ok: false,
      error: `postAttention: ${errMsg(err)}`,
    };
  }

  return {
    refinement_id: input.refinement_id,
    ok: true,
    scores: {
      focus: result.focus_score,
      depth: result.depth_score,
      breadth: result.breadth_score,
      execution: result.execution_score,
    },
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
