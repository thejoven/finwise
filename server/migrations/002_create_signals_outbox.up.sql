-- M2 · signals view + event_outbox
--
-- signals: read model derived from events of type signal.captured /
--          signal.inference.done. Updated in the same tx as the source event.
--
-- event_outbox: transactional outbox for NATS publishing. Insert in the same
--               tx as the events insert; a background worker drains it and
--               publishes to NATS, then marks rows published_at.
--               Avoids the "wrote DB but failed to publish" gap that plagues
--               dual-write systems.

-- ───────────────────────── signals ─────────────────────────

CREATE TABLE IF NOT EXISTS signals (
    id                 UUID PRIMARY KEY,
    user_id            UUID NOT NULL,

    raw_text           TEXT NOT NULL,
    captured_at        TIMESTAMPTZ NOT NULL,
    source_event_id    BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,

    -- Inference state — written when signal.inference.done lands.
    inference_status   TEXT NOT NULL DEFAULT 'pending'
                       CHECK (inference_status IN ('pending', 'done', 'failed')),
    inference_summary  TEXT,
    inference_tags     TEXT[],
    inference_model    TEXT,
    inference_done_at  TIMESTAMPTZ,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_user_captured
    ON signals (user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_user_status
    ON signals (user_id, inference_status);

CREATE INDEX IF NOT EXISTS idx_signals_source_event
    ON signals (source_event_id);

-- ───────────────────────── event_outbox ─────────────────────────

CREATE TABLE IF NOT EXISTS event_outbox (
    id              BIGSERIAL PRIMARY KEY,
    event_id        BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    subject         TEXT NOT NULL,       -- NATS subject, e.g. "signal.captured"
    payload         JSONB NOT NULL,      -- message body
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at    TIMESTAMPTZ,         -- NULL until publisher succeeds
    publish_attempts INT NOT NULL DEFAULT 0,
    last_error      TEXT
);

-- Pending rows worker query: ordered, capped, skip-locked friendly.
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON event_outbox (enqueued_at)
    WHERE published_at IS NULL;

-- Audit: failed retries.
CREATE INDEX IF NOT EXISTS idx_outbox_attempts
    ON event_outbox (publish_attempts)
    WHERE published_at IS NULL AND publish_attempts > 0;

-- event_outbox is mutable on purpose (we update published_at + last_error).
-- We do NOT REVOKE here. The events table is the truth; outbox is plumbing.
