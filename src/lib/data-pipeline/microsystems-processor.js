/**
 * Complete Microsystems Processor 
 * Handles pipe-delimited source files and field_id+code lookup files
 * Stores direct mappings in property_records and raw data in property_analysis_data
 */

import { supabase } from '../supabaseClient.js';

export class MicrosystemsProcessor {
  constructor() {
    this.codeLookups = new Map();
    this.headers = [];
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
   * Process Microsystems code file (field_id+code format)
   * Example: "120PV" = Field 120 + Code "PV" = "PAVED"
   * Special: "8FA" = Heating/cooling codes use "8" prefix
   */
  processCodeFile(codeFileContent) {
    console.log('Processing Microsystems code file...');
    
    const lines = codeFileContent.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;
      
      // Parse field_id+code format
      // Most: "120PV=PAVED"
      // Heating/cooling: "8FA=FORCED AIR"
      const [code, description] = trimmedLine.split('=');
      if (code && description) {
        this.codeLookups.set(code.trim(), description.trim());
      }
    });
    
    console.log(`Loaded ${this.codeLookups.size} code definitions`);
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
   * Map Microsystems record to property_records table fields
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId) {
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_location: rawRecord['Location'], // FIXED: Direct mapping to first Location
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`,
      
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
      
      // Values - FIXED: Direct mapping to renamed headers
      values_mod_land: this.parseNumeric(rawRecord['Land Value']), // First instance
      values_cama_land: this.parseNumeric(rawRecord['Land Value2']), // Second instance
      values_mod_improvement: this.parseNumeric(rawRecord['Impr Value']), // First instance
      values_cama_improvement: this.parseNumeric(rawRecord['Impr Value2']), // Second instance
      values_mod_total: this.parseNumeric(rawRecord['Totl Value']), // First instance
      values_cama_total: this.parseNumeric(rawRecord['Totl Value2']), // Second instance
      
      // Values - single occurrence
      values_base_cost: this.parseNumeric(rawRecord['Base Cost']),
      values_det_items: this.parseNumeric(rawRecord['Det Items']),
      values_repl_cost: this.parseNumeric(rawRecord['Cost New']),
      
      // Inspection fields - FIXED: Remove parseInteger for letter codes
      inspection_info_by: rawRecord['Interior Finish3'], // Store letter codes directly (E, F, O, R, V)
      inspection_list_by: rawRecord['Insp By'],
      inspection_list_date: this.parseDate(rawRecord['Insp Date']),
      inspection_measure_by: rawRecord['Measured By'],
      inspection_measure_date: null, // Not available in Microsystems
      inspection_price_by: null, // Not available in Microsystems
      inspection_price_date: null, // Not available in Microsystems
      
      // Property classifications
      property_cama_class: rawRecord['Class'],
      property_facility: rawRecord['Facility Name'],
      property_vcs: rawRecord['VCS'],
      
      // Metadata
      vendor_source: 'Microsystems',
      source_file_uploaded_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad',
      
      // Store complete raw data as JSON
      raw_data: rawRecord
    };
  }

  /**
   * Map to property_analysis_data for calculated fields and raw storage
   */
  async mapToAnalysisData(rawRecord, propertyRecordId, jobId, yearCreated, ccddCode) {
    return {
      // Link to property record
      property_record_id: propertyRecordId,
      
      // Property identifiers (duplicated for easy querying)
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_location: rawRecord['Location'], // FIXED: Direct mapping
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${(rawRecord['Qual'] || '').trim() || 'NONE'}-${(rawRecord['Bldg'] || '').trim() || 'NONE'}-${(rawRecord['Location'] || '').trim() || 'NONE'}`,
      
      // Calculated fields - minimal essential calculations only
      total_baths_calculated: this.calculateTotalBaths(rawRecord),
      
      // Asset fields - direct mappings from Microsystems
      asset_sfla: this.parseNumeric(rawRecord['Livable Area']),
      asset_new_vcs: null, // User defined, created in module
      asset_key_page: null, // User defined, created in module
      asset_map_page: null, // User defined, created in module
      asset_zoning: null, // User defined, created in module
      asset_view: null, // Not available in Microsystems
      asset_neighborhood: rawRecord['Neighborhood'],
      asset_type_use: rawRecord['Type Use Code'],
      asset_building_class: rawRecord['Bldg Qual Class Code'],
      asset_design_style: rawRecord['Style Code'],
      asset_year_built: this.parseInteger(rawRecord['Year Built']),
      asset_lot_frontage: this.calculateLotFrontage(rawRecord),
      asset_lot_depth: this.calculateLotDepth(rawRecord),
      asset_lot_acre: this.parseNumeric(rawRecord['Lot Size In Acres'], 2), // 2 decimals
      asset_lot_sf: this.parseInteger(rawRecord['Lot Size In Sf']), // No decimals
      asset_story_height: this.parseNumeric(rawRecord['Story Height']),
      asset_ext_cond: rawRecord['Condition'],
      asset_int_cond: rawRecord['Interior Cond Or End Unit'],
      
      // Normalized values - time adjustment using FRED HPI data
      values_norm_time: null, // Calculate later in Market & Land Analytics module
      values_norm_size: null, // Size normalization - calculated later in development
      
      // Store complete raw data as JSON for dynamic querying
      raw_data: rawRecord,
      
      // Metadata
      calculated_at: new Date().toISOString(),
      created_by: '5df85ca3-7a54-4798-a665-c31da8d9caad'
    };
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
      return this.parseNumeric(rawRecord['Sale Price']); // Fallback to original price
    }
  }

  /**
   * Process complete file and store in database
   */
  async processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode) {
    try {
      console.log('Starting Microsystems file processing...');
      
      // Process code file if provided
      if (codeFileContent) {
        this.processCodeFile(codeFileContent);
      }
      
      // Parse source file
      const records = this.parseSourceFile(sourceFileContent);
      
      // Process each record
      const results = {
        processed: 0,
        errors: 0,
        warnings: []
      };
      
      for (const rawRecord of records) {
        try {
          // Map to property_records
          const propertyRecord = this.mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId);
          
          // Insert property record
          const { data: insertedRecord, error: propertyError } = await supabase
            .from('property_records')
            .insert([propertyRecord])
            .select('id')
            .single();
          
          if (propertyError) {
            console.error('Error inserting property record:', propertyError);
            results.errors++;
            continue;
          }
          
          // Map to analysis data
          const analysisData = await this.mapToAnalysisData(rawRecord, insertedRecord.id, jobId, yearCreated, ccddCode);
          
          // Insert analysis data
          const { error: analysisError } = await supabase
            .from('property_analysis_data')
            .insert([analysisData]);
          
          if (analysisError) {
            console.error('Error inserting analysis data:', analysisError);
            results.warnings.push(`Analysis data failed for ${propertyRecord.property_composite_key}`);
          }
          
          results.processed++;
          
        } catch (error) {
          console.error('Error processing record:', error);
          results.errors++;
        }
      }
      
      console.log('Processing complete:', results);
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
export const microsystemsProcessor = new MicrosystemsProcessor();
