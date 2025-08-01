/**
 * Enhanced BRT Updater with COMPLETE Section Parsing
 * FIXED: Now properly extracts ALL sections and InfoBy codes from nested MAP structures
 * Uses UPSERT instead of INSERT for updating existing jobs
 * Identical parsing logic to the enhanced BRT Processor
 * CLEANED: Removed surgical fix functions - job totals handled by AdminJobManagement/FileUploadButton
 * ADDED: Field preservation support for component-defined fields
 */

import { supabase } from '../supabaseClient.js';

export class BRTUpdater {
  constructor() {
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.headers = [];
    this.isTabSeparated = false;
    
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
        
        const { data, error } = await supabase
          .from('property_records')
          .upsert(batch, { 
            onConflict: 'property_composite_key',
            ignoreDuplicates: false 
          })
          .select();  // Add this to prevent returning all columns
        
        if (!error) {
          console.log(`✅ UPSERT Batch ${batchNumber} successful on attempt ${attempt}`);
          return { success: true, data };
        }
        
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
          console.error(`❌ UPSERT Batch ${batchNumber} failed with non-retryable error:`, error);
          return { error };
        }
        
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
   * FIXED: Process BRT code file with COMPLETE section parsing
   * Uses the proven logic from the enhanced processor
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('🔧 Processing BRT code file with COMPLETE section parsing (UPDATER)...');
    
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
        
        if (!line) {
          continue;
        }
        
