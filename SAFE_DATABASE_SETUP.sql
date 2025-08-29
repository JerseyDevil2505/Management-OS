-- =============================================================================
-- SAFE DATABASE SETUP - Checks for existing indexes and functions
-- =============================================================================

-- 1. SAFE FUNCTION CREATION (Drop if exists, then create)
-- =============================================================================

DROP FUNCTION IF EXISTS bulk_property_upsert_with_preservation;
CREATE OR REPLACE FUNCTION bulk_property_upsert_with_preservation(
  p_job_id uuid,
  p_properties jsonb,
  p_preserved_fields text[] DEFAULT ARRAY['project_start_date', 'is_assigned_property', 'validation_status', 'location_analysis', 'new_vcs', 'values_norm_time', 'values_norm_size', 'sales_history']
) RETURNS jsonb AS $$
DECLARE
  v_inserted_count integer := 0;
  v_preserved_count integer := 0;
  v_property jsonb;
BEGIN
  -- Create temp table for new data
  CREATE TEMP TABLE temp_properties (
    property_composite_key text PRIMARY KEY,
    data jsonb
  );
  
  -- Insert all properties into temp table
  FOR v_property IN SELECT * FROM jsonb_array_elements(p_properties)
  LOOP
    INSERT INTO temp_properties (property_composite_key, data)
    VALUES (v_property->>'property_composite_key', v_property);
  END LOOP;
  
  -- Perform UPSERT with preserved fields logic
  INSERT INTO property_records (
    job_id,
    property_composite_key,
    property_block,
    property_lot,
    property_qualifier,
    property_addl_card,
    property_location,
    owner_name,
    asset_design_style,
    asset_building_class,
    asset_sfla,
    inspection_info_by,
    raw_data,
    source_file_name,
    file_version,
    upload_date,
    processed_at,
    created_at,
    updated_at,
    vendor_source,
    validation_status,
    is_new_since_last_upload,
    project_start_date,
    is_assigned_property,
    values_norm_time,
    values_norm_size,
    sales_history,
    location_analysis,
    new_vcs
  )
  SELECT 
    p_job_id,
    tp.property_composite_key,
    tp.data->>'property_block',
    tp.data->>'property_lot',
    tp.data->>'property_qualifier',
    tp.data->>'property_addl_card',
    tp.data->>'property_location',
    tp.data->>'owner_name',
    tp.data->>'asset_design_style',
    tp.data->>'asset_building_class',
    (tp.data->>'asset_sfla')::numeric,
    tp.data->>'inspection_info_by',
    (tp.data->'raw_data')::jsonb,
    tp.data->>'source_file_name',
    (tp.data->>'file_version')::integer,
    (tp.data->>'upload_date')::timestamp,
    NOW(),
    NOW(),
    NOW(),
    tp.data->>'vendor_source',
    COALESCE(tp.data->>'validation_status', pr.validation_status),
    (tp.data->>'is_new_since_last_upload')::boolean,
    COALESCE((tp.data->>'project_start_date')::date, pr.project_start_date),
    COALESCE((tp.data->>'is_assigned_property')::boolean, pr.is_assigned_property),
    COALESCE((tp.data->>'values_norm_time')::numeric, pr.values_norm_time),
    COALESCE((tp.data->>'values_norm_size')::numeric, pr.values_norm_size),
    COALESCE((tp.data->'sales_history')::jsonb, pr.sales_history),
    COALESCE(tp.data->>'location_analysis', pr.location_analysis),
    COALESCE(tp.data->>'new_vcs', pr.new_vcs)
  FROM temp_properties tp
  LEFT JOIN property_records pr ON pr.property_composite_key = tp.property_composite_key AND pr.job_id = p_job_id
  ON CONFLICT (property_composite_key) DO UPDATE SET
    property_block = EXCLUDED.property_block,
    property_lot = EXCLUDED.property_lot,
    property_location = EXCLUDED.property_location,
    owner_name = EXCLUDED.owner_name,
    asset_design_style = EXCLUDED.asset_design_style,
    asset_building_class = EXCLUDED.asset_building_class,
    asset_sfla = EXCLUDED.asset_sfla,
    inspection_info_by = EXCLUDED.inspection_info_by,
    raw_data = EXCLUDED.raw_data,
    source_file_name = EXCLUDED.source_file_name,
    file_version = EXCLUDED.file_version,
    upload_date = EXCLUDED.upload_date,
    processed_at = EXCLUDED.processed_at,
    updated_at = EXCLUDED.updated_at,
    vendor_source = EXCLUDED.vendor_source,
    is_new_since_last_upload = EXCLUDED.is_new_since_last_upload,
    -- Preserve these fields if they exist
    project_start_date = EXCLUDED.project_start_date,
    is_assigned_property = EXCLUDED.is_assigned_property,
    values_norm_time = EXCLUDED.values_norm_time,
    values_norm_size = EXCLUDED.values_norm_size,
    sales_history = EXCLUDED.sales_history,
    location_analysis = EXCLUDED.location_analysis,
    new_vcs = EXCLUDED.new_vcs;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  DROP TABLE temp_properties;

  RETURN jsonb_build_object(
    'inserted_count', v_inserted_count,
    'preserved_count', v_preserved_count,
    'total_processed', jsonb_array_length(p_properties),
    'execution_time_ms', EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================

DROP FUNCTION IF EXISTS get_properties_page;
CREATE OR REPLACE FUNCTION get_properties_page(
  p_job_id uuid,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 100,
  p_assigned_only boolean DEFAULT false,
  p_order_by text DEFAULT 'property_composite_key'
) RETURNS jsonb AS $$
DECLARE
  v_total_count integer;
  v_properties jsonb;
  v_query text;
BEGIN
  -- Get total count first
  IF p_assigned_only THEN
    SELECT COUNT(*) INTO v_total_count 
    FROM property_records 
    WHERE job_id = p_job_id AND is_assigned_property = true;
  ELSE
    SELECT COUNT(*) INTO v_total_count 
    FROM property_records 
    WHERE job_id = p_job_id;
  END IF;
  
  -- Build dynamic query for properties
  v_query := 'SELECT jsonb_agg(
    jsonb_build_object(
      ''id'', id,
      ''property_composite_key'', property_composite_key,
      ''property_location'', property_location,
      ''owner_name'', owner_name,
      ''asset_design_style'', asset_design_style,
      ''asset_building_class'', asset_building_class,
      ''asset_sfla'', asset_sfla,
      ''inspection_info_by'', inspection_info_by,
      ''validation_status'', validation_status,
      ''is_assigned_property'', is_assigned_property
    )
  ) FROM (
    SELECT * FROM property_records 
    WHERE job_id = $1';
    
  IF p_assigned_only THEN
    v_query := v_query || ' AND is_assigned_property = true';
  END IF;
  
  v_query := v_query || ' ORDER BY ' || p_order_by || 
             ' LIMIT $2 OFFSET $3
  ) sub';
  
  EXECUTE v_query INTO v_properties USING p_job_id, p_limit, p_offset;
  
  RETURN jsonb_build_object(
    'properties', COALESCE(v_properties, '[]'::jsonb),
    'total_count', v_total_count,
    'offset', p_offset,
    'limit', p_limit,
    'has_more', (p_offset + p_limit) < v_total_count
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 2. SAFE INDEX CREATION (Only create if they don't exist)
-- =============================================================================

-- Check and create GIN index for raw_data
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_property_records_raw_data_gin'
    ) THEN
        CREATE INDEX CONCURRENTLY idx_property_records_raw_data_gin 
        ON property_records USING GIN (raw_data);
        RAISE NOTICE 'Created index: idx_property_records_raw_data_gin';
    ELSE
        RAISE NOTICE 'Index already exists: idx_property_records_raw_data_gin';
    END IF;
END
$$;

-- Check and create assignment filter index
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_property_records_assignment_filter'
    ) THEN
        CREATE INDEX CONCURRENTLY idx_property_records_assignment_filter 
        ON property_records (job_id, is_assigned_property) 
        WHERE is_assigned_property = true;
        RAISE NOTICE 'Created index: idx_property_records_assignment_filter';
    ELSE
        RAISE NOTICE 'Index already exists: idx_property_records_assignment_filter';
    END IF;
