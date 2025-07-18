/**
 * Complete BRT Processor 
 * Handles CSV source files and mixed-format code files
 * Stores direct mappings in property_records and raw data in property_analysis_data
 */

import { supabase } from '../supabaseClient.js';

export class BRTProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.headers = [];
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
   * Process BRT code file (mixed format with headers and JSON sections)
   */
  processCodeFile(codeFileContent) {
    console.log('Processing BRT code file...');
    
    try {
      const lines = codeFileContent.split('\n');
      let currentSection = null;
      let jsonBuffer = '';
      let inJsonBlock = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) continue;
        
        if (!line.startsWith('{') && !line.startsWith('"') && !inJsonBlock) {
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
      
      if (jsonBuffer && currentSection) {
        this.parseJsonSection(jsonBuffer, currentSection);
      }
      
      console.log(`Loaded ${this.codeLookups.size} code definitions from BRT file`);
      
    } catch (error) {
      console.error('Error parsing BRT code file:', error);
    }
  }
  
  /**
   * Parse a JSON section and store lookups
   */
  parseJsonSection(jsonString, sectionName) {
    try {
      const codeData = JSON.parse(jsonString);
      
      if (sectionName === 'VCS') {
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            this.vcsLookups.set(key, item.DATA.VALUE);
          }
        });
        console.log(`Loaded ${Object.keys(codeData).length} VCS codes`);
      } else {
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            const lookupKey = `${sectionName}_${key}`;
            this.codeLookups.set(lookupKey, item.DATA.VALUE);
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
   * This is the MISSING method that was causing the error!
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
   * Map BRT record to property_records table fields
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo = {}) {
    return {
      job_id: jobId,
      
      property_block: rawRecord.BLOCK,
      property_lot: rawRecord.LOT,
      property_qualifier: rawRecord.QUALIFIER,
      property_addl_card: rawRecord.CARD,
      property_location: rawRecord.PROPERTY_LOCATION,
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord.BLOCK}-${rawRecord.LOT}_${rawRecord.QUALIFIER || 'NONE'}-${rawRecord.CARD || 'NONE'}-${rawRecord.PROPERTY_LOCATION || 'NONE'}`,
      
      owner_name: rawRecord.OWNER_OWNER,
      owner_street: rawRecord.OWNER_ADDRESS,
      owner_csz: this.calculateOwnerCsZ(rawRecord),
      
      sales_date: this.parseDate(rawRecord.CURRENTSALE_DATE),
      sales_price: this.parseNumeric(rawRecord.CURRENTSALE_PRICE),
      sales_book: rawRecord.CURRENTSALE_DEEDBOOK,
      sales_page: rawRecord.CURRENTSALE_DEEDPAGE,
      sales_nu: rawRecord.CURRENTSALE_NUC,
      
      values_mod_land: this.parseNumeric(rawRecord.VALUES_LANDTAXABLEVALUE),
      values_cama_land: this.parseNumeric(rawRecord.TOTALLANDVALUE),
      values_mod_improvement: this.parseNumeric(rawRecord.VALUES_IMPROVTAXABLEVALUE),
      values_cama_improvement: this.parseNumeric(rawRecord.TOTALIMPROVVALUE),
      values_mod_total: this.parseNumeric(rawRecord.VALUES_NETTAXABLEVALUE),
      values_cama_total: this.parseNumeric(rawRecord.TOTNETVALUE),
      
      values_base_cost: this.parseNumeric(rawRecord.BASEREPLCOST),
      values_det_items: this.parseNumeric(rawRecord.DETACHEDITEMS),
      values_repl_cost: this.parseNumeric(rawRecord.REPLCOSTNEW),
      
      inspection_info_by: this.parseInteger(rawRecord.INFOBY),
      inspection_list_by: rawRecord.LISTBY,
      inspection_list_date: this.parseDate(rawRecord.LISTDT),
      inspection_measure_by: rawRecord.MEASUREBY,
      inspection_measure_date: this.parseDate(rawRecord.MEASUREDT),
      inspection_price_by: rawRecord.PRICEBY,
      inspection_price_date: this.parseDate(rawRecord.PRICEDT),
      
      property_cama_class: rawRecord.PROPCLASS,
      property_m4_class: rawRecord.PROPERTY_CLASS,
      property_facility: rawRecord.EXEMPT_FACILITYNAME,
      
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      
      vendor_source: 'BRT',
      processed_at: new Date().toISOString(),
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      
      raw_data: rawRecord
    };
  }

  /**
   * Map to property_analysis_data for calculated fields and raw storage
   */
  mapToAnalysisDataSync(rawRecord, propertyRecordId, jobId, versionInfo = {}) {
    return {
      property_record_id: propertyRecordId,
      
      property_block: rawRecord.BLOCK,
      property_lot: rawRecord.LOT,
      property_qualifier: rawRecord.QUALIFIER,
      property_addl_card: rawRecord.CARD,
      property_location: rawRecord.PROPERTY_LOCATION,
      
      total_baths_calculated: this.calculateTotalBaths(rawRecord),
      
      asset_sfla: this.parseNumeric(rawRecord.SFLA_TOTAL),
      asset_new_vcs: null,
      asset_key_page: null,
      asset_map_page: null,
      asset_zoning: null,
      asset_view: null,
      asset_neighborhood: rawRecord.NBHD,
      asset_type_use: rawRecord.TYPEUSE,
      asset_building_class: rawRecord.BLDGCLASS,
      asset_design_style: rawRecord.DESIGN,
      asset_year_built: this.parseInteger(rawRecord.YEARBUILT),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_acre: this.calculateLotAcres(rawRecord),
      asset_lot_sf: this.calculateLotSquareFeet(rawRecord),
      asset_story_height: this.parseNumeric(rawRecord.STORYHGT),
      asset_ext_cond: rawRecord.EXTERIORNC,
      asset_int_cond: rawRecord.INTERIORNC,
      
      values_norm_time: null,
      values_norm_size: null,
      
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      
      raw_data: rawRecord,
      
      calculated_at: new Date().toISOString(),
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad'
    };
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
   * Calculate lot size in acres using LANDUR_1 through LANDUR_6 codes
   */
  calculateLotAcres(rawRecord) {
    let totalAcres = 0;
    
    for (let i = 1; i <= 6; i++) {
      const urCode = rawRecord[`LANDUR_${i}`];
      const urValue = this.parseNumeric(rawRecord[`LANDUR_${i}`]);
      
      if (urCode && urCode.includes('AC') && urValue) {
        totalAcres += urValue;
      }
    }
    
    if (totalAcres === 0) {
      let totalSqFt = 0;
      
      for (let i = 1; i <= 6; i++) {
        const urCode = rawRecord[`LANDUR_${i}`];
        const urValue = this.parseNumeric(rawRecord[`LANDUR_${i}`]);
        
        if (urCode && urCode.includes('SF') && urValue) {
          totalSqFt += urValue;
        }
      }
      
      if (totalSqFt > 0) {
        totalAcres = totalSqFt / 43560;
      }
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
   * Process complete file and store in database using batch processing
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting BRT file processing...');
      
      if (codeFileContent) {
        this.processCodeFile(codeFileContent);
      }
      
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in batches...`);
      
      const propertyRecords = [];
      const analysisRecords = [];
      
      for (const rawRecord of records) {
        try {
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo);
          propertyRecords.push(propertyRecord);
          
          const analysisData = this.mapToAnalysisDataSync(rawRecord, null, jobId, versionInfo);
          analysisData.property_composite_key = propertyRecord.property_composite_key;
          analysisRecords.push(analysisData);
          
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
          console.log(`✅ Inserted property records ${i + 1} to ${Math.min(i + batchSize, propertyRecords.length)}`);
        }
      }
      
      console.log(`Batch inserting ${analysisRecords.length} analysis records...`);
      
      for (let i = 0; i < analysisRecords.length; i += batchSize) {
        const batch = analysisRecords.slice(i, i + batchSize);
        
        const { error: analysisError } = await supabase
          .from('property_analysis_data')
          .insert(batch);
        
        if (analysisError) {
          console.error('Batch analysis insert error:', analysisError);
          results.warnings.push(`Analysis batch ${i} to ${i + batchSize} failed`);
        } else {
          console.log(`✅ Inserted analysis records ${i + 1} to ${Math.min(i + batchSize, analysisRecords.length)}`);
        }
      }
      
      console.log('🚀 BRT BATCH PROCESSING COMPLETE:', results);
      return results;
      
    } catch (error) {
      console.error('BRT file processing failed:', error);
      throw error;
    }
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
    return this.codeLookups.get(code) || code;
  }
}

export const brtProcessor = new BRTProcessor();
