  import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, interpretCodes, worksheetService } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx';
import { 
  TrendingUp, 
  Download, 
  Save,
  RefreshCw,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

const PreValuationTab = ({ jobData, properties }) => {
  // ==================== STATE MANAGEMENT ====================
  
  // Normalization Configuration State (matching HTML UI)
  const [normalizeToYear, setNormalizeToYear] = useState(2025);
  const [salesFromYear, setSalesFromYear] = useState(2012);
  const [selectedCounty, setSelectedCounty] = useState(jobData?.county || 'Bergen');
  const [availableCounties, setAvailableCounties] = useState([]);
  const [equalizationRatio, setEqualizationRatio] = useState('');
  const [outlierThreshold, setOutlierThreshold] = useState('');
  const [minSalePrice, setMinSalePrice] = useState(100);
  
  // Normalization Data State
  const [activeSubTab, setActiveSubTab] = useState('normalization');
  const [hpiData, setHpiData] = useState([]);
  const [hpiLoaded, setHpiLoaded] = useState(false);
  const [timeNormalizedSales, setTimeNormalizedSales] = useState([]);
  const [isProcessingTime, setIsProcessingTime] = useState(false);
  const [isProcessingSize, setIsProcessingSize] = useState(false);
  const [salesReviewFilter, setSalesReviewFilter] = useState('all');
  const [normalizationStats, setNormalizationStats] = useState({
    totalSales: 0,
    timeNormalized: 0,
    excluded: 0,
    flaggedOutliers: 0,
    pendingReview: 0,
    averageRatio: 0,
    // Size normalization stats
    acceptedSales: 0,
    sizeNormalized: 0,
    singleFamily: 0,
    multifamily: 0,
    townhouses: 0,
    conversions: 0,
    avgSizeAdjustment: 0
  });

  // Page by Page Worksheet State
  const [worksheetProperties, setWorksheetProperties] = useState([]);
  const [filteredWorksheetProps, setFilteredWorksheetProps] = useState([]);
  const [worksheetSearchTerm, setWorksheetSearchTerm] = useState('');
  const [worksheetFilter, setWorksheetFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [normCurrentPage, setNormCurrentPage] = useState(1);
  const [normItemsPerPage] = useState(100);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [readyProperties, setReadyProperties] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });
  const [normSortConfig, setNormSortConfig] = useState({ field: null, direction: 'asc' });
  const [locationVariations, setLocationVariations] = useState({});
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [currentLocationChoice, setCurrentLocationChoice] = useState(null);
  const [worksheetStats, setWorksheetStats] = useState({
    totalProperties: 0,
    vcsAssigned: 0,
    zoningEntered: 0,
    locationAnalysis: 0,
    readyToProcess: 0
  });
  const [autoSaveTimer, setAutoSaveTimer] = useState(null);
  
  // Import Modal State (from our discussion)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [isAnalyzingImport, setIsAnalyzingImport] = useState(false);
  const [importOptions, setImportOptions] = useState({
    updateExisting: true,
    useAddressFuzzyMatch: true,
    fuzzyMatchThreshold: 0.8,
    markImportedAsReady: true
  });
  const [standardizations, setStandardizations] = useState({
    vcs: {},
    locations: {},
    zones: {}
  });
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, message: '' });

  // Market Analysis State
  const [marketAnalysisData, setMarketAnalysisData] = useState([]);
  const [blockTypeFilter, setBlockTypeFilter] = useState('single_family');
  const [colorScaleStart, setColorScaleStart] = useState(100000);
  const [colorScaleIncrement, setColorScaleIncrement] = useState(50000);
  const [selectedBlockDetails, setSelectedBlockDetails] = useState(null);
  const [showBlockDetailModal, setShowBlockDetailModal] = useState(false);
  const [isProcessingBlocks, setIsProcessingBlocks] = useState(false);

  // Vendor detection
  const vendorType = jobData?.vendor_source || jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

  // Bluebeam Revu 32-color palette
  const bluebeamPalette = [
    // Row 1 - Light colors
    { hex: "#FFFFFF", name: "White", row: 1, col: 1 },
    { hex: "#FFCCCC", name: "Light Pink", row: 1, col: 2 },
    { hex: "#FFE6CC", name: "Light Orange", row: 1, col: 3 },
    { hex: "#FFFFCC", name: "Light Yellow", row: 1, col: 4 },
    { hex: "#E6FFCC", name: "Light Green", row: 1, col: 5 },
    { hex: "#CCFFFF", name: "Light Cyan", row: 1, col: 6 },
    { hex: "#CCE6FF", name: "Light Blue", row: 1, col: 7 },
    { hex: "#E6CCFF", name: "Light Purple", row: 1, col: 8 },
    // Row 2 - Medium colors
    { hex: "#CCCCCC", name: "Light Gray", row: 2, col: 1 },
    { hex: "#FF9999", name: "Pink", row: 2, col: 2 },
    { hex: "#FFCC99", name: "Peach", row: 2, col: 3 },
    { hex: "#FFFF99", name: "Yellow", row: 2, col: 4 },
    { hex: "#CCFF99", name: "Light Green", row: 2, col: 5 },
    { hex: "#99FFFF", name: "Cyan", row: 2, col: 6 },
    { hex: "#99CCFF", name: "Sky Blue", row: 2, col: 7 },
    { hex: "#CC99FF", name: "Purple", row: 2, col: 8 },
    // Row 3 - Darker colors
    { hex: "#999999", name: "Gray", row: 3, col: 1 },
    { hex: "#FF6666", name: "Red", row: 3, col: 2 },
    { hex: "#FF9966", name: "Orange", row: 3, col: 3 },
    { hex: "#FFFF66", name: "Bright Yellow", row: 3, col: 4 },
    { hex: "#99FF66", name: "Green", row: 3, col: 5 },
    { hex: "#66FFFF", name: "Bright Cyan", row: 3, col: 6 },
    { hex: "#6699FF", name: "Bright Blue", row: 3, col: 7 },
    { hex: "#9966FF", name: "Bright Purple", row: 3, col: 8 },
    // Row 4 - Saturated colors
    { hex: "#666666", name: "Dark Gray", row: 4, col: 1 },
    { hex: "#FF3333", name: "Bright Red", row: 4, col: 2 },
    { hex: "#FF6633", name: "Bright Orange", row: 4, col: 3 },
    { hex: "#FFFF33", name: "Neon Yellow", row: 4, col: 4 },
    { hex: "#66FF33", name: "Neon Green", row: 4, col: 5 },
    { hex: "#33FFFF", name: "Electric Cyan", row: 4, col: 6 },
    { hex: "#3366FF", name: "Electric Blue", row: 4, col: 7 },
    { hex: "#6633FF", name: "Electric Purple", row: 4, col: 8 }
  ];

  // ==================== HELPER FUNCTIONS USING interpretCodes ====================
  
  const getBuildingClassDisplay = useCallback((property) => {
    if (!property) return '';
    
    // Use interpretCodes to get the proper display name
    const className = interpretCodes.getBuildingClassName?.(
      property, 
      codeDefinitions, 
      vendorType
    );
    
    return className || property.asset_building_class || '';
  }, [codeDefinitions, vendorType]);

  const getTypeUseDisplay = useCallback((property) => {
    if (!property) return '';
    
    // Use interpretCodes to get the proper type/use name
    const typeName = interpretCodes.getTypeName?.(
      property, 
      codeDefinitions, 
      vendorType
    );
    
    return typeName || property.asset_type_use || '';
  }, [codeDefinitions, vendorType]);

  const getDesignDisplay = useCallback((property) => {
    if (!property) return '';
    
    // Use interpretCodes to get the proper design name
    const designName = interpretCodes.getDesignName?.(
      property, 
      codeDefinitions, 
      vendorType
    );
    
    return designName || property.asset_design_style || '';
  }, [codeDefinitions, vendorType]);

  const parseCompositeKey = useCallback((compositeKey) => {
    if (!compositeKey) return { block: '', lot: '', qualifier: '', card: '', location: '' };
    
    // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
    const parts = compositeKey.split('-');
    if (parts.length < 3) return { block: '', lot: '', qualifier: '', card: '', location: '' };
    
    const block = parts[1] || '';
    const lotQual = parts[2] || '';
    const [lot, qualifier] = lotQual.split('_');
    
    return {
      block,
      lot: lot || '',
      qualifier: qualifier === 'NONE' ? '' : qualifier || '',
      card: parts[3] === 'NONE' ? '' : parts[3] || '',
      location: parts[4] === 'NONE' ? '' : parts[4] || ''
    };
  }, []);

  // Load available counties from database
