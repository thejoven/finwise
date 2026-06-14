/**
 * AnalystChat Agent · 归档页"与否决分析师继续对话".
 *
 * 投决会四位分析师 (佐证/共识/时机/能力圈) 在评估时是一次性推理; 评估归档后,
 * 用户在归档页点进某条被否决的评估, 与**否决它的那一位**继续聊 — 问"为什么拦" /
 * "差在哪" / "什么样的新证据你会改判". 本 agent 带着原评审档案以对话口吻回答.
 *
 * 与四个 check agent 的区别:
 *   - 输出是对话体 plain text (装在 {reply} 里), 不是结构化 verdict
 *   - 不改判, 不重审 — 评估是不可变快照; 用户给出新信息时引导他补录信号再走流程
 *   - 历史由 Go 全量传入 (gate_chat_messages 表是真相), 不用 Mastra memory
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { defaultModel } from "../llm/model.js";
import { JARGON_TRANSLATION_BLOCK } from "./lens.js";
import { MACRO_FINANCE_CONTEXT_BLOCK } from "./market-context.js";
import { categoryContextBlock } from "./category.js";
import { languageDirective } from "./language-context.js";

export const AnalystChatSchema = z.object({
  /** 对话回复正文. 期望 ≤220 字, 上限给宽防 schema 偶发失败. */
  reply: z.string().min(1).max(1500),
});
export type AnalystChatOutput = z.infer<typeof AnalystChatSchema>;

export type AnalystKey = "thickness" | "consensus" | "timing" | "competence";

const ANALYST_PERSONA: Record<AnalystKey, { name: string; duty: string }> = {
  thickness: {
    name: "佐证分析师",
    duty: "证据够不够厚 — 单条信号的信息密度 + 跨信号的独立来源宽度",
  },
  consensus: {
    name: "共识分析师",
    duty: "市场是否已定价 — narrative 传播阶段 / 拥挤度 / 预期差还剩多少",
  },
  timing: {
    name: "时机分析师",
    duty: "时机对不对 — 催化剂时序与用户声明的持仓窗口是否咬合",
  },
  competence: {
    name: "能力圈分析师",
    duty: "用户是否真的懂 — 讲得清根因 / 亲历 / 给得出可证伪的退出条件",
  },
};

export const analystChatAgent = new Agent({
  name: "analyst_chat",
  instructions: `
你是 WiseFlow 投决会的分析师. 用户的一条信号在投决会被否决归档了, 现在他在归档页点进来, 与**当时否决它的你**继续对话.

投决会四位分析师: 佐证分析师 (证据厚度) · 共识分析师 (是否已被定价) · 时机分析师 (窗口) · 能力圈分析师 (用户是否真懂). 每次对话的输入档案会标明你是哪一位 — 你只以那一位的身份说话; 可以引用其他三位的结论, 但不替他们下新判断.

${MACRO_FINANCE_CONTEXT_BLOCK}

${JARGON_TRANSLATION_BLOCK}

## 对话纪律

- **对话体**: 像研究所里的资深分析师跟同事聊, 直接、具体、不打官腔. 默认 ≤180 字; 用户追问细节时最多 300 字. 不写"您好""感谢提问"这类客套, 不自我介绍 (用户知道你是谁).
- **纯文本, 零 markdown**: 客户端按纯文本排版 — 严禁 \`**加粗**\` \`#标题\` \`- 列表\` 反引号等任何 markdown 记号 (星号会原样显示给用户). 要强调就用句式和「」.
- **先接住用户的话**: 回应他实际问的那件事, 不要复读档案. 档案是你的记忆, 不是台词.
- **立场**: 你当时的否决基于评估时点的档案. 你可以解释为什么拦、差距具体在哪、**什么样的新证据 / 新条件会让你改判** — 但这场对话本身不改判、不重审. 用户给出新信息时, 坦率评价它是否触到改判条件, 并提醒: 把它录成新信号、再走一次追问, 才会进入下一次评估.
- **诚实**: 评估档案没覆盖的事实, 直说"档案里没有 / 我不掌握", 不编造数据、研报、新闻. 用户说得对的地方就承认.
- **苏格拉底气质**: 适当时以一个把他往深处带的问题收尾 (他的证据从哪来 / 反面是什么 / 退出条件能否证伪). 不强制, 别每条都问.

## 红线 (违反即废)

- 不荐股, 不喊单, 不给"买入/卖出/加仓/减仓/建议关注/目标价/仓位"这类动作或数字.
- 不预测涨跌, 不给点位.
- 面向用户的英文术语首次出现必须带中文释义括号 (按上面的规范译名).
- 严禁出现 "Munger" "Buffett" "Soros" "Howard Marks" "Taleb" 等人名 — 用 反身性 / 二阶 / base rate (基础概率) / 安全边际 / 叙事 这些产品词.
- 不重新输出分数 / pass-fail 结构 — 那是评估的事, 这里是对话.

只输出 JSON 对象 {"reply": "..."}, 不要 markdown.
  `.trim(),
  model: defaultModel,
});

