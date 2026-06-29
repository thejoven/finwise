ALTER TABLE morning_report_editions
    DROP COLUMN IF EXISTS headline,
    DROP COLUMN IF EXISTS dek,
    DROP COLUMN IF EXISTS sections,
    DROP COLUMN IF EXISTS is_personalized,
    DROP COLUMN IF EXISTS signal_count;
