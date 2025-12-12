import React, { useState, useMemo, useEffect } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import { ChevronLeft, ChevronRight, Download, Filter, Columns, Save, AlertCircle, X } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const MarketDataTab = ({ jobData, properties, marketLandData, hpiData, onUpdateJobCache }) => {
  // State management
  const [finalValuationData, setFinalValuationData] = useState({});
  const [taxRates, setTaxRates] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'property_block', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage] = useState(500);
  const [viewMode, setViewMode] = useState('full'); // 'full' or 'condensed'
  const [isSaving, setSaving] = useState(false);

  // Refs for scroll synchronization
  const topScrollRef = React.useRef(null);
  const mainScrollRef = React.useRef(null);
  const bottomScrollRef = React.useRef(null);

  // Scroll synchronization handlers
  const handleTopScroll = (e) => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
    if (bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleMainScroll = (e) => {
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
    if (bottomScrollRef.current) {
      bottomScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleBottomScroll = (e) => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };
  
  // Filters
  const [filters, setFilters] = useState({
    typeUse: 'all',
    design: 'all',
    vcs: 'all',
    hasSales: 'all'
  });

  // Load final valuation data and tax rates
  useEffect(() => {
    if (jobData?.id) {
      loadFinalValuationData();
      loadTaxRates();
    }
  }, [jobData?.id]);

  const loadFinalValuationData = async () => {
    try {
      const { data, error } = await supabase
        .from('final_valuation_data')
        .select('*')
        .eq('job_id', jobData.id);

      if (error) throw error;

      // Convert array to map by property_composite_key
      const dataMap = {};
      (data || []).forEach(item => {
        dataMap[item.property_composite_key] = item;
      });
      setFinalValuationData(dataMap);
    } catch (error) {
      console.error('Error loading final valuation data:', error);
    }
  };

  const loadTaxRates = async () => {
    try {
      const { data, error} = await supabase
        .from('job_tax_rates')
        .select('*')
        .eq('job_id', jobData.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setTaxRates(data);
    } catch (error) {
      console.error('Error loading tax rates:', error);
    }
  };

  // Calculate year prior to due year
  const yearPriorToDueYear = useMemo(() => {
    if (!jobData?.end_date) return new Date().getFullYear();
    const endYear = new Date(jobData.end_date).getFullYear();
    return endYear - 1;
  }, [jobData?.end_date]);

  // Get vendor type and code definitions
  const vendorType = jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

  // Helper: Get bedroom count from property
  const getBedroomTotal = (property) => {
    // TODO: Find bedroom field from OverallAnalysisTab implementation
    // For now return placeholder
    return property.bedroom_total || null;
  };

  // Helper: Get max card number
  const getMaxCardNumber = (property) => {
    const card = property.property_addl_card;
    if (!card) return 1;
    // Extract number from card field
    const match = card.match(/\d+/);
    return match ? parseInt(match[0]) : 1;
  };

  // Helper: Calculate Card SF (additional cards only, excluding main)
  const getCardSF = (property) => {
    // Sum SFLA of additional cards only (card > 1 for BRT, card != M for Microsystems)
    const card = property.property_addl_card;
    if (!card) return 0;

    if (vendorType === 'BRT') {
      // BRT: Card 1 is main, card 2+ are additional
      const cardNum = parseInt(card.match(/\d+/)?.[0] || '1');
      if (cardNum > 1) {
        return property.asset_sfla || 0;
      }
    } else {
      // Microsystems: Card M is main, others are additional
      if (card.toUpperCase() !== 'M') {
        return property.asset_sfla || 0;
      }
    }
    return 0;
  };

  // Helper: Calculate Total SFLA (all cards)
  const getTotalSFLA = (property) => {
    const mainSFLA = property.asset_sfla || 0;
    const cardSF = getCardSF(property);
    return mainSFLA + cardSF;
  };

  // Helper: Check if classes match - returns 'TRUE' or 'FALSE' string
  const classesMatch = (property) => {
    return property.property_m4_class === property.property_cama_class ? 'TRUE' : 'FALSE';
  };

  // Helper: Get sales period code (CSP/PSP/HSP)
  const getSalesPeriodCode = (property) => {
    if (!property.sales_date) return null;
    
    const saleDate = new Date(property.sales_date);
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
    
    if (saleDate >= cspStart && saleDate <= cspEnd) return 'CSP';
    if (saleDate >= pspStart && saleDate <= pspEnd) return 'PSP';
    if (saleDate >= hspStart && saleDate <= hspEnd) return 'HSP';
    return null;
  };

  // Helper: Get row color class and style based on sales period
  const getRowColorClass = (salesCode) => {
    if (salesCode === 'CSP') return 'bg-green-50 hover:bg-green-100';
    if (salesCode === 'PSP') return 'bg-blue-50 hover:bg-blue-100';
    return 'hover:bg-gray-50';
  };

  const getRowStyle = (salesCode) => {
    if (salesCode === 'HSP') {
      return { backgroundColor: '#fed7aa' }; // Tailwind orange-200
    }
    return {};
  };

  // Helper: Get effective age for property based on vendor
  const getEffectiveAge = (property) => {
    if (vendorType === 'BRT') {
      // BRT: Effective age is stored in year format (EFFAGE column)
      return property.asset_effective_age || null;
    } else {
      // Microsystems: Effective Age is given, need to calculate effective year
      // Effective Year = Year Prior to Due Year - Effective Age
      const effectiveAge = property.asset_effective_age;
      if (effectiveAge === null || effectiveAge === undefined) return null;
      return yearPriorToDueYear - effectiveAge;
    }
  };

  // FORMULAS

  // Formula: Recommended EFA
  const calculateRecommendedEFA = (property) => {
    const normTime = property.values_norm_time || 0;
    const camaLand = property.values_cama_land || 0;
    const detItems = property.values_det_items || 0;
    const replCost = property.values_repl_cost || 0;
    
    if (replCost === 0) return null;
    
    const formula = yearPriorToDueYear - ((1 - ((normTime - camaLand - detItems) / replCost)) * 100);
    return Math.round(formula * 10) / 10; // Round to 1 decimal
  };

  // Formula: DEPR factor
  const calculateDEPR = (actualEFA) => {
    if (actualEFA === null || actualEFA === undefined) return null;
    const depr = 1 - ((yearPriorToDueYear - actualEFA) / 100);
    return depr > 1 ? 1 : depr;
  };

  // Formula: New Value
  const calculateNewValue = (property, depr) => {
    if (depr === null) return null;
    const replCost = property.values_repl_cost || 0;
    const detItems = property.values_det_items || 0;
    const camaLand = property.values_cama_land || 0;
    
    const newValue = (replCost * depr) + detItems + camaLand;
    return Math.round(newValue / 100) * 100; // Round to nearest 100
  };

  // Formula: Projected Improvement
  const calculateProjectedImprovement = (property, newValue) => {
    const typeUse = property.asset_type_use;
    const buildingClass = property.asset_building_class;
    const maxCard = getMaxCardNumber(property);
    
    // Use formula if: has type/use, class > 10, class not blank, no additional cards
    if (typeUse && buildingClass && parseInt(buildingClass) > 10 && maxCard === 1 && newValue !== null) {
      const camaLand = property.values_cama_land || 0;
      return newValue - camaLand;
    }
    
    // Otherwise use CAMA improvement
    return property.values_cama_improvement || 0;
  };

  // Formula: Projected Total
  const calculateProjectedTotal = (property, projectedImprovement) => {
    const camaLand = property.values_cama_land || 0;
    return camaLand + projectedImprovement;
  };

  // Formula: New Land Allocation %
  const calculateNewLandAllocation = (property, projectedTotal) => {
    if (projectedTotal === 0) return null;
    const camaLand = property.values_cama_land || 0;
    return (camaLand / projectedTotal) * 100;
  };

  // Formula: Delta %
  const calculateDeltaPercent = (property, projectedTotal) => {
    const currentTotal = property.values_mod_total || 0;
    if (currentTotal === 0) return null;
    return ((projectedTotal - currentTotal) / currentTotal) * 100;
  };

  // Formula: Current Taxes
  const calculateCurrentTaxes = (property) => {
    if (!taxRates?.current_total_rate) return 0;
    const isTaxable = property.property_facility !== 'EXEMPT'; // Adjust as needed
    if (!isTaxable) return 0;
    const currentTotal = property.values_mod_total || 0;
    return currentTotal * taxRates.current_total_rate;
  };

  // Formula: Projected Taxes
  const calculateProjectedTaxes = (projectedTotal) => {
    if (!taxRates?.projected_total_rate) return 0;
    return projectedTotal * taxRates.projected_total_rate;
  };

  // Formula: Tax Delta
  const calculateTaxDelta = (currentTaxes, projectedTaxes) => {
    return projectedTaxes - currentTaxes;
  };

  // Get all calculated values for a property
  const getCalculatedValues = (property) => {
    const storedData = finalValuationData[property.property_composite_key] || {};

    // Calculate actualEFA based on vendor type
    let actualEFA = storedData.actual_efa;
    if (actualEFA === null || actualEFA === undefined) {
      // If not stored, derive from vendor-specific logic
      if (vendorType === 'BRT') {
        // BRT: EFFAGE is stored as effective year (like 1950)
        // Use asset_effective_age which maps to EFFAGE column
        if (property.asset_effective_age !== null && property.asset_effective_age !== undefined) {
          actualEFA = property.asset_effective_age;
        } else if (property.asset_year_built) {
          // Fallback to year built if EFFAGE not available
          actualEFA = property.asset_year_built;
        }
      } else {
        // Microsystems: Effective Age is given as age in years
        // Calculate effective year = Year Prior to Due Year - Effective Age
        if (property.asset_effective_age !== null && property.asset_effective_age !== undefined) {
          actualEFA = yearPriorToDueYear - property.asset_effective_age;
        }
      }
    }

    const recommendedEFA = calculateRecommendedEFA(property);
    const depr = actualEFA !== null && actualEFA !== undefined ? calculateDEPR(actualEFA) : null;
    const newValue = calculateNewValue(property, depr);
    const projectedImprovement = calculateProjectedImprovement(property, newValue);
    const projectedTotal = calculateProjectedTotal(property, projectedImprovement);
    const newLandAllocation = calculateNewLandAllocation(property, projectedTotal);
    const deltaPercent = calculateDeltaPercent(property, projectedTotal);
    const currentTaxes = calculateCurrentTaxes(property);
    const projectedTaxes = calculateProjectedTaxes(projectedTotal);
    const taxDelta = calculateTaxDelta(currentTaxes, projectedTaxes);
    
    return {
      recommendedEFA,
      actualEFA,
      depr,
      newValue,
      projectedImprovement,
      projectedTotal,
      newLandAllocation,
      deltaPercent,
      currentTaxes,
      projectedTaxes,
      taxDelta,
      specialNotes: storedData.special_notes || '',
      saleComment: storedData.sale_comment || ''
    };
  };

  // Filter and sort properties
  const filteredAndSortedProperties = useMemo(() => {
    let filtered = [...properties];
    
    // Apply filters
    if (filters.typeUse !== 'all') {
      filtered = filtered.filter(p => p.asset_type_use === filters.typeUse);
    }
    if (filters.design !== 'all') {
      filtered = filtered.filter(p => p.asset_design_style === filters.design);
    }
    if (filters.vcs !== 'all') {
      filtered = filtered.filter(p => p.property_vcs === filters.vcs);
    }
    if (filters.hasSales !== 'all') {
      if (filters.hasSales === 'yes') {
        filtered = filtered.filter(p => p.sales_date);
      } else {
        filtered = filtered.filter(p => !p.sales_date);
      }
    }
    
    // Apply sorting
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue, bValue;

        // Handle computed fields
        if (sortConfig.key === 'card_sf') {
          aValue = getCardSF(a);
          bValue = getCardSF(b);
        } else if (sortConfig.key === 'asset_lot_acre') {
          // Prefer market_manual_lot_acre over asset_lot_acre
          aValue = a.market_manual_lot_acre || a.asset_lot_acre;
          bValue = b.market_manual_lot_acre || b.asset_lot_acre;
        } else if (sortConfig.key === 'asset_lot_sf') {
          // Prefer market_manual_lot_sf over asset_lot_sf
          aValue = a.market_manual_lot_sf || a.asset_lot_sf;
          bValue = b.market_manual_lot_sf || b.asset_lot_sf;
        } else if (sortConfig.key === 'check') {
          aValue = classesMatch(a);
          bValue = classesMatch(b);
        } else if (sortConfig.key === 'sales_period_code') {
          aValue = getSalesPeriodCode(a) || '';
          bValue = getSalesPeriodCode(b) || '';
        } else if (sortConfig.key === 'property_block') {
          // Numeric sort for block
          aValue = parseFloat(a.property_block) || 0;
          bValue = parseFloat(b.property_block) || 0;
        } else if (sortConfig.key === 'property_lot') {
          // Numeric sort for lot
          aValue = parseFloat(a.property_lot) || 0;
          bValue = parseFloat(b.property_lot) || 0;
        } else {
          aValue = a[sortConfig.key];
          bValue = b[sortConfig.key];
        }

        // Handle null/undefined
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        // Compare
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return filtered;
  }, [properties, filters, sortConfig]);

  // Pagination
  const paginatedProperties = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredAndSortedProperties.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredAndSortedProperties, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(filteredAndSortedProperties.length / rowsPerPage);

  // Get unique values for filters
  const uniqueTypeUses = useMemo(() => {
    const types = [...new Set(properties.map(p => p.asset_type_use).filter(Boolean))];
    return types.sort();
  }, [properties]);

  const uniqueDesigns = useMemo(() => {
    const designs = [...new Set(properties.map(p => p.asset_design_style).filter(Boolean))];
    return designs.sort();
  }, [properties]);

  const uniqueVCS = useMemo(() => {
    const vcsList = [...new Set(properties.map(p => p.property_vcs).filter(Boolean))];
    return vcsList.sort();
  }, [properties]);

  // Handle sorting
  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Handle cell edit
  const handleCellEdit = async (propertyKey, field, value) => {
    try {
      setSaving(true);
      
      // Upsert to database
      const { error } = await supabase
        .from('final_valuation_data')
        .upsert({
          job_id: jobData.id,
          property_composite_key: propertyKey,
          [field]: value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'job_id,property_composite_key'
        });

      if (error) throw error;

      // Update local state
      setFinalValuationData(prev => ({
        ...prev,
        [propertyKey]: {
          ...prev[propertyKey],
          [field]: value
        }
      }));

      setEditingCell(null);
    } catch (error) {
      console.error('Error saving field:', error);
      alert('Error saving: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  // Export to Excel
  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();
    
    // Prepare data rows
    const rows = filteredAndSortedProperties.map(property => {
      const calc = getCalculatedValues(property);
      const salesCode = getSalesPeriodCode(property);
      
      return {
        'Block': property.property_block || '',
        'Lot': property.property_lot || '',
        'Qualifier': property.property_qualifier || '',
        'Card': getMaxCardNumber(property),
        'Card SF': getCardSF(property),
        'Address': property.property_location || '',
        'Owner Name': property.owner_name || '',
        'Owner Address': property.owner_street || '',
        'Owner City State': property.owner_csz || '',
        'Owner Zip': property.owner_csz?.split(' ').pop() || '',
        'Property M4 Class': property.property_m4_class || '',
        'Property CAMA Class': property.property_cama_class || '',
        'Check': classesMatch(property) ? 'TRUE' : 'FALSE',
        'InfoBy Code': property.inspection_info_by || '',
        'VCS': property.property_vcs || '',
        'Exempt Facility': property.property_facility || '',
        'Special': calc.specialNotes,
        'Lot Frontage': property.asset_lot_frontage || '',
        'Lot Depth': property.asset_lot_depth || '',
        'Lot Size (Acre)': (property.market_manual_lot_acre || property.asset_lot_acre) ?
          parseFloat(property.market_manual_lot_acre || property.asset_lot_acre).toFixed(2) : '',
        'Lot Size (SF)': (property.market_manual_lot_sf || property.asset_lot_sf) ?
          Math.round(property.market_manual_lot_sf || property.asset_lot_sf) : '',
        'View': property.asset_view || '',
        'Location Analysis': property.location_analysis || '',
        'Type Use': property.asset_type_use || '',
        'Building Class': property.asset_building_class || '',
        'Year Built': property.asset_year_built || '',
        'Current EFA': calc.actualEFA !== null && calc.actualEFA !== undefined ? calc.actualEFA : '',
        'Test': property.asset_year_built && calc.actualEFA !== null && calc.actualEFA !== undefined ?
          (calc.actualEFA >= property.asset_year_built ? 'TRUE' : 'FALSE') : '',
        'Design': property.asset_design_style || '',
        'Bedroom Total': getBedroomTotal(property) || '',
        'Story Height': property.asset_story_height || '',
        'SFLA': property.asset_sfla || '',
        'Total SFLA': getTotalSFLA(property),
        'Exterior Net Condition': property.asset_ext_cond || '',
        'Interior Net Condition': property.asset_int_cond || '',
        'Code': salesCode || '',
        'Sale Date': property.sales_date || '',
        'Sale Book': property.sales_book || '',
        'Sale Page': property.sales_page || '',
        'Sale Price': property.sales_price || '',
        'Values Norm Time': property.values_norm_time || '',
        'Sales NU Code': property.sales_nu || '',
        'Sales Ratio': calc.projectedTotal && property.values_norm_time ? 
          (calc.projectedTotal / property.values_norm_time) : '',
        'Sale Comment': calc.saleComment,
        'Detached Items Value': property.values_det_items || '',
        'Cost New Value': property.values_repl_cost || '',
        'Old Land Allocation %': property.values_mod_total && property.values_mod_land ?
          (property.values_mod_land / property.values_mod_total) * 100 : '',
        'Current Land Value': property.values_mod_land || '',
        'Current Improvement Value': property.values_mod_improvement || '',
        'Current Total Value': property.values_mod_total || '',
        '--- NEW PROJECTED ---': '',
        'New Land Allocation %': calc.newLandAllocation || '',
        'CAMA Land Value': property.values_cama_land || '',
        'Projected Improvement': calc.projectedImprovement || '',
        'Projected Total': calc.projectedTotal || '',
        'Delta %': calc.deltaPercent || '',
        'Recommended EFA': calc.recommendedEFA || '',
        'Actual EFA': calc.actualEFA || '',
        'DEPR': calc.depr || '',
        'New Value': calc.newValue || '',
        'Current Year Taxes': calc.currentTaxes || '',
        'Projected Taxes': calc.projectedTaxes || '',
        'Tax Delta $': calc.taxDelta || ''
      };
    });

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Apply formatting
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    
    // Style header row
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!worksheet[cellAddress]) continue;
      worksheet[cellAddress].s = {
        font: { name: 'Leelawadee', sz: 10, bold: true },
        alignment: { horizontal: 'center' }
      };
    }

    // Style data rows
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!worksheet[cellAddress]) continue;
        
        worksheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10 },
          alignment: { horizontal: 'center' }
        };
      }
    }

    // Set column widths
    worksheet['!cols'] = Array(range.e.c + 1).fill({ wch: 12 });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Market Data Approach');
    
    // Save file
    XLSX.writeFile(workbook, `Market_Data_Approach_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Condensed view columns
  const condensedColumns = [
    'Block', 'Lot', 'Qualifier', 'Address', 'Card', 'Type Use', 'Building Class', 
    'Year Built', 'Current EFA', 'Sale Date', 'Sale Price', 'Values Norm Time', 
    'Sales NU', 'Current Total', 'CAMA Land', 'Projected Improvement', 
    'Projected Total', 'Recommended EFA', 'Actual EFA'
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Market Data Approach</h2>
          <p className="text-sm text-gray-600 mt-1">
            Calculate effective age and projected assessments using cost approach methodology
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'full' ? 'condensed' : 'full')}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Columns className="w-4 h-4" />
            {viewMode === 'full' ? 'Condensed View' : 'Full View'}
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="space-y-3">
          {/* Filter Dropdowns */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type/Use</label>
              <select
                value={filters.typeUse}
                onChange={(e) => setFilters(f => ({ ...f, typeUse: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Type/Use</option>
                {uniqueTypeUses.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Design/Style</label>
              <select
                value={filters.design}
                onChange={(e) => setFilters(f => ({ ...f, design: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Designs</option>
                {uniqueDesigns.map(design => (
                  <option key={design} value={design}>{design}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">VCS</label>
              <select
                value={filters.vcs}
                onChange={(e) => setFilters(f => ({ ...f, vcs: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All VCS</option>
                {uniqueVCS.map(vcs => (
                  <option key={vcs} value={vcs}>{vcs}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sales Status</label>
              <select
                value={filters.hasSales}
                onChange={(e) => setFilters(f => ({ ...f, hasSales: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="all">All Properties</option>
                <option value="yes">Has Sales Only</option>
                <option value="no">No Sales Only</option>
              </select>
            </div>
          </div>

          {/* Active Filters Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-600">Active Filters:</span>
            {filters.typeUse !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                Type: {filters.typeUse}
                <button
                  onClick={() => setFilters(f => ({ ...f, typeUse: 'all' }))}
                  className="hover:text-blue-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {filters.design !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
                Design: {filters.design}
                <button
                  onClick={() => setFilters(f => ({ ...f, design: 'all' }))}
                  className="hover:text-purple-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {filters.vcs !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                VCS: {filters.vcs}
                <button
                  onClick={() => setFilters(f => ({ ...f, vcs: 'all' }))}
                  className="hover:text-green-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {filters.hasSales !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                Sales: {filters.hasSales === 'yes' ? 'Has Sales' : 'No Sales'}
                <button
                  onClick={() => setFilters(f => ({ ...f, hasSales: 'all' }))}
                  className="hover:text-orange-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {(filters.typeUse === 'all' && filters.design === 'all' && filters.vcs === 'all' && filters.hasSales === 'all') && (
              <span className="text-xs text-gray-500 italic">No filters applied</span>
            )}
            <span className="text-xs text-gray-600 ml-auto">
              Showing {filteredAndSortedProperties.length.toLocaleString()} of {properties.length.toLocaleString()} properties
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Horizontal scroll bar at top */}
        <div
          ref={topScrollRef}
          onScroll={handleTopScroll}
          className="overflow-x-auto border-b border-gray-200"
          style={{ height: '20px', overflowY: 'hidden' }}
        >
          <div style={{ width: '5000px', height: '1px' }}></div>
        </div>

        <div
          ref={mainScrollRef}
          onScroll={handleMainScroll}
          className="overflow-x-auto overflow-y-auto"
          style={{ maxHeight: '70vh' }}
        >
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                {viewMode === 'full' ? (
                  // Full view - all 72+ columns
                  <>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_block')}>Block ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_lot')}>Lot ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_qualifier')}>Qualifier ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_addl_card')}>Card ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('card_sf')}>Card SF ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_location')}>Address ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_m4_class')}>M4 Class ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_cama_class')}>CAMA Class ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('check')}>Check ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('inspection_info_by')}>InfoBy ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_vcs')}>VCS ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_facility')}>Facility ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Special</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_lot_frontage')}>Lot Frontage ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_lot_depth')}>Lot Depth ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_lot_acre')}>Lot Acre ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_lot_sf')}>Lot SF ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_view')}>View ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Location</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_type_use')}>Type Use ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_building_class')}>Class ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_year_built')}>Year Built ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Curr EFA</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Test</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_design_style')}>Design ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Bedrooms</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_story_height')}>Story ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_sfla')}>SFLA ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Total SFLA</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_ext_cond')}>Ext Cond ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_int_cond')}>Int Cond ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_period_code')}>Code ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_date')}>Sale Date ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_book')}>Book ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_page')}>Page ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_price')}>Sale Price ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_norm_time')}>Norm Time ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_nu')}>NU Code ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Sales Ratio</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Sale Comment</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-teal-100" onClick={() => handleSort('values_det_items')}>Det Items ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-teal-100" onClick={() => handleSort('values_repl_cost')}>Repl Cost ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Old Land %</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_mod_land')}>Curr Land ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_mod_improvement')}>Curr Imp ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_mod_total')}>Curr Total ↕</th>
                    <th className="px-2 py-2 text-center font-semibold border border-gray-300 bg-gray-100">---</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">New Land %</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-teal-100" onClick={() => handleSort('values_cama_land')}>CAMA Land ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Imp</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Total</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Delta %</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Rec EFA</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-blue-50">Actual EFA</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('depr')}>DEPR ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">New Value</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Curr Taxes</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Proj Taxes</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Tax Delta</th>
                  </>
                ) : (
                  // Condensed view - 19 key columns
                  <>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_block')}>Block ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_lot')}>Lot ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_qualifier')}>Qualifier ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_location')}>Address ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('property_addl_card')}>Card ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_type_use')}>Type Use ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_building_class')}>Class ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('asset_year_built')}>Year Built ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Curr EFA</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_date')}>Sale Date ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_price')}>Sale Price ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_norm_time')}>Norm Time ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('sales_nu')}>NU ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-gray-50" onClick={() => handleSort('values_mod_total')}>Curr Total ↕</th>
                    <th className="px-2 py-2 text-left font-semibold cursor-pointer border border-gray-300 bg-teal-100" onClick={() => handleSort('values_cama_land')}>CAMA Land ↕</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Imp</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Total</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Rec EFA</th>
                    <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-blue-50">Actual EFA</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedProperties.map((property) => {
                const calc = getCalculatedValues(property);
                const salesCode = getSalesPeriodCode(property);
                const rowClass = getRowColorClass(salesCode);
                const rowStyle = getRowStyle(salesCode);

                return (
                  <tr key={property.property_composite_key} className={rowClass} style={rowStyle}>
                    {viewMode === 'full' ? (
                      // Full view rows (truncated for brevity - you'll implement all columns)
                      <>
                        <td className="px-2 py-2 border border-gray-300">{property.property_block}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_lot}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_qualifier}</td>
                        <td className="px-2 py-2 border border-gray-300">{getMaxCardNumber(property)}</td>
                        <td className="px-2 py-2 border border-gray-300">{getCardSF(property)}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_location}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_m4_class}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_cama_class}</td>
                        <td className="px-2 py-2 border border-gray-300">{classesMatch(property)}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.inspection_info_by}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_vcs}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_facility}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          <input
                            type="text"
                            value={calc.specialNotes}
                            onChange={(e) => handleCellEdit(property.property_composite_key, 'special_notes', e.target.value)}
                            className="w-full px-1 py-0.5 border border-gray-300 rounded text-sm"
                            placeholder="Notes..."
                          />
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_lot_frontage}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_lot_depth}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          {(property.market_manual_lot_acre || property.asset_lot_acre) ?
                            (property.market_manual_lot_acre || property.asset_lot_acre).toFixed(2) : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">
                          {(property.market_manual_lot_sf || property.asset_lot_sf) ?
                            Math.round(property.market_manual_lot_sf || property.asset_lot_sf).toLocaleString() : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_view}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.location_analysis}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_type_use}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_building_class}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_year_built}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          {calc.actualEFA !== null && calc.actualEFA !== undefined ? calc.actualEFA : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">
                          {property.asset_year_built && calc.actualEFA !== null && calc.actualEFA !== undefined ?
                            (calc.actualEFA >= property.asset_year_built ? 'TRUE' : 'FALSE') : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_design_style}</td>
                        <td className="px-2 py-2 border border-gray-300">{getBedroomTotal(property)}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_story_height}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_sfla?.toLocaleString()}</td>
                        <td className="px-2 py-2 border border-gray-300">{getTotalSFLA(property).toLocaleString()}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_ext_cond}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_int_cond}</td>
                        <td className="px-2 py-2 border border-gray-300 font-semibold">{salesCode}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_date || ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_book}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_page}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_price ? `$${property.sales_price.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_norm_time ? `$${property.values_norm_time.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_nu}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.projectedTotal && property.values_norm_time ? ((calc.projectedTotal / property.values_norm_time) * 100).toFixed(1) + '%' : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          <input
                            type="text"
                            value={calc.saleComment}
                            onChange={(e) => handleCellEdit(property.property_composite_key, 'sale_comment', e.target.value)}
                            className="w-full px-1 py-0.5 border border-gray-300 rounded text-sm"
                            placeholder="Comment..."
                          />
                        </td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{property.values_det_items ? `$${property.values_det_items.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{property.values_repl_cost ? `$${property.values_repl_cost.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          {property.values_mod_total && property.values_mod_land ?
                            ((property.values_mod_land / property.values_mod_total) * 100).toFixed(1) + '%' : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_mod_land ? `$${property.values_mod_land.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_mod_improvement ? `$${property.values_mod_improvement.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_mod_total ? `$${property.values_mod_total.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-gray-100 text-center">—</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{calc.newLandAllocation ? calc.newLandAllocation.toFixed(1) + '%' : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{property.values_cama_land ? `$${property.values_cama_land.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{calc.projectedImprovement ? `$${calc.projectedImprovement.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50 font-semibold">{calc.projectedTotal ? `$${calc.projectedTotal.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.deltaPercent ? calc.deltaPercent.toFixed(1) + '%' : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.recommendedEFA ? calc.recommendedEFA.toFixed(1) : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-blue-50">
                          <input
                            type="number"
                            value={calc.actualEFA ?? ''}
                            onChange={(e) => handleCellEdit(property.property_composite_key, 'actual_efa', e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-20 px-1 py-0.5 border border-gray-300 rounded text-sm text-center"
                            placeholder="EFA"
                            step="0.1"
                          />
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{calc.depr ? calc.depr.toFixed(4) : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.newValue ? `$${calc.newValue.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.currentTaxes ? `$${calc.currentTaxes.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.projectedTaxes ? `$${calc.projectedTaxes.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.taxDelta ? `$${calc.taxDelta.toLocaleString()}` : ''}</td>
                      </>
                    ) : (
                      // Condensed view rows
                      <>
                        <td className="px-2 py-2 border border-gray-300">{property.property_block}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_lot}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_qualifier}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.property_location}</td>
                        <td className="px-2 py-2 border border-gray-300">{getMaxCardNumber(property)}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_type_use}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_building_class}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.asset_year_built}</td>
                        <td className="px-2 py-2 border border-gray-300">
                          {calc.actualEFA !== null && calc.actualEFA !== undefined ? calc.actualEFA : ''}
                        </td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_date || ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_price ? `$${property.sales_price.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_norm_time ? `$${property.values_norm_time.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.sales_nu}</td>
                        <td className="px-2 py-2 border border-gray-300">{property.values_mod_total ? `$${property.values_mod_total.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{property.values_cama_land ? `$${property.values_cama_land.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50">{calc.projectedImprovement ? `$${calc.projectedImprovement.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-teal-50 font-semibold">{calc.projectedTotal ? `$${calc.projectedTotal.toLocaleString()}` : ''}</td>
                        <td className="px-2 py-2 border border-gray-300">{calc.recommendedEFA ? calc.recommendedEFA.toFixed(1) : ''}</td>
                        <td className="px-2 py-2 border border-gray-300 bg-blue-50">
                          <input
                            type="number"
                            value={calc.actualEFA ?? ''}
                            onChange={(e) => handleCellEdit(property.property_composite_key, 'actual_efa', e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-20 px-1 py-0.5 border border-gray-300 rounded text-sm text-center"
                            placeholder="EFA"
                            step="0.1"
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Horizontal scroll bar at bottom */}
        <div
          ref={bottomScrollRef}
          onScroll={handleBottomScroll}
          className="overflow-x-auto border-t border-gray-200"
          style={{ height: '20px', overflowY: 'hidden' }}
        >
          <div style={{ width: '5000px', height: '1px' }}></div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
        <div className="text-sm text-gray-600">
          Page {currentPage} of {totalPages} ({filteredAndSortedProperties.length.toLocaleString()} properties)
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-gray-600">
            {((currentPage - 1) * rowsPerPage + 1).toLocaleString()} - {Math.min(currentPage * rowsPerPage, filteredAndSortedProperties.length).toLocaleString()}
          </span>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tax Rate Warning */}
      {!taxRates && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          <div>
            <h4 className="font-semibold text-yellow-900">Tax Rates Not Configured</h4>
            <p className="text-sm text-yellow-800 mt-1">
              Current and projected tax calculations require tax rates. Please configure them in the Tax Rate Calculator tab.
            </p>
          </div>
        </div>
      )}

      {/* Saving indicator */}
      {isSaving && (
        <div className="fixed bottom-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <Save className="w-4 h-4 animate-pulse" />
          Saving...
        </div>
      )}
    </div>
  );
};

export default MarketDataTab;
