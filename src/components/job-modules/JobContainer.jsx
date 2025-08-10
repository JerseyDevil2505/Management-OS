import React, { useState, useEffect } from 'react';
import { Building, Factory, TrendingUp, DollarSign, Scale, Database, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
// ... other imports

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
  const [latestCodeVersion, setLatestCodeVersion] = useState(1);
  const [propertyRecordsCount, setPropertyRecordsCount] = useState(0);
  const [isLoadingVersion, setIsLoadingVersion] = useState(true);
  const [versionError, setVersionError] = useState(null);
  
  // NEW: Property loading states
  const [properties, setProperties] = useState([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  // Load latest file versions and properties
  useEffect(() => {
    if (selectedJob) {
      loadLatestFileVersions();
    }
  }, [selectedJob]);

  // Refresh when App.js signals file processing completion
  useEffect(() => {
    if (fileRefreshTrigger > 0 && selectedJob) {
      loadLatestFileVersions();
    }
  }, [fileRefreshTrigger, selectedJob]);

  const loadLatestFileVersions = async () => {
    if (!selectedJob?.id) return;

    setIsLoadingVersion(true);
    setVersionError(null);
    setIsLoadingProperties(true);
    setLoadingProgress(0);
    setLoadedCount(0);

    try {
      // Get data version AND source file date from property_records table
      const { data: dataVersionData, error: dataVersionError } = await supabase
        .from('property_records')
        .select('file_version, updated_at')
        .eq('job_id', selectedJob.id)
        .order('file_version', { ascending: false })
        .limit(1)
        .single();

      // Get job data including assignment status
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('code_file_version, updated_at, end_date, workflow_stats, parsed_code_definitions, vendor_type, has_property_assignments')
        .eq('id', selectedJob.id)
        .single();

      if (dataVersionError && dataVersionError.code !== 'PGRST116') throw dataVersionError;
      if (jobError) throw jobError;

      const currentFileVersion = dataVersionData?.file_version || 1;
      const currentCodeVersion = jobData?.code_file_version || 1;
      const hasAssignments = jobData?.has_property_assignments || false;
      
      setLatestFileVersion(currentFileVersion);
      setLatestCodeVersion(currentCodeVersion);

      // Build query for property count and loading
      let propertyQuery = supabase
        .from('property_records')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', selectedJob.id);

      // Apply assignment filter if needed
      if (hasAssignments) {
        propertyQuery = propertyQuery.eq('is_assigned_property', true);
        console.log('📋 Loading only assigned properties (has_property_assignments = true)');
      } else {
        console.log('📋 Loading all properties (no assignments)');
      }

      // Get count first
      const { count, error: countError } = await propertyQuery;
      if (countError) throw countError;

      setPropertyRecordsCount(count || 0);
      console.log(`📊 Total properties to load: ${count}`);

      // Now load the actual properties with pagination
      if (count && count > 0) {
        const allProperties = [];
        const pageSize = 1000;
        const totalPages = Math.ceil(count / pageSize);

        for (let page = 0; page < totalPages; page++) {
          const start = page * pageSize;
          const end = Math.min(start + pageSize - 1, count - 1);
          
          console.log(`📥 Loading batch ${page + 1}/${totalPages} (${start}-${end})...`);
          
          // Build the query again for actual data
          let dataQuery = supabase
            .from('property_records')
            .select('*')
            .eq('job_id', selectedJob.id)
            .order('property_composite_key')
            .range(start, end);

          // Apply assignment filter if needed
          if (hasAssignments) {
            dataQuery = dataQuery.eq('is_assigned_property', true);
          }

          const { data, error } = await dataQuery;
          
          if (error) throw error;
          
          if (data) {
            allProperties.push(...data);
            const loaded = allProperties.length;
            setLoadedCount(loaded);
            setLoadingProgress(Math.round((loaded / count) * 100));
          }
          
          // Small delay between batches to prevent overwhelming the server
          if (page < totalPages - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        setProperties(allProperties);
        console.log(`✅ Successfully loaded ${allProperties.length} properties`);
      } else {
        setProperties([]);
      }

      // Get inspection data as_of_date
      const { data: inspectionData } = await supabase
        .from('inspection_data')
        .select('upload_date')
        .eq('job_id', selectedJob.id)
        .order('upload_date', { ascending: false })
        .limit(1)
        .single();

      // Prepare enriched job data
      const enrichedJobData = {
        ...selectedJob,
        updated_at: jobData?.updated_at || selectedJob.updated_at,
        manager_name: 'Manager Name Here',
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD',
        latest_data_version: currentFileVersion,
        latest_code_version: currentCodeVersion,
        property_count: count || 0,
        asOfDate: inspectionData?.upload_date || null,
        sourceFileDate: dataVersionData?.updated_at || null,
        end_date: jobData?.end_date || selectedJob.end_date,
        workflow_stats: jobData?.workflow_stats || selectedJob.workflowStats || null,
        parsed_code_definitions: jobData?.parsed_code_definitions || null,
        vendor_type: jobData?.vendor_type || null,
        has_property_assignments: hasAssignments
      };
      
      setJobData(enrichedJobData);

    } catch (error) {
      console.error('Error loading file versions:', error);
      setVersionError(error.message);
      
      // Fallback to basic job data
      const fallbackJobData = {
        ...selectedJob,
        manager_name: 'Manager Name Here',
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD',
        latest_data_version: 1,
        latest_code_version: 1,
        property_count: 0,
        asOfDate: null,
        sourceFileDate: null,
        workflow_stats: selectedJob.workflowStats || null
      };
      setJobData(fallbackJobData);
      setProperties([]);
    } finally {
      setIsLoadingVersion(false);
      setIsLoadingProperties(false);
      setLoadingProgress(100);
    }
  };

  // ... rest of the component code ...

  // Update getModuleProps to pass properties
  const getModuleProps = () => {
    const baseProps = {
      jobData,
      properties,  // NEW: Pass loaded properties
      onBackToJobs,
      activeSubModule: activeModule,
      onSubModuleChange: setActiveModule,
      latestFileVersion,
      latestCodeVersion,
      propertyRecordsCount,
      onFileProcessed: handleFileProcessed
    };

    // Pass specific props to ProductionTracker
    if (activeModule === 'production' && onUpdateWorkflowStats) {
      return {
        ...baseProps,
        currentWorkflowStats: workflowStats,
        onAnalyticsUpdate: handleAnalyticsUpdate,
        onUpdateWorkflowStats
      };
    }

    return baseProps;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white">
      {/* Enhanced File Version Status Banner with Progress Bar */}
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
                  : `Current Data Version: ${latestFileVersion} | Current Code Version: ${latestCodeVersion}`
                }
              </span>
              {jobData?.has_property_assignments && (
                <span className="ml-3 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded">
                  Assigned Properties Only
                </span>
              )}
            </div>
            {!versionError && (
              <div className="text-sm text-blue-600">
                <span>{propertyRecordsCount.toLocaleString()} properties available</span>
              </div>
            )}
          </div>
          
          {/* Progress Bar for Property Loading */}
          {isLoadingProperties && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Loading properties...</span>
                <span>{loadingProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Loaded {loadedCount.toLocaleString()} of {propertyRecordsCount.toLocaleString()}
              </p>
            </div>
          )}
          
          {versionError && (
            <div className="mt-2">
              <p className="text-sm text-red-700">
                {versionError}
              </p>
              <button
                onClick={loadLatestFileVersions}
                className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
              >
                Retry Loading
              </button>
            </div>
          )}
        </div>
      )}

      {/* ... rest of the component JSX ... */}
    </div>
  );
};

export default JobContainer;
