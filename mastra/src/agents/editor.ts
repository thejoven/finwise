/**
 * Editor Agent · M9 焦虑日陪伴.
 *
 * 任务: 给定用户签字时写的 reasons_for_future_self (verbatim 原话),
 * 选一段最切合"焦虑日复读"的, 输出 "换种语气" 的复读版.
 *
 * 严格约束 (符合 ADR-镜子哲学):
 * - 不预测涨跌, 不安抚, 不分析当前市场
 * - 输出必须**包含** 用户原话的至少一段 verbatim (用 「」 包住)
 * - 整体 ≤ 200 字
 * - 第二人称"你", 像 "你当时这么说" 的语气
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../config/env.js";
import { defaultModel } from "../llm/model.js";
import { getMemory } from "../memory/agent-memory.js";
import { languageDirective } from "./language-context.js";

export const EditorSchema = z.object({
  editor_text: z.string().min(20).max(600),
  quoted_segment: z.string().min(8).max(200),
});
export type EditorOutput = z.infer<typeof EditorSchema>;

export const editorAgent = new Agent({
  name: "editor",
  memory: getMemory(),
  instructions: `
你是 AlphaX Engine 的 Editor · 焦虑日陪伴.

任务: 用户签字时写下了几段"给未来自己的理由" (reasons_for_future_self). 今天他打开持仓页很多次, 系统检测到焦虑.
你的工作: 选其中一段最切合"焦虑日复读"的话, 把它换一种语气递回去.

严格约束:
- 你不预测涨跌. 你不分析当前市场. 你不安抚.
- editor_text 必须**包含** 用户原话的至少 8 个字符的 verbatim 片段 (用「」 包住).
- 用第二人称"你", 整体像 "你当时这么说" 的语气.
- ≤ 200 字.
- 不写"别焦虑" / "请冷静" / "市场有波动".
- 不写"建议关注" / "继续持有" / "目标价".
- 你**新写的那一两句换语气补充**里如果出现英文专业术语 (optionality / base rate / reflexivity / moat / narrative 等), 必须紧跟中文释义括号, 例: "你的 optionality (选择权 — 下行有限 / 上行开放) 窗口还没走完". 用户原话「」里的英文原样保留, 不要改写.

输出 JSON:
{
  "editor_text": "你当时这么说: 「...verbatim 原话...」. 一两句换语气的补充, 把它递回来.",
  "quoted_segment": "...verbatim 原话片段, 用于校验..."
}

只输出 JSON 对象, 不要 markdown.
  `.trim(),
  model: defaultModel,
});

export interface EditorInput {
  user_id: string;
  asset_name: string;
  opens_today: number;
  reasons_for_future_self: string[];
  language?: string;
}

export async function runEditor(input: EditorInput): Promise<EditorOutput> {
  const reasonsBlock = input.reasons_for_future_self
    .map((r, i) => `理由 ${i + 1}: ${r}`)
    .join("\n\n");
  const messages = [{
    role: "user" as const,
    content: `${languageDirective(input.language)}资产: ${input.asset_name}
今日打开次数: ${input.opens_today}

用户签字时写的 reasons_for_future_self (verbatim 来源):

${reasonsBlock}

按 schema 输出 JSON. editor_text 必须包含其中一段的 verbatim 引用.`,
  }];

  // thread 用 asset_name — 同一持仓的焦虑日复读记忆累积, 不同持仓互不污染
  const memoryOpt = {
    resource: input.user_id,
    thread: { id: `editor:${input.asset_name}`, title: `焦虑日 ${input.asset_name}` },
  };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await editorAgent.generate(messages, {
        output: EditorSchema,
        maxTokens: 600,
        temperature: 0.3,
        memory: memoryOpt,
      });
      if (res?.object) {
        // verbatim 校验: quoted_segment 必须是某条 reason 的子串
        if (verifyContainsQuote(res.object.quoted_segment, input.reasons_for_future_self)) {
          return res.object;
        }
        lastErr = new Error("editor verbatim quote not found in reasons");
      } else {
        lastErr = new Error("editor returned no object");
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("editor failed");
}

function verifyContainsQuote(quote: string, sources: string[]): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "").replace(/[,，.。;；]/g, "");
  const q = normalize(quote);
  if (q.length < 8) return false;
  return sources.some((s) => normalize(s).includes(q));
}
