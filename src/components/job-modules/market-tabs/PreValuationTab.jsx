import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase, interpretCodes, worksheetService, checklistService, runUnitRateLotCalculation, runUnitRateLotCalculation_v2, computeLotAcreForProperty, persistComputedLotAcre, normalizeSelectedCodes, saveUnitRateMappings, generateLotSizesForJob } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';
import './sharedTabNav.css';
import { 
  TrendingUp, 
  Download, 
  Save,
  RefreshCw,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Copy,
  FileSpreadsheet,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

const PreValuationTab = ({ 
  jobData, 
  properties,
  marketLandData,
  hpiData,
  codeDefinitions,
  vendorType,
  onDataChange,
  onUpdateJobCache 
}) => {
    if (false) console.log('PreValuationTab MOUNTED/UPDATED:', {
    jobId: jobData?.id,
    vendorType,
    hasMarketLandData: !!marketLandData,
    marketLandDataKeys: marketLandData ? Object.keys(marketLandData).length : 0
  });
  // ==================== STATE MANAGEMENT ====================
  
  // Normalization Configuration State (matching HTML UI)
  const [normalizeToYear, setNormalizeToYear] = useState(2025);
  const [salesFromYear, setSalesFromYear] = useState(2012);
  const [selectedCounty, setSelectedCounty] = useState(jobData?.county || 'Bergen');
  const [availableCounties, setAvailableCounties] = useState([]);
  const [equalizationRatio, setEqualizationRatio] = useState('');
  const [outlierThreshold, setOutlierThreshold] = useState('');
  const [minSalePrice, setMinSalePrice] = useState(100);
  
  // Normalization Data State
  const [activeSubTab, setActiveSubTab] = useState('normalization');
  const [hpiLoaded, setHpiLoaded] = useState(true);
  const [timeNormalizedSales, setTimeNormalizedSales] = useState([]);
  const [isProcessingTime, setIsProcessingTime] = useState(false);
  const [isProcessingSize, setIsProcessingSize] = useState(false);
  const [salesReviewFilter, setSalesReviewFilter] = useState('all');
  const [normalizationStats, setNormalizationStats] = useState({
    totalSales: 0,
    timeNormalized: 0,
    excluded: 0,
    flaggedOutliers: 0,
    pendingReview: 0,
    averageRatio: 0,
    // Size normalization stats
    acceptedSales: 0,
    sizeNormalized: 0,
    singleFamily: 0,
    multifamily: 0,
    townhouses: 0,
    conversions: 0,
    avgSizeAdjustment: 0
  });
  const [worksheetProperties, setWorksheetProperties] = useState([]);
  const [lastTimeNormalizationRun, setLastTimeNormalizationRun] = useState(null);
  const [lastSizeNormalizationRun, setLastSizeNormalizationRun] = useState(null);
  const [recentSalesChanges, setRecentSalesChanges] = useState(null);

  // Control to pause parent refreshes while user is actively editing
  const [pauseAutoRefresh, setPauseAutoRefresh] = useState(false);

  const callRefresh = useMemo(() => {
    let refreshTimer = null;
    let lastRefreshAt = 0;
    const COOLDOWN = 30000; // 30s cooldown to match parent

    const doRefresh = (force = false) => {
      if (pauseAutoRefresh || processingRef.current) return;
      if (typeof onUpdateJobCache !== 'function' || !jobData?.id) return;
      try {
        onUpdateJobCache(jobData.id, { forceRefresh: true });
        lastRefreshAt = Date.now();
      } catch (e) {
        console.warn('debounced callRefresh failed:', e);
      }
    };

    const queuedRefresh = (opts = null) => {
      // If opts explicitly requests forceRefresh, perform immediate refresh
      const force = opts && opts.forceRefresh;
      const now = Date.now();

      if (force) {
        // Cancel any pending timer and refresh immediately
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        doRefresh(true);
        return;
      }

      // Respect pause and processing states
      if (pauseAutoRefresh || processingRef.current) return;

      const sinceLast = now - lastRefreshAt;
      if (sinceLast > COOLDOWN) {
        doRefresh(false);
        return;
      }

      // Debounce subsequent calls until cooldown expires
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        doRefresh(false);
      }, COOLDOWN - sinceLast);
    };

    queuedRefresh.cancel = () => {
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    };

    return queuedRefresh;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseAutoRefresh, onUpdateJobCache, jobData?.id]);

  // Mounted guard to prevent initial effect storms
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Listen for external navigation events to select a specific PreValuation subtab
  useEffect(() => {
    const handler = (e) => {
      try {
        const tabId = e?.detail?.tabId;
        if (!tabId) return;
        const valid = ['marketAnalysis', 'unitRates', 'worksheet', 'zoning', 'normalization'];
        if (valid.includes(tabId)) setActiveSubTab(tabId);
      } catch (err) {
        console.error('navigate_prevaluation_subtab handler error', err);
      }
    };
    window.addEventListener('navigate_prevaluation_subtab', handler);
    return () => window.removeEventListener('navigate_prevaluation_subtab', handler);
  }, []);

  // Import diagnostic state (paste CSV to diagnose unmatched vs exact keys)
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [diagnosticCsvText, setDiagnosticCsvText] = useState('');
  const [diagnosticResults, setDiagnosticResults] = useState(null);
  const [isRunningDiagnostic, setIsRunningDiagnostic] = useState(false);
  const [isSavingDecisions, setIsSavingDecisions] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, message: '' });
  const [sizeNormProgress, setSizeNormProgress] = useState({ current: 0, total: 0, message: '' });
  const [timeNormProgress, setTimeNormProgress] = useState({ current: 0, total: 0, message: '' });
  const [filteredWorksheetProps, setFilteredWorksheetProps] = useState([]);
  const [worksheetSearchTerm, setWorksheetSearchTerm] = useState('');
  const [worksheetFilter, setWorksheetFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  const [normCurrentPage, setNormCurrentPage] = useState(1);
  const [normItemsPerPage, setNormItemsPerPage] = useState(100);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [readyProperties, setReadyProperties] = useState(new Set());

  // Track rows currently being edited to avoid hiding them mid-edit when filters are applied
  const [editingRows, setEditingRows] = useState(new Set());
  const editTimersRef = useRef(new Map());
  // Use a ref for immediate synchronous checks while typing to avoid timing issues with Set in state
  const editingRowsRef = useRef(new Set());
  // Ref to indicate when the component is performing a processing operation to suppress refreshes
  const processingRef = useRef(false);
  // Unit Rate Configuration state (BRT only)
  const [unitRateCodes, setUnitRateCodes] = useState([]);
  const [selectedUnitRateCodes, setSelectedUnitRateCodes] = useState(new Set());
  const [isCalculatingUnitSizes, setIsCalculatingUnitSizes] = useState(false);
  const [isSavingUnitConfig, setIsSavingUnitConfig] = useState(false);
  const [isExportingLotSizes, setIsExportingLotSizes] = useState(false);
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });

  // Unit rate mappings editor state
  const [mappingVcsKey, setMappingVcsKey] = useState('');
  const [mappingAcre, setMappingAcre] = useState([]);
  const [mappingSf, setMappingSf] = useState([]);
  const [mappingExclude, setMappingExclude] = useState([]);
  const [isSavingMappings, setIsSavingMappings] = useState(false);
  const [isGeneratingLotSizes, setIsGeneratingLotSizes] = useState(false);
  // Dynamic VCS options for mappings dropdown
  const [vcsOptions, setVcsOptions] = useState([]);
  // Local staged mappings (not yet persisted)
  const [stagedMappings, setStagedMappings] = useState({});
  // Combined view of persisted mappings (from marketLandData) + staged
  const [combinedMappings, setCombinedMappings] = useState({});
  // Available codes per VCS for drag source (updates as user drags)
  const [availableCodesByVcs, setAvailableCodesByVcs] = useState({});
  // VCS options displayed (exclude staged ones)
  const [vcsOptionsShown, setVcsOptionsShown] = useState([]);
  // Drag state
  const [draggingCode, setDraggingCode] = useState(null);

  const saveMapping = async () => {
    if (!jobData?.id) return alert('Job required');
    if (!mappingVcsKey) return alert('Enter VCS key');
    setIsSavingMappings(true);
    try {
      const acreArr = mappingAcre.map(c => String(c).trim()).filter(Boolean);
      const sfArr = mappingSf.map(c => String(c).trim()).filter(Boolean);
      const exclArr = mappingExclude.map(c => String(c).trim()).filter(Boolean);
      await saveUnitRateMappings(jobData.id, mappingVcsKey, { acre: acreArr, sf: sfArr, exclude: exclArr });
      // Update combined mappings local view
      const merged = { ...(combinedMappings || {}) };
      merged[mappingVcsKey] = { acre: acreArr, sf: sfArr, exclude: exclArr };
      setCombinedMappings(merged);
      // Clear staged for this VCS
      setStagedMappings(prev => { const copy = { ...prev }; delete copy[mappingVcsKey]; return copy; });
      alert('Mappings saved');
    } catch (e) {
      console.error('Failed saving mappings', e);
      alert('Saving mappings failed');
    } finally {
      setIsSavingMappings(false);
    }
  };

  const handleGenerateLotSizes = async () => {
    if (!jobData?.id) return alert('Job required');
    if (!window.confirm('Generate lot sizes for entire job using current mappings?')) return;
    setIsGeneratingLotSizes(true);
    try {
      const res = await generateLotSizesForJob(jobData.id);
      const updated = res?.updated ?? 0;
      console.log(`✅ Generated lot sizes for ${updated} properties`);
      if (onUpdateJobCache) callRefresh(null);
    } catch (e) {
      console.error('Generate failed', e);
      alert('Generate failed: ' + (e.message || e));
    } finally {
      setIsGeneratingLotSizes(false);
    }
  };
  // Mapping helpers: add/remove codes to zones and staging
  const addCodeToZone = (code, zone) => {
    code = String(code).trim();
    if (!code) return;
    const normalized = code;
    // remove from other zones
    setMappingAcre(prev => prev.filter(c => c !== normalized));
    setMappingSf(prev => prev.filter(c => c !== normalized));
    setMappingExclude(prev => prev.filter(c => c !== normalized));
    if (zone === 'acre') setMappingAcre(prev => prev.includes(normalized) ? prev : [...prev, normalized]);
    if (zone === 'sf') setMappingSf(prev => prev.includes(normalized) ? prev : [...prev, normalized]);
    if (zone === 'exclude') setMappingExclude(prev => prev.includes(normalized) ? prev : [...prev, normalized]);

    // Remove from available codes for current VCS
    if (mappingVcsKey) {
      setAvailableCodesByVcs(prev => {
        const copy = { ...prev };
        copy[mappingVcsKey] = (copy[mappingVcsKey] || []).filter(x => String(x.code) !== String(normalized));
        return copy;
      });
    }
  };

  const removeCodeFromZone = (code, zone) => {
    const c = String(code).trim();
    if (zone === 'acre') setMappingAcre(prev => prev.filter(x => x !== c));
    if (zone === 'sf') setMappingSf(prev => prev.filter(x => x !== c));
    if (zone === 'exclude') setMappingExclude(prev => prev.filter(x => x !== c));

    // Re-add to available codes for current VCS if not already present
    if (mappingVcsKey) {
      setAvailableCodesByVcs(prev => {
        const copy = { ...prev };
        const list = copy[mappingVcsKey] ? copy[mappingVcsKey].slice() : [];
        const exists = list.some(x => String(x.code) === String(c));
        if (!exists) {
          const found = unitRateCodes.find(u => String(u.vcs) === String(mappingVcsKey) && String(u.code) === String(c));
          if (found) list.push({ code: found.code, description: found.description, key: found.key, vcs: found.vcs, vcsLabel: found.vcsLabel });
          copy[mappingVcsKey] = list;
        }
        return copy;
      });
    }
  };

  const stageMapping = async () => {
    if (!mappingVcsKey) return alert('Select a VCS first');
    if (!jobData?.id) return alert('Job required');
    const payload = { acre: mappingAcre.slice(), sf: mappingSf.slice(), exclude: mappingExclude.slice() };
    const newStaged = { ...(stagedMappings || {}), [mappingVcsKey]: payload };

    // Update local staged state (do not mark as saved yet)
    setStagedMappings(newStaged);

    // Persist staged snapshot to jobs.staged_unit_rate_config so it survives reloads
    try {
      const { error } = await supabase.from('jobs').update({ staged_unit_rate_config: newStaged }).eq('id', jobData.id);
      if (error) throw error;
      alert(`Staged mapping for VCS ${mappingVcsKey}`);
    } catch (e) {
      console.error('Failed persisting staged mapping', e);
      alert('Failed staging mapping: ' + (e.message || e));
    }
  };

  // When the selected VCS changes, populate mapping arrays from staged -> combined -> empty
  useEffect(() => {
    if (!mappingVcsKey) {
      setMappingAcre([]); setMappingSf([]); setMappingExclude([]);
      return;
    }
    const m = (stagedMappings && stagedMappings[mappingVcsKey]) || (combinedMappings && combinedMappings[mappingVcsKey]) || { acre: [], sf: [], exclude: [] };
    setMappingAcre(Array.isArray(m.acre) ? m.acre.slice() : []);
    setMappingSf(Array.isArray(m.sf) ? m.sf.slice() : []);
    setMappingExclude(Array.isArray(m.exclude) ? m.exclude.slice() : []);
  }, [mappingVcsKey, stagedMappings, combinedMappings]);

  const [normSortConfig, setNormSortConfig] = useState({ field: null, direction: 'asc' });
  const [locationVariations, setLocationVariations] = useState({});
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [currentLocationChoice, setCurrentLocationChoice] = useState(null);

  const [worksheetStats, setWorksheetStats] = useState({
    totalProperties: 0,
    vcsAssigned: 0,
    zoningEntered: 0,
    locationAnalysis: 0,
    readyToProcess: 0
  });
  const [zoningData, setZoningData] = useState([]);
  const [editingZoning, setEditingZoning] = useState({});
  const [autoSaveTimer, setAutoSaveTimer] = useState(null);
  
  // Import Modal State (from our discussion)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importListTab, setImportListTab] = useState(null);
  const [isAnalyzingImport, setIsAnalyzingImport] = useState(false);
  const [importOptions, setImportOptions] = useState({
    updateExisting: true,
    useAddressFuzzyMatch: false,
    fuzzyMatchThreshold: 0.8,
    markImportedAsReady: true
  });
  const [standardizations, setStandardizations] = useState({
    vcs: {},
    locations: {},
    zones: {}
  });
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, message: '' });
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0, message: '' });
  const [isProcessingProperties, setIsProcessingProperties] = useState(false);

  // Market Analysis State
  const [marketAnalysisData, setMarketAnalysisData] = useState([]);
  const [blockTypeFilter, setBlockTypeFilter] = useState('1');
  const [colorScaleStart, setColorScaleStart] = useState(100000);
  const [colorScaleIncrement, setColorScaleIncrement] = useState(50000);
  const [selectedBlockDetails, setSelectedBlockDetails] = useState(null);
  const [showBlockDetailModal, setShowBlockDetailModal] = useState(false);
  const [isProcessingBlocks, setIsProcessingBlocks] = useState(false);

  // Market Analysis Color Scale - Consistent Red → Purple progression
  // Two variations per color range: pastel (lower half) and bright (upper half)
  // Default: $100k increments with $50k steps = 2 steps per $100k
  const bluebeamPalette = [
    // Gray for no data only
    { hex: "#CCCCCC", name: "No Data", row: 0, col: 0 },

    // Red range ($0-99k)
    { hex: "#FFCCCC", name: "Light Red", row: 1, col: 1 },      // $0-49k
    { hex: "#FF6666", name: "Bright Red", row: 1, col: 2 },     // $50k-99k

    // Pink range ($100k-199k)
    { hex: "#FFB3D9", name: "Light Pink", row: 2, col: 1 },     // $100k-149k
    { hex: "#FF66B2", name: "Bright Pink", row: 2, col: 2 },    // $150k-199k

    // Orange range ($200k-299k)
    { hex: "#FFD9B3", name: "Light Orange", row: 3, col: 1 },   // $200k-249k
    { hex: "#FF9966", name: "Bright Orange", row: 3, col: 2 },  // $250k-299k

    // Yellow range ($300k-399k)
    { hex: "#FFFF99", name: "Light Yellow", row: 4, col: 1 },   // $300k-349k
    { hex: "#FFFF33", name: "Bright Yellow", row: 4, col: 2 },  // $350k-399k

    // Green range ($400k-499k)
    { hex: "#CCFFCC", name: "Light Green", row: 5, col: 1 },    // $400k-449k
    { hex: "#66FF66", name: "Bright Green", row: 5, col: 2 },   // $450k-499k

    // Teal range ($500k-599k)
    { hex: "#B3F0F0", name: "Light Teal", row: 6, col: 1 },     // $500k-549k
    { hex: "#33CCCC", name: "Bright Teal", row: 6, col: 2 },    // $550k-599k

    // Blue range ($600k-699k)
    { hex: "#99CCFF", name: "Light Blue", row: 7, col: 1 },     // $600k-649k
    { hex: "#3399FF", name: "Bright Blue", row: 7, col: 2 },    // $650k-699k

    // Purple range ($700k+)
    { hex: "#CCAAFF", name: "Light Purple", row: 8, col: 1 },   // $700k-749k
    { hex: "#9966FF", name: "Bright Purple", row: 8, col: 2 }   // $750k+
  ];
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(false);
  const [preValChecklist, setPreValChecklist] = useState({
    market_analysis: false,
    page_by_page: false,
    zoning_config: false
  });
  const [isProcessingPageByPage, setIsProcessingPageByPage] = useState(false);

// ==================== FILTER HPI DATA ====================
  // Check what HPI data we received
  if (false) console.log('🔍 HPI Data Check:', {
    hpiDataReceived: !!hpiData,
    hpiDataLength: hpiData?.length || 0,
    selectedCounty: selectedCounty,
    firstFewRecords: hpiData?.slice(0, 3)
  });
  
  // Filter HPI data for selected county from the prop
  const filteredHpiData = useMemo(() => {
    if (!hpiData || !selectedCounty) return [];
    
    const filtered = hpiData.filter(item => item.county_name === selectedCounty);
    if (false) console.log(`📈 Filtered ${filtered.length} HPI records for ${selectedCounty} County`);
    return filtered;
  }, [hpiData, selectedCounty]);

  // ==================== HELPER FUNCTIONS USING interpretCodes ====================
  
  const getBuildingClassDisplay = useCallback((property) => {
    if (!property) return '';

    // For now, just return the raw field since getBuildingClassName doesn't exist
    // and we need to avoid async calls in render
    return property.asset_building_class || '';
  }, []);

  const getTypeUseDisplay = useCallback((property) => {
    if (!property) return '';

    // Use only synchronous Microsystems decoding to avoid async rendering issues
    if (vendorType === 'Microsystems' && codeDefinitions) {
      const decoded = interpretCodes.getMicrosystemsValue?.(property, codeDefinitions, 'asset_type_use');
      return decoded || property.asset_type_use || '';
    }

    // For BRT, return raw value since getBRTValue is async
    return property.asset_type_use || '';
  }, [codeDefinitions, vendorType]);

  const getDesignDisplay = useCallback((property) => {
    if (!property) return '';

    // Use only synchronous Microsystems decoding to avoid async rendering issues
    if (vendorType === 'Microsystems' && codeDefinitions) {
      const decoded = interpretCodes.getMicrosystemsValue?.(property, codeDefinitions, 'asset_design_style');
      return decoded || property.asset_design_style || '';
    }

    // For BRT, return raw value since getBRTValue is async
    return property.asset_design_style || '';
  }, [codeDefinitions, vendorType]);

  const parseCompositeKey = useCallback((compositeKey) => {
    if (!compositeKey) return { block: '', lot: '', qualifier: '', card: '', location: '' };
    
    // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
    const parts = compositeKey.split('-');
    if (parts.length < 3) return { block: '', lot: '', qualifier: '', card: '', location: '' };
    
    const block = parts[1] || '';
    const lotQual = parts[2] || '';
    const [lot, qualifier] = lotQual.split('_');
    
    return {
      block,
      lot: lot || '',
      qualifier: qualifier === 'NONE' ? '' : qualifier || '',
      card: parts[3] === 'NONE' ? '' : parts[3] || '',
      location: parts[4] === 'NONE' ? '' : parts[4] || ''
    };
  }, []);

  // Load available counties from database
useEffect(() => {
  const loadAvailableCounties = async () => {
    try {
      const { data, error } = await supabase
        .from('county_hpi_data')
        .select('county_name')
        .order('county_name');

      if (error) throw error;

      // Get unique counties
      const uniqueCounties = [...new Set(data.map(item => item.county_name))];
      setAvailableCounties(uniqueCounties);

      // Set default to job's county or first available
      if (uniqueCounties.length > 0 && !selectedCounty) {
        setSelectedCounty(jobData?.county || uniqueCounties[0]);
      }

      if (false) console.log(`📍 Found ${uniqueCounties.length} counties with HPI data:`, uniqueCounties);
    } catch (error) {
      console.error('Error loading counties:', error);
    }
  };

  loadAvailableCounties();

  // Load checklist statuses for pre-valuation items
  const loadChecklistStatuses = async () => {
    try {
      if (!jobData?.id) return;
      const ids = ['market-analysis','page-by-page','zoning-config','market_analysis','page_by_page','zoning_config'];
      const { data } = await supabase
        .from('checklist_item_status')
        .select('item_id,status')
        .eq('job_id', jobData.id)
        .in('item_id', ids);
      if (data) {
        const state = { market_analysis: false, page_by_page: false, zoning_config: false };
        data.forEach(d => {
          if (d.item_id === 'market-analysis' || d.item_id === 'market_analysis') state.market_analysis = d.status === 'completed';
          if (d.item_id === 'page-by-page' || d.item_id === 'page_by_page') state.page_by_page = d.status === 'completed';
          if (d.item_id === 'zoning-config' || d.item_id === 'zoning_config') state.zoning_config = d.status === 'completed';
        });
        setPreValChecklist(state);
      }
    } catch (e) {
      // ignore
    }
  };

  loadChecklistStatuses();
  }, []);


// ==================== UNIT RATE CODES (BRT) ====================
useEffect(() => {
  // Build a unique list of URC/unit-rate codes from codeDefinitions (BRT format)
  if (!codeDefinitions || !codeDefinitions.sections || !codeDefinitions.sections.VCS) {
    setUnitRateCodes([]);
    setSelectedUnitRateCodes(new Set());
    return;
  }

  const codesMap = new Map();
  try {
    const vcsSection = codeDefinitions.sections.VCS;
    // Build a map of vcsKey -> short identifier (e.g. PLV/WAT/etc) when available
    const vcsLabelMap = {};
    Object.keys(vcsSection).forEach(vcsKey => {
      const vEntry = vcsSection[vcsKey];
      // Prefer DATA.KEY or KEY as the short code, fall back to DATA.VALUE (long name) or numeric key
      const short = (vEntry?.DATA?.KEY && String(vEntry.DATA.KEY).trim()) || (vEntry?.KEY && String(vEntry.KEY).trim()) || (vEntry?.DATA?.VALUE && String(vEntry.DATA.VALUE).trim()) || String(vcsKey);
      vcsLabelMap[String(vcsKey)] = short;
    });

    // Build VCS dropdown options for mappings editor
    try {
      const vcsOptionsArr = Object.keys(vcsSection).map(k => ({ key: String(k), label: vcsLabelMap[String(k)] || String(k) }));
      setVcsOptions(vcsOptionsArr);
    } catch (err) {
      setVcsOptions([]);
    }

    // Initialize combined mappings from marketLandData (if available) — only if mappings exist to avoid overwriting job-level saved mappings
    try {
      const existing = marketLandData?.unit_rate_codes_applied;
      const payloadObj = existing && typeof existing === 'string' ? JSON.parse(existing) : (existing || {});
      const mappingsFromDB = payloadObj.mappings || {};
      if (mappingsFromDB && Object.keys(mappingsFromDB).length > 0) {
        setCombinedMappings(mappingsFromDB);
      }
    } catch(e){ /* leave combinedMappings as-is */ }

    Object.keys(vcsSection).forEach(vcsKey => {
      const entry = vcsSection[vcsKey];
      const urcMap = entry?.MAP?.['8']?.MAP;
      if (!urcMap) return;
      Object.keys(urcMap).forEach(k => {
        const e = urcMap[k];
        const codeVal = e.KEY || e.DATA?.KEY || k;
        const desc = e.MAP?.['1']?.DATA?.VALUE || e.DATA?.VALUE || '';
        if (codeVal) {
          const compositeKey = `${vcsKey}::${String(codeVal).trim()}`;
          const vcsLabel = vcsLabelMap[String(vcsKey)] || vcsKey;
          const label = `${vcsLabel} · ${String(codeVal).trim()} — ${String(desc || `Code ${codeVal}`).trim()}`;
          if (!codesMap.has(compositeKey)) {
            codesMap.set(compositeKey, { code: String(codeVal).trim(), vcs: vcsKey, vcsLabel, description: String(desc || `Code ${codeVal}`).trim(), label });
          }
        }
      });
    });
  } catch (err) {
    console.error('Error extracting unit rate codes:', err);
  }

  const codes = Array.from(codesMap.entries()).map(([key, meta]) => ({ key, ...meta }));
  setUnitRateCodes(codes);

  // restore saved config if jobData contains unit_rate_config
  try {
    const saved = jobData?.unit_rate_config?.codes || jobData?.unit_rate_config || [];
    setSelectedUnitRateCodes(new Set(saved));
  } catch (e) {
    // ignore
  }

}, [codeDefinitions, jobData]);

