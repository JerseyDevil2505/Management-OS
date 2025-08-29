-- =============================================================================
-- ADD JOB-LEVEL METRICS TO JOBS TABLE (UPDATED)
-- Move only project_start_date from property_records to jobs
-- KEEP validation_status in property_records
-- =============================================================================

-- 1. ADD NEW COLUMN TO JOBS TABLE
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_start_date date;

-- Add helpful comment
COMMENT ON COLUMN jobs.project_start_date IS 'Inspection start date set by ProductionTracker';

-- 2. MIGRATE EXISTING DATA FROM PROPERTY_RECORDS
-- Get the project_start_date from first property in each job
UPDATE jobs 
SET project_start_date = subq.project_start_date
FROM (
  SELECT DISTINCT ON (job_id)
    job_id,
    project_start_date
  FROM property_records 
  WHERE project_start_date IS NOT NULL
  ORDER BY job_id, created_at DESC
) subq
WHERE jobs.id = subq.job_id;

-- 3. VERIFY MIGRATION
SELECT 
  job_number,
  project_start_date,
  created_at
FROM jobs 
WHERE project_start_date IS NOT NULL
ORDER BY created_at DESC;

-- 4. COUNT PROPERTIES THAT WILL BE CLEANED UP
SELECT 
  'Properties with project_start_date' as field,
  COUNT(*) as count
FROM property_records 
WHERE project_start_date IS NOT NULL;
