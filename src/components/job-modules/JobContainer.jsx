import React, { useState, useEffect } from 'react';
import { Building, Factory, TrendingUp, DollarSign, Scale, Database, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import ManagementChecklist from './ManagementChecklist';
import ProductionTracker from './ProductionTracker';
import MarketAnalysis from './MarketAnalysis';
import FinalValuation from './FinalValuation';
import AppealCoverage from './AppealCoverage';

// 🔧 ENHANCED: Accept App.js workflow state management props + file refresh trigger
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
  // Track if current module made changes
  const [moduleHasChanges, setModuleHasChanges] = useState(false);

  const [versionError, setVersionError] = useState(null);

  
  // NEW: Property loading states
  const [properties, setProperties] = useState([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  // NEW: State for all additional data tables
  const [inspectionData, setInspectionData] = useState([]);
  const [marketLandData, setMarketLandData] = useState({});
  const [hpiData, setHpiData] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [checklistStatus, setChecklistStatus] = useState([]);
  const [employees, setEmployees] = useState([]); 

  // NEW: Data update notification for child components
  const [dataUpdateNotification, setDataUpdateNotification] = useState({
    hasNewData: false,
    timestamp: null,
    source: null // 'file_upload', 'initial_load', etc
  });

  // Load latest file versions and properties
  useEffect(() => {
    if (selectedJob) {
      loadLatestFileVersions();
    }
  }, [selectedJob]);

  // NEW: Refresh when App.js signals file processing completion
  useEffect(() => {
    if (fileRefreshTrigger > 0 && selectedJob) {
      loadLatestFileVersions();
    }
  }, [fileRefreshTrigger, selectedJob]);

  const loadLatestFileVersions = async () => {
    if (!selectedJob?.id) return;
    console.log('📝 LOADING JOB DATA - No caching, fresh data every time');

    setIsLoadingVersion(true);
    setVersionError(null);
    setIsLoadingProperties(false);
    setLoadingProgress(0);
    setLoadedCount(0);

    // Direct database method
    console.log('📊 Loading job data using direct database calls...');

    try {
        console.log('🔍 Loading fresh data for job:', selectedJob.id);
      console.log('📡 Loading fresh data from database...');

      // Add timeout wrapper function
      const withTimeout = (promise, timeoutMs = 15000, operation = 'database query') => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`${operation} timeout after ${timeoutMs/1000} seconds`)), timeoutMs);
        });
        return Promise.race([promise, timeoutPromise]);
      };

      // Get ALL job data in ONE comprehensive query FIRST with timeout
      const { data: jobData, error: jobError } = await withTimeout(
        supabase
          .from('jobs')
          .select('*')  // Get ALL fields for this job
          .eq('id', selectedJob.id)
          .single(),
        10000,
        'job data query'
      );

      if (jobError) throw jobError;
      const hasAssignments = jobData?.has_property_assignments || false;

      // Get data version AND source file date from property_records table
      // Apply assignment filter if needed to get the correct date
      let dataVersionQuery = supabase
        .from('property_records')
        .select('file_version, updated_at')
        .eq('job_id', selectedJob.id);

      if (hasAssignments) {
        dataVersionQuery = dataVersionQuery.eq('is_assigned_property', true);
      }

      const { data: dataVersionData, error: dataVersionError } = await withTimeout(
        dataVersionQuery
          .order('file_version', { ascending: false })
          .limit(1)
          .single(),
        10000,
        'data version query'
      );

      // Get as_of_date from inspection_data table with timeout
      const { data: inspectionData, error: inspectionError } = await withTimeout(
        supabase
          .from('inspection_data')
          .select('upload_date')
          .eq('job_id', selectedJob.id)
          .order('upload_date', { ascending: false })
          .limit(1)
          .single(),
        10000,
        'inspection data query'
      );

      if (dataVersionError && dataVersionError.code !== 'PGRST116') throw dataVersionError;
      // Don't throw on inspection error - it might not exist yet

      const currentFileVersion = dataVersionData?.file_version || 1;
      const currentCodeVersion = jobData?.code_file_version || 1;


      setLatestFileVersion(currentFileVersion);
      setLatestCodeVersion(currentCodeVersion);
      
      // Now we're done with initial loading, start property loading
      setIsLoadingVersion(false);
      setIsLoadingProperties(true);

      // Build query for property count - ONLY latest version
      let propertyCountQuery = supabase
        .from('property_records')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', selectedJob.id)
        .eq('file_version', currentFileVersion);  // ← ONLY count latest version!

      // Apply assignment filter if needed
      if (hasAssignments) {
        propertyCountQuery = propertyCountQuery.eq('is_assigned_property', true);
      }

      // Get count first with timeout
      const { count, error: countError } = await withTimeout(
        propertyCountQuery,
        15000,
        'property count query'
      );
      if (countError) throw countError;

      setPropertyRecordsCount(count || 0);

      let allProperties = [];  // ADD THIS LINE!

      // Use client-side pagination with batches
      if (count && count > 0) {
        const batchSize = 100;
        const totalBatches = Math.ceil(count / batchSize);
        let retryCount = 0;
        const maxRetries = 3;

        console.log(`📥 Loading ${count} properties in ${totalBatches} batches...`);

        for (let batch = 0; batch < totalBatches; batch++) {
          const offset = batch * batchSize;
          const limit = Math.min(batchSize, count - offset);


          try {
            // Build the query for this batch with market analysis fields
            // CRITICAL FIX: Load only the latest version of properties
            let batchQuery = supabase
              .from('property_records')
              .select(`
                *,
                property_market_analysis!left (
                  location_analysis,
                  new_vcs,
                  asset_map_page,
                  asset_key_page,
                  asset_zoning,
                  values_norm_size,
                  values_norm_time,
                  sales_history
                )
              `)
              .eq('job_id', selectedJob.id)
              .eq('file_version', currentFileVersion)  // ← ONLY load latest version!
              .order('property_composite_key')
              .range(offset, offset + limit - 1);

            // Apply assignment filter if needed
            if (hasAssignments) {
              batchQuery = batchQuery.eq('is_assigned_property', true);
            }

            // Use the timeout wrapper for consistency
            const { data: batchData, error: batchError } = await withTimeout(
              batchQuery,
              30000,
              `property batch ${batch + 1}`
            );

            if (batchError) {
              // ENHANCED: Detailed error logging with all available information
              console.error(`❌ BATCH ${batch + 1} FAILED:`);
              console.error(`  Error Message: ${batchError.message || 'Unknown error'}`);
              console.error(`  Error Code: ${batchError.code || 'No code'}`);
              console.error(`  Error Details: ${batchError.details || 'No details'}`);
              console.error(`  Error Hint: ${batchError.hint || 'No hint'}`);
              console.error(`  Batch Info: ${offset}-${offset + limit - 1} of ${count} total records`);
              console.error(`  Query: property_records with market_analysis join`);
              console.error(`  Job ID: ${selectedJob.id}`);
              console.error(`  Has Assignments Filter: ${hasAssignments}`);
              if (batchError.stack) {
                console.error(`  Stack Trace: ${batchError.stack}`);
              }
              console.error(`  Full Error Object:`, batchError);

              // CRITICAL FIX: Stop processing on first failure
              if (batchError.message?.includes('timeout') || batchError.message?.includes('canceling statement')) {
                console.error(`🛑 DATABASE TIMEOUT ON BATCH ${batch + 1} - STOPPING ALL PROCESSING`);
                throw new Error(`Database timeout on batch ${batch + 1}. Loaded ${allProperties.length} of ${count} records before failure.`);
              }

              throw batchError;
            }

            if (batchData && batchData.length > 0) {
              // Flatten market analysis fields into property objects
              const processedData = batchData.map(property => {
                const marketAnalysis = property.property_market_analysis?.[0] || {};

                // Remove the nested property_market_analysis and flatten fields
                const { property_market_analysis, ...propertyData } = property;

                return {
                  ...propertyData,
                  // Flatten market analysis fields back onto the property
                  location_analysis: marketAnalysis.location_analysis || null,
                  new_vcs: marketAnalysis.new_vcs || null,
                  asset_map_page: marketAnalysis.asset_map_page || null,
                  asset_key_page: marketAnalysis.asset_key_page || null,
                  asset_zoning: marketAnalysis.asset_zoning || null,
                  values_norm_size: marketAnalysis.values_norm_size || null,
                  values_norm_time: marketAnalysis.values_norm_time || null,
                  sales_history: marketAnalysis.sales_history || null
                };
              });

              allProperties.push(...processedData);
              setLoadedCount(allProperties.length);
              setLoadingProgress(Math.round((allProperties.length / count) * 100));
              retryCount = 0; // Reset retry count on success
            }

            // Progressive delay - longer delay after more batches
            const delay = Math.min(200 + (batch * 10), 1000);
            if (batch < totalBatches - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }

          } catch (error) {
            // ENHANCED: Comprehensive error logging for debugging
            console.error(`🚨 CRITICAL ERROR ON BATCH ${batch + 1}:`);
            console.error(`  Error Type: ${error.constructor.name}`);
            console.error(`  Error Message: ${error.message || 'Unknown error'}`);
            console.error(`  Error Code: ${error.code || 'No code'}`);
            console.error(`  Error Details: ${error.details || 'No details'}`);
            console.error(`  Error Hint: ${error.hint || 'No hint'}`);
            console.error(`  Batch Range: ${offset}-${offset + limit - 1} (${limit} records)`);
            console.error(`  Total Expected: ${count} records`);
            console.error(`  Loaded So Far: ${allProperties.length} records`);
            console.error(`  Progress: ${Math.round((allProperties.length / count) * 100)}%`);
            console.error(`  Job ID: ${selectedJob.id}`);
            console.error(`  Assignment Filter: ${hasAssignments}`);
            if (error.stack) {
              console.error(`  Stack Trace: ${error.stack}`);
            }
            console.error(`  Full Error Object:`, error);

            // Additional context for timeout errors
            if (error.message?.includes('timeout')) {
              console.error(`  🔍 TIMEOUT ANALYSIS:`);
              console.error(`    - Timeout occurred after 30 seconds`);
              console.error(`    - This suggests database performance issues`);
              console.error(`    - Consider reducing batch size or optimizing query`);
              console.error(`    - Current batch size: ${batchSize} records`);
            }

            // STOP PROCESSING - don't continue to next batches
            setIsLoadingProperties(false);
            setLoadingProgress(Math.round((allProperties.length / count) * 100));

            // Set partial data and error - but ensure state is safe
            try {
              setProperties(allProperties);
              const errorMsg = `Failed loading batch ${batch + 1}. Loaded ${allProperties.length} of ${count} records. Error: ${error.message || 'Unknown database error'}`;
              setVersionError(errorMsg);
              console.error(`📝 Setting version error: ${errorMsg}`);
            } catch (stateError) {
              console.error('❌ Error setting state after batch failure:');
              console.error(`  State Error Message: ${stateError.message}`);
              console.error(`  State Error Stack: ${stateError.stack}`);
              setVersionError('Critical loading error - please refresh the page');
            }

            console.error(`🛑 STOPPING BATCH PROCESSING - DO NOT CONTINUE`);
            console.error(`📊 FINAL STATS: Loaded ${allProperties.length}/${count} records before failure`);
            return; // EXIT THE FUNCTION COMPLETELY
          }
        }

        setProperties(allProperties);
        setLoadingProgress(100);

        if (allProperties.length !== count) {
          console.warn(`⚠️ Expected ${count} properties but loaded ${allProperties.length}`);
        }

      } else {
        setProperties([]);
      }

