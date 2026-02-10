import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
import './App.css'; 
import AdminJobManagement from './components/AdminJobManagement';
import EmployeeManagement from './components/EmployeeManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/job-modules/FileUploadButton';
import AppealCoverage from './components/job-modules/AppealCoverage';
import LandingPage from './components/LandingPage';
import UserManagement from './components/UserManagement';
import OrganizationManagement from './components/OrganizationManagement';
import RevenueManagement from './components/RevenueManagement';
import AssessorDashboard from './components/AssessorDashboard';

/**
 * MANAGEMENT OS - LIVE DATA ARCHITECTURE
 * =====================================
 *
 * This application uses a LIVE DATA FIRST strategy with no persistent caching layer.
 *
 * KEY PRINCIPLES:
 * - Every navigation/view change loads fresh data from Supabase
 * - No stale data issues - always showing current database state
 * - Props-based distribution from App.js to all child components
 * - Selective updates only reload affected data sections
 *
 * DATA FLOW:
 * 1. App.js maintains central state for all module data
 * 2. loadLiveData() fetches directly from Supabase
 * 3. Data distributed via props to components
 * 4. Components call onDataUpdate() to trigger targeted refreshes
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - Batch loading (500-1000 records per query)
 * - Single load pattern in JobContainer
 * - Pagination for large datasets
 * - Deferred state updates to prevent React errors
 *
 * LOCAL STORAGE USAGE:
 * - UI preferences only (filters, view settings)
 * - No application data caching
 * - Session storage for unsaved form changes
 *
 * EXCEPTIONS:
 * - ProductionTracker: 5-minute cache on analytics raw data (45K+ records)
 * - This is the ONLY component with data caching for performance
 */

// ==========================================
// LIVE DATA ARCHITECTURE - NO PERSISTENT CACHING
// See documentation at top of file for details
// ==========================================

