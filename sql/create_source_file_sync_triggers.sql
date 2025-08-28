-- =============================================================================
-- SOURCE FILE SYNC TRIGGERS AND FUNCTIONS
-- Automatically update property_records when jobs.source_file_content changes
-- =============================================================================

-- 1. CREATE FUNCTION TO EXTRACT RAW DATA FOR A SPECIFIC PROPERTY
-- =============================================================================
CREATE OR REPLACE FUNCTION get_raw_data_for_property(
    p_job_id uuid,
    p_property_composite_key text
) RETURNS jsonb AS $$
DECLARE
    v_source_content text;
    v_vendor_source text;
    v_lines text[];
    v_headers text[];
    v_separator text;
    v_record_line text;
    v_values text[];
    v_raw_record jsonb;
    v_block text;
    v_lot text;
    v_qualifier text;
    v_card text;
    v_location text;
    v_composite_key text;
    i integer;
BEGIN
    -- Get source file content and vendor type
    SELECT source_file_content, vendor_source 
    INTO v_source_content, v_vendor_source
    FROM jobs j
    LEFT JOIN property_records pr ON j.id = pr.job_id
    WHERE j.id = p_job_id
    LIMIT 1;
    
    IF v_source_content IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Split content into lines
    v_lines := string_to_array(v_source_content, E'\n');
    
    IF array_length(v_lines, 1) < 2 THEN
        RETURN NULL;
    END IF;
    
    -- Detect separator (comma vs pipe vs tab)
    IF v_vendor_source = 'Microsystems' THEN
        v_separator := '|';
    ELSIF v_lines[1] LIKE '%' || chr(9) || '%' THEN
        v_separator := chr(9); -- Tab
    ELSE
        v_separator := ','; -- Comma
    END IF;
    
    -- Parse headers
    v_headers := string_to_array(v_lines[1], v_separator);
    
    -- Search for matching record
    FOR i IN 2..array_length(v_lines, 1) LOOP
        IF v_lines[i] IS NULL OR trim(v_lines[i]) = '' THEN
            CONTINUE;
        END IF;
        
        -- Parse record values
        v_values := string_to_array(v_lines[i], v_separator);
        
        -- Generate composite key based on vendor
        IF v_vendor_source = 'BRT' THEN
            -- BRT format: BLOCK, LOT, QUALIFIER, CARD, PROPERTY_LOCATION
            v_block := coalesce(v_values[array_position(v_headers, 'BLOCK')], '');
            v_lot := coalesce(v_values[array_position(v_headers, 'LOT')], '');
            v_qualifier := coalesce(v_values[array_position(v_headers, 'QUALIFIER')], 'NONE');
            v_card := coalesce(v_values[array_position(v_headers, 'CARD')], 'NONE');
            v_location := coalesce(v_values[array_position(v_headers, 'PROPERTY_LOCATION')], 'NONE');
        ELSE
            -- Microsystems format: Block, Lot, Qual, Bldg, Location
            v_block := coalesce(v_values[array_position(v_headers, 'Block')], '');
            v_lot := coalesce(v_values[array_position(v_headers, 'Lot')], '');
            v_qualifier := coalesce(trim(v_values[array_position(v_headers, 'Qual')]), 'NONE');
            v_card := coalesce(trim(v_values[array_position(v_headers, 'Bldg')]), 'NONE');
            v_location := coalesce(trim(v_values[array_position(v_headers, 'Location')]), 'NONE');
        END IF;
        
        -- Construct composite key (simplified - real logic would need year/ccdd)
        v_composite_key := v_block || '-' || v_lot || '_' || v_qualifier || '-' || v_card || '-' || v_location;
        
        -- Check if this matches our target property
        IF v_composite_key = p_property_composite_key OR 
           p_property_composite_key LIKE '%' || v_composite_key || '%' THEN
            
            -- Build JSON object from headers and values
            v_raw_record := '{}';
            FOR i IN 1..array_length(v_headers, 1) LOOP
                IF i <= array_length(v_values, 1) THEN
                    v_raw_record := jsonb_set(
                        v_raw_record,
                        ARRAY[v_headers[i]],
                        to_jsonb(v_values[i])
                    );
                END IF;
            END LOOP;
            
            RETURN v_raw_record;
        END IF;
    END LOOP;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 2. CREATE FUNCTION TO REPROCESS PROPERTY RECORDS FROM SOURCE FILE
-- =============================================================================
CREATE OR REPLACE FUNCTION reprocess_property_records_from_source(
    p_job_id uuid
) RETURNS jsonb AS $$
DECLARE
    v_result jsonb;
    v_job_record record;
