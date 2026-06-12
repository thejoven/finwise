-- 020: signals 加 project_auto_assigned 标记.
--
-- "转为信号"(promote) 在创建那一刻就兜底落进用户第一个活跃分类, 保证信号立即可见
-- (产品无"全部/未分类"视图, 未分类信号在 UI 上不可达). 该标记区分这两种归属来源:
--   true  = 系统临时归类 (promote 兜底), 之后 mastra analyst 判好可覆盖到更合适的分类;
--   false = 用户手选 (录入页 CategoryPicker / 手动指定), AI 回写时绝不覆盖.
-- 回写逻辑见 signal 模块 resolveInferenceProject.

ALTER TABLE signals ADD COLUMN IF NOT EXISTS project_auto_assigned BOOLEAN NOT NULL DEFAULT false;
