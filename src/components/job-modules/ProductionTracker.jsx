import React, { useState, useEffect, useRef } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const ProductionTracker = ({ 
  jobData, 
  properties,           // NEW: Receive properties from JobContainer
  inspectionData,       // NEW: Receive inspection data from JobContainer
  onBackToJobs, 
  latestFileVersion, 
  propertyRecordsCount, 
  onUpdateWorkflowStats, 
  currentWorkflowStats,
  dataUpdateNotification,  // NEW: Receive notification from JobContainer
  clearDataNotification,     // NEW: Receive clear function from JobContainer
  employees    
}) => {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [employeeData, setEmployeeData] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [billingAnalytics, setBillingAnalytics] = useState(null);
  const [validationReport, setValidationReport] = useState(null);
  const [missingPropertiesReport, setMissingPropertiesReport] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const notificationCounterRef = useRef(0);
  const [externalInspectorsList, setExternalInspectorsList] = useState('');

  // NEW: Track properties going to external contractors
  const [unassignedPropertyCount, setUnassignedPropertyCount] = useState(0);

  // NEW: Track if we loaded from database to prevent race condition
  const [loadedFromDatabase, setLoadedFromDatabase] = useState(false);

  // REF: Track if initialization has run to prevent re-initialization
  const hasInitialized = useRef(false);
  
  // NEW: Commercial inspection counts from inspection_data
  const [commercialCounts, setCommercialCounts] = useState({
    total: 0,
    inspected: 0,
    priced: 0
  });

  // Commercial counts state tracking
  useEffect(() => {
    // Commercial counts updated
  }, [commercialCounts]);

  // Calculate unassigned property count from passed properties
  const calculateUnassignedPropertyCount = () => {
    if (!properties || properties.length === 0) return;
    
    const unassignedCount = properties.filter(p => 
      p.is_assigned_property === false
    ).length;
    
    setUnassignedPropertyCount(unassignedCount);
   };

  // Settings state - Enhanced InfoBy category configuration
  const [availableInfoByCodes, setAvailableInfoByCodes] = useState([]);
  const [infoByCategoryConfig, setInfoByCategoryConfig] = useState({
    entry: [],
    refusal: [],
    estimation: [],
    invalid: [],
    priced: [],
    special: [] // NEW: For Microsystems V, N codes - valid but no validation reports
  });
  const [originalCategoryConfig, setOriginalCategoryConfig] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [projectStartDate, setProjectStartDate] = useState('');
  const [isDateLocked, setIsDateLocked] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [settingsLocked, setSettingsLocked] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState('analytics');
  const [selectedInspectorIssues, setSelectedInspectorIssues] = useState(null);
  
  // NEW: Add collapsible InfoBy configuration state
  const [showInfoByConfig, setShowInfoByConfig] = useState(false);
  const [detectedVendor, setDetectedVendor] = useState(null);
  
  // Inspector filtering and sorting
  const [inspectorFilter, setInspectorFilter] = useState('all');
  const [inspectorSort, setInspectorSort] = useState('alphabetical');
  
  // NEW: Override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [selectedOverrideProperty, setSelectedOverrideProperty] = useState(null);
  const [overrideReason, setOverrideReason] = useState('New Construction');
  const [customOverrideReason, setCustomOverrideReason] = useState('');
  const [overrideMap, setOverrideMap] = useState({});
  const [validationOverrides, setValidationOverrides] = useState([]);

  // NEW: Processing modal state for validation during processing
  const [pendingValidations, setPendingValidations] = useState([]);
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [processingPaused, setProcessingPaused] = useState(false);
  const [processedValidationDecisions, setProcessedValidationDecisions] = useState({});
  const [processingComplete, setProcessingComplete] = useState(false); // NEW: Track when processing is done
  const [currentValidationIndex, setCurrentValidationIndex] = useState(0); // NEW: Track current validation item

  // NEW: Smart data staleness detection
  const isDataStale = currentWorkflowStats?.needsRefresh && 
                     currentWorkflowStats?.lastFileUpdate > currentWorkflowStats?.lastProcessed;

  const addNotification = (message, type = 'info') => {
    const id = `${Date.now()}-${notificationCounterRef.current++}`;
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Debug logging
  const debugLog = (section, message, data = null) => {
    console.log(`🔍 [${section}] ${message}`, data || '');
  };

  // Calculate commercial inspection counts from passed inspection data
  const calculateCommercialCounts = () => {
    if (!inspectionData || inspectionData.length === 0) {
      return;
    }

    const commercialProps = inspectionData.filter(d =>
      ['4A', '4B', '4C'].includes(d.property_class)
    );

    const inspected = commercialProps.filter(d =>
      d.measure_by && d.measure_date
    ).length;

    // FIXED: Use vendor-specific pricing logic
    const currentVendor = jobData.vendor_type;
    let priced = 0;

    if (currentVendor === 'BRT') {
      // BRT: Check for price_by and price_date fields
      priced = commercialProps.filter(d =>
        d.price_by && d.price_date
      ).length;
    } else if (currentVendor === 'Microsystems') {
      // Microsystems: Check if info_by_code is in priced category
      const pricedCodes = infoByCategoryConfig.priced || [];

      // GUARD: Don't calculate if config not loaded yet
      if (pricedCodes.length === 0) {
        setCommercialCounts({
          total: commercialProps.length,
          inspected: inspected,
          priced: 0  // Will be recalculated when config loads
        });
        return;
      }

      priced = commercialProps.filter(d =>
        d.info_by_code && pricedCodes.includes(d.info_by_code)
      ).length;
    }

    setCommercialCounts({
      total: commercialProps.length,
      inspected: inspected,
      priced: priced
    });

  };

  // Process employee data from props instead of loading from database
  const processEmployeeData = () => {
    if (!employees || employees.length === 0) return;
    
    const employeeMap = {};
    employees.forEach(emp => {
      // Only use actual initials from database, no generation
      if (emp.initials) {
        employeeMap[emp.initials] = {
          id: emp.id,
          name: `${emp.first_name} ${emp.last_name}`,
          fullName: `${emp.last_name}, ${emp.first_name}`,
          inspector_type: emp.inspector_type,
          initials: emp.initials
        };
      }
    });

    // Parse external inspectors and add them to employee data
    const externalCodes = externalInspectorsList.split(',').map(code => code.trim()).filter(code => code);
    const externalInspectorsMap = {};

    externalCodes.forEach(code => {
      externalInspectorsMap[code] = {
        id: `external-${code}`,
        name: `${code} (External)`,
        fullName: `${code} (External Inspector)`,
        inspector_type: 'external',
        initials: code
      };
    });

    // Merge regular employees with external inspectors
    setEmployeeData({ ...employeeMap, ...externalInspectorsMap });
  };

  // NEW: Load vendor source from property_records
  const loadVendorSource = async () => {
    if (!jobData?.id || !latestFileVersion) return null;

    try {
      const { data: record, error } = await supabase
        .from('property_records')
        .select('vendor_source')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .not('vendor_source', 'is', null)
        .limit(1)
        .single();

      if (!error && record?.vendor_source) {
        setDetectedVendor(record.vendor_source);
        return record.vendor_source;
      }
      
      // Fallback to jobData vendor_type
      setDetectedVendor(jobData.vendor_type);
      return jobData.vendor_type;
    } catch (error) {
      return jobData.vendor_type;
    }
  };

  // Calculate validation overrides - fetch fresh data from database for immediate updates
  const calculateValidationOverrides = async (useFreshData = false) => {
    let overrideSource = inspectionData;

    // If requested or if no inspection data available, fetch fresh from database
    if (useFreshData || !inspectionData || inspectionData.length === 0) {
      if (!jobData?.id || !latestFileVersion) return;

      try {
        const { data: freshInspectionData, error } = await supabase
          .from('inspection_data')
          .select('*')
          .eq('job_id', jobData.id)
          .eq('file_version', latestFileVersion)
          .eq('override_applied', true);

        if (error) {
          console.error('Error fetching fresh overrides:', error);
          return;
        }

        overrideSource = freshInspectionData || [];
        debugLog('VALIDATION_OVERRIDES', `✅ Fetched ${overrideSource.length} fresh overrides from database`);
      } catch (error) {
        console.error('Error in calculateValidationOverrides:', error);
        return;
      }
    } else {
      // Use prop data and filter for overrides
      overrideSource = inspectionData.filter(d => d.override_applied === true);
    }

    // Process overrides to ensure block/lot/qualifier are populated
    const processedOverrides = overrideSource.map(override => {
      if (!override.block || !override.lot) {
        // Parse from composite key format: "YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION"
        const keyParts = override.property_composite_key.split('-');
        if (keyParts.length >= 2) {
          const blockPart = keyParts[1]; // After first dash is block
          const lotQualPart = keyParts[2]; // After second dash is lot_qualifier
          const [lot, qualifier] = lotQualPart ? lotQualPart.split('_') : ['', ''];

          return {
            ...override,
            block: override.block || blockPart || '',
            lot: override.lot || lot || '',
            qualifier: override.qualifier || qualifier || ''
          };
        }
      }
      return override;
    });

    setValidationOverrides(processedOverrides);

    // Build override map for quick lookup
    const overrideMapData = {};
    processedOverrides.forEach(override => {
      overrideMapData[override.property_composite_key] = {
        override_applied: override.override_applied,
        override_reason: override.override_reason,
        override_by: override.override_by,
        override_date: override.override_date
      };
    });
    setOverrideMap(overrideMapData);

    return processedOverrides;
  };

  // Enhanced InfoBy code loading with proper Microsystems cleaning
  const loadAvailableInfoByCodes = async () => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('parsed_code_definitions, vendor_type')
        .eq('id', jobData.id)
        .single();

      if (error || !job?.parsed_code_definitions) {
        addNotification('No code definitions found. Upload code file first.', 'warning');
        return;
      }

      const codes = [];
      const vendor = job.vendor_type;

      if (vendor === 'BRT') {
        const sections = job.parsed_code_definitions.sections || job.parsed_code_definitions;
        
        debugLog('CODES', 'BRT sections available:', Object.keys(sections));

        // FIXED: Search for InfoBy section by KEY "53" or VALUE "INFO. BY" instead of hardcoded parent key position
        // This handles BRT files with different structures (e.g., Barnegat Light has extra sections 06, 07, 08)
        const residentialSection = sections['Residential'];
        if (residentialSection) {
          let infoBySection = null;

          // Search all parent keys to find the one with KEY="53" or VALUE containing "INFO"
          Object.keys(residentialSection).forEach(parentKey => {
            const section = residentialSection[parentKey];
            if (section?.KEY === '53' || section?.DATA?.VALUE?.includes('INFO')) {
              infoBySection = section;
              debugLog('CODES', `Found InfoBy section at parent key "${parentKey}" with KEY="${section.KEY}" VALUE="${section.DATA?.VALUE}"`);
            }
          });

          if (infoBySection && infoBySection.MAP) {
            Object.keys(infoBySection.MAP).forEach(key => {
              const item = infoBySection.MAP[key];
              if (item?.DATA?.VALUE) {
                codes.push({
                  code: item.KEY || item.DATA.KEY,
                  description: item.DATA.VALUE
                });
              }
            });
          } else {
            debugLog('CODES', '⚠️ WARNING: Could not find InfoBy section (KEY=53) in BRT Residential codes');
          }
        }

      } else if (vendor === 'Microsystems') {
        // Enhanced Microsystems parsing with proper cleaning
        const fieldCodes = job.parsed_code_definitions.field_codes;
        const flatLookup = job.parsed_code_definitions.flat_lookup;
        
        if (fieldCodes && fieldCodes['140']) {
          // APPROACH 1: Read from clean structured field_codes['140']
          debugLog('CODES', 'Found 140 category in field_codes, loading InfoBy codes...');
          
          Object.keys(fieldCodes['140']).forEach(actualCode => {
            const codeData = fieldCodes['140'][actualCode];
            codes.push({
              code: actualCode, // Should be clean single letter like "A"
              description: codeData.description,
              section: 'InfoBy',
              vendor: 'Microsystems',
              storageCode: actualCode // Store clean single letter like "A"
            });
            
            debugLog('CODES', `✅ Clean InfoBy code: ${actualCode} = ${codeData.description}`);
          });
          
        } else if (flatLookup) {
          // APPROACH 2: Read from flat_lookup 
          debugLog('CODES', 'No field_codes[140], trying flat_lookup fallback...');
          
          Object.keys(flatLookup).forEach(code => {
            if (code.startsWith('140')) {
              const cleanCode = code.substring(3); // 140A -> A
              const description = flatLookup[code];
              codes.push({
                code: cleanCode,
                description: description,
                section: 'InfoBy',
                vendor: 'Microsystems',
                storageCode: cleanCode
              });
              
              debugLog('CODES', `✅ Clean InfoBy code: ${cleanCode} = ${description}`);
            }
          });
          
        } else {
          // APPROACH 3: Legacy format with aggressive cleaning
          debugLog('CODES', 'No structured format found, cleaning raw legacy format...');
          
          Object.keys(job.parsed_code_definitions).forEach(rawKey => {
            if (rawKey.startsWith('140')) {
              // AGGRESSIVE CLEANING: "140A   9999" -> "A"
              let cleanCode = rawKey.substring(3); // Remove "140" -> "A   9999"
              cleanCode = cleanCode.trim(); // Remove leading/trailing spaces -> "A   9999"
              cleanCode = cleanCode.split(/\s+/)[0]; // Split on whitespace, take first -> "A"
              
              const description = job.parsed_code_definitions[rawKey];
              
              codes.push({
                code: cleanCode, // Display clean single letter "A"
                description: description,
                section: 'InfoBy',
                vendor: 'Microsystems',
                storageCode: cleanCode // Store clean single letter "A"
              });
              
              debugLog('CODES', `✅ Cleaned InfoBy code: ${cleanCode} = ${description} (from raw: ${rawKey})`);
            }
          });
        }
      }

      setAvailableInfoByCodes(codes);
      debugLog('CODES', `�� FINAL: Loaded ${codes.length} clean InfoBy codes from ${vendor}`, 
        codes.map(c => `${c.code}=${c.description}`));

      // Load existing category configuration
      await loadCategoriesFromDatabase(codes, vendor);

    } catch (error) {
      console.error('Error loading InfoBy codes:', error);
      addNotification('Error loading InfoBy codes from code file', 'error');
    }
  };

  // Load existing category configuration from database
  const loadCategoriesFromDatabase = async (codes, vendor) => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('infoby_category_config, workflow_stats')
        .eq('id', jobData.id)
        .single();

      if (!error && job?.infoby_category_config && Object.keys(job.infoby_category_config).length > 0) {
        setInfoByCategoryConfig(job.infoby_category_config);
        setOriginalCategoryConfig(job.infoby_category_config);
      } else if (!error && job?.workflow_stats?.infoByCategoryConfig) {
        const oldConfig = job.workflow_stats.infoByCategoryConfig;
        setInfoByCategoryConfig(oldConfig);
        setOriginalCategoryConfig(oldConfig);
        await saveCategoriesToDatabase(oldConfig);
      } else if (codes && codes.length > 0) {
        setDefaultCategoryConfig(vendor, codes);
      }
    } catch (error) {
      console.error('Error loading category config:', error);
    }
  };

  // Set default InfoBy category configurations
  const setDefaultCategoryConfig = (vendor, codes) => {
    const defaultConfig = { entry: [], refusal: [], estimation: [], invalid: [], priced: [], special: [] };

    if (vendor === 'BRT') {
      codes.forEach(item => {
        const desc = item.description.toUpperCase();
        if (desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT') || desc.includes('AGENT')) {
          defaultConfig.entry.push(item.code);
        } else if (desc.includes('REFUSED')) {
          defaultConfig.refusal.push(item.code);
        } else if (desc.includes('ESTIMATED')) {
          defaultConfig.estimation.push(item.code);
        } else if (desc.includes('DOOR')) {
          defaultConfig.invalid.push(item.code);
        } else if (desc.includes('CONVERSION') || desc.includes('PRICED')) {
          defaultConfig.priced.push(item.code);
        }
      });
    } else if (vendor === 'Microsystems') {
      codes.forEach(item => {
        const storageCode = item.storageCode || item.code; // Use clean code
        const desc = item.description.toUpperCase();
        if (desc.includes('AGENT') || desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT')) {
          defaultConfig.entry.push(storageCode);
        } else if (desc.includes('REFUSED')) {
          defaultConfig.refusal.push(storageCode);
        } else if (desc.includes('ESTIMATED') || desc.includes('VACANT')) {
          defaultConfig.estimation.push(storageCode);
        } else if (desc.includes('PRICED') || desc.includes('NARRATIVE') || desc.includes('ENCODED')) {
          defaultConfig.priced.push(storageCode);
        } else if (desc.includes('VACANT LAND') || desc.includes('NARRATIVE')) {
          // Special category for V (VACANT LAND) and N (NARRATIVE) - valid but no validation
          defaultConfig.special.push(storageCode);
        }
      });
    }

    setInfoByCategoryConfig(defaultConfig);
    setOriginalCategoryConfig(defaultConfig);
    setHasUnsavedChanges(true);
  };

  // Save category configuration to database and persist analytics
  const saveCategoriesToDatabase = async (config = null, freshAnalytics = null) => {
    if (!jobData?.id) return;

    const configToSave = config || infoByCategoryConfig;
    const analyticsToSave = freshAnalytics || {
      analytics,
      billingAnalytics,
      validationReport,
      missingPropertiesReport,
      validationOverrides,
      overrideMap
    };

    try {
      const { error } = await supabase
        .from('jobs')
        .update({ 
          infoby_category_config: {
            ...configToSave,
            vendor_type: jobData.vendor_type,
            last_updated: new Date().toISOString()
          },
          external_inspectors: externalInspectorsList,
          // Persist fresh analytics data for navigation survival
      workflow_stats: analyticsToSave.analytics ? {
        ...analyticsToSave.analytics,
        billingAnalytics: analyticsToSave.billingAnalytics,
        validationReport: analyticsToSave.validationReport,
        missingPropertiesReport: analyticsToSave.missingPropertiesReport,
        validationOverrides: analyticsToSave.validationOverrides,
        overrideMap: analyticsToSave.overrideMap,
        lastProcessed: new Date().toISOString(),
        needsRefresh: false  // Clear the stale flag after processing
      } : undefined
        })
        .eq('id', jobData.id);

      if (error) throw error;
      
      setOriginalCategoryConfig(configToSave);
      setHasUnsavedChanges(false);
      
      debugLog('PERSISTENCE', '✅ Saved config and FRESH analytics to job record', analyticsToSave.analytics);
    } catch (error) {
      console.error('Error saving configuration:', error);
      addNotification('Error saving configuration', 'error');
    }
  };

  // Load persisted analytics on component mount
  const loadPersistedAnalytics = async () => {
    if (!jobData?.id) return;

    // Don't load from database if we just processed - use current state
    if (processed || analytics) {
      console.log('⏭️ Skipping loadPersistedAnalytics - already processed in this session');
      return;
    }

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('workflow_stats, external_inspectors')
        .eq('id', jobData.id)
        .single();

      if (job?.external_inspectors) {
        setExternalInspectorsList(job.external_inspectors);
      }

      if (!error && job?.workflow_stats && job.workflow_stats.totalRecords) {
        // Load the persisted analytics
        let loadedAnalytics = job.workflow_stats;
        let loadedBillingAnalytics = job.workflow_stats.billingAnalytics;
        let loadedValidationReport = job.workflow_stats.validationReport;
        
        // Load current validation overrides and adjust totals
        const { data: currentOverrides, error: overrideError } = await supabase
          .from('inspection_data')
          .select('property_composite_key, override_applied, property_class')
          .eq('job_id', jobData.id)
          .eq('file_version', latestFileVersion)
          .eq('override_applied', true);

        if (!overrideError && currentOverrides && currentOverrides.length > 0) {
          debugLog('PERSISTENCE', `Found ${currentOverrides.length} validation overrides to include in totals`);
          
          // Adjust the validInspections count to include overrides
          const overrideCount = currentOverrides.length;
          const savedOverrideCount = job.workflow_stats.validationOverrides?.length || 0;
          
          // If we have MORE overrides now than when analytics were saved, add the difference
          if (overrideCount > savedOverrideCount) {
            const additionalOverrides = overrideCount - savedOverrideCount;
            loadedAnalytics = {
              ...loadedAnalytics,
              validInspections: loadedAnalytics.validInspections + additionalOverrides
            };
            debugLog('PERSISTENCE', `Adjusted validInspections from ${job.workflow_stats.validInspections} to ${loadedAnalytics.validInspections}`);
          }
        }
        
        // Set all the state with potentially adjusted values
        setAnalytics(loadedAnalytics);
        setBillingAnalytics(loadedBillingAnalytics);
        setValidationReport(loadedValidationReport);

        // Restore commercial counts from saved analytics
        if (loadedAnalytics.totalCommercialProperties) {
          setCommercialCounts({
            total: loadedAnalytics.totalCommercialProperties,
            inspected: loadedAnalytics.commercialInspections || 0,
            priced: loadedAnalytics.commercialPricing || 0
          });
        }

        if (job.workflow_stats.missingPropertiesReport) {
          setMissingPropertiesReport(job.workflow_stats.missingPropertiesReport);
        }
        if (job.workflow_stats.validationOverrides) {
          setValidationOverrides(job.workflow_stats.validationOverrides);
        }
        if (job.workflow_stats.overrideMap) {
          setOverrideMap(job.workflow_stats.overrideMap);
        }

        setProcessed(true);
        setSettingsLocked(true);
        setLoadedFromDatabase(true); // CRITICAL: Mark that we loaded from database
      }
    } catch (error) {
      console.error('Error loading persisted analytics:', error);
    }
  };

  const loadProjectStartDate = async () => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('project_start_date')

        .eq('id', jobData.id)
        .single();

      if (!error && job?.project_start_date) {
        setProjectStartDate(job.project_start_date);

        setIsDateLocked(true);
      }
    } catch (error) {
    }
  };

  const lockStartDate = async () => {
    if (!projectStartDate || !jobData?.id) {
      addNotification('Please set a project start date first', 'error');
      return;
    }

    try {

      // Validate date before sending to database
    if (!projectStartDate || projectStartDate.trim() === '') {
      throw new Error('Project start date cannot be empty');
    }

    const { error } = await supabase
        .from('jobs')
        .update({ project_start_date: projectStartDate })
        .eq('id', jobData.id);

      if (error) throw error;

      setIsDateLocked(true);
      addNotification('✅ Project start date locked and saved to job', 'success');

    } catch (error) {
      console.error('Error locking start date:', error);
      addNotification('Error saving start date: ' + error.message, 'error');
    }
  };

  const unlockStartDate = () => {
    setIsDateLocked(false);
    addNotification('Project start date unlocked for editing', 'info');
  };

  // Undo override validation issue
  const handleUndoOverride = async (propertyKey, overrideReason) => {
    try {
      // DELETE the override record entirely from inspection_data
      const { error } = await supabase
        .from('inspection_data')
        .delete()
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .eq('property_composite_key', propertyKey)
        .eq('override_applied', true);

      if (error) throw error;
      
      // Update App.js state immediately after removing override
      if (onUpdateWorkflowStats && analytics) {
        // Get fresh overrides for accurate count
        const freshOverrides = await getFreshValidationOverrides();
        const freshOverrideMap = {};
        freshOverrides.forEach(override => {
          freshOverrideMap[override.property_composite_key] = {
            override_applied: override.override_applied,
            override_reason: override.override_reason,
            override_by: override.override_by,
            override_date: override.override_date
          };
        });
        
        // Create adjusted analytics with reduced override count
        const adjustedAnalytics = {
          ...analytics,
          validInspections: billingAnalytics.totalBillable,
          validationOverrideCount: freshOverrides.length
        };
        
        // Send updated data to App.js
        debugLog('UPDATE_WORKFLOW_STATS', '🚨 Calling onUpdateWorkflowStats from handleUndoOverride', {
          source: 'handleUndoOverride',
          analytics: adjustedAnalytics,
          validInspections: adjustedAnalytics.validInspections,
          timestamp: new Date().toISOString()
        });
        
        onUpdateWorkflowStats({
          jobId: jobData.id,
          analytics: adjustedAnalytics,
          billingAnalytics: billingAnalytics,
          validationReport: validationReport,
          missingPropertiesReport: missingPropertiesReport,
          validationOverrides: freshOverrides,
          overrideMap: freshOverrideMap,
          totalValidationOverrides: freshOverrides.length,
          lastProcessed: analytics.lastProcessed || new Date().toISOString()
        });
        
        debugLog('OVERRIDE', `✅ Override removed and App.js notified - new total: ${adjustedAnalytics.validInspections}`);
      }
      
      // Update component state immediately
      await calculateValidationOverrides(true);

      addNotification(`✅ Override removed - ${propertyKey} deleted from inspection_data`, 'success');
      addNotification('🔄 Reprocessing analytics to reflect changes...', 'info');

    } catch (error) {
      console.error('Error removing override:', error);
      addNotification('Error removing override: ' + error.message, 'error');
    }
  };

  // Override validation issue (single property with COMPLETE record)
  const handleOverrideValidation = async (property) => {
    // Use custom reason if "Other" is selected, otherwise use dropdown value
    const finalOverrideReason = overrideReason === 'Other' ? customOverrideReason : overrideReason;
    
    if (!finalOverrideReason || !property) {
      addNotification('Please provide an override reason', 'error');
      return;
    }

    try {
      // Get FULL property record from property_records using composite key
      const { data: fullPropertyRecord, error: fetchError } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .eq('property_composite_key', property.composite_key)
        .single();

      if (fetchError || !fullPropertyRecord) {
        throw new Error(`Could not find property record for ${property.composite_key}`);
      }

      // Build COMPLETE inspection_data record with ALL fields
      const completeOverrideRecord = {
        // Standard fields from property_records
        job_id: jobData.id,
        file_version: latestFileVersion,
        property_composite_key: fullPropertyRecord.property_composite_key,
        block: fullPropertyRecord.property_block,
        lot: fullPropertyRecord.property_lot,
        qualifier: fullPropertyRecord.property_qualifier || '',
        card: fullPropertyRecord.property_addl_card || '1',
        property_location: fullPropertyRecord.property_location || '',
        property_class: fullPropertyRecord.property_m4_class,
        measure_by: fullPropertyRecord.inspection_measure_by,
        measure_date: fullPropertyRecord.inspection_measure_date,
        info_by_code: fullPropertyRecord.inspection_info_by,
        list_by: fullPropertyRecord.inspection_list_by,
        list_date: fullPropertyRecord.inspection_list_date,
        price_by: fullPropertyRecord.inspection_price_by,
        price_date: fullPropertyRecord.inspection_price_date,
        
        // Module-specific fields
        project_start_date: projectStartDate,
        upload_date: new Date().toISOString(),
        
        // Override-specific fields
        override_applied: true,
        override_reason: finalOverrideReason,
        override_by: 'Manager',
        override_date: new Date().toISOString()
      };

      // UPSERT complete record to inspection_data
      const { error: upsertError } = await supabase
        .from('inspection_data')
        .upsert(completeOverrideRecord, {
          onConflict: 'property_composite_key'
        });

      if (upsertError) throw upsertError;

      // Close modal
      setShowOverrideModal(false);
      setSelectedOverrideProperty(null);
      setOverrideReason('New Construction');
      setCustomOverrideReason('');
      
      // Immediately reload validation overrides to get fresh data with all fields
      await calculateValidationOverrides(true); // Force fresh data fetch
      
      // Update App.js state immediately with the new override
      if (onUpdateWorkflowStats && analytics) {
        // Get fresh overrides for accurate count
        const freshOverrides = await getFreshValidationOverrides();
        const freshOverrideMap = {};
        freshOverrides.forEach(override => {
          freshOverrideMap[override.property_composite_key] = {
            override_applied: override.override_applied,
            override_reason: override.override_reason,
            override_by: override.override_by,
            override_date: override.override_date
          };
        });
        
        // Create adjusted analytics with new override count
        const adjustedAnalytics = {
          ...analytics,
          validInspections: billingAnalytics.totalBillable,
          validationOverrideCount: freshOverrides.length
        };
        
        // Send updated data to App.js
        debugLog('UPDATE_WORKFLOW_STATS', '🚨 Calling onUpdateWorkflowStats from handleOverrideValidation', {
          source: 'handleOverrideValidation',
          analytics: adjustedAnalytics,
          validInspections: adjustedAnalytics.validInspections,
          timestamp: new Date().toISOString()
        });
        
        onUpdateWorkflowStats({
          jobId: jobData.id,
          analytics: adjustedAnalytics,
          billingAnalytics: billingAnalytics,
          validationReport: validationReport,
          missingPropertiesReport: missingPropertiesReport,
          validationOverrides: freshOverrides,
          overrideMap: freshOverrideMap,
          totalValidationOverrides: freshOverrides.length,
          lastProcessed: analytics.lastProcessed || new Date().toISOString()
        });
        
        debugLog('OVERRIDE', `✅ Override created and App.js notified - new total: ${adjustedAnalytics.validInspections}`);
      }
      
      addNotification(`✅ Complete override record created: ${finalOverrideReason} for ${property.composite_key}`, 'success');
      addNotification('🔄 Reprocessing analytics with complete override...', 'info');

    } catch (error) {
      console.error('Error applying complete override:', error);
      addNotification('Error applying override: ' + error.message, 'error');
    }
  };

  // NEW: Handle override during processing modal
  const handleProcessingOverride = (propertyKey, reason) => {
    // Find the current validation item to get custom reason if needed
    const currentValidation = pendingValidations.find(v => v.composite_key === propertyKey);
    
    // Handle custom reason if needed
    const finalReason = reason === 'Other' ? 
      (currentValidation?.custom_override_reason || 'Other - No reason provided') : 
      reason;
    
    debugLog('PROCESSING_MODAL', `Setting override for ${propertyKey} with reason: ${finalReason}`);
    
    setProcessedValidationDecisions(prev => ({
      ...prev,
      [propertyKey]: {
        action: 'override',
        reason: finalReason,
        timestamp: new Date().toISOString()
      }
    }));
    
    // Update UI to show this property as overridden
    setPendingValidations(prev => 
      prev.map(val => 
        val.composite_key === propertyKey 
          ? { ...val, overridden: true, override_reason: finalReason }
          : val
      )
    );
  };

  // NEW: Skip validation issue during processing
  const handleProcessingSkip = (propertyKey) => {
    setProcessedValidationDecisions(prev => ({
      ...prev,
      [propertyKey]: {
        action: 'skip',
        timestamp: new Date().toISOString()
      }
    }));
    
    // Update UI to show this property as skipped
    setPendingValidations(prev => 
      prev.map(val => 
        val.composite_key === propertyKey 
          ? { ...val, skipped: true }
          : val
      )
    );
  };

  // NEW: Continue processing after validation decisions
  const continueProcessingAfterValidations = async () => {
    // Just unpause and resolve the promise to continue processing
    setProcessingPaused(false);
    // Call the stored resolve function to continue processAnalytics
    if (window._resolveProcessingModal) {
      window._resolveProcessingModal();
      window._resolveProcessingModal = null;
    }
  };

  // NEW: Close processing modal after everything is done
  const closeProcessingModal = () => {
    setPendingValidations([]);
    setProcessedValidationDecisions({});
    setShowProcessingModal(false);
    setProcessingComplete(false);
    addNotification('✅ Processing complete with validation decisions applied', 'success');
    
    // If overrides were applied, suggest reprocessing to update reports
    const overrideCount = Object.values(processedValidationDecisions).filter(d => d.action === 'override').length;
    if (overrideCount > 0) {
      addNotification(`��� ${overrideCount} overrides applied. Run processing again to update validation reports.`, 'info');
    }
  };

  // Reset session - Simply unlock InfoBy Config for editing without reloading data
  const resetSession = () => {
    setSessionId(null);
    setSettingsLocked(false);
    setProcessed(false);
    setAnalytics(null);
    setBillingAnalytics(null);
    setValidationReport(null);
    setCommercialCounts({ total: 0, inspected: 0, priced: 0 });
    setMissingPropertiesReport(null);
    setValidationOverrides([]);
    setOverrideMap({});
    setPendingValidations([]);
    setProcessedValidationDecisions({});
    setLoadedFromDatabase(false); // Reset database load flag
    setProcessingComplete(false);
    setCustomOverrideReason(''); // Reset custom override reason
    setCurrentValidationIndex(0); // Reset validation index
    // Don't reset hasInitialized to prevent re-initialization
    // hasInitialized.current = false;
    setLoading(false); // Keep loading false - don't reload data
    addNotification('🔄 Session reset - InfoBy Config unlocked for editing', 'info');
  };

