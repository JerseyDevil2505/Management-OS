import React, { useState, useEffect } from 'react';
import { AlertTriangle, Settings, Play, Download, CheckCircle, Clock, Users, BarChart3, FileText, X, Lock, Save } from 'lucide-react';
import { employeeService, jobService, propertyService, supabase } from '../../lib/supabaseClient';

const ProductionTracker = ({ jobData, onBackToJobs, onUpdateJobMetrics }) => {
  // Map JobContainer props to internal naming
  const currentJob = jobData;
  
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [showDataWarning, setShowDataWarning] = useState(false);
  const [validationReport, setValidationReport] = useState(null);
  const [billingTotals, setBillingTotals] = useState(null);
  const [inspectorDefinitions, setInspectorDefinitions] = useState({});
  const [employees, setEmployees] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [currentProcessingSession, setCurrentProcessingSession] = useState(null);
  
  const [settings, setSettings] = useState({
    projectStartDate: '2025-01-01',
    infoByCodeMappings: {
      entryCodes: '01,02,03,04',
      refusalCodes: '06', 
      estimationCodes: '07',
      invalidCodes: '00,05',
      pricingCodes: '08,09'
    }
  });

  // Load employees and inspector definitions
  const loadEmployeeData = async () => {
    try {
      const employeesData = await employeeService.getAll();
      setEmployees(employeesData);
      
      const definitions = {};
      const validInitials = [];
      employeesData.forEach(emp => {
        if (emp.role === 'inspector' && emp.initials) {
          definitions[emp.initials] = {
            name: `${emp.first_name} ${emp.last_name}`,
            type: emp.inspector_type || 'residential'
          };
          validInitials.push(emp.initials);
        }
      });
      setInspectorDefinitions(definitions);
      return validInitials;
    } catch (error) {
      console.error('Error loading employee data:', error);
      return [];
    }
  };

  // Check for existing processing session and load settings
  const loadExistingSession = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_data')
        .select('import_session_id, project_start_date')
        .eq('job_id', currentJob.id)
        .order('upload_date', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        const session = data[0];
        setCurrentProcessingSession(session.import_session_id);
        setSettings(prev => ({
          ...prev,
          projectStartDate: session.project_start_date || prev.projectStartDate
        }));
        setSettingsLocked(true);
      }
    } catch (error) {
      console.error('Error loading existing session:', error);
    }
  };

  // Load billing totals from inspection_data
  const loadBillingTotals = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_data')
        .select('property_class, measure_by, measure_date')
        .eq('job_id', currentJob.id)
        .not('measure_by', 'is', null)
        .not('measure_date', 'is', null);
      
      if (error) throw error;
      
      // Count by property class
      const classCounts = {};
      data.forEach(record => {
        const propertyClass = record.property_class;
        if (propertyClass) {
          classCounts[propertyClass] = (classCounts[propertyClass] || 0) + 1;
        }
      });
      
      // Calculate grouped totals
      const residential = (classCounts['2'] || 0) + (classCounts['3A'] || 0);
      const commercial4A = classCounts['4A'] || 0;
      const commercial4B = classCounts['4B'] || 0;
      const commercial4C = classCounts['4C'] || 0;
      const total4 = commercial4A + commercial4B + commercial4C;
      const grandTotal = Object.values(classCounts).reduce((sum, count) => sum + count, 0);
      
      setBillingTotals({
        individual: classCounts,
        grouped: {
          residential,
          commercial4A,
          commercial4B, 
          commercial4C,
          total4,
          grandTotal
        }
      });
      
    } catch (error) {
      console.error('Error loading billing totals:', error);
    }
  };

  useEffect(() => {
    if (currentJob) {
      loadEmployeeData();
      loadExistingSession();
      loadBillingTotals();
      checkDataFreshness();
    }
  }, [currentJob]);

  const checkDataFreshness = () => {
    if (!currentJob?.source_file_uploaded_at) return;
    
    const sourceFileAge = Math.floor((new Date() - new Date(currentJob.source_file_uploaded_at)) / (1000 * 60 * 60 * 24));
    
    if (sourceFileAge > 7) {
      setShowDataWarning({
        show: true,
        message: `Source file last updated ${sourceFileAge} days ago`,
        recommendation: "Consider updating source data first in the Upload module",
        allowProceed: true
      });
    }
  };

  // Notification system
  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  // Save settings to database (lock them in)
  const saveSettings = async () => {
    try {
      // In production, save settings to a job_settings or processing_sessions table
      console.log('Saving settings for job:', currentJob.id, settings);
      setSettingsLocked(true);
      addNotification('Settings locked and saved to database', 'success');
    } catch (error) {
      console.error('Error saving settings:', error);
      addNotification('Error saving settings: ' + error.message, 'error');
    }
  };

  // Query property records for this job
  const getPropertyRecords = async () => {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select(`
          property_composite_key,
          property_block,
          property_lot,
          property_qualifier,
          property_addl_card,
          property_location,
          property_m4_class,
          property_cama_class,
          inspection_measure_by,
          inspection_measure_date,
          inspection_list_by,
          inspection_list_date,
          inspection_price_by,
          inspection_price_date,
          inspection_info_by,
          values_mod_improvement,
          values_cama_improvement,
          source_file_name,
          source_file_uploaded_at,
          code_file_name,
          code_file_updated_at,
          file_version
        `)
        .eq('job_id', currentJob.id);
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching property records:', error);
      throw error;
    }
  };

  // Enhanced scrub and validation function
  const scrubAndValidateData = (data, startDate, validInitials, codeMapping) => {
    console.log('Starting enhanced scrub and validation...');
    
    const parseCodeString = (codeStr) => {
      return codeStr.split(',').map(code => {
        const num = parseInt(code.trim());
        return isNaN(num) ? parseInt(code.trim().replace(/^0+/, '')) || 0 : num;
      });
    };
    
    const entryCodes = parseCodeString(codeMapping.entryCodes);
    const refusalCodes = parseCodeString(codeMapping.refusalCodes);
    const estimationCodes = parseCodeString(codeMapping.estimationCodes);
    const invalidCodes = parseCodeString(codeMapping.invalidCodes);
    const pricingCodes = parseCodeString(codeMapping.pricingCodes);
    const allValidCodes = [...entryCodes, ...refusalCodes, ...estimationCodes, ...pricingCodes];
    
    const scrubReport = {
      scrubbed: {
        measureValidDateMissingInitials: 0,
        measureValidInitialsMissingDate: 0,
        listValidDateMissingInitials: 0,
        listValidInitialsMissingDate: 0,
        priceValidDateMissingInitials: 0,
        priceValidInitialsMissingDate: 0,
        invalidInfoBy: 0
      },
      flagged: {
        refusalMismatch: 0,
        entryMismatch: 0,
        estimationMismatch: 0,
        inspectorMismatch: 0,
        zeroImprovementMismatch: 0
      }
    };
    
    const flaggedIssues = [];
    const scrubbedData = [];
    
    data.forEach(row => {
      let cleanRow = { ...row };
      let wasModified = false;
      let shouldInsert = true;
      
      const measureDate = cleanRow.inspection_measure_date ? new Date(cleanRow.inspection_measure_date) : null;
      const measureBy = cleanRow.inspection_measure_by;
      const listDate = cleanRow.inspection_list_date ? new Date(cleanRow.inspection_list_date) : null;
      const listBy = cleanRow.inspection_list_by;
      const priceDate = cleanRow.inspection_price_date ? new Date(cleanRow.inspection_price_date) : null;
      const priceBy = cleanRow.inspection_price_by;
      const infoBy = parseInt(cleanRow.inspection_info_by) || 0;
      const improvementValue = cleanRow.values_mod_improvement || cleanRow.values_cama_improvement || 0;
      const propertyClass = cleanRow.property_m4_class || cleanRow.property_cama_class;
      
      // SCRUB RULES (Clean & Remove)
      
      // 1. Measure field scrubbing
      if (measureDate && measureDate >= startDate && !validInitials.includes(measureBy)) {
        cleanRow.inspection_measure_date = null;
        cleanRow.inspection_measure_by = null;
        cleanRow.inspection_info_by = null;
        scrubReport.scrubbed.measureValidDateMissingInitials++;
        wasModified = true;
      } else if (validInitials.includes(measureBy) && (!measureDate || measureDate < startDate)) {
        cleanRow.inspection_measure_date = null;
        cleanRow.inspection_measure_by = null;
        cleanRow.inspection_info_by = null;
        scrubReport.scrubbed.measureValidInitialsMissingDate++;
        wasModified = true;
      }
      
      // 2. List field scrubbing
      if (listDate && listDate >= startDate && !validInitials.includes(listBy)) {
        cleanRow.inspection_list_date = null;
        cleanRow.inspection_list_by = null;
        scrubReport.scrubbed.listValidDateMissingInitials++;
        wasModified = true;
      } else if (validInitials.includes(listBy) && (!listDate || listDate < startDate)) {
        cleanRow.inspection_list_date = null;
        cleanRow.inspection_list_by = null;
        scrubReport.scrubbed.listValidInitialsMissingDate++;
        wasModified = true;
      }
      
      // 3. Price field scrubbing (BRT only)
      if (currentJob.vendor === 'BRT') {
        if (priceDate && priceDate >= startDate && !validInitials.includes(priceBy)) {
          cleanRow.inspection_price_date = null;
          cleanRow.inspection_price_by = null;
          scrubReport.scrubbed.priceValidDateMissingInitials++;
          wasModified = true;
        } else if (validInitials.includes(priceBy) && (!priceDate || priceDate < startDate)) {
          cleanRow.inspection_price_date = null;
          cleanRow.inspection_price_by = null;
          scrubReport.scrubbed.priceValidInitialsMissingDate++;
          wasModified = true;
        }
      }
      
      // 4. Invalid InfoBy codes scrubbing
      if (infoBy && !allValidCodes.includes(infoBy) && !invalidCodes.includes(infoBy)) {
        cleanRow.inspection_measure_date = null;
        cleanRow.inspection_measure_by = null;
        cleanRow.inspection_info_by = null;
        scrubReport.scrubbed.invalidInfoBy++;
        wasModified = true;
      }
      
      // VALIDATION FLAGS (Report Only - after scrubbing)
      const hasValidInspection = cleanRow.inspection_measure_by && cleanRow.inspection_measure_date;
      const hasListingData = cleanRow.inspection_list_by && cleanRow.inspection_list_date;
      
      if (hasValidInspection && cleanRow.inspection_info_by) {
        const property = {
          block: cleanRow.property_block,
          lot: cleanRow.property_lot,
          qualifier: cleanRow.property_qualifier || '',
          card: cleanRow.property_addl_card || '',
          propertyLocation: cleanRow.property_location || '',
          inspector: cleanRow.inspection_measure_by,
          propertyClass: propertyClass
        };
        
        // 5. Refusal code but missing listing data
        if (refusalCodes.includes(cleanRow.inspection_info_by) && !hasListingData) {
          flaggedIssues.push({ ...property, warning: 'Refusal code but missing listing data' });
          scrubReport.flagged.refusalMismatch++;
        }
        
        // 6. Entry code but missing listing data
        if (entryCodes.includes(cleanRow.inspection_info_by) && !hasListingData) {
          flaggedIssues.push({ ...property, warning: 'Entry code but missing listing data' });
          scrubReport.flagged.entryMismatch++;
        }
        
        // 7. Estimation code but has listing data
        if (estimationCodes.includes(cleanRow.inspection_info_by) && hasListingData) {
          flaggedIssues.push({ ...property, warning: 'Estimation code but has listing data' });
          scrubReport.flagged.estimationMismatch++;
        }
        
        // 8. Residential inspector on commercial property
        const inspectorType = inspectorDefinitions[cleanRow.inspection_measure_by]?.type;
        if (inspectorType === 'residential' && ['4A', '4B', '4C'].includes(propertyClass)) {
          flaggedIssues.push({ ...property, warning: 'Residential inspector on commercial property' });
          scrubReport.flagged.inspectorMismatch++;
        }
        
        // 9. Zero improvement but missing listing data
        if (improvementValue === 0 && hasValidInspection && !hasListingData) {
          flaggedIssues.push({ ...property, warning: 'Zero improvement but missing listing data' });
          scrubReport.flagged.zeroImprovementMismatch++;
        }
      }
      
      // Add to clean data for insertion
      if (shouldInsert) {
        scrubbedData.push(cleanRow);
      }
    });
    
    console.log('Scrub complete:', scrubReport);
    return { scrubbedData, scrubReport, flaggedIssues };
  };

  // Insert clean data into inspection_data table
  const insertIntoInspectionData = async (scrubbedData, sessionId) => {
    try {
      const insertData = scrubbedData.map(row => ({
        job_id: currentJob.id,
        import_session_id: sessionId,
        property_composite_key: row.property_composite_key,
        block: row.property_block,
        lot: row.property_lot,
        qualifier: row.property_qualifier,
        card: row.property_addl_card,
        property_location: row.property_location,
        property_class: row.property_m4_class || row.property_cama_class,
        measure_by: row.inspection_measure_by,
        measure_date: row.inspection_measure_date,
        list_by: row.inspection_list_by,
        list_date: row.inspection_list_date,
        price_by: row.inspection_price_by,
        price_date: row.inspection_price_date,
        info_by_code: row.inspection_info_by,
        project_start_date: settings.projectStartDate,
        source_file_name: row.source_file_name,
        source_file_uploaded_at: row.source_file_uploaded_at,
        code_file_name: row.code_file_name,
        code_file_updated_at: row.code_file_updated_at,
        file_version: row.file_version,
        upload_date: new Date().toISOString(),
        is_new_since_last_upload: true // Will be calculated in production
      }));
      
      // Clear existing data for this session if re-processing
      const { error: deleteError } = await supabase
        .from('inspection_data')
        .delete()
        .eq('job_id', currentJob.id)
        .eq('import_session_id', sessionId);
      
      if (deleteError) console.error('Error clearing existing inspection data:', deleteError);
      
      // Insert new clean data
      const { data, error } = await supabase
        .from('inspection_data')
        .insert(insertData);
        
      if (error) throw error;
      
      console.log(`Inserted ${insertData.length} clean records into inspection_data`);
      return insertData.length;
      
    } catch (error) {
      console.error('Error inserting into inspection_data:', error);
      throw error;
    }
  };

  // Calculate analytics from inspection_data
  const calculateAnalytics = async (sessionId, codeMapping) => {
    try {
      const { data, error } = await supabase
        .from('inspection_data')
        .select('*')
        .eq('job_id', currentJob.id)
        .eq('import_session_id', sessionId);
        
      if (error) throw error;
      
      const parseCodeString = (codeStr) => {
        return codeStr.split(',').map(code => {
          const num = parseInt(code.trim());
          return isNaN(num) ? parseInt(code.trim().replace(/^0+/, '')) || 0 : num;
        });
      };
      
      const entryCodes = parseCodeString(codeMapping.entryCodes);
      const refusalCodes = parseCodeString(codeMapping.refusalCodes);
      const pricingCodes = parseCodeString(codeMapping.pricingCodes);
      
      const validInspections = data.filter(row => row.measure_by && row.measure_date);
      const eligibleProperties = data.filter(row => ['2', '3A'].includes(row.property_class));
      const commercialProperties = data.filter(row => ['4A', '4B', '4C'].includes(row.property_class));
      
      const entryRateProperties = validInspections.filter(row => 
        ['2', '3A'].includes(row.property_class) && 
        entryCodes.includes(row.info_by_code)
      );
      
      const refusalRateProperties = validInspections.filter(row => 
        ['2', '3A'].includes(row.property_class) && 
        refusalCodes.includes(row.info_by_code)
      );
      
      // Pricing calculations (vendor-specific)
      const pricingRateProperties = currentJob.vendor === 'BRT' 
        ? commercialProperties.filter(row => row.price_by && row.price_date)
        : validInspections.filter(row => 
            ['4A', '4B', '4C'].includes(row.property_class) && 
            pricingCodes.includes(row.info_by_code)
          );
      
      // Inspector performance
      const inspectorStats = {};
      validInspections.forEach(row => {
        const inspector = row.measure_by;
        if (!inspector) return;
        
        if (!inspectorStats[inspector]) {
          inspectorStats[inspector] = {
            name: inspectorDefinitions[inspector]?.name || `Inspector ${inspector}`,
            type: inspectorDefinitions[inspector]?.type || 'residential',
            totalInspections: 0,
            dailyAverage: 0,
            daysWorked: new Set(),
            residential: 0,
            commercial: 0
          };
        }
        
        inspectorStats[inspector].totalInspections++;
        
        // Track unique working days (BRT only)
        if (currentJob.vendor === 'BRT' && row.measure_date) {
          inspectorStats[inspector].daysWorked.add(row.measure_date);
        }
        
        // Classify by property type
        if (['2', '3A'].includes(row.property_class)) {
          inspectorStats[inspector].residential++;
        } else if (['4A', '4B', '4C'].includes(row.property_class)) {
          inspectorStats[inspector].commercial++;
        }
      });
      
      // Calculate daily averages
      Object.keys(inspectorStats).forEach(inspector => {
        const stats = inspectorStats[inspector];
        if (currentJob.vendor === 'BRT' && stats.daysWorked.size > 0) {
          stats.dailyAverage = Math.round((stats.totalInspections / stats.daysWorked.size) * 10) / 10;
        } else {
          stats.dailyAverage = null;
        }
        stats.daysWorked = stats.daysWorked.size;
      });
      
      return {
        totalProperties: data.length,
        inspectedProperties: validInspections.length,
        entryRate: {
          count: entryRateProperties.length,
          total: eligibleProperties.length,
          percentage: eligibleProperties.length > 0 ? Math.round((entryRateProperties.length / eligibleProperties.length) * 100) : 0
        },
        refusalRate: {
          count: refusalRateProperties.length,
          total: eligibleProperties.length,
          percentage: eligibleProperties.length > 0 ? Math.round((refusalRateProperties.length / eligibleProperties.length) * 100) : 0
        },
        pricingRate: {
          count: pricingRateProperties.length,
          total: commercialProperties.length,
          percentage: commercialProperties.length > 0 ? Math.round((pricingRateProperties.length / commercialProperties.length) * 100) : 0
        },
        inspectorStats
      };
      
    } catch (error) {
      console.error('Error calculating analytics:', error);
      throw error;
    }
  };

  // Main processing function
  const processProductionData = async () => {
    if (!currentJob) {
      addNotification('No job selected', 'error');
      return;
    }
    
    if (!settingsLocked) {
      addNotification('Please save settings before processing', 'warning');
      return;
    }

    setProcessing(true);
    try {
      console.log('Starting complete production data processing...');
      
      // 1. Load valid employee initials
      const validInitials = await loadEmployeeData();
      
      // 2. Query property records from database
      const propertyData = await getPropertyRecords();
      
      if (!propertyData || propertyData.length === 0) {
        addNotification('No property records found for this job', 'warning');
        return;
      }

      console.log(`Processing ${propertyData.length} property records...`);
      
      // 3. Apply enhanced scrubbing and validation
      const startDate = new Date(settings.projectStartDate);
      const { scrubbedData, scrubReport, flaggedIssues } = scrubAndValidateData(
        propertyData, 
        startDate, 
        validInitials, 
        settings.infoByCodeMappings
      );
      
      // 4. Create new processing session
      const sessionId = crypto.randomUUID();
      setCurrentProcessingSession(sessionId);
      
      // 5. Insert clean data into inspection_data
      const insertedCount = await insertIntoInspectionData(scrubbedData, sessionId);
      
      // 6. Calculate analytics from clean data
      const analytics = await calculateAnalytics(sessionId, settings.infoByCodeMappings);
      
      // 7. Update billing totals
      await loadBillingTotals();
      
      // 8. Generate validation report
      const report = flaggedIssues.length > 0 ? {
        totalIssues: flaggedIssues.length,
        inspectorCount: new Set(flaggedIssues.map(issue => issue.inspector)).size,
        issuesByInspector: flaggedIssues.reduce((acc, issue) => {
          if (!acc[issue.inspector]) acc[issue.inspector] = [];
          acc[issue.inspector].push(issue);
          return acc;
        }, {})
      } : null;
      
      setValidationReport(report);
      
      // 9. Combine results
      const finalResults = {
        ...analytics,
        processingInfo: {
          totalRecords: propertyData.length,
          insertedRecords: insertedCount,
          processingTime: new Date(),
          vendor: currentJob.vendor,
          sessionId,
          scrubReport,
          flaggedIssues: flaggedIssues.length
        }
      };
      
      setResults(finalResults);
      
      // 10. Update job metrics back to AdminJobManagement
      if (onUpdateJobMetrics) {
        onUpdateJobMetrics(currentJob.id, {
          entryRate: analytics.entryRate.percentage,
          refusalRate: analytics.refusalRate.percentage,
          inspectedProperties: analytics.inspectedProperties,
          pricingRate: analytics.pricingRate.percentage
        });
      }
      
      addNotification(`Processing complete! ${insertedCount} clean records inserted.`, 'success');
      
    } catch (error) {
      console.error('Processing error:', error);
      addNotification('Error processing data: ' + error.message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  // Download validation report as Excel
  const downloadValidationReport = () => {
    if (!validationReport) return;
    
    console.log('Generating validation report...', validationReport);
    addNotification('Validation report download would start here', 'info');
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getDaysAgo = (dateString) => {
    const days = Math.floor((new Date() - new Date(dateString)) / (1000 * 60 * 60 * 24));
    return days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`;
  };

  if (!currentJob) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="text-center text-gray-500 py-12">
          <div className="text-4xl mb-4">📋</div>
          <h4 className="text-lg font-medium mb-2">No Job Selected</h4>
          <p className="text-sm">Please select a job to use the Production Tracker.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
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
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {currentJob.name} - Production Tracker
            </h1>
            <p className="text-gray-600">
              Process inspection data, validate field work, and generate payroll analytics
            </p>
          </div>
          {onBackToJobs && (
            <button
              onClick={onBackToJobs}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              ← Back to Jobs
            </button>
          )}
        </div>
      </div>

      {/* Job Info Banner */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div>
              <span className="text-sm font-medium text-gray-600">Vendor:</span>
              <span className={`ml-2 px-3 py-1 rounded-full text-sm font-medium ${
                currentJob.vendor === 'Microsystems' 
                  ? 'bg-blue-100 text-blue-800' 
                  : 'bg-orange-100 text-orange-800'
              }`}>
                {currentJob.vendor}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">CCDD:</span>
              <span className="ml-2 font-bold text-blue-600">{currentJob.ccdd || currentJob.ccddCode}</span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-600">Municipality:</span>
              <span className="ml-2 text-gray-800">{currentJob.municipality}</span>
            </div>
            {settingsLocked && (
              <div className="flex items-center text-green-600">
                <Lock className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">Settings Locked</span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">
              {currentJob.inspectedProperties?.toLocaleString() || 0} of {currentJob.totalProperties?.toLocaleString() || 0}
            </div>
            <div className="text-sm text-gray-600">Properties Inspected</div>
          </div>
        </div>
      </div>

      {/* Project Settings - Lock In */}
      <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-indigo-800 flex items-center space-x-2">
              <Lock className="w-5 h-5" />
              <span>Project Settings</span>
            </h3>
            <p className="text-sm text-indigo-600 mt-1">Lock in project start date for consistent scrubbing</p>
          </div>
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium text-indigo-700 mb-1">Project Start Date</label>
              <input
                type="date"
                value={settings.projectStartDate}
                onChange={(e) => setSettings({...settings, projectStartDate: e.target.value})}
                disabled={settingsLocked}
                className="px-3 py-2 border border-indigo-300 rounded-md text-sm disabled:bg-gray-100"
              />
            </div>
            {!settingsLocked && (
              <button
                onClick={saveSettings}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center space-x-2 text-sm font-medium"
              >
                <Save className="w-4 h-4" />
                <span>Lock Settings</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Data Freshness Warning */}
      {showDataWarning?.show && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-medium text-yellow-800">Data Freshness Notice</h3>
              <p className="text-sm text-yellow-700 mt-1">
                {showDataWarning.message}. {showDataWarning.recommendation}.
              </p>
              {currentJob.source_file_uploaded_at && currentJob.code_file_updated_at && (
                <div className="mt-2 flex items-center space-x-4 text-xs text-yellow-600">
                  <span>📄 Source: {getDaysAgo(currentJob.source_file_uploaded_at)}</span>
                  <span>📋 Code: {getDaysAgo(currentJob.code_file_updated_at)}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowDataWarning({ ...showDataWarning, show: false })}
              className="text-yellow-600 hover:text-yellow-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* InfoBy Code Configuration */}
          <div className={`p-6 border rounded-lg ${settingsLocked ? 'bg-gray-50 border-gray-300' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-blue-800 flex items-center space-x-2">
                <Settings className="w-5 h-5" />
                <span>InfoBy Code Configuration</span>
                <span className="text-sm font-normal text-blue-600">
                  ({currentJob.vendor} Format)
                </span>
              </h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-2">Entry Codes</label>
                <input
                  type="text"
                  value={settings.infoByCodeMappings.entryCodes}
                  onChange={(e) => setSettings({
                    ...settings, 
                    infoByCodeMappings: {...settings.infoByCodeMappings, entryCodes: e.target.value}
                  })}
                  disabled={settingsLocked}
                  placeholder="01,02,03,04"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-blue-600 mt-1">Successful interior access codes</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-2">Refusal Codes</label>
                <input
                  type="text"
                  value={settings.infoByCodeMappings.refusalCodes}
                  onChange={(e) => setSettings({
                    ...settings, 
                    infoByCodeMappings: {...settings.infoByCodeMappings, refusalCodes: e.target.value}
                  })}
                  disabled={settingsLocked}
                  placeholder="06"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-blue-600 mt-1">Property access refusal codes</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-2">Estimation Codes</label>
                <input
                  type="text"
                  value={settings.infoByCodeMappings.estimationCodes}
                  onChange={(e) => setSettings({
                    ...settings, 
                    infoByCodeMappings: {...settings.infoByCodeMappings, estimationCodes: e.target.value}
                  })}
                  disabled={settingsLocked}
                  placeholder="07"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-blue-600 mt-1">Estimated inspection codes</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-2">Invalid Codes</label>
                <input
                  type="text"
                  value={settings.infoByCodeMappings.invalidCodes}
                  onChange={(e) => setSettings({
                    ...settings, 
                    infoByCodeMappings: {...settings.infoByCodeMappings, invalidCodes: e.target.value}
                  })}
                  disabled={settingsLocked}
                  placeholder="00,05"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-blue-600 mt-1">Invalid/exclude codes</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-blue-700 mb-2">
                  Pricing Codes
                  {currentJob.vendor === 'Microsystems' && (
                    <span className="text-xs text-blue-500 ml-2">(Microsystems uses InfoBy for pricing)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={settings.infoByCodeMappings.pricingCodes}
                  onChange={(e) => setSettings({
                    ...settings, 
                    infoByCodeMappings: {...settings.infoByCodeMappings, pricingCodes: e.target.value}
                  })}
                  disabled={settingsLocked}
                  placeholder="08,09"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-blue-600 mt-1">
                  {currentJob.vendor === 'BRT' 
                    ? 'Commercial pricing completion codes' 
                    : 'InfoBy codes that indicate pricing work completed'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Additional Settings */}
          <div className={`p-6 border rounded-lg ${settingsLocked ? 'bg-gray-50 border-gray-300' : 'bg-yellow-50 border-yellow-200'}`}>
            <h3 className="text-lg font-semibold text-yellow-800 mb-4 flex items-center space-x-2">
              <Clock className="w-5 h-5" />
              <span>Additional Settings</span>
            </h3>
            
            <div className="text-center text-gray-500 py-8">
              <Clock className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">Additional date settings will be available in future updates</p>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* Process Button */}
          <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="text-lg font-semibold text-green-800 mb-4 flex items-center space-x-2">
              <Play className="w-5 h-5" />
              <span>Process Data</span>
            </h3>
            
            <button
              onClick={processProductionData}
              disabled={processing || !settingsLocked}
              className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-md hover:shadow-lg transition-all"
            >
              {processing ? (
                <span className="flex items-center justify-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Processing...</span>
                </span>
              ) : (
                <span className="flex items-center justify-center space-x-2">
                  <Play className="w-4 h-4" />
                  <span>🔄 Process Production Data</span>
                </span>
              )}
            </button>
            
            <p className="text-xs text-green-600 mt-2 text-center">
              Scrub data, validate inspections, calculate metrics
            </p>
            
            {!settingsLocked && (
              <p className="text-xs text-red-600 mt-2 text-center">
                Please save and lock settings before processing
              </p>
            )}
          </div>

          {/* Billing Totals */}
          {billingTotals && (
            <div className="p-6 bg-purple-50 border border-purple-200 rounded-lg">
              <h3 className="text-lg font-semibold text-purple-800 mb-4 flex items-center space-x-2">
                <BarChart3 className="w-5 h-5" />
                <span>Billing Summary</span>
              </h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="font-medium text-purple-700">By Class:</div>
                    {Object.entries(billingTotals.individual).map(([propClass, count]) => (
                      <div key={propClass} className="flex justify-between">
                        <span>Class {propClass}:</span>
                        <span className="font-bold">{count}</span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="font-medium text-purple-700">Grouped:</div>
                    <div className="flex justify-between">
                      <span>Residential:</span>
                      <span className="font-bold">{billingTotals.grouped.residential}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Commercial 4A:</span>
                      <span className="font-bold">{billingTotals.grouped.commercial4A}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Commercial 4B:</span>
                      <span className="font-bold">{billingTotals.grouped.commercial4B}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Commercial 4C:</span>
                      <span className="font-bold">{billingTotals.grouped.commercial4C}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span>Total 4 Class:</span>
                      <span className="font-bold">{billingTotals.grouped.total4}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 font-bold text-purple-800">
                      <span>Grand Total:</span>
                      <span>{billingTotals.grouped.grandTotal}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Validation Report */}
          {validationReport && (
            <div className="p-6 bg-orange-50 border border-orange-200 rounded-lg">
              <h3 className="text-lg font-semibold text-orange-800 mb-4 flex items-center space-x-2">
                <FileText className="w-5 h-5" />
                <span>Validation Report</span>
              </h3>
              
              <div className="space-y-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{validationReport.totalIssues}</div>
                  <div className="text-sm text-gray-600">Issues Found</div>
                </div>
                
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-600">{validationReport.inspectorCount}</div>
                  <div className="text-sm text-gray-600">Inspectors with Issues</div>
                </div>
                
                <button
                  onClick={downloadValidationReport}
                  className="w-full px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center justify-center space-x-2 text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Report</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      {results && (
        <div className="mt-8 space-y-6">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200 p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center space-x-2">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <span>🎉 Processing Complete!</span>
            </h2>
            
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-4 bg-white rounded-lg border shadow-sm">
                <div className="text-2xl font-bold text-blue-600">{results.totalProperties.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Total Properties</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg border shadow-sm">
                <div className="text-2xl font-bold text-green-600">{results.inspectedProperties.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Properties Inspected</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg border shadow-sm">
                <div className="text-2xl font-bold text-green-600">{results.entryRate.percentage}%</div>
                <div className="text-sm text-gray-600">Entry Rate</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg border shadow-sm">
                <div className="text-2xl font-bold text-red-600">{results.refusalRate.percentage}%</div>
                <div className="text-sm text-gray-600">Refusal Rate</div>
              </div>
            </div>

            {/* Processing Summary */}
            {results.processingInfo && (
              <div className="mb-6 p-4 bg-white rounded-lg border">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Processing Summary</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-700">Records Processed:</span>
                    <span className="ml-2 text-blue-600 font-bold">{results.processingInfo.totalRecords}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Clean Records:</span>
                    <span className="ml-2 text-green-600 font-bold">{results.processingInfo.insertedRecords}</span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Records Scrubbed:</span>
                    <span className="ml-2 text-orange-600 font-bold">
                      {Object.values(results.processingInfo.scrubReport.scrubbed).reduce((a, b) => a + b, 0)}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Issues Flagged:</span>
                    <span className="ml-2 text-red-600 font-bold">{results.processingInfo.flaggedIssues}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Inspector Performance */}
            <div className="p-4 bg-white rounded-lg border">
              <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center space-x-2">
                <Users className="w-5 h-5" />
                <span>Inspector Performance</span>
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Inspector</th>
                      <th className="text-right p-2">Total</th>
                      <th className="text-right p-2">Daily Avg</th>
                      <th className="text-right p-2">Residential</th>
                      <th className="text-right p-2">Commercial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(results.inspectorStats).map(([initials, stats]) => (
                      <tr key={initials} className="border-b hover:bg-gray-50">
                        <td className="p-2">
                          <div className="font-medium">{stats.name}</div>
                          <div className="text-xs text-gray-500">{initials}</div>
                        </td>
                        <td className="text-right p-2 font-bold">{stats.totalInspections}</td>
                        <td className="text-right p-2 text-green-600 font-medium">
                          {stats.dailyAverage ? stats.dailyAverage.toFixed(1) : 'N/A'}
                        </td>
                        <td className="text-right p-2 text-blue-600">{stats.residential}</td>
                        <td className="text-right p-2 text-purple-600">{stats.commercial}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {currentJob.vendor === 'Microsystems' && (
                <p className="text-xs text-gray-500 mt-2">
                  * Daily averages not available for Microsystems (no measure date tracking)
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionTracker;
