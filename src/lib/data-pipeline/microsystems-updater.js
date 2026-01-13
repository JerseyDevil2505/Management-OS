/**
 * Enhanced Microsystems Updater 
 * Handles pipe-delimited source files and field_id+code lookup files
 * UPDATED: Single table UPSERT to property_records with all 82 fields
 * NEW: Proper code file storage in jobs table with pipe-delimited format support
 * ADDED: Retry logic for connection issues and query cancellations
 * ENHANCED: Dual-pattern parsing for standard (140A) and HVAC (8ED) codes
 * FIXED: Proper AAACCCCSSSS parsing - InfoBy single char, Design multi-char, HVAC preserved
 * CLEANED: Removed redundant surgical fix totals (handled by AdminJobManagement/FileUploadButton)
 * ADDED: Field preservation support for component-defined fields
 * CRITICAL: Added automatic rollback for failed batches - all or nothing!
 */

import { supabase } from '../supabaseClient.js';

export class MicrosystemsUpdater {
  constructor() {
    this.codeLookups = new Map();
    this.headers = [];
    
    // Store all parsed codes for database storage
    this.allCodes = {};
    this.categories = {};
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
      // Remove null/undefined/empty/whitespace-only values to reduce payload size
      const cleaned = {};
      for (const [key, value] of Object.entries(record)) {
        // Skip null, undefined, empty strings, and whitespace-only strings
        if (value !== null && value !== undefined) {
          const strValue = String(value);
          if (strValue.trim() !== '') {
            cleaned[key] = value;
          }
        }
      }
      return cleaned;
    });
  }

  /**
   * Save current projected ratable base to "previous" fields for delta tracking
   */
  async savePreviousProjectedValues(jobId) {
    try {
      console.log('💾 Saving current projected ratable base to previous fields for delta tracking...');

      // Get current properties for this job
      const { data: properties, error } = await supabase
        .from('property_records')
        .select('values_cama_total, property_cama_class, property_facility')
        .eq('job_id', jobId);

      if (error) throw error;

      if (!properties || properties.length === 0) {
        console.log('ℹ️ No existing properties found, skipping previous value save');
        return;
      }

      // Calculate projected ratable base from current properties
      const summary = {
        '1': { count: 0, total: 0 },
        '2': { count: 0, total: 0 },
        '3A': { count: 0, total: 0 },
        '3B': { count: 0, total: 0 },
        '4ABC': { count: 0, total: 0 },
        '6ABC': { count: 0, total: 0 }
      };

      properties.forEach(property => {
        const isTaxable = property.property_facility !== 'EXEMPT';
        if (!isTaxable) return;

        const camaTotal = property.values_cama_total || 0;
        const propertyClass = property.property_cama_class || '';

        if (propertyClass === '1') {
          summary['1'].count++;
          summary['1'].total += camaTotal;
        } else if (propertyClass === '2') {
          summary['2'].count++;
          summary['2'].total += camaTotal;
        } else if (propertyClass === '3A') {
          summary['3A'].count++;
          summary['3A'].total += camaTotal;
        } else if (propertyClass === '3B') {
          summary['3B'].count++;
          summary['3B'].total += camaTotal;
        } else if (['4A', '4B', '4C'].includes(propertyClass)) {
          summary['4ABC'].count++;
          summary['4ABC'].total += camaTotal;
        } else if (['6A', '6B'].includes(propertyClass)) {
          summary['6ABC'].count++;
          summary['6ABC'].total += camaTotal;
        }
      });

      const totalCount = Object.values(summary).reduce((sum, item) => sum + item.count, 0);
      const totalTotal = Object.values(summary).reduce((sum, item) => sum + item.total, 0);

      // Save to previous fields
      const { error: updateError } = await supabase
        .from('jobs')
        .update({
          previous_projected_class_1_count: summary['1'].count,
          previous_projected_class_1_total: summary['1'].total,
          previous_projected_class_2_count: summary['2'].count,
          previous_projected_class_2_total: summary['2'].total,
          previous_projected_class_3a_count: summary['3A'].count,
          previous_projected_class_3a_total: summary['3A'].total,
          previous_projected_class_3b_count: summary['3B'].count,
          previous_projected_class_3b_total: summary['3B'].total,
          previous_projected_class_4_count: summary['4ABC'].count,
          previous_projected_class_4_total: summary['4ABC'].total,
          previous_projected_class_6_count: summary['6ABC'].count,
          previous_projected_class_6_total: summary['6ABC'].total,
          previous_projected_total_count: totalCount,
          previous_projected_total_total: totalTotal
        })
        .eq('id', jobId);

      if (updateError) throw updateError;

      console.log(`✅ Saved previous projected values: ${totalCount} properties, $${totalTotal.toLocaleString()} total`);

    } catch (error) {
      console.warn('⚠️ Could not save previous projected values:', error);
      // Don't throw - this is non-critical for file processing
    }
  }

  /**
   * Upsert batch with retry logic for connection issues
   */
  async upsertBatchWithRetry(batch, batchNumber, retries = 50) {
    // CRITICAL FIX: Optimize batch before processing
    const optimizedBatch = this.optimizeBatchForDatabase(batch);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 UPSERT Batch ${batchNumber}, attempt ${attempt}...`);
        
        // CRITICAL FIX: Optimize for 500+ records with timeout and minimal return
        const upsertPromise = supabase
          .from('property_records')
          .upsert(optimizedBatch, {
            onConflict: 'property_composite_key',
            ignoreDuplicates: false,
            count: 'exact',
            returning: 'minimal'  // Only return count, not full record data
          });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database timeout after 60 seconds')), 60000)
        );

        const { data, error } = await Promise.race([upsertPromise, timeoutPromise]);
        
        if (!error) {
          console.log(`✅ UPSERT Batch ${batchNumber} successful on attempt ${attempt}`);
          return { success: true, data };
        }
        
        // Handle specific error codes
        if (error.code === '57014') {
          console.log(`🔄 Query canceled (57014) for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            continue;
          }
        } else if (error.code === '08003' || error.code === '08006') {
          console.log(`🔄 Connection error for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            continue;
          }
        } else {
          // For other errors, don't retry
          console.error(`❌ UPSERT Batch ${batchNumber} failed with non-retryable error:`, error);
          return { error };
        }
        
        // If we get here, it's the final attempt for a retryable error
        console.error(`❌ UPSERT Batch ${batchNumber} failed after ${retries} attempts:`, error);
        return { error };
        
      } catch (networkError) {
        console.log(`🌐 Network error for UPSERT batch ${batchNumber}, attempt ${attempt}:`, networkError.message);
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
      console.log('💾 Storing complete Microsystems source file in jobs table (UPDATER)...');

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
        console.error('❌ Error storing Microsystems source file in database:', error);
        throw error;
      }

      console.log('✅ Complete Microsystems source file stored successfully in jobs table (UPDATER)');
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
            // Example: "140R   9999" → suffix="R"
            suffix = afterPrefix.charAt(0);
          } else {
            // Other codes: extract letters until space or number
            // Example: "520CL  9999" → suffix="CL"
            const match = afterPrefix.match(/^[A-Z]+/);
            suffix = match ? match[0] : afterPrefix.charAt(0);
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
      console.log(`���� HVAC codes (8 prefix): ${Object.keys(this.allCodes['8'] || {}).join(', ')}`);
      console.log(`🏗�� Design codes (520 prefix): ${Object.keys(this.allCodes['520'] || {}).join(', ')}`);
      
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
      console.log('Continuing with job update despite code storage failure...');
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
    
    console.log(`📊 Processing ${records.length} records in UPSERT batches...`);
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
   * ENHANCED: Now supports field preservation for component-defined fields
   * UPDATED: Added yearPriorToDueYear parameter for effective age conversion
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}, preservedData = {}, yearPriorToDueYear = null) {
    // Build the base record
    const baseRecord = {
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
      asset_story_height: this.parseStoryHeight(rawRecord['Story Height']),  // Extract numeric portion from alphanumeric values like "2A"
      asset_type_use: rawRecord['Type Use Code'],
      asset_view: null, // Not available in Microsystems
      asset_year_built: this.parseInteger(rawRecord['Year Built']),
      asset_effective_age: this.calculateEffectiveYear(rawRecord['Effective Age'], yearPriorToDueYear),  // Microsystems: Convert age to year

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
      
      // Processing metadata
      processed_at: new Date().toISOString(),
      is_new_since_last_upload: false, // UPSERT operation
      
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

    // SIMPLIFIED: Return baseRecord only - no field preservation needed
    // is_assigned_property will remain untouched since it's not in baseRecord
    return baseRecord;
  }

  /**
   * ENHANCED: Process complete file and update database with code file integration
   * UPDATED: Single table UPSERT only - no more dual-table complexity
   * NEW: Integrates code file storage in jobs table
   * ADDED: Retry logic for connection issues and query cancellations
   * CLEANED: Removed redundant surgical fix (total_properties handled by AdminJobManagement/FileUploadButton)
   * ENHANCED: Added field preservation support
   * CRITICAL: Added automatic rollback for failed batches
   * OPTIMIZED: Now accepts optional deletion list to avoid expensive .not.in() queries
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}, deletionsList = null) {
    // Track successful batches for rollback
    const successfulBatches = [];
    const processingVersion = versionInfo.file_version || 1;
    
    try {
      console.log('🚀 Starting Enhanced Microsystems UPDATER (UPSERT) with field preservation and ROLLBACK support...');

      // CRITICAL FIX: Store source file content in jobs table
      console.log('📝 Step 1: Storing source file in database...');
      await this.storeSourceFileInDatabase(sourceFileContent, jobId);
      console.log('✅ Step 1 completed: Source file stored');

      // Process and store code file if provided
      if (codeFileContent) {
        console.log('📝 Step 2: Processing code file...');
        await this.processCodeFile(codeFileContent, jobId);
        console.log('✅ Step 2 completed: Code file processed');
      } else {
        console.log('⏭️ Step 2 skipped: No code file provided');
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
      console.log('📝 Step 3: Parsing source file...');
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`✅ Step 3 completed: Parsed ${records.length} records from source file`);

      // OPTIMIZED: Delete properties using pre-computed deletion list from comparison reports
      console.log('📝 Step 4: Processing property deletions...');

      if (deletionsList && deletionsList.length > 0) {
        console.log(`🗑️ Using pre-computed deletion list: ${deletionsList.length} properties to delete`);

        // Extract composite keys from deletion list
        const keysToDelete = deletionsList.map(deletion => {
          // Handle both object format and string format
          return typeof deletion === 'string' ? deletion : deletion.property_composite_key;
        }).filter(key => key); // Remove any null/undefined keys

        if (keysToDelete.length > 0) {
          console.log(`🔍 Deleting specific properties: ${keysToDelete.slice(0, 3).join(', ')}${keysToDelete.length > 3 ? '...' : ''}`);

          try {
            // Use targeted .in() query instead of massive .not.in() query
            const { error: deleteError, count: deletedCount } = await supabase
              .from('property_records')
              .delete({ count: 'exact' })
              .eq('job_id', jobId)
              .in('property_composite_key', keysToDelete);

            if (deleteError) {
              console.warn('⚠️ Could not delete obsolete properties:', deleteError);
            } else {
              console.log(`✅ Successfully deleted ${deletedCount || keysToDelete.length} obsolete properties using optimized deletion`);
            }
          } catch (deleteError) {
            console.warn('⚠️ Error during optimized deletion process:', deleteError);
          }
        } else {
          console.log('✅ No valid property keys found in deletion list');
        }
      } else {
        console.log('⏭️ Step 4 skipped: No deletion list provided (using FileUploadButton comparison workflow)');
      }

      // DISABLED: Field preservation no longer needed since is_assigned_property won't be overwritten
      let preservedDataMap = new Map();
      console.log('📝 Step 5: Field preservation disabled - no fields need preservation');
      
      // Prepare all property records for batch upsert
      const propertyRecords = [];
      
      for (const rawRecord of records) {
        try {
          // Generate composite key for this record
          const compositeKey = `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`;
          
          // Get preserved data for this property if available
          const preservedData = preservedDataMap.get(compositeKey) || {};

          // Map to unified property_records table with all 82 fields and preserved data
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo, preservedData, yearPriorToDueYear);
          propertyRecords.push(propertyRecord);
          
        } catch (error) {
          console.error('Error mapping record:', error);
        }
      }
      
      // Log preservation statistics
      if (versionInfo.preservedFields && preservedDataMap.size > 0) {
        const preservedCount = propertyRecords.filter(record => {
          return versionInfo.preservedFields.some(field => 
            record[field] !== null && record[field] !== undefined
          );
        }).length;
        console.log(`📊 Preserving user-defined fields in ${preservedCount} records`);
      }

      const results = {
        processed: 0,
        errors: 0,
        warnings: []
      };

      console.log('✅ INITIALIZATION COMPLETE - All steps finished successfully!');
      console.log(`🎯 DELETION OPTIMIZATION: Used ${deletionsList ? 'targeted .in() queries' : 'legacy deletion logic'}`);
      console.log('🚀 Starting batch UPSERT processing...');
      console.log(`📊 Processing ${propertyRecords.length} property records in batches...`);
      const batchSize = 250; // Optimized for stability and error resilience
      let consecutiveErrors = 0;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(propertyRecords.length / batchSize);
        
        console.log(`🚀 UPSERT batch ${batchNumber} of ${totalBatches}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
        const result = await this.upsertBatchWithRetry(batch, batchNumber);
        
        if (result.error) {
          console.error(`❌ UPSERT Batch ${batchNumber} failed:`, result.error);
          
          // CRITICAL: Rollback all successful batches with 50 retries each!
          console.log(`❌ Batch ${batchNumber} failed - rolling back ${successfulBatches.length} successful batches...`);
          
          let rollbackFailures = 0;
          
          for (const successBatch of successfulBatches.reverse()) {
            let rollbackSuccess = false;
            
            // Try up to 50 times to rollback each batch
            for (let rollbackAttempt = 1; rollbackAttempt <= 50; rollbackAttempt++) {
              try {
                console.log(`🔄 Rollback attempt ${rollbackAttempt} for batch ${successBatch.batchNumber}...`);
                
                const { error } = await supabase
                  .from('property_records')
                  .delete()
                  .eq('job_id', jobId)
                  .eq('file_version', processingVersion)
                  .gte('updated_at', successBatch.timestamp);
                
                if (!error) {
                  console.log(`✅ Successfully rolled back batch ${successBatch.batchNumber} on attempt ${rollbackAttempt}`);
                  rollbackSuccess = true;
                  break;
                }
                
                // Handle specific error codes
                if (error.code === '57014' || error.code === '08003' || error.code === '08006' || 
                    error.message.includes('connection') || error.message.includes('timeout')) {
                  console.log(`⚠️ Retryable error during rollback of batch ${successBatch.batchNumber}, attempt ${rollbackAttempt}: ${error.message}`);
                  if (rollbackAttempt < 50) {
                    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * rollbackAttempt, 10000))); // Exponential backoff up to 10s
                    continue;
                  }
                } else {
                  console.error(`❌ Non-retryable error during rollback: ${error.message}`);
                  break;
                }
                
              } catch (networkError) {
                console.error(`🌐 Network error during rollback attempt ${rollbackAttempt}:`, networkError);
                if (rollbackAttempt < 50) {
                  await new Promise(resolve => setTimeout(resolve, Math.min(1000 * rollbackAttempt, 10000)));
                  continue;
                }
              }
            }
            
            if (!rollbackSuccess) {
              rollbackFailures++;
              console.error(`❌ FAILED to rollback batch ${successBatch.batchNumber} after 50 attempts!`);
            }
          }
          
          // Verify rollback completion
          try {
            const { count, error: verifyError } = await supabase
              .from('property_records')
              .select('*', { count: 'exact', head: true })
              .eq('job_id', jobId)
              .eq('file_version', processingVersion);
            
            if (!verifyError) {
              if (count === 0) {
                console.log('✅ Rollback verification: All records successfully removed');
              } else {
                console.warn(`⚠️ Rollback verification: ${count} records still exist with version ${processingVersion}`);
              }
            }
          } catch (verifyError) {
            console.error('Could not verify rollback:', verifyError);
          }
          
          const rollbackMessage = rollbackFailures > 0 
            ? `Update failed and rollback attempted - ${successfulBatches.length - rollbackFailures} of ${successfulBatches.length} batches rolled back successfully. WARNING: ${rollbackFailures} batches may need manual cleanup!`
            : `Update failed and successfully reverted - all ${successfulBatches.length} batches rolled back.`;
          
          throw new Error(`${rollbackMessage} Original error: ${result.error.message}`);
          
        } else {
          results.processed += batch.length;
          console.log(`✅ UPSERT Batch ${batchNumber} completed successfully (${results.processed}/${propertyRecords.length} total)`);
          
          // Track successful batch for potential rollback
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
            console.log(`�� Pausing 0.5s before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      console.log('🚀 Enhanced Microsystems UPDATER (UPSERT) complete:', results);
      return results;
      
    } catch (error) {
      console.error('❌ Enhanced Microsystems updater failed:', error);
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
    // Handle null, undefined, empty string, or whitespace-only strings
    if (!dateString || String(dateString).trim() === '') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
  }

  parseNumeric(value, decimals = null) {
    // Handle null, undefined, empty string, or whitespace-only strings
    if (!value || String(value).trim() === '') return null;
    const num = parseFloat(String(value).replace(/[,$]/g, ''));
    if (isNaN(num)) return null;
    return decimals !== null ? parseFloat(num.toFixed(decimals)) : num;
  }

  parseInteger(value) {
    // Handle null, undefined, empty string, or whitespace-only strings
    if (!value || String(value).trim() === '') return null;
    const num = parseInt(String(value), 10);
    return isNaN(num) ? null : num;
  }

  parseStoryHeight(value) {
    // Handle null, undefined, empty string, or whitespace-only strings
    if (!value || String(value).trim() === '') return null;

    // Extract numeric portion from values like "2A", "1.5", "3S", etc.
    // Match: optional digits, optional decimal point, optional digits
    const match = String(value).match(/^(\d+\.?\d*)/);
    if (!match) return null;

    const num = parseFloat(match[1]);
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

  // ===== PROPERTY LINEAGE TRACKING METHODS =====

  /**
   * Store complete source file version for lineage tracking
   */
  async storeSourceFileVersion(sourceFileContent, jobId, fileVersion, yearCreated, ccddCode) {
    try {
      console.log(`📚 Storing Microsystems source file version ${fileVersion} for lineage tracking...`);

      // Parse source file to extract property composite keys
      const records = this.parseSourceFile(sourceFileContent);
      const propertyKeys = [];

      records.forEach(rawRecord => {
        const compositeKey = `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`;
        propertyKeys.push(compositeKey);
      });

      // Get previous version for comparison
      const { data: previousVersion } = await supabase
        .from('source_file_versions')
        .select('property_composite_keys')
        .eq('job_id', jobId)
        .eq('file_version', fileVersion - 1)
        .single();

      let propertiesAdded = [];
      let propertiesRemoved = [];
      let propertiesWithSalesChanges = [];

      if (previousVersion) {
        const previousKeys = new Set(previousVersion.property_composite_keys);
        const currentKeys = new Set(propertyKeys);

        // Find added and removed properties
        propertiesAdded = [...currentKeys].filter(key => !previousKeys.has(key));
        propertiesRemoved = [...previousKeys].filter(key => !currentKeys.has(key));

        console.log(`📊 Version ${fileVersion} changes: +${propertiesAdded.length} added, -${propertiesRemoved.length} removed`);

        // Detect sale data changes for existing properties
        console.log(`🔍 Checking for sale data changes in existing properties...`);

        // Get previous version property data to compare sales fields
        const { data: previousProperties, error: prevError } = await supabase
          .from('property_records')
          .select('property_composite_key, sales_price, sales_date, sales_nu')
          .eq('job_id', jobId)
          .eq('file_version', fileVersion - 1);

        if (!prevError && previousProperties) {
          const prevSalesMap = new Map();
          previousProperties.forEach(p => {
            prevSalesMap.set(p.property_composite_key, {
              sales_price: p.sales_price,
              sales_date: p.sales_date,
              sales_nu: p.sales_nu
            });
          });

          // Get current version property data
          const { data: currentProperties, error: currError } = await supabase
            .from('property_records')
            .select('property_composite_key, sales_price, sales_date, sales_nu')
            .eq('job_id', jobId)
            .eq('file_version', fileVersion);

          if (!currError && currentProperties) {
            currentProperties.forEach(curr => {
              const prev = prevSalesMap.get(curr.property_composite_key);
              if (prev) {
                // Check if any sale field changed
                const priceChanged = prev.sales_price !== curr.sales_price;
                const dateChanged = prev.sales_date !== curr.sales_date;
                const nuChanged = prev.sales_nu !== curr.sales_nu;

                if (priceChanged || dateChanged || nuChanged) {
                  propertiesWithSalesChanges.push({
                    property_composite_key: curr.property_composite_key,
                    old_sales_price: prev.sales_price,
                    new_sales_price: curr.sales_price,
                    old_sales_date: prev.sales_date,
                    new_sales_date: curr.sales_date,
                    old_sales_nu: prev.sales_nu,
                    new_sales_nu: curr.sales_nu
                  });
                }
              }
            });

            console.log(`📊 Sale data changes detected: ${propertiesWithSalesChanges.length} properties`);
            if (propertiesWithSalesChanges.length > 0 && propertiesWithSalesChanges.length <= 10) {
              console.log(`   Sample changes:`, propertiesWithSalesChanges.slice(0, 5));
            }
          }
        }
      } else {
        console.log(`📊 Version ${fileVersion} is the first version with ${propertyKeys.length} properties`);
      }

      // Store source file version
      const { data: sourceFileVersionRecord, error } = await supabase
        .from('source_file_versions')
        .insert([{
          job_id: jobId,
          file_version: fileVersion,
          file_content: sourceFileContent,
          vendor_type: 'Microsystems',
          original_filename: 'Microsystems_Source_File.txt',
          file_size: sourceFileContent.length,
          row_count: records.length,
          property_composite_keys: propertyKeys,
          properties_added: propertiesAdded,
          properties_removed: propertiesRemoved,
          properties_modified: [], // General field changes (legacy)
          properties_with_sales_changes: propertiesWithSalesChanges.map(p => p.property_composite_key), // Track sale changes
          sales_changes_detail: propertiesWithSalesChanges, // Detailed change info for reference
          uploaded_by: null, // TODO: Get actual user ID
          processing_status: 'stored'
        }])
        .select()
        .single();

      if (error) {
        console.error('❌ Error storing Microsystems source file version:', error);
        return null;
      }

      // Record lifecycle events
      await this.recordLifecycleEvents(
        jobId, fileVersion, propertiesAdded, propertiesRemoved, sourceFileVersionRecord.id
      );

      console.log(`✅ Microsystems source file version ${fileVersion} stored with lineage tracking`);
      return sourceFileVersionRecord.id;

    } catch (error) {
      console.error('❌ Failed to store Microsystems source file version:', error);
      return null;
    }
  }

  /**
   * Record property lifecycle events (added, removed)
   */
  async recordLifecycleEvents(jobId, fileVersion, addedProperties, removedProperties, sourceFileVersionId) {
    try {
      const events = [];

      // Record added properties
      addedProperties.forEach(propertyKey => {
        events.push({
          job_id: jobId,
          property_composite_key: propertyKey,
          event_type: 'ADDED',
          from_file_version: null,
          to_file_version: fileVersion,
          source_file_version_id: sourceFileVersionId
        });
      });

      // Record removed properties
      removedProperties.forEach(propertyKey => {
        events.push({
          job_id: jobId,
          property_composite_key: propertyKey,
          event_type: 'REMOVED',
          from_file_version: fileVersion - 1,
          to_file_version: fileVersion,
          source_file_version_id: sourceFileVersionId
        });
      });

      if (events.length > 0) {
        const { error } = await supabase
          .from('property_lifecycle_events')
          .insert(events);

        if (error) {
          console.error('❌ Error recording Microsystems lifecycle events:', error);
        } else {
          console.log(`✅ Recorded ${events.length} Microsystems lifecycle events for version ${fileVersion}`);
        }
      }

    } catch (error) {
      console.error('❌ Failed to record Microsystems lifecycle events:', error);
    }
  }

  /**
   * Mark source file version as processed
   */
  async markSourceFileVersionProcessed(sourceFileVersionId, processingResults) {
    try {
      const { error } = await supabase
        .from('source_file_versions')
        .update({
          processing_status: processingResults.errors > 0 ? 'failed' : 'processed',
          processed_at: new Date().toISOString()
        })
        .eq('id', sourceFileVersionId);

      if (error) {
        console.error('❌ Error marking Microsystems source file version as processed:', error);
      } else {
        console.log(`✅ Microsystems source file version marked as processed`);
      }

    } catch (error) {
      console.error('❌ Failed to mark Microsystems source file version as processed:', error);
    }
  }
}

// Export singleton instance
export const microsystemsUpdater = new MicrosystemsUpdater();
