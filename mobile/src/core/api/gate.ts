/**
 * /v1/gate/* 客户端封装.
 *
 * 只有 archive tab 查询用. Phase 2 单用户场景, 通过的 gate evaluation 是隐式的
 * (后端发 gate.passed 给 Narrator), 客户端不需要看. 失败归档的 4 池才在这里展.
 */

import { z } from "zod";
import { api } from "./client";
import i18n from "@/core/i18n";

const ArchivePool = z.enum(["observation", "lesson", "calendar", "discard"]);
export type ArchivePoolT = z.infer<typeof ArchivePool>;

const GateG1 = z.object({
  pass: z.boolean(),
  count: z.number(),
  detail: z.string().nullable().optional(),
});
// 共识分析师的"未被定价的方向" (指方向, 不荐股). 老评估行没有这个字段 → [].
const UnpricedDirection = z.object({
  angle: z.string(),
  why_unpriced: z.string(),
  lens: z.string().nullable().optional(),
});
export type UnpricedDirection = z.infer<typeof UnpricedDirection>;
const GateG2 = z.object({
  pass: z.boolean(),
  score: z.number(),
  detail: z.string().nullable().optional(),
  unpriced_directions: z.array(UnpricedDirection).optional().default([]),
});
const GateG3 = z.object({
  pass: z.boolean(),
  months: z.number(),
  detail: z.string().nullable().optional(),
});
const GateG4Sub = z.object({
  explain: z.boolean(),
  direct: z.boolean(),
  track_record: z.boolean(),
  exit_known: z.boolean(),
});
const GateG4 = z.object({
  pass: z.boolean(),
  sub: GateG4Sub,
  detail: z.string().nullable().optional(),
});

const GateDetail = z.object({
  g1_thickness: GateG1,
  g2_anti_consensus: GateG2,
  g3_window: GateG3,
  g4_edge: GateG4,
});
export type GateDetail = z.infer<typeof GateDetail>;

// 评估对应的信号上下文 (server 读取路径 JOIN 取得). 老缓存/旧 server 没有 → undefined.
const GateSignalContext = z.object({
  id: z.string().uuid(),
  asset: z.string().nullable().optional(),
  summary: z.string().optional().default(""),
});
export type GateSignalContext = z.infer<typeof GateSignalContext>;

export const GateEvaluation = z.object({
  id: z.string().uuid(),
  refinement_id: z.string().uuid(),
  gates: GateDetail,
  passed: z.boolean(),
  failed_gate: z.number().int().nullable().optional(),
  archived_pool: ArchivePool.nullable().optional(),
  evaluated_at: z.string(),
  signal: GateSignalContext.optional(),
});
export type GateEvaluation = z.infer<typeof GateEvaluation>;

/**
 * 分析师审核团 · 用户看到的命名 (替代抽象的"门 1 / 门 2").
 * 与后端 service.go / mastra analysts.ts 一致; 底层数据仍用 g1..g4 键.
 * 展示名/职责走 i18n (analystName / analystRole), 故此处只存稳定的 i18n key.
 */
export const ANALYSTS = [
  { gate: 1 as const, key: "g1_thickness" as const, i18nKey: "thickness" as const },
  { gate: 2 as const, key: "g2_anti_consensus" as const, i18nKey: "antiConsensus" as const },
  { gate: 3 as const, key: "g3_window" as const, i18nKey: "window" as const },
  { gate: 4 as const, key: "g4_edge" as const, i18nKey: "edge" as const },
];

export type Analyst = (typeof ANALYSTS)[number];

export function analystByGate(gate: number | null | undefined) {
  return ANALYSTS.find((a) => a.gate === gate);
}

/** 分析师展示名 (随语言切换). 传 undefined → 通用"分析师". */
export function analystName(analyst: Analyst | null | undefined): string {
  if (!analyst) return i18n.t("gate.committee.analyst");
  return i18n.t(`gate.committee.analysts.${analyst.i18nKey}.name`);
}

