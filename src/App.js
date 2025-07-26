import React, { useState, useEffect } from 'react';
import { Users, FileText, DollarSign, Calculator, Building } from 'lucide-react';
import EmployeeManagement from './components/EmployeeManagement';
import AdminJobManagement from './components/AdminJobManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import JobContainer from './components/job-modules/JobContainer';
import './App.css';

function App() {
  const [activeModule, setActiveModule] = useState('jobs');
  const [selectedJob, setSelectedJob] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState([]);
  
  // 🔧 ENHANCED: Central workflow state management with smart invalidation
  const [jobWorkflowStats, setJobWorkflowStats] = useState({});
  const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);
  
  // 🔧 NEW: Job metrics state for AdminJobManagement tiles
  const [jobMetrics, setJobMetrics] = useState({});
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [metricsRefreshTrigger, setMetricsRefreshTrigger] = useState(0);

  // Handle job selection
  const handleJobSelect = (job) => {
    setSelectedJob(job);
    setActiveModule('job-modules');
  };

  // Handle back to jobs
  const handleBackToJobs = () => {
    setSelectedJob(null);
    setActiveModule('jobs');
  };

  // 🔧 ENHANCED: Smart workflow stats update with preservation logic
  const updateJobWorkflowStats = (jobId, stats, saveToDatabase = false) => {
    setJobWorkflowStats(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId], // Preserve existing data
        ...stats,       // Apply new stats
        lastUpdated: new Date().toISOString()
      }
    }));

    // 🔧 NEW: Trigger metrics refresh when analytics complete
    if (stats.isProcessed && stats.isProcessed !== jobWorkflowStats[jobId]?.isProcessed) {
      console.log('📊 App.js: Analytics completed, triggering metrics refresh');
      refreshJobMetrics();
    }

    // TODO: Optional database persistence
    if (saveToDatabase) {
      console.log('📊 App.js: Would save to database:', stats);
    }
  };

  // 🔧 NEW: Refresh job metrics for AdminJobManagement tiles
  const refreshJobMetrics = async () => {
    console.log('🔄 App.js: Refreshing job metrics...');
    setMetricsRefreshTrigger(prev => prev + 1);
    
    // Note: The actual metric fetching happens in AdminJobManagement
    // This trigger causes AdminJobManagement to re-fetch its data
  };

  // 🔧 NEW: Handle job processing completion from AdminJobManagement
  const handleJobProcessingComplete = () => {
    console.log('🔄 App.js: Job processing completed, refreshing metrics');
    refreshJobMetrics();
  };

  // 🔧 FIXED: Smart file processing handler with preservation
  const handleFileProcessed = (result) => {
    console.log('🔄 App.js: File processed, triggering smart invalidation');
    
    // Increment refresh trigger for JobContainer
    setFileRefreshTrigger(prev => prev + 1);
    
    // 🔧 SMART INVALIDATION: Preserve settings, just flag as stale
    if (selectedJob?.id && jobWorkflowStats[selectedJob.id]) {
      setJobWorkflowStats(prev => ({
        ...prev,
        [selectedJob.id]: {
          ...prev[selectedJob.id], // PRESERVE existing settings & analytics
          needsRefresh: true,       // Flag for ProductionTracker warning
          lastFileUpdate: new Date().toISOString(), // Track when files changed
          // Keep existing: isProcessed, projectStartDate, infoByCategoryConfig, etc.
        }
      }));
      
      console.log('📊 App.js: Marked analytics as stale, preserved user settings');
    } else {
      console.log('📊 App.js: No existing workflow stats to preserve');
    }
  };

  // Get current workflow stats for selected job
  const getCurrentWorkflowStats = () => {
    return selectedJob?.id ? jobWorkflowStats[selectedJob.id] : null;
  };

  // Main navigation items
  const navigationItems = [
    {
      id: 'employees',
      name: 'Employee Management',
      icon: Users,
      component: EmployeeManagement
    },
    {
      id: 'jobs', 
      name: 'Current Jobs',
      icon: FileText,
      component: AdminJobManagement
    },
    {
      id: 'billing',
      name: 'Billing Management', 
      icon: DollarSign,
      component: BillingManagement
    },
    {
      id: 'payroll',
      name: 'Payroll Management',
      icon: Calculator, 
      component: PayrollManagement
    }
  ];

  // Render active module
  const renderActiveModule = () => {
    if (activeModule === 'job-modules' && selectedJob) {
      return (
        <JobContainer
          selectedJob={selectedJob}
          onBackToJobs={handleBackToJobs}
          workflowStats={getCurrentWorkflowStats()}
          onUpdateWorkflowStats={(stats) => updateJobWorkflowStats(selectedJob.id, stats, true)}
          fileRefreshTrigger={fileRefreshTrigger}
        />
      );
    }

    const activeNav = navigationItems.find(item => item.id === activeModule);
    if (!activeNav) return null;

    const Component = activeNav.component;
    const baseProps = {
      employees,
      setEmployees,
      jobs,
      setJobs
    };

    // Enhanced props for job management
    if (activeModule === 'jobs') {
      return (
        <Component
          {...baseProps}
          onJobSelect={handleJobSelect}
          onFileProcessed={handleFileProcessed}
          jobWorkflowStats={jobWorkflowStats}
          metricsRefreshTrigger={metricsRefreshTrigger}
          onJobProcessingComplete={handleJobProcessingComplete}
        />
      );
    }

    return <Component {...baseProps} />;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Building className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">LOJIK Management OS</h1>
                <p className="text-xs text-gray-500">Professional Property Appraisers Inc</p>
              </div>
            </div>
            
            {/* Navigation */}
            <nav className="flex space-x-1">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveModule(item.id)}
                    className={`px-3 py-2 rounded-md text-sm font-medium flex items-center space-x-2 transition-colors ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:block">{item.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* Job Selection Breadcrumb */}
        {selectedJob && (
          <div className="mb-6 flex items-center space-x-2 text-sm text-gray-600">
            <button
              onClick={handleBackToJobs}
              className="hover:text-blue-600 underline"
            >
              Current Jobs
            </button>
            <span>→</span>
            <span className="font-medium text-gray-900">{selectedJob.name}</span>
            
            {/* 🔧 NEW: Show workflow status in breadcrumb */}
            {getCurrentWorkflowStats()?.isProcessed && (
              <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                Analytics Ready
              </span>
            )}
            {getCurrentWorkflowStats()?.needsRefresh && (
              <span className="ml-2 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                Data Updated
              </span>
            )}
          </div>
        )}
        
        {renderActiveModule()}
      </main>
    </div>
  );
}

export default App;
