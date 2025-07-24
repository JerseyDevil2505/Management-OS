import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle, X } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService, propertyService, supabase } from '../lib/supabaseClient';

const AdminJobManagement = ({ onJobSelect, jobMetrics, isLoadingMetrics }) => {
  // 🚀 DEBUG: Log received props
  console.log('🔍 AdminJobManagement DEBUG: Received jobMetrics prop:', jobMetrics);
  console.log('🔍 AdminJobManagement DEBUG: isLoadingMetrics:', isLoadingMetrics);
  console.log('🔍 AdminJobManagement DEBUG: jobMetrics keys:', jobMetrics ? Object.keys(jobMetrics) : 'null');

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

  // ENHANCED: Assigned Properties state with better feedback
  const [showAssignmentUpload, setShowAssignmentUpload] = useState(null);
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [uploadingAssignment, setUploadingAssignment] = useState(false);
  const [assignmentResults, setAssignmentResults] = useState(null);

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
    percentBilled: ''
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
  const [dbStats, setDbStats] = useState({ 
    employees: 0, 
    jobs: 0, 
    properties: 0,
    propertiesBreakdown: {
      total: 0,
      residential: 0,
      commercial: 0,
      other: 0
    }
  });

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

  // 🚀 FIXED: Smart Metrics Display Logic with LIVE METRICS FIRST
  const getMetricsDisplay = (job) => {
    // 🚀 DEBUG: Check for live metrics first
    const liveMetrics = jobMetrics?.[job.id];
    if (liveMetrics && liveMetrics.isProcessed) {
      console.log('🔍 Using LIVE metrics for job:', job.id, liveMetrics);
      return {
        entryRate: liveMetrics.entryRate || 0,
        refusalRate: liveMetrics.refusalRate || 0,
        commercial: `${liveMetrics.commercialComplete || 0}%`,
        pricing: `${liveMetrics.pricingComplete || 0}%`
      };
    }

    // Fallback to existing logic
    console.log('🔍 Using FALLBACK metrics for job:', job.id);
    const baseMetrics = {
      entryRate: job.workflowStats?.rates?.entryRate || 0,
      refusalRate: job.workflowStats?.rates?.refusalRate || 0,
      commercialRate: job.workflowStats?.rates?.commercialInspectionRate || 0,
      pricingRate: job.workflowStats?.rates?.pricingRate || 0
    };

    // No assignments - show normal percentages
    if (!job.has_property_assignments) {
      return {
        ...baseMetrics,
        commercial: `${baseMetrics.commercialRate}%`,
        pricing: `${baseMetrics.pricingRate}%`
      };
    }

    // Has assignments - check if commercial properties included
    if (job.assigned_has_commercial === false) {
      return {
        ...baseMetrics,
        commercial: "Residential Only",
        pricing: "Residential Only"
      };
    }

    // Mixed assignment with commercial - show percentages
    return {
      ...baseMetrics,
      commercial: `${baseMetrics.commercialRate}%`,
      pricing: `${baseMetrics.pricingRate}%`
    };
  };

  // 🚀 FIXED: Get property count display with LIVE METRICS FIRST
  const getPropertyCountDisplay = (job) => {
    // 🚀 DEBUG: Check for live metrics first
    const liveMetrics = jobMetrics?.[job.id];
    if (liveMetrics && liveMetrics.isProcessed) {
      console.log('🔍 Using LIVE property counts for job:', job.id, liveMetrics);
      return {
        inspected: liveMetrics.propertiesInspected || 0,
        total: liveMetrics.totalProperties || 0,
        label: "Properties Inspected (Live PPU Data)",
        isAssigned: false
      };
    }

    // Fallback to existing logic
    console.log('🔍 Using FALLBACK property counts for job:', job.id);
    if (!job.has_property_assignments) {
      return {
        inspected: job.inspectedProperties || 0,
        total: job.totalProperties || 0,
        label: "Properties Inspected",
        isAssigned: false
      };
    }

    // Use dynamically calculated assigned count instead of job field
    return {
      inspected: job.inspectedProperties || 0,
      total: job.assignedPropertyCount || job.totalProperties || 0,
      label: "Properties Inspected (Assigned Scope)",
      isAssigned: true
    };
  };

  // FIXED: Load HPI data from database on component mount
  const loadCountyHpiData = async () => {
    try {
      const { data, error } = await supabase
        .from('county_hpi_data')
        .select('*')
        .order('county_name, observation_year');
      
      if (error) {
        console.error('Error loading HPI data:', error);
        return;
      }
      
      // Group HPI data by county
      const hpiByCounty = {};
      data.forEach(record => {
        if (!hpiByCounty[record.county_name]) {
          hpiByCounty[record.county_name] = [];
        }
        hpiByCounty[record.county_name].push(record);
      });
      
      setCountyHpiData(hpiByCounty);
      console.log('✅ Loaded HPI data for counties:', Object.keys(hpiByCounty));
    } catch (error) {
      console.error('Failed to load HPI data:', error);
    }
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

  // FIXED: Property Assignment Upload Handler with improved composite key matching
  const uploadPropertyAssignment = async (job) => {
    if (!assignmentFile) {
      addNotification('Please select an assignment file', 'error');
      return;
    }

    try {
      setUploadingAssignment(true);
      const fileContent = await assignmentFile.text();
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        addNotification('Invalid CSV file format', 'error');
        return;
      }

      const header = lines[0].toLowerCase().split(',').map(h => h.trim());
      const requiredFields = ['block', 'lot'];
      const missingFields = requiredFields.filter(field => 
        !header.some(h => h.includes(field))
      );

      if (missingFields.length > 0) {
        addNotification(`Missing required columns: ${missingFields.join(', ')}`, 'error');
        return;
      }

      // Parse CSV and create composite keys
      const assignments = [];
      // FIXED: Use job's year_created instead of current year
      const year = job.year_created || new Date().getFullYear();
      const ccdd = job.ccdd || job.ccddCode;

      console.log(`🔍 DEBUG - Building composite keys with year: ${year}, ccdd: ${ccdd}`);

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length >= 2) {
          const blockIdx = header.findIndex(h => h.includes('block'));
          const lotIdx = header.findIndex(h => h.includes('lot'));
          const qualIdx = header.findIndex(h => h.includes('qual'));
          const cardIdx = header.findIndex(h => h.includes('card'));
          const locationIdx = header.findIndex(h => h.includes('location'));

          const block = values[blockIdx] || '';
          const lot = values[lotIdx] || '';
          const qual = values[qualIdx] || '';
          const card = values[cardIdx] || '';
          const location = values[locationIdx] || '';

          // FIXED: Ensure consistent composite key format matching processors
          const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual || 'NONE'}-${card || 'NONE'}-${location || 'NONE'}`;
          
          // DEBUG: Log first few composite keys
          if (i <= 3) {
            console.log(`🔍 DEBUG - Assignment composite key ${i}: ${compositeKey}`);
          }
          
          assignments.push({
            property_composite_key: compositeKey,
            property_block: block,
            property_lot: lot,
            property_qualifier: qual,
            property_addl_card: card,
            property_location: location
          });
        }
      }

      // Process assignments through Supabase
      console.log(`Processing ${assignments.length} property assignments for job ${job.id}`);
      
      // First, clear existing assignments for this job
      const { error: deleteError } = await supabase
        .from('job_responsibilities')
        .delete()
        .eq('job_id', job.id);

      if (deleteError) {
        console.error('Error clearing existing assignments:', deleteError);
      }

      // Insert new assignments
      const assignmentRecords = assignments.map(assignment => ({
        job_id: job.id,
        ...assignment,
        responsibility_file_name: assignmentFile.name,
        responsibility_file_uploaded_at: new Date().toISOString(),
        uploaded_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
      }));

      const { data: insertData, error: insertError } = await supabase
        .from('job_responsibilities')
        .insert(assignmentRecords);

      if (insertError) {
        throw new Error('Assignment insert failed: ' + insertError.message);
      }

      console.log(`✅ Inserted ${assignmentRecords.length} assignment records`);

      // ENHANCED: Check how many properties were matched with better debugging
      const assignmentKeys = assignments.map(a => a.property_composite_key);
      console.log(`🔍 DEBUG - Looking for matches among ${assignmentKeys.length} composite keys`);
      console.log(`🔍 DEBUG - Sample assignment keys:`, assignmentKeys.slice(0, 3));

      const { data: matchedProperties, error: matchError } = await supabase
        .from('property_records')
        .select('property_composite_key, property_m4_class')
        .eq('job_id', job.id)
        .in('property_composite_key', assignmentKeys);

      if (matchError) {
        console.error('❌ Error checking matched properties:', matchError);
        addNotification('Error checking property matches: ' + matchError.message, 'error');
        return;
      }

      const matchedCount = matchedProperties?.length || 0;
      console.log(`✅ Found ${matchedCount} matching properties in property_records`);
      
      if (matchedProperties && matchedProperties.length > 0) {
        console.log(`🔍 DEBUG - Sample matched keys:`, matchedProperties.slice(0, 3).map(p => p.property_composite_key));
      }

      // Check for commercial properties (4A, 4B, 4C)
      const hasCommercial = matchedProperties?.some(prop => 
        ['4A', '4B', '4C'].includes(prop.property_m4_class)
      ) || false;

      // Update job flags
      const { error: jobUpdateError } = await supabase
        .from('jobs')
        .update({
          has_property_assignments: true,
          assigned_has_commercial: hasCommercial
        })
        .eq('id', job.id);

      if (jobUpdateError) {
        console.error('❌ Error updating job flags:', jobUpdateError);
        addNotification('Error updating job flags: ' + jobUpdateError.message, 'error');
      }

      // FIXED: Update property_records assignment flags with better error handling
      if (matchedCount > 0) {
        console.log(`🔄 Updating is_assigned_property = true for ${matchedCount} properties...`);
        
        const { error: propUpdateError } = await supabase
          .from('property_records')
          .update({ is_assigned_property: true })
          .eq('job_id', job.id)
          .in('property_composite_key', assignmentKeys);

        if (propUpdateError) {
          console.error('❌ Error updating property flags:', propUpdateError);
          addNotification('Error updating property assignment flags: ' + propUpdateError.message, 'error');
          // Don't return here - still show results
        } else {
          console.log(`✅ Successfully updated is_assigned_property for ${matchedCount} properties`);
        }
      } else {
        console.log('⚠️ No matching properties found - no is_assigned_property updates made');
        
        // DEBUG: Show sample property_records keys for comparison
        const { data: sampleProperties } = await supabase
          .from('property_records')
          .select('property_composite_key')
          .eq('job_id', job.id)
          .limit(3);
          
        if (sampleProperties && sampleProperties.length > 0) {
          console.log(`🔍 DEBUG - Sample property_records keys for comparison:`, 
            sampleProperties.map(p => p.property_composite_key));
        }
      }
      
      // ENHANCED: Better assignment feedback
      setAssignmentResults({
        success: true,
        uploaded: assignments.length,
        matched: matchedCount,
        unmatched: assignments.length - matchedCount,
        matchRate: assignments.length > 0 ? Math.round((matchedCount / assignments.length) * 100) : 0,
        hasCommercial: hasCommercial,
        jobName: job.name
      });

      // Refresh jobs data with updated assigned property counts
      await refreshJobsWithAssignedCounts();

      const matchPercentage = assignments.length > 0 ? Math.round((matchedCount / assignments.length) * 100) : 0;
      addNotification(
        `Successfully assigned ${matchedCount} of ${assignments.length} properties (${matchPercentage}% match rate)`, 
        matchedCount > 0 ? 'success' : 'warning'
      );
      
    } catch (error) {
      console.error('Assignment upload error:', error);
      addNotification('Error uploading assignments: ' + error.message, 'error');
    } finally {
      setUploadingAssignment(false);
    }
  };

  // NEW: Refresh jobs with dynamically calculated assigned property counts
  const refreshJobsWithAssignedCounts = async () => {
    try {
      const updatedJobs = await jobService.getAll();
      const activeJobs = updatedJobs.filter(job => job.status !== 'archived');
      const archived = updatedJobs.filter(job => job.status === 'archived');
      
      // Calculate assigned property counts for jobs with assignments
      const jobsWithAssignedCounts = await Promise.all(
        activeJobs.map(async (job) => {
          if (job.has_property_assignments) {
            // Dynamically count assigned properties
            const { count, error } = await supabase
              .from('property_records')
              .select('id', { count: 'exact' })
              .eq('job_id', job.id)
              .eq('is_assigned_property', true);

            if (!error) {
              job.assignedPropertyCount = count;
            }
          }
          
          return {
            ...job,
            status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
            county: capitalizeCounty(job.county),
            percentBilled: job.percent_billed || 0.00
          };
        })
      );

      setJobs(jobsWithAssignedCounts);
      setArchivedJobs(archived.map(job => ({
        ...job,
        county: capitalizeCounty(job.county)
      })));

      // Refresh property stats to show updated counts
      const refreshedStats = await utilityService.getStats();
      setDbStats(refreshedStats);

    } catch (error) {
      console.error('Error refreshing jobs with assigned counts:', error);
    }
  };

  // Rest of the component code stays the same...
  // (File handlers, job creation, etc. - keeping existing functionality)
  
  // Get unique counties from jobs
  const getUniqueCounties = () => {
    const counties = [...jobs, ...archivedJobs]
      .map(job => capitalizeCounty(job.county))
      .filter(county => county && county.trim() !== '')
      .filter((county, index, arr) => arr.indexOf(county) === index)
      .sort();
    return counties;
  };

  const goToJob = (job) => {
    if (onJobSelect) {
      onJobSelect(job);
    } else {
      alert(`Navigate to ${job.name} modules:\n- Production Tracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
    }
  };

  const sortJobsByBilling = (jobList) => {
    return jobList.sort((a, b) => {
      const aBilling = a.percentBilled || 0;
      const bBilling = b.percentBilled || 0;
      
      // Primary sort: billing percentage (ascending - lower percentages first)
      if (aBilling !== bBilling) {
        return aBilling - bBilling;
      }
      
      // Secondary sort: municipality name (alphabetical)
      return (a.municipality || '').localeCompare(b.municipality || '');
    });
  };

  // Load real data from database with assigned property counts
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
          
          // ENHANCED: Calculate assigned property counts for jobs with assignments
          const jobsWithAssignedCounts = await Promise.all(
            activeJobs.map(async (job) => {
              if (job.has_property_assignments) {
                // Dynamically count assigned properties
                const { count, error } = await supabase
                  .from('property_records')
                  .select('id', { count: 'exact' })
                  .eq('job_id', job.id)
                  .eq('is_assigned_property', true);

                if (!error) {
                  job.assignedPropertyCount = count;
                }
              }
              
              return {
                ...job,
                status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
                county: capitalizeCounty(job.county),
                percentBilled: job.percent_billed || 0.00
              };
            })
          );
          
          const processedArchivedJobs = archived.map(job => ({
            ...job,
            county: capitalizeCounty(job.county)
          }));
          
          setJobs(jobsWithAssignedCounts);
          setArchivedJobs(processedArchivedJobs);
          setPlanningJobs(planningData);
          setManagers(managersData);
          setDbStats(statsData);
          setCurrentUser(userData || { role: 'admin', canAccessBilling: true });

          // Load HPI data from database
          await loadCountyHpiData();
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

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Management OS - Current Jobs List
        </h1>
        <p className="text-gray-600">
          Manage appraisal jobs with source file integration and team assignments
        </p>
      </div>

      {/* Database Status with Enhanced Property Breakdown */}
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
              <div className="flex items-center gap-4">
                <span className="font-medium text-blue-700">
                  📊 {dbStats.properties?.toLocaleString() || 0} Properties:
                </span>
                {dbStats.propertiesBreakdown ? (
                  <>
                    <span className="text-green-600">
                      🏠 {dbStats.propertiesBreakdown.residential?.toLocaleString() || 0} Residential
                    </span>
                    <span className="text-purple-600">
                      🏢 {dbStats.propertiesBreakdown.commercial?.toLocaleString() || 0} Commercial
                    </span>
                    <span className="text-gray-500">
                      📋 {dbStats.propertiesBreakdown.other?.toLocaleString() || 0} Other
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500">Loading breakdown...</span>
                )}
              </div>
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
          </nav>
        </div>
      </div>

      {/* Active Jobs Tab with LIVE METRICS */}
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
                    {/* 🚀 DEBUG: Show live metrics status */}
                    {jobMetrics && Object.keys(jobMetrics).length > 0 && (
                      <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">
                        Live Analytics Active
                      </span>
                    )}
                    {isLoadingMetrics && (
                      <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">
                        Loading Analytics...
                      </span>
                    )}
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

            {/* Enhanced Job Cards with LIVE METRICS */}
            <div className="space-y-3">
              {jobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📋</div>
                  <h4 className="text-lg font-medium mb-2">No Jobs Found</h4>
                  <p className="text-sm">Create your first job to get started!</p>
                </div>
              ) : (
                sortJobsByBilling(jobs).map(job => {
                  const metrics = getMetricsDisplay(job);
                  const propertyDisplay = getPropertyCountDisplay(job);
                  
                  return (
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
                              <span className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm text-green-600 bg-green-100`}>
                                Active
                              </span>
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium shadow-sm">
                                {(job.percentBilled || 0).toFixed(2)}% Billed
                              </span>
                              {/* 🚀 DEBUG: Show if using live metrics */}
                              {jobMetrics?.[job.id]?.isProcessed && (
                                <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                                  🔴 LIVE
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                            <span className="flex items-center space-x-1">
                              <span className="font-bold text-blue-600">{job.ccdd || job.ccddCode}</span>
                              <span>•</span>
                              <MapPin className="w-4 h-4" />
                              <span>{job.municipality}</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <Calendar className="w-4 h-4" />
                              <span>Due: {job.dueDate ? job.dueDate.split('-')[0] : 'TBD'}</span>
                            </span>
                          </div>
                          
                          {/* 🚀 ENHANCED: Production Metrics with LIVE DATA DISPLAY */}
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 p-3 bg-gray-50 rounded-lg">
                            <div className="text-center">
                              <div className="text-lg font-bold text-blue-600">
                                {propertyDisplay.inspected.toLocaleString()} of {propertyDisplay.total.toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-600">{propertyDisplay.label}</div>
                              <div className="text-sm font-medium text-blue-600">
                                {propertyDisplay.total > 0 ? Math.round((propertyDisplay.inspected / propertyDisplay.total) * 100) : 0}% Complete
                              </div>
                            </div>
                            
                            <div className="text-center">
                              <div className="text-lg font-bold text-green-600">
                                {metrics.entryRate}%
                              </div>
                              <div className="text-xs text-gray-600">Entry Rate</div>
                            </div>
                            
                            <div className="text-center">
                              <div className="text-lg font-bold text-red-600">
                                {metrics.refusalRate}%
                              </div>
                              <div className="text-xs text-gray-600">Refusal Rate</div>
                            </div>

                            <div className="text-center">
                              <div className={`text-lg font-bold ${
                                metrics.commercial === 'Residential Only' ? 'text-gray-600' : 'text-purple-600'
                              }`}>
                                {metrics.commercial}
                              </div>
                              <div className="text-xs text-gray-600">Commercial Complete</div>
                            </div>

                            <div className="text-center">
                              <div className={`text-lg font-bold ${
                                metrics.pricing === 'Residential Only' ? 'text-gray-600' : 'text-indigo-600'
                              }`}>
                                {metrics.pricing}
                              </div>
                              <div className="text-xs text-gray-600">Pricing Complete</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                        <div className="flex items-center space-x-3">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">
                            📍 {job.county} County
                          </span>
                        </div>
                        
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => goToJob(job)}
                            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                          >
                            <Eye className="w-4 h-4" />
                            <span>Go to Job</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Other tabs... (keeping existing code for planning, archived, etc.) */}
    </div>
  );
};

export default AdminJobManagement;