/** 分析师职责一行 (随语言切换). */
export function analystRole(analyst: Analyst | null | undefined): string {
  if (!analyst) return "";
  return i18n.t(`gate.committee.analysts.${analyst.i18nKey}.role`);
}

const PoolListResponse = z.object({
  evaluations: z.array(GateEvaluation),
});

export async function listGatePool(
  pool: ArchivePoolT,
  limit = 50,
  projectId?: string | null,
): Promise<GateEvaluation[]> {
  const searchParams: Record<string, string> = { limit: String(limit) };
  if (projectId) searchParams.project_id = projectId;
  const json = await api.get(`v1/gate/pools/${pool}`, { searchParams }).json();
  return PoolListResponse.parse(json).evaluations;
}

export async function getGateEvaluation(id: string): Promise<GateEvaluation> {
  const json = await api.get(`v1/gate/evaluations/${id}`).json();
  return GateEvaluation.parse(json);
}

// ───── 分析师对话 (归档页 → 与否决分析师继续聊) ─────

export const GateChatMessage = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "analyst"]),
  content: z.string(),
  created_at: z.string(),
});
export type GateChatMessage = z.infer<typeof GateChatMessage>;

const ChatListResponse = z.object({ messages: z.array(GateChatMessage) });

export async function listGateChat(evaluationId: string): Promise<GateChatMessage[]> {
  const json = await api.get(`v1/gate/evaluations/${evaluationId}/chat`).json();
  return ChatListResponse.parse(json).messages;
}

/**
 * 发一条消息, 同步等分析师回复 (server → mastra → LLM 全文). 返回这次新增的
 * [用户消息, 分析师回复] 两条.
 *
 * 长超时 + 不重试: LLM 往返常态 5-30s; 全局 retry 会在 5xx 时重发 POST,
 * 对话消息不幂等, 必须关掉.
 */
export async function sendGateChat(
  evaluationId: string,
  content: string,
): Promise<GateChatMessage[]> {
  const json = await api
    .post(`v1/gate/evaluations/${evaluationId}/chat`, {
      json: { content },
      timeout: 90_000,
      retry: 0,
    })
    .json();
  return ChatListResponse.parse(json).messages;
}

/**
 * 失败评估的"分析师否决一句话" — 归档卡气泡 + 对话页开场白共用.
 * g2 的 detail 是工程口径 ("Mastra score=72 (阈值<70). lagging. summary: ...")
 * — 取 summary 之后的自然语句; 其余门的 detail 本身就是 LLM reasoning.
 */
export function gateVerdictText(ev: GateEvaluation): string {
  const g = ev.failed_gate;
  if (g === 1) return ev.gates.g1_thickness.detail ?? i18n.t("gate.verdict.thickness");
  if (g === 2) {
    const d = ev.gates.g2_anti_consensus.detail ?? "";
    const m = d.match(/summary:\s*([\s\S]+)$/);
    if (m?.[1]) return m[1].trim();
    return d || i18n.t("gate.verdict.antiConsensus");
  }
  if (g === 3) return ev.gates.g3_window.detail ?? i18n.t("gate.verdict.window");
  if (g === 4) return ev.gates.g4_edge.detail ?? i18n.t("gate.verdict.edge");
  return "";
}

/**
 * 按 refinement_id 拿评估. 没评估过 → null (404 静默, 不抛).
 * signal 详情页底部展示分析师评审反馈用.
 */
export async function getGateByRefinement(refinementId: string): Promise<GateEvaluation | null> {
  try {
    const json = await api.get(`v1/gate/by-refinement/${refinementId}`).json();
    return GateEvaluation.parse(json);
  } catch (err) {
    // ky 的 HTTPError 不便在这里依赖, 直接用 duck-typed status 探测.
    const e = err as { response?: { status?: number } };
    if (e?.response?.status === 404) return null;
    throw err;
  }
}
