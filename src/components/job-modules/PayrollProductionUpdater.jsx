import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

const PayrollProductionUpdater = ({ jobData, onBackToJobs, latestFileVersion, propertyRecordsCount }) => {
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

  // Load employee data for inspector details
  const loadEmployeeData = async () => {
    try {
      const { data: employees, error } = await supabase
        .from('employees')
        .select('id, first_name, last_name, inspector_type, employment_status, initials')
        .eq('employment_status', 'full_time');

      if (error) throw error;

      const employeeMap = {};
      employees.forEach(emp => {
        // Use database initials field directly
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
      debugLog('EMPLOYEES', 'Loaded employee data', { count: Object.keys(employeeMap).length });
    } catch (error) {
      console.error('Error loading employee data:', error);
      addNotification('Error loading employee data', 'error');
    }
  };

  // FIXED: Load available InfoBy codes from correct BRT location
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
        // FIXED: Handle BRT nested JSON structure - look in Residential section key 30
        const sections = job.parsed_code_definitions.sections || job.parsed_code_definitions;
        
        debugLog('CODES', 'BRT sections available:', Object.keys(sections));
        
        // Look for InfoBy codes in Residential section, key 30, MAP
        const residentialSection = sections['Residential'];
        if (residentialSection && residentialSection['30'] && residentialSection['30'].MAP) {
          debugLog('CODES', 'Found Residential[30].MAP, checking for InfoBy codes...');
          
          // InfoBy codes are in Residential['30']['MAP'] - look for entries with inspection-related descriptions
          Object.keys(residentialSection['30'].MAP).forEach(key => {
            const item = residentialSection['30'].MAP[key];
            if (item && item.DATA && item.DATA.VALUE) {
              const description = item.DATA.VALUE.toUpperCase();
              // Look for inspection-related terms
              if (description.includes('OWNER') || description.includes('SPOUSE') || 
                  description.includes('TENANT') || description.includes('AGENT') ||
                  description.includes('REFUSED') || description.includes('ESTIMATED') ||
                  description.includes('DOOR') || description.includes('CONVERSION') ||
                  description.includes('PRICED')) {
                
                codes.push({
                  code: item.KEY || item.DATA.KEY,
                  description: item.DATA.VALUE,
                  section: 'Residential[30]',
                  vendor: 'BRT'
                });
                
                debugLog('CODES', `Found InfoBy code: ${item.KEY} = ${item.DATA.VALUE}`);
              }
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
        // Handle Microsystems flattened structure - look for 140 prefix codes
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
        // Load from new dedicated field
        setInfoByCategoryConfig(job.infoby_category_config);
        setOriginalCategoryConfig(job.infoby_category_config);
        debugLog('CATEGORIES', '✅ Loaded existing category config from infoby_category_config field');
      } else if (!error && job?.workflow_stats?.infoByCategoryConfig) {
        // Migrate from old location
        const oldConfig = job.workflow_stats.infoByCategoryConfig;
        setInfoByCategoryConfig(oldConfig);
        setOriginalCategoryConfig(oldConfig);
        debugLog('CATEGORIES', '✅ Migrated category config from workflow_stats');
        // Auto-save to new location
        await saveCategoriesToDatabase(oldConfig);
      } else if (codes && codes.length > 0) {
        // Set smart defaults for new jobs
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
        const storageCode = item.storageCode; // Use the single letter (A, not 140A)
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
    setHasUnsavedChanges(true); // Mark as needing save
    debugLog('CATEGORIES', '✅ Set default category configuration', defaultConfig);
  };

  // Save category configuration to database
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
          }
        })
        .eq('id', jobData.id);

      if (error) throw error;
      
      setOriginalCategoryConfig(configToSave);
      setHasUnsavedChanges(false);
      addNotification('✅ InfoBy category configuration saved', 'success');
      debugLog('CATEGORIES', '✅ Saved category config to new infoby_category_config field');
    } catch (error) {
      console.error('Error saving category config:', error);
      addNotification('Error saving category configuration', 'error');
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
      // No existing start date found - that's okay
      debugLog('START_DATE', 'No existing start date found');
    }
  };

  // Lock start date - save to property_records
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

  // Unlock start date
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
      setLoading(false);
    }
  }, [jobData?.id, latestFileVersion]);

  // Track unsaved changes
  useEffect(() => {
    const hasChanges = JSON.stringify(infoByCategoryConfig) !== JSON.stringify(originalCategoryConfig);
    setHasUnsavedChanges(hasChanges);
  }, [infoByCategoryConfig, originalCategoryConfig]);

  // ENHANCED: Process analytics with efficient queries and proper validation rules
  const processAnalytics = async () => {
    if (!projectStartDate || !jobData?.id || !latestFileVersion) {
      addNotification('Project start date and job data required', 'error');
      return null;
    }

    try {
      debugLog('ANALYTICS', 'Starting enhanced analytics processing', { 
        jobId: jobData.id,
        fileVersion: latestFileVersion,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig 
      });

      const allValidCodes = [
        ...infoByCategoryConfig.entry,
        ...infoByCategoryConfig.refusal,
        ...infoByCategoryConfig.estimation,
        ...infoByCategoryConfig.priced
      ];

      // FIXED: Get ALL records with proper limit and correct field names
      const { data: rawData, error } = await supabase
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
        .limit(50000); // FIXED: Much higher limit to get all records

      if (error) throw error;

      debugLog('ANALYTICS', `✅ Loaded ${rawData?.length || 0} property records for analysis`);

      const startDate = new Date(projectStartDate);
      const inspectorStats = {};
      const classBreakdown = {};
      const billingByClass = {};
      const validationIssues = [];
      const inspectorIssuesMap = {};

      // Initialize class counters - FIXED: Include 4B in commercial
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

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
          const employeeInfo = employeeData[inspector] || {};
          inspectorStats[inspector] = {
            name: employeeInfo.name || inspector,
            fullName: employeeInfo.fullName || inspector,
            inspector_type: employeeInfo.inspector_type || 'unknown',
            inspected: 0,
            residentialInspected: 0,
            entry: 0,
            refusal: 0,
            priced: 0,
            classes: { residential: 0, commercial: 0, other: 0 },
            dailyAverage: 0,
            datesWorked: new Set()
          };
          inspectorIssuesMap[inspector] = [];
        }

        // Count totals
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // ENHANCED: New validation rules based on business logic
        let isValidInspection = true;
        let hasValidMeasuredBy = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        let hasValidMeasuredDate = measuredDate && measuredDate >= startDate;
        let hasValidInfoBy = infoByCode && allValidCodes.includes(infoByCode.toString());
        
        const addValidationIssue = (message, severity = 'medium') => {
          const issue = {
            index: index + 1,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: '1',
            property_location: record.property_location || '',
            warning_message: message,
            inspector: inspector,
            severity: severity
          };
          
          validationIssues.push(issue);
          inspectorIssuesMap[inspector].push(issue);
          isValidInspection = false;
        };

        // CORE PACKAGE VALIDATION: Must have all 3 (info_by + measure_by + measure_date)
        if (!hasValidInfoBy) {
          addValidationIssue(`Invalid InfoBy code: ${infoByCode}`, 'high');
        }
        if (!hasValidMeasuredBy) {
          addValidationIssue('Missing or invalid measure_by inspector', 'high');
        }
        if (!hasValidMeasuredDate) {
          addValidationIssue('Missing or invalid measure_date', 'high');
        }

        // InfoBy LOGIC VALIDATION
        const isEntryCode = infoByCategoryConfig.entry.includes(infoByCode?.toString());
        const isRefusalCode = infoByCategoryConfig.refusal.includes(infoByCode?.toString());
        const isEstimationCode = infoByCategoryConfig.estimation.includes(infoByCode?.toString());
        const isPricedCode = infoByCategoryConfig.priced.includes(infoByCode?.toString());
        const hasListingData = record.inspection_list_by && record.inspection_list_date;

        if (isRefusalCode && !hasListingData) {
          addValidationIssue(`Refusal code ${infoByCode} but missing list_by/list_date`, 'medium');
        }
        if (isEntryCode && !hasListingData) {
          addValidationIssue(`Entry code ${infoByCode} but missing list_by/list_date`, 'medium');
        }
        if (isEstimationCode && hasListingData) {
          addValidationIssue(`Estimation code ${infoByCode} but has list_by/list_date`, 'medium');
        }

        // INSPECTOR TYPE MISMATCH: Residential on commercial
        const isCommercialProperty = ['4A', '4B', '4C'].includes(propertyClass);
        const isResidentialInspector = employeeData[inspector]?.inspector_type === 'residential';
        if (isCommercialProperty && isResidentialInspector) {
          addValidationIssue(`Residential inspector ${inspector} assigned to commercial property`, 'medium');
        }

        // ZERO IMPROVEMENT LOGIC: Must have list data
        if (record.values_mod_improvement === 0 && !hasListingData) {
          addValidationIssue('Zero improvement property missing list_by/list_date', 'medium');
        }

        // Only count valid inspections for analytics
        if (isValidInspection && hasValidInfoBy && hasValidMeasuredBy && hasValidMeasuredDate) {
          inspectorStats[inspector].inspected++;
          
          // Count residential inspected separately
          if (['2', '3A'].includes(propertyClass)) {
            inspectorStats[inspector].residentialInspected++;
          }

          if (measuredDate) {
            inspectorStats[inspector].datesWorked.add(measuredDate.toISOString().split('T')[0]);
          }

          if (classBreakdown[propertyClass]) {
            classBreakdown[propertyClass].inspected++;
            billingByClass[propertyClass].inspected++;
            billingByClass[propertyClass].billable++;
          }

          // Determine inspection type using category configuration
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

          // Count pricing - FIXED: BRT vs Microsystems logic
          if (jobData.vendor_type === 'BRT' && priceDate && priceDate >= startDate) {
            inspectorStats[inspector].priced++;
            if (classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].priced++;
            }
          } else if (jobData.vendor_type === 'Microsystems' && isPricedCode) {
            inspectorStats[inspector].priced++;
            if (classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].priced++;
            }
          }

          // Class categorization
          if (['2', '3A', '3B'].includes(propertyClass)) {
            inspectorStats[inspector].classes.residential++;
          } else if (['4A', '4B', '4C'].includes(propertyClass)) {
            inspectorStats[inspector].classes.commercial++;
          } else {
            inspectorStats[inspector].classes.other++;
          }
        }
      });

      // Calculate rates and daily averages for each inspector
      Object.keys(inspectorStats).forEach(inspector => {
        const stats = inspectorStats[inspector];
        const daysWorked = stats.datesWorked.size;
        
        if (stats.inspected > 0) {
          stats.entryRate = Math.round((stats.entry / stats.inspected) * 100);
          stats.refusalRate = Math.round((stats.refusal / stats.inspected) * 100);
          stats.pricingRate = Math.round((stats.priced / stats.inspected) * 100);
        }
        
        if (daysWorked > 0) {
          stats.dailyAverage = Math.round(stats.inspected / daysWorked);
        }

        stats.daysWorked = daysWorked; // Keep for display
      });

      // Create validation report
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
        validInspections: Object.values(inspectorStats).reduce((sum, stats) => sum + stats.inspected, 0),
        inspectorStats,
        classBreakdown,
        validationIssues: validationIssues.length,
        processingDate: new Date().toISOString()
      };

      const billingResult = {
        byClass: billingByClass,
        grouped: {
          commercial: ['4A', '4B', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0), // FIXED: Added 4B
          exempt: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          railroad: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          personalProperty: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
        },
        totalBillable: Object.values(billingByClass).reduce((sum, cls) => sum + cls.billable, 0)
      };

      setAnalytics(analyticsResult);
      setBillingAnalytics(billingResult);
      setValidationReport(validationReportData);

      debugLog('ANALYTICS', '✅ Enhanced analytics processing complete', {
        totalRecords: rawData.length,
        validInspections: analyticsResult.validInspections,
        totalIssues: validationIssues.length,
        inspectors: Object.keys(inspectorStats).length
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

  // FIXED: Start processing session with proper state management
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

      // Process analytics first
      const results = await processAnalytics();
      if (!results) {
        throw new Error('Analytics processing failed');
      }

      // FIXED: Move valid inspections to inspection_data table with correct field names
      const { data: validRecords, error: selectError } = await supabase
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
        .not('inspection_info_by', 'is', null)
        .not('inspection_measure_by', 'is', null)
        .not('inspection_measure_date', 'is', null)
        .gte('inspection_measure_date', projectStartDate)
        .limit(50000);

      if (selectError) throw selectError;

      // Filter valid records based on InfoBy categories
      const validInspectionRecords = validRecords.filter(record => 
        allValidCodes.includes(record.inspection_info_by?.toString())
      );

      debugLog('SESSION', `Moving ${validInspectionRecords.length} valid records to inspection_data`);

      // Clear existing data for this job
      await supabase
        .from('inspection_data')
        .delete()
        .eq('job_id', jobData.id);

      // FIXED: Insert clean records in batches with correct field mapping
      const batchSize = 1000;
      for (let i = 0; i < validInspectionRecords.length; i += batchSize) {
        const batch = validInspectionRecords.slice(i, i + batchSize);
        const inspectionRecords = batch.map(record => ({
          job_id: jobData.id,
          import_session_id: newSessionId,
          property_composite_key: record.property_composite_key,
          block: record.property_block,
          lot: record.property_lot,
          qualifier: record.property_qualifier,
          property_location: record.property_location,
          property_class: record.property_m4_class,
          info_by_code: record.inspection_info_by, // FIXED: Now text field
          list_by: record.inspection_list_by,
          list_date: record.inspection_list_date,
          measure_by: record.inspection_measure_by, // FIXED: Correct field name
          measure_date: record.inspection_measure_date, // FIXED: Correct field name
          price_by: record.inspection_price_by,
          price_date: record.inspection_price_date,
          project_start_date: projectStartDate,
          validation_report: results.validationReportData,
          file_version: latestFileVersion,
          source_file_name: `version_${latestFileVersion}`,
          upload_date: new Date().toISOString()
        }));

        const { error: insertError } = await supabase
          .from('inspection_data')
          .insert(inspectionRecords);

        if (insertError) throw insertError;
      }

      // Update job statistics
      await updateJobStatistics(results.analyticsResult);

      debugLog('SESSION', '✅ Processing session completed successfully');
      addNotification(`✅ Processing completed! ${validInspectionRecords.length} valid inspections moved to inspection_data`, 'success');

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

  // Update job statistics for other modules
  const updateJobStatistics = async (analytics) => {
    if (!analytics) return;

    try {
      const totalInspected = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.inspected, 0);
      const totalEntry = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.entry, 0);
      const totalRefusal = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.refusal, 0);
      const totalPriced = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);

      const workflowStats = {
        rates: {
          entryRate: totalInspected > 0 ? Math.round((totalEntry / totalInspected) * 100) : 0,
          refusalRate: totalInspected > 0 ? Math.round((totalRefusal / totalInspected) * 100) : 0,
          pricingRate: totalInspected > 0 ? Math.round((totalPriced / totalInspected) * 100) : 0
        },
        validInspections: totalInspected,
        lastProcessed: new Date().toISOString()
      };

      await supabase
        .from('jobs')
        .update({
          workflow_stats: workflowStats,
          inspected_properties: totalInspected,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobData.id);

      debugLog('JOB_UPDATE', '✅ Job statistics updated');

    } catch (error) {
      console.error('Error updating job statistics:', error);
    }
  };

  // Export validation report
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
              <h1 className="text-2xl font-bold text-gray-900">Production Tracker</h1>
              <p className="text-gray-600">{jobData.name} - Enhanced Analytics & Validation Engine</p>
            </div>
          </div>
          <button
            onClick={onBackToJobs}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all"
          >
            ← Back to Jobs
          </button>
        </div>

        {/* FIXED: Enhanced Quick Stats */}
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Raw Properties</p>
                  <p className="text-2xl font-bold text-blue-600">{propertyRecordsCount?.toLocaleString() || analytics.totalRecords.toLocaleString()}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Valid Inspections</p>
                  <p className="text-2xl font-bold text-green-600">{analytics.validInspections.toLocaleString()}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Inspectors Active</p>
                  <p className="text-2xl font-bold text-purple-600">{Object.keys(analytics.inspectorStats).length}</p>
                </div>
                <Users className="w-8 h-8 text-purple-500" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Validation Issues</p>
                  <p className="text-2xl font-bold text-red-600">{analytics.validationIssues}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ENHANCED Settings Panel with Save Button */}
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
          {/* Project Start Date with Lock */}
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

          {/* InfoBy Category Status with Save Button */}
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

        {/* FIXED: Clean InfoBy Category Configuration Panel */}
        {availableInfoByCodes.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-md font-semibold text-gray-800 mb-4">
              InfoBy Category Assignment ({jobData.vendor_type} Format)
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {['entry', 'refusal', 'estimation', 'invalid', 'priced'].map(category => (
                <div key={category} className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3 capitalize">
                    {category} ({infoByCategoryConfig[category].length})
                  </h5>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {availableInfoByCodes.map(codeItem => {
                      // FIXED: Clean display logic - show storage code only
                      const storageCode = jobData.vendor_type === 'Microsystems' ? codeItem.storageCode : codeItem.code;
                      const displayCode = storageCode; // Show the actual stored code (A, O, R or 01, 02, 06)
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
          </div>
        )}

        {/* FIXED: Processing Button with Proper States */}
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
            {/* FIXED: Enhanced Inspector Analytics */}
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-gray-900">Enhanced Inspector Performance Analytics</h3>
                
                {Object.keys(analytics.inspectorStats).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p>No inspector data available yet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {Object.entries(analytics.inspectorStats).map(([inspector, stats]) => (
                      <div key={inspector} className="bg-gray-50 rounded-lg p-4 border">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-bold text-gray-900">
                              {stats.name} ({inspector})
                              <span className="ml-2 text-sm text-gray-600">
                                {stats.inspector_type === 'commercial' ? '🏢 Commercial' : '🏠 Residential'}
                              </span>
                            </h4>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                          <div>
                            <div className="text-gray-600">Total Inspected</div>
                            <div className="font-bold text-green-600">{stats.inspected.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Residential Inspected</div>
                            <div className="font-bold text-blue-600">{stats.residentialInspected.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Days Worked</div>
                            <div className="font-bold text-purple-600">{stats.daysWorked}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Daily Average</div>
                            <div className="font-bold text-blue-600">{stats.dailyAverage}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Entry Rate</div>
                            <div className="font-bold text-green-600">{stats.entryRate || 0}%</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Refusal Rate</div>
                            <div className="font-bold text-red-600">{stats.refusalRate || 0}%</div>
                          </div>
                        </div>

                        {stats.inspector_type === 'commercial' && (
                          <div className="mt-3 text-sm">
                            <div className="text-gray-600">Pricing Rate</div>
                            <div className="font-bold text-purple-600">{stats.pricingRate || 0}%</div>
                          </div>
                        )}

                        <div className="mt-3 text-xs text-gray-500">
                          Classes: {stats.classes.residential} Res, {stats.classes.commercial} Com, {stats.classes.other} Other
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* FIXED: Summary for Billing with 4B */}
            {activeTab === 'billing' && billingAnalytics && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Summary for Billing</h3>
                  <div className="text-sm text-gray-600">
                    Total Billable: <span className="font-bold text-green-600">{billingAnalytics.totalBillable.toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Individual Classes</h4>
                    <div className="space-y-3">
                      {Object.entries(billingAnalytics.byClass)
                        .filter(([cls, data]) => data.total > 0)
                        .map(([cls, data]) => (
                        <div key={cls} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                          <div>
                            <span className="font-medium text-gray-900">Class {cls}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-blue-600">{data.billable.toLocaleString()}</div>
                            <div className="text-xs text-gray-500">of {data.total.toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Grouped Categories</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <div>
                          <span className="font-medium text-gray-900">Commercial (4A, 4B, 4C)</span>
                          <div className="text-xs text-gray-600">Commercial properties</div>
                        </div>
                        <div className="font-bold text-orange-600">{billingAnalytics.grouped.commercial.toLocaleString()}</div>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                        <div>
                          <span className="font-medium text-gray-900">Exempt (15A-15F)</span>
                          <div className="text-xs text-gray-600">Tax-exempt properties</div>
                        </div>
                        <div className="font-bold text-purple-600">{billingAnalytics.grouped.exempt.toLocaleString()}</div>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                        <div>
                          <span className="font-medium text-gray-900">Railroad (5A, 5B)</span>
                          <div className="text-xs text-gray-600">Railroad properties</div>
                        </div>
                        <div className="font-bold text-green-600">{billingAnalytics.grouped.railroad.toLocaleString()}</div>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div>
                          <span className="font-medium text-gray-900">Personal Property (6A, 6B)</span>
                          <div className="text-xs text-gray-600">Personal property</div>
                        </div>
                        <div className="font-bold text-blue-600">{billingAnalytics.grouped.personalProperty.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced Validation Report */}
            {activeTab === 'validation' && validationReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Enhanced Validation Report
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
                    <p className="text-gray-600">All records passed enhanced validation checks</p>
                  </div>
                ) : (
                  <>
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                      <h4 className="font-semibold text-yellow-800 mb-3">Inspector Summary</h4>
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
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Property Location</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Warning Message</th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationReport.detailed_issues[selectedInspectorIssues].map((issue, idx) => (
                                <tr key={idx} className="border-t border-gray-200">
                                  <td className="px-3 py-2">{issue.block}</td>
                                  <td className="px-3 py-2">{issue.lot}</td>
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
