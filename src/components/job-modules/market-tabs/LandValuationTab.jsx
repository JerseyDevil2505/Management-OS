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
  const [landNotes, setLandNotes] = useState({});
  const [specialRegions, setSpecialRegions] = useState({});

  // ========== CASCADE RATES STATE ==========
  const [cascadeConfig, setCascadeConfig] = useState({
    mode: 'acre',
    normal: {
      prime: { max: 1, rate: null },
      secondary: { max: 5, rate: null },
      excess: { max: 10, rate: null },
      residual: { max: null, rate: null },
      standard: { max: 100, rate: null }
    },
    special: {}, // Dynamic special regions
    vcsSpecific: {}, // VCS-specific rates
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
  const [computedAdjustments, setComputedAdjustments] = useState({});
  const [actualAdjustments, setActualAdjustments] = useState({});
  const [typeUseFilter, setTypeUseFilter] = useState({});
  const [customLocationCodes, setCustomLocationCodes] = useState([]);

  // ========== LOAD SAVED ANALYSIS DATA ==========
  useEffect(() => {
    if (!marketLandData) return;

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

    marketLandData.vacant_sales_analysis.sales.forEach(s => {
      if (s.category) savedCategories[s.id] = s.category;
      if (s.notes) savedNotes[s.id] = s.notes;
      if (s.special_region && s.special_region !== 'Normal') savedRegions[s.id] = s.special_region;
      if (!s.included) savedExcluded.add(s.id); // Track excluded instead of included
      if (s.included) savedIncluded.add(s.id);
      if (s.manually_added) manuallyAddedIds.add(s.id);
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

  }

  // Restore Method 2 excluded sales
  if (marketLandData.bracket_analysis?.excluded_sales) {
    setMethod2ExcludedSales(new Set(marketLandData.bracket_analysis.excluded_sales));
  }

  // Load target allocation with proper precedence to avoid stale data conflicts
  let loadedTargetAllocation = null;

  // Priority 1: Dedicated column (most recent saves go here)
  if (marketLandData.target_allocation !== null && marketLandData.target_allocation !== undefined) {
    loadedTargetAllocation = marketLandData.target_allocation;
  }
  // Priority 2: Legacy allocation_study structure (fallback)
  else if (marketLandData.allocation_study?.target_allocation !== null &&
           marketLandData.allocation_study?.target_allocation !== undefined) {
    loadedTargetAllocation = marketLandData.allocation_study.target_allocation;
  }

  // Only set if we found a valid value
  if (loadedTargetAllocation !== null) {
    // Ensure it's a number to prevent caching issues
    const numericValue = typeof loadedTargetAllocation === 'string' ?
      parseFloat(loadedTargetAllocation) : loadedTargetAllocation;
    setTargetAllocation(numericValue);
  } else {
  }


  // Clear any existing allocation data to force fresh calculation
  setVacantTestSales([]);

  // If user is currently on allocation tab, force immediate recalculation
  if (activeSubTab === 'allocation' && cascadeConfig.normal.prime) {
    setTimeout(() => {
      loadAllocationStudyData();
    }, 100);
  }

  if (marketLandData.worksheet_data) {
    setVcsSheetData(marketLandData.worksheet_data.sheet_data || {});
    if (marketLandData.worksheet_data.manual_site_values) {
      setVcsManualSiteValues(marketLandData.worksheet_data.manual_site_values);
    }
    if (marketLandData.worksheet_data.recommended_sites) {
      setVcsRecommendedSites(marketLandData.worksheet_data.recommended_sites);
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
      const totalValue = properties.reduce((sum, p) => sum + (p.values_cama_total || 0), 0);
      const totalLand = properties.reduce((sum, p) => sum + (p.values_cama_land || 0), 0);
      
      if (totalValue > 0) {
        const allocation = (totalLand / totalValue) * 100;
        setCurrentOverallAllocation(allocation);
      }
    }
  }, [properties]);

  // ========== VCS ANALYSIS TRIGGER ==========
  useEffect(() => {
    if (activeSubTab === 'allocation' && cascadeConfig.normal.prime) {
      loadAllocationStudyData();
    }
  }, [activeSubTab, cascadeConfig.normal.prime]);

  // ========== TARGET ALLOCATION TRIGGER ==========
  useEffect(() => {
    if (targetAllocation && cascadeConfig.normal.prime && properties?.length > 0) {
      calculateVCSRecommendedSitesWithTarget();
    } else {
    }
  }, [targetAllocation, cascadeConfig.normal.prime, properties]);

  // ========== AUTO-SAVE SETUP ==========
  useEffect(() => {
    if (!isInitialLoadComplete) {
      return;
    }

    const interval = setInterval(() => {
      // Use window reference to avoid hoisting issues
      if (window.landValuationSave) {
        window.landValuationSave();
      }
    }, 30000); // 30 seconds

    return () => {
      clearInterval(interval);
    };
  }, [isInitialLoadComplete]);

  // ========== STATE CHANGE AUTO-SAVE ==========
  useEffect(() => {
    if (!isInitialLoadComplete) return;

    const timeoutId = setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave();
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [vacantSales, saleCategories, cascadeConfig, includedSales, targetAllocation, vcsManualSiteValues, isInitialLoadComplete]);

  // ========== CLEAR WINDOW VARIABLES ==========
  useEffect(() => {
    if (isInitialLoadComplete && window._method1ExcludedSales) {
      delete window._method1ExcludedSales;
      delete window._method1IncludedSales;
      delete window._method1ManuallyAdded;
    }
  }, [isInitialLoadComplete]);

  // ========== FILTER VACANT SALES ==========
  const filterVacantSales = useCallback(() => {

    if (!properties) return;
    
    // Check if we have restored manually added sales to preserve
    const manuallyAddedIds = window._method1ManuallyAdded || new Set();
    if (manuallyAddedIds.size > 0) {
      const manuallyAddedProps = properties.filter(prop => manuallyAddedIds.has(prop.id));
    }

    // Apply the complex caching strategy from before
    const currentSalesIds = new Set(vacantSales.map(s => s.id));
    const filteredProps = properties.filter(prop => {
      // Keep existing sales AND match new filters
      return currentSalesIds.has(prop.id) || (
        prop.sales_date &&
        new Date(prop.sales_date) >= dateRange.start &&
        new Date(prop.sales_date) <= dateRange.end &&
        prop.sales_price > 0 &&
        prop.values_cama_improvement <= 10000 &&
        prop.asset_lot_sf > 0 &&
        ['6', '7', '8', '9'].includes(prop.asset_type_use?.trim()?.charAt(0))
      );
    });

    // Only add truly new sales to avoid duplication
    const newSales = filteredProps.filter(prop => !currentSalesIds.has(prop.id));
    if (false) { // Disable complex caching logic
      
    }

    // Sort by sales date (newest first)
    const sortedSales = filteredProps.sort((a, b) => new Date(b.sales_date) - new Date(a.sales_date));

    // Enhanced property enrichment with auto-categorization
    const enrichedSales = sortedSales.map(prop => {
      // Auto-categorization logic
      let autoCategory = null;
      
      const improvement = prop.values_cama_improvement || 0;
      const landValue = prop.values_cama_land || 0;
      const totalValue = prop.values_cama_total || 0;
      const salesPrice = prop.sales_price || 0;
      const lotSize = prop.asset_lot_sf || 0;
      
      // Building lot indicators
      const hasSignificantImprovement = improvement > 10000;
      const highLandToTotal = landValue > 0 && totalValue > 0 && (landValue / totalValue) > 0.7;
      const highSalesToLand = landValue > 0 && salesPrice > 0 && (salesPrice / landValue) > 2;
      const largeLot = lotSize > 20000;
      
      if (hasSignificantImprovement && (highLandToTotal || highSalesToLand)) {
        autoCategory = 'building_lot';
      } else if (improvement <= 10000 && landValue > 0 && salesPrice > landValue * 1.5) {
        autoCategory = 'building_lot';
      } else if (largeLot && improvement <= 5000) {
        autoCategory = 'raw_land';
      } else if (improvement > 100000 || (improvement > 50000 && totalValue > salesPrice * 0.8)) {
        autoCategory = 'teardown';
      }

      const enriched = {
        ...prop,
        autoCategory,
        pricePerSF: lotSize > 0 ? salesPrice / lotSize : 0,
        impToSalesRatio: salesPrice > 0 ? improvement / salesPrice : 0,
        landToSalesRatio: salesPrice > 0 ? landValue / salesPrice : 0
      };

      // Auto-apply category if not already set
      if (autoCategory && !saleCategories[prop.id]) {
        setSaleCategories(prev => ({...prev, [prop.id]: autoCategory}));
      }

      return enriched;
    });

    // Apply Method 1 exclusions
    const finalSales = enrichedSales.filter(sale => !method1ExcludedSales.has(sale.id));

    // Smart checkbox management to preserve user intent while handling new data
    setIncludedSales(prev => {
      if (!isInitialLoadComplete) {
        return prev;
      }

      const newSet = new Set(prev);
      
      // Auto-include new building lot and teardown sales
      finalSales.forEach(sale => {
        const category = saleCategories[sale.id];
        if (category === 'building_lot' || category === 'teardown') {
          newSet.add(sale.id);
        }
      });

      return newSet;
    });

    setVacantSales(finalSales);
  }, [properties, dateRange, method1ExcludedSales, saleCategories, isInitialLoadComplete]);

  // ========== TRIGGER VACANT SALES FILTER ==========
  useEffect(() => {
    filterVacantSales();
  }, [filterVacantSales]);

  // ========== VCS ANALYSIS ==========
  const analyzeVCS = useCallback(() => {
    if (!properties || !cascadeConfig.normal.prime) return;

    const analysis = {};
    const summary = {};

    properties.forEach(prop => {
      if (!prop.new_vcs) return;
      
      const vcs = prop.new_vcs;
      if (!analysis[vcs]) {
        analysis[vcs] = [];
        summary[vcs] = { count: 0, totalValue: 0, avgValue: 0 };
      }
      
      analysis[vcs].push(prop);
      summary[vcs].count++;
      summary[vcs].totalValue += prop.values_cama_total || 0;
    });

    Object.keys(summary).forEach(vcs => {
      if (summary[vcs].count > 0) {
        summary[vcs].avgValue = summary[vcs].totalValue / summary[vcs].count;
      }
    });

    setBracketAnalysis(analysis);
    setMethod2Summary(summary);
  }, [properties, cascadeConfig.normal.prime]);

  // ========== TRIGGER VCS ANALYSIS ==========
  useEffect(() => {
    analyzeVCS();
  }, [analyzeVCS]);

  // ========== TOGGLE SALE INCLUSION ==========
  const toggleSaleInclusion = (saleId) => {
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      if (newSet.has(saleId)) {
        newSet.delete(saleId);
      } else {
        newSet.add(saleId);
      }
      return newSet;
    });
  };

  // ========== ADD SALES TO ANALYSIS ==========
  const addSalesToAnalysis = (salesToAdd) => {
    if (!salesToAdd || salesToAdd.length === 0) return;

    // Convert to array if single sale
    const toAdd = Array.isArray(salesToAdd) ? salesToAdd : [salesToAdd];
    
    // Enhanced enrichment for manually added sales
    const enrichedToAdd = toAdd.map(p => {
      // Auto-categorization logic for manually added sales
      let autoCategory = null;
      
      const improvement = p.values_cama_improvement || 0;
      const landValue = p.values_cama_land || 0;
      const salesPrice = p.sales_price || 0;
      const lotSize = p.asset_lot_sf || 0;
      
      if (improvement > 10000 && landValue > 0 && salesPrice > landValue * 1.5) {
        autoCategory = 'building_lot';
      } else if (improvement <= 10000 && lotSize > 10000) {
        autoCategory = 'raw_land';
      } else if (improvement > 100000) {
        autoCategory = 'teardown';
      }

      if (autoCategory) {
        setSaleCategories(prev => ({...prev, [p.id]: autoCategory}));
      }

      return {
        ...p,
        manually_added: true,
        autoCategory,
        pricePerSF: lotSize > 0 ? salesPrice / lotSize : 0,
        impToSalesRatio: salesPrice > 0 ? improvement / salesPrice : 0,
        landToSalesRatio: salesPrice > 0 ? landValue / salesPrice : 0
      };
    });

    setVacantSales(prev => {
      const existing = new Set(prev.map(s => s.id));
      const newSales = enrichedToAdd.filter(s => !existing.has(s.id));
      return [...prev, ...newSales];
    });

    // Auto-include manually added sales
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      toAdd.forEach(sale => newSet.add(sale.id));
      return newSet;
    });

    // Note: Auto-save will trigger within 30 seconds to persist these changes
  };

  // ========== REMOVE SALE FROM ANALYSIS ==========
  const removeSaleFromAnalysis = (saleId) => {
    setVacantSales(prev => prev.filter(s => s.id !== saleId));
    setIncludedSales(prev => {
      const newSet = new Set(prev);
      newSet.delete(saleId);
      return newSet;
    });

    // Track as excluded for Method 1 persistence
    setMethod1ExcludedSales(prev => new Set([...prev, saleId]));

  };

  // ========== ALLOCATION STUDY FUNCTIONS ==========
  const loadAllocationStudyData = useCallback(() => {

    if (!vacantSales || !cascadeConfig.normal.prime || !properties) return;

    // Process each vacant sale individually with enhanced logging
    const processedVacantSales = vacantSales.map(sale => {
      if (!includedSales.has(sale.id)) return { ...sale, excluded: true };

      const saleYear = new Date(sale.sales_date).getFullYear();
      const region = specialRegions[sale.id] || 'Normal';
      
      // Get rates for this sale's region
      const cascadeRates = region === 'Normal' ? 
        cascadeConfig.normal : 
        cascadeConfig.special[region] || cascadeConfig.normal;

      if (region !== 'Normal') {
      }

      const saleAcres = (sale.asset_lot_sf || 0) / 43560;
      const rawLandValue = calculateRawLandValue(saleAcres, cascadeRates);

      // Find improved sales for the same year
      const improvedSalesForYear = properties.filter(p => 
        p.sales_date && 
        new Date(p.sales_date).getFullYear() === saleYear &&
        p.asset_type_use?.trim()?.startsWith('1') && // Type use starts with '1'
        (p.values_cama_improvement || 0) > 10000 &&
        p.sales_price > 0
      );

      if (improvedSalesForYear.length === 0) {
        return;
      }

      // Calculate average improved sale value for that year
      const avgImprovedValue = improvedSalesForYear.reduce((sum, p) => sum + p.sales_price, 0) / improvedSalesForYear.length;

      // Calculate allocation percentage
      const allocationPercent = rawLandValue > 0 ? (rawLandValue / avgImprovedValue) * 100 : 0;

      return {
        ...sale,
        rawLandValue,
        avgImprovedValue,
        allocationPercent,
        saleYear,
        region
      };
    }).filter(Boolean);

    setVacantTestSales(processedVacantSales);

    // Calculate overall recommended allocation
    const validAllocations = processedVacantSales.filter(s => !s.excluded && s.allocationPercent > 0);
    
    if (validAllocations.length > 0) {
      const totalWeightedAllocation = validAllocations.reduce((sum, s) => sum + s.allocationPercent, 0);
      const recommendedAllocation = totalWeightedAllocation / validAllocations.length;
      
      // Filter out negative allocations for a cleaner average
      const positiveSales = validAllocations.filter(s => s.allocationPercent > 0);
      const positiveAvg = positiveSales.length > 0 ? 
        positiveSales.reduce((sum, s) => sum + s.allocationPercent, 0) / positiveSales.length : 0;

      setActualAllocations({
        recommended: Math.round(recommendedAllocation * 100) / 100,
        positive: Math.round(positiveAvg * 100) / 100,
        validCount: validAllocations.length,
        positiveCount: positiveSales.length
      });
    }
  }, [vacantSales, includedSales, cascadeConfig, specialRegions, properties]);

  // ========== RAW LAND VALUE CALCULATION ==========
  const calculateRawLandValue = useCallback((acres, rates = cascadeConfig.normal) => {
    if (!rates.prime?.rate || acres <= 0) return 0;

    const breakdown = [];
    let remaining = acres;
    let totalValue = 0;

    // Prime acres
    if (remaining > 0 && rates.prime?.rate) {
      const primeAcres = Math.min(remaining, rates.prime.max || 1);
      const primeValue = primeAcres * rates.prime.rate;
      totalValue += primeValue;
      breakdown.push(`${primeAcres}ac × $${rates.prime.rate.toLocaleString()}`);
      remaining -= primeAcres;
    }

    // Secondary acres
    if (remaining > 0 && rates.secondary?.rate) {
      const maxSecondary = (rates.secondary.max || 5) - (rates.prime.max || 1);
      const secondaryAcres = Math.min(remaining, maxSecondary);
      const secondaryValue = secondaryAcres * rates.secondary.rate;
      totalValue += secondaryValue;
      breakdown.push(`${secondaryAcres}ac × $${rates.secondary.rate.toLocaleString()}`);
      remaining -= secondaryAcres;
    }

    // Excess acres
    if (remaining > 0 && rates.excess?.rate) {
      const maxExcess = (rates.excess.max || 10) - (rates.secondary.max || 5);
      const excessAcres = Math.min(remaining, maxExcess);
      const excessValue = excessAcres * rates.excess.rate;
      totalValue += excessValue;
      breakdown.push(`${excessAcres}ac × $${rates.excess.rate.toLocaleString()}`);
      remaining -= excessAcres;
    }

    // Residual acres
    if (remaining > 0 && rates.residual?.rate) {
      const residualValue = remaining * rates.residual.rate;
      totalValue += residualValue;
      breakdown.push(`${remaining}ac × $${rates.residual.rate.toLocaleString()}`);
    }

    return totalValue;
  }, [cascadeConfig.normal]);

  // ========== VCS RECOMMENDED SITES CALCULATION ==========
  const calculateVCSRecommendedSitesWithTarget = useCallback(() => {
    if (!targetAllocation || !cascadeConfig.normal.prime || !properties) {
      return;
    }

    // Group properties by VCS and calculate recommended site values
    const vcsGroups = {};
    
    properties.forEach(prop => {
      if (!prop.new_vcs) return;
      
      const vcs = prop.new_vcs;
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = [];
      }
      vcsGroups[vcs].push(prop);
    });

    const recommendedSites = {};
    
    Object.entries(vcsGroups).forEach(([vcs, vcsProps]) => {
      // Filter to relevant sales from past 3 years for this VCS
      const threeYearsAgo = new Date();
      threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
      
      const relevantSales = vcsProps.filter(prop => 
        prop.sales_date && 
        new Date(prop.sales_date) >= threeYearsAgo &&
        prop.sales_price > 0 &&
        prop.asset_type_use?.trim()?.startsWith('1') // Residential
      );

      if (relevantSales.length === 0) {
        return;
      }

      let siteValue = 0;
      
      // Different calculation for condos vs other residential
      if (vcs.includes('COND') || vcs.includes('TOWN')) {
        // For condos: use target allocation directly
        const avgSalePrice = relevantSales.reduce((sum, s) => sum + s.sales_price, 0) / relevantSales.length;
        siteValue = avgSalePrice * (parseFloat(targetAllocation) / 100);
      } else {
        // For other residential: calculate based on average improved value and target allocation
        const avgImprovedValue = relevantSales.reduce((sum, s) => sum + s.sales_price, 0) / relevantSales.length;
        siteValue = avgImprovedValue * (parseFloat(targetAllocation) / 100);
      }

      if (siteValue > 0) {
        recommendedSites[vcs] = Math.round(siteValue);
      }
    });

    setVcsRecommendedSites(recommendedSites);

  }, [targetAllocation, cascadeConfig.normal.prime, properties]);

  // ========== UPDATE MANUAL SITE VALUE ==========
  const updateManualSiteValue = (vcs, value) => {
    setVcsManualSiteValues(prev => ({
      ...prev,
      // Fix: Use nullish coalescing - allow 0 values, only null for empty strings
      [vcs]: value === '' ? null : parseInt(value) || 0
    }));
    
    // Immediate save to prevent data loss when navigating away
    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave();
      }
    }, 500); // Short delay to batch multiple rapid changes
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
      
      if (codeString !== 'None') {
        factors[vcs][codeString].withFactor.push(prop);
      }
    });

    // Add properties without factors to 'withoutFactor' arrays
    properties.forEach(prop => {
      if (!prop.new_vcs || !prop.sales_price || prop.sales_price <= 0) return;
      
      const vcs = prop.new_vcs;
      const locationCode = locationCodes[prop.id] || 'None';
      
      if (locationCode === 'None' || !locationCode) {
        // Add to all existing factor groups for this VCS as 'without' examples
        if (factors[vcs]) {
          Object.keys(factors[vcs]).forEach(code => {
            if (code !== 'None') {
              factors[vcs][code].withoutFactor.push(prop);
            }
          });
        }
      }
    });

    // Compute impact percentages
    Object.keys(factors).forEach(vcs => {
      Object.keys(factors[vcs]).forEach(codes => {
        if (codes === 'None') return;
        
        const withFactor = factors[vcs][codes].withFactor;
        const withoutFactor = factors[vcs][codes].withoutFactor;
        
        if (withFactor.length >= 3 && withoutFactor.length >= 3) {
          const withAvg = withFactor.reduce((sum, p) => sum + p.sales_price, 0) / withFactor.length;
          const withoutAvg = withoutFactor.reduce((sum, p) => sum + p.sales_price, 0) / withoutFactor.length;
          
          const impact = withoutAvg > 0 ? ((withAvg - withoutAvg) / withoutAvg) * 100 : 0;
          
          if (!computed[vcs]) computed[vcs] = {};
          computed[vcs][codes] = {
            impact: Math.round(impact * 100) / 100,
            withAvg,
            withoutAvg,
            withCount: withFactor.length,
            withoutCount: withoutFactor.length
          };
        }
      });
    });

    setEcoObsFactors(factors);
    setComputedAdjustments(computed);
  }, [properties, locationCodes]);

  // ========== TRIGGER ECO OBS ANALYSIS ==========
  useEffect(() => {
    if (activeSubTab === 'eco-obs' && properties) {
      analyzeEconomicObsolescence();
    }
  }, [activeSubTab, properties, analyzeEconomicObsolescence]);

  // ========== CALCULATE ECO OBS IMPACT ==========
  const calculateEcoObsImpact = useCallback((vcs, codes, typeUse = null) => {
    if (!ecoObsFactors[vcs] || !ecoObsFactors[vcs][codes]) return null;
    
    let withFactor = ecoObsFactors[vcs][codes].withFactor;
    let withoutFactor = ecoObsFactors[vcs][codes].withoutFactor;
    
    // Filter by type use if specified
    if (typeUse && typeUse !== 'all') {
      withFactor = withFactor.filter(p => p.asset_type_use?.trim()?.startsWith(typeUse));
      withoutFactor = withoutFactor.filter(p => p.asset_type_use?.trim()?.startsWith(typeUse));
    }
    
    if (withFactor.length < 3 || withoutFactor.length < 3) return null;
    
    // Calculate averages and normalized values
    const withAvg = withFactor.reduce((sum, p) => sum + p.sales_price, 0) / withFactor.length;
    const withoutAvg = withoutFactor.reduce((sum, p) => sum + p.sales_price, 0) / withoutFactor.length;
    
    const withNormSize = withFactor.reduce((sum, p) => sum + (p.values_norm_size || p.sales_price), 0) / withFactor.length;
    const withoutNormSize = withoutFactor.reduce((sum, p) => sum + (p.values_norm_size || p.sales_price), 0) / withoutFactor.length;
    
    const withNormTime = withFactor.reduce((sum, p) => sum + (p.values_norm_time || p.sales_price), 0) / withFactor.length;
    const withoutNormTime = withoutFactor.reduce((sum, p) => sum + (p.values_norm_time || p.sales_price), 0) / withoutFactor.length;
    
    const withYearBuilt = withFactor.reduce((sum, p) => sum + (p.asset_year_built || 1990), 0) / withFactor.length;
    const withoutYearBuilt = withoutFactor.reduce((sum, p) => sum + (p.asset_year_built || 1990), 0) / withoutFactor.length;
    
    const impact = withoutAvg > 0 ? ((withAvg - withoutAvg) / withoutAvg) * 100 : 0;
    
    return {
      withCount: withFactor.length,
      withoutCount: withoutFactor.length,
      withAvg,
      withoutAvg,
      withNormSize,
      withoutNormSize,
      withNormTime,
      withoutNormTime,
      withYearBuilt: Math.round(withYearBuilt),
      withoutYearBuilt: Math.round(withoutYearBuilt),
      impact: (Math.round(impact * 100) / 100).toFixed(1)
    };
  }, [ecoObsFactors, trafficLevels]);

  // ========== SAVE TARGET ALLOCATION ==========
  const saveTargetAllocation = async () => {
    if (!jobData?.id) {
      alert('Error: No job ID found. Cannot save target allocation.');
      return;
    }

    if (!targetAllocation || targetAllocation === '') {
      alert('Please enter a target allocation percentage before saving.');
      return;
    }

    const targetValue = parseFloat(targetAllocation);
    if (isNaN(targetValue) || targetValue <= 0 || targetValue > 100) {
      alert('Please enter a valid target allocation percentage between 1 and 100.');
      return;
    }

    try {
      // Check if record exists first
      const { data: existing, error: checkError } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .maybeSingle();

      let result;
      if (existing) {
        result = await supabase
          .from('market_land_valuation')
          .update({ target_allocation: targetValue })
          .eq('job_id', jobData.id);
      } else {
        result = await supabase
          .from('market_land_valuation')
          .insert({
            job_id: jobData.id,
            target_allocation: targetValue,
            updated_at: new Date().toISOString()
          });
      }

      if (result.error) throw result.error;

      alert(`Target allocation of ${targetValue}% saved successfully!`);

      // Trigger cache invalidation
      if (onAnalysisUpdate) {
        onAnalysisUpdate();
      }

      // Trigger VCS recommended sites calculation
      if (cascadeConfig.normal.prime && properties?.length > 0) {
        calculateVCSRecommendedSitesWithTarget();
      } else {
      }

    } catch (error) {
      alert('Error saving target allocation: ' + error.message);
    }
  };

  // ========== MAIN SAVE FUNCTION ==========
  const saveAnalysis = useCallback(async () => {
    if (!jobData?.id) {
      return;
    }

    try {
      setIsSaving(true);

      // Prepare comprehensive analysis data structure
      const analysisData = {
        job_id: jobData.id,
        raw_land_config: {
          date_range: dateRange,
          cascade_config: cascadeConfig
        },
        cascade_rates: cascadeConfig,
        vacant_sales_analysis: {
          sales: vacantSales.map(sale => ({
            ...sale,
            category: saleCategories[sale.id] || null,
            notes: landNotes[sale.id] || null,
            special_region: specialRegions[sale.id] || 'Normal',
            included: includedSales.has(sale.id),
            manually_added: sale.manually_added || false
          })),
          excluded_sales: Array.from(method1ExcludedSales)
        },
        allocation_study: {
          sales: vacantTestSales,
          actual_allocations: actualAllocations,
          target_allocation: targetAllocation
        },
        target_allocation: targetAllocation, // Dedicated column for latest saves
        bracket_analysis: {
          analysis: bracketAnalysis,
          summary: method2Summary,
          excluded_sales: Array.from(method2ExcludedSales)
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

      // Check if record exists - don't use .single() to avoid errors
      const { data: existing, error: checkError } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .maybeSingle();

      // If there was an error checking, log it but try to proceed with upsert
      if (checkError && checkError.code !== 'PGRST116') {
      }

      if (existing) {
        const { error } = await supabase
          .from('market_land_valuation')
          .update(analysisData)
          .eq('job_id', jobData.id);
        if (error) throw error;
      } else {
        // Use upsert to handle race conditions
        const { error } = await supabase
          .from('market_land_valuation')
          .upsert(analysisData, { 
            onConflict: 'job_id',
            ignoreDuplicates: false 
          });
        if (error) throw error;
      }

      setLastSaved(new Date());
      
      // Trigger cache invalidation
      if (onAnalysisUpdate) {
        onAnalysisUpdate();
      }

    } catch (error) {
      alert('Error saving analysis: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  }, [
    jobData, dateRange, cascadeConfig, vacantSales, saleCategories, landNotes,
    specialRegions, includedSales, method1ExcludedSales, vacantTestSales,
    actualAllocations, targetAllocation, bracketAnalysis, method2Summary,
    method2ExcludedSales, vcsPropertyCounts, vcsZoningData, vcsManualSiteValues,
    vcsRecommendedSites, vcsDescriptions, vcsTypes, vcsSheetData, ecoObsFactors,
    locationCodes, trafficLevels, computedAdjustments, actualAdjustments,
    customLocationCodes, onAnalysisUpdate
  ]);

  // ========== MAKE SAVE GLOBALLY ACCESSIBLE ==========
  useEffect(() => {
    window.landValuationSave = saveAnalysis;
    return () => {
      delete window.landValuationSave;
    };
  }, [saveAnalysis]);

  // ========== CATEGORY ANALYSIS ==========
  const performCategoryAnalysis = useCallback(() => {
    if (!vacantSales || vacantSales.length === 0) return {};

    const checkedSales = vacantSales.filter(sale => includedSales.has(sale.id));

    const analysis = {};

    // Define category types for analysis
    const categoryTypes = ['raw_land', 'building_lot', 'teardown'];

    categoryTypes.forEach(categoryType => {
      const filtered = checkedSales.filter(s => saleCategories[s.id] === categoryType);
      
      if (filtered.length === 0) {
        analysis[categoryType] = { count: 0, avg: 0, median: 0, pricePerSF: 0 };
        return;
      }

      const prices = filtered.map(s => s.sales_price).sort((a, b) => a - b);
      const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const median = prices.length % 2 === 0 
        ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
        : prices[Math.floor(prices.length / 2)];

      // Price per SF calculation
      const pricesPerSF = filtered
        .filter(s => s.asset_lot_sf > 0)
        .map(s => s.sales_price / s.asset_lot_sf);
      const avgPricePerSF = pricesPerSF.length > 0 
        ? pricesPerSF.reduce((sum, p) => sum + p, 0) / pricesPerSF.length 
        : 0;

      analysis[categoryType] = {
        count: filtered.length,
        avg: Math.round(avg),
        median: Math.round(median),
        pricePerSF: Math.round(avgPricePerSF * 100) / 100,
        properties: filtered
      };
    });

    // Raw land calculation - enhanced logic
    const rawLandSales = checkedSales.filter(s => {
      const category = saleCategories[s.id];
      const improvement = s.values_cama_improvement || 0;
      
      // Explicit raw land category OR low improvement value
      return category === 'raw_land' || (improvement <= 10000 && !['building_lot', 'teardown'].includes(category));
    });

    if (rawLandSales.length > 0) {
      analysis.raw_land.rawLandCount = rawLandSales.length;
      const rawPrices = rawLandSales.map(s => s.sales_price);
      analysis.raw_land.rawAvg = Math.round(rawPrices.reduce((sum, p) => sum + p, 0) / rawPrices.length);
    }

    // Building lot analysis with enhanced methodology
    const buildingLotSales = checkedSales.filter(s => {
      const category = saleCategories[s.id];
      return category === 'building_lot';
    });

    if (buildingLotSales.length > 0) {
      // Keep the 47/2 debug for reference
      if (s.property_block === '47' && s.property_lot === '2') {
      }
    }

    return analysis;
  }, [vacantSales, includedSales, saleCategories]);

  // ========== UPDATE SPECIAL CATEGORY RATE ==========
  const updateSpecialCategory = (category, rate) => {
    setCascadeConfig(prev => {
      const newConfig = {
        ...prev,
        specialCategories: {
          ...prev.specialCategories,
          [category]: parseFloat(rate) || null
        }
      };
      return newConfig;
    });
  };

  // ========== UPDATE SALE CATEGORY ==========
  const updateSaleCategory = (saleId, category) => {
    setSaleCategories(prev => ({
      ...prev,
      [saleId]: category || null
    }));
  };

  // ========== UPDATE LAND NOTES ==========
  const updateLandNotes = (saleId, notes) => {
    setLandNotes(prev => ({
      ...prev,
      [saleId]: notes || null
    }));
  };

  // ========== UPDATE SPECIAL REGION ==========
  const updateSpecialRegion = (saleId, region) => {
    setSpecialRegions(prev => ({
      ...prev,
      [saleId]: region === 'Normal' ? null : region
    }));
  };

  // ========== ECONOMIC OBSOLESCENCE UTILITY FUNCTIONS ==========
  const updateTrafficLevel = (key, level) => {
    setTrafficLevels(prev => ({
      ...prev,
      [key]: level
    }));
  };

  const updateTypeUseFilter = (vcs, codes, typeUse) => {
    const key = `${vcs}_${codes}`;
    setTypeUseFilter(prev => ({
      ...prev,
      [key]: typeUse
    }));
  };

  const updateActualAdjustment = (vcs, codes, value) => {
    const key = `${vcs}_${codes}`;
    setActualAdjustments(prev => ({
      ...prev,
      [key]: parseFloat(value) || null
    }));
  };

  // ========== EXPORT FUNCTIONS ==========
  const exportToExcel = (tabType) => {
    const wb = XLSX.utils.book_new();
    
    if (tabType === 'land-rates' || tabType === 'all') {
      exportLandRatesAnalysis(wb);
    }
    
    if (tabType === 'allocation' || tabType === 'all') {
      exportAllocationStudy(wb);
    }
    
    if (tabType === 'vcs-sheet' || tabType === 'all') {
      exportVCSSheet(wb);
    }
    
    if (tabType === 'eco-obs' || tabType === 'all') {
      exportEconomicObsolescence(wb);
    }

    const fileName = `land_valuation_${tabType}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const exportLandRatesAnalysis = (wb) => {
    // Implementation for land rates export
    const analysis = performCategoryAnalysis();
    const data = [];
    
    Object.entries(analysis).forEach(([category, stats]) => {
      data.push({
        Category: category.replace('_', ' ').toUpperCase(),
        Count: stats.count,
        'Average Price': stats.avg,
        'Median Price': stats.median,
        'Price per SF': stats.pricePerSF
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Land Analysis');
  };

  const exportAllocationStudy = (wb) => {
    if (!vacantTestSales || vacantTestSales.length === 0) return;

    const data = vacantTestSales.map(sale => ({
      'Block/Lot': `${sale.property_block}/${sale.property_lot}`,
      'Sale Date': sale.sales_date,
      'Sale Price': sale.sales_price,
      'Lot SF': sale.asset_lot_sf,
      'Acres': ((sale.asset_lot_sf || 0) / 43560).toFixed(3),
      'Raw Land Value': sale.rawLandValue,
      'Avg Improved Value': sale.avgImprovedValue,
      'Allocation %': sale.allocationPercent?.toFixed(2),
      'Region': sale.region || 'Normal'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Allocation Study');
  };

  const exportVCSSheet = (wb) => {
    const data = [];
    
    // Group properties by VCS for summary
    const vcsGroups = {};
    if (properties) {
      properties.forEach(prop => {
        if (!prop.new_vcs) return;
        if (!vcsGroups[prop.new_vcs]) {
          vcsGroups[prop.new_vcs] = [];
        }
        vcsGroups[prop.new_vcs].push(prop);
      });
    }

    Object.entries(vcsGroups).forEach(([vcs, props]) => {
      const recSite = vcsRecommendedSites[vcs] || 0;
      const actSite = vcsManualSiteValues[vcs] ?? recSite;
      
      data.push({
        VCS: vcs,
        'Property Count': props.length,
        'Recommended Site': recSite,
        'Actual Site': actSite,
        'Description': vcsDescriptions[vcs] || '',
        'Type': vcsTypes[vcs] || ''
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'VCS Sheet');
  };

  const exportEconomicObsolescence = () => {
    let csv = 'ECONOMIC OBSOLESCENCE ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Analysis Date: ${new Date().toLocaleDateString()}\n\n`;
    csv += 'VCS,Location Factor,Type Use,With Count,Without Count,With Avg,Without Avg,Impact %,Applied Adjustment\n';
    
    Object.keys(ecoObsFactors).sort().forEach(vcs => {
      Object.keys(ecoObsFactors[vcs]).forEach(codes => {
        if (codes === 'None') return;
        
        // Get all type uses for this combination
        const typeUses = new Set();
        ecoObsFactors[vcs][codes].withFactor.forEach(p => {
          if (p.typeUse) typeUses.add(p.typeUse);
        });
        
        if (typeUses.size === 0) typeUses.add('all');
        
        typeUses.forEach(typeUse => {
          const impact = calculateEcoObsImpact(vcs, codes, typeUse);
          if (!impact) return;
          
          const key = `${vcs}_${codes}`;
          csv += `${vcs},${codes},${typeUse},${impact.withCount},${impact.withoutCount},`;
          csv += `${Math.round(impact.withAvg)},${Math.round(impact.withoutAvg)},${impact.impact}%,`;
          csv += `${actualAdjustments[key] || '-'}\n`;
        });
      });
    });

    return csv;
  };

  const exportAll = () => {
    let csv = 'COMPREHENSIVE LAND VALUATION ANALYSIS\n';
    csv += `Municipality: ${jobData?.municipality || ''}\n`;
    csv += `Export Date: ${new Date().toLocaleDateString()}\n\n`;
    
    // Add land rates analysis
    csv += exportLandRatesAnalysis();
    csv += '\n' + '='.repeat(80) + '\n\n';
    
    // Add allocation study
    csv += exportAllocationStudy();
    csv += '\n' + '='.repeat(80) + '\n\n';
    
    // Add VCS sheet
    csv += exportVCSSheet();
    csv += '\n' + '='.repeat(80) + '\n\n';
    csv += exportEconomicObsolescence();
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprehensive_land_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // ========== RENDER HELPER FUNCTIONS ==========
  const renderLandRatesTab = () => {
    const analysis = performCategoryAnalysis();
    
    return (
      <div style={{ padding: '20px' }}>
        {/* Category Analysis Summary */}
        <div style={{ marginBottom: '30px' }}>
          <h4 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: 'bold' }}>Category Analysis Summary</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
            {Object.entries(analysis).map(([category, stats]) => (
              <div key={category} style={{
                padding: '15px',
                backgroundColor: 'white',
                borderRadius: '8px',
                border: '1px solid #E5E7EB',
                textAlign: 'center'
              }}>
                <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', textTransform: 'uppercase', color: '#374151' }}>
                  {category.replace('_', ' ')}
                </h5>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1F2937', marginBottom: '5px' }}>
                  {stats.count}
                </div>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>
                  Avg: ${stats.avg?.toLocaleString() || 0}
                </div>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>
                  ${stats.pricePerSF}/SF
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Sales Table */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#F3F4F6' }}>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB', minWidth: '30px' }}>✓</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Block/Lot</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Date</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Price</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>SF</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>$/SF</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Imp</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Category</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Region</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Notes</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {vacantSales.map((sale, index) => {
                  const isIncluded = includedSales.has(sale.id);
                  const category = saleCategories[sale.id];
                  const pricePerSF = sale.asset_lot_sf > 0 ? (sale.sales_price / sale.asset_lot_sf) : 0;
                  
                  return (
                    <tr key={sale.id} style={{ 
                      backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB',
                      opacity: isIncluded ? 1 : 0.5
                    }}>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                        <input
                          type="checkbox"
                          checked={isIncluded}
                          onChange={(e) => {
                            if (!isInitialLoadComplete) {
                              return prev;
                            }

                            const newSet = new Set(prev);
                            if (e.target.checked) {
                              newSet.add(sale.id);
                            } else {
                              newSet.delete(sale.id);
                            }
                            return newSet;
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        {sale.property_block}/{sale.property_lot}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        {new Date(sale.sales_date).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        ${sale.sales_price?.toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        {sale.asset_lot_sf?.toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        ${pricePerSF.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        ${(sale.values_cama_improvement || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <select
                          value={category || ''}
                          onChange={(e) => updateSaleCategory(sale.id, e.target.value)}
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '100px'
                          }}
                        >
                          <option value="">-</option>
                          <option value="raw_land">Raw Land</option>
                          <option value="building_lot">Building Lot</option>
                          <option value="teardown">Teardown</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <select
                          value={specialRegions[sale.id] || 'Normal'}
                          onChange={(e) => updateSpecialRegion(sale.id, e.target.value)}
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '100px'
                          }}
                        >
                          {SPECIAL_REGIONS.map(region => (
                            <option key={region} value={region}>{region}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <input
                          type="text"
                          value={landNotes[sale.id] || ''}
                          onChange={(e) => updateLandNotes(sale.id, e.target.value)}
                          placeholder="Notes..."
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '120px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                        <button
                          onClick={() => removeSaleFromAnalysis(sale.id)}
                          style={{
                            backgroundColor: '#EF4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            fontSize: '10px'
                          }}
                          title="Remove from analysis"
                        >
                          <Trash2 size={12} />
                        </button>
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

  const renderAllocationStudyTab = () => (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '14px', fontWeight: 'bold' }}>Target Allocation:</label>
            <input
              type="number"
              value={targetAllocation || ''}
              onChange={(e) => {
                const value = e.target.value;
                // Fix: Parse as number to prevent caching issues
                setTargetAllocation(value === '' ? null : parseFloat(value));
              }}
              placeholder="e.g., 27"
              style={{
                padding: '8px',
                border: '1px solid #D1D5DB',
                borderRadius: '4px',
                width: '80px',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '14px' }}>%</span>
            <button
              onClick={() => {
                saveTargetAllocation();
              }}
              style={{
                backgroundColor: '#10B981',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Save Target
            </button>
          </div>
          
          <div style={{ fontSize: '14px', color: '#6B7280' }}>
            Current Overall: {currentOverallAllocation.toFixed(1)}%
          </div>
          
          {actualAllocations.recommended && (
            <div style={{ fontSize: '14px', color: '#059669', fontWeight: 'bold' }}>
              Study Recommends: {actualAllocations.recommended}%
            </div>
          )}
        </div>
      </div>

      {vacantTestSales.length > 0 ? (
        <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#F3F4F6' }}>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Block/Lot</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Sale Date</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Price</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Acres</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Raw Land Value</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Improved</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Allocation %</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Region</th>
                </tr>
              </thead>
              <tbody>
                {vacantTestSales.map((sale, index) => (
                  <tr key={sale.id} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#F9FAFB' }}>
                    <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                      {sale.property_block}/{sale.property_lot}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                      {new Date(sale.sales_date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                      ${sale.sales_price?.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                      {((sale.asset_lot_sf || 0) / 43560).toFixed(2)}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                      ${sale.rawLandValue?.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                      ${sale.avgImprovedValue?.toLocaleString()}
                    </td>
                    <td style={{ 
                      padding: '8px', 
                      textAlign: 'center', 
                      fontWeight: 'bold',
                      color: sale.allocationPercent > 0 ? '#059669' : '#DC2626',
                      border: '1px solid #E5E7EB'
                    }}>
                      {sale.allocationPercent?.toFixed(1)}%
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                      {sale.region || 'Normal'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>
          {cascadeConfig.normal.prime?.rate ? 
            'No allocation study data available. Ensure vacant sales are included and cascade rates are configured.' :
            'Please configure cascade rates in the Land Rates tab first.'
          }
        </div>
      )}
    </div>
  );

  const renderVCSSheetTab = () => {
    // Prepare VCS data for display
    const vcsData = {};
    
    if (properties) {
      properties.forEach(prop => {
        if (!prop.new_vcs) return;
        
        const vcs = prop.new_vcs;
        if (!vcsData[vcs]) {
          vcsData[vcs] = {
            properties: [],
            totalAssessed: 0,
            avgAssessed: 0,
            keyPages: new Set(),
            mapPages: new Set(),
            zoningCodes: new Set()
          };
        }
        
        vcsData[vcs].properties.push(prop);
        vcsData[vcs].totalAssessed += prop.values_cama_total || 0;
        
        if (prop.asset_key_page) vcsData[vcs].keyPages.add(prop.asset_key_page);
        if (prop.asset_map_page) vcsData[vcs].mapPages.add(prop.asset_map_page);
        if (prop.asset_zoning) vcsData[vcs].zoningCodes.add(prop.asset_zoning);
      });
      
      // Calculate averages
      Object.keys(vcsData).forEach(vcs => {
        const data = vcsData[vcs];
        data.avgAssessed = data.properties.length > 0 ? data.totalAssessed / data.properties.length : 0;
        data.keyPages = Array.from(data.keyPages).sort().join(', ');
        data.mapPages = Array.from(data.mapPages).sort().join(', ');
        data.zoningCodes = Array.from(data.zoningCodes).sort().join(', ');
      });
    }

    // Check if any columns should be shown
    const shouldShowKeyColumn = Object.values(vcsData).some(data => data.keyPages);
    const shouldShowMapColumn = Object.values(vcsData).some(data => data.mapPages);

    return (
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>VCS Valuation Sheet</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
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
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Typical Lot Size</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Rec Site</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Act Site</th>
                  {valuationMode === 'ff' ? (
                    <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Front Foot</th>
                  ) : (
                    <>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        {valuationMode === 'acre' ? 'Per Acre' : 'Per SF'}
                      </th>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        Land {valuationMode === 'acre' ? 'Acres' : 'SF'}
                      </th>
                    </>
                  )}
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Land Value</th>
                  <th 
                    style={{ 
                      padding: '8px', 
                      border: '1px solid #E5E7EB',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                    onClick={() => setCollapsedFields(prev => ({ ...prev, zoning: !prev.zoning }))}
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
                      onClick={() => setCollapsedFields(prev => ({ ...prev, key: !prev.key }))}
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
                      onClick={() => setCollapsedFields(prev => ({ ...prev, map: !prev.map }))}
                    >
                      Map {collapsedFields.map ? '▶' : '▼'}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {Object.entries(vcsData).sort(([a], [b]) => a.localeCompare(b)).map(([vcs, data]) => {
                  const recSite = vcsRecommendedSites[vcs] || 0;
                  // Fix: Use nullish coalescing to allow 0 values in Act Site
                  const actSite = vcsManualSiteValues[vcs] ?? recSite;
                  const isResidential = type.startsWith('Residential');
                  
                  // Calculate per-unit values
                  const ratePerUnit = valuationMode === 'acre' ? 
                    (actSite * 43560) : actSite; // Convert to per-SF if in acre mode
                  
                  // Determine if row should be grayed out
                  const type = vcsTypes[vcs] || '';
                  const isGrayedOut = !isResidential;
                  
                  // Clean zoning display - remove extra spaces
                  const cleanZoning = data.zoningCodes.replace(/\s+/g, ' ').trim();
                  
                  return (
                    <tr key={vcs} style={{ 
                      backgroundColor: data.properties.length % 2 === 0 ? 'white' : '#F9FAFB',
                      opacity: isGrayedOut ? 0.5 : 1
                    }}>
                      <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>{vcs}</td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        {data.properties.length}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <input
                          type="text"
                          value={type}
                          onChange={(e) => setVcsTypes(prev => ({ ...prev, [vcs]: e.target.value }))}
                          placeholder="e.g., Residential"
                          style={{
                            width: '100px',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '3px',
                            fontSize: '11px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <input
                          type="text"
                          value={vcsDescriptions[vcs] || ''}
                          onChange={(e) => setVcsDescriptions(prev => ({ ...prev, [vcs]: e.target.value }))}
                          placeholder="Description..."
                          style={{
                            width: '150px',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '3px',
                            fontSize: '11px'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: '10px', border: '1px solid #E5E7EB' }}>
                        CME
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', fontSize: '10px', border: '1px solid #E5E7EB' }}>
                        Various
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        {recSite ? `$${recSite.toLocaleString()}` : '-'}
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <input
                          type="number"
                          value={actSite}
                          onChange={(e) => updateManualSiteValue(vcs, e.target.value)}
                          style={{
                            width: '80px',
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '3px',
                            fontSize: '11px',
                            textAlign: 'right'
                          }}
                          placeholder="0"
                        />
                      </td>
                      {valuationMode === 'ff' ? (
                        <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                          ${actSite.toLocaleString()}
                        </td>
                      ) : (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                            ${(valuationMode === 'acre' ? actSite : (actSite / 43560)).toLocaleString()}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                            {valuationMode === 'acre' ? 
                              (data.properties.reduce((sum, p) => sum + ((p.asset_lot_sf || 0) / 43560), 0)).toFixed(1) :
                              data.properties.reduce((sum, p) => sum + (p.asset_lot_sf || 0), 0).toLocaleString()
                            }
                          </td>
                        </>
                      )}
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>
                        {data.avgPrice ? `$${data.avgPrice.toLocaleString()}` : ''}
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
    <div style={{ padding: '20px', backgroundColor: '#F9FAFB', minHeight: '100vh' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: '24px', fontWeight: 'bold', color: '#1F2937' }}>
          Land Valuation Analysis
        </h2>
        <div style={{ fontSize: '14px', color: '#6B7280' }}>
          {properties?.length || 0} properties available
        </div>
      </div>

      {/* Enhanced Sub-Navigation with Tabs */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ 
          display: 'flex', 
          backgroundColor: 'white', 
          borderRadius: '8px', 
          padding: '4px',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
          gap: '2px'
        }}>
          {[
            { id: 'land-rates', label: 'Land Rates', icon: <TrendingUp size={16} /> },
            { id: 'allocation', label: 'Allocation Study', icon: <Calculator size={16} /> },
            { id: 'vcs-sheet', label: 'VCS Sheet', icon: <Home size={16} /> },
            { id: 'eco-obs', label: 'Economic Obsolescence', icon: <MapPin size={16} /> }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'all 0.2s',
                backgroundColor: activeSubTab === tab.id ? '#3B82F6' : 'transparent',
                color: activeSubTab === tab.id ? 'white' : '#6B7280'
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          backgroundColor: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={exportAll}
              style={{
                backgroundColor: '#059669',
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
          </div>
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
