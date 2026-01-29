/**
 * Enhanced Microsystems Processor 
 * Handles pipe-delimited source files and field_id+code lookup files
 * UPDATED: Single table insertion to property_records with all 82 fields
 * NEW: Proper code file storage in jobs table with pipe-delimited format support
 * ADDED: Retry logic for connection issues and query cancellations
 * ENHANCED: Dual-pattern parsing for standard (140A) and HVAC (8ED) codes
 * FIXED: Proper AAACCCCSSSS parsing - InfoBy single char, Design multi-char, HVAC preserved
 * CLEANED: Removed redundant surgical fix totals (handled by AdminJobManagement/FileUploadButton)
 * CRITICAL: Added automatic cleanup for failed batches - prevents partial job creation!
 */

import { supabase } from '../supabaseClient.js';

export class MicrosystemsProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.headers = [];

    // Store all parsed codes for database storage
    this.allCodes = {};
    this.categories = {};

    // Store code configuration for categorizing detached items
    this.codeConfig = {};
  }

  /**
   * Auto-detect if file is Microsystems format
   */
  detectFileType(fileContent) {
    const firstLine = fileContent.split('\n')[0];
    const headers = firstLine.split('|');
    
    // Check for Microsystems signature headers
    return headers.includes('Block') && 
           headers.includes('Lot') && 
           headers.includes('Qual');
  }

  /**
   * CRITICAL FIX: Optimize batch for database performance
   */
  optimizeBatchForDatabase(batch) {
    return batch.map(record => {
      // Remove null/undefined values to reduce payload size
      const cleaned = {};
      for (const [key, value] of Object.entries(record)) {
        if (value !== null && value !== undefined && value !== '') {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });
  }

  /**
   * Insert batch with retry logic for connection issues
   */
  async insertBatchWithRetry(batch, batchNumber, retries = 50) {
    // CRITICAL FIX: Optimize batch before processing
    const optimizedBatch = this.optimizeBatchForDatabase(batch);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`Batch ${batchNumber}, attempt ${attempt}...`);
        
        // CRITICAL FIX: Optimize for 500+ records with timeout and minimal return
        const insertPromise = supabase
          .from('property_records')
          .insert(optimizedBatch, {
            count: 'exact',
            returning: 'minimal'  // Only return count, not full record data
          });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database timeout after 60 seconds')), 60000)
        );

        const { data, error } = await Promise.race([insertPromise, timeoutPromise]);
        
        if (!error) {
          console.log(`Batch ${batchNumber} successful on attempt ${attempt}`);
          return { success: true, data };
        }
        
        // Handle specific error codes
        if (error.code === '57014') {
          console.log(`Query canceled (57014) for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            continue;
          }
        } else if (error.code === '08003' || error.code === '08006') {
          console.log(`Connection error for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            continue;
          }
        } else {
          // For other errors, don't retry
          console.error(`Batch ${batchNumber} failed with non-retryable error:`, error);
          return { error };
        }
        
        // If we get here, it's the final attempt for a retryable error
        console.error(`Batch ${batchNumber} failed after ${retries} attempts:`, error);
        return { error };
        
      } catch (networkError) {
        console.log(`Network error for batch ${batchNumber}, attempt ${attempt}:`, networkError.message);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return { error: networkError };
      }
    }
  }

  /**
   * CRITICAL FIX: Store source file content in jobs table (eliminates raw_data duplication)
   */
  async storeSourceFileInDatabase(sourceFileContent, jobId) {
    try {
      console.log('💾 Storing complete Microsystems source file in jobs table...');

      const { error } = await supabase
        .from('jobs')
        .update({
          raw_file_content: sourceFileContent,
          raw_file_size: sourceFileContent.length,
          raw_file_rows_count: sourceFileContent.split('\n').length - 1, // Subtract header
          raw_file_parsed_at: new Date().toISOString()
        })
        .eq('id', jobId);

      if (error) {
        console.error('�� Error storing Microsystems source file in database:', error);
        throw error;
      }

      console.log('✅ Complete Microsystems source file stored successfully in jobs table');
    } catch (error) {
      console.error('❌ Failed to store Microsystems source file:', error);
      // Don't throw - continue with processing even if storage fails
    }
  }

  /**
   * FIXED: Process Microsystems code file with proper AAACCCCSSSS parsing
   * Handles pipe-delimited format: CODE|DESCRIPTION|RATE|CONSTANT|CATEGORY|TABLE|UPDATED
   * Examples: "140R   9999|REFUSED INT|0|0|INFORMATION|0|07/05/18|"
   *           "520CL  9999|COLONIAL|0|0|DESIGN|0|05/14/92|"
   *           "8FA16  0399|FORCED HOT AIR|4700|0|FORCED HOT AIR|E|06/24/02|"
   * FIXED: Proper parsing for InfoBy (single char) vs Design (multi-char) vs HVAC (preserved)
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('🔧 Processing Microsystems code file with FIXED AAACCCCSSSS parsing...');
    
    try {
      const lines = codeFileContent.split('\n').filter(line => line.trim());
      
      // Reset collections
      this.allCodes = {};
      this.categories = {};
      this.codeLookups.clear();
      
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        
        // Parse pipe-delimited format: CODE|DESC|RATE|CONSTANT|CATEGORY|TABLE|UPDATED
        const parts = trimmedLine.split('|');
        if (parts.length < 5) return; // Need at least CODE|DESC|RATE|CONSTANT|CATEGORY
        
        const fullCode = parts[0].trim();
        const description = parts[1].trim();
        const rate = parts[2].trim();
        const constant = parts[3].trim();
        const category = parts[4].trim();
        const table = parts[5] ? parts[5].trim() : '';
        const updated = parts[6] ? parts[6].trim() : '';
        
        if (!fullCode || !description) return;
        
        // FIXED: AAACCCCSSSS parsing logic
        let prefix, suffix;
        const firstChar = fullCode.substring(0, 1);
        
        if (firstChar === '8') {
          // HVAC pattern: 8 + 2 character code + rest is ignored (PRESERVED)
          // Example: "8ED16  0399" → prefix="8", suffix="ED"
          prefix = '8';
          suffix = fullCode.substring(1, 3); // Extract exactly 2 characters after '8'
        } else {
          // Standard pattern: AAACCCCSSSS format
          prefix = fullCode.substring(0, 3); // First 3 characters (category)
          const afterPrefix = fullCode.substring(3); // Everything after category
          
          if (prefix === '140') {
            // InfoBy codes: single character only (old system limitation)
            // Example: "140R   9999" �� suffix="R"
            suffix = afterPrefix.charAt(0);
          } else {
            // Other codes: extract letters OR numbers (with decimals) until space
            // Example: "520CL  9999" → suffix="CL"
            // Example: "5101.5  9999" → suffix="1.5"
            // Example: "5101  9999" → suffix="1"
            const letterMatch = afterPrefix.match(/^[A-Z]+/);
            const numberMatch = afterPrefix.match(/^[\d.]+/);
            suffix = letterMatch ? letterMatch[0] : (numberMatch ? numberMatch[0] : afterPrefix.charAt(0));
          }
        }
        
        if (prefix && suffix) {
          // Store full code with description for lookup
          this.codeLookups.set(fullCode, description);
          
          // Store clean suffix for CSV lookup (this is what appears in source data)
          this.codeLookups.set(suffix, description);
          
          // Organize by prefix for database storage
          if (!this.allCodes[prefix]) {
            this.allCodes[prefix] = {};
          }
          
          this.allCodes[prefix][suffix] = {
            description: description,
            rate: rate,
            constant: constant,
            category: category,
            table: table,
            updated: updated,
            full_code: fullCode
          };
          
          // Store category mapping
          this.categories[prefix] = category;
          
        } else {
          // Handle codes that don't match either pattern (direct codes)
          this.codeLookups.set(fullCode, description);
          
          if (!this.allCodes['direct']) {
            this.allCodes['direct'] = {};
          }
          
          this.allCodes['direct'][fullCode] = {
            description: description,
            rate: rate,
            constant: constant,
            category: category,
            table: table,
            updated: updated,
            full_code: fullCode
          };
        }
      });
      
      console.log(`✅ Loaded ${this.codeLookups.size} code definitions with FIXED AAACCCCSSSS parsing`);
      console.log(`📂 Organized into ${Object.keys(this.allCodes).length} field groups`);
      console.log(`🎯 InfoBy codes (140 prefix): ${Object.keys(this.allCodes['140'] || {}).join(', ')}`);
      console.log(`🏠 HVAC codes (8 prefix): ${Object.keys(this.allCodes['8'] || {}).join(', ')}`);
      console.log(`🏗️ Design codes (520 prefix): ${Object.keys(this.allCodes['520'] || {}).join(', ')}`);
      
      // Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('❌ Error parsing Microsystems code file:', error);
      throw error;
    }
  }

  /**
   * Store code file content and parsed definitions in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing Microsystems code file in jobs table...');
      
      // Clean Unicode null characters that PostgreSQL can't handle
      const cleanedCodeContent = codeFileContent
        .replace(/\u0000/g, '') // Remove null characters
        .replace(/\x00/g, '')   // Remove hex null characters
        .trim();
      
      const updatePayload = {
        code_file_content: cleanedCodeContent,
        code_file_name: 'Microsystems_Code_File.txt',
        code_file_uploaded_at: new Date().toISOString(),
        parsed_code_definitions: {
          vendor_type: 'Microsystems',
          field_codes: this.allCodes,
          categories: this.categories,
          flat_lookup: Object.fromEntries(this.codeLookups),
          summary: {
            total_codes: this.codeLookups.size,
            field_groups: Object.keys(this.allCodes).length,
            categories: Object.keys(this.categories).length,
            parsed_at: new Date().toISOString(),
            parsing_method: 'fixed_aaaccccssss'
          }
        }
      };
      
      const { data: updateData, error: updateError } = await supabase
        .from('jobs')
        .update(updatePayload)
        .eq('id', jobId)
        .select('id, code_file_name, code_file_uploaded_at');

      if (updateError) {
        console.error('❌ Code file storage failed:', updateError);
        throw updateError;
      }
      
      console.log('✅ Microsystems code file stored successfully');
      
    } catch (error) {
      console.error('❌ Failed to store Microsystems code file:', error);
      console.log('Continuing with job creation despite code storage failure...');
    }
  }

  /**
   * Parse pipe-delimited Microsystems file
   */
  parseSourceFile(fileContent) {
    console.log('Parsing Microsystems source file...');
    
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('File must have at least header and one data row');
    }
    
    // Parse headers and rename duplicates
    const originalHeaders = lines[0].split('|');
    this.headers = this.renameDuplicateHeaders(originalHeaders);
    
    console.log(`Found ${this.headers.length} headers with duplicates renamed`);
    
    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|');
      
      if (values.length !== this.headers.length) {
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - possibly broken pipes`);
        continue;
      }
      
      // Create record object with renamed headers
      const record = {};
      this.headers.forEach((header, index) => {
        record[header] = values[index] || null;
      });
      
      records.push(record);
    }
    
    console.log(`Parsed ${records.length} records`);
    return records;
  }

  /**
   * Rename duplicate headers by adding numbers
   */
  renameDuplicateHeaders(originalHeaders) {
    const headerCounts = {};
    return originalHeaders.map(header => {
      if (headerCounts[header]) {
        headerCounts[header]++;
        return `${header}${headerCounts[header]}`;
      } else {
        headerCounts[header] = 1;
        return header;
      }
    });
  }

  /**
   * Map Microsystems record to property_records table (ALL 82 FIELDS)
   * UPDATED: Combines original property_records + analysis fields into single record
   * UPDATED: Added yearPriorToDueYear parameter for effective age conversion
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}, yearPriorToDueYear = null) {
    return {
      // Job context
      job_id: jobId,

      // Property identifiers
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_location: rawRecord['Location'], // Direct mapping to first Location
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`,
      property_cama_class: null, //Not available in Microsystems
      property_m4_class: rawRecord['Class'],
      property_facility: rawRecord['Facility Name'],
      property_vcs: rawRecord['VCS'],

      // Owner fields
      owner_name: rawRecord['Owner Name'],
      owner_street: rawRecord['Owner Street'],
      owner_csz: rawRecord['Owner Csz'],

      // Sales fields
      sales_date: this.parseDate(rawRecord['Sale Date']),
      sales_price: this.parseNumeric(rawRecord['Sale Price']),
      sales_book: rawRecord['Sale Book'],
      sales_page: rawRecord['Sale Page'],
      sales_nu: rawRecord['Sale Nu'],

      // Values - Direct mapping to renamed headers
      values_mod_land: this.parseNumeric(rawRecord['Land Value']), // First instance
      values_cama_land: this.parseNumeric(rawRecord['Land Value2']), // Second instance
      values_mod_improvement: this.parseNumeric(rawRecord['Impr Value']), // First instance
      values_cama_improvement: this.parseNumeric(rawRecord['Impr Value2']), // Second instance
      values_mod_total: this.parseNumeric(rawRecord['Totl Value']), // First instance
      values_cama_total: this.parseNumeric(rawRecord['Totl Value2']), // Second instance
      values_base_cost: this.parseNumeric(rawRecord['Base Cost']),
      values_det_items: this.parseNumeric(rawRecord['Det Items']),
      values_repl_cost: this.parseNumeric(rawRecord['Cost New']),

      // Inspection fields
      inspection_info_by: rawRecord['Interior Finish3'], // Store letter codes directly (E, F, O, R, V)
      inspection_list_by: rawRecord['Insp By'],
      inspection_list_date: this.parseDate(rawRecord['Insp Date']),
      inspection_measure_by: rawRecord['Measured By'],
      inspection_measure_date: this.parseDate(rawRecord['Insp Date 1']),
      inspection_price_by: null, // Not available in Microsystems
      inspection_price_date: null, // Not available in Microsystems

      // Asset fields - All analysis fields now in single table
      asset_building_class: rawRecord['Bldg Qual Class Code'],
      asset_design_style: rawRecord['Style Code'],
      asset_ext_cond: rawRecord['Condition'],
      asset_int_cond: rawRecord['Interior Cond Or End Unit'],
      asset_lot_acre: this.parseNumeric(rawRecord['Lot Size In Acres'], 2),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.parseInteger(rawRecord['Lot Size In Sf']),
      asset_neighborhood: rawRecord['Neighborhood'],
      asset_sfla: this.parseNumeric(rawRecord['Livable Area']),
      asset_story_height: rawRecord['Story Height'] || null,  // Keep as text for floor analysis
      asset_type_use: rawRecord['Type Use Code'],
      asset_view: null, // Not available in Microsystems
      asset_year_built: this.parseInteger(rawRecord['Year Built']),
      asset_effective_age: this.calculateEffectiveYear(rawRecord['Effective Age'], yearPriorToDueYear),  // Microsystems: Convert age to year
      asset_bedrooms: this.parseInteger(rawRecord['Total Bedrms']),

      // Special tax district codes (Microsystems: Sp Tax Cd1 and Sp Tax Cd2)
      special_tax_code_1: rawRecord['Sp Tax Cd1'] || null,
      special_tax_code_2: rawRecord['Sp Tax Cd2'] || null,
      special_tax_code_3: null, // Not available in Microsystems
      special_tax_code_4: null, // Not available in Microsystems

      // Analysis and calculation fields
      // REMOVED: location_analysis, new_vcs, asset_map_page, asset_key_page,
      //          asset_zoning, values_norm_size, values_norm_time
      //          (moved to property_market_analysis table)
      total_baths_calculated: this.calculateTotalBaths(rawRecord),

      // Normalized amenity area fields (extracted from Microsystems columns)
      fireplace_count: this.extractFireplaceCount(rawRecord),
      basement_area: this.extractBasementArea(rawRecord),
      fin_basement_area: this.extractFinBasementArea(rawRecord),
      garage_area: this.extractGarageArea(rawRecord),
      deck_area: this.extractDeckArea(rawRecord),
      patio_area: this.extractPatioArea(rawRecord),
      open_porch_area: this.extractOpenPorchArea(rawRecord),
      enclosed_porch_area: this.extractEnclosedPorchArea(rawRecord),
      det_garage_area: this.extractDetGarageArea(rawRecord),
      pool_area: this.extractPoolArea(rawRecord),
      ac_area: this.extractAcArea(rawRecord),

      // Store raw detached items for code-based categorization
      raw_detached_items: JSON.stringify(this.extractDetachedItems(rawRecord)),

      // Processing metadata
      processed_at: new Date().toISOString(),
      is_new_since_last_upload: true,
      
      // File tracking with version info
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      code_file_updated_at: versionInfo.code_file_updated_at || new Date().toISOString(),
      file_version: versionInfo.file_version || 1,
      upload_date: new Date().toISOString(),
      
      // Payroll and project tracking
      // REMOVED: project_start_date (moved to jobs table)
      
      // System metadata
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      
    };
  }

  /**
   * Calculate property class totals for jobs table
   * Microsystems property classes: 2=Residential, 3A=Residential, 4A/4B/4C=Commercial
   */
  calculatePropertyTotals(records) {
    let totalresidential = 0;
    let totalcommercial = 0;
    
    for (const record of records) {
      const propertyClass = record['Class'];
      
      if (propertyClass === '2' || propertyClass === '3A') {
        totalresidential++;
      } else if (propertyClass === '4A' || propertyClass === '4B' || propertyClass === '4C') {
        totalcommercial++;
      }
      // Other classes (1, 3B, 5A, 5B, etc.) not counted in either category
    }
    
    console.log(`Property totals calculated: ${totalresidential} residential, ${totalcommercial} commercial`);
    return { totalresidential, totalcommercial };
  }

  /**
   * Update jobs table with property class totals (NOT total_properties)
   */
  async updateJobTotals(jobId, totalresidential, totalcommercial) {
    try {
      console.log(`Updating job ${jobId} with totals: ${totalresidential} residential, ${totalcommercial} commercial`);
      
      const { data, error } = await supabase
        .from('jobs')
        .update({
          totalresidential: totalresidential,
          totalcommercial: totalcommercial
          // NOTE: total_properties handled by AdminJobManagement/FileUploadButton
        })
        .eq('id', jobId);

      if (error) {
        console.error('Failed to update job totals:', error);
        throw error;
      }

      console.log('Job totals updated successfully');
      
    } catch (error) {
      console.error('Error updating job totals:', error);
      // Don't throw - continue processing even if update fails
    }
  }

  /**
   * Load code configuration from job_settings to categorize detached items
   */
  async loadCodeConfiguration(jobId) {
    try {
      const { data, error } = await supabase
        .from('job_settings')
        .select('setting_key, setting_value')
        .eq('job_id', jobId)
        .in('setting_key', [
          'adjustment_codes_det_garage',
          'adjustment_codes_pool',
          'adjustment_codes_barn',
          'adjustment_codes_stable',
          'adjustment_codes_pole_barn'
        ]);

      if (error) {
        console.log('⚠️ No code configuration found - detached items will not be categorized');
        this.codeConfig = {};
        return;
      }

      // Parse saved configuration
      const config = {};
      (data || []).forEach(setting => {
        const attributeId = setting.setting_key.replace('adjustment_codes_', '');
        try {
          config[attributeId] = setting.setting_value ? JSON.parse(setting.setting_value) : [];
        } catch (e) {
          config[attributeId] = [];
        }
      });

      this.codeConfig = config;
      console.log('✅ Loaded code configuration for detached items:', this.codeConfig);
    } catch (error) {
      console.error('Error loading code configuration:', error);
      this.codeConfig = {};
    }
  }

  /**
   * ENHANCED: Process complete file and store in database with code file integration
   * UPDATED: Single table insertion only - no more dual-table complexity
   * NEW: Integrates code file storage in jobs table
   * ADDED: Retry logic for connection issues and query cancellations
   * RESTORED: totalresidential and totalcommercial calculations (total_properties handled by AdminJobManagement/FileUploadButton)
   * CRITICAL: Added automatic cleanup for failed batches - prevents partial job creation!
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    // Track successful batches for cleanup
    const successfulBatches = [];
    const processingTimestamp = new Date().toISOString();
    
    try {
      console.log('🚀 Starting Enhanced Microsystems file processing with CLEANUP support...');

      // CRITICAL FIX: Store source file content in jobs table
      await this.storeSourceFileInDatabase(sourceFileContent, jobId);

      // Process and store code file if provided
      if (codeFileContent) {
        await this.processCodeFile(codeFileContent, jobId);
      }

      // Fetch job data to calculate yearPriorToDueYear for effective age conversion
      let yearPriorToDueYear = null;
      try {
        const { data: jobData, error: jobError } = await supabase
          .from('jobs')
          .select('end_date')
          .eq('id', jobId)
          .single();

        if (!jobError && jobData?.end_date) {
          const endYear = new Date(jobData.end_date).getFullYear();
          yearPriorToDueYear = endYear - 1;
          console.log(`📅 Calculated yearPriorToDueYear: ${yearPriorToDueYear} (from end_date: ${jobData.end_date})`);
        } else {
          console.warn('⚠️ Could not fetch job end_date, effective age conversion will be skipped');
        }
      } catch (error) {
        console.error('❌ Error fetching job data for effective age calculation:', error);
      }

      // Parse source file
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in batches...`);
      
      // Calculate property totals BEFORE processing
      const { totalresidential, totalcommercial } = this.calculatePropertyTotals(records);
      
      // Prepare all property records for batch insert
      const propertyRecords = [];
      
      for (const rawRecord of records) {
        try {
          // Map to unified property_records table with all 82 fields
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo, yearPriorToDueYear);
          propertyRecords.push(propertyRecord);
          
        } catch (error) {
          console.error('Error mapping record:', error);
        }
      }
      
      const results = {
        processed: 0,
        errors: 0,
        warnings: []
      };
      
      console.log(`Batch inserting ${propertyRecords.length} property records...`);
      const batchSize = 250; // Optimized for stability and error resilience
      let consecutiveErrors = 0;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(propertyRecords.length / batchSize);
        
        console.log(`🚀 Processing batch ${batchNumber} of ${totalBatches}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
        const result = await this.insertBatchWithRetry(batch, batchNumber);
        
        if (result.error) {
          console.error(`❌ Batch ${batchNumber} failed after retries:`, result.error);
          
          // CRITICAL: Clean up all successful batches with 50 retries each!
          console.log(`❌ Batch ${batchNumber} failed - cleaning up ${successfulBatches.length} successful batches...`);
          
          let cleanupFailures = 0;
          
          for (const successBatch of successfulBatches.reverse()) {
            let cleanupSuccess = false;
            
            // Try up to 50 times to cleanup each batch
            for (let cleanupAttempt = 1; cleanupAttempt <= 50; cleanupAttempt++) {
              try {
                console.log(`🔄 Cleanup attempt ${cleanupAttempt} for batch ${successBatch.batchNumber}...`);
                
                const { error } = await supabase
                  .from('property_records')
                  .delete()
                  .eq('job_id', jobId)
                  .gte('created_at', successBatch.timestamp);
                
                if (!error) {
                  console.log(`✅ Successfully cleaned up batch ${successBatch.batchNumber} on attempt ${cleanupAttempt}`);
                  cleanupSuccess = true;
                  break;
                }
                
                // Handle specific error codes
                if (error.code === '57014' || error.code === '08003' || error.code === '08006' || 
                    error.message.includes('connection') || error.message.includes('timeout')) {
                  console.log(`⚠️ Retryable error during cleanup of batch ${successBatch.batchNumber}, attempt ${cleanupAttempt}: ${error.message}`);
                  if (cleanupAttempt < 50) {
                    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * cleanupAttempt, 10000))); // Exponential backoff up to 10s
                    continue;
                  }
                } else {
                  console.error(`❌ Non-retryable error during cleanup: ${error.message}`);
                  break;
                }
                
              } catch (networkError) {
                console.error(`🌐 Network error during cleanup attempt ${cleanupAttempt}:`, networkError);
                if (cleanupAttempt < 50) {
                  await new Promise(resolve => setTimeout(resolve, Math.min(1000 * cleanupAttempt, 10000)));
                  continue;
                }
              }
            }
            
            if (!cleanupSuccess) {
              cleanupFailures++;
              console.error(`❌ FAILED to cleanup batch ${successBatch.batchNumber} after 50 attempts!`);
            }
          }
          
          // Verify cleanup completion
          try {
            const { count, error: verifyError } = await supabase
              .from('property_records')
              .select('*', { count: 'exact', head: true })
              .eq('job_id', jobId)
              .gte('created_at', processingTimestamp);
            
            if (!verifyError) {
              if (count === 0) {
                console.log('✅ Cleanup verification: All partial records successfully removed');
              } else {
                console.warn(`⚠️ Cleanup verification: ${count} records still exist for job ${jobId}`);
              }
            }
          } catch (verifyError) {
            console.error('Could not verify cleanup:', verifyError);
          }
          
          const cleanupMessage = cleanupFailures > 0 
            ? `Job creation failed and cleanup attempted - ${successfulBatches.length - cleanupFailures} of ${successfulBatches.length} batches cleaned up successfully. WARNING: ${cleanupFailures} batches may need manual cleanup!`
            : `Job creation failed and all partial data cleaned up - all ${successfulBatches.length} batches removed.`;
          
          throw new Error(`${cleanupMessage} Original error: ${result.error.message}`);
          
        } else {
          results.processed += batch.length;
          console.log(`✅ Batch ${batchNumber} completed successfully (${results.processed}/${propertyRecords.length} total)`);
          
          // Track successful batch for potential cleanup
          successfulBatches.push({
            batchNumber,
            startIndex: i,
            endIndex: Math.min(i + batchSize, propertyRecords.length),
            timestamp: new Date().toISOString()
          });
          
          // Reset error counter on success
          consecutiveErrors = 0;
          
          // Small delay between successful batches
          if (i + batchSize < propertyRecords.length) {
            console.log(`⏳ Pausing 0.5s before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
      // Update jobs table with property totals AFTER successful processing
      if (results.processed > 0) {
        await this.updateJobTotals(jobId, totalresidential, totalcommercial);
      }
      
      console.log('🚀 Enhanced Microsystems processing complete:', results);
      return results;
      
    } catch (error) {
      console.error('❌ Enhanced Microsystems file processing failed:', error);
      throw error;
    }
  }

  /**
   * Calculate effective year from Microsystems "Effective Age" field
   * Microsystems stores age in years, convert to year: yearPriorToDueYear - effectiveAge
   */
  calculateEffectiveYear(effectiveAgeValue, yearPriorToDueYear) {
    if (!effectiveAgeValue || effectiveAgeValue === '') return null;
    if (!yearPriorToDueYear) return null;

    const effectiveAge = this.parseNumeric(effectiveAgeValue);
    if (!effectiveAge || isNaN(effectiveAge)) return null;

    // Convert age to year: Year Prior to Due Year - Effective Age
    const effectiveYear = yearPriorToDueYear - effectiveAge;
    return Math.round(effectiveYear);
  }

  /**
   * Calculate total bathrooms - corrected weighting
   * 4 & 3 fixture = full baths (1.0), 2 fixture = half bath (0.5), single fixture not counted
   */
  calculateTotalBaths(rawRecord) {
    let total = 0;
    
    // Full bathrooms (1.0 weight each)
    total += (this.parseNumeric(rawRecord['4 Fixture Bath']) || 0) * 1.0;
    total += (this.parseNumeric(rawRecord['3 Fixture Bath']) || 0) * 1.0;
    
    // Half bathrooms (0.5 weight each)
    total += (this.parseNumeric(rawRecord['2 Fixture Bath']) || 0) * 0.5;
    
    // Single fixture not counted
    
    return total > 0 ? total : null;
  }

  /**
   * Extract fireplace count from Microsystems fields
   * Sum of: Fireplace 1 Story Stack, Fp 1 And Half Sty, Fp 2 Sty, Fp Same Stack, Fp Heatilator
   */
  extractFireplaceCount(rawRecord) {
    let total = 0;
    total += this.parseInteger(rawRecord['Fireplace 1 Story Stack']) || 0;
    total += this.parseInteger(rawRecord['Fp 1 And Half Sty']) || 0;
    total += this.parseInteger(rawRecord['Fp 2 Sty']) || 0;
    total += this.parseInteger(rawRecord['Fp Same Stack']) || 0;
    total += this.parseInteger(rawRecord['Fp Heatilator']) || 0;
    total += this.parseInteger(rawRecord['Fp Freestanding']) || 0;
    return total > 0 ? total : null;
  }

  /**
   * Extract basement area from Basement field
   */
  extractBasementArea(rawRecord) {
    return this.parseNumeric(rawRecord['Basement']);
  }

  /**
   * Extract finished basement area from Bsmt Finish Sq Ft
   * If value contains %, it's a percentage of total basement area
   */
  extractFinBasementArea(rawRecord) {
    const basementArea = this.parseNumeric(rawRecord['Basement']) || 0;
    const finishValue = rawRecord['Bsmt Finish Sq Ft'];

    if (!finishValue || finishValue.trim() === '') return null;

    // Check if it's a percentage
    if (finishValue.includes('%')) {
      const percentage = parseFloat(finishValue.replace('%', '').trim());
      if (!isNaN(percentage) && basementArea > 0) {
        return Math.round(basementArea * (percentage / 100));
      }
    } else {
      // It's actual square footage
      const sqft = this.parseNumeric(finishValue);
      return sqft;
    }

    return null;
  }

  /**
   * Extract deck area
   */
  extractDeckArea(rawRecord) {
    return this.parseNumeric(rawRecord['Deck']);
  }

  /**
   * Extract patio area (sum of Patio and Terr)
   */
  extractPatioArea(rawRecord) {
    const patio = this.parseNumeric(rawRecord['Patio']) || 0;
    const terr = this.parseNumeric(rawRecord['Terr']) || 0;
    const total = patio + terr;
    return total > 0 ? total : null;
  }

  /**
   * Extract open porch area (sum of Op, Bi Op, Bi Op2, Bi Gp, and Porch)
   */
  extractOpenPorchArea(rawRecord) {
    let total = 0;
    total += this.parseNumeric(rawRecord['Op']) || 0;
    total += this.parseNumeric(rawRecord['Bi Op']) || 0;
    total += this.parseNumeric(rawRecord['Bi Op2']) || 0;
    total += this.parseNumeric(rawRecord['Bi Gp']) || 0;
    total += this.parseNumeric(rawRecord['Porch']) || 0;
    return total > 0 ? total : null;
  }

  /**
   * Extract enclosed porch area (sum of Ep and Bi Ep)
   */
  extractEnclosedPorchArea(rawRecord) {
    const ep = this.parseNumeric(rawRecord['Ep']) || 0;
    const biEp = this.parseNumeric(rawRecord['Bi Ep']) || 0;
    const total = ep + biEp;
    return total > 0 ? total : null;
  }

  /**
   * Extract garage area (sum of Attgar, Attgar2, Bi Ga, Big, Big2, Big3)
   */
  extractGarageArea(rawRecord) {
    let total = 0;
    total += this.parseNumeric(rawRecord['Attgar']) || 0;
    total += this.parseNumeric(rawRecord['Attgar2']) || 0;
    total += this.parseNumeric(rawRecord['Basmtgar']) || 0;
    total += this.parseNumeric(rawRecord['Bi Ga']) || 0;
    total += this.parseNumeric(rawRecord['Big']) || 0;
    total += this.parseNumeric(rawRecord['Big2']) || 0;
    total += this.parseNumeric(rawRecord['Big3']) || 0;
    return total > 0 ? total : null;
  }

  /**
   * Extract all detached items from 8 slots (Detached Item Code1-4 + Detachedbuilding1-4)
   * Returns array of {code, area} objects
   */
  extractDetachedItems(rawRecord) {
    const items = [];

    // Detached Item Code1-4 (use Width/Depth or Sq Ft)
    for (let i = 1; i <= 4; i++) {
      const code = rawRecord[`Detached Item Code${i}`];
      if (!code || code.trim() === '') continue;

      // Try Sq Ft first, then calculate from Width × Depth
      let area = this.parseNumeric(rawRecord[`Sq Ft${i}`]);
      if (!area) {
        const width = this.parseNumeric(rawRecord[`Width${i}`]);
        const depth = this.parseNumeric(rawRecord[`Depth${i}`]);
        if (width && depth) {
          area = width * depth;
        }
      }

      if (area && area > 0) {
        items.push({ code: code.trim(), area });
      }
    }

    // Detachedbuilding1-4 (use Widthn/Depthn or Area)
    for (let i = 1; i <= 4; i++) {
      const code = rawRecord[`Detachedbuilding${i}`];
      if (!code || code.trim() === '') continue;

      // Try Area first, then calculate from Widthn × Depthn
      let area = this.parseNumeric(rawRecord[`Area${i}`]);
      if (!area) {
        const width = this.parseNumeric(rawRecord[`Widthn${i}`]);
        const depth = this.parseNumeric(rawRecord[`Depthn${i}`]);
        if (width && depth) {
          area = width * depth;
        }
      }

      if (area && area > 0) {
        items.push({ code: code.trim(), area });
      }
    }

    return items;
  }

  /**
   * Extract detached garage area by summing items with garage codes
   * For now, returns null - will be calculated from detached items + code config
   */
  extractDetGarageArea(rawRecord) {
    // This will be calculated dynamically based on code configuration
    // Store detached items in raw_detached_items field instead
    return null;
  }

  /**
   * Extract pool area by summing items with pool codes
   * For now, returns null - will be calculated from detached items + code config
   */
  extractPoolArea(rawRecord) {
    // This will be calculated dynamically based on code configuration
    // Store detached items in raw_detached_items field instead
    return null;
  }

  /**
   * Extract AC area from AC Sf field
   * If value contains %, it's a percentage of SFLA
   */
  extractAcArea(rawRecord) {
    const sfla = this.parseNumeric(rawRecord['Livable Area']) || 0;
    const acValue = rawRecord['Ac Sf'];

    if (!acValue || acValue.trim() === '') return null;

    // Check if it's a percentage
    if (acValue.includes('%')) {
      const percentage = parseFloat(acValue.replace('%', '').trim());
      if (!isNaN(percentage) && sfla > 0) {
        return Math.round(sfla * (percentage / 100));
      }
    } else {
      // It's actual square footage
      const sqft = this.parseNumeric(acValue);
      return sqft;
    }

    return null;
  }

  /**
   * Calculate lot frontage - sum of Front Ft1, Front Ft2, Front Ft3
   */
  calculateLotFrontage(rawRecord) {
    let totalFrontage = 0;
    let hasValues = false;
    
    const frontFt1 = this.parseNumeric(rawRecord['Front Ft1']);
    const frontFt2 = this.parseNumeric(rawRecord['Front Ft2']);
    const frontFt3 = this.parseNumeric(rawRecord['Front Ft3']);
    
    if (frontFt1) {
      totalFrontage += frontFt1;
      hasValues = true;
    }
    if (frontFt2) {
      totalFrontage += frontFt2;
      hasValues = true;
    }
    if (frontFt3) {
      totalFrontage += frontFt3;
      hasValues = true;
    }
    
    return hasValues ? totalFrontage : null;
  }

  /**
   * Calculate lot depth - average of Avg Depth1, Avg Depth2, Avg Depth3
   */
  calculateLotDepth(rawRecord) {
    const depths = [];
    
    const avgDepth1 = this.parseNumeric(rawRecord['Avg Depth1']);
    const avgDepth2 = this.parseNumeric(rawRecord['Avg Depth2']);
    const avgDepth3 = this.parseNumeric(rawRecord['Avg Depth3']);
    
    if (avgDepth1) depths.push(avgDepth1);
    if (avgDepth2) depths.push(avgDepth2);
    if (avgDepth3) depths.push(avgDepth3);
    
    if (depths.length === 0) return null;
    
    const average = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    return parseFloat(average.toFixed(2)); // Round to 2 decimal places
  }

  /**
   * Calculate time-adjusted sale value using FRED HPI data
   * NOTE: This method is preserved for future use in FileUploadButton.jsx normalization
   * Currently not called during import to avoid async/database errors
   */
  async calculateTimeAdjustedValue(rawRecord, jobId) {
    try {
      const salePrice = this.parseNumeric(rawRecord['Sale Price']);
      const saleDate = rawRecord['Sale Date'];
      
      if (!salePrice || !saleDate) return null;
      
      // Extract sale year from date
      const saleYear = new Date(saleDate).getFullYear();
      if (isNaN(saleYear)) return null;
      
      // Get county from job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('county, year_created')
        .eq('id', jobId)
        .single();
      
      if (jobError || !job) {
        console.warn('Could not get job county for time adjustment');
        return salePrice; // Return original price if no county data
      }
      
      // Get time adjustment multiplier from county_hpi_data
      const { data: hpiData, error: hpiError } = await supabase
        .from('county_hpi_data')
        .select('hpi_index, observation_year')
        .eq('county_name', job.county)
        .in('observation_year', [saleYear, job.year_created])
        .order('observation_year');
      
      if (hpiError || !hpiData || hpiData.length < 2) {
        console.warn(`No HPI data for ${job.county} ${saleYear}, using original price`);
        return salePrice; // Return original price if no HPI data
      }
      
      // Find HPI values for sale year and current year
      const saleYearHPI = hpiData.find(d => d.observation_year === saleYear);
      const currentYearHPI = hpiData.find(d => d.observation_year === job.year_created);
      
      if (!saleYearHPI || !currentYearHPI) {
        return salePrice;
      }
      
      // Calculate time adjustment multiplier
      const multiplier = currentYearHPI.hpi_index / saleYearHPI.hpi_index;
      const adjustedValue = salePrice * multiplier;
      
      return parseFloat(adjustedValue.toFixed(2));
      
    } catch (error) {
      console.error('Error calculating time-adjusted value:', error);
      return this.parseNumeric(rawRecord['Sale Price']); // Fallback to original price
    }
  }

  // Utility functions
  parseDate(dateString) {
    if (!dateString || dateString.trim() === '') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  }

  parseNumeric(value, decimals = null) {
    if (!value || value === '') return null;
    const num = parseFloat(String(value).replace(/[,$]/g, ''));
    if (isNaN(num)) return null;
    return decimals !== null ? parseFloat(num.toFixed(decimals)) : num;
  }

  parseInteger(value) {
    if (!value || value === '') return null;
    const num = parseInt(String(value), 10);
    return isNaN(num) ? null : num;
  }

  /**
   * ENHANCED: Get code description with support for suffix lookup
   * Now handles both full codes (120PV) and suffix codes (PV) from CSV
   */
  getCodeDescription(code) {
    // Try exact match first (for full codes or suffix codes)
    if (this.codeLookups.has(code)) {
      return this.codeLookups.get(code);
    }
    
    // Return original code if no description found
    return code;
  }

  /**
   * Get code details including rate and category
   */
  getCodeDetails(code) {
    // Search through field codes for detailed information
    for (const fieldPrefix of Object.keys(this.allCodes)) {
      const fieldCodes = this.allCodes[fieldPrefix];
      if (fieldCodes[code]) {
        return {
          description: fieldCodes[code].description,
          rate: fieldCodes[code].rate,
          constant: fieldCodes[code].constant,
          category: fieldCodes[code].category,
          field_prefix: fieldPrefix
        };
      }
    }
    
    return {
      description: this.getCodeDescription(code),
      rate: null,
      constant: null,
      category: null,
      field_prefix: null
    };
  }

  /**
   * Get all parsed code sections (for module access)
   */
  getAllCodeSections() {
    return {
      field_codes: this.allCodes,
      categories: this.categories,
      flat_lookup: Object.fromEntries(this.codeLookups)
    };
  }

  /**
   * Get codes by category
   */
  getCodesByCategory(category) {
    const result = {};
    
    for (const fieldPrefix of Object.keys(this.allCodes)) {
      const fieldCodes = this.allCodes[fieldPrefix];
      
      for (const code of Object.keys(fieldCodes)) {
        if (fieldCodes[code].category === category) {
          result[code] = fieldCodes[code];
        }
      }
    }
    
    return result;
  }
}

// Export singleton instance
export const microsystemsProcessor = new MicrosystemsProcessor();
