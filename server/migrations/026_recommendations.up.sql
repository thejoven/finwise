-- 026: recommendations —— 主动信号推荐的多态呈现位 (P1「持仓相关情报」起用).
-- 规格: docs/技术文档/12_主动信号推荐_开发文档.md §5; 执行: 12_…_开发计划.md §2 (W1).
--
-- 迁移号 026: 024=user_alpha_profile (本功能 P0), 025=asset_tracking (姊妹「标的追踪」),
--             故本表取 026. (原规划 023/024 因 023 早被 user_language 占用而整体顺延.)
--
-- 形态备忘:
--   - 派生投影, **不写 events** (同 user_alpha_profile / distillation / subscription 先例):
--     推荐由 builder 漏斗从 firehose + 画像算出, 可丢弃可重建, 非领域事件.
--   - 多态呈现位 (context_type + target_ref), 沿用 subscription (source_type+source_id) 先例:
--     P1 只用 context_type='commitment', target_ref=commitment_id; feed/archive/digest 留 P2+.
--   - source 多态 (source_type+source_id): v1 只有 tweet (source_id → tweets.id), 预留 telegram/rss.
--   - status 机: pending → surfaced (呈现给用户) → dismissed(不相关, 负反馈) / promoted(转了信号, 强正反馈) / expired.
--     dismissed/promoted 回灌 builder 下次重算画像 (降权/加权).
--   - per-user: recommendations 严格按 user 隔离 (tweets 全局共享, 但"推荐"是 per-user).

CREATE TABLE IF NOT EXISTS recommendations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL,
    source_type  text NOT NULL DEFAULT 'tweet',         -- 预留 telegram/rss
    source_id    text NOT NULL,                          -- tweet: → tweets.id
    score        real NOT NULL,                          -- 粗排+精排融合分
    rationale    text NOT NULL,                          -- 策展 agent 产出的"为你"一句话
    context_type text NOT NULL
                 CHECK (context_type IN ('feed','commitment','archive','digest')),
    target_ref   uuid,                                   -- commitment_id / evaluation_id; feed 为 NULL
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','surfaced','dismissed','promoted','expired')),
    model        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    surfaced_at  timestamptz,
    acted_at     timestamptz,

    -- 同位幂等: 同一来源在同一呈现位不重复推. 注: target_ref 为 NULL 时 (feed, P2) Postgres
    -- 视 NULL 互不相等 → 该唯一约束对 feed 不去重; P2 上 feed 时再按需补 (NULLS NOT DISTINCT 或应用层).
    UNIQUE (user_id, source_id, context_type, target_ref)
);

-- 读路径 (GET /commitments/:id/related 等): 按 user+位 取未消解的推荐, score 降序.
CREATE INDEX IF NOT EXISTS idx_recommendations_surface
    ON recommendations (user_id, context_type, target_ref)
    WHERE status IN ('pending', 'surfaced');
