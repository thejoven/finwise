DROP INDEX IF EXISTS idx_tweets_classify_failed;
DROP INDEX IF EXISTS idx_signals_inference_stranded;
ALTER TABLE tweets   DROP COLUMN IF EXISTS classify_revivals;
ALTER TABLE signals  DROP COLUMN IF EXISTS inference_revivals;
