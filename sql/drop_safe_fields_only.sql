-- =============================================================================
-- DROP ONLY SAFE FIELDS FROM PROPERTY_RECORDS
-- Conservative approach - only dropping fields with no known dependencies
-- =============================================================================

-- These fields appear to have dependencies in performance functions, so KEEP them:
-- - validation_status (dependencies found)
-- - location_analysis (dependencies found) 
-- - values_norm_size (used in performance functions)
-- - values_norm_time (used in performance functions)
-- - sales_history (used in performance functions)
-- - new_vcs (used in performance functions)

-- Only drop these fields that appear safe:
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_map_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_key_page;
ALTER TABLE property_records DROP COLUMN IF EXISTS asset_zoning;

-- Drop project_start_date (moved to jobs table)
ALTER TABLE property_records DROP COLUMN IF EXISTS project_start_date;

-- VERIFY ONLY THESE FIELDS WERE DROPPED
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'property_records' 
  AND column_name IN (
    'asset_map_page', 
    'asset_key_page', 
    'asset_zoning',
    'project_start_date'
  );
-- This should return NO ROWS if successful

-- VERIFY the problematic fields still exist
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'property_records' 
  AND column_name IN (
    'validation_status',
    'location_analysis', 
    'values_norm_size', 
    'values_norm_time', 
    'sales_history', 
    'new_vcs'
  );
-- This should return all 6 fields
