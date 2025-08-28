-- =============================================================================
-- STEP 1: CREATE INDEXES (Run each command separately in Supabase SQL editor)
-- These must be run ONE AT A TIME, not as a batch script
-- =============================================================================

-- Index on property_market_analysis primary key
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_composite_key 
ON property_market_analysis (property_composite_key);

-- Index for new_vcs queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_new_vcs 
ON property_market_analysis (new_vcs) WHERE new_vcs IS NOT NULL;

-- Index for location analysis queries  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_location 
ON property_market_analysis (location_analysis) WHERE location_analysis IS NOT NULL;

-- Index for zoning queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_zoning 
ON property_market_analysis (asset_zoning) WHERE asset_zoning IS NOT NULL;

-- Index for time normalized values
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_norm_time 
ON property_market_analysis (values_norm_time) WHERE values_norm_time IS NOT NULL;

-- Index for size normalized values
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_market_analysis_norm_size 
ON property_market_analysis (values_norm_size) WHERE values_norm_size IS NOT NULL;

-- Index for project start date on jobs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_project_start_date 
ON jobs (project_start_date) WHERE project_start_date IS NOT NULL;
