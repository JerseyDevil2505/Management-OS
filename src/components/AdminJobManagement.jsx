import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService, propertyService } from '../lib/supabaseClient';

const AdminJobManagement = () => {
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
  const [processing, setProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState({
    isProcessing: false,
    currentStep: '',
    progress: 0,
    startTime: null,
    recordsProcessed: 0,
    totalRecords: 0,
    errors: [],
    warnings: []
  });
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [processingResults, setProcessingResults] = useState(null);

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

  const [newPlanningJob, setNewPlanningJob] = useState({
    ccddCode: '',
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

  // Helper function for elapsed time formatting
  const formatElapsedTime = (startTime) => {
    if (!startTime) return '0:00';
    const elapsed = Math.floor((new Date() - new Date(startTime)) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Notification system
  const addNotification = (message, type = 'info') => {
    const id = Date.now();
    const notification = { id, message, type, timestamp: new Date() };
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const updateProcessingStatus = (step, progress = 0, details = {}) => {
    setProcessingStatus(prev => ({
      ...prev,
      currentStep: step,
      progress,
      ...details
    }));
  };

  const resetProcessingStatus = () => {
    setProcessingStatus({
      isProcessing: false,
      currentStep: '',
      progress: 0,
      startTime: null,
      recordsProcessed: 0,
      totalRecords: 0,
      errors: [],
      warnings: []
    });
  };

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

  // CLEAN: Simple file analysis using vendor detection patterns
  const analyzeFile = async (file, type) => {
    if (!file) return;

    const text = await file.text();
    let vendorResult = null;

    if (type === 'source') {
      // Detect vendor based on file patterns
      if (file.name.endsWith('.txt')) {
        const lines = text.split('\n');
        const headers = lines[0];
        
        if (headers.includes('Block|Lot|Qual') || headers.includes('|')) {
          const dataLines = lines.slice(1).filter(line => line.trim());
          const pipeCount = (dataLines[0]?.match(/\|/g) || []).length;
          
          vendorResult = {
            vendor: 'Microsystems',
            confidence: 100,
            detectedFormat: 'Microsystems Text Delimited',
            fileStructure: `${pipeCount + 1} fields with pipe separators`,
            propertyCount: dataLines.length,
            isValid: true
          };
        }
      } else if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
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
      // Code file detection
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
        } else if (text.includes('"KEY":"') && text.includes('"VALUE":"')) {
          let totalCodes = 0;
          try {
            let jsonContent = text.includes('{"') ? text.substring(text.indexOf('{"')) : text;
            const parsed = JSON.parse(jsonContent);
            
            const countCodes = (obj) => {
              if (obj && typeof obj === 'object') {
                if (obj.KEY && obj.DATA && obj.DATA.VALUE) totalCodes++;
                if (obj.MAP) Object.values(obj.MAP).forEach(countCodes);
              }
            };
            
            Object.values(parsed).forEach(countCodes);
          } catch (e) {
            totalCodes = (text.match(/"VALUE":/g) || []).length;
          }
          
          vendorResult = {
            vendor: 'BRT',
            confidence: 100,
            detectedFormat: 'BRT Nested JSON Code Structure',
            fileStructure: `Nested JSON with ${totalCodes} code definitions`,
            codeCount: totalCodes,
            isValid: true
          };
        }
      } else if (file.name.endsWith('.json')) {
        // Similar BRT JSON processing
        let totalCodes = 0;
        try {
          const parsed = JSON.parse(text);
          const countCodes = (obj) => {
            if (obj && typeof obj === 'object') {
              if (obj.KEY && obj.DATA && obj.DATA.VALUE) totalCodes++;
              if (obj.MAP) Object.values(obj.MAP).forEach(countCodes);
            }
          };
          Object.values(parsed).forEach(countCodes);
        } catch (e) {
          totalCodes = (text.match(/"VALUE":/g) || []).length;
        }
        
        vendorResult = {
          vendor: 'BRT',
          confidence: 100,
          detectedFormat: 'BRT Nested JSON Code Structure',
          fileStructure: `Nested JSON with ${totalCodes} code definitions`,
          codeCount: totalCodes,
          isValid: true
        };
      }
    }

    // Update file analysis state
    setFileAnalysis(prev => {
      const newState = {
        ...prev,
        [type === 'source' ? 'sourceFile' : 'codeFile']: file,
        [type === 'source' ? 'propertyCount' : 'codeCount']: 
          vendorResult?.[type === 'source' ? 'propertyCount' : 'codeCount'] || 0,
      };
      
      if (type === 'source' || !prev.detectedVendor) {
        newState.detectedVendor = vendorResult?.vendor || null;
        newState.isValid = vendorResult?.isValid || false;
      }
      
      if (type === 'source') {
        newState.sourceVendorDetails = vendorResult;
      } else {
        newState.codeVendorDetails = vendorResult;
      }
      
      return newState;
    });

    if (vendorResult && type === 'source') {
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
      const fullTypeName = type === 'source' ? 'sourceFile' : 'codeFile';
      setNewJob(prev => ({ ...prev, [fullTypeName]: file }));
      analyzeFile(file, type);
    }
  };

  const handleManagerToggle = (managerId) => {
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

  // CLEAN: Use propertyService.importCSVData() instead of inline processing
  const createJob = async () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || 
        newJob.assignedManagers.length === 0 || !newJob.sourceFile || !newJob.codeFile) {
      addNotification('Please fill all required fields, upload both files, and assign at least one manager', 'error');
      return;
    }

    try {
      setProcessing(true);
      setShowProcessingModal(true);
      resetProcessingStatus();
      
      setProcessingStatus({
        isProcessing: true,
        currentStep: 'Creating job record...',
        progress: 10,
        startTime: new Date(),
        recordsProcessed: 0,
        totalRecords: fileAnalysis.propertyCount,
        errors: [],
        warnings: []
      });
      
      // Step 1: Create the job record
      const jobData = {
        name: newJob.name,
        ccdd: newJob.ccddCode,
        municipality: newJob.municipality,
        county: newJob.county,
        state: newJob.state,
        vendor: newJob.vendor,
        dueDate: newJob.dueDate,
        assignedManagers: newJob.assignedManagers,
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        status: 'active',
        sourceFileStatus: 'processing',
        codeFileStatus: 'current',
        vendorDetection: newJob.vendorDetection,
        workflowStats: {
          inspectionPhases: { firstAttempt: 'PENDING', secondAttempt: 'PENDING', thirdAttempt: 'PENDING' },
          rates: { entryRate: 0, refusalRate: 0, pricingRate: 0, commercialInspectionRate: 0 },
          appeals: { totalCount: 0, percentOfWhole: 0, byClass: {} }
        },
        created_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      };

      const createdJob = await jobService.create(jobData);
      
      updateProcessingStatus('Job created successfully. Reading files...', 25);
      
      // Step 2: Process files using clean propertyService
      if (newJob.sourceFile && newJob.codeFile) {
        updateProcessingStatus('Reading source file...', 35);
        const sourceFileContent = await newJob.sourceFile.text();
        
        updateProcessingStatus('Reading code file...', 40);
        const codeFileContent = await newJob.codeFile.text();
        
        updateProcessingStatus(`Processing ${newJob.vendor} data...`, 50);
        
        const result = await propertyService.importCSVData(
          sourceFileContent,
          codeFileContent,
          createdJob.id,
          new Date().getFullYear(),
          newJob.ccddCode,
          newJob.vendor
        );
        
        updateProcessingStatus('Updating job status...', 90, {
          recordsProcessed: result.processed || 0,
          errors: result.warnings || [],
          warnings: result.warnings || []
        });
        
        // Update job status based on processing results
        const updateData = {
          sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
          totalProperties: result.processed || 0
        };
        
        await jobService.update(createdJob.id, updateData);
        
        updateProcessingStatus('Refreshing job list...', 95);
        
        // Step 3: Refresh jobs list
        const updatedJobs = await jobService.getAll();
        const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
        const archived = updatedJobs.filter(job => job.status === 'archived');
        
        setJobs(activeJobs);
        setArchivedJobs(archived);
        
        updateProcessingStatus('Complete!', 100);
        
        // Store results for display
        setProcessingResults({
          success: result.errors === 0,
          processed: result.processed || 0,
          errors: result.errors || 0,
          warnings: result.warnings || [],
          processingTime: new Date() - processingStatus.startTime,
          jobName: newJob.name,
          vendor: newJob.vendor
        });
        
        if (result.errors > 0) {
          addNotification(`Job created but ${result.errors} errors occurred during processing`, 'warning');
        } else {
          addNotification(`Job created successfully! Processed ${result.processed} properties.`, 'success');
        }

        // Show results for 5 seconds, then auto-close
        setTimeout(() => {
          if (!processingResults) return; // Don't close if no results yet
          setShowProcessingModal(false);
        }, 5000);
      }
      
      closeJobModal();
      
    } catch (error) {
      console.error('Job creation error:', error);
      updateProcessingStatus('Error occurred', 0, {
        errors: [error.message]
      });
      addNotification('Error creating job: ' + error.message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const createPlanningJob = async () => {
    if (!newPlanningJob.ccddCode || !newPlanningJob.municipality || !newPlanningJob.dueDate) {
      addNotification('Please fill all required fields', 'error');
      return;
    }

    try {
      const planningData = {
        ccddCode: newPlanningJob.ccddCode,
        municipality: newPlanningJob.municipality,
        potentialYear: new Date(newPlanningJob.dueDate).getFullYear(),
        comments: newPlanningJob.comments || '',
        created_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      };

      await planningJobService.create(planningData);
      
      const updatedPlanningJobs = await planningJobService.getAll();
      setPlanningJobs(updatedPlanningJobs);
      
      closePlanningModal();
      addNotification('Planning job created successfully!', 'success');
    } catch (error) {
      console.error('Planning job creation error:', error);
      addNotification('Error creating planning job: ' + error.message, 'error');
    }
  };

  const editJob = async () => {
    if (!newJob.name || !newJob.municipality || !newJob.dueDate) {
      addNotification('Please fill all required fields', 'error');
      return;
    }

    try {
      const updateData = {
        name: newJob.name,
        municipality: newJob.municipality,
        dueDate: newJob.dueDate
      };

      await jobService.update(editingJob.id, updateData);
      
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
      const archived = updatedJobs.filter(job => job.status === 'archived');
      
      setJobs(activeJobs);
      setArchivedJobs(archived);
      
      closeJobModal();
      addNotification('Job updated successfully!', 'success');
    } catch (error) {
      console.error('Job update error:', error);
      addNotification('Error updating job: ' + error.message, 'error');
    }
  };

  const editPlanningJob = async () => {
    if (!newPlanningJob.municipality || !newPlanningJob.dueDate) {
      addNotification('Please fill all required fields', 'error');
      return;
    }

    try {
      const updateData = {
        municipality: newPlanningJob.municipality,
        potentialYear: new Date(newPlanningJob.dueDate).getFullYear(),
        comments: newPlanningJob.comments || ''
      };

      await planningJobService.update(editingPlanning.id, updateData);
      
      const updatedPlanningJobs = await planningJobService.getAll();
      setPlanningJobs(updatedPlanningJobs);
      
      closePlanningModal();
      addNotification('Planning job updated successfully!', 'success');
    } catch (error) {
      console.error('Planning job update error:', error);
      addNotification('Error updating planning job: ' + error.message, 'error');
    }
  };

  const deleteJob = async (job) => {
    try {
      await jobService.delete(job.id);
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
      const archived = updatedJobs.filter(job => job.status === 'archived');
      
      setJobs(activeJobs);
      setArchivedJobs(archived);
      setShowDeleteConfirm(null);
      addNotification('Job deleted successfully', 'success');
    } catch (error) {
      console.error('Job deletion error:', error);
      addNotification('Error deleting job: ' + error.message, 'error');
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
      sourceVendorDetails: null,
      codeVendorDetails: null
    });
  };

  const closePlanningModal = () => {
    setShowCreatePlanning(false);
    setShowEditPlanning(false);
    setEditingPlanning(null);
    setNewPlanningJob({
      ccddCode: '',
      municipality: '',
      dueDate: '',
      comments: ''
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
    const actualStatus = status || 'active';
    switch (actualStatus) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'planned': return 'text-yellow-600 bg-yellow-100';
      case 'archived': return 'text-purple-600 bg-purple-100';
      default: return 'text-green-600 bg-green-100';
    }
  };

  const goToJob = (job) => {
    alert(`Navigate to ${job.name} modules:\n- Production Tracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
  };

  const goToBillingPayroll = (job) => {
    alert(`Navigate to ${job.name} Billing & Payroll in Production Tracker`);
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
      if (!acc[county]) acc[county] = [];
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Notification System */}
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

      {/* Processing Modal - Enhanced */}
      {showProcessingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="text-center">
              <div className="mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Processing Job</h3>
              <p className="text-sm text-gray-600 mb-4">{processingStatus.currentStep}</p>
              
              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingStatus.progress}%` }}
                />
              </div>
              
              {/* Progress Details */}
              <div className="text-xs text-gray-500 space-y-1">
                {processingStatus.totalRecords > 0 && (
                  <div>Records: {processingStatus.recordsProcessed} / {processingStatus.totalRecords}</div>
                )}
                {processingStatus.startTime && (
                  <div>Elapsed: {formatElapsedTime(processingStatus.startTime)}</div>
                )}
                <div>{processingStatus.progress}% complete</div>
              </div>
              
              {/* Errors */}
              {processingStatus.errors.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 rounded-lg">
                  <div className="text-sm font-medium text-red-800 mb-1">Errors:</div>
                  <div className="text-xs text-red-600 space-y-1">
                    {processingStatus.errors.slice(0, 3).map((error, idx) => (
                      <div key={idx}>{error}</div>
                    ))}
                    {processingStatus.errors.length > 3 && (
                      <div>...and {processingStatus.errors.length - 3} more</div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Results */}
              {processingResults && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg">
                  <div className="text-sm font-medium text-green-800 mb-2">Processing Complete!</div>
                  <div className="text-xs text-green-600 space-y-1">
                    <div>✅ {processingResults.processed} properties processed</div>
                    <div>⏱️ Total time: {formatElapsedTime(processingStatus.startTime)}</div>
                    <div>🏢 Job: {processingResults.jobName}</div>
                    <div>📊 Vendor: {processingResults.vendor}</div>
                    {processingResults.errors > 0 && (
                      <div className="text-red-600">⚠️ {processingResults.errors} errors occurred</div>
                    )}
                  </div>
                  
                  {/* Manual close button */}
                  <button
                    onClick={() => setShowProcessingModal(false)}
                    className="mt-3 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                                <h4 className="text-lg font-bold text-gray-900">{job.name}</h4>
                                <div className="flex items-center space-x-2">
                                  <span className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm ${
                                    job.vendor === 'Microsystems' 
                                      ? 'bg-blue-100 text-blue-800' 
                                      : 'bg-orange-200 text-orange-800'
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
                                  <span className="font-bold text-blue-600">{job.ccddCode}</span>
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
                                  <div className="text-xs text-gray-600">Entry Rate</div>
                                  <div className="text-sm text-gray-500">As of: TBD</div>
                                </div>
                                
                                <div className="text-center">
                                  <div className="text-lg font-bold text-red-600">
                                    {job.workflowStats?.rates?.refusalRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Refusal Rate</div>
                                  <div className="text-sm text-gray-500">As of: TBD</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-purple-600">
                                    {job.workflowStats?.rates?.commercialInspectionRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Commercial Complete</div>
                                  <div className="text-sm text-gray-500">From Payroll</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-indigo-600">
                                    {job.workflowStats?.rates?.pricingRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Pricing Complete</div>
                                  <div className="text-sm text-gray-500">From Payroll</div>
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
                            <button 
                              onClick={() => {
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

      {/* Create/Edit Job Modal */}
      {showCreateJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-screen overflow-y-auto shadow-2xl">
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
                      disabled={editingJob}
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
                      disabled={editingJob}
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

              {/* File Upload Section - Only show when creating new job */}
              {!editingJob && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="font-medium text-blue-800 mb-4 flex items-center space-x-2">
                    <Upload className="w-5 h-5" />
                    <span>📁 Setup Files</span>
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
                          onChange={(e) => handleFileUpload(e, 'source')}
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
                      {fileAnalysis.sourceFile && fileAnalysis.sourceVendorDetails && (
                        <div className="mt-3 p-3 bg-white rounded border">
                          <div className="flex items-center space-x-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="font-medium text-green-800">
                              {fileAnalysis.sourceVendorDetails.detectedFormat}
                            </span>
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                              {fileAnalysis.sourceVendorDetails.confidence}% match
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <div>{fileAnalysis.sourceVendorDetails.fileStructure}</div>
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
                          onChange={(e) => handleFileUpload(e, 'code')}
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
                      {fileAnalysis.codeFile && fileAnalysis.codeVendorDetails && (
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
              )}

              {/* Manager Assignment */}
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="font-medium text-green-800 mb-4 flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>👥 Assign Team Members *</span>
                  <span className="text-sm text-green-600 font-normal">
                    ({newJob.assignedManagers.length} selected)
                  </span>
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {managers.map(manager => {
                    const assignedManager = newJob.assignedManagers.find(m => m.id === manager.id);
                    const isSelected = !!assignedManager;
                    
                    return (
                      <div
                        key={manager.id}
                        onClick={() => handleManagerToggle(manager.id)}
                        className={`p-3 border rounded-lg transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-green-500 bg-green-100'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-green-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-sm font-bold">
                              {`${manager.first_name || ''} ${manager.last_name || ''}`.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 text-sm flex items-center space-x-1">
                                <span>{manager.first_name} {manager.last_name}</span>
                                {manager.can_be_lead && (
                                  <span className="px-1 py-0.5 bg-blue-100 text-blue-800 text-xs rounded">
                                    Lead
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="mt-2 text-xs">
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
                              {assignedManager.role}
                            </span>
                            <div className="text-green-600 mt-1 text-xs">
                              Click: Lead → Assistant → Remove
                            </div>
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
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={editingJob ? editJob : createJob}
                disabled={processing}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? 'Processing...' : editingJob ? '💾 Update Job' : '🚀 Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="text-center">
              <Trash2 className="w-12 h-12 mx-auto mb-4 text-red-600" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Job</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{showDeleteConfirm.name}"? This action cannot be undone.
              </p>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteJob(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-md hover:shadow-lg transition-all"
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
