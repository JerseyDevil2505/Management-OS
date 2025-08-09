import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx';
import { 
  TrendingUp, 
  Scale, 
  Download, 
  Upload, 
  Save,
  RefreshCw,
  AlertCircle,
  Check,
  X,
  Grid,
  Map as MapIcon,
  ChevronLeft,
  ChevronRight,
  Settings,
  FileSpreadsheet
} from 'lucide-react';

const PreValuationTab = ({ jobData, properties }) => {
  // ==================== BATCH OPERATIONS FOR WORKSHEET ====================
  const applyBatchVCS = (vcsValue) => {
    const filtered = filteredWorksheetProps.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
    
    setWorksheetProperties(prev => {
      const updated = prev.map(prop => {
        const isInCurrentPage = filtered.some(f => f.id === prop.id);
        if (isInCurrentPage) {
          return { ...prop, asset_newvcs: vcsValue.toUpperCase() };
        }
        return prop;
      });
      
      updateWorksheetStats(updated);
      return updated;
    });
    
    setUnsavedChanges(true);
  };

  const applyBatchZoning = (zoningValue) => {
    const filtered = filteredWorksheetProps.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
    
    setWorksheetProperties(prev => {
      const updated = prev.map(prop => {
        const isInCurrentPage = filtered.some(f => f.id === prop.id);
        if (isInCurrentPage) {
          return { ...prop, asset_zoning: zoningValue.toUpperCase() };
        }
        return prop;
      });
      
      updateWorksheetStats(updated);
      return updated;
    });
    
    setUnsavedChanges(true);
  };

  const markAllReady = (ready) => {
    const filtered = filteredWorksheetProps.slice(
      (currentPage - 1) * itemsPerPage,
      currentPage * itemsPerPage
    );
    
    if (ready) {
      const keysToAdd = filtered.map(p => p.property_composite_key);
      setReadyProperties(prev => new Set([...prev, ...keysToAdd]));
    } else {
      setReadyProperties(prev => {
        const newSet = new Set(prev);
        filtered.forEach(p => newSet.delete(p.property_composite_key));
        return newSet;
      });
    }
    
    updateWorksheetStats(worksheetProperties);
    setUnsavedChanges(true);
  };

  // ==================== LOAD PREVIOUSLY SAVED DATA ====================
  useEffect(() => {
    const loadSavedWorksheetData = async () => {
      if (!jobData?.id) return;
      
      try {
        // Load any previously saved worksheet data from staging
        const { data, error } = await supabase
          .from('market_land_valuation')
          .select('*')
          .eq('job_id', jobData.id)
          .single();
        
        if (data) {
          // Restore worksheet data if it exists
          if (data.worksheet_data && Array.isArray(data.worksheet_data)) {
            console.log(`📋 Loading saved worksheet data (${data.worksheet_data.length} entries)`);
            
            // Merge saved data with current properties
            const mergedProperties = worksheetProperties.map(prop => {
              const savedData = data.worksheet_data.find(
                s => s.property_composite_key === prop.property_composite_key
              );
              
              if (savedData) {
                return {
                  ...prop,
                  asset_newvcs: savedData.asset_newvcs || prop.asset_newvcs,
                  location_analysis: savedData.location_analysis || prop.location_analysis,
                  asset_zoning: savedData.asset_zoning || prop.asset_zoning,
                  asset_map_page: savedData.asset_map_page || prop.asset_map_page,
                  asset_key_page: savedData.asset_key_page || prop.asset_key_page,
                  worksheet_notes: savedData.worksheet_notes || prop.worksheet_notes
                };
              }
              return prop;
            });
            
            setWorksheetProperties(mergedProperties);
            
            // Restore ready properties
            const readyKeys = data.worksheet_data
              .filter(d => d.worksheet_ready)
              .map(d => d.property_composite_key);
            setReadyProperties(new Set(readyKeys));
          }
          
          // Restore location variations if they exist
          if (data.worksheet_stats?.location_variations) {
            setLocationVariations(data.worksheet_stats.location_variations);
          }
          
          // Show status if worksheet was already completed
          if (data.is_worksheet_complete) {
            console.log('✅ This worksheet has been completed and finalized');
          } else {
            console.log('📝 Worksheet in progress - loaded from staging');
          }
        }
      } catch (error) {
        if (error.code !== 'PGRST116') { // Not found is OK
          console.error('Error loading saved worksheet data:', error);
        }
      }
    };

    // Only load after properties are initialized
    if (worksheetProperties.length > 0) {
      loadSavedWorksheetData();
    }
  }, [jobData?.id, worksheetProperties.length]);

  // ==================== STATE MANAGEMENT ====================
  // Normalization Component State
  const [activeSubTab, setActiveSubTab] = useState('normalization');
  const [timeNormalizedSales, setTimeNormalizedSales] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetYear, setTargetYear] = useState(2012);
  const [hpiData, setHpiData] = useState([]);
  const [salesFilter, setSalesFilter] = useState('all');
  const [normalizationStats, setNormalizationStats] = useState({
    totalSales: 0,
    timeNormalized: 0,
    sizeNormalized: 0,
    flaggedOutliers: 0
  });

  // Page by Page Worksheet State
  const [worksheetProperties, setWorksheetProperties] = useState([]);
  const [filteredWorksheetProps, setFilteredWorksheetProps] = useState([]);
  const [worksheetSearchTerm, setWorksheetSearchTerm] = useState('');
  const [worksheetFilter, setWorksheetFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [worksheetAutoSaveTimer, setWorksheetAutoSaveTimer] = useState(null);
  const [readyProperties, setReadyProperties] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });
  const [locationVariations, setLocationVariations] = useState({});
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [currentLocationChoice, setCurrentLocationChoice] = useState(null);
  const [worksheetStats, setWorksheetStats] = useState({
    totalProperties: 0,
    vcsCompleted: 0,
    locationCompleted: 0,
    zoningCompleted: 0,
    readyCount: 0
  });
  
  // Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [isAnalyzingImport, setIsAnalyzingImport] = useState(false);
  const [importOptions, setImportOptions] = useState({
    updateExisting: true,
    addMissing: false,
    useAddressFuzzyMatch: true,
    fuzzyMatchThreshold: 0.8,
    markImportedAsReady: true
  });
  const [standardizations, setStandardizations] = useState({
    vcs: {},
    locations: {},
    zones: {}
  });

  // ==================== VENDOR & CODE UTILITIES ====================
  const vendorType = jobData?.vendor_source || jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

  // ==================== HELPER FUNCTIONS USING interpretCodes ====================
  
  // Get building class display - NO ASSUMPTIONS!
  const getBuildingClassDisplay = useCallback((property) => {
    if (!property || !codeDefinitions) return '';
    
    // For BRT, check if we have building class definitions
    if (vendorType === 'BRT' && codeDefinitions.sections?.Residential) {
      const code = property.asset_building_class;
      if (!code) return '';
      
      const definition = codeDefinitions.sections.Residential[code];
      if (definition?.VALUE) return definition.VALUE;
      if (definition?.DESCRIPTION) return definition.DESCRIPTION;
    }
    
    // Return raw value if no definition found
    return property.asset_building_class || '';
  }, [vendorType, codeDefinitions]);

  // Get type/use display using interpretCodes
  const getTypeUseDisplay = useCallback((property) => {
    if (!property) return '';
    
    // Use interpretCodes utility for proper decoding
    const typeName = interpretCodes.getTypeName(property, codeDefinitions, vendorType);
    if (typeName && typeName !== property.asset_type_use) {
      return typeName;
    }
    
    // Return raw value if no decoded name
    return property.asset_typeuse || property.asset_type_use || '';
  }, [vendorType, codeDefinitions]);

  // Get design display using interpretCodes
  const getDesignDisplay = useCallback((property) => {
    if (!property) return '';
    
    // Use interpretCodes utility for proper decoding
    const designName = interpretCodes.getDesignName(property, codeDefinitions, vendorType);
    if (designName && designName !== property.asset_design_style) {
      return designName;
    }
    
    // Return raw value if no decoded name
    return property.asset_design_style || '';
  }, [vendorType, codeDefinitions]);

  // Parse composite key to extract block/lot/qualifier
  const parseCompositeKey = useCallback((compositeKey) => {
    if (!compositeKey) return { block: '', lot: '', qualifier: '' };
    
    // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
    const parts = compositeKey.split('-');
    if (parts.length < 3) return { block: '', lot: '', qualifier: '' };
    
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

  // ==================== HPI DATA LOADING ====================
  useEffect(() => {
    const loadHPIData = async () => {
      if (!jobData?.county) return;
      
      try {
        const { data, error } = await supabase
          .from('county_hpi_data')
          .select('*')
          .eq('county', jobData.county)
          .order('year', { ascending: true });
        
        if (error) throw error;
        setHpiData(data || []);
        console.log(`📈 Loaded ${data?.length || 0} years of HPI data for ${jobData.county} County`);
      } catch (error) {
        console.error('Error loading HPI data:', error);
      }
    };

    loadHPIData();
  }, [jobData?.county]);

  // ==================== NORMALIZATION FUNCTIONS ====================
  const getHPIMultiplier = useCallback((saleYear, targetYr) => {
    if (saleYear === targetYr) return 1.0;
    
    const saleYearData = hpiData.find(h => h.year === saleYear);
    const targetYearData = hpiData.find(h => h.year === targetYr);
    
    if (!saleYearData || !targetYearData) {
      console.warn(`Missing HPI data for year ${!saleYearData ? saleYear : targetYr}. Using 1.0 multiplier.`);
      return 1.0;
    }
    
    const saleHPI = saleYearData.hpi_value || 100;
    const targetHPI = targetYearData.hpi_value || 100;
    
    return targetHPI / saleHPI;
  }, [hpiData]);

  const performNormalization = useCallback(async () => {
    setIsProcessing(true);
    
    try {
      // Filter properties with sales
      const salesProperties = properties.filter(p => 
        p.sale_price && p.sale_price > 0 && p.sale_date
      );

      console.log(`🔄 Processing ${salesProperties.length} sales for normalization`);

      // Process each sale
      const normalized = salesProperties.map(prop => {
        const saleYear = new Date(prop.sale_date).getFullYear();
        const hpiMultiplier = getHPIMultiplier(saleYear, targetYear);
        
        // Time normalization
        const timeNormalizedPrice = Math.round(prop.sale_price * hpiMultiplier);
        
        // Size normalization (Jim's 50% formula)
        let sizeNormalizedPrice = prop.sale_price;
        if (prop.asset_lot_sf && prop.sale_lot_size) {
          const sizeDiff = prop.asset_lot_sf - prop.sale_lot_size;
          const pricePerSf = prop.sale_price / prop.sale_lot_size;
          sizeNormalizedPrice = Math.round(prop.sale_price + (sizeDiff * pricePerSf * 0.5));
        }
        
        // Calculate sales ratio (if we have an assessed value)
        const salesRatio = prop.assessed_value ? 
          (prop.assessed_value / timeNormalizedPrice) : null;
        
        // Flag outliers (outside 15% of equalization ratio)
        const equalizationRatio = jobData?.equalization_ratio || 1.0;
        const isOutlier = salesRatio && 
          (salesRatio < equalizationRatio * 0.85 || salesRatio > equalizationRatio * 1.15);
        
        return {
          ...prop,
          time_normalized_price: timeNormalizedPrice,
          size_normalized_price: sizeNormalizedPrice,
          hpi_multiplier: hpiMultiplier,
          sales_ratio: salesRatio,
          is_outlier: isOutlier,
          keep_reject: 'pending'
        };
      });

      setTimeNormalizedSales(normalized);
      
      // Update stats
      setNormalizationStats({
        totalSales: normalized.length,
        timeNormalized: normalized.filter(s => s.time_normalized_price).length,
        sizeNormalized: normalized.filter(s => s.size_normalized_price !== s.sale_price).length,
        flaggedOutliers: normalized.filter(s => s.is_outlier).length
      });

      // Save normalized values to database
      await saveNormalizedValues(normalized);
      
      console.log(`✅ Normalization complete for ${normalized.length} sales`);
    } catch (error) {
      console.error('Error during normalization:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [properties, targetYear, getHPIMultiplier, jobData]);



  // ==================== WORKSHEET INITIALIZATION ====================
  useEffect(() => {
    if (properties.length > 0) {
      // Create slimmed-down worksheet data (don't keep full property objects)
      const worksheetData = properties.map(prop => {
        const parsed = parseCompositeKey(prop.property_composite_key);
        
        return {
          // Essential identifiers
          id: prop.id,
          property_composite_key: prop.property_composite_key,
          
          // Display fields
          ...parsed,
          property_address: prop.property_address,
          property_class: prop.property_class || prop.property_m4_class,
          
          // Worksheet editable fields
          asset_newvcs: prop.new_vcs || prop.asset_newvcs || '',
          location_analysis: prop.location_analysis || '',
          asset_zoning: prop.asset_zoning || '',
          asset_map_page: prop.asset_map_page || '',
          asset_key_page: prop.asset_key_page || '',
          worksheet_notes: prop.worksheet_notes || '',
          
          // Calculated display values (compute once)
          building_class_display: getBuildingClassDisplay(prop),
          type_use_display: getTypeUseDisplay(prop),
          design_display: getDesignDisplay(prop),
          
          // Don't include: raw_data, sale history, or other large fields
        };
      });

      setWorksheetProperties(worksheetData);
      setFilteredWorksheetProps(worksheetData);
      
      // Calculate initial stats
      updateWorksheetStats(worksheetData);
      
      console.log(`📊 Initialized worksheet with ${worksheetData.length} properties (optimized for memory)`);
    }
  }, [properties, parseCompositeKey, getBuildingClassDisplay, getTypeUseDisplay, getDesignDisplay]);

  // ==================== WORKSHEET FUNCTIONS ====================
  const updateWorksheetStats = useCallback((props) => {
    const stats = {
      totalProperties: props.length,
      vcsCompleted: props.filter(p => p.asset_newvcs || p.new_vcs).length,
      locationCompleted: props.filter(p => p.location_analysis).length,
      zoningCompleted: props.filter(p => p.asset_zoning).length,
      readyCount: readyProperties.size
    };
    setWorksheetStats(stats);
  }, [readyProperties]);

  const handleWorksheetChange = useCallback((propertyKey, field, value) => {
    // Check for location standardization
    if (field === 'location_analysis' && value) {
      checkLocationStandardization(value, propertyKey);
    }
    
    setWorksheetProperties(prev => {
      const updated = prev.map(prop => 
        prop.property_composite_key === propertyKey
          ? { 
              ...prop, 
              [field]: field === 'asset_newvcs' || field === 'asset_zoning' 
                ? value.toUpperCase() 
                : value 
            }
          : prop
      );
      
      updateWorksheetStats(updated);
      return updated;
    });
    
    setUnsavedChanges(true);
    
    // Reset auto-save timer
    if (worksheetAutoSaveTimer) clearTimeout(worksheetAutoSaveTimer);
    const timer = setTimeout(() => saveWorksheetData(), 30000);
    setWorksheetAutoSaveTimer(timer);
  }, [worksheetAutoSaveTimer, updateWorksheetStats]);

  const checkLocationStandardization = useCallback((value, propertyKey) => {
    if (!value) return;
    
    const valueLower = value.toLowerCase().trim();
    
    // Check for similar existing values
    for (const [standard, variations] of Object.entries(locationVariations)) {
      if (standard.toLowerCase() === valueLower) return;
      
      // Check for common variations
      const patterns = [
        { pattern: /\bave\b/gi, replacement: 'avenue' },
        { pattern: /\bst\b/gi, replacement: 'street' },
        { pattern: /\brd\b/gi, replacement: 'road' },
        { pattern: /\bdr\b/gi, replacement: 'drive' },
        { pattern: /\bln\b/gi, replacement: 'lane' },
        { pattern: /\bct\b/gi, replacement: 'court' },
        { pattern: /\bhwy\b/gi, replacement: 'highway' },
        { pattern: /\brr\b/gi, replacement: 'railroad' }
      ];
      
      let standardNormalized = standard.toLowerCase();
      let valueNormalized = valueLower;
      
      patterns.forEach(({ pattern, replacement }) => {
        standardNormalized = standardNormalized.replace(pattern, replacement);
        valueNormalized = valueNormalized.replace(pattern, replacement);
      });
      
      if (standardNormalized === valueNormalized) {
        handleWorksheetChange(propertyKey, 'location_analysis', standard);
        return;
      }
      
      // Check for partial matches
      const standardWords = standardNormalized.split(/\s+/);
      const valueWords = valueNormalized.split(/\s+/);
      
      if (standardWords.length === valueWords.length) {
        let matchCount = 0;
        for (let i = 0; i < standardWords.length; i++) {
          if (standardWords[i] === valueWords[i] || 
              (standardWords[i].startsWith(valueWords[i]) || valueWords[i].startsWith(standardWords[i]))) {
            matchCount++;
          }
        }
        
        if (matchCount >= standardWords.length - 1) {
          setCurrentLocationChoice({
            propertyKey,
            newValue: value,
            existingStandard: standard,
            variations: variations[standard] || []
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
  }, [locationVariations, handleWorksheetChange]);

  const handleLocationStandardChoice = useCallback((choice) => {
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
    } else if (choice === 'new') {
      setLocationVariations(prev => ({
        ...prev,
        [currentLocationChoice.newValue]: []
      }));
    }
    
    setShowLocationModal(false);
    setCurrentLocationChoice(null);
  }, [currentLocationChoice, handleWorksheetChange]);

  const saveWorksheetData = async () => {
    try {
      console.log('💾 Auto-saving worksheet data...');
      
      // Save worksheet changes to database
      const updates = worksheetProperties
        .filter(p => p.asset_newvcs || p.location_analysis || p.asset_zoning)
        .map(p => ({
          id: p.id,
          new_vcs: p.asset_newvcs,
          location_analysis: p.location_analysis,
          asset_zoning: p.asset_zoning,
          asset_map_page: p.asset_map_page,
          asset_key_page: p.asset_key_page
        }));

      // Update in batches
      for (let i = 0; i < updates.length; i += 100) {
        const batch = updates.slice(i, i + 100);
        
        const { error } = await supabase
          .from('property_records')
          .upsert(batch, { onConflict: 'id' });
        
        if (error) throw error;
      }

      setUnsavedChanges(false);
      console.log(`✅ Saved worksheet data for ${updates.length} properties`);
    } catch (error) {
      console.error('Error saving worksheet data:', error);
    }
  };

  // ==================== SEARCH AND FILTER ====================
  const searchAndFilterWorksheet = useCallback(() => {
    let filtered = [...worksheetProperties];
    
    // Apply search term
    if (worksheetSearchTerm) {
      const searchLower = worksheetSearchTerm.toLowerCase();
      filtered = filtered.filter(p => 
        p.property_address?.toLowerCase().includes(searchLower) ||
        p.property_composite_key?.toLowerCase().includes(searchLower) ||
        p.block?.includes(worksheetSearchTerm) ||
        p.lot?.includes(worksheetSearchTerm)
      );
    }
    
    // Apply filter type
    switch (worksheetFilter) {
      case 'missing-vcs':
        filtered = filtered.filter(p => !p.asset_newvcs && !p.new_vcs);
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
        filtered = filtered.filter(p => 
          (p.asset_newvcs || p.new_vcs) && p.asset_zoning
        );
        break;
    }
    
    // Apply sorting
    if (sortConfig.field) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.field] || '';
        const bVal = b[sortConfig.field] || '';
        
        if (sortConfig.direction === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });
    }
    
    setFilteredWorksheetProps(filtered);
  }, [worksheetSearchTerm, worksheetFilter, worksheetProperties, sortConfig, readyProperties]);

  useEffect(() => {
    searchAndFilterWorksheet();
  }, [searchAndFilterWorksheet]);

  // ==================== COMPLETE SAVE FUNCTIONALITY ====================
  const saveAllWorksheetData = async () => {
    try {
      console.log('💾 Auto-saving worksheet to staging...');
      
      // Only save properties that have been edited (optimization for large datasets)
      const editedProperties = worksheetProperties.filter(p => 
        p.asset_newvcs || 
        p.location_analysis || 
        p.asset_zoning || 
        p.asset_map_page || 
        p.asset_key_page || 
        p.worksheet_notes ||
        readyProperties.has(p.property_composite_key)
      );
      
      console.log(`📝 Saving ${editedProperties.length} edited properties (of ${worksheetProperties.length} total)`);
      
      // Create slimmed staging data
      const stagingData = {
        job_id: jobData.id,
        worksheet_data: editedProperties.map(p => ({
          // Only save essential fields to reduce payload size
          id: p.id,
          property_composite_key: p.property_composite_key,
          asset_newvcs: p.asset_newvcs,
          location_analysis: p.location_analysis,
          asset_zoning: p.asset_zoning,
          asset_map_page: p.asset_map_page,
          asset_key_page: p.asset_key_page,
          worksheet_notes: p.worksheet_notes,
          worksheet_ready: readyProperties.has(p.property_composite_key)
        })),
        worksheet_stats: {
          total_properties: worksheetStats.totalProperties,
          vcs_completed: worksheetStats.vcsCompleted,
          location_completed: worksheetStats.locationCompleted,
          zoning_completed: worksheetStats.zoningCompleted,
          ready_count: worksheetStats.readyCount,
          location_variations: locationVariations,
          last_saved: new Date().toISOString(),
          edited_count: editedProperties.length
        },
        is_worksheet_complete: false,
        updated_at: new Date().toISOString()
      };

      // Check size before sending (JSONB limit is typically 1GB but let's be safe)
      const dataSize = new Blob([JSON.stringify(stagingData)]).size;
      const sizeMB = (dataSize / 1024 / 1024).toFixed(2);
      
      console.log(`📦 Staging data size: ${sizeMB}MB for ${editedProperties.length} properties`);
      
      // For very large datasets, use chunked approach
      if (dataSize > 50 * 1024 * 1024 || editedProperties.length > 10000) {
        console.log(`📊 Large dataset detected - using chunked save approach`);
        
        // Save in chunks of 5000 properties
        const chunkSize = 5000;
        const chunks = [];
        
        for (let i = 0; i < editedProperties.length; i += chunkSize) {
          chunks.push(editedProperties.slice(i, i + chunkSize));
        }
        
        // Save metadata first
        const metadataOnly = {
          job_id: jobData.id,
          worksheet_stats: stagingData.worksheet_stats,
          is_worksheet_complete: false,
          worksheet_chunk_count: chunks.length,
          updated_at: new Date().toISOString()
        };
        
        const { error: metaError } = await supabase
          .from('market_land_valuation')
          .upsert(metadataOnly, { onConflict: 'job_id' });
        
        if (metaError) throw metaError;
        
        // Save each chunk
        for (let i = 0; i < chunks.length; i++) {
          const chunkData = {
            job_id: jobData.id,
            [`worksheet_data_chunk_${i}`]: chunks[i].map(p => ({
              id: p.id,
              property_composite_key: p.property_composite_key,
              asset_newvcs: p.asset_newvcs,
              location_analysis: p.location_analysis,
              asset_zoning: p.asset_zoning,
              asset_map_page: p.asset_map_page,
              asset_key_page: p.asset_key_page,
              worksheet_notes: p.worksheet_notes,
              worksheet_ready: readyProperties.has(p.property_composite_key)
            }))
          };
          
          const { error: chunkError } = await supabase
            .from('market_land_valuation')
            .update(chunkData)
            .eq('job_id', jobData.id);
          
          if (chunkError) {
            console.error(`Error saving chunk ${i + 1}:`, chunkError);
          } else {
            console.log(`✅ Saved chunk ${i + 1} of ${chunks.length}`);
          }
        }
        
        console.log('✅ All chunks saved to staging');
      } else {
        // Normal save for smaller datasets
        const { error } = await supabase
          .from('market_land_valuation')
          .upsert(stagingData, { onConflict: 'job_id' });

        if (error) {
          console.error('Error saving to staging:', error);
          throw error;
        }
        
        console.log('✅ Worksheet saved to staging');
      }
      setUnsavedChanges(false);
      
      return { success: true, savedCount: editedProperties.length };
    } catch (error) {
      console.error('Error saving worksheet to staging:', error);
      setUnsavedChanges(true);
      throw error;
    }
  };

  // Complete worksheet and commit to property_records
  const completeWorksheet = async () => {
    if (!window.confirm('This will finalize the worksheet and update all property records. Continue?')) {
      return;
    }

    try {
      setIsProcessing(true);
      console.log('🚀 Finalizing worksheet and updating property_records...');

      // Prepare all property updates (using ACTUAL schema fields)
      const updates = worksheetProperties
        .filter(p => p.asset_newvcs || p.location_analysis || p.asset_zoning)
        .map(p => ({
          id: p.id,
          property_composite_key: p.property_composite_key,
          new_vcs: p.asset_newvcs || p.new_vcs,
          location_analysis: p.location_analysis,
          asset_zoning: p.asset_zoning,
          asset_map_page: p.asset_map_page,
          asset_key_page: p.asset_key_page,
          // worksheet_notes stays in staging only - not saved to property_records
          updated_at: new Date().toISOString()
        }));

      // Batch update property_records
      const batchSize = 100;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        
        try {
          const { error } = await supabase
            .from('property_records')
            .upsert(batch, { 
              onConflict: 'id',
              ignoreDuplicates: false 
            });
          
          if (error) {
            console.error(`Batch ${Math.floor(i/batchSize) + 1} error:`, error);
            errorCount += batch.length;
          } else {
            successCount += batch.length;
            console.log(`✅ Updated batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(updates.length/batchSize)}`);
          }
        } catch (batchError) {
          console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, batchError);
          errorCount += batch.length;
        }
      }

      // Mark worksheet as complete in staging
      const { error: completeError } = await supabase
        .from('market_land_valuation')
        .update({ 
          is_worksheet_complete: true,
          completed_at: new Date().toISOString()
        })
        .eq('job_id', jobData.id);

      if (completeError) {
        console.error('Error marking worksheet complete:', completeError);
      }

      alert(`✅ Worksheet Complete!\n\n` +
            `Successfully updated ${successCount} properties in the database.\n` +
            `${errorCount > 0 ? `⚠️ ${errorCount} properties failed to update.\n` : ''}` +
            `\nThe worksheet has been finalized and all changes are now permanent.`);

      setUnsavedChanges(false);
      
    } catch (error) {
      console.error('Error completing worksheet:', error);
      alert('Error completing worksheet. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Auto-save handler - saves to staging only
  const handleAutoSave = useCallback(() => {
    if (unsavedChanges && !isProcessing) {
      saveAllWorksheetData().catch(error => {
        console.error('Auto-save failed:', error);
      });
    }
  }, [unsavedChanges, isProcessing]);

  // Set up auto-save interval
  useEffect(() => {
    const interval = setInterval(() => {
      handleAutoSave();
    }, 30000); // Auto-save to staging every 30 seconds

    return () => clearInterval(interval);
  }, [handleAutoSave]);

  // Save handler for manual save button - saves to staging only
  const handleManualSave = async () => {
    try {
      await saveAllWorksheetData();
      alert('Worksheet saved to staging successfully! (Not yet in property records)');
    } catch (error) {
      alert('Error saving worksheet. Please try again.');
    }
  };

  // ==================== NORMALIZATION SAVE FUNCTIONS ====================
  const saveNormalizedValues = async (normalizedSales) => {
    try {
      // SIZE normalization - save immediately to property_records
      const sizeUpdates = normalizedSales
        .filter(sale => sale.size_normalized_price && sale.size_normalized_price !== sale.sale_price)
        .map(sale => ({
          id: sale.id,
          values_norm_size: sale.size_normalized_price
        }));

      if (sizeUpdates.length > 0) {
        console.log(`💾 Saving size normalization for ${sizeUpdates.length} properties...`);
        
        // Update in batches of 100
        for (let i = 0; i < sizeUpdates.length; i += 100) {
          const batch = sizeUpdates.slice(i, i + 100);
          
          const { error } = await supabase
            .from('property_records')
            .upsert(batch, { onConflict: 'id' });
          
          if (error) throw error;
        }
        
        console.log('✅ Size normalization saved to property_records immediately');
      }

      // TIME normalization - hold in state until Keep/Reject decision
      console.log(`⏸️ Time normalization calculated for ${normalizedSales.length} properties (awaiting review)`);
      
    } catch (error) {
      console.error('Error saving normalized values:', error);
    }
  };

  // Save time normalization after Keep decision
  const saveTimeNormalization = async (propertyId, timeNormalizedPrice) => {
    try {
      const { error } = await supabase
        .from('property_records')
        .update({ values_norm_time: timeNormalizedPrice })
        .eq('id', propertyId);
      
      if (error) throw error;
      
      console.log(`✅ Time normalization saved for property ${propertyId}`);
    } catch (error) {
      console.error('Error saving time normalization:', error);
    }
  };

  // ==================== SALES DECISION HANDLERS ====================
  const handleSalesDecision = async (saleId, decision) => {
    try {
      // Update local state
      const sale = timeNormalizedSales.find(s => s.id === saleId);
      if (!sale) return;
      
      setTimeNormalizedSales(prev => prev.map(s => 
        s.id === saleId 
          ? { ...s, keep_reject: decision }
          : s
      ));

      // If KEEP, save time normalization to property_records
      if (decision === 'keep' && sale.time_normalized_price) {
        await saveTimeNormalization(saleId, sale.time_normalized_price);
      }

      // Save decision to sales_decisions table
      const { error } = await supabase
        .from('sales_decisions')
        .upsert({
          job_id: jobData.id,
          property_id: saleId,
          decision: decision,
          time_normalized_price: decision === 'keep' ? sale.time_normalized_price : null,
          decided_by: 'current_user', // TODO: Get from auth context
          decided_at: new Date().toISOString()
        }, { onConflict: 'property_id' });

      if (error) throw error;
      
      console.log(`✅ Sales decision saved: ${decision}`);
    } catch (error) {
      console.error('Error saving sales decision:', error);
    }
  };

  const handleBulkSalesDecision = async (decision) => {
    try {
      // Get all flagged sales
      const flaggedSales = timeNormalizedSales.filter(s => s.is_outlier);
      
      // Update local state
      setTimeNormalizedSales(prev => prev.map(sale => 
        sale.is_outlier 
          ? { ...sale, keep_reject: decision }
          : sale
      ));

      // Save all decisions to database
      const decisions = flaggedSales.map(sale => ({
        job_id: jobData.id,
        property_id: sale.id,
        decision: decision,
        decided_by: 'current_user',
        decided_at: new Date().toISOString()
      }));

      // Insert in batches
      for (let i = 0; i < decisions.length; i += 50) {
        const batch = decisions.slice(i, i + 50);
        const { error } = await supabase
          .from('sales_decisions')
          .upsert(batch, { onConflict: 'property_id' });
        
        if (error) throw error;
      }
      
      console.log(`✅ Bulk sales decision saved for ${flaggedSales.length} properties`);
      alert(`${decision} decision applied to ${flaggedSales.length} flagged sales`);
    } catch (error) {
      console.error('Error saving bulk sales decisions:', error);
      alert('Error saving decisions. Please try again.');
    }
  };

  // ==================== IMPORT PREVIEW & ANALYSIS ====================
  const analyzeExcelForImport = async (file) => {
    try {
      setIsAnalyzingImport(true);
      setImportFile(file);
      
      // Read the Excel file
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, {
        cellDates: true,
        cellNF: true,
        cellStyles: true
      });
      
      // Get the worksheet
      const sheetNames = ['Page by Page', 'Worksheet', 'Sheet1', ...workbook.SheetNames];
      let worksheet = null;
      let sheetName = '';
      
      for (const name of sheetNames) {
        if (workbook.Sheets[name]) {
          worksheet = workbook.Sheets[name];
          sheetName = name;
          break;
        }
      }
      
      if (!worksheet) {
        throw new Error('No valid worksheet found in Excel file');
      }
      
      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
        defval: '',
        raw: false,
        dateNF: 'MM/DD/YYYY'
      });
      
      // Analyze the data
      const analysis = {
        fileName: file.name,
        sheetName: sheetName,
        totalRows: jsonData.length,
        matched: [],
        unmatched: [],
        fuzzyMatched: [],
        updates: {},
        columns: Object.keys(jsonData[0] || {})
      };
      
      // Smart field mapping function
      const getFieldValue = (row, possibleNames) => {
        for (const name of possibleNames) {
          if (row[name] !== undefined && row[name] !== '') {
            return row[name];
          }
          const key = Object.keys(row).find(k => 
            k.toLowerCase().trim() === name.toLowerCase()
          );
          if (key && row[key] !== undefined && row[key] !== '') {
            return row[key];
          }
        }
        return null;
      };
      
      // Calculate string similarity (Levenshtein distance)
      const calculateSimilarity = (str1, str2) => {
        if (!str1 || !str2) return 0;
        const s1 = str1.toLowerCase().trim();
        const s2 = str2.toLowerCase().trim();
        
        if (s1 === s2) return 1;
        
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = (longer, shorter) => {
          const longerArr = longer.split('');
          const shorterArr = shorter.split('');
          const matrix = [];
          
          for (let i = 0; i <= shorter.length; i++) {
            matrix[i] = [i];
          }
          
          for (let j = 0; j <= longer.length; j++) {
            matrix[0][j] = j;
          }
          
          for (let i = 1; i <= shorter.length; i++) {
            for (let j = 1; j <= longer.length; j++) {
              if (shorterArr[i - 1] === longerArr[j - 1]) {
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
          
          return matrix[shorter.length][longer.length];
        };
        
        return (longer.length - editDistance(longer, shorter)) / longer.length;
      };
      
      // Process each row
      for (const row of jsonData) {
        const block = getFieldValue(row, ['Block', 'Blk', 'BLOCK', 'block']);
        const lot = getFieldValue(row, ['Lot', 'LOT', 'lot']);
        const address = getFieldValue(row, ['Location', 'Address', 'Property Address', 'location', 'address']);
        
        if (!block || !lot) continue;
        
        const blockStr = String(block).trim();
        const lotStr = String(lot).trim();
        const qual = getFieldValue(row, ['Qual', 'Qualifier', 'QUAL', 'qual', 'qualifier']);
        const qualStr = qual ? String(qual).trim() : '';
        
        // Try exact match first
        let matchingProperty = worksheetProperties.find(p => {
          const propLot = String(p.lot || '').trim();
          const propBlock = String(p.block || '').trim();
          const propQual = String(p.qualifier || '').trim();
          
          return propBlock === blockStr && 
                 propLot === lotStr && 
                 (propQual === qualStr || (!propQual && !qualStr));
        });
        
        // If no exact match and fuzzy matching is enabled, try address matching
        let isFuzzyMatch = false;
        if (!matchingProperty && importOptions.useAddressFuzzyMatch && address) {
          const candidates = worksheetProperties.filter(p => 
            p.block === blockStr // At least block should match
          );
          
          let bestMatch = null;
          let bestScore = 0;
          
          for (const candidate of candidates) {
            if (candidate.property_address) {
              const similarity = calculateSimilarity(address, candidate.property_address);
              if (similarity > bestScore && similarity >= importOptions.fuzzyMatchThreshold) {
                bestScore = similarity;
                bestMatch = candidate;
              }
            }
          }
          
          if (bestMatch) {
            matchingProperty = bestMatch;
            isFuzzyMatch = true;
          }
        }
        
        // Collect data about what will be updated
        const importData = {
          block: blockStr,
          lot: lotStr,
          qualifier: qualStr,
          address: address,
          newVcs: getFieldValue(row, ['New VCS', 'NewVCS', 'New_VCS', 'NEWVCS', 'new vcs']),
          zone: getFieldValue(row, ['Zone', 'Zoning', 'ZONE', 'zone', 'zoning']),
          mapPage: getFieldValue(row, ['Map Page', 'MapPage', 'Map_Page', 'MAP PAGE', 'map page']),
          locationAnalysis: getFieldValue(row, ['Location Analysis', 'LocationAnalysis', 'Location_Analysis', 'LOCATION ANALYSIS']),
          row: row
        };
        
        if (matchingProperty) {
          // Check what will be updated
          const updates = [];
          if (importData.newVcs && importData.newVcs !== matchingProperty.asset_newvcs) {
            updates.push({ field: 'New VCS', old: matchingProperty.asset_newvcs, new: importData.newVcs });
          }
          if (importData.zone && importData.zone !== matchingProperty.asset_zoning) {
            updates.push({ field: 'Zoning', old: matchingProperty.asset_zoning, new: importData.zone });
          }
          if (importData.mapPage && importData.mapPage !== matchingProperty.asset_map_page) {
            updates.push({ field: 'Map Page', old: matchingProperty.asset_map_page, new: importData.mapPage });
          }
          if (importData.locationAnalysis && importData.locationAnalysis !== matchingProperty.location_analysis) {
            updates.push({ field: 'Location Analysis', old: matchingProperty.location_analysis, new: importData.locationAnalysis });
          }
          
          const matchInfo = {
            ...importData,
            property: matchingProperty,
            updates: updates,
            hasUpdates: updates.length > 0
          };
          
          if (isFuzzyMatch) {
            analysis.fuzzyMatched.push({
              ...matchInfo,
              similarity: calculateSimilarity(address, matchingProperty.property_address),
              matchedAddress: matchingProperty.property_address
            });
          } else {
            analysis.matched.push(matchInfo);
          }
        } else {
          analysis.unmatched.push(importData);
        }
      }
      
      // Calculate summary stats
      analysis.summary = {
        totalExcelRows: jsonData.length,
        exactMatches: analysis.matched.length,
        fuzzyMatches: analysis.fuzzyMatched.length,
        unmatched: analysis.unmatched.length,
        withUpdates: analysis.matched.filter(m => m.hasUpdates).length + 
                     analysis.fuzzyMatched.filter(m => m.hasUpdates).length,
        totalProperties: worksheetProperties.length
      };
      
      // Analyze unique values for standardization opportunities
      const uniqueValues = {
        vcs: new Map(),
        locations: new Map(),
        zones: new Map()
      };
      
      // Collect all unique values from matched properties
      [...analysis.matched, ...analysis.fuzzyMatched].forEach(match => {
        // VCS values
        if (match.newVcs) {
          const vcsUpper = String(match.newVcs).trim().toUpperCase();
          if (!uniqueValues.vcs.has(vcsUpper)) {
            uniqueValues.vcs.set(vcsUpper, []);
          }
          uniqueValues.vcs.get(vcsUpper).push(match.newVcs);
        }
        
        // Location Analysis values
        if (match.locationAnalysis) {
          const locTrimmed = String(match.locationAnalysis).trim();
          const locLower = locTrimmed.toLowerCase();
          
          // Check for similar locations
          let foundSimilar = false;
          for (const [standard, variations] of uniqueValues.locations) {
            const standardLower = standard.toLowerCase();
            
            // Check for common variations (ave/avenue, st/street, etc.)
            const patterns = [
              { pattern: /\bave\b/gi, replacement: 'avenue' },
              { pattern: /\bst\b/gi, replacement: 'street' },
              { pattern: /\brd\b/gi, replacement: 'road' },
              { pattern: /\bdr\b/gi, replacement: 'drive' },
              { pattern: /\bln\b/gi, replacement: 'lane' },
              { pattern: /\bct\b/gi, replacement: 'court' },
              { pattern: /\bhwy\b/gi, replacement: 'highway' },
              { pattern: /\brr\b/gi, replacement: 'railroad' }
            ];
            
            let standardNormalized = standardLower;
            let valueNormalized = locLower;
            
            patterns.forEach(({ pattern, replacement }) => {
              standardNormalized = standardNormalized.replace(pattern, replacement);
              valueNormalized = valueNormalized.replace(pattern, replacement);
            });
            
            if (standardNormalized === valueNormalized || 
                calculateSimilarity(standard, locTrimmed) > 0.85) {
              variations.push(locTrimmed);
              foundSimilar = true;
              break;
            }
          }
          
          if (!foundSimilar) {
            uniqueValues.locations.set(locTrimmed, [locTrimmed]);
          }
        }
        
        // Zone values
        if (match.zone) {
          const zoneUpper = String(match.zone).trim().toUpperCase();
          if (!uniqueValues.zones.has(zoneUpper)) {
            uniqueValues.zones.set(zoneUpper, []);
          }
          uniqueValues.zones.get(zoneUpper).push(match.zone);
        }
      });
      
      // Build standardization suggestions
      const standardizationSuggestions = {
        vcs: [],
        locations: [],
        zones: []
      };
      
      // Find VCS variations
      uniqueValues.vcs.forEach((variations, standard) => {
        if (variations.length > 0) {
          standardizationSuggestions.vcs.push({
            standard: standard,
            variations: [...new Set(variations)],
            count: variations.length
          });
        }
      });
      
      // Find location variations
      uniqueValues.locations.forEach((variations, standard) => {
        if (variations.length > 1) {
          standardizationSuggestions.locations.push({
            standard: standard,
            variations: [...new Set(variations)],
            count: variations.length
          });
        }
      });
      
      // Find zone variations
      uniqueValues.zones.forEach((variations, standard) => {
        if (variations.length > 0) {
          standardizationSuggestions.zones.push({
            standard: standard,
            variations: [...new Set(variations)],
            count: variations.length
          });
        }
      });
      
      analysis.standardizationSuggestions = standardizationSuggestions;
      
      // Initialize standardizations with suggestions
      const initialStandardizations = {
        vcs: {},
        locations: {},
        zones: {}
      };
      
      standardizationSuggestions.locations.forEach(suggestion => {
        suggestion.variations.forEach(variation => {
          initialStandardizations.locations[variation] = suggestion.standard;
        });
      });
      
      setStandardizations(initialStandardizations);
      setImportPreview(analysis);
      setShowImportModal(true);
      
    } catch (error) {
      console.error('Error analyzing Excel file:', error);
      alert(`Error analyzing Excel file:\n${error.message}`);
    } finally {
      setIsAnalyzingImport(false);
    }
  };

  // Process the actual import after user confirms
  const processImport = async () => {
    if (!importPreview) return;
    
    try {
      setIsProcessing(true);
      const updates = [];
      
      // Helper to apply standardization
      const applyStandardization = (value, type) => {
        if (!value) return value;
        
        if (type === 'vcs' && standardizations.vcs[value]) {
          return standardizations.vcs[value];
        }
        if (type === 'location' && standardizations.locations[value]) {
          return standardizations.locations[value];
        }
        if (type === 'zone' && standardizations.zones[value]) {
          return standardizations.zones[value];
        }
        
        return value;
      };
      
      // Track which properties were updated for ready checkbox
      const updatedPropertyKeys = new Set();
      
      // Process exact matches
      for (const match of importPreview.matched) {
        if (match.hasUpdates && importOptions.updateExisting) {
          const propertyUpdate = {
            id: match.property.id,
            property_composite_key: match.property.property_composite_key
          };
          
          if (match.newVcs) {
            const standardizedVcs = applyStandardization(match.newVcs, 'vcs');
            // Use the documented field name pattern
            propertyUpdate.newVCS = String(standardizedVcs).trim().toUpperCase();
            propertyUpdate.new_vcs = String(standardizedVcs).trim().toUpperCase(); // Keep both for compatibility
          }
          if (match.zone) {
            const standardizedZone = applyStandardization(match.zone, 'zone');
            propertyUpdate.asset_zoning = String(standardizedZone).trim().toUpperCase();
          }
          if (match.mapPage) {
            propertyUpdate.asset_map_page = String(match.mapPage).trim();
          }
          if (match.locationAnalysis) {
            const standardizedLocation = applyStandardization(match.locationAnalysis, 'location');
            propertyUpdate.location_analysis = String(standardizedLocation).trim();
          }
          
          updates.push(propertyUpdate);
          updatedPropertyKeys.add(match.property.property_composite_key);
          
          // Update local state with standardized values
          const prop = worksheetProperties.find(p => p.id === match.property.id);
          if (prop) {
            if (match.newVcs) {
              const standardizedVcs = applyStandardization(match.newVcs, 'vcs');
              prop.asset_newvcs = String(standardizedVcs).trim().toUpperCase();
            }
            if (match.zone) {
              const standardizedZone = applyStandardization(match.zone, 'zone');
              prop.asset_zoning = String(standardizedZone).trim().toUpperCase();
            }
            if (match.mapPage) {
              prop.asset_map_page = String(match.mapPage).trim();
            }
            if (match.locationAnalysis) {
              const standardizedLocation = applyStandardization(match.locationAnalysis, 'location');
              prop.location_analysis = String(standardizedLocation).trim();
            }
          }
        }
      }
      
      // Process fuzzy matches if user approves
      for (const match of importPreview.fuzzyMatched) {
        if (match.hasUpdates && importOptions.updateExisting) {
          const propertyUpdate = {
            id: match.property.id,
            property_composite_key: match.property.property_composite_key
          };
          
          if (match.newVcs) {
            const standardizedVcs = applyStandardization(match.newVcs, 'vcs');
            propertyUpdate.new_vcs = String(standardizedVcs).trim().toUpperCase();
            propertyUpdate.asset_newvcs = String(standardizedVcs).trim().toUpperCase();
          }
          if (match.zone) {
            const standardizedZone = applyStandardization(match.zone, 'zone');
            propertyUpdate.asset_zoning = String(standardizedZone).trim().toUpperCase();
          }
          if (match.mapPage) {
            propertyUpdate.asset_map_page = String(match.mapPage).trim();
          }
          if (match.locationAnalysis) {
            const standardizedLocation = applyStandardization(match.locationAnalysis, 'location');
            propertyUpdate.location_analysis = String(standardizedLocation).trim();
          }
          
          updates.push(propertyUpdate);
          updatedPropertyKeys.add(match.property.property_composite_key);
          
          // Update local state with standardized values
          const prop = worksheetProperties.find(p => p.id === match.property.id);
          if (prop) {
            if (match.newVcs) {
              const standardizedVcs = applyStandardization(match.newVcs, 'vcs');
              prop.asset_newvcs = String(standardizedVcs).trim().toUpperCase();
            }
            if (match.zone) {
              const standardizedZone = applyStandardization(match.zone, 'zone');
              prop.asset_zoning = String(standardizedZone).trim().toUpperCase();
            }
            if (match.mapPage) {
              prop.asset_map_page = String(match.mapPage).trim();
            }
            if (match.locationAnalysis) {
              const standardizedLocation = applyStandardization(match.locationAnalysis, 'location');
              prop.location_analysis = String(standardizedLocation).trim();
            }
          }
        }
      }
      
      // Mark imported properties as ready (optional - could be configurable)
      if (importOptions.markImportedAsReady !== false) {
        setReadyProperties(prev => new Set([...prev, ...updatedPropertyKeys]));
      }
      
      // Save to database
      if (updates.length > 0) {
        console.log(`💾 Saving ${updates.length} property updates to database...`);
        
        for (let i = 0; i < updates.length; i += 100) {
          const batch = updates.slice(i, i + 100);
          
          const { error } = await supabase
            .from('property_records')
            .upsert(batch, { 
              onConflict: 'id',
              ignoreDuplicates: false 
            });
          
          if (error) {
            console.error(`Batch ${Math.floor(i/100) + 1} error:`, error);
          }
        }
      }
      
      // Update UI with optimized rendering for large datasets
      if (updates.length > 100) {
        // For large imports, batch the UI updates to prevent freezing
        console.log(`📊 Large import detected (${updates.length} records), optimizing UI updates...`);
        
        // Use requestAnimationFrame for smooth updates
        const batchSize = 50;
        let currentBatch = 0;
        
        const processBatch = () => {
          const start = currentBatch * batchSize;
          const end = Math.min(start + batchSize, worksheetProperties.length);
          
          // Force a re-render for this batch
          if (currentBatch === 0) {
            setWorksheetProperties([...worksheetProperties]);
          }
          
          currentBatch++;
          
          if (start < worksheetProperties.length) {
            requestAnimationFrame(processBatch);
          } else {
            // Final updates after all batches
            searchAndFilterWorksheet();
            updateWorksheetStats(worksheetProperties);
            console.log('✅ UI updates complete');
          }
        };
        
        requestAnimationFrame(processBatch);
      } else {
        // For smaller imports, update immediately
        setWorksheetProperties([...worksheetProperties]);
        searchAndFilterWorksheet();
        updateWorksheetStats(worksheetProperties);
      }
      
      // Show success message with details
      const successMessage = `✅ Import Complete!\n\n` +
        `📊 ${updates.length} properties updated\n` +
        `${importOptions.markImportedAsReady ? '☑️ All imported properties marked as Ready\n' : ''}` +
        `💾 All changes saved to database\n\n` +
        `The Page by Page worksheet has been updated with your imported data.`;
      
      alert(successMessage);
      
      // Close modal and reset
      setShowImportModal(false);
      setImportPreview(null);
      setImportFile(null);
      
    } catch (error) {
      console.error('Error processing import:', error);
      alert(`Error processing import:\n${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle file selection for import
  const handleImportFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    await analyzeExcelForImport(file);
    
    // Clear the input
    event.target.value = '';
  };

  // ==================== IMPORT PREVIEW & ANALYSIS ====================
  const exportNormalizationToExcel = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    let csv = 'Property Key,Address,Type,Sale Date,Sale Price,Time Normalized,Size Normalized,HPI Multiplier,Sales Ratio,Status,Decision\n';
    
    timeNormalizedSales.forEach(sale => {
      csv += `"${sale.property_composite_key}","${sale.property_address}","${sale.property_class}",`;
      csv += `"${new Date(sale.sale_date).toLocaleDateString()}",`;
      csv += `${sale.sale_price},${sale.time_normalized_price || ''},${sale.size_normalized_price || ''},`;
      csv += `${sale.hpi_multiplier?.toFixed(4) || ''},${sale.sales_ratio?.toFixed(4) || ''},`;
      csv += `"${sale.is_outlier ? 'Outlier' : 'Valid'}","${sale.keep_reject || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Normalization_${jobInfo}_${timestamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportWorksheetToExcel = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    let csv = 'Block,Lot,Qualifier,Card,Location,Address,Class,Current VCS,Building,Type/Use,Design,New VCS,Location Analysis,Zoning,Map Page,Key Page,Notes,Ready\n';
    
    filteredWorksheetProps.forEach(prop => {
      csv += `"${prop.block || ''}","${prop.lot || ''}","${prop.qualifier || ''}","${prop.card || '1'}",`;
      csv += `"${prop.location || ''}","${prop.property_address || ''}","${prop.property_class || ''}",`;
      csv += `"${prop.asset_vcs || ''}","${prop.building_class_display || ''}","${prop.type_use_display || ''}",`;
      csv += `"${prop.design_display || ''}","${prop.asset_newvcs || prop.new_vcs || ''}","${prop.location_analysis || ''}",`;
      csv += `"${prop.asset_zoning || ''}","${prop.asset_map_page || ''}","${prop.asset_key_page || ''}",`;
      csv += `"${prop.worksheet_notes || ''}","${readyProperties.has(prop.property_composite_key) ? 'Yes' : 'No'}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PropertyWorksheet_${jobInfo}_${timestamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importWorksheetFromExcel = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          alert('File appears to be empty or invalid.');
          return;
        }
        
        // Parse CSV properly handling quoted values
        const parseCSVLine = (line) => {
          const result = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              result.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          result.push(current.trim());
          return result;
        };
        
        const headers = parseCSVLine(lines[0]).map(h => h.replace(/"/g, ''));
        
        // Find column indices (case-insensitive)
        const findColumn = (possibleNames) => {
          for (const name of possibleNames) {
            const index = headers.findIndex(h => 
              h.toLowerCase().includes(name.toLowerCase())
            );
            if (index >= 0) return index;
          }
          return -1;
        };
        
        const colIndices = {
          block: findColumn(['block', 'blk']),
          lot: findColumn(['lot']),
          qualifier: findColumn(['qualifier', 'qual']),
          newVcs: findColumn(['new vcs', 'newvcs', 'vcs']),
          location: findColumn(['location analysis', 'location']),
          zoning: findColumn(['zoning', 'zone']),
          mapPage: findColumn(['map page', 'map']),
          keyPage: findColumn(['key page', 'key']),
          notes: findColumn(['notes', 'comments']),
          ready: findColumn(['ready', 'complete'])
        };
        
        // Validate required columns
        if (colIndices.block === -1 || colIndices.lot === -1) {
          alert('File must contain Block and Lot columns');
          return;
        }
        
        let updatedCount = 0;
        let notFoundCount = 0;
        const notFoundProperties = [];
        
        // Process each data row
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          
          const block = cols[colIndices.block]?.replace(/"/g, '');
          const lot = cols[colIndices.lot]?.replace(/"/g, '');
          const qualifier = colIndices.qualifier >= 0 ? cols[colIndices.qualifier]?.replace(/"/g, '') : '';
          
          if (!block || !lot) continue;
          
          // Find matching property - try with and without qualifier
          let prop = worksheetProperties.find(p => 
            p.block === block && 
            p.lot === lot && 
            (p.qualifier === qualifier || (!p.qualifier && !qualifier))
          );
          
          // If not found with exact match, try fuzzy match
          if (!prop) {
            prop = worksheetProperties.find(p => 
              p.block === block && p.lot === lot
            );
          }
          
          if (prop) {
            let hasChanges = false;
            
            // Update fields if they have values
            if (colIndices.newVcs >= 0 && cols[colIndices.newVcs]) {
              const newValue = cols[colIndices.newVcs].replace(/"/g, '').toUpperCase();
              if (prop.asset_newvcs !== newValue) {
                prop.asset_newvcs = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.location >= 0 && cols[colIndices.location]) {
              const newValue = cols[colIndices.location].replace(/"/g, '');
              if (prop.location_analysis !== newValue) {
                prop.location_analysis = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.zoning >= 0 && cols[colIndices.zoning]) {
              const newValue = cols[colIndices.zoning].replace(/"/g, '').toUpperCase();
              if (prop.asset_zoning !== newValue) {
                prop.asset_zoning = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.mapPage >= 0 && cols[colIndices.mapPage]) {
              const newValue = cols[colIndices.mapPage].replace(/"/g, '');
              if (prop.asset_map_page !== newValue) {
                prop.asset_map_page = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.keyPage >= 0 && cols[colIndices.keyPage]) {
              const newValue = cols[colIndices.keyPage].replace(/"/g, '');
              if (prop.asset_key_page !== newValue) {
                prop.asset_key_page = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.notes >= 0 && cols[colIndices.notes]) {
              const newValue = cols[colIndices.notes].replace(/"/g, '');
              if (prop.worksheet_notes !== newValue) {
                prop.worksheet_notes = newValue;
                hasChanges = true;
              }
            }
            
            if (colIndices.ready >= 0 && cols[colIndices.ready]) {
              const isReady = cols[colIndices.ready].toLowerCase() === 'yes' || 
                              cols[colIndices.ready].toLowerCase() === 'true' ||
                              cols[colIndices.ready] === '1';
              
              if (isReady && !readyProperties.has(prop.property_composite_key)) {
                setReadyProperties(prev => new Set([...prev, prop.property_composite_key]));
                hasChanges = true;
              } else if (!isReady && readyProperties.has(prop.property_composite_key)) {
                setReadyProperties(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(prop.property_composite_key);
                  return newSet;
                });
                hasChanges = true;
              }
            }
            
            if (hasChanges) updatedCount++;
          } else {
            notFoundCount++;
            notFoundProperties.push(`${block}-${lot}${qualifier ? '_' + qualifier : ''}`);
          }
        }
        
        // Update state and trigger re-render
        setWorksheetProperties([...worksheetProperties]);
        searchAndFilterWorksheet();
        updateWorksheetStats(worksheetProperties);
        setUnsavedChanges(true);
        
        // Build result message
        let message = `Import complete!\n`;
        message += `✅ Updated: ${updatedCount} properties\n`;
        if (notFoundCount > 0) {
          message += `⚠️ Not found: ${notFoundCount} properties\n`;
          if (notFoundCount <= 10) {
            message += `Missing: ${notFoundProperties.join(', ')}`;
          }
        }
        
        alert(message);
        
      } catch (error) {
        console.error('Error importing file:', error);
        alert(`Error importing file: ${error.message}\n\nPlease check the format and try again.`);
      }
    };
    
    reader.onerror = () => {
      alert('Error reading file. Please try again.');
    };
    
    reader.readAsText(file);
    
    // Clear the input so the same file can be selected again
    event.target.value = '';
  };

  // ==================== PAGINATION ====================
  const paginatedProperties = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredWorksheetProps.slice(startIndex, endIndex);
  }, [filteredWorksheetProps, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredWorksheetProps.length / itemsPerPage);

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex gap-1 p-1">
          <button
            onClick={() => setActiveSubTab('normalization')}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${
              activeSubTab === 'normalization'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <TrendingUp size={16} className="inline mr-2" />
            Normalization
          </button>
          <button
            onClick={() => setActiveSubTab('worksheet')}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-all ${
              activeSubTab === 'worksheet'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Grid size={16} className="inline mr-2" />
            Page by Page Worksheet
          </button>
        </div>
      </div>

      {/* Normalization Content */}
      {activeSubTab === 'normalization' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold mb-4">Normalization Settings</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Year
                </label>
                <input
                  type="number"
                  value={targetYear}
                  onChange={(e) => setTargetYear(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="2000"
                  max="2030"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Filter Sales
                </label>
                <select
                  value={salesFilter}
                  onChange={(e) => setSalesFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="all">All Sales</option>
                  <option value="flagged">Flagged Only</option>
                  <option value="pending">Pending Review</option>
                  <option value="single-family">Single Family (10)</option>
                  <option value="multifamily">Multifamily (42/43/44)</option>
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={performNormalization}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw size={16} className="inline animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <TrendingUp size={16} className="inline mr-2" />
                      Run Normalization
                    </>
                  )}
                </button>
                <button
                  onClick={exportNormalizationToExcel}
                  className="px-4 py-2 border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50"
                >
                  <Download size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">
                {normalizationStats.totalSales}
              </div>
              <div className="text-sm text-gray-600">Total Sales</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-blue-600">
                {normalizationStats.timeNormalized}
              </div>
              <div className="text-sm text-gray-600">Time Normalized</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">
                {normalizationStats.sizeNormalized}
              </div>
              <div className="text-sm text-gray-600">Size Normalized</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-orange-600">
                {normalizationStats.flaggedOutliers}
              </div>
              <div className="text-sm text-gray-600">Flagged Outliers</div>
            </div>
          </div>

          {/* Sales Table */}
          {timeNormalizedSales.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold">Sales Review</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleBulkSalesDecision('keep')}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    Keep All Flagged
                  </button>
                  <button
                    onClick={() => handleBulkSalesDecision('reject')}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                  >
                    Reject All Flagged
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Address</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Sale Date</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Sale Price</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Time Norm</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">Size Norm</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Ratio</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Status</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeNormalizedSales
                      .filter(sale => {
                        if (salesFilter === 'all') return true;
                        if (salesFilter === 'flagged') return sale.is_outlier;
                        if (salesFilter === 'pending') return sale.keep_reject === 'pending';
                        if (salesFilter === 'single-family') return sale.asset_type_use === '10';
                        if (salesFilter === 'multifamily') return ['42', '43', '44'].includes(sale.asset_type_use);
                        return true;
                      })
                      .slice(0, 50)
                      .map((sale, idx) => (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm">{sale.property_address}</td>
                          <td className="px-4 py-3 text-sm">
                            {new Date(sale.sale_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            ${sale.sale_price?.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            ${sale.time_normalized_price?.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right">
                            ${sale.size_normalized_price?.toLocaleString()}
                          </td>
                      <td className="px-4 py-3 text-sm text-center">
                            {sale.sales_ratio?.toFixed(3)}
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            {sale.is_outlier ? (
                              <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
                                Flagged
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                                Valid
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex gap-1">
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
            </div>
          )}
        </div>
      )}

      {/* Page by Page Worksheet Content */}
      {activeSubTab === 'worksheet' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Property Worksheet</h3>
              <div className="flex gap-2">
                <input
                  type="file"
                  id="worksheet-import"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFileSelect}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => document.getElementById('worksheet-import').click()}
                  className="px-4 py-2 border border-gray-400 rounded-md hover:bg-gray-100 flex items-center gap-2"
                  disabled={isProcessing || isAnalyzingImport}
                >
                  {isAnalyzingImport ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet size={16} />
                      Import Excel
                    </>
                  )}
                </button>
                <button
                  onClick={exportWorksheetToExcel}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <Download size={16} className="inline mr-2" />
                  Export
                </button>
                {unsavedChanges && (
                  <button
                    onClick={handleManualSave}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    <Save size={16} className="inline mr-2" />
                    Save to Staging
                  </button>
                )}
                <button
                  onClick={completeWorksheet}
                  disabled={isProcessing || worksheetStats.vcsCompleted === 0}
                  className={`px-4 py-2 rounded-md font-medium ${
                    isProcessing || worksheetStats.vcsCompleted === 0
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw size={16} className="inline animate-spin mr-2" />
                      Finalizing...
                    </>
                  ) : (
                    <>
                      <Check size={16} className="inline mr-2" />
                      Complete Worksheet
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <input
                  type="text"
                  placeholder="Search by address, block, or lot..."
                  value={worksheetSearchTerm}
                  onChange={(e) => setWorksheetSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <select
                  value={worksheetFilter}
                  onChange={(e) => setWorksheetFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="all">All Properties</option>
                  <option value="missing-vcs">Missing VCS</option>
                  <option value="missing-location">Missing Location</option>
                  <option value="missing-zoning">Missing Zoning</option>
                  <option value="ready">Ready</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div className="flex items-center justify-end text-sm text-gray-600">
                {filteredWorksheetProps.length} of {worksheetProperties.length} properties
              </div>
            </div>

            {/* Batch Operations */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Batch Operations (Current Page):</span>
                <div className="flex gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      id="batch-vcs"
                      placeholder="VCS Code"
                      className="px-2 py-1 border border-gray-300 rounded text-sm w-24"
                    />
                    <button
                      onClick={() => {
                        const value = document.getElementById('batch-vcs').value;
                        if (value) applyBatchVCS(value);
                      }}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      Apply VCS
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      id="batch-zoning"
                      placeholder="Zone"
                      className="px-2 py-1 border border-gray-300 rounded text-sm w-24"
                    />
                    <button
                      onClick={() => {
                        const value = document.getElementById('batch-zoning').value;
                        if (value) applyBatchZoning(value);
                      }}
                      className="px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                    >
                      Apply Zone
                    </button>
                  </div>
                  <button
                    onClick={() => markAllReady(true)}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    Mark All Ready
                  </button>
                  <button
                    onClick={() => markAllReady(false)}
                    className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                  >
                    Clear Ready
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-gray-900">
                {worksheetStats.totalProperties}
              </div>
              <div className="text-sm text-gray-600">Total Properties</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-blue-600">
                {worksheetStats.vcsCompleted}
              </div>
              <div className="text-sm text-gray-600">VCS Completed</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-green-600">
                {worksheetStats.locationCompleted}
              </div>
              <div className="text-sm text-gray-600">Location Completed</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-purple-600">
                {worksheetStats.zoningCompleted}
              </div>
              <div className="text-sm text-gray-600">Zoning Completed</div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-2xl font-bold text-orange-600">
                {worksheetStats.readyCount}
              </div>
              <div className="text-sm text-gray-600">Ready</div>
            </div>
          </div>

          {/* Worksheet Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th 
                      className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                      onClick={() => setSortConfig({
                        field: 'block',
                        direction: sortConfig.field === 'block' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      })}
                    >
                      Block {sortConfig.field === 'block' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                      onClick={() => setSortConfig({
                        field: 'lot',
                        direction: sortConfig.field === 'lot' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      })}
                    >
                      Lot {sortConfig.field === 'lot' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                      onClick={() => setSortConfig({
                        field: 'property_address',
                        direction: sortConfig.field === 'property_address' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      })}
                    >
                      Address {sortConfig.field === 'property_address' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Building</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Type/Use</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Design</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">New VCS</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Location</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Zoning</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProperties.map((prop, idx) => (
                    <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm">{prop.block}</td>
                      <td className="px-4 py-2 text-sm">{prop.lot}</td>
                      <td className="px-4 py-2 text-sm">{prop.property_address}</td>
                      <td className="px-4 py-2 text-sm">{prop.building_class_display}</td>
                      <td className="px-4 py-2 text-sm">{prop.type_use_display}</td>
                      <td className="px-4 py-2 text-sm">{prop.design_display}</td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={prop.asset_newvcs || prop.new_vcs || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_newvcs', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={prop.location_analysis || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'location_analysis', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={prop.asset_zoning || ''}
                          onChange={(e) => handleWorksheetChange(prop.property_composite_key, 'asset_zoning', e.target.value)}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
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
                          className="rounded"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center p-4 border-t border-gray-200">
                <div className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
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
          </div>
        </div>
      )}

      {/* Location Standardization Modal */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Location Standardization</h3>
            <p className="mb-4">
              You've entered a variation of an existing location. Which should be the standard?
            </p>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => handleLocationStandardChoice('existing')}
                className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
              >
                <strong>Use existing:</strong> {currentLocationChoice?.existingStandard}
              </button>
              <button
                onClick={() => handleLocationStandardChoice('new')}
                className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-left"
              >
                <strong>Use as entered:</strong> {currentLocationChoice?.newValue}
              </button>
            </div>
            <button
              onClick={() => setShowLocationModal(false)}
              className="w-full px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {showImportModal && importPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-semibold">Import Preview</h3>
                <p className="text-sm text-gray-600 mt-1">
                  File: {importPreview.fileName} | Sheet: {importPreview.sheetName}
                </p>
              </div>
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

            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="text-2xl font-bold text-green-700">
                  {importPreview.summary.exactMatches}
                </div>
                <div className="text-sm text-green-600">Exact Matches</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-2xl font-bold text-blue-700">
                  {importPreview.summary.fuzzyMatches}
                </div>
                <div className="text-sm text-blue-600">Fuzzy Matches</div>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <div className="text-2xl font-bold text-orange-700">
                  {importPreview.summary.unmatched}
                </div>
                <div className="text-sm text-orange-600">Unmatched</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-2xl font-bold text-purple-700">
                  {importPreview.summary.withUpdates}
                </div>
                <div className="text-sm text-purple-600">With Updates</div>
              </div>
            </div>

            {/* Import Options */}
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
                  <span className="text-sm">Update existing properties with matching Block-Lot</span>
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
                  <span className="text-sm">Mark imported properties as "Ready"</span>
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
                  <span className="text-sm">Use address similarity for fuzzy matching</span>
                </label>
                {importOptions.useAddressFuzzyMatch && (
                  <div className="ml-6 flex items-center gap-2">
                    <span className="text-sm text-gray-600">Minimum similarity:</span>
                    <input
                      type="number"
                      min="0.5"
                      max="1"
                      step="0.05"
                      value={importOptions.fuzzyMatchThreshold}
                      onChange={(e) => setImportOptions(prev => ({
                        ...prev,
                        fuzzyMatchThreshold: parseFloat(e.target.value)
                      }))}
                      className="w-20 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Standardization Section */}
            {importPreview.standardizationSuggestions && (
              importPreview.standardizationSuggestions.locations.length > 0 ||
              importPreview.standardizationSuggestions.vcs.length > 0 ||
              importPreview.standardizationSuggestions.zones.length > 0
            ) && (
              <div className="border-t pt-4 mb-4">
                <h4 className="font-medium mb-3">📝 Standardization Options</h4>
                
                {/* Location Standardizations */}
                {importPreview.standardizationSuggestions.locations.length > 0 && (
                  <div className="mb-3">
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Location Analysis Variations Found:</h5>
                    <div className="space-y-2 max-h-40 overflow-y-auto border rounded p-2 bg-blue-50">
                      {importPreview.standardizationSuggestions.locations.map((suggestion, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600">Standardize:</span>
                          <div className="flex items-center gap-1 flex-wrap">
                            {suggestion.variations.map((variation, vIdx) => (
                              <span key={vIdx} className="px-2 py-1 bg-white rounded border">
                                {variation}
                              </span>
                            ))}
                          </div>
                          <span className="text-gray-600">→</span>
                          <input
                            type="text"
                            value={standardizations.locations[suggestion.variations[0]] || suggestion.standard}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setStandardizations(prev => {
                                const newLocs = { ...prev.locations };
                                suggestion.variations.forEach(v => {
                                  newLocs[v] = newValue;
                                });
                                return { ...prev, locations: newLocs };
                              });
                            }}
                            className="px-2 py-1 border rounded bg-white flex-1 max-w-xs"
                          />
                          <span className="text-xs text-gray-500">({suggestion.count} uses)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* VCS Standardizations */}
                {importPreview.standardizationSuggestions.vcs.length > 1 && (
                  <div className="mb-3">
                    <h5 className="text-sm font-medium text-gray-700 mb-2">VCS Code Variations:</h5>
                    <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2 bg-green-50">
                      {importPreview.standardizationSuggestions.vcs.map((suggestion, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-1 bg-white rounded border">
                            {suggestion.standard}
                          </span>
                          <span className="text-xs text-gray-500">({suggestion.count} uses)</span>
                          <input
                            type="text"
                            placeholder="Change to..."
                            value={standardizations.vcs[suggestion.standard] || ''}
                            onChange={(e) => {
                              setStandardizations(prev => ({
                                ...prev,
                                vcs: {
                                  ...prev.vcs,
                                  [suggestion.standard]: e.target.value.toUpperCase()
                                }
                              }));
                            }}
                            className="px-2 py-1 border rounded bg-white w-24"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Zone Standardizations */}
                {importPreview.standardizationSuggestions.zones.length > 1 && (
                  <div className="mb-3">
                    <h5 className="text-sm font-medium text-gray-700 mb-2">Zone Code Variations:</h5>
                    <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2 bg-purple-50">
                      {importPreview.standardizationSuggestions.zones.map((suggestion, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-1 bg-white rounded border">
                            {suggestion.standard}
                          </span>
                          <span className="text-xs text-gray-500">({suggestion.count} uses)</span>
                          <input
                            type="text"
                            placeholder="Change to..."
                            value={standardizations.zones[suggestion.standard] || ''}
                            onChange={(e) => {
                              setStandardizations(prev => ({
                                ...prev,
                                zones: {
                                  ...prev.zones,
                                  [suggestion.standard]: e.target.value.toUpperCase()
                                }
                              }));
                            }}
                            className="px-2 py-1 border rounded bg-white w-24"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Fuzzy Matches Review */}
            {importPreview.fuzzyMatched.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium mb-2">
                  ⚠️ Fuzzy Matches - Please Review ({importPreview.fuzzyMatched.length})
                </h4>
                <div className="max-h-40 overflow-y-auto border rounded p-2 bg-yellow-50">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-1">Block-Lot</th>
                        <th className="text-left p-1">Excel Address</th>
                        <th className="text-left p-1">Matched To</th>
                        <th className="text-center p-1">Similarity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.fuzzyMatched.slice(0, 10).map((match, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-1">{match.block}-{match.lot}</td>
                          <td className="p-1">{match.address}</td>
                          <td className="p-1">{match.matchedAddress}</td>
                          <td className="p-1 text-center">
                            {(match.similarity * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importPreview.fuzzyMatched.length > 10 && (
                    <p className="text-xs text-gray-600 mt-2">
                      ... and {importPreview.fuzzyMatched.length - 10} more
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Unmatched Properties */}
            {importPreview.unmatched.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium mb-2">
                  ❌ Unmatched Properties ({importPreview.unmatched.length})
                </h4>
                <div className="max-h-32 overflow-y-auto border rounded p-2 bg-red-50">
                  <div className="text-sm space-y-1">
                    {importPreview.unmatched.slice(0, 10).map((prop, idx) => (
                      <div key={idx}>
                        Block {prop.block}, Lot {prop.lot}
                        {prop.address && ` - ${prop.address}`}
                      </div>
                    ))}
                    {importPreview.unmatched.length > 10 && (
                      <div className="text-xs text-gray-600">
                        ... and {importPreview.unmatched.length - 10} more
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between items-center mt-6">
              <div className="text-sm text-gray-600">
                {importPreview.summary.totalProperties} properties in database | 
                {' '}{importPreview.summary.totalExcelRows} rows in Excel
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportPreview(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={processImport}
                  disabled={isProcessing || importPreview.summary.withUpdates === 0}
                  className={`px-4 py-2 rounded-md ${
                    isProcessing || importPreview.summary.withUpdates === 0
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw size={16} className="inline animate-spin mr-2" />
                      Importing...
                    </>
                  ) : (
                    `Import ${importPreview.summary.withUpdates} Updates`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreValuationTab;