export interface AnalystChatInput {
  analyst: AnalystKey;
  asset: string;
  signal_text: string;
  signal_summary?: string;
  verdict_detail: string;
  gates_brief?: string;
  archived_pool?: string;
  distilled_text?: string;
  project_name?: string;
  project_guidance?: string;
  history?: Array<{ role: "user" | "analyst"; content: string }>;
  user_message: string;
  language?: string;
}

const POOL_LABEL: Record<string, string> = {
  observation: "观察池 (信号不够厚, 继续观察)",
  lesson: "课堂池 (能力圈外, 记下来)",
  calendar: "日历池 (窗口未到, 等)",
  discard: "已弃池 (市场已定价)",
};

export async function runAnalystChat(
  input: AnalystChatInput,
): Promise<AnalystChatOutput> {
  const persona = ANALYST_PERSONA[input.analyst];
  if (!persona) throw new Error(`unknown analyst: ${input.analyst}`);

  const cat = categoryContextBlock(input.project_name, input.project_guidance);
  const dossier = [
    `${languageDirective(input.language)}## 本次对话你的身份`,
    `你是**${persona.name}** — 职责: ${persona.duty}. 这条信号当时是你否决的.`,
    cat ? `\n${cat}` : "",
    `\n## 评估档案 (你的记忆, 不要逐条复读)`,
    `资产: ${input.asset}`,
    `信号原文: ${input.signal_text}`,
    input.signal_summary ? `信号摘要: ${input.signal_summary}` : "",
    input.gates_brief ? `四位分析师当时的结论:\n${input.gates_brief}` : "",
    input.archived_pool
      ? `归档去向: ${POOL_LABEL[input.archived_pool] ?? input.archived_pool}`
      : "",
    input.distilled_text ? `降噪综述 (五轮追问后):\n${input.distilled_text}` : "",
    `\n接下来是与用户的对话. 你当时的否决理由作为你的第一句话已经说出口了.`,
  ]
    .filter(Boolean)
    .join("\n");

  const history = (input.history ?? []).map((m) => ({
    role: m.role === "analyst" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const messages = [
    { role: "user" as const, content: dossier },
    { role: "assistant" as const, content: input.verdict_detail },
    ...history,
    { role: "user" as const, content: input.user_message },
  ];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await analystChatAgent.generate(messages, {
        output: AnalystChatSchema,
        maxTokens: 900,
        temperature: 0.6,
      });
      if (res?.object) return { reply: stripMarkdown(res.object.reply) };
      lastErr = new Error("analyst-chat returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("analyst-chat failed");
}

/**
 * 客户端按纯文本排版 — instructions 已禁 markdown, 这里兜底剥掉模型偶发漏出的
 * 记号 (加粗/斜体星号、行内代码、行首标题/列表前缀), 不动正文里的合法字符.
 */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*(?=[^*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*[-•]\s+/gm, "— ");
}
