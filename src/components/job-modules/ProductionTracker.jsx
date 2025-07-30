import React, { useState, useEffect } from 'react';
import { Factory, Settings, Download, RefreshCw, AlertTriangle, CheckCircle, TrendingUp, DollarSign, Users, Calendar, X, ChevronDown, ChevronUp, Eye, FileText, Lock, Unlock, Save } from 'lucide-react';
import { supabase, jobService } from '../../lib/supabaseClient';

const ProductionTracker = ({ jobData, onBackToJobs, onMetricsUpdate }) => {
  // Core state
  const [employees, setEmployees] = useState([]);
  const [employeeData, setEmployeeData] = useState({});
  const [analyzeData, setAnalyzeData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [processingMessage, setProcessingMessage] = useState('');
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [sessionLog, setSessionLog] = useState([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [selectedInspector, setSelectedInspector] = useState(null);
  const [detailView, setDetailView] = useState('properties'); // 'properties' or 'validation'
  const [showInspectorStats, setShowInspectorStats] = useState(true);
  const [showFullEmployeeDirectory, setShowFullEmployeeDirectory] = useState(false);
  const [displayedEmployees, setDisplayedEmployees] = useState([]);
  const [activeReportType, setActiveReportType] = useState(null);
  
  // Settings state
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [projectStartDate, setProjectStartDate] = useState('');
  const [availableInfoByCodes, setAvailableInfoByCodes] = useState([]);
  const [infoByCategorySettings, setInfoByCategorySettings] = useState({
    entry: [],
    refusal: [],
    estimation: [],
    invalid: [],
    commercial: []
  });
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);

  // Session management
  const generateSessionId = () => {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const resetSession = () => {
    setSettingsLocked(false);
    setCurrentSessionId(null);
    setAnalyzeData(null);
    setSessionLog([]);
    setProcessingMessage('');
    setProcessingProgress({ current: 0, total: 0 });
    setSelectedInspector(null);
    setShowDetailPanel(false);
    addToSessionLog('Session reset - settings unlocked');
  };

  const lockSettings = () => {
    setSettingsLocked(true);
    const sessionId = generateSessionId();
    setCurrentSessionId(sessionId);
    addToSessionLog(`Settings locked for session: ${sessionId}`);
  };

  const addToSessionLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setSessionLog(prev => [...prev, { timestamp, message, type }]);
  };

  // Load employees on mount
  useEffect(() => {
    loadEmployeeData();
  }, []);

  // Load job settings when jobData changes
  useEffect(() => {
    if (jobData?.id) {
      loadJobSettings();
      loadAvailableInfoByCodes();
    }
  }, [jobData?.id]);

  const loadEmployeeData = async () => {
    try {
      setIsLoadingEmployees(true);
      const { data: employees, error } = await supabase
        .from('employees')
        .select('*')
        .not('initials', 'is', null)
        .neq('initials', '')
        .in('inspector_type', ['Residential', 'Commercial', 'Management'])
        .order('last_name');

      if (error) throw error;

      // Create employee lookup map using ONLY actual initials field
      const employeeMap = {};
      employees.forEach(emp => {
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

      setEmployees(employees);
      setEmployeeData(employeeMap);
      
      // Default display: Show first 10 employees
      setDisplayedEmployees(employees.slice(0, 10));
      
      console.log('Loaded employees with initials:', Object.keys(employeeMap));
    } catch (error) {
      console.error('Error loading employees:', error);
      addToSessionLog('Failed to load employee data', 'error');
    } finally {
      setIsLoadingEmployees(false);
    }
  };

  const loadJobSettings = async () => {
    try {
      const { data: job, error } = await supabase
        .from('jobs')
        .select('project_start_date, settings')
        .eq('id', jobData.id)
        .single();

      if (error) throw error;

      if (job?.project_start_date) {
        setProjectStartDate(job.project_start_date);
      } else {
        // Default to 30 days ago if not set
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() - 30);
        setProjectStartDate(defaultDate.toISOString().split('T')[0]);
      }

      // Load saved InfoBy category settings if they exist
      if (job?.settings?.infoByCategorySettings) {
        setInfoByCategorySettings(job.settings.infoByCategorySettings);
      }
    } catch (error) {
      console.error('Error loading job settings:', error);
      addToSessionLog('Failed to load job settings', 'error');
    }
  };

  const loadAvailableInfoByCodes = () => {
    if (!jobData?.parsed_code_definitions) {
      console.warn('No parsed code definitions available');
      return;
    }

    const vendor = jobData.vendor;
    const codes = [];

    if (vendor === 'BRT') {
      // BRT: Look for codes in the nested structure
      const sections = jobData.parsed_code_definitions.sections || jobData.parsed_code_definitions;
      
      // First try to find InfoBy codes in Residential[30].MAP
      if (sections['Residential'] && sections['Residential']['30'] && sections['Residential']['30'].MAP) {
        const infoBySection = sections['Residential']['30'].MAP;
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
      
      // If no codes found, search all sections for INFO BY codes
      if (codes.length === 0) {
        Object.keys(sections).forEach(sectionName => {
          const section = sections[sectionName];
          if (typeof section === 'object') {
            Object.keys(section).forEach(key => {
              const item = section[key];
              if (item && item.DATA && item.DATA.VALUE) {
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
      // Microsystems: Look for codes with 140 prefix
      Object.keys(jobData.parsed_code_definitions).forEach(code => {
        if (code.startsWith('140')) {
          codes.push({
            code: code,
            description: jobData.parsed_code_definitions[code],
            section: 'InfoBy',
            vendor: 'Microsystems'
          });
        }
      });
    }

    console.log(`Loaded ${codes.length} InfoBy codes for ${vendor}`);
    setAvailableInfoByCodes(codes);
  };

  const saveJobSettings = async () => {
    try {
      const settings = {
        infoByCategorySettings,
        projectStartDate,
        lastUpdated: new Date().toISOString()
      };

      const { error } = await supabase
        .from('jobs')
        .update({ 
          project_start_date: projectStartDate,
          settings 
        })
        .eq('id', jobData.id);

      if (error) throw error;

      addToSessionLog('Settings saved successfully', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      addToSessionLog('Failed to save settings', 'error');
    }
  };

  const handleCategoryAssignment = (code, category) => {
    setInfoByCategorySettings(prev => {
      const newSettings = { ...prev };
      
      // Remove code from all categories
      Object.keys(newSettings).forEach(cat => {
        newSettings[cat] = newSettings[cat].filter(c => c !== code);
      });
      
      // Add to new category if not 'none'
      if (category !== 'none') {
        newSettings[category].push(code);
      }
      
      return newSettings;
    });
    setHasChanges(true);
  };

  const getCategoryForCode = (code) => {
    for (const [category, codes] of Object.entries(infoByCategorySettings)) {
      if (codes.includes(code)) {
        return category;
      }
    }
    return 'none';
  };

  const analyzeInspectionData = async () => {
    if (!projectStartDate || settingsLocked) return;
    
    setIsProcessing(true);
    lockSettings();
    
    try {
      // First, load raw property data
      setProcessingMessage('Loading property data...');
      const rawData = await loadRawPropertyData();
      
      if (!rawData || rawData.length === 0) {
        throw new Error('No property data found');
      }

      // Clean up old/invalid inspector data
      const startDate = new Date(projectStartDate);
      const validEmployeeInitials = Object.keys(employeeData);
      
      // Process and validate inspection data
      setProcessingMessage('Processing inspection data...');
      const results = processInspectionData(rawData, startDate, validEmployeeInitials);
      
      // Update analytics state
      setAnalyzeData(results);
      
      // Save to database
      await saveInspectionData(results);
      
      // Update job metrics in App.js
      if (onMetricsUpdate) {
        const metrics = {
          propertiesInspected: results.summary.totalInspections,
          entryRate: results.summary.entryRate,
          refusalRate: results.summary.refusalRate,
          pricingRate: results.summary.pricingRate,
          missingProperties: results.missing.total,
          lastAnalyzed: new Date().toISOString()
        };
        onMetricsUpdate(jobData.id, metrics);
      }
      
      addToSessionLog(`Analysis complete: ${results.summary.totalInspections} inspections processed`, 'success');
    } catch (error) {
      console.error('Error analyzing data:', error);
      addToSessionLog(`Analysis failed: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
      setProcessingMessage('');
    }
  };

  const loadRawPropertyData = async () => {
    try {
      // Load ALL records without limit
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobData.id)
        .limit(100000); // Set high limit to get all records

      if (error) throw error;

      console.log(`Loaded ${data.length} property records`);
      return data;
    } catch (error) {
      console.error('Error loading property data:', error);
      throw error;
    }
  };

  const processInspectionData = (rawData, startDate, validEmployeeInitials) => {
    const inspectorStats = {};
    const validationReport = [];
    const missingProperties = [];
    const inspectionData = [];
    
    // Initialize counters
    let totalResidential = 0;
    let totalCommercial = 0;
    let totalEntry = 0;
    let totalRefusal = 0;
    let totalPricing = 0;
    let totalOther = 0;
    
    const vendor = jobData.vendor;
    const codeMapping = createCodeMapping(vendor);
    
    // Process each property record
    rawData.forEach((record, index) => {
      setProcessingProgress({ current: index + 1, total: rawData.length });
      
      const inspector = record.inspection_measure_by?.trim() || '';
      const infoByCode = record.inspection_info_by?.trim() || '';
      const measuredDate = record.inspection_measure_date ? new Date(record.inspection_measure_date) : null;
      
      // Check for any inspection attempt
      const hasAnyInspectionAttempt = (
        (record.inspection_measure_by && record.inspection_measure_by.trim() !== '') ||
        record.inspection_measure_date ||
        record.inspection_info_by ||
        record.inspection_list_by ||
        record.inspection_price_by
      );

      if (!hasAnyInspectionAttempt) {
        // Property not yet inspected - add to missing properties
        const reasonNotAdded = 'No inspection attempt - completely uninspected';
        missingProperties.push({
          property_composite_key: record.property_composite_key,
          property_class: record.property_class,
          inspector: 'UNASSIGNED',
          measure_date: null,
          info_by: null,
          reason: reasonNotAdded,
          category: 'uninspected'
        });
        return;
      }
      
      // Skip UNASSIGNED inspectors
      if (inspector === 'UNASSIGNED') {
        const reasonNotAdded = 'Inspector UNASSIGNED';
        missingProperties.push({
          property_composite_key: record.property_composite_key,
          property_class: record.property_class,
          inspector: inspector,
          measure_date: record.inspection_measure_date,
          info_by: infoByCode,
          reason: reasonNotAdded,
          category: 'validation_failed'
        });
        return;
      }
      
      // Skip inspections before project start date
      if (measuredDate && measuredDate < startDate) {
        const reasonNotAdded = 'Inspection date before project start date';
        missingProperties.push({
          property_composite_key: record.property_composite_key,
          property_class: record.property_class,
          inspector: inspector,
          measure_date: record.inspection_measure_date,
          info_by: infoByCode,
          reason: reasonNotAdded,
          category: 'validation_failed'
        });
        return;
      }
      
      // Skip inspectors not in employee database
      if (!validEmployeeInitials.includes(inspector)) {
        const reasonNotAdded = `Inspector ${inspector} not found in employee database`;
        missingProperties.push({
          property_composite_key: record.property_composite_key,
          property_class: record.property_class,
          inspector: inspector,
          measure_date: record.inspection_measure_date,
          info_by: infoByCode,
          reason: reasonNotAdded,
          category: 'validation_failed'
        });
        return;
      }
      
      // Get employee data
      const employeeInfo = employeeData[inspector];
      if (!employeeInfo) {
        const reasonNotAdded = `Employee data not found for ${inspector}`;
        missingProperties.push({
          property_composite_key: record.property_composite_key,
          property_class: record.property_class,
          inspector: inspector,
          measure_date: record.inspection_measure_date,
          info_by: infoByCode,
          reason: reasonNotAdded,
          category: 'validation_failed'
        });
        return;
      }
      
      // Validate the inspection
      const validation = validateInspection(record, codeMapping);
      
      if (!validation.isValid) {
        // Add to validation report
        validation.issues.forEach(issue => {
          validationReport.push({
            property_composite_key: record.property_composite_key,
            property_class: record.property_class,
            inspector: inspector,
            inspector_name: employeeInfo.fullName,
            inspector_type: employeeInfo.inspector_type,
            issue: issue,
            measure_date: record.inspection_measure_date,
            info_by: infoByCode
          });
        });
        
        // If scrubbed (critical validation failure), skip this inspection
        if (validation.shouldScrub) {
          const reasonNotAdded = validation.issues.join('; ');
          missingProperties.push({
            property_composite_key: record.property_composite_key,
            property_class: record.property_class,
            inspector: inspector,
            measure_date: record.inspection_measure_date,
            info_by: infoByCode,
            reason: reasonNotAdded,
            category: 'validation_failed'
          });
          return;
        }
      }
      
      // Valid inspection - add to stats
      if (!inspectorStats[inspector]) {
        inspectorStats[inspector] = {
          name: employeeInfo.fullName,
          inspector_type: employeeInfo.inspector_type,
          total: 0,
          residential: 0,
          commercial: 0,
          otherResidential: 0,
          otherCommercial: 0,
          entry: 0,
          refusal: 0,
          pricing: 0,
          other: 0,
          properties: [],
          firstDate: null,
          lastDate: null
        };
      }
      
      const stats = inspectorStats[inspector];
      stats.total++;
      
      // Count by property class
      const isResidential = ['2', '3A'].includes(record.property_class);
      const isCommercial = ['4A', '4B', '4C'].includes(record.property_class);
      
      if (isResidential) {
        stats.residential++;
        totalResidential++;
      } else if (isCommercial) {
        stats.commercial++;
        totalCommercial++;
      } else {
        if (employeeInfo.inspector_type === 'Residential') {
          stats.otherResidential++;
        } else {
          stats.otherCommercial++;
        }
      }
      
      // Count by InfoBy category
      const category = codeMapping.getCategory(infoByCode);
      if (category === 'entry') {
        stats.entry++;
        totalEntry++;
      } else if (category === 'refusal') {
        stats.refusal++;
        totalRefusal++;
      } else if (category === 'commercial' || (vendor === 'BRT' && record.inspection_price_by)) {
        stats.pricing++;
        totalPricing++;
      } else {
        stats.other++;
        totalOther++;
      }
      
      // Track date range
      if (measuredDate) {
        if (!stats.firstDate || measuredDate < stats.firstDate) {
          stats.firstDate = measuredDate;
        }
        if (!stats.lastDate || measuredDate > stats.lastDate) {
          stats.lastDate = measuredDate;
        }
      }
      
      // Add property details
      stats.properties.push({
        property_composite_key: record.property_composite_key,
        property_class: record.property_class,
        measure_date: record.inspection_measure_date,
        info_by: infoByCode,
        validation_passed: validation.isValid
      });
      
      // Add to inspection_data array
      inspectionData.push({
        job_id: jobData.id,
        property_composite_key: record.property_composite_key,
        property_class: record.property_class,
        inspector: inspector,
        inspector_name: employeeInfo.fullName,
        inspector_type: employeeInfo.inspector_type,
        measure_date: record.inspection_measure_date,
        info_by: infoByCode,
        info_by_category: category,
        validation_passed: validation.isValid,
        validation_issues: validation.issues,
        session_id: currentSessionId,
        created_at: new Date().toISOString()
      });
    });
    
    // Calculate summary statistics
    const totalInspections = totalResidential + totalCommercial;
    const entryRate = totalResidential > 0 ? ((totalEntry / totalResidential) * 100).toFixed(1) : 0;
    const refusalRate = totalResidential > 0 ? ((totalRefusal / totalResidential) * 100).toFixed(1) : 0;
    const pricingRate = totalCommercial > 0 ? ((totalPricing / totalCommercial) * 100).toFixed(1) : 0;
    
    // Count missing properties by category
    const uninspectedCount = missingProperties.filter(p => p.category === 'uninspected').length;
    const validationFailedCount = missingProperties.filter(p => p.category === 'validation_failed').length;
    
    return {
      inspectorStats,
      validationReport,
      inspectionData,
      missing: {
        total: missingProperties.length,
        uninspected: uninspectedCount,
        validationFailed: validationFailedCount,
        properties: missingProperties,
        breakdown: createMissingBreakdown(missingProperties)
      },
      summary: {
        totalInspections,
        totalResidential,
        totalCommercial,
        totalEntry,
        totalRefusal,
        totalPricing,
        totalOther,
        entryRate,
        refusalRate,
        pricingRate
      }
    };
  };

  const createCodeMapping = (vendor) => {
    const mapping = {
      entry: [],
      refusal: [],
      estimation: [],
      invalid: [],
      commercial: []
    };
    
    // Use the settings from the UI
    Object.assign(mapping, infoByCategorySettings);
    
    return {
      getCategory: (code) => {
        if (!code) return 'other';
        
        const normalizedCode = vendor === 'Microsystems' ? code.replace('140', '') : code;
        
        for (const [category, codes] of Object.entries(mapping)) {
          if (codes.some(c => {
            const normalizedMappingCode = vendor === 'Microsystems' ? c.replace('140', '') : c;
            return normalizedMappingCode === normalizedCode;
          })) {
            return category;
          }
        }
        
        return 'other';
      },
      isValid: (code) => {
        if (!code) return false;
        const category = this.getCategory(code);
        return category !== 'invalid' && category !== 'other';
      }
    };
  };

  const validateInspection = (record, codeMapping) => {
    const issues = [];
    let shouldScrub = false;
    
    const vendor = jobData.vendor;
    const inspector = record.inspection_measure_by?.trim() || '';
    const infoByCode = record.inspection_info_by?.trim() || '';
    const measuredDate = record.inspection_measure_date;
    const propertyClass = record.property_class;
    const improvement = parseFloat(record.improvement) || 0;
    
    // Rule 1: Valid date + missing initials
    if (measuredDate && !inspector) {
      issues.push('Valid date but missing inspector initials');
      shouldScrub = true;
    }
    
    // Rule 2: Valid initials + missing/invalid date
    if (inspector && !measuredDate) {
      issues.push('Valid inspector but missing measurement date');
      shouldScrub = true;
    }
    
    // Rule 3: Invalid InfoBy codes
    const category = codeMapping.getCategory(infoByCode);
    if (infoByCode && category === 'invalid') {
      issues.push(`Invalid InfoBy code: ${infoByCode}`);
      shouldScrub = true;
    }
    
    // Rule 4: Refusal code but missing listing data
    if (category === 'refusal' && (!record.inspection_list_date || !record.inspection_list_by)) {
      issues.push('Refusal code but missing listing data');
    }
    
    // Rule 5: Entry code but missing listing data
    if (category === 'entry' && (!record.inspection_list_date || !record.inspection_list_by)) {
      issues.push('Entry code but missing listing data');
    }
    
    // Rule 6: Estimation code but has listing data
    if (category === 'estimation' && record.inspection_list_date && record.inspection_list_by) {
      issues.push('Estimation code but has listing data');
    }
    
    // Rule 7: Residential inspector on commercial property
    if (employeeData[inspector]?.inspector_type === 'Residential' && 
        ['4A', '4B', '4C'].includes(propertyClass)) {
      issues.push('Residential inspector on commercial property');
    }
    
    // Rule 8: Zero improvement but missing listing data
    if (improvement === 0 && (!record.inspection_list_date || !record.inspection_list_by)) {
      issues.push('Zero improvement value but missing listing data');
    }
    
    // Rule 9: Price field validation (BRT only)
    if (vendor === 'BRT' && category === 'commercial') {
      if (!record.inspection_price_by || !record.inspection_price_date) {
        issues.push('Commercial/pricing code but missing price data');
        shouldScrub = true;
      }
    }
    
    return {
      isValid: issues.length === 0,
      shouldScrub,
      issues
    };
  };

  const createMissingBreakdown = (missingProperties) => {
    const breakdown = {};
    
    missingProperties.forEach(prop => {
      const reason = prop.reason;
      if (!breakdown[reason]) {
        breakdown[reason] = {
          count: 0,
          properties: []
        };
      }
      breakdown[reason].count++;
      breakdown[reason].properties.push(prop);
    });
    
    return breakdown;
  };

  const saveInspectionData = async (results) => {
    try {
      // Delete existing data for this job
      const { error: deleteError } = await supabase
        .from('inspection_data')
        .delete()
        .eq('job_id', jobData.id);
      
      if (deleteError) throw deleteError;
      
      // Insert new inspection data
      if (results.inspectionData.length > 0) {
        // Insert in batches of 500
        const batchSize = 500;
        for (let i = 0; i < results.inspectionData.length; i += batchSize) {
          const batch = results.inspectionData.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('inspection_data')
            .insert(batch);
          
          if (insertError) throw insertError;
          
          setProcessingMessage(`Saving inspection data: ${Math.min(i + batchSize, results.inspectionData.length)} of ${results.inspectionData.length}`);
        }
      }
      
      // Save validation report as JSON
      if (results.validationReport.length > 0) {
        const { error: updateError } = await supabase
          .from('jobs')
          .update({ 
            validation_report: results.validationReport,
            last_analyzed: new Date().toISOString()
          })
          .eq('id', jobData.id);
        
        if (updateError) throw updateError;
      }
      
      addToSessionLog(`Saved ${results.inspectionData.length} inspection records`, 'success');
    } catch (error) {
      console.error('Error saving inspection data:', error);
      throw error;
    }
  };

  const exportValidationReport = () => {
    if (!analyzeData?.validationReport || analyzeData.validationReport.length === 0) {
      alert('No validation issues to export');
      return;
    }

    const headers = ['Property Key', 'Class', 'Inspector', 'Inspector Name', 'Inspector Type', 'Issue', 'Measure Date', 'Info By'];
    const rows = analyzeData.validationReport.map(item => [
      item.property_composite_key,
      item.property_class,
      item.inspector,
      item.inspector_name,
      item.inspector_type,
      item.issue,
      item.measure_date || '',
      item.info_by || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `validation_report_${jobData.town}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    addToSessionLog('Validation report exported', 'success');
  };

  const exportMissingPropertiesReport = () => {
    if (!analyzeData?.missing || analyzeData.missing.total === 0) {
      alert('No missing properties to export');
      return;
    }

    const headers = ['Property Key', 'Class', 'Inspector', 'Measure Date', 'Info By', 'Reason', 'Category'];
    const rows = analyzeData.missing.properties.map(item => [
      item.property_composite_key,
      item.property_class,
      item.inspector || 'UNASSIGNED',
      item.measure_date || '',
      item.info_by || '',
      item.reason,
      item.category
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `missing_properties_${jobData.town}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    addToSessionLog('Missing properties report exported', 'success');
  };

  const showInspectorDetails = (inspector) => {
    setSelectedInspector(inspector);
    setDetailView('properties');
    setShowDetailPanel(true);
  };

  const renderDetailPanel = () => {
    if (!selectedInspector || !analyzeData) return null;

    const stats = analyzeData.inspectorStats[selectedInspector];
    if (!stats) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{stats.name}</h2>
              <p className="text-sm text-gray-600">
                {stats.inspector_type} Inspector • {selectedInspector} • {stats.total} Total Inspections
              </p>
            </div>
            <button
              onClick={() => setShowDetailPanel(false)}
              className="p-2 hover:bg-gray-200 rounded-md transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              <button
                onClick={() => setDetailView('properties')}
                className={`py-2 px-6 border-b-2 font-medium text-sm ${
                  detailView === 'properties'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Properties ({stats.properties.length})
              </button>
              <button
                onClick={() => setDetailView('validation')}
                className={`py-2 px-6 border-b-2 font-medium text-sm ${
                  detailView === 'validation'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Validation Issues ({
                  analyzeData.validationReport.filter(v => v.inspector === selectedInspector).length
                })
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {detailView === 'properties' ? (
              <div className="space-y-2">
                {stats.properties.map((prop, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-md border ${
                      prop.validation_passed
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-medium">{prop.property_composite_key}</span>
                        <span className="ml-2 text-sm text-gray-600">Class {prop.property_class}</span>
                      </div>
                      <div className="text-sm text-gray-500">
                        {prop.measure_date ? new Date(prop.measure_date).toLocaleDateString() : 'No date'}
                      </div>
                    </div>
                    {prop.info_by && (
                      <div className="text-sm text-gray-600 mt-1">
                        InfoBy: {prop.info_by}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {analyzeData.validationReport
                  .filter(v => v.inspector === selectedInspector)
                  .map((issue, index) => (
                    <div key={index} className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium">{issue.property_composite_key}</span>
                        <span className="text-sm text-gray-600">Class {issue.property_class}</span>
                      </div>
                      <div className="text-sm text-red-600 font-medium">{issue.issue}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Date: {issue.measure_date || 'None'} • InfoBy: {issue.info_by || 'None'}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderInspectorStats = () => {
    if (!analyzeData || !analyzeData.inspectorStats) return null;

    // Group inspectors by type
    const residentialInspectors = [];
    const commercialInspectors = [];
    const managementInspectors = [];

    Object.entries(analyzeData.inspectorStats).forEach(([initials, stats]) => {
      const inspector = { initials, ...stats };
      
      // Calculate daily average
      if (stats.firstDate && stats.lastDate) {
        const daysDiff = Math.max(1, Math.ceil((stats.lastDate - stats.firstDate) / (1000 * 60 * 60 * 24)) + 1);
        inspector.dailyAverage = (stats.total / daysDiff).toFixed(1);
      } else {
        inspector.dailyAverage = 'N/A';
      }

      // Calculate rates for residential inspectors
      if (stats.inspector_type === 'Residential') {
        const residentialTotal = stats.residential;
        inspector.entryRate = residentialTotal > 0 ? ((stats.entry / residentialTotal) * 100).toFixed(1) : 0;
        inspector.refusalRate = residentialTotal > 0 ? ((stats.refusal / residentialTotal) * 100).toFixed(1) : 0;
      }

      if (stats.inspector_type === 'Residential') {
        residentialInspectors.push(inspector);
      } else if (stats.inspector_type === 'Commercial') {
        commercialInspectors.push(inspector);
      } else if (stats.inspector_type === 'Management') {
        managementInspectors.push(inspector);
      }
    });

    // Sort by total inspections
    residentialInspectors.sort((a, b) => b.total - a.total);
    commercialInspectors.sort((a, b) => b.total - a.total);
    managementInspectors.sort((a, b) => b.total - a.total);

    return (
      <div className="space-y-6">
        {/* Residential Inspectors */}
        {residentialInspectors.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Residential Inspectors</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {residentialInspectors.map(inspector => (
                <div
                  key={inspector.initials}
                  className="bg-green-50 border border-green-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => showInspectorDetails(inspector.initials)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{inspector.name}</h4>
                      <p className="text-sm text-gray-600">{inspector.initials}</p>
                    </div>
                    <span className="text-2xl font-bold text-green-600">{inspector.total}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-600">Class 2/3A:</span>
                      <span className="ml-1 font-medium">{inspector.residential}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Daily Avg:</span>
                      <span className="ml-1 font-medium">{inspector.dailyAverage}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Entry:</span>
                      <span className="ml-1 font-medium">{inspector.entryRate}%</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Refusal:</span>
                      <span className="ml-1 font-medium">{inspector.refusalRate}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Commercial Inspectors */}
        {commercialInspectors.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Commercial Inspectors</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {commercialInspectors.map(inspector => (
                <div
                  key={inspector.initials}
                  className="bg-blue-50 border border-blue-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => showInspectorDetails(inspector.initials)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{inspector.name}</h4>
                      <p className="text-sm text-gray-600">{inspector.initials}</p>
                    </div>
                    <span className="text-2xl font-bold text-blue-600">{inspector.total}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-600">Commercial:</span>
                      <span className="ml-1 font-medium">{inspector.commercial}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Daily Avg:</span>
                      <span className="ml-1 font-medium">{inspector.dailyAverage}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Pricing:</span>
                      <span className="ml-1 font-medium">{inspector.pricing}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Other:</span>
                      <span className="ml-1 font-medium">{inspector.otherCommercial}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Management Inspectors */}
        {managementInspectors.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Management Inspectors</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {managementInspectors.map(inspector => (
                <div
                  key={inspector.initials}
                  className="bg-purple-50 border border-purple-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => showInspectorDetails(inspector.initials)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{inspector.name}</h4>
                      <p className="text-sm text-gray-600">{inspector.initials}</p>
                    </div>
                    <span className="text-2xl font-bold text-purple-600">{inspector.total}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-600">Residential:</span>
                      <span className="ml-1 font-medium">{inspector.residential}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Commercial:</span>
                      <span className="ml-1 font-medium">{inspector.commercial}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Daily Avg:</span>
                      <span className="ml-1 font-medium">{inspector.dailyAverage}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Total:</span>
                      <span className="ml-1 font-medium">{inspector.total}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderBillingSummary = () => {
    if (!analyzeData) return null;

    const summary = analyzeData.summary;
    
    // Calculate billing by class
    const billingByClass = {};
    const classCategories = {
      'Residential': ['2', '3A'],
      'Farm': ['3B'],
      'Commercial': ['4A'],
      'Industrial': ['4B'],
      'Apartment': ['4C']
    };

    // Initialize counters
    Object.keys(classCategories).forEach(category => {
      billingByClass[category] = 0;
    });

    // Count inspections by class from inspection data
    if (analyzeData.inspectionData) {
      analyzeData.inspectionData.forEach(record => {
        for (const [category, classes] of Object.entries(classCategories)) {
          if (classes.includes(record.property_class)) {
            billingByClass[category]++;
            break;
          }
        }
      });
    }

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary for Billing</h3>
        
        {/* Individual Property Classes */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Individual Property Classes</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(billingByClass).map(([className, count]) => (
              <div key={className} className="bg-gray-50 p-3 rounded-md">
                <div className="text-sm text-gray-600">{className}</div>
                <div className="text-xl font-semibold text-gray-900">{count.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Grouped Categories */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Grouped Categories</h4>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-md">
              <span className="font-medium text-green-900">Residential (Class 2, 3A, 3B)</span>
              <span className="text-xl font-semibold text-green-900">
                {(billingByClass.Residential + billingByClass.Farm).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-md">
              <span className="font-medium text-blue-900">Commercial/Industrial (Class 4A, 4B, 4C)</span>
              <span className="text-xl font-semibold text-blue-900">
                {(billingByClass.Commercial + billingByClass.Industrial + billingByClass.Apartment).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 bg-purple-50 rounded-md">
              <span className="font-medium text-purple-900">Total Properties Inspected</span>
              <span className="text-xl font-semibold text-purple-900">
                {summary.totalInspections.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMissingPropertiesReport = () => {
    if (!analyzeData?.missing) return null;

    const { missing } = analyzeData;

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Missing Properties Report</h3>
          <button
            onClick={exportMissingPropertiesReport}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 flex items-center gap-1"
          >
            <Download className="h-4 w-4" />
            Export Report
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-red-50 p-4 rounded-md">
            <div className="text-sm text-red-600">Total Missing</div>
            <div className="text-2xl font-semibold text-red-900">{missing.total}</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-md">
            <div className="text-sm text-yellow-600">Uninspected</div>
            <div className="text-2xl font-semibold text-yellow-900">{missing.uninspected}</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-md">
            <div className="text-sm text-orange-600">Validation Failed</div>
            <div className="text-2xl font-semibold text-orange-900">{missing.validationFailed}</div>
          </div>
        </div>

        {/* Breakdown by Reason */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Breakdown by Reason</h4>
          <div className="space-y-2">
            {Object.entries(missing.breakdown)
              .sort((a, b) => b[1].count - a[1].count)
              .map(([reason, data]) => (
                <div key={reason} className="flex justify-between items-center p-3 bg-gray-50 rounded-md">
                  <span className="text-sm text-gray-700">{reason}</span>
                  <span className="font-medium text-gray-900">{data.count}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  };

  // Main render
  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Production Tracker</h2>
          <p className="text-gray-600 mt-1">Analytics and validation engine for {jobData?.town}</p>
        </div>
        <button
          onClick={onBackToJobs}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
        >
          Back to Jobs
        </button>
      </div>

      {/* Settings Panel */}
      <div className="mb-6 bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setSettingsExpanded(!settingsExpanded)}
          className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-gray-600" />
            <span className="font-medium text-gray-900">Processing Settings</span>
            {settingsLocked && (
              <span className="text-sm text-amber-600 bg-amber-50 px-2 py-1 rounded-md flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Locked for Session
              </span>
            )}
          </div>
          {settingsExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-600" />
          )}
        </button>

        {settingsExpanded && (
          <div className="px-6 pb-6 space-y-4">
            {/* Project Start Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Start Date
              </label>
              <input
                type="date"
                value={projectStartDate}
                onChange={(e) => setProjectStartDate(e.target.value)}
                disabled={settingsLocked}
                className={`w-full px-3 py-2 border rounded-md ${
                  settingsLocked
                    ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                    : 'border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Inspections before this date will be excluded
              </p>
            </div>

            {/* InfoBy Category Assignment */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                InfoBy Code Categories
              </label>
              <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-md">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {availableInfoByCodes.map((code) => (
                      <tr key={code.code}>
                        <td className="px-4 py-2 text-sm font-mono">{code.code}</td>
                        <td className="px-4 py-2 text-sm">{code.description}</td>
                        <td className="px-4 py-2">
                          <select
                            value={getCategoryForCode(code.code)}
                            onChange={(e) => handleCategoryAssignment(code.code, e.target.value)}
                            disabled={settingsLocked}
                            className={`text-sm px-2 py-1 border rounded ${
                              settingsLocked
                                ? 'bg-gray-100 border-gray-300 cursor-not-allowed'
                                : 'border-gray-300 focus:border-blue-500'
                            }`}
                          >
                            <option value="none">Unassigned</option>
                            <option value="entry">Entry</option>
                            <option value="refusal">Refusal</option>
                            <option value="estimation">Estimation</option>
                            <option value="invalid">Invalid</option>
                            <option value="commercial">Commercial/Pricing</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              {!settingsLocked ? (
                <>
                  <button
                    onClick={saveJobSettings}
                    disabled={!hasChanges}
                    className={`px-4 py-2 rounded-md flex items-center gap-2 ${
                      hasChanges
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Save className="h-4 w-4" />
                    Save Settings
                  </button>
                  <button
                    onClick={analyzeInspectionData}
                    disabled={!projectStartDate || isProcessing}
                    className={`px-4 py-2 rounded-md flex items-center gap-2 ${
                      projectStartDate && !isProcessing
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Factory className="h-4 w-4" />
                    {isProcessing ? 'Processing...' : 'Process Property Data'}
                  </button>
                </>
              ) : (
                <button
                  onClick={resetSession}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center gap-2"
                >
                  <Unlock className="h-4 w-4" />
                  Reset Session
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-blue-600 animate-spin" />
            <div className="flex-1">
              <p className="font-medium text-blue-900">{processingMessage}</p>
              {processingProgress.total > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-sm text-blue-700 mb-1">
                    <span>Progress</span>
                    <span>{processingProgress.current} of {processingProgress.total}</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(processingProgress.current / processingProgress.total) * 100}%`
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Analytics Dashboard */}
      {analyzeData && (
        <div className="space-y-6">
          {/* Summary Statistics */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{analyzeData.summary.totalInspections}</div>
                <div className="text-sm text-gray-600">Total Inspections</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{analyzeData.summary.totalResidential}</div>
                <div className="text-sm text-gray-600">Residential</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{analyzeData.summary.totalCommercial}</div>
                <div className="text-sm text-gray-600">Commercial</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{analyzeData.summary.entryRate}%</div>
                <div className="text-sm text-gray-600">Entry Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{analyzeData.summary.refusalRate}%</div>
                <div className="text-sm text-gray-600">Refusal Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{analyzeData.summary.pricingRate}%</div>
                <div className="text-sm text-gray-600">Pricing Rate</div>
              </div>
            </div>
          </div>

          {/* Validation Summary */}
          {analyzeData.validationReport && analyzeData.validationReport.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-yellow-600" />
                  <h3 className="text-lg font-semibold text-yellow-900">
                    Validation Issues ({analyzeData.validationReport.length})
                  </h3>
                </div>
                <button
                  onClick={exportValidationReport}
                  className="px-3 py-1 bg-yellow-600 text-white text-sm rounded-md hover:bg-yellow-700 flex items-center gap-1"
                >
                  <Download className="h-4 w-4" />
                  Export Validation Report
                </button>
              </div>
              <p className="text-sm text-yellow-700 mb-3">
                Properties with data quality issues that need review
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(
                  analyzeData.validationReport.reduce((acc, item) => {
                    acc[item.issue] = (acc[item.issue] || 0) + 1;
                    return acc;
                  }, {})
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([issue, count]) => (
                    <div key={issue} className="bg-white p-3 rounded-md border border-yellow-300">
                      <div className="text-sm text-gray-600">{issue}</div>
                      <div className="text-lg font-semibold text-gray-900">{count}</div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Missing Properties Report */}
          {renderMissingPropertiesReport()}

          {/* Inspector Performance */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Inspector Performance</h3>
              <button
                onClick={() => setShowInspectorStats(!showInspectorStats)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {showInspectorStats ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
            {showInspectorStats && renderInspectorStats()}
          </div>

          {/* Billing Summary */}
          {renderBillingSummary()}

          {/* Session Log */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Session Log</h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {sessionLog.map((log, index) => (
                <div key={index} className="flex gap-3 text-sm">
                  <span className="text-gray-500">{log.timestamp}</span>
                  <span className={`flex-1 ${
                    log.type === 'error' ? 'text-red-600' :
                    log.type === 'success' ? 'text-green-600' :
                    'text-gray-700'
                  }`}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Employee Directory Panel */}
      {!analyzeData && !isProcessing && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Employee Directory</h3>
            <button
              onClick={() => {
                setShowFullEmployeeDirectory(!showFullEmployeeDirectory);
                if (!showFullEmployeeDirectory) {
                  setDisplayedEmployees(employees);
                } else {
                  setDisplayedEmployees(employees.slice(0, 10));
                }
              }}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showFullEmployeeDirectory ? 'Show Less' : `Show All (${employees.length})`}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {displayedEmployees.map(emp => (
              <div key={emp.id} className="p-3 bg-gray-50 rounded-md">
                <div className="font-medium text-gray-900">
                  {emp.first_name} {emp.last_name}
                </div>
                <div className="text-sm text-gray-600">
                  {emp.initials} • {emp.inspector_type}
                </div>
              </div>
            ))}
          </div>
          {!showFullEmployeeDirectory && employees.length > 10 && (
            <p className="text-sm text-gray-500 mt-3 text-center">
              Showing 10 of {employees.length} employees
            </p>
          )}
        </div>
      )}

      {/* Detail Panel */}
      {renderDetailPanel()}
    </div>
  );
};

export default ProductionTracker;