// Initialize data loading
  useEffect(() => {
    // Don't re-initialize if we've already run or are currently processing
    if (hasInitialized.current || processing) {
      console.log('⏭️ Skipping initialization - already initialized or processing', {
        hasInitialized: hasInitialized.current,
        processing
      });
      return;
    }

    if (jobData?.id && properties && properties.length > 0 && inspectionData && employees) {
      const initializeData = async () => {
        hasInitialized.current = true; // Mark as initialized immediately

        // Load only the things that still need database calls
        await loadAvailableInfoByCodes();
        await loadProjectStartDate();
        await loadVendorSource();

        // Process from props instead of loading
        processEmployeeData();  // Uses employees prop
        await calculateValidationOverrides();  // Uses inspectionData prop initially
        calculateCommercialCounts();     // Uses inspectionData prop
        calculateUnassignedPropertyCount(); // Uses properties prop

        // Then load persisted analytics (which may need override data)
        await loadPersistedAnalytics();

        setLoading(false);
      };

      initializeData();
    }
  }, [jobData?.id, properties, inspectionData, employees, latestFileVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update employee data when external inspectors list changes
  useEffect(() => {
    if (employees && employees.length > 0) {
      processEmployeeData();
    }
  }, [externalInspectorsList, employees]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track unsaved changes
  useEffect(() => {
    const hasChanges = JSON.stringify(infoByCategoryConfig) !== JSON.stringify(originalCategoryConfig);
    setHasUnsavedChanges(hasChanges);
  }, [infoByCategoryConfig, originalCategoryConfig]);

  // Recalculate commercial counts when config or inspection data changes
  // BUT only for live preview - don't overwrite processed analytics!
  useEffect(() => {
    // Skip recalculation if we have processed analytics - use those values instead
    if (analytics || processed) {
      return;
    }

    if (inspectionData && inspectionData.length > 0 && infoByCategoryConfig.priced) {
      calculateCommercialCounts();
    }
  }, [inspectionData, infoByCategoryConfig.priced, analytics, processed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ENHANCED: Process analytics with manager-focused counting and inspection_data persistence
  const processAnalytics = async () => {
    if (!projectStartDate || !jobData?.id) {
      addNotification('Project start date and job data required', 'error');
      return null;
    }

    try {
      // Get actual vendor from property_records
      const actualVendor = await loadVendorSource();

      // Helper function to check if this is a primary card for billing
      const isPrimaryCard = (cardValue, vendor) => {
        if (!cardValue) return true; // If no card value, treat as primary (default '1')
        const card = String(cardValue).trim().toUpperCase();
        if (vendor === 'BRT') {
          return card === '1' || card === '';
        } else if (vendor === 'Microsystems') {
          return card === 'M' || card === '';
        }
        // Default: if vendor is unknown, count card 1 or M as primary
        return card === '1' || card === 'M' || card === '';
      };

      debugLog('ANALYTICS', 'Starting manager-focused analytics processing', {
        jobId: jobData.id,
        fileVersion: latestFileVersion,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig,
        detectedVendor: actualVendor,
        hasAssignments: jobData.has_property_assignments // Log assignment status
      });

      // CRITICAL CHECK: Verify pricing config is loaded for Microsystems
      if (actualVendor === 'Microsystems') {
        if (!infoByCategoryConfig.priced || infoByCategoryConfig.priced.length === 0) {
          console.error('CRITICAL: No pricing codes configured for Microsystems job');
          addNotification('ERROR: Pricing codes not configured. Please configure InfoBy categories first.', 'error');
          return null;
        }
      }

      // Get all valid InfoBy codes for validation
      const allValidCodes = [
        ...(infoByCategoryConfig.entry || []),
        ...(infoByCategoryConfig.refusal || []),
        ...(infoByCategoryConfig.estimation || []),
        ...(infoByCategoryConfig.priced || []),
        ...(infoByCategoryConfig.special || []) // Include special codes as valid
      ];

      // Load existing validation overrides FIRST, before processing
      debugLog('ANALYTICS', 'Loading existing validation overrides...');
      const { data: existingOverrides, error: overrideError } = await supabase
        .from('inspection_data')
        .select('property_composite_key, override_applied, override_reason')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .eq('override_applied', true);

      if (overrideError) {
        console.warn('Could not load existing overrides:', overrideError);
      }

      // Create override lookup map for fast checking
      const overrideMapData = {};
      (existingOverrides || []).forEach(override => {
        overrideMapData[override.property_composite_key] = {
          override_applied: override.override_applied,
          override_reason: override.override_reason
        };
      });
      
      // Set override map in component state for UI access
      setOverrideMap(overrideMapData);
      setValidationOverrides(existingOverrides || []);
      
      debugLog('ANALYTICS', `Loaded ${existingOverrides?.length || 0} existing validation overrides`);

      // Use properties from props but will join with inspectionData for current info_by_code
      const rawData = properties;
      debugLog('ANALYTICS', `✅ Using ${rawData?.length || 0} property records from props for analysis`);

      // Create lookup map from inspectionData for current info_by_code values
      const inspectionDataMap = {};
      if (inspectionData && inspectionData.length > 0) {
        inspectionData.forEach(insp => {
          inspectionDataMap[insp.property_composite_key] = insp.info_by_code;
        });
      } else {
        console.error('❌ NO INSPECTION DATA AVAILABLE FOR LOOKUP MAP!');
      }

      // Validate properties data exists
      if (!rawData || rawData.length === 0) {
        console.error('ERROR: No properties received by Production Tracker');
        addNotification('ERROR: No properties data received. Check JobContainer.', 'error');
        return null;
      }

      // Validate dataset exists
      
      // Show notification if large dataset
      if (rawData.length > 5000) {
        addNotification(`Processing ${rawData.length.toLocaleString()} properties...`, 'info');
      }

      const startDate = new Date(projectStartDate);
      const inspectorStats = {};
      const classBreakdown = {};
      const billingByClass = {};
      const propertyIssues = {};
      const inspectorIssuesMap = {};
      const inspectionDataBatch = []; // For inspection_data UPSERT
      const inspectionDataKeys = new Set(); // Track composite keys to prevent duplicates
      const missingProperties = []; // Track properties not added to inspection_data
      const pendingValidationsList = []; // NEW: Collect validation issues for modal

      // Initialize class counters - Count ALL properties for denominators
      const allClasses = ['1', '2', '3A', '3B', '4A', '4B', '4C', '15A', '15B', '15C', '15D', '15E', '15F', '5A', '5B', '6A', '6B'];
      allClasses.forEach(cls => {
        classBreakdown[cls] = { total: 0, inspected: 0, entry: 0, refusal: 0, priced: 0 };
        billingByClass[cls] = { total: 0, inspected: 0, billable: 0 };
      });

      // DEBUG: Track processing counts
      let processedCount = 0;
      let validInspectionCount = 0;
      let skippedReasons = {};

      rawData.forEach((record, index) => {
        processedCount++;

        const propertyKey = record.property_composite_key;
        const inspector = record.inspection_measure_by || 'UNASSIGNED';
        const propertyClass = record.property_m4_class || 'UNKNOWN';
        // Always use fresh info_by_code from property_records (source of truth from file updates)
        // inspection_data is just a validated snapshot - property_records has the latest vendor data
        const infoByCode = record.inspection_info_by;

        const measuredDate = record.inspection_measure_date ? new Date(record.inspection_measure_date) : null;
        const listDate = record.inspection_list_date ? new Date(record.inspection_list_date) : null;
        const priceDate = record.inspection_price_date ? new Date(record.inspection_price_date) : null;

        // Track this property's processing status
        let wasAddedToInspectionData = false;
        let reasonNotAdded = '';

        // Always count ALL properties for denominators (manager progress view)
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // Check for existing validation override FIRST
        const hasValidationOverride = overrideMapData[propertyKey]?.override_applied;

        if (hasValidationOverride) {
          debugLog('VALIDATION', `✅ Property ${propertyKey} has existing override - preserving override status`);
          
          // Count overridden properties as VALID INSPECTIONS for progress tracking
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            // Only count primary cards (1 for BRT, M for Microsystems) for billing
            const cardValue = record.property_addl_card || '1';
            if (isPrimaryCard(cardValue, actualVendor)) {
              billingByClass[propertyClass].billable++;
            }
          }

          // Initialize inspector stats for overridden properties
          if (!inspectorStats[inspector] && employeeData[inspector]) {
            const employeeInfo = employeeData[inspector] || {};
            inspectorStats[inspector] = {
              name: employeeInfo.name || inspector,
              fullName: employeeInfo.fullName || inspector,
              inspector_type: employeeInfo.inspector_type,
              totalInspected: 0,
              residentialInspected: 0,
              commercialInspected: 0,
              entry: 0,
              refusal: 0,
              priced: 0,
              allWorkDays: new Set(),
              residentialWorkDays: new Set(),
              commercialWorkDays: new Set(),
              pricingWorkDays: new Set()
            };
            inspectorIssuesMap[inspector] = [];
          }

          // Count overridden properties toward inspector totals
          if (inspectorStats[inspector]) {
            inspectorStats[inspector].totalInspected++;
            
            // Add to work days if we have a valid date
            if (measuredDate) {
              const workDayString = measuredDate.toISOString().split('T')[0];
              inspectorStats[inspector].allWorkDays.add(workDayString);
              
              const isResidentialProperty = ['2', '3A'].includes(propertyClass);
              const isCommercialProperty = ['4A', '4B', '4C'].includes(propertyClass);
              
              if (isResidentialProperty) {
                inspectorStats[inspector].residentialInspected++;
                inspectorStats[inspector].residentialWorkDays.add(workDayString);
              }
              
              if (isCommercialProperty) {
                inspectorStats[inspector].commercialInspected++;
                inspectorStats[inspector].commercialWorkDays.add(workDayString);
              }
            }
          }

          // Add to inspection_data batch WITH UPDATED DATA but preserve override fields
          const inspectionRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            measure_by: inspector,
            measure_date: record.inspection_measure_date,
            info_by_code: infoByCode,
            list_by: record.inspection_list_by,
            list_date: record.inspection_list_date,
            price_by: record.inspection_price_by,
            price_date: record.inspection_price_date,
            project_start_date: projectStartDate,
            upload_date: new Date().toISOString(),
            override_applied: true,
            override_reason: overrideMapData[propertyKey].override_reason
          };

          // Only add if we haven't already added this property to the batch
          if (!inspectionDataKeys.has(propertyKey)) {
            inspectionDataBatch.push(inspectionRecord);
            inspectionDataKeys.add(propertyKey);
            wasAddedToInspectionData = true;
          }
          
          // Skip to next property - NO validation needed, NO missing properties report
          return;
        }

        // Check for any inspection attempt at all
        // Check for the three core inspection fields
        const hasInfoBy = record.inspection_info_by;
        const hasMeasureBy = record.inspection_measure_by && record.inspection_measure_by.trim() !== '';
        const hasMeasureDate = record.inspection_measure_date;


        // FIXED: Separate "not yet inspected" from "attempted but failed validation"
        // If NO inspection attempt at all (no inspector AND no date), mark as "not yet inspected"
        if (!hasMeasureBy && !hasMeasureDate) {
          reasonNotAdded = hasInfoBy ?
            'Info_by code only - missing inspector and measure date' :
            'Not yet inspected';

          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: '',
            info_by_code: '',
            measure_date: null,
            validation_issues: []
          });
          return;
        }

        // If we get here, there was SOME inspection attempt (inspector OR date exists)
        // Continue processing to validate the attempt - don't early return

        // Skip inspections before project start date (removes old inspector noise)
        if (measuredDate && measuredDate < startDate) {
          reasonNotAdded = `Old inspection (${measuredDate.toLocaleDateString()}) - before project start`;
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Check if inspector is external
        const externalInspectors = externalInspectorsList.split(',').map(code => code.trim()).filter(code => code);
        const isExternalInspector = externalInspectors.includes(inspector);
        
        // Skip inspectors with invalid initials (not in employee database)
        if (!employeeData[inspector] && !isExternalInspector) {
          reasonNotAdded = `Inspector ${inspector} not found in employee database`;
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            reason: reasonNotAdded,
            inspector: inspector,
            info_by_code: infoByCode,
            measure_date: record.inspection_measure_date,
            validation_issues: []
          });
          return;
        }

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
          let employeeInfo = employeeData[inspector] || {};
          
          // If not in employeeData, check if external inspector
          if (!employeeData[inspector] && isExternalInspector) {
            employeeInfo = {
              name: `${inspector} (External)`,
              fullName: `${inspector} (External Inspector)`,
              inspector_type: 'external'
            };
          }
          inspectorStats[inspector] = {
            name: employeeInfo.name || inspector,
            fullName: employeeInfo.fullName || inspector,
            inspector_type: employeeInfo.inspector_type,
            totalInspected: 0,
            residentialInspected: 0,
            commercialInspected: 0,
            entry: 0,
            refusal: 0,
            priced: 0,
            allWorkDays: new Set(),
            residentialWorkDays: new Set(),
            commercialWorkDays: new Set(),
            pricingWorkDays: new Set()
          };
          inspectorIssuesMap[inspector] = [];
        }

        // Validate attempted inspections
        let isValidInspection = true;
        let hasValidMeasuredBy = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        let hasValidMeasuredDate = measuredDate && measuredDate >= startDate;
        let normalizedInfoBy = actualVendor === 'BRT' ? infoByCode?.toString().padStart(2, '0') : infoByCode;

        // Vendor-specific validation logic - no padding for Microsystems!
        let hasValidInfoBy;
        
        if (actualVendor === 'BRT') {
          // BRT: Use padding for numeric codes (01, 02, 06, etc.)
          normalizedInfoBy = infoByCode?.toString().padStart(2, '0');
          const normalizedValidCodes = allValidCodes.map(code => code.toString().padStart(2, '0'));
          hasValidInfoBy = normalizedInfoBy && normalizedValidCodes.includes(normalizedInfoBy);
        } else if (actualVendor === 'Microsystems') {
          // Microsystems: Direct string comparison for alphabetical codes (A, O, R, V, N, etc.)
          normalizedInfoBy = infoByCode; // No padding for Microsystems
          hasValidInfoBy = infoByCode && allValidCodes.includes(infoByCode);
        } else {
          // Fallback: try both approaches
          normalizedInfoBy = infoByCode?.toString().padStart(2, '0');
          const normalizedValidCodes = allValidCodes.map(code => code.toString().padStart(2, '0'));
          hasValidInfoBy = (infoByCode && allValidCodes.includes(infoByCode)) || 
                          (normalizedInfoBy && normalizedValidCodes.includes(normalizedInfoBy));
        }
        
        // Compound validation messages per property
        const addValidationIssue = (message) => {
          if (!propertyIssues[propertyKey]) {
            propertyIssues[propertyKey] = {
              block: record.property_block,
              lot: record.property_lot,
              qualifier: record.property_qualifier || '',
              card: record.property_addl_card,
              property_location: record.property_location || '',
              inspector: inspector,
              issues: []
            };
          }
          propertyIssues[propertyKey].issues.push(message);
          isValidInspection = false;
        };

        // Core validation rules
        if (!hasValidInfoBy) {
          addValidationIssue(`Invalid InfoBy code: ${infoByCode}`);
        }
        if (!hasValidMeasuredBy) {
          addValidationIssue('Missing or invalid inspector');
        }
        if (!hasValidMeasuredDate) {
          addValidationIssue('Missing or invalid measure date');
        }

        // Business logic validation - ENHANCED for special codes
        const isEntryCode = (infoByCategoryConfig.entry || []).includes(normalizedInfoBy) || (infoByCategoryConfig.entry || []).includes(infoByCode);
        const isRefusalCode = (infoByCategoryConfig.refusal || []).includes(normalizedInfoBy) || (infoByCategoryConfig.refusal || []).includes(infoByCode);
        const isEstimationCode = (infoByCategoryConfig.estimation || []).includes(normalizedInfoBy) || (infoByCategoryConfig.estimation || []).includes(infoByCode);
        const isPricedCode = (infoByCategoryConfig.priced || []).includes(normalizedInfoBy) || (infoByCategoryConfig.priced || []).includes(infoByCode);
        const isSpecialCode = (infoByCategoryConfig.special || []).includes(normalizedInfoBy) || (infoByCategoryConfig.special || []).includes(infoByCode);

        // DEBUG: Log pricing code detection for commercial properties
        if (['4A', '4B', '4C'].includes(propertyClass) && actualVendor === 'Microsystems') {
          debugLog('PRICING', `Commercial ${propertyKey}: InfoBy=${infoByCode}, isPriced=${isPricedCode}, config=${JSON.stringify(infoByCategoryConfig.priced)}`);
        }
        const hasListingData = record.inspection_list_by && record.inspection_list_date;
        // NEW: List_by/List_date integrity validation
        const listByValue = record.inspection_list_by;
        const listDateValue = record.inspection_list_date;
        const parsedListDate = listDateValue ? new Date(listDateValue) : null;
        
        // Check for list_by with invalid employee or invalid date
        if (listByValue && listByValue.trim() !== '') {
          // Check if list_by is valid employee
          if (!employeeData[listByValue]) {
            addValidationIssue(`Invalid list_by employee: ${listByValue}`);
          }
          // Check for missing or old date
          if (!parsedListDate) {
            addValidationIssue('Has list_by but missing list_date');
          } else if (parsedListDate < startDate) {
            addValidationIssue(`Has list_by but old list_date (${parsedListDate.toLocaleDateString()})`);
          }
        }
        
        // Check for list_date without list_by
        if (parsedListDate && parsedListDate >= startDate && (!listByValue || listByValue.trim() === '')) {
          addValidationIssue('Has valid list_date but missing list_by');
        }
                  
        // Skip validation for special codes (V, N) - they're valid but don't need validation reports
        if (isSpecialCode) {
          // Special codes are valid inspections but bypass all validation rules
          debugLog('VALIDATION', `Special code ${infoByCode} found - skipping validation rules`);
        } else {
          // Regular validation rules for non-special codes
          if (isRefusalCode && !hasListingData) {
            addValidationIssue(`Refusal code ${infoByCode} but missing listing data`);
          }
          if (isEntryCode && !hasListingData) {
            addValidationIssue(`Entry code ${infoByCode} but missing listing data`);
          }
          if (isEstimationCode && hasListingData) {
            addValidationIssue(`Estimation code ${infoByCode} but has listing data`);
          }
        }

        // Corrected inspector type validation
        const isCommercialProperty = ['4A', '4B', '4C'].includes(propertyClass);
        const isResidentialProperty = ['2', '3A'].includes(propertyClass);
        const isResidentialInspector = employeeData[inspector]?.inspector_type === 'residential';
        
        // Residential inspectors CAN'T do commercial (4A, 4B, 4C) - everything else is OK
        if (isCommercialProperty && isResidentialInspector) {
          addValidationIssue(`Residential inspector on commercial property`);
        }

        // Zero improvement validation
        if (record.values_mod_improvement === 0 && !hasListingData) {
          addValidationIssue('Zero improvement property missing listing data');
        }
        
        // NEW: BRT Pricing validation (only for BRT vendor)
        if (actualVendor === 'BRT') {
          const priceByValue = record.inspection_price_by;
          const priceDateValue = record.inspection_price_date;
          const parsedPriceDate = priceDateValue ? new Date(priceDateValue) : null;
          
          // Check for price_by with invalid employee or invalid date
          if (priceByValue && priceByValue.trim() !== '') {
            // Check if price_by is valid employee
            if (!employeeData[priceByValue]) {
              addValidationIssue(`Invalid price_by employee: ${priceByValue}`);
            }
            // Check for missing or old date
            if (!parsedPriceDate) {
              addValidationIssue('Has price_by but missing price_date');
            } else if (parsedPriceDate < startDate) {
              addValidationIssue(`Has price_by but old price_date (${parsedPriceDate.toLocaleDateString()})`);
            }
          }
          
          // Check for price_date without price_by
          if (parsedPriceDate && parsedPriceDate >= startDate && (!priceByValue || priceByValue.trim() === '')) {
            addValidationIssue('Has valid price_date but missing price_by');
          }
        }
        
        // NEW: Collect validation issues for processing modal
        if (!isValidInspection && propertyIssues[propertyKey]) {
          pendingValidationsList.push({
            property: record,
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            inspector: inspector,
            issues: propertyIssues[propertyKey].issues,
            warning_message: propertyIssues[propertyKey].issues.join(' | ')
          });
        }

        // Process valid inspections - ONLY count if ALL 3 criteria are met
        if (isValidInspection && hasValidInfoBy && hasValidMeasuredBy && hasValidMeasuredDate) {
          validInspectionCount++;

          // Count for manager progress (valid inspections against total properties)
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            // Only count primary cards (1 for BRT, M for Microsystems) for billing
            const cardValue = record.property_addl_card || '1';
            if (isPrimaryCard(cardValue, actualVendor)) {
              billingByClass[propertyClass].billable++;
            }
          }

          // Inspector analytics - count valid inspections only
          inspectorStats[inspector].totalInspected++;

          const workDayString = measuredDate.toISOString().split('T')[0];
          inspectorStats[inspector].allWorkDays.add(workDayString);

          // Separate residential and commercial counting for analytics
          if (isResidentialProperty) {
            inspectorStats[inspector].residentialInspected++;
            inspectorStats[inspector].residentialWorkDays.add(workDayString);

            // Individual inspector credit: measure_by must equal list_by for personal achievement
            if (isEntryCode && record.inspection_list_by === inspector) {
              inspectorStats[inspector].entry++;
            } else if (isRefusalCode && record.inspection_list_by === inspector) {
              inspectorStats[inspector].refusal++;
            }

            // Global metrics: count ALL valid entries/refusals regardless of who did list work
            if (isEntryCode && classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].entry++;
            } else if (isRefusalCode && classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].refusal++;
            }
          }

          if (isCommercialProperty) {
            inspectorStats[inspector].commercialInspected++;
            inspectorStats[inspector].commercialWorkDays.add(workDayString);
          }

          // Pricing logic with vendor detection
          if (isCommercialProperty) {
            const currentVendor = actualVendor || jobData.vendor_type;

            if (currentVendor === 'BRT' &&
                record.inspection_price_by &&
                record.inspection_price_by.trim() !== '' &&
                priceDate &&
                priceDate >= startDate) {

              inspectorStats[inspector].priced++;
              inspectorStats[inspector].pricingWorkDays.add(priceDate.toISOString().split('T')[0]);
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].priced++;
              }

            } else if (currentVendor === 'Microsystems' && isPricedCode) {
              inspectorStats[inspector].priced++;
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].priced++;
              }
            }
          }

          // Prepare for inspection_data UPSERT
          const inspectionRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card,
            property_location: record.property_location || '',
            property_class: propertyClass,
            measure_by: inspector,
            measure_date: record.inspection_measure_date,
            info_by_code: infoByCode,
            list_by: record.inspection_list_by,
            list_date: record.inspection_list_date,
            price_by: record.inspection_price_by,
            price_date: record.inspection_price_date,
            project_start_date: projectStartDate,
            upload_date: new Date().toISOString(),
          };

          // Add to batch - UPSERT will handle whether to insert or update
          if (!inspectionDataKeys.has(propertyKey)) {
            inspectionDataBatch.push(inspectionRecord);
            inspectionDataKeys.add(propertyKey);
            wasAddedToInspectionData = true;
          }
        }

        // Track properties that didn't make it to inspection_data
        if (!wasAddedToInspectionData) {
          // Check if this property was already categorized as "Not yet inspected" earlier
          const alreadyAddedAsNotInspected = missingProperties.some(p =>
            p.composite_key === propertyKey &&
            (p.reason === 'Not yet inspected' || p.reason.includes('Info_by code only'))
          );

          if (!alreadyAddedAsNotInspected) {
            // This property had some inspection attempt but failed validation
            const reasons = [];
            if (!hasValidInfoBy) reasons.push(`Invalid InfoBy code: ${infoByCode}`);
            if (!hasValidMeasuredBy) reasons.push('Missing/invalid inspector');
            if (!hasValidMeasuredDate) reasons.push('Missing/invalid measure date');
            if (propertyIssues[propertyKey]?.issues) reasons.push(...propertyIssues[propertyKey].issues);

            reasonNotAdded = `Failed validation: ${reasons.join(', ')}`;

            missingProperties.push({
              composite_key: propertyKey,
              block: record.property_block,
              lot: record.property_lot,
              qualifier: record.property_qualifier || '',
              property_location: record.property_location || '',
              property_class: propertyClass,
              reason: reasonNotAdded,
              inspector: inspector,
              info_by_code: infoByCode,
              measure_date: record.inspection_measure_date,
              validation_issues: propertyIssues[propertyKey]?.issues || []
            });
          }
        }
      });

      // Process ALL records first - collect validation issues and valid records
      debugLog('ANALYTICS', `Finished processing ${rawData.length} records. Found ${pendingValidationsList.length} validation issues.`);

      // Initialize decisionsToApply array before the modal processing
      let decisionsToApply = [];
      
      if (pendingValidationsList.length > 0) {
        debugLog('PROCESSING_MODAL', `Found ${pendingValidationsList.length} validation issues - showing modal`);
        setPendingValidations(pendingValidationsList);
        setShowProcessingModal(true);
        setProcessingPaused(true);
        
        // Create a promise that will resolve when user clicks Continue Processing
        const waitForUserDecision = new Promise((resolve) => {
          // Store the resolve function so we can call it later
          window._resolveProcessingModal = resolve;
        });
        
        debugLog('PROCESSING_MODAL', 'Waiting for user validation decisions...');
        
        // Wait for the user to click Continue Processing
        await waitForUserDecision;
        
        debugLog('PROCESSING_MODAL', 'User completed validation review, applying decisions...');
        
        // Apply decisions from modal
        pendingValidationsList.forEach(validation => {
          const decision = processedValidationDecisions[validation.composite_key];
          if (decision && decision.action === 'override') {
            decisionsToApply.push({
              property: validation.property,
              composite_key: validation.composite_key,
              override_reason: decision.reason
            });
          }
        });
        
        // Apply overrides to inspection_data
        for (const override of decisionsToApply) {
          // Check if this property is already in the batch (shouldn't be, but let's be safe)
          if (inspectionDataKeys.has(override.composite_key)) {
            debugLog('PROCESSING_MODAL', `⚠️ Property ${override.composite_key} already in batch, skipping duplicate`);
            continue;
          }
          
          // Get the full property record to ensure we have all fields
          const fullRecord = rawData.find(r => r.property_composite_key === override.composite_key);
          if (!fullRecord) {
            debugLog('PROCESSING_MODAL', `⚠️ Could not find full record for ${override.composite_key}`);
            continue;
          }
          
          const overrideRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: override.composite_key,
            block: fullRecord.property_block,
            lot: fullRecord.property_lot,
            qualifier: fullRecord.property_qualifier || '',
            card: fullRecord.property_addl_card || '1',
            property_location: fullRecord.property_location || '',
            property_class: fullRecord.property_m4_class,
            measure_by: fullRecord.inspection_measure_by,
            measure_date: fullRecord.inspection_measure_date,
            info_by_code: fullRecord.inspection_info_by,
            list_by: fullRecord.inspection_list_by,
            list_date: fullRecord.inspection_list_date,
            price_by: fullRecord.inspection_price_by,
            price_date: fullRecord.inspection_price_date,
            project_start_date: projectStartDate,
            upload_date: new Date().toISOString(),
            override_applied: true,
            override_reason: override.override_reason,
            override_by: 'Manager',
            override_date: new Date().toISOString()
          };
          
          inspectionDataBatch.push(overrideRecord);
          inspectionDataKeys.add(override.composite_key);
          
          // Update counts
          const propertyClass = fullRecord.property_m4_class;
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            // Only count primary cards (1 for BRT, M for Microsystems) for billing
            const cardValue = fullRecord.property_addl_card || '1';
            if (isPrimaryCard(cardValue, actualVendor)) {
              billingByClass[propertyClass].billable++;
            }
          }
          
          debugLog('PROCESSING_MODAL', `Added override for ${override.composite_key} with reason: ${override.override_reason}`);
        }
        
        debugLog('PROCESSING_MODAL', `Applied ${decisionsToApply.length} overrides from modal decisions`);
      }

      // NOW do ONE SINGLE UPSERT for ALL records (valid + overrides)
      if (inspectionDataBatch.length > 0) {
        debugLog('PERSISTENCE', `Upserting ${inspectionDataBatch.length} records to inspection_data (includes ${decisionsToApply.length} overrides)`);
        
        try {
          const { error: upsertError } = await supabase
            .from('inspection_data')
            .upsert(inspectionDataBatch, {
              onConflict: 'property_composite_key'  // Use just property_composite_key if that's the unique constraint
            });

          if (upsertError) {
            console.error('Error upserting to inspection_data:', upsertError);
            addNotification(`Error saving to inspection_data: ${upsertError.message}`, 'error');
          } else {
            
            debugLog('PERSISTENCE', '✅ Successfully upserted ALL records to inspection_data');
            addNotification(`✅ Successfully saved ${inspectionDataBatch.length} records to inspection_data`, 'success');
            
             // Recalculate override and commercial data after successful save
            await calculateValidationOverrides(true); // Force fresh data fetch
            calculateCommercialCounts();
            
            // Log override success if any were applied
            if (decisionsToApply.length > 0) {  // CHANGED: Use decisionsToApply.length instead
              debugLog('PERSISTENCE', `✅ Successfully applied ${decisionsToApply.length} validation overrides`);
              addNotification(`✅ Applied ${decisionsToApply.length} validation overrides`, 'success');
            }
          }
        } catch (error) {
          console.error('UPSERT Error:', error);
          addNotification('Failed to save inspection data', 'error');
        }
      }

      // Calculate inspector rates and averages with corrected field day logic
      Object.keys(inspectorStats).forEach(inspector => {
        const stats = inspectorStats[inspector];
        
        // Convert Sets to counts
        stats.fieldDays = stats.allWorkDays.size;
        stats.residentialFieldDays = stats.residentialWorkDays.size;
        stats.commercialFieldDays = stats.commercialWorkDays.size;
        stats.pricingDays = stats.pricingWorkDays.size;
        
        // Entry/Refusal rates (only for residential properties 2, 3A)
        if (stats.residentialInspected > 0) {
          stats.entryRate = Math.round((stats.entry / stats.residentialInspected) * 100);
          stats.refusalRate = Math.round((stats.refusal / stats.residentialInspected) * 100);
        } else {
          stats.entryRate = 0;
          stats.refusalRate = 0;
        }

        // Type-specific daily averages
        if (stats.inspector_type?.toLowerCase() === 'residential') {
          // Residential daily average: Residential work ÷ Residential field days
          stats.dailyAverage = stats.residentialFieldDays > 0 ? 
            Math.round(stats.residentialInspected / stats.residentialFieldDays) : 0;
        } else if (stats.inspector_type?.toLowerCase() === 'commercial') {
          // Commercial daily average: Commercial work ÷ Commercial field days
          stats.commercialAverage = stats.commercialFieldDays > 0 ? 
            Math.round(stats.commercialInspected / stats.commercialFieldDays) : 0;
          // Pricing average (BRT only)
          const currentVendor = actualVendor || jobData.vendor_type;
          if (currentVendor === 'BRT') {
            stats.pricingAverage = stats.pricingDays > 0 ? 
              Math.round(stats.priced / stats.pricingDays) : 0;
          } else {
            stats.pricingAverage = null;
          }
        } else if (stats.inspector_type?.toLowerCase() === 'management') {
          // Management inspector - general daily average using all work
          stats.dailyAverage = stats.fieldDays > 0 ? 
            Math.round(stats.totalInspected / stats.fieldDays) : 0;
        }

        // Clean up Sets
        delete stats.allWorkDays;
        delete stats.residentialWorkDays;
        delete stats.commercialWorkDays;
        delete stats.pricingWorkDays;
      });

      // Create compound validation report
      const validationIssues = [];
      Object.keys(propertyIssues).forEach(propertyKey => {
        const property = propertyIssues[propertyKey];
        const compoundMessage = property.issues.join(' | ');
        
        const issue = {
          block: property.block,
          lot: property.lot,
          qualifier: property.qualifier,
          card: property.card,
          property_location: property.property_location,
          warning_message: compoundMessage,
          inspector: property.inspector,
          severity: property.issues.length > 2 ? 'high' : 'medium',
          composite_key: propertyKey
        };
        
        validationIssues.push(issue);
        
        if (!inspectorIssuesMap[property.inspector]) {
          inspectorIssuesMap[property.inspector] = [];
        }
        inspectorIssuesMap[property.inspector].push(issue);
      });

      // Calculate job-level totals (totalInspected already calculated above)

      // Calculate job-level totals
      const totalInspected = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.totalInspected, 0);
      
      // FIX: CORRECT GLOBAL ENTRY RATE CALCULATION
      // Use classBreakdown totals, NOT inspector stats
      const totalClass2And3AProperties = (classBreakdown['2']?.total || 0) + (classBreakdown['3A']?.total || 0);
      const totalEntry = (classBreakdown['2']?.entry || 0) + (classBreakdown['3A']?.entry || 0);
      const totalRefusal = (classBreakdown['2']?.refusal || 0) + (classBreakdown['3A']?.refusal || 0);

      // Commercial percentage calculations (valid ÷ total, not valid ÷ valid)
      const totalCommercialProperties = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.total || 0), 0);
      const totalCommercialInspected = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.inspected || 0), 0);
      const totalPriced = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);

      // FIX: Use classBreakdown for commercial pricing (fresh data from processing loop)
      // NOT commercialCounts.priced which uses stale inspectionData prop
      const totalCommercialPriced = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.priced || 0), 0);

      const validationReportData = {
        summary: {
          total_inspectors: Object.keys(inspectorIssuesMap).filter(k => inspectorIssuesMap[k].length > 0).length,
          total_issues: validationIssues.length,
          inspector_breakdown: Object.keys(inspectorIssuesMap)
            .filter(inspector => inspectorIssuesMap[inspector].length > 0)
            .map(inspector => ({
              inspector_code: inspector,
              inspector_name: inspectorStats[inspector]?.fullName || inspector,
              total_issues: inspectorIssuesMap[inspector].length
            }))
        },
        detailed_issues: inspectorIssuesMap
      };

      // Create missing properties report
      const missingPropertiesReportData = {
        summary: {
          total_missing: missingProperties.length,
          not_yet_inspected: missingProperties.filter(p => p.reason === 'Not yet inspected').length,
          old_inspections: missingProperties.filter(p => p.reason.includes('Old inspection')).length,
          validation_failed_count: missingProperties.filter(p => p.reason.includes('Failed validation')).length,
          missing_inspector: missingProperties.filter(p => p.reason === 'Missing inspector initials').length,
          invalid_employee: missingProperties.filter(p => p.reason.includes('not found in employee database')).length,
          by_reason: missingProperties.reduce((acc, prop) => {
            const reason = prop.reason;
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          }, {}),
          by_inspector: missingProperties.reduce((acc, prop) => {
            const inspector = prop.inspector || 'None';
            acc[inspector] = (acc[inspector] || 0) + 1;
            return acc;
          }, {})
        },
        detailed_missing: missingProperties
      };

      // Final analytics result with correct entry rate
      const analyticsResult = {
        totalRecords: rawData.length,
        validInspections: totalInspected + decisionsToApply.length, // Include modal overrides
        inspectorStats,
        classBreakdown,
        validationIssues: validationIssues.length,
        processingDate: new Date().toISOString(),
        
        // FIX: Use classBreakdown totals for global rates
        jobEntryRate: totalClass2And3AProperties > 0 ? Math.round((totalEntry / totalClass2And3AProperties) * 100) : 0,
        jobRefusalRate: totalClass2And3AProperties > 0 ? Math.round((totalRefusal / totalClass2And3AProperties) * 100) : 0,
        
        // Commercial metrics using class breakdown for accuracy
        commercialInspections: totalCommercialInspected,
        commercialPricing: totalCommercialPriced,
        totalCommercialProperties,
        commercialCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialInspected / totalCommercialProperties) * 100) : 0,
        pricingCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialPriced / totalCommercialProperties) * 100) : 0,
        
        // Track overrides applied during processing
        overridesAppliedCount: decisionsToApply.length
      };

      // Billing analytics with progress calculations
      const billingResult = {
        byClass: billingByClass,
        grouped: {
          commercial: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          exempt: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          railroad: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          personalProperty: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
        },
        progressData: {
          commercial: {
            total: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          exempt: {
            total: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          railroad: {
            total: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          },
          personalProperty: {
            total: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.total || 0), 0),
            billable: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
          }
        },
        totalBillable: Object.values(billingByClass).reduce((sum, cls) => sum + cls.billable, 0)
      };

      // Set all the state with potentially adjusted values
      setAnalytics(analyticsResult);
      setBillingAnalytics(billingResult);
      setValidationReport(validationReportData);
      setMissingPropertiesReport(missingPropertiesReportData);
      
      // Recalculate validation overrides to show the new ones from processing modal
      await calculateValidationOverrides(true); // Force fresh data fetch

      // DON'T clear modal state here - wait for user to close it
      // setPendingValidations([]);
      // setProcessedValidationDecisions({});
      // setShowProcessingModal(false);
      
      // Mark processing as complete so the modal shows the close button
      setProcessingComplete(true);
      setProcessingPaused(false);

      debugLog('ANALYTICS', '✅ Manager-focused analytics processing complete', {
        totalRecords: rawData.length,
        validInspections: analyticsResult.validInspections,
        totalIssues: validationIssues.length,
        inspectors: Object.keys(inspectorStats).length,
        commercialComplete: analyticsResult.commercialCompletePercent,
        pricingComplete: analyticsResult.pricingCompletePercent,
        persistedRecords: inspectionDataBatch.length,
        jobEntryRate: analyticsResult.jobEntryRate,
        totalClass2And3AProperties,
        hasAssignments: jobData.has_property_assignments
      });

      return { analyticsResult, billingResult, validationReportData, missingPropertiesReportData };

    } catch (error) {
      console.error('Error processing analytics:', error);
      addNotification('Error processing analytics: ' + error.message, 'error');
      return null;
    }
  };

  // Handle InfoBy category assignment
  const handleCategoryAssignment = (category, code, isAssigned) => {
    if (settingsLocked) return;
    
    const newConfig = {
      ...infoByCategoryConfig,
      [category]: isAssigned 
        ? infoByCategoryConfig[category].filter(c => c !== code)
        : [...infoByCategoryConfig[category], code]
    };
    
    setInfoByCategoryConfig(newConfig);
  };

  // Get fresh override data
  const getFreshValidationOverrides = async () => {
    if (!jobData?.id || !latestFileVersion) return [];
    
    try {
      const { data: currentOverrides, error } = await supabase
        .from('inspection_data')
        .select('*')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .eq('override_applied', true);
        
      if (error) {
        console.error('Error fetching fresh overrides:', error);
        return [];
      }
      
      return currentOverrides || [];
    } catch (error) {
      console.error('Error in getFreshValidationOverrides:', error);
      return [];
    }
  };

  // Sync validation overrides to current file version to prevent duplicate key errors
  const syncOverridesToCurrentVersion = async () => {
    try {
      console.log('🔄 Syncing validation overrides to current file version...');
      
      // Get count of overrides that need syncing
      const { count, error: countError } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobData.id)
        .eq('override_applied', true)
        .lt('file_version', latestFileVersion);
      
      if (countError) throw countError;
      
      if (count > 0) {
        // Update them all to current version
        const { error: updateError } = await supabase
          .from('inspection_data')
          .update({ 
            file_version: latestFileVersion,
            upload_date: new Date().toISOString()
          })
          .eq('job_id', jobData.id)
          .eq('override_applied', true)
          .lt('file_version', latestFileVersion);
        
        if (updateError) throw updateError;
        
        console.log(`✅ Synced ${count} validation overrides from older versions to version ${latestFileVersion}`);
        addNotification(`✅ Synced ${count} validation overrides to current version ${latestFileVersion}`, 'success');
      } else {
        console.log('✅ All validation overrides already at current version');
      }
      
      return count || 0;
    } catch (error) {
      console.error('Error syncing overrides:', error);
      addNotification('Warning: Could not sync existing overrides', 'warning');
      return 0;
    }
  };

  // Start processing session with persistence
  const startProcessingSession = async () => {
    if (!isDateLocked) {
      addNotification('Please lock the project start date first', 'error');
      return;
    }

    if (hasUnsavedChanges) {
      addNotification('Please save InfoBy category configuration first', 'error');
      return;
    }

    const allValidCodes = [
      ...infoByCategoryConfig.entry,
      ...infoByCategoryConfig.refusal,
      ...infoByCategoryConfig.estimation,
      ...infoByCategoryConfig.priced
    ];

    if (allValidCodes.length === 0) {
      addNotification('Please configure InfoBy categories first', 'error');
      return;
    }

    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    setSettingsLocked(true);
    setProcessing(true);
    setProcessed(false);

    try {

      // 🆕 Sync overrides before processing to prevent duplicate key errors!
      await syncOverridesToCurrentVersion();

      const results = await processAnalytics();
      if (!results) {
        throw new Error('Analytics processing failed');
      }

      // Use the actual results data
      const { analyticsResult, billingResult, validationReportData, missingPropertiesReportData } = results;
      
      // Set the fresh missing properties report in state
      setMissingPropertiesReport(missingPropertiesReportData);

      // Save with complete data structure
      await saveCategoriesToDatabase(infoByCategoryConfig, {
        analytics: analyticsResult,
        billingAnalytics: billingResult,
        validationReport: validationReportData,
        missingPropertiesReport: missingPropertiesReportData,
        validationOverrides: validationOverrides,
        overrideMap: overrideMap
      });

      // Get fresh validation overrides before sending to App.js
      const freshOverrides = await getFreshValidationOverrides();
      const freshOverrideMap = {};
      freshOverrides.forEach(override => {
        freshOverrideMap[override.property_composite_key] = {
          override_applied: override.override_applied,
          override_reason: override.override_reason,
          override_by: override.override_by,
          override_date: override.override_date
        };
      });

      // Update local state with fresh data
      setValidationOverrides(freshOverrides);
      setOverrideMap(freshOverrideMap);

      // Ensure App.js integration works with fresh data
      if (onUpdateWorkflowStats) {
        // Create adjusted analytics with override counts included
        const adjustedAnalytics = {
          ...analyticsResult,
          // Valid inspections already includes overrides from processing modal
          validationOverrideCount: freshOverrides.length
        };

        debugLog('UPDATE_WORKFLOW_STATS', '🚨 Calling onUpdateWorkflowStats from startProcessingSession', {
          source: 'startProcessingSession',
          analytics: adjustedAnalytics,
          validInspections: adjustedAnalytics.validInspections,
          jobEntryRate: adjustedAnalytics.jobEntryRate,
          totalRecords: adjustedAnalytics.totalRecords,
          timestamp: new Date().toISOString()
        });

        onUpdateWorkflowStats({
          jobId: jobData.id,
          analytics: adjustedAnalytics,
          billingAnalytics: billingResult,
          validationReport: validationReportData,
          missingPropertiesReport: missingPropertiesReportData,
          validationOverrides: freshOverrides,
          overrideMap: freshOverrideMap,
          totalValidationOverrides: freshOverrides.length,
          lastProcessed: new Date().toISOString()
        });
        debugLog('APP_INTEGRATION', '✅ Data sent to App.js central hub with fresh override data');
      }

      debugLog('SESSION', '✅ Processing session completed successfully');
      addNotification(`✅ Processing completed! Analytics saved and ready.`, 'success');

      // Update commercial counts to match analytics
      setCommercialCounts({
        total: analyticsResult.totalCommercialProperties,
        inspected: analyticsResult.commercialInspections,
        priced: analyticsResult.commercialPricing
      });

      setProcessed(true);

    } catch (error) {
      console.error('Error in processing session:', error);
      addNotification('Processing session failed: ' + error.message, 'error');
      setSettingsLocked(false);
      setSessionId(null);
    } finally {
      setProcessing(false);
    }
  };

