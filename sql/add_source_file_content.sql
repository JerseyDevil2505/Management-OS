-- =============================================================================
-- ADD SOURCE FILE CONTENT STORAGE TO JOBS TABLE
-- Step 1: Add column to store complete source file content (like code_file_content)
-- This will be the foundation for eliminating raw_data from property_records
-- =============================================================================

-- Add source file content column (similar to existing code_file_content)
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS source_file_content text;

-- Add source file metadata columns
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS source_file_size bigint;

ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS source_file_rows_count integer;

ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS source_file_parsed_at timestamp with time zone;

-- Create index for potential file content searches (optional)
CREATE INDEX IF NOT EXISTS idx_jobs_source_file_parsed_at 
ON jobs (source_file_parsed_at) 
WHERE source_file_content IS NOT NULL;

-- Verify the columns were added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'jobs' 
  AND column_name IN (
    'source_file_content', 
    'code_file_content',
    'source_file_size',
    'source_file_rows_count',
    'source_file_parsed_at'
  )
ORDER BY column_name;

-- Show jobs table storage summary
SELECT 
  COUNT(*) as total_jobs,
  COUNT(source_file_content) as jobs_with_source_files,
  COUNT(code_file_content) as jobs_with_code_files,
  pg_size_pretty(pg_total_relation_size('jobs')) as jobs_table_size
FROM jobs;
