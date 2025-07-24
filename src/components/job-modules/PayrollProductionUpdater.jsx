import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

// 🔧 ENHANCED: Accept App.js state management props
const PayrollProductionUpdater = ({ 
  jobData, 
  onBackToJobs, 
  latestFileVersion, 
  propertyRecordsCount,
  // NEW: App.js integration props
  currentWorkflowStats,
  onAnalyticsUpdate,
  onUpdateWorkflowStats
}) => {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState(false);
  const [employeeData, setEmployeeData] = useState({});
  const [analytics, setAnalytics] = useState(null);
  const [billingAnalytics, setBillingAnalytics] = useState(null);
  const [validationReport, setValidationReport] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  
  // Settings state - Enhanced InfoBy category configuration
  const [availableInfoByCodes, setAvailableInfoByCodes] = useState([]);
  const [infoByCategoryConfig, setInfoByCategoryConfig] = useState({
    entry: [],
    refusal: [],
    estimation: [],
    invalid: [],
    priced: []
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

  const addNotification = (message, type = 'info') => {
    const id = Date.now();
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

  // 🔧 NEW: Check for existing App.js analytics on component mount
  useEffect(() => {
    if (currentWorkflowStats?.isProcessed && currentWorkflowStats.totalRecords > 0) {
      debugLog('APP_STATE', '📊 Loading existing analytics from App.js state');
      
      // Reconstruct analytics from App.js format
      const existingAnalytics = {
        totalRecords: currentWorkflowStats.totalRecords,
        validInspections: currentWorkflowStats.validInspections,
        jobEntryRate: currentWorkflowStats.jobEntryRate,
        jobRefusalRate: currentWorkflowStats.jobRefusalRate,
        commercialCompletePercent: currentWorkflowStats.commercialCompletePercent,
        pricingCompletePercent: currentWorkflowStats.pricingCompletePercent,
        classBreakdown: currentWorkflowStats.classBreakdown,
        inspectorStats: currentWorkflowStats.inspectorStats,
        lastProcessed: currentWorkflowStats.lastProcessed
      };

      setAnalytics(existingAnalytics);
      setBillingAnalytics(currentWorkflowStats.billingAnalytics);
      setValidationReport(currentWorkflowStats.validationReport);
      setProcessed(true);
      setSettingsLocked(true);
      
      addNotification('Analytics loaded from App.js state', 'info');
      debugLog('APP_STATE', '✅ Analytics restored from App.js state');
    }
  }, [currentWorkflowStats]);

  // Load employee data for inspector details
  const loadEmployeeData = async () => {
    try {
      const { data: employees, error } = await supabase
        .from('employees')
        .select('id, first_name, last_name, inspector_type, employment_status, initials')
        .in('inspector_type', ['Residential', 'Commercial', 'Management']); // Only actual inspectors

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
      debugLog('EMPLOYEES', 'Loaded inspector data with types', { 
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
        
        // FIXED: Look for InfoBy codes in Residential section, key 30, MAP - LOAD ALL CODES
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
        Object.keys(job.parsed_code_definitions).forEach(code => {
          if (code.startsWith('140')) {
            const description = job.parsed_code_definitions[code];
            codes.push({
              code: code,
              description: description,
              section: 'InfoBy',
              vendor: 'Microsystems',
              storageCode: code.substring(3) // Strip 140 prefix for storage (140A -> A)
            });
          }
        });
      }

      setAvailableInfoByCodes(codes);
      debugLog('CODES', `✅ Loaded ${codes.length} InfoBy codes from ${vendor} definitions`);

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
    const defaultConfig = { entry: [], refusal: [], estimation: [], invalid: [], priced: [] };

    if (vendor === 'BRT') {
      codes.forEach(item => {
        const desc = item.description.toUpperCase();
        if (desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT') || desc.includes('AGENT') || desc.includes('EMPLOYEE')) {
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
        // NOTE: Codes that don't match any keywords will be left unassigned for manual configuration
      });
    } else if (vendor === 'Microsystems') {
      codes.forEach(item => {
        const storageCode = item.storageCode;
        const desc = item.description.toUpperCase();
        if (desc.includes('AGENT') || desc.includes('OWNER') || desc.includes('SPOUSE') || desc.includes('TENANT')) {
          defaultConfig.entry.push(storageCode);
        } else if (desc.includes('REFUSED')) {
          defaultConfig.refusal.push(storageCode);
        } else if (desc.includes('ESTIMATED') || desc.includes('VACANT')) {
          defaultConfig.estimation.push(storageCode);
        } else if (desc.includes('PRICED') || desc.includes('NARRATIVE') || desc.includes('ENCODED')) {
          defaultConfig.priced.push(storageCode);
        }
      });
    }

    setInfoByCategoryConfig(defaultConfig);
    setOriginalCategoryConfig(defaultConfig);
    setHasUnsavedChanges(true);
    debugLog('CATEGORIES', '✅ Set default category configuration', defaultConfig);
  };

  // Save category configuration to database and persist analytics
  const saveCategoriesToDatabase = async (config = null) => {
    if (!jobData?.id) return;

    const configToSave = config || infoByCategoryConfig;

    try {
      const { error } = await supabase
        .from('jobs')
        .update({ 
          infoby_category_config: {
            ...configToSave,
            vendor_type: jobData.vendor_type,
            last_updated: new Date().toISOString()
          },
          // ENHANCED: Persist analytics data for navigation survival
          workflow_stats: analytics ? {
            ...analytics,
            billingAnalytics,
            validationReport,
            lastProcessed: new Date().toISOString()
          } : undefined
        })
        .eq('id', jobData.id);

      if (error) throw error;
      
      setOriginalCategoryConfig(configToSave);
      setHasUnsavedChanges(false);
      addNotification('✅ Configuration and analytics saved', 'success');
      debugLog('PERSISTENCE', '✅ Saved config and analytics to job record');
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
        setAnalytics(job.workflow_stats);
        setBillingAnalytics(job.workflow_stats.billingAnalytics);
        setValidationReport(job.workflow_stats.validationReport);
        setProcessed(true);
        setSettingsLocked(true);
        debugLog('PERSISTENCE', '✅ Loaded persisted analytics from job record');
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

  // Initialize data loading
  useEffect(() => {
    if (jobData?.id && latestFileVersion) {
      loadEmployeeData();
      loadAvailableInfoByCodes();
      loadProjectStartDate();
      loadPersistedAnalytics(); // ENHANCED: Load persisted analytics
      loadVendorSource(); // NEW: Load vendor source for display
      setLoading(false);
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
      // NEW: Get actual vendor from property_records
      const actualVendor = await loadVendorSource();
      
      // VENDOR DETECTION DEBUG
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
        detectedVendor: actualVendor
      });

      // Get all valid InfoBy codes for validation
      const allValidCodes = [
        ...infoByCategoryConfig.entry,
        ...infoByCategoryConfig.refusal,
        ...infoByCategoryConfig.estimation,
        ...infoByCategoryConfig.priced
      ];

      // Load ALL records using pagination to bypass Supabase 1000 limit
      let allRecords = [];
      let start = 0;
      const batchSize = 1000;
      
      debugLog('ANALYTICS', 'Loading all property records using pagination...');
      
      while (true) {
        const { data: batchData, error: batchError } = await supabase
          .from('property_records')
          .select(`
            property_composite_key,
            property_block,
            property_lot,
            property_qualifier,
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
          .eq('file_version', latestFileVersion)
          .order('property_block', { ascending: true })
          .order('property_lot', { ascending: true })
          .range(start, start + batchSize - 1);
        
        if (batchError) throw batchError;
        if (!batchData || batchData.length === 0) break;
        
        allRecords = [...allRecords, ...batchData];
        debugLog('ANALYTICS', `Loaded batch ${Math.floor(start/batchSize) + 1}: ${batchData.length} records (total: ${allRecords.length})`);
        
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
      const inspectionDataBatch = []; // NEW: For inspection_data UPSERT

      // Initialize class counters - FIXED: Count ALL properties for denominators
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
        const propertyKey = record.property_composite_key || `${record.property_block}-${record.property_lot}-${record.property_qualifier || ''}`;

        // FIXED: Always count ALL properties for denominators (manager progress view)
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // Skip UNASSIGNED for inspector analytics but continue for totals
        if (inspector === 'UNASSIGNED') return;

        // ENHANCED: Skip inspections before project start date (removes old inspector noise)
        if (measuredDate && measuredDate < startDate) {
          return; // Completely skip old inspections from analytics and validation
        }

        // ENHANCED: Skip inspectors with invalid initials (not in employee database)
        if (!employeeData[inspector]) {
          return; // Skip CM, MJ, X, PL, RH - invalid inspectors entirely
        }

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
          const employeeInfo = employeeData[inspector] || {};
          inspectorStats[inspector] = {
            name: employeeInfo.name || inspector,
            fullName: employeeInfo.fullName || inspector,
            inspector_type: employeeInfo.inspector_type,
            totalInspected: 0, // NEW: All valid inspections
            residentialInspected: 0, // NEW: 2, 3A only
            commercialInspected: 0, // NEW: 4A, 4B, 4C only
            entry: 0,
            refusal: 0,
            priced: 0,
            // NEW: Separate field day tracking
            allWorkDays: new Set(),
            residentialWorkDays: new Set(), // Days with 2/3A work
            commercialWorkDays: new Set(), // Days with 4A/4B/4C work
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
          return;
        }

        // Validate attempted inspections
        let isValidInspection = true;
        let hasValidMeasuredBy = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        let hasValidMeasuredDate = measuredDate && measuredDate >= startDate;
        
        const normalizedInfoBy = infoByCode?.toString().padStart(2, '0');
        const normalizedValidCodes = allValidCodes.map(code => code.toString().padStart(2, '0'));
        let hasValidInfoBy = normalizedInfoBy && normalizedValidCodes.includes(normalizedInfoBy);
        
        // Compound validation messages per property
        const addValidationIssue = (message) => {
          if (!propertyIssues[propertyKey]) {
            propertyIssues[propertyKey] = {
              block: record.property_block,
              lot: record.property_lot,
              qualifier: record.property_qualifier || '',
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

        // Business logic validation
        const isEntryCode = infoByCategoryConfig.entry.includes(normalizedInfoBy);
        const isRefusalCode = infoByCategoryConfig.refusal.includes(normalizedInfoBy);
        const isEstimationCode = infoByCategoryConfig.estimation.includes(normalizedInfoBy);
        const isPricedCode = infoByCategoryConfig.priced.includes(normalizedInfoBy);
        const hasListingData = record.inspection_list_by && record.inspection_list_date;

        if (isRefusalCode && !hasListingData) {
          addValidationIssue(`Refusal code ${infoByCode} but missing listing data`);
        }
        if (isEntryCode && !hasListingData) {
          addValidationIssue(`Entry code ${infoByCode} but missing listing data`);
        }
        if (isEstimationCode && hasListingData) {
          addValidationIssue(`Estimation code ${infoByCode} but has listing data`);
        }

        // NEW: Corrected inspector type validation
        const isCommercialProperty = ['4A', '4B', '4C'].includes(propertyClass);
        const isResidentialProperty = ['2', '3A'].includes(propertyClass);
        const isResidentialInspector = employeeData[inspector]?.inspector_type === 'residential';
        
        // Residential inspectors CAN'T do commercial (4A, 4B, 4C) - everything else is OK
        if (isCommercialProperty && isResidentialInspector) {
          addValidationIssue(`Residential inspector on commercial property`);
        }

        if (record.values_mod_improvement === 0 && !hasListingData) {
          addValidationIssue('Zero improvement property missing listing data');
        }

        // NEW: Process valid inspections with corrected counting
        if (isValidInspection && hasValidInfoBy && hasValidMeasuredBy && hasValidMeasuredDate) {
          
          // Count for manager progress (valid inspections against total properties)
          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
          }

          // Inspector analytics - count ALL valid inspections
          inspectorStats[inspector].totalInspected++;
          
          const workDayString = measuredDate.toISOString().split('T')[0];
          inspectorStats[inspector].allWorkDays.add(workDayString);

          // NEW: Separate residential and commercial counting for analytics
          if (isResidentialProperty) {
            inspectorStats[inspector].residentialInspected++;
            inspectorStats[inspector].residentialWorkDays.add(workDayString);
            
            // Entry/Refusal counting (only for residential properties 2, 3A)
            if (isEntryCode) {
              inspectorStats[inspector].entry++;
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].entry++;
              }
            } else if (isRefusalCode) {
              inspectorStats[inspector].refusal++;
              if (classBreakdown[propertyClass]) {
                classBreakdown[propertyClass].refusal++;
              }
            }
          }
          
          if (isCommercialProperty) {
            inspectorStats[inspector].commercialInspected++;
            inspectorStats[inspector].commercialWorkDays.add(workDayString);
          }

          // FIXED: Pricing logic with vendor detection
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

          // NEW: Prepare for inspection_data UPSERT
          inspectionDataBatch.push({
            job_id: jobData.id,
            file_version: latestFileVersion,
            property_composite_key: propertyKey,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: '1',
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
          });
        }
      });

      // NEW: UPSERT to inspection_data table for persistence
      if (inspectionDataBatch.length > 0) {
        debugLog('PERSISTENCE', `Upserting ${inspectionDataBatch.length} records to inspection_data`);
        
        const { error: upsertError } = await supabase
          .from('inspection_data')
          .upsert(inspectionDataBatch, {
            onConflict: 'job_id,property_composite_key,file_version'
          });

        if (upsertError) {
          console.error('Error upserting to inspection_data:', upsertError);
          addNotification('Warning: Could not save to inspection_data table', 'warning');
        } else {
          debugLog('PERSISTENCE', '✅ Successfully upserted to inspection_data');
        }
      }

      // NEW: Calculate inspector rates and averages with corrected field day logic
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

        // NEW: Type-specific daily averages
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
          card: '1',
          property_location: property.property_location,
          warning_message: compoundMessage,
          inspector: property.inspector,
          severity: property.issues.length > 2 ? 'high' : 'medium'
        };
        
        validationIssues.push(issue);
        
        if (!inspectorIssuesMap[property.inspector]) {
          inspectorIssuesMap[property.inspector] = [];
        }
        inspectorIssuesMap[property.inspector].push(issue);
      });

      // Calculate job-level totals
      const totalInspected = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.totalInspected, 0);
      const totalResidentialInspected = Object.values(inspectorStats).reduce((sum, stats) => sum + (stats.residentialInspected || 0), 0);
      const totalEntry = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.entry, 0);
      const totalRefusal = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.refusal, 0);
      const totalPriced = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);

      // FIXED: Commercial percentage calculations (valid ÷ total, not valid ÷ valid)
      const totalCommercialProperties = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.total || 0), 0);
      const totalCommercialInspected = ['4A', '4B', '4C'].reduce((sum, cls) => sum + (classBreakdown[cls]?.inspected || 0), 0);
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

      const analyticsResult = {
        totalRecords: rawData.length,
        validInspections: totalInspected,
        inspectorStats,
        classBreakdown,
        validationIssues: validationIssues.length,
        processingDate: new Date().toISOString(),
        
        // Job-level metrics based on residential properties only (2, 3A)
        jobEntryRate: totalResidentialInspected > 0 ? Math.round((totalEntry / totalResidentialInspected) * 100) : 0,
        jobRefusalRate: totalResidentialInspected > 0 ? Math.round((totalRefusal / totalResidentialInspected) * 100) : 0,
        
        // FIXED: Commercial metrics with correct percentages
        commercialInspections: totalCommercialInspected,
        commercialPricing: totalCommercialPriced,
        totalCommercialProperties,
        commercialCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialInspected / totalCommercialProperties) * 100) : 0,
        pricingCompletePercent: totalCommercialProperties > 0 ? Math.round((totalCommercialPriced / totalCommercialProperties) * 100) : 0
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

      debugLog('ANALYTICS', '✅ Manager-focused analytics processing complete', {
        totalRecords: rawData.length,
        validInspections: analyticsResult.validInspections,
        totalIssues: validationIssues.length,
        inspectors: Object.keys(inspectorStats).length,
        commercialComplete: analyticsResult.commercialCompletePercent,
        pricingComplete: analyticsResult.pricingCompletePercent,
        persistedRecords: inspectionDataBatch.length
      });

      return { analyticsResult, billingResult, validationReportData };

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

  // ENHANCED: Start processing session with App.js state integration
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

      // ENHANCED: Persist to database for navigation survival
      await saveCategoriesToDatabase();

      // 🔧 NEW: Update App.js state with analytics results
      if (onAnalyticsUpdate && results.analyticsResult) {
        debugLog('SESSION', '📊 Updating App.js state with analytics results');
        onAnalyticsUpdate({
          ...results.analyticsResult,
          billingAnalytics: results.billingResult,
          validationReport: results.validationReportData
        });
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

  // ENHANCED: Progress bar component
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

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Factory className="w-8 h-8 mr-3 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">PayrollProductionUpdater</h1>
              <p className="text-gray-600">
                {jobData.name} - Enhanced Analytics & Validation Engine
                {detectedVendor && <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                  {detectedVendor} Format
                </span>}
              </p>
            </div>
          </div>
          <button
            onClick={onBackToJobs}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all"
          >
            ← Back to Jobs
          </button>
        </div>

        {/* ENHANCED: Quick Stats with App.js Integration - FIXED: Added safety checks */}
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Properties</p>
                  <p className="text-2xl font-bold text-blue-600">
                    {propertyRecordsCount?.toLocaleString() || (analytics.totalRecords || 0).toLocaleString()}
                  </p>
                  {currentWorkflowStats?.isProcessed && (
                    <p className="text-xs text-green-600 mt-1">✅ Synced with App.js</p>
                  )}
                </div>
                <TrendingUp className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Inspections</p>
                  <p className="text-2xl font-bold text-green-600">{(analytics.validInspections || 0).toLocaleString()}</p>
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

        {/* ENHANCED: Commercial metrics with percentages and details - FIXED: Added safety checks */}
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Commercial Complete</p>
                  <p className="text-2xl font-bold text-blue-600">{analytics.commercialCompletePercent || 0}%</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {(analytics.commercialInspections || 0).toLocaleString()} of {(analytics.totalCommercialProperties || 0).toLocaleString()} properties
                  </p>
                </div>
                <Factory className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Pricing Complete</p>
                  <p className="text-2xl font-bold text-purple-600">{analytics.pricingCompletePercent || 0}%</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {(analytics.commercialPricing || 0).toLocaleString()} of {(analytics.totalCommercialProperties || 0).toLocaleString()} properties
                  </p>
                </div>
                <DollarSign className="w-8 h-8 text-purple-500" />
              </div>
            </div>
          </div>
        )}
      </div>

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
              InfoBy Categories ({availableInfoByCodes.length} codes available)
            </label>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span>Entry: {infoByCategoryConfig.entry.length} codes</span>
                <span>Refusal: {infoByCategoryConfig.refusal.length} codes</span>
                <span>Estimation: {infoByCategoryConfig.estimation.length} codes</span>
                <span>Priced: {infoByCategoryConfig.priced.length} codes</span>
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

        {/* NEW: Collapsible InfoBy Category Configuration Panel */}
        {availableInfoByCodes.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-md font-semibold text-gray-800">
                InfoBy Category Assignment ({jobData.vendor_type} Format)
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm mb-4">
              <div className="bg-green-50 px-3 py-2 rounded border">
                <span className="font-medium text-green-800">Entry:</span> {infoByCategoryConfig.entry.length}
              </div>
              <div className="bg-red-50 px-3 py-2 rounded border">
                <span className="font-medium text-red-800">Refusal:</span> {infoByCategoryConfig.refusal.length}
              </div>
              <div className="bg-blue-50 px-3 py-2 rounded border">
                <span className="font-medium text-blue-800">Estimation:</span> {infoByCategoryConfig.estimation.length}
              </div>
              <div className="bg-gray-50 px-3 py-2 rounded border">
                <span className="font-medium text-gray-800">Invalid:</span> {infoByCategoryConfig.invalid.length}
              </div>
              <div className="bg-purple-50 px-3 py-2 rounded border">
                <span className="font-medium text-purple-800">Priced:</span> {infoByCategoryConfig.priced.length}
              </div>
            </div>
            
            {/* Detailed Configuration (Collapsible) */}
            {showInfoByConfig && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {['entry', 'refusal', 'estimation', 'invalid', 'priced'].map(category => (
                  <div key={category} className="border border-gray-200 rounded-lg p-4">
                    <h5 className="font-medium text-gray-900 mb-3 capitalize">
                      {category} ({infoByCategoryConfig[category].length})
                    </h5>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {availableInfoByCodes.map(codeItem => {
                        const storageCode = jobData.vendor_type === 'Microsystems' ? codeItem.storageCode : codeItem.code;
                        const displayCode = storageCode;
                        const isAssigned = infoByCategoryConfig[category].includes(storageCode);
                        
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
                              <span className="font-medium">{displayCode}</span>
                              <div className="text-gray-600 text-xs leading-tight">{codeItem.description}</div>
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

        <div className="mt-6 flex justify-end">
          <button
            onClick={startProcessingSession}
            disabled={processing || (!isDateLocked) || hasUnsavedChanges ||
              (infoByCategoryConfig.entry.length + infoByCategoryConfig.refusal.length + 
               infoByCategoryConfig.estimation.length + infoByCategoryConfig.priced.length) === 0}
            className={`px-6 py-2 rounded-lg flex items-center space-x-2 transition-all ${
              processed 
                ? 'bg-green-600 text-white hover:bg-green-700'
                : processing
                ? 'bg-yellow-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {processing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : processed ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>
              {processing ? 'Processing...' : processed ? 'Processed ✓' : 'Start Processing Session'}
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
            </nav>
          </div>

          <div className="p-6">
            {/* NEW: Separate Residential and Commercial Inspector Analytics */}
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
                
                {Object.keys(analytics.inspectorStats).length === 0 ? (
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
                      
                      {Object.entries(analytics.inspectorStats).filter(([_, stats]) => stats.inspector_type === 'residential').length === 0 && (
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
                      
                      {Object.entries(analytics.inspectorStats).filter(([_, stats]) => stats.inspector_type === 'commercial').length === 0 && (
                        <div className="text-center py-4 text-blue-600">
                          <p>No commercial inspectors found</p>
                        </div>
                      )}
                    </div>

                    {/* MANAGEMENT INSPECTOR ANALYTICS */}
                    <div className="bg-purple-50 rounded-lg border border-purple-200 p-6">
                      <h4 className="text-lg font-semibold text-purple-800 mb-4 flex items-center">
                        <Users className="w-5 h-5 mr-2" />
                        Management Inspector Analytics  
                      </h4>
                      
                      {Object.entries(analytics.inspectorStats)
                        .filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'management')
                        .sort(([aKey, aStats], [bKey, bStats]) => {
                          switch (inspectorSort) {
                            case 'alphabetical':
                              return aStats.name.localeCompare(bStats.name);
                            case 'dailyAverage':
                              return (bStats.dailyAverage || 0) - (aStats.dailyAverage || 0);
                            case 'totalInspected':
                              return bStats.totalInspected - aStats.totalInspected;
                            default:
                              return 0;
                          }
                        })
                        .map(([inspector, stats]) => (
                          <div key={inspector} className="bg-white border border-purple-200 rounded-lg p-4 mb-3">
                            {/* Header Row */}
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
                            
                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
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
                              <div className="bg-purple-50 p-3 rounded">
                                <div className="font-bold text-purple-700 text-lg">{stats.dailyAverage || 0}</div>
                                <div className="text-xs text-purple-600 font-medium">Daily Average</div>
                                <div className="text-xs text-gray-500">Total ÷ Field Days</div>
                              </div>
                              <div className="bg-green-50 p-3 rounded">
                                <div className="font-bold text-green-700 text-lg">{stats.entryRate || 0}%</div>
                                <div className="text-xs text-green-600 font-medium">Entry Rate</div>
                                <div className="text-xs text-gray-500">On residential</div>
                              </div>
                              <div className="bg-red-50 p-3 rounded">
                                <div className="font-bold text-red-700 text-lg">{stats.refusalRate || 0}%</div>
                                <div className="text-xs text-red-600 font-medium">Refusal Rate</div>
                                <div className="text-xs text-gray-500">On residential</div>
                              </div>
                              <div className="bg-gray-50 p-3 rounded">
                                <div className="font-bold text-gray-700 text-lg">{(stats.totalInspected - stats.residentialInspected - stats.commercialInspected).toLocaleString()}</div>
                                <div className="text-xs text-gray-600 font-medium">Other Properties</div>
                                <div className="text-xs text-gray-500">Vacant, exempt, etc.</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      
                      {Object.entries(analytics.inspectorStats).filter(([_, stats]) => stats.inspector_type?.toLowerCase() === 'management').length === 0 && (
                        <div className="text-center py-4 text-purple-600">
                          <p>No management inspectors found</p>
                        </div>
                      )}
                    </div>
                    {/* UNTYPED INSPECTORS (If Any) */}
                    {Object.entries(analytics.inspectorStats)
                      .filter(([_, stats]) => !stats.inspector_type || 
                        (stats.inspector_type.toLowerCase() !== 'residential' && 
                         stats.inspector_type.toLowerCase() !== 'commercial' &&
                         stats.inspector_type.toLowerCase() !== 'management'))
                      .length > 0 && (
                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          Other Inspectors (No Type Assigned)
                        </h4>
                        
                        {Object.entries(analytics.inspectorStats)
                          .filter(([_, stats]) => !stats.inspector_type || 
                            (stats.inspector_type.toLowerCase() !== 'residential' && 
                             stats.inspector_type.toLowerCase() !== 'commercial' &&
                             stats.inspector_type.toLowerCase() !== 'management'))
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

            {/* ENHANCED: Summary for Billing with Progress Bars */}
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
                        <div className="flex justify-between items-center mb-2">
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

            {/* ENHANCED: Validation Report with Compound Messages */}
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
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Compound Issues</th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationReport.detailed_issues[selectedInspectorIssues].map((issue, idx) => (
                                <tr key={idx} className="border-t border-gray-200">
                                  <td className="px-3 py-2">{issue.block}</td>
                                  <td className="px-3 py-2">{issue.lot}</td>
                                  <td className="px-3 py-2">{issue.qualifier || '-'}</td>
                                  <td className="px-3 py-2">{issue.property_location}</td>
                                  <td className="px-3 py-2 text-red-600">{issue.warning_message}</td>
                                </tr>
                              ))}
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
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollProductionUpdater;
