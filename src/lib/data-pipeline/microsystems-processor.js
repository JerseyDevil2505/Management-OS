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
            // Normalize codes to descriptions
            const normalizedProperty = this.normalizePropertyCodes(property);
            
            // Count lookup results
            Object.values(normalizedProperty.lookupResults || {}).forEach(result => {
              if (result.success) successfulLookups++;
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
   * Parse a single property record from Microsystems pipe-delimited format
   * Based on the interface structure we observed, extracts both direct-read 
   * fields and fields that need code lookup
   */
  parsePropertyRecord(line, recordNumber) {
    try {
      const parts = line.split('|');
      
      // Skip incomplete records or header lines
      if (parts.length < 10) return null;
      if (line.toLowerCase().includes('block|lot|qual')) return null;
      
      // Extract fields based on Microsystems data structure
      // NOTE: Field positions may need adjustment based on actual file format
      const property = {
        recordNumber,
        rawData: line,
        
        // ===== DIRECT READ FIELDS (use as-is) =====
        // Primary identifiers
        block: this.cleanValue(parts[0]),
        lot: this.cleanValue(parts[1]),
        qualifier: this.cleanValue(parts[2]),
        
        // Property details that don't need lookup
        yearBuilt: this.parseNumber(parts[3]),
        effectiveAge: this.parseNumber(parts[4]),
        storyHeight: this.parseDecimal(parts[5]), // Can be 1.5, 2.0, etc.
        livableArea: this.parseNumber(parts[6]),
        finishedBasementPercent: this.parsePercent(parts[7]),
        oldBaths: this.parseNumber(parts[8]),
        modernBaths: this.parseNumber(parts[9]),
        
        // Additional direct fields (adjust indices as needed)
        propertyClass: this.cleanValue(parts[10]),
        netPercent: this.parsePercent(parts[11]),
        
        // ===== CODE LOOKUP FIELDS (need translation) =====
        // Core property characteristics (500 series)
        style: this.cleanCode(parts[15]),           // 520 - Design/Style
        foundation: this.cleanCode(parts[16]),      // 550 - Foundation
        roofType: this.cleanCode(parts[17]),        // 540 - Roof Type
        roofMaterial: this.cleanCode(parts[18]),    // 545 - Roof Material
        exteriorFinish: this.cleanCode(parts[19]),  // 530 - Exterior Finish
        interiorWall: this.cleanCode(parts[20]),    // 555 - Interior Wall
        
        // Systems (560s and 8xx series)
        heatSource: this.cleanCode(parts[21]),      // 565 - Heat Source / 8xx
        acType: this.cleanCode(parts[22]),          // 8xx - Air Conditioning
        plumbing: this.cleanCode(parts[23]),        // 580 - Miscellaneous Plumbing
        
        // Built-ins and features
        builtIns1: this.cleanCode(parts[24]),       // 590 - Built Ins 1
        builtIns2: this.cleanCode(parts[25]),       // 591 - Built Ins 2
        
        // Property information and condition
        infoBy: this.cleanCode(parts[26]),          // 140 - Information By
        exteriorCondition: this.cleanCode(parts[27]), // 490 - Exterior Condition
        interiorCondition: this.cleanCode(parts[28]), // 491 - Interior Condition
        
        // VCS and classification
        vcsCode: this.cleanCode(parts[29]),         // 210 - VCS (Valuation Code System)
        landClass: this.cleanCode(parts[30]),       // 145 - Land Class
        typeAndUse: this.cleanCode(parts[31]),      // 500 - Type and Use
        
        // Detached items (680 series)
        detachedGarage: this.cleanCode(parts[32]),  // 680 - Detached Items
        shed: this.cleanCode(parts[33]),            // 680 - Detached Items
        pool: this.cleanCode(parts[34]),            // 680 - Detached Items
        
        // Additional fields that might be present
        topography: this.cleanCode(parts[35]),      // 115 - Topography
        roadType: this.cleanCode(parts[36]),        // 120 - Road
        curbing: this.cleanCode(parts[37]),         // 125 - Curbing (Y/N)
        sidewalk: this.cleanCode(parts[38]),        // 130 - Sidewalk (Y/N)
        utilities: this.cleanCode(parts[39])        // 135 - Utilities (Y/N)
      };
      
      // Remove undefined/null fields to keep data clean
      return this.cleanPropertyObject(property);
      
    } catch (error) {
      console.warn(`Error parsing property record ${recordNumber}: ${error.message}`);
      return null;
    }
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
   * Normalize property codes using lookup tables
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
