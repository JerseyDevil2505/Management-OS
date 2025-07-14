/**
 * Complete normalizeRecord function for Microsystems Processor
 * Includes ALL normalized mappings from CSV + new fireplace/lot/bathroom fields
 */

/**
 * Updated parsePropertyRecord - Extract ALL fields needed for normalization
 */
parsePropertyRecord(line, recordNumber) {
  try {
    const parts = line.split('|');
    
    if (parts.length < 50) return null;
    if (line.toLowerCase().includes('block|lot|qual')) return null;
    
    const property = {
      recordNumber,
      rawData: line,
      
      // ===== CORE IDENTIFIERS =====
      block: this.cleanValue(parts[0]),
      lot: this.cleanValue(parts[1]),
      qualifier: this.cleanValue(parts[2]),
      building: this.cleanValue(parts[3]),
      
      // ===== OWNER FIELDS =====
      ownerName: this.cleanValue(parts[6]),
      ownerStreet: this.cleanValue(parts[7]),
      ownerCsz: this.cleanValue(parts[8]),
      
      // ===== PROPERTY FIELDS =====
      propertyLocation: this.cleanValue(parts[5]),
      propertyClass: this.cleanValue(parts[9]),
      propertyAdditionalLots: this.cleanValue(parts[4]),
      
      // ===== VALUES FIELDS =====
      valuesLand: this.parseNumber(parts[10]),
      valuesImprovement: this.parseNumber(parts[16]),
      valuesTotal: this.parseNumber(parts[15]),
      
      // ===== SALES FIELDS =====
      salesDate: this.cleanValue(parts[18]),
      salesPrice: this.parseNumber(parts[21]),
      salesBook: this.cleanValue(parts[19]),
      salesPage: this.cleanValue(parts[20]),
      salesNu: this.cleanValue(parts[22]),
      
      // ===== ASSET FIELDS - BATHROOMS =====
      twoFixtureBath: this.parseNumber(parts[100]),      // 2FixtureBath
      threeFixtureBath: this.parseNumber(parts[101]),    // 3FixtureBath  
      fourFixtureBath: this.parseNumber(parts[102]),     // 4FixtureBath
      fiveFixtureBath: this.parseNumber(parts[103]),     // Num5FixtureBaths
      sixPlusFixtureBath: this.parseNumber(parts[104]),  // 6+FixtureBath
      
      // ===== ASSET FIELDS - AIR CONDITIONING =====
      airCondType: this.cleanValue(parts[127]),          // Air Cond Type
      acSf: this.parseNumber(parts[128]),                // Ac Sf
      
      // ===== ASSET FIELDS - BASEMENT =====
      basement: this.parseNumber(parts[122]),            // Basement
      bsmtFinishSqFt: this.parseNumber(parts[121]),      // Bsmt Finish Sq Ft
      
      // ===== ASSET FIELDS - BUILDING MATERIALS =====
      exteriorFinish1: this.cleanValue(parts[110]),      // Exterior Finish 1
      exteriorFinish2: this.cleanValue(parts[111]),      // Exterior Finish 2
      foundation: this.cleanValue(parts[113]),           // Foundation
      heatSource: this.cleanValue(parts[126]),           // Heat Source
      
      // ===== ASSET FIELDS - FIREPLACES =====
      fireplace: this.parseNumber(parts[149]),           // Fireplace
      oneStoryStackFp: this.parseNumber(parts[150]),     // 1 Story Stack Fp
      oneHalfStoryFp: this.parseNumber(parts[151]),      // 1 And Half Sty Fp
      twoStoryFp: this.parseNumber(parts[152]),          // 2 Sty Fp
      sameStackFp: this.parseNumber(parts[153]),         // Same Stack Fp
      freestandingFp: this.parseNumber(parts[154]),      // Freestanding Fp
      heatilator: this.parseNumber(parts[155]),          // Heatilator
      
      // ===== ASSET FIELDS - PORCHES, DECKS, PATIOS =====
      op: this.parseNumber(parts[160]),                  // Op (Open Porch)
      biOp: this.parseNumber(parts[161]),                // BiOp (Built-in Open Porch)
      ep: this.parseNumber(parts[162]),                  // Ep (Enclosed Porch)
      biEp: this.parseNumber(parts[163]),                // BiEp (Built-in Enclosed Porch)
      deck: this.parseNumber(parts[168]),                // Deck
      patio: this.parseNumber(parts[170]),               // Patio
      
      // ===== ASSET FIELDS - DETACHED BUILDINGS =====
      detachedBuilding1: this.cleanValue(parts[208]),    // Detached building 1
      detachedBuilding2: this.cleanValue(parts[221]),    // Detached building 2
      detachedBuilding3: this.cleanValue(parts[234]),    // Detached building 3
      detachedBuilding4: this.cleanValue(parts[247]),    // Detached building 4
      detachedBuilding5: this.cleanValue(parts[260]),    // Detached building 5
      detachedBuilding6: this.cleanValue(parts[273]),    // Detached building 6
      detachedBuilding7: this.cleanValue(parts[286]),    // Detached building 7
      detachedBuilding8: this.cleanValue(parts[299]),    // Detached building 8
      
      // Detached building sizes (Width * Depth OR Sq Ft)
      detachedWidth1: this.parseNumber(parts[209]),      // Width 1
      detachedDepth1: this.parseNumber(parts[210]),      // Depth 1
      detachedSqFt1: this.parseNumber(parts[211]),       // Sq Ft 1
      detachedWidth2: this.parseNumber(parts[222]),      // Width 2
      detachedDepth2: this.parseNumber(parts[223]),      // Depth 2
      detachedSqFt2: this.parseNumber(parts[224]),       // Sq Ft 2
      detachedWidth3: this.parseNumber(parts[235]),      // Width 3
      detachedDepth3: this.parseNumber(parts[236]),      // Depth 3
      detachedSqFt3: this.parseNumber(parts[237]),       // Sq Ft 3
      detachedWidth4: this.parseNumber(parts[248]),      // Width 4
      detachedDepth4: this.parseNumber(parts[249]),      // Depth 4
      detachedSqFt4: this.parseNumber(parts[250]),       // Sq Ft 4
      detachedWidth5: this.parseNumber(parts[261]),      // Width 5
      detachedDepth5: this.parseNumber(parts[262]),      // Depth 5
      detachedSqFt5: this.parseNumber(parts[263]),       // Sq Ft 5
      detachedWidth6: this.parseNumber(parts[274]),      // Width 6
      detachedDepth6: this.parseNumber(parts[275]),      // Depth 6
      detachedSqFt6: this.parseNumber(parts[276]),       // Sq Ft 6
      detachedWidth7: this.parseNumber(parts[287]),      // Width 7
      detachedDepth7: this.parseNumber(parts[288]),      // Depth 7
      detachedSqFt7: this.parseNumber(parts[289]),       // Sq Ft 7
      detachedWidth8: this.parseNumber(parts[300]),      // Width 8
      detachedDepth8: this.parseNumber(parts[301]),      // Depth 8
      detachedSqFt8: this.parseNumber(parts[302]),       // Sq Ft 8
      
      // ===== ASSET FIELDS - LOT SIZE =====
      lotSizeInSf: this.parseNumber(parts[400]),         // Lot Size In Sf
      lotSizeInAcres: this.parseDecimal(parts[401]),     // Lot Size In Acres
      frontFt1: this.parseDecimal(parts[402]),           // Front Ft1
      frontFt2: this.parseDecimal(parts[403]),           // Front Ft2
      frontFt3: this.parseDecimal(parts[404]),           // Front Ft3
      avgDepth1: this.parseDecimal(parts[405]),          // Avg Depth1
      avgDepth2: this.parseDecimal(parts[406]),          // Avg Depth2
      avgDepth3: this.parseDecimal(parts[407]),          // Avg Depth3
      
      // ===== OTHER ASSET FIELDS =====
      yearBuilt: this.parseNumber(parts[108]),           // Year Built
      storyHeight: this.parseDecimal(parts[109]),        // Story Height
      livableArea: this.parseNumber(parts[279])          // Livable Area
    };
    
    return this.cleanPropertyObject(property);
    
  } catch (error) {
    console.warn(`Error parsing property record ${recordNumber}: ${error.message}`);
    return null;
  }
}

