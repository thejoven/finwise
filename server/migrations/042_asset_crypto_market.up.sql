-- 042: 标的追踪 多市场扩展 —— 放开 assets.market CHECK 收纳 'crypto', 并复活被搁浅的港美股.
-- 规格: 025 建表时 market ∈ (a,hk,us,other); 029 起 A股行情上线, hk/us 因当时无 adapter 被 poller
-- 动态标 price_status='unsupported'. 本期把股票源 (腾讯) 扩到 hk/us, 并新增 crypto 源 (OKX),
-- 故: (1) market 允许 'crypto'; (2) 把历史卡在 'unsupported' 的 hk/us 重置回 'pending' 让 poller 重新认领.
--
-- 'other' 仍保留给真正 untrackable 的兜底 (未上市 / 海外主上市 / 行业篮子); 'crypto' 是可追踪市场.
-- assets.type 无 CHECK, 'crypto'/'stablecoin' 直接存; price_status 生命周期 (pending/active/unsupported/failed) 复用.

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_market_check;
ALTER TABLE assets ADD CONSTRAINT assets_market_check
    CHECK (market IN ('a', 'hk', 'us', 'crypto', 'other'));

-- 复活: 之前无 adapter 被标 unsupported 的港美股, 重置为 pending + 清失败计数, 让价格 poller 重新回填.
-- (crypto 之前全落 untrackable/other, status='untrackable' 天然不被认领; 待重新归一后自然进 pending.)
UPDATE assets
SET price_status = 'pending', price_attempts = 0, updated_at = now()
WHERE price_status = 'unsupported'
  AND status = 'active'
  AND market IN ('hk', 'us');
