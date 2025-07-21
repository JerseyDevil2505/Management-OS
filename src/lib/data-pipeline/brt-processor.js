/**
 * Enhanced BRT Processor 
 * Handles CSV source files and mixed-format code files
 * UPDATED: Single table insertion to property_records with all 82 fields
 * ENHANCED: Added retry logic for connection issues and query cancellations
 * NEW: Proper code file storage in jobs table and enhanced lot calculations
 */

import { supabase } from '../supabaseClient.js';

export class BRTProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.headers = [];
    
    // NEW: Store all parsed code sections for database storage
    this.allCodeSections = {};
  }

  /**
   * Insert batch with retry logic for connection issues
   */
  async insertBatchWithRetry(batch, batchNumber, retries = 50) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 Batch ${batchNumber}, attempt ${attempt}...`);
        
        const { data, error } = await supabase
          .from('property_records')
          .insert(batch);
        
        if (!error) {
          console.log(`✅ Batch ${batchNumber} successful on attempt ${attempt}`);
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
          console.error(`❌ Batch ${batchNumber} failed with non-retryable error:`, error);
          return { error };
        }
        
        // If we get here, it's the final attempt for a retryable error
        console.error(`❌ Batch ${batchNumber} failed after ${retries} attempts:`, error);
        return { error };
        
      } catch (networkError) {
        console.log(`🌐 Network error for batch ${batchNumber}, attempt ${attempt}:`, networkError.message);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return { error: networkError };
      }
    }
  }

  /**
   * Auto-detect if file is BRT format
   */
  detectFileType(fileContent) {
    const firstLine = fileContent.split('\n')[0];
    const headers = firstLine.split(',');
    
    return headers.includes('BLOCK') && 
           headers.includes('LOT') && 
           headers.includes('QUALIFIER') &&
           headers.includes('BATHTOT');
  }

  /**
   * ENHANCED: Process BRT code file and store in jobs table
   * Handles mixed format with headers and JSON sections
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('Processing BRT code file with database storage...');
    
    try {
      const lines = codeFileContent.split('\n');
      let currentSection = null;
      let jsonBuffer = '';
      let inJsonBlock = false;
      
      // Reset collections
      this.allCodeSections = {};
      this.codeLookups.clear();
      this.vcsLookups.clear();
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) continue;
        
        if (!line.startsWith('{') && !line.startsWith('"') && !inJsonBlock) {
          // Process previous section if exists
          if (jsonBuffer && currentSection) {
            this.parseJsonSection(jsonBuffer, currentSection);
          }
          
          currentSection = line;
          jsonBuffer = '';
          inJsonBlock = false;
          console.log(`Found section: ${currentSection}`);
          continue;
        }
        
        if (line.startsWith('{') || inJsonBlock) {
          inJsonBlock = true;
          jsonBuffer += line;
          
          const openBrackets = (jsonBuffer.match(/\{/g) || []).length;
          const closeBrackets = (jsonBuffer.match(/\}/g) || []).length;
          
          if (openBrackets === closeBrackets && openBrackets > 0) {
            if (currentSection) {
              this.parseJsonSection(jsonBuffer, currentSection);
            }
            jsonBuffer = '';
            inJsonBlock = false;
          }
        }
      }
      
      // Process final section
      if (jsonBuffer && currentSection) {
        this.parseJsonSection(jsonBuffer, currentSection);
      }
      
      console.log(`Loaded ${this.codeLookups.size} code definitions from BRT file`);
      console.log(`Found sections: ${Object.keys(this.allCodeSections).join(', ')}`);
      
      // NEW: Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('Error parsing BRT code file:', error);
      throw error;
    }
  }

  /**
   * NEW: Store code file content and parsed definitions in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing code file in jobs table...');
      
      const { error } = await supabase
        .from('jobs')
        .update({
          code_file_content: codeFileContent,
          code_file_name: 'BRT_Code_File.txt',
          code_file_uploaded_at: new Date().toISOString(),
          parsed_code_definitions: {
            vendor_type: 'BRT',
            sections: this.allCodeSections,
            summary: {
              total_sections: Object.keys(this.allCodeSections).length,
              vcs_codes: Object.keys(this.allCodeSections.VCS || {}).length,
              residential_codes: Object.keys(this.allCodeSections.Residential || {}).length,
              parsed_at: new Date().toISOString()
            }
          }
        })
        .eq('id', jobId);

      if (error) {
        console.error('Error storing code file in database:', error);
        throw error;
      }
      
      console.log('✅ Code file stored successfully in jobs table');
    } catch (error) {
      console.error('Failed to store code file:', error);
      // Don't throw - continue with processing even if code storage fails
    }
  }
  
  /**
   * ENHANCED: Parse a JSON section and store lookups + complete section data
   */
  parseJsonSection(jsonString, sectionName) {
    try {
      const codeData = JSON.parse(jsonString);
      
      // Store complete section data for database storage
      this.allCodeSections[sectionName] = codeData;
      
      if (sectionName === 'VCS') {
        // Process VCS section for land value calculations
        Object.keys(codeData).forEach(key => {
          const vcsItem = codeData[key];
          if (vcsItem.DATA && vcsItem.DATA.VALUE) {
            const vcsCode = vcsItem.DATA.VALUE;
            
            // Store VCS lookup for land calculations
            this.vcsLookups.set(vcsCode, vcsItem);
            
            // Also store unit rate codes within this VCS
            if (vcsItem.MAP && vcsItem.MAP['8'] && vcsItem.MAP['8'].DATA && vcsItem.MAP['8'].DATA.VALUE === 'URC') {
              const urcSection = vcsItem.MAP['8'].MAP;
              if (urcSection) {
                Object.keys(urcSection).forEach(urcKey => {
                  const urcItem = urcSection[urcKey];
                  if (urcItem.MAP && urcItem.MAP['1'] && urcItem.MAP['1'].DATA) {
                    const description = urcItem.MAP['1'].DATA.VALUE;
                    const lookupKey = `${sectionName}_URC_${vcsCode}_${urcKey}`;
                    this.codeLookups.set(lookupKey, description);
                    
                    // Store simplified lookup for lot calculations
                    this.codeLookups.set(urcKey, description);
                  }
                });
              }
            }
          }
        });
        console.log(`Loaded ${Object.keys(codeData).length} VCS codes`);
      } else {
        // Process other sections (Residential, Quality Factors, etc.)
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            const lookupKey = `${sectionName}_${key}`;
            this.codeLookups.set(lookupKey, item.DATA.VALUE);
            
            // Also store without section prefix for easier lookup
            this.codeLookups.set(key, item.DATA.VALUE);
          }
        });
        console.log(`Loaded ${Object.keys(codeData).length} codes from ${sectionName} section`);
      }
      
    } catch (error) {
      console.error(`Error parsing JSON section ${sectionName}:`, error);
    }
  }

  /**
   * Parse a single CSV line with proper handling of quoted fields and commas
   */
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Handle escaped quotes ("")
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        // Found field separator outside quotes
        result.push(current.trim());
        current = '';
        i++;
        continue;
      } else {
        current += char;
      }
      
      i++;
    }
    
    // Add the last field
    result.push(current.trim());
    
    return result;
  }

  /**
   * Parse CSV BRT file (comma-delimited with proper CSV parsing)
   */
  parseSourceFile(fileContent) {
    console.log('Parsing BRT source file...');
    
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('File must have at least header and one data row');
    }
    
    // Use proper CSV parsing to handle quoted fields and commas within fields
    this.headers = this.parseCSVLine(lines[0]);
    console.log(`Found ${this.headers.length} headers`);
    console.log('Headers:', this.headers.slice(0, 10));
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      
      if (values.length !== this.headers.length) {
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - skipping`);
        continue;
      }
      
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
   * Map BRT record to property_records table (ALL 82 FIELDS)
   * UPDATED: Combines original property_records + analysis fields into single record
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}) {
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers
      property_block: rawRecord.BLOCK,
      property_lot: rawRecord.LOT,
      property_qualifier: rawRecord.QUALIFIER,
      property_addl_card: rawRecord.CARD,
      property_addl_lot: null, // Not available in BRT
      property_location: rawRecord.PROPERTY_LOCATION,
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord.BLOCK}-${rawRecord.LOT}_${rawRecord.QUALIFIER || 'NONE'}-${rawRecord.CARD || 'NONE'}-${rawRecord.PROPERTY_LOCATION || 'NONE'}`,
      property_cama_class: rawRecord.PROPCLASS,
      property_m4_class: rawRecord.PROPERTY_CLASS,
      property_facility: rawRecord.EXEMPT_FACILITYNAME,
      property_vcs: rawRecord.VCS,
      
      // Owner fields
      owner_name: rawRecord.OWNER_OWNER,
      owner_street: rawRecord.OWNER_ADDRESS,
      owner_csz: this.calculateOwnerCsZ(rawRecord),
      
      // Sales fields
      sales_date: this.parseDate(rawRecord.CURRENTSALE_DATE),
      sales_price: this.parseNumeric(rawRecord.CURRENTSALE_PRICE),
      sales_book: rawRecord.CURRENTSALE_DEEDBOOK,
      sales_page: rawRecord.CURRENTSALE_DEEDPAGE,
      sales_nu: rawRecord.CURRENTSALE_NUC,
      
      // Values fields
      values_mod_land: this.parseNumeric(rawRecord.VALUES_LANDTAXABLEVALUE),
      values_cama_land: this.parseNumeric(rawRecord.TOTALLANDVALUE),
      values_mod_improvement: this.parseNumeric(rawRecord.VALUES_IMPROVTAXABLEVALUE),
      values_cama_improvement: this.parseNumeric(rawRecord.TOTALIMPROVVALUE),
      values_mod_total: this.parseNumeric(rawRecord.VALUES_NETTAXABLEVALUE),
      values_cama_total: this.parseNumeric(rawRecord.TOTNETVALUE),
      values_base_cost: this.parseNumeric(rawRecord.BASEREPLCOST),
      values_det_items: this.parseNumeric(rawRecord.DETACHEDITEMS),
      values_repl_cost: this.parseNumeric(rawRecord.REPLCOSTNEW),
      values_norm_time: null, // Calculated later in FileUploadButton.jsx
      values_norm_size: null, // Calculated later in FileUploadButton.jsx
      
      // Inspection fields
      inspection_info_by: this.parseInteger(rawRecord.INFOBY),
      inspection_list_by: rawRecord.LISTBY,
      inspection_list_date: this.parseDate(rawRecord.LISTDT),
      inspection_measure_by: rawRecord.MEASUREBY,
      inspection_measure_date: this.parseDate(rawRecord.MEASUREDT),
      inspection_price_by: rawRecord.PRICEBY,
      inspection_price_date: this.parseDate(rawRecord.PRICEDT),
      
      // Asset fields - All analysis fields now in single table
      asset_building_class: rawRecord.BLDGCLASS,
      asset_design_style: rawRecord.DESIGN,
      asset_ext_cond: rawRecord.EXTERIORNC,
      asset_int_cond: rawRecord.INTERIORNC,
      asset_key_page: null, // User defined, created in module
      asset_lot_acre: this.calculateLotAcres(rawRecord),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.calculateLotSquareFeet(rawRecord),
      asset_map_page: null, // User defined, created in module
      asset_neighborhood: rawRecord.NBHD,
      asset_sfla: this.parseNumeric(rawRecord.SFLA_TOTAL),
      asset_story_height: this.parseNumeric(rawRecord.STORYHGT),
      asset_type_use: rawRecord.TYPEUSE,
      asset_view: rawRecord.VIEW,
      asset_year_built: this.parseInteger(rawRecord.YEARBUILT),
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
      vendor_source: 'BRT',
      import_session_id: versionInfo.import_session_id || null,
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * Calculate total bathrooms with proper half-bath weighting
   * BRT's BATHTOT counts half baths as full, so we adjust
   */
  calculateTotalBaths(rawRecord) {
    const bathTot = this.parseNumeric(rawRecord.BATHTOT) || 0;
    const twoFix = this.parseNumeric(rawRecord.PLUMBING2FIX) || 0;
    
    const adjustedTotal = bathTot - twoFix + (twoFix * 0.5);
    return adjustedTotal > 0 ? adjustedTotal : null;
  }

  /**
   * Calculate owner city, state, zip combination
   */
  calculateOwnerCsZ(rawRecord) {
    const city = rawRecord.OWNER_CITYSTATE || '';
    const zip = rawRecord.OWNER_ZIP || '';
    
    if (!city && !zip) return null;
    if (!zip) return city;
    if (!city) return zip;
    
    return `${city} ${zip}`;
  }

  /**
   * Calculate lot frontage - sum of LANDFF_1 through LANDFF_6
   */
  calculateLotFrontage(rawRecord) {
    let totalFrontage = 0;
    let hasValues = false;
    
    for (let i = 1; i <= 6; i++) {
      const frontFt = this.parseNumeric(rawRecord[`LANDFF_${i}`]);
      if (frontFt) {
        totalFrontage += frontFt;
        hasValues = true;
      }
    }
    
    return hasValues ? totalFrontage : null;
  }

  /**
   * Calculate lot depth - average of LANDAVGDEP_1 through LANDAVGDEP_6
   */
  calculateLotDepth(rawRecord) {
    const depths = [];
    
    for (let i = 1; i <= 6; i++) {
      const avgDepth = this.parseNumeric(rawRecord[`LANDAVGDEP_${i}`]);
      if (avgDepth) depths.push(avgDepth);
    }
    
    if (depths.length === 0) return null;
    
    const average = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    return parseFloat(average.toFixed(2));
  }

  /**
   * ENHANCED: Calculate lot size in acres using LANDUR_1 through LANDUR_6 codes with VCS lookup
   * NOW: Uses code file definitions to properly interpret land unit codes
   */
  calculateLotAcres(rawRecord) {
    let totalAcres = 0;
    let totalSqFt = 0;
    let foundAcres = false;
    let foundSqFt = false;
    
    // Check each LANDUR field (1-6)
    for (let i = 1; i <= 6; i++) {
      const urCode = rawRecord[`LANDUR_${i}`];
      const urValue = this.parseNumeric(rawRecord[`LANDURVALUE_${i}`]);
      
      if (!urCode || !urValue) continue;
      
      // NEW: Look up code description from VCS data
      const codeDescription = this.getCodeDescription(urCode);
      
      if (codeDescription) {
        // Check if this code represents acres
        if (codeDescription.toUpperCase().includes('ACRE') || 
            codeDescription.toUpperCase().includes('AC')) {
          totalAcres += urValue;
          foundAcres = true;
          console.log(`Found acres: ${urCode} (${codeDescription}) = ${urValue} acres`);
        }
        // Check if this code represents square feet
        else if (codeDescription.toUpperCase().includes('SITE') && 
                 !codeDescription.toUpperCase().includes('ACRE')) {
          // Most site values are per square foot, convert to acres
          totalSqFt += urValue;
          foundSqFt = true;
          console.log(`Found sq ft: ${urCode} (${codeDescription}) = ${urValue} sq ft`);
        }
      } else {
        // FALLBACK: Use original logic if no code description found
        if (urCode.includes('AC')) {
          totalAcres += urValue;
          foundAcres = true;
        } else if (urCode.includes('SF')) {
          totalSqFt += urValue;
          foundSqFt = true;
        }
      }
    }
    
    // Convert square feet to acres if no acres found
    if (!foundAcres && foundSqFt && totalSqFt > 0) {
      totalAcres = totalSqFt / 43560;
    }
    
    return totalAcres > 0 ? parseFloat(totalAcres.toFixed(3)) : null;
  }

  /**
   * Calculate lot size in square feet
   */
  calculateLotSquareFeet(rawRecord) {
    const acres = this.calculateLotAcres(rawRecord);
    return acres ? Math.round(acres * 43560) : null;
  }

  /**
   * ENHANCED: Process complete file and store in database with code file integration
   * UPDATED: Single table insertion only - no more dual-table complexity
   * ENHANCED: Added retry logic for connection issues and query cancellations
   * NEW: Integrates code file storage in jobs table
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting Enhanced BRT file processing (SINGLE TABLE WITH CODE STORAGE)...');
      
      // NEW: Process and store code file if provided
      if (codeFileContent) {
        await this.processCodeFile(codeFileContent, jobId);
      }
      
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
      console.log(`Batch inserting ${propertyRecords.length} property records to unified table with retry logic...`);
      const batchSize = 1000;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        console.log(`🚀 Processing batch ${batchNumber}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
        const result = await this.insertBatchWithRetry(batch, batchNumber);
        
        if (result.error) {
          console.error(`❌ Batch ${batchNumber} failed after retries:`, result.error);
          results.errors += batch.length;
          results.warnings.push(`Batch ${batchNumber} failed: ${result.error.message}`);
        } else {
          results.processed += batch.length;
          console.log(`✅ Batch ${batchNumber} completed successfully`);
        }
      }
      
      console.log('🚀 ENHANCED SINGLE TABLE PROCESSING COMPLETE WITH CODE STORAGE:', results);
      return results;
      
    } catch (error) {
      console.error('Enhanced BRT file processing failed:', error);
      throw error;
    }
  }

  // Utility functions (preserved from original)
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
   * ENHANCED: Get code description with fallback to original code
   * Now uses stored code definitions from all sections
   */
  getCodeDescription(code) {
    // Try exact match first
    if (this.codeLookups.has(code)) {
      return this.codeLookups.get(code);
    }
    
    // Try VCS lookup
    if (this.vcsLookups.has(code)) {
      const vcsItem = this.vcsLookups.get(code);
      return vcsItem.DATA ? vcsItem.DATA.VALUE : code;
    }
    
    // Try with different section prefixes
    const sectionPrefixes = ['VCS_URC', 'Residential', 'Quality_Factors', 'Depth_Factors'];
    for (const prefix of sectionPrefixes) {
      const prefixedKey = `${prefix}_${code}`;
      if (this.codeLookups.has(prefixedKey)) {
        return this.codeLookups.get(prefixedKey);
      }
    }
    
    // Return original code if no description found
    return code;
  }

  /**
   * NEW: Get all parsed code sections (for module access)
   */
  getAllCodeSections() {
    return this.allCodeSections;
  }

  /**
   * NEW: Get specific section codes
   */
  getSectionCodes(sectionName) {
    return this.allCodeSections[sectionName] || {};
  }
}

export const brtProcessor = new BRTProcessor();
