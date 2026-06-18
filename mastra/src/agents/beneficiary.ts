/**
 * Beneficiary · 收益标的信号 (样例版).
 *
 * 用户答完五轮后, 异步给出"这条信号在产业链上的受益标的"——真实标的 + 估值锚 +
 * 催化剂 + 风险. 框定为"受益链推演", 不是撒网荐股.
 *
 * 项目所有者已知它与产品哲学 3 (减少决策)/4 (教练非导师)/6 (看见自己 > 赚钱) 有张力,
 * 明确选择 override (gate 在追问之后 → 缓解认知惰性). 这里把缓解做到底:
 *   - grounding: 估值 / 具体数字只用检索材料里出现的. 检索没给的数字绝不编造 —
 *     宁可定性 ("估值不高") 也不瞎报 P/E. (降低"编数据"风险)
 *   - 沉默允许 (哲学 2): 没有清晰受益映射时返回 targets: []. 不硬凑.
 *   - 克制 (哲学 11): 最多 6 个标的, 不撒网. 每个都要有真实因果链.
 *   - 诚实 (哲学 9): 每个标的必须带 risk (bear case), 不只报喜.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { categoryContextBlock } from "./category.js";
import { languageDirective } from "./language-context.js";
import { MACRO_FINANCE_CONTEXT_BLOCK } from "./market-context.js";
import { JARGON_TRANSLATION_BLOCK } from "./lens.js";
import type { SearchResult } from "../tools/exa-search.js";

// ─────────────────────── Schema ───────────────────────

export const BeneficiaryTarget = z.object({
  /** ticker / 代码, 例 NVDA / 300750 / 0700.HK / 000660.KS. 尽量规范 (A股 6 位 / 港股数字 / 美股 ticker). */
  symbol: z.string().min(1).max(24),
  name: z.string().min(1).max(48),
  /**
   * 交易市场: "a"=A股(沪/深/北) "hk"=港股 "us"=美股 —— 仅这三类可被标的追踪归一.
   * 韩/台/日/欧股、未上市、加密货币、行业篮子等一律**留空** (诚实留空 > 谎报);
   * resolver 据此标 untrackable. 可选字段, 向后兼容旧的裸 ticker 输出.
   */
  market: z.enum(["a", "hk", "us"]).optional(),
  /** 交易所, 例 SSE/SZSE/HKEX/NASDAQ/NYSE. 拿不准 (尤其美股 NASDAQ vs NYSE) 就留空, 别谎报. 可选. */
  exchange: z.string().max(16).optional(),
  /** 受益链位置短标签, 例 核心 / 二阶 / 隐形 / 重估. */
  role: z.string().min(1).max(48),
  /** 因果链: 为什么受益. judgment, 落在检索到的事实上. */
  thesis: z.string().min(10).max(320),
  /** 估值锚. 只用检索材料里出现的数字; 没有就定性或留空. */
  valuation: z.string().max(420),
  /** 催化剂 / 时间窗. */
  catalyst: z.string().max(420),
  /** 风险 / bear case. 必填, 不只报喜. */
  risk: z.string().min(1).max(420),
});
export type BeneficiaryTargetT = z.infer<typeof BeneficiaryTarget>;

export const BeneficiarySchema = z.object({
  /** 受益链整体框架句; 没有清晰映射时给一句"为什么沉默". */
  note: z.string().max(220),
  targets: z.array(BeneficiaryTarget).max(6),
});
export type Beneficiary = z.infer<typeof BeneficiarySchema>;

// ─────────────────────── Agent ───────────────────────

