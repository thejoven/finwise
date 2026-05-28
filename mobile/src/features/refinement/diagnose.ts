/**
 * 客户端 diagnosis 启发式.
 *
 * Phase 2 v1: 完全客户端计算, 不调 LLM. 启发式规则:
 *   - single: 选了 is_distractor=true → distractor; 否则 correct
 *   - multi:  选了任一 distractor → distractor;
 *             否则若漏选了 is_required=true → partial_miss; 否则 correct
 *   - ordering: 暂不严格判定 (没"标准顺序"), 总是 correct.
 *               Phase 2 v2 通过 Mastra 评估顺序合理性时升级.
 *   - open:   open_text 修剪后 < 20 字 → weak; 否则 correct
 *   - commitment_setup: 不诊断对错 (这是承诺要素采集, 不是测验).
 *                       action + duration 都选了 + open_text ≥ 20 字 → correct, 否则 weak.
 *
 * 用户自填 (is_user_input=true) 的选项: 当作"用户表达自己的角度", 不算 distractor.
 *   open_text 修剪后 < 20 字 → weak (鼓励写完整一点); 否则 correct.
 *
 * note 字段留空 — Mastra Diagnosis Agent 在 v2 才异步填进去.
 */

import type { Diagnosis, QuestionKindT, QuestionOption, UserAnswer } from "@/core/api/refinement";

const WEAK_MIN_CHARS = 20;

export function computeDiagnosis(args: {
  kind: QuestionKindT;
  options?: QuestionOption[];
  answer: UserAnswer;
}): Diagnosis {
  const { kind, options = [], answer } = args;
  const chosen = new Set(answer.choice_ids ?? []);
  const userOpt = options.find((o) => o.is_user_input);
  const pickedUserInput = userOpt ? chosen.has(userOpt.id) : false;
  const userText = (answer.open_text ?? "").trim();

  if (kind === "single") {
    if (pickedUserInput) {
      return userText.length < WEAK_MIN_CHARS ? { kind: "weak" } : { kind: "correct" };
    }
    const picked = options.find((o) => chosen.has(o.id));
    if (picked?.is_distractor) return { kind: "distractor" };
    return { kind: "correct" };
  }

  if (kind === "multi") {
    const pickedDistractor = options.some((o) => o.is_distractor && chosen.has(o.id));
    if (pickedDistractor) return { kind: "distractor" };
    if (pickedUserInput && userText.length < WEAK_MIN_CHARS) return { kind: "weak" };
    const missingRequired = options.some((o) => o.is_required && !chosen.has(o.id));
    if (missingRequired) return { kind: "partial_miss" };
    return { kind: "correct" };
  }

  if (kind === "ordering") {
    if (pickedUserInput && userText.length < WEAK_MIN_CHARS) return { kind: "weak" };
    return { kind: "correct" }; // v1 不严判, 见上注释
  }

  if (kind === "commitment_setup") {
    // 三件齐: action + duration + open_text. 任一缺则 weak (鼓励填齐).
    const hasAction = options.some((o) => o.group === "action" && chosen.has(o.id));
    const hasDuration = options.some((o) => o.group === "duration" && chosen.has(o.id));
    if (!hasAction || !hasDuration) return { kind: "weak" };
    if (userText.length < WEAK_MIN_CHARS) return { kind: "weak" };
    return { kind: "correct" };
  }

  // open
  if (userText.length < WEAK_MIN_CHARS) return { kind: "weak" };
  return { kind: "correct" };
}
