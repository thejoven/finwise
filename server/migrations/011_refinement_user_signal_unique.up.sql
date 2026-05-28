-- 011: 把 refinement.uq_refinement_signal_active 改成 (user_id, primary_signal_id).
--
-- 原约束只对 signal_id 唯一 → 多用户系统下不同 user 想各自就同一条 signal 开
-- refinement 会撞约束 500. 真实业务规则是 "每个用户对同一信号同时只能有一个
-- active session", 而不是 "全局每条信号只能有一个 active session".
--
-- 不丢任何已有 row, 只是把约束键扩成复合.

DROP INDEX IF EXISTS uq_refinement_signal_active;

CREATE UNIQUE INDEX IF NOT EXISTS uq_refinement_user_signal_active
    ON refinement_sessions (user_id, primary_signal_id)
    WHERE status = 'active';
