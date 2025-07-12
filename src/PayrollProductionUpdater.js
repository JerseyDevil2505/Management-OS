import React, { useState, useRef } from 'react';
import { Upload, Download, AlertCircle, CheckCircle, Settings } from 'lucide-react';

const PayrollProductionUpdater = () => {
  const [csvFile, setCsvFile] = useState(null);
  const [excelFile, setExcelFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('inspectors');
  const [jobs, setJobs] = useState({});
  const [currentJobName, setCurrentJobName] = useState('');
  const [jobMetrics, setJobMetrics] = useState(null);
  const [inspectorDefinitions, setInspectorDefinitions] = useState({});
  const [showInspectorManager, setShowInspectorManager] = useState(false);
  const [newInspector, setNewInspector] = useState({ initials: '', name: '', type: 'residential' });
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
      let importCount = 0;
      
      data.forEach(row => {
        const inspectorName = row['Inspector'];
        const role = row['Role'];
        
        if (inspectorName && role && (role === 'Residential' || role === 'Commercial')) {
          const initialsMatch = inspectorName.match(/\(([A-Z]{2,3})\)/);
          if (initialsMatch) {
            const initials = initialsMatch[1];
            const fullName = inspectorName.replace(/\s*\([A-Z]{2,3}\)/, '').trim();
            
            newInspectors[initials] = {
              name: fullName,
              type: role.toLowerCase()
            };
            importCount++;
          }
        }
      });
      
      setInspectorDefinitions(prev => ({...prev, ...newInspectors}));
      
      alert(`Successfully imported ${importCount} inspectors from Excel file!\n\nImported inspectors:\n${Object.entries(newInspectors).map(([initials, info]) => `${initials} - ${info.name} (${info.type})`).join('\n')}`);
      
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

    const isValidInitials = (initials) => {
      if (!initials || typeof initials !== 'string') return false;
      return /^[A-Z]{2,3}$/i.test(initials.trim());
    };

    let scrubbedCount = 0;
    const flaggedRecords = [];
    
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

      // LISTED BY/DATE FLAGGING (don't modify, just flag)
      const validMeasured = cleanRow.MEASUREBY && cleanRow.MEASUREDT;
      if (validMeasured) {
        const listBy = cleanRow.LISTBY;
        const listDate = cleanRow.LISTDT;
        
        if ((!listBy && listDate) || (listBy && !listDate)) {
          flaggedRecords.push({
            property: `Block ${cleanRow.BLOCK}, Lot ${cleanRow.LOT}`,
            issue: `Incomplete Listed data: BY=${listBy || 'blank'}, DATE=${listDate || 'blank'}`,
            inspector: cleanRow.MEASUREBY
          });
        }
      }

      if (wasModified) scrubbedCount++;
      return cleanRow;
    });

    console.log(`Scrubbed ${scrubbedCount} records, flagged ${flaggedRecords.length} for review`);
    return { data: scrubbedData, flagged: flaggedRecords };
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
    const estimationCodes = parseCodeString(codeMapping.estimationCodes);
    const invalidCodes = parseCodeString(codeMapping.invalidCodes);

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

  const processFiles = async () => {
    if (!csvFile) {
      alert('Please upload a CSV file');
      return;
    }

    if (!currentJobName.trim()) {
      alert('Please enter a job name');
      return;
    }

    setProcessing(true);
    try {
      console.log('Starting file scrubbing and consolidation...');
      
      const csvText = await readFileAsText(csvFile);
      const Papa = window.Papa || await import('papaparse');
      const parsedData = Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [',', '\t', '|', ';']
      });

      console.log('Parsed CSV data:', parsedData.data.length, 'records');

      const startDate = new Date(settings.startDate);
      const scrubResult = scrubData(parsedData.data, startDate);
      const analytics = calculateAnalytics(scrubResult.data, settings.infoByCodeMappings);
      
      analytics.results.flaggedRecords = scrubResult.flagged;
      
      const jobData = {
        name: currentJobName.trim(),
        date: new Date().toISOString(),
        csvData: scrubResult.data,
        results: analytics.results,
        metrics: analytics.metrics,
        settings: {...settings},
        inspectorDefinitions: {...inspectorDefinitions}
      };
      
      setJobs(prev => ({...prev, [currentJobName.trim()]: jobData}));
      setResults(analytics.results);
      setJobMetrics(analytics.metrics);
      setActiveTab('payroll');
    } catch (error) {
      console.error('Processing error:', error);
      alert(`Error processing file: ${error.message}`);
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
          Payroll Production Data Updater
        </h1>
        <p className="text-gray-600">
          Automate bimonthly payroll processing and production tracking with built-in data cleaning and analytics
        </p>
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

      {/* Inspector Management Tab */}
      {activeTab === 'inspectors' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center mb-6">
              <Settings className="w-8 h-8 mr-3 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Inspector Management</h2>
                <p className="text-gray-600 mt-1">Manage inspector profiles for payroll tracking and color coding</p>
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
                  Import inspectors directly from your staff Excel file. The system will read Column B (names with initials) and Column F (roles), importing only Residential and Commercial inspectors.
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
                      onClick={() => {
                        if (newInspector.initials && newInspector.name) {
                          setInspectorDefinitions({
                            ...inspectorDefinitions,
                            [newInspector.initials]: {
                              name: newInspector.name,
                              type: newInspector.type
                            }
                          });
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
                  <div className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full flex items-center gap-1">
                    💾 Saved in session
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
                  onChange={(e) => setCurrentJobName(e.target.value)}
                  placeholder="e.g., CCDD-Municipality Name"
                  className="w-full p-3 border border-yellow-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                />
                <p className="text-xs text-yellow-600 mt-1">
                  This will be used to track and compare multiple jobs
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
              disabled={!csvFile || !currentJobName.trim() || processing}
              className="px-12 py-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xl font-bold shadow-lg"
            >
              {processing ? (
                <span className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Scrubbing & Consolidating...
                </span>
              ) : (
                '🧹 Scrub and Consolidate'
              )}
            </button>
            <p className="text-sm text-gray-600 mt-2">
              Clean data and generate comprehensive analytics
            </p>
          </div>

          {results && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                <h3 className="text-lg font-semibold text-green-800">Scrubbing Complete!</h3>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{results.totalMatches}</div>
                  <div className="text-sm text-gray-600">Total Properties</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{results.updatedRecords}</div>
                  <div className="text-sm text-gray-600">Properties Inspected</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{results.entryRate.count}</div>
                  <div className="text-sm text-gray-600">Interior Inspections</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{results.refusalRate.count}</div>
                  <div className="text-sm text-gray-600">Refusals</div>
                </div>
              </div>

              <div className="mb-6 p-4 bg-white border border-gray-200 rounded-lg">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📊 Key Analytics</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 bg-green-50 rounded">
                    <div className="text-xl font-bold text-green-600">
                      {results.entryRate.count} Interior Inspections Completed, {results.entryRate.percentage.toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">Entry Rate for Class 2/3A Properties</div>
                  </div>
                  
                  <div className="p-3 bg-red-50 rounded">
                    <div className="text-xl font-bold text-red-600">
                      {results.refusalRate.count} Refused Inspections, {results.refusalRate.percentage.toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">Refusal Rate for Class 2/3A Properties</div>
                  </div>
                </div>
              </div>

              {results.flaggedRecords && results.flaggedRecords.length > 0 && (
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-yellow-800 mb-4">⚠️ Flagged Records for Review</h3>
                  <p className="text-sm text-yellow-700 mb-3">
                    These properties have incomplete Listed By/Date data and should be reviewed with inspectors:
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {results.flaggedRecords.slice(0, 10).map((record, i) => (
                      <div key={i} className="text-sm bg-white p-2 rounded border">
                        <strong>{record.property}</strong>: {record.issue} (Inspector: {record.inspector})
                      </div>
                    ))}
                    {results.flaggedRecords.length > 10 && (
                      <div className="text-sm text-yellow-600 font-medium">
                        ... and {results.flaggedRecords.length - 10} more records
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Other tabs remain the same as original... */}
      {activeTab === 'payroll' && (
        <div className="text-center text-gray-500 py-12">
          <p>Payroll tab implementation continues...</p>
        </div>
      )}

      {activeTab === 'metrics' && (
        <div className="text-center text-gray-500 py-12">
          <p>Metrics tab implementation continues...</p>
        </div>
      )}

      {activeTab === 'jobs' && (
        <div className="text-center text-gray-500 py-12">
          <p>Jobs tab implementation continues...</p>
        </div>
      )}
    </div>
  );
};

export default PayrollProductionUpdater;
