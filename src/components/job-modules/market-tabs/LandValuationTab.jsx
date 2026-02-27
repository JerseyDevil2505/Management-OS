// LandValuationTab.jsx - SECTION 1: Imports and State Setup
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X, Plus, Search, TrendingUp,
  Calculator, Download, Trash2,
  Save, FileDown, MapPin,
  Home
} from 'lucide-react';
import { supabase, interpretCodes, checklistService, getDepthFactor, getDepthFactors } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';
import './LandValuationTab.css';
import './sharedTabNav.css';

// Debug shim: replace console.log/debug calls with this noop in production
const debug = () => {};

// ======= DATE HELPERS =======
const safeDateObj = (d) => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? null : date;
};

const safeISODate = (d) => {
  const date = safeDateObj(d);
  return date ? date.toISOString().split('T')[0] : '';
};

const safeLocaleDate = (d) => {
  const date = safeDateObj(d);
  return date ? date.toLocaleDateString() : 'N/A';
};

const LandValuationTab = ({
  properties,
  jobData,
  vendorType,
  marketLandData,
  onAnalysisUpdate,
  onDataRefresh,
  sessionState,
  updateSessionState
}) => {
  // ========== MAIN TAB STATE ==========
  const [activeSubTab, setActiveSubTab] = useState('land-rates');

  // Helper to update session state
  const updateSession = useCallback((updates) => {
    if (updateSessionState) {
      updateSessionState(prev => ({
        ...prev,
        ...updates,
        hasUnsavedChanges: true,
        lastModified: Date.now()
      }));
    }
  }, [updateSessionState]);


  // Listen for external navigation events to set LandValuation inner subtab
  useEffect(() => {
    const handler = (e) => {
      try {
        const tabId = e?.detail?.tabId;
        if (!tabId) return;
        const valid = ['land-rates', 'allocation', 'vcs-sheet', 'eco-obs'];
        if (valid.includes(tabId)) setActiveSubTab(tabId);
      } catch (err) {
        console.error('navigate_landvaluation_subtab handler error', err);
      }
    };
    window.addEventListener('navigate_landvaluation_subtab', handler);
    return () => window.removeEventListener('navigate_landvaluation_subtab', handler);
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  // ========== MARK COMPLETE (Management Checklist) STATE ==========
  const [isLandRatesComplete, setIsLandRatesComplete] = useState(false);
  const [isVcsSheetComplete, setIsVcsSheetComplete] = useState(false);
  const [isEcoObsComplete, setIsEcoObsComplete] = useState(false);

  // Debounce timer ref for auto-saving VCS descriptions and similar UI edits
  const saveTimerRef = useRef(null);

  // Load initial checklist item statuses for this job
  useEffect(() => {
    if (!jobData?.id) return;
    const ids = ['land-value-tables', 'vcs-reviewed', 'economic-obsolescence'];
    (async () => {
      try {
        const { data } = await supabase
          .from('checklist_item_status')
          .select('item_id, status')
          .eq('job_id', jobData.id)
          .in('item_id', ids);

        if (data) {
          setIsLandRatesComplete(data.find(d => d.item_id === 'land-value-tables')?.status === 'completed');
          setIsVcsSheetComplete(data.find(d => d.item_id === 'vcs-reviewed')?.status === 'completed');
          setIsEcoObsComplete(data.find(d => d.item_id === 'economic-obsolescence')?.status === 'completed');
        }
      } catch (e) {
        // Ignore load errors silently
      }
    })();
  }, [jobData?.id]);

  // Toggle helper to upsert checklist_item_status
  const toggleChecklist = async (itemId, currentState, setter) => {
    if (!jobData?.id) return;
    const newStatus = currentState ? 'pending' : 'completed';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
      const data = await checklistService.updateItemStatus(jobData.id, itemId, newStatus, completedBy);

      const persistedStatus = data?.status || newStatus;
      const isNowCompleted = persistedStatus === 'completed';
      setter(isNowCompleted);

      try {
        window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId, status: persistedStatus } }));
      } catch (e) {
        // ignore dispatch errors
      }

      try {
        if (typeof onDataRefresh === 'function') onDataRefresh();
      } catch (e) {
        // ignore
      }

    } catch (error) {
      // If there's a conflict error, try to fallback to an update path
      try {
        if (error && (error.code === '409' || error.message?.includes('duplicate') || error.message?.includes('conflict'))) {
          // Attempt a direct update via service
          try {
            const { data: { user } } = await supabase.auth.getUser();
      const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
            const updated = await checklistService.updateItemStatus(jobData.id, itemId, newStatus, completedBy);
            const persistedStatus = updated?.status || newStatus;
            setter(persistedStatus === 'completed');
            try { window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId, status: persistedStatus } })); } catch(e){}
            try { if (typeof onDataRefresh === 'function') onDataRefresh(); } catch(e){}
            return;
          } catch (e) {
            // fall through to generic error
          }
        }
      } catch (e) {
        // ignore
      }

      // Log and show a concise error message
      try {
        console.error('Checklist update failed:', error);
      } catch (e) {}
      const msg = error && (error.message || (typeof error === 'string' ? error : JSON.stringify(error))) || 'Unknown error';
      alert(`Failed to update checklist: ${msg}`);
    }
  };
  
  // ========== MODE SELECTION (NEW) ==========
  const [valuationMode, setValuationMode] = useState('acre'); // acre, sf, ff
  const [canUseFrontFoot, setCanUseFrontFoot] = useState(false);

  // Recalculate price per unit when valuation mode changes
  useEffect(() => {
    if (vacantSales.length === 0 || !isInitialLoadComplete) return;

    console.log(`�� Recalculating prices for mode: ${valuationMode}`);

    setVacantSales(prev => prev.map(sale => {
      const acres = sale.totalAcres || 0;
      let sizeForUnit, pricePerUnit;

      if (valuationMode === 'ff') {
        sizeForUnit = parseFloat(sale.asset_lot_frontage) || 0;
      } else if (valuationMode === 'sf') {
        sizeForUnit = acres * 43560;
      } else {
        sizeForUnit = acres;
      }

      const price = sale.values_norm_time || sale.sales_price || 0;
      pricePerUnit = sizeForUnit > 0 ? price / sizeForUnit : 0;

      return {
        ...sale,
        pricePerAcre: Math.round(pricePerUnit) // NOTE: misleading name - contains price per current unit
      };
    }));
  }, [valuationMode, isInitialLoadComplete]);

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

  // Default Economic Obsolescence Codes (editable via UI)
  const DEFAULT_ECO_OBS_CODES = [
    { code: 'BS', description: 'Busy Street', isPositive: false },
    { code: 'CM', description: 'Commercial', isPositive: false },
    { code: 'PL', description: 'Power Lines', isPositive: false },
    { code: 'RR', description: 'Railroad', isPositive: false },
    { code: 'ES', description: 'Easement', isPositive: false },
    { code: 'FZ', description: 'Flood Zone', isPositive: false },
    { code: 'GC', description: 'Golf Course', isPositive: true },
    { code: 'WV', description: 'Water View', isPositive: true },
    { code: 'WF', description: 'Water Front', isPositive: true }
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
  const [newSpecialRegionName, setNewSpecialRegionName] = useState('');
  const [landNotes, setLandNotes] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCopiedNotification, setShowCopiedNotification] = useState(false);
  // Notification for saved land rates
  const [showSaveRatesNotification, setShowSaveRatesNotification] = useState(false);
  const [saveRatesMessage, setSaveRatesMessage] = useState('');
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
      standard: { max: 100, rate: null } // For front foot AND square foot methods
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

  // Bracket editor UI state (allows per-job overrides of bracket boundaries)
  const [showBracketEditor, setShowBracketEditor] = useState(false);
  const [bracketInputs, setBracketInputs] = useState(() => ({
    primeMax: cascadeConfig.normal?.prime?.max ?? 1,
    secondaryMax: cascadeConfig.normal?.secondary?.max ?? 5,
    excessMax: cascadeConfig.normal?.excess?.max ?? 10,
    residualMax: cascadeConfig.normal?.residual?.max ?? null
  }));

  useEffect(() => {
    // Keep bracket inputs in sync when cascadeConfig loads from saved data
    setBracketInputs({
      primeMax: cascadeConfig.normal?.prime?.max ?? 1,
      secondaryMax: cascadeConfig.normal?.secondary?.max ?? 5,
      excessMax: cascadeConfig.normal?.excess?.max ?? 10,
      residualMax: cascadeConfig.normal?.residual?.max ?? null
    });
  }, [cascadeConfig]);

  const validateAndApplyBrackets = (opts = { recalc: true }) => {
    // Parse numeric values
    const p = parseFloat(bracketInputs.primeMax);
    const s = parseFloat(bracketInputs.secondaryMax);
    const e = parseFloat(bracketInputs.excessMax);
    const r = bracketInputs.residualMax === null || bracketInputs.residualMax === '' ? null : parseFloat(bracketInputs.residualMax);

    if (isNaN(p) || isNaN(s) || isNaN(e) || (r !== null && isNaN(r))) {
      return alert('Please enter valid numeric bracket maximums. Use decimals for fractions (e.g. 0.25).');
    }
    if (!(p > 0 && s > p && e > s && (r === null || r > e))) {
      return alert('Brackets must increase: prime < secondary < excess < residual (residual may be empty).');
    }

    setCascadeConfig(prev => ({
      ...prev,
      normal: {
        ...prev.normal,
        prime: { ...prev.normal.prime, max: p },
        secondary: { ...prev.normal.secondary, max: s },
        excess: { ...prev.normal.excess, max: e },
        residual: { ...prev.normal.residual, max: r }
      }
    }));

    // Optionally re-run the bracket analysis immediately
    if (opts.recalc) {
      try {
        performBracketAnalysis();
      } catch (e) {
        // ignore errors from recalculation
      }
    }
  };

  const applyDefaultQuartileBrackets = () => {
    // Example quartile defaults for built-up towns (in acres)
    const defaults = { primeMax: 0.25, secondaryMax: 0.5, excessMax: 0.75, residualMax: 1 };
    setBracketInputs(defaults);
    setCascadeConfig(prev => ({
      ...prev,
      normal: {
        ...prev.normal,
        prime: { ...prev.normal.prime, max: defaults.primeMax },
        secondary: { ...prev.normal.secondary, max: defaults.secondaryMax },
        excess: { ...prev.normal.excess, max: defaults.excessMax },
        residual: { ...prev.normal.residual, max: defaults.residualMax }
      }
    }));
    // Recompute
    try { performBracketAnalysis(); } catch (e) {}
  };
  
  // VCS Analysis
  const [bracketAnalysis, setBracketAnalysis] = useState({});
  const [method2Summary, setMethod2Summary] = useState({});

  // Enhanced Method 2 UI State - Use Single Family as default
  const [method2TypeFilter, setMethod2TypeFilter] = useState('1');
  const [expandedVCS, setExpandedVCS] = useState(new Set());
  const [excludedMethod2VCS, setExcludedMethod2VCS] = useState(new Set()); // VCSs excluded from Method 2 summary

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

  // ========== ECONOMIC OBSOLESCENCE GLOBAL FILTER ==========
  const [globalEcoObsTypeFilter, setGlobalEcoObsTypeFilter] = useState('1'); // Default to Single Family

  // ========== ALLOCATION STUDY STATE ==========
  const [vacantTestSales, setVacantTestSales] = useState([]);
  const [actualAllocations, setActualAllocations] = useState({});
  const [vcsSiteValues, setVcsSiteValues] = useState({});
  const [targetAllocation, setTargetAllocation] = useState(null);
  const [targetAllocationJustSaved, setTargetAllocationJustSaved] = useState(false);
  const [currentOverallAllocation, setCurrentOverallAllocation] = useState(0);

  // ========== VCS SHEET STATE - ENHANCED ==========
  const [vcsSheetData, setVcsSheetData] = useState({});
  const [vcsTypes, setVcsTypes] = useState({});
  const [vcsManualSiteValues, setVcsManualSiteValues] = useState({});
  const [vcsPropertyCounts, setVcsPropertyCounts] = useState({});
  const [vcsZoningData, setVcsZoningData] = useState({});
  const [vcsDescriptions, setVcsDescriptions] = useState({});
  const [vcsRecommendedSites, setVcsRecommendedSites] = useState({});
  const [vcsMethodOverrides, setVcsMethodOverrides] = useState({}); // Per-VCS method overrides (ac, sf, ff, site)
  const [vcsRateOverrides, setVcsRateOverrides] = useState({}); // Per-VCS cascade rate overrides
  const [vcsStepdownOverrides, setVcsStepdownOverrides] = useState({}); // Per-VCS stepdown/max overrides

  // ========== DEPTH TABLES STATE ==========
  const [depthTables, setDepthTables] = useState({});
  const [vcsDepthTableOverrides, setVcsDepthTableOverrides] = useState({}); // VCS-specific depth table overrides

  // ========== ECONOMIC OBSOLESCENCE STATE - ENHANCED ==========
  const [ecoObsFactors, setEcoObsFactors] = useState({});
  const [locationCodes, setLocationCodes] = useState({});
  const [mappedLocationCodes, setMappedLocationCodes] = useState({}); // key: `${vcs}_${location}`, value: code or compound codes
  const [trafficLevels, setTrafficLevels] = useState({});
  const [typeUseFilter, setTypeUseFilter] = useState({});
  const [computedAdjustments, setComputedAdjustments] = useState({});
  const [actualAdjustments, setActualAdjustments] = useState({});
  const [customLocationCodes, setCustomLocationCodes] = useState([]);
  const [summaryInputs, setSummaryInputs] = useState({});
  const [includeCompounded, setIncludeCompounded] = useState(false);
  // Sorting for the worksheet table (vcs, location, code)
  const [sortField, setSortField] = useState('vcs'); // 'vcs' | 'location' | 'code'
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Local inputs for adding new custom eco obs codes
  const [newEcoCode, setNewEcoCode] = useState('');
  const [newEcoDesc, setNewEcoDesc] = useState('');
  const [newEcoIsPositive, setNewEcoIsPositive] = useState(false);

  const handleAddCustomCode = useCallback(() => {
    const code = (newEcoCode || '').toString().trim().toUpperCase();
    if (!code) return alert('Enter a code');
    if (customLocationCodes.some(c => c.code === code) || DEFAULT_ECO_OBS_CODES.some(c => c.code === code)) {
      return alert('Code already exists');
    }
    const added = { code, description: newEcoDesc || code, isPositive: !!newEcoIsPositive };
    setCustomLocationCodes(prev => [...prev, added]);
    setNewEcoCode(''); setNewEcoDesc(''); setNewEcoIsPositive(false);
  }, [newEcoCode, newEcoDesc, newEcoIsPositive, customLocationCodes]);

  const handleRemoveCustomCode = useCallback((code) => {
    setCustomLocationCodes(prev => prev.filter(c => c.code !== code));
  }, []);

  // Apply Default Mapping rules - helper (top-level hooks)
  const keywordMap = useMemo(() => ({
    CM: ['comm'],
    PL: ['power lines', 'power line', 'power'],
    RR: ['railroad', 'rail'],
    ES: ['easement'],
    GC: ['golf'],
    FZ: ['flood'],
    BS: [' rd', ' rd.', ' ave', ' ave.', ' st', ' st.', ' pl', ' pl.', ' wy', ' wy.', ' terr', ' hwy', ' route', 'road', 'avenue', 'street', 'place', 'way', 'terrace', 'highway', 'route'],
  }), []);

  const waterWords = useMemo(() => ['creek','bay','pond','ocean','lake','river','stream'], []);

  const mapTokenToCode = useCallback((token) => {
    const t = token.toLowerCase();
    // explicit matches
    if (t.includes('comm')) return 'CM';
    if (t.includes('power lines') || t.includes('power line') || t.includes('power')) return 'PL';
    if (t.includes('railroad') || t.includes('rail')) return 'RR';
    if (t.includes('easement')) return 'ES';
    if (t.includes('golf')) return 'GC';
    if (t.includes('flood')) return 'FZ';
    // road tokens
    for (const kw of keywordMap.BS) {
      if (t.includes(kw)) return 'BS';
    }
    // water view/front
    const hasWater = waterWords.some(w => t.includes(w));
    if (t.includes('front') && hasWater) return 'WF';
    if (t.includes('view') && hasWater) return 'WV';
    // fallback: if contains water word with no front/view, prefer WV
    if (hasWater) return 'WV';
    return null;
  }, [keywordMap, waterWords]);

  const applyDefaultMapping = useCallback(() => {
    const newMap = { ...mappedLocationCodes };
    Object.keys(ecoObsFactors || {}).forEach(vcs => {
      Object.keys(ecoObsFactors[vcs] || {}).forEach(locationAnalysis => {
        const key = `${vcs}_${locationAnalysis}`;
        // skip if already mapped
        if (newMap[key] && newMap[key].trim() !== '') return;
        // split compound tokens
        const parts = locationAnalysis.split(/\/|\|| and | & |,|\//i).map(p => p.trim()).filter(Boolean);
        const codes = parts.map(p => mapTokenToCode(p)).filter(Boolean);
        if (codes.length > 0) {
          newMap[key] = codes.join('/');
        } else {
          // leave undefined to highlight
        }
      });
    });
    setMappedLocationCodes(newMap);

    // debug log once
    if (Object.keys(newMap).length > 0) {
      debug('����� Applied default eco-obs mapping for empty codes:', Object.entries(newMap).slice(0,20));
    }
  }, [ecoObsFactors, mappedLocationCodes, mapTokenToCode]);
// ========== INITIALIZE FROM PROPS ==========
const hasInitialized = useRef(false);
const currentSessionState = useRef(sessionState);

// Keep ref in sync with sessionState without causing re-renders
useEffect(() => {
  currentSessionState.current = sessionState;
}, [sessionState]);

useEffect(() => {
  if (!marketLandData || hasInitialized.current) {
    if (!marketLandData) setIsLoading(false);
    return;
  }

  hasInitialized.current = true;
  const currentSession = currentSessionState.current;

  // 🔴 CRITICAL DEBUG - LandValuationTab Initialization
  console.log('🔴 CRITICAL DEBUG - LandValuationTab Initialization:', {
    timestamp: new Date().toISOString(),
    jobId: jobData?.id,

    // What's coming from parent prop
    marketLandDataFromProp: {
      hasData: !!marketLandData,
      updated_at: marketLandData?.updated_at,

      // Check each critical field
      vacant_sales: {
        exists: !!marketLandData?.vacant_sales_analysis,
        salesCount: marketLandData?.vacant_sales_analysis?.sales?.length,
        manuallyAddedCount: marketLandData?.vacant_sales_analysis?.sales?.filter(s => s.manually_added)?.length,
        firstSale: marketLandData?.vacant_sales_analysis?.sales?.[0]
      },

      cascade_rates: {
        exists: !!marketLandData?.cascade_rates,
        data: marketLandData?.cascade_rates
      },

      target_allocation: {
        exists: marketLandData?.target_allocation !== undefined,
        value: marketLandData?.target_allocation
      },

      worksheet_data: {
        exists: !!marketLandData?.worksheet_data,
        hasDescriptions: !!marketLandData?.worksheet_data?.descriptions,
        descriptions: marketLandData?.worksheet_data?.descriptions
      }
    }
  });

  // Check for unsaved session changes
  let restoredFromSession = false;
  if (currentSession?.hasUnsavedChanges && currentSession?.lastModified) {
    debug('⚠️ Found unsaved session changes from', currentSession.lastModified);

    setMethod1ExcludedSales(currentSession.method1ExcludedSales || new Set());
    setIncludedSales(currentSession.includedSales || new Set());
    setExcludedMethod2VCS(currentSession.excludedMethod2VCS || new Set());
    setSaleCategories(currentSession.saleCategories || {});
    setSpecialRegions(currentSession.specialRegions || {});
    setLandNotes(currentSession.landNotes || {});

    if (currentSession.cascadeConfig) {
      setCascadeConfig(currentSession.cascadeConfig);
    }

    if (currentSession.vcsSheetData) {
      setVcsSheetData(currentSession.vcsSheetData);
    }

    if (currentSession.vcsManualSiteValues) {
      setVcsManualSiteValues(currentSession.vcsManualSiteValues);
    }

    if (currentSession.vcsDescriptions) {
      setVcsDescriptions(currentSession.vcsDescriptions);
    }

    if (currentSession.vcsTypes) {
      setVcsTypes(currentSession.vcsTypes);
    }
    if (currentSession.vcsMethodOverrides) {
      setVcsMethodOverrides(currentSession.vcsMethodOverrides);
    }
    if (currentSession.vcsRateOverrides) {
      setVcsRateOverrides(currentSession.vcsRateOverrides);
    }
    if (currentSession.vcsStepdownOverrides) {
      setVcsStepdownOverrides(currentSession.vcsStepdownOverrides);
    }

    if (currentSession.vcsRecommendedSites) {
      setVcsRecommendedSites(currentSession.vcsRecommendedSites);
    }

    if (currentSession.collapsedFields) {
      setCollapsedFields(currentSession.collapsedFields);
    }

    restoredFromSession = true;
    debug('✅ Session state restored, will merge with database data');
  }

  // ALWAYS load from database
  console.log('🟡 ABOUT TO LOAD FROM DATABASE');
  debug('��� Loading from database:', {
    hasRawLandConfig: !!marketLandData.raw_land_config,
    hasCascadeRates: !!marketLandData.cascade_rates,
    hasVacantSales: !!marketLandData.vacant_sales_analysis?.sales?.length,
    restoredFromSession
  });

  // Restore all saved states from marketLandData
  if (marketLandData.raw_land_config) {
    if (marketLandData.raw_land_config.date_range) {
      // Validate dates before applying to state to avoid Invalid Date errors
      const startCandidate = safeDateObj(marketLandData.raw_land_config.date_range.start);
      const endCandidate = safeDateObj(marketLandData.raw_land_config.date_range.end);

      setDateRange(prev => ({
        start: startCandidate || prev.start,
        end: endCandidate || prev.end
      }));
    }
  }

  // Load cascade config from either location (prefer cascade_rates, fallback to raw_land_config)
  const savedConfig = marketLandData.cascade_rates || marketLandData.raw_land_config?.cascade_config;
  if (savedConfig && !restoredFromSession) {
    debug('���� Loading cascade config:', {
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

    console.log('🟢 LOADED CASCADE RATES:', savedConfig);
  } else if (restoredFromSession) {
    debug('⏭️ Skipping cascade config DB load - already restored from session');
  }

  // Skip the duplicate cascade_rates assignment - it's redundant
  // if (marketLandData.cascade_rates) {
  //   setCascadeConfig(marketLandData.cascade_rates);
  // }

  // Restore Method 1 state persistence but SKIP cached sales data to force fresh calculation
  if (marketLandData.vacant_sales_analysis?.sales && (!restoredFromSession || includedSales.size === 0)) {
    const savedCategories = {};
    const savedNotes = {};
    const savedRegions = {};
    const savedExcluded = new Set();
    const savedIncluded = new Set();
    const manuallyAddedIds = new Set();

    debug('���� Loading saved Method 1 metadata (SKIPPING cached sales for fresh calculation):', {
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

    debug('🔄 Restored Method 1 metadata (sales data will be recalculated):', {
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

    // FORCE FRESH CALCULATION: Clear any cached sales data and force recalculation with new values_norm_time logic
    debug('🧹 Clearing cached sales data to force fresh calculation with values_norm_time');
    setVacantSales([]); // Clear cached sales to force recalculation

    console.log('🟢 LOADED VACANT SALES:', {
      count: marketLandData.vacant_sales_analysis.sales.length,
      manuallyAdded: manuallyAddedIds.size,
      includedCount: savedIncluded.size,
      excludedCount: savedExcluded.size
    });
  }

  // Also restore Method 1 excluded sales from new field (like Method 2)
  if (marketLandData.vacant_sales_analysis?.excluded_sales) {
    const method1Excluded = new Set(marketLandData.vacant_sales_analysis.excluded_sales);
    setMethod1ExcludedSales(method1Excluded);
    window._method1ExcludedSales = method1Excluded;

    debug('🔄 Restored Method 1 excluded sales from new field:', {
      count: method1Excluded.size,
      ids: Array.from(method1Excluded)
    });
  }

  // Restore Method 2 excluded sales
  if (marketLandData.bracket_analysis?.excluded_sales) {
    setMethod2ExcludedSales(new Set(marketLandData.bracket_analysis.excluded_sales));
  }

  // Restore Method 2 excluded VCSs
  if (marketLandData.bracket_analysis?.excluded_vcs) {
    setExcludedMethod2VCS(new Set(marketLandData.bracket_analysis.excluded_vcs));
  }

  // Load target allocation with proper precedence to avoid stale data conflicts
  let loadedTargetAllocation = null;

  // Priority 1: Dedicated column (most recent saves go here)
  if (marketLandData.target_allocation !== null && marketLandData.target_allocation !== undefined) {
    loadedTargetAllocation = marketLandData.target_allocation;
    debug('�� LOADING TARGET ALLOCATION FROM DEDICATED COLUMN:', loadedTargetAllocation);
  }
  // Priority 2: Legacy allocation_study structure (fallback)
  else if (marketLandData.allocation_study?.target_allocation !== null &&
           marketLandData.allocation_study?.target_allocation !== undefined) {
    loadedTargetAllocation = marketLandData.allocation_study.target_allocation;
    debug('�� LOADING TARGET ALLOCATION FROM ALLOCATION STUDY:', loadedTargetAllocation);
  }

  // Only set if we found a valid value AND current state is null/empty to prevent overwrites
  if (loadedTargetAllocation !== null) {
    console.log('������ LOADED TARGET ALLOCATION:', loadedTargetAllocation);
    // Ensure it's a number to prevent caching issues
    const numericValue = typeof loadedTargetAllocation === 'string' ?
      parseFloat(loadedTargetAllocation) : loadedTargetAllocation;

    // DEFENSIVE FIX: Only update if current targetAllocation is null/empty to prevent overwrites
    setTargetAllocation(prev => {
      if (targetAllocationJustSaved) {
        debug('🛡️ Target allocation just saved - skipping reload to prevent overwrite');
        return prev;
      }
      if (prev === null || prev === undefined || prev === '') {
        debug('✅ Target allocation set to:', numericValue, typeof numericValue);
        return numericValue;
      } else {
        debug('🛡��� Preserving existing target allocation:', prev, 'instead of overwriting with:', numericValue);
        return prev;
      }
    });
  } else {
    debug('ℹ️ No target allocation found in database');
  }


  // Clear any existing allocation data to force fresh calculation
  debug('🧹 Clearing cached allocation data to force fresh calculation');
  setVacantTestSales([]);

  // If user is currently on allocation tab, force immediate recalculation
  if (activeSubTab === 'allocation' && cascadeConfig.normal.prime) {
    debug('🔄 User on allocation tab - forcing immediate recalculation');
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

    if (marketLandData.worksheet_data.depth_table_overrides) {
      setVcsDepthTableOverrides(marketLandData.worksheet_data.depth_table_overrides);
    }
    if (marketLandData.worksheet_data.descriptions) {
      setVcsDescriptions(marketLandData.worksheet_data.descriptions);
      debug('✅ Loaded VCS descriptions:', marketLandData.worksheet_data.descriptions);
    }
    if (marketLandData.worksheet_data.types) {
      setVcsTypes(marketLandData.worksheet_data.types);
      debug('✅ Loaded VCS types:', marketLandData.worksheet_data.types);
    }
    if (marketLandData.worksheet_data.method_overrides) {
      setVcsMethodOverrides(marketLandData.worksheet_data.method_overrides);
      debug('✅ Loaded VCS method overrides:', marketLandData.worksheet_data.method_overrides);
    }
    if (marketLandData.worksheet_data.rate_overrides) {
      setVcsRateOverrides(marketLandData.worksheet_data.rate_overrides);
      debug('✅ Loaded VCS rate overrides:', marketLandData.worksheet_data.rate_overrides);
    }
    if (marketLandData.worksheet_data.stepdown_overrides) {
      setVcsStepdownOverrides(marketLandData.worksheet_data.stepdown_overrides);
      debug('✅ Loaded VCS stepdown overrides:', marketLandData.worksheet_data.stepdown_overrides);
    }
  }

  // Load economic obsolescence data from new schema fields
  if (marketLandData.eco_obs_code_config) {
    setEcoObsFactors(marketLandData.eco_obs_code_config.factors || {});
    setLocationCodes(marketLandData.eco_obs_code_config.location_codes || {});
    setMappedLocationCodes(marketLandData.eco_obs_code_config.location_codes || {});
    setTrafficLevels(marketLandData.eco_obs_code_config.traffic_levels || {});
    setCustomLocationCodes(marketLandData.eco_obs_code_config.custom_codes || []);
    setSummaryInputs(marketLandData.eco_obs_code_config.summary_inputs || {});
  }
  if (marketLandData.eco_obs_applied_adjustments) {
    setActualAdjustments(marketLandData.eco_obs_applied_adjustments);
  }
  if (marketLandData.eco_obs_compound_overrides) {
    setComputedAdjustments(marketLandData.eco_obs_compound_overrides);
  }

  setLastSaved(marketLandData.updated_at ? new Date(marketLandData.updated_at) : null);
  setIsLoading(false);
  setIsInitialLoadComplete(true);

  debug('�� Initial load complete');
}, [marketLandData]);

// Reset initialization flag when job changes
useEffect(() => {
  hasInitialized.current = false;
}, [jobData?.id]);

// Update session state whenever relevant state changes (but only after initial load)
const isUpdatingSessionRef = useRef(false);
const hasCompletedInitialLoad = useRef(false);

useEffect(() => {
  if (!isInitialLoadComplete) {
    hasCompletedInitialLoad.current = false;
    return;
  }

  // Mark that we've completed initial load on first run
  if (!hasCompletedInitialLoad.current) {
    hasCompletedInitialLoad.current = true;
    return; // Don't update session state on the very first completion of initial load
  }

  if (!updateSession || isUpdatingSessionRef.current) return;

  isUpdatingSessionRef.current = true;
  updateSession({
    method1ExcludedSales,
    includedSales,
    excludedMethod2VCS,
    saleCategories,
    specialRegions,
    landNotes,
    cascadeConfig,
    vcsSheetData,
    vcsManualSiteValues,
    vcsDescriptions,
    vcsTypes,
    vcsRecommendedSites,
    vcsMethodOverrides,
    vcsRateOverrides,
    vcsStepdownOverrides,
    collapsedFields
  });

  // Use setTimeout to reset the flag after the update is processed
  setTimeout(() => {
    isUpdatingSessionRef.current = false;
  }, 0);
}, [
  method1ExcludedSales,
  includedSales,
  excludedMethod2VCS,
  saleCategories,
  specialRegions,
  landNotes,
  cascadeConfig,
  vcsSheetData,
  vcsManualSiteValues,
  vcsDescriptions,
  vcsTypes,
  vcsRecommendedSites,
  vcsMethodOverrides,
  vcsRateOverrides,
  vcsStepdownOverrides,
  collapsedFields,
  isInitialLoadComplete
  // Note: updateSession intentionally excluded to prevent infinite loops
]);

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

      // Auto-set to FF mode if depth tables exist and mode isn't already set
      if (hasFrontFootData && valuationMode === 'acre' && !cascadeConfig.mode) {
        debug('🏢 Auto-detecting Front Foot mode - depth tables found');
        setValuationMode('ff');
        setCascadeConfig(prev => ({ ...prev, mode: 'ff' }));
      }
    }
  }, [jobData, vendorType, valuationMode, cascadeConfig.mode]);

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
  // Always return whole numbers for unit rates per user request
  if (valuationMode === 'acre') {
    return size > 0 ? Math.round(price / size) : 0;
  } else if (valuationMode === 'sf') {
    // size is provided in acres; convert to SF then calculate price per SF
    const sizeInSF = (parseFloat(size) || 0) * 43560;
    return sizeInSF > 0 ? Math.round(price / sizeInSF) : 0;
  } else if (valuationMode === 'ff') {
    // For front foot, 'size' is expected to be frontage in feet
    const frontage = parseFloat(size) || 0;
    return frontage > 0 ? Math.round(price / frontage) : 0;
  }
  return 0;
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
    // Standardized Type & Use dropdown options for consistency across tabs
    const standard = [
      { code: '1', description: '1 ��� Single Family' },
      { code: '2', description: '2 — Duplex / Semi-Detached' },
      { code: '3', description: '3* �� Row / Townhouse (3E,3I,30,31)' },
      { code: '4', description: '4* — MultiFamily (42,43,44)' },
      { code: '5', description: '5* ����� Conversions (51,52,53)' },
      { code: '6', description: '6 — Condominium' },
      { code: 'all_residential', description: 'All Residential' }
    ];

    // If properties are present, keep the standard list; otherwise fallback to single family only
    if (!properties || properties.length === 0) return [standard[0]];
    return standard;
  }, [properties]);

  // ========== GET EFFECTIVE CASCADE RATES FOR VCS ==========
  // Get effective cascade rates for a VCS (including user overrides)
  const getVCSCascadeRates = useCallback((vcs, baseCascadeRates) => {
    const rates = JSON.parse(JSON.stringify(baseCascadeRates)); // Deep clone

    // Apply VCS-specific rate overrides
    if (vcsRateOverrides[vcs]) {
      const overrides = vcsRateOverrides[vcs];
      if (overrides.standard !== undefined && overrides.standard !== null) {
        if (!rates.standard) rates.standard = {};
        rates.standard.rate = overrides.standard;
      }
      if (overrides.excess !== undefined && overrides.excess !== null) {
        if (!rates.excess) rates.excess = {};
        rates.excess.rate = overrides.excess;
      }
      if (overrides.prime !== undefined && overrides.prime !== null) {
        if (!rates.prime) rates.prime = {};
        rates.prime.rate = overrides.prime;
      }
      if (overrides.secondary !== undefined && overrides.secondary !== null) {
        if (!rates.secondary) rates.secondary = {};
        rates.secondary.rate = overrides.secondary;
      }
      if (overrides.residual !== undefined && overrides.residual !== null) {
        if (!rates.residual) rates.residual = {};
        rates.residual.rate = overrides.residual;
      }
    }

    // Apply VCS-specific stepdown/max override
    if (vcsStepdownOverrides[vcs] !== undefined && vcsStepdownOverrides[vcs] !== null) {
      if (rates.standard) {
        rates.standard.max = vcsStepdownOverrides[vcs];
      }
      if (rates.prime) {
        rates.prime.max = vcsStepdownOverrides[vcs];
      }
    }

    return rates;
  }, [vcsRateOverrides, vcsStepdownOverrides]);

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
    // CRITICAL FIX: Don't auto-detect/filter during initialization!
    // This prevents overwriting manually added sales that were saved to the database
    if (!isInitialLoadComplete) {
      console.log('�������� Skipping auto-detection - waiting for initial load to complete');
      return;
    }

    if (properties && properties.length > 0) {
      console.log('���� Triggering fresh calculations with FIXED DELTA LOGIC (post-initialization)');
      filterVacantSales();
      performBracketAnalysis();
      loadVCSPropertyCounts();
    }
  }, [properties, dateRange, valuationMode, method2TypeFilter, method2ExcludedSales, isInitialLoadComplete]);

  useEffect(() => {
    if (activeSubTab === 'allocation' && cascadeConfig.normal.prime) {
      debug('���������� Triggering allocation study recalculation...');
      loadAllocationStudyData();
    }
  }, [activeSubTab, cascadeConfig, valuationMode, vacantSales, specialRegions]);
  // Note: intentionally exclude loadAllocationStudyData from deps to avoid TDZ issues, it is stable via useCallback.

  // Auto-calculate VCS recommended sites when target allocation changes
  // ========== LOAD DEPTH TABLES ===========
  useEffect(() => {
    const codeDefinitions = jobData?.parsed_code_definitions;
    // Use interpretCodes.getDepthFactors to parse all tables from code file
    const tables = interpretCodes.getDepthFactors(codeDefinitions, vendorType);
    if (tables) {
      setDepthTables(tables);
      debug('📊 Depth tables loaded:', Object.keys(tables));
    } else {
      // Fallback to defaults if no code definitions
      const defaultTables = getDepthFactors(codeDefinitions, vendorType);
      setDepthTables(defaultTables);
      debug('📊 Using default depth tables:', Object.keys(defaultTables));
    }
  }, [jobData?.parsed_code_definitions, vendorType]);

  useEffect(() => {
    debug('��� TARGET ALLOCATION USEEFFECT TRIGGERED:', {
      targetAllocation,
      hasCascadeRates: !!cascadeConfig.normal.prime,
      propertiesCount: properties?.length || 0
    });

    if (targetAllocation && cascadeConfig.normal.prime && properties?.length > 0) {
      debug('�� CONDITIONS MET - CALLING calculateVCSRecommendedSitesWithTarget');
      calculateVCSRecommendedSitesWithTarget();
    } else {
      debug('�� CONDITIONS NOT MET FOR VCS CALCULATION:', {
        hasTargetAllocation: !!targetAllocation,
        hasCascadeRates: !!cascadeConfig.normal.prime,
        hasProperties: properties?.length > 0
      });
    }
  }, [targetAllocation]);
  // Note: intentionally exclude calculateVCSRecommendedSitesWithTarget from deps to avoid TDZ issues, it is stable via useCallback.

  useEffect(() => {
    if (activeSubTab === 'eco-obs' && properties) {
      analyzeEconomicObsolescence();
    }
  }, [activeSubTab, properties]);

  // Track auto-save failures to prevent disruptive popups
  const autoSaveFailureCount = useRef(0);
  const isAutoSaveDisabled = useRef(false);

  // Auto-save every 30 seconds - but only after initial load is complete
  useEffect(() => {
    if (!isInitialLoadComplete) {
      debug('������������� Auto-save waiting for initial load to complete');
      return;
    }

    debug('��� Auto-save effect triggered, setting up interval');
    const interval = setInterval(() => {
      // Skip auto-save if it's been disabled due to repeated failures
      if (isAutoSaveDisabled.current) {
        debug('⚠️ Auto-save disabled due to repeated failures');
        return;
      }

      debug('��� Auto-save interval triggered');
      // Use window reference to avoid hoisting issues
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 30000);
    return () => {
      debug('🛑 Clearing auto-save interval');
      clearInterval(interval);
    }
  }, [isInitialLoadComplete]);

  // DISABLED: Immediate auto-save was causing checkbox state to revert
  // Auto-save only happens every 30 seconds via the interval above
  // useEffect(() => {
  //   if (!isInitialLoadComplete) return;
  //   debug('🔄 State change detected, triggering immediate save');
  //   const timeoutId = setTimeout(() => {
  //     if (window.landValuationSave) {
  //       window.landValuationSave({ source: 'autosave' });
  //     }
  //   }, 1000);
  //   return () => clearTimeout(timeoutId);
  // }, [vacantSales.length, Object.keys(saleCategories).length, isInitialLoadComplete]);

  // Clear Method 1 temporary variables after filtering is complete
  // IMPORTANT: Don't clear too early - filterVacantSales needs these to preserve manual sales
  useEffect(() => {
    if (isInitialLoadComplete && vacantSales.length > 0 && window._method1ExcludedSales) {
      // Only clear after we have populated vacantSales (which means filterVacantSales has run)
      debug('🧹 Clearing Method 1 temporary variables after successful application');
      setTimeout(() => {
        delete window._method1ExcludedSales;
        delete window._method1IncludedSales;
        delete window._method1ManuallyAdded;
      }, 1000); // Small delay to ensure filterVacantSales completes
    }
  }, [isInitialLoadComplete, vacantSales.length]);
  // ========== LAND RATES FUNCTIONS WITH ENHANCED FILTERS ==========
  const filterVacantSales = useCallback(() => {
    if (!properties) return;

    console.log('����� FilterVacantSales called:', {
      currentVacantSalesCount: vacantSales.length,
      hasMethod1Excluded: !!window._method1ExcludedSales,
      method1ExcludedSize: window._method1ExcludedSales?.size || 0,
      hasManuallyAdded: !!window._method1ManuallyAdded,
      manuallyAddedSize: window._method1ManuallyAdded?.size || 0,
      isInitialLoadComplete: isInitialLoadComplete
    });

    // CRITICAL: First restore manually added properties that might not meet natural criteria
    const finalSales = [];
    const manuallyAddedIds = window._method1ManuallyAdded || new Set();

    if (manuallyAddedIds.size > 0) {
      const manuallyAddedProps = properties.filter(prop => manuallyAddedIds.has(prop.id));
      debug('🔄 Restoring manually added properties:', {
        found: manuallyAddedProps.length,
        expected: manuallyAddedIds.size,
        foundIds: manuallyAddedProps.map(p => p.id),
        expectedIds: Array.from(manuallyAddedIds)
      });

      manuallyAddedProps.forEach(prop => {
        const acres = calculateAcreage(prop);
        const sizeForUnit = valuationMode === 'ff' ? (parseFloat(prop.asset_lot_frontage) || 0) : acres;
        const pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, sizeForUnit);
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
      debug('������ Preserving existing restored sales, checking for new ones only');

      // Find any new sales that match criteria but aren't already in vacantSales
      const existingIds = new Set(vacantSales.map(s => s.id));
      const newSales = properties.filter(prop => {
        if (existingIds.has(prop.id)) return false;

        // Validate sale price (ignore placeholders <= 10) and parse dates reliably
        const hasValidSale = prop.sales_date && prop.sales_price && Number(prop.sales_price) > 10;
        const saleDateObj = prop.sales_date ? new Date(prop.sales_date) : null;
        const startDate = safeDateObj(dateRange.start) ? new Date(safeDateObj(dateRange.start)) : new Date(0);
        startDate.setHours(0,0,0,0);
        const endDate = safeDateObj(dateRange.end) ? new Date(safeDateObj(dateRange.end)) : new Date(8640000000000000);
        endDate.setHours(23,59,59,999);
        const inDateRange = saleDateObj instanceof Date && !isNaN(saleDateObj) && saleDateObj >= startDate && saleDateObj <= endDate;

        const nu = (prop.sales_nu || '').toString();
        const nuTrim = nu.trim();
        const validNu = nuTrim === '' || ['00','07','7'].includes(nuTrim) || nu.startsWith(' ');

        // Additional card logic per vendor
        let isAdditionalCard = false;
        if (prop.property_addl_card) {
          const card = String(prop.property_addl_card).trim().toUpperCase();
          if (vendorType === 'BRT') {
            // BRT: numeric cards, primary starts with '1'
            if (card === '' || card === 'NONE') isAdditionalCard = false;
            else if (!card.startsWith('1')) isAdditionalCard = true;
          } else if (vendorType === 'Microsystems') {
            // Microsystems: primary card is 'M'
            if (card === '' || card === 'NONE' || card === 'M') isAdditionalCard = false;
            else isAdditionalCard = true;
          } else {
            if (card !== 'NONE' && card !== 'M') isAdditionalCard = true;
          }
        }
        if (isAdditionalCard) return false;

        const isVacantClass = String(prop.property_m4_class).toUpperCase() === '1' || String(prop.property_m4_class).toUpperCase() === '3B';
        const isTeardown = String(prop.property_m4_class) === '2' &&
                          prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                          prop.asset_design_style &&
                          prop.asset_type_use &&
                          prop.values_mod_improvement < 10000;
        const isPreConstruction = String(prop.property_m4_class) === '2' &&
                                 prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                                 prop.asset_design_style &&
                                 prop.asset_type_use &&
                                 prop.asset_year_built &&
                                 prop.sales_date &&
                                 new Date(prop.sales_date).getFullYear() < prop.asset_year_built;

        return hasValidSale && inDateRange && validNu && (isVacantClass || isTeardown || isPreConstruction);
      });

      if (newSales.length > 0) {
        debug('��������� Found new sales to add:', newSales.length);
        const enriched = newSales.map(prop => {
          const acres = calculateAcreage(prop);
          const sizeForUnit = valuationMode === 'ff' ? (parseFloat(prop.asset_lot_frontage) || 0) : acres;
          const pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, sizeForUnit);
          return {
            ...prop,
            totalAcres: acres,
            pricePerAcre: pricePerUnit,
            land_front_feet: prop.land_front_feet || prop.asset_lot_frontage || 0,
            land_depth: prop.land_depth || prop.asset_lot_depth || 0,
            land_zoning: prop.land_zoning || prop.asset_zoning || prop.zoning || 'N/A'
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

      // Validate sale price (ignore placeholders <= 10) and normalize dates
      const hasValidSale = prop.sales_date && prop.sales_price && Number(prop.sales_price) > 10;
      const saleDateObj = prop.sales_date ? new Date(prop.sales_date) : null;
      const startDate = safeDateObj(dateRange.start) ? new Date(safeDateObj(dateRange.start)) : new Date(0);
      startDate.setHours(0,0,0,0);
      const endDate = safeDateObj(dateRange.end) ? new Date(safeDateObj(dateRange.end)) : new Date(8640000000000000);
      endDate.setHours(23,59,59,999);
      const inDateRange = saleDateObj instanceof Date && !isNaN(saleDateObj) && saleDateObj >= startDate && saleDateObj <= endDate;

      // Check NU codes for valid sales
      const nu = (prop.sales_nu || '').toString();
      const nuTrim = nu.trim();
      const validNu = nuTrim === '' || ['00','07','7'].includes(nuTrim) || nu.startsWith(' ');

      // Skip additional cards - they don't have land (vendor-specific rules)
      let isAdditionalCard = false;
      if (prop.property_addl_card) {
        const card = String(prop.property_addl_card).trim().toUpperCase();
        if (vendorType === 'BRT') {
          if (card === '' || card === 'NONE') isAdditionalCard = false;
          else if (!card.startsWith('1')) isAdditionalCard = true;
        } else if (vendorType === 'Microsystems') {
          if (card === '' || card === 'NONE' || card === 'M') isAdditionalCard = false;
          else isAdditionalCard = true;
        } else {
          if (card !== 'NONE' && card !== 'M') isAdditionalCard = true;
        }
      }
      if (isAdditionalCard) {
        return false;
      }

      // Standard vacant classes
      const isVacantClass = String(prop.property_m4_class).toUpperCase() === '1' || String(prop.property_m4_class).toUpperCase() === '3B';

      // NEW: Teardown detection (Class 2 with minimal improvement)
      const isTeardown = String(prop.property_m4_class) === '2' &&
                        prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                        prop.asset_design_style &&
                        prop.asset_type_use &&
                        prop.values_mod_improvement < 10000;

      // NEW: Pre-construction detection (sold before house was built)
      const isPreConstruction = String(prop.property_m4_class) === '2' &&
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
      // For front foot mode use frontage as size
      let pricePerUnit;
      if (valuationMode === 'ff') {
        const frontage = parseFloat(prop.asset_lot_frontage) || 0;
        pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, frontage);
      } else {
        pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, acres);
      }
      // Ensure whole numbers for unit rates
      const roundedUnitPrice = Math.round(pricePerUnit);

      // Auto-categorize teardowns and pre-construction
      let category = saleCategories[prop.id];
      // Determine additional-cards using centralized _pkg (computed once in JobContainer)
      const packageAnalysis = prop._pkg;
      if (packageAnalysis && packageAnalysis.is_additional_card && !isPackage) {
        prop.packageData = {
          is_package: false,
          package_type: 'additional_cards',
          package_count: packageAnalysis.package_count || 2,
          properties: packageAnalysis.package_properties || []
        };
      }
      if (!category) {
        if (prop.property_m4_class === '2' && prop.values_mod_improvement < 10000) {
          category = 'teardown';
        } else if (prop.property_m4_class === '2' &&
                   prop.asset_year_built &&
                   new Date(prop.sales_date).getFullYear() < prop.asset_year_built) {
          category = 'pre-construction';
        } else if (prop.property_m4_class === '1' || prop.property_m4_class === '3B') {
          // Default vacant land sales to Building Lots
          category = 'building-lot';
        }
      }
      
      return {
        ...prop,
        totalAcres: acres,
        pricePerAcre: roundedUnitPrice,
        autoCategory: category,
        isPackage,
        // Preserve FF/Depth/Zone data for allocation study
        land_front_feet: prop.land_front_feet || prop.asset_lot_frontage || 0,
        land_depth: prop.land_depth || prop.asset_lot_depth || 0,
        land_zoning: prop.land_zoning || prop.asset_zoning || prop.zoning || 'N/A'
      };
    };

    // Process packages and standalone (add to existing finalSales that contains manually added)

    // Consolidate package sales using centralized analyzer
    Object.entries(packageGroups).forEach(([key, group]) => {
      // Use centralized _pkg data (computed once in JobContainer)
      const packageData = group[0]._pkg;

      if (packageData) {
        // If packageData indicates an additional cards scenario
        if (packageData.is_additional_card) {
          // When it's additional cards, present as single enriched property (do not aggregate multiple properties)
          const enriched = enrichProperty(group[0]);
          enriched.packageData = {
            is_package: false,
            package_type: 'additional_cards',
            package_count: packageData.package_count || group.length,
            properties: packageData.package_properties || group.map(p => p.property_composite_key)
          };
          finalSales.push(enriched);
          if (enriched.autoCategory && !saleCategories[enriched.id]) setSaleCategories(prev => ({...prev, [enriched.id]: enriched.autoCategory}));
          return;
        }

        // Multi-property package
        if (packageData.is_package_sale || packageData.package_count > 1) {
            // Prefer any precomputed combined lot acres from the analyzer
          // Use original property sales_price (don't sum - each property already has full package price)
          const totalPrice = group[0].values_norm_time || group[0].sales_price;

          let totalAcres = null;
          if (packageData.combined_lot_acres && !isNaN(Number(packageData.combined_lot_acres)) && Number(packageData.combined_lot_acres) > 0) {
            totalAcres = Number(packageData.combined_lot_acres);
          } else if (packageData.combined_lot_sf && !isNaN(Number(packageData.combined_lot_sf)) && Number(packageData.combined_lot_sf) > 0) {
            totalAcres = Number(packageData.combined_lot_sf) / 43560;
          } else {
            totalAcres = packageData.package_properties.reduce((sum, pObj) => {
              const compKey = (typeof pObj === 'string') ? pObj : (pObj.composite_key || pObj.compositeKey || pObj.property_composite_key || pObj.composite);
              const p = group.find(g => g.property_composite_key === compKey) || properties.find(pp => pp.property_composite_key === compKey);
              return sum + parseFloat(calculateAcreage(p) || 0);
            }, 0);
          }

          let pricePerUnit;
          let packageSale = null;

          if (valuationMode === 'ff') {
            // Sum frontage and compute average depth for display
            const totalFrontage = packageData.package_properties.reduce((sum, pObj) => {
              const compKey = (typeof pObj === 'string') ? pObj : (pObj.composite_key || pObj.compositeKey || pObj.property_composite_key || pObj.composite);
              const p = group.find(g => g.property_composite_key === compKey) || properties.find(pp => pp.property_composite_key === compKey);
              return sum + (parseFloat(p?.asset_lot_frontage) || 0);
            }, 0);
            const depthValues = packageData.package_properties.map(pObj => {
              const compKey = (typeof pObj === 'string') ? pObj : (pObj.composite_key || pObj.compositeKey || pObj.property_composite_key || pObj.composite);
              const p = group.find(g => g.property_composite_key === compKey) || properties.find(pp => pp.property_composite_key === compKey);
              return parseFloat(p?.asset_lot_depth) || null;
            }).filter(Boolean);
            const avgDepth = depthValues.length > 0 ? (depthValues.reduce((s, v) => s + v, 0) / depthValues.length) : null;

            pricePerUnit = getPricePerUnit(totalPrice, totalFrontage || 0);
            const roundedPkgUnitPrice = Math.round(pricePerUnit);

            packageSale = {
              ...group[0],
              id: `package_${key}`,
              property_block: group[0].property_block,
              property_lot: `${group[0].property_lot} (+${(packageData.package_count || group.length) - 1} more)`,
              property_location: 'Multiple Properties',
              sales_price: totalPrice,
              // Keep totalAcres if available
              totalAcres: totalAcres,
              asset_lot_frontage: totalFrontage || null,
              asset_lot_depth: avgDepth,
              pricePerAcre: roundedPkgUnitPrice,
              // Preserve FF/Depth/Zone for allocation study
              land_front_feet: totalFrontage || null,
              land_depth: avgDepth,
              land_zoning: group[0].asset_zoning || group[0].land_zoning || group[0].zoning || 'N/A',
              packageData: {
                is_package: true,
                package_count: packageData.package_count || group.length,
                properties: packageData.package_properties || group.map(p => p.property_composite_key)
              },
              autoCategory: 'package'
            };
          } else {
            pricePerUnit = getPricePerUnit(totalPrice, totalAcres || 0);

            packageSale = {
              ...group[0],
              id: `package_${key}`,
              property_block: group[0].property_block,
              property_lot: `${group[0].property_lot} (+${(packageData.package_count || group.length) - 1} more)`,
              property_location: 'Multiple Properties',
              sales_price: totalPrice,
              totalAcres: totalAcres,
              pricePerAcre: pricePerUnit,
              // Preserve FF/Depth/Zone for allocation study
              land_front_feet: group[0].land_front_feet || group[0].asset_lot_frontage || 0,
              land_depth: group[0].land_depth || group[0].asset_lot_depth || 0,
              land_zoning: group[0].asset_zoning || group[0].land_zoning || group[0].zoning || 'N/A',
              packageData: {
                is_package: true,
                package_count: packageData.package_count || group.length,
                properties: packageData.package_properties || group.map(p => p.property_composite_key)
              },
              autoCategory: 'package'
            };
          }

          finalSales.push(packageSale);
          setIncludedSales(prev => new Set([...prev, packageSale.id]));
          if (packageSale.autoCategory && !saleCategories[packageSale.id]) setSaleCategories(prev => ({...prev, [packageSale.id]: packageSale.autoCategory}));
          return;
        }
      }

      // Default: fall back to previous behavior
      if (group.length > 1) {
        // Use original sale price (don't sum - properties already contain full package price)
        const totalPrice = group[0].values_norm_time || group[0].sales_price;
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
          // Preserve FF/Depth/Zone for allocation study
          land_front_feet: group[0].land_front_feet || group[0].asset_lot_frontage || 0,
          land_depth: group[0].land_depth || group[0].asset_lot_depth || 0,
          land_zoning: group[0].asset_zoning || group[0].land_zoning || group[0].zoning || 'N/A',
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
        if (packageSale.autoCategory && !saleCategories[packageSale.id]) {
          setSaleCategories(prev => ({...prev, [packageSale.id]: packageSale.autoCategory}));
        }
      } else {
        // Single property with book/page
        const enriched = enrichProperty(group[0]);
        finalSales.push(enriched);
        if (enriched.autoCategory && !saleCategories[enriched.id]) {
          setSaleCategories(prev => ({...prev, [enriched.id]: enriched.autoCategory}));
        }
      }
    });

    // Add standalone properties
    standalone.forEach(prop => {
      const enriched = enrichProperty(prop);
      finalSales.push(enriched);
      if (enriched.autoCategory) {
        debug(`����️ Auto-categorizing ${prop.property_block}/${prop.property_lot} as ${enriched.autoCategory}`);
        if (!saleCategories[prop.id]) setSaleCategories(prev => ({...prev, [prop.id]: enriched.autoCategory}));
      }
    });

    // Keep all sales in UI - method1ExcludedSales only affects calculations, not visibility
    let filteredSales = finalSales;

    // Filter out packages containing properties with restricted property classes (2, 3A, 4A, 4B, 4C)
    const restrictedClasses = ['2', '3A', '4A', '4B', '4C'];
    const salesBeforeClassFilter = filteredSales.length;
    filteredSales = filteredSales.filter(sale => {
      // If it's not a package, include it
      if (!sale.packageData || !sale.packageData.is_package || !sale.packageData.properties) {
        return true;
      }

      // Check if any property in the package has a restricted class
      const hasRestrictedClass = sale.packageData.properties.some(propertyKey => {
        const prop = properties.find(p => p.property_composite_key === propertyKey);
        return prop && restrictedClasses.includes(String(prop.property_m4_class));
      });

      if (hasRestrictedClass) {
        debug(`������ Excluding package ${sale.property_block}/${sale.property_lot} - contains restricted property class`);
        return false;
      }

      return true;
    });

    debug('🔄 Vacant sales processing:', {
      totalSalesFound: finalSales.length,
      finalSalesCount: filteredSales.length
    });

    setVacantSales(filteredSales);

    // Preserve checkbox states more intelligently
    setIncludedSales(prev => {
      // If initial load isn't complete yet, don't modify included sales
      if (!isInitialLoadComplete) {
        debug('������ Skipping checkbox update - waiting for initial load');
        return prev;
      }

      const existingIds = new Set(prev);
      const currentSaleIds = new Set(filteredSales.map(s => s.id));

      const preservedIncluded = new Set();

      // Only include sales that:
      // 1. Are in the current filtered results
      // 2. Are NOT in the excluded set
      // 3. Were previously included (preserve user selections)
      filteredSales.forEach(sale => {
        if (!method1ExcludedSales.has(sale.id)) {
          // Only preserve sales that were previously included
          // This respects user checkbox selections (unchecked items stay unchecked)
          if (existingIds.has(sale.id)) {
            preservedIncluded.add(sale.id);
          }
        }
      });

      debug('✅ Checkbox state management (respecting exclusions):', {
        isInitialLoadComplete,
        previousCount: prev.size,
        currentSalesCount: filteredSales.length,
        preservedCount: preservedIncluded.size,
        excludedCount: method1ExcludedSales.size,
        preservedIds: Array.from(preservedIncluded),
        excludedIds: Array.from(method1ExcludedSales)
      });

      return preservedIncluded;
    });
  }, [properties, dateRange, calculateAcreage, getPricePerUnit]);

  // NOTE: filterVacantSales is already triggered by the main useEffect (lines 1010-1024)
  // when isInitialLoadComplete becomes true. No need for a duplicate trigger here.

  const performBracketAnalysis = useCallback(async () => {
    if (!properties || !jobData?.id) return;

    console.log('🔄 performBracketAnalysis - FIXED DELTA CALCULATION:', new Date().toISOString());
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
      const vcsSalesByRegion = {}; // New: Group by VCS + Special Region

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

        // Determine special region for this property
        // Priority 1: Check if property is directly assigned to a region
        // Priority 2: Check if there's a matching vacant sale with a region assignment
        // Priority 3: Default to Normal
        let propRegion = specialRegions[prop.id] || 'Normal';

        if (propRegion === 'Normal') {
          // If not directly assigned, find if there's a vacant sale at the same location with a special region
          const matchingVacantSale = vacantSales.find(vs =>
            vs.property_block === prop.property_block &&
            vs.property_lot === prop.property_lot
          );

          if (matchingVacantSale && specialRegions[matchingVacantSale.id]) {
            propRegion = specialRegions[matchingVacantSale.id];
          }
        }

        // Group by VCS only (legacy)
        if (!vcsSales[vcs]) {
          vcsSales[vcs] = [];
        }

        // Group by VCS + Region (new)
        const regionKey = `${vcs}_${propRegion}`;
        if (!vcsSalesByRegion[regionKey]) {
          vcsSalesByRegion[regionKey] = {
            vcs,
            region: propRegion,
            sales: []
          };
        }

        const acres = parseFloat(calculateAcreage(prop) || 0);
        const sfla = parseFloat(prop.asset_sfla || 0);

        const saleData = {
          id: prop.id,
          acres,
          salesPrice: timeNormData.values_norm_time,
          normalizedTime: timeNormData.values_norm_time,
          sfla,
          address: prop.property_location,
          yearBuilt: prop.asset_year_built,
          saleDate: prop.sales_date,
          typeUse: prop.asset_type_use,
          region: propRegion
        };

        vcsSales[vcs].push(saleData);
        vcsSalesByRegion[regionKey].sales.push(saleData);
      });

      const analysis = {};
      const analysisByRegion = {};
      let validRates = [];
      let validRatesByRegion = {};

      // Helper function to get cascade boundaries for a region
      const getCascadeBoundaries = (region) => {
        const config = region === 'Normal' ? cascadeConfig.normal : (cascadeConfig.special?.[region] || cascadeConfig.normal);
        return {
          pMax: config?.prime?.max ?? 1,
          sMax: config?.secondary?.max ?? 5,
          eMax: config?.excess?.max ?? 10,
          rMax: config?.residual?.max ?? null
        };
      };

      // Helper function to perform bracket analysis for a set of sales
      const performRegionBracketAnalysis = (sales, region, vcs) => {
        if (sales.length < 3) return null; // Need minimum sales for analysis

        // Sort by acreage for bracketing
        sales.sort((a, b) => a.acres - b.acres);

        // Use region-specific cascade boundaries
        const { pMax, sMax, eMax, rMax } = getCascadeBoundaries(region);

        const brackets = {
          small: sales.filter(s => s.acres < pMax),
          medium: sales.filter(s => s.acres >= pMax && s.acres < sMax),
          large: sales.filter(s => s.acres >= sMax && s.acres < eMax),
          xlarge: rMax ? sales.filter(s => s.acres >= eMax && s.acres < rMax) : sales.filter(s => s.acres >= eMax),
          residual: rMax ? sales.filter(s => s.acres >= rMax) : []
        };

        // Calculate overall VCS average SFLA for size adjustment (Method 2 uses SFLA)
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

          // Jim's Magic Formula for size adjustment - METHOD 2 USES SFLA, NOT LOT SIZE
          let avgAdjusted = avgNormTime;
          if (overallAvgSFLA && avgSFLA && avgSFLA > 0) {
            const sflaDiff = overallAvgSFLA - avgSFLA;
            const pricePerSfla = avgNormTime / avgSFLA;
            const sizeAdjustment = sflaDiff * (pricePerSfla * 0.50);
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
          }
        }

        return {
          totalSales: sales.length,
          avgPrice: Math.round(sales.reduce((sum, s) => sum + s.normalizedTime, 0) / sales.length),
          avgAcres: Math.round((sales.reduce((sum, s) => sum + s.acres, 0) / sales.length) * 100) / 100,
          avgAdjusted: Math.round(sales.reduce((sum, s) => sum + s.normalizedTime, 0) / sales.length),
          avgSFLA: overallAvgSFLA ? Math.round(overallAvgSFLA) : null,
          brackets: bracketStats,
          impliedRate,
          region,
          cascadeBoundaries: { pMax, sMax, eMax, rMax }
        };
      };

      // Process VCS sales by region
      Object.values(vcsSalesByRegion).forEach(({ vcs, region, sales }) => {
        const regionAnalysis = performRegionBracketAnalysis(sales, region, vcs);
        if (regionAnalysis && regionAnalysis.impliedRate) {
          if (!analysisByRegion[region]) {
            analysisByRegion[region] = {};
          }
          analysisByRegion[region][vcs] = regionAnalysis;

          if (!validRatesByRegion[region]) {
            validRatesByRegion[region] = [];
          }
          validRatesByRegion[region].push(regionAnalysis.impliedRate);
        }
      });

      // Legacy analysis (maintain backwards compatibility)
      Object.keys(vcsSales).forEach(vcs => {
        const sales = vcsSales[vcs];
        if (sales.length < 3) return; // Need minimum sales for analysis

        // Sort by acreage for bracketing
        sales.sort((a, b) => a.acres - b.acres);

        // Use normal cascade boundaries for legacy analysis
        const pMax = cascadeConfig.normal?.prime?.max ?? 1;
        const sMax = cascadeConfig.normal?.secondary?.max ?? 5;
        const eMax = cascadeConfig.normal?.excess?.max ?? 10;
        const rMax = cascadeConfig.normal?.residual?.max ?? null;

        const brackets = {
          small: sales.filter(s => s.acres < pMax),
          medium: sales.filter(s => s.acres >= pMax && s.acres < sMax),
          large: sales.filter(s => s.acres >= sMax && s.acres < eMax),
          xlarge: rMax ? sales.filter(s => s.acres >= eMax && s.acres < rMax) : sales.filter(s => s.acres >= eMax),
          residual: rMax ? sales.filter(s => s.acres >= rMax) : []
        };

        // Calculate overall VCS average SFLA for size adjustment (Method 2 uses SFLA)
        const allValidSFLA = sales.filter(s => s.sfla > 0);
        const overallAvgSFLA = allValidSFLA.length > 0 ?
          allValidSFLA.reduce((sum, s) => sum + s.sfla, 0) / allValidSFLA.length : null;

        // Also compute overall avg LOT SF for Front Foot Rates table only
        const allValidLotSF = sales.filter(s => s.acres > 0).map(s => (s.acres * 43560));
        const overallAvgLotSF = allValidLotSF.length > 0 ?
          allValidLotSF.reduce((sum, s) => sum + s, 0) / allValidLotSF.length : null;

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

          // Compute average lot SF for this bracket (only used for Front Foot Rates table)
          const validLotSF = arr.filter(s => s.acres > 0).map(s => (s.acres * 43560));
          const avgLotSF = validLotSF.length > 0 ? validLotSF.reduce((sum, v) => sum + v, 0) / validLotSF.length : null;

          // Jim's Magic Formula for size adjustment - METHOD 2 USES SFLA, NOT LOT SIZE
          let avgAdjusted = avgNormTime;
          if (overallAvgSFLA && avgSFLA && avgSFLA > 0) {
            const sflaDiff = overallAvgSFLA - avgSFLA;
            const pricePerSfla = avgNormTime / avgSFLA;
            const sizeAdjustment = sflaDiff * (pricePerSfla * 0.50);
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
          avgSFLA: overallAvgSFLA ? Math.round(overallAvgSFLA) : null,
          brackets: bracketStats,
          impliedRate
        };
      });

      // Calculate Method 2 Summary by bracket ranges with positive deltas only
      const bracketRates = {
        mediumRange: [], // 1.00-4.99 acre rates
        largeRange: [],  // 5.00-9.99 acre rates
        xlargeRange: [] // 10.00+ acre rates
      };

      // Also collect avgAcres for each bracket range
      const bracketAcres = {
        mediumRange: [],
        largeRange: [],
        xlargeRange: []
      };

      Object.keys(vcsSales).forEach(vcs => {
        // Skip excluded VCSs from summary calculation
        if (excludedMethod2VCS.has(vcs)) return;

        const vcsAnalysis = analysis[vcs];
        if (!vcsAnalysis) return;

        const { brackets } = vcsAnalysis;
        const allBrackets = [brackets.small, brackets.medium, brackets.large, brackets.xlarge];

        // For each bracket, find the best comparison bracket (highest valid one below it)
        const findBestComparison = (targetBracket, targetIndex) => {
          let bestBracket = null;
          let highestValidAdjusted = 0;

          for (let i = 0; i < targetIndex; i++) {
            const candidate = allBrackets[i];
            if (candidate &&
                candidate.count > 0 &&
                candidate.avgAdjusted &&
                candidate.avgAdjusted < targetBracket.avgAdjusted &&
                candidate.avgAdjusted > highestValidAdjusted) {
              bestBracket = candidate;
              highestValidAdjusted = candidate.avgAdjusted;
            }
          }
          return bestBracket;
        };

        // Medium range (comparing medium bracket to best lower bracket)
        if (brackets.medium.count > 0 && brackets.medium.avgAdjusted) {
          const comparison = findBestComparison(brackets.medium, 1);
          if (comparison) {
            const priceDiff = brackets.medium.avgAdjusted - comparison.avgAdjusted;
            const acresDiff = brackets.medium.avgAcres - comparison.avgAcres;
            if (acresDiff > 0 && priceDiff > 0) {
              const rate = Math.round(priceDiff / acresDiff);
              bracketRates.mediumRange.push(rate);
              bracketAcres.mediumRange.push(brackets.medium.avgAcres);
            }
          }
        }

        // Large range (comparing large bracket to best lower bracket)
        if (brackets.large.count > 0 && brackets.large.avgAdjusted) {
          const comparison = findBestComparison(brackets.large, 2);
          if (comparison) {
            const priceDiff = brackets.large.avgAdjusted - comparison.avgAdjusted;
            const acresDiff = brackets.large.avgAcres - comparison.avgAcres;
            if (acresDiff > 0 && priceDiff > 0) {
              const rate = Math.round(priceDiff / acresDiff);
              bracketRates.largeRange.push(rate);
              bracketAcres.largeRange.push(brackets.large.avgAcres);
            }
          }
        }

        // XLarge range (comparing xlarge bracket to best lower bracket)
        if (brackets.xlarge.count > 0 && brackets.xlarge.avgAdjusted) {
          const comparison = findBestComparison(brackets.xlarge, 3);
          if (comparison) {
            const priceDiff = brackets.xlarge.avgAdjusted - comparison.avgAdjusted;
            const acresDiff = brackets.xlarge.avgAcres - comparison.avgAcres;
            if (acresDiff > 0 && priceDiff > 0) {
              const rate = Math.round(priceDiff / acresDiff);
              bracketRates.xlargeRange.push(rate);
              bracketAcres.xlargeRange.push(brackets.xlarge.avgAcres);
            }
          }
        }
      });

      // Calculate averages for each bracket range
      const calculateBracketSummary = (rates, acres = []) => {
        if (rates.length === 0) return { perAcre: 'N/A', perSqFt: 'N/A', count: 0, avgAcres: null };

        const avgPerAcre = Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
        const avgPerSqFt = (avgPerAcre / 43560).toFixed(2);

        // Calculate average lot size if acres array provided
        const avgAcres = acres.length > 0
          ? acres.reduce((sum, a) => sum + a, 0) / acres.length
          : null;

        return {
          perAcre: avgPerAcre,
          perSqFt: avgPerSqFt,
          count: rates.length,
          avgAcres: avgAcres
        };
      };

      // Calculate Method 2 Summary by special region
      const method2SummaryByRegion = {};

      Object.keys(analysisByRegion).forEach(region => {
        const regionVcsSales = analysisByRegion[region];
        const regionBracketRates = {
          mediumRange: [],
          largeRange: [],
          xlargeRange: []
        };

        Object.keys(regionVcsSales).forEach(vcs => {
          // Skip excluded VCSs from regional summary calculation
          if (excludedMethod2VCS.has(vcs)) return;

          const vcsAnalysis = regionVcsSales[vcs];
          if (!vcsAnalysis) return;

          const { brackets, cascadeBoundaries } = vcsAnalysis;
          const allBrackets = [brackets.small, brackets.medium, brackets.large, brackets.xlarge];

          // For each bracket, find the best comparison bracket (highest valid one below it)
          const findBestComparison = (targetBracket, targetIndex) => {
            let bestBracket = null;
            let highestValidAdjusted = 0;

            for (let i = 0; i < targetIndex; i++) {
              const candidate = allBrackets[i];
              if (candidate &&
                  candidate.count > 0 &&
                  candidate.avgAdjusted &&
                  candidate.avgAdjusted < targetBracket.avgAdjusted &&
                  candidate.avgAdjusted > highestValidAdjusted) {
                bestBracket = candidate;
                highestValidAdjusted = candidate.avgAdjusted;
              }
            }
            return bestBracket;
          };

          // Calculate bracket range rates using region-specific boundaries
          const boundaries = cascadeBoundaries;

          // Medium range (comparing medium bracket to best lower bracket)
          if (brackets.medium.count > 0 && brackets.medium.avgAdjusted) {
            const comparison = findBestComparison(brackets.medium, 1);
            if (comparison) {
              const priceDiff = brackets.medium.avgAdjusted - comparison.avgAdjusted;
              const acresDiff = brackets.medium.avgAcres - comparison.avgAcres;
              if (acresDiff > 0 && priceDiff > 0) {
                const rate = Math.round(priceDiff / acresDiff);
                regionBracketRates.mediumRange.push(rate);
              }
            }
          }

          // Large range (comparing large bracket to best lower bracket)
          if (brackets.large.count > 0 && brackets.large.avgAdjusted) {
            const comparison = findBestComparison(brackets.large, 2);
            if (comparison) {
              const priceDiff = brackets.large.avgAdjusted - comparison.avgAdjusted;
              const acresDiff = brackets.large.avgAcres - comparison.avgAcres;
              if (acresDiff > 0 && priceDiff > 0) {
                const rate = Math.round(priceDiff / acresDiff);
                regionBracketRates.largeRange.push(rate);
              }
            }
          }

          // XLarge range (comparing xlarge bracket to best lower bracket)
          if (brackets.xlarge.count > 0 && brackets.xlarge.avgAdjusted) {
            const comparison = findBestComparison(brackets.xlarge, 3);
            if (comparison) {
              const priceDiff = brackets.xlarge.avgAdjusted - comparison.avgAdjusted;
              const acresDiff = brackets.xlarge.avgAcres - comparison.avgAcres;
              if (acresDiff > 0 && priceDiff > 0) {
                const rate = Math.round(priceDiff / acresDiff);
                regionBracketRates.xlargeRange.push(rate);
              }
            }
          }
        });

        // Calculate averages for each bracket range (regional version - not currently tracking acres)
        const calculateBracketSummary = (rates) => {
          if (rates.length === 0) return { perAcre: 'N/A', perSqFt: 'N/A', count: 0, avgAcres: null };

          const avgPerAcre = Math.round(rates.reduce((sum, r) => sum + r, 0) / rates.length);
          const avgPerSqFt = (avgPerAcre / 43560).toFixed(2);

          return {
            perAcre: avgPerAcre,
            perSqFt: avgPerSqFt,
            count: rates.length,
            avgAcres: null
          };
        };

        method2SummaryByRegion[region] = {
          mediumRange: calculateBracketSummary(regionBracketRates.mediumRange),
          largeRange: calculateBracketSummary(regionBracketRates.largeRange),
          xlargeRange: calculateBracketSummary(regionBracketRates.xlargeRange),
          totalVCS: Object.keys(regionVcsSales).length,
          cascadeBoundaries: getCascadeBoundaries(region)
        };
      });

      // Count only non-excluded VCSs
      const includedVCSCount = Object.keys(vcsSales).filter(vcs => !excludedMethod2VCS.has(vcs)).length;

      setMethod2Summary({
        mediumRange: calculateBracketSummary(bracketRates.mediumRange, bracketAcres.mediumRange), // 1.00-4.99
        largeRange: calculateBracketSummary(bracketRates.largeRange, bracketAcres.largeRange),   // 5.00-9.99
        xlargeRange: calculateBracketSummary(bracketRates.xlargeRange, bracketAcres.xlargeRange), // 10.00+
        totalVCS: includedVCSCount,
        excludedVCSCount: excludedMethod2VCS.size
      });

      setBracketAnalysis(analysis);

    } catch (error) {
      console.error('Error in performBracketAnalysis:', error);
      setBracketAnalysis({});
    }
  }, [properties, cascadeConfig, calculateAcreage, method2TypeFilter, method2ExcludedSales, vacantSales, specialRegions, excludedMethod2VCS]);

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
      const saleDateObj = p.sales_date ? new Date(p.sales_date) : null;
      const startDate = safeDateObj(dateRange.start) || new Date(0);
      const endDate = safeDateObj(dateRange.end) || new Date(8640000000000000);
      const inDateRange = saleDateObj instanceof Date && !isNaN(saleDateObj.getTime()) && saleDateObj >= startDate && saleDateObj <= endDate;
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
          aVal = parseFloat(calculateAcreage(a) || 0);
          bVal = parseFloat(calculateAcreage(b) || 0);
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
      const sizeForUnit = valuationMode === 'ff' ? (parseFloat(prop.asset_lot_frontage) || 0) : acres;
      const pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, sizeForUnit);
      return {
        ...prop,
        totalAcres: acres,
        pricePerAcre: pricePerUnit,
        manuallyAdded: true,
        land_front_feet: prop.land_front_feet || prop.asset_lot_frontage || 0,
        land_depth: prop.land_depth || prop.asset_lot_depth || 0,
        land_zoning: prop.land_zoning || prop.asset_zoning || prop.zoning || 'N/A'
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
        debug(`������ Auto-categorizing manually added ${p.property_block}/${p.property_lot} as ${autoCategory}`);
        setSaleCategories(prev => ({...prev, [p.id]: autoCategory}));
      }
    });
    
    setSelectedToAdd(new Set());
    setShowAddModal(false);
    setSearchResults([]);

    // Note: Auto-save will trigger within 30 seconds to persist these changes
    debug('��� Sales added - auto-save will persist these changes:', toAdd.map(p => `${p.property_block}/${p.property_lot}`));
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

����� Property ownership/seller details
• Tax assessment and classification details
• Documented environmental constraints (wetlands, floodplains)
�� Municipality-specific land use characteristics
���� Any circumstances of the sale (estate, distressed, etc.)

Provide only verifiable facts with sources. Be specific and actionable for valuation purposes. 2-3 sentences.`;

    try {
      await navigator.clipboard.writeText(prompt);
      
      setLandNotes(prev => ({
        ...prev, 
        [property.id]: '���� Prompt copied! Opening Claude... (paste response here when ready)'
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

    debug('����️ Sale removed and tracked as excluded:', saleId);
  };

  // ========== ALLOCATION STUDY FUNCTIONS - REBUILT ==========
  const loadAllocationStudyData = useCallback(() => {
    if (!cascadeConfig.normal.prime) return;

    debug('������� Loading allocation study data - individual sale approach');

    // Process each individual vacant sale (no grouping)
    const processedVacantSales = [];

    // Filter sales according to user criteria:
    // INCLUDE: Building Lots, Tear Downs, Preconstruction
    // EXCLUDE: Raw Land, Landlocked, Wetlands
    const filteredSales = vacantSales.filter(s => {
      // Must be included in the study
      if (!includedSales.has(s.id)) return false;

      // Get the category for this sale
      const category = saleCategories[s.id];

      // If no category is set, check if it's a vacant land sale (class 1/3B) that should be auto-included as building lot
      if (!category) {
        // Allow vacant land sales (they should have been auto-categorized as building-lot)
        const isVacantClass = String(s.property_m4_class).toUpperCase() === '1' ||
                              String(s.property_m4_class).toUpperCase() === '3B';
        if (isVacantClass) {
          console.log(`✅ Including uncategorized vacant land sale ${s.property_block}/${s.property_lot} (class ${s.property_m4_class})`);
          return true;
        }

        // Check for teardown (class 2 with minimal improvement)
        const isTeardown = String(s.property_m4_class) === '2' && s.values_mod_improvement < 10000;
        if (isTeardown) {
          console.log(`�� Including uncategorized teardown sale ${s.property_block}/${s.property_lot}`);
          return true;
        }

        // Check for pre-construction (sold before built)
        const isPreConstruction = String(s.property_m4_class) === '2' &&
                                  s.asset_year_built &&
                                  s.sales_date &&
                                  new Date(s.sales_date).getFullYear() < s.asset_year_built;
        if (isPreConstruction) {
          console.log(`�� Including uncategorized pre-construction sale ${s.property_block}/${s.property_lot}`);
          return true;
        }

        console.log(`⚠������� Excluding uncategorized sale ${s.property_block}/${s.property_lot} (class ${s.property_m4_class})`);
        return false;
      }

      // Normalize category to lowercase for comparison
      const cat = category.toLowerCase();

      // EXCLUDE: Raw Land, Landlocked, Wetlands
      if (cat.includes('raw') && cat.includes('land')) {
        console.log(`������️ Excluding Raw Land sale ${s.property_block}/${s.property_lot}`);
        return false;
      }
      if (cat.includes('landlocked')) {
        console.log(`������ Excluding Landlocked sale ${s.property_block}/${s.property_lot}`);
        return false;
      }
      if (cat.includes('wetland')) {
        console.log(`⚠️ Excluding Wetlands sale ${s.property_block}/${s.property_lot}`);
        return false;
      }

      // INCLUDE: Building Lots, Tear Downs, Preconstruction (and any other category that isn't explicitly excluded)
      console.log(`✅ Including sale with category '${category}': ${s.property_block}/${s.property_lot}`);
      return true;
    });


    filteredSales.forEach(sale => {
      const year = new Date(sale.sales_date).getFullYear();
      const vcs = sale.new_vcs;
      const region = specialRegions[sale.id] || 'Normal';

      if (!vcs) return;

      // Calculate site value for this individual sale
      const acres = sale.totalAcres || parseFloat(calculateAcreage(sale));

      // Check for VCS-specific configuration first
      const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
        config.vcsList && config.vcsList.includes(vcs)
      );

      // Determine actual region - use VCS-specific region if configured, otherwise use manual assignment
      let actualRegion = region;
      if (vcsSpecificConfig && vcsSpecificConfig.region) {
        actualRegion = vcsSpecificConfig.region;
      }

      // Get cascade rates - prioritize VCS-specific, then region-specific
      let cascadeRates;
      if (vcsSpecificConfig && vcsSpecificConfig.rates) {
        cascadeRates = vcsSpecificConfig.rates;
        console.log(`🎯 Using VCS-specific rates for VCS ${vcs} (Region: ${actualRegion}):`, cascadeRates);
      } else {
        cascadeRates = actualRegion === 'Normal' ? cascadeConfig.normal : cascadeConfig.special[actualRegion];
        console.log(`📊 Using ${actualRegion} region rates for VCS ${vcs}:`, cascadeRates);
      }

      if (!cascadeRates) {
        console.warn(`⚠️ Missing cascade rates for VCS ${vcs}, region "${actualRegion}" on sale ${sale.property_block}/${sale.property_lot}`);
        return;
      }


      // Log special region usage
      if (region !== 'Normal') {
        debug(`�� Using special region "${region}" rates for sale ${sale.property_block}/${sale.property_lot}:`, {
          primeRate: cascadeRates.prime?.rate,
          secondaryRate: cascadeRates.secondary?.rate,
          excessRate: cascadeRates.excess?.rate
        });
      }

      // Apply cascade calculation to get raw land value
      console.log(`🔍 Calculating raw land for ${sale.property_block}/${sale.property_lot}:`, {
        valuationMode,
        acres,
        land_front_feet: sale.land_front_feet,
        asset_lot_frontage: sale.asset_lot_frontage,
        land_depth: sale.land_depth,
        asset_lot_depth: sale.asset_lot_depth,
        land_zoning: sale.land_zoning,
        hasCascadeRates: !!cascadeRates
      });

      // Calculate raw land value based on current valuation mode
      let rawLandValue = 0;
      let siteValue = 0;

      if (valuationMode === 'ff' && sale.asset_lot_frontage > 0) {
        const frontFeet = parseFloat(sale.asset_lot_frontage) || 0;
        const depth = parseFloat(sale.asset_lot_depth) || 100;

        // Get the correct rates from cascade config
        const standardRate = cascadeRates.standard?.rate || cascadeRates.prime?.rate || 0;
        const standardMax = cascadeRates.standard?.max || cascadeRates.prime?.max || 50;
        const excessRate = cascadeRates.excess?.rate || 0;

        // Calculate standard and excess frontage
        const standardFF = Math.min(frontFeet, standardMax);
        const excessFF = Math.max(0, frontFeet - standardMax);

        const standardValue = standardFF * standardRate;
        const excessValue = excessFF * excessRate;
        const rawBeforeDepth = standardValue + excessValue;

        // Get depth factor - look up the proper depth table from zoning requirements
        const zone = sale.asset_zoning || sale.zoning || 'DEFAULT';
        const zcfg = marketLandData?.zoning_config || {};
        const zoneEntry = zcfg[zone] ||
                         zcfg[zone?.toUpperCase?.()] ||
                         zcfg[zone?.toLowerCase?.()] || null;

        // Get depth table from zoning config (Land Rates component defines this)
        const depthTableName = zoneEntry?.depth_table || zoneEntry?.depthTable || '100FT Table';
        const depthTable = depthTables[depthTableName];

        // Calculate depth factor from factors object
        let depthFactor = 1.0;
        if (depthTable && depthTable.factors) {
          const factors = depthTable.factors;
          const depths = Object.keys(factors).map(Number).sort((a, b) => a - b);

          // Find the closest depth <= actual depth
          let closestDepth = depths[0];
          for (const d of depths) {
            if (d <= depth) closestDepth = d;
            else break;
          }

          depthFactor = factors[closestDepth] || 1.0;
        }

        rawLandValue = rawBeforeDepth * depthFactor;

        console.log(`🔍 VCS ${vcs} ${sale.property_block}/${sale.property_lot}:`, {
          depth,
          depthTableName,
          depthFactor,
          rawBeforeDepth: Math.round(rawBeforeDepth),
          rawLandValue: Math.round(rawLandValue),
          siteValue: Math.round((sale.sales_price || 0) - rawLandValue)
        });

      } else {
        // Acre or SF mode calculation (existing method)
        rawLandValue = calculateRawLandValue(acres, cascadeRates, sale);
      }

      // Calculate site value (what's left after raw land)
      siteValue = (sale.sales_price || 0) - rawLandValue;

      // Find improved sales for this VCS
      // SPECIAL REGIONS: Use ALL years for that VCS (rare sales, need full sample)
      // NORMAL REGION: Match by year (standard allocation by year)
      // REGION FILTERING: For special regions, only include properties in that region or unassigned
      const improvedSalesForYear = properties.filter(prop => {
        const hasValidSale = prop.sales_date && prop.sales_price && prop.sales_price > 0;
        const hasNormalizedPrice = prop.values_norm_time && prop.values_norm_time > 0;
        const hasValidTypeUse = prop.asset_type_use && prop.asset_type_use.toString().startsWith('1');
        const sameVCS = prop.new_vcs === vcs;

        // Special regions: use ALL years for that VCS (don't filter by year)
        // Normal region: filter by year to match vacant sale
        const yearMatch = actualRegion === 'Normal'
          ? new Date(prop.sales_date).getFullYear() === year
          : true; // Special regions use all years

        // Region filtering: ensure improved properties are in the same region
        const propRegion = specialRegions[prop.id] || 'Normal';
        const sameRegion = actualRegion === propRegion ||
                          (actualRegion !== 'Normal' && propRegion === 'Normal'); // Special regions can use unassigned (Normal) properties

        // MUST have values_norm_time - this is the key filter
        return hasValidSale && hasNormalizedPrice && hasValidTypeUse && sameVCS && yearMatch && sameRegion;
      });

      // Calculate averages only if we have improved sales
      // CRITICAL FIX: User's Excel uses time-normalized prices, not actual sale prices
      const avgImprovedPrice = improvedSalesForYear.length > 0
        ? improvedSalesForYear.reduce((sum, p) => sum + (p.values_norm_time || p.sales_price), 0) / improvedSalesForYear.length
        : 0;
      const avgImprovedAcres = improvedSalesForYear.length > 0
        ? improvedSalesForYear.reduce((sum, p) => sum + parseFloat(calculateAcreage(p)), 0) / improvedSalesForYear.length
        : 0;

      // Log improved sales calculation for debugging
      if (sale.property_block === '118' || sale.property_block === '43') {
        console.log(`📊 Improved Sales for ${sale.property_block}/${sale.property_lot} (VCS ${vcs}, Year ${year}):`, {
          improvedSalesCount: improvedSalesForYear.length,
          improvedSales: improvedSalesForYear.map(p => ({
            block: p.property_block,
            lot: p.property_lot,
            sales_price: p.sales_price,
            values_norm_time: p.values_norm_time,
            used_price: p.values_norm_time || p.sales_price
          })),
          avgImprovedPrice: Math.round(avgImprovedPrice),
          avgImprovedAcres: avgImprovedAcres.toFixed(2)
        });
      }

      // Calculate current allocation for this year (only for sales that have mod values)
      const salesWithModValues = improvedSalesForYear.filter(p => p.values_mod_land > 0 && p.values_mod_total > 0);
      const avgCurrentAllocation = salesWithModValues.length > 0
        ? salesWithModValues.reduce((sum, p) => sum + (p.values_mod_land / p.values_mod_total), 0) / salesWithModValues.length
        : 0;

      // Calculate average improved raw land value for Front Foot mode
      let avgImprovedRawLand = 0;

      if (valuationMode === 'ff') {
        let totalImprovedRawLand = 0;
        let validImprovedCount = 0;

        improvedSalesForYear.forEach(prop => {
          if (prop.asset_lot_frontage > 0) {
            const frontFeet = parseFloat(prop.asset_lot_frontage) || 0;
            const depth = parseFloat(prop.asset_lot_depth) || 100;

            // Use same cascade rates as the vacant sale (already looked up for this VCS)
            const standardRate = cascadeRates.standard?.rate || cascadeRates.prime?.rate || 0;
            const standardMax = cascadeRates.standard?.max || cascadeRates.prime?.max || 50;
            const excessRate = cascadeRates.excess?.rate || 0;

            // Get depth table from zoning requirements
            const propZone = prop.asset_zoning || prop.zoning || 'DEFAULT';
            const zcfg = marketLandData?.zoning_config || {};
            const propZoneEntry = zcfg[propZone] ||
                                 zcfg[propZone?.toUpperCase?.()] ||
                                 zcfg[propZone?.toLowerCase?.()] || null;

            const depthTableName = propZoneEntry?.depth_table || propZoneEntry?.depthTable || '100FT Table';
            const depthTable = depthTables[depthTableName];

            // Calculate depth factor from factors object
            let depthFactor = 1.0;
            if (depthTable && depthTable.factors) {
              const factors = depthTable.factors;
              const depths = Object.keys(factors).map(Number).sort((a, b) => a - b);

              // Find the closest depth <= actual depth
              let closestDepth = depths[0];
              for (const d of depths) {
                if (d <= depth) closestDepth = d;
                else break;
              }

              depthFactor = factors[closestDepth] || 1.0;
            }

            const standardFF = Math.min(frontFeet, standardMax);
            const excessFF = Math.max(0, frontFeet - standardMax);

            const improvedRawLand = ((standardFF * standardRate) + (excessFF * excessRate)) * depthFactor;
            totalImprovedRawLand += improvedRawLand;
            validImprovedCount++;
          }
        });

        avgImprovedRawLand = validImprovedCount > 0 ?
          totalImprovedRawLand / validImprovedCount : 0;
      } else {
        // Acre/SF mode - calculate average raw land for improved properties
        if (improvedSalesForYear.length > 0) {
          const improvedAcreages = improvedSalesForYear.map(p => parseFloat(calculateAcreage(p)));
          avgImprovedRawLand = improvedAcreages.reduce((sum, acres) =>
            sum + calculateRawLandValue(acres, cascadeRates), 0) / improvedSalesForYear.length;
        }
      }

      const improvedRawLandValue = avgImprovedRawLand;
      const totalLandValue = improvedRawLandValue + siteValue;

      // Calculate recommended allocation
      const recommendedAllocation = avgImprovedPrice > 0 ? totalLandValue / avgImprovedPrice : 0;

      // Calculate improved sales FF/Depth averages for FF mode
      // Use lot frontage/depth from the lot data, not overall property size
      const avgImprovedFF = improvedSalesForYear.length > 0
        ? improvedSalesForYear.reduce((sum, p) => sum + (parseFloat(p.asset_lot_frontage) || 0), 0) / improvedSalesForYear.length
        : 0;
      const avgImprovedDepth = improvedSalesForYear.length > 0
        ? improvedSalesForYear.reduce((sum, p) => sum + (parseFloat(p.asset_lot_depth) || 0), 0) / improvedSalesForYear.length
        : 0;

      processedVacantSales.push({
        id: sale.id,
        vcs: vcs,
        year: year,
        region: actualRegion,
        block: sale.property_block,
        lot: sale.property_lot,
        vacantPrice: sale.sales_amount || sale.sales_price || 0,
        acres: acres,
        frontFeet: valuationMode === 'ff' ? Math.round(sale.asset_lot_frontage || 0) : 0,
        depth: valuationMode === 'ff' ? Math.round(sale.asset_lot_depth || 0) : 0,
        zone: sale.asset_zoning || 'DEFAULT',
        rawLandValue: rawLandValue,
        siteValue: siteValue,
        improvedSalesCount: improvedSalesForYear.length,
        avgImprovedPrice: avgImprovedPrice,
        avgImprovedAcres: avgImprovedAcres,
        avgImprovedFF: valuationMode === 'ff' ? Math.round(avgImprovedFF) : 0,
        avgImprovedDepth: valuationMode === 'ff' ? Math.round(avgImprovedDepth) : 0,
        improvedRawLandValue: avgImprovedRawLand,
        totalLandValue: avgImprovedRawLand + siteValue,
        currentAllocation: avgCurrentAllocation,
        recommendedAllocation: avgImprovedPrice > 0 ? (avgImprovedRawLand + siteValue) / avgImprovedPrice : 0,
        isPositive: siteValue > 0
      });
    });

    setVacantTestSales(processedVacantSales);

    // Calculate overall recommended allocation (positive sales only)
    const positiveSales = processedVacantSales.filter(s => s.isPositive);
    if (positiveSales.length > 0) {
      const totalLandValue = positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0);
      const totalSalePrice = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
      const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

      debug('🎯 Overall recommended allocation:', {
        positiveSalesCount: positiveSales.length,
        totalLandValue,
        totalSalePrice,
        recommendedPercent: overallRecommended.toFixed(1)
      });
    }
  }, [cascadeConfig, vacantSales, includedSales, specialRegions, saleCategories, calculateAcreage, properties]);

  // Helper function to calculate typical lot size for Method 2 guidance
  // Uses same logic as VCS sheet: market_manual_lot_acre when available
  const calculateTypicalLotSize = useMemo(() => {
    if (!properties || properties.length === 0) return null;

    // Filter for properties with market_manual_lot_acre (matches VCS sheet logic)
    const eligibleSales = properties.filter(p =>
      p.market_manual_lot_acre && parseFloat(p.market_manual_lot_acre) > 0
    ) || [];

    if (eligibleSales.length === 0) return null;

    // Use market_manual_lot_acre values
    const lotSizes = eligibleSales.map(p => parseFloat(p.market_manual_lot_acre));

    if (lotSizes.length === 0) return null;

    // Calculate median (not mean) to avoid outliers
    const sorted = [...lotSizes].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    return {
      median: median.toFixed(2),
      count: lotSizes.length,
      min: Math.min(...lotSizes).toFixed(2),
      max: Math.max(...lotSizes).toFixed(2)
    };
  }, [properties]);

  // Helper function to get unique regions from vacant test sales
  const getUniqueRegions = () => {
    const regions = new Set(vacantTestSales.map(sale => sale.region));
    return Array.from(regions).sort((a, b) => {
      if (a === 'Normal') return -1;
      if (b === 'Normal') return 1;
      return a.localeCompare(b);
    });
  };

  // Helper function to calculate raw land value using cascade rates
  const calculateRawLandValue = (acresOrProperty, cascadeRates, propertyForFF = null) => {
    // If valuationMode is Front Foot and we have a property with FF data, use FF calculation
    console.log('\u27a1\ufe0f calculateRawLandValue called:', { valuationMode, hasPropertyForFF: !!propertyForFF });

    if (valuationMode === 'ff' && propertyForFF) {
      const frontFeet = parseFloat(propertyForFF.land_front_feet) || 0;
      const depth = parseFloat(propertyForFF.land_depth) || 0;

      console.log('\ud83d\udcca FF mode values:', { frontFeet, depth, land_front_feet: propertyForFF.land_front_feet, land_depth: propertyForFF.land_depth });

      if (frontFeet > 0 && depth > 0) {
        // Get depth table and zone for this property
        const zone = propertyForFF.land_zoning || propertyForFF.zoning || 'DEFAULT';
        const depthTable = depthTables[zone] || depthTables['DEFAULT'];

        if (depthTable && (cascadeRates.prime?.rate || cascadeRates.standard?.rate)) {
          // Find depth factor from depth table
          let depthFactor = 1.0;
          for (const row of depthTable) {
            if (depth >= row.min && depth <= row.max) {
              depthFactor = row.factor;
              break;
            }
          }

          // Use prime/excess structure if available, otherwise fall back to standard/excess
          const primeRate = cascadeRates.prime?.rate || cascadeRates.standard?.rate || 0;
          const primeMax = cascadeRates.prime?.max || cascadeRates.standard?.max || 100;
          const excessRate = cascadeRates.excess?.rate || 0;

          // Calculate prime frontage (first X feet)
          const primeFF = Math.min(frontFeet, primeMax);
          const excessFF = Math.max(0, frontFeet - primeMax);

          // Calculate raw frontage value (BEFORE depth multiplier)
          const primeValue = primeFF * primeRate;
          const excessValue = excessFF * excessRate;
          const rawValue = primeValue + excessValue;

          // Apply depth multiplier to total
          const totalValue = rawValue * depthFactor;

          debug(`FF calc for ${frontFeet}' x ${depth}': Zone ${zone}, Depth factor ${depthFactor.toFixed(2)}, Prime: ${primeFF}' x $${primeRate} = $${primeValue.toFixed(0)}` +
            (excessFF > 0 ? `, Excess: ${excessFF}' x $${excessRate} = $${excessValue.toFixed(0)}` : '') +
            `, Raw: $${rawValue.toFixed(0)} x ${depthFactor.toFixed(2)} = $${totalValue.toFixed(0)}`
          );

          return totalValue;
        }
      }
    }

    // SQUARE FOOT MODE - Added support
    if (valuationMode === 'sf') {
      const sqFeet = typeof acresOrProperty === 'number' ? acresOrProperty :
                     (acresOrProperty?.market_manual_lot_sf ? parseFloat(acresOrProperty.market_manual_lot_sf) : 0);

      if (sqFeet > 0 && cascadeRates.standard) {
        const standardRate = cascadeRates.standard.rate || 0;
        const standardMax = cascadeRates.standard.max || 5000;
        const excessRate = cascadeRates.excess?.rate || 0;

        const standardSF = Math.min(sqFeet, standardMax);
        const excessSF = Math.max(0, sqFeet - standardMax);

        const standardValue = standardSF * standardRate;
        const excessValue = excessSF * excessRate;
        const rawLandValue = standardValue + excessValue;

        debug(`SF calc for ${sqFeet} sq ft: Standard: ${standardSF} SF x $${standardRate} = $${standardValue.toFixed(0)}` +
          (excessSF > 0 ? `, Excess: ${excessSF} SF x $${excessRate} = $${excessValue.toFixed(0)}` : '') +
          ` = $${rawLandValue.toFixed(0)}`);

        return rawLandValue;
      }
    }

    // Fall back to acreage-based calculation
    const acres = typeof acresOrProperty === 'number' ? acresOrProperty :
                  (acresOrProperty?.market_manual_lot_acre ? parseFloat(acresOrProperty.market_manual_lot_acre) :
                   parseFloat(calculateAcreage(acresOrProperty)));
    let remainingAcres = acres;
    let rawLandValue = 0;
    const breakdown = [];

    // TIER 1: First acre at prime rate ($15,000)
    if (cascadeRates.prime && remainingAcres > 0) {
      const tier1Acres = Math.min(remainingAcres, 1);
      const tier1Value = tier1Acres * (cascadeRates.prime.rate || 0);
      rawLandValue += tier1Value;
      remainingAcres -= tier1Acres;
      breakdown.push(`Tier 1 (0-1 acre): ${tier1Acres.toFixed(2)} × $${cascadeRates.prime.rate || 0} = $${tier1Value.toFixed(0)}`);
    }

    // TIER 2: Acres 1-5 at secondary rate ($10,000) - that's 4 acres total
    if (cascadeRates.secondary && remainingAcres > 0) {
      const tier2Acres = Math.min(remainingAcres, 4); // Only 4 acres in this tier (1-5)
      const tier2Value = tier2Acres * (cascadeRates.secondary.rate || 0);
      rawLandValue += tier2Value;
      remainingAcres -= tier2Acres;
      breakdown.push(`Tier 2 (1-5 acres): ${tier2Acres.toFixed(2)} �� $${cascadeRates.secondary.rate || 0} = $${tier2Value.toFixed(0)}`);
    }

    // TIER 3: All remaining acres above 5 at excess rate ($5,000)
    if (cascadeRates.excess && remainingAcres > 0) {
      const tier3Value = remainingAcres * (cascadeRates.excess.rate || 0);
      rawLandValue += tier3Value;
      breakdown.push(`Tier 3 (>5 acres): ${remainingAcres.toFixed(2)} × $${cascadeRates.excess.rate || 0} = $${tier3Value.toFixed(0)}`);
      remainingAcres = 0;
    }

    debug(`������ Raw land calculation for ${acres} acres:`, breakdown.join(' + '), `= $${rawLandValue.toFixed(0)}`);

    return rawLandValue;
  };



  // Available region options for dropdowns: built-in + custom special regions defined in cascadeConfig
  const regionOptions = useMemo(() => {
    const set = new Set(SPECIAL_REGIONS || []);
    try {
      Object.keys(cascadeConfig.special || {}).forEach(r => { if (r) set.add(r); });
    } catch (e) {}
    Object.values(specialRegions || {}).forEach(r => { if (r) set.add(r); });
    return Array.from(set);
  }, [cascadeConfig.special, specialRegions]);

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
    const avgNormTimeLotSize = {};
    const avgActualPriceLotSize = {};

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
        avgNormTimeLotSize[prop.new_vcs] = [];
        avgActualPriceLotSize[prop.new_vcs] = [];
      }
      
      counts[prop.new_vcs].total++;

      // Count by property class
      if (prop.property_m4_class === '2' || prop.property_m4_class === '3A') {
        counts[prop.new_vcs].residential++;
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

      // Avg Price (t) Lot Size: ALL properties with time-normalized values (no date filter, no sales requirement)
      if (prop.values_norm_time > 0) {
        avgNormTime[prop.new_vcs].push(prop.values_norm_time);

        // Collect lot size based on valuation mode
        if (valuationMode === 'sf') {
          if (prop.market_manual_lot_sf && parseFloat(prop.market_manual_lot_sf) > 0) {
            avgNormTimeLotSize[prop.new_vcs].push(parseFloat(prop.market_manual_lot_sf));
          } else if (prop.market_manual_lot_acre && parseFloat(prop.market_manual_lot_acre) > 0) {
            // Fallback: convert acres to SF (1 acre = 43,560 SF)
            const lotSF = parseFloat(prop.market_manual_lot_acre) * 43560;
            avgNormTimeLotSize[prop.new_vcs].push(lotSF);
          }
        } else if (valuationMode === 'acre' && prop.market_manual_lot_acre && parseFloat(prop.market_manual_lot_acre) > 0) {
          avgNormTimeLotSize[prop.new_vcs].push(parseFloat(prop.market_manual_lot_acre));
        } else if (valuationMode === 'ff' && prop.asset_lot_frontage && parseFloat(prop.asset_lot_frontage) > 0) {
          avgNormTimeLotSize[prop.new_vcs].push(parseFloat(prop.asset_lot_frontage));
        }
      }

      // Avg Price Lot Size: Recent sales with valid NU codes + CSP-PSP-HSP time range
      if (prop.sales_date && prop.values_norm_time > 0) {
        const saleDate = new Date(prop.sales_date);
        const salesRange = getSalesPeriodRange();

        // Sales from HSP start (10/1 three years prior) through CSP end (or present if past due)
        if (saleDate >= salesRange.start && saleDate <= salesRange.end) {
          if (prop.values_norm_size > 0) avgNormSize[prop.new_vcs].push(prop.values_norm_size);

          // Avg Price: Valid NU codes + time constraint
          const nu = prop.sales_nu || '';
          const validNu = !nu || nu === '' || nu === ' ' || nu === '00' || nu === '07' ||
                         nu === '7' || nu.charCodeAt(0) === 32;
          if (validNu) {
            avgActualPrice[prop.new_vcs].push(prop.values_norm_time);

            // Collect lot size based on valuation mode
            if (valuationMode === 'sf') {
              if (prop.market_manual_lot_sf && parseFloat(prop.market_manual_lot_sf) > 0) {
                avgActualPriceLotSize[prop.new_vcs].push(parseFloat(prop.market_manual_lot_sf));
              } else if (prop.market_manual_lot_acre && parseFloat(prop.market_manual_lot_acre) > 0) {
                // Fallback: convert acres to SF (1 acre = 43,560 SF)
                const lotSF = parseFloat(prop.market_manual_lot_acre) * 43560;
                avgActualPriceLotSize[prop.new_vcs].push(lotSF);
              }
            } else if (valuationMode === 'acre' && prop.market_manual_lot_acre && parseFloat(prop.market_manual_lot_acre) > 0) {
              avgActualPriceLotSize[prop.new_vcs].push(parseFloat(prop.market_manual_lot_acre));
            } else if (valuationMode === 'ff' && prop.asset_lot_frontage && parseFloat(prop.asset_lot_frontage) > 0) {
              avgActualPriceLotSize[prop.new_vcs].push(parseFloat(prop.asset_lot_frontage));
            }
          }
        }
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
    const calculatedAvgNormTimeLotSize = {};
    const calculatedAvgPriceLotSize = {};

    // Loop through ALL VCS from counts (not just those with zoning)
    Object.keys(counts).forEach(vcs => {
      // Format zoning if available
      formattedZoning[vcs] = zoning[vcs] ? Array.from(zoning[vcs]).sort().join(', ') : '';

      // Format map pages (e.g., "12-15, 18, 22-24")
      const pages = mapPages[vcs] ? Array.from(mapPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b) : [];
      formattedMapPages[vcs] = formatPageRanges(pages);

      const keys = keyPages[vcs] ? Array.from(keyPages[vcs]).map(p => parseInt(p)).filter(p => !isNaN(p)).sort((a, b) => a - b) : [];
      formattedKeyPages[vcs] = formatPageRanges(keys);

      // Calculate averages
      calculatedAvgNormTime[vcs] = avgNormTime[vcs] && avgNormTime[vcs].length > 0 ?
        Math.round(avgNormTime[vcs].reduce((sum, v) => sum + v, 0) / avgNormTime[vcs].length) : null;
      calculatedAvgNormSize[vcs] = avgNormSize[vcs] && avgNormSize[vcs].length > 0 ?
        Math.round(avgNormSize[vcs].reduce((sum, v) => sum + v, 0) / avgNormSize[vcs].length) : null;
      calculatedAvgPrice[vcs] = avgActualPrice[vcs] && avgActualPrice[vcs].length > 0 ?
        Math.round(avgActualPrice[vcs].reduce((sum, v) => sum + v, 0) / avgActualPrice[vcs].length) : null;
      calculatedAvgNormTimeLotSize[vcs] = avgNormTimeLotSize[vcs] && avgNormTimeLotSize[vcs].length > 0 ?
        (avgNormTimeLotSize[vcs].reduce((sum, v) => sum + v, 0) / avgNormTimeLotSize[vcs].length) : null;
      calculatedAvgPriceLotSize[vcs] = avgActualPriceLotSize[vcs] && avgActualPriceLotSize[vcs].length > 0 ?
        (avgActualPriceLotSize[vcs].reduce((sum, v) => sum + v, 0) / avgActualPriceLotSize[vcs].length) : null;

      // Lot size collection complete for this VCS

    });

    setVcsPropertyCounts(counts);
    setVcsZoningData(formattedZoning);

    // Calculate recommended site values for VCS Sheet
    console.log('��� Calling calculateVCSRecommendedSites with:', {
      sampleVCS: Object.keys(calculatedAvgNormTime).slice(0, 5),
      vcs3658: calculatedAvgNormTime['3658'],
      vcs3658Counts: counts['3658']
    });
    calculateVCSRecommendedSites(calculatedAvgPrice, calculatedAvgNormTime, counts, calculatedAvgPriceLotSize);
    
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
        avgPrice: calculatedAvgPrice[vcs],
        avgNormTimeLotSize: calculatedAvgNormTimeLotSize[vcs],
        avgPriceLotSize: calculatedAvgPriceLotSize[vcs]
      };
    });

    setVcsSheetData(sheetData);
  }, [properties, valuationMode]);

  const calculateVCSRecommendedSites = useCallback((avgPrices, avgNormTimes, counts, avgPriceLotSizes) => {
    console.log('🔍 calculateVCSRecommendedSites called:', {
      targetAllocation,
      hasCascadePrime: !!cascadeConfig.normal.prime,
      avgPricesKeys: Object.keys(avgPrices || {}).slice(0, 5),
      avgNormTimesKeys: Object.keys(avgNormTimes || {}).slice(0, 5),
      countsKeys: Object.keys(counts || {}).slice(0, 5)
    });

    if (!targetAllocation || !cascadeConfig.normal.prime) {
      console.warn('���️ Skipping Rec Site calculation - missing:', {
        targetAllocation,
        hasCascadePrime: !!cascadeConfig.normal.prime
      });
      return;
    }

    const recommendedSites = {};

    Object.keys(avgNormTimes).forEach(vcs => {
      // Only calculate for residential OR condo VCS
      if (counts[vcs].residential === 0 && counts[vcs].condo === 0) return;

      // Prioritize Avg Price (recent sales) over Avg Price (t) (time-adjusted)
      const avgPrice = avgPrices[vcs] || avgNormTimes[vcs];
      if (!avgPrice) return;

      // Check if this VCS Type contains "condo"
      const vcsType = vcsTypes[vcs] || '';
      const isCondo = vcsType.toLowerCase().includes('condo');

      if (isCondo) {
        // For condos: Rec Site = Target Allocation % × Avg Price (no land dimensions needed)
        const siteValue = avgPrice * (parseFloat(targetAllocation) / 100);
        console.log(`🏢 CONDO VCS ${vcs}:`, {
          vcsType,
          avgPrice,
          usedAvgPrice: !!avgPrices[vcs],
          targetAllocation,
          siteValue
        });
        recommendedSites[vcs] = siteValue;
        return;
      }

      // Get VCS-specific cascade rates (with any user overrides applied)
      const vcsRates = getVCSCascadeRates(vcs, cascadeConfig.normal);

      // Get average lot size for this VCS using appropriate pre-calculated field based on mode
      let vcsProps, avgSize, rawLandValue;

      if (valuationMode === 'sf') {
        // Square Foot mode: use pre-calculated average lot size from avgPriceLotSizes
        // This matches what's displayed in the "Avg Price Lot Size" column
        avgSize = avgPriceLotSizes?.[vcs];
        if (!avgSize || avgSize <= 0) {
          console.warn(`⚠️ No average price lot size available for VCS ${vcs} in SF mode`);
          return;
        }
        rawLandValue = calculateRawLandValue(avgSize, vcsRates);
      } else if (valuationMode === 'ff') {
        // Front Foot mode: use pre-calculated average frontage from avgPriceLotSizes
        // This matches what's displayed in the "Avg Price Lot Size" column
        const avgFrontage = avgPriceLotSizes?.[vcs];
        if (!avgFrontage || avgFrontage <= 0) {
          console.warn(`⚠️ No average price frontage available for VCS ${vcs} in FF mode`);
          return;
        }
        // Still need to calculate average depth from class 2/3A properties
        vcsProps = properties.filter(p =>
          p.new_vcs === vcs &&
          (p.property_m4_class === '2' || p.property_m4_class === '3A') &&
          p.asset_lot_depth && parseFloat(p.asset_lot_depth) > 0
        );
        const avgDepth = vcsProps.length > 0
          ? vcsProps.reduce((sum, p) => sum + parseFloat(p.asset_lot_depth || 100), 0) / vcsProps.length
          : 100; // Default depth if no data
        rawLandValue = calculateRawLandValue(null, vcsRates, {
          land_front_feet: avgFrontage,
          land_depth: avgDepth,
          land_zoning: vcsProps[0]?.asset_zoning
        });
      } else {
        // Acre mode: use pre-calculated average lot size from avgPriceLotSizes
        // This matches what's displayed in the "Avg Price Lot Size" column
        avgSize = avgPriceLotSizes?.[vcs];
        if (!avgSize || avgSize <= 0) {
          console.warn(`⚠️ No average price lot size available for VCS ${vcs} in Acre mode`);
          return;
        }
        rawLandValue = calculateRawLandValue(avgSize, vcsRates);
      }

      // Calculate site value using target allocation
      // Use Avg Price if available, otherwise Avg Price (t)
      const totalLandValue = avgPrice * (parseFloat(targetAllocation) / 100);
      const siteValue = totalLandValue - rawLandValue;

      recommendedSites[vcs] = siteValue; // No rounding - store exact value
    });

    setVcsRecommendedSites(recommendedSites);
  }, [targetAllocation, cascadeConfig, properties, calculateAcreage, calculateRawLandValue, vcsTypes, getVCSCascadeRates]);


  const calculateVCSRecommendedSitesWithTarget = useCallback(() => {
    debug('🚀 calculateVCSRecommendedSitesWithTarget CALLED!');
    debug('������� Input validation:', {
      hasTargetAllocation: !!targetAllocation,
      targetAllocationValue: targetAllocation,
      hasCascadeRates: !!cascadeConfig.normal.prime,
      cascadePrimeRate: cascadeConfig.normal.prime?.rate,
      hasProperties: !!properties,
      propertiesCount: properties?.length || 0
    });

    if (!targetAllocation || !cascadeConfig.normal.prime || !properties) {
      debug('❌ Cannot calculate VCS recommended sites: missing data');
      return;
    }

    debug('����� Calculating VCS recommended site values with target allocation:', targetAllocation + '%');

    const recommendedSites = {};
    const salesRange = getSalesPeriodRange();

    // Get all VCS from properties
    const allVCS = new Set(properties.map(p => p.new_vcs).filter(vcs => vcs));

    allVCS.forEach(vcs => {
      // Only calculate for VCS with residential OR condo properties
      const residentialProps = properties.filter(p =>
        p.new_vcs === vcs &&
        (p.property_m4_class === '2' || p.property_m4_class === '3A')
      );

      const condoProps = properties.filter(p =>
        p.new_vcs === vcs &&
        p.property_m4_class === '4D'
      );

      if (residentialProps.length === 0 && condoProps.length === 0) return;

      // Get 3 years of relevant sales for this VCS - MATCH SQL QUERY EXACTLY
      const relevantSales = properties.filter(prop => {
        // Must match this specific VCS
        if (prop.new_vcs !== vcs) return false;

        // Residential properties only (Class 2 = Single Family, 3A = Two Family, 4D = Condo)
        if (!['2', '3A', '4D'].includes(prop.property_m4_class)) return false;

        // Valid sales data
        const hasValidSale = prop.sales_date && prop.sales_price > 0;
        if (!hasValidSale) return false;

        // Sales within CSP-PSP-HSP range (HSP start through CSP end or present)
        const saleDate = new Date(prop.sales_date);
        const isWithinRange = saleDate >= salesRange.start && saleDate <= salesRange.end;
        if (!isWithinRange) return false;

        // Valid asset type use starting with '1' (residential) - skip for condos
        const isCondo = prop.property_m4_class === '4D';
        if (!isCondo) {
          if (!prop.asset_type_use) return false;
          const typeUseStr = prop.asset_type_use.toString().trim();
          const hasValidTypeUse = typeUseStr.startsWith('1') || typeUseStr.startsWith('01');
          if (!hasValidTypeUse) return false;
        }

        // Valid NU codes (blank, '7', '07', '00', or space) - MATCH SQL EXACTLY
        const nu = prop.sales_nu;
        const validNu = !nu ||
                       nu.trim() === '' ||
                       nu.trim() === '7' ||
                       nu.trim() === '07' ||
                       nu.trim() === '00';
        if (!validNu) return false;

        return true;
      });

      if (relevantSales.length === 0) {
        debug(`⚠️ No relevant sales found for VCS ${vcs} in past 3 years`);
        return;
      }

      // Calculate average sale price from relevant sales
      const avgSalePrice = relevantSales.reduce((sum, p) => sum + (p.values_norm_time || p.sales_price), 0) / relevantSales.length;

      // Check if this VCS is a condo type
      const vcsType = vcsTypes[vcs] || 'Residential-Typical';
      const isCondo = vcsType.toLowerCase().includes('condo');

      let siteValue;

      if (isCondo) {
        // For condos: recommended site = target allocation % × average sale price
        siteValue = avgSalePrice * (parseFloat(targetAllocation) / 100);
        debug(`🏢 VCS ${vcs} (CONDO):`, {
          relevantSalesCount: relevantSales.length,
          avgSalePrice: Math.round(avgSalePrice),
          targetAllocation: targetAllocation + '%',
          recommendedSiteValue: Math.round(siteValue),
          note: 'No lot size calculation for condos'
        });
      } else {
        // For regular properties: calculate with lot size and cascade rates respecting valuation mode
        const totalLandValue = avgSalePrice * (parseFloat(targetAllocation) / 100);
        let avgSize, rawLandValue, salesWithLotData;

        if (valuationMode === 'sf') {
          // Square Foot mode: use market_manual_lot_sf
          salesWithLotData = relevantSales.filter(p => p.market_manual_lot_sf && parseFloat(p.market_manual_lot_sf) > 0);
          if (salesWithLotData.length === 0) {
            console.warn(`���️ VCS ${vcs}: No sales with market_manual_lot_sf data (${relevantSales.length} total sales)`);
            return;
          }
          avgSize = salesWithLotData.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_sf), 0) / salesWithLotData.length;
          rawLandValue = calculateRawLandValue(avgSize, cascadeConfig.normal);

        } else if (valuationMode === 'ff') {
          // Front Foot mode: use frontage data
          salesWithLotData = relevantSales.filter(p => p.asset_lot_frontage && parseFloat(p.asset_lot_frontage) > 0);
          if (salesWithLotData.length === 0) {
            console.warn(`⚠️ VCS ${vcs}: No sales with frontage data (${relevantSales.length} total sales)`);
            return;
          }
          const avgFrontage = salesWithLotData.reduce((sum, p) => sum + parseFloat(p.asset_lot_frontage), 0) / salesWithLotData.length;
          const avgDepth = salesWithLotData.reduce((sum, p) => sum + parseFloat(p.asset_lot_depth || 100), 0) / salesWithLotData.length;
          avgSize = avgFrontage;
          rawLandValue = calculateRawLandValue(null, cascadeConfig.normal, {
            land_front_feet: avgFrontage,
            land_depth: avgDepth,
            land_zoning: salesWithLotData[0]?.asset_zoning
          });

        } else {
          // Acre mode: use market_manual_lot_acre
          salesWithLotData = relevantSales.filter(p => p.market_manual_lot_acre && parseFloat(p.market_manual_lot_acre) > 0);
          if (salesWithLotData.length === 0) {
            console.warn(`⚠��� VCS ${vcs}: No sales with market_manual_lot_acre data (${relevantSales.length} total sales)`);
            return;
          }
          avgSize = salesWithLotData.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_acre), 0) / salesWithLotData.length;
          rawLandValue = calculateRawLandValue(avgSize, cascadeConfig.normal);

        }

        siteValue = totalLandValue - rawLandValue;

        debug(`🏠 VCS ${vcs} DETAILED DEBUG (${valuationMode.toUpperCase()} mode):`, {
          relevantSalesCount: relevantSales.length,
          salesWithLotData: salesWithLotData?.length || 0,
          avgSalePrice: Math.round(avgSalePrice),
          avgSize: typeof avgSize === 'number' ? avgSize.toFixed(2) : avgSize,
          targetAllocation: targetAllocation + '%',
          targetAllocationDecimal: parseFloat(targetAllocation) / 100,
          totalLandValue: Math.round(totalLandValue),
          rawLandValue: Math.round(rawLandValue),
          recommendedSiteValue: Math.round(siteValue),
          cascadeRates: cascadeConfig.normal,
          formula: `${Math.round(avgSalePrice)} * ${(parseFloat(targetAllocation) / 100).toFixed(3)} - ${Math.round(rawLandValue)} = ${Math.round(siteValue)}`
        });
      }

      recommendedSites[vcs] = siteValue; // No rounding - store exact value
    });

    setVcsRecommendedSites(recommendedSites);
    debug('✅ VCS recommended site values updated:', Object.keys(recommendedSites).length, 'VCS areas');

  }, [targetAllocation, cascadeConfig, properties, calculateAcreage, calculateRawLandValue, vcsTypes]);

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
    debug(`���� Updating manual site value for VCS ${vcs}:`, value);
    setVcsManualSiteValues(prev => ({
      ...prev,
      // Fix: Use nullish coalescing - allow 0 values, only null for empty strings
      [vcs]: value === '' ? null : parseInt(value) || 0
    }));

    // Immediate save to prevent data loss when navigating away
    debug('����� Triggering immediate save for Act Site change');
    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 500); // Short delay to batch multiple rapid changes
  };

  const updateVCSDescription = (vcs, description) => {
    // Update local state immediately to allow freeform editing
    setVcsDescriptions(prev => ({
      ...prev,
      [vcs]: description
    }));

    // Trigger autosave to persist the description
    debug('💾 Triggering autosave for VCS description change');
    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 1000); // 1 second delay to batch rapid typing
  };


  const updateVCSType = (vcs, type) => {
    setVcsTypes(prev => ({
      ...prev,
      [vcs]: type
    }));

    // Trigger autosave to persist the type change
    debug('💾 Triggering autosave for VCS type change');
    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 500);
  };

  const updateVCSMethod = (vcs, method) => {
    setVcsMethodOverrides(prev => ({
      ...prev,
      [vcs]: method
    }));

    // Trigger autosave to persist the method change
    debug('💾 Triggering autosave for VCS method change');
    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 500);
  };

  const updateVCSRate = (vcs, tier, value) => {
    setVcsRateOverrides(prev => ({
      ...prev,
      [vcs]: {
        ...(prev[vcs] || {}),
        [tier]: value ? parseFloat(value) : null
      }
    }));

    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 500);
  };

  const updateVCSStepdown = (vcs, value) => {
    setVcsStepdownOverrides(prev => ({
      ...prev,
      [vcs]: value ? parseFloat(value) : null
    }));

    setTimeout(() => {
      if (window.landValuationSave) {
        window.landValuationSave({ source: 'autosave' });
      }
    }, 500);
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

    debug('🔍 Economic Obsolescence Analysis Debug:', {
      totalProperties: properties.length,
      withNewVCS: properties.filter(p => p.new_vcs).length,
      withLocationAnalysis: properties.filter(p => p.location_analysis).length,
      withSalesData: properties.filter(p => p.values_norm_time && p.values_norm_time > 0).length,  // FIXED: Use values_norm_time
      withVCSOnly: properties.filter(p => p.new_vcs && !p.location_analysis).length,
      withVCSAndLocation: properties.filter(p => p.new_vcs && p.location_analysis).length,
      withAllThree: properties.filter(p => p.new_vcs && p.location_analysis && p.values_norm_time && p.values_norm_time > 0).length,  // FIXED: Use values_norm_time
      uniqueVCSCodes: [...new Set(properties.filter(p => p.new_vcs).map(p => p.new_vcs))],
      samplePropertiesWithVCS: properties.filter(p => p.new_vcs).slice(0, 5).map(p => ({
        new_vcs: p.new_vcs,
        location_analysis: p.location_analysis,
        sales_price: p.sales_price,
        address: p.property_location
      }))
    });

    const factors = {};
    const computed = {};

    // Create pivot table: Group properties by VCS and location_analysis (like Excel pivot table)
    properties.forEach(prop => {
      // Must have VCS and valid location_analysis to appear in the table (exclude null/none/empty)
      if (!prop.new_vcs || !prop.location_analysis ||
          prop.location_analysis.trim() === '' ||
          prop.location_analysis.toLowerCase().includes('none') ||
          prop.location_analysis.toLowerCase().includes('no analysis')) {
        return;
      }

      const vcs = prop.new_vcs;
      const locationAnalysis = prop.location_analysis.trim();

      // Use the actual location_analysis as the key (no dynamic code generation)
      setLocationCodes(prev => ({...prev, [prop.id]: locationAnalysis}));
      
      if (!factors[vcs]) {
        factors[vcs] = {};
      }

      if (!factors[vcs][locationAnalysis]) {
        factors[vcs][locationAnalysis] = {
          withFactor: [],
          withoutFactor: []
        };
      }

      // Add all properties to build VCS structure, but only include sales data if available
      // FIXED: Use values_norm_time instead of sales_price to include $1 sales
      const hasSalesData = prop.values_norm_time && prop.values_norm_time > 0;

      if (hasSalesData) {
        factors[vcs][locationAnalysis].withFactor.push({
          id: prop.id,
          price: prop.values_norm_time,  // Use values_norm_time as primary price
          normalizedTime: prop.values_norm_time,
          normalizedSize: prop.values_norm_size || prop.values_norm_time,  // fallback to norm_time if norm_size missing,
          acres: parseFloat(calculateAcreage(prop)),
          address: prop.property_location,
          year: prop.asset_year_built,
          yearSold: prop.sales_date ? new Date(prop.sales_date).getFullYear() : null,
          typeUse: prop.asset_type_use,
          design: prop.asset_design_style,
          sfla: parseFloat(prop.asset_sfla || 0)
        });
      }
    });

    // Find comparable sales without location factors for each VCS
    Object.keys(factors).forEach(vcs => {
      // Get baseline sales (no location factors - properties with same VCS but no location_analysis)
      // CRITICAL FIX: Use values_norm_time > 0 instead of sales_price > 0 to include $1 sales
      const baselineSales = properties.filter(prop =>
        prop.new_vcs === vcs &&
        (!prop.location_analysis || prop.location_analysis.trim() === '' ||
         prop.location_analysis.toLowerCase().includes('none') ||
         prop.location_analysis.toLowerCase().includes('no analysis')) &&
        prop.values_norm_time && prop.values_norm_time > 0  // FIXED: Check values_norm_time instead of sales_price
      ).map(prop => ({
        id: prop.id,
        price: prop.values_norm_time,  // USE values_norm_time as primary price
        normalizedTime: prop.values_norm_time,
        normalizedSize: prop.values_norm_size || prop.values_norm_time,  // fallback to norm_time
        acres: parseFloat(calculateAcreage(prop)),
        year: prop.asset_year_built,
        yearSold: new Date(prop.sales_date).getFullYear(),
        typeUse: prop.asset_type_use,
        design: prop.asset_design_style,
        sfla: parseFloat(prop.asset_sfla || 0)
      }));

      // Store baseline for all location analyses in this VCS
      Object.keys(factors[vcs]).forEach(locationAnalysis => {
        factors[vcs][locationAnalysis].withoutFactor = baselineSales;
      });
    });

    debug('📊 Economic Obsolescence Analysis Complete:', {
      totalVCSCodes: Object.keys(factors).length,
      vcsCodesWithFactors: Object.keys(factors).map(vcs => ({
        vcs,
        factorTypes: Object.keys(factors[vcs]),
        totalFactorTypes: Object.keys(factors[vcs]).length,
        propertiesPerFactor: Object.keys(factors[vcs]).map(code => ({
          code,
          withFactorCount: factors[vcs][code].withFactor.length,
          withoutFactorCount: factors[vcs][code].withoutFactor.length
        }))
      })),
      allFactors: factors,
      totalPropertiesProcessed: Object.values(factors).reduce((total, vcsFactors) => {
        return total + Object.values(vcsFactors).reduce((vcsTotal, factor) => {
          return vcsTotal + factor.withFactor.length;
        }, 0);
      }, 0)
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

  const updateGlobalEcoObsTypeFilter = (typeUse) => {
    setGlobalEcoObsTypeFilter(typeUse);
  };

  const calculateEcoObsImpact = useCallback((vcs, codes, typeUse = null) => {
    if (!ecoObsFactors[vcs] || !ecoObsFactors[vcs][codes]) return null;

    let withFactor = ecoObsFactors[vcs][codes].withFactor;
    let withoutFactor = ecoObsFactors[vcs][codes].withoutFactor;

    // Use global filter if no specific type use provided
    const effectiveTypeUse = typeUse || globalEcoObsTypeFilter;

    // Filter by type use if specified and not 'all'
    if (effectiveTypeUse && effectiveTypeUse !== 'all') {
      // Support Single Family umbrella (both '1' and '10')
      if (effectiveTypeUse === '1') {
        withFactor = withFactor.filter(p => p.typeUse === '1' || p.typeUse === '10');
        withoutFactor = withoutFactor.filter(p => p.typeUse === '1' || p.typeUse === '10');
      } else {
        withFactor = withFactor.filter(p => p.typeUse === effectiveTypeUse);
        withoutFactor = withoutFactor.filter(p => p.typeUse === effectiveTypeUse);
      }
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
    
    // Return partial data even if we can't calculate full impact
    if (withFactor.length === 0 && withoutFactor.length === 0) return null;

    // If we only have one side of the comparison, show what we have
    if (withFactor.length === 0) {
      const avgWithoutTime = withoutFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withoutFactor.length;
      const avgWithoutYear = Math.round(withoutFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withoutFactor.length);
      const withoutFactorSFLA = withoutFactor.filter(s => s.sfla && s.sfla > 0);
      const avgWithoutLivingArea = withoutFactorSFLA.length > 0 ?
        Math.round(withoutFactorSFLA.reduce((sum, s) => sum + s.sfla, 0) / withoutFactorSFLA.length) : 0;

      return {
        withCount: 0,
        withYearBuilt: 0,
        withLivingArea: 0,
        withSalePrice: 0,
        withoutCount: withoutFactor.length,
        withoutYearBuilt: avgWithoutYear,
        withoutLivingArea: avgWithoutLivingArea,
        withoutSalePrice: Math.round(avgWithoutTime),
        adjustedSaleWith: 0,
        adjustedSaleWithout: Math.round(avgWithoutTime), // No adjustment possible without "with" data
        dollarImpact: 0,
        percentImpact: 'N/A',
        withNormTime: 0,
        withoutNormTime: avgWithoutTime,
        impact: 'N/A'
      };
    }

    if (withoutFactor.length === 0) {
      const avgWithTime = withFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withFactor.length;
      const avgWithYear = Math.round(withFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withFactor.length);
      const withFactorSFLA = withFactor.filter(s => s.sfla && s.sfla > 0);
      const avgWithLivingArea = withFactorSFLA.length > 0 ?
        Math.round(withFactorSFLA.reduce((sum, s) => sum + s.sfla, 0) / withFactorSFLA.length) : 0;

      return {
        withCount: withFactor.length,
        withYearBuilt: avgWithYear,
        withLivingArea: avgWithLivingArea,
        withSalePrice: Math.round(avgWithTime),
        withoutCount: 0,
        withoutYearBuilt: 0,
        withoutLivingArea: 0,
        withoutSalePrice: 0,
        adjustedSaleWith: Math.round(avgWithTime), // No adjustment possible without "without" data
        adjustedSaleWithout: 0,
        dollarImpact: 0,
        percentImpact: 'No baseline',
        withNormTime: avgWithTime,
        withoutNormTime: 0,
        impact: 'No baseline'
      };
    }
    
    // Calculate detailed averages using values_norm_time specifically
    const avgWithTime = withFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withFactor.length;
    const avgWithYear = Math.round(withFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withFactor.length);

    // Get living area averages (SFLA from property data)
    const withFactorSFLA = withFactor.filter(s => s.sfla && s.sfla > 0);
    const avgWithLivingArea = withFactorSFLA.length > 0 ?
      Math.round(withFactorSFLA.reduce((sum, s) => sum + s.sfla, 0) / withFactorSFLA.length) : 0;

    const avgWithoutTime = withoutFactor.reduce((sum, s) => sum + s.normalizedTime, 0) / withoutFactor.length;
    const avgWithoutYear = Math.round(withoutFactor.reduce((sum, s) => sum + (s.year || 0), 0) / withoutFactor.length);

    const withoutFactorSFLA = withoutFactor.filter(s => s.sfla && s.sfla > 0);
    const avgWithoutLivingArea = withoutFactorSFLA.length > 0 ?
      Math.round(withoutFactorSFLA.reduce((sum, s) => sum + s.sfla, 0) / withoutFactorSFLA.length) : 0;

    // Calculate size-adjusted sale prices using your magic formula
    // Average size between "with" and "without" groups
    const averageSize = (avgWithLivingArea + avgWithoutLivingArea) / 2;

    // Size adjustment formula: adjusted sale = sale price + ((average size - actual size) * (price per sqft) * 0.5)
    const adjustedSaleWith = avgWithLivingArea > 0 ?
      Math.round(avgWithTime + ((averageSize - avgWithLivingArea) * (avgWithTime / avgWithLivingArea) * 0.5)) :
      Math.round(avgWithTime);

    const adjustedSaleWithout = avgWithoutLivingArea > 0 ?
      Math.round(avgWithoutTime + ((averageSize - avgWithoutLivingArea) * (avgWithoutTime / avgWithoutLivingArea) * 0.5)) :
      Math.round(avgWithoutTime);

    // Calculate dollar and percent impact using adjusted prices
    const dollarImpact = adjustedSaleWith - adjustedSaleWithout;
    const percentImpact = adjustedSaleWithout > 0 ? ((adjustedSaleWith - adjustedSaleWithout) / adjustedSaleWithout) * 100 : 0;

    return {
      withCount: withFactor.length,
      withYearBuilt: avgWithYear,
      withLivingArea: avgWithLivingArea,
      withSalePrice: Math.round(avgWithTime), // values_norm_time
      withoutCount: withoutFactor.length,
      withoutYearBuilt: avgWithoutYear,
      withoutLivingArea: avgWithoutLivingArea,
      withoutSalePrice: Math.round(avgWithoutTime), // values_norm_time
      adjustedSaleWith: adjustedSaleWith,
      adjustedSaleWithout: adjustedSaleWithout,
      dollarImpact: dollarImpact,
      percentImpact: percentImpact.toFixed(1),
      // Legacy fields for compatibility
      withNormTime: Math.round(avgWithTime),
      withoutNormTime: Math.round(avgWithoutTime),
      impact: percentImpact.toFixed(1)
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

  // ========== SAVE TARGET ALLOCATION FUNCTION ==========
  const saveTargetAllocation = async () => {
    if (!jobData?.id) {
      debug('���� Save target allocation cancelled: No job ID');
      alert('Error: No job ID found. Cannot save target allocation.');
      return;
    }

    if (!targetAllocation || targetAllocation === '') {
      debug('❌ Save target allocation cancelled: No target allocation value');
      alert('Please enter a target allocation percentage before saving.');
      return;
    }

    const targetValue = parseFloat(targetAllocation);
    if (isNaN(targetValue) || targetValue <= 0 || targetValue > 100) {
      debug('���� Save target allocation cancelled: Invalid value:', targetAllocation);
      alert('Please enter a valid target allocation percentage between 1 and 100.');
      return;
    }

    debug('���� Saving target allocation:', `${targetValue}%`, 'for job:', jobData.id);

    try {
      // Check if record exists first
      const { data: existing, error: checkError } = await supabase
        .from('market_land_valuation')
        .select('id, target_allocation, allocation_study')
        .eq('job_id', jobData.id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('❌ Error checking for existing record:', checkError);
        throw checkError;
      }

      let result;
      if (existing) {
        debug('���� Updating existing record with target allocation...');
        result = await supabase
          .from('market_land_valuation')
          .update({
            target_allocation: targetValue,
            updated_at: new Date().toISOString()
          })
          .eq('job_id', jobData.id);
      } else {
        debug('��� Creating new record with target allocation...');
        result = await supabase
          .from('market_land_valuation')
          .insert({
            job_id: jobData.id,
            target_allocation: targetValue,
            updated_at: new Date().toISOString()
          });
      }

      if (result.error) {
        console.error('❌ Database error saving target allocation:', result.error);
        throw result.error;
      }

      debug('�� Target allocation saved successfully to database');

      // Update last saved timestamp
      setLastSaved(new Date());

      // Set flag to prevent overwrites during re-initialization
      setTargetAllocationJustSaved(true);
      setTimeout(() => setTargetAllocationJustSaved(false), 5000); // Clear flag after 5 seconds

      // Show success feedback
      alert(`Target allocation ${targetValue}% saved successfully!`);

      // CRITICAL FIX: Trigger parent component data refresh to update marketLandData prop
      if (typeof onDataRefresh === 'function') {
        debug('��� Triggering parent component data refresh...');
        onDataRefresh();
      }

      // Trigger VCS recommended sites calculation
      debug('�� Triggering VCS recommended sites calculation...');
      if (cascadeConfig.normal.prime && properties?.length > 0) {
        calculateVCSRecommendedSitesWithTarget();
      } else {
        debug('⚠�� Cannot calculate VCS recommended sites: missing cascade config or properties');
      }

    } catch (error) {
      // Extract readable error message
      const errorMessage = error?.message || error?.error?.message || error?.details ||
                          (typeof error === 'string' ? error : JSON.stringify(error));

      console.error('❌ Error saving target allocation:', errorMessage);
      console.error('Full error object:', error);

      alert(`Failed to save target allocation: ${errorMessage}`);
    }
  };

  // ========== SAVE & EXPORT FUNCTIONS ==========
  const saveAnalysis = useCallback(async (options = {}) => {
    if (!jobData?.id) {
      debug('❌ Save cancelled: No job ID');
      return;
    }

    debug('💾 Starting save...', {
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
          excluded_vcs: Array.from(excludedMethod2VCS),
          summary: method2Summary
        },
        cascade_rates: cascadeConfig,
        target_allocation: targetAllocation,
        allocation_study: {
          vcs_site_values: vcsSiteValues,
          actual_allocations: actualAllocations,
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
          sheet_data: vcsSheetData,
          depth_table_overrides: vcsDepthTableOverrides,
          method_overrides: vcsMethodOverrides,
          rate_overrides: vcsRateOverrides,
          stepdown_overrides: vcsStepdownOverrides
        },
        eco_obs_applied_adjustments: actualAdjustments,
        eco_obs_code_config: {
          factors: ecoObsFactors,
          location_codes: mappedLocationCodes,
          traffic_levels: trafficLevels,
          custom_codes: customLocationCodes,
          summary_inputs: summaryInputs
        },
        eco_obs_compound_overrides: computedAdjustments,
        updated_at: new Date().toISOString()
      };

      // Debug: Log the exact data being saved
      debug('��������� Data structure being saved:', {
        cascadeConfigLocation1: analysisData.raw_land_config.cascade_config.specialCategories,
        cascadeConfigLocation2: analysisData.cascade_rates.specialCategories,
        salesData: analysisData.vacant_sales_analysis.sales.slice(0, 3), // First 3 for brevity
        totalSales: analysisData.vacant_sales_analysis.sales.length
      });

      // Use the same table that's used for loading: market_land_valuation
      debug('�� Saving to market_land_valuation table...');
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert(analysisData, {
          onConflict: 'job_id',
          ignoreDuplicates: false
        });

      if (error) throw error;

      debug('�� Save completed successfully');
      setLastSaved(new Date());

      // Reset auto-save failure tracking on successful save
      autoSaveFailureCount.current = 0;
      if (isAutoSaveDisabled.current) {
        isAutoSaveDisabled.current = false;
        console.log('✅ Auto-save re-enabled after successful save');
      }

      // Notify parent component
      if (onAnalysisUpdate) {
        onAnalysisUpdate(analysisData, options);
      }

      // Clear session state since changes are now persisted
      if (updateSessionState) {
        try {
          updateSessionState({
            method1ExcludedSales: new Set(),
            includedSales: new Set(),
            excludedMethod2VCS: new Set(),
            saleCategories: {},
            specialRegions: {},
            landNotes: {},
            cascadeConfig: null,
            vcsSheetData: {},
            vcsManualSiteValues: {},
            vcsDescriptions: {},
            vcsTypes: {},
            vcsRecommendedSites: {},
            vcsMethodOverrides: {},
            vcsRateOverrides: {},
            vcsStepdownOverrides: {},
            collapsedFields: {},
            hasUnsavedChanges: false,
            lastModified: null
          });
          debug('🧹 Session state cleared after successful save');
// Also clear sessionStorage to ensure complete cleanup
          try {
            sessionStorage.removeItem('landValuation_' + jobData.id + '_session');
            debug('������ Cleared session storage after successful save');
          } catch (err) {
            console.warn('Failed to clear sessionStorage:', err);
          }
        } catch (e) {
          console.warn('Failed to clear session state after save', e);
        }
      }
    } catch (error) {
      // Extract readable error message with detailed debugging
      const errorMessage = error?.message || error?.error?.message || error?.details ||
                          (typeof error === 'string' ? error : JSON.stringify(error));

      console.error('❌ Save failed:', errorMessage);
      console.error('Full error object:', error);
      console.error('Error details:', {
        errorType: typeof error,
        errorKeys: error ? Object.keys(error) : [],
        errorCode: error?.code,
        errorHint: error?.hint,
        errorDetails: error?.details,
        stackTrace: error?.stack,
        isAutoSave: options?.source === 'autosave'
      });

      // Handle auto-save failures differently (no popup alert)
      if (options?.source === 'autosave') {
        autoSaveFailureCount.current++;
        console.warn(`��️ Auto-save failed (${autoSaveFailureCount.current} consecutive failures):`, errorMessage);

        // Disable auto-save after 3 consecutive failures
        if (autoSaveFailureCount.current >= 3) {
          isAutoSaveDisabled.current = true;
          console.error('🛑 Auto-save disabled after 3 consecutive failures. Please save manually.');
          // Dispatch event for notification system if available
          try {
            window.dispatchEvent(new CustomEvent('land_valuation_autosave_failed', {
              detail: { message: 'Auto-save disabled. Please save manually.', errorMessage }
            }));
          } catch (e) {
            console.warn('Could not dispatch autosave failure event:', e);
          }
        }
        // Don't show alert for auto-save failures - just log to console
        return;
      }

      // Reset failure count on any manual save attempt
      autoSaveFailureCount.current = 0;

      // Show user-friendly error for manual saves only
      const userMessage = `Failed to save analysis: ${errorMessage}\n\n` +
        `Error type: ${error?.code || 'Unknown'}\n` +
        `Please check the console for details and try again.`;

      alert(userMessage);
    } finally {
      setIsSaving(false);
    }
  }, [
    jobData?.id, vacantSales, includedSales, method1ExcludedSales,
    saleCategories, specialRegions, landNotes, dateRange, valuationMode,
    cascadeConfig, bracketAnalysis, method2Summary, method2ExcludedSales,
    targetAllocation, vcsSiteValues, actualAllocations, currentOverallAllocation,
    vcsPropertyCounts, vcsZoningData, vcsSheetData, vcsManualSiteValues,
    vcsDescriptions, vcsTypes, vcsRecommendedSites, vcsMethodOverrides, vcsRateOverrides, vcsStepdownOverrides, ecoObsFactors,
    mappedLocationCodes, trafficLevels, customLocationCodes, summaryInputs,
    actualAdjustments, computedAdjustments, calculateRates, calculateAllocationStats,
    onAnalysisUpdate, updateSessionState
  ]);

  // Expose saveAnalysis to window for auto-save access (avoids hoisting issues)
  useEffect(() => {
    window.landValuationSave = saveAnalysis;
    return () => {
      delete window.landValuationSave;
    };
  }, [saveAnalysis]);

  // Excel export functions need to be defined before being used
  const exportVCSSheetExcel = () => {
    // Create new workbook
    const workbook = XLSX.utils.book_new();

    // Build headers array (start first row with headers only)
    const headers = ['VCS', 'Total', 'Type', 'Description', 'Method'];

    // Typical lot size headers - different for FF mode vs Acre mode
    if (valuationMode === 'ff') {
      headers.push('Typical FF', 'Typical Depth', 'Depth Table');
    } else {
      headers.push('Typical Lot Size');
    }

    // Add stepdown header for FF and SF modes
    if (valuationMode === 'ff') {
      headers.push('Stepdown (FF)');
    } else if (valuationMode === 'sf') {
      headers.push('Stepdown (SF)');
    }

    // Raw Land column comes after stepdown
    headers.push('Raw Land');

    headers.push('Rec Site Value', 'Act Site Value', 'Allocation Target');

    // Dynamic cascade headers - respect the selected method
    if (valuationMode === 'ff') {
      headers.push('Standard Rate ($/FF)', 'Excess Rate ($/FF)');
    } else if (valuationMode === 'sf') {
      headers.push('Standard Rate ($/SF)', 'Excess Rate ($/SF)');
    } else {
      headers.push('Prime Rate ($/Acre)', 'Secondary Rate ($/Acre)', 'Excess Rate ($/Acre)');
      if (shouldShowResidualColumn) {
        headers.push('Residual Rate ($/Acre)');
      }
    }

    // Special category headers
    headers.push('Wetlands Rate', 'Landlocked Rate', 'Conservation Rate');

    // Lot size and price headers
    headers.push('Avg Price (t) Lot Size', 'Avg Price (Time Norm)', 'Avg Price Lot Size', 'Avg Price (Current)', 'CME Bracket', 'Zoning');
    if (shouldShowKeyColumn) headers.push('Key Pages');
    if (shouldShowMapColumn) headers.push('Map Pages');

    const data = [];
    data.push(headers);

    // Add data rows
    Object.keys(vcsSheetData).sort().forEach(vcs => {
      const vcsData = vcsSheetData[vcs];
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const description = vcsDescriptions[vcs] || getVCSDescription(vcs);
      const recSite = vcsRecommendedSites[vcs] || 0;
      // Fix: Use nullish coalescing to allow 0 values in Act Site
      const actSite = vcsManualSiteValues[vcs] ?? recSite;
      const isResidential = type.startsWith('Residential');

      // Get typical lot size (FF mode shows FF + Depth, Acre/SF mode uses pre-calculated manual lot sizes)
      let typicalFF = '';
      let typicalDepth = '';
      let depthTableName = '';
      let typicalLot = '';

      if (valuationMode === 'ff') {
        // FF mode: calculate typical front feet and depth from vendor data
        const vcsProps = properties?.filter(p =>
          p.new_vcs === vcs && p.asset_lot_frontage && p.asset_lot_depth
        ) || [];

        if (vcsProps.length > 0) {
          const avgFF = vcsProps.reduce((sum, p) => sum + parseFloat(p.asset_lot_frontage || 0), 0) / vcsProps.length;
          const avgDepth = vcsProps.reduce((sum, p) => sum + parseFloat(p.asset_lot_depth || 0), 0) / vcsProps.length;
          typicalFF = Math.round(avgFF);
          typicalDepth = Math.round(avgDepth);
        }

        // Get depth table - check VCS override first, then zoning config
        const firstProp = properties?.find(p => p.new_vcs === vcs);
        if (firstProp) {
          const zone = firstProp.asset_zoning || '';
          const zcfg = marketLandData?.zoning_config || {};
          const zoneEntry = zcfg[zone] || zcfg[zone?.toUpperCase?.()] || zcfg[zone?.toLowerCase?.()] || null;
          const zoningDepthTable = zoneEntry ? (zoneEntry.depth_table || zoneEntry.depthTable || zoneEntry.depth_table_name || '') : '';
          // Use VCS-specific override if available, otherwise use zoning default
          depthTableName = vcsDepthTableOverrides[vcs] || zoningDepthTable;
        }
      } else if (valuationMode === 'sf') {
        // SF mode: use pre-calculated market_manual_lot_sf from property_market_analysis
        const vcsProps = properties?.filter(p =>
          p.new_vcs === vcs &&
          p.market_manual_lot_sf && parseFloat(p.market_manual_lot_sf) > 0
        ) || [];

        if (vcsProps.length > 0) {
          typicalLot = Math.round(vcsProps.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_sf), 0) / vcsProps.length);
        }
      } else {
        // Acre mode: use pre-calculated market_manual_lot_acre from property_market_analysis
        const vcsProps = properties?.filter(p =>
          p.new_vcs === vcs &&
          p.market_manual_lot_acre && parseFloat(p.market_manual_lot_acre) > 0
        ) || [];

        if (vcsProps.length > 0) {
          const avgAcres = vcsProps.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_acre), 0) / vcsProps.length;
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
      const recSiteFmt = recSite !== null && recSite !== undefined && recSite !== '' ? `$${Math.round(recSite).toLocaleString()}` : '';
      const actSiteFmt = actSite !== null && actSite !== undefined ? `$${Math.round(actSite).toLocaleString()}` : '';

      // Get the actual method for this VCS
      const vcsMethod = getVCSMethod(vcs, type);

      const row = [
        vcs,
        vcsData.counts?.total || 0,
        type,
        cleanDescription,
        getMethodDisplay(vcsMethod)
      ];

      // Add typical lot size columns (different for FF vs Acre mode)
      if (valuationMode === 'ff') {
        row.push(typicalFF || '', typicalDepth || '', depthTableName || '');
      } else {
        row.push(typicalLot || '');
      }

      // Get cascade rates early (needed for stepdown column and Raw Land calculation)
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

      // Add stepdown column for FF and SF modes (numeric only for formula compatibility)
      if (valuationMode === 'ff' && isResidential) {
        row.push(cascadeRates.standard?.max || '');
      } else if (valuationMode === 'sf' && isResidential) {
        row.push(cascadeRates.standard?.max || '');
      } else if (valuationMode === 'ff' || valuationMode === 'sf') {
        row.push(''); // Empty for non-residential
      }

      // Calculate Raw Land for export-only column
      let rawLandValue = 0;
      if (isResidential && typicalLot) {
        if (valuationMode === 'ff' && typicalFF && typicalDepth) {
          // Front Foot mode - use FF calculation
          const standardRate = cascadeRates.standard?.rate || 0;
          const standardMax = cascadeRates.standard?.max || 50;
          const excessRate = cascadeRates.excess?.rate || 0;

          const standardFF = Math.min(typicalFF, standardMax);
          const excessFF = Math.max(0, typicalFF - standardMax);

          rawLandValue = (standardFF * standardRate) + (excessFF * excessRate);

          // Apply depth factor if available
          if (depthTableName && depthTables[depthTableName]) {
            const depthTable = depthTables[depthTableName];
            if (depthTable.factors) {
              const depths = Object.keys(depthTable.factors).map(Number).sort((a, b) => a - b);
              let closestDepth = depths[0];
              for (const d of depths) {
                if (d <= typicalDepth) closestDepth = d;
                else break;
              }
              const depthFactor = depthTable.factors[closestDepth] || 1.0;
              rawLandValue *= depthFactor;
            }
          }
        } else if (valuationMode === 'sf') {
          // Square Foot mode
          const standardRate = cascadeRates.standard?.rate || 0;
          const standardMax = cascadeRates.standard?.max || 5000;
          const excessRate = cascadeRates.excess?.rate || 0;

          const standardSF = Math.min(typicalLot, standardMax);
          const excessSF = Math.max(0, typicalLot - standardMax);

          rawLandValue = (standardSF * standardRate) + (excessSF * excessRate);
        } else {
          // Acre mode - cascade calculation
          let remainingAcres = typicalLot;

          if (cascadeRates.prime && remainingAcres > 0) {
            const tier1Acres = Math.min(remainingAcres, cascadeRates.prime.max || 1);
            rawLandValue += tier1Acres * (cascadeRates.prime.rate || 0);
            remainingAcres -= tier1Acres;
          }

          if (cascadeRates.secondary && remainingAcres > 0) {
            const tier2Max = (cascadeRates.secondary.max || 5) - (cascadeRates.prime?.max || 1);
            const tier2Acres = Math.min(remainingAcres, tier2Max);
            rawLandValue += tier2Acres * (cascadeRates.secondary.rate || 0);
            remainingAcres -= tier2Acres;
          }

          if (cascadeRates.excess && remainingAcres > 0) {
            const tier3Max = cascadeRates.excess.max ?
              (cascadeRates.excess.max - (cascadeRates.secondary?.max || 5)) :
              remainingAcres;
            const tier3Acres = Math.min(remainingAcres, tier3Max);
            rawLandValue += tier3Acres * (cascadeRates.excess.rate || 0);
            remainingAcres -= tier3Acres;
          }

          if (cascadeRates.residual && remainingAcres > 0) {
            rawLandValue += remainingAcres * (cascadeRates.residual.rate || 0);
          }
        }
      }

      // Format Raw Land for display
      const rawLandFmt = rawLandValue > 0 ? `$${Math.round(rawLandValue).toLocaleString()}` : '';

      // Add Raw Land column (comes after stepdown)
      row.push(rawLandFmt);

      // Add Rec Site and Act Site
      row.push(recSiteFmt, actSiteFmt);

      // Get Allocation Target from user-set value (export as numeric percentage)
      const allocationTargetValue = targetAllocation != null ?
        Number(targetAllocation) : '';

      // Add Allocation Target to row
      row.push(allocationTargetValue);

      // Add cascade rates - match the selected method
      if (isResidential) {
        if (valuationMode === 'ff') {
          row.push(
            cascadeRates.standard?.rate != null ? `$${Math.round(cascadeRates.standard.rate).toLocaleString()}` : '',
            cascadeRates.excess?.rate != null ? `$${Math.round(cascadeRates.excess.rate).toLocaleString()}` : ''
          );
        } else if (valuationMode === 'sf') {
          row.push(
            cascadeRates.standard?.rate != null ? `$${Math.round(cascadeRates.standard.rate).toLocaleString()}` : '',
            cascadeRates.excess?.rate != null ? `$${Math.round(cascadeRates.excess.rate).toLocaleString()}` : ''
          );
        } else {
          row.push(
            cascadeRates.prime?.rate != null ? `$${Math.round(cascadeRates.prime.rate).toLocaleString()}` : '',
            cascadeRates.secondary?.rate != null ? `$${Math.round(cascadeRates.secondary.rate).toLocaleString()}` : '',
            cascadeRates.excess?.rate != null ? `$${Math.round(cascadeRates.excess.rate).toLocaleString()}` : ''
          );
          if (shouldShowResidualColumn) {
            row.push(cascadeRates.residual?.rate != null ? `$${Math.round(cascadeRates.residual.rate).toLocaleString()}` : '');
          }
        }
      } else {
        // Empty cells for non-residential
        if (valuationMode === 'ff') {
          row.push('', '');
        } else if (valuationMode === 'sf') {
          row.push('', '');
        } else {
          row.push('', '', '');
          if (shouldShowResidualColumn) {
            row.push('');
          }
        }
      }

      // Special category rates (formatted)
      row.push(
        vcsSpecialCategories.wetlands && cascadeConfig.specialCategories.wetlands != null ? `$${Math.round(cascadeConfig.specialCategories.wetlands).toLocaleString()}` : '',
        vcsSpecialCategories.landlocked && cascadeConfig.specialCategories.landlocked != null ? `$${Math.round(cascadeConfig.specialCategories.landlocked).toLocaleString()}` : '',
        vcsSpecialCategories.conservation && cascadeConfig.specialCategories.conservation != null ? `$${Math.round(cascadeConfig.specialCategories.conservation).toLocaleString()}` : ''
      );

      // Lot size columns (numeric only for formulas - no units)
      const avgNormTimeLotFmt = vcsData.avgNormTimeLotSize != null ? (
        valuationMode === 'ff' ? Math.round(vcsData.avgNormTimeLotSize) :
        valuationMode === 'sf' ? Math.round(vcsData.avgNormTimeLotSize) :
        Number(vcsData.avgNormTimeLotSize.toFixed(2))
      ) : '';

      // Use fallback logic to match UI: if avgPrice exists, use avgPriceLotSize, else use avgNormTimeLotSize
      const effectiveLotSize = vcsData.avgPrice ? vcsData.avgPriceLotSize : vcsData.avgNormTimeLotSize;
      const avgPriceLotFmt = effectiveLotSize != null ? (
        valuationMode === 'ff' ? Math.round(effectiveLotSize) :
        valuationMode === 'sf' ? Math.round(effectiveLotSize) :
        Number(effectiveLotSize.toFixed(2))
      ) : '';

      // Price and lot size columns (formatted)
      row.push(
        avgNormTimeLotFmt,
        vcsData.avgNormTime != null ? `$${Math.round(vcsData.avgNormTime).toLocaleString()}` : '',
        avgPriceLotFmt,
        vcsData.avgPrice != null ? `$${Math.round(vcsData.avgPrice).toLocaleString()}` : ''
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

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Add Excel formulas for Raw Land and Rec Site
    try {
      const rawLandColIndex = headers.indexOf('Raw Land');
      const recSiteColIndex = headers.indexOf('Rec Site Value');
      const methodColIndex = headers.indexOf('Method');
      const allocationTargetColIndex = headers.indexOf('Allocation Target');
      const avgPriceColIndex = headers.indexOf('Avg Price (Current)');
      const avgPriceLotSizeColIndex = headers.indexOf('Avg Price Lot Size');
      const stepdownColIndex = headers.indexOf('Stepdown (FF)') !== -1 ?
        headers.indexOf('Stepdown (FF)') : headers.indexOf('Stepdown (SF)');

      // Get rate column indices
      const standardRateFFColIndex = headers.indexOf('Standard Rate ($/FF)');
      const excessRateFFColIndex = headers.indexOf('Excess Rate ($/FF)');
      const standardRateSFColIndex = headers.indexOf('Standard Rate ($/SF)');
      const excessRateSFColIndex = headers.indexOf('Excess Rate ($/SF)');

      // Process each data row (rows 1+ are data, row 0 is header)
      for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
        const excelRow = rowIndex + 1; // Excel is 1-indexed
        const rowMethod = data[rowIndex][methodColIndex]; // Get the Method for this row

        // ===== RAW LAND FORMULA =====
        // Simple: avg price lot size - step X standard + remaining X excess
        if (rawLandColIndex >= 0 && avgPriceLotSizeColIndex >= 0) {
          const rawLandCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: rawLandColIndex });
          let rawLandFormula = '';

          if (rowMethod === 'FF' && standardRateFFColIndex >= 0 && excessRateFFColIndex >= 0 && stepdownColIndex >= 0) {
            const lotSizeCol = XLSX.utils.encode_col(avgPriceLotSizeColIndex);
            const stepdownCol = XLSX.utils.encode_col(stepdownColIndex);
            const standardRateCol = XLSX.utils.encode_col(standardRateFFColIndex);
            const excessRateCol = XLSX.utils.encode_col(excessRateFFColIndex);

            // Raw Land = (lot size up to step × standard) + (remaining after step × excess)
            rawLandFormula = `${stepdownCol}${excelRow}*${standardRateCol}${excelRow}+(${lotSizeCol}${excelRow}-${stepdownCol}${excelRow})*${excessRateCol}${excelRow}`;
          } else if (rowMethod === 'SF' && standardRateSFColIndex >= 0 && excessRateSFColIndex >= 0 && stepdownColIndex >= 0) {
            const lotSizeCol = XLSX.utils.encode_col(avgPriceLotSizeColIndex);
            const stepdownCol = XLSX.utils.encode_col(stepdownColIndex);
            const standardRateCol = XLSX.utils.encode_col(standardRateSFColIndex);
            const excessRateCol = XLSX.utils.encode_col(excessRateSFColIndex);

            // Raw Land = (lot size up to step × standard) + (remaining after step × excess)
            rawLandFormula = `${stepdownCol}${excelRow}*${standardRateCol}${excelRow}+(${lotSizeCol}${excelRow}-${stepdownCol}${excelRow})*${excessRateCol}${excelRow}`;
          }

          if (rawLandFormula && worksheet[rawLandCellRef]) {
            worksheet[rawLandCellRef].f = rawLandFormula;
            worksheet[rawLandCellRef].z = '"$"#,##0'; // Currency format with $ symbol
          }
        }

        // ===== REC SITE FORMULA =====
        if (recSiteColIndex >= 0 && allocationTargetColIndex >= 0 && avgPriceColIndex >= 0) {
          const recSiteCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: recSiteColIndex });
          const avgPriceCol = XLSX.utils.encode_col(avgPriceColIndex);
          const allocationTargetCol = XLSX.utils.encode_col(allocationTargetColIndex);
          const rawLandCol = XLSX.utils.encode_col(rawLandColIndex);

          let recSiteFormula = '';

          if (rowMethod === 'SITE') {
            // SITE Method: Avg Price × Allocation Target (÷100 for percentage)
            recSiteFormula = `${avgPriceCol}${excelRow}*${allocationTargetCol}${excelRow}/100`;
          } else if (rowMethod === 'FF' || rowMethod === 'SF' || rowMethod === 'AC') {
            // Acre/FF/SF: (Avg Price × Allocation Target) - Raw Land (÷100 for percentage)
            recSiteFormula = `${avgPriceCol}${excelRow}*${allocationTargetCol}${excelRow}/100-${rawLandCol}${excelRow}`;
          }

          if (recSiteFormula && worksheet[recSiteCellRef]) {
            worksheet[recSiteCellRef].f = recSiteFormula;
            worksheet[recSiteCellRef].z = '"$"#,##0'; // Currency format with $ symbol
          }
        }
      }
    } catch (e) {
      console.error('Error adding formulas to VCS export:', e);
      debug('VCS formula generation skipped', e);
    }

    // Set column widths
    const colWidths = [
      { wch: 8 },   // VCS
      { wch: 8 },   // Total
      { wch: 20 },  // Type
      { wch: 25 },  // Description
      { wch: 12 }   // Method
    ];

    // Typical lot columns (different for FF vs Acre mode)
    if (valuationMode === 'ff') {
      colWidths.push({ wch: 12 }, { wch: 12 }, { wch: 15 }); // Typical FF, Typical Depth, Depth Table
    } else {
      colWidths.push({ wch: 15 }); // Typical Lot Size
    }

    // Stepdown column for FF and SF modes
    if (valuationMode === 'ff' || valuationMode === 'sf') {
      colWidths.push({ wch: 15 }); // Stepdown
    }

    // Raw Land comes after stepdown
    colWidths.push({ wch: 15 }); // Raw Land

    colWidths.push({ wch: 15 }, { wch: 15 }, { wch: 18 }); // Rec Site, Act Site, Allocation Target

    // Add cascade rate column widths - match selected method
    if (valuationMode === 'ff') {
      colWidths.push({ wch: 15 }, { wch: 15 }); // Standard, Excess
    } else if (valuationMode === 'sf') {
      colWidths.push({ wch: 15 }, { wch: 15 }); // Standard, Excess
    } else {
      colWidths.push({ wch: 15 }, { wch: 15 }, { wch: 15 }); // Prime, Secondary, Excess
      if (shouldShowResidualColumn) {
        colWidths.push({ wch: 15 }); // Residual
      }
    }

    // Add remaining column widths
    colWidths.push(
      { wch: 15 },  // Wetlands
      { wch: 15 },  // Landlocked
      { wch: 15 },  // Conservation
      { wch: 15 },  // Avg Price (t) Lot Size
      { wch: 18 },  // Avg Price (Time)
      { wch: 15 },  // Avg Price Lot Size
      { wch: 18 },  // Avg Price
      { wch: 12 },  // CME
      { wch: 20 }   // Zoning
    );

    if (shouldShowKeyColumn) colWidths.push({ wch: 15 });
    if (shouldShowMapColumn) colWidths.push({ wch: 15 });

    worksheet['!cols'] = colWidths;

    // Professional formatting with gridlines - Leelawadee font, size 10, centered
    try {
      const numRows = data.length;
      const numCols = headers.length;

      // Find column indices for formatting
      const cmeBracketColIndex = headers.indexOf('CME Bracket');
      const allocationTargetColIndex = headers.indexOf('Allocation Target');
      const typicalLotColIndex = headers.indexOf('Typical Lot Size');
      const typicalFFColIndex = headers.indexOf('Typical FF');
      const typicalDepthColIndex = headers.indexOf('Typical Depth');
      const stepdownFFColIndex = headers.indexOf('Stepdown (FF)');
      const stepdownSFColIndex = headers.indexOf('Stepdown (SF)');
      const avgPriceTLotSizeColIndex = headers.indexOf('Avg Price (t) Lot Size');
      const avgPriceLotSizeColIndex = headers.indexOf('Avg Price Lot Size');

      // Lot size columns that need number formatting
      const lotSizeColumns = [
        typicalLotColIndex,
        typicalFFColIndex,
        typicalDepthColIndex,
        stepdownFFColIndex,
        stepdownSFColIndex,
        avgPriceTLotSizeColIndex,
        avgPriceLotSizeColIndex
      ].filter(i => i >= 0);

      // Style all cells with gridlines and formatting
      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!worksheet[cellRef]) continue;

          // Initialize style object
          if (!worksheet[cellRef].s) worksheet[cellRef].s = {};

          // Header row (row 0) - Clear background, black font, centered
          if (r === 0) {
            worksheet[cellRef].s.font = { bold: true, sz: 10, name: 'Leelawadee', color: { rgb: '000000' } };
            worksheet[cellRef].s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
            worksheet[cellRef].s.fill = { fgColor: { rgb: 'FFFFFF' } }; // Clear/white background
          } else {
            // Data rows - Leelawadee font, size 10, centered
            worksheet[cellRef].s.font = { sz: 10, name: 'Leelawadee', color: { rgb: '000000' } };
            worksheet[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };

            // Only color CME bracket cells (not entire rows)
            if (c === cmeBracketColIndex && data[r] && data[r][cmeBracketColIndex]) {
              const cmeBracketLabel = data[r][cmeBracketColIndex];
              const cmeBracket = CME_BRACKETS.find(b => b.label === cmeBracketLabel);

              if (cmeBracket && cmeBracket.color) {
                // Remove # from hex color for xlsx-js-style format
                const bgColor = cmeBracket.color.replace('#', '');
                worksheet[cellRef].s.fill = { fgColor: { rgb: bgColor } };
              }
            } else {
              // All other cells get white background
              worksheet[cellRef].s.fill = { fgColor: { rgb: 'FFFFFF' } };
            }

            // Format Allocation Target as percentage
            if (c === allocationTargetColIndex) {
              worksheet[cellRef].z = '0.0"%"'; // Display as percentage with 1 decimal
            }

            // Format lot size columns - FF/SF: no decimals, Acre: 2 decimals
            if (lotSizeColumns.includes(c)) {
              if (valuationMode === 'ff' || valuationMode === 'sf') {
                worksheet[cellRef].z = '#,##0'; // No decimals with comma separator
              } else {
                worksheet[cellRef].z = '#,##0.00'; // 2 decimals with comma separator
              }
            }
          }

          // Add gridlines (borders) to all cells
          worksheet[cellRef].s.border = {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } }
          };
        }
      }
    } catch (e) {
      console.error('VCS Sheet formatting error:', e);
      debug('VCS Sheet formatting skipped', e);
    }

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

  // Allocation export -> Excel workbook (matches UI table structure)
  const exportAllocationExcel = () => {
    console.log('📊 Allocation Export - vacantTestSales count:', (vacantTestSales || []).length);
    console.log('📊 Allocation Export - valuationMode:', valuationMode);

    const rows = [];

    // Headers match UI table structure - different for FF vs Acre mode
    const headers = valuationMode === 'ff'
      ? ['VCS','Year','Block/Lot','Region','Price','Front Feet','Depth','Zone','Site Value','Count','Avg Price','Avg FF','Avg Depth','Total Land Value','Current %','Recommended %','Status']
      : ['VCS','Year','Block/Lot','Region','Price','Acres','Site Value','Count','Avg Price','Avg Acres','Total Land Value','Current %','Recommended %','Status'];
    rows.push(headers);

    (vacantTestSales || []).forEach(sale => {
      const status = sale.isPositive ? 'Included' : 'Excluded';
      const vacantPrice = sale.vacantPrice != null ? `$${Math.round(sale.vacantPrice).toLocaleString()}` : '';
      const siteValueFmt = sale.siteValue != null ? `$${Math.round(sale.siteValue).toLocaleString()}` : '';
      const avgPriceFmt = sale.avgImprovedPrice > 0 ? `$${Math.round(sale.avgImprovedPrice).toLocaleString()}` : '-';
      const totalLandFmt = sale.totalLandValue != null ? `$${Math.round(sale.totalLandValue).toLocaleString()}` : '';
      const currentPct = sale.currentAllocation != null ? `${(sale.currentAllocation * 100).toFixed(1)}%` : '';
      const recPct = sale.recommendedAllocation != null ? `${(sale.recommendedAllocation * 100).toFixed(1)}%` : '';

      if (valuationMode === 'ff') {
        rows.push([
          sale.vcs || '',
          sale.year || '',
          `${sale.block || ''}/${sale.lot || ''}`,
          sale.region || '',
          vacantPrice,
          Math.round(sale.frontFeet) || '',
          Math.round(sale.depth) || '',
          sale.zone || '',
          siteValueFmt,
          sale.improvedSalesCount || 0,
          avgPriceFmt,
          Math.round(sale.avgImprovedFF) || '-',
          Math.round(sale.avgImprovedDepth) || '-',
          totalLandFmt,
          currentPct,
          recPct,
          status
        ]);
      } else {
        rows.push([
          sale.vcs || '',
          sale.year || '',
          `${sale.block || ''}/${sale.lot || ''}`,
          sale.region || '',
          vacantPrice,
          sale.acres != null ? Number(sale.acres.toFixed(2)) : '',
          siteValueFmt,
          sale.improvedSalesCount || 0,
          avgPriceFmt,
          sale.avgImprovedAcres != null ? Number(sale.avgImprovedAcres.toFixed(2)) : '-',
          totalLandFmt,
          currentPct,
          recPct,
          status
        ]);
      }
    });

    // Add summary section
    rows.push([]);
    rows.push(['SUMMARY']);
    rows.push(['Current Overall Allocation', `${currentOverallAllocation}%`]);
    rows.push(['Recommended Allocation', `${calculateAllocationStats()?.averageAllocation || ''}%`]);
    rows.push(['Target Allocation', `${targetAllocation || 'Not Set'}%`]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // basic formatting for header
    const headerCols = headers.length;
    for (let c = 0; c < headerCols; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[ref]) ws[ref].s = { font: { bold: true }, alignment: { horizontal: 'center' } };
    }

    // Column widths for Allocation sheet (adjusted for new structure)
    ws['!cols'] = valuationMode === 'ff'
      ? [{ wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }]
      : [{ wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Individual Allocation');

    // Add special region sheets (one sheet per special region)
    const uniqueRegions = [...new Set(vacantTestSales.map(s => s.region))].filter(r => r && r !== 'Normal').sort();

    uniqueRegions.forEach(regionName => {
      const regionSales = vacantTestSales.filter(sale => sale.region === regionName);
      if (regionSales.length === 0) return;

      const regionRows = [];
      regionRows.push(headers);

      regionSales.forEach(sale => {
        const status = sale.isPositive ? 'Included' : 'Excluded';
        const vacantPrice = sale.vacantPrice != null ? `$${Math.round(sale.vacantPrice).toLocaleString()}` : '';
        const siteValueFmt = sale.siteValue != null ? `$${Math.round(sale.siteValue).toLocaleString()}` : '';
        const avgPriceFmt = sale.avgImprovedPrice > 0 ? `$${Math.round(sale.avgImprovedPrice).toLocaleString()}` : '-';
        const totalLandFmt = sale.totalLandValue != null ? `$${Math.round(sale.totalLandValue).toLocaleString()}` : '';
        const currentPct = sale.currentAllocation != null ? `${(sale.currentAllocation * 100).toFixed(1)}%` : '';
        const recPct = sale.recommendedAllocation != null ? `${(sale.recommendedAllocation * 100).toFixed(1)}%` : '';

        if (valuationMode === 'ff') {
          regionRows.push([
            sale.vcs || '',
            sale.year || '',
            `${sale.block || ''}/${sale.lot || ''}`,
            sale.region || '',
            vacantPrice,
            Math.round(sale.frontFeet) || '',
            Math.round(sale.depth) || '',
            sale.zone || '',
            siteValueFmt,
            sale.improvedSalesCount || 0,
            avgPriceFmt,
            Math.round(sale.avgImprovedFF) || '-',
            Math.round(sale.avgImprovedDepth) || '-',
            totalLandFmt,
            currentPct,
            recPct,
            status
          ]);
        } else {
          regionRows.push([
            sale.vcs || '',
            sale.year || '',
            `${sale.block || ''}/${sale.lot || ''}`,
            sale.region || '',
            vacantPrice,
            sale.acres != null ? Number(sale.acres.toFixed(2)) : '',
            siteValueFmt,
            sale.improvedSalesCount || 0,
            avgPriceFmt,
            sale.avgImprovedAcres != null ? Number(sale.avgImprovedAcres.toFixed(2)) : '-',
            totalLandFmt,
            currentPct,
            recPct,
            status
          ]);
        }
      });

      // Add region summary
      const regionStats = calculateAllocationStats(regionName);
      regionRows.push([]);
      regionRows.push([`${regionName} Summary`]);
      regionRows.push(['Sales Included', regionSales.filter(s => s.isPositive).length]);
      regionRows.push(['Total Land Value', `$${regionSales.filter(s => s.isPositive).reduce((sum, s) => sum + (s.totalLandValue || 0), 0).toLocaleString()}`]);
      regionRows.push(['Total Sale Price', `$${regionSales.reduce((sum, s) => sum + (s.avgImprovedPrice || 0), 0).toLocaleString()}`]);
      regionRows.push(['Recommended Allocation', `${regionStats?.averageAllocation || '0'}%`]);

      const wsRegion = XLSX.utils.aoa_to_sheet(regionRows);
      for (let c = 0; c < headerCols; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (wsRegion[ref]) wsRegion[ref].s = { font: { bold: true }, alignment: { horizontal: 'center' } };
      }
      wsRegion['!cols'] = ws['!cols'];

      // Clean sheet name (Excel has 31 char limit and doesn't allow certain chars)
      const cleanSheetName = regionName.substring(0, 31).replace(/[:\\/?*\[\]]/g, '_');
      XLSX.utils.book_append_sheet(wb, wsRegion, cleanSheetName);
    });

    return wb;
  };

  // Land rates export (two sheets) - improved: full Method 1 with UI columns and expanded Method 2
  const exportLandRatesExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Vacant Land Sales (Method 1) - include UI columns
    const salesHeaders = valuationMode === 'ff'
      ? ['Include','Block','Lot','Qual','Address','Class','Bldg','Type','Design','VCS','Zoning','Depth Table','Special Region','Category','Sale Date','$ Sale Price','Frontage','Depth','$ / FF','Package','Notes']
      : ['Include','Block','Lot','Qual','Address','Class','Bldg','Type','Design','VCS','Zoning','Special Region','Category','Sale Date','$ Sale Price','Acres','$ / Acre','Package','Notes'];
    const salesRows = [salesHeaders];

    (vacantSales || []).forEach(sale => {
      const category = saleCategories[sale.id] || 'Uncategorized';
      const region = specialRegions[sale.id] || 'Normal';
      const qual = sale.sales_nu || '';
      const isPackage = sale.packageData ? `Y (${sale.packageData.package_count})` : 'N';
      const included = includedSales.has(sale.id) ? 'Y' : 'N';
      const notes = landNotes[sale.id] || '';

      const acres = sale.totalAcres != null ? Number(sale.totalAcres.toFixed(2)) : '';
      const salePrice = sale.sales_price != null ? Number(sale.sales_price) : '';
      const pricePerAcre = sale.pricePerAcre != null ? Number(sale.pricePerAcre) : '';

      if (valuationMode === 'ff') {
        const frontage = sale.asset_lot_frontage || '';
        const depth = sale.asset_lot_depth || '';
        const ffPrice = sale.pricePerAcre || '';
        salesRows.push([
          included,
          sale.property_block || '',
          sale.property_lot || '',
          qual,
          sale.property_location || '',
          sale.property_m4_class || '',
          sale.asset_building_class || '',
          sale.asset_type_use || '',
          sale.asset_design_style || '',
          sale.new_vcs || '',
          sale.asset_zoning || '',
          // Depth table name
          (() => {
            try {
              const zoneKey = sale.asset_zoning || '';
              const zcfg = marketLandData?.zoning_config || {};
              const entry = zcfg[zoneKey] || zcfg[zoneKey?.toUpperCase?.()] || zcfg[zoneKey?.toLowerCase?.()] || null;
              return entry ? (entry.depth_table || entry.depthTable || entry.depth_table_name || '') : '';
            } catch (e) { return ''; }
          })(),
          region,
          category,
          sale.sales_date || '',
          salePrice ? `$${salePrice.toLocaleString()}` : '',
          frontage,
          depth,
          ffPrice ? `$${Number(ffPrice).toLocaleString()}` : '',
          isPackage,
          notes
        ]);
      } else {
        salesRows.push([
          included,
          sale.property_block || '',
          sale.property_lot || '',
          qual,
          sale.property_location || '',
          sale.property_m4_class || '',
          sale.asset_building_class || '',
          sale.asset_type_use || '',
          sale.asset_design_style || '',
          sale.new_vcs || '',
          sale.asset_zoning || '',
          region,
          category,
          sale.sales_date || '',
          salePrice ? `$${salePrice.toLocaleString()}` : '',
          acres,
          pricePerAcre ? `$${Number(pricePerAcre).toLocaleString()}` : '',
          isPackage,
          notes
        ]);
      }
    });

    const ws1 = XLSX.utils.aoa_to_sheet(salesRows);
    // header formatting and column widths
    const salesCols = salesRows[0].length;
    for (let c = 0; c < salesCols; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws1[ref]) ws1[ref].s = { font: { bold: true }, alignment: { horizontal: 'center' } };
    }
    ws1['!cols'] = [
      { wch: 8 }, // Include
      { wch: 8 }, // Block
      { wch: 8 }, // Lot
      { wch: 8 }, // Qual
      { wch: 30 }, // Address
      { wch: 6 }, // Class
      { wch: 6 }, // Bldg
      { wch: 6 }, // Type
      { wch: 8 }, // Design
      { wch: 10 }, // VCS
      { wch: 12 }, // Zoning
      { wch: 12 }, // Special Region
      { wch: 12 }, // Category
      { wch: 12 }, // Sale Date
      { wch: 14 }, // $ Sale Price (formatted)
      { wch: 8 }, // Acres
      { wch: 12 }, // $ / Acre
      { wch: 10 }, // Package
      { wch: 30 } // Notes
    ];

    // Append summary for Method 1 (category summary matching UI)
    try {
      const ca = categoryAnalysis || {};
      const raw = ca.rawLand || { avg: 0, count: 0, avgLotSize: '' };
      const building = ca.buildingLot || { avg: 0, count: 0, avgLotSize: '' };
      const wetlands = ca.wetlands || { avg: 0, count: 0, avgLotSize: '' };
      const landlocked = ca.landlocked || { avg: 0, count: 0, avgLotSize: '' };
      const conservation = ca.conservation || { avg: 0, count: 0, avgLotSize: '' };

      const fmt = (v) => {
        if (v === null || v === undefined || v === '') return '$0';
        // If valuationMode is sf, avg may already be a string/number representing $/SF
        if (valuationMode === 'sf') return `$${v}`;
        return `$${Number(v).toLocaleString()}`;
      };

      salesRows.push([]);
      salesRows.push(['SUMMARY']);
      salesRows.push(['Raw Land', fmt(raw.avg), `${raw.count} sales`, raw.avgLotSize || '']);
      salesRows.push(['Building Lot', fmt(building.avg), `${building.count} sales`, building.avgLotSize || '']);
      salesRows.push(['Wetlands', fmt(wetlands.avg), `${wetlands.count} sales`, wetlands.avgLotSize || '']);
      salesRows.push(['Landlocked', fmt(landlocked.avg), `${landlocked.count} sales`, landlocked.avgLotSize || '']);
      salesRows.push(['Conservation', fmt(conservation.avg), `${conservation.count} sales`, conservation.avgLotSize || '']);

      // Add Special Regions Analysis if available
      const specialRegions = ca.specialRegions || {};
      if (Object.keys(specialRegions).length > 0) {
        salesRows.push([]);
        salesRows.push(['SPECIAL REGIONS ANALYSIS']);
        salesRows.push(['Region', 'Avg Rate', 'Sales', 'Method']);
        Object.entries(specialRegions).forEach(([region, data]) => {
          salesRows.push([
            region,
            fmt(data.avg),
            `${data.count} sales`,
            data.method === 'paired' ? `Paired (${data.pairs || 0} pairs)` : data.method || 'single'
          ]);
        });
      }
    } catch (e) {
      // fallback: simple counts
      salesRows.push([]);
      salesRows.push(['SUMMARY']);
      salesRows.push(['Total Sales', (vacantSales || []).length]);
    }

    // recreate ws1 to include summary formatting
    const ws1b = XLSX.utils.aoa_to_sheet(salesRows);
    // Format Vacant Sales sheet: Leelawadee size 10, bold headers, centered
    for (let c = 0; c < salesCols; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if (ws1b[ref]) {
        ws1b[ref].s = {
          font: { bold: true, sz: 10, name: 'Leelawadee' },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }
    ws1b['!cols'] = ws1['!cols'];
    XLSX.utils.book_append_sheet(wb, ws1b, 'Vacant Sales');

    // Sheet 2: Method 2 expanded (per VCS, expanded view) with VCS column
    const method2Rows = [];

    // Single global header row
    const method2Headers = ['VCS','Bracket','Count','Avg Lot Size (acres)','Avg Sale Price (t)','$ Avg Sale Price','Avg SFLA','$ ADJUSTED','$ DELTA','LOT DELTA','$ PER ACRE','PER SQ FT'];
    method2Rows.push(method2Headers);

    // Build bracket labels dynamically from cascadeConfig
    const p = cascadeConfig.normal?.prime?.max ?? 1;
    const s = cascadeConfig.normal?.secondary?.max ?? 5;
    const e = cascadeConfig.normal?.excess?.max ?? 10;
    const r = cascadeConfig.normal?.residual?.max ?? null;

    const labelSmall = `<${p.toFixed(2)}`;
    const labelMedium = `${p.toFixed(2)}-${s.toFixed(2)}`;
    const labelLarge = `${s.toFixed(2)}-${e.toFixed(2)}`;
    const labelXlarge = r ? `${e.toFixed(2)}-${r.toFixed(2)}` : `>${e.toFixed(2)}`;

    // Track rows for coloring (store {vcs, bracket, rowIndex, hasPrevious})
    const rowColorInfo = [];
    // Track VCS-level averages for Jim's formula
    const vcsAverages = {};

    Object.entries(bracketAnalysis || {}).sort(([a],[b]) => a.localeCompare(b)).forEach(([vcs, data]) => {
      // Store VCS-level averages (used in Jim's formula as GLS and GP)
      vcsAverages[vcs] = {
        avgLotSize: data.avgAcres || 0,  // GLS = General Lot Size
        avgPrice: data.avgAdjusted || 0,  // GP = General Price
        avgSFLA: data.avgSFLA || 0        // Average SFLA for VCS
      };

      const bracketList = [
        { key: 'small', label: labelSmall, bracket: data.brackets.small },
        { key: 'medium', label: labelMedium, bracket: data.brackets.medium },
        { key: 'large', label: labelLarge, bracket: data.brackets.large },
        { key: 'xlarge', label: labelXlarge, bracket: data.brackets.xlarge }
      ];

      let hasPreviousInVCS = false;
      let previousAdjusted = null;
      let previousLotSize = null;

      bracketList.forEach((row, rowIndex) => {
        if (!row.bracket || row.bracket.count === 0) return;

        // Calculate adjusted using SFLA-based formula for color determination
        const VCS_AVG_SFLA = vcsAverages[vcs].avgSFLA;
        const CURRENT_SFLA = row.bracket.avgSFLA || 0;
        const CURRENT_PRICE = row.bracket.avgSalePrice || 0;

        let currentAdjusted = CURRENT_PRICE;
        if (VCS_AVG_SFLA > 0 && CURRENT_SFLA > 0 && CURRENT_PRICE > 0) {
          currentAdjusted = ((VCS_AVG_SFLA - CURRENT_SFLA) * ((CURRENT_PRICE / CURRENT_SFLA) * 0.5)) + CURRENT_PRICE;
        }

        // Calculate delta for coloring (null if first row)
        const calculatedDelta = hasPreviousInVCS && previousAdjusted != null ? currentAdjusted - previousAdjusted : null;

        // Calculate lot delta: current lot size - previous lot size
        const lotDelta = hasPreviousInVCS && previousLotSize != null && row.bracket.avgAcres != null ?
          row.bracket.avgAcres - previousLotSize : null;

        const currentRowIndex = method2Rows.length;

        method2Rows.push([
          vcs,
          row.label,
          row.bracket.count || 0,
          row.bracket.avgAcres != null ? Number(row.bracket.avgAcres.toFixed(2)) : '',
          row.bracket.avgSalePrice != null ? row.bracket.avgSalePrice : '',
          row.bracket.avgSalePrice != null ? `$${Math.round(row.bracket.avgSalePrice).toLocaleString()}` : '',
          row.bracket.avgSFLA != null ? Math.round(row.bracket.avgSFLA).toLocaleString() : '',
          '', // $ ADJUSTED - will use formula
          '', // $ DELTA - will use formula
          lotDelta != null ? Number(lotDelta.toFixed(2)) : '',
          '', // $ PER ACRE - will use formula
          '' // PER SQ FT - will use formula
        ]);

        // Track color info: store calculated delta for coloring
        rowColorInfo.push({
          rowIndex: currentRowIndex,
          vcs,
          bracket: row.label,
          hasPrevious: hasPreviousInVCS,
          calculatedDelta: calculatedDelta
        });

        hasPreviousInVCS = true;
        previousAdjusted = currentAdjusted;
        previousLotSize = row.bracket.avgAcres || 0;
      });
    });

    // Method 2 Summary (similar to UI)
    method2Rows.push(['Method 2 Summary']);
    if (method2Summary) {
      const mid = method2Summary.mediumRange || {};
      const lg = method2Summary.largeRange || {};
      const xl = method2Summary.xlargeRange || {};
      const p = cascadeConfig.normal?.prime?.max ?? 1;
      const s = cascadeConfig.normal?.secondary?.max ?? 5;
      const e = cascadeConfig.normal?.excess?.max ?? 10;

      // Enhanced summary with per acre, lot size, and per sq ft
      method2Rows.push(['Bracket Range', 'Per Acre', 'Avg Lot Size (acres)', 'Per Sq Ft']);
      method2Rows.push([
        `${p.toFixed(2)}-${s.toFixed(2)}`,
        mid.perAcre && mid.perAcre !== 'N/A' ? `$${mid.perAcre.toLocaleString()}` : 'N/A',
        mid.avgAcres ? mid.avgAcres.toFixed(2) : 'N/A',
        mid.perSqFt && mid.perSqFt !== 'N/A' ? `$${mid.perSqFt}` : 'N/A'
      ]);
      method2Rows.push([
        `${s.toFixed(2)}-${e.toFixed(2)}`,
        lg.perAcre && lg.perAcre !== 'N/A' ? `$${lg.perAcre.toLocaleString()}` : 'N/A',
        lg.avgAcres ? lg.avgAcres.toFixed(2) : 'N/A',
        lg.perSqFt && lg.perSqFt !== 'N/A' ? `$${lg.perSqFt}` : 'N/A'
      ]);
      method2Rows.push([
        `${e.toFixed(2)}+`,
        xl.perAcre && xl.perAcre !== 'N/A' ? `$${xl.perAcre.toLocaleString()}` : 'N/A',
        xl.avgAcres ? xl.avgAcres.toFixed(2) : 'N/A',
        xl.perSqFt && xl.perSqFt !== 'N/A' ? `$${xl.perSqFt}` : 'N/A'
      ]);
      // All Positive Deltas Avg - calculate across all brackets
      const allRatesAcre = [];
      const allAcres = [];
      if (mid.perAcre && mid.perAcre !== 'N/A') {
        allRatesAcre.push(mid.perAcre);
        if (mid.avgAcres) allAcres.push(mid.avgAcres);
      }
      if (lg.perAcre && lg.perAcre !== 'N/A') {
        allRatesAcre.push(lg.perAcre);
        if (lg.avgAcres) allAcres.push(lg.avgAcres);
      }
      if (xl.perAcre && xl.perAcre !== 'N/A') {
        allRatesAcre.push(xl.perAcre);
        if (xl.avgAcres) allAcres.push(xl.avgAcres);
      }

      if (allRatesAcre.length > 0) {
        const avgPerAcre = Math.round(allRatesAcre.reduce((s, r) => s + r, 0) / allRatesAcre.length);
        const avgLotSize = allAcres.length > 0 ? (allAcres.reduce((s, a) => s + a, 0) / allAcres.length).toFixed(2) : 'N/A';
        const avgPerSqFt = (avgPerAcre / 43560).toFixed(2);
        method2Rows.push(['All Positive Deltas Avg', `$${avgPerAcre.toLocaleString()}`, avgLotSize, `$${avgPerSqFt}`]);
      } else {
        method2Rows.push(['All Positive Deltas Avg', 'N/A', 'N/A', 'N/A']);
      }
    }

    // Implied Front Foot Rates by Zoning (FF mode only)
    if (valuationMode === 'ff' && method2Summary && (method2Summary.mediumRange || method2Summary.largeRange || method2Summary.xlargeRange)) {
      try {
        method2Rows.push([]);
        method2Rows.push(['Implied Front Foot Rates by Zoning']);
        method2Rows.push(['Zoning', 'Zoning Lot', 'Land Value', 'Min Frontage', 'Standard FF', 'Excess FF']);

        const zcfg = marketLandData?.zoning_config || {};
        const zoneKeys = Object.keys(zcfg || {}).sort();

        // Choose lowest bracket with data
        let chosenPerAcre = null;
        let chosenBracketKey = null;
        if (method2Summary?.mediumRange?.perAcre && method2Summary.mediumRange.perAcre !== 'N/A') {
          chosenPerAcre = method2Summary.mediumRange.perAcre;
          chosenBracketKey = 'medium';
        } else if (method2Summary?.largeRange?.perAcre && method2Summary.largeRange.perAcre !== 'N/A') {
          chosenPerAcre = method2Summary.largeRange.perAcre;
          chosenBracketKey = 'large';
        } else if (method2Summary?.xlargeRange?.perAcre && method2Summary.xlargeRange.perAcre !== 'N/A') {
          chosenPerAcre = method2Summary.xlargeRange.perAcre;
          chosenBracketKey = 'xlarge';
        }

        // Compute overall average lot size from bracketAnalysis
        let overallAvgAcres = null;
        if (chosenBracketKey && typeof bracketAnalysis === 'object') {
          const vals = Object.values(bracketAnalysis).map(a => {
            try {
              const b = a.brackets && a.brackets[chosenBracketKey];
              return b && b.avgAcres ? b.avgAcres : null;
            } catch (e) { return null; }
          }).filter(v => v != null);
          if (vals.length > 0) overallAvgAcres = vals.reduce((s, v) => s + v, 0) / vals.length;
        }

        const summaryTypicalSF = overallAvgAcres != null ? Math.round(overallAvgAcres * 43560) : null;
        const perSqFtSummary = (chosenPerAcre != null && chosenPerAcre !== 'N/A') ? (parseFloat(chosenPerAcre) / 43560) : null;
        const summaryLandValue = (perSqFtSummary && summaryTypicalSF) ? Math.round(perSqFtSummary * summaryTypicalSF) : null;

        // Overall summary row
        method2Rows.push([
          `Overall Average (${chosenBracketKey || 'N/A'})`,
          overallAvgAcres != null ? `${overallAvgAcres.toFixed(2)} / ${summaryTypicalSF.toLocaleString()} SF` : 'N/A',
          summaryLandValue != null ? `$${Number(summaryLandValue).toLocaleString()}` : 'N/A',
          '', '', ''
        ]);

        const standardFFs = [];
        const excessFFs = [];

        zoneKeys.forEach(zoneKey => {
          const entry = zcfg[zoneKey] || zcfg[zoneKey?.toUpperCase?.()] || zcfg[zoneKey?.toLowerCase?.()] || null;
          if (!entry) return;
          const depthTable = entry.depth_table || entry.depthTable || entry.depth_table_name || '';
          const minFrontage = entry.min_frontage || entry.minFrontage || null;
          if (!depthTable || !minFrontage) return;

          // Get typical lot size
          let typicalLotAcres = '';
          let typicalLotSF = '';
          const cfgSize = entry.min_size || entry.minSize || entry.typical_lot || null;
          const cfgUnit = (entry.min_size_unit || entry.minSizeUnit || '').toString().toUpperCase();
          if (cfgSize) {
            if (cfgUnit === 'SF') {
              typicalLotSF = Math.round(Number(cfgSize));
              typicalLotAcres = Number((typicalLotSF / 43560).toFixed(2));
            } else {
              typicalLotAcres = Number(Number(cfgSize).toFixed(2));
              typicalLotSF = Math.round(typicalLotAcres * 43560);
            }
          } else {
            const propsForZone = (properties || []).filter(p => p.asset_zoning && p.asset_zoning.toString().trim().toLowerCase() === zoneKey.toString().trim().toLowerCase());
            let avgAcres = null;
            if (propsForZone.length > 0) {
              avgAcres = propsForZone.reduce((s, p) => s + (calculateAcreage(p) || 0), 0) / propsForZone.length;
            }
            typicalLotAcres = avgAcres !== null ? Number(avgAcres.toFixed(2)) : '';
            typicalLotSF = avgAcres !== null ? Math.round(avgAcres * 43560) : '';
          }

          // Jim's magic formula
          let landValue = '';
          if (summaryTypicalSF && summaryLandValue && typicalLotSF) {
            try {
              const ZLS = Number(typicalLotSF);
              const GLS = Number(summaryTypicalSF);
              const GP = Number(summaryLandValue);
              const adjustedLandValue = ((ZLS - GLS) * ((GP / GLS) * 0.50)) + GP;
              landValue = Math.round(adjustedLandValue);
            } catch (e) { landValue = ''; }
          }

          // Calculate FF rates
          let standardFF = '';
          let excessFF = '';
          if (landValue && minFrontage) {
            standardFF = Math.round(landValue / minFrontage);
            excessFF = Math.round(standardFF / 2);
            standardFFs.push(standardFF);
            excessFFs.push(excessFF);
          }

          method2Rows.push([
            zoneKey,
            typicalLotAcres ? `${typicalLotAcres} / ${typicalLotSF.toLocaleString()} SF` : '',
            landValue ? `$${Number(landValue).toLocaleString()}` : '',
            minFrontage || '',
            standardFF ? `$${Number(standardFF).toLocaleString()}` : '',
            excessFF ? `$${Number(excessFF).toLocaleString()}` : ''
          ]);
        });

        // Recommended row
        if (standardFFs.length > 0 && excessFFs.length > 0) {
          const recStandard = Math.round(standardFFs.reduce((s, v) => s + v, 0) / standardFFs.length);
          const recExcess = Math.round(excessFFs.reduce((s, v) => s + v, 0) / excessFFs.length);
          method2Rows.push([
            'Recommended Front Foot',
            '', '', '',
            `$${recStandard.toLocaleString()}`,
            `$${recExcess.toLocaleString()}`
          ]);
        }
      } catch (e) {
        console.warn('Error building Implied FF Rates export:', e);
      }
    }

    const ws2 = XLSX.utils.aoa_to_sheet(method2Rows);

    // Add formulas for $ ADJUSTED, $ DELTA, and $ PER ACRE columns
    try {
      const vcsColIndex = method2Headers.indexOf('VCS');
      const lotSizeColIndex = method2Headers.indexOf('Avg Lot Size (acres)');
      const avgSalePriceColIndex = method2Headers.indexOf('Avg Sale Price (t)');
      const avgSFLAColIndex = method2Headers.indexOf('Avg SFLA');
      const adjustedColIndex = method2Headers.indexOf('$ ADJUSTED');
      const deltaColIndex = method2Headers.indexOf('$ DELTA');
      const lotDeltaColIndex = method2Headers.indexOf('LOT DELTA');
      const perAcreColIndex = method2Headers.indexOf('$ PER ACRE');
      const perSqFtColIndex = method2Headers.indexOf('PER SQ FT');

      // Build a map of VCS to their averages for formula references
      const vcsAvgMap = new Map();
      Object.entries(vcsAverages).forEach(([vcs, avg]) => {
        vcsAvgMap.set(vcs, avg);
      });

      // For each data row (starting from row 1, row 0 is header)
      for (let rowIdx = 1; rowIdx < method2Rows.length; rowIdx++) {
        const excelRow = rowIdx + 1; // Excel is 1-indexed
        const currentVCS = method2Rows[rowIdx][0];
        const vcsAvg = vcsAvgMap.get(currentVCS);

        // Find previous row with same VCS for delta calculation
        let prevRowIdx = -1;
        for (let i = rowIdx - 1; i >= 1; i--) {
          if (method2Rows[i][0] === currentVCS) {
            prevRowIdx = i;
            break;
          }
        }
        const hasPrevious = prevRowIdx >= 0;

        // Jim's Formula for $ ADJUSTED: ((VCS_AVG_SFLA - CURRENT_SFLA) * ((CURRENT_PRICE / CURRENT_SFLA) * 0.50)) + CURRENT_PRICE
        // VCS_AVG_SFLA = VCS Average SFLA, CURRENT_SFLA = Bracket Avg SFLA, CURRENT_PRICE = Bracket Avg Sale Price
        if (adjustedColIndex >= 0 && vcsAvg && avgSFLAColIndex >= 0 && avgSalePriceColIndex >= 0 && vcsAvg.avgSFLA > 0) {
          const sflaCol = XLSX.utils.encode_col(avgSFLAColIndex);
          const priceCol = XLSX.utils.encode_col(avgSalePriceColIndex);
          const VCS_AVG_SFLA = vcsAvg.avgSFLA;
          const adjustedCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: adjustedColIndex });

          // Formula: ((VCS_AVG_SFLA - CurrentSFLA) * ((CurrentPrice / CurrentSFLA) * 0.5)) + CurrentPrice
          const adjustedFormula = `IF(AND(${sflaCol}${excelRow}<>"",${sflaCol}${excelRow}>0),((${VCS_AVG_SFLA}-${sflaCol}${excelRow})*((${priceCol}${excelRow}/${sflaCol}${excelRow})*0.5))+${priceCol}${excelRow},"")`;

          if (ws2[adjustedCellRef]) {
            ws2[adjustedCellRef].f = adjustedFormula;
            ws2[adjustedCellRef].z = '"$"#,##0'; // Currency format
          }
        }

        // Formula for $ DELTA: Current Adjusted - Previous Adjusted (only if has previous)
        if (hasPrevious && deltaColIndex >= 0 && adjustedColIndex >= 0) {
          const prevExcelRow = prevRowIdx + 1;
          const adjustedCol = XLSX.utils.encode_col(adjustedColIndex);
          const deltaCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: deltaColIndex });

          // Simple formula: Current - Previous
          const deltaFormula = `${adjustedCol}${excelRow}-${adjustedCol}${prevExcelRow}`;

          if (ws2[deltaCellRef]) {
            ws2[deltaCellRef].f = deltaFormula;
            ws2[deltaCellRef].z = '"$"#,##0'; // Currency format
          }
        }

        // Formula for $ PER ACRE: $ DELTA / LOT DELTA (only if has previous and valid)
        if (hasPrevious && perAcreColIndex >= 0 && deltaColIndex >= 0 && lotDeltaColIndex >= 0) {
          const deltaCol = XLSX.utils.encode_col(deltaColIndex);
          const lotDeltaCol = XLSX.utils.encode_col(lotDeltaColIndex);
          const perAcreCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: perAcreColIndex });

          // Formula: IF(AND(DELTA exists, LOT DELTA > 0), DELTA / LOT DELTA, "")
          const perAcreFormula = `IF(AND(${deltaCol}${excelRow}<>"",${lotDeltaCol}${excelRow}>0),${deltaCol}${excelRow}/${lotDeltaCol}${excelRow},"")`;

          if (ws2[perAcreCellRef]) {
            ws2[perAcreCellRef].f = perAcreFormula;
            ws2[perAcreCellRef].z = '"$"#,##0'; // Currency format without decimals
          }
        }

        // Formula for PER SQ FT: $ PER ACRE / 43560 (only if PER ACRE has value)
        if (hasPrevious && perSqFtColIndex >= 0 && perAcreColIndex >= 0) {
          const perAcreCol = XLSX.utils.encode_col(perAcreColIndex);
          const perSqFtCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: perSqFtColIndex });

          // Formula: IF(PER ACRE exists, PER ACRE / 43560, "")
          const perSqFtFormula = `IF(${perAcreCol}${excelRow}<>"",${perAcreCol}${excelRow}/43560,"")`;

          if (ws2[perSqFtCellRef]) {
            ws2[perSqFtCellRef].f = perSqFtFormula;
            ws2[perSqFtCellRef].z = '"$"#,##0.00'; // Currency format with 2 decimals
          }
        }
      }
    } catch (e) {
      console.error('Error adding Method 2 formulas:', e);
      debug('Method2 formulas skipped', e);
    }

    // Column widths for Method 2 with VCS column
    ws2['!cols'] = [
      { wch: 20 }, // VCS - widened to prevent truncation
      { wch: 12 }, // Bracket
      { wch: 8 },  // Count
      { wch: 18 }, // Avg Lot Size
      { wch: 14 }, // Avg Sale Price (t)
      { wch: 14 }, // $ Avg Sale Price
      { wch: 12 }, // Avg SFLA
      { wch: 14 }, // $ ADJUSTED
      { wch: 12 }, // $ DELTA
      { wch: 10 }, // LOT DELTA
      { wch: 14 }, // $ PER ACRE
      { wch: 12 }  // PER SQ FT
    ];

    // Apply Leelawadee size 10, bold headers, centered formatting and colors
    const headerLabels = method2Headers;
    try {
      const range = XLSX.utils.decode_range(ws2['!ref']);

      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const ref = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws2[ref];
          if (!cell) continue;

          // All cells get Leelawadee size 10 and centered
          cell.s = cell.s || {};
          cell.s.font = { sz: 10, name: 'Leelawadee' };
          cell.s.alignment = { horizontal: 'center', vertical: 'center' };

          // Row 0 is header - bold
          if (R === 0) {
            cell.s.font.bold = true;
          } else {
            // Apply row colors only if row has a previous (has delta calculation)
            const colorInfo = rowColorInfo.find(info => info.rowIndex === R);
            if (colorInfo && colorInfo.hasPrevious) {
              const delta = colorInfo.calculatedDelta;
              if (delta != null && delta > 0) {
                // Positive delta - light green
                cell.s.fill = { fgColor: { rgb: 'D4EDDA' } }; // Light green
              } else if (delta != null && delta < 0) {
                // Negative delta only - light red (not zero)
                cell.s.fill = { fgColor: { rgb: 'F8D7DA' } }; // Light red
              }
              // else: no color for zero or null delta
            }
            // else: first row of VCS - no color
          }
        }
      }
    } catch (e) {
      debug('Method2 formatting skipped', e);
    }

    XLSX.utils.book_append_sheet(wb, ws2, 'Implied Acreage');

    return wb;
  };

  const exportToExcel = (type) => {
    const timestamp = safeISODate(new Date());
    const municipality = (jobData?.municipality || 'export').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${type}_${municipality}_${timestamp}.xlsx`;

    let workbook;
    if (type === 'vcs-sheet') {
      workbook = exportVCSSheetExcel();
    } else if (type === 'eco-obs') {
      workbook = exportEcoObsWorksheetExcel();
    } else if (type === 'allocation') {
      workbook = exportAllocationExcel();
    } else if (type === 'land-rates') {
      workbook = exportLandRatesExcel();
    } else if (type === 'complete') {
      // Combine individual workbooks into one comprehensive workbook
      const combined = XLSX.utils.book_new();
      const exporters = [
        exportVCSSheetExcel,
        exportLandRatesExcel,
        // Note: exportLandRatesExcel already includes both Vacant Sales and Method 2 sheets
        exportAllocationExcel,
        exportEcoObsWorksheetExcel
      ];

      exporters.forEach(fn => {
        try {
          const wbPart = fn();
          if (wbPart && wbPart.SheetNames) {
            wbPart.SheetNames.forEach(name => {
              // Avoid duplicate sheet names by appending suffix if necessary
              let sheetName = name;
              let idx = 1;
              while (combined.SheetNames && combined.SheetNames.includes(sheetName)) {
                sheetName = `${name}_${idx}`;
                idx++;
              }
              XLSX.utils.book_append_sheet(combined, wbPart.Sheets[name], sheetName);
            });
          }
        } catch (e) {
          console.error('Error combining workbook part:', e);
        }
      });

      workbook = combined;
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
    csv += `Analysis Period: ${safeLocaleDate(dateRange.start)} to ${safeLocaleDate(dateRange.end)}\n`;
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

    // Headers match UI - different for FF vs Acre mode
    if (valuationMode === 'ff') {
      csv += 'VCS,Year,Block/Lot,Region,Price,Front Feet,Depth,Zone,Site Value,Count,Avg Price,Avg FF,Avg Depth,Total Land Value,Current %,Recommended %,Status\n';
    } else {
      csv += 'VCS,Year,Block/Lot,Region,Price,Acres,Site Value,Count,Avg Price,Avg Acres,Total Land Value,Current %,Recommended %,Status\n';
    }

    vacantTestSales.forEach(sale => {
      const status = sale.isPositive ? 'Included' : 'Excluded';
      const avgPrice = sale.avgImprovedPrice > 0 ? sale.avgImprovedPrice : 0;

      if (valuationMode === 'ff') {
        csv += `"${sale.vcs}",${sale.year},"${sale.block}/${sale.lot}","${sale.region}",${sale.vacantPrice},${Math.round(sale.frontFeet) || ''},${Math.round(sale.depth) || ''},${sale.zone || ''},${Math.round(sale.siteValue)},${sale.improvedSalesCount},${Math.round(avgPrice)},${Math.round(sale.avgImprovedFF) || ''},${Math.round(sale.avgImprovedDepth) || ''},${Math.round(sale.totalLandValue)},${(sale.currentAllocation * 100).toFixed(1)},${(sale.recommendedAllocation * 100).toFixed(1)},"${status}"\n`;
      } else {
        csv += `"${sale.vcs}",${sale.year},"${sale.block}/${sale.lot}","${sale.region}",${sale.vacantPrice},${sale.acres.toFixed(2)},${Math.round(sale.siteValue)},${sale.improvedSalesCount},${Math.round(avgPrice)},${sale.avgImprovedAcres?.toFixed(2) || ''},${Math.round(sale.totalLandValue)},${(sale.currentAllocation * 100).toFixed(1)},${(sale.recommendedAllocation * 100).toFixed(1)},"${status}"\n`;
      }
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

  const exportEcoObsWorksheetExcel = () => {
    const rows = [];
    const headers = ['VCS','Locational Analysis','Code','With Year Built','With Living Area','With Sale Price','Without Year Built','Without Living Area','Without Sale Price','Adjusted Sale With','Adjusted Sale Without','Dollar Impact','Percent Impact','Applied+%','Applied-%'];
    rows.push(headers);

    // Collect standalone locations (locations appearing in only one VCS)
    const standaloneLocations = [];
    const locationVCSMap = {}; // Track which VCSs have each location

    const filteredFactors = ecoObsFactors || {};
    Object.keys(filteredFactors).sort().forEach(vcs => {
      Object.keys(filteredFactors[vcs] || {}).forEach(locationAnalysis => {
        if (locationAnalysis === 'None') return;
        if (!locationVCSMap[locationAnalysis]) {
          locationVCSMap[locationAnalysis] = [];
        }
        locationVCSMap[locationAnalysis].push(vcs);
      });
    });

    Object.keys(filteredFactors).sort().forEach(vcs => {
      Object.keys(filteredFactors[vcs] || {}).forEach(locationAnalysis => {
        if (locationAnalysis === 'None') return;
        const impact = calculateEcoObsImpact(vcs, locationAnalysis, globalEcoObsTypeFilter) || {};
        const key = `${vcs}_${locationAnalysis}`;
        const code = mappedLocationCodes[key] || '';

        const withYearBuilt = impact.withYearBuilt ?? '';
        const withLivingArea = impact.withLivingArea ? impact.withLivingArea : '';
        const withSalePrice = impact.withSalePrice ? impact.withSalePrice : '';

        const withoutYearBuilt = impact.withoutYearBuilt ?? '';
        const withoutLivingArea = impact.withoutLivingArea ? impact.withoutLivingArea : '';
        const withoutSalePrice = impact.withoutSalePrice ? impact.withoutSalePrice : '';

        // Leave adjusted values empty for formulas
        const adjustedSaleWith = '';
        const adjustedSaleWithout = '';
        const dollarImpact = '';

        const percentImpact = impact.percentImpact ? impact.percentImpact : '';

        const appliedPos = actualAdjustments[`${key}_positive`] != null ? actualAdjustments[`${key}_positive`] : '';
        const appliedNeg = actualAdjustments[`${key}_negative`] != null ? actualAdjustments[`${key}_negative`] : '';

        // Track standalone locations
        if (locationVCSMap[locationAnalysis] && locationVCSMap[locationAnalysis].length === 1) {
          standaloneLocations.push({ vcs, locationAnalysis, code, impact });
        }

        rows.push([
          vcs,
          locationAnalysis,
          code,
          withYearBuilt,
          withLivingArea,
          withSalePrice,
          withoutYearBuilt,
          withoutLivingArea,
          withoutSalePrice,
          adjustedSaleWith,
          adjustedSaleWithout,
          dollarImpact,
          percentImpact,
          appliedPos,
          appliedNeg
        ]);
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Format header row and all cells
    const cols = rows[0].length;
    const getCell = (r, c) => {
      const colLetter = XLSX.utils.encode_col(c);
      return `${colLetter}${r}`;
    };

    // Header row styling - no borders/gridlines
    for (let c = 0; c < cols; c++) {
      const cellRef = getCell(1, c);
      if (!ws[cellRef]) continue;
      try {
        ws[cellRef].s = ws[cellRef].s || {};
        ws[cellRef].s.font = { name: 'Leelawadee', sz: 10, bold: true };
        ws[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      } catch (e) {
        debug('Header styling not applied', e);
      }
    }

    // Data rows styling - Leelawadee font, size 10, centered
    for (let r = 2; r <= rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const cellRef = getCell(r, c);
        if (!ws[cellRef]) continue;
        try {
          ws[cellRef].s = ws[cellRef].s || {};
          ws[cellRef].s.font = { name: 'Leelawadee', sz: 10 };
          ws[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
        } catch (e) {
          debug('Cell styling not applied', e);
        }
      }
    }

    // Format numeric/currency values
    // Columns (0-based): 4=With Living Area, 5=With Sale Price, 7=Without Living Area, 8=Without Sale Price,
    // 9=Adjusted Sale With, 10=Adjusted Sale Without, 11=Dollar Impact, 12=Percent Impact, 13=Applied+, 14=Applied-
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];

      // Format living area
      if (row[4] !== '' && !isNaN(Number(row[4]))) row[4] = Number(row[4]).toLocaleString();
      if (row[7] !== '' && !isNaN(Number(row[7]))) row[7] = Number(row[7]).toLocaleString();

      // Format currency fields (With Sale Price, Without Sale Price)
      [5,8].forEach(ci => {
        if (row[ci] !== '' && !isNaN(Number(row[ci]))) {
          row[ci] = `$${Number(row[ci]).toLocaleString()}`;
        }
      });

      // Percent impact
      if (row[12] !== '' && !String(row[12]).includes('%')) row[12] = `${row[12]}%`;

      // Applied percents
      if (row[13] !== '' && !String(row[13]).includes('%')) row[13] = `${row[13]}%`;
      if (row[14] !== '' && !String(row[14]).includes('%')) row[14] = `${row[14]}%`;
    }

    // Recreate worksheet with formatted strings
    const ws2 = XLSX.utils.aoa_to_sheet(rows);

    // Copy all styles from ws to ws2
    try {
      for (let r = 1; r <= rows.length; r++) {
        for (let c = 0; c < cols; c++) {
          const ref = getCell(r, c);
          if (ws[ref] && ws2[ref]) ws2[ref].s = ws[ref].s;
        }
      }
    } catch (e) {
      debug('Failed to copy styles to new sheet', e);
    }

    // Add formulas for Adjusted Sale With, Adjusted Sale Without, and Dollar Impact
    // Simplified: Just use average of E (With Living Area) and H (Without Living Area)
    // J=9 (Adjusted Sale With), K=10 (Adjusted Sale Without), L=11 (Dollar Impact)
    for (let r = 2; r <= rows.length; r++) {
      const withLivingCol = 'E';
      const withPriceCol = 'F';
      const withoutLivingCol = 'H';
      const withoutPriceCol = 'I';

      // Adjusted Sale With (J column) - simplified formula using average of E and H
      const adjustedWithRef = `J${r}`;
      const adjustedWithFormula = `${withPriceCol}${r}+((((${withLivingCol}${r}+${withoutLivingCol}${r})/2)-${withLivingCol}${r})*(${withPriceCol}${r}/${withLivingCol}${r})*0.5)`;
      if (ws2[adjustedWithRef]) {
        ws2[adjustedWithRef].f = adjustedWithFormula;
        ws2[adjustedWithRef].z = '\"$\"#,##0';
        ws2[adjustedWithRef].s = ws2[adjustedWithRef].s || {};
        ws2[adjustedWithRef].s.font = { name: 'Leelawadee', sz: 10 };
        ws2[adjustedWithRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      }

      // Adjusted Sale Without (K column) - simplified formula using average of E and H
      const adjustedWithoutRef = `K${r}`;
      const adjustedWithoutFormula = `${withoutPriceCol}${r}+((((${withLivingCol}${r}+${withoutLivingCol}${r})/2)-${withoutLivingCol}${r})*(${withoutPriceCol}${r}/${withoutLivingCol}${r})*0.5)`;
      if (ws2[adjustedWithoutRef]) {
        ws2[adjustedWithoutRef].f = adjustedWithoutFormula;
        ws2[adjustedWithoutRef].z = '\"$\"#,##0';
        ws2[adjustedWithoutRef].s = ws2[adjustedWithoutRef].s || {};
        ws2[adjustedWithoutRef].s.font = { name: 'Leelawadee', sz: 10 };
        ws2[adjustedWithoutRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      }

      // Dollar Impact (L column) = Adjusted Sale With - Adjusted Sale Without
      const dollarImpactRef = `L${r}`;
      const dollarImpactFormula = `J${r}-K${r}`;
      if (ws2[dollarImpactRef]) {
        ws2[dollarImpactRef].f = dollarImpactFormula;
        ws2[dollarImpactRef].z = '\"$\"#,##0';
        ws2[dollarImpactRef].s = ws2[dollarImpactRef].s || {};
        ws2[dollarImpactRef].s.font = { name: 'Leelawadee', sz: 10 };
        ws2[dollarImpactRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      }

      // Color code Applied+ (column N, index 13) as green
      const appliedPosRef = `N${r}`;
      if (ws2[appliedPosRef] && ws2[appliedPosRef].v !== '') {
        ws2[appliedPosRef].s = ws2[appliedPosRef].s || {};
        ws2[appliedPosRef].s.font = { name: 'Leelawadee', sz: 10, color: { rgb: '008000' } }; // Green
        ws2[appliedPosRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      }

      // Color code Applied- (column O, index 14) as red
      const appliedNegRef = `O${r}`;
      if (ws2[appliedNegRef] && ws2[appliedNegRef].v !== '') {
        ws2[appliedNegRef].s = ws2[appliedNegRef].s || {};
        ws2[appliedNegRef].s.font = { name: 'Leelawadee', sz: 10, color: { rgb: 'FF0000' } }; // Red
        ws2[appliedNegRef].s.alignment = { horizontal: 'center', vertical: 'center' };
      }
    }

    // Add summary section underneath the data
    const summaryStartRow = rows.length + 2; // Leave one blank row
    const summaryRows = [];

    // Summary header
    summaryRows.push(['', '']); // Blank row
    summaryRows.push(['', 'LOCATION SUMMARY']);
    summaryRows.push(['', '']); // Blank row
    summaryRows.push(['', 'Location', 'Sum Adj With', 'Sum Adj Without', 'Dollar Impact', 'Percent Impact']);

    // Collect ALL locations that appear in 2+ VCS codes (regardless of compounding)
    const repeatedLocations = {};
    Object.keys(locationVCSMap).forEach(location => {
      const vcsList = locationVCSMap[location];
      if (vcsList && vcsList.length >= 2) {
        repeatedLocations[location] = vcsList;
      }
    });

    // Add repeated locations with aggregated values across ALL VCS
    Object.keys(repeatedLocations).sort().forEach(location => {
      const vcsList = repeatedLocations[location];

      let sumAdjWith = 0;
      let sumAdjWithout = 0;
      let validCount = 0;

      // Aggregate across ALL VCS entries for this location
      vcsList.forEach(vcs => {
        const impact = calculateEcoObsImpact(vcs, location, globalEcoObsTypeFilter) || {};
        if (impact.adjustedSaleWith && impact.adjustedSaleWithout) {
          sumAdjWith += impact.adjustedSaleWith;
          sumAdjWithout += impact.adjustedSaleWithout;
          validCount++;
        }
      });

      if (validCount > 0) {
        const totalDollarImpact = sumAdjWith - sumAdjWithout;
        const percentImpact = sumAdjWithout > 0 ? ((totalDollarImpact / sumAdjWithout) * 100).toFixed(1) : 'N/A';

        summaryRows.push([
          '', // Column A - empty
          location, // Column B - Location name
          `$${Math.round(sumAdjWith).toLocaleString()}`, // Sum Adj With
          `$${Math.round(sumAdjWithout).toLocaleString()}`, // Sum Adj Without
          `$${Math.round(totalDollarImpact).toLocaleString()}`, // Dollar Impact
          percentImpact !== 'N/A' ? `${percentImpact}%` : percentImpact // Percent Impact
        ]);
      }
    });

    // Add summary rows to the worksheet
    let currentRow = summaryStartRow;
    summaryRows.forEach(summaryRow => {
      summaryRow.forEach((val, colIdx) => {
        const cellRef = getCell(currentRow, colIdx);
        ws2[cellRef] = { v: val, t: 's' };
        ws2[cellRef].s = {
          font: { name: 'Leelawadee', sz: 10, bold: colIdx === 0 && currentRow === summaryStartRow + 1 },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      });
      currentRow++;
    });

    // Style summary title row (bold)
    const summaryTitleRow = summaryStartRow + 1;
    const titleCellRef = getCell(summaryTitleRow, 1);
    if (ws2[titleCellRef]) {
      ws2[titleCellRef].s = ws2[titleCellRef].s || {};
      ws2[titleCellRef].s.font = { name: 'Leelawadee', sz: 10, bold: true };
      ws2[titleCellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
    }

    // Style summary header row
    const summaryHeaderRow = summaryStartRow + 3;
    for (let c = 1; c < 6; c++) { // Columns B-F (1-5)
      const cellRef = getCell(summaryHeaderRow, c);
      if (ws2[cellRef]) {
        ws2[cellRef].s = {
          font: { name: 'Leelawadee', sz: 10, bold: true },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Update worksheet range to include summary rows
    const maxRow = Math.max(rows.length, currentRow - 1);
    const maxCol = Math.max(cols - 1, 5); // 6 columns in summary (0-5), 15 in main data (0-14)
    ws2['!ref'] = `A1:${XLSX.utils.encode_col(maxCol)}${maxRow}`;

    // Set column widths - widen column B for long location descriptions
    ws2['!cols'] = [
      { wch: 12 },  // VCS
      { wch: 40 },  // Locational Analysis - widened significantly
      { wch: 10 },  // Code
      { wch: 14 },  // With Year Built
      { wch: 16 },  // With Living Area
      { wch: 16 },  // With Sale Price
      { wch: 14 },  // Without Year Built
      { wch: 16 },  // Without Living Area
      { wch: 16 },  // Without Sale Price
      { wch: 18 },  // Adjusted Sale With
      { wch: 18 },  // Adjusted Sale Without
      { wch: 14 },  // Dollar Impact
      { wch: 14 },  // Percent Impact
      { wch: 12 },  // Applied+%
      { wch: 12 }   // Applied-%
    ];

    XLSX.utils.book_append_sheet(wb, ws2, 'Eco Obs Study');

    return wb;
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

  const updateSpecialRegionVCSList = (region, vcsListString) => {
    setCascadeConfig(prev => ({
      ...prev,
      special: {
        ...prev.special,
        [region]: {
          ...prev.special[region],
          vcsList: vcsListString
        }
      }
    }));
  };

  const updateSpecialCategory = (category, rate) => {
    debug(`������� Updating special category: ${category} = ${rate}`);
    setCascadeConfig(prev => {
      const newConfig = {
        ...prev,
        specialCategories: {
          ...prev.specialCategories,
          [category]: rate ? parseFloat(rate) : null
        }
      };
      debug('������� New cascade config special categories:', newConfig.specialCategories);
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

    debug('🔄 Recalculating category analysis');
    debug('����� Total vacant sales:', vacantSales.length);
    debug('���� Checked sales count:', checkedSales.length);
    // ���� COMPREHENSIVE FILTERING DEBUG - Shows exactly which sales go where
    console.log('🔍 PAIRED SALES ANALYSIS - Category Breakdown:', {
      totalCheckedSales: checkedSales.length,

      normalRegion: {
        count: checkedSales.filter(s => !specialRegions[s.id] || specialRegions[s.id] === 'Normal').length,
        sales: checkedSales.filter(s => !specialRegions[s.id] || specialRegions[s.id] === 'Normal').map(s => ({
          block_lot: `${s.property_block}/${s.property_lot}`,
          category: saleCategories[s.id] || 'uncategorized',
          class: s.property_m4_class,
          region: specialRegions[s.id] || 'Normal'
        }))
      },

      rawLandGroup: {
        count: checkedSales.filter(s => {
          const isRawLandCategory = saleCategories[s.id] === 'raw_land';
          const isUncategorizedVacant = !saleCategories[s.id] && s.property_m4_class === '1';
          const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
          return (isRawLandCategory || isUncategorizedVacant) && isNormalRegion;
        }).length,
        sales: checkedSales.filter(s => {
          const isRawLandCategory = saleCategories[s.id] === 'raw_land';
          const isUncategorizedVacant = !saleCategories[s.id] && s.property_m4_class === '1';
          const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
          return (isRawLandCategory || isUncategorizedVacant) && isNormalRegion;
        }).map(s => `${s.property_block}/${s.property_lot}`)
      },

      buildingLotGroup: {
        count: checkedSales.filter(s => {
          const isInCategory = saleCategories[s.id] === 'building_lot' || saleCategories[s.id] === 'teardown' || saleCategories[s.id] === 'pre-construction';
          const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
          return isInCategory && isNormalRegion;
        }).length,
        sales: checkedSales.filter(s => {
          const isInCategory = saleCategories[s.id] === 'building_lot' || saleCategories[s.id] === 'teardown' || saleCategories[s.id] === 'pre-construction';
          const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
          return isInCategory && isNormalRegion;
        }).map(s => ({
          block_lot: `${s.property_block}/${s.property_lot}`,
          category: saleCategories[s.id]
        }))
      },

      specialRegionSales: Object.entries(
        checkedSales.reduce((acc, s) => {
          const region = specialRegions[s.id];
          if (region && region !== 'Normal') {
            if (!acc[region]) acc[region] = [];
            acc[region].push(`${s.property_block}/${s.property_lot}`);
          }
          return acc;
        }, {})
      ).map(([region, sales]) => ({ region, count: sales.length, sales }))
    });

    debug('���� Included sales IDs:', Array.from(includedSales));
    debug('�� Sale categories state:', saleCategories);
    debug('�������� Teardown sales in checked:', checkedSales.filter(s => saleCategories[s.id] === 'teardown').map(s => `${s.property_block}/${s.property_lot}`));
    debug('��� Building lot sales in checked:', checkedSales.filter(s => saleCategories[s.id] === 'building_lot').map(s => `${s.property_block}/${s.property_lot}`));

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
          const totalPrice = filtered.reduce((sum, s) => sum + (s.values_norm_time || s.sales_price), 0);
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
        // Log which sales are being used for this analysis
        console.log(`🔍 Paired analysis for ${categoryType}:`, {
          salesCount: filtered.length,
          sales: filtered.map(s => ({
            block_lot: `${s.property_block}/${s.property_lot}`,
            category: saleCategories[s.id] || 'uncategorized',
            class: s.property_m4_class,
            price: s.values_norm_time || s.sales_price,
            acres: s.totalAcres
          }))
        });

        // Sort by acreage for paired analysis
        const sortedSales = [...filtered].sort((a, b) => a.totalAcres - b.totalAcres);

        const pairedRates = [];

        // Calculate incremental rates between pairs
        for (let i = 0; i < sortedSales.length - 1; i++) {
          for (let j = i + 1; j < sortedSales.length; j++) {
            const smaller = sortedSales[i];
            const larger = sortedSales[j];

            // Determine size measure depending on valuation mode
            let smallerSize = 0;
            let largerSize = 0;
            if (valuationMode === 'sf') {
              smallerSize = (smaller.totalAcres || 0) * 43560;
              largerSize = (larger.totalAcres || 0) * 43560;
            } else if (valuationMode === 'ff') {
              smallerSize = parseFloat(smaller.asset_lot_frontage) || 0;
              largerSize = parseFloat(larger.asset_lot_frontage) || 0;
            } else {
              // default to acres
              smallerSize = smaller.totalAcres || 0;
              largerSize = larger.totalAcres || 0;
            }

            const sizeDiff = largerSize - smallerSize;
            const priceDiff = (larger.values_norm_time || larger.sales_price) - (smaller.values_norm_time || smaller.sales_price);

            // Only include positive price differences and positive size differences
            if (priceDiff > 0 && sizeDiff > 0) {
              const incrementalRate = priceDiff / sizeDiff;
              pairedRates.push({
                rate: incrementalRate,
                smallerSize,
                largerSize,
                priceDiff: priceDiff,
                sizeDiff: sizeDiff,
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

          // Prepare human-readable size unit for debugging
          const sizeUnitLabel = valuationMode === 'acre' ? 'acres' : valuationMode === 'sf' ? 'sqft' : 'front ft';
          debug(`������ ${categoryType} paired analysis:`, {
            totalProperties: filtered.length,
            possiblePairs: (filtered.length * (filtered.length - 1)) / 2,
            validPairs: pairedRates.length,
            filteredOut: (filtered.length * (filtered.length - 1)) / 2 - pairedRates.length,
            rates: rates.map(r => Math.round(r)),
            medianRate: Math.round(medianRate),
            properties: pairedRates.map(p => p.properties),
            sizeRanges: pairedRates.map(p => `${p.sizeDiff.toFixed(2)} ${sizeUnitLabel}`)
          });

          // Choose a target size for best-pair selection (1 acre or equivalent in SF). For FF default to smallest sizeDiff.
          const targetSize = valuationMode === 'acre' ? 1 : valuationMode === 'sf' ? 43560 : 0;

          const bestPair = pairedRates.sort((a, b) => {
            if (targetSize > 0) return Math.abs(a.sizeDiff - targetSize) - Math.abs(b.sizeDiff - targetSize);
            return Math.abs(a.sizeDiff) - Math.abs(b.sizeDiff);
          })[0];

          // Calculate aggregate statistics for all pairs
          const priceDiffs = pairedRates.map(p => p.priceDiff);
          const avgPriceDiff = priceDiffs.reduce((sum, diff) => sum + diff, 0) / priceDiffs.length;
          const minPriceDiff = Math.min(...priceDiffs);
          const maxPriceDiff = Math.max(...priceDiffs);

          console.log(`�� Paired analysis results for ${categoryType}:`, {
            totalPairs: pairedRates.length,
            avgPriceDiff: Math.round(avgPriceDiff),
            minPriceDiff: Math.round(minPriceDiff),
            maxPriceDiff: Math.round(maxPriceDiff),
            medianRate: Math.round(medianRate),
            allPriceDiffs: priceDiffs.map(d => Math.round(d))
          });

          // Return rounded whole-number unit rates for all modes (user requested whole numbers only)
          return {
            avg: Math.round(medianRate),
            count: filtered.length,
            avgLotSize,
            method: 'paired',
            pairedAnalysis: {
              pairs: pairedRates.length,
              medianRate: Math.round(medianRate),
              bestPair,
              avgPriceDiff: Math.round(avgPriceDiff),
              minPriceDiff: Math.round(minPriceDiff),
              maxPriceDiff: Math.round(maxPriceDiff)
            }
          };
        }
      }

      // Fallback to simple calculation if paired analysis fails
      if (valuationMode === 'sf') {
        const totalPrice = filtered.reduce((sum, s) => sum + (s.values_norm_time || s.sales_price), 0);
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

    // RAW LAND ANALYSIS - ONLY vacant land sales (no/minimal improvements) in NORMAL region
    // This includes properties explicitly categorized as 'raw_land' OR uncategorized class 1 properties
    // MUST be in Normal special region (not Beach Block, River Front, etc.)
    const rawLand = getCategoryAverage(s => {
      const isRawLandCategory = saleCategories[s.id] === 'raw_land';
      const isUncategorizedVacant = !saleCategories[s.id] && s.property_m4_class === '1';
      const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
      const isInRawLand = (isRawLandCategory || isUncategorizedVacant) && isNormalRegion;

      // Debug teardown sales to see if they're incorrectly going to raw land
      if (saleCategories[s.id] === 'teardown' || (s.property_block === '5' && s.property_lot === '12.12')) {
        debug('���� Raw Land check for teardown/5.12.12:', {
          block: s.property_block,
          lot: s.property_lot,
          id: s.id,
          category: saleCategories[s.id],
          hasCategory: !!saleCategories[s.id],
          class: s.property_m4_class,
          specialRegion: specialRegions[s.id] || 'Normal',
          isRawLandCategory,
          isUncategorizedVacant,
          isNormalRegion,
          isInRawLand
        });
      }

      return isInRawLand;
    }, 'developable');

    // BUILDING LOT ANALYSIS - ONLY buildable properties in NORMAL region
    // This includes properties explicitly categorized as 'building_lot', 'teardown', or 'pre-construction'
    // MUST be in Normal special region (not Beach Block, River Front, etc.)
    const buildingLot = getCategoryAverage(s => {
      const isInCategory = saleCategories[s.id] === 'building_lot' ||
                          saleCategories[s.id] === 'teardown' ||
                          saleCategories[s.id] === 'pre-construction';
      const isNormalRegion = !specialRegions[s.id] || specialRegions[s.id] === 'Normal';
      const isInBuildingLot = isInCategory && isNormalRegion;

      // Debug all teardown sales
      if (saleCategories[s.id] === 'teardown') {
        debug('🏗️ Teardown sale details:', {
          block: s.property_block,
          lot: s.property_lot,
          id: s.id,
          category: saleCategories[s.id],
          specialRegion: specialRegions[s.id] || 'Normal',
          isIncluded: includedSales.has(s.id),
          isInCategory,
          isNormalRegion,
          isInBuildingLot,
          price: s.values_norm_time || s.sales_price,
          acres: s.totalAcres,
          pricePerAcre: s.pricePerAcre
        });
      }

      // Keep the 47/2 debug for reference
      if (s.property_block === '47' && s.property_lot === '2') {
        debug('🏠 Property 47/2 details:', {
          id: s.id,
          category: saleCategories[s.id],
          specialRegion: specialRegions[s.id] || 'Normal',
          isInBuildingLot,
          price: s.values_norm_time || s.sales_price,
          acres: s.totalAcres
        });
      }
      return isInBuildingLot;
    }, 'developable');

    const wetlands = getCategoryAverage(s => saleCategories[s.id] === 'wetlands', 'constrained');
    const landlocked = getCategoryAverage(s => saleCategories[s.id] === 'landlocked', 'constrained');
    const conservation = getCategoryAverage(s => saleCategories[s.id] === 'conservation', 'constrained');

    debug('�������� Building Lot Analysis Result:', {
      avg: buildingLot.avg,
      count: buildingLot.count,
      method: buildingLot.method,
      hasPairedAnalysis: !!buildingLot.pairedAnalysis
    });

    // Calculate special regions analysis - use PAIRED analysis when 2+ sales, simple average for 1 sale
    const specialRegionsMap = {};
    checkedSales.forEach(sale => {
      const region = specialRegions[sale.id];
      if (region && region !== 'Normal') {
        if (!specialRegionsMap[region]) {
          specialRegionsMap[region] = [];
        }
        specialRegionsMap[region].push(sale);
      }
    });

    const specialRegionsAnalysis = {};
    Object.entries(specialRegionsMap).forEach(([region, sales]) => {
      if (sales.length === 0) return;

      if (sales.length === 1) {
        // Single sale: use individual rate
        const sale = sales[0];
        specialRegionsAnalysis[region] = {
          avg: Math.round(sale.pricePerAcre),
          count: 1,
          region,
          method: 'single'
        };
      } else {
        // Multiple sales: use paired analysis
        const sortedSales = [...sales].sort((a, b) => a.totalAcres - b.totalAcres);
        const pairedRates = [];

        for (let i = 0; i < sortedSales.length - 1; i++) {
          for (let j = i + 1; j < sortedSales.length; j++) {
            const smaller = sortedSales[i];
            const larger = sortedSales[j];

            let smallerSize = 0;
            let largerSize = 0;
            if (valuationMode === 'sf') {
              smallerSize = (smaller.totalAcres || 0) * 43560;
              largerSize = (larger.totalAcres || 0) * 43560;
            } else if (valuationMode === 'ff') {
              smallerSize = parseFloat(smaller.asset_lot_frontage) || 0;
              largerSize = parseFloat(larger.asset_lot_frontage) || 0;
            } else {
              smallerSize = smaller.totalAcres || 0;
              largerSize = larger.totalAcres || 0;
            }

            const sizeDiff = largerSize - smallerSize;
            const priceDiff = (larger.values_norm_time || larger.sales_price) - (smaller.values_norm_time || smaller.sales_price);

            if (priceDiff > 0 && sizeDiff > 0) {
              pairedRates.push(priceDiff / sizeDiff);
            }
          }
        }

        if (pairedRates.length > 0) {
          const rates = pairedRates.sort((a, b) => a - b);
          const medianRate = rates.length % 2 === 0 ?
            (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2 :
            rates[Math.floor(rates.length / 2)];

          specialRegionsAnalysis[region] = {
            avg: Math.round(medianRate),
            count: sales.length,
            region,
            method: 'paired',
            pairs: pairedRates.length
          };
        } else {
          // Fallback to simple average if paired analysis fails
          const avgRate = sales.reduce((sum, s) => sum + s.pricePerAcre, 0) / sales.length;
          specialRegionsAnalysis[region] = {
            avg: Math.round(avgRate),
            count: sales.length,
            region,
            method: 'fallback'
          };
        }
      }
    });

    // �� FINAL RESULTS LOG - Shows what will be displayed to user
    console.log('📊 PAIRED SALES ANALYSIS - Final Results:', {
      valuationMode,
      unitLabel: valuationMode === 'acre' ? '$/acre' : valuationMode === 'sf' ? '$/SF' : '$/FF',

      rawLand: {
        avg: rawLand.avg,
        count: rawLand.count,
        method: rawLand.method,
        avgLotSize: rawLand.avgLotSize,
        ...(rawLand.pairedAnalysis && {
          pairs: rawLand.pairedAnalysis.pairs,
          medianRate: rawLand.pairedAnalysis.medianRate,
          priceRange: `$${rawLand.pairedAnalysis.minPriceDiff?.toLocaleString()} - $${rawLand.pairedAnalysis.maxPriceDiff?.toLocaleString()}`
        })
      },

      buildingLot: {
        avg: buildingLot.avg,
        count: buildingLot.count,
        method: buildingLot.method,
        avgLotSize: buildingLot.avgLotSize,
        ...(buildingLot.pairedAnalysis && {
          pairs: buildingLot.pairedAnalysis.pairs,
          medianRate: buildingLot.pairedAnalysis.medianRate,
          priceRange: `$${buildingLot.pairedAnalysis.minPriceDiff?.toLocaleString()} - $${buildingLot.pairedAnalysis.maxPriceDiff?.toLocaleString()}`
        })
      },

      specialRegions: Object.entries(specialRegionsAnalysis).map(([region, data]) => ({
        region,
        avg: data.avg,
        count: data.count,
        method: data.method,
        ...(data.pairs && { pairs: data.pairs })
      })),

      excludedFromMainTiles: {
        wetlands: { avg: wetlands.avg, count: wetlands.count },
        landlocked: { avg: landlocked.avg, count: landlocked.count },
        conservation: { avg: conservation.avg, count: conservation.count }
      }
    });

    return { rawLand, buildingLot, wetlands, landlocked, conservation, specialRegions: specialRegionsAnalysis };
  }, [vacantSales, includedSales, saleCategories, valuationMode, specialRegions]);

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

    // Additional notification that rates have been saved �� show a concise toast instead of alert
    const methodLabel = valuationMode ? valuationMode.toUpperCase() : 'N/A';
    const normalTiers = Object.keys(cascadeConfig.normal || {}).filter(k => cascadeConfig.normal[k]?.rate).length;
    const specialCount = Object.keys(cascadeConfig.special || {}).length;
    const vcsSpecificCount = Object.keys(cascadeConfig.vcsSpecific || {}).length;

    const message = `Land rates saved for ${affectedVCS.size} VCS areas. Available in Allocation Study and VCS Sheet.` +
      `\n\nMethod: ${methodLabel}` +
      `\nNormal rate tiers: ${normalTiers}` +
      `\nSpecial regions: ${specialCount}` +
      `\nVCS-specific configs: ${vcsSpecificCount}`;

    setSaveRatesMessage(message);
    setShowSaveRatesNotification(true);
    setTimeout(() => {
      setShowSaveRatesNotification(false);
      setSaveRatesMessage('');
    }, 7000);
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
          �� Prompt copied! Paste into Claude AI
        </div>
      )}

      {showSaveRatesNotification && saveRatesMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          backgroundColor: '#2563EB',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          zIndex: 9999,
          animation: 'slideIn 0.3s ease',
          maxWidth: '340px',
          whiteSpace: 'pre-line'
        }}>
          <strong>Land rates saved</strong>
          <div style={{ marginTop: '8px', fontSize: '13px' }}>{saveRatesMessage}</div>
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
              value={safeISODate(dateRange.start)}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value ? new Date(e.target.value) : prev.start }))}
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
              value={safeISODate(dateRange.end)}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value ? new Date(e.target.value) : prev.end }))}
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

      {/* Special Regions Configuration */}
      <div className="special-regions-panel">
        <div className="special-regions-header">
          <h3 className="special-regions-title">Special Regions</h3>
        </div>
        <div className="special-regions-body">
          <div className="special-regions-controls">
            <input
              type="text"
              placeholder="New region name (e.g. Waterfront)"
              value={newSpecialRegionName}
              onChange={(e) => setNewSpecialRegionName(e.target.value)}
              className="special-region-input"
            />
            <button
              onClick={() => {
                const name = (newSpecialRegionName || '').toString().trim();
                if (!name) return alert('Enter a region name');
                // Initialize with a copy of normal rates if not present
                setCascadeConfig(prev => {
                  if (!prev.special) prev.special = {};
                  if (!prev.special[name]) {
                    prev.special = { ...prev.special, [name]: JSON.parse(JSON.stringify(prev.normal || {})) };
                  }
                  return { ...prev };
                });
                setNewSpecialRegionName('');
              }}
              className="special-region-add"
            >Add</button>
            <button
              onClick={async () => {
                // Trigger a save to persist cascadeConfig with new regions
                await saveAnalysis({ source: 'special-region-config' });
                alert('Special regions saved');
              }}
              className="special-region-save"
            >Save</button>
          </div>

          <div className="special-regions-list">
            <div className="special-regions-list-row special-regions-list-header">
              <div>Name</div>
              <div>Actions</div>
            </div>
            {Object.keys(cascadeConfig.special || {}).length === 0 && (
              <div className="special-regions-empty">No custom special regions configured</div>
            )}
            {Object.keys(cascadeConfig.special || {}).map(region => (
              <div key={region} className="special-regions-list-row">
                <div className="special-region-name">{region}</div>
                <div>
                  <button
                    onClick={() => {
                      // Remove this special region from cascadeConfig
                      setCascadeConfig(prev => {
                        const copy = { ...prev };
                        if (copy.special && copy.special[region]) {
                          const s = { ...copy.special };
                          delete s[region];
                          copy.special = s;
                        }
                        return copy;
                      });
                      // Also clear any sales that used this region
                      setSpecialRegions(prev => {
                        const next = { ...prev };
                        Object.keys(next).forEach(k => { if (next[k] === region) next[k] = 'Normal'; });
                        return next;
                      });
                    }}
                    className="special-region-remove"
                  >Remove</button>
                </div>
              </div>
            ))}
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
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #E5E7EB' }}>Year Built</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Design</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>VCS</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Zoning</th>
                {valuationMode === 'ff' && (
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Depth Table</th>
                )}
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Special Region</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Category</th>
                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>Sale Date</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Sale Price</th>
                {valuationMode === 'ff' ? (
                  <>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Frontage</th>
                    <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>Depth</th>
                  </>
                ) : (
                  <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #E5E7EB' }}>
                    {valuationMode === 'acre' ? 'Acres' : valuationMode === 'sf' ? 'Sq Ft' : 'Frontage'}
                  </th>
                )}
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
                          const checked = e.target.checked;
                          debug(`Checkbox change for ${sale.property_block}/${sale.property_lot}:`, { checked, saleId: sale.id });
                          if (checked) {
                            // Remove from excluded set when checking
                            setMethod1ExcludedSales(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(sale.id);
                              return newSet;
                            });
                            setIncludedSales(prev => new Set([...prev, sale.id]));
                          } else {
                            // Add to excluded set when unchecking
                            setMethod1ExcludedSales(prev => new Set([...prev, sale.id]));
                            setIncludedSales(prev => {
                              const newSet = new Set(prev);
                              newSet.delete(sale.id);
                              debug('❌ Removed from included sales, new size:', newSet.size);
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
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'center' }}>
                      {sale.asset_year_built || '-'}
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
                    {valuationMode === 'ff' && (
                      <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', fontSize: '12px' }}>
                        {(() => {
                          try {
                            const zoneKey = sale.asset_zoning || sale.asset_zoning_code || sale.asset_zoning_text || '';
                            const zcfg = marketLandData?.zoning_config || {};
                            const entry = zcfg[zoneKey] || zcfg[zoneKey?.toUpperCase?.()] || zcfg[zoneKey?.toLowerCase?.()] || null;
                            return entry ? (entry.depth_table || entry.depthTable || entry.depth_table_name || '') : '';
                          } catch (e) { return ''; }
                        })()}
                      </td>
                    )}

                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <select
                        value={specialRegions[sale.id] || 'Normal'}
                        onChange={(e) => {
                          const selectedRegion = e.target.value;
                          // Auto-create cascade config for SPECIAL_REGIONS if not already present
                          if (selectedRegion !== 'Normal' && SPECIAL_REGIONS.includes(selectedRegion) && !cascadeConfig.special?.[selectedRegion]) {
                            setCascadeConfig(prev => ({
                              ...prev,
                              special: {
                                ...(prev.special || {}),
                                [selectedRegion]: JSON.parse(JSON.stringify(prev.normal || {}))
                              }
                            }));
                          }
                          setSpecialRegions(prev => ({ ...prev, [sale.id]: selectedRegion }));
                        }}
                        className="special-region-select"
                      >
                        {regionOptions.map(region => (
                          <option key={region} value={region}>{region}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB' }}>
                      <select
                        value={saleCategories[sale.id] || sale.autoCategory || 'uncategorized'}
                        onChange={(e) => {
                          const newValue = e.target.value;
                          setSaleCategories(prev => {
                            if (prev[sale.id] === newValue) return prev; // Don't update if same value
                            return { ...prev, [sale.id]: newValue };
                          });
                        }}
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
                    {valuationMode === 'ff' ? (
                      <>
                        <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                          {sale.asset_lot_frontage != null ? String(sale.asset_lot_frontage) : ''}
                        </td>
                        <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                          {sale.asset_lot_depth != null ? String(sale.asset_lot_depth) : ''}
                        </td>
                      </>
                    ) : (
                      <td style={{ padding: '8px', borderBottom: '1px solid #E5E7EB', textAlign: 'right' }}>
                        {valuationMode === 'sf' ?
                          Math.round(sale.totalAcres * 43560).toLocaleString() :
                          sale.totalAcres?.toFixed(2)}
                      </td>
                    )}

                    <td style={{
                      padding: '8px',
                      borderBottom: '1px solid #E5E7EB',
                      textAlign: 'right',
                      fontWeight: 'bold',
                      color: sale.pricePerAcre > 100000 ? '#EF4444' : '#10B981'
                    }}>
                      {valuationMode === 'ff' ?
                        `$${sale.pricePerAcre?.toLocaleString()}` :
                        (valuationMode === 'sf' ? `$${(sale.sales_price / (sale.totalAcres * 43560)).toFixed(2)}` : `$${sale.pricePerAcre?.toLocaleString()}`)}
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
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                    {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.rawLand.count} sales</div>
                {categoryAnalysis.rawLand.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.rawLand.avgLotSize}
                  </div>
                )}
                {categoryAnalysis.rawLand.method === 'paired' && categoryAnalysis.rawLand.pairedAnalysis && (
                  <div style={{ fontSize: '9px', color: '#059669', marginTop: '2px' }}>
                    {categoryAnalysis.rawLand.count} properties �� {categoryAnalysis.rawLand.pairedAnalysis.pairs} comparisons
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>
                  Building Lot {categoryAnalysis.buildingLot.method === 'paired' && <span style={{ color: '#3B82F6' }}>✓ Paired</span>}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3B82F6' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.buildingLot.avg}` : `$${categoryAnalysis.buildingLot.avg.toLocaleString()}`}
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                    {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.buildingLot.count} sales</div>
                {categoryAnalysis.buildingLot.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.buildingLot.avgLotSize}
                  </div>
                )}
                {categoryAnalysis.buildingLot.method === 'paired' && categoryAnalysis.buildingLot.pairedAnalysis && (
                  <div style={{ fontSize: '9px', color: '#2563EB', marginTop: '2px' }}>
                    {categoryAnalysis.buildingLot.count} properties ��� {categoryAnalysis.buildingLot.pairedAnalysis.pairs} comparisons
                  </div>
                )}
              </div>
              <div style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px' }}>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>Wetlands</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#06B6D4' }}>
                  {valuationMode === 'sf' ? `$${categoryAnalysis.wetlands.avg}` : `$${categoryAnalysis.wetlands.avg.toLocaleString()}`}
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                    {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                  </span>
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
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                    {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                  </span>
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
                  <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                    {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{categoryAnalysis.conservation.count} sales</div>
                {categoryAnalysis.conservation.count > 0 && (
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    Avg: {categoryAnalysis.conservation.avgLotSize}
                  </div>
                )}
              </div>
            </div>

            {/* Special Regions Summary */}
            {categoryAnalysis.specialRegions && Object.keys(categoryAnalysis.specialRegions).length > 0 && (
              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #E5E7EB' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#374151' }}>
                  Special Regions (Analyzed Separately)
                </h4>
                <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                  {Object.entries(categoryAnalysis.specialRegions).map(([region, data]) => (
                    <div key={region} style={{ backgroundColor: 'white', padding: '10px', borderRadius: '4px', border: '1px solid #E5E7EB', minWidth: '180px' }}>
                      <div style={{ fontSize: '12px', color: '#6B7280' }}>
                        {region} {data.method === 'paired' && <span style={{ color: '#10B981' }}>✓ Paired</span>}
                        {data.method === 'single' && <span style={{ color: '#6B7280' }}>(Single Sale)</span>}
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#6366F1' }}>
                        {valuationMode === 'sf' ? `$${data.avg}` : `$${data.avg.toLocaleString()}`}
                        <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#6B7280', marginLeft: '4px' }}>
                          {valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                        {data.count} sale{data.count !== 1 ? 's' : ''}
                        {data.method === 'paired' && data.pairs && ` • ${data.pairs} pairs`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        Raw Land - Average of All Valid Pairs
                      </div>
                      <div style={{ fontSize: '11px', color: '#065F46' }}>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Properties:</strong> {categoryAnalysis.rawLand.pairedAnalysis.pairs} pairs analyzed
                        </div>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Average Rate:</strong> ${Math.round(categoryAnalysis.rawLand.avg).toLocaleString()}{valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                        </div>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Price Range:</strong> ${categoryAnalysis.rawLand.pairedAnalysis.minPriceDiff?.toLocaleString() || 0} - ${categoryAnalysis.rawLand.pairedAnalysis.maxPriceDiff?.toLocaleString() || 0}
                        </div>
                      </div>
                    </div>
                  )}

                  {categoryAnalysis.buildingLot.method === 'paired' && categoryAnalysis.buildingLot.pairedAnalysis && (
                    <div style={{ backgroundColor: '#EFF6FF', padding: '12px', borderRadius: '6px', border: '1px solid #BFDBFE' }}>
                      <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2563EB', marginBottom: '8px' }}>
                        Building Lot - Average of All Valid Pairs
                      </div>
                      <div style={{ fontSize: '11px', color: '#1E40AF' }}>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Properties:</strong> {categoryAnalysis.buildingLot.pairedAnalysis.pairs} pairs analyzed
                        </div>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Average Rate:</strong> ${Math.round(categoryAnalysis.buildingLot.avg).toLocaleString()}{valuationMode === 'sf' ? '/SF' : valuationMode === 'ff' ? '/FF' : '/acre'}
                        </div>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Price Range:</strong> ${categoryAnalysis.buildingLot.pairedAnalysis.minPriceDiff?.toLocaleString() || 0} - ${categoryAnalysis.buildingLot.pairedAnalysis.maxPriceDiff?.toLocaleString() || 0}
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '8px', fontStyle: 'italic' }}>
                  * Paired analysis extracts incremental raw land value between similar sales with different {valuationMode === 'ff' ? 'frontages' : valuationMode === 'sf' ? 'square footages' : 'acreages'}.
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
      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowBracketEditor(prev => !prev)}
              style={{
                padding: '8px 12px',
                backgroundColor: showBracketEditor ? '#F3F4F6' : 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              {showBracketEditor ? 'Hide Bracket Settings' : 'Edit Brackets'}
            </button>
          </div>

          {showBracketEditor && (
            <div style={{ marginTop: '12px', padding: '12px', borderRadius: '6px', backgroundColor: 'white', border: '1px solid #E5E7EB', width: '90%', maxWidth: '980px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#6B7280' }}>Prime max (acres)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bracketInputs.primeMax ?? ''}
                    onChange={(e) => setBracketInputs(prev => ({ ...prev, primeMax: e.target.value }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#6B7280' }}>Secondary max (acres)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bracketInputs.secondaryMax ?? ''}
                    onChange={(e) => setBracketInputs(prev => ({ ...prev, secondaryMax: e.target.value }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#6B7280' }}>Excess max (acres)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bracketInputs.excessMax ?? ''}
                    onChange={(e) => setBracketInputs(prev => ({ ...prev, excessMax: e.target.value }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#6B7280' }}>Residual max (acres)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={bracketInputs.residualMax ?? ''}
                    onChange={(e) => setBracketInputs(prev => ({ ...prev, residualMax: e.target.value }))}
                    placeholder="leave empty for open-ended"
                    style={{ width: '100%', padding: '8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
                  />
                </div>
              </div>
              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  onClick={() => { applyDefaultQuartileBrackets(); /* keep editor open to show changes */ }}
                  style={{ padding: '8px 12px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Apply Quartile Defaults
                </button>
                <button
                  onClick={() => { validateAndApplyBrackets({ recalc: true }); setShowBracketEditor(false); }}
                  style={{ padding: '8px 12px', backgroundColor: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Apply
                </button>
                <button
                  onClick={() => setShowBracketEditor(false)}
                  style={{ padding: '8px 12px', backgroundColor: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Close
                </button>
                <button
                  onClick={() => { validateAndApplyBrackets({ recalc: true }); saveRates(); }}
                  style={{ padding: '8px 12px', backgroundColor: '#10B981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Save Brackets
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Method 2: Improved Sale Lot Size Analysis */}
      <div style={{ marginBottom: '30px', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Method 2: Improved Sale Lot Size Analysis</h3>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Type & Use</label>
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
                    {option.description}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Typical Lot Size Hint */}
          {calculateTypicalLotSize && (
            <div style={{ marginTop: '12px', padding: '10px 12px', backgroundColor: '#DBEAFE', border: '1px solid #93C5FD', borderRadius: '6px' }}>
              <div style={{ fontSize: '12px', color: '#0C4A6E', fontWeight: '500' }}>
                💡 Typical Residential Lot: <span style={{ fontWeight: '700' }}>{calculateTypicalLotSize.median} acres</span>
                <span style={{ fontSize: '10px', color: '#0C4A6E', marginLeft: '6px' }}>
                  ({calculateTypicalLotSize.count} properties, range: {calculateTypicalLotSize.min}-{calculateTypicalLotSize.max} acres)
                </span>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '10px 15px 5px 15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F9FAFB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>
            {Object.keys(bracketAnalysis).length} VCS areas • Filtered by: {method2TypeFilter} ({getTypeUseOptions().find(opt => opt.code === method2TypeFilter)?.description || 'Unknown'})
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={() => setExcludedMethod2VCS(new Set())}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                backgroundColor: '#10B981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
              title="Include all VCSs in summary calculation"
            >
              ✓ Select All
            </button>
            <button
              onClick={() => setExcludedMethod2VCS(new Set(Object.keys(bracketAnalysis)))}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                backgroundColor: '#EF4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
              title="Exclude all VCSs from summary calculation"
            >
              ✗ Deselect All
            </button>
            <span style={{ fontSize: '11px', color: '#6B7280', marginLeft: '4px' }}>
              {Object.keys(bracketAnalysis).length - excludedMethod2VCS.size} of {Object.keys(bracketAnalysis).length} included
            </span>
            <div style={{ width: '1px', height: '20px', backgroundColor: '#D1D5DB', margin: '0 8px' }}></div>
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
              const isExcluded = excludedMethod2VCS.has(vcs);
              const vcsColors = generateVCSColor(vcs, index);

              // Format VCS summary line exactly like screenshot
              const summaryLine = `${data.totalSales} sales ����� Avg $${Math.round(data.avgPrice).toLocaleString()} ����������������� ${data.avgAcres.toFixed(2)} • $${Math.round(data.avgAdjusted).toLocaleString()}-$${data.impliedRate || 0} ���� $${data.impliedRate || 0}`;

              return (
                <div key={vcs} style={{
                  marginBottom: '8px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  opacity: isExcluded ? 0.5 : 1,
                  filter: isExcluded ? 'grayscale(60%)' : 'none'
                }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newExcluded = new Set(excludedMethod2VCS);
                          if (isExcluded) {
                            newExcluded.delete(vcs);
                          } else {
                            newExcluded.add(vcs);
                          }
                          setExcludedMethod2VCS(newExcluded);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '16px',
                          height: '16px',
                          cursor: 'pointer',
                          margin: 0
                        }}
                        title={isExcluded ? 'Click to include in summary' : 'Click to exclude from summary'}
                      />
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
                        {` ��� Avg $${Math.round(data.avgPrice).toLocaleString()} �� ${data.avgAcres.toFixed(2)} • $${Math.round(data.avgAdjusted).toLocaleString()}-$${data.impliedRate || 0} �� $${data.impliedRate || 0}`}
                      </span>
                      </div>
                    </div>
                    <span style={{ fontSize: '16px', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                      ����
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
                          {(() => {
                            const pMax = cascadeConfig.normal?.prime?.max ?? 1;
                            const sMax = cascadeConfig.normal?.secondary?.max ?? 5;
                            const eMax = cascadeConfig.normal?.excess?.max ?? 10;
                            const rMax = cascadeConfig.normal?.residual?.max ?? null;

                            const brackets = [
                              { key: 'small', label: `<${pMax.toFixed(2)}`, data: data.brackets.small },
                              { key: 'medium', label: `${pMax.toFixed(2)}-${sMax.toFixed(2)}`, data: data.brackets.medium },
                              { key: 'large', label: `${sMax.toFixed(2)}-${eMax.toFixed(2)}`, data: data.brackets.large },
                              { key: 'xlarge', label: rMax ? `${eMax.toFixed(2)}-${rMax.toFixed(2)}` : `>${eMax.toFixed(2)}`, data: data.brackets.xlarge }
                            ];

                            return brackets.map((bracket, index) => {
                              if (!bracket.data || bracket.data.count === 0) return null;

                              // Find the bracket with the highest adjusted value that's still lower than current
                              let comparisonBracket = null;
                              let highestValidAdjusted = 0;

                              for (let i = 0; i < index; i++) {
                                const candidate = brackets[i].data;

                                if (candidate &&
                                    candidate.count > 0 &&
                                    candidate.avgAdjusted &&
                                    candidate.avgAdjusted < bracket.data.avgAdjusted &&
                                    candidate.avgAdjusted > highestValidAdjusted) {
                                  comparisonBracket = candidate;
                                  highestValidAdjusted = candidate.avgAdjusted;
                                }
                              }

                              let adjustedDelta = null;
                              let lotDelta = null;
                              let perAcre = null;
                              let perSqFt = null;

                              if (comparisonBracket) {
                                adjustedDelta = bracket.data.avgAdjusted - comparisonBracket.avgAdjusted;
                                lotDelta = bracket.data.avgAcres - comparisonBracket.avgAcres;

                                if (adjustedDelta > 0 && lotDelta > 0) {
                                  perAcre = adjustedDelta / lotDelta;
                                  perSqFt = perAcre / 43560;
                                }
                              }

                              return (
                                <tr key={bracket.key} style={{ backgroundColor: '#FFFFFF' }}>
                                  <td style={{ padding: '6px 8px', fontWeight: '500', borderBottom: '1px solid #F1F3F4' }}>{bracket.label}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #F1F3F4' }}>{bracket.data.count}</td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {bracket.data.avgAcres ? bracket.data.avgAcres.toFixed(2) : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {bracket.data.avgSalePrice ? `$${Math.round(bracket.data.avgSalePrice).toLocaleString()}` : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {bracket.data.avgSFLA ? Math.round(bracket.data.avgSFLA).toLocaleString() : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {bracket.data.avgAdjusted ? `$${Math.round(bracket.data.avgAdjusted).toLocaleString()}` : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {adjustedDelta !== null ? `$${Math.round(adjustedDelta).toLocaleString()}` : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #F1F3F4' }}>
                                    {lotDelta !== null ? lotDelta.toFixed(2) : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #F1F3F4' }}>
                                    {perAcre !== null ? `$${Math.round(perAcre).toLocaleString()}` : 'N/A'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 'bold', borderBottom: '1px solid #F1F3F4' }}>
                                    {perSqFt !== null ? `$${perSqFt.toFixed(2)}` : '-'}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#1F2937' }}>
                  Method 2 Summary - Implied {valuationMode === 'sf' ? '$/Square Foot Rates' : '$/Acre Rates'}
                </h4>
                {method2Summary.excludedVCSCount > 0 && (
                  <span style={{ fontSize: '12px', color: '#EF4444', fontWeight: '600', backgroundColor: '#FEE2E2', padding: '4px 12px', borderRadius: '4px' }}>
                    {method2Summary.excludedVCSCount} VCS excluded from summary
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {/* dynamic bracket labels based on cascadeConfig */}
                {(() => {
                  const p = cascadeConfig.normal?.prime?.max ?? 1;
                  const s = cascadeConfig.normal?.secondary?.max ?? 5;
                  const e = cascadeConfig.normal?.excess?.max ?? 10;
                  const r = cascadeConfig.normal?.residual?.max ?? null;

                  const labelMedium = `${p.toFixed(2)}-${s.toFixed(2)}`;
                  const labelLarge = `${s.toFixed(2)}-${e.toFixed(2)}`;
                  const labelXlarge = r ? `${e.toFixed(2)}-${r.toFixed(2)}` : `>${e.toFixed(2)}`;

                  return (
                    <>
                      {/* medium */}
                      <div style={{ textAlign: 'center', minWidth: '150px' }}>
                        <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>{labelMedium} Acres</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#059669' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.mediumRange?.perSqFt !== 'N/A' ? `$${method2Summary.mediumRange?.perSqFt}/SF` : 'N/A') :
                            (method2Summary.mediumRange?.perAcre !== 'N/A' ? `$${method2Summary.mediumRange?.perAcre?.toLocaleString()}` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '12px', color: '#6B7280' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.mediumRange?.perAcre !== 'N/A' ? `$${method2Summary.mediumRange?.perAcre?.toLocaleString()}/AC` : 'N/A') :
                            (method2Summary.mediumRange?.perSqFt !== 'N/A' ? `$${method2Summary.mediumRange?.perSqFt}/SF` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                          ({method2Summary.mediumRange?.count || 0} VCS)
                        </div>
                      </div>

                      {/* large */}
                      <div style={{ textAlign: 'center', minWidth: '150px' }}>
                        <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>{labelLarge} Acres</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0D9488' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.largeRange?.perSqFt !== 'N/A' ? `$${method2Summary.largeRange?.perSqFt}/SF` : 'N/A') :
                            (method2Summary.largeRange?.perAcre !== 'N/A' ? `$${method2Summary.largeRange?.perAcre?.toLocaleString()}` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '12px', color: '#6B7280' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.largeRange?.perAcre !== 'N/A' ? `$${method2Summary.largeRange?.perAcre?.toLocaleString()}/AC` : 'N/A') :
                            (method2Summary.largeRange?.perSqFt !== 'N/A' ? `$${method2Summary.largeRange?.perSqFt}/SF` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                          ({method2Summary.largeRange?.count || 0} VCS)
                        </div>
                      </div>

                      {/* xlarge */}
                      <div style={{ textAlign: 'center', minWidth: '150px' }}>
                        <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '4px' }}>{labelXlarge}</div>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#7C3AED' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.xlargeRange?.perSqFt !== 'N/A' ? `$${method2Summary.xlargeRange?.perSqFt}/SF` : 'N/A') :
                            (method2Summary.xlargeRange?.perAcre !== 'N/A' ? `$${method2Summary.xlargeRange?.perAcre?.toLocaleString()}` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '12px', color: '#6B7280' }}>
                          {valuationMode === 'sf' ?
                            (method2Summary.xlargeRange?.perAcre !== 'N/A' ? `$${method2Summary.xlargeRange?.perAcre?.toLocaleString()}/AC` : 'N/A') :
                            (method2Summary.xlargeRange?.perSqFt !== 'N/A' ? `$${method2Summary.xlargeRange?.perSqFt}/SF` : 'N/A')
                          }
                        </div>
                        <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
                          ({method2Summary.xlargeRange?.count || 0} VCS)
                        </div>
                      </div>
                    </>
                  );
                })()}

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

                      const avgAcre = Math.round(allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length);
                      if (valuationMode === 'sf') {
                        const avgSf = (avgAcre / 43560).toFixed(2);
                        return `$${avgSf}/SF`;
                      }

                      return `$${avgAcre.toLocaleString()}`;
                    })()}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    {(() => {
                      const allRates = [];
                      if (method2Summary.mediumRange?.perAcre !== 'N/A') allRates.push(method2Summary.mediumRange.perAcre);
                      if (method2Summary.largeRange?.perAcre !== 'N/A') allRates.push(method2Summary.largeRange.perAcre);
                      if (method2Summary.xlargeRange?.perAcre !== 'N/A') allRates.push(method2Summary.xlargeRange.perAcre);

                      if (allRates.length === 0) return 'N/A';

                      const avgAcre = Math.round(allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length);
                      const perSqFt = (avgAcre / 43560).toFixed(2);

                      // show secondary value (opposite of primary)
                      return valuationMode === 'sf' ? `$${avgAcre.toLocaleString()}/AC` : `$${perSqFt}/SF`;
                    })()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>
                    {(() => {
                      // Calculate average lot size across all positive deltas
                      const allLotAcres = [];
                      if (method2Summary.mediumRange?.avgAcres) allLotAcres.push(method2Summary.mediumRange.avgAcres);
                      if (method2Summary.largeRange?.avgAcres) allLotAcres.push(method2Summary.largeRange.avgAcres);
                      if (method2Summary.xlargeRange?.avgAcres) allLotAcres.push(method2Summary.xlargeRange.avgAcres);

                      if (allLotAcres.length === 0) {
                        return `(${(method2Summary.mediumRange?.count || 0) + (method2Summary.largeRange?.count || 0) + (method2Summary.xlargeRange?.count || 0)} Total)`;
                      }

                      const avgLotAcres = allLotAcres.reduce((sum, acres) => sum + acres, 0) / allLotAcres.length;
                      const avgLotSF = Math.round(avgLotAcres * 43560);

                      return `${avgLotAcres.toFixed(2)} AC / ${avgLotSF.toLocaleString()} SF avg lot | ${(method2Summary.mediumRange?.count || 0) + (method2Summary.largeRange?.count || 0) + (method2Summary.xlargeRange?.count || 0)} Total`;
                    })()}
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
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', border: '1px solid #E5E7EB' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB' }}>
                    <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #E5E7EB' }}>Zoning</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>Zoning Lot</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>Land Value</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>Min Frontage</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>Standard FF</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>Excess FF</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    try {
                      const zcfg = marketLandData?.zoning_config || {};
                      const zoneKeys = Object.keys(zcfg || {}).sort();
                      if (zoneKeys.length === 0) {
                        return (
                          <tr>
                            <td colSpan="6" style={{ padding: '8px', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                              No zoning with depth tables available.
                            </td>
                          </tr>
                        );
                      }

                      // Use average across ALL positive deltas instead of just lowest bracket
                      const allRates = [];
                      const allLotAcres = [];
                      if (method2Summary?.mediumRange?.perAcre && method2Summary.mediumRange.perAcre !== 'N/A') {
                        allRates.push(method2Summary.mediumRange.perAcre);
                        if (method2Summary.mediumRange.avgAcres) allLotAcres.push(method2Summary.mediumRange.avgAcres);
                      }
                      if (method2Summary?.largeRange?.perAcre && method2Summary.largeRange.perAcre !== 'N/A') {
                        allRates.push(method2Summary.largeRange.perAcre);
                        if (method2Summary.largeRange.avgAcres) allLotAcres.push(method2Summary.largeRange.avgAcres);
                      }
                      if (method2Summary?.xlargeRange?.perAcre && method2Summary.xlargeRange.perAcre !== 'N/A') {
                        allRates.push(method2Summary.xlargeRange.perAcre);
                        if (method2Summary.xlargeRange.avgAcres) allLotAcres.push(method2Summary.xlargeRange.avgAcres);
                      }

                      let chosenPerAcre = null;
                      let overallAvgAcres = null;

                      if (allRates.length > 0) {
                        // Use average of all positive deltas
                        chosenPerAcre = Math.round(allRates.reduce((sum, rate) => sum + rate, 0) / allRates.length);
                      }

                      if (allLotAcres.length > 0) {
                        // Use average lot size across all positive deltas
                        overallAvgAcres = allLotAcres.reduce((sum, acres) => sum + acres, 0) / allLotAcres.length;
                      }

                      const summaryTypicalSF = overallAvgAcres != null ? Math.round(overallAvgAcres * 43560) : null;
                      const perSqFtSummary = (chosenPerAcre != null && chosenPerAcre !== 'N/A') ? (parseFloat(chosenPerAcre) / 43560) : null;
                      const summaryLandValue = (perSqFtSummary && summaryTypicalSF) ? Math.round(perSqFtSummary * summaryTypicalSF) : null;

                      // Build rows array so we can append summary and recommended rows
                      const rows = [];

                      // Top summary row showing overall average metrics (from all positive deltas)
                      rows.push(
                        <tr key="__summary__" style={{ fontWeight: '600', backgroundColor: '#F3F4F6' }}>
                          <td style={{ padding: '6px', border: '1px solid #E5E7EB' }}>Overall Average (all positive deltas)</td>
                          <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{overallAvgAcres != null ? `${(Math.round(overallAvgAcres*100)/100).toFixed(2)} / ${summaryTypicalSF.toLocaleString()} SF` : 'N/A'}</td>
                          <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{summaryLandValue != null ? `$${Number(summaryLandValue).toLocaleString()}` : 'N/A'}</td>
                          <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                          <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                          <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                        </tr>
                      );

                      // Collect FF arrays for recommended summary
                      const standardFFs = [];
                      const excessFFs = [];

                      zoneKeys.forEach(zoneKey => {
                        const entry = zcfg[zoneKey] || zcfg[zoneKey?.toUpperCase?.()] || zcfg[zoneKey?.toLowerCase?.()] || null;
                        if (!entry) return;
                        const depthTable = entry.depth_table || entry.depthTable || entry.depth_table_name || '';
                        const minFrontage = entry.min_frontage || entry.minFrontage || null;

                        // Only include zones with an assigned depth table AND a min frontage
                        if (!depthTable || !minFrontage) return;

                        // Determine zoning lot from config if present, otherwise fallback to property average
                        let typicalLotAcres = '';
                        let typicalLotSF = '';
                        const cfgSize = entry.min_size || entry.minSize || entry.typical_lot || null;
                        const cfgUnit = (entry.min_size_unit || entry.minSizeUnit || '').toString().toUpperCase();
                        if (cfgSize) {
                          if (cfgUnit === 'SF') {
                            typicalLotSF = Math.round(Number(cfgSize));
                            typicalLotAcres = Number((typicalLotSF / 43560).toFixed(2));
                          } else {
                            // assume acres
                            typicalLotAcres = Number(Number(cfgSize).toFixed(2));
                            typicalLotSF = Math.round(typicalLotAcres * 43560);
                          }
                        } else {
                          // fallback: average from properties
                          const propsForZone = (properties || []).filter(p => p.asset_zoning && p.asset_zoning.toString().trim().toLowerCase() === zoneKey.toString().trim().toLowerCase());
                          let avgAcres = null;
                          if (propsForZone.length > 0) {
                            avgAcres = propsForZone.reduce((s, p) => s + (calculateAcreage(p) || 0), 0) / propsForZone.length;
                          }
                          typicalLotAcres = avgAcres !== null ? Number(avgAcres.toFixed(2)) : '';
                          typicalLotSF = avgAcres !== null ? Math.round(avgAcres * 43560) : '';
                        }

                        const perAcre = chosenPerAcre != null ? chosenPerAcre : 'N/A';

                        // Apply Jim's magic formula per-zone using LOT SF values when possible:
                        // AdjustedLotValue = ((ZLS - GLS) * ((GP / GLS) * 0.50)) + GP
                        // Where: ZLS = typicalLotSF (zone), GLS = summaryTypicalSF (global typical lot SF), GP = summaryLandValue (global lot land value)
                        let landValue = '';
                        if (summaryTypicalSF && summaryLandValue && typicalLotSF) {
                          try {
                            const ZLS = Number(typicalLotSF);
                            const GLS = Number(summaryTypicalSF);
                            const GP = Number(summaryLandValue);
                            // Guard against division by zero
                            if (GLS > 0) {
                              const adjusted = ((ZLS - GLS) * ((GP / GLS) * 0.5)) + GP;
                              landValue = Math.round(adjusted);
                            } else {
                              landValue = '';
                            }
                          } catch (e) {
                            landValue = '';
                          }
                        } else {
                          // Fallback: use top-level per-acre rate
                          const perSqFt = perAcre && perAcre !== 'N/A' ? (parseFloat(perAcre) / 43560) : null;
                          landValue = (perSqFt && typicalLotSF) ? Math.round(perSqFt * typicalLotSF) : '';
                        }

                        // Standard FF: integer (no decimals), Excess FF = half (integer)
                        const standardFF = (landValue && minFrontage) ? Math.round(landValue / minFrontage) : '';
                        const excessFF = standardFF !== '' ? Math.round(standardFF / 2) : '';

                        if (standardFF !== '') standardFFs.push(standardFF);
                        if (excessFF !== '') excessFFs.push(excessFF);

                        rows.push(
                          <tr key={zoneKey}>
                            <td style={{ padding: '6px', border: '1px solid #E5E7EB' }}>{zoneKey}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{typicalLotAcres !== '' ? `${typicalLotAcres} / ${typicalLotSF.toLocaleString()} SF` : 'N/A'}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{landValue !== '' ? `$${Number(landValue).toLocaleString()}` : 'N/A'}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{minFrontage}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{standardFF !== '' ? `$${standardFF.toLocaleString()}` : 'N/A'}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{excessFF !== '' ? `$${excessFF.toLocaleString()}` : 'N/A'}</td>
                          </tr>
                        );
                      });

                      // Recommended rounded summary from averages of standardFF and excessFF
                      let recStandard = null;
                      let recExcess = null;
                      if (standardFFs.length > 0 && excessFFs.length > 0) {
                        const avgStandard = standardFFs.reduce((s, v) => s + v, 0) / standardFFs.length;
                        const avgExcess = excessFFs.reduce((s, v) => s + v, 0) / excessFFs.length;
                        // Round recommended to nearest hundredth (2 decimals)
                        recStandard = Number(avgStandard.toFixed(2));
                        recExcess = Number(avgExcess.toFixed(2));

                        rows.push(
                          <tr key="__recommended__" style={{ fontWeight: '700', backgroundColor: '#ECFDF5' }}>
                            <td style={{ padding: '6px', border: '1px solid #E5E7EB' }}>Recommended Front Foot</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}></td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${recStandard.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${recExcess.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          </tr>
                        );
                      }

                      return rows;

                    } catch (e) {
                      debug('Failed to render implied front foot rates:', e);
                      return (
                        <tr>
                          <td colSpan="6" style={{ padding: '8px', color: '#EF4444' }}>Error rendering table</td>
                        </tr>
                      );
                    }
                  })()}
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
              // SQUARE FOOT MODE: Standard + Excess
              <>
                <div>
                  <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                    Standard (0-{cascadeConfig.normal.standard?.max || 5000} sq ft)
                  </label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="number"
                      value={cascadeConfig.normal.standard?.max || ''}
                      onChange={(e) => updateCascadeBreak('standard', 'max', e.target.value)}
                      placeholder="Max sq ft"
                      style={{
                        width: '120px',
                        padding: '8px',
                        border: '1px solid #D1D5DB',
                        borderRadius: '4px'
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.normal.standard?.rate || ''}
                      onChange={(e) => updateCascadeBreak('standard', 'rate', e.target.value)}
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
                    Excess ({cascadeConfig.normal.standard?.max || 5000}+ sq ft)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cascadeConfig.normal.excess?.rate || ''}
                    onChange={(e) => updateCascadeBreak('excess', 'rate', e.target.value)}
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

            {/* VCS Assignment Field */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '6px', fontWeight: '500' }}>
                Assigned VCS
              </label>

              {/* Dropdown to add VCS */}
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    const assignedList = cascadeConfig.special[region]?.vcsList
                      ? cascadeConfig.special[region].vcsList.split(',').map(v => v.trim()).filter(v => v)
                      : [];
                    const newList = [...assignedList, e.target.value].join(', ');
                    updateSpecialRegionVCSList(region, newList);
                    e.target.value = ''; // Reset dropdown
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #BFDBFE',
                  borderRadius: '4px',
                  fontSize: '13px',
                  backgroundColor: 'white',
                  marginBottom: '8px'
                }}
              >
                <option value="">+ Add VCS...</option>
                {Object.keys(vcsSheetData).sort((a, b) => {
                  // Check if values are purely numeric
                  const aIsNumeric = /^\d+$/.test(a);
                  const bIsNumeric = /^\d+$/.test(b);

                  // Both numeric: sort numerically
                  if (aIsNumeric && bIsNumeric) {
                    return parseInt(a) - parseInt(b);
                  }

                  // One numeric, one not: numeric comes first
                  if (aIsNumeric) return -1;
                  if (bIsNumeric) return 1;

                  // Both non-numeric: sort alphabetically
                  return a.localeCompare(b);
                }).map(vcs => {
                  const assignedList = cascadeConfig.special[region]?.vcsList
                    ? cascadeConfig.special[region].vcsList.split(',').map(v => v.trim()).filter(v => v)
                    : [];
                  const isAssigned = assignedList.includes(vcs);

                  if (isAssigned) return null; // Don't show if already assigned

                  return (
                    <option key={vcs} value={vcs}>
                      VCS {vcs}
                    </option>
                  );
                })}
              </select>

              {/* Assigned VCS badges */}
              <div style={{ minHeight: '36px', padding: '8px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '4px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'start' }}>
                {(() => {
                  const assignedList = cascadeConfig.special[region]?.vcsList
                    ? cascadeConfig.special[region].vcsList.split(',').map(v => v.trim()).filter(v => v)
                    : [];

                  // Sort: numeric first (numerically), then alphabetic
                  assignedList.sort((a, b) => {
                    const aIsNumeric = /^\d+$/.test(a);
                    const bIsNumeric = /^\d+$/.test(b);

                    if (aIsNumeric && bIsNumeric) return parseInt(a) - parseInt(b);
                    if (aIsNumeric) return -1;
                    if (bIsNumeric) return 1;
                    return a.localeCompare(b);
                  });

                  if (assignedList.length === 0) {
                    return <span style={{ color: '#9CA3AF', fontSize: '12px', fontStyle: 'italic' }}>No VCS assigned</span>;
                  }

                  return assignedList.map(vcs => (
                    <span
                      key={vcs}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: '#1E40AF',
                        color: 'white',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {vcs}
                      <button
                        onClick={() => {
                          const newList = assignedList.filter(v => v !== vcs).join(', ');
                          updateSpecialRegionVCSList(region, newList);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '16px',
                          lineHeight: '1',
                          padding: '0',
                          fontWeight: 'bold'
                        }}
                        title="Click to remove"
                      >
                        ×
                      </button>
                    </span>
                  ));
                })()}
              </div>
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
                      Standard (0-{cascadeConfig.special[region]?.standard?.max || 5000} sq ft)
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
                        step="0.01"
                        value={cascadeConfig.special[region]?.standard?.rate || ''}
                        onChange={(e) => updateSpecialRegionCascade(region, 'standard', 'rate', e.target.value)}
                        placeholder="Rate"
                        style={{ flex: 1, padding: '6px', border: '1px solid #BFDBFE', borderRadius: '4px' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#1E40AF', display: 'block', marginBottom: '4px' }}>
                      Excess ({cascadeConfig.special[region]?.standard?.max || 5000}+ sq ft)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={cascadeConfig.special[region]?.excess?.rate || ''}
                      onChange={(e) => updateSpecialRegionCascade(region, 'excess', 'rate', e.target.value)}
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
                      const sizeForUnit = valuationMode === 'ff' ? (parseFloat(prop.asset_lot_frontage) || 0) : acres;
                      const pricePerUnit = getPricePerUnit(prop.values_norm_time || prop.sales_price, sizeForUnit);
                      
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
                ����
              </button>
            </div>

            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#FEF3C7', borderRadius: '4px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#92400E' }}>
                <strong>Exclude problematic sales:</strong> Uncheck sales that should not be used in Method 2 calculations
                (teardowns, poor condition, pre-construction, etc.).
                <span style={{ display: 'block', marginTop: '4px' }}>
                  �������️ <strong>Yellow highlighted rows</strong> are pre-construction sales (sold before year built).
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
                      Block {modalSortField === 'block' ? (modalSortDirection === 'asc' ? '���' : '���') : ''}
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
                      Lot {modalSortField === 'lot' ? (modalSortDirection === 'asc' ? '��' : '↓') : ''}
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
                      Address {modalSortField === 'address' ? (modalSortDirection === 'asc' ? '↑' : '��������') : ''}
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
                      Sale Date {modalSortField === 'saleDate' ? (modalSortDirection === 'asc' ? '↑' : '������������') : ''}
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
                      Sale Price {modalSortField === 'salePrice' ? (modalSortDirection === 'asc' ? '��' : '���') : ''}
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
                      Norm Time {modalSortField === 'normTime' ? (modalSortDirection === 'asc' ? '���' : '↓') : ''}
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
                      Acres {modalSortField === 'acres' ? (modalSortDirection === 'asc' ? '↑' : '��') : ''}
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
                      SFLA {modalSortField === 'sfla' ? (modalSortDirection === 'asc' ? '↑' : '���������') : ''}
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
                      Year Built {modalSortField === 'yearBuilt' ? (modalSortDirection === 'asc' ? '������' : '↓') : ''}
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
                      Type/Use {modalSortField === 'typeUse' ? (modalSortDirection === 'asc' ? '↑' : '�������������') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortModalData(getMethod2SalesForVCS(method2ModalVCS)).map(prop => {
                    const acres = parseFloat(calculateAcreage(prop) || 0);
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
                      onChange={(e) => {
                        const value = e.target.value;
                        debug('����� Target allocation input changed:', value);
                        // Fix: Parse as number to prevent caching issues
                        setTargetAllocation(value === '' ? null : parseFloat(value));
                      }}
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
                    <button
                      onClick={() => {
                        debug('💾 Save button clicked for target allocation:', targetAllocation);
                        saveTargetAllocation();
                      }}
                      disabled={!targetAllocation || targetAllocation === ''}
                      style={{
                        backgroundColor: (!targetAllocation || targetAllocation === '') ? '#9CA3AF' : '#3B82F6',
                        color: 'white',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: (!targetAllocation || targetAllocation === '') ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        marginLeft: '8px',
                        opacity: (!targetAllocation || targetAllocation === '') ? 0.5 : 1
                      }}
                      title={(!targetAllocation || targetAllocation === '') ? 'Enter a target allocation percentage first' : 'Save target allocation to database'}
                    >
                      Save
                    </button>
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
          <table style={{
            width: '100%',
            fontSize: '12px',
            borderCollapse: 'collapse',
            border: '1px solid #D1D5DB'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #D1D5DB' }}>
                {/* Vacant Sale Info */}
                <th style={{
                  padding: '8px',
                  borderRight: '2px solid #E5E7EB',
                  border: '1px solid #D1D5DB',
                  fontWeight: 'bold'
                }} colSpan={valuationMode === 'ff' ? "8" : "6"}>Vacant Sale</th>
                {/* Improved Sales Info */}
                <th style={{
                  padding: '8px',
                  borderRight: '2px solid #E5E7EB',
                  border: '1px solid #D1D5DB',
                  fontWeight: 'bold'
                }} colSpan={valuationMode === 'ff' ? "6" : "4"}>Improved Sales (Same Year)</th>
                {/* Allocation Results */}
                <th style={{
                  padding: '8px',
                  border: '1px solid #D1D5DB',
                  fontWeight: 'bold'
                }} colSpan="3">Allocation Analysis</th>
              </tr>
              <tr style={{ backgroundColor: '#F3F4F6', fontSize: '11px', borderBottom: '1px solid #D1D5DB' }}>
                {/* Vacant Sale Columns */}
                <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>VCS</th>
                <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>Year</th>
                <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>Block/Lot</th>
                <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Price</th>
                {valuationMode === 'ff' ? (
                  <>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Front Feet</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Depth</th>
                    <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Zone</th>
                    <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Site Value</th>
                  </>
                ) : (
                  <>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Acres</th>
                    <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Site Value</th>
                  </>
                )}
                {/* Improved Sales Columns */}
                <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Count</th>
                <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Price</th>
                {valuationMode === 'ff' ? (
                  <>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg FF</th>
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Depth</th>
                  </>
                ) : (
                  <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Acres</th>
                )}
                <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Total Land Value</th>
                {/* Allocation Columns */}
                <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Current %</th>
                <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Recommended %</th>
                <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {vacantTestSales.filter(sale => sale.region === 'Normal').map((sale, index) => (
                <tr
                  key={`${sale.id}_${index}`}
                  style={{
                    backgroundColor: sale.isPositive ? (index % 2 === 0 ? 'white' : '#F9FAFB') : '#FEF2F2',
                    opacity: sale.isPositive ? 1 : 0.7,
                    borderBottom: '1px solid #E5E7EB'
                  }}
                >
                  {/* Vacant Sale Data */}
                  <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>{sale.vcs}</td>
                  <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{sale.year}</td>
                  <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{sale.block}/{sale.lot}</td>
                  <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${sale.vacantPrice?.toLocaleString()}</td>
                  {valuationMode === 'ff' ? (
                    <>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{Math.round(sale.frontFeet) || '-'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{Math.round(sale.depth) || '-'}</td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{sale.zone || '-'}</td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        color: sale.siteValue > 0 ? '#10B981' : '#EF4444',
                        borderRight: '2px solid #E5E7EB',
                        border: '1px solid #E5E7EB'
                      }}>
                        ${Math.round(sale.siteValue).toLocaleString()}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.acres?.toFixed(2)}</td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        color: sale.siteValue > 0 ? '#10B981' : '#EF4444',
                        borderRight: '2px solid #E5E7EB',
                        border: '1px solid #E5E7EB'
                      }}>
                        ${Math.round(sale.siteValue).toLocaleString()}
                      </td>
                    </>
                  )}

                  {/* Improved Sales Data */}
                  <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{sale.improvedSalesCount}</td>
                  <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${Math.round(sale.avgImprovedPrice)?.toLocaleString()}</td>
                  {valuationMode === 'ff' ? (
                    <>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.avgImprovedFF ? parseFloat(sale.avgImprovedFF).toFixed(2) : '-'}</td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.avgImprovedDepth ? parseFloat(sale.avgImprovedDepth).toFixed(2) : '-'}</td>
                    </>
                  ) : (
                    <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{parseFloat(sale.avgImprovedAcres).toFixed(2)}</td>
                  )}
                  <td style={{
                    padding: '8px',
                    textAlign: 'right',
                    fontWeight: 'bold',
                    borderRight: '2px solid #E5E7EB',
                    border: '1px solid #E5E7EB'
                  }}>
                    ${Math.round(sale.totalLandValue)?.toLocaleString()}
                  </td>

                  {/* Allocation Results */}
                  <td style={{ padding: '8px', textAlign: 'center', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                    {(sale.currentAllocation * 100).toFixed(1)}%
                  </td>
                  <td style={{
                    padding: '8px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    border: '1px solid #E5E7EB',
                    backgroundColor: sale.isPositive ?
                      (sale.recommendedAllocation >= 0.25 && sale.recommendedAllocation <= 0.40 ? '#D1FAE5' :
                       sale.recommendedAllocation >= 0.20 && sale.recommendedAllocation <= 0.45 ? '#FEF3C7' : '#FEE2E2') :
                      'transparent'
                  }}>
                    {(sale.recommendedAllocation * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
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
            const normalRegionSales = vacantTestSales.filter(s => s.region === 'Normal');
            const positiveSales = normalRegionSales.filter(s => s.isPositive);
            const totalLandValue = positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0);
            const totalSalePrice = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
            const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', fontSize: '14px' }}>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Normal Region Sales Included</div>
                  <div style={{ fontWeight: 'bold', color: '#10B981' }}>{positiveSales.length} of {normalRegionSales.length}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Land Value</div>
                  <div style={{ fontWeight: 'bold' }}>${Math.round(totalLandValue).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Sale Price</div>
                  <div style={{ fontWeight: 'bold' }}>${Math.round(totalSalePrice).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ color: '#6B7280', fontSize: '12px' }}>Normal Region Recommended</div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#F59E0B' }}>{overallRecommended.toFixed(1)}%</div>
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* Special Region Individual Allocation Analysis - Separate Section per Region */}
      {getUniqueRegions().filter(regionName => regionName !== 'Normal').map(regionName => {
        const regionSales = vacantTestSales.filter(sale => sale.region === regionName);
        if (regionSales.length === 0) return null;

        return (
          <div key={regionName} style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB', marginTop: '20px' }}>
            <div style={{ padding: '15px', borderBottom: '1px solid #E5E7EB', backgroundColor: '#F3E8FF' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#8B5CF6' }}>{regionName} Individual Allocation Analysis</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6B7280' }}>
                Vacant sales using {regionName} cascade rates
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                fontSize: '12px',
                borderCollapse: 'collapse',
                border: '1px solid #D1D5DB'
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #D1D5DB' }}>
                    {/* Vacant Sale Info */}
                    <th style={{
                      padding: '8px',
                      borderRight: '2px solid #E5E7EB',
                      border: '1px solid #D1D5DB',
                      fontWeight: 'bold'
                    }} colSpan={valuationMode === 'ff' ? "9" : "7"}>Vacant Sale</th>
                {/* Improved Sales Info */}
                <th style={{
                  padding: '8px',
                  borderRight: '2px solid #E5E7EB',
                  border: '1px solid #D1D5DB',
                  fontWeight: 'bold'
                }} colSpan={valuationMode === 'ff' ? "6" : "4"}>Improved Sales (All Years)</th>
                    {/* Allocation Results */}
                    <th style={{
                      padding: '8px',
                      border: '1px solid #D1D5DB',
                      fontWeight: 'bold'
                    }} colSpan="3">Allocation Analysis</th>
                  </tr>
                  <tr style={{ backgroundColor: '#F3F4F6', fontSize: '11px', borderBottom: '1px solid #D1D5DB' }}>
                    {/* Vacant Sale Columns */}
                    <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>VCS</th>
                  <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>Year</th>
                  <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>Block/Lot</th>
                  <th style={{ padding: '6px', border: '1px solid #D1D5DB', fontWeight: '600' }}>Region</th>
                  <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Price</th>
                  {valuationMode === 'ff' ? (
                    <>
                      <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Front Feet</th>
                      <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Depth</th>
                      <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Zone</th>
                      <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Site Value</th>
                    </>
                  ) : (
                    <>
                      <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Acres</th>
                      <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Site Value</th>
                    </>
                  )}
                  {/* Improved Sales Columns */}
                  <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Count</th>
                  <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Price</th>
                  {valuationMode === 'ff' ? (
                    <>
                      <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg FF</th>
                      <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Depth</th>
                    </>
                  ) : (
                    <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #D1D5DB', fontWeight: '600' }}>Avg Acres</th>
                  )}
                  <th style={{ padding: '6px', textAlign: 'right', borderRight: '2px solid #E5E7EB', border: '1px solid #D1D5DB', fontWeight: '600' }}>Total Land Value</th>
                    {/* Allocation Columns */}
                    <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Current %</th>
                    <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Recommended %</th>
                    <th style={{ padding: '6px', textAlign: 'center', border: '1px solid #D1D5DB', fontWeight: '600' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {regionSales.map((sale, index) => (
                    <tr
                      key={`special_${sale.id}_${index}`}
                      style={{
                        backgroundColor: sale.isPositive ? (index % 2 === 0 ? 'white' : '#F9FAFB') : '#FEF2F2',
                        opacity: sale.isPositive ? 1 : 0.7,
                        borderBottom: '1px solid #E5E7EB'
                      }}
                    >
                      {/* Vacant Sale Data */}
                      <td style={{ padding: '8px', fontWeight: 'bold', border: '1px solid #E5E7EB' }}>{sale.vcs}</td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{sale.year}</td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{sale.block}/{sale.lot}</td>
                      <td style={{
                        padding: '8px',
                        border: '1px solid #E5E7EB',
                        fontSize: '10px',
                        fontWeight: '600',
                        color: '#8B5CF6'
                      }}>
                        {sale.region}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${sale.vacantPrice?.toLocaleString()}</td>
                      {valuationMode === 'ff' ? (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{Math.round(sale.frontFeet) || '-'}</td>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{Math.round(sale.depth) || '-'}</td>
                          <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{sale.zone || '-'}</td>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            color: sale.siteValue > 0 ? '#10B981' : '#EF4444',
                            borderRight: '2px solid #E5E7EB',
                            border: '1px solid #E5E7EB'
                          }}>
                            ${Math.round(sale.siteValue).toLocaleString()}
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.acres?.toFixed(2)}</td>
                          <td style={{
                            padding: '8px',
                            textAlign: 'right',
                            fontWeight: 'bold',
                            color: sale.siteValue > 0 ? '#10B981' : '#EF4444',
                            borderRight: '2px solid #E5E7EB',
                            border: '1px solid #E5E7EB'
                          }}>
                            ${Math.round(sale.siteValue).toLocaleString()}
                          </td>
                        </>
                      )}

                      {/* Improved Sales Data */}
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>{sale.improvedSalesCount}</td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${Math.round(sale.avgImprovedPrice)?.toLocaleString()}</td>
                      {valuationMode === 'ff' ? (
                        <>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.avgImprovedFF ? parseFloat(sale.avgImprovedFF).toFixed(2) : '-'}</td>
                          <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{sale.avgImprovedDepth ? parseFloat(sale.avgImprovedDepth).toFixed(2) : '-'}</td>
                        </>
                      ) : (
                        <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>{parseFloat(sale.avgImprovedAcres).toFixed(2)}</td>
                      )}
                      <td style={{
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        borderRight: '2px solid #E5E7EB',
                        border: '1px solid #E5E7EB'
                      }}>
                        ${Math.round(sale.totalLandValue)?.toLocaleString()}
                      </td>

                      {/* Allocation Results */}
                      <td style={{ padding: '8px', textAlign: 'center', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                        {(sale.currentAllocation * 100).toFixed(1)}%
                      </td>
                      <td style={{
                        padding: '8px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        border: '1px solid #E5E7EB',
                        backgroundColor: sale.isPositive ?
                          (sale.recommendedAllocation >= 0.25 && sale.recommendedAllocation <= 0.40 ? '#D1FAE5' :
                           sale.recommendedAllocation >= 0.20 && sale.recommendedAllocation <= 0.45 ? '#FEF3C7' : '#FEE2E2') :
                          'transparent'
                      }}>
                        {(sale.recommendedAllocation * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
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

            {/* Region-Specific Summary Footer */}
            <div style={{ padding: '15px', borderTop: '1px solid #E5E7EB', backgroundColor: '#F3E8FF' }}>
              {(() => {
                const positiveSales = regionSales.filter(s => s.isPositive);
                const totalLandValue = positiveSales.reduce((sum, s) => sum + s.totalLandValue, 0);
                const totalSalePrice = positiveSales.reduce((sum, s) => sum + s.avgImprovedPrice, 0);
                const overallRecommended = totalSalePrice > 0 ? (totalLandValue / totalSalePrice) * 100 : 0;

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', fontSize: '14px' }}>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '12px' }}>{regionName} Sales Included</div>
                      <div style={{ fontWeight: 'bold', color: '#8B5CF6' }}>{positiveSales.length} of {regionSales.length}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Land Value</div>
                      <div style={{ fontWeight: 'bold' }}>${Math.round(totalLandValue).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '12px' }}>Total Sale Price</div>
                      <div style={{ fontWeight: 'bold' }}>${Math.round(totalSalePrice).toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#6B7280', fontSize: '12px' }}>{regionName} Recommended</div>
                      <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#8B5CF6' }}>{overallRecommended.toFixed(1)}%</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
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

  // Check which methods are actually in use across all VCS
  const methodsInUse = useMemo(() => {
    const methods = new Set();
    Object.keys(vcsSheetData).forEach(vcs => {
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const method = vcsMethodOverrides[vcs] ||
                     (type.toLowerCase().includes('condo') ? 'site' : valuationMode);
      methods.add(method);
    });
    return methods;
  }, [vcsSheetData, vcsTypes, vcsMethodOverrides, valuationMode]);

  const hasFFMethod = methodsInUse.has('ff');
  const hasSFMethod = methodsInUse.has('sf');
  const hasAcreMethod = methodsInUse.has('acre');

  // ========== METHOD FORMATTING HELPER ==========
  // Get the effective method for a VCS (considering overrides)
  const getVCSMethod = useCallback((vcs, type) => {
    // If there's a method override for this VCS, use it
    if (vcsMethodOverrides[vcs]) {
      return vcsMethodOverrides[vcs];
    }

    // Check if Type contains "condo" - if so, use SITE method
    if (type && type.toLowerCase().includes('condo')) {
      return 'site';
    }

    // Otherwise use the global valuation mode
    return valuationMode;
  }, [vcsMethodOverrides, valuationMode]);

  const getMethodDisplay = useCallback((method) => {
    switch (method) {
      case 'acre': return 'AC';
      case 'sf': return 'SF';
      case 'ff': return 'FF';
      case 'site': return 'SITE';
      default: return method?.toUpperCase() || '';
    }
  }, []);

  // ========== SALES DATE FILTERING FOR CME (CSP-PSP-HSP Range) ==========
  const getSalesPeriodRange = () => {
    // Use assessment year from job's end_date to calculate CSP-PSP-HSP periods
    const assessmentYear = jobData?.end_date ? new Date(jobData.end_date).getFullYear() : new Date().getFullYear();

    // HSP (Historical Sale Period): 10/1 of three years prior → 9/30 of two years prior
    // For assessment date 1/1/2026: 10/1/2022 → 9/30/2023
    const hspStart = new Date(assessmentYear - 3, 9, 1, 0, 0, 0);

    // CSP (Current Sale Period): 10/1 of prior year → 12/31 of assessment year (or present if past due)
    // For assessment date 1/1/2026: 10/1/2024 → 12/31/2025 (or present if job is past due)
    const cspEnd = new Date(assessmentYear, 11, 31, 23, 59, 59);
    const now = new Date();
    const effectiveEnd = now > cspEnd ? now : cspEnd;

    return {
      start: hspStart,  // Overall range starts at HSP start (10/1 three years prior)
      end: effectiveEnd // Overall range ends at CSP end or present (whichever is later)
    };
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

  // Memoize VCS special categories calculation based on config only (not individual sales)
  const vcsSpecialCategoriesMap = useMemo(() => {
    const map = {};
    Object.keys(vcsSheetData).forEach(vcs => {
      const type = vcsTypes[vcs] || 'Residential-Typical';
      const isGrayedOut = !type.startsWith('Residential');

      map[vcs] = !isGrayedOut ? {
        wetlands: cascadeConfig.specialCategories.wetlands && cascadeConfig.specialCategories.wetlands > 0,
        landlocked: cascadeConfig.specialCategories.landlocked && cascadeConfig.specialCategories.landlocked > 0,
        conservation: cascadeConfig.specialCategories.conservation && cascadeConfig.specialCategories.conservation > 0
      } : {
        wetlands: false,
        landlocked: false,
        conservation: false
      };
    });
    return map;
  }, [vcsSheetData, vcsTypes, cascadeConfig.specialCategories]);

  // ========== CALCULATE REC SITE WITH FRONT FOOT FORMULA ==========
  const calculateRecSite = useCallback((vcs) => {
    // Get VCS data for avg price
    const data = vcsSheetData[vcs];
    if (!data) return vcsRecommendedSites[vcs] || 0;

    // Use Avg Price, fallback to Avg Price (t)
    const avgPrice = data.avgPrice || data.avgNormTime;
    if (!avgPrice || !targetAllocation) return vcsRecommendedSites[vcs] || 0;

    // Get effective method for this VCS (considering overrides)
    const vcsType = vcsTypes[vcs] || '';
    const vcsMethod = getVCSMethod(vcs, vcsType);

    // For SITE method (condos): use strict site value calculation
    if (vcsMethod === 'site') {
      // For condos/site: Rec Site = Target % × Avg Price
      return Math.round(avgPrice * (targetAllocation / 100));
    }

    // If not in FF mode, return the base recommended value
    if (vcsMethod !== 'ff') {
      return vcsRecommendedSites[vcs] || 0;
    }

    // Front Foot mode calculation for non-condo residential
    const zcfg = marketLandData?.zoning_config || {};

    // Find the most common zoning for this VCS
    const vcsProperties = properties.filter(p => p.new_vcs === vcs);
    if (vcsProperties.length === 0) return vcsRecommendedSites[vcs] || 0;

    const vcsZonings = vcsProperties
      .map(p => p.asset_zoning)
      .filter(z => z && z.trim() !== '');

    if (vcsZonings.length === 0) return vcsRecommendedSites[vcs] || 0;

    // Get most common zoning
    const zoningCounts = {};
    vcsZonings.forEach(z => {
      const zKey = z.toString().trim();
      zoningCounts[zKey] = (zoningCounts[zKey] || 0) + 1;
    });
    const mostCommonZoning = Object.keys(zoningCounts).reduce((a, b) =>
      zoningCounts[a] > zoningCounts[b] ? a : b
    );

    const zoneEntry = zcfg[mostCommonZoning] ||
                     zcfg[mostCommonZoning?.toUpperCase?.()] ||
                     zcfg[mostCommonZoning?.toLowerCase?.()] || null;

    if (!zoneEntry) return vcsRecommendedSites[vcs] || 0;

    // Use VCS-specific depth table override if available, otherwise use zoning default
    const depthTableName = vcsDepthTableOverrides[vcs] || zoneEntry.depth_table || zoneEntry.depthTable;
    const minFrontage = parseFloat(zoneEntry.min_frontage || zoneEntry.minFrontage || 0);

    if (!depthTableName || !minFrontage) return vcsRecommendedSites[vcs] || 0;

    // Calculate average frontage and depth for properties in this VCS
    const propsWithFrontage = vcsProperties.filter(p =>
      p.asset_lot_frontage && parseFloat(p.asset_lot_frontage) > 0
    );

    if (propsWithFrontage.length === 0) return vcsRecommendedSites[vcs] || 0;

    const avgFrontage = propsWithFrontage.reduce((sum, p) =>
      sum + parseFloat(p.asset_lot_frontage), 0
    ) / propsWithFrontage.length;

    const propsWithDepth = vcsProperties.filter(p =>
      p.asset_lot_depth && parseFloat(p.asset_lot_depth) > 0
    );

    const avgDepth = propsWithDepth.length > 0
      ? propsWithDepth.reduce((sum, p) => sum + parseFloat(p.asset_lot_depth), 0) / propsWithDepth.length
      : 100; // Default depth if not available

    // Get depth factor using interpretCodes function that works with parsed code definitions
    const depthFactor = interpretCodes.getDepthFactor(avgDepth, depthTableName, depthTables);

    // Calculate standard and excess frontage
    const standardFrontage = Math.min(avgFrontage, minFrontage);
    const excessFrontage = Math.max(0, avgFrontage - minFrontage);

    // Get standard and excess FF rates from cascade config or calculated values
    // Priority: VCS-Specific > Special Region (by VCS assignment) > Normal
    let baseCascadeRates = cascadeConfig.normal;

    // Check for VCS-specific configuration
    const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
      config.vcsList?.includes(vcs)
    );
    if (vcsSpecificConfig) {
      baseCascadeRates = vcsSpecificConfig.rates || cascadeConfig.normal;
    } else {
      // Check for special region configuration by VCS assignment
      const assignedSpecialRegion = Object.entries(cascadeConfig.special || {}).find(([region, config]) => {
        if (!config.vcsList) return false;
        // Parse comma-separated VCS list and check if current VCS is in it
        const vcsList = config.vcsList.split(',').map(v => v.trim().toUpperCase());
        return vcsList.includes(vcs.toString().toUpperCase());
      });

      if (assignedSpecialRegion) {
        baseCascadeRates = assignedSpecialRegion[1]; // Use the config object from the [region, config] tuple
      }
    }

    // Apply VCS-specific rate and stepdown overrides
    const cascadeRates = getVCSCascadeRates(vcs, baseCascadeRates);

    const standardFF = cascadeRates.standard?.rate || 0;
    const excessFF = cascadeRates.excess?.rate || Math.round(standardFF / 2);

    // Calculate Raw Land Component: (Standard Frontage × Std Rate × Depth Factor) + (Excess × Excess Rate)
    const rawLandComponent = Math.round(
      (standardFrontage * standardFF * depthFactor) +
      (excessFrontage * excessFF)
    );

    // Calculate Target Allocation Value: avgPrice × (target% / 100)
    const targetValue = Math.round(avgPrice * (targetAllocation / 100));

    // Rec Site = Target Value - Raw Land Component
    const siteValue = targetValue - rawLandComponent;

    return siteValue;
  }, [valuationMode, marketLandData, properties, depthTables, cascadeConfig, vacantSales, specialRegions, vcsDepthTableOverrides, vcsRecommendedSites, vcsSheetData, targetAllocation, vcsTypes, vcsMethodOverrides, getVCSMethod]);

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
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Typ Lot</th>
                  {hasFFMethod && (
                    <>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Typ Lot Depth</th>
                      <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Depth Table</th>
                    </>
                  )}
                  {(hasFFMethod || hasSFMethod) && (
                    <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Stepdown</th>
                  )}
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Rec Site</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Act Site</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{hasAcreMethod ? 'Prime' : 'Standard'}</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>{hasAcreMethod ? 'Secondary' : 'Excess'}</th>
                  {hasAcreMethod && (
                    <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Excess</th>
                  )}
                  {shouldShowResidualColumn && hasAcreMethod && (
                    <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Res</th>
                  )}
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Wet</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>LLocked</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Consv</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Price (t) Lot Size</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Price (t)</th>
                  <th style={{ padding: '8px', border: '1px solid #E5E7EB' }}>Avg Price Lot Size</th>
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
                    Zoning {collapsedFields.zoning ? '�������' : '��'}
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
                      Key {collapsedFields.key ? '���' : '▼'}
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
                  // Get effective method for this VCS (considering overrides)
                  const vcsMethod = getVCSMethod(vcs, type);
                  // Calculate Rec Site using FF formula with depth table overrides
                  const recSite = calculateRecSite(vcs);
                  // Act Site is user-editable override, defaults to recSite if not set
                  const actSite = vcsManualSiteValues[vcs] ?? recSite;

                  // Determine which cascade rates to use (priority: VCS-specific > Special Region > Normal)
                  let baseCascadeRates = cascadeConfig.normal;
                  let rateSource = 'Normal';

                  // Check for VCS-specific configuration
                  const vcsSpecificConfig = Object.values(cascadeConfig.vcsSpecific || {}).find(config =>
                    config.vcsList?.includes(vcs)
                  );
                  if (vcsSpecificConfig) {
                    baseCascadeRates = vcsSpecificConfig.rates || cascadeConfig.normal;
                    rateSource = `VCS-Specific (${vcsSpecificConfig.method?.toUpperCase()})`;
                  } else {
                    // Check for special region configuration by VCS assignment
                    const assignedSpecialRegion = Object.entries(cascadeConfig.special || {}).find(([region, config]) => {
                      if (!config.vcsList) return false;
                      // Parse comma-separated VCS list and check if current VCS is in it
                      const vcsList = config.vcsList.split(',').map(v => v.trim().toUpperCase());
                      return vcsList.includes(vcs.toString().toUpperCase());
                    });

                    if (assignedSpecialRegion) {
                      baseCascadeRates = assignedSpecialRegion[1];
                      rateSource = assignedSpecialRegion[0]; // Region name
                    }
                  }

                  // Apply VCS-specific rate and stepdown overrides
                  const cascadeRates = getVCSCascadeRates(vcs, baseCascadeRates);
                  
                  // Get typical lot size for ALL properties in this VCS (for display purposes)
                  // Use pre-calculated values from property_market_analysis table (market_manual_lot_sf/acre)
                  let vcsProps, typicalLot;

                  if (valuationMode === 'sf') {
                    // Square Foot mode: use market_manual_lot_sf from property_market_analysis
                    vcsProps = properties?.filter(p =>
                      p.new_vcs === vcs &&
                      p.market_manual_lot_sf && parseFloat(p.market_manual_lot_sf) > 0
                    ) || [];
                    typicalLot = vcsProps.length > 0 ?
                      Math.round(vcsProps.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_sf), 0) / vcsProps.length).toLocaleString() : '';

                  } else {
                    // Acre or Front Foot mode: use market_manual_lot_acre from property_market_analysis
                    vcsProps = properties?.filter(p =>
                      p.new_vcs === vcs &&
                      p.market_manual_lot_acre && parseFloat(p.market_manual_lot_acre) > 0
                    ) || [];
                    typicalLot = vcsProps.length > 0 ?
                      (vcsProps.reduce((sum, p) => sum + parseFloat(p.market_manual_lot_acre), 0) / vcsProps.length).toFixed(2) : '';

                  }

                  // Calculate typical frontage and depth for Front Foot mode
                  let typicalFrontage = '';
                  let typicalDepth = '';
                  let depthTableName = '';

                  if (valuationMode === 'ff') {
                    // Get all properties in this VCS with valid frontage data
                    const vcsPropsWithFrontage = properties?.filter(p =>
                      p.new_vcs === vcs &&
                      p.asset_lot_frontage && parseFloat(p.asset_lot_frontage) > 0
                    ) || [];

                    if (vcsPropsWithFrontage.length > 0) {
                      // Calculate average frontage
                      const avgFrontage = vcsPropsWithFrontage.reduce((sum, p) =>
                        sum + parseFloat(p.asset_lot_frontage), 0
                      ) / vcsPropsWithFrontage.length;
                      typicalFrontage = Math.round(avgFrontage);

                      // Calculate average depth if available
                      const vcsPropsWithDepth = vcsPropsWithFrontage.filter(p =>
                        p.asset_lot_depth && parseFloat(p.asset_lot_depth) > 0
                      );

                      if (vcsPropsWithDepth.length > 0) {
                        const avgDepth = vcsPropsWithDepth.reduce((sum, p) =>
                          sum + parseFloat(p.asset_lot_depth), 0
                        ) / vcsPropsWithDepth.length;
                        typicalDepth = Math.round(avgDepth);
                      } else {
                        // If no depth data, use standard depth of 100 ft
                        typicalDepth = 100;
                      }

                      // Use VCS-specific override if available, otherwise get from zoning config
                      if (vcsDepthTableOverrides[vcs]) {
                        depthTableName = vcsDepthTableOverrides[vcs];
                      } else {
                        // Get depth table from zoning config
                        // Find the most common zoning for this VCS
                        const vcsZonings = vcsPropsWithFrontage
                          .map(p => p.asset_zoning)
                          .filter(z => z && z.trim() !== '');

                        if (vcsZonings.length > 0) {
                          // Get most common zoning
                          const zoningCounts = {};
                          vcsZonings.forEach(z => {
                            const zKey = z.toString().trim();
                            zoningCounts[zKey] = (zoningCounts[zKey] || 0) + 1;
                          });
                          const mostCommonZoning = Object.keys(zoningCounts).reduce((a, b) =>
                            zoningCounts[a] > zoningCounts[b] ? a : b
                          );

                          // Look up depth table from zoning config
                          const zcfg = marketLandData?.zoning_config || {};
                          const zoneEntry = zcfg[mostCommonZoning] ||
                                           zcfg[mostCommonZoning?.toUpperCase?.()] ||
                                           zcfg[mostCommonZoning?.toLowerCase?.()] || null;

                          if (zoneEntry) {
                            depthTableName = zoneEntry.depth_table ||
                                            zoneEntry.depthTable ||
                                            zoneEntry.depth_table_name ||
                                            'Not Set';
                          } else {
                            depthTableName = 'Not Set';
                          }
                        }
                      }
                    }
                  }

                  // Use pre-calculated special categories to avoid re-renders
                  const vcsSpecialCategories = vcsSpecialCategoriesMap[vcs] || {
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
                          className="vcs-description-input"
                        />
                      </td>
                      <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                        <select
                          value={vcsMethod}
                          onChange={(e) => updateVCSMethod(vcs, e.target.value)}
                          style={{
                            padding: '2px',
                            border: '1px solid #D1D5DB',
                            borderRadius: '4px',
                            fontSize: '11px',
                            width: '100%',
                            textAlign: 'center',
                            backgroundColor: vcsMethodOverrides[vcs] ? '#FEF3C7' : 'white'
                          }}
                          title={vcsMethodOverrides[vcs] ? 'VCS Method Override Active' : 'Using global method'}
                        >
                          <option value="acre">AC</option>
                          <option value="sf">SF</option>
                          <option value="ff">FF</option>
                          <option value="site">SITE</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                        {vcsMethod === 'ff' ?
                          (typicalFrontage !== '' ? `${typicalFrontage} ft` : '') :
                        vcsMethod === 'sf' ?
                          (typicalLot || '') :
                        vcsMethod === 'acre' ?
                          (typicalLot || '') :
                          ''}
                      </td>
                      {hasFFMethod && (
                        <>
                          <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                            {vcsMethod === 'ff' && typicalDepth !== '' ? `${typicalDepth} ft` : ''}
                          </td>
                          <td style={{ padding: '8px', border: '1px solid #E5E7EB' }}>
                            {vcsMethod === 'ff' && (
                              <select
                                value={vcsDepthTableOverrides[vcs] || depthTableName || ''}
                                onChange={(e) => {
                                  const newDepthTable = e.target.value;
                                  setVcsDepthTableOverrides(prev => ({
                                    ...prev,
                                    [vcs]: newDepthTable
                                  }));
                                  setTimeout(() => {
                                    saveAnalysis();
                                  }, 100);
                                }}
                                style={{
                                  width: '100%',
                                  padding: '2px 4px',
                                  border: '1px solid #D1D5DB',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  backgroundColor: vcsDepthTableOverrides[vcs] ? '#FEF3C7' : 'white'
                                }}
                                title={vcsDepthTableOverrides[vcs] ? 'VCS Override Active' : 'Using zoning default'}
                              >
                                <option value="">Auto (from zoning)</option>
                                {Object.keys(depthTables).map(table => (
                                  <option key={table} value={table}>
                                    {table}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        </>
                      )}
                      {(hasFFMethod || hasSFMethod) && (
                        <td style={{
                          padding: '8px',
                          border: '1px solid #E5E7EB',
                          backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit'
                        }}>
                          {!isGrayedOut && (vcsMethod === 'ff' || vcsMethod === 'sf') ? (
                            <input
                              type="number"
                              value={vcsStepdownOverrides[vcs] ?? cascadeRates.standard?.max ?? ''}
                              onChange={(e) => updateVCSStepdown(vcs, e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.standard?.max || ''}
                            />
                          ) : ''}
                        </td>
                      )}
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>${Math.round(recSite).toLocaleString()}</td>
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
                      <td style={{
                        padding: '8px',
                        border: '1px solid #E5E7EB',
                        backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit'
                      }}>
                        {!isGrayedOut ? (
                          vcsMethod === 'ff' || vcsMethod === 'sf' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.standard ?? cascadeRates.standard?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'standard', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.standard?.rate || ''}
                            />
                          ) : vcsMethod === 'acre' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.prime ?? cascadeRates.prime?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'prime', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.prime?.rate || ''}
                            />
                          ) : ''
                        ) : ''}
                      </td>
                      <td style={{
                        padding: '8px',
                        border: '1px solid #E5E7EB',
                        backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit'
                      }}>
                        {!isGrayedOut ? (
                          vcsMethod === 'ff' || vcsMethod === 'sf' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.excess ?? cascadeRates.excess?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'excess', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.excess?.rate || ''}
                            />
                          ) : vcsMethod === 'acre' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.secondary ?? cascadeRates.secondary?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'secondary', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.secondary?.rate || ''}
                            />
                          ) : ''
                        ) : ''}
                      </td>
                      {hasAcreMethod && (
                        <td style={{
                          padding: '8px',
                          border: '1px solid #E5E7EB',
                          backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit'
                        }}>
                          {!isGrayedOut && vcsMethod === 'acre' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.excess ?? cascadeRates.excess?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'excess', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.excess?.rate || ''}
                            />
                          ) : ''}
                        </td>
                      )}
                      {shouldShowResidualColumn && hasAcreMethod && (
                        <td style={{
                          padding: '8px',
                          border: '1px solid #E5E7EB',
                          backgroundColor: isGrayedOut ? '#F3F4F6' : 'inherit'
                        }}>
                          {!isGrayedOut && vcsMethod === 'acre' ? (
                            <input
                              type="number"
                              value={vcsRateOverrides[vcs]?.residual ?? cascadeRates.residual?.rate ?? ''}
                              onChange={(e) => updateVCSRate(vcs, 'residual', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '2px',
                                border: '1px solid #D1D5DB',
                                borderRadius: '4px',
                                fontSize: '11px',
                                textAlign: 'right'
                              }}
                              placeholder={cascadeRates.residual?.rate || ''}
                            />
                          ) : ''}
                        </td>
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
                        {data.avgNormTimeLotSize ? (
                          valuationMode === 'ff' ? `${Math.round(data.avgNormTimeLotSize)} ft` :
                          valuationMode === 'sf' ? `${Math.round(data.avgNormTimeLotSize).toLocaleString()} SF` :
                          data.avgNormTimeLotSize.toFixed(2)
                        ) : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        {data.avgNormTime ? `$${data.avgNormTime.toLocaleString()}` : ''}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #E5E7EB' }}>
                        {data.avgPriceLotSize ? (
                          valuationMode === 'ff' ? `${Math.round(data.avgPriceLotSize)} ft` :
                          valuationMode === 'sf' ? `${Math.round(data.avgPriceLotSize).toLocaleString()} SF` :
                          data.avgPriceLotSize.toFixed(2)
                        ) : ''}
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
  const renderEconomicObsolescenceTab = () => {
    // Show all factors including 'None' - let user decide what to filter
    const filteredFactors = ecoObsFactors;

    // Combined codes for dropdown (defaults + custom)
  const combinedLocationCodes = [
    ...DEFAULT_ECO_OBS_CODES.map(c => ({ code: c.code, description: c.description, isPositive: c.isPositive, isDefault: true })),
    ...customLocationCodes.map(c => ({ ...c, isDefault: false }))
  ];

  // Build summary for standalone location analyses (non-compounded)
  const standaloneLocations = {};
  Object.keys(ecoObsFactors || {}).forEach(vcs => {
    Object.keys(ecoObsFactors[vcs] || {}).forEach(loc => {
      // Skip empty/none and compounded descriptions
      if (!loc || /\bnone\b|\bno analysis\b/i.test(loc)) return;
      if (/[\/\|,]|\band\b|&/.test(loc)) return; // compound separators
      if (!standaloneLocations[loc]) standaloneLocations[loc] = { vcsList: new Set(), impacts: [] };
      standaloneLocations[loc].vcsList.add(vcs);
      const impact = calculateEcoObsImpact(vcs, loc, globalEcoObsTypeFilter);
      if (impact && impact.percentImpact && impact.percentImpact !== 'N/A') {
        const num = parseFloat(String(impact.percentImpact));
        if (!isNaN(num)) standaloneLocations[loc].impacts.push(num);
      }
    });
  });

  // Compute standalone averages
  const standaloneAvg = {};
  Object.entries(standaloneLocations).forEach(([loc, data]) => {
    const avg = data.impacts.length ? (data.impacts.reduce((a, b) => a + b, 0) / data.impacts.length) : null;
    standaloneAvg[loc] = { avg, count: data.vcsList.size, impacts: data.impacts };
  });

  // Find compound locations and compute summed averages from parts (cap at 25% absolute)
  const compoundLocations = {};
  Object.keys(ecoObsFactors || {}).forEach(vcs => {
    Object.keys(ecoObsFactors[vcs] || {}).forEach(loc => {
      if (!loc) return;
      // detect compound
      if (/[\/\|,]|\band\b|&/.test(loc)) {
        // Keep original compound key
        if (!compoundLocations[loc]) compoundLocations[loc] = { vcsList: new Set(), parts: [], summedAvg: 0 };
        compoundLocations[loc].vcsList.add(vcs);
        // split into parts using same splitter as mapping
        const parts = loc.split(/\/|\|| and | & |,|\//i).map(p => p.trim()).filter(Boolean);
        compoundLocations[loc].parts = Array.from(new Set([...(compoundLocations[loc].parts || []), ...parts]));
      }
    });
  });

  Object.keys(compoundLocations).forEach(loc => {
    const parts = compoundLocations[loc].parts || [];
    // sum available standalone averages for parts
    let sum = 0;
    parts.forEach(part => {
      const p = standaloneAvg[part];
      if (p && p.avg !== null && !isNaN(p.avg)) {
        sum += p.avg;
      }
    });
    // cap at 25% (by absolute value)
    const capped = Math.sign(sum) * Math.min(Math.abs(sum), 25);
    compoundLocations[loc].summedAvg = capped;
  });

  // Build combined summary list based on includeCompounded toggle
  let combined = Object.entries(standaloneAvg).map(([loc, d]) => ({ location: loc, avgPercent: d.avg, count: d.count, impacts: d.impacts, isCompound: false }));
  if (includeCompounded) {
    combined = combined.concat(Object.keys(compoundLocations).map(loc => ({ location: loc, avgPercent: compoundLocations[loc].summedAvg || null, count: compoundLocations[loc].vcsList.size, impacts: [], isCompound: true })));
  }

  const summaryList = combined.sort((a, b) => (b.count - a.count) || ((b.avgPercent || 0) - (a.avgPercent || 0))).slice(0, 50);

  // Helper to split a location into parts (handles /, |, ',', ' and ', '&')
  const splitLocationParts = (loc) => {
    if (!loc) return [];
    // split on '/', '|', ',', ' and ', '&' (case-insensitive), trimming whitespace
    return loc.split(/\s*(?:\/|\||,|\band\b|&)\s*/i).map(p => p.trim()).filter(Boolean);
  };

  // Helper: determine polarity of a location part from mappedLocationCodes and code definitions
  const getPartPolarity = (part) => {
    // returns 'positive', 'negative', or null if unknown/mixed
    const codes = new Set();
    Object.keys(mappedLocationCodes || {}).forEach(k => {
      if (k.endsWith(`_${part}`)) {
        const val = (mappedLocationCodes[k] || '').toString().toUpperCase();
        val.split('/').map(s => s.trim()).filter(Boolean).forEach(c => codes.add(c));
      }
    });
    if (codes.size === 0) return null;
    let hasPos = false;
    let hasNeg = false;
    codes.forEach(code => {
      const def = DEFAULT_ECO_OBS_CODES.find(d => d.code === code);
      const custom = customLocationCodes.find(d => d.code === code);
      const isPos = def?.isPositive ?? custom?.isPositive ?? null;
      if (isPos === true) hasPos = true;
      if (isPos === false) hasNeg = true;
    });
    if (hasPos && !hasNeg) return 'positive';
    if (hasNeg && !hasPos) return 'negative';
    return null; // mixed or unknown
  };

  // Apply a percent value (positive or negative) from summary into worksheet applied adjustments for all matching VCS rows
  // Update per-part matches and populate the compound row with aggregated values (max of part values per side)
  const applySummaryToWorksheet = (location, value) => {
    if (value === null || value === undefined || isNaN(Number(value))) return;
    const numeric = Number(value);
    if (!isFinite(numeric)) return;
    // Skip locations that are tentative (contain 'possible' or '?') unless user explicitly provided inputs
    if (/\bpossible|possibly\b|\?/i.test(location)) return;

    const parts = splitLocationParts(location);

    Object.keys(ecoObsFactors || {}).forEach(vcs => {
      const partPosVals = [];
      const partNegVals = [];

      parts.forEach(part => {
        if (ecoObsFactors[vcs] && ecoObsFactors[vcs][part]) {
          const polarity = getPartPolarity(part);
          if (numeric >= 0) {
            if (polarity !== 'negative') {
              updateActualAdjustment(vcs, `${part}_positive`, Math.abs(numeric));
              partPosVals.push(Math.abs(numeric));
            }
          } else {
            if (polarity !== 'positive') {
              updateActualAdjustment(vcs, `${part}_negative`, Math.abs(numeric));
              partNegVals.push(Math.abs(numeric));
            }
          }
        } else if (standaloneAvg[part] && standaloneAvg[part].avg !== null && !isNaN(Number(standaloneAvg[part].avg))) {
          const pAvg = Number(standaloneAvg[part].avg);
          if (pAvg > 0) partPosVals.push(Math.abs(pAvg));
          if (pAvg < 0) partNegVals.push(Math.abs(pAvg));
        }
      });

      // After updating parts (or collecting part averages), set compound row values
      const compoundKey = `${vcs}_${location}`;
      if (partPosVals.length > 0) {
        const maxPos = Math.max(...partPosVals);
        setActualAdjustments(prev => ({ ...prev, [`${compoundKey}_positive`]: maxPos }));
      }
      if (partNegVals.length > 0) {
        const maxNeg = Math.max(...partNegVals);
        setActualAdjustments(prev => ({ ...prev, [`${compoundKey}_negative`]: maxNeg }));
      }
    });
  };

  // Apply both positive and/or negative values for a location to all matching VCS rows (handles parts)
  // When explicit positive/negative provided, set parts accordingly and aggregate to compound row
  const applySummarySet = (location, positive, negative) => {
    // Skip tentative locations
    if (/\bpossible|possibly\b|\?/i.test(location)) {
      debug(`applySummarySet skipped tentative location: ${location}`);
      return;
    }
    const parts = splitLocationParts(location);
    debug(`applySummarySet called for location: ${location} parts: ${parts.join(' | ')} positive: ${positive} negative: ${negative}`);

    Object.keys(ecoObsFactors || {}).forEach(vcs => {
      const partPosVals = [];
      const partNegVals = [];

      // First, update parts where they exist in this VCS
      parts.forEach(part => {
        if (ecoObsFactors[vcs] && ecoObsFactors[vcs][part]) {
          const polarity = getPartPolarity(part);

          if (polarity === 'positive') {
            if (positive !== null && positive !== undefined && !isNaN(Number(positive))) {
              const val = Math.abs(Number(positive));
              updateActualAdjustment(vcs, `${part}_positive`, val);
              partPosVals.push(val);
            }
          } else if (polarity === 'negative') {
            if (negative !== null && negative !== undefined && !isNaN(Number(negative))) {
              const val = Math.abs(Number(negative));
              updateActualAdjustment(vcs, `${part}_negative`, val);
              partNegVals.push(val);
            }
          } else {
            if (positive !== null && positive !== undefined && !isNaN(Number(positive))) {
              const val = Math.abs(Number(positive));
              updateActualAdjustment(vcs, `${part}_positive`, val);
              partPosVals.push(val);
            }
            if (negative !== null && negative !== undefined && !isNaN(Number(negative))) {
              const val = Math.abs(Number(negative));
              updateActualAdjustment(vcs, `${part}_negative`, val);
              partNegVals.push(val);
            }
          }
        }
        // If the part does not exist for this VCS but we have a standaloneAvg for the part, use that to influence compound aggregation
        else if (standaloneAvg[part] && standaloneAvg[part].avg !== null && !isNaN(Number(standaloneAvg[part].avg))) {
          const pAvg = Number(standaloneAvg[part].avg);
          if (pAvg > 0) partPosVals.push(Math.abs(pAvg));
          if (pAvg < 0) partNegVals.push(Math.abs(pAvg));
        }
      });

      // Aggregate to compound row (even if parts weren't present in this VCS)
      const compoundKey = `${vcs}_${location}`;
      if (partPosVals.length > 0) {
        const maxPos = Math.max(...partPosVals);
        setActualAdjustments(prev => ({ ...prev, [`${compoundKey}_positive`]: maxPos }));
      }
      if (partNegVals.length > 0) {
        const maxNeg = Math.max(...partNegVals);
        setActualAdjustments(prev => ({ ...prev, [`${compoundKey}_negative`]: maxNeg }));
      }
    });
  };

  // Special helper for BS traffic levels - apply to compound and part keys
  const applyBSTraffic = (location, levelKey) => {
    const levelMap = { light: -5, medium: -10, heavy: -15 };
    const val = levelMap[levelKey];
    if (val === undefined) return;
    const parts = splitLocationParts(location);
    Object.keys(ecoObsFactors || {}).forEach(vcs => {
      if (ecoObsFactors[vcs] && ecoObsFactors[vcs][location]) updateActualAdjustment(vcs, `${location}_negative`, Math.abs(val));
      parts.forEach(part => {
        if (ecoObsFactors[vcs] && ecoObsFactors[vcs][part]) updateActualAdjustment(vcs, `${part}_negative`, Math.abs(val));
      });
    });
  };

  // Helper to check if any mapped code for this location includes a particular code (e.g., BS)
  const locationHasCode = (location, code) => {
    // check exact mapped keys
    const exact = Object.keys(mappedLocationCodes || {}).some(k => k.endsWith(`_${location}`) && (mappedLocationCodes[k] || '').toString().toUpperCase().split('/').map(s => s.trim()).includes(code));
    if (exact) return true;
    // also check parts
    const parts = splitLocationParts(location);
    return parts.some(part => Object.keys(mappedLocationCodes || {}).some(k => k.endsWith(`_${part}`) && (mappedLocationCodes[k] || '').toString().toUpperCase().split('/').map(s => s.trim()).includes(code)));
  };

  // Use component-level inputs/handlers for adding custom codes

  return (
    <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '14px', fontWeight: '600' }}>Eco Obs Code Config</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                style={{ padding: '6px 10px', border: '1px solid #D1D5DB', borderRadius: '6px', minWidth: '220px' }}
                value=""
                onChange={() => { /* Selection handled in grid below - this dropdown is informational */ }}
              >
                <option value="">-- Standard Codes (editable) --</option>
                {combinedLocationCodes.map(c => (
                  <option key={c.code} value={c.code}>{`${c.code} - ${c.description} ${c.isPositive ? '(+)' : '(-)'}`}</option>
                ))}
              </select>

              <div style={{ fontSize: '12px', color: '#6B7280' }}>Add custom codes:</div>
              <input
                placeholder="Code"
                value={newEcoCode}
                onChange={(e) => setNewEcoCode(e.target.value)}
                style={{ width: '60px', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
              />
              <input
                placeholder="Description"
                value={newEcoDesc}
                onChange={(e) => setNewEcoDesc(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px' }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <input type="checkbox" checked={newEcoIsPositive} onChange={(e) => setNewEcoIsPositive(e.target.checked)} /> Positive
              </label>
              <button onClick={handleAddCustomCode} style={{ padding: '6px 10px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px' }}>Add</button>
            </div>

            {customLocationCodes.length > 0 && (
              <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {customLocationCodes.map(c => (
                  <div key={c.code} style={{ padding: '6px 8px', borderRadius: '6px', background: '#F3F4F6', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <strong style={{ fontSize: '12px' }}>{c.code}</strong>
                    <span style={{ fontSize: '12px', color: '#374151' }}>{c.description}</span>
                    <span style={{ fontSize: '12px', color: c.isPositive ? '#10B981' : '#DC2626' }}>{c.isPositive ? '+' : '-'}</span>
                    <button onClick={() => handleRemoveCustomCode(c.code)} style={{ marginLeft: '6px', border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: '500' }}>Type & Use</label>
              <select
                value={globalEcoObsTypeFilter}
                onChange={(e) => updateGlobalEcoObsTypeFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '6px',
                  fontSize: '14px',
                  minWidth: '140px',
                  backgroundColor: 'white'
                }}
              >
                <option value="all">All</option>
                <option value="1">1 — Single Family</option>
                <option value="2">2 — Duplex / Semi-Detached</option>
                <option value="3">3* ���� Row / Townhouse</option>
                <option value="4">4* — MultiFamily</option>
                <option value="5">5* — Conversions</option>
                <option value="6">6 — Condominium</option>
                <option value="all_residential">All Residential</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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

              <button
                onClick={() => {
                  applyDefaultMapping();
                  alert('Applied default mappings to empty code fields. Review highlighted entries.');
                }}
                style={{
                  backgroundColor: '#3B82F6',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                Apply Defaults
              </button>
            </div>
          </div>
        </div>

        <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#F8F9FA', borderBottom: '2px solid #E5E7EB' }}>
                  <th onClick={() => toggleSort('vcs')} style={{ padding: '8px 4px', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '11px', cursor: 'pointer' }}>VCS{sortField === 'vcs' ? (sortDir === 'asc' ? ' �����' : ' ▼') : ''}</th>
                  <th onClick={() => toggleSort('location')} style={{ padding: '8px 4px', textAlign: 'left', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '11px', cursor: 'pointer' }}>Locational Analysis{sortField === 'location' ? (sortDir === 'asc' ? ' ���' : ' ▼') : ''}</th>
                  <th onClick={() => toggleSort('code')} style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '11px', cursor: 'pointer' }}>Code{sortField === 'code' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>With Year Built</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>With Living Area</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>With Sale Price</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Without Year Built</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Without Living Area</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Without Sale Price</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Adjusted Sale With</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Adjusted Sale Without</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Dollar Impact</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Percent Impact</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px' }}>Applied+%</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: '600', color: '#374151', fontSize: '10px' }}>Applied-%</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Build flat rows array for sorting
                  const rows = [];
                  Object.keys(filteredFactors).forEach(vcsKey => {
                    Object.keys(filteredFactors[vcsKey]).forEach(locationAnalysis => {
                      rows.push({ vcs: vcsKey, locationAnalysis, key: `${vcsKey}_${locationAnalysis}` });
                    });
                  });

                  // sort helper
                  rows.sort((a, b) => {
                    const dir = sortDir === 'asc' ? 1 : -1;
                    if (sortField === 'vcs') {
                      if (a.vcs === b.vcs) return a.locationAnalysis.localeCompare(b.locationAnalysis) * dir;
                      return a.vcs.localeCompare(b.vcs) * dir;
                    }
                    if (sortField === 'location') {
                      if (a.locationAnalysis === b.locationAnalysis) return a.vcs.localeCompare(b.vcs) * dir;
                      return a.locationAnalysis.localeCompare(b.locationAnalysis) * dir;
                    }
                    // code
                    const aCode = (mappedLocationCodes[`${a.vcs}_${a.locationAnalysis}`] || '').toUpperCase();
                    const bCode = (mappedLocationCodes[`${b.vcs}_${b.locationAnalysis}`] || '').toUpperCase();
                    if (aCode === bCode) return a.vcs.localeCompare(b.vcs) * dir;
                    return aCode.localeCompare(bCode) * dir;
                  });

                  return rows.map((r, rowIndex) => {
                    const { vcs, locationAnalysis, key } = r;
                    const impact = calculateEcoObsImpact(vcs, locationAnalysis, globalEcoObsTypeFilter);
                    const hasWithData = impact && impact.withCount > 0;
                    const dataCellStyle = !hasWithData ? { color: '#9CA3AF', opacity: 0.6 } : {};

                    return (
                      <tr key={key} style={{ backgroundColor: rowIndex % 2 === 0 ? 'white' : '#FAFBFC', borderBottom: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '6px 4px', fontWeight: '600', color: '#1F2937', borderRight: '1px solid #E5E7EB', fontSize: '11px' }}>{vcs}</td>
                        <td style={{ padding: '6px 4px', color: '#374151', borderRight: '1px solid #E5E7EB', fontSize: '10px', maxWidth: '150px', wordWrap: 'break-word' }}>{locationAnalysis}</td>
                        <td style={{ padding: '6px 4px', color: '#6B7280', borderRight: '1px solid #E5E7EB', fontSize: '10px', textAlign: 'center' }}>
                          <input
                            type="text"
                            placeholder="TBD"
                            value={mappedLocationCodes[`${vcs}_${locationAnalysis}`] || ''}
                            onChange={(e) => {
                              const key = `${vcs}_${locationAnalysis}`;
                              const val = e.target.value.toUpperCase();
                              setMappedLocationCodes(prev => ({ ...prev, [key]: val }));
                            }}
                            style={{ width: '80px', padding: '2px 4px', border: '1px solid #D1D5DB', borderRadius: '3px', fontSize: '10px', textAlign: 'center', backgroundColor: (!mappedLocationCodes[`${vcs}_${locationAnalysis}`] || mappedLocationCodes[`${vcs}_${locationAnalysis}`] === '') ? '#FEF9C3' : 'white' }}
                          />
                        </td>

                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withYearBuilt ? impact.withYearBuilt : '-'}</td>
                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withLivingArea ? impact.withLivingArea.toLocaleString() : '-'}</td>
                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withSalePrice ? `$${impact.withSalePrice.toLocaleString()}` : '-'}</td>

                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withoutYearBuilt ? impact.withoutYearBuilt : '-'}</td>
                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withoutLivingArea ? impact.withoutLivingArea.toLocaleString() : '-'}</td>
                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.withoutSalePrice ? `$${impact.withoutSalePrice.toLocaleString()}` : '-'}</td>

                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.adjustedSaleWith ? `$${impact.adjustedSaleWith.toLocaleString()}` : '-'}</td>
                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', ...dataCellStyle }}>{impact && impact.adjustedSaleWithout ? `$${impact.adjustedSaleWithout.toLocaleString()}` : '-'}</td>

                        <td style={{ padding: '6px 4px', fontSize: '10px', textAlign: 'center', borderRight: '1px solid #E5E7EB', fontWeight: 'bold', ...dataCellStyle }}>{impact && impact.dollarImpact ? `$${impact.dollarImpact.toLocaleString()}` : '-'}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 'bold', fontSize: '10px', borderRight: '1px solid #E5E7EB', ...dataCellStyle, color: !hasWithData ? '#9CA3AF' : (impact && impact.percentImpact !== 'N/A' ? (parseFloat(impact.percentImpact) < 0 ? '#DC2626' : '#10B981') : '#9CA3AF') }}>{impact && impact.percentImpact ? `${impact.percentImpact}%` : 'N/A'}</td>

                        <td style={{ padding: '6px 4px', textAlign: 'center', borderRight: '1px solid #E5E7EB' }}>
                          {(() => {
                            const mapVal = mappedLocationCodes[`${vcs}_${locationAnalysis}`] || '';
                            const codes = mapVal ? mapVal.split('/').map(c => c.trim()) : [];
                            const hasPositive = codes.some(c => (DEFAULT_ECO_OBS_CODES.find(d => d.code === c)?.isPositive) || (customLocationCodes.find(d => d.code === c)?.isPositive));
                            const hasNegative = codes.some(c => !(DEFAULT_ECO_OBS_CODES.find(d => d.code === c)?.isPositive) && !(customLocationCodes.find(d => d.code === c)?.isPositive));

                            return (
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                                onWheel={(e) => e.currentTarget.blur()}
                                value={actualAdjustments[`${key}_positive`] || ''}
                                onChange={(e) => updateActualAdjustment(vcs, `${locationAnalysis}_positive`, e.target.value)}
                                placeholder="-"
                                disabled={!hasPositive}
                                style={{ width: '40px', padding: '2px 4px', border: '1px solid #D1D5DB', borderRadius: '3px', fontSize: '10px', textAlign: 'center', backgroundColor: hasPositive ? 'white' : '#F3F4F6', WebkitAppearance: 'none', MozAppearance: 'textfield', appearance: 'textfield' }}
                              />
                            );
                          })()}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                          {(() => {
                            const mapVal = mappedLocationCodes[`${vcs}_${locationAnalysis}`] || '';
                            const codes = mapVal ? mapVal.split('/').map(c => c.trim()) : [];
                            const hasPositive = codes.some(c => (DEFAULT_ECO_OBS_CODES.find(d => d.code === c)?.isPositive) || (customLocationCodes.find(d => d.code === c)?.isPositive));
                            const hasNegative = codes.some(c => !(DEFAULT_ECO_OBS_CODES.find(d => d.code === c)?.isPositive) && !(customLocationCodes.find(d => d.code === c)?.isPositive));

                            return (
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                                onWheel={(e) => e.currentTarget.blur()}
                                value={actualAdjustments[`${key}_negative`] || ''}
                                onChange={(e) => updateActualAdjustment(vcs, `${locationAnalysis}_negative`, e.target.value)}
                                placeholder="-"
                                disabled={!hasNegative}
                                style={{ width: '40px', padding: '2px 4px', border: '1px solid #D1D5DB', borderRadius: '3px', fontSize: '10px', textAlign: 'center', backgroundColor: hasNegative ? 'white' : '#F3F4F6', WebkitAppearance: 'none', MozAppearance: 'textfield', appearance: 'textfield' }}
                              />
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* SUMMARY SECTION: Top standalone location recommendations */}
        <div style={{ marginTop: '12px', padding: '12px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '13px', fontWeight: '600' }}>Location Recommendations {includeCompounded ? '(including compounded)' : '(standalone descriptions)'}</div>
            <label style={{ fontSize: '12px', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={includeCompounded} onChange={(e) => setIncludeCompounded(e.target.checked)} /> Include compounded
            </label>
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Shows average recommended percent impact across VCS for singular location analyses. For compounded descriptions we sum the component recommendations and cap at 25% (asterisked). Use the Applied inputs to set values for matching worksheet rows.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#FFFFFF' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: '600' }}>Location</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: '600' }}>VCS Count</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: '600' }}>Recommended %</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: '600' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {summaryList.map(item => (
                  <tr key={item.location} style={{ borderTop: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '8px' }}>{item.location}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>{item.count}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontWeight: '600' }}>{item.avgPercent !== null ? `${item.avgPercent.toFixed(1)}%` : 'N/A'}</td>
                    <td style={{ padding: '8px', textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        placeholder="+"
                        value={summaryInputs[item.location]?.positive || ''}
                        onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => setSummaryInputs(prev => ({ ...prev, [item.location]: { ...(prev[item.location] || {}), positive: e.target.value } }))}
                        style={{ width: '60px', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', textAlign: 'center', WebkitAppearance: 'none', MozAppearance: 'textfield', appearance: 'textfield' }}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        placeholder="-"
                        value={summaryInputs[item.location]?.negative || ''}
                        onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                        onWheel={(e) => e.currentTarget.blur()}
                        onChange={(e) => setSummaryInputs(prev => ({ ...prev, [item.location]: { ...(prev[item.location] || {}), negative: e.target.value } }))}
                        style={{ width: '60px', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', textAlign: 'center', WebkitAppearance: 'none', MozAppearance: 'textfield', appearance: 'textfield' }}
                      />
                      <button onClick={() => {
                        const entry = summaryInputs[item.location] || {};
                        const pos = entry.positive !== undefined && entry.positive !== '' ? parseFloat(entry.positive) : null;
                        const neg = entry.negative !== undefined && entry.negative !== '' ? parseFloat(entry.negative) : null;
                        // Apply both if provided; positive applies to positive field, negative to negative field
                        if (pos === null && neg === null) return alert('Enter a value in Applied+ or Applied-');
                        applySummarySet(item.location, pos, neg);
                        alert('Applied values to matching worksheet rows');
                      }} style={{ padding: '6px 10px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '4px' }}>Set</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => {
              // Apply inputs for all summary rows; if no input for an item, apply avgPercent if available
              const tentativeRegex = /\bpossible|possibly\b|\?/i;
              summaryList.forEach(item => {
                const entry = summaryInputs[item.location] || {};
                const pos = entry.positive !== undefined && entry.positive !== '' ? parseFloat(entry.positive) : null;
                const neg = entry.negative !== undefined && entry.negative !== '' ? parseFloat(entry.negative) : null;

                // Skip tentative locations or tentative parts inside a compound
                const parts = splitLocationParts(item.location || '');
                if (tentativeRegex.test(item.location) || parts.some(p => tentativeRegex.test(p))) {
                  debug(`Skipping tentative summary item in Set All: ${item.location}`);
                  return;
                }

                if (pos !== null || neg !== null) {
                  debug(`Set All applying explicit values for ${item.location}: +${pos || 0} -${neg || 0}`);
                  applySummarySet(item.location, pos, neg);
                } else if (item.avgPercent !== null && item.avgPercent !== undefined && !isNaN(Number(item.avgPercent))) {
                  // Use avgPercent to populate appropriate side(s)
                  const avg = Number(item.avgPercent);
                  const posVal = avg > 0 ? Math.abs(avg) : null;
                  const negVal = avg < 0 ? Math.abs(avg) : null;
                  if (posVal !== null || negVal !== null) {
                    debug(`Set All applying avgPercent for ${item.location}: ${avg}`);
                    applySummarySet(item.location, posVal, negVal);
                  }
                }
              });
              alert('Set applied for all visible summary rows (skipped tentative locations)');
            }} style={{ padding: '8px 12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px' }}>Set All</button>
          </div>
        </div>
      </div>
    );
  };

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
  <div className="mls-subtab-nav">
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
            className={`mls-subtab-btn mls-subtab-btn-lg ${activeSubTab === tab.id ? 'mls-subtab-btn--active' : ''} ${tab.disabled ? 'disabled' : ''}`}
          >
            {tab.icon}
            <span style={{ marginLeft: 6 }}>{tab.label}</span>
          </button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => exportToExcel('complete')}
            style={{
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
            onClick={() => saveAnalysis({ source: 'manual' })}
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

      {/* Mark Complete footer for selected subtab (updates Management Checklist) */}
      <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        {activeSubTab === 'land-rates' && (
          <button
            onClick={() => toggleChecklist('land-value-tables', isLandRatesComplete, setIsLandRatesComplete)}
            style={{
              padding: '8px 14px',
              backgroundColor: isLandRatesComplete ? '#10B981' : '#E5E7EB',
              color: isLandRatesComplete ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600
            }}
            title={isLandRatesComplete ? 'Click to reopen' : 'Mark Land Value Tables Built complete'}
          >
            {isLandRatesComplete ? '✓ Mark Complete' : 'Mark Complete'}
          </button>
        )}

        {activeSubTab === 'vcs-sheet' && (
          <button
            onClick={() => toggleChecklist('vcs-reviewed', isVcsSheetComplete, setIsVcsSheetComplete)}
            style={{
              padding: '8px 14px',
              backgroundColor: isVcsSheetComplete ? '#10B981' : '#E5E7EB',
              color: isVcsSheetComplete ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600
            }}
            title={isVcsSheetComplete ? 'Click to reopen' : 'Mark VCS Reviewed/Reset complete'}
          >
            {isVcsSheetComplete ? '�� Mark Complete' : 'Mark Complete'}
          </button>
        )}

        {activeSubTab === 'eco-obs' && (
          <button
            onClick={() => toggleChecklist('economic-obsolescence', isEcoObsComplete, setIsEcoObsComplete)}
            style={{
              padding: '8px 14px',
              backgroundColor: isEcoObsComplete ? '#10B981' : '#E5E7EB',
              color: isEcoObsComplete ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600
            }}
            title={isEcoObsComplete ? 'Click to reopen' : 'Mark Economic Obsolescence Study complete'}
          >
            {isEcoObsComplete ? '�� Mark Complete' : 'Mark Complete'}
          </button>
        )}
      </div>
    </div>
  );
};

export default LandValuationTab;
