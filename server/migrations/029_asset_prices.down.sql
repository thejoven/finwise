-- 029 down: 拆除行情底座.
DROP INDEX IF EXISTS idx_assets_price_poll;
DROP TABLE IF EXISTS asset_prices;
ALTER TABLE assets DROP COLUMN IF EXISTS price_status;
ALTER TABLE assets DROP COLUMN IF EXISTS price_checked_at;
ALTER TABLE assets DROP COLUMN IF EXISTS price_synced_at;
ALTER TABLE assets DROP COLUMN IF EXISTS price_attempts;
