// LandValuationTab.jsx - SECTION 1: Imports and State Setup
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Plus, Search, TrendingUp,
  Calculator, Download, Trash2,
  Save, FileDown, MapPin,
  Home
} from 'lucide-react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx';

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
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  
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
      residual: { max: null, rate: null },
      standard: { max: 100, rate: null } // For front foot method
    },
    special: {},
    vcsSpecific: {}, // New: VCS-specific configurations
    specialCategories: {
      wetlands: null,
      landlocked: null,
      conservation: null
    },
    customCategories: []
  });
  
  // VCS Analysis
  const [bracketAnalysis, setBracketAnalysis] = useState({});
  const [method2Summary, setMethod2Summary] = useState({});

  // Enhanced Method 2 UI State - Use Single Family as default
  const [method2TypeFilter, setMethod2TypeFilter] = useState('1');
  const [expandedVCS, setExpandedVCS] = useState(new Set());

  // VCS Sheet UI State - Collapsible fields
  const [collapsedFields, setCollapsedFields] = useState({
    zoning: true,
    key: true,
    map: true
  });

  // Method 1 Exclusion State (like Method 2)
  const [method1ExcludedSales, setMethod1ExcludedSales] = useState(new Set());

  // Method 2 Exclusion Modal State
  const [showMethod2Modal, setShowMethod2Modal] = useState(false);
  const [method2ModalVCS, setMethod2ModalVCS] = useState('');
  const [method2ExcludedSales, setMethod2ExcludedSales] = useState(new Set());
  const [modalSortField, setModalSortField] = useState('block');
  const [modalSortDirection, setModalSortDirection] = useState('asc');

  // ========== ALLOCATION STUDY STATE ==========
  const [vacantTestSales, setVacantTestSales] = useState([]);
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
  const [customLocationCodes, setCustomLocationCodes] = useState([]);
