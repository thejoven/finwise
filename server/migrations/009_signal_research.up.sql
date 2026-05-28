-- M2.5 · signal_research
--
-- Mastra (Brave Search) 在两个位置做检索, 都落这张表:
--   - scope='signal'            : Analyst 拿到 signal 后做的 broad search.
--                                  signal_id NOT NULL, refinement_id/round NULL.
--   - scope='refinement_round'  : Socratic 出每一轮题前做的 lens-定向 search.
--                                  refinement_id/round NOT NULL.
--                                  signal_id 也填上 (= session.primary_signal_id)
--                                  让"按 signal 查所有研究"一条 SQL 出.
--
-- results 是 jsonb 数组, 每条 = {title, url, description, age, domain}.
-- model 例: "brave-web-v1" — 留扩展空间换 Tavily/Exa/Serper 时区分.
--
-- 不是 event-sourced — 检索结果是"辅助 grounding", 丢了重做就行, 不需要事件溯源.

CREATE TABLE IF NOT EXISTS signal_research (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,

    scope           TEXT NOT NULL
                    CHECK (scope IN ('signal', 'refinement_round')),

    signal_id       UUID,           -- signal scope 必填; refinement_round 也填 (= 主信号)
    refinement_id   UUID,           -- 仅 refinement_round 非空
    round           INT,            -- 仅 refinement_round 非空, 1..5

    query           TEXT NOT NULL,
    results         JSONB NOT NULL DEFAULT '[]',
    model           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- scope-字段一致性约束
    CONSTRAINT signal_research_scope_shape CHECK (
        (scope = 'signal' AND signal_id IS NOT NULL AND refinement_id IS NULL AND round IS NULL)
        OR
        (scope = 'refinement_round' AND refinement_id IS NOT NULL AND round BETWEEN 1 AND 5)
    )
);

CREATE INDEX IF NOT EXISTS idx_signal_research_signal
    ON signal_research (signal_id, created_at DESC)
    WHERE signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_research_refinement
    ON signal_research (refinement_id, round, created_at DESC)
    WHERE refinement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_research_user_created
    ON signal_research (user_id, created_at DESC);
