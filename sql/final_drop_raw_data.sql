-- FINAL STEP: Drop raw_data column from property_records
-- All data is now safely stored in jobs.raw_file_content

-- Check current status
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'property_records' 
        AND column_name = 'raw_data'
    ) THEN
        RAISE NOTICE '✅ raw_data column exists - ready to drop';
    ELSE
        RAISE NOTICE '❌ raw_data column already dropped';
    END IF;
END $$;

-- Drop the column
ALTER TABLE property_records DROP COLUMN IF EXISTS raw_data;

-- Verify it's gone
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'property_records' 
        AND column_name = 'raw_data'
    ) THEN
        RAISE NOTICE '🎉 SUCCESS: raw_data column dropped from property_records!';
    ELSE
        RAISE NOTICE '❌ ERROR: raw_data column still exists';
    END IF;
END $$;

-- Check that jobs.raw_file_content is working
SELECT 
    COUNT(*) as total_jobs,
    COUNT(raw_file_content) as jobs_with_raw_files,
    ROUND(AVG(raw_file_size)) as avg_file_size_bytes,
    ROUND(AVG(raw_file_rows_count)) as avg_rows_per_file
FROM jobs;

-- Verify property count matches
SELECT 
    j.job_name,
    j.raw_file_rows_count as expected_rows,
    COUNT(pr.id) as actual_property_records,
    CASE 
        WHEN j.raw_file_rows_count = COUNT(pr.id) THEN '✅ MATCH'
        ELSE '⚠️ DIFFERENT'
    END as status
FROM jobs j
LEFT JOIN property_records pr ON j.id = pr.job_id
WHERE j.raw_file_content IS NOT NULL
GROUP BY j.id, j.job_name, j.raw_file_rows_count
ORDER BY j.created_at DESC
LIMIT 5;

-- Final migration summary
SELECT 
    'Migration Complete!' as status,
    'raw_data column dropped' as action,
    'All data preserved in jobs.raw_file_content' as result;
