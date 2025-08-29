-- =============================================================================
-- CLEANUP time_normalized_sales DATA
-- Remove bloated fields and keep only essential normalization data
-- =============================================================================

-- STEP 1: First let's see what we're dealing with
SELECT 
  'Before cleanup:' as status,
  job_id,
  jsonb_array_length(time_normalized_sales) as sales_count,
  pg_size_pretty(octet_length(time_normalized_sales::text)) as data_size
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0;

-- STEP 2: Create slimmed down version (only essential fields)
UPDATE market_land_valuation 
SET time_normalized_sales = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sale->>'id',
      'property_composite_key', sale->>'property_composite_key',
      'property_location', sale->>'property_location',
      'property_block', sale->>'property_block',
      'property_lot', sale->>'property_lot',
      'sales_price', (sale->>'sales_price')::numeric,
      'sales_date', sale->>'sales_date',
      'asset_sfla', (sale->>'asset_sfla')::numeric,
      'asset_year_built', (sale->>'asset_year_built')::integer,
      'time_normalized_price', (sale->>'time_normalized_price')::numeric,
      'keep_reject', sale->>'keep_reject',
      'hpi_multiplier', (sale->>'hpi_multiplier')::numeric,
      'sale_year', (sale->>'sale_year')::integer
      -- REMOVED: raw_data, location_analysis, new_vcs, sales_history, 
      --          asset_map_page, asset_key_page, asset_zoning,
      --          values_norm_size, values_norm_time, and other bloated fields
    )
  )
  FROM jsonb_array_elements(time_normalized_sales) as sale
)
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0;

-- STEP 3: Check the results
SELECT 
  'After cleanup:' as status,
  job_id,
  jsonb_array_length(time_normalized_sales) as sales_count,
  pg_size_pretty(octet_length(time_normalized_sales::text)) as data_size
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0;

-- STEP 4: Show size reduction
WITH before_after AS (
  SELECT 
    job_id,
    jsonb_array_length(time_normalized_sales) as sales_count,
    octet_length(time_normalized_sales::text) as current_size
  FROM market_land_valuation 
  WHERE time_normalized_sales IS NOT NULL 
    AND jsonb_array_length(time_normalized_sales) > 0
)
SELECT 
  'Summary:' as status,
  SUM(sales_count) as total_sales_records,
  pg_size_pretty(SUM(current_size)) as total_size_after_cleanup
FROM before_after;

-- STEP 5: Verify essential fields are still there
SELECT 
  'Sample record after cleanup:' as status,
  jsonb_pretty(time_normalized_sales->0) as slimmed_record
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0
LIMIT 1;
