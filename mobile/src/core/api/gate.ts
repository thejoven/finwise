/**
 * /v1/gate/* 客户端封装.
 *
 * 只有 archive tab 查询用. Phase 2 单用户场景, 通过的 gate evaluation 是隐式的
 * (后端发 gate.passed 给 Narrator), 客户端不需要看. 失败归档的 4 池才在这里展.
 */

import { z } from "zod";
import { api } from "./client";

export const ArchivePool = z.enum(["observation", "lesson", "calendar", "discard"]);
export type ArchivePoolT = z.infer<typeof ArchivePool>;

const GateG1 = z.object({ pass: z.boolean(), count: z.number(), detail: z.string().nullable().optional() });
const GateG2 = z.object({ pass: z.boolean(), score: z.number(), detail: z.string().nullable().optional() });
const GateG3 = z.object({ pass: z.boolean(), months: z.number(), detail: z.string().nullable().optional() });
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

export const GateDetail = z.object({
  g1_thickness: GateG1,
  g2_anti_consensus: GateG2,
  g3_window: GateG3,
  g4_edge: GateG4,
});
export type GateDetail = z.infer<typeof GateDetail>;

export const GateEvaluation = z.object({
  id: z.string().uuid(),
  refinement_id: z.string().uuid(),
  gates: GateDetail,
  passed: z.boolean(),
  failed_gate: z.number().int().nullable().optional(),
  archived_pool: ArchivePool.nullable().optional(),
  evaluated_at: z.string(),
});
export type GateEvaluation = z.infer<typeof GateEvaluation>;

const PoolListResponse = z.object({
  evaluations: z.array(GateEvaluation),
});

export async function listGatePool(pool: ArchivePoolT, limit = 50): Promise<GateEvaluation[]> {
  const json = await api.get(`v1/gate/pools/${pool}`, { searchParams: { limit: String(limit) } }).json();
  return PoolListResponse.parse(json).evaluations;
}

export async function getGateEvaluation(id: string): Promise<GateEvaluation> {
  const json = await api.get(`v1/gate/evaluations/${id}`).json();
  return GateEvaluation.parse(json);
}

/**
 * 按 refinement_id 拿评估. 没评估过 → null (404 静默, 不抛).
 * signal 详情页底部展示四道门反馈用.
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
