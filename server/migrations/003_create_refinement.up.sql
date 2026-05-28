-- M5 · refinement_sessions
--
-- 五轮追问的 head 表. 每次追问产生一个 session, 5 轮答题作为 events 写到 events 表,
-- 这张表只存"现在到第几轮"这种 head state, 让 list/get 不必反序列化 5 个 jsonb.
--
-- 关键 invariant:
--   - rounds_done 单调递增 0→5
--   - status 转移: active → completed | abandoned, 不可逆
--   - primary_signal_id 指向触发本次追问的 signal (用户在 Phase 1 录的那条)

CREATE TABLE IF NOT EXISTS refinement_sessions (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL,

    primary_signal_id  UUID NOT NULL REFERENCES signals(id) ON DELETE RESTRICT,
    primary_asset      TEXT,                 -- 推演认定的主要 ticker, 可空 (弱推演)

    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'completed', 'abandoned')),
    rounds_done        INTEGER NOT NULL DEFAULT 0
                       CHECK (rounds_done >= 0 AND rounds_done <= 5),

    -- decision 只在 status=completed 时有值
    decision           TEXT
                       CHECK (decision IS NULL OR decision IN ('eligible_for_gate', 'training_only')),

    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refinement_user_status
    ON refinement_sessions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_refinement_user_started
    ON refinement_sessions (user_id, started_at DESC);

-- 一条 signal 同时只能有一个 active session — 防止用户重开追问出现双 session.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refinement_signal_active
    ON refinement_sessions (primary_signal_id)
    WHERE status = 'active';

-- ──────────────────── refinement_questions ────────────────────
--
-- 题目缓存. 解决两个问题:
--   1) Mastra 出题完 POST 回 server 后, 客户端 GET session 能拿到正在等用户答的那道题
--   2) 用户网络闪断, 重连不让 LLM 重新出题 (省 token + 防答案漂移)
--
-- (session_id, round) 唯一. 同一轮重发 = upsert, payload 以最后一次为准.

CREATE TABLE IF NOT EXISTS refinement_questions (
    session_id    UUID NOT NULL REFERENCES refinement_sessions(id) ON DELETE RESTRICT,
    round         INTEGER NOT NULL CHECK (round >= 1 AND round <= 5),

    -- 完整问题 JSONB, 形如:
    -- {
    --   "question_id": "...",
    --   "kind": "single|multi|ordering|open",
    --   "text": "...",
    --   "options": [{"id": "a", "text": "...", "is_distractor": false, "is_required": false}],
    --   "model": "claude-sonnet-4-5"
    -- }
    payload       JSONB NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (session_id, round)
);

CREATE INDEX IF NOT EXISTS idx_refinement_questions_session
    ON refinement_questions (session_id);
