import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://zxvavttfvpsagzluqqwn.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4dmF2dHRmdnBzYWd6bHVxcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDA4NjcsImV4cCI6MjA2NzkxNjg2N30.Rrn2pTnImCpBIoKPcdlzzZ9hMwnYtIO5s7i1ejwQReg';

// Enhanced Supabase client with custom fetch options for better timeout handling
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      'x-client-info': 'property-app'
    },
    // Custom fetch with timeout and retry logic
    fetch: async (url, options = {}) => {
      const timeout = options.timeout || 60000; // Default 60 seconds, can be overridden
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Create an AbortController for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          // If response is ok, return it
          if (response.ok) {
            return response;
          }
          
          // If it's a server error (5xx), retry
          if (response.status >= 500 && attempt < maxRetries) {
            console.log(`🔄 Server error (${response.status}), retrying attempt ${attempt + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            continue;
          }
          
          // For client errors (4xx), don't retry
          return response;
          
        } catch (error) {
          // If it's an abort error (timeout), retry if we have attempts left
          if (error.name === 'AbortError' && attempt < maxRetries) {
            console.log(`⏱️ Request timeout, retrying attempt ${attempt + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          
          // If it's a network error and we have retries left, try again
          if (error.name === 'TypeError' && error.message === 'Failed to fetch' && attempt < maxRetries) {
            console.log(`🌐 Network error, retrying attempt ${attempt + 1}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            continue;
          }
          
          // If we're out of retries or it's a different error, throw it
          if (attempt === maxRetries) {
            console.error(`❌ Failed after ${maxRetries} attempts:`, error);
          }
          throw error;
        }
      }
    }
  }
});

// Define fields that must be preserved during file updates
const PRESERVED_FIELDS = [
  'project_start_date',      // ProductionTracker - user set
  'is_assigned_property',    // AdminJobManagement - from assignments
  'validation_status',       // ProductionTracker - validation state
  'location_analysis',       // MarketAnalysis - manually entered
  'new_vcs',                 // AppealCoverage - manually set
  'asset_map_page',          // MarketAnalysis worksheet - manually entered
  'asset_key_page',          // MarketAnalysis worksheet - manually entered
  'asset_zoning',            // MarketAnalysis worksheet - manually entered
  'values_norm_size',        // MarketAnalysis - calculated value
  'values_norm_time',        // MarketAnalysis - calculated value
  'sales_history',           // FileUploadButton - sales decisions
  'processing_notes'         // User notes - if added should be kept
]

// ===== CODE INTERPRETATION UTILITIES =====
// Utilities for interpreting vendor-specific codes in MarketLandAnalysis
export const interpretCodes = {
  // Microsystems field to prefix mapping
  microsystemsPrefixMap: {
    'inspection_info_by': '140',
    'asset_building_class': '345',
    'asset_ext_cond': '490',
    'asset_int_cond': '491',
    'asset_type_use': '500',
    'asset_stories': '510',
    'asset_design_style': '520',
    // Raw data fields
    'topo': '115',
    'road': '120',
    'curbing': '125',
    'sidewalk': '130',
    'utilities': '135',
    'zone_table': '205',
    'vcs': '210',
    'farmland_override': '212',
    'land_adjustments': '220',
    'renovation_impr': '235',
    'bath_kitchen_dep': '245',
    'functional_depr': '250',
    'locational_depr': '260',
    'item_adjustment': '346',
    'exterior': '530',
    'roof_type': '540',
    'roof_material': '545',
    'foundation': '550',
    'interior_wall': '555',
    'electric': '557',
    'roof_pitch': '559',
    'heat_source': '565',
    'built_ins_590': '590',
    'built_ins_591': '591',
    'detached_items': '680'
  },
  // BRT section to field mapping
  brtSectionMap: {
    'asset_design_style': '23',
    'asset_building_class': '20',
    'asset_type_use': '21',
    'asset_stories': '22',
    'asset_ext_cond': '60',
    'asset_int_cond': '60',  // Same section, different codes
    'inspection_info_by': '53',
    // Raw data fields
    'roof_type': '24',
    'roof_material': '25',
    'exterior_finish': '26',
    'foundation': '27',
    'interior_finish': '28',
    'floor_finish': '29',
    'basement': '30',
    'heat_source': '31',
    'heat_system': '32',
    'electric': '33',
    'air_cond': '34',
    'plumbing': '35',
    'fireplace': '36',
    'attic_dormer': '37',
    'garages': '41',
    'neighborhood': '50',
    'view': '51',
    'utilities': '52',
    'road': '54',
    'curbing': '55',
    'sidewalk': '56',
    'condition': '60',
    'vcs': 'special'  // Handle VCS differently
  },

  // Get decoded value for Microsystems property field
  getMicrosystemsValue: function(property, codeDefinitions, fieldName) {
    if (!property || !codeDefinitions) return null;
    
    const prefix = this.microsystemsPrefixMap[fieldName];
    if (!prefix) return null;
    
    // Get the code value from property (check both column and raw_data)
    let code = property[fieldName];
    if (!code && property.raw_data) {
      code = property.raw_data[fieldName];
    }
    
    if (!code || code.trim() === '') return null;
    
    // Build lookup key - Microsystems format: "PREFIX+CODE+SPACES+9999"
    const paddedCode = code.padEnd(4);
    const lookupKey = `${prefix}${paddedCode}9999`;
    
    // Return decoded value or original code if not found
    return codeDefinitions[lookupKey] || code;
  },
    // ADD THIS: Core BRT lookup function
  getBRTValue: function(property, codeDefinitions, fieldName, sectionNumber) {
    if (!property || !codeDefinitions) return null;
    
    // Check both the property field and raw_data
    let code = property[fieldName];
    if (!code && property.raw_data) {
      code = property.raw_data[fieldName];
    }
    
    if (!code || code.trim() === '') return null;
    
    // Check if we have sections (BRT structure)
    if (!codeDefinitions.sections || !codeDefinitions.sections[sectionNumber]) {
      return code;
    }
    
    const section = codeDefinitions.sections[sectionNumber];
    const sectionMap = section.MAP || {};
    
    // Look through the MAP for matching code
    for (const [key, value] of Object.entries(sectionMap)) {
      if (value.KEY === code || value.DATA?.KEY === code) {
        return value.DATA?.VALUE || value.VALUE || code;
      }
    }
       
    return code; // Return original if no match found
  },

  // REPLACE the existing getDesignName with this:
  getDesignName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;
    
    const designCode = property.asset_design_style;
    if (!designCode || designCode.trim() === '') return null;
    
    if (vendorType === 'Microsystems') {
      return this.getMicrosystemsValue(property, codeDefinitions, 'asset_design_style');
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_design_style', '23');
    }
    
    return designCode;
  },

  // REPLACE the existing getTypeName with this:
  getTypeName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;
    
    const typeCode = property.asset_type_use;
    if (!typeCode || typeCode.trim() === '') return null;
    
    if (vendorType === 'Microsystems') {
      return this.getMicrosystemsValue(property, codeDefinitions, 'asset_type_use');
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_type_use', '21');
    }
    
    return typeCode;
  },

  // Check if a field is empty (handles spaces, null, undefined)
  isFieldEmpty: function(value) {
    return !value || value.toString().trim() === '';
  }, 
 
// Fix getExteriorConditionName:
getExteriorConditionName: function(property, codeDefinitions, vendorType) {
  if (!property || !codeDefinitions) return null;
  
  const condCode = property.asset_ext_cond;
  if (!condCode || condCode.trim() === '') return null;
  
  if (vendorType === 'Microsystems') {
    return this.getMicrosystemsValue(property, codeDefinitions, 'asset_ext_cond');
  } else if (vendorType === 'BRT') {
    // ADD THE SECTION NUMBER HERE - need to find what section exterior condition is in
    return this.getBRTValue(property, codeDefinitions, 'asset_ext_cond', '60'); 
  }
  
  return condCode;
},

// Fix getInteriorConditionName:
getInteriorConditionName: function(property, codeDefinitions, vendorType) {
  if (!property || !codeDefinitions) return null;
  
  const condCode = property.asset_int_cond;
  if (!condCode || condCode.trim() === '') return null;
  
  if (vendorType === 'Microsystems') {
    return this.getMicrosystemsValue(property, codeDefinitions, 'asset_int_cond');
  } else if (vendorType === 'BRT') {
    // ADD THE SECTION NUMBER HERE - need to find what section interior condition is in
    return this.getBRTValue(property, codeDefinitions, 'asset_int_cond', '60'); 
  }
  
  return condCode;
},

  // ===== NEW: STORY HEIGHT / FLOOR INTERPRETER =====
  getStoryHeight: function(property, codeDefinitions, vendorType) {
    if (!property) return null;
    
    // First check raw_data for the original text value
    if (property.raw_data) {
      if (vendorType === 'BRT') {
        // BRT stores in various possible field names
        const rawStory = property.raw_data.STORYHGT || 
                        property.raw_data.STORY_HEIGHT ||
                        property.raw_data['Story Height'] ||
                        property.raw_data.STORIES;
        if (rawStory) return rawStory;
      } else if (vendorType === 'Microsystems') {
        // Look for 510-prefixed fields in raw_data
        for (const key in property.raw_data) {
          if (key.startsWith('510')) {
            const value = property.raw_data[key];
            if (value) return value;
          }
        }
        // Also check common field names
        const rawStory = property.raw_data['Story Height'] ||
                        property.raw_data.STORY_HEIGHT ||
                        property.raw_data.STORIES;
        if (rawStory) return rawStory;
      }
    }
    
    // If no raw_data, try to decode from asset_stories using code definitions
    const storyCode = property.asset_stories;
    if (storyCode && codeDefinitions) {
      if (vendorType === 'Microsystems') {
        // Look up in code definitions with 510 prefix
        const lookupKey = `510${String(storyCode).padEnd(4)}9999`;
        if (codeDefinitions[lookupKey]) {
          return codeDefinitions[lookupKey];
        }
      } else if (vendorType === 'BRT') {
        // Look in section 22 for story height
        if (codeDefinitions.sections && codeDefinitions.sections['22']) {
          const section = codeDefinitions.sections['22'];
          const sectionMap = section.MAP || {};
          
          for (const [key, value] of Object.entries(sectionMap)) {
            if (value.KEY === storyCode || value.DATA?.KEY === storyCode) {
              return value.DATA?.VALUE || value.VALUE || storyCode;
            }
          }
        }
      }
    }
    
    // Return whatever we have
    return storyCode;
  },

  // ===== SNEAKY CONDO FLOOR EXTRACTOR =====
  getCondoFloor: function(property, codeDefinitions, vendorType) {
    // First get the story height description
    const storyHeight = this.getStoryHeight(property, codeDefinitions, vendorType);
    
    if (!storyHeight) return null;
    
    // Convert to string to handle both text and numeric values
    const storyStr = String(storyHeight).toUpperCase();
    
    // SNEAKY PART: Look for ANY description with "FLOOR" in it!
    if (storyStr.includes('FLOOR')) {
      // Try to extract floor number from various patterns:
      // "CONDO 1ST FLOOR", "1ST FLOOR", "FLOOR 1", "3RD FLOOR UNIT", etc.
      
      // Pattern 1: "1ST FLOOR", "2ND FLOOR", "3RD FLOOR", "4TH FLOOR"
      const ordinalMatch = storyStr.match(/(\d+)(ST|ND|RD|TH)\s*FLOOR/);
      if (ordinalMatch) {
        return parseInt(ordinalMatch[1]);
      }
      
      // Pattern 2: "FLOOR 1", "FLOOR 2", etc.
      const floorNumMatch = storyStr.match(/FLOOR\s*(\d+)/);
      if (floorNumMatch) {
        return parseInt(floorNumMatch[1]);
      }
      
      // Pattern 3: Just a number before FLOOR
      const numberBeforeMatch = storyStr.match(/(\d+)\s*FLOOR/);
      if (numberBeforeMatch) {
        return parseInt(numberBeforeMatch[1]);
      }
      
      // Pattern 4: Written out floors
      if (storyStr.includes('FIRST FLOOR') || storyStr.includes('GROUND FLOOR')) return 1;
      if (storyStr.includes('SECOND FLOOR')) return 2;
      if (storyStr.includes('THIRD FLOOR')) return 3;
      if (storyStr.includes('FOURTH FLOOR')) return 4;
      if (storyStr.includes('FIFTH FLOOR')) return 5;
      if (storyStr.includes('SIXTH FLOOR')) return 6;
      if (storyStr.includes('SEVENTH FLOOR')) return 7;
      if (storyStr.includes('EIGHTH FLOOR')) return 8;
      if (storyStr.includes('NINTH FLOOR')) return 9;
      if (storyStr.includes('TENTH FLOOR')) return 10;
      
      // Pattern 5: Penthouse or top floor
      if (storyStr.includes('PENTHOUSE') || storyStr.includes('PH')) return 99; // Special code for penthouse
      
      // If we found "FLOOR" but couldn't extract a number, return -1 to indicate unknown floor
      return -1;
    }
    
    // Also check for "CONDO" patterns even without "FLOOR"
    if (storyStr.includes('CONDO')) {
      // "CONDO 1", "CONDO 2", "CONDO 1ST", etc.
      const condoMatch = storyStr.match(/CONDO\s*(\d+)/);
      if (condoMatch) {
        return parseInt(condoMatch[1]);
      }
    }
    
    // Check property_location or property_qualifier for unit numbers that might indicate floor
    if (property.property_location) {
      const location = String(property.property_location).toUpperCase();
      // Common pattern: "3A", "2B" where first digit is floor
      const unitMatch = location.match(/^(\d)[A-Z]/);
      if (unitMatch) {
        const floor = parseInt(unitMatch[1]);
        if (floor >= 1 && floor <= 9) return floor;
      }
    }
    
    if (property.property_qualifier) {
      const qualifier = String(property.property_qualifier).toUpperCase();
      // Check for floor indicators in qualifier
      const qualMatch = qualifier.match(/(\d)(ST|ND|RD|TH)|FLOOR\s*(\d)|^(\d)[A-Z]/);
      if (qualMatch) {
        const floor = parseInt(qualMatch[1] || qualMatch[3] || qualMatch[4]);
        if (floor >= 1 && floor <= 99) return floor;
      }
    }
    
    return null;
  },

  // ===== CONDO-SPECIFIC DATA QUALITY CHECK =====
  hasCondoFloorData: function(property, codeDefinitions, vendorType) {
    const floor = this.getCondoFloor(property, codeDefinitions, vendorType);
    return floor !== null && floor !== -1; // -1 means we found "FLOOR" but couldn't parse
  },

  // Get raw data value with vendor awareness
  getRawDataValue: function(property, fieldName, vendorType) {
    if (!property || !property.raw_data) return null;
    
    const rawData = property.raw_data;
    
    // Handle vendor-specific field name differences
    if (vendorType === 'BRT') {
      const brtFieldMap = {
        'bedrooms': 'BEDTOT',
        'bathrooms': 'BATHTOT',
        'stories': 'STORYHGT',
        'year_built': 'YEARBUILT',
        'building_class': 'BLDGCLASS',
        'design': 'DESIGN',
        'type_use': 'TYPEUSE',
        'exterior_condition': 'EXTERIORNC',
        'interior_condition': 'INTERIORNC',
        'info_by': 'INFOBY'
      };
      const brtField = brtFieldMap[fieldName] || fieldName;
      return rawData[brtField];
    } else if (vendorType === 'Microsystems') {
      const microFieldMap = {
        'bedrooms': 'Total Bedrms',
        'stories': 'Story Height',
        'year_built': 'Year Built',
        'building_class': 'Bldg Qual Class Code',
        'design': 'Style Code',
        'type_use': 'Type Use Code',
        'condition': 'Condition',
        'info_by': 'Information By'
      };
      const microField = microFieldMap[fieldName] || fieldName;
      return rawData[microField];
    }
    
    return rawData[fieldName];
  },

  // Get total lot size (aggregates multiple fields)
  getTotalLotSize: function(property, vendorType) {
    if (!property) return 0;
    
    // First check standard fields
    let totalAcres = property.asset_lot_acre || 0;
    let totalSf = property.asset_lot_sf || 0;
    
    // Convert SF to acres if we have SF but no acres
    if (totalSf > 0 && totalAcres === 0) {
      totalAcres = totalSf / 43560;
    }
    
    // For BRT, also check LANDUR fields in raw_data
    if (vendorType === 'BRT' && property.raw_data) {
      for (let i = 1; i <= 6; i++) {
        const landField = property.raw_data[`LANDUR_${i}`];
        if (landField) {
          const upperField = landField.toUpperCase();
          const value = parseFloat(landField.replace(/[^0-9.]/g, ''));
          
          if (!isNaN(value)) {
            if (upperField.includes('AC') || upperField.includes('ACRE')) {
              totalAcres += value;
            } else if (upperField.includes('SF') || upperField.includes('SITE')) {
              totalSf += value;
            }
          }
        }
      }
    }
    
    // Return total in acres
    return totalAcres + (totalSf / 43560);
  },
// Get bathroom plumbing sum (BRT only)
  getBathroomPlumbingSum: function(property, vendorType) {
    if (!property || !property.raw_data || vendorType !== 'BRT') return 0;
    
    let sum = 0;
    for (let i = 2; i <= 6; i++) {
      sum += parseInt(property.raw_data[`PLUMBING${i}FIX`]) || 0;
    }
    return sum;
  },

  // Get bathroom fixture sum (Microsystems only - summary fields)
  getBathroomFixtureSum: function(property, vendorType) {
    if (!property || !property.raw_data || vendorType !== 'Microsystems') return 0;
    
    return (parseInt(property.raw_data['4 Fixture Bath']) || 0) +
           (parseInt(property.raw_data['3 Fixture Bath']) || 0) +
           (parseInt(property.raw_data['2 Fixture Bath']) || 0) +
           (parseInt(property.raw_data['Num 5 Fixture Baths']) || 0);
  },

  // Get bathroom room sum (Microsystems only - floor-specific fields)
  getBathroomRoomSum: function(property, vendorType) {
    if (!property || !property.raw_data || vendorType !== 'Microsystems') return 0;
    
    let sum = 0;
    const floorSuffixes = ['B', '1', '2', '3'];
    const fixtureTypes = ['2 Fixture Bath', '3 Fixture Bath', '4 Fixture Bath'];
    
    for (const fixture of fixtureTypes) {
      for (const floor of floorSuffixes) {
        const fieldName = `${fixture} ${floor}`;
        sum += parseInt(property.raw_data[fieldName]) || 0;
      }
    }
    
    // Add the summary 5-fixture field since there are no floor-specific ones
    sum += parseInt(property.raw_data['Num 5 Fixture Baths']) || 0;
    
    return sum;
  },

  // Get bedroom room sum (Microsystems only)
  getBedroomRoomSum: function(property, vendorType) {
    if (!property || !property.raw_data || vendorType !== 'Microsystems') return 0;
    
    return (parseInt(property.raw_data['Bedrm B']) || 0) +
           (parseInt(property.raw_data['Bedrm 1']) || 0) +
           (parseInt(property.raw_data['Bedrm 2']) || 0) +
           (parseInt(property.raw_data['Bedrm 3']) || 0);
  },

  // Get VCS (Valuation Control Sector) description - aka Neighborhood
  getVCSDescription: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;
    
    // Get VCS code from property (check multiple possible fields)
    let vcsCode = property.newVCS || property.new_vcs || property.vcs;
    if (!vcsCode && property.raw_data) {
      vcsCode = property.raw_data.vcs || 
                property.raw_data.VCS || 
                property.raw_data.NEIGHBORHOOD ||
                property.raw_data.neighborhood;
    }  
    
    if (!vcsCode || vcsCode.toString().trim() === '') return null;
    
    // Clean the VCS code
    vcsCode = vcsCode.toString().trim();
    
    if (vendorType === 'Microsystems') {
      // Microsystems: Direct lookup with 210 prefix
      // The codes have format: 210XXXX9999 where XXXX is the VCS code
      // We need to pad the code to 4 characters
      const paddedCode = vcsCode.padEnd(4, ' ');
      
      // Try multiple lookup patterns (1000, 5000, 9999 suffixes)
      const suffixes = ['9999', '5000', '1000'];
      
      for (const suffix of suffixes) {
        const lookupKey = `210${paddedCode}${suffix}`;
        if (codeDefinitions[lookupKey]) {
          return codeDefinitions[lookupKey];
        }
      }
      
      // If no match found, return the original code
      return vcsCode;
      
    } else if (vendorType === 'BRT') {
      // BRT: Navigate the nested structure
      // Structure: sections.VCS[number]["9"]["DATA"]["VALUE"]
      
      if (!codeDefinitions.sections || !codeDefinitions.sections.VCS) {
        return vcsCode;
      }
      
      const vcsSection = codeDefinitions.sections.VCS;
      
      // VCS code in BRT is typically the key number (1-55 in your example)
      // Check if the code is a direct key in the VCS section
      if (vcsSection[vcsCode]) {
        // Navigate to the neighborhood value
        const entry = vcsSection[vcsCode];
        if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
          return entry['9']['DATA']['VALUE'];
        }
      }
      
      // If not found by direct key, search through all entries
      for (const key in vcsSection) {
        const entry = vcsSection[key];
        // Check if this entry's KEY matches our VCS code
        if (entry.KEY === vcsCode || entry.DATA?.KEY === vcsCode) {
          if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
            return entry['9']['DATA']['VALUE'];
          }
        }
      }
      
      // Return original code if no match found
      return vcsCode;
    }
    
    return vcsCode;
  },
  // Get all available VCS codes and descriptions for a job
  getAllVCSCodes: function(codeDefinitions, vendorType) {
    const vcsCodes = [];
    
    if (!codeDefinitions) return vcsCodes;
    
    if (vendorType === 'Microsystems') {
      // Extract all 210-prefixed codes
      for (const key in codeDefinitions) {
        if (key.startsWith('210') && key.endsWith('9999')) {
          // Extract the VCS code part (characters 3-7)
          const vcsCode = key.substring(3, 7).trim();
          const description = codeDefinitions[key];
          
          // Avoid duplicates
          if (!vcsCodes.find(v => v.code === vcsCode)) {
            vcsCodes.push({
              code: vcsCode,
              description: description
            });
          }
        }
      }
      
    } else if (vendorType === 'BRT') {
      // Extract from nested VCS section
      if (codeDefinitions.sections && codeDefinitions.sections.VCS) {
        const vcsSection = codeDefinitions.sections.VCS;
        
        for (const key in vcsSection) {
          const entry = vcsSection[key];
          if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
            vcsCodes.push({
              code: key,
              description: entry['9']['DATA']['VALUE']
            });
          }
        }
      }
    }
    
    // Sort by code
    return vcsCodes.sort((a, b) => {
      // Try numeric sort first
      const numA = parseInt(a.code);
      const numB = parseInt(b.code);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      // Fall back to string sort
      return a.code.localeCompare(b.code);
    });
  },

  // ===== PACKAGE SALE AGGREGATOR =====
  getPackageSaleData: function(properties, targetProperty) {
    // Check if we have the required fields for package sale detection
    if (!targetProperty?.sales_date || !targetProperty?.sales_book || !targetProperty?.sales_page) {
      return null;
    }
    
    // Find all properties in the same package (same date, book, and page)
    const packageProperties = properties.filter(p => 
      p.sales_date === targetProperty.sales_date &&
      p.sales_book === targetProperty.sales_book &&
      p.sales_page === targetProperty.sales_page
    );
    
    // If only one property, it's not a package sale
    if (packageProperties.length <= 1) {
      return null;
    }
    
    // Check if any properties have "Keep Both" decisions in sales_history
    const hasKeepBothHistory = packageProperties.some(p => 
      p.sales_history?.sales_decision?.decision_type === 'Keep Both'
    );
    
    // Sort by building class to find primary property (lowest class number)
    const sortedByClass = [...packageProperties].sort((a, b) => {
      const classA = parseInt(a.asset_building_class) || 999;
      const classB = parseInt(b.asset_building_class) || 999;
      return classA - classB;
    });
    
    const primary = sortedByClass[0];
    
    // Calculate combined lot size (sum of sf and acres converted)
    const combinedLotSF = packageProperties.reduce((sum, p) => {
      const sf = parseFloat(p.asset_lot_sf) || 0;
      const acres = parseFloat(p.asset_lot_acre) || 0;
      return sum + sf + (acres * 43560); // Convert acres to SF
    }, 0);
    
    // Calculate combined assessed value
    const combinedAssessed = packageProperties.reduce((sum, p) => {
      const assessed = parseFloat(p.values_mod_total) || 0;
      return sum + assessed;
    }, 0);
    
    // Get unique property classes
    const propertyClasses = [...new Set(packageProperties.map(p => p.asset_building_class))];
    
    // Check for specific class types
    const hasVacant = packageProperties.some(p => 
      p.asset_building_class === '1' || p.asset_building_class === '3B'
    );
    
    const hasFarmland = packageProperties.some(p => 
      p.asset_building_class === '3B'
    );

    // Check if this is additional cards for same property
    const isAdditionalCard = packageProperties.every(p => {
      const parsed = p.property_composite_key.split('-');
      const baseKey = `${parsed[0]}-${parsed[1]}-${parsed[2]}-${parsed[3]}`;
      return packageProperties.every(other => {
        const otherParsed = other.property_composite_key.split('-');
        const otherBase = `${otherParsed[0]}-${otherParsed[1]}-${otherParsed[2]}-${otherParsed[3]}`;
        return baseKey === otherBase;
      });
    
    const hasResidential = packageProperties.some(p => {
      const propClass = p.asset_building_class;
      return propClass === '2' || propClass === '3A';
    });
    
    const hasCommercial = packageProperties.some(p => {
      const propClass = p.asset_building_class;
      return propClass === '4A' || propClass === '4B' || propClass === '4C';
    });
    
    // Create package ID for grouping
    const packageId = `${targetProperty.sales_book}-${targetProperty.sales_page}-${targetProperty.sales_date}`;
    
    // Check for previous individual sales (from Keep Both decisions in sales_history)
    const previousIndividualSales = packageProperties
      .filter(p => p.sales_history?.sales_decision?.old_price)
      .map(p => ({
        composite_key: p.property_composite_key,
        old_price: p.sales_history.sales_decision.old_price,
        old_date: p.sales_history.sales_decision.old_date,
        package_discount: p.sales_history.sales_decision.old_price - (p.sales_price / packageProperties.length)
      }));
    
    return {
      is_package_sale: true,
      is_farm_package: hasFarmland,
      is_additional_card: isAdditionalCard,
      package_count: packageProperties.length,
      package_id: packageId,
      combined_lot_sf: combinedLotSF,
      combined_lot_acres: combinedLotSF / 43560,
      combined_assessed: combinedAssessed,
      primary_type_use: primary.asset_type_use,
      primary_building_class: primary.asset_building_class,
      property_classes: propertyClasses,
      has_vacant: hasVacant,
      has_farmland: hasFarmland,
      has_residential: hasResidential,
      has_commercial: hasCommercial,
      has_keep_both_history: hasKeepBothHistory,
      sale_price: parseFloat(targetProperty.sales_price), // Use original, not multiplied
      sales_nu: targetProperty.sales_nu,
      previous_individual_sales: previousIndividualSales,
      package_properties: packageProperties.map(p => ({
        composite_key: p.property_composite_key,
        building_class: p.asset_building_class,
        lot_sf: p.asset_lot_sf,
        lot_acre: p.asset_lot_acre,
        assessed_value: p.values_mod_total,
        has_sales_history: !!p.sales_history,
        location: p.property_location,
        block: p.property_block,
        lot: p.property_lot
      }))
    };
  },
    // ===== DEPTH FACTOR INTERPRETERS =====
  // Get depth factors from parsed code definitions
  getDepthFactors: function(codeDefinitions, vendorType) {
    if (!codeDefinitions) return null;
    
    if (vendorType === 'BRT') {
      // BRT stores depth factors in the "Depth" section
      const depthSection = codeDefinitions.sections?.['Depth'];
      if (!depthSection) return null;
      
      // Extract all depth tables
      const depthTables = {};
      
      Object.keys(depthSection).forEach(tableKey => {
        const table = depthSection[tableKey];
        if (table.DATA?.VALUE && table.MAP) {
          // Table name like "100FT Table", "125FT Table"
          const tableName = table.DATA.VALUE;
          const factors = {};
          
          // Extract depth factors from the MAP
          Object.values(table.MAP).forEach(entry => {
            const depth = parseInt(entry.KEY);
            const factor = parseFloat(entry.DATA.VALUE);
            if (!isNaN(depth) && !isNaN(factor)) {
              factors[depth] = factor;
            }
          });
          
          depthTables[tableName] = {
            standardDepth: parseInt(tableName.match(/(\d+)FT/)?.[1]) || 100,
            factors: factors
          };
        }
      });
      
      return depthTables;
      
    } else if (vendorType === 'Microsystems') {
      // Microsystems uses prefix 200 for depth factors
      const depthTables = {};
      
      Object.keys(codeDefinitions).forEach(key => {
        if (key.startsWith('200')) {
          // Parse: 200[Type][StandardDepth][ActualDepth]
          const match = key.match(/^200([CR])(\d{3})(\d{4})$/);
          if (match) {
            const [, type, standardDepth, actualDepth] = match;
            const tableType = type === 'C' ? 'Commercial' : 'Residential';
            const tableName = `${tableType}-${standardDepth}FT`;
            
            if (!depthTables[tableName]) {
              depthTables[tableName] = {
                standardDepth: parseInt(standardDepth),
                factors: {}
              };
            }
            
            // Only add if there's a value (not empty string)
            const factor = codeDefinitions[key];
            if (factor !== '') {
              depthTables[tableName].factors[parseInt(actualDepth)] = parseFloat(factor);
            }
          }
        }
      });
      
      // Return null if no factors loaded (rural town case)
      return Object.keys(depthTables).length > 0 ? depthTables : null;
    }
    
    return null;
  },

  // Get depth factor for a specific depth using bracket system
  getDepthFactor: function(depth, selectedTable, depthTables) {
    const table = depthTables[selectedTable];
    if (!table || !table.factors) return 1.0;
    
    // Find the appropriate bracket
    const depths = Object.keys(table.factors).map(Number).sort((a, b) => a - b);
    
    // Find the bracket this depth falls into
    for (let i = depths.length - 1; i >= 0; i--) {
      if (depth >= depths[i]) {
        return table.factors[depths[i]];
      }
    }
    
    // If smaller than smallest depth, use the smallest factor
    return table.factors[depths[0]];
  },

  // Get front foot configuration with depth factors
  getFrontFootConfig: function(codeDefinitions, vendorType) {
    const depthTables = this.getDepthFactors(codeDefinitions, vendorType);
    
    if (!depthTables) return null;
    
    // Return the first table as default, or let manager select
    const defaultTable = Object.values(depthTables)[0];
    
    return {
      availableTables: depthTables,
      defaultTable: defaultTable,
      standardDepth: defaultTable?.standardDepth || 100,
      depthFactors: defaultTable?.factors || {},
      minimumFrontage: null // Manager must set this
    };
  },
  // ===== SMART ACREAGE CALCULATOR =====
  getCalculatedAcreage: function(property, vendorType) {
    // 1. Check direct acre field first
    if (property.asset_lot_acre && property.asset_lot_acre > 0) {
      return parseFloat(property.asset_lot_acre).toFixed(2);
    }

    // 2. Check square feet field and convert
    if (property.asset_lot_sf && property.asset_lot_sf > 0) {
      return (property.asset_lot_sf / 43560).toFixed(2);
    }

    // 3. Calculate from frontage × depth (NEW!)
    if (property.asset_lot_frontage && property.asset_lot_depth) {
      const sf = property.asset_lot_frontage * property.asset_lot_depth;
      return (sf / 43560).toFixed(2);
    }

    // 4. Check raw data for vendor-specific fields
    if (vendorType === 'BRT' && property.raw_data) {
      let totalSf = 0;
      let totalAcres = 0;
      
      // Check LANDUR fields for SF or ACRE
      for (let i = 1; i <= 6; i++) {
        const landur = property.raw_data[`LANDUR_${i}`];
        if (landur) {
          // Check for SF indicators
          if (landur.includes('SF') || landur.includes('SITE')) {
            const match = landur.match(/(\d+)\s*(SF|SITE)/);
            if (match) totalSf += parseInt(match[1]);
          }
          // Check for ACRE indicators
          if (landur.includes('ACRE') || landur.includes('AC')) {
            const match = landur.match(/(\d+\.?\d*)\s*(ACRE|AC)/);
            if (match) totalAcres += parseFloat(match[1]);
          }
        }
      }
      
      // Return acres (converted from SF if needed)
      if (totalAcres > 0) return totalAcres.toFixed(2);
      if (totalSf > 0) return (totalSf / 43560).toFixed(2);
    }

    // 5. Microsystems vendor check
    if (vendorType === 'Microsystems' && property.raw_data) {
      // Check for Microsystems-specific fields
      // Common field names: 'Lot Area', 'Site Area', 'Acreage'
      const lotArea = property.raw_data['Lot Area'] || property.raw_data['Site Area'];
      if (lotArea) {
        const numValue = parseFloat(lotArea);
        if (!isNaN(numValue)) {
          // Microsystems often stores in SF
          if (numValue > 1000) {
            // Likely square feet
            return (numValue / 43560).toFixed(2);
          } else {
            // Likely already in acres
            return numValue.toFixed(2);
          }
        }
      }
      
      // Check for direct acreage field
      const acreage = property.raw_data['Acreage'] || property.raw_data['Acres'];
      if (acreage) {
        const numValue = parseFloat(acreage);
        if (!isNaN(numValue)) {
          return numValue.toFixed(2);
        }
      }
    }

    // Default return if no acreage can be calculated
    return '0.00';
  }
};  

// ===== EMPLOYEE MANAGEMENT SERVICES =====
export const employeeService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('last_name');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return null;
    }
  },

  async create(employee) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert([employee])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkImport(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert(employees)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkUpsert(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .upsert(employees, { 
          onConflict: 'email',
          ignoreDuplicates: false 
        })
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee bulk upsert error:', error);
      throw error;
    }
  },

  async bulkUpdate(employees) {
    try {
      const updates = await Promise.all(
        employees.map(emp => 
          supabase
            .from('employees')
            .update(emp)
            .eq('id', emp.id)
            .select()
        )
      );
      
      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Employee bulk update error:', error);
      throw error;
    }
  },

  async getManagers() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .in('role', ['Management', 'Owner'])
        .order('last_name');
      
      if (error) throw error;
      
      // Hard-code admin capabilities for the three admins
      const managersWithAdminRoles = data.map(emp => {
        const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
        
        const isAdmin = emp.role === 'Owner' || 
                       fullName.includes('tom davis') || 
                       fullName.includes('brian schneider') || 
                       fullName.includes('james duda');
        
        return {
          ...emp,
          can_be_lead: true,
          is_admin: isAdmin,
          effective_role: 'admin'
        };
      });
      
      return managersWithAdminRoles;
    } catch (error) {
      console.error('Manager service error:', error);
      return this.getAll();
    }
  }
};

// ===== JOB MANAGEMENT SERVICES =====
export const jobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          job_assignments (
            id,
            role,
            employee:employees!job_assignments_employee_id_fkey (
              id,
              first_name,
              last_name,
              email,
              region
            )
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(job => ({
        id: job.id,
        name: job.job_name,
        ccddCode: job.ccdd_code,
        ccdd: job.ccdd_code, // ADDED: Alternative accessor for backward compatibility
        municipality: job.municipality || job.client_name,
        job_number: job.job_number,
        year_created: job.start_date ? new Date(job.start_date).getFullYear() : new Date().getFullYear(),
        county: job.county,
        state: job.state,
        vendor: job.vendor_type,
        status: job.status,
        createdDate: job.start_date,
        dueDate: job.end_date || job.target_completion_date,
        totalProperties: job.total_properties || 0,
        
        // ✅ FIXED: Added missing residential/commercial totals from database
        totalresidential: job.totalresidential || 0,
        totalcommercial: job.totalcommercial || 0,
        
        // inspectedProperties: job.inspected_properties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live analytics
        sourceFileStatus: job.source_file_status || 'pending',
        codeFileStatus: job.code_file_status || 'pending',
        vendorDetection: job.vendor_detection,
        workflowStats: job.workflow_stats,
        percent_billed: job.percent_billed,  // FIXED: was percentBilling, now percent_billed
        
        // ADDED: Property assignment tracking for enhanced metrics
        has_property_assignments: job.has_property_assignments || false,
        assigned_has_commercial: job.assigned_has_commercial || false,
        assignedPropertyCount: job.assigned_property_count || 0,
        
        // ADDED: File timestamp tracking for FileUploadButton
        created_at: job.created_at,
        source_file_uploaded_at: job.source_file_uploaded_at,
        code_file_uploaded_at: job.code_file_uploaded_at,
        updated_at: job.updated_at,
        
        // ADDED: File version tracking
        source_file_version: job.source_file_version || 1,
        code_file_version: job.code_file_version || 1,
        
        assignedManagers: job.job_assignments?.map(ja => ({
          id: ja.employee.id,
          name: `${ja.employee.first_name} ${ja.employee.last_name}`,
          role: ja.role,
          email: ja.employee.email,
          region: ja.employee.region
        })) || []
      }));
    } catch (error) {
      console.error('Jobs service error:', error);
      return [];
    }
  },

  async create(jobData) {
    try {
      const { assignedManagers, ...componentFields } = jobData;
      
      const dbFields = {
        job_name: componentFields.name,
        client_name: componentFields.municipality,
        ccdd_code: componentFields.ccdd,
        municipality: componentFields.municipality,
        county: componentFields.county,
        state: componentFields.state || 'NJ',
        vendor_type: componentFields.vendor,
        status: componentFields.status || 'draft',
        start_date: componentFields.createdDate || new Date().toISOString().split('T')[0],
        end_date: componentFields.dueDate,
        target_completion_date: componentFields.dueDate,
        total_properties: componentFields.totalProperties || 0,
        // inspected_properties: componentFields.inspectedProperties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live App.js analytics
        source_file_status: componentFields.sourceFileStatus || 'pending',
        code_file_status: componentFields.codeFileStatus || 'pending',
        vendor_detection: componentFields.vendorDetection,
        workflow_stats: componentFields.workflowStats,
        percent_billed: componentFields.percentBilled || 0,
        
        // ADDED: File version tracking
        source_file_version: componentFields.source_file_version || 1,
        code_file_version: componentFields.code_file_version || 1,
        
        // ADDED: File tracking fields for FileUploadButton
        source_file_name: componentFields.source_file_name,
        source_file_version_id: componentFields.source_file_version_id,
        source_file_uploaded_at: componentFields.source_file_uploaded_at,
        
        created_by: componentFields.created_by || componentFields.createdBy
      };
      
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (jobError) throw jobError;

      if (assignedManagers && assignedManagers.length > 0) {
        const assignments = assignedManagers.map(manager => ({
          job_id: job.id,
          employee_id: manager.id,
          role: manager.role,
          assigned_by: dbFields.created_by,
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true
        }));

        const { error: assignError } = await supabase
          .from('job_assignments')
          .insert(assignments);
        
        if (assignError) {
          console.error('Manager assignment error:', assignError);
        }
      }

      return job;
    } catch (error) {
      console.error('Job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { assignedManagers, ...componentFields } = updates;
      
      
      const dbFields = {};
      
      // Map component fields to database fields
      if (componentFields.name) dbFields.job_name = componentFields.name;
      if (componentFields.municipality) dbFields.municipality = componentFields.municipality;
      if (componentFields.ccdd) dbFields.ccdd_code = componentFields.ccdd;
      if (componentFields.county) dbFields.county = componentFields.county;
      if (componentFields.state) dbFields.state = componentFields.state;
      if (componentFields.vendor) dbFields.vendor_type = componentFields.vendor;
      if (componentFields.status) dbFields.status = componentFields.status;
      if (componentFields.dueDate) {
        dbFields.end_date = componentFields.dueDate;
        dbFields.target_completion_date = componentFields.dueDate;
      }
      if (componentFields.totalProperties !== undefined) dbFields.total_properties = componentFields.totalProperties;
      // if (componentFields.inspectedProperties !== undefined) dbFields.inspected_properties = componentFields.inspectedProperties;  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
      if (componentFields.sourceFileStatus) dbFields.source_file_status = componentFields.sourceFileStatus;
      if (componentFields.codeFileStatus) dbFields.code_file_status = componentFields.codeFileStatus;
      if (componentFields.vendorDetection) dbFields.vendor_detection = componentFields.vendorDetection;
      if (componentFields.workflowStats) dbFields.workflow_stats = componentFields.workflowStats;
      
      // FIXED PERCENT BILLED MAPPING WITH DEBUG
      if (componentFields.percent_billed !== undefined) {
        dbFields.percent_billed = componentFields.percent_billed;
      } else {
      }


      const { data, error } = await supabase
       .from('jobs')
       .update({
         ...dbFields,
         updated_at: new Date().toISOString()
       })
       .eq('id', id)
       .select()
       .single();
      
      if (error) {
        console.error('❌ DEBUG - Supabase update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Job update error:', error);
      throw error;
    }
  },

  // ENHANCED: Delete method with proper cascade deletion
  async delete(id) {
    try {

      // Step 1: Delete related comparison_reports first
      const { error: reportsError } = await supabase
        .from('comparison_reports')
        .delete()
        .eq('job_id', id);
      
      if (reportsError) {
        console.error('Error deleting comparison reports:', reportsError);
        // Don't throw here - continue with job deletion even if no reports exist
      } else {
      }

      // Step 2: Delete related property_change_log records (commented out - table doesn't exist)
      // const { error: changeLogError } = await supabase
      //   .from('property_change_log')
      //   .delete()
      //   .eq('job_id', id);
      // 
      // if (changeLogError) {
      //   console.error('Error deleting change log:', changeLogError);
      //   // Don't throw here - table might not exist or no records
      // } else {
      // }

      // Step 3: Delete related job_assignments
      const { error: assignmentsError } = await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', id);
      
      if (assignmentsError) {
        console.error('Error deleting job assignments:', assignmentsError);
      } else {
      }

      // Step 4: Delete related job_responsibilities (property assignments)
      const { error: responsibilitiesError } = await supabase
        .from('job_responsibilities')
        .delete()
        .eq('job_id', id);
      
      if (responsibilitiesError) {
        console.error('Error deleting job responsibilities:', responsibilitiesError);
      } else {
      }

      // Step 5: Delete related property_records
      const { error: propertyError } = await supabase
        .from('property_records')
        .delete()
        .eq('job_id', id);
      
      if (propertyError) {
        console.error('Error deleting property records:', propertyError);
      } else {
      }

      // Step 6: Delete related source_file_versions
      const { error: sourceFileError } = await supabase
        .from('source_file_versions')
        .delete()
        .eq('job_id', id);
      
      if (sourceFileError) {
        console.error('Error deleting source file versions:', sourceFileError);
      } else {
      }

      // Step 7: Finally delete the job itself
      const { error: jobError } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);
      
      if (jobError) {
        console.error('❌ FINAL ERROR - Failed to delete job:', jobError);
        throw jobError;
      }

      
    } catch (error) {
      console.error('Job deletion error:', error);
      throw error;
    }
  }
};

// ===== PLANNING JOB SERVICES =====
export const planningJobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('planning_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(pj => ({
        id: pj.id,
        ccddCode: pj.ccdd_code,
        ccdd: pj.ccdd_code, // Alternative accessor
        municipality: pj.municipality,
        end_date: pj.end_date,  // Use end_date instead
        comments: pj.comments
      }));
    } catch (error) {
      console.error('Planning jobs error:', error);
      return [];
    }
  },

  async create(planningJobData) {
    try {
      const dbFields = {
        ccdd_code: planningJobData.ccddCode || planningJobData.ccdd,
        municipality: planningJobData.municipality,
        end_date: planningJobData.end_date,
        comments: planningJobData.comments,
        created_by: planningJobData.created_by
      };
      
      const { data, error } = await supabase
        .from('planning_jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const dbFields = {
        ccdd_code: updates.ccddCode || updates.ccdd,
        municipality: updates.municipality,
        end_date: updates.end_date,
        comments: updates.comments
      };

      const { data, error } = await supabase
        .from('planning_jobs')
        .update(dbFields)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('planning_jobs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Planning job deletion error:', error);
      throw error;
    }
  }
};

// ===== CHECKLIST MANAGEMENT SERVICES =====
export const checklistService = {
  // Get all checklist items for a job
  async getChecklistItems(jobId) {
    try {
      console.log('📋 Loading checklist items for job:', jobId);
      
      const { data, error } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('job_id', jobId)
        .order('item_order');
      
      if (error) throw error;
      
      console.log(`✅ Loaded ${data?.length || 0} checklist items`);
      return data || [];
    } catch (error) {
      console.error('Checklist items fetch error:', error);
      return [];
    }
  },

  // Update item status (completed, pending, etc.)
  async updateItemStatus(itemId, status, completedBy) {
    try {
      const updates = {
        status: status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
        completed_by: status === 'completed' ? completedBy : null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Checklist status update error:', error);
      throw error;
    }
  },

  // Update client approval
  async updateClientApproval(itemId, approved, approvedBy) {
    try {
      const updates = {
        client_approved: approved,
        client_approved_date: approved ? new Date().toISOString() : null,
        client_approved_by: approved ? approvedBy : null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Client approval update error:', error);
      throw error;
    }
  },

  // Create initial checklist items for a new job
  async createChecklistForJob(jobId, checklistType = 'revaluation') {
    try {
      console.log('🔨 Creating checklist items for job:', jobId);
      
      // The 29 template items
      const templateItems = [
        // Setup Category (1-8)
        { item_order: 1, item_text: 'Contract Signed by Client', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 2, item_text: 'Contract Signed/Approved by State', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 3, item_text: 'Tax Maps Approved', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 4, item_text: 'Tax Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 5, item_text: 'Zoning Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 6, item_text: 'Zoning Bulk and Use Regulations Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 7, item_text: 'PPA Website Updated', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 8, item_text: 'Data Collection Parameters', category: 'setup', requires_client_approval: true, allows_file_upload: false },
        
        // Inspection Category (9-14)
        { item_order: 9, item_text: 'Initial Mailing List', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_mailing_list' },
        { item_order: 10, item_text: 'Initial Letter and Brochure', category: 'inspection', requires_client_approval: false, allows_file_upload: true, special_action: 'generate_letter' },
        { item_order: 11, item_text: 'Initial Mailing Sent', category: 'inspection', requires_client_approval: false, allows_file_upload: false },
        { item_order: 12, item_text: 'First Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, auto_update_source: 'production_tracker' },
        { item_order: 13, item_text: 'Second Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_second_attempt_mailer' },
        { item_order: 14, item_text: 'Third Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_third_attempt_mailer' },
        
        // Analysis Category (15-26)
        { item_order: 15, item_text: 'Market Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: true },
        { item_order: 16, item_text: 'Page by Page Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 17, item_text: 'Lot Sizing Completed', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 18, item_text: 'Lot Sizing Questions Complete', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 19, item_text: 'VCS Reviewed/Reset', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 20, item_text: 'Land Value Tables Built', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 21, item_text: 'Land Values Entered', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 22, item_text: 'Economic Obsolescence Study', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 23, item_text: 'Cost Conversion Factor Set', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 24, item_text: 'Building Class Review/Updated', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 25, item_text: 'Effective Age Loaded/Set', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 26, item_text: 'Final Values Ready', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        
        // Completion Category (27-29)
        { item_order: 27, item_text: 'View Value Mailer', category: 'completion', requires_client_approval: false, allows_file_upload: true, special_action: 'view_impact_letter' },
        { item_order: 28, item_text: 'Generate Turnover Document', category: 'completion', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_turnover_pdf' },
        { item_order: 29, item_text: 'Turnover Date', category: 'completion', requires_client_approval: false, allows_file_upload: false, input_type: 'date', special_action: 'archive_trigger' }
      ];

      // Add job_id and default status to each item
      const itemsToInsert = templateItems.map(item => ({
        ...item,
        job_id: jobId,
        status: 'pending',
        checklist_type: checklistType,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert)
        .select();
      
      if (error) throw error;
      
      console.log(`✅ Created ${data.length} checklist items for job`);
      return data;
    } catch (error) {
      console.error('Checklist creation error:', error);
      throw error;
    }
  },

  // Update client/assessor name on job
  async updateClientName(jobId, clientName) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          client_name: clientName,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Updated client name:', clientName);
      return data;
    } catch (error) {
      console.error('Client name update error:', error);
      throw error;
    }
  },

  // Update assessor email on job
  async updateAssessorEmail(jobId, assessorEmail) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          assessor_email: assessorEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Updated assessor email:', assessorEmail);
      return data;
    } catch (error) {
      console.error('Assessor email update error:', error);
      throw error;
    }
  },

  // Upload file for checklist item
  async uploadFile(itemId, jobId, file, completedBy) {
    try {
      // Create unique file name
      const timestamp = Date.now();
      const fileName = `${jobId}/${itemId}_${timestamp}_${file.name}`;
      
      console.log('📤 Uploading file to storage:', fileName);
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('checklist-documents')
        .upload(fileName, file);
      
      if (uploadError) throw uploadError;
      
      console.log('💾 Saving file info to database...');
      
      // Save file info to checklist_documents table
      const { data: docData, error: docError } = await supabase
        .from('checklist_documents')
        .insert({
          checklist_item_id: itemId,
          job_id: jobId,
          file_name: file.name,
          file_path: fileName,
          file_size: file.size,
          uploaded_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (docError) throw docError;
      
      console.log('✅ Updating checklist item status...');
      
      // Update checklist item to completed status
      const { data: itemData, error: itemError } = await supabase
        .from('checklist_items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: completedBy,
          file_attachment_path: fileName,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (itemError) throw itemError;
      
      console.log('✅ File uploaded successfully:', fileName);
      return itemData;
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  },

  // UPDATED: Generate mailing list with correct fields - NO FILTERING IN SUPABASE
  async generateMailingList(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select(`
          property_block, 
          property_lot, 
          property_location, 
          property_m4_class,
          property_facility,
          owner_name, 
          owner_street,
          owner_csz
        `)
        .eq('job_id', jobId)
        .order('property_block')
        .order('property_lot')
        .limit(1000);
      
      if (error) throw error;
      
      console.log(`✅ Loaded ${data?.length || 0} properties for mailing list`);
      return data || [];
    } catch (error) {
      console.error('Mailing list generation error:', error);
      throw error;
    }
  },

  // NEW: Get inspection data with pagination for 2nd/3rd attempt mailers
  async getInspectionData(jobId, page = 1, pageSize = 500) {
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact' })
        .eq('job_id', jobId)
        .order('property_block')
        .order('property_lot')
        .range(from, to);
      
      if (error) throw error;
      
      console.log(`✅ Loaded inspection data page ${page} with ${data?.length || 0} records (total: ${count})`);
      
      return {
        data: data || [],
        page,
        pageSize,
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
        hasMore: to < (count || 0) - 1
      };
    } catch (error) {
      console.error('Inspection data fetch error:', error);
      throw error;
    }
  },

  // Helper to get ALL inspection data (handles pagination automatically)
  async getAllInspectionData(jobId) {
    try {
      let allData = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await this.getInspectionData(jobId, page, 1000);
        allData = [...allData, ...result.data];
        hasMore = result.hasMore;
        page++;
        
        // Safety limit to prevent infinite loops
        if (page > 100) {
          console.warn('Reached pagination limit of 100 pages');
          break;
        }
      }

      console.log(`✅ Loaded total of ${allData.length} inspection records`);
      return allData;
    } catch (error) {
      console.error('Error fetching all inspection data:', error);
      throw error;
    }
  },

  // Update notes for a checklist item
  async updateItemNotes(itemId, notes) {
    try {
      const { data, error } = await supabase
        .from('checklist_items')
        .update({ 
          notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Notes update error:', error);
      throw error;
    }
  },

  // Archive job when turnover date is set
  async archiveJob(jobId, turnoverDate) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          status: 'archived',
          turnover_date: turnoverDate,
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Job archived successfully');
      return data;
    } catch (error) {
      console.error('Job archive error:', error);
      throw error;
    }
  }
};

// ===== UNIFIED PROPERTY MANAGEMENT SERVICES =====
export const propertyService = {
  async getAll(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return null;
    }
  },

  async create(propertyData) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert([propertyData])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property creation error:', error);
      throw error;
    }
  },

  async bulkCreate(propertyDataArray) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert(propertyDataArray)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property bulk creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('property_records')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Property deletion error:', error);
      throw error;
    }
  },

  // EXISTING: Import method with versionInfo parameter for FileUploadButton support - CALLS PROCESSORS (INSERT)
  async importCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      console.log(`🔄 Importing ${vendorType} data for job ${jobId}`);
      
      // Use updated processors for single-table insertion
      if (vendorType === 'BRT') {
        const { brtProcessor } = await import('./data-pipeline/brt-processor.js');
        return await brtProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsProcessor } = await import('./data-pipeline/microsystems-processor.js');
        return await microsystemsProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property import error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // ENHANCED: Update method with field preservation that calls UPDATERS (UPSERT) for existing jobs
  async updateCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      console.log(`🔄 Updating ${vendorType} data for job ${jobId} with field preservation`);
      
      // Store preserved fields handler in versionInfo for updaters to use
      versionInfo.preservedFieldsHandler = this.createPreservedFieldsHandler.bind(this);
      versionInfo.preservedFields = PRESERVED_FIELDS;
      
      // Use updaters for UPSERT operations
      if (vendorType === 'BRT') {
        const { brtUpdater } = await import('./data-pipeline/brt-updater.js');
        return await brtUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsUpdater } = await import('./data-pipeline/microsystems-updater.js');
        return await microsystemsUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property update error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // Helper method to create a preserved fields handler for the updaters
  async createPreservedFieldsHandler(jobId, compositeKeys) {
    const preservedDataMap = new Map();

    //Add a small delay to ensure component is fully mounted
    await new Promise(resolve => setTimeout(resolve, 500));
        
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
      
      console.log(`✅ Loaded preserved data for ${preservedDataMap.size} properties`);
    } catch (error) {
      console.error('Error in createPreservedFieldsHandler:', error);
    }

    return preservedDataMap;
  },

  // Query raw_data JSON field for dynamic reporting
  async queryRawData(jobId, fieldName, value) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .eq(`raw_data->>${fieldName}`, value);
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property raw data query error:', error);
      return [];
    }
  },

  // Advanced filtering for analysis
  async getByCondition(jobId, condition) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .eq('condition_rating', condition)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property condition query error:', error);
      return [];
    }
  },

  // Get properties needing inspection
  async getPendingInspections(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .is('inspection_info_by', null)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property pending inspections query error:', error);
      return [];
    }
  },

  // Bulk update inspection data
  async bulkUpdateInspections(inspectionUpdates) {
    try {
      const updates = await Promise.all(
        inspectionUpdates.map(update => 
          supabase
            .from('property_records')
            .update({
              ...update.data,
              updated_at: new Date().toISOString()
            })
            .eq('id', update.id)
            .select()
        )
      );
      
      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Property bulk inspection update error:', error);
      throw error;
    }
  }
};

// ===== SOURCE FILE SERVICES =====
export const sourceFileService = {
  async createVersion(jobId, fileName, fileSize, uploadedBy) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .insert([{
          job_id: jobId,
          file_name: fileName,
          file_size: fileSize,
          status: 'pending',
          uploaded_by: uploadedBy
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file creation error:', error);
      return {
        id: Date.now(),
        version_number: 1,
        file_name: fileName,
        status: 'pending'
      };
    }
  },

  async getVersions(jobId) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file versions error:', error);
      return [];
    }
  },

  async updateStatus(id, status) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file status update error:', error);
      throw error;
    }
  }
};

// ===== PRODUCTION DATA SERVICES =====
export const productionDataService = {
  async updateSummary(jobId) {
    try {
      console.log(`📊 Updating production summary for job ${jobId}`);
      
      // Get property counts from single table
      const { count, error: countError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId);

      if (countError) throw countError;

      // Count properties with inspection data
      const { count: inspectedCount, error: inspectedError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .not('inspection_info_by', 'is', null);

      if (inspectedError) throw inspectedError;

      // Update job with current totals
      const { data, error } = await supabase
        .from('jobs')
        .update({
          total_properties: count || 0,
          // inspected_properties: inspectedCount || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
          workflow_stats: {
            properties_processed: count || 0,
            properties_inspected: inspectedCount || 0,
            last_updated: new Date().toISOString()
          }
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Production data update error:', error);
      return { success: false, error: error.message };
    }
  }
};

// ===== UTILITY SERVICES =====
export const utilityService = {
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id')
        .limit(1);
      
      return { success: !error, error };
    } catch (error) {
      return { success: false, error: error };
    }
  },

  // ENHANCED: Assignment-aware stats function with correct property class field names
  async getStats() {
    try {
      // Get basic counts separately to avoid Promise.all masking errors
      const { count: employeeCount, error: empError } = await supabase
        .from('employees')
        .select('id', { count: 'exact', head: true });

      const { count: jobCount, error: jobError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true });

      // UPDATED: Count all properties (assigned or unassigned)
      const { count: propertyCount, error: propError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get residential properties (M4 class 2, 3A) - assignment-aware
      const { count: residentialCount, error: residentialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['2', '3A'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get commercial properties (M4 class 4A, 4B, 4C) - assignment-aware
      const { count: commercialCount, error: commercialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['4A', '4B', '4C'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // Log any errors but don't fail completely
      if (empError) console.error('Employee count error:', empError);
      if (jobError) console.error('Job count error:', jobError);
      if (propError) console.error('Property count error:', propError);
      if (residentialError) console.error('Residential count error:', residentialError);
      if (commercialError) console.error('Commercial count error:', commercialError);

      const totalProperties = propertyCount || 0;
      const residential = residentialCount || 0;
      const commercial = commercialCount || 0;
      const other = Math.max(0, totalProperties - residential - commercial);

      return {
        employees: employeeCount || 0,
        jobs: jobCount || 0,
        properties: totalProperties,
        propertiesBreakdown: {
          total: totalProperties,
          residential: residential,
          commercial: commercial,
          other: other
        }
      };
    } catch (error) {
      console.error('Stats fetch error:', error);
      return {
        employees: 0,
        jobs: 0,
        properties: 0,
        propertiesBreakdown: {
          total: 0,
          residential: 0,
          commercial: 0,
          other: 0
        }
      };
    }
  }
};

// ===== AUTHENTICATION SERVICES =====
export const authService = {
  async getCurrentUser() {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      if (user) {
        const { data: employee, error: empError } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', user.id)
          .single();
        
        if (empError) {
          console.warn('Employee profile not found');
          return {
            ...user,
            role: 'admin',
            canAccessBilling: true
          };
        }
        
        return {
          ...user,
          employee,
          role: employee.role,
          canAccessBilling: ['admin', 'owner'].includes(employee.role) || user.id === '5df85ca3-7a54-4798-a665-c31da8d9caad'
        };
      }
      
      return null;
    } catch (error) {
      console.error('Auth error:', error);
      return null;
    }
  },

  async signInAsDev() {
    return {
      user: {
        id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
        email: 'ppalead1@gmail.com'
      },
      role: 'admin',
      canAccessBilling: true
    };
  },

  async signIn(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  },

  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }
};

// ===== LEGACY COMPATIBILITY =====
export const signInAsDev = authService.signInAsDev;

// ===== PRESERVED FIELDS HANDLER EXPORT =====
// Export the handler for FileUploadButton to pass to updaters
export const preservedFieldsHandler = propertyService.createPreservedFieldsHandler;

// ===== AUTH HELPER FUNCTIONS =====
export const authHelpers = {
  // Get current user with role
  getCurrentUser: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('email', session.user.email.toLowerCase())
        .single();

      return {
        ...session.user,
        role: employee?.role || 'inspector',
        employeeData: employee
      };
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  },

  // Check if user has required role
  hasRole: async (requiredRole) => {
    const user = await authHelpers.getCurrentUser();
    if (!user) return false;

    const roleHierarchy = {
      admin: 3,
      manager: 2,
      inspector: 1
    };

    return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
  },

  // Subscribe to auth changes
  onAuthStateChange: (callback) => {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const user = await authHelpers.getCurrentUser();
        callback(event, user);
      } else {
        callback(event, null);
      }
    });
  },

  // Update user has_account flag when account is created
  updateHasAccount: async (email) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ has_account: true })
        .eq('email', email.toLowerCase());

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error updating has_account:', error);
      return { success: false, error };
    }
  }
};

// ===== WORKSHEET SERVICE FOR PRE-VALUATION SETUP =====
export const worksheetService = {
  // Initialize or get existing market_land_valuation record
  async initializeMarketLandRecord(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('*')
      .eq('job_id', jobId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // Record doesn't exist, create it
      const { data: newRecord, error: createError } = await supabase
        .from('market_land_valuation')
        .insert({
          job_id: jobId,
          normalization_config: {},
          time_normalized_sales: [],
          normalization_stats: {},
          worksheet_data: {},
          worksheet_stats: {
            last_saved: new Date().toISOString(),
            entries_completed: 0,
            ready_to_process: 0,
            location_variations: {}
          }
        })
        .select()
        .single();
      
      if (createError) throw createError;
      return newRecord;
    }
    
    if (error) throw error;
    return data;
  },

  // Save normalization configuration
  async saveNormalizationConfig(jobId, config) {
    await this.initializeMarketLandRecord(jobId);
    
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        normalization_config: config,
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Save time normalized sales results
  async saveTimeNormalizedSales(jobId, sales, stats) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        time_normalized_sales: sales,
        normalization_stats: stats,
        last_normalization_run: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Load saved normalization data
  async loadNormalizationData(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('normalization_config, time_normalized_sales, normalization_stats, last_normalization_run')
      .eq('job_id', jobId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // No record exists yet
      return null;
    }
    
    if (error) throw error;
    return data;
  },

  // Save worksheet stats
  async saveWorksheetStats(jobId, stats) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_stats: stats,
        last_worksheet_save: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Save worksheet data changes
  async saveWorksheetData(jobId, worksheetData) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_data: worksheetData,
        last_worksheet_save: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Load saved worksheet data
  async loadWorksheetData(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('worksheet_data, worksheet_stats, last_worksheet_save')
      .eq('job_id', jobId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // No record exists yet
      return null;
    }
    
    if (error) throw error;
    return data;
  },

  // Update location standards
  async updateLocationStandards(jobId, locationVariations) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_stats: {
          location_variations: locationVariations
        }
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  }
};

export default supabase;
