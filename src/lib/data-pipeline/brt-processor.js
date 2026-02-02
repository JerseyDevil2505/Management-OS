/**
 * Enhanced BRT Processor with COMPLETE Section Parsing
 * FIXED: Now properly extracts ALL sections and InfoBy codes from nested MAP structures
 * Uses the proven parsing logic from the artifact tester
 * CLEANED: Removed surgical fix functions - job totals handled by AdminJobManagement
 * CRITICAL: Added automatic cleanup for failed batches - prevents partial job creation!
 */

import { supabase } from '../supabaseClient.js';

export class BRTProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.headers = [];
    this.isTabSeparated = false;

    // Store all parsed code sections for database storage
    this.allCodeSections = {};

    // Store code configuration for categorizing items
    this.codeConfig = {};
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
   * CRITICAL FIX: Optimize batch for database performance
   */
  optimizeBatchForDatabase(batch) {
    // Preserve explicit nulls for these fields so upserts can clear legacy values
    const PRESERVE_NULL_FIELDS = new Set([
      'asset_lot_acre',
      'asset_lot_sf',
      'inspection_price_by',
      'inspection_price_date'
    ]);
    return batch.map(record => {
      const cleaned = {};
      for (const [key, value] of Object.entries(record)) {
        // Keep explicit null for preserved fields
        if (value === null && PRESERVE_NULL_FIELDS.has(key)) {
          cleaned[key] = null;
          continue;
        }
        // Keep meaningful values (non-empty, non-undefined)
        if (value !== undefined && value !== '') {
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
        console.log(`🔄 Batch ${batchNumber}, attempt ${attempt}...`);
        
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
          console.log(`✅ Batch ${batchNumber} successful on attempt ${attempt}`);
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
          console.error(`❌ Batch ${batchNumber} failed with non-retryable error:`, error);
          return { error };
        }
        
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
   * Uses the proven logic from the artifact tester
   */
  async processCodeFile(codeFileContent, jobId) {
    console.log('🔧 Processing BRT code file with COMPLETE section parsing...');
    
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
   * CRITICAL FIX: Store source file content in jobs table (eliminates raw_data duplication)
   */
  async storeSourceFileInDatabase(sourceFileContent, jobId) {
    try {
      console.log('💾 Storing complete source file in jobs table...');

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
        console.error('❌ Error storing source file in database:', error);
        throw error;
      }

      console.log('✅ Complete source file stored successfully in jobs table');
    } catch (error) {
      console.error('❌ Failed to store source file:', error);
      // Don't throw - continue with processing even if storage fails
    }
  }

  /**
   * Store code file content and parsed definitions in jobs table
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    try {
      console.log('💾 Storing complete code file in jobs table...');
      
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
      
      console.log('✅ Complete code file stored successfully in jobs table');
    } catch (error) {
      console.error('❌ Failed to store code file:', error);
      // Don't throw - continue with processing even if code storage fails
    }
  }
  
  /**
   * ENHANCED: Parse a JSON section with complete InfoBy code extraction
   * Uses the proven recursive search logic from the artifact tester
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
        
        // ENHANCED: Search for InfoBy codes in nested structures (from artifact logic)
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
   * FIXED: Search by section KEY "53" or VALUE "INFO" instead of hardcoded parent key "30"
   * This handles BRT files with different structures (e.g., files with extra sections like 06, 07, 08)
   */
  searchForInfoByCodes(data, sectionName) {
    console.log(`🔍 Searching for InfoBy codes in ${sectionName} section...`);

    let infoBySection = null;

    // Search all parent keys to find the one with KEY="53" or VALUE containing "INFO"
    Object.keys(data).forEach(parentKey => {
      const section = data[parentKey];
      if (section?.KEY === '53' || section?.DATA?.VALUE?.includes('INFO')) {
        infoBySection = section;
        console.log(`🎯 Found InfoBy section at parent key "${parentKey}" with KEY="${section.KEY}" VALUE="${section.DATA?.VALUE}"`);
      }
    });

    if (infoBySection && infoBySection.MAP) {
      Object.keys(infoBySection.MAP).forEach(mapKey => {
        const mapItem = infoBySection.MAP[mapKey];
        if (mapItem.DATA && mapItem.DATA.VALUE) {
          const infoByCode = mapItem.KEY || mapItem.DATA.KEY;
          const description = mapItem.DATA.VALUE;
          this.codeLookups.set(`InfoBy_${infoByCode}`, description);
          console.log(`🎯 Found InfoBy code: ${infoByCode} = "${description}"`);
        }
      });
    } else {
      console.log(`⚠️ WARNING: Could not find InfoBy section (KEY=53) in ${sectionName} section`);
    }

    // Also search recursively through all nested structures as fallback
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
    
    console.log(`📊 Processing ${records.length} records in batches...`);
    return records;
  }

  /**
   * Map BRT record to property_records table with string preservation
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}) {
    const blockValue = this.preserveStringValue(rawRecord.BLOCK);
    const lotValue = this.preserveStringValue(rawRecord.LOT);
    const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
    const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
    const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';
    
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers
      property_block: blockValue,
      property_lot: lotValue,
      property_qualifier: qualifierValue === 'NONE' ? null : qualifierValue,
      property_addl_card: cardValue === 'NONE' ? null : cardValue,
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
      
      // Inspection fields
      inspection_info_by: this.preserveStringValue(rawRecord.INFOBY),
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
      asset_lot_acre: this.calculateLotAcres(rawRecord),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_sf: this.calculateLotSquareFeet(rawRecord),
      asset_neighborhood: rawRecord.NBHD,
      asset_sfla: this.parseNumeric(rawRecord.SFLA_TOTAL),
      asset_story_height: rawRecord.STORYHGT || null,  // Keep as text for floor analysis
      asset_type_use: rawRecord.TYPEUSE,
      asset_view: rawRecord.VIEW,
      asset_year_built: this.parseInteger(rawRecord.YEARBUILT),
      asset_effective_age: this.parseInteger(rawRecord.EFFAGE),  // BRT: EFFAGE is already a year (e.g., 1950)
      asset_bedrooms: this.parseInteger(rawRecord.BEDTOT),

      // Special tax district codes (BRT: EXEMPT_SPECIAL_TAXCODE1-4)
      special_tax_code_1: this.preserveStringValue(rawRecord.EXEMPT_SPECIAL_TAXCODE1),
      special_tax_code_2: this.preserveStringValue(rawRecord.EXEMPT_SPECIAL_TAXCODE2),
      special_tax_code_3: this.preserveStringValue(rawRecord.EXEMPT_SPECIAL_TAXCODE3),
      special_tax_code_4: this.preserveStringValue(rawRecord.EXEMPT_SPECIAL_TAXCODE4),

      // LANDUR fields (BRT unit-rate codes and units) - use lowercase column names to match DB
      landur_1: (rawRecord['LANDUR_1'] !== undefined && rawRecord['LANDUR_1'] !== null) ? String(rawRecord['LANDUR_1']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_1: this.parseNumeric(rawRecord['LANDURUNITS_1']),
      landur_2: (rawRecord['LANDUR_2'] !== undefined && rawRecord['LANDUR_2'] !== null) ? String(rawRecord['LANDUR_2']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_2: this.parseNumeric(rawRecord['LANDURUNITS_2']),
      landur_3: (rawRecord['LANDUR_3'] !== undefined && rawRecord['LANDUR_3'] !== null) ? String(rawRecord['LANDUR_3']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_3: this.parseNumeric(rawRecord['LANDURUNITS_3']),
      landur_4: (rawRecord['LANDUR_4'] !== undefined && rawRecord['LANDUR_4'] !== null) ? String(rawRecord['LANDUR_4']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_4: this.parseNumeric(rawRecord['LANDURUNITS_4']),
      landur_5: (rawRecord['LANDUR_5'] !== undefined && rawRecord['LANDUR_5'] !== null) ? String(rawRecord['LANDUR_5']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_5: this.parseNumeric(rawRecord['LANDURUNITS_5']),
      landur_6: (rawRecord['LANDUR_6'] !== undefined && rawRecord['LANDUR_6'] !== null) ? String(rawRecord['LANDUR_6']).replace(/[^0-9]/g,'').padStart(2,'0') : null,
      landurunits_6: this.parseNumeric(rawRecord['LANDURUNITS_6']),

      // Analysis and calculation fields
      // REMOVED: location_analysis, new_vcs, asset_map_page, asset_key_page,
      //          asset_zoning, values_norm_size, values_norm_time
      //          (moved to property_market_analysis table)
      total_baths_calculated: this.calculateTotalBaths(rawRecord),

      // Normalized amenity area fields (extracted from BRT codes using configuration)
      fireplace_count: this.extractFireplaceCount(rawRecord),
      basement_area: this.extractBasementArea(rawRecord),
      fin_basement_area: this.extractFinBasementArea(rawRecord),
      garage_area: this.extractGarageAreaFromConfig(rawRecord),
      deck_area: this.extractDeckAreaFromConfig(rawRecord),
      patio_area: this.extractPatioAreaFromConfig(rawRecord),
      open_porch_area: this.extractOpenPorchAreaFromConfig(rawRecord),
      enclosed_porch_area: this.extractEnclosedPorchAreaFromConfig(rawRecord),
      det_garage_area: this.extractDetGarageAreaFromConfig(rawRecord),
      pool_area: this.extractPoolAreaFromConfig(rawRecord),
      barn_area: this.extractBarnAreaFromConfig(rawRecord),
      stable_area: this.extractStableAreaFromConfig(rawRecord),
      pole_barn_area: this.extractPoleBarnAreaFromConfig(rawRecord),
      ac_area: this.extractAcArea(rawRecord),

      // Dynamic adjustments from code configuration
      miscellaneous: this.extractMiscellaneousFromConfig(rawRecord),

      // BRT Detached structure detail columns (DETACHEDCODE_1-11, DETACHEDDCSIZE_1-11, DETACHEDNC_1-11)
      detachedcode_1: this.preserveStringValue(rawRecord.DETACHEDCODE_1),
      detacheddcsize_1: this.parseNumeric(rawRecord.DETACHEDDCSIZE_1),
      detachednc_1: this.parseNumeric(rawRecord.DETACHEDNC_1),
      detachedcode_2: this.preserveStringValue(rawRecord.DETACHEDCODE_2),
      detacheddcsize_2: this.parseNumeric(rawRecord.DETACHEDDCSIZE_2),
      detachednc_2: this.parseNumeric(rawRecord.DETACHEDNC_2),
      detachedcode_3: this.preserveStringValue(rawRecord.DETACHEDCODE_3),
      detacheddcsize_3: this.parseNumeric(rawRecord.DETACHEDDCSIZE_3),
      detachednc_3: this.parseNumeric(rawRecord.DETACHEDNC_3),
      detachedcode_4: this.preserveStringValue(rawRecord.DETACHEDCODE_4),
      detacheddcsize_4: this.parseNumeric(rawRecord.DETACHEDDCSIZE_4),
      detachednc_4: this.parseNumeric(rawRecord.DETACHEDNC_4),
      detachedcode_5: this.preserveStringValue(rawRecord.DETACHEDCODE_5),
      detacheddcsize_5: this.parseNumeric(rawRecord.DETACHEDDCSIZE_5),
      detachednc_5: this.parseNumeric(rawRecord.DETACHEDNC_5),
      detachedcode_6: this.preserveStringValue(rawRecord.DETACHEDCODE_6),
      detacheddcsize_6: this.parseNumeric(rawRecord.DETACHEDDCSIZE_6),
      detachednc_6: this.parseNumeric(rawRecord.DETACHEDNC_6),
      detachedcode_7: this.preserveStringValue(rawRecord.DETACHEDCODE_7),
      detacheddcsize_7: this.parseNumeric(rawRecord.DETACHEDDCSIZE_7),
      detachednc_7: this.parseNumeric(rawRecord.DETACHEDNC_7),
      detachedcode_8: this.preserveStringValue(rawRecord.DETACHEDCODE_8),
      detacheddcsize_8: this.parseNumeric(rawRecord.DETACHEDDCSIZE_8),
      detachednc_8: this.parseNumeric(rawRecord.DETACHEDNC_8),
      detachedcode_9: this.preserveStringValue(rawRecord.DETACHEDCODE_9),
      detacheddcsize_9: this.parseNumeric(rawRecord.DETACHEDDCSIZE_9),
      detachednc_9: this.parseNumeric(rawRecord.DETACHEDNC_9),
      detachedcode_10: this.preserveStringValue(rawRecord.DETACHEDCODE_10),
      detacheddcsize_10: this.parseNumeric(rawRecord.DETACHEDDCSIZE_10),
      detachednc_10: this.parseNumeric(rawRecord.DETACHEDNC_10),
      detachedcode_11: this.preserveStringValue(rawRecord.DETACHEDCODE_11),
      detacheddcsize_11: this.parseNumeric(rawRecord.DETACHEDDCSIZE_11),
      detachednc_11: this.parseNumeric(rawRecord.DETACHEDNC_11),

      // BRT Attached structure detail columns (ATTACHEDCODE_1-15, ATTACHEDAREA_1-15)
      attachedcode_1: this.preserveStringValue(rawRecord.ATTACHEDCODE_1),
      attachedarea_1: this.parseNumeric(rawRecord.ATTACHEDAREA_1),
      attachedcode_2: this.preserveStringValue(rawRecord.ATTACHEDCODE_2),
      attachedarea_2: this.parseNumeric(rawRecord.ATTACHEDAREA_2),
      attachedcode_3: this.preserveStringValue(rawRecord.ATTACHEDCODE_3),
      attachedarea_3: this.parseNumeric(rawRecord.ATTACHEDAREA_3),
      attachedcode_4: this.preserveStringValue(rawRecord.ATTACHEDCODE_4),
      attachedarea_4: this.parseNumeric(rawRecord.ATTACHEDAREA_4),
      attachedcode_5: this.preserveStringValue(rawRecord.ATTACHEDCODE_5),
      attachedarea_5: this.parseNumeric(rawRecord.ATTACHEDAREA_5),
      attachedcode_6: this.preserveStringValue(rawRecord.ATTACHEDCODE_6),
      attachedarea_6: this.parseNumeric(rawRecord.ATTACHEDAREA_6),
      attachedcode_7: this.preserveStringValue(rawRecord.ATTACHEDCODE_7),
      attachedarea_7: this.parseNumeric(rawRecord.ATTACHEDAREA_7),
      attachedcode_8: this.preserveStringValue(rawRecord.ATTACHEDCODE_8),
      attachedarea_8: this.parseNumeric(rawRecord.ATTACHEDAREA_8),
      attachedcode_9: this.preserveStringValue(rawRecord.ATTACHEDCODE_9),
      attachedarea_9: this.parseNumeric(rawRecord.ATTACHEDAREA_9),
      attachedcode_10: this.preserveStringValue(rawRecord.ATTACHEDCODE_10),
      attachedarea_10: this.parseNumeric(rawRecord.ATTACHEDAREA_10),
      attachedcode_11: this.preserveStringValue(rawRecord.ATTACHEDCODE_11),
      attachedarea_11: this.parseNumeric(rawRecord.ATTACHEDAREA_11),
      attachedcode_12: this.preserveStringValue(rawRecord.ATTACHEDCODE_12),
      attachedarea_12: this.parseNumeric(rawRecord.ATTACHEDAREA_12),
      attachedcode_13: this.preserveStringValue(rawRecord.ATTACHEDCODE_13),
      attachedarea_13: this.parseNumeric(rawRecord.ATTACHEDAREA_13),
      attachedcode_14: this.preserveStringValue(rawRecord.ATTACHEDCODE_14),
      attachedarea_14: this.parseNumeric(rawRecord.ATTACHEDAREA_14),
      attachedcode_15: this.preserveStringValue(rawRecord.ATTACHEDCODE_15),
      attachedarea_15: this.parseNumeric(rawRecord.ATTACHEDAREA_15),

      // BRT Miscellaneous items (MISC_1-5, MISCNUM_1-5)
      misc_1_brt: this.preserveStringValue(rawRecord.MISC_1),
      miscnum_1: this.parseNumeric(rawRecord.MISCNUM_1),
      misc_2_brt: this.preserveStringValue(rawRecord.MISC_2),
      miscnum_2: this.parseNumeric(rawRecord.MISCNUM_2),
      misc_3_brt: this.preserveStringValue(rawRecord.MISC_3),
      miscnum_3: this.parseNumeric(rawRecord.MISCNUM_3),
      misc_4_brt: this.preserveStringValue(rawRecord.MISC_4),
      miscnum_4: this.parseNumeric(rawRecord.MISCNUM_4),
      misc_5_brt: this.preserveStringValue(rawRecord.MISC_5),
      miscnum_5: this.parseNumeric(rawRecord.MISCNUM_5),

      // BRT Positive land adjustments (LANDFFCOND_1-6, LANDURCOND_1-6)
      landffcond_1: this.preserveStringValue(rawRecord.LANDFFCOND_1),
      landurcond_1: this.preserveStringValue(rawRecord.LANDURCOND_1),
      landffcond_2: this.preserveStringValue(rawRecord.LANDFFCOND_2),
      landurcond_2: this.preserveStringValue(rawRecord.LANDURCOND_2),
      landffcond_3: this.preserveStringValue(rawRecord.LANDFFCOND_3),
      landurcond_3: this.preserveStringValue(rawRecord.LANDURCOND_3),
      landffcond_4: this.preserveStringValue(rawRecord.LANDFFCOND_4),
      landurcond_4: this.preserveStringValue(rawRecord.LANDURCOND_4),
      landffcond_5: this.preserveStringValue(rawRecord.LANDFFCOND_5),
      landurcond_5: this.preserveStringValue(rawRecord.LANDURCOND_5),
      landffcond_6: this.preserveStringValue(rawRecord.LANDFFCOND_6),
      landurcond_6: this.preserveStringValue(rawRecord.LANDURCOND_6),

      // BRT Negative land adjustments (LANDFFINFL_1-6, LANDURINFL_1-6)
      landffinfl_1: this.preserveStringValue(rawRecord.LANDFFINFL_1),
      landurinfl_1: this.preserveStringValue(rawRecord.LANDURINFL_1),
      landffinfl_2: this.preserveStringValue(rawRecord.LANDFFINFL_2),
      landurinfl_2: this.preserveStringValue(rawRecord.LANDURINFL_2),
      landffinfl_3: this.preserveStringValue(rawRecord.LANDFFINFL_3),
      landurinfl_3: this.preserveStringValue(rawRecord.LANDURINFL_3),
      landffinfl_4: this.preserveStringValue(rawRecord.LANDFFINFL_4),
      landurinfl_4: this.preserveStringValue(rawRecord.LANDURINFL_4),
      landffinfl_5: this.preserveStringValue(rawRecord.LANDFFINFL_5),
      landurinfl_5: this.preserveStringValue(rawRecord.LANDURINFL_5),
      landffinfl_6: this.preserveStringValue(rawRecord.LANDFFINFL_6),
      landurinfl_6: this.preserveStringValue(rawRecord.LANDURINFL_6),

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
   * Calculate property class totals for AdminJobManagement
   * BRT property classes: 2=Residential, 3A=Residential, 4A/4B/4C=Commercial
   */
  calculatePropertyTotals(records) {
    let totalresidential = 0;
    let totalcommercial = 0;
    
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const propertyClass = record.PROPERTY_CLASS;
      
      if (propertyClass === '2' || propertyClass === '3A') {
        totalresidential++;
      } else if (propertyClass === '4A' || propertyClass === '4B' || propertyClass === '4C') {
        totalcommercial++;
      }
      // Other classes (1, 3B, 5A, 5B, etc.) not counted in either category
    }
    
    console.log(`📊 Property totals calculated: ${totalresidential} residential, ${totalcommercial} commercial`);
    return { totalresidential, totalcommercial };
  }

  /**
   * Update jobs table with property class totals (NOT total_properties)
   */
  async updateJobTotals(jobId, totalresidential, totalcommercial) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({
          totalresidential: totalresidential,
          totalcommercial: totalcommercial
          // NOTE: total_properties handled by AdminJobManagement/FileUploadButton
        })
        .eq('id', jobId);

      if (error) {
        console.error('❌ Failed to update job totals:', error);
        throw error;
      }

      console.log('✅ Job totals updated successfully in database');
      
    } catch (error) {
      console.error('❌ Error in updateJobTotals:', error);
      // Don't throw - continue processing even if update fails
    }
  }

  /**
   * Process complete file and store in database with enhanced code file integration
   * RESTORED: totalresidential and totalcommercial calculations (total_properties handled by AdminJobManagement/FileUploadButton)
   * CRITICAL: Added automatic cleanup for failed batches - prevents partial job creation!
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    // Track successful batches for cleanup
    const successfulBatches = [];
    const processingTimestamp = new Date().toISOString();
    
    try {
      console.log('🚀 Starting ENHANCED BRT file processing with CLEANUP support...');

      // CRITICAL FIX: Store source file content in jobs table
      await this.storeSourceFileInDatabase(sourceFileContent, jobId);

      // Process and store code file if provided
      if (codeFileContent) {
        await this.processCodeFile(codeFileContent, jobId);
      }

      // Load code configuration for categorizing items
      await this.loadCodeConfiguration(jobId);

      const records = this.parseSourceFile(sourceFileContent);
      
      // Calculate property totals BEFORE processing
      const { totalresidential, totalcommercial } = this.calculatePropertyTotals(records);
      
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
      
      console.log(`Batch inserting ${propertyRecords.length} property records...`);
      const batchSize = 250; // Optimized for stability and error resilience
      let consecutiveErrors = 0;
      
      for (let i = 0; i < propertyRecords.length; i += batchSize) {
        const batch = propertyRecords.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(propertyRecords.length / batchSize);
        
        console.log(`��� Processing batch ${batchNumber} of ${totalBatches}: records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        
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
      
      console.log('🚀 ENHANCED BRT PROCESSING COMPLETE WITH ALL SECTIONS:', results);
      return results;
      
    } catch (error) {
      console.error('Enhanced BRT file processing failed:', error);
      throw error;
    }
  }

  // Utility functions (same as before)
  calculateTotalBaths(rawRecord) {
    const bathTot = this.parseNumeric(rawRecord.BATHTOT) || 0;
    const twoFix = this.parseNumeric(rawRecord.PLUMBING2FIX) || 0;
    const adjustedTotal = bathTot - twoFix + (twoFix * 0.5);
    return adjustedTotal > 0 ? adjustedTotal : null;
  }

  /**
   * Extract fireplace count (sum of FIREPLACECNT_1 and FIREPLACECNT_2)
   */
  extractFireplaceCount(rawRecord) {
    const count1 = this.parseInteger(rawRecord.FIREPLACECNT_1) || 0;
    const count2 = this.parseInteger(rawRecord.FIREPLACECNT_2) || 0;
    const total = count1 + count2;
    return total > 0 ? total : null;
  }

  /**
   * Extract basement area from FLA_BSMNT
   */
  extractBasementArea(rawRecord) {
    return this.parseNumeric(rawRecord.FLA_BSMNT);
  }

  /**
   * Extract finished basement area
   * BSMNTFINISHAREA_1 and BSMNTFINISHAREA_2 can be:
   * - If < 1 (e.g., 0.9) = percentage of basement floor area
   * - If >= 1 = actual square footage
   */
  extractFinBasementArea(rawRecord) {
    const basementArea = this.parseNumeric(rawRecord.FLA_BSMNT) || 0;
    const finish1 = this.parseNumeric(rawRecord.BSMNTFINISHAREA_1) || 0;
    const finish2 = this.parseNumeric(rawRecord.BSMNTFINISHAREA_2) || 0;

    let totalFinished = 0;

    // Handle finish area 1
    if (finish1 > 0) {
      if (finish1 < 1) {
        // It's a percentage
        totalFinished += basementArea * finish1;
      } else {
        // It's actual SF
        totalFinished += finish1;
      }
    }

    // Handle finish area 2
    if (finish2 > 0) {
      if (finish2 < 1) {
        // It's a percentage
        totalFinished += basementArea * finish2;
      } else {
        // It's actual SF
        totalFinished += finish2;
      }
    }

    return totalFinished > 0 ? Math.round(totalFinished) : null;
  }

  /**
   * Extract area for attached items by keyword
   * Searches ATTACHEDCODE_1 through ATTACHEDCODE_15 for codes matching keyword
   * and sums corresponding ATTACHEDAREA_1 through ATTACHEDAREA_15
   */
  extractAttachedItemsAreaByKeyword(rawRecord, keywords) {
    let totalArea = 0;

    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;

      if (code && area > 0) {
        const codeUpper = code.toUpperCase();
        const matchesKeyword = keywords.some(keyword => codeUpper.includes(keyword));
        if (matchesKeyword) {
          totalArea += area;
        }
      }
    }

    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract area for detached items by keyword
   * Searches DETACHEDCODE_1 through DETACHEDCODE_11 for codes matching keyword
   * and sums corresponding DETACHEDDCSIZE_1 through DETACHEDDCSIZE_11
   */
  extractDetachedItemsAreaByKeyword(rawRecord, keywords) {
    let totalArea = 0;

    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;

      if (code && area > 0) {
        const codeUpper = code.toUpperCase();
        const matchesKeyword = keywords.some(keyword => codeUpper.includes(keyword));
        if (matchesKeyword) {
          totalArea += area;
        }
      }
    }

    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract AC area from ACAREA_1 and ACAREA_2
   */
  extractAcArea(rawRecord) {
    const area1 = this.parseNumeric(rawRecord.ACAREA_1) || 0;
    const area2 = this.parseNumeric(rawRecord.ACAREA_2) || 0;
    const total = area1 + area2;
    return total > 0 ? Math.round(total) : null;
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
    // 1. Try frontage × depth first
    const frontage = this.calculateLotFrontage(rawRecord);
    const depth = this.calculateLotDepth(rawRecord);
    if (frontage && depth) {
      const acres = (frontage * depth) / 43560;
      if (acres > 0) {
        return parseFloat(acres.toFixed(2));
      }
    }

    // NOTE: Removed LANDUR/LANDURUNITS parsing — asset_lot_acre should only be derived
    // from explicit lot dimensions (frontage × depth) or direct lot size fields.

    // 4. No usable data
    return null;
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

  /**
   * Helper to check if a raw code matches any configured codes
   * Handles both formats: "02" matches "2 - CONC PATIO" or just "2"
   */
  codeMatches(rawCode, configuredCodes) {
    if (!rawCode || !configuredCodes || configuredCodes.length === 0) {
      return false;
    }

    // Normalize raw code: remove leading zeros and trim
    const normalizedRaw = String(rawCode).replace(/^0+/, '') || '0';

    return configuredCodes.some(configCode => {
      if (!configCode) return false;

      // Extract just the code portion before " - " if it exists
      const codePart = String(configCode).split(' - ')[0].trim();

      // Normalize configured code: remove leading zeros
      const normalizedConfig = codePart.replace(/^0+/, '') || '0';

      return normalizedRaw === normalizedConfig;
    });
  }

  /**
   * Load code configuration from job_settings to categorize items
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
          'adjustment_codes_pole_barn',
          'adjustment_codes_garage',
          'adjustment_codes_deck',
          'adjustment_codes_patio',
          'adjustment_codes_open_porch',
          'adjustment_codes_enclosed_porch'
        ]);

      if (error) {
        console.log('⚠️ No code configuration found - items will use keyword fallback');
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
      console.log('✅ Loaded code configuration for BRT items:', this.codeConfig);
    } catch (error) {
      console.error('Error loading code configuration:', error);
      this.codeConfig = {};
    }
  }

  /**
   * Extract garage area from attached items using code configuration
   */
  extractGarageAreaFromConfig(rawRecord) {
    const garageCodes = this.codeConfig?.garage || [];
    if (garageCodes.length === 0) {
      return this.extractAttachedItemsAreaByKeyword(rawRecord, ['GAR']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, garageCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract deck area from attached items using code configuration
   */
  extractDeckAreaFromConfig(rawRecord) {
    const deckCodes = this.codeConfig?.deck || [];
    if (deckCodes.length === 0) {
      return this.extractAttachedItemsAreaByKeyword(rawRecord, ['DECK']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, deckCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract patio area from attached items using code configuration
   */
  extractPatioAreaFromConfig(rawRecord) {
    const patioCodes = this.codeConfig?.patio || [];
    if (patioCodes.length === 0) {
      return this.extractAttachedItemsAreaByKeyword(rawRecord, ['PATIO']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, patioCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract open porch area from attached items using code configuration
   */
  extractOpenPorchAreaFromConfig(rawRecord) {
    const openPorchCodes = this.codeConfig?.open_porch || [];
    if (openPorchCodes.length === 0) {
      return this.extractAttachedItemsAreaByKeyword(rawRecord, ['OPEN']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, openPorchCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract enclosed porch area from attached items using code configuration
   */
  extractEnclosedPorchAreaFromConfig(rawRecord) {
    const enclosedPorchCodes = this.codeConfig?.enclosed_porch || [];
    if (enclosedPorchCodes.length === 0) {
      return this.extractAttachedItemsAreaByKeyword(rawRecord, ['ENCL', 'SCREEN', 'SCRN']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 15; i++) {
      const code = this.preserveStringValue(rawRecord[`ATTACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`ATTACHEDAREA_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, enclosedPorchCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract detached garage area from detached items using code configuration
   */
  extractDetGarageAreaFromConfig(rawRecord) {
    const detGarageCodes = this.codeConfig?.det_garage || [];
    if (detGarageCodes.length === 0) {
      return this.extractDetachedItemsAreaByKeyword(rawRecord, ['GAR']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, detGarageCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract pool area from detached items using code configuration
   */
  extractPoolAreaFromConfig(rawRecord) {
    const poolCodes = this.codeConfig?.pool || [];
    if (poolCodes.length === 0) {
      return this.extractDetachedItemsAreaByKeyword(rawRecord, ['POOL']);
    }

    let totalArea = 0;
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, poolCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract barn area from detached items using code configuration
   */
  extractBarnAreaFromConfig(rawRecord) {
    const barnCodes = this.codeConfig?.barn || [];
    if (barnCodes.length === 0) return null;

    let totalArea = 0;
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, barnCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract stable area from detached items using code configuration
   */
  extractStableAreaFromConfig(rawRecord) {
    const stableCodes = this.codeConfig?.stable || [];
    if (stableCodes.length === 0) return null;

    let totalArea = 0;
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, stableCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract pole barn area from detached items using code configuration
   */
  extractPoleBarnAreaFromConfig(rawRecord) {
    const poleBarnCodes = this.codeConfig?.pole_barn || [];
    if (poleBarnCodes.length === 0) return null;

    let totalArea = 0;
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      const area = this.parseNumeric(rawRecord[`DETACHEDDCSIZE_${i}`]) || 0;
      if (code && area > 0 && this.codeMatches(code, poleBarnCodes)) {
        totalArea += area;
      }
    }
    return totalArea > 0 ? Math.round(totalArea) : null;
  }

  /**
   * Extract miscellaneous codes from detached items
   */
  extractMiscellaneousFromConfig(rawRecord) {
    const miscCodes = this.codeConfig?.miscellaneous || [];
    if (miscCodes.length === 0) return null;

    const foundCodes = [];
    for (let i = 1; i <= 11; i++) {
      const code = this.preserveStringValue(rawRecord[`DETACHEDCODE_${i}`]);
      if (code && this.codeMatches(code, miscCodes)) {
        // Normalize code (remove leading zeros)
        const normalized = String(code).replace(/^0+/, '') || '0';
        if (!foundCodes.includes(normalized)) {
          foundCodes.push(normalized);
        }
      }
    }
    return foundCodes.length > 0 ? foundCodes.join(',') : null;
  }

}

export const brtProcessor = new BRTProcessor();
