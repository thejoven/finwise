-- 028: signal_research 的 signal-scope 行去重 + 唯一约束.
--
-- 背景: signal-inference 工作流第一步就调 postResearch 写一条 scope='signal' 的检索
-- 材料 (Exa + Polymarket). 每当一条信号的推演被重跑 —— 自动 (recovery sweeper,
-- 见 [[inference-classify-recovery]] / server/internal/module/recovery) 或人工重发
-- outbox —— postResearch 都会再插一行, 同一 signal_id 攒出多条冗余 signal-scope 行
-- (上线时 .205 上 39 条信号有 61 行, 22 行冗余, 最多一条信号 8 行).
--
-- 无害 (mobile LearningTimeline 只读首条 signal-scope, 按 created_at ASC) 但无界增长.
-- 本迁移: 先按"每个 signal_id 留最早一条"去重 (= mobile 一直显示的那条, 改动最小),
-- 再加部分唯一索引, 之后 Save 走 ON CONFLICT DO UPDATE 幂等刷新 (repository.go).
--
-- refinement_round 行不受影响: 它们也带 signal_id (= 主信号), 但部分索引 WHERE
-- scope='signal' 只覆盖 signal-scope 行, refinement 行不进该索引、永不冲突.

-- 1) 去重: 删掉每个 signal_id 下除最早 (created_at 最小, 同刻取 id 最小) 之外的 signal-scope 行.
DELETE FROM signal_research a
USING signal_research b
WHERE a.scope = 'signal'
  AND b.scope = 'signal'
  AND a.signal_id = b.signal_id
  AND (a.created_at > b.created_at
       OR (a.created_at = b.created_at AND a.id > b.id));

-- 2) 部分唯一索引: 每个 signal_id 至多一条 signal-scope 检索材料.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_research_signal
    ON signal_research (signal_id)
    WHERE scope = 'signal';
