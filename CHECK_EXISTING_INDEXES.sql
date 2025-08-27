-- =============================================================================
-- CHECK EXISTING INDEXES BEFORE ADDING NEW ONES
-- Run this FIRST in your Supabase SQL Editor
-- =============================================================================

-- 1. CHECK ALL INDEXES ON PROPERTY_RECORDS TABLE
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'property_records'
ORDER BY indexname;

-- 2. CHECK ALL INDEXES ON JOBS TABLE  
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'jobs'
ORDER BY indexname;

-- 3. CHECK ALL INDEXES ON INSPECTION_DATA TABLE
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'inspection_data'
ORDER BY indexname;

-- 4. CHECK IF OUR FUNCTIONS ALREADY EXIST
SELECT 
    routine_name,
    routine_type,
    specific_name
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
    'bulk_property_upsert_with_preservation',
    'get_properties_page',
    'bulk_inspection_data_upsert'
)
ORDER BY routine_name;

-- 5. CHECK FOR GIN INDEXES (JSONB performance)
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE indexdef ILIKE '%gin%'
AND tablename IN ('property_records', 'jobs', 'market_land_valuation')
ORDER BY tablename, indexname;

-- 6. SUMMARY OF ALL INDEXES COUNT BY TABLE
SELECT 
    tablename,
    COUNT(*) as index_count
FROM pg_indexes 
WHERE schemaname = 'public'
AND tablename IN (
    'property_records', 
    'jobs', 
    'inspection_data',
    'employees',
    'billing_events',
    'job_assignments'
)
GROUP BY tablename
ORDER BY index_count DESC;