const exportValidationReport = () => {
    if (!validationReport || !validationReport.detailed_issues) return;

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ['VALIDATION REPORT'],
      [`Job: ${jobData.name || jobData.ccdd}`],
      [`Generated: ${new Date().toLocaleDateString()}`],
      [`Total Issues: ${validationReport.summary.total_issues}`],
      [],
      ['Inspector Code', 'Inspector Name', 'Total Issues']
    ];

    validationReport.summary.inspector_breakdown
      .sort((a, b) => b.total_issues - a.total_issues)
      .forEach(inspector => {
        summaryData.push([
          inspector.inspector_code,
          inspector.inspector_name,
          inspector.total_issues
        ]);
      });

    summaryData.push([]);
    summaryData.push(['STATISTICS']);
    summaryData.push(['Total Validation Issues', validationReport.summary.total_issues]);
    summaryData.push(['Total Inspectors with Issues', validationReport.summary.total_inspectors]);
    summaryData.push(['Manager Overrides Applied', validationOverrides.length]);

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

    // Apply styling to summary sheet
    const summaryRange = XLSX.utils.decode_range(summarySheet['!ref']);

    // Find the row index for "STATISTICS" dynamically
    const statisticsRowIndex = summaryData.findIndex(row => row[0] === 'STATISTICS');

    for (let R = summaryRange.s.r; R <= summaryRange.e.r; ++R) {
      for (let C = summaryRange.s.c; C <= summaryRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!summarySheet[cellAddress]) continue;

        // Bold only: title row (0), column headers row (5), and STATISTICS row
        const isHeader = R === 0 || R === 5 || R === statisticsRowIndex;

        summarySheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Set column widths for summary sheet
    summarySheet['!cols'] = [
      { wch: 30 }, // Column A: Labels and inspector codes
      { wch: 25 }, // Column B: Inspector names
      { wch: 15 }  // Column C: Total issues
    ];

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Create a sheet for each inspector (only if they have issues)
    Object.keys(validationReport.detailed_issues)
      .filter(inspector => validationReport.detailed_issues[inspector].length > 0)
      .sort((a, b) => validationReport.detailed_issues[b].length - validationReport.detailed_issues[a].length)
      .forEach(inspector => {
        const issues = validationReport.detailed_issues[inspector];
        const inspectorInfo = validationReport.summary.inspector_breakdown.find(i => i.inspector_code === inspector);

        // Reorganized: Headers first, data rows, then summary at bottom
        const inspectorData = [
          ['Block', 'Lot', 'Qualifier', 'Card', 'Property Location', 'Issues', 'Override Status']
        ];

        issues.forEach(issue => {
          const propertyKey = issue.composite_key || `${issue.block}-${issue.lot}-${issue.qualifier || ''}`;
          const isOverridden = overrideMap && overrideMap[propertyKey]?.override_applied;
          const overrideStatus = isOverridden ? `Overridden: ${overrideMap[propertyKey]?.override_reason}` : 'Not Overridden';

          inspectorData.push([
            issue.block,
            issue.lot,
            issue.qualifier || '',
            issue.card || '1',
            issue.property_location || '',
            issue.warning_message,
            overrideStatus
          ]);
        });

        // Add inspector summary at the bottom
        inspectorData.push([]);
        inspectorData.push([`Inspector: ${inspector}`]);
        inspectorData.push([`Name: ${inspectorInfo?.inspector_name || 'Unknown'}`]);
        inspectorData.push([`Total Issues: ${issues.length}`]);

        const inspectorSheet = XLSX.utils.aoa_to_sheet(inspectorData);

        // Apply styling to inspector sheet
        const inspectorRange = XLSX.utils.decode_range(inspectorSheet['!ref']);
        const lastDataRow = inspectorData.length - 4; // Last data row before summary section

        for (let R = inspectorRange.s.r; R <= inspectorRange.e.r; ++R) {
          for (let C = inspectorRange.s.c; C <= inspectorRange.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!inspectorSheet[cellAddress]) continue;

            // Header is row 0, summary is last 3 rows
            const isHeader = R === 0;
            const isSummary = R > lastDataRow;

            inspectorSheet[cellAddress].s = {
              font: { name: 'Leelawadee', sz: 10, bold: isHeader },
              alignment: { horizontal: isSummary ? 'left' : 'center', vertical: 'center' }
            };
          }
        }

        // Set column widths for inspector sheet
        inspectorSheet['!cols'] = [
          { wch: 10 }, // Block
          { wch: 10 }, // Lot
          { wch: 12 }, // Qualifier
          { wch: 8 },  // Card
          { wch: 40 }, // Property Location
          { wch: 50 }, // Issues
          { wch: 30 }  // Override Status
        ];

        // Truncate sheet name if too long (Excel limit is 31 characters)
        const sheetName = inspector.length > 31 ? inspector.substring(0, 31) : inspector;
        XLSX.utils.book_append_sheet(wb, inspectorSheet, sheetName);
      });

    // Write the file
    XLSX.writeFile(wb, `Validation_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`);

    addNotification('📊 Validation report exported with inspector tabs', 'success');
  };
