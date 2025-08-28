-- =============================================================================
-- QUERY PATTERNS FOR PROPERTY_MARKET_ANALYSIS
-- How to join and retrieve data from the new table structure
-- =============================================================================

-- 1. BASIC JOIN: Get property + market analysis data
SELECT 
  pr.*,
  pma.validation_status,
  pma.location_analysis,
  pma.asset_map_page,
  pma.asset_key_page,
  pma.asset_zoning,
  pma.values_norm_size,
  pma.values_norm_time,
  pma.sales_history,
  pma.new_vcs
FROM property_records pr
LEFT JOIN property_market_analysis pma 
  ON pr.job_id = pma.job_id 
  AND pr.property_composite_key = pma.property_composite_key
WHERE pr.job_id = $1;

-- 2. SUPABASE JOIN SYNTAX (for components)
-- In Supabase client, use this pattern:
/*
const { data } = await supabase
  .from('property_records')
  .select(`
    *,
    property_market_analysis!inner(
      validation_status,
      location_analysis,
      asset_map_page,
      asset_key_page,
      asset_zoning,
      values_norm_size,
      values_norm_time,
      sales_history,
      new_vcs
    )
  `)
  .eq('job_id', jobId);
*/

-- 3. PERFORMANCE OPTIMIZED: Only get properties with market analysis
SELECT 
  pr.property_composite_key,
  pr.property_location,
  pr.asset_sfla,
  pma.validation_status,
  pma.location_analysis,
  pma.sales_history
FROM property_records pr
INNER JOIN property_market_analysis pma 
  ON pr.job_id = pma.job_id 
  AND pr.property_composite_key = pma.property_composite_key
WHERE pr.job_id = $1;

-- 4. UPSERT PATTERN: Insert or update market analysis data
INSERT INTO property_market_analysis (
  job_id,
  property_composite_key,
  validation_status,
  location_analysis,
  updated_at
) VALUES (
  $1, -- job_id
  $2, -- property_composite_key  
  $3, -- validation_status
  $4, -- location_analysis
  now()
)
ON CONFLICT (job_id, property_composite_key)
DO UPDATE SET
  validation_status = EXCLUDED.validation_status,
  location_analysis = EXCLUDED.location_analysis,
  updated_at = now();

-- 5. BULK PROPERTY QUERY: For JobContainer property loading
-- This replaces the heavy property_records query
SELECT 
  pr.id,
  pr.job_id,
  pr.property_composite_key,
  pr.property_location,
  pr.asset_sfla,
  pr.asset_year_built,
  pr.project_start_date,        -- PRESERVED FIELD
  pr.is_assigned_property,      -- PRESERVED FIELD
  -- No more heavy market analysis fields here!
  
  -- Only join market analysis when specifically needed
  CASE 
    WHEN $2 = true THEN pma.validation_status 
    ELSE NULL 
  END as validation_status,
  CASE 
    WHEN $2 = true THEN pma.location_analysis 
    ELSE NULL 
  END as location_analysis
FROM property_records pr
LEFT JOIN property_market_analysis pma 
  ON pr.job_id = pma.job_id 
  AND pr.property_composite_key = pma.property_composite_key
WHERE pr.job_id = $1;

-- 6. COUNT VALIDATION: Check migration success
SELECT 
  (SELECT COUNT(*) FROM property_records WHERE job_id = $1) as total_properties,
  (SELECT COUNT(*) FROM property_market_analysis WHERE job_id = $1) as properties_with_market_data,
  (SELECT COUNT(DISTINCT property_composite_key) FROM property_market_analysis WHERE job_id = $1) as unique_market_properties;
