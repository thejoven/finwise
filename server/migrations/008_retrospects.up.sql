-- M11 · 复盘表 + 用户训练重点存储.
--
-- 设计:
--   - 一个 commitment 只能复盘 1 次 (UNIQUE on commitment_id)
--   - answers 是 JSONB 追加 (每问一道追加一条 {q, choice, open_text})
--   - state 状态机: pending → in_progress → finalized
--   - finalized 后 focus_dim + focus_text 写出来, M11.5 把它复制进 user_training_state

CREATE TABLE IF NOT EXISTS retrospects (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    commitment_id   UUID NOT NULL REFERENCES commitments(id) ON DELETE RESTRICT UNIQUE,

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at    TIMESTAMPTZ,

    state           TEXT NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'in_progress', 'finalized')),

    -- [{q: 1..4, dim, choice, open_text}, ...]
    answers         JSONB NOT NULL DEFAULT '[]',

    focus_dim       TEXT,
    focus_text      TEXT,
    diagnostician_model TEXT,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrospects_user_started
    ON retrospects (user_id, started_at DESC);

-- 用户训练重点 (Phase 3 plan § 2.2.5 简化方案: 单用户单行).
-- Phase 4+ 多用户时 ALTER 加 user_id PK.
CREATE TABLE IF NOT EXISTS user_training_state (
    user_id          UUID PRIMARY KEY,
    -- 最近 5 条 [{retrospect_id, focus_dim, focus_text, applied_from}]
    training_focuses JSONB NOT NULL DEFAULT '[]',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
