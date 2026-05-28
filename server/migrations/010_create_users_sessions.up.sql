-- M-auth · users + sessions
--
-- Phase 1 把单用户 DEV_USER_ID 升级成多用户. 邮箱 + bcrypt 密码, 不发邮件验证码.
-- sessions 表是 opaque random token, login 时签发, 中间件 lookup 拿 user_id.
-- 不用 JWT — 单 host 部署, DB 查一次的成本可以忽略, 换来"立即吊销"能力.
--
-- DEV_USER_ID 兼容: 旧的 DEV_BEARER_TOKEN 仍然走 DevBearer 中间件, 落到那个
-- 固定 user_id. 这里 seed 一条对应的 placeholder 记录, 让 GET /v1/me 在 dev token
-- 模式下也能返回. 真要让 dev user 走 email 登录, 跑 UPDATE 改 password_hash.

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY,
    email           TEXT NOT NULL,
    email_lower     TEXT NOT NULL,                 -- citext 替代品: 存小写 + 唯一索引
    password_hash   TEXT NOT NULL,                 -- bcrypt; dev seed 写 '!' (不可登录)
    display_name    TEXT,
    avatar_url      TEXT,
    bio             TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (email_lower);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT PRIMARY KEY,              -- 32-byte URL-safe random, 客户端 bearer 用
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON sessions (expires_at);
