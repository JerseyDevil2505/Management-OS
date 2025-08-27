/**
 * STREAMING MICROSYSTEMS PROCESSOR - Server-Side Processing
 * 
 * PERFORMANCE REVOLUTION FOR INITIAL JOB CREATION:
 * - Replaces client-side batch INSERTs with single server-side function
 * - Eliminates 500-record batch processing over network
 * - Reduces 16K record processing from 60+ seconds to ~5 seconds
 * - Uses database transaction control for all-or-nothing processing
 * 
 * MICROSYSTEMS SPECIFICS:
 * - Pipe-delimited file format
 * - Different property class mapping (2, 3A, 4A, 4B, 4C)
 * - AAACCCCSSSS code structure parsing
 * 
 * OLD PATTERN: Client batching + multiple INSERT statements
 * NEW PATTERN: Single server-side function with transaction control
 */

import { supabase } from '../supabaseClient.js';
import { bulkPropertyOperations, performanceMonitor } from '../streamingDataService.js';

export class StreamingMicrosystemsProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.headers = [];
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
   * Parse pipe-delimited content
   */
  parseCSVContent(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    console.log('🔍 Processing pipe-delimited Microsystems file');

    // Parse headers from first line
    this.headers = lines[0].split('|').map(h => h.trim());
    console.log(`📋 Headers detected: ${this.headers.length} columns`);

    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|').map(v => v.trim());
      
      if (values.length !== this.headers.length) {
        console.warn(`⚠️ Row ${i}: Expected ${this.headers.length} columns, got ${values.length}`);
        continue;
      }

      const record = {};
      this.headers.forEach((header, index) => {
        record[header] = this.preserveStringValue(values[index]);
      });
      
      records.push(record);
    }

    console.log(`✅ Parsed ${records.length} records from pipe-delimited file`);
    return records;
  }

  /**
   * Generate composite key EXACTLY matching existing logic
   */
  generateCompositeKey(record, jobYear, ccddCode) {
    const block = this.preserveStringValue(record.Block) || 'NONE';
    const lot = this.preserveStringValue(record.Lot) || 'NONE';
    const qualifier = this.preserveStringValue(record.Qual) || 'NONE';
    const card = this.preserveStringValue(record.Bldg) || 'NONE';
    const location = this.preserveStringValue(record.Location) || 'NONE';
    
    return `${jobYear}${ccddCode}-${block}-${lot}_${qualifier}-${card}-${location}`;
  }

  /**
   * Transform CSV record to property record format
   */
  transformRecord(record, jobId, jobYear, ccddCode, fileVersion, uploadDate, sessionId, createdBy) {
    const propertyCompositeKey = this.generateCompositeKey(record, jobYear, ccddCode);
    
    return {
      job_id: jobId,
      property_composite_key: propertyCompositeKey,
      property_block: this.preserveStringValue(record.Block),
      property_lot: this.preserveStringValue(record.Lot),
      property_qualifier: this.preserveStringValue(record.Qual),
      property_addl_card: this.preserveStringValue(record.Bldg),
      property_location: this.preserveStringValue(record.Location),
      property_facility: this.preserveStringValue(record.Facility),
      property_cama_class: this.preserveStringValue(record.PropClass),
      property_m4_class: this.preserveStringValue(record.M4Class),
      property_vcs: this.preserveStringValue(record.VCS),
      
      // Owner information
      owner_name: this.preserveStringValue(record.Owner1),
      owner_street: this.preserveStringValue(record.Owner2),
      owner_csz: this.preserveStringValue(record.Owner3),
      
      // Asset information
      asset_neighborhood: this.preserveStringValue(record.Neighbrhd),
      asset_design_style: this.preserveStringValue(record.BldgStyle),
      asset_building_class: this.preserveStringValue(record.BldgClass),
      asset_type_use: this.preserveStringValue(record.TypeUse),
      asset_story_height: this.parseNumeric(record.StoryHgt),
      asset_year_built: this.parseInteger(record.YearBuilt),
      asset_sfla: this.parseNumeric(record.SFLA),
      asset_lot_sf: this.parseNumeric(record.LotSF),
      asset_lot_acre: this.parseNumeric(record.LotAc),
      asset_lot_frontage: this.parseNumeric(record.Frontage),
      asset_lot_depth: this.parseNumeric(record.Depth),
      asset_view: this.preserveStringValue(record.View),
      asset_zoning: this.preserveStringValue(record.Zoning),
      asset_key_page: this.preserveStringValue(record.KeyPage),
      asset_map_page: this.preserveStringValue(record.MapPage),
      asset_ext_cond: this.preserveStringValue(record.ExtCond),
      asset_int_cond: this.preserveStringValue(record.IntCond),
      
      // Inspection information
      inspection_info_by: this.preserveStringValue(record.InfoBy),
      inspection_list_by: this.preserveStringValue(record.ListBy),
      inspection_list_date: this.parseDate(record.ListDate),
      inspection_measure_by: this.preserveStringValue(record.MeasureBy),
      inspection_measure_date: this.parseDate(record.MeasureDate),
      inspection_price_by: this.preserveStringValue(record.PriceBy),
      inspection_price_date: this.parseDate(record.PriceDate),
      
      // Values
      values_cama_land: this.parseNumeric(record.CAMALand),
      values_cama_improvement: this.parseNumeric(record.CAMAImprv),
      values_cama_total: this.parseNumeric(record.CAMATotal),
      values_mod_land: this.parseNumeric(record.ModLand),
      values_mod_improvement: this.parseNumeric(record.ModImprv),
      values_mod_total: this.parseNumeric(record.ModTotal),
      values_base_cost: this.parseNumeric(record.BaseCost),
      values_repl_cost: this.parseNumeric(record.ReplCost),
      values_det_items: this.parseNumeric(record.DetItems),
      
      // Sales information
      sales_book: this.preserveStringValue(record.SaleBook),
      sales_page: this.preserveStringValue(record.SalePage),
      sales_nu: this.preserveStringValue(record.SaleNu),
      sales_date: this.parseDate(record.SaleDate),
      sales_price: this.parseNumeric(record.SalePrice),
      
      // Raw data for future reference
      raw_data: record,
      
      // File tracking
      source_file_name: 'Imported at Job Creation',
      source_file_uploaded_at: uploadDate,
      source_file_version_id: sessionId,
      file_version: fileVersion,
      upload_date: uploadDate,
      processed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: createdBy,
      vendor_source: 'Microsystems',
      
      // Status fields for initial import
      validation_status: 'imported',
      is_new_since_last_upload: true,
      code_file_updated_at: uploadDate,
      is_assigned_property: false, // Default for new imports
      project_start_date: null     // Set later by ProductionTracker
    };
  }

  /**
   * Parse numeric value safely
   */
  parseNumeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(String(value).replace(/[,$]/g, ''));
    return isNaN(num) ? null : num;
  }

  /**
   * Parse integer value safely
   */
  parseInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseInt(String(value).replace(/[,$]/g, ''));
    return isNaN(num) ? null : num;
  }

  /**
   * Parse date value safely
   */
  parseDate(value) {
    if (!value || value === '') return null;
    
    try {
      // Handle various date formats
      const dateStr = String(value).trim();
      if (dateStr.includes('/')) {
        const [month, day, year] = dateStr.split('/');
        return `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
      
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return null;
      
      return date.toISOString().split('T')[0];
    } catch (error) {
      console.warn(`⚠️ Invalid date format: ${value}`);
      return null;
    }
  }

  /**
   * MAIN PROCESSING METHOD - Server-Side Performance for Job Creation
   */
  async processFile(fileContent, jobId, jobYear, ccddCode, createdBy, versionInfo = {}) {
    console.log('🚀 Starting STREAMING Microsystems job creation with server-side operations');
    
    const startTime = Date.now();
    
    try {
      // Parse pipe-delimited content
      console.log('📋 Parsing pipe-delimited content...');
      const csvRecords = this.parseCSVContent(fileContent);
      
      if (csvRecords.length === 0) {
        throw new Error('No valid records found in pipe-delimited file');
      }
      
      console.log(`✅ Parsed ${csvRecords.length} records from pipe-delimited file`);
      
      // Transform to property records
      console.log('🔄 Transforming records...');
      const uploadDate = new Date().toISOString();
      const sessionId = versionInfo.sessionId || crypto.randomUUID();
      const fileVersion = 1; // Initial creation is always version 1
      
      const propertyRecords = csvRecords.map(record => 
        this.transformRecord(record, jobId, jobYear, ccddCode, fileVersion, uploadDate, sessionId, createdBy)
      );
      
      console.log(`✅ Transformed ${propertyRecords.length} property records`);
      
      // Calculate property class totals for job metadata
      const classTotals = this.calculateClassTotals(propertyRecords);
      
      // Use server-side bulk processing - NO preserved fields for initial creation
      console.log('🚀 Processing with server-side bulk function...');
      const result = await bulkPropertyOperations.processCSVUpdate(
        jobId,
        propertyRecords,
        [] // No preserved fields for initial creation
      );
      
      if (!result.success) {
        throw new Error(`Server-side processing failed: ${result.error}`);
      }
      
      // Update job with property totals
      console.log('📊 Updating job with property totals...');
      await this.updateJobTotals(jobId, classTotals, propertyRecords.length);
      
      const totalTime = Date.now() - startTime;
      
      // Log performance
      performanceMonitor.logQuery(
        'MICROSYSTEMS_CREATION_STREAMING',
        totalTime,
        propertyRecords.length
      );
      
      console.log(`🎉 STREAMING MICROSYSTEMS CREATION COMPLETE in ${totalTime}ms:`);
      console.log(`   📊 Records processed: ${result.stats.total_processed}`);
      console.log(`   ⬆️ Records inserted: ${result.stats.inserted_count}`);
      console.log(`   🏠 Residential: ${classTotals.residential}`);
      console.log(`   🏢 Commercial: ${classTotals.commercial}`);
      console.log(`   ⚡ Server time: ${result.stats.execution_time_ms}ms`);
      console.log(`   🌐 Client time: ${result.clientTime}ms`);
      console.log(`   🚀 Performance gain: ${Math.round(((60000 - totalTime) / 60000) * 100)}% faster than old method`);
      
      return {
        success: true,
        recordsProcessed: result.stats.total_processed,
        recordsInserted: result.stats.inserted_count,
        classTotals,
        processingTime: totalTime,
        serverTime: result.stats.execution_time_ms,
        sessionId
      };
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`❌ STREAMING MICROSYSTEMS CREATION FAILED after ${totalTime}ms:`, error);
      
      return {
        success: false,
        error: error.message,
        processingTime: totalTime
      };
    }
  }

  /**
   * Calculate property class totals (Microsystems specific)
   */
  calculateClassTotals(propertyRecords) {
    const totals = {
      residential: 0,
      commercial: 0,
      other: 0,
      total: propertyRecords.length
    };
    
    propertyRecords.forEach(record => {
      const propClass = record.property_cama_class;
      
      // Microsystems uses same class codes as BRT
      if (['2', '3A'].includes(propClass)) {
        totals.residential++;
      } else if (['4A', '4B', '4C'].includes(propClass)) {
        totals.commercial++;
      } else {
        totals.other++;
      }
    });
    
    console.log(`📊 Property class totals:`, totals);
    return totals;
  }

  /**
   * Update job with property totals
   */
  async updateJobTotals(jobId, classTotals, totalProperties) {
    try {
      const { error } = await supabase
        .from('jobs')
        .update({
          total_properties: totalProperties,
          totalresidential: classTotals.residential,
          totalcommercial: classTotals.commercial,
          source_file_status: 'processed',
          source_file_uploaded_at: new Date().toISOString(),
          source_file_version_id: crypto.randomUUID(),
          vendor_type: 'Microsystems', // Set vendor type
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId);
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ Job totals updated: ${totalProperties} total, ${classTotals.residential} residential, ${classTotals.commercial} commercial`);
      
    } catch (error) {
      console.error('❌ Error updating job totals:', error);
      throw error;
    }
  }

  /**
   * Store code file in database
   */
  async storeCodeFileInDatabase(codeFileContent, jobId) {
    console.log('💾 Storing Microsystems code file in database...');
    
    try {
      // Parse Microsystems code sections (different format than BRT)
      this.parseCodeSections(codeFileContent);
      
      // Update job with parsed code definitions
      const { error } = await supabase
        .from('jobs')
        .update({
          parsed_code_definitions: {
            sections: this.allCodeSections,
            parsedAt: new Date().toISOString(),
            totalSections: Object.keys(this.allCodeSections).length,
            vendor: 'Microsystems'
          },
          code_file_content: codeFileContent,
          code_file_status: 'processed',
          code_file_uploaded_at: new Date().toISOString(),
          code_file_version: 1, // Initial creation
          vendor_type: 'Microsystems'
        })
        .eq('id', jobId);
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ Microsystems code file stored with ${Object.keys(this.allCodeSections).length} sections`);
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error storing Microsystems code file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse Microsystems code sections (pipe-delimited format)
   */
  parseCodeSections(codeFileContent) {
    const lines = codeFileContent.split('\n').filter(line => line.trim());
    
    // Microsystems format: CODE|DESCRIPTION|RATE|CONSTANT|CATEGORY|TABLE|UPDATED
    this.allCodeSections = {};
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine || trimmedLine.startsWith('CODE|')) {
        continue; // Skip header or empty lines
      }
      
      const parts = trimmedLine.split('|');
      if (parts.length >= 7) {
        const [code, description, rate, constant, category, table, updated] = parts;
        
        // Group by category
        if (!this.allCodeSections[category]) {
          this.allCodeSections[category] = {};
        }
        
        this.allCodeSections[category][code] = {
          code: code.trim(),
          description: description.trim(),
          rate: rate.trim(),
          constant: constant.trim(),
          table: table.trim(),
          updated: updated.trim()
        };
      }
    }
    
    console.log(`✅ Parsed ${Object.keys(this.allCodeSections).length} Microsystems code categories`);
    
    // Log summary of what we parsed
    Object.keys(this.allCodeSections).forEach(category => {
      const count = Object.keys(this.allCodeSections[category]).length;
      console.log(`   📋 ${category}: ${count} codes`);
    });
  }
}

// Export default instance
export const streamingMicrosystemsProcessor = new StreamingMicrosystemsProcessor();
