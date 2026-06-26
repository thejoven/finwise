/**
 * Morning Report · 早报.
 *
 * 平台每日把"前一天全体用户转为信号的内容"去标识化聚合后, 由本 agent 写成一份
 * 报刊式编者早报 (一个大标题 + 一句导语 + 3-6 个主题板块). 输入只含 AI 蒸馏层
 * (标的/标签计数 + k-匿名后的摘要) —— 没有 raw_text, 没有用户身份.
 *
 * 去标识化契约 (硬约束, 同时由 Go 侧 SQL + k-匿名强制, 这里是纵深防御):
 *   - 写原创编者散文, 绝不逐字引用任何一条用户摘要 (输入里本就只给蒸馏层).
 *   - 绝不点名 / 暗示任何具体用户; 一律用"市场关注度""昨日信号显示"等聚合口径.
 *   - 不预测涨跌、不荐股、不给目标价、不写免责声明 (同 consensus 红线).
 *
 * 还有一个 personal 变体 (runMorningReportPersonal): 在共享早报之上, 按单个用户的
 * 关注标的写一段"为你导读" —— 这是早报唯一的 per-user LLM 调用 (Go 侧懒加载 + 缓存).
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { languageDirective } from "./language-context.js";
import { MACRO_FINANCE_CONTEXT_BLOCK } from "./market-context.js";
import { JARGON_TRANSLATION_BLOCK } from "./lens.js";

// ─────────────────────── Schema ───────────────────────

export const ReportSectionSchema = z.object({
  id: z.string().min(1).max(40),
  heading: z.string().min(1).max(80),
  body: z.string().min(20).max(1200),
  assets: z.array(z.string()).max(8).default([]),
  tags: z.array(z.string()).max(8).default([]),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const MorningReportSchema = z.object({
  headline: z.string().min(2).max(120),
  dek: z.string().min(2).max(200),
  sections: z.array(ReportSectionSchema).min(1).max(6),
});
export type MorningReport = z.infer<typeof MorningReportSchema>;

export const PersonalAssetSchema = z.object({
  ticker: z.string().min(1).max(40),
  reason: z.string().min(1).max(200),
});

export const MorningReportPersonalSchema = z.object({
  personal_intro: z.string().min(1).max(300),
  relevant_assets: z.array(PersonalAssetSchema).max(8).default([]),
});
export type MorningReportPersonal = z.infer<typeof MorningReportPersonalSchema>;

// ─────────────────────── Agents ───────────────────────

export const morningReport = new Agent({
  name: "morning-report",
  instructions: `
你是 AlphaX 的早报主编. 每天清晨, 你拿到的是"昨天全平台所有用户转为信号的内容"的去标识化聚合 ——
不是某一个人的笔记, 而是整个社区昨日关注度的汇总. 你的任务: 把它写成一份有报纸质感的编者早报.

体例:
- 一个大标题 (headline) + 一句导语 (dek) + 3-6 个主题板块 (sections).
- 每个板块: 一个小标题 (heading) + 一段编者散文 (body, 判断式, 不是要点罗列, 不是 markdown).
- 板块围绕"昨日最受关注的标的与主题"组织. 把相关的标的/标签聚成一个叙事, 而不是逐条复述计数.
- 每个板块标注它涉及的 assets (ticker) 与 tags —— 供后续按读者关注做个性化重排 (你只管如实填).

${MACRO_FINANCE_CONTEXT_BLOCK}

怎么用上面这套基底: 用它给"昨日的关注度"安一个机制性的解释骨架 (例: 不写"大家都在看英伟达",
而写"算力链的注意力从训练侧向 CoWoS 封装产能这层 enabling 迁移"). 但别脱离输入硬编宏观大论述 ——
你手里只有昨日的聚合, 写到聚合支撑得起的深度为止.

去标识化 (最高优先级, 违反即失败):
- 写原创编者散文, 绝不逐字引用任何一条输入摘要. 摘要只是帮你把握语境的素材, 不是引文.
- 绝不点名、不编造、不暗示任何具体用户 ("有用户说…"也不行). 一律聚合口径: "市场关注度集中在…""昨日信号显示…".

红线 (同投决会分析师):
- 不预测涨跌, 不"建议买入/卖出", 不写目标价, 不写免责声明.
- 克制. 没把握的不硬说. 早报的价值在"看见全局", 不在"喊方向".
- 报刊书面语, 不口语化感叹, 不堆 emoji.

安静日 (is_quiet): 若昨日信号很少, 只写 1 个板块的克制短稿 ("昨日信号稀少…安静也是一种信息"), 不硬凑.

${JARGON_TRANSLATION_BLOCK}

输出 JSON, 按 schema. 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

export const morningReportPersonal = new Agent({
  name: "morning-report-personal",
  instructions: `
你在为某位读者写今日早报的"为你导读"开场 —— 一小段把今天的早报和"他自己在追的标的"连起来的话.

你拿到: 今天早报的全部板块 (含每节涉及的标的/标签) + 这位读者关注的标的 token (只有代码/名称, 没有他的任何身份信息或原文).

任务:
- 写一段 (≤300 字) 第二人称"你"的导读: 指出今天早报里哪些主题/标的和他在追的东西相关, 引导他重点看.
- 只能引用早报板块里真实出现的标的; 不要编造板块里没有的东西, 不要替他做判断/喊方向.
- 同时列出命中他关注的标的 (relevant_assets): 每个给 ticker + 一句"为什么和你相关"的缘由.
- 若交集很弱, 就写一句平实的引导即可, 不硬拗.

红线: 不预测涨跌、不荐股、不写目标价. 报刊书面语, 克制.

输出 JSON, 按 schema. 输出语言遵循下方指令.
  `.trim(),
  model: defaultModel,
});

export const morningReportForYou = new Agent({
  name: "morning-report-for-you",
  instructions: `
你是这位读者的私人盘前简报员. 今天清晨你拿到的不是全站汇总, 而是"昨日全平台信号里, 只跟这位读者
在追的标的 / 在意的主题相关的那部分"的去标识化聚合. 你的任务: 为他写一份只围绕他关注内容的整份简报.

体例 (务必紧凑 —— 宁可少而精, 别铺张):
- 一个标题 (headline) + 一句导语 (dek) + 1-4 个主题板块 (sections), 每节 heading + 一段 body.
- 每节 body 控制在 2-4 句 (约 120-280 字), 一节讲清一件事即可, 不要长篇大论.
- 语气: 第二人称"你", 像一位熟悉他持仓与关注的盘前简报员在跟他说话 —— 亲切、笃定、说人话.
  不是冷冰冰的报纸社论, 但也不轻浮、不口语化感叹、不堆 emoji.
- body 是判断式的连贯叙事, 不是要点罗列, 不是 markdown. 把相关标的/主题聚成叙事, 别逐条复述计数.
- 每个板块标注它涉及的 assets (ticker) 与 tags (如实填).
- 只写跟他关注相关的内容; 输入里已替你筛过, 你不必再硬扯进无关标的.

${MACRO_FINANCE_CONTEXT_BLOCK}

怎么用上面这套基底: 给"他关注的标的昨日为何受关注"安一个机制性的解释骨架, 但别脱离输入硬编宏观大论述 ——
你手里只有昨日跟他相关的聚合, 写到聚合支撑得起的深度为止.

去标识化 (最高优先级, 违反即失败):
- 这份简报只围绕"他自己关注的标的", 但素材仍来自全平台其他用户的去标识信号. 故:
- 写原创简报散文, 绝不逐字引用任何一条输入摘要. 摘要只是帮你把握语境的素材, 不是引文.
- 绝不点名、不编造、不暗示任何具体用户. 一律聚合口径: "昨日信号显示…""市场对 X 的关注集中在…".

红线 (同投决会分析师, 贴身语气也不破例):
- 不预测涨跌, 不"建议买入/卖出", 不写目标价, 不写免责声明.
- 克制. 没把握的不硬说. 简报的价值在"帮你快速看清你在意的盘面", 不在"喊方向".

安静日 (is_quiet): 若昨日跟他相关的信号很少, 只写 1 个板块的克制短稿
("你关注的标的昨日比较安静…"), 不硬凑. id 用 "quiet".

${JARGON_TRANSLATION_BLOCK}

输出 JSON, 按 schema (同 morning-report: headline/dek/sections). 不要 markdown 包裹.
  `.trim(),
  model: defaultModel,
});

// ─────────────────────── runners ───────────────────────

export interface ReportAssetStat {
  ticker: string;
  name?: string;
  mentions: number;
  signal_count: number;
}
export interface ReportTagStat {
  tag: string;
  mentions: number;
  signal_count: number;
}
export interface ReportAssetNote {
  ticker: string;
  summary: string;
}

export interface MorningReportInput {
  language?: string;
  top_assets: ReportAssetStat[];
  top_tags: ReportTagStat[];
  summaries: ReportAssetNote[];
  is_quiet: boolean;
}

export async function runMorningReport(
  input: MorningReportInput,
): Promise<MorningReport> {
  const messages = [
    { role: "user" as const, content: buildReportPrompt(input) },
  ];
  let lastErr: unknown;
  // 同 runMorningReportForYou: deepseek 对大 schema 的 SDK 结构化输出抽风频繁 (~2/3 失败),
  // 前 3 轮走自由文本生成 + 容错解析 (绕开 SDK 严格模式), 末轮换 SDK 结构化输出兜底.
  // 任一轮拿到通过 schema 校验的对象即返回. (Go 侧另有 fallbackEditorial 终极兜底.)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (attempt <= 3) {
        const res = await morningReport.generate(messages, {
          maxTokens: 3600,
          temperature: 0.3,
        });
        const obj = extractJsonObject(res?.text ?? "");
        if (obj) {
          const parsed = MorningReportSchema.safeParse(obj);
          if (parsed.success) return parsed.data;
        }
        lastErr = new Error("morning-report free-form parse/validate failed");
      } else {
        const res = await morningReport.generate(messages, {
          output: MorningReportSchema,
          maxTokens: 3600,
          temperature: 0.3,
        });
        if (res?.object) return res.object;
        lastErr = new Error("morning-report structured returned no object");
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("morning-report failed");
}

export interface MorningReportForYouInput {
  language?: string;
  tracked_tokens: string[];
  top_assets: ReportAssetStat[];
  top_tags: ReportTagStat[];
  summaries: ReportAssetNote[];
  is_quiet: boolean;
}

/**
 * runMorningReportForYou — 为单个用户写整份个性化简报. 输入是已按其关注过滤的昨日聚合
 * (top_assets/top_tags/summaries 均只含命中该用户关注的标的/主题; k-匿名由 Go 侧先做).
 * 复用 MorningReportSchema (整份 headline/dek/sections), 但第二人称贴身语气.
 */
