-- M1 · events 表
-- 事件溯源的物理底座. 所有业务派生(signals 物化视图等)从这里推出去.
-- 关键约束:
--   1. append-only — REVOKE UPDATE/DELETE 在物理层禁写
--   2. (user_id, client_event_id) 唯一 — 客户端幂等的依据
--   3. occurred_at vs recorded_at 区分 — 用户感知时间 vs server 落库时间
--   4. causation_id / correlation_id 留 NULL — 顶层事件没有起因

CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    client_event_id UUID NOT NULL,
    type            TEXT NOT NULL,
    payload         JSONB NOT NULL,

    occurred_at     TIMESTAMPTZ NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    causation_id    BIGINT REFERENCES events(id) ON DELETE RESTRICT,
    correlation_id  UUID,

    related_asset   TEXT,
    related_thesis  UUID,

    UNIQUE (user_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS idx_events_user_occurred
    ON events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_type
    ON events (type);

CREATE INDEX IF NOT EXISTS idx_events_asset
    ON events (related_asset)
    WHERE related_asset IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_thesis
    ON events (related_thesis)
    WHERE related_thesis IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_correlation
    ON events (correlation_id)
    WHERE correlation_id IS NOT NULL;

-- append-only 物理保护. 即使 dev 期间也开, 防止任何代码绕过.
-- INSERT 仍允许; SELECT 不受影响.
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM alphax;
