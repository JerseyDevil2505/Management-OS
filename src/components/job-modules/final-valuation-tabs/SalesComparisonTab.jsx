import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes, getRawDataForJob } from '../../../lib/supabaseClient';
import { Search, X, Upload, Sliders, FileText, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import AdjustmentsTab from './AdjustmentsTab';
import DetailedAppraisalGrid from './DetailedAppraisalGrid';

const SalesComparisonTab = ({ jobData, properties, hpiData, onUpdateJobCache, isJobContainerLoading = false }) => {
  // ==================== NESTED TAB STATE ====================
  const [activeSubTab, setActiveSubTab] = useState('search');
  const resultsRef = React.useRef(null);
  const detailedResultsRef = React.useRef(null);
  const [codeDefinitions, setCodeDefinitions] = useState(null);
  
  // ==================== SUBJECT PROPERTIES STATE ====================
  const [subjectVCS, setSubjectVCS] = useState([]);
  const [subjectTypeUse, setSubjectTypeUse] = useState([]);
  const [manualProperties, setManualProperties] = useState([]);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [manualBlockLot, setManualBlockLot] = useState({ block: '', lot: '', qualifier: '' });
  const [pendingBlockLotRows, setPendingBlockLotRows] = useState([]); // Inline editable rows
  
  // ==================== COMPARABLE FILTERS STATE ====================
  // Calculate CSP date range on mount
  const getCSPDateRange = useCallback(() => {
    if (!jobData?.end_date) return { start: '', end: '' };
    const assessmentYear = new Date(jobData.end_date).getFullYear();
    return {
      start: new Date(assessmentYear - 1, 9, 1).toISOString().split('T')[0], // 10/1 prior-prior year
      end: new Date(assessmentYear, 11, 31).toISOString().split('T')[0] // 12/31 prior year
    };
  }, [jobData?.end_date]);

  const cspDateRange = useMemo(() => getCSPDateRange(), [getCSPDateRange]);

  const [compFilters, setCompFilters] = useState({
    adjustmentBracket: '', // '' (unselected), 'auto', or 'bracket_0', 'bracket_1', etc.
    autoAdjustment: false, // Auto checkbox - default OFF
    salesCodes: ['00', '07', '32', '36'], // CSP default codes
    salesDateStart: cspDateRange.start,
    salesDateEnd: cspDateRange.end,
    vcs: [],
    sameVCS: true, // Default checked
    neighborhood: [],
    sameNeighborhood: false,
    // Lot Size filter
    lotAcreMin: '',
    lotAcreMax: '',
    sameLotSize: false, // OR Similar Lot Size
    // Year Built filter
    builtWithinYears: 25,
    useBuiltRange: false,
    builtYearMin: '',
    builtYearMax: '',
    // Size (SFLA) filter
    sizeWithinSqft: 500,
    useSizeRange: false,
    sizeMin: '',
    sizeMax: '',
    // Attribute filters
    zone: [],
    sameZone: false,
    buildingClass: [],
    sameBuildingClass: false,
    typeUse: [],
    sameTypeUse: true, // Default checked
    style: [],
    sameStyle: true, // Default checked
    storyHeight: [],
    sameStoryHeight: false,
    view: [],
    sameView: false,
    // Tolerance filters
    individualAdjPct: 0,
    netAdjPct: 0,
    grossAdjPct: 0,
    farmSalesMode: true // When enabled, farm subjects only compare to farm comps and use combined 3A+3B lot size
  });
  
  // ==================== EVALUATION STATE ====================
  const [evaluationMode, setEvaluationMode] = useState('fresh'); // 'fresh' or 'keep'
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState({ current: 0, total: 0 });
  const [evaluationResults, setEvaluationResults] = useState(null);
  const [savedEvaluations, setSavedEvaluations] = useState([]); // Set-aside evaluations from DB
  const [savedResultSets, setSavedResultSets] = useState([]); // Named result sets from DB
  const [adjustmentGrid, setAdjustmentGrid] = useState([]);
  const [customBrackets, setCustomBrackets] = useState([]);
  const [bracketMappings, setBracketMappings] = useState([]);
  const [minCompsForSuccess, setMinCompsForSuccess] = useState(3); // User-selectable threshold

  // Manual entry state for detailed tab
  const [manualSubject, setManualSubject] = useState({ block: '', lot: '', qualifier: '' });
  const [manualComps, setManualComps] = useState([
    { block: '', lot: '', qualifier: '' },
    { block: '', lot: '', qualifier: '' },
    { block: '', lot: '', qualifier: '' },
    { block: '', lot: '', qualifier: '' },
    { block: '', lot: '', qualifier: '' }
  ]);
  const [manualEvaluationResult, setManualEvaluationResult] = useState(null);
  const [isManualEvaluating, setIsManualEvaluating] = useState(false);

  const vendorType = jobData?.vendor_type || 'BRT';

  // ==================== CODE CONFIGURATION ====================
  const [codeConfig, setCodeConfig] = useState({
    miscellaneous: [],
    land_positive: [],
    land_negative: []
  });

  // ==================== GARAGE THRESHOLDS ====================
  const [garageThresholds, setGarageThresholds] = useState({
    one_car_max: 399,
    two_car_max: 799,
    three_car_max: 999
  });

  // Detached item condition multipliers
  const [detachedConditionMultipliers, setDetachedConditionMultipliers] = useState({
    poor_threshold: 0.25,
    poor_multiplier: 0.50,
    standard_multiplier: 1.00,
    excellent_threshold: 0.75,
    excellent_multiplier: 1.25
  });

  // Helper: Convert garage square footage to category number
  const getGarageCategory = useCallback((sqft) => {
    if (!sqft || sqft === 0) return 0; // NONE
    if (sqft <= garageThresholds.one_car_max) return 1; // ONE CAR
    if (sqft <= garageThresholds.two_car_max) return 2; // TWO CAR
    if (sqft <= garageThresholds.three_car_max) return 3; // THREE CAR
    return 4; // MULTI CAR
  }, [garageThresholds]);

  // Load garage thresholds and detached condition multipliers on mount
  useEffect(() => {
    const loadThresholds = async () => {
      if (!jobData?.id) return;

      try {
        const { data, error } = await supabase
          .from('job_settings')
          .select('setting_key, setting_value')
          .eq('job_id', jobData.id)
          .in('setting_key', [
            'garage_threshold_one_car_max',
            'garage_threshold_two_car_max',
            'garage_threshold_three_car_max',
            'detached_condition_poor_threshold',
            'detached_condition_poor_multiplier',
            'detached_condition_standard_multiplier',
            'detached_condition_excellent_threshold',
            'detached_condition_excellent_multiplier'
          ]);

        if (error || !data) return;

        const newGarageThresholds = { ...garageThresholds };
        const newConditionMultipliers = { ...detachedConditionMultipliers };

        data.forEach(setting => {
          if (setting.setting_key.startsWith('garage_threshold_')) {
            const key = setting.setting_key.replace('garage_threshold_', '');
            newGarageThresholds[key] = parseInt(setting.setting_value, 10) || garageThresholds[key];
          } else if (setting.setting_key.startsWith('detached_condition_')) {
            const key = setting.setting_key.replace('detached_condition_', '');
            newConditionMultipliers[key] = parseFloat(setting.setting_value) || detachedConditionMultipliers[key];
          }
        });

        setGarageThresholds(newGarageThresholds);
        setDetachedConditionMultipliers(newConditionMultipliers);
      } catch (error) {
        // Silent error handling - don't interfere with job loading
        console.warn('⚠️ Thresholds loading error (non-critical):', error.message || error);
      }
    };

    // Wait for property loading to complete before loading settings
    if (!isJobContainerLoading) {
      loadThresholds();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, isJobContainerLoading]);

  // Load code configuration on mount
  useEffect(() => {
    const loadCodeConfig = async () => {
      if (!jobData?.id) return;

      try {
        const { data, error} = await supabase
          .from('job_settings')
          .select('setting_key, setting_value')
          .eq('job_id', jobData.id)
          .in('setting_key', ['adjustment_codes_miscellaneous', 'adjustment_codes_land_positive', 'adjustment_codes_land_negative']);

        if (error || !data) return;

        const newConfig = { ...codeConfig };
        data.forEach(setting => {
          const key = setting.setting_key.replace('adjustment_codes_', '');
          try {
            newConfig[key] = setting.setting_value ? JSON.parse(setting.setting_value) : [];
          } catch (e) {
            newConfig[key] = [];
          }
        });
        setCodeConfig(newConfig);
        console.log('✅ Loaded code configuration:', newConfig);
      } catch (error) {
        // Silent error handling - don't interfere with job loading
        console.warn('⚠️ Code config loading error (non-critical):', error.message || error);
      }
    };

    // Wait for property loading to complete before loading settings
    if (!isJobContainerLoading) {
      loadCodeConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, isJobContainerLoading]);

  // ==================== SALES CODE NORMALIZATION ====================
  const normalizeSalesCode = useCallback((code) => {
    if (code === null || code === undefined || code === '' || code === '00') return '';
    return String(code).trim();
  }, []);

  // ==================== CME PRICE BRACKETS ====================
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'up to $99,999' },
    { min: 100000, max: 199999, label: '$100,000-$199,999' },
    { min: 200000, max: 299999, label: '$200,000-$299,999' },
    { min: 300000, max: 399999, label: '$300,000-$399,999' },
    { min: 400000, max: 499999, label: '$400,000-$499,999' },
    { min: 500000, max: 749999, label: '$500,000-$749,999' },
    { min: 750000, max: 999999, label: '$750,000-$999,999' },
    { min: 1000000, max: 1499999, label: '$1,000,000-$1,499,999' },
    { min: 1500000, max: 1999999, label: '$1,500,000-$1,999,999' },
    { min: 2000000, max: 99999999, label: 'Over $2,000,000' }
  ];

  // ==================== LOAD ADJUSTMENT GRID AND CUSTOM BRACKETS ====================
  useEffect(() => {
    if (jobData?.id) {
      loadAdjustmentGrid();
      loadCustomBrackets();
      loadCodeDefinitions();
      loadSavedEvaluations();
      loadSavedResultSets();
      loadBracketMappings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id]);

  // Load existing set_aside evaluations from database
  const loadSavedEvaluations = async () => {
    try {
      const { data, error } = await supabase
        .from('job_cme_evaluations')
        .select('*')
        .eq('job_id', jobData.id)
        .eq('status', 'set_aside');

      if (error) throw error;

      if (data && data.length > 0) {
        setSavedEvaluations(data);
        console.log(`📌 Loaded ${data.length} set-aside evaluations`);
      }
    } catch (error) {
      console.warn('⚠️ Error loading saved evaluations:', error.message);
    }
  };

  // Load saved result sets from database
  const loadSavedResultSets = async () => {
    try {
      const { data, error } = await supabase
        .from('job_cme_result_sets')
        .select('id, name, adjustment_bracket, created_at')
        .eq('job_id', jobData.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSavedResultSets(data || []);
    } catch (error) {
      console.warn('⚠️ Error loading saved result sets:', error.message);
    }
  };

  // Save current result set with a user-provided name
  const handleSaveResultSet = async () => {
    if (!evaluationResults || evaluationResults.length === 0) return;

    const name = window.prompt('Enter a name for this result set:');
    if (!name || !name.trim()) return;

    try {
      // Serialize results for storage - preserve all property fields so loaded results
      // can be displayed in DetailedAppraisalGrid with full attribute data (VCS, year built,
      // bathrooms, building class, style, conditions, lot size, etc.)
      const serializedResults = evaluationResults.map(r => ({
        subject: { ...r.subject },
        comparables: r.comparables.map(c => ({
          ...c,
          isSubjectSale: c.isSubjectSale || false,
          weight: c.weight || 0,
        })),
        totalFound: r.totalFound,
        totalValid: r.totalValid,
        projectedAssessment: r.projectedAssessment,
        confidenceScore: r.confidenceScore,
        hasSubjectSale: r.hasSubjectSale,
      }));

      const { error } = await supabase
        .from('job_cme_result_sets')
        .insert({
          job_id: jobData.id,
          name: name.trim(),
          adjustment_bracket: compFilters.adjustmentBracket,
          search_criteria: compFilters,
          results: serializedResults,
        });

      if (error) throw error;

      alert(`Result set "${name.trim()}" saved successfully!`);
      await loadSavedResultSets();
    } catch (error) {
      console.error('Error saving result set:', error);
      alert(`Failed to save result set: ${error.message}`);
    }
  };

  // Load a saved result set by ID
  const handleLoadResultSet = async (setId) => {
    if (!setId) return;

    try {
      const { data, error } = await supabase
        .from('job_cme_result_sets')
        .select('*')
        .eq('id', setId)
        .single();

      if (error) throw error;

      // Restore results
      setEvaluationResults(data.results);

      // Restore adjustment bracket
      if (data.adjustment_bracket) {
        setCompFilters(prev => ({
          ...prev,
          adjustmentBracket: data.adjustment_bracket,
          autoAdjustment: data.adjustment_bracket === 'auto',
        }));
      }

      // Scroll to results
      requestAnimationFrame(() => {
        if (resultsRef.current) {
          resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } catch (error) {
      console.error('Error loading result set:', error);
      alert(`Failed to load result set: ${error.message}`);
    }
  };

  // Delete a saved result set
  const handleDeleteResultSet = async (setId, setName) => {
    if (!window.confirm(`Delete saved result set "${setName}"?`)) return;

    try {
      const { error } = await supabase
        .from('job_cme_result_sets')
        .delete()
        .eq('id', setId);

      if (error) throw error;
      await loadSavedResultSets();
    } catch (error) {
      console.error('Error deleting result set:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const loadBracketMappings = async () => {
    try {
      const { data, error } = await supabase
        .from('job_cme_bracket_mappings')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');
      if (error) throw error;
      setBracketMappings(data || []);
    } catch (error) {
      console.warn('Bracket mappings loading error:', error.message);
    }
  };

  // Look up bracket mapping for a property (returns { bracket, searchScope } or null)
  const getBracketMapping = (property) => {
    if (!bracketMappings || bracketMappings.length === 0) return null;
    const propVCS = property.property_vcs || '';
    const propTypeUse = property.asset_type_use || '';
    for (const mapping of bracketMappings) {
      const vcsMatch = !mapping.vcs_codes || mapping.vcs_codes.length === 0 || mapping.vcs_codes.includes(propVCS);
      const tuMatch = !mapping.type_use_codes || mapping.type_use_codes.length === 0 || mapping.type_use_codes.includes(propTypeUse);
      if (vcsMatch && tuMatch) {
        return { bracket: mapping.bracket_value, searchScope: mapping.search_scope };
      }
    }
    return null;
  };

  const loadAdjustmentGrid = async () => {
    try {
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;

      console.log(`🔄 Loaded adjustment grid: ${data?.length || 0} entries`);
      if (data && data.length > 0) {
        console.log(`📋 Sample entry:`, data[0]);
      } else {
        console.warn(`⚠️  No adjustment data found in database for job ${jobData.id}`);
        console.warn(`   Have you saved adjustments in the Adjustments tab?`);
      }

      setAdjustmentGrid(data || []);
    } catch (error) {
      console.error('❌ Error loading adjustment grid:', error);
    }
  };

  const loadCustomBrackets = async () => {
    try {
      const { data, error } = await supabase
        .from('job_custom_brackets')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;
      setCustomBrackets(data || []);
    } catch (error) {
      console.error('Error loading custom brackets:', error);
    }
  };

  const loadCodeDefinitions = async () => {
    try {
      const rawData = await getRawDataForJob(jobData.id);
      if (rawData?.codeDefinitions || rawData?.parsed_code_definitions) {
        const codes = rawData.codeDefinitions || rawData.parsed_code_definitions;
        setCodeDefinitions(codes);
        console.log('✅ Loaded code definitions:', {
          totalCodes: codes.summary?.total_codes,
          parsedAt: codes.summary?.parsed_at,
          parsingMethod: codes.summary?.parsing_method,
          storyHeightCodes: codes.field_codes?.['510'] ? Object.keys(codes.field_codes['510']) : 'N/A'
        });
      } else {
        console.warn('⚠️ No code definitions found for job');
      }
    } catch (error) {
      console.error('❌ Error loading code definitions:', error);
    }
  };

  // Reload adjustment grid and code definitions when switching tabs (in case they were updated)
  useEffect(() => {
    if ((activeSubTab === 'search' || activeSubTab === 'detailed') && jobData?.id) {
      console.log(`🔄 Switched to ${activeSubTab} tab - reloading adjustment grid and code definitions...`);
      loadAdjustmentGrid();
      loadCustomBrackets();
      loadCodeDefinitions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, jobData?.id]);

  // ==================== EXTRACT UNIQUE VALUES ====================
  const uniqueVCS = useMemo(() => {
    const vcsSet = new Set();
    properties.forEach(p => {
      if (p.property_vcs) vcsSet.add(p.property_vcs);
    });
    return Array.from(vcsSet).sort();
  }, [properties]);

  const uniqueTypeUse = useMemo(() => {
    const typeSet = new Set();
    properties.forEach(p => {
      if (p.asset_type_use) typeSet.add(p.asset_type_use);
    });
    return Array.from(typeSet).sort();
  }, [properties]);

  const uniqueSalesCodes = useMemo(() => {
    const codeSet = new Set();
    properties.forEach(p => {
      if (p.sales_nu) codeSet.add(p.sales_nu);
    });
    return Array.from(codeSet).sort();
  }, [properties]);

  const uniqueNeighborhood = useMemo(() => {
    // Assuming neighborhood data exists
    const nbSet = new Set();
    properties.forEach(p => {
      if (p.asset_neighborhood) nbSet.add(p.asset_neighborhood);
    });
    return Array.from(nbSet).sort();
  }, [properties]);

  const uniqueZone = useMemo(() => {
    const zoneSet = new Set();
    properties.forEach(p => {
      if (p.asset_zoning) zoneSet.add(p.asset_zoning);
    });
    return Array.from(zoneSet).sort();
  }, [properties]);

  const uniqueBuildingClass = useMemo(() => {
    const classSet = new Set();
    properties.forEach(p => {
      if (p.asset_building_class) classSet.add(p.asset_building_class);
    });
    return Array.from(classSet).sort();
  }, [properties]);

  const uniqueStyle = useMemo(() => {
    const styleSet = new Set();
    properties.forEach(p => {
      if (p.asset_design_style) styleSet.add(p.asset_design_style);
    });
    return Array.from(styleSet).sort();
  }, [properties]);

  const uniqueStoryHeight = useMemo(() => {
    const storySet = new Set();
    properties.forEach(p => {
      if (p.asset_story_height) storySet.add(p.asset_story_height);
    });
    return Array.from(storySet).sort();
  }, [properties]);

  const uniqueView = useMemo(() => {
    const viewSet = new Set();
    properties.forEach(p => {
      if (p.asset_view) viewSet.add(p.asset_view);
    });
    return Array.from(viewSet).sort();
  }, [properties]);

  // ==================== HANDLE CHIP TOGGLES ====================
  const toggleChip = (array, setter) => (value) => {
    if (array.includes(value)) {
      setter(array.filter(v => v !== value));
    } else {
      setter([...array, value]);
    }
  };

  const toggleCompFilterChip = (field) => (value) => {
    if (compFilters[field].includes(value)) {
      setCompFilters(prev => ({
        ...prev,
        [field]: prev[field].filter(v => v !== value)
      }));
    } else {
      setCompFilters(prev => ({
        ...prev,
        [field]: [...prev[field], value]
      }));
    }
  };

  // ==================== MANUAL PROPERTY ENTRY ====================
  const handleAddManualProperty = () => {
    if (!manualBlockLot.block || !manualBlockLot.lot) {
      alert('Please enter both Block and Lot');
      return;
    }

    const compositeKey = `${manualBlockLot.block}-${manualBlockLot.lot}-${manualBlockLot.qualifier || ''}`;
    
    if (manualProperties.includes(compositeKey)) {
      alert('This property is already added');
      return;
    }

    setManualProperties(prev => [...prev, compositeKey]);
    setManualBlockLot({ block: '', lot: '', qualifier: '' });
    setShowManualEntryModal(false);
  };

  const handleImportExcel = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Assuming columns: Block, Lot, Qualifier
        const imported = jsonData.map(row => {
          const block = row.Block || row.block || '';
          const lot = row.Lot || row.lot || '';
          const qualifier = row.Qualifier || row.qualifier || row.Qual || '';
          return `${block}-${lot}-${qualifier}`.trim();
        }).filter(key => key && key !== '--');

        setManualProperties(prev => {
          const combined = [...new Set([...prev, ...imported])];
          return combined;
        });

        alert(`Imported ${imported.length} properties`);
      } catch (error) {
        console.error('Error importing Excel:', error);
        alert('Failed to import Excel file');
      }
    };
    input.click();
  };

  // ==================== SET ASIDE SUCCESSFUL ====================
  const handleSetAsideSuccessful = async () => {
    if (!evaluationResults) return;

    const successful = evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess);

    if (successful.length === 0) {
      alert(`No properties with ${minCompsForSuccess}+ comparables to set aside`);
      return;
    }

    try {
      // Insert set-aside records into database
      const setAsideRecords = successful.map(r => ({
        job_id: jobData.id,
        subject_property_id: r.subject.id,
        subject_pams: r.subject.property_composite_key,
        subject_address: r.subject.property_location,
        search_criteria: compFilters,
        comparables: r.comparables.map(c => ({
          property_id: c.id,
          pams_id: c.property_composite_key,
          address: c.property_location,
          rank: c.rank,
          adjustedPrice: c.adjustedPrice,
          adjustmentPercent: c.adjustmentPercent,
        })),
        projected_assessment: r.projectedAssessment,
        confidence_score: r.confidenceScore,
        status: 'set_aside'
      }));

      const { error } = await supabase
        .from('job_cme_evaluations')
        .insert(setAsideRecords);

      if (error) throw error;

      // Reload saved evaluations to include newly set-aside ones
      await loadSavedEvaluations();

      // Remove set-aside properties from current results display
      const remainingResults = evaluationResults.filter(r => r.comparables.length < minCompsForSuccess);

      alert(`${successful.length} properties set aside successfully. ${remainingResults.length} properties remain for re-evaluation.`);

      // Update results to show only remaining
      setEvaluationResults(remainingResults.length > 0 ? remainingResults : null);

      // Auto-switch to 'keep' mode since user now has saved results
      setEvaluationMode('keep');

    } catch (error) {
      console.error('Error setting aside properties:', error);
      alert(`Failed to set aside properties: ${error.message}`);
    }
  };

  // ==================== HELPER: AGGREGATE PROPERTY DATA ACROSS CARDS ====================
  // Helper to check if a card identifier is a main card
  const isMainCard = (cardValue) => {
    const card = (cardValue || '').toString().trim();
    if (vendorType === 'Microsystems') {
      const cardUpper = card.toUpperCase();
      return cardUpper === 'M' || cardUpper === 'MAIN' || cardUpper === '';
    } else { // BRT
      const cardNum = parseInt(card);
      return cardNum === 1 || card === '' || isNaN(cardNum);
    }
  };

  // Helper to get all cards for a property (main + additional)
  const getPropertyCards = (prop) => {
    if (!prop) return [prop];
    const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
    return properties.filter(p => {
      const pBaseKey = `${p.property_block || ''}-${p.property_lot || ''}-${p.property_qualifier || ''}`;
      return pBaseKey === baseKey;
    });
  };

  // Helper to aggregate data across all cards for a property
  const aggregatePropertyData = (prop) => {
    const allCards = getPropertyCards(prop);
    if (allCards.length <= 1) return prop; // No additional cards, return as-is

    const aggregated = { ...prop };

    // SUM fields
    const sumFields = [
      'asset_sfla', 'total_baths_calculated', 'asset_bathrooms', 'asset_bedrooms',
      'fireplace_count', 'asset_fireplaces', 'basement_area', 'fin_basement_area',
      'garage_area', 'det_garage_area', 'deck_area', 'patio_area', 'pool_area',
      'open_porch_area', 'enclosed_porch_area', 'barn_area', 'stable_area', 'pole_barn_area', 'ac_area'
    ];

    sumFields.forEach(field => {
      const total = allCards.reduce((sum, card) => sum + (parseFloat(card[field]) || 0), 0);
      if (total > 0) aggregated[field] = total;
    });

    // AVERAGE: year_built
    const validYears = allCards
      .map(card => parseInt(card.asset_year_built))
      .filter(year => year > 1800 && year <= new Date().getFullYear());
    if (validYears.length > 0) {
      aggregated.asset_year_built = Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length);
    }

    // OR logic for boolean amenities
    const booleanFields = [
      'asset_basement', 'asset_fin_basement', 'asset_ac', 'asset_deck',
      'asset_patio', 'asset_open_porch', 'asset_enclosed_porch', 'asset_pool'
    ];

    booleanFields.forEach(field => {
      const hasAny = allCards.some(card => card[field] && card[field] !== 'No' && card[field] !== 'NONE');
      aggregated[field] = hasAny;
    });

    aggregated._additionalCardsCount = allCards.filter(p => !isMainCard(p.property_addl_card || p.additional_card)).length;

    return aggregated;
  };

  // ==================== MANUAL BLQ EVALUATION (DETAILED TAB) ====================
  const handleManualEvaluate = async () => {
    setIsManualEvaluating(true);

    try {
      // Fetch subject property
      if (!manualSubject.block || !manualSubject.lot) {
        alert('Please enter Block and Lot for the subject property');
        setIsManualEvaluating(false);
        return;
      }

      // Find subject by block, lot, qualifier (normalize for comparison)
      const subjectRaw = properties.find(p => {
        const blockMatch = (p.property_block || '').trim().toUpperCase() === manualSubject.block.trim().toUpperCase();
        const lotMatch = (p.property_lot || '').trim().toUpperCase() === manualSubject.lot.trim().toUpperCase();
        const qualMatch = (p.property_qualifier || '').trim().toUpperCase() === (manualSubject.qualifier || '').trim().toUpperCase();
        return blockMatch && lotMatch && qualMatch;
      });

      if (!subjectRaw) {
        alert(`Subject property not found: Block ${manualSubject.block}, Lot ${manualSubject.lot}${manualSubject.qualifier ? `, Qual ${manualSubject.qualifier}` : ''}\n\nMake sure the property exists in this job.`);
        setIsManualEvaluating(false);
        return;
      }

      // Aggregate subject data across all cards (main + additional)
      const subject = aggregatePropertyData(subjectRaw);

      // Fetch comparables
      const fetchedComps = [];
      const notFoundEntries = [];
      const noSalesDataEntries = [];

      for (const compEntry of manualComps) {
        if (compEntry.block && compEntry.lot) {
          const compRaw = properties.find(p => {
            const blockMatch = (p.property_block || '').trim().toUpperCase() === compEntry.block.trim().toUpperCase();
            const lotMatch = (p.property_lot || '').trim().toUpperCase() === compEntry.lot.trim().toUpperCase();
            const qualMatch = (p.property_qualifier || '').trim().toUpperCase() === (compEntry.qualifier || '').trim().toUpperCase();
            return blockMatch && lotMatch && qualMatch;
          });

          if (!compRaw) {
            // Property not found in database
            notFoundEntries.push(`Block ${compEntry.block} Lot ${compEntry.lot}${compEntry.qualifier ? ` Qual ${compEntry.qualifier}` : ''}`);
          } else if (!compRaw.sales_price && !compRaw.values_norm_time) {
            // Property found but no sales data
            noSalesDataEntries.push(`Block ${compEntry.block} Lot ${compEntry.lot} (${compRaw.property_location || 'N/A'})`);
          } else {
            // Aggregate comp data across all cards (main + additional)
            const comp = aggregatePropertyData(compRaw);

            // Use time-normalized value if available, otherwise fall back to sales price
            const compValue = comp.values_norm_time || comp.sales_price;

            // Calculate adjustments using aggregated data
            const { adjustments, totalAdjustment, adjustedPrice, adjustmentPercent } =
              calculateAllAdjustments(subject, { ...comp, values_norm_time: compValue });

            const grossAdjustment = adjustments.reduce((sum, adj) => sum + Math.abs(adj.amount), 0);
            const grossAdjustmentPercent = compValue > 0
              ? (grossAdjustment / compValue) * 100
              : 0;

            fetchedComps.push({
              ...comp,
              adjustments,
              totalAdjustment,
              grossAdjustment,
              grossAdjustmentPercent,
              adjustedPrice,
              adjustmentPercent,
              rank: fetchedComps.length + 1,
              weight: 0 // Will be calculated below
            });
          }
        }
      }

      // Show warnings for properties not found or missing sales data
      if (notFoundEntries.length > 0 || noSalesDataEntries.length > 0) {
        let warningMessage = '';
        if (notFoundEntries.length > 0) {
          warningMessage += `⚠️ Properties NOT FOUND in database:\n${notFoundEntries.join('\n')}\n\n`;
        }
        if (noSalesDataEntries.length > 0) {
          warningMessage += `⚠️ Properties found but have NO SALES DATA:\n${noSalesDataEntries.join('\n')}`;
        }
        alert(warningMessage.trim());
      }

      // Calculate weights and projected assessment
      let projectedAssessment = null;
      let confidenceScore = 0;

      if (fetchedComps.length >= 1) {
        const totalInverseAdjPct = fetchedComps.reduce((sum, comp) => {
          return sum + (1 / (Math.abs(comp.adjustmentPercent) + 1));
        }, 0);

        fetchedComps.forEach(comp => {
          comp.weight = (1 / (Math.abs(comp.adjustmentPercent) + 1)) / totalInverseAdjPct;
        });

        projectedAssessment = fetchedComps.reduce((sum, comp) => {
          return sum + (comp.adjustedPrice * comp.weight);
        }, 0);

        const avgAdjPct = fetchedComps.reduce((sum, c) => sum + Math.abs(c.adjustmentPercent), 0) / fetchedComps.length;
        confidenceScore = Math.max(0, Math.min(100,
          (fetchedComps.length / 5) * 100 - (avgAdjPct * 2)
        ));
      }

      setManualEvaluationResult({
        subject,
        comparables: fetchedComps,
        projectedAssessment: projectedAssessment ? Math.round(projectedAssessment) : null,
        confidenceScore: Math.round(confidenceScore),
        hasSubjectSale: false
      });

      console.log(`✅ Manual evaluation complete: ${fetchedComps.length} comps found`);

      // Auto-scroll to results after a short delay to allow rendering
      setTimeout(() => {
        if (detailedResultsRef.current) {
          detailedResultsRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }, 100);

    } catch (error) {
      console.error('Error in manual evaluation:', error);
      alert(`Evaluation failed: ${error.message}`);
    } finally {
      setIsManualEvaluating(false);
    }
  };

  const handleClearManualComps = () => {
    setManualSubject({ block: '', lot: '', qualifier: '' });
    setManualComps([
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' }
    ]);
    setManualEvaluationResult(null);
  };

  // ==================== EVALUATE COMPARABLES ====================
  const handleEvaluate = async () => {
    // Validate: adjustment bracket must be selected
    if (!compFilters.adjustmentBracket) {
      alert('Please select an Adjustment Bracket before evaluating.');
      return;
    }

    setIsEvaluating(true);
    setEvaluationProgress({ current: 0, total: 0 });

    try {
      // Step 1: Determine subject properties
      // HARD RULE: Only evaluate properties with building_class > 10
      // This excludes commercial (1-4), exempt (15A/B/C), and vacant land (1)
      const isResidentialProperty = (p) => {
        const buildingClass = parseInt(p.asset_building_class) || 0;
        return buildingClass > 10;
      };

      let subjects = [];

      if (manualProperties.length > 0) {
        // Use manually entered properties (still enforce building_class > 10)
        subjects = properties.filter(p =>
          manualProperties.includes(p.property_composite_key) && isResidentialProperty(p)
        );
      } else {
        // Use VCS + Type/Use filters
        subjects = properties.filter(p => {
          // Must be residential (building_class > 10)
          if (!isResidentialProperty(p)) return false;
          if (subjectVCS.length > 0 && !subjectVCS.includes(p.property_vcs)) return false;
          if (subjectTypeUse.length > 0 && !subjectTypeUse.includes(p.asset_type_use)) return false;
          return true;
        });
      }

      if (subjects.length === 0) {
        alert('No subject properties match your criteria.\n\nNote: Only residential properties (Class 2+) can be evaluated. Commercial, exempt, and vacant land are excluded.');
        setIsEvaluating(false);
        setEvaluationProgress({ current: 0, total: 0 });
        return;
      }

      console.log(`🔍 Found ${subjects.length} subject properties matching criteria`);

      // Handle evaluation mode: fresh vs keep
      if (evaluationMode === 'fresh') {
        // Delete ALL existing evaluations for this job
        const { error: deleteError } = await supabase
          .from('job_cme_evaluations')
          .delete()
          .eq('job_id', jobData.id);

        if (deleteError) {
          console.error('Error clearing evaluations:', deleteError);
        } else {
          console.log('🗑️ Cleared all previous evaluations (fresh mode)');
        }
        setSavedEvaluations([]);
      } else {
        // Keep mode: exclude properties that already have set_aside results
        const setAsidePropertyIds = new Set(
          savedEvaluations.map(e => e.subject_property_id)
        );
        const totalBefore = subjects.length;
        subjects = subjects.filter(s => !setAsidePropertyIds.has(s.id));
        const excluded = totalBefore - subjects.length;

        console.log(`📌 Keep mode: ${excluded} properties already set aside, ${subjects.length} remaining to evaluate`);

        if (subjects.length === 0) {
          alert(`All matching properties already have saved results (${excluded} set aside).\n\nSwitch to "Fresh evaluation" to re-evaluate them, or adjust your "What" criteria to target different properties.`);
          setIsEvaluating(false);
          setEvaluationProgress({ current: 0, total: 0 });
          return;
        }

        // Delete only non-set-aside evaluations for remaining subjects (re-evaluate them)
        const remainingIds = subjects.map(s => s.id);
        const { error: deleteError } = await supabase
          .from('job_cme_evaluations')
          .delete()
          .eq('job_id', jobData.id)
          .in('subject_property_id', remainingIds)
          .neq('status', 'set_aside');

        if (deleteError) {
          console.error('Error clearing non-saved evaluations:', deleteError);
        }
      }

      console.log(`🔍 Evaluating ${subjects.length} subject properties...`);

      // Step 2: Get eligible sales (from Sales Review logic)
      const eligibleSales = getEligibleSales();
      console.log(`📊 Found ${eligibleSales.length} eligible sales (CSP period)`);

      if (eligibleSales.length === 0) {
        alert(`No eligible sales found for comparison.\n\nThe CSP period (${compFilters.salesDateStart} to ${compFilters.salesDateEnd}) has no valid sales with time-adjusted prices.\n\nPlease check your Sales Review tab or adjust your date range.`);
        setIsEvaluating(false);
        setEvaluationProgress({ current: 0, total: 0 });
        return;
      }

      // Log adjustment configuration
      const bracketLabel = compFilters.adjustmentBracket === 'auto' ? 'auto' :
        compFilters.adjustmentBracket?.startsWith('bracket_') ?
        CME_BRACKETS[parseInt(compFilters.adjustmentBracket.replace('bracket_', ''))]?.label || compFilters.adjustmentBracket :
        compFilters.adjustmentBracket;

      console.log(`📊 Adjustment Configuration:`);
      console.log(`   - Grid entries: ${adjustmentGrid.length}`);
      console.log(`   - Selected bracket: ${compFilters.adjustmentBracket} (${bracketLabel})`);
      console.log(`   - Custom brackets: ${customBrackets.length}`);

      if (adjustmentGrid.length === 0) {
        console.warn(`⚠️  WARNING: No adjustment grid entries found!`);
        console.warn(`   All adjustments will be $0. Configure adjustments in the Adjustments tab first.`);
      }

      // Note: Evaluation can proceed even without adjustment grid - comps will have $0 adjustments
      // This allows users to see comp matches before setting up adjustments

      // Step 3: Pre-aggregate all eligible sales across cards (main + additional)
      // This ensures filters AND adjustments use correct totals for multi-card properties
      const aggregatedSales = eligibleSales.map(s => aggregatePropertyData(s));
      console.log(`📊 Aggregated ${aggregatedSales.length} eligible sales (multi-card data merged)`);

      // Step 4: For each subject, find matching comparables
      const results = [];
      setEvaluationProgress({ current: 0, total: subjects.length });

      // Process in batches for UI progress updates
      const BATCH_SIZE = 25;

      // Pre-check: if Auto mode with bracket mappings, log mapping info
      const isAutoWithMappings = compFilters.adjustmentBracket === 'auto' && bracketMappings.length > 0;
      if (isAutoWithMappings) {
        console.log(`🗺️ Auto mode with ${bracketMappings.length} bracket mapping(s) active`);
      }

      for (let i = 0; i < subjects.length; i++) {
        // Aggregate subject data across all cards (main + additional)
        const subject = aggregatePropertyData(subjects[i]);

        // Resolve bracket mapping for this subject (Auto mode with mappings)
        const subjectMapping = isAutoWithMappings ? getBracketMapping(subject) : null;

        // Update progress counter
        setEvaluationProgress({ current: i + 1, total: subjects.length });

        // Yield to UI every batch so counter updates
        if (i % BATCH_SIZE === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        // Debug: Log first property's matching process
        const isFirstProperty = i === 0;
        if (isFirstProperty) {
          console.log(`\n🔍 DEBUG: Matching comps for first subject property:`);
          console.log(`   Subject: ${subject.property_block}-${subject.property_lot}`);
          console.log(`   VCS: ${subject.property_vcs}, Type: ${subject.asset_type_use}`);
          console.log(`   Year Built: ${subject.asset_year_built}, SFLA: ${subject.asset_sfla}`);
          console.log(`   Eligible sales pool: ${eligibleSales.length}`);
          if (subjectMapping) {
            console.log(`   🗺️ Mapped bracket: ${subjectMapping.bracket}, scope: ${subjectMapping.searchScope}`);
          }
        }

        let debugFilters = {
          self: 0,
          salesCodes: 0,
          salesDate: 0,
          vcs: 0,
          neighborhood: 0,
          yearBuilt: 0,
          size: 0,
          zone: 0,
          buildingClass: 0,
          typeUse: 0,
          style: 0,
          storyHeight: 0,
          view: 0,
          passed: 0
        };

        const matchingComps = aggregatedSales.filter(comp => {
          // Exclude self
          if (comp.property_composite_key === subject.property_composite_key) {
            if (isFirstProperty) debugFilters.self++;
            return false;
          }

          // Sales codes filter (normalize blank, '00', '0' to '')
          if (compFilters.salesCodes.length > 0) {
            const normalizedCompCode = normalizeSalesCode(comp.sales_nu);
            const normalizedFilterCodes = compFilters.salesCodes.map(normalizeSalesCode);
            if (!normalizedFilterCodes.includes(normalizedCompCode)) {
              if (isFirstProperty) debugFilters.salesCodes++;
              return false;
            }
          }

          // Sales date range
          if (compFilters.salesDateStart && comp.sales_date < compFilters.salesDateStart) {
            if (isFirstProperty) debugFilters.salesDate++;
            return false;
          }
          if (compFilters.salesDateEnd && comp.sales_date > compFilters.salesDateEnd) {
            if (isFirstProperty) debugFilters.salesDate++;
            return false;
          }

          // VCS filter - mapping search scope can override
          if (subjectMapping && subjectMapping.searchScope === 'all_vcs') {
            // Mapped to all_vcs: skip VCS filter entirely (town-wide search)
          } else if (compFilters.sameVCS) {
            if (comp.property_vcs !== subject.property_vcs) {
              if (isFirstProperty) debugFilters.vcs++;
              return false;
            }
          } else if (compFilters.vcs.length > 0) {
            if (!compFilters.vcs.includes(comp.property_vcs)) {
              if (isFirstProperty) debugFilters.vcs++;
              return false;
            }
          }

          // Neighborhood filter
          if (compFilters.sameNeighborhood) {
            if (comp.asset_neighborhood !== subject.asset_neighborhood) {
              if (isFirstProperty) debugFilters.neighborhood++;
              return false;
            }
          } else if (compFilters.neighborhood.length > 0) {
            if (!compFilters.neighborhood.includes(comp.asset_neighborhood)) {
              if (isFirstProperty) debugFilters.neighborhood++;
              return false;
            }
          }

          // Lot size filter
          if (compFilters.sameLotSize) {
            // "Similar lot size" - within 25% of subject's lot size
            const subjectLotAcre = subject.asset_lot_acre || 0;
            const compLotAcre = comp.asset_lot_acre || 0;
            if (subjectLotAcre > 0 && compLotAcre > 0) {
              const tolerance = subjectLotAcre * 0.25; // 25% tolerance
              if (Math.abs(compLotAcre - subjectLotAcre) > tolerance) {
                if (isFirstProperty) debugFilters.lotSize = (debugFilters.lotSize || 0) + 1;
                return false;
              }
            }
          } else if (compFilters.lotAcreMin || compFilters.lotAcreMax) {
            const compLotAcre = comp.asset_lot_acre || 0;
            if (compFilters.lotAcreMin && compLotAcre < parseFloat(compFilters.lotAcreMin)) {
              if (isFirstProperty) debugFilters.lotSize = (debugFilters.lotSize || 0) + 1;
              return false;
            }
            if (compFilters.lotAcreMax && compLotAcre > parseFloat(compFilters.lotAcreMax)) {
              if (isFirstProperty) debugFilters.lotSize = (debugFilters.lotSize || 0) + 1;
              return false;
            }
          }

          // Year built filter
          if (compFilters.useBuiltRange) {
            if (compFilters.builtYearMin && comp.asset_year_built < parseInt(compFilters.builtYearMin)) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
            if (compFilters.builtYearMax && comp.asset_year_built > parseInt(compFilters.builtYearMax)) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
          } else {
            const yearDiff = Math.abs((comp.asset_year_built || 0) - (subject.asset_year_built || 0));
            if (yearDiff > compFilters.builtWithinYears) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
          }

          // Size filter
          if (compFilters.useSizeRange) {
            if (compFilters.sizeMin && comp.asset_sfla < parseInt(compFilters.sizeMin)) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
            if (compFilters.sizeMax && comp.asset_sfla > parseInt(compFilters.sizeMax)) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
          } else {
            const sizeDiff = Math.abs((comp.asset_sfla || 0) - (subject.asset_sfla || 0));
            if (sizeDiff > compFilters.sizeWithinSqft) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
          }

          // Zone filter
          if (compFilters.sameZone) {
            if (comp.asset_zoning !== subject.asset_zoning) {
              if (isFirstProperty) debugFilters.zone++;
              return false;
            }
          } else if (compFilters.zone.length > 0) {
            if (!compFilters.zone.includes(comp.asset_zoning)) {
              if (isFirstProperty) debugFilters.zone++;
              return false;
            }
          }

          // Building class filter
          if (compFilters.sameBuildingClass) {
            if (comp.asset_building_class !== subject.asset_building_class) {
              if (isFirstProperty) debugFilters.buildingClass++;
              return false;
            }
          } else if (compFilters.buildingClass.length > 0) {
            if (!compFilters.buildingClass.includes(comp.asset_building_class)) {
              if (isFirstProperty) debugFilters.buildingClass++;
              return false;
            }
          }

          // Type/Use filter
          if (compFilters.sameTypeUse) {
            if (comp.asset_type_use !== subject.asset_type_use) {
              if (isFirstProperty) debugFilters.typeUse++;
              return false;
            }
          } else if (compFilters.typeUse.length > 0) {
            if (!compFilters.typeUse.includes(comp.asset_type_use)) {
              if (isFirstProperty) debugFilters.typeUse++;
              return false;
            }
          }

          // Style filter
          if (compFilters.sameStyle) {
            if (comp.asset_design_style !== subject.asset_design_style) {
              if (isFirstProperty) debugFilters.style++;
              return false;
            }
          } else if (compFilters.style.length > 0) {
            if (!compFilters.style.includes(comp.asset_design_style)) {
              if (isFirstProperty) debugFilters.style++;
              return false;
            }
          }

          // Story height filter
          if (compFilters.sameStoryHeight) {
            if (comp.asset_story_height !== subject.asset_story_height) {
              if (isFirstProperty) debugFilters.storyHeight++;
              return false;
            }
          } else if (compFilters.storyHeight.length > 0) {
            if (!compFilters.storyHeight.includes(comp.asset_story_height)) {
              if (isFirstProperty) debugFilters.storyHeight++;
              return false;
            }
          }

          // View filter
          if (compFilters.sameView) {
            if (comp.asset_view !== subject.asset_view) {
              if (isFirstProperty) debugFilters.view++;
              return false;
            }
          } else if (compFilters.view.length > 0) {
            if (!compFilters.view.includes(comp.asset_view)) {
              if (isFirstProperty) debugFilters.view++;
              return false;
            }
          }

          // Farm sales filter - segregate farm and non-farm sales
          const compPackageData = interpretCodes.getPackageSaleData(properties, comp);
          const compIsFarm = compPackageData?.is_farm_package || comp.property_m4_class === '3A';

          if (compFilters.farmSalesMode) {
            // Farm Sales Mode ON: segregate farm and non-farm
            const subjectPackageData = interpretCodes.getPackageSaleData(properties, subject);
            const subjectIsFarm = subjectPackageData?.is_farm_package || subject.property_m4_class === '3A';

            // If subject is a farm, only allow farm comps that have been normalized (have values_norm_time)
            if (subjectIsFarm) {
              if (!compIsFarm) {
                if (isFirstProperty) debugFilters.farmSales = (debugFilters.farmSales || 0) + 1;
                return false;
              }
              // For farm comps, require they have normalized time value (indicates they were processed)
              if (!comp.values_norm_time || comp.values_norm_time <= 0) {
                if (isFirstProperty) debugFilters.farmSales = (debugFilters.farmSales || 0) + 1;
                return false;
              }
            }

            // If subject is NOT a farm, exclude farm comps to prevent skewed values
            if (!subjectIsFarm && compIsFarm) {
              if (isFirstProperty) debugFilters.farmSales = (debugFilters.farmSales || 0) + 1;
              return false;
            }
          } else {
            // Farm Sales Mode OFF: always exclude farm sales from comparisons
            if (compIsFarm) {
              if (isFirstProperty) debugFilters.farmSales = (debugFilters.farmSales || 0) + 1;
              return false;
            }
          }

          if (isFirstProperty) debugFilters.passed++;
          return true;
        });

        // Log debug results for first property
        if (isFirstProperty) {
          console.log(`\n📊 Filter Results:`);
          console.log(`   ❌ Excluded (self): ${debugFilters.self}`);
          console.log(`   ❌ Failed sales codes: ${debugFilters.salesCodes}`);
          console.log(`   ❌ Failed sales date: ${debugFilters.salesDate}`);
          console.log(`   ❌ Failed VCS: ${debugFilters.vcs}`);
          console.log(`   ❌ Failed neighborhood: ${debugFilters.neighborhood}`);
          console.log(`   ❌ Failed year built: ${debugFilters.yearBuilt}`);
          console.log(`   ❌ Failed size (SFLA): ${debugFilters.size}`);
          console.log(`   ❌ Failed zone: ${debugFilters.zone}`);
          console.log(`   ❌ Failed building class: ${debugFilters.buildingClass}`);
          console.log(`   ❌ Failed type/use: ${debugFilters.typeUse}`);
          console.log(`   ❌ Failed style: ${debugFilters.style}`);
          console.log(`   ❌ Failed story height: ${debugFilters.storyHeight}`);
          console.log(`   ❌ Failed view: ${debugFilters.view}`);
          console.log(`   ❌ Failed farm sales: ${debugFilters.farmSales || 0}`);
          console.log(`   ✅ Passed initial filters: ${debugFilters.passed}`);
        }

        // Calculate adjustments for each comparable (already aggregated via aggregatedSales)
        const compsWithAdjustments = matchingComps.map(comp => {
          const { adjustments, totalAdjustment, adjustedPrice, adjustmentPercent } =
            calculateAllAdjustments(subject, comp, subjectMapping?.bracket);

          const grossAdjustment = adjustments.reduce((sum, adj) => sum + Math.abs(adj.amount), 0);
          const grossAdjustmentPercent = comp.values_norm_time > 0
            ? (grossAdjustment / comp.values_norm_time) * 100
            : 0;

          // Apply adjustment tolerance filters
          let passesTolerance = true;

          // Individual adjustment tolerance
          if (compFilters.individualAdjPct > 0) {
            const hasLargeAdjustment = adjustments.some(adj =>
              Math.abs((adj.amount / comp.values_norm_time) * 100) > compFilters.individualAdjPct
            );
            if (hasLargeAdjustment) passesTolerance = false;
          }

          // Net adjustment tolerance
          if (compFilters.netAdjPct > 0) {
            if (Math.abs(adjustmentPercent) > compFilters.netAdjPct) passesTolerance = false;
          }

          // Gross adjustment tolerance (sum of absolute values)
          if (compFilters.grossAdjPct > 0) {
            if (grossAdjustmentPercent > compFilters.grossAdjPct) passesTolerance = false;
          }

          return {
            ...comp,
            adjustments,
            totalAdjustment,
            grossAdjustment,
            grossAdjustmentPercent,
            adjustedPrice,
            adjustmentPercent,
            passesTolerance
          };
        });

        // Filter by tolerance
        let validComps = compsWithAdjustments.filter(c => c.passesTolerance);

        // Debug tolerance filtering
        if (isFirstProperty) {
          const failedTolerance = compsWithAdjustments.length - validComps.length;
          console.log(`\n🎯 Adjustment Tolerance Results:`);
          console.log(`   Before tolerance: ${compsWithAdjustments.length} comps`);
          console.log(`   ❌ Failed tolerance: ${failedTolerance}`);
          console.log(`   ✅ Passed tolerance: ${validComps.length}`);
          if (compFilters.individualAdjPct > 0) {
            console.log(`      Individual adj limit: ${compFilters.individualAdjPct}%`);
          }
          if (compFilters.netAdjPct > 0) {
            console.log(`      Net adj limit: ${compFilters.netAdjPct}%`);
          }
          if (compFilters.grossAdjPct > 0) {
            console.log(`      Gross adj limit: ${compFilters.grossAdjPct}%`);
          }
        }

        // SUBJECT SALE PRIORITY: If subject sold in CSP, it becomes Comp #1 with 0% adjustment
        const assessmentYear = new Date(jobData.end_date).getFullYear();
        const cspStart = new Date(assessmentYear - 1, 9, 1);
        const cspEnd = new Date(assessmentYear, 11, 31);

        const subjectSaleDate = subject.sales_date ? new Date(subject.sales_date) : null;
        const subjectSoldInCSP = subjectSaleDate &&
          (subjectSaleDate >= cspStart && subjectSaleDate <= cspEnd) &&
          subject.values_norm_time > 0;

        let priorityComp = null;
        if (subjectSoldInCSP) {
          priorityComp = {
            ...subject,
            adjustments: [],
            totalAdjustment: 0,
            grossAdjustment: 0,
            grossAdjustmentPercent: 0,
            adjustedPrice: subject.values_norm_time,
            adjustmentPercent: 0,
            passesTolerance: true,
            isSubjectSale: true,
            rank: 1
          };
        }

        // RANK COMPARABLES: Sort by absolute Net Adj % (closest to 0% is best)
        validComps.sort((a, b) => {
          return Math.abs(a.adjustmentPercent) - Math.abs(b.adjustmentPercent);
        });

        // SELECT TOP 5 (or Top 4 if subject sale exists)
        const maxComps = priorityComp ? 4 : 5;
        let topComps = validComps.slice(0, maxComps);

        // Add subject sale as Comp #1 if it exists
        if (priorityComp) {
          topComps = [priorityComp, ...topComps];
        }

        // Assign ranks
        topComps.forEach((comp, idx) => {
          if (!comp.isSubjectSale) {
            comp.rank = idx + 1;
          }
        });

        // CALCULATE WEIGHTED AVERAGE
        let projectedAssessment = null;
        let confidenceScore = 0;

        if (topComps.length >= 1) {
          // Calculate weights based on closeness to 0% adjustment
          const totalInverseAdjPct = topComps.reduce((sum, comp) => {
            return sum + (1 / (Math.abs(comp.adjustmentPercent) + 1)); // +1 to avoid division by zero
          }, 0);

          topComps.forEach(comp => {
            comp.weight = (1 / (Math.abs(comp.adjustmentPercent) + 1)) / totalInverseAdjPct;
          });

          // Weighted average of adjusted prices
          projectedAssessment = topComps.reduce((sum, comp) => {
            return sum + (comp.adjustedPrice * comp.weight);
          }, 0);

          // Confidence score: 100 for 5 comps with 0% avg adjustment, decreasing from there
          const avgAdjPct = topComps.reduce((sum, c) => sum + Math.abs(c.adjustmentPercent), 0) / topComps.length;
          confidenceScore = Math.max(0, Math.min(100,
            (topComps.length / 5) * 100 - (avgAdjPct * 2)
          ));
        }

        results.push({
          subject,
          comparables: topComps,
          totalFound: matchingComps.length,
          totalValid: validComps.length,
          projectedAssessment: projectedAssessment ? Math.round(projectedAssessment) : null,
          confidenceScore: Math.round(confidenceScore),
          hasSubjectSale: !!priorityComp
        });
      }

      // Display results immediately - no DB save during evaluation
      // User saves explicitly via "Save Result Set" button
      setEvaluationResults(results);
      setIsEvaluating(false);
      setEvaluationProgress({ current: 0, total: 0 });

      // Auto-scroll to results
      requestAnimationFrame(() => {
        if (resultsRef.current) {
          resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

    } catch (error) {
      console.error('❌ Error during evaluation:', error);
      console.error('Error stack:', error.stack);
      alert(
        `Evaluation failed!\n\n` +
        `Error: ${error.message}\n\n` +
        `Check the browser console for more details.`
      );
    } finally {
      setIsEvaluating(false);
      setEvaluationProgress({ current: 0, total: 0 });
    }
  };

  // ==================== GET ELIGIBLE SALES ====================
  const getEligibleSales = () => {
    if (!jobData?.end_date) return [];

    const assessmentYear = new Date(jobData.end_date).getFullYear();

    const cspStart = new Date(assessmentYear - 1, 9, 1);
    const cspEnd = new Date(assessmentYear, 11, 31);

    return properties.filter(p => {
      if (!p.sales_date || !p.values_norm_time) return false;

      const saleDate = new Date(p.sales_date);
      const inCSP = saleDate >= cspStart && saleDate <= cspEnd;

      // Check for manual override from Sales Review (property_market_analysis.cme_include_override)
      const includeOverride = p.cme_include_override; // null, true, or false

      // If override exists, respect it; otherwise use default (CSP auto-included)
      if (includeOverride === true) return true; // Manual include (even if not in CSP)
      if (includeOverride === false) return false; // Manual exclude (even if in CSP)

      // Default: Include if in CSP period
      return inCSP;
    });
  };

  // ==================== CALCULATE ADJUSTMENTS ====================
  const calculateAllAdjustments = (subject, comp, overrideBracket) => {
    const adjustments = adjustmentGrid.map(adjDef => {
      const amount = calculateAdjustment(subject, comp, adjDef, overrideBracket);
      return {
        name: adjDef.adjustment_name,
        category: adjDef.category,
        amount
      };
    });
    
    const totalAdjustment = adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    const adjustedPrice = (comp.values_norm_time || 0) + totalAdjustment;
    
    return {
      adjustments,
      totalAdjustment,
      adjustedPrice,
      adjustmentPercent: comp.values_norm_time > 0 ? (totalAdjustment / comp.values_norm_time) * 100 : 0
    };
  };

  const getPriceBracketIndex = (normPrice, overrideBracket) => {
    // If an override bracket is provided (from mapping), use it
    const effectiveBracket = overrideBracket || compFilters.adjustmentBracket;

    // Check if a specific bracket is selected (not auto)
    if (effectiveBracket && effectiveBracket !== 'auto') {
      const match = effectiveBracket.match(/bracket_(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
    }

    // Auto mode: determine bracket based on sale price
    if (!normPrice) return 0;
    const bracket = CME_BRACKETS.findIndex(b => normPrice >= b.min && normPrice <= b.max);
    return bracket >= 0 ? bracket : 0;
  };

  // ==================== HELPER: COUNT BRT ITEMS ====================
  const countBRTItems = useCallback((property, categoryCodes) => {
    if (vendorType !== 'BRT' || !property.raw_brt_items) return 0;

    try {
      const items = JSON.parse(property.raw_brt_items);
      return items.filter(item => categoryCodes.includes(item.category)).length;
    } catch {
      return 0;
    }
  }, [vendorType]);

  // ==================== HELPER: READ MICRO VALUE ====================
  const readMicroValue = useCallback((property, fieldName) => {
    if (vendorType !== 'Microsystems') return null;
    return property[fieldName];
  }, [vendorType]);

  const calculateAdjustment = (subject, comp, adjustmentDef, overrideBracket) => {
    if (!subject || !comp || !adjustmentDef) return 0;

    const selectedBracket = overrideBracket || compFilters.adjustmentBracket;
    let adjustmentValue = 0;
    let adjustmentType = adjustmentDef.adjustment_type;

    // Check if using a custom bracket
    if (selectedBracket && selectedBracket.startsWith('custom_')) {
      const customBracket = customBrackets.find(b => b.bracket_id === selectedBracket);
      if (customBracket && customBracket.adjustment_values) {
        const customValue = customBracket.adjustment_values[adjustmentDef.adjustment_id];
        if (customValue) {
          adjustmentValue = customValue.value || 0;
          adjustmentType = customValue.type || adjustmentDef.adjustment_type;
        }
      }
    } else {
      // Use default bracket
      const bracketIndex = getPriceBracketIndex(comp.values_norm_time, overrideBracket);
      adjustmentValue = adjustmentDef[`bracket_${bracketIndex}`] || 0;

      // Debug first property only
      if (!window._adjDebugLogged && adjustmentDef.adjustment_id === 'living_area') {
        console.log(`📐 Adjustment Debug (${adjustmentDef.adjustment_name}):`);
        console.log(`   - Selected bracket filter: ${compFilters.adjustmentBracket}`);
        console.log(`   - Bracket index: ${bracketIndex}`);
        console.log(`   - Looking for: bracket_${bracketIndex}`);
        console.log(`   - Adjustment value: ${adjustmentValue}`);
        console.log(`   - Adjustment grid entry:`, adjustmentDef);
        window._adjDebugLogged = true;
      }
    }

    if (adjustmentValue === 0) return 0; // No adjustment needed

    // Extract subject and comp values based on adjustment type
    let subjectValue = 0, compValue = 0;

    switch (adjustmentDef.adjustment_id) {
      case 'living_area':
        subjectValue = subject.asset_sfla || 0;
        compValue = comp.asset_sfla || 0;
        break;

      case 'bedrooms':
        // Use standardized asset_bedrooms column for both vendors
        subjectValue = subject.asset_bedrooms || 0;
        compValue = comp.asset_bedrooms || 0;
        break;

      case 'bathrooms':
        subjectValue = subject.total_baths_calculated || 0;
        compValue = comp.total_baths_calculated || 0;
        break;

      case 'garage':
        // Use garage_area column and convert to category (0=NONE, 1=ONE CAR, 2=TWO CAR, 3=THREE CAR, 4=MULTI CAR)
        subjectValue = getGarageCategory(subject.garage_area || 0);
        compValue = getGarageCategory(comp.garage_area || 0);
        break;

      case 'det_garage':
        // Use det_garage_area column and convert to category (0=NONE, 1=ONE CAR, 2=TWO CAR, 3=THREE CAR, 4=MULTI CAR)
        subjectValue = getGarageCategory(subject.det_garage_area || 0);
        compValue = getGarageCategory(comp.det_garage_area || 0);
        break;

      case 'basement':
        // Use basement_area column (exists for both BRT and Microsystems)
        subjectValue = subject.basement_area > 0 ? 1 : 0;
        compValue = comp.basement_area > 0 ? 1 : 0;
        break;

      case 'finished_basement':
        // Use fin_basement_area column
        subjectValue = subject.fin_basement_area > 0 ? 1 : 0;
        compValue = comp.fin_basement_area > 0 ? 1 : 0;
        break;

      case 'deck':
        // Use deck_area column (exists for both vendors)
        subjectValue = subject.deck_area > 0 ? 1 : 0;
        compValue = comp.deck_area > 0 ? 1 : 0;
        break;

      case 'patio':
        // Use patio_area column
        subjectValue = subject.patio_area > 0 ? 1 : 0;
        compValue = comp.patio_area > 0 ? 1 : 0;
        break;

      case 'pool':
        // Use pool_area column
        subjectValue = subject.pool_area > 0 ? 1 : 0;
        compValue = comp.pool_area > 0 ? 1 : 0;
        break;

      case 'open_porch':
        // Use open_porch_area column
        subjectValue = subject.open_porch_area > 0 ? 1 : 0;
        compValue = comp.open_porch_area > 0 ? 1 : 0;
        break;

      case 'enclosed_porch':
        // Use enclosed_porch_area column
        subjectValue = subject.enclosed_porch_area > 0 ? 1 : 0;
        compValue = comp.enclosed_porch_area > 0 ? 1 : 0;
        break;

      case 'pole_barn':
        // Use pole_barn_area column
        subjectValue = subject.pole_barn_area > 0 ? 1 : 0;
        compValue = comp.pole_barn_area > 0 ? 1 : 0;
        break;

      case 'lot_size_ff':
        subjectValue = subject.asset_lot_frontage || 0;
        compValue = comp.asset_lot_frontage || 0;
        break;

      case 'lot_size_sf':
        subjectValue = subject.market_manual_lot_sf || subject.asset_lot_sf || 0;
        compValue = comp.market_manual_lot_sf || comp.asset_lot_sf || 0;
        break;

      case 'lot_size_acre':
        // For farm properties with farmSalesMode enabled, use combined lot acres (3A + 3B)
        if (compFilters?.farmSalesMode) {
          const subjectPkgData = interpretCodes.getPackageSaleData(properties, subject);
          const compPkgData = interpretCodes.getPackageSaleData(properties, comp);

          if (subjectPkgData?.is_farm_package && subjectPkgData.combined_lot_acres > 0) {
            subjectValue = subjectPkgData.combined_lot_acres;
          } else {
            subjectValue = subject.market_manual_lot_acre || subject.asset_lot_acre || 0;
          }

          if (compPkgData?.is_farm_package && compPkgData.combined_lot_acres > 0) {
            compValue = compPkgData.combined_lot_acres;
          } else {
            compValue = comp.market_manual_lot_acre || comp.asset_lot_acre || 0;
          }
        } else {
          subjectValue = subject.market_manual_lot_acre || subject.asset_lot_acre || 0;
          compValue = comp.market_manual_lot_acre || comp.asset_lot_acre || 0;
        }
        break;

      case 'year_built':
        subjectValue = subject.asset_year_built || 0;
        compValue = comp.asset_year_built || 0;
        break;

      case 'exterior_condition':
        // Translate condition code to full name using code table (BRT) or simple mapping (Microsystems)
        let subjectExtCondName = interpretCodes.getExteriorConditionName(subject, codeDefinitions, vendorType);
        let compExtCondName = interpretCodes.getExteriorConditionName(comp, codeDefinitions, vendorType);

        // Fallback for Microsystems if code definitions not loaded: use simple mapping
        if (!subjectExtCondName && vendorType === 'Microsystems') {
          subjectExtCondName = translateConditionCode(subject.asset_ext_cond);
        }
        if (!compExtCondName && vendorType === 'Microsystems') {
          compExtCondName = translateConditionCode(comp.asset_ext_cond);
        }

        subjectValue = getConditionRank(subjectExtCondName, 'exterior');
        compValue = getConditionRank(compExtCondName, 'exterior');
        break;

      case 'interior_condition':
        // Translate condition code to full name using code table (BRT) or simple mapping (Microsystems)
        let subjectIntCondName = interpretCodes.getInteriorConditionName(subject, codeDefinitions, vendorType);
        let compIntCondName = interpretCodes.getInteriorConditionName(comp, codeDefinitions, vendorType);

        // Fallback for Microsystems if code definitions not loaded: use simple mapping
        if (!subjectIntCondName && vendorType === 'Microsystems') {
          subjectIntCondName = translateConditionCode(subject.asset_int_cond);
        }
        if (!compIntCondName && vendorType === 'Microsystems') {
          compIntCondName = translateConditionCode(comp.asset_int_cond);
        }

        subjectValue = getConditionRank(subjectIntCondName, 'interior');
        compValue = getConditionRank(compIntCondName, 'interior');
        break;

      case 'fireplaces':
        subjectValue = subject.fireplace_count || subject.asset_fireplaces || 0;
        compValue = comp.fireplace_count || comp.asset_fireplaces || 0;
        break;

      case 'ac':
        // AC is a boolean (YES/NO) adjustment based on ac_area > 0
        subjectValue = (subject.ac_area && subject.ac_area > 0) ? 1 : 0;
        compValue = (comp.ac_area && comp.ac_area > 0) ? 1 : 0;
        break;

      case 'barn':
        subjectValue = (subject.barn_area && subject.barn_area > 0) ? 1 : 0;
        compValue = (comp.barn_area && comp.barn_area > 0) ? 1 : 0;
        break;

      case 'stable':
        subjectValue = (subject.stable_area && subject.stable_area > 0) ? 1 : 0;
        compValue = (comp.stable_area && comp.stable_area > 0) ? 1 : 0;
        break;

      case 'pole_barn':
        subjectValue = (subject.pole_barn_area && subject.pole_barn_area > 0) ? 1 : 0;
        compValue = (comp.pole_barn_area && comp.pole_barn_area > 0) ? 1 : 0;
        break;

      default:
        // Handle dynamic adjustments (detached items, miscellaneous, land adjustments)
        // CNET APPROACH: Check raw code columns at runtime against saved configuration
        if (adjustmentDef.adjustment_id.startsWith('barn_') ||
            adjustmentDef.adjustment_id.startsWith('pole_barn_') ||
            adjustmentDef.adjustment_id.startsWith('stable_') ||
            adjustmentDef.adjustment_id.startsWith('miscellaneous_') ||
            adjustmentDef.adjustment_id.startsWith('land_positive_') ||
            adjustmentDef.adjustment_id.startsWith('land_negative_')) {

          const code = adjustmentDef.adjustment_id.replace(/^(barn|pole_barn|stable|miscellaneous|land_positive|land_negative)_/, '');

          // Helper: Check if code exists in property's raw code columns
          const hasCode = (property) => {
            // Normalize function for code comparison
            const normalizeCode = (c) => String(c).trim().replace(/^0+/, '').toUpperCase() || '0';
            const targetCode = normalizeCode(code);

            if (vendorType === 'Microsystems') {
              // MICROSYSTEMS COLUMN MAPPING:
              // - Detached items (barn, pole_barn, stable) → detached_item_code1-4, detachedbuilding1-4
              // - Miscellaneous items → misc_item_1-3
              // - Land positive/negative → overall_adj_reason1-4

              if (adjustmentDef.adjustment_id.startsWith('barn_') ||
                  adjustmentDef.adjustment_id.startsWith('pole_barn_') ||
                  adjustmentDef.adjustment_id.startsWith('stable_')) {
                // Detached items: check detached_item_code1-4, detachedbuilding1-4
                for (let i = 1; i <= 4; i++) {
                  const itemCode = property[`detached_item_code${i}`];
                  if (itemCode && normalizeCode(itemCode) === targetCode) {
                    return true;
                  }
                }
                for (let i = 1; i <= 4; i++) {
                  const buildingCode = property[`detachedbuilding${i}`];
                  if (buildingCode && normalizeCode(buildingCode) === targetCode) {
                    return true;
                  }
                }
              }
              else if (adjustmentDef.adjustment_id.startsWith('miscellaneous_')) {
                // Miscellaneous items: check misc_item_1-3 ONLY
                for (let i = 1; i <= 3; i++) {
                  const miscCode = property[`misc_item_${i}`];
                  if (miscCode && normalizeCode(miscCode) === targetCode) {
                    return true;
                  }
                }
              }
              else if (adjustmentDef.adjustment_id.startsWith('land_positive_') ||
                       adjustmentDef.adjustment_id.startsWith('land_negative_')) {
                // Land adjustments: check overall_adj_reason1-4
                for (let i = 1; i <= 4; i++) {
                  const reasonCode = property[`overall_adj_reason${i}`];
                  if (reasonCode && normalizeCode(reasonCode) === targetCode) {
                    return true;
                  }
                }
              }
            } else {
              // BRT COLUMN MAPPING:
              // - Detached items (barn, pole_barn, stable) → detachedcode_1-11
              // - Miscellaneous items → misc_1_brt through misc_5_brt
              // - Positive Land adjustments → landffcond_1-6 + landurcond_1-6
              // - Negative Land adjustments → landffinfl_1-6 + landurinfl_1-6

              if (adjustmentDef.adjustment_id.startsWith('land_positive_')) {
                // Positive land: check landffcond_1-6 and landurcond_1-6
                for (let i = 1; i <= 6; i++) {
                  const ffcondCode = property[`landffcond_${i}`];
                  if (ffcondCode && normalizeCode(ffcondCode) === targetCode) {
                    return true;
                  }
                  const urcondCode = property[`landurcond_${i}`];
                  if (urcondCode && normalizeCode(urcondCode) === targetCode) {
                    return true;
                  }
                }
              }
              else if (adjustmentDef.adjustment_id.startsWith('land_negative_')) {
                // Negative land: check landffinfl_1-6 and landurinfl_1-6
                for (let i = 1; i <= 6; i++) {
                  const ffinflCode = property[`landffinfl_${i}`];
                  if (ffinflCode && normalizeCode(ffinflCode) === targetCode) {
                    return true;
                  }
                  const urinflCode = property[`landurinfl_${i}`];
                  if (urinflCode && normalizeCode(urinflCode) === targetCode) {
                    return true;
                  }
                }
              }
              else if (adjustmentDef.adjustment_id.startsWith('miscellaneous_')) {
                // BRT Miscellaneous: check misc_1_brt through misc_5_brt
                for (let i = 1; i <= 5; i++) {
                  const miscCode = property[`misc_${i}_brt`];
                  if (miscCode && normalizeCode(miscCode) === targetCode) {
                    return true;
                  }
                }
              }
              else if (adjustmentDef.adjustment_id.startsWith('barn_') ||
                       adjustmentDef.adjustment_id.startsWith('pole_barn_') ||
                       adjustmentDef.adjustment_id.startsWith('stable_')) {
                // BRT Detached items: check detachedcode_1-11
                for (let i = 1; i <= 11; i++) {
                  const detachedCode = property[`detachedcode_${i}`];
                  if (detachedCode && normalizeCode(detachedCode) === targetCode) {
                    return true;
                  }
                }
              }
            }
            return false;
          };

          // Helper: Get miscellaneous count for BRT (returns actual count, not just 0/1)
          const getMiscCount = (property) => {
            if (vendorType !== 'BRT') return hasCode(property) ? 1 : 0;
            const normalizeCode = (c) => String(c).trim().replace(/^0+/, '').toUpperCase() || '0';
            const targetCode = normalizeCode(code);

            for (let i = 1; i <= 5; i++) {
              const miscCode = property[`misc_${i}_brt`];
              if (miscCode && normalizeCode(miscCode) === targetCode) {
                return parseInt(property[`miscnum_${i}`], 10) || 1; // Default to 1 if count is missing
              }
            }
            return 0;
          };

          // Helper: Get condition multiplier for detached items based on depreciation/NC value
          const getConditionMultiplier = (property) => {
            const normalizeCode = (c) => String(c).trim().replace(/^0+/, '').toUpperCase() || '0';
            const targetCode = normalizeCode(code);
            let deprValue = null;

            if (vendorType === 'BRT') {
              // BRT: Find the detachedcode match and get its DETACHEDNC value
              for (let i = 1; i <= 11; i++) {
                const detachedCode = property[`detachedcode_${i}`];
                if (detachedCode && normalizeCode(detachedCode) === targetCode) {
                  deprValue = parseFloat(property[`detachednc_${i}`]) || null;
                  break;
                }
              }
            } else {
              // Microsystems: Check detached_item_code1-4 and detachedbuilding1-4
              // Use average of physical, functional, and locational depreciation
              for (let i = 1; i <= 4; i++) {
                const itemCode = property[`detached_item_code${i}`];
                if (itemCode && normalizeCode(itemCode) === targetCode) {
                  const physical = parseFloat(property[`physical_depr${i}`]) || 0;
                  const functional = parseFloat(property[`functional_depr${i}`]) || 0;
                  const locational = parseFloat(property[`locationl_depr${i}`]) || 0;
                  const validValues = [physical, functional, locational].filter(v => v > 0);
                  deprValue = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : null;
                  break;
                }
              }
              if (deprValue === null) {
                for (let i = 1; i <= 4; i++) {
                  const buildingCode = property[`detachedbuilding${i}`];
                  if (buildingCode && normalizeCode(buildingCode) === targetCode) {
                    const physical = parseFloat(property[`pysical${i}`]) || 0;
                    const functional = parseFloat(property[`functional${i}`]) || 0;
                    const locational = parseFloat(property[`location_economic${i}`]) || 0;
                    const validValues = [physical, functional, locational].filter(v => v > 0);
                    deprValue = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : null;
                    break;
                  }
                }
              }
            }

            // If no depreciation value found, use standard multiplier
            if (deprValue === null) return detachedConditionMultipliers.standard_multiplier;

            // Apply threshold logic
            if (deprValue <= detachedConditionMultipliers.poor_threshold) {
              return detachedConditionMultipliers.poor_multiplier;
            } else if (deprValue >= detachedConditionMultipliers.excellent_threshold) {
              return detachedConditionMultipliers.excellent_multiplier;
            } else {
              return detachedConditionMultipliers.standard_multiplier;
            }
          };

          // Use count-based values for BRT miscellaneous items
          if (adjustmentDef.adjustment_id.startsWith('miscellaneous_') && vendorType === 'BRT') {
            subjectValue = getMiscCount(subject);
            compValue = getMiscCount(comp);
          } else {
            subjectValue = hasCode(subject) ? 1 : 0;
            compValue = hasCode(comp) ? 1 : 0;
          }

          // For detached items (barn, pole_barn, stable), store condition multipliers for later use
          let subjectConditionMultiplier = 1.0;
          let compConditionMultiplier = 1.0;
          if (adjustmentDef.adjustment_id.startsWith('barn_') ||
              adjustmentDef.adjustment_id.startsWith('pole_barn_') ||
              adjustmentDef.adjustment_id.startsWith('stable_')) {
            if (subjectValue > 0) subjectConditionMultiplier = getConditionMultiplier(subject);
            if (compValue > 0) compConditionMultiplier = getConditionMultiplier(comp);
          }

          // Calculate adjustment with condition multipliers for detached items
          if ((adjustmentDef.adjustment_id.startsWith('barn_') ||
               adjustmentDef.adjustment_id.startsWith('pole_barn_') ||
               adjustmentDef.adjustment_id.startsWith('stable_')) &&
              (subjectValue !== compValue)) {
            // Apply condition-adjusted calculation
            const subjectAdjustedValue = subjectValue * subjectConditionMultiplier;
            const compAdjustedValue = compValue * compConditionMultiplier;
            const adjustedDifference = subjectAdjustedValue - compAdjustedValue;

            // Return the condition-adjusted flat adjustment
            return adjustedDifference > 0 ? adjustmentValue * subjectConditionMultiplier :
                   (adjustedDifference < 0 ? -adjustmentValue * compConditionMultiplier : 0);
          }
        } else {
          return 0; // Unknown attribute
        }
        break;
    }

    const difference = subjectValue - compValue;

    // Apply adjustment based on type
    // Rule: Subject Better = ADD to comp price; Comp Better = SUBTRACT from comp price
    switch (adjustmentType) {
      case 'flat':
        // Flat adjustments handle lot sizes (multiply by difference) AND boolean items (binary yes/no)
        // Check if this is a lot size adjustment that should multiply by difference
        if (adjustmentDef.adjustment_id.includes('lot_size')) {
          // Lot size: multiply difference by rate per unit
          return difference * adjustmentValue;
        }
        // Garage adjustments use category counts (0=NONE, 1=ONE CAR, 2=TWO CAR, etc.)
        // Should multiply by the difference in categories
        else if (adjustmentDef.adjustment_id === 'garage' || adjustmentDef.adjustment_id === 'det_garage') {
          // Category count adjustment: multiply difference by $ per category
          return difference * adjustmentValue;
        }
        else {
          // Boolean amenities (including land adjustments): binary adjustment (has it or doesn't)
          // For negative land items like "Busy Rd", user should enter negative value in grid (e.g., -5000)
          // This way: Subject has it, comp doesn't → difference=1 → 1 * -5000 = -5000 (comp adjusted down)
          return difference > 0 ? adjustmentValue : (difference < 0 ? -adjustmentValue : 0);
        }

      case 'per_sqft':
        return difference * adjustmentValue;

      case 'count':
        // Count adjustment: multiply difference by $ per count (e.g., $5,000 per bedroom)
        return difference * adjustmentValue;

      case 'percent':
        // Percent adjustment based on comp sale price
        // Positive difference (subject better) = add to comp price (e.g., +2 steps = +20%)
        // Negative difference (comp better) = subtract from comp price (e.g., -2 steps = -20%)
        // Use full difference for tiered adjustments (e.g., EXCELLENT is 2 steps from AVERAGE)
        return (comp.values_norm_time || 0) * (adjustmentValue / 100) * difference;

      default:
        return 0;
    }
  };

  // Helper: Translate single-letter condition codes to full names
  const translateConditionCode = (code) => {
    if (!code) return null;
    const normalized = code.trim().toUpperCase();

    // Standard condition code mappings (vendor-agnostic)
    const conditionMap = {
      'E': 'EXCELLENT',
      'G': 'GOOD',
      'A': 'AVERAGE',
      'F': 'FAIR',
      'P': 'POOR'
    };

    return conditionMap[normalized] || null;
  };

  // Helper: Get numeric rank for condition codes based on user configuration
  const getConditionRank = (conditionName, configType) => {
    // Handle null/undefined/empty condition name
    if (!conditionName || conditionName.trim() === '') {
      console.warn(`⚠️  No condition name provided for ${configType}, defaulting to baseline (0)`);
      return 0; // No condition name, default to baseline
    }

    // Check if attribute condition config exists
    const conditionConfig = jobData?.attribute_condition_config;
    if (!conditionConfig || !conditionConfig[configType]) {
      console.error(`⚠️  Condition configuration not found for ${configType}. Please configure in Market Analysis → Attribute Cards.`);
      return 0; // Return baseline instead of throwing error to prevent evaluation from breaking
    }

    const config = conditionConfig[configType];
    const code = conditionName.toUpperCase().trim();
    const baseline = config.baseline?.toUpperCase().trim();
    const betterCodes = (config.better || []).map(c => c.toUpperCase().trim());
    const worseCodes = (config.worse || []).map(c => c.toUpperCase().trim());

    // DEBUG: Log the config being used
    console.log(`🔍 getConditionRank DEBUG for ${configType}:`, {
      inputCode: code,
      baseline,
      betterCodes,
      worseCodes,
      configSavedAt: conditionConfig.savedAt
    });

    // Rank based on configuration:
    // Better codes = positive rank (higher is better)
    // Baseline = 0
    // Worse codes = negative rank (lower is worse)

    let rank = 0;
    if (code === baseline) {
      rank = 0; // Baseline
    } else if (betterCodes.includes(code)) {
      // Better codes get positive ranks based on their position
      // First better code = +1, second = +2, etc.
      const index = betterCodes.indexOf(code);
      rank = (index + 1);
    } else if (worseCodes.includes(code)) {
      // Worse codes get negative ranks based on their position
      // First worse code = -1, second = -2, etc.
      const index = worseCodes.indexOf(code);
      rank = -(index + 1);
    } else {
      // Unknown code - default to baseline
      console.warn(`⚠️  Unknown condition code "${code}" for ${configType}, defaulting to baseline`);
      rank = 0;
    }

    console.log(`   → ${code} = rank ${rank}`);
    return rank;
  };

  // ==================== CREATE UPDATE EXPORT ====================
  const handleCreateUpdate = (successfulResults) => {
    if (!successfulResults || successfulResults.length === 0) return;

    const rows = successfulResults.map(r => {
      const subject = r.subject;
      const newTotal = Math.round((r.projectedAssessment || 0) / 100) * 100; // Round to nearest hundred
      const currentLand = subject.values_cama_land || subject.values_mod_land || 0;
      const improvementOverride = newTotal - currentLand;

      return {
        'Block': subject.property_block || '',
        'Lot': subject.property_lot || '',
        'Qualifier': subject.property_qualifier || '',
        'Location': subject.property_location || '',
        'Current Total': subject.values_mod_total || subject.values_cama_total || 0,
        'Current Land': currentLand,
        'New Total (Rounded)': newTotal,
        'Improvement Override': improvementOverride
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    // Format block/lot as text to preserve trailing zeros
    for (let R = 1; R <= range.e.r; R++) {
      const blockCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 0 })];
      const lotCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 1 })];
      if (blockCell) { blockCell.t = 's'; blockCell.v = String(blockCell.v); }
      if (lotCell) { lotCell.t = 's'; lotCell.v = String(lotCell.v); }
    }

    // Set number formats for currency columns
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 4; C <= 7; C++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell) cell.z = '$#,##0';
      }
    }

    worksheet['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
      { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CME Update');
    XLSX.writeFile(workbook, `CME_Update_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ==================== BUILD FINAL ROSTER ====================
  const handleBuildFinalRoster = (successfulResults, skippedResults) => {
    if (!successfulResults || successfulResults.length === 0) return;

    const rows = successfulResults.map(r => {
      const subject = r.subject;
      const comps = r.comparables || [];
      const newTotal = Math.round((r.projectedAssessment || 0) / 100) * 100;
      const currentTotal = subject.values_mod_total || subject.values_cama_total || 0;
      const currentLand = subject.values_cama_land || subject.values_mod_land || 0;
      const currentImpr = currentTotal - currentLand;
      const adjustedPrices = comps.map(c => c.adjustedPrice || 0).filter(p => p > 0);
      const minAdjusted = adjustedPrices.length > 0 ? Math.min(...adjustedPrices) : 0;
      const maxAdjusted = adjustedPrices.length > 0 ? Math.max(...adjustedPrices) : 0;

      const row = {
        'Block': subject.property_block || '',
        'Lot': subject.property_lot || '',
        'Qualifier': subject.property_qualifier || '',
        'Location': subject.property_location || '',
        'Owner': subject.owner_name || '',
        'VCS': subject.property_vcs || '',
        'Type/Use': subject.asset_type_use || '',
        'Building Class': subject.asset_building_class || '',
        'Style': subject.asset_design_style || '',
        'Year Built': subject.asset_year_built || '',
        'SFLA': subject.asset_sfla || 0,
        'Lot Size (SF)': subject.market_manual_lot_sf || subject.asset_lot_sf || 0,
        'Current Land': currentLand,
        'Current Impr': currentImpr,
        'Current Total': currentTotal,
        'Proposed Value': newTotal,
        'Improvement Override': newTotal - currentLand,
        'Delta %': currentTotal > 0 ? ((newTotal - currentTotal) / currentTotal) : 0,
        'Confidence': r.confidenceScore || 0,
        '# Comps': comps.length,
        'Min Adjusted': minAdjusted,
        'Max Adjusted': maxAdjusted
      };

      // Add per-comp columns
      comps.forEach((comp, idx) => {
        const compNum = idx + 1;
        row[`Comp ${compNum} BLQ`] = `${comp.property_block}/${comp.property_lot}${comp.property_qualifier && comp.property_qualifier !== 'NONE' ? '/' + comp.property_qualifier : ''}`;
        row[`Comp ${compNum} Sale Price`] = comp.values_norm_time || comp.sales_price || 0;
        row[`Comp ${compNum} Adjusted`] = Math.round(comp.adjustedPrice || 0);
        row[`Comp ${compNum} Net Adj %`] = comp.adjustmentPercent ? (comp.adjustmentPercent / 100) : 0;
      });

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    // Format block/lot as text to preserve trailing zeros
    for (let R = 1; R <= range.e.r; R++) {
      const blockCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 0 })];
      const lotCell = worksheet[XLSX.utils.encode_cell({ r: R, c: 1 })];
      if (blockCell) { blockCell.t = 's'; blockCell.v = String(blockCell.v); }
      if (lotCell) { lotCell.t = 's'; lotCell.v = String(lotCell.v); }
    }

    // Set column widths
    const colCount = range.e.c + 1;
    worksheet['!cols'] = Array(colCount).fill({ wch: 14 });
    worksheet['!cols'][3] = { wch: 30 }; // Location
    worksheet['!cols'][4] = { wch: 20 }; // Owner

    // Header styling
    const headers = Object.keys(rows[0] || {});
    headers.forEach((header, idx) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: idx });
      if (worksheet[cellRef]) {
        worksheet[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2E8F0' } } };
      }
    });

    // Number formats for data rows
    for (let R = 1; R <= range.e.r; R++) {
      headers.forEach((header, C) => {
        const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell) return;
        if (['Current Land', 'Current Impr', 'Current Total', 'Proposed Value', 'Improvement Override', 'Min Adjusted', 'Max Adjusted'].includes(header) || header.includes('Sale Price') || header.includes('Adjusted')) {
          cell.z = '$#,##0';
        }
        if (header === 'Delta %' || header.includes('Net Adj %')) {
          cell.z = '0.00%';
        }
      });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CME Final Roster');

    // Add skipped properties sheet if any
    if (skippedResults && skippedResults.length > 0) {
      const skippedRows = skippedResults.map(r => ({
        'Block': r.subject.property_block || '',
        'Lot': r.subject.property_lot || '',
        'Qualifier': r.subject.property_qualifier || '',
        'Location': r.subject.property_location || '',
        'VCS': r.subject.property_vcs || '',
        'Type/Use': r.subject.asset_type_use || '',
        'Current Total': r.subject.values_mod_total || r.subject.values_cama_total || 0,
        'Comps Found': r.comparables.length,
        'Reason': r.comparables.length === 0 ? 'No comparables found' : `Only ${r.comparables.length} comp(s)`
      }));
      const skippedWs = XLSX.utils.json_to_sheet(skippedRows);
      skippedWs['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 25 }];
      XLSX.utils.book_append_sheet(workbook, skippedWs, 'Skipped Properties');
    }

    XLSX.writeFile(workbook, `CME_Final_Roster_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ==================== RENDER ====================
  const subTabs = [
    { id: 'adjustments', label: 'Adjustments', icon: Sliders },
    { id: 'search', label: 'Search & Results', icon: Search },
    { id: 'detailed', label: 'Detailed', icon: FileText }
  ];

  return (
    <div className="sales-comparison-cme">
      {/* Nested Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`
                  whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {/* ADJUSTMENTS TAB */}
        {activeSubTab === 'adjustments' && (
          <AdjustmentsTab jobData={jobData} properties={properties} />
        )}

        {/* SEARCH TAB */}
        {activeSubTab === 'search' && (
          <div className="space-y-8">
            {/* SECTION 1: Which properties do you want to evaluate? */}
            <div className="bg-white border border-gray-300 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">
                Which properties do you want to evaluate?
              </h3>

              <div className="space-y-4">
                {/* VCS and Type/Use side-by-side - centered */}
                <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto">
                  {/* VCS Dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">VCS</label>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          toggleChip(subjectVCS, setSubjectVCS)(e.target.value);
                        }
                      }}
                      className="w-full max-w-xs px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select VCS...</option>
                      {uniqueVCS.map(vcs => (
                        <option key={vcs} value={vcs}>{vcs}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Blank for full town</p>
                    {/* VCS Chips */}
                    {subjectVCS.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {subjectVCS.map(vcs => (
                          <span
                            key={vcs}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs"
                          >
                            {vcs}
                            <button
                              onClick={() => toggleChip(subjectVCS, setSubjectVCS)(vcs)}
                              className="ml-0.5 text-blue-600 hover:text-blue-800"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Type/Use Dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type/Use Codes</label>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          toggleChip(subjectTypeUse, setSubjectTypeUse)(e.target.value);
                        }
                      }}
                      className="w-full max-w-xs px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select Type/Use...</option>
                      {uniqueTypeUse.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Can select multiple. Blank for all</p>
                    {/* Type/Use Chips */}
                    {subjectTypeUse.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {subjectTypeUse.map(type => (
                          <span
                            key={type}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                          >
                            {type}
                            <button
                              onClick={() => toggleChip(subjectTypeUse, setSubjectTypeUse)(type)}
                              className="ml-0.5 text-green-600 hover:text-green-800"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Inline Block/Lot/Qual Entry Rows */}
                {pendingBlockLotRows.length > 0 && (
                  <div className="space-y-2 pt-2 max-w-2xl mx-auto">
                    {pendingBlockLotRows.map((row, idx) => (
                      <div key={idx} className="flex items-center justify-center gap-3">
                        <div className="grid grid-cols-3 gap-3 w-full max-w-md">
                          <div>
                            {idx === 0 && <label className="block text-xs font-medium text-gray-600 mb-1">Block</label>}
                            <input
                              type="text"
                              value={row.block}
                              onChange={(e) => {
                                const updated = [...pendingBlockLotRows];
                                updated[idx] = { ...updated[idx], block: e.target.value };
                                setPendingBlockLotRows(updated);
                              }}
                              onBlur={() => {
                                if (row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              placeholder="Block"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            {idx === 0 && <label className="block text-xs font-medium text-gray-600 mb-1">Lot</label>}
                            <input
                              type="text"
                              value={row.lot}
                              onChange={(e) => {
                                const updated = [...pendingBlockLotRows];
                                updated[idx] = { ...updated[idx], lot: e.target.value };
                                setPendingBlockLotRows(updated);
                              }}
                              onBlur={() => {
                                if (row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              placeholder="Lot"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            {idx === 0 && <label className="block text-xs font-medium text-gray-600 mb-1">Qual</label>}
                            <input
                              type="text"
                              value={row.qualifier}
                              onChange={(e) => {
                                const updated = [...pendingBlockLotRows];
                                updated[idx] = { ...updated[idx], qualifier: e.target.value };
                                setPendingBlockLotRows(updated);
                              }}
                              onBlur={() => {
                                if (row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && row.block && row.lot) {
                                  const key = `${row.block}-${row.lot}${row.qualifier ? `-${row.qualifier}` : ''}`;
                                  if (!manualProperties.includes(key)) {
                                    setManualProperties(prev => [...prev, key]);
                                  }
                                  setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx));
                                }
                              }}
                              placeholder="Qual"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => setPendingBlockLotRows(prev => prev.filter((_, i) => i !== idx))}
                          className="text-gray-400 hover:text-gray-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Manual Properties Chips */}
                {manualProperties.length > 0 && (
                  <div className="pt-2 max-w-2xl mx-auto text-center">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manual Properties ({manualProperties.length})
                    </label>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {manualProperties.map(key => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-xs"
                        >
                          {key}
                          <button
                            onClick={() => setManualProperties(prev => prev.filter(k => k !== key))}
                            className="ml-0.5 text-purple-600 hover:text-purple-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Centered Buttons */}
                <div className="flex justify-center gap-3 pt-3">
                  <button
                    onClick={() => setPendingBlockLotRows(prev => [...prev, { block: '', lot: '', qualifier: '' }])}
                    className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm font-medium"
                  >
                    New Block/Lot/Qual
                  </button>
                  <button
                    onClick={() => setShowManualEntryModal(true)}
                    className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm font-medium inline-flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import Block/Lot/Qual
                  </button>
                </div>
              </div>
            </div>

            {/* Adjustment Bracket - Between sections, centered */}
            <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4">
              <div className="flex justify-center items-center gap-4">
                <label className="text-sm font-medium text-gray-700">Adjustment Bracket</label>
                <select
                  value={compFilters.adjustmentBracket || ''}
                  onChange={(e) => {
                    const newValue = e.target.value;
                    setCompFilters(prev => ({
                      ...prev,
                      adjustmentBracket: newValue,
                      autoAdjustment: newValue === 'auto'
                    }));
                  }}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded w-64"
                >
                  <option value="">Select bracket...</option>
                  <option value="auto">Auto (based on sale price)</option>
                  <optgroup label="Default Brackets">
                    {CME_BRACKETS.map((bracket, idx) => (
                      <option key={idx} value={`bracket_${idx}`}>{bracket.label}</option>
                    ))}
                  </optgroup>
                  {customBrackets.length > 0 && (
                    <optgroup label="Custom Brackets">
                      {customBrackets.map((bracket) => (
                        <option key={bracket.bracket_id} value={bracket.bracket_id}>{bracket.bracket_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={compFilters.adjustmentBracket === 'auto'}
                    onChange={(e) => {
                      setCompFilters(prev => ({
                        ...prev,
                        adjustmentBracket: e.target.checked ? 'auto' : '',
                        autoAdjustment: e.target.checked
                      }));
                    }}
                    className="rounded"
                  />
                  <span className="text-gray-700">Auto</span>
                </label>
              </div>
            </div>

            {/* SECTION 2: Which comparables do you want to use? */}
            <div className="bg-white border border-gray-300 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">
                Which comparables do you want to use?
              </h3>

              {/* Row 1: Sales Codes + Sales Between */}
              <div className="grid grid-cols-2 gap-8 mb-4">
                {/* Sales Codes - Dropdown with chips */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sales Codes</label>
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) toggleCompFilterChip('salesCodes')(e.target.value); }}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="">Select code...</option>
                    {uniqueSalesCodes.map(code => (
                      <option key={code} value={code}>{code || '(blank)'}</option>
                    ))}
                  </select>
                  {compFilters.salesCodes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {compFilters.salesCodes.map(code => (
                        <span key={code} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                          {code || '(blank)'}
                          <button onClick={() => toggleCompFilterChip('salesCodes')(code)} className="text-blue-600 hover:text-blue-800"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Can select multiple sales codes. Blank for all</p>
                </div>
                {/* Sales Between */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sales Between</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={compFilters.salesDateStart}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, salesDateStart: e.target.value }))}
                      className="px-2 py-1 border border-gray-300 rounded text-sm w-36"
                    />
                    <span className="text-sm">and</span>
                    <input
                      type="date"
                      value={compFilters.salesDateEnd}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, salesDateEnd: e.target.value }))}
                      className="px-2 py-1 border border-gray-300 rounded text-sm w-36"
                    />
                  </div>
                </div>
              </div>

              {/* Row 2: VCS (centered) */}
              <div className="max-w-xl mx-auto mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">VCS</label>
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) toggleCompFilterChip('vcs')(e.target.value); }}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                    disabled={compFilters.sameVCS}
                  >
                    <option value="">{compFilters.sameVCS ? '' : 'Select VCS...'}</option>
                    {uniqueVCS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                    <span className="text-gray-500">OR Same VCS</span>
                    <input type="checkbox" checked={compFilters.sameVCS} onChange={(e) => setCompFilters(prev => ({ ...prev, sameVCS: e.target.checked }))} className="rounded" />
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Blank for full town. May take very long on large towns</p>
                {!compFilters.sameVCS && compFilters.vcs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {compFilters.vcs.map(v => (
                      <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                        {v}<button onClick={() => toggleCompFilterChip('vcs')(v)} className="text-blue-600 hover:text-blue-800"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Row 3: Neighborhood (centered under VCS) */}
              <div className="max-w-xl mx-auto mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Neighborhood</label>
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) toggleCompFilterChip('neighborhood')(e.target.value); }}
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                    disabled={compFilters.sameNeighborhood}
                  >
                    <option value="">{compFilters.sameNeighborhood ? '' : 'Select...'}</option>
                    {uniqueNeighborhood.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                    <span className="text-gray-500">OR Same Neighborhood</span>
                    <input type="checkbox" checked={compFilters.sameNeighborhood} onChange={(e) => setCompFilters(prev => ({ ...prev, sameNeighborhood: e.target.checked }))} className="rounded" />
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">Blank for full neighborhood</p>
                {!compFilters.sameNeighborhood && compFilters.neighborhood.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {compFilters.neighborhood.map(n => (
                      <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">
                        {n}<button onClick={() => toggleCompFilterChip('neighborhood')(n)} className="text-green-600 hover:text-green-800"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Row 4: Lot Size (centered) */}
              <div className="flex justify-center items-center gap-4 mb-4">
                <label className="text-sm font-medium text-gray-700">Lot Size (Acre) Between</label>
                <input
                  type="number"
                  step="0.01"
                  value={compFilters.lotAcreMin}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, lotAcreMin: e.target.value }))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder=""
                  disabled={compFilters.sameLotSize}
                />
                <span className="text-sm">and</span>
                <input
                  type="number"
                  step="0.01"
                  value={compFilters.lotAcreMax}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, lotAcreMax: e.target.value }))}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder=""
                  disabled={compFilters.sameLotSize}
                />
                <label className="flex items-center gap-1 text-sm whitespace-nowrap">
                  <span className="text-gray-500">OR Similar Lot Size</span>
                  <input type="checkbox" checked={compFilters.sameLotSize} onChange={(e) => setCompFilters(prev => ({ ...prev, sameLotSize: e.target.checked }))} className="rounded" />
                </label>
              </div>

              {/* Row 5: Built Within / Comparable Built Between */}
              <div className="flex justify-center items-center gap-2 mb-3 text-sm">
                <span className="font-medium text-gray-700">Built within</span>
                <input
                  type="number"
                  value={compFilters.builtWithinYears}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, builtWithinYears: parseInt(e.target.value) || 0, useBuiltRange: false }))}
                  className="w-12 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                />
                <span className="text-gray-600">years of each other</span>
                <span className="font-bold text-gray-800 mx-2">Or</span>
                <span className="font-medium text-gray-700">Comparable Built Between</span>
                <input
                  type="number"
                  value={compFilters.builtYearMin}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, builtYearMin: e.target.value, useBuiltRange: true }))}
                  className="w-16 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                  placeholder="YYYY"
                />
                <span>and</span>
                <input
                  type="number"
                  value={compFilters.builtYearMax}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, builtYearMax: e.target.value, useBuiltRange: true }))}
                  className="w-16 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                  placeholder="YYYY"
                />
              </div>

              {/* Row 6: Size Within / Comparable Size Between */}
              <div className="flex justify-center items-center gap-2 mb-4 text-sm">
                <span className="font-medium text-gray-700">Size within</span>
                <input
                  type="number"
                  value={compFilters.sizeWithinSqft}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, sizeWithinSqft: parseInt(e.target.value) || 0, useSizeRange: false }))}
                  className="w-16 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                />
                <span className="text-gray-600">sqft of each other</span>
                <span className="font-bold text-gray-800 mx-2">Or</span>
                <span className="font-medium text-gray-700">Comparable Size Between</span>
                <input
                  type="number"
                  value={compFilters.sizeMin}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, sizeMin: e.target.value, useSizeRange: true }))}
                  className="w-16 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                  placeholder="sqft"
                />
                <span>and</span>
                <input
                  type="number"
                  value={compFilters.sizeMax}
                  onChange={(e) => setCompFilters(prev => ({ ...prev, sizeMax: e.target.value, useSizeRange: true }))}
                  className="w-16 px-1 py-1 border border-gray-300 rounded text-sm text-center"
                  placeholder="sqft"
                />
              </div>

              {/* Row 5-6: Attribute Filters (2x3 grid) */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                {/* Zone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('zone')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameZone}
                    >
                      <option value="">Select...</option>
                      {uniqueZone.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same Zone</span>
                      <input type="checkbox" checked={compFilters.sameZone} onChange={(e) => setCompFilters(prev => ({ ...prev, sameZone: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
                {/* Building Class */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Building Class</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('buildingClass')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameBuildingClass}
                    >
                      <option value="">Select...</option>
                      {uniqueBuildingClass.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same Building Class</span>
                      <input type="checkbox" checked={compFilters.sameBuildingClass} onChange={(e) => setCompFilters(prev => ({ ...prev, sameBuildingClass: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
                {/* Type/Use */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type/Use</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('typeUse')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameTypeUse}
                    >
                      <option value="">Select...</option>
                      {uniqueTypeUse.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same Type/Use</span>
                      <input type="checkbox" checked={compFilters.sameTypeUse} onChange={(e) => setCompFilters(prev => ({ ...prev, sameTypeUse: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
                {/* Style */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Style</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('style')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameStyle}
                    >
                      <option value="">Select...</option>
                      {uniqueStyle.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same Style</span>
                      <input type="checkbox" checked={compFilters.sameStyle} onChange={(e) => setCompFilters(prev => ({ ...prev, sameStyle: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
                {/* Story Height */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Story Height</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('storyHeight')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameStoryHeight}
                    >
                      <option value="">Select...</option>
                      {uniqueStoryHeight.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same Story Height</span>
                      <input type="checkbox" checked={compFilters.sameStoryHeight} onChange={(e) => setCompFilters(prev => ({ ...prev, sameStoryHeight: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
                {/* View */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">View</label>
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) toggleCompFilterChip('view')(e.target.value); }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      disabled={compFilters.sameView}
                    >
                      <option value="">Select...</option>
                      {uniqueView.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <span className="text-gray-500">OR Same View</span>
                      <input type="checkbox" checked={compFilters.sameView} onChange={(e) => setCompFilters(prev => ({ ...prev, sameView: e.target.checked }))} className="rounded" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Farm Sales Mode - Centered */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex justify-center">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={compFilters.farmSalesMode}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, farmSalesMode: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="font-medium text-gray-900">Farm Sales Mode</span>
                    <span className="text-gray-600">- Farm subjects (3A+3B) compare to farm comps using combined lot acreage</span>
                  </label>
                </div>
              </div>

              {/* Tolerances - Centered */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex justify-center gap-8">
                  {/* Individual Adj */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Individual adj within</label>
                    <input
                      type="number"
                      value={compFilters.individualAdjPct}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, individualAdjPct: parseFloat(e.target.value) || 0 }))}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                      min="0"
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
                  {/* Net Adj */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Net adj within</label>
                    <input
                      type="number"
                      value={compFilters.netAdjPct}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, netAdjPct: parseFloat(e.target.value) || 0 }))}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                      min="0"
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
                  {/* Gross Adj */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Gross adj within</label>
                    <input
                      type="number"
                      value={compFilters.grossAdjPct}
                      onChange={(e) => setCompFilters(prev => ({ ...prev, grossAdjPct: parseFloat(e.target.value) || 0 }))}
                      className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                      min="0"
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
                </div>
              </div>

              {/* Adjustment Grid Warning */}
              {adjustmentGrid.length === 0 && (
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-yellow-600">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-yellow-900 mb-1">
                        No Adjustment Grid Configured
                      </h4>
                      <p className="text-sm text-yellow-800 mb-2">
                        All comparable adjustments will be <strong>$0</strong> until you configure adjustment values.
                      </p>
                      <p className="text-xs text-yellow-700">
                        <strong>To fix:</strong> Go to the <button onClick={() => setActiveSubTab('adjustments')} className="underline font-semibold hover:text-yellow-900">Adjustments tab</button>,
                        review the default values, make any changes, and click <strong>"Save Adjustments"</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Evaluate Button */}
              <div className="mt-6 pt-6 border-t border-gray-300">
                <div className="flex flex-col items-center mb-4">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={evaluationMode === 'fresh'}
                        onChange={() => setEvaluationMode('fresh')}
                        className="rounded"
                      />
                      <span className="text-sm">Fresh evaluation (delete all saved results)</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={evaluationMode === 'keep'}
                        onChange={() => setEvaluationMode('keep')}
                        className="rounded"
                      />
                      <span className="text-sm">Keep saved results</span>
                    </label>
                  </div>

                  <button
                    onClick={handleEvaluate}
                    disabled={isEvaluating}
                    className="mt-3 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-lg"
                  >
                    {isEvaluating
                      ? `Evaluating ${evaluationProgress.current}/${evaluationProgress.total}...`
                      : 'Evaluate'
                    }
                  </button>
                </div>

                {/* Progress Bar */}
                {isEvaluating && evaluationProgress.total > 0 && (
                  <div className="mt-4 flex justify-center">
                    <span className="text-sm font-semibold text-blue-700 animate-pulse">
                      Evaluating {evaluationProgress.current} of {evaluationProgress.total} properties...
                    </span>
                  </div>
                )}
              </div>

              {/* Saved Result Sets */}
              {savedResultSets.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-medium text-gray-700 text-center mb-2">Saved Result Sets</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {savedResultSets.map(rs => (
                      <div key={rs.id} className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-3 py-1.5">
                        <button
                          onClick={() => handleLoadResultSet(rs.id)}
                          className="text-sm text-blue-700 hover:text-blue-900 hover:underline font-medium"
                        >
                          {rs.name}
                        </button>
                        <span className="text-xs text-gray-500 ml-1">({new Date(rs.created_at).toLocaleDateString()})</span>
                        <button
                          onClick={() => handleDeleteResultSet(rs.id, rs.name)}
                          className="ml-2 text-red-400 hover:text-red-600 text-sm font-bold"
                          title="Delete this result set"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* INLINE RESULTS - Show directly below search filters */}
            {evaluationResults && (
              <div ref={resultsRef} className="mt-6 bg-white border border-gray-300 rounded-lg p-4">
                {/* Summary Statistics */}
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-semibold text-gray-700">Total Evaluated:</span>
                      <span className="ml-2 text-gray-900">{evaluationResults.length} properties</span>
                    </div>
                    <div>
                      <span className="font-semibold text-red-700">No Comparables:</span>
                      <span className="ml-2 text-red-900 font-bold">
                        {evaluationResults.filter(r => r.comparables.length === 0).length} of {evaluationResults.length}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-green-700">With {minCompsForSuccess}+ Comps:</span>
                      <span className="ml-2 text-green-900 font-bold">
                        {evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess).length} of {evaluationResults.length}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-blue-700">Set Aside:</span>
                      <span className="ml-2 text-blue-900 font-bold">
                        {savedEvaluations.length}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Evaluation Results
                  </h3>
                  <div className="flex items-center gap-3">
                    {/* Minimum Comps Selector */}
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Min Comps:</label>
                      <select
                        value={minCompsForSuccess}
                        onChange={(e) => setMinCompsForSuccess(parseInt(e.target.value))}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        <option value="1">1+</option>
                        <option value="2">2+</option>
                        <option value="3">3+</option>
                        <option value="4">4+</option>
                        <option value="5">5</option>
                      </select>
                    </div>
                    <button
                      onClick={handleSetAsideSuccessful}
                      disabled={!evaluationResults || evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess).length === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      Set Aside
                    </button>
                    <button
                      onClick={handleSaveResultSet}
                      disabled={!evaluationResults || evaluationResults.length === 0}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      Save Result Set
                    </button>
                  </div>
                </div>

                {/* Results Table - Legacy Format */}
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-gray-100">
                      <tr>
                        {/* Subject Property Info */}
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">VCS</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">Block</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">Lot</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">Qual</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">Location</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">TypeUse</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold">Style</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold bg-yellow-50">Current Asmt</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold bg-green-50">New Asmt</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold bg-blue-50">%Change</th>
                        {/* Comparable Columns */}
                        {[1, 2, 3, 4, 5].map(num => (
                          <th key={num} colSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold bg-blue-50">
                            Comparable {num}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {/* Sub-headers for each comparable */}
                        {[1, 2, 3, 4, 5].map(num => (
                          <React.Fragment key={num}>
                            <th className="border border-gray-300 px-2 py-1 text-center text-xs font-medium">BLQ</th>
                            <th className="border border-gray-300 px-2 py-1 text-center text-xs font-medium">Adjusted Value</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {evaluationResults.map((result, idx) => {
                        // Decode Type Use and Style codes
                        const typeUseDecoded = codeDefinitions
                          ? interpretCodes.getTypeName(result.subject, codeDefinitions, vendorType)
                          : result.subject.asset_type_use;
                        const styleDecoded = codeDefinitions
                          ? interpretCodes.getDesignName(result.subject, codeDefinitions, vendorType)
                          : result.subject.asset_design_style;

                        // Format decoded values with code
                        const typeUseDisplay = typeUseDecoded && typeUseDecoded !== result.subject.asset_type_use
                          ? `${result.subject.asset_type_use}-${typeUseDecoded}`
                          : result.subject.asset_type_use || '';
                        const styleDisplay = styleDecoded && styleDecoded !== result.subject.asset_design_style
                          ? `${result.subject.asset_design_style}-${styleDecoded}`
                          : result.subject.asset_design_style || '';

                        return (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            {/* Subject Property Info */}
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm">{result.subject.property_vcs}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm font-medium">{result.subject.property_block}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm font-medium">{result.subject.property_lot}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm">{result.subject.property_qualifier || ''}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-xs max-w-xs truncate">{result.subject.property_location || ''}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-xs">{typeUseDisplay}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-xs">{styleDisplay}</td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold bg-yellow-50">
                              ${(result.subject.values_mod_total || result.subject.values_cama_total || 0).toLocaleString()}
                            </td>
                            <td
                              className="border border-gray-300 px-2 py-2 text-center text-sm font-bold bg-green-50 text-green-700 cursor-pointer hover:underline"
                              onClick={() => {
                                setManualEvaluationResult(result);
                                setActiveSubTab('detailed');
                              }}
                              title="Click to view detailed analysis"
                            >
                              {result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-'}
                            </td>
                            <td className="border border-gray-300 px-2 py-2 text-center text-sm font-semibold bg-blue-50">
                              {(() => {
                                const currentAsmt = result.subject.values_mod_total || result.subject.values_cama_total || 0;
                                const newAsmt = result.projectedAssessment;
                                if (!newAsmt || currentAsmt === 0) return '-';
                                const changePercent = ((newAsmt - currentAsmt) / currentAsmt) * 100;
                                const color = changePercent > 0 ? 'text-green-700' : changePercent < 0 ? 'text-red-700' : 'text-gray-700';
                                return (
                                  <span className={color}>
                                    {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                  </span>
                                );
                              })()}
                            </td>
                            {/* Comparables 1-5 */}
                            {[0, 1, 2, 3, 4].map(compIdx => {
                              const comp = result.comparables[compIdx];
                              if (!comp) {
                                return (
                                  <React.Fragment key={compIdx}>
                                    <td className="border border-gray-300 px-2 py-2 text-center text-xs text-red-600 font-semibold">NO COMPS</td>
                                    <td className="border border-gray-300 px-2 py-2 text-center text-xs text-red-600 font-semibold">$0</td>
                                  </React.Fragment>
                                );
                              }
                              // Format BLQ with / separator and preserve full values
                              const blqFormatted = `${comp.property_block}/${comp.property_lot}${comp.property_qualifier && comp.property_qualifier !== 'NONE' ? `/${comp.property_qualifier}` : ''}`;

                              return (
                                <React.Fragment key={compIdx}>
                                  <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                                    {blqFormatted}
                                  </td>
                                  <td className="border border-gray-300 px-2 py-2 text-center text-xs font-semibold">
                                    ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ==================== VALUATION SUMMARY PANEL ==================== */}
                {(() => {
                  const successful = evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess);
                  const skipped = evaluationResults.filter(r => r.comparables.length < minCompsForSuccess);

                  // Build class summary from successful evaluations
                  const classSummary = {};
                  let totalCurrentLand = 0, totalCurrentImpr = 0, totalCurrentTotal = 0;
                  let totalNewValue = 0;

                  successful.forEach(r => {
                    const m4Class = r.subject.property_m4_class || 'Unknown';
                    if (!classSummary[m4Class]) classSummary[m4Class] = { count: 0, currentTotal: 0, newTotal: 0 };
                    classSummary[m4Class].count++;
                    const currentTotal = r.subject.values_mod_total || r.subject.values_cama_total || 0;
                    const currentLand = r.subject.values_cama_land || r.subject.values_mod_land || 0;
                    classSummary[m4Class].currentTotal += currentTotal;
                    classSummary[m4Class].newTotal += (r.projectedAssessment || 0);
                    totalCurrentLand += currentLand;
                    totalCurrentImpr += (currentTotal - currentLand);
                    totalCurrentTotal += currentTotal;
                    totalNewValue += (r.projectedAssessment || 0);
                  });

                  return (
                    <div className="mt-6 space-y-4">
                      {/* Skipped / Missing Comps */}
                      {skipped.length > 0 && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-amber-800 mb-2">
                            Skipped Properties ({skipped.length}) — Fewer than {minCompsForSuccess} comparable(s)
                          </h4>
                          <div className="max-h-40 overflow-y-auto">
                            <table className="min-w-full text-xs">
                              <thead>
                                <tr className="bg-amber-100">
                                  <th className="px-2 py-1 text-left">VCS</th>
                                  <th className="px-2 py-1 text-left">Block</th>
                                  <th className="px-2 py-1 text-left">Lot</th>
                                  <th className="px-2 py-1 text-left">Location</th>
                                  <th className="px-2 py-1 text-center">Comps Found</th>
                                  <th className="px-2 py-1 text-center">Current Asmt</th>
                                </tr>
                              </thead>
                              <tbody>
                                {skipped.map((r, idx) => (
                                  <tr key={idx} className="border-t border-amber-200">
                                    <td className="px-2 py-1">{r.subject.property_vcs}</td>
                                    <td className="px-2 py-1">{r.subject.property_block}</td>
                                    <td className="px-2 py-1">{r.subject.property_lot}</td>
                                    <td className="px-2 py-1">{r.subject.property_location}</td>
                                    <td className="px-2 py-1 text-center text-red-600 font-bold">{r.comparables.length}</td>
                                    <td className="px-2 py-1 text-center">${(r.subject.values_mod_total || r.subject.values_cama_total || 0).toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Net Valuation Summary */}
                      <div className="bg-white border border-gray-300 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">
                          Projected Net Valuation Summary — CME Sales Comparison
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="border border-gray-300 px-3 py-2 text-left">Class</th>
                                <th className="border border-gray-300 px-3 py-2 text-center">Count</th>
                                <th className="border border-gray-300 px-3 py-2 text-right">Current Total</th>
                                <th className="border border-gray-300 px-3 py-2 text-right">New Projected</th>
                                <th className="border border-gray-300 px-3 py-2 text-right">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(classSummary).sort((a, b) => a[0].localeCompare(b[0])).map(([cls, data]) => {
                                const change = data.currentTotal > 0 ? ((data.newTotal - data.currentTotal) / data.currentTotal * 100) : 0;
                                return (
                                  <tr key={cls} className="border-t">
                                    <td className="border border-gray-300 px-3 py-1 font-medium">{cls}</td>
                                    <td className="border border-gray-300 px-3 py-1 text-center">{data.count}</td>
                                    <td className="border border-gray-300 px-3 py-1 text-right">${data.currentTotal.toLocaleString()}</td>
                                    <td className="border border-gray-300 px-3 py-1 text-right font-semibold">${data.newTotal.toLocaleString()}</td>
                                    <td className={`border border-gray-300 px-3 py-1 text-right font-semibold ${change > 0 ? 'text-green-700' : change < 0 ? 'text-red-700' : ''}`}>
                                      {change > 0 ? '+' : ''}{change.toFixed(2)}%
                                    </td>
                                  </tr>
                                );
                              })}
                              <tr className="bg-gray-100 font-bold">
                                <td className="border border-gray-300 px-3 py-2">Total</td>
                                <td className="border border-gray-300 px-3 py-2 text-center">{successful.length}</td>
                                <td className="border border-gray-300 px-3 py-2 text-right">${totalCurrentTotal.toLocaleString()}</td>
                                <td className="border border-gray-300 px-3 py-2 text-right">${totalNewValue.toLocaleString()}</td>
                                <td className={`border border-gray-300 px-3 py-2 text-right ${totalCurrentTotal > 0 && ((totalNewValue - totalCurrentTotal) / totalCurrentTotal * 100) > 0 ? 'text-green-700' : 'text-red-700'}`}>
                                  {totalCurrentTotal > 0 ? `${((totalNewValue - totalCurrentTotal) / totalCurrentTotal * 100) > 0 ? '+' : ''}${((totalNewValue - totalCurrentTotal) / totalCurrentTotal * 100).toFixed(2)}%` : '-'}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Export Buttons */}
                        <div className="mt-4 flex gap-3 justify-end">
                          <button
                            onClick={() => handleCreateUpdate(successful)}
                            disabled={successful.length === 0}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                          >
                            <Upload className="w-4 h-4" />
                            Create Update
                          </button>
                          <button
                            onClick={() => handleBuildFinalRoster(successful, skipped)}
                            disabled={successful.length === 0}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                          >
                            <FileText className="w-4 h-4" />
                            Build Final Roster
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              </div>
            )}
          </div>
        )}


        {/* DETAILED TAB */}
        {activeSubTab === 'detailed' && (
          <div className="space-y-6">
            {/* Header with Manual Entry Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Manual Property Evaluation</h3>
              <p className="text-sm text-blue-700">
                Enter BLQ (Block/Lot/Qualifier) info below to fetch properties and run an appraisal evaluation without using the Search tab.
              </p>
            </div>

            {/* Manual Entry Grid */}
            <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
              <div className="bg-gray-100 px-4 py-3 border-b border-gray-300">
                <h4 className="font-semibold text-gray-900">Property Entry</h4>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 border-b-2 border-gray-300">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700"></th>
                      <th className="px-3 py-2 text-center font-semibold bg-yellow-50">Subject</th>
                      <th className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300">Comparable 1</th>
                      <th className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300">Comparable 2</th>
                      <th className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300">Comparable 3</th>
                      <th className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300">Comparable 4</th>
                      <th className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300">Comparable 5</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {/* Block */}
                    <tr className="border-t border-gray-200">
                      <td className="px-3 py-2 font-medium text-gray-700">Block</td>
                      <td className="px-3 py-2 text-center bg-yellow-50">
                        <input
                          type="text"
                          value={manualSubject.block}
                          onChange={(e) => setManualSubject(prev => ({ ...prev, block: e.target.value }))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                          placeholder="Block"
                          tabIndex={1}
                        />
                      </td>
                      {manualComps.map((comp, idx) => (
                        <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                          <input
                            type="text"
                            value={comp.block}
                            onChange={(e) => {
                              const newComps = [...manualComps];
                              newComps[idx] = { ...newComps[idx], block: e.target.value };
                              setManualComps(newComps);
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                            placeholder="Block"
                            tabIndex={4 + (idx * 3)}
                          />
                        </td>
                      ))}
                    </tr>

                    {/* Lot */}
                    <tr className="border-t border-gray-200">
                      <td className="px-3 py-2 font-medium text-gray-700">Lot</td>
                      <td className="px-3 py-2 text-center bg-yellow-50">
                        <input
                          type="text"
                          value={manualSubject.lot}
                          onChange={(e) => setManualSubject(prev => ({ ...prev, lot: e.target.value }))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                          placeholder="Lot"
                          tabIndex={2}
                        />
                      </td>
                      {manualComps.map((comp, idx) => (
                        <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                          <input
                            type="text"
                            value={comp.lot}
                            onChange={(e) => {
                              const newComps = [...manualComps];
                              newComps[idx] = { ...newComps[idx], lot: e.target.value };
                              setManualComps(newComps);
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                            placeholder="Lot"
                            tabIndex={5 + (idx * 3)}
                          />
                        </td>
                      ))}
                    </tr>

                    {/* Qualifier */}
                    <tr className="border-t border-gray-200">
                      <td className="px-3 py-2 font-medium text-gray-700">Qual</td>
                      <td className="px-3 py-2 text-center bg-yellow-50">
                        <input
                          type="text"
                          value={manualSubject.qualifier}
                          onChange={(e) => setManualSubject(prev => ({ ...prev, qualifier: e.target.value }))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                          placeholder="Qual"
                          tabIndex={3}
                        />
                      </td>
                      {manualComps.map((comp, idx) => (
                        <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                          <input
                            type="text"
                            value={comp.qualifier}
                            onChange={(e) => {
                              const newComps = [...manualComps];
                              newComps[idx] = { ...newComps[idx], qualifier: e.target.value };
                              setManualComps(newComps);
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                            placeholder="Qual"
                            tabIndex={6 + (idx * 3)}
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-300">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleManualEvaluate}
                    disabled={isManualEvaluating}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
                  >
                    {isManualEvaluating ? 'Evaluating...' : 'Evaluate'}
                  </button>
                  <button
                    onClick={handleManualEvaluate}
                    disabled={isManualEvaluating}
                    className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-50 font-medium text-sm"
                  >
                    {isManualEvaluating ? 'Evaluating...' : 'Evaluate and update'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleClearManualComps}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 font-medium text-sm"
                  >
                    Clear Comps
                  </button>
                </div>
              </div>
            </div>

            {/* Results Section (if evaluation has been run) */}
            {manualEvaluationResult && (
              <div ref={detailedResultsRef}>
                <DetailedAppraisalGrid
                  result={manualEvaluationResult}
                  jobData={jobData}
                  codeDefinitions={codeDefinitions}
                  vendorType={vendorType}
                  adjustmentGrid={adjustmentGrid}
                  compFilters={compFilters}
                  cmeBrackets={CME_BRACKETS}
                  isJobContainerLoading={isJobContainerLoading}
                  allProperties={properties}
                />
              </div>
            )}
          </div>
        )}

      </div>

      {/* Import Block/Lot/Qual Modal */}
      {showManualEntryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Import Block/Lot/Qual</h3>
              <button
                onClick={() => setShowManualEntryModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Expected Columns</h4>
                <p className="text-sm text-blue-800 mb-2">
                  Your CSV or Excel file should contain the following columns:
                </p>
                <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                  <li><strong>ccdd</strong> — County/District code (optional)</li>
                  <li><strong>block</strong> — Block number (required)</li>
                  <li><strong>lot</strong> — Lot number (required)</li>
                  <li><strong>qualifier</strong> — Qualifier (optional)</li>
                  <li><strong>location</strong> — Property address (optional)</li>
                </ul>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-xs text-yellow-800">
                  <strong>Note:</strong> Only Card 1 (BRT) or M/Main (Microsystems) properties will be matched.
                </p>
              </div>

              <div className="pt-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Select File</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    try {
                      const data = await file.arrayBuffer();
                      const workbook = XLSX.read(data);
                      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                      const jsonData = XLSX.utils.sheet_to_json(worksheet);

                      // Map columns (case-insensitive)
                      const imported = jsonData.map(row => {
                        const block = row.Block || row.block || row.BLOCK || '';
                        const lot = row.Lot || row.lot || row.LOT || '';
                        const qualifier = row.Qualifier || row.qualifier || row.QUALIFIER || row.Qual || row.qual || '';
                        if (!block || !lot) return null;
                        return `${block}-${lot}${qualifier ? `-${qualifier}` : ''}`;
                      }).filter(key => key);

                      setManualProperties(prev => {
                        const combined = [...new Set([...prev, ...imported])];
                        return combined;
                      });

                      setShowManualEntryModal(false);
                      alert(`Imported ${imported.length} properties`);
                    } catch (error) {
                      console.error('Error importing file:', error);
                      alert('Failed to import file. Please check the format.');
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end">
              <button
                onClick={() => setShowManualEntryModal(false)}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesComparisonTab;