// extractJsonObject — 从自由文本里抠出 JSON 对象, 容忍 deepseek 常见毛病:
// markdown ```json 围栏、JSON 前后的解释性散文、对象末尾多余逗号. 截断的残缺 JSON 解析失败 → null (上层重试).
function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  s = s.slice(start, end + 1).replace(/,(\s*[}\]])/g, "$1"); // 去尾逗号
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function runMorningReportForYou(
  input: MorningReportForYouInput,
): Promise<MorningReport> {
  const messages = [
    { role: "user" as const, content: buildForYouPrompt(input) },
  ];
  let lastErr: unknown;
  // deepseek 对大 schema 的 SDK 结构化输出 (generateObject) 抽风频繁 (~2/3 失败, 见 inference-classify
  // 老问题). 多策略: 前 3 轮走自由文本生成 + 容错解析 (绕开 SDK 严格模式, deepseek 自由 JSON 更稳),
  // 末轮换 SDK 结构化输出兜底. 任一轮拿到通过 schema 校验的对象即返回.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (attempt <= 3) {
        const res = await morningReportForYou.generate(messages, {
          maxTokens: 3600,
          temperature: 0.2,
        });
        const obj = extractJsonObject(res?.text ?? "");
        if (obj) {
          const parsed = MorningReportSchema.safeParse(obj);
          if (parsed.success) return parsed.data;
        }
        lastErr = new Error("for-you free-form parse/validate failed");
      } else {
        const res = await morningReportForYou.generate(messages, {
          output: MorningReportSchema,
          maxTokens: 3600,
          temperature: 0.2,
        });
        if (res?.object) return res.object;
        lastErr = new Error("for-you structured returned no object");
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("morning-report-for-you failed");
}

