import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { interpretCodes } from '../../../lib/supabaseClient';
import { 
  TrendingUp, RefreshCw, Download, Filter, ChevronDown, ChevronUp,
  AlertCircle, Home, Building, Calendar, MapPin, Layers, DollarSign
} from 'lucide-react';

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
          salesCount: 0      // Valid sales only
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

    // Calculate averages and adjusted prices
    let maxAdjustedPrice = 0;
    let baselineGroup = null;

    Object.values(groups).forEach(group => {
      // Averages for ALL properties in this group
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;
      
      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
      
      // Calculate adjusted prices using sales average size
      let totalAdjusted = 0;
      if (group.salesCount > 0) {
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            group.avgSizeSales  // Use sales average for normalization
          );
          totalAdjusted += adjusted;
        });
        
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
        
        if (group.avgAdjustedPrice > maxAdjustedPrice) {
          maxAdjustedPrice = group.avgAdjustedPrice;
          baselineGroup = group;
        }
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // After computing avgAdjustedPrice, prefer Single Family as baseline if available with sales
    const groupsArray = Object.values(groups);
    const sfGroup = groupsArray.find(g => g.code && g.code.toString().startsWith('1') && g.salesCount > 0);
    if (sfGroup) {
      baselineGroup = sfGroup;
    }

    // Calculate deltas from baseline (baselineGroup may have been overridden to SF)
    Object.values(groups).forEach(group => {
      if (baselineGroup && group !== baselineGroup && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - baselineGroup.avgAdjustedPrice;
        group.delta = delta;
        group.deltaPercent = baselineGroup.avgAdjustedPrice > 0 ?
          (delta / baselineGroup.avgAdjustedPrice * 100) : 0;
      } else {
        group.delta = 0;
        group.deltaPercent = 0;
      }

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
          salesCount: 0
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

    // Calculate averages and adjusted prices
    let maxAdjustedPrice = 0;
    let baselineGroup = null;

    Object.values(groups).forEach(group => {
      // Averages for ALL properties in this group
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;
      
      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
      
      // Calculate adjusted prices using sales average size
      let totalAdjusted = 0;
      if (group.salesCount > 0) {
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            group.avgSizeSales  // Use sales average for normalization
          );
          totalAdjusted += adjusted;
        });
        
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
        
        if (group.avgAdjustedPrice > maxAdjustedPrice) {
          maxAdjustedPrice = group.avgAdjustedPrice;
          baselineGroup = group;
        }
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Use custom baseline if set, otherwise use highest adjusted price
    const actualBaseline = customBaselines.design ? 
      Object.values(groups).find(g => g.code === customBaselines.design) || baselineGroup :
      baselineGroup;

    // Calculate deltas from baseline
    Object.values(groups).forEach(group => {
      if (actualBaseline && group !== actualBaseline && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - actualBaseline.avgAdjustedPrice;
        group.delta = delta;
        group.deltaPercent = actualBaseline.avgAdjustedPrice > 0 ? 
          (delta / actualBaseline.avgAdjustedPrice * 100) : 0;
      } else if (group === actualBaseline || group.salesCount === 0) {
        group.delta = 0;
        group.deltaPercent = 0;
      }
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
        salesCount: 0 
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
        salesCount: 0 
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
        salesCount: 0 
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
        salesCount: 0 
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
        salesCount: 0 
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

    // Calculate averages and adjusted prices
    let maxAdjustedPrice = 0;
    let baselineGroup = null;

    Object.values(groups).forEach(group => {
      // Averages for ALL properties
      group.avgSizeAll = group.propertyCount > 0 ? group.totalSizeAll / group.propertyCount : 0;
      group.avgYearAll = group.propertyCount > 0 ? Math.round(group.totalYearAll / group.propertyCount) : 0;
      
      // Averages for SALES only
      group.avgPrice = group.salesCount > 0 ? group.totalPrice / group.salesCount : 0;
      group.avgSizeSales = group.salesCount > 0 ? group.totalSizeSales / group.salesCount : 0;
      group.avgYearSales = group.salesCount > 0 ? Math.round(group.totalYearSales / group.salesCount) : 0;
      
      // Calculate adjusted prices using sales average size
      let totalAdjusted = 0;
      if (group.salesCount > 0) {
        group.salesProperties.forEach(p => {
          const adjusted = calculateAdjustedPrice(
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
            p.asset_sfla || 0,
            group.avgSizeSales
          );
          totalAdjusted += adjusted;
        });
        
        group.avgAdjustedPrice = totalAdjusted / group.salesCount;
        
        if (group.avgAdjustedPrice > maxAdjustedPrice) {
          maxAdjustedPrice = group.avgAdjustedPrice;
          baselineGroup = group;
        }
      } else {
        group.avgAdjustedPrice = 0;
      }
    });

    // Calculate deltas from baseline
    Object.values(groups).forEach(group => {
      if (baselineGroup && group !== baselineGroup && group.salesCount > 0) {
        const delta = group.avgAdjustedPrice - baselineGroup.avgAdjustedPrice;
        group.delta = delta;
        group.deltaPercent = baselineGroup.avgAdjustedPrice > 0 ? 
          (delta / baselineGroup.avgAdjustedPrice * 100) : 0;
      } else {
        group.delta = 0;
        group.deltaPercent = 0;
      }
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
          types: {}
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
          designs: {}
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
      
      // Find baseline for this VCS (highest adjusted price)
      let maxTypePrice = 0;
      let baselineType = null;
      
      // Type level calculations
      Object.values(vcsGroup.types).forEach(typeGroup => {
        typeGroup.avgSizeAll = typeGroup.propertyCount > 0 ? typeGroup.totalSizeAll / typeGroup.propertyCount : 0;
        typeGroup.avgYearAll = typeGroup.propertyCount > 0 ? Math.round(typeGroup.totalYearAll / typeGroup.propertyCount) : 0;
        
        typeGroup.avgPrice = typeGroup.salesCount > 0 ? typeGroup.totalPrice / typeGroup.salesCount : 0;
        typeGroup.avgSizeSales = typeGroup.salesCount > 0 ? typeGroup.totalSizeSales / typeGroup.salesCount : 0;
        typeGroup.avgYearSales = typeGroup.salesCount > 0 ? Math.round(typeGroup.totalYearSales / typeGroup.salesCount) : 0;
        
        // Calculate type adjusted price
        let typeTotalAdjusted = 0;
        if (typeGroup.salesCount > 0) {
          typeGroup.salesProperties.forEach(p => {
            const adjusted = calculateAdjustedPrice(
              (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
              p.asset_sfla || 0,
              typeGroup.avgSizeSales
            );
            typeTotalAdjusted += adjusted;
          });
          typeGroup.avgAdjustedPrice = typeTotalAdjusted / typeGroup.salesCount;
          
          if (typeGroup.avgAdjustedPrice > maxTypePrice) {
            maxTypePrice = typeGroup.avgAdjustedPrice;
            baselineType = typeGroup;
          }
        } else {
          typeGroup.avgAdjustedPrice = 0;
        }
        
        // Design level calculations
        let maxDesignPrice = 0;
        let baselineDesign = null;
        
        Object.values(typeGroup.designs).forEach(designGroup => {
          designGroup.avgSizeAll = designGroup.propertyCount > 0 ? designGroup.totalSizeAll / designGroup.propertyCount : 0;
          designGroup.avgYearAll = designGroup.propertyCount > 0 ? Math.round(designGroup.totalYearAll / designGroup.propertyCount) : 0;
          
          designGroup.avgPrice = designGroup.salesCount > 0 ? designGroup.totalPrice / designGroup.salesCount : 0;
          designGroup.avgSizeSales = designGroup.salesCount > 0 ? designGroup.totalSizeSales / designGroup.salesCount : 0;
          designGroup.avgYearSales = designGroup.salesCount > 0 ? Math.round(designGroup.totalYearSales / designGroup.salesCount) : 0;
          
          // Calculate design adjusted price
          let designTotalAdjusted = 0;
          if (designGroup.salesCount > 0) {
            designGroup.salesProperties.forEach(p => {
              const adjusted = calculateAdjustedPrice(
                (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
                p.asset_sfla || 0,
                designGroup.avgSizeSales
              );
              designTotalAdjusted += adjusted;
            });
            designGroup.avgAdjustedPrice = designTotalAdjusted / designGroup.salesCount;
            
            if (designGroup.avgAdjustedPrice > maxDesignPrice) {
              maxDesignPrice = designGroup.avgAdjustedPrice;
              baselineDesign = designGroup;
            }
          } else {
            designGroup.avgAdjustedPrice = 0;
          }
        });
        
        // Calculate design deltas within type
        Object.values(typeGroup.designs).forEach(designGroup => {
          if (baselineDesign && designGroup !== baselineDesign && designGroup.salesCount > 0) {
            designGroup.deltaPercent = baselineDesign.avgAdjustedPrice > 0 ? 
              ((designGroup.avgAdjustedPrice - baselineDesign.avgAdjustedPrice) / baselineDesign.avgAdjustedPrice * 100) : 0;
          } else {
            designGroup.deltaPercent = 0;
          }
        });
        
        typeGroup.baselineDesign = baselineDesign;
      });
      
      // Calculate type deltas within VCS
      Object.values(vcsGroup.types).forEach(typeGroup => {
        if (baselineType && typeGroup !== baselineType && typeGroup.salesCount > 0) {
          typeGroup.deltaPercent = baselineType.avgAdjustedPrice > 0 ? 
            ((typeGroup.avgAdjustedPrice - baselineType.avgAdjustedPrice) / baselineType.avgAdjustedPrice * 100) : 0;
        } else {
          typeGroup.deltaPercent = 0;
        }
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

    // Design Analysis
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
      
      const key = `${designCode}-${designName}`;
      
      if (!designGroups[key]) {
        designGroups[key] = {
          code: designCode,
          name: designName,
          properties: [],
          totalPrice: 0,
          totalSize: 0,
          count: 0
        };
      }
      
      designGroups[key].properties.push(p);
      designGroups[key].count++;
      designGroups[key].totalPrice += (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0));
      designGroups[key].totalSize += p.asset_sfla || 0;
    });

    // Calculate averages for designs
    Object.values(designGroups).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
      group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
      
      // Calculate adjusted prices
      let totalAdjusted = 0;
      group.properties.forEach(p => {
        const adjusted = calculateAdjustedPrice(
          (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
          p.asset_sfla || 0,
          group.avgSize
        );
        totalAdjusted += adjusted;
      });
      
      group.avgAdjustedPrice = group.count > 0 ? totalAdjusted / group.count : 0;
    });

    // Find baseline design
    let maxDesignPrice = 0;
    let baselineDesign = null;
    Object.values(designGroups).forEach(group => {
      if (group.avgAdjustedPrice > maxDesignPrice) {
        maxDesignPrice = group.avgAdjustedPrice;
        baselineDesign = group;
      }
    });

    // Calculate design deltas
    Object.values(designGroups).forEach(group => {
      if (baselineDesign && group !== baselineDesign) {
        group.deltaPercent = baselineDesign.avgAdjustedPrice > 0 ? 
          ((group.avgAdjustedPrice - baselineDesign.avgAdjustedPrice) / baselineDesign.avgAdjustedPrice * 100) : 0;
      } else {
        group.deltaPercent = 0;
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
      if (bedrooms === 'Unknown') {
        const candidate = p.asset_bedrooms || p.asset_bedroom_count || p.bedrooms || p.bedrm || p.bed_total || p.BEDTOT || null;
        const n = parseInt(candidate);
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
          salesCount: 0
        };
      }

      const bedroomGroup = vcsBedroomGroups[vcs].bedrooms[bedrooms];
      bedroomGroup.properties.push(p);
      bedroomGroup.propertiesCount++;
      bedroomGroup.totalSize += p.asset_sfla || 0;
      // If this property has a normalized sale, count it as a sale
      if (p.values_norm_time && p.values_norm_time > 0) {
        bedroomGroup.salesProperties.push(p);
        bedroomGroup.salesCount++;
        bedroomGroup.totalPrice += (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0));
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
            (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
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

    // Floor Analysis
    const floorGroups = {};
    condos.forEach(p => {
      // Look for floor info in story height or design - use only synchronous decoding
      const storyHeight = p.asset_story_height || '';
      const storyStr = String(storyHeight).toUpperCase();
      const designName = codeDefinitions ? (vendorType === 'Microsystems' ? interpretCodes.getMicrosystemsValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : (vendorType === 'BRT' ? interpretCodes.getBRTValue?.(p, codeDefinitions, 'asset_design_style') || p.asset_design_style || '' : p.asset_design_style || '')) : p.asset_design_style || '';
      const designStr = String(designName).toUpperCase();
      let floor = 'Unknown';

      if (storyStr.includes('1ST') || designStr.includes('1ST FLOOR')) floor = '1ST FLOOR';
      else if (storyStr.includes('2ND') || designStr.includes('2ND FLOOR')) floor = '2ND FLOOR';
      else if (storyStr.includes('3RD') || designStr.includes('3RD FLOOR')) floor = '3RD FLOOR';
      else if (storyStr.includes('TOP') || designStr.includes('TOP FLOOR')) floor = 'TOP FLOOR';
      
      if (!floorGroups[floor]) {
        floorGroups[floor] = {
          label: floor,
          properties: [],
          totalPrice: 0,
          totalSize: 0,
          count: 0
        };
      }
      
      floorGroups[floor].properties.push(p);
      floorGroups[floor].count++;
      floorGroups[floor].totalPrice += (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0));
      floorGroups[floor].totalSize += p.asset_sfla || 0;
    });

    // Calculate floor averages
    Object.values(floorGroups).forEach(group => {
      group.avgPrice = group.count > 0 ? group.totalPrice / group.count : 0;
      group.avgSize = group.count > 0 ? group.totalSize / group.count : 0;
      
      // Calculate adjusted prices
      let totalAdjusted = 0;
      group.properties.forEach(p => {
        const adjusted = calculateAdjustedPrice(
          (p._time_normalized_price !== undefined ? p._time_normalized_price : (p.values_norm_time || 0)),
          p.asset_sfla || 0,
          group.avgSize
        );
        totalAdjusted += adjusted;
      });
      
      group.avgAdjustedPrice = group.count > 0 ? totalAdjusted / group.count : 0;
    });

    // Calculate floor premiums
    const firstFloor = floorGroups['1ST FLOOR'];
    if (firstFloor && firstFloor.avgAdjustedPrice > 0) {
      Object.values(floorGroups).forEach(group => {
        if (group !== firstFloor) {
          group.deltaPercent = ((group.avgAdjustedPrice - firstFloor.avgAdjustedPrice) / firstFloor.avgAdjustedPrice * 100);
        } else {
          group.deltaPercent = 0;
        }
      });
    }

    return {
      totalCondos: condos.length,
      designGroups: Object.values(designGroups),
      vcsBedroomGroups,
      floorGroups: Object.values(floorGroups),
      baselineDesign
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

            const candidate = p.asset_bedrooms || p.asset_bedroom_count || p.bedrooms || p.bedrm || p.bed_total || p.BEDTOT || null;
            const n = parseInt(candidate);
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
          const yearAll = group.avgYearAll || '—';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '—';
          const yearSales = group.avgYearSales || '—';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '—';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '—';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '—';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '—' : 'BASELINE';
          const cmeBracket = group.cmeBracket ? group.cmeBracket.label : '—';
          
          csv += `"${group.code} - ${group.name}",${group.propertyCount},${yearAll},${sizeAll},${group.salesCount},${yearSales},${sizeSales},${salePrice},${adjPrice},${delta},"${cmeBracket}"\n`;
        });
        break;
        
      case 'design':
        csv = 'DESIGN AND STYLE ANALYSIS\n';
        csv += 'DESCRIPTION,TOTAL PROPERTIES,AVG YEAR (ALL),AVG SIZE (ALL),TOTAL SALES,AVG YEAR (SALES),AVG SIZE (SALES),SALE PRICE,ADJ PRICE,DELTA\n';
        analysis.design.groups.forEach(group => {
          const yearAll = group.avgYearAll || '—';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '—';
          const yearSales = group.avgYearSales || '—';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '—';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '—';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '—';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '—' : 'BASELINE';
          
          csv += `"${group.name}",${group.propertyCount},${yearAll},${sizeAll},${group.salesCount},${yearSales},${sizeSales},${salePrice},${adjPrice},${delta}\n`;
        });
        break;
        
      case 'yearBuilt':
        csv = 'YEAR BUILT ANALYSIS\n';
        csv += 'CATEGORY,TOTAL PROPERTIES,AVG YEAR (ALL),AVG SIZE (ALL),TOTAL SALES,AVG YEAR (SALES),AVG SIZE (SALES),SALE PRICE,ADJ PRICE,DELTA,CCF\n';
        analysis.yearBuilt.groups.forEach(group => {
          const yearAll = group.avgYearAll || '—';
          const sizeAll = group.avgSizeAll ? Math.round(group.avgSizeAll) : '—';
          const yearSales = group.avgYearSales || '—';
          const sizeSales = group.avgSizeSales ? Math.round(group.avgSizeSales) : '—';
          const salePrice = group.salesCount > 0 ? Math.round(group.avgPrice) : '—';
          const adjPrice = group.salesCount > 0 ? Math.round(group.avgAdjustedPrice) : '—';
          const delta = group.salesCount > 0 && group.deltaPercent !== 0 ? `${group.deltaPercent.toFixed(0)}%` : group.salesCount === 0 ? '—' : 'BASELINE';
          
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
  // ==================== MAIN RENDER ====================
  
  return (
    <div className="max-w-full mx-auto space-y-6">
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
              onClick={runAnalysis}
              disabled={isProcessing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`} />
              {isProcessing ? 'Processing...' : 'Refresh'}
            </button>
            
            <button
              onClick={() => exportToCSV('all')}
              disabled={!analysis}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Export All
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
        <div className="flex space-x-1 border-b mt-4">
          <button
            onClick={() => setActiveTab('market')}
            className={`px-4 py-2 font-medium ${
              activeTab === 'market'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Market Analysis
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
                              {group.avgYearAll > 0 ? group.avgYearAll : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount > 0 ? formatCurrency(group.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
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
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => exportToCSV('typeUse')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Export Type & Use Data
                    </button>
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
                              {group.avgYearAll > 0 ? group.avgYearAll : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount > 0 ? formatCurrency(group.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
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
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => exportToCSV('design')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Export Design Data
                    </button>
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
                              {group.avgYearAll > 0 ? group.avgYearAll : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeAll > 0 ? formatNumber(group.avgSizeAll) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">{group.salesCount}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgYearSales > 0 ? group.avgYearSales : '���'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgSizeSales > 0 ? formatNumber(group.avgSizeSales) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.salesCount > 0 ? formatCurrency(group.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {group.salesCount > 0 ? formatCurrency(group.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
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
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => exportToCSV('yearBuilt')}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Export Year Built Data
                    </button>
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
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgYearAll > 0 ? typeGroup.avgYearAll : '—'}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgSizeAll > 0 ? formatNumber(typeGroup.avgSizeAll) : '—'}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgYearSales > 0 ? typeGroup.avgYearSales : '—'}</div>
                                  <div className="col-span-1 text-center text-sm">{typeGroup.avgSizeSales > 0 ? formatNumber(typeGroup.avgSizeSales) : '—'}</div>
                                  <div className="col-span-1 text-center text-sm">
                                    {typeGroup.salesCount > 0 ? formatCurrency(typeGroup.avgPrice) : '—'}
                                  </div>
                                  <div className="col-span-1 text-center text-sm font-medium">
                                    {typeGroup.salesCount > 0 ? formatCurrency(typeGroup.avgAdjustedPrice) : '—'}
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
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgYearAll > 0 ? designGroup.avgYearAll : '—'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgSizeAll > 0 ? formatNumber(designGroup.avgSizeAll) : '—'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgYearSales > 0 ? designGroup.avgYearSales : '—'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">{designGroup.avgSizeSales > 0 ? formatNumber(designGroup.avgSizeSales) : '�����'}</div>
                                      <div className="col-span-1 text-center text-xs text-gray-600">
                                        {designGroup.salesCount > 0 ? formatCurrency(designGroup.avgPrice) : '—'}
                                      </div>
                                      <div className="col-span-1 text-center text-xs font-medium">
                                        {designGroup.salesCount > 0 ? formatCurrency(designGroup.avgAdjustedPrice) : '—'}
                                      </div>
                                      <div className="col-span-1 text-center text-xs">
                                        {designGroup.salesCount === 0 ? (
                                          <span className="text-gray-400">—</span>
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
                    <div className="text-2xl font-bold">{analysis.condo.floorGroups.length}</div>
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
                    <div className="text-xs text-gray-500 mt-1">Type Use: 6 (Microsystems) / 60 (BRT)</div>
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
                          <tr key={group.code} className={group === analysis.condo.baselineDesign ? 'bg-yellow-50' : ''}>
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
                              {group.avgAdjustedPrice > 0 ? formatCurrency(group.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {group.avgAdjustedPrice === 0 ? (
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
                                    {bedroom.avgSize > 0 ? formatNumber(bedroom.avgSize) : '—'}
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
                                      '—'
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
                                    ) : '—'}
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

              {/* Floor Analysis */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div 
                  onClick={() => toggleSection('condoFloor')}
                  className="flex justify-between items-center mb-4 cursor-pointer hover:bg-gray-50 -m-2 p-2 rounded"
                >
                  <h3 className="text-lg font-semibold">Floor Premium Analysis</h3>
                  {expandedSections.condoFloor ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                </div>
                
                {expandedSections.condoFloor && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Floor</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sales</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Size</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Adj Sale Price</th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Premium vs 1st</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {analysis.condo.floorGroups
                          .sort((a, b) => {
                            const order = ['1ST FLOOR', '2ND FLOOR', '3RD FLOOR', 'TOP FLOOR', 'Unknown'];
                            return order.indexOf(a.label) - order.indexOf(b.label);
                          })
                          .map((floor) => (
                          <tr key={floor.label} className={floor.label === '1ST FLOOR' ? 'bg-yellow-50' : ''}>
                            <td className="px-4 py-3 text-sm font-medium">{floor.label}</td>
                            <td className="px-4 py-3 text-sm text-center">{floor.count}</td>
                            <td className="px-4 py-3 text-sm text-center">{formatNumber(floor.avgSize)}</td>
                            <td className="px-4 py-3 text-sm text-center">
                              {floor.avgPrice > 0 ? formatCurrency(floor.avgPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center font-medium">
                              {floor.avgAdjustedPrice > 0 ? formatCurrency(floor.avgAdjustedPrice) : <span className="text-gray-500 text-xs">NO SALES DATA</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {floor.label === '1ST FLOOR' ? (
                                <span className="text-gray-400">BASELINE</span>
                              ) : floor.deltaPercent !== undefined ? (
                                <span className={floor.deltaPercent > 0 ? 'text-green-600' : 'text-red-600'}>
                                  {floor.deltaPercent > 0 ? '+' : ''}{floor.deltaPercent.toFixed(0)}%
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Data Quality Notice */}
              {analysis.condo.floorGroups.some(g => g.label === 'Unknown' && g.count > 0) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                      <div className="font-medium text-yellow-900">Limited Floor Data</div>
                      <div className="text-sm text-yellow-800 mt-1">
                        {analysis.condo.floorGroups.find(g => g.label === 'Unknown')?.count || 0} condos 
                        without floor designation. Update story height field in code file to improve analysis.
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
