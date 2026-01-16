import React, { useState, useEffect, useMemo } from 'react';
import { supabase, getRawDataForJob } from '../../../lib/supabaseClient';
import { Save, Plus, Trash2, Settings, X } from 'lucide-react';

const AdjustmentsTab = ({ jobData = {} }) => {
  const [activeSubTab, setActiveSubTab] = useState('adjustments');
  const [adjustments, setAdjustments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showAutoPopulateNotice, setShowAutoPopulateNotice] = useState(false);
  const [wasReset, setWasReset] = useState(false); // Track if config was reset due to table changes
  const [customBracket, setCustomBracket] = useState({
    name: '',
    attributeValues: {} // Will hold { lot_size_ff: { value: 0, type: 'flat' }, ... }
  });
  const [customBrackets, setCustomBrackets] = useState([]); // Load from DB
  
  // Structure: maps attribute -> array of codes
  const [codeConfig, setCodeConfig] = useState({
    garage: [],
    deck: [],
    patio: [],
    open_porch: [],
    enclosed_porch: [],
    det_garage: [],
    pool: [],
    barn: [],
    stable: [],
    pole_barn: [],
    miscellaneous: [],
    land_positive: [],
    land_negative: []
  });
  
  const [availableCodes, setAvailableCodes] = useState({
    '11': [], // Attached items
    '15': [], // Detached items
    '39': [], // Miscellaneous
    '62': [], // Positive land adjustments
    '63': []  // Negative land adjustments
  });
  const [isLoadingCodes, setIsLoadingCodes] = useState(false);

  // CME Price Brackets (matching OverallAnalysisTab)
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'up to $99,999', shortLabel: '$0-$99,999', color: '#FF9999', textColor: 'black' },
    { min: 100000, max: 199999, label: '$100,000-$199,999', shortLabel: '$100K-$199K', color: '#FFB366', textColor: 'black' },
    { min: 200000, max: 299999, label: '$200,000-$299,999', shortLabel: '$200K-$299K', color: '#FFCC99', textColor: 'black' },
    { min: 300000, max: 399999, label: '$300,000-$399,999', shortLabel: '$300K-$399K', color: '#FFFF99', textColor: 'black' },
    { min: 400000, max: 499999, label: '$400,000-$499,999', shortLabel: '$400K-$499K', color: '#CCFF99', textColor: 'black' },
    { min: 500000, max: 749999, label: '$500,000-$749,999', shortLabel: '$500K-$749K', color: '#99FF99', textColor: 'black' },
    { min: 750000, max: 999999, label: '$750,000-$999,999', shortLabel: '$750K-$999K', color: '#99CCFF', textColor: 'black' },
    { min: 1000000, max: 1499999, label: '$1,000,000-$1,499,999', shortLabel: '$1M-$1.5M', color: '#9999FF', textColor: 'black' },
    { min: 1500000, max: 1999999, label: '$1,500,000-$1,999,999', shortLabel: '$1.5M-$2M', color: '#CC99FF', textColor: 'black' },
    { min: 2000000, max: 99999999, label: 'Over $2,000,000', shortLabel: 'Over $2M', color: '#FF99FF', textColor: 'black' }
  ];

  // Default adjustment attributes with sample values based on image
  const DEFAULT_ADJUSTMENTS = [
    { id: 'lot_size_ff', name: 'Lot Size (FF)', type: 'flat', isDefault: true, category: 'physical',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'lot_size_sf', name: 'Lot Size (SF)', type: 'flat', isDefault: true, category: 'physical',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'lot_size_acre', name: 'Lot Size (Acre)', type: 'flat', isDefault: true, category: 'physical',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'living_area', name: 'Living Area (Sq Ft)', type: 'per_sqft', isDefault: true, category: 'physical',
      values: [20, 30, 35, 40, 45, 50, 60, 85, 100, 130] },
    { id: 'year_built', name: 'Year Built', type: 'flat', isDefault: true, category: 'physical',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'basement', name: 'Basement', type: 'flat', isDefault: true, category: 'physical',
      values: [7500, 10000, 15000, 15000, 20000, 25000, 30000, 40000, 45000, 60000] },
    { id: 'finished_basement', name: 'Finished Basement', type: 'flat', isDefault: true, category: 'physical',
      values: [5000, 5000, 10000, 10000, 15000, 20000, 20000, 25000, 30000, 40000] },
    { id: 'bathrooms', name: 'Bathrooms', type: 'flat', isDefault: true, category: 'physical',
      values: [1500, 2500, 5000, 5000, 7500, 10000, 12500, 15000, 25000, 35000] },
    { id: 'bedrooms', name: 'Bedrooms', type: 'flat', isDefault: true, category: 'physical',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'ac', name: 'AC', type: 'flat', isDefault: true, category: 'physical',
      values: [1000, 2500, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000] },
    { id: 'fireplaces', name: 'Fireplaces', type: 'flat', isDefault: true, category: 'physical',
      values: [500, 1000, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500] },
    { id: 'garage', name: 'Garage', type: 'flat', isDefault: true, category: 'physical',
      values: [2500, 5000, 7500, 7500, 7500, 10000, 15000, 25000, 35000, 40000] },
    { id: 'det_garage', name: 'Det Garage', type: 'flat', isDefault: true, category: 'physical',
      values: [1250, 2500, 3450, 3450, 3450, 5000, 7500, 12500, 17500, 20000] },
    { id: 'deck', name: 'Deck', type: 'flat', isDefault: true, category: 'amenity',
      values: [1000, 1500, 2000, 3500, 3500, 5000, 10000, 20000, 30000, 35000] },
    { id: 'patio', name: 'Patio', type: 'flat', isDefault: true, category: 'amenity',
      values: [1000, 1500, 2000, 3500, 3500, 5000, 10000, 20000, 30000, 35000] },
    { id: 'open_porch', name: 'Open Porch', type: 'flat', isDefault: true, category: 'amenity',
      values: [2000, 3000, 4000, 7000, 7000, 10000, 20000, 40000, 60000, 70000] },
    { id: 'enclosed_porch', name: 'Enclosed Porch', type: 'flat', isDefault: true, category: 'amenity',
      values: [3000, 4500, 6000, 10500, 10500, 15000, 30000, 60000, 90000, 105000] },
    { id: 'exterior_condition', name: 'Exterior Condition', type: 'percent', isDefault: true, category: 'quality',
      values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'interior_condition', name: 'Interior Condition', type: 'percent', isDefault: true, category: 'quality',
      values: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
    { id: 'pool', name: 'Pool', type: 'flat', isDefault: true, category: 'amenity',
      values: [5000, 5000, 10000, 15000, 15000, 20000, 25000, 40000, 50000, 60000] }
  ];

  // Static attributes (always shown)
  const STATIC_ATTRIBUTES = [
    { id: 'garage', name: 'Garage', category: '11' },
    { id: 'deck', name: 'Deck', category: '11' },
    { id: 'patio', name: 'Patio', category: '11' },
    { id: 'open_porch', name: 'Open Porch', category: '11' },
    { id: 'enclosed_porch', name: 'Enclosed Porch', category: '11' },
    { id: 'det_garage', name: 'Detached Garage', category: '15' },
    { id: 'pool', name: 'Pool', category: '15' }
  ];

  // Dynamic attributes (shown only if defined)
  const DYNAMIC_ATTRIBUTES = [
    { id: 'barn', name: 'Barn', category: '15' },
    { id: 'pole_barn', name: 'Pole Barn', category: '15' },
    { id: 'stable', name: 'Stable', category: '15' },
    { id: 'miscellaneous', name: 'Miscellaneous', category: '39' },
    { id: 'land_positive', name: 'Positive Land', category: '62' },
    { id: 'land_negative', name: 'Negative Land', category: '63' }
  ];

  // Load adjustments and custom brackets from database
  useEffect(() => {
    if (!jobData?.id) return;
    loadAdjustments();
    loadAvailableCodes();
    loadCodeConfig(); // Load after available codes are fetched
    loadCustomBrackets();
  }, [jobData?.id]);

  const loadCustomBrackets = async () => {
    try {
      const { data, error } = await supabase
        .from('job_custom_brackets')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;
      setCustomBrackets(data || []);
    } catch (error) {
      console.error('Error loading custom brackets:', error);
    }
  };

  // Auto-populate config after codes are loaded (if no saved config exists)
  useEffect(() => {
    // Only auto-populate if:
    // 1. Available codes have been loaded
    // 2. Config is still empty (no saved settings)
    const codesLoaded = Object.values(availableCodes).some(arr => arr.length > 0);
    const configEmpty = Object.values(codeConfig).every(arr => arr.length === 0);

    if (codesLoaded && configEmpty && !isLoadingCodes) {
      console.log('🚀 Triggering auto-populate after codes loaded');
      autoPopulateCodeConfig();
    }
  }, [availableCodes, isLoadingCodes]);

  const loadAdjustments = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;

      if (data && data.length > 0) {
        setAdjustments(data);
      } else {
        // Initialize with defaults
        const defaultData = DEFAULT_ADJUSTMENTS.map((adj, idx) => ({
          job_id: jobData.id,
          adjustment_id: adj.id,
          adjustment_name: adj.name,
          adjustment_type: adj.type,
          category: adj.category,
          is_default: adj.isDefault,
          sort_order: idx,
          bracket_0: adj.values[0],
          bracket_1: adj.values[1],
          bracket_2: adj.values[2],
          bracket_3: adj.values[3],
          bracket_4: adj.values[4],
          bracket_5: adj.values[5],
          bracket_6: adj.values[6],
          bracket_7: adj.values[7],
          bracket_8: adj.values[8],
          bracket_9: adj.values[9]
        }));
        setAdjustments(defaultData);
      }
    } catch (error) {
      console.error('Error loading adjustments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCodeConfig = async () => {
    try {
      const settingKeys = [
        'adjustment_codes_garage',
        'adjustment_codes_deck',
        'adjustment_codes_patio',
        'adjustment_codes_open_porch',
        'adjustment_codes_enclosed_porch',
        'adjustment_codes_det_garage',
        'adjustment_codes_pool',
        'adjustment_codes_barn',
        'adjustment_codes_stable',
        'adjustment_codes_pole_barn',
        'adjustment_codes_miscellaneous',
        'adjustment_codes_land_positive',
        'adjustment_codes_land_negative',
        'adjustment_codes_version' // Track code definition version
      ];

      const { data, error } = await supabase
        .from('job_settings')
        .select('setting_key, setting_value')
        .eq('job_id', jobData.id)
        .in('setting_key', settingKeys);

      if (error && error.code !== 'PGRST116') throw error;

      // Generate current version hash from available codes
      const currentVersion = generateCodeVersion(availableCodes);

      // Check if saved version matches current version
      const savedVersion = data?.find(s => s.setting_key === 'adjustment_codes_version')?.setting_value;

      if (data && data.length > 0 && savedVersion === currentVersion) {
        // User has saved settings AND version matches - load them
        const newConfig = { ...codeConfig };
        data.forEach(setting => {
          const attributeId = setting.setting_key.replace('adjustment_codes_', '');
          if (attributeId !== 'version') {
            try {
              newConfig[attributeId] = setting.setting_value ? JSON.parse(setting.setting_value) : [];
            } catch (e) {
              newConfig[attributeId] = [];
            }
          }
        });
        setCodeConfig(newConfig);
      } else {
        // No saved settings OR version mismatch (code table changed) - re-auto-populate
        if (savedVersion && savedVersion !== currentVersion) {
          console.log('🔄 Code definitions changed - re-auto-populating adjustment codes...');
          setWasReset(true); // Flag that this was a reset due to table changes
        } else {
          console.log('🔍 Auto-populating adjustment codes based on keywords...');
          setWasReset(false);
        }
        autoPopulateCodeConfig();
      }
    } catch (error) {
      console.error('Error loading code config:', error);
    }
  };

  // Generate a simple hash/version string from available codes
  const generateCodeVersion = (codes) => {
    // Create a string representation of all code counts per category
    const versionString = Object.keys(codes)
      .sort()
      .map(cat => `${cat}:${codes[cat].length}`)
      .join('|');
    return versionString || 'v0';
  };

  const autoPopulateCodeConfig = () => {
    // Wait for available codes to be loaded first
    if (Object.values(availableCodes).every(arr => arr.length === 0)) {
      console.log('⏳ Waiting for codes to load before auto-populating...');
      return;
    }

    const newConfig = { ...codeConfig };

    // Auto-populate rules for static attributes
    const autoPopulateRules = {
      // Attached items (category '11')
      garage: { category: '11', keywords: ['GAR'] },
      deck: { category: '11', keywords: ['DECK'] },
      patio: { category: '11', keywords: ['PATIO'] },
      open_porch: { category: '11', keywords: ['OPEN'] },
      enclosed_porch: { category: '11', keywords: ['ENCL', 'SCREEN', 'SCRN'] },

      // Detached items (category '15')
      det_garage: { category: '15', keywords: ['GAR'] },
      pool: { category: '15', keywords: ['POOL'] }
    };

    Object.keys(autoPopulateRules).forEach(attributeId => {
      const rule = autoPopulateRules[attributeId];
      const codesInCategory = availableCodes[rule.category] || [];

      // Find codes matching any of the keywords
      const matchingCodes = codesInCategory.filter(codeObj => {
        const descUpper = codeObj.description.toUpperCase();
        return rule.keywords.some(keyword => descUpper.includes(keyword));
      }).map(codeObj => codeObj.code);

      if (matchingCodes.length > 0) {
        newConfig[attributeId] = matchingCodes;
        console.log(`✅ Auto-populated ${attributeId}: ${matchingCodes.join(', ')}`);
      }
    });

    setCodeConfig(newConfig);

    // Show user notification about auto-population
    if (Object.values(newConfig).some(arr => arr.length > 0)) {
      console.log('💡 Codes auto-populated. Review and save configuration to persist changes.');
      setShowAutoPopulateNotice(true);
    }
  };

  const loadAvailableCodes = async () => {
    try {
      setIsLoadingCodes(true);

      // Fetch parsed code definitions from the job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('parsed_code_definitions')
        .eq('id', jobData.id)
        .single();

      if (jobError || !job?.parsed_code_definitions) {
        console.error('No code definitions found:', jobError);
        setIsLoadingCodes(false);
        return;
      }

      const codeDefinitions = job.parsed_code_definitions;
      console.log('📊 Code definitions structure:', codeDefinitions);

      const sections = codeDefinitions.sections || codeDefinitions || {};
      console.log('📂 Available sections:', Object.keys(sections));

      // Extract codes from specific categories WITHIN the Residential section
      const categoryCodes = {
        '11': [], // Attached items (garage, deck, patio, open porch, enclosed porch)
        '15': [], // Detached items (det garage, pools, barn, stable, pole barn)
        '39': [], // Miscellaneous items
        '62': [], // Positive land adjustments
        '63': []  // Negative land adjustments
      };

      // BRT codes are nested: sections.Residential contains parent keys that have KEYs like "11", "15", etc.
      const residentialSection = sections.Residential || sections.residential || {};
      console.log('🏠 Residential section keys:', Object.keys(residentialSection));

      // Search through Residential section to find categories by their KEY property
      Object.keys(residentialSection).forEach(parentKey => {
        const parentSection = residentialSection[parentKey];

        // Check if this parent section has a KEY property matching our category numbers
        const categoryKey = parentSection?.KEY || parentSection?.key;

        if (categoryKey && categoryCodes.hasOwnProperty(categoryKey)) {
          console.log(`🎯 Found category ${categoryKey} at parent key "${parentKey}"`);

          // Now extract codes from the MAP within this category
          const categoryMap = parentSection.MAP || parentSection.map || {};

          Object.keys(categoryMap).forEach(codeKey => {
            const codeItem = categoryMap[codeKey];
            let description = '';

            // Extract description from DATA.VALUE
            if (codeItem?.DATA?.VALUE) {
              description = codeItem.DATA.VALUE;
            } else if (codeItem?.VALUE) {
              description = codeItem.VALUE;
            } else if (typeof codeItem === 'string') {
              description = codeItem;
            }

            if (description && codeKey !== 'KEY' && codeKey !== 'DATA' && codeKey !== 'MAP') {
              categoryCodes[categoryKey].push({
                code: codeKey,
                description: description.trim()
              });
            }
          });

          console.log(`✅ Category ${categoryKey} loaded ${categoryCodes[categoryKey].length} codes`);
        }
      });

      // Sort by code numerically
      Object.keys(categoryCodes).forEach(cat => {
        categoryCodes[cat].sort((a, b) => {
          const numA = parseInt(a.code, 10);
          const numB = parseInt(b.code, 10);
          if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
          }
          return a.code.localeCompare(b.code);
        });
      });

      console.log('📦 Final categoryCodes:', categoryCodes);
      setAvailableCodes(categoryCodes);
    } catch (error) {
      console.error('Error loading available codes:', error);
    } finally {
      setIsLoadingCodes(false);
    }
  };

  const handleAdjustmentChange = (adjustmentId, bracketIndex, value) => {
    setAdjustments(prev => prev.map(adj => {
      if (adj.adjustment_id === adjustmentId) {
        return {
          ...adj,
          [`bracket_${bracketIndex}`]: parseFloat(value) || 0
        };
      }
      return adj;
    }));
  };

  const handleSaveAdjustments = async () => {
    try {
      setIsSaving(true);

      const { error } = await supabase
        .from('job_adjustment_grid')
        .upsert(adjustments, {
          onConflict: 'job_id,adjustment_id'
        });

      if (error) throw error;

      alert('Adjustments saved successfully!');
    } catch (error) {
      console.error('Error saving adjustments:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCustomAdjustment = () => {
    // Initialize attribute values from all default adjustments
    const initialValues = {};
    DEFAULT_ADJUSTMENTS.forEach(adj => {
      initialValues[adj.id] = {
        value: 0,
        type: adj.type // Use the default type for each attribute
      };
    });

    setCustomBracket({
      name: '',
      attributeValues: initialValues
    });
    setShowCustomModal(true);
  };

  const handleSaveCustomAdjustment = async () => {
    if (!customBracket.name.trim()) {
      alert('Please enter a bracket name');
      return;
    }

    try {
      const bracketId = `custom_${Date.now()}`;
      const maxSortOrder = Math.max(...customBrackets.map(b => b.sort_order || 0), 0);

      const { error } = await supabase
        .from('job_custom_brackets')
        .insert({
          job_id: jobData.id,
          bracket_id: bracketId,
          bracket_name: customBracket.name,
          adjustment_values: customBracket.attributeValues,
          sort_order: maxSortOrder + 1
        });

      if (error) throw error;

      // Reload custom brackets
      await loadCustomBrackets();
      setShowCustomModal(false);
      alert('Custom bracket created successfully!');
    } catch (error) {
      console.error('Error saving custom bracket:', error);
      alert(`Failed to save: ${error.message}`);
    }
  };

  const handleCustomBracketValueChange = (attributeId, field, value) => {
    setCustomBracket(prev => ({
      ...prev,
      attributeValues: {
        ...prev.attributeValues,
        [attributeId]: {
          ...prev.attributeValues[attributeId],
          [field]: field === 'value' ? (parseFloat(value) || 0) : value
        }
      }
    }));
  };

  const handleDeleteCustomBracket = async (bracketId) => {
    if (!window.confirm('Delete this custom bracket? This cannot be undone.')) return;

    try {
      const { error } = await supabase
        .from('job_custom_brackets')
        .delete()
        .eq('job_id', jobData.id)
        .eq('bracket_id', bracketId);

      if (error) throw error;

      setCustomBrackets(prev => prev.filter(b => b.bracket_id !== bracketId));
      alert('Custom bracket deleted successfully');
    } catch (error) {
      console.error('Error deleting custom bracket:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleDeleteAdjustment = async (adjustmentId) => {
    if (!window.confirm('Delete this adjustment?')) return;

    try {
      const { error } = await supabase
        .from('job_adjustment_grid')
        .delete()
        .eq('job_id', jobData.id)
        .eq('adjustment_id', adjustmentId);

      if (error) throw error;

      setAdjustments(prev => prev.filter(adj => adj.adjustment_id !== adjustmentId));
    } catch (error) {
      console.error('Error deleting adjustment:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleTypeChange = (adjustmentId, newType) => {
    setAdjustments(prev => prev.map(adj => {
      if (adj.adjustment_id === adjustmentId) {
        return { ...adj, adjustment_type: newType };
      }
      return adj;
    }));
  };

  const handleCodeToggle = (attributeId, codeValue) => {
    setCodeConfig(prev => {
      const currentCodes = prev[attributeId] || [];
      const isSelected = currentCodes.includes(codeValue);

      return {
        ...prev,
        [attributeId]: isSelected
          ? currentCodes.filter(c => c !== codeValue)
          : [...currentCodes, codeValue]
      };
    });
  };

  const handleSaveCodeConfig = async () => {
    try {
      // Save code configuration settings
      const settings = Object.keys(codeConfig)
        .filter(attributeId => codeConfig[attributeId] && codeConfig[attributeId].length > 0) // Only save if codes are selected
        .map(attributeId => ({
          job_id: jobData.id,
          setting_key: `adjustment_codes_${attributeId}`,
          setting_value: JSON.stringify(codeConfig[attributeId])
        }));

      // Add version hash to detect future code table changes
      const currentVersion = generateCodeVersion(availableCodes);
      settings.push({
        job_id: jobData.id,
        setting_key: 'adjustment_codes_version',
        setting_value: currentVersion
      });

      const { error: settingsError } = await supabase
        .from('job_settings')
        .upsert(settings, { onConflict: 'job_id,setting_key' });

      if (settingsError) throw settingsError;

      // For dynamic attributes with selected codes, create/update adjustment rows
      const attributeLabels = {
        barn: 'Barn',
        stable: 'Stable',
        pole_barn: 'Pole Barn'
      };

      // Attributes that create individual rows per code (using code description as name)
      const individualRowAttributes = ['miscellaneous', 'land_positive', 'land_negative'];

      const newAdjustments = [];
      let maxSortOrder = Math.max(...adjustments.map(a => a.sort_order || 0), 0);

      // Only create adjustment rows for dynamic attributes that have codes selected
      DYNAMIC_ATTRIBUTES.forEach(attr => {
        const selectedCodes = codeConfig[attr.id] || [];

        if (selectedCodes.length > 0) {
          if (individualRowAttributes.includes(attr.id)) {
            // For misc and land adjustments, create one row per code using code description
            selectedCodes.forEach(codeValue => {
              const codes = getCodesForAttribute(attr.id, attr.category);
              const codeObj = codes.find(c => c.code === codeValue);

              if (codeObj) {
                const adjustmentId = `${attr.id}_${codeValue}`;
                const existingAdj = adjustments.find(adj => adj.adjustment_id === adjustmentId);

                if (!existingAdj) {
                  maxSortOrder += 1;
                  newAdjustments.push({
                    job_id: jobData.id,
                    adjustment_id: adjustmentId,
                    adjustment_name: codeObj.description,
                    adjustment_type: 'flat',
                    category: 'amenity',
                    is_default: false,
                    sort_order: maxSortOrder,
                    bracket_0: 0,
                    bracket_1: 0,
                    bracket_2: 0,
                    bracket_3: 0,
                    bracket_4: 0,
                    bracket_5: 0,
                    bracket_6: 0,
                    bracket_7: 0,
                    bracket_8: 0,
                    bracket_9: 0
                  });
                }
              }
            });
          } else {
            // For barn, stable, pole_barn - create single row with attribute name
            const existingAdj = adjustments.find(adj => adj.adjustment_id === attr.id);

            if (!existingAdj) {
              maxSortOrder += 1;
              newAdjustments.push({
                job_id: jobData.id,
                adjustment_id: attr.id,
                adjustment_name: attributeLabels[attr.id] || attr.name,
                adjustment_type: 'flat',
                category: 'amenity',
                is_default: false,
                sort_order: maxSortOrder,
                bracket_0: 0,
                bracket_1: 0,
                bracket_2: 0,
                bracket_3: 0,
                bracket_4: 0,
                bracket_5: 0,
                bracket_6: 0,
                bracket_7: 0,
                bracket_8: 0,
                bracket_9: 0
              });
            }
          }
        }
      });

      // Save new adjustment rows to database
      if (newAdjustments.length > 0) {
        const { error: adjError } = await supabase
          .from('job_adjustment_grid')
          .upsert(newAdjustments, { onConflict: 'job_id,adjustment_id' });

        if (adjError) throw adjError;

        // Update local state
        setAdjustments(prev => {
          const existing = [...prev];
          newAdjustments.forEach(newAdj => {
            if (!existing.find(a => a.adjustment_id === newAdj.adjustment_id)) {
              existing.push(newAdj);
            }
          });
          return existing;
        });
      }

      alert(`Code configuration saved!${newAdjustments.length > 0 ? ` ${newAdjustments.length} new adjustment row(s) added to grid.` : ''}`);

      // Dismiss auto-populate notice and reset flag after saving
      setShowAutoPopulateNotice(false);
      setWasReset(false);

      // Optionally switch to adjustment grid tab to show new rows
      if (newAdjustments.length > 0) {
        setActiveSubTab('adjustments');
      }
    } catch (error) {
      console.error('Error saving code config:', error);
      alert(`Failed to save: ${error.message}`);
    }
  };

  // Get available codes for a specific attribute
  const getCodesForAttribute = (attributeId, category) => {
    return availableCodes[category] || [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading adjustments...</div>
      </div>
    );
  }

  return (
    <div className="adjustments-tab">
      {/* Sub-tab Navigation - Configuration now comes first */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSubTab('config')}
            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2 ${
              activeSubTab === 'config'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Settings className="w-4 h-4" />
            Configuration
          </button>
          <button
            onClick={() => setActiveSubTab('adjustments')}
            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === 'adjustments'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Adjustment Grid
          </button>
        </nav>
      </div>

      {/* Configuration Tab */}
      {activeSubTab === 'config' && (
        <div>
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Adjustment Code Configuration</h3>
            <p className="text-sm text-gray-600">
              Assign BRT codes to each adjustment attribute. Static attributes are always visible in the adjustment grid.
              Dynamic attributes will only appear in the grid after codes are assigned and saved.
            </p>
          </div>

          {/* Auto-populate Notification */}
          {showAutoPopulateNotice && (
            <div className={`mb-6 rounded-lg p-4 ${
              wasReset
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-blue-50 border border-blue-200'
            }`}>
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <Settings className={`w-5 h-5 ${wasReset ? 'text-yellow-600' : 'text-blue-600'}`} />
                </div>
                <div className="flex-1">
                  <h4 className={`text-sm font-semibold mb-1 ${wasReset ? 'text-yellow-900' : 'text-blue-900'}`}>
                    {wasReset ? 'Configuration Reset - Code Table Changed' : 'Codes Auto-Populated'}
                  </h4>
                  <p className={`text-sm mb-2 ${wasReset ? 'text-yellow-800' : 'text-blue-800'}`}>
                    {wasReset ? (
                      <>
                        The BRT code table has been updated since your last configuration.
                        Adjustment codes have been <strong>re-auto-populated</strong> based on keyword matching
                        (Garage: GAR | Deck: DECK | Patio: PATIO | Open Porch: OPEN | Enclosed Porch: ENCL/SCREEN | Pool: POOL).
                        Review the new selections and save to update your configuration.
                      </>
                    ) : (
                      <>
                        Adjustment codes have been automatically assigned based on keyword matching
                        (Garage: GAR | Deck: DECK | Patio: PATIO | Open Porch: OPEN | Enclosed Porch: ENCL/SCREEN | Pool: POOL).
                        Review the selections below and click "Save Configuration" to persist your changes.
                      </>
                    )}
                  </p>
                  <button
                    onClick={() => setShowAutoPopulateNotice(false)}
                    className={`text-sm font-medium ${
                      wasReset
                        ? 'text-yellow-700 hover:text-yellow-900'
                        : 'text-blue-700 hover:text-blue-900'
                    }`}
                  >
                    Dismiss
                  </button>
                </div>
                <button
                  onClick={() => setShowAutoPopulateNotice(false)}
                  className={`flex-shrink-0 ${
                    wasReset
                      ? 'text-yellow-400 hover:text-yellow-600'
                      : 'text-blue-400 hover:text-blue-600'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {isLoadingCodes ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500">Loading code definitions...</div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Static Attributes Section */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-blue-50 px-4 py-3 border-b">
                  <h4 className="font-semibold text-gray-900">Static Attributes</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    Always visible in the adjustment grid
                  </p>
                </div>
                <div className="bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4 font-medium text-gray-700 w-1/3">Attribute</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Assigned Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {STATIC_ATTRIBUTES.map(attr => {
                        const codes = getCodesForAttribute(attr.id, attr.category);
                        const selectedCodes = codeConfig[attr.id] || [];

                        return (
                          <tr key={attr.id} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium text-gray-900">{attr.name}</td>
                            <td className="py-3 px-4">
                              <div className="space-y-2">
                                {/* Selected codes as chips */}
                                {selectedCodes.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {selectedCodes.map(codeVal => {
                                      const codeObj = codes.find(c => c.code === codeVal);
                                      return (
                                        <span
                                          key={codeVal}
                                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium"
                                        >
                                          {codeVal} - {codeObj?.description || 'Unknown'}
                                          <button
                                            onClick={() => handleCodeToggle(attr.id, codeVal)}
                                            className="ml-1 text-blue-600 hover:text-blue-800"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Dropdown to add codes */}
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleCodeToggle(attr.id, e.target.value);
                                    }
                                  }}
                                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                >
                                  <option value="">-- Add Code --</option>
                                  {codes
                                    .filter(code => !selectedCodes.includes(code.code))
                                    .map(code => (
                                      <option key={code.code} value={code.code}>
                                        {code.code} - {code.description}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dynamic Attributes Section */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-green-50 px-4 py-3 border-b">
                  <h4 className="font-semibold text-gray-900">Dynamic Attributes</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    Only visible in the adjustment grid after codes are assigned and saved
                  </p>
                </div>
                <div className="bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left py-3 px-4 font-medium text-gray-700 w-1/3">Attribute</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-700">Assigned Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DYNAMIC_ATTRIBUTES.map(attr => {
                        const codes = getCodesForAttribute(attr.id, attr.category);
                        const selectedCodes = codeConfig[attr.id] || [];

                        return (
                          <tr key={attr.id} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4 font-medium text-gray-900">{attr.name}</td>
                            <td className="py-3 px-4">
                              <div className="space-y-2">
                                {/* Selected codes as chips */}
                                {selectedCodes.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mb-2">
                                    {selectedCodes.map(codeVal => {
                                      const codeObj = codes.find(c => c.code === codeVal);
                                      return (
                                        <span
                                          key={codeVal}
                                          className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium"
                                        >
                                          {codeVal} - {codeObj?.description || 'Unknown'}
                                          <button
                                            onClick={() => handleCodeToggle(attr.id, codeVal)}
                                            className="ml-1 text-green-600 hover:text-green-800"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Dropdown to add codes */}
                                <select
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleCodeToggle(attr.id, e.target.value);
                                    }
                                  }}
                                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                >
                                  <option value="">-- Add Code --</option>
                                  {codes
                                    .filter(code => !selectedCodes.includes(code.code))
                                    .map(code => (
                                      <option key={code.code} value={code.code}>
                                        {code.code} - {code.description}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end pt-4 border-t">
                <button
                  onClick={handleSaveCodeConfig}
                  className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                >
                  <Save className="w-4 h-4" />
                  Save Configuration
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Adjustment Grid Tab */}
      {activeSubTab === 'adjustments' && (
        <div>
          {/* Header Actions */}
          <div className="mb-6 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Sales Adjustment Grid</h3>
              <p className="text-sm text-gray-600 mt-1">
                Define adjustments by price bracket for comparable sales analysis
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddCustomAdjustment}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
              >
                <Plus className="w-4 h-4" />
                Create Custom Bracket
              </button>
              <button
                onClick={handleSaveAdjustments}
                disabled={isSaving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : 'Save Adjustments'}
              </button>
            </div>
          </div>

          {/* Adjustment Grid Table */}
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                    Attribute
                  </th>
                  {/* Default Brackets */}
                  {CME_BRACKETS.map((bracket, idx) => (
                    <th
                      key={`default-${idx}`}
                      className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider"
                      style={{ backgroundColor: bracket.color, color: bracket.textColor }}
                    >
                      {bracket.shortLabel}
                    </th>
                  ))}
                  {/* Custom Brackets */}
                  {customBrackets.map((customBracket, idx) => (
                    <th
                      key={`custom-${customBracket.bracket_id}`}
                      className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider bg-purple-100 text-purple-900 border-l-2 border-purple-300"
                      title="Custom Bracket"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span>{customBracket.bracket_name}</span>
                        <button
                          onClick={() => handleDeleteCustomBracket(customBracket.bracket_id)}
                          className="text-purple-600 hover:text-purple-800"
                          title="Delete custom bracket"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-200">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {adjustments.map((adj) => (
                  <tr key={adj.adjustment_id} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-r border-gray-200">
                      {adj.adjustment_name}
                    </td>
                    {/* Default Bracket Values */}
                    {CME_BRACKETS.map((bracket, bIdx) => (
                      <td
                        key={`default-${bIdx}`}
                        className="px-2 py-2 text-center"
                        style={{ backgroundColor: `${bracket.color}33` }}
                      >
                        <input
                          type="number"
                          value={adj[`bracket_${bIdx}`] || 0}
                          onChange={(e) => handleAdjustmentChange(adj.adjustment_id, bIdx, e.target.value)}
                          className="w-20 px-2 py-1 text-sm text-center border rounded focus:ring-2 focus:ring-blue-500"
                          step={adj.adjustment_type === 'per_sqft' ? '0.01' : '100'}
                        />
                      </td>
                    ))}
                    {/* Custom Bracket Values */}
                    {customBrackets.map((customBracket) => {
                      const customValue = customBracket.adjustment_values?.[adj.adjustment_id] || { value: 0, type: adj.adjustment_type };
                      return (
                        <td
                          key={`custom-${customBracket.bracket_id}`}
                          className="px-2 py-2 text-center bg-purple-50 border-l-2 border-purple-300"
                        >
                          <div className="text-sm font-medium text-gray-900">
                            {customValue.value || 0}
                            <span className="text-xs text-gray-500 ml-1">
                              {customValue.type === 'flat' ? '$' : customValue.type === 'per_sqft' ? '$/SF' : '%'}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-white px-2 py-2 text-center border-l border-gray-200">
                      <div className="flex items-center justify-center gap-2">
                        <select
                          value={adj.adjustment_type}
                          onChange={(e) => handleTypeChange(adj.adjustment_id, e.target.value)}
                          className="text-xs border rounded px-2 py-1"
                          disabled={adj.is_default && adj.adjustment_type !== 'percent'}
                        >
                          <option value="flat">Flat ($)</option>
                          <option value="per_sqft">Per SF ($/SF)</option>
                          {(adj.adjustment_type === 'percent' || adj.adjustment_type === 'flat_or_percent') && (
                            <option value="percent">Percent (%)</option>
                          )}
                        </select>
                        {!adj.is_default && (
                          <button
                            onClick={() => handleDeleteAdjustment(adj.adjustment_id)}
                            className="text-red-600 hover:text-red-800 ml-2"
                            title="Delete custom adjustment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Adjustment Types:</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              <li><strong>Flat ($)</strong> - Fixed dollar amount adjustment</li>
              <li><strong>Per SF ($/SF)</strong> - Adjustment per square foot (e.g., Living Area)</li>
              <li><strong>Percent (%)</strong> - Percentage-based adjustment (available for Condition)</li>
            </ul>
          </div>

          {/* Create Custom Bracket Modal */}
          {showCustomModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Create Custom Adjustment Bracket</h3>
                    <p className="text-sm text-gray-600 mt-1">Define a custom price bracket column with adjustment values for all attributes</p>
                  </div>
                  <button
                    onClick={() => setShowCustomModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Bracket Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bracket Name
                    </label>
                    <input
                      type="text"
                      value={customBracket.name}
                      onChange={(e) => setCustomBracket(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., $150K-$250K Custom, Luxury Properties, etc."
                    />
                  </div>

                  {/* Attribute Values Table */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      Adjustment Values by Attribute
                    </label>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                              Attribute
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                              Value
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {DEFAULT_ADJUSTMENTS.map(adj => {
                            const attrValue = customBracket.attributeValues[adj.id] || { value: 0, type: adj.type };
                            return (
                              <tr key={adj.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                  {adj.name}
                                </td>
                                <td className="px-4 py-3">
                                  <input
                                    type="number"
                                    value={attrValue.value}
                                    onChange={(e) => handleCustomBracketValueChange(adj.id, 'value', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                    step={attrValue.type === 'per_sqft' ? '0.01' : attrValue.type === 'percent' ? '1' : '100'}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={attrValue.type}
                                    onChange={(e) => handleCustomBracketValueChange(adj.id, 'type', e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="flat">Flat ($)</option>
                                    <option value="per_sqft">Per SF ($/SF)</option>
                                    {(adj.type === 'percent' || adj.adjustment_type === 'percent') && (
                                      <option value="percent">Percent (%)</option>
                                    )}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
                  <button
                    onClick={() => setShowCustomModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 bg-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCustomAdjustment}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                  >
                    Save Custom Bracket
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdjustmentsTab;
