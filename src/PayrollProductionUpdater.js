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
    startDate: '2025-04-01',
    cleanPreStartDates: true,
    cleanOrphanedInitials: true,
    validatePropertyClass: true,
    validateInitialsFormat: true,
    requireDateForInitials: true,
    flagDuplicateEntries: true,
    validateBlockLotFormat: true,
    lastUpdateDate: '2025-06-01', // For payroll calculation
    payPerProperty: 2.00,
    targetPropertyClasses: ['2', '3A'], // Classes eligible for bonus
    applyColorCoding: true,
    autoMarkInspected: true,
    useSlipstreamColors: true // Use Excel slipstream color scheme
  });
  
  const csvInputRef = useRef();
  const excelInputRef = useRef();
  const inspectorImportRef = useRef();

  // Custom hook to update inspector definitions and keep in memory
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
    
    // Import XLSX library (note: this should be available in the React environment)
    const XLSX = await import('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    
    // Read the Excel file
    const workbook = XLSX.read(excelArrayBuffer, {
      cellStyles: true,
      cellFormulas: true,
      cellDates: true,
      cellNF: true,
      sheetStubs: true
    });
    
    // Get the first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    // Convert to JSON with headers
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    const newInspectors = {};
    let importCount = 0;
    
    data.forEach(row => {
      const inspectorName = row['Inspector'];
      const role = row['Role'];
      
      // Only import Residential and Commercial inspectors
      if (inspectorName && role && (role === 'Residential' || role === 'Commercial')) {
        // Extract initials from name format "Last, First (XX)"
        const initialsMatch = inspectorName.match(/\(([A-Z]{2,3})\)/);
        if (initialsMatch) {
          const initials = initialsMatch[1];
          // Remove initials from name to get clean full name
          const fullName = inspectorName.replace(/\s*\([A-Z]{2,3}\)/, '').trim();
          
          newInspectors[initials] = {
            name: fullName,
            type: role.toLowerCase()
          };
          importCount++;
        }
      }
    });
    
    // Merge with existing inspectors (avoid duplicates)
    setInspectorDefinitions(prev => ({...prev, ...newInspectors}));
    
    alert(`Successfully imported ${importCount} inspectors from Excel file!\n\nImported inspectors:\n${Object.entries(newInspectors).map(([initials, info]) => `${initials} - ${info.name} (${info.type})`).join('\n')}`);
    
  } catch (error) {
    console.error('Import error:', error);
    alert(`Error importing inspectors: ${error.message}`);
  }
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
      console.log('Starting file processing...');
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Mock results
      const mockResults = {
        totalMatches: 1250,
        updatedRecords: 890,
        cleanedPreStart: 15,
        cleanedOrphaned: 8,
        validationErrors: 3,
        duplicatesFound: 2,
        invalidInitials: 1,
        missingDates: 4,
        markedInspected: 890,
        colorCodedRows: 890,
        errors: [],
        warnings: ['Invalid initials format "XX" for Block 123, Lot 45'],
        summary: [],
        payrollAnalytics: {
          inspectorStats: {
            'AM': {
              name: 'Arcadio Martinez',
              type: 'residential',
              totalProperties: 45,
              eligibleProperties: 38,
              payrollAmount: 76.00,
              inspectionTypes: { exterior: 30, interior: 8, commercial: 0 },
              recentWork: []
            },
            'MX': {
              name: 'Inspector MX',
              type: 'residential',
              totalProperties: 52,
              eligibleProperties: 41,
              payrollAmount: 82.00,
              inspectionTypes: { exterior: 35, interior: 17, commercial: 0 },
              recentWork: []
            }
          },
          totalPayroll: 158.00,
          eligibleProperties: 79,
          inspectionTypes: { exterior: 65, interior: 25, commercial: 0 }
        }
      };

      const mockMetrics = {
        overallCompletion: { total: 1250, inspected: 890, percentage: 71.2 },
        interiorInspections: { class2_3A: { total: 750, listed: 425, percentage: 56.7 } },
        pricingInspections: { class4ABC: { total: 150, priced: 89, percentage: 59.3 } },
        inspectorActivity: {
          'AM': {
            name: 'Arcadio Martinez',
            type: 'residential',
            dailyAverage: 12.5,
            recentWork: 45,
            lastWorkDate: new Date()
          },
          'MX': {
            name: 'Inspector MX',
            type: 'residential',
            dailyAverage: 15.2,
            recentWork: 52,
            lastWorkDate: new Date()
          }
        },
        projectedCompletion: {
          remainingProperties: 360,
          businessDaysToComplete: 15,
          estimatedFinishDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
        }
      };
      
      // Store job data
      const jobData = {
        name: currentJobName.trim(),
        date: new Date().toISOString(),
        csvData: [],
        excelData: excelFile ? true : false,
        results: mockResults,
        metrics: mockMetrics,
        settings: {...settings},
        inspectorDefinitions: {...inspectorDefinitions}
      };
      
      setJobs(prev => ({...prev, [currentJobName.trim()]: jobData}));
      setResults(mockResults);
      setJobMetrics(mockMetrics);
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
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
          <h3 className="text-sm font-semibold text-blue-800 mb-1">📅 Typical Usage Schedule:</h3>
          <div className="text-sm text-blue-700">
            • <strong>Bimonthly Reports:</strong> Run 2 business days before pay period ends<br/>
            • <strong>Month-End Reports:</strong> Run at the end of each month for final reconciliation<br/>
            • <strong>Ad-Hoc Reports:</strong> Can be run anytime for progress tracking
          </div>
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
            
            {/* Add New Inspector */}
            <div className="mb-6 p-6 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 flex items-center">
                ➕ Add New Inspector
              </h3>
              
              {/* Import from Excel Option */}
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
              
              {/* Manual Add Form */}
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
            
            {/* Current Inspectors */}
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

            {/* Color Coding Information */}
            <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
              <h4 className="font-semibold text-gray-800 mb-3 flex items-center">
                🎨 Color Coding System
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center p-3 rounded-lg border border-blue-200 bg-blue-50">
                  <div className="w-6 h-6 bg-blue-200 border border-blue-300 rounded mr-3"></div>
                  <div>
                    <div className="font-medium text-blue-800">🏭 Commercial Inspectors</div>
                    <div className="text-blue-600">Excel "Slipstream" blue scheme for inspected rows</div>
                  </div>
                </div>
                <div className="flex items-center p-3 rounded-lg border border-green-200 bg-green-50">
                  <div className="w-6 h-6 bg-green-200 border border-green-300 rounded mr-3"></div>
                  <div>
                    <div className="font-medium text-green-800">🏠 Residential Inspectors</div>
                    <div className="text-green-600">Excel "Slipstream" green scheme for inspected rows</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div>
          {/* Job Name Input */}
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

          {/* Settings Panel */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center mb-3">
              <Settings className="w-5 h-5 mr-2" />
              <h3 className="text-lg font-semibold">Data Cleaning Settings</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.cleanPreStartDates}
                    onChange={(e) => setSettings({...settings, cleanPreStartDates: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Clean dates before start date</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.cleanOrphanedInitials}
                    onChange={(e) => setSettings({...settings, cleanOrphanedInitials: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Clean orphaned initials (no date)</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validateInitialsFormat}
                    onChange={(e) => setSettings({...settings, validateInitialsFormat: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate initials format (2-3 letters)</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.requireDateForInitials}
                    onChange={(e) => setSettings({...settings, requireDateForInitials: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Require date when initials present</span>
                </label>
              </div>
              
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validatePropertyClass}
                    onChange={(e) => setSettings({...settings, validatePropertyClass: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate property class codes</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.flagDuplicateEntries}
                    onChange={(e) => setSettings({...settings, flagDuplicateEntries: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Flag duplicate Block/Lot entries</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.validateBlockLotFormat}
                    onChange={(e) => setSettings({...settings, validateBlockLotFormat: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Validate Block/Lot format</span>
                </label>
                
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.applyColorCoding}
                    onChange={(e) => setSettings({...settings, applyColorCoding: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm">Apply color coding to export</span>
                </label>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="mb-6 space-y-6">
            {/* CSV Upload - Required */}
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

            {/* Excel Upload - Optional */}
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center bg-gray-50">
              <div className="w-12 h-12 mx-auto mb-4 text-gray-400">📊</div>
              <h3 className="text-lg font-semibold mb-2 text-gray-700">Upload Excel File (Optional)</h3>
              <p className="text-sm text-gray-500 mb-4">
                Upload Excel file to enable data matching and Excel export with color coding
              </p>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => handleFileUpload(e.target.files[0], 'excel')}
                className="hidden"
              />
              <button
                onClick={() => excelInputRef.current.click()}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-medium"
              >
                Choose Excel File
              </button>
              {excelFile && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-blue-700 font-medium">
                    ✓ Excel File: {excelFile.name}
                  </p>
                  <p className="text-sm text-blue-600 mt-1">
                    Excel matching and export enabled
                  </p>
                </div>
              )}
              {!excelFile && (
                <div className="mt-3 text-xs text-gray-500">
                  Without Excel: CSV-only processing for payroll analytics
                </div>
              )}
            </div>
          </div>

          {/* Process Button */}
          <div className="text-center mb-6">
            <button
              onClick={processFiles}
              disabled={!csvFile || !currentJobName.trim() || processing}
              className="px-12 py-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xl font-bold shadow-lg"
            >
              {processing ? (
                <span className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Processing & Analyzing...
                </span>
              ) : (
                excelFile ? '🔄 Process & Update Excel' : '📊 Analyze CSV Data'
              )}
            </button>
            <p className="text-sm text-gray-600 mt-2">
              {excelFile ? 'Update Excel file with CSV data and apply color coding' : 'Generate payroll analytics and job metrics from CSV'}
            </p>
          </div>

          {/* Results Section */}
          {results && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <div className="flex items-center mb-4">
                <CheckCircle className="w-6 h-6 text-green-600 mr-2" />
                <h3 className="text-lg font-semibold text-green-800">Processing Complete!</h3>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{results.totalMatches}</div>
                  <div className="text-sm text-gray-600">Total Matches</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{results.updatedRecords}</div>
                  <div className="text-sm text-gray-600">Records Updated</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{results.markedInspected}</div>
                  <div className="text-sm text-gray-600">Marked Inspected</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-600">{results.colorCodedRows}</div>
                  <div className="text-sm text-gray-600">Color Coded Rows</div>
                </div>
              </div>
              
              {/* Payroll Analytics */}
              {results.payrollAnalytics && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-blue-800 mb-4">📊 Payroll Analytics</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-green-600">${results.payrollAnalytics.totalPayroll.toFixed(2)}</div>
                      <div className="text-sm text-gray-600">Total Payroll</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-blue-600">{results.payrollAnalytics.eligibleProperties}</div>
                      <div className="text-sm text-gray-600">Eligible Properties</div>
                    </div>
                    <div className="text-center p-3 bg-white rounded">
                      <div className="text-2xl font-bold text-purple-600">{Object.keys(results.payrollAnalytics.inspectorStats).length}</div>
                      <div className="text-sm text-gray-600">Active Inspectors</div>
                    </div>
                  </div>

                  {/* Inspector Breakdown */}
                  <div className="space-y-3">
                    <h4 className="font-semibold text-blue-700">Inspector Performance This Period:</h4>
                    {Object.entries(results.payrollAnalytics.inspectorStats).map(([initials, stats]) => (
                      <div key={initials} className={`p-4 rounded-lg border-l-4 ${
                        stats.type === 'commercial' 
                          ? 'bg-blue-50 border-blue-500' 
                          : 'bg-green-50 border-green-500'
                      }`}>
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`font-bold text-lg ${
                                stats.type === 'commercial' ? 'text-blue-800' : 'text-green-800'
                              }`}>
                                {initials} - {stats.name}
                              </span>
                              <span className={`px-2 py-1 text-xs rounded font-medium ${
                                stats.type === 'commercial' 
                                  ? 'bg-blue-200 text-blue-800' 
                                  : 'bg-green-200 text-green-800'
                              }`}>
                                {stats.type}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <div className="text-gray-600">Inspection Breakdown:</div>
                                <div>Exterior: {stats.inspectionTypes.exterior}</div>
                                <div>Interior: {stats.inspectionTypes.interior}</div>
                                <div>Commercial: {stats.inspectionTypes.commercial}</div>
                              </div>
                              
                              <div>
                                <div className="text-gray-600">Property Details:</div>
                                <div>Total Properties: {stats.totalProperties}</div>
                                <div>Eligible (Class 2/3A): {stats.eligibleProperties}</div>
                                <div>Pay Rate: ${settings.payPerProperty.toFixed(2)}/property</div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="text-right ml-4">
                            <div className={`text-2xl font-bold ${
                              stats.type === 'commercial' ? 'text-blue-600' : 'text-green-600'
                            }`}>
                              ${stats.payrollAmount.toFixed(2)}
                            </div>
                            <div className="text-sm text-gray-600">Field Pay This Period</div>
                            {stats.payrollAmount > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                ({stats.eligibleProperties} × ${settings.payPerProperty.toFixed(2)})
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.downloadUrl && (
                <div className="text-center">
                  <a
                    href={results.downloadUrl}
                    download={results.fileName}
                    className="inline-flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Updated Excel File
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payroll Processing Tab */}
      {activeTab === 'payroll' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200 p-6">
            <div className="flex items-center mb-6">
              <div className="text-4xl mr-4">💰</div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Payroll Processing</h2>
                <p className="text-gray-600 mt-1">Calculate field pay bonuses for Class 2 & 3A properties</p>
              </div>
            </div>
            
            {/* Payroll Status */}
            {results && results.payrollAnalytics ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-700">📊 Payroll Summary</h3>
                  <div className="text-sm text-gray-600 bg-blue-100 px-3 py-1 rounded-full">
                    Stats as of {new Date().toLocaleString()}
                  </div>
                </div>
                
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-4 bg-white rounded-lg shadow border-l-4 border-green-500">
                    <div className="text-3xl font-bold text-green-600">${results.payrollAnalytics.totalPayroll.toFixed(2)}</div>
                    <div className="text-sm text-gray-600">Total Field Pay</div>
                  </div>
                  <div className="text-center p-4 bg-white rounded-lg shadow border-l-4 border-blue-500">
                    <div className="text-3xl font-bold text-blue-600">{results.payrollAnalytics.eligibleProperties}</div>
                    <div className="text-sm text-gray-600">Eligible Properties</div>
                  </div>
                  <div className="text-center p-4 bg-white rounded-lg shadow border-l-4 border-purple-500">
                    <div className="text-3xl font-bold text-purple-600">{Object.keys(results.payrollAnalytics.inspectorStats).length}</div>
                    <div className="text-sm text-gray-600">Active Inspectors</div>
                  </div>
                  <div className="text-center p-4 bg-white rounded-lg shadow border-l-4 border-orange-500">
                    <div className="text-3xl font-bold text-orange-600">${settings.payPerProperty.toFixed(2)}</div>
                    <div className="text-sm text-gray-600">Rate Per Property</div>
                  </div>
                </div>

                {/* Inspector Payroll Breakdown */}
                <div className="bg-white p-6 rounded-lg shadow-sm border">
                  <h4 className="font-semibold text-gray-800 mb-4">👥 Inspector Payroll Breakdown</h4>
                  <div className="space-y-3">
                    {Object.entries(results.payrollAnalytics.inspectorStats).map(([initials, stats]) => (
                      <div key={initials} className={`p-4 rounded-lg border-l-4 ${
                        stats.type === 'commercial' 
                          ? 'bg-blue-50 border-blue-500' 
                          : 'bg-green-50 border-green-500'
                      }`}>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <span className={`font-bold text-lg ${
                              stats.type === 'commercial' ? 'text-blue-800' : 'text-green-800'
                            }`}>
                              {initials}
                            </span>
                            <span className="text-gray-700">{stats.name}</span>
                            <span className={`px-2 py-1 text-xs rounded font-medium ${
                              stats.type === 'commercial' ? 'bg-blue-200 text-blue-800' : 'bg-green-200 text-green-800'
                            }`}>
                              {stats.type === 'commercial' ? '🏭 commercial' : '🏠 residential'}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className={`text-2xl font-bold ${
                              stats.type === 'commercial' ? 'text-blue-600' : 'text-green-600'
                            }`}>
                              ${stats.payrollAmount.toFixed(2)}
                            </div>
                            <div className="text-sm text-gray-600">
                              {stats.eligibleProperties} eligible properties
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12 bg-white rounded-lg border-2 border-dashed border-gray-300">
                <div className="text-6xl mb-4">💼</div>
                <h3 className="text-xl font-semibold mb-2">No Payroll Data Yet</h3>
                <p className="text-gray-600 mb-4">Upload and process a CSV file to calculate payroll bonuses</p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium"
                >
                  Go to Upload & Process
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && jobMetrics && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 rounded-lg border-2 border-blue-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">📊 Job Performance Analytics</h2>
            
            {/* Overall Completion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏠 Overall Completion</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Properties:</span>
                    <span className="font-bold">{jobMetrics.overallCompletion.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Inspected:</span>
                    <span className="font-bold text-green-600">{jobMetrics.overallCompletion.inspected.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Remaining:</span>
                    <span className="font-bold text-orange-600">{jobMetrics.projectedCompletion.remainingProperties.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Progress</span>
                      <span className="text-sm font-medium">{jobMetrics.overallCompletion.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-blue-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.overallCompletion.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-green-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏡 Interior Inspections</h3>
                <p className="text-sm text-gray-600 mb-3">Class 2 & 3A Properties</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Eligible Properties:</span>
                    <span className="font-bold">{jobMetrics.interiorInspections.class2_3A.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Listed:</span>
                    <span className="font-bold text-green-600">{jobMetrics.interiorInspections.class2_3A.listed.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Entry Rate</span>
                      <span className="text-sm font-medium">{jobMetrics.interiorInspections.class2_3A.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-green-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.interiorInspections.class2_3A.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-purple-500">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">🏢 Pricing Inspections</h3>
                <p className="text-sm text-gray-600 mb-3">Class 4A, 4B & 4C Properties</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Eligible Properties:</span>
                    <span className="font-bold">{jobMetrics.pricingInspections.class4ABC.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Priced:</span>
                    <span className="font-bold text-purple-600">{jobMetrics.pricingInspections.class4ABC.priced.toLocaleString()}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Pricing Rate</span>
                      <span className="text-sm font-medium">{jobMetrics.pricingInspections.class4ABC.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-purple-500 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, jobMetrics.pricingInspections.class4ABC.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Projected Completion */}
            {jobMetrics.projectedCompletion.estimatedFinishDate && (
              <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-indigo-500 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">📅 Projected Completion</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      {jobMetrics.projectedCompletion.businessDaysToComplete}
                    </div>
                    <div className="text-sm text-gray-600">Business Days Remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {jobMetrics.projectedCompletion.estimatedFinishDate.toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-600">Estimated Finish Date</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {Object.keys(jobMetrics.inspectorActivity).length}
                    </div>
                    <div className="text-sm text-gray-600">Active Inspectors</div>
                  </div>
                </div>
              </div>
            )}

            {/* Inspector Performance */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">👥 Inspector Performance</h3>
              <div className="space-y-4">
                {Object.entries(jobMetrics.inspectorActivity).map(([initials, inspector]) => (
                  <div key={initials} className={`p-4 rounded-lg border-l-4 ${
                    inspector.type === 'commercial' 
                      ? 'bg-blue-50 border-blue-500' 
                      : 'bg-green-50 border-green-500'
                  }`}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`font-bold text-lg ${
                            inspector.type === 'commercial' ? 'text-blue-800' : 'text-green-800'
                          }`}>
                            {initials} - {inspector.name}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded font-medium ${
                            inspector.type === 'commercial' 
                              ? 'bg-blue-200 text-blue-800' 
                              : 'bg-green-200 text-green-800'
                          }`}>
                            {inspector.type === 'commercial' ? '🏭 commercial' : '🏠 residential'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <div className="text-gray-600">Recent Work:</div>
                            <div className="font-semibold">{inspector.recentWork} properties</div>
                          </div>
                          
                          <div>
                            <div className="text-gray-600">Daily Average:</div>
                            <div className="font-semibold">{inspector.dailyAverage.toFixed(1)} properties/day</div>
                          </div>
                          
                          <div>
                            <div className="text-gray-600">Last Work Date:</div>
                            <div className="font-semibold">
                              {inspector.lastWorkDate ? inspector.lastWorkDate.toLocaleDateString() : 'N/A'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                
                {Object.keys(jobMetrics.inspectorActivity).length === 0 && (
                  <div className="text-center text-gray-500 py-4">
                    No inspector activity found for this job
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {activeTab === 'jobs' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-lg border-2 border-purple-200">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">📋 All Jobs Overview</h2>
            
            {Object.keys(jobs).length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <p className="text-lg">No jobs processed yet.</p>
                <p>Upload and process your first job to see it here!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(jobs).map(([jobName, jobData]) => {
                  return (
                    <div key={jobName} className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-800">{jobName}</h3>
                          <p className="text-sm text-gray-600">
                            Processed: {new Date(jobData.date).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setJobMetrics(jobData.metrics);
                              setActiveTab('metrics');
                            }}
                            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                          >
                            View Metrics
                          </button>
                          <button
                            onClick={() => {
                              setCurrentJobName(jobName);
                              setActiveTab('upload');
                            }}
                            className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                          >
                            Reload Job
                          </button>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-blue-50 rounded">
                          <div className="text-xl font-bold text-blue-600">
                            {jobData.metrics.overallCompletion.percentage.toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-600">Overall Complete</div>
                        </div>
                        
                        <div className="text-center p-3 bg-green-50 rounded">
                          <div className="text-xl font-bold text-green-600">
                            {jobData.metrics.interiorInspections.class2_3A.percentage.toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-600">Interior Entry Rate</div>
                        </div>
                        
                        <div className="text-center p-3 bg-purple-50 rounded">
                          <div className="text-xl font-bold text-purple-600">
                            {jobData.metrics.pricingInspections.class4ABC.percentage.toFixed(1)}%
                          </div>
                          <div className="text-xs text-gray-600">Pricing Rate</div>
                        </div>
                        
                        <div className="text-center p-3 bg-orange-50 rounded">
                          <div className="text-xl font-bold text-orange-600">
                            {jobData.metrics.projectedCompletion.businessDaysToComplete || 'N/A'}
                          </div>
                          <div className="text-xs text-gray-600">Days to Complete</div>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-3 border-t border-gray-200">
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Total Properties: {jobData.metrics.overallCompletion.total.toLocaleString()}</span>
                          <span>Active Inspectors: {Object.keys(jobData.metrics.inspectorActivity).length}</span>
                          {jobData.metrics.projectedCompletion.estimatedFinishDate && (
                            <span>Est. Finish: {jobData.metrics.projectedCompletion.estimatedFinishDate.toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 className="text-lg font-semibold mb-2 text-blue-800">📋 How it works:</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700">
          <li>Enter a unique job name to track this project</li>
          <li>Upload your CSV file (e.g., "2026.1526.REVAL PRODUCTION.csv")</li>
          <li>Optionally upload your Excel file (e.g., "1525Production.xlsx") for data matching</li>
          <li>Configure validation and cleaning settings</li>
          <li>Set "Last Payroll Update" date for bimonthly/monthly reporting</li>
          <li>Click "Analyze CSV Data" or "Process & Update Excel" to process</li>
          <li>The tool will process data and generate comprehensive analytics</li>
          <li>Enhanced data validation and cleaning rules will be applied:
            <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
              <li>Remove dates before project start date</li>
              <li>Validate initials format (2-3 uppercase letters)</li>
              <li>Ensure dates exist when initials are present</li>
              <li>Flag duplicate Block/Lot combinations</li>
              <li>Validate Block/Lot number formats</li>
            </ul>
          </li>
          <li>Apply Excel "Slipstream" color coding for inspected properties (if Excel uploaded)</li>
          <li>Review comprehensive job metrics and completion analytics</li>
          <li>View projected completion dates based on inspector productivity</li>
          <li>Download the updated Excel file with all formatting applied (if Excel uploaded)</li>
        </ol>
        
        <div className="mt-4 p-3 bg-white rounded border border-blue-200">
          <h4 className="font-semibold text-blue-800 mb-2">🎨 Color Coding System:</h4>
          <div className="text-sm text-blue-700 space-y-1">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-blue-200 border border-blue-300 rounded mr-2"></div>
              <span><strong>🏭 Commercial Inspectors:</strong> Excel "Slipstream" blue scheme</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-200 border border-green-300 rounded mr-2"></div>
              <span><strong>🏠 Residential Inspectors:</strong> Excel "Slipstream" green scheme</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-white border border-gray-300 rounded mr-2"></div>
              <span><strong>Uninspected Properties:</strong> No highlighting</span>
            </div>
          </div>
        </div>
        
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <h4 className="font-semibold text-yellow-800 mb-2">💰 Payroll Calculation:</h4>
          <div className="text-sm text-yellow-700">
            <strong>$2.00 per property bonus</strong> for Class 2 & 3A properties only, calculated from work completed since the "Last Payroll Update" date. Perfect for bimonthly and monthly payroll processing.
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayrollProductionUpdater;
