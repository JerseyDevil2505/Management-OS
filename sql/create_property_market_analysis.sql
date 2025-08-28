-- =============================================================================
-- CREATE PROPERTY_MARKET_ANALYSIS TABLE
-- Move market analysis fields from property_records to dedicated table
-- =============================================================================

-- 1. CREATE NEW TABLE
CREATE TABLE property_market_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  property_composite_key text NOT NULL,
  
  -- Market Analysis Fields (moved from property_records)
  validation_status text,
  location_analysis text,
  asset_map_page text,
  asset_key_page text, 
  asset_zoning text,
  values_norm_size numeric,
  values_norm_time numeric,
  sales_history jsonb,
  new_vcs text,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints
  UNIQUE(job_id, property_composite_key)
);

-- 2. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX idx_property_market_analysis_job_id ON property_market_analysis(job_id);
CREATE INDEX idx_property_market_analysis_composite_key ON property_market_analysis(property_composite_key);
CREATE INDEX idx_property_market_analysis_job_property ON property_market_analysis(job_id, property_composite_key);

-- 3. MIGRATE EXISTING DATA
INSERT INTO property_market_analysis (
  job_id,
  property_composite_key,
  validation_status,
  location_analysis,
  asset_map_page,
  asset_key_page,
  asset_zoning,
  values_norm_size,
  values_norm_time,
  sales_history,
  new_vcs,
  created_at
)
SELECT 
  job_id,
  property_composite_key,
  validation_status,
  location_analysis,
  asset_map_page,
  asset_key_page,
  asset_zoning,
  values_norm_size,
  values_norm_time,
  sales_history,
  new_vcs,
  created_at
FROM property_records
WHERE 
  validation_status IS NOT NULL OR
  location_analysis IS NOT NULL OR
  asset_map_page IS NOT NULL OR
  asset_key_page IS NOT NULL OR
  asset_zoning IS NOT NULL OR
  values_norm_size IS NOT NULL OR
  values_norm_time IS NOT NULL OR
  sales_history IS NOT NULL OR
  new_vcs IS NOT NULL;

-- 4. VERIFY MIGRATION
SELECT 
  'property_records' as source_table,
  COUNT(*) as total_rows,
  COUNT(validation_status) as has_validation_status,
  COUNT(location_analysis) as has_location_analysis,
  COUNT(sales_history) as has_sales_history
FROM property_records

UNION ALL

SELECT 
  'property_market_analysis' as source_table,
  COUNT(*) as total_rows,
  COUNT(validation_status) as has_validation_status,
  COUNT(location_analysis) as has_location_analysis,
  COUNT(sales_history) as has_sales_history
FROM property_market_analysis;

-- 5. AFTER MIGRATION IS VERIFIED, DROP COLUMNS FROM PROPERTY_RECORDS
-- ALTER TABLE property_records DROP COLUMN validation_status;
-- ALTER TABLE property_records DROP COLUMN location_analysis;
-- ALTER TABLE property_records DROP COLUMN asset_map_page;
-- ALTER TABLE property_records DROP COLUMN asset_key_page;
-- ALTER TABLE property_records DROP COLUMN asset_zoning;
-- ALTER TABLE property_records DROP COLUMN values_norm_size;
-- ALTER TABLE property_records DROP COLUMN values_norm_time;
-- ALTER TABLE property_records DROP COLUMN sales_history;
-- ALTER TABLE property_records DROP COLUMN new_vcs;
