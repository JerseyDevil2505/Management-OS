import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle, X } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService, propertyService, supabase } from '../lib/supabaseClient';

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
  const [processing, setProcessing] = useState(false);

  // Processing and notification state
  const [processingStatus, setProcessingStatus] = useState({
    isProcessing: false,
    currentStep: '',
    progress: 0,
    startTime: null,
    recordsProcessed: 0,
    totalRecords: 0,
    errors: [],
    warnings: [],
    logs: []
  });
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [processingResults, setProcessingResults] = useState(null);

  // County HPI state
  const [countyHpiData, setCountyHpiData] = useState({});
  const [showHpiImport, setShowHpiImport] = useState(null);
  const [hpiFile, setHpiFile] = useState(null);
  const [importingHpi, setImportingHpi] = useState(false);

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
    vendorDetection: null,
    percentBilled: 0.00
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
    codeCount: 0
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

  // Helper function to capitalize county names
  const capitalizeCounty = (county) => {
    if (!county) return county;
    return county.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
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
      warnings: [],
      logs: []
    });
  };

  // File removal handler
  const removeFile = (fileType) => {
    if (fileType === 'source') {
      setNewJob(prev => ({ ...prev, sourceFile: null }));
      setFileAnalysis(prev => ({ 
        ...prev, 
        sourceFile: null, 
        propertyCount: 0,
        detectedVendor: fileAnalysis.codeFile ? prev.detectedVendor : null,
        isValid: !!fileAnalysis.codeFile 
      }));
    } else if (fileType === 'code') {
      setNewJob(prev => ({ ...prev, codeFile: null }));
      setFileAnalysis(prev => ({ 
        ...prev, 
        codeFile: null, 
        codeCount: 0 
      }));
    }
    // Reset file input
    const inputId = fileType === 'source' ? 'sourceFile' : 'codeFile';
    const fileInput = document.getElementById(inputId);
    if (fileInput) fileInput.value = '';
  };

  // Get unique counties from jobs
  const getUniqueCounties = () => {
    const counties = [...jobs, ...archivedJobs]
      .map(job => capitalizeCounty(job.county))
      .filter(county => county && county.trim() !== '')
      .filter((county, index, arr) => arr.indexOf(county) === index)
      .sort();
    return counties;
  };

  // County HPI import handler - FIXED WITH REAL DATABASE INTEGRATION
  const importCountyHpi = async (county) => {
    if (!hpiFile) {
      addNotification('Please select an HPI data file', 'error');
      return;
    }

    try {
      setImportingHpi(true);
      const fileContent = await hpiFile.text();
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        addNotification('Invalid CSV file format', 'error');
        return;
      }

      const header = lines[0].split(',');
      const dateColumnIndex = header.findIndex(col => col.toLowerCase().includes('observation_date') || col.toLowerCase().includes('date'));
      const hpiColumnIndex = header.findIndex(col => col.includes('ATNHPIUS') || col.toLowerCase().includes('hpi'));

      if (dateColumnIndex === -1 || hpiColumnIndex === -1) {
        addNotification('Could not find required columns in CSV', 'error');
        return;
      }

      const hpiRecords = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length >= 2) {
          const dateStr = values[dateColumnIndex].trim();
          const hpiValue = parseFloat(values[hpiColumnIndex]);
          
          if (dateStr && !isNaN(hpiValue)) {
            const year = parseInt(dateStr.split('-')[0]);
            hpiRecords.push({
              county_name: county,
              observation_year: year,
              hpi_index: hpiValue,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }
      }

      // REAL Supabase database integration
      const { data, error } = await supabase
        .from('county_hpi_data')
        .delete()
        .eq('county_name', county);

      if (error) {
        console.error('Error clearing existing HPI data:', error);
      }

      const { data: insertData, error: insertError } = await supabase
        .from('county_hpi_data')
        .insert(hpiRecords);

      if (insertError) {
        throw new Error('Database insert failed: ' + insertError.message);
      }
      
      // Update local state
      setCountyHpiData(prev => ({
        ...prev,
        [county]: hpiRecords
      }));

      addNotification(`Successfully imported ${hpiRecords.length} HPI records for ${county} County`, 'success');
      setShowHpiImport(null);
      setHpiFile(null);
      
    } catch (error) {
      console.error('HPI import error:', error);
      addNotification('Error importing HPI data: ' + error.message, 'error');
    } finally {
      setImportingHpi(false);
    }
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
          
          // Set default status to 'Active' for jobs without status and capitalize counties
          const processedActiveJobs = activeJobs.map(job => ({
            ...job,
            status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
            county: capitalizeCounty(job.county),
            percentBilled: job.percent_billed || 0.00
          }));
          
          const processedArchivedJobs = archived.map(job => ({
            ...job,
            county: capitalizeCounty(job.county)
          }));
          
          setJobs(processedActiveJobs);
          setArchivedJobs(processedArchivedJobs);
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

  // SIMPLIFIED FILE ANALYSIS
  const analyzeFile = async (file, type) => {
    if (!file) return;

    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    let vendor = null;
    let count = 0;

    if (type === 'source') {
      if (file.name.endsWith('.txt') && text.includes('|')) {
        vendor = 'Microsystems';
        count = lines.length - 1; // Subtract header row
      } else if (file.name.endsWith('.csv')) {
        vendor = 'BRT';
        count = lines.length - 1; // Subtract header row
      }
    } else if (type === 'code') {
      if (file.name.endsWith('.txt') && text.includes('=')) {
        vendor = 'Microsystems';
        count = lines.length;
      } else if (text.includes('{')) {
        vendor = 'BRT';
        count = (text.match(/"VALUE":/g) || []).length;
      }
    }

    // Update file analysis state
    setFileAnalysis(prev => {
      const newState = {
        ...prev,
        [type === 'source' ? 'sourceFile' : 'codeFile']: file,
        [type === 'source' ? 'propertyCount' : 'codeCount']: count,
        detectedVendor: vendor,
        isValid: !!vendor
      };
      return newState;
    });

    if (vendor && type === 'source') {
      setNewJob(prev => ({ ...prev, vendor }));
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
      const currentRole = assignedManager.role;
      
      let newRole;
      if (currentRole === 'Lead Manager') {
        newRole = 'Assistant Manager';
      } else if (currentRole === 'Assistant Manager') {
        setNewJob(prev => ({
          ...prev,
          assignedManagers: prev.assignedManagers.filter(m => m.id !== managerId)
        }));
        return;
      } else {
        newRole = 'Lead Manager';
      }
      
      setNewJob(prev => ({
        ...prev,
        assignedManagers: prev.assignedManagers.map(m => 
          m.id === managerId ? { ...m, role: newRole } : m
        )
      }));
    } else {
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

  // ENHANCED createJob with real-time batch processing logs and persistent modal
  const createJob = async () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || 
        newJob.assignedManagers.length === 0 || !newJob.sourceFile || !newJob.codeFile) {
      addNotification('Please fill all required fields, upload both files, and assign at least one manager', 'error');
      return;
    }

    try {
      // IMMEDIATELY hide create job modal and show processing modal
      setShowCreateJob(false);
      setShowProcessingModal(true);
      setProcessing(true);
      
      setProcessingStatus({
        isProcessing: true,
        currentStep: 'Preparing job creation...',
        progress: 5,
        startTime: new Date(),
        recordsProcessed: 0,
        totalRecords: fileAnalysis.propertyCount,
        errors: [],
        warnings: [],
        logs: []
      });

      // Let the UI render the modal first
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // THEN start the actual processing
      updateProcessingStatus('Creating job record...', 10);
      
      const jobData = {
        name: newJob.name,
        ccdd: newJob.ccddCode,
        municipality: newJob.municipality,
        county: capitalizeCounty(newJob.county),
        state: newJob.state,
        vendor: newJob.vendor,
        dueDate: newJob.dueDate,
        assignedManagers: newJob.assignedManagers,
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        status: 'active',
        sourceFileStatus: 'processing',
        codeFileStatus: 'current',
        vendorDetection: { vendor: newJob.vendor },
        percent_billed: newJob.percentBilled,
        
        source_file_name: newJob.sourceFile.name,
        source_file_version_id: crypto.randomUUID(),
        source_file_uploaded_at: new Date().toISOString(),
        
        workflowStats: {
          inspectionPhases: { firstAttempt: 'PENDING', secondAttempt: 'PENDING', thirdAttempt: 'PENDING' },
          rates: { entryRate: 0, refusalRate: 0, pricingRate: 0, commercialInspectionRate: 0 },
          appeals: { totalCount: 0, percentOfWhole: 0, byClass: {} }
        },
        created_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      };

      const createdJob = await jobService.create(jobData);
      
      updateProcessingStatus('Job created successfully. Reading files...', 25);
      
      if (newJob.sourceFile && newJob.codeFile) {
        updateProcessingStatus('Reading source file...', 35);
        const sourceFileContent = await newJob.sourceFile.text();
        
        updateProcessingStatus('Reading code file...', 40);
        const codeFileContent = await newJob.codeFile.text();
        
        updateProcessingStatus(`Processing ${newJob.vendor} data (${fileAnalysis.propertyCount} records)...`, 50);
        
        // Capture console logs during processing for real-time feedback
        const originalConsoleLog = console.log;
        const logs = [];
        
        console.log = (...args) => {
          const message = args.join(' ');
          // Capture batch processing logs
          if (message.includes('✅') || message.includes('Batch inserting') || message.includes('Processing')) {
            logs.push({
              timestamp: new Date().toLocaleTimeString(),
              message: message
            });
            // Update processing status with latest logs
            setProcessingStatus(prev => ({
              ...prev,
              logs: [...logs]
            }));
          }
          originalConsoleLog(...args);
        };
        
        const result = await propertyService.importCSVData(
          sourceFileContent,
          codeFileContent,
          createdJob.id,
          new Date().getFullYear(),
          newJob.ccddCode,
          newJob.vendor,
          {
            source_file_name: newJob.sourceFile.name,
            source_file_version_id: createdJob.source_file_version_id,
            source_file_uploaded_at: new Date().toISOString()
          }
        );
        
        // Restore original console.log
        console.log = originalConsoleLog;
        
        updateProcessingStatus('Updating job status...', 90, {
          recordsProcessed: result.processed || 0,
          errors: result.warnings || [],
          warnings: result.warnings || []
        });
        
        const updateData = {
          sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
          totalProperties: result.processed || 0
        };
        
        await jobService.update(createdJob.id, updateData);
        
        updateProcessingStatus('Refreshing job list...', 95);
        
        const updatedJobs = await jobService.getAll();
        const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
        const archived = updatedJobs.filter(job => job.status === 'archived');
        
        setJobs(activeJobs.map(job => ({
          ...job,
          status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
          county: capitalizeCounty(job.county),
          percentBilled: job.percent_billed || 0.00
        })));
        setArchivedJobs(archived.map(job => ({
          ...job,
          county: capitalizeCounty(job.county)
        })));
        
        updateProcessingStatus('Complete!', 100);
        
        setProcessingResults({
          success: result.errors === 0,
          processed: result.processed || 0,
          errors: result.errors || 0,
          warnings: result.warnings || [],
          processingTime: new Date() - new Date(processingStatus.startTime),
          jobName: newJob.name,
          vendor: newJob.vendor
        });
        
        if (result.errors > 0) {
          addNotification(`Job created but ${result.errors} errors occurred during processing`, 'warning');
        } else {
          addNotification(`Job created successfully! Processed ${result.processed} properties.`, 'success');
        }

        closeJobModal();
      }
      
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
        dueDate: newJob.dueDate,
        percent_billed: newJob.percentBilled
      };

      console.log('DEBUG - Sending to database:', updateData);
      console.log('DEBUG - newJob.percentBilled value:', newJob.percentBilled);
      console.log('DEBUG - editingJob.id:', editingJob.id);

      await jobService.update(editingJob.id, updateData);
      
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
      const archived = updatedJobs.filter(job => job.status === 'archived');
      
      setJobs(activeJobs.map(job => ({
        ...job,
        status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
        county: capitalizeCounty(job.county),
        percentBilled: job.percent_billed || 0.00
      })));
      setArchivedJobs(archived.map(job => ({
        ...job,
        county: capitalizeCounty(job.county)
      })));
      
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
      
      setJobs(activeJobs.map(job => ({
        ...job,
        status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
        county: capitalizeCounty(job.county),
        percentBilled: job.percent_billed || 0.00
      })));
      setArchivedJobs(archived.map(job => ({
        ...job,
        county: capitalizeCounty(job.county)
      })));
      setShowDeleteConfirm(null);
      addNotification('Job deleted successfully', 'success');
    } catch (error) {
      console.error('Job deletion error:', error);
      addNotification('Error deleting job: ' + error.message, 'error');
    }
  };

  // Reset form data after successful creation
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
      vendorDetection: null,
      percentBilled: 0.00
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
      vendorDetection: null,
      percentBilled: 0.00
    });
    setShowCreateJob(true);
  };

  const getStatusColor = (status) => {
    const actualStatus = status || 'Active';
    switch (actualStatus) {
      case 'Active': return 'text-green-600 bg-green-100';
      case 'planned': return 'text-yellow-600 bg-yellow-100';
      case 'archived': return 'text-purple-600 bg-purple-100';
      default: return 'text-green-600 bg-green-100';
    }
  };

  const goToJob = (job) => {
    if (onJobSelect) {
      onJobSelect(job);
    } else {
      alert(`Navigate to ${job.name} modules:\n- Production Tracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
    }
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

      {/* Processing Modal */}
      {showProcessingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6 shadow-2xl">
            <div className="text-center">
              <div className="mb-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Processing Job</h3>
              <p className="text-sm text-gray-600 mb-4">{processingStatus.currentStep}</p>
              
              <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingStatus.progress}%` }}
                ></div>
              </div>
              
              <div className="text-xs text-gray-500 space-y-1 mb-4">
                {processingStatus.totalRecords > 0 && (
                  <div>Records: {processingStatus.recordsProcessed} / {processingStatus.totalRecords}</div>
                )}
                {processingStatus.startTime && (
                  <div>Elapsed: {formatElapsedTime(processingStatus.startTime)}</div>
                )}
                <div>{processingStatus.progress}% complete</div>
              </div>

              {/* Real-time batch processing logs */}
              {processingStatus.logs && processingStatus.logs.length > 0 && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg max-h-32 overflow-y-auto">
                  <div className="text-sm font-medium text-blue-800 mb-2">Batch Processing:</div>
                  <div className="text-xs text-blue-700 space-y-1 text-left">
                    {processingStatus.logs.slice(-5).map((log, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{log.message}</span>
                        <span className="text-blue-500">{log.timestamp}</span>
                      </div>
                    ))}
                    {processingStatus.logs.length > 5 && (
                      <div className="text-center text-blue-600 font-medium">
                        ...and {processingStatus.logs.length - 5} more steps
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Error Display */}
              {processingStatus.errors && processingStatus.errors.length > 0 && (
                <div className="mb-4 p-3 bg-red-50 rounded-lg">
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
              
              {/* COMPLETION RESULTS */}
              {processingResults && (
                <div className="mb-4 p-4 bg-green-50 rounded-lg border-2 border-green-200">
                  <div className="text-lg font-bold text-green-800 mb-3">🎉 Processing Complete!</div>
                  <div className="text-sm text-green-700 space-y-2">
                    <div className="flex justify-between">
                      <span>✅ Properties Processed:</span>
                      <span className="font-bold">{processingResults.processed.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>⏱️ Total Time:</span>
                      <span className="font-bold">{formatElapsedTime(processingStatus.startTime)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>🏢 Job Created:</span>
                      <span className="font-bold">{processingResults.jobName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>📊 Vendor:</span>
                      <span className="font-bold">{processingResults.vendor}</span>
                    </div>
                    {processingResults.errors > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>⚠️ Errors:</span>
                        <span className="font-bold">{processingResults.errors}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div className="flex justify-center space-x-3">
                {/* FORCE QUIT - Only during processing */}
                {!processingResults && processingStatus.isProcessing && (
                  <button
                    onClick={() => {
                      setShowProcessingModal(false);
                      setProcessing(false);
                      resetProcessingStatus();
                      addNotification('Job creation cancelled - import stopped', 'warning');
                    }}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
                  >
                    🛑 Force Quit Import
                  </button>
                )}

                {/* CLOSE - Only when complete */}
                {processingResults && (
                  <button
                    onClick={() => {
                      setShowProcessingModal(false);
                      setProcessingResults(null);
                      resetProcessingStatus();
                    }}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                  >
                    ✅ Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* County HPI Import Modal */}
      {showHpiImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="text-center">
              <TrendingUp className="w-12 h-12 mx-auto mb-4 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Import HPI Data</h3>
              <p className="text-gray-600 mb-4">
                Upload HPI data for <strong>{showHpiImport}</strong> County
              </p>
              
              <div className="mb-4">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setHpiFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                <p className="text-xs text-gray-500 mt-2">
                  CSV file with observation_date and HPI index columns
                </p>
              </div>

              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => {
                    setShowHpiImport(null);
                    setHpiFile(null);
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => importCountyHpi(showHpiImport)}
                  disabled={!hpiFile || importingHpi}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {importingHpi ? 'Importing...' : 'Import HPI Data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Job Modal */}
      {showCreateJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-screen overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-green-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Plus className="w-8 h-8 mr-3 text-blue-600" />
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {editingJob ? '✏️ Edit Job' : '🚀 Create New Appraisal Job'}
                    </h2>
                    <p className="text-gray-600 mt-1">Set up a job with source data and manager assignments</p>
                  </div>
                </div>
                {/* % Billed field in top right - FIXED CSS */}
                <div className="bg-white p-3 rounded-lg border shadow-sm">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    % Billed
                  </label>
                  <div className="flex items-center space-x-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={newJob.percentBilled}
                      onChange={(e) => setNewJob({...newJob, percentBilled: parseFloat(e.target.value) || 0})}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="0.00"
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
                  <style jsx>{`
                    input[type="number"]::-webkit-outer-spin-button,
                    input[type="number"]::-webkit-inner-spin-button {
                      -webkit-appearance: none;
                      margin: 0;
                    }
                    input[type="number"] {
                      -moz-appearance: textfield;
                    }
                  `}</style>
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

              {/* File Upload Section with Remove Buttons */}
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
                        Property Data File *
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
                          <div className="text-sm font-medium text-blue-600">Source Data File</div>
                          <div className="text-xs text-blue-500 mt-1">
                            .txt (Microsystems) or .csv (BRT)
                          </div>
                        </label>
                      </div>
                      {fileAnalysis.sourceFile && (
                        <div className="mt-3 p-3 bg-white rounded border relative">
                          <button
                            onClick={() => removeFile('source')}
                            className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div className="flex items-center space-x-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="font-medium text-green-800">
                              {fileAnalysis.detectedVendor} Format Detected
                            </span>
                          </div>
                          <div className="text-sm text-gray-600">
                            <div className="font-medium text-gray-800">{fileAnalysis.sourceFile.name}</div>
                            {fileAnalysis.propertyCount > 0 && (
                              <div className="font-medium text-green-600">
                                ✅ {fileAnalysis.propertyCount.toLocaleString()} properties
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-blue-700 mb-2">
                        Code Definitions File *
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
                          <div className="text-sm font-medium text-blue-600">Code Definitions File</div>
                          <div className="text-xs text-blue-500 mt-1">
                            .txt (Microsystems) or .txt/.json (BRT)
                          </div>
                        </label>
                      </div>
                      {fileAnalysis.codeFile && (
                        <div className="mt-3 p-3 bg-white rounded border relative">
                          <button
                            onClick={() => removeFile('code')}
                            className="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 text-xs"
                          >
                            <X className="w-3 h-3" />
                          </button>
                          <div className="flex items-center space-x-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="font-medium text-green-800">Code file validated</span>
                          </div>
                          <div className="text-sm text-gray-600">
                            <div className="font-medium text-gray-800">{fileAnalysis.codeFile.name}</div>
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

      {/* Create/Edit Planning Job Modal */}
      {(showCreatePlanning || showEditPlanning) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full shadow-2xl">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-yellow-50 to-orange-50">
              <div className="flex items-center">
                <Calendar className="w-8 h-8 mr-3 text-yellow-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {showEditPlanning ? '✏️ Edit Planning Job' : '📝 Add Planning Job'}
                  </h2>
                  <p className="text-gray-600 mt-1">Set up a potential future project</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    CCDD Code *
                  </label>
                  <input
                    type="text"
                    value={newPlanningJob.ccddCode}
                    onChange={(e) => setNewPlanningJob({...newPlanningJob, ccddCode: e.target.value})}
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
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Year *
                </label>
                <input
                  type="date"
                  value={newPlanningJob.dueDate}
                  onChange={(e) => setNewPlanningJob({...newPlanningJob, dueDate: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Comments
                </label>
                <textarea
                  value={newPlanningJob.comments}
                  onChange={(e) => setNewPlanningJob({...newPlanningJob, comments: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  rows="3"
                  placeholder="Notes about this potential project..."
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
              <button
                onClick={closePlanningModal}
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={showEditPlanning ? editPlanningJob : createPlanningJob}
                className="px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 font-medium"
              >
                {showEditPlanning ? '💾 Update Planning Job' : '📝 Add Planning Job'}
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

      {/* Header */}
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
              📅 Planning Jobs ({planningJobs.length})
            </button>
            <button
              onClick={() => setActiveTab('archived')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'archived' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              🗄️ Archived Jobs ({archivedJobs.length})
            </button>
            <button
              onClick={() => setActiveTab('county-hpi')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'county-hpi' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              📈 County HPI ({getUniqueCounties().length})
            </button>
            <button
              onClick={() => setActiveTab('manager-assignments')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'manager-assignments' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              👥 Manager Assignments ({managers.length})
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
                                    {job.status || 'Active'}
                                  </span>
                                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium shadow-sm">
                                    {(job.percentBilled || 0).toFixed(2)}% Billed
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
                                </div>
                                
                                <div className="text-center">
                                  <div className="text-lg font-bold text-red-600">
                                    {job.workflowStats?.rates?.refusalRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Refusal Rate</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-purple-600">
                                    {job.workflowStats?.rates?.commercialInspectionRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Commercial Complete</div>
                                </div>

                                <div className="text-center">
                                  <div className="text-lg font-bold text-indigo-600">
                                    {job.workflowStats?.rates?.pricingRate || 0}%
                                  </div>
                                  <div className="text-xs text-gray-600">Pricing Complete</div>
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
                                  vendorDetection: job.vendorDetection,
                                  percentBilled: job.percent_billed || 0.00
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

      {/* Planning Jobs Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border-2 border-yellow-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Calendar className="w-8 h-8 mr-3 text-yellow-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📅 Planning Job Pipeline</h2>
                  <p className="text-gray-600 mt-1">
                    Track potential future projects and convert to active jobs when ready
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

            {/* Planning Jobs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {planningJobs.length === 0 ? (
                <div className="col-span-full text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📅</div>
                  <h4 className="text-lg font-medium mb-2">No Planning Jobs</h4>
                  <p className="text-sm">Add potential future projects to your pipeline!</p>
                </div>
              ) : (
                planningJobs.map(planningJob => (
                  <div key={planningJob.id} className="p-4 bg-white rounded-lg border shadow-md hover:shadow-lg transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900">{planningJob.municipality}</h4>
                        <p className="text-sm text-gray-600">CCDD: {planningJob.ccdd}</p>
                        <p className="text-sm text-gray-600">Target Year: {planningJob.potentialYear}</p>
                      </div>
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                        Planning
                      </span>
                    </div>
                    
                    {planningJob.comments && (
                      <div className="mb-3 p-2 bg-gray-50 rounded text-sm text-gray-700">
                        {planningJob.comments}
                      </div>
                    )}
                    
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => convertPlanningToJob(planningJob)}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Convert to Job</span>
                      </button>
                      <button
                        onClick={() => {
                          setEditingPlanning(planningJob);
                          setNewPlanningJob({
                            ccddCode: planningJob.ccdd,
                            municipality: planningJob.municipality,
                            dueDate: `${planningJob.potentialYear}-12-31`,
                            comments: planningJob.comments || ''
                          });
                          setShowEditPlanning(true);
                        }}
                        className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archived Jobs Tab */}
      {activeTab === 'archived' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border-2 border-purple-200 p-6">
            <div className="flex items-center mb-6">
              <Archive className="w-8 h-8 mr-3 text-purple-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">🗄️ Archived Jobs</h2>
                <p className="text-gray-600 mt-1">
                  Completed projects archived for reference and historical data
                </p>
              </div>
            </div>

            {/* Archived Jobs List */}
            <div className="space-y-3">
              {archivedJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">🗄️</div>
                  <h4 className="text-lg font-medium mb-2">No Archived Jobs</h4>
                  <p className="text-sm">Completed jobs will appear here for reference</p>
                </div>
              ) : (
                archivedJobs.map(job => (
                  <div key={job.id} className="p-4 bg-white rounded-lg border-l-4 border-purple-400 shadow-md">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900">{job.name}</h4>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                          <span>CCDD: {job.ccddCode}</span>
                          <span>{job.municipality}</span>
                          <span>{job.totalProperties?.toLocaleString() || 0} Properties</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                          Archived
                        </span>
                        <button
                          onClick={() => goToJob(job)}
                          className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
                        >
                          View
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

      {/* County HPI Tab */}
      {activeTab === 'county-hpi' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border-2 border-indigo-200 p-6">
            <div className="flex items-center mb-6">
              <TrendingUp className="w-8 h-8 mr-3 text-indigo-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">📈 County HPI Data Management</h2>
                <p className="text-gray-600 mt-1">
                  Import and manage Housing Price Index data for time normalization calculations
                </p>
              </div>
            </div>

            {/* Counties Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {getUniqueCounties().length === 0 ? (
                <div className="col-span-full text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📈</div>
                  <h4 className="text-lg font-medium mb-2">No Counties Found</h4>
                  <p className="text-sm">Create jobs with county information to manage HPI data</p>
                </div>
              ) : (
                getUniqueCounties().map(county => (
                  <div key={county} className="p-4 bg-white rounded-lg border shadow-md hover:shadow-lg transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-lg font-bold text-gray-900">{county} County</h4>
                        <p className="text-sm text-gray-600">
                          {countyHpiData[county] ? 
                            `${countyHpiData[county].length} HPI records` : 
                            'No HPI data imported'
                          }
                        </p>
                      </div>
                      <div className="flex items-center space-x-1">
                        <TrendingUp className="w-5 h-5 text-indigo-600" />
                        {countyHpiData[county] && (
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                            ✓ Data
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {countyHpiData[county] && (
                      <div className="mb-3 p-2 bg-indigo-50 rounded text-sm">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="font-medium">Years:</span> {
                              Math.min(...countyHpiData[county].map(r => r.observation_year))
                            } - {
                              Math.max(...countyHpiData[county].map(r => r.observation_year))
                            }
                          </div>
                          <div>
                            <span className="font-medium">Latest HPI:</span> {
                              countyHpiData[county]
                                .sort((a, b) => b.observation_year - a.observation_year)[0]
                                ?.hpi_index.toFixed(2) || 'N/A'
                            }
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex justify-end">
                      <button
                        onClick={() => setShowHpiImport(county)}
                        className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center space-x-1 text-sm font-medium"
                      >
                        <Upload className="w-4 h-4" />
                        <span>{countyHpiData[county] ? 'Update' : 'Import'} HPI Data</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* HPI Usage Information */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-medium text-blue-800 mb-2">💡 HPI Data Usage</h3>
              <p className="text-sm text-blue-700">
                Housing Price Index data enables time normalization of property values. Import CSV files with 
                observation_date and HPI index columns. This data will be used in job modules to calculate 
                time-adjusted values using the formula: <code className="bg-blue-100 px-1 rounded">
                Historical Sale × (Current HPI / Historical HPI) = Time-Normalized Value</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Manager Assignments Tab */}
      {activeTab === 'manager-assignments' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-lg border-2 border-teal-200 p-6">
            <div className="flex items-center mb-6">
              <Users className="w-8 h-8 mr-3 text-teal-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Manager Assignments & Workload</h2>
                <p className="text-gray-600 mt-1">
                  Track manager assignments, job counts, and completion rates across all active projects
                </p>
              </div>
            </div>

            {/* Manager Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {managers.length === 0 ? (
                <div className="col-span-full text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">👥</div>
                  <h4 className="text-lg font-medium mb-2">No Managers Found</h4>
                  <p className="text-sm">Add managers to track workload assignments</p>
                </div>
              ) : (
                managers.map(manager => {
                  const workload = getManagerWorkload(manager);
                  
                  return (
                    <div key={manager.id} className="p-6 bg-white rounded-lg border shadow-md hover:shadow-lg transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-12 h-12 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-lg font-bold">
                            {`${manager.first_name || ''} ${manager.last_name || ''}`.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <h4 className="text-lg font-bold text-gray-900">
                              {manager.first_name} {manager.last_name}
                            </h4>
                            <p className="text-sm text-gray-600">
                              As of: {new Date().toLocaleDateString()}
                            </p>
                            {manager.can_be_lead && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-medium">
                                Lead Manager
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Workload Stats */}
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-center">
                          <div className="p-3 bg-teal-50 rounded-lg">
                            <div className="text-2xl font-bold text-teal-600">{workload.jobCount}</div>
                            <div className="text-xs text-teal-700">Active Jobs</div>
                          </div>
                          <div className="p-3 bg-blue-50 rounded-lg">
                            <div className="text-2xl font-bold text-blue-600">
                              {workload.totalProperties.toLocaleString()}
                            </div>
                            <div className="text-xs text-blue-700">Total Properties</div>
                          </div>
                        </div>

                        {/* Completion Progress */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Completion Rate</span>
                            <span className="font-medium text-gray-900">{workload.completionRate}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-teal-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${workload.completionRate}%` }}
                            ></div>
                          </div>
                          <div className="text-xs text-gray-500">
                            {workload.completedProperties.toLocaleString()} of {workload.totalProperties.toLocaleString()} properties completed
                          </div>
                        </div>

                        {/* Assigned Jobs List */}
                        {workload.jobs.length > 0 && (
                          <div className="space-y-2">
                            <h5 className="text-sm font-medium text-gray-700">Assigned Jobs:</h5>
                            <div className="space-y-1">
                              {workload.jobs.slice(0, 3).map(job => (
                                <div key={job.id} className="flex justify-between items-center p-2 bg-gray-50 rounded text-xs">
                                  <span className="font-medium text-gray-900">{job.name}</span>
                                  <span className="text-gray-600">
                                    {job.assignedManagers?.find(am => am.id === manager.id)?.role || 'Manager'}
                                  </span>
                                </div>
                              ))}
                              {workload.jobs.length > 3 && (
                                <div className="text-xs text-gray-500 text-center py-1">
                                  +{workload.jobs.length - 3} more jobs
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {workload.jobCount === 0 && (
                          <div className="text-center text-gray-500 py-4">
                            <div className="text-2xl mb-2">📝</div>
                            <p className="text-sm">No active job assignments</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Summary Stats */}
            {managers.length > 0 && (
              <div className="mt-8 p-4 bg-teal-50 border border-teal-200 rounded-lg">
                <h3 className="font-medium text-teal-800 mb-3">📊 Team Overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-lg font-bold text-teal-600">{managers.length}</div>
                    <div className="text-xs text-teal-700">Total Managers</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-blue-600">
                      {managers.reduce((sum, m) => sum + getManagerWorkload(m).jobCount, 0)}
                    </div>
                    <div className="text-xs text-blue-700">Job Assignments</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-green-600">
                      {managers.reduce((sum, m) => sum + getManagerWorkload(m).totalProperties, 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-green-700">Properties Managed</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-purple-600">
                      {managers.length > 0 ? Math.round(
                        managers.reduce((sum, m) => sum + getManagerWorkload(m).completionRate, 0) / managers.length
                      ) : 0}%
                    </div>
                    <div className="text-xs text-purple-700">Avg Completion</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminJobManagement;
