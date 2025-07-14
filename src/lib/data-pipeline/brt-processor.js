/**
 * Complete BRT Processor with ALL normalized mappings
 * Matches Microsystems output structure for vendor-agnostic consumption
 */

export class BRTProcessor {
  constructor() {
    this.systemConfig = {};
    this.fieldMappings = {};
    this.codeLookups = new Map();
    this.vcsLookups = new Map();
    
    // BRT category mappings to normalized interface fields
    this.categoryMappings = {
      '21': 'Type and Use',
      '22': 'Story Height',
      '23': 'Design and Style',
      '24': 'Roof Type',
      '25': 'Roof Material',
      '26': 'Exterior Finish',
      '27': 'Foundation',
      '28': 'Interior Wall',
      '30': 'Basement',
      '31': 'Heat Source',
      '32': 'Heat System',
      '34': 'Air Conditioning',
      '53': 'InfoBy',
      '60': 'Condition',
      '62': 'Positive Land Adj',
      '63': 'Negative Land Adj',
      'VCS': 'Neighborhood'
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
      'Condition': 'EXTERIORNC'
    };
  }

  // ... existing methods (detectFileType, processCodeFile, etc.) ...

  /**
   * Complete normalizeRecord function with ALL normalized fields
   * Produces identical structure to Microsystems processor
   */
  normalizeRecord(rawRecord, vcsData, propertyRegion) {
    const normalized = {
      // ===== CORE IDENTIFIERS =====
      block: rawRecord.BLOCK,
      lot: rawRecord.LOT,
      qualifier: rawRecord.QUALIFIER,
      
      // ===== OWNER NORMALIZED FIELDS =====
      ownerName: rawRecord.OWNER_OWNER,
      ownerStreet: rawRecord.OWNER_ADDRESS,
      ownerCsZ: this.calculateOwnerCsZ(rawRecord), // Combine city, state, zip
      
      // ===== PROPERTY NORMALIZED FIELDS =====
      propertyLocation: rawRecord.PROPERTY_LOCATION,
      propertyClass: rawRecord.PROPERTY_CLASS,
      propertyAdditionalLots: this.calculatePropertyAdditionalLots(rawRecord),
      
      // ===== VALUES NORMALIZED FIELDS =====
      valuesLand: rawRecord.VALUES_LANDTAXABLEVALUE,
      valuesImprovement: rawRecord.VALUES_IMPROVTAXABLEVALUE,
      valuesTotal: rawRecord.VALUES_NETTAXABLEVALUE,
      
      // ===== SALES NORMALIZED FIELDS =====
      salesDate: rawRecord.CURRENTSALE_DATE,
      salesPrice: rawRecord.CURRENTSALE_PRICE,
      salesBook: rawRecord.CURRENTSALE_DEEDBOOK,
      salesPage: rawRecord.CURRENTSALE_DEEDPAGE,
      salesNu: rawRecord.CURRENTSALE_NUC,
      
      // ===== ASSET NORMALIZED FIELDS =====
      
      // Bathrooms (weighted calculation)
      assetTotalBaths: this.calculateTotalBaths(rawRecord),
      
      // Air Conditioning
      assetHasAirConditioning: this.calculateHasAirConditioning(rawRecord),
      assetTotalAcArea: this.calculateTotalAcArea(rawRecord),
      
      // Basement
      assetHasBasement: this.calculateHasBasement(rawRecord),
      assetHasFinishedBasement: this.calculateHasFinishedBasement(rawRecord, vcsData, propertyRegion),
      assetFinishedBasementArea: this.calculateFinishedBasementArea(rawRecord, vcsData, propertyRegion),
      
      // Building Materials & Systems
      assetExteriorFinishTypes: this.calculateExteriorFinishTypes(rawRecord),
      assetFloorFinishTypes: this.calculateFloorFinishTypes(rawRecord), // BRT only
      assetFoundationTypes: this.calculateFoundationTypes(rawRecord),
      assetHeatSourceTypes: this.calculateHeatSourceTypes(rawRecord),
      
      // Fireplaces
      assetFireplaceCount: this.calculateFireplaceCount(rawRecord),
      assetHasFireplace: this.calculateHasFireplace(rawRecord),
      assetFireplaceTypes: this.calculateFireplaceTypes(rawRecord),
      
      // Porches, Decks & Patios
      assetOpenPorchArea: this.calculateOpenPorchArea(rawRecord, vcsData, propertyRegion),
      assetEnclosedPorchArea: this.calculateEnclosedPorchArea(rawRecord, vcsData, propertyRegion),
      assetDeckArea: this.calculateDeckArea(rawRecord, vcsData, propertyRegion),
      assetPatioArea: this.calculatePatioArea(rawRecord, vcsData, propertyRegion),
      
      // Detached Buildings
      assetDetachedBuildingTypes: this.calculateDetachedBuildingTypes(rawRecord),
      assetDetachedBuildingSizes: this.calculateDetachedBuildingSizes(rawRecord),
      
      // Lot Size (complex FF vs UR methods)
      assetLotSizeSquareFeet: this.calculateLotSizeSquareFeet(rawRecord, vcsData, propertyRegion),
      assetLotSizeAcres: this.calculateLotSizeAcres(rawRecord, vcsData, propertyRegion),
      assetLotDimensions: this.calculateLotDimensions(rawRecord),
      assetLotFrontage: this.calculateLotFrontage(rawRecord),
      assetLotDepth: this.calculateLotDepth(rawRecord),
      
      // Other Asset Fields
      assetYearBuilt: rawRecord.YEARBUILT,
      assetStoryHeight: rawRecord.STORYHGT,
      assetLivableArea: rawRecord.SFLA_TOTAL,
      
      // ===== LEGACY FIELDS (for backward compatibility) =====
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
      exteriorCondition: this.lookupAndFormat('60', rawRecord.EXTERIORNC),
      interiorCondition: this.lookupAndFormat('60', rawRecord.INTERIORNC),
      
      // ===== METADATA =====
      _raw: rawRecord,
      _vendor: 'BRT'
    };
    
    return normalized;
  }

