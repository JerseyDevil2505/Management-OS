import React, { useState, useEffect } from 'react';
import { Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye, DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle, X } from 'lucide-react';
import { employeeService, jobService, planningJobService, utilityService, authService, propertyService, supabase } from '../lib/supabaseClient';

const AdminJobManagement = ({ onJobSelect, jobMetrics, isLoadingMetrics }) => {
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
    properties: 0
  });

  // ENHANCED: Calculate properties breakdown from jobMetrics instead of slow DB queries
  const calculatePropertiesBreakdown = () => {
    if (!jobMetrics || isLoadingMetrics) {
      return {
        total: 0,
        residential: 0,
        commercial: 0,
        other: 0
      };
    }

    let totalProperties = 0;
    let residentialProperties = 0;
    let commercialProperties = 0;
    let otherProperties = 0;

    // Aggregate from all job metrics
    Object.values(jobMetrics).forEach(metrics => {
      if (metrics.isProcessed && metrics.totalProperties) {
        totalProperties += metrics.totalProperties;
        
        // Calculate residential (Class 2, 3A) from job workflow stats
        const residential = (metrics.classBreakdown?.['2']?.total || 0) + 
                           (metrics.classBreakdown?.['3A']?.total || 0);
        residentialProperties += residential;
        
        // Calculate commercial (Class 4A, 4B, 4C) from job workflow stats  
        const commercial = (metrics.classBreakdown?.['4A']?.total || 0) + 
                          (metrics.classBreakdown?.['4B']?.total || 0) + 
                          (metrics.classBreakdown?.['4C']?.total || 0);
        commercialProperties += commercial;
        
        // Everything else is "other"
        otherProperties += (metrics.totalProperties - residential - commercial);
      }
    });

    return {
      total: totalProperties,
      residential: residentialProperties,
      commercial: commercialProperties,
      other: otherProperties
    };
  };

  const propertiesBreakdown = calculatePropertiesBreakdown();

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

  // ENHANCED: Smart Metrics Display Logic with better assignment handling
  const getMetricsDisplay = (job) => {
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

  // FIXED: Get property count display with dynamic assigned count calculation
  const getPropertyCountDisplay = (job) => {
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

      // Update employee count only (properties calculated from jobMetrics)
      const { data: employeeData } = await supabase.from('employees').select('id', { count: 'exact' });
      const employeeCount = employeeData?.length || 0;
      setDbStats(prev => ({ 
        ...prev, 
        employees: employeeCount,
        jobs: jobsWithAssignedCounts.length + archived.length
      }));

    } catch (error) {
      console.error('Error refreshing jobs with assigned counts:', error);
    }
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
      
      // Update local state - FIXED: Now persists data
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

  // Load real data from database with assigned property counts
  useEffect(() => {
    const initializeData = async () => {
      try {
        setLoading(true);
        
        const connectionTest = await utilityService.testConnection();
        setDbConnected(connectionTest.success);
        
        if (connectionTest.success) {
          const [jobsData, planningData, managersData, userData] = await Promise.all([
            jobService.getAll(),
            planningJobService.getAll(),
            employeeService.getManagers(),
            authService.getCurrentUser()
          ]);
          
          // Get employee count for banner
          const { data: employeeData } = await supabase.from('employees').select('id', { count: 'exact' });
          const employeeCount = employeeData?.length || 0;
          
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
          setDbStats({ 
            employees: employeeCount, 
            jobs: jobsData.length, 
            properties: 0 // Will be calculated from jobMetrics
          });
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
        year_created: new Date().getFullYear(),
        assignedManagers: newJob.assignedManagers,
        totalProperties: fileAnalysis.propertyCount,
        inspectedProperties: 0,
        status: 'active',
        sourceFileStatus: 'processing',
        codeFileStatus: 'current',
        vendorDetection: { vendor: newJob.vendor },
        percent_billed: newJob.percentBilled,
        source_file_version: 1,
        code_file_version: 1,
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
        
        // Refresh with assigned property counts
        await refreshJobsWithAssignedCounts();
        
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
        end_date: newPlanningJob.dueDate,
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
      
      // Refresh with assigned property counts
      await refreshJobsWithAssignedCounts();
      
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
        end_date: newPlanningJob.dueDate,
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
      await refreshJobsWithAssignedCounts();
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
      name: `${planningJob.municipality} ${new Date(planningJob.end_date).getFullYear()}`,
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

  // DEBUG: Add console logs to see what's happening
  console.log('🔍 DEBUG - AdminJobManagement state:', {
    loading,
    jobsCount: jobs.length,
    dbConnected,
    activeTab,
    jobs: jobs.slice(0, 2) // First 2 jobs for debugging
  });

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

      {/* Database Status with Enhanced Property Breakdown - FIXED */}
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
                  📊 {propertiesBreakdown.total?.toLocaleString() || 0} Properties:
                </span>
                {isLoadingMetrics ? (
                  <span className="text-gray-500">Loading breakdown...</span>
                ) : (
                  <>
                    <span className="text-green-600">
                      🏠 {propertiesBreakdown.residential?.toLocaleString() || 0} Residential
                    </span>
                    <span className="text-purple-600">
                      🏢 {propertiesBreakdown.commercial?.toLocaleString() || 0} Commercial
                    </span>
                    <span className="text-gray-500">
                      📋 {propertiesBreakdown.other?.toLocaleString() || 0} Other
                    </span>
                  </>
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
              👥 Manager Assignments ({managers.filter(m => !`${m.first_name} ${m.last_name}`.toLowerCase().includes('tom davis')).length})
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

            {/* Job Cards */}
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
                              <span className="font-bold text-blue-600">{job.ccdd || job.ccddCode}</span>
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
                                {propertyDisplay.inspected.toLocaleString()} of {propertyDisplay.total.toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-600">{propertyDisplay.label}</div>
                              <div className="text-sm font-medium text-blue-600">
                                {propertyDisplay.total > 0 ? Math.round((propertyDisplay.inspected / propertyDisplay.total) * 100) : 0}% Complete
                              </div>
                              {propertyDisplay.isAssigned && (
                                <div className="text-xs text-green-600 mt-1">✅ Assigned Scope ({propertyDisplay.total} properties)</div>
                              )}
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
                          
                          <button
                            onClick={() => setShowAssignmentUpload(job)}
                            className={`px-3 py-2 rounded-lg flex items-center space-x-1 text-sm font-medium transition-all ${
                              job.has_property_assignments
                                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {job.has_property_assignments ? (
                              <>
                                <CheckCircle className="w-4 h-4" />
                                <span>✅ {job.assignedPropertyCount || 0} Assigned</span>
                              </>
                            ) : (
                              <>
                                <Target className="w-4 h-4" />
                                <span>🎯 Assign Properties</span>
                              </>
                            )}
                          </button>
                        </div>
                        
                        <div className="flex space-x-2">
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
                                ccddCode: job.ccdd || job.ccddCode,
                                municipality: job.municipality,
                                county: job.county,
                                state: job.state,
                                dueDate: job.dueDate,
                                assignedManagers: job.assignedManagers || [],
                                sourceFile: null,
                                codeFile: null,
                                vendor: job.vendor,
                                vendorDetection: job.vendorDetection,
                                percentBilled: job.percent_billed || ''
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