BEGIN
    -- Get job details
    SELECT * INTO v_job_record FROM jobs WHERE id = p_job_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Job not found');
    END IF;
    
    IF v_job_record.source_file_content IS NULL THEN
        RETURN jsonb_build_object('error', 'No source file content found');
    END IF;
    
    -- Log the reprocessing attempt
    INSERT INTO audit_log (
        table_name,
        record_id,
        action,
        changes,
        created_at
    ) VALUES (
        'jobs',
        p_job_id,
        'reprocess_from_source',
        jsonb_build_object(
            'trigger', 'source_file_content_updated',
            'vendor_source', v_job_record.vendor_source,
            'source_file_size', length(v_job_record.source_file_content)
        ),
        now()
    );
    
    -- Mark property records as needing reprocessing
    UPDATE property_records 
    SET 
        validation_status = 'needs_reprocessing',
        updated_at = now()
    WHERE job_id = p_job_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'message', 'Property records marked for reprocessing',
        'timestamp', now()
    );
END;
$$ LANGUAGE plpgsql;

-- 3. CREATE TRIGGER FUNCTION FOR SOURCE FILE CONTENT CHANGES
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_source_file_content_changed()
RETURNS trigger AS $$
BEGIN
    -- Only trigger if source_file_content actually changed
    IF OLD.source_file_content IS DISTINCT FROM NEW.source_file_content THEN
        -- Log the change
        INSERT INTO audit_log (
            table_name,
            record_id,
            action,
            changes,
            created_at
        ) VALUES (
            'jobs',
            NEW.id,
            'source_file_content_updated',
            jsonb_build_object(
                'old_size', coalesce(length(OLD.source_file_content), 0),
                'new_size', coalesce(length(NEW.source_file_content), 0),
                'vendor_source', NEW.vendor_source
            ),
            now()
        );
        
        -- Automatically reprocess property records
        PERFORM reprocess_property_records_from_source(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. CREATE THE ACTUAL TRIGGER
-- =============================================================================
DROP TRIGGER IF EXISTS jobs_source_file_content_changed ON jobs;

CREATE TRIGGER jobs_source_file_content_changed
    AFTER UPDATE ON jobs
    FOR EACH ROW
    WHEN (OLD.source_file_content IS DISTINCT FROM NEW.source_file_content)
    EXECUTE FUNCTION trigger_source_file_content_changed();

-- 5. CREATE AUDIT LOG TABLE IF IT DOESN'T EXIST
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- 6. CREATE APPLICATION-LEVEL REPROCESSING FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION app_reprocess_job_from_source(
    p_job_id uuid,
    p_force boolean DEFAULT false
) RETURNS jsonb AS $$
DECLARE
    v_job record;
    v_needs_reprocessing_count integer;
    v_result jsonb;
BEGIN
    -- Get job details
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Job not found'
        );
    END IF;
    
    -- Check if source file content exists
    IF v_job.source_file_content IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No source file content available for reprocessing'
        );
    END IF;
    
    -- Check if any records need reprocessing
    SELECT COUNT(*) INTO v_needs_reprocessing_count
    FROM property_records 
    WHERE job_id = p_job_id 
    AND (validation_status = 'needs_reprocessing' OR p_force = true);
    
    -- Log the manual reprocessing request
    INSERT INTO audit_log (
        table_name,
        record_id,
        action,
        changes,
        created_at
    ) VALUES (
        'jobs',
        p_job_id,
        'manual_reprocess_requested',
        jsonb_build_object(
            'force', p_force,
            'records_needing_reprocessing', v_needs_reprocessing_count,
            'vendor_source', v_job.vendor_source,
            'source_file_size', length(v_job.source_file_content)
        ),
        now()
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'job_id', p_job_id,
        'job_name', v_job.job_name,
        'vendor_source', v_job.vendor_source,
        'records_needing_reprocessing', v_needs_reprocessing_count,
        'message', CASE 
            WHEN v_needs_reprocessing_count > 0 OR p_force THEN 
                'Job queued for reprocessing - use application processors to complete'
            ELSE 
                'No records need reprocessing'
        END,
        'next_steps', CASE 
            WHEN v_needs_reprocessing_count > 0 OR p_force THEN 
                'Call propertyService.updateCSVData() or use FileUploadButton with same source file'
            ELSE 
                'No action needed'
        END
    );
END;
$$ LANGUAGE plpgsql;

-- 7. VERIFICATION QUERIES
-- =============================================================================

-- Check if triggers are active
SELECT 
    schemaname,
    tablename,
    triggername,
    triggerdef
FROM pg_triggers 
WHERE tablename = 'jobs' 
AND triggername = 'jobs_source_file_content_changed';

-- Test the get_raw_data_for_property function
-- (Replace with actual job_id and composite_key for testing)
-- SELECT get_raw_data_for_property(
--     'your-job-id-here'::uuid, 
--     'your-composite-key-here'
-- );

-- Test the app reprocessing function
-- SELECT app_reprocess_job_from_source('your-job-id-here'::uuid, false);

-- View audit log
SELECT * FROM audit_log 
WHERE table_name = 'jobs' 
AND action LIKE '%source%' 
ORDER BY created_at DESC 
LIMIT 10;

COMMIT;
