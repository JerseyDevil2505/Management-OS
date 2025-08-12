// OverallAnalysisTab.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { interpretCodes } from '../../lib/supabaseClient';
import { BarChart, TrendingUp, Home, Building, RefreshCw, Save, AlertCircle } from 'lucide-react';

const OverallAnalysisTab = ({ properties, jobData, vendorType, codeDefinitions }) => {
  const [analysisResults, setAnalysisResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [useJimFormula, setUseJimFormula] = useState(false);
  const [lastAnalysisTime, setLastAnalysisTime] = useState(null);
  const [selectedBaseline, setSelectedBaseline] = useState(null);

  useEffect(() => {
    loadExistingAnalysis();
  }, [jobData.id]);

  const loadExistingAnalysis = async () => {
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .select('overall_analysis_results, overall_analysis_config, overall_analysis_updated_at')
        .eq('job_id', jobData.id)
        .single();

      if (data?.overall_analysis_results) {
        setAnalysisResults(data.overall_analysis_results);
        setLastAnalysisTime(data.overall_analysis_updated_at);
        if (data.overall_analysis_config?.useJimFormula !== undefined) {
          setUseJimFormula(data.overall_analysis_config.useJimFormula);
        }
      } else {
        // Run initial analysis if none exists
        runCompleteAnalysis();
      }
    } catch (error) {
      console.error('Error loading analysis:', error);
      // Run fresh analysis on error
      runCompleteAnalysis();
    }
  };

  const runCompleteAnalysis = async () => {
    setIsCalculating(true);
    
    // Filter to only properties with normalized values (manager-vetted sales)
    const validProperties = properties.filter(p => p.values_norm_time && p.values_norm_time > 0);
    
    if (validProperties.length === 0) {
      alert('No properties with normalized values found. Please complete Pre-Valuation normalization first.');
      setIsCalculating(false);
      return;
    }

    console.log(`Analyzing ${validProperties.length} properties with normalized values...`);

    // Run the three core analyses
    const typeUseResults = analyzeTypeAndUse(validProperties);
    const designResults = analyzeDesignAndStyle(validProperties);
    const vcsResults = analyzeVCSPatterns(validProperties);
    
    // Generate market insights
    const insights = generateMarketInsights(typeUseResults, designResults, vcsResults);

    const results = {
      generated_at: new Date().toISOString(),
      property_count: validProperties.length,
      baseline_type: typeUseResults.baseline,
      type_use_analysis: typeUseResults,
      design_style_analysis: designResults,
      vcs_patterns: vcsResults,
      market_insights: insights,
      jim_formula_applied: useJimFormula
    };

    setAnalysisResults(results);
    setIsCalculating(false);
    setLastAnalysisTime(new Date());
  };

  const analyzeTypeAndUse = (properties) => {
    // Group by type and calculate metrics
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
        // Apply Jim's 50% formula for size adjustment
        const baseSize = 2000; // Standard comparison size
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

    // Calculate deltas from baseline
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
          totalSize: 0
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
    });

    // Calculate averages and find most popular
    let mostPopular = null;
    let maxCount = 0;
    
    Object.values(designGroups).forEach(group => {
      group.avgPrice = group.totalPrice / group.count;
      group.avgAdjPrice = group.totalAdjPrice / group.count;
      group.avgSize = group.totalSize / group.count;
      
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
    
    // Group properties by VCS
    const vcsGroups = {};
    properties.forEach(p => {
      const vcs = p.property_vcs || p.newVCS;
      if (!vcs) return;
      
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = {
          code: vcs,
          description: interpretCodes.getVCSDescription(p, codeDefinitions, vendorType) || vcs,
          byType: {},
          totalCount: 0
        };
      }
      
      const type = p.asset_type_use;
      if (!vcsGroups[vcs].byType[type]) {
        vcsGroups[vcs].byType[type] = [];
      }
      
      vcsGroups[vcs].byType[type].push(p);
      vcsGroups[vcs].totalCount++;
    });

    // Analyze each VCS for interesting patterns
    Object.entries(vcsGroups).forEach(([vcsCode, vcsData]) => {
      const analysis = {
        code: vcsCode,
        description: vcsData.description,
        totalCount: vcsData.totalCount,
        typeBreakdown: {},
        patterns: []
      };

      // Type breakdown for this VCS
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
          avgSize: props.reduce((sum, p) => sum + (p.asset_sfla || 0), 0) / props.length
        };
      });

      // Look for interesting patterns
      const types = Object.keys(vcsData.byType);
      
      // Interior vs End Row Analysis
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
            "Market shows negligible difference - consider skipping adjustment" : 
            `Market supports ${Math.abs(percentDiff) > 10 ? 'significant' : 'moderate'} adjustment`,
          metrics: {
            interior: { count: interior.length, avgPrice: intAvg },
            end: { count: end.length, avgPrice: endAvg },
            difference,
            percentDiff
          }
        });
      }

      // Condo Analysis (if significant condo presence)
      if (vcsData.byType['60'] && vcsData.byType['60'].length > 5) {
        const condos = vcsData.byType['60'];
        
        // Try to analyze by bedroom count if available
        const byBedrooms = {};
        condos.forEach(c => {
          // This would need actual bedroom field - placeholder for now
          const bedrooms = c.total_bedrooms || '2'; // Default assumption
          if (!byBedrooms[bedrooms]) byBedrooms[bedrooms] = [];
          byBedrooms[bedrooms].push(c);
        });
        
        if (Object.keys(byBedrooms).length > 1) {
          const bedroomAnalysis = {};
          Object.entries(byBedrooms).forEach(([beds, units]) => {
            bedroomAnalysis[beds] = {
              count: units.length,
              avgPrice: units.reduce((sum, u) => sum + u.values_norm_time, 0) / units.length
            };
          });
          
          analysis.patterns.push({
            type: 'CONDO_BEDROOMS',
            finding: `Condo breakdown by bedrooms in ${vcsData.description}`,
            metrics: bedroomAnalysis
          });
        }
      }

      // Twin vs Single Family
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

      // Only include VCS with interesting patterns or multiple property types
      if (analysis.patterns.length > 0 || types.length > 1) {
        vcsAnalysis[vcsCode] = analysis;
      }
    });

    return vcsAnalysis;
  };

  const generateMarketInsights = (typeUse, design, vcsPatterns) => {
    const insights = [];
    
    // Type/Use insights
    Object.values(typeUse.groups).forEach(group => {
      if (group.code !== typeUse.baseline) {
        if (Math.abs(group.priceDeltaPercent) > 20) {
          insights.push({
            category: 'TYPE_USE',
            severity: Math.abs(group.priceDeltaPercent) > 30 ? 'high' : 'medium',
            message: `${group.description} shows ${Math.abs(group.priceDeltaPercent).toFixed(0)}% ${group.priceDeltaPercent > 0 ? 'premium' : 'discount'} vs ${typeUse.baselineDescription}`,
            value: group.priceDeltaPercent
          });
        }
      }
    });

    // Design insights
    const colonialGroup = Object.values(design.groups).find(g => g.code === 'CL' || g.description.includes('COLONIAL'));
    if (colonialGroup && colonialGroup.priceDeltaPercent > 10) {
      insights.push({
        category: 'DESIGN',
        severity: 'medium',
        message: `Colonial design commands ${colonialGroup.priceDeltaPercent.toFixed(0)}% premium in this market`,
        value: colonialGroup.priceDeltaPercent
      });
    }

    // VCS Pattern insights
    Object.values(vcsPatterns).forEach(vcs => {
      vcs.patterns.forEach(pattern => {
        if (pattern.type === 'ROW_POSITION' && pattern.metrics.percentDiff) {
          if (Math.abs(pattern.metrics.percentDiff) < 5) {
            insights.push({
              category: 'MARKET_REALITY',
              severity: 'info',
              message: `${vcs.description}: End vs Interior shows only ${Math.abs(pattern.metrics.percentDiff).toFixed(1)}% difference - traditional adjustments may be unnecessary`,
              value: pattern.metrics.percentDiff
            });
          }
        }
      });
    });

    // Sort by severity and value
    insights.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return Math.abs(b.value) - Math.abs(a.value);
    });

    return insights;
  };

  const saveAnalysis = async () => {
    if (!analysisResults) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .upsert({
          job_id: jobData.id,
          overall_analysis_results: analysisResults,
          overall_analysis_config: {
            useJimFormula,
            selectedBaseline,
            lastRun: new Date()
          },
          overall_analysis_updated_at: new Date(),
          overall_analysis_stale: false,
          updated_at: new Date()
        }, {
          onConflict: 'job_id'
        });

      if (error) throw error;
      
      alert('Analysis saved successfully!');
    } catch (error) {
      console.error('Error saving analysis:', error);
      alert('Error saving analysis. Check console for details.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBaselineChange = (newBaseline) => {
    setSelectedBaseline(newBaseline);
    // Rerun analysis with new baseline
    runCompleteAnalysis();
  };

  const toggleJimFormula = () => {
    setUseJimFormula(!useJimFormula);
    // Rerun analysis with new formula setting
    setTimeout(() => runCompleteAnalysis(), 100);
  };

  // Render functions
  const renderTypeUseTable = () => {
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
        
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
              <th style={{ padding: '12px', textAlign: 'left' }}>Type</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Count</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Avg Price</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Adj Price</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Size</th>
              <th style={{ padding: '12px', textAlign: 'right' }}>Delta</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedGroups.map(group => (
              <tr 
                key={group.code} 
                style={{ 
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: group.code === baseline ? '#FEF3C7' : 'white'
                }}
              >
                <td style={{ padding: '12px', fontWeight: group.code === baseline ? '600' : '400' }}>
                  {group.description}
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
                  color: group.priceDeltaPercent > 0 ? '#10B981' : group.priceDeltaPercent < 0 ? '#EF4444' : '#6B7280'
                }}>
                  {group.code === baseline ? 
                    'BASELINE' : 
                    `${group.priceDeltaPercent > 0 ? '+' : ''}${group.priceDeltaPercent.toFixed(1)}%`
                  }
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  {group.code !== baseline && (
                    <button
                      onClick={() => handleBaselineChange(group.code)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        background: '#3B82F6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Set as Baseline
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDesignStyleTable = () => {
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
                  fontWeight: Math.abs(group.priceDeltaPercent) > 10 ? '600' : '400'
                }}>
                  {group.code === mostPopular ? 
                    'MOST POPULAR' : 
                    `${group.priceDeltaPercent > 0 ? '+' : ''}${group.priceDeltaPercent.toFixed(1)}%`
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderVCSPatterns = () => {
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
            <div style={{ marginBottom: '12px' }}>
              <strong>{vcs.description || vcs.code}</strong>
              <span style={{ marginLeft: '12px', color: '#6B7280', fontSize: '14px' }}>
                ({vcs.totalCount} properties)
              </span>
            </div>
            
            {/* Type breakdown for this VCS */}
            {Object.keys(vcs.typeBreakdown).length > 1 && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', color: '#6B7280', marginBottom: '8px' }}>Property Type Mix:</div>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  {Object.entries(vcs.typeBreakdown).map(([typeCode, data]) => (
                    <div key={typeCode} style={{ 
                      background: 'white', 
                      padding: '8px 12px', 
                      borderRadius: '4px',
                      border: '1px solid #E5E7EB'
                    }}>
                      <div style={{ fontSize: '12px', color: '#6B7280' }}>{data.description}</div>
                      <div style={{ fontWeight: '600' }}>{data.count} @ ${Math.round(data.avgAdjPrice / 1000)}K</div>
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
                <div style={{ fontWeight: '500', marginBottom: '8px' }}>
                  {pattern.type === 'ROW_POSITION' && '🏘️ Interior vs End Unit Analysis'}
                  {pattern.type === 'TWIN_VS_SINGLE' && '🏠 Twin vs Single Family'}
                  {pattern.type === 'CONDO_BEDROOMS' && '🏢 Condo Analysis'}
                </div>
                
                <div style={{ fontSize: '14px', marginBottom: '8px' }}>{pattern.finding}</div>
                
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
                      <>
                        Interior: {pattern.metrics.interior.count} units @ ${Math.round(pattern.metrics.interior.avgPrice).toLocaleString()} | 
                        End: {pattern.metrics.end.count} units @ ${Math.round(pattern.metrics.end.avgPrice).toLocaleString()}
                      </>
                    )}
                    {pattern.type === 'TWIN_VS_SINGLE' && (
                      <>
                        Singles: {pattern.metrics.singles.count} @ ${Math.round(pattern.metrics.singles.avgPrice).toLocaleString()} | 
                        Twins: {pattern.metrics.twins.count} @ ${Math.round(pattern.metrics.twins.avgPrice).toLocaleString()}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const renderInsights = () => {
    if (!analysisResults?.market_insights || analysisResults.market_insights.length === 0) {
      return null;
    }
    
    const severityColors = {
      high: { bg: '#FEE2E2', color: '#991B1B', icon: '🔴' },
      medium: { bg: '#FEF3C7', color: '#92400E', icon: '🟡' },
      low: { bg: '#D1FAE5', color: '#065F46', icon: '🟢' },
      info: { bg: '#EFF6FF', color: '#1E40AF', icon: 'ℹ️' }
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
        
        {analysisResults.market_insights.map((insight, idx) => (
          <div key={idx} style={{ 
            marginBottom: '12px',
            padding: '12px',
            background: severityColors[insight.severity].bg,
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center'
          }}>
            <span style={{ marginRight: '12px', fontSize: '18px' }}>
              {severityColors[insight.severity].icon}
            </span>
            <div>
              <div style={{ 
                fontSize: '12px', 
                color: severityColors[insight.severity].color,
                fontWeight: '600',
                marginBottom: '4px'
              }}>
                {insight.category.replace(/_/g, ' ')}
              </div>
              <div style={{ color: severityColors[insight.severity].color }}>
                {insight.message}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

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
            onClick={toggleJimFormula}
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
              {analysisResults.property_count} Properties Analyzed
            </span>
          )}
        </div>
      </div>

      {/* Results Section */}
      {analysisResults ? (
        <>
          {renderInsights()}
          {renderTypeUseTable()}
          {renderDesignStyleTable()}
          {renderVCSPatterns()}
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
};

export default OverallAnalysisTab;
