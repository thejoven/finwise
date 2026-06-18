/**
 * Diagnostician Agent · M11 复盘训练.
 *
 * 任务: 给定 4 道复盘问答 (perception / inference / evaluation / execution),
 * 推断"下一次最该练的维度", 输出 focus_dim + 30-60 字具体诊断.
 *
 * Phase 3 plan § Diagnostician 风险 #1: 输出语义不稳定. prompt 重视:
 *   - **必须**选 6 个 focus_dim 之一, 不允许造新维度
 *   - focus_text 必须**具体**到下一次的可观察动作, 不写"多观察" / "再思考"
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../config/env.js";
import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK } from "./lens.js";
import { languageDirective } from "./language-context.js";
import { getMemory } from "../memory/agent-memory.js";

export const FocusDim = z.enum([
  "perception_speed",
  "inference_depth",
  "decision_speed",
  "holding_patience",
  "exit_quality",
  "thesis_evolution",
]);
export type FocusDimT = z.infer<typeof FocusDim>;

export const DiagnosisSchema = z.object({
  focus_dim: FocusDim,
  focus_text: z.string().min(20).max(360),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const diagnosticianAgent = new Agent({
  name: "diagnostician",
  memory: getMemory(),
  instructions: `
你是 AlphaX Engine 的 Diagnostician · 复盘训练.

任务: 给定一份持仓的 4 道复盘问答 (4 个维度: perception 感知 / inference 推演 / evaluation 判定 / execution 执行),
推断"下一次承诺书周期里最该练的维度", 输出 focus_dim + focus_text.

${LENS_LIBRARY_BLOCK}

focus_dim 必须**严格**是以下 6 个之一. 每个 dim 在框架上的解释:
- perception_speed   · 录入信号的速度. 对应 L1 根因还原的早期触达 — 信号 vs 共识的时差.
- inference_depth    · 推演链的深度. 对应 L3 二阶思考 + L2 多元思维栅格 — 链跑到第几跳, 用了几个 lens.
- decision_speed     · 从信号到签字的速度. 对应 L5 base rate vs inside view 的犹豫成本.
- holding_patience   · 持仓期间不被波动牵着走. 对应 L4 反身性中段的承压能力 + L9 凸性未兑现前不卖.
- exit_quality       · 退出条件的清晰度. 对应 L8 安全边际 + L9 凸性还原为现金的具体触发器.
- thesis_evolution   · 命题随时间演化的能力. 对应 L4 反身性拐点识别 + L10 叙事生命周期演化.

focus_text 写作约束 (30-120 字):
- 第二人称"你".
- **必须用专业 lens 的产品语言**指出问题落在哪条 lens 的哪个跳. 例:
  - inference_depth 弱 → "你的推演停在二阶, 多元思维栅格只用了金融 lens; 下一次先用法律 / 工程 / 博弈 lens 各走一遍, 看是否能多出一条三阶链."
  - exit_quality 弱 → "你的退出条件是'看情况', 没有安全边际锚, 也没把凸性还原为可执行的开关; 下一次写: 价格 X + 时间 T + 外部信号 Z, 三者满足任一就退."
  - holding_patience 弱 → "你在反身性 self-reinforcing 中段被价格反噬, 缺 base rate 锚; 下一次签字前先写'类似 narrative 历史上回撤 N%, 我能承受多少'."
- 严禁: "多观察" / "再思考" / "建议关注" / "保持耐心" / "Munger" / "Soros" / "Buffett" 等抽象词或人名.
- 不重复用户答案原文 (那不是诊断, 是复读).
- 必须落到**下一次承诺周期里可观察 / 可执行的动作**, 不是哲学.

判定原则:
- 看用户答的"最薄弱"那一面 — 哪条 lens 漏得最多, 不是哪条最熟.
- 如果 open_text 答得空, 那是诊断信号 (能说出问题 = 已经在练那个维度; 说不出 = 该维度盲点).
- 如果 4 题答得平均, 选 inference_depth (默认值 — 这是 AlphaX 真实研究流程的核心: 多元思维栅格 + 二阶思考).

只输出 JSON, 不要 markdown.
  `.trim(),
  model: defaultModel,
});

export interface DiagnosticianInput {
  user_id: string;
  commitment_asset: string;
  commitment_thesis_summary: string;
  answers: Array<{
    no: number;
    dim: string;
    question: string;
    choice: string;
    open_text?: string;
  }>;
  language?: string;
}

export async function runDiagnostician(input: DiagnosticianInput): Promise<Diagnosis> {
  const ansBlock = input.answers
    .map((a) => `Q${a.no} (${a.dim}): ${a.question}\n   选: ${a.choice}\n   说: ${a.open_text || "(空)"}`)
    .join("\n\n");
  const messages = [{
    role: "user" as const,
    content: `${languageDirective(input.language)}持仓资产: ${input.commitment_asset}
当时的承诺要点: ${input.commitment_thesis_summary}

复盘四问 (用户的答案):

${ansBlock}

按 schema 输出 JSON.`,
  }];

  // thread 用 commitment_asset — 同一持仓的多轮复盘记忆累积; 跨持仓
  // 仍能通过 resource=user_id 的 semantic recall 召回相关诊断
  const memoryOpt = {
    resource: input.user_id,
    thread: { id: `diagnostician:${input.commitment_asset}`, title: `复盘 ${input.commitment_asset}` },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await diagnosticianAgent.generate(messages, {
        output: DiagnosisSchema,
        maxTokens: 500,
        temperature: 0.3,
        memory: memoryOpt,
      });
      if (res?.object) return res.object;
      lastErr = new Error("diagnostician returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("diagnostician failed");
}
