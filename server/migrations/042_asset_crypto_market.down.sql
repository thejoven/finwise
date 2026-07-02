-- 回滚 042: 先把任何 crypto 行降级为 other 以满足旧 CHECK, 再恢复旧约束.
-- (港美股 price_status 重置不回滚 —— 复活是良性状态推进, 无需还原.)
UPDATE assets SET market = 'other', status = 'untrackable', updated_at = now()
WHERE market = 'crypto';

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_market_check;
ALTER TABLE assets ADD CONSTRAINT assets_market_check
    CHECK (market IN ('a', 'hk', 'us', 'other'));
