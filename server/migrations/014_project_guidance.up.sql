-- 014: projects.guidance — 用户给某个分类写的"分析指引".
--
-- 喂给 LLM (推演员 analyst / 苏格拉底 socratic / 叙事者 narrator / attention) 作为
-- 该分类下推理的偏好与重点, 例如 "泡泡玛特: 关注渠道动销与海外扩张, 警惕情绪溢价".
--
-- 可空; 空 / 未分类时 LLM 行为与今天完全一致 (prompt 不注入分类块).
-- 真相仍只挂在 projects 上, 经 signal.captured payload + refinement SessionView
-- 流到 mastra, 不在 signals / refinement / gate / commitment 落列.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS guidance TEXT;