  // ===== CALCULATION METHODS =====

  // OWNER FIELD CALCULATIONS
  calculateOwnerCsZ(record) {
    const cityState = record.OWNER_CITYSTATE || '';
    const zip = record.OWNER_ZIP || '';
    return cityState && zip ? `${cityState} ${zip}` : (cityState || zip || null);
  }

  // PROPERTY FIELD CALCULATIONS  
  calculatePropertyAdditionalLots(record) {
    const lot1 = record.PROPERTY_ADDITIONALLOT1;
    const lot2 = record.PROPERTY_ADDITIONALLOT2;
    const lots = [lot1, lot2].filter(Boolean);
    return lots.length > 0 ? lots.join(', ') : null;
  }

  // BATHROOM CALCULATIONS
  calculateTotalBaths(record) {
    const twoFix = parseInt(record.PLUMBING2FIX) || 0;
    const threeFix = parseInt(record.PLUMBING3FIX) || 0;
    const fourFix = parseInt(record.PLUMBING4FIX) || 0;
    const fiveFix = parseInt(record.PLUMBING5FIX) || 0;
    const sixFix = parseInt(record.PLUMBING6FIX) || 0;
    
    return (twoFix * 0.5) + threeFix + fourFix + fiveFix + sixFix;
  }

  // AIR CONDITIONING CALCULATIONS
  calculateHasAirConditioning(record) {
    return !!(record.AC_1 || record.AC_2);
  }

  calculateTotalAcArea(record) {
    const area1 = parseInt(record.ACAREA_1) || 0;
    const area2 = parseInt(record.ACAREA_2) || 0;
    return area1 + area2;
  }

  // BASEMENT CALCULATIONS
  calculateHasBasement(record) {
    return (parseInt(record.FLA_BSMNT) || 0) > 0;
  }

  calculateHasFinishedBasement(record, vcsData, propertyRegion) {
    // Check if any basement finish codes indicate finished types
    const finish1 = record.BSMNTFINISH_1;
    const finish2 = record.BSMNTFINISH_2;
    
    // TODO: Lookup finish codes in VCS to determine if they're "finished" types
    // For now, assume any non-empty finish code indicates finished basement
    return !!(finish1 || finish2);
  }

