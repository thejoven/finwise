-- 021 down: 摘掉 signals / projects 的 user_id 外键, 回到裸 UUID 列.
-- (不恢复已被清理的孤儿数据 —— 那是一次性数据修复, 不可逆.)

ALTER TABLE signals  DROP CONSTRAINT IF EXISTS signals_user_id_fkey;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_fkey;
