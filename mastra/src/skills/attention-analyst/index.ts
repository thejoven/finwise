/**
 * Attention Analyst Skill · 五轮追问完成后的注意力诊断.
 *
 * 文件结构 (同 analyst skill 模式):
 *   instructions.md  — 任务定义 + 4 维评分锚 + 输出语言风格
 *   strict-output.md — JSON 格式约束
 *   examples/*.md    — 4 个 case (balanced/rushed/deep-narrow/broad-shallow)
 *   index.ts         — Agent + zod schema + runner
 *
 * 触发: refinement.completed event → consumer 拉 session view + signal tags
 *       → runAttentionAnalyst → POST /v1/internal/attention 写回 server.
 *
 * 增强: 加 case 在 examples/ 下加 markdown, 不动 TS.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../../config/env.js";
import { defaultModel } from "../../llm/model.js";
import { categoryContextBlock } from "../../agents/category.js";

// ──────────────────── schema ────────────────────

export const AttentionSchema = z.object({
  focus_score: z.number().int().min(0).max(100),
  depth_score: z.number().int().min(0).max(100),
  breadth_score: z.number().int().min(0).max(100),
  execution_score: z.number().int().min(0).max(100),
  insight: z.string().min(10).max(200),
  blindspot: z.string().min(10).max(120),
});
export type Attention = z.infer<typeof AttentionSchema>;

// ──────────────────── prompt assembly ────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadMd(rel: string): string {
  return readFileSync(join(__dirname, rel), "utf8");
}

function loadExamples(): string {
  const dir = join(__dirname, "examples");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n\n---\n\n");
}

function buildInstructions(): string {
  return [
    loadMd("instructions.md"),
    "---",
    "## Few-shot 参考",
    loadExamples(),
    "---",
    loadMd("strict-output.md"),
  ].join("\n\n").trim();
}

// ──────────────────── Agent ────────────────────

export const attentionAnalyst = new Agent({
  name: "attention_analyst",
  instructions: buildInstructions(),
  model: defaultModel,
});

// ──────────────────── runner ────────────────────

export interface AttentionInput {
  signalSummary: string;
  signalTags: string[];
  projectName?: string;
  projectGuidance?: string;
  rounds: Array<{
    round: number;
    kind: string;
    question_text: string;
    user_choice_ids: string[];
    user_open_text?: string;
    diagnosis_kind: string;
    diagnosis_note?: string;
    time_ms: number;
  }>;
}

/**
 * runAttentionAnalyst — schema 校验 + 1 retry. 失败 → throw, consumer 由 NATS
 * maxDeliver=3 兜底进 DLQ.
 */
export async function runAttentionAnalyst(input: AttentionInput): Promise<Attention> {
  const userContent = buildPrompt(input);
  const messages = [{ role: "user" as const, content: userContent }];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await attentionAnalyst.generate(messages, {
        output: AttentionSchema,
        maxTokens: config.analyst.maxTokens,
        temperature: 0.3,
      });
      if (res?.object) return res.object;
      lastErr = new Error("attention-analyst returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("attention-analyst failed");
}

function buildPrompt(input: AttentionInput): string {
  const rounds = input.rounds
    .map((r) => {
      const choice = r.user_choice_ids.length > 0 ? r.user_choice_ids.join(",") : "(空)";
      const open = r.user_open_text ? `; 写: "${r.user_open_text.slice(0, 200)}"` : "";
      return `  R${r.round} ${r.kind} ${r.time_ms}ms · ${r.diagnosis_kind}; 选: ${choice}${open}`;
    })
    .join("\n");

  const cat = categoryContextBlock(input.projectName, input.projectGuidance);
  return [
    ...(cat ? [cat, ""] : []),
    `信号 (本次追问基于这条信号):`,
    `  summary: ${input.signalSummary}`,
    `  tags: ${input.signalTags.join(", ") || "(无)"}`,
    "",
    `五轮答题:`,
    rounds,
    "",
    "请按 schema 输出 JSON. 4 个分数为 0-100 整数, insight ≤200 字, blindspot ≤120 字. 不要 markdown.",
  ].join("\n");
}
