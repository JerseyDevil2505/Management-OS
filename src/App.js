import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
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
// LIVE DATA - NO CACHING
// ==========================================

const App = () => {
  // ==========================================
  // URL-BASED VIEW STATE (FIXES F5 ISSUE!)
  // ==========================================
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
    dbQueries: 0,
    avgLoadTime: 0
  });

  // ==========================================
  // LIVE DATA STATE - NO CACHING
  // ==========================================
  const [appData, setAppData] = useState({
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

    // Live State
    isLoading: false,
    isInitialized: false
  });

  // UI State
  const [loadingStatus, setLoadingStatus] = useState({
    isRefreshing: false,
    lastError: null,
    message: ''
  });

  // Job selection state
  const [selectedJob, setSelectedJob] = useState(null);

  // Authentication state
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
        console.error(`Error loading freshness for job ${job.id}:`, error.message);
        freshnessData[job.id] = {
          lastFileUpload: null,
          lastProductionRun: null,
          needsUpdate: false
        };
      }
    }
    
    return freshnessData;
  }, []);

  // ==========================================
  // LIVE DATA LOADING - NO CACHING
  // ==========================================
  const loadLiveData = useCallback(async (components = ['all']) => {
    console.log('📡 Loading fresh data from database:', components);

    try {
      setLoadingStatus(prev => ({ ...prev, isRefreshing: true, message: 'Loading fresh data...' }));
      setAppData(prev => ({ ...prev, isLoading: true }));

      const updates = {};

      // Load jobs data
      if (components.includes('jobs') || components.includes('all')) {
        console.log('📊 Loading jobs data...');

        const { data: jobsData } = await supabase
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
          .order('created_at', { ascending: false });

        if (jobsData) {
          // Transform jobs to match what AdminJobManagement expects
          const transformedJobs = jobsData.map(job => ({
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
          updates.jobFreshness = await loadJobFreshness(transformedJobs);

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
        }

        // Load county HPI data
        const { data: countyHpiData } = await supabase
          .from('county_hpi_data')
          .select('*')
          .order('county_name, observation_year');

        if (countyHpiData) {
          updates.countyHpiData = countyHpiData;
        }

        // Load job responsibilities
        const { data: jobResponsibilities } = await supabase
          .from('job_responsibilities')
          .select('*');

        if (jobResponsibilities) {
          updates.jobResponsibilities = jobResponsibilities;
        }
      }

      // Load employees data
      if (components.includes('employees') || components.includes('all')) {
        console.log('👥 Loading employees data...');

        const { data: employeesData } = await supabase
          .from('employees')
          .select(`
            *,
            job_assignments!employee_id(
              job_id,
              role,
              jobs!job_id(id, job_name, status)
            )
          `)
          .order('last_name');

        if (employeesData) {
          updates.employees = employeesData;
          updates.managers = employeesData.filter(e => 
            e.inspector_type === 'management' || 
            e.inspector_type === 'Management'
          );

          // Calculate global inspection analytics
          updates.globalInspectionAnalytics = calculateInspectionAnalytics(employeesData);
        }
      }

      // Load billing data
      if (components.includes('billing') || components.includes('all')) {
        console.log('💰 Loading billing data...');

        // Load planning jobs
        const { data: planningData } = await supabase
          .from('planning_jobs')
          .select('*')
          .order('end_date');

        if (planningData) {
          updates.planningJobs = planningData;
        }

        // Load expenses
        const currentYear = new Date().getFullYear();
        const { data: expensesData } = await supabase
          .from('expenses')
          .select('*')
          .eq('year', currentYear);

        if (expensesData) {
          updates.expenses = expensesData;
        }

        // Load receivables
        const { data: receivablesData } = await supabase
          .from('office_receivables')
          .select('*')
          .order('created_at', { ascending: false });

        if (receivablesData) {
          updates.receivables = receivablesData;
        }

        // Load distributions
        const { data: distributionsData } = await supabase
          .from('shareholder_distributions')
          .select('*')
          .eq('year', currentYear);

        if (distributionsData) {
          updates.distributions = distributionsData;
        }

        // Calculate billing metrics
        updates.billingMetrics = calculateBillingMetrics(
          updates.activeJobs || appData.activeJobs,
          updates.legacyJobs || appData.legacyJobs,
          updates.planningJobs || appData.planningJobs,
          updates.expenses || appData.expenses,
          updates.receivables || appData.receivables
        );
      }

      // Load payroll data
      if (components.includes('payroll') || components.includes('all')) {
        console.log('💼 Loading payroll data...');

        const { data: payrollData } = await supabase
          .from('payroll_periods')
          .select('*')
          .order('end_date', { ascending: false })
          .limit(12);

        if (payrollData) {
          updates.archivedPayrollPeriods = payrollData;
        }
      }

      // Update app data
      const newData = {
        ...appData,
        ...updates,
        isInitialized: true,
        isLoading: false
      };

      setAppData(newData);

      setLoadingStatus({
        isRefreshing: false,
        lastError: null,
        message: 'Data loaded successfully'
      });

      console.log('✅ Fresh data loaded successfully');
      performanceRef.current.dbQueries++;

      return newData;

    } catch (error) {
      console.error('❌ Error loading live data:', error);
      setAppData(prev => ({ ...prev, isLoading: false }));
      setLoadingStatus({
        isRefreshing: false,
        lastError: error.message,
        message: 'Error loading data'
      });
      throw error;
    }
  }, [appData, loadJobFreshness]);

  const updateAppData = useCallback(async (type, id, data) => {
    console.log('🔧 Updating app data:', type, id);

    // For any billing-related updates, just reload fresh data
    if (type.includes('billing') || type.includes('event')) {
      console.log('🔄 Billing data updated, reloading fresh data...');
      await loadLiveData(['billing']);
      return;
    }

    // For other updates, reload the appropriate section
    switch(type) {
      case 'job':
        await loadLiveData(['jobs']);
        break;
      case 'employee':
        await loadLiveData(['employees']);
        break;
      default:
        await loadLiveData(['all']);
    }

    return appData;
  }, [appData, loadLiveData]);

  // ==========================================
  // JOB SELECTION HANDLERS
  // ==========================================
  const handleJobSelect = useCallback((job) => {
    setSelectedJob(job);
    setActiveView('job-modules');
    // Update URL when job is selected
    window.history.pushState({}, '', `/job/${job.id}`);
    console.log(`🔄 Selected job ${job.id} - will load fresh data`);
  }, []);

  const handleBackToJobs = useCallback(() => {
    setSelectedJob(null);
    setActiveView('admin-jobs');
    // Reset URL when going back to jobs
    window.history.pushState({}, '', '/admin-jobs');
    
    // Refresh jobs data to show any updates made in modules
    console.log('🔄 Refreshing jobs data after returning from modules');
    loadLiveData(['jobs']);
  }, [loadLiveData]);

  const handleFileProcessed = useCallback(() => {
    console.log('📁 File processed acknowledged - jobs list will refresh when user returns to jobs');
  }, []);

  const handleWorkflowStatsUpdate = useCallback(() => {
    console.log('📊 Workflow stats updated - jobs list will refresh when user returns to jobs');
  }, []);

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
  // INITIAL LOAD
  // ==========================================
  useEffect(() => {
    const initializeApp = async () => {
      if (!user) return;

      console.log('🚀 App initializing with live data...');
      const appStartTime = Date.now();
      
      try {
        await loadLiveData(['all']);
        const initTime = Date.now() - appStartTime;
        console.log(`✅ App ready in ${initTime}ms (live data)`);
      } catch (error) {
        console.error('❌ Failed to initialize app:', error);
      }
    };
    
    initializeApp();
  }, [user]); // Only run when user is available

  // ==========================================
  // URL-BASED JOB RESTORATION (FIX FOR F5)
  // ==========================================
  useEffect(() => {
    // Only run if we have jobs loaded and no job currently selected
    if (appData.jobs && appData.jobs.length > 0 && !selectedJob) {
      const path = window.location.pathname;
      const parts = path.split('/');
      
      // Check if URL indicates a specific job
      if (parts[1] === 'job' && parts[2]) {
        const jobId = parts[2];
        const job = appData.jobs.find(j => j.id === jobId);
        
        if (job) {
          console.log('📍 Restoring job from URL after data load:', jobId);
          setSelectedJob(job);
          setActiveView('job-modules');
        }
      }
    }
  }, [appData.jobs, selectedJob]); // Re-run when jobs are loaded/updated

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

  // Show login if not authenticated
  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      {/* Header Navigation */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            {/* Logo/Title */}
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                LOJIK Administrative Management System
              </h1>
            </div>

            {/* User Info & Logout */}
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {user.employeeData?.name || user.email} ({user.role})
              </span>
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      {(loadingStatus.isRefreshing || loadingStatus.lastError || loadingStatus.message) && (
        <div className={`px-4 py-2 text-sm ${
          loadingStatus.lastError ? 'bg-red-50 text-red-700' : 
          loadingStatus.isRefreshing ? 'bg-blue-50 text-blue-700' : 
          'bg-green-50 text-green-700'
        }`}>
          <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <span>
              {loadingStatus.lastError || loadingStatus.message}
            </span>
            {loadingStatus.isRefreshing && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            )}
            <button
              onClick={() => {
                setLoadingStatus(prev => ({ ...prev, isRefreshing: true, message: 'Refreshing...' }));
                loadLiveData(['all']).then(() => {
                  setLoadingStatus(prev => ({ ...prev, isRefreshing: false, message: 'Data refreshed' }));
                  setTimeout(() => {
                    setLoadingStatus(prev => ({ ...prev, message: '' }));
                  }, 2000);
                });
              }}
              className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition-colors"
              disabled={loadingStatus.isRefreshing}
            >
              {loadingStatus.isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </div>
      )}

      {/* Main Navigation Tabs */}
      {!selectedJob && (
        <div className="bg-white border-b">
          <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-8">
              {/* Admin Jobs Tab */}
              <button
                onClick={() => handleViewChange('admin-jobs')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeView === 'admin-jobs'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                📋 Jobs ({appData.jobs.length})
              </button>

              {/* Employees Tab */}
              <button
                onClick={() => handleViewChange('employees')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeView === 'employees'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                👥 Employees ({appData.employees.length})
              </button>

              {/* Billing Tab */}
              <button
                onClick={() => handleViewChange('billing')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeView === 'billing'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                💰 Billing
              </button>

              {/* Payroll Tab */}
              <button
                onClick={() => handleViewChange('payroll')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeView === 'payroll'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                💼 Payroll
              </button>

              {/* Users Tab */}
              <button
                onClick={() => handleViewChange('users')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeView === 'users'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🔐 Users
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1">
        {/* Show loading overlay for initial load only */}
        {!appData.isInitialized && appData.isLoading && (
          <div className="fixed inset-0 bg-white bg-opacity-75 z-50 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading data...</p>
            </div>
          </div>
        )}

        {/* Admin Jobs Management */}
        {activeView === 'admin-jobs' && (
          <AdminJobManagement
            jobs={appData.jobs}
            onJobSelect={handleJobSelect}
            planningJobs={appData.planningJobs}
            archivedJobs={appData.archivedJobs}
            managers={appData.managers}
            countyHpiData={appData.countyHpiData}
            jobResponsibilities={appData.jobResponsibilities}
            jobFreshness={appData.jobFreshness}
            inspectionData={appData.inspectionData}
            workflowStats={appData.workflowStats}
            onDataUpdate={updateAppData}
            userRole={user.role}
            currentUser={user}
          />
        )}

        {/* Employee Management */}
        {activeView === 'employees' && (
          <EmployeeManagement
            employees={appData.employees}
            globalAnalytics={appData.globalInspectionAnalytics}
            onDataUpdate={updateAppData}
            userRole={user.role}
          />
        )}

        {/* Billing Management */}
        {activeView === 'billing' && (
          <BillingManagement
            activeJobs={appData.activeJobs}
            legacyJobs={appData.legacyJobs}
            planningJobs={appData.planningJobs}
            expenses={appData.expenses}
            receivables={appData.receivables}
            distributions={appData.distributions}
            billingMetrics={appData.billingMetrics}
            onDataUpdate={updateAppData}
            userRole={user.role}
          />
        )}

        {/* Payroll Management */}
        {activeView === 'payroll' && (
          <PayrollManagement
            employees={appData.employees.filter(e => 
              ['active', 'part_time', 'full_time'].includes(e.employment_status) && 
              e.inspector_type !== 'terminated'
            )}      
            jobs={appData.jobs}
            archivedPeriods={appData.archivedPayrollPeriods}
            dataRecency={appData.dataRecency}
            onDataUpdate={updateAppData}
            userRole={user.role}
          />
        )}

        {/* User Management */}
        {activeView === 'users' && (
          <UserManagement
            employees={appData.employees}
            onDataUpdate={updateAppData}
            userRole={user.role}
          />
        )}

        {/* Job Modules Container */}
        {activeView === 'job-modules' && selectedJob && (
          <JobContainer
            job={selectedJob}
            onBackToJobs={handleBackToJobs}
            onFileProcessed={handleFileProcessed}
            onWorkflowUpdate={handleWorkflowStatsUpdate}
            userRole={user.role}
            currentUser={user}
          />
        )}
      </div>
    </div>
  );
};

export default App;
