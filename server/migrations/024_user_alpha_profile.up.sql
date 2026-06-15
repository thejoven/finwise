-- 024: user_alpha_profile — 每用户 alpha 画像快照 (主动信号推荐 P0「画像底座」).
-- 规格: docs/技术文档/12_主动信号推荐_开发文档.md §2 (画像维度) / §5 (DDL).
--
-- 形态备忘:
--   - 派生投影, **不写 events 表** (同 distillations / subscriptions / attention_summaries 先例):
--     画像完全由既有行为轨迹重算得出 (signals / gate_evaluations / commitments / holdings /
--     retrospects / 被转信号的 tweets), 是可丢弃、可重建的物化视图, 不是领域事件.
--     一个 builder 周期性 (P1 起 cron) 重算并 upsert 本表.
--   - per-user 严格隔离: user_id 既是主键也是 builder 的 upsert 键, 一行一用户.
--   - 不加 FK 到 users(id): 与 §5 草案 DDL 一致, 且本表纯派生 (用户没了画像无意义,
--     但 builder 只对有行为的 user 重算, 孤儿行无害; 保持与 signals 等事件派生表同样的弱耦合).
--
-- 列对应 §2 画像维度:
--   tag_affinity          ← signals.inference_tags, 按"信号在漏斗里走多深"加权 (done→五轮→过门→签字)
--   category_affinity     ← 被"转信号"的 tweets.category (signals 无 category, 这是唯一来源)
--   conviction_shape      ← gate_evaluations.passed/failed_gate 统计 + 典型失败门 (确信形态)
--   self_known_weaknesses ← retrospects.focus_dim/focus_text (§2「自知弱项」维度)
--   lens_preference       ← L1–L10 透镜命中分布; P0 留空, 预留给 P1+ Mastra 策展 agent 回写
--   active_theses         ← commitments(signed) + holdings(active) 的 asset/action/exit_conditions 快照
--   built_from_until      ← 画像截至的最新行为时间点 (与 sample_size 同为冷启动判据)
--   sample_size           ← 行为样本量 (done signals 数); 低于阈值时 P1 builder 视为"画像未成熟"
--
-- 注 (§9 开放决策回写): §5 草案 DDL 未给「自知弱项」列, 但 §2 明确要求 builder 从
--   retrospects 派生它 — 故本迁移新增 self_known_weaknesses 列承接该维度 (additive, 安全).

CREATE TABLE IF NOT EXISTS user_alpha_profile (
    user_id               uuid PRIMARY KEY,
    tag_affinity          jsonb       NOT NULL DEFAULT '{}',  -- {"AI芯片": 0.8, "美债": 0.5, …} 归一化 0..1
    category_affinity     jsonb       NOT NULL DEFAULT '{}',  -- {"宏观": 0.7, "公司": 1.0, …} 归一化 0..1
    conviction_shape      jsonb       NOT NULL DEFAULT '{}',  -- {evaluations_total, passed, failed, pass_rate, failed_gate_histogram, typical_failed_gate}
    self_known_weaknesses jsonb       NOT NULL DEFAULT '[]',  -- {dominant_dim, dim_counts, recent:[{dim,text,at}]}
    lens_preference       jsonb,                              -- L1–L10 命中分布 (P1+ Mastra 回写, P0 NULL)
    active_theses         jsonb       NOT NULL DEFAULT '[]',  -- [{asset, action, exit_conditions, expires_at}]
    built_from_until      timestamptz,                        -- 截至的最新行为时间点 (NULL = 无行为)
    sample_size           int         NOT NULL DEFAULT 0,     -- 行为样本量 (done signals)
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 冷启动/重算扫描: builder 重算全量时按 updated_at 找最久未刷新的用户 (P1 cron 用).
CREATE INDEX IF NOT EXISTS idx_user_alpha_profile_updated
    ON user_alpha_profile (updated_at);
