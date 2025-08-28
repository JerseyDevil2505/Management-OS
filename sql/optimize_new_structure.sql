-- =============================================================================
-- OPTIMIZATION SCRIPT FOR NEW DATABASE STRUCTURE
-- Run this to optimize performance after migration
-- =============================================================================

-- 1. CREATE INDEXES ON property_market_analysis TABLE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_composite_key 
ON property_market_analysis (property_composite_key);

-- Indexes for commonly queried fields
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_new_vcs 
ON property_market_analysis (new_vcs) WHERE new_vcs IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_location 
ON property_market_analysis (location_analysis) WHERE location_analysis IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_zoning 
ON property_market_analysis (asset_zoning) WHERE asset_zoning IS NOT NULL;

-- Indexes for normalized values (used in market analysis)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_norm_time 
ON property_market_analysis (values_norm_time) WHERE values_norm_time IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_norm_size 
ON property_market_analysis (values_norm_size) WHERE values_norm_size IS NOT NULL;

-- 2. ADD FOREIGN KEY CONSTRAINT (improves JOIN performance)
ALTER TABLE property_market_analysis 
ADD CONSTRAINT fk_property_market_analysis_composite_key 
FOREIGN KEY (property_composite_key) 
REFERENCES property_records(property_composite_key);

-- 3. OPTIMIZE jobs TABLE
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_project_start_date 
ON jobs (project_start_date) WHERE project_start_date IS NOT NULL;

-- 4. ANALYZE TABLES FOR QUERY PLANNER
ANALYZE property_records;
ANALYZE property_market_analysis;
ANALYZE jobs;

-- 5. VACUUM TO RECLAIM SPACE FROM DROPPED COLUMNS
VACUUM ANALYZE property_records;
VACUUM ANALYZE property_market_analysis;
VACUUM ANALYZE jobs;

-- 6. CHECK TABLE SIZES AFTER OPTIMIZATION
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE tablename IN ('property_records', 'property_market_analysis', 'jobs')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
