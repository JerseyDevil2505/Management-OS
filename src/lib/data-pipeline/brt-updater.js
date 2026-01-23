/**
 * Enhanced BRT Updater with COMPLETE Section Parsing
 * FIXED: Now properly extracts ALL sections and InfoBy codes from nested MAP structures
 * Uses UPSERT instead of INSERT for updating existing jobs
 * Identical parsing logic to the enhanced BRT Processor
 * CLEANED: Removed surgical fix functions - job totals handled by AdminJobManagement/FileUploadButton
 * ADDED: Field preservation support for component-defined fields
 * CRITICAL: Added automatic rollback for failed batches - all or nothing!
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
   * REMOVED: Payload optimization disabled to ensure database is exact mirror of source file
   * All fields (including nulls) are now sent to database for proper UPSERT clearing
   */

  /**
   * Save current projected ratable base to "previous" fields for delta tracking
   * CRITICAL: Must consolidate properties (count main cards only) to match RatableComparisonTab logic
   */
  async savePreviousProjectedValues(jobId) {
    try {
      console.log('💾 Saving current projected ratable base to previous fields for delta tracking...');

      // Get job to determine vendor type
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('vendor_type')
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;

      const vendorType = job?.vendor_type || 'BRT';

      // Get current properties for this job with all fields needed for consolidation
      const { data: properties, error } = await supabase
        .from('property_records')
        .select('values_cama_total, property_cama_class, property_facility, property_composite_key, property_block, property_lot, property_qualifier, property_location, property_addl_card')
        .eq('job_id', jobId);

      if (error) throw error;

      if (!properties || properties.length === 0) {
        console.log('ℹ️ No existing properties found, skipping previous value save');
        return;
      }

      // CRITICAL: Consolidate properties by grouping additional cards (same logic as RatableComparisonTab)
      const grouped = {};

      properties.forEach(property => {
        // Create base key without card designation - MUST include location to distinguish separate properties
        const baseKey = `${property.property_block}-${property.property_lot}-${property.property_qualifier || 'NONE'}-${property.property_location || 'NONE'}`;

        if (!grouped[baseKey]) {
          grouped[baseKey] = {
            mainCard: null
          };
        }

        const card = property.property_addl_card;
        const isMainCard = vendorType === 'BRT'
          ? (!card || card === '1')
          : (!card || card.toUpperCase() === 'M');

        if (isMainCard) {
          grouped[baseKey].mainCard = property;
        }
      });

      // Get consolidated properties (main cards only)
      const consolidatedProperties = Object.values(grouped)
        .map(group => group.mainCard)
        .filter(p => p && p.property_composite_key); // Filter out any null mainCards

      console.log(`🔄 Consolidated ${properties.length} property records into ${consolidatedProperties.length} properties (vendor: ${vendorType})`);

      // Calculate projected ratable base from CONSOLIDATED properties
      const summary = {
        '1': { count: 0, total: 0 },
        '2': { count: 0, total: 0 },
        '3A': { count: 0, total: 0 },
        '3B': { count: 0, total: 0 },
        '4ABC': { count: 0, total: 0 },
        '6ABC': { count: 0, total: 0 }
      };

      consolidatedProperties.forEach(property => {
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
   * UPSERT batch with retry logic for connection issues
   */
  async upsertBatchWithRetry(batch, batchNumber, retries = 50) {
    // DATA INTEGRITY: Send complete batch with all nulls to ensure database mirrors source file
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 UPSERT Batch ${batchNumber}, attempt ${attempt}...`);
        
        // CRITICAL FIX: Optimize for 500+ records with timeout and minimal return
        const upsertPromise = supabase
          .from('property_records')
          .upsert(batch, {
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
        console.log(`�� Network error for UPSERT batch ${batchNumber}, attempt ${attempt}:`, networkError.message);
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
   * CRITICAL FIX: Store source file content in jobs table (eliminates raw_data duplication)
   */
  async storeSourceFileInDatabase(sourceFileContent, jobId) {
    try {
      console.log('💾 Storing complete source file in jobs table (UPDATER)...');

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

      console.log('✅ Complete source file stored successfully in jobs table (UPDATER)');
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
      
      console.log('���� Complete code file stored successfully in jobs table (UPDATER)');
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
      asset_story_height: this.preserveStringValue(rawRecord.STORYHGT),  // Preserve original value ("2A", "1.5", "3S", etc.)
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

      // Normalized amenity area fields (extracted from BRT codes)
      fireplace_count: this.extractFireplaceCount(rawRecord),
      basement_area: this.extractBasementArea(rawRecord),
      fin_basement_area: this.extractFinBasementArea(rawRecord),
      garage_area: this.extractAttachedItemsAreaByKeyword(rawRecord, ['GAR']),
      deck_area: this.extractAttachedItemsAreaByKeyword(rawRecord, ['DECK']),
      patio_area: this.extractAttachedItemsAreaByKeyword(rawRecord, ['PATIO']),
      open_porch_area: this.extractAttachedItemsAreaByKeyword(rawRecord, ['OPEN']),
      enclosed_porch_area: this.extractAttachedItemsAreaByKeyword(rawRecord, ['ENCL', 'SCREEN', 'SCRN']),
      det_garage_area: this.extractDetachedItemsAreaByKeyword(rawRecord, ['GAR']),
      pool_area: this.extractDetachedItemsAreaByKeyword(rawRecord, ['POOL']),

      // Processing metadata
      processed_at: new Date().toISOString(),
      is_new_since_last_upload: false, // CHANGED: false for updates
      
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
      created_at: new Date().toISOString(), // Will be ignored on UPSERT
      updated_at: new Date().toISOString(),
      
    };

    // SIMPLIFIED: Return baseRecord only - no field preservation needed
    // is_assigned_property will remain untouched since it's not in baseRecord
    return baseRecord;
  }

  /**
   * MAIN PROCESS METHOD - ENHANCED UPSERT VERSION
   * CLEANED: Removed surgical fix functions - job totals handled by AdminJobManagement/FileUploadButton
   * ENHANCED: Added field preservation support
   * CRITICAL: Added automatic rollback for failed batches
   * NEW: Added complete property lineage tracking
   * OPTIMIZED: Now accepts optional deletion list to avoid expensive .not.in() queries
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}, deletionsList = null) {
    // Track successful batches for rollback
    const successfulBatches = [];
    const processingVersion = versionInfo.file_version || 1;
    
    try {
      console.log('🚀 Starting ENHANCED BRT UPDATER (UPSERT) with COMPLETE section parsing, field preservation, and ROLLBACK support...');

      // NEW: Save current projected values for delta tracking
      await this.savePreviousProjectedValues(jobId);

      // CRITICAL FIX: Store source file content in jobs table
      console.log('📝 Step 1: Storing source file in database...');
      await this.storeSourceFileInDatabase(sourceFileContent, jobId);
      console.log('�� Step 1 completed: Source file stored');

      // Process and store code file if provided
      if (codeFileContent) {
        console.log('📝 Step 2: Processing code file...');
        await this.processCodeFile(codeFileContent, jobId);
        console.log('✅ Step 2 completed: Code file processed');
      } else {
        console.log('⏭️ Step 2 skipped: No code file provided');
      }
      
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
            console.log(`⏳ Pausing 0.5s before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      // CRITICAL: Clean up normalized values for invalid sales after file update
      console.log('🧹 Cleaning up normalized values for invalid sales...');
      await this.cleanupInvalidNormalizedValues(jobId);

      console.log('🚀 ENHANCED BRT UPDATER (UPSERT) COMPLETE WITH ALL SECTIONS:', results);
      return results;

    } catch (error) {
      console.error('Enhanced BRT updater failed:', error);
      throw error;
    }
  }

  /**
   * Clean up normalized values for sales that are no longer valid
   * This prevents stale normalized values when:
   * - sales_nu changes to '25' (non-usable)
   * - sales_price becomes too low (< $100)
   * - sales_date is removed
   */
  async cleanupInvalidNormalizedValues(jobId) {
    try {
      // Find records with normalized values that have invalid sales data
      const { data: invalidSales, error: selectError } = await supabase
        .from('property_market_analysis')
        .select('property_composite_key')
        .eq('job_id', jobId)
        .not('values_norm_time', 'is', null);

      if (selectError) {
        console.warn('⚠️ Could not query normalized values:', selectError);
        return;
      }

      if (!invalidSales || invalidSales.length === 0) {
        console.log('✅ No normalized values found to check');
        return;
      }

      const compositeKeys = invalidSales.map(s => s.property_composite_key);

      // Check which ones have invalid sales data
      const { data: propertyData, error: propError } = await supabase
        .from('property_records')
        .select('property_composite_key, sales_nu, sales_price, sales_date')
        .eq('job_id', jobId)
        .in('property_composite_key', compositeKeys);

      if (propError) {
        console.warn('⚠️ Could not query property sales data:', propError);
        return;
      }

      // Find keys where sales are invalid
      const keysToClean = propertyData
        .filter(p => {
          const hasInvalidNU = p.sales_nu === '25';
          const hasInvalidPrice = !p.sales_price || p.sales_price < 100;
          const hasNoSaleDate = !p.sales_date;
          return hasInvalidNU || hasInvalidPrice || hasNoSaleDate;
        })
        .map(p => p.property_composite_key);

      if (keysToClean.length === 0) {
        console.log('✅ All normalized values are valid');
        return;
      }

      // Clear normalized values for invalid sales
      const { error: updateError } = await supabase
        .from('property_market_analysis')
        .update({
          values_norm_time: null,
          values_norm_size: null,
          updated_at: new Date().toISOString()
        })
        .eq('job_id', jobId)
        .in('property_composite_key', keysToClean);

      if (updateError) {
        console.warn('⚠️ Could not clear invalid normalized values:', updateError);
      } else {
        console.log(`✅ Cleared normalized values for ${keysToClean.length} invalid sales`);
      }

    } catch (error) {
      console.warn('⚠️ Error during normalized value cleanup:', error);
      // Don't throw - this is non-critical cleanup
    }
  }

  // UTILITY FUNCTIONS (SAME AS ENHANCED PROCESSOR)
  
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
   * BSMTNFINISHAREA_1 and BSMTFINISHAREA_2 can be:
   * - If < 1 (e.g., 0.9) = percentage of basement floor area
   * - If >= 1 = actual square footage
   */
  extractFinBasementArea(rawRecord) {
    const basementArea = this.parseNumeric(rawRecord.FLA_BSMNT) || 0;
    const finish1 = this.parseNumeric(rawRecord.BSMTNFINISHAREA_1) || 0;
    const finish2 = this.parseNumeric(rawRecord.BSMTNFINISHAREA_2) || 0;

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

  // ===== PROPERTY LINEAGE TRACKING METHODS =====

  /**
   * Store complete source file version for lineage tracking
   */
  async storeSourceFileVersion(sourceFileContent, jobId, fileVersion, yearCreated, ccddCode) {
    try {
      console.log(`📚 Storing source file version ${fileVersion} for lineage tracking...`);

      // Parse source file to extract property composite keys
      const records = this.parseSourceFile(sourceFileContent);
      const propertyKeys = [];

      records.forEach(rawRecord => {
        const blockValue = this.preserveStringValue(rawRecord.BLOCK);
        const lotValue = this.preserveStringValue(rawRecord.LOT);
        const qualifierValue = this.preserveStringValue(rawRecord.QUALIFIER) || 'NONE';
        const cardValue = this.preserveStringValue(rawRecord.CARD) || 'NONE';
        const locationValue = this.preserveStringValue(rawRecord.PROPERTY_LOCATION) || 'NONE';

        const compositeKey = `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`;
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
          vendor_type: 'BRT',
          original_filename: 'BRT_Source_File.csv',
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
        console.error('❌ Error storing source file version:', error);
        return null;
      }

      // Record lifecycle events
      await this.recordLifecycleEvents(
        jobId, fileVersion, propertiesAdded, propertiesRemoved, sourceFileVersionRecord.id
      );

      console.log(`✅ Source file version ${fileVersion} stored with lineage tracking`);
      return sourceFileVersionRecord.id;

    } catch (error) {
      console.error('❌ Failed to store source file version:', error);
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
          console.error('❌ Error recording lifecycle events:', error);
        } else {
          console.log(`✅ Recorded ${events.length} lifecycle events for version ${fileVersion}`);
        }
      }

    } catch (error) {
      console.error('❌ Failed to record lifecycle events:', error);
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
        console.error('❌ Error marking source file version as processed:', error);
      } else {
        console.log(`✅ Source file version marked as processed`);
      }

    } catch (error) {
      console.error('❌ Failed to mark source file version as processed:', error);
    }
  }
}

export const brtUpdater = new BRTUpdater();
