-- =============================================================================
-- PERFORMANCE OPTIMIZATION FUNCTIONS
-- Move heavy operations from client-side to database-side
-- =============================================================================

-- 1. BULK PROPERTY UPSERT WITH PRESERVED FIELDS (Replaces: preserved fields handler + batch upserts)
-- =============================================================================
CREATE OR REPLACE FUNCTION bulk_property_upsert_with_preservation(
  p_job_id uuid,
  p_properties jsonb,
  p_preserved_fields text[] DEFAULT ARRAY['project_start_date', 'is_assigned_property', 'validation_status', 'location_analysis', 'new_vcs', 'values_norm_time', 'values_norm_size', 'sales_history']
) RETURNS jsonb AS $$
DECLARE
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_preserved_count integer := 0;
  v_property jsonb;
  v_existing_record record;
  v_final_record jsonb;
  v_preserved_data jsonb;
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
    property_facility,
    property_cama_class,
    property_m4_class,
    property_vcs,
    owner_name,
    owner_street,
    owner_csz,
    asset_neighborhood,
    asset_design_style,
    asset_building_class,
    asset_type_use,
    asset_story_height,
    asset_year_built,
    asset_sfla,
    asset_lot_sf,
    asset_lot_acre,
    asset_lot_frontage,
    asset_lot_depth,
    asset_view,
    asset_zoning,
    asset_key_page,
    asset_map_page,
    asset_ext_cond,
    asset_int_cond,
    inspection_info_by,
    inspection_list_by,
    inspection_list_date,
    inspection_measure_by,
    inspection_measure_date,
    inspection_price_by,
    inspection_price_date,
    values_cama_land,
    values_cama_improvement,
    values_cama_total,
    values_mod_land,
    values_mod_improvement,
    values_mod_total,
    values_base_cost,
    values_repl_cost,
    values_det_items,
    values_norm_size,
    values_norm_time,
    sales_book,
    sales_page,
    sales_nu,
    sales_date,
    sales_price,
    sales_history,
    location_analysis,
    new_vcs,
    raw_data,
    source_file_name,
    source_file_uploaded_at,
    source_file_version_id,
    file_version,
    upload_date,
    processed_at,
    created_at,
    updated_at,
    created_by,
    vendor_source,
    project_start_date,
    is_assigned_property,
    validation_status,
    is_new_since_last_upload,
    code_file_updated_at,
    total_baths_calculated
  )
  SELECT 
    p_job_id,
    tp.property_composite_key,
    tp.data->>'property_block',
    tp.data->>'property_lot',
    tp.data->>'property_qualifier',
    tp.data->>'property_addl_card',
    tp.data->>'property_location',
    tp.data->>'property_facility',
    tp.data->>'property_cama_class',
    tp.data->>'property_m4_class',
    tp.data->>'property_vcs',
    tp.data->>'owner_name',
    tp.data->>'owner_street',
    tp.data->>'owner_csz',
    tp.data->>'asset_neighborhood',
    tp.data->>'asset_design_style',
    tp.data->>'asset_building_class',
    tp.data->>'asset_type_use',
    (tp.data->>'asset_story_height')::numeric,
    (tp.data->>'asset_year_built')::integer,
    (tp.data->>'asset_sfla')::numeric,
    (tp.data->>'asset_lot_sf')::numeric,
    (tp.data->>'asset_lot_acre')::numeric,
    (tp.data->>'asset_lot_frontage')::numeric,
    (tp.data->>'asset_lot_depth')::numeric,
    tp.data->>'asset_view',
    tp.data->>'asset_zoning',
    tp.data->>'asset_key_page',
    tp.data->>'asset_map_page',
    tp.data->>'asset_ext_cond',
    tp.data->>'asset_int_cond',
    tp.data->>'inspection_info_by',
    tp.data->>'inspection_list_by',
    (tp.data->>'inspection_list_date')::date,
    tp.data->>'inspection_measure_by',
    (tp.data->>'inspection_measure_date')::date,
    tp.data->>'inspection_price_by',
    (tp.data->>'inspection_price_date')::date,
    (tp.data->>'values_cama_land')::numeric,
    (tp.data->>'values_cama_improvement')::numeric,
    (tp.data->>'values_cama_total')::numeric,
    (tp.data->>'values_mod_land')::numeric,
    (tp.data->>'values_mod_improvement')::numeric,
    (tp.data->>'values_mod_total')::numeric,
    (tp.data->>'values_base_cost')::numeric,
    (tp.data->>'values_repl_cost')::numeric,
    (tp.data->>'values_det_items')::numeric,
    COALESCE((tp.data->>'values_norm_size')::numeric, pr.values_norm_size),
    COALESCE((tp.data->>'values_norm_time')::numeric, pr.values_norm_time),
    tp.data->>'sales_book',
    tp.data->>'sales_page',
    tp.data->>'sales_nu',
    (tp.data->>'sales_date')::date,
    (tp.data->>'sales_price')::numeric,
    COALESCE((tp.data->'sales_history')::jsonb, pr.sales_history),
    COALESCE(tp.data->>'location_analysis', pr.location_analysis),
    COALESCE(tp.data->>'new_vcs', pr.new_vcs),
    (tp.data->'raw_data')::jsonb,
    tp.data->>'source_file_name',
    (tp.data->>'source_file_uploaded_at')::timestamp,
    (tp.data->>'source_file_version_id')::uuid,
    (tp.data->>'file_version')::integer,
    (tp.data->>'upload_date')::timestamp,
    NOW(),
    NOW(),
    (tp.data->>'created_by')::uuid,
    tp.data->>'vendor_source',
    COALESCE((tp.data->>'project_start_date')::date, pr.project_start_date),
    COALESCE((tp.data->>'is_assigned_property')::boolean, pr.is_assigned_property),
    COALESCE(tp.data->>'validation_status', pr.validation_status),
    (tp.data->>'is_new_since_last_upload')::boolean,
    (tp.data->>'code_file_updated_at')::timestamp,
    (tp.data->>'total_baths_calculated')::numeric
  FROM temp_properties tp
  LEFT JOIN property_records pr ON pr.property_composite_key = tp.property_composite_key AND pr.job_id = p_job_id
  ON CONFLICT (property_composite_key) DO UPDATE SET
    property_block = EXCLUDED.property_block,
    property_lot = EXCLUDED.property_lot,
    property_qualifier = EXCLUDED.property_qualifier,
    property_addl_card = EXCLUDED.property_addl_card,
    property_location = EXCLUDED.property_location,
    property_facility = EXCLUDED.property_facility,
    property_cama_class = EXCLUDED.property_cama_class,
    property_m4_class = EXCLUDED.property_m4_class,
    property_vcs = EXCLUDED.property_vcs,
    owner_name = EXCLUDED.owner_name,
    owner_street = EXCLUDED.owner_street,
    owner_csz = EXCLUDED.owner_csz,
    asset_neighborhood = EXCLUDED.asset_neighborhood,
    asset_design_style = EXCLUDED.asset_design_style,
    asset_building_class = EXCLUDED.asset_building_class,
    asset_type_use = EXCLUDED.asset_type_use,
    asset_story_height = EXCLUDED.asset_story_height,
    asset_year_built = EXCLUDED.asset_year_built,
    asset_sfla = EXCLUDED.asset_sfla,
    asset_lot_sf = EXCLUDED.asset_lot_sf,
    asset_lot_acre = EXCLUDED.asset_lot_acre,
    asset_lot_frontage = EXCLUDED.asset_lot_frontage,
    asset_lot_depth = EXCLUDED.asset_lot_depth,
    asset_view = EXCLUDED.asset_view,
    asset_zoning = EXCLUDED.asset_zoning,
    asset_key_page = EXCLUDED.asset_key_page,
    asset_map_page = EXCLUDED.asset_map_page,
    asset_ext_cond = EXCLUDED.asset_ext_cond,
    asset_int_cond = EXCLUDED.asset_int_cond,
    inspection_info_by = EXCLUDED.inspection_info_by,
    inspection_list_by = EXCLUDED.inspection_list_by,
    inspection_list_date = EXCLUDED.inspection_list_date,
    inspection_measure_by = EXCLUDED.inspection_measure_by,
    inspection_measure_date = EXCLUDED.inspection_measure_date,
    inspection_price_by = EXCLUDED.inspection_price_by,
    inspection_price_date = EXCLUDED.inspection_price_date,
    values_cama_land = EXCLUDED.values_cama_land,
    values_cama_improvement = EXCLUDED.values_cama_improvement,
    values_cama_total = EXCLUDED.values_cama_total,
    values_mod_land = EXCLUDED.values_mod_land,
    values_mod_improvement = EXCLUDED.values_mod_improvement,
    values_mod_total = EXCLUDED.values_mod_total,
    values_base_cost = EXCLUDED.values_base_cost,
    values_repl_cost = EXCLUDED.values_repl_cost,
    values_det_items = EXCLUDED.values_det_items,
    -- Preserve these fields if they exist (don't overwrite user work)
    values_norm_size = EXCLUDED.values_norm_size,
    values_norm_time = EXCLUDED.values_norm_time,
    sales_history = EXCLUDED.sales_history,
    location_analysis = EXCLUDED.location_analysis,
    new_vcs = EXCLUDED.new_vcs,
    project_start_date = EXCLUDED.project_start_date,
    is_assigned_property = EXCLUDED.is_assigned_property,
    validation_status = EXCLUDED.validation_status,
    -- Always update these
    raw_data = EXCLUDED.raw_data,
    source_file_name = EXCLUDED.source_file_name,
    source_file_uploaded_at = EXCLUDED.source_file_uploaded_at,
    source_file_version_id = EXCLUDED.source_file_version_id,
    file_version = EXCLUDED.file_version,
    upload_date = EXCLUDED.upload_date,
    processed_at = EXCLUDED.processed_at,
    updated_at = EXCLUDED.updated_at,
    vendor_source = EXCLUDED.vendor_source,
    is_new_since_last_upload = EXCLUDED.is_new_since_last_upload,
    code_file_updated_at = EXCLUDED.code_file_updated_at,
    total_baths_calculated = EXCLUDED.total_baths_calculated;

  -- Get counts
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- Count preserved fields
  SELECT COUNT(*) INTO v_preserved_count
  FROM temp_properties tp
  INNER JOIN property_records pr ON pr.property_composite_key = tp.property_composite_key AND pr.job_id = p_job_id
  WHERE pr.project_start_date IS NOT NULL OR pr.is_assigned_property IS NOT NULL OR pr.validation_status IS NOT NULL;

  DROP TABLE temp_properties;

  RETURN jsonb_build_object(
    'inserted_count', v_inserted_count,
    'preserved_count', v_preserved_count,
    'total_processed', jsonb_array_length(p_properties),
    'execution_time_ms', EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000
  );
END;
$$ LANGUAGE plpgsql;

-- 2. BULK INSPECTION DATA UPSERT (Replaces: ProductionTracker massive client-side UPSERT)
-- =============================================================================
CREATE OR REPLACE FUNCTION bulk_inspection_data_upsert(
  p_job_id uuid,
  p_inspection_data jsonb
) RETURNS jsonb AS $$
DECLARE
  v_upserted_count integer := 0;
  v_inspection jsonb;
BEGIN
  -- Create temp table
  CREATE TEMP TABLE temp_inspections (
    property_composite_key text PRIMARY KEY,
    data jsonb
  );
  
  -- Insert all inspections into temp table
  FOR v_inspection IN SELECT * FROM jsonb_array_elements(p_inspection_data)
  LOOP
    INSERT INTO temp_inspections (property_composite_key, data)
    VALUES (v_inspection->>'property_composite_key', v_inspection);
  END LOOP;
  
  -- Perform bulk UPSERT
  INSERT INTO inspection_data (
    job_id,
    property_composite_key,
    block,
    lot,
    card,
    property_location,
    property_class,
    qualifier,
    info_by_code,
    list_by,
    list_date,
    measure_by,
    measure_date,
    price_by,
    price_date,
    project_start_date,
    upload_date,
    file_version,
    import_session_id,
    payroll_period_end,
    payroll_processed_date,
    override_applied,
    override_by,
    override_date,
    override_reason
  )
  SELECT 
    p_job_id,
    ti.property_composite_key,
    ti.data->>'block',
    ti.data->>'lot',
    ti.data->>'card',
    ti.data->>'property_location',
    ti.data->>'property_class',
    ti.data->>'qualifier',
    ti.data->>'info_by_code',
    ti.data->>'list_by',
    (ti.data->>'list_date')::date,
    ti.data->>'measure_by',
    (ti.data->>'measure_date')::date,
    ti.data->>'price_by',
    (ti.data->>'price_date')::date,
    (ti.data->>'project_start_date')::date,
    (ti.data->>'upload_date')::timestamp,
    (ti.data->>'file_version')::integer,
    (ti.data->>'import_session_id')::uuid,
    (ti.data->>'payroll_period_end')::date,
    (ti.data->>'payroll_processed_date')::date,
    (ti.data->>'override_applied')::boolean,
    ti.data->>'override_by',
    (ti.data->>'override_date')::timestamp,
    ti.data->>'override_reason'
  FROM temp_inspections ti
  ON CONFLICT (property_composite_key) DO UPDATE SET
    block = EXCLUDED.block,
    lot = EXCLUDED.lot,
    card = EXCLUDED.card,
    property_location = EXCLUDED.property_location,
    property_class = EXCLUDED.property_class,
    qualifier = EXCLUDED.qualifier,
    info_by_code = EXCLUDED.info_by_code,
    list_by = EXCLUDED.list_by,
    list_date = EXCLUDED.list_date,
    measure_by = EXCLUDED.measure_by,
    measure_date = EXCLUDED.measure_date,
    price_by = EXCLUDED.price_by,
    price_date = EXCLUDED.price_date,
    project_start_date = EXCLUDED.project_start_date,
    upload_date = EXCLUDED.upload_date,
    file_version = EXCLUDED.file_version,
    import_session_id = EXCLUDED.import_session_id,
    payroll_period_end = EXCLUDED.payroll_period_end,
    payroll_processed_date = EXCLUDED.payroll_processed_date,
    override_applied = EXCLUDED.override_applied,
    override_by = EXCLUDED.override_by,
    override_date = EXCLUDED.override_date,
    override_reason = EXCLUDED.override_reason;

  GET DIAGNOSTICS v_upserted_count = ROW_COUNT;
  
  DROP TABLE temp_inspections;

  RETURN jsonb_build_object(
    'upserted_count', v_upserted_count,
    'total_processed', jsonb_array_length(p_inspection_data),
    'execution_time_ms', EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000
  );
END;
$$ LANGUAGE plpgsql;

-- 3. PROPERTY COMPARISON ENGINE (Replaces: FileUploadButton client-side comparison)
-- =============================================================================
CREATE OR REPLACE FUNCTION compare_properties_with_csv(
  p_job_id uuid,
  p_new_properties jsonb
) RETURNS jsonb AS $$
DECLARE
  v_comparison_result jsonb;
  v_missing_count integer := 0;
  v_changed_count integer := 0;
  v_new_count integer := 0;
  v_sales_conflicts integer := 0;
BEGIN
  -- Create temp table for incoming data
  CREATE TEMP TABLE temp_new_properties (
    property_composite_key text PRIMARY KEY,
    data jsonb
  );
  
  -- Insert new properties
  FOR v_property IN SELECT * FROM jsonb_array_elements(p_new_properties)
  LOOP
    INSERT INTO temp_new_properties (property_composite_key, data)
    VALUES (v_property->>'property_composite_key', v_property);
  END LOOP;
  
  -- Find missing properties (in DB but not in CSV)
  CREATE TEMP TABLE missing_properties AS
  SELECT pr.property_composite_key, 
         jsonb_build_object(
           'property_composite_key', pr.property_composite_key,
           'property_location', pr.property_location,
           'owner_name', pr.owner_name
         ) as data
  FROM property_records pr
  WHERE pr.job_id = p_job_id
    AND pr.property_composite_key NOT IN (
      SELECT property_composite_key FROM temp_new_properties
    );
  
  -- Find changed properties  
  CREATE TEMP TABLE changed_properties AS
  SELECT tnp.property_composite_key,
         tnp.data as new_data,
         jsonb_build_object(
           'property_composite_key', pr.property_composite_key,
           'owner_name', pr.owner_name,
           'sales_price', pr.sales_price,
           'sales_date', pr.sales_date
         ) as old_data
  FROM temp_new_properties tnp
  INNER JOIN property_records pr ON pr.property_composite_key = tnp.property_composite_key
  WHERE pr.job_id = p_job_id
    AND (
      pr.owner_name != tnp.data->>'owner_name' OR
      pr.sales_price != (tnp.data->>'sales_price')::numeric OR
      pr.sales_date != (tnp.data->>'sales_date')::date
    );
  
  -- Find new properties
  CREATE TEMP TABLE new_properties AS
  SELECT tnp.property_composite_key, tnp.data
  FROM temp_new_properties tnp
  WHERE tnp.property_composite_key NOT IN (
    SELECT property_composite_key FROM property_records WHERE job_id = p_job_id
  );
  
  -- Count sales conflicts
  SELECT COUNT(*) INTO v_sales_conflicts
  FROM changed_properties
  WHERE (old_data->>'sales_price')::numeric != (new_data->>'sales_price')::numeric
     OR (old_data->>'sales_date')::date != (new_data->>'sales_date')::date;
  
  -- Get counts
  SELECT COUNT(*) INTO v_missing_count FROM missing_properties;
  SELECT COUNT(*) INTO v_changed_count FROM changed_properties;  
  SELECT COUNT(*) INTO v_new_count FROM new_properties;
  
  -- Build comparison result
  v_comparison_result := jsonb_build_object(
    'summary', jsonb_build_object(
      'missing_count', v_missing_count,
      'changed_count', v_changed_count,
      'new_count', v_new_count,
      'sales_conflicts', v_sales_conflicts,
      'total_csv_records', jsonb_array_length(p_new_properties)
    ),
    'missing_properties', (SELECT jsonb_agg(data) FROM missing_properties),
    'changed_properties', (SELECT jsonb_agg(jsonb_build_object('old', old_data, 'new', new_data)) FROM changed_properties),
    'new_properties', (SELECT jsonb_agg(data) FROM new_properties),
    'execution_time_ms', EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000
  );
  
  -- Cleanup
  DROP TABLE temp_new_properties;
  DROP TABLE missing_properties;
  DROP TABLE changed_properties;
  DROP TABLE new_properties;
  
  RETURN v_comparison_result;
END;
$$ LANGUAGE plpgsql;

-- 4. STREAMING PROPERTY LOADER (Replaces: JobContainer bulk loading)
-- =============================================================================
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
      ''sales_price'', sales_price,
      ''sales_date'', sales_date,
      ''inspection_info_by'', inspection_info_by,
      ''validation_status'', validation_status
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

-- 5. PERFORMANCE INDEXES FOR JSONB QUERIES
-- =============================================================================

-- Index for raw_data JSONB queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_raw_data_gin 
ON property_records USING GIN (raw_data);

-- Expression indexes for common JSONB field queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_raw_data_info_by 
ON property_records ((raw_data->>'inspection_info_by'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_raw_data_asset_type 
ON property_records ((raw_data->>'asset_type_use'));

-- Index for sales_history JSONB
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_sales_history_gin 
ON property_records USING GIN (sales_history);

-- Performance index for assignment queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_assignment_filter 
ON property_records (job_id, is_assigned_property) 
WHERE is_assigned_property = true;

-- Performance index for validation status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_records_validation_job 
ON property_records (job_id, validation_status);

-- 6. BACKGROUND JOB QUEUE SYSTEM
-- =============================================================================

-- Job queue table
CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type text NOT NULL,
  job_data jsonb NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at timestamp with time zone DEFAULT NOW(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  result jsonb,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3
);

-- Index for job processing
CREATE INDEX IF NOT EXISTS idx_background_jobs_processing 
ON background_jobs (status, created_at) 
WHERE status IN ('pending', 'processing');

-- Queue a file processing job
CREATE OR REPLACE FUNCTION queue_file_processing_job(
  p_job_id uuid,
  p_file_type text,
  p_file_data jsonb
) RETURNS uuid AS $$
DECLARE
  v_job_id uuid;
BEGIN
  INSERT INTO background_jobs (job_type, job_data)
  VALUES (
    'file_processing',
    jsonb_build_object(
      'job_id', p_job_id,
      'file_type', p_file_type,
      'file_data', p_file_data,
      'queued_at', NOW()
    )
  )
  RETURNING id INTO v_job_id;
  
  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Get job status
CREATE OR REPLACE FUNCTION get_job_status(p_job_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_job record;
BEGIN
  SELECT * INTO v_job FROM background_jobs WHERE id = p_job_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Job not found');
  END IF;
  
  RETURN jsonb_build_object(
    'id', v_job.id,
    'status', v_job.status,
    'created_at', v_job.created_at,
    'started_at', v_job.started_at,
    'completed_at', v_job.completed_at,
    'error_message', v_job.error_message,
    'result', v_job.result,
    'retry_count', v_job.retry_count
  );
END;
$$ LANGUAGE plpgsql;
