-- 030: App 内购 (App Store 订阅, 经 RevenueCat) 的服务端真相.
--
-- 背景: 客户端 (mobile/src/core/billing) 用 RevenueCat SDK 发起购买并直接读
--   customerInfo 解锁; 但服务端要有自己的一份真相 —— 否则后端无法按订阅状态做
--   门禁 / 统计 / 运营. RevenueCat 在续订·退款·过期时把事件 webhook 推给我们
--   (POST /v1/billing/revenuecat/webhook), 由 billing 模块投影成下面两张表.
--
--   注意: 这跟 module/subscription (X 推文订阅) 完全无关, 别混 —— 那个是采集
--   数据源, 这个是付费订阅.
--
-- 两张表:
--   user_entitlements — 每 (用户, entitlement) 当前状态的投影, 门禁直接读这张.
--   iap_events        — webhook 原始事件流水, 既做审计也做幂等 (event_id 唯一;
--                       RevenueCat 会重投同一事件, 必须去重).

CREATE TABLE IF NOT EXISTS user_entitlements (
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entitlement_id TEXT        NOT NULL,               -- RevenueCat entitlement 标识, 当前只用 'pro'
    is_active      BOOLEAN     NOT NULL DEFAULT FALSE,
    product_id     TEXT,                               -- 当前生效商品 (如 com.alphax.app.pro.monthly)
    store          TEXT,                               -- APP_STORE | PLAY_STORE | ...
    expires_at     TIMESTAMPTZ,                        -- 本期到期; NULL = 无 (终身 / 未订阅)
    will_renew     BOOLEAN     NOT NULL DEFAULT FALSE, -- 是否自动续订 (CANCELLATION 后转 false)
    last_event_id  TEXT,                               -- 最近一次驱动状态变更的 RevenueCat event id
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, entitlement_id)
);

-- 门禁热路径: 按 user 查"有没有 active 的 entitlement". 局部索引只覆盖 active 行.
CREATE INDEX IF NOT EXISTS idx_user_entitlements_active
    ON user_entitlements (user_id)
    WHERE is_active;

CREATE TABLE IF NOT EXISTS iap_events (
    event_id     TEXT        PRIMARY KEY,              -- RevenueCat event.id, 幂等键
    user_id      UUID,                                 -- event.app_user_id (= 我们的 user id); 解析失败时 NULL
    type         TEXT        NOT NULL,                 -- INITIAL_PURCHASE | RENEWAL | CANCELLATION | EXPIRATION | ...
    environment  TEXT,                                 -- PRODUCTION | SANDBOX
    payload      JSONB       NOT NULL,                 -- 原始事件, 便于回溯 / 重放
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iap_events_user ON iap_events (user_id, received_at DESC);
