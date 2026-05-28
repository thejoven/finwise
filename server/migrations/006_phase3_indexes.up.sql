-- Phase 3 启动: 给 Phase 1/2 表加 Phase 3 巡检需要的索引.
--
-- M9 / M10 cron 巡检会高频扫 active 持仓 + 按 type 查 events 子集.

-- M10 cron 找"哪些持仓还 active 或 triggered"用 (signed_at desc + state filter)
CREATE INDEX IF NOT EXISTS idx_holdings_active_signed
    ON holdings (user_id, signed_at DESC)
    WHERE status IN ('active', 'triggered');

-- M11 时间轴查询用 (按 commitment_id JSON 路径找)
CREATE INDEX IF NOT EXISTS idx_events_payload_commitment
    ON events ((payload->>'commitment_id'))
    WHERE payload ? 'commitment_id';

-- M9 / M10 / M11 子集按 type 过滤用 (partial index 比全表索引高效)
CREATE INDEX IF NOT EXISTS idx_events_phase3_types
    ON events (user_id, type, occurred_at DESC)
    WHERE type LIKE 'companion.%' OR type LIKE 'exit.%' OR type LIKE 'retrospect.%' OR type LIKE 'holding.%';
