import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle, X } from 'lucide-react';

// Mock Supabase client for testing
const supabase = {
  from: (table) => ({
    delete: () => ({
      eq: () => ({ error: null })
    }),
    insert: (data) => ({ data, error: null })
  })
};

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

  // County HPI import handler - Fixed for Supabase integration
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

      // FIXED: Real Supabase database integration
      // Delete existing records for this county first
      const { error: deleteError } = await supabase
        .from('county_hpi_data')
        .delete()
        .eq('county_name', county);

      if (deleteError) {
        throw new Error('Failed to clear existing HPI data: ' + deleteError.message);
      }

      // Insert new HPI records
      const { data, error: insertError } = await supabase
        .from('county_hpi_data')
        .insert(hpiRecords);

      if (insertError) {
        throw new Error('Failed to insert HPI data: ' + insertError.message);
      }
      
      // Update local state
      setCountyHpiData(prev => ({
        ...prev,
        [county]: hpiRecords
      }));

      addNotification(`Successfully imported ${hpiRecords.length} HPI records for ${county} County to database`, 'success');
      setShowHpiImport(null);
      setHpiFile(null);
      
    } catch (error) {
      console.error('HPI import error:', error);
      addNotification('Error importing HPI data: ' + error.message, 'error');
    } finally {
      setImportingHpi(false);
    }
  };

  // Load mock data for testing
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);
        
        // Simulate database connection
        setDbConnected(true);
        
        // Sample data
        const sampleManagers = [
          { id: 1, first_name: 'John', last_name: 'Smith', can_be_lead: true },
          { id: 2, first_name: 'Jane', last_name: 'Doe', can_be_lead: true },
          { id: 3, first_name: 'Mike', last_name: 'Johnson', can_be_lead: false }
        ];

        const sampleJobs = [
          {
            id: 1,
            name: 'Middletown Township 2025',
            ccddCode: '1306',
            municipality: 'Middletown Township',
            county: 'Monmouth',
            state: 'NJ',
            dueDate: '2025-12-31',
            vendor: 'Microsystems',
            status: 'active',
            totalProperties: 15420,
            inspectedProperties: 8230,
            percent_billed: 45.50,
            assignedManagers: [
              { id: 1, name: 'John Smith', role: 'Lead Manager' }
            ],
            workflowStats: {
              rates: { entryRate: 85, refusalRate: 12, pricingRate: 78, commercialInspectionRate: 92 }
            }
          },
          {
            id: 2,
            name: 'Howell Township 2025',
            ccddCode: '1308',
            municipality: 'Howell Township',
            county: 'Monmouth',
            state: 'NJ',
            dueDate: '2025-11-30',
            vendor: 'BRT',
            status: 'Active',
            totalProperties: 9850,
            inspectedProperties: 2340,
            percent_billed: 25.75,
            assignedManagers: [
              { id: 2, name: 'Jane Doe', role: 'Lead Manager' }
            ],
            workflowStats: {
              rates: { entryRate: 92, refusalRate: 8, pricingRate: 65, commercialInspectionRate: 88 }
            }
          }
        ];

        const samplePlanningJobs = [
          {
            id: 1,
            ccdd: '1310',
            municipality: 'Ocean Township',
            potentialYear: 2026,
            comments: 'Potential reval for 2026'
          }
        ];

        // Process jobs with fixed status capitalization and percent_billed mapping
        const processedJobs = sampleJobs.map(job => ({
          ...job,
          status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
          county: capitalizeCounty(job.county),
          percentBilled: job.percent_billed || 0.00
        }));

        setJobs(processedJobs);
        setArchivedJobs([]);
        setPlanningJobs(samplePlanningJobs);
        setManagers(sampleManagers);
        setDbStats({ employees: 3, jobs: 2, propertyRecords: 25270, sourceFiles: 2 });
        
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
        count = lines.length - 1;
      } else if (file.name.endsWith('.csv')) {
        vendor = 'BRT';
        count = lines.length - 1;
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

  const createJob = async () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || 
        newJob.assignedManagers.length === 0 || !newJob.sourceFile || !newJob.codeFile) {
      addNotification('Please fill all required fields, upload both files, and assign at least one manager', 'error');
      return;
    }

    try {
      setShowCreateJob(false);
      setShowProcessingModal(true);
      setProcessing(true);
      
      setProcessingStatus({
        isProcessing: true,
        currentStep: 'Creating job...',
        progress: 50,
        startTime: new Date(),
        recordsProcessed: 0,
        totalRecords: fileAnalysis.propertyCount,
        errors: [],
        warnings: [],
        logs: []
      });

      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const newJobData = {
        id: jobs.length + 1,
        name: newJob.name,
        ccddCode: newJob.ccddCode,
        municipality: newJob.municipality,
        county: capitalizeCounty(newJob.county),
        state: newJob.state,
        dueDate: newJob.dueDate,
        vendor: newJob.vendor,
        status: 'Active',
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        percentBilled: newJob.percentBilled,
        assignedManagers: newJob.assignedManagers,
        workflowStats: {
          rates: { entryRate: 0, refusalRate: 0, pricingRate: 0, commercialInspectionRate: 0 }
        }
      };

      setJobs(prev => [...prev, newJobData]);
      
      updateProcessingStatus('Complete!', 100);
      
      setProcessingResults({
        success: true,
        processed: fileAnalysis.propertyCount,
        errors: 0,
        warnings: [],
        jobName: newJob.name,
        vendor: newJob.vendor
      });

      addNotification(`Job created successfully! Processed ${fileAnalysis.propertyCount} properties.`, 'success');
      closeJobModal();
      
    } catch (error) {
      console.error('Job creation error:', error);
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
        id: planningJobs.length + 1,
        ccdd: newPlanningJob.ccddCode,
        municipality: newPlanningJob.municipality,
        potentialYear: new Date(newPlanningJob.dueDate).getFullYear(),
        comments: newPlanningJob.comments || ''
      };

      setPlanningJobs(prev => [...prev, planningData]);
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
      setJobs(prev => prev.map(job => 
        job.id === editingJob.id 
          ? { ...job, name: newJob.name, municipality: newJob.municipality, dueDate: newJob.dueDate, percentBilled: newJob.percentBilled }
          : job
      ));
      
      closeJobModal();
      addNotification('Job updated successfully!', 'success');
    } catch (error) {
      console.error('Job update error:', error);
      addNotification('Error updating job: ' + error.message, 'error');
    }
  };

  const deleteJob = async (job) => {
    try {
      setJobs(prev => prev.filter(j => j.id !== job.id));
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
      ccddCode: planningJob.ccdd,
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
      alert(`Navigate to ${job.name} modules`);
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
              
              {processingResults && (
                <div className="mb-4 p-4 bg-green-50 rounded-lg border-2 border-green-200">
                  <div className="text-lg font-bold text-green-800 mb-3">🎉 Processing Complete!</div>
                  <div className="text-sm text-green-700 space-y-2">
                    <div className="flex justify-between">
                      <span>✅ Properties Processed:</span>
                      <span className="font-bold">{processingResults.processed.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>🏢 Job Created:</span>
                      <span className="font-bold">{processingResults.jobName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>📊 Vendor:</span>
                      <span className="font-bold">{processingResults.vendor}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-center space-x-3">
                {!processingResults && processingStatus.isProcessing && (
                  <button
                    onClick={() => {
                      setShowProcessingModal(false);
                      setProcessing(false);
                      resetProcessingStatus();
                      addNotification('Job creation cancelled', 'warning');
                    }}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium"
                  >
                    🛑 Cancel
                  </button>
                )}

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
                      style={{ 
                        WebkitAppearance: 'none',
                        MozAppearance: 'textfield'
                      }}
                      placeholder="0.00"
                    />
                    <span className="text-sm text-gray-600">%</span>
                  </div>
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

              {/* File Upload Section */}
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
                className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={editingJob ? editJob : createJob}
                disabled={processing}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
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
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteJob(showDeleteConfirm)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
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
                              className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium"
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
                                  percentBilled: job.percentBilled || 0.00
                                });
                                setShowCreateJob(true);
                              }}
                              className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium"
                            >
                              <Edit3 className="w-4 h-4" />
                              <span>Edit</span>
                            </button>
                            <button 
                              onClick={() => setShowDeleteConfirm(job)}
                              className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-1 text-sm font-medium"
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
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminJobManagement;
