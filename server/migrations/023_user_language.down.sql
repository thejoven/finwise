-- 023 down: 移除 users.language.
ALTER TABLE users DROP COLUMN IF EXISTS language;
