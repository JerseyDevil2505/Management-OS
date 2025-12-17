import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Download, AlertCircle, Save } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const MarketDataTab = ({ jobData, properties, marketLandData, hpiData, onUpdateJobCache }) => {
  // State management
  const [finalValuationData, setFinalValuationData] = useState({});
  const [taxRates, setTaxRates] = useState(null);
  const [isSaving, setSaving] = useState(false);
  const PREVIEW_LIMIT = 500; // Only show first 500 properties

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

  // Calculate year prior to due year (for formulas)
  // If end_date = 2026, yearPriorToDueYear = 2025
  const yearPriorToDueYear = useMemo(() => {
    if (!jobData?.end_date) return new Date().getFullYear();
    const endYear = new Date(jobData.end_date).getFullYear();
    return endYear - 1;
  }, [jobData?.end_date]);

  // Get vendor type
  const vendorType = jobData?.vendor_type || 'BRT';

  // Helper: Get bedroom count from property
  const getBedroomTotal = (property) => {
    // TODO: Find bedroom field from OverallAnalysisTab implementation
    return property.bedroom_total || null;
  };

  // Helper: Get max card number
  const getMaxCardNumber = (property) => {
    const card = property.property_addl_card;
    if (!card) return 1;
    const match = card.match(/\d+/);
    return match ? parseInt(match[0]) : 1;
  };

  // Helper: Calculate Card SF (additional cards only, excluding main)
  const getCardSF = (property) => {
    const card = property.property_addl_card;
    if (!card) return 0;

    if (vendorType === 'BRT') {
      const cardNum = parseInt(card.match(/\d+/)?.[0] || '1');
      if (cardNum > 1) {
        return property.asset_sfla || 0;
      }
    } else {
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

  // Helper: Check if classes match
  const classesMatch = (property) => {
    return property.property_m4_class === property.property_cama_class ? 'TRUE' : 'FALSE';
  };

  // Helper: Get sales period code
  const getSalesPeriodCode = (property) => {
    if (!property.sales_date) return null;
    
    const saleDate = new Date(property.sales_date);
    const endYear = new Date(jobData.end_date).getFullYear();
    const yearOfValue = endYear - 1;
    
    const cspStart = new Date(yearOfValue - 1, 9, 1);
    const cspEnd = new Date(yearOfValue, 11, 31);
    const pspStart = new Date(yearOfValue - 2, 9, 1);
    const pspEnd = new Date(yearOfValue - 1, 8, 30);
    const hspStart = new Date(yearOfValue - 3, 9, 1);
    const hspEnd = new Date(yearOfValue - 2, 8, 30);
    
    if (saleDate >= cspStart && saleDate <= cspEnd) return 'CSP';
    if (saleDate >= pspStart && saleDate <= pspEnd) return 'PSP';
    if (saleDate >= hspStart && saleDate <= hspEnd) return 'HSP';
    return null;
  };

  // Helper: Get row color class based on sales period
  const getRowColorClass = (salesCode) => {
    if (salesCode === 'CSP') return 'bg-green-50 hover:bg-green-100';
    if (salesCode === 'PSP') return 'bg-blue-50 hover:bg-blue-100';
    return 'hover:bg-gray-50';
  };

  const getRowStyle = (salesCode) => {
    if (salesCode === 'HSP') {
      return { backgroundColor: '#fed7aa' };
    }
    return {};
  };

  // Helper: Check if property qualifies for EFA calculation
  const propertyQualifiesForEFA = (property) => {
    const typeUse = property.asset_type_use;
    const buildingClass = property.asset_building_class;

    if (!typeUse || typeUse.trim() === '') return false;
    if (!buildingClass || parseInt(buildingClass) <= 10) return false;

    return true;
  };

  // Helper: Get current EFA from database (no more raw file parsing!)
  const getCurrentEFA = (property) => {
    // Read directly from database field
    return property.asset_effective_age || '';
  };

  // FORMULAS

  // Formula: Recommended EFA
  const calculateRecommendedEFA = (property) => {
    if (!property.values_norm_time) return null;

    const normTime = property.values_norm_time;
    const camaLand = property.values_cama_land || 0;
    const detItems = property.values_det_items || 0;
    const replCost = property.values_repl_cost || 0;

    if (replCost === 0) return null;

    const formula = yearPriorToDueYear - ((1 - ((normTime - camaLand - detItems) / replCost)) * 100);
    return Math.round(formula);
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
    return Math.round(newValue / 100) * 100;
  };

  // Formula: Projected Improvement
  const calculateProjectedImprovement = (property, newValue) => {
    // Only use formula if newValue > 0, otherwise use cama_improvement from data file
    if (newValue !== null && newValue > 0) {
      const camaLand = property.values_cama_land || 0;
      return newValue - camaLand;
    }

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
    const isTaxable = property.property_facility !== 'EXEMPT';
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
    const qualifiesForEFA = propertyQualifiesForEFA(property);

    let actualEFA = null;
    if (qualifiesForEFA) {
      if (storedData.actual_efa !== null && storedData.actual_efa !== undefined) {
        actualEFA = storedData.actual_efa;
      } else {
        actualEFA = getCurrentEFA(property);
        if (typeof actualEFA === 'string' && actualEFA !== '') {
          actualEFA = parseFloat(actualEFA);
        }
        if (actualEFA === '' || isNaN(actualEFA)) {
          actualEFA = null;
        }
      }
    }

    const recommendedEFA = calculateRecommendedEFA(property);
    const depr = qualifiesForEFA && actualEFA !== null && actualEFA !== undefined ? calculateDEPR(actualEFA) : null;
    const newValue = qualifiesForEFA ? calculateNewValue(property, depr) : null;

    let projectedImprovement;
    if (qualifiesForEFA) {
      projectedImprovement = calculateProjectedImprovement(property, newValue);
    } else {
      projectedImprovement = property.values_cama_improvement || 0;
    }

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
      qualifiesForEFA,
      specialNotes: storedData.special_notes || '',
      saleComment: storedData.sale_comment || ''
    };
  };

  // Preview: First 500 properties only
  const previewProperties = useMemo(() => {
    return properties.slice(0, PREVIEW_LIMIT);
  }, [properties]);

  // Calculate values only for preview properties
  const previewCalculatedValues = useMemo(() => {
    const cache = {};
    previewProperties.forEach(property => {
      cache[property.property_composite_key] = getCalculatedValues(property);
    });
    return cache;
  }, [previewProperties, finalValuationData, yearPriorToDueYear, vendorType, taxRates]);

  // Calculate summary by class for all properties
  const classSummary = useMemo(() => {
    const summary = {
      '1': { count: 0, total: 0 },
      '2': { count: 0, total: 0 },
      '3A': { count: 0, total: 0 },
      '3B': { count: 0, total: 0 },
      '4A': { count: 0, total: 0 },
      '4B': { count: 0, total: 0 },
      '4C': { count: 0, total: 0 },
      '6A': { count: 0, total: 0 },
      '6B': { count: 0, total: 0 }
    };

    properties.forEach(property => {
      const isTaxable = property.property_facility !== 'EXEMPT';
      if (!isTaxable) return;

      // Use CAMA total from data file
      const camaTotal = property.values_cama_total || 0;
      const propertyClass = property.property_cama_class || '';

      if (summary[propertyClass]) {
        summary[propertyClass].count++;
        summary[propertyClass].total += camaTotal;
      }
    });

    // Calculate Class 4* aggregate (4A + 4B + 4C)
    const class4Count = summary['4A'].count + summary['4B'].count + summary['4C'].count;
    const class4Total = summary['4A'].total + summary['4B'].total + summary['4C'].total;

    // Calculate Class 6* aggregate (6A + 6B)
    const class6Count = summary['6A'].count + summary['6B'].count;
    const class6Total = summary['6A'].total + summary['6B'].total;

    // Calculate grand totals
    const totalCount = Object.values(summary).reduce((sum, item) => sum + item.count, 0);
    const totalTotal = Object.values(summary).reduce((sum, item) => sum + item.total, 0);

    return {
      ...summary,
      class4Count,
      class4Total,
      class6Count,
      class6Total,
      totalCount,
      totalTotal
    };
  }, [properties]);

  // Handle cell edit
  const handleCellEdit = async (propertyKey, field, value) => {
    try {
      setSaving(true);
      
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

      setFinalValuationData(prev => ({
        ...prev,
        [propertyKey]: {
          ...prev[propertyKey],
          [field]: value
        }
      }));
    } catch (error) {
      console.error('Error saving field:', error);
      alert('Error saving: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  // Export to Excel with formatting
  const exportToExcel = () => {
    const workbook = XLSX.utils.book_new();

    // Export ALL properties (not just preview)
    const rows = properties.map((property, idx) => {
      const calc = getCalculatedValues(property);
      const salesCode = getSalesPeriodCode(property);
      const rowNum = idx + 2; // +2 because Excel is 1-indexed and row 1 is header
      const cardSF = getCardSF(property);
      const mainSFLA = property.asset_sfla || 0;

      // Column mapping for formulas:
      // K=Property M4 Class, L=Property CAMA Class, M=Check
      // Z=Year Built, AA=Current EFA, AB=Test
      // AO=Values Norm Time, AS=Detached Items, AT=Cost New, BA=CAMA Land
      // BE=Recommended EFA, BF=Actual EFA, BG=DEPR, BH=New Value, BB=Projected Imp

      return {
        'Block': property.property_block || '',
        'Lot': property.property_lot || '',
        'Qualifier': property.property_qualifier || '',
        'Card': getMaxCardNumber(property),
        'Card SF': cardSF,
        'Address': property.property_location || '',
        'Owner Name': property.owner_name || '',
        'Owner Address': property.owner_street || '',
        'Owner City State': property.owner_csz || '',
        'Owner Zip': property.owner_csz?.split(' ').pop() || '',
        'Property M4 Class': property.property_m4_class || '',
        'Property CAMA Class': property.property_cama_class || '',
        'Check': { f: `IF(K${rowNum}=L${rowNum},"TRUE","FALSE")` },
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
        'Current EFA': getCurrentEFA(property),
        'Test': { f: `IF(AND(Z${rowNum}<>"",BF${rowNum}<>""),IF(BF${rowNum}>=Z${rowNum},"TRUE","FALSE"),"")` },
        'Design': property.asset_design_style || '',
        'Bedroom Total': getBedroomTotal(property) || '',
        'Story Height': property.asset_story_height || '',
        'SFLA': mainSFLA,
        'Total SFLA': { f: `E${rowNum}+AF${rowNum}` }, // Formula: Card SF + SFLA
        'Exterior Net Condition': property.asset_ext_cond || '',
        'Interior Net Condition': property.asset_int_cond || '',
        'Code': salesCode || '',
        'Sale Date': property.sales_date ? new Date(property.sales_date) : '',
        'Sale Book': property.sales_book || '',
        'Sale Page': property.sales_page || '',
        'Sale Price': property.sales_price || '',
        'Values Norm Time': property.values_norm_time || '',
        'Sales NU Code': property.sales_nu || '',
        'Sales Ratio': calc.projectedTotal && property.values_norm_time ?
          Math.round((calc.projectedTotal / property.values_norm_time) * 100) : '',
        'Sale Comment': calc.saleComment,
        'Detached Items Value': property.values_det_items || 0,
        'Cost New Value': property.values_repl_cost || 0,
        'Current Land Allocation %': property.values_mod_total && property.values_mod_land ?
          { f: `AV${rowNum}/AX${rowNum}` } : '',
        'Current Land Value': property.values_mod_land || 0,
        'Current Improvement Value': property.values_mod_improvement || 0,
        'Current Total Value': property.values_mod_total || 0,
        '--- NEW PROJECTED ---': '',
        'Projected Land Allocation %': calc.newLandAllocation && calc.projectedTotal ?
          { f: `BA${rowNum}/BC${rowNum}` } : '',
        'CAMA Land Value': property.values_cama_land || 0,
        'Projected Improvement': calc.qualifiesForEFA && calc.newValue !== null && calc.newValue > 0 ?
          { f: `BH${rowNum}-BA${rowNum}` } : (property.values_cama_improvement || 0),
        'Projected Total': { f: `BA${rowNum}+BB${rowNum}` },
        'Delta %': calc.deltaPercent ? Math.round(calc.deltaPercent) : '',
        'Recommended EFA': calc.recommendedEFA !== null && calc.recommendedEFA !== undefined ?
          { f: `ROUND(${yearPriorToDueYear}-((1-((AO${rowNum}-BA${rowNum}-AS${rowNum})/AT${rowNum}))*100),0)` } : '',
        'Actual EFA': calc.actualEFA || '',
        'DEPR': calc.qualifiesForEFA && calc.actualEFA !== null && calc.actualEFA !== undefined ?
          { f: `MIN(1,1-((${yearPriorToDueYear}-BF${rowNum})/100))` } : '',
        'New Value': calc.qualifiesForEFA && calc.actualEFA !== null && calc.actualEFA !== undefined ?
          { f: `ROUND((AT${rowNum}*BG${rowNum})+AS${rowNum}+BA${rowNum},-2)` } : 0,
        'Current Year Taxes': calc.currentTaxes || 0,
        'Projected Taxes': calc.projectedTaxes || 0,
        'Tax Delta $': calc.taxDelta || 0
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    // Column name to index mapping
    const headers = Object.keys(rows[0]);
    const getColIndex = (name) => headers.indexOf(name);

    // Define border style for grid lines
    const borderStyle = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } }
    };

    // Style header row (bold, centered, light gray background, borders)
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!worksheet[cellAddress]) continue;
      worksheet[cellAddress].s = {
        font: { name: 'Leelawadee', sz: 10, bold: true, color: { rgb: '000000' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { fgColor: { rgb: 'D3D3D3' } },
        border: borderStyle
      };
    }

    // Style data rows with colors based on sales code
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const property = properties[R - 1];
      const salesCode = getSalesPeriodCode(property);

      // Determine row background color
      let fillColor = 'FFFFFF'; // Default white
      if (salesCode === 'CSP') {
        fillColor = 'D4EDDA'; // Light green
      } else if (salesCode === 'PSP') {
        fillColor = 'D1ECF1'; // Light blue
      } else if (salesCode === 'HSP') {
        fillColor = 'FED7AA'; // Light orange
      }

      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!worksheet[cellAddress]) continue;

        const colName = headers[C];
        let numFmt = undefined;

        // Apply number formatting based on column
        if (['Lot Size (SF)', 'SFLA', 'Total SFLA'].includes(colName)) {
          numFmt = '#,##0'; // Number with commas
        } else if (['Sale Price', 'Values Norm Time'].includes(colName)) {
          numFmt = '$#,##0'; // Currency
        } else if (['Detached Items Value', 'Cost New Value', 'Current Land Value', 'Current Improvement Value',
                    'Current Total Value', 'CAMA Land Value', 'Projected Improvement', 'Projected Total', 'New Value'].includes(colName)) {
          numFmt = '$#,##0'; // Currency, no decimals
        } else if (['Current Year Taxes', 'Projected Taxes', 'Tax Delta $'].includes(colName)) {
          numFmt = '$#,##0.00'; // Currency with two decimals
        } else if (['Current Land Allocation %', 'Projected Land Allocation %'].includes(colName)) {
          numFmt = '0%'; // Percentage, no decimals
        } else if (colName === 'Sale Date') {
          numFmt = 'mm/dd/yyyy'; // Date format
        }

        worksheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10 },
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: { fgColor: { rgb: fillColor } },
          border: borderStyle,
          numFmt: numFmt
        };
      }
    }

    // Set column widths
    worksheet['!cols'] = Array(range.e.c + 1).fill({ wch: 12 });

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Market Data Approach');
    XLSX.writeFile(workbook, `Final_Roster_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Market Data Approach - Preview</h2>
          <p className="text-sm text-gray-600 mt-1">
            Preview of first {PREVIEW_LIMIT} properties. Export to Excel for full dataset and EFA input workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Build Final Roster
          </button>
        </div>
      </div>

      {/* Summary Section */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Projected Net Valuation (Taxable) - CAMA Total</h3>
        <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Class</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Description</th>
                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700">Count</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 1</td>
                <td className="px-4 py-3 text-sm text-gray-700">Vacant Land</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['1'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['1'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 2</td>
                <td className="px-4 py-3 text-sm text-gray-700">Residential</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['2'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['2'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 3A</td>
                <td className="px-4 py-3 text-sm text-gray-700">Farmhouse</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['3A'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['3A'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 3B</td>
                <td className="px-4 py-3 text-sm text-gray-700">Qualified Farmland</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['3B'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['3B'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 4A</td>
                <td className="px-4 py-3 text-sm text-gray-700">Commercial</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['4A'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['4A'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 4B</td>
                <td className="px-4 py-3 text-sm text-gray-700">Industrial</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['4B'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['4B'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 4C</td>
                <td className="px-4 py-3 text-sm text-gray-700">Apartment</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['4C'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['4C'].total.toLocaleString()}</td>
              </tr>
              <tr className="bg-orange-50 hover:bg-orange-100 border-t-2 border-orange-300">
                <td className="px-4 py-3 text-sm font-bold text-orange-700">Class 4*</td>
                <td className="px-4 py-3 text-sm font-semibold text-orange-700">Aggregate Total</td>
                <td className="px-3 py-3 text-sm text-right font-bold text-orange-700">{classSummary.class4Count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-orange-700">${classSummary.class4Total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 6A</td>
                <td className="px-4 py-3 text-sm text-gray-700">Personal Property</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['6A'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['6A'].total.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">Class 6B</td>
                <td className="px-4 py-3 text-sm text-gray-700">Machinery, Apparatus, Petroleum Factor</td>
                <td className="px-3 py-3 text-sm text-right font-semibold text-gray-900">{classSummary['6B'].count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-blue-600">${classSummary['6B'].total.toLocaleString()}</td>
              </tr>
              <tr className="bg-purple-50 hover:bg-purple-100 border-t-2 border-purple-300">
                <td className="px-4 py-3 text-sm font-bold text-purple-700">Class 6*</td>
                <td className="px-4 py-3 text-sm font-semibold text-purple-700">Aggregate Total</td>
                <td className="px-3 py-3 text-sm text-right font-bold text-purple-700">{classSummary.class6Count.toLocaleString()}</td>
                <td className="px-4 py-3 text-base text-right font-bold text-purple-700">${classSummary.class6Total.toLocaleString()}</td>
              </tr>
              <tr className="bg-blue-600 text-white border-t-4 border-blue-700">
                <td className="px-4 py-4 text-sm font-bold" colSpan="2"></td>
                <td className="px-3 py-4 text-right">
                  <div className="text-xs font-semibold mb-1">Total Lines</div>
                  <div className="text-base font-bold">{classSummary.totalCount.toLocaleString()}</div>
                </td>
                <td className="px-4 py-4 text-right">
                  <div className="text-xs font-semibold mb-1">Net Valuation Taxable</div>
                  <div className="text-xl font-bold">${classSummary.totalTotal.toLocaleString()}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h4 className="font-semibold text-blue-900">Preview Mode</h4>
            <p className="text-sm text-blue-800 mt-1">
              Showing {previewProperties.length.toLocaleString()} of {properties.length.toLocaleString()} properties.
              Export to Excel for the complete dataset and EFA input workflow.
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Top scroll bar */}
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
          className="overflow-y-auto"
          style={{ maxHeight: '70vh', overflowX: 'hidden' }}
        >
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Block</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Lot</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Qualifier</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Card</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Card SF</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Address</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">M4 Class</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">CAMA Class</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Check</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">InfoBy</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">VCS</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Facility</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Special</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Type Use</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Class</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Year Built</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Curr EFA</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Design</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">SFLA</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Sale Date</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Sale Price</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">CAMA Land</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Imp</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-teal-100">Proj Total</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-gray-50">Rec EFA</th>
                <th className="px-2 py-2 text-left font-semibold border border-gray-300 bg-blue-50">Actual EFA</th>
              </tr>
            </thead>
            <tbody>
              {previewProperties.map((property) => {
                const calc = previewCalculatedValues[property.property_composite_key];
                const salesCode = getSalesPeriodCode(property);
                const rowClass = getRowColorClass(salesCode);
                const rowStyle = getRowStyle(salesCode);

                return (
                  <tr key={property.property_composite_key} className={rowClass} style={rowStyle}>
                    <td className="px-2 py-2 border border-gray-300">{property.property_block}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.property_lot}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.property_qualifier}</td>
                    <td className="px-2 py-2 border border-gray-300">{getMaxCardNumber(property)}</td>
                    <td className="px-2 py-2 border border-gray-300">{getCardSF(property)}</td>
                    <td className="px-2 py-2 border border-gray-300 whitespace-nowrap">{property.property_location}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.property_m4_class}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.property_cama_class}</td>
                    <td className="px-2 py-2 border border-gray-300">{classesMatch(property)}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.inspection_info_by}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.property_vcs}</td>
                    <td className="px-2 py-2 border border-gray-300 whitespace-nowrap">{property.property_facility}</td>
                    <td className="px-2 py-2 border border-gray-300">
                      <input
                        type="text"
                        value={calc.specialNotes}
                        onChange={(e) => handleCellEdit(property.property_composite_key, 'special_notes', e.target.value)}
                        className="w-full px-1 py-0.5 border border-gray-300 rounded text-sm"
                        placeholder="Notes..."
                      />
                    </td>
                    <td className="px-2 py-2 border border-gray-300">{property.asset_type_use}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.asset_building_class}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.asset_year_built}</td>
                    <td className="px-2 py-2 border border-gray-300">{getCurrentEFA(property)}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.asset_design_style}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.asset_sfla?.toLocaleString()}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.sales_date || ''}</td>
                    <td className="px-2 py-2 border border-gray-300">{property.sales_price ? `$${property.sales_price.toLocaleString()}` : ''}</td>
                    <td className="px-2 py-2 border border-gray-300 bg-teal-50">${(property.values_cama_land || 0).toLocaleString()}</td>
                    <td className="px-2 py-2 border border-gray-300 bg-teal-50">${(calc.projectedImprovement || 0).toLocaleString()}</td>
                    <td className="px-2 py-2 border border-gray-300 bg-teal-50 font-semibold">${(calc.projectedTotal || 0).toLocaleString()}</td>
                    <td className="px-2 py-2 border border-gray-300">{calc.recommendedEFA || ''}</td>
                    <td className="px-2 py-2 border border-gray-300 bg-blue-50">
                      {calc.qualifiesForEFA ? (
                        <input
                          key={`${property.property_composite_key}-efa`}
                          type="number"
                          defaultValue={calc.actualEFA ?? ''}
                          onBlur={(e) => handleCellEdit(property.property_composite_key, 'actual_efa', e.target.value ? parseFloat(e.target.value) : null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleCellEdit(property.property_composite_key, 'actual_efa', e.target.value ? parseFloat(e.target.value) : null);
                              e.target.blur();
                            }
                          }}
                          className="w-20 px-1 py-0.5 border border-gray-300 rounded text-sm text-center"
                          placeholder="EFA"
                          step="0.1"
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">N/A</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom scroll bar */}
        <div
          ref={bottomScrollRef}
          onScroll={handleBottomScroll}
          className="overflow-x-auto border-t border-gray-200"
          style={{ height: '20px', overflowY: 'hidden' }}
        >
          <div style={{ width: '5000px', height: '1px' }}></div>
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
