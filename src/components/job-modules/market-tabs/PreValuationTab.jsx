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
  const [equalizationRatio, setEqualizationRatio] = useState(1.00);
  const [outlierThreshold, setOutlierThreshold] = useState(15);
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
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [readyProperties, setReadyProperties] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });
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

  // Vendor detection
  const vendorType = jobData?.vendor_source || jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

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
    
    return typeName || property.asset_typeuse || '';
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
        .order('county');
      
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

  // ==================== WORKSHEET INITIALIZATION ====================
  useEffect(() => {
    if (properties && properties.length > 0) {
      const worksheetData = properties.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        
        return {
          id: prop.id,
          property_composite_key: prop.property_composite_key,
          ...parsed,
          property_address: prop.property_address,
          property_class: prop.property_class || prop.property_m4_class,
          asset_vcs: prop.asset_vcs || prop.current_vcs || '',
          asset_newvcs: prop.asset_newvcs || '',
          location_analysis: prop.location_analysis || '',
          asset_zoning: prop.asset_zoning || '',
          asset_map_page: prop.asset_map_page || '',
          asset_key_page: prop.asset_key_page || '',
          worksheet_notes: prop.worksheet_notes || '',
          // Display values
          building_class_display: getBuildingClassDisplay(prop),
          type_use_display: getTypeUseDisplay(prop),
          design_display: getDesignDisplay(prop)
        };
      });

      setWorksheetProperties(worksheetData);
      setFilteredWorksheetProps(worksheetData);
      updateWorksheetStats(worksheetData);
    }
  }, [properties, parseCompositeKey, getBuildingClassDisplay, getTypeUseDisplay, getDesignDisplay]);

  // ==================== NORMALIZATION FUNCTIONS ====================
  
  const getHPIMultiplier = useCallback((saleYear, targetYear) => {
    if (saleYear === targetYear) return 1.0;
    
    const saleYearData = hpiData.find(h => h.observation_year === saleYear);
    const targetYearData = hpiData.find(h => h.observation_year === targetYear);
    
    if (!saleYearData || !targetYearData) {
      console.warn(`Missing HPI data for year ${!saleYearData ? saleYear : targetYear}. Using 1.0 multiplier.`);
      return 1.0;
    }
    
    const saleHPI = saleYearData.hpi_index || 100;
    const targetHPI = targetYearData.hpi_index || 100;
    
    return targetHPI / saleHPI;
  }, [hpiData]);

  const runTimeNormalization = useCallback(async () => {
    setIsProcessingTime(true);
    
    try {
      // Filter for VALID residential sales only (as discussed)
      const validSales = properties.filter(p => {
        if (!p.sale_price || p.sale_price < minSalePrice) return false;
        if (!p.sale_date) return false;
        
        const saleYear = new Date(p.sale_date).getFullYear();
        if (saleYear < salesFromYear) return false;
        
        // Must have building class > 10, typeuse, and design
        if (!p.asset_building_class || parseInt(p.asset_building_class) <= 10) return false;
        if (!p.asset_typeuse) return false;
        if (!p.asset_design_style) return false;
        
        return true;
      });

      const excludedCount = properties.filter(p => 
        p.sale_price && p.sale_price > 0 && p.sale_price < minSalePrice
      ).length;

      // Process each valid sale
      const normalized = validSales.map(prop => {
        const saleYear = new Date(prop.sale_date).getFullYear();
        const hpiMultiplier = getHPIMultiplier(saleYear, normalizeToYear);
        const timeNormalizedPrice = Math.round(prop.sale_price * hpiMultiplier);
        
        // Calculate sales ratio if we have assessed value
        const salesRatio = prop.assessed_value ? 
          (prop.assessed_value / timeNormalizedPrice) : null;
        
        // Flag outliers based on equalization ratio
        const lowerBound = equalizationRatio * (1 - outlierThreshold/100);
        const upperBound = equalizationRatio * (1 + outlierThreshold/100);
        const isOutlier = salesRatio && 
          (salesRatio < lowerBound || salesRatio > upperBound);
        
        return {
          ...prop,
          time_normalized_price: timeNormalizedPrice,
          hpi_multiplier: hpiMultiplier,
          sales_ratio: salesRatio,
          is_outlier: isOutlier,
          keep_reject: 'pending'
        };
      });

      setTimeNormalizedSales(normalized);
      
      // Calculate stats
      const totalRatio = normalized.reduce((sum, s) => sum + (s.sales_ratio || 0), 0);
      const avgRatio = normalized.length > 0 ? totalRatio / normalized.length : 0;
      
      setNormalizationStats(prev => ({
        ...prev,
        totalSales: normalized.length,
        timeNormalized: normalized.length,
        excluded: excludedCount,
        flaggedOutliers: normalized.filter(s => s.is_outlier).length,
        pendingReview: normalized.filter(s => s.keep_reject === 'pending').length,
        averageRatio: avgRatio.toFixed(2)
      }));

      console.log(`✅ Time normalization complete for ${normalized.length} sales`);
    } catch (error) {
      console.error('Error during time normalization:', error);
      alert('Error during time normalization. Please check the console.');
    } finally {
      setIsProcessingTime(false);
    }
  }, [properties, salesFromYear, minSalePrice, normalizeToYear, equalizationRatio, outlierThreshold, getHPIMultiplier]);

  const runSizeNormalization = useCallback(async () => {
    setIsProcessingSize(true);
    
    try {
      // Only use sales that were kept after time normalization review
      const acceptedSales = timeNormalizedSales.filter(s => s.keep_reject === 'keep');
      
      // Group by type/use codes as discussed
      const groups = {
        singleFamily: acceptedSales.filter(s => 
          s.asset_typeuse && !['42','43','44','30','31','51','52','53'].includes(s.asset_typeuse)
        ),
        multifamily: acceptedSales.filter(s => 
          ['42','43','44'].includes(s.asset_typeuse)
        ),
        townhouses: acceptedSales.filter(s => 
          ['30','31'].includes(s.asset_typeuse)
        ),
        conversions: acceptedSales.filter(s => 
          ['51','52','53'].includes(s.asset_typeuse)
        )
      };

      let totalSizeNormalized = 0;
      let totalAdjustment = 0;

      // Process each group
      Object.entries(groups).forEach(([groupName, groupSales]) => {
        if (groupSales.length === 0) return;
        
        // Calculate average size for the group
        const totalSize = groupSales.reduce((sum, s) => sum + (s.asset_lot_sf || 0), 0);
        const avgSize = totalSize / groupSales.length;
        
        // Apply 50% method to each sale
        groupSales.forEach(sale => {
          const currentSize = sale.asset_lot_sf || 0;
          const sizeDiff = avgSize - currentSize;
          const pricePerSf = sale.time_normalized_price / currentSize;
          const adjustment = sizeDiff * pricePerSf * 0.5;
          
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
        singleFamily: groups.singleFamily.length,
        multifamily: groups.multifamily.length,
        townhouses: groups.townhouses.length,
        conversions: groups.conversions.length,
        avgSizeAdjustment: totalSizeNormalized > 0 ? 
          Math.round(totalAdjustment / totalSizeNormalized) : 0
      }));

      // Save to database
      await saveSizeNormalizedValues(acceptedSales);
      
      console.log(`✅ Size normalization complete for ${totalSizeNormalized} sales`);
    } catch (error) {
      console.error('Error during size normalization:', error);
      alert('Error during size normalization. Please check the console.');
    } finally {
      setIsProcessingSize(false);
    }
  }, [timeNormalizedSales]);

  const handleSalesDecision = async (saleId, decision) => {
    const updatedSales = timeNormalizedSales.map(sale =>
      sale.id === saleId ? { ...sale, keep_reject: decision } : sale
    );
    setTimeNormalizedSales(updatedSales);

    // Update database based on decision
    if (decision === 'keep') {
      // Save time normalized value
      const sale = timeNormalizedSales.find(s => s.id === saleId);
      await supabase
        .from('property_records')
        .update({ values_norm_time: sale.time_normalized_price })
        .eq('id', saleId);
    } else {
      // Clear the value if rejected
      await supabase
        .from('property_records')
        .update({ values_norm_time: null })
        .eq('id', saleId);
    }

    // Update pending count
    setNormalizationStats(prev => ({
      ...prev,
      pendingReview: updatedSales.filter(s => s.keep_reject === 'pending').length
    }));
  };

  const saveSizeNormalizedValues = async (sales) => {
    for (const sale of sales) {
      if (sale.size_normalized_price) {
        await supabase
          .from('property_records')
          .update({ values_norm_size: sale.size_normalized_price })
          .eq('id', sale.id);
      }
    }
  };

  // ==================== WORKSHEET FUNCTIONS ====================
  
  const updateWorksheetStats = useCallback((props) => {
    const stats = {
      totalProperties: props.length,
      vcsAssigned: props.filter(p => p.asset_newvcs).length,
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
            [field]: field === 'asset_newvcs' || field === 'asset_zoning' 
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
            asset_newvcs: prop.asset_newvcs,
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
    handleWorksheetChange(propertyKey, 'asset_newvcs', currentVCS);
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

  // ==================== IMPORT/EXPORT FUNCTIONS ====================
  
  const exportWorksheetToExcel = () => {
    let csv = 'Block,Lot,Qualifier,Card,Location,Address,Class,Current VCS,Building,Type/Use,Design,New VCS,Location Analysis,Zoning,Map Page,Key Page,Notes,Ready\n';
    
    filteredWorksheetProps.forEach(prop => {
      csv += `"${prop.block}","${prop.lot}","${prop.qualifier || ''}","${prop.card || ''}","${prop.location || ''}",`;
      csv += `"${prop.property_address}","${prop.property_class}","${prop.asset_vcs}",`;
      csv += `"${prop.building_class_display}","${prop.type_use_display}","${prop.design_display}",`;
      csv += `"${prop.asset_newvcs}","${prop.location_analysis}","${prop.asset_zoning}",`;
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
      
      // Analysis logic from our discussion
      const analysis = {
        fileName: file.name,
        totalRows: jsonData.length,
        matched: [],
        unmatched: [],
        fuzzyMatched: []
      };
      
      // Process each row
      for (const row of jsonData) {
        // Matching logic here...
      }
      
      setImportPreview(analysis);
      setShowImportModal(true);
    } catch (error) {
      console.error('Error analyzing import file:', error);
      alert('Error analyzing file. Please check the format.');
    } finally {
      setIsAnalyzingImport(false);
    }
  };

  // ==================== SEARCH AND FILTER ====================
  
  useEffect(() => {
    let filtered = [...worksheetProperties];
    
    if (worksheetSearchTerm) {
      const searchLower = worksheetSearchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.property_address?.toLowerCase().includes(searchLower) ||
        p.property_composite_key?.toLowerCase().includes(searchLower) ||
        p.block?.includes(worksheetSearchTerm) ||
        p.lot?.includes(worksheetSearchTerm)
      );
    }
    
    switch (worksheetFilter) {
      case 'missing-vcs':
        filtered = filtered.filter(p => !p.asset_newvcs);
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
        filtered = filtered.filter(p => p.asset_newvcs && p.asset_zoning);
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
        <div className="space-y-6">
          {/* Configuration Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Normalization Configuration</h3>
              <div className="flex items-center gap-4">
                {hpiLoaded && (
                  <span className="text-green-600 text-sm">✓ HPI Data Loaded</span>
                )}
                <button
                  onClick={runTimeNormalization}
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
                  Equalization Ratio
                </label>
                <input
                  type="number"
                  value={equalizationRatio}
                  onChange={(e) => setEqualizationRatio(parseFloat(e.target.value))}
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
                <p className="text-xs text-gray-500 mt-1">For outlier detection (typically 0.85-1.15)</p>
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
                    <div className="text-2xl font-bold">{normalizationStats.averageRatio}</div>
                    <div className="text-sm text-gray-600">Average Ratio</div>
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
                      <option value="single-family">Single Family (10)</option>
                      <option value="multifamily">Multifamily (42/43/44)</option>
                    </select>
                    <button
                      onClick={() => {/* Export logic */}}
                      className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Property ID</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Address</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Type</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sale Date</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Sale Price</th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Time Norm</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Ratio</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Status</th>
                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeNormalizedSales
                        .filter(sale => {
                          if (salesReviewFilter === 'all') return true;
                          if (salesReviewFilter === 'flagged') return sale.is_outlier;
                          if (salesReviewFilter === 'pending') return sale.keep_reject === 'pending';
                          if (salesReviewFilter === 'single-family') return sale.asset_typeuse === '10';
                          if (salesReviewFilter === 'multifamily') return ['42','43','44'].includes(sale.asset_typeuse);
                          return true;
                        })
                        .slice(0, 50)
                        .map((sale) => (
                          <tr key={sale.id} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">{sale.property_composite_key}</td>
                            <td className="px-4 py-3 text-sm">{sale.property_address}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                {getTypeUseDisplay(sale)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {new Date(sale.sale_date).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                              ${sale.sale_price?.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-right">
                              ${sale.time_normalized_price?.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {sale.sales_ratio?.toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-center">
                              {sale.is_outlier ? (
                                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
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
                        ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded">
                  <p className="text-sm">
                    <strong>Review Guidelines:</strong> Sales with ratios outside {(equalizationRatio * (1 - outlierThreshold/100)).toFixed(2)}-{(equalizationRatio * (1 + outlierThreshold/100)).toFixed(2)} are flagged. 
                    Consider property condition, special circumstances, and market conditions when making keep/reject decisions.
                  </p>
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
                    Properties are grouped by type and adjusted to their group's average size:
                  </p>
                  <ul className="text-sm mt-2 space-y-1">
                    <li>• <strong>Single Family:</strong> 10 and other residential types (most common)</li>
                    <li>• <strong>Multifamily:</strong> 42, 43, 44 grouped together (if present)</li>
                    <li>• <strong>Townhouses/Row:</strong> 30, 31 grouped together (if present)</li>
                    <li>• <strong>Conversions:</strong> 51, 52, 53 grouped together (if present)</li>
                    <li>• <strong>Tax Exempt:</strong> 15A-F included (residences, parsonages, group homes)</li>
                  </ul>
                </div>

                {normalizationStats.sizeNormalized > 0 && (
                  <div className="grid grid-cols-6 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.acceptedSales}</div>
                      <div className="text-sm text-gray-600">Accepted Sales</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.sizeNormalized}</div>
                      <div className="text-sm text-gray-600">Size Normalized</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.singleFamily}</div>
                      <div className="text-sm text-gray-600">Single Family</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.multifamily}</div>
                      <div className="text-sm text-gray-600">Multifamily (42-44)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.townhouses}</div>
                      <div className="text-sm text-gray-600">Townhouses (30-31)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{normalizationStats.conversions}</div>
                      <div className="text-sm text-gray-600">Conversions (51-53)</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
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
                <div className="text-2xl font-bold">
                  {lastAutoSave ? `${Math.floor((Date.now() - lastAutoSave) / 60000)} min ago` : 'Never'}
                </div>
                <div className="text-sm text-gray-600">Last Auto-Save</div>
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
                </select>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full">
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Qual</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Card</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Loc</th>
                    <th 
                      className="px-3 py-2 text-left text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                      onClick={() => handleSort('property_address')}
                    >
                      Address {sortConfig.field === 'property_address' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Class</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Current VCS</th>
                    <th></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Building</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Type/Use</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Design</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">New VCS</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">Location Analysis</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">Zoning</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">Map Page</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">Key Page</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 bg-blue-50">Notes</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-700 bg-green-50">Ready</th>
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
                      <td className="px-3 py-2 text-sm">{prop.property_address}</td>
                      <td className="px-3 py-2 text-sm">{prop.property_class}</td>
                      <td className="px-3 py-2 text-sm">{prop.asset_vcs}</td>
                      <td className="px-1">
                        <button
                          onClick={() => copyCurrentVCS(prop.property_composite_key, prop.asset_vcs)}
                          className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded"
                          title="Copy current VCS to new"
                        >
                          →
                        </button>
                      </td>
                      <td className="px-3 py-2 text-sm">{prop.building_class_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.type_use_display}</td>
                      <td className="px-3 py-2 text-sm">{prop.design_display}</td>
                      <td className="px-2 py-1 bg-gray-50">
                        <input
                          type="text"
                          value={prop.asset_newvcs}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_newvcs', e.target.value)}
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
                            if (e.target.checked) {
                              setReadyProperties(prev => new Set([...prev, prop.property_composite_key]));
                            } else {
                              setReadyProperties(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(prop.property_composite_key);
                                return newSet;
                              });
                            }
                            updateWorksheetStats(worksheetProperties);
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
               onClick={() => {
                 // Process the import
                 console.log('Processing import with options:', importOptions);
                 setShowImportModal(false);
               }}
               className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
             >
               Import {importPreview.matched?.length || 0} Updates
             </button>
           </div>
         </div>
       </div>
     )}

     {/* Auto-save indicator */}
     {unsavedChanges && (
       <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center gap-2">
         <RefreshCw className="animate-spin text-blue-600" size={16} />
         <span className="text-sm">Auto-saving...</span>
       </div>
     )}
   </div>
 );
};

export default PreValuationTab;
