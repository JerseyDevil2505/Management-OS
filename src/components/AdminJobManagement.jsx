import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService } from '../lib/supabaseClient';

const AdminJobManagement = () => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [currentUser, setCurrentUser] = useState({ role: 'admin', canAccessBilling: true });
  
  const [jobs, setJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [loading, setLoading] = useState(true);

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
    codeCount: 0,
    vendorDetails: null
  });

  const [dbConnected, setDbConnected] = useState(false);
  const [dbStats, setDbStats] = useState({ employees: 0, jobs: 0, propertyRecords: 0, sourceFiles: 0 });

  // Load real data from database
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);
        
        const connectionTest = await utilityService.testConnection();
        setDbConnected(connectionTest.success);
        
        if (connectionTest.success) {
          const [jobsData, planningData, managersData, statsData, userData] = await Promise.all([
            jobService.getAll(),
            planningJobService.getAll(),
            employeeService.getManagers(),
            utilityService.getStats(),
            authService.getCurrentUser()
          ]);
          
          setJobs(jobsData);
          setPlanningJobs(planningData);
          setManagers(managersData);
          setDbStats(statsData);
          setCurrentUser(userData || { role: 'admin', canAccessBilling: true });
        }
      } catch (error) {
        console.error('Data initialization error:', error);
        setDbConnected(false);
      } finally {
        setLoading(false);
      }
    };

    initializeData();
  }, []);

  // Enhanced file analysis with live validation
  const analyzeFileWithProcessor = async (file, type) => {
    if (!file) return;

    const text = await file.text();
    let vendorResult = null;

    if (type === 'source') {
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
            isValid: true
          };
        }
      }
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
            isValid: true
          };
        }
      }
    } else if (type === 'code') {
      if (file.name.endsWith('.txt')) {
        const lines = text.split('\n').filter(line => line.trim());
        if (text.includes('120PV') || lines.some(line => /^\d{2,3}[A-Z]{1,3}/.test(line))) {
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 95,
            detectedFormat: 'Microsystems Code Definitions',
            fileStructure: `${lines.length} code definitions`,
            codeCount: lines.length,
            isValid: true
          };
        }
      }
      else if (file.name.endsWith('.json') || text.includes('"02":"COLONIAL"')) {
        try {
          const parsed = JSON.parse(text);
          vendorResult = {
            vendor: 'BRT',
            confidence: 100,
            detectedFormat: 'BRT JSON Code Hierarchy',
            fileStructure: `JSON structure with ${Object.keys(parsed).length} categories`,
            codeCount: Object.keys(parsed).length,
            isValid: true
          };
        } catch (e) {
          if (text.includes('COLONIAL')) {
            vendorResult = {
              vendor: 'BRT',
              confidence: 80,
              detectedFormat: 'BRT Text Code Export',
              fileStructure: 'Text format with code descriptions',
              codeCount: (text.match(/"/g) || []).length / 2,
              isValid: true
            };
          }
        }
      }
    }

    setFileAnalysis(prev => ({
      ...prev,
      [type + 'File']: file,
      detectedVendor: vendorResult?.vendor || null,
      isValid: vendorResult?.isValid || false,
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
          name: `${manager.first_name} ${manager.last_name}`, 
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

  const createJob = async () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || newJob.assignedManagers.length === 0) {
      alert('Please fill all required fields and assign at least one manager');
      return;
    }

    try {
      const jobData = {
        name: newJob.name,
        ccddCode: newJob.ccddCode,
        municipality: newJob.municipality,
        county: newJob.county,
        state: newJob.state,
        vendor: newJob.vendor,
        dueDate: newJob.dueDate,
        assignedManagers: newJob.assignedManagers,
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        sourceFileStatus: newJob.sourceFile ? 'imported' : 'pending',
        codeFileStatus: newJob.codeFile ? 'current' : 'pending',
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
        },
        created_by: currentUser?.id || 'system'
      };

      await jobService.create(jobData);
      
      // Refresh jobs list
      const updatedJobs = await jobService.getAll();
      setJobs(updatedJobs);
      
      closeJobModal();
      alert('Job created successfully!');
    } catch (error) {
      console.error('Job creation error:', error);
      alert('Error creating job: ' + error.message);
    }
  };

  const editJob = (job) => {
    setEditingJob(job);
    setNewJob({
      name: job.name,
      ccddCode: job.ccddCode,
      municipality: job.municipality,
      county: job.county,
      state: job.state,
      dueDate: job.dueDate,
      assignedManagers: job.assignedManagers || [],
      sourceFile: null,
      codeFile: null,
      vendor: job.vendor,
      vendorDetection: job.vendorDetection
    });
    setShowCreateJob(true);
  };

  const deleteJob = async (job) => {
    if (!confirm(`Are you sure you want to delete "${job.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await jobService.delete(job.id);
      const updatedJobs = await jobService.getAll();
      setJobs(updatedJobs);
      alert('Job deleted successfully');
    } catch (error) {
      console.error('Job deletion error:', error);
      alert('Error deleting job: ' + error.message);
    }
  };

  const closeJobModal = () => {
    setShowCreateJob(false);
    setEditingJob(null);
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
      codeCount: 0,
      vendorDetails: null
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
      case 'active': return 'text-green-600 bg-green-100';
      case 'draft': return 'text-yellow-600 bg-yellow-100';
      case 'complete': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const goToJob = (job) => {
    alert(`Navigate to ${job.name} modules:\n- Production Tracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
  };

  const goToBillingPayroll = (job) => {
    alert(`Navigate to ${job.name} Billing & Payroll in Production Tracker`);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading job data...</p>
          </div>
        </div>
      </div>
    );
  }

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
                  <div className="text-2xl font-bold text-green-600">{jobs.filter(j => j.status === 'active').length}</div>
                  <div className="text-sm text-gray-600">Active Jobs</div>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-600">{jobs.filter(j => j.status === 'draft').length}</div>
                  <div className="text-sm text-gray-600">In Planning</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{jobs.filter(j => j.status === 'complete').length}</div>
                  <div className="text-sm text-gray-600">Complete</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{jobs.reduce((sum, job) => sum + (job.totalProperties || 0), 0).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Properties</div>
                </div>
              </div>
            </div>

            {/* Job Cards */}
            <div className="space-y-4">
              {jobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📋</div>
                  <h4 className="text-lg font-medium mb-2">No Jobs Found</h4>
                  <p className="text-sm">Create your first job to get started!</p>
                </div>
              ) : (
                jobs.map(job => (
                  <div key={job.id} className={`p-6 bg-white rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all ${
                    job.vendor === 'microsystems' ? 'border-blue-400 hover:bg-blue-50' : 'border-orange-400 hover:bg-orange-50'
                  }`}>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-xl font-bold text-gray-900">{job.name}</h3>
                          <div className="flex items-center space-x-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              job.vendor === 'microsystems' 
                                ? 'bg-blue-100 text-blue-800' 
                                : 'bg-orange-100 text-orange-800'
                            }`}>
                              {job.vendor}
                            </span>
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
                      <button 
                        onClick={() => editJob(job)}
                        className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>Edit Job</span>
                      </button>
                      <button 
                        onClick={() => deleteJob(job)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
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
              {planningJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📝</div>
                  <h4 className="text-lg font-medium mb-2">No Planning Jobs Found</h4>
                  <p className="text-sm">Planning jobs will appear here when added to the database.</p>
                </div>
              ) : (
                planningJobs.map(planningJob => (
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
                ))
              )}
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
              {managers.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">👥</div>
                  <h4 className="text-lg font-medium mb-2">No Managers Found</h4>
                  <p className="text-sm">Manager data will appear here when loaded from the employee database.</p>
                </div>
              ) : (
                managers.map(manager => (
                  <div key={manager.id} className="p-6 bg-white rounded-lg border-l-4 border-green-400 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-lg font-bold">
                          {`${manager.first_name || ''} ${manager.last_name || ''}`.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-gray-900">{manager.first_name} {manager.last_name}</h4>
                          <p className="text-sm text-gray-600">{manager.email} • {manager.region || 'No region'} Region</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-600">Available</div>
                        <div className="text-sm font-medium text-green-600">Ready for assignment</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Job Modal */}
      {showCreateJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-screen overflow-y-auto">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-green-50">
              <div className="flex items-center">
                <Plus className="w-8 h-8 mr-3 text-blue-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {editingJob ? '✏️ Edit Job' : '🚀 Create New Appraisal Job'}
                  </h2>
                  <p className="text-gray-600 mt-1">Set up a job with source data and manager assignments</p>
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
                        <div className="text-sm font-medium text-blue-600">Setup Data File: Source</div>
                        <div className="text-xs text-blue-500 mt-1">
                          Accepts: .txt (Microsystems), .csv/.xlsx (BRT)
                        </div>
                      </label>
                    </div>
                    {fileAnalysis.sourceFile && fileAnalysis.vendorDetails && (
                      <div className="mt-3 p-3 bg-white rounded border">
                        <div className="flex items-center space-x-2 mb-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
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
                        <div className="text-sm font-medium text-blue-600">Setup Table File: Key</div>
                        <div className="text-xs text-blue-500 mt-1">
                          Accepts: .txt (Microsystems), .json/.txt (BRT)
                        </div>
                      </label>
                    </div>
                    {fileAnalysis.codeFile && fileAnalysis.vendorDetails && (
                      <div className="mt-3 p-3 bg-white rounded border">
                        <div className="flex items-center space-x-2 mb-2">
                          <CheckCircle className="w-5 h-5 text-green-600" />
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {managers.map(manager => {
                    const isSelected = newJob.assignedManagers.some(m => m.id === manager.id);
                    
                    return (
                      <div
                        key={manager.id}
                        onClick={() => !isSelected && handleManagerToggle(manager.id, manager.can_be_lead ? 'Lead Manager' : 'Assistant Manager')}
                        className={`p-3 border rounded-lg transition-colors ${
                          isSelected
                            ? 'border-green-500 bg-green-100 cursor-not-allowed opacity-75'
                            : 'cursor-pointer border-gray-200 hover:border-gray-300 hover:bg-green-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-sm font-bold">
                              {`${manager.first_name || ''} ${manager.last_name || ''}`.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 flex items-center space-x-2">
                                <span>{manager.first_name} {manager.last_name}</span>
                                {manager.can_be_lead && (
                                  <span className="px-1 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                                    Lead Eligible
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600">{manager.region || 'No region'} Region</div>
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
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={closeJobModal}
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createJob}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-lg"
              >
                {editingJob ? '💾 Update Job' : '🚀 Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminJobManagement;
