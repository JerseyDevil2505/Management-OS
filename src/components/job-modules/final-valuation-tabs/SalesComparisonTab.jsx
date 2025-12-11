import React, { useState, useEffect, useMemo } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import { Search, Save, X, TrendingUp, AlertCircle, Download } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const SalesComparisonTab = ({ jobData, properties, hpiData, onUpdateJobCache }) => {
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [comparables, setComparables] = useState([]);
  const [adjustmentGrid, setAdjustmentGrid] = useState([]);
  const [searchFilters, setSearchFilters] = useState({
    vcs: [],
    typeUse: '',
    design: '',
    sflaMin: '',
    sflaMax: '',
    saleDateStart: '',
    saleDateEnd: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  
  // CME Price Brackets (matching OverallAnalysisTab and AdjustmentsTab)
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

  const vendorType = jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

  // Load adjustment grid for job
  useEffect(() => {
    if (jobData?.id) {
      loadAdjustmentGrid();
    }
  }, [jobData?.id]);

  const loadAdjustmentGrid = async () => {
    try {
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;
      setAdjustmentGrid(data || []);
    } catch (error) {
      console.error('Error loading adjustment grid:', error);
    }
  };

  // Get eligible sales (CSP/PSP/HSP periods, valid NU codes)
  const eligibleSales = useMemo(() => {
    if (!jobData?.end_date) return [];
    
    const endYear = new Date(jobData.end_date).getFullYear();
    const yearOfValue = endYear - 1;
    
    // CSP: 10/1/(year-2) to 12/31/(year-1)
    const cspStart = new Date(yearOfValue - 1, 9, 1);
    const cspEnd = new Date(yearOfValue, 11, 31);
    
    // PSP: 10/1/(year-3) to 9/30/(year-2)
    const pspStart = new Date(yearOfValue - 2, 9, 1);
    const pspEnd = new Date(yearOfValue - 1, 8, 30);
    
    // HSP: 10/1/(year-4) to 9/30/(year-3)
    const hspStart = new Date(yearOfValue - 3, 9, 1);
    const hspEnd = new Date(yearOfValue - 2, 8, 30);
    
    const eligibleNUCodes = ['', '0', '00', '7', '07', '32'];
    
    return properties.filter(p => {
      // Must have sale data
      if (!p.sales_date || !p.values_norm_time) return false;
      
      // Check period
      const saleDate = new Date(p.sales_date);
      const inPeriod = (saleDate >= cspStart && saleDate <= cspEnd) ||
                       (saleDate >= pspStart && saleDate <= pspEnd) ||
                       (saleDate >= hspStart && saleDate <= hspEnd);
      
      if (!inPeriod) return false;
      
      // Check NU code (normalize to handle blank/00/0)
      const nuCode = (p.sales_nu || '').trim();
      const normalizedCode = nuCode === '' || nuCode === '00' ? '0' : nuCode;
      
      // Check if included via override or default
      const isEligible = eligibleNUCodes.includes(normalizedCode);
      
      // Check for manual override from property_market_analysis
      // (This would require additional query - implement if needed)
      
      return isEligible;
    });
  }, [properties, jobData?.end_date]);

  // Get price bracket index for a property
  const getPriceBracketIndex = (normPrice) => {
    if (!normPrice) return 0;
    const bracket = CME_BRACKETS.findIndex(b => normPrice >= b.min && normPrice <= b.max);
    return bracket >= 0 ? bracket : 0;
  };

  // Calculate adjustment for a comparable vs subject
  const calculateAdjustment = (subject, comp, adjustmentDef) => {
    if (!subject || !comp || !adjustmentDef) return 0;
    
    const bracketIndex = getPriceBracketIndex(comp.values_norm_time);
    const adjustmentValue = adjustmentDef[`bracket_${bracketIndex}`] || 0;
    
    // Get values based on adjustment type
    let subjectValue, compValue;
    
    switch (adjustmentDef.adjustment_id) {
      case 'lot_size':
        subjectValue = subject.asset_lot_acre || 0;
        compValue = comp.asset_lot_acre || 0;
        break;
      case 'living_area':
        subjectValue = subject.asset_sfla || 0;
        compValue = comp.asset_sfla || 0;
        break;
      case 'basement':
        // Check if has basement (implement based on your basement detection logic)
        subjectValue = subject.has_basement ? 1 : 0;
        compValue = comp.has_basement ? 1 : 0;
        break;
      case 'finished_basement':
        subjectValue = subject.has_finished_basement ? 1 : 0;
        compValue = comp.has_finished_basement ? 1 : 0;
        break;
      case 'bathrooms':
        subjectValue = subject.total_baths_calculated || 0;
        compValue = comp.total_baths_calculated || 0;
        break;
      case 'bedrooms':
        // Would need bedroom extraction logic
        subjectValue = 0;
        compValue = 0;
        break;
      case 'garage':
      case 'det_garage':
      case 'deck':
      case 'patio':
      case 'open_porch':
      case 'enclosed_porch':
      case 'pool':
        // Check if property has this amenity (would require code checking)
        subjectValue = hasAmenity(subject, adjustmentDef.adjustment_id) ? 1 : 0;
        compValue = hasAmenity(comp, adjustmentDef.adjustment_id) ? 1 : 0;
        break;
      case 'ac':
        // Would need AC detection
        subjectValue = 0;
        compValue = 0;
        break;
      case 'fireplaces':
        // Would need fireplace detection
        subjectValue = 0;
        compValue = 0;
        break;
      case 'exterior_condition':
      case 'interior_condition':
        // Condition comparison (would need condition scoring)
        subjectValue = getConditionScore(subject, adjustmentDef.adjustment_id);
        compValue = getConditionScore(comp, adjustmentDef.adjustment_id);
        break;
      default:
        return 0;
    }
    
    const difference = subjectValue - compValue;
    
    // Apply adjustment based on type
    switch (adjustmentDef.adjustment_type) {
      case 'flat':
        // Simple difference
        return difference * adjustmentValue;
      case 'per_sqft':
        // Multiply by difference
        return difference * adjustmentValue;
      case 'percent':
        // Percentage of sale price
        return (comp.values_norm_time || 0) * (adjustmentValue / 100) * Math.sign(difference);
      default:
        return 0;
    }
  };

  // Helper: Check if property has amenity
  const hasAmenity = (property, amenityType) => {
    // This would check property codes for the amenity
    // Placeholder implementation - needs actual code checking logic
    return false;
  };

  // Helper: Get condition score
  const getConditionScore = (property, conditionType) => {
    // Convert condition codes to numeric scores
    // Placeholder - implement based on your condition codes
    const conditionMap = { 'E': 5, 'VG': 4, 'G': 3, 'F': 2, 'P': 1 };
    
    if (conditionType === 'exterior_condition') {
      return conditionMap[property.asset_ext_cond] || 3;
    } else {
      return conditionMap[property.asset_int_cond] || 3;
    }
  };

  // Calculate all adjustments for a comparable
  const calculateAllAdjustments = (subject, comp) => {
    const adjustments = adjustmentGrid.map(adjDef => {
      const amount = calculateAdjustment(subject, comp, adjDef);
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

  // Filter comparables based on search criteria
  const filteredComparables = useMemo(() => {
    if (!selectedSubject) return [];
    
    let filtered = eligibleSales.filter(p => 
      p.property_composite_key !== selectedSubject.property_composite_key
    );
    
    // VCS filter
    if (searchFilters.vcs.length > 0) {
      filtered = filtered.filter(p => searchFilters.vcs.includes(p.property_vcs));
    }
    
    // Type/Use filter
    if (searchFilters.typeUse) {
      filtered = filtered.filter(p => p.asset_type_use === searchFilters.typeUse);
    }
    
    // Design filter
    if (searchFilters.design) {
      filtered = filtered.filter(p => p.asset_design_style === searchFilters.design);
    }
    
    // SFLA range
    if (searchFilters.sflaMin) {
      filtered = filtered.filter(p => (p.asset_sfla || 0) >= parseFloat(searchFilters.sflaMin));
    }
    if (searchFilters.sflaMax) {
      filtered = filtered.filter(p => (p.asset_sfla || 0) <= parseFloat(searchFilters.sflaMax));
    }
    
    // Date range
    if (searchFilters.saleDateStart) {
      filtered = filtered.filter(p => p.sales_date >= searchFilters.saleDateStart);
    }
    if (searchFilters.saleDateEnd) {
      filtered = filtered.filter(p => p.sales_date <= searchFilters.saleDateEnd);
    }
    
    return filtered;
  }, [selectedSubject, eligibleSales, searchFilters]);

  // Calculate recommended value from weighted comparables
  const calculateRecommendedValue = (comps) => {
    if (!comps || comps.length === 0) return null;
    
    const totalWeight = comps.reduce((sum, c) => sum + (c.weight || 0), 0);
    if (totalWeight === 0) return null;
    
    const weightedSum = comps.reduce((sum, c) => {
      const calc = calculateAllAdjustments(selectedSubject, c);
      return sum + (calc.adjustedPrice * (c.weight || 0));
    }, 0);
    
    return Math.round(weightedSum);
  };

  // Auto-suggest weights based on quality
  const autoSuggestWeights = () => {
    if (!selectedSubject || comparables.length === 0) return;
    
    // Score each comparable
    const scored = comparables.map(comp => {
      let score = 100;
      
      // Proximity (VCS match)
      if (comp.property_vcs !== selectedSubject.property_vcs) score -= 10;
      
      // Similarity (type, design)
      if (comp.asset_type_use !== selectedSubject.asset_type_use) score -= 15;
      if (comp.asset_design_style !== selectedSubject.asset_design_style) score -= 10;
      
      // SFLA similarity
      const sflaSubject = selectedSubject.asset_sfla || 0;
      const sflaComp = comp.asset_sfla || 0;
      const sflaDiff = Math.abs(sflaSubject - sflaComp);
      if (sflaDiff > sflaSubject * 0.2) score -= 15; // More than 20% difference
      
      // Recency
      const monthsAgo = (new Date() - new Date(comp.sales_date)) / (1000 * 60 * 60 * 24 * 30);
      if (monthsAgo > 12) score -= 10;
      
      // Adjustment magnitude
      const calc = calculateAllAdjustments(selectedSubject, comp);
      if (Math.abs(calc.adjustmentPercent) > 15) score -= 10;
      
      return { ...comp, qualityScore: Math.max(0, score) };
    });
    
    // Distribute weights proportionally
    const totalScore = scored.reduce((sum, c) => sum + c.qualityScore, 0);
    const weighted = scored.map(comp => ({
      ...comp,
      weight: totalScore > 0 ? (comp.qualityScore / totalScore) : (1 / scored.length)
    }));
    
    setComparables(weighted);
  };

  // Handle adding a comparable
  const handleAddComparable = (comp) => {
    if (comparables.length >= 10) {
      alert('Maximum 10 comparables allowed');
      return;
    }
    
    if (comparables.find(c => c.property_composite_key === comp.property_composite_key)) {
      alert('This comparable is already selected');
      return;
    }
    
    setComparables(prev => [...prev, { ...comp, weight: 0 }]);
  };

  // Handle removing a comparable
  const handleRemoveComparable = (compKey) => {
    setComparables(prev => prev.filter(c => c.property_composite_key !== compKey));
  };

  // Handle weight change
  const handleWeightChange = (compKey, newWeight) => {
    setComparables(prev => prev.map(c => 
      c.property_composite_key === compKey ? { ...c, weight: parseFloat(newWeight) || 0 } : c
    ));
  };

  // Save CME analysis to database
  const handleSaveCME = async () => {
    if (!selectedSubject) {
      alert('No subject property selected');
      return;
    }
    
    if (comparables.length === 0) {
      alert('No comparables selected');
      return;
    }
    
    const totalWeight = comparables.reduce((sum, c) => sum + (c.weight || 0), 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      alert(`Total weight must equal 100% (currently ${(totalWeight * 100).toFixed(1)}%)`);
      return;
    }
    
    try {
      setIsSaving(true);
      
      const recommendedValue = calculateRecommendedValue(comparables);
      
      // Build comparable data
      const compData = comparables.map((comp, idx) => {
        const calc = calculateAllAdjustments(selectedSubject, comp);
        return {
          comp_property_key: comp.property_composite_key,
          comp_address: comp.property_location,
          original_price: comp.values_norm_time,
          adjustments: calc.adjustments,
          total_adjustment: calc.totalAdjustment,
          adjusted_price: calc.adjustedPrice,
          weight: comp.weight,
          quality_score: comp.qualityScore || 0,
          sale_date: comp.sales_date
        };
      });
      
      // Save to final_valuation_data
      const { error } = await supabase
        .from('final_valuation_data')
        .upsert({
          job_id: jobData.id,
          property_composite_key: selectedSubject.property_composite_key,
          cme_projected_assessment: recommendedValue,
          cme_comparable_data: JSON.stringify(compData), // Store as JSONB
          final_method_used: 'cme',
          final_recommended_value: recommendedValue,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id,property_composite_key'
        });
      
      if (error) throw error;
      
      alert('CME analysis saved successfully!');
      
      if (onUpdateJobCache) {
        onUpdateJobCache(jobData.id, { forceRefresh: true });
      }
    } catch (error) {
      console.error('Error saving CME:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Export CME report
  const exportCMEReport = () => {
    if (!selectedSubject || comparables.length === 0) {
      alert('No CME analysis to export');
      return;
    }
    
    const wb = XLSX.utils.book_new();
    
    // Subject property info
    const subjectData = [
      ['SUBJECT PROPERTY ANALYSIS'],
      ['Block', selectedSubject.property_block],
      ['Lot', selectedSubject.property_lot],
      ['Qualifier', selectedSubject.property_qualifier],
      ['Address', selectedSubject.property_location],
      ['VCS', selectedSubject.property_vcs],
      ['Type/Use', selectedSubject.asset_type_use],
      ['Design', selectedSubject.asset_design_style],
      ['Year Built', selectedSubject.asset_year_built],
      ['SFLA', selectedSubject.asset_sfla],
      ['Current Assessment', selectedSubject.values_mod_total],
      [],
      ['COMPARABLE SALES ANALYSIS']
    ];
    
    // Comparables table
    const compHeaders = ['Comp #', 'Address', 'Sale Date', 'Sale Price', 'Adjustments', 'Adjusted Price', 'Weight', 'Weighted Value'];
    subjectData.push(compHeaders);
    
    comparables.forEach((comp, idx) => {
      const calc = calculateAllAdjustments(selectedSubject, comp);
      subjectData.push([
        idx + 1,
        comp.property_location,
        comp.sales_date,
        comp.values_norm_time,
        calc.totalAdjustment,
        calc.adjustedPrice,
        `${(comp.weight * 100).toFixed(1)}%`,
        Math.round(calc.adjustedPrice * comp.weight)
      ]);
    });
    
    // Summary
    const recommendedValue = calculateRecommendedValue(comparables);
    subjectData.push([]);
    subjectData.push(['CME Recommended Value', recommendedValue]);
    subjectData.push(['Current Assessment', selectedSubject.values_mod_total]);
    subjectData.push(['Difference', recommendedValue - selectedSubject.values_mod_total]);
    subjectData.push(['Change %', ((recommendedValue - selectedSubject.values_mod_total) / selectedSubject.values_mod_total * 100).toFixed(2) + '%']);
    
    const ws = XLSX.utils.aoa_to_sheet(subjectData);
    
    // Styling
    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center' }
    };
    
    const dataStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center' }
    };
    
    // Apply styles (simplified - full implementation would style all cells)
    ws['A1'].s = { font: { name: 'Leelawadee', sz: 14, bold: true } };
    
    ws['!cols'] = [
      { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 15 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'CME Analysis');
    XLSX.writeFile(wb, `CME_Analysis_${selectedSubject.property_block}_${selectedSubject.property_lot}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Set default filters when subject is selected
  useEffect(() => {
    if (selectedSubject) {
      const subjectSFLA = selectedSubject.asset_sfla || 0;
      setSearchFilters({
        vcs: [selectedSubject.property_vcs], // Default to same VCS
        typeUse: selectedSubject.asset_type_use, // Match type
        design: selectedSubject.asset_design_style, // Match design
        sflaMin: Math.round(subjectSFLA * 0.8).toString(), // ±20%
        sflaMax: Math.round(subjectSFLA * 1.2).toString(),
        saleDateStart: '',
        saleDateEnd: ''
      });
    }
  }, [selectedSubject]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sales Comparison (CME)</h2>
          <p className="text-sm text-gray-600 mt-1">
            Comparative Market Evaluation - Select comparables and calculate recommended values
          </p>
        </div>
        {selectedSubject && (
          <div className="flex items-center gap-2">
            <button
              onClick={autoSuggestWeights}
              disabled={comparables.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <TrendingUp className="w-4 h-4" />
              Auto-Weight
            </button>
            <button
              onClick={exportCMEReport}
              disabled={comparables.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export Report
            </button>
            <button
              onClick={handleSaveCME}
              disabled={isSaving || comparables.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save CME'}
            </button>
          </div>
        )}
      </div>

      {/* Subject Property Selection */}
      {!selectedSubject ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Subject Property</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {properties.map(prop => (
              <button
                key={prop.property_composite_key}
                onClick={() => setSelectedSubject(prop)}
                className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-500"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">
                      {prop.property_block}-{prop.property_lot}-{prop.property_qualifier}
                    </span>
                    <span className="text-gray-600 ml-3">{prop.property_location}</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {prop.asset_type_use} | {prop.asset_sfla?.toLocaleString()} SF
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Subject Property Panel */}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Subject Property</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Address:</span>
                    <span className="ml-2 font-medium">{selectedSubject.property_location}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Block-Lot-Qual:</span>
                    <span className="ml-2 font-medium">
                      {selectedSubject.property_block}-{selectedSubject.property_lot}-{selectedSubject.property_qualifier}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">VCS:</span>
                    <span className="ml-2 font-medium">{selectedSubject.property_vcs}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Type/Use:</span>
                    <span className="ml-2 font-medium">{selectedSubject.asset_type_use}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Design:</span>
                    <span className="ml-2 font-medium">{selectedSubject.asset_design_style}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Year Built:</span>
                    <span className="ml-2 font-medium">{selectedSubject.asset_year_built}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">SFLA:</span>
                    <span className="ml-2 font-medium">{selectedSubject.asset_sfla?.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Current Assessment:</span>
                    <span className="ml-2 font-medium">${selectedSubject.values_mod_total?.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedSubject(null);
                  setComparables([]);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Comparable Search */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Search Comparables</h3>
              <button
                onClick={() => setShowSearchModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Search className="w-4 h-4" />
                Add Comparables
              </button>
            </div>

            <div className="text-sm text-gray-600">
              {eligibleSales.length} eligible sales available | {comparables.length}/10 comparables selected
            </div>
          </div>

          {/* Selected Comparables */}
          {comparables.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Selected Comparables</h3>
              
              {/* Weight Total */}
              <div className="mb-4 p-3 bg-gray-50 rounded border">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-700">Total Weight:</span>
                  <span className={`font-bold text-lg ${
                    Math.abs(comparables.reduce((sum, c) => sum + (c.weight || 0), 0) - 1.0) < 0.01
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}>
                    {(comparables.reduce((sum, c) => sum + (c.weight || 0), 0) * 100).toFixed(1)}%
                  </span>
                </div>
                {Math.abs(comparables.reduce((sum, c) => sum + (c.weight || 0), 0) - 1.0) >= 0.01 && (
                  <div className="text-sm text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    Total weight must equal 100%
                  </div>
                )}
              </div>

              {/* Comparables List */}
              <div className="space-y-4">
                {comparables.map((comp, idx) => {
                  const calc = calculateAllAdjustments(selectedSubject, comp);
                  
                  return (
                    <div key={comp.property_composite_key} className="border rounded-lg p-4 bg-gray-50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="font-semibold text-gray-900">
                            Comparable {idx + 1}: {comp.property_location}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {comp.property_block}-{comp.property_lot}-{comp.property_qualifier} | 
                            Sale: {comp.sales_date} | 
                            Price: ${comp.values_norm_time?.toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveComparable(comp.property_composite_key)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Adjustments Summary */}
                      <div className="grid grid-cols-3 gap-4 mb-3 text-sm">
                        <div>
                          <span className="text-gray-600">Original Price:</span>
                          <div className="font-medium">${comp.values_norm_time?.toLocaleString()}</div>
                        </div>
                        <div>
                          <span className="text-gray-600">Total Adjustment:</span>
                          <div className={`font-medium ${calc.totalAdjustment >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {calc.totalAdjustment >= 0 ? '+' : ''}${calc.totalAdjustment.toLocaleString()} ({calc.adjustmentPercent.toFixed(1)}%)
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">Adjusted Price:</span>
                          <div className="font-medium">${calc.adjustedPrice.toLocaleString()}</div>
                        </div>
                      </div>

                      {/* Weight Slider */}
                      <div className="mt-3">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-medium text-gray-700">Weight:</label>
                          <input
                            type="number"
                            value={(comp.weight * 100).toFixed(1)}
                            onChange={(e) => handleWeightChange(comp.property_composite_key, parseFloat(e.target.value) / 100 || 0)}
                            className="w-20 px-2 py-1 text-sm border rounded text-center"
                            step="1"
                            min="0"
                            max="100"
                          />
                          <span className="text-sm text-gray-600">%</span>
                        </div>
                        <input
                          type="range"
                          value={comp.weight * 100}
                          onChange={(e) => handleWeightChange(comp.property_composite_key, parseFloat(e.target.value) / 100)}
                          className="w-full"
                          min="0"
                          max="100"
                          step="1"
                        />
                      </div>

                      {/* Quality Score */}
                      {comp.qualityScore !== undefined && (
                        <div className="mt-2 text-sm text-gray-600">
                          Quality Score: {comp.qualityScore.toFixed(0)}/100
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Recommended Value */}
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-600">CME Recommended Value</div>
                    <div className="text-2xl font-bold text-green-700">
                      ${calculateRecommendedValue(comparables)?.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">vs. Current Assessment</div>
                    <div className={`text-2xl font-bold ${
                      (calculateRecommendedValue(comparables) || 0) > selectedSubject.values_mod_total
                        ? 'text-red-600'
                        : 'text-green-600'
                    }`}>
                      {((calculateRecommendedValue(comparables) || 0) - selectedSubject.values_mod_total >= 0 ? '+' : '')}
                      ${((calculateRecommendedValue(comparables) || 0) - selectedSubject.values_mod_total).toLocaleString()}
                      ({(((calculateRecommendedValue(comparables) || 0) - selectedSubject.values_mod_total) / selectedSubject.values_mod_total * 100).toFixed(1)}%)
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Search Modal */}
          {showSearchModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Search Comparable Sales</h3>
                  <button
                    onClick={() => setShowSearchModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Search Filters */}
                <div className="px-6 py-4 border-b bg-gray-50">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">Type/Use</label>
                      <input
                        type="text"
                        value={searchFilters.typeUse}
                        onChange={(e) => setSearchFilters(f => ({ ...f, typeUse: e.target.value }))}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">Design</label>
                      <input
                        type="text"
                        value={searchFilters.design}
                        onChange={(e) => setSearchFilters(f => ({ ...f, design: e.target.value }))}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">VCS</label>
                      <input
                        type="text"
                        value={searchFilters.vcs.join(', ')}
                        onChange={(e) => setSearchFilters(f => ({ ...f, vcs: e.target.value.split(',').map(v => v.trim()) }))}
                        className="w-full px-3 py-2 border rounded"
                        placeholder="Comma-separated"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">SFLA Min</label>
                      <input
                        type="number"
                        value={searchFilters.sflaMin}
                        onChange={(e) => setSearchFilters(f => ({ ...f, sflaMin: e.target.value }))}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 font-medium mb-1">SFLA Max</label>
                      <input
                        type="number"
                        value={searchFilters.sflaMax}
                        onChange={(e) => setSearchFilters(f => ({ ...f, sflaMax: e.target.value }))}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                  </div>
                </div>

                {/* Results */}
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="text-sm text-gray-600 mb-4">
                    {filteredComparables.length} comparables match your criteria
                  </div>
                  <div className="space-y-2">
                    {filteredComparables.map(comp => (
                      <div
                        key={comp.property_composite_key}
                        className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50"
                      >
                        <div className="flex-1">
                          <div className="font-medium">
                            {comp.property_block}-{comp.property_lot}-{comp.property_qualifier}
                          </div>
                          <div className="text-sm text-gray-600">
                            {comp.property_location} | {comp.asset_sfla?.toLocaleString()} SF | 
                            Sale: {comp.sales_date} | ${comp.values_norm_time?.toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            handleAddComparable(comp);
                            setShowSearchModal(false);
                          }}
                          disabled={comparables.find(c => c.property_composite_key === comp.property_composite_key)}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {comparables.find(c => c.property_composite_key === comp.property_composite_key) ? 'Added' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* No Adjustment Grid Warning */}
      {adjustmentGrid.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <h4 className="font-semibold text-yellow-900">Adjustment Grid Not Configured</h4>
            <p className="text-sm text-yellow-800 mt-1">
              No adjustments will be applied. Please configure the adjustment grid in the Adjustments tab.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesComparisonTab;
