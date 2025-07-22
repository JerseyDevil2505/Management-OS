import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

const PayrollProductionUpdater = ({ jobData, onBackToJobs }) => {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rawPropertyData, setRawPropertyData] = useState([]);
  const [cleanInspectionData, setCleanInspectionData] = useState([]);
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
    commercial: []
  });
  const [projectStartDate, setProjectStartDate] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [settingsLocked, setSettingsLocked] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState('analytics');
  const [selectedInspectorIssues, setSelectedInspectorIssues] = useState(null);
  const [maxFileVersion, setMaxFileVersion] = useState(1);
  const [showCategoryConfig, setShowCategoryConfig] = useState(false);

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
        .select('id, first_name, last_name, inspector_type, employment_status')
        .eq('employment_status', 'full_time');

      if (error) throw error;

      const employeeMap = {};
      employees.forEach(emp => {
        const initials = `${emp.first_name.charAt(0)}${emp.last_name.charAt(0)}`;
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

  // FIXED: Load available InfoBy codes with proper vendor-specific logic
  const loadAvailableInfoByCodes = async () => {
    if (!jobData?.id) return;

    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('parsed_code_definitions, vendor')
        .eq('id', jobData.id)
        .single();

      if (error || !job?.parsed_code_definitions) {
        debugLog('CODES', 'No parsed code definitions found for job');
        return;
      }

      const codes = [];
      const vendor = job.vendor;

      if (vendor === 'BRT') {
        // Handle BRT nested JSON structure
        const sections = job.parsed_code_definitions.sections || job.parsed_code_definitions;
        
        // Look for INFO BY section specifically
        const infoBySection = sections['INFO BY'];
        if (infoBySection) {
          Object.keys(infoBySection).forEach(key => {
            const item = infoBySection[key];
            if (item && item.DATA && item.DATA.VALUE) {
              codes.push({
                code: item.KEY || item.DATA.KEY,
                description: item.DATA.VALUE,
                section: 'INFO BY',
                vendor: 'BRT'
              });
            }
          });
        }

        // If no INFO BY section, check other sections like Residential
        if (codes.length === 0) {
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
      debugLog('CODES', `Loaded ${codes.length} InfoBy codes from ${vendor} definitions`, codes);

      // Set default category configurations based on vendor
      if (codes.length > 0) {
        setDefaultCategoryConfig(vendor, codes);
      }

    } catch (error) {
      console.error('Error loading InfoBy codes:', error);
      addNotification('Error loading InfoBy codes from code file', 'error');
    }
  };

  // Set default InfoBy category configurations
  const setDefaultCategoryConfig = (vendor, codes) => {
    const defaultConfig = { entry: [], refusal: [], estimation: [], invalid: [], commercial: [] };

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
          defaultConfig.commercial.push(item.code);
        }
      });
    } else if (vendor === 'Microsystems') {
      codes.forEach(item => {
        const code = item.code;
        const desc = item.description.toUpperCase();
        if (code.includes('A') || code.includes('O') || code.includes('S') || code.includes('T')) {
          defaultConfig.entry.push(item.storageCode); // Use storage code (A, not 140A)
        } else if (code.includes('R')) {
          defaultConfig.refusal.push(item.storageCode);
        } else if (code.includes('E') || code.includes('F') || code.includes('V')) {
          defaultConfig.estimation.push(item.storageCode);
        } else if (code.includes('P') || code.includes('N') || code.includes('B')) {
          defaultConfig.commercial.push(item.storageCode);
        }
      });
    }

    setInfoByCategoryConfig(defaultConfig);
    debugLog('CATEGORIES', 'Set default category configuration', defaultConfig);
  };

  // FIXED: Load raw property data with proper limit
  const loadRawPropertyData = async () => {
    if (!jobData?.id) return;

    try {
      debugLog('DATA', 'Loading raw property data with enhanced limits');

      // Get latest file version for this job
      const { data: versionData, error: versionError } = await supabase
        .from('property_records')
        .select('file_version')
        .eq('job_id', jobData.id)
        .order('file_version', { ascending: false })
        .limit(1)
        .single();

      if (versionError) {
        console.warn('Could not determine max version:', versionError);
        setMaxFileVersion(1);
      } else {
        setMaxFileVersion(versionData.file_version || 1);
        debugLog('VERSION', `Max file version detected: ${versionData.file_version}`);
      }

      // FIXED: Get ALL records with higher limit
      const { data: rawData, error } = await supabase
        .from('property_records')
        .select(`
          property_composite_key,
          property_block,
          property_lot,
          property_qualifier,
          property_location,
          property_m4_class,
          property_cama_class,
          inspection_info_by,
          inspection_list_by,
          inspection_list_date,
          inspection_price_by,
          inspection_price_date,
          sales_price,
          sales_date,
          file_version,
          processed_at,
          vendor_source
        `)
        .eq('job_id', jobData.id)
        .eq('file_version', versionData?.file_version || 1)
        .order('property_block', { ascending: true })
        .order('property_lot', { ascending: true })
        .limit(20000); // FIXED: Increased from default 1000 to 20000

      if (error) throw error;

      setRawPropertyData(rawData || []);
      debugLog('DATA', `✅ Loaded ${rawData?.length || 0} raw property records on version ${versionData?.file_version || 1}`);

      if (rawData?.length >= 19000) {
        addNotification('⚠️ Approaching record limit. Consider pagination for larger datasets.', 'warning');
      }

    } catch (error) {
      console.error('Error loading raw property data:', error);
      addNotification('Error loading property data: ' + error.message, 'error');
    }
  };

  // Load existing clean inspection data
  const loadCleanInspectionData = async () => {
    if (!jobData?.id) return;

    try {
      const { data: cleanData, error } = await supabase
        .from('inspection_data')
        .select(`
          property_composite_key,
          block,
          lot,
          qualifier,
          property_location,
          property_class,
          info_by_code,
          list_by,
          list_date,
          price_by,
          price_date,
          sale_price,
          sale_date,
          import_session_id,
          project_start_date,
          validation_report,
          upload_date
        `)
        .eq('job_id', jobData.id)
        .order('block', { ascending: true })
        .order('lot', { ascending: true })
        .limit(20000); // Consistent high limit

      if (error) throw error;

      setCleanInspectionData(cleanData || []);
      debugLog('DATA', `Loaded ${cleanData?.length || 0} clean inspection records`);

      // Load session history from validation reports
      const sessionMap = new Map();
      (cleanData || []).forEach(record => {
        if (record.validation_report && record.import_session_id) {
          if (!sessionMap.has(record.import_session_id)) {
            sessionMap.set(record.import_session_id, {
              session_id: record.import_session_id,
              processed_at: record.upload_date,
              project_start_date: record.project_start_date,
              validation_summary: record.validation_report?.summary || {}
            });
          }
        }
      });

      setSessionHistory(Array.from(sessionMap.values()).slice(0, 10)); // Latest 10 sessions

    } catch (error) {
      console.error('Error loading clean inspection data:', error);
      addNotification('Error loading inspection data: ' + error.message, 'error');
    }
  };

  // Initialize data loading
  useEffect(() => {
    if (jobData?.id) {
      loadEmployeeData();
      loadAvailableInfoByCodes();
      loadRawPropertyData();
      loadCleanInspectionData();
    }
  }, [jobData?.id]);

  // Process analytics when data is loaded
  useEffect(() => {
    if (rawPropertyData.length > 0 && Object.keys(employeeData).length > 0) {
      setLoading(false);
      processAnalytics();
    }
  }, [rawPropertyData, employeeData, infoByCategoryConfig, projectStartDate]);

  // FIXED: Enhanced validation with vendor-specific logic
  const processAnalytics = async () => {
    if (!rawPropertyData.length || !projectStartDate) return;

    try {
      debugLog('ANALYTICS', 'Starting analytics processing', { 
        rawRecords: rawPropertyData.length,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig 
      });

      const startDate = new Date(projectStartDate);
      const inspectorStats = {};
      const classBreakdown = {};
      const billingByClass = {};
      const validationIssues = [];
      const inspectorIssuesMap = {};

      // Get all valid InfoBy codes from category configuration
      const allValidCodes = [
        ...infoByCategoryConfig.entry,
        ...infoByCategoryConfig.refusal,
        ...infoByCategoryConfig.estimation,
        ...infoByCategoryConfig.commercial
      ];

      // Initialize class counters
      const allClasses = ['1', '2', '3A', '3B', '4A', '4C', '15A', '15B', '15C', '15D', '15E', '15F', '5A', '5B', '6A', '6B'];
      allClasses.forEach(cls => {
        classBreakdown[cls] = { total: 0, inspected: 0, entry: 0, refusal: 0, priced: 0 };
        billingByClass[cls] = { total: 0, inspected: 0, billable: 0 };
      });

      rawPropertyData.forEach((record, index) => {
        const inspector = record.inspection_list_by || 'UNASSIGNED';
        const propertyClass = record.property_m4_class || 'UNKNOWN';
        const infoByCode = record.inspection_info_by;
        const listDate = record.inspection_list_date ? new Date(record.inspection_list_date) : null;
        const priceDate = record.inspection_price_date ? new Date(record.inspection_price_date) : null;

        // Initialize inspector stats
        if (!inspectorStats[inspector]) {
          const employeeInfo = employeeData[inspector] || {};
          inspectorStats[inspector] = {
            name: employeeInfo.name || inspector,
            fullName: employeeInfo.fullName || inspector,
            inspector_type: employeeInfo.inspector_type || 'unknown',
            total: 0,
            inspected: 0,
            entry: 0,
            refusal: 0,
            priced: 0,
            residentialOnly: 0,
            classes: { residential: 0, commercial: 0, other: 0 },
            dailyAverage: 0,
            datesWorked: new Set()
          };
          inspectorIssuesMap[inspector] = [];
        }

        // Count totals
        inspectorStats[inspector].total++;
        if (classBreakdown[propertyClass]) {
          classBreakdown[propertyClass].total++;
          billingByClass[propertyClass].total++;
        }

        // FIXED: Enhanced validation with vendor-specific code logic
        let isValid = true;
        let hasValidDate = listDate && listDate >= startDate;
        let hasValidInitials = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        
        const addValidationIssue = (message, severity = 'medium') => {
          const issue = {
            index: index + 1,
            block: record.property_block,
            lot: record.property_lot,
            qualifier: record.property_qualifier || '',
            card: '1', // Default card
            property_location: record.property_location || '',
            warning_message: message,
            inspector: inspector,
            severity: severity
          };
          
          validationIssues.push(issue);
          inspectorIssuesMap[inspector].push(issue);
          isValid = false;
        };

        // Validation Rule 1: Valid date + missing initials → scrub
        if (hasValidDate && !hasValidInitials) {
          addValidationIssue('Valid date but missing initials', 'high');
          debugLog('VALIDATION', `Rule 1 triggered: ${record.property_block}-${record.property_lot}`);
        }

        // Validation Rule 2: Valid initials + missing/invalid date → scrub  
        if (hasValidInitials && !hasValidDate) {
          addValidationIssue('Valid initials but invalid/missing date', 'high');
          debugLog('VALIDATION', `Rule 2 triggered: ${record.property_block}-${record.property_lot}`);
        }

        // FIXED: Validation Rule 3: Invalid InfoBy codes with category-based validation
        if (allValidCodes.length > 0 && infoByCode && !allValidCodes.includes(infoByCode.toString())) {
          addValidationIssue(`Info By Code Invalid: ${infoByCode} (not in configured categories)`, 'medium');
          debugLog('VALIDATION', `Rule 3 triggered: Invalid InfoBy ${infoByCode}`);
        }

        // Enhanced InfoBy category-based validation
        const isEntryCode = infoByCategoryConfig.entry.includes(infoByCode?.toString());
        const isRefusalCode = infoByCategoryConfig.refusal.includes(infoByCode?.toString());
        const isEstimationCode = infoByCategoryConfig.estimation.includes(infoByCode?.toString());
        const hasListingData = record.inspection_list_date && record.inspection_list_by;

        if (isRefusalCode && !hasListingData) {
          addValidationIssue(`Info By Mismatch-Inspected? (Refusal code ${infoByCode} but missing listing data)`, 'medium');
        }

        if (isEntryCode && !hasListingData) {
          addValidationIssue(`Info By Mismatch-Inspected? (Entry code ${infoByCode} but missing listing data)`, 'medium');
        }

        // Validation Rule 7: Zero improvement validation
        if (propertyClass && ['2', '3A', '3B'].includes(propertyClass) && !hasListingData) {
          addValidationIssue('InfoBy Code and Inspection Info Invalid for No Improvement', 'medium');
        }

        // Only count valid records for analytics
        if (isValid && hasValidDate && hasValidInitials) {
          inspectorStats[inspector].inspected++;
          if (listDate) {
            inspectorStats[inspector].datesWorked.add(listDate.toISOString().split('T')[0]);
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

          // Count pricing
          if (priceDate && priceDate >= startDate) {
            inspectorStats[inspector].priced++;
            if (classBreakdown[propertyClass]) {
              classBreakdown[propertyClass].priced++;
            }
          }

          // Class categorization
          if (['2', '3A', '3B'].includes(propertyClass)) {
            inspectorStats[inspector].classes.residential++;
            inspectorStats[inspector].residentialOnly++;
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
          stats.totalResidentialAverage = Math.round(stats.residentialOnly / daysWorked);
        }
        
        delete stats.datesWorked; // Clean up for storage
      });

      // Create validation report in Excel format
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

      setAnalytics({
        totalRecords: rawPropertyData.length,
        validRecords: rawPropertyData.length - validationIssues.filter(v => v.severity === 'high').length,
        inspectorStats,
        classBreakdown,
        validationIssues: validationIssues.length,
        processingDate: new Date().toISOString()
      });

      setBillingAnalytics({
        byClass: billingByClass,
        grouped: {
          commercial: ['4A', '4C'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          exempt: ['15A', '15B', '15C', '15D', '15E', '15F'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          railroad: ['5A', '5B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0),
          personalProperty: ['6A', '6B'].reduce((sum, cls) => sum + (billingByClass[cls]?.billable || 0), 0)
        },
        totalBillable: Object.values(billingByClass).reduce((sum, cls) => sum + cls.billable, 0)
      });

      setValidationReport(validationReportData);

      debugLog('ANALYTICS', '✅ Analytics processing complete', {
        validRecords: rawPropertyData.length - validationIssues.length,
        totalIssues: validationIssues.length,
        inspectors: Object.keys(inspectorStats).length
      });

      if (validationIssues.length > 0) {
        addNotification(`Found ${validationIssues.length} validation issues`, 'warning');
      }

    } catch (error) {
      console.error('Error processing analytics:', error);
      addNotification('Error processing analytics: ' + error.message, 'error');
    }
  };

  // Handle InfoBy category assignment
  const handleCategoryAssignment = (category, code, isAssigned) => {
    if (settingsLocked) return;
    
    setInfoByCategoryConfig(prev => ({
      ...prev,
      [category]: isAssigned 
        ? prev[category].filter(c => c !== code)
        : [...prev[category], code]
    }));
  };

  // Start processing session - Move data from property_records to inspection_data
  const startProcessingSession = async () => {
    const allValidCodes = [
      ...infoByCategoryConfig.entry,
      ...infoByCategoryConfig.refusal,
      ...infoByCategoryConfig.estimation,
      ...infoByCategoryConfig.commercial
    ];

    if (!projectStartDate || allValidCodes.length === 0) {
      addNotification('Please set project start date and configure InfoBy categories', 'error');
      return;
    }

    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);
    setSettingsLocked(true);
    setProcessing(true);

    try {
      debugLog('SESSION', 'Starting processing session', { 
        sessionId: newSessionId,
        startDate: projectStartDate,
        categoryConfig: infoByCategoryConfig 
      });

      // Process analytics first to get validation results
      await processAnalytics();

      if (!analytics || !validationReport) {
        throw new Error('Analytics processing failed');
      }

      // Move clean data to inspection_data table
      const validRecords = rawPropertyData.filter((record, index) => {
        const inspector = record.inspection_list_by || 'UNASSIGNED';
        const listDate = record.inspection_list_date ? new Date(record.inspection_list_date) : null;
        const startDate = new Date(projectStartDate);
        const hasValidDate = listDate && listDate >= startDate;
        const hasValidInitials = inspector && inspector !== 'UNASSIGNED' && inspector.trim() !== '';
        const infoByCode = record.inspection_info_by;
        const validInfoBy = allValidCodes.length === 0 || !infoByCode || allValidCodes.includes(infoByCode.toString());
        
        return hasValidDate && hasValidInitials && validInfoBy;
      });

      debugLog('SESSION', `Moving ${validRecords.length} valid records to inspection_data`);

      // Clear existing data for this session
      await supabase
        .from('inspection_data')
        .delete()
        .eq('job_id', jobData.id);

      // Insert clean records
      const inspectionRecords = validRecords.map(record => ({
        job_id: jobData.id,
        import_session_id: newSessionId,
        property_composite_key: record.property_composite_key,
        block: record.property_block,
        lot: record.property_lot,
        qualifier: record.property_qualifier,
        property_location: record.property_location,
        property_class: record.property_m4_class,
        info_by_code: record.inspection_info_by,
        list_by: record.inspection_list_by,
        list_date: record.inspection_list_date,
        price_by: record.inspection_price_by,
        price_date: record.inspection_price_date,
        sale_price: record.sales_price,
        sale_date: record.sales_date,
        project_start_date: projectStartDate,
        validation_report: validationReport,
        file_version: maxFileVersion,
        source_file_name: `version_${maxFileVersion}`,
        upload_date: new Date().toISOString()
      }));

      // Batch insert to inspection_data
      const { error: insertError } = await supabase
        .from('inspection_data')
        .insert(inspectionRecords);

      if (insertError) throw insertError;

      // Update job statistics for other modules
      await updateJobStatistics();

      // Reload clean data
      await loadCleanInspectionData();

      debugLog('SESSION', 'Processing session completed successfully');
      addNotification(`✅ Processing session completed! ${validRecords.length} clean records moved to inspection_data`, 'success');

    } catch (error) {
      console.error('Error in processing session:', error);
      addNotification('Processing session failed: ' + error.message, 'error');
      setSettingsLocked(false);
      setSessionId(null);
    } finally {
      setProcessing(false);
    }
  };

  // Update job statistics for AdminJobManagement tiles and ManagementChecklist
  const updateJobStatistics = async () => {
    if (!analytics) return;

    try {
      const totalInspected = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.inspected, 0);
      const totalEntry = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.entry, 0);
      const totalRefusal = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.refusal, 0);
      const totalPriced = Object.values(analytics.inspectorStats).reduce((sum, stats) => sum + stats.priced, 0);
      const commercialInspected = Object.values(analytics.classBreakdown)
        .filter(cls => ['4A', '4B', '4C'].includes(cls))
        .reduce((sum, cls) => sum + cls.inspected, 0);
      const commercialTotal = Object.values(analytics.classBreakdown)
        .filter(cls => ['4A', '4B', '4C'].includes(cls))
        .reduce((sum, cls) => sum + cls.total, 0);

      const workflowStats = {
        rates: {
          entryRate: totalInspected > 0 ? Math.round((totalEntry / totalInspected) * 100) : 0,
          refusalRate: totalInspected > 0 ? Math.round((totalRefusal / totalInspected) * 100) : 0,
          pricingRate: totalInspected > 0 ? Math.round((totalPriced / totalInspected) * 100) : 0,
          commercialInspectionRate: commercialTotal > 0 ? Math.round((commercialInspected / commercialTotal) * 100) : 0
        },
        inspectionPhases: {
          firstAttempt: 'COMPLETED',
          secondAttempt: totalRefusal > 0 ? 'IN_PROGRESS' : 'PENDING',
          thirdAttempt: 'PENDING'
        },
        appeals: {
          totalCount: 0,
          percentOfWhole: 0,
          byClass: {}
        }
      };

      // Update job with new statistics
      const { error } = await supabase
        .from('jobs')
        .update({
          workflow_stats: workflowStats,
          inspected_properties: totalInspected,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobData.id);

      if (error) throw error;

      debugLog('JOB_UPDATE', 'Job statistics updated', workflowStats);

    } catch (error) {
      console.error('Error updating job statistics:', error);
    }
  };

  // Export validation report in Excel format
  const exportValidationReport = () => {
    if (!validationReport || !validationReport.detailed_issues) return;

    let csvContent = "Inspector,Total Issues,Inspector Name\n";
    
    // Summary sheet
    validationReport.summary.inspector_breakdown.forEach(inspector => {
      csvContent += `"${inspector.inspector_code}","${inspector.total_issues}","${inspector.inspector_name}"\n`;
    });

    csvContent += "\n\nDetailed Issues:\n";
    csvContent += "Inspector,Block,Lot,Qualifier,Card,Property Location,Warning Message\n";
    
    // Detailed issues
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

    addNotification('📊 Validation report exported in Excel format', 'success');
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

      {/* Version Status Banner - ENHANCED */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-green-800">
            ✅ FIXED: Using ALL Records - File Version: {maxFileVersion}
          </span>
          <span className="text-sm text-green-600">
            {rawPropertyData.length.toLocaleString()} properties loaded (was limited to 1000)
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Factory className="w-8 h-8 mr-3 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Production Tracker</h1>
              <p className="text-gray-600">{jobData.name} - Enhanced Analytics & Validation Engine (PayrollProductionUpdater)</p>
            </div>
          </div>
          <button
            onClick={onBackToJobs}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all"
          >
            ← Back to Jobs
          </button>
        </div>

        {/* Quick Stats */}
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Raw Properties</p>
                  <p className="text-2xl font-bold text-blue-600">{analytics.totalRecords.toLocaleString()}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Clean Records</p>
                  <p className="text-2xl font-bold text-green-600">{cleanInspectionData.length.toLocaleString()}</p>
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

      {/* ENHANCED Settings Panel - InfoBy Category Configuration */}
      <div className="bg-white rounded-lg border shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
          <Settings className="w-5 h-5 mr-2" />
          Processing Settings - Enhanced InfoBy Configuration
          {settingsLocked && (
            <span className="ml-3 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
              Session Active: {sessionId?.slice(-8)}
            </span>
          )}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Project Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Project Start Date * 
              {settingsLocked && (
                <span className="ml-2 text-xs text-green-600">🔒 Locked</span>
              )}
            </label>
            <input
              type="date"
              value={projectStartDate}
              onChange={(e) => setProjectStartDate(e.target.value)}
              disabled={settingsLocked}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* InfoBy Category Configuration Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              InfoBy Categories ({availableInfoByCodes.length} codes available)
              {settingsLocked && (
                <span className="ml-2 text-xs text-green-600">🔒 Locked</span>
              )}
            </label>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Entry: {infoByCategoryConfig.entry.length} codes</span>
                <span>Refusal: {infoByCategoryConfig.refusal.length} codes</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Estimation: {infoByCategoryConfig.estimation.length} codes</span>
                <span>Commercial: {infoByCategoryConfig.commercial.length} codes</span>
              </div>
              {!settingsLocked && (
                <button
                  onClick={() => setShowCategoryConfig(!showCategoryConfig)}
                  className="w-full px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center justify-center"
                >
                  {showCategoryConfig ? 'Hide' : 'Configure'} Categories
                  {showCategoryConfig ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* InfoBy Category Configuration Panel */}
        {showCategoryConfig && !settingsLocked && availableInfoByCodes.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-md font-semibold text-gray-800 mb-4">
              Configure InfoBy Categories ({jobData.vendor} Format)
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {['entry', 'refusal', 'estimation', 'commercial'].map(category => (
                <div key={category} className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3 capitalize">
                    {category} Codes ({infoByCategoryConfig[category].length})
                  </h5>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {availableInfoByCodes.map(codeItem => {
                      const codeToCheck = jobData.vendor === 'Microsystems' ? codeItem.storageCode : codeItem.code;
                      const isAssigned = infoByCategoryConfig[category].includes(codeToCheck);
                      
                      return (
                        <div key={codeItem.code} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={() => handleCategoryAssignment(category, codeToCheck, isAssigned)}
                            className="mr-2"
                          />
                          <div className="text-sm">
                            <span className="font-medium">{codeItem.code}</span>
                            <div className="text-gray-600 text-xs">{codeItem.description}</div>
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

        {/* Session History */}
        {sessionHistory.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-md font-semibold text-gray-800 mb-3">Recent Processing Sessions</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {sessionHistory.slice(0, 6).map((session, idx) => (
                <div key={idx} className="p-3 bg-gray-50 rounded-lg border text-sm">
                  <div className="font-medium text-gray-900">
                    Session {session.session_id?.slice(-8) || 'Unknown'}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {new Date(session.processed_at).toLocaleDateString()}
                  </div>
                  {session.validation_summary && (
                    <div className="text-xs text-gray-600 mt-1">
                      {session.validation_summary.total_issues || 0} issues found
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={startProcessingSession}
            disabled={processing || settingsLocked || !projectStartDate || 
              (infoByCategoryConfig.entry.length + infoByCategoryConfig.refusal.length + 
               infoByCategoryConfig.estimation.length + infoByCategoryConfig.commercial.length) === 0}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {processing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{processing ? 'Processing...' : 'Start Processing Session'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Tabs - Same as before */}
      {analytics && (
        <div className="bg-white rounded-lg border shadow-sm">
          {/* Tab Navigation */}
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

          {/* Tab Content */}
          <div className="p-6">
            {/* Inspector Analytics Tab */}
            {activeTab === 'analytics' && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-gray-900">Inspector Performance Analytics</h3>
                
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
                          <div className="text-right">
                            <div className="text-sm text-gray-600">Completion Rate</div>
                            <div className="text-lg font-bold text-blue-600">
                              {stats.total > 0 ? Math.round((stats.inspected / stats.total) * 100) : 0}%
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                          <div>
                            <div className="text-gray-600">Total Assigned</div>
                            <div className="font-bold text-gray-900">{stats.total.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Inspected</div>
                            <div className="font-bold text-green-600">{stats.inspected.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Daily Average</div>
                            <div className="font-bold text-blue-600">{stats.dailyAverage}</div>
                          </div>
                          <div>
                            <div className="text-gray-600">Residential Avg</div>
                            <div className="font-bold text-blue-600">{stats.totalResidentialAverage}</div>
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

            {/* Summary for Billing Tab */}
            {activeTab === 'billing' && billingAnalytics && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">Summary for Billing</h3>
                  <div className="text-sm text-gray-600">
                    Total Billable: <span className="font-bold text-green-600">{billingAnalytics.totalBillable.toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Individual Classes */}
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

                  {/* Grouped Categories */}
                  <div>
                    <h4 className="text-md font-semibold text-gray-800 mb-4">Grouped Categories</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <div>
                          <span className="font-medium text-gray-900">Commercial (4A, 4C)</span>
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

            {/* Validation Report Tab */}
            {activeTab === 'validation' && validationReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    Enhanced Validation Report - Excel Format
                  </h3>
                  {validationReport.summary.total_issues > 0 && (
                    <button
                      onClick={exportValidationReport}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Export Excel Report</span>
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
                    {/* Summary Section */}
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

                    {/* Detailed Issues Section */}
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