useEffect(() => {
  const loadAvailableCounties = async () => {
    try {
      const { data, error } = await supabase
        .from('county_hpi_data')
        .select('county_name')
        .order('county_name');
      
      if (error) throw error;
      
      // Get unique counties
      const uniqueCounties = [...new Set(data.map(item => item.county_name))];
      setAvailableCounties(uniqueCounties);
      
      // Set default to job's county or first available
      if (uniqueCounties.length > 0 && !selectedCounty) {
        setSelectedCounty(jobData?.county || uniqueCounties[0]);
      }
      
      console.log(`📍 Found ${uniqueCounties.length} counties with HPI data:`, uniqueCounties);
    } catch (error) {
      console.error('Error loading counties:', error);
    }
  };
  
  loadAvailableCounties();
}, []);  

  // ==================== HPI DATA LOADING ====================
  useEffect(() => {
    const loadHPIData = async () => {
      if (!selectedCounty) return;
      
      try {
      const { data, error } = await supabase
        .from('county_hpi_data')
        .select('*')
        .eq('county_name', selectedCounty)
        .order('observation_year', { ascending: true });
        
        if (error) throw error;
        
        setHpiData(data || []);
        setHpiLoaded(true);
        console.log(`📈 Loaded ${data?.length || 0} years of HPI data for ${selectedCounty} County`);
      } catch (error) {
        console.error('Error loading HPI data:', error);
        setHpiLoaded(false);
      }
    };

    loadHPIData();
  }, [selectedCounty]);
  // ==================== LOAD SAVED NORMALIZATION DATA ====================
  useEffect(() => {
    const loadSavedNormalizationData = async () => {
      if (!jobData?.id) return;
      
      try {
        const savedData = await worksheetService.loadNormalizationData(jobData.id);
        
        if (savedData) {
          // Restore configuration
          if (savedData.normalization_config) {
            const config = savedData.normalization_config;
            if (config.equalizationRatio !== undefined) setEqualizationRatio(config.equalizationRatio);
            if (config.outlierThreshold !== undefined) setOutlierThreshold(config.outlierThreshold);
            if (config.normalizeToYear !== undefined) setNormalizeToYear(config.normalizeToYear);
            if (config.salesFromYear !== undefined) setSalesFromYear(config.salesFromYear);
            if (config.minSalePrice !== undefined) setMinSalePrice(config.minSalePrice);
            if (config.selectedCounty !== undefined) setSelectedCounty(config.selectedCounty);
          }
          
          // Restore normalized sales
          if (savedData.time_normalized_sales && savedData.time_normalized_sales.length > 0) {
            setTimeNormalizedSales(savedData.time_normalized_sales);
          }
          
          // Restore stats
          if (savedData.normalization_stats) {
            setNormalizationStats(savedData.normalization_stats);
          }
          
          console.log('✅ Loaded saved normalization data');
        }
      } catch (error) {
        console.error('Error loading saved normalization data:', error);
      }
    };
    
    loadSavedNormalizationData();
  }, [jobData?.id]);

  // ==================== WORKSHEET INITIALIZATION ====================
  useEffect(() => {
    if (properties && properties.length > 0) {
      const worksheetData = properties.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        
        return {
          id: prop.id,
          property_composite_key: prop.property_composite_key,
          ...parsed,
          property_location: prop.property_location,
          property_class: prop.property_class || prop.property_m4_class,
          property_vcs: prop.property_vcs || prop.current_vcs || '',
          new_vcs: prop.new_vcs || '',
          location_analysis: prop.location_analysis || '',
          asset_zoning: prop.asset_zoning || '',
          asset_map_page: prop.asset_map_page || '',
          asset_key_page: prop.asset_key_page || '',
          worksheet_notes: prop.worksheet_notes || '',
          // Add raw fields for decoding
          asset_building_class: prop.asset_building_class,
          asset_type_use: prop.asset_type_use,
          asset_design_style: prop.asset_design_style,
          sections: prop.sections,  // For BRT
          // Display values
          building_class_display: getBuildingClassDisplay(prop),
          type_use_display: getTypeUseDisplay(prop),
          design_display: getDesignDisplay(prop)
        };
      });

      // Sort by block then lot (both as numbers)
      worksheetData.sort((a, b) => {
        const blockA = parseInt(a.block) || 0;
        const blockB = parseInt(b.block) || 0;
        
        if (blockA !== blockB) {
          return blockA - blockB;
        }
        
        // If blocks are same, sort by lot (handle decimals like 3.01, 3.02)
        const lotA = parseFloat(a.lot) || 0;
        const lotB = parseFloat(b.lot) || 0;
        
        return lotA - lotB;
      });

      setWorksheetProperties(worksheetData);
      setFilteredWorksheetProps(worksheetData);
      updateWorksheetStats(worksheetData);
    }
  }, [properties, parseCompositeKey, getBuildingClassDisplay, getTypeUseDisplay, getDesignDisplay]);

  // ==================== NORMALIZATION FUNCTIONS ====================
  
  const getHPIMultiplier = useCallback((saleYear, targetYear) => {
    // Find the max year available in HPI data
    const maxHPIYear = Math.max(...hpiData.map(h => h.observation_year));
    
    // If sale year is beyond our HPI data, use 1.0
    if (saleYear > maxHPIYear) return 1.0;
    
    // Use the max available year if target year is beyond HPI data
    const effectiveTargetYear = targetYear > maxHPIYear ? maxHPIYear : targetYear;
    
    if (saleYear === effectiveTargetYear) return 1.0;
    
    const saleYearData = hpiData.find(h => h.observation_year === saleYear);
    const targetYearData = hpiData.find(h => h.observation_year === effectiveTargetYear);
    
    if (!saleYearData || !targetYearData) {
      // Only warn once, not for every sale
      if (!saleYearData && saleYear <= maxHPIYear) {
        console.warn(`Missing HPI data for sale year ${saleYear}`);
      }
      return 1.0;
    }
    
    const saleHPI = saleYearData.hpi_index || 100;
    const targetHPI = targetYearData.hpi_index || 100;
    
    return targetHPI / saleHPI;
  }, [hpiData]);

const runTimeNormalization = useCallback(async () => {
    setIsProcessingTime(true);
    
    try {
      // Create a map of existing keep/reject decisions
      const existingDecisions = {};
      timeNormalizedSales.forEach(sale => {
        if (sale.keep_reject && sale.keep_reject !== 'pending') {
          existingDecisions[sale.id] = sale.keep_reject;
        }
      });
      
      // Filter for VALID residential sales only
      const validSales = properties.filter(p => {
        // ... your existing filter logic ...
      });
      
      // Process each valid sale
      const normalized = validSales.map(prop => {
        const saleYear = new Date(prop.sales_date).getFullYear();
        const hpiMultiplier = getHPIMultiplier(saleYear, normalizeToYear);
        const timeNormalizedPrice = Math.round(prop.sales_price * hpiMultiplier);
        
        // Calculate sales ratio
        const assessedValue = prop.values_mod_total || 0;
        const salesRatio = assessedValue > 0 && timeNormalizedPrice > 0 
          ? assessedValue / timeNormalizedPrice 
          : 0;
        
        // Determine if outlier based on equalization ratio
        const isOutlier = equalizationRatio && outlierThreshold ? 
          Math.abs((salesRatio * 100) - equalizationRatio) > outlierThreshold : false;
        
        // Check if we have an existing decision for this property
        const existingDecision = existingDecisions[prop.id];
        
        return {
          ...prop,
          time_normalized_price: timeNormalizedPrice,
          hpi_multiplier: hpiMultiplier,
          sales_ratio: salesRatio,
          is_outlier: isOutlier,
          // Preserve existing decision if it exists, otherwise set to pending
          keep_reject: existingDecision || 'pending'
        };
      });

      setTimeNormalizedSales(normalized);
      
      // Calculate excluded count (properties that didn't meet criteria)
      const excludedCount = properties.filter(p => {
        if (!p.sales_price || p.sales_price <= minSalePrice) return true;
        if (!p.sales_date) return true;
        const saleYear = new Date(p.sales_date).getFullYear();
        if (saleYear < salesFromYear) return true;
        return false;
      }).length;
      
      // Calculate average ratio
      const totalRatio = normalized.reduce((sum, s) => sum + (s.sales_ratio || 0), 0);
      const avgRatio = normalized.length > 0 ? totalRatio / normalized.length : 0;
      
      // Calculate stats including preserved decisions
      const newStats = {
        ...normalizationStats,
        totalSales: normalized.length,
        timeNormalized: normalized.length,
        excluded: excludedCount,
        flaggedOutliers: normalized.filter(s => s.is_outlier).length,
        pendingReview: normalized.filter(s => s.keep_reject === 'pending').length,
        keptCount: normalized.filter(s => s.keep_reject === 'keep').length,
        rejectedCount: normalized.filter(s => s.keep_reject === 'reject').length,
        averageRatio: avgRatio.toFixed(2)
      };
      
      setNormalizationStats(newStats);
      
      // Save configuration and results to database
      const config = {
        equalizationRatio,
        outlierThreshold,
        normalizeToYear,
        salesFromYear,
        minSalePrice,
        selectedCounty
      };
      
      await worksheetService.saveNormalizationConfig(jobData.id, config);
      await worksheetService.saveTimeNormalizedSales(jobData.id, normalized, newStats);

      console.log(`✅ Time normalization complete - preserved ${Object.keys(existingDecisions).length} keep/reject decisions`);
    } catch (error) {
      console.error('Error during time normalization:', error);
      alert('Error during time normalization. Please check the console.');
    } finally {
      setIsProcessingTime(false);
    }
  }, [properties, salesFromYear, minSalePrice, normalizeToYear, equalizationRatio, outlierThreshold, getHPIMultiplier, timeNormalizedSales]);

