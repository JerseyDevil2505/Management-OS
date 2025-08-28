-- =============================================================================
-- REMAINING OPTIMIZATIONS
-- Run this after the manual index creation you just completed
-- =============================================================================

-- Create remaining useful indexes
CREATE INDEX IF NOT EXISTS idx_property_market_analysis_new_vcs 
ON property_market_analysis (new_vcs) WHERE new_vcs IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_location 
ON property_market_analysis (location_analysis) WHERE location_analysis IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_norm_time 
ON property_market_analysis (values_norm_time) WHERE values_norm_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_norm_size 
ON property_market_analysis (values_norm_size) WHERE values_norm_size IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_project_start_date 
ON jobs (project_start_date) WHERE project_start_date IS NOT NULL;

-- Add foreign key constraint (improves JOIN performance)
ALTER TABLE property_market_analysis 
ADD CONSTRAINT IF NOT EXISTS fk_property_market_analysis_composite_key 
FOREIGN KEY (property_composite_key) 
REFERENCES property_records(property_composite_key);

-- Update table statistics for better query planning
ANALYZE property_records;
ANALYZE property_market_analysis;
ANALYZE jobs;

-- Reclaim space and update statistics
VACUUM ANALYZE property_records;
VACUUM ANALYZE property_market_analysis;
VACUUM ANALYZE jobs;

-- Check the results
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size('public.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size('public.'||tablename) - pg_relation_size('public.'||tablename)) as index_size
FROM pg_tables 
WHERE tablename IN ('property_records', 'property_market_analysis', 'jobs')
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
