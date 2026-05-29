-- 012: attention_summaries — 每次五轮追问完成后, mastra attention-analyst
-- 出的 "本次注意力诊断" 数据.
--
-- 维度 (0-100):
--   focus_score      答题节奏 (用时一致性 + 与历史均值比)
--   depth_score      推演深度 (cognitive_layer + diagnosis 综合)
--   breadth_score    lens 多样性 (R2 多选 + 整体 tags 覆盖)
--   execution_score  R5 commitment 完成度 (action + duration + reason 字数)
--
-- LLM 文本字段:
--   insight    一句话总结 (≤200 char), 给用户看
--   blindspot  本次最值得提醒的盲点 (≤120 char)
--
-- 关联到 refinement_id 唯一 — 一次追问只生成一次注意力分析. 重跑 (mastra 重消费)
-- 用 ON CONFLICT DO UPDATE 覆盖.

CREATE TABLE IF NOT EXISTS attention_summaries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refinement_id   uuid NOT NULL UNIQUE REFERENCES refinement_sessions(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL,

    focus_score     int  NOT NULL CHECK (focus_score BETWEEN 0 AND 100),
    depth_score     int  NOT NULL CHECK (depth_score BETWEEN 0 AND 100),
    breadth_score   int  NOT NULL CHECK (breadth_score BETWEEN 0 AND 100),
    execution_score int  NOT NULL CHECK (execution_score BETWEEN 0 AND 100),

    insight         text NOT NULL,
    blindspot       text NOT NULL,

    model           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attention_user_created
    ON attention_summaries (user_id, created_at DESC);