// Load staged mappings persisted on the jobs row into UI state when jobData changes
useEffect(() => {
  try {
    const staged = jobData?.staged_unit_rate_config || jobData?.stagedUnitRateConfig || null;
    if (staged && typeof staged === 'object') {
      setStagedMappings(staged);
    }

    // If unit_rate_config is a structured staged-style mapping, use it as the saved mappings view
    const saved = jobData?.unit_rate_config || jobData?.unitRateConfig || null;
    let savedMappings = null;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      // Heuristic: if keys are numeric VCS keys, treat as mappings
      const keys = Object.keys(saved);
      const looksLikeStaged = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
      if (looksLikeStaged) savedMappings = saved;
      // If object has .mappings (legacy shape), unwrap it
      if (!savedMappings && saved.mappings && typeof saved.mappings === 'object') savedMappings = saved.mappings;
    }

    // Prefer savedMappings (from unit_rate_config) to marketLandData mappings; merge staged on top so staged edits are visible
    if (savedMappings) {
      setCombinedMappings(prev => ({ ...(savedMappings || {}), ...(staged || {}) }));
    } else {
      // fallback: keep previous behavior of merging staged into existing combinedMappings
      if (staged && typeof staged === 'object') {
        setCombinedMappings(prev => ({ ...(prev || {}), ...(staged || {}) }));
      }
    }
  } catch (e) {
    console.warn('Failed to load staged/saved mappings from jobData:', e);
  }
}, [jobData]);

// Whenever unitRateCodes, combinedMappings or stagedMappings change, rebuild availableCodesByVcs and vcsOptionsShown
useEffect(() => {
  const byVcs = {};
  unitRateCodes.forEach(u => {
    const v = String(u.vcs);
    if (!byVcs[v]) byVcs[v] = [];
    byVcs[v].push({ code: u.code, description: u.description, key: u.key, vcs: u.vcs, vcsLabel: u.vcsLabel });
  });
  // Remove codes already assigned in combinedMappings or stagedMappings
  const removeAssigned = (arr, assigned) => arr.filter(item => !(assigned.includes(String(item.code))));
  Object.keys(byVcs).forEach(v => {
    const assigned = [];
    const cm = combinedMappings[v] || { acre: [], sf: [], exclude: [] };
    const sm = stagedMappings[v] || { acre: [], sf: [], exclude: [] };
    assigned.push(...(cm.acre||[]), ...(cm.sf||[]), ...(cm.exclude||[]), ...(sm.acre||[]), ...(sm.sf||[]), ...(sm.exclude||[]));
    byVcs[v] = removeAssigned(byVcs[v], assigned);
  });
  setAvailableCodesByVcs(byVcs);

  // vcsOptionsShown excludes VCS that are staged (Ready to Save)
  const shown = vcsOptions.filter(opt => !stagedMappings[opt.key]);
  setVcsOptionsShown(shown);

}, [unitRateCodes, combinedMappings, stagedMappings, vcsOptions]);

// Group unit rate codes by description so we can show only a single instance per description
const groupedUnitRateCodes = useMemo(() => {
  const map = new Map();
  unitRateCodes.forEach(u => {
    const desc = (u.description || `Code ${u.code}`).trim();
    if (!map.has(desc)) map.set(desc, { description: desc, items: [] });
    map.get(desc).items.push(u);
  });

  return Array.from(map.values()).map(g => ({
    description: g.description,
    items: g.items.sort((a, b) => (a.vcsLabel || a.vcs || '').toString().localeCompare((b.vcsLabel || b.vcs || '').toString()) || (a.code || '').localeCompare(b.code || ''))
  })).sort((a, b) => a.description.localeCompare(b.description));
}, [unitRateCodes]);

// Refs for checkbox indeterminate state per group
const groupRefs = useRef({});

// ==================== USE SAVED NORMALIZATION DATA FROM PROPS ====================
useEffect(() => {
  if (!marketLandData) {
    if (false) console.log('❌ No marketLandData available to restore from');
    return;
  }

  if (false) console.log('🔄 Restoring data from marketLandData...', {
    hasNormalizationConfig: !!marketLandData.normalization_config,
    configKeys: marketLandData.normalization_config ? Object.keys(marketLandData.normalization_config) : [],
    hasTimeNormalizedSales: !!marketLandData.time_normalized_sales,
    salesCount: marketLandData.time_normalized_sales?.length || 0
  });

  // Always restore everything when we have marketLandData
  if (marketLandData.normalization_config) {
    const config = marketLandData.normalization_config;
    if (false) console.log('📋 Found normalization config:', config);

    // Set configuration values with explicit logging
    const eqRatio = config.equalizationRatio || '';
    const outThreshold = config.outlierThreshold || '';

    if (false) console.log(`�� Setting equalizationRatio: "${eqRatio}" (was: "${equalizationRatio}")`);
    if (false) console.log(`���� Setting outlierThreshold: "${outThreshold}" (was: "${outlierThreshold}")`);

    setEqualizationRatio(eqRatio);
    setOutlierThreshold(outThreshold);
    setNormalizeToYear(config.normalizeToYear || 2025);
    setSalesFromYear(config.salesFromYear || 2012);
    setMinSalePrice(config.minSalePrice || 100);
    setSelectedCounty(jobData?.county || config.selectedCounty || 'Bergen');
    setLastTimeNormalizationRun(config.lastTimeNormalizationRun || null);
    setLastSizeNormalizationRun(config.lastSizeNormalizationRun || null);
  } else {
    if (false) console.log('⚠️ No normalization_config found in marketLandData');
  }
  
  if (marketLandData.time_normalized_sales && marketLandData.time_normalized_sales.length > 0) {
    // Filter out sales that don't meet current minSalePrice threshold (e.g., $1 nominal sales)
    const currentMinPrice = marketLandData.normalization_config?.minSalePrice || 100;
    const validSales = marketLandData.time_normalized_sales.filter(sale =>
      sale.sales_price && sale.sales_price > currentMinPrice
    );

    if (false) console.log(`✅ Restoring ${validSales.length} normalized sales (filtered ${marketLandData.time_normalized_sales.length - validSales.length} below $${currentMinPrice})`);
    setTimeNormalizedSales(validSales);
  }
  
  if (marketLandData.normalization_stats) {
    if (false) console.log('📊 Restoring normalization stats:', marketLandData.normalization_stats);
    setNormalizationStats(marketLandData.normalization_stats);
  }
  
  if (marketLandData.zoning_config) {
    // Convert min_size_unit from database (snake_case) to minSizeUnit for UI (camelCase)
    const convertedConfig = {};
    Object.keys(marketLandData.zoning_config).forEach(zone => {
      convertedConfig[zone] = {
        ...marketLandData.zoning_config[zone],
        minSizeUnit: marketLandData.zoning_config[zone].min_size_unit || 'SF'
      };
    });
    setEditingZoning(convertedConfig);
  }
}, [marketLandData]);// Only run when marketLandData actually changes

// Keep combinedMappings in sync if marketLandData updates independently
useEffect(() => {
  try {
    const existing = marketLandData?.unit_rate_codes_applied;
    const payloadObj = existing && typeof existing === 'string' ? JSON.parse(existing) : (existing || {});
    const mappingsFromDB = payloadObj.mappings || {};
    if (mappingsFromDB && Object.keys(mappingsFromDB).length > 0) {
      // Merge DB mappings into existing combined mappings so jobData.unit_rate_config isn't overwritten by an empty marketLandData
      setCombinedMappings(prev => ({ ...(prev || {}), ...(mappingsFromDB || {}) }));
    }
  } catch (e) {
    // ignore
  }
}, [marketLandData]);

// Check for recent sales changes that need normalization
useEffect(() => {
  const checkForSalesChanges = async () => {
    if (!jobData?.id) return;

    try {
      // Get most recent comparison report with sales changes
      const { data: reports, error } = await supabase
        .from('comparison_reports')
        .select('report_date, report_data')
        .eq('job_id', jobData.id)
        .order('report_date', { ascending: false })
        .limit(1);

      if (error || !reports || reports.length === 0) {
        setRecentSalesChanges(null);
        return;
      }

      const latestReport = reports[0];
      const reportData = latestReport.report_data;
      const salesChangesCount = reportData?.summary?.salesChanges || 0;

      if (salesChangesCount === 0) {
        setRecentSalesChanges(null);
        return;
      }

      // Check if normalization was run after this report
      const reportDate = new Date(latestReport.report_date);
      const normDate = lastTimeNormalizationRun ? new Date(lastTimeNormalizationRun) : null;

      if (!normDate || reportDate > normDate) {
        // Sales changes exist and normalization hasn't been run since
        setRecentSalesChanges({
          count: salesChangesCount,
          reportDate: latestReport.report_date
        });
      } else {
        setRecentSalesChanges(null);
      }
    } catch (error) {
      console.error('Error checking for sales changes:', error);
    }
  };

  checkForSalesChanges();
}, [jobData?.id, lastTimeNormalizationRun]);

  // Unit Rate helpers
  const toggleUnitRateCode = (key) => {
    const s = new Set(selectedUnitRateCodes);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    setSelectedUnitRateCodes(new Set(s));
  };

  const toggleUnitRateGroup = (description) => {
    const group = groupedUnitRateCodes.find(g => g.description === description);
    if (!group) return;
    const s = new Set(selectedUnitRateCodes);
    const allSelected = group.items.every(i => s.has(i.key));
    if (allSelected) {
      group.items.forEach(i => s.delete(i.key));
    } else {
      group.items.forEach(i => s.add(i.key));
    }
    setSelectedUnitRateCodes(new Set(s));
  };

  const formatError = (err) => {
    try {
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      if (err.message) return err.message;
      return JSON.stringify(err);
    } catch (e) {
      return String(err);
    }
  };

  // Helper to display VCS names (frontend-only). Falls back to numeric key when codeDefinitions not available
  const getVCSDisplayName = useCallback((numericKey) => {
    if (!codeDefinitions?.sections?.VCS) return numericKey;
    const vcsEntry = codeDefinitions.sections.VCS[String(numericKey)];
    return vcsEntry?.DATA?.KEY || vcsEntry?.KEY || numericKey;
  }, [codeDefinitions]);

  const saveUnitRateConfig = async () => {
    if (!jobData?.id) return;
    setIsSavingUnitConfig(true);
    try {
      // If local stagedMappings is empty, try to load persisted staged from jobs row so Save Config uses the authoritative staged snapshot
      let staged = stagedMappings || {};
      if ((!staged || Object.keys(staged).length === 0) && jobData?.id) {
        try {
          const { data: jobRow } = await supabase.from('jobs').select('staged_unit_rate_config').eq('id', jobData.id).single();
          if (jobRow && jobRow.staged_unit_rate_config) {
            staged = jobRow.staged_unit_rate_config;
          }
        } catch (e) {
          // ignore - proceed with local staged (empty)
        }
      }

      const derived = [];
      Object.keys(staged || {}).forEach(vk => {
        const m = staged[vk] || { acre: [], sf: [], exclude: [] };
        (m.acre || []).forEach(c => { if (c || c === 0) derived.push(`${vk}::${String(c).trim()}`); });
        (m.sf || []).forEach(c => { if (c || c === 0) derived.push(`${vk}::${String(c).trim()}`); });
      });

      // Always derive flat codes from staged mappings (acre + sf). Do NOT fall back to UI selection.
      const finalCodes = Array.from(new Set(derived.map(c => String(c).trim())));

      // Persist the structured staged mapping into unit_rate_config only (do NOT modify staged_unit_rate_config)
      const updatePayload = { unit_rate_config: staged };

      const { error } = await supabase.from('jobs').update(updatePayload).eq('id', jobData.id);
      if (error) {
        console.warn('Update failed, attempting upsert fallback:', error);
        const { error: upsertErr } = await supabase.from('jobs').upsert([{ id: jobData.id, ...updatePayload }], { onConflict: 'id' });
        if (upsertErr) throw upsertErr;
      }

      // No flat codes to set in selectedUnitRateCodes anymore; keep UI staged state and combined view
      try {
        setSelectedUnitRateCodes(new Set());
      } catch (e) { /* ignore */ }

      setCombinedMappings(prev => ({ ...(prev || {}), ...(staged || {}) }));
      setVcsOptionsShown(vcsOptions.filter(opt => !(staged || {})[opt.key]));

      alert('Unit rate configuration saved to job (staged structure persisted)');
    } catch (e) {
      console.error('Error saving unit rate config/mappings:', e);
      alert(`Failed to save unit rate configuration/mappings: ${formatError(e)}`);
    } finally {
      setIsSavingUnitConfig(false);
    }
  };


  const calculateUnitRates = async () => {
    if (!jobData?.id) return;
    setIsCalculatingUnitSizes(true);
    try {
      // Use generateLotSizesForJob which applies staged mappings (jobs.staged_unit_rate_config) directly
      const res = await generateLotSizesForJob(jobData.id);
      const updated = res?.updated ?? 0;
      console.log(`✅ Generated lot sizes for ${updated} properties`);

      // Show completion popup
      alert(`✅ Lot size calculation complete!\n\nProcessed: ${updated} properties\n\nYou can now export the report to review results.`);

      // Do NOT auto-refresh job to avoid supabase 500 spikes
      // Keep local UI state as-is; user can refresh manually if needed
    } catch (e) {
      console.error('Error calculating unit rates:', e);
      alert(`Calculation failed: ${formatError(e)}`);
    } finally {
      setIsCalculatingUnitSizes(false);
    }
  };

  const exportLotSizeReport = async () => {
    if (!jobData?.id) return;
    setIsExportingLotSizes(true);
    try {
      // Get current file version first
      const { data: versionData } = await supabase
        .from('property_records')
        .select('file_version')
        .eq('job_id', jobData.id)
        .order('file_version', { ascending: false })
        .limit(1)
        .single();

      const currentFileVersion = versionData?.file_version || 1;
      console.log(`📊 Exporting lot sizes for file_version ${currentFileVersion} only`);

      // Fetch all properties in batches to bypass 5000 record limit
      const BATCH_SIZE = 1000;
      let allProps = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error: queryError } = await supabase
          .from('property_records')
          .select(`
            property_composite_key,
            property_location,
            property_m4_class,
            property_vcs,
            asset_lot_frontage,
            asset_lot_depth
          `)
          .eq('job_id', jobData.id)
          .eq('file_version', currentFileVersion)
          .order('property_composite_key')
          .range(offset, offset + BATCH_SIZE - 1);

        if (queryError) throw queryError;

        if (batch && batch.length > 0) {
          allProps = allProps.concat(batch);
          offset += BATCH_SIZE;
          hasMore = batch.length === BATCH_SIZE;
        } else {
          hasMore = false;
        }
      }

      // Filter: only include main cards (card 1 for BRT, card M for Microsystems)
      const isMainCard = (card) => {
        const cardUpper = String(card || '').toUpperCase();
        if (vendorType === 'Microsystems') {
          return cardUpper === 'M' || cardUpper === '';
        } else {
          // BRT or default
          return cardUpper === '1' || cardUpper === '';
        }
      };

      const propsWithLotData = allProps.filter(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        return isMainCard(parsed.card);
      });

      // Fetch lot size data in batches
      let allLotSizeData = [];
      offset = 0;
      hasMore = true;

      while (hasMore) {
        const { data: batch, error: lotError } = await supabase
          .from('property_market_analysis')
          .select('property_composite_key, market_manual_lot_acre, market_manual_lot_sf, new_vcs')
          .eq('job_id', jobData.id)
          .range(offset, offset + BATCH_SIZE - 1);

        if (lotError) throw lotError;

        if (batch && batch.length > 0) {
          allLotSizeData = allLotSizeData.concat(batch);
          offset += BATCH_SIZE;
          hasMore = batch.length === BATCH_SIZE;
        } else {
          hasMore = false;
        }
      }

      const lotSizeData = allLotSizeData;

      // Create a map for quick lookup
      const lotSizeMap = new Map();
      if (lotSizeData) {
        lotSizeData.forEach(item => {
          lotSizeMap.set(item.property_composite_key, {
            acre: item.market_manual_lot_acre,
            sf: item.market_manual_lot_sf,
            new_vcs: item.new_vcs
          });
        });
      }

      // Prepare export data
      const headers = [
        'Block',
        'Lot',
        'Qualifier',
        'Card',
        'Property Class',
        'VCS',
        'Location',
        'Total Front Foot',
        'Avg Depth',
        'Lot Size Acre',
        'Lot Size SF'
      ];

      const data = propsWithLotData.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        const lotData = lotSizeMap.get(prop.property_composite_key) || {};

        // Use new_vcs if available, otherwise fall back to property_vcs
        const vcs = lotData.new_vcs || prop.property_vcs || '';

        return [
          parsed.block || '',
          parsed.lot || '',
          parsed.qualifier || '',
          parsed.card || '',
          prop.property_m4_class || '',
          vcs,
          prop.property_location || '',
          prop.asset_lot_frontage || '',
          prop.asset_lot_depth || '',
          lotData.acre || '',
          lotData.sf || ''
        ];
      });

      // Create worksheet from array of arrays
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

      // Base style for all cells
      const baseStyle = {
        font: { name: 'Leelawadee', sz: 10 },
        alignment: { horizontal: 'center', vertical: 'center' }
      };

      // Header style (bold, no fill)
      const headerStyle = {
        font: { name: 'Leelawadee', sz: 10, bold: true },
        alignment: { horizontal: 'center', vertical: 'center' }
      };

      // Apply formatting to all cells
      const range = XLSX.utils.decode_range(ws['!ref']);

      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          // Apply header style to first row
          if (R === 0) {
            ws[cellAddress].s = headerStyle;
          } else {
            ws[cellAddress].s = { ...baseStyle };

            // Apply specific formatting based on column
            // Column H (Total Front Foot) - no decimals
            if (C === 7) {
              ws[cellAddress].s.numFmt = '#,##0';
            }
            // Column I (Avg Depth) - no decimals
            else if (C === 8) {
              ws[cellAddress].s.numFmt = '#,##0';
            }
            // Column J (Lot Size Acre) - max 2 decimals
            else if (C === 9) {
              ws[cellAddress].s.numFmt = '0.00';
            }
            // Column K (Lot Size SF) - no decimals with comma
            else if (C === 10) {
              ws[cellAddress].s.numFmt = '#,##0';
            }
          }
        }
      }

      // Set column widths
      ws['!cols'] = [
        { wch: 10 },  // Block
        { wch: 10 },  // Lot
        { wch: 12 },  // Qualifier
        { wch: 8 },   // Card
        { wch: 12 },  // Property Class
        { wch: 8 },   // VCS
        { wch: 30 },  // Location
        { wch: 15 },  // Total Front Foot
        { wch: 12 },  // Avg Depth
        { wch: 15 },  // Lot Size Acre
        { wch: 15 }   // Lot Size SF
      ];

      // Create workbook
      const wb = XLSX.utils.book_new();

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Lot Size Report');

      // Generate filename
      const fileName = `LotSizeReport_${jobData?.job_name || 'export'}_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Write file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${data.length} properties to ${fileName}`);
    } catch (e) {
      console.error('Error exporting lot size report:', e);
      alert(`Export failed: ${formatError(e)}`);
    } finally {
      setIsExportingLotSizes(false);
    }
  };

// ==================== WORKSHEET INITIALIZATION ====================
  useEffect(() => {
    if (properties && properties.length > 0) {
      const worksheetData = properties.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        
        return {
          id: prop.id,
          property_composite_key: prop.property_composite_key,
          ...parsed,
          property_location: prop.property_location,
          property_class: prop.property_m4_class,
          property_vcs: prop.property_vcs || prop.current_vcs || '',
          new_vcs: prop.new_vcs || '',
          location_analysis: prop.location_analysis || '',
          asset_zoning: prop.asset_zoning || '',
          asset_map_page: prop.asset_map_page || '',
          asset_key_page: prop.asset_key_page || '',
          worksheet_notes: prop.worksheet_notes || '',
          // Add raw fields for decoding
          asset_building_class: prop.asset_building_class,
          asset_type_use: prop.asset_type_use,
          asset_design_style: prop.asset_design_style,
          sections: prop.sections,  // For BRT
          // Display values
          building_class_display: getBuildingClassDisplay(prop),
          type_use_display: getTypeUseDisplay(prop),
          design_display: getDesignDisplay(prop)
        };
      });

      // Sort by block then lot (both as numbers)
      worksheetData.sort((a, b) => {
        const blockA = parseInt(a.block) || 0;
        const blockB = parseInt(b.block) || 0;
        
        if (blockA !== blockB) {
          return blockA - blockB;
        }
        
        // If blocks are same, sort by lot (handle decimals like 3.01, 3.02)
        const lotA = parseFloat(a.lot) || 0;
        const lotB = parseFloat(b.lot) || 0;
        
        return lotA - lotB;
      });

      setWorksheetProperties(worksheetData);
      setFilteredWorksheetProps(worksheetData);
      updateWorksheetStats(worksheetData);
    }
  }, [properties, parseCompositeKey, getBuildingClassDisplay, getTypeUseDisplay, getDesignDisplay]);

  // ==================== NORMALIZATION FUNCTIONS ====================
  