        if (!line.startsWith('{') && !line.startsWith('"') && !inJsonBlock) {
          // Process previous section if exists
          if (jsonBuffer && currentSection) {
            this.parseJsonSection(jsonBuffer, currentSection);
          }
          
          currentSection = line.replace(/\r/g, ''); // Remove carriage returns
          jsonBuffer = '';
          inJsonBlock = false;
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
      
      console.log(`✅ Loaded ${this.codeLookups.size} code definitions from BRT file`);
      console.log(`📂 Found sections: ${Object.keys(this.allCodeSections).join(', ')}`);
      
      // Store code file in jobs table
      await this.storeCodeFileInDatabase(codeFileContent, jobId);
      
    } catch (error) {
      console.error('❌ Error parsing BRT code file:', error);
      throw error;
    }
  }

  /**
   * Store code file content and parsed definitions in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing complete code file in jobs table (UPDATER)...');
      
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
              residential_codes: Object.keys(this.allCodeSections.Residential || {}).length,
              mobile_codes: Object.keys(this.allCodeSections.Mobile || {}).length,
              qf_codes: Object.keys(this.allCodeSections.QF || {}).length,
              depth_codes: Object.keys(this.allCodeSections.Depth || {}).length,
              depr_codes: Object.keys(this.allCodeSections.Depr || {}).length,
              vcs_codes: Object.keys(this.allCodeSections.VCS || {}).length,
              parsed_at: new Date().toISOString()
            }
          }
        })
        .eq('id', jobId);

      if (error) {
        console.error('❌ Error storing code file in database:', error);
        throw error;
      }
      
      console.log('✅ Complete code file stored successfully in jobs table (UPDATER)');
    } catch (error) {
      console.error('❌ Failed to store code file:', error);
      // Don't throw - continue with processing even if code storage fails
    }
  }
  
  /**
   * ENHANCED: Parse a JSON section with complete InfoBy code extraction
   * Uses the proven recursive search logic from the enhanced processor
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
            this.vcsLookups.set(vcsCode, vcsItem);
            
            if (vcsItem.MAP && vcsItem.MAP['8'] && vcsItem.MAP['8'].DATA && vcsItem.MAP['8'].DATA.VALUE === 'URC') {
              const urcSection = vcsItem.MAP['8'].MAP;
              if (urcSection) {
                Object.keys(urcSection).forEach(urcKey => {
                  const urcItem = urcSection[urcKey];
                  if (urcItem.MAP && urcItem.MAP['1'] && urcItem.MAP['1'].DATA) {
                    const description = urcItem.MAP['1'].DATA.VALUE;
                    const lookupKey = `${sectionName}_URC_${vcsCode}_${urcKey}`;
                    this.codeLookups.set(lookupKey, description);
                    this.codeLookups.set(urcKey, description);
                  }
                });
              }
            }
          }
        });
        console.log(`✅ Loaded ${Object.keys(codeData).length} VCS codes`);
      } else {
        // Process other sections (Residential, Mobile, QF, Depth, Depr, etc.)
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            const lookupKey = `${sectionName}_${key}`;
            this.codeLookups.set(lookupKey, item.DATA.VALUE);
            this.codeLookups.set(key, item.DATA.VALUE);
          }
        });
        
        // ENHANCED: Search for InfoBy codes in nested structures
        if (sectionName === 'Residential') {
          this.searchForInfoByCodes(codeData, sectionName);
        }
        
        console.log(`✅ Loaded ${Object.keys(codeData).length} codes from ${sectionName} section`);
      }
      
    } catch (error) {
      console.error(`❌ Error parsing JSON section ${sectionName}:`, error);
    }
  }

  /**
   * ENHANCED: Search for InfoBy codes in nested MAP structures
   * Uses the exact logic from the successful artifact tester
   */
  searchForInfoByCodes(data, sectionName) {
    console.log(`🔍 Searching for InfoBy codes in ${sectionName} section...`);
    
    // Look for key "30" which contains InfoBy codes
    if (data['30']) {
      console.log(`🎯 Found key "30" in Residential section!`);
      const infoBySection = data['30'];
      
      if (infoBySection.MAP) {
        Object.keys(infoBySection.MAP).forEach(mapKey => {
          const mapItem = infoBySection.MAP[mapKey];
          if (mapItem.DATA && mapItem.DATA.VALUE) {
            const infoByCode = mapItem.KEY || mapItem.DATA.KEY;
            const description = mapItem.DATA.VALUE;
            this.codeLookups.set(`InfoBy_${infoByCode}`, description);
            console.log(`🎯 Found InfoBy code: ${infoByCode} = "${description}"`);
          }
        });
      }
    }
    
    // Also search recursively through all nested structures
    this.searchNestedForInfoBy(data, '', sectionName);
  }

  /**
   * ENHANCED: Recursive search for InfoBy codes in nested structures
   * Exact logic from the successful artifact tester
   */
  searchNestedForInfoBy(obj, path, sectionName) {
    if (typeof obj !== 'object' || obj === null) return;
    
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const currentPath = path ? `${path}.${key}` : key;
      
      // Look for InfoBy-related keywords
      if (value && value.DATA && value.DATA.VALUE) {
        const description = value.DATA.VALUE.toUpperCase();
        if (description.includes('OWNER') || description.includes('REFUSED') || 
            description.includes('AGENT') || description.includes('ESTIMATED') ||
            description.includes('SPOUSE') || description.includes('TENANT')) {
          const code = value.KEY || value.DATA.KEY;
          this.codeLookups.set(`InfoBy_${code}`, value.DATA.VALUE);
          console.log(`🎯 Found InfoBy code at ${currentPath}: ${code} = "${value.DATA.VALUE}"`);
        }
      }
      
      // Recurse into nested objects
      if (typeof value === 'object') {
        this.searchNestedForInfoBy(value, currentPath, sectionName);
      }
    });
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
    
    const separator = this.detectSeparator(lines[0]);
    this.isTabSeparated = (separator === '\t');
    
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
        record[header] = values[index] || null;
      });
      
      records.push(record);
    }
    
    console.log(`📊 Processing ${records.length} records in UPSERT batches...`);
    return records;
  }

  /**
   * Map BRT record to property_records table with string preservation (UPSERT VERSION)
   * ENHANCED: Now supports field preservation for component-defined fields
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}, preservedData = {}) {
    const blockValue = this.preserveStringValue(rawRecord.BLOCK);
    const lotValue = this.preserveStringValue(rawRecord.LOT);
    const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
    const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
    const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';
    
    // Build the base record
    const baseRecord = {
      // Job context
      job_id: jobId,
      
      // Property identifiers
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

    // ENHANCED: Merge with preserved data - preserved fields take precedence
    // This ensures component-defined fields are not overwritten during updates
    return {
      ...baseRecord,
      ...preservedData
    };
  }

  /**
   * MAIN PROCESS METHOD - ENHANCED UPSERT VERSION
   * CLEANED: Removed surgical fix functions - job totals handled by AdminJobManagement/FileUploadButton
   * ENHANCED: Added field preservation support
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('🚀 Starting ENHANCED BRT UPDATER (UPSERT) with COMPLETE section parsing and field preservation...');
      
      // Process and store code file if provided
      if (codeFileContent) {
        await this.processCodeFile(codeFileContent, jobId);
      }
      
      const records = this.parseSourceFile(sourceFileContent);
      
      // ENHANCED: Check if field preservation is enabled and get preserved data
      let preservedDataMap = new Map();
      if (versionInfo.preservedFieldsHandler && typeof versionInfo.preservedFieldsHandler === 'function') {
        console.log('🔒 Field preservation enabled, fetching existing data...');
        
        // Generate composite keys for all records
        const compositeKeys = records.map(rawRecord => {
          const blockValue = this.preserveStringValue(rawRecord.BLOCK);
          const lotValue = this.preserveStringValue(rawRecord.LOT);
          const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
          const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
          const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';
          
          return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`;
        });
        
        // Fetch preserved data using the handler from supabaseClient
        preservedDataMap = await versionInfo.preservedFieldsHandler(jobId, compositeKeys);
        console.log(`✅ Fetched preserved data for ${preservedDataMap.size} properties`);
      }
      
      const propertyRecords = [];
      
      for (const rawRecord of records) {
        try {
          // Generate composite key for this record
          const blockValue = this.preserveStringValue(rawRecord.BLOCK);
          const lotValue = this.preserveStringValue(rawRecord.LOT);
          const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
          const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
          const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';
          
          const compositeKey = `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`;
          
          // Get preserved data for this property if available
          const preservedData = preservedDataMap.get(compositeKey) || {};
          
          // Map to property record with preserved data
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo, preservedData);
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
      
      console.log(`Batch UPSERTING ${propertyRecords.length} property records...`);
      const batchSize = 500; // Reduced from 1000
      let consecutiveErrors = 0;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(propertyRecords.length / batchSize);
        
        console.log(`🚀 UPSERT batch ${batchNumber} of ${totalBatches}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
        const result = await this.upsertBatchWithRetry(batch, batchNumber);
        
        if (result.error) {
          console.error(`❌ UPSERT Batch ${batchNumber} failed:`, result.error);
          results.errors += batch.length;
          results.warnings.push(`Batch ${batchNumber} failed: ${result.error.message}`);
          
          // Increase delay on errors
          consecutiveErrors++;
          const errorDelay = Math.min(consecutiveErrors * 2000, 10000);
          console.log(`⚠️ Waiting ${errorDelay/1000}s before continuing due to errors...`);
          await new Promise(resolve => setTimeout(resolve, errorDelay));
        } else {
          results.processed += batch.length;
          console.log(`✅ UPSERT Batch ${batchNumber} completed successfully (${results.processed}/${propertyRecords.length} total)`);
          
          // Reset error counter on success
          consecutiveErrors = 0;
          
          // Small delay between successful batches
          if (i + batchSize < propertyRecords.length) {
            console.log(`⏳ Pausing 0.5s before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
      console.log('🚀 ENHANCED BRT UPDATER (UPSERT) COMPLETE WITH ALL SECTIONS:', results);
      return results;
      
    } catch (error) {
      console.error('Enhanced BRT updater failed:', error);
      throw error;
    }
  }

  // UTILITY FUNCTIONS (SAME AS ENHANCED PROCESSOR)
  
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
    
    const sectionPrefixes = ['VCS_URC', 'Residential', 'Mobile', 'QF', 'Depth', 'Depr'];
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