END
$$;

-- Check and create validation status index
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_property_records_validation_job'
    ) THEN
        CREATE INDEX CONCURRENTLY idx_property_records_validation_job 
        ON property_records (job_id, validation_status);
        RAISE NOTICE 'Created index: idx_property_records_validation_job';
    ELSE
        RAISE NOTICE 'Index already exists: idx_property_records_validation_job';
    END IF;
END
$$;

-- Check and create job_id index if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_property_records_job_id'
        AND tablename = 'property_records'
    ) THEN
        CREATE INDEX CONCURRENTLY idx_property_records_job_id 
        ON property_records (job_id);
        RAISE NOTICE 'Created index: idx_property_records_job_id';
    ELSE
        RAISE NOTICE 'Index already exists: idx_property_records_job_id';
    END IF;
END
$$;

-- =============================================================================
-- 3. GRANT PERMISSIONS TO AUTHENTICATED USERS
-- =============================================================================

GRANT EXECUTE ON FUNCTION bulk_property_upsert_with_preservation TO authenticated;
GRANT EXECUTE ON FUNCTION get_properties_page TO authenticated;

-- =============================================================================
-- 4. TEST THE FUNCTIONS
-- =============================================================================

-- Test streaming function (replace with actual job ID)
-- SELECT get_properties_page(
--   (SELECT id FROM jobs LIMIT 1),
--   0, 5, false, 'property_composite_key'
-- );

-- Show summary of what was created
SELECT 'DATABASE SETUP COMPLETE' as status;
SELECT 'Functions created: 2' as functions;
SELECT 'Indexes checked/created: 4' as indexes;
SELECT 'Ready for performance improvements!' as message;