const getHPIMultiplier = useCallback((saleYear, targetYear) => {
  // Find the max year available in HPI data
  const maxHPIYear = Math.max(...filteredHpiData.map(h => h.observation_year));
    
    // If sale year is beyond our HPI data, use 1.0
    if (saleYear > maxHPIYear) return 1.0;
    
    // Use the max available year if target year is beyond HPI data
    const effectiveTargetYear = targetYear > maxHPIYear ? maxHPIYear : targetYear;
    
    if (saleYear === effectiveTargetYear) return 1.0;
    
  const saleYearData = filteredHpiData.find(h => h.observation_year === saleYear);
  const targetYearData = filteredHpiData.find(h => h.observation_year === effectiveTargetYear);
    
    if (!saleYearData || !targetYearData) {
      // Only warn once, not for every sale
      if (!saleYearData && saleYear <= maxHPIYear) {
        console.warn(`Missing HPI data for sale year ${saleYear}`);
      }
      return 1.0;
    }
    
    const saleHPI = saleYearData.hpi_index || 100;
    const targetHPI = targetYearData.hpi_index || 100;
    
    return targetHPI / saleHPI;
  }, [filteredHpiData]);

  const runTimeNormalization = useCallback(async () => {
    setIsProcessingTime(true);
    setTimeNormProgress({ current: 0, total: properties.length, message: 'Analyzing properties...' });

    try {
      // DEBUG: Check initial properties data structure
      if (false) console.log(`🚀 Starting time normalization with ${properties.length} total properties`);
      if (properties.length > 0) {
        if (false) console.log('🔍 RAW PROPERTIES SAMPLE (first property):');

        const firstProp = properties[0];
        if (false) console.log('🔍 CRITICAL FIELD CHECK FOR FIRST PROPERTY:');
        if (false) console.log('  🏗️ property_m4_class:', firstProp.property_m4_class, '(should be "2", "1", "3B", etc.)');
        if (false) console.log('  💰 values_mod_total:', firstProp.values_mod_total, '(should be 64900, 109900, etc.)');
        if (false) console.log('  📋 sales_nu:', firstProp.sales_nu, '(should be empty or "1")');
        if (false) console.log('  ✅ sales_price:', firstProp.sales_price, '(working field for comparison)');
        if (false) console.log('  ✅ property_location:', firstProp.property_location, '(working field for comparison)');

        // Check if the problem is that the fields exist but are being overwritten
        if (false) console.log('🔍 FULL PROPERTY OBJECT INSPECTION:');
        if (false) console.log('  property_composite_key:', firstProp.property_composite_key);
        if (false) console.log('  ALL KEYS:', Object.keys(firstProp));

        // If the fields are undefined, let's see what properties DO have values
        if (!firstProp.property_m4_class) {
          console.error('❌ property_m4_class is undefined in properties array!');
          if (false) console.log('  🔍 Checking for similar fields...');
          Object.keys(firstProp).forEach(key => {
            if (key.includes('class') || key.includes('m4')) {
              if (false) console.log(`    ${key}:`, firstProp[key]);
            }
          });
        }

        if (!firstProp.values_mod_total) {
          console.error('❌ values_mod_total is undefined in properties array!');
          if (false) console.log('  🔍 Checking for similar fields...');
          Object.keys(firstProp).forEach(key => {
            if (key.includes('value') || key.includes('total') || key.includes('assess') || key.includes('mod')) {
              if (false) console.log(`    ${key}:`, firstProp[key]);
            }
          });
        }
      }

      // Create a map of existing keep/reject decisions with sale data
      const existingDecisions = {};
      timeNormalizedSales.forEach(sale => {
        if (sale.keep_reject) {
          existingDecisions[sale.id] = {
            decision: sale.keep_reject,
            sales_price: sale.sales_price,
            sales_date: sale.sales_date,
            sales_nu: sale.sales_nu
          };
        }
      });
      
      // Filter for VALID residential sales only
      const validSales = properties.filter(p => {
        // Check for valid sales price
        if (!p.sales_price || p.sales_price <= minSalePrice) return false;
        
        // Check for valid sales date
        if (!p.sales_date) return false;

        // Check for minimum improvement value (exclude tear-downs)
        if (!p.values_mod_improvement || p.values_mod_improvement < 10000) return false;
        
        const saleYear = new Date(p.sales_date).getFullYear();
        if (saleYear < salesFromYear) return false;

        // Check that house existed at time of sale (year built <= sale year)
        if (p.asset_year_built && p.asset_year_built > saleYear) return false;
        
        // Parse composite key for card filtering
        const parsed = parseCompositeKey(p.property_composite_key);
        const card = parsed.card?.toUpperCase();

        // Card filter based on vendor
        if (vendorType === 'Microsystems') {
          // For Microsystems: Include M cards, and A cards only if no M card exists for same property
          if (card === 'M') {
            return true; // Always include M cards
          } else if (card === 'A') {
            // Check if there's an M card for the same block/lot/qualifier
            const baseKey = `${parsed.block}-${parsed.lot}_${parsed.qualifier}`;
            const hasMCard = properties.some(other => {
              const otherParsed = parseCompositeKey(other.property_composite_key);
              const otherBaseKey = `${otherParsed.block}-${otherParsed.lot}_${otherParsed.qualifier}`;
              return otherBaseKey === baseKey && otherParsed.card?.toUpperCase() === 'M';
            });
            return !hasMCard; // Include A card only if no M card exists
          }
          return false; // Exclude all other cards
        } else { // BRT
          if (card !== '1') return false;
        }
        
        // Check for required fields
        const buildingClass = p.asset_building_class?.toString().trim();
        const typeUse = p.asset_type_use?.toString().trim();
        const designStyle = p.asset_design_style?.toString().trim();
        
        if (!buildingClass || parseInt(buildingClass) <= 10) return false;
        if (!typeUse) return false;
        if (!designStyle) return false;
        
        // Check for valid living area
        if (!p.asset_sfla || p.asset_sfla <= 0) return false;
        
        return true;
      });

      setTimeNormProgress({ 
        current: properties.length, 
        total: properties.length, 
        message: `Found ${validSales.length} valid sales to normalize...` 
      });

      // Enhance valid sales with combined SFLA from additional cards
      const enhancedSales = validSales.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);

        // Start with a shallow copy of the incoming property to preserve all existing fields
        let enhancedProp = { ...prop };

        // If this is a main card, check for additional cards and aggregate SFLA
        if ((vendorType === 'Microsystems' && parsed.card === 'M') ||
            (vendorType === 'BRT' && parsed.card === '1')) {

          // Find additional cards for this property
          const additionalCards = properties.filter(p => {
            const pParsed = parseCompositeKey(p.property_composite_key);
            return pParsed.block === parsed.block &&
                   pParsed.lot === parsed.lot &&
                   pParsed.qualifier === parsed.qualifier &&
                   pParsed.card !== parsed.card &&
                   p.asset_sfla && p.asset_sfla > 0; // Only cards with living area
          });

          // Sum additional SFLA
          const additionalSFLA = additionalCards.reduce((sum, card) => sum + (card.asset_sfla || 0), 0);

          // Only augment the SFLA fields; do NOT overwrite other existing fields with possibly undefined values
          enhancedProp = {
            ...enhancedProp,
            original_sfla: enhancedProp.asset_sfla,
            asset_sfla: (enhancedProp.asset_sfla || 0) + additionalSFLA,
            has_additional_cards: additionalCards.length > 0
          };
        }

        // Ensure property_class is present but do not overwrite if already set
        if (!enhancedProp.property_class && prop.property_m4_class) {
          enhancedProp.property_class = prop.property_m4_class;
        }

        // Ensure key sales/assessment fields exist without overwriting existing values
        if (!enhancedProp.sales_nu && prop.sales_nu) {
          enhancedProp.sales_nu = prop.sales_nu;
        }
        if ((enhancedProp.values_mod_total === undefined || enhancedProp.values_mod_total === null) && (prop.values_mod_total !== undefined && prop.values_mod_total !== null)) {
          enhancedProp.values_mod_total = prop.values_mod_total;
        }

        return enhancedProp;
      });      
      
      // Process each valid sale
      const normalized = enhancedSales.map((prop, index) => {
        const saleYear = new Date(prop.sales_date).getFullYear();
        const hpiMultiplier = getHPIMultiplier(saleYear, normalizeToYear);
        const timeNormalizedPrice = Math.round(prop.sales_price * hpiMultiplier);

        // Calculate sales ratio
        const assessedValue = prop.values_mod_total || 0;
        const salesRatio = assessedValue > 0 && timeNormalizedPrice > 0
          ? assessedValue / timeNormalizedPrice
          : 0;

        // DEBUG: Log first few sales to check data and available fields
        if (index < 3) {
          if (false) console.log(`🔍 Sale ${index + 1} FULL PROPERTY DATA:`, prop);
          if (false) console.log(`🔍 Sale ${index + 1} SPECIFIC FIELDS:`, {
            id: prop.id,
            // Check all possible class field names
            property_class: prop.property_class,
            property_m4_class: prop.property_m4_class,
            asset_building_class: prop.asset_building_class,
            building_class: prop.building_class,
            // Check all possible sales NU field names
            sales_nu: prop.sales_nu,
            sales_instrument: prop.sales_instrument,
            nu: prop.nu,
            sale_nu: prop.sale_nu,
            // Check all possible assessed value field names
            values_mod_total: prop.values_mod_total,
            assessed_value: prop.assessed_value,
            total_assessed: prop.total_assessed,
            mod_total: prop.mod_total,
            sales_price: prop.sales_price,
            assessedValue,
            salesRatio: salesRatio.toFixed(3)
          });

          // Also log all property keys to see what's available
          if (false) console.log(`��� Sale ${index + 1} ALL AVAILABLE KEYS:`, Object.keys(prop));
        }
        
        // Determine if outlier based on equalization ratio
        const eqRatio = parseFloat(equalizationRatio);
        const outThreshold = parseFloat(outlierThreshold);
        const isOutlier = eqRatio && outThreshold ?
          Math.abs((salesRatio * 100) - eqRatio) > outThreshold : false;

        // Check if we have an existing decision for this property
        const existingDecisionData = existingDecisions[prop.id];
        let finalDecision = 'pending';
        let saleDataChanged = false;

        if (existingDecisionData) {
          // Check if sale data changed since the decision was made
          const priceChanged = existingDecisionData.sales_price !== prop.sales_price;
          const dateChanged = existingDecisionData.sales_date !== prop.sales_date;
          const nuChanged = existingDecisionData.sales_nu !== prop.sales_nu;

          saleDataChanged = priceChanged || dateChanged || nuChanged;

          if (saleDataChanged) {
            // Sale data changed - reset to pending and log the change
            finalDecision = 'pending';
            console.log(`⚠️ Sale data changed for ${prop.property_composite_key} - resetting decision to pending`, {
              old: {
                price: existingDecisionData.sales_price,
                date: existingDecisionData.sales_date,
                nu: existingDecisionData.sales_nu
              },
              new: {
                price: prop.sales_price,
                date: prop.sales_date,
                nu: prop.sales_nu
              },
              previousDecision: existingDecisionData.decision
            });
          } else {
            // Sale data unchanged - preserve existing decision
            finalDecision = existingDecisionData.decision;
          }
        }

        return {
          ...prop,
          time_normalized_price: timeNormalizedPrice,
          hpi_multiplier: hpiMultiplier,
          sales_ratio: salesRatio,
          is_outlier: isOutlier,
          keep_reject: finalDecision,
          sale_data_changed: saleDataChanged // Track if data changed for UI indication
        };
      });

      setTimeNormalizedSales(normalized);

      // DEBUG: Final data check
      if (false) console.log(`�� Time normalization complete: ${normalized.length} sales processed`);
      if (false) console.log('🔍 Sample normalized sales data:', normalized.slice(0, 2).map(s => ({
        id: s.id,
        property_m4_class: s.property_m4_class,
        sales_nu: s.sales_nu,
        values_mod_total: s.values_mod_total,
        sales_ratio: s.sales_ratio,
        has_package_data: !!interpretCodes.getPackageSaleData(properties, s)
      })));

      // Calculate excluded count (properties that didn't meet criteria)
      const excludedCount = properties.filter(p => {
        if (!p.sales_price || p.sales_price <= minSalePrice) return true;
        if (!p.sales_date) return true;
        const saleYear = new Date(p.sales_date).getFullYear();
        if (saleYear < salesFromYear) return true;
        return false;
      }).length;
      
      // Calculate average ratio
      const totalRatio = normalized.reduce((sum, s) => sum + (s.sales_ratio || 0), 0);
      const avgRatio = normalized.length > 0 ? totalRatio / normalized.length : 0;
      
      // Calculate stats including preserved decisions
      const newStats = {
        ...normalizationStats,
        totalSales: normalized.length,
        timeNormalized: normalized.length,
        excluded: excludedCount,
        flaggedOutliers: normalized.filter(s => s.is_outlier).length,
        pendingReview: normalized.filter(s => s.keep_reject === 'pending').length,
        keptCount: normalized.filter(s => s.keep_reject === 'keep').length,
        rejectedCount: normalized.filter(s => s.keep_reject === 'reject').length,
        averageRatio: avgRatio.toFixed(2),
        // DON'T RESET SIZE NORMALIZATION STATS!
        sizeNormalized: normalizationStats.sizeNormalized || 0,
        acceptedSales: normalizationStats.acceptedSales || 0,
        singleFamily: normalizationStats.singleFamily || 0,
        multifamily: normalizationStats.multifamily || 0,
        townhouses: normalizationStats.townhouses || 0,
        conversions: normalizationStats.conversions || 0,
        avgSizeAdjustment: normalizationStats.avgSizeAdjustment || 0
      };
      
      setNormalizationStats(newStats);
      
      // Save configuration to database
      const config = {
        equalizationRatio: equalizationRatio || '',
        outlierThreshold: outlierThreshold || '',
        normalizeToYear,
        salesFromYear,
        minSalePrice,
        selectedCounty: jobData?.county || selectedCounty,
        lastTimeNormalizationRun: new Date().toISOString()
      };
      
      await worksheetService.saveNormalizationConfig(jobData.id, config);

      // IMPORTANT: Save the normalized sales immediately to persist them
      await worksheetService.saveTimeNormalizedSales(jobData.id, normalized, newStats);

      // After time normalization save
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 PreValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }

      setLastTimeNormalizationRun(new Date().toISOString());

      // Count and notify about sale data changes
      const salesDataChangedCount = normalized.filter(s => s.sale_data_changed).length;
      if (salesDataChangedCount > 0) {
        console.warn(`⚠️ ${salesDataChangedCount} properties had sale data changes - decisions reset to pending review`);
        alert(`⚠️ IMPORTANT: ${salesDataChangedCount} properties have updated sale data.\n\nTheir Keep/Reject decisions have been automatically reset to "Pending Review".\n\nPlease review these properties in the normalization table below.`);
      }

      if (false) console.log(`✅ Time normalization complete - preserved ${Object.keys(existingDecisions).length} keep/reject decisions`);
      if (false) console.log('✅ Normalized sales saved to database for persistence');
    } catch (error) {
      console.error('Error during time normalization:', error);
      alert('Error during time normalization. Please check the console.');
    } finally {
      setIsProcessingTime(false);
      setTimeNormProgress({ current: 0, total: 0, message: '' });
    }
  }, [properties, salesFromYear, minSalePrice, normalizeToYear, equalizationRatio, outlierThreshold, getHPIMultiplier, timeNormalizedSales, normalizationStats, vendorType, parseCompositeKey, jobData.id, selectedCounty, worksheetService]);

  // Helper: Safe upsert into property_market_analysis with fallback to update/insert when ON CONFLICT key is missing
  const safeUpsertPropertyMarket = async (records) => {
    if (!records || records.length === 0) return { data: [], error: null };
    try {
      // Try batch upsert using property_composite_key as conflict target
      const { data, error } = await supabase
        .from('property_market_analysis')
        .upsert(records, { onConflict: 'job_id,property_composite_key' });
      if (!error) return { data, error: null };

      // If error indicates missing unique constraint for ON CONFLICT, fall back to update/insert per record
      if (error && (error.code === '42P10' || (error.message && error.message.includes('no unique or exclusion constraint')))) {
        const results = [];
        for (const rec of records) {
          try {
            // Try update first
            const { data: updated, error: updateError } = await supabase
              .from('property_market_analysis')
              .update(rec)
              .match({ property_composite_key: rec.property_composite_key })
              .select();

            if (updateError) throw updateError;
            if (updated && updated.length > 0) {
              results.push(updated[0]);
              continue;
            }

            // If no rows updated, insert new row
            const { data: inserted, error: insertError } = await supabase
              .from('property_market_analysis')
              .insert(rec)
              .select();

            if (insertError) throw insertError;
            results.push(Array.isArray(inserted) ? inserted[0] : inserted);

          } catch (e) {
            return { data: null, error: e };
          }
        }
        return { data: results, error: null };
      }

      // Other errors: return as-is
      return { data: null, error };

    } catch (err) {
      return { data: null, error: err };
    }
  };

  const saveSizeNormalizedValues = async (normalizedSales) => {
    try {
      // Save size normalized values to database
      for (const sale of normalizedSales) {
        if (sale.size_normalized_price) {
          const { error } = await safeUpsertPropertyMarket([{
            job_id: jobData.id,
            property_composite_key: sale.property_composite_key,
            values_norm_size: sale.size_normalized_price
          }]);
          if (error) throw error;
        }
      }
      if (false) console.log('✅ Size normalized values saved to database');

    } catch (error) {
      console.error('Error saving size normalized values:', error);
    }
  };

  const exportNormalizedSalesToExcel = useCallback(() => {
    if (!properties || properties.length === 0) {
      alert('No property data available to export.');
      return;
    }

    // Create a map of normalized sales for quick lookup
    const normalizedSalesMap = new Map();
    if (timeNormalizedSales && timeNormalizedSales.length > 0) {
      timeNormalizedSales.forEach(sale => {
        normalizedSalesMap.set(sale.id, sale);
      });
    }

    // Calculate average SFLA per type/use group (for kept sales only)
    const keptSales = timeNormalizedSales.filter(s => s.keep_reject === 'keep');
    const typeUseGroups = {
      '1': [], '2': [], '3': [], '4': [], '5': [], '6': []
    };

    keptSales.forEach(sale => {
      const typeUse = sale.asset_type_use?.toString().trim();
      if (typeUse && typeUse.length > 0) {
        const prefix = typeUse[0];
        if (typeUseGroups[prefix]) {
          typeUseGroups[prefix].push(sale);
        }
      }
    });

    // Calculate average SFLA for each group
    const avgSFLAByGroup = {};
    Object.entries(typeUseGroups).forEach(([prefix, sales]) => {
      if (sales.length > 0) {
        const totalSFLA = sales.reduce((sum, s) => sum + (s.asset_sfla || 0), 0);
        avgSFLAByGroup[prefix] = totalSFLA / sales.length;
      }
    });

    // Prepare data for export - ALL properties, keeping track of raw values for formulas
    const rawDataForFormulas = [];
    const exportData = properties.map(prop => {
      const parsed = parseCompositeKey(prop.property_composite_key);
      const normalizedData = normalizedSalesMap.get(prop.id);
      const packageData = interpretCodes.getPackageSaleData(properties, prop);

      let packageInfo = '';
      if (packageData) {
        if (packageData.is_farm_package) {
          packageInfo = `Farm (${packageData.package_count})`;
        } else if (packageData.is_additional_card) {
          packageInfo = `Addl Card (${packageData.package_count})`;
        } else {
          const deedRef = prop.sales_book && prop.sales_page ?
            `${prop.sales_book}/${prop.sales_page}` : 'Package';
          packageInfo = `Pkg ${deedRef} (${packageData.package_count})`;
        }
      }

      // Get average SFLA for this property's type/use group (only if time normalized)
      const typeUse = prop.asset_type_use?.toString().trim();
      const avgSFLA = (normalizedData && typeUse && typeUse.length > 0) ? avgSFLAByGroup[typeUse[0]] || '' : '';

      // Store raw values for formula logic
      rawDataForFormulas.push({
        sfla: prop.asset_sfla,
        avgSFLA: avgSFLA,
        timeNormPrice: normalizedData?.time_normalized_price,
        salePrice: prop.sales_price
      });

      return {
        'Block': parsed.block || '',
        'Lot': parsed.lot || '',
        'Qualifier': parsed.qualifier || '',
        'Card': parsed.card || '',
        'Location': prop.property_location || '',
        'VCS': prop.property_vcs || '',
        'Class': prop.property_m4_class || prop.property_class || prop.asset_building_class || '',
        'Type': getTypeUseDisplay(prop) || '',
        'Design': getDesignDisplay(prop) || '',
        'SFLA': prop.asset_sfla || '',
        'Year Built': prop.asset_year_built || '',
        'Package': packageInfo,
        'Assessed Value': prop.values_mod_total || prop.assessed_value || prop.total_assessed || '',
        'Sale Date': prop.sales_date ? new Date(prop.sales_date).toLocaleDateString() : '',
        'Sale Price': prop.sales_price || '',
        'Sale NU': prop.sales_nu || prop.sales_instrument || prop.nu || prop.sale_nu || '',
        'HPI Multiplier': normalizedData?.hpi_multiplier || '',
        'Time Normalized Price': normalizedData?.time_normalized_price || '',
        'Avg SFLA (Type Group)': avgSFLA ? Math.round(avgSFLA) : '',
        'Size Normalized Price': '',
        'Sales Ratio': '',
        'Status': normalizedData ? (normalizedData.is_outlier ? 'Outlier' : 'Valid') : '',
        'Decision': normalizedData ? (normalizedData.keep_reject === 'keep' ? 'Keep' : normalizedData.keep_reject === 'reject' ? 'Reject' : 'Pending') : ''
      };
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Get worksheet range
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Column indices (0-based) - Updated after adding VCS column at position 5
    const colSFLA = 9; // Column J (SFLA)
    const colAssessedValue = 12; // Column M (Assessed Value)
    const colSalePrice = 14; // Column O (Sale Price)
    const colHPIMultiplier = 16; // Column Q (HPI Multiplier)
    const colTimeNormalized = 17; // Column R (Time Normalized Price)
    const colAvgSFLA = 18; // Column S (Avg SFLA Type Group)
    const colSizeNormalized = 19; // Column T (Size Normalized Price)
    const colSalesRatio = 20; // Column U (Sales Ratio)

    // Ensure range extends to include all columns (Sales Ratio is the last)
    if (range.e.c < colSalesRatio) {
      range.e.c = colSalesRatio;
      ws['!ref'] = XLSX.utils.encode_range(range);
    }

    // Apply styling and formatting to all cells
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });

        // Base style for all cells
        const baseStyle = {
          font: { name: 'Leelawadee', sz: 10, bold: R === 0 },
          alignment: { horizontal: 'center', vertical: 'center' }
        };

        // Initialize cell if it doesn't exist
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: 's', v: '', s: { ...baseStyle } };
        } else {
          // Apply base style to existing cells
          ws[cellAddress].s = { ...baseStyle };
        }

        // Header row (row 0) - just bold, already applied above
        if (R === 0) continue;

        // Format SFLA column (I) and Avg SFLA (R) - number with comma, no decimals
        if ((C === colSFLA || C === colAvgSFLA) && ws[cellAddress].v) {
          ws[cellAddress].s.numFmt = '#,##0';
        }

        // Format Assessed Value (L), Sale Price (N) - currency with $, no decimals
        if ((C === colAssessedValue || C === colSalePrice) && ws[cellAddress].v) {
          ws[cellAddress].s.numFmt = '$#,##0';
        }

        // Time Normalized Price (Q) - formula and currency format
        if (C === colTimeNormalized) {
          const salePriceCell = XLSX.utils.encode_cell({ r: R, c: colSalePrice });
          const hpiMultiplierCell = XLSX.utils.encode_cell({ r: R, c: colHPIMultiplier });

          const salePriceValue = ws[salePriceCell]?.v;
          const hpiMultiplierValue = ws[hpiMultiplierCell]?.v;

          if (salePriceValue && hpiMultiplierValue) {
            ws[cellAddress] = {
              f: `${salePriceCell}*${hpiMultiplierCell}`,
              t: 'n',
              s: { ...baseStyle, numFmt: '$#,##0' }
            };
          } else if (ws[cellAddress].v) {
            ws[cellAddress].s.numFmt = '$#,##0';
          }
        }

        // Size Normalized Price (S) - Jim's complete 50% formula and currency format
        // Formula: ((AvgSFLA - CurrentSFLA) * ((TimeNormPrice / CurrentSFLA) * 0.5)) + TimeNormPrice
        if (C === colSizeNormalized) {
          const dataIndex = R - 1; // R=0 is header, data starts at R=1
          if (dataIndex >= 0 && dataIndex < rawDataForFormulas.length) {
            const rawData = rawDataForFormulas[dataIndex];

            // Only apply formula if property has been time normalized
            if (rawData.avgSFLA && rawData.sfla && rawData.timeNormPrice && rawData.sfla > 0) {
              const avgSFLACell = XLSX.utils.encode_cell({ r: R, c: colAvgSFLA });
              const sflaCell = XLSX.utils.encode_cell({ r: R, c: colSFLA });
              const timeNormCell = XLSX.utils.encode_cell({ r: R, c: colTimeNormalized });

              ws[cellAddress] = {
                f: `((${avgSFLACell}-${sflaCell})*((${timeNormCell}/${sflaCell})*0.5))+${timeNormCell}`,
                t: 'n',
                s: { ...baseStyle, numFmt: '$#,##0' }
              };
            }
          }
        }

        // Sales Ratio (T) - TimeNormalized / SalePrice as percentage, no decimals
        if (C === colSalesRatio) {
          const dataIndex = R - 1; // R=0 is header, data starts at R=1
          if (dataIndex >= 0 && dataIndex < rawDataForFormulas.length) {
            const rawData = rawDataForFormulas[dataIndex];

            // Only apply formula if property has been time normalized
            if (rawData.timeNormPrice && rawData.salePrice && rawData.salePrice > 0) {
              const timeNormCell = XLSX.utils.encode_cell({ r: R, c: colTimeNormalized });
              const salePriceCell = XLSX.utils.encode_cell({ r: R, c: colSalePrice });

              ws[cellAddress] = {
                f: `${timeNormCell}/${salePriceCell}`,
                t: 'n',
                s: { ...baseStyle, numFmt: '0%' }
              };
            }
          }
        }
      }
    }

    // Set column widths for better readability
    const colWidths = [
      { wch: 8 },  // Block
      { wch: 8 },  // Lot
      { wch: 10 }, // Qualifier
      { wch: 6 },  // Card
      { wch: 25 }, // Location
      { wch: 8 },  // Class
      { wch: 15 }, // Type
      { wch: 15 }, // Design
      { wch: 10 }, // SFLA
      { wch: 10 }, // Year Built
      { wch: 20 }, // Package
      { wch: 15 }, // Assessed Value
      { wch: 12 }, // Sale Date
      { wch: 15 }, // Sale Price
      { wch: 10 }, // Sale NU
      { wch: 15 }, // HPI Multiplier
      { wch: 20 }, // Time Normalized Price
      { wch: 15 }, // Avg SFLA (Type Group)
      { wch: 25 }, // Size Normalized Price
      { wch: 12 }, // Sales Ratio
      { wch: 10 }, // Status
      { wch: 10 }  // Decision
    ];
    ws['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'All Properties');

    // Generate filename with job name and date
    const fileName = `PropertyMasterExport_${jobData?.job_name || 'export'}_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Write file
    XLSX.writeFile(wb, fileName);
  }, [timeNormalizedSales, parseCompositeKey, properties, getTypeUseDisplay, getDesignDisplay, jobData]);

  const runSizeNormalization = useCallback(async () => {
    setIsProcessingSize(true);
    setSizeNormProgress({ current: 0, total: 0, message: 'Preparing size normalization...' });

    try {
      // Create a map of existing size-normalized values
      const existingSizeNorm = {};
      timeNormalizedSales.forEach(sale => {
        if (sale.size_normalized_price) {
          existingSizeNorm[sale.id] = {
            size_normalized_price: sale.size_normalized_price,
            size_adjustment: sale.size_adjustment
          };
        }
      });
      
      // Only use sales that were kept after time normalization review
      const acceptedSales = timeNormalizedSales.filter(s => s.keep_reject === 'keep').map(s => ({
        ...s,
        // Clear old values unless we're preserving them
        size_normalized_price: existingSizeNorm[s.id]?.size_normalized_price || null,
        size_adjustment: existingSizeNorm[s.id]?.size_adjustment || null
      }));
      
      // Group by type/use codes using "starts with" pattern
      const groups = {
        singleFamily: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('1')
        ),
        semiDetached: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('2')
        ),
        townhouses: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('3')
        ),
        multifamily: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('4')
        ),
        conversions: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('5')
        ),
        condominiums: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('6')
        )
      };

      let totalSizeNormalized = 0;
      let totalAdjustment = 0;
      let preservedCount = 0;

      // Process each group
      Object.entries(groups).forEach(([groupName, groupSales]) => {
        if (groupSales.length === 0) return;
        
        setSizeNormProgress({ 
          current: totalSizeNormalized, 
          total: acceptedSales.length, 
          message: `Processing ${groupName} properties...` 
        });
        
        // Calculate average LIVING size for the group
        const totalSize = groupSales.reduce((sum, s) => sum + (s.asset_sfla || 0), 0);
        const avgSize = totalSize / groupSales.length;
        
        // Apply 50% method to each sale
        groupSales.forEach(sale => {
          // Check if we already have a size normalization for this property
          if (existingSizeNorm[sale.id]) {
            preservedCount++;
            totalSizeNormalized++;
            totalAdjustment += Math.abs(existingSizeNorm[sale.id].size_adjustment);
            return; // Skip recalculation, keep existing values
          }
          
          const currentSize = sale.asset_sfla || 0;
          
          // Skip if no living size data
          if (currentSize <= 0) {
            console.warn(`Skipping property ${sale.id} - no living_sf: ${currentSize}`);
            return;
          }
          
          const sizeDiff = avgSize - currentSize;
          const pricePerSf = sale.time_normalized_price / currentSize;
          const adjustment = sizeDiff * pricePerSf * 0.5;
          
          // Check for NaN
          if (isNaN(adjustment)) {
            console.error(`NaN adjustment for property ${sale.id}`);
            return;
          }
          
          sale.size_normalized_price = Math.round(sale.time_normalized_price + adjustment);
          sale.size_adjustment = adjustment;
          
          totalSizeNormalized++;
          totalAdjustment += Math.abs(adjustment);
        });
      });

      // Update stats
      const avgAdjustment = totalSizeNormalized > 0 ? Math.round(totalAdjustment / totalSizeNormalized) : 0;

      // Verify accepted equals normalized (should always match with SFLA > 0 filter)
      if (acceptedSales.length !== totalSizeNormalized) {
        console.warn(`⚠️ Size normalization mismatch: ${acceptedSales.length} accepted but only ${totalSizeNormalized} normalized. Check for properties with 0 SFLA.`);
      }
      
      // Create the new stats object
      const newStats = {
        ...normalizationStats,
        acceptedSales: acceptedSales.length,
        sizeNormalized: totalSizeNormalized,
        singleFamily: groups.singleFamily?.length || 0,
        multifamily: groups.multifamily?.length || 0,
        townhouses: groups.townhouses?.length || 0,
        conversions: groups.conversions?.length || 0,
        avgSizeAdjustment: avgAdjustment
      };

      // Update the state
      setNormalizationStats(newStats);

      // Save the stats to market_land_valuation
      await worksheetService.saveTimeNormalizedSales(jobData.id, timeNormalizedSales, newStats);

      // Save to database
      await saveSizeNormalizedValues(acceptedSales);

      // After size normalization save
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 PreValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }

      // Track the run date
      const runDate = new Date().toISOString();
      setLastSizeNormalizationRun(runDate);

      // Save the date to config
      await worksheetService.saveNormalizationConfig(jobData.id, {
        lastSizeNormalizationRun: runDate
      });
      
      if (false) console.log(`✅ Size normalization complete - preserved ${preservedCount} existing calculations`);
      
      if (preservedCount > 0) {
        alert(`✅ Size Normalization Applied!\n\nProcessed ${totalSizeNormalized} sales (${preservedCount} preserved from previous run)\n\nAverage adjustment: $${Math.round(totalAdjustment / totalSizeNormalized).toLocaleString()}`);
      } else {
        alert(`✅ Size Normalization Applied!\n\nProcessed ${totalSizeNormalized} sales from ${acceptedSales.length} kept time-normalized sales.\n\nAverage adjustment: $${Math.round(totalAdjustment / totalSizeNormalized).toLocaleString()}`);
      }
    } catch (error) {
      console.error('Error during size normalization:', error);
      alert('Error during size normalization. Please check the console.');
    } finally {
      setIsProcessingSize(false);
      setSizeNormProgress({ current: 0, total: 0, message: '' });
    }
  }, [timeNormalizedSales]);

  const processBlockAnalysis = useCallback(async () => {
    setIsProcessingBlocks(true);
    
    try {
      // Get ALL properties first (for complete counts)
      const allPropertiesByBlock = {};
      properties.forEach(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        const block = parsed.block;
        if (!allPropertiesByBlock[block]) {
          allPropertiesByBlock[block] = [];
        }
        allPropertiesByBlock[block].push(prop);
      });
      
      // Get properties with size-normalized values for analysis
      const normalizedProps = properties.filter(p => p.values_norm_size && p.values_norm_size > 0);
      
      // Filter by property type using Type & Use codes
      const filteredProps = normalizedProps.filter(p => {
        const typeUse = p.asset_type_use?.toString().trim();
        if (!typeUse) return false;

        switch (blockTypeFilter) {
          case '1':
            return typeUse.startsWith('1');
          case '2':
            return typeUse.startsWith('2');
          case '3':
            return typeUse.startsWith('3');
          case '4':
            return typeUse.startsWith('4');
          case '5':
            return typeUse.startsWith('5');
          case '6':
            return typeUse.startsWith('6');
          case 'all_residential':
            return ['1','2','3','4','5','6'].some(prefix => typeUse.startsWith(prefix));
          default:
            return true;
        }
      });
      
      // Group by block
      const blockGroups = {};
      filteredProps.forEach(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        const block = parsed.block;
        
        if (!blockGroups[block]) {
          blockGroups[block] = [];
        }
        blockGroups[block].push(prop);
      });
      
      // Calculate metrics for ALL blocks (including those without sales)
      const blockData = Object.entries(allPropertiesByBlock).map(([block, allProps]) => {
        const normalizedPropsInBlock = blockGroups[block] || [];
        
        // If no normalized properties in this block, return gray/no data entry
        if (normalizedPropsInBlock.length === 0) {
          return {
            block,
            propertyCount: allProps.length,  // Total properties in block
            salesCount: allProps.filter(p => p.values_norm_size && p.values_norm_size > 0).length,  // Size normalized sales
            avgNormalizedValue: 0,
            color: bluebeamPalette[0],  // Gray "No Data" color
            ageConsistency: 'N/A',
            sizeConsistency: 'N/A',
            designConsistency: 'N/A',
            noData: true
          };
        }
        
        // Rest of the existing calculation but using normalizedPropsInBlock instead of props
        const props = normalizedPropsInBlock;
        // Average normalized value
        const avgValue = props.reduce((sum, p) => sum + p.values_norm_size, 0) / props.length;
        
        // Age consistency
        const years = props.map(p => p.asset_year_built).filter(y => y);
        const ageRange = years.length > 0 ? Math.max(...years) - Math.min(...years) : 0;
        const avgYear = years.length > 0 ? years.reduce((sum, y) => sum + y, 0) / years.length : 0;
        const ageStdDev = calculateStandardDeviation(years);
        
        let ageConsistency = 'Mixed';
        if (ageRange <= 10) ageConsistency = 'High';
        else if (ageRange <= 25) ageConsistency = 'Medium';
        else if (ageRange <= 50) ageConsistency = 'Low';
        
        // Size consistency
        const sizes = props.map(p => p.asset_sfla || 0).filter(s => s > 0);
        const avgSize = sizes.length > 0 ? sizes.reduce((sum, s) => sum + s, 0) / sizes.length : 0;
        const sizeStdDev = calculateStandardDeviation(sizes);
        const sizeCV = avgSize > 0 ? sizeStdDev / avgSize : 0;
        
        let sizeConsistency = 'Mixed';
        if (sizeCV <= 0.15) sizeConsistency = 'High';
        else if (sizeCV <= 0.30) sizeConsistency = 'Medium';
        else if (sizeCV <= 0.50) sizeConsistency = 'Low';
        
        // Design consistency
        const designs = props.map(p => p.asset_design_style).filter(d => d);
        const uniqueDesigns = [...new Set(designs)].length;
        const dominantDesign = mode(designs);
        const dominantPercent = designs.length > 0 ? 
          (designs.filter(d => d === dominantDesign).length / designs.length) * 100 : 0;
        
        let designConsistency = 'Mixed';
        if (uniqueDesigns <= 2 && dominantPercent >= 75) designConsistency = 'High';
        else if (uniqueDesigns <= 3 && dominantPercent >= 50) designConsistency = 'Medium';
        else if (uniqueDesigns <= 4 && dominantPercent >= 25) designConsistency = 'Low';
        
        // Assign color based on value
        // Index 0 is reserved for "No Data" gray, so actual colors start at index 1
        const colorIndex = Math.min(
          Math.floor((avgValue - colorScaleStart) / colorScaleIncrement) + 1,
          bluebeamPalette.length - 1
        );
        const assignedColor = bluebeamPalette[Math.max(1, colorIndex)];
        
        return {
          block,
          propertyCount: allProps.length,  // Total properties in block (not just normalized)
          salesCount: props.length,  // Count of size normalized properties
          avgNormalizedValue: Math.round(avgValue),
          color: assignedColor,
          ageConsistency,
          ageDetails: {
            range: ageRange,
            avgYear: Math.round(avgYear),
            stdDev: ageStdDev.toFixed(1),
            minYear: Math.min(...years),
            maxYear: Math.max(...years)
          },
          sizeConsistency,
          sizeDetails: {
            avgSize: Math.round(avgSize),
            stdDev: sizeStdDev.toFixed(0),
            cv: (sizeCV * 100).toFixed(1),
            minSize: Math.min(...sizes),
            maxSize: Math.max(...sizes)
          },
          designConsistency,
          designDetails: {
            uniqueDesigns,
            dominantDesign: vendorType === 'Microsystems' && codeDefinitions
              ? interpretCodes.getMicrosystemsValue?.({ asset_design_style: dominantDesign }, codeDefinitions, 'asset_design_style') || dominantDesign
              : dominantDesign,
            dominantPercent: dominantPercent.toFixed(0)
          }
        };
      });
      
      // Sort by block number
      blockData.sort((a, b) => {
        const blockA = parseInt(a.block) || 0;
        const blockB = parseInt(b.block) || 0;
        return blockA - blockB;
      });
      
      setMarketAnalysisData(blockData);
    } catch (error) {
      console.error('Error processing block analysis:', error);
      alert('Error processing block analysis. Please check the console.');
    } finally {
      setIsProcessingBlocks(false);
    }
  }, [properties, blockTypeFilter, colorScaleStart, colorScaleIncrement, codeDefinitions, vendorType]);

// Helper functions
  const calculateStandardDeviation = (values) => {
    if (values.length === 0) return 0;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  };

  // Extract available depth tables from code definitions
  const getAvailableDepthTables = useCallback(() => {
    if (!codeDefinitions) return [];
    
    try {
      if (vendorType === 'BRT') {
        // For BRT, look in Depth section for DATA.VALUE entries
        const depthSection = codeDefinitions.sections?.Depth || {};
        const tables = new Set();
        
        Object.values(depthSection).forEach(item => {
          if (item?.DATA?.VALUE) {
            tables.add(item.DATA.VALUE);
          }
        });
        
        return Array.from(tables).sort();
      } else {
        // For Microsystems, look for codes starting with "200"
        const tables = new Set();
        
        Object.keys(codeDefinitions).forEach(code => {
          if (code.startsWith('200') && code.length >= 7) {
            const tableCode = code.substring(3, 7);
            tables.add(tableCode);
          }
        });
        
        return Array.from(tables).sort();
      }
    } catch (error) {
      console.error('Error extracting depth tables:', error);
      return [];
    }
  }, [codeDefinitions, vendorType]);
  
  const availableDepthTables = getAvailableDepthTables();
  
  const mode = (arr) => {
    if (arr.length === 0) return null;
    const frequency = {};
    let maxFreq = 0;
    let mode = arr[0];
    
    arr.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
      if (frequency[item] > maxFreq) {
        maxFreq = frequency[item];
        mode = item;
      }
    });
    
    return mode;
  };
  
  // Auto-process when filter or scale changes
  useEffect(() => {
    if (isMounted && normalizationStats.sizeNormalized > 0) {
      // processBlockAnalysis is stable (useCallback). Don't include it in deps to avoid recreating this effect when it changes.
      processBlockAnalysis();
    }
  }, [blockTypeFilter, colorScaleStart, colorScaleIncrement, normalizationStats.sizeNormalized, isMounted]);

const handleSalesDecision = (saleId, decision) => {
  // Update local UI state only. Persisting to DB happens in Save All (saveBatchDecisions).
  const updatedSales = timeNormalizedSales.map(sale =>
    sale.id === saleId ? { ...sale, keep_reject: decision } : sale
  );
  setTimeNormalizedSales(updatedSales);

  // Update stats including acceptedSales for the banner display
  const newStats = {
    ...normalizationStats,
    pendingReview: updatedSales.filter(s => s.keep_reject === 'pending').length,
    keptCount: updatedSales.filter(s => s.keep_reject === 'keep').length,
    rejectedCount: updatedSales.filter(s => s.keep_reject === 'reject').length,
    acceptedSales: updatedSales.filter(s => s.keep_reject === 'keep').length
  };
  setNormalizationStats(newStats);

  // Mark there are unsaved changes so user knows to save
  setUnsavedChanges(true);
};
     
  const saveBatchDecisions = async () => {
    const keeps = timeNormalizedSales.filter(s => s.keep_reject === 'keep');
    const rejects = timeNormalizedSales.filter(s => s.keep_reject === 'reject');
    if (false) console.log('🔍 Sample keep values:', keeps.slice(0, 3).map(k => ({
      id: k.id,
      time_normalized_price: k.time_normalized_price,
      has_value: !!k.time_normalized_price
    })));
    if (false) console.log('🔍 Reject count:', rejects.length);

    setIsSavingDecisions(true);
    setSaveProgress({ current: 0, total: keeps.length + rejects.length, message: 'Preparing to save...' });

    try {
      if (false) console.log(`💾 Batch saving ${keeps.length} keeps and ${rejects.length} rejects...`);

      // FIRST: Save all decisions to market_land_valuation for persistence
      await worksheetService.saveTimeNormalizedSales(jobData.id, timeNormalizedSales, normalizationStats);
      if (false) console.log('✅ Saved all decisions to market_land_valuation');

      // SECOND: Batch update keeps in chunks of 500
      if (keeps.length > 0) {
        setSaveProgress({ current: 0, total: keeps.length + rejects.length, message: `Saving ${keeps.length} keeps to property_market_analysis...` });
        if (false) console.log(`📝 Preparing to save ${keeps.length} kept sales to property_market_analysis`);

        for (let i = 0; i < keeps.length; i += 500) {
          const batch = keeps.slice(i, i + 500);

          if (false) console.log(`���� Keep batch ${Math.floor(i/500) + 1}: Saving ${batch.length} properties...`);

          // Use safeUpsert for batch of keeps (includes job_id)
          const keepRecords = batch.map(sale => ({
            job_id: jobData.id,
            property_composite_key: sale.property_composite_key,
            values_norm_time: sale.time_normalized_price
          }));
          const { error: keepError } = await safeUpsertPropertyMarket(keepRecords);
          if (keepError) throw keepError;

          if (false) console.log(`✅ Saved keep batch ${Math.floor(i/500) + 1} of ${Math.ceil(keeps.length/500)}`);
          setSaveProgress({
            current: Math.min(i + 500, keeps.length),
            total: keeps.length + rejects.length,
            message: `Saved ${Math.min(i + 500, keeps.length)} keeps...`
          });
        }
      }

      // THIRD: Batch clear rejects in chunks of 500 - EXPLICITLY clear both norm values
      if (rejects.length > 0) {
        setSaveProgress({
          current: keeps.length,
          total: keeps.length + rejects.length,
          message: `Clearing ${rejects.length} rejects from property_market_analysis...`
        });
        if (false) console.log(`📝 Preparing to clear ${rejects.length} rejected sales from property_market_analysis`);

        for (let i = 0; i < rejects.length; i += 500) {
          const batch = rejects.slice(i, i + 500);
          const rejectCompositeKeys = batch.map(s => s.property_composite_key);

          if (false) console.log(`�����️ Reject batch ${Math.floor(i/500) + 1}: Clearing ${batch.length} properties...`);

          // CRITICAL: Clear BOTH time and size normalized values for rejected sales
          await supabase
            .from('property_market_analysis')
            .update({
              values_norm_time: null,
              values_norm_size: null
            })
            .in('property_composite_key', rejectCompositeKeys);

          if (false) console.log(`✅ Cleared reject batch ${Math.floor(i/500) + 1} of ${Math.ceil(rejects.length/500)}`);
          setSaveProgress({
            current: keeps.length + Math.min(i + 500, rejects.length),
            total: keeps.length + rejects.length,
            message: `Cleared ${Math.min(i + 500, rejects.length)} rejects...`
          });
        }
      }

      // FOURTH: Clear cache to prevent stale data issues
      if (onUpdateJobCache && jobData?.id) {
        if (false) console.log('����️ Clearing cache after batch save to prevent stale data');
        callRefresh(null);
      }

      if (false) console.log(`��� Batch save complete: ${keeps.length} keeps saved, ${rejects.length} rejects cleared`);
      alert(`✅ Successfully saved ${keeps.length} keeps and cleared ${rejects.length} rejects from database`);

    } catch (error) {
      console.error('❌ Error saving batch decisions:', error);
      alert('Error saving decisions. Please check the console and try again.');
    } finally {
      setIsSavingDecisions(false);
      setSaveProgress({ current: 0, total: 0, message: '' });
    }
  };

  // ==================== WORKSHEET FUNCTIONS ====================
  
  const updateWorksheetStats = useCallback((props) => {
    const stats = {
      totalProperties: props.length,
      vcsAssigned: props.filter(p => p.new_vcs).length,
      zoningEntered: props.filter(p => p.asset_zoning).length,
      locationAnalysis: props.filter(p => p.location_analysis).length,
      readyToProcess: readyProperties.size
    };
    setWorksheetStats(stats);
  }, [readyProperties]);

  const checkLocationStandardization = useCallback((value, propertyKey) => {
    const valueLower = value.toLowerCase().trim();

    // Check for similar existing values
    for (const [standard, variations] of Object.entries(locationVariations)) {
      if (variations.includes(valueLower) || standard.toLowerCase() === valueLower) {
        return;
      }

      // Check for common variations
      const patterns = [
        ['avenue', 'ave', 'av'],
        ['street', 'st'],
        ['road', 'rd'],
        ['drive', 'dr'],
        ['railroad', 'rr', 'rail road', 'railraod']
      ];

      for (const pattern of patterns) {
        if (pattern.some(p => valueLower.includes(p)) &&
            pattern.some(p => standard.toLowerCase().includes(p))) {
          setCurrentLocationChoice({
            propertyKey,
            newValue: value,
            existingStandard: standard,
            variations: locationVariations[standard] || []
          });
          setShowLocationModal(true);
          return;
        }
      }
    }

    // Add as new standard if no match found
    setLocationVariations(prev => ({
      ...prev,
      [value]: []
    }));
  }, [locationVariations]);

  const handleLocationStandardChoice = useCallback((choice) => {
    if (!currentLocationChoice) return;

    if (choice === 'existing') {
      handleWorksheetChange(
        currentLocationChoice.propertyKey,
        'location_analysis',
        currentLocationChoice.existingStandard
      );

      setLocationVariations(prev => ({
        ...prev,
        [currentLocationChoice.existingStandard]: [
          ...(prev[currentLocationChoice.existingStandard] || []),
          currentLocationChoice.newValue
        ]
      }));
    } else {
      setLocationVariations(prev => ({
        ...prev,
        [currentLocationChoice.newValue]: []
      }));
    }

    setShowLocationModal(false);
    setCurrentLocationChoice(null);
  }, [currentLocationChoice]);

  const handleWorksheetChange = useCallback((propertyKey, field, value) => {
    // Location standardization disabled - was interrupting typing
    // if (field === 'location_analysis' && value) {
    //   checkLocationStandardization(value, propertyKey);
    // }

    // Mark this row as being edited so it won't disappear while user types
    // Update the ref immediately for synchronous checks and then mirror into state
    try {
      const refSet = new Set(editingRowsRef.current);
      refSet.add(propertyKey);
      editingRowsRef.current = refSet;
      // Mirror into state to trigger updates where needed
      setEditingRows(new Set(refSet));

      // clear previous timer
      const timers = editTimersRef.current;
      const prevTimer = timers.get(propertyKey);
      if (prevTimer) clearTimeout(prevTimer);

      // set new timer to remove editing mark after 8 seconds of inactivity
      const t = setTimeout(() => {
        editTimersRef.current.delete(propertyKey);
        // update ref and state
        const refAfter = new Set(editingRowsRef.current);
        refAfter.delete(propertyKey);
        editingRowsRef.current = refAfter;
        setEditingRows(new Set(refAfter));
      }, 8000);
      timers.set(propertyKey, t);
    } catch (e) {
      // Fallback to original behavior on failure
      const next = new Set(editingRows);
      next.add(propertyKey);
      setEditingRows(next);
    }

    // Update using functional state update to avoid depending on worksheetProperties
    setWorksheetProperties(prev => {
      const updated = prev.map(prop =>
        prop.property_composite_key === propertyKey
          ? {
              ...prop,
              [field]: field === 'new_vcs' || field === 'asset_zoning' ? value.toUpperCase() : value
            }
          : prop
      );
      // Don't directly update filteredWorksheetProps - let the useEffect handle filtering
      // This was causing the page to reset on every keystroke
      updateWorksheetStats(updated);
      return updated;
    });

    setUnsavedChanges(true);

    // Auto-save disabled - field values only save when clicking Process
    // Auto-save timer was only saving stats, not field values
    // setAutoSaveTimer(prevTimer => {
    //   if (prevTimer) clearTimeout(prevTimer);
    //   return setTimeout(() => { autoSaveWorksheet(); }, 30000);
    // });
  }, [updateWorksheetStats]);

  const autoSaveWorksheet = useCallback(async () => {
    try {
      await worksheetService.saveWorksheetStats(jobData.id, {
        last_saved: new Date().toISOString(),
        entries_completed: worksheetStats.vcsAssigned,
        ready_to_process: worksheetStats.readyToProcess,
        location_variations: locationVariations
      });

      // NOTE: intentionally NOT calling callRefresh here to avoid triggering job-wide refresh during edits/auto-save
      // Clear cache only when user explicitly requests a refresh

      setLastAutoSave(new Date());
      setUnsavedChanges(false);
      if (false) console.log('✅ Auto-saved worksheet progress');
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [jobData?.id, worksheetStats, locationVariations]);

const processSelectedProperties = async () => {
    const toProcess = worksheetProperties.filter(p =>
      readyProperties.has(p.property_composite_key)
    );

    if (toProcess.length === 0) {
      alert('Please select properties to process by checking the "Ready" checkbox');
      return;
    }

    // Pause any automatic refreshes while processing to avoid parent reloads
    setPauseAutoRefresh(true);
    processingRef.current = true;

    setIsProcessingProperties(true);
    setProcessProgress({ current: 0, total: toProcess.length, message: 'Preparing to process properties...' });

    try {
      // Process in batches of 500
      const batchSize = 500;
      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);

        setProcessProgress({
          current: i,
          total: toProcess.length,
          message: `Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(toProcess.length/batchSize)}...`
        });

        // Build update array for batch upsert to property_market_analysis table
        const updates = batch.map(prop => ({
          job_id: jobData.id,
          property_composite_key: prop.property_composite_key,
          new_vcs: prop.new_vcs === '' ? null : prop.new_vcs,
          location_analysis: prop.location_analysis === '' ? null : prop.location_analysis,
          asset_zoning: prop.asset_zoning === '' ? null : prop.asset_zoning,
          asset_map_page: prop.asset_map_page === '' ? null : prop.asset_map_page,
          asset_key_page: prop.asset_key_page === '' ? null : prop.asset_key_page
        }));

        // Use safe upsert for batch processing
        const { error } = await safeUpsertPropertyMarket(updates);
        if (error) throw error;

        // Intentionally not clearing parent cache here to avoid interrupting user workflow; refresh manually when needed
      }

      setProcessProgress({
        current: toProcess.length,
        total: toProcess.length,
        message: 'Processing complete!'
      });

      setTimeout(() => {
        alert(`✅ Successfully processed ${toProcess.length} properties`);
        setReadyProperties(new Set());
        updateWorksheetStats(worksheetProperties);
        setIsProcessingProperties(false);
        setProcessProgress({ current: 0, total: 0, message: '' });
      }, 500);

    } catch (error) {
      console.error('Error processing properties:', error);
      alert('Error processing properties. Please try again.');
      setIsProcessingProperties(false);
      setProcessProgress({ current: 0, total: 0, message: '' });
    } finally {
      // Restore auto-refresh state after processing completes
      processingRef.current = false;
      setPauseAutoRefresh(false);
    }
  };

  const copyCurrentVCS = (propertyKey, currentVCS) => {
    handleWorksheetChange(propertyKey, 'new_vcs', currentVCS);
  };

  const handleSort = (field) => {
    const direction = sortConfig.field === field && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ field, direction });

    const sorted = [...filteredWorksheetProps].sort((a, b) => {
      let aVal, bVal;

      // Handle numeric fields
      if (field === 'block') {
        aVal = parseFloat(a.block) || 0;
        bVal = parseFloat(b.block) || 0;
      } else if (field === 'lot') {
        aVal = parseFloat(a.lot) || 0;
        bVal = parseFloat(b.lot) || 0;
      } else if (field === 'qual') {
        aVal = parseInt(a.qual) || 0;
        bVal = parseInt(b.qual) || 0;
      } else {
        aVal = a[field];
        bVal = b[field];
      }

      if (direction === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    setFilteredWorksheetProps(sorted);
  };
  const handleNormalizationSort = (field) => {
    const direction = normSortConfig.field === field && normSortConfig.direction === 'asc' ? 'desc' : 'asc';
    setNormSortConfig({ field, direction });
    
    const sorted = [...timeNormalizedSales].sort((a, b) => {
      let aVal, bVal;
      
      // Handle composite key parsing for block/lot
      if (field === 'block' || field === 'lot') {
        const aParsed = parseCompositeKey(a.property_composite_key);
        const bParsed = parseCompositeKey(b.property_composite_key);
        aVal = field === 'block' ? parseInt(aParsed.block) || 0 : parseFloat(aParsed.lot) || 0;
        bVal = field === 'block' ? parseInt(bParsed.block) || 0 : parseFloat(bParsed.lot) || 0;
      } else {
        aVal = a[field];
        bVal = b[field];
      }
      
      if (direction === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    setTimeNormalizedSales(sorted);
  };

  // ==================== IMPORT/EXPORT FUNCTIONS ====================
  
  const exportWorksheetToExcel = () => {
    // Export to Excel with formatting
    const headers = [
      'Block',
      'Lot',
      'Qualifier',
      'Card',
      'Property Location',
      'Class',
      'Current VCS',
      'Building',
      'Type/Use',
      'Design',
      'New VCS',
      'Location Analysis',
      'Zoning',
      'Map Page',
      'Key Page',
      'Notes',
      'Ready'
    ];

    const data = filteredWorksheetProps.map(prop => [
      prop.block || '',
      prop.lot || '',  // Will be formatted as text to preserve trailing zeros
      prop.qualifier || '',
      prop.card || '',
      prop.property_location || '',
      prop.property_class || '',
      prop.property_vcs || '',
      prop.building_class_display || '',
      prop.type_use_display || '',
      prop.design_display || '',
      prop.new_vcs || '',
      prop.location_analysis || '',
      prop.asset_zoning || '',
      prop.asset_map_page || '',
      prop.asset_key_page || '',
      prop.worksheet_notes || '',
      readyProperties.has(prop.property_composite_key) ? 'Yes' : 'No'
    ]);

    // Create worksheet from array of arrays
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

    // Base style for all cells
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Header style (bold, no fill)
    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply formatting to all cells
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // Apply header style to first row
        if (R === 0) {
          ws[cellAddress].s = headerStyle;
        } else {
          ws[cellAddress].s = { ...baseStyle };

          // Column B (Lot) - format as text to preserve trailing zeros like .10
          if (C === 1) {
            ws[cellAddress].t = 's';  // Force text type
            ws[cellAddress].z = '@';   // Text format
          }
        }
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // Block
      { wch: 10 },  // Lot
      { wch: 12 },  // Qualifier
      { wch: 8 },   // Card
      { wch: 30 },  // Property Location
      { wch: 10 },  // Class
      { wch: 12 },  // Current VCS
      { wch: 15 },  // Building
      { wch: 15 },  // Type/Use
      { wch: 15 },  // Design
      { wch: 12 },  // New VCS
      { wch: 25 },  // Location Analysis
      { wch: 10 },  // Zoning
      { wch: 10 },  // Map Page
      { wch: 10 },  // Key Page
      { wch: 30 },  // Notes
      { wch: 8 }    // Ready
    ];

    // Create workbook and export
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Property Worksheet');
    XLSX.writeFile(wb, `PropertyWorksheet_${jobData?.job_name || 'export'}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

