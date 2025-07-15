import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, AlertCircle, CheckCircle, Settings, Database } from 'lucide-react';
import { employeeService, jobService, sourceFileService, propertyService, productionDataService, utilityService } from '../../lib/supabaseClient';
const PayrollProductionUpdater = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('inspectors');
  const [jobs, setJobs] = useState({});
  const [selectedJob, setSelectedJob] = useState(null);
  const [availableJobs, setAvailableJobs] = useState([]);
  const [currentJobName, setCurrentJobName] = useState('');
  const [jobMetrics, setJobMetrics] = useState(null);
  const [inspectorDefinitions, setInspectorDefinitions] = useState({});
  const [newInspector, setNewInspector] = useState({ initials: '', name: '', type: 'residential' });
  const [validationReport, setValidationReport] = useState(null);
  const [dbConnected, setDbConnected] = useState(false);
  const [dbStats, setDbStats] = useState({ employees: 0, jobs: 0, propertyRecords: 0, sourceFiles: 0 });
  const [settings, setSettings] = useState({
    startDate: '2025-04-24',
    lastUpdateDate: '2025-06-01',
    payPerProperty: 2.00,
    targetPropertyClasses: ['2', '3A'],
    applyColorCoding: true,
    autoMarkInspected: true,
    useSlipstreamColors: true,
    infoByCodeMappings: {
      entryCodes: '01,02,03,04',
      refusalCodes: '06', 
      estimationCodes: '07',
      invalidCodes: '00,05'
    }
  });
  
  const csvInputRef = useRef();
  const excelInputRef = useRef();
  const inspectorImportRef = useRef();

  // Initialize database connection
  useEffect(() => {
    initializeDatabase();
  }, []);

  const initializeDatabase = async () => {
    try {
      // Test database connection
      const connectionTest = await utilityService.testConnection();
      setDbConnected(connectionTest.success);
      
      if (connectionTest.success) {
        // Load jobs from database
        const jobsData = await jobService.getAll();
        setAvailableJobs(jobsData);
        
        // Load employees and create inspector definitions
        const employeesData = await employeeService.getAll();
        const definitions = {};
        employeesData.forEach(emp => {
          if (emp.role === 'inspector' && emp.initials) {
            definitions[emp.initials] = {
              name: `${emp.first_name} ${emp.last_name}`,
              type: emp.inspector_type || 'residential'
            };
          }
        });
        setInspectorDefinitions(definitions);
        
        // Get database statistics
        const stats = await utilityService.getStats();
        setDbStats(stats);
      }
    } catch (error) {
      console.error('Database initialization error:', error);
      setDbConnected(false);
    }
  };

  const updateInspectorDefinitions = (newDefinitions) => {
    setInspectorDefinitions(newDefinitions);
  };

  const handleFileUpload = (file, type) => {
    if (type === 'csv') {
      setCsvFile(file);
    } else {
      setExcelFile(file);
    }
  };

  const importInspectorsFromExcel = async (file) => {
    try {
      const excelArrayBuffer = await readFileAsArrayBuffer(file);
      const XLSX = window.XLSX || await import('xlsx');  
      
      const workbook = XLSX.read(excelArrayBuffer, {
        cellStyles: true,
        cellFormulas: true,
        cellDates: true,
        cellNF: true,
        sheetStubs: true
      });
      
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      const newInspectors = {};
      const employeesToCreate = [];
      let importCount = 0;
      
      data.forEach(row => {
        const inspectorName = row['Inspector'];
        const role = row['Role'];
        
        if (inspectorName && role && (role === 'Residential' || role === 'Commercial')) {
          const initialsMatch = inspectorName.match(/\(([A-Z]{2,3})\)/);
          if (initialsMatch) {
            const initials = initialsMatch[1];
            const fullName = inspectorName.replace(/\s*\([A-Z]{2,3}\)/, '').trim();
            const [firstName, ...lastNameParts] = fullName.split(' ');
            
            newInspectors[initials] = {
              name: fullName,
              type: role.toLowerCase()
            };

            // Prepare for database import
            employeesToCreate.push({
              employee_number: `IMP_${Date.now()}_${initials}`,
              first_name: firstName,
              last_name: lastNameParts.join(' '),
              initials: initials,
              role: 'inspector',
              inspector_type: role.toLowerCase(),
              employment_status: 'active',
              created_by: 'system-import'
            });
            
            importCount++;
          }
        }
      });
      
      // Import to database if connected
      if (dbConnected && employeesToCreate.length > 0) {
        await employeeService.bulkImport(employeesToCreate);
      }
      
      setInspectorDefinitions(prev => ({...prev, ...newInspectors}));
      
      alert(`Successfully imported ${importCount} inspectors!\n\nImported inspectors:\n${Object.entries(newInspectors).map(([initials, info]) => `${initials} - ${info.name} (${info.type})`).join('\n')}\n\n${dbConnected ? '✅ Saved to database' : '⚠️ Local only (database not connected)'}`);
      
    } catch (error) {
      console.error('Import error:', error);
      alert(`Error importing inspectors: ${error.message}`);
    }
  };

  const scrubData = (data, startDate) => {
    console.log('Applying scrubbing rules...');
    
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      try {
        return new Date(dateStr);
      } catch (e) {
        return null;
      }
    };

    let scrubbedCount = 0;
    
    const scrubbedData = data.map(row => {
      let cleanRow = {...row};
      let wasModified = false;

      // MEASURED BY/DATE SCRUBBING
      const measureDate = parseDate(cleanRow.MEASUREDT);
      const measureBy = cleanRow.MEASUREBY;
      
      if ((measureDate && measureDate < startDate) || 
          (!measureDate && measureBy) || 
          (measureDate && !measureBy)) {
        cleanRow.MEASUREDT = null;
        cleanRow.MEASUREBY = null;
        cleanRow.INFOBY = null;
        wasModified = true;
      }

      // PRICED BY/DATE SCRUBBING
      const priceDate = parseDate(cleanRow.PRICEDT);
      const priceBy = cleanRow.PRICEBY;
      
      if ((priceDate && priceDate < startDate) || 
          (!priceDate && priceBy) || 
          (priceDate && !priceBy)) {
        cleanRow.PRICEDT = null;
        cleanRow.PRICEBY = null;
        wasModified = true;
      }

      // FIELD CALLS SCRUBBING
      for (let i = 1; i <= 7; i++) {
        const callDate = parseDate(cleanRow[`FIELDCALLDT_${i}`]);
        const callBy = cleanRow[`FIELDCALL_${i}`];
        
        if ((callDate && callDate < startDate) || 
            (!callDate && callBy) || 
            (callDate && !callBy)) {
          cleanRow[`FIELDCALLDT_${i}`] = null;
          cleanRow[`FIELDCALL_${i}`] = null;
          wasModified = true;
        }
      }

      if (wasModified) scrubbedCount++;
      return cleanRow;
    });

    console.log(`Scrubbed ${scrubbedCount} records`);
    return scrubbedData;
  };

  const validateData = (data, codeMapping) => {
    console.log('Running validation checks...');
    
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

    const validationIssues = [];

    data.forEach(row => {
      // Only validate properties with valid Measured By/Date after scrub
      if (!row.MEASUREBY || !row.MEASUREDT) return;

      const inspector = row.MEASUREBY;
      const infoBy = row.INFOBY;
      const hasListedData = row.LISTBY && row.LISTDT;
      const improvementValue = row.VALUES_IMPROVTAXABLEVALUE || 0;

      const property = {
        block: row.BLOCK,
        lot: row.LOT,
        qualifier: row.QUALIFIER || '',
        card: row.CARD,
        propertyLocation: row.PROPERTY_LOCATION || '',
        inspector: inspector
      };

      // Rule 1: Entry codes but no Listed data
      if (entryCodes.includes(infoBy) && !hasListedData) {
        validationIssues.push({
          ...property,
          warning: 'Info By Mismatch-Inspected?'
        });
      }

      // Rule 2: Refusal codes but no Listed data
      if (refusalCodes.includes(infoBy) && !hasListedData) {
        validationIssues.push({
          ...property,
          warning: 'Info By Mismatch-Refusal'
        });
      }

      // Rule 3: Estimation codes but has Listed data
      if (estimationCodes.includes(infoBy) && hasListedData) {
        validationIssues.push({
          ...property,
          warning: 'Info By Mismatch-Inspected?'
        });
      }

      // Rule 4: Invalid codes
      if (invalidCodes.includes(infoBy)) {
        validationIssues.push({
          ...property,
          warning: 'Info By Code Invalid'
        });
      }

      // Rule 5: $0 improvement value validation
      if (improvementValue === 0) {
        if (infoBy !== 1 || !hasListedData) {
          validationIssues.push({
            ...property,
            warning: 'InfoBy Code and Inspection Info Invalid for No Improvement'
          });
        }
      }
    });

    console.log(`Found ${validationIssues.length} validation issues`);
    return validationIssues;
  };

  const generateValidationReport = (validationIssues) => {
    if (validationIssues.length === 0) return null;

    // Group issues by inspector
    const issuesByInspector = {};
    validationIssues.forEach(issue => {
      if (!issuesByInspector[issue.inspector]) {
        issuesByInspector[issue.inspector] = [];
      }
      issuesByInspector[issue.inspector].push(issue);
    });

    // Create Excel workbook
    const XLSX = window.XLSX || require('xlsx');
    const workbook = XLSX.utils.book_new();

    // Create summary sheet
    const summaryData = [
      ['Inspector', 'Total Issues', 'Inspector Name'],
      ...Object.entries(issuesByInspector).map(([inspector, issues]) => [
        inspector,
        issues.length,
        inspectorDefinitions[inspector]?.name || `Inspector ${inspector}`
      ])
    ];
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    // Auto-size summary sheet columns
    summarySheet['!cols'] = [
      { wch: 12 },  // Inspector
      { wch: 15 },  // Total Issues
      { wch: 25 }   // Inspector Name
    ];
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Create sheet for each inspector
    Object.entries(issuesByInspector).forEach(([inspector, issues]) => {
      const sheetData = [
        ['Block', 'Lot', 'Qualifier', 'Card', 'Property Location', 'Warning Message'],
        ...issues.map(issue => [
          issue.block,
          issue.lot,
          issue.qualifier,
          issue.card,
          issue.propertyLocation,
          issue.warning
        ])
      ];
      
      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      
      // Auto-size columns to fit content
      const columnWidths = [
        { wch: 8 },   // Block
        { wch: 8 },   // Lot  
        { wch: 12 },  // Qualifier
        { wch: 8 },   // Card
        { wch: 35 },  // Property Location
        { wch: 45 }   // Warning Message
      ];
      sheet['!cols'] = columnWidths;
      
      // Limit sheet name to 31 characters for Excel compatibility
      const sheetName = inspector.length > 31 ? inspector.substring(0, 31) : inspector;
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });

    return {
      workbook,
      totalIssues: validationIssues.length,
      inspectorCount: Object.keys(issuesByInspector).length,
      issuesByInspector
    };
  };

  const downloadValidationReport = () => {
    if (!validationReport) return;

    const XLSX = window.XLSX || require('xlsx');
    const fileName = `Inspection_Validation_Report_${selectedJob?.job_name || currentJobName}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.xlsx`;
    
    XLSX.writeFile(validationReport.workbook, fileName);
  };

  const calculateAnalytics = (data, codeMapping) => {
    console.log('Calculating analytics...');
    
    const parseCodeString = (codeStr) => {
      return codeStr.split(',').map(code => {
        const num = parseInt(code.trim());
        return isNaN(num) ? parseInt(code.trim().replace(/^0+/, '')) || 0 : num;
      });
    };
    
    const entryCodes = parseCodeString(codeMapping.entryCodes);
    const refusalCodes = parseCodeString(codeMapping.refusalCodes);

    const hasCompleteInspectionData = (row) => {
      return row.MEASUREBY && row.MEASUREDT && row.LISTBY && row.LISTDT;
    };

    const isEligibleProperty = (row) => {
      const propClass = row.PROPCLASS || row.PROPERTY_CLASS;
      return propClass === 2 || propClass === '2' || propClass === '3A' || propClass === '3a';
    };

    const totalProperties = data.length;
    const measuredProperties = data.filter(row => row.MEASUREBY && row.MEASUREDT);
    const eligibleProperties = data.filter(isEligibleProperty);
    
    const entryRateProperties = eligibleProperties.filter(row => {
      return hasCompleteInspectionData(row) && entryCodes.includes(row.INFOBY);
    });

    const refusalRateProperties = eligibleProperties.filter(row => {
      return hasCompleteInspectionData(row) && refusalCodes.includes(row.INFOBY);
    });

    const inspectorStats = {};
    measuredProperties.forEach(row => {
      const inspector = row.MEASUREBY;
      if (!inspector) return;
      
      if (!inspectorStats[inspector]) {
        inspectorStats[inspector] = {
          name: inspectorDefinitions[inspector]?.name || `Inspector ${inspector}`,
          type: inspectorDefinitions[inspector]?.type || 'residential',
          totalProperties: 0,
          eligibleProperties: 0,
          payrollAmount: 0,
          inspectionTypes: { exterior: 0, interior: 0, commercial: 0 }
        };
      }
      
      inspectorStats[inspector].totalProperties++;
      inspectorStats[inspector].inspectionTypes.exterior++;
      
      if (row.LISTBY && row.LISTDT) {
        inspectorStats[inspector].inspectionTypes.interior++;
      }
      
      if (isEligibleProperty(row) && hasCompleteInspectionData(row) && entryCodes.includes(row.INFOBY)) {
        inspectorStats[inspector].eligibleProperties++;
        inspectorStats[inspector].payrollAmount += settings.payPerProperty;
      }
    });

    const totalPayroll = Object.values(inspectorStats).reduce((sum, stats) => sum + stats.payrollAmount, 0);

    const results = {
      totalMatches: totalProperties,
      updatedRecords: measuredProperties.length,
      markedInspected: measuredProperties.length,
      colorCodedRows: measuredProperties.length,
      entryRate: {
        count: entryRateProperties.length,
        total: eligibleProperties.length,
        percentage: eligibleProperties.length > 0 ? (entryRateProperties.length / eligibleProperties.length) * 100 : 0
      },
      refusalRate: {
        count: refusalRateProperties.length,
        total: eligibleProperties.length,
        percentage: eligibleProperties.length > 0 ? (refusalRateProperties.length / eligibleProperties.length) * 100 : 0
      },
      payrollAnalytics: {
        inspectorStats,
        totalPayroll,
        eligibleProperties: Object.values(inspectorStats).reduce((sum, stats) => sum + stats.eligibleProperties, 0),
        inspectionTypes: Object.values(inspectorStats).reduce((acc, stats) => ({
          exterior: acc.exterior + stats.inspectionTypes.exterior,
          interior: acc.interior + stats.inspectionTypes.interior,
          commercial: acc.commercial + stats.inspectionTypes.commercial
        }), { exterior: 0, interior: 0, commercial: 0 })
      }
    };

    const metrics = {
      overallCompletion: { 
        total: totalProperties, 
        inspected: measuredProperties.length, 
        percentage: (measuredProperties.length / totalProperties) * 100 
      },
      interiorInspections: { 
        class2_3A: { 
          total: eligibleProperties.length, 
          listed: entryRateProperties.length, 
          percentage: results.entryRate.percentage
        } 
      },
      pricingInspections: { 
        class4ABC: { 
          total: data.filter(row => ['4A', '4B', '4C'].includes(row.PROPCLASS)).length, 
          priced: data.filter(row => ['4A', '4B', '4C'].includes(row.PROPCLASS) && row.PRICEBY && row.PRICEDT).length, 
          percentage: 0 
        } 
      },
      inspectorActivity: inspectorStats,
      projectedCompletion: {
        remainingProperties: totalProperties - measuredProperties.length,
        businessDaysToComplete: Math.ceil((totalProperties - measuredProperties.length) / 50),
        estimatedFinishDate: new Date(Date.now() + Math.ceil((totalProperties - measuredProperties.length) / 50) * 24 * 60 * 60 * 1000)
      }
    };

    return { results, metrics };
  };

  // UPDATED PROCESS FILES FUNCTION WITH SUPABASE INTEGRATION
  const processFiles = async () => {
    if (!csvFile) {
      alert('Please upload a CSV file');
      return;
    }

    if (!selectedJob && !currentJobName.trim()) {
      alert('Please select a job or enter a new job name');
      return;
    }

    setProcessing(true);
    try {
      console.log('Starting file processing with Supabase integration...');
      
      const csvText = await readFileAsText(csvFile);
      const Papa = window.Papa || await import('papaparse');
      const parsedData = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [',', '\t', '|', ';']
      });

      console.log('Parsed CSV data:', parsedData.data.length, 'records');

      let job = selectedJob;
      let fileVersion = null;

      // If connected to database, handle file versioning
      if (dbConnected) {
        // Use selected job or find/create job by name
        if (!job && currentJobName.trim()) {
          // Look for existing job by name
          const existingJob = availableJobs.find(j => j.job_name === currentJobName.trim());
          if (existingJob) {
            job = existingJob;
          } else {
            // Note: In full implementation, you'd create a new job here
            console.log('Would create new job:', currentJobName.trim());
          }
        }

        if (job) {
          // Create new source file version
          fileVersion = await sourceFileService.createVersion(
            job.id,
            csvFile.name,
            csvFile.size,
            'system-user' // TODO: Get actual user ID from auth
          );
          console.log('Created file version:', fileVersion.version_number);
        }
      }

      // Apply scrubbing
      const startDate = new Date(settings.startDate);
      const scrubbedData = scrubData(parsedData.data, startDate);
      
      // Import to database if connected and have job/file version
      if (dbConnected && job && fileVersion) {
        try {
          const importResult = await propertyService.importCSVData(
            job.id,
            fileVersion.id,
            scrubbedData,
            'system-user' // TODO: Get actual user ID from auth
          );

          // Update file version with results
          await sourceFileService.updateVersion(fileVersion.id, {
            total_records: parsedData.data.length,
            records_processed: importResult.imported,
            processing_status: 'completed',
            processing_notes: `Successfully imported ${importResult.imported} of ${importResult.total} records`
          });

          // Update production summary
          await productionDataService.updateSummary(job.id);
          
          console.log('Database import successful:', importResult);
        } catch (dbError) {
          console.error('Database import error:', dbError);
          alert(`Warning: Data processed locally but database save failed: ${dbError.message}`);
        }
      }
      
      // Run validation
      const validationIssues = validateData(scrubbedData, settings.infoByCodeMappings);
      
      // Generate validation report
      const report = generateValidationReport(validationIssues);
      setValidationReport(report);
      
      // Calculate analytics
      const analytics = calculateAnalytics(scrubbedData, settings.infoByCodeMappings);
      
      // Add validation summary and database info to results
      analytics.results.validationSummary = {
        totalIssues: validationIssues.length,
        inspectorsWithIssues: report ? report.inspectorCount : 0,
        hasReport: !!report
      };

      if (dbConnected && job && fileVersion) {
        analytics.results.databaseInfo = {
          jobName: job.job_name,
          fileVersion: fileVersion.version_number,
          recordsImported: parsedData.data.length,
          saved: true
        };
      } else {
        analytics.results.databaseInfo = {
          jobName: currentJobName || 'Local Processing',
          saved: false,
          reason: !dbConnected ? 'Database not connected' : 'No job selected'
        };
      }
      
      // Store job data locally for backward compatibility
      const jobData = {
        name: (selectedJob?.job_name || currentJobName).trim(),
        date: new Date().toISOString(),
        csvData: scrubbedData,
        results: analytics.results,
        metrics: analytics.metrics,
        settings: {...settings},
        inspectorDefinitions: {...inspectorDefinitions},
        validationReport: report
      };
      
      setJobs(prev => ({...prev, [jobData.name]: jobData}));
      setResults(analytics.results);
      setJobMetrics(analytics.metrics);
      setActiveTab('payroll');

      // Success message
      const successMsg = dbConnected && job && fileVersion 
        ? `✅ Success! File Version ${fileVersion.version_number} processed and saved to database.`
        : `✅ Processing complete! ${!dbConnected ? '(Local only - database not connected)' : '(Local only - no job selected)'}`;
      
      alert(successMsg + `\n\nRecords: ${parsedData.data.length}\nValidation Issues: ${validationIssues.length}`);
      
    } catch (error) {
      console.error('Processing error:', error);
      alert(`❌ Error processing file: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const readFileAsText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const readFileAsArrayBuffer = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(file);
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          PPA Management OS - Production Tracker
        </h1>
        <p className="text-gray-600">
          Integrated payroll processing and production tracking with Supabase database
        </p>
      </div>

      {/* Database Status */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className={`w-5 h-5 ${dbConnected ? 'text-green-600' : 'text-red-600'}`} />
            <span className={`font-medium ${dbConnected ? 'text-green-800' : 'text-red-800'}`}>
              Database: {dbConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {dbConnected && (
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <span>{dbStats.employees} Employees</span>
              <span>{dbStats.jobs} Jobs</span>
              <span>{dbStats.propertyRecords?.toLocaleString() || 0} Property Records</span>
              <span>{dbStats.sourceFiles} Source Files</span>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('inspectors')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'inspectors'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              👥 Inspector Management
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📁 Upload & Process
            </button>
            <button
              onClick={() => setActiveTab('payroll')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'payroll'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              💰 Payroll Processing
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'metrics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📊 Job Metrics
            </button>
            <button
              onClick={() => setActiveTab('jobs')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'jobs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              📋 All Jobs ({Object.keys(jobs).length})
            </button>
          </nav>
        </div>
      </div>

      {/* Inspector Management Tab - Keep your existing code */}
      {activeTab === 'inspectors' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center mb-6">
              <Settings className="w-8 h-8 mr-3 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Inspector Management</h2>
                <p className="text-gray-600 mt-1">
                  {dbConnected 
                    ? `Connected to database with ${dbStats.employees} employees`
                    : 'Manage inspector profiles for payroll tracking and color coding'
                  }
                </p>
              </div>
            </div>
            
            <div className="mb-6 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                ➕ Add New Inspector
              </h3>
              
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-3 flex items-center">
                  📊 Import from Excel File
                </h4>
                <p className="text-sm text-blue-700 mb-3">
                  Import inspectors directly from your staff Excel file. {dbConnected && 'Data will be saved to the database automatically.'}
                </p>
                <div className="flex items-center gap-4">
                  <input
                    ref={inspectorImportRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        importInspectorsFromExcel(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => inspectorImportRef.current.click()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import from Excel
                  </button>
                  <div className="text-xs text-blue-600">
                    Expected format: "Last, First (XX)" in Column B, "Residential" or "Commercial" in Column F
                  </div>
                </div>
              </div>
              
              <div className="border-t border-gray-200 pt-4">
                <h4 className="font-semibold text-gray-700 mb-3">Manual Entry</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Initials *</label>
                    <input
                      type="text"
                      placeholder="e.g., AM"
                      value={newInspector.initials}
                      onChange={(e) => setNewInspector({...newInspector, initials: e.target.value.toUpperCase()})}
                      className="w-full p-3 border rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      maxLength="3"
                    />
                    <p className="text-xs text-gray-500 mt-1">2-3 uppercase letters</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g., Arcadio Martinez"
                      value={newInspector.name}
                      onChange={(e) => setNewInspector({...newInspector, name: e.target.value})}
                      className="w-full p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Inspector's full name</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Inspector Type *</label>
                    <select
                      value={newInspector.type}
                      onChange={(e) => setNewInspector({...newInspector, type: e.target.value})}
                      className="w-full p-3 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="residential">🏠 Residential</option>
                      <option value="commercial">🏭 Commercial</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Determines color coding</p>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={async () => {
                        if (newInspector.initials && newInspector.name) {
                          // Add to local state
                          setInspectorDefinitions({
                            ...inspectorDefinitions,
                            [newInspector.initials]: {
                              name: newInspector.name,
                              type: newInspector.type
                            }
                          });

                          // Add to database if connected
                          if (dbConnected) {
                            try {
                              const [firstName, ...lastNameParts] = newInspector.name.split(' ');
                              await employeeService.create({
                                employee_number: `MAN_${Date.now()}`,
                                first_name: firstName,
                                last_name: lastNameParts.join(' '),
                                initials: newInspector.initials,
                                role: 'inspector',
                                inspector_type: newInspector.type,
                                employment_status: 'active',
                                created_by: 'manual-entry'
                              });
                            } catch (error) {
                              console.error('Database save error:', error);
                            }
                          }

                          setNewInspector({ initials: '', name: '', type: 'residential' });
                        }
                      }}
                      disabled={!newInspector.initials || !newInspector.name}
                      className="w-full px-4 py-3 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Inspector
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg border shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-700 flex items-center">
                  📋 Current Inspectors
                </h3>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                    {Object.keys(inspectorDefinitions).length} inspector{Object.keys(inspectorDefinitions).length !== 1 ? 's' : ''} configured
                  </div>
                  <div className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
                    dbConnected ? 'text-green-600 bg-green-100' : 'text-yellow-600 bg-yellow-100'
                  }`}>
                    {dbConnected ? '💾 Saved to database' : '⚠️ Local only'}
                  </div>
                </div>
              </div>
              
              {Object.keys(inspectorDefinitions).length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">👥</div>
                  <h4 className="text-lg font-medium mb-2">No Inspectors Configured</h4>
                  <p className="text-sm">Add your first inspector above to get started with payroll tracking and color coding!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {Object.entries(inspectorDefinitions).map(([initials, info]) => (
                    <div key={initials} className={`flex justify-between items-center p-4 rounded-lg border-l-4 transition-all hover:shadow-md ${
                      info.type === 'commercial' ? 'bg-blue-50 border-blue-400 hover:bg-blue-100' : 'bg-green-50 border-green-400 hover:bg-green-100'
                    }`}>
                      <div className="flex items-center flex-1">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border-2 border-current mr-4">
                          <span className={`font-bold text-lg ${
                            info.type === 'commercial' ? 'text-blue-600' : 'text-green-600'
                          }`}>
                            {initials}
                          </span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-lg text-gray-800">{info.name}</span>
                            <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                              info.type === 'commercial' ? 'bg-blue-200 text-blue-800' : 'bg-green-200 text-green-800'
                            }`}>
                              {info.type === 'commercial' ? '🏭 Commercial' : '🏠 Residential'}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            Color coding: {info.type === 'commercial' ? 'Blue scheme for commercial/warehouse properties' : 'Green scheme for residential/home properties'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const updated = {...inspectorDefinitions};
                          delete updated[initials];
                          updateInspectorDefinitions(updated);
                        }}
                        className="ml-4 text-red-500 hover:text-red-700 text-sm font-medium px-4 py-2 rounded hover:bg-red-50 transition-colors border border-red-200 hover:border-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div>
          {/* Job Selection Section */}
          {dbConnected && availableJobs.length > 0 && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-lg font-semibold text-blue-800 mb-3">📋 Job Selection</h3>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-blue-700 mb-2">
                    Select Existing Job
                  </label>
                  <select
                    value={selectedJob?.id || ''}
                    onChange={(e) => {
                      const job = availableJobs.find(j => j.id === e.target.value);
                      setSelectedJob(job);
                      setCurrentJobName('');
                    }}
                    className="w-full p-3 border border-blue-300 rounded-lg text-sm"
                  >
                    <option value="">-- Select a job --</option>
                    {availableJobs.map(job => (
                      <option key={job.id} value={job.id}>
                        {job.job_name} ({job.client_name})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-center text-gray-500 font-medium">OR</div>
              </div>
            </div>
          )}

          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="text-lg font-semibold text-yellow-800 mb-3">🏷️ Job Information</h3>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  Job Name *
                </label>
                <input
                  type="text"
                  value={currentJobName}
                  onChange={(e) => {
                    setCurrentJobName(e.target.value);
                    if (e.target.value) setSelectedJob(null);
                  }}
                  placeholder="e.g., CCDD-Municipality Name"
                  className="w-full p-3 border border-yellow-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                />
                <p className="text-xs text-yellow-600 mt-1">
                  {selectedJob ? 'Selected job from database' : 'Enter name for local processing'}
                </p>
              </div>
              {Object.keys(jobs).length > 0 && (
                <div>
                  <select
                    value=""
                    onChange={(e) => setCurrentJobName(e.target.value)}
                    className="p-3 border border-yellow-300 rounded-lg text-sm"
                  >
                    <option value="">Load Previous Job</option>
                    {Object.keys(jobs).map(jobName => (
                      <option key={jobName} value={jobName}>{jobName}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Rest of your existing upload tab code... */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-3">
              <Settings className="w-5 h-5 mr-2" />
              <h3 className="text-lg font-semibold">Scrub Settings</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">Project Start Date</label>
                <input
                  type="date"
                  value={settings.startDate}
                  onChange={(e) => setSettings({...settings, startDate: e.target.value})}
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Dates before this will be cleaned</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Payroll Process Date</label>
                <input
                  type="date"
                  value={settings.lastUpdateDate}
                  onChange={(e) => setSettings({...settings, lastUpdateDate: e.target.value})}
                  className="w-full p-2 border rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Calculate pay for work since this date</p>
              </div>
            </div>
          </div>

          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-lg font-semibold text-blue-800 mb-3">🏷️ InfoBy Code Configuration</h3>
            <p className="text-sm text-blue-700 mb-4">
              Configure the InfoBy codes specific to this town/job for accurate entry and refusal rate calculations.
            </p>
            
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
                  placeholder="01,02,03,04"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm"
                />
                <p className="text-xs text-blue-600 mt-1">Codes for successful interior access (comma-separated)</p>
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
                  placeholder="06"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm"
                />
                <p className="text-xs text-blue-600 mt-1">Codes for property access refusal</p>
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
                  placeholder="07"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm"
                />
                <p className="text-xs text-blue-600 mt-1">Codes for estimated inspections</p>
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
                  placeholder="00,05"
                  className="w-full p-2 border border-blue-300 rounded-md text-sm"
                />
                <p className="text-xs text-blue-600 mt-1">Codes that should not count toward any metrics</p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-gradient-to-br from-blue-50 to-green-50">
              <Upload className="w-16 h-16 mx-auto mb-4 text-blue-500" />
              <h3 className="text-xl font-semibold mb-2 text-gray-800">Upload CSV Production File *</h3>
              <p className="text-sm text-gray-600 mb-6">
                Select your REVAL PRODUCTION CSV file for processing and analytics
              </p>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => handleFileUpload(e.target.files[0], 'csv')}
                className="hidden"
              />
              <button
                onClick={() => csvInputRef.current.click()}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium text-lg"
              >
                Choose CSV File
              </button>
              {csvFile && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-700 font-medium">
                    ✓ File Ready: {csvFile.name}
                  </p>
                  <p className="text-sm text-green-600 mt-1">
                    CSV file loaded and ready for processing
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mb-6">
            <button
              onClick={processFiles}
              disabled={!csvFile || (!selectedJob && !currentJobName.trim()) || processing}
              className="px-12 py-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xl font-bold shadow-lg"
            >
              {processing ? (
                <span className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  {dbConnected ? 'Processing & Saving to Database...' : 'Processing Locally...'}
                </span>
              ) : (
                <>
                  {dbConnected ? '🚀 Process & Save to Database' : '🧹 Process Locally'}
                </>
              )}
            </button>
            <p className="text-sm text-gray-600 mt-2">
              {dbConnected 
                ? 'Clean data, validate, and save with file versioning to Supabase' 
                : 'Clean data and run validation (local processing only)'
              }
            </p>
          </div>

          {results && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                <h3 className="text-lg font-semibold text-green-800">Processing Complete!</h3>
              </div>

              {/* Database Status */}
              {results.databaseInfo && (
                <div className="mb-4 p-3 bg-white border border-gray-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">Job: {results.databaseInfo.jobName}</span>
                      {results.databaseInfo.fileVersion && (
                        <span className="ml-2 text-sm text-gray-600">
                          (File Version {results.databaseInfo.fileVersion})
                        </span>
                      )}
                    </div>
                    <div className={`px-3 py-1 rounded-full text-sm ${
                      results.databaseInfo.saved 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {results.databaseInfo.saved ? '✅ Saved to Database' : `⚠️ ${results.databaseInfo.reason}`}
                    </div>
                  </div>
                </div>
              )}

              {/* Job Summary Header */}
              <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  For {selectedJob?.job_name || currentJobName} as of {new Date().toLocaleDateString()}
                </h3>
                <p className="text-gray-600">Processing summary:</p>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{results.totalMatches.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Properties</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{results.updatedRecords.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Properties Inspected</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{Math.round((results.updatedRecords / results.totalMatches) * 100)}%</div>
                  <div className="text-sm text-gray-600">Overall Complete</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{results.entryRate.count.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Interior Inspections</div>
                </div>
              </div>

              <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📊 Key Analytics</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-green-50 rounded">
                    <div className="text-xl font-bold text-green-600">
                      {results.entryRate.count.toLocaleString()} Interior Inspections Completed, {Math.round(results.entryRate.percentage)}%
                    </div>
                    <div className="text-sm text-gray-600">Entry Rate for Class 2/3A Properties</div>
                  </div>
                  
                  <div className="p-3 bg-red-50 rounded">
                    <div className="text-xl font-bold text-red-600">
                      {results.refusalRate.count.toLocaleString()} Refused Inspections, {Math.round(results.refusalRate.percentage)}%
                    </div>
                    <div className="text-sm text-gray-600">Refusal Rate for Class 2/3A Properties</div>
                  </div>
                </div>
              </div>

              {/* Validation Report Section */}
              {results.validationSummary && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-orange-800 mb-4">🔍 Validation Summary</h3>
                  
                  {results.validationSummary.totalIssues > 0 ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="text-center p-3 bg-white rounded">
                          <div className="text-2xl font-bold text-orange-600">{results.validationSummary.totalIssues.toLocaleString()}</div>
                          <div className="text-sm text-gray-600">Validation Issues Found</div>
                        </div>
                        <div className="text-center p-3 bg-white rounded">
                          <div className="text-2xl font-bold text-orange-600">{results.validationSummary.inspectorsWithIssues}</div>
                          <div className="text-sm text-gray-600">Inspectors with Issues</div>
                        </div>
                      </div>
                      
                      <div className="text-center bg-white p-4 rounded-lg">
                        <button
                          onClick={downloadValidationReport}
                          className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md transition-colors"
                        >
                          <Download className="w-5 h-5 mr-2" />
                          📊 Download Inspection Validation Report
                        </button>
                        <p className="text-sm text-gray-700 mt-2">
                          Excel file with inspector-specific validation issues organized by tabs
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-green-600 py-4">
                      <CheckCircle className="w-12 h-12 mx-auto mb-2" />
                      <h4 className="text-lg font-semibold">No Validation Issues Found!</h4>
                      <p className="text-sm">All inspection data passed validation checks.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payroll Tab */}
      {activeTab === 'payroll' && (
        <div className="text-center text-gray-500 py-12">
          <p>Payroll processing features available after upload...</p>
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <div className="text-center text-gray-500 py-12">
          <p>Job metrics available after upload...</p>
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === 'jobs' && (
        <div className="text-center text-gray-500 py-12">
          <p>Job history available after processing...</p>
        </div>
      )}
    </div>
  );
};

export default PayrollProductionUpdater;
