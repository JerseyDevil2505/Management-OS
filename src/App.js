import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
import { openDB } from 'idb';
import './App.css'; 
import AdminJobManagement from './components/AdminJobManagement';
import EmployeeManagement from './components/EmployeeManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
// ... other component imports

// ==========================================
// PERSISTENT CACHE CONFIGURATION
// ==========================================
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRY = {
  hot: 5 * 60 * 1000,        // 5 minutes - use without checking
  warm: 30 * 60 * 1000,      // 30 minutes - use but refresh in background
  cold: 24 * 60 * 60 * 1000  // 24 hours - show stale warning
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
    const path = window.location.pathname.slice(1) || 'employees';
    const validViews = ['admin-jobs', 'billing', 'employees', 'payroll'];
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
      const path = window.location.pathname.slice(1) || 'admin-jobs';
      const validViews = ['dashboard', 'admin-jobs', 'billing', 'employees', 'payroll'];
      if (validViews.includes(path)) {
        setActiveView(path);
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
  // PERSISTENT CACHE STATE
  // ==========================================
  const [masterCache, setMasterCache] = useState({
    // Core Data
    jobs: [],
    employees: [],
    managers: [],
    planningJobs: [],
    archivedJobs: [],
    
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

  // Background refresh control
  const refreshTimerRef = useRef(null);
  const dbRef = useRef(null);

  // ==========================================
  // PERSISTENT STORAGE HELPERS
  // ==========================================
  const saveToStorage = useCallback(async (data) => {
    try {
      // Try IndexedDB first (no size limits)
      if (dbRef.current) {
        const dataToStore = {
          ...data,
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
                employee:employees(id, first_name, last_name)
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
              job_assignments(
                job_id,
                role,
                job:jobs(id, job_name, status)
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
      // EXECUTE QUERIES WITH TIMEOUT
      // ==========================================
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database timeout')), 30000)
      );

      const results = await Promise.race([
        Promise.all(loadPromises),
        timeoutPromise
      ]);
      
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
              updates.jobs = allJobs.filter(j => j.status === 'active');
              updates.archivedJobs = allJobs.filter(j => 
                j.status === 'archived' || j.status === 'draft'
              );
              updates.activeJobs = allJobs.filter(j => j.job_type === 'standard');
              updates.legacyJobs = allJobs.filter(j => j.job_type === 'legacy_billing');
              
              // Process workflow stats
              updates.workflowStats = {};
              allJobs.forEach(job => {
                if (job.workflow_stats) {
                  updates.workflowStats[job.id] = job.workflow_stats;
                }
              });
              
              // Process assigned managers
              allJobs.forEach(job => {
                if (job.job_assignments) {
                  job.assignedManagers = job.job_assignments.map(ja => ({
                    id: ja.employee_id,
                    name: ja.employee ? 
                      `${ja.employee.first_name} ${ja.employee.last_name}` : 
                      'Unknown',
                    role: ja.role
                  }));
                }
              });
              break;
              
            case 'employees':
              updates.employees = result.data || [];
              updates.managers = (result.data || []).filter(e => 
                e.role === 'Manager' || e.can_be_lead
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
          console.error(`Failed to load ${key}:`, result.error);
        }
      });

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
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Cache Status Bar */}
      {cacheStatus.message && (
        <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium text-center transition-all ${
          cacheStatus.isStale ? 'bg-yellow-100 text-yellow-800' :
          cacheStatus.lastError ? 'bg-red-100 text-red-800' :
          cacheStatus.isRefreshing ? 'bg-blue-100 text-blue-800' :
          'bg-green-100 text-green-800'
        }`}>
          {cacheStatus.isRefreshing && (
            <span className="inline-block animate-spin mr-2">🔄</span>
          )}
          {cacheStatus.message}
        </div>
      )}

      {/* Navigation */}
      <nav className="app-header shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-white mr-8">Management OS</h1>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleViewChange('employees')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'employees' 
                      ? 'bg-white bg-opacity-20 text-white shadow-md' 
                      : 'text-white hover:bg-white hover:bg-opacity-10'
                  }`}
                >
                  👥 Employees ({masterCache.employees.length})
                </button>
                <button
                  onClick={() => handleViewChange('admin-jobs')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'admin-jobs' 
                      ? 'bg-white bg-opacity-20 text-white shadow-md' 
                      : 'text-white hover:bg-white hover:bg-opacity-10'
                  }`}
                >
                  📋 Jobs ({masterCache.jobs.length})
                </button>
                <button
                  onClick={() => handleViewChange('billing')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'billing' 
                      ? 'bg-white bg-opacity-20 text-white shadow-md' 
                      : 'text-white hover:bg-white hover:bg-opacity-10'
                  }`}
                >
                  💰 Billing
                </button>
                <button
                  onClick={() => handleViewChange('payroll')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                    activeView === 'payroll' 
                      ? 'bg-white bg-opacity-20 text-white shadow-md' 
                      : 'text-white hover:bg-white hover:bg-opacity-10'
                  }`}
                >
                  💸 Payroll
                </button>
              </div>
            </div>
            
            {/* Cache Controls */}
            <div className="flex items-center space-x-3">
              {masterCache.loadSource === 'cache' && (
                <span className="text-xs text-white opacity-75">
                  📦 Cached {masterCache.cacheAge && `(${Math.floor(masterCache.cacheAge / 60000)}m ago)`}
                </span>
              )}
              <button
                onClick={() => invalidateCache(['all'])}
                className="px-4 py-2 bg-white bg-opacity-90 text-blue-600 rounded-md hover:bg-opacity-100 text-sm font-semibold shadow-md transition-all"
                title="Force refresh all data"
              >
                🔄 Refresh Data
              </button>
            </div>
          </div>
        </div>
      </nav>
            
            {/* Cache Controls */}
            <div className="flex items-center space-x-2">
              {masterCache.loadSource === 'cache' && (
                <span className="text-xs text-gray-500">
                  📦 Cached {masterCache.cacheAge && `(${Math.floor(masterCache.cacheAge / 60000)}m ago)`}
                </span>
              )}
              <button
                onClick={() => invalidateCache(['all'])}
                className="p-2 text-gray-400 hover:text-gray-600"
                title="Force refresh all data"
              >
                🔄
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
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
            planningJobs={masterCache.planningJobs}
            archivedJobs={masterCache.archivedJobs}
            managers={masterCache.managers}
            countyHpiData={masterCache.countyHpiData}
            jobResponsibilities={masterCache.jobResponsibilities}
            inspectionData={masterCache.inspectionData}
            workflowStats={masterCache.workflowStats}
            jobFreshness={masterCache.jobFreshness}
            onDataUpdate={updateCacheItem}
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
              e.employment_status === 'active' && 
              ['residential', 'management'].includes(e.inspector_type?.toLowerCase())
            )}
            jobs={masterCache.jobs}
            archivedPeriods={masterCache.archivedPayrollPeriods}
            dataRecency={masterCache.dataRecency}
            onDataUpdate={updateCacheItem}
            onRefresh={() => loadMasterData({ force: true, components: ['payroll'] })}
          />
        )}
      </main>
    </div>
  );
};

export default App;
