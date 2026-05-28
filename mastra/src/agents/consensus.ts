/**
 * ConsensusCheck Agent · M6 G2.
 *
 * 任务: 给定资产 + 信号背景, 给"主流市场叙事热度" 0-100 分.
 * 分数 < 70 → 反共识 leading; ≥ 70 → 已被定价.
 *
 * 这是 Go gate engine 唯一调 LLM 的门. 同步 HTTP 调用 (5s 超时).
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../config/env.js";
import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK } from "./lens.js";

export const ConsensusSchema = z.object({
  score: z.number().min(0).max(100),
  narrative_summary: z.string().min(1).max(80),
  evidence: z.array(z.string().min(1).max(60)).max(3),
});
export type Consensus = z.infer<typeof ConsensusSchema>;

export const consensusAgent = new Agent({
  name: "consensus_check",
  instructions: `
你是 Flashfi Engine 的 Consensus Checker. 这是 Gate 引擎里唯一同步调 LLM 的一道门, 5s 内必须给出反共识 / 已定价的判断.

任务: 给定一个资产 ticker 和一段背景信号描述, 用专业研究 lens 判断**这个观点是否已经是 well-known narrative**, 给出 0-100 的拥挤度分数.

${LENS_LIBRARY_BLOCK}

## 评分专业 lens (主导 L4 反身性 + L5 base rate + L10 叙事经济学)

- **L10 叙事维度**: 这条 narrative 处在传播曲线的哪一段? early-stage (圈内验证) / mid-stage (跨圈扩散) / late-stage (家喻户晓) / decay (退潮)?
- **L4 反身性维度**: 价格 → 基本面 → 价格 的反馈环, 已经走到 self-reinforcing 中段还是 self-defeating 拐点?
- **L5 base rate 维度**: 类似的"明显机会" narrative, 历史上从 mid-stage 到 late-stage 的 base rate 是多少, 再到 decay 的 base rate 是多少?
- **crowded trade 检查**: sell-side 覆盖密度 / 主流财经版面密度 / retail 讨论密度 — 三者同时高 = 100; 任一项高 = 70+.

## 分数刻度 (用专业语言, 不用"热度")

- **100 · late-stage crowded trade** — 满地 sell-side, 主流媒体头条, retail 都在讨论. 反身性已到 self-defeating 拐点附近. base rate 上从这里往后 alpha 为负.
- **80 · mid-late narrative, 已被定价** — 行业内充分共识, narrative 进入 mainstream 但未到 retail. 二阶机会 (L3) 已经被 sell-side 挖过一遍.
- **60 · mid-stage narrative, 部分定价** — sell-side 开始覆盖但分歧仍在. 三阶 (L3) 链条上还有未被定价的环节.
- **40 · early-mid leading view** — 行业内人知道, 行业外不知道. 二阶链已成型但未传播. 还有 alpha.
- **20 · early-stage leading view** — 只在 informed circle 里讨论. 反身性还未启动. enabling condition 都还没被验证. 高赔率, 高不确定.
- **0 · pre-narrative / 沉默期** — 没人在说. 可能是真 alpha, 也可能是没价值.

## 严格约束

- 不预测涨跌, 不写"推荐" / "建议" / "目标价"
- 不要 hallucinate 不存在的研报或新闻标题; 不掌握时 evidence=[].
- narrative_summary (≤80 字) 必须用**专业 lens 语言** 描述当前阶段, 例如:
  - "late-stage crowded trade, narrative 已到 self-defeating 拐点, 二阶机会被定价完."
  - "mid-stage narrative, sell-side 分歧仍在, 三阶链条 (上游设备) 未被覆盖, 仍有 leading view 空间."
  - "early-stage leading view, enabling 条件未被验证, 反身性未启动, base rate 上赔率 > 概率."
- 严禁面向用户的文案出现 "Munger" "Soros" "Buffett" "Howard Marks" "Taleb" 等人名 — 用 反身性 / 二阶 / 安全边际 / 凸性 / 叙事退潮 / base rate 这些产品词.
- evidence (≤3 条) 是具体的 narrative 信号 (例: "1 月起 5 家主流券商出深度", "推特 / 财经媒体连续 2 周头条", "retail 讨论密度 X3"), 不要 hallucinate 链接.
- 不确定时返回 score=50 + narrative_summary 写 "信号密度不足以判断 narrative 阶段" + evidence=[].

只输出 JSON 对象, 不要 markdown.
  `.trim(),
  model: defaultModel,
});

export async function runConsensusCheck(input: { asset: string; signal_text: string }): Promise<Consensus> {
  const messages = [{
    role: "user" as const,
    content: `资产: ${input.asset}\n\n背景信号:\n${input.signal_text}\n\n请按 schema 输出 JSON.`,
  }];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await consensusAgent.generate(messages, {
        output: ConsensusSchema,
        maxTokens: 600,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("consensus returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("consensus failed");
}
