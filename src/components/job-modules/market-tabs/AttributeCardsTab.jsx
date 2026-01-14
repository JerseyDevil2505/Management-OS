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

  // ============ CUSTOM ATTRIBUTE STATE ============
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);

  // ============ ADDITIONAL CARDS STATE ============
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);
  const [sortField, setSortField] = useState('new_vcs'); // Default sort by VCS
  const [sortDirection, setSortDirection] = useState('asc');
  const [expandedAdditionalVCS, setExpandedAdditionalVCS] = useState(new Set()); // Track which additional cards VCS sections are expanded (collapsed by default)

  // ============ PROPERTY MARKET DATA STATE ============
  const [propertyMarketData, setPropertyMarketData] = useState([]);

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

    // Validation: require both exterior and interior to be configured
    if (!manualExteriorBaseline || !manualInteriorBaseline) {
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
      runAdditionalCardsAnalysis();
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

                      {/* Better Conditions */}
                      <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
                          Better than Baseline (positive adjustments):
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                          {allConditions.filter(item => item.description !== currentBaseline).map(item => (
                            <label key={item.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={currentBetter.includes(item.description)}
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

                      {/* Worse Conditions */}
                      <div>
                        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px' }}>
                          Worse than Baseline (negative adjustments):
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                          {allConditions.filter(item => item.description !== currentBaseline).map(item => (
                            <label key={item.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={currentWorse.includes(item.description)}
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
                        <strong>How it works:</strong> The export summary will only sum positive adjustments for "better" conditions
                        and only sum negative adjustments for "worse" conditions. The baseline shows blank (no adjustment).
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
  const detectRawFields = useCallback(async () => {
    try {
      const fields = new Set();
      const sampleSize = Math.min(100, properties.length);
      
      // Sample some properties to detect available raw fields
      for (let i = 0; i < sampleSize; i++) {
        const prop = properties[i];
        if (!prop.job_id || !prop.property_composite_key) continue;
        
        const rawData = await propertyService.getRawDataForProperty(
          prop.job_id, 
          prop.property_composite_key
        );
        
        if (rawData) {
          Object.keys(rawData).forEach(key => {
            // Filter out obvious non-analysis fields
            if (!key.startsWith('_') && 
                !key.includes('DATE') && 
                !key.includes('OWNER') &&
                !key.includes('ADDRESS') &&
                key !== 'job_id' &&
                key !== 'property_composite_key') {
              fields.add(key);
            }
          });
        }
      }
      
      const sortedFields = Array.from(fields).sort();
      setRawFields(sortedFields);
      if (sortedFields.length > 0 && !selectedRawField) {
        setSelectedRawField(sortedFields[0]);
      }
    } catch (error) {
      console.error('Error detecting raw fields:', error);
      setRawFields([]);
    }
  }, [properties]);

  // Load raw fields when switching to custom attribute tab
  useEffect(() => {
    if (active === 'custom' && rawFields.length === 0 && properties.length > 0) {
      detectRawFields();
    }
  }, [active, properties.length, detectRawFields]);

  // Run custom attribute analysis
  const runCustomAttributeAnalysis = async () => {
    if (!selectedRawField) return;
    
    setCustomWorking(true);
    try {
      // Get properties with normalized values
      const validProps = properties.filter(p => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        return marketData?.values_norm_time > 0;
      });

      // Build lookup with raw data
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

      // Helper to check if property has the attribute
      const hasAttribute = (rawData) => {
        if (!rawData || !rawData[selectedRawField]) return false;
        const value = rawData[selectedRawField];
        
        if (matchValue === '') {
          // Just check if field exists and has value
          return value !== null && value !== undefined && String(value).trim() !== '';
        } else {
          // Check for specific match
          const strValue = String(value).trim().toUpperCase();
          const strMatch = String(matchValue).trim().toUpperCase();
          
          // Try exact match first
          if (strValue === strMatch) return true;
          
          // Try numeric comparison if both are numbers
          const numValue = Number(value);
          const numMatch = Number(matchValue);
          if (!isNaN(numValue) && !isNaN(numMatch)) {
            return Math.abs(numValue - numMatch) < 0.0001;
          }
          
          return false;
        }
      };

      // Group properties with/without attribute
      const withAttr = [];
      const withoutAttr = [];
      
      lookup.forEach(({ p, raw }) => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        if (marketData?.values_norm_time > 0) {
          const propData = {
            ...p,
            values_norm_time: marketData.values_norm_time
          };
          
          if (hasAttribute(raw)) {
            withAttr.push(propData);
          } else {
            withoutAttr.push(propData);
          }
        }
      });

      // Calculate overall statistics
      const calculateStats = (props) => {
        if (props.length === 0) return { n: 0, avg_price: null, avg_size: null };
        
        const avgPrice = props.reduce((sum, p) => sum + p.values_norm_time, 0) / props.length;
        const validSizes = props.filter(p => (p.sfla || p.property_sfla) > 0);
        const avgSize = validSizes.length > 0 ?
          validSizes.reduce((sum, p) => sum + (p.sfla || p.property_sfla || 0), 0) / validSizes.length : null;
        
        return {
          n: props.length,
          avg_price: Math.round(avgPrice),
          avg_size: avgSize ? Math.round(avgSize) : null
        };
      };

      const withStats = calculateStats(withAttr);
      const withoutStats = calculateStats(withoutAttr);
      
      // Calculate adjustments
      let flatAdj = null;
      let pctAdj = null;
      
      if (withStats.avg_price && withoutStats.avg_price) {
        flatAdj = Math.round(withStats.avg_price - withoutStats.avg_price);
        pctAdj = ((withStats.avg_price - withoutStats.avg_price) / withoutStats.avg_price) * 100;
      }

      // Group by VCS
      const byVCS = {};
      lookup.forEach(({ p, raw }) => {
        const vcs = p.new_vcs || p.property_vcs || 'UNKNOWN';
        if (!byVCS[vcs]) byVCS[vcs] = { with: [], without: [] };
        
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        
        if (marketData?.values_norm_time > 0) {
          const propData = {
            ...p,
            values_norm_time: marketData.values_norm_time
          };
          
          if (hasAttribute(raw)) {
            byVCS[vcs].with.push(propData);
          } else {
            byVCS[vcs].without.push(propData);
          }
        }
      });

      // Calculate VCS-level statistics
      const byVCSResults = {};
      Object.entries(byVCS).forEach(([vcs, data]) => {
        const vcsWithStats = calculateStats(data.with);
        const vcsWithoutStats = calculateStats(data.without);
        
        let vcsFlat = null;
        let vcsPct = null;
        
        if (vcsWithStats.avg_price && vcsWithoutStats.avg_price) {
          vcsFlat = Math.round(vcsWithStats.avg_price - vcsWithoutStats.avg_price);
          vcsPct = ((vcsWithStats.avg_price - vcsWithoutStats.avg_price) / vcsWithoutStats.avg_price) * 100;
        }
        
        byVCSResults[vcs] = {
          with: vcsWithStats,
          without: vcsWithoutStats,
          flat_adj: vcsFlat,
          pct_adj: vcsPct
        };
      });

      // Build results
      const results = {
        field: selectedRawField,
        matchValue: matchValue || '(exists)',
        overall: {
          with: withStats,
          without: withoutStats,
          flat_adj: flatAdj,
          pct_adj: pctAdj
        },
        byVCS: byVCSResults,
        generated_at: new Date().toISOString()
      };

      setCustomResults(results);
      
      // Save to database
      await saveCustomResultsToDB(results);
      
    } catch (error) {
      console.error('Error running custom attribute analysis:', error);
    } finally {
      setCustomWorking(false);
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

  // Export custom results to CSV
  const exportCustomResultsToCSV = () => {
    if (!customResults) return;
    
    const headers = ['Group', 'With_Count', 'With_Avg', 'Without_Count', 'Without_Avg', 'Flat_Adj', 'Pct_Adj'];
    const rows = [];
    
    // Add overall row
    rows.push([
      'OVERALL',
      customResults.overall.with.n,
      customResults.overall.with.avg_price || '',
      customResults.overall.without.n,
      customResults.overall.without.avg_price || '',
      customResults.overall.flat_adj || '',
      customResults.overall.pct_adj ? customResults.overall.pct_adj.toFixed(1) : ''
    ]);
    
    // Add VCS rows
    Object.entries(customResults.byVCS || {}).forEach(([vcs, data]) => {
      rows.push([
        vcs,
        data.with.n,
        data.with.avg_price || '',
        data.without.n,
        data.without.avg_price || '',
        data.flat_adj || '',
        data.pct_adj ? data.pct_adj.toFixed(1) : ''
      ]);
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
          <div style={{ marginBottom: '12px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
              Select Field and Value to Analyze
            </h4>
            <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
              Compare properties with vs without specific attributes to determine value impact
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style={{ flex: '1' }}>
              <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                Raw Data Field
              </label>
              <select
                value={selectedRawField}
                onChange={(e) => setSelectedRawField(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '14px',
                  backgroundColor: 'white'
                }}
                disabled={customWorking}
              >
                <option value="">Select a field...</option>
                {rawFields.map(field => (
                  <option key={field} value={field}>{field}</option>
                ))}
              </select>
            </div>
            
            <div style={{ flex: '1' }}>
              <label style={{ fontSize: '12px', color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                Match Value (leave empty = field exists)
              </label>
              <input
                type="text"
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder="e.g., Y, 1, POOL, etc."
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  border: '1px solid #D1D5DB',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
                disabled={customWorking}
              />
            </div>
            
            <button
              onClick={runCustomAttributeAnalysis}
              disabled={customWorking || !selectedRawField}
              style={{
                padding: '6px 16px',
                backgroundColor: customWorking || !selectedRawField ? '#E5E7EB' : '#3B82F6',
                color: customWorking || !selectedRawField ? '#9CA3AF' : 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: customWorking || !selectedRawField ? 'not-allowed' : 'pointer'
              }}
            >
              {customWorking ? 'Analyzing...' : 'Run Analysis'}
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
            {/* Overall Results */}
            <div style={{ 
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#EFF6FF',
              borderRadius: '6px',
              border: '1px solid #BFDBFE'
            }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#1E40AF' }}>
                Overall Analysis: {customResults.field} {customResults.matchValue !== '(exists)' && `= "${customResults.matchValue}"`}
              </h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>With Attribute</div>
                  <div style={{ fontSize: '20px', fontWeight: '600', color: '#1E40AF' }}>
                    {customResults.overall.with.n}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    {customResults.overall.with.avg_price ? formatCurrency(customResults.overall.with.avg_price) : '-'}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Without Attribute</div>
                  <div style={{ fontSize: '20px', fontWeight: '600', color: '#1E40AF' }}>
                    {customResults.overall.without.n}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    {customResults.overall.without.avg_price ? formatCurrency(customResults.overall.without.avg_price) : '-'}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Dollar Impact</div>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: '600',
                    color: customResults.overall.flat_adj > 0 ? '#059669' : 
                           customResults.overall.flat_adj < 0 ? '#DC2626' : '#6B7280'
                  }}>
                    {customResults.overall.flat_adj ? formatCurrency(customResults.overall.flat_adj) : '-'}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>Percent Impact</div>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: '600',
                    color: customResults.overall.pct_adj > 0 ? '#059669' : 
                           customResults.overall.pct_adj < 0 ? '#DC2626' : '#6B7280'
                  }}>
                    {customResults.overall.pct_adj ? formatPercent(customResults.overall.pct_adj) : '-'}
                  </div>
                </div>
              </div>
            </div>

            {/* VCS Breakdown */}
            <div style={{ 
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                padding: '12px 15px',
                backgroundColor: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0' }}>
                  Analysis by VCS
                </h4>
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
                      With Avg
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>
                      Without (n)
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Without Avg
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      $ Impact
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      % Impact
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(customResults.byVCS || {}).map(([vcs, data], idx) => (
                    <tr key={vcs} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '500' }}>
                        {vcs}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                        {data.with.n}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {data.with.avg_price ? formatCurrency(data.with.avg_price) : '-'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                        {data.without.n}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {data.without.avg_price ? formatCurrency(data.without.avg_price) : '-'}
                      </td>
                      <td style={{ 
                        padding: '8px 12px', 
                        textAlign: 'right', 
                        fontSize: '13px',
                        color: data.flat_adj > 0 ? '#059669' : 
                               data.flat_adj < 0 ? '#DC2626' : '#6B7280'
                      }}>
                        {data.flat_adj ? formatCurrency(data.flat_adj) : '-'}
                      </td>
                      <td style={{ 
                        padding: '8px 12px', 
                        textAlign: 'right', 
                        fontSize: '13px',
                        color: data.pct_adj > 0 ? '#059669' : 
                               data.pct_adj < 0 ? '#DC2626' : '#6B7280'
                      }}>
                        {data.pct_adj ? formatPercent(data.pct_adj) : '-'}
                      </td>
                    </tr>
                  ))}
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
      // Filter to MAIN CARDS ONLY with sales data
      // Use property_addl_card directly (more reliable than parsing composite key)
      const mainCardSales = properties.filter(p => {
        const card = (p.property_addl_card || p.additional_card || '').toString().trim();

        // Card filter based on vendor (MAIN CARDS ONLY)
        if (vendorType === 'Microsystems') {
          const cardUpper = card.toUpperCase();
          if (cardUpper !== 'M' && cardUpper !== 'MAIN' && cardUpper !== '') return false;
        } else { // BRT
          const cardNum = parseInt(card);
          // Main card is card 1, or blank/empty (which defaults to card 1)
          if (!(cardNum === 1 || card === '' || isNaN(cardNum))) return false;
        }

        // Must have sales data (already normalized with combined SFLA by PreValuation)
        if (!p.values_norm_time || p.values_norm_time <= 0) return false;

        // Must have VCS
        if (!p.new_vcs && !p.property_vcs) return false;

        return true;
      });

      console.log(`✅ Found ${mainCardSales.length} main card sales to analyze`);

      // For each main card, detect if it has additional cards
      const enhancedSales = mainCardSales.map(prop => {
        // Find additional cards for this property (same block-lot-qualifier)
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;

        const additionalCards = properties.filter(p => {
          const pBaseKey = `${p.property_block || ''}-${p.property_lot || ''}-${p.property_qualifier || ''}`;
          if (pBaseKey !== baseKey) return false;

          // Check if this is an additional card (not main card)
          const pCard = (p.property_addl_card || p.additional_card || '').toString().trim();

          if (vendorType === 'Microsystems') {
            const cardUpper = pCard.toUpperCase();
            return cardUpper && cardUpper !== 'M' && cardUpper !== 'MAIN' && /^[A-Z]$/.test(cardUpper);
          } else { // BRT
            const cardNum = parseInt(pCard);
            return !isNaN(cardNum) && cardNum > 1;
          }
        });

        return {
          ...prop,
          has_additional_cards: additionalCards.length > 0,
          additional_card_count: additionalCards.length
          // values_norm_time already includes combined SFLA from PreValuation normalization
          // asset_sfla already includes combined SFLA from PreValuation normalization
        };
      });

      const withCards = enhancedSales.filter(p => p.has_additional_cards);
      const withoutCards = enhancedSales.filter(p => !p.has_additional_cards);

      console.log(`📊 Sales breakdown:`, {
        with_additional_cards: withCards.length,
        without_additional_cards: withoutCards.length
      });

      // Create list of ALL properties with additional cards (for detail table at bottom)
      const additionalCardsList = properties.filter(prop => {
        const card = (prop.property_addl_card || prop.additional_card || '').toString().trim();

        if (vendorType === 'Microsystems') {
          const cardUpper = card.toUpperCase();
          return cardUpper && cardUpper !== 'M' && cardUpper !== 'MAIN' && /^[A-Z]$/.test(cardUpper);
        } else { // BRT
          const cardNum = parseInt(card);
          return !isNaN(cardNum) && cardNum > 1;
        }
      });

      console.log(`📋 Total additional card records: ${additionalCardsList.length}`);

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

      // Group ALL properties by location (not requiring sales data)
      const locationGroups = new Map();
      properties.forEach(prop => {
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
        if (!locationGroups.has(baseKey)) {
          locationGroups.set(baseKey, []);
        }
        locationGroups.get(baseKey).push(prop);
      });

      // Identify properties with additional cards and create pairs
      locationGroups.forEach((locationProps, locationKey) => {
        if (locationProps.length <= 1) return; // Skip single card properties

        const vcs = locationProps[0].new_vcs || locationProps[0].property_vcs;
        if (!vcs) return;

        // Check if this location has additional cards
        const cardIds = new Set();
        locationProps.forEach(p => {
          let card = p.property_addl_card || p.additional_card || p.property_card || null;
          if (!card && p.property_composite_key) {
            const parts = p.property_composite_key.split('-').map(s => s.trim());
            card = parts[4] || parts[3] || null;
          }
          if (card) cardIds.add(String(card).trim().toUpperCase());
        });

        // Check if it has additional cards using vendor logic
        let hasAdditionalCards = false;
        if (vendorType === 'BRT' || vendorType === 'brt') {
          const numericCards = Array.from(cardIds).map(c => parseInt(c)).filter(n => !isNaN(n));
          hasAdditionalCards = numericCards.some(n => n > 1);
        } else {
          const nonMain = Array.from(cardIds).filter(c => c !== 'M' && c !== 'MAIN');
          hasAdditionalCards = nonMain.length > 0;
        }

        if (hasAdditionalCards) {
          console.log(`Found additional cards at ${locationKey}:`, Array.from(cardIds));

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

          // Find baseline comparisons (ALL properties without additional cards in same VCS)
          const baselineComparisons = properties.filter(p => {
            if ((p.new_vcs || p.property_vcs) !== vcs) return false;

            // Check if this property does NOT have additional cards
            const card = p.property_addl_card || p.additional_card || p.property_card || '';
            let isMainCardOnly = false;

            if (vendorType === 'BRT' || vendorType === 'brt') {
              const cardNum = parseInt(card);
              isMainCardOnly = isNaN(cardNum) || cardNum <= 1; // Main card or no card
            } else {
              const cardUpper = card.toString().trim().toUpperCase();
              isMainCardOnly = !cardUpper || cardUpper === 'M' || cardUpper === 'MAIN'; // Main card only
            }

            return isMainCardOnly;
          }).filter(p => p.values_norm_time && p.values_norm_time > 0) // Only include baseline props with sales for comparison
          .map(p => ({
            sfla: parseInt(p.asset_sfla) || 0,
            year_built: parseInt(p.asset_year_built) || null,
            norm_time: p.values_norm_time
          }));

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
    }
  }, [marketLandData]);

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
      </div>
    </div>
  );
};

export default AttributeCardsTab;
