import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/FileUploadButton';
import './App.css';

function App() {
  const [activeModule, setActiveModule] = useState('jobs');
  const [selectedJob, setSelectedJob] = useState(null);

  // Central module state management for ALL jobs using workflow_stats
  const [jobWorkflowStats, setJobWorkflowStats] = useState({});
  const [isLoadingWorkflowStats, setIsLoadingWorkflowStats] = useState(false);

  // Load persisted workflow stats for all active jobs
  const loadAllJobWorkflowStats = useCallback(async () => {
    setIsLoadingWorkflowStats(true);
    try {
      // Get all active jobs with their workflow stats
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('id, workflow_stats')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (!error && jobs) {
        const loadedStats = {};
        
        jobs.forEach(job => {
          if (job.workflow_stats && Object.keys(job.workflow_stats).length > 0) {
            // Load existing workflow stats
            loadedStats[job.id] = {
              ...job.workflow_stats,
              isProcessed: true,
              lastLoaded: new Date().toISOString()
            };
          } else {
            // Initialize empty state for jobs without workflow stats
            loadedStats[job.id] = {
              totalRecords: 0,
              validInspections: 0,
              jobEntryRate: 0,
              jobRefusalRate: 0,
              commercialCompletePercent: 0,
              pricingCompletePercent: 0,
              lastProcessed: null,
              isProcessed: false
            };
          }
        });

        setJobWorkflowStats(loadedStats);
      }
    } catch (error) {
      console.error('❌ Error loading job workflow stats:', error);
    } finally {
      setIsLoadingWorkflowStats(false);
    }
  }, []);

  // Load workflow stats on app startup
  useEffect(() => {
    loadAllJobWorkflowStats();
  }, [loadAllJobWorkflowStats]);

  // Update workflow stats for a specific job
  const handleWorkflowStatsUpdate = async (jobId, newStats, persistToDatabase = true) => {
    // Update local state immediately for real-time UI
    setJobWorkflowStats(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        ...newStats,
        isProcessed: true,
        lastUpdated: new Date().toISOString()
      }
    }));

    // Persist to database for navigation survival
    if (persistToDatabase) {
      try {
        const updatedStats = {
          ...jobWorkflowStats[jobId],
          ...newStats,
          isProcessed: true,
          lastUpdated: new Date().toISOString()
        };

        const { error } = await supabase
          .from('jobs')
          .update({ 
            workflow_stats: updatedStats,
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);

        if (error) {
          console.error('❌ Error persisting workflow stats:', error);
        }
      } catch (error) {
        console.error('❌ Failed to persist workflow stats:', error);
      }
    }
  };

  // Get workflow stats for a specific job (with defaults)
  const getJobWorkflowStats = (jobId) => {
    const defaultStats = {
      totalRecords: 0,
      validInspections: 0,
      jobEntryRate: 0,
      jobRefusalRate: 0,
      commercialCompletePercent: 0,
      pricingCompletePercent: 0,
      lastProcessed: null,
      isProcessed: false
    };

    return jobWorkflowStats[jobId] || defaultStats;
  };

  // Get all job metrics for AdminJobManagement
  const getAllJobMetrics = () => {
    const metrics = {};
    
    Object.keys(jobWorkflowStats).forEach(jobId => {
      const stats = jobWorkflowStats[jobId];
      
      if (stats && stats.isProcessed && stats.totalRecords) {
        metrics[jobId] = {
          totalProperties: stats.totalRecords || 0,
          propertiesInspected: stats.validInspections || 0,
          entryRate: stats.jobEntryRate || 0,
          refusalRate: stats.jobRefusalRate || 0,
          commercialComplete: stats.commercialCompletePercent || 0,
          pricingComplete: stats.pricingCompletePercent || 0,
          lastProcessed: stats.lastProcessed,
          isProcessed: true
        };
      } else {
        // Default metrics for unprocessed jobs
        metrics[jobId] = {
          totalProperties: 0,
          propertiesInspected: 0,
          entryRate: 0,
          refusalRate: 0,
          commercialComplete: 0,
          pricingComplete: 0,
          lastProcessed: null,
          isProcessed: false
        };
      }
    });

    return metrics;
  };

  // Handle job selection from AdminJobManagement
  const handleJobSelect = (job) => {
    setSelectedJob(job);
    setActiveModule('job-modules');
  };

  // Handle returning to jobs list
  const handleBackToJobs = () => {
    setSelectedJob(null);
    setActiveModule('jobs');
  };

  // NEW: File refresh trigger for JobContainer
  const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);

  // Handle file processing completion - FileUploadButton handles versioning
  const handleFileProcessed = async (result) => {
    // FileUploadButton already handles file versioning and tracking
    // Just refresh job metadata without touching ProductionTracker analytics
    await loadAllJobWorkflowStats();
    
    // CRITICAL: Trigger JobContainer to refresh file version
    setFileRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="App">
      {/* Top Navigation */}
      <div className="bg-gray-900 text-white p-4 mb-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">
            Management OS
            {isLoadingWorkflowStats && (
              <span className="ml-3 text-sm text-gray-300">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-gray-300 mr-2"></div>
                Loading analytics...
              </span>
            )}
          </h1>
          
          {/* Only show main navigation when NOT in job-specific modules */}
          {activeModule !== 'job-modules' && (
            <nav className="flex space-x-6">
              <button
                onClick={() => setActiveModule('employees')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'employees'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                👥 Employee Management
              </button>
              <button
                onClick={() => setActiveModule('jobs')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'jobs'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                📋 Current Jobs
                {/* Show analytics ready indicator */}
                {Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length > 0 && (
                  <span className="ml-2 text-xs bg-green-500 text-white px-2 py-1 rounded-full">
                    {Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveModule('billing')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'billing'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                💰 Billing Management
              </button>
              <button
                onClick={() => setActiveModule('payroll')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeModule === 'payroll'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                📊 Payroll Management
              </button>
            </nav>
          )}
          
          {/* Show job context when in job-specific modules */}
          {activeModule === 'job-modules' && selectedJob && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-sm text-gray-300">Working on:</p>
                  <p className="text-lg font-semibold">{selectedJob.job_name}</p>
                </div>
                
                {/* File Upload Controls */}
                <div className="border-l border-gray-700 pl-6">
                  <FileUploadButton 
                    job={selectedJob} 
                    onFileProcessed={handleFileProcessed} 
                  />
                </div>
              </div>
              
              <button
                onClick={handleBackToJobs}
                className="px-4 py-2 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-lg font-medium transition-colors"
              >
                ← Back to Jobs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Module Content */}
      <div className="min-h-screen bg-gray-50">
        {activeModule === 'employees' && <EmployeeManagement />}
        
        {activeModule === 'jobs' && (
          <AdminJobManagement 
            onJobSelect={handleJobSelect}
            jobMetrics={getAllJobMetrics()}
            isLoadingMetrics={isLoadingWorkflowStats}
          />
        )}

        {activeModule === 'billing' && <BillingManagement />}

        {activeModule === 'payroll' && <PayrollManagement />}
        
        {activeModule === 'job-modules' && selectedJob && (
          <JobContainer 
            selectedJob={selectedJob} 
            onBackToJobs={handleBackToJobs}
            workflowStats={getJobWorkflowStats(selectedJob.id)}
            onUpdateWorkflowStats={(newStats, persist = true) => 
              handleWorkflowStatsUpdate(selectedJob.id, newStats, persist)
            }
            fileRefreshTrigger={fileRefreshTrigger}
          />
        )}
      </div>
    </div>
  );
}

export default App;
