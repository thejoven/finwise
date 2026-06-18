/**
 * Symbol Resolver · 标的归一 (标的追踪 P0 · 规格 13 §3 硬问题一).
 *
 * Go 侧 resolver 先查别名表、走规则 (纯数字 A/HK 代码、括号内嵌代码); 命中即止.
 * 规则啃不动的自由文本 (中文公司名 / 裸字母 ticker / 模糊板块) 才同步 POST /symbol-resolve
 * 到本 agent —— 让 LLM 判它能否归一到 A股/港股/美股的单一在市标的.
 *
 * 诚实是第一约束 (呼应"信号永不未分类"式兜底): **错的代码比没有代码更有害**.
 *   - 高度确信才给代码; 否则 resolvable=false + 一句 reason.
 *   - 加密货币 / 未上市 / 海外主上市 / 行业篮子 / 同名歧义 → 一律 false, 不硬凑.
 * Go 侧还会做结构校验 (symbol 格式须与 market 匹配), 兜住格式型幻觉.
 *
 * 归一是确定性任务, temperature 0 —— 要可复现、不要发挥.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";

// ─────────────────────── Schema ───────────────────────

export const SymbolResolutionSchema = z.object({
  /** 能否归一到 A股/港股/美股的单一在市标的. false → 看 reason. */
  resolvable: z.boolean(),
  /** 交易市场. resolvable=true 必给. */
  market: z.enum(["a", "hk", "us"]).optional(),
  /** 规范代码: A股=6位数字 / 港股=数字代码 / 美股=ticker. resolvable=true 必给. */
  symbol: z.string().max(24).optional(),
  /** 交易所 SSE/SZSE/BSE/HKEX/NASDAQ/NYSE. 拿不准 (尤其美股) 留空. */
  exchange: z.string().max(16).optional(),
  /** 规范名 (公司全称/通称). */
  name: z.string().max(64).optional(),
  /** 证券类型. */
  type: z.enum(["equity", "etf", "index", "crypto", "other"]).optional(),
  /** resolvable=false 时一句话说明为什么不可追踪 (加密/未上市/海外/篮子/歧义). */
  reason: z.string().max(160).optional(),
});
export type SymbolResolution = z.infer<typeof SymbolResolutionSchema>;

// ─────────────────────── Agent ───────────────────────

export const symbolResolver = new Agent({
  name: "symbol-resolver",
  instructions: `
你是 AlphaX 的标的归一器 (symbol resolver). 给你一段对某投资标的的自由文本指称
(可能是公司名、股票代码、混写、或一个模糊的板块/篮子), 判断它**能否**归一到
A股 / 港股 / 美股 三大市场之一的**单一、当前在市**的上市标的, 并给出规范代码.

第一约束 —— 诚实: 只在你**高度确信**时给代码; 否则标 resolvable=false. **错的代码比没有代码更有害.**

resolvable=true 仅当: 它明确指向 A股(沪/深/北) 或 港股 或 美股的**一只**上市证券, 且你确信其规范代码.
给 market(a|hk|us) / symbol(规范代码) / exchange / name / type:
  - A股 symbol = 6 位数字 (宁德时代→300750, 北方华创→002371, 中芯国际→688981); exchange = SSE(沪)/SZSE(深)/BSE(北).
  - 港股 symbol = 数字代码 (腾讯→0700, 泡泡玛特→9992); exchange = HKEX.
  - 美股 symbol = ticker (英伟达→NVDA, 苹果→AAPL); exchange = NASDAQ/NYSE —— 拿不准就**留空 exchange**, 别猜.

resolvable=false (给一句 reason) 当**任意一条**成立:
  - 加密货币 (BTC/ETH/BNB/HYPE/XMR/ZEC/USDT/USDC…) —— 不是 A/HK/US 股票.
  - 未上市 / 私有公司 (OpenAI / SpaceX / xAI / 字节跳动 / DeepSeek / 智谱AI / MiniMax / Anthropic…).
  - 主上市在韩/台/日/欧等非 A/HK/US 市场 (三星电子 / SK海力士 / 台积电本体). 例外: 指称本身就是其**美股 ADR ticker** 且你确信 (如 TSM), 才按美股给.
  - 行业篮子 / 模糊板块 / 多标的并列 ("国内存储模组厂" / "云厂(MSFT/GOOGL/AMZN)" / "A厂 / B厂 / C厂" / "AI应用层公司").
  - 同名歧义无法确定是哪一只, 或你对规范代码没把握.

铁律: **绝不编造代码**. 拿不准 → resolvable=false. 宁缺毋滥.

输出 JSON: 可追踪 { "resolvable": true, "market": "a", "symbol": "300750", "exchange": "SZSE", "name": "宁德时代", "type": "equity" }
          不可追踪 { "resolvable": false, "reason": "未上市公司" }. 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runner ───────────────────────

export interface SymbolResolverInput {
  /** 待归一的自由文本指称 (来自 signals.related_assets[].ticker 或人工输入). */
  reference: string;
  /** 可选上下文 (信号原文 / rationale), 帮助消歧 (如"中微公司"在半导体语境). */
  context?: string;
}

export async function runSymbolResolver(
  input: SymbolResolverInput,
): Promise<SymbolResolution> {
  // 先带 context 试, 失败再 context-free 重试: 实测个别 reference 配上某些 rationale
  // 会让 DeepSeek structured-output 失败 ("No object generated"), 去掉 context 即恢复.
  // 各变体内再各重试一次 (瞬时抖动).
  const variants = input.context
    ? [buildPrompt(input), buildPrompt({ reference: input.reference })]
    : [buildPrompt(input)];
  let lastErr: unknown;
  for (const content of variants) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await symbolResolver.generate(
          [{ role: "user" as const, content }],
          { output: SymbolResolutionSchema, maxTokens: 400, temperature: 0 },
        );
        if (res?.object) return res.object;
        lastErr = new Error("symbol-resolver returned no object");
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr ?? new Error("symbol-resolver failed");
}

function buildPrompt(input: SymbolResolverInput): string {
  const lines = [`待归一的标的指称: ${input.reference}`];
  const ctx = input.context?.trim();
  if (ctx) lines.push("", `上下文 (帮助消歧):`, `  ${ctx.slice(0, 400)}`);
  lines.push("", `按 schema 输出归一 JSON.`);
  return lines.join("\n");
}
