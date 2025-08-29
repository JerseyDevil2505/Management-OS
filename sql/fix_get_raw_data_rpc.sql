-- Fix the get_raw_data_for_property RPC function
-- The original function had issues with vendor_source detection

CREATE OR REPLACE FUNCTION get_raw_data_for_property(
    p_job_id uuid,
    p_property_composite_key text
) RETURNS jsonb AS $$
DECLARE
    v_raw_content text;
    v_vendor_type text;
    v_ccdd_code text;
    v_start_date date;
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
    v_year_created text;
    i integer;
BEGIN
    -- Get job data directly from jobs table
    SELECT 
        raw_file_content, 
        vendor_type,
        ccdd_code,
        start_date
    INTO 
        v_raw_content, 
        v_vendor_type,
        v_ccdd_code,
        v_start_date
    FROM jobs 
    WHERE id = p_job_id;
    
    -- Check if job exists and has raw content
    IF v_raw_content IS NULL THEN
        RAISE LOG 'No raw file content found for job %', p_job_id;
        RETURN NULL;
    END IF;
    
    -- Extract year for composite key
    v_year_created := EXTRACT(YEAR FROM v_start_date)::text;
    
    -- Split content into lines and remove empty lines
    v_lines := string_to_array(v_raw_content, E'\n');
    v_lines := array_remove(v_lines, '');
    v_lines := array_remove(v_lines, null);
    
    IF array_length(v_lines, 1) < 2 THEN
        RAISE LOG 'Not enough lines in raw content for job %', p_job_id;
        RETURN NULL;
    END IF;
    
    -- Detect vendor type from content if not set
    IF v_vendor_type IS NULL OR v_vendor_type = '' THEN
        IF v_lines[1] ILIKE '%BLOCK%' AND v_lines[1] ILIKE '%LOT%' AND v_lines[1] ILIKE '%QUALIFIER%' THEN
            v_vendor_type := 'BRT';
        ELSIF v_lines[1] ILIKE '%Block%' AND v_lines[1] ILIKE '%Lot%' AND v_lines[1] ILIKE '%Qual%' THEN
            v_vendor_type := 'Microsystems';
        ELSE
            v_vendor_type := 'Unknown';
        END IF;
    END IF;
    
    -- Detect separator
    IF v_vendor_type = 'Microsystems' THEN
        v_separator := '|';
    ELSIF position(chr(9) in v_lines[1]) > 0 THEN
        v_separator := chr(9); -- Tab
    ELSE
        v_separator := ','; -- Comma
    END IF;
    
    -- Parse headers
    v_headers := string_to_array(v_lines[1], v_separator);
    
    RAISE LOG 'Processing job % with vendor % and % headers', p_job_id, v_vendor_type, array_length(v_headers, 1);
    
    -- Search for matching record
    FOR i IN 2..array_length(v_lines, 1) LOOP
        IF v_lines[i] IS NULL OR trim(v_lines[i]) = '' THEN
            CONTINUE;
        END IF;
        
        -- Parse record values
        v_values := string_to_array(v_lines[i], v_separator);
        
        -- Skip if not enough values
        IF array_length(v_values, 1) != array_length(v_headers, 1) THEN
            CONTINUE;
        END IF;
        
        -- Generate composite key based on vendor
        IF v_vendor_type = 'BRT' THEN
            -- BRT format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
            v_block := coalesce(trim(v_values[array_position(v_headers, 'BLOCK')]), '');
            v_lot := coalesce(trim(v_values[array_position(v_headers, 'LOT')]), '');
            v_qualifier := coalesce(trim(v_values[array_position(v_headers, 'QUALIFIER')]), 'NONE');
            v_card := coalesce(trim(v_values[array_position(v_headers, 'CARD')]), 'NONE');
            v_location := coalesce(trim(v_values[array_position(v_headers, 'PROPERTY_LOCATION')]), 'NONE');
        ELSE
            -- Microsystems format: YEAR+CCDD-BLOCK-LOT_QUAL-BLDG-LOCATION
            v_block := coalesce(trim(v_values[array_position(v_headers, 'Block')]), '');
            v_lot := coalesce(trim(v_values[array_position(v_headers, 'Lot')]), '');
            v_qualifier := coalesce(trim(v_values[array_position(v_headers, 'Qual')]), 'NONE');
            v_card := coalesce(trim(v_values[array_position(v_headers, 'Bldg')]), 'NONE');
            v_location := coalesce(trim(v_values[array_position(v_headers, 'Location')]), 'NONE');
        END IF;
        
        -- Construct composite key
        v_composite_key := v_year_created || v_ccdd_code || '-' || v_block || '-' || v_lot || '_' || v_qualifier || '-' || v_card || '-' || v_location;
        
        -- Check if this matches our target property
        IF v_composite_key = p_property_composite_key THEN
            
            -- Build JSON object from headers and values
            v_raw_record := '{}';
            FOR i IN 1..array_length(v_headers, 1) LOOP
                IF i <= array_length(v_values, 1) THEN
                    v_raw_record := jsonb_set(
                        v_raw_record,
                        ARRAY[v_headers[i]],
                        to_jsonb(coalesce(v_values[i], ''))
                    );
                END IF;
            END LOOP;
            
            RAISE LOG 'Found match for property % in job %', p_property_composite_key, p_job_id;
            RETURN v_raw_record;
        END IF;
    END LOOP;
    
    RAISE LOG 'No match found for property % in job %', p_property_composite_key, p_job_id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
