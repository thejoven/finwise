-- 036: 早报 per-user 整份社论 — morning_report_editions 从"重排+导读"升级为可缓存整份个性化文稿.
--
-- 原设计 (034): editions 只存 section_order + personal_intro + relevant_assets, 正文复用全局底稿.
-- 现需求: 整份早报千人千面 —— 用户首开时按其关注标的/活跃分类过滤昨日全站信号, 由 LLM 写
-- 一份只围绕他关注内容的整份社论 (headline/dek/sections). 故 editions 增列承载这份文稿.
--
-- 兼容: 三列均可空. 命中个性化路径 → 写满 (is_personalized=true); 关注为空/昨日安静 → 留空,
-- 服务层回退全局底稿 (section_order/personal_intro 旧字段对回退路径仍有意义, 保留不删).

ALTER TABLE morning_report_editions
    ADD COLUMN IF NOT EXISTS headline        text,
    ADD COLUMN IF NOT EXISTS dek             text,
    ADD COLUMN IF NOT EXISTS sections        jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS is_personalized boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS signal_count    int NOT NULL DEFAULT 0;  -- 命中该用户的信号数 (安静提示判定)