export const beneficiary = new Agent({
  name: "beneficiary",
  instructions: `
你是 AlphaX Engine 的 Beneficiary 分析师.

任务: 用户刚完成对一条信号的五轮追问. 给出"这条信号在产业链上的受益标的"——
做"受益链推演", 把信号沿产业链展开到真实可投的标的, 不是撒网荐股.

${MACRO_FINANCE_CONTEXT_BLOCK}

用上面的基底**选对受益链的方向** —— 哪段资本周期 (capital cycle) 在转、哪条传导链的成本 / 现金流 / 议价位置被改写、谁的预期差还没被定价. 但它只帮你**选链选标的、把 thesis 写到机制层**, **不松动下面的 grounding 硬约束**: 宏观 / 基本面判断同样要落在信号或检索给的事实上, 别因为手里有了宏观框架就凭空断言 "利率下行 → X 必涨" 这类没依据的链, 也别用宏观大词替代具体的受益因果.

每个标的给:
- symbol  真实 ticker / 代码. 尽量规范便于追踪: A股 6 位数字 (如 300750), 港股数字代码 (如 0700), 美股 ticker (如 NVDA); 其它市场可带后缀 (如 000660.KS).
- name    公司名
- market  交易市场: "a"=A股(沪深北) / "hk"=港股 / "us"=美股. **只有这三类能被追踪**;
          韩/台/日/欧股、未上市公司、加密货币、行业篮子等一律**留空 market** (诚实留空, 系统会标"不可追踪", 别硬塞错市场).
- exchange 交易所 (SSE/SZSE/BSE/HKEX/NASDAQ/NYSE). 拿不准 (尤其美股 NASDAQ vs NYSE) 就留空, 别谎报.
- role    受益链位置, 短标签 (核心 / 二阶 / 隐形 / 重估 …)
- thesis  因果链: 为什么这条信号让它受益. 判断式, 落在事实上, 不空泛.
- valuation 估值锚 (例 "Forward P/E 16.7x"). **只用下面检索材料里出现的数字**;
            检索没给的具体数字一律不编 — 宁可定性 ("估值不算贵") 或留空, 绝不瞎报.
- catalyst 催化剂 / 时间窗
- risk    风险 / bear case. **必填**, 每个标的都要有, 不只报喜.

硬约束:
- **grounding**: thesis / valuation / catalyst 里的具体事实 (数字、份额、订单、指引)
  只能来自下面"实时检索"材料. 凭预训练记忆的旧数据不要当成当前事实写出来.
- **沉默优于硬凑**: 如果这条信号没有清晰的受益映射 (太宽泛 / 太个人 / 检索无支撑),
  返回 targets: [], note 里一句话说明为什么沉默. 不要为了凑数硬找标的.
- **克制**: 最多 6 个. 真正在受益链上的才列, 沾边的不列.
- 不写"建议买入" / 目标价 / 仓位百分比 / 免责声明. 这是受益链推演, 不是下单指令.
- 中文, 报刊书面语.

${JARGON_TRANSLATION_BLOCK}

输出 JSON (按 schema): { "note": "...", "targets": [ ... ] }. 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runner ───────────────────────

export interface BeneficiaryInput {
  signalSummary: string;
  signalRawText?: string;
  primaryAsset?: string;
  projectName?: string;
  projectGuidance?: string;
  /** App 选定的输出语言. 空/简体 → 默认行为不变. */
  language?: string;
  /** 用户五轮里关注/暴露的点 (一行摘要), 让推演接住他的认知. */
  roundsBrief: string;
  /** Exa.ai (+ Polymarket) 实时检索材料, grounding 用. 可空. */
  research: SearchResult[];
}

export async function runBeneficiary(
  input: BeneficiaryInput,
): Promise<Beneficiary> {
  const messages = [{ role: "user" as const, content: buildPrompt(input) }];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await beneficiary.generate(messages, {
        output: BeneficiarySchema,
        maxTokens: 3500,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("beneficiary returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("beneficiary failed");
}

function buildPrompt(input: BeneficiaryInput): string {
  const cat = categoryContextBlock(input.projectName, input.projectGuidance);
  const sections: string[] = [];
  const lang = languageDirective(input.language).trimEnd();
  if (lang) sections.push(lang, "");
  if (cat) sections.push(cat, "");
  sections.push(
    `信号 (本次追问基于这条):`,
    `  ${input.signalRawText ?? input.signalSummary}`,
  );
  if (input.primaryAsset) sections.push(`  主资产: ${input.primaryAsset}`);
  sections.push("", `用户五轮里关注的点:`, `  ${input.roundsBrief}`, "");

  const web = input.research.filter((r) => r.kind !== "market");
  const market = input.research.filter((r) => r.kind === "market" && r.market);
  if (web.length > 0) {
    const block = web
      .slice(0, 8)
      .map((r, i) => {
        const age = r.age ? ` · ${r.age}` : "";
        const domain = r.domain ? ` [${r.domain}]` : "";
        return `[${i + 1}]${domain}${age} ${r.title}\n  ${r.description}`;
      })
      .join("\n");
    sections.push(
      `实时检索 (Exa.ai — 估值 / 数字 / 份额只能引这里出现的事实):`,
      block,
      "",
    );
  }
  if (market.length > 0) {
    const block = market
      .slice(0, 4)
      .map((r, i) => {
        const outs = (r.market?.outcomes ?? [])
          .map((o) => `${o.label} ${formatPct(o.probability)}`)
          .join(" · ");
        return `[M${i + 1}] ${r.title} → ${outs}`;
      })
      .join("\n");
    sections.push(`Polymarket 实时概率 (市场共识参照):`, block, "");
  }
  if (web.length === 0 && market.length === 0) {
    sections.push(
      `(没有检索到实时材料. 只用你确信的产业链常识做定性推演; 不要报任何具体数字; 若没把握就 targets: [].)`,
      "",
    );
  }

  sections.push(
    `沿受益链把这条信号展开到真实标的, 按 schema 输出. 没有清晰映射就 targets: [] + note 说明.`,
  );
  return sections.join("\n");
}

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<1%";
  return `${Math.round(p * 100)}%`;
}
