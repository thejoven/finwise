-- 016: 把 Analyst 推演的 related_assets 落到 signals 表.
--
-- 原来 related_assets 只进了 signal.inference.done 事件的 payload, signals 表里没列 ——
-- "信号" tab 要按"降噪后有相关标的"筛选 + 展示标的, 需要这一列可查.
--
-- 回填: 从已有的 signal.inference.done 事件取每条信号最新一次推演的 related_assets,
-- 这样存量信号立刻可筛, 不用重跑 LLM. (related_assets 在 payload 里是 omitempty —
-- 推不出标的的噪音信号那条 key 缺省, -> 返回 NULL, 正好筛掉.)

ALTER TABLE signals ADD COLUMN IF NOT EXISTS inference_related_assets jsonb;

UPDATE signals s
SET inference_related_assets = (
    SELECT e.payload->'related_assets'
    FROM events e
    WHERE e.type = 'signal.inference.done'
      AND (e.payload->>'signal_id')::uuid = s.id
    ORDER BY e.id DESC
    LIMIT 1
)
WHERE s.inference_related_assets IS NULL;
