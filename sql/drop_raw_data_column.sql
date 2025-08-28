-- Drop raw_data column from property_records table
-- CRITICAL: This architectural change stores complete raw files in jobs.raw_file_content
-- instead of duplicating raw_data JSON in every property_records row
-- PERFORMANCE IMPACT: Significant reduction in database size and improved query performance

-- First, let's check the current column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'property_records' 
        AND column_name = 'raw_data'
    ) THEN
        RAISE NOTICE 'raw_data column exists in property_records table';
    ELSE
        RAISE NOTICE 'raw_data column does not exist in property_records table';
    END IF;
END $$;

-- Drop the raw_data column
ALTER TABLE property_records 
DROP COLUMN IF EXISTS raw_data;

-- Verify the column has been dropped
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'property_records' 
        AND column_name = 'raw_data'
    ) THEN
        RAISE NOTICE 'SUCCESS: raw_data column successfully removed from property_records table';
    ELSE
        RAISE NOTICE 'ERROR: raw_data column still exists in property_records table';
    END IF;
END $$;

-- Performance analysis queries (run these after the column drop)

-- Check table size reduction
SELECT 
    schemaname,
    tablename,
    attname as column_name,
    n_distinct,
    avg_width,
    null_frac
FROM pg_stats 
WHERE tablename = 'property_records' 
AND schemaname = 'public'
ORDER BY avg_width DESC;

-- Estimate storage savings
SELECT 
    relname as table_name,
    pg_size_pretty(pg_total_relation_size(oid)) as total_size,
    pg_size_pretty(pg_relation_size(oid)) as table_size,
    pg_size_pretty(pg_total_relation_size(oid) - pg_relation_size(oid)) as index_size
FROM pg_class 
WHERE relname = 'property_records';

-- Verify raw_file_content is properly stored in jobs table
SELECT 
    id,
    job_name,
    county,
    year_created,
    totalresidential,
    totalcommercial,
    CASE
        WHEN raw_file_content IS NOT NULL THEN 'HAS_RAW_FILE'
        ELSE 'MISSING_RAW_FILE'
    END as raw_file_status,
    raw_file_size,
    raw_file_rows_count,
    raw_file_parsed_at
FROM jobs 
ORDER BY created_at DESC
LIMIT 10;

-- Verify that we can still access raw data through jobs table
SELECT 
    j.job_name,
    j.county,
    j.raw_file_size,
    COUNT(pr.id) as property_count
FROM jobs j
LEFT JOIN property_records pr ON j.id = pr.job_id
WHERE j.raw_file_content IS NOT NULL
GROUP BY j.id, j.job_name, j.county, j.raw_file_size
ORDER BY j.created_at DESC
LIMIT 5;

COMMIT;
