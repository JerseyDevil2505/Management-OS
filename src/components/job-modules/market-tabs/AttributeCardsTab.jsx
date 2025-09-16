import React, { useState, useMemo, useEffect } from 'react';
import { Layers, FileText } from 'lucide-react';
import './sharedTabNav.css';
import { supabase, propertyService } from '../../../lib/supabaseClient';

const CSV_BUTTON_CLASS = 'inline-flex items-center gap-2 px-3 py-1.5 border rounded bg-white text-sm text-gray-700 hover:bg-gray-50';

// Jim's size normalization formula
function sizeNormalize(salePrice, saleSize, targetSize) {
  if (!saleSize || saleSize <= 0 || !salePrice) return salePrice || null;
  if (!targetSize || targetSize <= 0) return salePrice;
  const repl = salePrice;
  const adj = ((targetSize - saleSize) * ((salePrice / saleSize) * 0.50));
  return Math.round(repl + adj);
}

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

  const [active, setActive] = useState('condition');

  // Condition analysis state - simplified and dynamic
  const [typeUseFilter, setTypeUseFilter] = useState('1'); // Default to Single Family
  const [conditionData, setConditionData] = useState(null);
  const [conditionAnalysis, setConditionAnalysis] = useState({});
  const [loading, setLoading] = useState(false);
  const [availableConditions, setAvailableConditions] = useState({ exterior: [], interior: [] });

  // Custom attribute UI state
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);

  // Additional cards
  const [additionalWorking, setAdditionalWorking] = useState(false);
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);

  // Get Type/Use options (exact copy from Land Valuation)
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

  // Helper function to get property type/use from various field names
  const getPropertyTypeUse = (property) => {
    return property.asset_type_use ||
           property.asset_typeuse ||
           property.typeuse ||
           property.type_use ||
           '';
  };

  // Helper function to get property condition from various field names
  const getPropertyCondition = (property, type) => {
    if (type === 'exterior') {
      return property.asset_ext_cond ||
             property.asset_exterior_condition ||
             property.ext_cond ||
             property.exterior_condition ||
             '';
    } else {
      return property.asset_int_cond ||
             property.asset_interior_condition ||
             property.int_cond ||
             property.interior_condition ||
             '';
    }
  };

  // Get available conditions from parsed_code_definitions
  const getAvailableConditions = () => {
    const codeDefs = jobData?.parsed_code_definitions || {};
    const conditions = { exterior: [], interior: [] };

    console.log('🔍 Getting available conditions for vendor:', vendorType);
    console.log('📊 Available code definitions sections:', Object.keys(codeDefs));

    if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
      // Microsystems: 490 = exterior, 491 = interior
      const extSection = codeDefs['490'] || {};
      const intSection = codeDefs['491'] || {};

      console.log('🏗️ Microsystems exterior section 490:', extSection);
      console.log('🏗️ Microsystems interior section 491:', intSection);

      Object.entries(extSection).forEach(([code, info]) => {
        if (code && code !== '00' && code !== '0') {
          conditions.exterior.push({
            code,
            description: info.description || info.name || code,
            normalized: (info.description || info.name || code)?.toUpperCase().replace(/\s+/g, '_')
          });
        }
      });

      Object.entries(intSection).forEach(([code, info]) => {
        if (code && code !== '00' && code !== '0') {
          conditions.interior.push({
            code,
            description: info.description || info.name || code,
            normalized: (info.description || info.name || code)?.toUpperCase().replace(/\s+/g, '_')
          });
        }
      });
    } else {
      // BRT: Section 60 for both exterior and interior
      const section = codeDefs['60'] || {};

      console.log('🏗️ BRT section 60:', section);

      Object.entries(section).forEach(([code, info]) => {
        if (code && code !== '00' && code !== '0') {
          const condition = {
            code,
            description: info.description || info.name || code,
            normalized: (info.description || info.name || code)?.toUpperCase().replace(/\s+/g, '_')
          };
          conditions.exterior.push(condition);
          conditions.interior.push(condition);
        }
      });
    }

    console.log('✅ Found conditions:', conditions);
    return conditions;
  };

  // Normalize condition codes using parsed_code_definitions
  const normalizeCondition = (condCode, conditionType = 'exterior') => {
    if (!condCode || condCode === '00') return null;

    const cleanCode = condCode.toString().trim();
    const codeDefs = jobData?.parsed_code_definitions || {};

    if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
      const sectionCode = conditionType === 'exterior' ? '490' : '491';
      const conditionMap = codeDefs[sectionCode] || {};
      const codeKey = cleanCode.toUpperCase();
      const codeInfo = conditionMap[codeKey];
      return codeInfo?.description || codeInfo?.name || null;
    } else {
      const conditionSection = codeDefs['60'] || {};
      const codeInfo = conditionSection[cleanCode];
      return codeInfo?.description || codeInfo?.name || null;
    }
  };

  // Type/Use filter logic (exact from Land Valuation)
  const applyTypeUseFilter = (properties, filterValue) => {
    if (!filterValue || filterValue === 'all') return properties;

    return properties.filter(p => {
      const typeUse = getPropertyTypeUse(p).toString().trim();
      const isEmpty = !typeUse || typeUse === '';

      if (filterValue === 'all_residential') {
        return isEmpty || ['1','2','3','4','5','6'].some(prefix => typeUse.startsWith(prefix));
      } else if (filterValue === '1') {
        return isEmpty || typeUse.startsWith('1');
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

  // Load data on mount
  useEffect(() => {
    loadConditionData();
  }, [jobData?.id, typeUseFilter]);

  // Load available conditions from parsed_code_definitions
  useEffect(() => {
    if (jobData?.parsed_code_definitions) {
      const conditions = getAvailableConditions();
      setAvailableConditions(conditions);
      console.log('📋 Available conditions:', conditions);
    }
  }, [jobData?.parsed_code_definitions, vendorType]);

  // Load condition data from values_norm_time
  const loadConditionData = async () => {
    if (!jobData?.id) return;
    
    setLoading(true);
    try {
      // Get all values_norm_time items for this job
      const { data: marketData, error } = await supabase
        .from('property_market_analysis')
        .select('*')
        .eq('job_id', jobData.id)
        .not('values_norm_time', 'is', null)
        .gt('values_norm_time', 0);

      if (error) throw error;

      // Merge with properties data
      const propertiesMap = {};
      properties.forEach(p => {
        propertiesMap[p.property_composite_key] = p;
      });

      const mergedData = marketData
        .map(m => ({
          ...propertiesMap[m.property_composite_key],
          ...m
        }))
        .filter(p => p.property_composite_key); // Ensure we have property data

      // Apply type/use filter
      const filteredData = applyTypeUseFilter(mergedData, typeUseFilter);

      console.log('📊 Loaded condition data:', {
        totalMarketData: marketData.length,
        mergedProperties: mergedData.length,
        afterTypeFilter: filteredData.length,
        typeFilter: typeUseFilter
      });

      setConditionData(filteredData);
      
      // Analyze conditions
      analyzeConditions(filteredData);

    } catch (error) {
      console.error('Error loading condition data:', error);
    }
    setLoading(false);
  };

  // Analyze conditions similar to land valuation method 2
  const analyzeConditions = (data) => {
    if (!data || data.length === 0) return;

    const analysis = {
      exterior: {},
      interior: {},
      summary: { exterior: {}, interior: {} }
    };

    // Group by VCS
    const vcsBuckets = {};
    data.forEach(prop => {
      const vcs = prop.new_vcs || prop.property_vcs || prop.vcs || prop.asset_vcs || 'NO_VCS';
      if (!vcsBuckets[vcs]) {
        vcsBuckets[vcs] = [];
      }
      vcsBuckets[vcs].push(prop);
    });

    // Analyze each VCS
    Object.keys(vcsBuckets).forEach(vcs => {
      const vcsProperties = vcsBuckets[vcs];
      
      analysis.exterior[vcs] = analyzeVCSConditions(vcsProperties, 'exterior');
      analysis.interior[vcs] = analyzeVCSConditions(vcsProperties, 'interior');
    });

    // Calculate overall summary (similar to Method 2 Summary)
    calculateConditionSummary(analysis);

    setConditionAnalysis(analysis);
  };

  // Analyze conditions for a single VCS (similar to bracket analysis)
  const analyzeVCSConditions = (properties, conditionType) => {
    const conditionBuckets = {};
    
    // Group properties by condition
    properties.forEach(prop => {
      const conditionCode = getPropertyCondition(prop, conditionType);
      const condition = normalizeCondition(conditionCode, conditionType);
      
      if (!condition) return;

      if (!conditionBuckets[condition]) {
        conditionBuckets[condition] = [];
      }
      conditionBuckets[condition].push(prop);
    });

    // Calculate statistics for each condition
    const conditionStats = {};
    Object.keys(conditionBuckets).forEach(condition => {
      const bucket = conditionBuckets[condition];
      
      const prices = bucket.map(p => p.values_norm_time).filter(Boolean);
      const sizes = bucket.map(p => p.asset_sfla || p.values_norm_size).filter(Boolean);
      const ages = bucket.map(p => {
        const yearBuilt = p.asset_year_built || p.property_year_built;
        return yearBuilt ? new Date().getFullYear() - yearBuilt : null;
      }).filter(Boolean);

      if (prices.length > 0) {
        conditionStats[condition] = {
          count: bucket.length,
          avgPrice: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          avgSize: sizes.length > 0 ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
          avgAge: ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
          properties: bucket
        };
      }
    });

    // Find baseline (AVERAGE condition or most common)
    let baseline = conditionStats['AVERAGE'] || conditionStats['Average'];
    if (!baseline) {
      // Find condition with most properties as baseline
      const sortedConditions = Object.keys(conditionStats).sort((a, b) => 
        conditionStats[b].count - conditionStats[a].count
      );
      baseline = conditionStats[sortedConditions[0]];
    }

    // Calculate adjustments similar to method 2 brackets
    if (baseline && baseline.avgSize > 0) {
      Object.keys(conditionStats).forEach(condition => {
        const stats = conditionStats[condition];
        
        // Apply size normalization using Jim's formula
        const normalizedPrices = stats.properties.map(prop => 
          sizeNormalize(prop.values_norm_time, prop.asset_sfla || prop.values_norm_size || 0, baseline.avgSize)
        );
        
        stats.normalizedPrice = Math.round(normalizedPrices.reduce((a, b) => a + b, 0) / normalizedPrices.length);
        
        // Calculate percentage difference from baseline
        if (baseline.normalizedPrice) {
          stats.percentDiff = ((stats.normalizedPrice - baseline.normalizedPrice) / baseline.normalizedPrice * 100);
        } else {
          stats.percentDiff = 0;
        }
      });
      
      // Set baseline normalization
      if (baseline) {
        baseline.normalizedPrice = baseline.avgPrice;
        baseline.percentDiff = 0;
      }
    }

    return {
      conditions: conditionStats,
      baseline: baseline ? Object.keys(conditionStats).find(k => conditionStats[k] === baseline) : null,
      totalProperties: properties.length
    };
  };

  // Calculate overall condition summary
  const calculateConditionSummary = (analysis) => {
    ['exterior', 'interior'].forEach(type => {
      const summary = {};
      const allConditions = new Set();
      
      // Collect all conditions across VCS
      Object.values(analysis[type]).forEach(vcsData => {
        Object.keys(vcsData.conditions || {}).forEach(condition => {
          allConditions.add(condition);
        });
      });

      // Calculate weighted averages for each condition
      allConditions.forEach(condition => {
        let totalAdjustedPrice = 0;
        let totalCount = 0;
        let totalBaselinePrice = 0;
        let totalBaselineCount = 0;

        Object.values(analysis[type]).forEach(vcsData => {
          const conditionData = vcsData.conditions[condition];
          const baselineData = vcsData.conditions[vcsData.baseline];
          
          if (conditionData && baselineData) {
            totalAdjustedPrice += (conditionData.normalizedPrice || conditionData.avgPrice) * conditionData.count;
            totalCount += conditionData.count;
            totalBaselinePrice += (baselineData.normalizedPrice || baselineData.avgPrice) * baselineData.count;
            totalBaselineCount += baselineData.count;
          }
        });

        if (totalCount > 0 && totalBaselineCount > 0) {
          const avgAdjustedPrice = totalAdjustedPrice / totalCount;
          const avgBaselinePrice = totalBaselinePrice / totalBaselineCount;
          
          summary[condition] = {
            count: totalCount,
            avgPrice: Math.round(avgAdjustedPrice),
            percentDiff: ((avgAdjustedPrice - avgBaselinePrice) / avgBaselinePrice * 100)
          };
        }
      });

      analysis.summary[type] = summary;
    });
  };

  // Discover raw fields once
  useEffect(() => {
    let mounted = true;
    async function discover() {
      if (!jobData?.id || !properties || properties.length === 0) return;
      try {
        const sample = properties[0];
        const raw = await propertyService.getRawDataForProperty(sample.job_id, sample.property_composite_key);
        if (!mounted) return;
        if (raw && typeof raw === 'object') {
          const keys = Object.keys(raw).sort();
          setRawFields(keys);
          if (!selectedRawField && keys.length) setSelectedRawField(keys[0]);
        }
      } catch (e) {
        console.error('discover raw fields', e);
      }
    }
    discover();
    return () => { mounted = false; };
  }, [jobData?.id, properties]);

  // Save helper
  const saveRollupToDB = async (jobId, payloadObj) => {
    try {
      const { error } = await supabase.from('market_land_valuation').update(payloadObj).eq('job_id', jobId);
      if (error) {
        const ins = await supabase.from('market_land_valuation').insert({ job_id: jobId, ...payloadObj });
        if (ins.error) throw ins.error;
      }
      onUpdateJobCache && onUpdateJobCache();
    } catch (e) {
      console.error('saveRollupToDB', e);
      throw e;
    }
  };

  // Save condition analysis
  const saveConditionAnalysis = async () => {
    try {
      const rollup = {
        condition_analysis: conditionAnalysis,
        available_conditions: availableConditions,
        type_use_filter: typeUseFilter,
        vendor_type: vendorType,
        generated_at: new Date().toISOString()
      };

      await saveRollupToDB(jobData.id, { condition_analysis_rollup: rollup });
      console.log('✅ Condition analysis saved');
    } catch (e) {
      console.error('Failed to save condition analysis:', e);
    }
  };

  // Custom attribute analysis enhanced to apply size-normalization when group sizes differ
  const runCustomAttributeAnalysis = async () => {
    if (!selectedRawField || !jobData?.id) return;
    setCustomWorking(true);
    try {
      const valid = conditionData || [];
      // We'll need raw values - batch fetch raw using propertyService.getRawDataForProperty
      const lookup = new Map();
      const chunk = 500;
      for (let i=0;i<valid.length;i+=chunk) {
        const slice = valid.slice(i,i+chunk);
        const resolved = await Promise.all(slice.map(p => propertyService.getRawDataForProperty(p.job_id, p.property_composite_key).then(raw=>({p,raw}), ()=>({p,raw:null}))));
        resolved.forEach(({p,raw}) => lookup.set(p.property_composite_key, { p, raw }));
      }

      const withList = [];
      const withoutList = [];

      lookup.forEach(({p,raw}) => {
        const rawVal = raw ? (raw[selectedRawField] ?? raw[selectedRawField.toUpperCase()]) : undefined;
        const has = (() => {
          if (matchValue === '') return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';
          try { if (String(rawVal).trim().toUpperCase() === String(matchValue).trim().toUpperCase()) return true; } catch(e){}
          const a = Number(rawVal); const b = Number(matchValue);
          if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a-b) < 1e-6) return true;
          return false;
        })();
        if (has) withList.push(p); else withoutList.push(p);
      });

      const agg = (arr) => {
        const n = arr.length;
        const total = arr.reduce((s,p)=>s + Number(p.values_norm_time || 0),0);
        const totalSize = arr.reduce((s,p)=>s + Number(p.asset_sfla || 0),0);
        return { n, avg_price: n>0?Math.round(total/n):null, avg_size: n>0?Math.round(totalSize/n):null };
      };

      const w = agg(withList);
      const wo = agg(withoutList);

      // Apply size normalization if sizes differ by >10%
      if (w.avg_price != null && wo.avg_price != null && w.avg_size && wo.avg_size) {
        const diff = Math.abs(w.avg_size - wo.avg_size) / ((w.avg_size + wo.avg_size)/2);
        if (diff > 0.10) {
          // normalize withList prices to withoutList avg_size for fair comparison
          const adjustedWithPrices = withList.map(p => sizeNormalize(Number(p.values_norm_time || 0), Number(p.asset_sfla || 0) || 0, wo.avg_size || 0));
          const adjustedAvgWith = adjustedWithPrices.length ? Math.round(adjustedWithPrices.reduce((a,b)=>a+(b||0),0)/adjustedWithPrices.length) : w.avg_price;
          w.adj_avg_price = adjustedAvgWith;
        }
      }

      const flat = (w.adj_avg_price || w.avg_price || 0) - (wo.avg_price || 0);
      const pct = (wo.avg_price && wo.avg_price !== 0) ? (flat / wo.avg_price) * 100 : null;

      const results = { field: selectedRawField, matchValue, overall: { with: w, without: wo, flat_adj: Math.round(flat), pct_adj: pct != null ? Number(pct.toFixed(1)) : null } };

      // group by VCS as well
      const byVCS = {};
      lookup.forEach(({p,raw}) => {
        const vcs = p.new_vcs || p.property_vcs || 'UNSPEC';
        byVCS[vcs] = byVCS[vcs] || { with: [], without: [] };
        const rawVal = raw ? (raw[selectedRawField] ?? raw[selectedRawField.toUpperCase()]) : undefined;
        const has = (() => {
          if (matchValue === '') return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';
          try { if (String(rawVal).trim().toUpperCase() === String(matchValue).trim().toUpperCase()) return true; } catch(e){}
          const a = Number(rawVal); const b = Number(matchValue);
          if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a-b) < 1e-6) return true;
          return false;
        })();
        if (has) byVCS[vcs].with.push(p); else byVCS[vcs].without.push(p);
      });

      const byVCSResults = {};
      Object.keys(byVCS).forEach(v => {
        const wa = agg(byVCS[v].with);
        const woa = agg(byVCS[v].without);
        byVCSResults[v] = { with: wa, without: woa };
      });

      const rollup = { results, byVCS: byVCSResults, generated_at: new Date().toISOString() };
      setCustomResults(rollup);
      await saveRollupToDB(jobData.id, { custom_attribute_rollup: rollup });

    } catch (e) {
      console.error('runCustomAttributeAnalysis', e);
    }
    setCustomWorking(false);
  };

  // Additional card analysis
  const runAdditionalCardAnalysis = async () => {
    setAdditionalWorking(true);
    try {
      const valid = conditionData || [];
      const lookup = new Map();
      const chunk = 500;
      for (let i=0;i<valid.length;i+=chunk) {
        const slice = valid.slice(i,i+chunk);
        const resolved = await Promise.all(slice.map(p => propertyService.getRawDataForProperty(p.job_id, p.property_composite_key).then(raw=>({p,raw}), ()=>({p,raw:null}))));
        resolved.forEach(({p,raw}) => lookup.set(p.property_composite_key, { p, raw }));
      }

      const byVCS = {};
      lookup.forEach(({p,raw}) => {
        const vcs = p.new_vcs || p.property_vcs || 'UNSPEC';
        byVCS[vcs] = byVCS[vcs] || { with_addl: [], without_addl: [] };
        // Detect additional cards
        let hasAddl = false;
        // BRT style: property_addl_card exists and not 'M' and not '1'
        if (p.property_addl_card) {
          const v = String(p.property_addl_card).trim().toUpperCase();
          if (v && v !== 'NONE' && v !== 'M' && v !== '1') hasAddl = true;
        }
        // or microsystems raw has building indicators: look for keys like 'BLDG2','Bldg2','BUILDING_2' or numeric BLDG count
        if (!hasAddl && raw && typeof raw === 'object') {
          const keys = Object.keys(raw).map(k=>k.toUpperCase());
          const bldgKeys = keys.filter(k => /BLDG|BLD|BUILDING/.test(k));
          if (bldgKeys.length) {
            for (const bk of bldgKeys) {
              const val = raw[bk] || raw[bk.toLowerCase()];
              if (val && Number(val) > 1) { hasAddl = true; break; }
              if (typeof val === 'string' && /BLDG\s*2|BLDG2|BLD2|2ND/.test(String(val).toUpperCase())) { hasAddl = true; break; }
            }
          }
        }

        if (hasAddl) byVCS[vcs].with_addl.push(p);
        else byVCS[vcs].without_addl.push(p);
      });

      // aggregate
      const aggStats = (arr) => {
        const n = arr.length;
        if (n === 0) return { n:0, avg_price:null, avg_size:null, avg_age:null };
        const totalPrice = arr.reduce((s,p)=>s + Number(p.values_norm_time || 0),0);
        const totalSize = arr.reduce((s,p)=>s + Number(p.asset_sfla || 0),0);
        const totalAge = arr.reduce((s,p)=>s + (p.asset_year_built ? (new Date().getFullYear() - Number(p.asset_year_built)) : 0),0);
        return { n, avg_price: Math.round(totalPrice/n), avg_size: Math.round(totalSize/n), avg_age: Math.round(totalAge/n) };
      };

      const vcsResults = {};
      Object.keys(byVCS).forEach(v => {
        const withStats = aggStats(byVCS[v].with_addl);
        const withoutStats = aggStats(byVCS[v].without_addl);
        const flat = (withStats.avg_price || 0) - (withoutStats.avg_price || 0);
        const pct = (withoutStats.avg_price && withoutStats.avg_price !== 0) ? (flat / withoutStats.avg_price) * 100 : null;
        vcsResults[v] = { with: withStats, without: withoutStats, flat_adj: Math.round(flat), pct_adj: pct != null ? Number(pct.toFixed(1)) : null };
      });

      const rollup = { byVCS: vcsResults, generated_at: new Date().toISOString() };
      setAdditionalResults(rollup);
      await saveRollupToDB(jobData.id, { additional_cards_rollup: rollup });

    } catch (e) {
      console.error('runAdditionalCardAnalysis', e);
    }
    setAdditionalWorking(false);
  };

  // Format helpers
  const formatPrice = (val) => val ? `$${val.toLocaleString()}` : '—';
  const formatPct = (val) => val ? `${val.toFixed(1)}%` : '—';

  // CSV export preparation
  const getConditionCsvData = (type) => {
    const headers = ['VCS'];
    const rows = [];
    
    if (!conditionAnalysis[type]) return { headers, rows };

    // Get all unique conditions
    const allConditions = new Set();
    Object.values(conditionAnalysis[type]).forEach(vcsData => {
      Object.keys(vcsData.conditions || {}).forEach(condition => {
        allConditions.add(condition);
      });
    });

    const conditionsList = Array.from(allConditions).sort();
    
    // Build headers
    conditionsList.forEach(condition => {
      headers.push(`${condition}_Count`, `${condition}_Price`, `${condition}_Size`, `${condition}_Age`, `${condition}_Norm_Price`, `${condition}_%_Diff`);
    });

    // Build rows
    Object.keys(conditionAnalysis[type]).forEach(vcs => {
      const vcsData = conditionAnalysis[type][vcs];
      const row = [vcs];
      
      conditionsList.forEach(condition => {
        const condData = vcsData.conditions[condition];
        if (condData) {
          row.push(
            condData.count,
            condData.avgPrice,
            condData.avgSize,
            condData.avgAge,
            condData.normalizedPrice || condData.avgPrice,
            condData.percentDiff ? condData.percentDiff.toFixed(1) : '0'
          );
        } else {
          row.push('', '', '', '', '', '');
        }
      });
      
      rows.push(row);
    });

    return { headers, rows };
  };

  // Custom CSV helpers
  const customCsvRows = useMemo(() => {
    if (!customResults) return [];
    const rows = [];
    rows.push(['Overall', customResults.results?.overall?.with?.n ?? '', customResults.results?.overall?.with?.avg_price ?? '', customResults.results?.overall?.without?.n ?? '', customResults.results?.overall?.without?.avg_price ?? '', customResults.results?.overall?.flat_adj ?? '', customResults.results?.overall?.pct_adj ?? '']);
    Object.keys(customResults.byVCS || {}).forEach(v => {
      const g = customResults.byVCS[v];
      rows.push([v, g.with.n, g.with.avg_price, g.without.n, g.without.avg_price]);
    });
    return rows;
  }, [customResults]);

  // Additional CSV helpers
  const additionalCsvRows = useMemo(() => {
    if (!additionalResults) return [];
    const rows = [];
    Object.keys(additionalResults.byVCS || {}).forEach(v => {
      const g = additionalResults.byVCS[v];
      rows.push([v, g.with.n, g.with.avg_size, g.with.avg_price, g.with.avg_age, g.without.n, g.without.avg_price, g.flat_adj, g.pct_adj]);
    });
    return rows;
  }, [additionalResults]);

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Attribute & Card Analytics</h2>
          <p className="text-gray-600">Condition, custom attribute, and additional card analysis using values_norm_time data.</p>
        </div>
        <div className="text-gray-400"><Layers size={36} /></div>
      </div>

      <div className="mt-6 mls-subtab-nav" role="tablist" aria-label="Attribute sub tabs">
        <button onClick={() => setActive('condition')} className={`mls-subtab-btn ${active === 'condition' ? 'mls-subtab-btn--active' : ''}`}>Condition Analysis</button>
        <button onClick={() => setActive('custom')} className={`mls-subtab-btn ${active === 'custom' ? 'mls-subtab-btn--active' : ''}`}>Custom Attribute Analysis</button>
        <button onClick={() => setActive('additional')} className={`mls-subtab-btn ${active === 'additional' ? 'mls-subtab-btn--active' : ''}`}>Additional Card Analysis</button>
      </div>

      <div className="mt-4">
        {active === 'condition' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Condition Analysis - VCS Cascade Design</h3>
              <div className="flex items-center gap-2">
                <button onClick={saveConditionAnalysis} className={CSV_BUTTON_CLASS}>Save Analysis</button>
                <button onClick={() => {
                  const extData = getConditionCsvData('exterior');
                  downloadCsv(`${jobData.job_name || 'job'}-condition-exterior.csv`, extData.headers, extData.rows);
                }} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Exterior CSV</button>
                <button onClick={() => {
                  const intData = getConditionCsvData('interior');
                  downloadCsv(`${jobData.job_name || 'job'}-condition-interior.csv`, intData.headers, intData.rows);
                }} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Interior CSV</button>
              </div>
            </div>

            {/* Filter Controls */}
            <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Type & Use:</span>
                <select
                  value={typeUseFilter}
                  onChange={(e) => setTypeUseFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  style={{ minWidth: '200px' }}
                >
                  {getTypeUseOptions().map(option => (
                    <option key={option.code} value={option.code}>
                      {option.description}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-xs text-gray-500">
                {conditionData ? `${conditionData.length} properties loaded` : 'Loading...'}
              </span>

              {availableConditions.exterior.length > 0 && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                  ✓ {availableConditions.exterior.length} exterior conditions available
                </span>
              )}
            </div>

            {loading && (
              <div className="text-center py-8">
                <div className="text-gray-500">Loading condition data...</div>
              </div>
            )}

            {!loading && conditionData && (
              <>
                {/* Exterior Condition Analysis */}
                <div className="mb-6">
                  <h4 className="font-medium mb-3">Exterior Condition Analysis - VCS Cascade View</h4>
                  <div className="overflow-auto border rounded">
                    <table className="min-w-full table-auto text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-left">
                          <th className="px-3 py-2 border font-semibold">VCS / Condition</th>
                          <th className="px-3 py-2 border font-semibold text-center">Count</th>
                          <th className="px-3 py-2 border font-semibold text-center">Avg Price</th>
                          <th className="px-3 py-2 border font-semibold text-center">Avg Size</th>
                          <th className="px-3 py-2 border font-semibold text-center">Norm Price</th>
                          <th className="px-3 py-2 border font-semibold text-center">% Impact</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(conditionAnalysis.exterior || {}).length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No exterior condition data found.</td></tr>
                        )}
                        {Object.entries(conditionAnalysis.exterior || {}).map(([vcs, vcsData], vcsIdx) => (
                          <React.Fragment key={vcs}>
                            {/* VCS Header Row */}
                            <tr className="bg-blue-50 font-semibold">
                              <td className="px-3 py-2 border font-bold text-blue-800">{vcs}</td>
                              <td className="px-3 py-2 border text-center text-blue-700">{vcsData.totalProperties}</td>
                              <td className="px-3 py-2 border text-center text-blue-700">—</td>
                              <td className="px-3 py-2 border text-center text-blue-700">—</td>
                              <td className="px-3 py-2 border text-center text-blue-700">—</td>
                              <td className="px-3 py-2 border text-center text-blue-700">Baseline: {vcsData.baseline || 'Auto'}</td>
                            </tr>
                            {/* Condition Code Rows */}
                            {availableConditions.exterior.map((cond, condIdx) => {
                              const condData = vcsData.conditions[cond.description];
                              if (!condData) return null;

                              return (
                                <tr key={`${vcs}-${cond.code}`} className={condIdx % 2 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="px-6 py-2 border text-sm">
                                    <span className="font-medium text-gray-700">{cond.code}</span>
                                    <span className="text-gray-500 ml-2">— {cond.description}</span>
                                  </td>
                                  <td className="px-3 py-2 border text-center">{condData.count}</td>
                                  <td className="px-3 py-2 border text-center">{formatPrice(condData.avgPrice)}</td>
                                  <td className="px-3 py-2 border text-center">{condData.avgSize?.toLocaleString() || '—'}</td>
                                  <td className="px-3 py-2 border text-center font-medium">{formatPrice(condData.normalizedPrice || condData.avgPrice)}</td>
                                  <td className="px-3 py-2 border text-center">
                                    <span className={`font-medium ${condData.percentDiff > 0 ? 'text-green-600' : condData.percentDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                      {formatPct(condData.percentDiff)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Interior Condition Analysis */}
                <div className="mb-6">
                  <h4 className="font-medium mb-3">Interior Condition Analysis - VCS Cascade View</h4>
                  <div className="overflow-auto border rounded">
                    <table className="min-w-full table-auto text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-left">
                          <th className="px-3 py-2 border font-semibold">VCS</th>
                          <th className="px-3 py-2 border font-semibold">Total</th>
                          <th className="px-3 py-2 border font-semibold">Baseline</th>
                          {availableConditions.interior.map(cond => (
                            <th key={cond.code} className="px-2 py-2 border font-semibold text-center" title={cond.description}>
                              {cond.description}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(conditionAnalysis.interior || {}).length === 0 && (
                          <tr><td colSpan={3 + availableConditions.interior.length} className="px-3 py-6 text-center text-gray-500">No interior condition data found.</td></tr>
                        )}
                        {Object.entries(conditionAnalysis.interior || {}).map(([vcs, vcsData], idx) => (
                          <tr key={vcs} className={idx % 2 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-3 py-2 border font-medium">{vcs}</td>
                            <td className="px-3 py-2 border">{vcsData.totalProperties}</td>
                            <td className="px-3 py-2 border text-sm">{vcsData.baseline || '—'}</td>
                            {availableConditions.interior.map(cond => {
                              const condData = vcsData.conditions[cond.description];
                              return (
                                <td key={cond.code} className="px-2 py-2 border text-center">
                                  {condData ? (
                                    <div className="text-xs">
                                      <div className="font-medium">{formatPrice(condData.normalizedPrice || condData.avgPrice)}</div>
                                      <div className="text-gray-500">({condData.count})</div>
                                      <div className={`font-medium ${condData.percentDiff > 0 ? 'text-green-600' : condData.percentDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                        {formatPct(condData.percentDiff)}
                                      </div>
                                    </div>
                                  ) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Overall Summary */}
                {conditionAnalysis.summary && (
                  <div className="mt-6 p-4 bg-blue-50 rounded">
                    <h4 className="font-medium mb-3">Overall Condition Impact Summary</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="font-medium text-sm mb-2">Exterior Conditions</h5>
                        <div className="space-y-1 text-xs">
                          {Object.entries(conditionAnalysis.summary.exterior || {}).map(([condition, data]) => (
                            <div key={condition} className="flex justify-between">
                              <span>{condition}:</span>
                              <span className={`font-medium ${data.percentDiff > 0 ? 'text-green-600' : data.percentDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                {formatPct(data.percentDiff)} ({data.count} props)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium text-sm mb-2">Interior Conditions</h5>
                        <div className="space-y-1 text-xs">
                          {Object.entries(conditionAnalysis.summary.interior || {}).map(([condition, data]) => (
                            <div key={condition} className="flex justify-between">
                              <span>{condition}:</span>
                              <span className={`font-medium ${data.percentDiff > 0 ? 'text-green-600' : data.percentDiff < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                {formatPct(data.percentDiff)} ({data.count} props)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {active === 'custom' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Custom Attribute Analysis</h3>
              <div className="flex items-center gap-2">
                <select value={selectedRawField} onChange={(e)=>setSelectedRawField(e.target.value)} className="border px-2 py-1 rounded text-sm">
                  {rawFields.map(f=> <option key={f} value={f}>{f}</option>)}
                </select>
                <input placeholder="match value (leave empty = present)" value={matchValue} onChange={(e)=>setMatchValue(e.target.value)} className="border px-2 py-1 rounded text-sm" />
                <button onClick={runCustomAttributeAnalysis} disabled={customWorking} className={CSV_BUTTON_CLASS}>{customWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-custom-attributes.csv`, ['Key','With_N','With_Avg','Without_N','Without_Avg','FlatAdj','PctAdj'], customCsvRows)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left"><th className="px-2 py-2">Group</th><th className="px-2 py-2">N with</th><th className="px-2 py-2">Avg with</th><th className="px-2 py-2">N without</th><th className="px-2 py-2">Avg without</th><th className="px-2 py-2">Flat Adj</th><th className="px-2 py-2">% Adj</th></tr>
                </thead>
                <tbody>
                  {!customResults && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Run an analysis to populate results.</td></tr>}
                  {customResults && (
                    <>
                      <tr className="bg-white"><td className="px-2 py-2">Overall</td><td className="px-2 py-2">{customResults.results?.overall?.with?.n}</td><td className="px-2 py-2">{customResults.results?.overall?.with?.avg_price}</td><td className="px-2 py-2">{customResults.results?.overall?.without?.n}</td><td className="px-2 py-2">{customResults.results?.overall?.without?.avg_price}</td><td className="px-2 py-2">{customResults.results?.overall?.flat_adj}</td><td className="px-2 py-2">{customResults.results?.overall?.pct_adj}</td></tr>
                      {Object.keys(customResults.byVCS || {}).map((v, i) => (<tr key={v} className={i%2? 'bg-white':'bg-gray-50'}><td className="px-2 py-2">{v}</td><td className="px-2 py-2">{customResults.byVCS[v].with.n}</td><td className="px-2 py-2">{customResults.byVCS[v].with.avg_price}</td><td className="px-2 py-2">{customResults.byVCS[v].without.n}</td><td className="px-2 py-2">{customResults.byVCS[v].without.avg_price}</td><td className="px-2 py-2">—</td><td className="px-2 py-2">—</td></tr>))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {active === 'additional' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Additional Card Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={runAdditionalCardAnalysis} className={CSV_BUTTON_CLASS}>{additionalWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-additional-cards.csv`, ['VCS','WithN','WithSize','WithPrice','WithAge','WithoutN','WithoutPrice','FlatAdj','PctAdj'], additionalCsvRows)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded mb-4">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left"><th className="px-2 py-2">VCS</th><th className="px-2 py-2">With N</th><th className="px-2 py-2">With Size</th><th className="px-2 py-2">With Price</th><th className="px-2 py-2">With Age</th><th className="px-2 py-2">Without N</th><th className="px-2 py-2">Without Price</th><th className="px-2 py-2">FlatAdj</th><th className="px-2 py-2">%Adj</th></tr>
                </thead>
                <tbody>
                  {!additionalResults && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Run analysis to populate results.</td></tr>}
                  {additionalResults && Object.keys(additionalResults.byVCS || {}).map((v, i) => {
                    const g = additionalResults.byVCS[v];
                    return (<tr key={v} className={i%2? 'bg-white':'bg-gray-50'}><td className="px-2 py-2">{v}</td><td className="px-2 py-2">{g.with.n}</td><td className="px-2 py-2">{g.with.avg_size}</td><td className="px-2 py-2">{g.with.avg_price}</td><td className="px-2 py-2">{g.with.avg_age}</td><td className="px-2 py-2">{g.without.n}</td><td className="px-2 py-2">{g.without.avg_price}</td><td className="px-2 py-2">{g.flat_adj}</td><td className="px-2 py-2">{g.pct_adj}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default AttributeCardsTab;
