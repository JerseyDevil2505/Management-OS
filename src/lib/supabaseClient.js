import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Define fields that must be preserved during file updates
const PRESERVED_FIELDS = [
  'project_start_date',      // ProductionTracker
  'is_assigned_property',    // AdminJobManagement  
  'validation_status',       // ProductionTracker
  'asset_building_class',    // FinalValuation
  'asset_design_style',      // FinalValuation
  'asset_ext_cond',         // FinalValuation
  'asset_int_cond',         // FinalValuation
  'asset_type_use',         // FinalValuation
  'asset_year_built',       // FinalValuation
  'asset_zoning',           // FinalValuation
  'location_analysis',      // MarketAnalysis
  'new_vcs',                // AppealCoverage
  'values_norm_size',       // Valuation adjustments
  'values_norm_time'        // Valuation adjustments
];

// Job Service
export const jobService = {
  async getAll() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async create(jobData) {
    const { data, error } = await supabase
      .from('jobs')
      .insert([jobData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};

// Property Service with Field Preservation
export const propertyService = {
  async updateCSVData(sourceContent, codeContent, jobId, yearCreated, ccddCode, vendor, metadata) {
    try {
      console.log('📊 Starting property data update with field preservation...');
      
      // Parse the CSV content based on vendor
      const records = this.parseCSVContent(sourceContent, vendor);
      console.log(`✅ Parsed ${records.length} records from ${vendor} file`);

      // Generate composite keys for all records
      const recordsWithKeys = records.map(record => ({
        ...record,
        compositeKey: this.generateCompositeKey(record, vendor, yearCreated, ccddCode)
      }));

      // Extract all composite keys for preservation lookup
      const allCompositeKeys = recordsWithKeys.map(r => r.compositeKey);

      // CRITICAL: Fetch existing data to preserve user-entered fields
      console.log('🔄 Fetching existing data to preserve user fields...');
      const preservedDataMap = await this.fetchPreservedData(jobId, allCompositeKeys);
      console.log(`✅ Found ${preservedDataMap.size} existing records with data to preserve`);

      // Build records for UPSERT with preserved data
      const recordsToUpsert = recordsWithKeys.map(({ compositeKey, ...record }) => {
        // Get preserved data for this property
        const preservedData = preservedDataMap.get(compositeKey) || {};
        
        // Map CSV fields based on vendor
        const mappedRecord = this.mapRecordFields(record, vendor, metadata);
        
        // Merge with preserved data - preserved data takes precedence for protected fields
        return {
          ...mappedRecord,
          job_id: jobId,
          property_composite_key: compositeKey,
          file_version: metadata.file_version,
          source_file_name: metadata.source_file_name,
          source_file_uploaded_at: metadata.source_file_uploaded_at,
          source_file_version_id: metadata.source_file_version_id,
          vendor_source: vendor,
          updated_at: new Date().toISOString(),
          // CRITICAL: Spread preserved data last so it overwrites any nulls
          ...preservedData
        };
      });

      // Log preservation stats
      const preservedCount = recordsToUpsert.filter(r => 
        PRESERVED_FIELDS.some(field => r[field] !== null && r[field] !== undefined)
      ).length;
      console.log(`📊 Preserving user data in ${preservedCount} records`);

      // Perform batch UPSERT
      console.log('📤 Starting batch UPSERT operation...');
      const result = await this.performBatchUpsert(recordsToUpsert, jobId);
      
      console.log('✅ Property data update completed with field preservation');
      return result;

    } catch (error) {
      console.error('❌ Error in updateCSVData:', error);
      throw error;
    }
  },

  // Fetch existing data for preservation
  async fetchPreservedData(jobId, compositeKeys) {
    const preservedDataMap = new Map();
    
    try {
      // Batch fetch in chunks to avoid query limits
      const chunkSize = 500;
      for (let i = 0; i < compositeKeys.length; i += chunkSize) {
        const chunk = compositeKeys.slice(i, i + chunkSize);
        
        const { data: existingRecords, error } = await supabase
          .from('property_records')
          .select(`
            property_composite_key,
            ${PRESERVED_FIELDS.join(',')}
          `)
          .eq('job_id', jobId)
          .in('property_composite_key', chunk);

        if (error) {
          console.error('Error fetching preserved data:', error);
          continue;
        }

        // Build preservation map
        existingRecords?.forEach(record => {
          const preserved = {};
          PRESERVED_FIELDS.forEach(field => {
            if (record[field] !== null && record[field] !== undefined) {
              preserved[field] = record[field];
            }
          });
          
          // Only add to map if there's data to preserve
          if (Object.keys(preserved).length > 0) {
            preservedDataMap.set(record.property_composite_key, preserved);
          }
        });
      }
    } catch (error) {
      console.error('Error in fetchPreservedData:', error);
    }

    return preservedDataMap;
  },

  // Parse CSV content based on vendor format
  parseCSVContent(content, vendor) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    if (vendor === 'BRT') {
      return this.parseBRTFormat(lines);
    } else if (vendor === 'Microsystems') {
      return this.parseMicrosystemsFormat(lines);
    }
    
    throw new Error(`Unknown vendor: ${vendor}`);
  },

  // Parse BRT format
  parseBRTFormat(lines) {
    // Auto-detect separator
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const separator = (tabCount > 10 && tabCount > commaCount * 2) ? '\t' : ',';

    // Parse headers
    const headers = separator === ',' 
      ? this.parseCSVLine(lines[0])
      : lines[0].split('\t').map(h => h.trim());

    // Parse records
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const values = separator === ',' 
        ? this.parseCSVLine(lines[i])
        : lines[i].split('\t').map(v => v.trim());

      if (values.length === headers.length) {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index] || null;
        });
        records.push(record);
      }
    }

    return records;
  },

  // Parse Microsystems format
  parseMicrosystemsFormat(lines) {
    const headers = this.renameDuplicateHeaders(lines[0].split('|'));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('|');
      if (values.length === headers.length) {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index] || null;
        });
        records.push(record);
      }
    }

    return records;
  },

  // Helper: Parse CSV line handling quoted values
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  },

  // Helper: Rename duplicate headers
  renameDuplicateHeaders(headers) {
    const headerCounts = {};
    return headers.map(header => {
      if (headerCounts[header]) {
        headerCounts[header]++;
        return `${header}${headerCounts[header]}`;
      } else {
        headerCounts[header] = 1;
        return header;
      }
    });
  },

  // Generate composite key based on vendor format
  generateCompositeKey(record, vendor, yearCreated, ccddCode) {
    if (vendor === 'BRT') {
      const block = String(record.BLOCK || '').trim();
      const lot = String(record.LOT || '').trim();
      const qualifier = String(record.QUALIFIER || '').trim() || 'NONE';
      const card = String(record.CARD || '').trim() || 'NONE';
      const location = String(record.PROPERTY_LOCATION || '').trim() || 'NONE';
      return `${yearCreated}${ccddCode}-${block}-${lot}_${qualifier}-${card}-${location}`;
    } else if (vendor === 'Microsystems') {
      const block = String(record['Block'] || '').trim();
      const lot = String(record['Lot'] || '').trim();
      const qual = String(record['Qual'] || '').trim() || 'NONE';
      const bldg = String(record['Bldg'] || '').trim() || 'NONE';
      const location = String(record['Location'] || '').trim() || 'NONE';
      return `${yearCreated}${ccddCode}-${block}-${lot}_${qual}-${bldg}-${location}`;
    }
    
    return null;
  },

  // Map record fields based on vendor
  mapRecordFields(record, vendor, metadata) {
    const parseDate = (dateString) => {
      if (!dateString || dateString.trim() === '') return null;
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
    };

    const parseNumber = (value) => {
      if (!value) return null;
      const cleaned = String(value).replace(/[,$]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    };

    if (vendor === 'BRT') {
      return {
        property_block: record.BLOCK,
        property_lot: record.LOT,
        property_qualifier: record.QUALIFIER || '',
        property_addl_lot: record.ADDL_LOT || '',
        property_addl_card: record.CARD || '1',
        property_location: record.PROPERTY_LOCATION,
        property_m4_class: record.PROPERTY_CLASS,
        property_cama_class: record.PROPCLASS,
        property_vcs: record.VCS,
        property_facility: record.FACILITY_NAME,
        owner_name: record.OWNER_NAME,
        owner_street: record.OWNER_STREET,
        owner_csz: record.OWNER_CSZ,
        inspection_measure_by: record.MEASURE_BY || 'UNASSIGNED',
        inspection_measure_date: parseDate(record.MEASURE_DATE),
        inspection_info_by: record.INFO_BY,
        inspection_list_by: record.LIST_BY,
        inspection_list_date: parseDate(record.LIST_DATE),
        inspection_price_by: record.PRICE_BY,
        inspection_price_date: parseDate(record.PRICE_DATE),
        sales_price: parseNumber(record.CURRENTSALE_PRICE),
        sales_date: parseDate(record.CURRENTSALE_DATE),
        sales_book: record.SALES_BOOK,
        sales_page: record.SALES_PAGE,
        sales_nu: record.SALES_NU,
        values_mod_land: parseNumber(record.TOTALMOD_LAND),
        values_mod_improvement: parseNumber(record.TOTALMOD_IMPROVEMENT),
        values_mod_total: parseNumber(record.TOTALMOD_ASSESSMENT),
        values_cama_land: parseNumber(record.LAND),
        values_cama_improvement: parseNumber(record.IMPROVEMENT),
        values_cama_total: parseNumber(record.TOTAL),
        values_base_cost: parseNumber(record.BASE_COST),
        values_repl_cost: parseNumber(record.REPL_COST),
        values_det_items: parseNumber(record.DET_ITEMS),
        asset_sfla: parseNumber(record.SFLA),
        asset_story_height: parseNumber(record.STORY_HEIGHT),
        asset_year_built: parseInt(record.YEAR_BUILT) || null,
        asset_lot_sf: parseNumber(record.LOT_SIZE),
        asset_building_class: record.BUILDING_CLASS,
        asset_design_style: record.DESIGN_STYLE,
        raw_data: record
      };
    } else if (vendor === 'Microsystems') {
      return {
        property_block: record['Block'],
        property_lot: record['Lot'],
        property_qualifier: record['Qual'] || '',
        property_addl_lot: '',
        property_addl_card: record['Bldg'] || '1',
        property_location: record['Location'],
        property_m4_class: record['Class'],
        property_cama_class: record['PropCode'],
        property_vcs: record['Nbhd'],
        property_facility: '',
        owner_name: record['Owner 1'],
        owner_street: record['Mailing 1'],
        owner_csz: `${record['City St'] || ''} ${record['Zip'] || ''}`.trim(),
        inspection_measure_by: record['Measure By'] || 'UNASSIGNED',
        inspection_measure_date: parseDate(record['Measure Date']),
        inspection_info_by: record['Info By'],
        inspection_list_by: record['List By'],
        inspection_list_date: parseDate(record['List Date']),
        inspection_price_by: record['Price By'],
        inspection_price_date: parseDate(record['Price Date']),
        sales_price: parseNumber(record['Sale Price']),
        sales_date: parseDate(record['Sale Date']),
        sales_book: '',
        sales_page: '',
        sales_nu: record['Sale Type'],
        values_mod_land: parseNumber(record['Land Cur']),
        values_mod_improvement: parseNumber(record['Impr Cur']),
        values_mod_total: parseNumber(record['Total Cur']),
        values_cama_land: parseNumber(record['Land New']),
        values_cama_improvement: parseNumber(record['Impr New']),
        values_cama_total: parseNumber(record['Total New']),
        asset_sfla: parseNumber(record['SFLA']),
        asset_story_height: parseNumber(record['Stories']),
        asset_year_built: parseInt(record['Year Built']) || null,
        asset_lot_sf: parseNumber(record['Lot Size']),
        raw_data: record
      };
    }
  },

  // Perform batch UPSERT with retry logic
  async performBatchUpsert(records, jobId) {
    const batchSize = 500;
    let processed = 0;
    let errors = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(records.length / batchSize);
      
      console.log(`Processing batch ${batchNumber} of ${totalBatches} (${batch.length} records)...`);
      
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          const { error } = await supabase
            .from('property_records')
            .upsert(batch, {
              onConflict: 'job_id,property_composite_key,file_version',
              ignoreDuplicates: false
            });

          if (error) throw error;
          
          processed += batch.length;
          console.log(`✅ Batch ${batchNumber} processed successfully`);
          break;
          
        } catch (error) {
          retries++;
          console.error(`❌ Batch ${batchNumber} failed (attempt ${retries}/${maxRetries}):`, error.message);
          
          if (retries === maxRetries) {
            errors += batch.length;
            console.error(`❌ Batch ${batchNumber} failed after ${maxRetries} attempts`);
          } else {
            console.log(`🔄 Retrying batch ${batchNumber}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          }
        }
      }
    }

    return { processed, errors };
  }
};

// Employee Service
export const employeeService = {
  async getAll() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('last_name', { ascending: true });
    
    if (error) throw error;
    return data;
  },

  async create(employeeData) {
    const { data, error } = await supabase
      .from('employees')
      .insert([employeeData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('employees')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('employees')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};
