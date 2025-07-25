import React, { useState, useEffect } from 'react';
import { Building, Factory, TrendingUp, DollarSign, Scale, Database, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import ManagementChecklist from './ManagementChecklist';
import ProductionTracker from './ProductionTracker';
import MarketAnalysis from './MarketAnalysis';
import FinalValuation from './FinalValuation';
import AppealCoverage from './AppealCoverage';

// 🔧 FIXED: Accept App.js workflow state management props + file refresh trigger
const JobContainer = ({ 
  selectedJob, 
  onBackToJobs, 
  workflowStats, 
  onUpdateWorkflowStats,
  fileRefreshTrigger 
}) => {
  const [activeModule, setActiveModule] = useState('checklist');
  const [jobData, setJobData] = useState(null);
  const [latestFileVersion, setLatestFileVersion] = useState(1);
  const [propertyRecordsCount, setPropertyRecordsCount] = useState(0);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);
  const [versionError, setVersionError] = useState(null);

  // Load latest file version and property count
  useEffect(() => {
    if (selectedJob) {
      loadLatestFileVersion();
    }
  }, [selectedJob]);

  // NEW: Refresh when App.js signals file processing completion
  useEffect(() => {
    if (fileRefreshTrigger > 0 && selectedJob) {
      console.log('🔄 JobContainer: File refresh triggered, reloading version data...');
      loadLatestFileVersion();
    }
  }, [fileRefreshTrigger, selectedJob]);

  const loadLatestFileVersion = async () => {
    if (!selectedJob?.id) return;

    setIsLoadingVersion(true);
    setVersionError(null);

    try {
      // FIXED: Get file version from jobs table (where FileUploadButton updates it)
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('source_file_version')
        .eq('id', selectedJob.id)
        .single();

      if (jobError) throw jobError;

      const currentVersion = jobData?.source_file_version || 1;
      setLatestFileVersion(currentVersion);

      // Get count of records from property_records for this job
      const { count, error: countError } = await supabase
        .from('property_records')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', selectedJob.id);

      if (countError) throw countError;

      setPropertyRecordsCount(count || 0);

      // Prepare enriched job data
      const enrichedJobData = {
        ...selectedJob,
        manager_name: 'Manager Name Here', // TODO: Resolve from employees table using assigned_manager UUID
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD',
        latest_file_version: currentVersion,
        property_count: count || 0
      };
      
      setJobData(enrichedJobData);

      console.log(`📊 JobContainer: Loaded version ${currentVersion} with ${count} property records`);

    } catch (error) {
      console.error('Error loading file version:', error);
      setVersionError(error.message);
      
      // Fallback to basic job data
      const fallbackJobData = {
        ...selectedJob,
        manager_name: 'Manager Name Here',
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD',
        latest_file_version: 1,
        property_count: 0
      };
      setJobData(fallbackJobData);
    } finally {
      setIsLoadingVersion(false);
    }
  };

  // Handle file upload completion - refresh version data
  const handleFileProcessed = async (fileType, fileName) => {
    console.log(`File processed: ${fileType} - ${fileName}`);
    
    // Refresh file version data when new files are uploaded
    await loadLatestFileVersion();
    
    // 🔧 ENHANCED: Invalidate ProductionTracker analytics when files change
    if (onUpdateWorkflowStats && selectedJob?.id) {
      console.log('📊 JobContainer: Invalidating analytics due to file update');
      onUpdateWorkflowStats({
        totalRecords: 0,
        validInspections: 0,
        jobEntryRate: 0,
        jobRefusalRate: 0,
        commercialCompletePercent: 0,
        pricingCompletePercent: 0,
        isProcessed: false,
        lastProcessed: null
      }, true);
    }
  };

  // 🔧 NEW: Handle ProductionTracker analytics completion
  const handleAnalyticsUpdate = (analyticsData) => {
    if (!onUpdateWorkflowStats || !selectedJob?.id) return;

    console.log('📊 JobContainer: Received analytics from ProductionTracker', analyticsData);

    // Transform ProductionTracker data to App.js format
    const transformedStats = {
      totalRecords: analyticsData.totalRecords || 0,
      validInspections: analyticsData.validInspections || 0,
      jobEntryRate: analyticsData.jobEntryRate || 0,
      jobRefusalRate: analyticsData.jobRefusalRate || 0,
      commercialCompletePercent: analyticsData.commercialCompletePercent || 0,
      pricingCompletePercent: analyticsData.pricingCompletePercent || 0,
      lastProcessed: new Date().toISOString(),
      isProcessed: true,

      // 🔧 ENHANCED: Include class breakdown for AdminJobManagement
      classBreakdown: analyticsData.classBreakdown || {},
      
      // Include billing analytics for completeness
      billingAnalytics: analyticsData.billingAnalytics || null,
      validationReport: analyticsData.validationReport || null,
      
      // Inspector stats for detailed analytics
      inspectorStats: analyticsData.inspectorStats || {}
    };

    // Update App.js state with both local and database persistence
    onUpdateWorkflowStats(transformedStats, true);
    
    console.log('📊 JobContainer: Analytics forwarded to App.js state management');
  };

  if (!selectedJob) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white">
        <div className="text-center text-gray-500 py-12">
          <Building className="w-16 h-16 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Job Selected</h3>
          <p>Please select a job from the Job Management to access modules.</p>
        </div>
      </div>
    );
  }

  const modules = [
    {
      id: 'checklist',
      name: 'Checklist',
      icon: Building,
      component: ManagementChecklist,
      description: 'Project checklist and documentation'
    },
    {
      id: 'production',
      name: 'ProductionTracker',
      icon: Factory,
      component: ProductionTracker,
      description: 'Analytics and validation engine'
    },
    {
      id: 'market-analysis',
      name: 'Market & Land Analysis',
      icon: TrendingUp,
      component: MarketAnalysis,
      description: 'Market analysis and land valuation'
    },
    {
      id: 'final-valuation',
      name: 'Final Valuation',
      icon: DollarSign,
      component: FinalValuation,
      description: 'Final property valuations'
    },
    {
      id: 'appeal-coverage',
      name: 'Appeal Coverage',
      icon: Scale,
      component: AppealCoverage,
      description: 'Appeal management and coverage'
    }
  ];

  const activeModuleData = modules.find(m => m.id === activeModule);
  const ActiveComponent = activeModuleData?.component;

  // 🔧 ENHANCED: Determine which props to pass based on active module
  const getModuleProps = () => {
    const baseProps = {
      jobData,
      onBackToJobs,
      activeSubModule: activeModule,
      onSubModuleChange: setActiveModule,
      latestFileVersion,
      propertyRecordsCount,
      onFileProcessed: handleFileProcessed
    };

    // 🔧 CRITICAL: Pass App.js state management to ProductionTracker
    if (activeModule === 'production' && onUpdateWorkflowStats) {
      return {
        ...baseProps,
        // Pass current workflow stats from App.js
        currentWorkflowStats: workflowStats,
        // Pass update function for analytics completion
        onAnalyticsUpdate: handleAnalyticsUpdate,
        // Direct access to App.js state updater if needed
        onUpdateWorkflowStats
      };
    }

    // 🔧 Future modules can get their specific props here
    if (activeModule === 'checklist') {
      return {
        ...baseProps,
        // ManagementChecklist could also update workflow stats
        onUpdateWorkflowStats
      };
    }

    return baseProps;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* File Version Status Banner */}
      {!isLoadingVersion && (
        <div className={`mb-6 rounded-lg border p-4 ${
          versionError 
            ? 'bg-red-50 border-red-200' 
            : 'bg-blue-50 border-blue-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {versionError ? (
                <AlertCircle className="w-5 h-5 text-red-600 mr-2" />
              ) : (
                <Database className="w-5 h-5 text-blue-600 mr-2" />
              )}
              <span className={`font-medium ${
                versionError ? 'text-red-800' : 'text-blue-800'
              }`}>
                {versionError 
                  ? 'Data Loading Error' 
                  : `Current Data Version: ${latestFileVersion}`
                }
              </span>
            </div>
            {!versionError && (
              <div className="text-sm text-blue-600">
                <span>{propertyRecordsCount.toLocaleString()} properties available</span>
              </div>
            )}
          </div>
          {versionError && (
            <div className="mt-2">
              <p className="text-sm text-red-700">
                {versionError}
              </p>
              <button
                onClick={loadLatestFileVersion}
                className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
              >
                Retry Loading
              </button>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoadingVersion && (
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
            <span className="text-gray-600">Loading latest data version...</span>
          </div>
        </div>
      )}

      {/* Module Navigation Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {modules.map((module) => {
              const IconComponent = module.icon;
              const isActive = activeModule === module.id;
              const isAvailable = module.component !== null;
              
              return (
                <button
                  key={module.id}
                  onClick={() => isAvailable && setActiveModule(module.id)}
                  disabled={!isAvailable || isLoadingVersion}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600'
                      : isAvailable && !isLoadingVersion
                      ? 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      : 'border-transparent text-gray-300 cursor-not-allowed'
                  }`}
                  title={!isAvailable ? 'Coming soon' : module.description}
                >
                  <IconComponent className="w-4 h-4" />
                  {module.name}
                  {!isAvailable && (
                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full ml-1">
                      Soon
                    </span>
                  )}
                  {/* 🔧 NEW: Show analytics indicator for ProductionTracker */}
                  {module.id === 'production' && workflowStats?.isProcessed && (
                    <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full ml-1">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Active Module Content */}
      <div className="min-h-96">
        {ActiveComponent && jobData ? (
          <ActiveComponent
            {...getModuleProps()}
          />
        ) : !isLoadingVersion ? (
          <div className="text-center text-gray-500 py-24">
            <div className="mb-4">
              {activeModuleData && <activeModuleData.icon className="w-16 h-16 mx-auto text-gray-400" />}
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {activeModuleData?.name} Coming Soon
            </h3>
            <p className="text-sm">
              {activeModuleData?.description} will be available in a future update.
            </p>
          </div>
        ) : (
          <div className="text-center text-gray-500 py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Loading Module Data...</h3>
            <p className="text-sm">Preparing latest data version for module access.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default JobContainer;
