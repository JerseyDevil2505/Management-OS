/**
 * Enhanced Microsystems Processor 
 * Handles pipe-delimited source files and field_id+code lookup files
 * UPDATED: Single table insertion to property_records with all 82 fields
 * NEW: Proper code file storage in jobs table with pipe-delimited format support
 */

import { supabase } from '../supabaseClient.js';

export class MicrosystemsProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.headers = [];
    
    // NEW: Store all parsed codes for database storage
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
   * ENHANCED: Process Microsystems code file and store in jobs table
   * Handles pipe-delimited format: CODE|DESCRIPTION|RATE|CONSTANT|CATEGORY|TABLE|UPDATED
   * Examples: "120PV  9999|PAVED|0|0|ROAD|0|05/14/92|"
   *           "8FA16  0399|FORCED HOT AIR|4700|0|FORCED HOT AIR|E|06/24/02|"
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('Processing Microsystems code file with database storage...');
    
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
        
        // Extract prefix and suffix from full code
        // Examples: "120PV  9999" -> prefix="120", suffix="PV"
        //           "8FA16  0399" -> prefix="8", suffix="FA"
        const codeMatch = fullCode.match(/^(\d+)([A-Z]+)/);
        if (codeMatch) {
          const prefix = codeMatch[1];
          const suffix = codeMatch[2];
          
          // Store full code with description
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
          // Handle codes that don't match the pattern (direct codes)
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
      
      console.log(`Loaded ${this.codeLookups.size} code definitions`);
      console.log(`Organized into ${Object.keys(this.allCodes).length} field groups`);
      console.log(`Categories found: ${Object.keys(this.categories).join(', ')}`);
      
      // NEW: Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('Error parsing Microsystems code file:', error);
      throw error;
    }
  }

  /**
   * NEW: Store code file content and parsed definitions in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing Microsystems code file in jobs table...');
      
      const { error } = await supabase
        .from('jobs')
        .update({
          code_file_content: codeFileContent,
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
              parsed_at: new Date().toISOString()
            }
          }
        })
        .eq('id', jobId);

      if (error) {
        console.error('Error storing Microsystems code file in database:', error);
        throw error;
      }
      
      console.log('✅ Microsystems code file stored successfully in jobs table');
    } catch (error) {
      console.error('Failed to store Microsystems code file:', error);
      // Don't throw - continue with processing even if code storage fails
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
    console.log('Duplicate mapping created:', {
      'Location': this.headers.indexOf('Location'),
      'Land Value': this.headers.indexOf('Land Value'),
      'Land Value2': this.headers.indexOf('Land Value2'),
      'Impr Value': this.headers.indexOf('Impr Value'),
      'Impr Value2': this.headers.indexOf('Impr Value2'),
      'Totl Value': this.headers.indexOf('Totl Value'),
      'Totl Value2': this.headers.indexOf('Totl Value2')
    });
    
    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|');
      
      if (values.length !== this.headers.length) {
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - possibly broken pipes. Row data:`, lines[i].substring(0, 200));
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
      property_addl_lot: null, // Not available in Microsystems
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
      values_norm_time: null, // Calculated later in FileUploadButton.jsx
      values_norm_size: null, // Calculated later in FileUploadButton.jsx
      
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
      asset_key_page: null, // User defined, created in module
      asset_lot_acre: this.parseNumeric(rawRecord['Lot Size In Acres'], 2),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.parseInteger(rawRecord['Lot Size In Sf']),
      asset_map_page: null, // User defined, created in module
      asset_neighborhood: rawRecord['Neighborhood'],
      asset_sfla: this.parseNumeric(rawRecord['Livable Area']),
      asset_story_height: this.parseNumeric(rawRecord['Story Height']),
      asset_type_use: rawRecord['Type Use Code'],
      asset_view: null, // Not available in Microsystems
      asset_year_built: this.parseInteger(rawRecord['Year Built']),
      asset_zoning: null, // User defined, created in module
      
      // Analysis and calculation fields
      analysis_code: null, // User defined, created in module
      analysis_version: 1,
      condition_rating: null, // User defined, created in module
      location_analysis: null, // User defined, created in module
      new_vcs: null, // User defined, created in module
      total_baths_calculated: this.calculateTotalBaths(rawRecord),
      
      // Processing metadata
      processed_at: new Date().toISOString(),
      processing_notes: null,
      validation_status: 'imported',
      is_new_since_last_upload: true,
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * ENHANCED: Process complete file and store in database with code file integration
   * UPDATED: Single table insertion only - no more dual-table complexity
   * NEW: Integrates code file storage in jobs table
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting Enhanced Microsystems file processing (SINGLE TABLE WITH CODE STORAGE)...');
      
      // NEW: Process and store code file if provided
      if (codeFileContent) {
        // await this.storeCodeFileInDatabase(codeFileContent, jobId);
      }
      
      // Parse source file
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in batches...`);
      
      // Prepare all property records for batch insert (SINGLE TABLE)
      const propertyRecords = [];
      
      for (const rawRecord of records) {
        try {
          // Map to unified property_records table with all 82 fields
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
      
      // SINGLE BATCH INSERT: Insert all property records to unified table (1000 at a time)
      console.log(`Batch inserting ${propertyRecords.length} property records to unified table...`);
      const batchSize = 1000;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        
        const { error: propertyError } = await supabase
          .from('property_records')
          .insert(batch);
        
        if (propertyError) {
          console.error('Batch property insert error:', propertyError);
          results.errors += batch.length;
        } else {
          results.processed += batch.length;
          console.log(`✅ Inserted property records ${i + 1}-${Math.min(i + batchSize, propertyRecords.length)}`);
        }
      }
      
      console.log('🚀 ENHANCED SINGLE TABLE PROCESSING COMPLETE WITH CODE STORAGE:', results);
      return results;
      
    } catch (error) {
      console.error('Enhanced Microsystems file processing failed:', error);
      throw error;
    }
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
   * NEW: Get code details including rate and category
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
   * NEW: Get all parsed code sections (for module access)
   */
  getAllCodeSections() {
    return {
      field_codes: this.allCodes,
      categories: this.categories,
      flat_lookup: Object.fromEntries(this.codeLookups)
    };
  }

  /**
   * NEW: Get codes by category
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
