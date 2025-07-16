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
  normalizeRecord(rawRecord, vcsData, propertyRegion, jobYear, jobCCDD) {
    const normalized = {
      // ===== CORE IDENTIFIERS =====
      block: rawRecord.BLOCK,
      lot: rawRecord.LOT,
      qualifier: rawRecord.QUALIFIER,
      card: rawRecord.Card,
      propertyLocation: rawRecord.PROPERTY_LOCATION,
      propertyCompositeKey: `${jobYear}${jobCCDD}-${rawRecord.BLOCK}-${rawRecord.LOT}_${rawRecord.QUALIFIER || 'NONE'}-${rawRecord.Card || 'NONE'}-${rawRecord.PROPERTY_LOCATION || 'NONE'}`,
      
      // ===== OWNER NORMALIZED FIELDS =====
      ownerName: rawRecord.OWNER_OWNER,
      ownerStreet: rawRecord.OWNER_ADDRESS,
      ownerCsZ: this.calculateOwnerCsZ(rawRecord), // Combine city, state, zip
      
      // ===== PROPERTY NORMALIZED FIELDS =====
      propertyClass: rawRecord.PROPERTY_CLASS,
      propertyAdditionalLots: this.calculatePropertyAdditionalLots(rawRecord),
      propertyAddlCard: rawRecord.Card, // ADDED - BRT card field
      
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
