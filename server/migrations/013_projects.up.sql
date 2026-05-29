-- 013: projects — 用户自定义的"分类/项目", 例如 "泡泡玛特" "新能源".
--
-- 用法:
--   1. 用户在 mobile masthead 右侧 chip 行点 + 新建分类
--   2. 切换 active project → 后续 capture 自动归属
--   3. 统计页按 project_id 过滤数据分析
--
-- 关键设计:
--   · project_id 只挂在 signals 上 (真相), refinement / attention 不冗余, 过滤
--     时 JOIN 回 signals — 单写入口, 不会失同步.
--   · 软删除 (archived_at) — 历史 signals 已绑定的 project 不允许硬删, 否则成野指针.
--   · 没有 "默认/全部" 行, project_id IS NULL 即 "未分类", 不入库.
--   · sort_order 给前端排序用, 默认 0; 重排时前端发 PATCH 一次性更新一批.

CREATE TABLE IF NOT EXISTS projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    name            TEXT NOT NULL,
    color           TEXT,                          -- 可选 hex, e.g. "#C62828"; null 用主题灰
    emoji           TEXT,                          -- 可选 emoji icon, e.g. "🧸"
    sort_order      INT NOT NULL DEFAULT 0,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同 user 下 name 唯一 (区分大小写 — 用户自定义, 不强行 lower)
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_name
    ON projects (user_id, name)
    WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_user_sort
    ON projects (user_id, sort_order, created_at)
    WHERE archived_at IS NULL;

-- signals.project_id — 捕获时绑定; null 表示"未分类".
-- ON DELETE SET NULL 兼容意外硬删 (虽然 service 层只做软删).
ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signals_user_project
    ON signals (user_id, project_id)
    WHERE project_id IS NOT NULL;
