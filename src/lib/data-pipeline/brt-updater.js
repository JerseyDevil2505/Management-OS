/**
 * BRT Updater (UPSERT Version) 
 * Based on BRTProcessor but uses UPSERT instead of INSERT
 * For updating existing jobs with new file versions
 * Handles both comma-separated CSV and tab-separated files automatically
 */

import { supabase } from '../supabaseClient.js';

export class BRTUpdater {
  constructor() {
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.headers = [];
    this.isTabSeparated = false; // Track file format
    
    // Store all parsed code sections for database storage
    this.allCodeSections = {};
  }

  /**
   * Ensure string values are preserved exactly as-is
   */
  preserveStringValue(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return String(value).trim();
  }

  /**
   * Auto-detect file format (comma-separated vs tab-separated)
   */
  detectSeparator(firstLine) {
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    
    if (tabCount > 10 && tabCount > commaCount * 2) {
      console.log(`🔍 Detected TAB-SEPARATED file: ${tabCount} tabs vs ${commaCount} commas`);
      return '\t';
    } else {
      console.log(`🔍 Detected COMMA-SEPARATED file: ${commaCount} commas vs ${tabCount} tabs`);
      return ',';
    }
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
   * Auto-detect if file is BRT format
   */
  detectFileType(fileContent) {
    const firstLine = fileContent.split('\n')[0];
    const commaHeaders = firstLine.split(',');
    const tabHeaders = firstLine.split('\t');
    
    const hasCommaFormat = commaHeaders.includes('BLOCK') && 
                          commaHeaders.includes('LOT') && 
                          commaHeaders.includes('QUALIFIER') &&
                          commaHeaders.includes('BATHTOT');
                          
    const hasTabFormat = tabHeaders.includes('BLOCK') && 
                        tabHeaders.includes('LOT') && 
                        tabHeaders.includes('QUALIFIER') &&
                        tabHeaders.includes('BATHTOT');
    
    return hasCommaFormat || hasTabFormat;
  }

  /**
   * Process BRT code file and store in jobs table
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
      
      // Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('Error parsing BRT code file:', error);
      throw error;
    }
  }

  /**
   * Store code file content and parsed definitions in jobs table
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
   * Parse a JSON section and store lookups + complete section data
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
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
        i++;
        continue;
      } else {
        current += char;
      }
      
      i++;
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Parse line with automatic format detection (comma vs tab)
   */
  parseLine(line, separator) {
    if (separator === ',') {
      return this.parseCSVLine(line);
    } else {
      return line.split('\t').map(value => value.trim());
    }
  }

  /**
   * Parse BRT file with automatic format detection and string preservation
   */
  parseSourceFile(fileContent) {
    console.log('Parsing BRT source file with format auto-detection...');
    
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('File must have at least header and one data row');
    }
    
    // Auto-detect separator format
    const separator = this.detectSeparator(lines[0]);
    this.isTabSeparated = (separator === '\t');
    
    // Parse headers using detected format
    this.headers = this.parseLine(lines[0], separator);
    console.log(`Found ${this.headers.length} headers using ${this.isTabSeparated ? 'TAB' : 'COMMA'} separation`);
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseLine(lines[i], separator);
      
      if (values.length !== this.headers.length) {
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - skipping`);
        continue;
      }
      
      const record = {};
      this.headers.forEach((header, index) => {
        // Store all values as strings to preserve original format
        record[header] = values[index] || null;
      });
      
      records.push(record);
    }
    
    console.log(`Parsed ${records.length} records using ${this.isTabSeparated ? 'TAB' : 'COMMA'} separation`);
    return records;
  }

  /**
   * Map BRT record to property_records table with string preservation (SAME AS PROCESSOR)
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}) {
    // Preserve original string format for block and lot
    const blockValue = this.preserveStringValue(rawRecord.BLOCK);
    const lotValue = this.preserveStringValue(rawRecord.LOT);
    const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
    const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
    const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';
    
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers - Use preserved string values
      property_block: blockValue,
      property_lot: lotValue,
      property_qualifier: qualifierValue === 'NONE' ? null : qualifierValue,
      property_addl_card: cardValue === 'NONE' ? null : cardValue,
      property_addl_lot: null,
      property_location: locationValue === 'NONE' ? null : locationValue,
      property_composite_key: `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`,
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
      values_norm_time: null,
      values_norm_size: null,
      
      // Inspection fields
      inspection_info_by: this.parseInteger(rawRecord.INFOBY),
      inspection_list_by: rawRecord.LISTBY,
      inspection_list_date: this.parseDate(rawRecord.LISTDT),
      inspection_measure_by: rawRecord.MEASUREBY,
      inspection_measure_date: this.parseDate(rawRecord.MEASUREDT),
      inspection_price_by: rawRecord.PRICEBY,
      inspection_price_date: this.parseDate(rawRecord.PRICEDT),
      
      // Asset fields
      asset_building_class: rawRecord.BLDGCLASS,
      asset_design_style: rawRecord.DESIGN,
      asset_ext_cond: rawRecord.EXTERIORNC,
      asset_int_cond: rawRecord.INTERIORNC,
      asset_key_page: null,
      asset_lot_acre: this.calculateLotAcres(rawRecord),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.calculateLotSquareFeet(rawRecord),
      asset_map_page: null,
      asset_neighborhood: rawRecord.NBHD,
      asset_sfla: this.parseNumeric(rawRecord.SFLA_TOTAL),
      asset_story_height: this.parseNumeric(rawRecord.STORYHGT),
      asset_type_use: rawRecord.TYPEUSE,
      asset_view: rawRecord.VIEW,
      asset_year_built: this.parseInteger(rawRecord.YEARBUILT),
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
      vendor_source: 'BRT',
      import_session_id: versionInfo.import_session_id || null,
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      created_at: new Date().toISOString(), // Will be ignored on UPSERT
      updated_at: new Date().toISOString(),
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * MAIN PROCESS METHOD - UPSERT VERSION
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting BRT UPDATER (UPSERT) processing...');
      
      // Process and store code file if provided
      if (codeFileContent) {
        await this.processCodeFile(codeFileContent, jobId);
      }
      
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in UPSERT batches...`);
      
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
      
      console.log('🚀 BRT UPDATER (UPSERT) COMPLETE:', results);
      return results;
      
    } catch (error) {
      console.error('BRT updater failed:', error);
      throw error;
    }
  }

  // UTILITY FUNCTIONS (SAME AS PROCESSOR)
  
  calculateTotalBaths(rawRecord) {
    const bathTot = this.parseNumeric(rawRecord.BATHTOT) || 0;
    const twoFix = this.parseNumeric(rawRecord.PLUMBING2FIX) || 0;
    
    const adjustedTotal = bathTot - twoFix + (twoFix * 0.5);
    return adjustedTotal > 0 ? adjustedTotal : null;
  }

  calculateOwnerCsZ(rawRecord) {
    const city = rawRecord.OWNER_CITYSTATE || '';
    const zip = rawRecord.OWNER_ZIP || '';
    
    if (!city && !zip) return null;
    if (!zip) return city;
    if (!city) return zip;
    
    return `${city} ${zip}`;
  }

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

  calculateLotAcres(rawRecord) {
    let totalAcres = 0;
    let totalSqFt = 0;
    let foundAcres = false;
    let foundSqFt = false;
    
    for (let i = 1; i <= 6; i++) {
      const urCode = rawRecord[`LANDUR_${i}`];
      const urValue = this.parseNumeric(rawRecord[`LANDURVALUE_${i}`]);
      
      if (!urCode || !urValue) continue;
      
      const codeDescription = this.getCodeDescription(urCode);
      
      if (codeDescription) {
        if (codeDescription.toUpperCase().includes('ACRE') || 
            codeDescription.toUpperCase().includes('AC')) {
          totalAcres += urValue;
          foundAcres = true;
        } else if (codeDescription.toUpperCase().includes('SITE') && 
                   !codeDescription.toUpperCase().includes('ACRE')) {
          totalSqFt += urValue;
          foundSqFt = true;
        }
      } else {
        if (urCode.includes('AC')) {
          totalAcres += urValue;
          foundAcres = true;
        } else if (urCode.includes('SF')) {
          totalSqFt += urValue;
          foundSqFt = true;
        }
      }
    }
    
    if (!foundAcres && foundSqFt && totalSqFt > 0) {
      totalAcres = totalSqFt / 43560;
    }
    
    return totalAcres > 0 ? parseFloat(totalAcres.toFixed(3)) : null;
  }

  calculateLotSquareFeet(rawRecord) {
    const acres = this.calculateLotAcres(rawRecord);
    return acres ? Math.round(acres * 43560) : null;
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
    
    if (this.vcsLookups.has(code)) {
      const vcsItem = this.vcsLookups.get(code);
      return vcsItem.DATA ? vcsItem.DATA.VALUE : code;
    }
    
    const sectionPrefixes = ['VCS_URC', 'Residential', 'Quality_Factors', 'Depth_Factors'];
    for (const prefix of sectionPrefixes) {
      const prefixedKey = `${prefix}_${code}`;
      if (this.codeLookups.has(prefixedKey)) {
        return this.codeLookups.get(prefixedKey);
      }
    }
    
    return code;
  }

  getAllCodeSections() {
    return this.allCodeSections;
  }

  getSectionCodes(sectionName) {
    return this.allCodeSections[sectionName] || {};
  }
}

export const brtUpdater = new BRTUpdater();
