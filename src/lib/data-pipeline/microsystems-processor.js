/**
 * Complete normalizeRecord function for Microsystems Processor
 * Updated with YEARCCDD composite key support
 */
normalizeRecord(rawRecord, jobYear, jobCCDD) {
  const normalized = {
    // ===== CORE IDENTIFIERS =====
    block: rawRecord.block,
    lot: rawRecord.lot,
    qualifier: rawRecord.qualifier,
    card: rawRecord.building,
    propertyLocation: rawRecord.propertyLocation,
    propertyCompositeKey: `${jobYear}${jobCCDD}-${rawRecord.block}-${rawRecord.lot}_${rawRecord.qualifier || 'NONE'}-${rawRecord.building || 'NONE'}-${rawRecord.propertyLocation || 'NONE'}`,
    
    // ===== OWNER NORMALIZED FIELDS =====
    ownerName: rawRecord.ownerName,
    ownerStreet: rawRecord.ownerStreet,
    ownerCsZ: rawRecord.ownerCsz, // Combined city, state, zip
    
    // ===== PROPERTY NORMALIZED FIELDS =====
    propertyClass: rawRecord.propertyClass,
    propertyAdditionalLots: rawRecord.propertyAdditionalLots,
    propertyAddlCard: rawRecord.building, // ADDED - Microsystems building field
    
    // ===== VALUES NORMALIZED FIELDS =====
    valuesLand: rawRecord.valuesLand,
    valuesImprovement: rawRecord.valuesImprovement,
    valuesTotal: rawRecord.valuesTotal,
    
    // ===== SALES NORMALIZED FIELDS =====
    salesDate: rawRecord.salesDate,
    salesPrice: rawRecord.salesPrice,
    salesBook: rawRecord.salesBook,
    salesPage: rawRecord.salesPage,
    salesNu: rawRecord.salesNu,
    
    // ===== ASSET NORMALIZED FIELDS =====
    
    // Bathrooms (weighted calculation)
    assetTotalBaths: this.calculateTotalBaths(rawRecord),
    
    // Air Conditioning
    assetHasAirConditioning: this.calculateHasAirConditioning(rawRecord),
    assetTotalAcArea: this.calculateTotalAcArea(rawRecord),
    
    // Basement
    assetHasBasement: this.calculateHasBasement(rawRecord),
    assetHasFinishedBasement: this.calculateHasFinishedBasement(rawRecord),
    assetFinishedBasementArea: this.calculateFinishedBasementArea(rawRecord),
    
    // Building Materials & Systems
    assetExteriorFinishTypes: this.calculateExteriorFinishTypes(rawRecord),
    assetFoundationTypes: rawRecord.foundation,
    assetHeatSourceTypes: rawRecord.heatSource,
    
    // Fireplaces
    assetFireplaceCount: this.calculateFireplaceCount(rawRecord),
    assetHasFireplace: this.calculateHasFireplace(rawRecord),
    assetFireplaceTypes: this.calculateFireplaceTypes(rawRecord),
    
    // Porches, Decks & Patios
    assetOpenPorchArea: this.calculateOpenPorchArea(rawRecord),
    assetEnclosedPorchArea: this.calculateEnclosedPorchArea(rawRecord),
    assetDeckArea: this.calculateDeckArea(rawRecord),
    assetPatioArea: this.calculatePatioArea(rawRecord),
    
    // Detached Buildings
    assetDetachedBuildingTypes: this.calculateDetachedBuildingTypes(rawRecord),
    assetDetachedBuildingSizes: this.calculateDetachedBuildingSizes(rawRecord),
    
    // Lot Size
    assetLotSizeSquareFeet: this.calculateLotSizeSquareFeet(rawRecord),
    assetLotSizeAcres: this.calculateLotSizeAcres(rawRecord),
    assetLotDimensions: this.calculateLotDimensions(rawRecord),
    assetLotFrontage: this.calculateLotFrontage(rawRecord),
    assetLotDepth: this.calculateLotDepth(rawRecord),
    
    // Other Asset Fields
    assetYearBuilt: rawRecord.yearBuilt,
    assetStoryHeight: rawRecord.storyHeight,
    assetLivableArea: rawRecord.livableArea,
    
    // ===== METADATA =====
    _raw: rawRecord,
    _vendor: 'Microsystems'
  };
  
  return normalized;
}
