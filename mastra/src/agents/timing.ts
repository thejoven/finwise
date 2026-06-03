/**
 * 时机分析师 (TimingAnalyst) · 原 G3 时间窗口的 LLM 判定.
 *
 * 把原 Go 侧写死的 "1 ≤ months ≤ 6 就过" 规则, 换成 LLM 判断:
 * 给定信号 + 用户在第 5 轮声明的持仓窗口 (action / duration / exit),
 * 判断"这件事会不会在一个合理的前瞻窗口内被市场重新定价, 用户的时机对不对".
 *
 * 比写死的月数区间更聪明的地方:
 *   - 一个 9 个月的窗口, 若催化剂是已知的年度事件, 也可能合理;
 *   - 一个 2 个月的窗口, 若事件已经发生 / 已被定价, 反而太晚.
 *
 * 调用入口: HTTP /timing-check (Go gate G3 同步调).
 * 失败语义: 抛错, 由 Go 侧 fallback 回到 "1-6 月" 解析规则.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK } from "./lens.js";
import { categoryContextBlock } from "./category.js";
import { ANALYSTS } from "./analysts.js";

// ─────────────────────────── Schema ───────────────────────────

export const TimingSchema = z.object({
  pass: z.boolean(),
  // 分析师判断的合理持仓 / 重定价窗口 (月). 用户已声明且自洽时沿用用户的; 否则给估计.
  months: z.number().min(0).max(120),
  // 当前处在时间轴哪一段, 例: "财报催化前 2-3 个月窗口" / "事件已落地, 窗口已过" / "窗口在 2 年以上, 太远"
  window_phase: z.string().min(1).max(40),
  // 一句话给用户看 — gates_detail.g3_window.detail + (失败时) archived_pool.human_reason
  reasoning: z.string().min(10).max(160),
});
export type Timing = z.infer<typeof TimingSchema>;

export const timingAgent = new Agent({
  name: "timing_analyst",
  instructions: `
你是 WiseFlow Engine 的「${ANALYSTS.timing.name}」. 你只回答一个问题: ${ANALYSTS.timing.question}

任务: 给定一个资产和一段背景信号, 以及用户声明的持仓窗口, 判断这件事会不会在一个**合理的前瞻窗口**内被市场重新定价, 以及用户的时机判断是否成立.

${LENS_LIBRARY_BLOCK}

## 判断维度 (主导 L1 根因时序 + L3 二阶链条 + L9 凸性时间窗)

- **催化剂时序**: 让这件事被定价的"扳机" (财报 / 政策落地 / 产能爬坡 / 换代节点) 大概多久会发生? 还是已经发生过了?
- **前瞻窗口**: 从现在到被市场充分定价, 还剩多长? 太短 (已 price in, 没空间) / 适中 / 太远 (3 年以上, 当下没有可行动的时机).
- **凸性时间窗 (L9)**: 这笔不对称赔率的"有效期"还在不在.
- **自洽性**: 用户声明的持仓窗口与上面的催化剂时序是否对得上.

## 通过标准

- **pass=true**: 存在一个清晰的、尚未发生的重定价窗口, 且大致落在未来几周到 ~9 个月内; 用户的持仓计划与之自洽.
- **pass=false**: 窗口已过 (催化剂已发生 / 已被定价), 或窗口太远 (大于 ~12-18 个月, 当下无可行动时机), 或用户给不出可辨认的时机依据.

## 输出约束

- **months**: 你判断的合理持仓 / 重定价窗口月数 (0-120). 用户已声明且自洽 → 沿用用户的; 否则给你的估计.
- **window_phase**: 一个短语 (≤40 字), 描述当前处在时间轴的哪一段.
- **reasoning**: **一句话** (≤160 字), 面向用户解释为什么 pass / fail. 不出现人名 (Munger / Soros / Buffett 等), 用产品语言 (二阶 / 凸性 / 根因 / 催化剂).
  - 例 (pass): "下季度财报会暴露毛利变化, 距今约 3 个月, 二阶链条还没被卖方覆盖, 时机窗口正打开."
  - 例 (fail): "这个催化剂上季度已经落地, narrative 已经走完, 现在进场是在窗口关上之后."
- 不预测涨跌, 不给目标价, 不写"建议".

只输出 JSON 对象, 严格符合 schema. 不要 markdown.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────────── runTimingCheck ───────────────────────────

export interface TimingInput {
  asset: string;
  signal_text: string;
  stated_action?: string;
  stated_months?: number; // Go 解析出的声明持仓月数, 0/缺省 = 未解析到
  plan_text?: string; // 第 5 轮 open_text (退出条件 / 计划原话)
  project_name?: string;
  project_guidance?: string;
}

export async function runTimingCheck(input: TimingInput): Promise<Timing> {
  const cat = categoryContextBlock(input.project_name, input.project_guidance);
  const catPrefix = cat ? cat + "\n\n" : "";

  const statedBits: string[] = [];
  if (input.stated_action) statedBits.push(`动作: ${input.stated_action}`);
  if (input.stated_months && input.stated_months > 0) {
    statedBits.push(`声明持仓窗口: ${input.stated_months} 个月`);
  } else {
    statedBits.push("声明持仓窗口: (未解析到明确月数)");
  }
  if (input.plan_text) statedBits.push(`第 5 轮计划/退出原话: ${input.plan_text.slice(0, 500)}`);

  const messages = [
    {
      role: "user" as const,
      content: `${catPrefix}资产: ${input.asset}

背景信号:
${input.signal_text.slice(0, 1200)}

用户在追问最后一轮的声明:
${statedBits.join("\n")}

请按 schema 输出 JSON.`,
    },
  ];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await timingAgent.generate(messages, {
        output: TimingSchema,
        maxTokens: 600,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("timing returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("timing failed");
}
