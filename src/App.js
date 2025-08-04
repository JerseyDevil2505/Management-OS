import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, jobService } from './lib/supabaseClient';
import LandingPage from './components/LandingPage';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import UserManagement from './components/UserManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/FileUploadButton';
import './App.css';

function App() {
  // Authentication state
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [activeModule, setActiveModule] = useState('jobs');
  const [selectedJob, setSelectedJob] = useState(null);

  // DEBUG: Track what's causing re-renders
  const renderCount = useRef(0);
  const prevActiveModule = useRef(activeModule);
  
  useEffect(() => {
    renderCount.current += 1;
       
    if (prevActiveModule.current !== activeModule) {
      console.warn(`⚠️ ACTIVE MODULE CHANGED: ${prevActiveModule.current} → ${activeModule}`);
      prevActiveModule.current = activeModule;
    }
  });

  // Central module state management for ALL jobs using workflow_stats
  const [jobWorkflowStats, setJobWorkflowStats] = useState({});
  const [isLoadingWorkflowStats, setIsLoadingWorkflowStats] = useState(false);
  
  // ADD: Lock to prevent refreshes during job creation
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  // 🔧 BACKEND ENHANCEMENT: Add metrics refresh trigger for AdminJobManagement
  const [metricsRefreshTrigger, setMetricsRefreshTrigger] = useState(0);

  // Check for existing session or dev mode on mount
  useEffect(() => {
    checkSession();
  }, []);

    // Set page title based on environment
  useEffect(() => {
    if (window.location.hostname.includes('production-black-seven') || 
        window.location.hostname === 'localhost' ||
        window.location.hostname.includes('github.dev') ||
        window.location.hostname.includes('preview')) {
      document.title = 'Mgmt OS Development';
    } else {
      document.title = 'Mgmt OS Production';
    }  
  }, []);
 

  const checkSession = async () => {
    try {
      // Development auto-login - check for dev URLs
      if (window.location.hostname.includes('production-black-seven') || 
          window.location.hostname === 'localhost' ||
          window.location.hostname.includes('github.dev') ||
          window.location.hostname.includes('preview')) {
        setUser({
          email: 'dev@lojik.com',
          role: 'admin',
          employeeData: { 
            name: 'Development Mode',
            role: 'admin'
          }
        });
        setLoading(false);
        return;
      }

      // Production - check for real session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Get employee data for role
        const { data: employee } = await supabase
          .from('employees')
          .select('*')
          .eq('email', session.user.email.toLowerCase())
          .single();

        if (employee) {
          setUser({
            ...session.user,
            role: employee.role || 'inspector',
            employeeData: employee
          });
        }
      }
    } catch (error) {
      console.error('Session check error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (userData) => {
    setUser(userData);
    // Set default tab based on role
    if (userData.role === 'manager') {
      setActiveModule('employees');
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSelectedJob(null);
      setActiveModule('jobs');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Load persisted workflow stats for all active jobs
  const loadAllJobWorkflowStats = useCallback(async () => {
    // CRITICAL: Don't refresh while a job is being created
    if (isCreatingJob) {
      return;
    }
    
    
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
  }, [isCreatingJob]);

  // Load workflow stats on app startup - DEFERRED
  useEffect(() => {
    // Wait a bit before loading heavy workflow stats
    const timeoutId = setTimeout(() => {
      loadAllJobWorkflowStats();
    }, 2000); // Wait 2 seconds
    
    return () => clearTimeout(timeoutId);
  }, []); // Remove loadAllJobWorkflowStats from dependencies

  // 🔧 BACKEND ENHANCEMENT: Enhanced workflow stats update with metrics refresh trigger
  const handleWorkflowStatsUpdate = async (jobId, newStats, persistToDatabase = true) => {
    
    // Check if analytics just completed (isProcessed changed from false to true)
    const previousStats = jobWorkflowStats[jobId];
    const analyticsJustCompleted = newStats.isProcessed && !previousStats?.isProcessed;

    // Extract the flat structure from nested analytics if needed
    const flatStats = newStats.analytics ? {
      ...newStats.analytics,  // Flatten the analytics object
      billingAnalytics: newStats.billingAnalytics,
      validationReport: newStats.validationReport,
      missingPropertiesReport: newStats.missingPropertiesReport,
      validationOverrides: newStats.validationOverrides,
      overrideMap: newStats.overrideMap,
      lastProcessed: newStats.lastProcessed || new Date().toISOString(),
      isProcessed: true  // CRITICAL: Preserve the processed flag!
    } : {
      ...newStats,
      isProcessed: true
    };

    // Update local state immediately for real-time UI
    setJobWorkflowStats(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        ...flatStats,  // Use the flattened stats
        isProcessed: true,
        lastUpdated: new Date().toISOString()
      }
    }));

    // 🔧 FIX: Defer metrics refresh to prevent React Error #301
    if (analyticsJustCompleted) {
      setTimeout(() => {
        setMetricsRefreshTrigger(prev => prev + 1);
      }, 0);
    }

    // Persist to database for navigation survival
    if (persistToDatabase) {
      try {
        // CRITICAL FIX: Merge properly, don't overwrite!
        const updatedStats = {
          ...jobWorkflowStats[jobId],
          ...flatStats,  // This now includes all the analytics data
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

  // NEW: Refresh selected job data to get latest timestamps
  const refreshSelectedJob = async () => {
    if (!selectedJob) return;
    
    try {
      // Get all jobs using the service (which includes field mapping)
      const jobs = await jobService.getAll();
      
      // Find the selected job from the results
      const refreshedJob = jobs.find(j => j.id === selectedJob.id);
      
      if (refreshedJob) {
        setSelectedJob(refreshedJob);
      }
    } catch (error) {
      console.error('Error refreshing selected job:', error);
    }
  };

  // Handle returning to jobs list
  const handleBackToJobs = () => {
    setSelectedJob(null);
    setActiveModule('jobs');
  };

  // File refresh trigger for JobContainer
  const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);

  // 🔧 FIX: Defer file processing state updates to prevent React Error #301
  const handleFileProcessed = async (result) => {
    
    // NEW: Refresh the selected job to get new updated_at timestamp
    await refreshSelectedJob();
    
    // FileUploadButton already handles file versioning and tracking
    // Just refresh job metadata without touching ProductionTracker analytics
    await loadAllJobWorkflowStats();
    
    // CRITICAL: Defer trigger to prevent render-time state updates
    setTimeout(() => {
      setFileRefreshTrigger(prev => prev + 1);
    }, 0);

    // REMOVED the needsRefresh flag that was causing ProductionTracker to reset!
    // The ProductionTracker can handle file changes on its own without resetting
  };

  // 🔧 FIX: Make callback more defensive and properly memoized
  const handleJobProcessingComplete = useCallback(() => {
    
    // Double defer to ensure AdminJobManagement has finished all its state updates
    requestAnimationFrame(() => {
      setTimeout(() => {
        setMetricsRefreshTrigger(prev => prev + 1);
        // Also refresh the job stats to get the new job
        loadAllJobWorkflowStats();
      }, 100); // Give a bit more time for modal cleanup
    });
  }, [loadAllJobWorkflowStats]);

  // DEBUG: Job creation handlers
  const handleJobCreationStart = useCallback(() => {
    setIsCreatingJob(true);
  }, []);

  const handleJobCreationEnd = useCallback(() => {
    setIsCreatingJob(false);
    // Refresh after creation completes
    setTimeout(() => {
      loadAllJobWorkflowStats();
    }, 500);
  }, [loadAllJobWorkflowStats]);

  const renderTabs = () => {
    const tabs = [
      { id: 'employees', label: '👥 Employee Management' },
      { id: 'jobs', label: '📋 Current Jobs' }
    ];

    // Only show billing and payroll tabs for admins
    if (user?.role === 'admin') {
      tabs.push(
        { id: 'billing', label: '💰 Billing Management' },
        { id: 'payroll', label: '📊 Payroll Management' },
        { id: 'users', label: '🔐 User Management' }
      );
    }

    return tabs;
  };

  // Show loading state
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Show landing page if not authenticated
  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      {/* Top Navigation */}
      <div className="bg-gray-900 text-white p-4 mb-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold">
              Management OS
              {isLoadingWorkflowStats && (
                <span className="ml-3 text-sm text-gray-300">
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-gray-300 mr-2"></div>
                  Loading analytics...
                </span>
              )}
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-300">
                {user.employeeData?.name || user.email} ({user.role})
              </span>
              <button
                onClick={handleLogout}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Logout
              </button>
            </div>
          </div>
          
          {/* Only show main navigation when NOT in job-specific modules */}
          {activeModule !== 'job-modules' && (
            <nav className="flex space-x-6">
              {renderTabs().map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveModule(tab.id)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeModule === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'jobs' && Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length > 0 && (
                    <span className="ml-2 text-xs bg-green-500 text-white px-2 py-1 rounded-full">
                      {Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length}
                    </span>
                  )}
                </button>
              ))}
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
            metricsRefreshTrigger={metricsRefreshTrigger}
            onJobProcessingComplete={handleJobProcessingComplete}
            // ADD: Pass creation lock handlers
            onJobCreationStart={handleJobCreationStart}
            onJobCreationEnd={handleJobCreationEnd}
          />
        )}

        {activeModule === 'billing' && user?.role === 'admin' && <BillingManagement />}

        {activeModule === 'payroll' && user?.role === 'admin' && <PayrollManagement />}
        
        {activeModule === 'users' && user?.role === 'admin' && <UserManagement />}
        
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
