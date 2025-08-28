-- =============================================================================
-- SLIM DOWN time_normalized_sales TO COMPLETE ESSENTIAL DISPLAY FIELDS
-- Keep only what's needed for the normalization table UI (with display fields)
-- Fixed pg_size_pretty type casting issue
-- =============================================================================

UPDATE market_land_valuation 
SET time_normalized_sales = (
  SELECT jsonb_agg(
    jsonb_build_object(
      -- Core identifiers
      'id', sale->>'id',
      'property_composite_key', sale->>'property_composite_key',
      'property_block', sale->>'property_block',
      'property_lot', sale->>'property_lot', 
      'property_location', sale->>'property_location',
      
      -- Sales data
      'sales_price', (sale->>'sales_price')::numeric,
      'sales_date', sale->>'sales_date',
      
      -- Asset characteristics (for display)
      'asset_building_class', sale->>'asset_building_class',
      'asset_type_use', sale->>'asset_type_use', 
      'asset_design_style', sale->>'asset_design_style',
      'asset_sfla', (sale->>'asset_sfla')::numeric,
      'asset_year_built', (sale->>'asset_year_built')::integer,
      
      -- Normalization data
      'time_normalized_price', (sale->>'time_normalized_price')::numeric,
      'hpi_multiplier', (sale->>'hpi_multiplier')::numeric,
      'sale_year', (sale->>'sale_year')::integer,
      
      -- User decisions
      'keep_reject', sale->>'keep_reject'
    )
  )
  FROM jsonb_array_elements(time_normalized_sales) as sale
)
WHERE time_normalized_sales IS NOT NULL;

-- Show the size reduction (with proper type casting)
SELECT 
  job_id,
  jsonb_array_length(time_normalized_sales) as sales_count,
  pg_size_pretty(octet_length(time_normalized_sales::text)::bigint) as new_size
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL;

-- Verify we have the essential display fields
SELECT 
  'Sample after cleanup:' as status,
  jsonb_pretty(time_normalized_sales->0) as slimmed_record
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0
LIMIT 1;
