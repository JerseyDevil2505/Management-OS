-- =============================================================================
-- STEP 2: MAINTENANCE OPERATIONS (Can be run as a batch)
-- Run this AFTER completing all the index creation commands
-- =============================================================================

-- Add foreign key constraint (improves JOIN performance)
ALTER TABLE property_market_analysis 
ADD CONSTRAINT IF NOT EXISTS fk_property_market_analysis_composite_key 
FOREIGN KEY (property_composite_key) 
REFERENCES property_records(property_composite_key);

-- Update table statistics for query planner
ANALYZE property_records;
ANALYZE property_market_analysis;
ANALYZE jobs;

-- Reclaim space from dropped columns and update statistics
VACUUM ANALYZE property_records;
VACUUM ANALYZE property_market_analysis; 
VACUUM ANALYZE jobs;

-- Check table sizes after optimization
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
FROM pg_tables 
WHERE tablename IN ('property_records', 'property_market_analysis', 'jobs')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