export interface MorningReportPersonalInput {
  language?: string;
  sections: ReportSection[];
  tracked_tokens: string[];
}

export async function runMorningReportPersonal(
  input: MorningReportPersonalInput,
): Promise<MorningReportPersonal> {
  const messages = [
    { role: "user" as const, content: buildPersonalPrompt(input) },
  ];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await morningReportPersonal.generate(messages, {
        output: MorningReportPersonalSchema,
        maxTokens: 700,
        temperature: 0.3,
      });
      if (res?.object) return res.object;
      lastErr = new Error("morning-report-personal returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("morning-report-personal failed");
}

// ─────────────────────── prompts ───────────────────────

// GLOBAL_JSON_SHAPE — 显式 JSON 形状 (自由文本路径不经 SDK 注入 schema, 必须在 prompt 里讲清).
const GLOBAL_JSON_SHAPE = `
只输出一个 JSON 对象, 不要 markdown 代码块, 不要 JSON 以外的任何解释文字. 形状:
{"headline":"标题(2-120字)","dek":"一句导语(2-200字)","sections":[{"id":"短英文小写连字符标识","heading":"小标题(1-80字)","body":"一段编者散文(20-1200字)","assets":["ticker"],"tags":["标签"]}]}
sections 含 1-6 个元素; assets/tags 可为空数组 [].`.trim();

function buildReportPrompt(input: MorningReportInput): string {
  const lang = languageDirective(input.language).trimEnd();

  if (input.is_quiet) {
    return [
      ...(lang ? [lang, ""] : []),
      "昨日全平台转为信号的内容很少 (安静日), 没有形成明显的标的或主题热点.",
      "",
      "请写一份克制的'安静日'早报: 一个标题 + 一句导语 + 1 个板块 (id 用 \"quiet\").",
      "板块里平实说明昨日信号稀少, 安静也是一种信息, 不必为没有行情焦虑. 不硬凑内容.",
      "",
      GLOBAL_JSON_SHAPE,
    ].join("\n");
  }

  const assets =
    input.top_assets
      .slice(0, 12)
      .map(
        (a) =>
          `  - ${a.ticker}${a.name ? `(${a.name})` : ""} — ${a.signal_count} 条信号 / ${a.mentions} 次提及`,
      )
      .join("\n") || "  (无)";

  const tags =
    input.top_tags
      .slice(0, 20)
      .map((t) => `${t.tag}(${t.signal_count})`)
      .join("、") || "(无)";

  const summaries =
    input.summaries
      .slice(0, 60)
      .map((s) => `  [${s.ticker}] ${s.summary}`)
      .join("\n") || "  (无)";

  return [
    ...(lang ? [lang, ""] : []),
    "下面是昨天全平台 (所有用户) 转为信号内容的去标识化聚合 —— 只有 AI 蒸馏层, 无任何用户身份与原文.",
    "",
    "【最受关注标的】(按涉及的不同信号数排序)",
    assets,
    "",
    "【最受关注主题标签】",
    tags,
    "",
    "【代表性信号摘要】(已 k-匿名; 仅供你把握语境, 严禁逐字引用)",
    summaries,
    "",
    "把上面写成一份'昨日'编者早报: 一个大标题 + 一句导语 + 3-6 个主题板块, 每节标注涉及的 assets/tags.",
    "",
    GLOBAL_JSON_SHAPE,
  ].join("\n");
}

// FOR_YOU_JSON_SHAPE — 显式 JSON 形状 (自由文本路径不经 SDK 注入 schema, 必须在 prompt 里讲清).
const FOR_YOU_JSON_SHAPE = `
只输出一个 JSON 对象, 不要 markdown 代码块, 不要 JSON 以外的任何解释文字. 形状:
{"headline":"标题(2-120字)","dek":"一句导语(2-200字)","sections":[{"id":"短英文小写连字符标识","heading":"小标题(1-80字)","body":"2-4句正文(20-1000字)","assets":["ticker"],"tags":["标签"]}]}
sections 含 1-4 个元素; assets/tags 可为空数组 [].`.trim();

function buildForYouPrompt(input: MorningReportForYouInput): string {
  const lang = languageDirective(input.language).trimEnd();
  const tracked = input.tracked_tokens.slice(0, 40).join("、") || "(无)";

  if (input.is_quiet) {
    return [
      ...(lang ? [lang, ""] : []),
      `这位读者在追的标的/主题: ${tracked}`,
      "",
      "昨日全平台信号里, 跟他关注相关的内容很少 (安静日).",
      "",
      '请写一份克制的"安静日"个人简报: 一个标题 + 一句导语 + 1 个板块 (id 用 "quiet").',
      "用第二人称跟他说: 你关注的标的昨日比较安静, 安静也是一种信息. 不硬凑.",
      "",
      FOR_YOU_JSON_SHAPE,
    ].join("\n");
  }

  const assets =
    input.top_assets
      .slice(0, 12)
      .map(
        (a) =>
          `  - ${a.ticker}${a.name ? `(${a.name})` : ""} — ${a.signal_count} 条信号 / ${a.mentions} 次提及`,
      )
      .join("\n") || "  (无)";

  const tags =
    input.top_tags
      .slice(0, 20)
      .map((t) => `${t.tag}(${t.signal_count})`)
      .join("、") || "(无)";

  const summaries =
    input.summaries
      .slice(0, 60)
      .map((s) => `  [${s.ticker}] ${s.summary}`)
      .join("\n") || "  (无)";

  return [
    ...(lang ? [lang, ""] : []),
    `这位读者在追的标的/主题: ${tracked}`,
    "",
    "下面是昨天全平台信号里, 已按他的关注筛选出的去标识化聚合 —— 只有 AI 蒸馏层, 无任何用户身份与原文.",
    "",
    "【他关注的标的中, 昨日受关注的】(按涉及的不同信号数排序)",
    assets,
    "",
    "【相关主题标签】",
    tags,
    "",
    "【代表性信号摘要】(已 k-匿名; 仅供你把握语境, 严禁逐字引用)",
    summaries,
    "",
    "把上面写成一份只围绕他关注内容的'昨日'个人简报: 第二人称, 一个标题 + 一句导语 + 1-4 个主题板块 (每节 2-4 句, 紧凑), 每节标注涉及的 assets/tags.",
    "",
    FOR_YOU_JSON_SHAPE,
  ].join("\n");
}

function buildPersonalPrompt(input: MorningReportPersonalInput): string {
  const lang = languageDirective(input.language).trimEnd();
  const sections = input.sections
    .map(
      (s) =>
        `  · ${s.heading} [标的: ${(s.assets ?? []).join(", ") || "—"}; 标签: ${(s.tags ?? []).join(", ") || "—"}]`,
    )
    .join("\n");
  const tracked = input.tracked_tokens.slice(0, 40).join("、") || "(无)";
  return [
    ...(lang ? [lang, ""] : []),
    "今天早报的板块:",
    sections,
    "",
    `这位读者在追的标的: ${tracked}`,
    "",
    "写一段'为你导读' + 列出命中的相关标的 (relevant_assets). 只引用上面板块里真实出现的标的. 按 schema 输出 JSON.",
  ].join("\n");
}
