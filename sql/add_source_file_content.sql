-- =============================================================================
-- ADD RAW FILE CONTENT STORAGE TO JOBS TABLE
-- Step 1: Add column to store complete raw file content (like code_file_content)
-- This will be the foundation for eliminating raw_data from property_records
-- =============================================================================

-- Add raw file content column (similar to existing code_file_content)
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS raw_file_content text;

-- Add raw file metadata columns
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS raw_file_size bigint;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS raw_file_rows_count integer;

ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS raw_file_parsed_at timestamp with time zone;

-- Create index for potential file content searches (optional)
CREATE INDEX IF NOT EXISTS idx_jobs_raw_file_parsed_at
ON jobs (raw_file_parsed_at)
WHERE raw_file_content IS NOT NULL;

-- Verify the columns were added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'jobs' 
  AND column_name IN (
    'raw_file_content',
    'code_file_content',
    'raw_file_size',
    'raw_file_rows_count',
    'raw_file_parsed_at'
  )
ORDER BY column_name;

-- Show jobs table storage summary
SELECT 
  COUNT(*) as total_jobs,
  COUNT(raw_file_content) as jobs_with_raw_files,
  COUNT(code_file_content) as jobs_with_code_files,
  pg_size_pretty(pg_total_relation_size('jobs')) as jobs_table_size
FROM jobs;
