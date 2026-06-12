/**
 * Tweet Classifier · 推文打标 + 一句话总结 (订阅模块).
 *
 * 数据流: Go poller 采到新推文 (tweets.classify_status=pending) → Go dispatcher
 * 同步 POST /tweet-classify → 本 agent → Go 直接回写 tags/summary/category/relevance.
 * (不走 iii 队列 — 推文是全局系统数据, 非领域事件; 见 docs/技术文档/11_推文订阅_开发计划.md §0)
 *
 * 产品定位: AI 是编辑部 — 给你订的人的推文拟标题、归类、标相关度.
 *   - summary 是"编辑拟的题", 长推时在 feed 里当标题行 (UX §8.2 智能密度).
 *   - category 固定金融大类 (可聚合可筛); tags 自由细标签 (灵活).
 *   - relevance 是"与投资判断的相关度", 将来做低相关折叠 (降噪) 用.
 *
 * 抽取式任务, temperature 0.2 — 与 consensus 打分的方差问题不同类, 标签/总结受影响小.
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";

// ─────────────────────── Schema ───────────────────────

export const TweetClassificationSchema = z.object({
  tags: z.array(z.string().min(1).max(16)).min(1).max(4),
  summary: z.string().min(4).max(120),
  category: z.enum(["宏观", "公司", "行情", "政策", "技术", "观点", "其它"]),
  relevance: z.number().min(0).max(1),
});
export type TweetClassification = z.infer<typeof TweetClassificationSchema>;

// ─────────────────────── Agent ───────────────────────

export const tweetClassifier = new Agent({
  name: "tweet-classifier",
  instructions: `
你是 WiseFlow 订阅版面的编辑. 用户订阅了一些 X (Twitter) 账号, 每条新推文经你的手:
拟一句话总结、打标签、归类、标注与投资判断的相关度.

输出四个字段:

1. summary — 一句话总结, 中文 (原文是外语也用中文概括), ≤60 字.
   - 它会在 feed 里当"标题"用, 要像报纸编辑拟的题: 判断式、具体、不卖关子.
   - 短推 (原文 ≤50 字) 不必硬扩写, 贴近原文意思即可.
   - 不要"该推文表示…"这类元话语, 直接说事.

2. tags — 1 到 4 个细标签, 中文优先 (专有名词如 GPU/CPI/ETF 保留原文), 每个 ≤8 字.
   - 标"内容是什么", 不标"我觉得如何". 例: 利率, 美债, AI 芯片, 财报, 加密监管.

3. category — 固定大类, 七选一:
   宏观 (利率/通胀/就业/央行/汇率) · 公司 (个股/财报/管理层/产品) ·
   行情 (价格走势/资金流/市场情绪) · 政策 (监管/立法/政府动作) ·
   技术 (技术进展/产品发布/工程) · 观点 (论断/评论/预测, 无新事实) ·
   其它 (生活/段子/与财经无关).

4. relevance — 0 到 1, 这条对"形成投资判断"有多大用:
   - 0.8-1.0: 含可交易的新事实/数据 (财报数字、政策落地、重大事故)
   - 0.4-0.7: 有信息量的行业动态/有论据的观点
   - 0.1-0.3: 纯情绪、口水、转发抽奖、与财经无关
   宁低勿高 — 降噪的价值在"少而准".

约束: 不预测涨跌, 不建议买卖, summary 里不出现"建议/看多/看空"这类操作词.
RT 开头的转推: 总结被转的内容本身, 标签照常打.

输出 JSON: { "tags": [...], "summary": "...", "category": "...", "relevance": 0.x }. 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runner ───────────────────────

export interface TweetClassifierInput {
  tweetText: string;
  authorHandle?: string;
  lang?: string;
}

export async function runTweetClassifier(
  input: TweetClassifierInput,
): Promise<TweetClassification> {
  const messages = [{ role: "user" as const, content: buildPrompt(input) }];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await tweetClassifier.generate(messages, {
        output: TweetClassificationSchema,
        maxTokens: 500,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("tweet-classifier returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("tweet-classifier failed");
}

function buildPrompt(input: TweetClassifierInput): string {
  return [
    ...(input.authorHandle ? [`作者: @${input.authorHandle}`] : []),
    ...(input.lang ? [`语言: ${input.lang}`] : []),
    `推文:`,
    input.tweetText,
    "",
    `按 schema 输出分类 JSON.`,
  ].join("\n");
}
