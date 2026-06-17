-- 029: 标的追踪 P1 · 行情底座 —— asset_prices 日线缓存 + assets 价格轮询状态.
-- 规格: docs/技术文档/13_标的追踪_开发文档.md §4 (asset_prices DDL) + §6 P1 + §3 硬问题二.
--
-- 默认行情源 = 东方财富 push2his (免费 / 国内可达不需翻墙 / 前复权 / 支持日期段查询),
-- 经 internal/infra/marketdata 的 Provider 抽象封装, 换源只改 adapter (§8 决策一: 205 实测后定).
-- 派生 / 缓存数据, 不写 events.
--
-- 迁移号: 025=本功能 P0(标的归一), 026=recommendations, 027=recovery, 028=research_dedup 均已占, 故 029.

-- ───────────────────────── asset_prices —— 日线缓存 ─────────────────────────
CREATE TABLE IF NOT EXISTS asset_prices (
    asset_id   uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    date       date NOT NULL,
    open       numeric,
    high       numeric,
    low        numeric,
    close      numeric NOT NULL,        -- 收益锚算法只需收盘; OHLC 余量留给 K 线
    volume     bigint,
    source     text NOT NULL,           -- 行情源标识 (eastmoney/sina/tencent/tushare…), UI 标数据出处
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, date)
);

-- ───────────────── assets 价格轮询状态 (poller 用) ─────────────────
-- 同 subscription 把采集状态挂在 twitter_accounts 的先例.
--   price_status   pending=待回填 / active=已回填日更中 / unsupported=该市场暂无 adapter (P1 仅 A股) / failed=多次失败暂停
--   price_checked_at 上次轮询尝试 (成功/失败都更新, 驱动调度间隔)
--   price_synced_at  上次成功同步 (UI "数据截至 X" + 调度)
--   price_attempts   连续失败计数 (退避 / 熔断)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS price_status text NOT NULL DEFAULT 'pending'
    CHECK (price_status IN ('pending','active','unsupported','failed'));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS price_checked_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS price_synced_at  timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS price_attempts   int NOT NULL DEFAULT 0;

-- 轮询认领索引: 只追真实标的 (status=active) 中 price_status 在 (pending,active) 的.
-- untrackable (status=untrackable) 天然排除; hk/us 由 poller 动态标 unsupported (P1 无其 adapter).
CREATE INDEX IF NOT EXISTS idx_assets_price_poll
    ON assets (price_checked_at)
    WHERE status = 'active' AND price_status IN ('pending','active');