const exportMissingPropertiesReport = () => {
    if (!missingPropertiesReport || !missingPropertiesReport.detailed_missing) return;

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
      ['MISSING PROPERTIES REPORT'],
      [`Job: ${jobData.name || jobData.ccdd}`],
      [`Generated: ${new Date().toLocaleDateString()}`],
      [],
      ['OVERVIEW'],
      ['Total Missing Properties', missingPropertiesReport.summary.total_missing],
      ['Not Yet Inspected', missingPropertiesReport.summary.not_yet_inspected],
      ['Old Inspections (Before Project Start)', missingPropertiesReport.summary.old_inspections],
      ['Validation Failed', missingPropertiesReport.summary.validation_failed_count || 0],
      ['Missing Inspector', missingPropertiesReport.summary.missing_inspector || 0],
      ['Invalid Employee', missingPropertiesReport.summary.invalid_employee || 0]
    ];

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);

    // Apply styling to summary sheet
    const summaryRange = XLSX.utils.decode_range(summarySheet['!ref']);
    const overviewRowIndex = summaryData.findIndex(row => row[0] === 'OVERVIEW');

    for (let R = summaryRange.s.r; R <= summaryRange.e.r; ++R) {
      for (let C = summaryRange.s.c; C <= summaryRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!summarySheet[cellAddress]) continue;

        // Bold: title row (0) and OVERVIEW row
        const isHeader = R === 0 || R === overviewRowIndex;

        summarySheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Set column widths for summary sheet
    summarySheet['!cols'] = [
      { wch: 40 }, // Labels
      { wch: 15 }  // Values
    ];

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Sheet 2: By Reason (remove redundant header)
    const reasonData = [
      ['Reason', 'Count']
    ];

    Object.entries(missingPropertiesReport.summary.by_reason)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        reasonData.push([reason, count]);
      });

    const reasonSheet = XLSX.utils.aoa_to_sheet(reasonData);

    // Apply styling to By Reason sheet
    const reasonRange = XLSX.utils.decode_range(reasonSheet['!ref']);
    for (let R = reasonRange.s.r; R <= reasonRange.e.r; ++R) {
      for (let C = reasonRange.s.c; C <= reasonRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!reasonSheet[cellAddress]) continue;

        const isHeader = R === 0;

        reasonSheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Set column widths for By Reason sheet
    reasonSheet['!cols'] = [
      { wch: 50 }, // Reason
      { wch: 15 }  // Count
    ];

    XLSX.utils.book_append_sheet(wb, reasonSheet, 'By Reason');

    // Sheet 3: By Inspector (remove redundant header)
    const inspectorData = [
      ['Inspector', 'Count']
    ];

    Object.entries(missingPropertiesReport.summary.by_inspector)
      .sort((a, b) => b[1] - a[1])
      .forEach(([inspector, count]) => {
        inspectorData.push([inspector || 'None', count]);
      });

    const inspectorSheet = XLSX.utils.aoa_to_sheet(inspectorData);

    // Apply styling to By Inspector sheet
    const inspectorRange = XLSX.utils.decode_range(inspectorSheet['!ref']);
    for (let R = inspectorRange.s.r; R <= inspectorRange.e.r; ++R) {
      for (let C = inspectorRange.s.c; C <= inspectorRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!inspectorSheet[cellAddress]) continue;

        const isHeader = R === 0;

        inspectorSheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Set column widths for By Inspector sheet
    inspectorSheet['!cols'] = [
      { wch: 25 }, // Inspector
      { wch: 15 }  // Count
    ];

    XLSX.utils.book_append_sheet(wb, inspectorSheet, 'By Inspector');

    // Sheet 4: Detailed Missing Properties (remove redundant headers)
    const detailedData = [
      ['Block', 'Lot', 'Qualifier', 'Card', 'Property Location', 'Class', 'Inspector', 'InfoBy Code', 'Measure Date', 'Reason']
    ];

    missingPropertiesReport.detailed_missing
      .sort((a, b) => {
        // Sort by block, then lot for easier field navigation
        if (a.block !== b.block) {
          return parseInt(a.block) - parseInt(b.block) || a.block.localeCompare(b.block);
        }
        return parseInt(a.lot) - parseInt(b.lot) || a.lot.localeCompare(b.lot);
      })
      .forEach(property => {
        detailedData.push([
          property.block,
          property.lot,
          property.qualifier || '',
          property.card || '1',
          property.property_location || '',
          property.property_class || '',
          property.inspector || '',
          property.info_by_code || '',
          property.measure_date || '',
          property.reason
        ]);
      });

    const detailedSheet = XLSX.utils.aoa_to_sheet(detailedData);

    // Apply styling to Detailed Missing sheet
    const detailedRange = XLSX.utils.decode_range(detailedSheet['!ref']);
    for (let R = detailedRange.s.r; R <= detailedRange.e.r; ++R) {
      for (let C = detailedRange.s.c; C <= detailedRange.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!detailedSheet[cellAddress]) continue;

        const isHeader = R === 0;

        detailedSheet[cellAddress].s = {
          font: { name: 'Leelawadee', sz: 10, bold: isHeader },
          alignment: { horizontal: 'center', vertical: 'center' }
        };
      }
    }

    // Set column widths for Detailed Missing sheet
    detailedSheet['!cols'] = [
      { wch: 10 },  // Block
      { wch: 10 },  // Lot
      { wch: 12 },  // Qualifier
      { wch: 8 },   // Card
      { wch: 40 },  // Property Location
      { wch: 12 },  // Class
      { wch: 25 },  // Inspector
      { wch: 15 },  // InfoBy Code
      { wch: 15 },  // Measure Date
      { wch: 50 }   // Reason
    ];

    XLSX.utils.book_append_sheet(wb, detailedSheet, 'Detailed Missing');

    // Write the file
    XLSX.writeFile(wb, `Missing_Properties_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`);

    addNotification('📊 Missing properties report exported with multiple sheets', 'success');
  };

  // Progress bar component
  const ProgressBar = ({ current, total, color = 'blue' }) => {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const colorClasses = {
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      gray: 'bg-gray-500'
    };

    return (
      <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
        <div 
          className={`${colorClasses[color]} h-2 rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        ></div>
        <div className="text-xs text-gray-500 mt-1 text-right">{percentage}%</div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">Loading production data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {notifications.map(notification => (
          <div
            key={notification.id}
            className={`p-4 rounded-lg shadow-lg border-l-4 max-w-md transition-all duration-300 ${
              notification.type === 'error' ? 'bg-red-50 border-red-400 text-red-800' :
              notification.type === 'warning' ? 'bg-yellow-50 border-yellow-400 text-yellow-800' :
              notification.type === 'success' ? 'bg-green-50 border-green-400 text-green-800' :
              'bg-blue-50 border-blue-400 text-blue-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{notification.message}</span>
              <button
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Processing Modal for Validation Decisions */}
      {showProcessingModal && pendingValidations.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Validation Review During Processing</h3>
              <p className="text-sm text-gray-600 mt-1">Review and decide on validation issues found during processing</p>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium text-gray-700">Total Issues: </span>
                  <span className="text-red-600">{pendingValidations.length}</span>
                </div>
                <div className="text-sm">
                  <span className="font-medium text-gray-700">Reviewed: </span>
                  <span className="text-green-600">
                    {pendingValidations.filter(v => v.overridden || v.skipped).length} of {pendingValidations.length}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Modal Body with Navigation */}
            <div className="flex-1 overflow-hidden flex flex-col px-6 py-4">
              {/* Current Item Display */}
              <div className="flex-1 overflow-y-auto">
            {(() => {
              // Just use currentValidationIndex directly - no smart logic
              const displayIndex = currentValidationIndex;
              const currentValidation = pendingValidations[displayIndex] || pendingValidations[0];
              
              return (
                <div className="space-y-4" id={`validation-item-${displayIndex}`}>
                  {/* Progress Indicator */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-sm text-gray-600">
                      Item {displayIndex + 1} of {pendingValidations.length}
                    </div>
                    <div className="flex space-x-1">
                      {pendingValidations.map((_, idx) => (
                        <div
                          key={idx}
                          className={`h-2 w-2 rounded-full ${
                            pendingValidations[idx].overridden ? 'bg-green-500' :
                            pendingValidations[idx].skipped ? 'bg-gray-400' :
                            idx === displayIndex ? 'bg-blue-500' :
                            'bg-gray-200'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  
                  {/* Current Validation Item */}
                  <div className="border rounded-lg p-6 bg-gray-50">
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-semibold text-gray-900 text-lg">
                          {currentValidation.block}-{currentValidation.lot}
                          {currentValidation.qualifier ? `-${currentValidation.qualifier}` : ''}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">{currentValidation.property_location}</p>
                      </div>
                      
                      <div className="bg-red-50 border border-red-200 rounded p-3">
                        <p className="text-sm font-medium text-red-800">Validation Issues:</p>
                        <p className="text-sm text-red-700 mt-1">{currentValidation.warning_message}</p>
                      </div>
                      
                      {currentValidation.overridden && (
                        <div className="bg-green-50 border border-green-200 rounded p-3">
                          <p className="text-sm font-medium text-green-800">
                            ✅ Overridden: {currentValidation.override_reason}
                          </p>
                        </div>
                      )}
                      
                      {currentValidation.skipped && (
                        <div className="bg-gray-100 border border-gray-300 rounded p-3">
                          <p className="text-sm font-medium text-gray-700">
                            ⏭️ Skipped - Will remain as validation error
                          </p>
                        </div>
                      )}
                      
                      {!currentValidation.overridden && !currentValidation.skipped && (
                        <div className="space-y-3 mt-4">
                          <div className="flex space-x-3">
                            {/* Replace Override button with informational text */}
                            <div className="flex-1 px-4 py-2 bg-yellow-100 text-yellow-800 rounded-lg text-center font-medium">
                              📋 See Validation Report Section to Override
                            </div>
                            
                            <button
                              onClick={() => handleProcessingSkip(currentValidation.composite_key)}
                              className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium"
                            >
                              Skip (Keep Error)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Navigation Buttons */}
                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={() => {
                        const newIndex = displayIndex > 0 ? displayIndex - 1 : pendingValidations.length - 1;
                        setCurrentValidationIndex(newIndex);
                      }}
                      className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                      disabled={pendingValidations.length <= 1}
                    >
                      ← Previous
                    </button>
                    
                    <span className="text-sm text-gray-600">
                      {pendingValidations.filter(v => !v.overridden && !v.skipped).length} items remaining
                    </span>
                    
                    <button
                      onClick={() => {
                        const newIndex = displayIndex < pendingValidations.length - 1 ? displayIndex + 1 : 0;
                        setCurrentValidationIndex(newIndex);
                      }}
                      className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                      disabled={pendingValidations.length <= 1}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              );
            })()}
               </div>
              </div>
                  
            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Properties with overrides will be included as valid inspections.
                  Skipped properties will remain as validation errors.
                </div>
                <button
                  onClick={() => {
                    if (processingPaused) {
                      continueProcessingAfterValidations();
                    } else {
                      // Processing is done, close the modal
                      closeProcessingModal();
                    }
                  }}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  {processingPaused 
                    ? (pendingValidations.every(v => v.overridden || v.skipped) 
                        ? 'All Reviewed - Continue Processing' 
                        : 'Continue Processing')
                    : '✅ Close and Complete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header with Assignment Status */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Factory className="w-8 h-8 mr-3 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Production Tracker</h1>
              <p className="text-gray-600">
                {jobData.name} - Enhanced Analytics & Validation Engine
                {detectedVendor && <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                  {detectedVendor} Format
                </span>}
              </p>
            </div>
          </div>
          {/* Assignment Status in top right */}
          <div className="text-right">
            <div className="text-sm font-medium text-gray-700">Special Assignments:</div>
            <div className={`text-lg font-bold ${jobData.has_property_assignments ? 'text-purple-600' : 'text-gray-600'}`}>
              {jobData.has_property_assignments ? 'YES' : 'NO'}
            </div>
          </div>
        </div>

        {/* Quick Stats with Percentages and Details */}
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">
                    Total Properties
                    {jobData.has_property_assignments && (
                      <span className="ml-1 text-xs text-purple-600">(Assigned)</span>
                    )}
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {jobData.has_property_assignments 
                      ? (jobData.assignedPropertyCount?.toLocaleString() || '0')
                      : (propertyRecordsCount?.toLocaleString() || analytics.totalRecords.toLocaleString())
                    }
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Inspections</p>
                  <p className="text-2xl font-bold text-green-600">{analytics.validInspections.toLocaleString()}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Job Entry Rate</p>
                  <p className="text-2xl font-bold text-green-600">{analytics.jobEntryRate || 0}%</p>
                </div>
                <Users className="w-8 h-8 text-green-500" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Job Refusal Rate</p>
                  <p className="text-2xl font-bold text-red-600">{analytics.jobRefusalRate || 0}%</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>
          </div>
        )}

        {/* Commercial metrics */}
        {(analytics || commercialCounts.total > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Commercial Complete</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {commercialCounts.total > 0 ?
                      Math.round((commercialCounts.inspected / commercialCounts.total) * 100) : 0}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {`${commercialCounts.inspected.toLocaleString()} of ${commercialCounts.total.toLocaleString()} properties`}
                  </p>
                </div>
                <Factory className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Pricing Complete</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {commercialCounts.inspected > 0 ?
                      Math.round((commercialCounts.priced / commercialCounts.inspected) * 100) : 0}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {`${commercialCounts.priced.toLocaleString()} of ${commercialCounts.inspected.toLocaleString()} properties`}
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-purple-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Smart Data Staleness Banner */}
      {isDataStale && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mr-2" />
            <div className="flex-1">
              <h3 className="font-medium text-yellow-800">New Data Available to Process</h3>
              <p className="text-sm text-yellow-700">
                Files were updated after your last analytics processing. Current results may be outdated.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Settings className="w-5 h-5 mr-2" />
          Processing Settings - Enhanced Configuration
          {settingsLocked && (
            <span className="ml-3 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
              Session Active: {sessionId?.slice(-8)}
            </span>
          )}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Start Date *
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={projectStartDate}
                onChange={(e) => setProjectStartDate(e.target.value)}
                disabled={isDateLocked || settingsLocked}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              />
              <button
                onClick={isDateLocked ? unlockStartDate : lockStartDate}
                disabled={settingsLocked || (!projectStartDate && !isDateLocked)}
                className={`px-3 py-2 rounded-lg flex items-center gap-1 ${
                  isDateLocked 
                    ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isDateLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                {isDateLocked ? 'Unlock' : 'Lock'}
              </button>
            </div>
            {isDateLocked && (
              <p className="text-sm text-green-600 mt-1">
                ✅ Date locked and saved to property records
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              InfoBy Categories ({(availableInfoByCodes || []).length} codes available)
           </label>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span>Entry: {(infoByCategoryConfig.entry || []).length} codes</span>
                <span>Refusal: {(infoByCategoryConfig.refusal || []).length} codes</span>
                <span>Estimation: {(infoByCategoryConfig.estimation || []).length} codes</span>
                <span>Priced: {(infoByCategoryConfig.priced || []).length} codes</span>
                <span>Invalid: {(infoByCategoryConfig.invalid || []).length} codes</span>
                <span>Special: {(infoByCategoryConfig.special || []).length} codes</span>
              </div>

              {hasUnsavedChanges && (
                <div className="text-sm text-orange-600 font-medium">
                  ⚠️ Unsaved changes
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => saveCategoriesToDatabase()}
                  disabled={!hasUnsavedChanges || settingsLocked}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  <Save className="w-4 h-4" />
                  Save Config
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              External Inspectors (comma-separated)
            </label>
            <input
              type="text"
              value={externalInspectorsList}
              onChange={(e) => setExternalInspectorsList(e.target.value)}
              placeholder="e.g., GL, ABC, XYZ"
              disabled={settingsLocked}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
            />
            <p className="text-xs text-gray-500 mt-1">
              Client or external inspector codes
            </p>
          </div>
        </div>
        
        {/* Collapsible InfoBy Category Configuration Panel with Clean Codes */}
        {(availableInfoByCodes || []).length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-md font-semibold text-gray-800">
                InfoBy Category Assignment ({jobData.vendor_type} Format) - {availableInfoByCodes.length} codes detected
              </h4>
              <button
                onClick={() => setShowInfoByConfig(!showInfoByConfig)}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
              >
                {showInfoByConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {showInfoByConfig ? 'Hide' : 'Show'} Configuration
              </button>
            </div>
            
            {/* Quick Summary (Always Visible) */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm mb-4">
              <div className="bg-green-50 px-3 py-2 rounded border">
                <span className="font-medium text-green-800">Entry:</span> {(infoByCategoryConfig.entry || []).length}
              </div>
              <div className="bg-red-50 px-3 py-2 rounded border">
                <span className="font-medium text-red-800">Refusal:</span> {(infoByCategoryConfig.refusal || []).length}
              </div>
              <div className="bg-blue-50 px-3 py-2 rounded border">
                <span className="font-medium text-blue-800">Estimation:</span> {(infoByCategoryConfig.estimation || []).length}
              </div>
              <div className="bg-gray-50 px-3 py-2 rounded border">
                <span className="font-medium text-gray-800">Invalid:</span> {(infoByCategoryConfig.invalid || []).length}
              </div>
              <div className="bg-purple-50 px-3 py-2 rounded border">
                <span className="font-medium text-purple-800">Priced:</span> {(infoByCategoryConfig.priced || []).length}
              </div>
              <div className="bg-yellow-50 px-3 py-2 rounded border">
                <span className="font-medium text-yellow-800">Special:</span> {(infoByCategoryConfig.special || []).length}
              </div>
            </div>
            
            {/* Detailed Configuration (Collapsible) */}
            {showInfoByConfig && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                {['entry', 'refusal', 'estimation', 'invalid', 'priced', 'special'].map(category => (
                  <div key={category} className="border border-gray-200 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-3 capitalize">
                      {category} ({(infoByCategoryConfig[category] || []).length})
                    </h5>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(availableInfoByCodes || []).map(codeItem => {
                        const storageCode = codeItem.storageCode || codeItem.code;
                        const displayCode = storageCode; // Should be clean: "A", "O", "R", etc.
                        const isAssigned = (infoByCategoryConfig[category] || []).includes(storageCode);
                        
                        return (
                          <div key={codeItem.code} className="flex items-start">
                            <input
                              type="checkbox"
                              checked={isAssigned}
                              onChange={() => handleCategoryAssignment(category, storageCode, isAssigned)}
                              disabled={settingsLocked}
                              className="mr-2 mt-1"
                            />
                            <div className="text-sm">
                              <span className="font-medium bg-blue-100 px-1 rounded">{displayCode}</span>
                              <div className="text-gray-600 text-xs leading-tight mt-1">{codeItem.description}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Reset button - visible when there's processed data and not stale */}
            {(processed || analytics) && !isDataStale && (
              <button
                onClick={resetSession}
                className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all text-sm flex items-center space-x-1"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reset Session</span>
              </button>
            )}
          </div>
          
          <button
            onClick={startProcessingSession}
            disabled={processing || (!isDateLocked) || hasUnsavedChanges ||
              (((infoByCategoryConfig || {}).entry || []).length + ((infoByCategoryConfig || {}).refusal || []).length + 
               ((infoByCategoryConfig || {}).estimation || []).length + ((infoByCategoryConfig || {}).priced || []).length + 
               ((infoByCategoryConfig || {}).special || []).length) === 0}
            className={`px-6 py-2 rounded-lg flex items-center space-x-2 transition-all ${
              (processed && !isDataStale)
                ? 'bg-green-600 text-white hover:bg-green-700'
                : processing
                ? 'bg-yellow-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {processing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (processed && !isDataStale) ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>
              {processing ? 'Processing...' : (processed && !isDataStale) ? 'Processed ✓' : 'Start Processing Session'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Content Tabs */}
      {analytics && (
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('analytics')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'analytics'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                📊 Inspector Analytics
              </button>
              <button
                onClick={() => setActiveTab('billing')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'billing'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                💰 Summary for Billing
              </button>
              <button
                onClick={() => setActiveTab('validation')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'validation'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ⚠️ Validation Report ({validationReport?.summary.total_issues || 0})
              </button>
              <button
                onClick={() => setActiveTab('missing')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'missing'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                🔍 Missing Properties ({missingPropertiesReport?.summary.total_missing || 0})
              </button>
              <button
                onClick={() => setActiveTab('overrides')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'overrides'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                🚫 Validation Overrides
              </button>
            </nav>
          </div>

          <div className="p-6">
            {/* Inspector Analytics Tab */}
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Inspector Performance Analytics</h3>
                  
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <label className="text-sm font-medium text-gray-700">Sort:</label>
                      <select 
                        value={inspectorSort}
                        onChange={(e) => setInspectorSort(e.target.value)}
                        className="px-3 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="alphabetical">Alphabetical</option>
                        <option value="dailyAverage">Daily Average</option>
                        <option value="entryRate">Entry Rate</option>
                        <option value="totalInspected">Total Inspected</option>
                      </select>
                    </div>
                  </div>
                </div>
                
                {Object.keys(analytics.inspectorStats || {}).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p>No inspector data available yet</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* RESIDENTIAL INSPECTOR ANALYTICS */}
                    <div className="bg-green-50 rounded-lg border border-green-200 p-6">
                      <h4 className="text-lg font-semibold text-green-800 mb-4 flex items-center">
                        <Users className="w-5 h-5 mr-2" />
                        Residential Inspector Analytics
                      </h4>
                      
                      {Object.entries(analytics.inspectorStats)
                        .filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'residential')
                        .sort(([aKey, aStats], [bKey, bStats]) => {
                          switch (inspectorSort) {
                            case 'alphabetical':
                              return aStats.name.localeCompare(bStats.name);
                            case 'dailyAverage':
                              return (bStats.dailyAverage || 0) - (aStats.dailyAverage || 0);
                            case 'entryRate':
                              return (bStats.entryRate || 0) - (aStats.entryRate || 0);
                            case 'totalInspected':
                              return bStats.totalInspected - aStats.totalInspected;
                            default:
                              return 0;
                          }
                        })
                        .map(([inspector, stats]) => (
                          <div key={inspector} className="bg-white border border-green-200 rounded-lg p-4 mb-3">
                            {/* Header Row */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <span className="font-semibold text-gray-900">{stats.name} ({inspector})</span>
                                <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                                  Residential Inspector
                                </span>
                                <span className="text-sm text-gray-600">{stats.residentialFieldDays} residential field days</span>
                              </div>
                              <span className="text-lg font-bold text-green-600">{stats.totalInspected.toLocaleString()} Total</span>
                            </div>
                            
                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                              <div className="bg-green-50 p-3 rounded">
                                <div className="font-bold text-green-700 text-xl">{stats.residentialInspected.toLocaleString()}</div>
                                <div className="text-xs text-green-600 font-medium">Residential Inspected</div>
                                <div className="text-xs text-gray-500">(Classes 2, 3A)</div>
                              </div>
                              <div className="bg-blue-50 p-3 rounded">
                                <div className="font-bold text-blue-700 text-xl">{stats.dailyAverage || 0}</div>
                                <div className="text-xs text-blue-600 font-medium">Daily Average</div>
                                <div className="text-xs text-gray-500">Residential ÷ Field Days</div>
                              </div>
                              <div className="bg-green-50 p-3 rounded">
                                <div className="font-bold text-green-700 text-xl">{stats.entryRate || 0}%</div>
                                <div className="text-xs text-green-600 font-medium">Entry Rate</div>
                                <div className="text-xs text-gray-500">On residential properties</div>
                              </div>
                              <div className="bg-red-50 p-3 rounded">
                                <div className="font-bold text-red-700 text-xl">{stats.refusalRate || 0}%</div>
                                <div className="text-xs text-red-600 font-medium">Refusal Rate</div>
                                <div className="text-xs text-gray-500">On residential properties</div>
                              </div>
                              <div className="bg-gray-50 p-3 rounded">
                                <div className="font-bold text-gray-700 text-xl">{(stats.totalInspected - stats.residentialInspected).toLocaleString()}</div>
                                <div className="text-xs text-gray-600 font-medium">Other Properties</div>
                                <div className="text-xs text-gray-500">Vacant, exempt, etc.</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      
                      {Object.entries(analytics.inspectorStats).filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'residential').length === 0 && (
                        <div className="text-center py-4 text-green-600">
                          <p>No residential inspectors found</p>
                        </div>
                      )}
                    </div>

                    {/* COMMERCIAL INSPECTOR ANALYTICS */}
                    <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
                      <h4 className="text-lg font-semibold text-blue-800 mb-4 flex items-center">
                        <Factory className="w-5 h-5 mr-2" />
                        Commercial Inspector Analytics
                      </h4>
                      
                      {Object.entries(analytics.inspectorStats)
                        .filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'commercial')
                        .sort(([aKey, aStats], [bKey, bStats]) => {
                          switch (inspectorSort) {
                            case 'alphabetical':
                              return aStats.name.localeCompare(bStats.name);
                            case 'dailyAverage':
                              return (bStats.commercialAverage || 0) - (aStats.commercialAverage || 0);
                            case 'totalInspected':
                              return bStats.totalInspected - aStats.totalInspected;
                            default:
                              return 0;
                          }
                        })
                        .map(([inspector, stats]) => (
                          <div key={inspector} className="bg-white border border-blue-200 rounded-lg p-4 mb-3">
                            {/* Header Row */}
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <span className="font-semibold text-gray-900">{stats.name} ({inspector})</span>
                                <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
                                  Commercial Inspector
                                </span>
                                <span className="text-sm text-gray-600">{stats.commercialFieldDays} commercial field days</span>
                              </div>
                              <span className="text-lg font-bold text-blue-600">{stats.totalInspected.toLocaleString()} Total</span>
                            </div>
                            
                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
                              <div className="bg-blue-50 p-3 rounded">
                                <div className="font-bold text-blue-700 text-lg">{stats.commercialInspected.toLocaleString()}</div>
                                <div className="text-xs text-blue-600 font-medium">Commercial</div>
                                <div className="text-xs text-gray-500">(4A, 4B, 4C)</div>
                              </div>
                              <div className="bg-blue-50 p-3 rounded">
                                <div className="font-bold text-blue-700 text-lg">{stats.commercialAverage || 0}</div>
                                <div className="text-xs text-blue-600 font-medium">Commercial Avg</div>
                                <div className="text-xs text-gray-500">Commercial ÷ Days</div>
                              </div>
                              <div className="bg-purple-50 p-3 rounded">
                                <div className="font-bold text-purple-700 text-lg">{stats.priced.toLocaleString()}</div>
                                <div className="text-xs text-purple-600 font-medium">Priced</div>
                                <div className="text-xs text-gray-500">Commercial only</div>
                              </div>
                              <div className="bg-purple-50 p-3 rounded">
                                <div className="font-bold text-purple-700 text-lg">{stats.pricingDays || 0}</div>
                                <div className="text-xs text-purple-600 font-medium">Pricing Days</div>
                                <div className="text-xs text-gray-500">{jobData.vendor_type === 'BRT' ? 'BRT only' : 'N/A'}</div>
                              </div>
                              <div className="bg-purple-50 p-3 rounded">
                                <div className="font-bold text-purple-700 text-lg">{stats.pricingAverage || 'N/A'}</div>
                                <div className="text-xs text-purple-600 font-medium">Pricing Avg</div>
                                <div className="text-xs text-gray-500">{jobData.vendor_type === 'BRT' ? 'Priced ÷ Days' : 'N/A'}</div>
                              </div>
                              <div className="bg-gray-50 p-3 rounded">
                                <div className="font-bold text-gray-700 text-lg">{(stats.totalInspected - stats.commercialInspected).toLocaleString()}</div>
                                <div className="text-xs text-gray-600 font-medium">Other Properties</div>
                                <div className="text-xs text-gray-500">Non-commercial</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      
                      {Object.entries(analytics.inspectorStats).filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'commercial').length === 0 && (
                        <div className="text-center py-4 text-blue-600">
                          <p>No commercial inspectors found</p>
                        </div>
                      )}
                    </div>

                    {/* MANAGEMENT INSPECTOR ANALYTICS */}
                    {Object.entries(analytics.inspectorStats)
                      .filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'management')
                      .length > 0 && (
                      <div className="bg-purple-50 rounded-lg border border-purple-200 p-6">
                        <h4 className="text-lg font-semibold text-purple-800 mb-4 flex items-center">
                          <Settings className="w-5 h-5 mr-2" />
                          Management Inspector Analytics
                        </h4>
                        
                        {Object.entries(analytics.inspectorStats)
                          .filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'management')
                          .sort(([aKey, aStats], [bKey, bStats]) => aStats.name.localeCompare(bStats.name))
                          .map(([inspector, stats]) => (
                            <div key={inspector} className="bg-white border border-purple-200 rounded-lg p-4 mb-3">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center space-x-3">
                                  <span className="font-semibold text-gray-900">{stats.name} ({inspector})</span>
                                  <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800">
                                    Management Inspector
                                  </span>
                                  <span className="text-sm text-gray-600">{stats.fieldDays} field days</span>
                                </div>
                                <span className="text-lg font-bold text-purple-600">{stats.totalInspected.toLocaleString()} Total</span>
                              </div>
                              
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div className="bg-purple-50 p-3 rounded">
                                  <div className="font-bold text-purple-700 text-lg">{stats.dailyAverage || 0}</div>
                                  <div className="text-xs text-purple-600 font-medium">Daily Average</div>
                                  <div className="text-xs text-gray-500">All work ÷ Field days</div>
                                </div>
                                <div className="bg-green-50 p-3 rounded">
                                  <div className="font-bold text-green-700 text-lg">{stats.residentialInspected.toLocaleString()}</div>
                                  <div className="text-xs text-green-600 font-medium">Residential</div>
                                  <div className="text-xs text-gray-500">(2, 3A)</div>
                                </div>
                                <div className="bg-blue-50 p-3 rounded">
                                  <div className="font-bold text-blue-700 text-lg">{stats.commercialInspected.toLocaleString()}</div>
                                  <div className="text-xs text-blue-600 font-medium">Commercial</div>
                                  <div className="text-xs text-gray-500">(4A, 4B, 4C)</div>
                                </div>
                                <div className="bg-gray-50 p-3 rounded">
                                  <div className="font-bold text-gray-700 text-lg">{(stats.totalInspected - stats.residentialInspected - stats.commercialInspected).toLocaleString()}</div>
                                  <div className="text-xs text-gray-600 font-medium">Other</div>
                                  <div className="text-xs text-gray-500">Vacant, exempt, etc.</div>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* UNTYPED INSPECTORS (If Any) */}
                    {Object.entries(analytics.inspectorStats)
                      .filter(([_, stats]) => !stats.inspector_type || 
                        !['residential', 'commercial', 'management'].includes(stats.inspector_type.toLowerCase()))
                      .length > 0 && (
                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          Other Inspectors (No Type Assigned)
                        </h4>
                        
                        {Object.entries(analytics.inspectorStats)
                          .filter(([_, stats]) => !stats.inspector_type || 
                            !['residential', 'commercial', 'management'].includes(stats.inspector_type.toLowerCase()))
                          .sort(([aKey, aStats], [bKey, bStats]) => aStats.name.localeCompare(bStats.name))
                          .map(([inspector, stats]) => (
                            <div key={inspector} className="bg-white border border-gray-200 rounded-lg p-4 mb-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-3">
                                  <span className="font-semibold text-gray-900">{stats.name} ({inspector})</span>
                                  <span className="px-2 py-1 text-xs font-medium rounded bg-yellow-100 text-yellow-800">
                                    No Inspector Type
                                  </span>
                                  <span className="text-sm text-gray-600">{stats.fieldDays} field days</span>
                                </div>
                                <span className="text-lg font-bold text-gray-600">{stats.totalInspected.toLocaleString()} Total</span>
                              </div>
                              
                              <div className="grid grid-cols-3 gap-4 text-center">
                                <div className="bg-gray-50 p-3 rounded">
                                  <div className="font-bold text-gray-700 text-lg">{stats.residentialInspected.toLocaleString()}</div>
                                  <div className="text-xs text-gray-600 font-medium">Residential</div>
                                </div>
                                <div className="bg-gray-50 p-3 rounded">
                                  <div className="font-bold text-gray-700 text-lg">{stats.commercialInspected.toLocaleString()}</div>
                                  <div className="text-xs text-gray-600 font-medium">Commercial</div>
                                </div>
                                <div className="bg-gray-50 p-3 rounded">
                                  <div className="font-bold text-gray-700 text-lg">{(stats.totalInspected - stats.residentialInspected - stats.commercialInspected).toLocaleString()}</div>
                                  <div className="text-xs text-gray-600 font-medium">Other</div>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Billing Tab */}
            {activeTab === 'billing' && billingAnalytics && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Summary for Billing</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Individual Classes</h4>
                    <div className="space-y-3">
                      {Object.entries(billingAnalytics.byClass)
                        .filter(([cls, data]) => data.total > 0)
                        .map(([cls, data]) => {
                          const isResidential = ['2', '3A'].includes(cls);
                          const isCommercial = ['4A', '4B', '4C'].includes(cls);
                          const colorClass = isResidential 
                            ? 'bg-green-50 border-green-200' 
                            : isCommercial 
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-gray-50 border-gray-200';
                          const textColor = isResidential 
                            ? 'text-green-600' 
                            : isCommercial 
                            ? 'text-blue-600' 
                            : 'text-gray-600';
                          const progressColor = isResidential ? 'green' : isCommercial ? 'blue' : 'gray';
                          
                          return (
                            <div key={cls} className={`p-4 rounded-lg border ${colorClass}`}>
                              <div className="flex justify-between items-center mb-2">
                                <div>
                                  <span className="font-medium text-gray-900">Class {cls}</span>
                                  {isResidential && <span className="ml-2 text-xs text-green-600 font-medium">Residential</span>}
                                  {isCommercial && <span className="ml-2 text-xs text-blue-600 font-medium">Commercial</span>}
                                </div>
                                <div className="text-right">
                                  <div className={`font-bold ${textColor}`}>{data.billable.toLocaleString()}</div>
                                  <div className="text-xs text-gray-500">of {data.total.toLocaleString()}</div>
                                </div>
                              </div>
                              <ProgressBar current={data.billable} total={data.total} color={progressColor} />
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Grouped Categories</h4>
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Commercial (4A, 4B, 4C)</span>
                            <div className="text-xs text-gray-600">Commercial properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-blue-600 text-xl">{billingAnalytics.grouped.commercial.toLocaleString()}</div>
                            <div className="text-xs text-blue-600">of {billingAnalytics.progressData.commercial.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.commercial.billable} 
                          total={billingAnalytics.progressData.commercial.total} 
                          color="blue" 
                        />
                      </div>

                      <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Exempt (15A-15F)</span>
                            <div className="text-xs text-gray-600">Tax-exempt properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-purple-600 text-xl">{billingAnalytics.grouped.exempt.toLocaleString()}</div>
                            <div className="text-xs text-purple-600">of {billingAnalytics.progressData.exempt.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.exempt.billable} 
                          total={billingAnalytics.progressData.exempt.total} 
                          color="purple" 
                        />
                      </div>

                      <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Railroad (5A, 5B)</span>
                            <div className="text-xs text-gray-600">Railroad properties</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-green-600 text-xl">{billingAnalytics.grouped.railroad.toLocaleString()}</div>
                            <div className="text-xs text-green-600">of {billingAnalytics.progressData.railroad.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.railroad.billable} 
                          total={billingAnalytics.progressData.railroad.total} 
                          color="green" 
                        />
                      </div>

                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-medium text-gray-900">Personal Property (6A, 6B)</span>
                            <div className="text-xs text-gray-600">Personal property</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-600 text-xl">{billingAnalytics.grouped.personalProperty.toLocaleString()}</div>
                            <div className="text-xs text-gray-600">of {billingAnalytics.progressData.personalProperty.total.toLocaleString()}</div>
                          </div>
                        </div>
                        <ProgressBar 
                          current={billingAnalytics.progressData.personalProperty.billable} 
                          total={billingAnalytics.progressData.personalProperty.total} 
                          color="gray" 
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Validation Tab */}
            {activeTab === 'validation' && validationReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Enhanced Validation Report - Smart Validation
                  </h3>
                  {validationReport.summary.total_issues > 0 && (
                    <button
                      onClick={exportValidationReport}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Report</span>
                    </button>
                  )}
                </div>

                {validationReport.summary.total_issues === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">No Validation Issues</h4>
                    <p className="text-gray-600">All attempted inspections passed validation checks</p>
                    <p className="text-sm text-gray-500 mt-2">Properties not yet inspected are excluded from validation</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                      <h4 className="font-semibold text-yellow-800 mb-3">Inspector Summary - Issues with Attempted Inspections Only</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {validationReport.summary.inspector_breakdown.map((inspector, idx) => (
                          <div 
                            key={idx}
                            onClick={() => setSelectedInspectorIssues(
                              selectedInspectorIssues === inspector.inspector_code ? null : inspector.inspector_code
                            )}
                            className="p-3 bg-white rounded border cursor-pointer hover:bg-yellow-50 transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-medium text-gray-900">{inspector.inspector_code}</div>
                                <div className="text-sm text-gray-600">{inspector.inspector_name}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-red-600">{inspector.total_issues}</div>
                                <div className="text-xs text-gray-500">issues</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selectedInspectorIssues && validationReport.detailed_issues[selectedInspectorIssues] && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold text-gray-900 mb-4">
                          Issues for {selectedInspectorIssues} - {validationReport.summary.inspector_breakdown.find(i => i.inspector_code === selectedInspectorIssues)?.inspector_name}
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Block</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Lot</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Qualifier</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Card</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Compound Issues</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationReport.detailed_issues[selectedInspectorIssues].map((issue, idx) => {
                                // Check if this issue has been overridden
                                const propertyKey = issue.composite_key || `${issue.block}-${issue.lot}-${issue.qualifier || ''}`;
                                const isOverridden = overrideMap && overrideMap[propertyKey]?.override_applied;
                                
                                return (
                                  <tr key={idx} className={`border-t border-gray-200 ${isOverridden ? 'bg-green-50' : ''}`}>
                                    <td className="px-3 py-2">{issue.block}</td>
                                    <td className="px-3 py-2">{issue.lot}</td>
                                    <td className="px-3 py-2">{issue.qualifier || '-'}</td>
                                    <td className="px-3 py-2">{issue.card}</td>
                                    <td className="px-3 py-2">{issue.property_location}</td>
                                    <td className={`px-3 py-2 ${isOverridden ? 'line-through text-gray-500' : 'text-red-600'}`}>
                                      {isOverridden ? (
                                        <div>
                                          <span className="line-through">{issue.warning_message}</span>
                                          <div className="text-green-600 text-xs font-medium mt-1">
                                            ✅ Overridden: {overrideMap[propertyKey]?.override_reason}
                                          </div>
                                        </div>
                                      ) : (
                                        issue.warning_message
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {isOverridden ? (
                                        <button
                                          onClick={() => handleUndoOverride(propertyKey, overrideMap[propertyKey]?.override_reason)}
                                          className="px-2 py-1 bg-orange-600 text-white text-xs rounded hover:bg-orange-700 font-medium"
                                        >
                                          Undo Override
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            setSelectedOverrideProperty({
                                              composite_key: propertyKey,
                                              block: issue.block,
                                              lot: issue.lot,
                                              qualifier: issue.qualifier,
                                              card: issue.card,
                                              property_location: issue.property_location,
                                              inspector: issue.inspector,
                                              warning_message: issue.warning_message
                                            });
                                            setShowOverrideModal(true);
                                          }}
                                          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 font-medium"
                                        >
                                          Override
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {!selectedInspectorIssues && (
                      <div className="text-center py-8 text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p>Click on an inspector above to view detailed issues</p>
                        <p className="text-sm mt-2">Only properties with inspection attempts are validated</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Missing Properties Report */}
            {activeTab === 'missing' && missingPropertiesReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Missing Properties Report - Not Added to Inspection Data
                  </h3>
                  {missingPropertiesReport.summary.total_missing > 0 && (
                    <button
                      onClick={() => exportMissingPropertiesReport()}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Missing Report</span>
                    </button>
                  )}  
                  )}
                </div>

                {missingPropertiesReport.summary.total_missing === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">All Properties Accounted For</h4>
                    <p className="text-gray-600">Every property record was successfully processed to inspection_data</p>
                    <p className="text-sm text-gray-500 mt-2">Total Records: {analytics?.totalRecords || 0} | Valid Inspections: {analytics?.validInspections || 0}</p>
                  </div>
                ) : (
                  <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-orange-600 font-medium">Total Missing</p>
                            <p className="text-2xl font-bold text-orange-800">{missingPropertiesReport.summary.total_missing}</p>
                          </div>
                          <AlertTriangle className="w-8 h-8 text-orange-500" />
                        </div>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600 font-medium">Not Yet Inspected</p>
                            <p className="text-2xl font-bold text-gray-800">{missingPropertiesReport.summary.not_yet_inspected}</p>
                            <p className="text-xs text-gray-500">No inspection data</p>
                          </div>
                          <Eye className="w-8 h-8 text-gray-500" />
                        </div>
                      </div>

                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-yellow-600 font-medium">Old Inspections</p>
                            <p className="text-2xl font-bold text-yellow-800">{missingPropertiesReport.summary.old_inspections}</p>
                            <p className="text-xs text-yellow-500">Before project start</p>
                          </div>
                          <Calendar className="w-8 h-8 text-yellow-500" />
                        </div>
                      </div>

                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-red-600 font-medium">Validation Failed</p>
                            <p className="text-2xl font-bold text-red-800">
                              {(missingPropertiesReport.summary.validation_failed_count || 0) + 
                               (missingPropertiesReport.summary.missing_inspector || 0) + 
                               (missingPropertiesReport.summary.invalid_employee || 0)}
                            </p>
                            <p className="text-xs text-red-500">Current but invalid</p>
                          </div>
                          <X className="w-8 h-8 text-red-500" />
                        </div>
                      </div>
                    </div>

                    {/* Assignment Status Card - Only show if job has assignments */}
                    {jobData.has_property_assignments && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 mb-6">
                        <h4 className="font-semibold text-purple-900 mb-3">Property Assignment Status</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-white p-4 rounded border border-purple-200">
                            <p className="text-sm text-purple-600 font-medium">Total Properties</p>
                            <p className="text-2xl font-bold text-purple-800">{propertyRecordsCount?.toLocaleString() || 0}</p>
                          </div>
                          <div className="bg-white p-4 rounded border border-purple-200">
                            <p className="text-sm text-purple-600 font-medium">Assigned External</p>
                            <p className="text-2xl font-bold text-purple-800">{unassignedPropertyCount.toLocaleString()}</p>
                            <p className="text-xs text-purple-500">To other contractors</p>
                          </div>
                          <div className="bg-white p-4 rounded border border-purple-200">
                            <p className="text-sm text-purple-600 font-medium">Internal Work</p>
                            <p className="text-2xl font-bold text-purple-800">{jobData.assignedPropertyCount?.toLocaleString() || 0}</p>
                            <p className="text-xs text-purple-500">Our responsibility</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Breakdown by Reason */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Breakdown by Reason</h4>
                      <div className="space-y-3">
                        {Object.entries(missingPropertiesReport.summary.by_reason).map(([reason, count]) => (
                          <div key={reason} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                            <span className="text-sm text-gray-700">{reason}</span>
                            <span className="font-bold text-gray-900">{count} properties</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Breakdown by Inspector */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Breakdown by Inspector</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {Object.entries(missingPropertiesReport.summary.by_inspector).map(([inspector, count]) => (
                          <div key={inspector} className="p-3 bg-gray-50 rounded border">
                            <div className="font-medium text-gray-900">{inspector}</div>
                            <div className="text-sm text-gray-600">{count} missing properties</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Detailed Missing Properties Table */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Detailed Missing Properties</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Block</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Lot</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Qualifier</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Card</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Class</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Inspector</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">InfoBy Code</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {missingPropertiesReport.detailed_missing.slice(0, 100).map((property, idx) => (
                              <tr key={idx} className={`border-t border-gray-200 ${
                                property.reason === 'Not yet inspected' ? 'bg-gray-50' : 
                                property.reason.includes('Old inspection') ? 'bg-yellow-50' :
                                'bg-red-50'
                              }`}>
                                <td className="px-3 py-2 font-medium">{property.block}</td>
                                <td className="px-3 py-2 font-medium">{property.lot}</td>
                                <td className="px-3 py-2">{property.qualifier || '-'}</td>
                                <td className="px-3 py-2">{property.card || '-'}</td>
                                <td className="px-3 py-2">{property.property_location}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                                    {property.property_class}
                                  </span>
                                </td>
                                <td className="px-3 py-2">{property.inspector || '-'}</td>
                                <td className="px-3 py-2">{property.info_by_code || '-'}</td>
                                <td className="px-3 py-2 text-xs">{property.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {missingPropertiesReport.detailed_missing.length > 100 && (
                          <div className="mt-4 text-center text-sm text-gray-500">
                            Showing first 100 of {missingPropertiesReport.detailed_missing.length} missing properties. Export to see all.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            
            {/* Validation Overrides Tab */}
            {activeTab === 'overrides' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Validation Overrides - Manager Approved Exceptions ({validationOverrides.length})
                  </h3>
                  {validationOverrides.length > 0 && (
                    <button
                      onClick={() => {
                        // Export overrides functionality
                        let csvContent = "Block,Lot,Qualifier,Card,Property Location,Override Reason,Override By,Override Date\n";
                        
                        validationOverrides.forEach(override => {
                          csvContent += `"${override.block}","${override.lot}","${override.qualifier || ''}","${override.card || '1'}","${override.property_location || ''}","${override.override_reason}","${override.override_by || 'Manager'}","${override.override_date || ''}"\n`;
                        });

                        const blob = new Blob([csvContent], { type: 'text/csv' });
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Validation_Overrides_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);

                        addNotification('📊 Validation overrides exported', 'success');
                      }}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Overrides</span>
                    </button>
                  )}
                </div>

                {validationOverrides.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-blue-500" />
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">No Validation Overrides Yet</h4>
                    <p className="text-gray-600">Use the Override button in validation details to approve exceptions.</p>
                    <p className="text-sm text-gray-500 mt-2">Overridden properties will appear here for tracking.</p>
                  </div>
                ) : (
                  <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-green-600 font-medium">Total Overrides</p>
                            <p className="text-2xl font-bold text-green-800">{validationOverrides.length}</p>
                          </div>
                          <CheckCircle className="w-8 h-8 text-green-500" />
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-blue-600 font-medium">New Construction</p>
                            <p className="text-2xl font-bold text-blue-800">
                              {validationOverrides.filter(o => o.override_reason === 'New Construction').length}
                            </p>
                          </div>
                          <Factory className="w-8 h-8 text-blue-500" />
                        </div>
                      </div>

                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-purple-600 font-medium">Additional Card</p>
                            <p className="text-2xl font-bold text-purple-800">
                              {validationOverrides.filter(o => o.override_reason === 'Additional Card').length}
                            </p>
                          </div>
                          <FileText className="w-8 h-8 text-purple-500" />
                        </div>
                      </div>
                    </div>

                    {/* Detailed Overrides Table */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h4 className="font-semibold text-gray-900 mb-4">Detailed Validation Overrides</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Block</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Lot</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Qualifier</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Card</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Override Reason</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Override By</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Override Date</th>
                              <th className="px-3 py-2 text-left font-medium text-gray-700">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {validationOverrides.map((override, idx) => (
                              <tr key={idx} className="border-t border-gray-200 bg-green-50">
                                <td className="px-3 py-2 font-medium">{override.block}</td>
                                <td className="px-3 py-2 font-medium">{override.lot}</td>
                                <td className="px-3 py-2">{override.qualifier || '-'}</td>
                                <td className="px-3 py-2">{override.card || '1'}</td>
                                <td className="px-3 py-2">{override.property_location}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                                    {override.override_reason}
                                  </span>
                                </td>
                                <td className="px-3 py-2">{override.override_by || 'Manager'}</td>
                                <td className="px-3 py-2 text-xs">
                                  {override.override_date ? new Date(override.override_date).toLocaleDateString() : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => handleUndoOverride(override.property_composite_key, override.override_reason)}
                                    className="px-2 py-1 bg-red-700 text-white text-xs rounded hover:bg-red-800 font-medium"
                                  >
                                    Undo Override
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && selectedOverrideProperty && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Override Validation Issue</h3>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Property:</p>
              <p className="font-medium">{selectedOverrideProperty.block}-{selectedOverrideProperty.lot}{selectedOverrideProperty.qualifier ? `-${selectedOverrideProperty.qualifier}` : ''}</p>
              <p className="text-sm text-gray-500">{selectedOverrideProperty.property_location}</p>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Current Issue:</p>
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{selectedOverrideProperty.warning_message}</p>
            </div>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason for Override:
              </label>
              <select
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="New Construction">New Construction</option>
                <option value="Additional Card">Additional Card</option>
                <option value="Other">Other (Custom)</option>
              </select>
            </div>
            
            {overrideReason === 'Other' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Reason:
                </label>
                <input
                  type="text"
                  value={customOverrideReason}
                  onChange={(e) => setCustomOverrideReason(e.target.value)}
                  placeholder="Enter custom override reason"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
            )}
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowOverrideModal(false);
                  setSelectedOverrideProperty(null);
                  setOverrideReason('New Construction');
                  setCustomOverrideReason('');
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleOverrideValidation(selectedOverrideProperty)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={overrideReason === 'Other' && !customOverrideReason}
              >
                Save Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionTracker;
