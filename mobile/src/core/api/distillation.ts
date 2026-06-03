/**
 * /v1/distillations/* 的 typed 客户端封装 (降噪页).
 * 与 server/internal/module/distillation/handler.go 的 DTO 对齐.
 *
 * beneficiary 三态:
 *   - null / 缺省 → 金融 agent 还在推演 (降噪页继续 poll)
 *   - []         → 推演完无受益映射 → 留白 (产品哲学 2)
 *   - [ … ]      → 收益标的信号
 */

import { HTTPError } from "ky";
import { z } from "zod";
import { api } from "./client";

export const BeneficiaryTarget = z.object({
  symbol: z.string(),
  name: z.string(),
  role: z.string(),
  thesis: z.string(),
  valuation: z.string().optional().default(""),
  catalyst: z.string().optional().default(""),
  risk: z.string(),
});
export type BeneficiaryTarget = z.infer<typeof BeneficiaryTarget>;

export const DistillationResponse = z.object({
  refinement_id: z.string(),
  distilled_content: z.string().nullable().optional(),
  beneficiary: z.array(BeneficiaryTarget).nullable().optional(),
  beneficiary_note: z.string().nullable().optional(),
  model: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type DistillationResponse = z.infer<typeof DistillationResponse>;

/**
 * 拉一条降噪页. 还没生成 (mastra post-refinement 没跑完) → 404 → 返回 null
 * (不是 error), 降噪页据此继续 poll.
 */
export async function getDistillation(refinementId: string): Promise<DistillationResponse | null> {
  try {
    const json = await api.get(`v1/distillations/${refinementId}`).json();
    return DistillationResponse.parse(json);
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * 用户在降噪页点"进入四道门" → 触发四道门评估 ("前置于四道门"流程).
 * server detached 跑评估, 立即 202; 结果之后照常通过 inbox 的承诺书 callout 浮现.
 */
export async function proceedToGate(refinementId: string): Promise<void> {
  await api.post("v1/gate/evaluate", { json: { refinement_id: refinementId } }).json();
}
