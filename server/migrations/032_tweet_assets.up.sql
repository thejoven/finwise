-- 032_tweet_assets.up.sql
-- 推文级相关标的 (开发文档 15 · §3 硬五 / §8 P2): tweet-classify 增补抽取 ticker,
-- Go 复用信号侧的归一 (asset_aliases→规则→symbol-resolver) 落成 assets, 链接到这张表.
-- 与 signal_assets 完全平行; anchor_at 冻结于 tweets.captured_at.

CREATE TABLE IF NOT EXISTS tweet_assets (
    tweet_id   text NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    asset_id   uuid NOT NULL REFERENCES assets(id),
    role       text NOT NULL DEFAULT 'related'
               CHECK (role IN ('related','mentioned','primary')),
    anchor_at  timestamptz NOT NULL,
    rationale  text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tweet_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_tweet_assets_asset ON tweet_assets (asset_id);
