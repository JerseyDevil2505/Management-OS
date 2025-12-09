import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import { 
  Download, 
  Save, 
  Upload, 
  Filter, 
  ChevronDown, 
  ChevronRight,
  Eye,
  EyeOff,
  Check,
  X,
  RefreshCw
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

// Helper functions
function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  }).format(value);
}

function formatNumber(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return `${value.toFixed(1)}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US');
}

const SalesReviewTab = ({ 
  jobData = {}, 
  properties = [], 
  marketLandData = {},
  hpiData = [],
  onUpdateJobCache = () => {} 
}) => {
  const vendorType = jobData?.vendor_type || jobData?.vendor_source || 'BRT';
  const parsedCodeDefinitions = useMemo(() => jobData?.parsed_code_definitions || {}, [jobData?.parsed_code_definitions]);

  // ==================== PERIOD CLASSIFICATION LOGIC ====================
  
  const getPeriodClassification = useCallback((saleDate, endDate) => {
    if (!saleDate || !endDate) return null;
    
    const sale = new Date(saleDate);
    const taxYear = new Date(endDate).getFullYear();
    const yearOfValue = taxYear - 1;

    // CSP: 10/1/prior-prior year → 12/31/prior year
    const cspStart = new Date(yearOfValue - 1, 9, 1); // Oct 1
    const cspEnd = new Date(yearOfValue, 11, 31);     // Dec 31

    // PSP: 10/1/two years prior → 9/30/one year prior
    const pspStart = new Date(yearOfValue - 2, 9, 1);  // Oct 1
    const pspEnd = new Date(yearOfValue - 1, 8, 30);   // Sep 30

    // HSP: 10/1/three years prior → 9/30/two years prior
    const hspStart = new Date(yearOfValue - 3, 9, 1);  // Oct 1
    const hspEnd = new Date(yearOfValue - 2, 8, 30);   // Sep 30

    if (sale >= cspStart && sale <= cspEnd) return 'CSP';
    if (sale >= pspStart && sale <= pspEnd) return 'PSP';
    if (sale >= hspStart && sale <= hspEnd) return 'HSP';
    return ''; // Blank instead of 'OTHER'
  }, []);

  // ==================== STATE MANAGEMENT ====================
  
  const [showAllProperties, setShowAllProperties] = useState(false);
  const [showCodesNotMeanings, setShowCodesNotMeanings] = useState(true); // Default to codes
  const [fontSize, setFontSize] = useState(12); // Adjustable font size
  const [sortConfig, setSortConfig] = useState({ key: 'sales_date', direction: 'desc' });
  
  // Filters
  const [dateRange, setDateRange] = useState(() => {
    // Default to CSP period
    if (jobData?.end_date) {
      const taxYear = new Date(jobData.end_date).getFullYear();
      const yearOfValue = taxYear - 1;
      return {
        start: new Date(yearOfValue - 1, 9, 1).toISOString().split('T')[0],
        end: new Date(yearOfValue, 11, 31).toISOString().split('T')[0]
      };
    }
    return { start: '', end: '' };
  });
  
  const [salesNuFilter, setSalesNuFilter] = useState(['', '0', '00', '7', '07', '32']);
  const [vcsFilter, setVcsFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [designFilter, setDesignFilter] = useState([]);
  const [periodFilter, setPeriodFilter] = useState(['CSP', 'PSP', 'HSP']); // Default to all three periods
  
  // Expandable sections
  const [expandedSections, setExpandedSections] = useState({
    vcs: false,
    style: false,
    typeUse: false,
    view: false
  });

  // Settings name for save/load
  const [settingsName, setSettingsName] = useState('');
  const [savedSettings, setSavedSettings] = useState([]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Normalize modal state
  const [showNormalizeModal, setShowNormalizeModal] = useState(false);
  const [normalizeProperty, setNormalizeProperty] = useState(null);
  const [normalizeValue, setNormalizeValue] = useState('');

  // Load saved settings list on mount
  useEffect(() => {
    if (!jobData?.id) return;
    const saved = localStorage.getItem(`sales-review-saved-settings-${jobData.id}`);
    if (saved) {
      try {
        setSavedSettings(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved settings:', e);
      }
    }
  }, [jobData?.id]);

  // ==================== COMPUTED DATA ====================
  
  const enrichedProperties = useMemo(() => {
    return properties.map(prop => {
      // Period classification
      const periodCode = getPeriodClassification(prop.sales_date, jobData?.end_date);
      
      // Package detection
      const packageAnalysis = interpretCodes.getPackageSaleData(properties, prop);
      const isPackage = packageAnalysis && (packageAnalysis.is_additional_card || packageAnalysis.is_multi_property_package);
      
      // Calculated fields
      const pricePerSF = prop.sales_price && prop.asset_sfla && prop.asset_sfla > 0
        ? prop.sales_price / prop.asset_sfla
        : null;
      
      const normPricePerSF = prop.values_norm_time && prop.asset_sfla && prop.asset_sfla > 0
        ? prop.values_norm_time / prop.asset_sfla
        : null;
      
      const salesRatio = prop.values_norm_time && prop.values_norm_time > 0
        ? (prop.values_mod_total / prop.values_norm_time) * 100
        : null;

      // Code interpretations
      const typeUseName = interpretCodes.getTypeName?.(prop, parsedCodeDefinitions, vendorType);
      const designName = interpretCodes.getDesignName?.(prop, parsedCodeDefinitions, vendorType);
      const exteriorCondName = interpretCodes.getExteriorConditionName?.(prop, parsedCodeDefinitions, vendorType);
      const interiorCondName = interpretCodes.getInteriorConditionName?.(prop, parsedCodeDefinitions, vendorType);

      return {
        ...prop,
        periodCode,
        isPackage,
        pricePerSF,
        normPricePerSF,
        salesRatio,
        typeUseName,
        designName,
        exteriorCondName,
        interiorCondName
      };
    });
  }, [properties, jobData?.end_date, parsedCodeDefinitions, vendorType, getPeriodClassification]);

  // Filtered properties
  const filteredProperties = useMemo(() => {
    let filtered = enrichedProperties;

    // Default filter: Show only properties with sales data
    if (!showAllProperties) {
      filtered = filtered.filter(p => 
        p.sales_date !== null && 
        p.sales_date !== undefined &&
        p.values_norm_time !== null &&
        p.values_norm_time !== undefined &&
        p.values_norm_time > 0
      );
    }

    // Date range filter
    if (dateRange.start && dateRange.end) {
      filtered = filtered.filter(p => {
        if (!p.sales_date) return false;
        const saleDate = new Date(p.sales_date);
        return saleDate >= new Date(dateRange.start) && saleDate <= new Date(dateRange.end);
      });
    }

    // Sales NU filter
    if (salesNuFilter.length > 0 && !showAllProperties) {
      filtered = filtered.filter(p => {
        const nu = (p.sales_nu || '').toString().trim();
        return salesNuFilter.includes(nu) || salesNuFilter.includes('');
      });
    }

    // VCS filter
    if (vcsFilter.length > 0) {
      filtered = filtered.filter(p => vcsFilter.includes(p.property_vcs));
    }

    // Type filter
    if (typeFilter.length > 0) {
      filtered = filtered.filter(p => typeFilter.includes(p.asset_type_use));
    }

    // Design filter
    if (designFilter.length > 0) {
      filtered = filtered.filter(p => designFilter.includes(p.asset_design_style));
    }

    // Period filter
    if (periodFilter.length > 0) {
      filtered = filtered.filter(p => periodFilter.includes(p.periodCode));
    }

    return filtered;
  }, [enrichedProperties, showAllProperties, dateRange, salesNuFilter, vcsFilter, typeFilter, designFilter, periodFilter]);

  // Sorted properties
  const sortedProperties = useMemo(() => {
    if (!sortConfig.key) return filteredProperties;

    return [...filteredProperties].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else {
        comparison = aVal - bVal;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredProperties, sortConfig]);

  // ==================== ANALYTICS CALCULATIONS ====================
  
  const vcsAnalytics = useMemo(() => {
    const groups = {};

    // Group properties by VCS and collect sales ratios
    filteredProperties.forEach(prop => {
      const vcs = prop.property_vcs || 'Unknown';
      if (!groups[vcs]) {
        groups[vcs] = {
          count: 0,
          totalPrice: 0,
          totalNormPrice: 0,
          sflaSum: 0,
          ageSum: 0,
          yearBuiltCount: 0,
          assessedSum: 0,
          salesRatioSum: 0,
          salesRatioCount: 0,
          salesRatios: [] // For COD and PRD calculations
        };
      }

      groups[vcs].count++;
      if (prop.sales_price) groups[vcs].totalPrice += prop.sales_price;
      if (prop.values_norm_time) groups[vcs].totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) groups[vcs].sflaSum += prop.asset_sfla;
      if (prop.asset_year_built) {
        const currentYear = new Date().getFullYear();
        groups[vcs].ageSum += currentYear - prop.asset_year_built;
        groups[vcs].yearBuiltCount++;
      }
      if (prop.values_mod_total) groups[vcs].assessedSum += prop.values_mod_total;
      if (prop.salesRatio !== null && prop.salesRatio !== undefined) {
        groups[vcs].salesRatioSum += prop.salesRatio;
        groups[vcs].salesRatioCount++;
        groups[vcs].salesRatios.push(prop.salesRatio);
      }
    });

    return Object.entries(groups).map(([vcs, data]) => {
      const avgSalesRatio = data.salesRatioCount > 0 ? data.salesRatioSum / data.salesRatioCount : 0;

      // Calculate COD (Coefficient of Deviation)
      let cod = 0;
      if (data.salesRatios.length > 0 && avgSalesRatio > 0) {
        const absoluteDeviations = data.salesRatios.map(ratio => Math.abs(ratio - avgSalesRatio));
        const avgAbsoluteDeviation = absoluteDeviations.reduce((a, b) => a + b, 0) / data.salesRatios.length;
        cod = (avgAbsoluteDeviation / avgSalesRatio) * 100;
      }

      // Calculate PRD (Price-Related Differential)
      let prd = 0;
      if (data.salesRatios.length > 0 && data.totalNormPrice > 0 && data.assessedSum > 0) {
        const meanRatio = avgSalesRatio;
        const weightedMeanRatio = (data.assessedSum / data.totalNormPrice) * 100;
        prd = weightedMeanRatio > 0 ? meanRatio / weightedMeanRatio : 0;
      }

      return {
        vcs,
        count: data.count,
        avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
        avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
        avgSFLA: data.sflaSum > 0 ? data.sflaSum / data.count : 0,
        avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0,
        avgAge: data.yearBuiltCount > 0 ? data.ageSum / data.yearBuiltCount : 0,
        avgAssessed: data.count > 0 ? data.assessedSum / data.count : 0,
        avgSalesRatio,
        cod,
        prd
      };
    }).sort((a, b) => a.vcs.localeCompare(b.vcs));
  }, [filteredProperties]);

  const styleAnalytics = useMemo(() => {
    const groups = {};
    
    filteredProperties.forEach(prop => {
      const style = prop.asset_design_style || 'Unknown';
      if (!groups[style]) {
        groups[style] = {
          count: 0,
          totalPrice: 0,
          totalNormPrice: 0,
          sflaSum: 0
        };
      }
      
      groups[style].count++;
      if (prop.sales_price) groups[style].totalPrice += prop.sales_price;
      if (prop.values_norm_time) groups[style].totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) groups[style].sflaSum += prop.asset_sfla;
    });

    return Object.entries(groups).map(([style, data]) => ({
      style,
      styleName: showCodesNotMeanings ? style : (interpretCodes.getDesignName?.({ asset_design_style: style }, parsedCodeDefinitions, vendorType) || style),
      count: data.count,
      avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
      avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
      avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0
    })).sort((a, b) => b.count - a.count);
  }, [filteredProperties, showCodesNotMeanings, parsedCodeDefinitions, vendorType]);

  const typeUseAnalytics = useMemo(() => {
    const groups = {};
    
    filteredProperties.forEach(prop => {
      const type = prop.asset_type_use || 'Unknown';
      if (!groups[type]) {
        groups[type] = {
          count: 0,
          totalPrice: 0,
          totalNormPrice: 0,
          sflaSum: 0
        };
      }
      
      groups[type].count++;
      if (prop.sales_price) groups[type].totalPrice += prop.sales_price;
      if (prop.values_norm_time) groups[type].totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) groups[type].sflaSum += prop.asset_sfla;
    });

    return Object.entries(groups).map(([type, data]) => ({
      type,
      typeName: showCodesNotMeanings ? type : (interpretCodes.getTypeName?.({ asset_type_use: type }, parsedCodeDefinitions, vendorType) || type),
      count: data.count,
      avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
      avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
      avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0
    })).sort((a, b) => b.count - a.count);
  }, [filteredProperties, showCodesNotMeanings, parsedCodeDefinitions, vendorType]);

  // ==================== EVENT HANDLERS ====================
  
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleSetDateRange = (period) => {
    if (!jobData?.end_date) return;
    
    const taxYear = new Date(jobData.end_date).getFullYear();
    const yearOfValue = taxYear - 1;

    switch(period) {
      case 'CSP':
        setDateRange({
          start: new Date(yearOfValue - 1, 9, 1).toISOString().split('T')[0],
          end: new Date(yearOfValue, 11, 31).toISOString().split('T')[0]
        });
        break;
      case 'PSP':
        setDateRange({
          start: new Date(yearOfValue - 2, 9, 1).toISOString().split('T')[0],
          end: new Date(yearOfValue - 1, 8, 30).toISOString().split('T')[0]
        });
        break;
      case 'HSP':
        setDateRange({
          start: new Date(yearOfValue - 3, 9, 1).toISOString().split('T')[0],
          end: new Date(yearOfValue - 2, 8, 30).toISOString().split('T')[0]
        });
        break;
      default:
        setDateRange({ start: '', end: '' });
    }
  };

  const toggleExpandSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Save current settings
  const handleSaveSettings = () => {
    if (!settingsName.trim()) {
      alert('Please enter a settings name');
      return;
    }

    const settings = {
      name: settingsName.trim(),
      dateRange,
      salesNuFilter,
      vcsFilter,
      typeFilter,
      designFilter,
      periodFilter,
      showAllProperties,
      showCodesNotMeanings,
      expandedSections,
      sortConfig,
      savedAt: new Date().toISOString()
    };

    const existingIndex = savedSettings.findIndex(s => s.name === settingsName.trim());
    let updatedSettings;

    if (existingIndex >= 0) {
      // Update existing
      updatedSettings = [...savedSettings];
      updatedSettings[existingIndex] = settings;
    } else {
      // Add new
      updatedSettings = [...savedSettings, settings];
    }

    setSavedSettings(updatedSettings);
    localStorage.setItem(`sales-review-saved-settings-${jobData.id}`, JSON.stringify(updatedSettings));
    setSettingsName('');
    setShowSettingsModal(false);
    alert(`Settings "${settings.name}" saved successfully!`);
  };

  // Load saved settings
  const handleLoadSettings = (settings) => {
    setDateRange(settings.dateRange || { start: '', end: '' });
    setSalesNuFilter(settings.salesNuFilter || []);
    setVcsFilter(settings.vcsFilter || []);
    setTypeFilter(settings.typeFilter || []);
    setDesignFilter(settings.designFilter || []);
    setPeriodFilter(settings.periodFilter || []);
    setShowAllProperties(settings.showAllProperties || false);
    setShowCodesNotMeanings(settings.showCodesNotMeanings || false);
    setExpandedSections(settings.expandedSections || { vcs: false, style: false, typeUse: false, view: false });
    setSortConfig(settings.sortConfig || { key: 'sales_date', direction: 'desc' });
    setShowSettingsModal(false);
    alert(`Settings "${settings.name}" loaded successfully!`);
  };

  // Delete saved settings
  const handleDeleteSettings = (settingsToDelete) => {
    if (!confirm(`Delete settings "${settingsToDelete.name}"?`)) return;

    const updatedSettings = savedSettings.filter(s => s.name !== settingsToDelete.name);
    setSavedSettings(updatedSettings);
    localStorage.setItem(`sales-review-saved-settings-${jobData.id}`, JSON.stringify(updatedSettings));
    alert(`Settings "${settingsToDelete.name}" deleted`);
  };

  // Handle normalize value creation
  const handleOpenNormalizeModal = (property) => {
    setNormalizeProperty(property);
    setNormalizeValue(property.values_norm_time || '');
    setShowNormalizeModal(true);
  };

  const handleSaveNormalizedValue = async () => {
    if (!normalizeProperty || !normalizeValue) {
      alert('Please enter a normalized value');
      return;
    }

    try {
      const { error } = await supabase
        .from('property_records')
        .update({ values_norm_time: parseFloat(normalizeValue) })
        .eq('id', normalizeProperty.id);

      if (error) throw error;

      alert('Normalized value saved successfully!');
      setShowNormalizeModal(false);

      // Refresh data
      if (onUpdateJobCache) {
        onUpdateJobCache(jobData.id, { forceRefresh: true });
      }
    } catch (error) {
      console.error('Error saving normalized value:', error);
      alert(`Failed to save: ${error.message}`);
    }
  };

  // ==================== EXCEL EXPORT ====================
  
  const exportToExcel = () => {
    const ws_data = [];
    
    // Headers
    const headers = [
      'VCS', 'Block', 'Lot', 'Qualifier', 'Package', 'Address', 'Current Assessment',
      'Period', 'Lot Frontage', 'Lot Acre', 'Lot Sq Ft', 'Type Use', 'Building Class',
      'Design', 'Ext Cond', 'Int Cond', 'Year Built', 'SFLA', 'Sale Date', 'Sales NU',
      'Sale Price', 'Price/SF', 'Norm Price', 'Norm Price/SF', 'Sales Ratio'
    ];
    ws_data.push(headers);

    // Data rows
    sortedProperties.forEach(prop => {
      ws_data.push([
        prop.property_vcs || '',
        prop.property_block || '',
        prop.property_lot || '',
        prop.property_qualifier || '',
        prop.isPackage ? 'Yes' : 'No',
        prop.property_location || '',
        prop.values_mod_total || '',
        prop.periodCode || '',
        prop.asset_lot_frontage || '',
        prop.asset_lot_acre || '',
        prop.asset_lot_sf || '',
        showCodesNotMeanings ? (prop.asset_type_use || '') : (prop.typeUseName || prop.asset_type_use || ''),
        prop.asset_building_class || '',
        showCodesNotMeanings ? (prop.asset_design_style || '') : (prop.designName || prop.asset_design_style || ''),
        showCodesNotMeanings ? (prop.asset_ext_cond || '') : (prop.exteriorCondName || prop.asset_ext_cond || ''),
        showCodesNotMeanings ? (prop.asset_int_cond || '') : (prop.interiorCondName || prop.asset_int_cond || ''),
        prop.asset_year_built || '',
        prop.asset_sfla || '',
        prop.sales_date ? formatDate(prop.sales_date) : '',
        prop.sales_nu || '',
        prop.sales_price || '',
        prop.pricePerSF || '',
        prop.values_norm_time || '',
        prop.normPricePerSF || '',
        prop.salesRatio || ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    // Styling
    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      fill: { fgColor: { rgb: 'E5E7EB' } }
    };

    const dataStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Apply header styles
    headers.forEach((_, i) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
      if (!ws[cellRef]) ws[cellRef] = {};
      ws[cellRef].s = headerStyle;
    });

    // Apply data styles
    for (let r = 1; r <= sortedProperties.length; r++) {
      for (let c = 0; c < headers.length; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        if (ws[cellRef]) {
          ws[cellRef].s = dataStyle;
        }
      }
    }

    // Column widths
    ws['!cols'] = headers.map(() => ({ wch: 15 }));

    XLSX.utils.book_append_sheet(wb, ws, 'Sales Review');
    XLSX.writeFile(wb, `Sales_Review_${jobData?.job_name || 'Export'}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ==================== RENDER ====================
  
  return (
    <div className="sales-review-tab">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Sales Review</h2>
        <p className="text-sm text-gray-600 mt-1">
          Review and analyze all sales data with period classifications and filtering
        </p>
      </div>

      {/* Controls Row */}
      <div className="mb-6 space-y-4">
        {/* Top Row - Toggles and Actions */}
        <div className="flex flex-wrap gap-4 items-center">
          {/* Show All Toggle */}
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllProperties}
              onChange={(e) => setShowAllProperties(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">Show All Properties</span>
          </label>

          {/* Code/Meaning Toggle */}
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCodesNotMeanings}
              onChange={(e) => setShowCodesNotMeanings(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">Show Codes (not definitions)</span>
          </label>

          {/* Quick Period Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => handleSetDateRange('CSP')}
              className="px-3 py-1.5 text-sm bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100"
            >
              CSP Period
            </button>
            <button
              onClick={() => handleSetDateRange('PSP')}
              className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
            >
              PSP Period
            </button>
            <button
              onClick={() => handleSetDateRange('HSP')}
              className="px-3 py-1.5 text-sm bg-orange-50 text-orange-700 border border-orange-200 rounded hover:bg-orange-100"
            >
              HSP Period
            </button>
          </div>

          {/* Font Size Control */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Font:</label>
            <select
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="px-2 py-1 text-sm border rounded"
            >
              <option value={10}>10px</option>
              <option value={11}>11px</option>
              <option value={12}>12px</option>
              <option value={13}>13px</option>
              <option value={14}>14px</option>
            </select>
          </div>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
            >
              <Save className="w-4 h-4" />
              Settings
            </button>
            <button
              onClick={exportToExcel}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Download className="w-4 h-4" />
              Export to Excel
            </button>
          </div>
        </div>

        {/* Filter Row - Sales Date Range and Sales Codes */}
        <div className="flex flex-wrap gap-4 items-center bg-gray-50 p-4 rounded border">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sales Date Range:</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="px-2 py-1 text-sm border rounded"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="px-2 py-1 text-sm border rounded"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sales NU Codes:</label>
            <div className="flex flex-wrap gap-2">
              {['', '0', '00', '7', '07', '10', '32'].map(code => (
                <label key={code || 'blank'} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={salesNuFilter.includes(code)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSalesNuFilter(prev => [...prev, code]);
                      } else {
                        setSalesNuFilter(prev => prev.filter(c => c !== code));
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs text-gray-700">{code || 'Blank'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Manage Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {/* Save New Settings */}
              <div className="mb-6">
                <h4 className="font-medium text-gray-900 mb-3">Save Current Settings</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    placeholder="Enter settings name..."
                    className="flex-1 px-3 py-2 border rounded"
                  />
                  <button
                    onClick={handleSaveSettings}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                </div>
              </div>

              {/* Saved Settings List */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Saved Settings ({savedSettings.length})</h4>
                {savedSettings.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    No saved settings yet. Save your current filters above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {savedSettings.map((setting, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 border rounded hover:bg-gray-50"
                      >
                        <div>
                          <div className="font-medium text-gray-900">{setting.name}</div>
                          <div className="text-sm text-gray-500">
                            Saved {new Date(setting.savedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleLoadSettings(setting)}
                            className="px-3 py-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-sm inline-flex items-center gap-1"
                          >
                            <Upload className="w-4 h-4" />
                            Load
                          </button>
                          <button
                            onClick={() => handleDeleteSettings(setting)}
                            className="px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm inline-flex items-center gap-1"
                          >
                            <X className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="mb-6 grid grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded border">
          <div className="text-sm text-gray-600">Total Properties</div>
          <div className="text-2xl font-bold text-gray-900">{formatNumber(filteredProperties.length)}</div>
        </div>
        <div className="bg-green-50 p-4 rounded border border-green-200">
          <div className="text-sm text-green-700">CSP Sales</div>
          <div className="text-2xl font-bold text-green-900">
            {formatNumber(filteredProperties.filter(p => p.periodCode === 'CSP').length)}
          </div>
        </div>
        <div className="bg-blue-50 p-4 rounded border border-blue-200">
          <div className="text-sm text-blue-700">PSP Sales</div>
          <div className="text-2xl font-bold text-blue-900">
            {formatNumber(filteredProperties.filter(p => p.periodCode === 'PSP').length)}
          </div>
        </div>
        <div className="bg-orange-50 p-4 rounded border border-orange-200">
          <div className="text-sm text-orange-700">HSP Sales</div>
          <div className="text-2xl font-bold text-orange-900">
            {formatNumber(filteredProperties.filter(p => p.periodCode === 'HSP').length)}
          </div>
        </div>
        <div className="bg-gray-50 p-4 rounded border">
          <div className="text-sm text-gray-600">Avg Sales Ratio</div>
          <div className="text-2xl font-bold text-gray-900">
            {(() => {
              const ratios = filteredProperties.filter(p => p.salesRatio !== null).map(p => p.salesRatio);
              const avg = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
              return formatPercent(avg);
            })()}
          </div>
        </div>
      </div>

      {/* Expandable Analytics */}
      <div className="mb-6 space-y-2">
        {/* VCS Analysis */}
        <div className="border rounded bg-white">
          <button
            onClick={() => toggleExpandSection('vcs')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">Show VCS Analysis</span>
            {expandedSections.vcs ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
          {expandedSections.vcs && (
            <div className="px-4 pb-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">VCS</th>
                    <th className="text-right py-2 px-2"># Sales</th>
                    <th className="text-right py-2 px-2">Avg Price</th>
                    <th className="text-right py-2 px-2">Avg Norm Price</th>
                    <th className="text-right py-2 px-2">Avg SFLA</th>
                    <th className="text-right py-2 px-2">Avg PPSF</th>
                    <th className="text-right py-2 px-2">Avg Age</th>
                    <th className="text-right py-2 px-2">Avg Assessed</th>
                    <th className="text-right py-2 px-2">Avg Ratio</th>
                    <th className="text-right py-2 px-2">COD</th>
                    <th className="text-right py-2 px-2">PRD</th>
                  </tr>
                </thead>
                <tbody>
                  {vcsAnalytics.map(row => (
                    <tr key={row.vcs} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium">{row.vcs}</td>
                      <td className="py-2 px-2 text-right">{row.count}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgNormPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatNumber(row.avgSFLA)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPPSF)}</td>
                      <td className="py-2 px-2 text-right">{row.avgAge.toFixed(1)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgAssessed)}</td>
                      <td className="py-2 px-2 text-right">{formatPercent(row.avgSalesRatio)}</td>
                      <td className="py-2 px-2 text-right">{row.cod.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">{row.prd.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Style Analysis */}
        <div className="border rounded bg-white">
          <button
            onClick={() => toggleExpandSection('style')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">Show Style Analysis</span>
            {expandedSections.style ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
          {expandedSections.style && (
            <div className="px-4 pb-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Style</th>
                    <th className="text-right py-2 px-2"># Sales</th>
                    <th className="text-right py-2 px-2">Avg Price</th>
                    <th className="text-right py-2 px-2">Avg Norm Price</th>
                    <th className="text-right py-2 px-2">Avg PPSF</th>
                  </tr>
                </thead>
                <tbody>
                  {styleAnalytics.map(row => (
                    <tr key={row.style} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium">{row.styleName}</td>
                      <td className="py-2 px-2 text-right">{row.count}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgNormPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPPSF)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Type/Use Analysis */}
        <div className="border rounded bg-white">
          <button
            onClick={() => toggleExpandSection('typeUse')}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">Show Type/Use Analysis</span>
            {expandedSections.typeUse ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
          {expandedSections.typeUse && (
            <div className="px-4 pb-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Type/Use</th>
                    <th className="text-right py-2 px-2"># Sales</th>
                    <th className="text-right py-2 px-2">Avg Price</th>
                    <th className="text-right py-2 px-2">Avg Norm Price</th>
                    <th className="text-right py-2 px-2">Avg PPSF</th>
                  </tr>
                </thead>
                <tbody>
                  {typeUseAnalytics.map(row => (
                    <tr key={row.type} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium">{row.typeName}</td>
                      <td className="py-2 px-2 text-right">{row.count}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgNormPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPPSF)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Main Data Table */}
      <div className="bg-white border rounded overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '70vh' }}>
          <table className="min-w-full" style={{ fontSize: `${fontSize}px` }}>
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('property_vcs')}>VCS</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('property_block')}>Block</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('property_lot')}>Lot</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Qual</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Package</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('property_location')}>Address</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('values_mod_total')}>Current Asmt</th>
                <th className="px-3 py-3 text-center font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('periodCode')}>Period</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot Front</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot Acre</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot SF</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Type</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Class</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Design</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Ext Cond</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Int Cond</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('asset_year_built')}>Yr Built</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('asset_sfla')}>SFLA</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sales_date')}>Sale Date</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">NU</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('sales_price')}>Sale Price</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Price/SF</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('values_norm_time')}>Norm Price</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Norm $/SF</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100" onClick={() => handleSort('salesRatio')}>Sales Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedProperties.map((prop, idx) => (
                <tr key={prop.id || idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2">{prop.property_vcs || '-'}</td>
                  <td className="px-3 py-2">{prop.property_block || '-'}</td>
                  <td className="px-3 py-2">{prop.property_lot || '-'}</td>
                  <td className="px-3 py-2">{prop.property_qualifier || '-'}</td>
                  <td className="px-3 py-2">{prop.isPackage ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 max-w-xs truncate">{prop.property_location || '-'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(prop.values_mod_total)}</td>
                  <td className="px-3 py-2 text-center">
                    {prop.periodCode ? (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        prop.periodCode === 'CSP' ? 'bg-green-100 text-green-800' :
                        prop.periodCode === 'PSP' ? 'bg-blue-100 text-blue-800' :
                        prop.periodCode === 'HSP' ? 'bg-orange-100 text-orange-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {prop.periodCode}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(prop.asset_lot_frontage)}</td>
                  <td className="px-3 py-2 text-right">{prop.asset_lot_acre || '-'}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(prop.asset_lot_sf)}</td>
                  <td className="px-3 py-2">{showCodesNotMeanings ? (prop.asset_type_use || '-') : (prop.typeUseName || prop.asset_type_use || '-')}</td>
                  <td className="px-3 py-2">{prop.asset_building_class || '-'}</td>
                  <td className="px-3 py-2">{showCodesNotMeanings ? (prop.asset_design_style || '-') : (prop.designName || prop.asset_design_style || '-')}</td>
                  <td className="px-3 py-2">{showCodesNotMeanings ? (prop.asset_ext_cond || '-') : (prop.exteriorCondName || prop.asset_ext_cond || '-')}</td>
                  <td className="px-3 py-2">{showCodesNotMeanings ? (prop.asset_int_cond || '-') : (prop.interiorCondName || prop.asset_int_cond || '-')}</td>
                  <td className="px-3 py-2 text-right">{prop.asset_year_built || '-'}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(prop.asset_sfla)}</td>
                  <td className="px-3 py-2">{formatDate(prop.sales_date)}</td>
                  <td className="px-3 py-2">{prop.sales_nu || '-'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(prop.sales_price)}</td>
                  <td className="px-3 py-2 text-right">{prop.pricePerSF ? formatCurrency(prop.pricePerSF) : '-'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(prop.values_norm_time)}</td>
                  <td className="px-3 py-2 text-right">{prop.normPricePerSF ? formatCurrency(prop.normPricePerSF) : '-'}</td>
                  <td className="px-3 py-2 text-right">{prop.salesRatio !== null ? formatPercent(prop.salesRatio) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedProperties.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No properties match the current filters
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesReviewTab;
