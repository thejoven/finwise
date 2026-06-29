-- 037: 对象存储 (R2) 后台可配 + 用户头像对象键.
--
-- 背景: 个人资料头像上传需要对象存储, 但凭证不进 env (12-factor config), 改为后台
-- 可配 + 持久化. app_settings 是通用 key-value 运行时设置表 (当前仅 storage.r2,
-- 未来可放更多运营配置), 服务层带进程内缓存 + 写时失效.
--
-- 头像走"预签名直传 R2 + 后端签名 URL 私有读"链路: 对象键确定性派生为 avatars/<user_id>
-- (每次覆盖同 key, 天然无孤儿对象). users.avatar_object_key 仅作"是否有头像"标记 —
-- DTO 的 avatar_url 改为后端按该标记现签 (/v1/avatars/<id>?exp=&sig=), 旧 avatar_url 列
-- 保留但新流程不再写入.

CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_object_key TEXT;
