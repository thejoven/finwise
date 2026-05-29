DROP INDEX IF EXISTS idx_signals_user_project;
ALTER TABLE signals DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS projects;
