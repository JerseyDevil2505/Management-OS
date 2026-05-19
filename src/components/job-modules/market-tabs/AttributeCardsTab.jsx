import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Layers, FileText, ChevronDown, ChevronRight, Info } from 'lucide-react';
import './sharedTabNav.css';
import { supabase, propertyService, interpretCodes } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const CSV_BUTTON_CLASS = 'inline-flex items-center gap-2 px-3 py-1.5 border rounded bg-white text-sm text-gray-700 hover:bg-gray-50';

// Jim's size normalization formula
function sizeNormalize(salePrice, saleSize, targetSize) {
  if (!saleSize || saleSize <= 0 || !salePrice) return salePrice || null;
  if (!targetSize || targetSize <= 0) return salePrice;
  const repl = salePrice;
  const adj = ((targetSize - saleSize) * ((salePrice / saleSize) * 0.50));
  return Math.round(repl + adj);
}

// Helper to format currency
function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  }).format(value);
}

// Helper to format percentage
function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

// Helper to download CSV
function downloadCsv(filename, headers, rows) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const AttributeCardsTab = ({ jobData = {}, properties = [], marketLandData = {}, onUpdateJobCache = () => {} }) => {
  const vendorType = jobData?.vendor_type || jobData?.vendor_source || 'BRT';
  const parsedCodeDefinitions = useMemo(() => jobData?.parsed_code_definitions || {}, [jobData?.parsed_code_definitions]);
  const infoByCodes = useMemo(() => jobData?.info_by_config || {}, [jobData?.info_by_config]);

  // Track which job ID we've loaded baseline settings for (to prevent redundant loads)
  const loadedJobIdRef = useRef(null);
  // Track inputs that produced the current additionalResults to avoid re-running
  const additionalAnalysisKeyRef = useRef(null);

  // Main tab state
  const [active, setActive] = useState('condition');

  // ============ CONDITION ANALYSIS STATE ============
  const [typeUseFilter, setTypeUseFilter] = useState('1');
  const [useInteriorInspections, setUseInteriorInspections] = useState(true);
  const [expandedExteriorVCS, setExpandedExteriorVCS] = useState(new Set()); // Track which exterior VCS sections are expanded
  const [expandedInteriorVCS, setExpandedInteriorVCS] = useState(new Set()); // Track which interior VCS sections are expanded
  const [manualExteriorBaseline, setManualExteriorBaseline] = useState('');
  const [manualInteriorBaseline, setManualInteriorBaseline] = useState('');

  // Condition classifications for export
  const [exteriorBetterConditions, setExteriorBetterConditions] = useState([]);
  const [exteriorWorseConditions, setExteriorWorseConditions] = useState([]);
  const [interiorBetterConditions, setInteriorBetterConditions] = useState([]);
  const [interiorWorseConditions, setInteriorWorseConditions] = useState([]);

  // UI state for condition configuration modal
  const [showConditionConfig, setShowConditionConfig] = useState(false);
  const [configType, setConfigType] = useState('exterior'); // 'exterior' or 'interior'
  const [conditionData, setConditionData] = useState({
    exterior: {},
    interior: {},
    loading: true,
    error: null
  });
  const [availableConditionCodes, setAvailableConditionCodes] = useState({
    exterior: {},
    interior: {}
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState(false);
  const [conditionHandlingMethod, setConditionHandlingMethod] = useState('effective_age'); // 'condition_table', 'effective_age', or 'ncovr_override'
  const [conditionEquivalents, setConditionEquivalents] = useState({}); // Map of condition equivalencies (e.g., { 'MODERN': 'GOOD' })
  const [newEquivalentFrom, setNewEquivalentFrom] = useState(''); // For new mapping being added
  const [newEquivalentTo, setNewEquivalentTo] = useState(''); // For new mapping being added

  // ============ CUSTOM ATTRIBUTE STATE ============
  // Dropdown options come from the same misc/detached code source used by
  // AdjustmentsTab (categories '39' Miscellaneous + '15' Detached). Each
  // option is { code, description, category }. Two independent selects so
  // assessors can study a Misc code OR a Detached code without scrolling
  // through a combined list.
  const [codeOptions, setCodeOptions] = useState([]);
  const [selectedMiscCode, setSelectedMiscCode] = useState('');
  const [selectedDetachedCode, setSelectedDetachedCode] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);
  // codeCountCache: Map<"category:CODE", { totalProps, qualifiedSales }> populated
  // on first run / on-demand prefetch so the banner can show how many properties
  // carry the currently-selected code before a study is even run.
  const [codeCountCache, setCodeCountCache] = useState({});
  const [prefetchingCounts, setPrefetchingCounts] = useState(false);
  // Persisted studies for this job (job_custom_attribute_studies)
  const [savedStudies, setSavedStudies] = useState([]);
  const [loadingStudies, setLoadingStudies] = useState(false);
  const [activeStudyId, setActiveStudyId] = useState(null);
  // Type/Use filter — same pattern as eco obs; prevents single-family from
  // mixing with condo / multi-family in the same study.
  const [customTypeUseFilter, setCustomTypeUseFilter] = useState('1');

  // ============ ADDITIONAL CARDS STATE ============
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);
  const [sortField, setSortField] = useState('new_vcs'); // Default sort by VCS
  const [sortDirection, setSortDirection] = useState('asc');
  const [expandedAdditionalVCS, setExpandedAdditionalVCS] = useState(new Set()); // Track which additional cards VCS sections are expanded (collapsed by default)

  // ============ PROPERTY MARKET DATA STATE ============
  const [propertyMarketData, setPropertyMarketData] = useState([]);

  // ============ BASEMENT TYPE CONFIG STATE ============
  // Shape: {
  //   codes: { "<BRT_CODE>": { mode: 'living' | 'subtract' } },  // absence = Off
  //   microsystemsMode: 'living' | 'subtract' | undefined,        // Microsystems global
  // }
  // 'living' = SFLA already includes the basement (badge fires, finished-basement
  // CME adjustment is suppressed). 'subtract' = strip basement SF out of SFLA
  // and let the finished-basement CME adjustment fire normally.
  const normalizeBasementConfig = (raw) => {
    const out = { codes: {}, microsystemsMode: undefined };
    if (!raw || typeof raw !== 'object') return out;
    if (raw.codes && typeof raw.codes === 'object') {
      Object.entries(raw.codes).forEach(([code, cfg]) => {
        if (!cfg) return;
        // Backwards-compat: collapse the old { isLiving, subtract } shape
        let mode = cfg.mode;
        if (!mode) {
          if (cfg.subtract) mode = 'subtract';
          else if (cfg.isLiving) mode = 'living';
        }
        if (mode === 'living' || mode === 'subtract') {
          out.codes[code.toUpperCase()] = { mode };
        }
      });
    }
    if (raw.microsystemsMode === 'living' || raw.microsystemsMode === 'subtract') {
      out.microsystemsMode = raw.microsystemsMode;
    } else if (raw.microsystemsSubtract) {
      out.microsystemsMode = 'subtract';
    }
    return out;
  };

  const [basementConfig, setBasementConfig] = useState(() => normalizeBasementConfig(marketLandData?.basement_type_config));
  const [basementSaving, setBasementSaving] = useState(false);
  const [basementSaved, setBasementSaved] = useState(false);
  const [basementSeedApplied, setBasementSeedApplied] = useState(false);

  // Get Type/Use options - CORRECTED based on actual codebase patterns
  const getTypeUseOptions = () => [
    { code: 'all', description: 'All Properties' },
    { code: '1', description: '1 — Single Family' },
    { code: '2', description: '2 — Duplex / Semi-Detached' },
    { code: '3', description: '3* — Row / Townhouse (3E,3I,30,31)' },
    { code: '4', description: '4* — MultiFamily (42,43,44)' },
    { code: '5', description: '5* — Conversions (51,52,53)' },
    { code: '6', description: '6 — Condominium' },
    { code: 'all_residential', description: 'All Residential' }
  ];


  // Helper function to filter properties by type/use
  const filterPropertiesByType = (props, filterValue) => {
    if (filterValue === 'all') return props;
    
    return props.filter(p => {
      const typeUse = (p.asset_type_use || '').toString().trim();
      
      if (filterValue === 'all_residential') {
        return typeUse === '' || ['1','2','3','4','5','6'].some(prefix => typeUse.startsWith(prefix));
      } else if (filterValue === '1') {
        return typeUse === '' || typeUse.startsWith('1');
      } else if (filterValue === '2') {
        return typeUse.startsWith('2');
      } else if (filterValue === '3') {
        return ['3E','3I','30','31'].includes(typeUse);
      } else if (filterValue === '4') {
        return ['42','43','44'].includes(typeUse);
      } else if (filterValue === '5') {
        return ['51','52','53'].includes(typeUse);
      } else if (filterValue === '6') {
        return typeUse.startsWith('6');
      }
      
      return false;
    });
  };
  // ============ DETECT ALL AVAILABLE CONDITION CODES FROM CODE DEFINITIONS ============
  const detectActualConditionCodes = useCallback(async () => {
    try {
      const exterior = {};
      const interior = {};

      if (!parsedCodeDefinitions) {
        return { exterior, interior };
      }

      if (vendorType === 'BRT') {
        // Try common BRT condition code values (01-20 covers most systems)
        // Use interpretCodes helper which knows how to navigate the structure
        for (let i = 1; i <= 20; i++) {
          const code = String(i).padStart(2, '0');

          const extDesc = interpretCodes.getExteriorConditionName(
            { asset_ext_cond: code },
            parsedCodeDefinitions,
            vendorType
          );

          const intDesc = interpretCodes.getInteriorConditionName(
            { asset_int_cond: code },
            parsedCodeDefinitions,
            vendorType
          );

          if (extDesc && extDesc !== code) {
            exterior[code] = extDesc;
          }

          if (intDesc && intDesc !== code) {
            interior[code] = intDesc;
          }
        }
      } else if (vendorType === 'Microsystems') {
        // Microsystems stores codes in field_codes with prefixes
        const fieldCodes = parsedCodeDefinitions?.field_codes || {};

        // Exterior condition codes have prefix '490'
        const exteriorCodes = fieldCodes['490'] || {};
        Object.entries(exteriorCodes).forEach(([code, codeData]) => {
          if (codeData.description) {
            exterior[code] = codeData.description;
          }
        });

        // Interior condition codes have prefix '491'
        const interiorCodes = fieldCodes['491'] || {};
        Object.entries(interiorCodes).forEach(([code, codeData]) => {
          if (codeData.description) {
            interior[code] = codeData.description;
          }
        });
      }

      return { exterior, interior };
    } catch (error) {
      console.error('Error detecting condition codes:', error);
      return { exterior: {}, interior: {} };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCodeDefinitions, vendorType]);

  // ============ PROCESS CONDITION STATISTICS ============
  const processConditionStatistics = (dataByVCS) => {
    const processed = {};

    Object.entries(dataByVCS).forEach(([vcs, conditions]) => {
      processed[vcs] = {};

      // Calculate averages for each condition
      Object.entries(conditions).forEach(([code, data]) => {
        const count = data.values.length;
        if (count === 0) return;

        const avgValue = data.values.reduce((a, b) => a + b, 0) / count;
        const validSizes = data.sizes.filter(s => s > 0);
        const avgSize = validSizes.length > 0 ?
          validSizes.reduce((a, b) => a + b, 0) / validSizes.length : 0;
        const validYears = data.years.filter(y => y > 1900 && y < 2030);
        const avgYear = validYears.length > 0 ?
          Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length) : null;

        processed[vcs][code] = {
          ...data,
          count,
          avgValue: Math.round(avgValue),
          avgSize: Math.round(avgSize),
          avgYear
        };
      });

      // Find baseline - use manual selection or auto-detect
      let baseline = null;

      // Determine if this is exterior or interior analysis
      const isExteriorAnalysis = Object.values(processed[vcs]).some(data =>
        data.properties?.some(prop => prop.asset_ext_cond)
      );
      const isInteriorAnalysis = Object.values(processed[vcs]).some(data =>
        data.properties?.some(prop => prop.asset_int_cond)
      );

      const manualBaseline = isExteriorAnalysis ? manualExteriorBaseline :
                           isInteriorAnalysis ? manualInteriorBaseline : '';

      // Use manual baseline if set
      if (manualBaseline && processed[vcs][manualBaseline]) {
        baseline = processed[vcs][manualBaseline];
      } else {
        // Auto-detect baseline condition
        Object.entries(processed[vcs]).forEach(([code, data]) => {
          const desc = data.description.toUpperCase();
          if (desc.includes('AVERAGE') || desc.includes('NORMAL') || code === '03' || code === 'A') {
            baseline = data;
          }
        });

        // If no average found, use the condition with most properties
        if (!baseline) {
          let maxCount = 0;
          Object.values(processed[vcs]).forEach(data => {
            if (data.count > maxCount) {
              maxCount = data.count;
              baseline = data;
            }
          });
        }
      }
      
      // Calculate size-normalized values and adjustments
      if (baseline && baseline.avgSize > 0) {
        Object.values(processed[vcs]).forEach(condData => {
          condData.adjustedValue = sizeNormalize(condData.avgValue, condData.avgSize, baseline.avgSize);
          condData.adjustment = condData.adjustedValue - baseline.avgValue;
          condData.adjustmentPct = ((condData.adjustedValue - baseline.avgValue) / baseline.avgValue) * 100;
        });
      } else {
        // No baseline or size, just use raw differences
        Object.values(processed[vcs]).forEach(condData => {
          condData.adjustedValue = condData.avgValue;
          condData.adjustment = 0;
          condData.adjustmentPct = 0;
        });
      }
    });

    return processed;
  };

  // ============ MAIN DATA LOADING FUNCTION ============
  const loadConditionAnalysisData = async () => {
    try {
      setConditionData(prev => ({ ...prev, loading: true, error: null }));

      // Detect actual codes from the property data
      const codes = await detectActualConditionCodes();
      setAvailableConditionCodes(codes);

      // Load property market analysis data for values_norm_time
      const { data: marketData, error: marketError } = await supabase
        .from('property_market_analysis')
        .select('property_composite_key, values_norm_time')
        .eq('job_id', jobData.id)
        .not('values_norm_time', 'is', null)
        .gt('values_norm_time', 0);

      if (marketError) throw marketError;

      const marketMap = new Map(
        (marketData || []).map(m => [m.property_composite_key, m.values_norm_time])
      );

      // Load inspection data if filtering by interior inspections
      let inspectionMap = new Map();
      if (useInteriorInspections) {
        try {
          const { data: inspections, error: inspError } = await supabase
            .from('inspection_data')
            .select('property_composite_key')
            .eq('job_id', jobData.id);

          if (inspError) {
            console.error('Inspection data query error:', inspError);
            throw new Error(`Failed to load inspection data: ${inspError.message || inspError}`);
          }

          // Use the InfoBy configuration that the user already defined in the jobs table
          // Since the user defines what constitutes an "entry" in info_by_config,
          // we include all inspections as the user has already configured this properly
          const entryInfoByCodes = Array.isArray(infoByCodes.entry) ? infoByCodes.entry : [];

          if (entryInfoByCodes.length === 0) {
            console.warn('No entry InfoBy codes found in job.info_by_config. Including all inspections for interior analysis.');
            console.log('Available info_by_config:', infoByCodes);
          } else {
            console.log('Entry InfoBy codes from job config:', entryInfoByCodes);
          }

          // Include all inspections since the user has already defined entry criteria in job config
          inspectionMap = new Map(
            (inspections || []).map(i => [i.property_composite_key, true])
          );

          console.log(`Interior inspections filter: ${inspectionMap.size} properties have inspection data`);
        } catch (inspectionError) {
          console.error('Error processing inspection data:', inspectionError);
          throw new Error(`Inspection data processing failed: ${inspectionError.message || inspectionError}`);
        }
      }

      // Filter properties by type/use
      const filteredProps = filterPropertiesByType(properties, typeUseFilter);

      // Process properties by VCS and condition
      const exteriorByVCS = {};
      const interiorByVCS = {};

      for (const prop of filteredProps) {
        const vcs = prop.new_vcs || prop.property_vcs || 'UNKNOWN';
        const extCond = prop.asset_ext_cond || '';
        const intCond = prop.asset_int_cond || '';
        const valueNormTime = marketMap.get(prop.property_composite_key);

        // Skip if no sale value
        if (!valueNormTime || valueNormTime <= 0) continue;

        // Process exterior condition (skip '00' for BRT)
        if (extCond && extCond !== '00' && extCond !== '0' && extCond.trim() !== '') {
          if (!exteriorByVCS[vcs]) exteriorByVCS[vcs] = {};
          if (!exteriorByVCS[vcs][extCond]) {
            exteriorByVCS[vcs][extCond] = {
              description: codes.exterior[extCond] || `Condition ${extCond}`,
              properties: [],
              values: [],
              sizes: [],
              years: []
            };
          }

          exteriorByVCS[vcs][extCond].properties.push(prop);
          exteriorByVCS[vcs][extCond].values.push(valueNormTime);
          exteriorByVCS[vcs][extCond].sizes.push(prop.asset_sfla || prop.sfla || prop.property_sfla || 0);
          exteriorByVCS[vcs][extCond].years.push(prop.asset_year_built || prop.year_built || prop.property_year_built || 0);
        }

        // Process interior condition
        const shouldIncludeInterior = !useInteriorInspections || inspectionMap.has(prop.property_composite_key);

        if (intCond && intCond !== '00' && intCond !== '0' && intCond.trim() !== '' && shouldIncludeInterior) {
          if (!interiorByVCS[vcs]) interiorByVCS[vcs] = {};
          if (!interiorByVCS[vcs][intCond]) {
            // Get interior condition description using interpretCodes function directly if not in codes object
            let description = codes.interior[intCond];
            if (!description) {
              description = interpretCodes.getInteriorConditionName(
                { asset_int_cond: intCond },
                parsedCodeDefinitions,
                vendorType
              ) || `Condition ${intCond}`;
            }

            interiorByVCS[vcs][intCond] = {
              description,
              properties: [],
              values: [],
              sizes: [],
              years: []
            };
          }

          interiorByVCS[vcs][intCond].properties.push(prop);
          interiorByVCS[vcs][intCond].values.push(valueNormTime);
          interiorByVCS[vcs][intCond].sizes.push(prop.asset_sfla || prop.sfla || prop.property_sfla || 0);
          interiorByVCS[vcs][intCond].years.push(prop.asset_year_built || prop.year_built || prop.property_year_built || 0);
        }
      }

      // Calculate statistics and adjustments
      const processedExterior = processConditionStatistics(exteriorByVCS);
      const processedInterior = processConditionStatistics(interiorByVCS);

      setConditionData({
        exterior: processedExterior,
        interior: processedInterior,
        loading: false,
        error: null
      });

    } catch (error) {
      console.error('Error loading condition analysis data:', {
        message: error.message || error,
        stack: error.stack,
        error: error
      });

      setConditionData(prev => ({
        ...prev,
        loading: false,
        error: `Failed to load condition data: ${error.message || error}`
      }));
    }
  };

  // ============ SAVE/LOAD CONDITION CONFIG TO DATABASE ============
  const saveConditionConfigToDatabase = async () => {
    if (!jobData?.id) return;

    // Validation: require both exterior and interior to be configured UNLESS using NCOVR
    if (conditionHandlingMethod !== 'ncovr_override' && (!manualExteriorBaseline || !manualInteriorBaseline)) {
      alert('Please define both Exterior and Interior baseline conditions before saving.');
      return;
    }

    try {
      setIsSavingConfig(true);
      setConfigSaveSuccess(false);

      const config = {
        exterior: {
          baseline: manualExteriorBaseline,
          better: exteriorBetterConditions,
          worse: exteriorWorseConditions
        },
        interior: {
          baseline: manualInteriorBaseline,
          better: interiorBetterConditions,
          worse: interiorWorseConditions
        },
        conditionHandlingMethod: conditionHandlingMethod, // 'condition_table', 'effective_age', or 'ncovr_override'
        ...(conditionHandlingMethod === 'ncovr_override' && {
          ncorv_scale: {
            excellent: { min: 0.86, max: 1.00, name: 'Excellent' },
            good: { min: 0.71, max: 0.85, name: 'Good' },
            average: { min: 0.56, max: 0.70, name: 'Average' },
            fair: { min: 0.41, max: 0.55, name: 'Fair' },
            poor: { min: 0.26, max: 0.40, name: 'Poor' },
            dilapidated: { min: 0.01, max: 0.25, name: 'Dilapidated' }
          }
        }),
        conditionEquivalents: conditionEquivalents, // Map conditions to their rank equivalents
        savedAt: new Date().toISOString()
      };

      const { error } = await supabase
        .from('jobs')
        .update({ attribute_condition_config: config })
        .eq('id', jobData.id);

      if (error) throw error;

      // Show success message
      setConfigSaveSuccess(true);
      setTimeout(() => setConfigSaveSuccess(false), 3000);

      // Update parent cache
      if (onUpdateJobCache) {
        onUpdateJobCache({ attribute_condition_config: config });
      }

      console.log('✅ Condition configuration saved to database:', config);
    } catch (error) {
      console.error('❌ Error saving condition configuration:', error);
      alert(`Failed to save configuration: ${error.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const loadConditionConfigFromDatabase = useCallback(async () => {
    if (!jobData?.id) return;

    try {
      const config = jobData.attribute_condition_config;

      if (config) {
        // Load exterior config
        if (config.exterior) {
          if (config.exterior.baseline) setManualExteriorBaseline(config.exterior.baseline);
          if (config.exterior.better) setExteriorBetterConditions(config.exterior.better);
          if (config.exterior.worse) setExteriorWorseConditions(config.exterior.worse);
        }

        // Load interior config
        if (config.interior) {
          if (config.interior.baseline) setManualInteriorBaseline(config.interior.baseline);
          if (config.interior.better) setInteriorBetterConditions(config.interior.better);
          if (config.interior.worse) setInteriorWorseConditions(config.interior.worse);
        }

        // Load condition handling method (including NCOVR support)
        if (config.conditionHandlingMethod) {
          setConditionHandlingMethod(config.conditionHandlingMethod);
        }

        // Load condition equivalents
        if (config.conditionEquivalents) {
          setConditionEquivalents(config.conditionEquivalents);
        }

        // Note: NCOVR scale is stored in config.ncorv_scale if needed by other components
        console.log('✅ Condition configuration loaded from database:', config);
      }
    } catch (error) {
      console.error('❌ Error loading condition configuration:', error);
    }
  }, [jobData?.id, jobData?.attribute_condition_config]);

  // Load config from database on mount
  useEffect(() => {
    if (jobData?.id && loadedJobIdRef.current !== jobData.id) {
      loadConditionConfigFromDatabase();
    }
  }, [jobData?.id, loadConditionConfigFromDatabase]);

  // Load data on component mount and when filters change
  useEffect(() => {
    if (!jobData?.id || properties.length === 0) return;

    loadConditionAnalysisData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, properties.length, typeUseFilter, useInteriorInspections, manualExteriorBaseline, manualInteriorBaseline]);

  // Add this useEffect to run the analysis on mount and when data changes
  useEffect(() => {
    if (active === 'additional' && properties && properties.length > 0) {
      // Only re-run if inputs actually changed
      const cacheKey = `${properties.length}-${vendorType}`;
      if (additionalAnalysisKeyRef.current !== cacheKey) {
        runAdditionalCardsAnalysis();
        additionalAnalysisKeyRef.current = cacheKey;
      }
    }
  }, [active, properties, vendorType]);
  // ============ BUILD CONDITION CASCADE TABLE ============
  const renderConditionTable = (data, type, expandedVCS, setExpandedVCS) => {
    const vcsKeys = Object.keys(data).sort();

    if (vcsKeys.length === 0) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280' }}>
          No data available for {type} condition analysis
        </div>
      );
    }

    // Get manual baseline configuration
    const manualBaseline = type === 'Exterior' ? manualExteriorBaseline : manualInteriorBaseline;

    // Calculate non-baseline summary across all VCS
    const nonBaselineSummary = calculateNonBaselineSummary(data, type);

    return (
      <div style={{ marginBottom: '20px' }}>
        {vcsKeys.map(vcs => {
          const conditions = data[vcs];
          const isExpanded = expandedVCS.has(vcs);
          const conditionCodes = Object.keys(conditions).sort();

          // Toggle VCS expansion function
          const toggleVCS = () => {
            const newExpanded = new Set(expandedVCS);
            if (newExpanded.has(vcs)) {
              newExpanded.delete(vcs);
            } else {
              newExpanded.add(vcs);
            }
            setExpandedVCS(newExpanded);
          };
          
          // Calculate VCS-specific average SFLA
          let vcsTotalSFLA = 0;
          let vcsConditionCount = 0;
          Object.values(conditions).forEach(condData => {
            vcsTotalSFLA += condData.avgSize || 0;
            vcsConditionCount++;
          });
          const vcsAvgSFLA = vcsConditionCount > 0 ? vcsTotalSFLA / vcsConditionCount : 0;

          // Find the baseline condition for this VCS and calculate its normalized value
          let baselineCode = null;
          let vcsBaselineNormalized = null;
          Object.entries(conditions).forEach(([code, condData]) => {
            const isBaselineCondition = manualBaseline ? (condData.description === manualBaseline) :
                          (condData.adjustmentPct === 0 ||
                           condData.description.toUpperCase().includes('AVERAGE') ||
                           condData.description.toUpperCase().includes('NORMAL'));

            if (isBaselineCondition) {
              baselineCode = code;
              const avgSFLA = condData.avgSize || 0;
              const avgValue = condData.avgValue || 0;
              vcsBaselineNormalized = avgSFLA > 0 ?
                ((vcsAvgSFLA - avgSFLA) * ((avgValue / avgSFLA) * 0.50)) + avgValue : avgValue;
            }
          });

          return (
            <div key={vcs} style={{ marginBottom: '15px', border: '1px solid #E5E7EB', borderRadius: '6px' }}>
              {/* VCS Header Row */}
              <div
                onClick={toggleVCS}
                style={{
                  padding: '12px 15px',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: isExpanded ? '1px solid #E5E7EB' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>{vcs}</span>
                  <span style={{ fontSize: '12px', color: '#6B7280' }}>
                    ({conditionCodes.length} conditions, {
                      conditionCodes.reduce((sum, code) => sum + conditions[code].count, 0)
                    } properties)
                  </span>
                </div>
                {!isExpanded && (
                  <span style={{ fontSize: '12px', color: '#6B7280' }}>
                    Click to expand
                  </span>
                )}
              </div>

              {/* Condition Details (when expanded) */}
              {isExpanded && (
                <div style={{ padding: '0' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F3F4F6' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>
                          Condition
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Count
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Avg Value
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Avg SFLA
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Avg Year
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Adjusted
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                          Impact
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {conditionCodes.map((code, idx) => {
                        const cond = conditions[code];
                        const isBaseline = code === baselineCode;

                        // Calculate normalized value using VCS-specific average SFLA and Jim formula
                        const avgSFLA = cond.avgSize || 0;
                        const avgValue = cond.avgValue || 0;
                        const normalized = avgSFLA > 0 ?
                          ((vcsAvgSFLA - avgSFLA) * ((avgValue / avgSFLA) * 0.50)) + avgValue : avgValue;
                        const normalizedPct = vcsBaselineNormalized > 0 ?
                          ((normalized - vcsBaselineNormalized) / vcsBaselineNormalized) * 100 : 0;

                        return (
                          <tr
                            key={code}
                            style={{
                              backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB',
                              fontWeight: isBaseline ? '600' : 'normal'
                            }}
                          >
                            <td style={{ padding: '8px 12px', fontSize: '13px' }}>
                              <span style={{ fontWeight: '500' }}>{code}</span> - {cond.description}
                              {isBaseline && (
                                <span style={{
                                  marginLeft: '8px',
                                  fontSize: '11px',
                                  color: '#10B981',
                                  fontWeight: 'normal'
                                }}>
                                  (baseline)
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                              {cond.count}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                              {formatCurrency(cond.avgValue)}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                              {cond.avgSize > 0 ? `${cond.avgSize.toLocaleString()} sf` : '-'}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                              {cond.avgYear || '-'}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                              {formatCurrency(normalized)}
                            </td>
                            <td style={{
                              padding: '8px 12px',
                              textAlign: 'right',
                              fontSize: '13px',
                              color: normalizedPct > 0 ? '#059669' :
                                     normalizedPct < 0 ? '#DC2626' : '#6B7280'
                            }}>
                              {formatPercent(isBaseline ? 0 : normalizedPct)}
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

        {/* Non-Baseline Conditions Summary Table */}
        {nonBaselineSummary && nonBaselineSummary.length > 0 && (
          <div style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#F0F9FF',
            borderRadius: '6px',
            border: '1px solid #BFDBFE'
          }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '14px', fontWeight: '600', color: '#1E40AF' }}>
              {type} Condition Summary
            </h4>
            <div style={{
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F3F4F6' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>
                      Condition
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Recommended Adjustment
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Properties
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {nonBaselineSummary.map((condition, idx) => (
                    <tr key={condition.code} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '500' }}>
                        {condition.code} - {condition.description}
                      </td>
                      <td style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        fontSize: '13px',
                        color: condition.avgAdjustment === null ? '#6B7280' :
                               condition.avgAdjustment > 0 ? '#059669' :
                               condition.avgAdjustment < 0 ? '#DC2626' : '#6B7280'
                      }}>
                        {condition.avgAdjustment === null ? 'NULL*' : formatPercent(condition.avgAdjustment)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {condition.totalProperties.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nonBaselineSummary.some(c => c.avgAdjustment === null) && (
                <div style={{
                  padding: '8px 12px',
                  fontSize: '11px',
                  color: '#6B7280',
                  borderTop: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB'
                }}>
                  *NULL = Illogical adjustments filtered out (negative adjustments for better conditions or positive adjustments for worse conditions)
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============ CALCULATE NON-BASELINE SUMMARY ============
  const calculateNonBaselineSummary = (data, type) => {
    const conditionAdjustments = {}; // Track adjustments by condition code

    // Determine which baseline and condition classifications are being used
    const manualBaseline = type === 'Exterior' ? manualExteriorBaseline : manualInteriorBaseline;
    const betterConditions = type === 'Exterior' ? exteriorBetterConditions : interiorBetterConditions;
    const worseConditions = type === 'Exterior' ? exteriorWorseConditions : interiorWorseConditions;

    // Process each VCS separately
    Object.entries(data).forEach(([vcsCode, vcsConditions]) => {
      // Step 1: Calculate average SFLA for THIS VCS
      let vcsTotalSFLA = 0;
      let vcsConditionCount = 0;
      Object.values(vcsConditions).forEach(cond => {
        vcsTotalSFLA += cond.avgSize || 0;
        vcsConditionCount++;
      });
      const vcsAvgSFLA = vcsConditionCount > 0 ? vcsTotalSFLA / vcsConditionCount : 0;

      // Step 2: Normalize all conditions in this VCS to the VCS average SFLA
      const normalizedConditions = {};
      Object.entries(vcsConditions).forEach(([code, cond]) => {
        const avgSFLA = cond.avgSize || 0;
        const avgValue = cond.avgValue || 0;

        // Jim formula: ((vcsAvg - thisSFLA) * ((value / thisSFLA) * 0.50)) + value
        const normalized = avgSFLA > 0 ?
          ((vcsAvgSFLA - avgSFLA) * ((avgValue / avgSFLA) * 0.50)) + avgValue : avgValue;

        normalizedConditions[code] = {
          ...cond,
          normalized
        };
      });

      // Step 3: Find baseline for this VCS
      let vcsBaselineNormalized = null;
      Object.entries(normalizedConditions).forEach(([code, cond]) => {
        const isBaseline = manualBaseline ? (cond.description === manualBaseline) :
                          (cond.adjustmentPct === 0 ||
                           cond.description.toUpperCase().includes('AVERAGE') ||
                           cond.description.toUpperCase().includes('NORMAL'));
        if (isBaseline) {
          vcsBaselineNormalized = cond.normalized;
        }
      });

      // Step 4: Calculate percentage for each non-baseline condition in this VCS
      Object.entries(normalizedConditions).forEach(([code, cond]) => {
        const isBaseline = manualBaseline ? (cond.description === manualBaseline) :
                          (cond.adjustmentPct === 0 ||
                           cond.description.toUpperCase().includes('AVERAGE') ||
                           cond.description.toUpperCase().includes('NORMAL'));

        if (isBaseline || vcsBaselineNormalized === null || vcsBaselineNormalized === 0) {
          return;
        }

        // Initialize condition tracking if not exists
        if (!conditionAdjustments[code]) {
          const isBetterCondition = betterConditions.includes(cond.description);
          const isWorseCondition = worseConditions.includes(cond.description);

          conditionAdjustments[code] = {
            description: cond.description,
            vcsPercentages: [],
            totalProperties: 0,
            isBetterCondition,
            isWorseCondition
          };
        }

        // Calculate percentage vs baseline for this VCS
        const adjustmentPct = ((cond.normalized - vcsBaselineNormalized) / vcsBaselineNormalized) * 100;

        // Check if this percentage should be included based on condition type
        let includeInCalc = false;
        if (conditionAdjustments[code].isBetterCondition && adjustmentPct > 0) {
          includeInCalc = true; // Better: only include positive adjustments
        } else if (conditionAdjustments[code].isWorseCondition && adjustmentPct < 0) {
          includeInCalc = true; // Worse: only include negative adjustments
        }

        if (includeInCalc) {
          conditionAdjustments[code].vcsPercentages.push(adjustmentPct);
        }
        conditionAdjustments[code].totalProperties += cond.count;
      });
    });

    // Step 5: Calculate simple average of VCS percentages for each condition
    const summary = [];
    Object.entries(conditionAdjustments).forEach(([code, data]) => {
      // Calculate simple average of VCS percentages (not dollar-weighted)
      const avgAdjustment = data.vcsPercentages.length > 0 ?
        data.vcsPercentages.reduce((sum, pct) => sum + pct, 0) / data.vcsPercentages.length : null;
      const validVCSCount = data.vcsPercentages.length;

      // Log for debugging
      if (type === 'Interior' && (code === '2' || code === '5')) {
        console.log(`[UI ${type} ${data.description}] Per-VCS method:`, {
          avgAdjustment,
          vcsPercentages: data.vcsPercentages
        });
      }

      // Categorize condition quality for sorting using user configuration
      let category = 0; // 0 = average/unknown, 1 = better, -1 = worse
      if (data.isBetterCondition) {
        category = 1;
      } else if (data.isWorseCondition) {
        category = -1;
      }

      summary.push({
        code,
        description: data.description,
        avgAdjustment,
        totalProperties: data.totalProperties,
        validVCSCount,
        category
      });
    });

    // Sort with better conditions first (descending), then worse (ascending by adjustment)
    return summary.sort((a, b) => {
      // First sort by category (better first)
      if (a.category !== b.category) {
        return b.category - a.category;
      }

      // Within same category, sort by adjustment value
      if (a.category === 1) {
        // Better conditions: highest positive adjustments first
        const adjA = a.avgAdjustment || 0;
        const adjB = b.avgAdjustment || 0;
        return adjB - adjA;
      } else if (a.category === -1) {
        // Below average: lowest negative adjustments first
        const adjA = a.avgAdjustment || 0;
        const adjB = b.avgAdjustment || 0;
        return adjA - adjB;
      } else {
        // Same category (average/unknown): sort by code
        return a.code.localeCompare(b.code);
      }
    });
  };

  // ============ EXCEL EXPORT FUNCTIONS ============
  const buildConditionSheet = (data, type) => {
    const rows = [];

    // Column headers - start at row 0
    const headers = ['VCS', 'Condition', 'Count', 'Avg SFLA', 'Avg Year Built', 'Avg Norm Value', 'Adjusted Value', 'Flat Adj', '% Adj', 'Baseline'];
    rows.push(headers);

    // COL indexes (0-based)
    const COL = {
      VCS: 0, CONDITION: 1, COUNT: 2, AVG_SFLA: 3, AVG_YEAR: 4,
      AVG_NORM_VALUE: 5, ADJ_VALUE: 6, FLAT_ADJ: 7, PCT_ADJ: 8, BASELINE: 9
    };

    // Get user-defined baseline
    const manualBaseline = type === 'exterior' ? manualExteriorBaseline : manualInteriorBaseline;

    // Collect all data by VCS with baseline info
    const vcsSections = [];
    const dataRowRanges = {}; // Track row ranges for each condition for summation

    Object.entries(data).forEach(([vcs, conditions]) => {
      // Calculate VCS average SFLA across all conditions
      const vcsAvgSFLA = Object.values(conditions).reduce((sum, c) => sum + (c.avgSize || 0), 0) / Object.keys(conditions).length;

      // Find baseline using ONLY user configuration
      let baselineCond = null;
      if (manualBaseline) {
        // Use user's configured baseline
        baselineCond = Object.values(conditions).find(c => c.description === manualBaseline);
      }

      // Fallback only if no manual baseline is set
      if (!baselineCond) {
        const baselineCode = Object.keys(conditions).find(code => {
          const upper = (conditions[code].description || '').toUpperCase();
          return upper.includes('AVERAGE') || upper.includes('AVG') || upper.includes('NORMAL');
        }) || Object.keys(conditions)[0];
        baselineCond = conditions[baselineCode];
      }

      const conditionRows = [];

      Object.entries(conditions).forEach(([code, cond]) => {
        // Always compare to user's configured baseline description
        const isBaseline = manualBaseline ? (cond.description === manualBaseline) : (cond === baselineCond);
        const avgSFLA = cond.avgSize || 0;
        const avgYear = cond.avgYear || '';
        const avgNormValue = cond.avgValue || 0;

        conditionRows.push({
          vcs,
          code,
          description: cond.description,
          count: cond.count,
          avgSFLA,
          avgYear,
          avgNormValue,
          isBaseline,
          vcsAvgSFLA,
          baselineDescription: baselineCond?.description
        });
      });

      vcsSections.push({ vcs, conditionRows, vcsAvgSFLA });
    });

    // Add data rows with formulas
    vcsSections.forEach(section => {
      // Find baseline row index within this VCS section using the configured baseline description
      const baselineIdx = section.conditionRows.findIndex(c =>
        manualBaseline ? c.description === manualBaseline : c.isBaseline
      );
      const startingRowNum = rows.length + 1;
      const baselineExcelRow = baselineIdx >= 0 ? startingRowNum + baselineIdx : null;

      section.conditionRows.forEach((cond, idx) => {
        const rowNum = rows.length + 1; // Excel row number (1-based)

        // Track rows for summary summation
        if (!dataRowRanges[cond.description]) {
          dataRowRanges[cond.description] = { rows: [], count: 0 };
        }
        dataRowRanges[cond.description].rows.push(rowNum);
        dataRowRanges[cond.description].count += cond.count;

        const row = [];
        row[COL.VCS] = cond.vcs;
        row[COL.CONDITION] = cond.description;
        row[COL.COUNT] = cond.count;
        row[COL.AVG_SFLA] = cond.avgSFLA;
        row[COL.AVG_YEAR] = cond.avgYear;
        row[COL.AVG_NORM_VALUE] = cond.avgNormValue;

        // Jim formula: ((VCS_AVG_SFLA - This_SFLA) × ((This_Value / This_SFLA) × 0.50)) + This_Value
        row[COL.ADJ_VALUE] = {
          f: `IF(D${rowNum}=0,F${rowNum},((${cond.vcsAvgSFLA}-D${rowNum})*((F${rowNum}/D${rowNum})*0.50))+F${rowNum})`,
          t: 'n'
        };

        // Check if this is the baseline condition
        const isThisBaseline = manualBaseline ?
          cond.description === manualBaseline : cond.isBaseline;

        // Store baseline row number for this VCS to reference later
        if (isThisBaseline) {
          row[COL.FLAT_ADJ] = 0;
          row[COL.PCT_ADJ] = 0;
          row[COL.BASELINE] = 'YES'; // Mark baseline
        } else if (baselineExcelRow) {
          // Flat Adj = This normalized value - Baseline normalized value (same VCS)
          row[COL.FLAT_ADJ] = {
            f: `G${rowNum}-G${baselineExcelRow}`,
            t: 'n'
          };
          row[COL.PCT_ADJ] = {
            f: `IF(G${baselineExcelRow}=0,0,(G${rowNum}-G${baselineExcelRow})/G${baselineExcelRow})`,
            t: 'n',
            z: '0.0%'
          };
        } else {
          // No baseline found in this VCS
          row[COL.FLAT_ADJ] = 0;
          row[COL.PCT_ADJ] = 0;
        }

        row[COL.BASELINE] = cond.isBaseline ? 'YES' : '';

        rows.push(row);
      });
    });

    // Log sample VCS data for debugging
    if (vcsSections.length > 0) {
      const sampleVCS = vcsSections[0];
      console.log(`[Export ${type}] Sample VCS "${sampleVCS.vcs}":`, {
        vcsAvgSFLA: sampleVCS.vcsAvgSFLA,
        conditions: sampleVCS.conditionRows.map(c => ({
          description: c.description,
          avgSFLA: c.avgSFLA,
          avgValue: c.avgNormValue,
          isBaseline: c.isBaseline
        }))
      });
    }

    // Summary section - using summation approach
    rows.push([]); // Blank row
    rows.push([]); // Blank row

    // Summary header aligned over "Total Count" column (column B, index 1)
    const summaryHeaderRow = [];
    summaryHeaderRow[0] = ''; // Empty column A
    summaryHeaderRow[1] = 'All VCS Combined'; // Column B (over Total Count)
    rows.push(summaryHeaderRow);
    rows.push([]); // Blank row

    const summaryHeaders = ['Condition', 'Total Count', '% Adj'];
    rows.push(summaryHeaders);

    // Get user-defined condition classifications
    const betterConditions = type === 'exterior' ? exteriorBetterConditions : interiorBetterConditions;
    const worseConditions = type === 'exterior' ? exteriorWorseConditions : interiorWorseConditions;
    // manualBaseline already declared at top of function

    // Find baseline description - use manual selection if set, otherwise try to auto-detect
    const baselineDesc = manualBaseline || Object.keys(dataRowRanges).find(desc => {
      const upper = desc.toUpperCase();
      return upper.includes('AVERAGE') || upper.includes('AVG') || upper.includes('NORMAL');
    }) || Object.keys(dataRowRanges)[0];

    // Get baseline row numbers for summation
    const baselineRowNums = dataRowRanges[baselineDesc]?.rows || [];

    // Helper to determine if condition is better or worse than baseline
    const isBetterCondition = (description) => {
      return betterConditions.includes(description);
    };

    const isWorseCondition = (description) => {
      return worseConditions.includes(description);
    };

    // Create summary rows
    Object.entries(dataRowRanges).forEach(([desc, info]) => {
      const rowNum = rows.length + 1;
      const isBaseline = desc === baselineDesc;
      const conditionRowNums = info.rows;
      const isBetter = isBetterCondition(desc);
      const isWorse = isWorseCondition(desc);

      // Log for debugging (GOOD and FAIR conditions)
      if (type === 'interior' && (desc.includes('GOOD') || desc.includes('FAIR'))) {
        console.log(`[Export ${type} ${desc}] Summary formula:`, {
          vcsCount: conditionRowNums.length,
          vcsRows: conditionRowNums,
          isBetter,
          isWorse,
          filterCondition: isBetter ? '% Adj > 0' : isWorse ? '% Adj < 0' : 'all'
        });
      }

      const summaryRow = [];
      summaryRow[0] = desc; // Condition
      summaryRow[1] = info.count; // Total Count

      if (isBaseline) {
        summaryRow[2] = ''; // % Adj - blank for baseline
      } else {
        // Calculate simple average of VCS percentages (not dollar-weighted)
        // For better conditions: only average rows with positive % Adj (I > 0)
        // For worse conditions: only average rows with negative % Adj (I < 0)
        let avgFormula;

        if (isBetter) {
          // Average of percentages where % Adj > 0
          // Sum only positive values, divide by count of positive values
          const sumFormula = conditionRowNums.map(r => `IF(I${r}>0,I${r},0)`).join('+');
          const countFormula = conditionRowNums.map(r => `IF(I${r}>0,1,0)`).join('+');
          avgFormula = `(${sumFormula})/(${countFormula})`;
        } else if (isWorse) {
          // Average of percentages where % Adj < 0
          // Sum only negative values, divide by count of negative values
          const sumFormula = conditionRowNums.map(r => `IF(I${r}<0,I${r},0)`).join('+');
          const countFormula = conditionRowNums.map(r => `IF(I${r}<0,1,0)`).join('+');
          avgFormula = `(${sumFormula})/(${countFormula})`;
        } else {
          // Unknown condition type - average all percentages
          avgFormula = `AVERAGE(${conditionRowNums.map(r => `I${r}`).join(',')})`;
        }

        // % Adj = Simple average of VCS percentages (filtered by direction)
        summaryRow[2] = {
          f: avgFormula,
          t: 'n',
          z: '0.0%'
        };
      }

      rows.push(summaryRow);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Base styles
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply styles
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Find summary section start (look for "All VCS Combined" row)
    let summaryStartRow = -1;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cellA = XLSX.utils.encode_cell({ r: R, c: 1 });
      if (ws[cellA] && ws[cellA].v === 'All VCS Combined') {
        summaryStartRow = R;
        break;
      }
    }

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        const isSummarySection = summaryStartRow !== -1 && R >= summaryStartRow;

        // Header row (row 0 for main data) and summary headers
        if (R === 0 || ws[cellAddress].v === 'Condition' || ws[cellAddress].v === 'VCS' || ws[cellAddress].v === 'All VCS Combined') {
          ws[cellAddress].s = headerStyle;
        }
        // Data rows
        else {
          const style = { ...baseStyle };

          if (isSummarySection) {
            // Summary columns: Condition, Total Count, % Adj
            if (C === 1) {
              style.numFmt = '#,##0'; // Total Count
            } else if (C === 2) {
              style.numFmt = '0%'; // % Adj
            }
          } else {
            // Main data columns
            if (C === COL.COUNT) {
              style.numFmt = '#,##0'; // Count
            } else if (C === COL.AVG_SFLA) {
              style.numFmt = '#,##0'; // Avg SFLA
            } else if (C === COL.AVG_NORM_VALUE || C === COL.ADJ_VALUE || C === COL.FLAT_ADJ) {
              style.numFmt = '$#,##0'; // Currency columns
            } else if (C === COL.PCT_ADJ) {
              style.numFmt = '0%'; // % Adj
            }
          }

          ws[cellAddress].s = style;
        }
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 15 },  // VCS / Condition (main) / Condition (summary)
      { wch: 20 },  // Condition (main) / Total Count (summary)
      { wch: 10 },  // Count (main) / % Adj (summary)
      { wch: 12 },  // Avg SFLA
      { wch: 12 },  // Avg Year
      { wch: 14 },  // Avg Norm Value
      { wch: 14 },  // Adjusted Value
      { wch: 12 },  // Flat Adj
      { wch: 10 },  // % Adj
      { wch: 10 }   // Baseline
    ];

    return ws;
  };

  // Combined export function for both Exterior and Interior tabs
  const exportConditionDataToExcel = () => {
    const wb = XLSX.utils.book_new();

    // Add Exterior sheet
    if (conditionData.exterior && Object.keys(conditionData.exterior).length > 0) {
      const exteriorSheet = buildConditionSheet(conditionData.exterior, 'exterior');
      XLSX.utils.book_append_sheet(wb, exteriorSheet, 'Exterior');
    }

    // Add Interior sheet
    if (conditionData.interior && Object.keys(conditionData.interior).length > 0) {
      const interiorSheet = buildConditionSheet(conditionData.interior, 'interior');
      XLSX.utils.book_append_sheet(wb, interiorSheet, 'Interior');
    }

    // Generate filename and download
    const filename = `${jobData.job_name || 'job'}_condition_analysis_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  };
  // ============ RENDER CONDITION ANALYSIS TAB ============
  const renderConditionAnalysis = () => {
    return (
      <div>
        {/* Condition Handling Method Selection */}
        <div style={{
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: '#FEF3C7',
          borderRadius: '6px',
          border: '2px solid #F59E0B'
        }}>
          <div style={{ marginBottom: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#92400E' }}>
              Condition will be handled:
            </h4>
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="conditionHandlingMethod"
                value="condition_table"
                checked={conditionHandlingMethod === 'condition_table'}
                onChange={async (e) => {
                  const newMethod = e.target.value;
                  setConditionHandlingMethod(newMethod);

                  // Auto-save to database
                  try {
                    const config = jobData.attribute_condition_config || {};
                    const updatedConfig = { ...config, conditionHandlingMethod: newMethod };

                    await supabase
                      .from('jobs')
                      .update({ attribute_condition_config: updatedConfig })
                      .eq('id', jobData.id);

                    if (onUpdateJobCache) {
                      onUpdateJobCache({ attribute_condition_config: updatedConfig });
                    }
                  } catch (error) {
                    console.error('Error saving condition handling method:', error);
                  }
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#92400E' }}>
                In the Condition Table
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="conditionHandlingMethod"
                value="effective_age"
                checked={conditionHandlingMethod === 'effective_age'}
                onChange={async (e) => {
                  const newMethod = e.target.value;
                  setConditionHandlingMethod(newMethod);

                  // Auto-save to database
                  try {
                    const config = jobData.attribute_condition_config || {};
                    const updatedConfig = { ...config, conditionHandlingMethod: newMethod };

                    await supabase
                      .from('jobs')
                      .update({ attribute_condition_config: updatedConfig })
                      .eq('id', jobData.id);

                    if (onUpdateJobCache) {
                      onUpdateJobCache({ attribute_condition_config: updatedConfig });
                    }
                  } catch (error) {
                    console.error('Error saving condition handling method:', error);
                  }
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#92400E' }}>
                In Effective Age
              </span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="conditionHandlingMethod"
                value="ncovr_override"
                checked={conditionHandlingMethod === 'ncovr_override'}
                onChange={(e) => {
                  const newMethod = e.target.value;
                  setConditionHandlingMethod(newMethod);

                  // Pre-populate defaults for NCOVR (user will save via Save button)
                  setManualExteriorBaseline('AVERAGE');
                  setExteriorBetterConditions(['GOOD', 'EXCELLENT']);
                  setExteriorWorseConditions(['FAIR', 'POOR', 'DILAPIDATED']);

                  setManualInteriorBaseline('AVERAGE');
                  setInteriorBetterConditions(['GOOD', 'EXCELLENT']);
                  setInteriorWorseConditions(['FAIR', 'POOR', 'DILAPIDATED']);
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#92400E' }}>
                Using Net Condition (NETCOND)
              </span>
            </label>
          </div>

          {/* NCOVR Info Note */}
          {conditionHandlingMethod === 'ncovr_override' && (
            <div style={{
              marginTop: '12px',
              padding: '10px',
              backgroundColor: '#DBEAFE',
              borderRadius: '4px',
              border: '1px solid #0EA5E9',
              fontSize: '12px',
              color: '#0C4A6E'
            }}>
              <strong>ℹ️ Net Condition Selected:</strong> Properties will use NETCOND percentages to determine condition:
              <br/>• Excellent: 86-100% | Good: 71-85% | Average: 56-70% | Fair: 41-55% | Poor: 26-40% | Dilapidated: 1-25%
              <br/>• Default ranking configured below (Baseline: Average, Better: Good/Excellent, Worse: Fair/Poor/Dilapidated)
              <br/>• <strong>Click "Save Configuration" to persist</strong> the condition ranking for CME use
            </div>
          )}
        </div>

        {/* Type/Use Filter and Interior Inspection Toggle */}
        <div style={{ 
          marginBottom: '20px', 
          padding: '15px', 
          backgroundColor: '#F9FAFB', 
          borderRadius: '6px',
          border: '1px solid #E5E7EB'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                  Property Type Filter
                </label>
                <select
                  value={typeUseFilter}
                  onChange={(e) => setTypeUseFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '4px',
                    fontSize: '14px',
                    backgroundColor: 'white',
                    minWidth: '200px'
                  }}
                >
                  {getTypeUseOptions().map(option => (
                    <option key={option.code} value={option.code}>
                      {option.description}
                    </option>
                  ))}
                </select>
              </div>
              
              <div style={{ 
                padding: '8px 12px', 
                backgroundColor: '#EBF8FF',
                borderRadius: '4px',
                fontSize: '13px',
                color: '#2563EB'
              }}>
                <Info size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                Analyzing {filterPropertiesByType(properties, typeUseFilter).length.toLocaleString()} properties
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                onClick={() => setShowConditionConfig(!showConditionConfig)}
                className={CSV_BUTTON_CLASS}
                disabled={conditionData.loading}
                style={{ backgroundColor: showConditionConfig ? '#6366F1' : undefined }}
              >
                ⚙️ Configure Baseline & Classifications
              </button>
              <button
                onClick={() => exportConditionDataToExcel()}
                className={CSV_BUTTON_CLASS}
                disabled={conditionData.loading || (Object.keys(conditionData.exterior).length === 0 && Object.keys(conditionData.interior).length === 0)}
              >
                <FileText size={14} /> Export Condition Analysis
              </button>
            </div>
          </div>
        </div>

        {/* Condition Configuration Panel */}
        {showConditionConfig && (
          <div style={{
            marginTop: '20px',
            padding: '20px',
            backgroundColor: '#F9FAFB',
            borderRadius: '8px',
            border: '2px solid #E5E7EB'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', fontWeight: '600' }}>
              Condition Code Configuration for Export
            </h3>

            {/* Type Tabs */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid #E5E7EB' }}>
              <button
                onClick={() => setConfigType('exterior')}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderBottom: configType === 'exterior' ? '3px solid #3B82F6' : 'none',
                  fontWeight: configType === 'exterior' ? '600' : '400',
                  cursor: 'pointer',
                  color: configType === 'exterior' ? '#3B82F6' : '#6B7280'
                }}
              >
                Exterior Condition
              </button>
              <button
                onClick={() => setConfigType('interior')}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderBottom: configType === 'interior' ? '3px solid #3B82F6' : 'none',
                  fontWeight: configType === 'interior' ? '600' : '400',
                  cursor: 'pointer',
                  color: configType === 'interior' ? '#3B82F6' : '#6B7280'
                }}
              >
                Interior Condition
              </button>
            </div>

            {(() => {
              const isExterior = configType === 'exterior';
              // Use ALL codes from code definitions, not just from analysis data
              const availableCodes = isExterior ? availableConditionCodes.exterior : availableConditionCodes.interior;

              // Build array of {code, description} for sorting and display
              const allConditions = Object.entries(availableCodes)
                .map(([code, desc]) => ({ code, description: desc }))
                .sort((a, b) => a.code.localeCompare(b.code));

              const currentBaseline = isExterior ? manualExteriorBaseline : manualInteriorBaseline;
              const currentBetter = isExterior ? exteriorBetterConditions : interiorBetterConditions;
              const currentWorse = isExterior ? exteriorWorseConditions : interiorWorseConditions;

              const setBaseline = (value) => {
                if (isExterior) {
                  setManualExteriorBaseline(value);
                } else {
                  setManualInteriorBaseline(value);
                }
              };

              const toggleBetter = (condition) => {
                const updated = currentBetter.includes(condition)
                  ? currentBetter.filter(c => c !== condition)
                  : [...currentBetter, condition];

                if (isExterior) {
                  setExteriorBetterConditions(updated);
                } else {
                  setInteriorBetterConditions(updated);
                }
              };

              const toggleWorse = (condition) => {
                const updated = currentWorse.includes(condition)
                  ? currentWorse.filter(c => c !== condition)
                  : [...currentWorse, condition];

                if (isExterior) {
                  setExteriorWorseConditions(updated);
                } else {
                  setInteriorWorseConditions(updated);
                }
              };

              return (
                <div>
                  {allConditions.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280' }}>
                      <p style={{ marginBottom: '10px' }}>No condition codes found in code file definitions.</p>
                      <p style={{ fontSize: '13px' }}>Make sure the code file has been uploaded and processed for this job.</p>
                    </div>
                  ) : (
                    <>
                      {/* Baseline Selection */}
                      <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
                          Baseline Condition (0% adjustment):
                        </label>
                        <select
                          value={currentBaseline}
                          onChange={(e) => setBaseline(e.target.value)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid #D1D5DB',
                            fontSize: '14px',
                            width: '400px'
                          }}
                        >
                          <option value="">-- Auto-detect (AVERAGE/AVG/NORMAL) --</option>
                          {allConditions.map(item => (
                            <option key={item.code} value={item.description}>
                              {item.code} {item.description}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Better Conditions - Tiered with reordering */}
                      <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
                          Better than Baseline (positive adjustments) - Rank 1 is closest to baseline:
                        </label>

                        {/* Ordered list of selected better conditions */}
                        {currentBetter.length > 0 && (
                          <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#D1FAE5', borderRadius: '6px' }}>
                            <div style={{ fontSize: '12px', color: '#065F46', marginBottom: '8px', fontWeight: '500' }}>
                              Rank 1 = 1x adjustment, Rank 2 = 2x adjustment, etc. Use arrows to reorder:
                            </div>
                            {currentBetter.map((condition, idx) => {
                              const rankLevel = idx + 1;
                              return (
                                <div key={condition} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '6px 10px',
                                  backgroundColor: 'white',
                                  borderRadius: '4px',
                                  marginBottom: '4px',
                                  border: '1px solid #A7F3D0'
                                }}>
                                  <span style={{
                                    fontWeight: '700',
                                    color: '#059669',
                                    minWidth: '70px'
                                  }}>
                                    Rank {rankLevel}
                                  </span>
                                  <span style={{ flex: 1 }}>{condition}</span>
                                  <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: '500' }}>
                                    ({rankLevel}x adjustment)
                                  </span>
                                  <button
                                    onClick={() => {
                                      if (idx > 0) {
                                        const newOrder = [...currentBetter];
                                        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                                        if (isExterior) setExteriorBetterConditions(newOrder);
                                        else setInteriorBetterConditions(newOrder);
                                      }
                                    }}
                                    disabled={idx === 0}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '12px',
                                      cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                      opacity: idx === 0 ? 0.3 : 1,
                                      border: '1px solid #D1D5DB',
                                      borderRadius: '3px',
                                      backgroundColor: 'white'
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (idx < currentBetter.length - 1) {
                                        const newOrder = [...currentBetter];
                                        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                                        if (isExterior) setExteriorBetterConditions(newOrder);
                                        else setInteriorBetterConditions(newOrder);
                                      }
                                    }}
                                    disabled={idx === currentBetter.length - 1}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '12px',
                                      cursor: idx === currentBetter.length - 1 ? 'not-allowed' : 'pointer',
                                      opacity: idx === currentBetter.length - 1 ? 0.3 : 1,
                                      border: '1px solid #D1D5DB',
                                      borderRadius: '3px',
                                      backgroundColor: 'white'
                                    }}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() => toggleBetter(condition)}
                                    style={{
                                      padding: '2px 8px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      border: '1px solid #FECACA',
                                      borderRadius: '3px',
                                      backgroundColor: '#FEF2F2',
                                      color: '#DC2626'
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Checkboxes to add conditions */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                          {allConditions.filter(item => item.description !== currentBaseline && !currentBetter.includes(item.description)).map(item => (
                            <label key={item.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={false}
                                onChange={() => toggleBetter(item.description)}
                                disabled={currentWorse.includes(item.description)}
                              />
                              <span style={{ fontSize: '14px', color: currentWorse.includes(item.description) ? '#9CA3AF' : '#374151' }}>
                                {item.code} {item.description}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Worse Conditions - Tiered with reordering */}
                      <div>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
                          Worse than Baseline (negative adjustments) - Rank 1 is closest to baseline:
                        </label>

                        {/* Ordered list of selected worse conditions */}
                        {currentWorse.length > 0 && (
                          <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#FEE2E2', borderRadius: '6px' }}>
                            <div style={{ fontSize: '12px', color: '#991B1B', marginBottom: '8px', fontWeight: '500' }}>
                              Rank 1 = 1x adjustment, Rank 2 = 2x adjustment, etc. Use arrows to reorder:
                            </div>
                            {currentWorse.map((condition, idx) => {
                              const rankLevel = idx + 1;
                              return (
                                <div key={condition} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '6px 10px',
                                  backgroundColor: 'white',
                                  borderRadius: '4px',
                                  marginBottom: '4px',
                                  border: '1px solid #FECACA'
                                }}>
                                  <span style={{
                                    fontWeight: '700',
                                    color: '#DC2626',
                                    minWidth: '70px'
                                  }}>
                                    Rank {rankLevel}
                                  </span>
                                  <span style={{ flex: 1 }}>{condition}</span>
                                  <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: '500' }}>
                                    ({rankLevel}x adjustment)
                                  </span>
                                  <button
                                    onClick={() => {
                                      if (idx > 0) {
                                        const newOrder = [...currentWorse];
                                        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
                                        if (isExterior) setExteriorWorseConditions(newOrder);
                                        else setInteriorWorseConditions(newOrder);
                                      }
                                    }}
                                    disabled={idx === 0}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '12px',
                                      cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                      opacity: idx === 0 ? 0.3 : 1,
                                      border: '1px solid #D1D5DB',
                                      borderRadius: '3px',
                                      backgroundColor: 'white'
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (idx < currentWorse.length - 1) {
                                        const newOrder = [...currentWorse];
                                        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
                                        if (isExterior) setExteriorWorseConditions(newOrder);
                                        else setInteriorWorseConditions(newOrder);
                                      }
                                    }}
                                    disabled={idx === currentWorse.length - 1}
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: '12px',
                                      cursor: idx === currentWorse.length - 1 ? 'not-allowed' : 'pointer',
                                      opacity: idx === currentWorse.length - 1 ? 0.3 : 1,
                                      border: '1px solid #D1D5DB',
                                      borderRadius: '3px',
                                      backgroundColor: 'white'
                                    }}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() => toggleWorse(condition)}
                                    style={{
                                      padding: '2px 8px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      border: '1px solid #FECACA',
                                      borderRadius: '3px',
                                      backgroundColor: '#FEF2F2',
                                      color: '#DC2626'
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Checkboxes to add conditions */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                          {allConditions.filter(item => item.description !== currentBaseline && !currentWorse.includes(item.description)).map(item => (
                            <label key={item.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={false}
                                onChange={() => toggleWorse(item.description)}
                                disabled={currentBetter.includes(item.description)}
                              />
                              <span style={{ fontSize: '14px', color: currentBetter.includes(item.description) ? '#9CA3AF' : '#374151' }}>
                                {item.code} {item.description}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Instructions */}
                      <div style={{
                        marginTop: '20px',
                        padding: '12px',
                        backgroundColor: '#EFF6FF',
                        borderRadius: '6px',
                        fontSize: '13px',
                        color: '#1E40AF'
                      }}>
                        <strong>How ranked adjustments work:</strong>
                        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                          <li><strong>Rank 1</strong> = 1x the adjustment % (e.g., GOOD = +10% if 10% is set)</li>
                          <li><strong>Rank 2</strong> = 2x the adjustment % (e.g., EXCELLENT = +20%)</li>
                          <li><strong>Worse Rank 1</strong> = 1x negative (e.g., FAIR = -10%)</li>
                          <li><strong>Worse Rank 2</strong> = 2x negative (e.g., POOR = -20%)</li>
                        </ul>
                        <div style={{ marginTop: '8px' }}>
                          <strong>Order matters:</strong> Rank 1 should be closest to baseline (e.g., GOOD before EXCELLENT).
                          Use ↑↓ arrows to reorder.
                        </div>
                      </div>

                      {/* Condition Equivalents - Dropdown Pairs */}
                      <div style={{
                        marginTop: '20px',
                        padding: '15px',
                        backgroundColor: '#F0FDF4',
                        borderRadius: '6px',
                        border: '2px solid #86EFAC'
                      }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', color: '#166534' }}>
                          ✓ Condition Equivalents (optional)
                        </label>
                        <p style={{ fontSize: '12px', color: '#4B5563', margin: '0 0 12px 0' }}>
                          Treat conditions as equivalent for ranking (e.g., MODERN = GOOD means both get the same rank and no adjustment between them).
                        </p>

                        {/* Existing Mappings */}
                        {Object.keys(conditionEquivalents || {}).length > 0 && (
                          <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #86EFAC' }}>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: '#166534', marginBottom: '8px' }}>
                              Created Mappings:
                            </div>
                            {Object.entries(conditionEquivalents).map(([from, to]) => (
                              <div key={from} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '8px 10px',
                                backgroundColor: 'white',
                                borderRadius: '4px',
                                marginBottom: '6px',
                                border: '1px solid #86EFAC'
                              }}>
                                <span style={{ fontWeight: '600', color: '#059669', flex: 1 }}>
                                  {from.toUpperCase()} → {to.toUpperCase()}
                                </span>
                                <button
                                  onClick={() => {
                                    const updated = { ...conditionEquivalents };
                                    delete updated[from];
                                    setConditionEquivalents(updated);
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    backgroundColor: '#FEE2E2',
                                    color: '#DC2626',
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}
                                >
                                  ✕ Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add New Mapping */}
                        <div style={{
                          padding: '12px',
                          backgroundColor: 'white',
                          borderRadius: '4px',
                          border: '1px dashed #86EFAC'
                        }}>
                          <div style={{ fontSize: '12px', fontWeight: '600', color: '#166534', marginBottom: '10px' }}>
                            Add New Mapping:
                          </div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '12px', color: '#4B5563', display: 'block', marginBottom: '4px' }}>
                                From Condition:
                              </label>
                              <select
                                value={newEquivalentFrom}
                                onChange={(e) => setNewEquivalentFrom(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  border: '1px solid #86EFAC',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                  backgroundColor: 'white'
                                }}
                              >
                                <option value="">-- Select condition --</option>
                                {Object.entries(availableConditionCodes[isExterior ? 'exterior' : 'interior'] || {})
                                  .map(([code, desc]) => (
                                    <option key={code} value={desc.toUpperCase()}>
                                      {code} {desc}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '12px', color: '#4B5563', display: 'block', marginBottom: '4px' }}>
                                Maps To:
                              </label>
                              <select
                                value={newEquivalentTo}
                                onChange={(e) => setNewEquivalentTo(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  border: '1px solid #86EFAC',
                                  borderRadius: '4px',
                                  fontSize: '13px',
                                  backgroundColor: 'white'
                                }}
                              >
                                <option value="">-- Select condition --</option>
                                {Object.entries(availableConditionCodes[isExterior ? 'exterior' : 'interior'] || {})
                                  .map(([code, desc]) => (
                                    <option key={code} value={desc.toUpperCase()}>
                                      {code} {desc}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <button
                              onClick={() => {
                                if (newEquivalentFrom && newEquivalentTo && newEquivalentFrom !== newEquivalentTo) {
                                  setConditionEquivalents({
                                    ...conditionEquivalents,
                                    [newEquivalentFrom.toUpperCase()]: newEquivalentTo.toUpperCase()
                                  });
                                  setNewEquivalentFrom('');
                                  setNewEquivalentTo('');
                                }
                              }}
                              disabled={!newEquivalentFrom || !newEquivalentTo || newEquivalentFrom === newEquivalentTo}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: (!newEquivalentFrom || !newEquivalentTo || newEquivalentFrom === newEquivalentTo) ? '#D1D5DB' : '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (!newEquivalentFrom || !newEquivalentTo || newEquivalentFrom === newEquivalentTo) ? 'not-allowed' : 'pointer',
                                fontSize: '12px',
                                fontWeight: '600',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              + Add Mapping
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Save Button */}
                      <div style={{
                        marginTop: '20px',
                        paddingTop: '20px',
                        borderTop: '2px solid #E5E7EB',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '15px'
                      }}>
                        <button
                          onClick={saveConditionConfigToDatabase}
                          disabled={isSavingConfig || !manualExteriorBaseline || !manualInteriorBaseline}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: (!manualExteriorBaseline || !manualInteriorBaseline) ? '#D1D5DB' : '#3B82F6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: (!manualExteriorBaseline || !manualInteriorBaseline) ? 'not-allowed' : 'pointer',
                            opacity: isSavingConfig ? 0.6 : 1
                          }}
                        >
                          {isSavingConfig ? 'Saving...' : 'Save Configuration to Database'}
                        </button>

                        {configSaveSuccess && (
                          <div style={{
                            padding: '8px 12px',
                            backgroundColor: '#D1FAE5',
                            color: '#065F46',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '500'
                          }}>
                            ✓ Configuration saved successfully!
                          </div>
                        )}

                        {!manualExteriorBaseline || !manualInteriorBaseline ? (
                          <div style={{
                            fontSize: '13px',
                            color: '#DC2626',
                            fontWeight: '500'
                          }}>
                            ⚠ Both Exterior and Interior baselines must be defined before saving
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Loading State */}
        {conditionData.loading && (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div style={{ marginBottom: '10px' }}>Loading condition analysis data...</div>
            <div style={{ display: 'inline-block', width: '40px', height: '40px', border: '3px solid #E5E7EB', borderTop: '3px solid #3B82F6', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          </div>
        )}

        {/* Error State */}
        {conditionData.error && (
          <div style={{ 
            padding: '15px', 
            backgroundColor: '#FEF2F2', 
            borderRadius: '6px',
            border: '1px solid #FECACA',
            color: '#991B1B',
            marginBottom: '20px'
          }}>
            {conditionData.error}
          </div>
        )}

        {/* Exterior Condition Analysis */}
        {!conditionData.loading && !conditionData.error && (
          <>
            <div style={{ marginBottom: '30px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 15px',
                backgroundColor: '#F0F9FF',
                borderRadius: '6px',
                marginBottom: '15px'
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  margin: '0',
                  color: '#1E40AF'
                }}>
                  Exterior Condition Analysis
                </h3>

                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  {/* Expand/Collapse Buttons - Match Land Valuation Style */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      onClick={() => setExpandedExteriorVCS(new Set(Object.keys(conditionData.exterior)))}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#10B981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Expand All
                    </button>
                    <button
                      onClick={() => setExpandedExteriorVCS(new Set())}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Collapse All
                    </button>
                  </div>
                </div>
              </div>
              {renderConditionTable(conditionData.exterior, 'Exterior', expandedExteriorVCS, setExpandedExteriorVCS)}
            </div>

            {/* Interior Condition Analysis */}
            <div style={{ marginBottom: '30px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '10px 15px',
                backgroundColor: '#F0F9FF',
                borderRadius: '6px',
                marginBottom: '15px'
              }}>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600', 
                  margin: '0',
                  color: '#1E40AF'
                }}>
                  Interior Condition Analysis
                </h3>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  {/* Interior Inspections Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      id="useInteriorInspections"
                      checked={useInteriorInspections}
                      onChange={(e) => setUseInteriorInspections(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <label
                      htmlFor="useInteriorInspections"
                      style={{
                        fontSize: '13px',
                        cursor: 'pointer',
                        color: '#1E40AF'
                      }}
                    >
                      Use Interior Inspections Only
                    </label>
                    <div
                      style={{
                        display: 'inline-block',
                        position: 'relative',
                        cursor: 'help'
                      }}
                      title="When enabled, only includes properties where inspectors had actual interior access (not estimations or refusals)"
                    >
                      <Info size={14} style={{ color: '#6B7280' }} />
                    </div>
                  </div>

                  {/* Expand/Collapse Buttons - Match Land Valuation Style */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      onClick={() => setExpandedInteriorVCS(new Set(Object.keys(conditionData.interior)))}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#10B981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Expand All
                    </button>
                    <button
                      onClick={() => setExpandedInteriorVCS(new Set())}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#EF4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Collapse All
                    </button>
                  </div>
                </div>
              </div>


              {renderConditionTable(conditionData.interior, 'Interior', expandedInteriorVCS, setExpandedInteriorVCS)}
            </div>
          </>
        )}

        {/* No Data Message */}
        {!conditionData.loading && !conditionData.error && 
         Object.keys(conditionData.exterior).length === 0 && 
         Object.keys(conditionData.interior).length === 0 && (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center',
            backgroundColor: '#F9FAFB',
            borderRadius: '6px',
            color: '#6B7280'
          }}>
            <div style={{ fontSize: '16px', marginBottom: '10px' }}>
              No condition data available for analysis
            </div>
            <div style={{ fontSize: '14px' }}>
              Properties may be missing condition codes or normalized sale values
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============ ADD SPINNER ANIMATION TO STYLES ============
  // Add this to your component or in a <style> tag
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);
  // ============ CUSTOM ATTRIBUTE ANALYSIS FUNCTIONS ============
  // Mirror the loader in AdjustmentsTab: pull Cat 39 (Miscellaneous) and
  // Cat 15 (Detached Items) codes from parsed_code_definitions for the
  // current job. Vendor-aware:
  //   - BRT: sections.Residential parent whose KEY === '39' / '15' -> MAP
  //   - Microsystems: field_codes prefixes 590/591/592/593 (misc) and 680 (detached)
  const loadCodeOptions = useCallback(() => {
    const cat39 = [];
    const cat15 = [];

    try {
      if (vendorType === 'Microsystems' && parsedCodeDefinitions?.field_codes) {
        const fc = parsedCodeDefinitions.field_codes;
        // Misc (590-593) — dedupe across prefixes
        const miscSeen = new Set();
        ['590', '591', '592', '593'].forEach(prefix => {
          Object.entries(fc[prefix] || {}).forEach(([code, data]) => {
            if (data?.description && !miscSeen.has(code)) {
              miscSeen.add(code);
              cat39.push({ code, description: String(data.description).trim(), category: '39' });
            }
          });
        });
        // Detached (680)
        Object.entries(fc['680'] || {}).forEach(([code, data]) => {
          if (data?.description) {
            cat15.push({ code, description: String(data.description).trim(), category: '15' });
          }
        });
      } else {
        const sections = parsedCodeDefinitions?.sections || parsedCodeDefinitions || {};
        const residential = sections.Residential || sections.residential || {};
        Object.keys(residential).forEach(parentKey => {
          const parent = residential[parentKey];
          const categoryKey = parent?.KEY || parent?.key;
          if (categoryKey !== '39' && categoryKey !== '15') return;
          const map = parent?.MAP || parent?.map || {};
          Object.keys(map).forEach(codeKey => {
            if (codeKey === 'KEY' || codeKey === 'DATA' || codeKey === 'MAP') return;
            const item = map[codeKey];
            let description = '';
            if (item?.DATA?.VALUE) description = item.DATA.VALUE;
            else if (item?.VALUE) description = item.VALUE;
            else if (typeof item === 'string') description = item;
            if (!description) return;
            const bucket = categoryKey === '39' ? cat39 : cat15;
            bucket.push({ code: codeKey, description: String(description).trim(), category: categoryKey });
          });
        });
      }
    } catch (err) {
      console.error('Error loading custom attribute code options:', err);
    }

    const sortByCode = (a, b) => a.code.localeCompare(b.code);
    cat39.sort(sortByCode);
    cat15.sort(sortByCode);
    const merged = [...cat39, ...cat15];
    setCodeOptions(merged);
    if (cat39.length > 0 && !selectedMiscCode) setSelectedMiscCode(cat39[0].code);
    if (cat15.length > 0 && !selectedDetachedCode) setSelectedDetachedCode(cat15[0].code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedCodeDefinitions, vendorType]);

  // Load code options when switching to custom attribute tab
  useEffect(() => {
    if (active === 'custom' && codeOptions.length === 0) {
      loadCodeOptions();
    }
  }, [active, codeOptions.length, loadCodeOptions]);

  // Vendor-aware slot definitions — sourced from brt-processor.js and
  // microsystems-processor.js so the predicate matches what ingest stores.
  //   misc:     [ { codeCol } ]              (no area concept)
  //   detached: [ { codeCol, sizeCols[] } ]  (sizeCols sum / multiply to sf)
  const BRT_MISC_SLOTS = ['MISC_1', 'MISC_2', 'MISC_3', 'MISC_4', 'MISC_5']
    .map(c => ({ codeCol: c }));
  const BRT_DETACHED_SLOTS = Array.from({ length: 11 }, (_, i) => ({
    codeCol: `DETACHEDCODE_${i + 1}`,
    sizeCols: [`DETACHEDDCSIZE_${i + 1}`],
  }));
  const MS_MISC_SLOTS = ['Misc Item 1', 'Misc Item 2', 'Misc Item 3']
    .map(c => ({ codeCol: c }));
  const MS_DETACHED_SLOTS = [
    { codeCol: 'Detached Item Code1', sizeCols: ['Sq Ft1'], wCol: 'Width1', dCol: 'Depth1' },
    { codeCol: 'Detached Item Code2', sizeCols: ['Sq Ft2'], wCol: 'Width2', dCol: 'Depth2' },
    { codeCol: 'Detached Item Code3', sizeCols: ['Sq Ft3'], wCol: 'Width3', dCol: 'Depth3' },
    { codeCol: 'Detached Item Code4', sizeCols: ['Sq Ft4'], wCol: 'Width4', dCol: 'Depth4' },
    { codeCol: 'Detachedbuilding1', sizeCols: ['Sq Ft1'], wCol: 'Widthn1', dCol: 'Depthn1' },
    { codeCol: 'Detachedbuilding2', sizeCols: ['Sq Ft2'], wCol: 'Widthn2', dCol: 'Depthn2' },
    { codeCol: 'Detachedbuilding3', sizeCols: ['Sq Ft3'], wCol: 'Widthn3', dCol: 'Depthn3' },
    { codeCol: 'Detachedbuilding4', sizeCols: ['Sq Ft4'], wCol: 'Widthn4', dCol: 'Depthn4' },
  ];

  const slotsFor = (category) => {
    if (vendorType === 'Microsystems') return category === '15' ? MS_DETACHED_SLOTS : MS_MISC_SLOTS;
    return category === '15' ? BRT_DETACHED_SLOTS : BRT_MISC_SLOTS;
  };

  // For a given slot, compute the area (sf) of the detached item. Prefer an
  // explicit Sq Ft column; fall back to width × depth for Microsystems.
  const slotArea = (rawData, slot) => {
    if (!slot.sizeCols) return 0;
    for (const c of slot.sizeCols) {
      const v = Number(rawData?.[c]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    if (slot.wCol && slot.dCol) {
      const w = Number(rawData?.[slot.wCol]);
      const d = Number(rawData?.[slot.dCol]);
      if (Number.isFinite(w) && Number.isFinite(d) && w > 0 && d > 0) return w * d;
    }
    return 0;
  };

  // Walk every misc + detached slot on the given raw_data row and tally the
  // codes present. Returns { '39': { CODE: n }, '15': { CODE: n } }.
  const tallyCodesOnRow = (rawData) => {
    const out = { '39': {}, '15': {} };
    if (!rawData) return out;
    [['39', slotsFor('39')], ['15', slotsFor('15')]].forEach(([cat, slots]) => {
      slots.forEach(slot => {
        const v = rawData[slot.codeCol];
        if (v == null) return;
        const code = String(v).trim().toUpperCase();
        if (!code) return;
        out[cat][code] = (out[cat][code] || 0) + 1;
      });
    });
    return out;
  };

  // Build the code-count cache from a set of { p, raw, isQualified } rows.
  const buildCodeCountCache = (rows) => {
    const cache = {};
    rows.forEach(({ raw, isQualified }) => {
      const tally = tallyCodesOnRow(raw);
      ['39', '15'].forEach(cat => {
        Object.entries(tally[cat]).forEach(([code]) => {
          const key = `${cat}:${code}`;
          if (!cache[key]) cache[key] = { totalProps: 0, qualifiedSales: 0 };
          cache[key].totalProps += 1;
          if (isQualified) cache[key].qualifiedSales += 1;
        });
      });
    });
    return cache;
  };

  // Prefetch raw_data for all properties on first tab open so the dropdown
  // banner can show "X properties have this code" before any study runs.
  const prefetchCodeCounts = useCallback(async () => {
    if (prefetchingCounts) return;
    if (Object.keys(codeCountCache).length > 0) return;
    if (!properties || properties.length === 0) return;
    setPrefetchingCounts(true);
    try {
      const chunkSize = 100;
      const rows = [];
      for (let i = 0; i < properties.length; i += chunkSize) {
        const chunk = properties.slice(i, i + chunkSize);
        const fetched = await Promise.all(chunk.map(async p => {
          if (!p.job_id || !p.property_composite_key) return null;
          const raw = await propertyService.getRawDataForProperty(p.job_id, p.property_composite_key);
          const md = propertyMarketData.find(m => m.property_composite_key === p.property_composite_key);
          return { p, raw, isQualified: Number(md?.values_norm_time) > 0 };
        }));
        fetched.forEach(r => { if (r) rows.push(r); });
      }
      setCodeCountCache(buildCodeCountCache(rows));
    } catch (err) {
      console.error('Error prefetching code counts:', err);
    } finally {
      setPrefetchingCounts(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, propertyMarketData, codeCountCache, prefetchingCounts]);

  useEffect(() => {
    if (active === 'custom' && properties.length > 0 && propertyMarketData.length > 0
        && Object.keys(codeCountCache).length === 0 && !prefetchingCounts) {
      prefetchCodeCounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, properties.length, propertyMarketData.length]);

  // Count slots holding the code, and sum their area (detached only).
  const countAndArea = (rawData, code, category) => {
    if (!rawData || !code) return { count: 0, area: 0 };
    const target = String(code).trim().toUpperCase();
    const slots = slotsFor(category);
    let count = 0;
    let area = 0;
    for (const slot of slots) {
      const v = rawData[slot.codeCol];
      if (v == null) continue;
      if (String(v).trim().toUpperCase() !== target) continue;
      count += 1;
      if (category === '15') area += slotArea(rawData, slot);
    }
    return { count, area };
  };

  // Run custom attribute analysis using the eco-obs methodology:
  //   - WITH = qualified sales whose raw_data contains the selected code
  //   - WITHOUT = qualified sales that don't
  //   - Jim's size-normalization on values_norm_time using the AVG SFLA of
  //     both groups as the target size (same as calculateEcoObsImpact)
  //   - dollarImpact = adjWith - adjWithout
  //   - Misc: per-item adjustment = dollarImpact / avgCount(with)
  //   - Detached: per-sf rate     = dollarImpact / avgArea(with)
  const runCustomAttributeAnalysis = async (mode /* '39' | '15' */) => {
    const selCategory = mode;
    const selCode = (mode === '15' ? selectedDetachedCode : selectedMiscCode);
    if (!selCode) return;
    const selOption = codeOptions.find(o => o.code === selCode && o.category === selCategory);

    setCustomWorking(true);
    try {
      // Apply type/use filter FIRST (mirrors eco-obs behavior) so we never
      // mix single-family with condo / multi-family inside the same study.
      const typeFilteredProps = filterPropertiesByType(properties, customTypeUseFilter);

      // Qualified sales = type-filtered properties with values_norm_time > 0
      const validProps = typeFilteredProps.filter(p => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        return marketData?.values_norm_time > 0;
      });

      // Hydrate raw_data in batches
      const lookup = [];
      const chunkSize = 100;
      for (let i = 0; i < validProps.length; i += chunkSize) {
        const chunk = validProps.slice(i, i + chunkSize);
        const rawDataPromises = chunk.map(async p => {
          const raw = await propertyService.getRawDataForProperty(p.job_id, p.property_composite_key);
          return { p, raw };
        });
        const results = await Promise.all(rawDataPromises);
        lookup.push(...results);
      }

      // Refresh code-count cache as a side-effect of this run (we just paid
      // for the raw_data fetch; reuse it).
      setCodeCountCache(buildCodeCountCache(lookup.map(({ p, raw }) => {
        const md = propertyMarketData.find(m => m.property_composite_key === p.property_composite_key);
        return { p, raw, isQualified: Number(md?.values_norm_time) > 0 };
      })));

      // Build sample rows enriched with normalizedTime + sfla + count/area
      const samples = lookup.map(({ p, raw }) => {
        const md = propertyMarketData.find(m => m.property_composite_key === p.property_composite_key);
        const normTime = Number(md?.values_norm_time) || 0;
        const sfla = Number(p.asset_sfla || p.sfla || p.property_sfla) || 0;
        const { count, area } = countAndArea(raw, selCode, selCategory);
        const vcs = p.new_vcs || p.property_vcs || 'UNKNOWN';
        return { p, vcs, normTime, sfla, count, area, has: count > 0 };
      }).filter(s => s.normTime > 0);

      const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

      const computeImpact = (rows) => {
        const withFactor = rows.filter(r => r.has);
        const withoutFactor = rows.filter(r => !r.has);
        if (withFactor.length === 0 || withoutFactor.length === 0) {
          return {
            withCount: withFactor.length,
            withoutCount: withoutFactor.length,
            insufficient: true,
          };
        }
        const avgWithTime = avg(withFactor.map(r => r.normTime));
        const avgWithoutTime = avg(withoutFactor.map(r => r.normTime));
        const avgWithSFLA = avg(withFactor.filter(r => r.sfla > 0).map(r => r.sfla));
        const avgWithoutSFLA = avg(withoutFactor.filter(r => r.sfla > 0).map(r => r.sfla));
        const averageSize = (avgWithSFLA + avgWithoutSFLA) / 2;

        // Jim's formula
        const adjWith = avgWithSFLA > 0
          ? Math.round(avgWithTime + ((averageSize - avgWithSFLA) * (avgWithTime / avgWithSFLA) * 0.5))
          : Math.round(avgWithTime);
        const adjWithout = avgWithoutSFLA > 0
          ? Math.round(avgWithoutTime + ((averageSize - avgWithoutSFLA) * (avgWithoutTime / avgWithoutSFLA) * 0.5))
          : Math.round(avgWithoutTime);

        const dollarImpact = adjWith - adjWithout;
        const pctImpact = adjWithout > 0 ? ((adjWith - adjWithout) / adjWithout) * 100 : 0;

        const avgCount = avg(withFactor.map(r => r.count));
        const avgArea = avg(withFactor.filter(r => r.area > 0).map(r => r.area));
        const perItem = avgCount > 0 ? Math.round(dollarImpact / avgCount) : null;
        const perSf = selCategory === '15' && avgArea > 0 ? Math.round(dollarImpact / avgArea) : null;

        return {
          withCount: withFactor.length,
          withoutCount: withoutFactor.length,
          avgWithTime: Math.round(avgWithTime),
          avgWithoutTime: Math.round(avgWithoutTime),
          avgWithSFLA: Math.round(avgWithSFLA),
          avgWithoutSFLA: Math.round(avgWithoutSFLA),
          adjWith,
          adjWithout,
          dollarImpact,
          pctImpact: Number(pctImpact.toFixed(1)),
          avgCount: Number(avgCount.toFixed(2)),
          avgArea: Math.round(avgArea),
          perItem,
          perSf,
        };
      };

      const overall = computeImpact(samples);

      // Per-VCS rollup
      const byVcs = {};
      const vcsBuckets = {};
      samples.forEach(s => {
        if (!vcsBuckets[s.vcs]) vcsBuckets[s.vcs] = [];
        vcsBuckets[s.vcs].push(s);
      });
      Object.entries(vcsBuckets).forEach(([vcs, rows]) => {
        byVcs[vcs] = computeImpact(rows);
      });

      const typeUseOpt = getTypeUseOptions().find(o => o.code === customTypeUseFilter);
      const results = {
        code: selCode,
        category: selCategory,
        label: selOption ? `${selCode} — ${selOption.description}` : selCode,
        type_use: customTypeUseFilter,
        type_use_label: typeUseOpt ? typeUseOpt.description : customTypeUseFilter,
        field: selCode,
        overall: overall.insufficient ? overall : {
          with: { n: overall.withCount, avg_price: overall.avgWithTime, avg_size: overall.avgWithSFLA, adj_price: overall.adjWith, avg_count: overall.avgCount, avg_area: overall.avgArea },
          without: { n: overall.withoutCount, avg_price: overall.avgWithoutTime, avg_size: overall.avgWithoutSFLA, adj_price: overall.adjWithout },
          flat_adj: overall.dollarImpact,
          pct_adj: overall.pctImpact,
          per_item: overall.perItem,
          per_sf: overall.perSf,
        },
        byVCS: Object.fromEntries(Object.entries(byVcs).map(([vcs, x]) => [vcs, x.insufficient ? x : {
          with: { n: x.withCount, avg_price: x.avgWithTime, avg_size: x.avgWithSFLA, adj_price: x.adjWith, avg_count: x.avgCount, avg_area: x.avgArea },
          without: { n: x.withoutCount, avg_price: x.avgWithoutTime, avg_size: x.avgWithoutSFLA, adj_price: x.adjWithout },
          flat_adj: x.dollarImpact,
          pct_adj: x.pctImpact,
          per_item: x.perItem,
          per_sf: x.perSf,
        }])),
        generated_at: new Date().toISOString(),
      };

      setCustomResults(results);

      // Persist as a new row in job_custom_attribute_studies (one row per run).
      // Also mirror to market_land_valuation.custom_attribute_rollup so the
      // last run is still cached in the parent jobData (backwards compatible).
      await Promise.all([
        persistStudyRow(results),
        saveCustomResultsToDB(results),
      ]);
      await loadSavedStudies();

    } catch (error) {
      console.error('Error running custom attribute analysis:', error);
    } finally {
      setCustomWorking(false);
    }
  };

  // ---------- Saved-studies CRUD against job_custom_attribute_studies ----------
  const persistStudyRow = async (results) => {
    if (!jobData?.id || !results) return;
    try {
      const { data, error } = await supabase
        .from('job_custom_attribute_studies')
        .insert({
          job_id: jobData.id,
          code: results.code,
          category: results.category,
          label: results.label,
          name: results.label,
          results,
        })
        .select('id')
        .single();
      if (error) throw error;
      if (data?.id) setActiveStudyId(data.id);
    } catch (err) {
      console.error('Error saving study row:', err);
    }
  };

  const loadSavedStudies = useCallback(async () => {
    if (!jobData?.id) return;
    setLoadingStudies(true);
    try {
      const { data, error } = await supabase
        .from('job_custom_attribute_studies')
        .select('id, code, category, label, name, results, created_at, updated_at')
        .eq('job_id', jobData.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSavedStudies(data || []);
    } catch (err) {
      console.error('Error loading saved studies:', err);
      setSavedStudies([]);
    } finally {
      setLoadingStudies(false);
    }
  }, [jobData?.id]);

  useEffect(() => {
    if (active === 'custom' && jobData?.id) loadSavedStudies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, jobData?.id]);

  const openStudy = (study) => {
    if (!study?.results) return;
    setCustomResults(study.results);
    setActiveStudyId(study.id);
    if (study.category === '15') setSelectedDetachedCode(study.code);
    else setSelectedMiscCode(study.code);
    if (study.results?.type_use) setCustomTypeUseFilter(study.results.type_use);
  };

  const rerunStudy = async (study) => {
    if (!study) return;
    if (study.category === '15') {
      setSelectedDetachedCode(study.code);
      await runCustomAttributeAnalysis('15');
    } else {
      setSelectedMiscCode(study.code);
      await runCustomAttributeAnalysis('39');
    }
  };

  const renameStudy = async (study) => {
    const next = window.prompt('Rename study', study.name || study.label || '');
    if (next == null) return;
    const trimmed = String(next).trim();
    if (!trimmed) return;
    try {
      const { error } = await supabase
        .from('job_custom_attribute_studies')
        .update({ name: trimmed, updated_at: new Date().toISOString() })
        .eq('id', study.id);
      if (error) throw error;
      await loadSavedStudies();
    } catch (err) {
      console.error('Error renaming study:', err);
    }
  };

  const deleteStudy = async (study) => {
    if (!study?.id) return;
    if (!window.confirm(`Delete saved study “${study.name || study.label}”?`)) return;
    try {
      const { error } = await supabase
        .from('job_custom_attribute_studies')
        .delete()
        .eq('id', study.id);
      if (error) throw error;
      if (activeStudyId === study.id) {
        setActiveStudyId(null);
        setCustomResults(null);
      }
      await loadSavedStudies();
    } catch (err) {
      console.error('Error deleting study:', err);
    }
  };

  // Save custom results to database
  const saveCustomResultsToDB = async (results) => {
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert({
          job_id: jobData.id,
          custom_attribute_rollup: results,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id'
        });

      if (error) throw error;

      // After saving custom results
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 AttributeCardsTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }
    } catch (error) {
      console.error('Error saving custom results:', error);
    }
  };

  // ---------- Excel export (single study + all studies) ----------
  // Follows the formatting pattern in LandValuationTab.jsx: aoa_to_sheet,
  // explicit !cols widths, bold header row, currency / percent number formats.
  const buildStudySheetRows = (study) => {
    const isDetached = study.category === '15';
    const titleLine = `${isDetached ? 'Detached Items' : 'Miscellaneous'}: ${study.label || study.field || study.code} — Analysis by VCS`;
    const meta = [
      ['Job', jobData?.job_name || jobData?.municipality || ''],
      ['Vendor', vendorType],
      ['Type/Use', study.type_use_label || study.type_use || 'All Properties'],
      ['Methodology', isDetached ? '$/sq ft (Jim formula)' : 'Per item (Jim formula)'],
      ['Generated', study.generated_at ? new Date(study.generated_at).toLocaleString() : ''],
    ];

    const header = [
      'VCS', 'With (n)', 'With Adj Sale', 'Without (n)', 'Without Adj Sale',
      '$ Impact', '% Impact', isDetached ? 'Per Sq Ft' : 'Per Item',
      'Avg With SFLA', 'Avg Without SFLA', isDetached ? 'Avg Item Area' : 'Avg Count',
    ];

    const dataRow = (label, d) => {
      if (!d || d.insufficient) {
        return [
          label, d?.withCount ?? '', '', d?.withoutCount ?? '', '',
          '', '', '', '', '', '',
        ];
      }
      return [
        label,
        d.with?.n ?? '',
        d.with?.adj_price ?? '',
        d.without?.n ?? '',
        d.without?.adj_price ?? '',
        d.flat_adj ?? '',
        d.pct_adj != null ? d.pct_adj / 100 : '',
        (isDetached ? d.per_sf : d.per_item) ?? '',
        d.with?.avg_size ?? '',
        d.without?.avg_size ?? '',
        isDetached ? (d.with?.avg_area ?? '') : (d.with?.avg_count ?? ''),
      ];
    };

    const rows = [
      [titleLine],
      [],
      ...meta,
      [],
      header,
    ];

    Object.entries(study.results?.byVCS || study.byVCS || {}).forEach(([vcs, d]) => {
      rows.push(dataRow(vcs, d));
    });
    rows.push(dataRow('ALL VCS', study.results?.overall || study.overall));
    return { rows, header, isDetached, titleLine };
  };

  const applyStudySheetFormatting = (ws, built) => {
    const { rows, header, isDetached } = built;
    ws['!cols'] = [
      { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 18 },
      { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    ];
    // Title row merge
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
    const titleCell = ws['A1'];
    if (titleCell) {
      titleCell.s = { font: { bold: true, sz: 14 }, alignment: { horizontal: 'left' } };
    }
    // Header row (row index = number of preamble rows; preamble = 1 title + 1 blank + 5 meta + 1 blank = 8)
    const headerRowIdx = 8;
    for (let c = 0; c < header.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      if (ws[addr]) {
        ws[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '1E40AF' } },
          alignment: { horizontal: 'center' },
        };
      }
    }
    // Currency / percent formats on data rows
    const dataStart = headerRowIdx + 1;
    const dataEnd = rows.length - 1;
    const currencyCols = [2, 4, 5, 7]; // With Adj, Without Adj, $ Impact, Per ($)
    const percentCols = [6];
    const sfCols = isDetached ? [8, 9, 10] : [8, 9];
    for (let r = dataStart; r <= dataEnd; r++) {
      currencyCols.forEach(c => {
        const a = XLSX.utils.encode_cell({ r, c });
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '"$"#,##0';
      });
      percentCols.forEach(c => {
        const a = XLSX.utils.encode_cell({ r, c });
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '0.0%';
      });
      sfCols.forEach(c => {
        const a = XLSX.utils.encode_cell({ r, c });
        if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '#,##0';
      });
    }
    // Bold the ALL VCS total row
    const totalRow = dataEnd;
    for (let c = 0; c < header.length; c++) {
      const a = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[a]) {
        ws[a].s = { ...(ws[a].s || {}), font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } } };
      }
    }
    return ws;
  };

  const exportStudyToExcel = (study) => {
    if (!study) return;
    const wrapped = study.results ? study : { results: study, category: study.category, label: study.label, code: study.code, generated_at: study.generated_at, type_use: study.type_use, type_use_label: study.type_use_label };
    const built = buildStudySheetRows(wrapped);
    const ws = XLSX.utils.aoa_to_sheet(built.rows);
    applyStudySheetFormatting(ws, built);
    const wb = XLSX.utils.book_new();
    const safeName = (wrapped.label || wrapped.code || 'study').toString().replace(/[^A-Za-z0-9]+/g, '_').slice(0, 25);
    XLSX.utils.book_append_sheet(wb, ws, safeName.slice(0, 28) || 'Study');
    const fname = `${jobData?.job_name || 'job'}_${wrapped.category === '15' ? 'detached' : 'misc'}_${safeName}.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  const exportAllStudiesToExcel = (studies) => {
    if (!studies || studies.length === 0) return;
    const wb = XLSX.utils.book_new();
    // Index sheet
    const indexHeader = ['Study Name', 'Category', 'Code', 'Type/Use', 'With (n)', 'Without (n)', '$ Impact', '% Impact', 'Per Unit', 'Created'];
    const indexRows = [['Custom Attribute Studies — Index'], [], indexHeader];
    studies.forEach(s => {
      const o = s.results?.overall || s.overall;
      const isDet = (s.category || s.results?.category) === '15';
      indexRows.push([
        s.name || s.label || s.results?.label || '',
        isDet ? 'Detached' : 'Miscellaneous',
        s.code || s.results?.code || '',
        s.results?.type_use_label || s.results?.type_use || '',
        o?.with?.n ?? o?.withCount ?? '',
        o?.without?.n ?? o?.withoutCount ?? '',
        o?.flat_adj ?? '',
        o?.pct_adj != null ? o.pct_adj / 100 : '',
        (isDet ? o?.per_sf : o?.per_item) ?? '',
        s.created_at ? new Date(s.created_at).toLocaleString() : '',
      ]);
    });
    const indexWs = XLSX.utils.aoa_to_sheet(indexRows);
    indexWs['!cols'] = [
      { wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 22 },
      { wch: 9 }, { wch: 11 }, { wch: 13 }, { wch: 10 }, { wch: 13 }, { wch: 22 },
    ];
    indexWs['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: indexHeader.length - 1 } }];
    if (indexWs['A1']) indexWs['A1'].s = { font: { bold: true, sz: 14 } };
    for (let c = 0; c < indexHeader.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 2, c });
      if (indexWs[addr]) {
        indexWs[addr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '1E40AF' } },
          alignment: { horizontal: 'center' },
        };
      }
    }
    XLSX.utils.book_append_sheet(wb, indexWs, 'Index');

    // One sheet per study
    const usedNames = new Set(['Index']);
    studies.forEach((s, idx) => {
      const wrapped = s.results ? s : { results: s };
      const built = buildStudySheetRows({
        category: s.category || s.results?.category,
        label: s.label || s.results?.label,
        field: s.code,
        type_use: s.results?.type_use,
        type_use_label: s.results?.type_use_label,
        results: wrapped.results,
        generated_at: s.created_at || s.results?.generated_at,
      });
      const ws = XLSX.utils.aoa_to_sheet(built.rows);
      applyStudySheetFormatting(ws, built);
      let name = (s.name || s.label || s.results?.label || `Study ${idx + 1}`).toString().replace(/[^A-Za-z0-9 _-]+/g, '').slice(0, 28) || `Study ${idx + 1}`;
      let unique = name; let dedup = 2;
      while (usedNames.has(unique)) { unique = `${name.slice(0, 25)} ${dedup++}`; }
      usedNames.add(unique);
      XLSX.utils.book_append_sheet(wb, ws, unique);
    });

    const fname = `${jobData?.job_name || 'job'}_custom_attribute_studies.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  // Export custom results to CSV
  const exportCustomResultsToCSV = () => {
    if (!customResults) return;
    
    const isDetached = customResults.category === '15';
    const headers = [
      'Group', 'With_Count', 'With_Avg', 'With_Adj', 'Without_Count', 'Without_Avg', 'Without_Adj',
      'Flat_Adj', 'Pct_Adj', isDetached ? 'Per_Sf' : 'Per_Item',
    ];
    const rows = [];

    const rowFromGroup = (label, data) => {
      if (!data || data.insufficient) {
        return [label, data?.withCount ?? '', '', '', data?.withoutCount ?? '', '', '', '', '', ''];
      }
      return [
        label,
        data.with?.n ?? '',
        data.with?.avg_price ?? '',
        data.with?.adj_price ?? '',
        data.without?.n ?? '',
        data.without?.avg_price ?? '',
        data.without?.adj_price ?? '',
        data.flat_adj ?? '',
        data.pct_adj != null ? Number(data.pct_adj).toFixed(1) : '',
        (isDetached ? data.per_sf : data.per_item) ?? '',
      ];
    };

    rows.push(rowFromGroup('OVERALL', customResults.overall));
    Object.entries(customResults.byVCS || {}).forEach(([vcs, data]) => {
      rows.push(rowFromGroup(vcs, data));
    });
    
    const filename = `${jobData.job_name || 'job'}_custom_attribute_${customResults.field}.csv`;
    downloadCsv(filename, headers, rows);
  };
  // ============ RENDER CUSTOM ATTRIBUTE ANALYSIS ============
  const renderCustomAttributeAnalysis = () => {
    return (
      <div>
        {/* Controls */}
        <div style={{ 
          marginBottom: '20px', 
          padding: '15px', 
          backgroundColor: '#F9FAFB', 
          borderRadius: '6px',
          border: '1px solid #E5E7EB'
        }}>
          {savedStudies.length > 0 && (
            <div style={{ marginBottom: '14px', padding: '10px 12px', backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                  Saved Studies ({savedStudies.length})
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {loadingStudies && (
                    <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Refreshing…</span>
                  )}
                  <button
                    onClick={() => exportAllStudiesToExcel(savedStudies)}
                    className={CSV_BUTTON_CLASS}
                  >
                    <FileText size={14} /> Export All
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
                {savedStudies.map(study => {
                  const isActive = study.id === activeStudyId;
                  const overall = study.results?.overall;
                  const summary = overall?.insufficient
                    ? `Insufficient sample (with: ${overall.withCount}, without: ${overall.withoutCount})`
                    : overall
                      ? `${overall.with?.n ?? 0} with · ${overall.without?.n ?? 0} without · ${overall.flat_adj != null ? formatCurrency(overall.flat_adj) : '-'} impact${
                          study.category === '15'
                            ? (overall.per_sf != null ? ` · ${formatCurrency(overall.per_sf)}/sf` : '')
                            : (overall.per_item != null ? ` · ${formatCurrency(overall.per_item)}/item` : '')
                        }`
                      : '';
                  return (
                    <div key={study.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                      padding: '8px 10px', border: `1px solid ${isActive ? '#3B82F6' : '#E5E7EB'}`,
                      borderRadius: '4px', backgroundColor: isActive ? '#EFF6FF' : '#F9FAFB',
                    }}>
                      <button
                        onClick={() => openStudy(study)}
                        style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
                          {study.name || study.label || `${study.category}:${study.code}`}
                          <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 400, color: '#6B7280' }}>
                            ({study.category === '15' ? 'Detached' : 'Misc'})
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
                          {summary} · {new Date(study.created_at).toLocaleString()}
                        </div>
                      </button>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => rerunStudy(study)}
                          disabled={customWorking}
                          style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', background: 'white', cursor: customWorking ? 'not-allowed' : 'pointer' }}
                        >
                          Re-run
                        </button>
                        <button
                          onClick={() => renameStudy(study)}
                          style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', background: 'white', cursor: 'pointer' }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => deleteStudy(study)}
                          style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid #FCA5A5', borderRadius: '4px', background: 'white', color: '#B91C1C', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
              Select Field and Value to Analyze
            </h4>
            <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
              Compare properties with vs without specific attributes to determine value impact.
              {prefetchingCounts && (
                <span style={{ marginLeft: '8px', color: '#3B82F6' }}>Loading record counts…</span>
              )}
              {!prefetchingCounts && Object.keys(codeCountCache).length === 0 && (
                <span style={{ marginLeft: '8px', color: '#9CA3AF' }}>
                  (record counts appear once data is loaded)
                </span>
              )}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: '#6B7280', fontWeight: 500 }}>Type/Use:</label>
              <select
                value={customTypeUseFilter}
                onChange={(e) => setCustomTypeUseFilter(e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '12px', backgroundColor: 'white' }}
                disabled={customWorking}
              >
                {getTypeUseOptions().map(o => (
                  <option key={o.code} value={o.code}>{o.description}</option>
                ))}
              </select>
              <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
                (filters both groups so single-family doesn't mix with condo / multi-family)
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: '1' }}>
              <label style={{ fontSize: '12px', color: '#6B7280', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Miscellaneous (Cat 39)</span>
                {selectedMiscCode && codeCountCache[`39:${selectedMiscCode.toUpperCase()}`] && (
                  <span style={{ color: '#0F766E', fontWeight: 500 }}>
                    {codeCountCache[`39:${selectedMiscCode.toUpperCase()}`].totalProps} properties
                    {' '}· {codeCountCache[`39:${selectedMiscCode.toUpperCase()}`].qualifiedSales} qualified sales
                  </span>
                )}
              </label>
              <select
                value={selectedMiscCode}
                onChange={(e) => setSelectedMiscCode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: 'white',
                }}
                disabled={customWorking}
              >
                <option value="">Select a misc code…</option>
                {codeOptions.filter(o => o.category === '39').map(o => (
                  <option key={`39:${o.code}`} value={o.code}>{o.code} — {o.description}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => runCustomAttributeAnalysis('39')}
              disabled={customWorking || !selectedMiscCode}
              style={{
                padding: '6px 14px',
                backgroundColor: customWorking || !selectedMiscCode ? '#E5E7EB' : '#3B82F6',
                color: customWorking || !selectedMiscCode ? '#9CA3AF' : 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: customWorking || !selectedMiscCode ? 'not-allowed' : 'pointer',
              }}
            >
              {customWorking ? 'Analyzing…' : 'Run Misc'}
            </button>

            <div style={{ flex: '1' }}>
              <label style={{ fontSize: '12px', color: '#6B7280', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Detached Items (Cat 15)</span>
                {selectedDetachedCode && codeCountCache[`15:${selectedDetachedCode.toUpperCase()}`] && (
                  <span style={{ color: '#0F766E', fontWeight: 500 }}>
                    {codeCountCache[`15:${selectedDetachedCode.toUpperCase()}`].totalProps} properties
                    {' '}· {codeCountCache[`15:${selectedDetachedCode.toUpperCase()}`].qualifiedSales} qualified sales
                  </span>
                )}
              </label>
              <select
                value={selectedDetachedCode}
                onChange={(e) => setSelectedDetachedCode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: 'white',
                }}
                disabled={customWorking}
              >
                <option value="">Select a detached code…</option>
                {codeOptions.filter(o => o.category === '15').map(o => (
                  <option key={`15:${o.code}`} value={o.code}>{o.code} — {o.description}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => runCustomAttributeAnalysis('15')}
              disabled={customWorking || !selectedDetachedCode}
              style={{
                padding: '6px 14px',
                backgroundColor: customWorking || !selectedDetachedCode ? '#E5E7EB' : '#3B82F6',
                color: customWorking || !selectedDetachedCode ? '#9CA3AF' : 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: customWorking || !selectedDetachedCode ? 'not-allowed' : 'pointer',
              }}
            >
              {customWorking ? 'Analyzing…' : 'Run Detached'}
            </button>
            
            {customResults && (
              <button
                onClick={exportCustomResultsToCSV}
                className={CSV_BUTTON_CLASS}
              >
                <FileText size={14} /> Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {customResults && (
          <div>
            {customResults.overall?.insufficient && (
              <div style={{ marginBottom: '14px', fontSize: '13px', color: '#92400E', backgroundColor: '#FEF3C7', padding: '10px 12px', borderRadius: '4px', border: '1px solid #FDE68A' }}>
                Not enough qualified sales to compare — with: {customResults.overall.withCount}, without: {customResults.overall.withoutCount}.
              </div>
            )}

            {/* VCS Breakdown — per-study header */}
            <div style={{
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '12px 15px',
                backgroundColor: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0', color: '#111827' }}>
                    {customResults.category === '15' ? 'Detached Items' : 'Miscellaneous'}: {customResults.label || customResults.field} — Analysis by VCS
                  </h4>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
                    Type/Use: {customResults.type_use_label || customResults.type_use || 'All Properties'}
                    {' · '}
                    {customResults.category === '15' ? '$/sf rate methodology' : 'per-item adjustment methodology'}
                  </div>
                </div>
                <button
                  onClick={() => exportStudyToExcel(customResults)}
                  className={CSV_BUTTON_CLASS}
                >
                  <FileText size={14} /> Export Excel
                </button>
              </div>
              
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F3F4F6' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: '600' }}>
                      VCS
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>
                      With (n)
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      With Adj Sale
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>
                      Without (n)
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Without Adj Sale
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      $ Impact
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      % Impact
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      {customResults.category === '15' ? 'Per Sq Ft' : 'Per Item'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(customResults.byVCS || {}).map(([vcs, data], idx) => {
                    if (data.insufficient) {
                      return (
                        <tr key={vcs} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                          <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '500' }}>{vcs}</td>
                          <td colSpan={6} style={{ padding: '8px 12px', fontSize: '12px', color: '#92400E' }}>
                            Not enough sales to compare (with: {data.withCount}, without: {data.withoutCount})
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={vcs} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                        <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '500' }}>{vcs}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{data.with.n}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                          {data.with.adj_price ? formatCurrency(data.with.adj_price) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{data.without.n}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                          {data.without.adj_price ? formatCurrency(data.without.adj_price) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px',
                            color: data.flat_adj > 0 ? '#059669' : data.flat_adj < 0 ? '#DC2626' : '#6B7280' }}>
                          {data.flat_adj ? formatCurrency(data.flat_adj) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px',
                            color: data.pct_adj > 0 ? '#059669' : data.pct_adj < 0 ? '#DC2626' : '#6B7280' }}>
                          {data.pct_adj ? formatPercent(data.pct_adj) : '-'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', color: '#0F766E', fontWeight: '500' }}>
                          {customResults.category === '15'
                            ? (data.per_sf != null ? `${formatCurrency(data.per_sf)}/sf` : '-')
                            : (data.per_item != null ? formatCurrency(data.per_item) : '-')}
                        </td>
                      </tr>
                    );
                  })}
                  {!customResults.overall.insufficient && (
                    <tr style={{ backgroundColor: '#EFF6FF', borderTop: '2px solid #BFDBFE' }}>
                      <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: '700', color: '#1E40AF' }}>
                        ALL VCS
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px', fontWeight: '600' }}>
                        {customResults.overall.with.n}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: '600' }}>
                        {customResults.overall.with.adj_price ? formatCurrency(customResults.overall.with.adj_price) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '13px', fontWeight: '600' }}>
                        {customResults.overall.without.n}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: '600' }}>
                        {customResults.overall.without.adj_price ? formatCurrency(customResults.overall.without.adj_price) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: '700',
                          color: customResults.overall.flat_adj > 0 ? '#059669' : customResults.overall.flat_adj < 0 ? '#DC2626' : '#6B7280' }}>
                        {customResults.overall.flat_adj ? formatCurrency(customResults.overall.flat_adj) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontWeight: '700',
                          color: customResults.overall.pct_adj > 0 ? '#059669' : customResults.overall.pct_adj < 0 ? '#DC2626' : '#6B7280' }}>
                        {customResults.overall.pct_adj ? formatPercent(customResults.overall.pct_adj) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', color: '#0F766E', fontWeight: '700' }}>
                        {customResults.category === '15'
                          ? (customResults.overall.per_sf != null ? `${formatCurrency(customResults.overall.per_sf)}/sf` : '-')
                          : (customResults.overall.per_item != null ? formatCurrency(customResults.overall.per_item) : '-')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No Results Yet */}
        {!customResults && !customWorking && (
          <div style={{ 
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#F9FAFB',
            borderRadius: '6px',
            color: '#6B7280'
          }}>
            <div style={{ fontSize: '14px' }}>
              Select a field and run analysis to see attribute value impacts
            </div>
          </div>
        )}
      </div>
    );
  };
  // ============ ADDITIONAL CARDS ANALYSIS ============
  const runAdditionalCardsAnalysis = () => {
    console.log('🔄 Running Additional Cards Analysis (using PreVal logic)...');
    console.log('Vendor Type:', vendorType);
    console.log('Total Properties:', properties?.length);

    if (!properties || properties.length === 0) {
      console.log('❌ No property records available');
      setAdditionalResults(null);
      return;
    }

    try {
      // Pre-build a lookup map: baseKey -> list of additional card properties
      // This replaces O(n²) nested loops with O(n) map construction + O(1) lookups
      const isAdditionalCard = (p) => {
        const card = (p.property_addl_card || p.additional_card || '').toString().trim();
        if (vendorType === 'Microsystems') {
          const cardUpper = card.toUpperCase();
          return cardUpper && cardUpper !== 'M' && cardUpper !== 'MAIN' && /^[A-Z]$/.test(cardUpper);
        } else {
          const cardNum = parseInt(card);
          return !isNaN(cardNum) && cardNum > 1;
        }
      };

      const additionalCardsByBaseKey = new Map();
      const allAdditionalCards = [];
      properties.forEach(p => {
        if (isAdditionalCard(p)) {
          const baseKey = `${p.property_block || ''}-${p.property_lot || ''}-${p.property_qualifier || ''}`;
          if (!additionalCardsByBaseKey.has(baseKey)) additionalCardsByBaseKey.set(baseKey, []);
          additionalCardsByBaseKey.get(baseKey).push(p);
          allAdditionalCards.push(p);
        }
      });

      // Filter to MAIN CARDS ONLY with sales data
      const mainCardSales = properties.filter(p => {
        const card = (p.property_addl_card || p.additional_card || '').toString().trim();
        if (vendorType === 'Microsystems') {
          const cardUpper = card.toUpperCase();
          if (cardUpper !== 'M' && cardUpper !== 'MAIN' && cardUpper !== '') return false;
        } else {
          const cardNum = parseInt(card);
          if (!(cardNum === 1 || card === '' || isNaN(cardNum))) return false;
        }
        if (!p.values_norm_time || p.values_norm_time <= 0) return false;
        if (!p.new_vcs && !p.property_vcs) return false;
        return true;
      });

      console.log(`Found ${mainCardSales.length} main card sales to analyze`);

      // For each main card, detect if it has additional cards via O(1) map lookup
      const enhancedSales = mainCardSales.map(prop => {
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
        const addlCards = additionalCardsByBaseKey.get(baseKey) || [];
        return {
          ...prop,
          has_additional_cards: addlCards.length > 0,
          additional_card_count: addlCards.length
        };
      });

      const withCards = enhancedSales.filter(p => p.has_additional_cards);
      const withoutCards = enhancedSales.filter(p => !p.has_additional_cards);

      console.log(`📊 Sales breakdown:`, {
        with_additional_cards: withCards.length,
        without_additional_cards: withoutCards.length
      });

      // Use the pre-built list instead of filtering all properties again
      const additionalCardsList = allAdditionalCards;

      console.log(`Total additional card records: ${additionalCardsList.length}`);

      // Analyze by VCS
      const byVCS = {};

      // Process properties WITH additional cards
      withCards.forEach(prop => {
        const vcs = prop.new_vcs || prop.property_vcs;
        if (!vcs) return;

        if (!byVCS[vcs]) {
          byVCS[vcs] = {
            with_cards: [],
            without_cards: []
          };
        }

        byVCS[vcs].with_cards.push({
          norm_time: prop.values_norm_time,
          sfla: prop.asset_sfla, // Already includes additional cards
          year_built: prop.asset_year_built
        });
      });

      // Process properties WITHOUT additional cards
      withoutCards.forEach(prop => {
        const vcs = prop.new_vcs || prop.property_vcs;
        if (!vcs) return;

        if (!byVCS[vcs]) {
          byVCS[vcs] = {
            with_cards: [],
            without_cards: []
          };
        }

        byVCS[vcs].without_cards.push({
          norm_time: prop.values_norm_time,
          sfla: prop.asset_sfla,
          year_built: prop.asset_year_built
        });
      });

      // Identify package pairs using package sale identification logic
      const packagePairs = [];

      // Build location groups using a single pass (reuse baseKey logic)
      const locationGroups = new Map();
      properties.forEach(prop => {
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
        if (!locationGroups.has(baseKey)) locationGroups.set(baseKey, []);
        locationGroups.get(baseKey).push(prop);
      });

      // Pre-build a VCS -> main-card-only-sales lookup for baseline comparisons
      const baselineSalesByVCS = new Map();
      properties.forEach(p => {
        const card = (p.property_addl_card || p.additional_card || '').toString().trim();
        let isMainOnly = false;
        if (vendorType === 'BRT' || vendorType === 'brt') {
          const cardNum = parseInt(card);
          isMainOnly = isNaN(cardNum) || cardNum <= 1;
        } else {
          const cardUpper = card.toString().trim().toUpperCase();
          isMainOnly = !cardUpper || cardUpper === 'M' || cardUpper === 'MAIN';
        }
        if (isMainOnly && p.values_norm_time && p.values_norm_time > 0) {
          const vcs = p.new_vcs || p.property_vcs;
          if (vcs) {
            if (!baselineSalesByVCS.has(vcs)) baselineSalesByVCS.set(vcs, []);
            baselineSalesByVCS.get(vcs).push({
              sfla: parseInt(p.asset_sfla) || 0,
              year_built: parseInt(p.asset_year_built) || null,
              norm_time: p.values_norm_time
            });
          }
        }
      });

      // Identify properties with additional cards and create pairs
      locationGroups.forEach((locationProps, locationKey) => {
        if (locationProps.length <= 1) return; // Skip single card properties

        const vcs = locationProps[0].new_vcs || locationProps[0].property_vcs;
        if (!vcs) return;

        // Use the pre-built map to check if this location has additional cards (O(1))
        const hasAdditionalCards = additionalCardsByBaseKey.has(locationKey);

        if (hasAdditionalCards) {

          // Calculate package metrics
          const totalSFLA = locationProps.reduce((sum, p) => sum + (parseInt(p.asset_sfla) || 0), 0);
          const validYears = locationProps.filter(p => {
            const year = parseInt(p.asset_year_built);
            return year && year > 1800 && year <= new Date().getFullYear();
          });
          const avgYearBuilt = validYears.length > 0 ?
            Math.round(validYears.reduce((sum, p) => sum + parseInt(p.asset_year_built), 0) / validYears.length) : null;

          // Get sales price if available (prioritize the latest or highest)
          const propsWithSales = locationProps.filter(p => p.values_norm_time && p.values_norm_time > 0);
          const packagePrice = propsWithSales.length > 0 ?
            Math.max(...propsWithSales.map(p => p.values_norm_time)) : null;

          // Use pre-built VCS baseline lookup instead of filtering all properties
          const baselineComparisons = baselineSalesByVCS.get(vcs) || [];

          packagePairs.push({
            locationKey,
            withCardsPackage: {
              address: locationProps[0].property_location,
              block: locationProps[0].property_block,
              lot: locationProps[0].property_lot,
              vcs: vcs,
              total_sfla: totalSFLA,
              avg_year_built: avgYearBuilt,
              norm_time: packagePrice, // May be null if no sales
              has_sales: packagePrice !== null
            },
            baselineComparisons: baselineComparisons
          });
        }
      });

      // Calculate statistics for each VCS (keep existing for summary)
      const results = {
        byVCS: {},
        packagePairs: packagePairs,
        summary: {
          vendorType,
          totalPropertiesAnalyzed: properties.length,
          propertiesWithCards: withCards.length,
          propertiesWithoutCards: withoutCards.length,
          packagePairsFound: packagePairs.length
        },
        additionalCardsList: additionalCardsList.sort((a, b) => {
          // Sort by VCS, then by address
          const aVcs = a.new_vcs || a.property_vcs || '';
          const bVcs = b.new_vcs || b.property_vcs || '';
          if (aVcs !== bVcs) {
            return aVcs.localeCompare(bVcs);
          }
          return (a.property_location || '').localeCompare(b.property_location || '');
        }),
        generated_at: new Date().toISOString()
      };

      // Calculate averages and impacts for each VCS (combine both impact data and all counts)
      const allVCSKeys = Object.keys(byVCS);

      allVCSKeys.forEach(vcs => {
        const data = byVCS[vcs] || { with_cards: [], without_cards: [] };

        // Debug log for first few VCS
        if (Object.keys(byVCS).indexOf(vcs) < 3) {
          console.log(`[Analysis] VCS ${vcs}:`, {
            with_cards_count: data.with_cards.length,
            with_cards_samples: data.with_cards.slice(0, 3),
            without_cards_count: data.without_cards.length,
            without_cards_samples: data.without_cards.slice(0, 3)
          });
        }

        // Calculate WITH cards metrics
        const withNormTimes = data.with_cards.map(d => d.norm_time);
        const withAvgNormTime = withNormTimes.length > 0
          ? withNormTimes.reduce((sum, val) => sum + val, 0) / withNormTimes.length
          : null;

        // Calculate AVERAGE SFLA for properties with cards (SFLA already includes additional cards)
        const withSFLAs = data.with_cards.filter(d => d.sfla > 0).map(d => d.sfla);
        const withAvgSFLA = withSFLAs.length > 0
          ? withSFLAs.reduce((sum, val) => sum + val, 0) / withSFLAs.length
          : null;

        const withValidYears = data.with_cards.filter(d => d.year_built);
        const withAvgYearBuilt = withValidYears.length > 0
          ? Math.round(withValidYears.reduce((sum, d) => sum + d.year_built, 0) / withValidYears.length)
          : null;

        // Calculate Year Built and AVERAGE SFLA for ALL properties with additional cards (not just those with sales)
        // Use the same averages from sales data (SFLA already includes combined cards from PreVal)
        const allWithAvgSFLA = withAvgSFLA;
        const allWithAvgYearBuilt = withAvgYearBuilt;

        // Calculate WITHOUT cards metrics
        const withoutNormTimes = data.without_cards.map(d => d.norm_time);
        const withoutAvgNormTime = withoutNormTimes.length > 0
          ? withoutNormTimes.reduce((sum, val) => sum + val, 0) / withoutNormTimes.length
          : null;

        const withoutSFLAs = data.without_cards.filter(d => d.sfla > 0).map(d => d.sfla);
        const withoutAvgSFLA = withoutSFLAs.length > 0
          ? withoutSFLAs.reduce((sum, val) => sum + val, 0) / withoutSFLAs.length
          : null;

        const withoutValidYears = data.without_cards.filter(d => d.year_built);
        const withoutAvgYearBuilt = withoutValidYears.length > 0
          ? Math.round(withoutValidYears.reduce((sum, d) => sum + d.year_built, 0) / withoutValidYears.length)
          : null;

        // Use the same averages from sales data
        const allWithoutAvgSFLA = withoutAvgSFLA;
        const allWithoutAvgYearBuilt = withoutAvgYearBuilt;

        // Calculate adjustments - Using "Without Cards" as baseline
        let flatAdj = null;
        let pctAdj = null;
        let jimAdjusted = null;

        if (withAvgNormTime !== null && withoutAvgNormTime !== null && withAvgNormTime > 0) {
          // Jim's size normalization formula: Adjust "with cards" value to "without cards" size (baseline)
          if (allWithAvgSFLA && allWithoutAvgSFLA && allWithAvgSFLA > 0 && allWithoutAvgSFLA > 0) {
            jimAdjusted = sizeNormalize(withAvgNormTime, allWithAvgSFLA, allWithoutAvgSFLA);
          } else {
            jimAdjusted = withAvgNormTime;
          }

          flatAdj = Math.round(jimAdjusted - withoutAvgNormTime);
          pctAdj = withoutAvgNormTime > 0 ? ((jimAdjusted - withoutAvgNormTime) / withoutAvgNormTime) * 100 : 0;
        }

        results.byVCS[vcs] = {
          with: {
            n: data.with_cards.length,
            avg_sfla: allWithAvgSFLA ? Math.round(allWithAvgSFLA) : null, // Changed from total_sfla to avg_sfla
            avg_year_built: allWithAvgYearBuilt ? Math.round(allWithAvgYearBuilt) : null,
            avg_norm_time: withAvgNormTime ? Math.round(withAvgNormTime) : null
          },
          without: {
            n: data.without_cards.length,
            avg_sfla: allWithoutAvgSFLA ? Math.round(allWithoutAvgSFLA) : null,
            avg_year_built: allWithoutAvgYearBuilt ? Math.round(allWithoutAvgYearBuilt) : null,
            avg_norm_time: withoutAvgNormTime ? Math.round(withoutAvgNormTime) : null
          },
          adjusted: jimAdjusted,
          flat_adj: flatAdj,
          pct_adj: pctAdj
        };

      });

      console.log('📊 Analysis Results:', {
        totalAdditionalCards: additionalCardsList.length,
        vcsCount: Object.keys(results.byVCS).length,
        propertiesWithCards: results.summary.propertiesWithCards,
        propertiesWithoutCards: results.summary.propertiesWithoutCards,
        sampleVCSData: Object.entries(results.byVCS).slice(0, 2)
      });

      // Debug: Check sample property data
      console.log('���� Sample Properties (first 5):', properties.slice(0, 5).map(p => ({
        location: p.property_location,
        sfla: p.asset_sfla,
        yearBuilt: p.asset_year_built,
        vcs: p.new_vcs || p.property_vcs,
        card: p.property_addl_card || p.additional_card
      })));


      // Log analysis summary
      console.log('��� Additional Card Analysis Summary:', {
        vendorType,
        totalProperties: results.summary.totalPropertiesAnalyzed,
        withCards: results.summary.propertiesWithCards,
        withoutCards: results.summary.propertiesWithoutCards,
        cardDefinition: vendorType === 'BRT' ? 'Numeric cards other than 1' : 'Alphabetical cards (A-Z), M=Main'
      });

      console.log('✅ Setting additional card analysis results:', results);
      setAdditionalResults(results);
      // VCS sections start collapsed by default
      setExpandedAdditionalVCS(new Set());


      console.log('����� Additional card analysis completed successfully');
      
    } catch (error) {
      console.error('❌ Error running additional cards analysis:', error);
      setAdditionalResults(null);
    }
  };

  // Save additional results to database
  const saveAdditionalResultsToDB = async (results) => {
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert({
          job_id: jobData.id,
          additional_cards_rollup: results,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error saving additional card results:', error);
    }
  };

  // Export function for Excel
  const exportAdditionalCardsExcel = () => {
    if (!additionalResults || !additionalResults.byVCS) {
      alert('No additional cards data to export');
      return;
    }

    console.log('[Additional Cards Export] Starting export with data:', {
      vcsCount: Object.keys(additionalResults.byVCS).length,
      sampleVCS: Object.entries(additionalResults.byVCS).slice(0, 2).map(([vcs, data]) => ({
        vcs,
        withCount: data.with.n,
        withSFLA: data.with.avg_sfla,
        withPrice: data.with.avg_norm_time,
        withoutCount: data.without.n,
        withoutSFLA: data.without.avg_sfla,
        withoutPrice: data.without.avg_norm_time
      }))
    });

    const rows = [];

    // Title row
    const titleRow = [];
    titleRow[0] = `Additional Cards Analysis - ${jobData?.job_name || 'Job'}`;
    rows.push(titleRow);

    // Blank row
    rows.push([]);

    // Column headers
    const headers = [
      'VCS',
      'With Cards Count',
      'With Cards Avg SFLA',
      'With Cards Avg Year',
      'With Cards Avg Price',
      'Without Cards Count',
      'Without Cards Avg SFLA',
      'Without Cards Avg Year',
      'Without Cards Avg Price',
      'Adjusted Price',
      'Flat Adj',
      '% Adj'
    ];
    rows.push(headers);

    // COL indexes (0-based)
    const COL = {
      VCS: 0,
      WITH_COUNT: 1,
      WITH_SFLA: 2,
      WITH_YEAR: 3,
      WITH_PRICE: 4,
      WITHOUT_COUNT: 5,
      WITHOUT_SFLA: 6,
      WITHOUT_YEAR: 7,
      WITHOUT_PRICE: 8,
      ADJUSTED: 9,
      FLAT_ADJ: 10,
      PCT_ADJ: 11
    };

    // Add data rows with formulas (only VCS with complete data on both sides)
    const vcsKeys = Object.keys(additionalResults.byVCS)
      .filter(vcs => {
        const data = additionalResults.byVCS[vcs];
        // Only include VCS that have valid data on BOTH sides (matching UI logic)
        const withSFLA = data.with.avg_sfla || 0;
        const withPrice = data.with.avg_norm_time || 0;
        const withoutSFLA = data.without.avg_sfla || 0;
        const withoutPrice = data.without.avg_norm_time || 0;
        return (withSFLA > 0 && withPrice > 0 && withoutSFLA > 0 && withoutPrice > 0);
      })
      .sort();

    vcsKeys.forEach(vcs => {
      const data = additionalResults.byVCS[vcs];
      const rowNum = rows.length + 1; // Excel row number (1-based)

      const row = [];
      row[COL.VCS] = vcs;
      row[COL.WITH_COUNT] = data.with.n || 0;
      row[COL.WITH_SFLA] = data.with.avg_sfla || 0;
      row[COL.WITH_YEAR] = data.with.avg_year_built || '';
      row[COL.WITH_PRICE] = data.with.avg_norm_time || 0;
      row[COL.WITHOUT_COUNT] = data.without.n || 0;
      row[COL.WITHOUT_SFLA] = data.without.avg_sfla || 0;
      row[COL.WITHOUT_YEAR] = data.without.avg_year_built || '';
      row[COL.WITHOUT_PRICE] = data.without.avg_norm_time || 0;

      // Jim formula: Adjust "With Cards" price to "Without Cards" SFLA
      // Formula: ((targetSFLA - saleSFLA) * ((salePrice / saleSFLA) * 0.50)) + salePrice
      // With Cards = sale, Without Cards = target (baseline)
      row[COL.ADJUSTED] = {
        f: `IF(OR(C${rowNum}=0,E${rowNum}=0,G${rowNum}=0),E${rowNum},((G${rowNum}-C${rowNum})*((E${rowNum}/C${rowNum})*0.50))+E${rowNum})`,
        t: 'n'
      };

      // Flat Adj = Adjusted - Without Cards Price
      row[COL.FLAT_ADJ] = {
        f: `J${rowNum}-I${rowNum}`,
        t: 'n'
      };

      // % Adj = (Adjusted - Without Cards Price) / Without Cards Price
      row[COL.PCT_ADJ] = {
        f: `IF(I${rowNum}=0,0,(J${rowNum}-I${rowNum})/I${rowNum})`,
        t: 'n',
        z: '0.0%'
      };

      rows.push(row);
    });

    // Summary section
    rows.push([]); // Blank row
    rows.push([]); // Blank row

    const summaryHeaderRow = [];
    summaryHeaderRow[0] = '';
    summaryHeaderRow[1] = 'Overall Summary';
    rows.push(summaryHeaderRow);
    rows.push([]); // Blank row

    const summaryHeaders = ['Metric', 'Value'];
    rows.push(summaryHeaders);

    // Calculate summary stats
    const firstDataRow = 4; // Row 4 in Excel (after title, blank, header rows)
    const lastDataRow = vcsKeys.length + 3; // Last VCS row

    // VCS Count
    const vcsCountRow = [];
    vcsCountRow[0] = 'VCS Analyzed';
    vcsCountRow[1] = vcsKeys.length;
    rows.push(vcsCountRow);

    // Total properties with cards
    const totalWithRow = [];
    totalWithRow[0] = 'Total Sales With Additional Cards';
    totalWithRow[1] = {
      f: `SUM(B${firstDataRow}:B${lastDataRow})`,
      t: 'n'
    };
    rows.push(totalWithRow);

    // Total properties without cards
    const totalWithoutRow = [];
    totalWithoutRow[0] = 'Total Sales Without Additional Cards';
    totalWithoutRow[1] = {
      f: `SUM(F${firstDataRow}:F${lastDataRow})`,
      t: 'n'
    };
    rows.push(totalWithoutRow);

    // Average Dollar Impact
    const avgDollarRow = [];
    avgDollarRow[0] = 'Average Dollar Impact';
    avgDollarRow[1] = {
      f: `AVERAGE(K${firstDataRow}:K${lastDataRow})`,
      t: 'n',
      z: '$#,##0'
    };
    rows.push(avgDollarRow);

    // Average % Adjustment across all VCS
    const avgPctRow = [];
    avgPctRow[0] = 'Average % Impact';
    avgPctRow[1] = {
      f: `AVERAGE(L${firstDataRow}:L${lastDataRow})`,
      t: 'n',
      z: '0.0%'
    };
    rows.push(avgPctRow);

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Base styles
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply styles
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Find summary section start
    let summaryStartRow = -1;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cellB = XLSX.utils.encode_cell({ r: R, c: 1 });
      if (ws[cellB] && ws[cellB].v === 'Overall Summary') {
        summaryStartRow = R;
        break;
      }
    }

    const titleStyle = {
      font: { name: 'Leelawadee', sz: 12, bold: true },
      alignment: { horizontal: 'left', vertical: 'center' }
    };

    const descStyle = {
      font: { name: 'Leelawadee', sz: 10, italic: true },
      alignment: { horizontal: 'left', vertical: 'center' }
    };

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        const isSummarySection = summaryStartRow !== -1 && R >= summaryStartRow;

        // Title row (row 0)
        if (R === 0) {
          ws[cellAddress].s = titleStyle;
        }
        // Header rows
        else if (R === 2 || ws[cellAddress].v === 'VCS' || ws[cellAddress].v === 'Overall Summary' || ws[cellAddress].v === 'Metric') {
          ws[cellAddress].s = headerStyle;
        }
        // Data rows
        else {
          const style = { ...baseStyle };

          if (isSummarySection) {
            // Summary section formatting
            if (C === 1 && ws[cellAddress].z === '0.0%') {
              style.numFmt = '0.0%';
            } else if (C === 1 && ws[cellAddress].z === '$#,##0') {
              style.numFmt = '$#,##0';
            } else if (C === 1) {
              style.numFmt = '#,##0';
            }
          } else if (R >= 3) { // Data rows start at row 3 (0-indexed: row 3 = Excel row 4)
            // Main data columns
            if (C === COL.WITH_COUNT || C === COL.WITHOUT_COUNT) {
              style.numFmt = '#,##0'; // Count columns
            } else if (C === COL.WITH_SFLA || C === COL.WITHOUT_SFLA) {
              style.numFmt = '#,##0'; // SFLA columns
            } else if (C === COL.WITH_YEAR || C === COL.WITHOUT_YEAR) {
              style.numFmt = '0'; // Year columns
            } else if (C === COL.WITH_PRICE || C === COL.WITHOUT_PRICE || C === COL.ADJUSTED || C === COL.FLAT_ADJ) {
              style.numFmt = '$#,##0'; // Currency columns
            } else if (C === COL.PCT_ADJ) {
              style.numFmt = '0.0%'; // Percentage column
            }
          }

          ws[cellAddress].s = style;
        }
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // VCS
      { wch: 15 },  // With Cards Count
      { wch: 18 },  // With Cards Avg SFLA
      { wch: 18 },  // With Cards Avg Year
      { wch: 20 },  // With Cards Avg Price
      { wch: 18 },  // Without Cards Count
      { wch: 20 },  // Without Cards Avg SFLA
      { wch: 20 },  // Without Cards Avg Year
      { wch: 22 },  // Without Cards Avg Price
      { wch: 15 },  // Adjusted Price
      { wch: 12 },  // Flat Adj
      { wch: 10 }   // % Adj
    ];

    // Create workbook and add summary worksheet
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Summary by VCS');

    // Create detail sheet with all properties
    if (additionalResults.additionalCardsList && additionalResults.additionalCardsList.length > 0) {
      const detailRows = [];

      // Detail headers
      const detailHeaders = [
        'Address',
        'Card',
        'VCS',
        'Class',
        'Type/Use',
        'Sales Price',
        'SFLA',
        'Year Built',
        'Norm Time'
      ];
      detailRows.push(detailHeaders);

      // Detail data
      additionalResults.additionalCardsList.forEach(prop => {
        const detailRow = [];
        detailRow[0] = prop.property_location || '';
        detailRow[1] = prop.property_addl_card || prop.additional_card || '';
        detailRow[2] = prop.new_vcs || prop.property_vcs || '';
        detailRow[3] = prop.property_m4_class || prop.property_cama_class || '';
        detailRow[4] = prop.asset_type_use || '';
        detailRow[5] = prop.sales_price || '';
        detailRow[6] = prop.asset_sfla || '';
        detailRow[7] = prop.asset_year_built || '';
        detailRow[8] = prop.values_norm_time || '';
        detailRows.push(detailRow);
      });

      // Create detail worksheet
      const detailWs = XLSX.utils.aoa_to_sheet(detailRows);

      // Apply styles to detail sheet
      const detailRange = XLSX.utils.decode_range(detailWs['!ref']);
      for (let R = detailRange.s.r; R <= detailRange.e.r; R++) {
        for (let C = detailRange.s.c; C <= detailRange.e.c; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!detailWs[cellAddress]) continue;

          if (R === 0) {
            // Header row
            detailWs[cellAddress].s = headerStyle;
          } else {
            // Data rows
            const style = { ...baseStyle };
            if (C === 5 || C === 8) {
              style.numFmt = '$#,##0'; // Sales Price and Norm Time
            } else if (C === 6) {
              style.numFmt = '#,##0'; // SFLA
            } else if (C === 7) {
              style.numFmt = '0'; // Year Built
            }
            detailWs[cellAddress].s = style;
          }
        }
      }

      // Set column widths for detail sheet
      detailWs['!cols'] = [
        { wch: 40 },  // Address
        { wch: 10 },  // Card
        { wch: 10 },  // VCS
        { wch: 12 },  // Class
        { wch: 15 },  // Type/Use
        { wch: 14 },  // Sales Price
        { wch: 10 },  // SFLA
        { wch: 12 },  // Year Built
        { wch: 14 }   // Norm Time
      ];

      XLSX.utils.book_append_sheet(wb, detailWs, 'Property Detail');
    }

    // Export
    const fileName = `Additional_Cards_${jobData?.job_name || 'Analysis'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    console.log('✅ Additional Cards Excel export completed');
  };

  // Export function for All Additional Cards Detail
  const exportAllAdditionalCardsDetail = () => {
    if (!additionalResults || !additionalResults.additionalCardsList || additionalResults.additionalCardsList.length === 0) {
      alert('No additional cards detail to export');
      return;
    }

    const rows = [];

    // Column headers (first row)
    const headers = [
      'Block',
      'Lot',
      'Qualifier',
      'Card',
      'Address',
      'VCS',
      'Class',
      'Type/Use',
      'Building Class',
      'SFLA',
      'Year Built',
      'Sales Price'
    ];
    rows.push(headers);

    // Add sorted data rows
    const sortedCards = getSortedAdditionalCards();
    sortedCards.forEach(prop => {
      const row = [];
      row[0] = prop.property_block || '';
      row[1] = prop.property_lot || '';
      row[2] = prop.property_qualifier || '';
      row[3] = prop.property_addl_card || prop.additional_card || '';
      row[4] = prop.property_location || '';
      row[5] = prop.new_vcs || prop.property_vcs || '';
      row[6] = prop.property_m4_class || prop.property_cama_class || '';
      row[7] = prop.asset_type_use || '';
      row[8] = prop.asset_building_class || '';
      row[9] = prop.asset_sfla || '';
      row[10] = prop.asset_year_built || '';
      row[11] = prop.sales_price || '';
      rows.push(row);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Base styles
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const redFlagStyle = {
      font: { name: 'Leelawadee', sz: 10, color: { rgb: 'DC2626' }, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply styles
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // Header row (row 0)
        if (R === 0) {
          ws[cellAddress].s = headerStyle;
        }
        // Data rows
        else if (R >= 1) {
          const dataRowIndex = R - 1; // Index into sortedCards
          const prop = sortedCards[dataRowIndex];
          const style = { ...baseStyle };

          // Check for missing SFLA (column 9) or Year Built (column 10)
          const isMissingSFLA = C === 9 && (!prop.asset_sfla);
          const isMissingYear = C === 10 && (!prop.asset_year_built);

          if (isMissingSFLA || isMissingYear) {
            // Apply red flag style for missing data
            ws[cellAddress].s = redFlagStyle;
          } else {
            // Apply formatting based on column type
            if (C === 9) {
              style.numFmt = '#,##0'; // SFLA - centered
            } else if (C === 10) {
              style.numFmt = '0'; // Year Built - centered
            } else if (C === 11) {
              style.numFmt = '$#,##0'; // Sales Price - centered
            }
            // Address (column 4) uses default center alignment
            ws[cellAddress].s = style;
          }
        }
      }
    }

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // Block
      { wch: 10 },  // Lot
      { wch: 10 },  // Qualifier
      { wch: 8 },   // Card
      { wch: 40 },  // Address
      { wch: 10 },  // VCS
      { wch: 10 },  // Class
      { wch: 15 },  // Type/Use
      { wch: 15 },  // Building Class
      { wch: 12 },  // SFLA
      { wch: 12 },  // Year Built
      { wch: 14 }   // Sales Price
    ];

    // Create workbook and export
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'All Additional Cards Detail');

    const fileName = `All_Additional_Cards_Detail_${jobData?.job_name || 'Analysis'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    console.log('✅ All Additional Cards Detail export completed');
  };

  // ============ ADDITIONAL CARDS SORTING ============
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortedAdditionalCards = () => {
    if (!additionalResults?.additionalCardsList) return [];

    return [...additionalResults.additionalCardsList].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Special handling for VCS field to use new_vcs || property_vcs fallback
      if (sortField === 'new_vcs') {
        aVal = a.new_vcs || a.property_vcs;
        bVal = b.new_vcs || b.property_vcs;
      }

      // Handle null/undefined values
      if (aVal === null || aVal === undefined) aVal = '';
      if (bVal === null || bVal === undefined) bVal = '';

      // Convert to string for comparison, except for numeric fields
      if (['property_block', 'property_lot', 'sales_price', 'asset_sfla', 'asset_year_built', 'values_norm_time'].includes(sortField)) {
        aVal = parseFloat(aVal) || 0;
        bVal = parseFloat(bVal) || 0;
      } else {
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const renderSortIcon = (field) => {
    if (sortField !== field) {
      return (
        <span style={{ marginLeft: '4px', color: '#9CA3AF', fontSize: '10px' }}>↕</span>
      );
    }
    return (
      <span style={{ marginLeft: '4px', color: '#374151', fontSize: '10px' }}>
        {sortDirection === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  // ============ RENDER PACKAGE PAIRS USING PACKAGE SALE IDENTIFICATION ============
  const renderPackagePairs = (additionalResults) => {
    if (!additionalResults?.packagePairs) {
      return (
        <tr>
          <td colSpan="11" style={{ padding: '20px', textAlign: 'center', color: '#6B7280', fontStyle: 'italic' }}>
            No package pairs identified for analysis
          </td>
        </tr>
      );
    }

    return additionalResults.packagePairs.map((pair, idx) => {
      const withCardsPackage = pair.withCardsPackage;
      const baselineComparisons = pair.baselineComparisons || [];

      // Calculate baseline metrics from comparable sales without additional cards in same VCS
      const baselineCount = baselineComparisons.length;
      const baselineAvgSFLA = baselineCount > 0 ?
        Math.round(baselineComparisons.reduce((sum, p) => sum + (p.sfla || 0), 0) / baselineCount) : null;
      const baselineAvgYear = baselineCount > 0 ?
        Math.round(baselineComparisons.filter(p => p.year_built).reduce((sum, p) => sum + p.year_built, 0) /
        baselineComparisons.filter(p => p.year_built).length) : null;
      const baselineAvgPrice = baselineCount > 0 ?
        baselineComparisons.reduce((sum, p) => sum + p.norm_time, 0) / baselineCount : null;

      // Apply Jim's size normalization formula - only if both with and without have valid prices
      const packageSFLA = withCardsPackage.total_sfla;
      const packagePrice = withCardsPackage.norm_time;
      let adjustedBaseline = null;
      let flatImpact = null;
      let pctImpact = null;

      // Only calculate if both sides have valid prices
      if (packagePrice && baselineAvgPrice && packageSFLA && baselineAvgSFLA) {
        // Jim's formula: adjust baseline price to package sum SFLA
        adjustedBaseline = sizeNormalize(baselineAvgPrice, baselineAvgSFLA, packageSFLA);

        // Calculate impact
        flatImpact = packagePrice - adjustedBaseline;
        pctImpact = (flatImpact / adjustedBaseline) * 100;
      }

      return (
        <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
          <td style={{ padding: '8px 10px', fontSize: '12px' }}>
            {withCardsPackage.address || `${withCardsPackage.block}-${withCardsPackage.lot}`}
          </td>
          <td style={{ padding: '8px 10px', fontSize: '12px', fontWeight: '500' }}>
            {withCardsPackage.vcs}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {withCardsPackage.total_sfla ? withCardsPackage.total_sfla.toLocaleString() : '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {withCardsPackage.avg_year_built || '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px', fontWeight: '500' }}>
            {withCardsPackage.norm_time ? formatCurrency(withCardsPackage.norm_time) : '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {baselineAvgSFLA ? baselineAvgSFLA.toLocaleString() : '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {baselineAvgYear || '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {baselineAvgPrice ? formatCurrency(baselineAvgPrice) : '-'}
          </td>
          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
            {adjustedBaseline ? formatCurrency(adjustedBaseline) : '-'}
          </td>
          <td style={{
            padding: '8px 10px',
            textAlign: 'right',
            fontSize: '12px',
            color: (flatImpact || 0) > 0 ? '#059669' : (flatImpact || 0) < 0 ? '#B45309' : '#6B7280'
          }}>
            {flatImpact ? formatCurrency(flatImpact) : '-'}
          </td>
          <td style={{
            padding: '8px 10px',
            textAlign: 'right',
            fontSize: '12px',
            color: (pctImpact || 0) > 0 ? '#059669' : (pctImpact || 0) < 0 ? '#B45309' : '#6B7280'
          }}>
            {pctImpact ? `${pctImpact.toFixed(1)}%` : '-'}
          </td>
        </tr>
      );
    });
  };

  // ============ RENDER VCS ANALYSIS TABLE WITH EXPANDABLE SECTIONS ============
  const renderVCSAnalysisTable = (vcsData) => {
    // Filter to only show VCS that have properties with additional cards
    const vcsKeys = Object.keys(vcsData)
      .filter(vcs => (vcsData[vcs]?.with?.n || 0) > 0)
      .sort();

    if (vcsKeys.length === 0) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', color: '#6B7280' }}>
          No VCS with additional cards available for detailed analysis
        </div>
      );
    }

    return (
      <div style={{ marginBottom: '20px' }}>
        {vcsKeys.map(vcs => {
          const data = vcsData[vcs];
          const isExpanded = expandedAdditionalVCS.has(vcs);

          // Toggle VCS expansion function
          const toggleVCS = () => {
            const newExpanded = new Set(expandedAdditionalVCS);
            if (newExpanded.has(vcs)) {
              newExpanded.delete(vcs);
            } else {
              newExpanded.add(vcs);
            }
            setExpandedAdditionalVCS(newExpanded);
          };

          // Calculate adjusted price and impact using Jim formula
          const withAvgSFLA = data.with.avg_sfla || 0;
          const withAvgPrice = data.with.avg_norm_time || 0;
          const withoutAvgSFLA = data.without.avg_sfla || 0;
          const withoutAvgPrice = data.without.avg_norm_time || 0;

          // Jim formula: normalize "with cards" price to "without cards" SFLA
          const adjustedPrice = withAvgSFLA > 0 && withAvgPrice > 0 && withoutAvgSFLA > 0 ?
            sizeNormalize(withAvgPrice, withAvgSFLA, withoutAvgSFLA) : null;

          const flatAdj = adjustedPrice && withoutAvgPrice > 0 ? adjustedPrice - withoutAvgPrice : null;
          const pctAdj = adjustedPrice && withoutAvgPrice > 0 ? ((adjustedPrice - withoutAvgPrice) / withoutAvgPrice) * 100 : null;

          // Log for debugging first few VCS
          if (Object.keys(vcsData).indexOf(vcs) < 3) {
            console.log(`[Additional Cards UI] VCS ${vcs}:`, {
              withCount: data.with.n,
              withSFLA: withAvgSFLA,
              withPrice: withAvgPrice,
              withoutCount: data.without.n,
              withoutSFLA: withoutAvgSFLA,
              withoutPrice: withoutAvgPrice,
              adjusted: adjustedPrice,
              flatAdj,
              pctAdj
            });
          }

          return (
            <div key={vcs} style={{ marginBottom: '15px', border: '1px solid #E5E7EB', borderRadius: '6px' }}>
              {/* VCS Header Row */}
              <div
                onClick={toggleVCS}
                style={{
                  padding: '12px 15px',
                  backgroundColor: '#F9FAFB',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: isExpanded ? '1px solid #E5E7EB' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>{vcs}</span>
                  <span style={{ fontSize: '12px', color: '#6B7280' }}>
                    ({data.with.n} with cards, {data.without.n} without cards)
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                  <span style={{ fontSize: '12px', color: flatAdj !== null && flatAdj > 0 ? '#059669' : flatAdj !== null && flatAdj < 0 ? '#DC2626' : '#6B7280' }}>
                    Impact: {flatAdj !== null ? formatCurrency(flatAdj) : 'No comparison'}
                    {pctAdj !== null && ` (${pctAdj.toFixed(1)}%)`}
                  </span>
                  {!isExpanded && (
                    <span style={{ fontSize: '12px', color: '#6B7280' }}>
                      Click to expand
                    </span>
                  )}
                </div>
              </div>

              {/* Property Details (when expanded) */}
              {isExpanded && (
                <div style={{ padding: '15px' }}>
                  {/* VCS Summary Table - moved here from top level */}
                  <div style={{
                    marginBottom: '20px',
                    border: '1px solid #E5E7EB',
                    borderRadius: '6px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      padding: '10px 12px',
                      backgroundColor: '#F9FAFB',
                      borderBottom: '1px solid #E5E7EB'
                    }}>
                      <h4 style={{ fontSize: '13px', fontWeight: '600', margin: '0' }}>
                        VCS {vcs} - Summary Comparison
                      </h4>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F3F4F6' }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '11px', fontWeight: '600' }}>Type</th>
                          <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: '11px', fontWeight: '600' }}>Count</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Avg SFLA</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Avg Year</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Avg Price</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Adjusted Price</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Impact $</th>
                          <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '11px', fontWeight: '600' }}>Impact %</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ backgroundColor: '#F8FAFC' }}>
                          <td style={{ padding: '8px 10px', fontSize: '12px', fontWeight: '500', color: '#1E293B' }}>With Cards</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: '12px' }}>{data.with.n}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {withAvgSFLA ? Math.round(withAvgSFLA).toLocaleString() : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {data.with.avg_year_built || '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {withAvgPrice ? formatCurrency(withAvgPrice) : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px', fontWeight: '500' }}>
                            {adjustedPrice ? formatCurrency(adjustedPrice) : '-'}
                          </td>
                          <td style={{
                            padding: '8px 10px',
                            textAlign: 'right',
                            fontSize: '12px',
                            fontWeight: '500',
                            color: flatAdj !== null && flatAdj > 0 ? '#059669' : flatAdj !== null && flatAdj < 0 ? '#DC2626' : '#6B7280'
                          }}>
                            {flatAdj !== null ? formatCurrency(flatAdj) : '-'}
                          </td>
                          <td style={{
                            padding: '8px 10px',
                            textAlign: 'right',
                            fontSize: '12px',
                            fontWeight: '500',
                            color: pctAdj !== null && pctAdj > 0 ? '#059669' : pctAdj !== null && pctAdj < 0 ? '#DC2626' : '#6B7280'
                          }}>
                            {pctAdj !== null ? `${pctAdj.toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                        <tr style={{ backgroundColor: '#F0F9FF' }}>
                          <td style={{ padding: '8px 10px', fontSize: '12px', fontWeight: '500', color: '#1E40AF' }}>Without Cards (Baseline)</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: '12px' }}>{data.without.n}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {withoutAvgSFLA ? Math.round(withoutAvgSFLA).toLocaleString() : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {data.without.avg_year_built || '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>
                            {withoutAvgPrice ? formatCurrency(withoutAvgPrice) : '-'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>Baseline</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>-</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: '12px' }}>-</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ============ RENDER ADDITIONAL CARDS ANALYSIS ============
  const renderAdditionalCardsAnalysis = () => {
    return (
      <div>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>
              Additional Cards Analysis
            </h3>
            {additionalResults && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    const allVCS = new Set(Object.keys(additionalResults.byVCS || {}));
                    setExpandedAdditionalVCS(allVCS);
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#3B82F6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Expand All
                </button>
                <button
                  onClick={() => setExpandedAdditionalVCS(new Set())}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#64748B',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Collapse All
                </button>
                <button
                  onClick={exportAdditionalCardsExcel}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#10B981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Export Excel
                </button>
              </div>
            )}
          </div>

          <div style={{
            fontSize: '13px',
            color: '#6B7280',
            marginBottom: '20px',
            padding: '12px',
            backgroundColor: '#F3F4F6',
            borderRadius: '6px'
          }}>
            <div style={{ marginBottom: '4px' }}>
              Analyzing properties with multiple cards vs single card properties
            </div>
            <div style={{ fontStyle: 'italic' }}>
              {vendorType === 'BRT' || vendorType === 'brt'
                ? 'Additional = Cards 2, 3, 4+ (Card 1 is Main)'
                : 'Additional = Cards A-Z (Card M is Main)'
              }
            </div>
          </div>
        </div>

        {/* Debug Sales Count */}
        {additionalResults && (
          <div style={{
            marginBottom: '20px',
            padding: '10px',
            backgroundColor: '#FEF3C7',
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            <strong>Debug Info:</strong> Package Pairs Found: {additionalResults.packagePairs?.length || 0} |
            Total Properties with Sales: {(() => {
              let totalSales = 0;
              Object.values(additionalResults.byVCS || {}).forEach(vcsData => {
                totalSales += (vcsData.with_cards || []).length;
                totalSales += (vcsData.without_cards || []).length;
              });
              return totalSales;
            })()} | Expected: 105 sales
          </div>
        )}

        {/* Summary Stats */}
        {additionalResults ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              <div style={{ padding: '15px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>Properties with Additional Cards</div>
                <div style={{ fontSize: '24px', fontWeight: '600', color: '#111827' }}>{additionalResults.summary?.propertiesWithCards || 0}</div>
              </div>
              <div style={{ padding: '15px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>Properties without Additional Cards</div>
                <div style={{ fontSize: '24px', fontWeight: '600', color: '#111827' }}>{additionalResults.summary?.propertiesWithoutCards || 0}</div>
              </div>
              <div style={{ padding: '15px', backgroundColor: '#F9FAFB', borderRadius: '6px', border: '1px solid #E5E7EB' }}>
                <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>Total Properties Analyzed</div>
                <div style={{ fontSize: '24px', fontWeight: '600', color: '#111827' }}>{additionalResults.summary?.totalPropertiesAnalyzed || 0}</div>
              </div>
            </div>

            {/* Impact Summary */}
            <div style={{
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#F8FAFC',
              borderRadius: '6px',
              border: '1px solid #E2E8F0'
            }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 10px 0', color: '#1E293B' }}>
                Overall Impact Summary
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', fontSize: '13px' }}>
                <div>
                  <span style={{ color: '#64748B', fontWeight: '500' }}>Average Dollar Impact: </span>
                  <span style={{ fontWeight: '600', color: '#059669' }}>
                    {(() => {
                      const impacts = [];
                      Object.values(additionalResults.byVCS || {}).forEach(data => {
                        const withSFLA = data.with.avg_sfla || 0;
                        const withPrice = data.with.avg_norm_time || 0;
                        const withoutSFLA = data.without.avg_sfla || 0;
                        const withoutPrice = data.without.avg_norm_time || 0;

                        if (withSFLA > 0 && withPrice > 0 && withoutSFLA > 0 && withoutPrice > 0) {
                          const adjusted = sizeNormalize(withPrice, withSFLA, withoutSFLA);
                          const flatAdj = adjusted - withoutPrice;
                          impacts.push(flatAdj);
                        }
                      });

                      if (impacts.length === 0) return 'No valid comparisons';
                      const avgImpact = impacts.reduce((sum, val) => sum + val, 0) / impacts.length;
                      return formatCurrency(avgImpact);
                    })()}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B', fontWeight: '500' }}>Average % Impact: </span>
                  <span style={{ fontWeight: '600', color: '#059669' }}>
                    {(() => {
                      const impacts = [];
                      Object.values(additionalResults.byVCS || {}).forEach(data => {
                        const withSFLA = data.with.avg_sfla || 0;
                        const withPrice = data.with.avg_norm_time || 0;
                        const withoutSFLA = data.without.avg_sfla || 0;
                        const withoutPrice = data.without.avg_norm_time || 0;

                        if (withSFLA > 0 && withPrice > 0 && withoutSFLA > 0 && withoutPrice > 0) {
                          const adjusted = sizeNormalize(withPrice, withSFLA, withoutSFLA);
                          const pctAdj = ((adjusted - withoutPrice) / withoutPrice) * 100;
                          impacts.push(pctAdj);
                        }
                      });

                      if (impacts.length === 0) return 'No valid comparisons';
                      const avgPct = impacts.reduce((sum, val) => sum + val, 0) / impacts.length;
                      return `${avgPct.toFixed(1)}%`;
                    })()}
                  </span>
                </div>
              </div>
            </div>


            {/* VCS Analysis Table - Grouped by VCS */}
            {renderVCSAnalysisTable(additionalResults.byVCS)}

            {/* Additional Cards Detail Table */}
            <div style={{
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <div style={{
                padding: '12px 15px',
                backgroundColor: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0' }}>
                  All Additional Cards Detail
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: '500' }}>
                    ({(additionalResults.additionalCardsList || []).length} cards)
                  </span>
                  <button
                    onClick={exportAllAdditionalCardsDetail}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#10B981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Export Detail
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F3F4F6' }}>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_block')}
                      >
                        Block{renderSortIcon('property_block')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_lot')}
                      >
                        Lot{renderSortIcon('property_lot')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_qualifier')}
                      >
                        Qualifier{renderSortIcon('property_qualifier')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_addl_card')}
                      >
                        Card{renderSortIcon('property_addl_card')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_location')}
                      >
                        Address{renderSortIcon('property_location')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('new_vcs')}
                      >
                        VCS{renderSortIcon('new_vcs')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('property_m4_class')}
                      >
                        Class{renderSortIcon('property_m4_class')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('asset_type_use')}
                      >
                        Type/Use{renderSortIcon('asset_type_use')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('asset_building_class')}
                      >
                        Building Class{renderSortIcon('asset_building_class')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('asset_sfla')}
                      >
                        SFLA{renderSortIcon('asset_sfla')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('asset_year_built')}
                      >
                        Year Built{renderSortIcon('asset_year_built')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('sales_price')}
                      >
                        Sales Price{renderSortIcon('sales_price')}
                      </th>
                      <th
                        style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => handleSort('values_norm_time')}
                      >
                        Price Time{renderSortIcon('values_norm_time')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedAdditionalCards().length > 0 ? (
                      getSortedAdditionalCards().map((prop, idx) => (
                        <tr key={`${prop.property_composite_key}-${idx}`} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.property_block || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.property_lot || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.property_qualifier || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px', fontWeight: '500' }}>
                            {prop.property_addl_card || prop.additional_card}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: '13px' }}>{prop.property_location}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.new_vcs || prop.property_vcs || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                            {prop.property_m4_class || prop.property_cama_class || '-'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.asset_type_use || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                            {prop.asset_building_class || '-'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', color: !prop.asset_sfla ? '#DC2626' : 'inherit', fontWeight: !prop.asset_sfla ? '500' : 'normal' }}>
                            {prop.asset_sfla ? parseInt(prop.asset_sfla).toLocaleString() : '-'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px', color: !prop.asset_year_built ? '#DC2626' : 'inherit', fontWeight: !prop.asset_year_built ? '500' : 'normal' }}>{prop.asset_year_built || '-'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                            {prop.sales_price ? formatCurrency(prop.sales_price) : '-'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                            {prop.values_norm_time ? formatCurrency(prop.values_norm_time) : '-'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="13" style={{ padding: '20px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
                          No additional cards found in this dataset
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>
            <div style={{ marginBottom: '10px' }}>
              <svg style={{ width: '48px', height: '48px', margin: '0 auto', opacity: 0.3 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>Loading additional cards analysis...</div>
          </div>
        )}
      </div>
    );
  };
  // ============ LOAD PROPERTY MARKET DATA ON MOUNT ============
  useEffect(() => {
    if (jobData?.id) {
      // Load property market analysis data once
      const loadMarketData = async () => {
        try {
          const { data, error } = await supabase
            .from('property_market_analysis')
            .select('property_composite_key, values_norm_time')
            .eq('job_id', jobData.id);
          
          if (!error && data) {
            setPropertyMarketData(data);
          }
        } catch (err) {
          console.error('Error loading property market data:', err);
        }
      };
      
      loadMarketData();
    }
  }, [jobData?.id]);

  // Load existing results from marketLandData on mount
  useEffect(() => {
    if (marketLandData) {
      if (marketLandData.custom_attribute_rollup) {
        setCustomResults(marketLandData.custom_attribute_rollup);
      }
      if (marketLandData.additional_cards_rollup) {
        setAdditionalResults(marketLandData.additional_cards_rollup);
      }
      if (marketLandData.basement_type_config) {
        setBasementConfig(normalizeBasementConfig(marketLandData.basement_type_config));
      }
    }
  }, [marketLandData]);

  // ============ BASEMENT TYPE CONFIG: BRT description lookup ============
  // Walk parsed_code_definitions.sections.Residential to find the basement
  // section (KEY === '30') and build a code -> description map. The shared
  // interpretCodes.getBRTValue helper hardcodes only a few sections and does
  // not include basement, so we do the walk locally.
  const brtBasementCodeDescriptions = useMemo(() => {
    if (vendorType !== 'BRT') return {};
    const out = {};
    const residential = parsedCodeDefinitions?.sections?.Residential;
    if (!residential) return out;
    let basementSection = null;
    for (const sectionData of Object.values(residential)) {
      if (sectionData?.KEY === '30') {
        basementSection = sectionData;
        break;
      }
    }
    if (!basementSection?.MAP) return out;
    Object.values(basementSection.MAP).forEach(mapItem => {
      const code = (mapItem?.KEY || mapItem?.DATA?.KEY || '').toString().trim().toUpperCase();
      const desc = mapItem?.DATA?.VALUE || mapItem?.VALUE;
      if (code && desc) out[code] = desc;
    });
    return out;
  }, [parsedCodeDefinitions, vendorType]);

  // Pattern for codes/descriptions that should default to 'living' on first load.
  // Includes the BRT-truncated forms (LIV / HEAT) since BRT label cells are narrow
  // and code files routinely abbreviate (e.g. Cedar Grove: "LIV BSMT", or
  // Franklin: "FIN B W/HEAT").
  const isLivingBasementLabel = (code, description) => {
    const haystack = `${code || ''} ${description || ''}`.toUpperCase();
    if (/\bLIVING\b/.test(haystack)) return true;
    if (/\bLIVABLE\b/.test(haystack)) return true;
    if (/\bLIV\b/.test(haystack)) return true;            // BRT truncation: "LIV BSMT"
    if (/\bHEATED\b/.test(haystack)) return true;
    if (/W\/HEAT/.test(haystack)) return true;
    if (/\bWITH\s+HEAT\b/.test(haystack)) return true;
    if (/\bHEAT\b/.test(haystack)) return true;
    return false;
  };

  // ============ BASEMENT TYPE CONFIG: aggregate distinct codes from properties ============
  const basementCodeRows = useMemo(() => {
    if (vendorType !== 'BRT') return [];
    const map = new Map();
    (properties || []).forEach(p => {
      [
        { code: p.fin_basement_code_1, area: p.fin_basement_area_1 },
        { code: p.fin_basement_code_2, area: p.fin_basement_area_2 },
      ].forEach(({ code, area }) => {
        const raw = (code || '').toString().trim();
        if (!raw) return;
        const key = raw.toUpperCase();
        if (!map.has(key)) {
          const description = brtBasementCodeDescriptions[key] || null;
          map.set(key, { code: key, raw, count: 0, totalArea: 0, description });
        }
        const row = map.get(key);
        row.count += 1;
        row.totalArea += Number(area) || 0;
      });
    });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [properties, vendorType, brtBasementCodeDescriptions]);

  // Auto-seed defaults the first time we render the tab with codes available.
  // Only seeds rows that don't already have a saved mode — never overwrites
  // user choices. Doesn't write to DB; user still has to hit Save.
  useEffect(() => {
    if (basementSeedApplied) return;
    if (vendorType !== 'BRT') return;
    if (basementCodeRows.length === 0) return;
    const additions = {};
    basementCodeRows.forEach(row => {
      if (basementConfig.codes?.[row.code]) return; // user-set or pre-saved
      if (isLivingBasementLabel(row.code, row.description)) {
        additions[row.code] = { mode: 'living' };
      }
    });
    if (Object.keys(additions).length > 0) {
      setBasementConfig(prev => ({
        ...prev,
        codes: { ...(prev.codes || {}), ...additions },
      }));
    }
    setBasementSeedApplied(true);
  }, [basementCodeRows, basementSeedApplied, vendorType, basementConfig.codes]);

  const setBasementCodeMode = (code, mode) => {
    setBasementConfig(prev => {
      const codes = { ...(prev.codes || {}) };
      if (mode === 'living' || mode === 'subtract') {
        codes[code] = { mode };
      } else {
        delete codes[code];
      }
      return { ...prev, codes };
    });
    setBasementSaved(false);
  };

  const setMicrosystemsBasementMode = (mode) => {
    setBasementConfig(prev => ({
      ...prev,
      microsystemsMode: mode === 'living' || mode === 'subtract' ? mode : undefined,
    }));
    setBasementSaved(false);
  };

  const saveBasementConfig = async () => {
    if (!jobData?.id) return;
    setBasementSaving(true);
    setBasementSaved(false);
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert({
          job_id: jobData.id,
          basement_type_config: basementConfig,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'job_id' });
      if (error) throw error;
      setBasementSaved(true);
      if (onUpdateJobCache) onUpdateJobCache();
    } catch (err) {
      console.error('Error saving basement config:', err);
      alert(`Failed to save basement config: ${err.message}`);
    } finally {
      setBasementSaving(false);
    }
  };

  const renderBasementTypeConfig = () => {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm text-gray-700 space-y-2">
          <p className="font-medium text-blue-900">Basement Type Configuration</p>
          <p>
            Pick a treatment per basement code so SFLA and the CME{' '}
            <em>Finished Basement = Yes</em> adjustment stay consistent.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>In SFLA (Living)</strong> — the SFLA total already includes this basement (heated /
              living). The Liveable Area cell shows a <span className="text-amber-600 font-bold">*</span>
              badge, and the <em>Finished Basement = Yes</em> CME adjustment is suppressed so the
              property isn't counted twice.
            </li>
            <li>
              <strong>Subtract from SFLA</strong> — strip the basement SF out of the displayed/used SFLA
              (Franklin's behavior for code <code>02</code>). The <em>Finished Basement = Yes</em>
              adjustment fires normally, treating the basement as its own amenity.
            </li>
            <li>
              <strong>Off</strong> — leave the code alone. SFLA and finished-basement adjustment behave
              as they always have.
            </li>
          </ul>
          <p className="text-xs text-gray-600">
            Codes whose description matches <em>Living</em>, <em>Heated</em>, or <em>W/Heat</em> are
            pre-set to <strong>In SFLA (Living)</strong> on first load. You still have to hit Save.
          </p>
        </div>

        {vendorType === 'BRT' ? (
          basementCodeRows.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded p-4 text-sm text-gray-600">
              No <code>fin_basement_code_*</code> values found on this job's properties yet. Once
              the source file is loaded with finished/living basement codes, they'll appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border border-gray-300 px-3 py-2 text-left font-semibold">Code</th>
                    <th className="border border-gray-300 px-3 py-2 text-left font-semibold">Description</th>
                    <th className="border border-gray-300 px-3 py-2 text-right font-semibold"># Properties</th>
                    <th className="border border-gray-300 px-3 py-2 text-right font-semibold">Total SF</th>
                    <th className="border border-gray-300 px-3 py-2 text-left font-semibold">Treatment</th>
                  </tr>
                </thead>
                <tbody>
                  {basementCodeRows.map(row => {
                    const cfg = basementConfig.codes?.[row.code];
                    const mode = cfg?.mode || '';
                    return (
                      <tr key={row.code} className="border-t border-gray-200">
                        <td className="border border-gray-300 px-3 py-2 font-mono">{row.code}</td>
                        <td className="border border-gray-300 px-3 py-2 text-gray-700">
                          {row.description ? row.description : <span className="text-gray-400">— (no description in code file)</span>}
                        </td>
                        <td className="border border-gray-300 px-3 py-2 text-right">{row.count.toLocaleString()}</td>
                        <td className="border border-gray-300 px-3 py-2 text-right">{Math.round(row.totalArea).toLocaleString()}</td>
                        <td className="border border-gray-300 px-3 py-2">
                          <select
                            value={mode}
                            onChange={e => setBasementCodeMode(row.code, e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded text-sm w-56"
                          >
                            <option value="">Off</option>
                            <option value="living">In SFLA (Living)</option>
                            <option value="subtract">Subtract from SFLA</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="bg-white border border-gray-300 rounded p-4">
            <p className="text-sm text-gray-700 mb-3">
              Microsystems exposes living/heated basement directly via the <code>Bsmt Living Sf</code>
              field (stored as <code>living_basement_area</code>). Pick how it should be treated:
            </p>
            <label className="inline-flex items-center gap-2 text-sm">
              <span>Treatment:</span>
              <select
                value={basementConfig.microsystemsMode || ''}
                onChange={e => setMicrosystemsBasementMode(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm w-56"
              >
                <option value="">Off</option>
                <option value="living">In SFLA (Living)</option>
                <option value="subtract">Subtract from SFLA</option>
              </select>
            </label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={saveBasementConfig}
            disabled={basementSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {basementSaving ? 'Saving…' : 'Save Basement Config'}
          </button>
          {basementSaved && (
            <span className="text-sm text-green-700">✓ Saved</span>
          )}
        </div>
      </div>
    );
  };

  // Persist state changes to localStorage
  useEffect(() => {
    if (jobData?.id) {
      localStorage.setItem(`attr-cards-type-filter-${jobData.id}`, typeUseFilter);
    }
  }, [typeUseFilter, jobData?.id]);

  useEffect(() => {
    if (jobData?.id) {
      localStorage.setItem(`attr-cards-interior-inspections-${jobData.id}`, useInteriorInspections.toString());
    }
  }, [useInteriorInspections, jobData?.id]);

  useEffect(() => {
    if (jobData?.id) {
      localStorage.setItem(`attr-cards-exterior-baseline-${jobData.id}`, manualExteriorBaseline);
    }
  }, [manualExteriorBaseline, jobData?.id]);

  useEffect(() => {
    if (jobData?.id) {
      localStorage.setItem(`attr-cards-interior-baseline-${jobData.id}`, manualInteriorBaseline);
    }
  }, [manualInteriorBaseline, jobData?.id]);

  // Load all saved settings from localStorage when job ID becomes available (only once per job)
  useEffect(() => {
    if (jobData?.id && loadedJobIdRef.current !== jobData.id) {
      loadedJobIdRef.current = jobData.id;

      // Load filter settings from localStorage (these are still OK to keep in localStorage)
      const savedTypeFilter = localStorage.getItem(`attr-cards-type-filter-${jobData.id}`);
      const savedInteriorInspections = localStorage.getItem(`attr-cards-interior-inspections-${jobData.id}`);

      // Apply saved filter settings
      if (savedTypeFilter) setTypeUseFilter(savedTypeFilter);
      if (savedInteriorInspections !== null) setUseInteriorInspections(savedInteriorInspections === 'true');

      // Note: Baseline conditions are now loaded from database via loadConditionConfigFromDatabase
    }
  }, [jobData?.id]);

  // ============ MAIN COMPONENT RENDER ============
  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Attribute & Card Analytics</h2>
          <p className="text-gray-600">
            Condition, custom attribute, and additional card analysis using normalized sale values.
          </p>
        </div>
        <div className="text-gray-400">
          <Layers size={36} />
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="mt-6 mls-subtab-nav" role="tablist" aria-label="Attribute sub tabs">
        <button 
          onClick={() => setActive('condition')} 
          className={`mls-subtab-btn ${active === 'condition' ? 'mls-subtab-btn--active' : ''}`}
          role="tab"
          aria-selected={active === 'condition'}
          aria-controls="condition-panel"
        >
          Condition Analysis
        </button>
        <button 
          onClick={() => setActive('custom')} 
          className={`mls-subtab-btn ${active === 'custom' ? 'mls-subtab-btn--active' : ''}`}
          role="tab"
          aria-selected={active === 'custom'}
          aria-controls="custom-panel"
        >
          Custom Attribute Analysis
        </button>
        <button
          onClick={() => setActive('additional')}
          className={`mls-subtab-btn ${active === 'additional' ? 'mls-subtab-btn--active' : ''}`}
          role="tab"
          aria-selected={active === 'additional'}
          aria-controls="additional-panel"
        >
          Additional Card Analysis
        </button>
        <button
          onClick={() => setActive('basement')}
          className={`mls-subtab-btn ${active === 'basement' ? 'mls-subtab-btn--active' : ''}`}
          role="tab"
          aria-selected={active === 'basement'}
          aria-controls="basement-panel"
        >
          Basement Type Config
        </button>
      </div>

      {/* Tab content panels */}
      <div className="mt-6">
        {active === 'condition' && (
          <section role="tabpanel" id="condition-panel" aria-labelledby="condition-tab">
            {renderConditionAnalysis()}
          </section>
        )}

        {active === 'custom' && (
          <section role="tabpanel" id="custom-panel" aria-labelledby="custom-tab">
            {renderCustomAttributeAnalysis()}
          </section>
        )}

        {active === 'additional' && (
          <section role="tabpanel" id="additional-panel" aria-labelledby="additional-tab">
            {renderAdditionalCardsAnalysis()}
          </section>
        )}

        {active === 'basement' && (
          <section role="tabpanel" id="basement-panel" aria-labelledby="basement-tab">
            {renderBasementTypeConfig()}
          </section>
        )}
      </div>
    </div>
  );
};

export default AttributeCardsTab;
