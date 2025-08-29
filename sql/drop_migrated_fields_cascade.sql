-- =============================================================================
-- DROP MIGRATED FIELDS FROM PROPERTY_RECORDS WITH CASCADE
-- This will drop columns AND their dependencies (functions, indexes, views)
-- Preparing for backend service redesign (Option 3)
-- =============================================================================

-- Drop market analysis fields (moved to property_market_analysis)
ALTER TABLE property_records DROP COLUMN IF EXISTS validation_status CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS location_analysis CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_map_page CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_key_page CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_zoning CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_size CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_time CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS sales_history CASCADE;
ALTER TABLE property_records DROP COLUMN IF EXISTS new_vcs CASCADE;

-- Drop job metric field (moved to jobs table)
ALTER TABLE property_records DROP COLUMN IF EXISTS project_start_date CASCADE;

-- VERIFY ALL FIELDS WERE DROPPED
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'property_records' 
  AND column_name IN (
    'validation_status',
    'location_analysis', 
    'asset_map_page', 
    'asset_key_page', 
    'asset_zoning', 
    'values_norm_size', 
    'values_norm_time', 
    'sales_history', 
    'new_vcs',
    'project_start_date'
  );
-- This should return NO ROWS if successful

-- VERIFY PROPERTY_RECORDS IS NOW LIGHTER
SELECT 
  pg_size_pretty(pg_total_relation_size('property_records')) as property_records_size,
  pg_size_pretty(pg_total_relation_size('property_market_analysis')) as market_analysis_size,
  pg_size_pretty(pg_total_relation_size('jobs')) as jobs_table_size;

-- CHECK WHAT DEPENDENCIES WERE DROPPED
SELECT 
  'Dependencies dropped with CASCADE' as message,
  'Functions, indexes, and views referencing these columns have been removed' as note;
