// LandValuationTab.jsx - SECTION 1: Imports and State Setup
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Check, X, Plus, Search, TrendingUp, AlertCircle, 
  Calculator, Download, Trash2, RefreshCw, Filter, 
  Save, FileDown, ChevronDown, ChevronUp, MapPin, 
  Home, DollarSign 
} from 'lucide-react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';

const LandValuationTab = ({
  properties,
  jobData,
  vendorType,
  marketLandData,
  onAnalysisUpdate
}) => {
  // ========== MAIN TAB STATE ==========
  const [activeSubTab, setActiveSubTab] = useState('land-rates');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  
  // ========== MODE SELECTION (NEW) ==========
  const [valuationMode, setValuationMode] = useState('acre'); // acre, sf, ff
  const [canUseFrontFoot, setCanUseFrontFoot] = useState(false);

  // ========== SPECIAL REGIONS CONFIG ==========
  const SPECIAL_REGIONS = [
    'Normal',
    'Pinelands',
    'Highlands', 
    'Coastal',
    'Wetlands',
    'Conservation',
    'Historic District',
    'Redevelopment Zone',
    'Transit Village'
  ];

  // ========== LAND RATES STATE ==========
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear() - 5, 0, 1),
    end: new Date()
  });
  const [vacantSales, setVacantSales] = useState([]);
  const [includedSales, setIncludedSales] = useState(new Set());
  const [saleCategories, setSaleCategories] = useState({});
  const [specialRegions, setSpecialRegions] = useState({});
  const [landNotes, setLandNotes] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCopiedNotification, setShowCopiedNotification] = useState(false);
  const [searchFilters, setSearchFilters] = useState({
    class: '',
    block: '',
    lot: '',
    priceMin: '',
    priceMax: '',
    specialRegion: ''
  });
  const [searchResults, setSearchResults] = useState([]);
  const [selectedToAdd, setSelectedToAdd] = useState(new Set());
  
  // CASCADE CONFIGURATION - ENHANCED FOR FLEXIBILITY
  const [cascadeConfig, setCascadeConfig] = useState({
    mode: 'acre',
    normal: {
      prime: { max: 1, rate: null },
      secondary: { max: 5, rate: null },
      excess: { max: 10, rate: null },
      residual: { max: null, rate: null }
    },
    special: {},
    specialCategories: {
      wetlands: null,
      landlocked: null,
      conservation: null
    },
    customCategories: []
  });
  
  // VCS Analysis
  const [showAllVCS, setShowAllVCS] = useState(false);
  const [vcsFilter, setVcsFilter] = useState('');
  const [bracketAnalysis, setBracketAnalysis] = useState({});
  const [method2Summary, setMethod2Summary] = useState({});

  // Enhanced Method 2 UI State - Use vendor-specific default codes
  const [method2TypeFilter, setMethod2TypeFilter] = useState(vendorType === 'Microsystems' ? '1' : '10');
  const [expandedVCS, setExpandedVCS] = useState(new Set());
  const [vcsColors, setVcsColors] = useState({});

  // ========== ALLOCATION STUDY STATE ==========
  const [vacantTestSales, setVacantTestSales] = useState([]);
  const [improvedTestSales, setImprovedTestSales] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [allocationVcsFilter, setAllocationVcsFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [actualAllocations, setActualAllocations] = useState({});
  const [vcsSiteValues, setVcsSiteValues] = useState({});
  const [targetAllocation, setTargetAllocation] = useState(null);
  const [currentOverallAllocation, setCurrentOverallAllocation] = useState(0);

  // ========== VCS SHEET STATE - ENHANCED ==========
  const [vcsSheetData, setVcsSheetData] = useState({});
  const [vcsTypes, setVcsTypes] = useState({});
  const [vcsManualSiteValues, setVcsManualSiteValues] = useState({});
  const [vcsPropertyCounts, setVcsPropertyCounts] = useState({});
  const [vcsZoningData, setVcsZoningData] = useState({});
  const [vcsDescriptions, setVcsDescriptions] = useState({});
  const [vcsRecommendedSites, setVcsRecommendedSites] = useState({});

  // ========== ECONOMIC OBSOLESCENCE STATE - ENHANCED ==========
  const [ecoObsFactors, setEcoObsFactors] = useState({});
  const [locationCodes, setLocationCodes] = useState({});
  const [trafficLevels, setTrafficLevels] = useState({});
  const [typeUseFilter, setTypeUseFilter] = useState({});
  const [computedAdjustments, setComputedAdjustments] = useState({});
  const [actualAdjustments, setActualAdjustments] = useState({});
  const [ecoObsFilter, setEcoObsFilter] = useState('');
  const [customLocationCodes, setCustomLocationCodes] = useState([]);
  
  // STANDARD LOCATION CODES
  const LOCATION_CODES = {
    negative: ['BS', 'CM', 'RR', 'PL', 'ES'],
    positive: ['GV', 'GC', 'WV', 'WF'],
    custom: customLocationCodes
  };
// ========== INITIALIZE FROM PROPS ==========
useEffect(() => {
  if (!marketLandData) {
    setIsLoading(false);
    return;
  }

  // Restore all saved states from marketLandData
  if (marketLandData.raw_land_config) {
    if (marketLandData.raw_land_config.date_range) {
      setDateRange({
        start: new Date(marketLandData.raw_land_config.date_range.start),
        end: new Date(marketLandData.raw_land_config.date_range.end)
      });
    }
    if (marketLandData.raw_land_config.cascade_config) {
      // Ensure the structure is complete
      const savedConfig = marketLandData.raw_land_config.cascade_config;
      setCascadeConfig({
        mode: savedConfig.mode || 'acre',
        normal: {
          prime: savedConfig.normal?.prime || { max: 1, rate: null },
          secondary: savedConfig.normal?.secondary || { max: 5, rate: null },
          excess: savedConfig.normal?.excess || { max: 10, rate: null },
          residual: savedConfig.normal?.residual || { max: null, rate: null },
          standard: savedConfig.normal?.standard || { max: 100, rate: null }
        },
        special: savedConfig.special || {},
        specialCategories: savedConfig.specialCategories || {
          wetlands: null,
          landlocked: null,
          conservation: null
        },
        customCategories: savedConfig.customCategories || []
      });
      if (savedConfig.mode) {
        setValuationMode(savedConfig.mode);
      }
    }
  }

  // Skip the duplicate cascade_rates assignment - it's redundant
  // if (marketLandData.cascade_rates) {
  //   setCascadeConfig(marketLandData.cascade_rates);
  // }

  if (marketLandData.vacant_sales_analysis?.sales) {
    const savedCategories = {};
    const savedNotes = {};
    const savedRegions = {};
    const savedIncluded = new Set();
    
    marketLandData.vacant_sales_analysis.sales.forEach(s => {
      if (s.category) savedCategories[s.id] = s.category;
      if (s.notes) savedNotes[s.id] = s.notes;
      if (s.special_region) savedRegions[s.id] = s.special_region;
      if (s.included) savedIncluded.add(s.id);
    });
    
    setSaleCategories(savedCategories);
    setLandNotes(savedNotes);
    setSpecialRegions(savedRegions);
    setIncludedSales(savedIncluded);
  }

  if (marketLandData.allocation_study) {
    if (marketLandData.allocation_study.actual_allocations) {
      setActualAllocations(marketLandData.allocation_study.actual_allocations);
    }
    if (marketLandData.allocation_study.vcs_site_values) {
      setVcsSiteValues(marketLandData.allocation_study.vcs_site_values);
    }
    if (marketLandData.allocation_study.target_allocation) {
      setTargetAllocation(marketLandData.allocation_study.target_allocation);
    }
  }

  if (marketLandData.vcs_sheet_data) {
    setVcsSheetData(marketLandData.vcs_sheet_data);
    if (marketLandData.vcs_sheet_data.manual_site_values) {
      setVcsManualSiteValues(marketLandData.vcs_sheet_data.manual_site_values);
    }
    if (marketLandData.vcs_sheet_data.descriptions) {
      setVcsDescriptions(marketLandData.vcs_sheet_data.descriptions);
    }
    if (marketLandData.vcs_sheet_data.types) {
      setVcsTypes(marketLandData.vcs_sheet_data.types);
    }
  }

  if (marketLandData.economic_obsolescence) {
    setEcoObsFactors(marketLandData.economic_obsolescence.factors || {});
    setLocationCodes(marketLandData.economic_obsolescence.location_codes || {});
    setTrafficLevels(marketLandData.economic_obsolescence.traffic_levels || {});
    setActualAdjustments(marketLandData.economic_obsolescence.actual_adjustments || {});
    setCustomLocationCodes(marketLandData.economic_obsolescence.custom_codes || []);
  }

  setLastSaved(marketLandData.updated_at ? new Date(marketLandData.updated_at) : null);
  setIsLoading(false);
}, [marketLandData]);

  // ========== CHECK FRONT FOOT AVAILABILITY ==========
  useEffect(() => {
    if (jobData?.parsed_code_definitions && vendorType) {
      let hasFrontFootData = false;
      
      if (vendorType === 'BRT') {
        // Check for Depth tables in parsed_code_definitions
        const depthSection = jobData.parsed_code_definitions.sections?.Depth;
        hasFrontFootData = depthSection && Object.keys(depthSection).length > 0;
      } else if (vendorType === 'Microsystems') {
        // Check for 205 depth codes with rates
        const codes = jobData.parsed_code_definitions.codes;
        if (codes) {
          hasFrontFootData = codes.some(c => 
            c.code && c.code.startsWith('205') && c.rate && c.rate > 0
          );
        }
      }
      
      setCanUseFrontFoot(hasFrontFootData);
    }
  }, [jobData, vendorType]);

  // ========== CALCULATE CURRENT OVERALL ALLOCATION ==========
  useEffect(() => {
    if (properties && properties.length > 0) {
      const improvedProps = properties.filter(p => 
        (p.property_m4_class === '2' || p.property_m4_class === '3A') &&
        p.values_mod_land > 0 && p.values_mod_total > 0
      );
      
      if (improvedProps.length > 0) {
        const totalLand = improvedProps.reduce((sum, p) => sum + p.values_mod_land, 0);
        const totalValue = improvedProps.reduce((sum, p) => sum + p.values_mod_total, 0);
        setCurrentOverallAllocation((totalLand / totalValue * 100).toFixed(1));
      }
    }
  }, [properties]);

  // ========== CALCULATE ACREAGE HELPER - ENHANCED ==========
  const calculateAcreage = useCallback((property) => {
    // Always return acres - don't convert here
    const acres = interpretCodes.getCalculatedAcreage(property, vendorType);
    return parseFloat(acres);
  }, [vendorType]);

  // ========== GET PRICE PER UNIT ==========
const getPricePerUnit = useCallback((price, size) => {
  if (valuationMode === 'acre') {
    return size > 0 ? Math.round(price / size) : 0;
  } else if (valuationMode === 'sf') {
    // size is already in acres, convert to SF then calculate price per SF
    const sizeInSF = size * 43560;
    return sizeInSF > 0 ? parseFloat(price / sizeInSF) : 0;
  } else if (valuationMode === 'ff') {
    // For front foot, need frontage
    return 0; // Will be calculated differently
  }
}, [valuationMode]);

  // ========== GET UNIT LABEL ==========
  const getUnitLabel = useCallback(() => {
    if (valuationMode === 'acre') return '$/Acre';
    if (valuationMode === 'sf') return '$/SF';
    if (valuationMode === 'ff') return '$/FF';
    return '$/Unit';
  }, [valuationMode]);

  // ========== GENERATE VCS COLORS ==========
  const generateVCSColor = useCallback((vcs, index) => {
    // Light, distinct backgrounds - NO REDS/PINKS
    const lightColors = [
      '#E0F2FE', '#DBEAFE', '#E0E7FF', '#EDE9FE', '#F0FDF4',
      '#ECFDF5', '#FEF3C7', '#FFFBEB', '#F7FEE7', '#EFF6FF',
      '#F0F9FF', '#F1F5F9', '#F8FAFC', '#FAFAF9', '#F3F4F6',
      '#E5E7EB', '#D1FAE5', '#DCFCE7', '#FEF9C3', '#FDF4FF'
    ];

    // Dark, readable text colors - NO REDS
    const darkColors = [
      '#0E7490', '#1D4ED8', '#4338CA', '#6D28D9', '#166534',
      '#047857', '#A16207', '#D97706', '#65A30D', '#0284C7',
      '#475569', '#64748B', '#374151', '#1F2937', '#111827',
      '#0F172A', '#15803D', '#16A34A', '#CA8A04', '#7C3AED'
    ];

    return {
      background: lightColors[index % lightColors.length],
      text: darkColors[index % darkColors.length]
    };
  }, []);

  // ========== GET TYPE USE OPTIONS ==========
  const getTypeUseOptions = useCallback(() => {
    const defaultCode = vendorType === 'Microsystems' ? '1' : '10';
    if (!properties) return [{ code: defaultCode, description: 'Single Family' }];

    const typeCodeMap = new Map();
    typeCodeMap.set(defaultCode, 'Single Family'); // Always include default

    // Get all unique asset_type_use codes from properties
    const uniqueCodes = new Set();
    properties.forEach(prop => {
      if (prop.asset_type_use && prop.property_m4_class === '2') {
        const rawCode = prop.asset_type_use.toString().trim().toUpperCase();
        if (rawCode && rawCode !== '' && rawCode !== 'null' && rawCode !== 'undefined') {
          uniqueCodes.add(rawCode);
        }
      }
    });

    // Add individual codes that exist in the data
    uniqueCodes.forEach(rawCode => {
      if (!typeCodeMap.has(rawCode)) {
        const description = vendorType === 'Microsystems' && jobData?.parsed_code_definitions
          ? interpretCodes.getMicrosystemsValue?.({ asset_type_use: rawCode }, jobData.parsed_code_definitions, 'asset_type_use') || rawCode
          : rawCode;
        typeCodeMap.set(rawCode, description);
      }
    });

    // Add group options only if we have matching codes
    const groupMappings = [
      { codes: ['30', '31', '3E', '3I'], groupCode: '3-GROUP', description: '3 - Row/Townhouses' },
      { codes: ['42', '43', '44'], groupCode: '4-GROUP', description: '4 - MultiFamily' },
      { codes: ['51', '52', '53'], groupCode: '5-GROUP', description: '5 - Conversions' }
    ];

    groupMappings.forEach(group => {
      const hasMatchingCodes = group.codes.some(code => uniqueCodes.has(code));
      if (hasMatchingCodes) {
        typeCodeMap.set(group.groupCode, group.description);
      }
    });

    // Convert to array of objects and sort by code
    return Array.from(typeCodeMap.entries())
      .map(([code, description]) => ({ code, description }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [properties, vendorType, jobData]);

  // ========== GET VCS DESCRIPTION HELPER ==========
  const getVCSDescription = useCallback((vcsCode) => {
    // First check manual descriptions
    if (vcsDescriptions[vcsCode]) {
      return vcsDescriptions[vcsCode];
    }
    
    // Then try to get from code definitions
    if (jobData?.parsed_code_definitions && vendorType) {
      if (vendorType === 'BRT') {
        const vcsSection = jobData.parsed_code_definitions.sections?.VCS;
        if (vcsSection && vcsSection[vcsCode]) {
          const vcsData = vcsSection[vcsCode];
          if (vcsData.MAP && vcsData.MAP['9']) {
            return vcsData.MAP['9'].DATA?.VALUE || vcsCode;
          }
        }
      } else if (vendorType === 'Microsystems') {
        const codes = jobData.parsed_code_definitions.codes;
        if (codes) {
          const vcsEntry = codes.find(c => 
            c.code && c.code.startsWith('210') && 
            c.code.includes(vcsCode)
          );
          if (vcsEntry) return vcsEntry.description;
        }
      }
    }
    
    return vcsCode; // Return code if no description found
  }, [jobData, vendorType, vcsDescriptions]);

  // ========== LOAD DATA EFFECTS ==========
  // Update filter when vendor type changes
  useEffect(() => {
    const defaultCode = vendorType === 'Microsystems' ? '1' : '10';
    setMethod2TypeFilter(defaultCode);
  }, [vendorType]);

  useEffect(() => {
    if (properties && properties.length > 0) {
      filterVacantSales();
      performBracketAnalysis();
      loadVCSPropertyCounts();
    }
  }, [properties, dateRange, valuationMode, method2TypeFilter]);

  useEffect(() => {
    if (activeSubTab === 'allocation' && cascadeConfig.normal.prime) {
      loadAllocationStudyData();
    }
  }, [activeSubTab, cascadeConfig, valuationMode]);

  useEffect(() => {
    if (activeSubTab === 'eco-obs' && properties) {
      analyzeEconomicObsolescence();
    }
  }, [activeSubTab, properties]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      saveAnalysis();
    }, 30000);
    return () => clearInterval(interval);
  }, [cascadeConfig, landNotes, saleCategories, specialRegions, actualAllocations, 
      vcsManualSiteValues, actualAdjustments, targetAllocation, locationCodes, vcsTypes]);
  // ========== LAND RATES FUNCTIONS WITH ENHANCED FILTERS ==========
  const filterVacantSales = useCallback(() => {
    if (!properties) return;

    // First identify all vacant/teardown/pre-construction sales
    const allSales = properties.filter(prop => {
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const inDateRange = prop.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          prop.sales_date <= dateRange.end.toISOString().split('T')[0];
      
      // Check NU codes for valid sales
      const nu = prop.sales_nu || '';
      const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu === '07' || 
                      nu === '7' || nu.charCodeAt(0) === 32;

      // Skip additional cards - they don't have land
      const isAdditionalCard = prop.property_addl_card && 
                        prop.property_addl_card !== 'NONE' && 
                        prop.property_addl_card !== 'M';
      if (isAdditionalCard) {
        return false;
      }
      
      // Standard vacant classes
      const isVacantClass = prop.property_m4_class === '1' || prop.property_m4_class === '3B';
      
      // NEW: Teardown detection (Class 2 with minimal improvement)
      const isTeardown = prop.property_m4_class === '2' &&
                        prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                        prop.asset_design_style && 
                        prop.asset_type_use &&
                        prop.values_mod_improvement < 10000;
      
      // NEW: Pre-construction detection (sold before house was built)
      const isPreConstruction = prop.property_m4_class === '2' &&
                               prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                               prop.asset_design_style && 
                               prop.asset_type_use &&
                               prop.asset_year_built &&
                               prop.sales_date &&
                               new Date(prop.sales_date).getFullYear() < prop.asset_year_built;
      
      return hasValidSale && inDateRange && validNu && (isVacantClass || isTeardown || isPreConstruction);
    });

    // Group by book/page for package handling
    const packageGroups = {};
    const standalone = [];
    
    allSales.forEach(prop => {
      if (prop.sales_book && prop.sales_page) {
        const key = `${prop.sales_book}-${prop.sales_page}`;
        if (!packageGroups[key]) packageGroups[key] = [];
        packageGroups[key].push(prop);
      } else {
        standalone.push(prop);
      }
    });

    // Helper function to enrich property with calculated fields
    const enrichProperty = (prop, isPackage = false) => {
      const acres = calculateAcreage(prop);
      const pricePerUnit = getPricePerUnit(prop.sales_price, acres);
      
      // Auto-categorize teardowns and pre-construction
      let category = saleCategories[prop.id];
      // Check for additional cards on same property
      const hasAdditionalCards = properties.some(p => 
        p.property_block === prop.property_block &&
        p.property_lot === prop.property_lot &&
        p.property_addl_card && 
        p.property_addl_card !== 'NONE' &&
        p.property_addl_card !== 'M' &&
        p.sales_date === prop.sales_date
      );

      if (hasAdditionalCards && !isPackage) {
        prop.packageData = {
          is_package: true,
          package_type: 'additional_cards',
          package_count: 2
        };
      }
      if (!category) {
        if (prop.property_m4_class === '2' && prop.values_mod_improvement < 10000) {
          category = 'teardown';
        } else if (prop.property_m4_class === '2' && 
                   prop.asset_year_built && 
                   new Date(prop.sales_date).getFullYear() < prop.asset_year_built) {
          category = 'pre-construction';
        }
      }
      
      return {
        ...prop,
        totalAcres: acres,
        pricePerAcre: pricePerUnit,
        autoCategory: category,
        isPackage
      };
    };

    // Process packages and standalone
    const finalSales = [];
    
    // Consolidate package sales
    Object.entries(packageGroups).forEach(([key, group]) => {
      if (group.length > 1) {
        // Sum up package totals
        const totalPrice = group.reduce((sum, p) => sum + p.sales_price, 0);
        const totalAcres = group.reduce((sum, p) => sum + calculateAcreage(p), 0);
        const pricePerUnit = getPricePerUnit(totalPrice, totalAcres);
        
        // Create consolidated entry
        const packageSale = {
          ...group[0], // Use first property as base
          id: `package_${key}`,
          property_block: group[0].property_block,
          property_lot: `${group[0].property_lot} (+${group.length - 1} more)`,
          property_location: 'Multiple Properties',
          sales_price: totalPrice,
          totalAcres: totalAcres,
          pricePerAcre: pricePerUnit,
          packageData: {
            is_package: true,
            package_count: group.length,
            properties: group.map(p => p.property_composite_key)
          },
          autoCategory: 'package'
        };
        
        finalSales.push(packageSale);
        
        // Auto-include package in analysis
        setIncludedSales(prev => new Set([...prev, packageSale.id]));
      } else {
        // Single property with book/page
        const enriched = enrichProperty(group[0]);
        finalSales.push(enriched);
        if (enriched.autoCategory) {
          setSaleCategories(prev => ({...prev, [enriched.id]: enriched.autoCategory}));
        }
      }
    });
    
    // Add standalone properties
    standalone.forEach(prop => {
      const enriched = enrichProperty(prop);
      finalSales.push(enriched);
      if (enriched.autoCategory) {
        setSaleCategories(prev => ({...prev, [prop.id]: enriched.autoCategory}));
      }
    });

    setVacantSales(finalSales);
    // Auto-include all new sales
    setIncludedSales(new Set(finalSales.map(s => s.id)));
  }, [properties, dateRange, calculateAcreage, getPricePerUnit, saleCategories]);

  const performBracketAnalysis = useCallback(async () => {
    if (!properties || !jobData?.id) return;

    try {
      // Get properties with time normalization data from the correct tables
      const { data: timeNormalizedData, error } = await supabase
        .from('property_market_analysis')
        .select(`
          property_composite_key,
          new_vcs,
          values_norm_time
        `)
        .inner('property_records', 'property_composite_key', 'property_composite_key')
        .eq('property_records.job_id', jobData.id)
        .eq('property_records.property_m4_class', '2')
        .not('values_norm_time', 'is', null)
        .gt('values_norm_time', 0);

      if (error) {
        console.error('Error fetching time normalized data:', error);
        return;
      }

      if (!timeNormalizedData || timeNormalizedData.length === 0) {
        setBracketAnalysis({});
        return;
      }

      // Create a lookup for time normalized data
      const timeNormLookup = new Map();
      timeNormalizedData.forEach(item => {
        timeNormLookup.set(item.property_composite_key, item);
      });

      const vcsSales = {};

      // Filter properties that have time normalization data
      properties.forEach(prop => {
        const timeNormData = timeNormLookup.get(prop.property_composite_key);
        if (!timeNormData) return;

        // Only residential for bracket analysis
        if (prop.property_m4_class !== '2' && prop.property_m4_class !== '3A') return;

        // Must have valid sales data
        if (!prop.sales_price || prop.sales_price <= 0) return;

        // Valid NU codes for actual sales (not transfer codes)
        const nu = prop.sales_nu || '';
        const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu === '07' ||
                        nu === '7' || nu.charCodeAt(0) === 32;
        if (!validNu) return;

        // Apply type/use filter - SIMPLIFIED
        const rawTypeUse = prop.asset_type_use?.toString().trim();
        if (rawTypeUse !== method2TypeFilter) return;

        const vcs = timeNormData.new_vcs;
        if (!vcs) return;

        if (!vcsSales[vcs]) {
          vcsSales[vcs] = [];
        }

        const acres = parseFloat(prop.asset_lot_acre || 0);
        const sfla = parseFloat(prop.asset_sfla || 0);

        vcsSales[vcs].push({
          acres,
          salesPrice: prop.sales_price,
          normalizedTime: timeNormData.values_norm_time,
          sfla,
          address: prop.property_location,
          yearBuilt: prop.asset_year_built,
          saleDate: prop.sales_date,
          typeUse: prop.asset_type_use
        });
      });

      const analysis = {};
      let validRates = [];

      Object.keys(vcsSales).forEach(vcs => {
        const sales = vcsSales[vcs];
        if (sales.length < 3) return; // Need minimum sales for analysis

        // Sort by acreage for bracketing
        sales.sort((a, b) => a.acres - b.acres);

        const brackets = {
          small: sales.filter(s => s.acres < 1),
          medium: sales.filter(s => s.acres >= 1 && s.acres < 5),
          large: sales.filter(s => s.acres >= 5 && s.acres < 10),
          xlarge: sales.filter(s => s.acres >= 10)
        };

        // Calculate overall VCS average SFLA for size adjustment
        const allValidSFLA = sales.filter(s => s.sfla > 0);
        const overallAvgSFLA = allValidSFLA.length > 0 ?
          allValidSFLA.reduce((sum, s) => sum + s.sfla, 0) / allValidSFLA.length : null;

        // FIXED statistics calculation
        const calcBracketStats = (arr) => {
          if (arr.length === 0) return {
            count: 0,
            avgAcres: null,
            avgSalePrice: null,
            avgNormTime: null,
            avgSFLA: null,
            avgAdjusted: null
          };

          const avgSalePrice = arr.reduce((sum, s) => sum + s.salesPrice, 0) / arr.length;
          const avgAcres = arr.reduce((sum, s) => sum + s.acres, 0) / arr.length;
          const validSFLA = arr.filter(s => s.sfla > 0);
          const avgSFLA = validSFLA.length > 0 ?
            validSFLA.reduce((sum, s) => sum + s.sfla, 0) / validSFLA.length : null;

          // Jim's Magic Formula for size adjustment
          let avgAdjusted = avgSalePrice;
          if (overallAvgSFLA && avgSFLA && avgSFLA > 0) {
            const sflaDiff = overallAvgSFLA - avgSFLA;
            const pricePerSqFt = avgSalePrice / avgSFLA;
            const sizeAdjustment = sflaDiff * (pricePerSqFt * 0.50);
            avgAdjusted = avgSalePrice + sizeAdjustment;
          }

          return {
            count: arr.length,
            avgAcres: Math.round(avgAcres * 100) / 100, // Round to 2 decimals
            avgSalePrice: Math.round(avgSalePrice),
            avgNormTime: Math.round(arr.reduce((sum, s) => sum + s.normalizedTime, 0) / arr.length),
            avgSFLA: avgSFLA ? Math.round(avgSFLA) : null,
            avgAdjusted: Math.round(avgAdjusted)
          };
        };

        const bracketStats = {
          small: calcBracketStats(brackets.small),
          medium: calcBracketStats(brackets.medium),
          large: calcBracketStats(brackets.large),
          xlarge: calcBracketStats(brackets.xlarge)
        };

        // Calculate implied rate from bracket differences
        let impliedRate = null;
        if (bracketStats.small.count > 0 && bracketStats.medium.count > 0) {
          const priceDiff = bracketStats.medium.avgAdjusted - bracketStats.small.avgAdjusted;
          const acresDiff = bracketStats.medium.avgAcres - bracketStats.small.avgAcres;
          if (acresDiff > 0 && priceDiff > 0) {
            impliedRate = Math.round(priceDiff / acresDiff);
            validRates.push(impliedRate);
          }
        }

        analysis[vcs] = {
          totalSales: sales.length,
          avgPrice: Math.round(sales.reduce((sum, s) => sum + s.salesPrice, 0) / sales.length),
          avgAcres: Math.round((sales.reduce((sum, s) => sum + s.acres, 0) / sales.length) * 100) / 100,
          avgAdjusted: Math.round(sales.reduce((sum, s) => sum + s.normalizedTime, 0) / sales.length),
          brackets: bracketStats,
          impliedRate
        };
      });

      // Calculate Method 2 Summary
      if (validRates.length > 0) {
        validRates.sort((a, b) => a - b);
        const average = Math.round(validRates.reduce((sum, r) => sum + r, 0) / validRates.length);
        const median = validRates.length % 2 === 0 ?
          Math.round((validRates[validRates.length / 2 - 1] + validRates[validRates.length / 2]) / 2) :
          validRates[Math.floor(validRates.length / 2)];

        setMethod2Summary({
          average,
          median,
          coverage: `${validRates.length} of ${Object.keys(vcsSales).length} VCS areas`,
          min: validRates[0],
          max: validRates[validRates.length - 1]
        });
      }

      setBracketAnalysis(analysis);

    } catch (error) {
      console.error('Error in performBracketAnalysis:', error);
      setBracketAnalysis({});
    }
  }, [properties, jobData, method2TypeFilter]);

  const calculateRates = useCallback((regionFilter = null) => {
    const included = vacantSales.filter(s => {
      if (!includedSales.has(s.id)) return false;
      // Exclude special categories from rate calculation
      if (saleCategories[s.id] === 'wetlands' || 
          saleCategories[s.id] === 'landlocked' ||
          saleCategories[s.id] === 'conservation') return false;
      // Filter by special region if specified
      if (regionFilter && specialRegions[s.id] !== regionFilter) return false;
      return true;
    });

    if (included.length === 0) return { average: 0, median: 0, count: 0, min: 0, max: 0 };

    const rates = included.map(s => s.pricePerAcre).filter(r => r > 0);
    rates.sort((a, b) => a - b);

    const average = Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
    const median = rates.length % 2 === 0 ?
      Math.round((rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2) :
      rates[Math.floor(rates.length / 2)];
    const min = rates[0];
    const max = rates[rates.length - 1];

    return { average, median, count: included.length, min, max };
  }, [vacantSales, includedSales, saleCategories, specialRegions]);

  const searchProperties = () => {
    if (!properties) return;

    let results = [...properties]; // Start with all properties

    // Apply filters
    if (searchFilters.class) {
      results = results.filter(p => p.property_m4_class === searchFilters.class);
    }
    if (searchFilters.block) {
      results = results.filter(p => p.property_block?.toLowerCase().includes(searchFilters.block.toLowerCase()));
    }
    if (searchFilters.lot) {
      results = results.filter(p => p.property_lot?.toLowerCase().includes(searchFilters.lot.toLowerCase()));
    }
    if (searchFilters.priceMin) {
      results = results.filter(p => p.sales_price >= parseInt(searchFilters.priceMin));
    }
    if (searchFilters.priceMax) {
      results = results.filter(p => p.sales_price <= parseInt(searchFilters.priceMax));
    }

    // Must be in date range and have valid sale
    results = results.filter(p => {
      const hasValidSale = p.sales_date && p.sales_price && p.sales_price > 0;
      const inDateRange = p.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                          p.sales_date <= dateRange.end.toISOString().split('T')[0];
      return hasValidSale && inDateRange;
    });

    // Exclude already added properties
    const existingIds = new Set(vacantSales.map(s => s.id));
    results = results.filter(p => !existingIds.has(p.id));

    setSearchResults(results);
  };
  const addSelectedProperties = () => {
    const toAdd = properties.filter(p => selectedToAdd.has(p.id));

    const enriched = toAdd.map(prop => {
      const acres = calculateAcreage(prop);
      const pricePerUnit = getPricePerUnit(prop.sales_price, acres);
      return {
        ...prop,
        totalAcres: acres,
        pricePerAcre: pricePerUnit,
        manuallyAdded: true
      };
    });

    setVacantSales([...vacantSales, ...enriched]);
    setIncludedSales(new Set([...includedSales, ...toAdd.map(p => p.id)]));
    
    // Check if any are teardowns (Class 2)
    toAdd.forEach(p => {
      if (p.property_m4_class === '2') {
        setSaleCategories(prev => ({...prev, [p.id]: 'teardown'}));
      }
    });
    
    setSelectedToAdd(new Set());
    setShowAddModal(false);
    setSearchResults([]);
  };

  const handlePropertyResearch = async (property) => {
    const prompt = `Analyze this land sale in ${jobData?.municipality || 'Unknown'}, ${jobData?.county || 'Unknown'} County, NJ:

Block ${property.property_block} Lot ${property.property_lot}
Address: ${property.property_location}
Sale Date: ${property.sales_date}
Sale Price: $${property.sales_price?.toLocaleString()}
Acres: ${property.totalAcres?.toFixed(2)}
Price/Acre: $${property.pricePerAcre?.toLocaleString()}
Class: ${property.property_m4_class === '2' ? 'Residential (possible teardown)' : property.property_m4_class}

Identify likely factors affecting this sale price (wetlands, access, zoning, teardown value, etc.). Be specific and actionable for valuation purposes. 2-3 sentences.`;

    try {
      await navigator.clipboard.writeText(prompt);
      
      setLandNotes(prev => ({
        ...prev, 
        [property.id]: '📋 Prompt copied! Opening Claude... (paste response here when ready)'
      }));
      
      window.open('https://claude.ai/new', '_blank');
      
      setTimeout(() => {
        setLandNotes(prev => ({
          ...prev,
          [property.id]: ''
        }));
      }, 3000);
      
    } catch (err) {
      console.error('Failed to copy:', err);
      setLandNotes(prev => ({
        ...prev, 
        [property.id]: `Copy this to Claude:\n${prompt}`
      }));
      window.open('https://claude.ai/new', '_blank');
      setShowCopiedNotification(true);
      setTimeout(() => setShowCopiedNotification(false), 5000);
    }
  };

  const removeSale = (saleId) => {
    setVacantSales(prev => prev.filter(s => s.id !== saleId));
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      newSet.delete(saleId);
      return newSet;
    });
  };

  // ========== ALLOCATION STUDY FUNCTIONS ==========
  const loadAllocationStudyData = useCallback(() => {
    if (!cascadeConfig.normal.prime) return;

    // Process vacant sales by VCS and Year
    const vcsSiteValuesByYear = {};

    // Group vacant sales by VCS and Year
    vacantSales.filter(s => includedSales.has(s.id)).forEach(sale => {
      const year = new Date(sale.sales_date).getFullYear();
      const vcs = sale.new_vcs;
      const region = specialRegions[sale.id] || 'Normal';
      
      if (!vcs) return;
      
      const key = `${vcs}_${year}_${region}`;
      if (!vcsSiteValuesByYear[key]) {
        vcsSiteValuesByYear[key] = {
          vcs,
          year,
          region,
          sales: []
        };
      }
      
      // Calculate site value for this sale
      const acres = sale.totalAcres || parseFloat(calculateAcreage(sale));
      const cascadeRates = region === 'Normal' ? cascadeConfig.normal : cascadeConfig.special[region];
      
      if (!cascadeRates) return;
      
      let remainingAcres = acres;
      let rawLandValue = 0;
      
      // Apply cascade calculation
      if (cascadeRates.prime) {
        const primeAcres = Math.min(remainingAcres, cascadeRates.prime.max || 1);
        rawLandValue += primeAcres * (cascadeRates.prime.rate || 0);
        remainingAcres -= primeAcres;
      }
      
      if (cascadeRates.secondary && remainingAcres > 0) {
        const secondaryMax = (cascadeRates.secondary.max || 5) - (cascadeRates.prime?.max || 1);
        const secondaryAcres = Math.min(remainingAcres, secondaryMax);
        rawLandValue += secondaryAcres * (cascadeRates.secondary.rate || 0);
        remainingAcres -= secondaryAcres;
      }
      
      if (cascadeRates.excess && remainingAcres > 0) {
        const excessMax = (cascadeRates.excess.max || 10) - (cascadeRates.secondary?.max || 5);
        const excessAcres = Math.min(remainingAcres, excessMax);
        rawLandValue += excessAcres * (cascadeRates.excess.rate || 0);
        remainingAcres -= excessAcres;
      }
      
      if (cascadeRates.residual && remainingAcres > 0) {
        rawLandValue += remainingAcres * (cascadeRates.residual.rate || 0);
      }
      
      const siteValue = sale.sales_price - rawLandValue;
      
      // Only include positive site values
      if (siteValue > 0) {
        vcsSiteValuesByYear[key].sales.push({
          id: sale.id,
          block: sale.property_block,
          lot: sale.property_lot,
          price: sale.sales_price,
          acres,
          rawLandValue,
          siteValue
        });
      }
    });

    // Calculate average site values per VCS/Year
    const processedVacant = [];
    const siteValuesByVCS = {};

    Object.values(vcsSiteValuesByYear).forEach(group => {
      if (group.sales.length === 0) return;
      
      const avgSiteValue = group.sales.reduce((sum, s) => sum + s.siteValue, 0) / group.sales.length;
      
      // Add individual sales to vacant test
      group.sales.forEach(sale => {
        processedVacant.push({
          ...sale,
          vcs: group.vcs,
          year: group.year,
          region: group.region,
          avgSiteValue
        });
      });
      
      // Store for improved test
      if (!siteValuesByVCS[group.vcs]) {
        siteValuesByVCS[group.vcs] = {};
      }
      siteValuesByVCS[group.vcs][`${group.year}_${group.region}`] = avgSiteValue;
    });

    setVacantTestSales(processedVacant);
    setVcsSiteValues(siteValuesByVCS);
    loadImprovedSales(siteValuesByVCS);
  }, [cascadeConfig, vacantSales, includedSales, specialRegions, calculateAcreage]);

  const loadImprovedSales = useCallback((siteValues) => {
    if (!properties || Object.keys(siteValues).length === 0) return;

    // Group improved sales by VCS and Year
    const improvedByVCSYear = {};

    properties.forEach(prop => {
      const isResidential = prop.property_m4_class === '2' || prop.property_m4_class === '3A';
      const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
      const hasBuilding = prop.asset_year_built && prop.asset_year_built > 0;
      const hasValues = prop.values_mod_land > 0 && prop.values_mod_total > 0;
      
      if (!isResidential || !hasValidSale || !hasBuilding || !hasValues) return;
      
      const year = new Date(prop.sales_date).getFullYear();
      const vcs = prop.new_vcs;
      
      if (!vcs || !siteValues[vcs]) return;
      
      const key = `${vcs}_${year}`;
      if (!improvedByVCSYear[key]) {
        improvedByVCSYear[key] = {
          vcs,
          year,
          properties: []
        };
      }
      
      improvedByVCSYear[key].properties.push(prop);
    });

    // Process each VCS/Year group
    const processed = [];

    Object.values(improvedByVCSYear).forEach(group => {
      if (group.properties.length === 0) return;
      
      // Calculate averages for the group
      const avgPrice = group.properties.reduce((sum, p) => sum + p.sales_price, 0) / group.properties.length;
      const avgAcres = group.properties.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / group.properties.length;
      
      // Get current allocation from assessment records
      const currentAllocs = group.properties.map(p => p.values_mod_land / p.values_mod_total);
      const currentAllocation = currentAllocs.reduce((sum, a) => sum + a, 0) / currentAllocs.length;
      
      // Calculate recommended allocation using cascade and site value
      const region = 'Normal'; // Default for improved sales
      const cascadeRates = cascadeConfig.normal;
      
      let remainingAcres = avgAcres;
      let rawLandValue = 0;
      
      // Apply cascade
      if (cascadeRates.prime) {
        const primeAcres = Math.min(remainingAcres, cascadeRates.prime.max || 1);
        rawLandValue += primeAcres * (cascadeRates.prime.rate || 0);
        remainingAcres -= primeAcres;
      }
      
      if (cascadeRates.secondary && remainingAcres > 0) {
        const secondaryMax = (cascadeRates.secondary.max || 5) - (cascadeRates.prime?.max || 1);
        const secondaryAcres = Math.min(remainingAcres, secondaryMax);
        rawLandValue += secondaryAcres * (cascadeRates.secondary.rate || 0);
        remainingAcres -= secondaryAcres;
      }
      
      if (cascadeRates.excess && remainingAcres > 0) {
        const excessMax = (cascadeRates.excess.max || 10) - (cascadeRates.secondary?.max || 5);
        const excessAcres = Math.min(remainingAcres, excessMax);
        rawLandValue += excessAcres * (cascadeRates.excess.rate || 0);
        remainingAcres -= excessAcres;
      }
      
      if (cascadeRates.residual && remainingAcres > 0) {
        rawLandValue += remainingAcres * (cascadeRates.residual.rate || 0);
      }
      
      // Get site value for this VCS/Year
      const siteValue = siteValues[group.vcs][`${group.year}_Normal`] || 0;
      const totalLandValue = rawLandValue + siteValue;
      const recommendedAllocation = avgPrice > 0 ? totalLandValue / avgPrice : 0;
      
      processed.push({
        vcs: group.vcs,
        year: group.year,
        salesCount: group.properties.length,
        avgPrice: Math.round(avgPrice),
        avgAcres: avgAcres.toFixed(2),
        rawLandValue: Math.round(rawLandValue),
        siteValue: Math.round(siteValue),
        totalLandValue: Math.round(totalLandValue),
        recommendedAllocation,
        currentAllocation
      });
    });

    setImprovedTestSales(processed);
  }, [properties, calculateAcreage, cascadeConfig]);

  const getUniqueRegions = useCallback(() => {
    const regions = new Set(['Normal']);
    Object.values(specialRegions).forEach(r => regions.add(r));
    return Array.from(regions);
  }, [specialRegions]);

  const getUniqueYears = useCallback(() => {
    const years = new Set();
    [...vacantTestSales, ...improvedTestSales].forEach(sale => {
      if (sale.year) years.add(sale.year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [vacantTestSales, improvedTestSales]);

  const getUniqueVCS = useCallback(() => {
    const vcs = new Set();
    [...vacantTestSales, ...improvedTestSales].forEach(sale => {
      if (sale.vcs) vcs.add(sale.vcs);
    });
    return Array.from(vcs).sort();
  }, [vacantTestSales, improvedTestSales]);

  const calculateAllocationStats = useCallback((region = null) => {
    let filtered = improvedTestSales;
    
    if (region && region !== 'all') {
      filtered = filtered.filter(s => s.region === region);
    }
    
    if (filtered.length === 0) return null;
    
    const allocations = filtered.map(s => s.recommendedAllocation * 100);
    const avg = allocations.reduce((sum, a) => sum + a, 0) / allocations.length;
    const within25to40 = allocations.filter(a => a >= 25 && a <= 40).length;
    const percentInRange = (within25to40 / allocations.length) * 100;
    
    return {
      averageAllocation: avg.toFixed(1),
      percentInTargetRange: percentInRange.toFixed(1),
      totalSales: filtered.length
    };
  }, [improvedTestSales]);
  // ========== VCS SHEET FUNCTIONS - ENHANCED ==========
  const loadVCSPropertyCounts = useCallback(() => {
    if (!properties) return;

    const counts = {};
    const zoning = {};
    const mapPages = {};
    const keyPages = {};
    const avgNormTime = {};
    const avgNormSize = {};
    const avgActualPrice = {};

    properties.forEach(prop => {
      if (!prop.new_vcs) return;
      
      if (!counts[prop.new_vcs]) {
        counts[prop.new_vcs] = {
          total: 0,
          residential: 0,
          commercial: 0,
          vacant: 0,
          condo: 0,
          apartment: 0,
          industrial: 0,
          special: 0
        };
        zoning[prop.new_vcs] = new Set();
        mapPages[prop.new_vcs] = new Set();
        keyPages[prop.new_vcs] = new Set();
        avgNormTime[prop.new_vcs] = [];
        avgNormSize[prop.new_vcs] = [];
        avgActualPrice[prop.new_vcs] = [];
      }
      
      counts[prop.new_vcs].total++;
      
      // Count by property class
      if (prop.property_m4_class === '2' || prop.property_m4_class === '3A') {
        counts[prop.new_vcs].residential++;
        
        // Collect averages for residential with valid sales
        if (prop.sales_price > 0 && prop.sales_date) {
          const saleYear = new Date(prop.sales_date).getFullYear();
          const currentYear = new Date().getFullYear();
          
          // Last 3 years of sales
          if (currentYear - saleYear <= 3) {
            if (prop.values_norm_time > 0) avgNormTime[prop.new_vcs].push(prop.values_norm_time);
            if (prop.values_norm_size > 0) avgNormSize[prop.new_vcs].push(prop.values_norm_size);
            
            // Valid NU codes for actual price
            const nu = prop.sales_nu || '';
            const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu === '07' || 
                           nu === '7' || nu.charCodeAt(0) === 32;
            if (validNu) avgActualPrice[prop.new_vcs].push(prop.sales_price);
          }
        }
      } else if (prop.property_m4_class === '4A' || prop.property_m4_class === '4B' || prop.property_m4_class === '4C') {
        counts[prop.new_vcs].commercial++;
      } else if (prop.property_m4_class === '1' || prop.property_m4_class === '3B') {
        counts[prop.new_vcs].vacant++;
      } else if (prop.property_m4_class === '4D') {
        counts[prop.new_vcs].condo++;
      } else if (prop.property_m4_class === '4E') {
        counts[prop.new_vcs].apartment++;
      } else if (prop.property_m4_class === '5A' || prop.property_m4_class === '5B') {
        counts[prop.new_vcs].industrial++;
      } else {
        counts[prop.new_vcs].special++;
      }
      
      // Collect unique zoning codes
      if (prop.asset_zoning) {
        zoning[prop.new_vcs].add(prop.asset_zoning);
      }
      
      // Collect map and key pages
      if (prop.asset_map_page) {
        mapPages[prop.new_vcs].add(prop.asset_map_page);
      }
      if (prop.asset_key_page) {
        keyPages[prop.new_vcs].add(prop.asset_key_page);
      }
    });

    // Convert sets to formatted strings and calculate averages
    const formattedZoning = {};
    const formattedMapPages = {};
    const formattedKeyPages = {};
    const calculatedAvgNormTime = {};
    const calculatedAvgNormSize = {};
    const calculatedAvgPrice = {};
    
    Object.keys(zoning).forEach(vcs => {
      formattedZoning[vcs] = Array.from(zoning[vcs]).sort().join(', ');
      
      // Format map pages (e.g., "12-15, 18, 22-24")
      const pages = Array.from(mapPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b);
      formattedMapPages[vcs] = formatPageRanges(pages);
      
      const keys = Array.from(keyPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b);
      formattedKeyPages[vcs] = formatPageRanges(keys);
      
      // Calculate averages
      calculatedAvgNormTime[vcs] = avgNormTime[vcs].length > 0 ? 
        Math.round(avgNormTime[vcs].reduce((sum, v) => sum + v, 0) / avgNormTime[vcs].length) : null;
      calculatedAvgNormSize[vcs] = avgNormSize[vcs].length > 0 ? 
        Math.round(avgNormSize[vcs].reduce((sum, v) => sum + v, 0) / avgNormSize[vcs].length) : null;
      calculatedAvgPrice[vcs] = avgActualPrice[vcs].length > 0 ? 
        Math.round(avgActualPrice[vcs].reduce((sum, v) => sum + v, 0) / avgActualPrice[vcs].length) : null;
    });

    setVcsPropertyCounts(counts);
    setVcsZoningData(formattedZoning);
    
    // Calculate recommended site values for VCS Sheet
    calculateVCSRecommendedSites(calculatedAvgNormTime, counts);
    
    // Store in vcsSheetData for display
    const sheetData = {};
    Object.keys(counts).forEach(vcs => {
      sheetData[vcs] = {
        counts: counts[vcs],
        zoning: formattedZoning[vcs],
        mapPages: formattedMapPages[vcs],
        keyPages: formattedKeyPages[vcs],
        avgNormTime: calculatedAvgNormTime[vcs],
        avgNormSize: calculatedAvgNormSize[vcs],
        avgPrice: calculatedAvgPrice[vcs]
      };
    });
    
    setVcsSheetData(sheetData);
  }, [properties]);

  const calculateVCSRecommendedSites = useCallback((avgNormTimes, counts) => {
    if (!targetAllocation || !cascadeConfig.normal.prime) return;
    
    const recommendedSites = {};
    
    Object.keys(avgNormTimes).forEach(vcs => {
      // Only calculate for residential VCS
      if (counts[vcs].residential === 0) return;
      
      const avgNormTime = avgNormTimes[vcs];
      if (!avgNormTime) return;
      
      // Get average lot size for this VCS
      const vcsProps = properties.filter(p => 
        p.new_vcs === vcs && 
        (p.property_m4_class === '2' || p.property_m4_class === '3A')
      );
      
      if (vcsProps.length === 0) return;
      
      const avgAcres = vcsProps.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProps.length;
      
      // Apply cascade to get raw land value
      let remainingAcres = avgAcres;
      let rawLandValue = 0;
      const cascadeRates = cascadeConfig.normal;
      
      if (cascadeRates.prime) {
        const primeAcres = Math.min(remainingAcres, cascadeRates.prime.max || 1);
        rawLandValue += primeAcres * (cascadeRates.prime.rate || 0);
        remainingAcres -= primeAcres;
      }
      
      if (cascadeRates.secondary && remainingAcres > 0) {
        const secondaryMax = (cascadeRates.secondary.max || 5) - (cascadeRates.prime?.max || 1);
        const secondaryAcres = Math.min(remainingAcres, secondaryMax);
        rawLandValue += secondaryAcres * (cascadeRates.secondary.rate || 0);
        remainingAcres -= secondaryAcres;
      }
      
      if (cascadeRates.excess && remainingAcres > 0) {
        const excessMax = (cascadeRates.excess.max || 10) - (cascadeRates.secondary?.max || 5);
        const excessAcres = Math.min(remainingAcres, excessMax);
        rawLandValue += excessAcres * (cascadeRates.excess.rate || 0);
        remainingAcres -= excessAcres;
      }
      
      if (cascadeRates.residual && remainingAcres > 0) {
        rawLandValue += remainingAcres * (cascadeRates.residual.rate || 0);
      }
      
      // Calculate site value using target allocation
      const totalLandValue = avgNormTime * (parseFloat(targetAllocation) / 100);
      const siteValue = totalLandValue - rawLandValue;
      
      recommendedSites[vcs] = Math.round(siteValue);
    });
    
    setVcsRecommendedSites(recommendedSites);
  }, [targetAllocation, cascadeConfig, properties, calculateAcreage]);

  const formatPageRanges = (pages) => {
    if (pages.length === 0) return '';
    
    const ranges = [];
    let start = pages[0];
    let end = pages[0];
    
    for (let i = 1; i < pages.length; i++) {
      if (pages[i] === end + 1) {
        end = pages[i];
      } else {
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        start = pages[i];
        end = pages[i];
      }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    
    return ranges.join(', ');
  };

  const updateManualSiteValue = (vcs, value) => {
    setVcsManualSiteValues(prev => ({
      ...prev,
      [vcs]: value ? parseInt(value) : null
    }));
  };

  const updateVCSDescription = (vcs, description) => {
    setVcsDescriptions(prev => ({
      ...prev,
      [vcs]: description
    }));
  };

  const updateVCSType = (vcs, type) => {
    setVcsTypes(prev => ({
      ...prev,
      [vcs]: type
    }));
  };

  // ========== ECONOMIC OBSOLESCENCE FUNCTIONS - ENHANCED ==========
  const analyzeEconomicObsolescence = useCallback(() => {
    if (!properties) return;

    const factors = {};
    const computed = {};

    // Group properties by VCS and location factor
    properties.forEach(prop => {
      if (!prop.new_vcs || !prop.sales_price || prop.sales_price <= 0) return;
      if (!prop.location_analysis) return;
      
      const vcs = prop.new_vcs;
      const location = prop.location_analysis;
      
      // Assign location codes based on analysis
      let codes = [];
      const locationLower = location.toLowerCase();
      
      // Check for negative factors
      if (locationLower.includes('busy') || locationLower.includes('highway') || 
          locationLower.includes('route') || locationLower.includes('traffic')) {
        codes.push('BS');
      }
      if (locationLower.includes('commercial')) codes.push('CM');
      if (locationLower.includes('railroad') || locationLower.includes('rail')) codes.push('RR');
      if (locationLower.includes('power') || locationLower.includes('electric')) codes.push('PL');
      if (locationLower.includes('easement')) codes.push('ES');
      
      // Check for positive factors
      if (locationLower.includes('golf')) {
        if (locationLower.includes('view')) codes.push('GV');
        else codes.push('GC');
      }
      if (locationLower.includes('water') || locationLower.includes('lake') || 
          locationLower.includes('river') || locationLower.includes('ocean')) {
        if (locationLower.includes('front')) codes.push('WF');
        else if (locationLower.includes('view')) codes.push('WV');
      }
      
      const codeString = codes.join('/') || 'None';
      setLocationCodes(prev => ({...prev, [prop.id]: codeString}));
      
      if (!factors[vcs]) {
        factors[vcs] = {};
      }
      
      if (!factors[vcs][codeString]) {
        factors[vcs][codeString] = {
          withFactor: [],
          withoutFactor: []
        };
      }
      
      // Add property to appropriate group
      factors[vcs][codeString].withFactor.push({
        id: prop.id,
        price: prop.sales_price,
        normalizedTime: prop.values_norm_time || prop.sales_price,
        normalizedSize: prop.values_norm_size || prop.sales_price,
        acres: parseFloat(calculateAcreage(prop)),
        address: prop.property_location,
        year: prop.asset_year_built,
        yearSold: new Date(prop.sales_date).getFullYear(),
        typeUse: prop.asset_type_use,
        design: prop.asset_design_style
      });
    });

    // Find comparable sales without factors for each VCS
    Object.keys(factors).forEach(vcs => {
      // Get baseline sales (no location factors)
      const baselineSales = properties.filter(prop => 
        prop.new_vcs === vcs && 
        (!prop.location_analysis || prop.location_analysis === '' || 
         (!locationCodes[prop.id] || locationCodes[prop.id] === 'None')) &&
        prop.sales_price > 0
      ).map(prop => ({
        id: prop.id,
        price: prop.sales_price,
        normalizedTime: prop.values_norm_time || prop.sales_price,
        normalizedSize: prop.values_norm_size || prop.sales_price,
        acres: parseFloat(calculateAcreage(prop)),
        year: prop.asset_year_built,
        yearSold: new Date(prop.sales_date).getFullYear(),
        typeUse: prop.asset_type_use,
        design: prop.asset_design_style
      }));
      
      // Store baseline for all location factors in this VCS
      Object.keys(factors[vcs]).forEach(codes => {
        if (codes !== 'None') {
          factors[vcs][codes].withoutFactor = baselineSales;
        }
      });
    });

    setEcoObsFactors(factors);
    setComputedAdjustments(computed);
  }, [properties, calculateAcreage, locationCodes]);
  const updateActualAdjustment = (vcs, location, value) => {
    const key = `${vcs}_${location}`;
    setActualAdjustments(prev => ({
      ...prev,
      [key]: value ? parseFloat(value) : null
    }));
  };

  const updateTrafficLevel = (propertyId, level) => {
    setTrafficLevels(prev => ({
      ...prev,
      [propertyId]: level
    }));
  };

  const updateTypeUseFilter = (vcs, location, typeUse) => {
    const key = `${vcs}_${location}`;
    setTypeUseFilter(prev => ({
      ...prev,
      [key]: typeUse
    }));
  };

  const calculateEcoObsImpact = useCallback((vcs, codes, typeUse = null) => {
    if (!ecoObsFactors[vcs] || !ecoObsFactors[vcs][codes]) return null;
    
    let withFactor = ecoObsFactors[vcs][codes].withFactor;
    let withoutFactor = ecoObsFactors[vcs][codes].withoutFactor;
    
    // Filter by type use if specified
    if (typeUse && typeUse !== 'all') {
      withFactor = withFactor.filter(p => p.typeUse === typeUse);
      withoutFactor = withoutFactor.filter(p => p.typeUse === typeUse);
    }
    
    // Filter by traffic level for BS codes
    if (codes.includes('BS') && trafficLevels) {
      const trafficFilter = Object.entries(trafficLevels)
        .filter(([id, level]) => level)
        .map(([id, level]) => ({ id, level }));
      
      if (trafficFilter.length > 0) {
        withFactor = withFactor.filter(p => {
          const traffic = trafficLevels[p.id];
          return traffic; // Only include if traffic level is set
        });
      }
    }
    
    if (withFactor.length === 0 || withoutFactor.length === 0) return null;
    
    // Calculate averages
    const avgWithTime = withFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withFactor.length;
    const avgWithSize = withFactor.reduce((sum, s) => sum + s.normalizedSize, 0) / withFactor.length;
    const avgWithFinal = (avgWithTime + avgWithSize) / 2; // Jim's formula
    const avgWithYear = Math.round(withFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withFactor.length);
    
    const avgWithoutTime = withoutFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withoutFactor.length;
    const avgWithoutSize = withoutFactor.reduce((sum, s) => sum + s.normalizedSize, 0) / withoutFactor.length;
    const avgWithoutFinal = (avgWithoutTime + avgWithoutSize) / 2;
    const avgWithoutYear = Math.round(withoutFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withoutFactor.length);
    
    const impact = ((avgWithFinal - avgWithoutFinal) / avgWithoutFinal) * 100;
    
    // NULL out positive impacts for negative factors and vice versa
    const isNegativeFactor = codes.split('/').some(c => 
      ['BS', 'CM', 'RR', 'PL', 'ES'].includes(c)
    );
    const isPositiveFactor = codes.split('/').some(c => 
      ['GV', 'GC', 'WV', 'WF'].includes(c)
    );
    
    if (isNegativeFactor && impact > 0) return null;
    if (isPositiveFactor && impact < 0) return null;
    
    return {
      withCount: withFactor.length,
      withYearBuilt: avgWithYear,
      withNormTime: Math.round(avgWithTime),
      withNormSize: Math.round(avgWithSize),
      withAvg: Math.round(avgWithFinal),
      withoutCount: withoutFactor.length,
      withoutYearBuilt: avgWithoutYear,
      withoutNormTime: Math.round(avgWithoutTime),
      withoutNormSize: Math.round(avgWithoutSize),
      withoutAvg: Math.round(avgWithoutFinal),
      impact: impact.toFixed(1)
    };
  }, [ecoObsFactors, trafficLevels]);

  const addCustomLocationCode = (code, description, isPositive) => {
    const newCode = {
      code: code.toUpperCase(),
      description,
      isPositive
    };
    setCustomLocationCodes(prev => [...prev, newCode]);
  };

  // ========== SAVE & EXPORT FUNCTIONS ==========
  const saveAnalysis = async () => {
    if (!jobData?.id) return;

    setIsSaving(true);

    try {
      const analysisData = {
        job_id: jobData.id,
        valuation_method: valuationMode,
        raw_land_config: {
          date_range: dateRange,
          cascade_config: cascadeConfig
        },
        vacant_sales_analysis: {
          sales: vacantSales.map(s => ({
            id: s.id,
            included: includedSales.has(s.id),
            category: saleCategories[s.id] || null,
            special_region: specialRegions[s.id] || 'Normal',
            notes: landNotes[s.id] || null,
            manually_added: s.manuallyAdded || false,
            is_package: s.packageData?.is_package || false,
            package_properties: s.packageData?.properties || []
          })),
          rates: calculateRates(),
          rates_by_region: getUniqueRegions().map(region => ({
            region,
            rates: calculateRates(region)
          }))
        },
        bracket_analysis: bracketAnalysis,
        method2_summary: method2Summary,
        cascade_rates: cascadeConfig,
        allocation_study: {
          vcs_site_values: vcsSiteValues,
          actual_allocations: actualAllocations,
          target_allocation: targetAllocation,
          current_overall_allocation: currentOverallAllocation,
          stats: calculateAllocationStats()
        },
        vcs_sheet_data: {
          property_counts: vcsPropertyCounts,
          zoning_data: vcsZoningData,
          manual_site_values: vcsManualSiteValues,
          recommended_sites: vcsRecommendedSites,
          descriptions: vcsDescriptions,
          types: vcsTypes,
          sheet_data: vcsSheetData
        },
        economic_obsolescence: {
          factors: ecoObsFactors,
          location_codes: locationCodes,
          traffic_levels: trafficLevels,
          computed_adjustments: computedAdjustments,
          actual_adjustments: actualAdjustments,
          custom_codes: customLocationCodes
        },
        updated_at: new Date().toISOString()
      };
      
      // Check if record exists
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();
      
      if (existing) {
        await supabase
          .from('market_land_valuation')
          .update(analysisData)
          .eq('job_id', jobData.id);
      } else {
        await supabase
          .from('market_land_valuation')
          .insert(analysisData);
      }
      
      setLastSaved(new Date());
      
      // Notify parent component
      if (onAnalysisUpdate) {
        onAnalysisUpdate(analysisData);
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Failed to save analysis. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const exportToExcel = (type) => {
    let csv = '';
    const timestamp = new Date().toISOString().split('T')[0];
    const municipality = jobData?.municipality || 'export';
    const filename = `${type}_${municipality}_${timestamp}.csv`;

    if (type === 'land-rates') {
      csv = exportLandRates();
    } else if (type === 'allocation') {
      csv = exportAllocation();
    } else if (type === 'vcs-sheet') {
      csv = exportVCSSheet();
    } else if (type === 'eco-obs') {
      csv = exportEconomicObsolescence();
    } else if (type === 'complete') {
      csv = exportCompleteAnalysis();
    }

    // Create and download file
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const exportLandRates = () => {
    let csv = 'LAND RATES ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Analysis Period: ${dateRange.start.toLocaleDateString()} to ${dateRange.end.toLocaleDateString()}\n`;
    csv += `Valuation Mode: ${valuationMode.toUpperCase()}\n\n`;
    
    // Summary by Region
    csv += 'SUMMARY BY SPECIAL REGION\n';
    csv += `Region,Count,Average ${getUnitLabel()},Median ${getUnitLabel()},Min ${getUnitLabel()},Max ${getUnitLabel()}\n`;
    
    getUniqueRegions().forEach(region => {
      const rates = calculateRates(region);
      csv += `"${region}",${rates.count},${rates.average},${rates.median},${rates.min},${rates.max}\n`;
    });
    
    // Individual Sales
    csv += '\n\nMETHOD 1: VACANT LAND SALES DETAIL\n';
    csv += 'Block,Lot,Address,VCS,Special Region,Category,Sale Date,Sale Price,Size,Price/Unit,Package,Included,Notes\n';
    
    vacantSales.forEach(sale => {
      const category = saleCategories[sale.id] || 'Uncategorized';
      const region = specialRegions[sale.id] || 'Normal';
      const isPackage = sale.packageData ? `Y (${sale.packageData.package_count})` : 'N';
      const included = includedSales.has(sale.id) ? 'Y' : 'N';
      const notes = landNotes[sale.id] || '';
      const sizeLabel = valuationMode === 'acre' ? sale.totalAcres?.toFixed(2) : 
                       valuationMode === 'sf' ? Math.round(sale.totalAcres * 43560) : sale.totalAcres;
      
      csv += `"${sale.property_block}","${sale.property_lot}","${sale.property_location}","${sale.new_vcs || ''}","${region}","${category}","${sale.sales_date}",${sale.sales_price},${sizeLabel},${sale.pricePerAcre},"${isPackage}","${included}","${notes}"\n`;
    });
    
    // Method 2 Analysis
    csv += '\n\nMETHOD 2: IMPROVED SALE LOT SIZE ANALYSIS\n';
    csv += 'VCS,Total Sales,<1 Acre,1-5 Acres,5-10 Acres,>10 Acres,Implied Rate\n';
    
    Object.entries(bracketAnalysis).sort(([a], [b]) => a.localeCompare(b)).forEach(([vcs, data]) => {
      const impliedRate = data.impliedRate !== null ? data.impliedRate : 'NULL';
      csv += `"${vcs}",${data.totalSales},${data.brackets.small.count},${data.brackets.medium.count},${data.brackets.large.count},${data.brackets.xlarge.count},${impliedRate}\n`;
    });
    
    // Method 2 Summary
    if (method2Summary.average) {
      csv += '\n\nMETHOD 2 SUMMARY\n';
      csv += `Average Implied Rate,${method2Summary.average}\n`;
      csv += `Median Implied Rate,${method2Summary.median}\n`;
      csv += `Coverage,${method2Summary.coverage}\n`;
      csv += `Range,"${method2Summary.min} - ${method2Summary.max}"\n`;
    }
    
    // Cascade Configuration
    csv += '\n\nCASCADE RATE CONFIGURATION\n';
    if (valuationMode === 'ff') {
      csv += `Standard (0-${cascadeConfig.normal.standard?.max || 100}ft):,$${cascadeConfig.normal.standard?.rate || 0}\n`;
      csv += `Excess (${cascadeConfig.normal.standard?.max || 100}+ft):,$${cascadeConfig.normal.excess?.rate || 0}\n`;
    } else {
      csv += `Prime (0-${cascadeConfig.normal.prime?.max || 1} ${valuationMode}):,$${cascadeConfig.normal.prime?.rate || 0}\n`;
      csv += `Secondary (${cascadeConfig.normal.prime?.max || 1}-${cascadeConfig.normal.secondary?.max || 5} ${valuationMode}):,$${cascadeConfig.normal.secondary?.rate || 0}\n`;
      csv += `Excess (${cascadeConfig.normal.secondary?.max || 5}-${cascadeConfig.normal.excess?.max || 10} ${valuationMode}):,$${cascadeConfig.normal.excess?.rate || 0}\n`;
      csv += `Residual (${cascadeConfig.normal.excess?.max || 10}+ ${valuationMode}):,$${cascadeConfig.normal.residual?.rate || 0}\n`;
    }
    
    // Special Categories
    if (Object.keys(cascadeConfig.specialCategories).length > 0) {
      csv += '\n\nSPECIAL CATEGORY RATES\n';
      Object.entries(cascadeConfig.specialCategories).forEach(([category, rate]) => {
        if (rate !== null) {
          csv += `${category},$${rate}\n`;
        }
      });
    }
    
    return csv;
  };
  const exportAllocation = () => {
    let csv = 'ALLOCATION STUDY\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n`;
    csv += `Current Overall Allocation: ${currentOverallAllocation}%\n`;
    csv += `Recommended Allocation: ${calculateAllocationStats()?.averageAllocation || 0}%\n`;
    csv += `Target Allocation: ${targetAllocation || 'Not Set'}%\n\n`;
    
    // Stats by Region
    const regions = getUniqueRegions();
    if (regions.length > 1) {
      csv += 'ALLOCATION STATISTICS BY REGION\n';
      csv += 'Region,Avg Allocation %,% In Target Range (25-40%),Sample Size\n';
      
      regions.forEach(region => {
        const stats = calculateAllocationStats(region);
        if (stats) {
          csv += `"${region}",${stats.averageAllocation},${stats.percentInTargetRange},${stats.totalSales}\n`;
        }
      });
      csv += '\n';
    }
    
    // Vacant Land Test
    csv += 'VACANT LAND TEST\n';
    csv += 'VCS,Year,Region,Block,Lot,Sale Price,Acres,Raw Land,Site Value,Status\n';
    
    vacantTestSales.forEach(sale => {
      const status = sale.siteValue > 0 ? 'Valid' : 'Excluded';
      csv += `"${sale.vcs}",${sale.year},"${sale.region}","${sale.block}","${sale.lot}",${sale.price},${sale.acres.toFixed(2)},${sale.rawLandValue},${sale.siteValue},"${status}"\n`;
    });
    
    // Improved Sales Test
    csv += '\n\nIMPROVED SALES ALLOCATION TEST\n';
    csv += 'VCS,Year,Sales Count,Avg Price,Avg Acres,Raw Land,Site Value,Total Land,Current %,Recommended %\n';
    
    improvedTestSales.forEach(sale => {
      csv += `"${sale.vcs}",${sale.year},${sale.salesCount},${sale.avgPrice},${sale.avgAcres},${sale.rawLandValue},${sale.siteValue},${sale.totalLandValue},${(sale.currentAllocation * 100).toFixed(1)},${(sale.recommendedAllocation * 100).toFixed(1)}\n`;
    });
    
    return csv;
  };

  const exportVCSSheet = () => {
    let csv = 'VCS VALUATION SHEET\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `County: ${jobData?.county || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n`;
    csv += `Method: ${valuationMode.toUpperCase()}\n`;
    csv += `Target Allocation: ${targetAllocation || 'Not Set'}%\n\n`;
    
    csv += 'VCS,Total,Type,Description,Method,Typical Lot,Rec Site,Act Site,';
    
    // Cascade headers based on mode
    if (valuationMode === 'ff') {
      csv += 'Standard FF,Excess FF,';
    } else {
      csv += 'Prime,Secondary,Excess,Residual,';
    }
    
    csv += 'Avg Norm Time,Avg Norm Size,Avg Price,CME,Zoning,Key Pages,Map Pages\n';
    
    Object.keys(vcsSheetData).sort().forEach(vcs => {
      const data = vcsSheetData[vcs];
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
      const recSite = vcsRecommendedSites[vcs] || 0;
      const actSite = vcsManualSiteValues[vcs] || recSite;
      
      // Skip non-residential types for cascade rates
      const isResidential = !['Commercial', 'Industrial', 'Apartment', 'Special'].includes(type);
      
      // Get typical lot size
      const vcsProps = properties.filter(p => 
        p.new_vcs === vcs && 
        (p.property_m4_class === '2' || p.property_m4_class === '3A')
      );
      const typicalLot = vcsProps.length > 0 ?
        (vcsProps.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProps.length).toFixed(2) : '';
      
      csv += `"${vcs}",${data.counts.total},"${type}","${description}",${valuationMode},${typicalLot},${recSite},${actSite},`;
      
      // Cascade rates
      if (isResidential) {
        if (valuationMode === 'ff') {
          csv += `${cascadeConfig.normal.standard?.rate || ''},${cascadeConfig.normal.excess?.rate || ''},`;
        } else {
          csv += `${cascadeConfig.normal.prime?.rate || ''},${cascadeConfig.normal.secondary?.rate || ''},${cascadeConfig.normal.excess?.rate || ''},${cascadeConfig.normal.residual?.rate || ''},`;
        }
      } else {
        // Gray out cascade for non-residential
        if (valuationMode === 'ff') {
          csv += ',,';
        } else {
          csv += ',,,,';
        }
      }
      
      csv += `${data.avgNormTime || ''},${data.avgNormSize || ''},${data.avgPrice || ''},,`; // CME placeholder
      csv += `"${data.zoning || ''}","${data.keyPages || ''}","${data.mapPages || ''}"\n`;
    });
    
    // Special Category Rates
    if (Object.keys(cascadeConfig.specialCategories).length > 0) {
      csv += '\n\nSPECIAL CATEGORY LAND RATES\n';
      csv += 'Category,Rate\n';
      Object.entries(cascadeConfig.specialCategories).forEach(([category, rate]) => {
        if (rate !== null) {
          csv += `"${category}",${rate}\n`;
        }
      });
    }
    
    return csv;
  };

  const exportEconomicObsolescence = () => {
    let csv = 'ECONOMIC OBSOLESCENCE ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n\n`;
    
    csv += 'VCS,Location,Code,Traffic,Type Use,With (Count/YrBlt/Time/Size/Avg),Without (Count/YrBlt/Time/Size/Avg),Impact %,Actual %\n';
    
    Object.keys(ecoObsFactors).sort().forEach(vcs => {
      Object.keys(ecoObsFactors[vcs]).forEach(codes => {
        if (codes === 'None') return;
        
        // Get all unique type uses for this location
        const typeUses = new Set();
        ecoObsFactors[vcs][codes].withFactor.forEach(p => {
          if (p.typeUse) typeUses.add(p.typeUse);
        });
        
        if (typeUses.size === 0) typeUses.add('all');
        
        typeUses.forEach(typeUse => {
          const impact = calculateEcoObsImpact(vcs, codes, typeUse);
          if (!impact) return;
          
          const actual = actualAdjustments[`${vcs}_${codes}`] || '';
          
          // Get traffic level if BS code
          let traffic = '';
          if (codes.includes('BS')) {
            const trafficLevels = new Set();
            ecoObsFactors[vcs][codes].withFactor.forEach(p => {
              if (trafficLevels[p.id]) trafficLevels.add(trafficLevels[p.id]);
            });
            traffic = Array.from(trafficLevels).join('/') || 'Not Set';
          }
          
          const withData = `${impact.withCount}/${impact.withYearBuilt}/${impact.withNormTime}/${impact.withNormSize}/${impact.withAvg}`;
          const withoutData = `${impact.withoutCount}/${impact.withoutYearBuilt}/${impact.withoutNormTime}/${impact.withoutNormSize}/${impact.withoutAvg}`;
          
          csv += `"${vcs}","${codes}","${codes}","${traffic}","${typeUse}","${withData}","${withoutData}",${impact.impact},${actual}\n`;
        });
      });
    });
    
    // Standard Adjustments Reference
    csv += '\n\nSTANDARD LOCATION ADJUSTMENT CODES\n';
    csv += 'Code,Description,Type,Typical Impact\n';
    csv += 'BS,Busy Street,Negative,-10% to -25%\n';
    csv += 'CM,Commercial Adjacent,Negative,-10% to -20%\n';
    csv += 'RR,Railroad,Negative,-15% to -25%\n';
    csv += 'PL,Power Lines,Negative,-5% to -20%\n';
    csv += 'ES,Easement,Negative,-5% to -15%\n';
    csv += 'GV,Golf Course View,Positive,+5% to +15%\n';
    csv += 'GC,Golf Course Access,Positive,+5% to +10%\n';
    csv += 'WV,Water View,Positive,+10% to +20%\n';
    csv += 'WF,Water Front,Positive,+15% to +30%\n';
    
    // Custom codes if any
    if (customLocationCodes.length > 0) {
      csv += '\n\nCUSTOM LOCATION CODES\n';
      csv += 'Code,Description,Type\n';
      customLocationCodes.forEach(code => {
        csv += `"${code.code}","${code.description}","${code.isPositive ? 'Positive' : 'Negative'}"\n`;
      });
    }
    
    return csv;
  };

  const exportCompleteAnalysis = () => {
    let csv = 'COMPLETE LAND VALUATION ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `County: ${jobData?.county || ''}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n`;
    csv += '='.repeat(80) + '\n\n';
    
    csv += exportLandRates();
    csv += '\n' + '='.repeat(80) + '\n\n';
    csv += exportAllocation();
    csv += '\n' + '='.repeat(80) + '\n\n';
    csv += exportVCSSheet();
    csv += '\n' + '='.repeat(80) + '\n\n';
    csv += exportEconomicObsolescence();
    
    return csv;
  };

  // ========== CASCADE CONFIGURATION FUNCTIONS ==========
  const updateCascadeBreak = (tier, field, value) => {
    setCascadeConfig(prev => ({
      ...prev,
      normal: {
        ...prev.normal,
        [tier]: {
          ...prev.normal[tier],
          [field]: value ? parseFloat(value) : null
        }
      }
    }));
  };

  const updateSpecialRegionCascade = (region, tier, field, value) => {
    setCascadeConfig(prev => ({
      ...prev,
      special: {
        ...prev.special,
        [region]: {
          ...prev.special[region],
          [tier]: {
            ...prev.special[region]?.[tier],
            [field]: value ? parseFloat(value) : null
          }
        }
      }
    }));
  };

  const updateSpecialCategory = (category, rate) => {
    setCascadeConfig(prev => ({
      ...prev,
      specialCategories: {
        ...prev.specialCategories,
        [category]: rate ? parseFloat(rate) : null
      }
    }));
  };

  const addCustomCategory = (categoryName) => {
    setCascadeConfig(prev => ({
      ...prev,
      specialCategories: {
        ...prev.specialCategories,
        [categoryName]: null
      }
    }));
  };

  const saveRates = async () => {
    // This triggers the main saveAnalysis function
    await saveAnalysis();
    
    // Additional notification that rates have been saved
    alert('Land rates have been saved and are now available in the Allocation Study and VCS Sheet tabs.');
  };
  // ========== RENDER LAND RATES TAB ==========
  const renderLandRatesTab = () => (
    <div style={{ padding: '20px' }}>
      {showCopiedNotification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: '#10B981',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          zIndex: 9999,
          animation: 'slideIn 0.3s ease'
        }}>
          ✓ Prompt copied! Paste into Claude AI
        </div>
      )}
      {/* Mode Selection Buttons - TOP RIGHT */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Land Valuation Analysis</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setValuationMode('acre')}
            style={{
              padding: '8px 16px',
              backgroundColor: valuationMode === 'acre' ? '#3B82F6' : 'white',
              color: valuationMode === 'acre' ? 'white' : '#6B7280',
              border: valuationMode === 'acre' ? 'none' : '1px solid #E5E7EB',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Acre
          </button>
          <button
            onClick={() => setValuationMode('sf')}
            style={{
              padding: '8px 16px',
              backgroundColor: valuationMode === 'sf' ? '#3B82F6' : 'white',
              color: valuationMode === 'sf' ? 'white' : '#6B7280',
              border: valuationMode === 'sf' ? 'none' : '1px solid #E5E7EB',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Square Foot
          </button>
          <button
            onClick={() => canUseFrontFoot && setValuationMode('ff')}
            disabled={!canUseFrontFoot}
            style={{
              padding: '8px 16px',
              backgroundColor: valuationMode === 'ff' ? '#3B82F6' : 'white',
              color: valuationMode === 'ff' ? 'white' : !canUseFrontFoot ? '#D1D5DB' : '#6B7280',
              border: valuationMode === 'ff' ? 'none' : '1px solid #E5E7EB',
              borderRadius: '4px',
              cursor: canUseFrontFoot ? 'pointer' : 'not-allowed',
              fontWeight: '500',
              opacity: canUseFrontFoot ? 1 : 0.5
            }}
            title={!canUseFrontFoot ? 'Front foot rates not available - no depth tables with rates found' : ''}
          >
            Front Foot
          </button>
        </div>
      </div>

      {/* Header Controls */}
      <div style={{ marginBottom: '20px', backgroundColor: '#F9FAFB', padding: '15px', borderRadius: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '15px', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              Start Date
            </label>
            <input
              type="date"
              value={dateRange.start.toISOString().split('T')[0]}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: new Date(e.target.value) }))}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
              End Date
            </label>
            <input
              type="date"
              value={dateRange.end.toISOString().split('T')[0]}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: new Date(e.target.value) }))}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => {
                setShowAddModal(true);
                // Auto-populate search results when modal opens
                searchProperties();
              }}
              style={{
                backgroundColor: '#3B82F6',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={16} /> Add Property
            </button>
            <button
              onClick={() => exportToExcel('land-rates')}
              style={{
                backgroundColor: '#10B981',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Download size={16} /> Export
            </button>
          </div>
        </div>
      </div>

      {/* Method 1: Vacant Land Sales */}
      <div style={{ marginBottom: '30px', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Method 1: Vacant Land Sales</h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Include</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Block</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Lot</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Qual</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Address</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Class</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Bldg</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Type</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Design</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Zoning</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Special Region</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Category</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Sale Date</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                  {valuationMode === 'acre' ? 'Acres' : valuationMode === 'sf' ? 'Sq Ft' : 'Frontage'}
                </th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>{getUnitLabel()}</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Package</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Notes</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {vacantSales.map((sale, index) => {
                // Get human-readable names - use only synchronous decoding to avoid async rendering issues
                const typeName = vendorType === 'Microsystems' && jobData?.parsed_code_definitions
                  ? interpretCodes.getMicrosystemsValue?.(sale, jobData.parsed_code_definitions, 'asset_type_use') || sale.asset_type_use || '-'
                  : sale.asset_type_use || '-';
                const designName = vendorType === 'Microsystems' && jobData?.parsed_code_definitions
                  ? interpretCodes.getMicrosystemsValue?.(sale, jobData.parsed_code_definitions, 'asset_design_style') || sale.asset_design_style || '-'
                  : sale.asset_design_style || '-';
                
                return (
                  <tr key={sale.id} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <input
                        type="checkbox"
                        checked={includedSales.has(sale.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setIncludedSales(prev => new Set([...prev, sale.id]));
                          } else {
                            setIncludedSales(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(sale.id);
                              return newSet;
                            });
                          }
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_block}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_lot}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_qualifier && sale.property_qualifier !== 'NONE' ? sale.property_qualifier : ''}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.property_location}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.property_m4_class || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.asset_building_class || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', fontSize: '11px' }}>
                      {typeName}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', fontSize: '11px' }}>
                      {designName}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.new_vcs || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.asset_zoning || '-'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <select
                        value={specialRegions[sale.id] || 'Normal'}
                        onChange={(e) => setSpecialRegions(prev => ({ ...prev, [sale.id]: e.target.value }))}
                        style={{
                          padding: '4px',
                          border: '1px solid #D1D5DB',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                      >
                        {SPECIAL_REGIONS.map(region => (
                          <option key={region} value={region}>{region}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <select
                        value={saleCategories[sale.id] || sale.autoCategory || 'uncategorized'}
                        onChange={(e) => setSaleCategories(prev => ({ ...prev, [sale.id]: e.target.value }))}
                        style={{
                          padding: '4px',
                          border: '1px solid #D1D5DB',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: sale.autoCategory ? '#FEF3C7' : 'white'
                        }}
                      >
                        <option value="uncategorized">Uncategorized</option>
                        <option value="raw_land">Raw Land</option>
                        <option value="building_lot">Building Lot</option>
                        <option value="wetlands">Wetlands</option>
                        <option value="landlocked">Landlocked</option>
                        <option value="conservation">Conservation</option>
                        <option value="teardown">Teardown</option>
                        <option value="pre-construction">Pre-Construction</option>
                      </select>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      {sale.sales_date}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      ${sale.sales_price?.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                      {valuationMode === 'sf' ? 
                        Math.round(sale.totalAcres * 43560).toLocaleString() : 
                        sale.totalAcres?.toFixed(2)}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      borderBottom: '1px solid #E5E7EB', 
                      textAlign: 'right',
                      fontWeight: 'bold',
                      color: sale.pricePerAcre > 100000 ? '#EF4444' : '#10B981'
                    }}>
                      {valuationMode === 'sf' ? 
                        `$${(sale.sales_price / (sale.totalAcres * 43560)).toFixed(2)}` :
                        `$${sale.pricePerAcre?.toLocaleString()}`}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.packageData && (
                        <span style={{
                          backgroundColor: '#FEE2E2',
                          color: '#DC2626',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '11px'
                        }}>
                          {sale.packageData.package_count}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <input
                        type="text"
                        value={landNotes[sale.id] || ''}
                        onChange={(e) => setLandNotes(prev => ({ ...prev, [sale.id]: e.target.value }))}
                        placeholder="Add notes..."
                        style={{
                          width: '200px',
                          padding: '4px',
                          border: '1px solid #D1D5DB',
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}
                      />
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        <button
                          onClick={() => handlePropertyResearch(sale)}
                          title="Research with AI"
                          style={{
                            padding: '4px',
                            backgroundColor: '#8B5CF6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          <Search size={14} />
                        </button>
                        <button
                          onClick={() => removeSale(sale.id)}
                          title="Remove"
                          style={{
                            padding: '4px',
                            backgroundColor: '#EF4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Method 1 Summary - MOVED TO BOTTOM */}
        <div style={{ padding: '15px', backgroundColor: '#F9FAFB', borderTop: '1px solid #E5E7EB' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
            {(() => {
              // Calculate average rate for checked items by category
              const checkedSales = vacantSales.filter(s => includedSales.has(s.id));
              
              // Helper function to calculate average for a category
              const getCategoryAverage = (filterFn) => {
                const filtered = checkedSales.filter(filterFn);
                if (filtered.length === 0) return { avg: 0, count: 0 };
                
                if (valuationMode === 'sf') {
                  const totalPrice = filtered.reduce((sum, s) => sum + s.sales_price, 0);
                  const totalSF = filtered.reduce((sum, s) => sum + (s.totalAcres * 43560), 0);
                  return { 
                    avg: totalSF > 0 ? (totalPrice / totalSF).toFixed(2) : 0, 
                    count: filtered.length 
                  };
                } else {
                  const avgRate = filtered.reduce((sum, s) => sum + s.pricePerAcre, 0) / filtered.length;
                  return { 
                    avg: Math.round(avgRate), 
                    count: filtered.length 
                  };
                }
              };
              
              const rawLand = getCategoryAverage(s => 
                saleCategories[s.id] === 'raw_land' || 
                (!saleCategories[s.id] && s.property_m4_class === '1')
              );
              
              const buildingLot = getCategoryAverage(s => 
                saleCategories[s.id] === 'building_lot' ||
                saleCategories[s.id] === 'teardown' ||
                saleCategories[s.id] === 'pre-construction'
              );
              
              const wetlands = getCategoryAverage(s => saleCategories[s.id] === 'wetlands');
              const landlocked = getCategoryAverage(s => saleCategories[s.id] === 'landlocked');
              const conservation = getCategoryAverage(s => saleCategories[s.id] === 'conservation');
              
              return (
                <>
                  <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>Raw Land</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10B981' }}>
                      {valuationMode === 'sf' ? `$${rawLand.avg}` : `$${rawLand.avg.toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{rawLand.count} sales</div>
                  </div>
                  <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>Building Lot</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3B82F6' }}>
                      {valuationMode === 'sf' ? `$${buildingLot.avg}` : `$${buildingLot.avg.toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{buildingLot.count} sales</div>
                  </div>
                  <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>Wetlands</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#06B6D4' }}>
                      {valuationMode === 'sf' ? `$${wetlands.avg}` : `$${wetlands.avg.toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{wetlands.count} sales</div>
                  </div>
                  <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>Landlocked</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F59E0B' }}>
                      {valuationMode === 'sf' ? `$${landlocked.avg}` : `$${landlocked.avg.toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{landlocked.count} sales</div>
                  </div>
                  <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>Conservation</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#8B5CF6' }}>
                      {valuationMode === 'sf' ? `$${conservation.avg}` : `$${conservation.avg.toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{conservation.count} sales</div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
      {/* Method 2: Improved Sale Lot Size Analysis */}
      <div style={{ marginBottom: '30px', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Method 2: Improved Sale Lot Size Analysis</h3>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Type and Use:</label>
              <select
                value={method2TypeFilter}
                onChange={(e) => setMethod2TypeFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: 'white'
                }}
              >
                {getTypeUseOptions().map(option => (
                  <option key={option.code} value={option.code}>
                    {option.code} - {option.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ padding: '10px 15px 5px 15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            {Object.keys(bracketAnalysis).length} VCS areas • Filtered by: {method2TypeFilter} ({getTypeUseOptions().find(opt => opt.code === method2TypeFilter)?.description || 'Unknown'})
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setExpandedVCS(new Set(Object.keys(bracketAnalysis)))}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: '#3B82F6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Expand All
            </button>
            <button
              onClick={() => setExpandedVCS(new Set())}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: '#6B7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Collapse All
            </button>
          </div>
        </div>

        <div style={{ padding: '10px' }}>
          {Object.entries(bracketAnalysis)
            .filter(([vcs]) => !vcsFilter || vcs.includes(vcsFilter))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([vcs, data], index) => {
              const isExpanded = expandedVCS.has(vcs);
              const vcsColors = generateVCSColor(vcs, index);

              // Format VCS summary line exactly like screenshot
              const summaryLine = `${data.totalSales} sales • Avg $${Math.round(data.avgPrice).toLocaleString()} • ${data.avgAcres.toFixed(2)} • $${Math.round(data.avgAdjusted).toLocaleString()}-$${data.impliedRate || 0} • $${data.impliedRate || 0}`;

              return (
                <div key={vcs} style={{ marginBottom: '8px', border: '1px solid #E5E7EB', borderRadius: '6px', overflow: 'hidden' }}>
                  {/* VCS Header */}
                  <div
                    onClick={() => {
                      const newExpanded = new Set(expandedVCS);
                      if (isExpanded) {
                        newExpanded.delete(vcs);
                      } else {
                        newExpanded.add(vcs);
                      }
                      setExpandedVCS(newExpanded);
                    }}
                    style={{
                      backgroundColor: vcsColors.background,
                      color: vcsColors.text,
                      padding: '10px 15px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontWeight: 'bold',
                      fontSize: '14px',
                      border: 'none'
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{vcs}:</span>
                      <span style={{ fontSize: '12px', marginLeft: '8px', fontWeight: 'normal' }}>
                        {summaryLine}
                      </span>
                    </div>
                    <span style={{ fontSize: '16px', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                      ▼
                    </span>
                  </div>

                  {/* VCS Details */}
                  {isExpanded && (
                    <div style={{ backgroundColor: '#FFFFFF', padding: '0', border: '1px solid #E5E7EB', borderTop: 'none' }}>
                      <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F8F9FA' }}>
                            <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Bracket</th>
                            <th style={{ padding: '8px', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Count</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Avg Lot Size</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Avg Sale Price</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Avg SFLA</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>ADJUSTED</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>DELTA</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>LOT DELTA</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>PER ACRE</th>
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>PER SQ FT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { key: 'small', label: '<1.00', bracket: data.brackets.small },
                            { key: 'medium', label: '1.00-5.00', bracket: data.brackets.medium },
                            { key: 'large', label: '5.00-10.00', bracket: data.brackets.large },
                            { key: 'xlarge', label: '>10.00', bracket: data.brackets.xlarge }
                          ].map((row, rowIndex) => {
                            if (row.bracket.count === 0) return null;

                            // Calculate deltas from previous bracket
                            const prevBracket = rowIndex > 0 ?
                              [data.brackets.small, data.brackets.medium, data.brackets.large, data.brackets.xlarge][rowIndex - 1]
                              : null;

                            const adjustedDelta = prevBracket && prevBracket.avgAdjusted && row.bracket.avgAdjusted ?
                              row.bracket.avgAdjusted - prevBracket.avgAdjusted : null;
                            const lotDelta = prevBracket && prevBracket.avgAcres && row.bracket.avgAcres ?
                              row.bracket.avgAcres - prevBracket.avgAcres : null;
                            const perAcre = adjustedDelta && lotDelta && lotDelta > 0 ? adjustedDelta / lotDelta : null;
                            const perSqFt = perAcre ? perAcre / 43560 : null;

                            return (
                              <tr key={row.key} style={{ backgroundColor: '#FFFFFF' }}>
                                <td style={{ padding: '6px 8px', fontWeight: '500', borderBottom: '1px solid #F1F3F4' }}>{row.label}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #F1F3F4' }}>{row.bracket.count}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {row.bracket.avgAcres ? row.bracket.avgAcres.toFixed(2) : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {row.bracket.avgSalePrice ? `$${Math.round(row.bracket.avgSalePrice).toLocaleString()}` : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {row.bracket.avgSFLA ? Math.round(row.bracket.avgSFLA).toLocaleString() : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {row.bracket.avgAdjusted ? `$${Math.round(row.bracket.avgAdjusted).toLocaleString()}` : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {adjustedDelta ? `$${Math.round(adjustedDelta).toLocaleString()}` : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                  {lotDelta ? lotDelta.toFixed(2) : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #F1F3F4' }}>
                                  {perAcre ? `$${Math.round(perAcre).toLocaleString()}` : '-'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #F1F3F4' }}>
                                  {perSqFt ? `$${perSqFt.toFixed(2)}` : '-'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        
        {/* Method 2 Summary - Enhanced Layout */}
        {method2Summary.average && (
          <div style={{ borderTop: '2px solid #E5E7EB', backgroundColor: '#F8FAFC' }}>
            <div style={{ padding: '20px' }}>
              <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold', color: '#1F2937' }}>
                Method 2 Summary - Implied {getUnitLabel()} Rates
              </h4>

              <div style={{ display: 'flex', gap: '30px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>Average</div>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#059669' }}>
                      ${method2Summary.average?.toLocaleString()}
                    </div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>Median</div>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#0D9488' }}>
                      ${method2Summary.median?.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={{ width: '1px', height: '60px', backgroundColor: '#D1D5DB' }}></div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', minWidth: '200px' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>VCS Coverage:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1F2937' }}>{method2Summary.coverage}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', minWidth: '200px' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>Range:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1F2937' }}>
                      ${method2Summary.min?.toLocaleString()} - ${method2Summary.max?.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', minWidth: '200px' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>Total Sales:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1F2937' }}>
                      {Object.values(bracketAnalysis).reduce((sum, data) => sum + data.totalSales, 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Implied Front Foot Rates - ONLY IN FF MODE */}
        {valuationMode === 'ff' && method2Summary.average && (
          <div style={{ padding: '15px', borderTop: '1px solid #E5E7EB' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>
              Implied Front Foot Rates by Zoning
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '6px', textAlign: 'left' }}>Zoning</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Typical Lot</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Implied $/Acre</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Land Value</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Min Frontage</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Standard FF</th>
                    <th style={{ padding: '6px', textAlign: 'right' }}>Excess FF</th>
                  </tr>
                </thead>
                <tbody>
                  {/* This would be populated with zoning-specific calculations */}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Cascade Rate Configuration - MOVED TO BOTTOM */}
      <div style={{ marginBottom: '20px', backgroundColor: '#FEF3C7', padding: '15px', borderRadius: '8px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold' }}>
          Cascade Rate Configuration ({valuationMode === 'acre' ? 'Per Acre' : valuationMode === 'sf' ? 'Per Square Foot' : 'Per Front Foot'})
        </h3>
        
        {/* Normal Region Cascade */}
        <div style={{ marginBottom: '15px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Normal Properties</h4>
          <div style={{ display: 'grid', gridTemplateColumns: valuationMode === 'ff' ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '15px' }}>
            {valuationMode === 'ff' ? (
              <>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Standard (0-{cascadeConfig.normal.standard?.max || 100} ft)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.standard?.max || ''}
                      onChange={(e) => updateCascadeBreak('standard', 'max', e.target.value)}
                      placeholder="Max"
                      style={{
                        width: '80px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.standard?.rate || ''}
                      onChange={(e) => updateCascadeBreak('standard', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Excess ({cascadeConfig.normal.standard?.max || 100}+ ft)
                  </label>
                  <input
                    type="number"
                    value={cascadeConfig.normal.excess?.rate || ''}
                    onChange={(e) => updateCascadeBreak('excess', 'rate', e.target.value)}
                    placeholder="Enter rate"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Prime (0-{cascadeConfig.normal.prime?.max || 1} {valuationMode})
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.prime?.max || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'max', e.target.value)}
                      placeholder="Max"
                      style={{
                        width: '60px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.prime?.rate || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Secondary ({cascadeConfig.normal.prime?.max || 1}-{cascadeConfig.normal.secondary?.max || 5} {valuationMode})
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.secondary?.max || ''}
                      onChange={(e) => updateCascadeBreak('secondary', 'max', e.target.value)}
                      placeholder="Max"
                      style={{
                        width: '60px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.secondary?.rate || ''}
                      onChange={(e) => updateCascadeBreak('secondary', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Excess ({cascadeConfig.normal.secondary?.max || 5}-{cascadeConfig.normal.excess?.max || 10} {valuationMode})
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.excess?.max || ''}
                      onChange={(e) => updateCascadeBreak('excess', 'max', e.target.value)}
                      placeholder="Max"
                      style={{
                        width: '60px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.excess?.rate || ''}
                      onChange={(e) => updateCascadeBreak('excess', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Residual ({cascadeConfig.normal.excess?.max || 10}+ {valuationMode})
                  </label>
                  <input
                    type="number"
                    value={cascadeConfig.normal.residual?.rate || ''}
                    onChange={(e) => updateCascadeBreak('residual', 'rate', e.target.value)}
                    placeholder="Enter rate"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Special Categories */}
        <div style={{ marginBottom: '15px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>Special Category Land Rates</h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {Object.keys(cascadeConfig.specialCategories).map(category => (
              <div key={category} style={{ 
                backgroundColor: 'white', 
                padding: '10px', 
                borderRadius: '4px',
                border: '1px solid #FDE68A',
                minWidth: '150px'
              }}>
                <div style={{ fontSize: '12px', color: '#92400E', marginBottom: '4px', textTransform: 'capitalize' }}>
                  {category}
                </div>
                <input
                  type="number"
                  value={cascadeConfig.specialCategories[category] || ''}
                  onChange={(e) => updateSpecialCategory(category, e.target.value)}
                  placeholder="Enter rate"
                  style={{
                    width: '100%',
                    padding: '4px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
              </div>
            ))}
            <button
              onClick={() => {
                const name = prompt('Enter new category name:');
                if (name) addCustomCategory(name.toLowerCase());
              }}
              style={{
                backgroundColor: 'white',
                color: '#92400E',
                padding: '10px',
                borderRadius: '4px',
                border: '1px dashed #FDE68A',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={16} /> Add Category
            </button>
          </div>
        </div>
        
        {/* Save Rates Button */}
        <div style={{ textAlign: 'center', paddingTop: '10px' }}>
          <button
            onClick={saveRates}
            style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '12px 32px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            Save Rates
          </button>
        </div>
      </div>

      {/* Add Property Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '1200px',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ 
              padding: '20px', 
              borderBottom: '1px solid #E5E7EB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Add Properties to Analysis</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSearchResults([]);
                  setSelectedToAdd(new Set());
                }}
                style={{
                  padding: '4px',
                  backgroundColor: '#EF4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ padding: '20px' }}>
              {/* Search Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '20px' }}>
                <select
                  value={searchFilters.class}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, class: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                >
                  <option value="">All Classes</option>
                  <option value="1">Class 1 - Vacant</option>
                  <option value="2">Class 2 - Residential</option>
                  <option value="3B">Class 3B - Farmland</option>
                </select>
                
                <input
                  type="text"
                  placeholder="Block"
                  value={searchFilters.block}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, block: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="text"
                  placeholder="Lot"
                  value={searchFilters.lot}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, lot: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="number"
                  placeholder="Min Price"
                  value={searchFilters.priceMin}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <input
                  type="number"
                  placeholder="Max Price"
                  value={searchFilters.priceMax}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                  style={{
                    padding: '8px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px'
                  }}
                />
                
                <button
                  onClick={searchProperties}
                  style={{
                    backgroundColor: '#3B82F6',
                    color: 'white',
                    padding: '8px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <Search size={16} /> Search
                </button>
              </div>
              
              {/* Search Results */}
              <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: '4px' }}>
                <table style={{ width: '100%', fontSize: '14px' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB' }}>
                    <tr>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Select</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Block</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Lot</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Qual</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Address</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Class</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Bldg</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Type</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Design</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>VCS</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Zoning</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Sale Date</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Sale Price</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Acres</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>{getUnitLabel()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map(prop => {
                      // Use only synchronous decoding to avoid async rendering issues
                      const typeName = vendorType === 'Microsystems' && jobData?.parsed_code_definitions
                        ? interpretCodes.getMicrosystemsValue?.(prop, jobData.parsed_code_definitions, 'asset_type_use') || prop.asset_type_use || '-'
                        : prop.asset_type_use || '-';
                      const designName = vendorType === 'Microsystems' && jobData?.parsed_code_definitions
                        ? interpretCodes.getMicrosystemsValue?.(prop, jobData.parsed_code_definitions, 'asset_design_style') || prop.asset_design_style || '-'
                        : prop.asset_design_style || '-';
                      const acres = calculateAcreage(prop);
                      const pricePerUnit = getPricePerUnit(prop.sales_price, acres);
                      
                      return (
                        <tr key={prop.id}>
                          <td style={{ padding: '8px' }}>
                            <input
                              type="checkbox"
                              checked={selectedToAdd.has(prop.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedToAdd(prev => new Set([...prev, prop.id]));
                                } else {
                                  setSelectedToAdd(prev => {
                                    const newSet = new Set(prev);
                                    newSet.delete(prop.id);
                                    return newSet;
                                  });
                                }
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px' }}>{prop.property_block}</td>
                          <td style={{ padding: '8px' }}>{prop.property_lot}</td>
                          <td style={{ padding: '8px' }}>{prop.property_qualifier && prop.property_qualifier !== 'NONE' ? prop.property_qualifier : ''}</td>
                          <td style={{ padding: '8px' }}>{prop.property_location}</td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>{prop.property_m4_class}</td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>{prop.asset_building_class || '-'}</td>
                          <td style={{ padding: '8px', fontSize: '11px' }}>{typeName}</td>
                          <td style={{ padding: '8px', fontSize: '11px' }}>{designName}</td>
                          <td style={{ padding: '8px' }}>{prop.new_vcs || '-'}</td>
                          <td style={{ padding: '8px' }}>{prop.asset_zoning || '-'}</td>
                          <td style={{ padding: '8px' }}>{prop.sales_date}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>${prop.sales_price?.toLocaleString()}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{acres.toFixed(2)}</td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                            {valuationMode === 'sf' ? `$${pricePerUnit.toFixed(2)}` : `$${pricePerUnit.toLocaleString()}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6B7280' }}>
                  {selectedToAdd.size} properties selected
                </span>
                <button
                  onClick={addSelectedProperties}
                  disabled={selectedToAdd.size === 0}
                  style={{
                    backgroundColor: selectedToAdd.size > 0 ? '#10B981' : '#D1D5DB',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: selectedToAdd.size > 0 ? 'pointer' : 'not-allowed'
                  }}
                >
                  Add Selected Properties
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  // ========== RENDER ALLOCATION STUDY TAB ==========
  const renderAllocationStudyTab = () => (
    <div style={{ padding: '20px' }}>
      {/* Header Stats with Current Overall Allocation */}
      <div style={{ marginBottom: '20px', backgroundColor: '#F9FAFB', padding: '15px', borderRadius: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
          {(() => {
            const stats = calculateAllocationStats();
            return (
              <>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Current Overall</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#EF4444' }}>
                    {currentOverallAllocation}%
                  </div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Vacant Test Sales</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{vacantTestSales.length}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Improved Test</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{improvedTestSales.length}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Recommended</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#F59E0B' }}>
                    {stats?.averageAllocation || '0'}%
                  </div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Target</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input
                      type="number"
                      value={targetAllocation || ''}
                      onChange={(e) => setTargetAllocation(e.target.value)}
                      placeholder="Set"
                      style={{
                        width: '60px',
                        padding: '4px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px',
                        fontSize: '16px',
                        fontWeight: 'bold'
                      }}
                    />
                    <span style={{ fontSize: '16px', fontWeight: 'bold' }}>%</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* Filters */}
        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => exportToExcel('allocation')}
            style={{
              marginLeft: 'auto',
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      {/* Vacant Land Test Table */}
      <div style={{ marginBottom: '20px', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Vacant Land Test</h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px' }}>VCS</th>
                <th style={{ padding: '8px' }}>Year</th>
                <th style={{ padding: '8px' }}>Region</th>
                <th style={{ padding: '8px' }}>Block/Lot</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Acres</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Raw Land</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Site Value</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {vacantTestSales.map((sale, index) => (
                <tr key={`${sale.id}_${index}`} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                  <td style={{ padding: '8px' }}>{sale.vcs}</td>
                  <td style={{ padding: '8px' }}>{sale.year}</td>
                  <td style={{ padding: '8px' }}>{sale.region}</td>
                  <td style={{ padding: '8px' }}>{sale.block}/{sale.lot}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.price?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{sale.acres?.toFixed(2)}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.rawLandValue?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: sale.siteValue > 0 ? '#10B981' : '#EF4444' }}>
                    ${sale.siteValue?.toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    {sale.siteValue > 0 ? '✓' : '✗'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Improved Sales Test */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Improved Sales Allocation Test</h3>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px' }}>VCS</th>
                <th style={{ padding: '8px' }}>Year</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Sales</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Avg Price</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Avg Acres</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Raw Land</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Site Value</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>Total Land</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Current %</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Rec %</th>
              </tr>
            </thead>
            <tbody>
              {improvedTestSales.map((sale, index) => (
                <tr key={`${sale.vcs}_${sale.year}`} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                  <td style={{ padding: '8px' }}>{sale.vcs}</td>
                  <td style={{ padding: '8px' }}>{sale.year}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>{sale.salesCount}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.avgPrice?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{sale.avgAcres}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.rawLandValue?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.siteValue?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>${sale.totalLandValue?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'center', color: '#6B7280' }}>
                    {(sale.currentAllocation * 100).toFixed(1)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', backgroundColor: sale.recommendedAllocation >= 0.25 && sale.recommendedAllocation <= 0.40 ? '#D1FAE5' : sale.recommendedAllocation >= 0.20 && sale.recommendedAllocation <= 0.45 ? '#FEF3C7' : '#FEE2E2' }}>
                    {(sale.recommendedAllocation * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ========== RENDER VCS SHEET TAB ==========
  const renderVCSSheetTab = () => {
    const VCS_TYPES = [
      'Residential-Typical',
      'Residential-Age Restricted',
      'Residential-Condo Flats',
      'Residential-Condo Rows',
      'Residential-Row/Townhomes',
      'Residential-Age Restricted Condo',
      'Residential-Age Restricted Row/Townhomes',
      'Residential-Regional',
      'Residential-Neighborhood',
      'Residential-Cul-de-Sac',
      'Commercial',
      'Industrial',
      'Apartment',
      'Special'
    ];

    return (
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>VCS Valuation Sheet</h3>
          <button
            onClick={() => exportToExcel('vcs-sheet')}
            style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Download size={16} /> Export Sheet
          </button>
        </div>

        <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1E40AF', color: 'white' }}>
                  <th style={{ padding: '8px' }}>VCS</th>
                  <th style={{ padding: '8px' }}>Total</th>
                  <th style={{ padding: '8px' }}>Type</th>
                  <th style={{ padding: '8px' }}>Description</th>
                  <th style={{ padding: '8px' }}>Method</th>
                  <th style={{ padding: '8px' }}>Typ Lot</th>
                  <th style={{ padding: '8px' }}>Rec Site</th>
                  <th style={{ padding: '8px' }}>Act Site</th>
                  {valuationMode === 'ff' ? (
                    <>
                      <th style={{ padding: '8px' }}>Std FF</th>
                      <th style={{ padding: '8px' }}>Exc FF</th>
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '8px' }}>Prime</th>
                      <th style={{ padding: '8px' }}>Sec</th>
                      <th style={{ padding: '8px' }}>Exc</th>
                      <th style={{ padding: '8px' }}>Res</th>
                    </>
                  )}
                  <th style={{ padding: '8px' }}>Avg NT</th>
                  <th style={{ padding: '8px' }}>Avg NS</th>
                  <th style={{ padding: '8px' }}>Avg $</th>
                  <th style={{ padding: '8px' }}>CME</th>
                  <th style={{ padding: '8px' }}>Zoning</th>
                  <th style={{ padding: '8px' }}>Key</th>
                  <th style={{ padding: '8px' }}>Map</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(vcsSheetData).sort().map((vcs, index) => {
                  const data = vcsSheetData[vcs];
                  const type = vcsTypes[vcs] || 'Residential-Typical';
                  const isGrayedOut = ['Commercial', 'Industrial', 'Apartment', 'Special'].includes(type);
                  const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
                  const recSite = vcsRecommendedSites[vcs] || 0;
                  const actSite = vcsManualSiteValues[vcs] || recSite;
                  
                  // Get typical lot size
                  const vcsProps = properties?.filter(p => 
                    p.new_vcs === vcs && 
                    (p.property_m4_class === '2' || p.property_m4_class === '3A')
                  ) || [];
                  const typicalLot = vcsProps.length > 0 ?
                    (vcsProps.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProps.length).toFixed(2) : '';
                  
                  return (
                    <tr key={vcs} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>{vcs}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{data.counts?.total || 0}</td>
                      <td style={{ padding: '8px' }}>
                        <select
                          value={type}
                          onChange={(e) => updateVCSType(vcs, e.target.value)}
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '100%'
                          }}
                        >
                          {VCS_TYPES.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="text"
                          value={description}
                          onChange={(e) => updateVCSDescription(vcs, e.target.value)}
                          style={{
                            width: '100%',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{valuationMode}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>{typicalLot}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>${recSite.toLocaleString()}</td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={actSite}
                          onChange={(e) => updateManualSiteValue(vcs, e.target.value)}
                          style={{
                            width: '70px',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            textAlign: 'right'
                          }}
                        />
                      </td>
                      {valuationMode === 'ff' ? (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.standard?.rate || '' : ''}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.excess?.rate || '' : ''}
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.prime?.rate || '' : ''}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.secondary?.rate || '' : ''}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.excess?.rate || '' : ''}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                            {!isGrayedOut ? cascadeConfig.normal.residual?.rate || '' : ''}
                          </td>
                        </>
                      )}
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {data.avgNormTime ? `$${data.avgNormTime.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {data.avgNormSize ? `$${data.avgNormSize.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                        {data.avgPrice ? `$${data.avgPrice.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>-</td>
                      <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                        {!isGrayedOut ? data.zoning || '' : ''}
                      </td>
                      <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                        {!isGrayedOut ? data.keyPages || '' : ''}
                      </td>
                      <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit' }}>
                        {!isGrayedOut ? data.mapPages || '' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ========== RENDER ECONOMIC OBSOLESCENCE TAB ==========
  const renderEconomicObsolescenceTab = () => (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Economic Obsolescence Analysis</h3>
        <button
          onClick={() => exportToExcel('eco-obs')}
          style={{
            backgroundColor: '#10B981',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Download size={16} /> Export
        </button>
      </div>

      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                <th style={{ padding: '8px' }}>VCS</th>
                <th style={{ padding: '8px' }}>Location</th>
                <th style={{ padding: '8px' }}>Code</th>
                <th style={{ padding: '8px' }}>Traffic</th>
                <th style={{ padding: '8px' }}>Type Use</th>
                <th style={{ padding: '8px' }}>With (Count/YrBlt/Time/Size/Avg)</th>
                <th style={{ padding: '8px' }}>Without (Count/YrBlt/Time/Size/Avg)</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Impact</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Apply</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(ecoObsFactors).sort().map(vcs => 
                Object.keys(ecoObsFactors[vcs]).filter(codes => codes !== 'None').map((codes, index) => {
                  const key = `${vcs}_${codes}`;
                  const typeUse = typeUseFilter[key] || 'all';
                  const impact = calculateEcoObsImpact(vcs, codes, typeUse);
                  
                  if (!impact) return null;
                  
                  return (
                    <tr key={key} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>{vcs}</td>
                      <td style={{ padding: '8px' }}>{codes}</td>
                      <td style={{ padding: '8px' }}>{codes}</td>
                      <td style={{ padding: '8px' }}>
                        {codes.includes('BS') ? (
                          <select
                            value={trafficLevels[key] || ''}
                            onChange={(e) => updateTrafficLevel(key, e.target.value)}
                            style={{
                              padding: '2px',
                              border: '1px solid #D1D5DB',
                              borderRadius: '4px',
                              fontSize: '11px'
                            }}
                          >
                            <option value="">-</option>
                            <option value="LT">LT</option>
                            <option value="MT">MT</option>
                            <option value="HT">HT</option>
                          </select>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          value={typeUse}
                          onChange={(e) => updateTypeUseFilter(vcs, codes, e.target.value)}
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '100px'
                          }}
                        >
                          <option value="all">All</option>
                          <option value="10">Single Family</option>
                          <option value="11">Two Family</option>
                          <option value="42">Multi-Family</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px', fontSize: '11px' }}>
                        {`${impact.withCount}/${impact.withYearBuilt}/$${(impact.withNormTime/1000).toFixed(0)}k/$${(impact.withNormSize/1000).toFixed(0)}k/$${(impact.withAvg/1000).toFixed(0)}k`}
                      </td>
                      <td style={{ padding: '8px', fontSize: '11px' }}>
                        {`${impact.withoutCount}/${impact.withoutYearBuilt}/$${(impact.withoutNormTime/1000).toFixed(0)}k/$${(impact.withoutNormSize/1000).toFixed(0)}k/$${(impact.withoutAvg/1000).toFixed(0)}k`}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: parseFloat(impact.impact) < 0 ? '#DC2626' : '#10B981' }}>
                        {impact.impact}%
                      </td>
                      <td style={{ padding: '8px' }}>
                        <input
                          type="number"
                          value={actualAdjustments[key] || ''}
                          onChange={(e) => updateActualAdjustment(vcs, codes, e.target.value)}
                          placeholder="-"
                          style={{
                            width: '50px',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            textAlign: 'center'
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ========== MAIN RENDER ==========
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px', color: '#6B7280' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '10px' }}>Loading saved analysis...</div>
          <div style={{ fontSize: '12px' }}>This may take a moment for large datasets</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Tab Navigation - FIXED STYLE */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid #E5E7EB', marginBottom: '20px' }}>
        {[
          { id: 'land-rates', label: 'Land Rates', icon: <TrendingUp size={16} /> },
          { id: 'allocation', label: 'Allocation Study', icon: <Calculator size={16} />, disabled: !cascadeConfig.normal.prime },
          { id: 'vcs-sheet', label: 'VCS Sheet', icon: <Home size={16} /> },
          { id: 'eco-obs', label: 'Economic Obsolescence', icon: <MapPin size={16} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => !tab.disabled && setActiveSubTab(tab.id)}
            disabled={tab.disabled}
            style={{
              padding: '12px 24px',
              backgroundColor: 'transparent',
              color: activeSubTab === tab.id ? '#3B82F6' : tab.disabled ? '#9CA3AF' : '#6B7280',
              border: 'none',
              borderBottom: activeSubTab === tab.id ? '2px solid #3B82F6' : '2px solid transparent',
              cursor: tab.disabled ? 'not-allowed' : 'pointer',
              fontWeight: activeSubTab === tab.id ? '600' : '400',
              fontSize: '14px',
              opacity: tab.disabled ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => exportToExcel('complete')}
            style={{
              backgroundColor: '#8B5CF6',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '14px'
            }}
          >
            <FileDown size={16} /> Export All
          </button>
          <button
            onClick={() => saveAnalysis()}
            disabled={isSaving}
            style={{
              backgroundColor: '#10B981',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              border: 'none',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '14px',
              opacity: isSaving ? 0.5 : 1
            }}
          >
            <Save size={16} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
          {lastSaved && (
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeSubTab === 'land-rates' && renderLandRatesTab()}
      {activeSubTab === 'allocation' && renderAllocationStudyTab()}
      {activeSubTab === 'vcs-sheet' && renderVCSSheetTab()}
      {activeSubTab === 'eco-obs' && renderEconomicObsolescenceTab()}
    </div>
  );
};

export default LandValuationTab;
