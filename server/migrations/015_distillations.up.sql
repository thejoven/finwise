-- 015: distillations — "降噪页" 数据. 每次五轮追问完成后, mastra 的
-- post-refinement workflow 跑两个 agent, 各写回一部分:
--   distilled_content  distiller agent — 把信号 + 五轮答案 + 检索蒸成"降噪综述"
--   beneficiary        beneficiary agent (样例版金融信号) — 收益标的数组:
--                        null      = 还在推演 (金融 agent 未完成)
--                        '[]'      = 推演完但无清晰受益映射 → 沉默 (产品哲学 2)
--                        [ {...} ] = 有信号
--   beneficiary_note   受益链整体框架句 (可空)
--
-- 两个 agent 各异步 POST 一次 (partial 字段), server 用 COALESCE 合并 —
-- 降噪综述先到先显示, 金融信号后到再补 (对应需求里的"异步给出信号").
-- 关联 refinement_id 唯一 — 一次追问只一份降噪页. 重消费 (mastra 重跑) ON CONFLICT 覆盖.

CREATE TABLE IF NOT EXISTS distillations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refinement_id     uuid NOT NULL UNIQUE REFERENCES refinement_sessions(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL,

    distilled_content text,
    beneficiary       jsonb,
    beneficiary_note  text,

    model             text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distillations_user_created
    ON distillations (user_id, created_at DESC);
