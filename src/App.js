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
      { 
        id: 'employees', 
        label: 'Employee Management',
        icon: (
          <svg className="w-5 h-5 inline-block mr-2" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="7" r="3" fill="currentColor" opacity="0.3"/>
            <circle cx="15" cy="7" r="2.5" fill="currentColor" opacity="0.2"/>
            <path d="M3 18C3 15.2386 5.23858 13 8 13H10C12.7614 13 15 15.2386 15 18V21H3V18Z" fill="currentColor"/>
            <path d="M15 14C17.2091 14 19 15.3431 19 17V20H15V18C15 16.5 15 15 15 14Z" fill="currentColor" opacity="0.5"/>
          </svg>
        )
      },
      { 
        id: 'jobs', 
        label: 'Current Jobs',
        icon: (
          <svg className="w-5 h-5 inline-block mr-2" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="4" width="14" height="16" rx="2" fill="currentColor" opacity="0.2"/>
            <rect x="5" y="4" width="14" height="4" rx="2" fill="currentColor"/>
            <rect x="8" y="11" width="8" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="8" y="15" width="5" height="2" rx="0.5" fill="currentColor" opacity="0.6"/>
            <circle cx="9" cy="2" r="1" fill="currentColor"/>
            <circle cx="15" cy="2" r="1" fill="currentColor"/>
          </svg>
        )
      }
    ];

    // Only show billing and payroll tabs for admins
    if (user?.role === 'admin') {
      tabs.push(
        { 
          id: 'billing', 
          label: 'Billing Management',
          icon: (
            <svg className="w-5 h-5 inline-block mr-2" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="6" width="20" height="12" rx="2" fill="currentColor" opacity="0.2"/>
              <circle cx="12" cy="12" r="4" fill="currentColor"/>
              <path d="M12 10V8M12 16V14" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M6 6V4M18 6V4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          )
        },
        { 
          id: 'payroll', 
          label: 'Payroll Management',
          icon: (
            <svg className="w-5 h-5 inline-block mr-2" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="14" width="5" height="7" fill="currentColor" opacity="0.5"/>
              <rect x="10" y="10" width="5" height="11" fill="currentColor" opacity="0.7"/>
              <rect x="17" y="6" width="5" height="15" fill="currentColor"/>
              <path d="M3 11L8 7L13 9L22 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="22" cy="2" r="2" fill="currentColor"/>
            </svg>
          )
        },
        { 
          id: 'users', 
          label: 'User Management',
          icon: (
            <svg className="w-5 h-5 inline-block mr-2" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="10" width="16" height="10" rx="2" fill="currentColor" opacity="0.3"/>
              <path d="M8 10V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="12" cy="14" r="2" fill="currentColor"/>
              <rect x="11" y="15" width="2" height="3" fill="currentColor"/>
            </svg>
          )
        }
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
    console.log('LandingPage type:', typeof LandingPage);
    console.log('LandingPage:', LandingPage);
    
    if (typeof LandingPage !== 'function') {
      return (
        <div style={{ padding: '20px' }}>
          <h1>Loading Error</h1>
          <p>LandingPage is not a valid component</p>
          <p>Type: {typeof LandingPage}</p>
          <pre>{JSON.stringify(LandingPage, null, 2)}</pre>
        </div>
      );
    }
    
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      {/* Top Navigation - Updated with Management OS styling */}
      <div className="app-header">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-4xl font-bold text-white flex items-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", letterSpacing: '-0.02em', textShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
              Management OS
              {isLoadingWorkflowStats && (
                <span className="ml-3 text-sm opacity-90">
                  <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Loading analytics...
                </span>
              )}
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-white opacity-95">
                {user.employeeData?.name || user.email} ({user.role})
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
              >
                Logout
              </button>
            </div>
          </div>
          
          {/* Only show main navigation when NOT in job-specific modules */}
          {activeModule !== 'job-modules' && (
            <nav className="flex space-x-4">
              {renderTabs().map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveModule(tab.id)}
                  className={`px-5 py-2.5 rounded-xl font-medium transition-all duration-200 flex items-center border ${
                    activeModule === tab.id
                      ? 'bg-white text-blue-600 shadow-lg transform scale-105 border-white'
                      : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.id === 'jobs' && Object.values(getAllJobMetrics()).filter(m => m.isProcessed).length > 0 && (
                    <span className="ml-2 text-xs bg-gradient-to-r from-green-500 to-emerald-500 text-white px-2 py-1 rounded-full shadow-sm">
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
                  <p className="text-sm text-white opacity-75">Working on:</p>
                  <p className="text-lg font-semibold text-white">{selectedJob.job_name}</p>
                </div>
                
                {/* File Upload Controls */}
                <div className="border-l border-white border-opacity-30 pl-6">
                  <FileUploadButton 
                    job={selectedJob} 
                    onFileProcessed={handleFileProcessed} 
                  />
                </div>
              </div>
              
              <button
                onClick={handleBackToJobs}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
              >
                ← Back to Jobs
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Module Content */}
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
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
