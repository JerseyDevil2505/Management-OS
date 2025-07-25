/**
 * Microsystems Updater (UPSERT Version)
 * Based on MicrosystemsProcessor but uses UPSERT instead of INSERT
 * For updating existing jobs with new file versions
 * ENHANCED: Dual-pattern parsing for standard (140A) and HVAC (8ED) codes
 * 🔪 SURGICAL FIX: Added totalResidential and totalCommercial calculations
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
   * UPSERT batch with retry logic for connection issues
   */
  async upsertBatchWithRetry(batch, batchNumber, retries = 50) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 UPSERT Batch ${batchNumber}, attempt ${attempt}...`);
        
        // CHANGED: Using UPSERT instead of INSERT
        const { data, error } = await supabase
          .from('property_records')
          .upsert(batch, { 
            onConflict: 'property_composite_key',
            ignoreDuplicates: false 
          });
        
        if (!error) {
          console.log(`✅ UPSERT Batch ${batchNumber} successful on attempt ${attempt}`);
          return { success: true, data };
        }
        
        // Handle specific error codes
        if (error.code === '57014') {
          console.log(`🔄 Query canceled (57014) for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            continue;
          }
        } else if (error.code === '08003' || error.code === '08006') {
          console.log(`🔄 Connection error for batch ${batchNumber}, attempt ${attempt}. Retrying...`);
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
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
   * ENHANCED: Process Microsystems code file and store in jobs table
   * NEW: Dual-pattern parsing for standard (140A) and HVAC (8ED) codes
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('Processing Microsystems code file with dual-pattern parsing (UPDATER)...');
    
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
        if (parts.length < 5) return;
        
        const fullCode = parts[0].trim();
        const description = parts[1].trim();
        const rate = parts[2].trim();
        const constant = parts[3].trim();
        const category = parts[4].trim();
        const table = parts[5] ? parts[5].trim() : '';
        const updated = parts[6] ? parts[6].trim() : '';
        
        if (!fullCode || !description) return;
        
        // ENHANCED: Dual-pattern parsing logic (SAME AS PROCESSOR)
        let prefix, suffix;
        const firstChar = fullCode.substring(0, 1);
        
        if (firstChar === '8') {
          // HVAC pattern: 8 + 2 character code + rest is ignored
          // Example: "8ED16  0399" → prefix="8", suffix="ED"
          prefix = '8';
          suffix = fullCode.substring(1, 3); // Extract exactly 2 characters after '8'
          console.log(`🔥 HVAC code parsed (UPDATER): "${fullCode}" → prefix="${prefix}", suffix="${suffix}"`);
        } else {
          // Standard pattern: 3 digit category + variable code + rest is ignored  
          // Example: "140A   9999" → prefix="140", suffix="A"
          prefix = fullCode.substring(0, 3);
          suffix = fullCode.substring(3).trim().split(/\s+/)[0]; // Get code part before spaces
          console.log(`📋 Standard code parsed (UPDATER): "${fullCode}" → prefix="${prefix}", suffix="${suffix}"`);
        }
        
        if (prefix && suffix) {
          // Store full code with description for lookup
          this.codeLookups.set(fullCode, description);
          
          // Store suffix for CSV lookup (this is what appears in source data)
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
          console.log(`⚠️ Direct code (no pattern match) (UPDATER): "${fullCode}"`);
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
      
      console.log(`Loaded ${this.codeLookups.size} code definitions with dual-pattern parsing (UPDATER)`);
      console.log(`Organized into ${Object.keys(this.allCodes).length} field groups`);
      console.log(`Categories found: ${Object.keys(this.categories).join(', ')}`);
      console.log(`InfoBy codes (140 prefix): ${Object.keys(this.allCodes['140'] || {}).join(', ')}`);
      console.log(`HVAC codes (8 prefix): ${Object.keys(this.allCodes['8'] || {}).join(', ')}`);
      
      // Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('Error parsing Microsystems code file (UPDATER):', error);
      throw error;
    }
  }

  /**
   * Store code file content in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing Microsystems code file in jobs table (UPDATER)...');
      
      // Clean Unicode null characters
      const cleanedCodeContent = codeFileContent
        .replace(/\u0000/g, '')
        .replace(/\x00/g, '')
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
            parsing_method: 'dual_pattern_updater' // NEW: Track parsing method used
          }
        }
      };
      
      const { data: updateData, error: updateError } = await supabase
        .from('jobs')
        .update(updatePayload)
        .eq('id', jobId)
        .select('id, code_file_name, code_file_uploaded_at');

      if (updateError) {
        console.error('❌ Code file storage update failed (UPDATER):', updateError);
        throw updateError;
      }
      
      console.log('✅ Microsystems code file stored successfully in jobs table (UPDATER)');
      
    } catch (error) {
      console.error('❌ Failed to store Microsystems code file (UPDATER):', error);
      console.log('⚠️ Continuing with processing despite code storage failure...');
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
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - skipping`);
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
   * Map Microsystems record to property_records table (SAME AS PROCESSOR)
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}) {
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_addl_lot: null,
      property_location: rawRecord['Location'],
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`,
      property_cama_class: null,
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
      values_mod_land: this.parseNumeric(rawRecord['Land Value']),
      values_cama_land: this.parseNumeric(rawRecord['Land Value2']),
      values_mod_improvement: this.parseNumeric(rawRecord['Impr Value']),
      values_cama_improvement: this.parseNumeric(rawRecord['Impr Value2']),
      values_mod_total: this.parseNumeric(rawRecord['Totl Value']),
      values_cama_total: this.parseNumeric(rawRecord['Totl Value2']),
      values_base_cost: this.parseNumeric(rawRecord['Base Cost']),
      values_det_items: this.parseNumeric(rawRecord['Det Items']),
      values_repl_cost: this.parseNumeric(rawRecord['Cost New']),
      values_norm_time: null,
      values_norm_size: null,
      
      // Inspection fields
      inspection_info_by: rawRecord['Interior Finish3'],
      inspection_list_by: rawRecord['Insp By'],
      inspection_list_date: this.parseDate(rawRecord['Insp Date']),
      inspection_measure_by: rawRecord['Measured By'],
      inspection_measure_date: this.parseDate(rawRecord['Insp Date 1']),
      inspection_price_by: null,
      inspection_price_date: null,
      
      // Asset fields
      asset_building_class: rawRecord['Bldg Qual Class Code'],
      asset_design_style: rawRecord['Style Code'],
      asset_ext_cond: rawRecord['Condition'],
      asset_int_cond: rawRecord['Interior Cond Or End Unit'],
      asset_key_page: null,
      asset_lot_acre: this.parseNumeric(rawRecord['Lot Size In Acres'], 2),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.parseInteger(rawRecord['Lot Size In Sf']),
      asset_map_page: null,
      asset_neighborhood: rawRecord['Neighborhood'],
      asset_sfla: this.parseNumeric(rawRecord['Livable Area']),
      asset_story_height: this.parseNumeric(rawRecord['Story Height']),
      asset_type_use: rawRecord['Type Use Code'],
      asset_view: null,
      asset_year_built: this.parseInteger(rawRecord['Year Built']),
      asset_zoning: null,
      
      // Analysis and calculation fields
      analysis_code: null,
      analysis_version: 1,
      condition_rating: null,
      location_analysis: null,
      new_vcs: null,
      total_baths_calculated: this.calculateTotalBaths(rawRecord),
      
      // Processing metadata
      processed_at: new Date().toISOString(),
      processing_notes: null,
      validation_status: 'updated', // CHANGED: from 'imported' to 'updated'
      is_new_since_last_upload: false, // CHANGED: false for updates
      is_retroactive_credit: false,
      
      // File tracking with version info
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      code_file_name: versionInfo.code_file_name || null,
      code_file_updated_at: versionInfo.code_file_updated_at || new Date().toISOString(),
      file_version: versionInfo.file_version || 1,
      upload_date: new Date().toISOString(),
      
      // Payroll and project tracking
      payroll_period_start: null,
      project_start_date: null,
      
      // System metadata
      vendor_source: 'Microsystems',
      import_session_id: versionInfo.import_session_id || null,
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      created_at: new Date().toISOString(), // Will be ignored on UPSERT
      updated_at: new Date().toISOString(),
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * 🔪 SURGICAL FIX: Calculate property class totals for jobs table
   * Microsystems property classes: 2=Residential, 3A=Residential, 4A/4B/4C=Commercial
   */
  calculatePropertyTotals(records) {
    let totalResidential = 0;
    let totalCommercial = 0;
    
    for (const record of records) {
      const propertyClass = record['Class'];
      
      if (propertyClass === '2' || propertyClass === '3A') {
        totalResidential++;
      } else if (propertyClass === '4A' || propertyClass === '4B' || propertyClass === '4C') {
        totalCommercial++;
      }
      // Other classes (1, 3B, 5A, 5B, etc.) not counted in either category
    }
    
    console.log(`🔪 SURGICAL FIX (UPDATER) - Property totals calculated: ${totalResidential} residential, ${totalCommercial} commercial`);
    return { totalResidential, totalCommercial };
  }

  /**
   * 🔪 SURGICAL FIX: Update jobs table with property class totals
   */
  async updateJobTotals(jobId, totalResidential, totalCommercial) {
    try {
      console.log(`🔪 SURGICAL FIX (UPDATER) - Updating job ${jobId} with totals: ${totalResidential} residential, ${totalCommercial} commercial`);
      
      const { data, error } = await supabase
        .from('jobs')
        .update({
          totalResidential: totalResidential,
          totalCommercial: totalCommercial,
          totalProperties: totalResidential + totalCommercial
        })
        .eq('id', jobId);

      if (error) {
        console.error('❌ SURGICAL FIX (UPDATER) - Failed to update job totals:', error);
        throw error;
      }

      console.log('✅ SURGICAL FIX (UPDATER) - Job totals updated successfully');
      
    } catch (error) {
      console.error('❌ SURGICAL FIX (UPDATER) - Error updating job totals:', error);
      // Don't throw - continue processing even if update fails
    }
  }

  /**
   * MAIN PROCESS METHOD - UPSERT VERSION
   * 🔪 SURGICAL FIX: Added property totals calculation and jobs table update
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting Microsystems UPDATER (UPSERT) processing with dual-pattern parsing + PROPERTY TOTALS...');
      
      // Process and store code file if provided
      if (codeFileContent) {
        console.log('🔍 Processing code file (UPDATER)...');
        await this.processCodeFile(codeFileContent, jobId);
      }
      
      // Parse source file
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in UPSERT batches...`);
      
      // 🔪 SURGICAL FIX: Calculate property totals BEFORE processing
      const { totalResidential, totalCommercial } = this.calculatePropertyTotals(records);
      
      // Prepare all property records for batch upsert
      const propertyRecords = [];
      
      for (const rawRecord of records) {
        try {
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo);
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
      
      // BATCH UPSERT: Update/insert all property records (1000 at a time)
      console.log(`Batch UPSERTING ${propertyRecords.length} property records...`);
      const batchSize = 1000;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        console.log(`🚀 UPSERT batch ${batchNumber}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
        const result = await this.upsertBatchWithRetry(batch, batchNumber);
        
        if (result.error) {
          console.error(`❌ UPSERT Batch ${batchNumber} failed:`, result.error);
          results.errors += batch.length;
          results.warnings.push(`Batch ${batchNumber} failed: ${result.error.message}`);
        } else {
          results.processed += batch.length;
          console.log(`✅ UPSERT Batch ${batchNumber} completed successfully`);
        }
      }
      
      // 🔪 SURGICAL FIX: Update jobs table with property totals AFTER successful processing
      if (results.processed > 0) {
        await this.updateJobTotals(jobId, totalResidential, totalCommercial);
      }
      
      console.log('🚀 MICROSYSTEMS UPDATER (UPSERT) COMPLETE WITH DUAL-PATTERN PARSING + PROPERTY TOTALS:', results);
      return results;
      
    } catch (error) {
      console.error('Microsystems updater failed:', error);
      throw error;
    }
  }

  // UTILITY FUNCTIONS (SAME AS PROCESSOR)
  
  calculateTotalBaths(rawRecord) {
    let total = 0;
    
    total += (this.parseNumeric(rawRecord['4 Fixture Bath']) || 0) * 1.0;
    total += (this.parseNumeric(rawRecord['3 Fixture Bath']) || 0) * 1.0;
    total += (this.parseNumeric(rawRecord['2 Fixture Bath']) || 0) * 0.5;
    
    return total > 0 ? total : null;
  }

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
    return parseFloat(average.toFixed(2));
  }

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

  getCodeDescription(code) {
    if (this.codeLookups.has(code)) {
      return this.codeLookups.get(code);
    }
    return code;
  }

  getCodeDetails(code) {
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

  getAllCodeSections() {
    return {
      field_codes: this.allCodes,
      categories: this.categories,
      flat_lookup: Object.fromEntries(this.codeLookups)
    };
  }

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
export const microsystemsUpdater = new MicrosystemsUpdater();
