-- =============================================================================
-- CHECK WHAT'S STORED IN time_normalized_sales
-- This will show us how bloated the data is
-- =============================================================================

-- Check if we have any time_normalized_sales data
SELECT 
  job_id,
  jsonb_array_length(time_normalized_sales) as sales_count,
  pg_size_pretty(octet_length(time_normalized_sales::text)) as data_size
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0;

-- Look at the structure of a single sale record to see what fields are stored
SELECT 
  job_id,
  jsonb_pretty(time_normalized_sales->0) as first_sale_record_structure
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0
LIMIT 1;

-- Check for specific bloated fields we just moved
SELECT 
  job_id,
  CASE WHEN time_normalized_sales->0 ? 'raw_data' THEN 'HAS raw_data' ELSE 'NO raw_data' END as raw_data_check,
  CASE WHEN time_normalized_sales->0 ? 'location_analysis' THEN 'HAS location_analysis' ELSE 'NO location_analysis' END as location_check,
  CASE WHEN time_normalized_sales->0 ? 'new_vcs' THEN 'HAS new_vcs' ELSE 'NO new_vcs' END as vcs_check,
  CASE WHEN time_normalized_sales->0 ? 'sales_history' THEN 'HAS sales_history' ELSE 'NO sales_history' END as sales_history_check
FROM market_land_valuation 
WHERE time_normalized_sales IS NOT NULL 
  AND jsonb_array_length(time_normalized_sales) > 0
LIMIT 5;
