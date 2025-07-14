import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, BarChart3, AlertTriangle } from 'lucide-react';

const AdminJobManagement = () => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [currentUser] = useState({ role: 'admin', canAccessBilling: true }); // Mock current user
  
  const [jobs, setJobs] = useState([
    {
      id: 1,
      name: 'Township of Middletown 2025',
      ccddCode: '1306',
      municipality: 'Middletown Township',
      county: 'Monmouth',
      state: 'NJ',
      vendor: 'Microsystems',
      status: 'Active',
      assignedManagers: [
        { id: 1, name: 'John Smith', role: 'Lead Manager' },
        { id: 2, name: 'Sarah Johnson', role: 'Assistant Manager' },
        { id: 4, name: 'Lisa Davis', role: 'Field Supervisor' }
      ],
      createdDate: '2025-01-15',
      dueDate: '2025-03-30',
      totalProperties: 15420,
      inspectedProperties: 8934,
      sourceFileStatus: 'Imported',
      codeFileStatus: 'Current',
      vendorDetection: {
        confidence: 100,
        detectedFormat: 'Microsystems Text Delimited',
        fileStructure: 'Block|Lot|Qual headers with pipe separators'
      },
      workflowStats: {
        inspectionPhases: {
          firstAttempt: 'COMPLETE',
          secondAttempt: 'COMPLETE', 
          thirdAttempt: 'IN PROGRESS'
        },
        rates: {
          entryRate: 0.587,
          refusalRate: 0.043,
          pricingRate: 0.234,
          commercialInspectionRate: 0.892
        },
        appeals: {
          totalCount: 89,
          percentOfWhole: 0.6,
          byClass: {
            class2: { count: 45, percent: 1.2 },
            class3A: { count: 32, percent: 0.8 },
            class4: { count: 12, percent: 0.3 }
          }
        }
      }
    },
    {
      id: 2,
      name: 'City of Asbury Park 2025',
      ccddCode: '1302',
      municipality: 'Asbury Park',
      county: 'Monmouth', 
      state: 'NJ',
      vendor: 'BRT',
      status: 'Active',
      assignedManagers: [
        { id: 3, name: 'Mike Wilson', role: 'Lead Manager' }
      ],
      createdDate: '2025-01-20',
      dueDate: '2025-04-15',
      totalProperties: 3240,
      inspectedProperties: 1847,
      sourceFileStatus: 'Imported',
      codeFileStatus: 'Current',
      vendorDetection: {
        confidence: 95,
        detectedFormat: 'BRT CSV Export',
        fileStructure: '370 columns with VALUES_LANDTAXABLEVALUE header'
      },
      workflowStats: {
        inspectionPhases: {
          firstAttempt: 'COMPLETE',
          secondAttempt: 'IN PROGRESS', 
          thirdAttempt: 'PENDING'
        },
        rates: {
          entryRate: 0.612,
          refusalRate: 0.058,
          pricingRate: 0.167,
          commercialInspectionRate: 0.445
        },
        appeals: {
          totalCount: 0,
          percentOfWhole: 0,
          byClass: {}
        }
      }
    },
    {
      id: 3,
      name: 'Borough of Red Bank 2025',
      ccddCode: '1335',
      municipality: 'Red Bank',
      county: 'Monmouth',
      state: 'NJ',
      vendor: 'BRT',
      status: 'Complete',
      assignedManagers: [
        { id: 2, name: 'Sarah Johnson', role: 'Lead Manager' },
        { id: 4, name: 'Lisa Davis', role: 'Assistant Manager' }
      ],
      createdDate: '2025-01-10',
      dueDate: '2025-04-01',
      totalProperties: 7832,
      inspectedProperties: 7832,
      sourceFileStatus: 'Imported',
      codeFileStatus: 'Current',
      vendorDetection: {
        confidence: 95,
        detectedFormat: 'BRT CSV Export',
        fileStructure: '370 columns with VALUES_LANDTAXABLEVALUE header'
      },
      workflowStats: {
        inspectionPhases: {
          firstAttempt: 'COMPLETE',
          secondAttempt: 'COMPLETE', 
          thirdAttempt: 'COMPLETE'
        },
        rates: {
          entryRate: 0.642,
          refusalRate: 0.038,
          pricingRate: 0.987,
          commercialInspectionRate: 1.0
        },
        appeals: {
          totalCount: 47,
          percentOfWhole: 0.6,
          byClass: {
            class2: { count: 28, percent: 0.8 },
            class3A: { count: 15, percent: 0.4 },
            class4: { count: 4, percent: 0.1 }
          }
        }
      }
    }
  ]);

  const [planningJobs, setPlanningJobs] = useState([
    { id: 'p1', ccddCode: '1340', municipality: 'Ocean Township', potentialYear: '2026' },
    { id: 'p2', ccddCode: '1315', municipality: 'Long Branch', potentialYear: '2026' },
    { id: 'p3', ccddCode: '1308', municipality: 'Freehold Borough', potentialYear: '2027' }
  ]);

  const [showCreateJob, setShowCreateJob] = useState(false);
  const [managers, setManagers] = useState([
    { id: 1, name: 'John Smith', email: 'john.smith@ppa.com', region: 'North', activeJobs: 1, canBeLead: true },
    { id: 2, name: 'Sarah Johnson', email: 'sarah.johnson@ppa.com', region: 'Central', activeJobs: 2, canBeLead: true },
    { id: 3, name: 'Mike Wilson', email: 'mike.wilson@ppa.com', region: 'South', activeJobs: 1, canBeLead: true },
    { id: 4, name: 'Lisa Davis', email: 'lisa.davis@ppa.com', region: 'North', activeJobs: 2, canBeLead: false },
    { id: 5, name: 'Robert Chen', email: 'robert.chen@ppa.com', region: 'Central', activeJobs: 0, canBeLead: true },
    { id: 6, name: 'Maria Rodriguez', email: 'maria.rodriguez@ppa.com', region: 'South', activeJobs: 1, canBeLead: false }
  ]);

  const [newJob, setNewJob] = useState({
    name: '',
    ccddCode: '',
    municipality: '',
    county: '',
    state: 'NJ',
    dueDate: '',
    assignedManagers: [],
    sourceFile: null,
    codeFile: null,
    vendor: null,
    vendorDetection: null
  });

  const [fileAnalysis, setFileAnalysis] = useState({
    sourceFile: null,
    codeFile: null,
    detectedVendor: null,
    isValid: false,
    propertyCount: 0,
    codeCount: 0
  });

  const [dbConnected, setDbConnected] = useState(true);
  const [dbStats, setDbStats] = useState({ employees: 48, jobs: 12, propertyRecords: 47832, sourceFiles: 23 });

  // Enhanced vendor detection using existing processors
  const analyzeFileWithProcessor = async (file, type) => {
    if (!file) return;

    const text = await file.text();
    let vendorResult = null;

    if (type === 'source') {
      // Microsystems detection
      if (file.name.endsWith('.txt')) {
        const lines = text.split('\n');
        const headers = lines[0];
        
        if (headers.includes('Block|Lot|Qual') || headers.includes('|')) {
          const dataLines = lines.slice(1).filter(line => line.trim());
          const sampleLine = dataLines[0] || '';
          const pipeCount = (sampleLine.match(/\|/g) || []).length;
          
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 100,
            detectedFormat: 'Microsystems Text Delimited',
            fileStructure: `${pipeCount + 1} fields with pipe separators`,
            propertyCount: dataLines.length,
            details: {
              hasBlockLotQual: headers.includes('Block|Lot|Qual'),
              delimiter: '|',
              estimatedFields: pipeCount + 1
            }
          };
        }
      }
      // BRT detection
      else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
        const lines = text.split('\n');
        const headers = lines[0];
        
        if (headers.includes('VALUES_LANDTAXABLEVALUE') || 
            headers.includes('PROPCLASS') || 
            headers.includes('LISTBY')) {
          const dataLines = lines.slice(1).filter(line => line.trim());
          const fieldCount = (headers.match(/,/g) || []).length + 1;
          
          vendorResult = {
            vendor: 'BRT',
            confidence: headers.includes('VALUES_LANDTAXABLEVALUE') ? 100 : 85,
            detectedFormat: 'BRT CSV Export',
            fileStructure: `${fieldCount} columns with standard BRT headers`,
            propertyCount: dataLines.length,
            details: {
              hasLandTaxableValue: headers.includes('VALUES_LANDTAXABLEVALUE'),
              hasPropClass: headers.includes('PROPCLASS'),
              hasListBy: headers.includes('LISTBY'),
              estimatedFields: fieldCount
            }
          };
        }
      }
    } else if (type === 'code') {
      // Enhanced code file detection
      if (file.name.endsWith('.txt')) {
        const lines = text.split('\n').filter(line => line.trim());
        const microsystemsPattern = /^\d{2,3}[A-Z]{1,3}$/;
        const sampleCodes = lines.slice(0, 10);
        const microsystemsMatches = sampleCodes.filter(line => 
          microsystemsPattern.test(line.split('=')[0]?.trim())
        ).length;
        
        if (microsystemsMatches > 5 || text.includes('120PV')) {
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 95,
            detectedFormat: 'Microsystems Code Definitions',
            fileStructure: `${lines.length} code definitions with field_id + code structure`,
            codeCount: lines.length,
            details: {
              hasFieldCodePattern: true,
              sampleCode: '120PV = Field 120 (ROAD) + Code "PV" = "PAVED"'
            }
          };
        }
      }
      else if (file.name.endsWith('.json') || text.includes('"02":"COLONIAL"')) {
        try {
          const parsed = JSON.parse(text);
          const codeCount = Object.keys(parsed).length;
          
          vendorResult = {
            vendor: 'BRT',
            confidence: 100,
            detectedFormat: 'BRT JSON Code Hierarchy',
            fileStructure: `JSON structure with ${codeCount} top-level code categories`,
            codeCount: codeCount,
            details: {
              isValidJson: true,
              hasColonialCode: text.includes('"02":"COLONIAL"'),
              structure: 'Nested hierarchy format'
            }
          };
        } catch (e) {
          if (text.includes('"02":"COLONIAL"') || text.includes('COLONIAL')) {
            vendorResult = {
              vendor: 'BRT',
              confidence: 80,
              detectedFormat: 'BRT Text Code Export',
              fileStructure: 'Text format with code descriptions',
              codeCount: (text.match(/"/g) || []).length / 2,
              details: {
                isValidJson: false,
                hasColonialCode: true,
                structure: 'Text export format'
              }
            };
          }
        }
      }
    }

    setFileAnalysis(prev => ({
      ...prev,
      [type + 'File']: file,
      detectedVendor: vendorResult?.vendor || null,
      isValid: vendorResult !== null,
      [type === 'source' ? 'propertyCount' : 'codeCount']: 
        vendorResult?.[type === 'source' ? 'propertyCount' : 'codeCount'] || 0,
      vendorDetails: vendorResult
    }));

    if (vendorResult) {
      setNewJob(prev => ({ 
        ...prev, 
        vendor: vendorResult.vendor,
        vendorDetection: vendorResult
      }));
    }
  };

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (file) {
      setNewJob(prev => ({ ...prev, [type]: file }));
      analyzeFileWithProcessor(file, type);
    }
  };

  const handleManagerToggle = (managerId, role = 'Assistant Manager') => {
    const manager = managers.find(m => m.id === managerId);
    const currentManagerIds = newJob.assignedManagers.map(m => m.id);
    
    if (currentManagerIds.includes(managerId)) {
      setNewJob(prev => ({
        ...prev,
        assignedManagers: prev.assignedManagers.filter(m => m.id !== managerId)
      }));
    } else {
      setNewJob(prev => ({
        ...prev,
        assignedManagers: [...prev.assignedManagers, { 
          id: manager.id, 
          name: manager.name, 
          role: role 
        }]
      }));
    }
  };

  const updateManagerRole = (managerId, newRole) => {
    setNewJob(prev => ({
      ...prev,
      assignedManagers: prev.assignedManagers.map(m => 
        m.id === managerId ? { ...m, role: newRole } : m
      )
    }));
  };

  const createJob = () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || newJob.assignedManagers.length === 0) {
      alert('Please fill all required fields and assign at least one manager');
      return;
    }

    const job = {
      id: jobs.length + 1,
      ...newJob,
      status: fileAnalysis.isValid ? 'Active' : 'Planning',
      createdDate: new Date().toISOString().split('T')[0],
      totalProperties: fileAnalysis.propertyCount,
      inspectedProperties: 0,
      sourceFileStatus: newJob.sourceFile ? 'Imported' : 'Pending',
      codeFileStatus: newJob.codeFile ? 'Current' : 'Pending',
      vendorDetection: newJob.vendorDetection,
      workflowStats: {
        inspectionPhases: {
          firstAttempt: 'PENDING',
          secondAttempt: 'PENDING', 
          thirdAttempt: 'PENDING'
        },
        rates: {
          entryRate: 0,
          refusalRate: 0,
          pricingRate: 0,
          commercialInspectionRate: 0
        },
        appeals: {
          totalCount: 0,
          percentOfWhole: 0,
          byClass: {}
        }
      }
    };

    setJobs([...jobs, job]);
    setShowCreateJob(false);
    setNewJob({
      name: '',
      ccddCode: '',
      municipality: '',
      county: '',
      state: 'NJ',
      dueDate: '',
      assignedManagers: [],
      sourceFile: null,
      codeFile: null,
      vendor: null,
      vendorDetection: null
    });
    setFileAnalysis({
      sourceFile: null,
      codeFile: null,
      detectedVendor: null,
      isValid: false,
      propertyCount: 0,
      codeCount: 0
    });
  };

  const convertPlanningToJob = (planningJob) => {
    setNewJob({
      name: `${planningJob.municipality} ${planningJob.potentialYear}`,
      ccddCode: planningJob.ccddCode,
      municipality: planningJob.municipality,
      county: '',
      state: 'NJ',
      dueDate: '',
      assignedManagers: [],
      sourceFile: null,
      codeFile: null,
      vendor: null,
      vendorDetection: null
    });
    setShowCreateJob(true);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Active': return 'text-green-600 bg-green-100';
      case 'Planning': return 'text-yellow-600 bg-yellow-100';
      case 'Complete': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getPhaseColor = (phase) => {
    switch (phase) {
      case 'COMPLETE': return 'bg-green-100 text-green-800';
      case 'IN PROGRESS': return 'bg-yellow-100 text-yellow-800';
      case 'PENDING': return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getFileStatusIcon = (status) => {
    switch (status) {
      case 'Imported': case 'Current': return '✅';
      case 'Pending': return '⏳';
      case 'Error': return '❌';
      default: return '⏳';
    }
  };

  const goToJob = (job) => {
    // This would navigate to the job modules
    alert(`Navigate to ${job.name} modules:\n- Production Tracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
  };

  const goToBillingPayroll = (job) => {
    // This would navigate to production module for billing
    alert(`Navigate to ${job.name} Billing & Payroll in Production Tracker`);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          PPA Management OS - Current Jobs List
        </h1>
        <p className="text-gray-600">
          Manage appraisal jobs with source file integration and team assignments
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
              onClick={() => setActiveTab('jobs')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'jobs' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              📋 Active Jobs ({jobs.length})
            </button>
            <button
              onClick={() => setActiveTab('planning')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'planning' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              📝 Planning ({planningJobs.length})
            </button>
            <button
              onClick={() => setActiveTab('managers')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'managers' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              👥 Manager Assignments
            </button>
          </nav>
        </div>
      </div>

      {/* Active Jobs Tab */}
      {activeTab === 'jobs' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Settings className="w-8 h-8 mr-3 text-blue-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📋 Active Job Management</h2>
                  <p className="text-gray-600 mt-1">
                    {dbConnected 
                      ? `Connected to database with ${dbStats.jobs} jobs tracked`
                      : 'Manage appraisal jobs with source data and team assignments'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateJob(true)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2 font-medium shadow-lg"
              >
                <Plus className="w-5 h-5" />
                <span>🚀 Create New Job</span>
              </button>
            </div>

            {/* Job Status Summary */}
            <div className="mb-6 p-4 bg-white rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold text-gray-700 mb-4 flex items-center">
                📊 Job Status Overview
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{jobs.filter(j => j.status === 'Active').length}</div>
                  <div className="text-sm text-gray-600">Active Jobs</div>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{jobs.filter(j => j.status === 'Planning').length}</div>
                  <div className="text-sm text-gray-600">In Planning</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{jobs.filter(j => j.status === 'Complete').length}</div>
                  <div className="text-sm text-gray-600">Complete</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{jobs.reduce((sum, job) => sum + job.totalProperties, 0).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Properties</div>
                </div>
              </div>
            </div>

            {/* Job Cards */}
            <div className="space-y-4">
              {jobs.map(job => (
                <div key={job.id} className={`p-6 bg-white rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all ${
                  job.vendor === 'Microsystems' ? 'border-blue-400 hover:bg-blue-50' : 'border-orange-400 hover:bg-orange-50'
                }`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xl font-bold text-gray-900">{job.name}</h3>
                        <div className="flex items-center space-x-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            job.vendor === 'Microsystems' 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {job.vendor}
                          </span>
                          {job.vendorDetection && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                              {job.vendorDetection.confidence}% confidence
                            </span>
                          )}
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                            {job.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                        <span className="flex items-center space-x-1">
                          <span className="font-bold text-blue-600">{job.ccddCode}</span>
                          <span>•</span>
                          <MapPin className="w-4 h-4" />
                          <span>{job.municipality}, {job.county} County, {job.state}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>Due: {job.dueDate}</span>
                        </span>
                      </div>
                      <div className="text-sm text-gray-500">
                        {job.vendorDetection ? job.vendorDetection.detectedFormat : `${job.vendor} Format`}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {/* Team Assignments */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3 flex items-center space-x-2">
                        <Users className="w-4 h-4" />
                        <span>Team</span>
                      </h4>
                      <div className="space-y-2">
                        {job.assignedManagers.map(manager => (
                          <div key={manager.id} className="flex items-center justify-between text-sm bg-white px-2 py-2 rounded border">
                            <div className="flex items-center space-x-2">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                manager.role === 'Lead Manager' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {manager.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <span className="font-medium text-gray-900">{manager.name}</span>
                            </div>
                            {manager.role === 'Lead Manager' && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-medium">Lead</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Data Files Status */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3 flex items-center space-x-2">
                        <FileText className="w-4 h-4" />
                        <span>Files</span>
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">Source:</span>
                          <span className="font-medium">{getFileStatusIcon(job.sourceFileStatus)} {job.sourceFileStatus}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600">Codes:</span>
                          <span className="font-medium">{getFileStatusIcon(job.codeFileStatus)} {job.codeFileStatus}</span>
                        </div>
                        {job.vendorDetection && (
                          <div className="text-xs text-gray-500 mt-2 p-2 bg-white rounded border">
                            <div className="font-medium text-gray-700">📄 Format:</div>
                            <div>{job.vendorDetection.fileStructure}</div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Job Progress & Appeals */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3">📊 Progress</h4>
                      
                      {/* Job Progression */}
                      <div className="text-center mb-4">
                        <div className="text-lg font-bold text-blue-600">
                          {job.inspectedProperties.toLocaleString()} of {job.totalProperties.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-600">Properties Inspected</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {Math.round((job.inspectedProperties / job.totalProperties) * 100)}% Complete
                        </div>
                      </div>

                      {/* Appeals Section */}
                      {job.workflowStats?.appeals && job.workflowStats.appeals.totalCount > 0 && (
                        <div className="border-t pt-3">
                          <div className="text-sm font-medium text-gray-700 mb-2">Appeals Filed:</div>
                          <div className="text-center">
                            <div className="text-lg font-bold text-orange-600">{job.workflowStats.appeals.totalCount}</div>
                            <div className="text-xs text-gray-600">{job.workflowStats.appeals.percentOfWhole}% of total</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Workflow Statistics */}
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <h4 className="font-medium text-gray-900 mb-3">🎯 Stats</h4>
                      
                      {/* Compact Inspection Phases */}
                      <div className="mb-3">
                        <div className="text-xs font-medium text-gray-700 mb-2">Phases:</div>
                        <div className="grid grid-cols-3 gap-1 text-xs">
                          <div className={`p-1 rounded text-center ${getPhaseColor(job.workflowStats?.inspectionPhases.firstAttempt)}`}>
                            <div className="font-medium">1st</div>
                          </div>
                          <div className={`p-1 rounded text-center ${getPhaseColor(job.workflowStats?.inspectionPhases.secondAttempt)}`}>
                            <div className="font-medium">2nd</div>
                          </div>
                          <div className={`p-1 rounded text-center ${getPhaseColor(job.workflowStats?.inspectionPhases.thirdAttempt)}`}>
                            <div className="font-medium">3rd</div>
                          </div>
                        </div>
                      </div>

                      {/* Key Rates */}
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Entry:</span>
                          <span className="font-medium text-green-600">
                            {job.workflowStats?.rates.entryRate ? 
                              `${(job.workflowStats.rates.entryRate * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Refusal:</span>
                          <span className="font-medium text-red-600">
                            {job.workflowStats?.rates.refusalRate ? 
                              `${(job.workflowStats.rates.refusalRate * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Pricing:</span>
                          <span className="font-medium text-blue-600">
                            {job.workflowStats?.rates.pricingRate ? 
                              `${(job.workflowStats.rates.pricingRate * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Comm Insp:</span>
                          <span className="font-medium text-purple-600">
                            {job.workflowStats?.rates.commercialInspectionRate ? 
                              `${(job.workflowStats.rates.commercialInspectionRate * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-100">
                    <button 
                      onClick={() => goToJob(job)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Go to Job</span>
                    </button>
                    {currentUser.canAccessBilling && (
                      <button 
                        onClick={() => goToBillingPayroll(job)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <DollarSign className="w-4 h-4" />
                        <span>Billing & Payroll</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Planning Jobs Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border-2 border-yellow-200 p-6">
            <div className="flex items-center mb-6">
              <Settings className="w-8 h-8 mr-3 text-yellow-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">📝 Planning Stage Jobs</h2>
                <p className="text-gray-600 mt-1">
                  Future jobs in planning - store basic info until ready to activate
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              {planningJobs.map(planningJob => (
                <div key={planningJob.id} className="p-4 bg-white rounded-lg border-l-4 border-yellow-400 shadow-sm hover:shadow-md transition-all">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <span className="font-bold text-blue-600 text-lg">{planningJob.ccddCode}</span>
                      <div>
                        <h4 className="font-semibold text-gray-900">{planningJob.municipality}</h4>
                        <p className="text-sm text-gray-600">Potential Year: {planningJob.potentialYear}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => convertPlanningToJob(planningJob)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Create Job</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Manager Assignments Tab */}
      {activeTab === 'managers' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200 p-6">
            <div className="flex items-center mb-6">
              <Users className="w-8 h-8 mr-3 text-green-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Manager Workload Overview</h2>
                <p className="text-gray-600 mt-1">
                  Monitor manager assignments and workload distribution across active jobs
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              {managers.map(manager => {
                const managerJobs = jobs.filter(job => job.assignedManagers.some(m => m.name === manager.name));
                const workloadLevel = manager.activeJobs === 0 ? 'available' : 
                                    manager.activeJobs <= 2 ? 'light' : 'heavy';
                
                return (
                  <div key={manager.id} className={`p-6 bg-white rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all ${
                    workloadLevel === 'available' ? 'border-green-400 hover:bg-green-50' :
                    workloadLevel === 'light' ? 'border-yellow-400 hover:bg-yellow-50' : 'border-red-400 hover:bg-red-50'
                  }`}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                          workloadLevel === 'available' ? 'bg-green-100 text-green-800' :
                          workloadLevel === 'light' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {manager.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                            <span>{manager.name}</span>
                            {manager.canBeLead && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-medium">
                                Lead Eligible
                              </span>
                            )}
                          </h4>
                          <p className="text-sm text-gray-600">{manager.email} • {manager.region} Region</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${
                          workloadLevel === 'available' ? 'text-green-600' :
                          workloadLevel === 'light' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {manager.activeJobs} Active Jobs
                        </div>
                        <div className={`text-sm font-medium capitalize ${
                          workloadLevel === 'available' ? 'text-green-600' :
                          workloadLevel === 'light' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {workloadLevel === 'available' ? '✅ Available' : 
                           workloadLevel === 'light' ? '⚡ Light Load' : '🔥 Heavy Load'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-gray-700">Currently Managing:</div>
                      <div className="grid gap-2">
                        {managerJobs.map(job => {
                          const managerInJob = job.assignedManagers.find(m => m.name === manager.name);
                          return (
                            <div key={job.id} className="flex justify-between items-center p-3 bg-gray-50 rounded border">
                              <div className="flex items-center space-x-3">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  job.vendor === 'Microsystems' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                }`}>
                                  {job.vendor}
                                </span>
                                <span className="font-medium text-gray-900">{job.name}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  managerInJob?.role === 'Lead Manager' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {managerInJob?.role}
                                </span>
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(job.status)}`}>
                                  {job.status}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {managerJobs.length === 0 && (
                          <div className="text-sm text-gray-400 italic bg-gray-50 p-3 rounded border text-center">
                            🎯 No active assignments - Available for new jobs
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Create New Job Modal */}
      {showCreateJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-screen overflow-y-auto">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-green-50">
              <div className="flex items-center">
                <Plus className="w-8 h-8 mr-3 text-blue-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">🚀 Create New Appraisal Job</h2>
                  <p className="text-gray-600 mt-1">Set up a new job with source data and manager assignments</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Job Information */}
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h3 className="font-medium text-yellow-800 mb-4 flex items-center space-x-2">
                  <Settings className="w-5 h-5" />
                  <span>🏷️ Job Information</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      CCDD Code *
                    </label>
                    <input
                      type="text"
                      value={newJob.ccddCode}
                      onChange={(e) => setNewJob({...newJob, ccddCode: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., 1306"
                      maxLength="4"
                    />
                    <p className="text-xs text-gray-500 mt-1">4-digit municipal code</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Job Name *
                    </label>
                    <input
                      type="text"
                      value={newJob.name}
                      onChange={(e) => setNewJob({...newJob, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Township of Middletown 2025"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Municipality *
                    </label>
                    <input
                      type="text"
                      value={newJob.municipality}
                      onChange={(e) => setNewJob({...newJob, municipality: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Middletown Township"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      County
                    </label>
                    <input
                      type="text"
                      value={newJob.county}
                      onChange={(e) => setNewJob({...newJob, county: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Monmouth"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date *
                    </label>
                    <input
                      type="date"
                      value={newJob.dueDate}
                      onChange={(e) => setNewJob({...newJob, dueDate: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* File Upload Section */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-medium text-blue-800 mb-4 flex items-center space-x-2">
                  <Upload className="w-5 h-5" />
                  <span>📁 Source Data Files</span>
                  {fileAnalysis.detectedVendor && (
                    <span className="px-3 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">
                      ✅ {fileAnalysis.detectedVendor} Detected
                    </span>
                  )}
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-2">
                      Property Data File
                    </label>
                    <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 text-center bg-white hover:bg-blue-50 transition-colors">
                      <input
                        type="file"
                        accept=".txt,.csv,.xlsx"
                        onChange={(e) => handleFileUpload(e, 'sourceFile')}
                        className="hidden"
                        id="sourceFile"
                      />
                      <label htmlFor="sourceFile" className="cursor-pointer">
                        <Upload className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                        <div className="text-sm font-medium text-blue-600">Choose Source File</div>
                        <div className="text-xs text-blue-500 mt-1">
                          Accepts: .txt (Microsystems), .csv/.xlsx (BRT)
                        </div>
                      </label>
                    </div>
                    {fileAnalysis.sourceFile && fileAnalysis.vendorDetails && (
                      <div className="mt-3 p-3 bg-white rounded border">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-green-600">✅</span>
                          <span className="font-medium text-green-800">
                            {fileAnalysis.vendorDetails.detectedFormat}
                          </span>
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                            {fileAnalysis.vendorDetails.confidence}% match
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>{fileAnalysis.vendorDetails.fileStructure}</div>
                          {fileAnalysis.propertyCount > 0 && (
                            <div className="font-medium text-green-600">
                              ✅ {fileAnalysis.propertyCount.toLocaleString()} properties detected
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-blue-700 mb-2">
                      Code Definitions File (Optional)
                    </label>
                    <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 text-center bg-white hover:bg-blue-50 transition-colors">
                      <input
                        type="file"
                        accept=".txt,.json"
                        onChange={(e) => handleFileUpload(e, 'codeFile')}
                        className="hidden"
                        id="codeFile"
                      />
                      <label htmlFor="codeFile" className="cursor-pointer">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-blue-500" />
                        <div className="text-sm font-medium text-blue-600">Choose Code File</div>
                        <div className="text-xs text-blue-500 mt-1">
                          Accepts: .txt (Microsystems), .json/.txt (BRT)
                        </div>
                      </label>
                    </div>
                    {fileAnalysis.codeFile && (
                      <div className="mt-3 p-3 bg-white rounded border">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-green-600">✅</span>
                          <span className="font-medium text-green-800">Code file validated</span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {fileAnalysis.codeCount > 0 && (
                            <div className="font-medium text-green-600">
                              ✅ {fileAnalysis.codeCount.toLocaleString()} code definitions
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Manager Assignment */}
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="font-medium text-green-800 mb-4 flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>👥 Assign Team Members *</span>
                  <span className="text-sm text-green-600 font-normal">
                    ({newJob.assignedManagers.length} selected)
                  </span>
                </h3>
                
                {newJob.assignedManagers.length > 0 && (
                  <div className="mb-6 p-4 bg-white rounded-lg border">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">✅ Selected Team Members:</h4>
                    <div className="space-y-2">
                      {newJob.assignedManagers.map(manager => (
                        <div key={manager.id} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                          <div className="flex items-center space-x-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-xs font-bold">
                              {manager.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="font-medium">{manager.name}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <select
                              value={manager.role}
                              onChange={(e) => updateManagerRole(manager.id, e.target.value)}
                              className="text-xs border border-gray-300 rounded px-2 py-1"
                            >
                              <option value="Lead Manager">Lead Manager</option>
                              <option value="Assistant Manager">Assistant Manager</option>
                              <option value="Field Supervisor">Field Supervisor</option>
                            </select>
                            <button
                              onClick={() => handleManagerToggle(manager.id)}
                              className="text-red-600 hover:text-red-800 text-xs px-2 py-1 rounded hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {managers.map(manager => {
                    const isSelected = newJob.assignedManagers.some(m => m.id === manager.id);
                    const workloadLevel = manager.activeJobs === 0 ? 'available' : 
                                        manager.activeJobs <= 2 ? 'light' : 'heavy';
                    
                    return (
                      <div
                        key={manager.id}
                        onClick={() => !isSelected && handleManagerToggle(manager.id, manager.canBeLead ? 'Lead Manager' : 'Assistant Manager')}
                        className={`p-3 border rounded-lg transition-colors ${
                          isSelected
                            ? 'border-green-500 bg-green-100 cursor-not-allowed opacity-75'
                            : `cursor-pointer border-gray-200 hover:border-gray-300 ${
                                workloadLevel === 'available' ? 'hover:bg-green-50' :
                                workloadLevel === 'light' ? 'hover:bg-yellow-50' : 'hover:bg-red-50'
                              }`
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                              workloadLevel === 'available' ? 'bg-green-100 text-green-800' :
                              workloadLevel === 'light' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {manager.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 flex items-center space-x-2">
                                <span>{manager.name}</span>
                                {manager.canBeLead && (
                                  <span className="px-1 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                                    Lead Eligible
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600">{manager.region} Region</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-sm font-medium ${
                              workloadLevel === 'available' ? 'text-green-600' :
                              workloadLevel === 'light' ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {manager.activeJobs} jobs
                            </div>
                            <div className={`text-xs capitalize ${
                              workloadLevel === 'available' ? 'text-green-600' :
                              workloadLevel === 'light' ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {workloadLevel} load
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="mt-2 text-xs text-green-600 font-medium">
                            ✅ Added to job team
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {newJob.assignedManagers.filter(m => m.role === 'Lead Manager').length === 0 && 
                 newJob.assignedManagers.length > 0 && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                    ⚠️ Consider assigning at least one Lead Manager for optimal job oversight
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateJob(false)}
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createJob}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-lg"
              >
                🚀 Create Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminJobManagement;
