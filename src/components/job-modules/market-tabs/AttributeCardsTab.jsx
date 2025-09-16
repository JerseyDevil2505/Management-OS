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
  console.log('Detected vendor type:', vendorType, 'from jobData:', { vendor_type: jobData?.vendor_type, vendor_source: jobData?.vendor_source });

  const [active, setActive] = useState('condition');

  // Condition analysis UI state
  const [entryFilterEnabled, setEntryFilterEnabled] = useState(true); // renamed from entryFilter
  const [typeUseFilter, setTypeUseFilter] = useState('1'); // Default to Single Family
  const [interiorInspectionOnly, setInteriorInspectionOnly] = useState(false);
  const [conditionWorking, setConditionWorking] = useState(false);
  const [conditionResults, setConditionResults] = useState(marketLandData.condition_analysis_rollup || { exterior: {}, interior: {}, tested_adjustments: {} });
  const [filteredPropertyCounts, setFilteredPropertyCounts] = useState({ exterior: 0, interior: 0 });

  // Load entry filter configuration from job (same as ProductionTracker)
  const [infoByCategoryConfig, setInfoByCategoryConfig] = useState({
    entry: [],
    refusal: [],
    estimation: [],
    invalid: [],
    priced: [],
    special: []
  });
  const [exteriorCascade, setExteriorCascade] = useState([
    { name: 'EXCELLENT', tested: null, actual: null },
    { name: 'VERY GOOD', tested: null, actual: null },
    { name: 'GOOD', tested: null, actual: null },
    { name: 'AVERAGE', tested: 0, actual: 0 }, // Always baseline
    { name: 'FAIR', tested: null, actual: null },
    { name: 'POOR', tested: null, actual: null },
    { name: 'VERY POOR', tested: null, actual: null }
  ]);
  const [interiorCascade, setInteriorCascade] = useState([
    { name: 'EXCELLENT', tested: null, actual: null },
    { name: 'VERY GOOD', tested: null, actual: null },
    { name: 'GOOD', tested: null, actual: null },
    { name: 'AVERAGE', tested: 0, actual: 0 }, // Always baseline
    { name: 'FAIR', tested: null, actual: null },
    { name: 'POOR', tested: null, actual: null },
    { name: 'VERY POOR', tested: null, actual: null }
  ]);

  // Custom attribute UI state
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);

  // Additional cards
  const [additionalWorking, setAdditionalWorking] = useState(false);
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);

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

  // Load infoByCategoryConfig from job data (same logic as ProductionTracker)
  useEffect(() => {
    if (jobData?.infoby_category_config && Object.keys(jobData.infoby_category_config).length > 0) {
      setInfoByCategoryConfig(jobData.infoby_category_config);
      console.log('📋 Loaded infoByCategoryConfig:', jobData.infoby_category_config);
    } else if (jobData?.workflow_stats?.infoByCategoryConfig) {
      // Fallback to workflow_stats
      setInfoByCategoryConfig(jobData.workflow_stats.infoByCategoryConfig);
      console.log('📋 Loaded infoByCategoryConfig from workflow_stats:', jobData.workflow_stats.infoByCategoryConfig);
    } else {
      console.log('⚠️ No infoByCategoryConfig found in job data - entry filter may not work correctly');
    }
  }, [jobData]);

  // Update property counts when filters change
  useEffect(() => {
    if (properties && properties.length > 0) {
      const propertiesWithSales = getValidSales(properties);
      if (propertiesWithSales.length > 0) {
        const exteriorCount = applyFilters(propertiesWithSales).length;
        const interiorCount = applyInteriorFilters(propertiesWithSales).length;
        setFilteredPropertyCounts({ exterior: exteriorCount, interior: interiorCount });
      }
    }
  }, [entryFilterEnabled, typeUseFilter, interiorInspectionOnly, properties, infoByCategoryConfig]);

  // Helper: filter valid sales (values_norm_time primary)
  const getValidSales = (props) => props.filter(p => p && (p.values_norm_time !== undefined && p.values_norm_time !== null && Number(p.values_norm_time) > 0));

  // Formatting helpers
  const formatPrice = (val) => val ? `$${val.toLocaleString()}` : '—';
  const formatSize = (val) => val ? val.toLocaleString() : '—';
  const formatPct = (val) => val ? `${val.toFixed(1)}%` : '—';
  const formatYear = (val) => val ? Math.round(val) : '—';

  // Get Type/Use options (exact copy from Land Valuation)
  const getTypeUseOptions = () => [
    { code: 'all', description: 'All Properties' },
    { code: '1', description: '1 — Single Family' },
    { code: '2', description: '2 — Duplex / Semi-Detached' },
    { code: '3', description: '3* — Row / Townhouse (3E,3I,30,31)' },
    { code: '4', description: '4* — MultiFamily (42,43,44)' },
    { code: '5', description: '5* ◆◆ Conversions (51,52,53)' },
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

  // Dynamic condition discovery using updated helper function
  const getUniqueConditions = (properties, condType) => {
    const conditions = new Set();
    properties.forEach(p => {
      const cond = normalizeCondition(getPropertyCondition(p, condType));
      if (cond) conditions.add(cond);
    });
    return Array.from(conditions).sort();
  };

  // Size normalization using Jim's 50% formula
  const calculateNormalizedValue = (salePrice, saleSize, targetSize) => {
    if (!saleSize || !targetSize || Math.abs(saleSize - targetSize) < 100) {
      return salePrice; // No adjustment needed if sizes are close
    }
    // Jim's 50% formula
    return (((targetSize - saleSize) * ((salePrice / saleSize) * 0.50)) + salePrice);
  };

  // Helper: Entry filter check (using infoByCategoryConfig like ProductionTracker)
  const applyEntryFilter = (props) => {
    if (!entryFilterEnabled) return props; // If filter OFF, return all

    return props.filter(p => {
      const infoByCode = (p.inspection_info_by || '').toString().trim();
      const normalizedInfoBy = infoByCode.toUpperCase(); // Normalize for comparison

      // Use infoByCategoryConfig.entry array like ProductionTracker
      const entryCodesList = infoByCategoryConfig.entry || [];

      if (entryCodesList.length > 0) {
        // Use configured entry codes
        const isEntryCode = entryCodesList.includes(normalizedInfoBy) || entryCodesList.includes(infoByCode);
        return isEntryCode;
      } else {
        // Fallback to hardcoded logic if no config available
        console.log('⚠️ No entry codes configured, using fallback logic');
        if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
          // Microsystems: O=Owner, S=Spouse, T=Tenant, A=Agent
          return ['O', 'S', 'T', 'A'].includes(normalizedInfoBy);
        } else {
          // BRT: 01-04 are entry codes (gained entry to property)
          return ['01', '02', '03', '04'].includes(infoByCode);
        }
      }
    });
  };

  // Type/Use filter logic (exact from Land Valuation)
  const applyTypeUseFilter = (properties, filterValue) => {
    if (!filterValue || filterValue === 'all') return properties;

    return properties.filter(p => {
      const typeUse = getPropertyTypeUse(p).toString().trim();

      // If typeUse is empty and we're filtering for residential types, include it
      // Many properties might not have type_use populated but are residential
      const isEmpty = !typeUse || typeUse === '';

      if (filterValue === 'all_residential') {
        // All codes starting with 1-6 are residential, or empty (assume residential)
        return isEmpty || ['1','2','3','4','5','6'].some(prefix => typeUse.startsWith(prefix));
      } else if (filterValue === '1') {
        // Single family: codes starting with '1' (10-19), or empty (assume single family)
        return isEmpty || typeUse.startsWith('1');
      } else if (filterValue === '2') {
        // Duplex/Semi: codes starting with '2' (20-29)
        return typeUse.startsWith('2');
      } else if (filterValue === '3') {
        // Row/Townhouse: 3E, 3I, 30, 31
        return ['3E','3I','30','31'].includes(typeUse);
      } else if (filterValue === '4') {
        // MultiFamily: 42, 43, 44
        return ['42','43','44'].includes(typeUse);
      } else if (filterValue === '5') {
        // Conversions: 51, 52, 53
        return ['51','52','53'].includes(typeUse);
      } else if (filterValue === '6') {
        // Condominium: codes starting with '6' (60-69)
        return typeUse.startsWith('6');
      }

      return false;
    });
  };

  // Helper: Apply base filters (entry, type/use)
  const applyFilters = (properties) => {
    let filtered = [...properties];

    // Entry filter
    filtered = applyEntryFilter(filtered);

    // Type/Use filter
    filtered = applyTypeUseFilter(filtered, typeUseFilter);

    return filtered;
  };

  // For Interior table specifically: apply base filters + interior inspection filter
  const applyInteriorFilters = (properties) => {
    let filtered = applyFilters(properties); // Apply base filters first

    if (interiorInspectionOnly) {
      filtered = filtered.filter(p => {
        const infoByCode = (p.inspection_info_by || '').toString().trim();
        const normalizedInfoBy = infoByCode.toUpperCase();

        // Use infoByCategoryConfig like ProductionTracker
        const refusalCodes = infoByCategoryConfig.refusal || [];
        const estimationCodes = infoByCategoryConfig.estimation || [];

        if (refusalCodes.length > 0 || estimationCodes.length > 0) {
          // Use configured refusal/estimation codes
          const isRefusal = refusalCodes.includes(normalizedInfoBy) || refusalCodes.includes(infoByCode);
          const isEstimation = estimationCodes.includes(normalizedInfoBy) || estimationCodes.includes(infoByCode);
          return !isRefusal && !isEstimation; // Include only if NOT refused or estimated
        } else {
          // Fallback to hardcoded logic if no config available
          if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
            return !['R', 'E'].includes(normalizedInfoBy); // Not refused (R) or estimated (E)
          } else {
            // BRT: 06=refused, 07=estimated (no interior inspection)
            return !['06', '07'].includes(infoByCode);
          }
        }
      });
    }
    return filtered;
  };

  // Helper function to normalize condition codes based on vendor type
  const normalizeCondition = (condCode) => {
    if (!condCode) return null;

    // Clean the condition code - trim whitespace and convert to uppercase
    const cleanCode = condCode.toString().trim().toUpperCase();

    // Treat "00" as null/empty - it's lazy vendor coding, not a real condition
    if (cleanCode === '00' || cleanCode === '') return null;

    if (vendorType === 'Microsystems' || vendorType === 'microsystems') {
      // Microsystems: E=Excellent, G=Good, A=Average, F=Fair, P=Poor
      const condMap = {
        'E': 'EXCELLENT', 'G': 'GOOD', 'A': 'AVERAGE',
        'F': 'FAIR', 'P': 'POOR'
      };
      return condMap[cleanCode] || null;
    } else {
      // BRT: Uses section 60 for both exterior and interior conditions
      // Common BRT condition codes (check with parsed_code_definitions if available)
      const condMap = {
        '01': 'EXCELLENT',
        '02': 'VERY_GOOD',
        '03': 'GOOD',
        '04': 'AVERAGE',
        '05': 'FAIR',
        '06': 'POOR',
        '07': 'VERY_POOR'
      };

      // Check if we have parsed code definitions for this job
      const codeDefinitions = jobData?.parsed_code_definitions || {};
      if (codeDefinitions['60']) {
        // Use actual BRT condition definitions from section 60
        const section60 = codeDefinitions['60'];
        const foundCode = section60.find(def => def.code === cleanCode);
        if (foundCode) {
          return foundCode.description.toUpperCase().replace(/\s+/g, '_');
        }
      }

      return condMap[cleanCode] || cleanCode; // Return original code if not mapped
    }
  };

  // ENHANCED Condition Analysis - Complete rewrite with all improvements
  const computeConditionAnalysis = async () => {
    setConditionWorking(true);
    try {
      // First, get properties with BOTH condition data and sales data
      let propertiesWithSales = properties.filter(p => {
        const hasMarketData = p.values_norm_time && Number(p.values_norm_time) > 0;
        const hasConditions = p.asset_ext_cond || p.asset_int_cond;
        return hasMarketData && hasConditions;
      });

      console.log('Properties with sales and conditions (initial):', propertiesWithSales.length);

      // If values_norm_time is not on properties, fetch from property_market_analysis
      if (propertiesWithSales.length === 0 || !properties[0]?.values_norm_time) {
        console.log('Fetching market analysis data from property_market_analysis table...');
        const { data: marketData } = await supabase
          .from('property_market_analysis')
          .select('property_composite_key, values_norm_time, values_norm_size')
          .eq('job_id', jobData.id);

        const marketMap = {};
        marketData?.forEach(m => {
          marketMap[m.property_composite_key] = m;
        });

        propertiesWithSales = properties.map(p => ({
          ...p,
          values_norm_time: marketMap[p.property_composite_key]?.values_norm_time,
          values_norm_size: marketMap[p.property_composite_key]?.values_norm_size
        })).filter(p => {
          const hasMarketData = p.values_norm_time && Number(p.values_norm_time) > 0;
          const hasConditions = p.asset_ext_cond || p.asset_int_cond;
          return hasMarketData && hasConditions;
        });
      }

      // Debug filtering step by step
      console.log('=== FILTERING DEBUG ===');
      console.log('1. Properties with sales:', propertiesWithSales.length);

      // Test entry filter
      const afterEntryFilter = applyEntryFilter(propertiesWithSales);
      console.log('2. After entry filter:', afterEntryFilter.length);
      console.log('   Entry filter enabled:', entryFilterEnabled);
      if (afterEntryFilter.length < propertiesWithSales.length) {
        const sample = propertiesWithSales[0];
        console.log('   Sample inspection_info_by:', sample?.inspection_info_by);
        console.log('   Expected BRT entry codes: 01,02,03,04');
      }

      // Test type/use filter
      const afterTypeUseFilter = applyTypeUseFilter(afterEntryFilter, typeUseFilter);
      console.log('3. After type/use filter:', afterTypeUseFilter.length);
      console.log('   Type/use filter:', typeUseFilter);
      if (afterTypeUseFilter.length < afterEntryFilter.length) {
        console.log('   Sample type_use values from remaining properties:');
        afterEntryFilter.slice(0, 5).forEach((p, i) => {
          console.log(`     Property ${i}: type_use="${getPropertyTypeUse(p)}" (would include: ${typeUseFilter === '1' ? (!getPropertyTypeUse(p) || getPropertyTypeUse(p).startsWith('1')) : 'other logic'})`);
        });
      }

      // Apply filters for exterior and interior analyses
      const exteriorProperties = applyFilters(propertiesWithSales);
      const interiorProperties = applyInteriorFilters(propertiesWithSales);

      console.log('4. Final exterior properties:', exteriorProperties.length);
      console.log('5. Final interior properties:', interiorProperties.length);

      // Update property counts in state for UI display
      setFilteredPropertyCounts({
        exterior: exteriorProperties.length,
        interior: interiorProperties.length
      });

      // Debug field names and filtering
      console.log('=== DETAILED FIELD ANALYSIS ===');
      if (properties.length > 0) {
        const sample = properties[0];
        console.log('Vendor Type Detection:', vendorType);
        console.log('JobData vendor fields:', {
          vendor_type: jobData?.vendor_type,
          vendor_source: jobData?.vendor_source
        });

        console.log('All fields on property:', Object.keys(sample));
        console.log('Type/Use field values:');
        console.log('  asset_type_use:', sample.asset_type_use);
        console.log('  asset_typeuse:', sample.asset_typeuse);
        console.log('  typeuse:', sample.typeuse);
        console.log('  type_use:', sample.type_use);
        console.log('  getPropertyTypeUse result:', getPropertyTypeUse(sample));

        console.log('Condition field values:');
        console.log('  asset_ext_cond:', sample.asset_ext_cond);
        console.log('  asset_int_cond:', sample.asset_int_cond);
        console.log('  getPropertyCondition(exterior):', getPropertyCondition(sample, 'exterior'));
        console.log('  getPropertyCondition(interior):', getPropertyCondition(sample, 'interior'));
        console.log('  normalizeCondition(ext):', normalizeCondition(getPropertyCondition(sample, 'exterior')));
        console.log('  normalizeCondition(int):', normalizeCondition(getPropertyCondition(sample, 'interior')));

        console.log('Current typeUseFilter:', typeUseFilter);

        // Check BRT code definitions
        if (jobData?.parsed_code_definitions?.['60']) {
          console.log('BRT Section 60 (Condition) codes available:',
            jobData.parsed_code_definitions['60'].slice(0, 10).map(c => `${c.code}: ${c.description}`));
        }

        // Check how many properties have populated type_use
        const typeUseStats = {
          total: propertiesWithSales.length,
          with_asset_type_use: propertiesWithSales.filter(p => p.asset_type_use && p.asset_type_use.toString().trim()).length,
          with_any_typeuse: propertiesWithSales.filter(p => getPropertyTypeUse(p).toString().trim()).length
        };
        console.log('Type/Use field population:', typeUseStats);

        // Sample type_use values
        const sampleTypeUse = propertiesWithSales
          .map(p => getPropertyTypeUse(p))
          .filter(t => t && t.toString().trim())
          .slice(0, 20);
        console.log('Sample type_use values:', [...new Set(sampleTypeUse)]);

        // Check condition codes
        const extConds = propertiesWithSales.map(p => getPropertyCondition(p, 'exterior')).filter(c => c);
        const intConds = propertiesWithSales.map(p => getPropertyCondition(p, 'interior')).filter(c => c);
        console.log('Raw exterior condition codes:', [...new Set(extConds)].slice(0, 20));
        console.log('Raw interior condition codes:', [...new Set(intConds)].slice(0, 20));
        console.log('Normalized exterior conditions:', [...new Set(extConds.map(c => normalizeCondition(c)).filter(Boolean))]);
        console.log('Normalized interior conditions:', [...new Set(intConds.map(c => normalizeCondition(c)).filter(Boolean))]);
      }

      // TEMPORARY TEST: Try with NO filters to see if we can find conditions
      console.log('=== TESTING WITHOUT FILTERS ===');
      const testExteriorConditions = getUniqueConditions(propertiesWithSales, 'exterior');
      const testInteriorConditions = getUniqueConditions(propertiesWithSales, 'interior');
      console.log('Conditions found WITHOUT any filters:');
      console.log('  Test exterior:', testExteriorConditions);
      console.log('  Test interior:', testInteriorConditions);

      // Discover actual conditions in data (dynamic)
      console.log('=== CONDITION DISCOVERY WITH FILTERS ===');
      console.log('About to discover conditions from:');
      console.log('  Exterior properties:', exteriorProperties.length);
      console.log('  Interior properties:', interiorProperties.length);

      if (exteriorProperties.length > 0) {
        console.log('Sample exterior property conditions:');
        exteriorProperties.slice(0, 3).forEach((p, i) => {
          const rawCond = getPropertyCondition(p, 'exterior');
          const normalized = normalizeCondition(rawCond);
          console.log(`  Property ${i}: raw="${rawCond}" -> normalized="${normalized}"`);
        });
      } else {
        console.log('NO EXTERIOR PROPERTIES after filtering - this is the problem!');
      }

      const exteriorConditions = getUniqueConditions(exteriorProperties, 'exterior');
      const interiorConditions = getUniqueConditions(interiorProperties, 'interior');

      console.log('Discovered conditions WITH filters:');
      console.log('  Exterior:', exteriorConditions);
      console.log('  Interior:', interiorConditions);

      console.log('Found exterior conditions:', exteriorConditions);
      console.log('Found interior conditions:', interiorConditions);

      // Enhanced analysis builder with size normalization
      const buildConditionAnalysis = (conditionField, conditionsList, filteredProperties) => {
        const analysis = {};

        // Group by VCS and condition
        filteredProperties.forEach(p => {
          const vcs = p.new_vcs || p.property_vcs || p.vcs || p.asset_vcs || 'NO_VCS';
          const condition = normalizeCondition(getPropertyCondition(p, conditionField === 'asset_ext_cond' ? 'exterior' : 'interior'));
          if (!condition) return;

          if (!analysis[vcs]) {
            analysis[vcs] = { vcs };
            // Initialize all found conditions
            conditionsList.forEach(cond => {
              analysis[vcs][cond] = {
                properties: [],
                count: 0,
                totalPrice: 0,
                totalSize: 0,
                totalAge: 0,
                price: 0,
                size: 0,
                age: 0,
                normalizedPrice: 0,
                percentDiff: 0
              };
            });
          }

          const bucket = analysis[vcs][condition];
          const price = Number(p.values_norm_time || 0);
          const size = Number(p.asset_sfla || p.asset_sfla_calc || 0);
          const yearBuilt = Number(p.asset_year_built || p.property_year_built || 0);
          const age = yearBuilt > 0 ? new Date().getFullYear() - yearBuilt : 0;

          bucket.properties.push({ price, size, age, yearBuilt });
          bucket.count++;
          bucket.totalPrice += price;
          bucket.totalSize += size;
          bucket.totalAge += age;
        });

        // Calculate averages and apply size normalization
        Object.keys(analysis).forEach(vcs => {
          const vcsData = analysis[vcs];

          // Calculate basic averages first
          conditionsList.forEach(condition => {
            const bucket = vcsData[condition];
            if (bucket.count > 0) {
              bucket.price = Math.round(bucket.totalPrice / bucket.count);
              bucket.size = Math.round(bucket.totalSize / bucket.count);
              bucket.age = Math.round(bucket.totalAge / bucket.count);
            }
          });

          // Find AVERAGE condition as baseline for size normalization
          const baselineCondition = vcsData.AVERAGE || vcsData[conditionsList[0]];
          const targetSize = baselineCondition ? baselineCondition.size : 0;

          // Apply size normalization to each condition
          conditionsList.forEach(condition => {
            const bucket = vcsData[condition];
            if (bucket.count > 0 && targetSize > 0) {
              // Calculate normalized values using Jim's formula
              const normalizedValues = bucket.properties.map(prop =>
                calculateNormalizedValue(prop.price, prop.size, targetSize)
              );
              bucket.normalizedPrice = Math.round(normalizedValues.reduce((a,b) => a+b, 0) / normalizedValues.length);

              // Calculate percent difference from AVERAGE baseline
              if (baselineCondition && baselineCondition.normalizedPrice > 0) {
                bucket.percentDiff = Number(((bucket.normalizedPrice - baselineCondition.normalizedPrice) / baselineCondition.normalizedPrice * 100).toFixed(1));
              }
            }
          });
        });

        return analysis;
      };

      const exteriorAnalysis = buildConditionAnalysis('asset_ext_cond', exteriorConditions, exteriorProperties);
      const interiorAnalysis = buildConditionAnalysis('asset_int_cond', interiorConditions, interiorProperties);

      // Update cascades with tested values
      const updateCascade = (conditions, analysis, setCascade) => {
        const newCascade = [];
        const allConditions = ['EXCELLENT', 'VERY GOOD', 'GOOD', 'AVERAGE', 'FAIR', 'POOR', 'VERY POOR'];

        allConditions.forEach(condName => {
          let tested = null;

          if (conditions.includes(condName)) {
            // Calculate overall impact across all VCS
            let totalNormPrice = 0, totalCount = 0, totalBaselinePrice = 0, totalBaselineCount = 0;

            Object.values(analysis).forEach(vcsData => {
              const condBucket = vcsData[condName];
              const baseBucket = vcsData.AVERAGE || Object.values(vcsData)[0];

              if (condBucket && baseBucket) {
                totalNormPrice += condBucket.normalizedPrice * condBucket.count;
                totalCount += condBucket.count;
                totalBaselinePrice += baseBucket.normalizedPrice * baseBucket.count;
                totalBaselineCount += baseBucket.count;
              }
            });

            if (totalCount > 0 && totalBaselineCount > 0) {
              const avgNormPrice = totalNormPrice / totalCount;
              const avgBaselinePrice = totalBaselinePrice / totalBaselineCount;
              tested = Number(((avgNormPrice - avgBaselinePrice) / avgBaselinePrice * 100).toFixed(1));

              // Rule: If "above average" conditions show negative, set to 0
              if (['EXCELLENT', 'VERY GOOD', 'GOOD'].includes(condName) && tested < 0) {
                tested = 0;
              }
            }
          }

          newCascade.push({
            name: condName,
            tested,
            actual: condName === 'AVERAGE' ? 0 : null
          });
        });

        setCascade(newCascade);
      };

      updateCascade(exteriorConditions, exteriorAnalysis, setExteriorCascade);
      updateCascade(interiorConditions, interiorAnalysis, setInteriorCascade);

      const rollup = {
        exterior: exteriorAnalysis,
        interior: interiorAnalysis,
        exterior_conditions: exteriorConditions,
        interior_conditions: interiorConditions,
        filters_applied: {
          entry_filter_enabled: entryFilterEnabled,
          type_use_filter: typeUseFilter,
          interior_inspection_only: interiorInspectionOnly
        },
        entry_filter_used: entryFilterEnabled,
        generated_at: new Date().toISOString()
      };

      setConditionResults(rollup);
      await saveRollupToDB(jobData.id, { condition_analysis_rollup: rollup });

    } catch (e) {
      console.error('computeConditionAnalysis', e);
    }
    setConditionWorking(false);
  };

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

  // Save cascade adjustments
  const saveConditionAdjustments = async () => {
    try {
      const rollup = {
        ...conditionResults,
        exterior_cascade: exteriorCascade,
        interior_cascade: interiorCascade,
        updated_at: new Date().toISOString()
      };

      await saveRollupToDB(jobData.id, { condition_analysis_rollup: rollup });
      setConditionResults(rollup);
      console.log('✅ Condition adjustments saved');
    } catch (e) {
      console.error('Failed to save condition adjustments:', e);
    }
  };

  // Save condition analysis with filter states
  const saveConditionAnalysis = async () => {
    try {
      const rollup = {
        filters_applied: {
          entry_filter_enabled: entryFilterEnabled,
          type_use_filter: typeUseFilter,
          interior_inspection_only: interiorInspectionOnly
        },
        exterior_conditions: conditionResults.exterior_conditions,
        interior_conditions: conditionResults.interior_conditions,
        exterior_cascade: exteriorCascade,
        interior_cascade: interiorCascade,
        analysis_date: new Date().toISOString(),
        ...conditionResults
      };

      await saveRollupToDB(jobData.id, { condition_analysis_rollup: rollup });
      setConditionResults(rollup);
      console.log('✅ Condition analysis and filters saved');
    } catch (e) {
      console.error('Failed to save condition analysis:', e);
    }
  };

  // Custom attribute analysis enhanced to apply size-normalization when group sizes differ
  const runCustomAttributeAnalysis = async () => {
    if (!selectedRawField || !jobData?.id) return;
    setCustomWorking(true);
    try {
      const valid = getValidSales(properties);
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
      const valid = getValidSales(properties);
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

  // Enhanced CSV helpers with all columns: Price, Size, Age, Count, Normalized Price, % Diff
  const conditionExteriorRowsForCsv = useMemo(() => {
    const rows = [];
    const ext = conditionResults.exterior || {};
    const conditions = conditionResults.exterior_conditions || ['EXCELLENT', 'GOOD', 'AVERAGE', 'FAIR', 'POOR'];

    Object.keys(ext).forEach(vcs => {
      const vcsData = ext[vcs];
      if (!vcsData || typeof vcsData !== 'object') return;

      const row = [vcs];
      conditions.forEach(condition => {
        const bucket = vcsData[condition] || { price: 0, size: 0, age: 0, count: 0, normalizedPrice: 0, percentDiff: 0 };
        row.push(
          formatPrice(bucket.price),
          formatSize(bucket.size),
          formatYear(bucket.age),
          bucket.count,
          formatPrice(bucket.normalizedPrice),
          formatPct(bucket.percentDiff)
        );
      });
      rows.push(row);
    });
    return rows;
  }, [conditionResults]);

  const conditionInteriorRowsForCsv = useMemo(() => {
    const rows = [];
    const int = conditionResults.interior || {};
    const conditions = conditionResults.interior_conditions || ['EXCELLENT', 'GOOD', 'AVERAGE', 'FAIR', 'POOR'];

    Object.keys(int).forEach(vcs => {
      const vcsData = int[vcs];
      if (!vcsData || typeof vcsData !== 'object') return;

      const row = [vcs];
      conditions.forEach(condition => {
        const bucket = vcsData[condition] || { price: 0, size: 0, age: 0, count: 0, normalizedPrice: 0, percentDiff: 0 };
        row.push(
          formatPrice(bucket.price),
          formatSize(bucket.size),
          formatYear(bucket.age),
          bucket.count,
          formatPrice(bucket.normalizedPrice),
          formatPct(bucket.percentDiff)
        );
      });
      rows.push(row);
    });
    return rows;
  }, [conditionResults]);

  // Dynamic CSV headers based on actual conditions found
  const getExteriorCsvHeaders = () => {
    const conditions = conditionResults.exterior_conditions || ['EXCELLENT', 'GOOD', 'AVERAGE', 'FAIR', 'POOR'];
    const headers = ['VCS'];
    conditions.forEach(cond => {
      headers.push(`${cond}_Price`, `${cond}_Size`, `${cond}_Age`, `${cond}_Count`, `${cond}_NormPrice`, `${cond}_%`);
    });
    return headers;
  };

  const getInteriorCsvHeaders = () => {
    const conditions = conditionResults.interior_conditions || ['EXCELLENT', 'GOOD', 'AVERAGE', 'FAIR', 'POOR'];
    const headers = ['VCS'];
    conditions.forEach(cond => {
      headers.push(`${cond}_Price`, `${cond}_Size`, `${cond}_Age`, `${cond}_Count`, `${cond}_NormPrice`, `${cond}_%`);
    });
    return headers;
  };

  // CSV for custom
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

  // CSV for additional
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
          <p className="text-gray-600">Condition, custom attribute, and additional card analysis. Tables are optimized for export and client delivery.</p>
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
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Condition Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={computeConditionAnalysis} className={CSV_BUTTON_CLASS}>{conditionWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={saveConditionAnalysis} className={CSV_BUTTON_CLASS}>Save Analysis & Filters</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-condition-exterior.csv`, getExteriorCsvHeaders(), conditionExteriorRowsForCsv)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Exterior CSV</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-condition-interior.csv`, getInteriorCsvHeaders(), conditionInteriorRowsForCsv)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Interior CSV</button>
              </div>
            </div>

            {/* Filter Controls */}
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2">
                <span className="text-sm font-medium">Entry filter (01-04)</span>
                <input
                  type="checkbox"
                  checked={entryFilterEnabled}
                  onChange={(e) => setEntryFilterEnabled(e.target.checked)}
                />
              </label>

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
                ({filteredPropertyCounts.exterior} exterior / {filteredPropertyCounts.interior} interior properties)
              </span>
            </div>

            {/* Exterior Condition Table */}
            <div className="mb-6">
              <h4 className="font-medium mb-2">Exterior Condition Analysis (AVERAGE = Baseline)</h4>
              <div className="overflow-auto border rounded">
                <table className="min-w-full table-auto text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="px-2 py-2 border">VCS</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG Price</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG AGI</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG Size</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG N</th>
                      <th className="px-2 py-2 border bg-green-50">EXC Price</th>
                      <th className="px-2 py-2 border bg-green-50">EXC AGI</th>
                      <th className="px-2 py-2 border bg-green-50">EXC %</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD Price</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD AGI</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD %</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR Price</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR AGI</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR %</th>
                      <th className="px-2 py-2 border bg-red-50">POOR Price</th>
                      <th className="px-2 py-2 border bg-red-50">POOR AGI</th>
                      <th className="px-2 py-2 border bg-red-50">POOR %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(conditionResults.exterior || {}).length === 0 && <tr><td colSpan={17} className="px-3 py-6 text-center text-gray-500">No exterior analysis yet.</td></tr>}
                    {Object.entries(conditionResults.exterior || {}).map(([vcs, vcsData], idx) => {
                      // Safety check and defaults
                      if (!vcsData || typeof vcsData !== 'object') return null;
                      const avg = vcsData.AVERAGE || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0 };
                      const exc = vcsData.EXCELLENT || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const good = vcsData.GOOD || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const fair = vcsData.FAIR || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const poor = vcsData.POOR || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };

                      return (
                        <tr key={vcs} className={idx%2? 'bg-white':'bg-gray-50'}>
                          <td className="px-2 py-2 border font-medium">{vcs}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgSize || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.count || 0}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.pctDiff ? `${exc.pctDiff}%` : '��'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.pctDiff ? `${good.pctDiff}%` : '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.pctDiff ? `${fair.pctDiff}%` : '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.pctDiff ? `${poor.pctDiff}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interior Condition Table */}
            <div className="flex items-center gap-2 mt-4 mb-2">
              <label className="flex items-center gap-2">
                <span className="text-sm font-medium">Interior Inspections Only</span>
                <input
                  type="checkbox"
                  checked={interiorInspectionOnly}
                  onChange={(e) => setInteriorInspectionOnly(e.target.checked)}
                />
              </label>
              <span className="text-xs text-gray-500">
                (Shows only properties where interior was inspected)
              </span>
            </div>
            <div className="mb-6">
              <h4 className="font-medium mb-2">Interior Condition Analysis (AVERAGE = Baseline)</h4>
              <div className="overflow-auto border rounded">
                <table className="min-w-full table-auto text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="px-2 py-2 border">VCS</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG Price</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG AGI</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG Size</th>
                      <th className="px-2 py-2 border bg-blue-50">AVG N</th>
                      <th className="px-2 py-2 border bg-green-50">EXC Price</th>
                      <th className="px-2 py-2 border bg-green-50">EXC AGI</th>
                      <th className="px-2 py-2 border bg-green-50">EXC %</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD Price</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD AGI</th>
                      <th className="px-2 py-2 border bg-yellow-50">GOOD %</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR Price</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR AGI</th>
                      <th className="px-2 py-2 border bg-orange-50">FAIR %</th>
                      <th className="px-2 py-2 border bg-red-50">POOR Price</th>
                      <th className="px-2 py-2 border bg-red-50">POOR AGI</th>
                      <th className="px-2 py-2 border bg-red-50">POOR %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(conditionResults.interior || {}).length === 0 && <tr><td colSpan={17} className="px-3 py-6 text-center text-gray-500">No interior analysis yet.</td></tr>}
                    {Object.entries(conditionResults.interior || {}).map(([vcs, vcsData], idx) => {
                      // Safety check and defaults
                      if (!vcsData || typeof vcsData !== 'object') return null;
                      const avg = vcsData.AVERAGE || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0 };
                      const exc = vcsData.EXCELLENT || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const good = vcsData.GOOD || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const fair = vcsData.FAIR || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };
                      const poor = vcsData.POOR || { avgPrice: 0, avgAGI: 0, avgSize: 0, count: 0, pctDiff: 0 };

                      return (
                        <tr key={vcs} className={idx%2? 'bg-white':'bg-gray-50'}>
                          <td className="px-2 py-2 border font-medium">{vcs}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.avgSize || '—'}</td>
                          <td className="px-2 py-2 border bg-blue-50">{avg.count || 0}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-green-50">{exc.pctDiff ? `${exc.pctDiff}%` : '—'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-yellow-50">{good.pctDiff ? `${good.pctDiff}%` : '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-orange-50">{fair.pctDiff ? `${fair.pctDiff}%` : '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.avgPrice || '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.avgAGI || '—'}</td>
                          <td className="px-2 py-2 border bg-red-50">{poor.pctDiff ? `${poor.pctDiff}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tested vs Actual Adjustments */}
            <div className="mt-4">
              <h4 className="font-medium mb-2">Tested vs Actual Adjustments (Overall Impact)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border rounded">
                  <div className="text-sm font-semibold mb-2">Exterior Condition Adjustments</div>
                  <div className="space-y-1 text-xs">
                    <div>Excellent: {conditionResults.tested_adjustments?.exterior?.excellent?.pctDiff || 0}% ({conditionResults.tested_adjustments?.exterior?.excellent?.count || 0} sales)</div>
                    <div>Good: {conditionResults.tested_adjustments?.exterior?.good?.pctDiff || 0}% ({conditionResults.tested_adjustments?.exterior?.good?.count || 0} sales)</div>
                    <div className="font-medium">Average: 0% (baseline) ({conditionResults.tested_adjustments?.exterior?.average?.count || 0} sales)</div>
                    <div>Fair: {conditionResults.tested_adjustments?.exterior?.fair?.pctDiff || 0}% ({conditionResults.tested_adjustments?.exterior?.fair?.count || 0} sales)</div>
                    <div>Poor: {conditionResults.tested_adjustments?.exterior?.poor?.pctDiff || 0}% ({conditionResults.tested_adjustments?.exterior?.poor?.count || 0} sales)</div>
                  </div>
                </div>
                <div className="p-3 border rounded">
                  <div className="text-sm font-semibold mb-2">Interior Condition Adjustments</div>
                  <div className="space-y-1 text-xs">
                    <div>Excellent: {conditionResults.tested_adjustments?.interior?.excellent?.pctDiff || 0}% ({conditionResults.tested_adjustments?.interior?.excellent?.count || 0} sales)</div>
                    <div>Good: {conditionResults.tested_adjustments?.interior?.good?.pctDiff || 0}% ({conditionResults.tested_adjustments?.interior?.good?.count || 0} sales)</div>
                    <div className="font-medium">Average: 0% (baseline) ({conditionResults.tested_adjustments?.interior?.average?.count || 0} sales)</div>
                    <div>Fair: {conditionResults.tested_adjustments?.interior?.fair?.pctDiff || 0}% ({conditionResults.tested_adjustments?.interior?.fair?.count || 0} sales)</div>
                    <div>Poor: {conditionResults.tested_adjustments?.interior?.poor?.pctDiff || 0}% ({conditionResults.tested_adjustments?.interior?.poor?.count || 0} sales)</div>
                  </div>
                </div>
              </div>
            </div>
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
