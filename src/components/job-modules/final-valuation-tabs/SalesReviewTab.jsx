import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import {
  Download,
  Save,
  Upload,
  ChevronDown,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown
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
  onUpdateJobCache = () => {},
  tenantConfig = null
}) => {
  const vendorType = jobData?.vendor_type || jobData?.vendor_source || 'BRT';
  const parsedCodeDefinitions = useMemo(() => jobData?.parsed_code_definitions || {}, [jobData?.parsed_code_definitions]);

  // ==================== SORTABLE HEADER COMPONENT ====================

  const SortableHeader = ({ sortKey, label, align = 'left', sortConfig, onSort }) => {
    const isSorted = sortConfig.key === sortKey;
    const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

    return (
      <th
        className={`px-3 py-3 ${alignClass} font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none`}
        onClick={() => onSort(sortKey)}
      >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
          <span>{label}</span>
          {isSorted && (
            sortConfig.direction === 'asc'
              ? <ArrowUp className="w-4 h-4" />
              : <ArrowDown className="w-4 h-4" />
          )}
        </div>
      </th>
    );
  };

  // ==================== SALES NU CODE NORMALIZATION ====================

  const normalizeSalesNuCode = useCallback((nuCode) => {
    if (!nuCode || nuCode === '' || nuCode === null || nuCode === undefined) return '0';

    const code = String(nuCode).trim().toUpperCase();

    // Treat blank and '00' as '0'
    if (code === '' || code === '00') return '0';

    // Pad single digit codes with leading zero (7 -> 07, 8 -> 08)
    if (code.length === 1 && /^\d$/.test(code)) {
      return '0' + code;
    }

    return code;
  }, []);

  // ==================== PERIOD CLASSIFICATION LOGIC ====================

  const getPeriodClassification = useCallback((saleDate, endDate) => {
    if (!saleDate || !endDate) return null;

    const sale = new Date(saleDate);
    const assessmentYear = new Date(endDate).getFullYear();

    // CSP (Current Sale Period): 10/1 of prior year → 12/31 of assessment year
    // For assessment date 1/1/2026 (stored as 12/31/2025): 10/1/2024 → 12/31/2025
    const cspStart = new Date(assessmentYear - 1, 9, 1);  // Oct 1 of prior year
    const cspEnd = new Date(assessmentYear, 11, 31);       // Dec 31 of assessment year

    // PSP (Prior Sale Period): 10/1 of two years prior → 9/30 of prior year
    // For assessment date 1/1/2026: 10/1/2023 → 9/30/2024
    const pspStart = new Date(assessmentYear - 2, 9, 1);   // Oct 1 of two years prior
    const pspEnd = new Date(assessmentYear - 1, 8, 30);    // Sep 30 of prior year

    // HSP (Historical Sale Period): 10/1 of three years prior → 9/30 of two years prior
    // For assessment date 1/1/2026: 10/1/2022 → 9/30/2023
    const hspStart = new Date(assessmentYear - 3, 9, 1);   // Oct 1 of three years prior
    const hspEnd = new Date(assessmentYear - 2, 8, 30);    // Sep 30 of two years prior

    if (sale >= cspStart && sale <= cspEnd) return 'CSP';
    if (sale >= pspStart && sale <= pspEnd) return 'PSP';
    if (sale >= hspStart && sale <= hspEnd) return 'HSP';
    return ''; // Blank instead of 'OTHER'
  }, []);

  // ==================== STATE MANAGEMENT ====================
  
  const [showAllProperties, setShowAllProperties] = useState(false);
  const [showAllNormalizedSales, setShowAllNormalizedSales] = useState(false);
  const [showCodesNotMeanings, setShowCodesNotMeanings] = useState(true); // Default to codes
  const [fontSize, setFontSize] = useState(12); // Adjustable font size
  const [sortConfig, setSortConfig] = useState({ key: 'sales_date', direction: 'desc' });
  const [useProjectedAssessment, setUseProjectedAssessment] = useState(false); // Toggle for Current vs Projected
  
  // Filters
  const [dateRange, setDateRange] = useState({ start: '', end: '' }); // Empty by default - don't filter by date initially
  
  const [salesNuFilter, setSalesNuFilter] = useState([]); // Empty by default
  const [vcsFilter, setVcsFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [designFilter, setDesignFilter] = useState([]);
  const [periodFilter, setPeriodFilter] = useState([]); // Empty means show all periods by default
  const [viewFilter, setViewFilter] = useState([]); // View/Period filter (CSP, PSP, HSP)

  // Include/Exclude state for CME tool
  const [includeOverrides, setIncludeOverrides] = useState({}); // propertyId -> true/false/null

  // Selection state for clearing normalization
  const [selectedProperties, setSelectedProperties] = useState(new Set()); // Set of property IDs
  const [isClearing, setIsClearing] = useState(false);

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

  // Load include/exclude overrides from property_market_analysis
  useEffect(() => {
    const loadIncludeOverrides = async () => {
      if (!jobData?.id || !properties || properties.length === 0) return;

      try {
        const { data, error } = await supabase
          .from('property_market_analysis')
          .select('property_composite_key, cme_include_override')
          .eq('job_id', jobData.id)
          .not('cme_include_override', 'is', null);

        if (error) throw error;

        if (data && data.length > 0) {
          // Create a map of composite_key to property id
          const keyToIdMap = {};
          properties.forEach(prop => {
            keyToIdMap[prop.property_composite_key] = prop.id;
          });

          // Build overrides object with property id as key
          const overrides = {};
          data.forEach(item => {
            const propId = keyToIdMap[item.property_composite_key];
            if (propId) {
              overrides[propId] = item.cme_include_override;
            }
          });

          setIncludeOverrides(overrides);
        }
      } catch (error) {
        console.error('Error loading include overrides:', error);
      }
    };

    loadIncludeOverrides();
  }, [jobData?.id, properties]);

  // Note: Projected assessments use values_cama_total from property_records (already in props)
  // No need to load final_valuation_data separately

  // ==================== COMPUTED DATA ====================
  
  const enrichedProperties = useMemo(() => {
    return properties.map(prop => {
      // Package detection using centralized _pkg (computed once in JobContainer)
      const pkgInfo = prop._pkg;
      const isPackage = !!pkgInfo;
      const isFarmSale = pkgInfo?.is_farm_package || prop.property_m4_class === '3A';

      // Period classification - override to FARM for farm sales
      let periodCode = getPeriodClassification(prop.sales_date, jobData?.end_date);
      if (isFarmSale && periodCode) {
        periodCode = 'FARM'; // Farm sales get their own category
      }
      
      // Calculated fields
      const pricePerSF = prop.sales_price && prop.asset_sfla && prop.asset_sfla > 0
        ? prop.sales_price / prop.asset_sfla
        : null;

      const normPricePerSF = prop.values_norm_time && prop.asset_sfla && prop.asset_sfla > 0
        ? prop.values_norm_time / prop.asset_sfla
        : null;

      // Current/MOD sales ratio (uses values_mod_total)
      const salesRatio = prop.values_norm_time && prop.values_norm_time > 0
        ? (prop.values_mod_total / prop.values_norm_time) * 100
        : null;

      // Proposed/CAMA sales ratio (uses values_cama_total)
      const salesRatioCama = prop.values_norm_time && prop.values_norm_time > 0
        ? (prop.values_cama_total / prop.values_norm_time) * 100
        : null;

      // Code interpretations
      const typeUseName = interpretCodes.getTypeName?.(prop, parsedCodeDefinitions, vendorType);
      const designName = interpretCodes.getDesignName?.(prop, parsedCodeDefinitions, vendorType);
      const exteriorCondName = interpretCodes.getExteriorConditionName?.(prop, parsedCodeDefinitions, vendorType);
      const interiorCondName = interpretCodes.getInteriorConditionName?.(prop, parsedCodeDefinitions, vendorType);
      const viewName = interpretCodes.getViewName?.(prop, parsedCodeDefinitions, vendorType);

      // Normalize sales NU code
      const normalizedSalesNu = normalizeSalesNuCode(prop.sales_nu);

      // Get lot data from market_manual fields (property_market_analysis table)
      const lotAcre = prop.market_manual_lot_acre || prop.asset_lot_acre || null;
      const lotSf = prop.market_manual_lot_sf || prop.asset_lot_sf || null;
      const lotFrontage = prop.asset_lot_frontage || null;

      // Determine auto-include based on default date range (12/31 pre-end to 10/1 prior-prior)
      // This essentially matches CSP period: 10/1 of year-2 to 12/31 of year-1
      const isAutoIncluded = periodCode === 'CSP';

      // Get override status (null = auto, true = manual include, false = manual exclude)
      const includeOverride = includeOverrides[prop.id] ?? prop.cme_include_override ?? null;
      const isIncluded = includeOverride !== null ? includeOverride : isAutoIncluded;

      return {
        ...prop,
        periodCode,
        isPackage,
        isFarmSale,
        pricePerSF,
        normPricePerSF,
        salesRatio,
        salesRatioCama,
        typeUseName,
        designName,
        exteriorCondName,
        interiorCondName,
        viewName,
        normalizedSalesNu,
        lotAcre,
        lotSf,
        lotFrontage,
        isAutoIncluded,
        includeOverride,
        isIncluded
      };
    });
  }, [properties, jobData?.end_date, parsedCodeDefinitions, vendorType, getPeriodClassification, normalizeSalesNuCode, includeOverrides]);

  // Filtered properties
  const filteredProperties = useMemo(() => {
    let filtered = enrichedProperties;

    // Default filter: Show only properties with valid sales data
    if (!showAllProperties) {
      filtered = filtered.filter(p => {
        if (!p.sales_date) return false;
        // Must have a sale price greater than $100
        if (!p.sales_price || p.sales_price <= 100) return false;
        // Building class must be > 10 (exclude null, empty, whitespace, zero, <=10)
        const bc = parseInt(p.asset_building_class) || 0;
        if (bc <= 10) return false;
        return true;
      });
    }

    // Sales NU filter (using normalized codes)
    if (salesNuFilter.length > 0 && !showAllProperties) {
      filtered = filtered.filter(p => {
        return salesNuFilter.includes(p.normalizedSalesNu);
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

    // Period filter - show CSP, PSP, HSP by default unless "Show All Normalized Sales" is checked
    if (!showAllNormalizedSales && !showAllProperties) {
      filtered = filtered.filter(p => p.periodCode === 'CSP' || p.periodCode === 'PSP' || p.periodCode === 'HSP');
    }

    // Date range filter (only apply if user has set custom dates)
    if (dateRange.start && dateRange.end && periodFilter.length === 0) {
      filtered = filtered.filter(p => {
        if (!p.sales_date) return false;
        const saleDate = new Date(p.sales_date);
        return saleDate >= new Date(dateRange.start) && saleDate <= new Date(dateRange.end);
      });
    }

    // Specific period filter override
    if (periodFilter.length > 0) {
      filtered = filtered.filter(p => periodFilter.includes(p.periodCode));
    }

    // View filter
    if (viewFilter.length > 0) {
      filtered = filtered.filter(p => viewFilter.includes(p.asset_view));
    }

    return filtered;
  }, [enrichedProperties, showAllProperties, showAllNormalizedSales, dateRange, salesNuFilter, vcsFilter, typeFilter, designFilter, periodFilter, viewFilter]);

  // Get unique normalized Sales NU codes for dropdown
  const uniqueSalesNuCodes = useMemo(() => {
    const codes = new Set();
    enrichedProperties.forEach(prop => {
      if (prop.normalizedSalesNu) {
        codes.add(prop.normalizedSalesNu);
      }
    });
    return Array.from(codes).sort();
  }, [enrichedProperties]);

  // Get unique VCS codes for filter dropdown
  const uniqueVcsCodes = useMemo(() => {
    const codes = new Set();
    enrichedProperties.forEach(prop => {
      if (prop.property_vcs) {
        codes.add(prop.property_vcs);
      }
    });
    return Array.from(codes).sort();
  }, [enrichedProperties]);

  // Get unique Type/Use codes for filter dropdown with descriptions
  const uniqueTypeCodes = useMemo(() => {
    const codeMap = new Map();
    enrichedProperties.forEach(prop => {
      if (prop.asset_type_use) {
        const description = prop.typeUseName || prop.asset_type_use;
        codeMap.set(prop.asset_type_use, description);
      }
    });
    return Array.from(codeMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, desc]) => ({ code, description: desc }));
  }, [enrichedProperties]);

  // Get unique Design/Style codes for filter dropdown with descriptions
  const uniqueDesignCodes = useMemo(() => {
    const codeMap = new Map();
    enrichedProperties.forEach(prop => {
      if (prop.asset_design_style) {
        const description = prop.designName || prop.asset_design_style;
        codeMap.set(prop.asset_design_style, description);
      }
    });
    return Array.from(codeMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, desc]) => ({ code, description: desc }));
  }, [enrichedProperties]);

  // Get unique View codes for filter dropdown with descriptions
  const uniqueViewCodes = useMemo(() => {
    const codeMap = new Map();
    enrichedProperties.forEach(prop => {
      if (prop.asset_view) {
        const description = prop.viewName || prop.asset_view;
        codeMap.set(prop.asset_view, description);
      }
    });
    return Array.from(codeMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, desc]) => ({ code, description: desc }));
  }, [enrichedProperties]);

  // Sorted properties with numerical sorting for Block and Lot
  const sortedProperties = useMemo(() => {
    if (!sortConfig.key) return filteredProperties;

    return [...filteredProperties].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;

      // Numerical sorting for Block and Lot
      if (sortConfig.key === 'property_block' || sortConfig.key === 'property_lot') {
        const aNum = parseFloat(aVal) || 0;
        const bNum = parseFloat(bVal) || 0;
        comparison = aNum - bNum;
      } else if (typeof aVal === 'string') {
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

    // Initialize overall totals for summary row
    const overallTotals = {
      count: 0,
      totalPrice: 0,
      totalNormPrice: 0,
      sflaSum: 0,
      yearBuiltSum: 0,
      yearBuiltCount: 0,
      assessedSum: 0,
      salesRatioSum: 0,
      salesRatioCount: 0,
      salesRatios: []
    };

    // Group properties by VCS and collect sales ratios
    filteredProperties.forEach(prop => {
      const vcs = prop.property_vcs || 'Unknown';
      if (!groups[vcs]) {
        groups[vcs] = {
          count: 0,
          totalPrice: 0,
          totalNormPrice: 0,
          sflaSum: 0,
          yearBuiltSum: 0,
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
        groups[vcs].yearBuiltSum += prop.asset_year_built;
        groups[vcs].yearBuiltCount++;
      }

      // Use projected (CAMA) or current (MOD) assessment based on toggle
      const assessedValue = useProjectedAssessment ? prop.values_cama_total : prop.values_mod_total;
      const ratioValue = useProjectedAssessment ? prop.salesRatioCama : prop.salesRatio;

      // Debug: Log all properties contributing to projected average
      if (useProjectedAssessment && ratioValue !== null && ratioValue !== undefined) {
        console.log(`🔢 VCS ${vcs} - Block ${prop.property_block} Lot ${prop.property_lot}:`, {
          values_cama_total: prop.values_cama_total,
          values_norm_time: prop.values_norm_time,
          salesRatioCama: ratioValue?.toFixed(1) + '%',
          property_location: prop.property_location
        });
      }

      if (assessedValue) groups[vcs].assessedSum += assessedValue;
      if (ratioValue !== null && ratioValue !== undefined) {
        groups[vcs].salesRatioSum += ratioValue;
        groups[vcs].salesRatioCount++;
        groups[vcs].salesRatios.push(ratioValue);
      }

      // Add to overall totals
      overallTotals.count++;
      if (prop.sales_price) overallTotals.totalPrice += prop.sales_price;
      if (prop.values_norm_time) overallTotals.totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) overallTotals.sflaSum += prop.asset_sfla;
      if (prop.asset_year_built) {
        overallTotals.yearBuiltSum += prop.asset_year_built;
        overallTotals.yearBuiltCount++;
      }
      if (assessedValue) overallTotals.assessedSum += assessedValue;
      if (ratioValue !== null && ratioValue !== undefined) {
        overallTotals.salesRatioSum += ratioValue;
        overallTotals.salesRatioCount++;
        overallTotals.salesRatios.push(ratioValue);
      }
    });

    const analytics = Object.entries(groups).map(([vcs, data]) => {
      // Use weighted mean: (Total Assessed / Total Sales) × 100
      const avgSalesRatio = data.totalNormPrice > 0 ? (data.assessedSum / data.totalNormPrice) * 100 : 0;

      // Calculate COD (Coefficient of Deviation) - NJ Formula
      // COD = (Average Absolute Deviation / Mean Assessment-Sales Ratio) × 100%
      let cod = 0;
      if (data.salesRatios.length > 0 && avgSalesRatio > 0) {
        const absoluteDeviations = data.salesRatios.map(ratio => Math.abs(ratio - avgSalesRatio));
        const avgAbsoluteDeviation = absoluteDeviations.reduce((a, b) => a + b, 0) / data.salesRatios.length;
        cod = (avgAbsoluteDeviation / avgSalesRatio) * 100;
      }

      // Calculate PRD (Price-Related Differential) - NJ Formula
      // PRD = Mean Assessment Ratio / Weighted Mean Assessment Ratio
      // Mean Ratio = average of individual ratios, Weighted Mean = avgSalesRatio (already calculated above)
      let prd = 0;
      if (data.salesRatioCount > 0 && avgSalesRatio > 0) {
        const meanRatio = data.salesRatioSum / data.salesRatioCount; // Average of individual ratios
        prd = meanRatio / avgSalesRatio; // Divide by weighted mean
      }

      return {
        vcs,
        count: data.count,
        avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
        avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
        avgSFLA: data.sflaSum > 0 ? Math.round(data.sflaSum / data.count) : 0,
        avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0,
        avgYearBuilt: data.yearBuiltCount > 0 ? Math.round(data.yearBuiltSum / data.yearBuiltCount) : 0,
        avgAssessed: data.count > 0 ? data.assessedSum / data.count : 0,
        avgSalesRatio,
        cod,
        prd
      };
    }).sort((a, b) => a.vcs.localeCompare(b.vcs));

    // Calculate overall summary row
    // Use weighted mean: (Total Assessed / Total Sales) × 100
    const avgSalesRatio = overallTotals.totalNormPrice > 0 ? (overallTotals.assessedSum / overallTotals.totalNormPrice) * 100 : 0;

    console.log('🎯 VCS Analytics Calculation:', {
      mode: useProjectedAssessment ? 'PROJECTED' : 'CURRENT',
      totalAssessed: overallTotals.assessedSum,
      totalNormSales: overallTotals.totalNormPrice,
      calculatedRatio: avgSalesRatio.toFixed(1) + '%',
      propertyCount: overallTotals.count
    });
    let cod = 0;
    if (overallTotals.salesRatios.length > 0 && avgSalesRatio > 0) {
      const absoluteDeviations = overallTotals.salesRatios.map(ratio => Math.abs(ratio - avgSalesRatio));
      const avgAbsoluteDeviation = absoluteDeviations.reduce((a, b) => a + b, 0) / overallTotals.salesRatios.length;
      cod = (avgAbsoluteDeviation / avgSalesRatio) * 100;
    }
    // Calculate PRD (Price-Related Differential) - NJ Formula
    // PRD = Mean Ratio / Weighted Mean Ratio
    let prd = 0;
    if (overallTotals.salesRatioCount > 0 && avgSalesRatio > 0) {
      const meanRatio = overallTotals.salesRatioSum / overallTotals.salesRatioCount; // Average of individual ratios
      prd = meanRatio / avgSalesRatio; // Divide by weighted mean
    }

    const summary = {
      vcs: 'OVERALL AVERAGE',
      count: overallTotals.count,
      avgPrice: overallTotals.count > 0 ? overallTotals.totalPrice / overallTotals.count : 0,
      avgNormPrice: overallTotals.count > 0 ? overallTotals.totalNormPrice / overallTotals.count : 0,
      avgSFLA: overallTotals.sflaSum > 0 ? Math.round(overallTotals.sflaSum / overallTotals.count) : 0,
      avgPPSF: overallTotals.count > 0 && overallTotals.sflaSum > 0 ? overallTotals.totalPrice / overallTotals.sflaSum : 0,
      avgYearBuilt: overallTotals.yearBuiltCount > 0 ? Math.round(overallTotals.yearBuiltSum / overallTotals.yearBuiltCount) : 0,
      avgAssessed: overallTotals.count > 0 ? overallTotals.assessedSum / overallTotals.count : 0,
      avgSalesRatio,
      cod,
      prd
    };

    // Debug: Summary of projected average calculation
    if (useProjectedAssessment && overallTotals.totalNormPrice > 0) {
      console.log('📊 PROJECTED AVERAGE CALCULATION SUMMARY:', {
        mode: 'Projected (CAMA)',
        total_properties_with_sales: overallTotals.count,
        total_assessed: overallTotals.assessedSum.toLocaleString(),
        total_norm_sales: overallTotals.totalNormPrice.toLocaleString(),
        calculated_average: avgSalesRatio.toFixed(1) + '%',
        formula: `(${overallTotals.assessedSum.toLocaleString()} / ${overallTotals.totalNormPrice.toLocaleString()}) × 100 = ${avgSalesRatio.toFixed(1)}%`,
        COD: cod.toFixed(2),
        PRD: prd.toFixed(3)
      });
    }

    return { analytics, summary };
  }, [filteredProperties, useProjectedAssessment]);

  const styleAnalytics = useMemo(() => {
    const groups = {};
    const overallTotals = {
      count: 0,
      totalPrice: 0,
      totalNormPrice: 0,
      sflaSum: 0
    };
    
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

      overallTotals.count++;
      if (prop.sales_price) overallTotals.totalPrice += prop.sales_price;
      if (prop.values_norm_time) overallTotals.totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) overallTotals.sflaSum += prop.asset_sfla;
    });

    const analytics = Object.entries(groups).map(([style, data]) => ({
      style,
      styleName: showCodesNotMeanings ? style : (interpretCodes.getDesignName?.({ asset_design_style: style }, parsedCodeDefinitions, vendorType) || style),
      count: data.count,
      avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
      avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
      avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0
    })).sort((a, b) => b.count - a.count);

    const summary = {
      style: 'OVERALL AVERAGE',
      styleName: 'OVERALL AVERAGE',
      count: overallTotals.count,
      avgPrice: overallTotals.count > 0 ? overallTotals.totalPrice / overallTotals.count : 0,
      avgNormPrice: overallTotals.count > 0 ? overallTotals.totalNormPrice / overallTotals.count : 0,
      avgPPSF: overallTotals.count > 0 && overallTotals.sflaSum > 0 ? overallTotals.totalPrice / overallTotals.sflaSum : 0
    };

    return { analytics, summary };
  }, [filteredProperties, showCodesNotMeanings, parsedCodeDefinitions, vendorType]);

  const typeUseAnalytics = useMemo(() => {
    const groups = {};
    const overallTotals = {
      count: 0,
      totalPrice: 0,
      totalNormPrice: 0,
      sflaSum: 0
    };
    
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

      overallTotals.count++;
      if (prop.sales_price) overallTotals.totalPrice += prop.sales_price;
      if (prop.values_norm_time) overallTotals.totalNormPrice += prop.values_norm_time;
      if (prop.asset_sfla) overallTotals.sflaSum += prop.asset_sfla;
    });

    const analytics = Object.entries(groups).map(([type, data]) => ({
      type,
      typeName: showCodesNotMeanings ? type : (interpretCodes.getTypeName?.({ asset_type_use: type }, parsedCodeDefinitions, vendorType) || type),
      count: data.count,
      avgPrice: data.count > 0 ? data.totalPrice / data.count : 0,
      avgNormPrice: data.count > 0 ? data.totalNormPrice / data.count : 0,
      avgPPSF: data.count > 0 && data.sflaSum > 0 ? data.totalPrice / data.sflaSum : 0
    })).sort((a, b) => b.count - a.count);

    const summary = {
      type: 'OVERALL AVERAGE',
      typeName: 'OVERALL AVERAGE',
      count: overallTotals.count,
      avgPrice: overallTotals.count > 0 ? overallTotals.totalPrice / overallTotals.count : 0,
      avgNormPrice: overallTotals.count > 0 ? overallTotals.totalNormPrice / overallTotals.count : 0,
      avgPPSF: overallTotals.count > 0 && overallTotals.sflaSum > 0 ? overallTotals.totalPrice / overallTotals.sflaSum : 0
    };

    return { analytics, summary };
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

    const assessmentYear = new Date(jobData.end_date).getFullYear();

    switch(period) {
      case 'CSP':
        // CSP: 10/1 of prior year → 12/31 of assessment year
        setDateRange({
          start: new Date(assessmentYear - 1, 9, 1).toISOString().split('T')[0],
          end: new Date(assessmentYear, 11, 31).toISOString().split('T')[0]
        });
        break;
      case 'PSP':
        // PSP: 10/1 of two years prior → 9/30 of prior year
        setDateRange({
          start: new Date(assessmentYear - 2, 9, 1).toISOString().split('T')[0],
          end: new Date(assessmentYear - 1, 8, 30).toISOString().split('T')[0]
        });
        break;
      case 'HSP':
        // HSP: 10/1 of three years prior → 9/30 of two years prior
        setDateRange({
          start: new Date(assessmentYear - 3, 9, 1).toISOString().split('T')[0],
          end: new Date(assessmentYear - 2, 8, 30).toISOString().split('T')[0]
        });
        setPeriodFilter([]);
        break;
      case 'FARM':
        // FARM: Show only farm sales (no date range, just filter by period code)
        setDateRange({ start: '', end: '' });
        setPeriodFilter(['FARM']);
        setShowAllNormalizedSales(true); // Need to show all to see FARM since it's excluded by default
        break;
      default:
        setDateRange({ start: '', end: '' });
        setPeriodFilter([]);
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
      viewFilter,
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
    setSalesNuFilter(settings.salesNuFilter || ['0', '07', '32']);
    setVcsFilter(settings.vcsFilter || []);
    setTypeFilter(settings.typeFilter || []);
    setDesignFilter(settings.designFilter || []);
    setPeriodFilter(settings.periodFilter || []);
    setViewFilter(settings.viewFilter || []);
    setShowAllProperties(settings.showAllProperties || false);
    setShowCodesNotMeanings(settings.showCodesNotMeanings || false);
    setExpandedSections(settings.expandedSections || { vcs: false, style: false, typeUse: false, view: false });
    setSortConfig(settings.sortConfig || { key: 'sales_date', direction: 'desc' });
    setShowSettingsModal(false);
    alert(`Settings "${settings.name}" loaded successfully!`);
  };

  // Delete saved settings
  const handleDeleteSettings = (settingsToDelete) => {
    if (!window.confirm(`Delete settings "${settingsToDelete.name}"?`)) return;

    const updatedSettings = savedSettings.filter(s => s.name !== settingsToDelete.name);
    setSavedSettings(updatedSettings);
    localStorage.setItem(`sales-review-saved-settings-${jobData.id}`, JSON.stringify(updatedSettings));
    alert(`Settings "${settingsToDelete.name}" deleted`);
  };



  // ==================== CLEAR NORMALIZATION ====================

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      // Select all filtered properties that have normalized values
      const propertiesWithNorm = sortedProperties
        .filter(p => p.values_norm_time || p.values_norm_size)
        .map(p => p.id);
      setSelectedProperties(new Set(propertiesWithNorm));
    } else {
      setSelectedProperties(new Set());
    }
  };

  const handleSelectProperty = (propertyId, checked) => {
    const newSelection = new Set(selectedProperties);
    if (checked) {
      newSelection.add(propertyId);
    } else {
      newSelection.delete(propertyId);
    }
    setSelectedProperties(newSelection);
  };

  const handleClearNormalization = async () => {
    if (selectedProperties.size === 0) {
      alert('No properties selected');
      return;
    }

    const confirmMsg = `Clear time and size normalization for ${selectedProperties.size} selected ${selectedProperties.size === 1 ? 'property' : 'properties'}?\n\nThis will set values_norm_time and values_norm_size to null in the database.`;

    if (!window.confirm(confirmMsg)) return;

    setIsClearing(true);

    try {
      // Get composite keys for selected properties
      const selectedProps = properties.filter(p => selectedProperties.has(p.id));
      const compositeKeys = selectedProps.map(p => p.property_composite_key);

      if (compositeKeys.length === 0) {
        alert('No valid properties to clear');
        return;
      }

      // Clear normalized values in property_market_analysis
      const { error } = await supabase
        .from('property_market_analysis')
        .update({
          values_norm_time: null,
          values_norm_size: null,
          updated_at: new Date().toISOString()
        })
        .eq('job_id', jobData.id)
        .in('property_composite_key', compositeKeys);

      if (error) throw error;

      // Clear selection
      setSelectedProperties(new Set());

      // Refresh data
      if (onUpdateJobCache) {
        setTimeout(() => {
          onUpdateJobCache();
        }, 500);
      }

      alert(`✅ Successfully cleared normalization for ${compositeKeys.length} ${compositeKeys.length === 1 ? 'property' : 'properties'}`);

    } catch (error) {
      console.error('Error clearing normalization:', error);
      alert(`Failed to clear normalization: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  // ==================== EXCEL EXPORT ====================

  const exportToExcel = () => {
    const ws_data = [];
    
    // Headers
    const headers = [
      'VCS', 'Block', 'Lot', 'Qualifier', 'Package', 'Address', 'Prop Class', 'Current Assessment',
      'Period', 'View', 'Lot Frontage', 'Lot Acre', 'Lot Sq Ft', 'Type Use', 'Building Class',
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
        prop.property_m4_class || '',
        prop.values_mod_total || '',
        prop.periodCode || '',
        showCodesNotMeanings ? (prop.asset_view || '') : (prop.viewName || prop.asset_view || ''),
        prop.lotFrontage || '',
        prop.lotAcre ? prop.lotAcre.toFixed(2) : '',
        prop.lotSf || '',
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

      {/* Expandable Analytics - Moved to Top */}
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
            <div className="px-4 pb-4">
              {/* Assessment Type Toggle */}
              <div className="mb-3 flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Assessment Data:</label>
                <button
                  onClick={() => setUseProjectedAssessment(false)}
                  className={`px-3 py-1 text-sm rounded-l border ${
                    !useProjectedAssessment
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Current
                </button>
                <button
                  onClick={() => setUseProjectedAssessment(true)}
                  className={`px-3 py-1 text-sm rounded-r border-t border-r border-b ${
                    useProjectedAssessment
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Projected
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">VCS</th>
                    <th className="text-right py-2 px-2"># Sales</th>
                    <th className="text-right py-2 px-2">Avg Price</th>
                    <th className="text-right py-2 px-2">Avg Norm Price</th>
                    <th className="text-right py-2 px-2">Avg SFLA</th>
                    <th className="text-right py-2 px-2">Avg PPSF</th>
                    <th className="text-right py-2 px-2">Avg Year Built</th>
                    <th className="text-right py-2 px-2">Avg Assessed{useProjectedAssessment ? ' (Projected)' : ''}</th>
                    <th className="text-right py-2 px-2">Avg Ratio</th>
                    <th className="text-right py-2 px-2">COD</th>
                    <th className="text-right py-2 px-2">PRD</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b-2 border-gray-400 bg-blue-50 font-bold">
                    <td className="py-2 px-2">{vcsAnalytics.summary.vcs}</td>
                    <td className="py-2 px-2 text-right">{vcsAnalytics.summary.count}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(vcsAnalytics.summary.avgPrice)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(vcsAnalytics.summary.avgNormPrice)}</td>
                    <td className="py-2 px-2 text-right">{vcsAnalytics.summary.avgSFLA}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(vcsAnalytics.summary.avgPPSF)}</td>
                    <td className="py-2 px-2 text-right">{vcsAnalytics.summary.avgYearBuilt || '-'}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(vcsAnalytics.summary.avgAssessed)}</td>
                    <td className="py-2 px-2 text-right">{formatPercent(vcsAnalytics.summary.avgSalesRatio)}</td>
                    <td className="py-2 px-2 text-right">{vcsAnalytics.summary.cod.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right">{vcsAnalytics.summary.prd.toFixed(3)}</td>
                  </tr>
                  {vcsAnalytics.analytics.map(row => (
                    <tr key={row.vcs} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium">{row.vcs}</td>
                      <td className="py-2 px-2 text-right">{row.count}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPrice)}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgNormPrice)}</td>
                      <td className="py-2 px-2 text-right">{row.avgSFLA}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgPPSF)}</td>
                      <td className="py-2 px-2 text-right">{row.avgYearBuilt || '-'}</td>
                      <td className="py-2 px-2 text-right">{formatCurrency(row.avgAssessed)}</td>
                      <td className="py-2 px-2 text-right">{formatPercent(row.avgSalesRatio)}</td>
                      <td className="py-2 px-2 text-right">{row.cod.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right">{row.prd.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
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
                  <tr className="border-b-2 border-gray-400 bg-blue-50 font-bold">
                    <td className="py-2 px-2">{styleAnalytics.summary.styleName}</td>
                    <td className="py-2 px-2 text-right">{styleAnalytics.summary.count}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(styleAnalytics.summary.avgPrice)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(styleAnalytics.summary.avgNormPrice)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(styleAnalytics.summary.avgPPSF)}</td>
                  </tr>
                  {styleAnalytics.analytics.map(row => (
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
                  <tr className="border-b-2 border-gray-400 bg-blue-50 font-bold">
                    <td className="py-2 px-2">{typeUseAnalytics.summary.typeName}</td>
                    <td className="py-2 px-2 text-right">{typeUseAnalytics.summary.count}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(typeUseAnalytics.summary.avgPrice)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(typeUseAnalytics.summary.avgNormPrice)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(typeUseAnalytics.summary.avgPPSF)}</td>
                  </tr>
                  {typeUseAnalytics.analytics.map(row => (
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

          {/* Show All Normalized Sales Toggle */}
          {!showAllProperties && (
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showAllNormalizedSales}
                onChange={(e) => setShowAllNormalizedSales(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium text-gray-700">Show All Normalized Sales</span>
            </label>
          )}

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
            className="px-3 py-1.5 text-sm" style={{ backgroundColor: '#fed7aa', color: '#c2410c', border: '1px solid #fdba74' }}
            onMouseEnter={(e) => e.target.style.backgroundColor = '#fdba74'}
            onMouseLeave={(e) => e.target.style.backgroundColor = '#fed7aa'}
          >
            HSP Period
          </button>
            <button
              onClick={() => handleSetDateRange('FARM')}
              className="px-3 py-1.5 text-sm bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100"
            >
              Farm Sales
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
            <button
              onClick={handleClearNormalization}
              disabled={isClearing || selectedProperties.size === 0}
              style={{
                backgroundColor: selectedProperties.size > 0 ? '#ea580c' : '#d1d5db',
                color: selectedProperties.size > 0 ? 'white' : '#4b5563',
                opacity: isClearing ? 0.5 : 1
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded transition-colors ${
                selectedProperties.size > 0
                  ? 'hover:bg-orange-700'
                  : 'cursor-not-allowed'
              }`}
              title={selectedProperties.size === 0 ? 'Select properties with checkboxes to clear their normalized values' : `Clear normalization for ${selectedProperties.size} selected ${selectedProperties.size === 1 ? 'property' : 'properties'}`}
            >
              <X className="w-4 h-4" />
              Clear Normalization {selectedProperties.size > 0 ? `(${selectedProperties.size})` : ''}
            </button>
          </div>
        </div>

        {/* Unified Filters Box */}
        <div className="bg-gray-50 p-4 rounded border">
          <div className="grid grid-cols-2 gap-4">
            {/* Left Column */}
            <div className="space-y-4">
              {/* Sales Date Range */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Sales Date Range:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                    className="px-2 py-1 text-sm border rounded flex-1"
                  />
                  <span className="text-gray-500">to</span>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                    className="px-2 py-1 text-sm border rounded flex-1"
                  />
                </div>
              </div>

              {/* Sales NU Codes */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Sales NU Codes:</label>
                <div className="flex flex-wrap gap-1 px-3 py-2 border rounded bg-white min-h-[42px]">
                  {salesNuFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">No codes selected</span>
                  ) : (
                    salesNuFilter.map(code => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded"
                      >
                        {code === '0' ? '0 (Blank/00)' : code}
                        <button
                          onClick={() => setSalesNuFilter(prev => prev.filter(c => c !== code))}
                          className="hover:text-blue-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !salesNuFilter.includes(code)) {
                      setSalesNuFilter(prev => [...prev, code]);
                    }
                    e.target.value = '';
                  }}
                  className="px-2 py-1 text-sm border rounded w-full mt-2"
                >
                  <option value="">+ Add Code</option>
                  {uniqueSalesNuCodes.filter(code => !salesNuFilter.includes(code)).map(code => (
                    <option key={code} value={code}>
                      {code === '0' ? '0 (Blank/00)' : code}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter VCS */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Filter VCS</label>
                <div className="flex flex-wrap gap-1 px-3 py-2 border rounded bg-white min-h-[42px]">
                  {vcsFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">All VCS</span>
                  ) : (
                    vcsFilter.map(code => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs rounded"
                      >
                        {code}
                        <button
                          onClick={() => setVcsFilter(prev => prev.filter(c => c !== code))}
                          className="hover:text-green-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !vcsFilter.includes(code)) {
                      setVcsFilter(prev => [...prev, code]);
                    }
                    e.target.value = '';
                  }}
                  className="px-2 py-1 text-sm border rounded w-full mt-2"
                >
                  <option value="">+ Add VCS</option>
                  {uniqueVcsCodes.filter(code => !vcsFilter.includes(code)).map(code => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              {/* Filter Type/Use Codes */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Filter Type/Use Codes</label>
                <div className="flex flex-wrap gap-1 px-3 py-2 border rounded bg-white min-h-[42px]">
                  {typeFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">All Types</span>
                  ) : (
                    typeFilter.map(code => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded"
                      >
                        {code}
                        <button
                          onClick={() => setTypeFilter(prev => prev.filter(c => c !== code))}
                          className="hover:text-purple-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !typeFilter.includes(code)) {
                      setTypeFilter(prev => [...prev, code]);
                    }
                    e.target.value = '';
                  }}
                  className="px-2 py-1 text-sm border rounded w-full mt-2"
                >
                  <option value="">+ Add Type</option>
                  {uniqueTypeCodes.filter(item => !typeFilter.includes(item.code)).map(item => (
                    <option key={item.code} value={item.code}>
                      {item.code} - {item.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter Style Codes */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Filter Style Codes</label>
                <div className="flex flex-wrap gap-1 px-3 py-2 border rounded bg-white min-h-[42px]">
                  {designFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">All Styles</span>
                  ) : (
                    designFilter.map(code => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded"
                      >
                        {code}
                        <button
                          onClick={() => setDesignFilter(prev => prev.filter(c => c !== code))}
                          className="hover:text-orange-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !designFilter.includes(code)) {
                      setDesignFilter(prev => [...prev, code]);
                    }
                    e.target.value = '';
                  }}
                  className="px-2 py-1 text-sm border rounded w-full mt-2"
                >
                  <option value="">+ Add Style</option>
                  {uniqueDesignCodes.filter(item => !designFilter.includes(item.code)).map(item => (
                    <option key={item.code} value={item.code}>
                      {item.code} - {item.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filter View */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Filter View Codes</label>
                <div className="flex flex-wrap gap-1 px-3 py-2 border rounded bg-white min-h-[42px]">
                  {viewFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">All Views</span>
                  ) : (
                    viewFilter.map(code => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-pink-100 text-pink-800 text-xs rounded"
                      >
                        {code}
                        <button
                          onClick={() => setViewFilter(prev => prev.filter(c => c !== code))}
                          className="hover:text-pink-900"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && !viewFilter.includes(code)) {
                      setViewFilter(prev => [...prev, code]);
                    }
                    e.target.value = '';
                  }}
                  className="px-2 py-1 text-sm border rounded w-full mt-2"
                >
                  <option value="">+ Add View</option>
                  {uniqueViewCodes.filter(item => !viewFilter.includes(item.code)).map(item => (
                    <option key={item.code} value={item.code}>
                      {item.code} - {item.description}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Clear All Filters Button - Centered at Bottom */}
          <div className="flex justify-center mt-4 pt-4 border-t">
            <button
              onClick={() => {
                setVcsFilter([]);
                setTypeFilter([]);
                setDesignFilter([]);
                setSalesNuFilter([]);
                setViewFilter([]);
                setDateRange({ start: '', end: '' });
              }}
              className="px-4 py-2 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Clear All Filters
            </button>
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
      <div className="mb-6">
        <div className="grid grid-cols-6 gap-4 mb-3">
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
          <div className="p-4 rounded border" style={{ backgroundColor: '#fed7aa', borderColor: '#fdba74' }}>
            <div className="text-sm text-orange-700">HSP Sales</div>
            <div className="text-2xl font-bold text-orange-900">
              {formatNumber(filteredProperties.filter(p => p.periodCode === 'HSP').length)}
            </div>
          </div>
          <div className="bg-gray-50 p-4 rounded border">
            <div className="text-sm text-gray-600">Crnt Avg Sales Ratio</div>
            <div className="text-2xl font-bold text-gray-900">
              {(() => {
                // Use weighted mean: (Total Assessed / Total Sales) × 100
                const props = filteredProperties.filter(p => p.values_mod_total && p.values_norm_time && p.values_norm_time > 0);
                const totalAssessed = props.reduce((sum, p) => sum + (p.values_mod_total || 0), 0);
                const totalSales = props.reduce((sum, p) => sum + (p.values_norm_time || 0), 0);
                const avg = totalSales > 0 ? (totalAssessed / totalSales) * 100 : 0;
                return formatPercent(avg);
              })()}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded border border-purple-200">
            <div className="text-sm text-purple-700">Prop Avg Sales Ratio</div>
            <div className="text-2xl font-bold text-purple-900">
              {(() => {
                // Use weighted mean: (Total Assessed / Total Sales) × 100
                const props = filteredProperties.filter(p => p.values_cama_total && p.values_norm_time && p.values_norm_time > 0);
                const totalAssessed = props.reduce((sum, p) => sum + (p.values_cama_total || 0), 0);
                const totalSales = props.reduce((sum, p) => sum + (p.values_norm_time || 0), 0);
                const avg = totalSales > 0 ? (totalAssessed / totalSales) * 100 : 0;
                return formatPercent(avg);
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Main Data Table with Horizontal Scroll */}
      <div className="bg-white border rounded overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '70vh' }}>
          <table className="min-w-full" style={{ fontSize: `${fontSize}px` }}>
            <thead className="bg-gray-50 border-b sticky top-0 z-10">
              <tr>
                <th className="px-2 py-3 text-center font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedProperties.size > 0 && selectedProperties.size === sortedProperties.filter(p => p.values_norm_time || p.values_norm_size).length}
                    onChange={handleSelectAll}
                    className="rounded border-gray-300"
                    title="Select all properties with normalization"
                  />
                </th>
                <SortableHeader sortKey="property_vcs" label="VCS" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="property_block" label="Block" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="property_lot" label="Lot" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="property_qualifier" label="Qual" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-3 py-3 text-left font-medium text-gray-700">Package</th>
                <SortableHeader sortKey="property_location" label="Address" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="property_m4_class" label="Prop Class" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="values_mod_total" label="Current Asmt" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="periodCode" label="Code" align="center" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot Front</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot Acre</th>
                <th className="px-3 py-3 text-right font-medium text-gray-700">Lot SF</th>
                <SortableHeader sortKey="asset_type_use" label="Type" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="asset_building_class" label="Class" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-3 py-3 text-left font-medium text-gray-700">Design</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Ext Cond</th>
                <th className="px-3 py-3 text-left font-medium text-gray-700">Int Cond</th>
                <SortableHeader sortKey="asset_year_built" label="Yr Built" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="asset_sfla" label="SFLA" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="sales_date" label="Sale Date" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="sales_nu" label="NU" align="left" sortConfig={sortConfig} onSort={handleSort} />
                <SortableHeader sortKey="sales_price" label="Sale Price" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-3 py-3 text-right font-medium text-gray-700">Price/SF</th>
                <SortableHeader sortKey="values_norm_time" label="Norm Price" align="right" sortConfig={sortConfig} onSort={handleSort} />
                <th className="px-3 py-3 text-right font-medium text-gray-700">Norm $/SF</th>
                <SortableHeader sortKey="salesRatio" label="Sales Ratio" align="right" sortConfig={sortConfig} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedProperties.map((prop, idx) => (
                <tr
                  key={prop.property_composite_key || prop.id || idx}
                  className="hover:bg-gray-50"
                >
                  <td className="px-2 py-2 text-center">
                    {(prop.values_norm_time || prop.values_norm_size) ? (
                      <input
                        type="checkbox"
                        checked={selectedProperties.has(prop.id)}
                        onChange={(e) => handleSelectProperty(prop.id, e.target.checked)}
                        className="rounded border-gray-300"
                      />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{prop.property_vcs || '-'}</td>
                  <td className="px-3 py-2">{prop.property_block || '-'}</td>
                  <td className="px-3 py-2">{prop.property_lot || '-'}</td>
                  <td className="px-3 py-2">{prop.property_qualifier || '-'}</td>
                  <td className="px-3 py-2">{prop.isPackage ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 max-w-xs truncate">{prop.property_location || '-'}</td>
                  <td className="px-3 py-2">{prop.property_m4_class || '-'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(prop.values_mod_total)}</td>
                  <td className="px-3 py-2 text-center">
                    {prop.periodCode || '-'}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(prop.lotFrontage)}</td>
                  <td className="px-3 py-2 text-right">{prop.lotAcre ? prop.lotAcre.toFixed(2) : '-'}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(prop.lotSf)}</td>
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
