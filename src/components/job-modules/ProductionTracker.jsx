import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

const ProductionTracker = ({ jobData, onBackToJobs, latestFileVersion, propertyRecordsCount, onUpdateWorkflowStats, currentWorkflowStats }) => {
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
  
  // NEW: Track if we loaded from database to prevent race condition
  const [loadedFromDatabase, setLoadedFromDatabase] = useState(false);
  
  // NEW: Commercial inspection counts from inspection_data
  const [commercialCounts, setCommercialCounts] = useState({
    inspected: 0,
    priced: 0
  });
  
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
    const id = Date.now();
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  };

  // Debug logging
  const debugLog = (section, message, data = null) => {
    console.log(`🔍 [${section}] ${message}`, data || '');
  };

  // NEW: Load commercial inspection counts from inspection_data
  const loadCommercialCounts = async () => {
    if (!jobData?.id || !latestFileVersion) return;

    try {
      // Count inspected commercial properties (4A, 4B, 4C)
      const { data: inspectedData, error: inspectedError } = await supabase
        .from('inspection_data')
        .select('property_composite_key')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .in('property_class', ['4A', '4B', '4C'])
        .not('measure_by', 'is', null)
        .not('measure_date', 'is', null);

      if (inspectedError) throw inspectedError;

      // Count priced commercial properties
      const { data: pricedData, error: pricedError } = await supabase
        .from('inspection_data')
        .select('property_composite_key')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .in('property_class', ['4A', '4B', '4C'])
        .not('price_by', 'is', null)
        .not('price_date', 'is', null);

      if (pricedError) throw pricedError;

      setCommercialCounts({
        inspected: inspectedData?.length || 0,
        priced: pricedData?.length || 0
      });

      debugLog('COMMERCIAL_COUNTS', 'Loaded commercial counts from inspection_data', {
        inspected: inspectedData?.length || 0,
        priced: pricedData?.length || 0,
        totalCommercial: jobData.totalCommercial
      });

    } catch (error) {
      console.error('Error loading commercial counts:', error);
      debugLog('COMMERCIAL_COUNTS', 'Error loading commercial counts');
    }
  };

  // Load employee data for inspector details
  const loadEmployeeData = async () => {
    try {
      const { data: employees, error } = await supabase
        .from('employees')
        .select('id, first_name, last_name, inspector_type, employment_status, initials');

      if (error) throw error;

      const employeeMap = {};
      employees.forEach(emp => {
        const initials = emp.initials || `${emp.first_name.charAt(0)}${emp.last_name.charAt(0)}`;
        employeeMap[initials] = {
          id: emp.id,
          name: `${emp.first_name} ${emp.last_name}`,
          fullName: `${emp.last_name}, ${emp.first_name}`,
          inspector_type: emp.inspector_type,
          initials: initials
        };
      });

      setEmployeeData(employeeMap);
      debugLog('EMPLOYEES', 'Loaded employee data with types', { 
        count: Object.keys(employeeMap).length,
        inspectorTypes: Object.values(employeeMap).reduce((acc, emp) => {
          const type = emp.inspector_type || 'untyped';
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {})
      });
    } catch (error) {
      console.error('Error loading employee data:', error);
      addNotification('Error loading employee data', 'error');
    }
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
        debugLog('VENDOR_SOURCE', `Detected vendor from property_records: ${record.vendor_source}`);
        setDetectedVendor(record.vendor_source);
        return record.vendor_source;
      }
      
      // Fallback to jobData vendor_type
      debugLog('VENDOR_SOURCE', `Using fallback vendor from jobData: ${jobData.vendor_type}`);
      setDetectedVendor(jobData.vendor_type);
      return jobData.vendor_type;
    } catch (error) {
      debugLog('VENDOR_SOURCE', 'Error loading vendor source, using fallback');
      return jobData.vendor_type;
    }
  };

  // Load validation overrides
  const loadValidationOverrides = async () => {
    if (!jobData?.id || !latestFileVersion) return;

    try {
      const { data: overrides, error } = await supabase
        .from('inspection_data')
        .select(`
          property_composite_key,
          block,
          lot,
          qualifier,
          card,
          property_location,
          override_applied,
          override_reason,
          override_by,
          override_date
        `)
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .eq('override_applied', true)
        .order('override_date', { ascending: false });

      if (!error && overrides) {
        // Some overrides might be missing block/lot if created before fix
        // For those, parse from composite key
        const processedOverrides = overrides.map(override => {
          if (!override.block || !override.lot) {
            // Parse from composite key format: "BLOCK-LOT-QUALIFIER"
            const parts = override.property_composite_key.split('-');
            return {
              ...override,
              block: override.block || parts[0] || '',
              lot: override.lot || parts[1] || '',
              qualifier: override.qualifier || parts[2] || ''
            };
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
        
        debugLog('VALIDATION_OVERRIDES', `Loaded ${processedOverrides.length} validation overrides with property details`);
      }
    } catch (error) {
      console.error('Error loading validation overrides:', error);
    }
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
        debugLog('CODES', 'No parsed code definitions found for job');
        addNotification('No code definitions found. Upload code file first.', 'warning');
        return;
      }

      const codes = [];
      const vendor = job.vendor_type;

      if (vendor === 'BRT') {
        const sections = job.parsed_code_definitions.sections || job.parsed_code_definitions;
        
        debugLog('CODES', 'BRT sections available:', Object.keys(sections));
        
        // Look for InfoBy codes in Residential section, key 30, MAP - LOAD ALL CODES
        const residentialSection = sections['Residential'];
        if (residentialSection && residentialSection['30'] && residentialSection['30'].MAP) {
          debugLog('CODES', 'Found Residential[30].MAP, loading ALL InfoBy codes...');
          
          Object.keys(residentialSection['30'].MAP).forEach(key => {
            const item = residentialSection['30'].MAP[key];
            if (item && item.DATA && item.DATA.VALUE) {
              codes.push({
                code: item.KEY || item.DATA.KEY,
                description: item.DATA.VALUE,
                section: 'Residential[30]',
                vendor: 'BRT'
              });
              
              debugLog('CODES', `Found InfoBy code: ${item.KEY} = ${item.DATA.VALUE}`);
            }
          });
        } else {
          debugLog('CODES', 'Residential[30].MAP not found, structure:', residentialSection?.['30']);
        }

        // Fallback: Search all sections for inspection-related codes
        if (codes.length === 0) {
          debugLog('CODES', 'No codes found in Residential[30], searching all sections...');
          Object.keys(sections).forEach(sectionName => {
            const section = sections[sectionName];
            if (typeof section === 'object') {
              Object.keys(section).forEach(key => {
                const item = section[key];
                if (item && item.DATA && item.DATA.VALUE && 
                    (item.DATA.VALUE.includes('OWNER') || item.DATA.VALUE.includes('REFUSED') || 
                     item.DATA.VALUE.includes('AGENT') || item.DATA.VALUE.includes('ESTIMATED'))) {
                  codes.push({
                    code: item.KEY || item.DATA.KEY,
                    description: item.DATA.VALUE,
                    section: sectionName,
                    vendor: 'BRT'
                  });
                }
              });
            }
          });
        }

      } else if (vendor === 'Microsystems') {
        // Enhanced Microsystems parsing with proper cleaning
        const fieldCodes = job.parsed_code_definitions.field_codes;
        const flatLookup = job.parsed_code_definitions.flat_lookup;
        
        debugLog('CODES', 'Microsystems parsed structure:', {
          hasFieldCodes: !!fieldCodes,
          hasFlatLookup: !!flatLookup,
          fieldCodesKeys: fieldCodes ? Object.keys(fieldCodes) : [],
          has140Category: !!(fieldCodes && fieldCodes['140']),
          rawKeys: Object.keys(job.parsed_code_definitions).filter(k => k.startsWith('140')).slice(0, 5)
        });

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
      debugLog('CODES', `✅ FINAL: Loaded ${codes.length} clean InfoBy codes from ${vendor}`, 
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
        debugLog('CATEGORIES', '✅ Loaded existing category config from infoby_category_config field');
      } else if (!error && job?.workflow_stats?.infoByCategoryConfig) {
        const oldConfig = job.workflow_stats.infoByCategoryConfig;
        setInfoByCategoryConfig(oldConfig);
        setOriginalCategoryConfig(oldConfig);
        debugLog('CATEGORIES', '✅ Migrated category config from workflow_stats');
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
    debugLog('CATEGORIES', '✅ Set default category configuration', defaultConfig);
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
          // Persist fresh analytics data for navigation survival
          workflow_stats: analyticsToSave.analytics ? {
            ...analyticsToSave.analytics,
            billingAnalytics: analyticsToSave.billingAnalytics,
            validationReport: analyticsToSave.validationReport,
            missingPropertiesReport: analyticsToSave.missingPropertiesReport,
            validationOverrides: analyticsToSave.validationOverrides,
            overrideMap: analyticsToSave.overrideMap,
            lastProcessed: new Date().toISOString()
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

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('workflow_stats')
        .eq('id', jobData.id)
        .single();

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
        debugLog('PERSISTENCE', '✅ Loaded persisted analytics with override adjustments');
        addNotification('Previously processed analytics loaded', 'info');
      }
    } catch (error) {
      console.error('Error loading persisted analytics:', error);
    }
  };

  const loadProjectStartDate = async () => {
    if (!jobData?.id || !latestFileVersion) return;

    try {
      const { data: records, error } = await supabase
        .from('property_records')
        .select('project_start_date')
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion)
        .not('project_start_date', 'is', null)
        .limit(1)
        .single();

      if (!error && records?.project_start_date) {
        setProjectStartDate(records.project_start_date);
        setIsDateLocked(true);
        debugLog('START_DATE', `Loaded existing start date: ${records.project_start_date}`);
      }
    } catch (error) {
      debugLog('START_DATE', 'No existing start date found');
    }
  };

  const lockStartDate = async () => {
    if (!projectStartDate || !jobData?.id || !latestFileVersion) {
      addNotification('Please set a project start date first', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('property_records')
        .update({ project_start_date: projectStartDate })
        .eq('job_id', jobData.id)
        .eq('file_version', latestFileVersion);

      if (error) throw error;

      setIsDateLocked(true);
      addNotification('✅ Project start date locked and saved to all property records', 'success');
      debugLog('START_DATE', `Locked start date: ${projectStartDate}`);

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
          validInspections: Math.max(0, analytics.validInspections - 1), // Remove the override
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
      
      addNotification(`✅ Override removed - ${propertyKey} deleted from inspection_data`, 'success');
      addNotification('🔄 Reprocessing analytics to reflect changes...', 'info');

      // Trigger immediate analytics reprocessing
      setTimeout(async () => {
        await startProcessingSession();
      }, 1000);

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
          onConflict: 'job_id,property_composite_key,file_version'
        });

      if (upsertError) throw upsertError;

      // Close modal
      setShowOverrideModal(false);
      setSelectedOverrideProperty(null);
      setOverrideReason('New Construction');
      setCustomOverrideReason('');
      
      // Immediately reload validation overrides to get fresh data with all fields
      await loadValidationOverrides();
      
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
          validInspections: analytics.validInspections + 1, // Add the new override
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

      // Trigger immediate analytics reprocessing
      setTimeout(async () => {
        await startProcessingSession();
      }, 1000);

    } catch (error) {
      console.error('Error applying complete override:', error);
      addNotification('Error applying override: ' + error.message, 'error');
    }
  };

  // NEW: Handle override during processing modal
  const handleProcessingOverride = (propertyKey, reason) => {
    // Handle custom reason if needed
    const finalReason = reason === 'Other' ? 
      (pendingValidations.find(v => v.composite_key === propertyKey)?.custom_override_reason || 'Other') : 
      reason;
    
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
  };

  // Reset session
  const resetSession = () => {
    setSessionId(null);
    setSettingsLocked(false);
    setProcessed(false);
    setAnalytics(null);
    setBillingAnalytics(null);
    setValidationReport(null);
    setCommercialCounts({ inspected: 0, priced: 0 });
    setMissingPropertiesReport(null);
    setValidationOverrides([]);
    setOverrideMap({});
    setPendingValidations([]);
    setProcessedValidationDecisions({});
    setLoadedFromDatabase(false); // Reset database load flag
    setProcessingComplete(false);
    setCustomOverrideReason(''); // Reset custom override reason
    setCurrentValidationIndex(0); // Reset validation index
    addNotification('🔄 Session reset - settings unlocked', 'info');
  };

  // Initialize data loading
  useEffect(() => {
    if (jobData?.id && latestFileVersion) {
      const loadAllData = async () => {
        // Load all base data first
        await loadEmployeeData();
        await loadAvailableInfoByCodes();
        await loadProjectStartDate();
        await loadVendorSource();
        
        // Load validation overrides BEFORE loading persisted analytics
        await loadValidationOverrides();
        
        // Then load persisted analytics (which may need override data)
        await loadPersistedAnalytics();
        
        // Finally load commercial counts
        await loadCommercialCounts();
        
        setLoading(false);
      };
      
      loadAllData();
    }
  }, [jobData?.id, latestFileVersion]);

  // Track unsaved changes
  useEffect(() => {
    const hasChanges = JSON.stringify(infoByCategoryConfig) !== JSON.stringify(originalCategoryConfig);
    setHasUnsavedChanges(hasChanges);
  }, [infoByCategoryConfig, originalCategoryConfig]);

  // ENHANCED: Process analytics with manager-focused counting and inspection_data persistence
  const processAnalytics = async () => {
    if (!projectStartDate || !jobData?.id || !latestFileVersion) {
      addNotification('Project start date and job data required', 'error');
      return null;
    }

    try {
      // Get actual vendor from property_records
      const actualVendor = await loadVendorSource();
      
      debugLog('VENDOR', 'Vendor detection check', { 
        vendor_from_property_records: actualVendor,
        vendor_from_jobData: jobData.vendor_type,
        using_vendor: actualVendor || jobData.vendor_type
      });

      debugLog('ANALYTICS', 'Starting manager-focused analytics processing', { 
        jobId: jobData.id,
        fileVersion: latestFileVersion,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig,
        detectedVendor: actualVendor,
        hasAssignments: jobData.has_property_assignments // Log assignment status
      });

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

      // Load ALL records using pagination to bypass Supabase 1000 limit - WITH ASSIGNMENT FILTERING
      let allRecords = [];
      let start = 0;
      const batchSize = 1000;
      
      // For jobs with assignments, we need to be more careful about performance
      const hasLargeAssignments = jobData.has_property_assignments && jobData.assignedPropertyCount > 5000;
      
      debugLog('ANALYTICS', `Loading ${jobData.has_property_assignments ? 'ASSIGNED' : 'ALL'} property records using pagination...`);
      if (hasLargeAssignments) {
        debugLog('ANALYTICS', `⚠️ Large assignment detected (${jobData.assignedPropertyCount} properties) - using optimized loading`);
      }
      
      while (true) {
        // Build base query with minimal fields for large assignments
        let query = supabase
          .from('property_records')
          .select(`
            property_composite_key,
            property_block,
            property_lot,
            property_qualifier,
            property_addl_card,
            property_location,
            property_m4_class,
            inspection_info_by,
            inspection_list_by,
            inspection_list_date,
            inspection_measure_by,
            inspection_measure_date,
            inspection_price_by,
            inspection_price_date,
            values_mod_improvement
          `)
          .eq('job_id', jobData.id)
          .eq('file_version', latestFileVersion);

        // ADD ASSIGNMENT FILTER IF NEEDED
        if (jobData.has_property_assignments) {
          query = query.eq('is_assigned_property', true);
          debugLog('ANALYTICS', '🎯 Filtering for assigned properties only');
        }

        // For large assignments, add index hints
        if (hasLargeAssignments) {
          // Order by composite key for better index usage
          query = query.order('property_composite_key', { ascending: true });
        } else {
          // Regular ordering for smaller datasets
          query = query
            .order('property_block', { ascending: true })
            .order('property_lot', { ascending: true });
        }

        const { data: batchData, error: batchError } = await query
          .range(start, start + batchSize - 1);
        
        if (batchError) throw batchError;
        if (!batchData || batchData.length === 0) break;
        
        allRecords = [...allRecords, ...batchData];
        debugLog('ANALYTICS', `Loaded batch ${Math.floor(start/batchSize) + 1}: ${batchData.length} records (total: ${allRecords.length})`);
        
        // For very large datasets, show progress notification
        if (hasLargeAssignments && allRecords.length % 5000 === 0) {
          addNotification(`Loading assigned properties: ${allRecords.length.toLocaleString()} / ${jobData.assignedPropertyCount.toLocaleString()}`, 'info');
        }
        
        start += batchSize;
        
        if (batchData.length < batchSize) break;
      }
      
      const rawData = allRecords;
      debugLog('ANALYTICS', `✅ Loaded ${rawData?.length || 0} property records for analysis`);

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

      rawData.forEach((record, index) => {
        const inspector = record.inspection_measure_by || 'UNASSIGNED';
        const propertyClass = record.property_m4_class || 'UNKNOWN';
        const infoByCode = record.inspection_info_by;
        const measuredDate = record.inspection_measure_date ? new Date(record.inspection_measure_date) : null;
        const listDate = record.inspection_list_date ? new Date(record.inspection_list_date) : null;
        const priceDate = record.inspection_price_date ? new Date(record.inspection_price_date) : null;
        const propertyKey = record.property_composite_key;

        // Track this property's processing status
        let wasAddedToInspectionData = false;
        let reasonNotAdded = '';

        // Always count ALL properties for denominators (manager progress view)
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // Check for existing validation override FIRST - COMPLETELY SKIP if overridden
        const hasValidationOverride = overrideMapData[propertyKey]?.override_applied;

        if (hasValidationOverride) {
          debugLog('VALIDATION', `✅ Property ${propertyKey} has existing override - treating as VALID INSPECTION`);
          
          // Count overridden properties as VALID INSPECTIONS for progress tracking
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
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

          // Add to inspection_data batch with override info (preserve existing override)
          const inspectionRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
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
            source_file_name: record.source_file_name,
            upload_date: new Date().toISOString(),
            override_applied: true,
            override_reason: overrideMapData[propertyKey].override_reason
          };

          // Only add if we haven't already added this property
          if (!inspectionDataKeys.has(propertyKey)) {
            inspectionDataBatch.push(inspectionRecord);
            inspectionDataKeys.add(propertyKey);
            wasAddedToInspectionData = true;
          }
          
          // Skip to next property - NO validation needed, NO missing properties report
          return;
        }

        // Skip UNASSIGNED for inspector analytics but track for missing properties
        if (inspector === 'UNASSIGNED') {
          reasonNotAdded = 'Inspector UNASSIGNED';
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
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

        // Skip inspections before project start date (removes old inspector noise)
        if (measuredDate && measuredDate < startDate) {
          reasonNotAdded = 'Inspection date before project start date';
          missingProperties.push({
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
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

        // Skip inspectors with invalid initials (not in employee database)
        if (!employeeData[inspector]) {
          reasonNotAdded = `Inspector ${inspector} not found in employee database`;
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
            validation_issues: []
          });
          return;
        }

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
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

        // Check for any inspection attempt
        const hasAnyInspectionAttempt = (
          (record.inspection_measure_by && record.inspection_measure_by.trim() !== '') ||
          record.inspection_measure_date ||
          record.inspection_info_by ||
          record.inspection_list_by ||
          record.inspection_price_by
        );

        if (!hasAnyInspectionAttempt) {
          // Property not yet inspected - skip validation entirely
          reasonNotAdded = 'No inspection attempt - completely uninspected';
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
            validation_issues: []
          });
          return;
        }

        // Validate attempted inspections
        let isValidInspection = true;
        let hasValidMeasuredBy = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        let hasValidMeasuredDate = measuredDate && measuredDate >= startDate;
        
        // Vendor-specific validation logic - no padding for Microsystems!
        let hasValidInfoBy;
        let normalizedInfoBy;
        
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
              card: record.property_addl_card || '1',
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
        const isEntryCode = (infoByCategoryConfig.entry || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isRefusalCode = (infoByCategoryConfig.refusal || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isEstimationCode = (infoByCategoryConfig.estimation || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isPricedCode = (infoByCategoryConfig.priced || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const isSpecialCode = (infoByCategoryConfig.special || []).includes(actualVendor === 'BRT' ? normalizedInfoBy || infoByCode : infoByCode);
        const hasListingData = record.inspection_list_by && record.inspection_list_date;

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

        // NEW: Collect validation issues for processing modal
        if (!isValidInspection && propertyIssues[propertyKey]) {
          pendingValidationsList.push({
            property: record,
            composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
            property_location: record.property_location || '',
            property_class: propertyClass,
            inspector: inspector,
            issues: propertyIssues[propertyKey].issues,
            warning_message: propertyIssues[propertyKey].issues.join(' | ')
          });
        }

        // Process valid inspections
        if (isValidInspection && hasValidInfoBy && hasValidMeasuredBy && hasValidMeasuredDate) {
          
          // Count for manager progress (valid inspections against total properties)
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
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

            debugLog('PRICING', `Commercial property ${propertyKey} - Class: ${propertyClass}, InfoBy: ${infoByCode}, Vendor: ${currentVendor}`);
            debugLog('PRICING', `isPricedCode: ${isPricedCode}, Priced category: [${(infoByCategoryConfig.priced || []).join(', ')}]`);

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
              debugLog('PRICING', `✅ BRT pricing counted for ${inspector} on ${propertyKey}`);
              
            } else if (currentVendor === 'Microsystems' && isPricedCode) {
              inspectorStats[inspector].priced++;
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].priced++;
              }
              debugLog('PRICING', `✅ Microsystems pricing counted for ${inspector} on ${propertyKey}`);
            } else {
              debugLog('PRICING', `❌ No pricing counted for ${inspector} on ${propertyKey} - Vendor: ${currentVendor}, isPricedCode: ${isPricedCode}`);
            }
          }

          // Prepare for inspection_data UPSERT - BUT DON'T UPSERT YET
          const inspectionRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: record.property_addl_card || '1',
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
            source_file_name: record.source_file_name,
            upload_date: new Date().toISOString(),
            validation_report: propertyIssues[propertyKey] ? {
              issues: propertyIssues[propertyKey].issues,
              severity: propertyIssues[propertyKey].issues.length > 2 ? 'high' : 'medium'
            } : null
          };

          // Just collect the record, don't save yet
          inspectionDataBatch.push(inspectionRecord);
          wasAddedToInspectionData = true;
        }

        // Track properties that didn't make it to inspection_data
        if (!wasAddedToInspectionData) {
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
      });

      // Process ALL records first - collect validation issues and valid records
      debugLog('ANALYTICS', `Finished processing ${rawData.length} records. Found ${pendingValidationsList.length} validation issues.`);

      // NOW handle validation modal if there are issues
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
          
          const overrideRecord = {
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: override.composite_key,
            block: override.property.property_block,
            lot: override.property.property_lot,
            qualifier: override.property.property_qualifier || '',
            card: override.property.property_addl_card || '1',
            property_location: override.property.property_location || '',
            property_class: override.property.property_m4_class,
            measure_by: override.property.inspection_measure_by,
            measure_date: override.property.inspection_measure_date,
            info_by_code: override.property.inspection_info_by,
            list_by: override.property.inspection_list_by,
            list_date: override.property.inspection_list_date,
            price_by: override.property.inspection_price_by,
            price_date: override.property.inspection_price_date,
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
          const propertyClass = override.property.property_m4_class;
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
          }
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
              onConflict: 'job_id,property_composite_key,file_version'
            });

          if (upsertError) {
            console.error('Error upserting to inspection_data:', upsertError);
            addNotification(`Error saving to inspection_data: ${upsertError.message}`, 'error');
          } else {
            debugLog('PERSISTENCE', '✅ Successfully upserted ALL records to inspection_data');
            addNotification(`✅ Successfully saved ${inspectionDataBatch.length} records to inspection_data`, 'success');
            // Reload commercial counts after successful processing
            await loadCommercialCounts();
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

      // Calculate job-level totals
      const totalInspected = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.totalInspected, 0);
      
      // FIX: CORRECT GLOBAL ENTRY RATE CALCULATION
      // Use classBreakdown totals, NOT inspector stats
      const totalClass2And3AProperties = (classBreakdown['2']?.total || 0) + (classBreakdown['3A']?.total || 0);
      const totalEntry = (classBreakdown['2']?.entry || 0) + (classBreakdown['3A']?.entry || 0);
      const totalRefusal = (classBreakdown['2']?.refusal || 0) + (classBreakdown['3A']?.refusal || 0);

      debugLog('ENTRY_RATE_FIX', 'Global entry rate calculation', {
        totalEntry,
        totalClass2And3AProperties,
        classBreakdown2Entry: classBreakdown['2']?.entry || 0,
        classBreakdown3AEntry: classBreakdown['3A']?.entry || 0,
        expectedRate: totalClass2And3AProperties > 0 ? Math.round((totalEntry / totalClass2And3AProperties) * 100) : 0
      });

      // Commercial percentage calculations (valid ÷ total, not valid ÷ valid)
      const totalCommercialProperties = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.total || 0), 0);
      const totalCommercialInspected = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.inspected || 0), 0);
      const totalPriced = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);

      debugLog('TOTALS', `Total priced calculation: ${totalPriced}, Inspector stats:`, Object.values(inspectorStats).map(s => ({name: s.name, priced: s.priced})));
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
          uninspected_count: missingProperties.filter(p => p.reason.includes('No inspection attempt')).length,
          validation_failed_count: missingProperties.filter(p => p.reason.includes('Failed validation')).length,
          by_reason: missingProperties.reduce((acc, prop) => {
            const reason = prop.reason;
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
          }, {}),
          by_inspector: missingProperties.reduce((acc, prop) => {
            const inspector = prop.inspector || 'UNASSIGNED';
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
        
        // Commercial metrics using inspector totals not class breakdown
        commercialInspections: totalCommercialInspected,
        commercialPricing: totalPriced,
        totalCommercialProperties,
        commercialCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialInspected / totalCommercialProperties) * 100) : 0,
        pricingCompletePercent: totalCommercialProperties > 0 ? Math.round((totalPriced / totalCommercialProperties) * 100) : 0
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

      setAnalytics(analyticsResult);
      setBillingAnalytics(billingResult);
      setValidationReport(validationReportData);
      setMissingPropertiesReport(missingPropertiesReportData);

      // DON'T clear modal state here - wait for user to close it
      // setPendingValidations([]);
      // setProcessedValidationDecisions({});
      // setShowProcessingModal(false);

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
      
      debugLog('FRESH_OVERRIDES', `Fetched ${currentOverrides?.length || 0} fresh validation overrides`);
      return currentOverrides || [];
    } catch (error) {
      console.error('Error in getFreshValidationOverrides:', error);
      return [];
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
      debugLog('SESSION', 'Starting processing session', { 
        sessionId: newSessionId,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig 
      });

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

    let csvContent = "Inspector,Total Issues,Inspector Name\n";
    
    validationReport.summary.inspector_breakdown.forEach(inspector => {
      csvContent += `"${inspector.inspector_code}","${inspector.total_issues}","${inspector.inspector_name}"\n`;
    });

    csvContent += "\n\nDetailed Issues:\n";
    csvContent += "Inspector,Block,Lot,Qualifier,Card,Property Location,Warning Message\n";
    
    Object.keys(validationReport.detailed_issues).forEach(inspector => {
      const issues = validationReport.detailed_issues[inspector];
      issues.forEach(issue => {
        csvContent += `"${inspector}","${issue.block}","${issue.lot}","${issue.qualifier}","${issue.card}","${issue.property_location}","${issue.warning_message}"\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inspection_Validation_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Validation report exported', 'success');
  };

  const exportMissingPropertiesReport = () => {
    if (!missingPropertiesReport || !missingPropertiesReport.detailed_missing) return;

    let csvContent = "Summary\n";
    csvContent += `Total Missing Properties,${missingPropertiesReport.summary.total_missing}\n`;
    csvContent += `Uninspected Count,${missingPropertiesReport.summary.uninspected_count}\n`;
    csvContent += `Validation Failed Count,${missingPropertiesReport.summary.validation_failed_count}\n\n`;

    csvContent += "Breakdown by Reason\n";
    csvContent += "Reason,Count\n";
    Object.entries(missingPropertiesReport.summary.by_reason).forEach(([reason, count]) => {
      csvContent += `"${reason}","${count}"\n`;
    });

    csvContent += "\nBreakdown by Inspector\n";
    csvContent += "Inspector,Count\n";
    Object.entries(missingPropertiesReport.summary.by_inspector).forEach(([inspector, count]) => {
      csvContent += `"${inspector}","${count}"\n`;
    });

    csvContent += "\nDetailed Missing Properties\n";
    csvContent += "Block,Lot,Qualifier,Card,Property Location,Class,Inspector,InfoBy Code,Measure Date,Reason\n";
    
    missingPropertiesReport.detailed_missing.forEach(property => {
      csvContent += `"${property.block}","${property.lot}","${property.qualifier}","${property.card || '1'}","${property.property_location}","${property.property_class}","${property.inspector}","${property.info_by_code || ''}","${property.measure_date || ''}","${property.reason}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Missing_Properties_Report_${jobData.ccdd || jobData.ccddCode}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    addNotification('📊 Missing properties report exported', 'success');
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
                  // Use the tracked index or find first unskipped/unoverridden
                  const currentIndex = pendingValidations.findIndex(v => !v.overridden && !v.skipped);
                  const displayIndex = currentIndex >= 0 ? currentIndex : currentValidationIndex;
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
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                  Override Reason:
                                </label>
                                <select
                                  value={currentValidation.override_reason || 'New Construction'}
                                  onChange={(e) => {
                                    setPendingValidations(prev => 
                                      prev.map(v => 
                                        v.composite_key === currentValidation.composite_key 
                                          ? { ...v, override_reason: e.target.value }
                                          : v
                                      )
                                    );
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="New Construction">New Construction</option>
                                  <option value="Additional Card">Additional Card</option>
                                  <option value="Other">Other (Custom)</option>
                                </select>
                              </div>
                              
                              {currentValidation.override_reason === 'Other' && (
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Custom Reason:
                                  </label>
                                  <input
                                    type="text"
                                    value={currentValidation.custom_override_reason || ''}
                                    onChange={(e) => {
                                      setPendingValidations(prev => 
                                        prev.map(v => 
                                          v.composite_key === currentValidation.composite_key 
                                            ? { ...v, custom_override_reason: e.target.value }
                                            : v
                                        )
                                      );
                                    }}
                                    placeholder="Enter custom override reason"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                  />
                                </div>
                              )}
                              
                              <div className="flex space-x-3">
                                <button
                                  onClick={() => {
                                    const finalReason = currentValidation.override_reason === 'Other' 
                                      ? currentValidation.custom_override_reason 
                                      : currentValidation.override_reason || 'New Construction';
                                    handleProcessingOverride(currentValidation.composite_key, finalReason);
                                  }}
                                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                                  disabled={currentValidation.override_reason === 'Other' && !currentValidation.custom_override_reason}
                                >
                                  Override Issue
                                </button>
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
                  <p className="text-sm text-gray-600">Total Properties</p>
                  <p className="text-2xl font-bold text-blue-600">{propertyRecordsCount?.toLocaleString() || analytics.totalRecords.toLocaleString()}</p>
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
        {(analytics || commercialCounts.inspected > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Commercial Complete</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {analytics && analytics.totalCommercialProperties > 0 ? 
                      Math.round((analytics.commercialInspections / analytics.totalCommercialProperties) * 100) : 
                      jobData.totalcommercial > 0 ? Math.round((commercialCounts.inspected / jobData.totalcommercial) * 100) : 0}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {analytics ? 
                      `${analytics.commercialInspections.toLocaleString()} of ${analytics.totalCommercialProperties.toLocaleString()} properties` :
                      `${commercialCounts.inspected.toLocaleString()} of ${(jobData.totalcommercial || 0).toLocaleString()} properties`
                    }
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
                    {analytics && analytics.totalCommercialProperties > 0 ? 
                      Math.round((analytics.commercialPricing / analytics.totalCommercialProperties) * 100) : 
                      jobData.totalcommercial > 0 ? Math.round((commercialCounts.priced / jobData.totalcommercial) * 100) : 0}%
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {analytics ? 
                      `${analytics.commercialPricing.toLocaleString()} of ${analytics.totalCommercialProperties.toLocaleString()} properties` :
                      `${commercialCounts.priced.toLocaleString()} of ${(jobData.totalcommercial || 0).toLocaleString()} properties`
                    }
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Missing Report</span>
                    </button>
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
                            <p className="text-sm text-gray-600 font-medium">Uninspected</p>
                            <p className="text-2xl font-bold text-gray-800">{missingPropertiesReport.summary.uninspected_count}</p>
                            <p className="text-xs text-gray-500">No inspection attempt</p>
                          </div>
                          <Eye className="w-8 h-8 text-gray-500" />
                        </div>
                      </div>

                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-red-600 font-medium">Validation Failed</p>
                            <p className="text-2xl font-bold text-red-800">{missingPropertiesReport.summary.validation_failed_count}</p>
                            <p className="text-xs text-red-500">Attempted but invalid</p>
                          </div>
                          <X className="w-8 h-8 text-red-500" />
                        </div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-blue-600 font-medium">Success Rate</p>
                            <p className="text-2xl font-bold text-blue-800">
                              {analytics?.totalRecords > 0 ? 
                                Math.round(((analytics.totalRecords - missingPropertiesReport.summary.total_missing) / analytics.totalRecords) * 100) : 0}%
                            </p>
                            <p className="text-xs text-blue-500">Properties processed</p>
                          </div>
                          <CheckCircle className="w-8 h-8 text-blue-500" />
                        </div>
                      </div>
                    </div>

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
                                property.reason.includes('No inspection attempt') ? 'bg-gray-50' : 'bg-red-50'
                              }`}>
                                <td className="px-3 py-2 font-medium">{property.block}</td>
                                <td className="px-3 py-2 font-medium">{property.lot}</td>
                                <td className="px-3 py-2">{property.qualifier || '-'}</td>
                                <td className="px-3 py-2">{property.card || '1'}</td>
                                <td className="px-3 py-2">{property.property_location}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                                    {property.property_class}
                                  </span>
                                </td>
                                <td className="px-3 py-2">{property.inspector}</td>
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
