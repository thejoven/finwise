-- 回滚 events 表. 仅用于本地重建, 永远不要在有数据的环境跑.
DROP TABLE IF EXISTS events;
