-- =============================================================================
-- SIMPLE VERSION: NON-CONCURRENT INDEXES (Can run as single batch)
-- This will briefly lock tables but can be run all at once
-- Use this if you prefer simpler execution over concurrent performance
-- =============================================================================

-- Create all indexes (will briefly lock tables)
CREATE INDEX IF NOT EXISTS idx_property_market_analysis_composite_key 
ON property_market_analysis (property_composite_key);

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_new_vcs 
ON property_market_analysis (new_vcs) WHERE new_vcs IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_location 
ON property_market_analysis (location_analysis) WHERE location_analysis IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_zoning 
ON property_market_analysis (asset_zoning) WHERE asset_zoning IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_norm_time 
ON property_market_analysis (values_norm_time) WHERE values_norm_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_property_market_analysis_norm_size 
ON property_market_analysis (values_norm_size) WHERE values_norm_size IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_project_start_date 
ON jobs (project_start_date) WHERE project_start_date IS NOT NULL;

-- Add foreign key constraint
ALTER TABLE property_market_analysis 
ADD CONSTRAINT IF NOT EXISTS fk_property_market_analysis_composite_key 
FOREIGN KEY (property_composite_key) 
REFERENCES property_records(property_composite_key);

-- Update statistics
ANALYZE property_records;
ANALYZE property_market_analysis;
ANALYZE jobs;

-- Vacuum and analyze
VACUUM ANALYZE property_records;
VACUUM ANALYZE property_market_analysis;
VACUUM ANALYZE jobs;

-- Show results
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) as total_size
FROM pg_tables 
WHERE tablename IN ('property_records', 'property_market_analysis', 'jobs')
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
