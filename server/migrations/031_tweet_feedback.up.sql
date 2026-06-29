-- 031_tweet_feedback.up.sql
-- 订阅卡片「不感兴趣」(开发文档 15 · §5/§6): 既隐藏当条, 也按内容标签累积厌恶,
-- 减少后续同类推送. 与 tweet_reads 同类 — 高频低价值的 per-user 动作, 不写 events 表.

CREATE TABLE IF NOT EXISTS tweet_feedback (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tweet_id   text NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('not_interested')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tweet_id)
);

-- 标签级厌恶: 每次「不感兴趣」对命中标签 +1; weight 跨阈值 → muted → feed 隐藏带该标签的推文.
CREATE TABLE IF NOT EXISTS user_tag_aversion (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag        text NOT NULL,
    weight     int  NOT NULL DEFAULT 0,
    muted      boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tag)
);

-- feed 过滤只关心被静音的标签 → 部分索引, 命中即查.
CREATE INDEX IF NOT EXISTS idx_tag_aversion_muted
    ON user_tag_aversion (user_id) WHERE muted;
