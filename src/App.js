import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
import { openDB } from 'idb';
import './App.css'; 
import AdminJobManagement from './components/AdminJobManagement';
import EmployeeManagement from './components/EmployeeManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/job-modules/FileUploadButton';
import LandingPage from './components/LandingPage';
import UserManagement from './components/UserManagement';

// ==========================================
// PERSISTENT CACHE CONFIGURATION
// ==========================================
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRY = {
  hot: 2 * 60 * 60 * 1000,        // 2 hours - use without checking
  warm: 24 * 60 * 60 * 1000,      // 24 hours - use but refresh in background
  cold: 7 * 24 * 60 * 60 * 1000   // 7 days - show stale warning
};

// ==========================================
// IndexedDB Setup for Large Data
// ==========================================
const initDB = () => {
  return openDB('LojikAppCache', 1, {
    upgrade(db) {
      // Create stores for different data types
      if (!db.objectStoreNames.contains('masterCache')) {
        db.createObjectStore('masterCache');
      }
      if (!db.objectStoreNames.contains('largeData')) {
        db.createObjectStore('largeData');
      }
    },
  });
};

const App = () => {
  // ==========================================
  // URL-BASED VIEW STATE (FIXES F5 ISSUE!)
  // ==========================================
// REPLACE WITH:
  const [activeView, setActiveView] = useState(() => {
    // Read from URL on initial load
    const path = window.location.pathname.slice(1) || 'admin-jobs';
    const validViews = ['admin-jobs', 'billing', 'employees', 'payroll', 'job-modules', 'users'];
    return validViews.includes(path) ? path : 'admin-jobs';
  });

  // Update URL when view changes
  const handleViewChange = useCallback((view) => {
    setActiveView(view);
    // Update URL without page reload
    window.history.pushState({}, '', `/${view}`);
  }, []);

  // Listen for browser back/forward buttons
useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const parts = path.split('/');
      
      // Handle job-specific URLs
      if (parts[1] === 'job' && parts[2]) {
        // Don't do anything here - the other useEffect handles job selection
        return;
      }
      
      // Handle main navigation
      const viewPath = path.slice(1) || 'admin-jobs';
      const validViews = ['dashboard', 'admin-jobs', 'billing', 'employees', 'payroll', 'users'];
      if (validViews.includes(viewPath)) {
        setActiveView(viewPath);
        setSelectedJob(null); // Clear job selection when navigating to main views
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ==========================================
  // PERFORMANCE MONITORING
  // ==========================================
  const performanceRef = useRef({
    appStartTime: Date.now(),
    cacheHits: 0,
    cacheMisses: 0,
    dbQueries: 0,
    avgLoadTime: 0
  });

  // ==========================================
  // DATABASE CONCURRENCY CONTROL
  // ==========================================
  const dbOperationRef = useRef({
    isLoading: false,
    pendingOperations: 0,
    lastOperationTime: 0
  });

  // ==========================================
  // PERSISTENT CACHE STATE
  // ==========================================
  const [masterCache, setMasterCache] = useState({
    // Core Data
    jobs: [],
    employees: [],
    managers: [],
    planningJobs: [],
    archivedJobs: [],
    jobCache: {},
    
    // Billing Data
    activeJobs: [],
    legacyJobs: [],
    expenses: [],
    receivables: [],
    distributions: [],
    billingMetrics: null,
    
    // Computed Data
    jobFreshness: {},
    assignedPropertyCounts: {},
    workflowStats: {},
    globalInspectionAnalytics: null,
    
    // Payroll Data
    archivedPayrollPeriods: [],
    dataRecency: [],

    // Additional Data for Components
    countyHpiData: [],
    jobResponsibilities: [],
    jobFreshness: {},
    
    // Cache Metadata
    version: CACHE_VERSION,
    lastFetched: {},
    isLoading: false,
    isInitialized: false,
    loadSource: null, // 'cache' | 'database' | 'hybrid'
    cacheAge: null
  });

  // UI State
  const [cacheStatus, setCacheStatus] = useState({
    isStale: false,
    isRefreshing: false,
    lastError: null,
    message: ''
  });

  // Job selection state
  const [selectedJob, setSelectedJob] = useState(null);
  const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);

    // Authentication state
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);  

  // Background refresh control
  const refreshTimerRef = useRef(null);
  const dbRef = useRef(null);

  // ==========================================
  // PERSISTENT STORAGE HELPERS
  // ==========================================
  const saveToStorage = useCallback(async (data) => {
    console.log('💾 Saving to storage, jobCache keys:', Object.keys(data.jobCache || {}));
    try {
      // Try IndexedDB first (no size limits)
      if (dbRef.current) {
        const dataToStore = {
          ...data,
          jobCache: data.jobCache || {},
          timestamp: Date.now(),
          version: CACHE_VERSION
        };
        
        // Store large data separately
        const largeFields = ['jobs', 'employees', 'activeJobs', 'legacyJobs'];
        const coreData = { ...dataToStore };
        
        for (const field of largeFields) {
          if (coreData[field] && coreData[field].length > 100) {
            await dbRef.current.put('largeData', coreData[field], field);
            coreData[field] = { _ref: field }; // Store reference instead
          }
        }
        
        await dbRef.current.put('masterCache', coreData, 'main');
        console.log('💾 Cache saved to IndexedDB');
        return true;
      }
    } catch (error) {
      console.error('IndexedDB save failed:', error);
      
      // Fallback to localStorage for critical data
      try {
        const minimalCache = {
          billingMetrics: data.billingMetrics,
          globalInspectionAnalytics: data.globalInspectionAnalytics,
          lastFetched: data.lastFetched,
          version: CACHE_VERSION,
          timestamp: Date.now()
        };
        localStorage.setItem('lojikCacheFallback', JSON.stringify(minimalCache));
        console.log('💾 Minimal cache saved to localStorage');
      } catch (e) {
        console.error('All storage methods failed:', e);
      }
    }
    return false;
  }, []);

  const loadFromStorage = useCallback(async () => {
    const startTime = Date.now();
    
    try {
      // Initialize IndexedDB
      if (!dbRef.current) {
        dbRef.current = await initDB();
      }
      
      // Try to load from IndexedDB
      const coreData = await dbRef.current.get('masterCache', 'main');
      
      if (coreData && coreData.version === CACHE_VERSION) {
        const cacheAge = Date.now() - coreData.timestamp;
        
        // Resolve large data references
        const fullData = { ...coreData };
        for (const [key, value] of Object.entries(coreData)) {
          if (value && typeof value === 'object' && value._ref) {
            fullData[key] = await dbRef.current.get('largeData', value._ref) || [];
          }
        }
        
        // Ensure jobCache is loaded
        fullData.jobCache = fullData.jobCache || {};
        console.log('📦 Loaded from storage, jobCache keys:', Object.keys(fullData.jobCache));
        
        const loadTime = Date.now() - startTime;
        console.log(`⚡ Cache loaded from IndexedDB in ${loadTime}ms (age: ${Math.floor(cacheAge / 60000)} minutes)`);
        
        // Determine cache freshness
        let loadSource = 'cache';
        let shouldBackgroundRefresh = false;
        
        if (cacheAge < CACHE_EXPIRY.hot) {
          console.log('🔥 HOT cache - using without refresh');
        } else if (cacheAge < CACHE_EXPIRY.warm) {
          console.log('♨️ WARM cache - using with background refresh');
          shouldBackgroundRefresh = true;
        } else if (cacheAge < CACHE_EXPIRY.cold) {
          console.log('❄️ COLD cache - showing stale warning');
          loadSource = 'cache-stale';
          shouldBackgroundRefresh = true;
        } else {
          console.log('💀 EXPIRED cache - will refresh');
          return null;
        }
        
        performanceRef.current.cacheHits++;
        
        return {
          data: fullData,
          cacheAge,
          loadSource,
          shouldBackgroundRefresh,
          loadTime
        };
      }
    } catch (error) {
      console.error('Failed to load from IndexedDB:', error);
      
      // Try localStorage fallback
      try {
        const fallback = localStorage.getItem('lojikCacheFallback');
        if (fallback) {
          const parsed = JSON.parse(fallback);
          if (parsed.version === CACHE_VERSION) {
            console.log('📦 Using localStorage fallback');
            return {
              data: parsed,
              cacheAge: Date.now() - parsed.timestamp,
              loadSource: 'fallback',
              shouldBackgroundRefresh: true,
              loadTime: Date.now() - startTime
            };
          }
        }
      } catch (e) {
        console.error('localStorage fallback failed:', e);
      }
    }
    
    performanceRef.current.cacheMisses++;
    return null;
  }, []);

  // ==========================================
  // INTELLIGENT DATA LOADING
  // ==========================================
  // ==========================================
  // JOB FRESHNESS CALCULATOR
  // ==========================================
  const loadJobFreshness = useCallback(async (jobList) => {
    const freshnessData = {};
    
    for (const job of jobList) {
      try {
        // Get last file upload time from property_records
        const { data: fileData } = await supabase
          .from('property_records')
          .select('updated_at')
          .eq('job_id', job.id)
          .order('updated_at', { ascending: false })
          .limit(1);
        
        // Get last production run time from inspection_data
        const { data: prodData } = await supabase
          .from('inspection_data')
          .select('upload_date')
          .eq('job_id', job.id)
          .order('upload_date', { ascending: false })
          .limit(1);
        
        freshnessData[job.id] = {
          lastFileUpload: fileData?.[0]?.updated_at || null,
          lastProductionRun: prodData?.[0]?.upload_date || null,
          needsUpdate: prodData?.[0]?.upload_date && fileData?.[0]?.updated_at ? 
            new Date(fileData[0].updated_at) > new Date(prodData[0].upload_date) : false
        };
      } catch (error) {
        console.error(`Error loading freshness for job ${job.id}:`, error);
        freshnessData[job.id] = {
          lastFileUpload: null,
          lastProductionRun: null,
          needsUpdate: false
        };
      }
    }
    
    return freshnessData;
  }, []);
  const loadMasterData = useCallback(async (options = {}) => {
    const { 
      force = false, 
      components = ['all'],
      background = false 
    } = options;

    // Don't interrupt if already loading (unless forced)
    if (masterCache.isLoading && !force) {
      console.log('⏳ Load already in progress, skipping...');
      return masterCache;
    }

    const loadStartTime = Date.now();
    
    // For background refreshes, don't show loading state
    if (!background) {
      setMasterCache(prev => ({ ...prev, isLoading: true }));
      setCacheStatus(prev => ({ ...prev, isRefreshing: true, message: 'Loading data...' }));
    }

    try {
      performanceRef.current.dbQueries++;
      
      const loadPromises = [];
      const loadKeys = [];

      // ==========================================
      // SMART QUERY BUILDER
      // ==========================================
      if (components.includes('all') || components.includes('jobs')) {
        loadKeys.push('jobs');
        loadPromises.push(
          supabase
            .from('jobs')
            .select(`
              *,
              job_responsibilities(count),
              job_contracts(
                contract_amount,
                retainer_percentage,
                retainer_amount,
                end_of_job_percentage,
                end_of_job_amount,
                first_year_appeals_percentage,
                first_year_appeals_amount,
                second_year_appeals_percentage,
                second_year_appeals_amount
              ),
              billing_events(
                id,
                billing_date,
                percentage_billed,
                status,
                invoice_number,
                amount_billed,
                billing_type,
                remaining_due
              ),
              workflow_stats,
              job_assignments(
                employee_id,
                role,
                employees!employee_id(id, first_name, last_name)
              )
            `)
            .order('created_at', { ascending: false })
        );
        
        loadKeys.push('countyHpi');
        loadPromises.push(
          supabase
            .from('county_hpi_data')
            .select('*')
            .order('county_name, observation_year')
        );

        loadKeys.push('jobResponsibilities');
        loadPromises.push(
          supabase
            .from('job_responsibilities')
            .select('*')
        ); 
      }

      if (components.includes('all') || components.includes('employees')) {
        loadKeys.push('employees');
        loadPromises.push(
          supabase
            .from('employees')
            .select(`
              *,
              job_assignments!employee_id(
                job_id,
                role,
                jobs!job_id(id, job_name, status)
              )
            `)
            .order('last_name')
        );
      }

      if (components.includes('all') || components.includes('planning')) {
        loadKeys.push('planning');
        loadPromises.push(
          supabase
            .from('planning_jobs')
            .select('*')
            .order('end_date')
        );
      }

      if (components.includes('all') || components.includes('billing')) {
        const currentYear = new Date().getFullYear();
        
        loadKeys.push('expenses');
        loadPromises.push(
          supabase
            .from('expenses')
            .select('*')
            .eq('year', currentYear)
        );

        loadKeys.push('receivables');
        loadPromises.push(
          supabase
            .from('office_receivables')
            .select('*')
            .order('created_at', { ascending: false })
        );

        loadKeys.push('distributions');
        loadPromises.push(
          supabase
            .from('shareholder_distributions')
            .select('*')
            .eq('year', currentYear)
        );
      }

      if (components.includes('all') || components.includes('payroll')) {
        loadKeys.push('payrollPeriods');
        loadPromises.push(
          supabase
            .from('payroll_periods')
            .select('*')
            .order('end_date', { ascending: false })
            .limit(12)
        );
      }

      // ==========================================
      // DATABASE CONCURRENCY CONTROL
      // ==========================================

      // Check if database is busy
      const timeSinceLastOp = Date.now() - dbOperationRef.current.lastOperationTime;
      const isBusy = dbOperationRef.current.isLoading || dbOperationRef.current.pendingOperations > 0;

      // If this is a background refresh and database is busy, defer it
      if (background && isBusy && timeSinceLastOp < 5000) {
        console.log('🔄 Database busy, deferring background refresh');
        setTimeout(() => loadMasterData(true), 10000); // Retry in 10 seconds
        return masterCache;
      }

      // Mark operation as starting
      dbOperationRef.current.isLoading = true;
      dbOperationRef.current.pendingOperations++;
      dbOperationRef.current.lastOperationTime = Date.now();

      // ==========================================
      // EXECUTE QUERIES WITH RETRY LOGIC
      // ==========================================
      const executeWithRetry = async (promises, maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Adjust timeout based on background vs foreground
            const timeoutDuration = background ? 60000 : 30000; // 60s for background, 30s for foreground

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Database timeout')), timeoutDuration)
            );

            const results = await Promise.race([
              Promise.all(promises),
              timeoutPromise
            ]);

            return results;

          } catch (error) {
            console.log(`🔄 Database operation attempt ${attempt}/${maxRetries} failed:`, error.message);

            if (attempt === maxRetries) {
              throw error;
            }

            // Exponential backoff: 2s, 4s, 8s
            const backoffTime = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
            console.log(`⏱️ Retrying in ${backoffTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffTime));
          }
        }
      };

      const results = await executeWithRetry(loadPromises);
      
      // Process results
      const updates = {
        lastFetched: {},
        loadSource: 'database'
      };
      
      results.forEach((result, index) => {
        const key = loadKeys[index];
        if (!result.error) {
          updates.lastFetched[key] = Date.now();
          
          switch(key) {
            case 'jobs':
              const allJobs = result.data || [];
              
              // Transform jobs to match what AdminJobManagement expects
              const transformedJobs = allJobs.map(job => ({
                ...job,
                // Core fields AdminJobManagement needs
                name: job.job_name || job.name || '',
                municipality: job.municipality || '',
                ccdd: job.ccdd || job.ccdd_code || '',
                county: job.county || '',
                vendor: job.vendor || '',
                status: job.status || 'active',
                
                // Transform property counts - use workflow_stats if available
                totalProperties: job.workflow_stats?.totalRecords || job.total_properties || 0,
                inspectedProperties: (typeof job.workflow_stats === 'string' ? JSON.parse(job.workflow_stats) : job.workflow_stats)?.validInspections || job.inspected_properties || 0,
                totalresidential: job.totalresidential || 0,
                totalcommercial: job.totalcommercial || 0,
                
                // Billing and dates
                percentBilled: job.percent_billed || 0,
                dueDate: job.due_date || job.target_completion_date || '',
                
                // Assignment flags
                has_property_assignments: job.has_property_assignments || false,
                assigned_has_commercial: job.assigned_has_commercial || false,
                assignedPropertyCount: job.job_responsibilities?.[0]?.count || 0,
                
                // Transform assigned managers from job_assignments
                assignedManagers: job.job_assignments?.map(ja => ({
                  id: ja.employee_id,
                  name: ja.employees ? 
                    `${ja.employees.first_name} ${ja.employees.last_name}` : 
                    'Unknown',
                  role: ja.role || 'Lead Manager'
                })) || [],
                
                // Workflow stats - read the ACTUAL fields ProductionTracker saves
                workflowStats: job.workflow_stats ? {
                  jobEntryRate: job.workflow_stats.jobEntryRate || 0,
                  jobRefusalRate: job.workflow_stats.jobRefusalRate || 0,
                  commercialCompletePercent: job.workflow_stats.commercialCompletePercent || 0,
                  pricingCompletePercent: job.workflow_stats.pricingCompletePercent || 0,
                  validInspections: job.workflow_stats.validInspections || 0,
                  totalRecords: job.workflow_stats.totalRecords || 0
                } : null
              }));
              
              updates.jobs = transformedJobs.filter(j => j.status === 'active');

              // CHECK URL for job selection after jobs load
              const path = window.location.pathname;
              const parts = path.split('/');
              if (parts[1] === 'job' && parts[2]) {
                const jobId = parts[2];
                const job = updates.jobs.find(j => j.id === jobId);
                if (job) {
                  setSelectedJob(job);
                  setActiveView('job-modules');
                  console.log('📍 Restored job from URL:', jobId);
                }
              }
              updates.archivedJobs = transformedJobs.filter(j => 
                j.status === 'archived' || j.status === 'draft'
              );
              updates.activeJobs = transformedJobs.filter(j => j.job_type === 'standard');
              updates.legacyJobs = transformedJobs.filter(j => j.job_type === 'legacy_billing');
              
              // Process workflow stats for quick lookup
              updates.workflowStats = {};
              transformedJobs.forEach(job => {
                if (job.workflowStats) {
                  updates.workflowStats[job.id] = job.workflowStats;
                }
              });
              
              // Calculate job freshness
              updates.jobFreshness = {};
              transformedJobs.forEach(job => {
                updates.jobFreshness[job.id] = {
                  lastFileUpload: job.last_file_upload || null,
                  lastProductionRun: job.last_production_run || null,
                  needsUpdate: false
                };
              });
              break;
              
            case 'employees':
              updates.employees = result.data || [];
              updates.managers = (result.data || []).filter(e => 
                e.inspector_type === 'management' || 
                e.inspector_type === 'Management'
              );
              break;
          
            case 'countyHpi':
              updates.countyHpiData = result.data || [];
              break;

            case 'jobResponsibilities':
              updates.jobResponsibilities = result.data || [];
              break;
              
            case 'planning':
              updates.planningJobs = result.data || [];
              break;
              
            case 'expenses':
              updates.expenses = result.data || [];
              break;
              
            case 'receivables':
              updates.receivables = result.data || [];
              break;
              
            case 'distributions':
              updates.distributions = result.data || [];
              break;
              
            case 'payrollPeriods':
              updates.archivedPayrollPeriods = result.data || [];
              break;
          }
        } else {
          console.error(`Failed to load ${key}:`, result.error?.message || result.error);
          console.error('Full error details:', {
            key: key,
            error: result.error,
            code: result.error?.code,
            message: result.error?.message,
            details: result.error?.details
          });
        }
      });
      
      // ==========================================
      // LOAD JOB FRESHNESS DATA
      // ==========================================
      if (updates.jobs && updates.jobs.length > 0) {
        updates.jobFreshness = await loadJobFreshness(updates.jobs);
      }

      // ==========================================
      // CALCULATE DERIVED METRICS
      // ==========================================
      if (updates.activeJobs || updates.legacyJobs) {
        updates.billingMetrics = calculateBillingMetrics(
          updates.activeJobs || masterCache.activeJobs,
          updates.legacyJobs || masterCache.legacyJobs,
          updates.planningJobs || masterCache.planningJobs,
          updates.expenses || masterCache.expenses,
          updates.receivables || masterCache.receivables
        );
      }

      if (updates.employees) {
        updates.globalInspectionAnalytics = calculateInspectionAnalytics(
          updates.employees
        );
      }

      // ==========================================
      // UPDATE STATE & PERSIST
      // ==========================================
      const loadTime = Date.now() - loadStartTime;
      performanceRef.current.avgLoadTime = 
        (performanceRef.current.avgLoadTime + loadTime) / 2;

      const now = Date.now();
      const newCache = {
        ...masterCache,
        ...updates,
        jobCache: masterCache.jobCache || {},  // ADD THIS LINE - preserve existing jobCache
        lastFetched: {
          ...masterCache.lastFetched,
          ...updates.lastFetched,
          all: components.includes('all') ? now : masterCache.lastFetched.all
        },
        isLoading: false,
        isInitialized: true,
        cacheAge: 0,
        version: CACHE_VERSION
      };

      setMasterCache(newCache);
      
      // Persist to storage
      await saveToStorage(newCache);
      
      if (!background) {
        setCacheStatus({
          isStale: false,
          isRefreshing: false,
          lastError: null,
          message: `Data loaded in ${(loadTime / 1000).toFixed(1)}s`
        });
      }

      console.log(`✅ Data loaded from database in ${loadTime}ms`);
      return newCache;
      
    } catch (error) {
      console.error('❌ Error loading data:', error);
      
      if (!background) {
        setMasterCache(prev => ({ ...prev, isLoading: false }));
        setCacheStatus(prev => ({
          ...prev,
          isRefreshing: false,
          lastError: error.message,
          message: 'Failed to load data'
        }));
      }
      
      throw error;
    }
  }, [masterCache, saveToStorage]);

// ==========================================
  // SURGICAL CACHE UPDATES
  // ==========================================
  const updateCacheItem = useCallback(async (type, id, data, options = {}) => {
    console.log('🔧 Updating cache item:', type, id);
    const { persist = true } = options;
    
    let updates = {};
    
    switch(type) {
      case 'job':
        updates = {
          jobs: masterCache.jobs.map(j => j.id === id ? { ...j, ...data } : j),
          activeJobs: masterCache.activeJobs.map(j => j.id === id ? { ...j, ...data } : j)
        };
        break;
        
      case 'billing_event':
        updates = {
          activeJobs: masterCache.activeJobs.map(job => {
            if (job.id === id) {
              return {
                ...job,
                billing_events: [...(job.billing_events || []), data]
              };
            }
            return job;
          })
        };
        
        // Recalculate billing metrics
        const newActiveJobs = updates.activeJobs || masterCache.activeJobs;
        updates.billingMetrics = calculateBillingMetrics(
          newActiveJobs,
          masterCache.legacyJobs,
          masterCache.planningJobs,
          masterCache.expenses,
          masterCache.receivables
        );
        break;  // <-- ADD THIS BREAK STATEMENT!
        
      case 'billing_event_status':
        // Update the billing event status in both activeJobs and legacyJobs
        updates = {
          activeJobs: masterCache.activeJobs.map(job => {
            if (job.billing_events) {
              return {
                ...job,
                billing_events: job.billing_events.map(event => 
                  event.id === id ? { ...event, status: data.status } : event
                )
              };
            }
            return job;
          }),
          legacyJobs: masterCache.legacyJobs.map(job => {
            if (job.billing_events) {
              return {
                ...job,
                billing_events: job.billing_events.map(event => 
                  event.id === id ? { ...event, status: data.status } : event
                )
              };
            }
            return job;
          })
        };
        
        // Recalculate billing metrics with updated data
        updates.billingMetrics = calculateBillingMetrics(
          updates.activeJobs,
          updates.legacyJobs,
          masterCache.planningJobs,
          masterCache.expenses,
          masterCache.receivables
        );
        break;
        
      case 'employee':
        updates = {
          employees: masterCache.employees.map(e => e.id === id ? { ...e, ...data } : e)
        };
        
        if (data.role === 'Manager' || data.can_be_lead) {
          updates.managers = updates.employees.filter(e => 
            e.role === 'Manager' || e.can_be_lead
          );
        }
        break;
        
      case 'expense':
        updates = {
          expenses: data.id 
            ? masterCache.expenses.map(e => e.id === data.id ? data : e)
            : [...masterCache.expenses, data]
        };
        break;
        
      case 'delete':
        switch(data.table) {
          case 'jobs':
            updates = {
              jobs: masterCache.jobs.filter(j => j.id !== id),
              activeJobs: masterCache.activeJobs.filter(j => j.id !== id)
            };
            break;
          case 'employees':
            updates = {
              employees: masterCache.employees.filter(e => e.id !== id),
              managers: masterCache.managers.filter(m => m.id !== id)
            };
            break;
        }
        break;
    }
    
    const newCache = { ...masterCache, ...updates };
    setMasterCache(newCache);
    
    if (persist) {
      await saveToStorage(newCache);
    }
    
    return newCache;
  }, [masterCache, saveToStorage]);

  // ==========================================
  // JOB-LEVEL CACHE MANAGEMENT (SECOND TIER)
  // ==========================================
  const updateJobCache = useCallback((jobId, data) => {
    console.log('🔍 updateJobCache called:', {
      jobId,
      hasData: !!data,
      currentCacheKeys: Object.keys(masterCache.jobCache || {})
    });
    if (data === null) {
      // Clear cache for this job (used after FileUpload)
      console.log(`🗑️ Clearing cache for job ${jobId}`);
      setMasterCache(prev => ({
        ...prev,
        jobCache: {
          ...prev.jobCache,
          [jobId]: undefined
        }
      }));
      // Don't trigger reload here - let FileUploadButton handle that
    } else {
      // Update cache for this job
      console.log(`📦 Updating cache for job ${jobId}`);
      setMasterCache(prev => ({
        ...prev,
        jobCache: {
          ...prev.jobCache,
          [jobId]: {
            ...data,
            timestamp: Date.now()
          }
        }
      }));
    }
  }, []);

  // ==========================================
  // JOB SELECTION HANDLERS
  // ==========================================
  const handleJobSelect = useCallback((job) => {
    setSelectedJob(job);
    setActiveView('job-modules');
    // Update URL when job is selected
    window.history.pushState({}, '', `/job/${job.id}`);
    
    // Clear job cache when selecting a job to force fresh data load
    if (job?.id && masterCache.jobCache?.[job.id]) {
      console.log(`🔄 Clearing cache for job ${job.id} on selection`);
      setMasterCache(prev => ({
        ...prev,
        jobCache: {
          ...prev.jobCache,
          [job.id]: undefined
        }
      }));
    }
  }, [masterCache.jobCache]);

  const handleBackToJobs = useCallback(() => {
    setSelectedJob(null);
    setActiveView('admin-jobs');
    // Reset URL when going back to jobs
    window.history.pushState({}, '', '/admin-jobs');
    
    // Refresh jobs data to show any updates made in modules
    console.log('🔄 Refreshing jobs data after returning from modules');
    loadMasterData({ force: true, components: ['jobs'] });
  }, [loadMasterData]);

  const handleFileProcessed = useCallback(() => {
    // Clear cache for this job after file upload
    if (selectedJob) {
      updateJobCache(selectedJob.id, null);
      setFileRefreshTrigger(prev => prev + 1);
    }
  }, [selectedJob, updateJobCache]);

  const handleWorkflowStatsUpdate = useCallback(() => {
    // Refresh jobs data when workflow stats change (from ProductionTracker)
    console.log('🔄 Workflow stats updated, refreshing jobs data...');
    loadMasterData({ force: true, components: ['jobs'] });
  }, [loadMasterData]);

  // ==========================================
  // BACKGROUND REFRESH MANAGER
  // ==========================================
  const scheduleBackgroundRefresh = useCallback((delay = CACHE_EXPIRY.warm) => {
    // Clear existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    
    refreshTimerRef.current = setTimeout(() => {
      console.log('🔄 Background refresh triggered');
      loadMasterData({ background: true });
    }, delay);
  }, [loadMasterData]);

  // ==========================================
  // CACHE INVALIDATION
  // ==========================================
  const invalidateCache = useCallback(async (components = ['all']) => {
    console.log('🗑️ Invalidating cache for:', components);
    
    if (components.includes('all')) {
      // Clear everything
      if (dbRef.current) {
        await dbRef.current.clear('masterCache');
        await dbRef.current.clear('largeData');
      }
      localStorage.removeItem('lojikCacheFallback');
      
      setMasterCache(prev => ({
        ...prev,
        lastFetched: {},
        isInitialized: false
      }));
    } else {
      // Selective invalidation
      setMasterCache(prev => ({
        ...prev,
        lastFetched: Object.keys(prev.lastFetched).reduce((acc, key) => {
          if (!components.includes(key)) {
            acc[key] = prev.lastFetched[key];
          }
          return acc;
        }, {})
      }));
    }
    
    // Force reload
    return loadMasterData({ force: true, components });
  }, [loadMasterData]);

  // ==========================================
  // CALCULATION FUNCTIONS
  // ==========================================
  const calculateBillingMetrics = (activeJobs, legacyJobs, planningJobs, expenses, receivables) => {
    let totalSigned = 0;
    let totalPaid = 0;
    let totalOpen = 0;
    let totalRemaining = 0;
    let totalRemainingExcludingRetainer = 0;
    
    // Process active jobs
    if (activeJobs) {
      activeJobs.forEach(job => {
        if (job.job_contracts?.[0]) {
          const contract = job.job_contracts[0];
          totalSigned += contract.contract_amount || 0;
          
          let jobPaid = 0;
          let jobOpen = 0;
          let totalPercentageBilled = 0;
          
          if (job.billing_events) {
            job.billing_events.forEach(event => {
              const amount = parseFloat(event.amount_billed || 0);
              if (event.status === 'P') {
                jobPaid += amount;
                totalPaid += amount;
              } else if (event.status === 'O') {
                jobOpen += amount;
                totalOpen += amount;
              }
              totalPercentageBilled += parseFloat(event.percentage_billed || 0);
            });
          }
          
          const jobRemaining = contract.contract_amount - jobPaid - jobOpen;
          totalRemaining += Math.max(0, jobRemaining);
          
          // Calculate remaining excluding retainer
          const remainingPercentage = Math.max(0, 1 - totalPercentageBilled);
          const remainingRetainer = (contract.retainer_amount || 0) * remainingPercentage;
          totalRemainingExcludingRetainer += Math.max(0, jobRemaining - remainingRetainer);
        }
      });
    }
    
    // Process legacy jobs
    if (legacyJobs) {
      const currentYear = new Date().getFullYear();
      legacyJobs.forEach(job => {
        if (job.billing_events) {
          job.billing_events.forEach(event => {
            const amount = parseFloat(event.amount_billed || 0);
            const billingYear = new Date(event.billing_date).getFullYear();
            
            if (event.status === 'O') {
              totalOpen += amount;
            } else if (event.status === 'P' && billingYear === currentYear) {
              totalPaid += amount;
            }
          });
        }
        
        if (job.job_contracts?.[0]) {
          const contract = job.job_contracts[0];
          const totalBilled = job.billing_events?.reduce((sum, event) => 
            sum + parseFloat(event.amount_billed || 0), 0) || 0;
          const jobRemaining = contract.contract_amount - totalBilled;
          
          if (jobRemaining > 0) {
            totalRemaining += jobRemaining;
            totalRemainingExcludingRetainer += jobRemaining * 0.9;
          }
        }
      });
    }
    
    // Process receivables
    if (receivables) {
      receivables.forEach(receivable => {
        const amount = parseFloat(receivable.amount || 0);
        if (receivable.status === 'P') {
          totalPaid += amount;
        } else if (receivable.status === 'O') {
          totalOpen += amount;
        }
      });
    }
    
    // Add planning jobs
    if (planningJobs) {
      planningJobs.forEach(job => {
        if (job.contract_amount) {
          const amount = parseFloat(job.contract_amount);
          totalSigned += amount;
          totalRemaining += amount;
          totalRemainingExcludingRetainer += amount * 0.9;
        }
      });
    }
    
    // Calculate expense metrics
    let currentExpenses = 0;
    let monthlyExpenses = new Array(12).fill(0);
    
    if (expenses) {
      const currentMonth = new Date().getMonth() + 1;
      expenses.forEach(expense => {
        const amount = parseFloat(expense.amount || 0);
        monthlyExpenses[expense.month - 1] += amount;
        if (expense.month <= currentMonth) {
          currentExpenses += amount;
        }
      });
    }
    
    // Calculate daily rate and projections
    const workingDaysYTD = new Date().getMonth() * 21; // Rough estimate
    const totalWorkingDays = 252; // Typical year
    const dailyExpenseRate = workingDaysYTD > 0 ? currentExpenses / workingDaysYTD : 0;
    const projectedExpenses = dailyExpenseRate * totalWorkingDays;
    
    // Calculate projected cash
    const plannedContractsTotal = planningJobs?.reduce((sum, job) => 
      sum + (job.contract_amount || 0), 0) || 0;
    const projectedCash = (totalPaid + totalOpen + totalRemaining) - (plannedContractsTotal * 0.6);
    const projectedProfitLoss = projectedCash - projectedExpenses;
    const projectedProfitLossPercent = projectedCash > 0 ? (projectedProfitLoss / projectedCash) * 100 : 0;
    
    return {
      totalSigned,
      totalPaid,
      totalOpen,
      totalRemaining,
      totalRemainingExcludingRetainer,
      dailyFringe: dailyExpenseRate,
      currentExpenses,
      projectedExpenses,
      profitLoss: totalPaid - currentExpenses,
      profitLossPercent: totalPaid > 0 ? ((totalPaid - currentExpenses) / totalPaid) * 100 : 0,
      projectedCash,
      projectedProfitLoss,
      projectedProfitLossPercent
    };
  };

  const calculateInspectionAnalytics = (employees) => {
    if (!employees || employees.length === 0) {
      return {
        totalInspections: 0,
        activeInspectors: 0,
        averagePerInspector: 0,
        topPerformers: []
      };
    }
    
    const activeInspectors = employees.filter(e => 
      e.employment_status === 'active' && 
      ['residential', 'commercial'].includes(e.inspector_type?.toLowerCase())
    );
    
    const totalInspections = activeInspectors.reduce((sum, emp) => 
      sum + (emp.total_inspections || 0), 0
    );
    
    const topPerformers = activeInspectors
      .sort((a, b) => (b.total_inspections || 0) - (a.total_inspections || 0))
      .slice(0, 5)
      .map(emp => ({
        id: emp.id,
        name: `${emp.first_name} ${emp.last_name}`,
        inspections: emp.total_inspections || 0
      }));
    
    return {
      totalInspections,
      activeInspectors: activeInspectors.length,
      averagePerInspector: activeInspectors.length > 0 
        ? Math.round(totalInspections / activeInspectors.length) 
        : 0,
      topPerformers
    };
  };

  // Check for existing session or dev mode on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      // Development auto-login - expanded conditions
      if (window.location.hostname.includes('production-black-seven') ||
          window.location.hostname === 'localhost' ||
          window.location.hostname.includes('github.dev') ||
          window.location.hostname.includes('preview') ||
          window.location.hostname.includes('fly.dev') ||
          window.location.hostname.includes('builder.io') ||
          window.location.search.includes('dev=true')) {
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
      setActiveView('employees');
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSelectedJob(null);
      setActiveView('admin-jobs');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };  

  // ==========================================
  // INITIAL LOAD WITH CACHE
  // ==========================================
  useEffect(() => {
    const initializeApp = async () => {
      const appStartTime = Date.now();
      console.log('🚀 App initializing...');
      
      // Try to load from cache first
      const cached = await loadFromStorage();
      
      if (cached && cached.data) {
        // Use cached data immediately
        setMasterCache({
          ...cached.data,
          isLoading: false,
          isInitialized: true,
          loadSource: cached.loadSource,
          cacheAge: cached.cacheAge
        });
        
        const initTime = Date.now() - appStartTime;
        console.log(`⚡ App ready in ${initTime}ms using ${cached.loadSource}`);
        
        // Show cache status
        if (cached.loadSource === 'cache-stale') {
          setCacheStatus({
            isStale: true,
            isRefreshing: false,
            lastError: null,
            message: `Using cached data from ${Math.floor(cached.cacheAge / 60000)} minutes ago`
          });
        }
        
        // Background refresh if needed
        if (cached.shouldBackgroundRefresh) {
          setTimeout(() => {
            console.log('🔄 Starting background refresh...');
            loadMasterData({ background: true });
          }, 1000); // Wait 1 second before background refresh
        }
        
        // Schedule next refresh
        scheduleBackgroundRefresh();
        
      } else {
        // No cache or expired - load fresh
        console.log('📡 No valid cache, loading from database...');
        await loadMasterData({ components: ['all'] });
        
        const initTime = Date.now() - appStartTime;
        console.log(`✅ App ready in ${initTime}ms (fresh load)`);
      }
    };
    
    initializeApp();
    
    // Cleanup
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []); // Only run once on mount

   // ==========================================
  // URL-BASED JOB RESTORATION (FIX FOR F5)
  // ==========================================
  useEffect(() => {
    // Only run if we have jobs loaded and no job currently selected
    if (masterCache.jobs && masterCache.jobs.length > 0 && !selectedJob) {
      const path = window.location.pathname;
      const parts = path.split('/');
      
      // Check if URL indicates a specific job
      if (parts[1] === 'job' && parts[2]) {
        const jobId = parts[2];
        const job = masterCache.jobs.find(j => j.id === jobId);
        
        if (job) {
          console.log('📍 Restoring job from URL after cache/data load:', jobId);
          setSelectedJob(job);
          setActiveView('job-modules');
        }
      }
    }
  }, [masterCache.jobs]); // Re-run when jobs are loaded/updated

  // ==========================================
  // VISIBILITY CHANGE HANDLER
  // ==========================================
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && masterCache.isInitialized) {
        const cacheAge = Date.now() - (masterCache.lastFetched.all || 0);
        
        if (cacheAge > CACHE_EXPIRY.warm) {
          console.log('👁️ App became visible, cache is stale, refreshing...');
          loadMasterData({ background: true });
        } else {
          console.log('👁️ App became visible, cache is fresh');
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [masterCache, loadMasterData]);

  // ==========================================
  // PERFORMANCE REPORTING
  // ==========================================
  useEffect(() => {
    const reportPerformance = () => {
      const stats = performanceRef.current;
      const uptime = (Date.now() - stats.appStartTime) / 1000;
      
      console.log('📊 Performance Report:', {
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        cacheHitRate: stats.cacheHits + stats.cacheMisses > 0 
          ? `${Math.round((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100)}%`
          : 'N/A',
        dbQueries: stats.dbQueries,
        avgLoadTime: `${Math.round(stats.avgLoadTime)}ms`
      });
    };
    
    // Report every 5 minutes
    const interval = setInterval(reportPerformance, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ==========================================
  // RENDER UI
  // ==========================================
  
  // Show loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Show landing page if not authenticated
  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Cache Status Bar - Errors Only */}
      {cacheStatus.lastError && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium text-center bg-red-100 text-red-800">
          {cacheStatus.message}
        </div>
      )}

      {/* Top Navigation - Updated with Management OS styling */}
      <div className="app-header">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center mb-4">
            <h1 style={{ 
              color: '#FFFFFF',
              fontSize: '2rem',
              fontWeight: 'bold',
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", 
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center'
            }}>
              Management OS
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-white opacity-95">
                {user.employeeData?.name || user.email} ({user.role})
              </span>
              <button
                onClick={() => {
                  setCacheStatus(prev => ({ ...prev, isRefreshing: true, message: 'Refreshing...' }));
                  loadMasterData({ force: true, components: ['all'] }).then(() => {
                    setCacheStatus(prev => ({ ...prev, isRefreshing: false, message: 'Data refreshed' }));
                    setTimeout(() => {
                      setCacheStatus(prev => ({ ...prev, message: '' }));
                    }, 2000);
                  });
                }}
                disabled={cacheStatus.isRefreshing}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200 disabled:opacity-50"
              >
                {cacheStatus.isRefreshing ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⟳</span> Refreshing...
                  </span>
                ) : (
                  '🔄 Refresh'
                )}
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
              >
                Logout
              </button>
            </div>
          </div>
          
          {/* Only show main navigation when NOT in job-specific modules */}
          {activeView !== 'job-modules' && (
            <nav className="flex space-x-4">
              <button
                onClick={() => handleViewChange('employees')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'employees'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'employees' ? { 
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                👥 Employees ({masterCache.employees.length})
              </button>
              <button
                onClick={() => handleViewChange('admin-jobs')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'admin-jobs'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'admin-jobs' ? { 
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                📋 Jobs ({masterCache.jobs.length})
              </button>
              <button
                onClick={() => handleViewChange('billing')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'billing'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'billing' ? { 
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                💰 Billing
              </button>
              <button
                onClick={() => handleViewChange('payroll')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'payroll'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'payroll' ? { 
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                💸 Payroll
              </button>
              <button
                onClick={() => handleViewChange('users')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'users'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'users' ? { 
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                🔐 Users
              </button>
            </nav>
          )}
          
          {/* Show job context when in job-specific modules */}
          {activeView === 'job-modules' && selectedJob && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-sm text-white opacity-75">Working on:</p>
                  <p className="text-lg font-semibold text-white">{selectedJob.job_name || selectedJob.name}</p>
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

      {/* Main Content */}
      <main className={activeView === 'job-modules' ? 'py-6 px-4' : 'max-w-7xl mx-auto py-6 sm:px-6 lg:px-8'}>
        {/* Show loading overlay for initial load only */}
        {!masterCache.isInitialized && masterCache.isLoading && (
          <div className="fixed inset-0 bg-white bg-opacity-75 z-50 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading application...</p>
            </div>
          </div>
        )}

        {/* Component Views */}
        {activeView === 'admin-jobs' && (
          <AdminJobManagement
            jobs={masterCache.jobs}
            onJobSelect={handleJobSelect}
            planningJobs={masterCache.planningJobs}
            archivedJobs={masterCache.archivedJobs}
            managers={masterCache.managers}
            countyHpiData={masterCache.countyHpiData}
            jobResponsibilities={masterCache.jobResponsibilities}
            jobFreshness={masterCache.jobFreshness}
            inspectionData={masterCache.inspectionData}
            workflowStats={masterCache.workflowStats}
            onDataUpdate={updateCacheItem}
            jobCache={masterCache.jobCache}
            onUpdateJobCache={updateJobCache}
            onRefresh={() => loadMasterData({ force: true, components: ['jobs'] })}
          />
        )}

        {activeView === 'billing' && (
          <BillingManagement
            activeJobs={masterCache.activeJobs}
            legacyJobs={masterCache.legacyJobs}
            planningJobs={masterCache.planningJobs}
            expenses={masterCache.expenses}
            receivables={masterCache.receivables}
            distributions={masterCache.distributions}
            billingMetrics={masterCache.billingMetrics}
            onDataUpdate={updateCacheItem}
            onRefresh={() => loadMasterData({ force: true, components: ['billing'] })}
          />
        )}

        {activeView === 'employees' && (
          <EmployeeManagement
            employees={masterCache.employees}
            globalAnalytics={masterCache.globalInspectionAnalytics}
            onDataUpdate={updateCacheItem}
            onRefresh={() => loadMasterData({ force: true, components: ['employees'] })}
          />
        )}

        {activeView === 'payroll' && (
          <PayrollManagement
            employees={masterCache.employees.filter(e => 
              ['active', 'part_time', 'full_time'].includes(e.employment_status) && 
              ['residential', 'management'].includes(e.inspector_type?.toLowerCase())
            )}      
            jobs={masterCache.jobs}
            archivedPeriods={masterCache.archivedPayrollPeriods}
            dataRecency={masterCache.dataRecency}
            onDataUpdate={updateCacheItem}
            onRefresh={() => loadMasterData({ force: true, components: ['payroll'] })}
          />
        )}

        {activeView === 'users' && (
          <UserManagement />
        )}

        {activeView === 'job-modules' && selectedJob && (
          <div>
            <JobContainer
              selectedJob={selectedJob}
              onBackToJobs={handleBackToJobs}
              jobCache={masterCache.jobCache}
              onUpdateJobCache={updateJobCache}
              fileRefreshTrigger={fileRefreshTrigger}
              onWorkflowStatsUpdate={handleWorkflowStatsUpdate}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
