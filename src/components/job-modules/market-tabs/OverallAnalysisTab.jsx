import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { interpretCodes } from '../../../lib/supabaseClient';
import {
  TrendingUp, RefreshCw, Download, Filter, ChevronDown, ChevronUp,
  AlertCircle, Home, Building, Calendar, MapPin, Layers, DollarSign
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import './sharedTabNav.css';

const OverallAnalysisTab = ({ 
  properties = [], 
  jobData = {}, 
  marketLandData = {},
  onDataChange = () => {}
}) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('market');
  const [selectedVCS, setSelectedVCS] = useState('ALL');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastProcessed, setLastProcessed] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    typeUse: true,
    design: true,
    yearBuilt: true,
    vcsType: true,
    vcsTypeDesign: false,
    condoDesign: true,
    condoBedroom: true,
    condoEndInt: true,
    condoFloor: true
  });

  const [customBaselines, setCustomBaselines] = useState({
    design: null,
    typeUse: null
  });

  // Run analysis when baselines change
  useEffect(() => {
    if (filteredProperties.length > 0) {
      runAnalysis();
    }
  }, [customBaselines.design, customBaselines.typeUse]);

  // Extract vendor type and code definitions
  const vendorType = jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions || {};

  // Microsystems diagnostic state
  const [diagnosticStatus, setDiagnosticStatus] = useState(null);
  const [isRunningDiagnostic, setIsRunningDiagnostic] = useState(false);

  // Check if Microsystems definitions need repair
  const needsRepair = vendorType === 'Microsystems' && codeDefinitions && !codeDefinitions.flat_lookup;

  // Function to run diagnostic and repair
  const runMicrosystemsDiagnostic = async () => {
    if (!jobData?.id) return;

    setIsRunningDiagnostic(true);
    try {
      const result = await interpretCodes.diagnoseMicrosystemsDefinitions(jobData.id);
      setDiagnosticStatus(result);

      // If repair was successful, trigger a page refresh to reload the updated definitions
      if (result.status === 'repaired') {
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to run diagnostic:', error);
      setDiagnosticStatus({ status: 'error', message: error.message });
    } finally {
      setIsRunningDiagnostic(false);
    }
  };

  // ==================== CME BRACKET DEFINITIONS ====================
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'up to $99,999', color: '#FF9999', textColor: 'black' },          // Light red/pink
    { min: 100000, max: 199999, label: '$100,000-$199,999', color: '#FFB366', textColor: 'black' }, // Light orange
    { min: 200000, max: 299999, label: '$200,000-$299,999', color: '#FFCC99', textColor: 'black' }, // Peach
    { min: 300000, max: 399999, label: '$300,000-$399,999', color: '#FFFF99', textColor: 'black' }, // Light yellow
    { min: 400000, max: 499999, label: '$400,000-$499,999', color: '#CCFF99', textColor: 'black' }, // Light green-yellow
    { min: 500000, max: 749999, label: '$500,000-$749,999', color: '#99FF99', textColor: 'black' }, // Light green
    { min: 750000, max: 999999, label: '$750,000-$999,999', color: '#99CCFF', textColor: 'black' }, // Light blue
    { min: 1000000, max: 1499999, label: '$1,000,000-$1,499,999', color: '#9999FF', textColor: 'black' }, // Light purple
    { min: 1500000, max: 1999999, label: '$1,500,000-$1,999,999', color: '#CC99FF', textColor: 'black' }, // Light violet
    { min: 2000000, max: 99999999, label: 'Over $2,000,000', color: '#FF99FF', textColor: 'black' }      // Light magenta
  ];

  const getCMEBracket = (price) => {
    return CME_BRACKETS.find(bracket => price >= bracket.min && price <= bracket.max) || CME_BRACKETS[0];
  };

  // ==================== HELPER FUNCTIONS ====================
  
  // Jim's 50% size adjustment formula (explicitly: ((AVG-CUR) * ((SALE/CUR) * 50%)) + SALE)
  const calculateAdjustedPrice = (salePrice, propertySize, baselineSize) => {
    // Ensure we have valid numeric inputs
    if (!salePrice || !propertySize || propertySize === 0) return salePrice;
    if (!baselineSize) return salePrice;

    // Apply formula exactly as outlined: ((AVG - CURRENT) * ((SALE / CURRENT) * 0.5)) + SALE
    const sizeDiff = baselineSize - propertySize;
    const pricePerSF = salePrice / propertySize;
    const adjustment = sizeDiff * (pricePerSF * 0.5);

    return salePrice + adjustment;
  };

  // Parse type code to get category
  const getTypeCategory = (typeCode) => {
    if (!typeCode) return 'Unknown';
    const firstChar = typeCode.toString().charAt(0);
    
    switch(firstChar) {
      case '1': return 'Single Family';
      case '2': return 'Semi-Detached';
      case '3': 
        if (typeCode === '31' || typeCode === '3E') return 'Row/Town End';
        if (typeCode === '30' || typeCode === '3I') return 'Row/Town Interior';
        return 'Row/Townhouse';
      case '4':
        if (typeCode === '42') return 'Two Family';
        if (typeCode === '43') return 'Three Family';
        if (typeCode === '44') return 'Four Family';
        return 'Multi-Family';
      case '5':
        if (typeCode === '51') return 'Conversion One';
        if (typeCode === '52') return 'Conversion Two';
        return 'Conversion';
      case '6': return 'Condominium';
      default: return 'Other';
    }
  };

  // Get year built category
  const getYearBuiltCategory = (yearBuilt) => {
    const currentYear = new Date().getFullYear();
    const age = currentYear - yearBuilt;
    
    if (age <= 10) return 'New';
    if (age <= 20) return 'Newer';
    if (age <= 35) return 'Moderate';
    if (age <= 50) return 'Older';
    return 'Historic';
  };

  // Inferred bedrooms cache for async enrichment (BRT fallback to BEDTOT)
  const inferredBedroomsRef = React.useRef({});

  // Build lookup of job-scoped time normalized sales (if available)
  const timeNormalizedLookup = useMemo(() => {
    const map = new Map();
    if (marketLandData && Array.isArray(marketLandData.time_normalized_sales)) {
      marketLandData.time_normalized_sales.forEach(s => {
        // normalized sales may be stored with different keys depending on process
        const key = s.property_composite_key || s.property_key || s.property_composite || null;
        const time = s.values_norm_time || s.time_normalized_price || s.normalizedTime || s.time_normalized || s.values_norm_time;
        if (key && time) map.set(key, Number(time));
      });
    }
    return map;
  }, [marketLandData]);

  // Get all unique VCS codes
  const allVCSCodes = useMemo(() => {
    const vcsSet = new Set();
    properties.forEach(p => {
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';
      if (vcs && vcs !== 'Unknown') {
        vcsSet.add(vcs);
      }
    });
    return Array.from(vcsSet).sort();
  }, [properties]);

  // Filter properties by selected VCS
  const filteredProperties = useMemo(() => {
    if (selectedVCS === 'ALL') return properties;
    return properties.filter(p => {
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';
      return vcs === selectedVCS;
    });
  }, [properties, selectedVCS]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US').format(Math.round(value));
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  // ==================== ANALYSIS FUNCTIONS ====================

  // Type & Use Analysis - UPDATED WITH DUAL COLUMNS (ALL vs SALES)
  const analyzeTypeUse = useCallback(() => {
    const groups = {};
    
    // First, separate all properties from valid sales using job-scoped normalized values when available
    const validSales = filteredProperties.filter(p => {
      const key = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(key);
      if (timeNormFromPMA && timeNormFromPMA > 0) return true;
      // fallback to property-level values_norm_time if present
      return p.values_norm_time && p.values_norm_time > 0;
    });

    // Count ALL properties for inventory
    filteredProperties.forEach(p => {
      const typeCode = p.asset_type_use || 'Unknown';
      
      // Skip empty, blank, "00", space, or Unknown type codes
      if (!typeCode || typeCode === 'Unknown' || typeCode === '' || 
          typeCode === '00' || typeCode === '0' || typeCode.trim() === '') {
        return; // Skip this property
      }
      
      const category = getTypeCategory(typeCode);
      // Use only synchronous Microsystems decoding to avoid async rendering issues
      const typeName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_type_use') || category : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_type_use') || category : category)) : category;
      
      // Also skip if the name comes back as Unknown or Other
      if (typeName === 'Unknown' || typeName === 'Other' || !typeName || typeName.trim() === '') {
        return; // Skip this property
      }
      
      const key = `${typeCode}-${typeName}`;
      
      if (!groups[key]) {
        groups[key] = {
          code: typeCode,
          name: typeName,
          category,
          allProperties: [],  // Track ALL properties
          salesProperties: [], // Track only valid sales
          // Totals for ALL properties
          totalSizeAll: 0,
          totalYearAll: 0,
          // Totals for SALES only
          totalPrice: 0,
          totalSizeSales: 0,
          totalYearSales: 0,
          // Counts
          propertyCount: 0,  // Total inventory
          salesCount: 0,      // Valid sales only
          // Calculated metrics
          avgPrice: 0,
          avgSize: 0,
          avgSizeSales: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0,
          isBaseline: false
        };
      }
      
      groups[key].allProperties.push(p);
      groups[key].propertyCount++;
      groups[key].totalSizeAll += p.asset_sfla || 0;
      groups[key].totalYearAll += p.asset_year_built || 0;
      
      // Only add to sales if it has valid price (prefer job-scoped normalized value)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);
      if (timePrice) {
        groups[key].salesProperties.push({ ...p, _time_normalized_price: timePrice });
        groups[key].salesCount++;
        groups[key].totalPrice += timePrice;
        groups[key].totalSizeSales += p.asset_sfla || 0;
        groups[key].totalYearSales += p.asset_year_built || 0;
      }
    });

    // Calculate averages first (no adjusted prices yet)
    Object.values(groups).forEach(group => {
      // Averages for ALL properties in this group
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;

      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
    });

    // Identify baseline group (prefer Single Family if available with sales)
    const groupsArray = Object.values(groups);
    let baselineGroup = groupsArray.find(g => g.code && g.code.toString().startsWith('1') && g.salesCount > 0);

    // If no Single Family, use the highest priced group
    if (!baselineGroup) {
      let maxPrice = 0;
      groupsArray.forEach(group => {
        if (group.salesCount > 0 && group.avgPrice > maxPrice) {
          maxPrice = group.avgPrice;
          baselineGroup = group;
        }
      });
    }

    // Now calculate adjusted prices using BASELINE size for normalization
    Object.values(groups).forEach(group => {
      if (group.salesCount > 0 && baselineGroup) {
        let totalAdjusted = 0;
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            baselineGroup.avgSizeSales  // Use BASELINE sales average for normalization
          );
          totalAdjusted += adjusted;
        });
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Calculate deltas from baseline (baselineGroup may have been overridden to SF)
    // Delta is calculated as: (Current Adj Price - Baseline Sale Price) / Baseline Sale Price
    Object.values(groups).forEach(group => {
      if (baselineGroup && group !== baselineGroup && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - baselineGroup.avgPrice;
        group.delta = delta;
        group.deltaPercent = baselineGroup.avgPrice > 0 ?
          (delta / baselineGroup.avgPrice * 100) : 0;
      } else {
        group.delta = 0;
        group.deltaPercent = 0;
      }
      // Mark baseline row - it should not show adjusted price
      group.isBaseline = (group === baselineGroup);

      // Get CME bracket only if there are sales
      if (group.salesCount > 0) {
        group.cmeBracket = getCMEBracket(group.avgAdjustedPrice);
      } else {
        group.cmeBracket = null;
      }
    });

    return { groups: groupsArray, baseline: baselineGroup };
  }, [filteredProperties, codeDefinitions, vendorType]);
  // Design & Style Analysis - UPDATED WITH FILTER FOR EMPTY/UNKNOWN AND DUAL COLUMNS
  const analyzeDesign = useCallback(() => {
    const groups = {};
    
    // Separate valid sales from all properties
    const validSales = filteredProperties.filter(p => p.values_norm_time && p.values_norm_time > 0);
    
    filteredProperties.forEach(p => {
      const designCode = p.asset_design_style || 'Unknown';
      // Use only synchronous Microsystems decoding to avoid async rendering issues
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || designCode : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || designCode : designCode)) : designCode;
      
      // FILTER FIX: Skip unknown/empty designs - including "00" and whitespace
      if (!designCode || designCode === 'Unknown' || designCode === '' || 
          designCode === '00' || designCode === '0' || designCode.trim() === '' ||
          designName === 'Unknown' || designName === '' || designName.trim() === '' ||
          designName === 'Other') {
        return; // Skip this property
      }
      
      const key = `${designCode}-${designName}`;
      
      if (!groups[key]) {
        groups[key] = {
          code: designCode,
          name: designName,
          allProperties: [],
          salesProperties: [],
          // Totals for ALL properties
          totalSizeAll: 0,
          totalYearAll: 0,
          // Totals for SALES only
          totalPrice: 0,
          totalSizeSales: 0,
          totalYearSales: 0,
          // Counts
          propertyCount: 0,
          salesCount: 0,
          // Calculated metrics
          avgPrice: 0,
          avgSize: 0,
          avgSizeSales: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0,
          isBaseline: false
        };
      }
      
      groups[key].allProperties.push(p);
      groups[key].propertyCount++;
      groups[key].totalSizeAll += p.asset_sfla || 0;
      groups[key].totalYearAll += p.asset_year_built || 0;
      
      // Only add to sales if it has valid price (prefer job-scoped normalized value)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);
      if (timePrice) {
        groups[key].salesProperties.push({ ...p, _time_normalized_price: timePrice });
        groups[key].salesCount++;
        groups[key].totalPrice += timePrice;
        groups[key].totalSizeSales += p.asset_sfla || 0;
        groups[key].totalYearSales += p.asset_year_built || 0;
      }
    });

    // Calculate averages first
    Object.values(groups).forEach(group => {
      // Averages for ALL properties in this group
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;

      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
    });

    // Identify baseline (prefer highest priced)
    let baselineGroup = null;
    let maxPrice = 0;
    Object.values(groups).forEach(group => {
      if (group.salesCount > 0 && group.avgPrice > maxPrice) {
        maxPrice = group.avgPrice;
        baselineGroup = group;
      }
    });

    // Use custom baseline if set
    const actualBaseline = customBaselines.design ?
      Object.values(groups).find(g => g.code === customBaselines.design) || baselineGroup :
      baselineGroup;

    // Calculate adjusted prices using BASELINE size
    Object.values(groups).forEach(group => {
      if (group.salesCount > 0 && actualBaseline) {
        let totalAdjusted = 0;
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            actualBaseline.avgSizeSales  // Use BASELINE size
          );
          totalAdjusted += adjusted;
        });
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Calculate deltas from baseline
    // Delta is calculated as: (Current Adj Price - Baseline Sale Price) / Baseline Sale Price
    Object.values(groups).forEach(group => {
      if (actualBaseline && group !== actualBaseline && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - actualBaseline.avgPrice;
        group.delta = delta;
        group.deltaPercent = actualBaseline.avgPrice > 0 ?
          (delta / actualBaseline.avgPrice * 100) : 0;
      } else if (group === actualBaseline || group.salesCount === 0) {
        group.delta = 0;
        group.deltaPercent = 0;
      }
      // Mark baseline row - it should not show adjusted price
      group.isBaseline = (group === actualBaseline);
    });

    return { groups: Object.values(groups), baseline: actualBaseline };
  }, [filteredProperties, codeDefinitions, vendorType, customBaselines.design]);
  // Year Built Analysis - UPDATED WITH DUAL COLUMNS
  const analyzeYearBuilt = useCallback(() => {
    const currentYear = new Date().getFullYear();
    
    // Separate valid sales from all properties
    const validSales = filteredProperties.filter(p => p.values_norm_time && p.values_norm_time > 0);
    
    const groups = {
      'New': {
        label: 'New (0-10 years)',
        minYear: currentYear - 10,
        isCCF: true,
        allProperties: [],
        salesProperties: [],
        // Totals for ALL
        totalSizeAll: 0,
        totalYearAll: 0,
        // Totals for SALES
        totalPrice: 0,
        totalSizeSales: 0,
        totalYearSales: 0,
        // Counts
        propertyCount: 0,
        salesCount: 0,
        // Calculated metrics
        avgPrice: 0,
        avgSize: 0,
        avgSizeSales: 0,
        avgAdjustedPrice: 0,
        delta: 0,
        deltaPercent: 0,
        isBaseline: false
      },
      'Newer': {
        label: 'Newer (11-20 years)',
        minYear: currentYear - 20,
        maxYear: currentYear - 11,
        isCCF: true,
        allProperties: [],
        salesProperties: [],
        totalSizeAll: 0,
        totalYearAll: 0,
        totalPrice: 0,
        totalSizeSales: 0,
        totalYearSales: 0,
        propertyCount: 0,
        salesCount: 0,
        avgPrice: 0,
        avgSize: 0,
        avgSizeSales: 0,
        avgAdjustedPrice: 0,
        delta: 0,
        deltaPercent: 0,
        isBaseline: false
      },
      'Moderate': {
        label: 'Moderate (21-35 years)',
        minYear: currentYear - 35,
        maxYear: currentYear - 21,
        allProperties: [],
        salesProperties: [],
        totalSizeAll: 0,
        totalYearAll: 0,
        totalPrice: 0,
        totalSizeSales: 0,
        totalYearSales: 0,
        propertyCount: 0,
        salesCount: 0,
        avgPrice: 0,
        avgSize: 0,
        avgSizeSales: 0,
        avgAdjustedPrice: 0,
        delta: 0,
        deltaPercent: 0,
        isBaseline: false
      },
      'Older': {
        label: 'Older (36-50 years)',
        minYear: currentYear - 50,
        maxYear: currentYear - 36,
        allProperties: [],
        salesProperties: [],
        totalSizeAll: 0,
        totalYearAll: 0,
        totalPrice: 0,
        totalSizeSales: 0,
        totalYearSales: 0,
        propertyCount: 0,
        salesCount: 0,
        avgPrice: 0,
        avgSize: 0,
        avgSizeSales: 0,
        avgAdjustedPrice: 0,
        delta: 0,
        deltaPercent: 0,
        isBaseline: false
      },
      'Historic': {
        label: 'Historic (50+ years)',
        maxYear: currentYear - 51,
        allProperties: [],
        salesProperties: [],
        totalSizeAll: 0,
        totalYearAll: 0,
        totalPrice: 0,
        totalSizeSales: 0,
        totalYearSales: 0,
        propertyCount: 0,
        salesCount: 0,
        avgPrice: 0,
        avgSize: 0,
        avgSizeSales: 0,
        avgAdjustedPrice: 0,
        delta: 0,
        deltaPercent: 0,
        isBaseline: false
      }
    };

    filteredProperties.forEach(p => {
      const yearBuilt = p.asset_year_built;
      if (!yearBuilt || yearBuilt === 0) return;
      
      const category = getYearBuiltCategory(yearBuilt);
      const group = groups[category];
      
      if (group) {
        group.allProperties.push(p);
        group.propertyCount++;
        group.totalSizeAll += p.asset_sfla || 0;
        group.totalYearAll += yearBuilt;
        
        // Only add to sales if it has valid price
        if (p.values_norm_time && p.values_norm_time > 0) {
          group.salesProperties.push(p);
          group.salesCount++;
          group.totalPrice += p.values_norm_time;
          group.totalSizeSales += p.asset_sfla || 0;
          group.totalYearSales += yearBuilt;
        }
      }
    });

    // Calculate averages first
    Object.values(groups).forEach(group => {
      // Averages for ALL properties
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;

      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
    });

    // Identify baseline (highest priced group)
    let baselineGroup = null;
    let maxPrice = 0;
    Object.values(groups).forEach(group => {
      if (group.salesCount > 0 && group.avgPrice > maxPrice) {
        maxPrice = group.avgPrice;
        baselineGroup = group;
      }
    });

    // Calculate adjusted prices using BASELINE size
    Object.values(groups).forEach(group => {
      if (group.salesCount > 0 && baselineGroup) {
        let totalAdjusted = 0;
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            baselineGroup.avgSizeSales  // Use BASELINE size
          );
          totalAdjusted += adjusted;
        });
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Calculate deltas from baseline
    // Delta is calculated as: (Current Adj Price - Baseline Sale Price) / Baseline Sale Price
    Object.values(groups).forEach(group => {
      if (baselineGroup && group !== baselineGroup && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - baselineGroup.avgPrice;
        group.delta = delta;
        group.deltaPercent = baselineGroup.avgPrice > 0 ?
          (delta / baselineGroup.avgPrice * 100) : 0;
      } else {
        group.delta = 0;
        group.deltaPercent = 0;
      }
      // Mark baseline row - it should not show adjusted price
      group.isBaseline = (group === baselineGroup);
    });

    return { groups: Object.values(groups), baseline: baselineGroup };
  }, [filteredProperties]);
  // VCS by Type Analysis - Cascading Structure WITH LAYOUT FIXES
  const analyzeVCSByType = useCallback(() => {
    const vcsGroups = {};
    
    // Only count properties with valid sales prices
    const validSales = filteredProperties.filter(p => p.values_norm_time && p.values_norm_time > 0);
    
    // Build the cascading structure
    filteredProperties.forEach(p => {
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';
      // Use raw VCS code to avoid async rendering issues
      const vcsDesc = vcs;
      const typeCode = p.asset_type_use || 'Unknown';
      // Use only synchronous Microsystems decoding to avoid async rendering issues
      const typeName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_type_use') || getTypeCategory(typeCode) : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_type_use') || getTypeCategory(typeCode) : getTypeCategory(typeCode))) : getTypeCategory(typeCode);
      const designCode = p.asset_design_style || 'Unknown';
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || designCode : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || designCode : designCode)) : designCode;
      
      // Initialize VCS level
      if (!vcsGroups[vcs]) {
        vcsGroups[vcs] = {
          code: vcs,
          description: vcsDesc,
          allProperties: [],
          salesProperties: [],
          propertyCount: 0,
          salesCount: 0,
          totalPrice: 0,
          totalSizeAll: 0,
          totalSizeSales: 0,
          totalYearAll: 0,
          totalYearSales: 0,
          types: {},
          avgPrice: 0,
          avgSize: 0,
          avgSizeSales: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0,
          isBaseline: false
        };
      }
      
      // Add to VCS level
      vcsGroups[vcs].allProperties.push(p);
      vcsGroups[vcs].propertyCount++;
      vcsGroups[vcs].totalSizeAll += p.asset_sfla || 0;
      vcsGroups[vcs].totalYearAll += p.asset_year_built || 0;
      
      // Initialize Type level within VCS
      if (!vcsGroups[vcs].types[typeCode]) {
        vcsGroups[vcs].types[typeCode] = {
          code: typeCode,
          name: typeName,
          allProperties: [],
          salesProperties: [],
          propertyCount: 0,
          salesCount: 0,
          totalPrice: 0,
          totalSizeAll: 0,
          totalSizeSales: 0,
          totalYearAll: 0,
          totalYearSales: 0,
          designs: {},
          avgPrice: 0,
          avgSize: 0,
          avgSizeSales: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0,
          isBaseline: false
        };
      }
      
      // Add to Type level
      vcsGroups[vcs].types[typeCode].allProperties.push(p);
      vcsGroups[vcs].types[typeCode].propertyCount++;
      vcsGroups[vcs].types[typeCode].totalSizeAll += p.asset_sfla || 0;
      vcsGroups[vcs].types[typeCode].totalYearAll += p.asset_year_built || 0;
      
      // Initialize Design level within Type
      if (!vcsGroups[vcs].types[typeCode].designs[designCode]) {
        vcsGroups[vcs].types[typeCode].designs[designCode] = {
          code: designCode,
          name: designName,
          allProperties: [],
          salesProperties: [],
          propertyCount: 0,
          salesCount: 0,
          totalPrice: 0,
          avgPrice: 0,
          avgSize: 0,
          avgSizeSales: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0,
          isBaseline: false,
          totalSizeAll: 0,
          totalSizeSales: 0,
          totalYearAll: 0,
          totalYearSales: 0
        };
      }
      
      // Add to Design level
      vcsGroups[vcs].types[typeCode].designs[designCode].allProperties.push(p);
      vcsGroups[vcs].types[typeCode].designs[designCode].propertyCount++;
      vcsGroups[vcs].types[typeCode].designs[designCode].totalSizeAll += p.asset_sfla || 0;
      vcsGroups[vcs].types[typeCode].designs[designCode].totalYearAll += p.asset_year_built || 0;
      
      // If it's a valid sale, add to sales at all levels
      if (p.values_norm_time && p.values_norm_time > 0) {
        // VCS level sales
        vcsGroups[vcs].salesProperties.push(p);
        vcsGroups[vcs].salesCount++;
        vcsGroups[vcs].totalPrice += p.values_norm_time;
        vcsGroups[vcs].totalSizeSales += p.asset_sfla || 0;
        vcsGroups[vcs].totalYearSales += p.asset_year_built || 0;
        
        // Type level sales
        vcsGroups[vcs].types[typeCode].salesProperties.push(p);
        vcsGroups[vcs].types[typeCode].salesCount++;
        vcsGroups[vcs].types[typeCode].totalPrice += p.values_norm_time;
        vcsGroups[vcs].types[typeCode].totalSizeSales += p.asset_sfla || 0;
        vcsGroups[vcs].types[typeCode].totalYearSales += p.asset_year_built || 0;
        
        // Design level sales
        vcsGroups[vcs].types[typeCode].designs[designCode].salesProperties.push(p);
        vcsGroups[vcs].types[typeCode].designs[designCode].salesCount++;
        vcsGroups[vcs].types[typeCode].designs[designCode].totalPrice += p.values_norm_time;
        vcsGroups[vcs].types[typeCode].designs[designCode].totalSizeSales += p.asset_sfla || 0;
        vcsGroups[vcs].types[typeCode].designs[designCode].totalYearSales += p.asset_year_built || 0;
      }
    });
    
    // Calculate averages and adjusted prices at all levels
    Object.values(vcsGroups).forEach(vcsGroup => {
      // VCS level calculations - ALL properties
      vcsGroup.avgSizeAll = vcsGroup.propertyCount > 0 ? vcsGroup.totalSizeAll / vcsGroup.propertyCount : 0;
      vcsGroup.avgYearAll = vcsGroup.propertyCount > 0 ? Math.round(vcsGroup.totalYearAll / vcsGroup.propertyCount) : 0;
      
      // VCS level calculations - SALES only
      vcsGroup.avgPrice = vcsGroup.salesCount > 0 ? vcsGroup.totalPrice / vcsGroup.salesCount : 0;
      vcsGroup.avgSizeSales = vcsGroup.salesCount > 0 ? vcsGroup.totalSizeSales / vcsGroup.salesCount : 0;
      vcsGroup.avgYearSales = vcsGroup.salesCount > 0 ? Math.round(vcsGroup.totalYearSales / vcsGroup.salesCount) : 0;
      
      // Calculate VCS adjusted price
      let vcsTotalAdjusted = 0;
      if (vcsGroup.salesCount > 0) {
        vcsGroup.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            vcsGroup.avgSizeSales
          );
          vcsTotalAdjusted += adjusted;
        });
        vcsGroup.avgAdjustedPrice = vcsTotalAdjusted / vcsGroup.salesCount;
      } else {
        vcsGroup.avgAdjustedPrice = 0;
      }
      
      // Type level: Calculate averages first
      Object.values(vcsGroup.types).forEach(typeGroup => {
        typeGroup.avgSizeAll = typeGroup.propertyCount > 0 ? typeGroup.totalSizeAll / typeGroup.propertyCount : 0;
        typeGroup.avgYearAll = typeGroup.propertyCount > 0 ? Math.round(typeGroup.totalYearAll / typeGroup.propertyCount) : 0;

        typeGroup.avgPrice = typeGroup.salesCount > 0 ? typeGroup.totalPrice / typeGroup.salesCount : 0;
        typeGroup.avgSizeSales = typeGroup.salesCount > 0 ? typeGroup.totalSizeSales / typeGroup.salesCount : 0;
        typeGroup.avgYearSales = typeGroup.salesCount > 0 ? Math.round(typeGroup.totalYearSales / typeGroup.salesCount) : 0;
      });

      // Find baseline type (highest priced)
      let baselineType = null;
      let maxTypePrice = 0;
      Object.values(vcsGroup.types).forEach(typeGroup => {
        if (typeGroup.salesCount > 0 && typeGroup.avgPrice > maxTypePrice) {
          maxTypePrice = typeGroup.avgPrice;
          baselineType = typeGroup;
        }
      });

      // Calculate type adjusted prices using BASELINE type size
      Object.values(vcsGroup.types).forEach(typeGroup => {
        if (typeGroup.salesCount > 0 && baselineType) {
          let typeTotalAdjusted = 0;
          typeGroup.salesProperties.forEach(p => {
            const adjusted = calculateAdjustedPrice(
              (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
              p.asset_sfla || 0,
              baselineType.avgSizeSales  // Use BASELINE type size
            );
            typeTotalAdjusted += adjusted;
          });
          typeGroup.avgAdjustedPrice = typeTotalAdjusted / typeGroup.salesCount;
        } else {
          typeGroup.avgAdjustedPrice = 0;
        }
        
        // Design level: Calculate averages first
        Object.values(typeGroup.designs).forEach(designGroup => {
          designGroup.avgSizeAll = designGroup.propertyCount > 0 ? designGroup.totalSizeAll / designGroup.propertyCount : 0;
          designGroup.avgYearAll = designGroup.propertyCount > 0 ? Math.round(designGroup.totalYearAll / designGroup.propertyCount) : 0;

          designGroup.avgPrice = designGroup.salesCount > 0 ? designGroup.totalPrice / designGroup.salesCount : 0;
          designGroup.avgSizeSales = designGroup.salesCount > 0 ? designGroup.totalSizeSales / designGroup.salesCount : 0;
          designGroup.avgYearSales = designGroup.salesCount > 0 ? Math.round(designGroup.totalYearSales / designGroup.salesCount) : 0;
        });

        // Find baseline design (highest priced)
        let baselineDesign = null;
        let maxDesignPrice = 0;
        Object.values(typeGroup.designs).forEach(designGroup => {
          if (designGroup.salesCount > 0 && designGroup.avgPrice > maxDesignPrice) {
            maxDesignPrice = designGroup.avgPrice;
            baselineDesign = designGroup;
          }
        });

        // Calculate design adjusted prices using BASELINE design size
        Object.values(typeGroup.designs).forEach(designGroup => {
          if (designGroup.salesCount > 0 && baselineDesign) {
            let designTotalAdjusted = 0;
            designGroup.salesProperties.forEach(p => {
              const adjusted = calculateAdjustedPrice(
                (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
                p.asset_sfla || 0,
                baselineDesign.avgSizeSales  // Use BASELINE design size
              );
              designTotalAdjusted += adjusted;
            });
            designGroup.avgAdjustedPrice = designTotalAdjusted / designGroup.salesCount;
          } else {
            designGroup.avgAdjustedPrice = 0;
          }
        });
        
        // Calculate design deltas within type
        // Delta is calculated as: (Current Adj Price - Baseline Sale Price) / Baseline Sale Price
        Object.values(typeGroup.designs).forEach(designGroup => {
          if (baselineDesign && designGroup !== baselineDesign && designGroup.salesCount > 0) {
            designGroup.deltaPercent = baselineDesign.avgPrice > 0 ?
              ((designGroup.avgAdjustedPrice - baselineDesign.avgPrice) / baselineDesign.avgPrice * 100) : 0;
          } else {
            designGroup.deltaPercent = 0;
          }
          designGroup.isBaseline = (designGroup === baselineDesign);
        });
        
        typeGroup.baselineDesign = baselineDesign;
      });
      
      // Calculate type deltas within VCS
      // Delta is calculated as: (Current Adj Price - Baseline Sale Price) / Baseline Sale Price
      Object.values(vcsGroup.types).forEach(typeGroup => {
        if (baselineType && typeGroup !== baselineType && typeGroup.salesCount > 0) {
          typeGroup.deltaPercent = baselineType.avgPrice > 0 ?
            ((typeGroup.avgAdjustedPrice - baselineType.avgPrice) / baselineType.avgPrice * 100) : 0;
        } else {
          typeGroup.deltaPercent = 0;
        }
        typeGroup.isBaseline = (typeGroup === baselineType);
      });
      
      vcsGroup.baselineType = baselineType;
    });
    
    return vcsGroups;
  }, [filteredProperties, codeDefinitions, vendorType]);
  // Condo Analysis Functions
  const analyzeCondos = useCallback(() => {
    const condos = filteredProperties.filter(p => {
      const typeCode = p.asset_type_use;
      return typeCode && typeCode.toString().startsWith('6');
    });

    if (condos.length === 0) return null;

    // Design Analysis - ONLY VALID SALES
    const designGroups = {};
    condos.forEach(p => {
      const designCode = p.asset_design_style || 'Unknown';
      // Use only synchronous Microsystems decoding to avoid async rendering issues
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || designCode : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || designCode : designCode)) : designCode;

      // Skip unknown/empty designs
      if (!designCode || designCode === 'Unknown' || designCode === '' ||
          designName === 'Unknown' || designName === '') {
        return;
      }

      // Get time-normalized price (prefer PMA lookup, fallback to property field)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);

      // Skip if no valid sale price
      if (!timePrice) return;

      const key = `${designCode}-${designName}`;

      if (!designGroups[key]) {
        designGroups[key] = {
          code: designCode,
          name: designName,
          properties: [],
          totalPrice: 0,
          totalSize: 0,
          count: 0,
          avgPrice: 0,
          avgSize: 0,
          avgAdjustedPrice: 0,
          deltaPercent: 0
        };
      }

      designGroups[key].properties.push({ ...p, _time_normalized_price: timePrice });
      designGroups[key].count++;
      designGroups[key].totalPrice += timePrice;
      designGroups[key].totalSize += p.asset_sfla || 0;
    });

    // Calculate averages first
    Object.values(designGroups).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
      group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
    });

    // Calculate OVERALL average size and price across ALL designs (instead of baseline)
    let overallTotalPrice = 0;
    let overallTotalSize = 0;
    let overallCount = 0;
    Object.values(designGroups).forEach(group => {
      overallTotalPrice += group.totalPrice;
      overallTotalSize += group.totalSize;
      overallCount += group.count;
    });
    const overallAvgPrice = overallCount > 0 ? overallTotalPrice / overallCount : 0;
    const overallAvgSize = overallCount > 0 ? overallTotalSize / overallCount : 0;

    // Calculate adjusted prices using OVERALL AVERAGE size
    Object.values(designGroups).forEach(group => {
      if (group.count > 0 && overallAvgSize > 0) {
        let totalAdjusted = 0;
        group.properties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            p._time_normalized_price,  // Always valid due to filtering above
            p.asset_sfla || 0,
            overallAvgSize  // Use OVERALL AVERAGE size
          );
          totalAdjusted += adjusted;
        });
        group.avgAdjustedPrice = totalAdjusted / group.count;
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Calculate design deltas
    // Delta is calculated as: (Current Adj Price - Overall Avg Price) / Overall Avg Price
    Object.values(designGroups).forEach(group => {
      if (overallAvgPrice > 0) {
        group.deltaPercent = ((group.avgAdjustedPrice - overallAvgPrice) / overallAvgPrice * 100);
      } else {
        group.deltaPercent = 0;
      }
    });

    // End vs Interior Analysis (NEW) - ONLY VALID SALES
    const endIntGroups = {};
    condos.forEach(p => {
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : p.asset_design_style || '')) : p.asset_design_style || '';
      const designUpper = String(designName).toUpperCase();

      let unitType = 'Unknown';
      if (designUpper.includes('END')) unitType = 'End Unit';
      else if (designUpper.includes('INT')) unitType = 'Interior Unit';

      // Skip unknown types
      if (unitType === 'Unknown') return;

      // Get time-normalized price (prefer PMA lookup, fallback to property field)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);

      // Skip if no valid sale price
      if (!timePrice) return;

      if (!endIntGroups[vcs]) {
        endIntGroups[vcs] = {
          code: vcs,
          endUnits: { properties: [], totalPrice: 0, totalSize: 0, count: 0, avgPrice: 0, avgSize: 0, avgAdjustedPrice: 0 },
          interiorUnits: { properties: [], totalPrice: 0, totalSize: 0, count: 0, avgPrice: 0, avgSize: 0, avgAdjustedPrice: 0 },
          deltaPercent: 0
        };
      }

      const targetGroup = unitType === 'End Unit' ? endIntGroups[vcs].endUnits : endIntGroups[vcs].interiorUnits;
      targetGroup.properties.push({ ...p, _time_normalized_price: timePrice });
      targetGroup.count++;
      targetGroup.totalPrice += timePrice;
      targetGroup.totalSize += p.asset_sfla || 0;
    });

    // Calculate End/Int averages and adjusted prices
    Object.values(endIntGroups).forEach(vcsGroup => {
      ['endUnits', 'interiorUnits'].forEach(key => {
        const group = vcsGroup[key];
        group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
        group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
      });

      // Use interior unit size as baseline for adjustment (interior is typically more common)
      const baselineSize = vcsGroup.interiorUnits.avgSize > 0 ? vcsGroup.interiorUnits.avgSize : vcsGroup.endUnits.avgSize;

      ['endUnits', 'interiorUnits'].forEach(key => {
        const group = vcsGroup[key];
        if (group.count > 0 && baselineSize > 0) {
          let totalAdjusted = 0;
          group.properties.forEach(p => {
            const adjusted = calculateAdjustedPrice(
              p._time_normalized_price,  // Always valid due to filtering above
              p.asset_sfla || 0,
              baselineSize
            );
            totalAdjusted += adjusted;
          });
          group.avgAdjustedPrice = totalAdjusted / group.count;
        } else {
          group.avgAdjustedPrice = 0;
        }
      });

      // Calculate delta (End vs Interior)
      if (vcsGroup.interiorUnits.avgPrice > 0 && vcsGroup.endUnits.avgAdjustedPrice > 0) {
        vcsGroup.deltaPercent = ((vcsGroup.endUnits.avgAdjustedPrice - vcsGroup.interiorUnits.avgPrice) / vcsGroup.interiorUnits.avgPrice * 100);
        vcsGroup.deltaCurrency = vcsGroup.endUnits.avgAdjustedPrice - vcsGroup.interiorUnits.avgPrice;
      } else {
        vcsGroup.deltaPercent = 0;
        vcsGroup.deltaCurrency = 0;
      }
    });

    // VCS Bedroom Analysis
    const vcsBedroomGroups = {};
    condos.forEach(p => {
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';
      // Use raw VCS code to avoid async rendering issues
      const vcsDesc = vcs;

      // Look for bedroom info in design description - use only synchronous decoding
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : p.asset_design_style || '')) : p.asset_design_style || '';
      let bedrooms = 'Unknown';

      // 1) Try design-name hints
      const designUpper = String(designName).toUpperCase();
      if (designUpper.includes('1BED') || designUpper.includes('1 BED')) bedrooms = '1BED';
      else if (designUpper.includes('2BED') || designUpper.includes('2 BED')) bedrooms = '2BED';
      else if (designUpper.includes('3BED') || designUpper.includes('3 BED')) bedrooms = '3BED';
      else if (designUpper.includes('STUDIO')) bedrooms = 'STUDIO';

      // 2) Synchronous property field fallbacks (common fields)
      // Use direct column access (populated by processors/updaters)
      if (bedrooms === 'Unknown') {
        const n = parseInt(p.asset_bedrooms);
        if (!isNaN(n)) {
          if (n === 0) bedrooms = 'STUDIO';
          else bedrooms = `${n}BED`;
        }
      }

      // 3) Check inferred cache (populated by async BEDTOT lookup for BRT)
      if (bedrooms === 'Unknown' && inferredBedroomsRef.current && inferredBedroomsRef.current[p.id]) {
        bedrooms = inferredBedroomsRef.current[p.id];
      }

      if (!vcsBedroomGroups[vcs]) {
        vcsBedroomGroups[vcs] = {
          code: vcs,
          description: vcsDesc,
          bedrooms: {}
        };
      }
      
      if (!vcsBedroomGroups[vcs].bedrooms[bedrooms]) {
        vcsBedroomGroups[vcs].bedrooms[bedrooms] = {
          label: bedrooms,
          properties: [],
          salesProperties: [],
          totalPrice: 0,
          totalSize: 0,
          totalSizeSales: 0,
          propertiesCount: 0,
          salesCount: 0,
          avgPrice: 0,
          avgSize: 0,
          avgAdjustedPrice: 0,
          delta: 0,
          deltaPercent: 0
        };
      }

      const bedroomGroup = vcsBedroomGroups[vcs].bedrooms[bedrooms];
      bedroomGroup.properties.push(p);
      bedroomGroup.propertiesCount++;
      bedroomGroup.totalSize += p.asset_sfla || 0;

      // If this property has a normalized sale, count it as a sale
      // (prefer PMA lookup, fallback to property field)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);

      if (timePrice) {
        bedroomGroup.salesProperties.push({ ...p, _time_normalized_price: timePrice });
        bedroomGroup.salesCount++;
        bedroomGroup.totalPrice += timePrice;
        bedroomGroup.totalSizeSales += p.asset_sfla || 0;
      }
    });

    // Ensure standard bedroom types exist (show 0 sales when missing)
    const standardBeds = ['STUDIO','1BED','2BED','3BED','4BED'];
    Object.values(vcsBedroomGroups).forEach(vcsGroup => {
      standardBeds.forEach(lbl => {
        if (!vcsGroup.bedrooms[lbl]) {
          vcsGroup.bedrooms[lbl] = {
            label: lbl,
            properties: [],
            salesProperties: [],
            totalPrice: 0,
            totalSize: 0,
            totalSizeSales: 0,
            propertiesCount: 0,
            salesCount: 0
          };
        }
      });
    });

    // Calculate bedroom averages using VCS-level sales average size for adjustments (drop per-bedroom baseline)
    Object.values(vcsBedroomGroups).forEach(vcsGroup => {
      // Compute VCS-level sales avg size (ignore zero sizes)
      const vcsSalesCount = vcsGroup.salesCount || 0;
      const vcsAvgSizeSales = (vcsSalesCount > 0 && vcsGroup.totalSizeSales > 0) ? (vcsGroup.totalSizeSales / vcsSalesCount) : 0;

      // Track totals to compute VCS avg adjusted price
      let vcsTotalAdjusted = 0;
      let vcsTotalSalesForAdjusted = 0;

      Object.values(vcsGroup.bedrooms).forEach(bedroomGroup => {
        // Avg price based only on sales
        bedroomGroup.avgPrice = bedroomGroup.salesCount > 0 ? bedroomGroup.totalPrice / bedroomGroup.salesCount : 0;
        // Avg size based on inventory (properties)
        bedroomGroup.avgSize = bedroomGroup.propertiesCount > 0 ? bedroomGroup.totalSize / bedroomGroup.propertiesCount : 0;

        // Determine baseline size to use for adjustments: prefer VCS-level sales avg (if valid), otherwise bedroom-level avgSize
        const baselineSizeToUse = (vcsAvgSizeSales > 0) ? vcsAvgSizeSales : bedroomGroup.avgSize || 0;

        // Calculate adjusted prices using only salesProperties
        let totalAdjusted = 0;
        bedroomGroup.salesProperties.forEach(p => {
          // Skip sales with invalid size
          const propSize = p.asset_sfla || 0;
          if (!propSize) return;

          const adjusted = calculateAdjustedPrice(
            p._time_normalized_price,  // Always valid due to filtering above
            propSize,
            baselineSizeToUse
          );
          totalAdjusted += adjusted;
        });

        bedroomGroup.avgAdjustedPrice = bedroomGroup.salesCount > 0 ? (totalAdjusted / bedroomGroup.salesCount) : 0;

        // Accumulate for VCS-level average (only include bedrooms with sales)
        if (bedroomGroup.salesCount > 0) {
          vcsTotalAdjusted += totalAdjusted;
          vcsTotalSalesForAdjusted += bedroomGroup.salesCount;
        }
      });

      // Compute VCS average adjusted price (used as the comparison baseline for deltas)
      vcsGroup.avgAdjustedPrice = vcsTotalSalesForAdjusted > 0 ? (vcsTotalAdjusted / vcsTotalSalesForAdjusted) : 0;

      // Calculate deltas between adjacent bedroom groups that have sales (ascending bed count)
      const bedOrderValue = (label) => {
        if (!label) return 999;
        if (label === 'STUDIO') return 0;
        const m = label.match(/^(\d+)BED$/);
        if (m) return parseInt(m[1], 10);
        return 999;
      };

      const sortedLabels = Object.keys(vcsGroup.bedrooms).sort((a, b) => bedOrderValue(a) - bedOrderValue(b));
      const sortedGroups = sortedLabels.map(lbl => vcsGroup.bedrooms[lbl]);

      // Filter groups with valid sales and adjusted price
      const soldGroups = sortedGroups.filter(g => g.salesCount > 0 && g.avgAdjustedPrice > 0);

      // Assign deltas: lowest sold group has no delta, subsequent sold groups compare to previous sold group
      for (let i = 0; i < sortedGroups.length; i++) {
        const group = sortedGroups[i];
        // Default
        group.delta = 0;
        group.deltaPercent = 0;
      }

      for (let i = 0; i < soldGroups.length; i++) {
        const group = soldGroups[i];
        if (i === 0) {
          // Lowest bed with sales — no delta
          group.delta = 0;
          group.deltaPercent = 0;
        } else {
          const prev = soldGroups[i - 1];
          const deltaVal = group.avgAdjustedPrice - prev.avgAdjustedPrice;
          const deltaPct = prev.avgAdjustedPrice > 0 ? (deltaVal / prev.avgAdjustedPrice * 100) : 0;
          group.delta = deltaVal;
          group.deltaPercent = deltaPct;
        }
      }

      // Ensure groups with no sales keep delta as 0
      sortedGroups.forEach(g => {
        if (!g.salesCount || g.salesCount === 0) {
          g.delta = 0;
          g.deltaPercent = 0;
        }
      });

      // Explicitly clear baseline to avoid UI highlighting confusion
      vcsGroup.baseline = null;
    });

    // Floor Analysis - VCS BREAKDOWN (like bedroom analysis)
    const vcsFloorGroups = {};
    condos.forEach(p => {
      // DECODE story height CODE using code interpreter (e.g., code "10" → "CONDO 1ST STY")
      const storyHeightCode = p.asset_story_height;
      let storyHeightDecoded = '';

      if (storyHeightCode && codeDefinitions) {
        // Create a temp property with string version for interpreter (expects strings)
        const pWithStringCode = { ...p, asset_story_height: String(storyHeightCode) };

        if (vendorType === 'BRT') {
          // BRT: Look up in section 22 (story height section)
          storyHeightDecoded = interpretCodes.getBRTValue?.(pWithStringCode, codeDefinitions, 'asset_story_height') || '';
        } else if (vendorType === 'Microsystems') {
          // Microsystems: Use 510 prefix for story height
          storyHeightDecoded = interpretCodes.getMicrosystemsValue?.(pWithStringCode, codeDefinitions, 'asset_story_height') || '';
        }
      }

      // Convert to uppercase for pattern matching
      const storyStr = String(storyHeightDecoded).toUpperCase();

      // DEBUG: Log first few decodings to see what we're getting
      if (condos.indexOf(p) < 5) {
        console.log('Floor Debug:', {
          code: storyHeightCode,
          decoded: storyHeightDecoded,
          upper: storyStr,
          hasCondo: storyStr.includes('CONDO'),
          vendorType
        });
      }

      // REQUIREMENT: Only process if "CONDO" appears in the decoded story height
      if (!storyStr.includes('CONDO')) return;

      // Parse floor level from the CONDO description
      let floor = 'Unknown';
      if (storyStr.includes('1ST')) floor = '1ST FLOOR';
      else if (storyStr.includes('2ND')) floor = '2ND FLOOR';
      else if (storyStr.includes('3RD')) floor = '3RD FLOOR';
      else if (storyStr.includes('4TH')) floor = '4TH FLOOR';
      else if (storyStr.includes('5TH')) floor = '5TH FLOOR';
      else if (storyStr.includes('TOP')) floor = 'TOP FLOOR';
      else if (storyStr.includes('PENT') || storyStr.includes('PHSE') || storyStr.includes('PENTHOUSE')) floor = 'PENTHOUSE';

      // Get time-normalized price (prefer PMA lookup, fallback to property field)
      const keyForLookup = p.property_composite_key;
      const timeNormFromPMA = timeNormalizedLookup.get(keyForLookup);
      const timePrice = (timeNormFromPMA && timeNormFromPMA > 0) ? timeNormFromPMA : (p.values_norm_time && p.values_norm_time > 0 ? p.values_norm_time : null);

      // Skip if no valid sale price
      if (!timePrice) return;

      // Group by VCS
      const vcs = p.new_vcs || p.property_vcs || 'Unknown';

      if (!vcsFloorGroups[vcs]) {
        vcsFloorGroups[vcs] = {
          code: vcs,
          floors: {}
        };
      }

      if (!vcsFloorGroups[vcs].floors[floor]) {
        vcsFloorGroups[vcs].floors[floor] = {
          label: floor,
          properties: [],
          totalPrice: 0,
          totalSize: 0,
          count: 0,
          avgPrice: 0,
          avgSize: 0,
          avgAdjustedPrice: 0,
          deltaPercent: 0,
          deltaCurrency: 0,
          isBaseline: false
        };
      }

      const floorGroup = vcsFloorGroups[vcs].floors[floor];
      floorGroup.properties.push({ ...p, _time_normalized_price: timePrice });
      floorGroup.count++;
      floorGroup.totalPrice += timePrice;
      floorGroup.totalSize += p.asset_sfla || 0;
    });

    // Calculate VCS floor averages and adjusted prices
    Object.values(vcsFloorGroups).forEach(vcsGroup => {
      // Calculate averages for each floor in this VCS
      Object.values(vcsGroup.floors).forEach(floorGroup => {
        floorGroup.avgPrice = floorGroup.count > 0 ? floorGroup.totalPrice / floorGroup.count : 0;
        floorGroup.avgSize = floorGroup.count > 0 ? floorGroup.totalSize / floorGroup.count : 0;
      });

      // Identify baseline (1st floor) for this VCS
      const firstFloor = vcsGroup.floors['1ST FLOOR'];

      if (firstFloor) {
        // Calculate adjusted prices using 1ST FLOOR size as baseline
        Object.values(vcsGroup.floors).forEach(floorGroup => {
          if (floorGroup.count > 0) {
            let totalAdjusted = 0;
            floorGroup.properties.forEach(p => {
              const adjusted = calculateAdjustedPrice(
                p._time_normalized_price,
                p.asset_sfla || 0,
                firstFloor.avgSize
              );
              totalAdjusted += adjusted;
            });
            floorGroup.avgAdjustedPrice = totalAdjusted / floorGroup.count;
          } else {
            floorGroup.avgAdjustedPrice = 0;
          }
        });

        // Calculate deltas (vs 1st floor baseline)
        Object.values(vcsGroup.floors).forEach(floorGroup => {
          if (floorGroup !== firstFloor && firstFloor.avgPrice > 0) {
            floorGroup.deltaPercent = ((floorGroup.avgAdjustedPrice - firstFloor.avgPrice) / firstFloor.avgPrice * 100);
            floorGroup.deltaCurrency = floorGroup.avgAdjustedPrice - firstFloor.avgPrice;
          } else {
            floorGroup.deltaPercent = 0;
            floorGroup.deltaCurrency = 0;
          }
          floorGroup.isBaseline = (floorGroup === firstFloor);
        });
      }
    });

    // Calculate incremental floor-to-floor premium summary across all VCS
    // Build ordered list of all unique floor levels across all VCS
    const allFloorNames = new Set();
    Object.values(vcsFloorGroups).forEach(vcsGroup => {
      Object.keys(vcsGroup.floors).forEach(floorName => {
        allFloorNames.add(floorName);
      });
    });

    // Sort floor names by typical order
    const floorOrder = ['1ST FLOOR', '2ND FLOOR', '3RD FLOOR', '4TH FLOOR', '5TH FLOOR',
                       '6TH FLOOR', '7TH FLOOR', '8TH FLOOR', '9TH FLOOR', '10TH FLOOR',
                       '11TH FLOOR', '12TH FLOOR', '13TH FLOOR', '14TH FLOOR', '15TH FLOOR',
                       '16TH FLOOR', '17TH FLOOR', '18TH FLOOR', '19TH FLOOR', '20TH FLOOR',
                       '21ST FLOOR', '22ND FLOOR', '23RD FLOOR', '24TH FLOOR', '25TH FLOOR',
                       '26TH FLOOR', '27TH FLOOR', '28TH FLOOR', '29TH FLOOR', '30TH FLOOR',
                       '31ST FLOOR', '32ND FLOOR', '33RD FLOOR', '34TH FLOOR', '35TH FLOOR',
                       '36TH FLOOR', '37TH FLOOR', '38TH FLOOR', '39TH FLOOR', '40TH FLOOR',
                       'TOP FLOOR', 'PENTHOUSE'];

    const sortedFloors = Array.from(allFloorNames).sort((a, b) => {
      const aIndex = floorOrder.indexOf(a);
      const bIndex = floorOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    // Calculate incremental floor-to-floor premiums (each floor vs previous floor)
    const floorSummary = {};

    for (let i = 1; i < sortedFloors.length; i++) {
      const prevFloor = sortedFloors[i - 1];
      const currFloor = sortedFloors[i];
      const key = `${prevFloor}_to_${currFloor}`;

      floorSummary[key] = {
        fromFloor: prevFloor,
        toFloor: currFloor,
        count: 0,
        avgDelta: 0,
        avgDeltaPct: 0,
        hasData: false
      };

      // Aggregate across all VCS groups that have both floors
      Object.values(vcsFloorGroups).forEach(vcsGroup => {
        const prevFloorData = vcsGroup.floors[prevFloor];
        const currFloorData = vcsGroup.floors[currFloor];

        if (prevFloorData?.avgAdjustedPrice > 0 && currFloorData?.avgAdjustedPrice > 0) {
          const delta = currFloorData.avgAdjustedPrice - prevFloorData.avgAdjustedPrice;
          const deltaPct = (delta / prevFloorData.avgAdjustedPrice) * 100;

          floorSummary[key].avgDelta += delta;
          floorSummary[key].avgDeltaPct += deltaPct;
          floorSummary[key].count++;
          floorSummary[key].hasData = true;
        }
      });

      // Calculate averages
      if (floorSummary[key].count > 0) {
        floorSummary[key].avgDelta = floorSummary[key].avgDelta / floorSummary[key].count;
        floorSummary[key].avgDeltaPct = floorSummary[key].avgDeltaPct / floorSummary[key].count;
      }
    }

    // Calculate bedroom summary across all VCS
    const bedroomSummary = {
      studioTo1Bed: { count: 0, avgDelta: 0, avgDeltaPct: 0, hasData: false },
      oneBedTo2Bed: { count: 0, avgDelta: 0, avgDeltaPct: 0, hasData: false },
      twoBedTo3Bed: { count: 0, avgDelta: 0, avgDeltaPct: 0, hasData: false },
      threeBedTo4Bed: { count: 0, avgDelta: 0, avgDeltaPct: 0, hasData: false }
    };

    Object.values(vcsBedroomGroups).forEach(vcsGroup => {
      const beds = vcsGroup.bedrooms;

      // Studio to 1 Bed
      if (beds['STUDIO']?.avgAdjustedPrice > 0 && beds['1BED']?.avgAdjustedPrice > 0) {
        const delta = beds['1BED'].avgAdjustedPrice - beds['STUDIO'].avgAdjustedPrice;
        const deltaPct = (delta / beds['STUDIO'].avgAdjustedPrice) * 100;
        bedroomSummary.studioTo1Bed.avgDelta += delta;
        bedroomSummary.studioTo1Bed.avgDeltaPct += deltaPct;
        bedroomSummary.studioTo1Bed.count++;
        bedroomSummary.studioTo1Bed.hasData = true;
      }

      // 1 Bed to 2 Bed
      if (beds['1BED']?.avgAdjustedPrice > 0 && beds['2BED']?.avgAdjustedPrice > 0) {
        const delta = beds['2BED'].avgAdjustedPrice - beds['1BED'].avgAdjustedPrice;
        const deltaPct = (delta / beds['1BED'].avgAdjustedPrice) * 100;
        bedroomSummary.oneBedTo2Bed.avgDelta += delta;
        bedroomSummary.oneBedTo2Bed.avgDeltaPct += deltaPct;
        bedroomSummary.oneBedTo2Bed.count++;
        bedroomSummary.oneBedTo2Bed.hasData = true;
      }

      // 2 Bed to 3 Bed
      if (beds['2BED']?.avgAdjustedPrice > 0 && beds['3BED']?.avgAdjustedPrice > 0) {
        const delta = beds['3BED'].avgAdjustedPrice - beds['2BED'].avgAdjustedPrice;
        const deltaPct = (delta / beds['2BED'].avgAdjustedPrice) * 100;
        bedroomSummary.twoBedTo3Bed.avgDelta += delta;
        bedroomSummary.twoBedTo3Bed.avgDeltaPct += deltaPct;
        bedroomSummary.twoBedTo3Bed.count++;
        bedroomSummary.twoBedTo3Bed.hasData = true;
      }

      // 3 Bed to 4 Bed
      if (beds['3BED']?.avgAdjustedPrice > 0 && beds['4BED']?.avgAdjustedPrice > 0) {
        const delta = beds['4BED'].avgAdjustedPrice - beds['3BED'].avgAdjustedPrice;
        const deltaPct = (delta / beds['3BED'].avgAdjustedPrice) * 100;
        bedroomSummary.threeBedTo4Bed.avgDelta += delta;
        bedroomSummary.threeBedTo4Bed.avgDeltaPct += deltaPct;
        bedroomSummary.threeBedTo4Bed.count++;
        bedroomSummary.threeBedTo4Bed.hasData = true;
      }
    });

    // Calculate averages
    Object.values(bedroomSummary).forEach(summary => {
      if (summary.count > 0) {
        summary.avgDelta = summary.avgDelta / summary.count;
        summary.avgDeltaPct = summary.avgDeltaPct / summary.count;
      }
    });

    return {
      totalCondos: condos.length,
      designGroups: Object.values(designGroups),
      overallAvgPrice,
      overallAvgSize,
      vcsBedroomGroups,
      bedroomSummary,
      endIntGroups,
      vcsFloorGroups,
      floorSummary
    };
  }, [filteredProperties, codeDefinitions, vendorType]);
  // ==================== MAIN ANALYSIS ====================
  const [analysis, setAnalysis] = useState(null);

  const runAnalysis = useCallback(async (options = { skipBedroomEnrichment: false }) => {
    setIsProcessing(true);

    try {
      const typeUseAnalysis = analyzeTypeUse();
      const designAnalysis = analyzeDesign();
      const yearBuiltAnalysis = analyzeYearBuilt();
      const vcsTypeAnalysis = analyzeVCSByType();
      const condoAnalysis = analyzeCondos();

      const results = {
        typeUse: typeUseAnalysis,
        design: designAnalysis,
        yearBuilt: yearBuiltAnalysis,
        vcsType: vcsTypeAnalysis,
        condo: condoAnalysis,
        timestamp: new Date().toISOString()
      };

      setAnalysis(results);
      setLastProcessed(new Date());

      // Notify parent of changes
      onDataChange();

      // If BRT, attempt async BEDTOT enrichment for Unknown bedrooms (once)
      try {
        if (!options.skipBedroomEnrichment && vendorType === 'BRT' && filteredProperties.length > 0) {
          // Find condo properties that are 'Unknown' by current logic
          const condosList = filteredProperties.filter(p => (p.asset_type_use || '').toString().startsWith('6'));
          const needsLookup = [];
          condosList.forEach(p => {
            // Re-run small sync detection to see if still unknown
            const designName = codeDefinitions ? (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : p.asset_design_style || '') : p.asset_design_style || '';
            let bedrooms = 'Unknown';
            const designUpper = String(designName).toUpperCase();
            if (designUpper.includes('1BED') || designUpper.includes('1 BED')) bedrooms = '1BED';
            else if (designUpper.includes('2BED') || designUpper.includes('2 BED')) bedrooms = '2BED';
            else if (designUpper.includes('3BED') || designUpper.includes('3 BED')) bedrooms = '3BED';
            else if (designUpper.includes('STUDIO')) bedrooms = 'STUDIO';

            // Use direct column access (populated by processors/updaters)
            const n = parseInt(p.asset_bedrooms);
            if (!isNaN(n)) {
              bedrooms = n === 0 ? 'STUDIO' : `${n}BED`;
            }

            if (bedrooms === 'Unknown' && !inferredBedroomsRef.current[p.id]) {
              needsLookup.push(p);
            }
          });

          if (needsLookup.length > 0) {
            let changed = false;
            // Batch lookups sequentially to avoid DB overload
            for (const prop of needsLookup) {
              try {
                const raw = await interpretCodes.getRawDataValue?.(prop, 'bedrooms', vendorType);
                const n = parseInt(raw);
                if (!isNaN(n)) {
                  const label = n === 0 ? 'STUDIO' : `${n}BED`;
                  inferredBedroomsRef.current[prop.id] = label;
                  changed = true;
                }
              } catch (e) {
                // ignore individual failures
              }
            }

            if (changed) {
              // Re-run analysis once with enrichment applied, skip further enrichment to avoid loops
              await runAnalysis({ skipBedroomEnrichment: true });
            }
          }
        }
      } catch (e) {
        console.warn('Bedroom enrichment failed:', e);
      }

    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [analyzeTypeUse, analyzeDesign, analyzeYearBuilt, analyzeVCSByType, analyzeCondos, onDataChange, filteredProperties, vendorType, codeDefinitions]);

  // Run analysis on mount and when properties change
  useEffect(() => {
    if (filteredProperties.length > 0) {
      runAnalysis();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProperties.length]); // Only re-run when count changes

  // ==================== EXPORT FUNCTIONS ====================
  
  const exportToCSV = (analysisType) => {
    if (!analysis) return;
    
    let csv = '';
    const timestamp = new Date().toISOString().split('T')[0];
    
    switch(analysisType) {
      case 'typeUse':
        csv = 'TYPE AND USE ANALYSIS\n';
        csv += 'DESCRIPTION,TOTAL PROPERTIES,AVG YEAR (ALL),AVG SIZE (ALL),TOTAL SALES,AVG YEAR (SALES),AVG SIZE (SALES),SALE PRICE,ADJ PRICE,DELTA,CME BRACKET\n';
        analysis.typeUse.groups.forEach(group => {
          const yearAll = group.avgYearAll || '';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '';
          const yearSales = group.avgYearSales || '';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '' : 'BASELINE';
          const cmeBracket = group.cmeBracket ? group.cmeBracket.label : '';
          
          csv += `"${group.code} - ${group.name}",${group.propertyCount},${yearAll},${sizeAll},${group.salesCount},${yearSales},${sizeSales},${salePrice},${adjPrice},${delta},"${cmeBracket}"\n`;
        });
        break;
        
      case 'design':
        csv = 'DESIGN AND STYLE ANALYSIS\n';
        csv += 'DESCRIPTION,TOTAL PROPERTIES,AVG YEAR (ALL),AVG SIZE (ALL),TOTAL SALES,AVG YEAR (SALES),AVG SIZE (SALES),SALE PRICE,ADJ PRICE,DELTA\n';
        analysis.design.groups.forEach(group => {
          const yearAll = group.avgYearAll || '';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '';
          const yearSales = group.avgYearSales || '';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '��';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '' : 'BASELINE';
          
          csv += `"${group.name}",${group.propertyCount},${yearAll},${sizeAll},${group.salesCount},${yearSales},${sizeSales},${salePrice},${adjPrice},${delta}\n`;
        });
        break;
        
      case 'yearBuilt':
        csv = 'YEAR BUILT ANALYSIS\n';
        csv += 'CATEGORY,TOTAL PROPERTIES,AVG YEAR (ALL),AVG SIZE (ALL),TOTAL SALES,AVG YEAR (SALES),AVG SIZE (SALES),SALE PRICE,ADJ PRICE,DELTA,CCF\n';
        analysis.yearBuilt.groups.forEach(group => {
          const yearAll = group.avgYearAll || '';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '';
          const yearSales = group.avgYearSales || '';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '' : 'BASELINE';
          
          csv += `"${group.label}",${group.propertyCount},${yearAll},${sizeAll},${group.salesCount},${yearSales},${sizeSales},${salePrice},${adjPrice},${delta},${group.isCCF ? 'YES' : ''}\n`;
        });
        break;
        
      case 'all':
        // Export everything
        csv = exportToCSV('typeUse') + '\n\n' + exportToCSV('design') + '\n\n' + exportToCSV('yearBuilt');
        break;
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overall_analysis_${analysisType}_${timestamp}.csv`;
    a.click();
  };

  const exportToExcel = (sectionType = 'all') => {
    if (!analysis) return;

    console.log('[Export] Starting export...', sectionType);
    const startTime = Date.now();

    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().split('T')[0];

    // Base style for all cells
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Header style (bold, no fill)
    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Helper function to apply formulas to worksheet
    const applyFormulas = (ws, range, headers, options = {}) => {
      const { formulaColumns = [] } = options;

      // Identify delta columns for percentage formatting
      const deltaColumnIndices = headers.map((h, i) => {
        const headerLower = h.toLowerCase();
        return (headerLower.includes('delta') || headerLower === 'delta %') ? i : -1;
      }).filter(i => i !== -1);

      // Apply formulas for specified columns
      formulaColumns.forEach(({ column, getFormula }) => {
        const colIndex = headers.indexOf(column);
        if (colIndex === -1) return;

        const maxRows = Math.min(range.e.r, range.s.r + 10000); // Safety limit: max 10000 rows
        for (let R = range.s.r + 1; R <= maxRows; ++R) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: colIndex });
          const formula = getFormula(R, colIndex, headers, ws);

          if (formula && ws[cellAddress]) {
            const cellStyle = ws[cellAddress].s || baseStyle;
            // Apply percentage format if this is a delta column
            if (deltaColumnIndices.includes(colIndex)) {
              cellStyle.numFmt = '0%';
            }
            ws[cellAddress] = {
              f: formula,
              t: 'n',
              s: cellStyle
            };
          }
        }
      });
    };

    // Helper function to create and format worksheet
    const createFormattedSheet = (headers, data, options = {}) => {
      const {
        colorColumnIndex = -1,
        priceColumns = [],
        colorColumns = [],
        formulaColumns = []
      } = options;

      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      const range = XLSX.utils.decode_range(ws['!ref']);

      // Identify price columns by header names if not explicitly provided
      const priceColumnIndices = priceColumns.length > 0 ? priceColumns :
        headers.map((h, i) => {
          const headerLower = h.toLowerCase();
          return (headerLower.includes('price') || headerLower.includes('adj')) ? i : -1;
        }).filter(i => i !== -1);

      // Identify delta/percentage columns
      const deltaColumnIndices = headers.map((h, i) => {
        const headerLower = h.toLowerCase();
        return (headerLower.includes('delta') || headerLower === 'delta %') ? i : -1;
      }).filter(i => i !== -1);

      // Color columns to apply background fill
      const colorColumnsToApply = colorColumns.length > 0 ? colorColumns :
        (colorColumnIndex >= 0 ? [colorColumnIndex] : []);

      const maxRows = Math.min(range.e.r, 10000); // Safety limit: max 10000 rows
      const maxCols = Math.min(range.e.c, 100); // Safety limit: max 100 columns
      for (let R = range.s.r; R <= maxRows; ++R) {
        for (let C = range.s.c; C <= maxCols; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[cellAddress]) continue;

          if (R === 0) {
            // Header row
            ws[cellAddress].s = headerStyle;
          } else {
            ws[cellAddress].s = { ...baseStyle };

            // Apply CME bracket color if this is a color column
            if (colorColumnsToApply.includes(C) && data[R - 1] && data[R - 1][C]) {
              const colorHex = data[R - 1][C];
              if (colorHex && colorHex.startsWith('#')) {
                ws[cellAddress].s.fill = { fgColor: { rgb: colorHex.replace('#', '') } };
              }
            }

            // Apply formatting to numeric columns
            const value = data[R - 1]?.[C];
            if (typeof value === 'number') {
              // Apply currency format to price columns
              if (priceColumnIndices.includes(C)) {
                ws[cellAddress].s.numFmt = '$#,##0';
              } else if (deltaColumnIndices.includes(C)) {
                // Apply percentage format to delta columns
                ws[cellAddress].s.numFmt = '0%';
                ws[cellAddress].t = 'n';
              } else {
                // Apply regular number format to other numeric columns
                ws[cellAddress].s.numFmt = '#,##0';
              }
            }
          }
        }
      }

      // Apply formulas after formatting
      if (formulaColumns.length > 0) {
        applyFormulas(ws, range, headers, { formulaColumns });
      }

      // Set column widths
      ws['!cols'] = headers.map((h, i) => {
        if (i === 0) return { wch: 30 }; // Description column
        if (h.includes('CME')) return { wch: 25 };
        return { wch: 15 };
      });

      return ws;
    };

    // Export Type & Use Analysis
    if (analysis.typeUse && analysis.typeUse.groups && analysis.typeUse.groups.length > 0 && (sectionType === 'all' || sectionType === 'typeUse')) {
      const headers = [
        'Description',
        'Total Properties',
        'Avg Year (All)',
        'Avg Size (All)',
        'Total Sales',
        'Avg Year (Sales)',
        'Avg Size (Sales)',
        'Sale Price',
        'Adj Price',
        'Delta',
        'CME Bracket',
        'Color'
      ];

      const data = analysis.typeUse.groups.map(group => [
        `${group.code} - ${group.name}`,
        group.propertyCount,
        group.avgYearAll || '',
        group.avgSizeAll ? Math.round(group.avgSizeAll) : '',
        group.salesCount,
        group.avgYearSales || '',
        group.avgSizeSales ? Math.round(group.avgSizeSales) : '',
        group.salesCount > 0 ? Math.round(group.avgPrice) : '',
        group.salesCount === 0 ? '' : group.isBaseline ? '' : Math.round(group.avgAdjustedPrice),
        group.isBaseline ? 'BASELINE' : '',
        group.cmeBracket ? group.cmeBracket.label : '',
        group.cmeBracket ? group.cmeBracket.color : ''
      ]);

      // Find the baseline row (deltaPercent === 0 or marked as 'BASELINE')
      const deltaColIndex = headers.indexOf('Delta');
      let baselineRowIndex = -1;

      for (let i = 0; i < data.length; i++) {
        const deltaValue = data[i][deltaColIndex];
        if (deltaValue === 'BASELINE' || deltaValue === 0) {
          baselineRowIndex = i + 1; // +1 because row 0 is headers
          break;
        }
      }

      // Formula configuration - Jim's 50% size adjustment normalized to baseline
      const formulaColumns = [{
        column: 'Adj Price',
        getFormula: (R, C, headers, ws) => {
          const avgSizeCol = headers.indexOf('Avg Size (Sales)');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (avgSizeCol === -1 || salePriceCol === -1 || baselineRowIndex === -1) return null;

          // Check if this is the baseline row - no formula needed
          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null; // Baseline row doesn't get adjusted
          }

          const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRowIndex, c: avgSizeCol });
          const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
          const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
          const baselineSizeValue = ws[baselineSizeCell]?.v;
          const currentSizeValue = ws[currentSizeCell]?.v;
          const salePriceValue = ws[salePriceCell]?.v;

          // Only apply formula if all values exist and are numbers
          if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
              typeof salePriceValue === 'number' && currentSizeValue > 0) {
            // Jim's Formula: ((BASELINE_SIZE - CURRENT_SIZE) * ((SALE_PRICE / CURRENT_SIZE) * 0.5)) + SALE_PRICE
            return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
          }
          return null;
        }
      }, {
        column: 'Delta',
        getFormula: (R, C, headers, ws) => {
          const adjPriceCol = headers.indexOf('Adj Price');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (adjPriceCol === -1 || salePriceCol === -1 || baselineRowIndex === -1) return null;

          // Check if this is the baseline row - no formula needed
          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null; // Baseline row shows 'BASELINE'
          }

          const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
          const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRowIndex, c: salePriceCol });
          const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

          // Check if Adj Price cell exists (has formula or value) and baseline has a sale price
          if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
            // Delta % = (Current Adj Price - Baseline Sale Price) / Baseline Sale Price (as decimal for % format)
            return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
          }
          return null;
        }
      }];

      const ws = createFormattedSheet(headers, data, { colorColumnIndex: 11, formulaColumns });
      XLSX.utils.book_append_sheet(wb, ws, 'Type & Use');
    }

    // Export Design Analysis
    if (analysis.design && analysis.design.groups && analysis.design.groups.length > 0 && (sectionType === 'all' || sectionType === 'design')) {
      const headers = [
        'Description',
        'Total Properties',
        'Avg Year (All)',
        'Avg Size (All)',
        'Total Sales',
        'Avg Year (Sales)',
        'Avg Size (Sales)',
        'Sale Price',
        'Adj Price',
        'Delta'
      ];

      const data = analysis.design.groups.map(group => [
        group.name,
        group.propertyCount,
        group.avgYearAll || '',
        group.avgSizeAll ? Math.round(group.avgSizeAll) : '',
        group.salesCount,
        group.avgYearSales || '',
        group.avgSizeSales ? Math.round(group.avgSizeSales) : '',
        group.salesCount > 0 ? Math.round(group.avgPrice) : '',
        group.salesCount === 0 ? '' : group.isBaseline ? '' : Math.round(group.avgAdjustedPrice),
        group.isBaseline ? 'BASELINE' : ''
      ]);

      // Find the baseline row for Design analysis
      const deltaColIndex = headers.indexOf('Delta');
      let baselineRowIndex = -1;

      for (let i = 0; i < data.length; i++) {
        const deltaValue = data[i][deltaColIndex];
        if (deltaValue === 'BASELINE' || deltaValue === 0) {
          baselineRowIndex = i + 1;
          break;
        }
      }

      const formulaColumns = [{
        column: 'Adj Price',
        getFormula: (R, C, headers, ws) => {
          const avgSizeCol = headers.indexOf('Avg Size (Sales)');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (avgSizeCol === -1 || salePriceCol === -1 || baselineRowIndex === -1) return null;

          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null;
          }

          const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRowIndex, c: avgSizeCol });
          const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
          const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
          const baselineSizeValue = ws[baselineSizeCell]?.v;
          const currentSizeValue = ws[currentSizeCell]?.v;
          const salePriceValue = ws[salePriceCell]?.v;

          if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
              typeof salePriceValue === 'number' && currentSizeValue > 0) {
            return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
          }
          return null;
        }
      }, {
        column: 'Delta',
        getFormula: (R, C, headers, ws) => {
          const adjPriceCol = headers.indexOf('Adj Price');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (adjPriceCol === -1 || salePriceCol === -1 || baselineRowIndex === -1) return null;

          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null;
          }

          const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
          const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRowIndex, c: salePriceCol });
          const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

          if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
            return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
          }
          return null;
        }
      }];

      const ws = createFormattedSheet(headers, data, { formulaColumns });
      XLSX.utils.book_append_sheet(wb, ws, 'Design');
    }

    // Export Year Built Analysis
    if (analysis.yearBuilt && analysis.yearBuilt.groups && analysis.yearBuilt.groups.length > 0 && (sectionType === 'all' || sectionType === 'yearBuilt')) {
      const headers = [
        'Category',
        'Total Properties',
        'Avg Year (All)',
        'Avg Size (All)',
        'Total Sales',
        'Avg Year (Sales)',
        'Avg Size (Sales)',
        'Sale Price',
        'Adj Price',
        'Delta',
        'CCF'
      ];

      const data = analysis.yearBuilt.groups.map(group => [
        group.label,
        group.propertyCount,
        group.avgYearAll || '',
        group.avgSizeAll ? Math.round(group.avgSizeAll) : '',
        group.salesCount,
        group.avgYearSales || '',
        group.avgSizeSales ? Math.round(group.avgSizeSales) : '',
        group.salesCount > 0 ? Math.round(group.avgPrice) : '',
        group.salesCount === 0 ? '' : group.isBaseline ? '' : Math.round(group.avgAdjustedPrice),
        group.isBaseline ? 'BASELINE' : '',
        group.isCCF ? 'YES' : ''
      ]);

      // Find the baseline row for Year Built analysis
      const deltaColIndexYB = headers.indexOf('Delta');
      let baselineRowIndexYB = -1;

      for (let i = 0; i < data.length; i++) {
        const deltaValue = data[i][deltaColIndexYB];
        if (deltaValue === 'BASELINE' || deltaValue === 0) {
          baselineRowIndexYB = i + 1;
          break;
        }
      }

      const formulaColumns = [{
        column: 'Adj Price',
        getFormula: (R, C, headers, ws) => {
          const avgSizeCol = headers.indexOf('Avg Size (Sales)');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (avgSizeCol === -1 || salePriceCol === -1 || baselineRowIndexYB === -1) return null;

          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null;
          }

          const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRowIndexYB, c: avgSizeCol });
          const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
          const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
          const baselineSizeValue = ws[baselineSizeCell]?.v;
          const currentSizeValue = ws[currentSizeCell]?.v;
          const salePriceValue = ws[salePriceCell]?.v;

          if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
              typeof salePriceValue === 'number' && currentSizeValue > 0) {
            return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
          }
          return null;
        }
      }, {
        column: 'Delta',
        getFormula: (R, C, headers, ws) => {
          const adjPriceCol = headers.indexOf('Adj Price');
          const salePriceCol = headers.indexOf('Sale Price');
          const deltaCol = headers.indexOf('Delta');

          if (adjPriceCol === -1 || salePriceCol === -1 || baselineRowIndexYB === -1) return null;

          const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
          const deltaValue = ws[deltaCell]?.v;
          if (deltaValue === 'BASELINE' || deltaValue === 0) {
            return null;
          }

          const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
          const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRowIndexYB, c: salePriceCol });
          const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

          if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
            return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
          }
          return null;
        }
      }];

      const ws = createFormattedSheet(headers, data, { formulaColumns });
      XLSX.utils.book_append_sheet(wb, ws, 'Year Built');
    }

    // Export VCS by Type Analysis
    if (analysis.vcsType && Object.keys(analysis.vcsType).length > 0 && (sectionType === 'all' || sectionType === 'vcsType')) {
      // Create a flattened data structure for export
      const headers = [
        'VCS',
        'Level',
        'Type/Design',
        'Total Properties',
        'Total Sales',
        'Avg Year (All)',
        'Avg Size (All)',
        'Avg Year (Sales)',
        'Avg Size (Sales)',
        'Sale Price',
        'Adj Price',
        'Delta %',
        'CME Bracket',
        'Color'
      ];

      const data = [];

      // Filter and sort VCS entries by adjusted price
      Object.entries(analysis.vcsType)
        .filter(([vcs, vcsData]) => vcsData.salesCount > 0)
        .sort((a, b) => b[1].avgAdjustedPrice - a[1].avgAdjustedPrice)
        .forEach(([vcs, vcsData]) => {
          // Add VCS-level row
          const vcsCME = getCMEBracket(vcsData.avgAdjustedPrice);
          data.push([
            vcsData.description || vcs,
            'VCS',
            `${vcsData.propertyCount} properties | ${vcsData.salesCount} sales`,
            vcsData.propertyCount,
            vcsData.salesCount,
            vcsData.avgYearAll || '',
            vcsData.avgSizeAll ? Math.round(vcsData.avgSizeAll) : '',
            vcsData.avgYearSales || '',
            vcsData.avgSizeSales ? Math.round(vcsData.avgSizeSales) : '',
            vcsData.avgPrice ? Math.round(vcsData.avgPrice) : '',
            Math.round(vcsData.avgAdjustedPrice),
            'VCS AVG',
            vcsCME.label,
            vcsCME.color
          ]);

          // Add Type-level rows
          Object.values(vcsData.types)
            .filter(type => type.salesCount > 0)
            .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
            .forEach((typeGroup) => {
              const typeCME = typeGroup.avgAdjustedPrice > 0 ? getCMEBracket(typeGroup.avgAdjustedPrice) : null;
              data.push([
                '',
                'Type',
                typeGroup.name,
                typeGroup.propertyCount,
                typeGroup.salesCount,
                typeGroup.avgYearAll || '',
                typeGroup.avgSizeAll ? Math.round(typeGroup.avgSizeAll) : '',
                typeGroup.avgYearSales || '',
                typeGroup.avgSizeSales ? Math.round(typeGroup.avgSizeSales) : '',
                typeGroup.avgPrice ? Math.round(typeGroup.avgPrice) : '',
                typeGroup.avgAdjustedPrice === 0 ? '' : typeGroup.isBaseline ? '' : Math.round(typeGroup.avgAdjustedPrice),
                typeGroup.deltaPercent !== 0 ? `${typeGroup.deltaPercent.toFixed(0)}%` : 'VCS BASE',
                typeCME ? typeCME.label : '',
                typeCME ? typeCME.color : ''
              ]);

              // Add Design-level rows if multiple designs
              if (Object.keys(typeGroup.designs).length > 1) {
                Object.values(typeGroup.designs)
                  .filter(design => design.salesCount > 0)
                  .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                  .forEach((designGroup) => {
                    const designCME = designGroup.avgAdjustedPrice > 0 ? getCMEBracket(designGroup.avgAdjustedPrice) : null;
                    data.push([
                      '',
                      'Design',
                      `  └ ${designGroup.name}`,
                      designGroup.propertyCount,
                      designGroup.salesCount,
                      designGroup.avgYearAll || '',
                      designGroup.avgSizeAll ? Math.round(designGroup.avgSizeAll) : '',
                      designGroup.avgYearSales || '',
                      designGroup.avgSizeSales ? Math.round(designGroup.avgSizeSales) : '',
                      designGroup.avgPrice ? Math.round(designGroup.avgPrice) : '',
                      designGroup.avgAdjustedPrice === 0 ? '' : designGroup.isBaseline ? '' : Math.round(designGroup.avgAdjustedPrice),
                      designGroup.deltaPercent !== 0 ? `${designGroup.deltaPercent.toFixed(0)}%` : 'TYPE BASE',
                      designCME ? designCME.label : '',
                      designCME ? designCME.color : ''
                    ]);
                  });
              }
            });

          // Add empty row between VCS sections
          data.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        });

      if (data.length > 0) {
        const formulaColumns = [{
          column: 'Adj Price',
          getFormula: (R, C, headers, ws) => {
            const levelCol = headers.indexOf('Level');
            const avgSizeCol = headers.indexOf('Avg Size (Sales)');
            const salePriceCol = headers.indexOf('Sale Price');

            if (levelCol === -1 || avgSizeCol === -1 || salePriceCol === -1) return null;

            const levelCell = XLSX.utils.encode_cell({ r: R, c: levelCol });
            const levelValue = ws[levelCell]?.v;

            // Only apply formula to Design-level rows
            if (levelValue !== 'Design') {
              return null; // VCS and Type rows don't get formulas
            }

            // Find the parent Type row (look backwards from current row)
            let parentTypeRow = -1;
            for (let searchR = R - 1; searchR > 0; searchR--) {
              const searchLevelCell = XLSX.utils.encode_cell({ r: searchR, c: levelCol });
              const searchLevelValue = ws[searchLevelCell]?.v;
              if (searchLevelValue === 'Type') {
                parentTypeRow = searchR;
                break;
              }
            }

            if (parentTypeRow === -1) return null; // No parent Type found

            // Use parent Type's size as normalization target
            const typeSizeCell = XLSX.utils.encode_cell({ r: parentTypeRow, c: avgSizeCol });
            const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
            const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });

            const typeSizeValue = ws[typeSizeCell]?.v;
            const currentSizeValue = ws[currentSizeCell]?.v;
            const salePriceValue = ws[salePriceCell]?.v;

            if (typeof typeSizeValue === 'number' && typeof currentSizeValue === 'number' &&
                typeof salePriceValue === 'number' && currentSizeValue > 0) {
              // Jim's Formula: Normalize Design to parent Type's average size
              return `(($${typeSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
            }
            return null;
          }
        }];

        const ws = createFormattedSheet(headers, data, { colorColumnIndex: 13, formulaColumns });
        XLSX.utils.book_append_sheet(wb, ws, 'VCS by Type');
      }
    }

    // Export Condo Analysis if available
    if (analysis.condo && (sectionType === 'all' || sectionType === 'condo')) {
      // Condo Design Analysis
      if (analysis.condo.designGroups && analysis.condo.designGroups.length > 0) {
        const headers = [
          'Design',
          'Total Condos',
          'Avg Size',
          'Avg Sale Price',
          'Avg Adjusted Price',
          'Delta %'
        ];

        const data = analysis.condo.designGroups.map(group => [
          `${group.code} - ${group.name}`,
          group.count,
          group.avgSize ? Math.round(group.avgSize) : '',
          group.avgPrice ? Math.round(group.avgPrice) : '',
          group.avgAdjustedPrice === 0 ? '' : Math.round(group.avgAdjustedPrice),
          ''
        ]);

        const formulaColumns = [{
          column: 'Delta %',
          getFormula: (R, C, headers, ws) => {
            const adjPriceCol = headers.indexOf('Avg Adjusted Price');
            const salePriceCol = headers.indexOf('Avg Sale Price');

            if (adjPriceCol === -1 || salePriceCol === -1) return null;

            const adjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
            const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
            const salePriceValue = ws[salePriceCell]?.v;

            // Compare Adj Price to Avg Sale Price (not baseline)
            if (ws[adjPriceCell] && typeof salePriceValue === 'number' && salePriceValue > 0) {
              return `(${adjPriceCell}-${salePriceCell})/${salePriceCell}`;
            }
            return null;
          }
        }];

        const ws = createFormattedSheet(headers, data, { formulaColumns });
        XLSX.utils.book_append_sheet(wb, ws, 'Condo Design');
      }

      // Condo Bedroom Analysis
      if (analysis.condo.vcsBedroomGroups && Object.keys(analysis.condo.vcsBedroomGroups).length > 0) {
        const headers = [
          'VCS',
          'Bed Type',
          'Count',
          'Avg Size',
          'Sale Price',
          'Adj Price',
          'Delta'
        ];

        const data = [];
        Object.entries(analysis.condo.vcsBedroomGroups).forEach(([vcs, vcsGroup]) => {
          if (vcsGroup.bedrooms) {
            // Filter out Unknown bedrooms and sort by bed count
            const bedOrderValue = (label) => {
              if (!label) return 999;
              if (label === 'STUDIO') return 0;
              const m = label.match(/^(\d+)BED$/);
              if (m) return parseInt(m[1], 10);
              return 999;
            };
            const sortedBeds = Object.entries(vcsGroup.bedrooms)
              .filter(([bedrooms, group]) => bedrooms !== 'Unknown' && group.salesCount > 0)
              .sort(([a], [b]) => bedOrderValue(a) - bedOrderValue(b));

            sortedBeds.forEach(([bedrooms, group], index) => {
              data.push([
                vcsGroup.description || vcs,
                group.label,
                group.salesCount || 0,
                group.avgSize ? Math.round(group.avgSize) : '',
                group.avgPrice ? Math.round(group.avgPrice) : '',
                group.avgAdjustedPrice ? Math.round(group.avgAdjustedPrice) : '',
                index === 0 ? 'BASELINE' : ''
              ]);
            });
          }
        });

        if (data.length > 0) {
          console.log('[Export] Condo Bedroom - processing', data.length, 'rows');
          // Pre-compute VCS baseline row lookup (optimization to avoid O(n²) loops)
          const vcsBaselineMap = {};
          const vcsCol = headers.indexOf('VCS');
          const deltaCol = headers.indexOf('Delta');

          // Safety check: only pre-compute if columns exist
          if (vcsCol !== -1 && deltaCol !== -1) {
            data.forEach((row, index) => {
              if (!row || !Array.isArray(row)) return; // Skip invalid rows
              const vcs = row[vcsCol];
              const delta = row[deltaCol];
              if (delta === 'BASELINE' && vcs && !vcsBaselineMap[vcs]) {
                vcsBaselineMap[vcs] = index + 1; // +1 for Excel row (0-indexed to 1-indexed)
              }
            });
            console.log('[Export] Condo Bedroom - baseline map:', vcsBaselineMap);
          }

          const formulaColumns = [
            {
              column: 'Adj Price',
              getFormula: (R, C, headers, ws) => {
                const vcsCol = headers.indexOf('VCS');
                const avgSizeCol = headers.indexOf('Avg Size');
                const salePriceCol = headers.indexOf('Sale Price');
                const deltaCol = headers.indexOf('Delta');

                if (vcsCol === -1 || avgSizeCol === -1 || salePriceCol === -1) return null;

                const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
                const deltaValue = ws[deltaCell]?.v;
                if (deltaValue === 'BASELINE') {
                  return null;
                }

                // Use pre-computed baseline lookup
                const currentVcsCell = XLSX.utils.encode_cell({ r: R, c: vcsCol });
                const currentVcs = ws[currentVcsCell]?.v;
                const baselineRow = vcsBaselineMap[currentVcs];

                if (!baselineRow) return null;

                const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRow, c: avgSizeCol });
                const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
                const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
                const baselineSizeValue = ws[baselineSizeCell]?.v;
                const currentSizeValue = ws[currentSizeCell]?.v;
                const salePriceValue = ws[salePriceCell]?.v;

                if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
                    typeof salePriceValue === 'number' && currentSizeValue > 0) {
                  return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
                }
                return null;
              }
            },
            {
              column: 'Delta',
              getFormula: (R, C, headers, ws) => {
                const vcsCol = headers.indexOf('VCS');
                const adjPriceCol = headers.indexOf('Adj Price');
                const salePriceCol = headers.indexOf('Sale Price');
                const deltaCol = headers.indexOf('Delta');

                if (vcsCol === -1 || adjPriceCol === -1 || salePriceCol === -1) return null;

                const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
                const deltaValue = ws[deltaCell]?.v;
                if (deltaValue === 'BASELINE') {
                  return null;
                }

                // Use pre-computed baseline lookup
                const currentVcsCell = XLSX.utils.encode_cell({ r: R, c: vcsCol });
                const currentVcs = ws[currentVcsCell]?.v;
                const baselineRow = vcsBaselineMap[currentVcs];

                if (!baselineRow) return null;

                const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
                const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRow, c: salePriceCol });
                const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

                if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
                  return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
                }
                return null;
              }
            }
          ];

          const ws = createFormattedSheet(headers, data, { formulaColumns });
          XLSX.utils.book_append_sheet(wb, ws, 'Condo Bedroom');
        }
      }

      // Condo End vs Interior Analysis
      if (analysis.condo.endIntGroups && Object.keys(analysis.condo.endIntGroups).length > 0) {
        const headers = [
          'VCS',
          'End/Int Type',
          'Count',
          'Avg Size',
          'Sale Price',
          'Adj Price',
          'Delta'
        ];

        const data = [];
        Object.entries(analysis.condo.endIntGroups).forEach(([vcs, vcsGroup]) => {
          // Interior Unit (baseline)
          if (vcsGroup.interiorUnits && vcsGroup.interiorUnits.count > 0) {
            data.push([
              vcs,
              'Interior Unit',
              vcsGroup.interiorUnits.count,
              vcsGroup.interiorUnits.avgSize ? Math.round(vcsGroup.interiorUnits.avgSize) : '',
              vcsGroup.interiorUnits.avgPrice ? Math.round(vcsGroup.interiorUnits.avgPrice) : '',
              '',
              'BASELINE'
            ]);
          }
          // End Unit
          if (vcsGroup.endUnits && vcsGroup.endUnits.count > 0) {
            data.push([
              vcs,
              'End Unit',
              vcsGroup.endUnits.count,
              vcsGroup.endUnits.avgSize ? Math.round(vcsGroup.endUnits.avgSize) : '',
              vcsGroup.endUnits.avgPrice ? Math.round(vcsGroup.endUnits.avgPrice) : '',
              vcsGroup.endUnits.avgAdjustedPrice ? Math.round(vcsGroup.endUnits.avgAdjustedPrice) : '',
              ''
            ]);
          }
        });

        if (data.length > 0) {
          const formulaColumns = [
            {
              column: 'Adj Price',
              getFormula: (R, C, headers, ws) => {
                const unitTypeCol = headers.indexOf('End/Int Type');
                const avgSizeCol = headers.indexOf('Avg Size');
                const salePriceCol = headers.indexOf('Sale Price');

                if (unitTypeCol === -1 || avgSizeCol === -1 || salePriceCol === -1) return null;

                const unitTypeCell = XLSX.utils.encode_cell({ r: R, c: unitTypeCol });
                const unitTypeValue = ws[unitTypeCell]?.v;

                // Only apply formula to End Unit rows
                if (!unitTypeValue || unitTypeValue !== 'End Unit') {
                  return null;
                }

                // Find the corresponding Interior Unit row (previous row should be interior)
                const baselineRow = R - 1;
                if (baselineRow < 1) return null;

                const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRow, c: avgSizeCol });
                const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
                const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
                const baselineSizeValue = ws[baselineSizeCell]?.v;
                const currentSizeValue = ws[currentSizeCell]?.v;
                const salePriceValue = ws[salePriceCell]?.v;

                if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
                    typeof salePriceValue === 'number' && currentSizeValue > 0) {
                  return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
                }
                return null;
              }
            },
            {
              column: 'Delta',
              getFormula: (R, C, headers, ws) => {
                const unitTypeCol = headers.indexOf('End/Int Type');
                const adjPriceCol = headers.indexOf('Adj Price');
                const salePriceCol = headers.indexOf('Sale Price');

                if (unitTypeCol === -1 || adjPriceCol === -1 || salePriceCol === -1) return null;

                const unitTypeCell = XLSX.utils.encode_cell({ r: R, c: unitTypeCol });
                const unitTypeValue = ws[unitTypeCell]?.v;

                // Only apply formula to End Unit rows
                if (!unitTypeValue || unitTypeValue !== 'End Unit') {
                  return null;
                }

                // Find the corresponding Interior Unit row (previous row should be interior)
                const baselineRow = R - 1;
                if (baselineRow < 1) return null;

                const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
                const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRow, c: salePriceCol });
                const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

                if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
                  return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
                }
                return null;
              }
            }
          ];

          const ws = createFormattedSheet(headers, data, { formulaColumns });
          XLSX.utils.book_append_sheet(wb, ws, 'Condo End-Interior');
        }
      }

      // Condo Floor Analysis (now VCS-based, export flattened version)
      if (analysis.condo.vcsFloorGroups && Object.keys(analysis.condo.vcsFloorGroups).length > 0) {
        // Flatten VCS floor data for Excel export
        const flattenedFloors = [];
        Object.entries(analysis.condo.vcsFloorGroups).forEach(([vcs, vcsData]) => {
          Object.values(vcsData.floors).forEach(floor => {
            flattenedFloors.push({
              vcs: vcs,
              ...floor
            });
          });
        });

        if (flattenedFloors.length === 0) return; // Skip if no floor data
        const headers = [
          'VCS',
          'Floor Type',
          'Count',
          'Avg Size',
          'Sale Price',
          'Adj Price',
          'Delta'
        ];

        const data = flattenedFloors.map(floor => [
          floor.vcs,
          floor.label,
          floor.count,
          floor.avgSize ? Math.round(floor.avgSize) : '',
          floor.avgPrice ? Math.round(floor.avgPrice) : '',
          floor.avgAdjustedPrice === 0 ? '' : floor.isBaseline ? '' : Math.round(floor.avgAdjustedPrice),
          floor.isBaseline ? 'BASELINE' : '',
        ]);

        console.log('[Export] Condo Floor - processing', data.length, 'rows');
        // Pre-compute VCS baseline row lookup (optimization to avoid O(n²) loops)
        const vcsBaselineMapFloor = {};
        const vcsColFloor = headers.indexOf('VCS');
        const deltaColFloor = headers.indexOf('Delta');

        // Safety check: only pre-compute if columns exist
        if (vcsColFloor !== -1 && deltaColFloor !== -1) {
          data.forEach((row, index) => {
            if (!row || !Array.isArray(row)) return; // Skip invalid rows
            const vcs = row[vcsColFloor];
            const delta = row[deltaColFloor];
            if (delta === 'BASELINE' && vcs && !vcsBaselineMapFloor[vcs]) {
              vcsBaselineMapFloor[vcs] = index + 1; // +1 for Excel row (0-indexed to 1-indexed)
            }
          });
          console.log('[Export] Condo Floor - baseline map:', vcsBaselineMapFloor);
        }

        const formulaColumns = [
          {
          column: 'Adj Price',
          getFormula: (R, C, headers, ws) => {
            const vcsCol = headers.indexOf('VCS');
            const avgSizeCol = headers.indexOf('Avg Size');
            const salePriceCol = headers.indexOf('Sale Price');
            const deltaCol = headers.indexOf('Delta');

            if (vcsCol === -1 || avgSizeCol === -1 || salePriceCol === -1) return null;

            const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
            const deltaValue = ws[deltaCell]?.v;
            if (deltaValue === 'BASELINE') {
              return null;
            }

            // Use pre-computed baseline lookup
            const currentVcsCell = XLSX.utils.encode_cell({ r: R, c: vcsCol });
            const currentVcs = ws[currentVcsCell]?.v;
            const baselineRow = vcsBaselineMapFloor[currentVcs];

            if (!baselineRow) return null;

            const baselineSizeCell = XLSX.utils.encode_cell({ r: baselineRow, c: avgSizeCol });
            const currentSizeCell = XLSX.utils.encode_cell({ r: R, c: avgSizeCol });
            const salePriceCell = XLSX.utils.encode_cell({ r: R, c: salePriceCol });
            const baselineSizeValue = ws[baselineSizeCell]?.v;
            const currentSizeValue = ws[currentSizeCell]?.v;
            const salePriceValue = ws[salePriceCell]?.v;

            if (typeof baselineSizeValue === 'number' && typeof currentSizeValue === 'number' &&
                typeof salePriceValue === 'number' && currentSizeValue > 0) {
              return `(($${baselineSizeCell}-${currentSizeCell})*((${salePriceCell}/${currentSizeCell})*0.5))+${salePriceCell}`;
            }
            return null;
          }
        },
          {
          column: 'Delta',
          getFormula: (R, C, headers, ws) => {
            const vcsCol = headers.indexOf('VCS');
            const adjPriceCol = headers.indexOf('Adj Price');
            const salePriceCol = headers.indexOf('Sale Price');
            const deltaCol = headers.indexOf('Delta');

            if (vcsCol === -1 || adjPriceCol === -1 || salePriceCol === -1) return null;

            const deltaCell = XLSX.utils.encode_cell({ r: R, c: deltaCol });
            const deltaValue = ws[deltaCell]?.v;
            if (deltaValue === 'BASELINE') {
              return null;
            }

            // Use pre-computed baseline lookup
            const currentVcsCell = XLSX.utils.encode_cell({ r: R, c: vcsCol });
            const currentVcs = ws[currentVcsCell]?.v;
            const baselineRow = vcsBaselineMapFloor[currentVcs];

            if (!baselineRow) return null;

            const currentAdjPriceCell = XLSX.utils.encode_cell({ r: R, c: adjPriceCol });
            const baselineSalePriceCell = XLSX.utils.encode_cell({ r: baselineRow, c: salePriceCol });
            const baselineSalePriceValue = ws[baselineSalePriceCell]?.v;

            if (ws[currentAdjPriceCell] && typeof baselineSalePriceValue === 'number' && baselineSalePriceValue > 0) {
              return `(${currentAdjPriceCell}-${baselineSalePriceCell})/${baselineSalePriceCell}`;
            }
            return null;
          }
        }
        ];

        const ws = createFormattedSheet(headers, data, { formulaColumns });
        XLSX.utils.book_append_sheet(wb, ws, 'Condo Floor');
      }
    }

    // Check if any sheets were added to the workbook
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      alert('No data available to export. Please ensure the analysis has been run and contains valid property data.');
      return;
    }

    // Write file
    const filename = sectionType === 'all'
      ? `OverallAnalysis_${jobData?.job_name || 'export'}_${timestamp}.xlsx`
      : `OverallAnalysis_${sectionType}_${jobData?.job_name || 'export'}_${timestamp}.xlsx`;

    console.log('[Export] Writing file...', filename);
    XLSX.writeFile(wb, filename);
    const elapsed = Date.now() - startTime;
    console.log(`[Export] Complete in ${elapsed}ms`);
  };

  // ==================== MAIN RENDER ====================
  
  return (
    <div className="max-w-full mx-auto space-y-6">
      {/* Microsystems Code Definitions Diagnostic Banner */}
      {(needsRepair || diagnosticStatus) && (
        <div className={`rounded-lg p-4 border ${
          diagnosticStatus?.status === 'repaired' ? 'bg-green-50 border-green-200' :
          diagnosticStatus?.status === 'error' ? 'bg-red-50 border-red-200' :
          'bg-orange-50 border-orange-200'
        }`}>
          <div className="flex items-start gap-3">
            <AlertCircle className={`h-5 w-5 mt-0.5 ${
              diagnosticStatus?.status === 'repaired' ? 'text-green-600' :
              diagnosticStatus?.status === 'error' ? 'text-red-600' :
              'text-orange-600'
            }`} />
            <div className="flex-1">
              <div className={`font-medium ${
                diagnosticStatus?.status === 'repaired' ? 'text-green-900' :
                diagnosticStatus?.status === 'error' ? 'text-red-900' :
                'text-orange-900'
              }`}>
                {diagnosticStatus?.status === 'repaired' ? 'Code Definitions Repaired!' :
                 diagnosticStatus?.status === 'error' ? 'Code Definitions Error' :
                 'Code Definitions Issue Detected'}
              </div>
              <div className={`text-sm mt-1 ${
                diagnosticStatus?.status === 'repaired' ? 'text-green-800' :
                diagnosticStatus?.status === 'error' ? 'text-red-800' :
                'text-orange-800'
              }`}>
                {diagnosticStatus?.message ||
                 'Microsystems code definitions are missing or corrupted. This will cause raw codes to display instead of descriptions.'}
              </div>
              {diagnosticStatus?.status === 'repaired' && (
                <div className="text-sm text-green-700 mt-2">
                  Page will refresh automatically to load the updated definitions...
                </div>
              )}
              {!diagnosticStatus && (
                <div className="mt-3">
                  <button
                    onClick={runMicrosystemsDiagnostic}
                    disabled={isRunningDiagnostic}
                    className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isRunningDiagnostic ? 'Diagnosing...' : 'Fix Code Definitions'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        {/* Normalization Warning Banner */}
        {properties.length > 0 && !properties.some(p => p.values_norm_time && p.values_norm_time > 0) && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div>
                <div className="font-medium text-yellow-900">Time & Size Normalization Required</div>
                <div className="text-sm text-yellow-800 mt-1">
                  To see sale prices, adjusted prices, and CME brackets, please run Time & Size Normalization first.
                  <br />
                  <span className="font-medium">Go to: Pre-Valuation Setup tab → Time & Size Normalization</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Overall Market Analysis</h2>
          <div className="flex gap-2">
            {/* VCS Filter */}
            <select
              value={selectedVCS}
              onChange={(e) => setSelectedVCS(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All VCS</option>
              {allVCSCodes.map(vcs => (
                <option key={vcs} value={vcs}>{vcs}</option>
              ))}
            </select>
            
            <button
              onClick={() => runAnalysis()}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`} />
              {isProcessing ? 'Processing...' : 'Refresh'}
            </button>
            
            <button
              onClick={() => exportToExcel()}
              disabled={!analysis}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Properties: {formatNumber(filteredProperties.length)}</span>
          {selectedVCS !== 'ALL' && <span>VCS: {selectedVCS}</span>}
          {lastProcessed && (
            <span>Last processed: {lastProcessed.toLocaleTimeString()}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="mls-subtab-nav">
          <button
            onClick={() => setActiveTab('market')}
            className={`mls-subtab-btn ${activeTab === 'market' ? 'mls-subtab-btn--active' : ''}`}
          >
            Market Analysis
          </button>
          <button
            onClick={() => setActiveTab('condo')}
            className={`mls-subtab-btn ${activeTab === 'condo' ? 'mls-subtab-btn--active' : ''}`}
          >
            Condo Analysis
          </button>
        </div>
      </div>

      {/* Main Content */}
      {activeTab === 'market' ? (
        <div className="space-y-6">
          {/* Type & Use Analysis - UPDATED WITH NEW COLUMNS */}
          {analysis?.typeUse && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div 
                onClick={() => toggleSection('typeUse')}
                className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
              >
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Home className="h-5 w-5" />
                  Type & Use Analysis
                </h3>
                {expandedSections.typeUse ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
              
              {expandedSections.typeUse && (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Properties</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Sales</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Delta</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">CME Bracket</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.typeUse.groups
                          .filter(g => g.code !== 'Unknown')
                          .sort((a, b) => {
                            const priorityFor = (g) => {
                              if (!g || !g.code) return 9;
                              const first = g.code.toString().charAt(0);
                              const map = { '1': 0, '2': 1, '3': 2, '4': 3, '6': 4 };
                              return map[first] !== undefined ? map[first] : 5;
                            };
                            const pa = priorityFor(a);
                            const pb = priorityFor(b);
                            if (pa !== pb) return pa - pb;
                            return (b.avgAdjustedPrice || 0) - (a.avgAdjustedPrice || 0);
                          })
                          .map((group, idx) => (
                          <tr key={`${group.code}-${idx}`} className={group === analysis.typeUse.baseline ? 'bg-yellow-50' : ''}>
                            <td className="px-4 py-3 text-sm">
                              <div>
                                <div className="font-medium">{group.code} - {group.name}</div>
                                <div className="text-xs text-gray-500">{group.category}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.propertyCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearAll > 0 ? group.avgYearAll : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500 text-xs">NO SALES DATA</span>
                              ) : group.isBaseline ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                formatCurrency(group.avgAdjustedPrice)
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500">—</span>
                              ) : group.deltaPercent !== 0 ? (
                                <span className={group.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                  {group.deltaPercent > 0 ? '+' : ''}{group.deltaPercent.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-gray-400">BASELINE</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 && group.cmeBracket ? (
                                <span
                                  className="px-2 py-1 text-xs rounded font-medium"
                                  style={{
                                    backgroundColor: group.cmeBracket.color,
                                    color: group.cmeBracket.textColor
                                  }}
                                >
                                  {group.cmeBracket.label}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Design & Style Analysis - UPDATED WITH NEW COLUMNS AND FILTER */}
          {analysis?.design && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="mb-4">
                <div 
                  onClick={() => toggleSection('design')}
                  className="flex justify-between items-center cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                >
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    Design & Style Analysis
                  </h3>
                  {expandedSections.design ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>
                
                {expandedSections.design && (
                  <div className="mt-4 flex items-center gap-2">
                    <label className="text-sm text-gray-600">Baseline:</label>
                    <select
                      value={customBaselines.design || ''}
                      onChange={(e) => {
                        setCustomBaselines(prev => ({
                          ...prev,
                          design: e.target.value || null
                        }));
     
                      }}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Auto (Highest Value)</option>
                      {analysis.design.groups
                        .filter(g => g.salesCount > 0)
                        .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                        .map(group => (
                          <option key={group.code} value={group.code}>
                            {group.name} ({formatCurrency(group.avgAdjustedPrice)})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
              
              {expandedSections.design && (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Properties</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Sales</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.design.groups
                          .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                          .map((group, idx) => (
                          <tr key={`${group.code}-${idx}`} className={group === analysis.design.baseline ? 'bg-yellow-50' : ''}>
                            <td className="px-4 py-3 text-sm">
                              <div className="font-medium">{group.name}</div>
                              {group.code !== group.name && (
                                <div className="text-xs text-gray-500">Code: {group.code}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.propertyCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearAll > 0 ? group.avgYearAll : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500 text-xs">NO SALES DATA</span>
                              ) : group.isBaseline ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                formatCurrency(group.avgAdjustedPrice)
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500">—</span>
                              ) : group.deltaPercent !== 0 ? (
                                <span className={group.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                  {group.deltaPercent > 0 ? '+' : ''}{group.deltaPercent.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-gray-400">BASELINE</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
          {/* Year Built Analysis - UPDATED WITH NEW COLUMNS */}
          {analysis?.yearBuilt && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div 
                onClick={() => toggleSection('yearBuilt')}
                className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
              >
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Year Built Analysis
                </h3>
                {expandedSections.yearBuilt ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
              
              {expandedSections.yearBuilt && (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Properties</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(All)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total<br/>Sales</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Year<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size<br/>(Sales)</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale<br/>Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Delta</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">CCF</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.yearBuilt.groups.map((group, idx) => (
                          <tr key={idx} className={group === analysis.yearBuilt.baseline ? 'bg-yellow-50' : ''}>
                            <td className="px-4 py-3 text-sm font-medium">{group.label}</td>
                            <td className="px-4 py-3 text-sm text-center">{group.propertyCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearAll > 0 ? group.avgYearAll : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : '���'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : '����'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500 text-xs">NO SALES DATA</span>
                              ) : group.isBaseline ? (
                                <span className="text-gray-400">—</span>
                              ) : (
                                formatCurrency(group.avgAdjustedPrice)
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount === 0 ? (
                                <span className="text-gray-500">—</span>
                              ) : group.deltaPercent !== 0 ? (
                                <span className={group.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                  {group.deltaPercent > 0 ? '+' : ''}{group.deltaPercent.toFixed(0)}%
                                </span>
                              ) : (
                                <span className="text-gray-400">BASELINE</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.isCCF && (
                                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded font-medium">
                                  CCF
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* VCS by Type Analysis - Cascading WITH IMPROVED LAYOUT */}
          {analysis?.vcsType && Object.keys(analysis.vcsType).length > 0 && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div 
                onClick={() => toggleSection('vcsType')}
                className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
              >
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  VCS by Type Analysis (Cascading)
                </h3>
                {expandedSections.vcsType ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
              
              {expandedSections.vcsType && (
                <div className="space-y-6">
                  {Object.entries(analysis.vcsType)
                    .filter(([vcs, data]) => data.salesCount > 0)
                    .sort((a, b) => b[1].avgAdjustedPrice - a[1].avgAdjustedPrice)
                    .map(([vcs, vcsData]) => (
                      <div key={vcs} className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* VCS Header */}
                        <div className="bg-blue-50 px-4 py-3 border-b border-blue-200">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-gray-900">
                                {vcsData.description} ({vcsData.code})
                              </h4>
                              <div className="text-sm text-gray-600 mt-1">
                                {vcsData.propertyCount} total properties | {vcsData.salesCount} sales
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-gray-600">VCS Average</div>
                              <div className="font-semibold text-lg">{formatCurrency(vcsData.avgAdjustedPrice)}</div>
                              {vcsData.salesCount > 0 && (
                                <span 
                                  className="inline-block mt-1 px-2 py-1 text-xs rounded font-medium"
                                  style={{ 
                                    backgroundColor: getCMEBracket(vcsData.avgAdjustedPrice).color,
                                    color: getCMEBracket(vcsData.avgAdjustedPrice).textColor
                                  }}
                                >
                                  {getCMEBracket(vcsData.avgAdjustedPrice).label}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Type Headers */}
                        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-600 uppercase">
                            <div className="col-span-3">Type / Design</div>
                            <div className="col-span-1 text-center">Properties</div>
                            <div className="col-span-1 text-center">Sales</div>
                            <div className="col-span-1 text-center">Year (All)</div>
                            <div className="col-span-1 text-center">Size (All)</div>
                            <div className="col-span-1 text-center">Year (Sales)</div>
                            <div className="col-span-1 text-center">Size (Sales)</div>
                            <div className="col-span-1 text-center">Sale Price</div>
                            <div className="col-span-1 text-center">Adj Price</div>
                            <div className="col-span-1 text-center">Delta</div>
                          </div>
                        </div>
                        
                        {/* Type and Design Rows */}
                        <div className="divide-y divide-gray-200">
                          {Object.values(vcsData.types)
                            .filter(type => type.salesCount > 0)
                            .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                            .map((typeGroup) => (
                              <div key={typeGroup.code}>
                                {/* Type Row */}
                                <div className={`grid grid-cols-12 gap-4 px-4 py-2 ${typeGroup === vcsData.baselineType ? 'bg-yellow-50' : 'bg-white'} hover:bg-gray-50`}>
                                  <div className="col-span-3 font-medium">{typeGroup.name}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.propertyCount}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.salesCount}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgYearAll > 0 ? typeGroup.avgYearAll : ''}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgSizeAll > 0 ? formatNumber(typeGroup.avgSizeAll) : ''}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgYearSales > 0 ? typeGroup.avgYearSales : ''}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgSizeSales > 0 ? formatNumber(typeGroup.avgSizeSales) : ''}</div>
                                  <div className="col-span-1 text-center text-sm">
                                    {typeGroup.salesCount > 0 ? formatCurrency(typeGroup.avgPrice) : ''}
                                  </div>
                                  <div className="col-span-1 text-center text-sm font-medium">
                                    {typeGroup.salesCount > 0 ? formatCurrency(typeGroup.avgAdjustedPrice) : ''}
                                  </div>
                                  <div className="col-span-1 text-center text-sm">
                                    {typeGroup.salesCount === 0 ? (
                                      <span className="text-gray-500">—</span>
                                    ) : typeGroup.deltaPercent !== 0 ? (
                                      <span className={typeGroup.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                        {typeGroup.deltaPercent > 0 ? '+' : ''}{typeGroup.deltaPercent.toFixed(0)}%
                                      </span>
                                    ) : (
                                      <span className="text-gray-400 text-xs">VCS BASE</span>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Design Rows - Only show if multiple designs */}
                                {Object.keys(typeGroup.designs).length > 1 && Object.values(typeGroup.designs)
                                  .filter(design => design.salesCount > 0)
                                  .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                                  .map((designGroup) => (
                                    <div key={designGroup.code} className="grid grid-cols-12 gap-4 px-4 py-1 bg-gray-50 hover:bg-gray-100">
                                      <div className="col-span-3 pl-6 text-sm text-gray-600">
                                        <span className="text-gray-400 mr-2">└</span>
                                        {designGroup.name}
                                      </div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.propertyCount}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.salesCount}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgYearAll > 0 ? designGroup.avgYearAll : ''}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgSizeAll > 0 ? formatNumber(designGroup.avgSizeAll) : ''}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgYearSales > 0 ? designGroup.avgYearSales : '��'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgSizeSales > 0 ? formatNumber(designGroup.avgSizeSales) : '�������'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">
                                        {designGroup.salesCount > 0 ? formatCurrency(designGroup.avgPrice) : ''}
                                      </div>
                                      <div className="col-span-1 text-center text-xs font-medium">
                                        {designGroup.salesCount > 0 ? formatCurrency(designGroup.avgAdjustedPrice) : ''}
                                      </div>
                                      <div className="col-span-1 text-center text-xs">
                                        {designGroup.salesCount === 0 ? (
                                          <span className="text-gray-400">���</span>
                                        ) : designGroup.deltaPercent !== 0 ? (
                                          <span className={designGroup.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                            {designGroup.deltaPercent > 0 ? '+' : ''}{designGroup.deltaPercent.toFixed(0)}%
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">TYPE BASE</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Condo Analysis Tab */
        <div className="space-y-6">
          {analysis?.condo ? (
            <>
              {/* Condo Overview Stats */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-semibold mb-4">Condo Overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600">Total Condos</div>
                    <div className="text-2xl font-bold">{analysis.condo.totalCondos}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600">Unique Designs</div>
                    <div className="text-2xl font-bold">{analysis.condo.designGroups.length}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600">VCS Complexes</div>
                    <div className="text-2xl font-bold">{Object.keys(analysis.condo.vcsBedroomGroups).length}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-sm text-gray-600">Floor Levels</div>
                    <div className="text-2xl font-bold">
                      {analysis.condo.vcsFloorGroups ?
                        new Set(Object.values(analysis.condo.vcsFloorGroups).flatMap(vcs => Object.keys(vcs.floors))).size
                        : 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* Condo Design Analysis */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div 
                  onClick={() => toggleSection('condoDesign')}
                  className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                >
                  <div>
                    <h3 className="text-lg font-semibold">Condo Design Analysis</h3>
                    <div className="text-xs text-gray-500 mt-1">Average-based comparison ��� Overall Avg: {formatCurrency(analysis.condo.overallAvgPrice)} @ {formatNumber(analysis.condo.overallAvgSize)} SF</div>
                  </div>
                  {expandedSections.condoDesign ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>
                
                {expandedSections.condoDesign && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Design</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sales</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.condo.designGroups
                          .sort((a, b) => b.avgAdjustedPrice - a.avgAdjustedPrice)
                          .map((group) => (
                          <tr key={group.code}>
                            <td className="px-4 py-3 text-sm font-medium">
                              <div>{group.name}</div>
                              <div className="text-xs text-gray-500 mt-1">{group.code}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.count}</td>
                            <td className="px-4 py-3 text-sm text-center">{formatNumber(group.avgSize)}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgPrice > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.avgAdjustedPrice === 0 ? (
                                <span className="text-gray-500 text-xs">NO SALES DATA</span>
                              ) : (
                                formatCurrency(group.avgAdjustedPrice)
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgAdjustedPrice === 0 ? (
                                <span className="text-gray-500">��</span>
                              ) : (
                                <span className={group.deltaPercent > 0 ? 'text-green-600' : group.deltaPercent < 0 ? 'text-red-600' : 'text-gray-600'}>
                                  {group.deltaPercent > 0 ? '+' : ''}{group.deltaPercent.toFixed(0)}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* VCS Bedroom Analysis */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div
                  onClick={() => toggleSection('condoBedroom')}
                  className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                >
                  <h3 className="text-lg font-semibold">VCS Bedroom Analysis</h3>
                  {expandedSections.condoBedroom ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>

                {expandedSections.condoBedroom && (
                  <>
                    {/* Bedroom Summary Banner */}
                    <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-medium text-blue-900 mb-3">Overall Bedroom Adjustment Summary</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-600 mb-1">Studio → 1 Bed</div>
                          {analysis.condo.bedroomSummary.studioTo1Bed.hasData ? (
                            <>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(analysis.condo.bedroomSummary.studioTo1Bed.avgDelta)}
                              </div>
                              <div className={`text-xs ${analysis.condo.bedroomSummary.studioTo1Bed.avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {analysis.condo.bedroomSummary.studioTo1Bed.avgDeltaPct > 0 ? '+' : ''}
                                {analysis.condo.bedroomSummary.studioTo1Bed.avgDeltaPct.toFixed(1)}%
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-400">No data</div>
                          )}
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-600 mb-1">1 Bed → 2 Bed</div>
                          {analysis.condo.bedroomSummary.oneBedTo2Bed.hasData ? (
                            <>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(analysis.condo.bedroomSummary.oneBedTo2Bed.avgDelta)}
                              </div>
                              <div className={`text-xs ${analysis.condo.bedroomSummary.oneBedTo2Bed.avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {analysis.condo.bedroomSummary.oneBedTo2Bed.avgDeltaPct > 0 ? '+' : ''}
                                {analysis.condo.bedroomSummary.oneBedTo2Bed.avgDeltaPct.toFixed(1)}%
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-400">No data</div>
                          )}
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-600 mb-1">2 Bed → 3 Bed</div>
                          {analysis.condo.bedroomSummary.twoBedTo3Bed.hasData ? (
                            <>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(analysis.condo.bedroomSummary.twoBedTo3Bed.avgDelta)}
                              </div>
                              <div className={`text-xs ${analysis.condo.bedroomSummary.twoBedTo3Bed.avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {analysis.condo.bedroomSummary.twoBedTo3Bed.avgDeltaPct > 0 ? '+' : ''}
                                {analysis.condo.bedroomSummary.twoBedTo3Bed.avgDeltaPct.toFixed(1)}%
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-400">No data</div>
                          )}
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-600 mb-1">3 Bed → 4 Bed</div>
                          {analysis.condo.bedroomSummary.threeBedTo4Bed.hasData ? (
                            <>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(analysis.condo.bedroomSummary.threeBedTo4Bed.avgDelta)}
                              </div>
                              <div className={`text-xs ${analysis.condo.bedroomSummary.threeBedTo4Bed.avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {analysis.condo.bedroomSummary.threeBedTo4Bed.avgDeltaPct > 0 ? '+' : ''}
                                {analysis.condo.bedroomSummary.threeBedTo4Bed.avgDeltaPct.toFixed(1)}%
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-gray-400">No data</div>
                          )}
                        </div>
                      </div>
                    </div>

                  </>
                )}

                {expandedSections.condoBedroom && (
                  <div className="space-y-6">
                    {Object.entries(analysis.condo.vcsBedroomGroups).map(([vcs, vcsData]) => (
                      <div key={vcs} className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-3">
                          {vcsData.description} ({vcsData.code})
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sales</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Size</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale Price</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Delta $</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Delta %</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {Object.values(vcsData.bedrooms)
                                .filter(b => b.propertiesCount && b.propertiesCount > 0) // show only bed types present in this VCS
                                .sort((a, b) => {
                                  const bedOrderValue = (label) => {
                                    if (!label) return 999;
                                    if (label === 'STUDIO') return 0;
                                    const m = label.match(/^(\d+)BED$/);
                                    if (m) return parseInt(m[1], 10);
                                    return 999;
                                  };
                                  return bedOrderValue(a.label) - bedOrderValue(b.label);
                                })
                                .map((bedroom) => (
                                <tr key={bedroom.label} className={bedroom === vcsData.baseline ? 'bg-yellow-50' : ''}>
                                  <td className="px-3 py-2 text-sm font-medium">{bedroom.label}</td>
                                  <td className="px-3 py-2 text-sm text-center">{bedroom.salesCount}</td>
                                  <td className="px-3 py-2 text-sm text-center">
                                    {bedroom.avgSize > 0 ? formatNumber(bedroom.avgSize) : '����'}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-center">
                                    {bedroom.avgPrice > 0 ? formatCurrency(bedroom.avgPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-center font-medium">
                                    {bedroom.avgAdjustedPrice > 0 ? formatCurrency(bedroom.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-center">
                                    {bedroom.avgAdjustedPrice > 0 && vcsData.baseline ?
                                      formatCurrency(bedroom.avgAdjustedPrice - vcsData.baseline.avgAdjustedPrice) :
                                      ''
                                    }
                                  </td>
                                  <td className="px-3 py-2 text-sm text-center">
                                    {bedroom.deltaPercent !== undefined ? (
                                      bedroom.deltaPercent !== 0 ? (
                                        <span className={bedroom.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                          {bedroom.deltaPercent > 0 ? '+' : ''}{bedroom.deltaPercent.toFixed(0)}%
                                        </span>
                                      ) : (
                                        <span className="text-gray-400 text-xs">BASE</span>
                                      )
                                    ) : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* End vs Interior Unit Analysis */}
              {Object.keys(analysis.condo.endIntGroups).length > 0 && (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <div
                    onClick={() => toggleSection('condoEndInt')}
                    className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                  >
                    <h3 className="text-lg font-semibold">End Unit vs Interior Unit Analysis</h3>
                    {expandedSections.condoEndInt ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </div>

                  {expandedSections.condoEndInt && (
                    <>
                      {/* Summary Banner */}
                      <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 className="font-medium text-green-900 mb-3">Overall End Unit Premium</h4>
                        <div className="grid grid-cols-2 gap-4">
                          {(() => {
                            const validVCS = Object.values(analysis.condo.endIntGroups).filter(vcs =>
                              vcs.endUnits.count > 0 && vcs.interiorUnits.count > 0
                            );
                            if (validVCS.length === 0) return <div className="col-span-2 text-sm text-gray-600">Insufficient data for comparison</div>;

                            const avgDelta = validVCS.reduce((sum, vcs) => sum + vcs.deltaCurrency, 0) / validVCS.length;
                            const avgDeltaPct = validVCS.reduce((sum, vcs) => sum + vcs.deltaPercent, 0) / validVCS.length;

                            return (
                              <>
                                <div className="bg-white rounded p-3">
                                  <div className="text-xs text-gray-600 mb-1">Average Premium (Currency)</div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {formatCurrency(avgDelta)}
                                  </div>
                                </div>
                                <div className="bg-white rounded p-3">
                                  <div className="text-xs text-gray-600 mb-1">Average Premium (Percent)</div>
                                  <div className={`text-lg font-semibold ${avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {avgDeltaPct > 0 ? '+' : ''}{avgDeltaPct.toFixed(1)}%
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* VCS Breakdown */}
                      <div className="space-y-6">
                        {Object.entries(analysis.condo.endIntGroups)
                          .filter(([_, vcsGroup]) => vcsGroup.endUnits.count > 0 || vcsGroup.interiorUnits.count > 0)
                          .map(([vcs, vcsGroup]) => (
                          <div key={vcs} className="border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-900 mb-3">
                              VCS {vcsGroup.code}
                            </h4>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit Type</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Count</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale Price</th>
                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Delta</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  <tr className="bg-yellow-50">
                                    <td className="px-3 py-2 text-sm font-medium">Interior Unit</td>
                                    <td className="px-3 py-2 text-sm text-center">{vcsGroup.interiorUnits.count}</td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {vcsGroup.interiorUnits.avgSize > 0 ? formatNumber(vcsGroup.interiorUnits.avgSize) : ''}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {vcsGroup.interiorUnits.avgPrice > 0 ? formatCurrency(vcsGroup.interiorUnits.avgPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center font-medium">
                                      <span className="text-gray-400">—</span>
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      <span className="text-gray-400 text-xs">BASELINE</span>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className="px-3 py-2 text-sm font-medium">End Unit</td>
                                    <td className="px-3 py-2 text-sm text-center">{vcsGroup.endUnits.count}</td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {vcsGroup.endUnits.avgSize > 0 ? formatNumber(vcsGroup.endUnits.avgSize) : ''}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {vcsGroup.endUnits.avgPrice > 0 ? formatCurrency(vcsGroup.endUnits.avgPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center font-medium">
                                      {vcsGroup.endUnits.avgAdjustedPrice > 0 ? formatCurrency(vcsGroup.endUnits.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {vcsGroup.endUnits.count > 0 && vcsGroup.interiorUnits.count > 0 ? (
                                        <span className={vcsGroup.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                          {vcsGroup.deltaPercent > 0 ? '+' : ''}{vcsGroup.deltaPercent.toFixed(0)}%
                                        </span>
                                      ) : (
                                        <span className="text-gray-500">—</span>
                                      )}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Floor Premium Analysis */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div
                  onClick={() => toggleSection('condoFloor')}
                  className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                >
                  <div>
                    <h3 className="text-lg font-semibold">VCS Floor Premium Analysis</h3>
                    <div className="text-xs text-gray-500 mt-1">Only condos with "CONDO" in story height description</div>
                  </div>
                  {expandedSections.condoFloor ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>

                {expandedSections.condoFloor && (
                  <>
                    {/* Floor-to-Floor Incremental Premium Summary Banner */}
                    <div className="mb-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
                      <h4 className="font-medium text-purple-900 mb-3">Incremental Floor-to-Floor Premium Summary</h4>
                      <div className="text-xs text-purple-700 mb-3">Shows premium change for each level vs. the floor immediately below</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.entries(analysis.condo.floorSummary).map(([key, summary]) => (
                          summary.hasData && (
                            <div key={key} className="bg-white rounded p-3">
                              <div className="text-xs text-gray-600 mb-1">{summary.fromFloor} → {summary.toFloor}</div>
                              <div className="text-sm font-semibold text-gray-900">
                                {formatCurrency(summary.avgDelta)}
                              </div>
                              <div className={`text-xs ${summary.avgDeltaPct > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {summary.avgDeltaPct > 0 ? '+' : ''}
                                {summary.avgDeltaPct.toFixed(1)}%
                              </div>
                            </div>
                          )
                        ))}
                        {Object.values(analysis.condo.floorSummary).every(s => !s.hasData) && (
                          <div className="col-span-full text-sm text-gray-400 text-center py-2">No floor-to-floor data available</div>
                        )}
                      </div>
                    </div>

                    {/* VCS Breakdown */}
                    <div className="space-y-6">
                      {Object.entries(analysis.condo.vcsFloorGroups).map(([vcs, vcsData]) => (
                        <div key={vcs} className="border border-gray-200 rounded-lg p-4">
                          <h4 className="font-medium text-gray-900 mb-3">VCS {vcsData.code}</h4>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Floor</th>
                                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sales</th>
                                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Size</th>
                                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale Price</th>
                                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Premium vs 1st</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {Object.values(vcsData.floors)
                                  .sort((a, b) => {
                                    const order = ['1ST FLOOR', '2ND FLOOR', '3RD FLOOR', '4TH FLOOR', '5TH FLOOR', 'TOP FLOOR', 'PENTHOUSE', 'Unknown'];
                                    return order.indexOf(a.label) - order.indexOf(b.label);
                                  })
                                  .map((floor) => (
                                  <tr key={floor.label} className={floor.isBaseline ? 'bg-yellow-50' : ''}>
                                    <td className="px-3 py-2 text-sm font-medium">{floor.label}</td>
                                    <td className="px-3 py-2 text-sm text-center">{floor.count}</td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {floor.avgSize > 0 ? formatNumber(floor.avgSize) : ''}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {floor.avgPrice > 0 ? formatCurrency(floor.avgPrice) : <span className="text-gray-500 text-xs">NO DATA</span>}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center font-medium">
                                      {floor.isBaseline ? (
                                        <span className="text-gray-400">—</span>
                                      ) : floor.avgAdjustedPrice > 0 ? (
                                        formatCurrency(floor.avgAdjustedPrice)
                                      ) : (
                                        <span className="text-gray-500 text-xs">NO DATA</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-sm text-center">
                                      {floor.isBaseline ? (
                                        <span className="text-gray-400 text-xs">BASELINE</span>
                                      ) : (floor.deltaPercent !== 0 && floor.deltaPercent != null) ? (
                                        <span className={floor.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                          {floor.deltaPercent > 0 ? '+' : ''}{floor.deltaPercent.toFixed(0)}%
                                        </span>
                                      ) : (
                                        '��'
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="bg-gray-50 rounded-lg p-8 text-center">
              <Building className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <div className="text-gray-600">No condominiums found in this dataset</div>
              <div className="text-sm text-gray-500 mt-2">
                Condos are identified by Type Use codes starting with 6
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OverallAnalysisTab;
