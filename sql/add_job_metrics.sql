-- =============================================================================
-- ADD JOB-LEVEL METRICS TO JOBS TABLE
-- Move validation_status and project_start_date from property_records to jobs
-- =============================================================================

-- 1. ADD NEW COLUMNS TO JOBS TABLE
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS validation_status text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_start_date date;

-- Add helpful comments
COMMENT ON COLUMN jobs.validation_status IS 'Data source: imported (at creation) or updated (recent upload)';
COMMENT ON COLUMN jobs.project_start_date IS 'Inspection start date set by ProductionTracker';

-- 2. MIGRATE EXISTING DATA FROM PROPERTY_RECORDS
-- Get the validation_status and project_start_date from first property in each job
UPDATE jobs 
SET 
  validation_status = subq.validation_status,
  project_start_date = subq.project_start_date
FROM (
  SELECT DISTINCT ON (job_id)
    job_id,
    validation_status,
    project_start_date
  FROM property_records 
  WHERE validation_status IS NOT NULL 
     OR project_start_date IS NOT NULL
  ORDER BY job_id, created_at DESC
) subq
WHERE jobs.id = subq.job_id;

-- 3. VERIFY MIGRATION
SELECT 
  job_number,
  validation_status,
  project_start_date,
  created_at
FROM jobs 
WHERE validation_status IS NOT NULL 
   OR project_start_date IS NOT NULL
ORDER BY created_at DESC;

-- 4. COUNT PROPERTIES THAT WILL BE CLEANED UP
SELECT 
  'Properties with validation_status' as field,
  COUNT(*) as count
FROM property_records 
WHERE validation_status IS NOT NULL

UNION ALL

SELECT 
  'Properties with project_start_date' as field,
  COUNT(*) as count
FROM property_records 
WHERE project_start_date IS NOT NULL;
