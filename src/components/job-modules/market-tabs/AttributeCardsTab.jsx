import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Layers, FileText, ChevronDown, ChevronRight, Info } from 'lucide-react';
import './sharedTabNav.css';
import { supabase, propertyService, interpretCodes } from '../../../lib/supabaseClient';

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

  // Main tab state
  const [active, setActive] = useState('condition');

  // ============ CONDITION ANALYSIS STATE ============
  const [typeUseFilter, setTypeUseFilter] = useState(() => {
    return localStorage.getItem(`attr-cards-type-filter-${jobData?.id}`) || '1';
  });
  const [useInteriorInspections, setUseInteriorInspections] = useState(() => {
    return localStorage.getItem(`attr-cards-interior-inspections-${jobData?.id}`) === 'true';
  });
  const [expandedExteriorVCS, setExpandedExteriorVCS] = useState(new Set()); // Track which exterior VCS sections are expanded
  const [expandedInteriorVCS, setExpandedInteriorVCS] = useState(new Set()); // Track which interior VCS sections are expanded
  const [manualExteriorBaseline, setManualExteriorBaseline] = useState(() => {
    return localStorage.getItem(`attr-cards-exterior-baseline-${jobData?.id}`) || '';
  });
  const [manualInteriorBaseline, setManualInteriorBaseline] = useState(() => {
    return localStorage.getItem(`attr-cards-interior-baseline-${jobData?.id}`) || '';
  });
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

  // ============ CUSTOM ATTRIBUTE STATE ============
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);

  // ============ ADDITIONAL CARDS STATE ============
  const [additionalWorking, setAdditionalWorking] = useState(false);
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);

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
  // ============ DETECT ACTUAL CONDITION CODES FROM DATA ============
  const detectActualConditionCodes = useCallback(async () => {
    try {
      // Get all unique condition codes from the actual property records
      const uniqueExterior = new Set();
      const uniqueInterior = new Set();
      
      // Scan through properties to find all unique codes
      properties.forEach(prop => {
        const extCond = prop.asset_ext_cond;
        const intCond = prop.asset_int_cond;
        
        // BRT uses '00' as null/empty, skip it along with other empty values
        if (extCond && extCond !== '00' && extCond !== '0' && extCond.trim() !== '') {
          uniqueExterior.add(extCond.trim());
        }
        if (intCond && intCond !== '00' && intCond !== '0' && intCond.trim() !== '') {
          uniqueInterior.add(intCond.trim());
        }
      });

      // Now get descriptions for these codes FROM THE PARSED DEFINITIONS
      const exterior = {};
      const interior = {};

      // For each unique exterior code, get its description
      for (const code of uniqueExterior) {
        // Skip BRT null code
        if (code === '00') continue;

        // Use interpretCodes function for vendor-agnostic lookup
        const description = interpretCodes.getExteriorConditionName(
          { asset_ext_cond: code },
          parsedCodeDefinitions,
          vendorType
        ) || `Condition ${code}`;

        exterior[code] = description;
      }

      // For each unique interior code, get its description
      for (const code of uniqueInterior) {
        // Skip BRT null code
        if (code === '00') continue;

        // Use interpretCodes function for vendor-agnostic lookup
        const description = interpretCodes.getInteriorConditionName(
          { asset_int_cond: code },
          parsedCodeDefinitions,
          vendorType
        ) || `Condition ${code}`;

        interior[code] = description;
      }

      console.log('Detected condition codes:', { exterior, interior });
      return { exterior, interior };
    } catch (error) {
      console.error('Error detecting actual condition codes:', error);
      return { exterior: {}, interior: {} };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties.length, vendorType]);

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

  // Load data on component mount and when filters change
  useEffect(() => {
    if (!jobData?.id || properties.length === 0) return;

    loadConditionAnalysisData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, properties.length, typeUseFilter, useInteriorInspections, manualExteriorBaseline, manualInteriorBaseline]);

  // Load additional card analysis on mount (like condition analysis)
  useEffect(() => {
    if (!jobData?.id || properties.length === 0 || propertyMarketData.length === 0) return;

    console.log('Auto-running additional card analysis on mount...');
    runAdditionalCardAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, properties.length, propertyMarketData.length]);
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
          
          // Find the baseline condition for this VCS
          let baselineCode = null;
          Object.entries(conditions).forEach(([code, condData]) => {
            if (condData.adjustmentPct === 0 || 
                condData.description.toUpperCase().includes('AVERAGE') ||
                condData.description.toUpperCase().includes('NORMAL')) {
              baselineCode = code;
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
                              {formatCurrency(cond.adjustedValue)}
                            </td>
                            <td style={{ 
                              padding: '8px 12px', 
                              textAlign: 'right', 
                              fontSize: '13px',
                              color: cond.adjustmentPct > 0 ? '#059669' : 
                                     cond.adjustmentPct < 0 ? '#DC2626' : '#6B7280'
                            }}>
                              {formatPercent(cond.adjustmentPct)}
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
                  *NULL = Illogical adjustment filtered out (positive adjustment for good conditions or negative adjustment for poor conditions)
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

    // Determine which baseline is being used
    const manualBaseline = type === 'Exterior' ? manualExteriorBaseline : manualInteriorBaseline;

    Object.values(data).forEach(vcsConditions => {
      Object.entries(vcsConditions).forEach(([code, cond]) => {
        // Skip baseline condition
        const isBaseline = manualBaseline ? (code === manualBaseline) :
                          (cond.adjustmentPct === 0 ||
                           cond.description.toUpperCase().includes('AVERAGE') ||
                           cond.description.toUpperCase().includes('NORMAL'));

        if (isBaseline) return;

        // Initialize condition tracking if not exists
        if (!conditionAdjustments[code]) {
          conditionAdjustments[code] = {
            description: cond.description,
            adjustments: [],
            totalProperties: 0
          };
        }

        // Apply NULL policy for illogical adjustments (both exterior and interior)
        const desc = cond.description.toUpperCase();
        const isGoodCondition = desc.includes('EXCELLENT') || desc.includes('GOOD') || desc.includes('SUPERIOR') ||
                               desc.includes('VERY GOOD') || desc.includes('MODERN') || code === 'G';
        const isPoorCondition = desc.includes('POOR') || desc.includes('FAIR') || desc.includes('UNSOUND') ||
                               desc.includes('VERY POOR') || desc.includes('DETERIORATED') ||
                               desc.includes('BELOW AVERAGE') || desc.includes('DILAPIDATED') || code === 'P' || code === 'F';

        let adjustmentToUse = cond.adjustmentPct;

        // Filter illogical adjustments - apply NULL policy
        if (isGoodCondition && cond.adjustmentPct < 0) {
          adjustmentToUse = null; // Good condition with negative adjustment = illogical
        } else if (isPoorCondition && cond.adjustmentPct > 0) {
          adjustmentToUse = null; // Poor condition with positive adjustment = illogical
        }

        if (adjustmentToUse !== null) {
          conditionAdjustments[code].adjustments.push(adjustmentToUse);
        }
        conditionAdjustments[code].totalProperties += cond.count;
      });
    });

    // Calculate averages for each condition
    const summary = [];
    Object.entries(conditionAdjustments).forEach(([code, data]) => {
      const validAdjustments = data.adjustments;
      const avgAdjustment = validAdjustments.length > 0 ?
        validAdjustments.reduce((sum, adj) => sum + adj, 0) / validAdjustments.length : null;

      // Categorize condition quality for sorting
      const desc = data.description.toUpperCase();
      let category = 0; // 0 = average/unknown, 1 = above average, -1 = below average

      // Above average conditions (should show positive adjustments)
      if (desc.includes('EXCELLENT') || desc.includes('VERY GOOD') || desc.includes('GOOD') ||
          desc.includes('SUPERIOR') || desc.includes('MODERN') || code === 'G') {
        category = 1;
      }
      // Below average conditions (should show negative adjustments)
      else if (desc.includes('FAIR') || desc.includes('POOR') || desc.includes('BELOW AVERAGE') ||
               desc.includes('DILAPIDATED') || desc.includes('DETERIORATED') || desc.includes('UNSOUND') ||
               desc.includes('VERY POOR') || code === 'P' || code === 'F') {
        category = -1;
      }

      summary.push({
        code,
        description: data.description,
        avgAdjustment,
        totalProperties: data.totalProperties,
        validVCSCount: validAdjustments.length,
        category
      });
    });

    // Sort with above average conditions first (descending), then below average (ascending by adjustment)
    return summary.sort((a, b) => {
      // First sort by category (above average first)
      if (a.category !== b.category) {
        return b.category - a.category;
      }

      // Within same category, sort by adjustment value
      if (a.category === 1) {
        // Above average: highest positive adjustments first
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

  // ============ CSV EXPORT FUNCTIONS ============
  const exportConditionDataToCSV = (data, type) => {
    const headers = ['VCS', 'Code', 'Description', 'Count', 'Avg_Value', 'Avg_SFLA', 'Avg_Year', 'Adjusted_Value', 'Adjustment_Pct'];
    const rows = [];

    Object.entries(data).forEach(([vcs, conditions]) => {
      Object.entries(conditions).forEach(([code, cond]) => {
        rows.push([
          vcs,
          code,
          cond.description,
          cond.count,
          cond.avgValue,
          cond.avgSize || '',
          cond.avgYear || '',
          cond.adjustedValue,
          cond.adjustmentPct.toFixed(1)
        ]);
      });
    });

    const filename = `${jobData.job_name || 'job'}_${type}_condition_analysis.csv`;
    downloadCsv(filename, headers, rows);
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

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => exportConditionDataToCSV(conditionData.exterior, 'exterior')}
                className={CSV_BUTTON_CLASS}
                disabled={conditionData.loading || Object.keys(conditionData.exterior).length === 0}
              >
                <FileText size={14} /> Export Exterior CSV
              </button>
              <button
                onClick={() => exportConditionDataToCSV(conditionData.interior, 'interior')}
                className={CSV_BUTTON_CLASS}
                disabled={conditionData.loading || Object.keys(conditionData.interior).length === 0}
              >
                <FileText size={14} /> Export Interior CSV
              </button>
            </div>
          </div>
        </div>

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
                  {/* Baseline Selection */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: '#1E40AF', fontWeight: '500' }}>
                      Set Baseline:
                    </label>
                    <select
                      value={manualExteriorBaseline}
                      onChange={(e) => setManualExteriorBaseline(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #3B82F6',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: 'white',
                        minWidth: '120px'
                      }}
                    >
                      <option value="">Auto-detect</option>
                      {Object.entries(availableConditionCodes.exterior).map(([code, description]) => (
                        <option key={code} value={code}>
                          {code} - {description}
                        </option>
                      ))}
                    </select>
                  </div>

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
                  {/* Baseline Selection */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: '#1E40AF', fontWeight: '500' }}>
                      Set Baseline:
                    </label>
                    <select
                      value={manualInteriorBaseline}
                      onChange={(e) => setManualInteriorBaseline(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #3B82F6',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: 'white',
                        minWidth: '120px'
                      }}
                    >
                      <option value="">Auto-detect</option>
                      {Object.entries(availableConditionCodes.interior).map(([code, description]) => (
                        <option key={code} value={code}>
                          {code} - {description}
                        </option>
                      ))}
                    </select>
                  </div>

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
  const runAdditionalCardAnalysis = async () => {
    setAdditionalWorking(true);
    try {
      // Get properties with normalized values
      const validProps = properties.filter(p => {
        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );
        return marketData?.values_norm_time > 0;
      });

      console.log(`Starting additional card analysis for ${validProps.length} properties with sales data`);

      // Helper function to extract base property key (without card suffix)
      const getBasePropertyKey = (compositeKey) => {
        if (!compositeKey) return null;

        // Use the same logic as package sale detection to group by base location
        const parts = compositeKey.split('-');
        if (parts.length >= 4) {
          // Remove card (second to last segment) and rebuild
          return parts.slice(0, -2).join('-') + '-' + parts[parts.length - 1];
        }
        return compositeKey; // fallback
      };

      // Helper function to check if property has additional cards
      const hasAdditionalCard = (prop) => {
        const addlCard = prop.property_addl_card;
        if (!addlCard || addlCard.trim() === '') return false;

        if (vendorType === 'BRT') {
          // BRT: numeric, anything other than card 1 or M
          const cardNum = addlCard.toString().trim();
          return cardNum !== '1' && cardNum !== 'M' && cardNum !== 'NONE' && cardNum !== '';
        } else if (vendorType === 'Microsystems') {
          // Microsystems: alphabetical, cards A through Z, M is reserved for Main
          const cardCode = addlCard.toString().trim().toUpperCase();
          return cardCode !== 'M' && cardCode !== 'MAIN' && cardCode !== '' && cardCode.match(/^[A-Z]$/);
        }
        return false;
      };

      // Helper to determine if property group contains additional cards
      const groupHasAdditionalCards = (group) => {
        // Check if any card in this group is an additional card
        const cardCodes = group.cards.map(c => (c.card_code || '').toString().trim().toUpperCase());

        if (vendorType === 'BRT') {
          // For BRT: if any numeric card > 1, it has additional cards
          return cardCodes.some(code => {
            const num = parseInt(code);
            return !isNaN(num) && num > 1;
          });
        } else if (vendorType === 'Microsystems') {
          // For Microsystems: if any card is A-Z (not M), it has additional cards
          return cardCodes.some(code => code.match(/^[A-Z]$/) && code !== 'M');
        }
        return false;
      };

      // Group properties by base key to handle multiple cards for same property
      const propertyGroups = new Map();

      validProps.forEach(p => {
        const baseKey = getBasePropertyKey(p.property_composite_key);
        if (!baseKey) return;

        const marketData = propertyMarketData.find(
          m => m.property_composite_key === p.property_composite_key
        );

        if (!marketData?.values_norm_time) return;

        if (!propertyGroups.has(baseKey)) {
          propertyGroups.set(baseKey, {
            cards: [],
            totalSfla: 0,
            avgValue: 0,
            avgYear: null,
            vcs: p.new_vcs || p.property_vcs || 'UNKNOWN',
            hasAdditionalCards: false
          });
        }

        const group = propertyGroups.get(baseKey);

        // Add this card to the group
        group.cards.push({
          ...p,
          values_norm_time: marketData.values_norm_time,
          sfla: p.asset_sfla || p.sfla || p.property_sfla || 0,
          year_built: p.asset_year_built || p.year_built || p.property_year_built || null,
          card_code: p.property_addl_card,
          address: p.property_location // For debugging/display
        });

        // Update group totals
        group.totalSfla += (p.asset_sfla || p.sfla || p.property_sfla || 0);
      });

      console.log(`Grouped ${validProps.length} properties into ${propertyGroups.size} unique property groups`);

      // Calculate averages for each group and categorize by VCS
      const byVCS = {};

      propertyGroups.forEach((group, baseKey) => {
        // Calculate group averages
        const totalValue = group.cards.reduce((sum, card) => sum + card.values_norm_time, 0);
        group.avgValue = Math.round(totalValue / group.cards.length);

        const validYears = group.cards.filter(card => card.year_built && card.year_built > 1900 && card.year_built < 2030);
        group.avgYear = validYears.length > 0 ?
          Math.round(validYears.reduce((sum, card) => sum + card.year_built, 0) / validYears.length) : null;

        // Use improved logic to determine if group has additional cards
        const hasAdditionalCards = groupHasAdditionalCards(group);

        // Initialize VCS group if needed
        if (!byVCS[group.vcs]) {
          byVCS[group.vcs] = { with_cards: [], without_cards: [] };
        }

        // Create summary data for this property group
        const groupData = {
          baseKey,
          address: group.cards[0]?.address || 'Unknown',
          cardCount: group.cards.length,
          cards: group.cards.map(c => c.card_code || 'M').join(', '),
          totalSfla: group.totalSfla,
          avgValue: group.avgValue,
          avgYear: group.avgYear,
          avgAge: group.avgYear ? new Date().getFullYear() - group.avgYear : null,
          // For debugging - show all card codes found
          cardCodes: group.cards.map(c => c.card_code).join(', ')
        };

        // Categorize based on whether it has additional cards
        if (hasAdditionalCards) {
          byVCS[group.vcs].with_cards.push(groupData);
        } else {
          byVCS[group.vcs].without_cards.push(groupData);
        }
      });

      // Calculate statistics for grouped properties
      const calculateGroupStats = (groups) => {
        if (groups.length === 0) {
          return { n: 0, avg_price: null, avg_size: null, avg_age: null, total_cards: 0 };
        }

        const avgPrice = groups.reduce((sum, g) => sum + g.avgValue, 0) / groups.length;

        const validSizes = groups.filter(g => g.totalSfla > 0);
        const avgSize = validSizes.length > 0 ?
          validSizes.reduce((sum, g) => sum + g.totalSfla, 0) / validSizes.length : null;

        const validAges = groups.filter(g => g.avgAge && g.avgAge > 0);
        const avgAge = validAges.length > 0 ?
          Math.round(validAges.reduce((sum, g) => sum + g.avgAge, 0) / validAges.length) : null;

        const totalCards = groups.reduce((sum, g) => sum + g.cardCount, 0);

        return {
          n: groups.length,
          avg_price: Math.round(avgPrice),
          avg_size: avgSize ? Math.round(avgSize) : null,
          avg_age: avgAge,
          total_cards: totalCards
        };
      };

      const results = {
        byVCS: {},
        overall: { with: { n: 0 }, without: { n: 0 } },
        summary: {
          vendorType,
          totalPropertiesAnalyzed: propertyGroups.size,
          propertiesWithCards: 0,
          propertiesWithoutCards: 0
        },
        generated_at: new Date().toISOString()
      };

      // Process each VCS
      Object.entries(byVCS).forEach(([vcs, data]) => {
        const withStats = calculateGroupStats(data.with_cards);
        const withoutStats = calculateGroupStats(data.without_cards);

        let flatAdj = null;
        let pctAdj = null;

        if (withStats.avg_price && withoutStats.avg_price) {
          flatAdj = Math.round(withStats.avg_price - withoutStats.avg_price);
          pctAdj = ((withStats.avg_price - withoutStats.avg_price) / withoutStats.avg_price) * 100;
        }

        results.byVCS[vcs] = {
          with: withStats,
          without: withoutStats,
          flat_adj: flatAdj,
          pct_adj: pctAdj
        };

        // Add to overall totals
        results.overall.with.n += withStats.n;
        results.overall.without.n += withoutStats.n;
        results.summary.propertiesWithCards += withStats.n;
        results.summary.propertiesWithoutCards += withoutStats.n;
      });

      // Add detailed logging for debugging
      console.log('🔍 Additional Card Analysis Debug Info:');
      console.log('Vendor Type:', vendorType);
      console.log('Total property groups found:', propertyGroups.size);
      console.log('Sample properties with addl cards:',
        validProps.filter(p => p.property_addl_card && p.property_addl_card !== 'M' && p.property_addl_card !== '1')
          .slice(0, 5)
          .map(p => ({
            address: p.property_location,
            card: p.property_addl_card,
            composite_key: p.property_composite_key
          }))
      );

      // Log VCS breakdown
      Object.entries(byVCS).forEach(([vcs, data]) => {
        console.log(`VCS ${vcs}:`, {
          withCards: data.with_cards.length,
          withoutCards: data.without_cards.length,
          sampleWithCards: data.with_cards.slice(0, 2).map(g => ({
            address: g.address,
            cards: g.cardCodes,
            totalSFLA: g.totalSfla
          }))
        });
      });

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

      // Save to database
      await saveAdditionalResultsToDB(results);

      console.log('✅ Additional card analysis completed successfully');
      
    } catch (error) {
      console.error('Error running additional card analysis:', error);
    } finally {
      setAdditionalWorking(false);
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

  // Export additional cards results to CSV
  const exportAdditionalResultsToCSV = () => {
    if (!additionalResults) return;

    const headers = [
      'VCS',
      'With_Cards_N',
      'With_Avg_Total_SFLA',
      'With_Avg_Price',
      'With_Avg_Age',
      'Without_Cards_N',
      'Without_Avg_SFLA',
      'Without_Avg_Price',
      'Without_Avg_Age',
      'Flat_Impact',
      'Pct_Impact'
    ];

    const rows = [];

    // Add analysis summary row
    rows.push([
      '=== ANALYSIS SUMMARY ===',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]);

    rows.push([
      'Analysis Method',
      `${additionalResults.summary?.vendorType || vendorType} - Properties grouped by base location`,
      'SFLA summed across all cards',
      `Total Properties: ${additionalResults.summary?.totalPropertiesAnalyzed || 0}`,
      `With Cards: ${additionalResults.summary?.propertiesWithCards || 0}`,
      `Without Cards: ${additionalResults.summary?.propertiesWithoutCards || 0}`,
      vendorType === 'BRT' ? 'Additional = Cards 2,3,4+ (not Card 1/Main)' : 'Additional = Cards A-Z (not Card M/Main)',
      '',
      '',
      '',
      ''
    ]);

    rows.push(['', '', '', '', '', '', '', '', '', '', '']); // Empty row

    // Add headers again
    rows.push(headers);

    // Add VCS data
    Object.entries(additionalResults.byVCS || {}).forEach(([vcs, data]) => {
      rows.push([
        vcs,
        data.with.n,
        data.with.avg_size || '',
        data.with.avg_price || '',
        data.with.avg_age || '',
        data.without.n,
        data.without.avg_size || '',
        data.without.avg_price || '',
        data.without.avg_age || '',
        data.flat_adj || '',
        data.pct_adj ? data.pct_adj.toFixed(1) : ''
      ]);
    });

    const filename = `${jobData.job_name || 'job'}_additional_cards_analysis.csv`;
    downloadCsv(filename, headers, rows);
  };

  // ============ RENDER ADDITIONAL CARDS ANALYSIS ============
  const renderAdditionalCardsAnalysis = () => {
    return (
      <div>
        {/* Controls - Match condition analysis style */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 15px',
          backgroundColor: '#F0F9FF',
          borderRadius: '6px',
          marginBottom: '15px'
        }}>
          <div>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              margin: '0 0 4px 0',
              color: '#1E40AF'
            }}>
              Additional Cards Analysis
            </h3>
            <p style={{ fontSize: '12px', color: '#1E40AF', margin: '0' }}>
              {vendorType === 'BRT'
                ? 'Analyzing properties with multiple cards (Card 2, 3, 4, etc. vs Card 1/Main)'
                : 'Analyzing properties with additional buildings (Cards A-Z vs Card M/Main)'
              }
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              onClick={runAdditionalCardAnalysis}
              disabled={additionalWorking}
              style={{
                padding: '6px 16px',
                backgroundColor: additionalWorking ? '#E5E7EB' : '#3B82F6',
                color: additionalWorking ? '#9CA3AF' : 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: additionalWorking ? 'not-allowed' : 'pointer'
              }}
            >
              {additionalWorking ? 'Analyzing...' : 'Run Analysis'}
            </button>

            {additionalResults && (
              <button
                onClick={exportAdditionalResultsToCSV}
                className={CSV_BUTTON_CLASS}
              >
                <FileText size={14} /> Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Debug Info */}
        {console.log('🔍 additionalResults state:', additionalResults)}

        {/* Working Status */}
        {additionalWorking && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            backgroundColor: '#F3F4F6',
            borderRadius: '6px',
            marginBottom: '15px'
          }}>
            <div style={{ fontSize: '14px', color: '#6B7280' }}>
              Running additional card analysis...
            </div>
          </div>
        )}

        {/* Results */}
        {additionalResults && (
          <div>
            {/* Analysis Summary - Enhanced */}
            <div style={{
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#FEF3C7',
              borderRadius: '6px',
              border: '1px solid #FCD34D'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    Properties with Additional Cards
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#92400E' }}>
                    {additionalResults.overall.with.n}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    Properties without Additional Cards
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#92400E' }}>
                    {additionalResults.overall.without.n}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    Total Properties Analyzed
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#92400E' }}>
                    {additionalResults.summary?.totalPropertiesAnalyzed || 0}
                  </div>
                </div>
              </div>

              {/* Analysis Method Info */}
              <div style={{
                padding: '8px 12px',
                backgroundColor: 'rgba(146, 64, 14, 0.1)',
                borderRadius: '4px',
                fontSize: '12px',
                color: '#92400E'
              }}>
                <strong>Analysis Method:</strong> Properties grouped by base location, SFLA summed across all cards.
                {vendorType === 'BRT'
                  ? ' Additional = Cards 2, 3, 4+ (excluding Card 1 and Main)'
                  : ' Additional = Cards A-Z (excluding Card M/Main)'
                }
              </div>
            </div>

            {/* VCS Analysis Table */}
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
                      With Cards (n)
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Avg Total SFLA
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Avg Price
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }}>
                      Without Cards (n)
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Avg SFLA
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: '600' }}>
                      Avg Price
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
                  {Object.entries(additionalResults.byVCS || {}).map(([vcs, data], idx) => (
                    <tr key={vcs} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '500' }}>
                        {vcs}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                        {data.with.n}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {data.with.avg_size ? `${data.with.avg_size.toLocaleString()} sf` : '-'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {data.with.avg_price ? formatCurrency(data.with.avg_price) : '-'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>
                        {data.without.n}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                        {data.without.avg_size ? `${data.without.avg_size.toLocaleString()} sf` : '-'}
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
        {!additionalResults && !additionalWorking && (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#F9FAFB',
            borderRadius: '6px',
            color: '#6B7280'
          }}>
            <div style={{ fontSize: '14px' }}>
              Additional card analysis will run automatically when data is loaded.
            </div>
            <div style={{ fontSize: '12px', marginTop: '8px' }}>
              Properties with multiple cards (A cards, Card 2+) will be compared to single-card properties.
            </div>
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
