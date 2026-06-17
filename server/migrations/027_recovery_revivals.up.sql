-- 027: 自动恢复巡检的"复活计数器".
--
-- 背景: DeepSeek 结构化输出偶发抽风 ("No object generated") 会让一条工作永久搁浅 —
--   · signal: iii 把 signal-inference 重试 3 次/30s 后丢 DLQ, signals.inference_status
--     永远停在 'pending' (App 上一直转圈 "AI推演中"), 没有任何东西再重新入队.
--   · tweet:  classify 3 次失败后 classify_status='failed', 同样无人再捞.
--
-- recovery.Sweeper (Go 周期巡检, 仿 exit.Checker) 通过"重置 outbox 行 / 重新 pending"
-- 复活它们 —— 这正是今天人工恢复用的幂等操作. 但裸的重置会对一条真正坏掉的输入
-- 无限重试, 所以这里给每条记录加一个"复活次数"上限计数器: 超过上限就停手并报警
-- (metrics.RecoveryExhausted), 留给人工处理, 不再空转烧 LLM 配额.
--
-- 计数器只增不减; RecordInference 成功 / classify 成功后记录离开 pending/failed 态,
-- 巡检 WHERE 自然不再命中, 无需清零. 幂等性见 signal.RecordInference
-- (client_event_id 由 signal_id 派生 + ON CONFLICT DO NOTHING, 绝不重复信号).

ALTER TABLE signals ADD COLUMN IF NOT EXISTS inference_revivals INT NOT NULL DEFAULT 0;
ALTER TABLE tweets   ADD COLUMN IF NOT EXISTS classify_revivals  INT NOT NULL DEFAULT 0;

-- 巡检查询用的部分索引: 只覆盖搁浅态那一小撮行, 不给热路径加负担.
-- signals: 按 updated_at 找"冷却期已过且还没好"的 pending 信号.
CREATE INDEX IF NOT EXISTS idx_signals_inference_stranded
    ON signals (updated_at)
    WHERE inference_status = 'pending';

-- tweets: 按 captured_at 找 failed 推文 (pending 的部分索引 019 已建).
CREATE INDEX IF NOT EXISTS idx_tweets_classify_failed
    ON tweets (captured_at)
    WHERE classify_status = 'failed';