const analyzeImportFile = async (file) => {
    setIsAnalyzingImport(true);
    setImportFile(file);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { cellText: true, cellDates: false });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      // Convert to JSON preserving cell text (prevents Excel from converting .10 to .1)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

      // Clean up column names (trim whitespace on header names)
      const cleanedData = jsonData.map(row => {
        const cleanRow = {};
        Object.keys(row).forEach(key => {
          const cleanKey = key && typeof key === 'string' ? key.trim() : key;
          cleanRow[cleanKey] = row[key];
        });
        return cleanRow;
      });

      // Use cleanedData for analysis
      const dataForAnalysis = cleanedData;

      // Analysis results
      const analysis = {
        fileName: file.name,
        totalRows: dataForAnalysis.length,
        matched: [],
        unmatched: [],
        fuzzyMatched: []
      };

      // Process each row from Excel
      for (const row of dataForAnalysis) {
        // Build composite key from Excel data - vendor aware
        const year = row.Year || row.YEAR || new Date().getFullYear();
        const ccdd = row.Ccdd || row.CCDD || jobData?.ccdd || '';
        const block = (row.Block || row.BLOCK)?.toString() || '';
        const lot = (row.Lot || row.LOT || row.lot || '')?.toString().trim();
        console.log('Lot value from row:', row.Lot, 'Final lot:', lot);
        console.log('Full row data:', row);

        // Handle qualifier - both vendors
        let qual = (row.Qual || row.Qualifier || row.QUALIFIER)?.toString().trim() || '';
        qual = qual || 'NONE';
        
        // Handle card/bldg based on vendor
        let card;
        if (vendorType === 'Microsystems') {
          card = (row.Bldg || row.BLDG)?.toString().trim() || 'NONE';
        } else { // BRT
          card = (row.Card || row.CARD)?.toString().trim() || 'NONE';
        }
        
        // Handle location field - check for the actual property location first
        let location;
        if (vendorType === 'Microsystems') {
          // Prefer explicit Property Location if present (this is the address field). Fallback to Location if not.
          location = row['Property Location']?.toString() || row.PROPERTY_LOCATION?.toString() || row.Address?.toString() || row.Location?.toString() || '';
          // If location seems empty or is the analysis field, try other patterns
          if (!location || location.toLowerCase().includes('analysis')) {
            location = row['Property Location']?.toString() || row.Address?.toString() || 'NONE';
          }
        } else { // BRT
          location = row['Property Location']?.toString() || row.PROPERTY_LOCATION?.toString() || row.Address?.toString() || row.Location?.toString() || 'NONE';
        }

        // If address components were split across columns (e.g. number in Location and street in Location Analysis),
        // join them into a single address when it looks like Location only contains a street number.
        try {
          const locationAnalysis = row['Location Analysis'] || row['LocationAnalysis'] || row['Loc Analysis'] || row['Location_Analysis'] || '';
          const isNumericOnly = /^[0-9]+(\.[0-9]+)?$/.test(String(location));
          const isShort = String(location).length <= 6;
          if ((isNumericOnly || isShort) && locationAnalysis && !String(locationAnalysis).toLowerCase().includes('analysis')) {
            // Preserve original spacing and punctuation from locationAnalysis but remove leading/trailing whitespace
            location = (String(location) + ' ' + String(locationAnalysis)).trim();
          }
        } catch (e) {
          // ignore
        }
        
        const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual}-${card}-${location}`;

        // Debugging: log row data and built composite key, and sample worksheet keys
        try {
          console.log('Import row data:', { year, ccdd, block, lot, qual, card, location });
          console.log('Built composite key:', compositeKey);
          const sampleWorksheetKeys = (worksheetProperties || []).slice(0,5).map(p => p.property_composite_key);
          console.log('Sample worksheet keys:', sampleWorksheetKeys);
        } catch (e) {
          // ignore console errors in prod
        }

        // Debug for specific blocks
        if (parseInt(block) >= 7 && parseInt(block) <= 10) {
          if (false) console.log(`���� Import row ${block}-${lot}: compositeKey = ${compositeKey}`);
        }

        // Find matching property in worksheet (exact match on composite key)
        const match = worksheetProperties.find(p => p.property_composite_key === compositeKey);

        if (match) {
          analysis.matched.push({
            compositeKey,
            excelData: row,
            currentData: {
              ...match,
              id: match.id
            },
            updates: {
              new_vcs: row['New VCS'] || '',
              location_analysis: row['Location Analysis'] || row['Loc Analysis'] || '',
              asset_zoning: row['Zone'] || row['Zoning'] || '',
              asset_map_page: row['Map Page'] || '',
              asset_key_page: row['Key'] || row['Key Page'] || ''
            }
          });
        } else {
          // Debug unmatched
          if (parseInt(block) >= 7 && parseInt(block) <= 10) {
            if (false) console.log(`❌ No match found for: ${compositeKey}`);
            // Find close matches for debugging
            const closeMatches = worksheetProperties.filter(p => 
              p.property_composite_key.includes(`-${block}-${lot}`)
            );
            if (closeMatches.length > 0) {
              if (false) console.log(`   Close matches:`, closeMatches.map(p => p.property_composite_key));
            }
          }
          
          // Try fuzzy match on address if enabled
          if (importOptions.useAddressFuzzyMatch && location && location !== 'NONE') {
            const fuzzyMatch = worksheetProperties.find(p => {
              if (!p.property_location) return false;
              const similarity = calculateSimilarity(
                p.property_location.toLowerCase(),
                location.toLowerCase()
              );
              return similarity >= importOptions.fuzzyMatchThreshold;
            });
            
            if (fuzzyMatch) {
              analysis.fuzzyMatched.push({
                compositeKey,
                excelData: row,
                currentData: {
                  ...fuzzyMatch,
                  id: fuzzyMatch.id
                },
                updates: {
                  new_vcs: row['New VCS'] || '',
                  location_analysis: row['Location Analysis'] || row['Loc Analysis'] || '',
                  asset_zoning: row['Zone'] || row['Zoning'] || '',
                  asset_map_page: row['Map Page'] || '',
                  asset_key_page: row['Key'] || row['Key Page'] || ''
                }
              });
            } else {
              analysis.unmatched.push({
                compositeKey,
                excelData: row
              });
            }
          } else {
            analysis.unmatched.push({
              compositeKey,
              excelData: row
            });
          }
        }
      }
      
      setImportPreview(analysis);
      setShowImportModal(true);
      if (false) console.log(`Import analysis complete: ${analysis.matched.length} exact, ${analysis.fuzzyMatched.length} fuzzy, ${analysis.unmatched.length} unmatched`);
    } catch (error) {
      console.error('Error analyzing import file:', error);
      alert('Error analyzing file. Please check the format.');
    } finally {
      setIsAnalyzingImport(false);
    }
  };

  // Run diagnostic on pasted CSV text (client-side) to show exact/fuzzy/unmatched counts
  const runImportDiagnostic = async (csvText) => {
    setIsRunningDiagnostic(true);
    try {
      if (!csvText || !csvText.trim()) return alert('Paste CSV text first');
      // Parse CSV lines with quoted fields support
      const rows = csvText.trim().split(/\r?\n/).map(line => line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(c => c.replace(/^\"|\"$/g, '').trim()));
      const headers = rows.shift().map(h => h.trim());
      const data = rows.map(r => Object.fromEntries(r.map((v,i) => [(headers[i]||`col${i}`), v])));

      const propKeys = worksheetProperties.map(p => p.property_composite_key);

      const levenshtein = (a,b) => { const m=[]; for(let i=0;i<=b.length;i++){m[i]=[i];} for(let j=0;j<=a.length;j++){m[0][j]=j;} for(let i=1;i<=b.length;i++){ for(let j=1;j<=a.length;j++){ m[i][j]=b[i-1]===a[j-1]?m[i-1][j-1]:Math.min(m[i-1][j-1]+1,m[i][j-1]+1,m[i-1][j]+1); } } return m[b.length][a.length]; };

      const matched = [], fuzzy = [], unmatched = [];

      const getVal = (row, keys) => { for (const k of keys) { if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return row[k]; } return ''; };

      for (const row of data) {
        const year = getVal(row, ['Year','YEAR','year']) || new Date().getFullYear();
        const ccdd = getVal(row, ['CCDD','Ccdd','Ccdd','ccdd']) || jobData?.ccdd || '';
        const block = String(getVal(row, ['Block','BLOCK','block'])).trim();
        const lot = String(getVal(row, ['Lot','LOT','lot'])).trim();
        let qual = String(getVal(row, ['Qualifier','Qual','QUALIFIER','QUAL'])).trim(); if (!qual) qual = 'NONE';
        const card = String(getVal(row, ['Card','CARD','card','Bldg','BLDG'])).trim() || 'NONE';
        let location = String(getVal(row, ['PROPERTY_LOCATION','Property Location','Location','Address'])) || 'NONE';
        try {
          const locationAnalysis = getVal(row, ['Location Analysis','LocationAnalysis','Loc Analysis','Location_Analysis']) || '';
          const isNumericOnly = /^[0-9]+(\.[0-9]+)?$/.test(String(location));
          const isShort = String(location).length <= 6;
          if ((isNumericOnly || isShort) && locationAnalysis && !String(locationAnalysis).toLowerCase().includes('analysis')) {
            location = (String(location) + ' ' + String(locationAnalysis)).trim();
          }
        } catch (e) {
          // ignore
        }

        const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual}-${card}-${location}`;
        const exactMatch = worksheetProperties.find(p => p.property_composite_key === compositeKey);
        if (exactMatch) {
          matched.push({ compositeKey, row, id: exactMatch.id });
          continue;
        }

        // find closest property key
        let best = { key: null, d: Infinity };
        for (const pk of propKeys) {
          const d = levenshtein(pk, compositeKey);
          if (d < best.d) best = { key: pk, d };
        }
        const sim = 1 - best.d / Math.max(best.key?.length || 1, compositeKey.length || 1);
        if (sim >= (importOptions?.fuzzyMatchThreshold || 0.8)) {
          fuzzy.push({ compositeKey, row, closest: best.key, sim: Number(sim.toFixed(3)) });
        } else {
          unmatched.push({ compositeKey, row, closest: best.key, dist: best.d });
        }
      }

      setDiagnosticResults({ total: data.length, matched, fuzzy, unmatched });

    } catch (e) {
      console.error('Diagnostic error:', e);
      alert('Diagnostic failed, see console');
    } finally {
      setIsRunningDiagnostic(false);
    }
  };
  
  // Helper function for fuzzy matching
  const calculateSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  };
  
  const levenshteinDistance = (str1, str2) => {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  };
  // ==================== SEARCH AND FILTER ====================

  // Track previous search/filter to only reset page when they change
  const prevSearchRef = useRef(worksheetSearchTerm);
  const prevFilterRef = useRef(worksheetFilter);

  useEffect(() => {
    let filtered = [...worksheetProperties];

    if (worksheetSearchTerm) {
      const searchLower = worksheetSearchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.property_location?.toLowerCase().includes(searchLower) ||
        p.property_composite_key?.toLowerCase().includes(searchLower) ||
        p.block?.includes(worksheetSearchTerm) ||
        p.lot?.includes(worksheetSearchTerm)
      );
    }

    switch (worksheetFilter) {
      case 'missing-vcs':
        filtered = filtered.filter(p => !p.new_vcs || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
      case 'missing-location':
        filtered = filtered.filter(p => !p.location_analysis || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
      case 'missing-zoning':
        filtered = filtered.filter(p => !p.asset_zoning || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
      case 'ready':
        filtered = filtered.filter(p => readyProperties.has(p.property_composite_key) || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
      case 'completed':
        filtered = filtered.filter(p => (p.new_vcs && p.asset_zoning) || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
      case 'not-ready':
        filtered = filtered.filter(p => !readyProperties.has(p.property_composite_key) || (editingRowsRef.current && editingRowsRef.current.has(p.property_composite_key) ) );
        break;
    }

    setFilteredWorksheetProps(filtered);

    // Only reset to page 1 when search or filter actually changes (not when data updates)
    if (prevSearchRef.current !== worksheetSearchTerm || prevFilterRef.current !== worksheetFilter) {
      setCurrentPage(1);
      prevSearchRef.current = worksheetSearchTerm;
      prevFilterRef.current = worksheetFilter;
    }
  }, [worksheetSearchTerm, worksheetFilter, worksheetProperties, readyProperties, editingRows]);

  // ==================== PAGINATION ====================
  
  const paginatedProperties = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredWorksheetProps.slice(startIndex, endIndex);
  }, [filteredWorksheetProps, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredWorksheetProps.length / itemsPerPage);

  // ==================== RENDER ====================
  
  return (
    <div className="w-full">
      {/* Sub-tab Navigation */}
  <div className="mls-subtab-nav">
    <button
      onClick={() => setActiveSubTab('normalization')}
      className={`mls-subtab-btn ${activeSubTab === 'normalization' ? 'mls-subtab-btn--active' : ''}`}
    >
      Normalization
    </button>
    <button
      onClick={() => setActiveSubTab('marketAnalysis')}
      disabled={!normalizationStats.sizeNormalized || normalizationStats.sizeNormalized === 0}
      className={`mls-subtab-btn ${activeSubTab === 'marketAnalysis' ? 'mls-subtab-btn--active' : ''} ${!normalizationStats.sizeNormalized ? 'disabled' : ''}`}
    >
      Market Analysis
    </button>
    <button
      onClick={() => setActiveSubTab('unitRates')}
      disabled={vendorType !== 'BRT'}
      title={vendorType !== 'BRT' ? 'Unit Rate Configuration is only available for BRT jobs' : ''}
      className={`mls-subtab-btn ${activeSubTab === 'unitRates' ? 'mls-subtab-btn--active' : ''} ${vendorType !== 'BRT' ? 'disabled' : ''}`}
    >
      Unit Rate Configuration
    </button>
    <button
      onClick={() => setActiveSubTab('worksheet')}
      className={`mls-subtab-btn ${activeSubTab === 'worksheet' ? 'mls-subtab-btn--active' : ''}`}
    >
      Page by Page Worksheet
    </button>
    <button
      onClick={() => setActiveSubTab('zoning')}
      className={`mls-subtab-btn ${activeSubTab === 'zoning' ? 'mls-subtab-btn--active' : ''}`}
    >
      Zoning Requirements
    </button>
  </div>

      {/* Normalization Tab Content */}
      {activeSubTab === 'normalization' && (
        <div className="w-full">
          <div className="space-y-6 px-2">

          {/* Sales Changes Warning Banner */}
          {recentSalesChanges && (
            <div className="bg-orange-50 border-l-4 border-orange-400 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="text-orange-600 mt-0.5 flex-shrink-0" size={24} />
                <div className="flex-1">
                  <h4 className="text-orange-900 font-semibold text-base mb-1">
                    ⚠️ {recentSalesChanges.count} Sale Change{recentSalesChanges.count !== 1 ? 's' : ''} Detected
                  </h4>
                  <p className="text-orange-800 text-sm mb-2">
                    New sales data from file upload on {new Date(recentSalesChanges.reportDate).toLocaleDateString()} needs to be normalized.
                    These sales will not appear in the normalization list or be included in HPI calculations until you run Time Normalization.
                  </p>
                  <p className="text-orange-900 text-sm font-medium">
                    👉 Click "Run Time Normalization" below to process these changes and mark them as pending review.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Normalization Configuration</h3>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={pauseAutoRefresh} onChange={(e) => setPauseAutoRefresh(e.target.checked)} className="form-checkbox" />
                  <span className="text-gray-600">Pause Auto-Refresh</span>
                </label>
                {hpiLoaded && (
                  <span className="text-green-600 text-sm">✓ HPI Data Loaded</span>
                )}
                {lastTimeNormalizationRun && (
                  <span className="text-gray-500 text-sm">
                    Last run: {new Date(lastTimeNormalizationRun).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={() => {
                    const eqRatio = parseFloat(equalizationRatio);
                    const outThreshold = parseFloat(outlierThreshold);
                    if (!eqRatio || !outThreshold) {
                      alert('Please enter valid Equalization Ratio and Outlier Threshold before running normalization');
                      return;
                    }
                    runTimeNormalization();
                  }}
                  disabled={isProcessingTime || !hpiLoaded || !hpiData || hpiData.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >      
                  {isProcessingTime ? (
                    <>
                      <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                      Processing...
                    </>
                  ) : (
                    'Run Time Normalization'
                  )}
                </button>
              </div>
            </div>

            {(!hpiData || hpiData.length === 0) && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="text-red-600 mt-0.5" size={20} />
                <div>
                  <p className="text-sm font-medium text-red-800">HPI Data Not Available</p>
                  <p className="text-xs text-red-600 mt-1">
                    Time normalization cannot run without House Price Index data for {selectedCounty} County.
                    Please ensure HPI data is loaded in the database.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Normalize To Year
                </label>
                <input
                  type="number"
                  value={normalizeToYear}
                  onChange={(e) => setNormalizeToYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Current market year for normalization</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sales From Year
                </label>
                <input
                  type="number"
                  value={salesFromYear}
                  onChange={(e) => setSalesFromYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Include sales from this year forward</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  County
                </label>
                <select
                  value={selectedCounty}
                  onChange={(e) => setSelectedCounty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={availableCounties.length === 0}
                >
                  {availableCounties.length === 0 ? (
                    <option value="">Loading counties...</option>
                  ) : (
                    availableCounties.map(county => (
                      <option key={county} value={county}>{county}</option>
                    ))
                  )}
                </select>
                <p className="text-xs text-gray-500 mt-1">County for HPI data lookup</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Equalization Ratio (%)
                </label>
                <input
                  type="number"
                  value={equalizationRatio}
                  onChange={(e) => setEqualizationRatio(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  step="0.01"
                  placeholder="e.g., 95.5"
                />
                <p className="text-xs text-gray-500 mt-1">Target ratio for the market (typically 85-115%)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Outlier Threshold (%)
                </label>
                <input
                  type="number"
                  value={outlierThreshold}
                  onChange={(e) => setOutlierThreshold(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  placeholder="e.g., 15"
                />
                <p className="text-xs text-gray-500 mt-1">Flag sales outside this % of equalization ratio</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Min Sale Price
                </label>
                <input
                  type="number"
                  value={minSalePrice}
                  onChange={(e) => setMinSalePrice(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Exclude non-arm's length sales</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-gray-50 rounded">
              <p className="text-sm font-medium mb-2">Formulas:</p>
              <p className="text-xs text-gray-600">
                <strong>Time Normalization:</strong> Sale Price × (Current Year HPI ÷ Sale Year HPI)
              </p>
              <p className="text-xs text-gray-600 mt-1">
                <strong>Size Normalization (50% Method):</strong> (((Group Avg Size - Sale Size) × ((Sale Price ÷ Sale Size) × 0.50)) + Sale Price)
              </p>
            </div>
          </div>

          {/* Time Normalization Statistics */}
          {timeNormalizedSales.length > 0 && (
            <>
              {/* Sale Data Changes Warning */}
              {(() => {
                const salesDataChangedCount = timeNormalizedSales.filter(s => s.sale_data_changed).length;
                if (salesDataChangedCount > 0) {
                  return (
                    <div className="mb-4 p-4 bg-amber-50 border-l-4 border-amber-500 rounded-lg flex items-start gap-3">
                      <AlertCircle className="text-amber-600 mt-0.5 flex-shrink-0" size={24} />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-amber-900 mb-1">
                          ⚠️ Sale Data Updates Detected
                        </p>
                        <p className="text-sm text-amber-800">
                          <strong>{salesDataChangedCount}</strong> {salesDataChangedCount === 1 ? 'property has' : 'properties have'} updated sale data from the latest file upload.
                          {salesDataChangedCount === 1 ? ' Its' : ' Their'} Keep/Reject decision{salesDataChangedCount === 1 ? ' has' : 's have'} been automatically reset to <strong>"Pending Review"</strong>.
                        </p>
                        <p className="text-xs text-amber-700 mt-2">
                          💡 Please review {salesDataChangedCount === 1 ? 'this property' : 'these properties'} in the table below and update {salesDataChangedCount === 1 ? 'its' : 'their'} decision{salesDataChangedCount === 1 ? '' : 's'} as needed.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Time Normalization Statistics (County HPI Based)</h3>
                <div className="grid grid-cols-6 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{normalizationStats.totalSales}</div>
                    <div className="text-sm text-gray-600">Potential Sales</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{timeNormalizedSales.filter(s => s.keep_reject === 'keep').length}</div>
                    <div className="text-sm text-gray-600">Kept/Normalized</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{normalizationStats.flaggedOutliers}</div>
                    <div className="text-sm text-gray-600">Flagged as Outliers</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{normalizationStats.pendingReview}</div>
                    <div className="text-sm text-gray-600">Pending Review</div>
                  </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-700">
                    {(() => {
                      const currentYear = new Date().getFullYear();
                      const currentYearSales = properties.filter(p => {
                        if (!p.sales_price || p.sales_price <= minSalePrice) return false;
                        if (!p.sales_date) return false;
                        
                        const saleYear = new Date(p.sales_date).getFullYear();
                        if (saleYear !== currentYear) return false;
                        
                        // Check sales_nu conditions (empty, null, 00, 7, or 07 are valid)
                        const nu = p.sales_nu?.toString().trim();
                        const validNU = !nu || nu === '' || nu === '00' || nu === '7' || nu === '07';
                        if (!validNU) return false;
                        
                        // Same filters as normalization
                        const parsed = parseCompositeKey(p.property_composite_key);
                        const card = parsed.card?.toUpperCase();
                        
                        // Card filter based on vendor
                        if (vendorType === 'Microsystems') {
                          if (card !== 'M') return false;
                        } else {
                          if (card !== '1') return false;
                        }
                        
                        const buildingClass = p.asset_building_class?.toString().trim();
                        const typeUse = p.asset_type_use?.toString().trim();
                        const designStyle = p.asset_design_style?.toString().trim();
                        
                        if (!buildingClass || parseInt(buildingClass) <= 10) return false;
                        if (!typeUse) return false;
                        if (!designStyle) return false;
                        
                        return true;
                      });
                      
                      const totalRatio = currentYearSales.reduce((sum, p) => {
                        const ratio = p.values_mod_total ? (p.values_mod_total / p.sales_price) : 0;
                        return sum + ratio;
                      }, 0);
                      
                      const avgRatio = currentYearSales.length > 0 ? totalRatio / currentYearSales.length : 0;
                      return `${(avgRatio * 100).toFixed(2)}%`;
                    })()}
                  </div>
                  <div className="text-sm text-gray-500">True Ratio</div>
                </div>
                </div>
              </div>

              {/* Sales Review Table */}
              <div className="bg-white rounded-lg shadow p-6">
                <div 
                  className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 p-2 rounded"
                  onClick={() => setIsResultsCollapsed(!isResultsCollapsed)}
                >
                  <h3 className="text-lg font-semibold">Sales Review ({timeNormalizedSales.length} sales)</h3>
                  <div className="flex gap-2 items-center">
                    {isResultsCollapsed ? (
                      <ChevronDown size={20} className="text-gray-500" />
                    ) : (
                      <ChevronUp size={20} className="text-gray-500" />
                    )}
                  </div>
                </div>

                {/* Only show table content if not collapsed */}
                {!isResultsCollapsed && (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex gap-2 flex-wrap">
                        <select
                          value={salesReviewFilter}
                          onChange={(e) => setSalesReviewFilter(e.target.value)}
                          className="px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="all">All Sales</option>
                          <option value="flagged">Flagged Only</option>
                          <option value="pending">Pending Review</option>
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('1')) && (
                            <option value="type-1">Single Family</option>
                          )}
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('2')) && (
                            <option value="type-2">Semi-Detached</option>
                          )}
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('3')) && (
                            <option value="type-3">Row/Townhomes</option>
                          )}
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('4')) && (
                            <option value="type-4">MultiFamily</option>
                          )}
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('5')) && (
                            <option value="type-5">Conversions</option>
                          )}
                          {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('6')) && (
                            <option value="type-6">Condominiums</option>
                          )}
                        </select>
                        <select
                          value={normItemsPerPage}
                          onChange={(e) => setNormItemsPerPage(parseInt(e.target.value))}
                          className="px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="25">25 per page</option>
                          <option value="50">50 per page</option>
                          <option value="100">100 per page</option>
                          <option value="200">200 per page</option>
                        </select>

                        {/* Bulk actions: Keep All Valid / Reject All Outlier */}
                        <button
                          type="button"
                          onClick={async () => {
                            const isNUKeepable = (nu) => {
                              const s = (nu === undefined || nu === null) ? '' : nu.toString().trim();
                              return s === '' || s === '00' || s === '7' || s === '07';
                            };

                            const pending = timeNormalizedSales.filter(s => s.keep_reject === 'pending');
                            const willKeep = pending.filter(s => isNUKeepable(s.sales_nu)).length;
                            if (willKeep === 0) {
                              alert('No pending sales match the "sales_nu blank/00/07" rule.');
                              return;
                            }

                            if (!window.window.confirm(`Keep ${willKeep} pending sales where sales_nu is blank, 00 or 07? This will mark them as Kept and save decisions to the database.`)) return;

                            const updated = timeNormalizedSales.map(s => {
                              if (s.keep_reject === 'pending' && isNUKeepable(s.sales_nu)) return { ...s, keep_reject: 'keep' };
                              return s;
                            });

                            const newStats = {
                              ...normalizationStats,
                              pendingReview: updated.filter(s => s.keep_reject === 'pending').length,
                              keptCount: updated.filter(s => s.keep_reject === 'keep').length,
                              rejectedCount: updated.filter(s => s.keep_reject === 'reject').length,
                              acceptedSales: updated.filter(s => s.keep_reject === 'keep').length
                            };

                            setTimeNormalizedSales(updated);
                            setNormalizationStats(newStats);

                            // NOTE: Do NOT auto-save here. User should manually click "Save All Keep/Reject Decisions" to persist changes.
                            alert(`${willKeep} sales marked as Keep. Click 'Save All Keep/Reject Decisions' to persist changes.`);

                          }}
                          className="px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                        >
                          Keep All Valid
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            const isNUSkip = (nu) => {
                              const s = (nu === undefined || nu === null) ? '' : nu.toString().trim();
                              return s === '' || s === '00' || s === '7' || s === '07';
                            };

                            const outliers = timeNormalizedSales.filter(s => s.is_outlier && s.keep_reject !== 'reject');
                            const toReject = outliers.filter(s => !isNUSkip(s.sales_nu)).length;

                            if (toReject === 0) {
                              alert('No outlier sales qualify for rejection under the rule (skipping sales_nu blank/00/07).');
                              return;
                            }

                            if (!window.window.confirm(`Reject ${toReject} outlier sales (skipping sales_nu blank/00/07)? This will mark them as Rejected and clear normalized values in the database.`)) return;

                            const updated = timeNormalizedSales.map(s => {
                              if (s.is_outlier && !isNUSkip(s.sales_nu)) return { ...s, keep_reject: 'reject' };
                              return s;
                            });

                            const newStats = {
                              ...normalizationStats,
                              pendingReview: updated.filter(s => s.keep_reject === 'pending').length,
                              keptCount: updated.filter(s => s.keep_reject === 'keep').length,
                              rejectedCount: updated.filter(s => s.keep_reject === 'reject').length,
                              acceptedSales: updated.filter(s => s.keep_reject === 'keep').length
                            };

                            setTimeNormalizedSales(updated);
                            setNormalizationStats(newStats);

                            // NOTE: Do NOT auto-save here. User should manually click "Save All Keep/Reject Decisions" to persist changes.
                            alert(`${toReject} outlier sales marked as Rejected. Click 'Save All Keep/Reject Decisions' to persist changes.`);

                          }}
                          className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                        >
                          Reject All Outlier
                        </button>

                        {/* Export to Excel button */}
                        <button
                          type="button"
                          onClick={exportNormalizedSalesToExcel}
                          className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 flex items-center gap-2"
                          title="Export all properties with normalization data to Excel (includes properties without sales)"
                        >
                          <Download size={16} />
                          Export Master File
                        </button>

                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('block')}
                            >
                              Block {normSortConfig.field === 'block' && (normSortConfig.direction === 'asc' ? '↑' : '��')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('lot')}
                            >
                              Lot {normSortConfig.field === 'lot' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('qualifier')}
                            >
                              Qual {normSortConfig.field === 'qualifier' && (normSortConfig.direction === 'asc' ? '↑' : '��')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('card')}
                            >
                              Card {normSortConfig.field === 'card' && (normSortConfig.direction === 'asc' ? '��' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-32 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('property_location')}
                            >
                              Location {normSortConfig.field === 'property_location' && (normSortConfig.direction === 'asc' ? '���' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('property_class')}
                            >
                              Class {normSortConfig.field === 'property_class' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-20 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('asset_type_use')}
                            >
                              Type {normSortConfig.field === 'asset_type_use' && (normSortConfig.direction === 'asc' ? '����' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('package')}
                            >
                              Package {normSortConfig.field === 'package' && (normSortConfig.direction === 'asc' ? '��' : '���')}
                            </th>
                            <th 
                              className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('values_mod_total')}
                            >
                              Assessed {normSortConfig.field === 'values_mod_total' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('sales_date')}
                            >
                              Sale Date {normSortConfig.field === 'sales_date' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('sales_price')}
                            >
                              Sale Price {normSortConfig.field === 'sales_price' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('time_normalized_price')}
                            >
                              Time Norm {normSortConfig.field === 'time_normalized_price' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('sales_nu')}
                            >
                              Sale NU {normSortConfig.field === 'sales_nu' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('sales_ratio')}
                            >
                              Ratio {normSortConfig.field === 'sales_ratio' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-20 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('is_outlier')}
                            >
                              Status {normSortConfig.field === 'is_outlier' && (normSortConfig.direction === 'asc' ? '↑' : '���')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-28 cursor-pointer hover:bg-gray-100"
                              onClick={() => handleNormalizationSort('keep_reject')}
                            >
                              Decision {normSortConfig.field === 'keep_reject' && (normSortConfig.direction === 'asc' ? '↑' : '��')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {timeNormalizedSales
                            .filter(sale => {
                              if (salesReviewFilter === 'all') return true;
                              if (salesReviewFilter === 'flagged') return sale.is_outlier;
                              if (salesReviewFilter === 'pending') return sale.keep_reject === 'pending';
                              if (salesReviewFilter === 'type-1') return sale.asset_type_use?.toString().trim().startsWith('1');
                              if (salesReviewFilter === 'type-2') return sale.asset_type_use?.toString().trim().startsWith('2');
                              if (salesReviewFilter === 'type-3') return sale.asset_type_use?.toString().trim().startsWith('3');
                              if (salesReviewFilter === 'type-4') return sale.asset_type_use?.toString().trim().startsWith('4');
                              if (salesReviewFilter === 'type-5') return sale.asset_type_use?.toString().trim().startsWith('5');
                              if (salesReviewFilter === 'type-6') return sale.asset_type_use?.toString().trim().startsWith('6');
                              return true;
                            })
                            .slice((normCurrentPage - 1) * normItemsPerPage, normCurrentPage * normItemsPerPage)
                            .map((sale) => {
                              const parsed = parseCompositeKey(sale.property_composite_key);
                              return (
                                <tr key={sale.id} className="border-b hover:bg-gray-50">
                                  <td className="px-4 py-3 text-sm">{parsed.block}</td>
                                  <td className="px-4 py-3 text-sm">{parsed.lot}</td>
                                  <td className="px-4 py-3 text-sm">{parsed.qualifier || ''}</td>
                                  <td className="px-4 py-3 text-sm">{parsed.card || '1'}</td>
                                  <td className="px-4 py-3 text-sm">{sale.property_location}</td>
                                  <td className="px-4 py-3 text-sm">
                                    {(() => {
                                      // DEBUG: Log what we're trying to display for class
                                      const classValue = sale.property_m4_class || sale.property_class || sale.asset_building_class || 'No class found';
                                      if (sale.id && sale.id.toString().endsWith('0')) { // Log every 10th for debugging
                                        if (false) console.log(`🎯 Table render class for sale ${sale.id}:`, {
                                          property_m4_class: sale.property_m4_class,
                                          property_class: sale.property_class,
                                          asset_building_class: sale.asset_building_class,
                                          displaying: classValue
                                        });
                                      }
                                      return classValue;
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {getTypeUseDisplay(sale)}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-center">
                                    {(() => {
                                      const packageData = interpretCodes.getPackageSaleData(properties, sale);
                                      if (!packageData) return '-';

                                      // DEBUG: Log package detection for 3A properties
                                      if (sale.property_m4_class === '3A') {
                                        if (false) console.log(`��� 3A Property package detection:`, {
                                          composite_key: sale.property_composite_key,
                                          class: sale.property_m4_class,
                                          sales_date: sale.sales_date,
                                          sales_book: sale.sales_book,
                                          sales_page: sale.sales_page,
                                          is_farm_package: packageData.is_farm_package,
                                          package_count: packageData.package_count
                                        });
                                      }
                                      
                                      // Use the flags from packageData directly
                                      if (packageData.is_farm_package) {
                                        return (
                                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium" 
                                                title={`Farm package: ${packageData.package_count} properties (includes farmland)`}>
                                            Farm ({packageData.package_count})
                                          </span>
                                        );
                                      } else if (packageData.is_additional_card) {
                                        return (
                                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium" 
                                                title={`Additional cards on same property`}>
                                            Addl Card ({packageData.package_count})
                                          </span>
                                        );
                                      } else {
                                        // Regular package
                                        const deedRef = sale.sales_book && sale.sales_page ? 
                                          `${sale.sales_book}/${sale.sales_page}` : 'Package';
                                        return (
                                          <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium" 
                                                title={`Package sale: ${packageData.package_count} properties - Deed ${deedRef}`}>
                                            Pkg {deedRef} ({packageData.package_count})

                                          </span>
                                        );
                                      }
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    {(() => {
                                      // DEBUG: Check all possible assessed value fields
                                      const assessedValue = sale.values_mod_total || sale.assessed_value || sale.total_assessed || 0;
                                      if (sale.id && sale.id.toString().endsWith('0')) { // Log every 10th for debugging
                                        if (false) console.log(`💰 Table render assessed for sale ${sale.id}:`, {
                                          values_mod_total: sale.values_mod_total,
                                          assessed_value: sale.assessed_value,
                                          total_assessed: sale.total_assessed,
                                          displaying: assessedValue
                                        });
                                      }
                                      return `$${assessedValue?.toLocaleString() || '0'}`;
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    {sale.sales_date ? new Date(sale.sales_date).toLocaleDateString() : ''}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    ${sale.sales_price?.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    ${sale.time_normalized_price?.toLocaleString()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-right">
                                    {(() => {
                                      // DEBUG: Check all possible sales NU fields
                                      const salesNU = sale.sales_nu || sale.sales_instrument || sale.nu || sale.sale_nu || '';
                                      if (sale.id && sale.id.toString().endsWith('0')) { // Log every 10th for debugging
                                        if (false) console.log(`�������� Table render sales_nu for sale ${sale.id}:`, {
                                          sales_nu: sale.sales_nu,
                                          sales_instrument: sale.sales_instrument,
                                          nu: sale.nu,
                                          sale_nu: sale.sale_nu,
                                          displaying: salesNU
                                        });
                                      }
                                      return salesNU;
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-center">
                                    {sale.sales_ratio ? `${(sale.sales_ratio * 100).toFixed(0)}%` : ''}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-center">
                                    {sale.is_outlier ? (
                                      <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                                        Outlier
                                      </span>
                                    ) : (
                                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                                        Valid
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex gap-1 justify-center">
                                      <button
                                        onClick={() => handleSalesDecision(sale.id, 'keep')}
                                        className={`px-2 py-1 rounded text-xs ${
                                          sale.keep_reject === 'keep'
                                            ? 'bg-green-600 text-white'
                                            : 'bg-gray-200 hover:bg-green-100'
                                        }`}
                                      >
                                        Keep
                                      </button>
                                      <button
                                        onClick={() => handleSalesDecision(sale.id, 'reject')}
                                        className={`px-2 py-1 rounded text-xs ${
                                          sale.keep_reject === 'reject'
                                            ? 'bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-red-100'
                                        }`}
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>

    
                    {(() => {
                      const filteredSales = timeNormalizedSales.filter(sale => {
                        if (salesReviewFilter === 'all') return true;
                        if (salesReviewFilter === 'flagged') return sale.is_outlier;
                        if (salesReviewFilter === 'pending') return sale.keep_reject === 'pending';
                        if (salesReviewFilter.startsWith('type-')) {
                          const typeNum = salesReviewFilter.split('-')[1];
                          return sale.asset_type_use?.toString().trim().startsWith(typeNum);
                        }
                        return true;
                      });
                      const totalNormPages = Math.ceil(filteredSales.length / normItemsPerPage);
                      
                      return totalNormPages > 1 && (
                        <div className="flex justify-between items-center mt-4">
                          <div className="text-sm text-gray-600">
                            Page {normCurrentPage} of {totalNormPages} ({filteredSales.length} sales)
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setNormCurrentPage(Math.max(1, normCurrentPage - 1))}
                              disabled={normCurrentPage === 1}
                              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <button
                              onClick={() => setNormCurrentPage(Math.min(totalNormPages, normCurrentPage + 1))}
                              disabled={normCurrentPage === totalNormPages}
                              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                            >
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="mt-4 p-4 bg-blue-50 rounded">
                      <p className="text-sm">
                        <strong>Review Guidelines:</strong> Sales with ratios outside {(() => {
                          const eqRatio = parseFloat(equalizationRatio);
                          const outThreshold = parseFloat(outlierThreshold);
                          if (!eqRatio || !outThreshold) return 'N/A (set ratios first)';
                          const lower = (eqRatio * (1 - outThreshold/100)).toFixed(2);
                          const upper = (eqRatio * (1 + outThreshold/100)).toFixed(2);
                          return `${lower}%-${upper}%`;
                        })()} are flagged.
                        Consider property condition, special circumstances, and market conditions when making keep/reject decisions.
                      </p>
                    </div>
                    
                    {/* Save All Decisions Button */}
                    <div className="mt-4 flex justify-center">
                      <button
                        onClick={saveBatchDecisions}
                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Save All Keep/Reject Decisions
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Size Normalization Section */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Size Normalization</h3>
                  <div className="flex items-center gap-4">
                    {lastSizeNormalizationRun && (
                      <span className="text-gray-500 text-sm">
                        Last run: {new Date(lastSizeNormalizationRun).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      onClick={runSizeNormalization}
                    disabled={isProcessingSize || timeNormalizedSales.filter(s => s.keep_reject === 'keep').length === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isProcessingSize ? (
                      <>
                        <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                        Processing...
                      </>
                    ) : (
                      'Run Size Normalization'
                    )}
                  </button>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 rounded mb-4">
                  <p className="text-sm">
                    <strong>Process:</strong> After reviewing time normalization results, run size normalization on accepted sales. 
                    Properties are grouped by type (based on first digit/character) and adjusted to their group's average size:
                  </p>
                  <ul className="text-sm mt-2 space-y-1">
                    <li>• <strong>Single Family (1x):</strong> All codes starting with 1</li>
                    <li>• <strong>Semi-Detached (2x):</strong> All codes starting with 2</li>
                    <li>• <strong>Row/Townhouses (3x):</strong> All codes starting with 3</li>
                    <li>• <strong>Multifamily (4x):</strong> All codes starting with 4</li>
                    <li>• <strong>Conversions (5x):</strong> All codes starting with 5</li>
                    <li>�� <strong>Condominiums (6x):</strong> All codes starting with 6</li>
                  </ul>
                </div>

                {normalizationStats.sizeNormalized > 0 && (
                  <div className="space-y-4">
                    {/* Main Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{normalizationStats.acceptedSales}</div>
                        <div className="text-sm text-gray-600">Accepted Sales</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{normalizationStats.sizeNormalized}</div>
                        <div className="text-sm text-gray-600">Size Normalized</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          ${normalizationStats.avgSizeAdjustment?.toLocaleString() || 0}
                        </div>
                        <div className="text-sm text-gray-600">Avg Adjustment</div>
                      </div>
                    </div>
                    
                    {/* Type Grouping Breakdown */}
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Size Normalization by Type:</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {normalizationStats.singleFamily > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.singleFamily}</div>
                            <div className="text-xs text-gray-600">Single Family (1x)</div>
                          </div>
                        )}
                        {normalizationStats.semiDetached > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.semiDetached}</div>
                            <div className="text-xs text-gray-600">Semi-Detached (2x)</div>
                          </div>
                        )}
                        {normalizationStats.townhouses > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.townhouses}</div>
                            <div className="text-xs text-gray-600">Row/Townhouses (3x)</div>
                          </div>
                        )}
                        {normalizationStats.multifamily > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.multifamily}</div>
                            <div className="text-xs text-gray-600">Multifamily (4x)</div>
                          </div>
                        )}
                        {normalizationStats.conversions > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.conversions}</div>
                            <div className="text-xs text-gray-600">Conversions (5x)</div>
                          </div>
                        )}
                        {normalizationStats.condominiums > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.condominiums}</div>
                            <div className="text-xs text-gray-600">Condominiums (6x)</div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-sm text-gray-500 italic">
                      Each type group normalized to its own average lot size using 50% adjustment method
                    </div>
                  </div>        
                )}
              </div>
            </>
          )}
          </div>
        </div>
      )}

      {/* Block Analysis Tab Content */}
      {activeSubTab === 'unitRates' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Unit Rate Configuration (BRT)</h3>
              <div className="flex items-center gap-4">
                <button
                  onClick={saveUnitRateConfig}
                  disabled={vendorType !== 'BRT' || isSavingUnitConfig}
                  className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingUnitConfig ? 'Saving...' : 'Save Config'}
                </button>
                <button
                  onClick={calculateUnitRates}
                  disabled={vendorType !== 'BRT' || isCalculatingUnitSizes}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {isCalculatingUnitSizes ? 'Calculating...' : 'Calculate Lot Size'}
                </button>
                <button
                  onClick={exportLotSizeReport}
                  disabled={isExportingLotSizes}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                  title="Export lot size data for all properties"
                >
                  <Download size={16} />
                  {isExportingLotSizes ? 'Exporting...' : 'Export Report'}
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-4">Select unit-rate codes to include when calculating lot acreage. If none selected, all unit rates will be summed.</p>

            <div className="grid grid-cols-1 gap-4">
              {/* Instance window - larger */}
              <div className="border rounded p-2 max-h-[520px] overflow-auto">
                {groupedUnitRateCodes.length === 0 ? (
                  <div className="text-sm text-gray-500">No unit rate codes found for this job.</div>
                ) : (
                  groupedUnitRateCodes.map(group => {
                    const desc = group.description;
                    return (
                      <div key={desc} className="py-1">
                        <div className="text-sm">
                          <div className="font-medium">{desc}</div>
                          <div className="text-xs text-gray-500">{group.items.length} instance{group.items.length > 1 ? 's' : ''} • {group.items.map(i => `${i.vcsLabel || i.vcs}·${i.code}`).join(', ')}</div>
                          <div className="mt-2 text-xs text-gray-600">{group.items.length} instance{group.items.length > 1 ? 's' : ''}. Use the Codes in VCS box to the right to drag into buckets.</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Lower area with staged (left), controls (center), saved (right) */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="font-medium mb-2">Staged Mappings</div>
                  <div className="border rounded p-2 h-72 overflow-auto bg-white">
                    {Object.keys(stagedMappings || {}).length === 0 ? (
                      <div className="text-xs text-gray-500">No staged mappings</div>
                    ) : (
                      <div className="space-y-2">
                        {Object.keys(stagedMappings).map(k => (
                          <div key={k} className="border p-2 rounded bg-gray-50">
                            <div className="flex justify-between items-center">
                              <div className="font-medium">{getVCSDisplayName(k)}</div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-yellow-800">Staged</div>
                                <button
                                  onClick={() => {
                                    setStagedMappings(prev => {
                                      const copy = { ...prev };
                                      delete copy[k];
                                      return copy;
                                    });
                                  }}
                                  className="text-red-500 hover:text-red-700 text-xs"
                                  title="Remove staged mapping"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">Acre: {(stagedMappings[k].acre||[]).join(', ') || '-'} • SF: {(stagedMappings[k].sf||[]).join(', ') || '-'} • Exclude: {(stagedMappings[k].exclude||[]).join(', ') || '-'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-sm text-gray-700">Summary</p>
                    <div className="mt-3">
                      <div className="text-sm">Total Codes: <strong>{unitRateCodes.length}</strong></div>
                      <div className="text-sm mt-1">Selected: <strong>{selectedUnitRateCodes.size}</strong></div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs text-gray-600">Notes:</p>
                      <ul className="text-xs text-gray-600 list-disc list-inside mt-2">
                        <li>Only BRT jobs support unit-rate configuration.</li>
                        <li>Calculation uses heuristic: values ≥1000 treated as SF, smaller as acres.</li>
                        <li>Results are saved to property_market_analysis.market_manual_lot_acre and market_manual_lot_sf</li>
                      </ul>
                    </div>

                    <div className="mt-4 border-t pt-4">
                      <label className="text-xs">VCS</label>
                      <select value={mappingVcsKey} onChange={e => setMappingVcsKey(e.target.value)} className="w-full px-3 py-2 border rounded">
                        <option value="">— Select VCS —</option>
                        {vcsOptionsShown.map(v => (
                          <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                      </select>

                      {/* Codes box + drag targets */}
                      {mappingVcsKey ? (
                        <div className="mt-2 p-2 border rounded bg-white">
                          <div className="flex justify-between items-center">
                            <div className="text-sm font-medium">Codes in VCS {mappingVcsKey}</div>
                            <div className="text-xs text-gray-500">{(availableCodesByVcs[mappingVcsKey] || []).length} codes</div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 max-h-48 overflow-auto p-1">
                            {(availableCodesByVcs[mappingVcsKey] || []).map(u => (
                              <div
                                key={u.key}
                                draggable
                                onDragStart={(e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ code: u.code, vcs: u.vcs, description: u.description })); }}
                                className="px-2 py-1 bg-gray-100 border border-gray-200 rounded text-xs cursor-grab"
                                title={`Drag ${u.vcsLabel || u.vcs}·${u.code} into a bucket`}
                              >
                                <div className="font-medium">{u.vcsLabel ? `${u.vcsLabel}·${u.code}` : `${u.vcs}·${u.code}`}</div>
                                <div className="text-xs text-gray-500 truncate max-w-xs">{u.description}</div>
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-3 gap-2 mt-3">
                            <div>
                              <label className="text-xs">Acre</label>
                              <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); try{const d=JSON.parse(e.dataTransfer.getData('text/plain')); addCodeToZone(d.code,'acre')}catch{} }} className="min-h-16 p-2 border rounded bg-white">
                                {mappingAcre.length === 0 ? <div className="text-xs text-gray-400">Drop codes here</div> : mappingAcre.map(c => (
                                  <div key={c} className="inline-block mr-2 mb-2 px-2 py-1 bg-green-50 border border-green-200 rounded text-xs">
                                    {c} <button onClick={() => removeCodeFromZone(c,'acre')} className="ml-1 text-red-500">×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="text-xs">SF</label>
                              <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); try{const d=JSON.parse(e.dataTransfer.getData('text/plain')); addCodeToZone(d.code,'sf')}catch{} }} className="min-h-16 p-2 border rounded bg-white">
                                {mappingSf.length === 0 ? <div className="text-xs text-gray-400">Drop codes here</div> : mappingSf.map(c => (
                                  <div key={c} className="inline-block mr-2 mb-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs">
                                    {c} <button onClick={() => removeCodeFromZone(c,'sf')} className="ml-1 text-red-500">×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="text-xs">Exclude</label>
                              <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); try{const d=JSON.parse(e.dataTransfer.getData('text/plain')); addCodeToZone(d.code,'exclude')}catch{} }} className="min-h-16 p-2 border rounded bg-white">
                                {mappingExclude.length === 0 ? <div className="text-xs text-gray-400">Drop codes here</div> : mappingExclude.map(c => (
                                  <div key={c} className="inline-block mr-2 mb-2 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs">
                                    {c} <button onClick={() => removeCodeFromZone(c,'exclude')} className="ml-1 text-red-500">×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2 mt-3">
                            <button onClick={stageMapping} disabled={!mappingVcsKey} className="px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">Ready to Save</button>
                            <div className="text-xs text-gray-500">Drag codes from the list above into the desired bucket, then click "Ready to Save" to stage into the left panel.</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="font-medium mb-2">Saved Mappings</div>
                  <div className="border rounded p-2 h-72 overflow-auto bg-white">
                    {Object.keys(combinedMappings || {}).length === 0 ? (
                      <div className="text-xs text-gray-500">No saved mappings</div>
                    ) : (
                      <div className="space-y-2">
                        {Object.keys(combinedMappings).map(k => (
                          <div key={k} className="border p-2 rounded bg-gray-50">
                            <div className="flex justify-between items-center">
                              <div className="font-medium">{getVCSDisplayName(k)}</div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-green-800">Saved</div>
                                <button
                                  onClick={async () => {
                                    const currentJobId = jobData?.id;
                                    if (!currentJobId) return;

                                    // Update local state immediately for instant UI feedback
                                    setCombinedMappings(prev => {
                                      const copy = { ...prev };
                                      delete copy[k];
                                      return copy;
                                    });

                                    // Also remove from staged mappings if present
                                    setStagedMappings(prev => {
                                      const copy = { ...prev };
                                      delete copy[k];
                                      return copy;
                                    });

                                    // Update database in background - clear from both unit_rate_config AND staged_unit_rate_config
                                    try {
                                      const { data: fetchedJob, error: fetchErr } = await supabase
                                        .from('jobs')
                                        .select('unit_rate_config, staged_unit_rate_config')
                                        .eq('id', currentJobId)
                                        .single();

                                      if (fetchErr) throw fetchErr;

                                      const currentConfig = fetchedJob?.unit_rate_config || {};
                                      const currentStaged = fetchedJob?.staged_unit_rate_config || {};
                                      const updatedConfig = { ...currentConfig };
                                      const updatedStaged = { ...currentStaged };
                                      delete updatedConfig[k];
                                      delete updatedStaged[k];

                                      const { error: updateErr } = await supabase
                                        .from('jobs')
                                        .update({
                                          unit_rate_config: updatedConfig,
                                          staged_unit_rate_config: updatedStaged
                                        })
                                        .eq('id', currentJobId);

                                      if (updateErr) throw updateErr;
                                    } catch (e) {
                                      console.error('Failed to remove VCS from database:', e);
                                      // Silently fail - user already sees the UI update
                                    }
                                  }}
                                  className="text-red-500 hover:text-red-700 text-xs"
                                  title="Remove from saved configuration"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">Acre: {(combinedMappings[k].acre||[]).join(', ') || '-'} • SF: {(combinedMappings[k].sf||[]).join(', ') || '-'} • Exclude: {(combinedMappings[k].exclude||[]).join(', ') || '-'}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

{activeSubTab === 'marketAnalysis' && (
        <div className="space-y-6" style={{ position: 'relative' }}>
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Block Market Analysis</h3>
              <div className="flex gap-2">
                {preValChecklist.market_analysis ? (
                  <span className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-semibold inline-flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Completed
                  </span>
                ) : null}
                <button
                  onClick={() => {
                    // Export to Excel with formatting and colors
                    if (!marketAnalysisData || marketAnalysisData.length === 0) {
                      alert('No market analysis data available to export. Please run the analysis first.');
                      return;
                    }

                    // Prepare data with headers
                    const headers = [
                      'Block',
                      'Total Properties',
                      '# of Sales',
                      'Avg Normalized Value',
                      'Avg Age',
                      'Avg Size',
                      'Most Common Design',
                      'Age Consistency',
                      'Size Consistency',
                      'Design Consistency',
                      'Color',
                      'Bluebeam Position'
                    ];

                    const data = marketAnalysisData.map(block => [
                      block.block || '',
                      block.propertyCount || 0,
                      block.salesCount || 0,
                      block.avgNormalizedValue || 0,
                      block.ageDetails?.avgYear || '',
                      block.sizeDetails?.avgSize || '',
                      block.designDetails?.dominantDesign || '',
                      block.ageConsistency || '',
                      block.sizeConsistency || '',
                      block.designConsistency || '',
                      block.color?.name || '',
                      `Row ${block.color?.row || ''} Col ${block.color?.col || ''}`
                    ]);

                    // Create worksheet from array of arrays
                    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

                    // Base style for all cells
                    const baseStyle = {
                      font: { name: 'Leelawadee', sz: 10 },
                      alignment: { horizontal: 'center', vertical: 'center' }
                    };

                    // Header style (bold, no fill)
                    const headerStyle = {
                      font: { name: 'Leelawadee', sz: 10, bold: true },
                      alignment: { horizontal: 'center', vertical: 'center' }
                    };

                    // Apply formatting to all cells
                    const range = XLSX.utils.decode_range(ws['!ref']);

                    for (let R = range.s.r; R <= range.e.r; ++R) {
                      for (let C = range.s.c; C <= range.e.c; ++C) {
                        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                        if (!ws[cellAddress]) continue;

                        // Apply header style to first row
                        if (R === 0) {
                          ws[cellAddress].s = headerStyle;
                        } else {
                          ws[cellAddress].s = { ...baseStyle };

                          // Apply specific formatting based on column
                          // Column B (Total Properties) and C (# of Sales) - number format
                          if (C === 1 || C === 2) {
                            ws[cellAddress].s.numFmt = '#,##0';
                          }
                          // Column D (Avg Normalized Value) - currency format
                          else if (C === 3) {
                            ws[cellAddress].s.numFmt = '$#,##0';
                          }
                          // Column F (Avg Size) - number format
                          else if (C === 5) {
                            ws[cellAddress].s.numFmt = '#,##0';
                          }
                          // Column K (Color) - apply the actual color as background
                          else if (C === 10) {
                            const colorName = marketAnalysisData[R - 1]?.color?.hex;
                            if (colorName) {
                              ws[cellAddress].s.fill = { fgColor: { rgb: colorName.replace('#', '') } };
                              // If color is dark, use white text
                              const isDark = parseInt(colorName.replace('#', '').substring(0, 2), 16) < 128;
                              if (isDark) {
                                ws[cellAddress].s.font = { ...ws[cellAddress].s.font, color: { rgb: 'FFFFFF' } };
                              }
                            }
                          }
                        }
                      }
                    }

                    // Set column widths
                    ws['!cols'] = [
                      { wch: 12 },  // Block
                      { wch: 15 },  // Total Properties
                      { wch: 12 },  // # of Sales
                      { wch: 20 },  // Avg Normalized Value
                      { wch: 10 },  // Avg Age
                      { wch: 12 },  // Avg Size
                      { wch: 25 },  // Most Common Design
                      { wch: 15 },  // Age Consistency
                      { wch: 15 },  // Size Consistency
                      { wch: 17 },  // Design Consistency
                      { wch: 20 },  // Color
                      { wch: 18 }   // Bluebeam Position
                    ];

                    // Create workbook and export
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Block Analysis');
                    XLSX.writeFile(wb, `BlockAnalysis_${jobData?.job_name || 'export'}_${new Date().toISOString().split('T')[0]}.xlsx`);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Export to Excel
                </button>

                {/* Mark Complete for Market Analysis (next to Export) */}
                <button
                  onClick={async () => {
                    if (!jobData?.id) return;
                    const newStatus = preValChecklist.market_analysis ? 'pending' : 'completed';
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
                      const updated = await checklistService.updateItemStatus(jobData.id, 'market-analysis', newStatus, completedBy);
                      const persistedStatus = updated?.status || newStatus;
                      setPreValChecklist(prev => ({ ...prev, market_analysis: persistedStatus === 'completed' }));
                      try { window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId: 'market-analysis', status: persistedStatus } })); } catch(e){}
                      try { if (typeof onUpdateJobCache === 'function') callRefresh(null); } catch(e){}
                    } catch (error) {
                      console.error('Market Analysis checklist update failed:', error);
                      alert('Failed to update checklist. Please try again.');
                    }
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-medium"
                  style={{ backgroundColor: preValChecklist.market_analysis ? '#10B981' : '#E5E7EB', color: preValChecklist.market_analysis ? 'white' : '#374151' }}
                  title={preValChecklist.market_analysis ? 'Click to reopen' : 'Mark Market Analysis complete'}
                >
                  {preValChecklist.market_analysis ? '✓ Mark Complete' : 'Mark Complete'}
                </button>

              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type & Use
                </label>
                <select
                  value={blockTypeFilter}
                  onChange={(e) => setBlockTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="1">1 — Single Family</option>
                  <option value="2">2 — Duplex / Semi-Detached</option>
                  <option value="3">3* — Row / Townhouse (3E,3I,30,31)</option>
                  <option value="4">4* �� MultiFamily (42,43,44)</option>
                  <option value="5">5* — Conversions (51,52,53)</option>
                  <option value="6">6 — Condominium</option>
                  <option value="all_residential">All Residential</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color Scale Start (0-99K = first color)
                </label>
                <input
                  type="number"
                  value={colorScaleStart}
                  onChange={(e) => setColorScaleStart(parseInt(e.target.value) || 0)}
                  step="100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color Increment (100K intervals)
                </label>
                <input
                  type="number"
                  value={colorScaleIncrement}
                  onChange={(e) => setColorScaleIncrement(parseInt(e.target.value) || 100000)}
                  step="100000"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 rounded text-sm">
              <strong>Color Scale:</strong> Red → Pink → Orange → Yellow → Green → Teal → Blue → Purple
              <br/>• Each color has 2 steps (pastel & bright) at ${colorScaleIncrement.toLocaleString()} intervals
              <br/>• Red: $0-${(colorScaleIncrement * 2 - 1).toLocaleString()} • Pink: ${(colorScaleIncrement * 2).toLocaleString()}-${(colorScaleIncrement * 4 - 1).toLocaleString()} • Orange: ${(colorScaleIncrement * 4).toLocaleString()}-${(colorScaleIncrement * 6 - 1).toLocaleString()} • Yellow: ${(colorScaleIncrement * 6).toLocaleString()}-${(colorScaleIncrement * 8 - 1).toLocaleString()}
              <br/>• Green: ${(colorScaleIncrement * 8).toLocaleString()}-${(colorScaleIncrement * 10 - 1).toLocaleString()} • Teal: ${(colorScaleIncrement * 10).toLocaleString()}-${(colorScaleIncrement * 12 - 1).toLocaleString()} • Blue: ${(colorScaleIncrement * 12).toLocaleString()}-${(colorScaleIncrement * 14 - 1).toLocaleString()} • Purple: ${(colorScaleIncrement * 14).toLocaleString()}+
              <br/>• Total: {marketAnalysisData.length} blocks analyzed • Gray = No Data
            </div>
          </div>
          
          {/* Block Analysis Table */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Block Analysis Results</h3>
            
            {isProcessingBlocks ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="animate-spin text-blue-600 mr-2" size={20} />
                <span>Processing block analysis...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Block</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Total Props</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700"># Sales</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Avg Norm Value</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Avg Age</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Avg Size</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Most Common Design</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Age</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Size</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Design</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Color</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketAnalysisData.map((block, index) => {
                      // Determine background color based on consistency ratings
                      const getConsistencyColor = (consistency) => {
                        switch(consistency) {
                          case 'High': return '#10B981'; // green
                          case 'Medium': return '#F59E0B'; // yellow
                          case 'Low': return '#FB923C'; // orange
                          case 'Mixed': return '#EF4444'; // red
                          default: return '#6B7280'; // gray
                        }
                      };
                      
                      // Count sales in this block
                      const salesCount = properties.filter(p => {
                        const parsed = parseCompositeKey(p.property_composite_key);
                        return parsed.block === block.block && p.sales_price && p.sales_date;
                      }).length;
                      
                      return (
                        <tr key={block.block} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${block.noData ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-3 text-sm font-medium">{block.block}</td>
                          <td className="px-4 py-3 text-sm text-center">{block.propertyCount}</td>
                          <td className="px-4 py-3 text-sm text-center">{block.salesCount}</td>
                          <td className="px-4 py-3 text-sm text-right font-medium">
                            {block.noData ? (
                              <span className="text-gray-400 italic">No Sales Data</span>
                            ) : (
                              `$${block.avgNormalizedValue.toLocaleString()}`
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            {block.noData ? '-' : block.ageDetails.avgYear}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            {block.noData ? '-' : `${block.sizeDetails.avgSize.toLocaleString()} sf`}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {block.noData ? '-' : block.designDetails.dominantDesign}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {block.noData ? (
                              <span className="text-gray-400">-</span>
                            ) : (
                              <button
                              onClick={() => {
                                setSelectedBlockDetails({
                                  ...block,
                                  salesCount,
                                  metric: 'age'
                                });
                                setShowBlockDetailModal(true);
                              }}
                              className="px-2 py-1 rounded text-xs text-white font-medium hover:opacity-80"
                              style={{ backgroundColor: getConsistencyColor(block.ageConsistency) }}
                            >
                              {block.ageConsistency}
                            </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {block.noData ? (
                              <span className="text-gray-400">-</span>
                            ) : (
                              <button
                              onClick={() => {
                                setSelectedBlockDetails({
                                  ...block,
                                  salesCount,
                                  metric: 'size'
                                });
                                setShowBlockDetailModal(true);
                              }}
                              className="px-2 py-1 rounded text-xs text-white font-medium hover:opacity-80"
                              style={{ backgroundColor: getConsistencyColor(block.sizeConsistency) }}
                            >
                              {block.sizeConsistency}
                            </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {block.noData ? (
                              <span className="text-gray-400">-</span>
                            ) : (
                              <button
                              onClick={() => {
                                setSelectedBlockDetails({
                                  ...block,
                                  salesCount,
                                  metric: 'design'
                                });
                                setShowBlockDetailModal(true);
                              }}
                              className="px-2 py-1 rounded text-xs text-white font-medium hover:opacity-80"
                              style={{ backgroundColor: getConsistencyColor(block.designConsistency) }}
                            >
                              {block.designConsistency}
                            </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <div
                                className="w-8 h-8 rounded border-2 border-gray-300"
                                style={{ backgroundColor: block.color.hex }}
                                title={`${block.color.name} - Row ${block.color.row}, Col ${block.color.col}`}
                              />
                              <span className="text-xs text-gray-500">R{block.color.row}C{block.color.col}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            
            {marketAnalysisData.length === 0 && !isProcessingBlocks && (
              <div className="text-center py-8 text-gray-500">
                Run Size Normalization first to see block analysis
              </div>
            )}
          </div>
        </div>
      )}

      {/* Property Worksheet Tab Content */}
      {activeSubTab === 'worksheet' && (
        <div className="space-y-6">
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Property Worksheet Configuration</h3>
              <div className="flex gap-2 flex-nowrap items-center">
                <input
                  type="file"
                  id="import-file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files[0] && analyzeImportFile(e.target.files[0])}
                  className="hidden"
                />

                <button
                  onClick={() => document.getElementById('import-file').click()}
                  disabled={isAnalyzingImport}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  {isAnalyzingImport ? (
                    <>
                      <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                      Analyzing...
                    </>
                  ) : (
                    'Import Updates from Excel'
                  )}
                </button>

                <button
                  onClick={exportWorksheetToExcel}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Export to Excel
                </button>

                <button
                  onClick={() => setShowDiagnosticModal(true)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                  title="Paste your edited CSV to diagnose unmatched rows"
                >
                  Run Import Diagnostic
                </button>

                <button
                  onClick={() => {
                    if (window.window.confirm(`Copy current VCS to new VCS for ALL ${worksheetProperties.length} properties? This will OVERWRITE any existing new VCS values!`)) {
                      const updated = worksheetProperties.map(prop => ({
                        ...prop,
                        new_vcs: prop.property_vcs || ''
                      }));
                      setWorksheetProperties(updated);
                      // Let useEffect handle filtering to respect current search/filter
                      updateWorksheetStats(updated);
                      setUnsavedChanges(true);
                      alert(`�� Copied current VCS values for ${worksheetProperties.length} properties`);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  title="Copy all current VCS values to new VCS field"
                >
                  Copy All Current VCS
                </button>

                <button
                  onClick={() => {
                    if (!worksheetProperties || worksheetProperties.length === 0) return;
                    const allKeys = worksheetProperties.map(p => p.property_composite_key);
                    const isAllSelected = allKeys.length > 0 && allKeys.every(k => readyProperties.has(k));
                    if (isAllSelected) {
                      // Clear all
                      setReadyProperties(new Set());
                      updateWorksheetStats(worksheetProperties);
                    } else {
                      // Select all
                      setReadyProperties(new Set(allKeys));
                      const stats = {
                        totalProperties: worksheetProperties.length,
                        vcsAssigned: worksheetProperties.filter(p => p.new_vcs).length,
                        zoningEntered: worksheetProperties.filter(p => p.asset_zoning).length,
                        locationAnalysis: worksheetProperties.filter(p => p.location_analysis).length,
                        readyToProcess: allKeys.length
                      };
                      setWorksheetStats(stats);
                    }
                  }}
                  className={readyProperties && worksheetProperties && worksheetProperties.length > 0 && worksheetProperties.every(p => readyProperties.has(p.property_composite_key)) ? 'px-4 py-2 border rounded font-medium bg-gray-200 text-gray-800' : 'px-4 py-2 border rounded font-medium bg-green-600 text-white hover:bg-green-700'}
                  title="Select or clear all Ready checkboxes"
                >
                  {worksheetProperties && worksheetProperties.length > 0 && worksheetProperties.every(p => readyProperties.has(p.property_composite_key)) ? 'Clear All' : 'Select All'}
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{worksheetStats.totalProperties}</div>
                <div className="text-sm text-gray-600">Total Properties</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {worksheetStats.vcsAssigned} / {worksheetStats.totalProperties}
                </div>
                <div className="text-sm text-gray-600 flex items-center justify-center gap-1">
                  VCS Assigned
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {worksheetStats.zoningEntered} / {worksheetStats.totalProperties}
                </div>
                <div className="text-sm text-gray-600">Zoning Entered</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{worksheetStats.locationAnalysis}</div>
                <div className="text-sm text-gray-600">Location Analysis</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{worksheetStats.readyToProcess}</div>
                <div className="text-sm text-gray-600">Ready to Process</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {Math.round((worksheetStats.vcsAssigned / worksheetStats.totalProperties) * 100) || 0}%
                </div>
                <div className="text-sm text-gray-600">Completion</div>
              </div>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{
                  width: `${worksheetStats.totalProperties > 0 
                    ? (worksheetStats.vcsAssigned / worksheetStats.totalProperties * 100) 
                    : 0}%`
                }}
              />
            </div>
          </div>

          {/* Data Grid */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Property Worksheet</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search address or property ID..."
                  value={worksheetSearchTerm}
                  onChange={(e) => setWorksheetSearchTerm(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded"
                />
                <select
                  value={worksheetFilter}
                  onChange={(e) => setWorksheetFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="all">All Properties</option>
                  <option value="missing-vcs">Missing VCS</option>
                  <option value="missing-location">Missing Location</option>
                  <option value="missing-zoning">Missing Zoning</option>
                  <option value="ready">Ready to Process</option>
                  <option value="completed">Completed</option>
                  <option value="not-ready">Not Ready</option>
                </select>
              </div>
            </div>

            {/* Top Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center mb-4 pb-4 border-b">
                <div className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages} ({filteredWorksheetProps.length} properties)
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                    title="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                    title="Next page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto max-h-[600px]">
              <table className="min-w-full table-fixed">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('block')}
                        >
                          Block {sortConfig.field === 'block' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('lot')}
                        >
                          Lot {sortConfig.field === 'lot' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('qualifier')}
                        >
                          Qual {sortConfig.field === 'qualifier' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('card')}
                        >
                          Card {sortConfig.field === 'card' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('property_location')}
                        >
                          Location {sortConfig.field === 'property_location' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('property_class')}
                        >
                          Class {sortConfig.field === 'property_class' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('building_class_display')}
                        >
                          Building Class {sortConfig.field === 'building_class_display' && (sortConfig.direction === 'asc' ? '���' : '��')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('type_use_display')}
                        >
                          Type/Use {sortConfig.field === 'type_use_display' && (sortConfig.direction === 'asc' ? '↑' : '��')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('design_display')}
                        >
                          Design {sortConfig.field === 'design_display' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('property_vcs')}
                        >
                          Current VCS {sortConfig.field === 'property_vcs' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th></th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('new_vcs')}
                        >
                          New VCS {sortConfig.field === 'new_vcs' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('location_analysis')}
                        >
                          Location Analysis {sortConfig.field === 'location_analysis' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_zoning')}
                        >
                          Zoning {sortConfig.field === 'asset_zoning' && (sortConfig.direction === 'asc' ? '���' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_map_page')}
                        >
                          Map Page {sortConfig.field === 'asset_map_page' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_key_page')}
                        >
                          Key Page {sortConfig.field === 'asset_key_page' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('worksheet_notes')}
                        >
                          Notes {sortConfig.field === 'worksheet_notes' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-center text-xs font-medium text-gray-700 bg-green-50 cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort('ready')}
                        >
                          Ready {sortConfig.field === 'ready' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                      </tr>
                    </thead>
                  <tbody>
                  {paginatedProperties.map((prop) => (
                    <tr key={prop.property_composite_key} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm">{prop.block}</td>
                      <td className="px-3 py-2 text-sm">{prop.lot}</td>
                      <td className="px-3 py-2 text-sm">{prop.qualifier}</td>
                      <td className="px-3 py-2 text-sm">
                        <div className="flex items-center gap-1">
                          <span>{prop.card || '1'}</span>
                          {/* Show copy button for secondary cards */}
                          {((vendorType === 'Microsystems' && prop.card && prop.card !== 'M' && prop.card !== 'NONE') ||
                            (vendorType === 'BRT' && prop.card && prop.card !== '1' && prop.card !== 'NONE')) && (
                            <button
                              onClick={() => {
                                // Find the parent card (M for Microsystems, 1 for BRT)
                                const parentCard = worksheetProperties.find(p => {
                                  const pParsed = parseCompositeKey(p.property_composite_key);
                                  const propParsed = parseCompositeKey(prop.property_composite_key);
                                  return pParsed.block === propParsed.block && 
                                         pParsed.lot === propParsed.lot &&
                                         pParsed.qualifier === propParsed.qualifier &&
                                         ((vendorType === 'Microsystems' && pParsed.card === 'M') ||
                                          (vendorType === 'BRT' && pParsed.card === '1'));
                                });
                                
                                if (parentCard && parentCard.new_vcs) {
                                  handleWorksheetChange(prop.property_composite_key, 'new_vcs', parentCard.new_vcs);
                                  if (false) console.log(`�� Copied VCS "${parentCard.new_vcs}" from parent card to ${prop.card}`);
                                } else if (parentCard) {
                                  alert('Parent card does not have a New VCS value to copy');
                                } else {
                                  alert('Could not find parent card for this property');
                                }
                              }}
                              className="px-1 py-0.5 text-xs bg-blue-100 hover:bg-blue-200 rounded"
                              title="Copy VCS from parent card"
                            >
                              <Copy size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm">{prop.property_location}</td>
                      <td className="px-3 py-2 text-sm">{prop.property_class}</td>
                      <td className="px-3 py-2 text-sm">{prop.building_class_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.type_use_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.design_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.property_vcs}</td>
                      <td className="px-1">
                        <button
                          onClick={() => copyCurrentVCS(prop.property_composite_key, prop.property_vcs)}
                          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                          title="Copy current VCS to new"
                        >
                          →
                        </button>
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.new_vcs || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'new_vcs', e.target.value)}
                          maxLength="4"
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm uppercase"
                          style={{ textTransform: 'uppercase' }}
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.location_analysis || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'location_analysis', e.target.value)}
                          className="w-32 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_zoning || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_zoning', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm uppercase"
                          style={{ textTransform: 'uppercase' }}
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_map_page || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_map_page', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_key_page || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_key_page', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.worksheet_notes || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'worksheet_notes', e.target.value)}
                          className="w-24 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 text-center bg-gray-50">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={readyProperties.has(prop.property_composite_key)}
                            onChange={() => {
                              const key = prop.property_composite_key;
                              const newReadyProperties = new Set(readyProperties);
                              if (newReadyProperties.has(key)) newReadyProperties.delete(key);
                              else newReadyProperties.add(key);
                              setReadyProperties(newReadyProperties);

                              // Update stats with the new ready count
                              const stats = {
                                totalProperties: worksheetProperties.length,
                                vcsAssigned: worksheetProperties.filter(p => p.new_vcs).length,
                                zoningEntered: worksheetProperties.filter(p => p.asset_zoning).length,
                                locationAnalysis: worksheetProperties.filter(p => p.location_analysis).length,
                                readyToProcess: newReadyProperties.size
                              };
                              setWorksheetStats(stats);
                            }}
                          />
                          <span className="text-xs font-medium">
                            {readyProperties.has(prop.property_composite_key) ? 'Ready' : 'Mark'}
                          </span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bottom Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                 <div className="text-sm text-gray-600">
                   Page {currentPage} of {totalPages} ({filteredWorksheetProps.length} properties)
                 </div>
                 <div className="flex gap-2">
                   <button
                     onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                     disabled={currentPage === 1}
                     className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                     title="Previous page"
                   >
                     <ChevronLeft size={16} />
                   </button>
                   <button
                     onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                     disabled={currentPage === totalPages}
                     className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                     title="Next page"
                   >
                     <ChevronRight size={16} />
                   </button>
                 </div>
               </div>
             )}

            <div className="mt-6 flex justify-between items-center">
             <div>
               <strong>Selected for Processing:</strong> {readyProperties.size} properties
             </div>
             <div className="flex gap-2 items-center">
               <button
                 onClick={processSelectedProperties}
                 disabled={readyProperties.size === 0}
                 className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
               >
                 Process Selected Properties
               </button>

               {/* Mapping and Generate Lot Sizes removed per request */}
              <div style={{width:0,height:0}} aria-hidden="true" />

               <button
                onClick={async () => {
                  if (!jobData?.id) return;
                  setIsProcessingPageByPage(true);
                  const newStatus = preValChecklist.page_by_page ? 'pending' : 'completed';
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
                    const updated = await checklistService.updateItemStatus(jobData.id, 'page-by-page', newStatus, completedBy);
                    const persistedStatus = updated?.status || newStatus;
                    setPreValChecklist(prev => ({ ...prev, page_by_page: persistedStatus === 'completed' }));
                    try { window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId: 'page-by-page', status: persistedStatus } })); } catch(e){}
                    try { if (typeof onUpdateJobCache === 'function') callRefresh(null); } catch(e){}
                  } catch (error) {
                    console.error('Page by Page checklist update failed:', error);
                    alert('Failed to update checklist. Please try again.');
                  } finally {
                    setIsProcessingPageByPage(false);
                  }
                }}
                disabled={isProcessingPageByPage}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-medium"
                style={{ backgroundColor: preValChecklist.page_by_page ? '#10B981' : '#E5E7EB', color: preValChecklist.page_by_page ? 'white' : '#374151' }}
                title={preValChecklist.page_by_page ? 'Click to reopen' : 'Mark Page by Page Worksheet complete'}
              >
                {isProcessingPageByPage ? 'Processing...' : (preValChecklist.page_by_page ? '✓ Mark Complete' : 'Mark Complete')}
              </button>
             </div>
           </div>
         </div>
       </div>
     )}

     {/* Location Standardization Modal */}
     {showLocationModal && currentLocationChoice && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md">
           <h3 className="text-lg font-semibold mb-4">Location Standardization</h3>
           <p className="mb-4">
             You've entered a variation of an existing location. Which should be the standard?
           </p>
           <div className="space-y-2">
             <button
               onClick={() => handleLocationStandardChoice('existing')}
               className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
             >
               <strong>Use existing:</strong> {currentLocationChoice.existingStandard}
             </button>
             <button
               onClick={() => handleLocationStandardChoice('new')}
               className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
             >
               <strong>Use as entered:</strong> {currentLocationChoice.newValue}
             </button>
             <button
               onClick={() => {
                 setShowLocationModal(false);
                 setCurrentLocationChoice(null);
               }}
               className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
             >
               Cancel
             </button>
           </div>
         </div>
       </div>
     )}

     {/* Import Modal */}
     {showImportModal && importPreview && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
         <div className="bg-white rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-y-auto">
           <div className="flex justify-between items-center mb-4">
             <h3 className="text-xl font-semibold">Import Preview</h3>
             <button
               onClick={() => {
                 setShowImportModal(false);
                 setImportPreview(null);
               }}
               className="text-gray-500 hover:text-gray-700"
             >
               <X size={24} />
             </button>
           </div>

           <div className="grid grid-cols-3 gap-4 mb-6">
             <div className="bg-green-50 border border-green-200 rounded p-3">
               <div className="text-2xl font-bold text-green-700">
                 {importPreview.matched?.length || 0}
               </div>
               <div className="text-sm text-green-600">Exact Matches</div>
             </div>
             <div className="bg-blue-50 border border-blue-200 rounded p-3">
               <div className="text-2xl font-bold text-blue-700">
                 {importPreview.fuzzyMatched?.length || 0}
               </div>
               <div className="text-sm text-blue-600">Fuzzy Matches</div>
             </div>
             <div className="bg-orange-50 border border-orange-200 rounded p-3">
               <div className="text-2xl font-bold text-orange-700">
                 {importPreview.unmatched?.length || 0}
               </div>
               <div className="text-sm text-orange-600">Unmatched</div>
             </div>
           </div>

           <div className="border-t border-b py-4 mb-4">
             <h4 className="font-medium mb-3">Import Options</h4>
             <div className="space-y-2">
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.updateExisting}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     updateExisting: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Update existing properties</span>
               </label>
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.markImportedAsReady}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     markImportedAsReady: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Mark imported properties as Ready</span>
               </label>
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.useAddressFuzzyMatch}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     useAddressFuzzyMatch: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Use address fuzzy matching (threshold: {importOptions.fuzzyMatchThreshold})</span>
               </label>
             </div>
           </div>

           {/* Standardization Suggestions */}
          {Object.keys(standardizations.locations).length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium mb-2">Location Standardizations</h4>
              <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2 bg-gray-50">
                {Object.entries(standardizations.locations).map(([original, standard], idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <span className="px-2 py-1 bg-white rounded border">{original}</span>
                    <span>→</span>
                    <input
                      type="text"
                      value={standard}
                      onChange={(e) => setStandardizations(prev => ({
                        ...prev,
                        locations: { ...prev.locations, [original]: e.target.value }
                      }))}
                      className="px-2 py-1 border rounded"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View lists for matched / fuzzy / unmatched */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <button className={`px-3 py-1 rounded ${importListTab === 'matched' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 border border-green-200'}`} onClick={() => setImportListTab(importListTab === 'matched' ? null : 'matched')}>View Exact ({importPreview.matched?.length || 0})</button>
              <button className={`px-3 py-1 rounded ${importListTab === 'fuzzy' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 border border-blue-200'}`} onClick={() => setImportListTab(importListTab === 'fuzzy' ? null : 'fuzzy')}>View Fuzzy ({importPreview.fuzzyMatched?.length || 0})</button>
              <button className={`px-3 py-1 rounded ${importListTab === 'unmatched' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 border border-orange-200'}`} onClick={() => setImportListTab(importListTab === 'unmatched' ? null : 'unmatched')}>View Unmatched ({importPreview.unmatched?.length || 0})</button>
            </div>

            {importListTab && (
              <div className="max-h-64 overflow-y-auto border rounded p-2 bg-gray-50 text-sm">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="py-1">Composite Key</th>
                      <th className="py-1">Excel Location</th>
                      <th className="py-1">Worksheet Address</th>
                      <th className="py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(importListTab === 'matched' ? importPreview.matched : importListTab === 'fuzzy' ? importPreview.fuzzyMatched : importPreview.unmatched || []).slice(0,200).map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="py-1">{item.compositeKey}</td>
                        <td className="py-1">{(item.excelData && (item.excelData.Location || item.excelData.PROPERTY_LOCATION || item.excelData['Property Location'] || item.excelData.Address)) || ''}</td>
                        <td className="py-1">{item.currentData?.property_location || ''}</td>
                        <td className="py-1"><button className="px-2 py-1 bg-blue-600 text-white rounded text-xs" onClick={() => {
                          // Focus worksheet list on this property
                          if (item.currentData && item.currentData.property_composite_key) {
                            setWorksheetSearchTerm(item.currentData.property_composite_key);
                            setWorksheetFilter('all');
                          } else if (item.compositeKey) {
                            setWorksheetSearchTerm(item.compositeKey);
                          }
                          setShowImportModal(false);
                        }}>Jump to</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {((importListTab === 'matched' ? importPreview.matched : importListTab === 'fuzzy' ? importPreview.fuzzyMatched : importPreview.unmatched || []).length > 200) && (
                  <div className="text-xs text-gray-500 mt-2">Showing first 200 items</div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 mt-6">
             <button
               onClick={() => {
                 setShowImportModal(false);
                 setImportPreview(null);
               }}
               className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
             >
               Cancel
             </button>
              <button
               onClick={async () => {
                 // Process the import - actually apply the updates
                 if (false) console.log('Processing import with options:', importOptions);
                 
                 // Show processing modal
                 setShowImportModal(false);
                 setIsProcessingImport(true);
                 setImportProgress({ current: 0, total: 0, message: 'Preparing import...' });
                 
                 try {
                   // Apply matched updates
                   const allUpdates = [...(importPreview.matched || []), ...(importPreview.fuzzyMatched || [])];
                   setImportProgress({ current: 0, total: allUpdates.length, message: 'Processing updates...' });
                   
                  // Then update UI with progress tracking
                   let processedCount = 0;
                   const updatedProps = worksheetProperties.map(prop => {
                    // Match by composite key (ID may not be reliably populated in import preview)
                    const match = allUpdates.find(m =>
                      m.currentData && m.currentData.property_composite_key === prop.property_composite_key
                    );
                    if (match) {
                       processedCount++;
                       // Update progress every 10 items or on last item
                       if (processedCount % 10 === 0 || processedCount === allUpdates.length) {
                         setImportProgress({ 
                           current: processedCount, 
                           total: allUpdates.length, 
                           message: `Updating property ${processedCount} of ${allUpdates.length}...` 
                         });
                       }
                       return {
                        ...prop,
                        // Use imported value directly, convert empty strings to null for database
                        new_vcs: match.updates.new_vcs === '' ? null : match.updates.new_vcs,
                        location_analysis: match.updates.location_analysis === '' ? null : match.updates.location_analysis,
                        asset_zoning: match.updates.asset_zoning === '' ? null : match.updates.asset_zoning,
                        asset_map_page: match.updates.asset_map_page === '' ? null : match.updates.asset_map_page,
                        asset_key_page: match.updates.asset_key_page === '' ? null : match.updates.asset_key_page
                      };
                     }
                     return prop;
                   });
                   
                   setWorksheetProperties(updatedProps);
                   // Let useEffect handle filtering to respect current search/filter
                   updateWorksheetStats(updatedProps);
                   
                   // Mark as ready if option selected
                   if (importOptions.markImportedAsReady) {
                     const importedKeys = allUpdates.map(m => m.currentData.property_composite_key);
                     setReadyProperties(prev => new Set([...prev, ...importedKeys]));
                   }
                   
                   // Update stats
                   updateWorksheetStats(worksheetProperties);
                   setUnsavedChanges(true);
                   
                    setImportProgress({ 
                     current: allUpdates.length, 
                     total: allUpdates.length, 
                     message: 'Import complete!' 
                   });
                   
                   // Small delay to show completion
                   setTimeout(() => {
                     setIsProcessingImport(false);
                     setImportProgress({ current: 0, total: 0, message: '' });
                     alert(`Successfully imported ${allUpdates.length} property updates`);
                   }, 1000);
                   
                   setImportPreview(null);
                 } catch (error) {
                   console.error('Error applying import:', error);
                   setIsProcessingImport(false);
                   setImportProgress({ current: 0, total: 0, message: '' });
                   alert('Error applying import. Please check the console.');
                 }
               }}
               className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
             >
               Import {(importPreview.matched?.length || 0) + (importPreview.fuzzyMatched?.length || 0)} Updates
             </button>
           </div>
         </div>
       </div>
     )}
     {/* Import Processing Progress Modal */}
     {isProcessingImport && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md w-full">
           <h3 className="text-lg font-semibold mb-4">Processing Import</h3>
           
           <div className="mb-4">
             <div className="flex justify-between text-sm text-gray-600 mb-2">
               <span>{importProgress.message}</span>
               <span>{importProgress.current} / {importProgress.total}</span>
             </div>
             
             <div className="w-full bg-gray-200 rounded-full h-2">
               <div
                 className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                 style={{
                   width: `${importProgress.total > 0 
                     ? (importProgress.current / importProgress.total * 100) 
                     : 0}%`
                 }}
               />
             </div>
           </div>
           
           <div className="flex items-center justify-center">
             <RefreshCw className="animate-spin text-blue-600" size={20} />
             <span className="ml-2 text-sm text-gray-600">Please wait...</span>
           </div>
         </div>
       </div>
      )}

      {/* Process Selected Properties Progress Modal */}
      {isProcessingProperties && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Processing Properties</h3>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{processProgress.message}</span>
                <span>{processProgress.current} / {processProgress.total}</span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${processProgress.total > 0 
                      ? (processProgress.current / processProgress.total * 100) 
                      : 0}%`
                  }}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-center">
              <RefreshCw className="animate-spin text-blue-600" size={20} />
              <span className="ml-2 text-sm text-gray-600">Please wait...</span>
            </div>
          </div>
        </div>
      )}

      {/* Zoning Requirements Tab Content */}
      {activeSubTab === 'zoning' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Zoning Requirements Configuration</h3>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    // Save all zoning data as JSONB
                    try {
                      // Build the zoning requirements object
                      const zoningRequirements = {};
                      Object.keys(editingZoning).forEach(zone => {
                        if (editingZoning[zone]) {
                          zoningRequirements[zone] = {
                            description: editingZoning[zone].description || '',
                            min_size: parseInt(editingZoning[zone].min_size) || null,
                            min_size_unit: editingZoning[zone].minSizeUnit || 'SF',
                            min_frontage: parseInt(editingZoning[zone].min_frontage) || null,
                            min_depth: parseInt(editingZoning[zone].min_depth) || null,
                            depth_table: editingZoning[zone].depth_table || ''
                          };
                        }
                      });
                      
                      // Save to database
                      const { error } = await supabase
                        .from('market_land_valuation')
                        .upsert({
                          job_id: jobData.id,
                          zoning_config: zoningRequirements,
                          updated_at: new Date().toISOString()
                        }, {
                          onConflict: 'job_id'
                        });
                        
                      if (error) throw error;

                      //Clear cache after saving zoning
                      if (onUpdateJobCache && jobData?.id) { 
                        if (false) console.log('🗑️ Clearing cache after saving zoning');
                        callRefresh(null);
                      }
                        
                      alert('✅ Zoning requirements saved successfully');
                    } catch (error) {
                      console.error('Error saving zoning data:', error);
                      alert('Error saving zoning data');
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save All
                </button>
                <button
                  onClick={async () => {
                    if (!jobData?.id) return;
                    const newStatus = preValChecklist.zoning_config ? 'pending' : 'completed';
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      const completedBy = newStatus === 'completed' ? (user?.id || null) : null;
                      const updated = await checklistService.updateItemStatus(jobData.id, 'zoning-config', newStatus, completedBy);
                      const persistedStatus = updated?.status || newStatus;
                      setPreValChecklist(prev => ({ ...prev, zoning_config: persistedStatus === 'completed' }));
                      try { window.dispatchEvent(new CustomEvent('checklist_status_changed', { detail: { jobId: jobData.id, itemId: 'zoning-config', status: persistedStatus } })); } catch(e){}
                      try { if (typeof onUpdateJobCache === 'function') callRefresh(null); } catch(e){}
                    } catch (error) {
                      console.error('Zoning checklist update failed:', error);
                      alert('Failed to update checklist. Please try again.');
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Mark Complete
                </button>
              </div>
            </div>

            <div className="mb-4 p-4 bg-blue-50 rounded">
              <p className="text-sm">
                <strong>Instructions:</strong> Configure minimum requirements for each zoning type found in your properties. 
                These values will be used for land valuation calculations and compliance checking.
              </p>
            </div>

            {/* Get unique zones from worksheet data with smart processing */}
            {(() => {
              // Get all zones and clean them up
              const allZones = worksheetProperties
                .map(p => p.asset_zoning)
                .filter(z => z && z.trim());
              
              // Process zones to handle compounds and clean up
              const processedZones = new Set();
              
              allZones.forEach(zone => {
                // Trim whitespace
                const cleanZone = zone.trim();
                
                // Check for compound zones (with & or ,)
                if (cleanZone.includes('&')) {
                  // Split by & and add each zone separately
                  cleanZone.split('&').forEach(subZone => {
                    processedZones.add(subZone.trim());
                  });
                } else if (cleanZone.includes(',')) {
                  // Split by comma and add each zone separately
                  cleanZone.split(',').forEach(subZone => {
                    processedZones.add(subZone.trim());
                  });
                } else {
                  // Single zone - just add the cleaned version
                  processedZones.add(cleanZone);
                }
              });
              
              // Convert to sorted array and remove any empty strings
              const uniqueZones = [...processedZones].filter(z => z).sort();
              
              // Also create a mapping of how many properties are in each zone
              const zoneCount = {};
              allZones.forEach(zone => {
                const cleanZone = zone.trim();
                if (cleanZone.includes('&')) {
                  cleanZone.split('&').forEach(subZone => {
                    const trimmed = subZone.trim();
                    zoneCount[trimmed] = (zoneCount[trimmed] || 0) + 1;
                  });
                } else if (cleanZone.includes(',')) {
                  cleanZone.split(',').forEach(subZone => {
                    const trimmed = subZone.trim();
                    zoneCount[trimmed] = (zoneCount[trimmed] || 0) + 1;
                  });
                } else {
                  zoneCount[cleanZone] = (zoneCount[cleanZone] || 0) + 1;
                }
              });

              if (uniqueZones.length === 0) {
                return (
                  <div className="text-center py-8 text-gray-500">
                    No zoning data found. Please enter zoning information in the Page by Page Worksheet first.
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-20">Zone</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-20"># Props</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-64">Description</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-32">Min Size (SF)</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-32">Min Frontage (FT)</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-32">Min Depth (FT)</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-40">Depth Table</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueZones.map((zone, index) => {
                        const zoneData = editingZoning[zone] || {};
                        return (
                          <tr key={zone} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-4 py-3 text-sm font-medium">{zone}</td>
                            <td className="px-4 py-3 text-sm text-center text-gray-500">
                              {zoneCount[zone] || 0}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={zoneData.description || ''}
                                onChange={(e) => setEditingZoning(prev => ({
                                  ...prev,
                                  [zone]: { ...prev[zone], description: e.target.value }
                                }))}
                                placeholder="e.g., Residential Single Family"
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={zoneData.min_size || ''}
                                  onChange={(e) => setEditingZoning(prev => ({
                                    ...prev,
                                    [zone]: { ...prev[zone], min_size: e.target.value }
                                  }))}
                                  placeholder={zoneData.minSizeUnit === 'AC' ? "e.g., 2.5" : "e.g., 7500"}
                                  step={zoneData.minSizeUnit === 'AC' ? "0.01" : "1"}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                                />
                                <select
                                  value={zoneData.minSizeUnit || 'SF'}
                                  onChange={(e) => setEditingZoning(prev => ({
                                    ...prev,
                                    [zone]: { ...prev[zone], minSizeUnit: e.target.value }
                                  }))}
                                  className="px-1 py-1 border border-gray-300 rounded text-sm"
                                >
                                  <option value="SF">SF</option>
                                  <option value="AC">AC</option>
                                </select>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={zoneData.min_frontage || ''}
                                onChange={(e) => setEditingZoning(prev => ({
                                  ...prev,
                                  [zone]: { ...prev[zone], min_frontage: e.target.value }
                                }))}
                                placeholder="e.g., 75"
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={zoneData.min_depth || ''}
                                onChange={(e) => setEditingZoning(prev => ({
                                  ...prev,
                                  [zone]: { ...prev[zone], min_depth: e.target.value }
                                }))}
                                placeholder="e.g., 100"
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <select
                                value={zoneData.depth_table || ''}
                                onChange={(e) => setEditingZoning(prev => ({
                                  ...prev,
                                  [zone]: { ...prev[zone], depth_table: e.target.value }
                                }))}
                                className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value="">Select...</option>
                                {availableDepthTables.map(table => (
                                  <option key={table} value={table}>
                                    {table}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="mt-4 text-sm text-gray-600">
                    <strong>Found {uniqueZones.length} unique zoning types</strong> from Page by Page Worksheet
                    <br/>
                    <span className="text-xs text-gray-500">
                      (Compound zones like "AR & C-P" have been split into individual zones)
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Block Detail Modal */}
     {showBlockDetailModal && selectedBlockDetails && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md w-full">
           <div className="flex justify-between items-center mb-4">
             <h3 className="text-lg font-semibold">
               Block {selectedBlockDetails.block} - {
                 selectedBlockDetails.metric === 'age' ? 'Age' :
                 selectedBlockDetails.metric === 'size' ? 'Size' :
                 'Design'
               } Consistency
             </h3>
             <button
               onClick={() => {
                 setShowBlockDetailModal(false);
                 setSelectedBlockDetails(null);
               }}
               className="text-gray-500 hover:text-gray-700"
             >
               <X size={20} />
             </button>
           </div>
           
           {selectedBlockDetails.metric === 'age' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.ageConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.ageConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.ageConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.ageConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Year Range:</span>
                 <span>{selectedBlockDetails.ageDetails.minYear} - {selectedBlockDetails.ageDetails.maxYear}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Average Year:</span>
                 <span>{selectedBlockDetails.ageDetails.avgYear}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Std Deviation:</span>
                 <span>±{selectedBlockDetails.ageDetails.stdDev} years</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.ageConsistency === 'High' ? 
                   'Very uniform age - excellent for comparables' :
                  selectedBlockDetails.ageConsistency === 'Medium' ?
                   'Moderate age variation - group similar ages' :
                  selectedBlockDetails.ageConsistency === 'Low' ?
                   'Wide age variation - careful comparable selection' :
                   'Mixed ages - requires detailed analysis'}
               </div>
             </div>
           )}
           
           {selectedBlockDetails.metric === 'size' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.sizeConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.sizeConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.sizeConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.sizeConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Size Range:</span>
                 <span>{selectedBlockDetails.sizeDetails.minSize.toLocaleString()} - {selectedBlockDetails.sizeDetails.maxSize.toLocaleString()} sf</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Average Size:</span>
                 <span>{selectedBlockDetails.sizeDetails.avgSize.toLocaleString()} sf</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Variation (CV):</span>
                 <span>{selectedBlockDetails.sizeDetails.cv}%</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.sizeConsistency === 'High' ? 
                   'Very uniform sizes - excellent comparables' :
                  selectedBlockDetails.sizeConsistency === 'Medium' ?
                   'Moderate size variation - reasonable comparables' :
                  selectedBlockDetails.sizeConsistency === 'Low' ?
                   'Wide size variation - adjust for size differences' :
                   'Mixed sizes - requires careful analysis'}
               </div>
             </div>
           )}
           
           {selectedBlockDetails.metric === 'design' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.designConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.designConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.designConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.designConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Unique Designs:</span>
                 <span>{selectedBlockDetails.designDetails.uniqueDesigns} types</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Dominant Style:</span>
                 <span>{selectedBlockDetails.designDetails.dominantDesign}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Dominance:</span>
                 <span>{selectedBlockDetails.designDetails.dominantPercent}%</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.designConsistency === 'High' ? 
                   'Very uniform design - excellent comparables' :
                  selectedBlockDetails.designConsistency === 'Medium' ?
                   'Similar designs - good comparable pool' :
                  selectedBlockDetails.designConsistency === 'Low' ?
                   'Varied designs - consider style adjustments' :
                   'Mixed designs - requires detailed analysis'}
               </div>
             </div>
           )}
         </div>
       </div>
     )}  
{/* Save Progress Modal */}
      {isSavingDecisions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Saving Decisions</h3>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{saveProgress.message}</span>
                <span>{saveProgress.current} / {saveProgress.total}</span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${saveProgress.total > 0 
                      ? (saveProgress.current / saveProgress.total * 100) 
                      : 0}%`
                  }}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-center">
              <RefreshCw className="animate-spin text-blue-600" size={20} />
              <span className="ml-2 text-sm text-gray-600">Please wait...</span>
            </div>
          </div>
        </div>
      )}

      {/* Size Normalization Progress Modal */}
      {isProcessingSize && sizeNormProgress.total > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Size Normalization Progress</h3>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{sizeNormProgress.message}</span>
                <span>{sizeNormProgress.current} / {sizeNormProgress.total}</span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(sizeNormProgress.current / sizeNormProgress.total * 100)}%`
                  }}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-center">
              <RefreshCw className="animate-spin text-green-600" size={20} />
              <span className="ml-2 text-sm text-gray-600">Normalizing sizes...</span>
            </div>
          </div>
        </div>
      )}

      {/* Time Normalization Progress Modal */}
      {isProcessingTime && timeNormProgress.total > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Time Normalization Progress</h3>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{timeNormProgress.message}</span>
                <span>{timeNormProgress.current} / {timeNormProgress.total}</span>
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${(timeNormProgress.current / timeNormProgress.total * 100)}%`
                  }}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-center">
              <RefreshCw className="animate-spin text-blue-600" size={20} />
              <span className="ml-2 text-sm text-gray-600">Analyzing sales...</span>
            </div>
          </div>
        </div>
      )}

       </div>
  );
};
export default PreValuationTab;
