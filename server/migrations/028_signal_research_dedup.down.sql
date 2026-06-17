-- 只能撤索引; 去重删掉的冗余行无法 (也无需) 恢复.
DROP INDEX IF EXISTS uq_signal_research_signal;
