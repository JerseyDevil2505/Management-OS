import React, { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/FileUploadButton';
import './App.css';

function App() {
  const [activeModule, setActiveModule] = useState('jobs');
  const [selectedJob, setSelectedJob] = useState(null);

  // ENHANCED: Central module state management for ALL jobs
  const [jobModuleStates, setJobModuleStates] = useState({});
  const [isLoadingModuleStates, setIsLoadingModuleStates] = useState(false);

  // ENHANCED: Load persisted module states for all active jobs
  const loadAllJobModuleStates = async () => {
    setIsLoadingModuleStates(true);
    try {
      // Get all active jobs with their module states
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('id, module_states, workflow_stats')
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (!error && jobs) {
        const loadedStates = {};
        
        jobs.forEach(job => {
          if (job.module_states && Object.keys(job.module_states).length > 0) {
            // Load from new module_states field
            loadedStates[job.id] = job.module_states;
          } else if (job.workflow_stats && job.workflow_stats.totalRecords) {
            // Migration: Load from old workflow_stats field
            loadedStates[job.id] = {
              payrollProductionUpdater: {
                analytics: job.workflow_stats,
                billingAnalytics: job.workflow_stats.billingAnalytics,
                validationReport: job.workflow_stats.validationReport,
                lastProcessed: job.workflow_stats.lastProcessed,
                isProcessed: true
              },
              managementChecklist: {
                progress: null,
                completedItems: 0,
                totalItems: 29,
                lastUpdated: null
              }
            };
          } else {
            // Initialize empty state for jobs without module states
            loadedStates[job.id] = {
              payrollProductionUpdater: {
                analytics: null,
                billingAnalytics: null,
                validationReport: null,
                lastProcessed: null,
                isProcessed: false
              },
              managementChecklist: {
                progress: null,
                completedItems: 0,
                totalItems: 29,
                lastUpdated: null
              }
            };
          }
        });

        setJobModuleStates(loadedStates);
        console.log(`📊 App.js: Loaded module states for ${Object.keys(loadedStates).length} jobs`);
      }
    } catch (error) {
      console.error('❌ Error loading job module states:', error);
    } finally {
      setIsLoadingModuleStates(false);
    }
  };

  // Load module states on app startup
  useEffect(() => {
    loadAllJobModuleStates();
  }, []);

  // ENHANCED: Update module state for a specific job
  const handleModuleStateUpdate = async (jobId, moduleName, newState, persistToDatabase = true) => {
    console.log(`📊 App.js: Updating ${moduleName} state for job ${jobId}`, newState);

    // Initialize job state if it doesn't exist
    if (!jobModuleStates[jobId]) {
      setJobModuleStates(prev => ({
        ...prev,
        [jobId]: {
          payrollProductionUpdater: {
            analytics: null,
            billingAnalytics: null,
            validationReport: null,
            lastProcessed: null,
            isProcessed: false
          },
          managementChecklist: {
            progress: null,
            completedItems: 0,
            totalItems: 29,
            lastUpdated: null
          }
        }
      }));
    }

    // Update local state immediately for real-time UI
    setJobModuleStates(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        [moduleName]: {
          ...prev[jobId]?.[moduleName],
          ...newState,
          lastUpdated: new Date().toISOString()
        }
      }
    }));

    // Persist to database for navigation survival
    if (persistToDatabase) {
      try {
        const updatedJobState = {
          ...jobModuleStates[jobId],
          [moduleName]: {
            ...jobModuleStates[jobId]?.[moduleName],
            ...newState,
            lastUpdated: new Date().toISOString()
          }
        };

        const { error } = await supabase
          .from('jobs')
          .update({ 
            module_states: updatedJobState,
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);

        if (error) {
          console.error('❌ Error persisting module state:', error);
        } else {
          console.log(`✅ App.js: Persisted ${moduleName} state for job ${jobId}`);
        }
      } catch (error) {
        console.error('❌ Failed to persist module state:', error);
      }
    }
  };

  // ENHANCED: Get module state for a specific job (with defaults)
  const getJobModuleState = (jobId, moduleName) => {
    const defaultStates = {
      payrollProductionUpdater: {
        analytics: null,
        billingAnalytics: null,
        validationReport: null,
        lastProcessed: null,
        isProcessed: false
      },
      managementChecklist: {
        progress: null,
        completedItems: 0,
        totalItems: 29,
        lastUpdated: null
      }
    };

    return jobModuleStates[jobId]?.[moduleName] || defaultStates[moduleName] || {};
  };

  // ENHANCED: Get all job metrics for AdminJobManagement
  const getAllJobMetrics = () => {
    const metrics = {};
    
    Object.keys(jobModuleStates).forEach(jobId => {
      const payrollProductionState = jobModuleStates[jobId]?.payrollProductionUpdater;
      
      if (payrollProductionState?.analytics && payrollProductionState.isProcessed) {
        metrics[jobId] = {
          totalProperties: payrollProductionState.analytics.totalRecords || 0,
          propertiesInspected: payrollProductionState.analytics.validInspections || 0,
          entryRate: payrollProductionState.analytics.jobEntryRate || 0,
          refusalRate: payrollProductionState.analytics.jobRefusalRate || 0,
          commercialComplete: payrollProductionState.analytics.commercialCompletePercent || 0,
          pricingComplete: payrollProductionState.analytics.pricingCompletePercent || 0,
          lastProcessed: payrollProductionState.lastProcessed,
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
    console.log(`📊 App.js: Job selected - ${job.job_name} (${job.id})`);
    setSelectedJob(job);
    setActiveModule('job-modules');
  };

  // Handle returning to jobs list
  const handleBackToJobs = () => {
    console.log('📊 App.js: Returning to jobs list');
    setSelectedJob(null);
    setActiveModule('jobs');
  };

  // ENHANCED: Handle file processing completion with state invalidation
  const handleFileProcessed = async (result) => {
    console.log(`📊 App.js: File processed for job ${selectedJob?.id}`, result);
    
    // If analytics were processed, invalidate them to force refresh
    if (selectedJob?.id && jobModuleStates[selectedJob.id]?.payrollProductionUpdater?.isProcessed) {
      console.log('📊 App.js: Invalidating PayrollProductionUpdater analytics due to file update');
      
      await handleModuleStateUpdate(selectedJob.id, 'payrollProductionUpdater', {
        analytics: null,
        billingAnalytics: null,
        validationReport: null,
        isProcessed: false,
        lastProcessed: null
      }, true);
    }

    // Refresh all job module states to pick up any changes
    await loadAllJobModuleStates();
  };

  return (
    <div className="App">
      {/* Top Navigation */}
      <div className="bg-gray-900 text-white p-4 mb-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">
            Management OS
            {isLoadingModuleStates && (
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
                {/* ENHANCED: Show analytics ready indicator */}
                {Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length > 0 && (
                  <span className="ml-2 text-xs bg-green-500 text-white px-2 py-1 rounded-full">
                    {Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length}
                  </span>
                )}
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

                {/* ENHANCED: Show job module state indicators */}
                <div className="border-l border-gray-700 pl-6">
                  <div className="flex items-center space-x-2 text-sm">
                    {getJobModuleState(selectedJob.id, 'payrollProductionUpdater').isProcessed && (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium">
                        Analytics Ready
                      </span>
                    )}
                    {getJobModuleState(selectedJob.id, 'managementChecklist').completedItems > 0 && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium">
                        Checklist Active
                      </span>
                    )}
                  </div>
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
            // ENHANCED: Pass live metrics to AdminJobManagement
            jobMetrics={getAllJobMetrics()}
            isLoadingMetrics={isLoadingModuleStates}
          />
        )}
        
        {activeModule === 'job-modules' && selectedJob && (
          <JobContainer 
            selectedJob={selectedJob} 
            onBackToJobs={handleBackToJobs}
            // ENHANCED: Pass module state management to JobContainer
            moduleState={getJobModuleState(selectedJob.id, 'payrollProductionUpdater')}
            onUpdateModuleState={(moduleName, newState, persist = true) => 
              handleModuleStateUpdate(selectedJob.id, moduleName, newState, persist)
            }
            allModuleStates={jobModuleStates[selectedJob.id] || {}}
          />
        )}
      </div>
    </div>
  );
}

export default App;
