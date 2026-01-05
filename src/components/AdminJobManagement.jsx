import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Plus, Edit3, Users, FileText, Calendar, MapPin, Database, Settings, Eye,
  DollarSign, Trash2, CheckCircle, Archive, TrendingUp, Target, AlertTriangle, X, Clock, Download
} from 'lucide-react';
import { supabase, employeeService, jobService, planningJobService, utilityService, authService, propertyService, checklistService } from '../lib/supabaseClient';
import FileUploadButton from './job-modules/FileUploadButton';

// Accept jobMetrics props for live metrics integration
const AdminJobManagement = ({ 
  onJobSelect, 
  jobMetrics, 
  isLoadingMetrics, 
  onJobProcessingComplete,
  jobs: propsJobs,
  planningJobs: propsPlanningJobs,
  archivedJobs: propsArchivedJobs,
  managers: propsManagers,
  countyHpiData: propsCountyHpiData,
  jobResponsibilities: propsJobResponsibilities,
  workflowStats,
  jobFreshness,
  onDataUpdate,
  onRefresh
}) => {
  const [activeTab, setActiveTab] = useState('jobs');
  const [currentUser, setCurrentUser] = useState({ role: 'admin', canAccessBilling: true });
  
  const [jobs, setJobs] = useState(propsJobs || []);
  const [archivedJobs, setArchivedJobs] = useState(propsArchivedJobs || []);
  const [planningJobs, setPlanningJobs] = useState(propsPlanningJobs || []);
  const [managers, setManagers] = useState(propsManagers || []);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showCreatePlanning, setShowCreatePlanning] = useState(false);
  const [showEditPlanning, setShowEditPlanning] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [editingPlanning, setEditingPlanning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(null);
  const [archiveChecklistWarning, setArchiveChecklistWarning] = useState(null);

  // File upload modal state
  const [showFileUploadModal, setShowFileUploadModal] = useState(false);
  const [selectedJobForUpload, setSelectedJobForUpload] = useState(null);

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
  const [countyHpiData, setCountyHpiData] = useState(() => {
    // Convert array to object grouped by county
    const hpiByCounty = {};
    if (propsCountyHpiData) {
      propsCountyHpiData.forEach(record => {
        if (!hpiByCounty[record.county_name]) {
          hpiByCounty[record.county_name] = [];
        }
        hpiByCounty[record.county_name].push(record);
      });
    }
    return hpiByCounty;
  });
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
    percentBilled: '0.00'
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
    employees: propsManagers?.length || 0, 
    jobs: propsJobs?.length || 0, 
    properties: propsJobs?.reduce((sum, job) => sum + (job.totalProperties || 0), 0) || 0,
    propertiesBreakdown: {
      total: propsJobs?.reduce((sum, job) => sum + (job.totalProperties || 0), 0) || 0,
      residential: propsJobs?.reduce((sum, job) => sum + (job.totalresidential || 0), 0) || 0,
      commercial: propsJobs?.reduce((sum, job) => sum + (job.totalcommercial || 0), 0) || 0,
      other: 0
    }
  });;

  // Use refs AFTER all useState hooks
  const isMountedRef = useRef(true);
  const processingTimeoutRef = useRef(null);

  // Cleanup on unmount - MUST come after ALL hooks
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, []);

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

  // Helper function to calculate days since a date
  const getDaysSince = (dateString) => {
    if (!dateString) return 999;
    const date = new Date(dateString);
    const now = new Date();
    
    // Reset times to midnight for accurate day comparison
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const diffTime = Math.abs(nowDay - dateDay);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Helper function to format time ago
  const formatTimeAgo = (dateString) => {
    if (!dateString) return 'Never';
    const days = getDaysSince(dateString);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  // Get update status color based on last update
  const getUpdateStatusColor = (lastUpdate, percentBilled) => {
    // Valuation phase (91%+) always shows blue
    if (percentBilled >= 0.91) return 'bg-blue-100 text-blue-800';
    
    if (!lastUpdate) return 'bg-red-100 text-red-800';
    const daysSince = getDaysSince(lastUpdate);
    if (daysSince <= 3) return 'bg-green-100 text-green-800';
    if (daysSince <= 14) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  // Check if update is needed
  const needsProductionUpdate = (lastProductionRun, lastFileUpload, percentBilled) => {
    // Valuation phase jobs don't "need" updates in the same way
    if (percentBilled >= 0.91) return false;
    
    // If never run, definitely needs update
    if (!lastProductionRun) return true;
    
    // If file upload is newer than production run, needs update
    if (lastFileUpload && new Date(lastFileUpload) > new Date(lastProductionRun)) return true;
    
    // If older than 14 days, needs update
    return getDaysSince(lastProductionRun) > 14;
  };

  // Get jobs needing updates for payroll/billing
  const getJobsNeedingUpdates = () => {
    return jobs.filter(job => {
      // Only inspection phase jobs need regular updates for payroll
      if (job.percentBilled >= 0.91) return false;
      return needsProductionUpdate(job.lastProductionRun, job.lastFileUpload, job.percentBilled);
    });
  };

  // Check if we're in a payroll period (every 2 weeks)
  const isPayrollPeriod = () => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    // Assuming payroll runs on 15th and last day of month
    return (dayOfMonth >= 13 && dayOfMonth <= 15) || dayOfMonth >= 28;
  };

  // FIXED: Enhanced Metrics Display Logic with live metrics first
  const getMetricsDisplay = (job) => {
    // Check for live metrics first
    const liveMetrics = jobMetrics?.[job.id];
    
    // Use live metrics if available
    if (liveMetrics && (liveMetrics.entryRate !== undefined || liveMetrics.totalProperties !== undefined)) {
      return {
        entryRate: liveMetrics.entryRate || 0,
        refusalRate: liveMetrics.refusalRate || 0,
        commercial: `${liveMetrics.commercialComplete || 0}%`,
        pricing: `${liveMetrics.pricingComplete || 0}%`
      };
    }
    
    // Fallback to database metrics
    const baseMetrics = {
      entryRate: job.workflowStats?.jobEntryRate || 0,              // ✅ NEW FORMAT
      refusalRate: job.workflowStats?.jobRefusalRate || 0,          // ✅ NEW FORMAT  
      commercialRate: job.workflowStats?.commercialCompletePercent || 0, // ✅ NEW FORMAT
      pricingRate: job.workflowStats?.pricingCompletePercent || 0   // ✅ NEW FORMAT
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

  // Get property count display with live metrics first
  const getPropertyCountDisplay = (job) => {
    // Check for live metrics first
    const liveMetrics = jobMetrics?.[job.id];
    if (liveMetrics && liveMetrics.totalProperties !== undefined) {
      return {
        inspected: liveMetrics.propertiesInspected || 0,
        total: liveMetrics.totalProperties || 0,
        label: "Properties Inspected",
        isAssigned: false
      };
    }
    
    // Fallback to existing logic
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

  // Property Assignment Upload Handler with improved composite key matching
  const uploadPropertyAssignment = async (job) => {
    if (!assignmentFile) {
      addNotification('Please select an assignment file', 'error');
      return;
    }

    try {
      setUploadingAssignment(true);
      const fileContent = await assignmentFile.text();
      
      // Try to detect the delimiter
      const firstLine = fileContent.split('\n')[0];
      const delimiter = firstLine.includes('\t') ? '\t' : ',';
      
      const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);
      
      if (lines.length < 2) {
        addNotification('Invalid CSV file format', 'error');
        return;
      }

      const header = lines[0].toLowerCase().split(delimiter).map(h => h.trim());
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
      // Use job's year_created instead of current year
      const year = job.year_created || new Date().getFullYear();
      const ccdd = job.ccdd || job.ccddCode;

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(delimiter).map(v => v.trim());
        
        // Must have at least as many values as we have headers
        if (values.length < header.length) {
          continue; // Skip malformed rows
        }
        
        const blockIdx = header.findIndex(h => h.includes('block'));
        const lotIdx = header.findIndex(h => h.includes('lot'));
        const qualIdx = header.findIndex(h => h.includes('qual'));
        const cardIdx = header.findIndex(h => h.includes('card'));
        const locationIdx = header.findIndex(h => h.includes('location'));

        const block = values[blockIdx] || '';
        const lot = values[lotIdx] || '';
        const qual = qualIdx >= 0 ? (values[qualIdx] || '') : '';
        const card = cardIdx >= 0 ? (values[cardIdx] || '') : '';
        const location = locationIdx >= 0 ? (values[locationIdx] || '') : '';

        // Skip empty rows
        if (!block && !lot) continue;
       
        // Ensure consistent composite key format matching processors
        const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual || 'NONE'}-${card || 'NONE'}-${location || 'NONE'}`;
        
        assignments.push({
          property_composite_key: compositeKey,
          property_block: block,
          property_lot: lot,
          property_qualifier: qual,
          property_addl_card: card,
          property_location: location
        });
      }

      // Log the actual count for debugging
      addNotification(`Parsed ${assignments.length} valid assignments from ${lines.length - 1} CSV rows`, 'info');

      // Add notification for large files
      if (assignments.length > 1000) {
        addNotification(`Processing ${assignments.length.toLocaleString()} assignments. This may take a minute...`, 'info');
      }

      // Process assignments through Supabase
      
      // First, clear existing assignments for this job
      try {
        const { error: deleteError } = await supabase
          .from('job_responsibilities')
          .delete()
          .eq('job_id', job.id);

        if (deleteError) {
          throw new Error(`Failed to clear assignments: ${deleteError.message}`);
        }
      } catch (err) {
        addNotification('Network error: Unable to connect to database. Please check your connection.', 'error');
        return;
      }

      // Insert new assignments in batches to handle large files
      const BATCH_SIZE = 500;
      let insertedCount = 0;
      let failedBatches = [];
      
      for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
        const batch = assignments.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(assignments.length / BATCH_SIZE);
        
        const batchRecords = batch.map(assignment => ({
          job_id: job.id,
          ...assignment,
          responsibility_file_name: assignmentFile.name,
          responsibility_file_uploaded_at: new Date().toISOString(),
          uploaded_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
        }));

        try {
          const { data: insertData, error: insertError } = await supabase
            .from('job_responsibilities')
            .insert(batchRecords);

          if (insertError) {
            throw new Error(`Batch ${batchNumber} insert failed: ${insertError.message}`);
          }
          
          insertedCount += batchRecords.length;
          
        // Update UI with progress for large files
        if (assignments.length > 1000 && (batchNumber === 1 || batchNumber % 5 === 0 || batchNumber === totalBatches)) {
          addNotification(`Processing batch ${batchNumber} of ${totalBatches}... (${insertedCount.toLocaleString()} records done)`, 'info');
        }
          
        } catch (err) {
          failedBatches.push({ batch: batchNumber, error: err.message, records: batch.length });
          addNotification(`⚠️ Batch ${batchNumber} failed (${batch.length} records): ${err.message}`, 'warning');
          // Continue with other batches instead of breaking
        }
      }
      
      // Report final status
      if (failedBatches.length > 0) {
        const failedRecords = failedBatches.reduce((sum, fb) => sum + fb.records, 0);
        addNotification(`⚠️ Completed with errors: ${insertedCount} of ${assignments.length} inserted. ${failedRecords} records in ${failedBatches.length} batches failed.`, 'warning');
      } else {
        addNotification(`✅ Successfully inserted all ${insertedCount} assignments`, 'success');
      }

      // Check how many properties were matched (in batches for large datasets)
      const assignmentKeys = assignments.map(a => a.property_composite_key);
      let matchedProperties = [];
      
      // Process in chunks to avoid query size limits
      const QUERY_BATCH_SIZE = 100;
      for (let i = 0; i < assignmentKeys.length; i += QUERY_BATCH_SIZE) {
        const keyBatch = assignmentKeys.slice(i, i + QUERY_BATCH_SIZE);

        const { data: batchMatches, error: matchError } = await supabase
          .from('property_records')
          .select('property_composite_key, property_m4_class')
          .eq('job_id', job.id)
          .in('property_composite_key', keyBatch);

        if (matchError) {
          console.error('❌ Error checking matched properties batch:', matchError);
          addNotification('Error checking property matches: ' + matchError.message, 'error');
          return;
        }

        if (batchMatches) {
          matchedProperties = [...matchedProperties, ...batchMatches];
        }

        // Add timing gap between batches to prevent database overload
        if (i + QUERY_BATCH_SIZE < assignmentKeys.length) {
          console.log(`⏳ Waiting 200ms before next batch to prevent database overload...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      const matchedCount = matchedProperties.length;
      
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
        addNotification('Warning: Job flags may not have updated properly', 'warning');
      }

      // Update property_records assignment flags (in batches)
      if (matchedCount > 0) {
        const matchedKeys = matchedProperties.map(p => p.property_composite_key);
        
        // Update in batches to avoid query limits
        for (let i = 0; i < matchedKeys.length; i += QUERY_BATCH_SIZE) {
          const keyBatch = matchedKeys.slice(i, i + QUERY_BATCH_SIZE);
          
          const { error: propUpdateError } = await supabase
            .from('property_records')
            .update({ is_assigned_property: true })
            .eq('job_id', job.id)
            .in('property_composite_key', keyBatch);

          if (propUpdateError) {
            // Silent fail - don't spam with batch errors
          }
        }
      }
      
      // Get the real count after all updates
      const { count: finalMatchedCount } = await supabase
        .from('property_records')
        .select('id', { count: 'exact' })
        .eq('job_id', job.id)
        .eq('is_assigned_property', true);

      // Set assignment results with real count
      setAssignmentResults({
        success: true,
        uploaded: assignments.length,
        matched: finalMatchedCount || matchedCount,
        unmatched: assignments.length - (finalMatchedCount || matchedCount),
        matchRate: assignments.length > 0 ? Math.round(((finalMatchedCount || matchedCount) / assignments.length) * 100) : 0,
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

// Refresh both jobs and freshness data
  const refreshAllJobData = async () => {
    try {
      // Call parent's refresh
      if (onRefresh) {
        await onRefresh();
      }
      
      // Job freshness now comes from props, no need to load here
    } catch (error) {
      console.error('Error refreshing job data:', error);
    }
  };

  // Refresh jobs with assigned property counts
  const refreshJobsWithAssignedCounts = async () => {
    try {
      // Get updated jobs from parent
      if (onRefresh) {
        await onRefresh();
        return; // Parent will update via props
      }
      
      // Fallback if no parent refresh available
      const { data: updatedJobs, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // NEW - Match the initializeData logic
      const activeJobs = updatedJobs.filter(job => job.status === 'active');
      const archived = updatedJobs.filter(job => job.status === 'archived' || job.status === 'draft');
      
      // Calculate assigned property counts for jobs with assignments
      // Use sequential processing with timing gaps to prevent database overload
      const jobsWithAssignedCounts = [];

      for (let i = 0; i < activeJobs.length; i++) {
        const job = activeJobs[i];

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

          // Add small delay between database queries to prevent overload
          if (i < activeJobs.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        jobsWithAssignedCounts.push({
          ...job,
          status: job.status === 'active' ? 'Active' : (job.status || 'Active'),
          county: capitalizeCounty(job.county),
          percentBilled: job.percent_billed || 0.00
        });
      }

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

  // County HPI import handler
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

// Database integration
      const { data, error } = await supabase
        .from('county_hpi_data')
        .delete()
        .eq('county_name', county);

      // Alert about import HPI error but don't log details

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

  const exportCountyHpi = (county) => {
    const hpiData = countyHpiData[county] || [];

    if (hpiData.length === 0) {
      addNotification('No HPI data to export for this county', 'error');
      return;
    }

    const sortedData = [...hpiData].sort((a, b) => a.observation_year - b.observation_year);
    const mostRecentYear = Math.max(...sortedData.map(d => d.observation_year));
    const baseYearData = sortedData.find(d => d.observation_year === mostRecentYear);
    const baseHPI = baseYearData?.hpi_index || 100;

    const csvRows = [
      ['Year', 'HPI Index', `Multiplier (Base Year: ${mostRecentYear})`].join(',')
    ];

    sortedData.forEach(record => {
      const year = record.observation_year;
      const hpiIndex = record.hpi_index.toFixed(2);
      const multiplier = (baseHPI / record.hpi_index).toFixed(6);

      csvRows.push([year, hpiIndex, multiplier].join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `${county}_County_HPI_Data_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    addNotification(`Successfully exported ${sortedData.length} HPI records for ${county} County`, 'success');
  };

// Update state when props change
  useEffect(() => {
    setJobs(propsJobs || []);
    setArchivedJobs(propsArchivedJobs || []);
    setPlanningJobs(propsPlanningJobs || []);
    setManagers(propsManagers || []);
    
    // Convert county HPI data array to grouped object
    const hpiByCounty = {};
    if (propsCountyHpiData) {
      propsCountyHpiData.forEach(record => {
        if (!hpiByCounty[record.county_name]) {
          hpiByCounty[record.county_name] = [];
        }
        hpiByCounty[record.county_name].push(record);
      });
    }
    setCountyHpiData(hpiByCounty);
    
    // Update database stats
    setDbStats({
      employees: propsManagers?.length || 0,
      jobs: propsJobs?.length || 0,
      properties: propsJobs?.reduce((sum, job) => sum + (job.totalProperties || 0), 0) || 0,
      propertiesBreakdown: {
        total: propsJobs?.reduce((sum, job) => sum + (job.totalProperties || 0), 0) || 0,
        residential: propsJobs?.reduce((sum, job) => sum + (job.totalresidential || 0), 0) || 0,
        commercial: propsJobs?.reduce((sum, job) => sum + (job.totalcommercial || 0), 0) || 0,
        other: 0
      }
    });   
    
    setLoading(false);
  }, [propsJobs, propsArchivedJobs, propsPlanningJobs, propsManagers, propsCountyHpiData]);

  // File analysis
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

  // Create job with real-time batch processing logs
  const createJob = async () => {
    if (!newJob.ccddCode || !newJob.name || !newJob.municipality || !newJob.dueDate || 
        newJob.assignedManagers.length === 0 || !newJob.sourceFile || !newJob.codeFile) {
      addNotification('Please fill all required fields, upload both files, and assign at least one manager', 'error');
      return;
    }

    // Prevent duplicate submissions
    if (processing) {
      return;
    }

    try {
      // Close create job modal first
      setShowCreateJob(false);
      
      // Show processing modal
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
      await new Promise(resolve => {
        processingTimeoutRef.current = setTimeout(resolve, 200);
      });
      
      if (!isMountedRef.current) return;
      
      // Start processing
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
        status: 'active',
        sourceFileStatus: 'processing',
        codeFileStatus: 'current',
        vendorDetection: { vendor: newJob.vendor },
        percent_billed: parseFloat(newJob.percentBilled) || 0,
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
      let result = null;
      
      if (!isMountedRef.current) return;
      
      updateProcessingStatus('Job created successfully. Reading files...', 25);
      
      if (newJob.sourceFile && newJob.codeFile) {
        updateProcessingStatus('Reading source file...', 35);
        const sourceFileContent = await newJob.sourceFile.text();
        
        updateProcessingStatus('Reading code file...', 40);
        const codeFileContent = await newJob.codeFile.text();
        
        updateProcessingStatus(`Processing ${newJob.vendor} data (${fileAnalysis.propertyCount} records)...`, 50);
        
        // Capture console logs during processing (but don't update state constantly)
        const originalConsoleLog = console.log;
        const logs = [];
        
        console.log = (...args) => {
          const message = args.join(' ');
          // Just capture logs, don't update state
          if (message.includes('✅') || message.includes('Batch inserting') || message.includes('Processing')) {
            logs.push({
              timestamp: new Date().toLocaleTimeString(),
              message: message
            });
          }
          originalConsoleLog(...args);
        };
        
        result = await propertyService.importCSVData(
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
        
        // Update with final logs at the end
        if (isMountedRef.current) {
          updateProcessingStatus('Updating job status...', 90, {
            recordsProcessed: result.processed || 0,
            errors: result.warnings || [],
            warnings: result.warnings || [],
            logs: logs // Include all logs in final update
          });
        } else {
          updateProcessingStatus('Updating job status...', 90, {
            recordsProcessed: result.processed || 0,
            errors: result.warnings || [],
            warnings: result.warnings || []
          });
        }
        
        // Check if job creation failed due to cleanup
        if (result && result.error && (result.error.includes('cleaned up') || result.error.includes('Job creation failed'))) {
          // Job creation failed - delete the job record
          try {
            await jobService.delete(createdJob.id);
            console.log('✅ Deleted failed job record');
          } catch (deleteError) {
            console.error('Failed to delete job record:', deleteError);
          }
          
          updateProcessingStatus('Job creation failed - data cleaned up', 0, {
            errors: [result.error]
          });
          
          setProcessingResults({
            success: false,
            processed: 0,
            errors: 1,
            warnings: [result.error],
            processingTime: new Date() - new Date(processingStatus.startTime),
            jobName: newJob.name,
            vendor: newJob.vendor,
            failureReason: result.error
          });
          
          addNotification('❌ Job creation failed - all data cleaned up. No job was created.', 'error');
        } else {
          // Normal processing - job succeeded
          const updateData = {
            sourceFileStatus: result.errors > 0 ? 'error' : 'imported',
            totalProperties: result.processed || 0
          };
          
          await jobService.update(createdJob.id, updateData);
          
          updateProcessingStatus('Refreshing job list...', 95);
          
          // Only refresh jobs list if processing was successful
          await refreshJobsWithAssignedCounts();
          
          // DO NOT trigger metrics refresh here - wait until Close button
          // This was causing re-renders during processing
          
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
        }

        // Don't close modal automatically - let user click Close
      }
      
    } catch (error) {
      console.error('Job creation error:', error);
      if (isMountedRef.current) {
        updateProcessingStatus('Error occurred', 0, {
          errors: [error.message]
        });
        addNotification('Error creating job: ' + error.message, 'error');
      }
    } finally {
      if (isMountedRef.current) {
        setProcessing(false);
      }
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
      // Update the main job data
      const updateData = {
        name: newJob.name,
        municipality: newJob.municipality,
        dueDate: newJob.dueDate,
        percent_billed: parseFloat(newJob.percentBilled) || 0
      };

      await jobService.update(editingJob.id, updateData);
      
      // Handle manager assignments - delete old ones and insert new ones
      await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', editingJob.id);
      
      // Insert new assignments if any
      if (newJob.assignedManagers && newJob.assignedManagers.length > 0) {
        const assignments = newJob.assignedManagers.map(manager => ({
          job_id: editingJob.id,
          employee_id: manager.id,
          role: manager.role,
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true,
          assigned_by: currentUser?.id || '5df85ca3-7a54-4798-a665-c31da8d9caad'
        }));
        
        await supabase
          .from('job_assignments')
          .insert(assignments);
      }
      
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

  // Archive job function
  const archiveJob = async (job) => {
    try {
      // Get checklist template items
      const checklistItems = await checklistService.getChecklistItems(job.id);

      // Get actual status for each item from checklist_item_status table
      const { data: statusData, error: statusError } = await supabase
        .from('checklist_item_status')
        .select('*')
        .eq('job_id', job.id);

      if (statusError) throw statusError;

      // Create a map of item statuses
      const statusMap = new Map();
      (statusData || []).forEach(status => {
        statusMap.set(status.item_id, status);
      });

      // Merge template items with their actual status
      const itemsWithStatus = checklistItems.map(item => {
        const status = statusMap.get(item.id);
        return {
          ...item,
          status: status?.status || 'pending'
        };
      });

      // For reassessment, exclude analysis and completion items (they're not applicable)
      const applicableItems = job.project_type === 'reassessment'
        ? itemsWithStatus.filter(item => item.category !== 'analysis' && item.category !== 'completion')
        : itemsWithStatus;

      const incompleteItems = applicableItems.filter(item => item.status !== 'completed');

      if (incompleteItems.length > 0) {
        setArchiveChecklistWarning({
          job: job,
          incompleteCount: incompleteItems.length,
          items: incompleteItems.map(i => i.item_text)
        });
        return;
      }

      // Proceed with archive
      setShowArchiveConfirm(job);
    } catch (error) {
      addNotification('Error checking checklist status: ' + error.message, 'error');
    }
  };

  const confirmArchive = async () => {
    const job = showArchiveConfirm || archiveChecklistWarning?.job;
    if (!job) return;

    try {
      setProcessing(true);

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('jobs')
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user?.id,
          status: 'archived'
        })
        .eq('id', job.id);

      if (error) throw error;

      addNotification(`Job "${job.name}" archived successfully`, 'success');
      setShowArchiveConfirm(null);
      setArchiveChecklistWarning(null);

      // Refresh data
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      addNotification('Error archiving job: ' + error.message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  // Unarchive job function
  const unarchiveJob = async (job) => {
    try {
      setProcessing(true);

      const { error } = await supabase
        .from('jobs')
        .update({
          archived_at: null,
          archived_by: null,
          status: 'active'
        })
        .eq('id', job.id);

      if (error) throw error;

      addNotification(`Job "${job.name}" restored to active`, 'success');

      // Refresh data
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error) {
      addNotification('Error unarchiving job: ' + error.message, 'error');
    } finally {
      setProcessing(false);
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
      percentBilled: '0.00'
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
      name: `${planningJob.municipality || ''} ${new Date(planningJob.end_date).getFullYear()}`,
      ccddCode: planningJob.ccddCode || '',
      municipality: planningJob.municipality || '',
      county: '',
      state: 'NJ',
      dueDate: '',
      assignedManagers: [],
      sourceFile: null,
      codeFile: null,
      vendor: null,
      vendorDetection: null,
      percentBilled: '0.00'
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
      alert(`Navigate to ${job.name} modules:\n- ProductionTracker\n- Management Checklist\n- Market & Land Analytics\n- Final Valuation\n- Appeal Coverage`);
    }
  };

  const sortJobsByBilling = (jobList) => {
    return jobList.sort((a, b) => {
      // Extract year from dueDate (format: "YYYY-MM-DD" or just "YYYY")
      const aYear = a.dueDate ? parseInt(a.dueDate.split('-')[0]) : 9999;
      const bYear = b.dueDate ? parseInt(b.dueDate.split('-')[0]) : 9999;
      
      // Primary sort: due year (ascending - earlier years first)
      if (aYear !== bYear) {
        return aYear - bYear;
      }
      
      // Secondary sort: billing percentage within same year (ascending - lower percentages first)
      const aBilling = a.percentBilled || 0;
      const bBilling = b.percentBilled || 0;
      
      if (aBilling !== bBilling) {
        return aBilling - bBilling;
      }
      
      // Tertiary sort: municipality name (alphabetical)
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

      {/* Assignment Upload Modal */}
      {showAssignmentUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="text-center">
              <Target className="w-12 h-12 mx-auto mb-4 text-green-600" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Assign Properties</h3>
              <p className="text-gray-600 mb-4">
                Upload CSV to set inspection scope for <strong>{showAssignmentUpload.name}</strong>
              </p>
              
              <div className="mb-4">
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setAssignmentFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                />
                <p className="text-xs text-gray-500 mt-2">
                  CSV with Block, Lot, Qualifier, Card, Location columns
                </p>
              </div>

              {assignmentResults && (
                <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="text-sm text-green-800">
                    <div className="font-bold text-lg mb-2">✅ Assignment Complete!</div>
                    <div className="grid grid-cols-2 gap-2 text-left">
                      <div>Uploaded:</div>
                      <div className="font-medium">{assignmentResults.uploaded}</div>
                      <div>Matched:</div>
                      <div className="font-medium">{assignmentResults.matched}</div>
                      <div>Unmatched:</div>
                      <div className="font-medium text-orange-600">{assignmentResults.unmatched}</div>
                      <div>Match Rate:</div>
                      <div className="font-medium">{assignmentResults.matchRate}%</div>
                      <div>Scope:</div>
                      <div className="font-medium">{assignmentResults.hasCommercial ? 'Mixed (Res + Com)' : 'Residential Only'}</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => {
                    setShowAssignmentUpload(null);
                    setAssignmentFile(null);
                    setAssignmentResults(null);
                  }}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {assignmentResults ? 'Close' : 'Cancel'}
                </button>
                {!assignmentResults && (
                  <button
                    onClick={() => uploadPropertyAssignment(showAssignmentUpload)}
                    disabled={!assignmentFile || uploadingAssignment}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {uploadingAssignment ? 'Processing...' : 'Assign Properties'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
              
              {/* Completion Results */}
              {processingResults && (
                <div className={`mb-4 p-4 rounded-lg border-2 ${
                  processingResults.success 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className={`text-lg font-bold mb-3 ${
                    processingResults.success ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {processingResults.success ? '🎉 Processing Complete!' : '❌ Job Creation Failed!'}
                  </div>
                  <div className={`text-sm ${
                    processingResults.success ? 'text-green-700' : 'text-red-700'
                  } space-y-2`}>
                    {processingResults.success ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <div className="font-bold">All partial data has been cleaned up.</div>
                        <div className="mt-2">
                          <span className="font-medium">Reason:</span> {processingResults.failureReason || 'Processing failed'}
                        </div>
                        <div className="text-xs mt-2 text-red-600">
                          No job was created. Please check your data files and try again.
                        </div>
                      </>
                    )}
                    {processingResults.errors > 0 && processingResults.success && (
                      <div className="flex justify-between text-red-600">
                        <span>⚠️ Errors:</span>
                        <span className="font-bold">{processingResults.errors}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-center space-x-3">
                {/* Force Quit - Only during processing */}
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

                {/* Close - Only when complete */}
                {processingResults && (
                  <button
                    onClick={async () => {
                      setShowProcessingModal(false);
                      setProcessingResults(null);
                      resetProcessingStatus();
                      // Reset form data
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
                        percentBilled: '0.00'
                      });
                      setFileAnalysis({
                        sourceFile: null,
                        codeFile: null,
                        detectedVendor: null,
                        isValid: false,
                        propertyCount: 0,
                        codeCount: 0
                      });
                      
                      // Refresh job data including freshness
                      await refreshAllJobData();
                      
                      // Notify parent component if needed
                      if (onJobProcessingComplete) {
                        onJobProcessingComplete();
                      }
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
                      {editingJob ? '���️ Edit Job' : '🚀 Create New Appraisal Job'}
                    </h2>
                    <p className="text-gray-600 mt-1">Set up a job with source data and manager assignments</p>
                  </div>
                </div>
                {/* % Billed field in top right */}
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
                      onChange={(e) => setNewJob({...newJob, percentBilled: e.target.value || '0.00'})}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  Target Date *
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

      {/* Checklist Warning Modal */}
      {archiveChecklistWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 shadow-2xl">
            <div className="text-center mb-4">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-yellow-600" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Incomplete Checklist Items</h3>
              <p className="text-gray-600 mb-4">
                "{archiveChecklistWarning.job.name}" has {archiveChecklistWarning.incompleteCount} incomplete checklist items:
              </p>
            </div>
            <div className="max-h-60 overflow-y-auto mb-6 bg-gray-50 rounded-lg p-4">
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {archiveChecklistWarning.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-gray-600 mb-6 text-center">
              Are you sure you want to archive this job with incomplete items?
            </p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => setArchiveChecklistWarning(null)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                disabled={processing}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {processing ? 'Archiving...' : 'Archive Anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive Confirmation Modal */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="text-center">
              <Archive className="w-12 h-12 mx-auto mb-4 text-purple-600" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Archive Job</h3>
              <p className="text-gray-600 mb-6">
                Archive "{showArchiveConfirm.name}"? This will move the job to archived jobs and to Legacy Jobs in Billing. You can restore it later if needed.
              </p>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => setShowArchiveConfirm(null)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium shadow-md hover:shadow-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmArchive}
                  disabled={processing}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                >
                  {processing ? 'Archiving...' : 'Archive Job'}
                </button>
              </div>
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
          Management OS - Current Jobs List
        </h1>
        <p className="text-gray-600">
          Manage appraisal jobs with source file integration and team assignments
        </p>
      </div>

      {/* Property Totals */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center justify-center gap-6 text-sm">
          <span className="font-medium text-blue-700">
            📊 Total Properties: {jobs.reduce((sum, job) => sum + (job.totalProperties || 0), 0).toLocaleString()}
          </span>
          <span className="font-medium text-green-600">
            🏠 Residential: {jobs.reduce((sum, job) => sum + (job.totalresidential || 0), 0).toLocaleString()}
          </span>
          <span className="font-medium text-purple-600">
            🏢 Commercial: {jobs.reduce((sum, job) => sum + (job.totalcommercial || 0), 0).toLocaleString()}
          </span>
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

            {/* Job Cards with LIVE METRICS */}
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
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm ${
                                  job.vendor_type === 'Microsystems'
                                    ? 'bg-blue-100 text-blue-800'
                                    : ''
                                }`}
                                style={job.vendor_type !== 'Microsystems' ? {
                                  backgroundColor: '#fed7aa',
                                  color: '#9a3412'
                                } : {}}
                              >
                                {job.vendor_type || 'BRT'}
                              </span>
                              <span className={`px-3 py-1 rounded-full text-xs font-medium shadow-sm text-green-600 bg-green-100`}>
                                Active
                              </span>
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium shadow-sm">
                                {((job.percentBilled || 0) * 100).toFixed(2)}% Billed
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
                          </div>

                          {/* Lead Manager Display */}
                          {job.assignedManagers && job.assignedManagers.length > 0 && (
                            <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
                              <Users className="w-4 h-4 text-gray-500" />
                              <span className="font-medium">
                                Lead: {job.assignedManagers.find(m => m.role === 'Lead Manager')?.name || 
                                       job.assignedManagers[0]?.name || 'No Lead Assigned'}
                              </span>
                            </div>
                          )}

                          {/* Production Metrics with LIVE DATA */}
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3 p-3 bg-gray-50 rounded-lg">
                            <div className="text-center">
                              <div className="text-lg font-bold text-blue-600">
                                {propertyDisplay.total > 0 ? Math.round((propertyDisplay.inspected / propertyDisplay.total) * 100) : 0}% Complete
                              </div>
                              <div className="text-xs text-gray-600">{propertyDisplay.label}</div>
                              <div className="text-sm text-gray-600">
                                {propertyDisplay.inspected.toLocaleString()} of {propertyDisplay.total.toLocaleString()}
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

                          {/* Freshness Indicator */}
                          <div className="flex items-center justify-between mb-2 px-3">
                            <div className="flex items-center space-x-3">
                              {jobFreshness[job.id] && (
                                job.percentBilled < 0.91 ? (
                                  // Inspection Phase Freshness
                                  <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${
                                    getUpdateStatusColor(jobFreshness[job.id].lastProductionRun, job.percentBilled)
                                  }`}>
                                    <Clock className="w-3 h-3" />
                                    <span>
                                      Production: {formatTimeAgo(jobFreshness[job.id].lastProductionRun)}
                                    </span>
                                    {jobFreshness[job.id].needsUpdate && (
                                      <AlertTriangle className="w-3 h-3" />
                                    )}
                                  </div>
                                ) : (
                                  // Valuation Phase Indicator
                                  <div className="flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    <TrendingUp className="w-3 h-3" />
                                    <span>Valuation Phase</span>
                                    {jobFreshness[job.id].lastFileUpload && (
                                      <span className="text-blue-600">
                                        • Sales data: {formatTimeAgo(jobFreshness[job.id].lastFileUpload)}
                                      </span>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                            
                            {/* File Upload Indicator (if newer than production) */}
                            {jobFreshness[job.id] && 
                             jobFreshness[job.id].lastFileUpload && 
                             jobFreshness[job.id].lastProductionRun &&
                             new Date(jobFreshness[job.id].lastFileUpload) > new Date(jobFreshness[job.id].lastProductionRun) && (
                              <div className="text-xs text-orange-600 font-medium">
                                📁 New file data available
                              </div>
                            )}
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
                            onClick={() => {
                              setSelectedJobForUpload(job);
                              setShowFileUploadModal(true);
                            }}
                            className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                            title="Update source or code files"
                          >
                            <Upload className="w-4 h-4" />
                            <span>Update File</span>
                          </button>
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
                  name: job.name || '',
                  ccddCode: job.ccdd || job.ccddCode || '',
                  municipality: job.municipality || '',
                  county: job.county || '',
                  state: job.state || 'NJ',
                  dueDate: job.dueDate || '',
                  assignedManagers: job.assignedManagers || [],
                  sourceFile: null,
                  codeFile: null,
                  vendor: job.vendor || null,
                  vendorDetection: job.vendorDetection || null,
                  percentBilled: job.percent_billed ? job.percent_billed.toString() : '0.00'
                });
                              setShowCreateJob(true);
                            }}
                            className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                          >
                            <Edit3 className="w-4 h-4" />
                            <span>Edit</span>
                          </button>
                          <button
                            onClick={() => archiveJob(job)}
                            className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                            title="Archive this job"
                          >
                            <Archive className="w-4 h-4" />
                            <span>Archive</span>
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

      {/* Planning Jobs Tab */}
      {activeTab === 'planning' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 rounded-lg border-2 border-yellow-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <Calendar className="w-8 h-8 mr-3 text-yellow-600" />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">📅 Planning Job Management</h2>
                  <p className="text-gray-600 mt-1">Track potential future projects and pipeline planning</p>
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

            <div className="space-y-3">
              {planningJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📅</div>
                  <h4 className="text-lg font-medium mb-2">No Planning Jobs</h4>
                  <p className="text-sm">Add planning jobs to track your future project pipeline!</p>
                </div>
              ) : (
                planningJobs.map(planningJob => (
                  <div key={planningJob.id} className="p-4 bg-white rounded-lg border-l-4 border-yellow-400 shadow-md hover:shadow-lg transition-all transform hover:scale-[1.01] hover:bg-yellow-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="text-lg font-bold text-gray-900">{planningJob.municipality}</h4>
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium shadow-sm">
                            Planning Phase
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
                          <span className="flex items-center space-x-1">
                            <span className="font-bold text-yellow-600">{planningJob.ccddCode}</span>
                            <span>•</span>
                            <span>Target: {planningJob.end_date || 'TBD'}</span>
                          </span>
                        </div>
                        {planningJob.comments && (
                          <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            {planningJob.comments}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end space-x-2 mt-3 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => convertPlanningToJob(planningJob)}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Convert to Job</span>
                      </button>
                      <button 
                        onClick={() => {
                          setEditingPlanning(planningJob);
                          setNewPlanningJob({
          ccddCode: planningJob.ccddCode || '',
          municipality: planningJob.municipality || '',
          dueDate: planningJob.end_date || '',
          comments: planningJob.comments || ''
        });
                          setShowEditPlanning(true);
                        }}
                        className="px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
                      >
                        <Edit3 className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                      <button 
                        onClick={async () => {
                          if (window.confirm(`Delete planning job for ${planningJob.municipality}?`)) {
                            try {
                              await planningJobService.delete(planningJob.id);
                              const updatedPlanningJobs = await planningJobService.getAll();
                              setPlanningJobs(updatedPlanningJobs);
                              addNotification('Planning job deleted successfully', 'success');
                            } catch (error) {
                              addNotification('Error deleting planning job: ' + error.message, 'error');
                            }
                          }
                        }}
                        className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105"
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

      {/* Archived Jobs Tab */}
      {activeTab === 'archived' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-purple-50 to-gray-50 rounded-lg border-2 border-purple-200 p-6">
            <div className="flex items-center mb-6">
              <Archive className="w-8 h-8 mr-3 text-purple-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">🗄️ Archived Jobs</h2>
                <p className="text-gray-600 mt-1">Completed and archived project history</p>
              </div>
            </div>

            <div className="space-y-3">
              {archivedJobs.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">🗄️</div>
                  <h4 className="text-lg font-medium mb-2">No Archived Jobs</h4>
                  <p className="text-sm">Completed jobs will appear here for historical reference</p>
                </div>
              ) : (
                archivedJobs.map(job => (
                  <div key={job.id} className="p-4 bg-white rounded-lg border-l-4 border-purple-400 shadow-md hover:shadow-lg transition-all transform hover:scale-[1.01] hover:bg-purple-50">
                    <div className="flex justify-between items-start">
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
                            <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium shadow-sm">
                              Archived
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
                          <span className="flex items-center space-x-1">
                            <span className="font-bold text-purple-600">{job.ccdd || job.ccddCode}</span>
                            <span>•</span>
                            <MapPin className="w-4 h-4" />
                            <span>{job.municipality}</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <span>📍 {job.county} County</span>
                          </span>
                          <span className="flex items-center space-x-1">
                            <span>🏠 {(job.totalProperties || 0).toLocaleString()} Properties</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Unarchive Button */}
                    <div className="flex justify-end pt-3 border-t border-gray-100">
                      <button
                        onClick={() => unarchiveJob(job)}
                        disabled={processing}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-1 text-sm font-medium shadow-md hover:shadow-lg transition-all transform hover:scale-105 disabled:opacity-50"
                        title="Restore this job to active"
                      >
                        <CheckCircle className="w-4 h-4" />
                        <span>Restore to Active</span>
                      </button>
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
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-200 p-6">
            <div className="flex items-center mb-6">
              <TrendingUp className="w-8 h-8 mr-3 text-blue-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">📈 County HPI Data Management</h2>
                <p className="text-gray-600 mt-1">Import and manage Housing Price Index data by county</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {getUniqueCounties().length === 0 ? (
                <div className="col-span-full text-center text-gray-500 py-12">
                  <div className="text-4xl mb-4">📈</div>
                  <h4 className="text-lg font-medium mb-2">No County Data</h4>
                  <p className="text-sm">Create jobs to see available counties for HPI data import</p>
                </div>
              ) : (
                getUniqueCounties().map(county => {
                  const hpiData = countyHpiData[county] || [];
                  const hasData = hpiData.length > 0;
                  const latestYear = hasData ? Math.max(...hpiData.map(d => d.observation_year)) : null;
                  const dataCount = hpiData.length;

                  return (
                    <div key={county} className="p-4 bg-white rounded-lg border shadow-md hover:shadow-lg transition-all">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-bold text-gray-900">{county} County</h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          hasData ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {hasData ? `${dataCount} Records` : 'No Data'}
                        </span>
                      </div>
                      
                      {hasData && (
                        <div className="text-sm text-gray-600 mb-3">
                          <div>Latest: {latestYear}</div>
                          <div>Years: {Math.min(...hpiData.map(d => d.observation_year))} - {latestYear}</div>
                        </div>
                      )}

                      <div className={hasData ? "flex gap-2" : ""}>
                        <button
                          onClick={() => setShowHpiImport(county)}
                          className={`${hasData ? 'flex-1' : 'w-full'} px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                            hasData
                              ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {hasData ? '🔄 Update HPI Data' : '📊 Import HPI Data'}
                        </button>

                        {hasData && (
                          <button
                            onClick={() => exportCountyHpi(county)}
                            className="px-3 py-2 rounded-lg text-sm font-medium transition-all bg-green-100 text-green-800 hover:bg-green-200 flex items-center gap-1"
                            title="Export HPI Data"
                          >
                            <Download className="w-4 h-4" />
                            Export
                          </button>
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

      {/* Manager Assignments Tab */}
      {activeTab === 'manager-assignments' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200 p-6">
            <div className="flex items-center mb-6">
              <Users className="w-8 h-8 mr-3 text-green-600" />
              <div>
                <h2 className="text-2xl font-bold text-gray-800">👥 Manager Assignment Overview</h2>
                <p className="text-gray-600 mt-1">Current workload distribution across all managers</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {managers.filter(manager => !`${manager.first_name} ${manager.last_name}`.toLowerCase().includes('tom davis')).map(manager => {
                const workload = getManagerWorkload(manager);
                
                return (
                  <div key={manager.id} className="p-4 bg-white rounded-lg border shadow-md hover:shadow-lg transition-all">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-sm font-bold mr-3">
                        {`${manager.first_name || ''} ${manager.last_name || ''}`.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          {manager.first_name} {manager.last_name}
                        </h3>
                        {manager.can_be_lead && (
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                            Lead Qualified
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Active Jobs:</span>
                        <span className="font-medium text-blue-600">{workload.jobCount}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Properties:</span>
                        <span className="font-medium text-gray-800">{workload.totalProperties.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Completed:</span>
                        <span className="font-medium text-green-600">{workload.completedProperties.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Completion Rate:</span>
                        <span className="font-medium text-purple-600">{workload.completionRate}%</span>
                      </div>
                    </div>

                    {workload.jobs.length > 0 && (
                      <div className="border-t pt-3">
                        <div className="text-xs text-gray-600 mb-2">Assigned Jobs:</div>
                        <div className="space-y-1">
                          {workload.jobs.map(job => (
                            <div key={job.id} className="text-xs text-gray-700 flex justify-between">
                              <span className="truncate">{job.municipality}</span>
                              <span className="text-gray-500">{(job.totalProperties || 0).toLocaleString()}</span>
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
  );
};

export default AdminJobManagement;
