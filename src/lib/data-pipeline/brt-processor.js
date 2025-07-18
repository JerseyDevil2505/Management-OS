/**
 * Simplified BRT Processor 
 * Handles CSV source files and nested JSON code files
 * Stores direct mappings in property_records and raw data in property_analysis_data
 * Follows Microsystems processor interface for vendor-agnostic consumption
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
    const bathTot = this.parseNumeric(rawRecord.BATHTOT) || 0;      // Full baths (but counts half as full)
    const twoFix = this.parseNumeric(rawRecord.PLUMBING2FIX) || 0;  // Half baths (2-fixture)
    
    // Subtract half baths counted as full, then add them back as 0.5 weight
    const adjustedTotal = bathTot - twoFix + (twoFix * 0.5);
    
    return adjustedTotal > 0 ? adjustedTotal : null;
  }

  /**
   * Auto-detect if file is BRT format
   */
  detectFileType(fileContent) {
    const firstLine = fileContent.split('\n')[0];
    const headers = firstLine.split('\t'); // BRT uses tab-delimited
    
    // Check for BRT signature headers
    return headers.includes('BLOCK') && 
           headers.includes('LOT') && 
           headers.includes('QUALIFIER') &&
           headers.includes('BATHTOT');
  }

  /**
   * Process BRT code file (mixed format with headers and JSON sections)
   * Example structure: 
   * Residential
   * {"1":{"KEY":"01","DATA":{"VALUE":"GROUND FLR"}}}
   * VCS
   * {"AC":{"KEY":"AC","DATA":{"VALUE":"ACRES"}}}
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
        
        // Skip empty lines
        if (!line) continue;
        
        // Check if this is a section header (not JSON)
        if (!line.startsWith('{') && !line.startsWith('"') && !inJsonBlock) {
          // Process any accumulated JSON from previous section
          if (jsonBuffer && currentSection) {
            this.parseJsonSection(jsonBuffer, currentSection);
          }
          
          // Start new section
          currentSection = line;
          jsonBuffer = '';
          inJsonBlock = false;
          console.log(`Found section: ${currentSection}`);
          continue;
        }
        
        // Accumulate JSON lines
        if (line.startsWith('{') || inJsonBlock) {
          inJsonBlock = true;
          jsonBuffer += line;
          
          // Check if JSON block is complete (simple bracket counting)
          const openBrackets = (jsonBuffer.match(/\{/g) || []).length;
          const closeBrackets = (jsonBuffer.match(/\}/g) || []).length;
          
          if (openBrackets === closeBrackets && openBrackets > 0) {
            // JSON block complete, process it
            if (currentSection) {
              this.parseJsonSection(jsonBuffer, currentSection);
            }
            jsonBuffer = '';
            inJsonBlock = false;
          }
        }
      }
      
      // Process any remaining JSON
      if (jsonBuffer && currentSection) {
        this.parseJsonSection(jsonBuffer, currentSection);
      }
      
      console.log(`Loaded ${this.codeLookups.size} code definitions from BRT file`);
      
    } catch (error) {
      console.error('Error parsing BRT code file:', error);
      // Continue processing without codes if file is malformed
    }
  }
  
  /**
   * Parse a JSON section and store lookups
   */
  parseJsonSection(jsonString, sectionName) {
    try {
      const codeData = JSON.parse(jsonString);
      
      // Store section-specific lookups
      if (sectionName === 'VCS') {
        // Store VCS data separately for lot calculations
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            this.vcsLookups.set(key, item.DATA.VALUE);
          }
        });
        console.log(`Loaded ${Object.keys(codeData).length} VCS codes`);
      } else {
        // Store other sections in main codeLookups
        Object.keys(codeData).forEach(key => {
          const item = codeData[key];
          if (item.DATA && item.DATA.VALUE) {
            // Prefix with section name for uniqueness
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
   * Parse CSV BRT file (COMMA-delimited, not tab-delimited!)
   * FIXED: BRT uses standard CSV format, not tab-delimited
   */
  parseSourceFile(fileContent) {
    console.log('Parsing BRT source file...');
    
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('File must have at least header and one data row');
    }
    
    // Parse headers - BRT uses COMMA-delimited (standard CSV)
    this.headers = lines[0].split(',');
    
    console.log(`Found ${this.headers.length} headers`);
    console.log('Headers:', this.headers.slice(0, 10)); // Show first 10 headers for debugging
    
    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      
      if (values.length !== this.headers.length) {
        console.warn(`Row ${i} has ${values.length} values but ${this.headers.length} headers - skipping`);
        continue;
      }
      
      // Create record object
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
   * UPDATED: Added versionInfo parameter for proper version tracking
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
      property_location: rawRecord.PROPERTY_LOCATION,
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord.BLOCK}-${rawRecord.LOT}_${rawRecord.QUALIFIER || 'NONE'}-${rawRecord.CARD || 'NONE'}-${rawRecord.PROPERTY_LOCATION || 'NONE'}`,
      
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
      
      // Values - direct mappings from BRT
      values_mod_land: this.parseNumeric(rawRecord.VALUES_LANDTAXABLEVALUE),
      values_cama_land: this.parseNumeric(rawRecord.TOTALLANDVALUE),
      values_mod_improvement: this.parseNumeric(rawRecord.VALUES_IMPROVTAXABLEVALUE),
      values_cama_improvement: this.parseNumeric(rawRecord.TOTALIMPROVVALUE),
      values_mod_total: this.parseNumeric(rawRecord.VALUES_NETTAXABLEVALUE),
      values_cama_total: this.parseNumeric(rawRecord.TOTNETVALUE),
      
      // Values - calculated fields
      values_base_cost: this.parseNumeric(rawRecord.BASEREPLCOST),
      values_det_items: this.parseNumeric(rawRecord.DETACHEDITEMS),
      values_repl_cost: this.parseNumeric(rawRecord.REPLCOSTNEW),
      
      // Inspection fields
      inspection_info_by: this.parseInteger(rawRecord.INFOBY),
      inspection_list_by: rawRecord.LISTBY,
      inspection_list_date: this.parseDate(rawRecord.LISTDT),
      inspection_measure_by: rawRecord.MEASUREBY,
      inspection_measure_date: this.parseDate(rawRecord.MEASUREDT),
      inspection_price_by: rawRecord.PRICEBY,
      inspection_price_date: this.parseDate(rawRecord.PRICEDT),
      
      // Property classifications - FIXED: Use property_m4_class instead of property_mod_class
      property_cama_class: rawRecord.PROPCLASS,
      property_m4_class: rawRecord.PROPERTY_CLASS, // FIXED: Now matches schema
      property_facility: rawRecord.EXEMPT_FACILITYNAME,
      
      // ADD VERSION TRACKING FIELDS:
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      
      // Metadata
      vendor_source: 'BRT',
      processed_at: new Date().toISOString(),
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * Map to property_analysis_data for calculated fields and raw storage (SYNC VERSION)
   * UPDATED: Made sync and added versionInfo parameter for consistency
   */
  mapToAnalysisDataSync(rawRecord, propertyRecordId, jobId, versionInfo = {}) {
    return {
      // Link to property record
      property_record_id: propertyRecordId,
      
      // Property identifiers (duplicated for easy querying)
      property_block: rawRecord.BLOCK,
      property_lot: rawRecord.LOT,
      property_qualifier: rawRecord.QUALIFIER,
      property_addl_card: rawRecord.CARD,
      property_location: rawRecord.PROPERTY_LOCATION,
      // composite key set in processFile method
      
      // Essential calculated fields only
      total_baths_calculated: this.calculateTotalBaths(rawRecord), // Proper weighted calculation
      
      // Asset fields - direct mappings from BRT
      asset_sfla: this.parseNumeric(rawRecord.SFLA_TOTAL),
      asset_new_vcs: null, // User defined, created in module
      asset_key_page: null, // User defined, created in module
      asset_map_page: null, // User defined, created in module
      asset_zoning: null, // User defined, created in module
      asset_view: null, // Not available in BRT
      asset_neighborhood: rawRecord.NBHD,
      asset_type_use: rawRecord.TYPEUSE,
      asset_building_class: rawRecord.BLDGCLASS,
      asset_design_style: rawRecord.DESIGN,
      asset_year_built: this.parseInteger(rawRecord.YEARBUILT),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord), // Sum LANDFF_1-6
      asset_lot_depth: this.calculateLotDepth(rawRecord), // Average LANDAVGDEP_1-6
      asset_lot_acre: this.calculateLotAcres(rawRecord), // Keep your working VCS method
      asset_lot_sf: this.calculateLotSquareFeet(rawRecord), // Keep your working VCS method
      asset_story_height: this.parseNumeric(rawRecord.STORYHGT),
      asset_ext_cond: rawRecord.EXTERIORNC,
      asset_int_cond: rawRecord.INTERIORNC,
      
      // Normalized values - calculated later to avoid async issues
      values_norm_time: null, // TODO: Calculate later to avoid async in batch processing
      values_norm_size: null, // Size normalization - calculated later in development
      
      // ADD VERSION TRACKING FIELDS:
      source_file_name: versionInfo.source_file_name || null,
      source_file_version_id: versionInfo.source_file_version_id || null,
      source_file_uploaded_at: versionInfo.source_file_uploaded_at || new Date().toISOString(),
      
      // Store complete raw data as JSON for dynamic querying
      raw_data: rawRecord,
      
      // Metadata
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
   * Calculate lot frontage - sum of LANDFF_1 through LANDFF_6 (BRT's 6 fields vs Microsystems' 3)
   */
  calculateLotFrontage(rawRecord) {
    let totalFrontage = 0;
    let hasValues = false;
    
    // BRT has 6 front footage fields
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
    
    // BRT has 6 depth fields
    for (let i = 1; i <= 6; i++) {
      const avgDepth = this.parseNumeric(rawRecord[`LANDAVGDEP_${i}`]);
      if (avgDepth) depths.push(avgDepth);
    }
    
    if (depths.length === 0) return null;
    
    const average = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    return parseFloat(average.toFixed(2)); // Round to 2 decimal places
  }

  /**
   * Calculate lot size in acres using LANDUR_1 through LANDUR_6 codes
   * Look for "AC" codes first, fallback to "SF" codes if no acres found
   */
  calculateLotAcres(rawRecord) {
    let totalAcres = 0;
    
    // First, look for acre codes in LANDUR_1 through LANDUR_6
    for (let i = 1; i <= 6; i++) {
      const urCode = rawRecord[`LANDUR_${i}`];
      const urValue = this.parseNumeric(rawRecord[`LANDUR_${i}`]);
      
      if (urCode && urCode.includes('AC') && urValue) {
        totalAcres += urValue;
      }
    }
    
    // If no acres found, try square feet codes
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
        totalAcres = totalSqFt / 43560; // Convert sqft to acres
      }
    }
    
    return totalAcres > 0 ? parseFloat(totalAcres.toFixed(3)) : null;
  }

  /**
   * Calculate lot size in square feet using mathematical relationship with acres
   */
  calculateLotSquareFeet(rawRecord) {
    const acres = this.calculateLotAcres(rawRecord);
    return acres ? Math.round(acres * 43560) : null;
  }

  /**
   * Calculate time-adjusted sale value using FRED HPI data (copied from Microsystems)
   */
  async calculateTimeAdjustedValue(rawRecord, jobId) {
    try {
      const salePrice = this.parseNumeric(rawRecord.CURRENTSALE_PRICE);
      const saleDate = rawRecord.CURRENTSALE_DATE;
      
      if (!salePrice || !saleDate) return null;
      
      // Extract sale year from date
      const saleYear = new Date(saleDate).getFullYear();
      if (isNaN(saleYear)) return null;
      
      // Get county from job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('county_name, year_created')
        .eq('id', jobId)
        .single();
      
      if (jobError || !job) {
        console.warn('Could not get job county for time adjustment');
        return salePrice; // Return original price if no county data
      }
      
      // Get time adjustment multiplier
      const { data: multiplierResult, error: multiplierError } = await supabase
        .rpc('calculate_time_multiplier', {
          p_county_name: job.county_name,
          p_sale_year: saleYear,
          p_current_year: job.year_created
        });
      
      if (multiplierError || !multiplierResult) {
        console.warn(`No HPI data for ${job.county_name} ${saleYear}, using original price`);
        return salePrice; // Return original price if no HPI data
      }
      
      const adjustedValue = salePrice * multiplierResult;
      return parseFloat(adjustedValue.toFixed(2));
      
    } catch (error) {
      console.error('Error calculating time-adjusted value:', error);
      return this.parseNumeric(rawRecord.CURRENTSALE_PRICE); // Fallback to original price
    }
  }

  /**
   * Process complete file and store in database using FAST batch processing
   * UPDATED: Converted to batch processing like Microsystems for speed
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo = {}) {
    try {
      console.log('Starting BRT file processing...');
      
      // Process code file if provided
      if (codeFileContent) {
        this.processCodeFile(codeFileContent);
      }
      
      // Parse source file
      const records = this.parseSourceFile(sourceFileContent);
      console.log(`Processing ${records.length} records in batches...`);
      
      // Prepare all property records for batch insert
      const propertyRecords = [];
      const analysisRecords = [];
      
      for (const rawRecord of records) {
        try {
          // Map to property_records with version info
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId, versionInfo);
          propertyRecords.push(propertyRecord);
          
          // Map to analysis data (will link via composite key after insert) with version info
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
      
      // BATCH 1: Insert property records (1000 at a time)
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
          console.log(`✅ Inserted property records ${i + 1}-${Math.min(i + batchSize, propertyRecords.length)}`);
        }
      }
      
      // BATCH 2: Insert analysis records (1000 at a time)
      console.log(`Batch inserting ${analysisRecords.length} analysis records...`);
      
      for (let i = 0; i < analysisRecords.length; i += batchSize) {
        const batch = analysisRecords.slice(i, i + batchSize);
        
        const { error: analysisError } = await supabase
          .from('property_analysis_data')
          .insert(batch);
        
        if (analysisError) {
          console.error('Batch analysis insert error:', analysisError);
          results.warnings.push(`Analysis batch ${i}-${i + batchSize} failed`);
        } else {
          console.log(`✅ Inserted analysis records ${i + 1}-${Math.min(i + batchSize, analysisRecords.length)}`);
        }
      }
      
      console.log('🚀 BATCH PROCESSING COMPLETE:', results);
      return results;
      
    } catch (error) {
      console.error('File processing failed:', error);
      throw error;
    }
  }000 at a time)
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
          console.log(`✅ Inserted property records ${i + 1}-${Math.min(i + batchSize, propertyRecords.length)}`);
        }
      }
      
      // BATCH 2: Insert analysis records (1000 at a time)
      console.log(`Batch inserting ${analysisRecords.length} analysis records...`);
      
      for (let i = 0; i < analysisRecords.length; i += batchSize) {
        const batch = analysisRecords.slice(i, i + batchSize);
        
        const { error: analysisError } = await supabase
          .from('property_analysis_data')
          .insert(batch);
        
        if (analysisError) {
          console.error('Batch analysis insert error:', analysisError);
          results.warnings.push(`Analysis batch ${i}-${i + batchSize} failed`);
        } else {
          console.log(`✅ Inserted analysis records ${i + 1}-${Math.min(i + batchSize, analysisRecords.length)}`);
        }
      }
      
      console.log('🚀 BATCH PROCESSING COMPLETE:', results);
      return results;
      
    } catch (error) {
      console.error('File processing failed:', error);
      throw error;
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
   * Get code description for display
   */
  getCodeDescription(code) {
    return this.codeLookups.get(code) || code;
  }
}

// Export singleton instance
export const brtProcessor = new BRTProcessor();