// ========== INITIALIZE FROM PROPS ==========
useEffect(() => {
  if (!marketLandData) {
    setIsLoading(false);
    return;
  }

  console.log('🔄 Loading market land data:', {
    hasRawLandConfig: !!marketLandData.raw_land_config,
    hasCascadeRates: !!marketLandData.cascade_rates,
    hasVacantSales: !!marketLandData.vacant_sales_analysis?.sales?.length
  });

  // Restore all saved states from marketLandData
  if (marketLandData.raw_land_config) {
    if (marketLandData.raw_land_config.date_range) {
      setDateRange({
        start: new Date(marketLandData.raw_land_config.date_range.start),
        end: new Date(marketLandData.raw_land_config.date_range.end)
      });
    }
  }

  // Load cascade config from either location (prefer cascade_rates, fallback to raw_land_config)
  const savedConfig = marketLandData.cascade_rates || marketLandData.raw_land_config?.cascade_config;
  if (savedConfig) {
    console.log('🔧 Loading cascade config:', {
      source: marketLandData.cascade_rates ? 'cascade_rates' : 'raw_land_config',
      specialCategories: savedConfig.specialCategories,
      mode: savedConfig.mode
    });

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
      vcsSpecific: savedConfig.vcsSpecific || {},
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

  // Skip the duplicate cascade_rates assignment - it's redundant
  // if (marketLandData.cascade_rates) {
  //   setCascadeConfig(marketLandData.cascade_rates);
  // }

  // Restore Method 1 state persistence (like Method 2)
  if (marketLandData.vacant_sales_analysis?.sales) {
    const savedCategories = {};
    const savedNotes = {};
    const savedRegions = {};
    const savedExcluded = new Set();
    const savedIncluded = new Set();
    const manuallyAddedIds = new Set();

    console.log('🔄 Loading saved Method 1 sales data:', {
      totalSales: marketLandData.vacant_sales_analysis.sales.length,
      salesWithCategories: marketLandData.vacant_sales_analysis.sales.filter(s => s.category).length,
      salesIncluded: marketLandData.vacant_sales_analysis.sales.filter(s => s.included).length,
      salesExcluded: marketLandData.vacant_sales_analysis.sales.filter(s => !s.included).length,
      manuallyAdded: marketLandData.vacant_sales_analysis.sales.filter(s => s.manually_added).length
    });

    marketLandData.vacant_sales_analysis.sales.forEach(s => {
      if (s.category) savedCategories[s.id] = s.category;
      if (s.notes) savedNotes[s.id] = s.notes;
      if (s.special_region && s.special_region !== 'Normal') savedRegions[s.id] = s.special_region;
      if (!s.included) savedExcluded.add(s.id); // Track excluded instead of included
      if (s.included) savedIncluded.add(s.id);
      if (s.manually_added) manuallyAddedIds.add(s.id);
    });

    console.log('🔄 Restored Method 1 states:', {
      excludedCount: savedExcluded.size,
      includedCount: savedIncluded.size,
      manuallyAddedCount: manuallyAddedIds.size,
      categoriesCount: Object.keys(savedCategories).length,
      regionsCount: Object.keys(savedRegions).length,
      excludedIds: Array.from(savedExcluded),
      manuallyAddedIds: Array.from(manuallyAddedIds),
      categories: savedCategories
    });

    setSaleCategories(savedCategories);
    setLandNotes(savedNotes);
    setSpecialRegions(savedRegions);

    // Store for application after filtering - both exclusions and manually added
    window._method1ExcludedSales = savedExcluded;
    window._method1IncludedSales = savedIncluded;
    window._method1ManuallyAdded = manuallyAddedIds;

    setMethod1ExcludedSales(savedExcluded);
    setIncludedSales(savedIncluded);
  }

  // Also restore Method 1 excluded sales from new field (like Method 2)
  if (marketLandData.vacant_sales_analysis?.excluded_sales) {
    const method1Excluded = new Set(marketLandData.vacant_sales_analysis.excluded_sales);
    setMethod1ExcludedSales(method1Excluded);
    window._method1ExcludedSales = method1Excluded;

    console.log('🔄 Restored Method 1 excluded sales from new field:', {
      count: method1Excluded.size,
      ids: Array.from(method1Excluded)
    });
  }

  // Restore Method 2 excluded sales
  if (marketLandData.bracket_analysis?.excluded_sales) {
    setMethod2ExcludedSales(new Set(marketLandData.bracket_analysis.excluded_sales));
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

  if (marketLandData.worksheet_data) {
    setVcsSheetData(marketLandData.worksheet_data.sheet_data || {});
    if (marketLandData.worksheet_data.manual_site_values) {
      setVcsManualSiteValues(marketLandData.worksheet_data.manual_site_values);
    }
    if (marketLandData.worksheet_data.descriptions) {
      setVcsDescriptions(marketLandData.worksheet_data.descriptions);
    }
    if (marketLandData.worksheet_data.types) {
      setVcsTypes(marketLandData.worksheet_data.types);
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
  setIsInitialLoadComplete(true);

  console.log('✅ Initial load complete');
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
    if (!properties) return [{ code: '1', description: '1-Single Family' }];

    // Get unique asset_type_use codes ONLY from properties with time-normalized data
    const uniqueCodes = new Set();
    properties.forEach(prop => {
      if (prop.asset_type_use &&
          prop.property_m4_class === '2' &&
          prop.values_norm_time != null &&
          prop.values_norm_time > 0) {
        const rawCode = prop.asset_type_use.toString().trim().toUpperCase();
        if (rawCode && rawCode !== '' && rawCode !== 'null' && rawCode !== 'undefined') {
          uniqueCodes.add(rawCode);
        }
      }
    });

    const options = [];

    // Always include Single Family
    if (uniqueCodes.has('1') || uniqueCodes.has('10')) {
      options.push({ code: '1', description: '1-Single Family' });
    }

    // Add umbrella groups only if we have matching codes
    const umbrellaGroups = [
      {
        codes: ['30', '31', '3E', '3I'],
        groupCode: '3',
        description: '3-Row/Townhouses'
      },
      {
        codes: ['42', '43', '44'],
        groupCode: '4',
        description: '4-MultiFamily'
      },
      {
        codes: ['51', '52', '53'],
        groupCode: '5',
        description: '5-Conversions'
      }
    ];

    umbrellaGroups.forEach(group => {
      const hasMatchingCodes = group.codes.some(code => uniqueCodes.has(code));
      if (hasMatchingCodes) {
        options.push({ code: group.groupCode, description: group.description });
      }
    });

    // Add any other individual codes that don't fit the umbrella groups
    const allUmbrellaCodes = ['1', '10', '30', '31', '3E', '3I', '42', '43', '44', '51', '52', '53'];
    uniqueCodes.forEach(code => {
      if (!allUmbrellaCodes.includes(code)) {
        // Special case for code '2' - Semi Det
        if (code === '2') {
          options.push({ code, description: `2-Semi Det` });
        } else {
          options.push({ code, description: `${code}-Other` });
        }
      }
    });

    return options.sort((a, b) => a.code.localeCompare(b.code));
  }, [properties]);

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

  // Let filterVacantSales handle all sales filtering and restoration

  // ========== LOAD DATA EFFECTS ==========
  // Update filter when vendor type changes
  useEffect(() => {
    setMethod2TypeFilter('1'); // Always default to Single Family
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

  // Auto-save every 30 seconds - but only after initial load is complete
  useEffect(() => {
    if (!isInitialLoadComplete) {
      console.log('���️ Auto-save waiting for initial load to complete');
      return;
    }

    console.log('🔄 Auto-save effect triggered, setting up interval');
    const interval = setInterval(() => {
      console.log('⏰ Auto-save interval triggered');
      // Use window reference to avoid hoisting issues
      if (window.landValuationSave) {
        window.landValuationSave();
      }
    }, 30000);
    return () => {
      console.log('🛑 Clearing auto-save interval');
      clearInterval(interval);
    }
  }, [isInitialLoadComplete]);

  // Immediate auto-save when critical state changes (like adding sales)
  useEffect(() => {
    if (!isInitialLoadComplete) return;

    console.log('🔄 State change detected, triggering immediate save');
    const timeoutId = setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave();
      }
    }, 1000); // 1 second delay to batch multiple changes

    return () => clearTimeout(timeoutId);
  }, [vacantSales.length, Object.keys(saleCategories).length, isInitialLoadComplete]);

  // Clear Method 1 temporary variables after filtering is complete
  useEffect(() => {
    if (isInitialLoadComplete && window._method1ExcludedSales) {
      console.log('🧹 Clearing Method 1 temporary variables after successful application');
      delete window._method1ExcludedSales;
      delete window._method1IncludedSales;
      delete window._method1ManuallyAdded;
    }
  }, [isInitialLoadComplete]);
  // ========== LAND RATES FUNCTIONS WITH ENHANCED FILTERS ==========
  const filterVacantSales = useCallback(() => {
    if (!properties) return;

    console.log('🔄 FilterVacantSales called:', {
      currentVacantSalesCount: vacantSales.length,
      hasMethod1Excluded: !!window._method1ExcludedSales,
      method1ExcludedSize: window._method1ExcludedSales?.size || 0,
      hasManuallyAdded: !!window._method1ManuallyAdded,
      manuallyAddedSize: window._method1ManuallyAdded?.size || 0
    });

    // CRITICAL: First restore manually added properties that might not meet natural criteria
    const finalSales = [];
    const manuallyAddedIds = window._method1ManuallyAdded || new Set();

    if (manuallyAddedIds.size > 0) {
      const manuallyAddedProps = properties.filter(prop => manuallyAddedIds.has(prop.id));
      console.log('🔄 Restoring manually added properties:', {
        found: manuallyAddedProps.length,
        expected: manuallyAddedIds.size,
        foundIds: manuallyAddedProps.map(p => p.id),
        expectedIds: Array.from(manuallyAddedIds)
      });

      manuallyAddedProps.forEach(prop => {
        const acres = calculateAcreage(prop);
        const pricePerUnit = getPricePerUnit(prop.sales_price, acres);
        finalSales.push({
          ...prop,
          totalAcres: acres,
          pricePerAcre: pricePerUnit,
          manuallyAdded: true
        });
      });
    }

    // If we already have restored sales, preserve them and only add new ones
    if (false) { // Disable complex caching logic
      console.log('���� Preserving existing restored sales, checking for new ones only');

      // Find any new sales that match criteria but aren't already in vacantSales
      const existingIds = new Set(vacantSales.map(s => s.id));
      const newSales = properties.filter(prop => {
        if (existingIds.has(prop.id)) return false;

        const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
        const inDateRange = prop.sales_date >= dateRange.start.toISOString().split('T')[0] &&
                            prop.sales_date <= dateRange.end.toISOString().split('T')[0];

        const nu = prop.sales_nu || '';
        const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu === '07' ||
                        nu === '7' || nu.charCodeAt(0) === 32;

        const isAdditionalCard = prop.property_addl_card &&
                          prop.property_addl_card !== 'NONE' &&
                          prop.property_addl_card !== 'M';
        if (isAdditionalCard) return false;

        const isVacantClass = prop.property_m4_class === '1' || prop.property_m4_class === '3B';
        const isTeardown = prop.property_m4_class === '2' &&
                          prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                          prop.asset_design_style &&
                          prop.asset_type_use &&
                          prop.values_mod_improvement < 10000;
        const isPreConstruction = prop.property_m4_class === '2' &&
                                 prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                                 prop.asset_design_style &&
                                 prop.asset_type_use &&
                                 prop.asset_year_built &&
                                 prop.sales_date &&
                                 new Date(prop.sales_date).getFullYear() < prop.asset_year_built;

        return hasValidSale && inDateRange && validNu && (isVacantClass || isTeardown || isPreConstruction);
      });

      if (newSales.length > 0) {
        console.log('🔄 Found new sales to add:', newSales.length);
        const enriched = newSales.map(prop => {
          const acres = calculateAcreage(prop);
          const pricePerUnit = getPricePerUnit(prop.sales_price, acres);
          return {
            ...prop,
            totalAcres: acres,
            pricePerAcre: pricePerUnit
          };
        });

        setVacantSales(prev => [...prev, ...enriched]);

        // Auto-include new sales
        setIncludedSales(prev => new Set([...prev, ...newSales.map(s => s.id)]));
      }

      return; // Don't rebuild if we already have restored sales
    }

    // Now identify naturally qualifying vacant/teardown/pre-construction sales (excluding manually added)
    const allSales = properties.filter(prop => {
      // Skip if this is a manually added property - we already processed it
      if (manuallyAddedIds.has(prop.id)) {
        return false;
      }

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

    // Process packages and standalone (add to existing finalSales that contains manually added)

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

        // Set package category
        if (packageSale.autoCategory) {
          setSaleCategories(prev => ({...prev, [packageSale.id]: packageSale.autoCategory}));
        }
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
        console.log(`🏷️ Auto-categorizing ${prop.property_block}/${prop.property_lot} as ${enriched.autoCategory}`);
        setSaleCategories(prev => ({...prev, [prop.id]: enriched.autoCategory}));
      }
    });

    // CRITICAL FIX: Filter out excluded sales from Method 1 before setting finalSales
    const activeExcluded = window._method1ExcludedSales || method1ExcludedSales;
    const filteredSales = finalSales.filter(sale => !activeExcluded.has(sale.id));

    console.log('🔄 Applying Method 1 exclusions:', {
      totalSalesBeforeExclusion: finalSales.length,
      excludedSalesCount: activeExcluded.size,
      totalSalesAfterExclusion: filteredSales.length,
      excludedIds: Array.from(activeExcluded),
      filteredOutSales: finalSales.filter(sale => activeExcluded.has(sale.id)).map(s => ({id: s.id, block: s.property_block, lot: s.property_lot}))
    });

    setVacantSales(filteredSales);

    // Preserve checkbox states more intelligently
    setIncludedSales(prev => {
      // If initial load isn't complete yet, don't modify included sales
      if (!isInitialLoadComplete) {
        console.log('⏸️ Skipping checkbox update - waiting for initial load');
        return prev;
      }

      const existingIds = new Set(prev);
      const currentSaleIds = new Set(filteredSales.map(s => s.id));

      // Start with existing included sales that are still in the current results (after exclusion filter)
      const preservedIncluded = new Set([...prev].filter(id => currentSaleIds.has(id)));

      // Auto-include only sales that are truly new (not in previous state at all)
      filteredSales.forEach(sale => {
        if (!existingIds.has(sale.id)) {
          preservedIncluded.add(sale.id);
        }
      });

      console.log('✅ Checkbox state management:', {
        isInitialLoadComplete,
        previousCount: prev.size,
        currentSalesCount: filteredSales.length,
        preservedCount: preservedIncluded.size,
        newlyAdded: preservedIncluded.size - [...prev].filter(id => currentSaleIds.has(id)).length,
        excludedCount: filteredSales.length - preservedIncluded.size,
        preservedIds: Array.from(preservedIncluded),
        filteredSalesIds: filteredSales.map(s => s.id),
        salesMismatch: filteredSales.filter(s => !preservedIncluded.has(s.id)).map(s => ({id: s.id, block: s.property_block, lot: s.property_lot}))
      });

      return preservedIncluded;
    });
  }, [properties, dateRange, calculateAcreage, getPricePerUnit, saleCategories]);

  const performBracketAnalysis = useCallback(async () => {
    if (!properties || !jobData?.id) return;

    try {
      // Build time-normalized dataset from already-loaded properties (avoids extra DB joins)
      const timeNormalizedData = properties
        .filter(p =>
          p.values_norm_time != null &&
          p.values_norm_time > 0
        )
        .map(p => ({
          property_composite_key: p.property_composite_key,
          new_vcs: p.new_vcs,
          values_norm_time: p.values_norm_time
        }));

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

        // Skip if manually excluded from Method 2
        if (method2ExcludedSales.has(prop.id)) return;

        // Apply type/use filter with umbrella group support
        const rawTypeUse = prop.asset_type_use?.toString().trim().toUpperCase();

        let passesFilter = false;
        if (method2TypeFilter === '1') {
          // Single Family - include both 1 and 10
          passesFilter = rawTypeUse === '1' || rawTypeUse === '10';
        } else if (method2TypeFilter === '3') {
          // Row/Townhouses umbrella
          passesFilter = ['30', '31', '3E', '3I'].includes(rawTypeUse);
        } else if (method2TypeFilter === '4') {
          // MultiFamily umbrella
          passesFilter = ['42', '43', '44'].includes(rawTypeUse);
        } else if (method2TypeFilter === '5') {
          // Conversions umbrella
          passesFilter = ['51', '52', '53'].includes(rawTypeUse);
        } else {
          // Direct match for other codes
          passesFilter = rawTypeUse === method2TypeFilter;
        }

        if (!passesFilter) return;

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
          small: sales.filter(s => s.acres < 1),              // 0 to 0.99
          medium: sales.filter(s => s.acres >= 1 && s.acres < 5),  // 1.00-4.99
          large: sales.filter(s => s.acres >= 5 && s.acres < 10),  // 5.00-9.99
          xlarge: sales.filter(s => s.acres >= 10)            // 10.00 and greater
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

          // Use time-normalized values for Method 2
          const avgNormTime = arr.reduce((sum, s) => sum + s.normalizedTime, 0) / arr.length;
          const avgAcres = arr.reduce((sum, s) => sum + s.acres, 0) / arr.length;
          const validSFLA = arr.filter(s => s.sfla > 0);
          const avgSFLA = validSFLA.length > 0 ?
            validSFLA.reduce((sum, s) => sum + s.sfla, 0) / validSFLA.length : null;

          // Jim's Magic Formula for size adjustment (using time-normalized values)
          let avgAdjusted = avgNormTime;
          if (overallAvgSFLA && avgSFLA && avgSFLA > 0) {
            const sflaDiff = overallAvgSFLA - avgSFLA;
            const pricePerSqFt = avgNormTime / avgSFLA;
            const sizeAdjustment = sflaDiff * (pricePerSqFt * 0.50);
            avgAdjusted = avgNormTime + sizeAdjustment;
          }

          return {
            count: arr.length,
            avgAcres: Math.round(avgAcres * 100) / 100, // Round to 2 decimals
            avgSalePrice: Math.round(avgNormTime), // Time-normalized sale price
            avgNormTime: Math.round(avgNormTime), // Keep for compatibility
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
          avgPrice: Math.round(sales.reduce((sum, s) => sum + s.normalizedTime, 0) / sales.length), // Use time-normalized
          avgAcres: Math.round((sales.reduce((sum, s) => sum + s.acres, 0) / sales.length) * 100) / 100,
          avgAdjusted: Math.round(sales.reduce((sum, s) => sum + s.normalizedTime, 0) / sales.length),
          brackets: bracketStats,
          impliedRate
        };
      });

      // Calculate Method 2 Summary by bracket ranges with positive deltas only
      const bracketRates = {
        mediumRange: [], // 1.00-4.99 acre rates (medium vs small)
        largeRange: [],  // 5.00-9.99 acre rates (large vs medium)
        xlargeRange: [] // 10.00+ acre rates (xlarge vs large)
      };

      Object.keys(vcsSales).forEach(vcs => {
        const vcsAnalysis = analysis[vcs];
        if (!vcsAnalysis) return;

        const { brackets } = vcsAnalysis;

        // 1.00-4.99 range: medium vs small
        if (brackets.small.count > 0 && brackets.medium.count > 0) {
          const priceDiff = brackets.medium.avgAdjusted - brackets.small.avgAdjusted;
          const acresDiff = brackets.medium.avgAcres - brackets.small.avgAcres;
          if (acresDiff > 0 && priceDiff > 0) {
            const rate = Math.round(priceDiff / acresDiff);
            bracketRates.mediumRange.push(rate);
          }
        }

        // 5.00-9.99 range: large vs medium
        if (brackets.medium.count > 0 && brackets.large.count > 0) {
          const priceDiff = brackets.large.avgAdjusted - brackets.medium.avgAdjusted;
          const acresDiff = brackets.large.avgAcres - brackets.medium.avgAcres;
          if (acresDiff > 0 && priceDiff > 0) {
            const rate = Math.round(priceDiff / acresDiff);
            bracketRates.largeRange.push(rate);
          }
        }

        // 10.00+ range: xlarge vs large
        if (brackets.large.count > 0 && brackets.xlarge.count > 0) {
          const priceDiff = brackets.xlarge.avgAdjusted - brackets.large.avgAdjusted;
          const acresDiff = brackets.xlarge.avgAcres - brackets.large.avgAcres;
          if (acresDiff > 0 && priceDiff > 0) {
            const rate = Math.round(priceDiff / acresDiff);
            bracketRates.xlargeRange.push(rate);
          }
        }
      });

      // Calculate averages for each bracket range
      const calculateBracketSummary = (rates) => {
        if (rates.length === 0) return { perAcre: 'N/A', perSqFt: 'N/A', count: 0 };

        const avgPerAcre = Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
        const avgPerSqFt = (avgPerAcre / 43560).toFixed(2);

        return {
          perAcre: avgPerAcre,
          perSqFt: avgPerSqFt,
          count: rates.length
        };
      };

      setMethod2Summary({
        mediumRange: calculateBracketSummary(bracketRates.mediumRange), // 1.00-4.99
        largeRange: calculateBracketSummary(bracketRates.largeRange),   // 5.00-9.99
        xlargeRange: calculateBracketSummary(bracketRates.xlargeRange), // 10.00+
        totalVCS: Object.keys(vcsSales).length
      });

      setBracketAnalysis(analysis);

    } catch (error) {
      console.error('Error in performBracketAnalysis:', error);
      setBracketAnalysis({});
    }
  }, [properties, jobData, method2TypeFilter, method2ExcludedSales]);

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

    // Sort results numerically by block, then lot
    results.sort((a, b) => {
      const blockA = parseInt(a.property_block) || 0;
      const blockB = parseInt(b.property_block) || 0;

      if (blockA !== blockB) {
        return blockA - blockB;
      }

      // If blocks are the same, sort by lot
      const lotA = parseInt(a.property_lot) || 0;
      const lotB = parseInt(b.property_lot) || 0;
      return lotA - lotB;
    });

    setSearchResults(results);
  };
  // Method 2 Modal Functions
  const openMethod2SalesModal = (vcs) => {
    setMethod2ModalVCS(vcs);
    setShowMethod2Modal(true);
    // Reset sort to block ascending
    setModalSortField('block');
    setModalSortDirection('asc');
  };

  const handleModalSort = (field) => {
    if (modalSortField === field) {
      setModalSortDirection(modalSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setModalSortField(field);
      setModalSortDirection('asc');
    }
  };

  const sortModalData = (data) => {
    return [...data].sort((a, b) => {
      let aVal, bVal;

      switch (modalSortField) {
        case 'block':
          // Numerical sorting for blocks
          aVal = parseInt(a.property_block) || 0;
          bVal = parseInt(b.property_block) || 0;
          break;
        case 'lot':
          // Numerical sorting for lots
          aVal = parseInt(a.property_lot) || 0;
          bVal = parseInt(b.property_lot) || 0;
          break;
        case 'address':
          aVal = a.property_location || '';
          bVal = b.property_location || '';
          break;
        case 'saleDate':
          aVal = new Date(a.sales_date || 0);
          bVal = new Date(b.sales_date || 0);
          break;
        case 'salePrice':
          aVal = a.sales_price || 0;
          bVal = b.sales_price || 0;
          break;
        case 'normTime':
          aVal = a.normalizedTime || 0;
          bVal = b.normalizedTime || 0;
          break;
        case 'acres':
          aVal = parseFloat(a.asset_lot_acre || 0);
          bVal = parseFloat(b.asset_lot_acre || 0);
          break;
        case 'sfla':
          aVal = parseInt(a.asset_sfla || 0);
          bVal = parseInt(b.asset_sfla || 0);
          break;
        case 'yearBuilt':
          aVal = parseInt(a.asset_year_built || 0);
          bVal = parseInt(b.asset_year_built || 0);
          break;
        case 'typeUse':
          aVal = a.asset_type_use || '';
          bVal = b.asset_type_use || '';
          break;
        default:
          return 0;
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (modalSortDirection === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
  };

  const getMethod2SalesForVCS = (vcs) => {
    if (!properties || !vcs) return [];

    // Get time normalized data lookup
    const timeNormalizedData = properties
      .filter(p => p.values_norm_time != null && p.values_norm_time > 0)
      .map(p => ({
        property_composite_key: p.property_composite_key,
        new_vcs: p.new_vcs,
        values_norm_time: p.values_norm_time
      }));

    const timeNormLookup = new Map();
    timeNormalizedData.forEach(item => {
      timeNormLookup.set(item.property_composite_key, item);
    });

    // Filter properties for this VCS
    return properties.filter(prop => {
      const timeNormData = timeNormLookup.get(prop.property_composite_key);
      if (!timeNormData || timeNormData.new_vcs !== vcs) return false;

      // Apply type/use filter
      const rawTypeUse = prop.asset_type_use?.toString().trim().toUpperCase();
      let passesFilter = false;
      if (method2TypeFilter === '1') {
        passesFilter = rawTypeUse === '1' || rawTypeUse === '10';
      } else if (method2TypeFilter === '3') {
        passesFilter = ['30', '31', '3E', '3I'].includes(rawTypeUse);
      } else if (method2TypeFilter === '4') {
        passesFilter = ['42', '43', '44'].includes(rawTypeUse);
      } else if (method2TypeFilter === '5') {
        passesFilter = ['51', '52', '53'].includes(rawTypeUse);
      } else {
        passesFilter = rawTypeUse === method2TypeFilter;
      }

      return passesFilter;
    }).map(prop => ({
      ...prop,
      normalizedTime: timeNormLookup.get(prop.property_composite_key).values_norm_time
    }));
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
    
    // Auto-categorize teardowns and pre-construction (match filterVacantSales logic)
    toAdd.forEach(p => {
      let autoCategory = null;

      // Teardown detection (Class 2 with minimal improvement)
      if (p.property_m4_class === '2' &&
          p.asset_building_class && parseInt(p.asset_building_class) > 10 &&
          p.asset_design_style &&
          p.asset_type_use &&
          p.values_mod_improvement < 10000) {
        autoCategory = 'teardown';
      }
      // Pre-construction detection (sold before house was built)
      else if (p.property_m4_class === '2' &&
               p.asset_building_class && parseInt(p.asset_building_class) > 10 &&
               p.asset_design_style &&
               p.asset_type_use &&
               p.asset_year_built &&
               p.sales_date &&
               new Date(p.sales_date).getFullYear() < p.asset_year_built) {
        autoCategory = 'pre-construction';
      }
      // General Class 2 fallback to building lot
      else if (p.property_m4_class === '2') {
        autoCategory = 'building_lot';
      }

      if (autoCategory) {
        console.log(`🏗️ Auto-categorizing manually added ${p.property_block}/${p.property_lot} as ${autoCategory}`);
        setSaleCategories(prev => ({...prev, [p.id]: autoCategory}));
      }
    });
    
    setSelectedToAdd(new Set());
    setShowAddModal(false);
    setSearchResults([]);

    // Note: Auto-save will trigger within 30 seconds to persist these changes
    console.log('💾 Sales added - auto-save will persist these changes:', toAdd.map(p => `${p.property_block}/${p.property_lot}`));
  };

  const handlePropertyResearch = async (property) => {
    const prompt = `Research and analyze this land sale in ${jobData?.municipality || 'Unknown'}, ${jobData?.county || 'Unknown'} County, NJ:

Block ${property.property_block} Lot ${property.property_lot}
Address: ${property.property_location}
Sale Date: ${property.sales_date}
Sale Price: $${property.sales_price?.toLocaleString()}
Acres: ${property.totalAcres?.toFixed(2)}
Price/Acre: $${property.pricePerAcre?.toLocaleString()}
Class: ${property.property_m4_class === '2' ? 'Residential (possible teardown)' : property.property_m4_class}

Find specific information about this property and sale. Include:

• Property ownership/seller details
• Tax assessment and classification details
• Documented environmental constraints (wetlands, floodplains)
• Municipality-specific land use characteristics
• Any circumstances of the sale (estate, distressed, etc.)

Provide only verifiable facts with sources. Be specific and actionable for valuation purposes. 2-3 sentences.`;

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
    // Track exclusion like Method 2 (don't remove from array entirely)
    setMethod1ExcludedSales(prev => new Set([...prev, saleId]));
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      newSet.delete(saleId);
      return newSet;
    });

    console.log('🗑️ Sale removed and tracked as excluded:', saleId);
  };

  // ========== ALLOCATION STUDY FUNCTIONS - REBUILT ==========
  const loadAllocationStudyData = useCallback(() => {
    if (!cascadeConfig.normal.prime) return;

    console.log('🏠 Loading allocation study data - individual sale approach');

    // Process each individual vacant sale (no grouping)
    const processedVacantSales = [];

    vacantSales.filter(s => includedSales.has(s.id)).forEach(sale => {
      const year = new Date(sale.sales_date).getFullYear();
      const vcs = sale.new_vcs;
      const region = specialRegions[sale.id] || 'Normal';

      if (!vcs) return;

      // Calculate site value for this individual sale
      const acres = sale.totalAcres || parseFloat(calculateAcreage(sale));
      const cascadeRates = region === 'Normal' ? cascadeConfig.normal : cascadeConfig.special[region];

      if (!cascadeRates) return;

      // Apply cascade calculation to get raw land value
      const rawLandValue = calculateRawLandValue(acres, cascadeRates);
      const siteValue = sale.sales_price - rawLandValue;

      // Find improved sales for this sale's year
      const improvedSalesForYear = properties.filter(prop => {
        const isResidential = prop.property_m4_class === '2' || prop.property_m4_class === '3A';
        const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
        const hasBuilding = prop.asset_year_built && prop.asset_year_built > 0;
        const hasValues = prop.values_mod_land > 0 && prop.values_mod_total > 0;
        const sameYear = new Date(prop.sales_date).getFullYear() === year;

        return isResidential && hasValidSale && hasBuilding && hasValues && sameYear;
      });

      if (improvedSalesForYear.length === 0) {
        console.log(`⚠️ No improved sales found for year ${year}`);
        return;
      }

      // Calculate averages for this year's improved sales
      const avgImprovedPrice = improvedSalesForYear.reduce((sum, p) => sum + p.sales_price, 0) / improvedSalesForYear.length;
      const avgImprovedAcres = improvedSalesForYear.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / improvedSalesForYear.length;

      // Calculate current allocation for this year
      const currentAllocs = improvedSalesForYear.map(p => p.values_mod_land / p.values_mod_total);
      const avgCurrentAllocation = currentAllocs.reduce((sum, a) => sum + a, 0) / currentAllocs.length;

      // Calculate new land value using this sale's site value + improved sales average raw land
      const improvedRawLandValue = calculateRawLandValue(avgImprovedAcres, cascadeConfig.normal);
      const totalLandValue = improvedRawLandValue + siteValue;

      // Calculate recommended allocation
      const recommendedAllocation = avgImprovedPrice > 0 ? totalLandValue / avgImprovedPrice : 0;

      processedVacantSales.push({
        // Vacant sale info
        id: sale.id,
        vcs,
        year,
        region,
        block: sale.property_block,
        lot: sale.property_lot,
        vacantPrice: sale.sales_price,
        acres,
        rawLandValue,
        siteValue,

        // Improved sales info for this year
        improvedSalesCount: improvedSalesForYear.length,
        avgImprovedPrice: Math.round(avgImprovedPrice),
        avgImprovedAcres: avgImprovedAcres.toFixed(2),
        improvedRawLandValue: Math.round(improvedRawLandValue),
        totalLandValue: Math.round(totalLandValue),

        // Allocation calculations
        currentAllocation: avgCurrentAllocation,
        recommendedAllocation,

        // Status
        isPositive: siteValue > 0 && recommendedAllocation > 0
      });
    });

    console.log('🏠 Processed allocation data:', {
      totalVacantSales: processedVacantSales.length,
      positiveSales: processedVacantSales.filter(s => s.isPositive).length,
      negativeSales: processedVacantSales.filter(s => !s.isPositive).length
    });

    setVacantTestSales(processedVacantSales);

    // Calculate overall recommended allocation (positive sales only)
    const positiveSales = processedVacantSales.filter(s => s.isPositive);
    if (positiveSales.length > 0) {
      const totalLandValue = positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0);
      const totalSalePrice = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
      const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

      console.log('🎯 Overall recommended allocation:', {
        positiveSalesCount: positiveSales.length,
        totalLandValue,
        totalSalePrice,
        recommendedPercent: overallRecommended.toFixed(1)
      });
    }
  }, [cascadeConfig, vacantSales, includedSales, specialRegions, calculateAcreage, properties]);

  // Helper function to calculate raw land value using cascade rates
  const calculateRawLandValue = (acres, cascadeRates) => {
    let remainingAcres = acres;
    let rawLandValue = 0;

    // First tier (prime): typically first 1 acre
    if (cascadeRates.prime) {
      const primeAcres = Math.min(remainingAcres, cascadeRates.prime.max || 1);
      rawLandValue += primeAcres * (cascadeRates.prime.rate || 0);
      remainingAcres -= primeAcres;
    }

    // Second tier (secondary): typically acres 1-5 (so 4 acres)
    if (cascadeRates.secondary && remainingAcres > 0) {
      const secondaryMax = (cascadeRates.secondary.max || 5) - (cascadeRates.prime?.max || 1);
      const secondaryAcres = Math.min(remainingAcres, secondaryMax);
      rawLandValue += secondaryAcres * (cascadeRates.secondary.rate || 0);
      remainingAcres -= secondaryAcres;
    }

    // Third tier (excess): typically anything above 5 acres - apply to ALL remaining acres
    // Note: We don't limit this tier, it applies to all remaining acres if no residual tier exists
    if (cascadeRates.excess && remainingAcres > 0) {
      if (cascadeRates.residual) {
        // If there's a residual tier, excess only applies up to its max
        const excessMax = (cascadeRates.excess.max || 10) - (cascadeRates.secondary?.max || 5);
        const excessAcres = Math.min(remainingAcres, excessMax);
        rawLandValue += excessAcres * (cascadeRates.excess.rate || 0);
        remainingAcres -= excessAcres;
      } else {
        // If no residual tier, excess applies to ALL remaining acres
        rawLandValue += remainingAcres * (cascadeRates.excess.rate || 0);
        remainingAcres = 0;
      }
    }

    // Fourth tier (residual): anything beyond excess max (if defined)
    if (cascadeRates.residual && remainingAcres > 0) {
      rawLandValue += remainingAcres * (cascadeRates.residual.rate || 0);
    }

    return rawLandValue;
  };


  const getUniqueRegions = useCallback(() => {
    const regions = new Set(['Normal']);
    Object.values(specialRegions).forEach(r => regions.add(r));
    return Array.from(regions);
  }, [specialRegions]);

  const getUniqueYears = useCallback(() => {
    const years = new Set();
    vacantTestSales.forEach(sale => {
      if (sale.year) years.add(sale.year);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [vacantTestSales]);

  const getUniqueVCS = useCallback(() => {
    const vcs = new Set();
    vacantTestSales.forEach(sale => {
      if (sale.vcs) vcs.add(sale.vcs);
    });
    return Array.from(vcs).sort();
  }, [vacantTestSales]);

  const calculateAllocationStats = useCallback((region = null) => {
    // Use only positive sales for final calculation
    let filtered = vacantTestSales.filter(s => s.isPositive);

    if (region && region !== 'all') {
      filtered = filtered.filter(s => s.region === region);
    }

    if (filtered.length === 0) return null;

    // Calculate overall recommended allocation (sum of land values / sum of sale prices)
    const totalLandValue = filtered.reduce((sum, s) => sum + s.totalLandValue, 0);
    const totalSalePrice = filtered.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
    const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

    // Individual allocations for range analysis
    const allocations = filtered.map(s => s.recommendedAllocation * 100);
    const within25to40 = allocations.filter(a => a >= 25 && a <= 40).length;
    const percentInRange = allocations.length > 0 ? (within25to40 / allocations.length) * 100 : 0;

    return {
      averageAllocation: overallRecommended.toFixed(1),
      percentInTargetRange: percentInRange.toFixed(1),
      totalSales: filtered.length
    };
  }, [vacantTestSales]);
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
          const saleDate = new Date(prop.sales_date);
          const octoberFirstThreeYearsPrior = getOctoberFirstThreeYearsPrior();

          // Sales from October 1st three years prior to present
          if (saleDate >= octoberFirstThreeYearsPrior) {
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

  const toggleFieldCollapse = (fieldName) => {
    setCollapsedFields(prev => ({
      ...prev,
      [fieldName]: !prev[fieldName]
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
    if (!jobData?.id) {
      console.log('❌ Save cancelled: No job ID');
      return;
    }

    console.log('💾 Starting save...', {
      vacantSalesCount: vacantSales.length,
      excludedSalesCount: method2ExcludedSales.size,
      includedSalesCount: includedSales.size,
      specialCategories: cascadeConfig.specialCategories,
      normalRates: cascadeConfig.normal,
      salesWithCategories: Object.keys(saleCategories).length,
      checkboxStates: vacantSales.map(s => ({ id: s.id, block: s.property_block, lot: s.property_lot, included: includedSales.has(s.id) }))
    });

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
          excluded_sales: Array.from(method1ExcludedSales), // Track Method 1 exclusions like Method 2
          rates: calculateRates(),
          rates_by_region: getUniqueRegions().map(region => ({
            region,
            rates: calculateRates(region)
          }))
        },
        bracket_analysis: {
          ...bracketAnalysis,
          excluded_sales: Array.from(method2ExcludedSales),
          summary: method2Summary
        },
        cascade_rates: cascadeConfig,
        allocation_study: {
          vcs_site_values: vcsSiteValues,
          actual_allocations: actualAllocations,
          target_allocation: targetAllocation,
          current_overall_allocation: currentOverallAllocation,
          stats: calculateAllocationStats()
        },
        worksheet_data: {
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

      // Debug: Log the exact data being saved
      console.log('💾 Data structure being saved:', {
        cascadeConfigLocation1: analysisData.raw_land_config.cascade_config.specialCategories,
        cascadeConfigLocation2: analysisData.cascade_rates.specialCategories,
        salesData: analysisData.vacant_sales_analysis.sales.slice(0, 3), // First 3 for brevity
        totalSales: analysisData.vacant_sales_analysis.sales.length
      });

      // Check if record exists - don't use .single() to avoid errors
      const { data: existing, error: checkError } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .maybeSingle();

      // If there was an error checking, log it but try to proceed with upsert
      if (checkError && checkError.code !== 'PGRST116') {
        console.warn('⚠️ Error checking for existing record:', checkError);
      }

      if (existing) {
        console.log('📝 Updating existing record...');
        const { error } = await supabase
          .from('market_land_valuation')
          .update(analysisData)
          .eq('job_id', jobData.id);
        if (error) throw error;
      } else {
        console.log('➕ Creating new record...');
        // Use upsert to handle race conditions
        const { error } = await supabase
          .from('market_land_valuation')
          .upsert(analysisData, {
            onConflict: 'job_id',
            ignoreDuplicates: false
          });
        if (error) throw error;
      }

      console.log('✅ Save completed successfully');
      setLastSaved(new Date());

      // Notify parent component
      if (onAnalysisUpdate) {
        onAnalysisUpdate(analysisData);
      }
    } catch (error) {
      console.error('��� Save failed:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      alert('Failed to save analysis. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Expose saveAnalysis to window for auto-save access (avoids hoisting issues)
  window.landValuationSave = saveAnalysis;

  // Excel export functions need to be defined before being used
  const exportVCSSheetExcel = () => {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Create title row
    const data = [];
    data.push(['VCS VALUATION SHEET']);
    data.push([]); // Empty row

    // Build headers array
    const headers = ['VCS', 'Total', 'Type', 'Description', 'Method', 'Typical Lot Size', 'Rec Site Value', 'Act Site Value'];

    // Dynamic cascade headers
    if (valuationMode === 'ff') {
      headers.push('Standard Rate ($/FF)', 'Excess Rate ($/FF)');
    } else {
      headers.push('Prime Rate ($/Acre)', 'Secondary Rate ($/Acre)', 'Excess Rate ($/Acre)');
      if (shouldShowResidualColumn) {
        headers.push('Residual Rate ($/Acre)');
      }
    }

    // Special category headers
    headers.push('Wetlands Rate', 'Landlocked Rate', 'Conservation Rate', 'Avg Price (Time Norm)', 'Avg Price (Current)', 'CME Bracket', 'Zoning');
    if (shouldShowKeyColumn) headers.push('Key Pages');
    if (shouldShowMapColumn) headers.push('Map Pages');

    data.push(headers);

    // Add data rows
    Object.keys(vcsSheetData).sort().forEach(vcs => {
      const vcsData = vcsSheetData[vcs];
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
      const recSite = vcsRecommendedSites[vcs] || 0;
      const actSite = vcsManualSiteValues[vcs] || recSite;
      const isResidential = type.startsWith('Residential');

      // Get typical lot size
      const vcsProps = properties?.filter(p =>
        p.new_vcs === vcs && p.asset_lot_acre && p.asset_lot_acre > 0
      ) || [];

      let typicalLot = '';
      if (vcsProps.length > 0) {
        const avgAcres = vcsProps.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProps.length;
        if (valuationMode === 'sf') {
          typicalLot = Math.round(avgAcres * 43560);
        } else {
          typicalLot = Number(avgAcres.toFixed(2));
        }
      }

      // Check special categories
      const vcsSpecialCategories = isResidential ? {
        wetlands: cascadeConfig.specialCategories.wetlands && (
          vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'wetlands') ||
          cascadeConfig.specialCategories.wetlands > 0
        ),
        landlocked: cascadeConfig.specialCategories.landlocked && (
          vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'landlocked') ||
          cascadeConfig.specialCategories.landlocked > 0
        ),
        conservation: cascadeConfig.specialCategories.conservation && (
          vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'conservation') ||
          cascadeConfig.specialCategories.conservation > 0
        )
      } : { wetlands: false, landlocked: false, conservation: false };

      // Clean data
      const cleanDescription = (description || '').substring(0, 100);
      const cleanZoning = (vcsData.zoning || '').replace(/\n/g, ' ').substring(0, 50);

      // Start building row
      const row = [
        vcs,
        vcsData.counts?.total || 0,
        type,
        cleanDescription,
        getMethodDisplay(type, description),
        typicalLot,
        recSite || '',
        actSite || ''
      ];

      // Get cascade rates
      let cascadeRates = cascadeConfig.normal;
      const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
        config.vcsList?.includes(vcs)
      );
      if (vcsSpecificConfig) {
        cascadeRates = vcsSpecificConfig.rates || cascadeConfig.normal;
      } else {
        const vcsInSpecialRegion = vacantSales.find(sale =>
          sale.new_vcs === vcs && specialRegions[sale.id] && specialRegions[sale.id] !== 'Normal'
        );
        if (vcsInSpecialRegion && cascadeConfig.special?.[specialRegions[vcsInSpecialRegion.id]]) {
          cascadeRates = cascadeConfig.special[specialRegions[vcsInSpecialRegion.id]];
        }
      }

      // Add cascade rates
      if (isResidential) {
        if (valuationMode === 'ff') {
          row.push(cascadeRates.standard?.rate || '', cascadeRates.excess?.rate || '');
        } else {
          row.push(
            cascadeRates.prime?.rate || '',
            cascadeRates.secondary?.rate || '',
            cascadeRates.excess?.rate || ''
          );
          if (shouldShowResidualColumn) {
            row.push(cascadeRates.residual?.rate || '');
          }
        }
      } else {
        // Empty cells for non-residential
        if (valuationMode === 'ff') {
          row.push('', '');
        } else {
          row.push('', '', '');
          if (shouldShowResidualColumn) {
            row.push('');
          }
        }
      }

      // Special category rates
      row.push(
        vcsSpecialCategories.wetlands && cascadeConfig.specialCategories.wetlands ? cascadeConfig.specialCategories.wetlands : '',
        vcsSpecialCategories.landlocked && cascadeConfig.specialCategories.landlocked ? cascadeConfig.specialCategories.landlocked : '',
        vcsSpecialCategories.conservation && cascadeConfig.specialCategories.conservation ? cascadeConfig.specialCategories.conservation : ''
      );

      // Price columns
      row.push(
        vcsData.avgNormTime || '',
        vcsData.avgPrice || ''
      );

      // CME bracket
      const cmeBracket = vcsData.avgPrice ? getCMEBracket(vcsData.avgPrice) : null;
      row.push(cmeBracket ? cmeBracket.label : '');

      // Zoning
      row.push(cleanZoning);

      // Optional columns
      if (shouldShowKeyColumn) row.push(vcsData.keyPages || '');
      if (shouldShowMapColumn) row.push(vcsData.mapPages || '');

      data.push(row);
    });

    // Add summary section
    data.push([]);
    data.push(['SUMMARY INFORMATION']);
    data.push([]);
    data.push(['Municipality:', jobData?.municipality || '']);
    data.push(['County:', jobData?.county || '']);
    data.push(['Analysis Date:', new Date().toLocaleDateString()]);
    data.push(['Valuation Method:', valuationMode.toUpperCase()]);
    data.push(['Target Allocation:', targetAllocation ? `${targetAllocation}%` : 'Not Set']);

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    const colWidths = [
      { wch: 8 },   // VCS
      { wch: 8 },   // Total
      { wch: 20 },  // Type
      { wch: 25 },  // Description
      { wch: 12 },  // Method
      { wch: 15 },  // Typical Lot
      { wch: 15 },  // Rec Site
      { wch: 15 },  // Act Site
    ];

    // Add cascade rate column widths
    if (valuationMode === 'ff') {
      colWidths.push({ wch: 15 }, { wch: 15 });
    } else {
      colWidths.push({ wch: 15 }, { wch: 15 }, { wch: 15 });
      if (shouldShowResidualColumn) {
        colWidths.push({ wch: 15 });
      }
    }

    // Add remaining column widths
    colWidths.push(
      { wch: 15 },  // Wetlands
      { wch: 15 },  // Landlocked
      { wch: 15 },  // Conservation
      { wch: 18 },  // Avg Price (Time)
      { wch: 18 },  // Avg Price
      { wch: 12 },  // CME
      { wch: 20 }   // Zoning
    );

    if (shouldShowKeyColumn) colWidths.push({ wch: 15 });
    if (shouldShowMapColumn) colWidths.push({ wch: 15 });

    worksheet['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'VCS Sheet');

    return workbook;
  };

  // Simple CSV version for complete analysis
  const exportVCSSheetCSV = () => {
    let csv = 'VCS VALUATION SHEET\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `County: ${jobData?.county || ''}\n`;
    csv += `Date: ${new Date().toLocaleDateString()}\n\n`;

    // Headers
    csv += 'VCS,Total,Type,Description,Prime Rate,Secondary Rate,Excess Rate';
    if (shouldShowResidualColumn) csv += ',Residual Rate';
    csv += ',Wetlands Rate,Landlocked Rate,Conservation Rate,Avg Price,CME Bracket\n';

    // Data rows
    Object.keys(vcsSheetData).sort().forEach(vcs => {
      const data = vcsSheetData[vcs];
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
      const isResidential = type.startsWith('Residential');

      // Get cascade rates
      let cascadeRates = cascadeConfig.normal;
      const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
        config.vcsList?.includes(vcs)
      );
      if (vcsSpecificConfig) {
        cascadeRates = vcsSpecificConfig.rates || cascadeConfig.normal;
      }

      // Clean description for CSV
      const cleanDescription = (description || '').replace(/"/g, '""').substring(0, 50);

      csv += `"${vcs}",${data.counts?.total || 0},"${type}","${cleanDescription}",`;

      // Cascade rates
      if (isResidential) {
        csv += `${cascadeRates.prime?.rate || ''},${cascadeRates.secondary?.rate || ''},${cascadeRates.excess?.rate || ''}`;
        if (shouldShowResidualColumn) {
          csv += `,${cascadeRates.residual?.rate || ''}`;
        }
      } else {
        csv += ',,,';
        if (shouldShowResidualColumn) csv += ',';
      }

      // Special categories
      const vcsSpecialCategories = isResidential ? {
        wetlands: cascadeConfig.specialCategories.wetlands,
        landlocked: cascadeConfig.specialCategories.landlocked,
        conservation: cascadeConfig.specialCategories.conservation
      } : { wetlands: '', landlocked: '', conservation: '' };

      csv += `,${vcsSpecialCategories.wetlands || ''},${vcsSpecialCategories.landlocked || ''},${vcsSpecialCategories.conservation || ''}`;

      // Price and CME
      const cmeBracket = data.avgPrice ? getCMEBracket(data.avgPrice) : null;
      csv += `,${data.avgPrice || ''},"${cmeBracket ? cmeBracket.label : ''}"\n`;
    });

    return csv;
  };

  const exportToExcel = (type) => {
    const timestamp = new Date().toISOString().split('T')[0];
    const municipality = (jobData?.municipality || 'export').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${type}_${municipality}_${timestamp}.xlsx`;

    let workbook;
    if (type === 'vcs-sheet') {
      workbook = exportVCSSheetExcel();
    } else {
      // For other types, create a simple workbook for now
      workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([['Export type not yet converted to Excel format']]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    }

    // Create and download Excel file
    XLSX.writeFile(workbook, filename);
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
    
    // Individual Allocation Analysis
    csv += 'INDIVIDUAL ALLOCATION ANALYSIS\n';
    csv += 'VCS,Year,Region,Block/Lot,Vacant Price,Acres,Raw Land,Site Value,Improved Sales Count,Avg Improved Price,Avg Improved Acres,Improved Raw Land,Total Land Value,Current %,Recommended %,Status\n';

    vacantTestSales.forEach(sale => {
      const status = sale.isPositive ? 'Included' : 'Excluded';
      csv += `"${sale.vcs}",${sale.year},"${sale.region}","${sale.block}/${sale.lot}",${sale.vacantPrice},${sale.acres.toFixed(2)},${sale.rawLandValue},${sale.siteValue},${sale.improvedSalesCount},${sale.avgImprovedPrice},${sale.avgImprovedAcres},${sale.improvedRawLandValue},${sale.totalLandValue},${(sale.currentAllocation * 100).toFixed(1)},${(sale.recommendedAllocation * 100).toFixed(1)},"${status}"\n`;
    });

    // Summary of positive sales only
    const positiveSales = vacantTestSales.filter(s => s.isPositive);
    if (positiveSales.length > 0) {
      csv += '\n\nSUMMARY (Positive Sales Only)\n';
      csv += `Total Sales Included: ${positiveSales.length}\n`;
      csv += `Total Sales Excluded: ${vacantTestSales.length - positiveSales.length}\n`;
      csv += `Sum of Total Land Values: $${positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0).toLocaleString()}\n`;
      csv += `Sum of Improved Sale Prices: $${positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0).toLocaleString()}\n`;
      const overallRecommended = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0) > 0 ?
        (positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0) / positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0)) * 100 : 0;
      csv += `Overall Recommended Allocation: ${overallRecommended.toFixed(1)}%\n`;
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
    csv += exportVCSSheetCSV();
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
    console.log(`🔧 Updating special category: ${category} = ${rate}`);
    setCascadeConfig(prev => {
      const newConfig = {
        ...prev,
        specialCategories: {
          ...prev.specialCategories,
          [category]: rate ? parseFloat(rate) : null
        }
      };
      console.log('🔧 New cascade config special categories:', newConfig.specialCategories);
      return newConfig;
    });
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

  const updateVCSSpecificCascade = (vcsKey, tier, field, value) => {
    setCascadeConfig(prev => ({
      ...prev,
      vcsSpecific: {
        ...prev.vcsSpecific,
        [vcsKey]: {
          ...prev.vcsSpecific[vcsKey],
          rates: {
            ...prev.vcsSpecific[vcsKey]?.rates,
            [tier]: {
              ...prev.vcsSpecific[vcsKey]?.rates?.[tier],
              [field]: value ? parseFloat(value) : null
            }
          }
        }
      }
    }));
  };

  // ========== REACTIVE CATEGORY CALCULATIONS ==========
  const categoryAnalysis = useMemo(() => {
    // Calculate average rate for checked items by category
    const checkedSales = vacantSales.filter(s => includedSales.has(s.id));

    console.log('🔄 Recalculating category analysis');
    console.log('📊 Total vacant sales:', vacantSales.length);
    console.log('📊 Checked sales count:', checkedSales.length);
    console.log('📋 Included sales IDs:', Array.from(includedSales));
    console.log('📋 Sale categories state:', saleCategories);
    console.log('📋 Teardown sales in checked:', checkedSales.filter(s => saleCategories[s.id] === 'teardown').map(s => `${s.property_block}/${s.property_lot}`));
    console.log('📋 Building lot sales in checked:', checkedSales.filter(s => saleCategories[s.id] === 'building_lot').map(s => `${s.property_block}/${s.property_lot}`));

    // Helper function to calculate average for a category
    const getCategoryAverage = (filterFn, categoryType) => {
      const filtered = checkedSales.filter(filterFn);
      if (filtered.length === 0) return { avg: 0, count: 0, avgLotSize: 0, method: 'none' };

      // Calculate average lot size
      const totalAcres = filtered.reduce((sum, s) => sum + s.totalAcres, 0);
      const avgLotSizeAcres = totalAcres / filtered.length;

      let avgLotSize;
      if (valuationMode === 'acre') {
        avgLotSize = avgLotSizeAcres.toFixed(2) + ' acres';
      } else if (valuationMode === 'sf') {
        avgLotSize = Math.round(avgLotSizeAcres * 43560).toLocaleString() + ' sq ft';
      } else if (valuationMode === 'ff') {
        avgLotSize = 'N/A ff'; // Front foot needs frontage data
      }

      // For constrained land types (wetlands, landlocked, conservation), use simple $/acre
      if (categoryType === 'constrained') {
        if (valuationMode === 'sf') {
          const totalPrice = filtered.reduce((sum, s) => sum + s.sales_price, 0);
          const totalSF = filtered.reduce((sum, s) => sum + (s.totalAcres * 43560), 0);
          return {
            avg: totalSF > 0 ? (totalPrice / totalSF).toFixed(2) : 0,
            count: filtered.length,
            avgLotSize,
            method: 'simple'
          };
        } else {
          const avgRate = filtered.reduce((sum, s) => sum + s.pricePerAcre, 0) / filtered.length;
          return {
            avg: Math.round(avgRate),
            count: filtered.length,
            avgLotSize,
            method: 'simple'
          };
        }
      }

      // For developable land (raw land, building lot), use paired sales analysis
      if (categoryType === 'developable' && filtered.length >= 2) {
        // Sort by acreage for paired analysis
        const sortedSales = [...filtered].sort((a, b) => a.totalAcres - b.totalAcres);

        const pairedRates = [];

        // Calculate incremental rates between pairs
        for (let i = 0; i < sortedSales.length - 1; i++) {
          for (let j = i + 1; j < sortedSales.length; j++) {
            const smaller = sortedSales[i];
            const larger = sortedSales[j];

            const acreageDiff = larger.totalAcres - smaller.totalAcres;
            const priceDiff = larger.sales_price - smaller.sales_price;

            // Only exclude negative price differences - include all acreage differences
            if (priceDiff > 0) {
              const incrementalRate = priceDiff / acreageDiff;
              pairedRates.push({
                rate: incrementalRate,
                smallerAcres: smaller.totalAcres,
                largerAcres: larger.totalAcres,
                priceDiff: priceDiff,
                acreageDiff: acreageDiff,
                properties: `${smaller.property_block}/${smaller.property_lot} vs ${larger.property_block}/${larger.property_lot}`
              });
            }
          }
        }

        if (pairedRates.length > 0) {
          // Use median to reduce outlier influence
          const rates = pairedRates.map(p => p.rate).sort((a, b) => a - b);
          const medianRate = rates.length % 2 === 0 ?
            (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2 :
            rates[Math.floor(rates.length / 2)];

          console.log(`💰 ${categoryType} paired analysis:`, {
            totalProperties: filtered.length,
            possiblePairs: (filtered.length * (filtered.length - 1)) / 2,
            validPairs: pairedRates.length,
            filteredOut: (filtered.length * (filtered.length - 1)) / 2 - pairedRates.length,
            rates: rates.map(r => Math.round(r)),
            medianRate: Math.round(medianRate),
            properties: pairedRates.map(p => p.properties),
            acreageRanges: pairedRates.map(p => `${p.acreageDiff.toFixed(2)} acres`)
          });

          if (valuationMode === 'sf') {
            return {
              avg: (medianRate / 43560).toFixed(2),
              count: filtered.length,
              avgLotSize,
              method: 'paired',
              pairedAnalysis: {
                pairs: pairedRates.length,
                medianRate: Math.round(medianRate),
                bestPair: pairedRates.sort((a, b) => Math.abs(a.acreageDiff - 1) - Math.abs(b.acreageDiff - 1))[0]
              }
            };
          } else {
            return {
              avg: Math.round(medianRate),
              count: filtered.length,
              avgLotSize,
              method: 'paired',
              pairedAnalysis: {
                pairs: pairedRates.length,
                medianRate: Math.round(medianRate),
                bestPair: pairedRates.sort((a, b) => Math.abs(a.acreageDiff - 1) - Math.abs(b.acreageDiff - 1))[0]
              }
            };
          }
        }
      }

      // Fallback to simple calculation if paired analysis fails
      if (valuationMode === 'sf') {
        const totalPrice = filtered.reduce((sum, s) => sum + s.sales_price, 0);
        const totalSF = filtered.reduce((sum, s) => sum + (s.totalAcres * 43560), 0);
        return {
          avg: totalSF > 0 ? (totalPrice / totalSF).toFixed(2) : 0,
          count: filtered.length,
          avgLotSize,
          method: 'fallback'
        };
      } else {
        const avgRate = filtered.reduce((sum, s) => sum + s.pricePerAcre, 0) / filtered.length;
        return {
          avg: Math.round(avgRate),
          count: filtered.length,
          avgLotSize,
          method: 'fallback'
        };
      }
    };

    const rawLand = getCategoryAverage(s => {
      const isRawLandCategory = saleCategories[s.id] === 'raw_land';
      const isUncategorizedVacant = !saleCategories[s.id] && s.property_m4_class === '1';
      const isInRawLand = isRawLandCategory || isUncategorizedVacant;

      // Debug teardown sales to see if they're incorrectly going to raw land
      if (saleCategories[s.id] === 'teardown' || (s.property_block === '5' && s.property_lot === '12.12')) {
        console.log('🌱 Raw Land check for teardown/5.12.12:', {
          block: s.property_block,
          lot: s.property_lot,
          id: s.id,
          category: saleCategories[s.id],
          hasCategory: !!saleCategories[s.id],
          class: s.property_m4_class,
          isRawLandCategory,
          isUncategorizedVacant,
          isInRawLand
        });
      }

      return isInRawLand;
    }, 'developable');

    const buildingLot = getCategoryAverage(s => {
      const isInCategory = saleCategories[s.id] === 'building_lot' ||
                          saleCategories[s.id] === 'teardown' ||
                          saleCategories[s.id] === 'pre-construction';

      // Debug all teardown sales
      if (saleCategories[s.id] === 'teardown') {
        console.log('🏗️ Teardown sale details:', {
          block: s.property_block,
          lot: s.property_lot,
          id: s.id,
          category: saleCategories[s.id],
          isIncluded: includedSales.has(s.id),
          isInBuildingLot: isInCategory,
          price: s.sales_price,
          acres: s.totalAcres,
          pricePerAcre: s.pricePerAcre
        });
      }

      // Keep the 47/2 debug for reference
      if (s.property_block === '47' && s.property_lot === '2') {
        console.log('🏠 Property 47/2 details:', {
          id: s.id,
          category: saleCategories[s.id],
          isInBuildingLot: isInCategory,
          price: s.sales_price,
          acres: s.totalAcres
        });
      }
      return isInCategory;
    }, 'developable');

    const wetlands = getCategoryAverage(s => saleCategories[s.id] === 'wetlands', 'constrained');
    const landlocked = getCategoryAverage(s => saleCategories[s.id] === 'landlocked', 'constrained');
    const conservation = getCategoryAverage(s => saleCategories[s.id] === 'conservation', 'constrained');

    console.log('🏗️ Building Lot Analysis Result:', {
      avg: buildingLot.avg,
      count: buildingLot.count,
      method: buildingLot.method,
      hasPairedAnalysis: !!buildingLot.pairedAnalysis
    });

    return { rawLand, buildingLot, wetlands, landlocked, conservation };
  }, [vacantSales, includedSales, saleCategories, valuationMode]);

  const saveRates = async () => {
    // Update cascade config mode to match current valuation mode
    setCascadeConfig(prev => ({ ...prev, mode: valuationMode }));

    // This triggers the main saveAnalysis function
    await saveAnalysis();

    // Calculate which VCS areas will be affected by the configurations
    const affectedVCS = new Set();

    // Normal configuration affects all VCS
    if (properties) {
      properties.forEach(p => {
        if (p.new_vcs) affectedVCS.add(p.new_vcs);
      });
    }

    // Special region configurations
    Object.keys(cascadeConfig.special || {}).forEach(region => {
      // Find VCS in this special region
      vacantSales.forEach(sale => {
        if (specialRegions[sale.id] === region && sale.new_vcs) {
          affectedVCS.add(sale.new_vcs);
        }
      });
    });

    // VCS-specific configurations
    Object.values(cascadeConfig.vcsSpecific || {}).forEach(config => {
      config.vcsList?.forEach(vcs => affectedVCS.add(vcs));
    });

    // Additional notification that rates have been saved
    alert(`Land rates have been saved for ${affectedVCS.size} VCS areas and are now available in the Allocation Study and VCS Sheet tabs.\\n\\nMethod: ${valuationMode.toUpperCase()}\\nNormal rates: ${Object.keys(cascadeConfig.normal).filter(k => cascadeConfig.normal[k]?.rate).length} tiers\\nSpecial regions: ${Object.keys(cascadeConfig.special || {}).length}\\nVCS-specific: ${Object.keys(cascadeConfig.vcsSpecific || {}).length}`);
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
            onClick={() => {
              setValuationMode('acre');
              setCascadeConfig(prev => ({ ...prev, mode: 'acre' }));
            }}
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
            onClick={() => {
              setValuationMode('sf');
              setCascadeConfig(prev => ({ ...prev, mode: 'sf' }));
            }}
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
            onClick={() => {
              if (canUseFrontFoot) {
                setValuationMode('ff');
                setCascadeConfig(prev => ({ ...prev, mode: 'ff' }));
              }
            }}
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
                          console.log(`📋 Checkbox change for ${sale.property_block}/${sale.property_lot}:`, {
                            checked: e.target.checked,
                            saleId: sale.id
                          });
                          if (e.target.checked) {
                            setIncludedSales(prev => new Set([...prev, sale.id]));
                          } else {
                            setIncludedSales(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(sale.id);
                              console.log('❌ Removed from included sales, new size:', newSet.size);
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
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>
                  Raw Land {categoryAnalysis.rawLand.method === 'paired' && <span style={{ color: '#10B981' }}>✓ Paired</span>}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10B981' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.rawLand.avg}` : `$${categoryAnalysis.rawLand.avg.toLocaleString()}`}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.rawLand.count} sales</div>
                {categoryAnalysis.rawLand.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.rawLand.avgLotSize}
                  </div>
                )}
                {categoryAnalysis.rawLand.method === 'paired' && categoryAnalysis.rawLand.pairedAnalysis && (
                  <div style={{ fontSize: '9px', color: '#059669', marginTop: '2px' }}>
                    {categoryAnalysis.rawLand.count} properties • {categoryAnalysis.rawLand.pairedAnalysis.pairs} comparisons
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>
                  Building Lot {categoryAnalysis.buildingLot.method === 'paired' && <span style={{ color: '#3B82F6' }}>✓ Paired</span>}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3B82F6' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.buildingLot.avg}` : `$${categoryAnalysis.buildingLot.avg.toLocaleString()}`}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.buildingLot.count} sales</div>
                {categoryAnalysis.buildingLot.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.buildingLot.avgLotSize}
                  </div>
                )}
                {categoryAnalysis.buildingLot.method === 'paired' && categoryAnalysis.buildingLot.pairedAnalysis && (
                  <div style={{ fontSize: '9px', color: '#2563EB', marginTop: '2px' }}>
                    {categoryAnalysis.buildingLot.count} properties • {categoryAnalysis.buildingLot.pairedAnalysis.pairs} comparisons
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>Wetlands</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#06B6D4' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.wetlands.avg}` : `$${categoryAnalysis.wetlands.avg.toLocaleString()}`}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.wetlands.count} sales</div>
                {categoryAnalysis.wetlands.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.wetlands.avgLotSize}
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>Landlocked</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#F59E0B' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.landlocked.avg}` : `$${categoryAnalysis.landlocked.avg.toLocaleString()}`}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.landlocked.count} sales</div>
                {categoryAnalysis.landlocked.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.landlocked.avgLotSize}
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>Conservation</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#8B5CF6' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.conservation.avg}` : `$${categoryAnalysis.conservation.avg.toLocaleString()}`}
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.conservation.count} sales</div>
                {categoryAnalysis.conservation.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.conservation.avgLotSize}
                  </div>
                )}
              </div>
            </div>

            {/* Paired Analysis Details */}
            {(categoryAnalysis.rawLand.method === 'paired' || categoryAnalysis.buildingLot.method === 'paired') && (
              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #E5E7EB' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#374151' }}>
                  Paired Sales Analysis Details
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: categoryAnalysis.rawLand.method === 'paired' && categoryAnalysis.buildingLot.method === 'paired' ? '1fr 1fr' : '1fr', gap: '15px' }}>

                  {categoryAnalysis.rawLand.method === 'paired' && categoryAnalysis.rawLand.pairedAnalysis && (
                    <div style={{ backgroundColor: '#F0FDF4', padding: '12px', borderRadius: '6px', border: '1px solid #BBF7D0' }}>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#059669', marginBottom: '8px' }}>
                        Raw Land - Best Pair Analysis
                      </div>
                      {categoryAnalysis.rawLand.pairedAnalysis.bestPair && (
                        <div style={{ fontSize: '11px', color: '#065F46' }}>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Properties:</strong> {categoryAnalysis.rawLand.pairedAnalysis.bestPair.properties}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Acreage Difference:</strong> {categoryAnalysis.rawLand.pairedAnalysis.bestPair.acreageDiff.toFixed(2)} acres
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Price Difference:</strong> ${categoryAnalysis.rawLand.pairedAnalysis.bestPair.priceDiff.toLocaleString()}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Raw Land Rate:</strong> ${Math.round(categoryAnalysis.rawLand.pairedAnalysis.bestPair.rate).toLocaleString()}/acre
                          </div>
                          <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '6px' }}>
                            Median of {categoryAnalysis.rawLand.pairedAnalysis.pairs} paired comparisons from {categoryAnalysis.rawLand.count} properties
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {categoryAnalysis.buildingLot.method === 'paired' && categoryAnalysis.buildingLot.pairedAnalysis && (
                    <div style={{ backgroundColor: '#EFF6FF', padding: '12px', borderRadius: '6px', border: '1px solid #BFDBFE' }}>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB', marginBottom: '8px' }}>
                        Building Lot - Best Pair Analysis
                      </div>
                      {categoryAnalysis.buildingLot.pairedAnalysis.bestPair && (
                        <div style={{ fontSize: '11px', color: '#1E40AF' }}>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Properties:</strong> {categoryAnalysis.buildingLot.pairedAnalysis.bestPair.properties}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Acreage Difference:</strong> {categoryAnalysis.buildingLot.pairedAnalysis.bestPair.acreageDiff.toFixed(2)} acres
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Price Difference:</strong> ${categoryAnalysis.buildingLot.pairedAnalysis.bestPair.priceDiff.toLocaleString()}
                          </div>
                          <div style={{ marginBottom: '4px' }}>
                            <strong>Raw Land Rate:</strong> ${Math.round(categoryAnalysis.buildingLot.pairedAnalysis.bestPair.rate).toLocaleString()}/acre
                          </div>
                          <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '6px' }}>
                            Median of {categoryAnalysis.buildingLot.pairedAnalysis.pairs} paired comparisons from {categoryAnalysis.buildingLot.count} properties
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>

                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '8px', fontStyle: 'italic' }}>
                  * Paired analysis extracts incremental raw land value between similar sales with different acreages.
                  This isolates the pure land component from site value and improvements.
                  <br />
                  * All properties are included regardless of acreage similarity.
                  Only sales with negative price differences are excluded.
                </div>
              </div>
            )}
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
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            openMethod2SalesModal(vcs);
                          }}
                          style={{
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            color: '#3B82F6'
                          }}
                        >
                          {data.totalSales} sales
                        </span>
                        {` • Avg $${Math.round(data.avgPrice).toLocaleString()} • ${data.avgAcres.toFixed(2)} • $${Math.round(data.avgAdjusted).toLocaleString()}-$${data.impliedRate || 0} • $${data.impliedRate || 0}`}
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
                            <th style={{ padding: '8px', textAlign: 'right', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Avg Sale Price (t)</th>
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
                            const perAcre = adjustedDelta && lotDelta && lotDelta > 0 && adjustedDelta > 0 ? adjustedDelta / lotDelta : null;
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
                                  {perAcre ? `$${Math.round(perAcre).toLocaleString()}` : (adjustedDelta !== null && adjustedDelta <= 0 ? 'N/A' : '-')}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #F1F3F4' }}>
                                  {perSqFt ? `$${perSqFt.toFixed(2)}` : (adjustedDelta !== null && adjustedDelta <= 0 ? 'N/A' : '-')}
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
        {method2Summary && (method2Summary.mediumRange || method2Summary.largeRange || method2Summary.xlargeRange) && (
          <div style={{ borderTop: '2px solid #E5E7EB', backgroundColor: '#F8FAFC' }}>
            <div style={{ padding: '20px' }}>
              <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold', color: '#1F2937' }}>
                Method 2 Summary - Implied $/Acre Rates
              </h4>

              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {/* 1.00-4.99 Range */}
                <div style={{ textAlign: 'center', minWidth: '150px' }}>
                  <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>1.00-4.99 Acres</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#059669' }}>
                    {method2Summary.mediumRange?.perAcre !== 'N/A' ?
                      `$${method2Summary.mediumRange?.perAcre?.toLocaleString()}` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {method2Summary.mediumRange?.perSqFt !== 'N/A' ?
                      `$${method2Summary.mediumRange?.perSqFt}/SF` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    ({method2Summary.mediumRange?.count || 0} VCS)
                  </div>
                </div>

                {/* 5.00-9.99 Range */}
                <div style={{ textAlign: 'center', minWidth: '150px' }}>
                  <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>5.00-9.99 Acres</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0D9488' }}>
                    {method2Summary.largeRange?.perAcre !== 'N/A' ?
                      `$${method2Summary.largeRange?.perAcre?.toLocaleString()}` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {method2Summary.largeRange?.perSqFt !== 'N/A' ?
                      `$${method2Summary.largeRange?.perSqFt}/SF` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    ({method2Summary.largeRange?.count || 0} VCS)
                  </div>
                </div>

                {/* 10.00+ Range */}
                <div style={{ textAlign: 'center', minWidth: '150px' }}>
                  <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>10.00+ Acres</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#7C3AED' }}>
                    {method2Summary.xlargeRange?.perAcre !== 'N/A' ?
                      `$${method2Summary.xlargeRange?.perAcre?.toLocaleString()}` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {method2Summary.xlargeRange?.perSqFt !== 'N/A' ?
                      `$${method2Summary.xlargeRange?.perSqFt}/SF` : 'N/A'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    ({method2Summary.xlargeRange?.count || 0} VCS)
                  </div>
                </div>

                {/* Average Across All Positive Deltas */}
                <div style={{ textAlign: 'center', minWidth: '150px' }}>
                  <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>All Positive Deltas</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#059669' }}>
                    {(() => {
                      const allRates = [];
                      if (method2Summary.mediumRange?.perAcre !== 'N/A') allRates.push(method2Summary.mediumRange.perAcre);
                      if (method2Summary.largeRange?.perAcre !== 'N/A') allRates.push(method2Summary.largeRange.perAcre);
                      if (method2Summary.xlargeRange?.perAcre !== 'N/A') allRates.push(method2Summary.xlargeRange.perAcre);

                      if (allRates.length === 0) return 'N/A';

                      const avgRate = Math.round(allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length);
                      return `$${avgRate.toLocaleString()}`;
                    })()}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {(() => {
                      const allRates = [];
                      if (method2Summary.mediumRange?.perAcre !== 'N/A') allRates.push(method2Summary.mediumRange.perAcre);
                      if (method2Summary.largeRange?.perAcre !== 'N/A') allRates.push(method2Summary.largeRange.perAcre);
                      if (method2Summary.xlargeRange?.perAcre !== 'N/A') allRates.push(method2Summary.xlargeRange.perAcre);

                      if (allRates.length === 0) return 'N/A';

                      const avgRate = Math.round(allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length);
                      const perSqFt = (avgRate / 43560).toFixed(2);
                      return `$${perSqFt}/SF`;
                    })()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                    ({(method2Summary.mediumRange?.count || 0) + (method2Summary.largeRange?.count || 0) + (method2Summary.xlargeRange?.count || 0)} Total)
                  </div>
                </div>

                <div style={{ width: '1px', height: '80px', backgroundColor: '#D1D5DB' }}></div>

                {/* Stats */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>Total VCS Areas:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1F2937' }}>{method2Summary.totalVCS || 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>Total Sales:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1F2937' }}>
                      {Object.values(bracketAnalysis).reduce((sum, data) => sum + data.totalSales, 0)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: '#6B7280' }}>Positive Deltas:</span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#059669' }}>
                      {(method2Summary.mediumRange?.count || 0) + (method2Summary.largeRange?.count || 0) + (method2Summary.xlargeRange?.count || 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Implied Front Foot Rates - ONLY IN FF MODE */}
        {valuationMode === 'ff' && method2Summary && (method2Summary.mediumRange || method2Summary.largeRange || method2Summary.xlargeRange) && (
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
          <div style={{ display: 'grid', gridTemplateColumns:
            valuationMode === 'ff' ? 'repeat(2, 1fr)' :
            valuationMode === 'sf' ? 'repeat(2, 1fr)' :
            'repeat(4, 1fr)', gap: '15px' }}>
            {valuationMode === 'ff' ? (
              // FRONT FOOT MODE: Standard + Excess
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
                      placeholder="Max Frontage"
                      style={{
                        width: '120px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.standard?.rate || ''}
                      onChange={(e) => updateCascadeBreak('standard', 'rate', e.target.value)}
                      placeholder="Rate per front foot"
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
                    placeholder="Excess rate per front foot"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </>
            ) : valuationMode === 'sf' ? (
              // SQUARE FOOT MODE: Primary + Secondary only
              <>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Primary (0-{cascadeConfig.normal.prime?.max || 5000} sq ft)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.prime?.max || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'max', e.target.value)}
                      placeholder="Max sq ft"
                      style={{
                        width: '100px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.normal.prime?.rate || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'rate', e.target.value)}
                      placeholder="Rate per sq ft"
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
                    Secondary ({cascadeConfig.normal.prime?.max || 5000}+ sq ft)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cascadeConfig.normal.secondary?.rate || ''}
                    onChange={(e) => updateCascadeBreak('secondary', 'rate', e.target.value)}
                    placeholder="Rate per sq ft"
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
              // ACRE MODE: Prime + Secondary + Excess + Residual
              <>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Prime (0-{cascadeConfig.normal.prime?.max || 1} acres)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.normal.prime?.max || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'max', e.target.value)}
                      placeholder="Max acres"
                      style={{
                        width: '80px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.prime?.rate || ''}
                      onChange={(e) => updateCascadeBreak('prime', 'rate', e.target.value)}
                      placeholder="Rate per acre"
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
                    Secondary ({cascadeConfig.normal.prime?.max || 1}-{cascadeConfig.normal.secondary?.max || 5} acres)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.normal.secondary?.max || ''}
                      onChange={(e) => updateCascadeBreak('secondary', 'max', e.target.value)}
                      placeholder="Max acres"
                      style={{
                        width: '80px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.secondary?.rate || ''}
                      onChange={(e) => updateCascadeBreak('secondary', 'rate', e.target.value)}
                      placeholder="Rate per acre"
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
                    Excess ({cascadeConfig.normal.secondary?.max || 5}-{cascadeConfig.normal.excess?.max || 10} acres)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.normal.excess?.max || ''}
                      onChange={(e) => updateCascadeBreak('excess', 'max', e.target.value)}
                      placeholder="Max acres"
                      style={{
                        width: '80px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      value={cascadeConfig.normal.excess?.rate || ''}
                      onChange={(e) => updateCascadeBreak('excess', 'rate', e.target.value)}
                      placeholder="Rate per acre"
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
                    Residual ({cascadeConfig.normal.excess?.max || 10}+ acres)
                  </label>
                  <input
                    type="number"
                    value={cascadeConfig.normal.residual?.rate || ''}
                    onChange={(e) => updateCascadeBreak('residual', 'rate', e.target.value)}
                    placeholder="Rate per acre"
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

        {/* Special Region Cascades */}
        {Object.keys(cascadeConfig.special || {}).map(region => (
          <div key={region} style={{ marginBottom: '15px', backgroundColor: '#EFF6FF', padding: '12px', borderRadius: '6px', border: '1px solid #BFDBFE' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#1E40AF' }}>{region} Properties</h4>
              <button
                onClick={() => {
                  setCascadeConfig(prev => {
                    const newSpecial = { ...prev.special };
                    delete newSpecial[region];
                    return { ...prev, special: newSpecial };
                  });
                }}
                style={{
                  backgroundColor: '#EF4444',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Remove
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns:
              valuationMode === 'ff' ? 'repeat(2, 1fr)' :
              valuationMode === 'sf' ? 'repeat(2, 1fr)' :
              'repeat(4, 1fr)', gap: '15px' }}>

              {valuationMode === 'ff' ? (
                // Front Foot for Special Region
                <>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Standard (0-{cascadeConfig.special[region]?.standard?.max || 100} ft)
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.standard?.max || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'standard', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '80px', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.standard?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'standard', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Excess ({cascadeConfig.special[region]?.standard?.max || 100}+ ft)
                    </label>
                    <input
                      type="number"
                      value={cascadeConfig.special[region]?.excess?.rate || ''}
                      onChange={(e) => updateSpecialRegionCascade(region, 'excess', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                    />
                  </div>
                </>
              ) : valuationMode === 'sf' ? (
                // Square Foot for Special Region
                <>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Primary (0-{cascadeConfig.special[region]?.prime?.max || 5000} sq ft)
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.prime?.max || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'prime', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '80px', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.special[region]?.prime?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'prime', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Secondary ({cascadeConfig.special[region]?.prime?.max || 5000}+ sq ft)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.special[region]?.secondary?.rate || ''}
                      onChange={(e) => updateSpecialRegionCascade(region, 'secondary', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                    />
                  </div>
                </>
              ) : (
                // Acre for Special Region
                <>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Prime (0-{cascadeConfig.special[region]?.prime?.max || 1} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.special[region]?.prime?.max || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'prime', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '60px', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.prime?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'prime', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Secondary ({cascadeConfig.special[region]?.prime?.max || 1}-{cascadeConfig.special[region]?.secondary?.max || 5} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.special[region]?.secondary?.max || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'secondary', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '60px', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.secondary?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'secondary', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Excess ({cascadeConfig.special[region]?.secondary?.max || 5}-{cascadeConfig.special[region]?.excess?.max || 10} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.special[region]?.excess?.max || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'excess', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '60px', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.special[region]?.excess?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'excess', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Residual ({cascadeConfig.special[region]?.excess?.max || 10}+ acres)
                    </label>
                    <input
                      type="number"
                      value={cascadeConfig.special[region]?.residual?.rate || ''}
                      onChange={(e) => updateSpecialRegionCascade(region, 'residual', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {/* Add Special Region Button */}
        {getUniqueRegions().filter(r => r !== 'Normal' && !cascadeConfig.special?.[r]).length > 0 && (
          <div style={{ marginBottom: '15px' }}>
            <button
              onClick={() => {
                const availableRegions = getUniqueRegions().filter(r => r !== 'Normal' && !cascadeConfig.special?.[r]);
                if (availableRegions.length === 1) {
                  // Auto-add if only one region available
                  const region = availableRegions[0];
                  setCascadeConfig(prev => ({
                    ...prev,
                    special: {
                      ...prev.special,
                      [region]: {}
                    }
                  }));
                } else {
                  // Show selection if multiple regions
                  const region = prompt(`Select special region to add:\\n${availableRegions.map((r, i) => `${i + 1}. ${r}`).join('\\n')}`);
                  if (region && availableRegions.includes(region)) {
                    setCascadeConfig(prev => ({
                      ...prev,
                      special: {
                        ...prev.special,
                        [region]: {}
                      }
                    }));
                  }
                }
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
              <Plus size={16} /> Add Special Region Configuration
            </button>
          </div>
        )}

        {/* VCS-Specific Configurations */}
        {Object.keys(cascadeConfig.vcsSpecific || {}).map(vcsKey => (
          <div key={vcsKey} style={{ marginBottom: '15px', backgroundColor: '#F0FDF4', padding: '12px', borderRadius: '6px', border: '1px solid #BBF7D0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#059669' }}>
                VCS {cascadeConfig.vcsSpecific[vcsKey].vcsList?.join(', ')} - {cascadeConfig.vcsSpecific[vcsKey].method?.toUpperCase()} Method
              </h4>
              <button
                onClick={() => {
                  setCascadeConfig(prev => {
                    const newVcsSpecific = { ...prev.vcsSpecific };
                    delete newVcsSpecific[vcsKey];
                    return { ...prev, vcsSpecific: newVcsSpecific };
                  });
                }}
                style={{
                  backgroundColor: '#EF4444',
                  color: 'white',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Remove
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#059669', marginBottom: '8px' }}>
              {cascadeConfig.vcsSpecific[vcsKey].description}
            </div>

            {/* VCS-Specific Cascade Configuration */}
            <div style={{ display: 'grid', gridTemplateColumns:
              cascadeConfig.vcsSpecific[vcsKey].method === 'ff' ? 'repeat(2, 1fr)' :
              cascadeConfig.vcsSpecific[vcsKey].method === 'sf' ? 'repeat(2, 1fr)' :
              'repeat(4, 1fr)', gap: '10px' }}>

              {cascadeConfig.vcsSpecific[vcsKey].method === 'ff' ? (
                // Front Foot for VCS-Specific
                <>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Standard (0-{cascadeConfig.vcsSpecific[vcsKey].rates?.standard?.max || 100} ft)
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.standard?.max || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'standard', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '60px', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.standard?.rate || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'standard', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Excess ({cascadeConfig.vcsSpecific[vcsKey].rates?.standard?.max || 100}+ ft)
                    </label>
                    <input
                      type="number"
                      value={cascadeConfig.vcsSpecific[vcsKey].rates?.excess?.rate || ''}
                      onChange={(e) => updateVCSSpecificCascade(vcsKey, 'excess', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                    />
                  </div>
                </>
              ) : cascadeConfig.vcsSpecific[vcsKey].method === 'sf' ? (
                // Square Foot for VCS-Specific
                <>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Primary (0-{cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || 5000} sq ft)
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'prime', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '60px', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.rate || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'prime', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Secondary ({cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || 5000}+ sq ft)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.vcsSpecific[vcsKey].rates?.secondary?.rate || ''}
                      onChange={(e) => updateVCSSpecificCascade(vcsKey, 'secondary', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                    />
                  </div>
                </>
              ) : (
                // Acre for VCS-Specific
                <>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Prime (0-{cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || 1} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'prime', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '50px', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.rate || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'prime', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Secondary ({cascadeConfig.vcsSpecific[vcsKey].rates?.prime?.max || 1}-{cascadeConfig.vcsSpecific[vcsKey].rates?.secondary?.max || 5} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.secondary?.max || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'secondary', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '50px', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.secondary?.rate || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'secondary', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Excess ({cascadeConfig.vcsSpecific[vcsKey].rates?.secondary?.max || 5}-{cascadeConfig.vcsSpecific[vcsKey].rates?.excess?.max || 10} acres)
                    </label>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.excess?.max || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'excess', 'max', e.target.value)}
                        placeholder="Max"
                        style={{ width: '50px', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                      <input
                        type="number"
                        value={cascadeConfig.vcsSpecific[vcsKey].rates?.excess?.rate || ''}
                        onChange={(e) => updateVCSSpecificCascade(vcsKey, 'excess', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#059669', display: 'block', marginBottom: '2px' }}>
                      Residual ({cascadeConfig.vcsSpecific[vcsKey].rates?.excess?.max || 10}+ acres)
                    </label>
                    <input
                      type="number"
                      value={cascadeConfig.vcsSpecific[vcsKey].rates?.residual?.rate || ''}
                      onChange={(e) => updateVCSSpecificCascade(vcsKey, 'residual', 'rate', e.target.value)}
                      placeholder="Rate"
                      style={{ width: '100%', padding: '4px', border: '1px solid #BBF7D0', borderRadius: '3px', fontSize: '10px' }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {/* Add VCS-Specific Configuration Button */}
        <div style={{ marginBottom: '15px' }}>
          <button
            onClick={() => {
              // This will open a modal to select VCS and method
              const vcsInput = prompt('Enter VCS codes (comma-separated for multiple):');
              if (!vcsInput) return;

              const vcsList = vcsInput.split(',').map(v => v.trim()).filter(v => v);
              const method = prompt('Select method for these VCS:\\n1. acre\\n2. sf\\n3. ff');

              const methodMap = { '1': 'acre', '2': 'sf', '3': 'ff' };
              const selectedMethod = methodMap[method] || 'acre';

              const description = prompt('Enter description (e.g., "Rural areas", "Subdivision lots"):') || 'Custom configuration';

              const vcsKey = `vcs_${Date.now()}`;
              setCascadeConfig(prev => ({
                ...prev,
                vcsSpecific: {
                  ...prev.vcsSpecific,
                  [vcsKey]: {
                    vcsList,
                    method: selectedMethod,
                    description,
                    rates: {}
                  }
                }
              }));
            }}
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
            <Plus size={16} /> Add VCS-Specific Configuration
          </button>
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

      {/* Method 2 Sales Modal */}
      {showMethod2Modal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '95vw',
            maxHeight: '90vh',
            overflow: 'auto',
            border: '1px solid #E5E7EB'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>
                Method 2 Sales - VCS {method2ModalVCS}
              </h3>
              <button
                onClick={() => setShowMethod2Modal(false)}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#6B7280'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#FEF3C7', borderRadius: '4px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#92400E' }}>
                <strong>Exclude problematic sales:</strong> Uncheck sales that should not be used in Method 2 calculations
                (teardowns, poor condition, pre-construction, etc.).
                <span style={{ display: 'block', marginTop: '4px' }}>
                  ⚠️ <strong>Yellow highlighted rows</strong> are pre-construction sales (sold before year built).
                </span>
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '8px', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>Include</th>
                    <th
                      onClick={() => handleModalSort('block')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'block' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Block {modalSortField === 'block' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('lot')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'lot' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Lot {modalSortField === 'lot' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('address')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'address' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Address {modalSortField === 'address' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('saleDate')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'saleDate' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Sale Date {modalSortField === 'saleDate' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('salePrice')}
                      style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'salePrice' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Sale Price {modalSortField === 'salePrice' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('normTime')}
                      style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'normTime' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Norm Time {modalSortField === 'normTime' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('acres')}
                      style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'acres' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Acres {modalSortField === 'acres' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('sfla')}
                      style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'sfla' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      SFLA {modalSortField === 'sfla' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('yearBuilt')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'yearBuilt' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Year Built {modalSortField === 'yearBuilt' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th
                      onClick={() => handleModalSort('typeUse')}
                      style={{
                        padding: '8px',
                        textAlign: 'left',
                        fontWeight: '600',
                        borderBottom: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none',
                        backgroundColor: modalSortField === 'typeUse' ? '#EBF8FF' : 'transparent'
                      }}
                    >
                      Type/Use {modalSortField === 'typeUse' ? (modalSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortModalData(getMethod2SalesForVCS(method2ModalVCS)).map(prop => {
                    const acres = parseFloat(prop.asset_lot_acre || 0);
                    const isExcluded = method2ExcludedSales.has(prop.id);

                    // Check for pre-construction (sale before year built)
                    const saleYear = prop.sales_date ? new Date(prop.sales_date).getFullYear() : null;
                    const yearBuilt = prop.asset_year_built ? parseInt(prop.asset_year_built) : null;
                    const isPreConstruction = saleYear && yearBuilt && saleYear < yearBuilt;

                    // Determine row background color
                    let backgroundColor = 'white';
                    if (isExcluded) {
                      backgroundColor = '#FEF2F2'; // Light red for excluded
                    } else if (isPreConstruction) {
                      backgroundColor = '#FEF3C7'; // Light yellow for pre-construction
                    }

                    return (
                      <tr key={prop.id} style={{ backgroundColor }}>
                        <td style={{ padding: '8px' }}>
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={(e) => {
                              const newExcluded = new Set(method2ExcludedSales);
                              if (e.target.checked) {
                                newExcluded.delete(prop.id);
                              } else {
                                newExcluded.add(prop.id);
                              }
                              setMethod2ExcludedSales(newExcluded);
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px' }}>{prop.property_block}</td>
                        <td style={{ padding: '8px' }}>{prop.property_lot}</td>
                        <td style={{ padding: '8px' }}>{prop.property_location}</td>
                        <td style={{ padding: '8px' }}>
                          {prop.sales_date}
                          {isPreConstruction && <span style={{ color: '#F59E0B', marginLeft: '4px' }}>���️</span>}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>${prop.sales_price?.toLocaleString()}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>${Math.round(prop.normalizedTime)?.toLocaleString()}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{acres.toFixed(2)}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{prop.asset_sfla || '-'}</td>
                        <td style={{ padding: '8px' }}>
                          {prop.asset_year_built || '-'}
                          {isPreConstruction && <span style={{ color: '#F59E0B', marginLeft: '4px' }}>��️</span>}
                        </td>
                        <td style={{ padding: '8px' }}>{prop.asset_type_use || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button
                onClick={() => {
                  setShowMethod2Modal(false);
                  // Force refresh of calculations
                  setTimeout(() => {
                    performBracketAnalysis();
                  }, 100);
                }}
                style={{
                  backgroundColor: '#3B82F6',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
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
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Positive Sales</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10B981' }}>{vacantTestSales.filter(s => s.isPositive).length}</div>
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

      {/* Individual Allocation Analysis Table */}
      <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Individual Allocation Analysis</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6B7280' }}>
            Each vacant sale matched with improved sales from the same year
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB' }}>
                {/* Vacant Sale Info */}
                <th style={{ padding: '8px', borderRight: '2px solid #E5E7EB' }} colSpan="6">Vacant Sale</th>
                {/* Improved Sales Info */}
                <th style={{ padding: '8px', borderRight: '2px solid #E5E7EB' }} colSpan="4">Improved Sales (Same Year)</th>
                {/* Allocation Results */}
                <th style={{ padding: '8px' }} colSpan="3">Allocation Analysis</th>
              </tr>
              <tr style={{ backgroundColor: '#F3F4F6', fontSize: '11px' }}>
                {/* Vacant Sale Columns */}
                <th style={{ padding: '6px' }}>VCS</th>
                <th style={{ padding: '6px' }}>Year</th>
                <th style={{ padding: '6px' }}>Block/Lot</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Price</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Acres</th>
                <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB' }}>Site Value</th>
                {/* Improved Sales Columns */}
                <th style={{ padding: '6px', textAlign: 'center' }}>Count</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Avg Price</th>
                <th style={{ padding: '6px', textAlign: 'right' }}>Avg Acres</th>
                <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB' }}>Total Land Value</th>
                {/* Allocation Columns */}
                <th style={{ padding: '6px', textAlign: 'center' }}>Current %</th>
                <th style={{ padding: '6px', textAlign: 'center' }}>Recommended %</th>
                <th style={{ padding: '6px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {vacantTestSales.map((sale, index) => (
                <tr
                  key={`${sale.id}_${index}`}
                  style={{
                    backgroundColor: sale.isPositive ? (index % 2 === 0 ? 'white' : '#F9FAFB') : '#FEF2F2',
                    opacity: sale.isPositive ? 1 : 0.7
                  }}
                >
                  {/* Vacant Sale Data */}
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{sale.vcs}</td>
                  <td style={{ padding: '8px' }}>{sale.year}</td>
                  <td style={{ padding: '8px' }}>{sale.block}/{sale.lot}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.vacantPrice?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{sale.acres?.toFixed(2)}</td>
                  <td style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    color: sale.siteValue > 0 ? '#10B981' : '#EF4444',
                    borderRight: '2px solid #E5E7EB'
                  }}>
                    ${sale.siteValue?.toLocaleString()}
                  </td>

                  {/* Improved Sales Data */}
                  <td style={{ padding: '8px', textAlign: 'center' }}>{sale.improvedSalesCount}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>${sale.avgImprovedPrice?.toLocaleString()}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{sale.avgImprovedAcres}</td>
                  <td style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    borderRight: '2px solid #E5E7EB'
                  }}>
                    ${sale.totalLandValue?.toLocaleString()}
                  </td>

                  {/* Allocation Results */}
                  <td style={{ padding: '8px', textAlign: 'center', color: '#6B7280' }}>
                    {(sale.currentAllocation * 100).toFixed(1)}%
                  </td>
                  <td style={{
                    padding: '8px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    backgroundColor: sale.isPositive ?
                      (sale.recommendedAllocation >= 0.25 && sale.recommendedAllocation <= 0.40 ? '#D1FAE5' :
                       sale.recommendedAllocation >= 0.20 && sale.recommendedAllocation <= 0.45 ? '#FEF3C7' : '#FEE2E2') :
                      'transparent'
                  }}>
                    {(sale.recommendedAllocation * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: sale.isPositive ? '#D1FAE5' : '#FEE2E2',
                      color: sale.isPositive ? '#065F46' : '#991B1B'
                    }}>
                      {sale.isPositive ? 'Included' : 'Excluded'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary Footer */}
        <div style={{ padding: '15px', borderTop: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          {(() => {
            const positiveSales = vacantTestSales.filter(s => s.isPositive);
            const totalLandValue = positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0);
            const totalSalePrice = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
            const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', fontSize: '14px' }}>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Sales Included</div>
                  <div style={{ fontWeight: 'bold', color: '#10B981' }}>{positiveSales.length} of {vacantTestSales.length}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Land Value</div>
                  <div style={{ fontWeight: 'bold' }}>${totalLandValue.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Sale Price</div>
                  <div style={{ fontWeight: 'bold' }}>${totalSalePrice.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Final Recommended</div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#F59E0B' }}>{overallRecommended.toFixed(1)}%</div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  // ========== DYNAMIC COLUMN HELPERS ==========
  const shouldShowResidualColumn = useMemo(() => {
    return cascadeConfig.normal.residual?.rate && cascadeConfig.normal.residual.rate > 0;
  }, [cascadeConfig]);

  const shouldShowKeyColumn = useMemo(() => {
    return Object.values(vcsSheetData).some(data => data.keyPages && data.keyPages.trim() !== '');
  }, [vcsSheetData]);

  const shouldShowMapColumn = useMemo(() => {
    return Object.values(vcsSheetData).some(data => data.mapPages && data.mapPages.trim() !== '');
  }, [vcsSheetData]);

  // ========== METHOD FORMATTING HELPER ==========
  const getMethodDisplay = useCallback((type, description) => {
    // Check if it's a residential description that includes "condo"
    if (type && type.startsWith('Residential') &&
        description && description.toLowerCase().includes('condo')) {
      return 'SITE';
    }

    // Otherwise use the valuation mode mapping
    switch (valuationMode) {
      case 'acre': return 'AC';
      case 'sf': return 'SF';
      case 'ff': return 'FF';
      default: return valuationMode.toUpperCase();
    }
  }, [valuationMode]);

  // ========== SALES DATE FILTERING FOR CME ==========
  const getOctoberFirstThreeYearsPrior = () => {
    const now = new Date();
    const threeYearsPrior = now.getFullYear() - 3;
    return new Date(threeYearsPrior, 9, 1); // October 1st (month 9 = October)
  };

  // ========== CME BRACKET DEFINITIONS ==========
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: '<100', color: '#FF9999', textColor: 'black' },
    { min: 100000, max: 199999, label: '100-199', color: '#FFB366', textColor: 'black' },
    { min: 200000, max: 299999, label: '200-299', color: '#FFCC99', textColor: 'black' },
    { min: 300000, max: 399999, label: '300-399', color: '#FFFF99', textColor: 'black' },
    { min: 400000, max: 499999, label: '400-499', color: '#CCFF99', textColor: 'black' },
    { min: 500000, max: 749999, label: '500-749', color: '#99FF99', textColor: 'black' },
    { min: 750000, max: 999999, label: '750-999', color: '#99CCFF', textColor: 'black' },
    { min: 1000000, max: 1499999, label: '1000-1499', color: '#9999FF', textColor: 'black' },
    { min: 1500000, max: 1999999, label: '1500-1999', color: '#CC99FF', textColor: 'black' },
    { min: 2000000, max: 99999999, label: '2000+', color: '#FF99FF', textColor: 'black' }
  ];

  const getCMEBracket = (price) => {
    return CME_BRACKETS.find(bracket => price >= bracket.min && price <= bracket.max) || CME_BRACKETS[0];
  };

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
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#1E40AF', color: 'white' }}>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>VCS</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Total</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Type</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Description</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Method</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Typ Lot</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Rec Site</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Act Site</th>
                  {valuationMode === 'ff' ? (
                    <>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Std FF</th>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Exc FF</th>
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Prime</th>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Sec</th>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Exc</th>
                      {shouldShowResidualColumn && (
                        <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Res</th>
                      )}
                    </>
                  )}
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Wet</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>LLocked</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Consv</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Price (t)</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Price</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>CME</th>
                  <th
                    style={{
                      padding: '8px',
                      border: '1px solid #E5E7EB',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    onClick={() => toggleFieldCollapse('zoning')}
                    title="Click to expand/collapse"
                  >
                    Zoning {collapsedFields.zoning ? '▶' : '▼'}
                  </th>
                  {shouldShowKeyColumn && (
                    <th
                      style={{
                        padding: '8px',
                        border: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                      onClick={() => toggleFieldCollapse('key')}
                      title="Click to expand/collapse"
                    >
                      Key {collapsedFields.key ? '▶' : '▼'}
                    </th>
                  )}
                  {shouldShowMapColumn && (
                    <th
                      style={{
                        padding: '8px',
                        border: '1px solid #E5E7EB',
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                      onClick={() => toggleFieldCollapse('map')}
                      title="Click to expand/collapse"
                    >
                      Map {collapsedFields.map ? '▶' : '▼'}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {Object.keys(vcsSheetData).sort().map((vcs, index) => {
                  const data = vcsSheetData[vcs];
                  const type = vcsTypes[vcs] || 'Residential-Typical';
                  const isGrayedOut = !type.startsWith('Residential');
                  const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
                  const recSite = vcsRecommendedSites[vcs] || 0;
                  const actSite = vcsManualSiteValues[vcs] || recSite;

                  // Determine which cascade rates to use (priority: VCS-specific > Special Region > Normal)
                  let cascadeRates = cascadeConfig.normal;
                  let rateSource = 'Normal';

                  // Check for VCS-specific configuration
                  const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
                    config.vcsList?.includes(vcs)
                  );
                  if (vcsSpecificConfig) {
                    cascadeRates = vcsSpecificConfig.rates || cascadeConfig.normal;
                    rateSource = `VCS-Specific (${vcsSpecificConfig.method?.toUpperCase()})`;
                  } else {
                    // Check for special region configuration
                    const vcsInSpecialRegion = vacantSales.find(sale =>
                      sale.new_vcs === vcs && specialRegions[sale.id] && specialRegions[sale.id] !== 'Normal'
                    );
                    if (vcsInSpecialRegion && cascadeConfig.special?.[specialRegions[vcsInSpecialRegion.id]]) {
                      cascadeRates = cascadeConfig.special[specialRegions[vcsInSpecialRegion.id]];
                      rateSource = specialRegions[vcsInSpecialRegion.id];
                    }
                  }
                  
                  // Get typical lot size for all properties in this VCS
                  const vcsProps = properties?.filter(p =>
                    p.new_vcs === vcs &&
                    p.asset_lot_acre && p.asset_lot_acre > 0 // Only properties with valid acreage
                  ) || [];
                  const typicalLot = vcsProps.length > 0 ?
                    (vcsProps.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / vcsProps.length).toFixed(2) : '';

                  // Check for special category properties in this VCS (only for residential)
                  const vcsSpecialCategories = !isGrayedOut ? {
                    wetlands: cascadeConfig.specialCategories.wetlands && (
                      vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'wetlands') ||
                      cascadeConfig.specialCategories.wetlands > 0
                    ),
                    landlocked: cascadeConfig.specialCategories.landlocked && (
                      vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'landlocked') ||
                      cascadeConfig.specialCategories.landlocked > 0
                    ),
                    conservation: cascadeConfig.specialCategories.conservation && (
                      vacantSales.some(s => s.new_vcs === vcs && saleCategories[s.id] === 'conservation') ||
                      cascadeConfig.specialCategories.conservation > 0
                    )
                  } : {
                    wetlands: false,
                    landlocked: false,
                    conservation: false
                  };

                  // Clean up zoning - get unique instances only
                  const vcsZoningValues = properties?.filter(p => p.new_vcs === vcs && p.asset_zoning)
                    .map(p => p.asset_zoning.trim())
                    .filter((value, index, array) => array.indexOf(value) === index && value !== '') || [];
                  const cleanZoning = vcsZoningValues.length <= 3 ?
                    vcsZoningValues.join(', ') :
                    `${vcsZoningValues.slice(0, 2).join(', ')} +${vcsZoningValues.length - 2} more`;

                  // Get CME bracket for average price
                  const cmeBracket = data.avgPrice ? getCMEBracket(data.avgPrice) : null;
                  
                  return (
                    <tr key={vcs} style={{
                      backgroundColor: isGrayedOut ? '#F3F4F6' : (index % 2 === 0 ? 'white' : '#F9FAFB'),
                      opacity: isGrayedOut ? 0.7 : 1,
                      border: '1px solid #E5E7EB'
                    }}>
                      <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>{vcs}</td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{data.counts?.total || 0}</td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
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
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
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
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{getMethodDisplay(type, description)}</td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{typicalLot}</td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${recSite.toLocaleString()}</td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
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
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                            position: 'relative',
                            border: '1px solid #E5E7EB'
                          }}>
                            {!isGrayedOut ? (
                              <span title={`Rate Source: ${rateSource}`}>
                                {cascadeRates.standard?.rate ? `$${cascadeRates.standard.rate.toLocaleString()}` : ''}
                                {rateSource !== 'Normal' && (
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    fontSize: '8px',
                                    color: '#92400E',
                                    fontWeight: 'bold'
                                  }}>*</span>
                                )}
                              </span>
                            ) : ''}
                          </td>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                            position: 'relative',
                            border: '1px solid #E5E7EB'
                          }}>
                            {!isGrayedOut ? (
                              <span title={`Rate Source: ${rateSource}`}>
                                {cascadeRates.excess?.rate ? `$${cascadeRates.excess.rate.toLocaleString()}` : ''}
                                {rateSource !== 'Normal' && (
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    fontSize: '8px',
                                    color: '#92400E',
                                    fontWeight: 'bold'
                                  }}>*</span>
                                )}
                              </span>
                            ) : ''}
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                            position: 'relative',
                            border: '1px solid #E5E7EB'
                          }}>
                            {!isGrayedOut ? (
                              <span title={`Rate Source: ${rateSource}`}>
                                {cascadeRates.prime?.rate ? `$${cascadeRates.prime.rate.toLocaleString()}` : ''}
                                {rateSource !== 'Normal' && (
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    fontSize: '8px',
                                    color: '#92400E',
                                    fontWeight: 'bold'
                                  }}>*</span>
                                )}
                              </span>
                            ) : ''}
                          </td>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                            position: 'relative',
                            border: '1px solid #E5E7EB'
                          }}>
                            {!isGrayedOut ? (
                              <span title={`Rate Source: ${rateSource}`}>
                                {cascadeRates.secondary?.rate ? `$${cascadeRates.secondary.rate.toLocaleString()}` : ''}
                                {rateSource !== 'Normal' && (
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    fontSize: '8px',
                                    color: '#92400E',
                                    fontWeight: 'bold'
                                  }}>*</span>
                                )}
                              </span>
                            ) : ''}
                          </td>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                            position: 'relative',
                            border: '1px solid #E5E7EB'
                          }}>
                            {!isGrayedOut ? (
                              <span title={`Rate Source: ${rateSource}`}>
                                {cascadeRates.excess?.rate ? `$${cascadeRates.excess.rate.toLocaleString()}` : ''}
                                {rateSource !== 'Normal' && (
                                  <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    right: '2px',
                                    fontSize: '8px',
                                    color: '#92400E',
                                    fontWeight: 'bold'
                                  }}>*</span>
                                )}
                              </span>
                            ) : ''}
                          </td>
                          {shouldShowResidualColumn && (
                            <td style={{
                              padding: '8px',
                              textAlign: 'right',
                              backgroundColor: isGrayedOut ? '#F3F4F6' : (rateSource !== 'Normal' ? '#FEF3C7' : 'inherit'),
                              position: 'relative',
                              border: '1px solid #E5E7EB'
                            }}>
                              {!isGrayedOut ? (
                                <span title={`Rate Source: ${rateSource}`}>
                                  {cascadeRates.residual?.rate ? `$${cascadeRates.residual.rate.toLocaleString()}` : ''}
                                  {rateSource !== 'Normal' && (
                                    <span style={{
                                      position: 'absolute',
                                      top: '2px',
                                      right: '2px',
                                      fontSize: '8px',
                                      color: '#92400E',
                                      fontWeight: 'bold'
                                    }}>*</span>
                                  )}
                                </span>
                              ) : ''}
                            </td>
                          )}
                        </>
                      )}
                      {/* Special Category Rates */}
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: vcsSpecialCategories.wetlands ? '#1E40AF' : '#9CA3AF',
                        border: '1px solid #E5E7EB'
                      }}>
                        {vcsSpecialCategories.wetlands && cascadeConfig.specialCategories.wetlands ?
                          `$${cascadeConfig.specialCategories.wetlands.toLocaleString()}` : ''}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: vcsSpecialCategories.landlocked ? '#92400E' : '#9CA3AF',
                        border: '1px solid #E5E7EB'
                      }}>
                        {vcsSpecialCategories.landlocked && cascadeConfig.specialCategories.landlocked ?
                          `$${cascadeConfig.specialCategories.landlocked.toLocaleString()}` : ''}
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        color: vcsSpecialCategories.conservation ? '#059669' : '#9CA3AF',
                        border: '1px solid #E5E7EB'
                      }}>
                        {vcsSpecialCategories.conservation && cascadeConfig.specialCategories.conservation ?
                          `$${cascadeConfig.specialCategories.conservation.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        {data.avgNormTime ? `$${data.avgNormTime.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        {data.avgPrice ? `$${data.avgPrice.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                        {cmeBracket ? (
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: 'bold',
                              backgroundColor: cmeBracket.color,
                              color: cmeBracket.textColor
                            }}
                            title={cmeBracket.label}
                          >
                            {cmeBracket.label}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit', border: '1px solid #E5E7EB' }}>
                        {!isGrayedOut && !collapsedFields.zoning ? cleanZoning : (collapsedFields.zoning ? '...' : '')}
                      </td>
                      {shouldShowKeyColumn && (
                        <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit', border: '1px solid #E5E7EB' }}>
                          {!isGrayedOut && !collapsedFields.key ? data.keyPages || '' : (collapsedFields.key ? '...' : '')}
                        </td>
                      )}
                      {shouldShowMapColumn && (
                        <td style={{ padding: '8px', fontSize: '10px', backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit', border: '1px solid #E5E7EB' }}>
                          {!isGrayedOut && !collapsedFields.map ? data.mapPages || '' : (collapsedFields.map ? '...' : '')}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rate Source Legend */}
        <div style={{ marginTop: '10px', padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '6px', fontSize: '11px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#374151' }}>Cascade Rate Sources:</div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: 'white', border: '1px solid #D1D5DB' }}></div>
              <span>Normal rates (default for all residential VCS)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#FEF3C7', border: '1px solid #D1D5DB' }}></div>
              <span>Special region or VCS-specific rates (*)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: '#F3F4F6', border: '1px solid #D1D5DB' }}></div>
              <span>Non-residential (rates not applicable)</span>
            </div>
          </div>
          <div style={{ marginTop: '6px', color: '#6B7280', fontStyle: 'italic' }}>
            * Hover over highlighted rates to see the specific source (Special Region or VCS-Specific configuration)
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
          <button
            onClick={() => {
              console.log('��� MANUAL DEBUG SAVE TRIGGERED');
              console.log('Current state snapshot:', {
                includedSales: Array.from(includedSales),
                specialCategories: cascadeConfig.specialCategories,
                saleCategories,
                vacantSalesCount: vacantSales.length,
                isInitialLoadComplete
              });
              saveAnalysis();
            }}
            style={{
              backgroundColor: '#8B5CF6',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            🔧 Debug
          </button>
          <button
            onClick={() => {
              console.log('🔧 MANUAL DEBUG SAVE TRIGGERED');
              console.log('Current state snapshot:', {
                includedSales: Array.from(includedSales),
                specialCategories: cascadeConfig.specialCategories,
                saleCategories,
                vacantSalesCount: vacantSales.length
              });
              saveAnalysis();
            }}
            style={{
              backgroundColor: '#8B5CF6',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            🔧 Debug Save
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
