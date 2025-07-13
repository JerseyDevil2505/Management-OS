export class BRTProcessor {
  constructor() {
    this.systemConfig = {};
    this.fieldMappings = {};
    this.codeLookups = new Map();
    
    // BRT category mappings to normalized interface fields
    this.categoryMappings = {
      '21': 'Type and Use',           // TYPE & USE
      '22': 'Story Height',           // STORY HGT  
      '23': 'Design and Style',       // DESIGN
      '24': 'Roof Type',              // ROOF TYPE
      '25': 'Roof Material',          // ROOF MATL
      '26': 'Exterior Finish',        // EXT FINISH
      '27': 'Foundation',             // FOUNDATION
      '28': 'Interior Wall',          // INT FINISH (like Microsystems 555)
      '30': 'Basement',               // BASEMENT (Finished/Living/Unfinished)
      '31': 'Heat Source',            // HEAT SRCE
      '32': 'Heat System',            // HEAT SYS
      '34': 'Air Conditioning',       // AIR COND
      '53': 'InfoBy',                 // INFO BY (super important)
      '60': 'Condition',              // CONDITION (Ext/Int with code 10+ workaround)
      '62': 'Positive Land Adj',      // LAND COND (positive adjustments)
      '63': 'Negative Land Adj',      // LAND INFL (negative adjustments)
      'VCS': 'Neighborhood'           // VCS (Value Control Sector)
    };

    // CSV field mappings to BRT database columns
    this.csvFieldMappings = {
      'Type and Use': 'TYPEUSE',
      'Story Height': 'STORYHGT', 
      'Design and Style': 'DESIGN',
      'Roof Type': 'ROOFTYPE',
      'Roof Material': 'ROOFMATERIAL',
      'Foundation': 'FOUNDATION_1',
      'Heat Source': 'HEATSRC_1',
      'Heat System': 'HEATSYS_1',
      'Air Conditioning': 'AC_1',
      'InfoBy': 'INFOBY',
      'Neighborhood': 'VCS',
      'Exterior Finish': 'EXTERIORFINISH_1',
      'Interior Wall': 'INTERIORFINISH_1',
      'Basement': 'BSMNTFINISH_1',
      'Condition': 'EXTERIORNC' // or INTERIORNC depending on code
    };
  }

  // Auto-detect BRT file types
  detectFileType(filename, content = null) {
    const name = filename.toLowerCase();
    
    if (!content) {
      // Return detection hints for UI
      if (name.includes('.csv')) return 'likely_data';
      if (name.includes('.txt')) return 'likely_codes';
      return 'unknown';
    }
    
    // Full content detection
    if (content.includes('VALUES_LANDTAXABLEVALUE') || name.includes('.csv')) {
      return 'data';
    }
    
    if (content.includes('Residential') && content.includes('"MAP"')) {
      return 'codes';
    }
    
    return 'unknown';
  }

  // Process BRT code file (JSON structure in .txt format)
  async processCodeFile(content) {
    try {
      const lines = content.split('\n').filter(line => line.trim());
      
      // Find Residential section
      let residentialIndex = -1;
      lines.forEach((line, index) => {
        if (line.includes('Residential') && residentialIndex === -1) {
          residentialIndex = index;
        }
      });
      
      if (residentialIndex === -1 || residentialIndex + 1 >= lines.length) {
        throw new Error('Could not find Residential section or data in code file');
      }
      
      // Parse the main data line
      const dataLine = lines[residentialIndex + 1];
      const jsonData = JSON.parse(dataLine);
      
      // Extract codes from JSON structure
      let totalCodes = 0;
      
      Object.keys(this.categoryMappings).forEach(categoryKey => {
        const categoryData = this.findCategoryInJSON(jsonData, categoryKey);
        if (categoryData) {
          totalCodes += this.extractCodesFromCategory(categoryData, categoryKey);
        }
      });
      
      return {
        success: true,
        codesExtracted: totalCodes,
        categoriesFound: Array.from(this.codeLookups.keys()).map(k => k.split('_')[0]).filter((v, i, a) => a.indexOf(v) === i).length
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Find category in nested JSON structure
  findCategoryInJSON(jsonData, categoryKey) {
    // Direct key match
    if (jsonData[categoryKey]) {
      return jsonData[categoryKey];
    }
    
    // Look in MAP structure
    if (jsonData.MAP && jsonData.MAP[categoryKey]) {
      return jsonData.MAP[categoryKey];
    }
    
    // Search numbered sections (common BRT pattern)
    for (let i = 1; i <= 100; i++) {
      if (jsonData[i]) {
        if (jsonData[i].KEY === categoryKey) {
          return jsonData[i];
        }
        if (jsonData[i].MAP) {
          const found = this.findCategoryInJSON(jsonData[i].MAP, categoryKey);
          if (found) return found;
        }
      }
    }
    
    return null;
  }

  // Extract codes from category data
  extractCodesFromCategory(categoryData, categoryKey) {
    let codeCount = 0;
    
    if (categoryData.MAP) {
      Object.keys(categoryData.MAP).forEach(key => {
        const item = categoryData.MAP[key];
        if (item.KEY && item.DATA && item.DATA.VALUE) {
          const code = item.KEY;
          const description = item.DATA.VALUE;
          
          this.codeLookups.set(`${categoryKey}_${code}`, description);
          codeCount++;
        }
      });
    }
    
    return codeCount;
  }

  // Lookup code with category validation
  lookupCode(category, dataValue) {
    if (!dataValue || dataValue.trim() === '') {
      return null;
    }
    
    const cleanValue = dataValue.trim().toUpperCase();
    const lookupKey = `${category}_${cleanValue}`;
    
    const description = this.codeLookups.get(lookupKey);
    
    if (description) {
      return { 
        code: cleanValue, 
        description, 
        category: this.categoryMappings[category] || category 
      };
    }
    
    return null;
  }

  // Process BRT CSV data file
  async processDataFile(content) {
    try {
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        throw new Error('Data file appears to be empty or has no data rows');
      }
      
      // Parse CSV header
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      const dataRows = lines.slice(1);
      
      return {
        success: true,
        totalRecords: dataRows.length,
        columnsFound: headers.length,
        headers: headers,
        sampleData: this.parseSampleRecords(dataRows.slice(0, 3), headers)
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Parse sample records for validation
  parseSampleRecords(dataRows, headers) {
    return dataRows.map((line, index) => {
      try {
        const values = line.split(',').map(v => v.replace(/"/g, '').trim());
        const record = {};
        
        headers.forEach((header, i) => {
          record[header] = values[i] || '';
        });
        
        // Test key field lookups
        const testResults = {};
        const testFields = [
          { category: '21', field: 'TYPEUSE', name: 'Type & Use' },
          { category: '23', field: 'DESIGN', name: 'Design Style' },
          { category: '27', field: 'FOUNDATION_1', name: 'Foundation' },
          { category: '53', field: 'INFOBY', name: 'Info By' },
          { category: 'VCS', field: 'VCS', name: 'Neighborhood' }
        ];
        
        testFields.forEach(test => {
          const fieldValue = record[test.field];
          const result = this.lookupCode(test.category, fieldValue);
          testResults[test.name] = {
            rawValue: fieldValue,
            found: !!result,
            description: result ? result.description : null
          };
        });
        
        return {
          recordIndex: index + 1,
          block: record.BLOCK,
          lot: record.LOT,
          testResults
        };
        
      } catch (error) {
        return {
          recordIndex: index + 1,
          error: error.message
        };
      }
    });
  }

  // Normalize BRT record to standard format
  normalizeRecord(rawRecord) {
    const normalized = {
      // Core identification
      block: rawRecord.BLOCK,
      lot: rawRecord.LOT,
      qualifier: rawRecord.QUALIFIER,
      
      // Property details with code lookups
      typeUse: this.lookupAndFormat('21', rawRecord.TYPEUSE),
      storyHeight: this.lookupAndFormat('22', rawRecord.STORYHGT),
      designStyle: this.lookupAndFormat('23', rawRecord.DESIGN),
      roofType: this.lookupAndFormat('24', rawRecord.ROOFTYPE),
      roofMaterial: this.lookupAndFormat('25', rawRecord.ROOFMATERIAL),
      exteriorFinish: this.lookupAndFormat('26', rawRecord.EXTERIORFINISH_1),
      foundation: this.lookupAndFormat('27', rawRecord.FOUNDATION_1),
      interiorWall: this.lookupAndFormat('28', rawRecord.INTERIORFINISH_1),
      basement: this.lookupAndFormat('30', rawRecord.BSMNTFINISH_1),
      heatSource: this.lookupAndFormat('31', rawRecord.HEATSRC_1),
      heatSystem: this.lookupAndFormat('32', rawRecord.HEATSYS_1),
      airConditioning: this.lookupAndFormat('34', rawRecord.AC_1),
      infoBy: this.lookupAndFormat('53', rawRecord.INFOBY),
      neighborhood: this.lookupAndFormat('VCS', rawRecord.VCS),
      
      // Condition handling (BRT's special case)
      exteriorCondition: this.lookupAndFormat('60', rawRecord.EXTERIORNC),
      interiorCondition: this.lookupAndFormat('60', rawRecord.INTERIORNC),
      
      // Valuation data
      landValue: rawRecord.VALUES_LANDTAXABLEVALUE,
      improvementValue: rawRecord.VALUES_IMPROVTAXABLEVALUE,
      totalValue: rawRecord.VALUES_NETTAXABLEVALUE,
      
      // Raw record for reference
      _raw: rawRecord,
      _vendor: 'BRT'
    };
    
    return normalized;
  }

  // Helper to lookup and format codes consistently
  lookupAndFormat(category, value) {
    const result = this.lookupCode(category, value);
    return result ? {
      code: result.code,
      description: result.description
    } : {
      code: value || '',
      description: null
    };
  }

  // Validate system configuration
  validateSystemConfig() {
    return {
      isValid: this.codeLookups.size > 0,
      totalCodes: this.codeLookups.size,
      categoriesLoaded: Array.from(this.codeLookups.keys())
        .map(k => k.split('_')[0])
        .filter((v, i, a) => a.indexOf(v) === i).length
    };
  }

  // Main processing pipeline for app integration
  async processBRTFiles(dataContent, codeContent) {
    const results = {
      success: false,
      codeProcessing: null,
      dataProcessing: null,
      validation: null,
      error: null
    };
    
    try {
      // Process code file
      results.codeProcessing = await this.processCodeFile(codeContent);
      if (!results.codeProcessing.success) {
        throw new Error(`Code processing failed: ${results.codeProcessing.error}`);
      }
      
      // Process data file
      results.dataProcessing = await this.processDataFile(dataContent);
      if (!results.dataProcessing.success) {
        throw new Error(`Data processing failed: ${results.dataProcessing.error}`);
      }
      
      // Validate system
      results.validation = this.validateSystemConfig();
      if (!results.validation.isValid) {
        throw new Error('System validation failed: No codes loaded');
      }
      
      results.success = true;
      return results;
      
    } catch (error) {
      results.error = error.message;
      return results;
    }
  }
}
