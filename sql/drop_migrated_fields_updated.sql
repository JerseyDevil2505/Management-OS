-- =============================================================================
-- DROP MIGRATED FIELDS FROM PROPERTY_RECORDS (UPDATED)
-- KEEPING validation_status in property_records due to dependencies
-- =============================================================================

-- Drop only the market analysis fields (moved to property_market_analysis)
ALTER TABLE property_records DROP COLUMN IF EXISTS location_analysis;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_map_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_key_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_zoning;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_size;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_time;
ALTER TABLE property_records DROP COLUMN IF EXISTS sales_history;
ALTER TABLE property_records DROP COLUMN IF EXISTS new_vcs;

-- Drop only project_start_date (moved to jobs table)
ALTER TABLE property_records DROP COLUMN IF EXISTS project_start_date;

-- KEEP validation_status in property_records (dependencies exist)

-- VERIFY FIELDS WERE DROPPED
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'property_records' 
  AND column_name IN (
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

-- VERIFY validation_status still exists
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'property_records' 
  AND column_name = 'validation_status';
-- This should return validation_status
