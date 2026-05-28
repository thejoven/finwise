-- M8 · holdings
--
-- 已签字承诺的"持仓状态机". 与 commitments 1:1 (id = commitment_id).
-- 分表是因为生命周期不同:
--   - commitments 是文书, 签字后冻结 (见 004 trigger)
--   - holdings 是状态机, 每天 cron 检查退出条件可能 transit
--
-- 状态机:
--   active → triggered (退出条件触发, 等用户确认平仓)
--   active → expired (持仓期满 duration_months 到, 等复盘)
--   active → closed (用户主动平仓)
--   triggered → closed (用户确认平仓)
--   expired → archived (复盘完成, M11)
--   closed → archived (复盘完成, M11)

CREATE TABLE IF NOT EXISTS holdings (
    -- id = 对应 commitment.id, 不另发 uuid
    id              UUID PRIMARY KEY REFERENCES commitments(id) ON DELETE RESTRICT,
    user_id         UUID NOT NULL,

    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'triggered', 'expired', 'closed', 'archived')),

    signed_at       TIMESTAMPTZ NOT NULL,

    -- 从承诺书 thesis 复制过来的退出条件 + duration, 这样持仓状态机不必每次 join.
    -- 形如 ["条件 1", "条件 2", "条件 3"]
    exit_conditions JSONB NOT NULL,

    -- 持仓期满时间 = signed_at + duration_months. 物化避免反复算.
    expires_at      TIMESTAMPTZ NOT NULL,

    -- 每个退出条件的进度计数, Phase 2 留空对象 {}, Phase 3 M9/M10 填实.
    -- 形如 {"条件 1": {"checked_at": "...", "triggered": false, ...}}
    exit_check_state JSONB NOT NULL DEFAULT '{}',

    -- 状态变化时间戳
    triggered_at    TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 主要查询: "我当前所有 active 持仓" + "今天到期的"
CREATE INDEX IF NOT EXISTS idx_holdings_user_status
    ON holdings (user_id, status);

-- 到期巡检用 (M10 cron 扫这个索引)
CREATE INDEX IF NOT EXISTS idx_holdings_expires
    ON holdings (expires_at)
    WHERE status IN ('active', 'triggered');
