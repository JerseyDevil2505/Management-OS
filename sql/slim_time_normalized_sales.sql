-- =============================================================================
-- SLIM DOWN time_normalized_sales TO ESSENTIAL DISPLAY FIELDS ONLY
-- Keep only what's needed for the normalization table UI
-- =============================================================================

UPDATE market_land_valuation 
SET time_normalized_sales = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', sale->>'id',
      'property_composite_key', sale->>'property_composite_key',
      'property_block', sale->>'property_block',
      'property_lot', sale->>'property_lot', 
      'property_location', sale->>'property_location',
      'sales_price', (sale->>'sales_price')::numeric,
      'sales_date', sale->>'sales_date',
      'asset_sfla', (sale->>'asset_sfla')::numeric,
      'asset_year_built', (sale->>'asset_year_built')::integer,
      'time_normalized_price', (sale->>'time_normalized_price')::numeric,
      'hpi_multiplier', (sale->>'hpi_multiplier')::numeric,
      'sale_year', (sale->>'sale_year')::integer,
      'keep_reject', sale->>'keep_reject'
    )
  )
  FROM jsonb_array_elements(time_normalized_sales) as sale
)
WHERE time_normalized_sales IS NOT NULL;

-- Show the dramatic size reduction
SELECT 
  job_id,
  jsonb_array_length(time_normalized_sales) as sales_count,
  pg_size_pretty(octet_length(time_normalized_sales::text)) as new_size
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL;
