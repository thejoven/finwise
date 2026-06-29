-- 035_tweet_quoted.up.sql
-- 转帖原文: 引用推文(quote)与纯转推(RT)的被转/被引原推, 归一化存这里 (id/作者/正文/媒体),
-- 供前端展开. 采集层 xsource.Tweet.Quoted 解析所得; raw_payload 仍是兜底全量.
-- 前向生效: 只对新采集的推文填充, 历史推文保持 NULL.

ALTER TABLE tweets ADD COLUMN IF NOT EXISTS quoted jsonb;
