-- 019: 推文订阅 — 订阅 X 账号 → twtapi 采集 → AI 分类 → 阅读/已读 → 转信号.
-- 规格: docs/技术文档/10_推文订阅_开发文档.md §4 · 执行: 11_推文订阅_开发计划.md §2.
--
-- 形态备忘:
--   - subscriptions 多态 (source_type, source_id): 为 telegram/rss 预留 (用户拍板),
--     source_id 指向各类型自己的源表 (twitter → twitter_accounts.id), 多态做不了 FK,
--     完整性靠应用层 + 各源表约束; 换来加类型零迁移.
--   - tweets 全局共享 (多人订同一账号只采一次/分类一次), tweet_reads 才是 per-user.
--   - 两者都不写 events 表: 推文是系统采集数据, 已读是高频低价值动作,
--     均非领域事件 (同 distillations / attention_summaries 的先例).

CREATE TABLE IF NOT EXISTS twitter_accounts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rest_id              text NOT NULL UNIQUE,            -- twtapi user_id (Rest ID)
    handle               text NOT NULL,                   -- screen name, 不含 @ (可能改名)
    handle_lower         text GENERATED ALWAYS AS (lower(handle)) STORED,
    display_name         text,
    avatar_url           text,
    bio                  text,
    high_water_tweet_id  text,                            -- 已采最新 tweet id (增量基准)
    last_polled_at       timestamptz,
    poll_interval_sec    int  NOT NULL DEFAULT 1800,      -- 自适应: 900s..10800s
    status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','suspended','not_found')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twitter_accounts_handle_lower
    ON twitter_accounts (handle_lower);

CREATE TABLE IF NOT EXISTS subscriptions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id),
    source_type  text NOT NULL DEFAULT 'twitter'
                 CHECK (source_type IN ('twitter','telegram','rss')),
    source_id    uuid NOT NULL,                           -- → twitter_accounts.id (twitter)
    active       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active
    ON subscriptions (user_id) WHERE active;

CREATE TABLE IF NOT EXISTS tweets (
    id                  text PRIMARY KEY,                 -- tweet rest id
    twitter_account_id  uuid NOT NULL REFERENCES twitter_accounts(id) ON DELETE CASCADE,
    text                text NOT NULL,
    lang                text,
    tweet_created_at    timestamptz,                      -- 推文发布时间 (ruby 格式解析)
    is_retweet          boolean NOT NULL DEFAULT false,
    is_quote            boolean NOT NULL DEFAULT false,
    media               jsonb,                            -- [{type,url,thumb,width,height}]
    metrics             jsonb,                            -- {likes,retweets,replies,quotes,bookmarks,views}
    raw_payload         jsonb NOT NULL,                   -- 原始 <TWEET>, 上游改结构可重解析
    -- AI 分类回写 (dispatcher 同步调 mastra /tweet-classify):
    tags                text[],
    summary             text,
    category            text,                             -- 宏观|公司|行情|政策|技术|观点|其它
    relevance           real,                             -- 0..1, 与投资/信号的相关度
    classify_status     text NOT NULL DEFAULT 'pending'
                        CHECK (classify_status IN ('pending','done','failed')),
    classify_attempts   int NOT NULL DEFAULT 0,           -- ≥3 → failed, 不再重试
    classified_at       timestamptz,
    captured_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tweets_account_time
    ON tweets (twitter_account_id, tweet_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_classify_pending
    ON tweets (captured_at) WHERE classify_status = 'pending';

CREATE TABLE IF NOT EXISTS tweet_reads (
    user_id   uuid NOT NULL REFERENCES users(id),
    tweet_id  text NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
    read_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tweet_id)
);
