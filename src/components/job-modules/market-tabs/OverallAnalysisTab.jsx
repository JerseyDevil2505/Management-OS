// OverallAnalysisTab.jsx - CLEANED UP BEAST VERSION with REAL DATA
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { interpretCodes } from '../../../lib/supabaseClient';
import { 
  BarChart, TrendingUp, Home, Building, RefreshCw, Save, AlertCircle,
  Download, Filter, MapPin, DollarSign, Activity, Target, 
  FileSpreadsheet, Eye, ChevronDown, ChevronUp, Info, CheckCircle, 
  XCircle, ArrowUpRight, ArrowDownRight, Minus, Zap,
  Layers,
  Calendar
} from 'lucide-react';

const OverallAnalysisTab = ({ properties, jobData, vendorType, codeDefinitions }) => {
  // Core state
  const [analysisResults, setAnalysisResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [useJimFormula, setUseJimFormula] = useState(false);
  const [lastAnalysisTime, setLastAnalysisTime] = useState(null);
  const [selectedBaseline, setSelectedBaseline] = useState(null);
  
  // Enhanced features state
  const [confidenceMetrics, setConfidenceMetrics] = useState(null);
  const [vcsHeatMap, setVcsHeatMap] = useState(null);
  const [expandedVCS, setExpandedVCS] = useState({});
  const [statisticalAnalysis, setStatisticalAnalysis] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview, statistical, vcs, export
  const [filterConfig, setFilterConfig] = useState({
    minSalePrice: 0,
    maxSalePrice: 999999999,
    minSize: 0,
    maxSize: 999999,
    excludeTypes: [],
    yearBuiltMin: 1900,
    yearBuiltMax: 2025
  });
  const [showFilters, setShowFilters] = useState(false);
  const [conditionAnalysis, setConditionAnalysis] = useState(null);
  const [ageAnalysis, setAgeAnalysis] = useState(null);

  useEffect(() => {
    loadExistingAnalysis();
  }, [jobData.id]);

  const loadExistingAnalysis = async () => {
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .select('*')
        .eq('job_id', jobData.id)
        .single();

      if (data?.overall_analysis_results) {
        setAnalysisResults(data.overall_analysis_results);
        setLastAnalysisTime(data.overall_analysis_updated_at);
        if (data.overall_analysis_config?.useJimFormula !== undefined) {
          setUseJimFormula(data.overall_analysis_config.useJimFormula);
        }
        if (data.confidence_metrics) {
          setConfidenceMetrics(data.confidence_metrics);
        }
        if (data.statistical_analysis) {
          setStatisticalAnalysis(data.statistical_analysis);
        }
      } else {
        runCompleteAnalysis();
      }
    } catch (error) {
      console.error('Error loading analysis:', error);
      runCompleteAnalysis();
    }
  };

  const runCompleteAnalysis = async () => {
    setIsCalculating(true);
    console.log('🚀 Starting comprehensive market analysis...');
    
    // Filter to only properties with normalized values
    let validProperties = properties.filter(p => p.values_norm_time && p.values_norm_time > 0);
    
    // Apply additional filters
    validProperties = applyFilters(validProperties);

    if (validProperties.length === 0) {
      alert('No properties match the current filter criteria. Please adjust filters or complete Pre-Valuation normalization.');
      setIsCalculating(false);
      return;
    }

    console.log(`📊 Analyzing ${validProperties.length} properties...`);

    // Core analyses
    const typeUseResults = analyzeTypeAndUse(validProperties);
    const designResults = analyzeDesignAndStyle(validProperties);
    const vcsResults = analyzeVCSPatterns(validProperties);
    
    // Additional analyses using REAL data
    const condResults = analyzeConditions(validProperties);
    setConditionAnalysis(condResults);
    
    const ageResults = analyzeAgePatterns(validProperties);
    setAgeAnalysis(ageResults);
    
    // Statistical analysis
    const statsResults = performStatisticalAnalysis(validProperties, typeUseResults);
    setStatisticalAnalysis(statsResults);
    
    // Confidence scoring
    const confidence = calculateConfidenceScores(typeUseResults, designResults, vcsResults, statsResults);
    setConfidenceMetrics(confidence);
    
    // VCS Heat Map
    const heatMap = generateVCSHeatMap(validProperties, vcsResults);
    setVcsHeatMap(heatMap);
    
    // Generate insights
    const insights = generateEnhancedMarketInsights(
      typeUseResults, 
      designResults, 
      vcsResults, 
      statsResults,
      confidence,
      condResults,
      ageResults
    );

    const results = {
      generated_at: new Date().toISOString(),
      property_count: validProperties.length,
      baseline_type: typeUseResults.baseline,
      type_use_analysis: typeUseResults,
      design_style_analysis: designResults,
      vcs_patterns: vcsResults,
      condition_analysis: condResults,
      age_analysis: ageResults,
      market_insights: insights,
      jim_formula_applied: useJimFormula,
      filters_applied: filterConfig,
      statistical_summary: statsResults.summary,
      confidence_summary: confidence.overall
    };

    setAnalysisResults(results);
    setIsCalculating(false);
    setLastAnalysisTime(new Date());
    
    console.log('✅ Analysis complete!');
  };

  const applyFilters = (properties) => {
    let filtered = [...properties];
    
    if (filterConfig.minSalePrice > 0) {
      filtered = filtered.filter(p => p.values_norm_time >= filterConfig.minSalePrice);
    }
    
    if (filterConfig.maxSalePrice < 999999999) {
      filtered = filtered.filter(p => p.values_norm_time <= filterConfig.maxSalePrice);
    }
    
    if (filterConfig.minSize > 0) {
      filtered = filtered.filter(p => (p.asset_sfla || 0) >= filterConfig.minSize);
    }
    
    if (filterConfig.maxSize < 999999) {
      filtered = filtered.filter(p => (p.asset_sfla || 0) <= filterConfig.maxSize);
    }
    
    if (filterConfig.excludeTypes.length > 0) {
      filtered = filtered.filter(p => !filterConfig.excludeTypes.includes(p.asset_type_use));
    }
    
    if (filterConfig.yearBuiltMin > 1900) {
      filtered = filtered.filter(p => (p.asset_year_built || 2000) >= filterConfig.yearBuiltMin);
    }
    
    if (filterConfig.yearBuiltMax < 2025) {
      filtered = filtered.filter(p => (p.asset_year_built || 2000) <= filterConfig.yearBuiltMax);
    }
    
    return filtered;
  };

  const analyzeTypeAndUse = (properties) => {
    const typeGroups = {};
    
    properties.forEach(p => {
      const typeCode = p.asset_type_use;
      if (!typeCode) return;
      
      const typeName = interpretCodes.getTypeName(p, codeDefinitions, vendorType) || typeCode;
      
      if (!typeGroups[typeCode]) {
        typeGroups[typeCode] = {
          code: typeCode,
          description: typeName,
          properties: [],
          count: 0,
          totalPrice: 0,
          totalAdjPrice: 0,
          totalSize: 0
        };
      }
      
      const price = p.values_norm_time;
      let adjPrice = price;
      
      if (useJimFormula && p.asset_sfla) {
        // Jim's 50% formula
        const baseSize = 2000;
        const sizeDiff = p.asset_sfla - baseSize;
        const pricePerSF = price / p.asset_sfla;
        adjPrice = price + (sizeDiff * pricePerSF * 0.5);
      } else if (p.values_norm_size) {
        adjPrice = p.values_norm_size;
      }
      
      typeGroups[typeCode].properties.push(p);
      typeGroups[typeCode].count++;
      typeGroups[typeCode].totalPrice += price;
      typeGroups[typeCode].totalAdjPrice += adjPrice;
      typeGroups[typeCode].totalSize += (p.asset_sfla || 0);
    });

    // Calculate averages and find baseline
    let baseline = null;
    let maxCount = 0;
    
    Object.values(typeGroups).forEach(group => {
      group.avgPrice = group.totalPrice / group.count;
      group.avgAdjPrice = group.totalAdjPrice / group.count;
      group.avgSize = group.totalSize / group.count;
      
      if (group.count > maxCount) {
        maxCount = group.count;
        baseline = group.code;
      }
    });

    // Allow manual baseline override
    if (selectedBaseline && typeGroups[selectedBaseline]) {
      baseline = selectedBaseline;
    }

    // Calculate deltas
    const baselineGroup = typeGroups[baseline];
    Object.values(typeGroups).forEach(group => {
      if (group.code !== baseline) {
        group.priceDelta = group.avgAdjPrice - baselineGroup.avgAdjPrice;
        group.priceDeltaPercent = ((group.avgAdjPrice - baselineGroup.avgAdjPrice) / baselineGroup.avgAdjPrice * 100);
      } else {
        group.priceDelta = 0;
        group.priceDeltaPercent = 0;
      }
    });

    return {
      baseline,
      baselineDescription: baselineGroup.description,
      groups: typeGroups
    };
  };

  const analyzeDesignAndStyle = (properties) => {
    const designGroups = {};
    
    properties.forEach(p => {
      const designCode = p.asset_design_style;
      if (!designCode) return;
      
      const designName = interpretCodes.getDesignName(p, codeDefinitions, vendorType) || designCode;
      
      if (!designGroups[designCode]) {
        designGroups[designCode] = {
          code: designCode,
          description: designName,
          count: 0,
          totalPrice: 0,
          totalAdjPrice: 0,
          totalSize: 0,
          ages: []
        };
      }
      
      const price = p.values_norm_time;
      let adjPrice = price;
      
      if (useJimFormula && p.asset_sfla) {
        const baseSize = 2000;
        const sizeDiff = p.asset_sfla - baseSize;
        const pricePerSF = price / p.asset_sfla;
        adjPrice = price + (sizeDiff * pricePerSF * 0.5);
      } else if (p.values_norm_size) {
        adjPrice = p.values_norm_size;
      }
      
      designGroups[designCode].count++;
      designGroups[designCode].totalPrice += price;
      designGroups[designCode].totalAdjPrice += adjPrice;
      designGroups[designCode].totalSize += (p.asset_sfla || 0);
      if (p.asset_year_built) {
        designGroups[designCode].ages.push(new Date().getFullYear() - p.asset_year_built);
      }
    });

    // Calculate averages
    let mostPopular = null;
    let maxCount = 0;
    
    Object.values(designGroups).forEach(group => {
      group.avgPrice = group.totalPrice / group.count;
      group.avgAdjPrice = group.totalAdjPrice / group.count;
      group.avgSize = group.totalSize / group.count;
      group.avgAge = group.ages.length > 0 ? 
        group.ages.reduce((sum, age) => sum + age, 0) / group.ages.length : null;
      
      if (group.count > maxCount) {
        maxCount = group.count;
        mostPopular = group.code;
      }
    });

    // Calculate deltas from most popular
    const popularGroup = designGroups[mostPopular];
    Object.values(designGroups).forEach(group => {
      if (group.code !== mostPopular) {
        group.priceDelta = group.avgAdjPrice - popularGroup.avgAdjPrice;
        group.priceDeltaPercent = ((group.avgAdjPrice - popularGroup.avgAdjPrice) / popularGroup.avgAdjPrice * 100);
      } else {
        group.priceDelta = 0;
        group.priceDeltaPercent = 0;
      }
    });

    return {
      mostPopular,
      mostPopularDescription: popularGroup.description,
      groups: designGroups
    };
  };

  const analyzeVCSPatterns = (properties) => {
    const vcsAnalysis = {};
    
    // Group by VCS
    const vcsGroups = {};
    properties.forEach(p => {
      const vcs = p.property_vcs || p.newVCS;
      if (!vcs) return;
      
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = {
          code: vcs,
          description: interpretCodes.getVCSDescription(p, codeDefinitions, vendorType) || vcs,
          byType: {},
          byDesign: {},
          byCondition: {},
          totalCount: 0,
          totalValue: 0,
          ages: []
        };
      }
      
      const type = p.asset_type_use;
      if (!vcsGroups[vcs].byType[type]) {
        vcsGroups[vcs].byType[type] = [];
      }
      
      const design = p.asset_design_style;
      if (design && !vcsGroups[vcs].byDesign[design]) {
        vcsGroups[vcs].byDesign[design] = [];
      }
      
      const condition = p.asset_ext_cond;
      if (condition && !vcsGroups[vcs].byCondition[condition]) {
        vcsGroups[vcs].byCondition[condition] = [];
      }
      
      vcsGroups[vcs].byType[type].push(p);
      if (design) vcsGroups[vcs].byDesign[design].push(p);
      if (condition) vcsGroups[vcs].byCondition[condition].push(p);
      vcsGroups[vcs].totalCount++;
      vcsGroups[vcs].totalValue += p.values_norm_time;
      if (p.asset_year_built) {
        vcsGroups[vcs].ages.push(new Date().getFullYear() - p.asset_year_built);
      }
    });

    // Analyze each VCS
    Object.entries(vcsGroups).forEach(([vcsCode, vcsData]) => {
      const analysis = {
        code: vcsCode,
        description: vcsData.description,
        totalCount: vcsData.totalCount,
        avgValue: vcsData.totalValue / vcsData.totalCount,
        avgAge: vcsData.ages.length > 0 ? 
          vcsData.ages.reduce((sum, age) => sum + age, 0) / vcsData.ages.length : null,
        typeBreakdown: {},
        patterns: [],
        diversity: {
          typeCount: Object.keys(vcsData.byType).length,
          designCount: Object.keys(vcsData.byDesign).length,
          conditionSpread: Object.keys(vcsData.byCondition).length
        }
      };

      // Type breakdown
      Object.entries(vcsData.byType).forEach(([typeCode, props]) => {
        const typeName = props[0] ? interpretCodes.getTypeName(props[0], codeDefinitions, vendorType) : typeCode;
        
        const avgPrice = props.reduce((sum, p) => sum + p.values_norm_time, 0) / props.length;
        let avgAdjPrice = avgPrice;
        
        if (useJimFormula) {
          avgAdjPrice = props.reduce((sum, p) => {
            const price = p.values_norm_time;
            if (p.asset_sfla) {
              const baseSize = 2000;
              const sizeDiff = p.asset_sfla - baseSize;
              const pricePerSF = price / p.asset_sfla;
              return sum + (price + (sizeDiff * pricePerSF * 0.5));
            }
            return sum + price;
          }, 0) / props.length;
        } else {
          avgAdjPrice = props.reduce((sum, p) => sum + (p.values_norm_size || p.values_norm_time), 0) / props.length;
        }
        
        analysis.typeBreakdown[typeCode] = {
          description: typeName,
          count: props.length,
          avgPrice,
          avgAdjPrice,
          avgSize: props.reduce((sum, p) => sum + (p.asset_sfla || 0), 0) / props.length,
          percentage: (props.length / vcsData.totalCount * 100)
        };
      });

      // Look for interesting patterns using REAL data
      
      // Interior vs End Row Analysis (30 vs 31)
      if (vcsData.byType['30'] && vcsData.byType['31']) {
        const interior = vcsData.byType['30'];
        const end = vcsData.byType['31'];
        
        const intAvg = interior.reduce((sum, p) => sum + (p.values_norm_size || p.values_norm_time), 0) / interior.length;
        const endAvg = end.reduce((sum, p) => sum + (p.values_norm_size || p.values_norm_time), 0) / end.length;
        
        const difference = endAvg - intAvg;
        const percentDiff = (difference / intAvg * 100);
        
        analysis.patterns.push({
          type: 'ROW_POSITION',
          finding: `End units ${percentDiff > 0 ? 'premium' : 'discount'}: ${percentDiff.toFixed(1)}%`,
          realityCheck: Math.abs(percentDiff) < 5 ? 
            "Market shows negligible difference (<5%) - consider skipping adjustment" : 
            `Market supports ${Math.abs(percentDiff) > 10 ? 'significant' : 'moderate'} adjustment`,
          metrics: {
            interior: { count: interior.length, avgPrice: intAvg },
            end: { count: end.length, avgPrice: endAvg },
            difference,
            percentDiff
          }
        });
      }

      // Twin vs Single Family (10 vs 20)
      if (vcsData.byType['10'] && vcsData.byType['20']) {
        const singles = vcsData.byType['10'];
        const twins = vcsData.byType['20'];
        
        const singleAvg = singles.reduce((sum, p) => sum + (p.values_norm_size || p.values_norm_time), 0) / singles.length;
        const twinAvg = twins.reduce((sum, p) => sum + (p.values_norm_size || p.values_norm_time), 0) / twins.length;
        
        const difference = twinAvg - singleAvg;
        const percentDiff = (difference / singleAvg * 100);
        
        analysis.patterns.push({
          type: 'TWIN_VS_SINGLE',
          finding: `Twins trade at ${percentDiff.toFixed(1)}% ${percentDiff > 0 ? 'premium' : 'discount'} to singles`,
          metrics: {
            singles: { count: singles.length, avgPrice: singleAvg },
            twins: { count: twins.length, avgPrice: twinAvg },
            difference,
            percentDiff
          }
        });
      }

      // Condo analysis if significant presence
      if (vcsData.byType['60'] && vcsData.byType['60'].length > 5) {
        const condos = vcsData.byType['60'];
        const condoAvg = condos.reduce((sum, p) => sum + p.values_norm_time, 0) / condos.length;
        const condoSizeAvg = condos.reduce((sum, p) => sum + (p.asset_sfla || 0), 0) / condos.length;
        
        // Compare to overall VCS average
        const vcsAvg = vcsData.totalValue / vcsData.totalCount;
        const percentDiff = ((condoAvg - vcsAvg) / vcsAvg * 100);
        
        analysis.patterns.push({
          type: 'CONDO_PRESENCE',
          finding: `${condos.length} condos averaging ${Math.round(condoSizeAvg)} SF`,
          metrics: {
            count: condos.length,
            avgPrice: condoAvg,
            avgSize: condoSizeAvg,
            vsVCSAverage: percentDiff
          }
        });
      }

      // Only include VCS with meaningful data
      if (analysis.patterns.length > 0 || analysis.diversity.typeCount > 1) {
        vcsAnalysis[vcsCode] = analysis;
      }
    });

    return vcsAnalysis;
  };

  // NEW: Analyze condition patterns using REAL data
  const analyzeConditions = (properties) => {
    const conditions = {
      exterior: {},
      interior: {},
      correlations: []
    };
    
    // Group by exterior condition
    properties.forEach(p => {
      if (p.asset_ext_cond) {
        const condName = interpretCodes.getExteriorConditionName(p, codeDefinitions, vendorType) || p.asset_ext_cond;
        
        if (!conditions.exterior[p.asset_ext_cond]) {
          conditions.exterior[p.asset_ext_cond] = {
            code: p.asset_ext_cond,
            description: condName,
            count: 0,
            totalValue: 0,
            properties: []
          };
        }
        
        conditions.exterior[p.asset_ext_cond].count++;
        conditions.exterior[p.asset_ext_cond].totalValue += p.values_norm_time;
        conditions.exterior[p.asset_ext_cond].properties.push(p);
      }
      
      if (p.asset_int_cond) {
        const condName = interpretCodes.getInteriorConditionName(p, codeDefinitions, vendorType) || p.asset_int_cond;
        
        if (!conditions.interior[p.asset_int_cond]) {
          conditions.interior[p.asset_int_cond] = {
            code: p.asset_int_cond,
            description: condName,
            count: 0,
            totalValue: 0
          };
        }
        
        conditions.interior[p.asset_int_cond].count++;
        conditions.interior[p.asset_int_cond].totalValue += p.values_norm_time;
      }
    });
    
    // Calculate averages and find baseline (most common good condition)
    let baselineCondition = null;
    let maxCount = 0;
    
    Object.values(conditions.exterior).forEach(cond => {
      cond.avgValue = cond.totalValue / cond.count;
      
      // Look for "GOOD" or "AVERAGE" as baseline
      if ((cond.description?.includes('GOOD') || cond.description?.includes('AVERAGE')) && cond.count > maxCount) {
        maxCount = cond.count;
        baselineCondition = cond.code;
      }
    });
    
    // If no good/average found, use most common
    if (!baselineCondition) {
      Object.values(conditions.exterior).forEach(cond => {
        if (cond.count > maxCount) {
          maxCount = cond.count;
          baselineCondition = cond.code;
        }
      });
    }
    
    // Calculate condition adjustments
    if (baselineCondition && conditions.exterior[baselineCondition]) {
      const baselineAvg = conditions.exterior[baselineCondition].avgValue;
      
      Object.values(conditions.exterior).forEach(cond => {
        cond.adjustment = cond.avgValue - baselineAvg;
        cond.adjustmentPercent = ((cond.avgValue - baselineAvg) / baselineAvg * 100);
        cond.isBaseline = cond.code === baselineCondition;
      });
    }
    
    return conditions;
  };

  // NEW: Analyze age patterns using REAL data
  const analyzeAgePatterns = (properties) => {
    const currentYear = new Date().getFullYear();
    const ageGroups = {
      'New (0-5 years)': { min: 0, max: 5, properties: [], totalValue: 0 },
      'Recent (6-15 years)': { min: 6, max: 15, properties: [], totalValue: 0 },
      'Moderate (16-30 years)': { min: 16, max: 30, properties: [], totalValue: 0 },
      'Older (31-50 years)': { min: 31, max: 50, properties: [], totalValue: 0 },
      'Historic (50+ years)': { min: 51, max: 999, properties: [], totalValue: 0 }
    };
    
    properties.forEach(p => {
      if (p.asset_year_built) {
        const age = currentYear - p.asset_year_built;
        
        Object.entries(ageGroups).forEach(([groupName, group]) => {
          if (age >= group.min && age <= group.max) {
            group.properties.push(p);
            group.totalValue += p.values_norm_time;
          }
        });
      }
    });
    
    // Calculate statistics for each age group
    Object.values(ageGroups).forEach(group => {
      if (group.properties.length > 0) {
        group.count = group.properties.length;
        group.avgValue = group.totalValue / group.count;
        group.avgSize = group.properties.reduce((sum, p) => sum + (p.asset_sfla || 0), 0) / group.count;
      } else {
        group.count = 0;
        group.avgValue = 0;
        group.avgSize = 0;
      }
    });
    
    // Find depreciation pattern
    const depreciationCurve = [];
    Object.entries(ageGroups).forEach(([name, group]) => {
      if (group.count > 0) {
        depreciationCurve.push({
          name,
          avgAge: (group.min + group.max) / 2,
          avgValue: group.avgValue,
          count: group.count
        });
      }
    });
    
    return {
      groups: ageGroups,
      depreciationCurve,
      hasNewConstruction: ageGroups['New (0-5 years)'].count > 0
    };
  };

  // Statistical Analysis
  const performStatisticalAnalysis = (properties, typeUseResults) => {
    console.log('📈 Running statistical analysis...');
    
    const stats = {};
    
    // Overall market statistics
    const allPrices = properties.map(p => p.values_norm_time);
    stats.overall = {
      mean: calculateMean(allPrices),
      median: calculateMedian(allPrices),
      stdDev: calculateStdDev(allPrices),
      coefficient_variation: 0,
      quartiles: calculateQuartiles(allPrices),
      outliers: detectOutliers(allPrices),
      skewness: calculateSkewness(allPrices)
    };
    stats.overall.coefficient_variation = (stats.overall.stdDev / stats.overall.mean * 100).toFixed(2);
    
    // Per-type statistics
    stats.byType = {};
    Object.entries(typeUseResults.groups).forEach(([typeCode, group]) => {
      const typePrices = group.properties.map(p => p.values_norm_time);
      if (typePrices.length >= 3) {
        stats.byType[typeCode] = {
          description: group.description,
          count: typePrices.length,
          mean: calculateMean(typePrices),
          median: calculateMedian(typePrices),
          stdDev: calculateStdDev(typePrices),
          coefficient_variation: 0,
          quartiles: calculateQuartiles(typePrices),
          outliers: detectOutliers(typePrices),
          confidence_95: calculateConfidenceInterval(typePrices, 0.95),
          sample_adequacy: typePrices.length >= 30 ? 'EXCELLENT' : 
                          typePrices.length >= 10 ? 'GOOD' : 
                          typePrices.length >= 5 ? 'LIMITED' : 'INSUFFICIENT'
        };
        stats.byType[typeCode].coefficient_variation = 
          (stats.byType[typeCode].stdDev / stats.byType[typeCode].mean * 100).toFixed(2);
      }
    });
    
    // Market uniformity
    stats.uniformity = {
      overall_cv: stats.overall.coefficient_variation,
      interpretation: stats.overall.coefficient_variation < 15 ? 'HIGHLY UNIFORM' :
                     stats.overall.coefficient_variation < 25 ? 'MODERATELY UNIFORM' :
                     stats.overall.coefficient_variation < 35 ? 'VARIED' : 'HIGHLY VARIED',
      outlier_impact: (stats.overall.outliers.length / properties.length * 100).toFixed(1) + '%',
      skewness_interpretation: Math.abs(stats.overall.skewness) < 0.5 ? 'SYMMETRIC' :
                              stats.overall.skewness > 0 ? 'RIGHT SKEWED (luxury properties pulling up)' :
                              'LEFT SKEWED (distressed properties pulling down)'
    };
    
    stats.summary = {
      total_properties: properties.length,
      price_range: {
        min: Math.min(...allPrices),
        max: Math.max(...allPrices),
        spread: Math.max(...allPrices) - Math.min(...allPrices)
      },
      central_tendency: {
        mean: stats.overall.mean,
        median: stats.overall.median,
        mode: calculateMode(allPrices),
        mean_median_diff: ((stats.overall.mean - stats.overall.median) / stats.overall.median * 100).toFixed(1) + '%'
      }
    };
    
    return stats;
  };

  // Confidence Scoring
  const calculateConfidenceScores = (typeUse, design, vcs, stats) => {
    console.log('🎯 Calculating confidence scores...');
    
    const confidence = {
      adjustments: {},
      overall: {},
      warnings: []
    };
    
    // Score each type adjustment
    Object.entries(typeUse.groups).forEach(([typeCode, group]) => {
      if (typeCode !== typeUse.baseline) {
        const sampleSize = group.count;
        const statsData = stats.byType[typeCode];
        
        let score = 100;
        let factors = [];
        
        // Sample size impact
        if (sampleSize < 3) {
          score -= 50;
          factors.push('Extremely small sample');
        } else if (sampleSize < 5) {
          score -= 35;
          factors.push('Very small sample');
        } else if (sampleSize < 10) {
          score -= 20;
          factors.push('Small sample');
        } else if (sampleSize < 30) {
          score -= 10;
          factors.push('Moderate sample');
        }
        
        // Variability impact
        if (statsData?.coefficient_variation > 35) {
          score -= 25;
          factors.push('Very high variability');
        } else if (statsData?.coefficient_variation > 25) {
          score -= 15;
          factors.push('High variability');
        } else if (statsData?.coefficient_variation > 20) {
          score -= 5;
          factors.push('Moderate variability');
        }
        
        // Outlier impact
        if (statsData?.outliers.length > sampleSize * 0.15) {
          score -= 20;
          factors.push('Many outliers');
        } else if (statsData?.outliers.length > sampleSize * 0.05) {
          score -= 10;
          factors.push('Some outliers');
        }
        
        confidence.adjustments[typeCode] = {
          description: group.description,
          adjustment_percent: group.priceDeltaPercent,
          confidence_score: Math.max(0, score),
          confidence_level: score >= 80 ? 'HIGH' : 
                           score >= 60 ? 'MODERATE' : 
                           score >= 40 ? 'LOW' : 'VERY LOW',
          factors,
          sample_size: sampleSize,
          recommendation: score < 60 ? 
            'Use with caution - limited market support' :
            score < 40 ?
            'NOT RECOMMENDED - insufficient data' :
            'Reasonable market support'
        };
        
        if (score < 40) {
          confidence.warnings.push(
            `⚠️ ${group.description} adjustment (${group.priceDeltaPercent.toFixed(1)}%) has confidence score of only ${score}%`
          );
        }
      }
    });
    
    // Overall market confidence
    const allScores = Object.values(confidence.adjustments).map(a => a.confidence_score);
    confidence.overall = {
      average_score: allScores.length > 0 ? calculateMean(allScores) : 100,
      lowest_score: allScores.length > 0 ? Math.min(...allScores) : 100,
      highest_score: allScores.length > 0 ? Math.max(...allScores) : 100,
      market_quality: allScores.length === 0 ? 'BASELINE ONLY' :
                     calculateMean(allScores) >= 70 ? 'STRONG' :
                     calculateMean(allScores) >= 50 ? 'MODERATE' : 
                     calculateMean(allScores) >= 30 ? 'WEAK' : 'INSUFFICIENT DATA'
    };
    
    return confidence;
  };

  // VCS Heat Map
  const generateVCSHeatMap = (properties, vcsPatterns) => {
    console.log('🗺️ Generating VCS heat map...');
    
    const heatMap = {
      cells: [],
      scale: {
        min: Infinity,
        max: -Infinity,
        median: 0
      }
    };
    
    // Use the analysis we already did
    Object.values(vcsPatterns).forEach(vcs => {
      const cell = {
        vcs: vcs.code,
        description: vcs.description,
        avg_value: vcs.avgValue,
        count: vcs.totalCount,
        diversity: vcs.diversity,
        hasPatterns: vcs.patterns.length > 0,
        color: '',
        intensity: 0
      };
      
      heatMap.cells.push(cell);
      
      if (vcs.avgValue < heatMap.scale.min) heatMap.scale.min = vcs.avgValue;
      if (vcs.avgValue > heatMap.scale.max) heatMap.scale.max = vcs.avgValue;
    });
    
    // Calculate median
    const sortedValues = heatMap.cells.map(c => c.avg_value).sort((a,b) => a - b);
    heatMap.scale.median = sortedValues[Math.floor(sortedValues.length / 2)];
    
    // Assign colors
    heatMap.cells.forEach(cell => {
      const range = heatMap.scale.max - heatMap.scale.min;
      const position = (cell.avg_value - heatMap.scale.min) / range;
      cell.intensity = position;
      
      if (position < 0.33) {
        cell.color = '#FEE2E2';
        cell.colorHex = '#EF4444';
      } else if (position < 0.67) {
        cell.color = '#FEF3C7';
        cell.colorHex = '#F59E0B';
      } else {
        cell.color = '#D1FAE5';
        cell.colorHex = '#10B981';
      }
    });
    
    heatMap.cells.sort((a, b) => b.avg_value - a.avg_value);
    
    return heatMap;
  };

  // Generate insights
  const generateEnhancedMarketInsights = (typeUse, design, vcs, stats, confidence, conditions, age) => {
    const insights = [];
    
    // Statistical insights
    if (stats.uniformity.interpretation === 'HIGHLY VARIED') {
      insights.push({
        category: 'MARKET_CONDITION',
        severity: 'high',
        message: `High market variability (CV: ${stats.uniformity.overall_cv}%) indicates diverse property values`,
        value: parseFloat(stats.uniformity.overall_cv),
        icon: '📊'
      });
    }
    
    // Skewness insight
    if (Math.abs(stats.overall.skewness) > 1) {
      insights.push({
        category: 'MARKET_SHAPE',
        severity: 'medium',
        message: `Market is ${stats.uniformity.skewness_interpretation}`,
        value: stats.overall.skewness,
        icon: '📈'
      });
    }
    
    // Confidence warnings
    confidence.warnings.forEach(warning => {
      insights.push({
        category: 'CONFIDENCE',
        severity: 'high',
        message: warning,
        value: 0,
        icon: '⚠️'
      });
    });
    
    // Type/Use insights
    Object.values(typeUse.groups).forEach(group => {
      if (group.code !== typeUse.baseline && Math.abs(group.priceDeltaPercent) > 15) {
        const conf = confidence.adjustments[group.code];
        insights.push({
          category: 'TYPE_ADJUSTMENT',
          severity: conf?.confidence_level === 'HIGH' ? 'medium' : 'high',
          message: `${group.description}: ${Math.abs(group.priceDeltaPercent).toFixed(0)}% ${group.priceDeltaPercent > 0 ? 'premium' : 'discount'} (${conf?.confidence_level} confidence)`,
          value: group.priceDeltaPercent,
          icon: group.priceDeltaPercent > 0 ? '⬆️' : '⬇️'
        });
      }
    });
    
    // Design insights
    const colonialGroup = Object.values(design.groups).find(g => 
      g.description?.toUpperCase().includes('COLONIAL')
    );
    if (colonialGroup && Math.abs(colonialGroup.priceDeltaPercent) > 10) {
      insights.push({
        category: 'DESIGN_PREMIUM',
        severity: 'medium',
        message: `Colonial design shows ${colonialGroup.priceDeltaPercent.toFixed(0)}% ${colonialGroup.priceDeltaPercent > 0 ? 'premium' : 'discount'}`,
        value: colonialGroup.priceDeltaPercent,
        icon: '🏛️'
      });
    }
    
    // VCS Reality checks
    Object.values(vcs).forEach(vcsData => {
      vcsData.patterns?.forEach(pattern => {
        if (pattern.type === 'ROW_POSITION' && pattern.metrics) {
          if (Math.abs(pattern.metrics.percentDiff) < 5) {
            insights.push({
              category: 'REALITY_CHECK',
              severity: 'info',
              message: `${vcsData.description}: End vs Interior difference only ${Math.abs(pattern.metrics.percentDiff).toFixed(1)}% - traditional adjustment may be unnecessary`,
              value: pattern.metrics.percentDiff,
              icon: '💡'
            });
          } else if (Math.abs(pattern.metrics.percentDiff) > 15) {
            insights.push({
              category: 'SIGNIFICANT_PATTERN',
              severity: 'medium',
              message: `${vcsData.description}: End units show ${Math.abs(pattern.metrics.percentDiff).toFixed(0)}% ${pattern.metrics.percentDiff > 0 ? 'premium' : 'discount'}`,
              value: pattern.metrics.percentDiff,
              icon: '🏘️'
            });
          }
        }
      });
    });
    
    // Condition insights
    if (conditions?.exterior) {
      const poorConditions = Object.values(conditions.exterior).filter(c => 
        c.description?.includes('POOR') || c.description?.includes('FAIR')
      );
      if (poorConditions.length > 0) {
        const totalPoor = poorConditions.reduce((sum, c) => sum + c.count, 0);
        const totalProps = Object.values(conditions.exterior).reduce((sum, c) => sum + c.count, 0);
        const poorPercent = (totalPoor / totalProps * 100);
        if (poorPercent > 20) {
          insights.push({
            category: 'CONDITION_ALERT',
            severity: 'high',
            message: `${poorPercent.toFixed(0)}% of properties in Fair/Poor condition - condition adjustments critical`,
            value: poorPercent,
            icon: '🔧'
          });
        }
      }
    }
    
    // Age insights
    if (age?.hasNewConstruction) {
      const newCount = age.groups['New (0-5 years)'].count;
      const totalWithAge = Object.values(age.groups).reduce((sum, g) => sum + g.count, 0);
      const newPercent = (newCount / totalWithAge * 100);
      if (newPercent > 10) {
        insights.push({
          category: 'NEW_CONSTRUCTION',
          severity: 'medium',
          message: `${newPercent.toFixed(0)}% new construction (0-5 years) in market`,
          value: newPercent,
          icon: '🏗️'
        });
      }
    }
    
    // Sort by severity
    insights.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return Math.abs(b.value) - Math.abs(a.value);
    });
    
    return insights;
  };

  // Helper functions
  const calculateMean = (values) => {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  };

  const calculateMedian = (values) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const calculateStdDev = (values) => {
    if (values.length === 0) return 0;
    const mean = calculateMean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return Math.sqrt(calculateMean(squaredDiffs));
  };

  const calculateQuartiles = (values) => {
    if (values.length === 0) return { q1: 0, q2: 0, q3: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const q2 = calculateMedian(sorted);
    const lowerHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const upperHalf = sorted.slice(Math.ceil(sorted.length / 2));
    return {
      q1: calculateMedian(lowerHalf),
      q2: q2,
      q3: calculateMedian(upperHalf)
    };
  };

  const detectOutliers = (values) => {
    if (values.length < 4) return [];
    const quartiles = calculateQuartiles(values);
    const iqr = quartiles.q3 - quartiles.q1;
    const lowerBound = quartiles.q1 - (1.5 * iqr);
    const upperBound = quartiles.q3 + (1.5 * iqr);
    return values.filter(val => val < lowerBound || val > upperBound);
  };

  const calculateMode = (values) => {
    if (values.length === 0) return 0;
    const frequency = {};
    values.forEach(val => {
      const rounded = Math.round(val / 10000) * 10000;
      frequency[rounded] = (frequency[rounded] || 0) + 1;
    });
    let mode = null;
    let maxFreq = 0;
    Object.entries(frequency).forEach(([val, freq]) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        mode = parseFloat(val);
      }
    });
    return mode;
  };

  const calculateSkewness = (values) => {
    if (values.length < 3) return 0;
    const mean = calculateMean(values);
    const stdDev = calculateStdDev(values);
    const n = values.length;
    const cubedDiffs = values.map(val => Math.pow((val - mean) / stdDev, 3));
    return (n / ((n - 1) * (n - 2))) * cubedDiffs.reduce((sum, val) => sum + val, 0);
  };

  const calculateConfidenceInterval = (values, confidence = 0.95) => {
    const mean = calculateMean(values);
    const stdDev = calculateStdDev(values);
    const n = values.length;
    const z = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;
    const margin = z * (stdDev / Math.sqrt(n));
    return {
      lower: mean - margin,
      upper: mean + margin,
      margin
    };
  };

  // Export functions
  const exportToExcel = () => {
    if (!analysisResults) {
      alert('No analysis results to export');
      return;
    }
    
    let csv = 'OVERALL MARKET ANALYSIS REPORT\n';
    csv += `Job: ${jobData.municipality} ${jobData.county}\n`;
    csv += `Generated: ${new Date().toLocaleString()}\n`;
    csv += `Properties Analyzed: ${analysisResults.property_count}\n`;
    csv += `Formula: ${analysisResults.jim_formula_applied ? 'Jim 50% Size Adjustment' : 'Standard Normalization'}\n\n`;
    
    // Market Insights
    csv += 'KEY MARKET INSIGHTS\n';
    analysisResults.market_insights?.forEach(insight => {
      csv += `${insight.icon} ${insight.message}\n`;
    });
    csv += '\n';
    
    // Type & Use Analysis
    csv += 'TYPE AND USE ANALYSIS\n';
    csv += `Baseline: ${analysisResults.type_use_analysis.baselineDescription}\n`;
    csv += 'Code,Description,Count,Avg Price,Adj Price,Avg Size,Delta %,Confidence\n';
    Object.values(analysisResults.type_use_analysis.groups).forEach(group => {
      const conf = confidenceMetrics?.adjustments[group.code];
      csv += `${group.code},"${group.description}",${group.count},`;
      csv += `${Math.round(group.avgPrice)},${Math.round(group.avgAdjPrice)},`;
      csv += `${Math.round(group.avgSize)},`;
      csv += `${group.priceDeltaPercent?.toFixed(1) || '0'},`;
      csv += `${conf?.confidence_level || 'BASELINE'}\n`;
    });
    csv += '\n';
    
    // Design & Style Analysis
    csv += 'DESIGN AND STYLE ANALYSIS\n';
    csv += `Most Popular: ${analysisResults.design_style_analysis.mostPopularDescription}\n`;
    csv += 'Design,Count,Avg Price,Adj Price,Avg Size,Premium %\n';
    Object.values(analysisResults.design_style_analysis.groups).forEach(group => {
      csv += `"${group.description}",${group.count},`;
      csv += `${Math.round(group.avgPrice)},${Math.round(group.avgAdjPrice)},`;
      csv += `${Math.round(group.avgSize)},`;
      csv += `${group.priceDeltaPercent?.toFixed(1) || '0'}\n`;
    });
    csv += '\n';
    
    // VCS Analysis
    csv += 'VCS (NEIGHBORHOOD) ANALYSIS\n';
    Object.values(analysisResults.vcs_patterns).forEach(vcs => {
      csv += `\n${vcs.description || vcs.code}\n`;
      csv += `Properties: ${vcs.totalCount}, Avg Value: $${Math.round(vcs.avgValue)}\n`;
      csv += `Property Type Diversity: ${vcs.diversity.typeCount} types\n`;
      
      if (vcs.patterns.length > 0) {
        csv += 'Patterns Found:\n';
        vcs.patterns.forEach(pattern => {
          csv += `- ${pattern.finding}\n`;
          if (pattern.realityCheck) {
            csv += `  Reality Check: ${pattern.realityCheck}\n`;
          }
        });
      }
    });
    csv += '\n';
    
    // Statistical Summary
    if (statisticalAnalysis) {
      csv += 'STATISTICAL SUMMARY\n';
      csv += `Market Uniformity: ${statisticalAnalysis.uniformity.interpretation}\n`;
      csv += `Coefficient of Variation: ${statisticalAnalysis.uniformity.overall_cv}%\n`;
      csv += `Price Range: $${Math.round(statisticalAnalysis.summary.price_range.min)} - $${Math.round(statisticalAnalysis.summary.price_range.max)}\n`;
      csv += `Mean: $${Math.round(statisticalAnalysis.summary.central_tendency.mean)}\n`;
      csv += `Median: $${Math.round(statisticalAnalysis.summary.central_tendency.median)}\n`;
      csv += `Outliers: ${statisticalAnalysis.overall.outliers.length} detected\n`;
    }
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market_analysis_${jobData.municipality}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    console.log('📊 Excel export completed');
  };

  const saveAnalysis = async () => {
    if (!analysisResults) return;
    
    setIsSaving(true);
    try {
      const updateData = {
        job_id: jobData.id,
        overall_analysis_results: analysisResults,
        overall_analysis_config: {
          useJimFormula,
          selectedBaseline,
          filters: filterConfig,
          lastRun: new Date()
        },
        overall_analysis_updated_at: new Date(),
        overall_analysis_stale: false,
        confidence_metrics: confidenceMetrics,
        statistical_analysis: statisticalAnalysis,
        updated_at: new Date()
      };
      
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert(updateData, {
          onConflict: 'job_id'
        });

      if (error) throw error;
      
      alert('✅ Analysis saved successfully!');
    } catch (error) {
      console.error('Error saving analysis:', error);
      alert('❌ Error saving analysis. Check console for details.');
    } finally {
      setIsSaving(false);
    }
  };

  // ... Continue with all render functions ...
  // [I'll continue with the render functions in the next part due to length]

  return (
    <div style={{ padding: '20px' }}>
      {/* Control Bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px',
        padding: '16px',
        background: 'white',
        border: '1px solid #E5E7EB',
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => setUseJimFormula(!useJimFormula)}
            style={{
              padding: '8px 16px',
              background: useJimFormula ? '#3B82F6' : 'white',
              color: useJimFormula ? 'white' : '#3B82F6',
              border: '1px solid #3B82F6',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {useJimFormula ? '📊 Jim Formula Active' : '📈 Standard Normalization'}
          </button>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: '8px 16px',
              background: 'white',
              color: '#6B7280',
              border: '1px solid #E5E7EB',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Filter size={16} style={{ marginRight: '6px' }} />
            Filters {Object.values(filterConfig).some(v => v !== 0 && v !== 999999999 && v !== 1900 && v !== 2025 && v.length !== 0) && '(Active)'}
          </button>
          
          <button
            onClick={runCompleteAnalysis}
            disabled={isCalculating}
            style={{
              padding: '8px 16px',
              background: '#10B981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isCalculating ? 'not-allowed' : 'pointer',
              opacity: isCalculating ? 0.5 : 1,
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <RefreshCw size={16} style={{ 
              marginRight: '6px',
              animation: isCalculating ? 'spin 1s linear infinite' : 'none'
            }} />
            {isCalculating ? 'Analyzing...' : 'Refresh Analysis'}
          </button>
          
          <button
            onClick={saveAnalysis}
            disabled={!analysisResults || isSaving}
            style={{
              padding: '8px 16px',
              background: '#3B82F6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: !analysisResults || isSaving ? 'not-allowed' : 'pointer',
              opacity: !analysisResults || isSaving ? 0.5 : 1,
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Save size={16} style={{ marginRight: '6px' }} />
            {isSaving ? 'Saving...' : 'Save Analysis'}
          </button>
          
          <button
            onClick={exportToExcel}
            disabled={!analysisResults}
            style={{
              padding: '8px 16px',
              background: '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: !analysisResults ? 'not-allowed' : 'pointer',
              opacity: !analysisResults ? 0.5 : 1,
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Download size={16} style={{ marginRight: '6px' }} />
            Export
          </button>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {lastAnalysisTime && (
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
              Last run: {new Date(lastAnalysisTime).toLocaleString()}
            </span>
          )}
          {analysisResults && (
            <span style={{ 
              background: '#EFF6FF', 
              color: '#3B82F6', 
              padding: '4px 12px', 
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '500'
            }}>
              {analysisResults.property_count} Properties
            </span>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div style={{
          marginBottom: '20px',
          padding: '16px',
          background: 'white',
          border: '1px solid #E5E7EB',
          borderRadius: '8px'
        }}>
          <h4 style={{ marginBottom: '12px', fontSize: '16px', fontWeight: '600' }}>Filter Properties</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Min Price</label>
              <input
                type="number"
                value={filterConfig.minSalePrice}
                onChange={(e) => setFilterConfig({...filterConfig, minSalePrice: parseInt(e.target.value) || 0})}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Max Price</label>
              <input
                type="number"
                value={filterConfig.maxSalePrice}
                onChange={(e) => setFilterConfig({...filterConfig, maxSalePrice: parseInt(e.target.value) || 999999999})}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Min Size (SF)</label>
              <input
                type="number"
                value={filterConfig.minSize}
                onChange={(e) => setFilterConfig({...filterConfig, minSize: parseInt(e.target.value) || 0})}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Max Size (SF)</label>
              <input
                type="number"
                value={filterConfig.maxSize}
                onChange={(e) => setFilterConfig({...filterConfig, maxSize: parseInt(e.target.value) || 999999})}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '4px'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: '#6B7280' }}>Year Built Min</label>
              <input
                type="number"
                value={filterConfig.yearBuiltMin}
                onChange={(e) => setFilterConfig({...filterConfig, yearBuiltMin: parseInt(e.target.value) || 1900})}
                style={{
                  width: '100%',
                 padding: '6px',
                 border: '1px solid #E5E7EB',
                 borderRadius: '4px'
               }}
             />
           </div>
           <div>
             <label style={{ fontSize: '12px', color: '#6B7280' }}>Year Built Max</label>
             <input
               type="number"
               value={filterConfig.yearBuiltMax}
               onChange={(e) => setFilterConfig({...filterConfig, yearBuiltMax: parseInt(e.target.value) || 2025})}
               style={{
                 width: '100%',
                 padding: '6px',
                 border: '1px solid #E5E7EB',
                 borderRadius: '4px'
               }}
             />
           </div>
         </div>
         <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
           <button
             onClick={() => {
               setFilterConfig({
                 minSalePrice: 0,
                 maxSalePrice: 999999999,
                 minSize: 0,
                 maxSize: 999999,
                 excludeTypes: [],
                 yearBuiltMin: 1900,
                 yearBuiltMax: 2025
               });
             }}
             style={{
               padding: '6px 12px',
               background: '#EF4444',
               color: 'white',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer',
               fontSize: '12px'
             }}
           >
             Clear Filters
           </button>
           <button
             onClick={runCompleteAnalysis}
             style={{
               padding: '6px 12px',
               background: '#3B82F6',
               color: 'white',
               border: 'none',
               borderRadius: '4px',
               cursor: 'pointer',
               fontSize: '12px'
             }}
           >
             Apply Filters
           </button>
         </div>
       </div>
     )}

     {/* Tab Navigation */}
     <div style={{ 
       display: 'flex', 
       gap: '2px',
       marginBottom: '20px',
       background: 'white',
       padding: '4px',
       borderRadius: '8px',
       border: '1px solid #E5E7EB'
     }}>
       {['overview', 'statistical', 'vcs', 'conditions'].map(tab => (
         <button
           key={tab}
           onClick={() => setActiveTab(tab)}
           style={{
             flex: 1,
             padding: '10px',
             background: activeTab === tab ? '#3B82F6' : 'transparent',
             color: activeTab === tab ? 'white' : '#6B7280',
             border: 'none',
             borderRadius: '4px',
             cursor: 'pointer',
             fontSize: '14px',
             fontWeight: '500',
             textTransform: 'capitalize'
           }}
         >
           {tab === 'vcs' ? 'VCS/Neighborhoods' : tab}
         </button>
       ))}
     </div>

     {/* Content based on active tab */}
     {analysisResults ? (
       <>
         {activeTab === 'overview' && (
           <>
             {renderInsights()}
             {renderTypeUseTable()}
             {renderDesignStyleTable()}
           </>
         )}
         
         {activeTab === 'statistical' && (
           <>
             {renderStatisticalSummary()}
             {renderConfidenceScores()}
             {renderAgeAnalysis()}
           </>
         )}
         
         {activeTab === 'vcs' && (
           <>
             {renderVCSHeatMap()}
             {renderVCSPatterns()}
           </>
         )}
         
         {activeTab === 'conditions' && (
           <>
             {renderConditionAnalysis()}
           </>
         )}
       </>
     ) : (
       <div style={{ 
         textAlign: 'center', 
         padding: '60px',
         background: 'white',
         border: '1px solid #E5E7EB',
         borderRadius: '8px'
       }}>
         <BarChart size={48} style={{ margin: '0 auto 16px', color: '#9CA3AF' }} />
         <p style={{ color: '#6B7280' }}>
           {isCalculating ? 'Analyzing market patterns...' : 'Click "Refresh Analysis" to generate market insights'}
         </p>
       </div>
     )}

     <style jsx>{`
       @keyframes spin {
         from { transform: rotate(0deg); }
         to { transform: rotate(360deg); }
       }
     `}</style>
   </div>
 );

 // Render functions
 function renderInsights() {
   if (!analysisResults?.market_insights || analysisResults.market_insights.length === 0) {
     return null;
   }
   
   const severityColors = {
     high: { bg: '#FEE2E2', color: '#991B1B' },
     medium: { bg: '#FEF3C7', color: '#92400E' },
     low: { bg: '#D1FAE5', color: '#065F46' },
     info: { bg: '#EFF6FF', color: '#1E40AF' }
   };
   
   return (
     <div style={{ 
       background: 'white', 
       border: '2px solid #3B82F6', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <TrendingUp size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         Key Market Insights
       </h3>
       
       {analysisResults.market_insights.slice(0, 5).map((insight, idx) => (
         <div key={idx} style={{ 
           marginBottom: '12px',
           padding: '12px',
           background: severityColors[insight.severity].bg,
           borderRadius: '6px',
           display: 'flex',
           alignItems: 'flex-start'
         }}>
           <span style={{ marginRight: '12px', fontSize: '18px' }}>
             {insight.icon}
           </span>
           <div style={{ flex: 1 }}>
             <div style={{ 
               fontSize: '12px', 
               color: severityColors[insight.severity].color,
               fontWeight: '600',
               marginBottom: '4px'
             }}>
               {insight.category.replace(/_/g, ' ')}
             </div>
             <div style={{ color: severityColors[insight.severity].color, fontSize: '14px' }}>
               {insight.message}
             </div>
             {insight.recommendation && (
               <div style={{ 
                 marginTop: '6px', 
                 fontSize: '12px', 
                 fontStyle: 'italic',
                 color: severityColors[insight.severity].color 
               }}>
                 Recommendation: {insight.recommendation}
               </div>
             )}
           </div>
         </div>
       ))}
       
       {analysisResults.market_insights.length > 5 && (
         <div style={{ 
           textAlign: 'center', 
           marginTop: '12px',
           fontSize: '12px',
           color: '#6B7280'
         }}>
           +{analysisResults.market_insights.length - 5} more insights available
         </div>
       )}
     </div>
   );
 }

 function renderTypeUseTable() {
   if (!analysisResults?.type_use_analysis) return null;
   
   const { baseline, groups } = analysisResults.type_use_analysis;
   const sortedGroups = Object.values(groups).sort((a, b) => b.count - a.count);
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
         <h3 style={{ fontSize: '18px', fontWeight: '600', display: 'flex', alignItems: 'center' }}>
           <Home size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
           Type & Use Analysis
         </h3>
         <span style={{ 
           background: '#EFF6FF', 
           color: '#3B82F6', 
           padding: '4px 12px', 
           borderRadius: '4px',
           fontSize: '12px'
         }}>
           Baseline: {groups[baseline]?.description}
         </span>
       </div>
       
       <div style={{ overflowX: 'auto' }}>
         <table style={{ width: '100%', borderCollapse: 'collapse' }}>
           <thead>
             <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
               <th style={{ padding: '12px', textAlign: 'left' }}>Type</th>
               <th style={{ padding: '12px', textAlign: 'center' }}>Count</th>
               <th style={{ padding: '12px', textAlign: 'right' }}>Avg Price</th>
               <th style={{ padding: '12px', textAlign: 'right' }}>Adj Price</th>
               <th style={{ padding: '12px', textAlign: 'right' }}>Size</th>
               <th style={{ padding: '12px', textAlign: 'right' }}>Delta</th>
               <th style={{ padding: '12px', textAlign: 'center' }}>Confidence</th>
               <th style={{ padding: '12px', textAlign: 'center' }}>Action</th>
             </tr>
           </thead>
           <tbody>
             {sortedGroups.map(group => {
               const conf = confidenceMetrics?.adjustments[group.code];
               return (
                 <tr 
                   key={group.code} 
                   style={{ 
                     borderBottom: '1px solid #E5E7EB',
                     backgroundColor: group.code === baseline ? '#FEF3C7' : 'white'
                   }}
                 >
                   <td style={{ padding: '12px', fontWeight: group.code === baseline ? '600' : '400' }}>
                     {group.description}
                     {group.code === baseline && (
                       <span style={{ 
                         marginLeft: '8px',
                         padding: '2px 6px',
                         background: '#F59E0B',
                         color: 'white',
                         borderRadius: '4px',
                         fontSize: '10px'
                       }}>
                         BASELINE
                       </span>
                     )}
                   </td>
                   <td style={{ padding: '12px', textAlign: 'center' }}>{group.count}</td>
                   <td style={{ padding: '12px', textAlign: 'right' }}>
                     ${Math.round(group.avgPrice).toLocaleString()}
                   </td>
                   <td style={{ padding: '12px', textAlign: 'right' }}>
                     ${Math.round(group.avgAdjPrice).toLocaleString()}
                   </td>
                   <td style={{ padding: '12px', textAlign: 'right' }}>
                     {Math.round(group.avgSize).toLocaleString()} SF
                   </td>
                   <td style={{ 
                     padding: '12px', 
                     textAlign: 'right',
                     color: group.priceDeltaPercent > 0 ? '#10B981' : group.priceDeltaPercent < 0 ? '#EF4444' : '#6B7280',
                     fontWeight: Math.abs(group.priceDeltaPercent) > 20 ? '600' : '400'
                   }}>
                     {group.code === baseline ? 
                       '—' : 
                       `${group.priceDeltaPercent > 0 ? '+' : ''}${group.priceDeltaPercent.toFixed(1)}%`
                     }
                   </td>
                   <td style={{ padding: '12px', textAlign: 'center' }}>
                     {conf && (
                       <span style={{
                         padding: '2px 8px',
                         borderRadius: '4px',
                         fontSize: '11px',
                         background: conf.confidence_level === 'HIGH' ? '#D1FAE5' :
                                    conf.confidence_level === 'MODERATE' ? '#FEF3C7' :
                                    conf.confidence_level === 'LOW' ? '#FEE2E2' : '#FEE2E2',
                         color: conf.confidence_level === 'HIGH' ? '#065F46' :
                               conf.confidence_level === 'MODERATE' ? '#92400E' :
                               conf.confidence_level === 'LOW' ? '#991B1B' : '#991B1B'
                       }}>
                         {conf.confidence_level}
                       </span>
                     )}
                   </td>
                   <td style={{ padding: '12px', textAlign: 'center' }}>
                     {group.code !== baseline && (
                       <button
                         onClick={() => {
                           setSelectedBaseline(group.code);
                           runCompleteAnalysis();
                         }}
                         style={{
                           padding: '4px 8px',
                           fontSize: '11px',
                           background: '#3B82F6',
                           color: 'white',
                           border: 'none',
                           borderRadius: '4px',
                           cursor: 'pointer'
                         }}
                       >
                         Set Baseline
                       </button>
                     )}
                   </td>
                 </tr>
               );
             })}
           </tbody>
         </table>
       </div>
     </div>
   );
 }

 function renderDesignStyleTable() {
   if (!analysisResults?.design_style_analysis) return null;
   
   const { mostPopular, groups } = analysisResults.design_style_analysis;
   const sortedGroups = Object.values(groups).sort((a, b) => b.count - a.count);
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
         <h3 style={{ fontSize: '18px', fontWeight: '600', display: 'flex', alignItems: 'center' }}>
           <Building size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
           Design & Style Analysis
         </h3>
         <span style={{ 
           background: '#D1FAE5', 
           color: '#065F46', 
           padding: '4px 12px', 
           borderRadius: '4px',
           fontSize: '12px'
         }}>
           Most Popular: {groups[mostPopular]?.description} ({groups[mostPopular]?.count} sales)
         </span>
       </div>
       
       <table style={{ width: '100%', borderCollapse: 'collapse' }}>
         <thead>
           <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
             <th style={{ padding: '12px', textAlign: 'left' }}>Design</th>
             <th style={{ padding: '12px', textAlign: 'center' }}>Count</th>
             <th style={{ padding: '12px', textAlign: 'right' }}>Avg Price</th>
             <th style={{ padding: '12px', textAlign: 'right' }}>Adj Price</th>
             <th style={{ padding: '12px', textAlign: 'right' }}>Avg Size</th>
             <th style={{ padding: '12px', textAlign: 'right' }}>Avg Age</th>
             <th style={{ padding: '12px', textAlign: 'right' }}>Premium/Discount</th>
           </tr>
         </thead>
         <tbody>
           {sortedGroups.map(group => (
             <tr 
               key={group.code} 
               style={{ 
                 borderBottom: '1px solid #E5E7EB',
                 backgroundColor: group.code === mostPopular ? '#D1FAE5' : 'white'
               }}
             >
               <td style={{ padding: '12px', fontWeight: group.code === mostPopular ? '600' : '400' }}>
                 {group.description}
                 {group.code === mostPopular && (
                   <span style={{ 
                     marginLeft: '8px',
                     padding: '2px 6px',
                     background: '#10B981',
                     color: 'white',
                     borderRadius: '4px',
                     fontSize: '10px'
                   }}>
                     POPULAR
                   </span>
                 )}
               </td>
               <td style={{ padding: '12px', textAlign: 'center' }}>{group.count}</td>
               <td style={{ padding: '12px', textAlign: 'right' }}>
                 ${Math.round(group.avgPrice).toLocaleString()}
               </td>
               <td style={{ padding: '12px', textAlign: 'right' }}>
                 ${Math.round(group.avgAdjPrice).toLocaleString()}
               </td>
               <td style={{ padding: '12px', textAlign: 'right' }}>
                 {Math.round(group.avgSize).toLocaleString()} SF
               </td>
               <td style={{ padding: '12px', textAlign: 'right' }}>
                 {group.avgAge ? `${Math.round(group.avgAge)} yrs` : '—'}
               </td>
               <td style={{ 
                 padding: '12px', 
                 textAlign: 'right',
                 color: group.priceDeltaPercent > 0 ? '#10B981' : group.priceDeltaPercent < 0 ? '#EF4444' : '#6B7280',
                 fontWeight: Math.abs(group.priceDeltaPercent) > 10 ? '600' : '400'
               }}>
                 {group.code === mostPopular ? 
                   '—' : 
                   `${group.priceDeltaPercent > 0 ? '+' : ''}${group.priceDeltaPercent.toFixed(1)}%`
                 }
               </td>
             </tr>
           ))}
         </tbody>
       </table>
     </div>
   );
 }

 function renderStatisticalSummary() {
   if (!statisticalAnalysis) return null;
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <Activity size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         Statistical Analysis & Market Quality
       </h3>
       
       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
         <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: '6px' }}>
           <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Market Uniformity</div>
           <div style={{ fontSize: '24px', fontWeight: '600', color: 
             statisticalAnalysis.uniformity.interpretation === 'HIGHLY UNIFORM' ? '#10B981' :
             statisticalAnalysis.uniformity.interpretation === 'HIGHLY VARIED' ? '#EF4444' : '#F59E0B'
           }}>
             {statisticalAnalysis.uniformity.interpretation}
           </div>
           <div style={{ fontSize: '14px', color: '#6B7280', marginTop: '4px' }}>
             CV: {statisticalAnalysis.uniformity.overall_cv}%
           </div>
           <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px' }}>
             {statisticalAnalysis.uniformity.skewness_interpretation}
           </div>
         </div>
         
         <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: '6px' }}>
           <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Price Range</div>
           <div style={{ fontSize: '20px', fontWeight: '600' }}>
             ${Math.round(statisticalAnalysis.summary.price_range.min / 1000)}K - ${Math.round(statisticalAnalysis.summary.price_range.max / 1000)}K
           </div>
           <div style={{ fontSize: '14px', color: '#6B7280', marginTop: '4px' }}>
             Spread: ${Math.round(statisticalAnalysis.summary.price_range.spread / 1000)}K
           </div>
           <div style={{ marginTop: '8px', fontSize: '12px' }}>
             Q1: ${Math.round(statisticalAnalysis.overall.quartiles.q1 / 1000)}K | 
             Q2: ${Math.round(statisticalAnalysis.overall.quartiles.q2 / 1000)}K | 
             Q3: ${Math.round(statisticalAnalysis.overall.quartiles.q3 / 1000)}K
           </div>
         </div>
         
         <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: '6px' }}>
           <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Central Tendency</div>
           <div style={{ fontSize: '14px', marginBottom: '4px' }}>
             <strong>Mean:</strong> ${Math.round(statisticalAnalysis.summary.central_tendency.mean / 1000)}K
           </div>
           <div style={{ fontSize: '14px', marginBottom: '4px' }}>
             <strong>Median:</strong> ${Math.round(statisticalAnalysis.summary.central_tendency.median / 1000)}K
           </div>
           <div style={{ fontSize: '14px' }}>
             <strong>Mode:</strong> ${Math.round(statisticalAnalysis.summary.central_tendency.mode / 1000)}K
           </div>
           <div style={{ 
             marginTop: '8px', 
             fontSize: '12px', 
             color: Math.abs(parseFloat(statisticalAnalysis.summary.central_tendency.mean_median_diff)) > 5 ? '#EF4444' : '#10B981'
           }}>
             Mean-Median Diff: {statisticalAnalysis.summary.central_tendency.mean_median_diff}
           </div>
         </div>
         
         <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: '6px' }}>
           <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Data Quality</div>
           <div style={{ fontSize: '24px', fontWeight: '600', color: 
             parseFloat(statisticalAnalysis.uniformity.outlier_impact) > 10 ? '#EF4444' : '#10B981'
           }}>
             {statisticalAnalysis.uniformity.outlier_impact}
           </div>
           <div style={{ fontSize: '14px', color: '#6B7280', marginTop: '4px' }}>
             Outlier Impact
           </div>
           <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '8px' }}>
             {statisticalAnalysis.overall.outliers.length} outliers from {statisticalAnalysis.summary.total_properties} properties
           </div>
         </div>
       </div>

       {/* Per-Type Statistics */}
       {Object.keys(statisticalAnalysis.byType).length > 0 && (
         <div style={{ marginTop: '20px' }}>
           <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Statistics by Property Type</h4>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
             {Object.entries(statisticalAnalysis.byType).map(([typeCode, stats]) => (
               <div key={typeCode} style={{ 
                 padding: '12px',
                 background: stats.sample_adequacy === 'EXCELLENT' ? '#D1FAE5' :
                            stats.sample_adequacy === 'GOOD' ? '#FEF3C7' :
                            '#FEE2E2',
                 borderRadius: '6px'
               }}>
                 <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                   {stats.description}
                 </div>
                 <div style={{ fontSize: '12px', color: '#6B7280' }}>
                   Sample: {stats.count} ({stats.sample_adequacy})
                 </div>
                 <div style={{ fontSize: '12px', color: '#6B7280' }}>
                   CV: {stats.coefficient_variation}%
                 </div>
                 <div style={{ fontSize: '12px', color: '#6B7280' }}>
                   95% CI: ±${Math.round(stats.confidence_95.margin / 1000)}K
                 </div>
               </div>
             ))}
           </div>
         </div>
       )}
     </div>
   );
 }

 function renderConfidenceScores() {
   if (!confidenceMetrics || Object.keys(confidenceMetrics.adjustments).length === 0) return null;
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <Target size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         Adjustment Confidence Scores
       </h3>
       
       <div style={{ 
         marginBottom: '16px',
         padding: '12px',
         background: confidenceMetrics.overall.market_quality === 'STRONG' ? '#D1FAE5' :
                    confidenceMetrics.overall.market_quality === 'MODERATE' ? '#FEF3C7' :
                    '#FEE2E2',
         borderRadius: '6px'
       }}>
         <strong>Overall Market Quality: {confidenceMetrics.overall.market_quality}</strong>
         <div style={{ fontSize: '12px', marginTop: '4px' }}>
           Average Confidence: {Math.round(confidenceMetrics.overall.average_score)}% | 
           Range: {Math.round(confidenceMetrics.overall.lowest_score)}% - {Math.round(confidenceMetrics.overall.highest_score)}%
         </div>
       </div>
       
       {Object.entries(confidenceMetrics.adjustments)
         .sort((a, b) => b[1].confidence_score - a[1].confidence_score)
         .map(([typeCode, conf]) => (
         <div key={typeCode} style={{ 
           marginBottom: '12px', 
           padding: '12px', 
           background: conf.confidence_level === 'HIGH' ? '#D1FAE5' :
                      conf.confidence_level === 'MODERATE' ? '#FEF3C7' :
                      conf.confidence_level === 'LOW' ? '#FEE2E2' : '#FEE2E2',
           borderRadius: '6px',
           border: conf.confidence_level === 'VERY LOW' ? '2px solid #EF4444' : 'none'
         }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
             <div style={{ flex: 1 }}>
               <strong>{conf.description}</strong>
               <div style={{ fontSize: '14px', marginTop: '4px' }}>
                 Adjustment: {conf.adjustment_percent > 0 ? '+' : ''}{conf.adjustment_percent.toFixed(1)}%
               </div>
               <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                 Sample Size: {conf.sample_size} properties
               </div>
               {conf.factors.length > 0 && (
                 <div style={{ marginTop: '8px', fontSize: '12px', color: '#6B7280' }}>
                   <strong>Factors:</strong> {conf.factors.join(', ')}
                 </div>
               )}
             </div>
             <div style={{ textAlign: 'right', minWidth: '100px' }}>
               <div style={{ 
                 fontSize: '24px', 
                 fontWeight: '600',
                 color: conf.confidence_level === 'HIGH' ? '#065F46' :
                        conf.confidence_level === 'MODERATE' ? '#92400E' :
                        conf.confidence_level === 'LOW' ? '#991B1B' : '#991B1B'
               }}>
                 {conf.confidence_score}%
               </div>
               <div style={{ fontSize: '12px', color: '#6B7280' }}>{conf.confidence_level}</div>
             </div>
           </div>
           {(conf.confidence_level === 'LOW' || conf.confidence_level === 'VERY LOW') && (
             <div style={{ 
               marginTop: '8px', 
               padding: '8px',
               background: 'white',
               borderRadius: '4px',
               fontSize: '13px', 
               color: '#991B1B', 
               fontWeight: '500' 
             }}>
               ⚠️ {conf.recommendation}
             </div>
           )}
         </div>
       ))}
     </div>
   );
 }

 function renderVCSHeatMap() {
   if (!vcsHeatMap || vcsHeatMap.cells.length === 0) return null;
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <MapPin size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         VCS (Neighborhood) Value Heat Map
       </h3>
       
       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
         {vcsHeatMap.cells.map(cell => (
           <div
             key={cell.vcs}
             style={{ 
               padding: '12px',
               background: cell.color,
               borderRadius: '6px',
               border: `2px solid ${cell.colorHex}`,
               cursor: 'pointer',
               transition: 'all 0.2s',
               position: 'relative'
             }}
             onClick={() => setExpandedVCS({...expandedVCS, [cell.vcs]: !expandedVCS[cell.vcs]})}
             onMouseEnter={(e) => {
               e.currentTarget.style.transform = 'scale(1.05)';
               e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
             }}
             onMouseLeave={(e) => {
               e.currentTarget.style.transform = 'scale(1)';
               e.currentTarget.style.boxShadow = 'none';
             }}
           >
             <div style={{ fontSize: '12px', fontWeight: '600', color: cell.colorHex }}>
               {cell.vcs}
             </div>
             <div style={{ fontSize: '20px', fontWeight: '600', marginTop: '4px' }}>
               ${Math.round(cell.avg_value / 1000)}K
             </div>
             <div style={{ fontSize: '11px', color: '#6B7280' }}>
               {cell.count} properties
             </div>
             {cell.hasPatterns && (
               <div style={{ 
                 position: 'absolute',
                 top: '4px',
                 right: '4px',
                 width: '8px',
                 height: '8px',
                 background: '#3B82F6',
                 borderRadius: '50%'
               }}></div>
             )}
             <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
               {cell.diversity.typeCount > 1 && (
                 <span style={{ 
                   fontSize: '10px',
                   padding: '2px 4px',
                   background: 'white',
                   borderRadius: '2px'
                 }}>
                   {cell.diversity.typeCount} types
                 </span>
               )}
               {cell.diversity.designCount > 3 && (
                 <span style={{ 
                   fontSize: '10px',
                   padding: '2px 4px',
                   background: 'white',
                   borderRadius: '2px'
                 }}>
                   {cell.diversity.designCount} designs
                 </span>
               )}
             </div>
             {expandedVCS[cell.vcs] && (
               <div style={{ 
                 position: 'absolute',
                 top: '100%',
                 left: '0',
                 right: '0',
                 background: 'white',
                 border: '1px solid #E5E7EB',
                 borderRadius: '6px',
                 padding: '8px',
                 marginTop: '4px',
                 zIndex: 10,
                 boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
               }}>
                 <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
                   {cell.description}
                 </div>
                 <div style={{ fontSize: '11px', color: '#6B7280' }}>
                   Click to see detailed analysis below
                 </div>
               </div>
             )}
           </div>
         ))}
       </div>
       
       <div style={{ marginTop: '16px', padding: '12px', background: '#F9FAFB', borderRadius: '6px' }}>
         <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>Value Scale:</div>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <div style={{ display: 'flex', alignItems: 'center' }}>
             <div style={{ width: '20px', height: '20px', background: '#FEE2E2', borderRadius: '4px', marginRight: '8px' }}></div>
             <span style={{ fontSize: '12px' }}>Low: ${Math.round(vcsHeatMap.scale.min / 1000)}K</span>
           </div>
           <div style={{ display: 'flex', alignItems: 'center' }}>
             <div style={{ width: '20px', height: '20px', background: '#FEF3C7', borderRadius: '4px', marginRight: '8px' }}></div>
             <span style={{ fontSize: '12px' }}>Mid: ${Math.round(vcsHeatMap.scale.median / 1000)}K</span>
           </div>
           <div style={{ display: 'flex', alignItems: 'center' }}>
             <div style={{ width: '20px', height: '20px', background: '#D1FAE5', borderRadius: '4px', marginRight: '8px' }}></div>
             <span style={{ fontSize: '12px' }}>High: ${Math.round(vcsHeatMap.scale.max / 1000)}K</span>
           </div>
         </div>
       </div>
     </div>
   );
 }

 function renderVCSPatterns() {
   if (!analysisResults?.vcs_patterns || Object.keys(analysisResults.vcs_patterns).length === 0) {
     return null;
   }
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <BarChart size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         VCS (Neighborhood) Pattern Analysis
       </h3>
       
       {Object.values(analysisResults.vcs_patterns).map(vcs => (
         <div key={vcs.code} style={{ 
           marginBottom: '20px', 
           padding: '16px', 
           background: '#F9FAFB',
           borderRadius: '8px',
           border: '1px solid #E5E7EB'
         }}>
           <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div>
               <strong style={{ fontSize: '16px' }}>{vcs.description || vcs.code}</strong>
               <span style={{ marginLeft: '12px', color: '#6B7280', fontSize: '14px' }}>
                 ({vcs.totalCount} properties, Avg: ${Math.round(vcs.avgValue / 1000)}K)
               </span>
             </div>
             {vcs.avgAge && (
               <span style={{ 
                 padding: '4px 8px',
                 background: 'white',
                 borderRadius: '4px',
                 fontSize: '12px',
                 color: '#6B7280'
               }}>
                 Avg Age: {Math.round(vcs.avgAge)} years
               </span>
             )}
           </div>
           
           {/* Type breakdown */}
           {Object.keys(vcs.typeBreakdown).length > 1 && (
             <div style={{ marginBottom: '12px' }}>
               <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '8px' }}>Property Type Mix:</div>
               <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                 {Object.entries(vcs.typeBreakdown)
                   .sort((a, b) => b[1].count - a[1].count)
                   .map(([typeCode, data]) => (
                   <div key={typeCode} style={{ 
                     background: 'white', 
                     padding: '8px 12px', 
                     borderRadius: '4px',
                     border: '1px solid #E5E7EB'
                   }}>
                     <div style={{ fontSize: '12px', color: '#6B7280' }}>{data.description}</div>
                     <div style={{ fontSize: '14px', fontWeight: '600' }}>
                       {data.count} @ ${Math.round(data.avgAdjPrice / 1000)}K
                     </div>
                     <div style={{ fontSize: '11px', color: '#6B7280' }}>
                       {data.percentage.toFixed(0)}% of VCS
                     </div>
                   </div>
                 ))}
               </div>
             </div>
           )}
           
           {/* Patterns */}
           {vcs.patterns.map((pattern, idx) => (
             <div key={idx} style={{ 
               marginTop: '12px', 
               padding: '12px', 
               background: 'white',
               borderRadius: '4px',
               border: pattern.realityCheck?.includes('negligible') ? '2px solid #F59E0B' : '1px solid #E5E7EB'
             }}>
               <div style={{ fontWeight: '500', marginBottom: '8px', display: 'flex', alignItems: 'center' }}>
                 {pattern.type === 'ROW_POSITION' && (
                   <>
                     <Home size={16} style={{ marginRight: '6px', color: '#3B82F6' }} />
                     Interior vs End Unit Analysis
                   </>
                 )}
                 {pattern.type === 'TWIN_VS_SINGLE' && (
                   <>
                     <Building size={16} style={{ marginRight: '6px', color: '#3B82F6' }} />
                     Twin vs Single Family
                   </>
                 )}
                 {pattern.type === 'CONDO_PRESENCE' && (
                   <>
                     <Layers size={16} style={{ marginRight: '6px', color: '#3B82F6' }} />
                     Condominium Analysis
                   </>
                 )}
               </div>
               
               <div style={{ fontSize: '14px', marginBottom: '8px', fontWeight: '600' }}>
                 {pattern.finding}
               </div>
               
               {pattern.realityCheck && (
                 <div style={{ 
                   fontSize: '13px', 
                   color: pattern.realityCheck.includes('negligible') ? '#92400E' : '#065F46',
                   background: pattern.realityCheck.includes('negligible') ? '#FEF3C7' : '#D1FAE5',
                   padding: '6px 10px',
                   borderRadius: '4px',
                   marginTop: '8px',
                   display: 'flex',
                   alignItems: 'center'
                 }}>
                   <AlertCircle size={14} style={{ marginRight: '6px' }} />
                   <strong>Market Reality:</strong>&nbsp;{pattern.realityCheck}
                 </div>
               )}
               
               {pattern.metrics && (
                 <div style={{ marginTop: '8px', fontSize: '13px', color: '#6B7280' }}>
                   {pattern.type === 'ROW_POSITION' && (
                     <div style={{ display: 'flex', gap: '16px' }}>
                       <span>Interior: {pattern.metrics.interior.count} @ ${Math.round(pattern.metrics.interior.avgPrice).toLocaleString()}</span>
                       <span>End: {pattern.metrics.end.count} @ ${Math.round(pattern.metrics.end.avgPrice).toLocaleString()}</span>
                       <span style={{ 
                         fontWeight: '600',
                         color: pattern.metrics.percentDiff > 0 ? '#10B981' : '#EF4444'
                       }}>
                         Δ {pattern.metrics.percentDiff > 0 ? '+' : ''}{pattern.metrics.percentDiff.toFixed(1)}%
                       </span>
                     </div>
                   )}
                   {pattern.type === 'TWIN_VS_SINGLE' && (
                     <div style={{ display: 'flex', gap: '16px' }}>
                       <span>Singles: {pattern.metrics.singles.count} @ ${Math.round(pattern.metrics.singles.avgPrice).toLocaleString()}</span>
                       <span>Twins: {pattern.metrics.twins.count} @ ${Math.round(pattern.metrics.twins.avgPrice).toLocaleString()}</span>
                       <span style={{ 
                         fontWeight: '600',
                         color: pattern.metrics.percentDiff > 0 ? '#10B981' : '#EF4444'
                       }}>
                         Δ {pattern.metrics.percentDiff > 0 ? '+' : ''}{pattern.metrics.percentDiff.toFixed(1)}%
                       </span>
                     </div>
                   )}
                   {pattern.type === 'CONDO_PRESENCE' && (
                     <div>
                       Count: {pattern.metrics.count} | 
                       Avg Size: {Math.round(pattern.metrics.avgSize)} SF | 
                       vs VCS Avg: {pattern.metrics.vsVCSAverage > 0 ? '+' : ''}{pattern.metrics.vsVCSAverage.toFixed(1)}%
                     </div>
                   )}
                 </div>
               )}
             </div>
           ))}
         </div>
       ))}
     </div>
   );
 }

 function renderConditionAnalysis() {
   if (!conditionAnalysis) return null;
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <Zap size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         Condition Analysis
       </h3>
       
       {conditionAnalysis.exterior && Object.keys(conditionAnalysis.exterior).length > 0 && (
         <div>
           <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Exterior Condition Impact</h4>
           <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
             <thead>
               <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                 <th style={{ padding: '12px', textAlign: 'left' }}>Condition</th>
                 <th style={{ padding: '12px', textAlign: 'center' }}>Count</th>
                 <th style={{ padding: '12px', textAlign: 'right' }}>Avg Value</th>
                 <th style={{ padding: '12px', textAlign: 'right' }}>Adjustment</th>
                 <th style={{ padding: '12px', textAlign: 'right' }}>Adjustment %</th>
               </tr>
             </thead>
             <tbody>
               {Object.values(conditionAnalysis.exterior)
                 .sort((a, b) => b.count - a.count)
                 .map(cond => (
                 <tr 
                   key={cond.code} 
                   style={{ 
                     borderBottom: '1px solid #E5E7EB',
                     backgroundColor: cond.isBaseline ? '#FEF3C7' : 'white'
                   }}
                 >
                   <td style={{ padding: '12px' }}>
                     {cond.description}
                     {cond.isBaseline && (
                       <span style={{ 
                         marginLeft: '8px',
                         padding: '2px 6px',
                         background: '#F59E0B',
                         color: 'white',
                         borderRadius: '4px',
                         fontSize: '10px'
                       }}>
                         BASELINE
                       </span>
                     )}
                   </td>
                   <td style={{ padding: '12px', textAlign: 'center' }}>{cond.count}</td>
                   <td style={{ padding: '12px', textAlign: 'right' }}>
                     ${Math.round(cond.avgValue).toLocaleString()}
                   </td>
                   <td style={{ 
                     padding: '12px', 
                     textAlign: 'right',
                     color: cond.adjustment > 0 ? '#10B981' : cond.adjustment < 0 ? '#EF4444' : '#6B7280'
                   }}>
                     {cond.isBaseline ? '—' : 
                      `${cond.adjustment > 0 ? '+' : ''}${Math.round(cond.adjustment).toLocaleString()}`}
                   </td>
                   <td style={{ 
                     padding: '12px', 
                     textAlign: 'right',
                     fontWeight: Math.abs(cond.adjustmentPercent) > 10 ? '600' : '400'
                   }}>
                     {cond.isBaseline ? '—' : 
                      `${cond.adjustmentPercent > 0 ? '+' : ''}${cond.adjustmentPercent.toFixed(1)}%`}
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
         </div>
       )}
     </div>
   );
 }

 function renderAgeAnalysis() {
   if (!ageAnalysis) return null;
   
   return (
     <div style={{ 
       background: 'white', 
       border: '1px solid #E5E7EB', 
       borderRadius: '8px', 
       padding: '20px',
       marginBottom: '20px'
     }}>
       <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center' }}>
         <Calendar size={20} style={{ marginRight: '8px', color: '#3B82F6' }} />
         Age & Depreciation Analysis
       </h3>
       
       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
         {Object.entries(ageAnalysis.groups).map(([groupName, group]) => {
           if (group.count === 0) return null;
           return (
             <div key={groupName} style={{ 
               padding: '12px',
               background: '#F9FAFB',
               borderRadius: '6px',
               border: groupName.includes('New') ? '2px solid #10B981' : '1px solid #E5E7EB'
             }}>
               <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                 {groupName}
               </div>
               <div style={{ fontSize: '20px', fontWeight: '600' }}>
                 ${Math.round(group.avgValue / 1000)}K
               </div>
               <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                 {group.count} properties
               </div>
               <div style={{ fontSize: '12px', color: '#6B7280' }}>
                 Avg Size: {Math.round(group.avgSize).toLocaleString()} SF
               </div>
             </div>
           );
         })}
       </div>
       
       {ageAnalysis.hasNewConstruction && (
         <div style={{ 
           padding: '12px',
           background: '#D1FAE5',
           borderRadius: '6px',
           marginBottom: '12px'
         }}>
           <strong style={{ color: '#065F46' }}>New Construction Present:</strong> {ageAnalysis.groups['New (0-5 years)'].count} properties built in last 5 years
         </div>
       )}
       
       {ageAnalysis.depreciationCurve.length > 2 && (
         <div>
           <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>Depreciation Pattern</h4>
           <div style={{ fontSize: '12px', color: '#6B7280' }}>
             {ageAnalysis.depreciationCurve.map((point, idx) => (
               <span key={idx}>
                 {point.name}: ${Math.round(point.avgValue / 1000)}K
                 {idx < ageAnalysis.depreciationCurve.length - 1 && ' → '}
               </span>
             ))}
           </div>
         </div>
       )}
     </div>
   );
 }
};

export default OverallAnalysisTab;
