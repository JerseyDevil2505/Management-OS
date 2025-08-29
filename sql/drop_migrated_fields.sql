-- =============================================================================
-- DROP MIGRATED FIELDS FROM PROPERTY_RECORDS
-- Run this AFTER verifying data was successfully migrated to property_market_analysis
-- =============================================================================

-- VERIFY MIGRATION SUCCESS FIRST
SELECT 
  'property_records' as source_table,
  COUNT(*) as total_rows,
  COUNT(validation_status) as has_validation_status,
  COUNT(location_analysis) as has_location_analysis,
  COUNT(sales_history) as has_sales_history,
  COUNT(new_vcs) as has_new_vcs
FROM property_records

UNION ALL

SELECT 
  'property_market_analysis' as source_table,
  COUNT(*) as total_rows,
  COUNT(validation_status) as has_validation_status,
  COUNT(location_analysis) as has_location_analysis,
  COUNT(sales_history) as has_sales_history,
  COUNT(new_vcs) as has_new_vcs
FROM property_market_analysis;

-- =============================================================================
-- DROP COLUMNS FROM PROPERTY_RECORDS (UNCOMMENTED)
-- =============================================================================

-- Drop the migrated market analysis fields
ALTER TABLE property_records DROP COLUMN IF EXISTS validation_status;
ALTER TABLE property_records DROP COLUMN IF EXISTS location_analysis;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_map_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_key_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_zoning;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_size;
ALTER TABLE property_records DROP COLUMN IF EXISTS values_norm_time;
ALTER TABLE property_records DROP COLUMN IF EXISTS sales_history;
ALTER TABLE property_records DROP COLUMN IF EXISTS new_vcs;

-- VERIFY FIELDS WERE DROPPED
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
    'new_vcs'
  );
-- This should return NO ROWS if successful

-- VERIFY PROPERTY_RECORDS IS NOW LIGHTER
SELECT 
  pg_size_pretty(pg_total_relation_size('property_records')) as property_records_size,
  pg_size_pretty(pg_total_relation_size('property_market_analysis')) as market_analysis_size;
