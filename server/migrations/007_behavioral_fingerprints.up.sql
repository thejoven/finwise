-- M9 · 行为指纹.
-- 每天每个 (user, commitment) 一行, 记录"用户今天打开了几次承诺页".
-- ≥ 3 → anxious_3x · ≥ 5 → anxious_5x · companion_shown 防同一天发多次卡.

CREATE TABLE IF NOT EXISTS behavioral_fingerprints (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    commitment_id   UUID NOT NULL REFERENCES commitments(id) ON DELETE RESTRICT,
    date            DATE NOT NULL,

    open_count      INTEGER NOT NULL DEFAULT 0,
    open_first_at   TIMESTAMPTZ,
    open_last_at    TIMESTAMPTZ,

    -- "normal" / "anxious_3x" / "anxious_5x"
    classified      TEXT,
    companion_shown BOOLEAN NOT NULL DEFAULT false,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, commitment_id, date)
);

CREATE INDEX IF NOT EXISTS idx_fingerprints_user_date
    ON behavioral_fingerprints (user_id, date DESC);

-- 复盘时按 commitment 找行为指纹的整段
CREATE INDEX IF NOT EXISTS idx_fingerprints_commitment_date
    ON behavioral_fingerprints (commitment_id, date ASC);
