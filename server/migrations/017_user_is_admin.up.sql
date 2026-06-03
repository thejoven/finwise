-- 017: 给 users 加 is_admin —— web-admin 后台只允许管理员登录.
--
-- 背景: 原来 web-admin 用 DEV_BEARER_TOKEN 登录, 所有登录用户权限相等, 没有"管理员"
-- 概念. 现在后台要按身份 (邮箱+密码) 登录, 并且只有 is_admin=true 的用户能进.
--
-- 兼容: dev bearer 路径落到 DEV_USER_ID 对应的占位用户 (email 'dev@local', 由
-- account.EnsureDevUser seed). 把它一并设为 admin, 这样旧的 dev-token 登录在过渡期
-- 仍能访问 admin 接口, 不会因为这次迁移被锁在门外.
--
-- 真正的管理员 (如 jwen@vip.qq.com) 用 scripts/grant-admin.sh 单独授予 (见该脚本).

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 部分索引: 只索引管理员行 (通常就一两个), 让 "列出所有管理员" 之类查询走索引而非全表.
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users (is_admin) WHERE is_admin;

-- dev 占位用户保留 admin, 避免迁移后 dev-token 立即失去后台访问.
UPDATE users SET is_admin = TRUE WHERE email_lower = 'dev@local';

-- 若 jwen 已注册, 迁移即提权; 未注册则此句静默 no-op (0 行),
-- 由 scripts/grant-admin.sh (create-if-missing + 提权) 在部署时兜底.
UPDATE users SET is_admin = TRUE WHERE email_lower = 'jwen@vip.qq.com';
