-- Step 1: Verify the functions were created successfully
SELECT 
    routine_name,
    routine_type,
    data_type as return_type
FROM information_schema.routines 
WHERE routine_name IN ('bulk_property_upsert_with_preservation', 'get_properties_page')
ORDER BY routine_name;

-- Step 2: Test the get_properties_page function with a basic query
SELECT get_properties_page(
    1,        -- job_id (use a real job ID from your jobs table)
    1,        -- page number
    50,       -- page size
    'all',    -- status filter
    '',       -- search term
    'id',     -- sort column
    'asc'     -- sort direction
);

-- Step 3: Verify all required indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('inspection_data', 'jobs', 'property_records')
    AND (indexname LIKE '%job_id%' 
         OR indexname LIKE '%status%' 
         OR indexname LIKE '%created%')
ORDER BY tablename, indexname;
