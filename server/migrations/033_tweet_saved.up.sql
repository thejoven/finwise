-- 033_tweet_saved.up.sql
-- 「稍后读」(开发文档 15 · §4.1 上滑): 把推文移出收件箱、收进稍后读 bucket.
-- save = 标记已读 (离开未读 deck) + 记一行这里; 取消 = 删这行 (仍保持已读).

CREATE TABLE IF NOT EXISTS tweet_saved (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tweet_id   text NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tweet_id)
);