  calculateFinishedBasementArea(record, vcsData, propertyRegion) {
    const area1 = parseInt(record.BSMNTFINISHAREA_1) || 0;
    const area2 = parseInt(record.BSMNTFINISHAREA_2) || 0;
    const totalArea = area1 + area2;
    
    // If areas are percentages, convert using basement floor area
    const basementFloorArea = parseInt(record.FLA_BSMNT) || 0;
    if (totalArea > 0 && totalArea <= 100 && basementFloorArea > 0) {
      // Assume it's a percentage
      return Math.round((totalArea / 100) * basementFloorArea);
    }
    
    return totalArea;
  }

  // BUILDING MATERIALS CALCULATIONS
  calculateExteriorFinishTypes(record) {
    const types = [
      record.EXTERIORFINISH_1,
      record.EXTERIORFINISH_2,
      record.EXTERIORFINISH_3
    ].filter(Boolean);
    return types;
  }

  calculateFloorFinishTypes(record) {
    // BRT only field
    const types = [record.FLOORFIN_1, record.FLOORFIN_2].filter(Boolean);
    return types;
  }

  calculateFoundationTypes(record) {
    const types = [record.FOUNDATION_1, record.FOUNDATION_2].filter(Boolean);
    return types;
  }

  calculateHeatSourceTypes(record) {
    const types = [record.HEATSRC_1, record.HEATSRC_2].filter(Boolean);
    return types;
  }

  // FIREPLACE CALCULATIONS
  calculateFireplaceCount(record) {
    const count1 = parseInt(record.FIREPLACECNT_1) || 0;
    const count2 = parseInt(record.FIREPLACECNT_2) || 0;
    return count1 + count2;
  }

  calculateHasFireplace(record) {
    return this.calculateFireplaceCount(record) > 0;
  }

  calculateFireplaceTypes(record) {
    const types = [record.FIREPLACE_1, record.FIREPLACE_2].filter(Boolean);
    return types;
  }

  // PORCH, DECK, PATIO CALCULATIONS (require VCS code lookup)
  calculateOpenPorchArea(record, vcsData, propertyRegion) {
    return this.calculateAttachedAreaByType(record, vcsData, propertyRegion, ['Open Porch', 'Built-in Open Porch']);
  }

  calculateEnclosedPorchArea(record, vcsData, propertyRegion) {
    return this.calculateAttachedAreaByType(record, vcsData, propertyRegion, ['Enclosed Porch', 'Built-in Enclosed Porch']);
  }

  calculateDeckArea(record, vcsData, propertyRegion) {
    return this.calculateAttachedAreaByType(record, vcsData, propertyRegion, ['Deck']);
  }

  calculatePatioArea(record, vcsData, propertyRegion) {
    return this.calculateAttachedAreaByType(record, vcsData, propertyRegion, ['Patio', 'Brick Patio', 'Stone Patio', 'Flag Patio']);
  }

  // Helper method for attached building area calculation
  calculateAttachedAreaByType(record, vcsData, propertyRegion, targetTypes) {
    let totalArea = 0;
    
    for (let i = 1; i <= 15; i++) {
      const code = record[`ATTACHEDCODE_${i}`];
      const area = parseInt(record[`ATTACHEDAREA_${i}`]) || 0;
      
      if (code && area > 0) {
        // TODO: Lookup code in VCS to get description
        const description = this.lookupVCSAttachedCode(code, vcsData, propertyRegion);
        
        if (targetTypes.some(type => description && description.toLowerCase().includes(type.toLowerCase()))) {
          totalArea += area;
        }
      }
    }
    
    return totalArea;
  }

  // DETACHED BUILDING CALCULATIONS
  calculateDetachedBuildingTypes(record) {
    const types = [];
    for (let i = 1; i <= 11; i++) {
      const code = record[`DETACHEDCODE_${i}`];
      if (code) {
        types.push(code);
      }
    }
    return types;
  }

  calculateDetachedBuildingSizes(record) {
    const sizes = [];
    
    for (let i = 1; i <= 11; i++) {
      const sizeStr = record[`DETACHEDDCSIZE_${i}`] || record[`DETACHEDSIZE_${i}`];
      
      if (sizeStr) {
        let area = 0;
        
        // Parse "10x12" format or direct square footage
        if (sizeStr.includes('x') || sizeStr.includes('X')) {
          const parts = sizeStr.split(/[xX]/).map(p => parseInt(p.trim()));
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            area = parts[0] * parts[1];
          }
        } else {
          // Direct square footage
          area = parseInt(sizeStr) || 0;
        }
        
        if (area > 0) {
          sizes.push(area);
        }
      }
    }
    
