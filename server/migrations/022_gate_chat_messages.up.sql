-- 022: gate_chat_messages — 归档页"与分析师继续对话"的消息记录.
--
-- 评估 (gate_evaluations) 是不可变快照; 对话不改判, 只解释 — 用户在归档页
-- 点进某条被否决的评估, 与否决它的那位分析师 (佐证/共识/时机/能力圈) 继续聊.
--
-- 不走 events/outbox: 对话不是业务事实流 (不触发任何下游), 视图表即可,
-- 同 distillations 的定位. role: 'user' = 用户, 'analyst' = 分析师回复.

CREATE TABLE IF NOT EXISTS gate_chat_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id uuid NOT NULL REFERENCES gate_evaluations(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL,
    role          text NOT NULL CHECK (role IN ('user', 'analyst')),
    content       text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_chat_messages_eval
    ON gate_chat_messages (evaluation_id, created_at ASC);
