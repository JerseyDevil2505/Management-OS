/**
 * Microsystems Data Processor
 * Professional Property Appraisers Inc - Management OS
 * 
 * Processes Microsystems vendor files and normalizes data for the Management OS.
 * Handles field-specific code lookups and VCS (Valuation Code System) translations.
 */

class MicrosystemsProcessor {
  constructor() {
    this.systemConfig = {};
    this.fieldMappings = {};
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    this.hvacLookups = new Map();
    
    // Core field categories for property data
    this.fieldCategories = {
      // System configuration
      '0101': 'Town Name',
      '0201': 'County/District Code',
      
      // Property information
      '140': 'Information By',
      '145': 'Land Class',
      
      // Condition codes
      '490': 'Exterior Condition',
      '491': 'Interior Condition',
      
      // Core property characteristics (500 series - the big deal)
      '500': 'Type and Use',
      '510': 'Story Height',
      '520': 'Design and Style',
      '521': 'Design and Style (Redundant)',
      '530': 'Exterior Finish',
      '540': 'Roof Type',
      '545': 'Roof Material',
      '550': 'Foundation',
      '555': 'Interior Wall',
      '565': 'Heat Source',
      '580': 'Miscellaneous Plumbing',
      '590': 'Built Ins 1',
      '591': 'Built Ins 2',
      
      // Additional categories
      '680': 'Detached Items',
      
      // VCS (special handling)
      '210': 'VCS (Valuation Code System)'
    };
  }