/**
 * Complete normalizeRecord function with ALL normalized fields
 */
normalizeRecord(rawRecord) {
  const normalized = {
    // ===== CORE IDENTIFIERS =====
    block: rawRecord.block,
    lot: rawRecord.lot,
    qualifier: rawRecord.qualifier,
    
    // ===== OWNER NORMALIZED FIELDS =====
    ownerName: rawRecord.ownerName,
    ownerStreet: rawRecord.ownerStreet,
    ownerCsZ: rawRecord.ownerCsz, // Combined city, state, zip
    
    // ===== PROPERTY NORMALIZED FIELDS =====
    propertyLocation: rawRecord.propertyLocation,
    propertyClass: rawRecord.propertyClass,
    propertyAdditionalLots: rawRecord.propertyAdditionalLots,
    
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

// ===== CALCULATION METHODS =====

// BATHROOM CALCULATIONS
calculateTotalBaths(record) {
  const twoFix = parseInt(record.twoFixtureBath) || 0;
  const threeFix = parseInt(record.threeFixtureBath) || 0;
  const fourFix = parseInt(record.fourFixtureBath) || 0;
  const fiveFix = parseInt(record.fiveFixtureBath) || 0;
  const sixPlusFix = parseInt(record.sixPlusFixtureBath) || 0;
  
  return (twoFix * 0.5) + threeFix + fourFix + fiveFix + sixPlusFix;
}

// AIR CONDITIONING CALCULATIONS
calculateHasAirConditioning(record) {
  return !!(record.airCondType && record.airCondType.trim() !== '');
}

calculateTotalAcArea(record) {
  return parseInt(record.acSf) || 0;
}

// BASEMENT CALCULATIONS
calculateHasBasement(record) {
  return (parseInt(record.basement) || 0) > 0;
}

calculateHasFinishedBasement(record) {
  return (parseInt(record.bsmtFinishSqFt) || 0) > 0;
}

calculateFinishedBasementArea(record) {
  return parseInt(record.bsmtFinishSqFt) || 0;
}

// BUILDING MATERIALS
calculateExteriorFinishTypes(record) {
  const types = [record.exteriorFinish1, record.exteriorFinish2].filter(Boolean);
  return types;
}

// FIREPLACE CALCULATIONS
calculateFireplaceCount(record) {
  const counts = {
    standard: parseInt(record.fireplace) || 0,
    oneStoryStack: parseInt(record.oneStoryStackFp) || 0,
    oneHalfStory: parseInt(record.oneHalfStoryFp) || 0,
    twoStory: parseInt(record.twoStoryFp) || 0,
    sameStack: parseInt(record.sameStackFp) || 0,
    freestanding: parseInt(record.freestandingFp) || 0,
    heatilator: parseInt(record.heatilator) || 0
  };
  
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

calculateHasFireplace(record) {
  return this.calculateFireplaceCount(record) > 0;
}

calculateFireplaceTypes(record) {
  const types = [];
  const counts = {
    standard: parseInt(record.fireplace) || 0,
    oneStoryStack: parseInt(record.oneStoryStackFp) || 0,
    oneHalfStory: parseInt(record.oneHalfStoryFp) || 0,
    twoStory: parseInt(record.twoStoryFp) || 0,
    sameStack: parseInt(record.sameStackFp) || 0,
    freestanding: parseInt(record.freestandingFp) || 0,
    heatilator: parseInt(record.heatilator) || 0
  };
  
  if (counts.standard > 0) types.push("Standard");
  if (counts.oneStoryStack > 0) types.push("1 Story Stack");
  if (counts.oneHalfStory > 0) types.push("1.5 Story");
  if (counts.twoStory > 0) types.push("2 Story");
  if (counts.sameStack > 0) types.push("Same Stack");
  if (counts.freestanding > 0) types.push("Freestanding");
  if (counts.heatilator > 0) types.push("Heatilator");
  
  return types;
}

// PORCH, DECK, PATIO CALCULATIONS
calculateOpenPorchArea(record) {
  const op = parseInt(record.op) || 0;
  const biOp = parseInt(record.biOp) || 0;
  return op + biOp;
}

calculateEnclosedPorchArea(record) {
  const ep = parseInt(record.ep) || 0;
  const biEp = parseInt(record.biEp) || 0;
  return ep + biEp;
}

calculateDeckArea(record) {
  return parseInt(record.deck) || 0;
}

calculatePatioArea(record) {
  return parseInt(record.patio) || 0;
}

// DETACHED BUILDING CALCULATIONS
calculateDetachedBuildingTypes(record) {
  const types = [];
  for (let i = 1; i <= 8; i++) {
    const type = record[`detachedBuilding${i}`];
    if (type && type.trim() !== '') {
      types.push(type);
    }
  }
  return types;
}

calculateDetachedBuildingSizes(record) {
  const sizes = [];
  for (let i = 1; i <= 8; i++) {
    const sqFt = parseInt(record[`detachedSqFt${i}`]) || 0;
    const width = parseInt(record[`detachedWidth${i}`]) || 0;
    const depth = parseInt(record[`detachedDepth${i}`]) || 0;
    
    let area = 0;
    if (sqFt > 0) {
      area = sqFt;
    } else if (width > 0 && depth > 0) {
      area = width * depth;
    }
    
    if (area > 0) {
      sizes.push(area);
    }
  }
  return sizes;
}

// LOT SIZE CALCULATIONS
calculateLotSizeSquareFeet(record) {
  // Priority 1: Use direct measurement
  if (record.lotSizeInSf && record.lotSizeInSf > 0) {
    return record.lotSizeInSf;
  }
  
  // Priority 2: Calculate from dimensions
  const totalFrontage = this.calculateLotFrontage(record);
  const avgDepth = this.calculateLotDepth(record);
  
  if (totalFrontage > 0 && avgDepth > 0) {
    return totalFrontage * avgDepth;
  }
  
  // Priority 3: Convert from acres
  if (record.lotSizeInAcres && record.lotSizeInAcres > 0) {
    return record.lotSizeInAcres * 43560;
  }
  
  return null;
}

calculateLotSizeAcres(record) {
  // Priority 1: Use direct measurement
  if (record.lotSizeInAcres && record.lotSizeInAcres > 0) {
    return record.lotSizeInAcres;
  }
  
  // Priority 2: Calculate from square feet
  const sqft = this.calculateLotSizeSquareFeet(record);
  return sqft ? sqft / 43560 : null;
}

calculateLotFrontage(record) {
  const frontFt1 = parseFloat(record.frontFt1) || 0;
  const frontFt2 = parseFloat(record.frontFt2) || 0;
  const frontFt3 = parseFloat(record.frontFt3) || 0;
  const total = frontFt1 + frontFt2 + frontFt3;
  return total > 0 ? total : null;
}

calculateLotDepth(record) {
  const depths = [
    parseFloat(record.avgDepth1) || 0,
    parseFloat(record.avgDepth2) || 0,
    parseFloat(record.avgDepth3) || 0
  ].filter(d => d > 0);
  
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
