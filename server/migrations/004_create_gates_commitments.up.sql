-- M6 + M7 · gate_evaluations + commitments
--
-- gate_evaluations 是"四道门"评估的快照 head, 详细规则在 events.gate.evaluated 里.
-- commitments 是承诺书文书层, 与 holdings (M8) 1:1, 但表分开是因为生命周期不同 —
-- 承诺书签字后不可改, 持仓状态是状态机.
--
-- 关键 invariant:
--   - commitments.status='signed' 之后不可回退 (trigger 守门)
--   - commitments.thesis 是 JSONB, 内含 reasons_for_future_self 必须 verbatim 引用
--     用户原话 (业务层保证, schema 不强制)
--   - one (refinement, evaluation, commitment) chain 是 1:1:1

-- ──────────── gate_evaluations ────────────

CREATE TABLE IF NOT EXISTS gate_evaluations (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    refinement_id   UUID NOT NULL REFERENCES refinement_sessions(id) ON DELETE RESTRICT,

    -- 四道门判据细节, jsonb 形如:
    -- {
    --   "g1_thickness":     {"pass": true, "count": 3,    "detail": "3 条独立信号 14 天内"},
    --   "g2_anti_consensus":{"pass": true, "score": 72,   "detail": "..."},
    --   "g3_window":        {"pass": false, "months": 14, "detail": "窗口已过 12 个月上限"},
    --   "g4_edge":          {"pass": true, "sub": {"explain": true, "direct": true, ...}}
    -- }
    gates_detail    JSONB NOT NULL,

    -- 通过 = 四门全过. failed_gate 表示第几道门失败 (1..4), 全过时为 NULL.
    passed          BOOLEAN NOT NULL,
    failed_gate     INTEGER CHECK (failed_gate IS NULL OR failed_gate BETWEEN 1 AND 4),

    -- 沉默归档的池. passed=true 时为 NULL.
    archived_pool   TEXT CHECK (archived_pool IS NULL OR
                                archived_pool IN ('observation', 'lesson', 'calendar', 'discard')),

    evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 一致性: 通过 ⇔ failed_gate IS NULL ⇔ archived_pool IS NULL
    CONSTRAINT chk_gate_consistency CHECK (
        (passed = TRUE  AND failed_gate IS NULL AND archived_pool IS NULL) OR
        (passed = FALSE AND failed_gate IS NOT NULL AND archived_pool IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_gates_user_evaluated
    ON gate_evaluations (user_id, evaluated_at DESC);

-- 档案 tab 按池分组用
CREATE INDEX IF NOT EXISTS idx_gates_user_pool
    ON gate_evaluations (user_id, archived_pool)
    WHERE archived_pool IS NOT NULL;

-- 通过的评估查询用 (用来产承诺书)
CREATE INDEX IF NOT EXISTS idx_gates_user_passed
    ON gate_evaluations (user_id, evaluated_at DESC)
    WHERE passed = TRUE;

-- 一次 refinement 只能产一次 evaluation
CREATE UNIQUE INDEX IF NOT EXISTS uq_gates_refinement
    ON gate_evaluations (refinement_id);

-- ──────────── commitments ────────────

CREATE TABLE IF NOT EXISTS commitments (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    evaluation_id   UUID NOT NULL REFERENCES gate_evaluations(id) ON DELETE RESTRICT,

    status          TEXT NOT NULL DEFAULT 'drafted'
                    CHECK (status IN ('drafted', 'signed', 'postponed', 'abandoned')),

    -- thesis 是 NarratorAgent 生成的全文 JSONB, 形如 (见 Phase 2 plan § 2.1):
    -- {
    --   "asset_ticker": "SK Hynix", "asset_name": "...", "action": "buy",
    --   "position_pct": 5, "duration_months": 6,
    --   "entry_method": "...",
    --   "exit_conditions": ["...", "...", "..."],
    --   "reasons_for_future_self": ["原话1", "原话2", "原话3"]
    -- }
    thesis          JSONB NOT NULL,

    -- PDF 渲染产物的路径 (本地 chromedp 渲染后落到 storage). 可空 (未渲染时).
    pdf_path        TEXT,

    -- postpone 计数, 达到 3 自动 abandoned (业务层执行).
    postpone_count  INTEGER NOT NULL DEFAULT 0
                    CHECK (postpone_count >= 0 AND postpone_count <= 10),

    signed_at       TIMESTAMPTZ,
    drafted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 一致性: status=signed ⇔ signed_at IS NOT NULL
    CONSTRAINT chk_commitment_signed_at CHECK (
        (status = 'signed' AND signed_at IS NOT NULL) OR
        (status != 'signed' AND (signed_at IS NULL OR signed_at IS NOT NULL))
        -- 允许 abandoned/postponed 时 signed_at 仍为 NULL, 但 signed 状态必须有时间
    )
);

CREATE INDEX IF NOT EXISTS idx_commitments_user_status
    ON commitments (user_id, status);

CREATE INDEX IF NOT EXISTS idx_commitments_user_signed
    ON commitments (user_id, signed_at DESC)
    WHERE signed_at IS NOT NULL;

-- 一次评估只能产一份承诺书
CREATE UNIQUE INDEX IF NOT EXISTS uq_commitments_evaluation
    ON commitments (evaluation_id);

-- ──────────── 不可逆 trigger ────────────
-- 一旦 status=signed, 后续 UPDATE 不能改 status 或 signed_at.
-- 注意: status 仍可从 signed → 不可能 (只有 drafted → signed/postponed/abandoned).
-- 这个 trigger 防的是写代码的人手抖.

CREATE OR REPLACE FUNCTION enforce_signed_immutability() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'signed' THEN
        IF NEW.status != 'signed' THEN
            RAISE EXCEPTION 'commitment % is signed; status cannot be changed', OLD.id
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.signed_at IS DISTINCT FROM OLD.signed_at THEN
            RAISE EXCEPTION 'commitment % is signed; signed_at cannot be changed', OLD.id
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.thesis::text != OLD.thesis::text THEN
            RAISE EXCEPTION 'commitment % is signed; thesis cannot be changed', OLD.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commitments_signed_immutable ON commitments;
CREATE TRIGGER trg_commitments_signed_immutable
    BEFORE UPDATE ON commitments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_signed_immutability();
