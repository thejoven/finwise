-- 025: 标的追踪 P0 · 标的归一 (symbol resolution).
-- 规格: docs/技术文档/13_标的追踪_开发文档.md §4 (数据模型) + §3 硬问题一 + §6 P0.
--
-- 派生 / 缓存数据, 不写 events (同 distillations / subscriptions 先例).
-- 本期只建归一三表; asset_prices (行情缓存) 与 poller 属 P1, 不在此迁移.
--
-- 迁移号说明: 规格原拟 023, 但 023 已被 user_language (多语言) 占用, 024 留给姊妹
-- 功能「主动信号推荐」, 故本功能顺延到 025. 三功能迁移号互不冲突.
--
-- 对 §4 草案 DDL 的两处务实演进 (草案是规格, 落地需自洽):
--   1. market 增加 'other' —— 草案 CHECK 只有 a|hk|us, 但 §7 又要求归一不了的标
--      status='untrackable'. untrackable 行 (crypto / 未上市 / 海外 / 篮子) 没有合法的
--      A/HK/US market, 用 'other' 兜住, 既满足 NOT NULL 又不谎报市场.
--   2. exchange NOT NULL DEFAULT '' —— 规则归一出的美股一时无法判 NASDAQ/NYSE,
--      宁可留空也不谎报具体交易所 (呼应"诚实留空好过追错"); P1 行情源可再精化.

-- ───────────────────────── assets —— 规范标的注册表 ─────────────────────────
CREATE TABLE IF NOT EXISTS assets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical       text NOT NULL,            -- 规范代码: A股 6 位 / 港股补零 5 位 / 美股 ticker;
                                              --   untrackable 行存归一化后的原始名 (保证 UNIQUE 不冲突)
    exchange        text NOT NULL DEFAULT '', -- SSE/SZSE/BSE/HKEX/NASDAQ/NYSE…; 未定/untrackable = ''
    market          text NOT NULL CHECK (market IN ('a','hk','us','other')),
                                              -- a|hk|us = 可追踪市场; other = 非 A/HK/US (untrackable 专用)
    name            text NOT NULL,
    provider_symbol text,                     -- 行情源代码 (300750.SZ / 00700.HK / NVDA); P1 行情接入用
    type            text NOT NULL DEFAULT 'equity', -- equity|crypto|index|fund|other
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','delisted','untrackable')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (market, canonical)
);

-- ───────────────── asset_aliases —— 各种叫法 → asset_id (省重复归一) ─────────────────
-- 归一化别名: lower + trim + 空白折叠 后的字符串, 例 "宁德时代" / "ningde" / "catl" / "nvda".
-- 命中即复用对应 asset, 不再走规则 / LLM —— 成本闸门 (§7 全局去重).
CREATE TABLE IF NOT EXISTS asset_aliases (
    alias_lower text PRIMARY KEY,
    asset_id    uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_aliases_asset ON asset_aliases (asset_id);

-- ──────────── signal_assets —— 信号 ↔ 标的链接 + 冻结锚点 (取代只靠 JSON 查) ────────────
-- anchor_at 在解析时冻结 = signal.captured_at, 此后不随重算变动 (§3 硬问题三 / §7 锚点冻结).
-- asset_id 上的索引服务反查"标的 X → 我哪些命题碰过它"(标的专页核心, §4 查询②③).
CREATE TABLE IF NOT EXISTS signal_assets (
    signal_id  uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    asset_id   uuid NOT NULL REFERENCES assets(id),
    role       text NOT NULL DEFAULT 'beneficiary'
               CHECK (role IN ('beneficiary','primary','mentioned')),
    anchor_at  timestamptz NOT NULL,
    rationale  text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (signal_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_assets_asset ON signal_assets (asset_id);