  /**
   * Main entry point - processes Microsystems files and returns normalized data
   * @param {string|Buffer} dataFileContent - Content of the data file
   * @param {string|Buffer} codeFileContent - Content of the code file
   * @returns {Object} Normalized data ready for consumption
   */
  async processMicrosystemsData(dataFileContent, codeFileContent) {
    try {
      // Step 1: Process code file to build lookup tables
      const codeProcessResult = this.processCodeFile(codeFileContent);
      if (!codeProcessResult.success) {
        throw new Error(`Code file processing failed: ${codeProcessResult.error}`);
      }

      // Step 2: Validate system configuration
      const configValid = this.validateSystemConfig();
      if (!configValid.success) {
        throw new Error(`System configuration invalid: ${configValid.error}`);
      }

      // Step 3: Process data file
      const dataProcessResult = this.processDataFile(dataFileContent);
      if (!dataProcessResult.success) {
        throw new Error(`Data file processing failed: ${dataProcessResult.error}`);
      }

      // Step 4: Return normalized results
      return {
        success: true,
        systemConfig: this.systemConfig,
        properties: dataProcessResult.properties,
        stats: {
          totalProperties: dataProcessResult.properties.length,
          successfulLookups: dataProcessResult.stats.successfulLookups,
          failedLookups: dataProcessResult.stats.failedLookups,
          codeDefinitions: codeProcessResult.stats.totalDefinitions
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        systemConfig: this.systemConfig
      };
    }
  }

  /**
   * Process the code file to build lookup tables
   */
  processCodeFile(content) {
    try {
      const contentStr = content.toString();
      const lines = contentStr.split(/\r?\n/).filter(line => line.trim());
      
      let systemConfigCount = 0;
      let fieldMappingCount = 0;
      let codeDefinitionCount = 0;
      let vcsCount = 0;
      let hvacCount = 0;

      lines.forEach((line, index) => {
        try {
          const parts = line.split('|');
          if (parts.length < 2) return;
          
          const fullCode = parts[0].trim();
          const description = parts[1].trim();
          
          // System configuration codes
          if (fullCode.startsWith('0101')) {
            this.systemConfig.townName = description;
            systemConfigCount++;
          } else if (fullCode.startsWith('0201')) {
            this.systemConfig.districtCode = description;
            systemConfigCount++;
          }
          // Field mapping codes (990 series)
          else if (fullCode.startsWith('990')) {
            const fieldNumber = fullCode.replace('990', '').replace(/\s+9999$/, '');
            this.fieldMappings[fieldNumber] = description;
            fieldMappingCount++;
          }
          // VCS codes (210 series) - special cascading structure
          else if (fullCode.startsWith('210')) {
            const vcsMatch = fullCode.match(/210([A-Z0-9]+)(\d+)/);
            if (vcsMatch) {
              const vcsCode = vcsMatch[1];
              // Only store first instance of each VCS code (ignore rate cascading)
              if (!this.vcsLookups.has(vcsCode)) {
                this.vcsLookups.set(vcsCode, description);
                vcsCount++;
              }
            }
          }
          // HVAC codes (8xx series)
          else if (fullCode.match(/^8[0-9]/)) {
            const cleanCode = this.extractCleanCode(fullCode);
            if (cleanCode) {
              // Extract just the suffix for HVAC lookup
              const hvacSuffix = cleanCode.replace(/^8[0-9]*/, '');
              if (hvacSuffix) {
                this.hvacLookups.set(hvacSuffix, description);
                hvacCount++;
              }
            }
          }
          // Regular field codes
          else {
            const fieldPrefix = fullCode.substring(0, 3);
            if (this.fieldCategories[fieldPrefix]) {
              this.codeLookups.set(fullCode, description);
              codeDefinitionCount++;
            }
          }
          
        } catch (error) {
          // Skip malformed lines but don't fail entire process
          console.warn(`Warning: Error processing code line ${index + 1}: ${error.message}`);
        }
      });

      return {
        success: true,
        stats: {
          systemConfig: systemConfigCount,
          fieldMappings: fieldMappingCount,
          vcsDefinitions: vcsCount,
          hvacDefinitions: hvacCount,
          codeDefinitions: codeDefinitionCount,
          totalDefinitions: systemConfigCount + fieldMappingCount + vcsCount + hvacCount + codeDefinitionCount
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate required system configuration
   */
  validateSystemConfig() {
    if (!this.systemConfig.townName || !this.systemConfig.districtCode) {
      return {
        success: false,
        error: 'Missing required system configuration (town name or district code)'
      };
    }
    return { success: true };
  }

  /**
   * Process the data file and normalize property records
   */
  processDataFile(content) {
    try {
      const contentStr = content.toString();
      const lines = contentStr.split(/\r?\n/).filter(line => line.trim());
      
      const properties = [];
      let successfulLookups = 0;
      let failedLookups = 0;

      lines.forEach((line, index) => {
        try {
          // Parse property record (format depends on actual data structure)
          const property = this.parsePropertyRecord(line, index + 1);
          if (property) {
            // UPDATED: Use new normalizeRecord function instead of normalizePropertyCodes
            const normalizedProperty = this.normalizeRecord(property);
            
            // Count lookup results for legacy compatibility
            const lookupResults = this.getLookupResultsForStats(normalizedProperty);
            Object.values(lookupResults).forEach(result => {
              if (result.description) successfulLookups++;
              else failedLookups++;
            });

            properties.push(normalizedProperty);
          }
        } catch (error) {
          console.warn(`Warning: Error processing property record ${index + 1}: ${error.message}`);
        }
      });

      return {
        success: true,
        properties,
        stats: {
          successfulLookups,
          failedLookups,
          totalRecords: properties.length
        }
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Helper to generate lookup stats from normalized property
   */
  getLookupResultsForStats(normalizedProperty) {
    return {
      typeUse: normalizedProperty.typeUse,
      designStyle: normalizedProperty.designStyle,
      foundation: normalizedProperty.foundation,
      heatSource: normalizedProperty.heatSource,
      infoBy: normalizedProperty.infoBy,
      neighborhood: normalizedProperty.neighborhood
    };
  }

  /**
   * Parse a single property record from Microsystems pipe-delimited format
   * Based on the actual file structure with 600+ fields
   */
  parsePropertyRecord(line, recordNumber) {
    try {
      const parts = line.split('|');
      
      // Skip incomplete records or header lines
      if (parts.length < 50) return null;
      if (line.toLowerCase().includes('block|lot|qual')) return null;
      
      // Extract fields based on actual Microsystems data structure
      const property = {
        recordNumber,
        rawData: line,
        
        // ===== DIRECT READ FIELDS (use as-is) =====
        // Primary identifiers (positions 0-3)
        block: this.cleanValue(parts[0]),
        lot: this.cleanValue(parts[1]),
        qualifier: this.cleanValue(parts[2]),
        building: this.cleanValue(parts[3]),
        
        // Location and ownership (positions 5-8)
        location: this.cleanValue(parts[5]),
        ownerName: this.cleanValue(parts[6]),
        ownerStreet: this.cleanValue(parts[7]),
        ownerCsz: this.cleanValue(parts[8]),
        
        // Property classification (position 9)
        propertyClass: this.cleanValue(parts[9]),
        
        // Values (positions 10, 15, 16)
        landValue: this.parseNumber(parts[10]),
        totalValue: this.parseNumber(parts[15]),
        improvementValue: this.parseNumber(parts[16]),
        
        // Sale information (positions 18-22)
        saleDate: this.cleanValue(parts[18]),
        salePrice: this.parseNumber(parts[21]),
        
        // Property details that don't need lookup
        yearBuilt: this.parseNumber(parts[108]),        // Year Built
        effectiveAge: this.parseNumber(parts[271]),     // Effective Age  
        storyHeight: this.parseDecimal(parts[109]),     // Story Height
        livableArea: this.parseNumber(parts[279]),      // Livable Area (near end)
        
        // Additional measurements
        basementSf: this.parseNumber(parts[122]),       // Bsmt Living Sf
        finishedBasementPercent: this.parsePercent(parts[120]), // Bsmt Finish (Y/N becomes %)
        
        // Bath counts
        modernBaths: this.parseNumber(parts[101]),      // Num Modern Baths
        oldBaths: this.parseNumber(parts[103]),         // Num Old Baths
        
        // ===== CODE LOOKUP FIELDS (need translation) =====
        // Core property characteristics
        style: this.cleanCode(parts[70]),               // Style Code
        foundation: this.cleanCode(parts[113]),         // Foundation
        roofType: this.cleanCode(parts[115]),           // Roof Type
        roofMaterial: this.cleanCode(parts[114]),       // Roof Material
        exteriorFinish1: this.cleanCode(parts[110]),    // Exterior Finish 1
        exteriorFinish2: this.cleanCode(parts[111]),    // Exterior Finish 2
        interiorWall: this.cleanCode(parts[555]),       // Interior Wall (field 555)
        
        // Systems and heating
        heatSource: this.cleanCode(parts[126]),         // Heat Source
        heatSystemType1: this.cleanCode(parts[123]),    // Heat System Type1
        acType: this.cleanCode(parts[127]),             // Air Cond Type
        
        // Condition and information
        condition: this.cleanCode(parts[96]),           // Condition
        exteriorCondition: this.cleanCode(parts[490]),  // Exterior Condition (if exists)
        infoBy: this.cleanCode(parts[94]),              // Information By
        
        // Property type and use
        typeAndUse: this.cleanCode(parts[107]),         // Type Use Code
        
        // Site features (from your code file examples)
        roadType: this.cleanCode(parts[427]),           // Road (near end of record)
        curbing: this.cleanCode(parts[429]),            // Curbs Yn
        sidewalk: this.cleanCode(parts[430]),           // Sidewalk Yn
        utilities: this.cleanCode(parts[432]),          // Gas Yn, Water Y N, etc.
        
        // VCS and zoning
        vcsCode: this.cleanCode(parts[436]),            // VCS
        neighborhood: this.cleanCode(parts[435]),       // Neighborhood
        
        // Quality codes
        buildingQualClass: this.cleanCode(parts[106]),  // Bldg Qual Class Code
        basementFinishQuality: this.cleanCode(parts[121]), // Bsmt Finish Quality
        
        // Additional features
        fireplace1Story: this.cleanCode(parts[149]),    // Fireplace 1 Story Stack
        porchQuality: this.cleanCode(parts[112]),       // Porch Quality
        deckQuality: this.cleanCode(parts[168]),        // Deck Quality
        
        // Detached items
        detachedItemCode1: this.cleanCode(parts[208]),  // Detached Item Code1
        detachedItemCode2: this.cleanCode(parts[221]),  // Detached Item Code2
        detachedItemCode3: this.cleanCode(parts[234]),  // Detached Item Code3
        detachedItemCode4: this.cleanCode(parts[247])   // Detached Item Code4
      };
      
      // Remove undefined/null fields to keep data clean
      return this.cleanPropertyObject(property);
      
    } catch (error) {
      console.warn(`Error parsing property record ${recordNumber}: ${error.message}`);
      return null;
    }
  }

  /**
   * Normalize Microsystems record to standard format (matches BRT output)
   * This ensures both vendors produce identical data structures for modules
   */
  normalizeRecord(rawRecord) {
    const normalized = {
      // Core identification
      block: rawRecord.block,
      lot: rawRecord.lot,
      qualifier: rawRecord.qualifier,
      
      // Property details with code lookups
      typeUse: this.lookupAndFormat('500', rawRecord.typeAndUse),
      storyHeight: this.lookupAndFormat('510', rawRecord.storyHeight?.toString()),
      designStyle: this.lookupAndFormat('520', rawRecord.style),
      roofType: this.lookupAndFormat('540', rawRecord.roofType),
      roofMaterial: this.lookupAndFormat('545', rawRecord.roofMaterial),
      exteriorFinish: this.lookupAndFormat('530', rawRecord.exteriorFinish1),
      foundation: this.lookupAndFormat('550', rawRecord.foundation),
      interiorWall: this.lookupAndFormat('555', rawRecord.interiorWall),
      basement: this.formatBasementData(rawRecord), // Custom formatter for basement data
      heatSource: this.lookupAndFormat('565', rawRecord.heatSource),
      heatSystem: this.lookupAndFormat('8XX', rawRecord.heatSystemType1), // HVAC lookup
      airConditioning: this.lookupAndFormat('8XX', rawRecord.acType),
      infoBy: this.lookupAndFormat('140', rawRecord.infoBy),
      neighborhood: this.lookupAndFormat('210', rawRecord.vcsCode), // VCS lookup
      
      // Condition handling (separate fields like BRT)
      exteriorCondition: this.lookupAndFormat('490', rawRecord.exteriorCondition || rawRecord.condition),
      interiorCondition: this.lookupAndFormat('491', rawRecord.interiorCondition || rawRecord.condition),
      
      // Valuation data (convert to match BRT field names)
      landValue: rawRecord.landValue,
      improvementValue: rawRecord.improvementValue,
      totalValue: rawRecord.totalValue,
      
      // Additional Microsystems-specific data
      yearBuilt: rawRecord.yearBuilt,
      livableArea: rawRecord.livableArea,
      propertyClass: rawRecord.propertyClass,
      saleDate: rawRecord.saleDate,
      salePrice: rawRecord.salePrice,
      
      // Raw record for reference
      _raw: rawRecord,
      _vendor: 'Microsystems'
    };
    
    return normalized;
  }

  /**
   * Helper to lookup and format codes consistently (matches BRT format)
   */
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

  /**
   * Format basement data to match BRT structure
   * Microsystems stores basement differently than BRT
   */
  formatBasementData(rawRecord) {
    // Microsystems has basementSf and finishedBasementPercent
    // Convert to BRT-style finished/unfinished classification
    if (rawRecord.basementSf && rawRecord.basementSf > 0) {
      if (rawRecord.finishedBasementPercent && rawRecord.finishedBasementPercent > 0) {
        return {
          code: 'FINISHED',
          description: `Finished Basement (${rawRecord.finishedBasementPercent}%)`
        };
      } else {
        return {
          code: 'UNFINISHED',
          description: 'Unfinished Basement'
        };
      }
    }
    return {
      code: '',
      description: null
    };
  }

  /**
   * Clean and validate a single field value
   */
  cleanValue(value) {
    if (!value) return null;
    const cleaned = value.trim();
    return cleaned === '' ? null : cleaned;
  }

  /**
   * Clean and format a code value (uppercase, trim)
   */
  cleanCode(value) {
    if (!value) return null;
    const cleaned = value.trim().toUpperCase();
    return cleaned === '' ? null : cleaned;
  }

  /**
   * Parse numeric values safely
   */
  parseNumber(value) {
    if (!value) return null;
    const cleaned = value.trim();
    if (cleaned === '') return null;
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? null : num;
  }

  /**
   * Parse decimal values (for story height like 1.5)
   */
  parseDecimal(value) {
    if (!value) return null;
    const cleaned = value.trim();
    if (cleaned === '') return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * Parse percentage values (remove % sign if present)
   */
  parsePercent(value) {
    if (!value) return null;
    const cleaned = value.trim().replace('%', '');
    if (cleaned === '') return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * Remove null/undefined fields from property object
   */
  cleanPropertyObject(property) {
    const cleaned = {};
    for (const [key, value] of Object.entries(property)) {
      if (value !== null && value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  /**
   * Normalize property codes using lookup tables (LEGACY - kept for compatibility)
   */
  normalizePropertyCodes(property) {
    const lookupResults = {};
    const normalizedData = { ...property };

    // Define field mappings for normalization
    const fieldMappings = [
      { field: 'style', category: '520', name: 'Design/Style' },
      { field: 'foundation', category: '550', name: 'Foundation' },
      { field: 'roofType', category: '540', name: 'Roof Type' },
      { field: 'heatSource', category: '565', name: 'Heat Source' },
      { field: 'infoBy', category: '140', name: 'Information By' },
      { field: 'vcsCode', category: '210', name: 'VCS' },
      { field: 'exteriorCondition', category: '490', name: 'Exterior Condition' },
      { field: 'interiorCondition', category: '491', name: 'Interior Condition' }
    ];

    fieldMappings.forEach(mapping => {
      const rawValue = property[mapping.field];
      if (rawValue && rawValue.trim() !== '') {
        const lookupResult = this.lookupCode(mapping.category, rawValue);
        
        if (lookupResult) {
          normalizedData[`${mapping.field}Description`] = lookupResult.description;
          lookupResults[mapping.field] = {
            success: true,
            category: lookupResult.category,
            code: rawValue,
            description: lookupResult.description
          };
        } else {
          normalizedData[`${mapping.field}Description`] = `[${rawValue}] - Definition not found`;
          lookupResults[mapping.field] = {
            success: false,
            category: mapping.name,
            code: rawValue,
            error: 'Code not found in lookup tables'
          };
        }
      }
    });

    normalizedData.lookupResults = lookupResults;
    return normalizedData;
  }

  /**
   * Lookup code with field-specific validation
   */
  lookupCode(fieldCategory, dataValue) {
    if (!dataValue || dataValue.trim() === '') {
      return null;
    }
    
    const cleanValue = dataValue.trim().toUpperCase();
    
    // Handle VCS lookup specially (210 series)
    if (fieldCategory === '210') {
      const description = this.vcsLookups.get(cleanValue);
      return description ? { 
        code: cleanValue, 
        description, 
        category: 'VCS' 
      } : null;
    }
    
    // Handle HVAC codes (8xx series)
    if (fieldCategory.startsWith('8') || ['565'].includes(fieldCategory)) {
      const description = this.hvacLookups.get(cleanValue);
      return description ? { 
        code: cleanValue, 
        description, 
        category: 'HVAC' 
      } : null;
    }
    
    // Handle regular field codes
    const fullCodeToFind = `${fieldCategory}${cleanValue}`;
    
    // Try exact match first
    for (const [storedCode, description] of this.codeLookups) {
      if (storedCode === fullCodeToFind || storedCode.startsWith(fullCodeToFind)) {
        return { 
          code: cleanValue, 
          description, 
          category: this.fieldCategories[fieldCategory] || fieldCategory 
        };
      }
    }
    
    return null;
  }

  /**
   * Extract clean code from full code field (remove spaces and 9999)
   */
  extractCleanCode(fullCode) {
    return fullCode.replace(/\s+9999$/, '').trim();
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      systemConfig: this.systemConfig,
      fieldCategories: Object.keys(this.fieldCategories).length,
      codeDefinitions: this.codeLookups.size,
      vcsDefinitions: this.vcsLookups.size,
      hvacDefinitions: this.hvacLookups.size,
      fieldMappings: Object.keys(this.fieldMappings).length
    };
  }
}

/**
 * Convenience function for processing Microsystems files
 * @param {string|Buffer} dataFileContent - Content of the data file
 * @param {string|Buffer} codeFileContent - Content of the code file
 * @returns {Promise<Object>} Processing results
 */
export async function processMicrosystems(dataFileContent, codeFileContent) {
  const processor = new MicrosystemsProcessor();
  return await processor.processMicrosystemsData(dataFileContent, codeFileContent);
}

/**
 * Detect if files are Microsystems format
 * @param {string} filename - Name of the file
 * @param {string} content - Content preview (first few lines)
 * @returns {boolean} True if likely Microsystems format
 */
export function isMicrosystemsFormat(filename, content) {
  const name = filename.toLowerCase();
  
  // Check filename patterns
  if (name.includes('microsystem')) return true;
  
  // Check content patterns
  if (content.includes('Block|Lot|Qual')) return true;
  if (content.includes('Code|Desc|Rate|Constant')) return true;
  
  return false;
}

export default MicrosystemsProcessor;
