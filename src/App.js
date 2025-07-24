import React, { useState, useEffect } from 'react';
import AdminJobManagement from './components/AdminJobManagement';
import EmployeeManagement from './components/EmployeeManagement';
import JobContainer from './components/job-modules/JobContainer';
import { employeeService, jobService, propertyService, supabase } from './lib/supabaseClient';

function App() {
  const [selectedJob, setSelectedJob] = useState(null);
  const [currentView, setCurrentView] = useState('jobs');
  const [fileVersions, setFileVersions] = useState({});
  const [propertyRecordsCounts, setPropertyRecordsCounts] = useState({});
  
  // 🔧 ENHANCED: App.js becomes central data hub for all job module states
  const [jobMetrics, setJobMetrics] = useState({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Load file versions for each job
  const loadFileVersions = async () => {
    try {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, source_file_version, code_file_version')
        .eq('status', 'active');

      const versions = {};
      jobs?.forEach(job => {
        versions[job.id] = {
          source: job.source_file_version || 1,
          code: job.code_file_version || 1
        };
      });

      setFileVersions(versions);
    } catch (error) {
      console.error('Error loading file versions:', error);
    }
  };

  // Load property record counts for each job
  const loadPropertyRecordsCounts = async () => {
    try {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('status', 'active');

      const counts = {};
      
      if (jobs) {
        await Promise.all(
          jobs.map(async (job) => {
            try {
              const { count, error } = await supabase
                .from('property_records')
                .select('id', { count: 'exact', head: true })
                .eq('job_id', job.id);

              if (!error) {
                counts[job.id] = count || 0;
              }
            } catch (err) {
              console.error(`Error counting properties for job ${job.id}:`, err);
              counts[job.id] = 0;
            }
          })
        );
      }

      setPropertyRecordsCounts(counts);
    } catch (error) {
      console.error('Error loading property counts:', error);
    }
  };

  // 🔧 NEW: Refresh system for file updates
  const refreshJobsAndStats = async () => {
    console.log('🔄 Refreshing jobs and stats after file processing...');
    
    try {
      // Reload file versions and property counts
      await loadFileVersions();
      await loadPropertyRecordsCounts();
      
      // Trigger refresh in AdminJobManagement by incrementing refreshTrigger
      setRefreshTrigger(prev => prev + 1);
      
      console.log('✅ Refresh completed');
    } catch (error) {
      console.error('❌ Error during refresh:', error);
    }
  };

  // 🔧 ENHANCED: Handle analytics updates from PayrollProductionUpdater
  const handleAnalyticsUpdate = (jobId, analytics) => {
    console.log(`📊 App.js: Received analytics update for job ${jobId}`);
    
    setJobMetrics(prev => ({
      ...prev,
      [jobId]: {
        ...analytics,
        isProcessed: true,
        lastUpdated: new Date().toISOString()
      }
    }));
    
    console.log(`✅ App.js: Analytics stored for job ${jobId}`);
  };

  // 🔧 ENHANCED: Handle workflow stats updates
  const handleWorkflowStatsUpdate = (jobId, stats) => {
    console.log(`📈 App.js: Received workflow stats update for job ${jobId}`);
    
    setJobMetrics(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        ...stats,
        lastUpdated: new Date().toISOString()
      }
    }));
  };

  // Load initial data
  useEffect(() => {
    loadFileVersions();
    loadPropertyRecordsCounts();
  }, [refreshTrigger]); // Re-run when refreshTrigger changes

  // 🔧 ENHANCED: Invalidate analytics when files change
  const handleFileProcessed = (jobId, result) => {
    console.log(`📄 File processed for job ${jobId}, invalidating analytics...`);
    
    // Clear analytics for this job since data changed
    setJobMetrics(prev => ({
      ...prev,
      [jobId]: undefined
    }));
    
    // Refresh file versions and counts
    refreshJobsAndStats();
  };

  // Debug logging for jobMetrics
  useEffect(() => {
    console.log('🔍 App.js jobMetrics updated:', Object.keys(jobMetrics));
  }, [jobMetrics]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navigation Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-8">
              <h1 className="text-2xl font-bold text-gray-900">LOJIK Management OS</h1>
              
              <nav className="flex space-x-8">
                <button
                  onClick={() => {
                    setCurrentView('employees');
                    setSelectedJob(null);
                  }}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    currentView === 'employees' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  👥 Employee Management
                </button>
                
                <button
                  onClick={() => {
                    setCurrentView('jobs');
                    setSelectedJob(null);
                  }}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    currentView === 'jobs' 
                      ? 'bg-blue-100 text-blue-700' 
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  📋 Current Jobs
                </button>
                
                {/* Future: Billing and Payroll tabs */}
                <button
                  disabled
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-400 cursor-not-allowed"
                >
                  💰 Billing (Coming Soon)
                </button>
                
                <button
                  disabled
                  className="px-3 py-2 rounded-md text-sm font-medium text-gray-400 cursor-not-allowed"
                >
                  💼 Payroll (Coming Soon)
                </button>
              </nav>
            </div>
            
            {selectedJob && (
              <div className="text-sm text-gray-600">
                📂 Current Job: <span className="font-medium">{selectedJob.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Job Module View */}
        {selectedJob && (
          <JobContainer 
            jobData={selectedJob}
            onBackToJobs={() => setSelectedJob(null)}
            onJobUpdated={refreshJobsAndStats}  // 🔧 NEW: Refresh callback
            latestFileVersion={fileVersions[selectedJob.id]}
            propertyRecordsCount={propertyRecordsCounts[selectedJob.id]}
            currentWorkflowStats={jobMetrics[selectedJob.id]}
            onAnalyticsUpdate={(analytics) => handleAnalyticsUpdate(selectedJob.id, analytics)}
            onUpdateWorkflowStats={(stats) => handleWorkflowStatsUpdate(selectedJob.id, stats)}
            onFileProcessed={(result) => handleFileProcessed(selectedJob.id, result)}
          />
        )}

        {/* Employee Management View */}
        {currentView === 'employees' && !selectedJob && (
          <EmployeeManagement />
        )}

        {/* Admin Job Management View */}
        {currentView === 'jobs' && !selectedJob && (
          <AdminJobManagement 
            onJobSelect={setSelectedJob}
            jobMetrics={jobMetrics}
            isLoadingMetrics={false}
            refreshTrigger={refreshTrigger}  // 🔧 NEW: Pass refresh trigger
          />
        )}
      </div>
    </div>
  );
}

export default App;
