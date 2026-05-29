/**
 * /v1/refinement/sessions/* 的 typed 客户端封装.
 * 与 server/internal/module/refinement/handler.go 的 DTO 对齐.
 */

import { HTTPError } from "ky";
import { z } from "zod";
import { api } from "./client";

// ───── Schemas ─────

export const QuestionKind = z.enum(["single", "multi", "ordering", "open", "commitment_setup"]);
export type QuestionKindT = z.infer<typeof QuestionKind>;

export const OptionGroup = z.enum(["action", "duration"]);
export type OptionGroupT = z.infer<typeof OptionGroup>;

export const QuestionOption = z.object({
  id: z.string(),
  text: z.string(),
  is_distractor: z.boolean(),
  is_required: z.boolean().default(false),
  // rounds 1-4: 最后一条选项 is_user_input=true, 客户端展开文本框收 open_text.
  is_user_input: z.boolean().default(false),
  // r5 commitment_setup 用: "action" 组 (act_buy/sell/hold) + "duration" 组 (dur_1m..36m).
  group: OptionGroup.optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const DiagnosisKind = z.enum(["correct", "partial_miss", "distractor", "weak"]);

export const Diagnosis = z.object({
  kind: DiagnosisKind,
  note: z.string().optional(),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

export const UserAnswer = z.object({
  choice_ids: z.array(z.string()).optional(),
  open_text: z.string().optional(),
  time_ms: z.number().int().nonnegative(),
});
export type UserAnswer = z.infer<typeof UserAnswer>;

export const RoundView = z.object({
  round: z.number().int().min(1).max(5),
  question_id: z.string(),
  question_kind: QuestionKind,
  question_text: z.string(),
  options: z.array(QuestionOption).optional(),
  user_answer: UserAnswer,
  diagnosis: Diagnosis,
  answered_at: z.string(),
});
export type RoundView = z.infer<typeof RoundView>;

// pending_question.payload 是 Mastra 出的题, 形如 QuestionSchema (见 server/socratic).
export const PendingQuestionPayload = z.object({
  question_id: z.string(),
  round: z.number().int().min(1).max(5),
  kind: QuestionKind,
  text: z.string(),
  options: z.array(QuestionOption).optional(),
  open_prompts: z.array(z.string()).optional(),
  model: z.string().optional(),
});
export type PendingQuestionPayload = z.infer<typeof PendingQuestionPayload>;

export const PendingQuestion = z.object({
  round: z.number().int().min(1).max(5),
  payload: PendingQuestionPayload,
});
export type PendingQuestion = z.infer<typeof PendingQuestion>;

export const SessionResponse = z.object({
  id: z.string().uuid(),
  primary_signal_id: z.string().uuid(),
  primary_asset: z.string().nullable().optional(),
  primary_signal_raw_text: z.string().optional(),
  primary_signal_summary: z.string().nullable().optional(),
  status: z.enum(["active", "completed", "abandoned"]),
  rounds_done: z.number().int().min(0).max(5),
  decision: z.string().optional(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  rounds: z.array(RoundView).optional(),
  pending_question: PendingQuestion.optional(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const AnswerResponse = z.object({
  new_round: z.number().int(),
  completed: z.boolean(),
  decision: z.string().optional(),
});
export type AnswerResponse = z.infer<typeof AnswerResponse>;

// ───── Calls ─────

export async function startRefinement(input: {
  client_event_id: string;
  primary_signal_id: string;
  primary_asset?: string | null;
}): Promise<SessionResponse> {
  const json = await api.post("v1/refinement/sessions", { json: input }).json();
  return SessionResponse.parse(json);
}

export async function getRefinement(id: string): Promise<SessionResponse> {
  const json = await api.get(`v1/refinement/sessions/${id}`).json();
  return SessionResponse.parse(json);
}

// 通过 signal_id 拉该信号上最近一次已完成的五轮追问. 没有 → null (不是 error).
// 信号详情页用这个判断"是否要在底部展示历史问答".
export async function getRefinementBySignal(signalId: string): Promise<SessionResponse | null> {
  try {
    const json = await api.get(`v1/refinement/sessions/by-signal/${signalId}`).json();
    return SessionResponse.parse(json);
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      return null;
    }
    throw err;
  }
}

export interface SubmitAnswerInput {
  session_id: string;
  client_event_id: string;
  round: number;
  question_id: string;
  question_kind: QuestionKindT;
  question_text: string;
  options?: QuestionOption[];
  user_answer: UserAnswer;
  diagnosis: Diagnosis;
}

export async function submitAnswer(input: SubmitAnswerInput): Promise<AnswerResponse> {
  const { session_id, ...body } = input;
  const json = await api
    .post(`v1/refinement/sessions/${session_id}/answers`, { json: body })
    .json();
  return AnswerResponse.parse(json);
}

/**
 * reinferQuestion — 用户主动触发: 等下一题超 60s (mastra socratic DLQ 了).
 * server 重发最近一条 refinement.answered event, mastra 重新跑 socratic.
 *
 * 失败:
 *   - 404 不属于该 user
 *   - 409 已 completed / 有 pending question / 还没答任何一轮
 */
export async function reinferQuestion(sessionId: string): Promise<void> {
  await api.post(`v1/refinement/sessions/${sessionId}/reinfer-question`).json();
}
