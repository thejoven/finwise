-- 011 down: 回到老约束 (signal_id only).

DROP INDEX IF EXISTS uq_refinement_user_signal_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_refinement_signal_active
    ON refinement_sessions (primary_signal_id)
    WHERE status = 'active';