    return sizes;
  }

  // LOT SIZE CALCULATIONS (complex FF vs UR methods)
  calculateLotSizeSquareFeet(record, vcsData, propertyRegion) {
    // Method 1: Front Footage calculation
    const ffResult = this.calculateLotSizeFF(record);
    
    // Method 2: Unit Rate calculation (requires VCS lookup)
    const urResult = this.calculateLotSizeUR(record, vcsData, propertyRegion);
    
    // Priority: Use UR method if available, fallback to FF method
    return urResult > 0 ? urResult : ffResult;
  }

  calculateLotSizeFF(record) {
    const totalFrontage = this.calculateLotFrontage(record);
    const avgDepth = this.calculateLotDepth(record);
    
    if (totalFrontage > 0 && avgDepth > 0) {
      return totalFrontage * avgDepth;
    }
    return 0;
  }

  calculateLotSizeUR(record, vcsData, propertyRegion) {
    let totalAreaSf = 0;
    
    for (let i = 1; i <= 6; i++) {
      const units = parseFloat(record[`LANDUR_${i}`]) || 0;
      const unitType = record[`LANDURUNITS_${i}`] || '';
      const landCode = record[`LANDUR_${i}`]; // The code itself
      
      if (units > 0 && landCode) {
        // Lookup code description in VCS data
        const description = this.lookupLandUnitDescription(landCode, propertyRegion, vcsData);
        const isNotSiteValue = description && description.toUpperCase() !== 'SITE VALUE';
        
        if (isNotSiteValue) {
          let segmentAreaSf = units;
          
          // Convert to square feet if units are in acres
          if (unitType.toLowerCase().includes('acre') || (description && description.toLowerCase().includes('ac'))) {
            segmentAreaSf = units * 43560;
          }
          
          totalAreaSf += segmentAreaSf;
        }
      }
    }
    
    return totalAreaSf;
  }

  calculateLotSizeAcres(record, vcsData, propertyRegion) {
    const sqft = this.calculateLotSizeSquareFeet(record, vcsData, propertyRegion);
    return sqft > 0 ? sqft / 43560 : null;
  }

  calculateLotFrontage(record) {
    let totalFrontage = 0;
    for (let i = 1; i <= 6; i++) {
      const ff = parseFloat(record[`LANDFF_${i}`]) || 0;
      totalFrontage += ff;
    }
    return totalFrontage > 0 ? totalFrontage : null;
  }

  calculateLotDepth(record) {
    const depths = [];
    for (let i = 1; i <= 6; i++) {
      const depth = parseFloat(record[`LANDAVGDEP_${i}`]) || 0;
      if (depth > 0) depths.push(depth);
    }
    return depths.length > 0 ? depths.reduce((sum, d) => sum + d, 0) / depths.length : null;
  }

  calculateLotDimensions(record) {
    const frontage = this.calculateLotFrontage(record);
    const depth = this.calculateLotDepth(record);
    
    if (frontage > 0 && depth > 0) {
      return `${frontage} x ${depth}`;
    }
    return null;
  }

  // ===== VCS LOOKUP HELPER METHODS =====

  lookupLandUnitDescription(landCode, region, vcsData) {
    try {
      // Navigate: VCS[region].MAP.URC.MAP[code].MAP.DESC.DATA.VALUE
      const regionData = vcsData[region];
      if (!regionData?.MAP?.URC?.MAP) return '';
      
      const codeData = regionData.MAP.URC.MAP[landCode];
      if (!codeData?.MAP) return '';
      
      // DESC is typically at position 1 in the MAP
      const descData = codeData.MAP['1'];
      return descData?.DATA?.VALUE || '';
    } catch (error) {
      console.warn(`VCS lookup failed for land code ${landCode} in region ${region}:`, error);
      return '';
    }
  }

  lookupVCSAttachedCode(code, vcsData, propertyRegion) {
    // TODO: Implement VCS lookup for attached building codes
    // This would follow similar pattern to land unit lookup but for attached building codes
    return ''; // Placeholder
  }

  // ===== EXISTING METHODS (preserved for compatibility) =====
  
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

  // ... rest of existing methods (detectFileType, processCodeFile, etc.) ...
}
