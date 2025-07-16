import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService, supabase } from '../lib/supabaseClient';

const AdminJobManagement = ({ onJobSelect }) => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [currentUser, setCurrentUser] = useState({ role: 'admin', canAccessBilling: true });
  
  const [jobs, setJobs] = useState([]);
  const [archivedJobs, setArchivedJobs] = useState([]);
  const [planningJobs, setPlanningJobs] = useState([]);
  const [managers, setManagers] = useState([]);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showCreatePlanning, setShowCreatePlanning] = useState(false);
  const [showEditPlanning, setShowEditPlanning] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [editingPlanning, setEditingPlanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  const [newJob, setNewJob] = useState({
    name: '',
    ccdd: '',
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

  const [newPlanningJob, setNewPlanningJob] = useState({
    ccdd: '',
    municipality: '',
    dueDate: '',
    comments: ''
  });

  const [fileAnalysis, setFileAnalysis] = useState({
    sourceFile: null,
    codeFile: null,
    detectedVendor: null,
    isValid: false,
    propertyCount: 0,
    codeCount: 0,
    sourceVendorDetails: null,
    codeVendorDetails: null
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
          
          // Separate active and archived jobs
          const activeJobs = jobsData.filter(job => job.status !== 'archived');
          const archived = jobsData.filter(job => job.status === 'archived');
          
          // Set default status to 'active' for jobs without status
          const processedActiveJobs = activeJobs.map(job => ({
            ...job,
            status: job.status || 'active'
          }));
          
          setJobs(processedActiveJobs);
          setArchivedJobs(archived);
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

  // Enhanced file analysis with live validation and debugging
  const analyzeFileWithProcessor = async (file, type) => {
    console.log('=== ANALYZE FILE DEBUG ===');
    console.log('Starting analysis for:', file.name, 'type:', type);
    
    if (!file) {
      console.log('No file provided!');
      return;
    }

    console.log('Reading file as text...');
    const text = await file.text();
    console.log('File text length:', text.length);
    console.log('First 200 characters:', text.substring(0, 200));
    
    let vendorResult = null;

    if (type === 'source') {
      console.log('Analyzing as source file...');
      
      if (file.name.endsWith('.txt')) {
        console.log('File is .txt, checking for Microsystems format...');
        const lines = text.split('\n');
        console.log('Total lines:', lines.length);
        const headers = lines[0];
        console.log('Headers:', headers);
        
        if (headers.includes('Block|Lot|Qual') || headers.includes('|')) {
          console.log('Found pipe separators - this is Microsystems format!');
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
          
          console.log('Vendor result:', vendorResult);
        } else {
          console.log('No pipe separators found, not Microsystems format');
        }
      }
      else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
        console.log('File is CSV/Excel, checking for BRT format...');
        const lines = text.split('\n');
        const headers = lines[0];
        
        if (headers.includes('VALUES_LANDTAXABLEVALUE') || 
            headers.includes('PROPCLASS') || 
            headers.includes('LISTBY')) {
          console.log('Found BRT headers');
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
          
          console.log('Vendor result:', vendorResult);
        } else {
          console.log('No BRT headers found');
        }
      }
    } else if (type === 'code') {
      console.log('Analyzing as code file...');
      
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
          
          console.log('Code file vendor result:', vendorResult);
        } else if (text.includes('"KEY":"') && text.includes('"VALUE":"')) {
          // BRT nested JSON in text file
          console.log('Detected BRT nested JSON structure in .txt file');
          
          try {
            let jsonContent = text;
            if (text.includes('{"')) {
              jsonContent = text.substring(text.indexOf('{"'));
            }
            
            const parsed = JSON.parse(jsonContent);
            
            // Count total codes by traversing the nested structure
            let totalCodes = 0;
            const countCodes = (obj) => {
              if (obj && typeof obj === 'object') {
                if (obj.KEY && obj.DATA && obj.DATA.VALUE) {
                  totalCodes++;
                }
                if (obj.MAP) {
                  Object.values(obj.MAP).forEach(countCodes);
                }
              }
            };
            
            Object.values(parsed).forEach(countCodes);
            
            vendorResult = {
              vendor: 'BRT',
              confidence: 100,
              detectedFormat: 'BRT Nested JSON Code Structure',
              fileStructure: `Nested JSON with ${totalCodes} code definitions`,
              codeCount: totalCodes,
              isValid: true
            };
            
            console.log('BRT nested JSON code file detected:', vendorResult);
          } catch (e) {
            console.log('JSON parse failed for BRT file:', e);
            // Fallback count
            vendorResult = {
              vendor: 'BRT',
              confidence: 80,
              detectedFormat: 'BRT Text Code Export',
              fileStructure: 'Text format with nested codes',
              codeCount: (text.match(/"VALUE":/g) || []).length,
              isValid: true
            };
          }
        }
      }
      else if (file.name.endsWith('.json') || text.includes('"02":"COLONIAL"') || text.includes('"KEY":"') || text.includes('"VALUE":"')) {
        try {
          // Try to find JSON content even if file has prefix text
          let jsonContent = text;
          if (text.includes('{"')) {
            jsonContent = text.substring(text.indexOf('{"'));
          }
          
          const parsed = JSON.parse(jsonContent);
          
          // Count total codes by traversing the nested structure
          let totalCodes = 0;
          const countCodes = (obj) => {
            if (obj && typeof obj === 'object') {
              if (obj.KEY && obj.DATA && obj.DATA.VALUE) {
                totalCodes++;
              }
              if (obj.MAP) {
                Object.values(obj.MAP).forEach(countCodes);
              }
            }
          };
          
          Object.values(parsed).forEach(countCodes);
          
          vendorResult = {
            vendor: 'BRT',
            confidence: 100,
            detectedFormat: 'BRT Nested JSON Code Structure',
            fileStructure: `Nested JSON with ${totalCodes} code definitions`,
            codeCount: totalCodes,
            isValid: true
          };
          
          console.log('BRT nested JSON code file detected:', vendorResult);
        } catch (e) {
          console.log('JSON parse failed, checking for text format...');
          if (text.includes('COLONIAL') || text.includes('GROUND FLR') || text.includes('VALUE')) {
            vendorResult = {
              vendor: 'BRT',
              confidence: 80,
              detectedFormat: 'BRT Text Code Export',
              fileStructure: 'Text format with code descriptions',
              codeCount: (text.match(/"VALUE":/g) || []).length,
              isValid: true
            };
            
            console.log('BRT text code file vendor result:', vendorResult);
          }
        }
      }
    }

    console.log('Final vendor result:', vendorResult);
    console.log('Updating file analysis state...');

    setFileAnalysis(prev => {
      const newState = {
        ...prev,
        [type === 'source' ? 'sourceFile' : 'codeFile']: file,
        [type === 'source' ? 'propertyCount' : 'codeCount']: 
          vendorResult?.[type === 'source' ? 'propertyCount' : 'codeCount'] || 0,
      };
      
      // Only update vendor info if this is a source file or if no vendor was detected yet
      if (type === 'source' || !prev.detectedVendor) {
        newState.detectedVendor = vendorResult?.vendor || null;
        newState.isValid = vendorResult?.isValid || false;
      }
      
      // Store vendor details separately for each file type
      if (type === 'source') {
        newState.sourceVendorDetails = vendorResult;
      } else {
        newState.codeVendorDetails = vendorResult;
      }
      
      console.log('New file analysis state:', newState);
      return newState;
    });

    if (vendorResult && type === 'source') {
      console.log('Updating newJob state with vendor info...');
      setNewJob(prev => {
        const newJobState = { 
          ...prev, 
          vendor: vendorResult.vendor,
          vendorDetection: vendorResult
        };
        
        console.log('New job state:', newJobState);
        return newJobState;
      });
    } else {
      console.log('No vendor result or code file - not updating job state');
    }
    
    console.log('=== ANALYZE FILE COMPLETE ===');
  };

  const handleFileUpload = (e, type) => {
    console.log('=== FILE UPLOAD DEBUG ===');
    console.log('Event triggered for type:', type);
    console.log('Files array:', e.target.files);
    console.log('First file:', e.target.files[0]);
    
    const file = e.target.files[0];
    if (file) {
      console.log('File details:', {
        name: file.name,
        size: file.size,
        type: file.type
      });
      
      // Convert short type names to full names for state
      const fullTypeName = type === 'source' ? 'sourceFile' : 'codeFile';
      console.log('Setting newJob with type:', fullTypeName);
      
      setNewJob(prev => ({ ...prev, [fullTypeName]: file }));
      analyzeFileWithProcessor(file, type);
    } else {
      console.log('No file found in event');
  const createPlanningJob = async () => {
    if (!newPlanningJob.ccdd || !newPlanningJob.municipality || !newPlanningJob.dueDate) {
      window.alert('Please fill all required fields');
      return;
    }

    try {
      const planningData = {
        ccdd: newPlanningJob.ccdd,
        municipality: newPlanningJob.municipality,
        potentialYear: new Date(newPlanningJob.dueDate).getFullYear(),
        comments: newPlanningJob.comments || '',
        created_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      };

      await planningJobService.create(planningData);
      
      // Refresh planning jobs list
      const updatedPlanningJobs = await planningJobService.getAll();
      setPlanningJobs(updatedPlanningJobs);
      
      closePlanningModal();
      window.alert('Planning job created successfully!');
    } catch (error) {
      console.error('Planning job creation error:', error);
      window.alert('Error creating planning job: ' + error.message);
    }
  };

  const editJob = async () => {
    if (!newJob.name || !newJob.municipality || !newJob.dueDate) {
      window.alert('Please fill all required fields');
      return;
    }

    try {
      const updateData = {
        job_name: newJob.name,
        municipality: newJob.municipality,
        end_date: newJob.dueDate,
        target_completion_date: newJob.dueDate
      };

      const { error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', editingJob.id);
      
      if (error) throw error;

      // Update manager assignments if changed
      if (newJob.assignedManagers.length > 0) {
        // Delete existing assignments
        await supabase
          .from('job_assignments')
          .delete()
          .eq('job_id', editingJob.id);
        
        // Insert new assignments
        const assignments = newJob.assignedManagers.map(manager => ({
          job_id: editingJob.id,
          employee_id: manager.id,
          role: manager.role,
          assigned_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad',
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true
        }));
        
        const { error: assignError } = await supabase
          .from('job_assignments')
          .insert(assignments);
        
        if (assignError) {
          console.error('Manager assignment update error:', assignError);
        }
      }
      
      // Refresh jobs list
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived' && job.status !== 'complete');
      const archived = updatedJobs.filter(job => job.status === 'archived' || job.status === 'complete');
      
      setJobs(activeJobs);
      setArchivedJobs(archived);
      
      closeJobModal();
      window.alert('Job updated successfully!');
    } catch (error) {
      console.error('Job update error:', error);
      window.alert('Error updating job: ' + error.message);
    }
  };

  const editPlanningJob = async () => {
    if (!newPlanningJob.municipality || !newPlanningJob.dueDate) {
      window.alert('Please fill all required fields');
      return;
    }

    try {
      const updateData = {
        ccdd: newPlanningJob.ccdd,
        municipality: newPlanningJob.municipality,
        potentialYear: new Date(newPlanningJob.dueDate).getFullYear(),
        comments: newPlanningJob.comments || ''
      };

      await planningJobService.update(editingPlanning.id, updateData);
      
      // Refresh planning jobs list
      const updatedPlanningJobs = await planningJobService.getAll();
      setPlanningJobs(updatedPlanningJobs);
      
      closePlanningModal();
      window.alert('Planning job updated successfully!');
    } catch (error) {
      console.error('Planning job update error:', error);
      window.alert('Error updating planning job: ' + error.message);
    }
  };

  const deleteJob = async (job) => {
    try {
      await jobService.delete(job.id);
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived' && job.status !== 'complete');
      const archived = updatedJobs.filter(job => job.status === 'archived' || job.status === 'complete');
      
      setJobs(activeJobs);
      setArchivedJobs(archived);
      setShowDeleteConfirm(null);
      window.alert('Job deleted successfully');
    } catch (error) {
      console.error('Job deletion error:', error);
      window.alert('Error deleting job: ' + error.message);
    }
  };

  const deletePlanningJob = async (planningJob) => {
    if (window.confirm(`Delete planning job ${planningJob.municipality}?`)) {
      try {
        await planningJobService.delete(planningJob.id);
        const updatedPlanningJobs = await planningJobService.getAll();
        setPlanningJobs(updatedPlanningJobs);
        window.alert('Planning job deleted successfully!');
      } catch (error) {
        console.error('Planning job deletion error:', error);
        window.alert('Error deleting planning job: ' + error.message);
      }
    }
  };

  const closeJobModal = () => {
    setShowCreateJob(false);
    setEditingJob(null);
    setNewJob({
      name: '',
      ccdd: '',
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
      sourceVendorDetails: null,
      codeVendorDetails: null
    });
  };

  const closePlanningModal = () => {
    setShowCreatePlanning(false);
    setShowEditPlanning(false);
    setEditingPlanning(null);
    setNewPlanningJob({
      ccdd: '',
      municipality: '',
      dueDate: '',
      comments: ''
    });
  };

  const convertPlanningToJob = (planningJob) => {
    setNewJob({
      name: `${planningJob.municipality} ${planningJob.potentialYear}`,
      ccdd: planningJob.ccdd,
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
    const actualStatus = status || 'active';
    switch (actualStatus) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'planned': return 'text-yellow-600 bg-yellow-100';
      case 'archived': return 'text-purple-600 bg-purple-100';
      default: return 'text-green-600 bg-green-100';
    }
  };

  const goToJob = (job) => {
    if (onJobSelect) {
      onJobSelect(job);
    } else {
      console.warn('onJobSelect prop not provided to AdminJobManagement');
    }
  };

  const goToBillingPayroll = (job) => {
    window.alert(`Navigate to ${job.name} Billing & Payroll in Production Tracker`);
  };

  const getManagerWorkload = (manager) => {
    const assignedJobs = jobs.filter(job => 
      job.assignedManagers?.some(am => am.id === manager.id)
    );
    
    const totalProperties = assignedJobs.reduce((sum, job) => sum + (job.totalProperties || 0), 0);
    const completedProperties = assignedJobs.reduce((sum, job) => sum + (job.inspectedProperties || 0), 0);
    const completionRate = totalProperties > 0 ? Math.round((completedProperties / totalProperties) * 100) : 0;
    
    return {
      jobCount: assignedJobs.length,
      jobs: assignedJobs,
      totalProperties,
      completedProperties,
      completionRate
    };
  };

  const groupJobsByCounty = (jobList) => {
    const grouped = jobList.reduce((acc, job) => {
      const county = job.county || 'Unknown County';
      if (!acc[county]) {
        acc[county] = [];
      }
      acc[county].push(job);
      return acc;
    }, {});

    const sortedCounties = Object.keys(grouped).sort();
    const result = {};
    
    sortedCounties.forEach(county => {
      result[county] = grouped[county].sort((a, b) => 
        (a.municipality || '').localeCompare(b.municipality || '')
      );
    });

    return result;
  };

  const handleStatusTileClick = (tab) => {
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading job data...</p>
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
                      ? `Connected to database with ${jobs.length} active jobs tracked`
                      : 'Manage appraisal jobs with source data and team assignments'
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateJob(true)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2 font-medium shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
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
                <button
                  onClick={() => handleStatusTileClick('jobs')}
                  className="text-center p-3 bg-green-50 rounded-lg border border-green-200 hover:bg-green-100 transition-colors cursor-pointer"
                >
                  <div className="text-2xl font-bold text-green-600">{jobs.length}</div>
                  <div className="text-sm text-gray-600">Active Jobs</div>
                </button>
                <button
                  onClick={() => handleStatusTileClick('planning')}
                  className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200 hover:bg-yellow-100 transition-colors cursor-pointer"
                >
                  <div className="text-2xl font-bold text-yellow-600">{planningJobs.length}</div>
                  <div className="text-sm text-gray-600">In Planning</div>
                </button>
                <button
                  onClick={() => handleStatusTileClick('archive')}
                  className="text-center p-3 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
                >
                  <div className="text-2xl font-bold text-blue-600">{archivedJobs.length}</div>
                  <div className="text-sm text-gray-600">Complete</div>
                </button>
                <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="text-2xl font-bold text-purple-600">{jobs.reduce((sum, job) => sum + (job.totalProperties || 0), 0).toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Properties</div>
                </div>
              </div>
            </div>

            {/* County Grouped Job Cards */}
            <div className="space-y-6">
              {jobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📋</div>
                  <h4 className="text-lg font-medium mb-2">No Jobs Found</h4>
                  <p className="text-sm">Create your first job to get started!</p>
                </div>
              ) : (
                Object.entries(groupJobsByCounty(jobs)).map(([county, countyJobs]) => (
                  <div key={county} className="space-y-3">
                    <h3 className="text-lg font-bold text-gray-800 border-b border-gray-300 pb-2">
                      📍 {county} County ({countyJobs.length} jobs)
                    </h3>
                    <div className="space-y-3">
                      {countyJobs.map(job => (
                        <div key={job.id} className={`p-4 bg-white rounded-lg border-l-4 shadow-md hover:shadow-lg transition-all transform hover:scale-[1.01] ${
                          job.vendor === 'Microsystems' ? 'border-blue-400 hover:bg-blue-50' : 'border-orange-300 hover:bg-orange-50'
                        }`}>
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex-1">
                              <div className="flex justify-between items-center mb-2">
                                <h4 className="text-lg font-bold text-gray-900">
                                  {job.name} ({job.year_created || 2025}-{job.job_number || 'TBD'})
                                </h4>
                                <div className="flex items-center space-x-2">
                                  <span className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm ${
                                    job.vendor === 'Microsystems' 
                                      ? 'bg-blue-100 text-blue-800' 
                                      : 'bg-orange-200 text-orange-900'
                                  }`}>
                                    {job.vendor}
                                  </span>
                                  <span className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm ${getStatusColor(job.status)}`}>
                                    {job.status || 'active'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                                <span className="flex items-center space-x-1">
                                  <span className="font-bold text-blue-600">{job.ccdd}</span>
                                  <span>•</span>
                                  <MapPin className="w-4 h-4" />
                                  <span>{job.municipality}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <Calendar className="w-4 h-4" />
                                  <span>Due: {job.dueDate ? job.dueDate.split('-')[0] : 'TBD'}</span>
                                </span>
                                {job.assignedManagers && job.assignedManagers.length > 0 && (
                                  <span className="flex items-center space-x-1">
                                    <Users className="w-4 h-4" />
                                    <span>{job.assignedManagers.map(m => `${m.name} (${m.role})`).join(', ')}</span>
                                  </span>
                                {/* Planning Jobs Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border-2 border-yellow-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Settings className="w-8 h-8 mr-3 text-yellow-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📝 Planning Stage Jobs</h2>
                  <p className="text-gray-600 mt-1">
                    Future jobs in planning - store basic info until ready to activate
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreatePlanning(true)}
                className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-2 font-medium shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
              >
                <Plus className="w-5 h-5" />
                <span>📝 Add Planning Job</span>
              </button>
            </div>

            <div className="grid gap-4">
              {planningJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📝</div>
                  <h4 className="text-lg font-medium mb-2">No Planning Jobs Found</h4>
                  <p className="text-sm">Add planning jobs to track prospective clients.</p>
                </div>
              ) : (
                planningJobs.map(planningJob => (
                  <div key={planningJob.id} className="p-4 bg-white rounded-lg border-l-4 border-yellow-400 shadow-md hover:shadow-lg transition-all transform hover:scale-[1.01]">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center space-x-4">
                        <span className="font-bold text-blue-600 text-lg">{planningJob.ccdd}</span>
                        <div>
                          <h4 className="font-semibold text-gray-900">{planningJob.municipality}</h4>
                          <p className="text-sm text-gray-600">Potential Year: {planningJob.potentialYear}</p>
                          {planningJob.comments && (
                            <p className="text-xs text-gray-500 mt-1">{planningJob.comments}</p>
                          {/* Create/Edit Planning Job Modal */}
      {(showCreatePlanning || showEditPlanning) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-screen overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-yellow-50 to-orange-50">
              <div className="flex items-center">
                <Plus className="w-8 h-8 mr-3 text-yellow-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {editingPlanning ? '✏️ Edit Planning Job' : '📝 Add Planning Job'}
                  </h2>
                  <p className="text-gray-600 mt-1">Track prospective clients with basic information</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    CCDD Code *
                  </label>
                  <input
                    type="text"
                    value={newPlanningJob.ccdd}
                    onChange={(e) => setNewPlanningJob({...newPlanningJob, ccdd: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="e.g., 1306"
                    maxLength="4"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Municipality *
                  </label>
                  <input
                    type="text"
                    value={newPlanningJob.municipality}
                    onChange={(e) => setNewPlanningJob({...newPlanningJob, municipality: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="e.g., Middletown Township"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Date *
                  </label>
                  <input
                    type="date"
                    value={newPlanningJob.dueDate}
                    onChange={(e) => setNewPlanningJob({...newPlanningJob, dueDate: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Comments
                  </label>
                  <textarea
                    value={newPlanningJob.comments}
                    onChange={(e) => setNewPlanningJob({...newPlanningJob, comments: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="e.g., Spoke to client, will extend to 2028..."
                    rows={3}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={closePlanningModal}
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={editingPlanning ? editPlanningJob : createPlanningJob}
                className="px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-medium shadow-md hover:shadow-lg transition-all"
              >
                {editingPlanning ? '💾 Update Planning Job' : '📝 Add Planning Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Job Modal */}
      {showCreateJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-screen overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-green-50">
              <div className="flex items-center">
                <Plus className="w-8 h-8 mr-3 text-blue-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {editingJob ? '✏️ Edit Job' : '🚀 Create New Job'}
                  </h2>
                  <p className="text-gray-600 mt-1">Set up appraisal job with source data and team assignments</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic Job Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Job Name *
                  </label>
                  <input
                    type="text"
                    value={newJob.name}
                    onChange={(e) => setNewJob({...newJob, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Middletown Township 2025"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    CCDD Code *
                  </label>
                  <input
                    type="text"
                    value={newJob.ccdd}
                    onChange={(e) => setNewJob({...newJob, ccdd: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 1306"
                    maxLength="4"
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State
                  </label>
                  <select
                    value={newJob.state}
                    onChange={(e) => setNewJob({...newJob, state: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="NJ">New Jersey</option>
                    <option value="NY">New York</option>
                    <option value="PA">Pennsylvania</option>
                  </select>
                </div>
              </div>

              {/* File Upload Section */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">📁 Source Files</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Source File Upload */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h4 className="font-medium text-gray-700 mb-3">Source Data File *</h4>
                    <input
                      type="file"
                      accept=".csv,.txt,.xlsx"
                      onChange={(e) => handleFileUpload(e, 'source')}
                      className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {fileAnalysis.sourceFile && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm font-medium text-green-800">
                          ✅ {fileAnalysis.sourceFile.name}
                        </div>
                        {fileAnalysis.sourceVendorDetails && (
                          <div className="text-xs text-green-600 mt-1">
                            {fileAnalysis.sourceVendorDetails.detectedFormat} - {fileAnalysis.propertyCount} properties
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Code File Upload */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h4 className="font-medium text-gray-700 mb-3">Code Definitions File *</h4>
                    <input
                      type="file"
                      accept=".txt,.json"
                      onChange={(e) => handleFileUpload(e, 'code')}
                      className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                    />
                    {fileAnalysis.codeFile && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="text-sm font-medium text-green-800">
                          ✅ {fileAnalysis.codeFile.name}
                        </div>
                        {fileAnalysis.codeVendorDetails && (
                          <div className="text-xs text-green-600 mt-1">
                            {fileAnalysis.codeVendorDetails.detectedFormat} - {fileAnalysis.codeCount} codes
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Vendor Detection Results */}
                {fileAnalysis.detectedVendor && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h4 className="font-medium text-blue-800 mb-2">🔍 Vendor Detection Results</h4>
                    <div className="text-sm text-blue-700">
                      Detected: <span className="font-bold">{fileAnalysis.detectedVendor}</span>
                      {fileAnalysis.sourceVendorDetails && (
                        <span className="ml-2">
                          ({fileAnalysis.sourceVendorDetails.confidence}% confidence)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Manager Assignments */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">👥 Manager Assignments *</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {managers.map(manager => {
                    const assignedManager = newJob.assignedManagers.find(m => m.id === manager.id);
                    return (
                      <div
                        key={manager.id}
                        onClick={() => handleManagerToggle(manager.id)}
                        className={`p-3 border rounded-lg cursor-pointer transition-all ${
                          assignedManager
                            ? assignedManager.role === 'Lead Manager'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-green-500 bg-green-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-gray-900">
                              {manager.first_name} {manager.last_name}
                            </div>
                            <div className="text-sm text-gray-600">{manager.role}</div>
                          </div>
                          {assignedManager && (
                            <div className="text-xs font-medium text-blue-600">
                              {assignedManager.role}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {newJob.assignedManagers.length > 0 && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="text-sm font-medium text-green-800 mb-1">Assigned Managers:</div>
                    <div className="text-sm text-green-700">
                      {newJob.assignedManagers.map(m => `${m.name} (${m.role})`).join(', ')}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={closeJobModal}
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={editingJob ? editJob : createJob}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md hover:shadow-lg transition-all"
              >
                {editingJob ? '💾 Update Job' : '🚀 Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full shadow-2xl">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-8 h-8 mr-3 text-red-600" />
                <h3 className="text-lg font-semibold text-gray-900">Confirm Deletion</h3>
              </div>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{showDeleteConfirm.name}"? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteJob(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Delete Job
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminJobManagement;
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => {
                            setEditingPlanning(planningJob);
                            setNewPlanningJob({
                              ccdd: planningJob.ccdd,
                              municipality: planningJob.municipality,
                              dueDate: '',
                              comments: planningJob.comments || ''
                            });
                            setShowEditPlanning(true);
                          }}
                          className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                        >
                          <Edit3 className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => deletePlanningJob(planningJob)}
                          className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                        <button
                          onClick={() => convertPlanningToJob(planningJob)}
                          className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Create Job</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive Tab */}
      {activeTab === 'archive' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border-2 border-purple-200 p-6">
            <div className="flex items-center mb-6">
              <Archive className="w-8 h-8 mr-3 text-purple-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">📁 Archived Jobs</h2>
                <p className="text-gray-600 mt-1">
                  Completed and archived appraisal jobs
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {archivedJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📁</div>
                  <h4 className="text-lg font-medium mb-2">No Archived Jobs</h4>
                  <p className="text-sm">Completed jobs will appear here.</p>
                </div>
              ) : (
                archivedJobs.map(job => (
                  <div key={job.id} className="p-4 bg-white rounded-lg border-l-4 border-purple-400 shadow-md opacity-75">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="text-lg font-bold text-gray-700">{job.name}</h4>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span>CCDD: {job.ccdd}</span>
                          <span>•</span>
                          <span>{job.municipality}</span>
                          <span>•</span>
                          <span>Archived: {job.archived_date ? new Date(job.archived_date).toLocaleDateString() : 'Unknown'}</span>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Archived
                      </span>
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
                  View manager assignments and workload distribution
                </p>
              </div>
            </div>

            <div className="grid gap-6">
              {managers.map(manager => {
                const workload = getManagerWorkload(manager);
                return (
                  <div key={manager.id} className="p-6 bg-white rounded-lg border shadow-md">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          {manager.first_name} {manager.last_name}
                        </h3>
                        <p className="text-sm text-gray-600">{manager.role}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-blue-600">{workload.jobCount}</div>
                        <div className="text-sm text-gray-600">Active Jobs</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-lg font-bold text-blue-600">{workload.totalProperties.toLocaleString()}</div>
                        <div className="text-xs text-gray-600">Total Properties</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-lg font-bold text-green-600">{workload.completedProperties.toLocaleString()}</div>
                        <div className="text-xs text-gray-600">Completed</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-lg font-bold text-purple-600">{workload.completionRate}%</div>
                        <div className="text-xs text-gray-600">Completion Rate</div>
                      </div>
                    </div>

                    {workload.jobs.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Assigned Jobs:</h4>
                        <div className="space-y-2">
                          {workload.jobs.map(job => (
                            <div key={job.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                              <span className="text-sm font-medium">{job.name}</span>
                              <span className="text-xs text-gray-600">
                                {job.inspectedProperties || 0} / {job.totalProperties || 0} properties
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
                              </div>
                              
                              {/* Production Metrics */}
                              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 p-3 bg-gray-50 rounded-lg">
                                <div className="text-center">
                                  <div className="text-lg font-bold text-blue-600">
                                    {(job.inspectedProperties || 0).toLocaleString()} of {(job.totalProperties || 0).toLocaleString()}
                                  </div>
                                  <div className="text-xs text-gray-600">Properties Inspected</div>
                                  <div className="text-sm font-medium text-blue-600">
                                    {job.totalProperties > 0 ? Math.round(((job.inspectedProperties || 0) / job.totalProperties) * 100) : 0}% Complete
                                  </div>
                                </div>
                                
                                <div className="text-center">
                                  <div className="text-lg font-bold text-green-600">
                                    {job.workflowStats?.rates?.entryRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Residential Entry Rate</div>
                                  <div className="text-sm text-gray-500">As of: TBD</div>
                                </div>
                                
                                <div className="text-center">
                                  <div className="text-lg font-bold text-red-600">
                                    {job.workflowStats?.rates?.refusalRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Residential Refusal Rate</div>
                                  <div className="text-sm text-gray-500">As of: TBD</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-purple-600">
                                    {job.workflowStats?.rates?.commercialInspectionRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Commercial Inspections</div>
                                  <div className="text-sm text-gray-500">From Payroll</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-indigo-600">
                                    {job.workflowStats?.rates?.pricingRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Commercials Priced</div>
                                  <div className="text-sm text-gray-500">From Payroll</div>
                                </div>
                              </div>

                              {/* Attempt Status */}
                              <div className="flex space-x-2 mb-3">
                                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                  job.workflowStats?.inspectionPhases?.firstAttempt === 'COMPLETE' 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  1st: {job.workflowStats?.inspectionPhases?.firstAttempt || 'PENDING'}
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                  job.workflowStats?.inspectionPhases?.secondAttempt === 'COMPLETE' 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  2nd: {job.workflowStats?.inspectionPhases?.secondAttempt || 'PENDING'}
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                                  job.workflowStats?.inspectionPhases?.thirdAttempt === 'COMPLETE' 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  3rd: {job.workflowStats?.inspectionPhases?.thirdAttempt || 'PENDING'}
                                </div>
                              </div>

                              {/* Appeals Section */}
                              <div className="p-2 bg-yellow-50 rounded-lg border border-yellow-200 mb-3">
                                <div className="text-sm font-medium text-yellow-800 mb-1">Appeal Analytics</div>
                                <div className="text-xs text-gray-600">
                                  Total Appeals: {job.workflowStats?.appeals?.totalCount || 0} 
                                  ({job.workflowStats?.appeals?.percentOfWhole || 0}% of total properties)
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex justify-end space-x-2 pt-3 border-t border-gray-100">
                            <button 
                              onClick={() => goToJob(job)}
                              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                            >
                              <Eye className="w-4 h-4" />
                              <span>Go to Job</span>
                            </button>
                            {currentUser.canAccessBilling && (
                              <button 
                                onClick={() => goToBillingPayroll(job)}
                                className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                              >
                                <DollarSign className="w-4 h-4" />
                                <span>Billing</span>
                              </button>
                            )}
                            <button 
                              onClick={() => {
                                setEditingJob(job);
                                setNewJob({
                                  name: job.name,
                                  ccdd: job.ccdd,
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
                              }}
                              className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                            >
                              <Edit3 className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                            <button 
                              onClick={() => setShowDeleteConfirm(job)}
                              className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
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
              <span>{jobs.length + archivedJobs.length} Jobs</span>
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
              onClick={() => setActiveTab('archive')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'archive' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              📁 Archive ({archivedJobs.length})
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

  const handleManagerToggle = (managerId, role = 'manager') => {
    const manager = managers.find(m => m.id === managerId);
    const assignedManager = newJob.assignedManagers.find(m => m.id === managerId);
    
    if (assignedManager) {
      // Manager is already assigned - cycle through roles
      const currentRole = assignedManager.role;
      
      let newRole;
      if (currentRole === 'Lead Manager') {
        newRole = 'Assistant Manager';
      } else if (currentRole === 'Assistant Manager') {
        // Remove manager
        setNewJob(prev => ({
          ...prev,
          assignedManagers: prev.assignedManagers.filter(m => m.id !== managerId)
        }));
        return;
      } else {
        newRole = 'Lead Manager';
      }
      
      // Update role
      setNewJob(prev => ({
        ...prev,
        assignedManagers: prev.assignedManagers.map(m => 
          m.id === managerId ? { ...m, role: newRole } : m
        )
      }));
    } else {
      // Add manager with Lead Manager role
      setNewJob(prev => ({
        ...prev,
        assignedManagers: [...prev.assignedManagers, { 
          id: manager.id, 
          name: `${manager.first_name} ${manager.last_name}`, 
          role: 'Lead Manager'
        }]
      }));
    }
  };

  // NEW: File processing function that calls your data pipeline
  const processJobFiles = async (jobId, sourceFile, codeFile, vendor, ccdd, jobYear) => {
    try {
      console.log('Processing files for job:', jobId);
      console.log('Vendor:', vendor, 'CCDD:', ccdd, 'Year:', jobYear);
      
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('jobId', jobId);
      formData.append('sourceFile', sourceFile);
      formData.append('codeFile', codeFile);
      formData.append('vendor', vendor);
      formData.append('ccdd', ccdd);
      formData.append('jobYear', jobYear);
      
      // Call your backend data pipeline endpoint
      const response = await fetch('/api/process-job-files', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`File processing failed: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      console.log('File processing result:', result);
      
      return result;
      
    } catch (error) {
      console.error('File processing error:', error);
      throw new Error('file processing failed: ' + error.message);
    }
  };

  const createJob = async () => {
    if (!newJob.ccdd || !newJob.name || !newJob.municipality || 
        !newJob.dueDate || newJob.assignedManagers.length === 0 ||
        !newJob.sourceFile || !newJob.codeFile) {
      window.alert('Please fill all required fields, upload both files, and assign at least one manager');
      return;
    }

    try {
      // Step 1: Create the job record
      const jobData = {
        name: newJob.name,
        ccdd: newJob.ccdd,
        municipality: newJob.municipality,
        county: newJob.county,
        state: newJob.state,
        vendor: newJob.vendor,
        dueDate: newJob.dueDate,
        assignedManagers: newJob.assignedManagers,
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        status: 'active',
        sourceFileStatus: 'processing', // Will update after processing
        codeFileStatus: 'processing',   // Will update after processing
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
        created_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      };

      console.log('Creating job with data:', jobData);
      const createdJob = await jobService.create(jobData);
      console.log('Job created successfully:', createdJob);
      
      // Step 2: Process the uploaded files and populate property_records
      console.log('Starting file processing pipeline...');
      await processJobFiles(
        createdJob.id, 
        newJob.sourceFile, 
        newJob.codeFile, 
        newJob.vendor,
        newJob.ccdd,
        new Date(newJob.dueDate).getFullYear()
      );
      
      console.log('File processing completed successfully');
      
      // Step 3: Update job status to show files are processed
      await jobService.update(createdJob.id, {
        sourceFileStatus: 'imported',
        codeFileStatus: 'current'
      });
      
      // Step 4: Refresh jobs list
      const updatedJobs = await jobService.getAll();
      console.log('Updated jobs after creation:', updatedJobs);
      
      // Separate active and archived jobs
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived' && job.status !== 'complete');
      const archived = updatedJobs.filter(job => job.status === 'archived' || job.status === 'complete');
      
      setJobs(activeJobs);
      setArchivedJobs(archived);
      
      closeJobModal();
      window.alert('Job created and files processed successfully!');
      
    } catch (error) {
      console.error('Job creation error:', error);
      
      // If job was created but file processing failed, update status
      if (error.message.includes('file processing')) {
        try {
          await jobService.update(createdJob?.id, {
            sourceFileStatus: 'error',
            codeFileStatus: 'error'
          });
        } catch (updateError) {
          console.error('Failed to update job status after error:', updateError);
        }
      }
      
      window.alert('Error creating job: ' + error.message);
    }
  };
