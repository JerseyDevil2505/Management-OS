-- Rename source_file_* fields to raw_file_* for clarity
-- These fields store the actual raw data content, not source file tracking info

-- Rename the columns
ALTER TABLE jobs RENAME COLUMN source_file_content TO raw_file_content;
ALTER TABLE jobs RENAME COLUMN source_file_size TO raw_file_size;
ALTER TABLE jobs RENAME COLUMN source_file_rows_count TO raw_file_rows_count;
ALTER TABLE jobs RENAME COLUMN source_file_parsed_at TO raw_file_parsed_at;

-- Update the index name
DROP INDEX IF EXISTS idx_jobs_source_file_parsed_at;
CREATE INDEX IF NOT EXISTS idx_jobs_raw_file_parsed_at 
ON jobs (raw_file_parsed_at) 
WHERE raw_file_content IS NOT NULL;

-- Verify the changes
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'jobs' 
  AND column_name IN (
    'raw_file_content', 
    'raw_file_size',
    'raw_file_rows_count',
    'raw_file_parsed_at'
  )
ORDER BY column_name;

-- Check data is still there
SELECT 
  COUNT(*) as total_jobs,
  COUNT(raw_file_content) as jobs_with_raw_files,
  AVG(raw_file_size) as avg_file_size,
  AVG(raw_file_rows_count) as avg_rows_count
FROM jobs;