const App = () => {
  // ==========================================
  // Authentication state (move to top to avoid TDZ)
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // URL-BASED VIEW STATE (FIXES F5 ISSUE!)
  // ==========================================
  const [activeView, setActiveView] = useState(() => {
    // Read from URL on initial load
    const path = window.location.pathname.slice(1) || 'admin-jobs';
    const validViews = ['admin-jobs', 'billing', 'employees', 'payroll', 'appeal-coverage', 'job-modules', 'users', 'organizations', 'revenue', 'assessor-dashboard'];
    return validViews.includes(path) ? path : 'admin-jobs';
  });


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
      const validViews = ['dashboard', 'admin-jobs', 'billing', 'employees', 'payroll', 'appeal-coverage', 'users', 'organizations', 'revenue', 'assessor-dashboard'];
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

  // UI State - loading status tracking
  const [loadingStatus, setLoadingStatus] = useState({
    isStale: false,
    isRefreshing: false,
    lastError: null,
    message: ''
  });

  // Job selection state
  const [selectedJob, setSelectedJob] = useState(null);

  // Dev mode: "View As" impersonation state
  const [viewingAs, setViewingAs] = useState(null);

  // Change Password modal state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [cpCurrentPwd, setCpCurrentPwd] = useState('');
  const [cpNewPwd, setCpNewPwd] = useState('');
  const [cpConfirmPwd, setCpConfirmPwd] = useState('');
  const [cpError, setCpError] = useState('');
  const [cpSuccess, setCpSuccess] = useState('');

  // Simple helper - true for users allowed to access billing/payroll
  const isAdmin = (user?.role || '').toString().toLowerCase() === 'admin' || (user?.role || '').toString().toLowerCase() === 'owner';

  // Only the primary owner can access User Management
  const PRIMARY_OWNER_ID = '5df85ca3-7a54-4798-a665-c31da8d9caad';
  const canManageUsers = user?.id === PRIMARY_OWNER_ID;

  // Non-PPA assessor detection - assessor org users get the simplified dashboard
  const PPA_ORG_ID = '00000000-0000-0000-0000-000000000001';
  const userOrgId = user?.employeeData?.organization_id;
  const isRealAssessorUser = userOrgId && userOrgId !== PPA_ORG_ID;
  // When dev is using "View As", treat them as an assessor user
  const isAssessorUser = isRealAssessorUser || !!viewingAs;
  // The effective user for the assessor dashboard (real user or impersonated)
  const assessorUser = viewingAs ? {
    ...user,
    employeeData: viewingAs,
    role: viewingAs.role
  } : user;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setCpError('');
    setCpSuccess('');

    if (cpNewPwd.length < 6) {
      setCpError('New password must be at least 6 characters');
      return;
    }
    if (cpNewPwd !== cpConfirmPwd) {
      setCpError('New passwords do not match');
      return;
    }

    try {
      // Verify current password by attempting sign-in
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: cpCurrentPwd,
      });
      if (verifyError) {
        setCpError('Current password is incorrect');
        return;
      }

      // Update password via Supabase Auth
      const { error: updateError } = await supabase.auth.updateUser({
        password: cpNewPwd,
      });
      if (updateError) throw updateError;

      // Update stored password on employee record for admin visibility
      if (user.employeeData?.id) {
        await supabase
          .from('employees')
          .update({ initial_password: cpNewPwd })
          .eq('id', user.employeeData.id);
      }

      setCpSuccess('Password updated successfully');
      setCpCurrentPwd('');
      setCpNewPwd('');
      setCpConfirmPwd('');
      setTimeout(() => {
        setShowChangePassword(false);
        setCpSuccess('');
      }, 1500);
    } catch (err) {
      console.error('Error changing password:', err);
      setCpError(err.message || 'Failed to change password');
    }
  };

  const handleViewAs = (employee) => {
    setViewingAs(employee);
    setSelectedJob(null);
    setActiveView('assessor-dashboard');
    window.history.pushState({}, '', '/assessor-dashboard');
  };

  const handleExitViewAs = () => {
    setViewingAs(null);
    setActiveView('users');
    window.history.pushState({}, '', '/users');
  };

  // Update URL when view changes
  const handleViewChange = useCallback((view) => {
    // Prevent non-admins from navigating to billing/payroll
    const role = user?.role?.toString?.().toLowerCase?.() || '';
    const isAdminLocal = role === 'admin' || role === 'owner';
    if ((view === 'billing' || view === 'payroll') && !isAdminLocal) {
      setActiveView('employees');
      window.history.pushState({}, '', '/employees');
      return;
    }
    // Only primary owner can access users, organizations, and revenue
    if ((view === 'users' || view === 'organizations' || view === 'revenue') && user?.id !== PRIMARY_OWNER_ID) {
      setActiveView('employees');
      window.history.pushState({}, '', '/employees');
      return;
    }

    setActiveView(view);
    // Update URL without page reload
    window.history.pushState({}, '', `/${view}`);
  }, [user]);

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

        // For non-PPA jobs, load lightweight summary stats from property_records
        const isClientJob = job.organization_id && job.organization_id !== PPA_ORG_ID;
        if (isClientJob) {
          try {
            const { data: summaryData } = await supabase
              .from('property_records')
              .select('sales_date, sales_price, inspection_measure_by, inspection_measure_date, asset_type_use')
              .eq('job_id', job.id);

            if (summaryData && summaryData.length > 0) {
              const inspected = summaryData.filter(p =>
                p.inspection_measure_by && p.inspection_measure_by.trim() && p.inspection_measure_date
              );
              const measureDates = inspected
                .map(p => p.inspection_measure_date)
                .filter(Boolean)
                .map(d => new Date(d).getTime())
                .filter(t => !isNaN(t));
              const avgMeasureDate = measureDates.length > 0
                ? new Date(measureDates.reduce((a, b) => a + b, 0) / measureDates.length).toISOString().split('T')[0]
                : null;
              const mostRecentMeasureDate = measureDates.length > 0
                ? new Date(Math.max(...measureDates)).toISOString().split('T')[0]
                : null;
              const residential = summaryData.filter(p => {
                const use = (p.asset_type_use || '').toString();
                return use.startsWith('2') || use.startsWith('3A') || use === '1' || use.startsWith('1');
              });
              const commercial = summaryData.filter(p => {
                const use = (p.asset_type_use || '').toString();
                return use.startsWith('4') || use.startsWith('5');
              });

              freshnessData[job.id].clientSummary = {
                totalRecords: summaryData.length,
                inspectedCount: inspected.length,
                entryRate: summaryData.length > 0 ? Math.round((inspected.length / summaryData.length) * 100) : 0,
                avgMeasureDate,
                mostRecentMeasureDate,
                residentialCount: residential.length,
                commercialCount: commercial.length
              };
            }
          } catch (summaryError) {
            console.error(`Error loading client summary for job ${job.id}:`, summaryError.message);
          }
        }
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
          // Archived jobs (regardless of type) should appear in Legacy
          updates.activeJobs = transformedJobs.filter(j => j.job_type === 'standard' && !j.archived_at);
          updates.legacyJobs = transformedJobs.filter(j => j.job_type === 'legacy_billing' || j.archived_at);
          
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

        // Load expenses (last 3 years)
        const currentYear = new Date().getFullYear();
        const { data: expensesData } = await supabase
          .from('expenses')
          .select('*')
          .gte('year', currentYear - 2)
          .order('year', { ascending: false });

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

        // Load distributions (last 3 years)
        const { data: distributionsData } = await supabase
          .from('shareholder_distributions')
          .select('*')
          .gte('year', currentYear - 2)
          .order('year', { ascending: false });

        if (distributionsData) {
          updates.distributions = distributionsData;
        }

        // Calculate billing metrics
        updates.billingMetrics = calculateBillingMetrics(
          updates.activeJobs || appData.activeJobs,
          updates.legacyJobs || appData.legacyJobs,
          updates.planningJobs || appData.planningJobs,
          updates.expenses || appData.expenses,
          updates.receivables || appData.receivables,
          updates.distributions || appData.distributions
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
        isStale: false,
        isRefreshing: false,
        lastError: null,
        message: `Data loaded in ${((Date.now() - performanceRef.current.appStartTime) / 1000).toFixed(1)}s`
      });

      console.log('✅ Fresh data loaded successfully');
      performanceRef.current.dbQueries++;

      return newData;

    } catch (error) {
      console.error('❌ Error loading live data:', error);
      setAppData(prev => ({ ...prev, isLoading: false }));
      let errMsg = '';
      try {
        if (!error) errMsg = 'Unknown error';
        else if (typeof error === 'string') errMsg = error;
        else if (error.message) errMsg = error.message;
        else if (error.error) errMsg = error.error;
        else errMsg = JSON.stringify(error);
      } catch (e) {
        errMsg = String(error);
      }

      const message = typeof errMsg === 'string' && errMsg.toLowerCase().includes('timeout')
        ? 'Database timeout - system may be busy. Please try again.'
        : 'Failed to load data';

      setLoadingStatus({
        isStale: false,
        isRefreshing: false,
        lastError: errMsg,
        message
      });
      throw error;
    }
  }, [appData, loadJobFreshness]);

  // ==========================================
  // TARGETED DATA UPDATES
  // ==========================================
  const updateDataSection = useCallback(async (type, id, data) => {
    console.log('🔧 Updating app data:', type, id);

    // For any billing-related updates, just reload fresh data
    if (type.includes('billing') || type.includes('event')) {
      console.log('🔄 Billing data updated, reloading fresh jobs + billing...');
      await loadLiveData(['jobs', 'billing']);
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
    const backView = isAssessorUser ? 'assessor-dashboard' : 'admin-jobs';
    setActiveView(backView);
    window.history.pushState({}, '', `/${backView}`);

    // Refresh jobs data to show any updates made in modules
    console.log('🔄 Refreshing jobs data after returning from modules');
    loadLiveData(['jobs']);
  }, [loadLiveData, isAssessorUser]);

  const handleFileProcessed = useCallback(() => {
    console.log('📁 File processed acknowledged - jobs list will refresh when user returns to jobs');
  }, []);

  const handleWorkflowStatsUpdate = useCallback(() => {
    console.log('📊 Workflow stats updated - jobs list will refresh when user returns to jobs');
  }, []);

  const handleJobDataRefresh = useCallback(async (jobId, opts = {}) => {
    const { forceRefresh } = opts;
    if (forceRefresh) {
      console.log(`🔄 Force refreshing job data for job ${jobId}`);
      try {
        // Reload jobs data to get updated file versions and property counts
        await loadLiveData(['jobs']);
        console.log('✅ Job data refreshed successfully');
      } catch (error) {
        console.error('❌ Error refreshing job data:', error);
      }
    }
  }, [loadLiveData]);

  // ==========================================
  // CALCULATION FUNCTIONS
  // ==========================================
  const calculateBillingMetrics = (activeJobs, legacyJobs, planningJobs, expenses, receivables, distributions) => {
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
    
    // Process receivables - FILTER BY CURRENT YEAR ONLY
    if (receivables) {
      const currentYear = new Date().getFullYear();
      receivables.forEach(receivable => {
        // Only include receivables from current year
        if (new Date(receivable.created_at).getFullYear() === currentYear) {
          const amount = parseFloat(receivable.amount || 0);
          if (receivable.status === 'P') {
            totalPaid += amount;
          } else if (receivable.status === 'O') {
            totalOpen += amount;
          }
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
    
    // Calculate expense metrics - FILTER BY CURRENT YEAR ONLY
    let currentExpenses = 0;
    let monthlyExpenses = new Array(12).fill(0);

    if (expenses) {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      expenses.forEach(expense => {
        // Only include expenses from the current fiscal year
        if (expense.year === currentYear) {
          const amount = parseFloat(expense.amount || 0);
          monthlyExpenses[expense.month - 1] += amount;
          if (expense.month <= currentMonth) {
            currentExpenses += amount;
          }
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
      if (process.env.NODE_ENV === 'development' ||
          window.location.hostname.includes('production-black-seven') ||
          window.location.hostname === 'localhost' ||
          window.location.hostname.includes('github.dev') ||
          window.location.hostname.includes('preview') ||
          window.location.hostname.includes('fly.dev') ||
          window.location.hostname.includes('builder.io') ||
          window.location.hostname.includes('0.0.0.0') ||
          window.location.hostname.includes('127.0.0.1') ||
          window.location.port === '3001' ||
          window.location.search.includes('dev=true')) {
        setUser({
          id: '5df85ca3-7a54-4798-a665-c31da8d9caad', // Primary owner ID for dev mode
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
    const loginOrgId = userData?.employeeData?.organization_id;
    const loginIsAssessor = loginOrgId && loginOrgId !== '00000000-0000-0000-0000-000000000001';
    if (loginIsAssessor) {
      setActiveView('assessor-dashboard');
    } else if (userData.role === 'manager') {
      setActiveView('employees');
    }
  };

  // If a non-admin user becomes active and the current view is restricted, redirect them
  useEffect(() => {
    if (!user) return;
    // Only redirect REAL assessor users (not dev impersonation via "View As")
    if (isRealAssessorUser && activeView !== 'assessor-dashboard' && activeView !== 'job-modules') {
      setActiveView('assessor-dashboard');
      window.history.pushState({}, '', '/assessor-dashboard');
      return;
    }
    if (!isAdmin && (activeView === 'billing' || activeView === 'payroll')) {
      setActiveView('employees');
      window.history.pushState({}, '', '/employees');
    }
  }, [user, isAdmin, isRealAssessorUser, activeView]);

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
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Show landing page if not authenticated
  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Loading Status Bar - Errors Only */}
      {loadingStatus.lastError && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 py-2 text-sm font-medium text-center bg-red-100 text-red-800">
          {loadingStatus.message}
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
              alignItems: 'center',
              gap: '12px'
            }}>
              <img
                src="/lojik-logo.PNG"
                alt="LOJIK Logo"
                style={{
                  height: '40px',
                  width: 'auto',
                  objectFit: 'contain'
                }}
              />
              Property Assessment Copilot
            </h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-white opacity-95">
                {user.employeeData?.name || user.email} ({user.role})
              </span>
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
                disabled={loadingStatus.isRefreshing}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200 disabled:opacity-50"
              >
                {loadingStatus.isRefreshing ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⟳</span> Refreshing...
                  </span>
                ) : (
                  '🔄 Refresh'
                )}
              </button>
              <button
                onClick={() => setShowChangePassword(true)}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
                title="Change your password"
              >
                Change Password
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
          {activeView !== 'job-modules' && !isAssessorUser && (
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
                👥 Employees ({appData.employees.length})
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
                📋 Jobs ({appData.jobs.length})
              </button>
              <button
                onClick={() => handleViewChange('appeal-coverage')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'appeal-coverage'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'appeal-coverage' ? {
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                ⚖️ Appeal Coverage
              </button>
              {isAdmin && (
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
              )}
              {isAdmin && (
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
              )}
              {canManageUsers && (
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
              )}
              {canManageUsers && (
              <button
                onClick={() => handleViewChange('organizations')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'organizations'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'organizations' ? {
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                🏢 Organizations
              </button>
              )}
              {canManageUsers && (
              <button
                onClick={() => handleViewChange('revenue')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'revenue'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'revenue' ? {
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                💵 Revenue
              </button>
              )}
            </nav>
          )}
          
          {/* Assessor user nav - simplified, only shows when on dashboard */}
          {isAssessorUser && activeView !== 'job-modules' && (
            <nav className="flex space-x-4">
              <button
                onClick={() => handleViewChange('assessor-dashboard')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'assessor-dashboard'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'assessor-dashboard' ? { backgroundColor: '#FFFFFF', opacity: 1, backdropFilter: 'none' } : {}}
              >
                📋 Dashboard
              </button>
              <button
                onClick={() => handleViewChange('admin-jobs')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'admin-jobs'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'admin-jobs' ? { backgroundColor: '#FFFFFF', opacity: 1, backdropFilter: 'none' } : {}}
              >
                📂 Job Management
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
                
                {/* File Upload Controls - Code File Only */}
                <div className="border-l border-white border-opacity-30 pl-6">
                  <FileUploadButton
                    job={selectedJob}
                    onFileProcessed={handleFileProcessed}
                    onDataRefresh={handleFileProcessed}
                    onUpdateJobCache={handleJobDataRefresh}
                    codeFileOnly={true}
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
        {!appData.isInitialized && appData.isLoading && (
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
            isAdmin={isAdmin}
            jobs={isAssessorUser
              ? appData.jobs.filter(j => j.organization_id === (viewingAs?.organization_id || userOrgId))
              : appData.jobs}
            onJobSelect={handleJobSelect}
            planningJobs={isAssessorUser
              ? appData.planningJobs.filter(j => j.organization_id === (viewingAs?.organization_id || userOrgId))
              : appData.planningJobs}
            archivedJobs={isAssessorUser
              ? appData.archivedJobs.filter(j => j.organization_id === (viewingAs?.organization_id || userOrgId))
              : appData.archivedJobs}
            managers={appData.managers}
            countyHpiData={appData.countyHpiData}
            jobResponsibilities={appData.jobResponsibilities}
            jobFreshness={appData.jobFreshness}
            inspectionData={appData.inspectionData}
            workflowStats={appData.workflowStats}
            onDataUpdate={updateDataSection}
            onRefresh={() => loadLiveData(['jobs'])}
          />
        )}

        {activeView === 'billing' && (isAdmin ? (
          <BillingManagement
            activeJobs={appData.activeJobs}
            legacyJobs={appData.legacyJobs}
            planningJobs={appData.planningJobs}
            expenses={appData.expenses}
            receivables={appData.receivables}
            distributions={appData.distributions}
            billingMetrics={appData.billingMetrics}
            onDataUpdate={updateDataSection}
            onRefresh={() => loadLiveData(['billing'])}
          />
        ) : (
          <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 text-center">
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-sm text-gray-600">You do not have permission to view Billing.</p>
          </div>
        ))}

        {activeView === 'employees' && (
          <EmployeeManagement
            employees={appData.employees}
            globalAnalytics={appData.globalInspectionAnalytics}
            onDataUpdate={updateDataSection}
            onRefresh={() => loadLiveData(['employees'])}
          />
        )}

        {activeView === 'payroll' && (isAdmin ? (
          <PayrollManagement
            employees={appData.employees.filter(e =>
              ['active', 'part_time', 'full_time'].includes(e.employment_status) &&
              ['residential', 'management'].includes(e.inspector_type?.toLowerCase())
            )}
            jobs={appData.jobs}
            archivedPeriods={appData.archivedPayrollPeriods}
            dataRecency={appData.dataRecency}
            onDataUpdate={updateDataSection}
            onRefresh={() => loadLiveData(['payroll'])}
          />
        ) : (
          <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 text-center">
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-sm text-gray-600">You do not have permission to view Payroll.</p>
          </div>
        ))}

        {activeView === 'appeal-coverage' && (
          <AppealCoverage />
        )}

        {activeView === 'users' && (isAdmin ? (
          <UserManagement onViewAs={handleViewAs} />
        ) : (
          <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200 text-center">
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-sm text-gray-600">You do not have permission to view Users.</p>
          </div>
        ))}

        {activeView === 'organizations' && canManageUsers && (
          <OrganizationManagement />
        )}

        {activeView === 'revenue' && canManageUsers && (
          <RevenueManagement />
        )}

        {activeView === 'assessor-dashboard' && isAssessorUser && (
          <>
            {viewingAs && (
              <div style={{
                background: '#7c3aed', color: 'white', padding: '8px 16px',
                borderRadius: '8px', marginBottom: '16px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>
                  Viewing as: {viewingAs.first_name} {viewingAs.last_name} ({viewingAs.email})
                </span>
                <button
                  onClick={handleExitViewAs}
                  style={{
                    padding: '4px 14px', borderRadius: '6px', fontWeight: '600', fontSize: '0.8rem',
                    background: 'white', color: '#7c3aed', border: 'none', cursor: 'pointer'
                  }}
                >
                  Exit View As
                </button>
              </div>
            )}
            <AssessorDashboard
              user={assessorUser}
              onJobSelect={handleJobSelect}
              onDataUpdate={updateDataSection}
            />
          </>
        )}

        {activeView === 'job-modules' && selectedJob && (
          <div>
            <JobContainer
              selectedJob={selectedJob}
              onBackToJobs={handleBackToJobs}
              onWorkflowStatsUpdate={handleWorkflowStatsUpdate}
            />
          </div>
        )}
      </main>

      {/* Change Password Modal */}
      {showChangePassword && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 9999
        }} onClick={() => { setShowChangePassword(false); setCpError(''); setCpSuccess(''); }}>
          <div style={{
            background: 'white', borderRadius: '12px', padding: '2rem',
            width: '90%', maxWidth: '420px', boxShadow: '0 20px 25px rgba(0,0,0,0.15)'
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.25rem', color: '#1a202c' }}>Change Password</h3>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1.25rem' }}>
              {user.employeeData?.name || user.email}
            </p>
            {cpError && (
              <div style={{ padding: '8px 12px', background: '#fee', color: '#c53030', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem', border: '1px solid #feb2b2' }}>
                {cpError}
              </div>
            )}
            {cpSuccess && (
              <div style={{ padding: '8px 12px', background: '#f0fdf4', color: '#166534', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem', border: '1px solid #bbf7d0' }}>
                {cpSuccess}
              </div>
            )}
            <form onSubmit={handleChangePassword}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.4rem' }}>Current Password</label>
                <input
                  type="password"
                  value={cpCurrentPwd}
                  onChange={(e) => setCpCurrentPwd(e.target.value)}
                  required
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.4rem' }}>New Password</label>
                <input
                  type="text"
                  value={cpNewPwd}
                  onChange={(e) => setCpNewPwd(e.target.value)}
                  required
                  placeholder="Min 6 characters"
                  autoComplete="off"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#4a5568', marginBottom: '0.4rem' }}>Confirm New Password</label>
                <input
                  type="text"
                  value={cpConfirmPwd}
                  onChange={(e) => setCpConfirmPwd(e.target.value)}
                  required
                  placeholder="Confirm new password"
                  autoComplete="off"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e0', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => { setShowChangePassword(false); setCpError(''); setCpSuccess(''); setCpCurrentPwd(''); setCpNewPwd(''); setCpConfirmPwd(''); }}
                  style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: '#f3f4f6', color: '#374151', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: 'none', background: 'linear-gradient(135deg, #2a5298, #1e3c72)', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
