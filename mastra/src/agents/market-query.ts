/**
 * market-query — 把(多为中文的)信号压成 1-3 条**英文**搜索词, 用于 Polymarket 检索.
 *
 * 为什么需要它: Polymarket 的市场都是英文标题, 直接拿中文信号原文打 /public-search
 * 基本命中不了. 这里用主模型 (deepseek-chat) 抽出可搜索的英文实体/事件词
 * (人名 / 资产 / ticker / 事件), 再交给 polymarket.ts 去搜.
 *
 * 设计准则:
 *   - 弱信号 (没有具体可下注事件) → 返回 []; 调用方据此跳过 Polymarket, 不硬搜.
 *   - 失败 (LLM 抛错 / schema 不过) → 返回 []; 搜索是增强材料, 不该阻断主流程.
 *   - 输出严格英文短语, 贴近预测市场的措辞 ("Fed rate cut", "Bitcoin 150k", "Trump 2024").
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";

export const MarketQuerySchema = z.object({
  /** 0..3 条英文搜索短语; 弱信号给空数组. */
  queries: z.array(z.string().min(1).max(60)).max(3),
});

const INSTRUCTIONS = `You convert a financial / market / news signal (usually written in Chinese) into SHORT ENGLISH search queries for finding related prediction markets on Polymarket.

Rules:
- Output 1 to 3 queries, each 2-5 words, in ENGLISH only.
- Each query must name a concrete, bettable entity or event: a person, asset, ticker, company, election, macro event, sports/crypto outcome, etc.
- Phrase them the way prediction markets are titled, e.g. "Fed rate cut June", "Bitcoin 150k 2026", "Trump cabinet", "Nvidia largest company".
- Drop vague commentary, emotions, and analysis — only the searchable subject.
- If the signal has NO concrete bettable subject (pure opinion / too vague), return an empty array.
- Never output Chinese. Never output punctuation-heavy strings or full sentences.`;

const marketQueryAgent = new Agent({
  name: "market-query",
  instructions: INSTRUCTIONS,
  model: defaultModel,
});

/**
 * extractMarketQueries — 信号文本 → 英文搜索短语数组 (最多 3 条).
 * 失败 / 弱信号 / 空输入一律返回 [], 调用方静默跳过 Polymarket.
 */
export async function extractMarketQueries(signalText: string): Promise<string[]> {
  const text = (signalText ?? "").trim();
  if (!text) return [];
  const messages = [
    { role: "user" as const, content: text.slice(0, 1200) },
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await marketQueryAgent.generate(messages, {
        output: MarketQuerySchema,
        maxTokens: 200,
        temperature: 0.2,
      });
      const queries = res?.object?.queries ?? [];
      return queries.map((q) => q.trim()).filter((q) => q.length > 0).slice(0, 3);
    } catch {
      // 下一次 retry; 第二次仍失败 → 落到 return []
    }
  }
  return [];
}