const runSizeNormalization = useCallback(async () => {
    setIsProcessingSize(true);
    
    try {
      // Create a map of existing size-normalized values
      const existingSizeNorm = {};
      timeNormalizedSales.forEach(sale => {
        if (sale.size_normalized_price) {
          existingSizeNorm[sale.id] = {
            size_normalized_price: sale.size_normalized_price,
            size_adjustment: sale.size_adjustment
          };
        }
      });
      
      // Only use sales that were kept after time normalization review
      const acceptedSales = timeNormalizedSales.filter(s => s.keep_reject === 'keep').map(s => ({
        ...s,
        // Clear old values unless we're preserving them
        size_normalized_price: existingSizeNorm[s.id]?.size_normalized_price || null,
        size_adjustment: existingSizeNorm[s.id]?.size_adjustment || null
      }));
      
      // Group by type/use codes using "starts with" pattern
      const groups = {
        singleFamily: acceptedSales.filter(s => 
          s.asset_type_use?.toString().trim().startsWith('1')
        ),
        // ... rest of your grouping logic ...
      };

      let totalSizeNormalized = 0;
      let totalAdjustment = 0;
      let preservedCount = 0;

      // Process each group
      Object.entries(groups).forEach(([groupName, groupSales]) => {
        if (groupSales.length === 0) return;
        
        // Calculate average LIVING size for the group
        const totalSize = groupSales.reduce((sum, s) => sum + (s.asset_sfla || 0), 0);
        const avgSize = totalSize / groupSales.length;
        
        // Apply 50% method to each sale
        groupSales.forEach(sale => {
          // Check if we already have a size normalization for this property
          if (existingSizeNorm[sale.id]) {
            preservedCount++;
            totalSizeNormalized++;
            totalAdjustment += Math.abs(existingSizeNorm[sale.id].size_adjustment);
            return; // Skip recalculation, keep existing values
          }
          
          const currentSize = sale.asset_sfla || 0;
          
          // Skip if no living size data
          if (currentSize <= 0) {
            console.warn(`Skipping property ${sale.id} - no living_sf: ${currentSize}`);
            return;
          }
          
          const sizeDiff = avgSize - currentSize;
          const pricePerSf = sale.time_normalized_price / currentSize;
          const adjustment = sizeDiff * pricePerSf * 0.5;
          
          // Check for NaN
          if (isNaN(adjustment)) {
            console.error(`NaN adjustment for property ${sale.id}`);
            return;
          }
          
          sale.size_normalized_price = Math.round(sale.time_normalized_price + adjustment);
          sale.size_adjustment = adjustment;
          
          totalSizeNormalized++;
          totalAdjustment += Math.abs(adjustment);
        });
      });

      // Update stats
      setNormalizationStats(prev => ({
        ...prev,
        acceptedSales: acceptedSales.length,
        sizeNormalized: totalSizeNormalized,
        // ... rest of your stats ...
      }));

      // Save to database
      await saveSizeNormalizedValues(acceptedSales);
      
      console.log(`✅ Size normalization complete - preserved ${preservedCount} existing calculations`);
      
      if (preservedCount > 0) {
        alert(`✅ Size Normalization Applied!\n\nProcessed ${totalSizeNormalized} sales (${preservedCount} preserved from previous run)\n\nAverage adjustment: $${Math.round(totalAdjustment / totalSizeNormalized).toLocaleString()}`);
      } else {
        alert(`✅ Size Normalization Applied!\n\nProcessed ${totalSizeNormalized} sales from ${acceptedSales.length} kept time-normalized sales.\n\nAverage adjustment: $${Math.round(totalAdjustment / totalSizeNormalized).toLocaleString()}`);
      }
    } catch (error) {
      console.error('Error during size normalization:', error);
      alert('Error during size normalization. Please check the console.');
    } finally {
      setIsProcessingSize(false);
    }
  }, [timeNormalizedSales]);

  const processBlockAnalysis = useCallback(async () => {
    setIsProcessingBlocks(true);
    
    try {
      // Get all properties with size-normalized values
      const normalizedProps = properties.filter(p => p.values_norm_size && p.values_norm_size > 0);
      
      // Filter by property type
      const filteredProps = normalizedProps.filter(p => {
        const typeUse = p.asset_type_use?.toString().trim();
        if (!typeUse) return false;
        
        switch (blockTypeFilter) {
          case 'single_family':
            return typeUse.startsWith('1');
          case 'multifamily':
            return ['42', '43', '44'].some(code => typeUse === code || typeUse.startsWith(code));
          case 'commercial':
            return ['50', '51', '52'].some(code => typeUse === code || typeUse.startsWith(code));
          case 'all_residential':
            return typeUse.startsWith('1') || ['42', '43', '44'].some(code => typeUse === code || typeUse.startsWith(code));
          default:
            return true;
        }
      });
      
      // Group by block
      const blockGroups = {};
      filteredProps.forEach(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        const block = parsed.block;
        
        if (!blockGroups[block]) {
          blockGroups[block] = [];
        }
        blockGroups[block].push(prop);
      });
      
      // Calculate metrics for each block
      const blockData = Object.entries(blockGroups).map(([block, props]) => {
        // Average normalized value
        const avgValue = props.reduce((sum, p) => sum + p.values_norm_size, 0) / props.length;
        
        // Age consistency
        const years = props.map(p => p.asset_year_built).filter(y => y);
        const ageRange = years.length > 0 ? Math.max(...years) - Math.min(...years) : 0;
        const avgYear = years.length > 0 ? years.reduce((sum, y) => sum + y, 0) / years.length : 0;
        const ageStdDev = calculateStandardDeviation(years);
        
        let ageConsistency = 'Mixed';
        if (ageRange <= 10) ageConsistency = 'High';
        else if (ageRange <= 25) ageConsistency = 'Medium';
        else if (ageRange <= 50) ageConsistency = 'Low';
        
        // Size consistency
        const sizes = props.map(p => p.asset_sfla || 0).filter(s => s > 0);
        const avgSize = sizes.length > 0 ? sizes.reduce((sum, s) => sum + s, 0) / sizes.length : 0;
        const sizeStdDev = calculateStandardDeviation(sizes);
        const sizeCV = avgSize > 0 ? sizeStdDev / avgSize : 0;
        
        let sizeConsistency = 'Mixed';
        if (sizeCV <= 0.15) sizeConsistency = 'High';
        else if (sizeCV <= 0.30) sizeConsistency = 'Medium';
        else if (sizeCV <= 0.50) sizeConsistency = 'Low';
        
        // Design consistency
        const designs = props.map(p => p.asset_design_style).filter(d => d);
        const uniqueDesigns = [...new Set(designs)].length;
        const dominantDesign = mode(designs);
        const dominantPercent = designs.length > 0 ? 
          (designs.filter(d => d === dominantDesign).length / designs.length) * 100 : 0;
        
        let designConsistency = 'Mixed';
        if (uniqueDesigns <= 2 && dominantPercent >= 75) designConsistency = 'High';
        else if (uniqueDesigns <= 3 && dominantPercent >= 50) designConsistency = 'Medium';
        else if (uniqueDesigns <= 4 && dominantPercent >= 25) designConsistency = 'Low';
        
        // Assign color based on value
        const colorIndex = Math.min(
          Math.floor((avgValue - colorScaleStart) / colorScaleIncrement),
          bluebeamPalette.length - 1
        );
        const assignedColor = bluebeamPalette[Math.max(0, colorIndex)];
        
        return {
          block,
          propertyCount: props.length,
          avgNormalizedValue: Math.round(avgValue),
          color: assignedColor,
          ageConsistency,
          ageDetails: {
            range: ageRange,
            avgYear: Math.round(avgYear),
            stdDev: ageStdDev.toFixed(1),
            minYear: Math.min(...years),
            maxYear: Math.max(...years)
          },
          sizeConsistency,
          sizeDetails: {
            avgSize: Math.round(avgSize),
            stdDev: sizeStdDev.toFixed(0),
            cv: (sizeCV * 100).toFixed(1),
            minSize: Math.min(...sizes),
            maxSize: Math.max(...sizes)
          },
          designConsistency,
          designDetails: {
            uniqueDesigns,
            dominantDesign: interpretCodes.getDesignName?.({ asset_design_style: dominantDesign }, codeDefinitions, vendorType) || dominantDesign,
            dominantPercent: dominantPercent.toFixed(0)
          }
        };
      });
      
      // Sort by block number
      blockData.sort((a, b) => {
        const blockA = parseInt(a.block) || 0;
        const blockB = parseInt(b.block) || 0;
        return blockA - blockB;
      });
      
      setMarketAnalysisData(blockData);
    } catch (error) {
      console.error('Error processing block analysis:', error);
      alert('Error processing block analysis. Please check the console.');
    } finally {
      setIsProcessingBlocks(false);
    }
  }, [properties, blockTypeFilter, colorScaleStart, colorScaleIncrement, codeDefinitions, vendorType]);

// Helper functions
  const calculateStandardDeviation = (values) => {
    if (values.length === 0) return 0;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  };
  
  const mode = (arr) => {
    if (arr.length === 0) return null;
    const frequency = {};
    let maxFreq = 0;
    let mode = arr[0];
    
    arr.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
      if (frequency[item] > maxFreq) {
        maxFreq = frequency[item];
        mode = item;
      }
    });
    
    return mode;
  };
  
  // Auto-process when filter or scale changes
  useEffect(() => {
    if (normalizationStats.sizeNormalized > 0) {
      processBlockAnalysis();
    }
  }, [blockTypeFilter, colorScaleStart, colorScaleIncrement, normalizationStats.sizeNormalized, processBlockAnalysis]);

const handleSalesDecision = (saleId, decision) => {
    const updatedSales = timeNormalizedSales.map(sale =>
      sale.id === saleId ? { ...sale, keep_reject: decision } : sale
    );
    setTimeNormalizedSales(updatedSales);

    // Just update stats, no DB calls
    const newStats = {
      ...normalizationStats,
      pendingReview: updatedSales.filter(s => s.keep_reject === 'pending').length,
      keptCount: updatedSales.filter(s => s.keep_reject === 'keep').length,
      rejectedCount: updatedSales.filter(s => s.keep_reject === 'reject').length
    };
    setNormalizationStats(newStats);
  };

const saveSizeNormalizedValues = async (sales) => {
    const salesToUpdate = sales.filter(s => s.size_normalized_price);
    
    // Batch update in chunks of 500
    for (let i = 0; i < salesToUpdate.length; i += 500) {
      const batch = salesToUpdate.slice(i, i + 500);
      
      await Promise.all(batch.map(sale => 
        supabase
          .from('property_records')
          .update({ values_norm_size: sale.size_normalized_price })
          .eq('id', sale.id)
      ));
      
      console.log(`✅ Saved size normalization batch ${Math.floor(i/500) + 1} of ${Math.ceil(salesToUpdate.length/500)}`);
    }
  };
     
