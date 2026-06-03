-- 018: invite_codes —— 注册需要邀请码, 仅管理员可在 web-admin 后台创建.
--
-- 背景: 注册从"任意邮箱+密码即可"收紧为"必须持有有效邀请码". 邀请码由管理员在
-- 后台生成并发给受邀人, 受邀人在 app 注册页填入. 管理员自身的引导仍走
-- scripts/grant-admin.sh (cmd/admin, 不经邀请码), 所以不存在先有码才有管理员的死锁.
--
-- 模型 (灵活, 单次码即 max_uses=1):
--   max_uses NULL  → 不限次数; 否则 uses 必须 < max_uses 才能再用.
--   expires_at NULL → 永不过期.
--   revoked_at 非空 → 已吊销, 立即失效.
-- 是否可兑换 = 未吊销 AND 未过期 AND (不限次 OR uses<max_uses). 兑换走单条
-- 原子 UPDATE (见 invite repository), 避免并发把同一个码用超.
--
-- code 明文存储 (邀请码非密钥级敏感, 后台需要回显/再复制给受邀人). 规范形式:
-- 大写 + 无歧义字母表, 无分隔符; 兑换时对用户输入做同样规范化再比对.

CREATE TABLE IF NOT EXISTS invite_codes (
    id          UUID PRIMARY KEY,
    code        TEXT NOT NULL,                 -- 规范形式 (大写, 无分隔符)
    label       TEXT,                          -- 管理员备注, 例如 "给老王"
    max_uses    INTEGER,                       -- NULL = 不限次
    uses        INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,                   -- NULL = 永不过期
    revoked_at  TIMESTAMPTZ,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,  -- 生成它的管理员
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT invite_codes_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0),
    CONSTRAINT invite_codes_uses_nonneg      CHECK (uses >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes (code);

-- created_by 维度的查询/级联用; 管理员列表通常按创建时间倒序展示.
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_at ON invite_codes (created_at DESC);
