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
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);
  const [sortField, setSortField] = useState('new_vcs'); // Default sort by VCS
  const [sortDirection, setSortDirection] = useState('asc');

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
  const runAdditionalCardsAnalysis = () => {
    console.log('🔄 Running Additional Cards Analysis...');
    console.log('Vendor Type:', vendorType);
    console.log('Total Properties:', properties?.length);

    if (!properties || properties.length === 0) {
      console.log('❌ No property records available');
      setAdditionalResults(null);
      return;
    }

    try {
      // Filter for properties with additional cards based on vendor type
      const additionalCardProperties = properties.filter(prop => {
        const card = prop.property_addl_card || prop.additional_card || '';

        if (vendorType === 'BRT' || vendorType === 'brt') {
          // BRT: Cards 2, 3, 4, etc. (numeric > 1, excluding 'M' and '1')
          const cardNum = parseInt(card);
          return !isNaN(cardNum) && cardNum > 1;
        } else if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
          // Microsystems: Cards A-Z (excluding 'M' which is Main)
          const cardUpper = card.toString().trim().toUpperCase();
          return cardUpper && cardUpper !== 'M' && cardUpper !== 'MAIN' && /^[A-Z]$/.test(cardUpper);
        }
        return false;
      });

      console.log(`✅ Found ${additionalCardProperties.length} properties with additional cards`);

      // Group ALL properties by base location (for counting purposes)
      const allPropertyGroups = new Map();
      properties.forEach(prop => {
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
        if (!allPropertyGroups.has(baseKey)) {
          allPropertyGroups.set(baseKey, []);
        }
        allPropertyGroups.get(baseKey).push(prop);
      });

      // Get properties with valid sales data for impact analysis
      const validPropsForAnalysis = properties.filter(p =>
        p.values_norm_time &&
        p.values_norm_time > 0 &&
        (p.new_vcs || p.property_vcs)
      );

      // Group properties with valid sales data by base location (for impact calculations)
      const validPropertyGroups = new Map();
      validPropsForAnalysis.forEach(prop => {
        const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;
        if (!validPropertyGroups.has(baseKey)) {
          validPropertyGroups.set(baseKey, []);
        }
        validPropertyGroups.get(baseKey).push(prop);
      });

      // Function to check if a property has additional cards
      const hasAdditionalCards = (prop) => {
        const card = prop.property_addl_card || prop.additional_card || '';
        if (vendorType === 'BRT' || vendorType === 'brt') {
          const cardNum = parseInt(card);
          return !isNaN(cardNum) && cardNum > 1;
        } else if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
          const cardUpper = card.toString().trim().toUpperCase();
          return cardUpper && cardUpper !== 'M' && cardUpper !== 'MAIN' && /^[A-Z]$/.test(cardUpper);
        }
        return false;
      };

      // Count ALL properties with and without additional cards (for summary stats)
      const allGroupsWithCards = [];
      const allGroupsWithoutCards = [];

      allPropertyGroups.forEach((props, baseKey) => {
        const hasAdditional = props.some(hasAdditionalCards);
        if (hasAdditional) {
          allGroupsWithCards.push(props);
        } else {
          allGroupsWithoutCards.push(props);
        }
      });

      // Separate VALID properties into groups (for impact analysis)
      const groupsWithCards = [];
      const groupsWithoutCards = [];

      validPropertyGroups.forEach((props, baseKey) => {
        const hasAdditional = props.some(hasAdditionalCards);
        if (hasAdditional) {
          groupsWithCards.push(props);
        } else {
          groupsWithoutCards.push(props);
        }
      });

      // Analyze by VCS
      const byVCS = {};

      // Process groups with additional cards
      groupsWithCards.forEach(group => {
        const vcs = group[0].new_vcs || group[0].property_vcs;
        if (!vcs) return;

        if (!byVCS[vcs]) {
          byVCS[vcs] = {
            with_cards: [],
            without_cards: []
          };
        }

        // Calculate group metrics
        const validProps = group.filter(p => p.values_norm_time && p.values_norm_time > 0);
        if (validProps.length > 0) {
          const maxNormTime = Math.max(...validProps.map(p => p.values_norm_time));

          // Sum SFLA across all cards in the group (main + additional)
          const totalSFLA = group.reduce((sum, p) => {
            const sfla = parseInt(p.asset_sfla) || 0;
            return sum + sfla;
          }, 0);

          // Calculate average year built across all cards in the group
          const validYears = group.filter(p => {
            const year = parseInt(p.asset_year_built);
            return year && year > 1800 && year <= new Date().getFullYear();
          });
          const avgYearBuilt = validYears.length > 0 ?
            Math.round(validYears.reduce((sum, p) => sum + parseInt(p.asset_year_built), 0) / validYears.length) : null;

          byVCS[vcs].with_cards.push({
            norm_time: maxNormTime,
            total_sfla: totalSFLA,
            avg_year_built: avgYearBuilt,
            property_count: group.length
          });
        }
      });

      // Process groups without additional cards
      groupsWithoutCards.forEach(group => {
        const vcs = group[0].new_vcs || group[0].property_vcs;
        if (!vcs) return;

        if (!byVCS[vcs]) {
          byVCS[vcs] = {
            with_cards: [],
            without_cards: []
          };
        }

        // Calculate metrics for properties without additional cards
        const normTime = group[0].values_norm_time;
        if (normTime && normTime > 0) {
          const sfla = parseInt(group[0].asset_sfla) || 0;
          const year = parseInt(group[0].asset_year_built);
          const yearBuilt = year && year > 1800 && year <= new Date().getFullYear() ? year : null;

          byVCS[vcs].without_cards.push({
            norm_time: normTime,
            sfla: sfla,
            year_built: yearBuilt
          });
        }
      });

      // Count ALL properties by VCS (for display counts, not impact calculations)
      const allVCSCounts = {};
      allGroupsWithCards.forEach(group => {
        const vcs = group[0].new_vcs || group[0].property_vcs;
        if (!vcs) return;
        if (!allVCSCounts[vcs]) {
          allVCSCounts[vcs] = { with_cards: 0, without_cards: 0 };
        }
        allVCSCounts[vcs].with_cards += 1;
      });

      allGroupsWithoutCards.forEach(group => {
        const vcs = group[0].new_vcs || group[0].property_vcs;
        if (!vcs) return;
        if (!allVCSCounts[vcs]) {
          allVCSCounts[vcs] = { with_cards: 0, without_cards: 0 };
        }
        allVCSCounts[vcs].without_cards += 1;
      });

      // Calculate statistics for each VCS
      const results = {
        byVCS: {},
        summary: {
          vendorType,
          totalPropertiesAnalyzed: allPropertyGroups.size,
          propertiesWithCards: allGroupsWithCards.length,
          propertiesWithoutCards: allGroupsWithoutCards.length
        },
        additionalCardsList: additionalCardProperties.sort((a, b) => {
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
      const allVCSKeys = new Set([...Object.keys(byVCS), ...Object.keys(allVCSCounts)]);

      allVCSKeys.forEach(vcs => {
        const data = byVCS[vcs] || { with_cards: [], without_cards: [] };
        // Calculate WITH cards metrics
        const withNormTimes = data.with_cards.map(d => d.norm_time);
        const withAvgNormTime = withNormTimes.length > 0
          ? withNormTimes.reduce((sum, val) => sum + val, 0) / withNormTimes.length
          : null;

        const withTotalSFLA = data.with_cards.reduce((sum, d) => sum + d.total_sfla, 0);

        const withValidYears = data.with_cards.filter(d => d.avg_year_built);
        const withAvgYearBuilt = withValidYears.length > 0
          ? withValidYears.reduce((sum, d) => sum + d.avg_year_built, 0) / withValidYears.length
          : null;

        // Calculate Year Built and SFLA for ALL properties with additional cards (not just those with sales)
        const allWithCardsGroups = allGroupsWithCards.filter(group => {
          const groupVcs = group[0].new_vcs || group[0].property_vcs;
          return groupVcs === vcs;
        });

        let allWithTotalSFLA = 0;
        let allWithYearBuiltSum = 0;
        let allWithYearBuiltCount = 0;

        allWithCardsGroups.forEach(group => {
          // Sum SFLA across all cards in each group
          const groupSFLA = group.reduce((sum, p) => sum + (parseInt(p.asset_sfla) || 0), 0);
          allWithTotalSFLA += groupSFLA;

          // Average year built for this group
          const validYears = group.filter(p => {
            const year = parseInt(p.asset_year_built);
            return year && year > 1800 && year <= new Date().getFullYear();
          });
          if (validYears.length > 0) {
            const groupAvgYear = validYears.reduce((sum, p) => sum + parseInt(p.asset_year_built), 0) / validYears.length;
            allWithYearBuiltSum += groupAvgYear;
            allWithYearBuiltCount++;
          }
        });

        const allWithAvgYearBuilt = allWithYearBuiltCount > 0 ? allWithYearBuiltSum / allWithYearBuiltCount : null;

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
          ? withoutValidYears.reduce((sum, d) => sum + d.year_built, 0) / withoutValidYears.length
          : null;

        // Calculate Year Built and SFLA for ALL properties without additional cards
        const allWithoutCardsGroups = allGroupsWithoutCards.filter(group => {
          const groupVcs = group[0].new_vcs || group[0].property_vcs;
          return groupVcs === vcs;
        });

        let allWithoutTotalSFLA = 0;
        let allWithoutYearBuiltSum = 0;
        let allWithoutYearBuiltCount = 0;

        allWithoutCardsGroups.forEach(group => {
          const prop = group[0]; // Single card properties
          const sfla = parseInt(prop.asset_sfla) || 0;
          allWithoutTotalSFLA += sfla;

          const year = parseInt(prop.asset_year_built);
          if (year && year > 1800 && year <= new Date().getFullYear()) {
            allWithoutYearBuiltSum += year;
            allWithoutYearBuiltCount++;
          }
        });

        const allWithoutAvgSFLA = allWithoutCardsGroups.length > 0 ? allWithoutTotalSFLA / allWithoutCardsGroups.length : null;
        const allWithoutAvgYearBuilt = allWithoutYearBuiltCount > 0 ? allWithoutYearBuiltSum / allWithoutYearBuiltCount : null;

        // Calculate adjustments
        let flatAdj = null;
        let pctAdj = null;
        let jimAdjusted = null;

        if (withAvgNormTime !== null && withoutAvgNormTime !== null && withoutAvgNormTime > 0) {
          // Jim's size normalization formula: Adjust "without cards" value to "with cards" size
          const withAvgSFLA = allWithTotalSFLA && allWithCardsGroups.length > 0 ?
            allWithTotalSFLA / allWithCardsGroups.length : null;

          if (withAvgSFLA && allWithoutAvgSFLA && withAvgSFLA > 0 && allWithoutAvgSFLA > 0) {
            jimAdjusted = sizeNormalize(withoutAvgNormTime, allWithoutAvgSFLA, withAvgSFLA);
          } else {
            jimAdjusted = withoutAvgNormTime;
          }

          flatAdj = Math.round(withAvgNormTime - jimAdjusted);
          pctAdj = jimAdjusted > 0 ? ((withAvgNormTime - jimAdjusted) / jimAdjusted) * 100 : 0;
        }

        results.byVCS[vcs] = {
          with: {
            n: allVCSCounts[vcs]?.with_cards || 0,
            total_sfla: allWithTotalSFLA || 0,
            avg_year_built: allWithAvgYearBuilt ? Math.round(allWithAvgYearBuilt) : null,
            avg_norm_time: withAvgNormTime ? Math.round(withAvgNormTime) : null
          },
          without: {
            n: allVCSCounts[vcs]?.without_cards || 0,
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
        totalAdditionalCards: additionalCardProperties.length,
        vcsCount: Object.keys(results.byVCS).length,
        propertiesWithCards: results.summary.propertiesWithCards,
        propertiesWithoutCards: results.summary.propertiesWithoutCards,
        sampleVCSData: Object.entries(results.byVCS).slice(0, 2)
      });

      // Debug: Check sample property data
      console.log('🔍 Sample Properties (first 5):', properties.slice(0, 5).map(p => ({
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

  // Export function for the CSV
  const exportAdditionalCardsCSV = () => {
    if (!additionalResults || !additionalResults.additionalCardsList) {
      alert('No additional cards data to export');
      return;
    }

    let csv = 'Address,Card,VCS,Class,Type/Use,Sales Price,SFLA,Year Built,Norm Time\\n';

    additionalResults.additionalCardsList.forEach(prop => {
      csv += `"${prop.property_location || ''}",`;
      csv += `"${prop.property_addl_card || prop.additional_card || ''}",`;
      csv += `"${prop.new_vcs || prop.property_vcs || ''}",`;
      csv += `"${prop.property_m4_class || prop.property_cama_class || ''}",`;
      csv += `"${prop.asset_type_use || ''}",`;
      csv += `"${prop.sales_price || ''}",`;
      csv += `"${prop.asset_sfla || ''}",`;
      csv += `"${prop.asset_year_built || ''}",`;
      csv += `"${prop.values_norm_time || ''}"}\\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Additional_Cards_${jobData?.job_name || 'Analysis'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
              <button
                onClick={exportAdditionalCardsCSV}
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
                Export CSV
              </button>
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
                  <span style={{ color: '#64748B', fontWeight: '500' }}>Total Dollar Impact: </span>
                  <span style={{ fontWeight: '600', color: '#059669' }}>
                    {(() => {
                      const totalImpact = Object.values(additionalResults.byVCS || {}).reduce((sum, data) => {
                        return sum + (data.flat_adj || 0);
                      }, 0);
                      return totalImpact !== 0 ? formatCurrency(totalImpact) : 'No valid comparisons';
                    })()}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#64748B', fontWeight: '500' }}>Average % Impact: </span>
                  <span style={{ fontWeight: '600', color: '#059669' }}>
                    {(() => {
                      const impacts = Object.values(additionalResults.byVCS || {}).filter(data => data.pct_adj !== null && data.pct_adj !== undefined);
                      if (impacts.length === 0) return 'No valid comparisons';
                      const avgPct = impacts.reduce((sum, data) => sum + data.pct_adj, 0) / impacts.length;
                      return `${avgPct.toFixed(1)}%`;
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {/* VCS Analysis Table */}
            <div style={{
              border: '1px solid #E5E7EB',
              borderRadius: '6px',
              overflow: 'auto',
              marginBottom: '30px'
            }}>
              <div style={{
                padding: '12px 15px',
                backgroundColor: '#F9FAFB',
                borderBottom: '1px solid #E5E7EB'
              }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', margin: '0' }}>
                  Impact Analysis by VCS (Using Normalized Time Values)
                </h4>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F3F4F6' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>VCS</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>With Cards (n)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Sum SFLA</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Year Built</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Avg Norm Time</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Without Cards (n)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Avg SFLA</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Year Built</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Avg Norm Time</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Adjusted</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Impact ($)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>Impact (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(additionalResults.byVCS || {}).map(([vcs, data], idx) => (
                    <tr key={vcs} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#F9FAFB' }}>
                      <td style={{ padding: '6px 8px', fontSize: '12px', fontWeight: '500' }}>{vcs}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{data.with.n}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.with.total_sfla ? data.with.total_sfla.toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.with.avg_year_built || '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.with.avg_norm_time ? formatCurrency(data.with.avg_norm_time) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{data.without.n}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.without.avg_sfla ? data.without.avg_sfla.toLocaleString() : '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.without.avg_year_built || '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px' }}>
                        {data.without.avg_norm_time ? formatCurrency(data.without.avg_norm_time) : '-'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '12px', fontWeight: '500' }}>
                        {data.adjusted ? formatCurrency(data.adjusted) : '-'}
                      </td>
                      <td style={{
                        padding: '6px 8px',
                        textAlign: 'right',
                        fontSize: '12px',
                        color: data.flat_adj > 0 ? '#059669' : data.flat_adj < 0 ? '#DC2626' : '#6B7280'
                      }}>
                        {data.flat_adj ? formatCurrency(data.flat_adj) : '-'}
                      </td>
                      <td style={{
                        padding: '6px 8px',
                        textAlign: 'right',
                        fontSize: '12px',
                        color: data.pct_adj > 0 ? '#059669' : data.pct_adj < 0 ? '#DC2626' : '#6B7280'
                      }}>
                        {data.pct_adj ? `${data.pct_adj.toFixed(1)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
                <span style={{ fontSize: '12px', color: '#6B7280', fontWeight: '500' }}>
                  ({(additionalResults.additionalCardsList || []).length} cards)
                </span>
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
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px' }}>
                            {prop.asset_sfla ? parseInt(prop.asset_sfla).toLocaleString() : '-'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: '13px' }}>{prop.asset_year_built || '-'}</td>
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
