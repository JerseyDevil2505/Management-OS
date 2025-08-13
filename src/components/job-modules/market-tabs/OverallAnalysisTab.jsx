import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { interpretCodes } from '../../../lib/supabaseClient';
import { 
  BarChart, TrendingUp, Home, Building, RefreshCw, Save, AlertCircle,
  Download, Filter, MapPin, DollarSign, Activity, Target, 
  FileSpreadsheet, Eye, ChevronDown, ChevronUp, Info, CheckCircle, 
  XCircle, ArrowUpRight, ArrowDownRight, Minus, Zap,
  Layers, Calendar, Users, Package
} from 'lucide-react';

const OverallAnalysisTab = ({ 
  properties = [], 
  jobData = {}, 
  jobId,
  onPropertiesUpdate = () => {} 
}) => {
  // State management
  const [activeTab, setActiveTab] = useState('overall');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    priceMin: null,
    priceMax: null,
    sizeMin: null,
    sizeMax: null,
    yearBuiltMin: null,
    yearBuiltMax: null
  });
  const [expandedSections, setExpandedSections] = useState({
    typeUse: true,
    designStyle: true,
    statistics: true,
    vcs: true,
    age: true,
    endUnit: true
  });

  // Extract vendor type and code definitions
  const vendorType = jobData.vendor || jobData.vendor_type;
  const codeDefinitions = jobData.code_definitions || {};

  // Filter properties based on criteria
  const filteredProperties = useMemo(() => {
    return properties.filter(p => {
      const price = p.values_norm_time || 0;
      const size = p.asset_sfla || 0;
      const yearBuilt = p.asset_year_built || 0;

      if (filters.priceMin && price < filters.priceMin) return false;
      if (filters.priceMax && price > filters.priceMax) return false;
      if (filters.sizeMin && size < filters.sizeMin) return false;
      if (filters.sizeMax && size > filters.sizeMax) return false;
      if (filters.yearBuiltMin && yearBuilt < filters.yearBuiltMin) return false;
      if (filters.yearBuiltMax && yearBuilt > filters.yearBuiltMax) return false;

      return true;
    });
  }, [properties, filters]);

  // Statistical calculations
  const calculateMean = (values) => {
    const valid = values.filter(v => v > 0);
    if (valid.length === 0) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  };

  const calculateMedian = (values) => {
    const valid = values.filter(v => v > 0).sort((a, b) => a - b);
    if (valid.length === 0) return 0;
    const mid = Math.floor(valid.length / 2);
    return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  };

  const calculateStdDev = (values) => {
    const mean = calculateMean(values);
    const valid = values.filter(v => v > 0);
    if (valid.length === 0) return 0;
    const squareDiffs = valid.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / valid.length);
  };

  const calculateMode = (values) => {
    const valid = values.filter(v => v > 0);
    if (valid.length === 0) return 0;
    const frequency = {};
    valid.forEach(v => {
      const rounded = Math.round(v / 1000) * 1000;
      frequency[rounded] = (frequency[rounded] || 0) + 1;
    });
    let maxFreq = 0;
    let mode = 0;
    Object.entries(frequency).forEach(([value, freq]) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        mode = parseFloat(value);
      }
    });
    return mode;
  };

  // Analyze end units vs interior units
  const analyzeEndUnits = (props, codeDefs, vendor) => {
    const endUnits = [];
    const interiorUnits = [];
    
    props.forEach(p => {
      const designName = interpretCodes.getDesignName(p, codeDefs, vendor) || p.asset_design_style || '';
      const upperDesign = designName.toUpperCase();
      
      if (upperDesign.includes('END')) {
        endUnits.push(p);
      } else if (upperDesign.includes('INT')) {
        interiorUnits.push(p);
      }
    });

    if (endUnits.length === 0 && interiorUnits.length === 0) {
      return null;
    }

    const endStats = {
      count: endUnits.length,
      avgPrice: calculateMean(endUnits.map(p => p.values_norm_time || 0)),
      avgAdjPrice: calculateMean(endUnits.map(p => p.values_norm_size || 0)),
      avgSize: calculateMean(endUnits.map(p => p.asset_sfla || 0)),
      avgYearBuilt: Math.round(calculateMean(endUnits.map(p => p.asset_year_built || 0)))
    };

    const intStats = {
      count: interiorUnits.length,
      avgPrice: calculateMean(interiorUnits.map(p => p.values_norm_time || 0)),
      avgAdjPrice: calculateMean(interiorUnits.map(p => p.values_norm_size || 0)),
      avgSize: calculateMean(interiorUnits.map(p => p.asset_sfla || 0)),
      avgYearBuilt: Math.round(calculateMean(interiorUnits.map(p => p.asset_year_built || 0)))
    };

    const premium = intStats.avgAdjPrice > 0 ? 
      ((endStats.avgAdjPrice - intStats.avgAdjPrice) / intStats.avgAdjPrice * 100) : 0;

    return {
      endUnits: endStats,
      interiorUnits: intStats,
      premium,
      hasData: true
    };
  };

  // Infer bedrooms from size if not available
  const inferBedroomsFromSize = (sfla) => {
    if (!sfla || sfla === 0) return null;
    if (sfla < 700) return 0; // Studio
    if (sfla < 900) return 1;
    if (sfla < 1400) return 2;
    return 3;
  };

  // Analyze condos
  const analyzeCondos = (props, codeDefs, vendor) => {
    const condos = props.filter(p => {
      const typeCode = p.asset_type_use;
      const typeName = interpretCodes.getTypeName(p, codeDefs, vendor) || '';
      return typeCode === '60' || typeName.toUpperCase().includes('CONDO');
    });

    if (condos.length === 0) return null;

    // Bedroom analysis
    const bedroomGroups = {};
    condos.forEach(p => {
      const bedrooms = interpretCodes.getBedroomRoomSum(p, vendor) || inferBedroomsFromSize(p.asset_sfla);
      const key = bedrooms !== null ? `${bedrooms}BR` : 'Unknown';
      
      if (!bedroomGroups[key]) {
        bedroomGroups[key] = {
          label: key,
          bedrooms,
          properties: [],
          count: 0,
          totalPrice: 0,
          totalSize: 0
        };
      }
      
      bedroomGroups[key].properties.push(p);
      bedroomGroups[key].count++;
      bedroomGroups[key].totalPrice += p.values_norm_time || 0;
      bedroomGroups[key].totalSize += p.asset_sfla || 0;
    });

    Object.values(bedroomGroups).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
      group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
      group.pricePerSF = group.avgSize > 0 ? group.avgPrice / group.avgSize : 0;
    });

    // Floor analysis
    const floorGroups = {};
    let hasFloorData = false;
    
    condos.forEach(p => {
      const floor = interpretCodes.getCondoFloor(p, codeDefs, vendor);
      const key = floor !== null ? (floor === 99 ? 'Penthouse' : `Floor ${floor}`) : 'Unknown';
      
      if (floor !== null) hasFloorData = true;
      
      if (!floorGroups[key]) {
        floorGroups[key] = {
          label: key,
          floor,
          properties: [],
          count: 0,
          totalPrice: 0
        };
      }
      
      floorGroups[key].properties.push(p);
      floorGroups[key].count++;
      floorGroups[key].totalPrice += p.values_norm_time || 0;
    });

    Object.values(floorGroups).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
    });

    // VCS analysis for condos
    const condoVCS = {};
    condos.forEach(p => {
      const vcs = p.new_vcs || p.newVCS || 'Unknown';
      const vcsDesc = interpretCodes.getVCSDescription(p, codeDefs, vendor) || vcs;
      
      if (!condoVCS[vcs]) {
        condoVCS[vcs] = {
          code: vcs,
          description: vcsDesc,
          properties: [],
          count: 0,
          totalPrice: 0,
          bedroomMix: {}
        };
      }
      
      condoVCS[vcs].properties.push(p);
      condoVCS[vcs].count++;
      condoVCS[vcs].totalPrice += p.values_norm_time || 0;
      
      const bedrooms = interpretCodes.getBedroomRoomSum(p, vendor) || inferBedroomsFromSize(p.asset_sfla);
      const brKey = bedrooms !== null ? `${bedrooms}BR` : 'Unknown';
      condoVCS[vcs].bedroomMix[brKey] = (condoVCS[vcs].bedroomMix[brKey] || 0) + 1;
    });

    Object.values(condoVCS).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
    });

    return {
      totalCondos: condos.length,
      bedroomGroups,
      floorGroups,
      hasFloorData,
      condoVCS,
      percentWithBedrooms: (condos.filter(c => interpretCodes.getBedroomRoomSum(c, vendor) !== null).length / condos.length * 100),
      percentWithFloors: (condos.filter(c => interpretCodes.getCondoFloor(c, codeDefs, vendor) !== null).length / condos.length * 100)
    };
  };
  // Generate insights
  const generateInsights = (stats, typeGroups, designGroups, vcsGroups, ageGroups, endUnitAnalysis, condoAnalysis) => {
    const insights = [];
    
    const cv = stats.overall.coefficient_variation;
    if (cv > 35) {
      insights.push({
        type: 'market_condition',
        severity: 'high',
        title: 'High market variability',
        message: `CV of ${cv.toFixed(2)}% indicates diverse property values. Be cautious with adjustments.`
      });
    }

    Object.values(typeGroups).forEach(group => {
      if (group.count === 1 && Math.abs(group.priceDeltaPercent) > 10) {
        insights.push({
          type: 'type_adjustment',
          severity: 'high',
          title: `${group.name}: ${group.priceDeltaPercent.toFixed(1)}% difference`,
          message: `Based on only 1 sale - ${group.confidence} confidence. Do not use for adjustments.`
        });
      }
    });

    if (endUnitAnalysis && endUnitAnalysis.hasData) {
      const premium = endUnitAnalysis.premium;
      if (Math.abs(premium) > 5) {
        insights.push({
          type: 'end_unit',
          severity: 'medium',
          title: `End unit premium: ${premium.toFixed(1)}%`,
          message: `End units show ${premium > 0 ? 'premium' : 'discount'} vs interior units`
        });
      }
    }

    if (condoAnalysis && !condoAnalysis.hasFloorData) {
      insights.push({
        type: 'data_quality',
        severity: 'low',
        title: 'Limited condo floor data',
        message: `Only ${condoAnalysis.percentWithFloors.toFixed(0)}% of condos have floor designation`
      });
    }

    return insights;
  };

  // Perform comprehensive analysis
  const performAnalysis = () => {
    setLoading(true);
    
    try {
      // Statistical Analysis
      const allPrices = filteredProperties.map(p => p.values_norm_time || 0);
      const mean = calculateMean(allPrices);
      const median = calculateMedian(allPrices);
      const stdDev = calculateStdDev(allPrices);
      const mode = calculateMode(allPrices);
      
      const stats = {
        overall: {
          count: filteredProperties.length,
          mean,
          median,
          mode,
          stdDev,
          coefficient_variation: mean > 0 ? (stdDev / mean * 100) : 0,
          min: Math.min(...allPrices.filter(p => p > 0)),
          max: Math.max(...allPrices.filter(p => p > 0)),
          q1: calculateMedian(allPrices.filter(p => p > 0 && p <= median)),
          q3: calculateMedian(allPrices.filter(p => p > 0 && p >= median))
        }
      };

      // Type & Use Analysis
      const typeGroups = {};
      filteredProperties.forEach(p => {
        const typeCode = p.asset_type_use || 'Unknown';
        const typeName = interpretCodes.getTypeName(p, codeDefinitions, vendorType) || typeCode;
        
        if (!typeGroups[typeCode]) {
          typeGroups[typeCode] = {
            code: typeCode,
            name: typeName,
            properties: [],
            count: 0,
            totalPrice: 0,
            totalAdjPrice: 0,
            totalSize: 0
          };
        }
        
        typeGroups[typeCode].properties.push(p);
        typeGroups[typeCode].count++;
        typeGroups[typeCode].totalPrice += p.values_norm_time || 0;
        typeGroups[typeCode].totalAdjPrice += p.values_norm_size || 0;
        typeGroups[typeCode].totalSize += p.asset_sfla || 0;
      });

      // Calculate averages and find highest value for baseline
      let highestValueType = null;
      let highestValue = 0;
      
      Object.values(typeGroups).forEach(group => {
        group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
        group.avgAdjPrice = group.count > 0 ? group.totalAdjPrice / group.count : 0;
        group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
        
        if (group.avgAdjPrice > highestValue) {
          highestValue = group.avgAdjPrice;
          highestValueType = group.code;
        }
      });

      // Calculate deltas from highest value
      Object.values(typeGroups).forEach(group => {
        if (highestValueType && group.code !== highestValueType) {
          const baseline = typeGroups[highestValueType];
          group.priceDelta = group.avgAdjPrice - baseline.avgAdjPrice;
          group.priceDeltaPercent = baseline.avgAdjPrice > 0 ? 
            ((group.avgAdjPrice - baseline.avgAdjPrice) / baseline.avgAdjPrice * 100) : 0;
        } else {
          group.priceDelta = 0;
          group.priceDeltaPercent = 0;
        }
        
        const sampleSize = group.count;
        const marketShare = (group.count / filteredProperties.length) * 100;
        let confidence = 'LOW';
        if (sampleSize >= 10 && marketShare >= 10) confidence = 'HIGH';
        else if (sampleSize >= 5 && marketShare >= 5) confidence = 'MODERATE';
        group.confidence = confidence;
      });

      // Design & Style Analysis
      const designGroups = {};
      filteredProperties.forEach(p => {
        const designCode = p.asset_design_style || 'Unknown';
        const designName = interpretCodes.getDesignName(p, codeDefinitions, vendorType) || designCode;
        
        if (!designGroups[designCode]) {
          designGroups[designCode] = {
            code: designCode,
            name: designName,
            properties: [],
            count: 0,
            totalPrice: 0,
            totalAdjPrice: 0,
            totalYearBuilt: 0
          };
        }
        
        designGroups[designCode].properties.push(p);
        designGroups[designCode].count++;
        designGroups[designCode].totalPrice += p.values_norm_time || 0;
        designGroups[designCode].totalAdjPrice += p.values_norm_size || 0;
        designGroups[designCode].totalYearBuilt += p.asset_year_built || 0;
      });

      // Calculate averages and find highest value design
      let highestValueDesign = null;
      let highestDesignValue = 0;
      
      Object.values(designGroups).forEach(group => {
        group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
        group.avgAdjPrice = group.count > 0 ? group.totalAdjPrice / group.count : 0;
        group.avgYearBuilt = group.count > 0 ? Math.round(group.totalYearBuilt / group.count) : 0;
        
        if (group.avgAdjPrice > highestDesignValue) {
          highestDesignValue = group.avgAdjPrice;
          highestValueDesign = group.code;
        }
      });

      // Calculate deltas from highest value design
      Object.values(designGroups).forEach(group => {
        if (highestValueDesign && group.code !== highestValueDesign) {
          const baseline = designGroups[highestValueDesign];
          group.priceDelta = group.avgAdjPrice - baseline.avgAdjPrice;
          group.priceDeltaPercent = baseline.avgAdjPrice > 0 ? 
            ((group.avgAdjPrice - baseline.avgAdjPrice) / baseline.avgAdjPrice * 100) : 0;
        } else {
          group.priceDelta = 0;
          group.priceDeltaPercent = 0;
        }
      });

      // VCS/Neighborhood Analysis
      const vcsGroups = {};
      filteredProperties.forEach(p => {
        const vcs = p.new_vcs || p.newVCS || 'Unknown';
        const vcsDesc = interpretCodes.getVCSDescription(p, codeDefinitions, vendorType) || vcs;
        
        if (!vcsGroups[vcs]) {
          vcsGroups[vcs] = {
            code: vcs,
            description: vcsDesc,
            properties: [],
            count: 0,
            totalPrice: 0,
            designs: new Set(),
            types: new Set()
          };
        }
        
        vcsGroups[vcs].properties.push(p);
        vcsGroups[vcs].count++;
        vcsGroups[vcs].totalPrice += p.values_norm_time || 0;
        if (p.asset_design_style) vcsGroups[vcs].designs.add(p.asset_design_style);
        if (p.asset_type_use) vcsGroups[vcs].types.add(p.asset_type_use);
      });

      Object.values(vcsGroups).forEach(group => {
        group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
        group.designDiversity = group.designs.size;
        group.typeDiversity = group.types.size;
        
        const vcsPrices = group.properties.map(p => p.values_norm_time || 0).filter(p => p > 0);
        group.priceStdDev = calculateStdDev(vcsPrices);
        group.priceCV = group.avgPrice > 0 ? (group.priceStdDev / group.avgPrice * 100) : 0;
      });

      // Age/Year Built Analysis
      const currentYear = new Date().getFullYear();
      const ageGroups = {
        new: { 
          label: 'New Construction', 
          range: `${currentYear - 10}-${currentYear}`,
          minYear: currentYear - 10,
          maxYear: currentYear,
          properties: [], 
          totalPrice: 0, 
          count: 0 
        },
        newer: { 
          label: 'Newer Construction', 
          range: `${currentYear - 20}-${currentYear - 11}`,
          minYear: currentYear - 20,
          maxYear: currentYear - 11,
          properties: [], 
          totalPrice: 0, 
          count: 0 
        },
        moderate: { 
          label: 'Moderate Age', 
          range: `${currentYear - 35}-${currentYear - 21}`,
          minYear: currentYear - 35,
          maxYear: currentYear - 21,
          properties: [], 
          totalPrice: 0, 
          count: 0 
        },
        older: { 
          label: 'Older', 
          range: `${currentYear - 50}-${currentYear - 36}`,
          minYear: currentYear - 50,
          maxYear: currentYear - 36,
          properties: [], 
          totalPrice: 0, 
          count: 0 
        },
        historic: { 
          label: 'Historic', 
          range: `Pre-${currentYear - 50}`,
          minYear: 0,
          maxYear: currentYear - 51,
          properties: [], 
          totalPrice: 0, 
          count: 0 
        }
      };

      filteredProperties.forEach(p => {
        const yearBuilt = p.asset_year_built;
        if (!yearBuilt || yearBuilt === 0) return;
        
        if (yearBuilt >= currentYear - 10) {
          ageGroups.new.properties.push(p);
          ageGroups.new.count++;
          ageGroups.new.totalPrice += p.values_norm_time || 0;
        } else if (yearBuilt >= currentYear - 20) {
          ageGroups.newer.properties.push(p);
          ageGroups.newer.count++;
          ageGroups.newer.totalPrice += p.values_norm_time || 0;
        } else if (yearBuilt >= currentYear - 35) {
          ageGroups.moderate.properties.push(p);
          ageGroups.moderate.count++;
          ageGroups.moderate.totalPrice += p.values_norm_time || 0;
        } else if (yearBuilt >= currentYear - 50) {
          ageGroups.older.properties.push(p);
          ageGroups.older.count++;
          ageGroups.older.totalPrice += p.values_norm_time || 0;
        } else {
          ageGroups.historic.properties.push(p);
          ageGroups.historic.count++;
          ageGroups.historic.totalPrice += p.values_norm_time || 0;
        }
      });

      Object.values(ageGroups).forEach(group => {
        group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
      });

      // End Unit vs Interior Analysis
      const endUnitAnalysis = analyzeEndUnits(filteredProperties, codeDefinitions, vendorType);

      // Condo-specific analysis
      const condoAnalysis = analyzeCondos(filteredProperties, codeDefinitions, vendorType);

      // Generate insights
      const insights = generateInsights(stats, typeGroups, designGroups, vcsGroups, ageGroups, endUnitAnalysis, condoAnalysis);

      setAnalysis({
        stats,
        typeGroups,
        designGroups,
        vcsGroups,
        ageGroups,
        endUnitAnalysis,
        condoAnalysis,
        insights,
        highestValueType,
        highestValueDesign,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Save analysis
  const saveAnalysis = async () => {
    if (!analysis || !jobId) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert({
          job_id: jobId,
          overall_analysis_results: analysis,
          updated_at: new Date().toISOString()
        }, { onConflict: 'job_id' });

      if (error) throw error;
      console.log('Analysis saved successfully');
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setSaving(false);
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    if (!analysis) return;
    
    let csv = 'Overall Market Analysis Export\n';
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    
    csv += 'Market Statistics\n';
    csv += `Total Properties,${analysis.stats.overall.count}\n`;
    csv += `Mean Price,$${Math.round(analysis.stats.overall.mean).toLocaleString()}\n`;
    csv += `Median Price,$${Math.round(analysis.stats.overall.median).toLocaleString()}\n`;
    csv += `Coefficient of Variation,${analysis.stats.overall.coefficient_variation.toFixed(2)}%\n\n`;
    
    csv += 'Type & Use Analysis\n';
    csv += 'Type,Count,Avg Price,Avg Adj Price,Premium/Discount,Confidence\n';
    Object.values(analysis.typeGroups).forEach(group => {
      csv += `"${group.name}",${group.count},$${Math.round(group.avgPrice).toLocaleString()},$${Math.round(group.avgAdjPrice).toLocaleString()},${group.priceDeltaPercent.toFixed(1)}%,${group.confidence}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market_analysis_${jobId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Toggle section
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Run analysis on mount
  useEffect(() => {
    if (filteredProperties.length > 0) {
      performAnalysis();
    }
  }, [filteredProperties]);

  // Auto-save
  useEffect(() => {
    if (analysis) {
      const timer = setTimeout(() => {
        saveAnalysis();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [analysis]);
  return (
   <div className="max-w-full mx-auto space-y-6">
     {/* Header */}
     <div className="bg-white rounded-lg shadow-sm p-6">
       <div className="flex justify-between items-center mb-6">
         <h2 className="text-2xl font-bold text-gray-900">Market Analysis</h2>
         <div className="flex gap-2">
           <button
             onClick={performAnalysis}
             disabled={loading}
             className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
           >
             <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
             {loading ? 'Analyzing...' : 'Refresh'}
           </button>
           <button
             onClick={saveAnalysis}
             disabled={saving || !analysis}
             className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
           >
             <Save className="h-4 w-4" />
             {saving ? 'Saving...' : 'Save'}
           </button>
           <button
             onClick={exportToCSV}
             disabled={!analysis}
             className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
           >
             <Download className="h-4 w-4" />
             Export
           </button>
         </div>
       </div>

       {/* Tabs */}
       <div className="flex space-x-1 border-b">
         <button
           onClick={() => setActiveTab('overall')}
           className={`px-4 py-2 font-medium ${
             activeTab === 'overall'
               ? 'text-blue-600 border-b-2 border-blue-600'
               : 'text-gray-600 hover:text-gray-900'
           }`}
         >
           Overall Analysis
         </button>
         <button
           onClick={() => setActiveTab('condo')}
           className={`px-4 py-2 font-medium ${
             activeTab === 'condo'
               ? 'text-blue-600 border-b-2 border-blue-600'
               : 'text-gray-600 hover:text-gray-900'
           }`}
         >
           Condo Analysis
         </button>
       </div>
     </div>

     {/* Main Content */}
     {activeTab === 'overall' ? (
       <div className="space-y-6">
         {/* Key Insights */}
         {analysis?.insights && analysis.insights.length > 0 && (
           <div className="bg-white rounded-lg shadow-sm p-6">
             <h3 className="text-lg font-semibold mb-4">Key Market Insights</h3>
             <div className="space-y-3">
               {analysis.insights.map((insight, idx) => (
                 <div
                   key={idx}
                   className={`p-4 rounded-lg border-l-4 ${
                     insight.severity === 'high'
                       ? 'bg-red-50 border-red-500'
                       : insight.severity === 'medium'
                       ? 'bg-yellow-50 border-yellow-500'
                       : 'bg-blue-50 border-blue-500'
                   }`}
                 >
                   <div className="flex items-start gap-3">
                     <AlertCircle className={`h-5 w-5 mt-0.5 ${
                       insight.severity === 'high' ? 'text-red-500' : 
                       insight.severity === 'medium' ? 'text-yellow-500' : 'text-blue-500'
                     }`} />
                     <div>
                       <div className="font-medium">{insight.title}</div>
                       <div className="text-sm text-gray-600 mt-1">{insight.message}</div>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           </div>
         )}

         {/* Type & Use Analysis */}
         <div className="bg-white rounded-lg shadow-sm p-6">
           <div 
             onClick={() => toggleSection('typeUse')}
             className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
           >
             <h3 className="text-lg font-semibold">Type & Use Analysis</h3>
             {expandedSections.typeUse ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
           </div>
           
           {expandedSections.typeUse && analysis?.typeGroups && (
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Adj Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Premium/Discount</th>
                     <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Confidence</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {Object.values(analysis.typeGroups)
                     .sort((a, b) => b.avgAdjPrice - a.avgAdjPrice)
                     .map((group, idx) => (
                     <tr key={group.code} className={idx === 0 ? 'bg-yellow-50' : ''}>
                       <td className="px-4 py-3 text-sm">
                         <div className="flex items-center gap-2">
                           {group.name}
                           {group.code === analysis.highestValueType && (
                             <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">BASELINE</span>
                           )}
                         </div>
                       </td>
                       <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         ${Math.round(group.avgPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right font-medium">
                         ${Math.round(group.avgAdjPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {Math.round(group.avgSize).toLocaleString()} SF
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {group.priceDeltaPercent !== 0 && (
                           <span className={`inline-flex items-center gap-1 ${
                             group.priceDeltaPercent > 0 ? 'text-green-600' : 'text-red-600'
                           }`}>
                             {group.priceDeltaPercent > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                             {Math.abs(group.priceDeltaPercent).toFixed(1)}%
                           </span>
                         )}
                         {group.priceDeltaPercent === 0 && '—'}
                       </td>
                       <td className="px-4 py-3 text-sm text-center">
                         <span className={`px-2 py-1 text-xs rounded ${
                           group.confidence === 'HIGH' ? 'bg-green-100 text-green-800' :
                           group.confidence === 'MODERATE' ? 'bg-yellow-100 text-yellow-800' :
                           'bg-red-100 text-red-800'
                         }`}>
                           {group.confidence}
                         </span>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
         </div>

         {/* Design & Style Analysis */}
         <div className="bg-white rounded-lg shadow-sm p-6">
           <div 
             onClick={() => toggleSection('designStyle')}
             className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
           >
             <h3 className="text-lg font-semibold">Design & Style Analysis</h3>
             {expandedSections.designStyle ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
           </div>
           
           {expandedSections.designStyle && analysis?.designGroups && (
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Design</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Adj Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Year Built</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Premium/Discount</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {Object.values(analysis.designGroups)
                     .sort((a, b) => b.avgAdjPrice - a.avgAdjPrice)
                     .map((group, idx) => (
                     <tr key={group.code} className={idx === 0 ? 'bg-yellow-50' : ''}>
                       <td className="px-4 py-3 text-sm">
                         <div className="flex items-center gap-2">
                           {group.name}
                           {group.code === analysis.highestValueDesign && (
                             <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">BASELINE</span>
                           )}
                         </div>
                       </td>
                       <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         ${Math.round(group.avgPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right font-medium">
                         ${Math.round(group.avgAdjPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {group.avgYearBuilt || '—'}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {group.priceDeltaPercent !== 0 && (
                           <span className={`inline-flex items-center gap-1 ${
                             group.priceDeltaPercent > 0 ? 'text-green-600' : 'text-red-600'
                           }`}>
                             {group.priceDeltaPercent > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                             {Math.abs(group.priceDeltaPercent).toFixed(1)}%
                           </span>
                         )}
                         {group.priceDeltaPercent === 0 && '—'}
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
         </div>

         {/* End Unit Analysis (if applicable) */}
         {analysis?.endUnitAnalysis?.hasData && (
           <div className="bg-white rounded-lg shadow-sm p-6">
             <div 
               onClick={() => toggleSection('endUnit')}
               className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
             >
               <h3 className="text-lg font-semibold">End Unit vs Interior Analysis</h3>
               {expandedSections.endUnit ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
             </div>
             
             {expandedSections.endUnit && (
               <div className="overflow-x-auto">
                 <table className="min-w-full divide-y divide-gray-200">
                   <thead className="bg-gray-50">
                     <tr>
                       <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit Type</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Adj Price</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Year Built</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Premium</th>
                     </tr>
                   </thead>
                   <tbody className="bg-white divide-y divide-gray-200">
                     <tr>
                       <td className="px-4 py-3 text-sm font-medium">End Units</td>
                       <td className="px-4 py-3 text-sm text-right">{analysis.endUnitAnalysis.endUnits.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         ${Math.round(analysis.endUnitAnalysis.endUnits.avgPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right font-medium">
                         ${Math.round(analysis.endUnitAnalysis.endUnits.avgAdjPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {Math.round(analysis.endUnitAnalysis.endUnits.avgSize).toLocaleString()} SF
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {analysis.endUnitAnalysis.endUnits.avgYearBuilt || '—'}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         <span className={`inline-flex items-center gap-1 ${
                           analysis.endUnitAnalysis.premium > 0 ? 'text-green-600' : 'text-red-600'
                         }`}>
                           {analysis.endUnitAnalysis.premium > 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                           {Math.abs(analysis.endUnitAnalysis.premium).toFixed(1)}%
                         </span>
                       </td>
                     </tr>
                     <tr className="bg-gray-50">
                       <td className="px-4 py-3 text-sm font-medium">Interior Units</td>
                       <td className="px-4 py-3 text-sm text-right">{analysis.endUnitAnalysis.interiorUnits.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         ${Math.round(analysis.endUnitAnalysis.interiorUnits.avgPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right font-medium">
                         ${Math.round(analysis.endUnitAnalysis.interiorUnits.avgAdjPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {Math.round(analysis.endUnitAnalysis.interiorUnits.avgSize).toLocaleString()} SF
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {analysis.endUnitAnalysis.interiorUnits.avgYearBuilt || '—'}
                       </td>
                       <td className="px-4 py-3 text-sm text-right text-gray-400">BASELINE</td>
                     </tr>
                   </tbody>
                 </table>
               </div>
             )}
           </div>
         )}
         {/* Statistical Analysis */}
         <div className="bg-white rounded-lg shadow-sm p-6">
           <div 
             onClick={() => toggleSection('statistics')}
             className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
           >
             <h3 className="text-lg font-semibold">Statistical Analysis</h3>
             {expandedSections.statistics ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
           </div>
           
           {expandedSections.statistics && analysis?.stats && (
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Properties</div>
                 <div className="text-2xl font-bold">{analysis.stats.overall.count}</div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Mean Price</div>
                 <div className="text-2xl font-bold">${Math.round(analysis.stats.overall.mean / 1000)}K</div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Median Price</div>
                 <div className="text-2xl font-bold">${Math.round(analysis.stats.overall.median / 1000)}K</div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">CV</div>
                 <div className="text-2xl font-bold">{analysis.stats.overall.coefficient_variation.toFixed(1)}%</div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Price Range</div>
                 <div className="text-lg font-bold">
                   ${Math.round(analysis.stats.overall.min / 1000)}K - ${Math.round(analysis.stats.overall.max / 1000)}K
                 </div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Quartiles</div>
                 <div className="text-sm font-medium">
                   Q1: ${Math.round(analysis.stats.overall.q1 / 1000)}K<br/>
                   Q3: ${Math.round(analysis.stats.overall.q3 / 1000)}K
                 </div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Mode</div>
                 <div className="text-lg font-bold">${Math.round(analysis.stats.overall.mode / 1000)}K</div>
               </div>
               <div className="bg-gray-50 rounded-lg p-4">
                 <div className="text-sm text-gray-600">Std Dev</div>
                 <div className="text-lg font-bold">${Math.round(analysis.stats.overall.stdDev / 1000)}K</div>
               </div>
             </div>
           )}
         </div>

         {/* VCS/Neighborhood Analysis */}
         <div className="bg-white rounded-lg shadow-sm p-6">
           <div 
             onClick={() => toggleSection('vcs')}
             className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
           >
             <h3 className="text-lg font-semibold">VCS/Neighborhood Analysis</h3>
             {expandedSections.vcs ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
           </div>
           
           {expandedSections.vcs && analysis?.vcsGroups && (
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">VCS</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Price CV</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Design Diversity</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Type Diversity</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {Object.values(analysis.vcsGroups)
                     .sort((a, b) => b.count - a.count)
                     .map(group => (
                     <tr key={group.code}>
                       <td className="px-4 py-3 text-sm">
                         <div>
                           <div className="font-medium">{group.description}</div>
                           <div className="text-xs text-gray-500">{group.code}</div>
                         </div>
                       </td>
                       <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         ${Math.round(group.avgPrice).toLocaleString()}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         <span className={`px-2 py-1 text-xs rounded ${
                           group.priceCV < 20 ? 'bg-green-100 text-green-800' :
                           group.priceCV < 35 ? 'bg-yellow-100 text-yellow-800' :
                           'bg-red-100 text-red-800'
                         }`}>
                           {group.priceCV.toFixed(1)}%
                         </span>
                       </td>
                       <td className="px-4 py-3 text-sm text-right">{group.designDiversity}</td>
                       <td className="px-4 py-3 text-sm text-right">{group.typeDiversity}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
         </div>

         {/* Age/Year Built Analysis */}
         <div className="bg-white rounded-lg shadow-sm p-6">
           <div 
             onClick={() => toggleSection('age')}
             className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
           >
             <h3 className="text-lg font-semibold">Age & Year Built Analysis</h3>
             {expandedSections.age ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
           </div>
           
           {expandedSections.age && analysis?.ageGroups && (
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year Range</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Market Share</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {Object.entries(analysis.ageGroups).map(([key, group]) => (
                     <tr key={key} className={key === 'new' || key === 'newer' ? 'bg-blue-50' : ''}>
                       <td className="px-4 py-3 text-sm font-medium">
                         {group.label}
                         {(key === 'new' || key === 'newer') && (
                           <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">CCF Source</span>
                         )}
                       </td>
                       <td className="px-4 py-3 text-sm">{group.range}</td>
                       <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                       <td className="px-4 py-3 text-sm text-right">
                         {group.avgPrice > 0 ? `$${Math.round(group.avgPrice).toLocaleString()}` : '—'}
                       </td>
                       <td className="px-4 py-3 text-sm text-right">
                         {filteredProperties.length > 0 ? 
                           `${(group.count / filteredProperties.length * 100).toFixed(1)}%` : '—'}
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           )}
         </div>
       </div>
     ) : (
       /* Condo Analysis Tab */
       <div className="space-y-6">
         {analysis?.condoAnalysis ? (
           <>
             {/* Condo Overview */}
             <div className="bg-white rounded-lg shadow-sm p-6">
               <h3 className="text-lg font-semibold mb-4">Condo Overview</h3>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="bg-gray-50 rounded-lg p-4">
                   <div className="text-sm text-gray-600">Total Condos</div>
                   <div className="text-2xl font-bold">{analysis.condoAnalysis.totalCondos}</div>
                 </div>
                 <div className="bg-gray-50 rounded-lg p-4">
                   <div className="text-sm text-gray-600">With Bedrooms</div>
                   <div className="text-2xl font-bold">{analysis.condoAnalysis.percentWithBedrooms.toFixed(0)}%</div>
                 </div>
                 <div className="bg-gray-50 rounded-lg p-4">
                   <div className="text-sm text-gray-600">With Floors</div>
                   <div className="text-2xl font-bold">{analysis.condoAnalysis.percentWithFloors.toFixed(0)}%</div>
                 </div>
                 <div className="bg-gray-50 rounded-lg p-4">
                   <div className="text-sm text-gray-600">Complexes</div>
                   <div className="text-2xl font-bold">{Object.keys(analysis.condoAnalysis.condoVCS).length}</div>
                 </div>
               </div>
             </div>

             {/* Bedroom Analysis */}
             <div className="bg-white rounded-lg shadow-sm p-6">
               <h3 className="text-lg font-semibold mb-4">Bedroom Analysis</h3>
               <div className="overflow-x-auto">
                 <table className="min-w-full divide-y divide-gray-200">
                   <thead className="bg-gray-50">
                     <tr>
                       <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bedrooms</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">$/SF</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Market Share</th>
                     </tr>
                   </thead>
                   <tbody className="bg-white divide-y divide-gray-200">
                     {Object.values(analysis.condoAnalysis.bedroomGroups)
                       .sort((a, b) => (a.bedrooms || 999) - (b.bedrooms || 999))
                       .map(group => (
                       <tr key={group.label}>
                         <td className="px-4 py-3 text-sm font-medium">
                           {group.label === '0BR' ? 'Studio' : group.label}
                         </td>
                         <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                         <td className="px-4 py-3 text-sm text-right">
                           ${Math.round(group.avgPrice).toLocaleString()}
                         </td>
                         <td className="px-4 py-3 text-sm text-right">
                           {Math.round(group.avgSize).toLocaleString()} SF
                         </td>
                         <td className="px-4 py-3 text-sm text-right font-medium">
                           ${Math.round(group.pricePerSF)}
                         </td>
                         <td className="px-4 py-3 text-sm text-right">
                           {analysis.condoAnalysis.totalCondos > 0 ? 
                             `${(group.count / analysis.condoAnalysis.totalCondos * 100).toFixed(1)}%` : '—'}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>

             {/* Floor Analysis (if data available) */}
             {analysis.condoAnalysis.hasFloorData && (
               <div className="bg-white rounded-lg shadow-sm p-6">
                 <h3 className="text-lg font-semibold mb-4">Floor Premium Analysis</h3>
                 <div className="overflow-x-auto">
                   <table className="min-w-full divide-y divide-gray-200">
                     <thead className="bg-gray-50">
                       <tr>
                         <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Floor</th>
                         <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                         <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                         <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Premium vs 1st</th>
                       </tr>
                     </thead>
                     <tbody className="bg-white divide-y divide-gray-200">
                       {Object.values(analysis.condoAnalysis.floorGroups)
                         .filter(g => g.floor !== null && g.floor !== -1)
                         .sort((a, b) => {
                           if (a.floor === 99) return 1;
                           if (b.floor === 99) return -1;
                           return (a.floor || 0) - (b.floor || 0);
                         })
                         .map(group => {
                           const firstFloor = analysis.condoAnalysis.floorGroups['Floor 1'];
                           const premium = firstFloor && firstFloor.avgPrice > 0 ? 
                             ((group.avgPrice - firstFloor.avgPrice) / firstFloor.avgPrice * 100) : 0;
                           
                           return (
                             <tr key={group.label} className={group.floor === 99 ? 'bg-purple-50' : ''}>
                               <td className="px-4 py-3 text-sm font-medium">
                                 {group.label}
                                 {group.floor === 99 && (
                                   <span className="ml-2 px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">PREMIUM</span>
                                 )}
                               </td>
                               <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                               <td className="px-4 py-3 text-sm text-right">
                                 ${Math.round(group.avgPrice).toLocaleString()}
                               </td>
                               <td className="px-4 py-3 text-sm text-right">
                                 {group.floor === 1 ? (
                                   <span className="text-gray-400">BASELINE</span>
                                 ) : (
                                   <span className={`inline-flex items-center gap-1 ${
                                     premium > 0 ? 'text-green-600' : premium < 0 ? 'text-red-600' : 'text-gray-600'
                                   }`}>
                                     {premium > 0 && <ArrowUpRight className="h-4 w-4" />}
                                     {premium < 0 && <ArrowDownRight className="h-4 w-4" />}
                                     {Math.abs(premium).toFixed(1)}%
                                   </span>
                                 )}
                               </td>
                             </tr>
                           );
                         })}
                     </tbody>
                   </table>
                 </div>
               </div>
             )}

             {/* Complex/VCS Analysis */}
             <div className="bg-white rounded-lg shadow-sm p-6">
               <h3 className="text-lg font-semibold mb-4">Condo Complex Analysis</h3>
               <div className="overflow-x-auto">
                 <table className="min-w-full divide-y divide-gray-200">
                   <thead className="bg-gray-50">
                     <tr>
                       <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Complex</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Units</th>
                       <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Price</th>
                       <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bedroom Mix</th>
                     </tr>
                   </thead>
                   <tbody className="bg-white divide-y divide-gray-200">
                     {Object.values(analysis.condoAnalysis.condoVCS)
                       .sort((a, b) => b.count - a.count)
                       .map(group => (
                       <tr key={group.code}>
                         <td className="px-4 py-3 text-sm">
                           <div>
                             <div className="font-medium">{group.description}</div>
                             <div className="text-xs text-gray-500">{group.code}</div>
                           </div>
                         </td>
                         <td className="px-4 py-3 text-sm text-right">{group.count}</td>
                         <td className="px-4 py-3 text-sm text-right">
                           ${Math.round(group.avgPrice).toLocaleString()}
                         </td>
                         <td className="px-4 py-3 text-sm">
                           <div className="flex gap-2">
                             {Object.entries(group.bedroomMix).map(([br, count]) => (
                               <span key={br} className="px-2 py-1 text-xs bg-gray-100 rounded">
                                 {br === '0BR' ? 'Studio' : br}: {count}
                               </span>
                             ))}
                           </div>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>

             {/* Data Quality Alert */}
             {!analysis.condoAnalysis.hasFloorData && (
               <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                 <div className="flex items-start gap-3">
                   <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                   <div>
                     <div className="font-medium text-yellow-900">Limited Floor Data</div>
                     <div className="text-sm text-yellow-800 mt-1">
                       Only {analysis.condoAnalysis.percentWithFloors.toFixed(0)}% of condos have floor designation. 
                       Clean up story height data in raw_data to improve floor premium analysis.
                     </div>
                   </div>
                 </div>
               </div>
             )}
           </>
         ) : (
           <div className="bg-gray-50 rounded-lg p-8 text-center">
             <Layers className="h-12 w-12 text-gray-400 mx-auto mb-3" />
             <div className="text-gray-600">No condominiums found in this dataset</div>
             <div className="text-sm text-gray-500 mt-2">
               Condos are identified by Type Use code 60 or descriptions containing "CONDO"
             </div>
           </div>
         )}
       </div>
     )}
   </div>
 );
};

export default OverallAnalysisTab;
  
  
