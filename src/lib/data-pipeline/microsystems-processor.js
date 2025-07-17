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
    this.duplicateHeaderPositions = {
      landValue: [],
      imprValue: [],
      totlValue: []
    };
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
    
    // Parse headers and find duplicate positions
    this.headers = lines[0].split('|');
    this.findDuplicateHeaderPositions();
    
    console.log(`Found ${this.headers.length} headers`);
    
    // Parse data rows
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|');
      
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
   * Find positions of duplicate headers for positional mapping
   */
  findDuplicateHeaderPositions() {
    this.headers.forEach((header, index) => {
      if (header === 'Land Value') {
        this.duplicateHeaderPositions.landValue.push(index);
      }
      if (header === 'Impr Value') {
        this.duplicateHeaderPositions.imprValue.push(index);
      }
      if (header === 'Totl Value') {
        this.duplicateHeaderPositions.totlValue.push(index);
      }
    });
    
    console.log('Duplicate header positions:', this.duplicateHeaderPositions);
  }

  /**
   * Map Microsystems record to property_records table fields
   */
  mapToPropertyRecord(rawRecord, yearCreated, ccddCode, jobId) {
    // Get values by position for duplicates
    const rawValues = this.headers.map(header => rawRecord[header]);
    
    return {
      // Job context
      job_id: jobId,
      
      // Property identifiers
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_location: rawRecord['Location'],
      property_composite_key: `${yearCreated}${ccddCode}-${rawRecord['Block']}-${rawRecord['Lot']}_${rawRecord['Qual'] || 'NONE'}-${rawRecord['Bldg'] || 'NONE'}-${rawRecord['Location'] || 'NONE'}`,
      
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
      
      // Values - positional mapping for duplicates
      values_mod_land: this.parseNumeric(rawValues[this.duplicateHeaderPositions.landValue[0]]),
      values_cama_land: this.parseNumeric(rawValues[this.duplicateHeaderPositions.landValue[1]]),
      values_mod_improvement: this.parseNumeric(rawValues[this.duplicateHeaderPositions.imprValue[0]]),
      values_cama_improvement: this.parseNumeric(rawValues[this.duplicateHeaderPositions.imprValue[1]]),
      values_mod_total: this.parseNumeric(rawValues[this.duplicateHeaderPositions.totlValue[0]]),
      values_cama_total: this.parseNumeric(rawValues[this.duplicateHeaderPositions.totlValue[1]]),
      
      // Values - single occurrence
      values_base_cost: this.parseNumeric(rawRecord['Base Cost']),
      values_det_items: this.parseNumeric(rawRecord['Det Items']),
      values_repl_cost: this.parseNumeric(rawRecord['Cost New']),
      
      // Inspection fields
      inspection_info_by: this.parseInteger(rawRecord['Interior Finish3']),
      inspection_list_by: rawRecord['Insp By'],
      inspection_list_date: this.parseDate(rawRecord['Insp Date']),
      inspection_measure_by: rawRecord['Measured By'],
      inspection_measure_date: null, // Not available in Microsystems
      inspection_price_by: null, // Not available in Microsystems
      inspection_price_date: null, // Not available in Microsystems
      
      // Property classifications
      property_cama_class: rawRecord['Class'],
      
      // Metadata
      vendor_source: 'Microsystems',
      source_file_uploaded_at: new Date(),
      processed_at: new Date()
    };
  }

  /**
   * Map to property_analysis_data for calculated fields and raw storage
   */
  mapToAnalysisData(rawRecord, propertyRecordId) {
    return {
      // Link to property record
      property_record_id: propertyRecordId,
      
      // Property identifiers (duplicated for easy querying)
      property_block: rawRecord['Block'],
      property_lot: rawRecord['Lot'],
      property_qualifier: rawRecord['Qual'],
      property_addl_card: rawRecord['Bldg'],
      property_location: rawRecord['Location'],
      property_composite_key: rawRecord.property_composite_key,
      
      // Calculated fields (examples - add more as needed)
      total_baths_calculated: this.calculateTotalBaths(rawRecord),
      fireplace_count_calculated: this.calculateFireplaceCount(rawRecord),
      lot_size_calculated: this.calculateLotSize(rawRecord),
      livable_area_normalized: this.parseNumeric(rawRecord['Livable Area']),
      
      // Store complete raw data as JSON for dynamic querying
      raw_data: rawRecord,
      
      // Metadata
      calculated_at: new Date()
    };
  }

  /**
   * Calculate total bathrooms from multiple fields
   */
  calculateTotalBaths(rawRecord) {
    let total = 0;
    
    // Add weighted bathroom counts
    total += (this.parseNumeric(rawRecord['4 Fixture Bath']) || 0) * 1.0;
    total += (this.parseNumeric(rawRecord['3 Fixture Bath']) || 0) * 0.75;
    total += (this.parseNumeric(rawRecord['2 Fixture Bath']) || 0) * 0.5;
    total += (this.parseNumeric(rawRecord['Single Fixture']) || 0) * 0.25;
    
    return total > 0 ? total : null;
  }

  /**
   * Calculate fireplace count
   */
  calculateFireplaceCount(rawRecord) {
    let count = 0;
    
    count += this.parseInteger(rawRecord['Fireplace 1 Story Stack']) || 0;
    count += this.parseInteger(rawRecord['Fp 1 And Half Sty']) || 0;
    count += this.parseInteger(rawRecord['Fp 2 Sty']) || 0;
    count += this.parseInteger(rawRecord['Fp Same Stack']) || 0;
    count += this.parseInteger(rawRecord['Fp Freestanding']) || 0;
    count += this.parseInteger(rawRecord['Fp Heatilator']) || 0;
    
    return count > 0 ? count : null;
  }

  /**
   * Calculate lot size in square feet
   */
  calculateLotSize(rawRecord) {
    // Try different lot size fields
    let lotSize = this.parseNumeric(rawRecord['Lot Size In Sf']);
    
    if (!lotSize) {
      // Convert acres to square feet if available
      const acres = this.parseNumeric(rawRecord['Lot Size In Acres']);
      if (acres) {
        lotSize = acres * 43560; // 1 acre = 43,560 sq ft
      }
    }
    
    return lotSize;
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
          const analysisData = this.mapToAnalysisData(rawRecord, insertedRecord.id);
          analysisData.property_composite_key = propertyRecord.property_composite_key;
          
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

  parseNumeric(value) {
    if (!value || value === '') return null;
    const num = parseFloat(String(value).replace(/[,$]/g, ''));
    return isNaN(num) ? null : num;
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