const saveBatchDecisions = async () => {
    try {
      const keeps = timeNormalizedSales.filter(s => s.keep_reject === 'keep');
      const rejects = timeNormalizedSales.filter(s => s.keep_reject === 'reject');
      
      console.log(`💾 Saving ${keeps.length} keeps and ${rejects.length} rejects...`);
      
      // Batch update keeps in chunks of 500
      if (keeps.length > 0) {
        for (let i = 0; i < keeps.length; i += 500) {
          const batch = keeps.slice(i, i + 500);
          const updates = batch.map(sale => ({
            id: sale.id,
            values_norm_time: sale.time_normalized_price
          }));
          
          // Use Promise.all for parallel updates within batch
          await Promise.all(updates.map(u => 
            supabase
              .from('property_records')
              .update({ values_norm_time: u.values_norm_time })
              .eq('id', u.id)
          ));
          
          console.log(`✅ Saved batch ${Math.floor(i/500) + 1} of ${Math.ceil(keeps.length/500)}`);
        }
      }
      
      // Batch update rejects in chunks of 500
      if (rejects.length > 0) {
        for (let i = 0; i < rejects.length; i += 500) {
          const batch = rejects.slice(i, i + 500);
          const rejectIds = batch.map(s => s.id);
          
          await supabase
            .from('property_records')
            .update({ values_norm_time: null })
            .in('id', rejectIds);
          
          console.log(`✅ Cleared batch ${Math.floor(i/500) + 1} of ${Math.ceil(rejects.length/500)}`);
        }
      }
      
      // Save the entire state to market_land_valuation for persistence
      await worksheetService.saveTimeNormalizedSales(jobData.id, timeNormalizedSales, normalizationStats);
      
      alert(`✅ Successfully saved ${keeps.length} keeps and ${rejects.length} rejects`);
    } catch (error) {
      console.error('❌ Error saving batch decisions:', error);
      alert('Error saving decisions. Please check the console and try again.');
    }
  };

  // ==================== WORKSHEET FUNCTIONS ====================
  
  const updateWorksheetStats = useCallback((props) => {
    const stats = {
      totalProperties: props.length,
      vcsAssigned: props.filter(p => p.new_vcs).length,
      zoningEntered: props.filter(p => p.asset_zoning).length,
      locationAnalysis: props.filter(p => p.location_analysis).length,
      readyToProcess: readyProperties.size
    };
    setWorksheetStats(stats);
  }, [readyProperties]);

  const handleWorksheetChange = (propertyKey, field, value) => {
    // Check for location standardization
    if (field === 'location_analysis' && value) {
      checkLocationStandardization(value, propertyKey);
    }
    
    const updated = worksheetProperties.map(prop =>
      prop.property_composite_key === propertyKey
        ? { 
            ...prop, 
            [field]: field === 'new_vcs' || field === 'asset_zoning' 
              ? value.toUpperCase() 
              : value 
          }
        : prop
    );
    
    setWorksheetProperties(updated);
    setFilteredWorksheetProps(updated);
    updateWorksheetStats(updated);
    setUnsavedChanges(true);
    
    // Reset auto-save timer
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const timer = setTimeout(autoSaveWorksheet, 30000);
    setAutoSaveTimer(timer);
  };

  const checkLocationStandardization = (value, propertyKey) => {
    const valueLower = value.toLowerCase().trim();
    
    // Check for similar existing values
    for (const [standard, variations] of Object.entries(locationVariations)) {
      if (variations.includes(valueLower) || standard.toLowerCase() === valueLower) {
        return;
      }
      
      // Check for common variations
      const patterns = [
        ['avenue', 'ave', 'av'],
        ['street', 'st'],
        ['road', 'rd'],
        ['drive', 'dr'],
        ['railroad', 'rr', 'rail road', 'railraod']
      ];
      
      for (const pattern of patterns) {
        if (pattern.some(p => valueLower.includes(p)) && 
            pattern.some(p => standard.toLowerCase().includes(p))) {
          setCurrentLocationChoice({
            propertyKey,
            newValue: value,
            existingStandard: standard,
            variations: locationVariations[standard] || []
          });
          setShowLocationModal(true);
          return;
        }
      }
    }
    
    // Add as new standard if no match found
    setLocationVariations(prev => ({
      ...prev,
      [value]: []
    }));
  };

  const handleLocationStandardChoice = (choice) => {
    if (!currentLocationChoice) return;
    
    if (choice === 'existing') {
      handleWorksheetChange(
        currentLocationChoice.propertyKey,
        'location_analysis',
        currentLocationChoice.existingStandard
      );
      
      setLocationVariations(prev => ({
        ...prev,
        [currentLocationChoice.existingStandard]: [
          ...(prev[currentLocationChoice.existingStandard] || []),
          currentLocationChoice.newValue
        ]
      }));
    } else {
      setLocationVariations(prev => ({
        ...prev,
        [currentLocationChoice.newValue]: []
      }));
    }
    
    setShowLocationModal(false);
    setCurrentLocationChoice(null);
  };

  const autoSaveWorksheet = async () => {
    try {
      await worksheetService.saveWorksheetStats(jobData.id, {
        last_saved: new Date().toISOString(),
        entries_completed: worksheetStats.vcsAssigned,
        ready_to_process: worksheetStats.readyToProcess,
        location_variations: locationVariations
      });
      
      setLastAutoSave(new Date());
      setUnsavedChanges(false);
      console.log('✅ Auto-saved worksheet progress');
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  };

  const processSelectedProperties = async () => {
    const toProcess = worksheetProperties.filter(p => 
      readyProperties.has(p.property_composite_key)
    );
    
    if (toProcess.length === 0) {
      alert('Please select properties to process by checking the "Ready" checkbox');
      return;
    }
    
    try {
      for (const prop of toProcess) {
        await supabase
          .from('property_records')
          .update({
            new_vcs: prop.new_vcs,
            location_analysis: prop.location_analysis,
            asset_zoning: prop.asset_zoning,
            asset_map_page: prop.asset_map_page,
            asset_key_page: prop.asset_key_page
          })
          .eq('property_composite_key', prop.property_composite_key);
      }
      
      alert(`✅ Successfully processed ${toProcess.length} properties`);
      setReadyProperties(new Set());
      updateWorksheetStats(worksheetProperties);
    } catch (error) {
      console.error('Error processing properties:', error);
      alert('Error processing properties. Please try again.');
    }
  };

  const copyCurrentVCS = (propertyKey, currentVCS) => {
    handleWorksheetChange(propertyKey, 'new_vcs', currentVCS);
  };

  const handleSort = (field) => {
    const direction = sortConfig.field === field && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ field, direction });
    
    const sorted = [...filteredWorksheetProps].sort((a, b) => {
      if (direction === 'asc') {
        return a[field] > b[field] ? 1 : -1;
      } else {
        return a[field] < b[field] ? 1 : -1;
      }
    });
    
    setFilteredWorksheetProps(sorted);
  };
  const handleNormalizationSort = (field) => {
    const direction = normSortConfig.field === field && normSortConfig.direction === 'asc' ? 'desc' : 'asc';
    setNormSortConfig({ field, direction });
    
    const sorted = [...timeNormalizedSales].sort((a, b) => {
      let aVal, bVal;
      
      // Handle composite key parsing for block/lot
      if (field === 'block' || field === 'lot') {
        const aParsed = parseCompositeKey(a.property_composite_key);
        const bParsed = parseCompositeKey(b.property_composite_key);
        aVal = field === 'block' ? aParsed.block : aParsed.lot;
        bVal = field === 'block' ? bParsed.block : bParsed.lot;
      } else {
        aVal = a[field];
        bVal = b[field];
      }
      
      if (direction === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    setTimeNormalizedSales(sorted);
  };

  // ==================== IMPORT/EXPORT FUNCTIONS ====================
  
  const exportWorksheetToExcel = () => {
    let csv = 'Block,Lot,Qualifier,Card,Location,Address,Class,Current VCS,Building,Type/Use,Design,New VCS,Location Analysis,Zoning,Map Page,Key Page,Notes,Ready\n';
    
    filteredWorksheetProps.forEach(prop => {
      csv += `"${prop.block}","${prop.lot}","${prop.qualifier || ''}","${prop.card || ''}","${prop.location || ''}",`;
      csv += `"${prop.property_location}","${prop.property_class}","${prop.property_vcs}",`;
      csv += `"${prop.building_class_display}","${prop.type_use_display}","${prop.design_display}",`;
      csv += `"${prop.new_vcs}","${prop.location_analysis}","${prop.asset_zoning}",`;
      csv += `"${prop.asset_map_page}","${prop.asset_key_page}","${prop.worksheet_notes}",`;
      csv += `"${readyProperties.has(prop.property_composite_key) ? 'Yes' : 'No'}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PropertyWorksheet_${jobData.job_number}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

const analyzeImportFile = async (file) => {
    setIsAnalyzingImport(true);
    setImportFile(file);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      // Analysis results
      const analysis = {
        fileName: file.name,
        totalRows: jsonData.length,
        matched: [],
        unmatched: [],
        fuzzyMatched: []
      };
      
      // Process each row from Excel
      for (const row of jsonData) {
        // Build composite key from Excel data - vendor aware
        const year = row.Year || row.YEAR || new Date().getFullYear();
        const ccdd = row.Ccdd || row.CCDD || jobData?.ccdd || '';
        const block = (row.Block || row.BLOCK)?.toString() || '';
        const lot = (row.Lot || row.LOT)?.toString() || '';
        
        // Handle qualifier - both vendors
        let qual = (row.Qual || row.Qualifier || row.QUALIFIER)?.toString().trim() || '';
        qual = qual || 'NONE';
        
        // Handle card/bldg based on vendor
        let card;
        if (vendorType === 'Microsystems') {
          card = (row.Bldg || row.BLDG)?.toString().trim() || 'NONE';
        } else { // BRT
          card = (row.Card || row.CARD)?.toString().trim() || 'NONE';
        }
        
        // Handle location field - check for the actual property location first
        let location;
        if (vendorType === 'Microsystems') {
          // For Microsystems, handle the duplicate Location field issue
          // Try to get the first Location column (property address) not the second one
          location = row.Location?.toString().trim() || '';
          // If Location seems to be empty or is actually the analysis field, try other patterns
          if (!location || location.toLowerCase().includes('analysis')) {
            location = row['Property Location']?.toString().trim() || 
                      row.Address?.toString().trim() || 
                      'NONE';
          }
        } else { // BRT
          location = (row.PROPERTY_LOCATION || row['Property Location'] || row.Location)?.toString().trim() || 'NONE';
        }
        
        const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual}-${card}-${location}`;
        
        // Debug for specific blocks
        if (parseInt(block) >= 7 && parseInt(block) <= 10) {
          console.log(`🔍 Import row ${block}-${lot}: compositeKey = ${compositeKey}`);
        }
        
        // Find matching property in worksheet
        const match = worksheetProperties.find(p => p.property_composite_key === compositeKey);
        
        if (match) {
          analysis.matched.push({
            compositeKey,
            excelData: row,
            currentData: {
              ...match,
              id: match.id
            },
            updates: {
              new_vcs: row['New VCS'] || '',
              location_analysis: row['Location Analysis'] || row['Loc Analysis'] || '',
              asset_zoning: row['Zone'] || row['Zoning'] || '',
              asset_map_page: row['Map Page'] || '',
              asset_key_page: row['Key'] || row['Key Page'] || ''
            }
          });
        } else {
          // Debug unmatched
          if (parseInt(block) >= 7 && parseInt(block) <= 10) {
            console.log(`❌ No match found for: ${compositeKey}`);
            // Find close matches for debugging
            const closeMatches = worksheetProperties.filter(p => 
              p.property_composite_key.includes(`-${block}-${lot}`)
            );
            if (closeMatches.length > 0) {
              console.log(`   Close matches:`, closeMatches.map(p => p.property_composite_key));
            }
          }
          
          // Try fuzzy match on address if enabled
          if (importOptions.useAddressFuzzyMatch && location && location !== 'NONE') {
            const fuzzyMatch = worksheetProperties.find(p => {
              if (!p.property_location) return false;
              const similarity = calculateSimilarity(
                p.property_location.toLowerCase(),
                location.toLowerCase()
              );
              return similarity >= importOptions.fuzzyMatchThreshold;
            });
            
            if (fuzzyMatch) {
              analysis.fuzzyMatched.push({
                compositeKey,
                excelData: row,
                currentData: {
                  ...fuzzyMatch,
                  id: fuzzyMatch.id
                },
                updates: {
                  new_vcs: row['New VCS'] || '',
                  location_analysis: row['Location Analysis'] || row['Loc Analysis'] || '',
                  asset_zoning: row['Zone'] || row['Zoning'] || '',
                  asset_map_page: row['Map Page'] || '',
                  asset_key_page: row['Key'] || row['Key Page'] || ''
                }
              });
            } else {
              analysis.unmatched.push({
                compositeKey,
                excelData: row
              });
            }
          } else {
            analysis.unmatched.push({
              compositeKey,
              excelData: row
            });
          }
        }
      }
      
      setImportPreview(analysis);
      setShowImportModal(true);
      console.log(`Import analysis complete: ${analysis.matched.length} exact, ${analysis.fuzzyMatched.length} fuzzy, ${analysis.unmatched.length} unmatched`);
    } catch (error) {
      console.error('Error analyzing import file:', error);
      alert('Error analyzing file. Please check the format.');
    } finally {
      setIsAnalyzingImport(false);
    }
  };
  
  // Helper function for fuzzy matching
  const calculateSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  };
  
  const levenshteinDistance = (str1, str2) => {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  };
  // ==================== SEARCH AND FILTER ====================
  
  useEffect(() => {
    let filtered = [...worksheetProperties];
    
    if (worksheetSearchTerm) {
      const searchLower = worksheetSearchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.property_location?.toLowerCase().includes(searchLower) ||
        p.property_composite_key?.toLowerCase().includes(searchLower) ||
        p.block?.includes(worksheetSearchTerm) ||
        p.lot?.includes(worksheetSearchTerm)
      );
    }
    
    switch (worksheetFilter) {
      case 'missing-vcs':
        filtered = filtered.filter(p => !p.new_vcs);
        break;
      case 'missing-location':
        filtered = filtered.filter(p => !p.location_analysis);
        break;
      case 'missing-zoning':
        filtered = filtered.filter(p => !p.asset_zoning);
        break;
      case 'ready':
        filtered = filtered.filter(p => readyProperties.has(p.property_composite_key));
        break;
      case 'completed':
        filtered = filtered.filter(p => p.new_vcs && p.asset_zoning);
        break;
        case 'not-ready':
        filtered = filtered.filter(p => !readyProperties.has(p.property_composite_key));
        break;
    }
    
    setFilteredWorksheetProps(filtered);
  }, [worksheetSearchTerm, worksheetFilter, worksheetProperties, readyProperties]);

  // ==================== PAGINATION ====================
  
  const paginatedProperties = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredWorksheetProps.slice(startIndex, endIndex);
  }, [filteredWorksheetProps, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredWorksheetProps.length / itemsPerPage);

  // ==================== RENDER ====================
  
  return (
    <div className="space-y-4">
      {/* Sub-tab Navigation */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveSubTab('normalization')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSubTab === 'normalization'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          Normalization
        </button>
        <button
          onClick={() => setActiveSubTab('marketAnalysis')}
          disabled={!normalizationStats.sizeNormalized || normalizationStats.sizeNormalized === 0}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSubTab === 'marketAnalysis'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          } ${!normalizationStats.sizeNormalized ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Market Analysis
        </button>
        <button
          onClick={() => setActiveSubTab('worksheet')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSubTab === 'worksheet'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          Page by Page Worksheet
        </button>
      </div>

      {/* Normalization Tab Content */}
      {activeSubTab === 'normalization' && (
        <div className="w-full">
          <div className="space-y-6 px-4">
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Normalization Configuration</h3>
              <div className="flex items-center gap-4">
                {hpiLoaded && (
                  <span className="text-green-600 text-sm">✓ HPI Data Loaded</span>
                )}
                <button
                  onClick={() => {
                    if (!equalizationRatio || !outlierThreshold) {
                      alert('Please enter Equalization Ratio and Outlier Threshold before running normalization');
                      return;
                    }
                    runTimeNormalization();
                  }}
                  disabled={isProcessingTime || !hpiLoaded}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >      
                  {isProcessingTime ? (
                    <>
                      <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                      Processing...
                    </>
                  ) : (
                    'Run Time Normalization'
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Normalize To Year
                </label>
                <input
                  type="number"
                  value={normalizeToYear}
                  onChange={(e) => setNormalizeToYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Current market year for normalization</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sales From Year
                </label>
                <input
                  type="number"
                  value={salesFromYear}
                  onChange={(e) => setSalesFromYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Include sales from this year forward</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  County
                </label>
                <select
                  value={selectedCounty}
                  onChange={(e) => setSelectedCounty(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  disabled={availableCounties.length === 0}
                >
                  {availableCounties.length === 0 ? (
                    <option value="">Loading counties...</option>
                  ) : (
                    availableCounties.map(county => (
                      <option key={county} value={county}>{county}</option>
                    ))
                  )}
                </select>
                <p className="text-xs text-gray-500 mt-1">County for HPI data lookup</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Equalization Ratio (%)
                </label>
                <input
                  type="number"
                  value={equalizationRatio}
                  onChange={(e) => setEqualizationRatio(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Target ratio for the market (typically 85-115%)</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Outlier Threshold (%)
                </label>
                <input
                  type="number"
                  value={outlierThreshold}
                  onChange={(e) => setOutlierThreshold(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Flag sales outside this % of equalization ratio</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Min Sale Price
                </label>
                <input
                  type="number"
                  value={minSalePrice}
                  onChange={(e) => setMinSalePrice(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">Exclude non-arm's length sales</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-gray-50 rounded">
              <p className="text-sm font-medium mb-2">Formulas:</p>
              <p className="text-xs text-gray-600">
                <strong>Time Normalization:</strong> Sale Price × (Current Year HPI ÷ Sale Year HPI)
              </p>
              <p className="text-xs text-gray-600 mt-1">
                <strong>Size Normalization (50% Method):</strong> (((Group Avg Size - Sale Size) × ((Sale Price ÷ Sale Size) × 0.50)) + Sale Price)
              </p>
            </div>
          </div>

          {/* Time Normalization Statistics */}
          {timeNormalizedSales.length > 0 && (
            <>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Time Normalization Statistics (County HPI Based)</h3>
                <div className="grid grid-cols-6 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{normalizationStats.totalSales}</div>
                    <div className="text-sm text-gray-600">Total Sales ({salesFromYear}+)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{normalizationStats.timeNormalized}</div>
                    <div className="text-sm text-gray-600">Time Normalized</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{normalizationStats.excluded}</div>
                    <div className="text-sm text-gray-600">Excluded (&lt; ${minSalePrice})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">{normalizationStats.flaggedOutliers}</div>
                    <div className="text-sm text-gray-600">Flagged as Outliers</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{normalizationStats.pendingReview}</div>
                    <div className="text-sm text-gray-600">Pending Review</div>
                  </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-700">
                    {(() => {
                      const currentYear = new Date().getFullYear();
                      const currentYearSales = properties.filter(p => {
                        if (!p.sales_price || p.sales_price <= minSalePrice) return false;
                        if (!p.sales_date) return false;
                        
                        const saleYear = new Date(p.sales_date).getFullYear();
                        if (saleYear !== currentYear) return false;
                        
                        // Check sales_nu conditions (empty, null, 00, 7, or 07 are valid)
                        const nu = p.sales_nu?.toString().trim();
                        const validNU = !nu || nu === '' || nu === '00' || nu === '7' || nu === '07';
                        if (!validNU) return false;
                        
                        // Same filters as normalization
                        const parsed = parseCompositeKey(p.property_composite_key);
                        const card = parsed.card?.toUpperCase();
                        
                        // Card filter based on vendor
                        if (vendorType === 'Microsystems') {
                          if (card !== 'M') return false;
                        } else {
                          if (card !== '1') return false;
                        }
                        
                        const buildingClass = p.asset_building_class?.toString().trim();
                        const typeUse = p.asset_type_use?.toString().trim();
                        const designStyle = p.asset_design_style?.toString().trim();
                        
                        if (!buildingClass || parseInt(buildingClass) <= 10) return false;
                        if (!typeUse) return false;
                        if (!designStyle) return false;
                        
                        return true;
                      });
                      
                      const totalRatio = currentYearSales.reduce((sum, p) => {
                        const ratio = p.values_mod_total ? (p.values_mod_total / p.sales_price) : 0;
                        return sum + ratio;
                      }, 0);
                      
                      const avgRatio = currentYearSales.length > 0 ? totalRatio / currentYearSales.length : 0;
                      return `${(avgRatio * 100).toFixed(2)}%`;
                    })()}
                  </div>
                  <div className="text-sm text-gray-500">True Ratio</div>
                </div>
                </div>
              </div>

              {/* Sales Review Table */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Sales Review</h3>
                  <div className="flex gap-2">
                  <select
                      value={salesReviewFilter}
                      onChange={(e) => setSalesReviewFilter(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded"
                    >
                      <option value="all">All Sales</option>
                      <option value="flagged">Flagged Only</option>
                      <option value="pending">Pending Review</option>
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('1')) && (
                        <option value="type-1">Single Family</option>
                      )}
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('2')) && (
                        <option value="type-2">Semi-Detached</option>
                      )}
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('3')) && (
                        <option value="type-3">Row/Townhomes</option>
                      )}
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('4')) && (
                        <option value="type-4">MultiFamily</option>
                      )}
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('5')) && (
                        <option value="type-5">Conversions</option>
                      )}
                      {timeNormalizedSales.some(s => s.asset_type_use?.toString().trim().startsWith('6')) && (
                        <option value="type-6">Condominiums</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto max-w-full">
                  <table className="min-w-full table-fixed">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('block')}
                          >
                            Block {normSortConfig.field === 'block' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('lot')}
                          >
                            Lot {normSortConfig.field === 'lot' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('qualifier')}
                          >
                            Qual {normSortConfig.field === 'qualifier' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('card')}
                          >
                            Card {normSortConfig.field === 'card' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-32 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('property_location')}
                          >
                            Location {normSortConfig.field === 'property_location' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('property_class')}
                          >
                            Class {normSortConfig.field === 'property_class' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-20 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('asset_type_use')}
                          >
                            Type {normSortConfig.field === 'asset_type_use' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('package')}
                          >
                            Package {normSortConfig.field === 'package' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-left text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('sales_date')}
                          >
                            Sale Date {normSortConfig.field === 'sales_date' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('sales_price')}
                          >
                            Sale Price {normSortConfig.field === 'sales_price' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-24 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('time_normalized_price')}
                          >
                            Time Norm {normSortConfig.field === 'time_normalized_price' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-right text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('sales_nu')}
                          >
                            Sale NU {normSortConfig.field === 'sales_nu' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-16 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('sales_ratio')}
                          >
                            Ratio {normSortConfig.field === 'sales_ratio' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-20 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('is_outlier')}
                          >
                            Status {normSortConfig.field === 'is_outlier' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                          <th 
                            className="px-4 py-3 text-center text-sm font-medium text-gray-700 w-28 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleNormalizationSort('keep_reject')}
                          >
                            Decision {normSortConfig.field === 'keep_reject' && (normSortConfig.direction === 'asc' ? '↑' : '↓')}
                          </th>
                        </tr>
                      </thead>
                    <tbody>
                      {timeNormalizedSales
                        .filter(sale => {
                          if (salesReviewFilter === 'all') return true;
                          if (salesReviewFilter === 'flagged') return sale.is_outlier;
                          if (salesReviewFilter === 'pending') return sale.keep_reject === 'pending';
                          if (salesReviewFilter === 'type-1') return sale.asset_type_use?.toString().trim().startsWith('1');
                          if (salesReviewFilter === 'type-2') return sale.asset_type_use?.toString().trim().startsWith('2');
                          if (salesReviewFilter === 'type-3') return sale.asset_type_use?.toString().trim().startsWith('3');
                          if (salesReviewFilter === 'type-4') return sale.asset_type_use?.toString().trim().startsWith('4');
                          if (salesReviewFilter === 'type-5') return sale.asset_type_use?.toString().trim().startsWith('5');
                          if (salesReviewFilter === 'type-6') return sale.asset_type_use?.toString().trim().startsWith('6');
                          return true;
                        })
                        .slice((normCurrentPage - 1) * normItemsPerPage, normCurrentPage * normItemsPerPage)
                        .map((sale) => {
                          const parsed = parseCompositeKey(sale.property_composite_key);
                          return (
                          <tr key={sale.id} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm">{parsed.block}</td>
                              <td className="px-4 py-3 text-sm">{parsed.lot}</td>
                              <td className="px-4 py-3 text-sm">{parsed.qualifier || ''}</td>
                              <td className="px-4 py-3 text-sm">{parsed.card || '1'}</td>
                              <td className="px-4 py-3 text-sm">{sale.property_location}</td>
                              <td className="px-4 py-3 text-sm">{sale.property_class || sale.property_m4_class}</td>
                              <td className="px-4 py-3 text-sm">
                                {getTypeUseDisplay(sale)}
                              </td>
                              <td className="px-4 py-3 text-sm text-center">
                                {(() => {
                                  const packageData = interpretCodes.getPackageSaleData(properties, sale);
                                  if (!packageData) return '-';
                                  
                                  // Check if it's a farm package (has 3B)
                                  const isFarmPackage = packageData.has_farmland;
                                  
                                  if (isFarmPackage) {
                                    return (
                                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium" 
                                            title={`Farm package: ${packageData.package_count} properties (includes farmland)`}>
                                        Farm ({packageData.package_count})
                                      </span>
                                    );
                                  }
                                  
                                  // Check if it's additional cards (same property, different cards)
                                  const parsed = parseCompositeKey(sale.property_composite_key);
                                  const samePropertyDifferentCards = packageData.properties?.filter(p => {
                                    const pParsed = parseCompositeKey(p.property_composite_key);
                                    return pParsed.block === parsed.block && 
                                           pParsed.lot === parsed.lot && 
                                           pParsed.card !== parsed.card;
                                  });
                                  
                                  // Check if main card (M for Microsystems, 1 for BRT)
                                  const isMainCard = (vendorType === 'Microsystems' && parsed.card === 'M') || 
                                                    (vendorType === 'BRT' && parsed.card === '1');
                                  
                                  if (samePropertyDifferentCards && samePropertyDifferentCards.length > 0 && isMainCard) {
                                    // It's the main card with additional cards on same property
                                    return (
                                      <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium" 
                                            title={`Additional cards on same property`}>
                                        Addl Card ({samePropertyDifferentCards.length})
                                      </span>
                                    );
                                  } else if (samePropertyDifferentCards && samePropertyDifferentCards.length > 0 && !isMainCard) {
                                    // It's an additional card, don't show package indicator
                                    return '-';
                                  }
                                  
                                  // Regular package (multiple properties)
                                  return (
                                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium" 
                                          title={`Package sale: ${packageData.package_count} properties`}>
                                      Pkg ({packageData.package_count})
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                {sale.sales_date ? new Date(sale.sales_date).toLocaleDateString() : ''}
                              </td>
                              <td className="px-4 py-3 text-sm text-right">
                                ${sale.sales_price?.toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-right">
                                ${sale.time_normalized_price?.toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-right">
                                {sale.sales_nu || ''}
                              </td>
                              <td className="px-4 py-3 text-sm text-center">
                                {sale.sales_ratio ? `${(sale.sales_ratio * 100).toFixed(0)}%` : ''}
                              </td>
                              <td className="px-4 py-3 text-sm text-center">
                                {sale.is_outlier ? (
                                  <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                                    Outlier
                                  </span>
                                ) : (
                                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                                    Valid
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1 justify-center">
                                  <button
                                    onClick={() => handleSalesDecision(sale.id, 'keep')}
                                    className={`px-2 py-1 rounded text-xs ${
                                      sale.keep_reject === 'keep'
                                        ? 'bg-green-600 text-white'
                                        : 'bg-gray-200 hover:bg-green-100'
                                    }`}
                                  >
                                    Keep
                                  </button>
                                  <button
                                    onClick={() => handleSalesDecision(sale.id, 'reject')}
                                    className={`px-2 py-1 rounded text-xs ${
                                      sale.keep_reject === 'reject'
                                        ? 'bg-red-600 text-white'
                                        : 'bg-gray-200 hover:bg-red-100'
                                    }`}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {(() => {
                  const filteredSales = timeNormalizedSales.filter(sale => {
                    if (salesReviewFilter === 'all') return true;
                    if (salesReviewFilter === 'flagged') return sale.is_outlier;
                    if (salesReviewFilter === 'pending') return sale.keep_reject === 'pending';
                    if (salesReviewFilter.startsWith('type-')) {
                      const typeNum = salesReviewFilter.split('-')[1];
                      return sale.asset_type_use?.toString().trim().startsWith(typeNum);
                    }
                    return true;
                  });
                  const totalNormPages = Math.ceil(filteredSales.length / normItemsPerPage);
                  
                  return totalNormPages > 1 && (
                    <div className="flex justify-between items-center mt-4">
                      <div className="text-sm text-gray-600">
                        Page {normCurrentPage} of {totalNormPages} ({filteredSales.length} sales)
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setNormCurrentPage(Math.max(1, normCurrentPage - 1))}
                          disabled={normCurrentPage === 1}
                          className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <button
                          onClick={() => setNormCurrentPage(Math.min(totalNormPages, normCurrentPage + 1))}
                          disabled={normCurrentPage === totalNormPages}
                          className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-4 p-4 bg-blue-50 rounded">
                  <p className="text-sm">
                    <strong>Review Guidelines:</strong> Sales with ratios outside {((equalizationRatio * (1 - outlierThreshold/100))).toFixed(2)}%-{((equalizationRatio * (1 + outlierThreshold/100))).toFixed(2)}% are flagged.
                    Consider property condition, special circumstances, and market conditions when making keep/reject decisions.
                  </p>
                </div>
                
                {/* Save All Decisions Button */}
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={saveBatchDecisions}
                    className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Save All Keep/Reject Decisions
                  </button>
                </div>
              </div>

              {/* Size Normalization Section */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Size Normalization</h3>
                  <button
                    onClick={runSizeNormalization}
                    disabled={isProcessingSize || timeNormalizedSales.filter(s => s.keep_reject === 'keep').length === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isProcessingSize ? (
                      <>
                        <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                        Processing...
                      </>
                    ) : (
                      'Run Size Normalization'
                    )}
                  </button>
                </div>

                <div className="p-4 bg-blue-50 rounded mb-4">
                  <p className="text-sm">
                    <strong>Process:</strong> After reviewing time normalization results, run size normalization on accepted sales. 
                    Properties are grouped by type (based on first digit/character) and adjusted to their group's average size:
                  </p>
                  <ul className="text-sm mt-2 space-y-1">
                    <li>• <strong>Single Family (1x):</strong> All codes starting with 1</li>
                    <li>• <strong>Semi-Detached (2x):</strong> All codes starting with 2</li>
                    <li>• <strong>Row/Townhouses (3x):</strong> All codes starting with 3</li>
                    <li>• <strong>Multifamily (4x):</strong> All codes starting with 4</li>
                    <li>• <strong>Conversions (5x):</strong> All codes starting with 5</li>
                    <li>• <strong>Condominiums (6x):</strong> All codes starting with 6</li>
                  </ul>
                </div>

                {normalizationStats.sizeNormalized > 0 && (
                  <div className="space-y-4">
                    {/* Main Stats */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{normalizationStats.acceptedSales}</div>
                        <div className="text-sm text-gray-600">Accepted Sales</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{normalizationStats.sizeNormalized}</div>
                        <div className="text-sm text-gray-600">Size Normalized</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          ${normalizationStats.avgSizeAdjustment?.toLocaleString() || 0}
                        </div>
                        <div className="text-sm text-gray-600">Avg Adjustment</div>
                      </div>
                    </div>
                    
                    {/* Type Grouping Breakdown */}
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Size Normalization by Type:</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {normalizationStats.singleFamily > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.singleFamily}</div>
                            <div className="text-xs text-gray-600">Single Family (1x)</div>
                          </div>
                        )}
                        {normalizationStats.semiDetached > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.semiDetached}</div>
                            <div className="text-xs text-gray-600">Semi-Detached (2x)</div>
                          </div>
                        )}
                        {normalizationStats.townhouses > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.townhouses}</div>
                            <div className="text-xs text-gray-600">Row/Townhouses (3x)</div>
                          </div>
                        )}
                        {normalizationStats.multifamily > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.multifamily}</div>
                            <div className="text-xs text-gray-600">Multifamily (4x)</div>
                          </div>
                        )}
                        {normalizationStats.conversions > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.conversions}</div>
                            <div className="text-xs text-gray-600">Conversions (5x)</div>
                          </div>
                        )}
                        {normalizationStats.condominiums > 0 && (
                          <div className="bg-gray-50 rounded p-2">
                            <div className="text-lg font-semibold">{normalizationStats.condominiums}</div>
                            <div className="text-xs text-gray-600">Condominiums (6x)</div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-sm text-gray-500 italic">
                      Each type group normalized to its own average lot size using 50% adjustment method
                    </div>
                  </div>        
                )}
              </div>
            </>
          )}
          </div>
        </div>
      )}

      {/* Block Analysis Tab Content */}
      {activeSubTab === 'marketAnalysis' && (
        <div className="space-y-6">
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Block Market Analysis</h3>
              <button
                onClick={() => {
                  // Export to CSV
                  let csv = 'Block,Properties,Avg Value,Color,Bluebeam Position,Age,Size,Design\n';
                  marketAnalysisData.forEach(block => {
                    csv += `"${block.block}","${block.propertyCount}","$${block.avgNormalizedValue.toLocaleString()}",`;
                    csv += `"${block.color.name}","Row ${block.color.row} Col ${block.color.col}",`;
                    csv += `"${block.ageConsistency}","${block.sizeConsistency}","${block.designConsistency}"\n`;
                  });
                  
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BlockAnalysis_${jobData.job_number}_${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Export Color Map
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Property Type Filter
                </label>
                <select
                  value={blockTypeFilter}
                  onChange={(e) => setBlockTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="single_family">Single Family</option>
                  <option value="multifamily">Multifamily</option>
                  <option value="commercial">Commercial</option>
                  <option value="all_residential">All Residential</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color Scale Start
                </label>
                <input
                  type="number"
                  value={colorScaleStart}
                  onChange={(e) => setColorScaleStart(parseInt(e.target.value) || 100000)}
                  step="25000"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color Increment
                </label>
                <input
                  type="number"
                  value={colorScaleIncrement}
                  onChange={(e) => setColorScaleIncrement(parseInt(e.target.value) || 50000)}
                  step="10000"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
            </div>
            
            <div className="mt-4 p-3 bg-blue-50 rounded text-sm">
              <strong>Color Scale:</strong> Starting at ${colorScaleStart.toLocaleString()}, 
              incrementing by ${colorScaleIncrement.toLocaleString()} per color. 
              Total of {marketAnalysisData.length} blocks analyzed.
            </div>
          </div>
          
          {/* Block Cards Grid */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Block Analysis Results</h3>
            
            {isProcessingBlocks ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="animate-spin text-blue-600 mr-2" size={20} />
                <span>Processing block analysis...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {marketAnalysisData.map((block) => (
                  <div
                    key={block.block}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-lg font-semibold">Block {block.block}</h4>
                        <p className="text-sm text-gray-600">{block.propertyCount} properties</p>
                      </div>
                      <div
                        className="w-12 h-12 rounded border-2 border-gray-300"
                        style={{ backgroundColor: block.color.hex }}
                        title={`${block.color.name} - Row ${block.color.row}, Col ${block.color.col}`}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <div className="text-2xl font-bold">${block.avgNormalizedValue.toLocaleString()}</div>
                      <div className="text-sm text-gray-500">Average Normalized Value</div>
                    </div>
                    
                    <div className="space-y-2 border-t pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Age Consistency:</span>
                        <button
                          onClick={() => {
                            setSelectedBlockDetails({
                              ...block,
                              metric: 'age'
                            });
                            setShowBlockDetailModal(true);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {block.ageConsistency}
                          <AlertCircle size={14} />
                        </button>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Size Consistency:</span>
                        <button
                          onClick={() => {
                            setSelectedBlockDetails({
                              ...block,
                              metric: 'size'
                            });
                            setShowBlockDetailModal(true);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {block.sizeConsistency}
                          <AlertCircle size={14} />
                        </button>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Design Consistency:</span>
                        <button
                          onClick={() => {
                            setSelectedBlockDetails({
                              ...block,
                              metric: 'design'
                            });
                            setShowBlockDetailModal(true);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {block.designConsistency}
                          <AlertCircle size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t">
                      <div className="text-xs text-gray-500">
                        Bluebeam: {block.color.name} (Row {block.color.row}, Col {block.color.col})
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Property Worksheet Tab Content */}
      {activeSubTab === 'worksheet' && (
        <div className="space-y-6">
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Property Worksheet Configuration</h3>
              <div className="flex gap-2">
                <input
                  type="file"
                  id="import-file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files[0] && analyzeImportFile(e.target.files[0])}
                  className="hidden"
                />
                <button
                  onClick={() => document.getElementById('import-file').click()}
                  disabled={isAnalyzingImport}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  {isAnalyzingImport ? (
                    <>
                      <RefreshCw className="inline-block animate-spin mr-2" size={16} />
                      Analyzing...
                    </>
                  ) : (
                    'Import Updates from Excel'
                  )}
                </button>
                <button
                  onClick={exportWorksheetToExcel}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Export to Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{worksheetStats.totalProperties}</div>
                <div className="text-sm text-gray-600">Total Properties</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {worksheetStats.vcsAssigned} / {worksheetStats.totalProperties}
                </div>
                <div className="text-sm text-gray-600">VCS Assigned</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {worksheetStats.zoningEntered} / {worksheetStats.totalProperties}
                </div>
                <div className="text-sm text-gray-600">Zoning Entered</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{worksheetStats.locationAnalysis}</div>
                <div className="text-sm text-gray-600">Location Analysis</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{worksheetStats.readyToProcess}</div>
                <div className="text-sm text-gray-600">Ready to Process</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {Math.round((worksheetStats.vcsAssigned / worksheetStats.totalProperties) * 100) || 0}%
                </div>
                <div className="text-sm text-gray-600">Completion</div>
              </div>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{
                  width: `${worksheetStats.totalProperties > 0 
                    ? (worksheetStats.vcsAssigned / worksheetStats.totalProperties * 100) 
                    : 0}%`
                }}
              />
            </div>
          </div>

          {/* Data Grid */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Property Worksheet</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search address or property ID..."
                  value={worksheetSearchTerm}
                  onChange={(e) => setWorksheetSearchTerm(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded"
                />
                <select
                  value={worksheetFilter}
                  onChange={(e) => setWorksheetFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="all">All Properties</option>
                  <option value="missing-vcs">Missing VCS</option>
                  <option value="missing-location">Missing Location</option>
                  <option value="missing-zoning">Missing Zoning</option>
                  <option value="ready">Ready to Process</option>
                  <option value="completed">Completed</option>
                  <option value="not-ready">Not Ready</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px] max-w-full">
              <table className="min-w-full table-fixed">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('block')}
                        >
                          Block {sortConfig.field === 'block' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('lot')}
                        >
                          Lot {sortConfig.field === 'lot' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('qualifier')}
                        >
                          Qual {sortConfig.field === 'qualifier' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('card')}
                        >
                          Card {sortConfig.field === 'card' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('location')}
                        >
                          Location {sortConfig.field === 'location' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('property_class')}
                        >
                          Class {sortConfig.field === 'property_class' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('property_vcs')}
                        >
                          Current VCS {sortConfig.field === 'property_vcs' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('building_class_display')}
                        >
                          Building {sortConfig.field === 'building_class_display' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('type_use_display')}
                        >
                          Type/Use {sortConfig.field === 'type_use_display' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleSort('design_display')}
                        >
                          Design {sortConfig.field === 'design_display' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th></th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('new_vcs')}
                        >
                          New VCS {sortConfig.field === 'new_vcs' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('location_analysis')}
                        >
                          Location Analysis {sortConfig.field === 'location_analysis' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_zoning')}
                        >
                          Zoning {sortConfig.field === 'asset_zoning' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_map_page')}
                        >
                          Map Page {sortConfig.field === 'asset_map_page' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('asset_key_page')}
                        >
                          Key Page {sortConfig.field === 'asset_key_page' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => handleSort('worksheet_notes')}
                        >
                          Notes {sortConfig.field === 'worksheet_notes' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                          className="px-3 py-2 text-center text-xs font-medium text-gray-700 bg-green-50 cursor-pointer hover:bg-green-100"
                          onClick={() => handleSort('ready')}
                        >
                          Ready {sortConfig.field === 'ready' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                      </tr>
                    </thead>
                <tbody>
                  {paginatedProperties.map((prop) => (
                    <tr key={prop.property_composite_key} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm">{prop.block}</td>
                      <td className="px-3 py-2 text-sm">{prop.lot}</td>
                      <td className="px-3 py-2 text-sm">{prop.qualifier}</td>
                      <td className="px-3 py-2 text-sm">{prop.card || '1'}</td>
                      <td className="px-3 py-2 text-sm">{prop.location || '-'}</td>
                      <td className="px-3 py-2 text-sm">{prop.property_class}</td>
                      <td className="px-3 py-2 text-sm">{prop.building_class_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.type_use_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.design_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.property_vcs}</td>
                      <td className="px-1">
                        <button
                          onClick={() => copyCurrentVCS(prop.property_composite_key, prop.property_vcs)}
                          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                          title="Copy current VCS to new"
                        >
                          →
                        </button>
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.new_vcs}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'new_vcs', e.target.value)}
                          maxLength="4"
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm uppercase"
                          style={{ textTransform: 'uppercase' }}
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.location_analysis}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'location_analysis', e.target.value)}
                          className="w-32 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_zoning}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_zoning', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm uppercase"
                          style={{ textTransform: 'uppercase' }}
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_map_page}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_map_page', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_key_page}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_key_page', e.target.value)}
                          className="w-16 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.worksheet_notes}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'worksheet_notes', e.target.value)}
                          className="w-24 px-1 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 text-center bg-gray-50">
                        <input
                          type="checkbox"
                          checked={readyProperties.has(prop.property_composite_key)}
                          onChange={(e) => {
                            let newReadyProperties;
                            if (e.target.checked) {
                              newReadyProperties = new Set([...readyProperties, prop.property_composite_key]);
                            } else {
                              newReadyProperties = new Set(readyProperties);
                              newReadyProperties.delete(prop.property_composite_key);
                            }
                            setReadyProperties(newReadyProperties);
                            
                            // Update stats with the new ready count
                            const stats = {
                              totalProperties: worksheetProperties.length,
                              vcsAssigned: worksheetProperties.filter(p => p.new_vcs).length,
                              zoningEntered: worksheetProperties.filter(p => p.asset_zoning).length,
                              locationAnalysis: worksheetProperties.filter(p => p.location_analysis).length,
                              readyToProcess: newReadyProperties.size
                            };
                            setWorksheetStats(stats);
                          }}
                          className="w-4 h-4"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                 <div className="text-sm text-gray-600">
                   Page {currentPage} of {totalPages} ({filteredWorksheetProps.length} properties)
                 </div>
                 <div className="flex gap-2">
                   <button
                     onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                     disabled={currentPage === 1}
                     className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                   >
                     <ChevronLeft size={16} />
                   </button>
                   <button
                     onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                     disabled={currentPage === totalPages}
                     className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                   >
                     <ChevronRight size={16} />
                   </button>
                 </div>
               </div>
             )}

           <div className="mt-6 flex justify-between items-center">
             <div>
               <strong>Selected for Processing:</strong> {readyProperties.size} properties
             </div>
             <button
               onClick={processSelectedProperties}
               disabled={readyProperties.size === 0}
               className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
             >
               Process Selected Properties
             </button>
           </div>
         </div>
       </div>
     )}

     {/* Location Standardization Modal */}
     {showLocationModal && currentLocationChoice && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md">
           <h3 className="text-lg font-semibold mb-4">Location Standardization</h3>
           <p className="mb-4">
             You've entered a variation of an existing location. Which should be the standard?
           </p>
           <div className="space-y-2">
             <button
               onClick={() => handleLocationStandardChoice('existing')}
               className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
             >
               <strong>Use existing:</strong> {currentLocationChoice.existingStandard}
             </button>
             <button
               onClick={() => handleLocationStandardChoice('new')}
               className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
             >
               <strong>Use as entered:</strong> {currentLocationChoice.newValue}
             </button>
             <button
               onClick={() => {
                 setShowLocationModal(false);
                 setCurrentLocationChoice(null);
               }}
               className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
             >
               Cancel
             </button>
           </div>
         </div>
       </div>
     )}

     {/* Import Modal */}
     {showImportModal && importPreview && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
         <div className="bg-white rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-y-auto">
           <div className="flex justify-between items-center mb-4">
             <h3 className="text-xl font-semibold">Import Preview</h3>
             <button
               onClick={() => {
                 setShowImportModal(false);
                 setImportPreview(null);
               }}
               className="text-gray-500 hover:text-gray-700"
             >
               <X size={24} />
             </button>
           </div>

           <div className="grid grid-cols-3 gap-4 mb-6">
             <div className="bg-green-50 border border-green-200 rounded p-3">
               <div className="text-2xl font-bold text-green-700">
                 {importPreview.matched?.length || 0}
               </div>
               <div className="text-sm text-green-600">Exact Matches</div>
             </div>
             <div className="bg-blue-50 border border-blue-200 rounded p-3">
               <div className="text-2xl font-bold text-blue-700">
                 {importPreview.fuzzyMatched?.length || 0}
               </div>
               <div className="text-sm text-blue-600">Fuzzy Matches</div>
             </div>
             <div className="bg-orange-50 border border-orange-200 rounded p-3">
               <div className="text-2xl font-bold text-orange-700">
                 {importPreview.unmatched?.length || 0}
               </div>
               <div className="text-sm text-orange-600">Unmatched</div>
             </div>
           </div>

           <div className="border-t border-b py-4 mb-4">
             <h4 className="font-medium mb-3">Import Options</h4>
             <div className="space-y-2">
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.updateExisting}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     updateExisting: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Update existing properties</span>
               </label>
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.markImportedAsReady}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     markImportedAsReady: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Mark imported properties as Ready</span>
               </label>
               <label className="flex items-center gap-2">
                 <input
                   type="checkbox"
                   checked={importOptions.useAddressFuzzyMatch}
                   onChange={(e) => setImportOptions(prev => ({
                     ...prev,
                     useAddressFuzzyMatch: e.target.checked
                   }))}
                   className="rounded"
                 />
                 <span className="text-sm">Use address fuzzy matching (threshold: {importOptions.fuzzyMatchThreshold})</span>
               </label>
             </div>
           </div>

           {/* Standardization Suggestions */}
           {Object.keys(standardizations.locations).length > 0 && (
             <div className="mb-4">
               <h4 className="font-medium mb-2">Location Standardizations</h4>
               <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2 bg-gray-50">
                 {Object.entries(standardizations.locations).map(([original, standard], idx) => (
                   <div key={idx} className="flex items-center gap-2 text-sm">
                     <span className="px-2 py-1 bg-white rounded border">{original}</span>
                     <span>→</span>
                     <input
                       type="text"
                       value={standard}
                       onChange={(e) => setStandardizations(prev => ({
                         ...prev,
                         locations: { ...prev.locations, [original]: e.target.value }
                       }))}
                       className="px-2 py-1 border rounded"
                     />
                   </div>
                 ))}
               </div>
             </div>
           )}

           <div className="flex justify-end gap-3 mt-6">
             <button
               onClick={() => {
                 setShowImportModal(false);
                 setImportPreview(null);
               }}
               className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
             >
               Cancel
             </button>
              <button
               onClick={async () => {
                 // Process the import - actually apply the updates
                 console.log('Processing import with options:', importOptions);
                 
                 // Show processing modal
                 setShowImportModal(false);
                 setIsProcessingImport(true);
                 setImportProgress({ current: 0, total: 0, message: 'Preparing import...' });
                 
                 try {
                   // Apply matched updates
                   const allUpdates = [...(importPreview.matched || []), ...(importPreview.fuzzyMatched || [])];
                   setImportProgress({ current: 0, total: allUpdates.length, message: 'Processing updates...' });
                   
                  // Then update UI with progress tracking
                   let processedCount = 0;
                   const updatedProps = worksheetProperties.map(prop => {
                     const match = allUpdates.find(m => 
                       m.currentData.id === prop.id  // Use ID for matching
                     );
                     if (match) {
                       processedCount++;
                       // Update progress every 10 items or on last item
                       if (processedCount % 10 === 0 || processedCount === allUpdates.length) {
                         setImportProgress({ 
                           current: processedCount, 
                           total: allUpdates.length, 
                           message: `Updating property ${processedCount} of ${allUpdates.length}...` 
                         });
                       }
                       return {
                         ...prop,
                         new_vcs: match.updates.new_vcs || prop.new_vcs,
                         location_analysis: match.updates.location_analysis || prop.location_analysis,
                         asset_zoning: match.updates.asset_zoning || prop.asset_zoning,
                         asset_map_page: match.updates.asset_map_page || prop.asset_map_page,
                         asset_key_page: match.updates.asset_key_page || prop.asset_key_page
                       };
                     }
                     return prop;
                   });
                   
                   setWorksheetProperties(updatedProps);
                   setFilteredWorksheetProps(updatedProps);
                   updateWorksheetStats(updatedProps);
                   
                   // Mark as ready if option selected
                   if (importOptions.markImportedAsReady) {
                     const importedKeys = allUpdates.map(m => m.currentData.property_composite_key);
                     setReadyProperties(prev => new Set([...prev, ...importedKeys]));
                   }
                   
                   // Update stats
                   updateWorksheetStats(worksheetProperties);
                   setUnsavedChanges(true);
                   
                    setImportProgress({ 
                     current: allUpdates.length, 
                     total: allUpdates.length, 
                     message: 'Import complete!' 
                   });
                   
                   // Small delay to show completion
                   setTimeout(() => {
                     setIsProcessingImport(false);
                     setImportProgress({ current: 0, total: 0, message: '' });
                     alert(`Successfully imported ${allUpdates.length} property updates`);
                   }, 1000);
                   
                   setImportPreview(null);
                 } catch (error) {
                   console.error('Error applying import:', error);
                   setIsProcessingImport(false);
                   setImportProgress({ current: 0, total: 0, message: '' });
                   alert('Error applying import. Please check the console.');
                 }
               }}
               className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
             >
               Import {(importPreview.matched?.length || 0) + (importPreview.fuzzyMatched?.length || 0)} Updates
             </button>
           </div>
         </div>
       </div>
     )}
     {/* Import Processing Progress Modal */}
     {isProcessingImport && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md w-full">
           <h3 className="text-lg font-semibold mb-4">Processing Import</h3>
           
           <div className="mb-4">
             <div className="flex justify-between text-sm text-gray-600 mb-2">
               <span>{importProgress.message}</span>
               <span>{importProgress.current} / {importProgress.total}</span>
             </div>
             
             <div className="w-full bg-gray-200 rounded-full h-2">
               <div
                 className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                 style={{
                   width: `${importProgress.total > 0 
                     ? (importProgress.current / importProgress.total * 100) 
                     : 0}%`
                 }}
               />
             </div>
           </div>
           
           <div className="flex items-center justify-center">
             <RefreshCw className="animate-spin text-blue-600" size={20} />
             <span className="ml-2 text-sm text-gray-600">Please wait...</span>
           </div>
         </div>
       </div>
     )}

      {/* Block Detail Modal */}
     {showBlockDetailModal && selectedBlockDetails && (
       <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
         <div className="bg-white rounded-lg p-6 max-w-md w-full">
           <div className="flex justify-between items-center mb-4">
             <h3 className="text-lg font-semibold">
               Block {selectedBlockDetails.block} - {
                 selectedBlockDetails.metric === 'age' ? 'Age' :
                 selectedBlockDetails.metric === 'size' ? 'Size' :
                 'Design'
               } Consistency
             </h3>
             <button
               onClick={() => {
                 setShowBlockDetailModal(false);
                 setSelectedBlockDetails(null);
               }}
               className="text-gray-500 hover:text-gray-700"
             >
               <X size={20} />
             </button>
           </div>
           
           {selectedBlockDetails.metric === 'age' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.ageConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.ageConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.ageConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.ageConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Year Range:</span>
                 <span>{selectedBlockDetails.ageDetails.minYear} - {selectedBlockDetails.ageDetails.maxYear}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Average Year:</span>
                 <span>{selectedBlockDetails.ageDetails.avgYear}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Std Deviation:</span>
                 <span>±{selectedBlockDetails.ageDetails.stdDev} years</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.ageConsistency === 'High' ? 
                   'Very uniform age - excellent for comparables' :
                  selectedBlockDetails.ageConsistency === 'Medium' ?
                   'Moderate age variation - group similar ages' :
                  selectedBlockDetails.ageConsistency === 'Low' ?
                   'Wide age variation - careful comparable selection' :
                   'Mixed ages - requires detailed analysis'}
               </div>
             </div>
           )}
           
           {selectedBlockDetails.metric === 'size' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.sizeConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.sizeConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.sizeConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.sizeConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Size Range:</span>
                 <span>{selectedBlockDetails.sizeDetails.minSize.toLocaleString()} - {selectedBlockDetails.sizeDetails.maxSize.toLocaleString()} sf</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Average Size:</span>
                 <span>{selectedBlockDetails.sizeDetails.avgSize.toLocaleString()} sf</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Variation (CV):</span>
                 <span>{selectedBlockDetails.sizeDetails.cv}%</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.sizeConsistency === 'High' ? 
                   'Very uniform sizes - excellent comparables' :
                  selectedBlockDetails.sizeConsistency === 'Medium' ?
                   'Moderate size variation - reasonable comparables' :
                  selectedBlockDetails.sizeConsistency === 'Low' ?
                   'Wide size variation - adjust for size differences' :
                   'Mixed sizes - requires careful analysis'}
               </div>
             </div>
           )}
           
           {selectedBlockDetails.metric === 'design' && (
             <div className="space-y-3">
               <div className="flex justify-between">
                 <span className="font-medium">Rating:</span>
                 <span className={`font-semibold ${
                   selectedBlockDetails.designConsistency === 'High' ? 'text-green-600' :
                   selectedBlockDetails.designConsistency === 'Medium' ? 'text-yellow-600' :
                   selectedBlockDetails.designConsistency === 'Low' ? 'text-orange-600' :
                   'text-red-600'
                 }`}>
                   {selectedBlockDetails.designConsistency}
                 </span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Unique Designs:</span>
                 <span>{selectedBlockDetails.designDetails.uniqueDesigns} types</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Dominant Style:</span>
                 <span>{selectedBlockDetails.designDetails.dominantDesign}</span>
               </div>
               <div className="flex justify-between">
                 <span className="text-gray-600">Dominance:</span>
                 <span>{selectedBlockDetails.designDetails.dominantPercent}%</span>
               </div>
               <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
                 {selectedBlockDetails.designConsistency === 'High' ? 
                   'Very uniform design - excellent comparables' :
                  selectedBlockDetails.designConsistency === 'Medium' ?
                   'Similar designs - good comparable pool' :
                  selectedBlockDetails.designConsistency === 'Low' ?
                   'Varied designs - consider style adjustments' :
                   'Mixed designs - requires detailed analysis'}
               </div>
             </div>
           )}
         </div>
       </div>
     )}  
   </div>
 );
};
export default PreValuationTab;
