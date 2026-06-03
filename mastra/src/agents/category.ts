/**
 * 分类上下文块 — 注入到各 LLM agent (analyst / socratic / narrator / attention)
 * 的 user prompt 顶部, 让推理"根据分类"走.
 *
 * 数据来自用户在分类上写的「分析指引」(projects.guidance) + 分类名:
 *   - signal-inference: 经 signal.captured payload (project_name / project_guidance)
 *   - socratic / narrator / attention: 经 Go SessionView (同名字段)
 *
 * name / guidance 任一为空就只出现有的部分; 两者都空返回 "" → prompt 不变, 行为同今天.
 */
export function categoryContextBlock(name?: string | null, guidance?: string | null): string {
  const n = (name ?? "").trim();
  const g = (guidance ?? "").trim();
  if (!n && !g) return "";
  const lines = ["【分类上下文】"];
  if (n) lines.push(`这条属于用户的「${n}」分类。`);
  if (g) lines.push(`该分类的分析指引(请在推理时遵循,但不要逐字复述):\n${g}`);
  return lines.join("\n");
}