// Load additional data tables
      console.log('📊 Loading additional data tables...');
      const allInspectionData = [];
      let inspectionPage = 0;
      let hasMoreInspection = true;
      
      try {
        while (hasMoreInspection) {
          const start = inspectionPage * 1000;
          const end = start + 999;

          const { data: batch, error } = await withTimeout(
            supabase
              .from('inspection_data')
              .select('*')
              .eq('job_id', selectedJob.id)
              .range(start, end),
            20000,
            `inspection data batch ${inspectionPage + 1}`
          );

          if (error) {
            console.error('❌ INSPECTION DATA BATCH ERROR:');
            console.error(`  Batch: ${inspectionPage + 1}, Range: ${start}-${end}`);
            console.error(`  Error Message: ${error.message || 'Unknown error'}`);
            console.error(`  Error Code: ${error.code || 'No code'}`);
            console.error(`  Error Details: ${error.details || 'No details'}`);
            console.error(`  Job ID: ${selectedJob.id}`);
            if (error.stack) {
              console.error(`  Stack: ${error.stack}`);
            }
            console.error(`  Full Error:`, error);
            break; // Stop loading inspection data but continue with other data
          }

          if (batch && batch.length > 0) {
            allInspectionData.push(...batch);
            inspectionPage++;
            hasMoreInspection = batch.length === 1000;
          } else {
            hasMoreInspection = false;
          }
        }
      } catch (inspectionError) {
        console.error('❌ INSPECTION DATA LOADING FAILED:');
        console.error(`  Error Message: ${inspectionError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${inspectionError.constructor.name}`);
        console.error(`  Job ID: ${selectedJob.id}`);
        console.error(`  Pages Attempted: ${inspectionPage}`);
        console.error(`  Records Loaded: ${allInspectionData.length}`);
        if (inspectionError.stack) {
          console.error(`  Stack: ${inspectionError.stack}`);
        }
        console.error(`  Full Error:`, inspectionError);
        // Continue with empty inspection data rather than failing completely
      }
      const inspectionDataFull = allInspectionData;
      
      // 2. Load market_land_valuation (for MarketAnalysis tabs)
      let marketData = null;
      try {
        const { data, error } = await withTimeout(
          supabase
            .from('market_land_valuation')
            .select('*')
            .eq('job_id', selectedJob.id)
            .single(),
          10000,
          'market land valuation query'
        );

        if (error && error.code !== 'PGRST116') {
          console.error('❌ MARKET DATA LOADING ERROR:');
          console.error(`  Error Message: ${error.message || 'Unknown error'}`);
          console.error(`  Error Code: ${error.code}`);
          console.error(`  Job ID: ${selectedJob.id}`);
          console.error(`  Full Error:`, error);
        } else {
          marketData = data;
        }

        // Create if doesn't exist
        if (!marketData) {
          try {
            const { data: newMarket } = await withTimeout(
              supabase
                .from('market_land_valuation')
                .insert({ job_id: selectedJob.id })
                .select()
                .single(),
              10000,
              'market land valuation insert'
            );
            marketData = newMarket;
          } catch (createError) {
            console.error('❌ MARKET DATA CREATION ERROR:');
            console.error(`  Error Message: ${createError.message || 'Unknown error'}`);
            console.error(`  Error Code: ${createError.code || 'No code'}`);
            console.error(`  Job ID: ${selectedJob.id}`);
            console.error(`  Full Error:`, createError);
            marketData = {}; // Fallback to empty object
          }
        }
      } catch (marketError) {
        console.error('❌ MARKET DATA LOADING FAILED:');
        console.error(`  Error Message: ${marketError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${marketError.constructor.name}`);
        console.error(`  Job ID: ${selectedJob.id}`);
        console.error(`  Full Error:`, marketError);
        marketData = {};
      }

      // 3. Load county_hpi_data (for PreValuation normalization)
      let hpiData = [];
      try {
        const { data, error } = await withTimeout(
          supabase
            .from('county_hpi_data')
            .select('*')
            .eq('county_name', jobData?.county || selectedJob.county)
            .order('observation_year', { ascending: true }),
          10000,
          'county HPI data query'
        );

        if (error) {
          console.error('❌ HPI DATA LOADING ERROR:');
          console.error(`  Error Message: ${error.message || 'Unknown error'}`);
          console.error(`  Error Code: ${error.code || 'No code'}`);
          console.error(`  County: ${jobData?.county || selectedJob.county}`);
          console.error(`  Job ID: ${selectedJob.id}`);
          console.error(`  Full Error:`, error);
        } else {
          hpiData = data || [];
        }
      } catch (hpiError) {
        console.error('❌ HPI DATA LOADING FAILED:');
        console.error(`  Error Message: ${hpiError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${hpiError.constructor.name}`);
        console.error(`  County: ${jobData?.county || selectedJob.county}`);
        console.error(`  Job ID: ${selectedJob.id}`);
        console.error(`  Full Error:`, hpiError);
      }

      // 4. Load checklist data (for ManagementChecklist)
      let checklistItems = [];
      let checklistStatus = [];
      try {
        const [itemsResult, statusResult] = await Promise.allSettled([
          withTimeout(
            supabase.from('checklist_items').select('*').eq('job_id', selectedJob.id),
            10000,
            'checklist items query'
          ),
          withTimeout(
            supabase.from('checklist_item_status').select('*').eq('job_id', selectedJob.id),
            10000,
            'checklist status query'
          )
        ]);

        if (itemsResult.status === 'fulfilled' && !itemsResult.value.error) {
          checklistItems = itemsResult.value.data || [];
        } else {
          const error = itemsResult.reason || itemsResult.value?.error;
          console.error('❌ CHECKLIST ITEMS LOADING ERROR:');
          console.error(`  Error Message: ${error?.message || 'Unknown error'}`);
          console.error(`  Error Code: ${error?.code || 'No code'}`);
          console.error(`  Job ID: ${selectedJob.id}`);
          console.error(`  Full Error:`, error);
        }

        if (statusResult.status === 'fulfilled' && !statusResult.value.error) {
          checklistStatus = statusResult.value.data || [];
        } else {
          const error = statusResult.reason || statusResult.value?.error;
          console.error('❌ CHECKLIST STATUS LOADING ERROR:');
          console.error(`  Error Message: ${error?.message || 'Unknown error'}`);
          console.error(`  Error Code: ${error?.code || 'No code'}`);
          console.error(`  Job ID: ${selectedJob.id}`);
          console.error(`  Full Error:`, error);
        }
      } catch (checklistError) {
        console.error('❌ CHECKLIST DATA LOADING FAILED:');
        console.error(`  Error Message: ${checklistError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${checklistError.constructor.name}`);
        console.error(`  Job ID: ${selectedJob.id}`);
        console.error(`  Full Error:`, checklistError);
      }

      // 5. Load employees (for ProductionTracker inspector names)
      let employeesData = [];
      try {
        const { data, error } = await withTimeout(
          supabase
            .from('employees')
            .select('*')
            .order('last_name', { ascending: true }),
          10000,
          'employees query'
        );

        if (error) {
          console.error('❌ EMPLOYEES DATA LOADING ERROR:');
          console.error(`  Error Message: ${error.message || 'Unknown error'}`);
          console.error(`  Error Code: ${error.code || 'No code'}`);
          console.error(`  Full Error:`, error);
        } else {
          employeesData = data || [];
        }
      } catch (employeesError) {
        console.error('❌ EMPLOYEES DATA LOADING FAILED:');
        console.error(`  Error Message: ${employeesError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${employeesError.constructor.name}`);
        console.error(`  Full Error:`, employeesError);
      }

      // SET ALL THE LOADED DATA TO STATE - with error boundaries
      try {
        setInspectionData(inspectionDataFull || []);
        setMarketLandData(marketData || {});
        setHpiData(hpiData || []);
        setChecklistItems(checklistItems || []);
        setChecklistStatus(checklistStatus || []);
        setEmployees(employeesData || []);
      } catch (stateError) {
        console.error('❌ STATE SETTING ERROR FOR ADDITIONAL DATA:');
        console.error(`  Error Message: ${stateError.message || 'Unknown error'}`);
        console.error(`  Error Type: ${stateError.constructor.name}`);
        console.error(`  Data Sizes: inspection=${inspectionDataFull?.length || 0}, market=${marketData ? 'object' : 'null'}, hpi=${hpiData?.length || 0}`);
        console.error(`  Job ID: ${selectedJob.id}`);
        if (stateError.stack) {
          console.error(`  Stack: ${stateError.stack}`);
        }
        console.error(`  Full Error:`, stateError);
        // Set safe defaults if state setting fails
        setInspectionData([]);
        setMarketLandData({});
        setHpiData([]);
        setChecklistItems([]);
        setChecklistStatus([]);
        setEmployees([]);
      }

      // Prepare enriched job data with all the fetched info
      const enrichedJobData = {
        ...selectedJob,
        updated_at: jobData?.updated_at || selectedJob.updated_at,
        manager_name: 'Manager Name Here', // TODO: Resolve from employees table using assigned_manager UUID
        due_year: selectedJob.end_date ? new Date(selectedJob.end_date).getFullYear() : 'TBD',
        latest_data_version: currentFileVersion,
        latest_code_version: currentCodeVersion,
        property_count: count || 0,
        
        // NEW: Add the properly fetched dates
        asOfDate: inspectionData?.upload_date || null,
        sourceFileDate: dataVersionData?.updated_at || null,
        end_date: jobData?.end_date || selectedJob.end_date,
        workflow_stats: jobData?.workflow_stats || selectedJob.workflowStats || null,

        // ADD THESE TWO LINES:
        parsed_code_definitions: jobData?.parsed_code_definitions || null,
        vendor_type: jobData?.vendor_type || null,
        has_property_assignments: hasAssignments
      };
      
      setJobData(enrichedJobData);

      console.log(`✅ Job data loaded: ${allProperties.length} properties`);
      
    } catch (error) {
      // ENHANCED: Comprehensive error logging for main catch block
      console.error('❌ CRITICAL ERROR IN LOADLATESTFILEVERSIONS:');
      console.error(`  Error Type: ${error.constructor.name}`);
      console.error(`  Error Message: ${error.message || 'Unknown error'}`);
      console.error(`  Error Code: ${error.code || 'No code'}`);
      console.error(`  Error Details: ${error.details || 'No details'}`);
      console.error(`  Error Hint: ${error.hint || 'No hint'}`);
      console.error(`  Job ID: ${selectedJob.id}`);
      console.error(`  Job Name: ${selectedJob.name || 'Unknown'}`);
      console.error(`  Function Stage: ${isLoadingVersion ? 'Initial Loading' : isLoadingProperties ? 'Property Loading' : 'Data Processing'}`);
      if (error.stack) {
        console.error(`  Stack Trace: ${error.stack}`);
      }
      console.error(`  Full Error Object:`, error);

      // Additional analysis for specific error types
      if (error.message?.includes('timeout')) {
        console.error(`  🔍 TIMEOUT ANALYSIS:`);
        console.error(`    - Function timed out during data loading`);
        console.error(`    - This indicates database performance issues`);
        console.error(`    - Try reducing batch sizes or checking database load`);
      }
      if (error.message?.includes('canceling statement')) {
        console.error(`  🔍 CANCELLATION ANALYSIS:`);
        console.error(`    - Database query was cancelled`);
        console.error(`    - This often indicates resource constraints`);
        console.error(`    - Consider optimizing queries or database indexing`);
      }

      // Handle different error types gracefully
      let errorMessage = 'Unknown error occurred';
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.code) {
        errorMessage = `Database error: ${error.code}`;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error?.name === 'AbortError') {
        errorMessage = 'Request timeout - dataset too large. Try again or contact support.';
      }

      console.error(`📝 Setting version error message: ${errorMessage}`);
      setVersionError(errorMessage);
      
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

  // Handle file upload completion - refresh version data
  const handleFileProcessed = async (fileType, fileName) => {
    console.log(`���� File processed: ${fileType} - ${fileName}`);
    
    console.log(`📝 File processed - will reload fresh data`);
    
    // Refresh file version data when new files are uploaded
    await loadLatestFileVersions();
    
    // NOTIFY child components that new data is available (ONLY after successful file upload)
    setDataUpdateNotification({
      hasNewData: true,
      timestamp: Date.now(),
      source: 'file_upload'
    });
    console.log('📢 Notifying components: New data available from file upload');
    
    // 🔧 ENHANCED: Invalidate ProductionTracker analytics when files change
    if (onUpdateWorkflowStats && selectedJob?.id) {
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

  // 🔧 ENHANCED: Handle ProductionTracker analytics completion with App.js notification
  const handleAnalyticsUpdate = (analyticsData) => {
    if (!onUpdateWorkflowStats || !selectedJob?.id) return;

    console.log('📊 Updating workflow stats from ProductionTracker');

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

    // 🔧 ENHANCED: Update App.js state with database persistence flag
    onUpdateWorkflowStats(transformedStats, true);
  };

// Determine which props to pass based on active module
  const getModuleProps = () => {
    const baseProps = {
      jobData,
      properties,  // Pass loaded properties
      inspectionData,  // NEW: Pass inspection data
      marketLandData,  // NEW: Pass market land valuation
      hpiData,  // NEW: Pass HPI data
      checklistItems,  // NEW: Pass checklist items
      checklistStatus,  // NEW: Pass checklist status
      employees,  // NEW: Pass employees data
      onBackToJobs,
      activeSubModule: activeModule,
      onSubModuleChange: setActiveModule,
      latestFileVersion,
      latestCodeVersion,
      propertyRecordsCount,
      onFileProcessed: handleFileProcessed,
      dataUpdateNotification,  // Pass notification to all components
      clearDataNotification: () => setDataUpdateNotification({  // Way to clear it
        hasNewData: false,
        timestamp: null,
        source: null
      }),
      onUpdateWorkflowStats: handleAnalyticsUpdate,  // Pass the analytics update handler
      currentWorkflowStats: workflowStats,  // Pass current workflow stats
      onDataChange: () => {
        // Mark that this module made changes
        setModuleHasChanges(true);
      }
    };

    // 🔧 CRITICAL: Pass App.js state management to ProductionTracker
    if (activeModule === 'production') {
      // CRITICAL DEBUG: Log what we're passing to ProductionTracker
      console.log(`🚨 PASSING TO PRODUCTION TRACKER:`);
      console.log(`  - properties.length: ${properties?.length || 0}`);
      console.log(`  - inspectionData.length: ${inspectionData?.length || 0}`);
      console.log(`  - employees.length: ${employees?.length || 0}`);
      console.log(`  - jobData.id: ${jobData?.id}`);
      console.log(`  - latestFileVersion: ${latestFileVersion}`);

      if (properties && properties.length > 0) {
        const sampleProp = properties[0];
        console.log(`  - Sample property keys:`, Object.keys(sampleProp));
        console.log(`  - Sample property inspection fields:`, {
          inspection_measure_by: sampleProp.inspection_measure_by,
          inspection_measure_date: sampleProp.inspection_measure_date,
          inspection_info_by: sampleProp.inspection_info_by
        });
      }

      return {
        ...baseProps,
        // Pass current workflow stats from App.js
        currentWorkflowStats: workflowStats,
        // Pass update function for analytics completion
        onAnalyticsUpdate: handleAnalyticsUpdate,
        // Direct access to App.js state updater if needed
        onUpdateWorkflowStats,
        // ADD THIS LINE: Pass the job refresh callback
        onJobProcessingComplete: onUpdateWorkflowStats
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

  // FIXED: Combined loading state check
  const isLoading = isLoadingVersion || isLoadingProperties;

  return (
    <div className="bg-white">
      {/* Enhanced File Version Status Banner with Progress Bar */}
      <div className="max-w-6xl mx-auto p-6">
        {/* IMPROVED: Clean loading banner with progress bar */}
        {isLoading && (
          <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-800">
                {isLoadingVersion ? 'Initializing job data...' : 'Loading property records'}
              </h3>
              {isLoadingVersion ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600"></div>
              ) : (
                <span className={`text-sm font-medium ${
                  loadingProgress > 90 ? 'text-green-600' : 'text-blue-600'
                }`}>
                  {loadingProgress}%
                </span>
              )}
            </div>
            
            {!isLoadingVersion && propertyRecordsCount > 0 && (
              <>
                {/* Progress bar */}
                <div className="mb-3">
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ease-out rounded-full ${
                        loadingProgress > 90 
                          ? 'bg-gradient-to-r from-green-500 to-green-600' 
                          : 'bg-gradient-to-r from-blue-500 to-blue-600'
                      }`}
                      style={{ width: `${loadingProgress}%` }}
                    />
                  </div>
                </div>
                
                {/* Status text */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    <span className="font-semibold text-gray-800">
                      {loadedCount.toLocaleString()}
                    </span> of <span className="font-semibold text-gray-800">
                      {propertyRecordsCount.toLocaleString()}
                    </span> records loaded
                    {jobData?.has_property_assignments && (
                      <span className="ml-2 text-amber-600">(assigned only)</span>
                    )}
                  </span>
                {loadingProgress > 90 && (
                  <span className="text-green-600 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Loading inspection data, market analysis, and checklists...
                  </span>
                )}  
                </div>
              </>
            )}
            
            {isLoadingVersion && (
              <div className="text-sm text-gray-500">
                Connecting to database and fetching job information
              </div>
            )}
          </div>
        )}

        {/* Show version info banner AFTER loading */}
        {!isLoading && (
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
                    onClick={() => {
                      if (isAvailable) {
                        // If leaving a module that made changes, refresh data
                        if (moduleHasChanges && activeModule !== module.id) {
                          console.log(`Module ${activeModule} had changes, will reload fresh data`);
                          setModuleHasChanges(false);
                        }
                        setActiveModule(module.id);
                      }
                    }}
                    disabled={!isAvailable || isLoading}
                    className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                      isActive
                        ? 'border-blue-500 text-blue-600'
                        : isAvailable && !isLoading
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
      </div>

      {/* Active Module Content - Each module controls its own container */}
      <div className="min-h-96">
        {/* FIXED: Show loading state while loading, then show component or "coming soon" */}
        {isLoading ? (
          <div className="text-center text-gray-500 py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Loading Module Data...</h3>
            <p className="text-sm">Preparing latest data version for module access.</p>
          </div>
        ) : ActiveComponent && jobData ? (
          <ActiveComponent
            {...getModuleProps()}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
};

export default JobContainer;
