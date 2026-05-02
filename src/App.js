import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabaseClient';
import { PPA_ORG_ID, isPpaJob, getUserTenantConfig, getJobTenantConfig, getLabel } from './lib/tenantConfig';
import './App.css'; 
import AdminJobManagement from './components/AdminJobManagement';
import EmployeeManagement from './components/EmployeeManagement';
import BillingManagement from './components/BillingManagement';
import PayrollManagement from './components/PayrollManagement';
import JobContainer from './components/job-modules/JobContainer';
import FileUploadButton from './components/job-modules/FileUploadButton';
import LandingPage from './components/LandingPage';
import UserManagement from './components/UserManagement';
import OrganizationManagement from './components/OrganizationManagement';
import RevenueManagement from './components/RevenueManagement';
import AssessorDashboard from './components/AssessorDashboard';
import AppealsSummary from './components/AppealsSummary';
import GeocodingTool from './components/GeocodingTool';

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
    const validViews = ['admin-jobs', 'appeals', 'billing', 'employees', 'payroll', 'job-modules', 'users', 'organizations', 'revenue', 'assessor-dashboard', 'geocoding-tool'];
    return validViews.includes(path) ? path : 'admin-jobs';
  });


  // Listen for browser back/forward buttons (moved after selectedJob declaration below)

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
  const [fileRefreshTrigger, setFileRefreshTrigger] = useState(0);

  // Job exit confirmation
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const pendingExitAction = useRef(null);

  // Listen for browser back/forward buttons
  useEffect(() => {
    const handlePopState = (e) => {
      const path = window.location.pathname;
      const parts = path.split('/');

      // Handle job-specific URLs
      if (parts[1] === 'job' && parts[2]) {
        // Don't do anything here - the other useEffect handles job selection
        return;
      }

      // If currently in a job, intercept and confirm
      if (selectedJob && activeView === 'job-modules') {
        // Push the job URL back so the user stays on the page
        window.history.pushState({}, '', `/job/${selectedJob.id}`);
        const viewPath = path.slice(1) || 'admin-jobs';
        pendingExitAction.current = () => {
          const validViews = ['dashboard', 'admin-jobs', 'appeals', 'billing', 'employees', 'payroll', 'users', 'organizations', 'revenue', 'assessor-dashboard', 'geocoding-tool'];
          if (validViews.includes(viewPath)) {
            setActiveView(viewPath);
            setSelectedJob(null);
            window.history.pushState({}, '', `/${viewPath}`);
          }
        };
        setShowExitConfirm(true);
        return;
      }

      // Handle main navigation
      const viewPath = path.slice(1) || 'admin-jobs';
      const validViews = ['dashboard', 'admin-jobs', 'appeals', 'billing', 'employees', 'payroll', 'users', 'organizations', 'revenue', 'assessor-dashboard', 'geocoding-tool'];
      if (validViews.includes(viewPath)) {
        setActiveView(viewPath);
        setSelectedJob(null); // Clear job selection when navigating to main views
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [selectedJob, activeView]);

  // Warn on browser refresh/close when in a job
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (selectedJob && activeView === 'job-modules') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [selectedJob, activeView]);

  // Exit confirmation handlers
  const confirmExitJob = useCallback(() => {
    setShowExitConfirm(false);
    if (pendingExitAction.current) {
      pendingExitAction.current();
      pendingExitAction.current = null;
    }
  }, []);

  const cancelExitJob = useCallback(() => {
    setShowExitConfirm(false);
    pendingExitAction.current = null;
  }, []);

  // Dev mode: "View As" impersonation state
  const [viewingAs, setViewingAs] = useState(null);

  // Help modal state
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab, setHelpTab] = useState('navigating-os');

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

  // Tenant configuration - determines module visibility, terminology, behavior
  const tenantConfig = getUserTenantConfig(user);
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

  // Centralized job visibility filter:
  // - View As mode: only the impersonated org's jobs (so admin sees what assessor sees)
  // - Admin (primary owner): all jobs
  // - Assessor: only their org's jobs
  // - PPA Owner/Manager: only PPA jobs (no LOJIK client jobs)
  const filterJobsForUser = (jobList) => {
    // View As takes priority — admin should see exactly what the assessor sees
    if (viewingAs) {
      const orgId = viewingAs.organization_id;
      return jobList.filter(j => j.organization_id === orgId);
    }
    if (canManageUsers) return jobList; // Admin sees everything
    if (isAssessorUser) {
      const orgId = userOrgId;
      return jobList.filter(j => j.organization_id === orgId);
    }
    // PPA users (owner, manager) - only PPA jobs
    return jobList.filter(isPpaJob);
  };

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
  const executeViewChange = useCallback((view) => {
    // Prevent non-admins from navigating to billing/payroll
    const role = user?.role?.toString?.().toLowerCase?.() || '';
    const isAdminLocal = role === 'admin' || role === 'owner';
    if ((view === 'billing' || view === 'payroll') && !isAdminLocal) {
      setActiveView('admin-jobs');
      window.history.pushState({}, '', '/admin-jobs');
      return;
    }
    // Block modules disabled by tenant config
    const moduleMap = { billing: 'billing', payroll: 'payroll', employees: 'employees', organizations: 'organizations' };
    if (moduleMap[view] && !tenantConfig.modules[moduleMap[view]]) {
      setActiveView('admin-jobs');
      window.history.pushState({}, '', '/admin-jobs');
      return;
    }
    // Only primary owner can access users, organizations, and revenue
    if ((view === 'users' || view === 'organizations' || view === 'revenue') && user?.id !== PRIMARY_OWNER_ID) {
      setActiveView('admin-jobs');
      window.history.pushState({}, '', '/admin-jobs');
      return;
    }

    setSelectedJob(null);
    setActiveView(view);
    // Update URL without page reload
    window.history.pushState({}, '', `/${view}`);
  }, [user, tenantConfig]);

  const handleViewChange = useCallback((view) => {
    // If currently in a job, confirm before leaving
    if (selectedJob && activeView === 'job-modules') {
      pendingExitAction.current = () => executeViewChange(view);
      setShowExitConfirm(true);
      return;
    }
    executeViewChange(view);
  }, [selectedJob, activeView, executeViewChange]);

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

        // For non-PPA jobs, load lightweight summary stats using count queries
        // (avoids Supabase default row limit that was capping results at ~5000)
        const isClientJob = job.organization_id && job.organization_id !== PPA_ORG_ID;
        if (isClientJob) {
          try {
            // Run count queries in parallel - no row limit issues
            const [totalResult, inspectedResult, mostRecentResult] = await Promise.all([
              // Total record count
              supabase
                .from('property_records')
                .select('*', { count: 'exact', head: true })
                .eq('job_id', job.id),
              // Inspected count (has measure_by AND measure_date)
              supabase
                .from('property_records')
                .select('*', { count: 'exact', head: true })
                .eq('job_id', job.id)
                .not('inspection_measure_by', 'is', null)
                .neq('inspection_measure_by', '')
                .not('inspection_measure_date', 'is', null),
              // Most recent measure date
              supabase
                .from('property_records')
                .select('inspection_measure_date')
                .eq('job_id', job.id)
                .not('inspection_measure_date', 'is', null)
                .order('inspection_measure_date', { ascending: false })
                .limit(1)
            ]);

            const totalCount = totalResult.count || 0;
            const inspectedCount = inspectedResult.count || 0;

            if (totalCount > 0) {
              // Get residential/commercial counts and avg measure date in parallel
              const [resResult, comResult, avgResult] = await Promise.all([
                // Residential: types starting with 1, 2, 3A
                supabase
                  .from('property_records')
                  .select('*', { count: 'exact', head: true })
                  .eq('job_id', job.id)
                  .or('asset_type_use.like.1%,asset_type_use.like.2%,asset_type_use.like.3A%'),
                // Commercial: types starting with 4, 5
                supabase
                  .from('property_records')
                  .select('*', { count: 'exact', head: true })
                  .eq('job_id', job.id)
                  .or('asset_type_use.like.4%,asset_type_use.like.5%'),
                // Avg measure date - fetch just dates for inspected records (paginated)
                (async () => {
                  const dates = [];
                  let page = 0;
                  let hasMore = true;
                  while (hasMore) {
                    const { data } = await supabase
                      .from('property_records')
                      .select('inspection_measure_date')
                      .eq('job_id', job.id)
                      .not('inspection_measure_date', 'is', null)
                      .range(page * 1000, (page + 1) * 1000 - 1);
                    if (data && data.length > 0) {
                      dates.push(...data.map(d => new Date(d.inspection_measure_date).getTime()).filter(t => !isNaN(t)));
                      page++;
                      hasMore = data.length === 1000;
                    } else {
                      hasMore = false;
                    }
                  }
                  return dates;
                })()
              ]);

              const mostRecentMeasureDate = mostRecentResult.data?.[0]?.inspection_measure_date
                ? new Date(mostRecentResult.data[0].inspection_measure_date + 'T00:00:00').toISOString().split('T')[0]
                : null;
              const measureDates = avgResult;
              const avgMeasureDate = measureDates.length > 0
                ? new Date(measureDates.reduce((a, b) => a + b, 0) / measureDates.length).toISOString().split('T')[0]
                : null;

              freshnessData[job.id].clientSummary = {
                totalRecords: totalCount,
                inspectedCount,
                entryRate: totalCount > 0 ? Math.round((inspectedCount / totalCount) * 100) : 0,
                avgMeasureDate,
                mostRecentMeasureDate,
                residentialCount: resResult.count || 0,
                commercialCount: comResult.count || 0
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

        // LEAN QUERY: Exclude massive JSONB blobs (raw_file_content, parsed_code_definitions)
        // Those are only needed when entering a specific job (JobContainer fetches them)
        const { data: jobsData } = await supabase
          .from('jobs')
          .select(`
            id,
            job_name,
            municipality,
            ccdd_code,
            county,
            vendor_type,
            status,
            job_type,
            project_type,
            start_date,
            end_date,
            target_completion_date,
            total_properties,
            totalresidential,
            totalcommercial,
            percent_billed,
            has_property_assignments,
            assigned_has_commercial,
            workflow_stats,
            archived_at,
            archived_by,
            created_at,
            organization_id,
            year_of_value,
            source_file_name,
            source_file_uploaded_at,
            unit_rate_config,
            staged_unit_rate_config,
            appeal_summary_snapshot,
            job_responsibilities(count),
            job_contracts(
              id,
              contract_amount,
              contract_template_type,
              retainer_percentage,
              retainer_amount,
              end_of_job_percentage,
              end_of_job_amount,
              first_year_appeals_percentage,
              first_year_appeals_amount,
              second_year_appeals_percentage,
              second_year_appeals_amount,
              third_year_appeals_percentage,
              third_year_appeals_amount,
              bonding_required
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

        // Calculate billing metrics - only PPA jobs (exclude client/Lojik jobs)
        const billingActiveJobs = (updates.activeJobs || appData.activeJobs)?.filter(isPpaJob);
        const billingLegacyJobs = (updates.legacyJobs || appData.legacyJobs)?.filter(isPpaJob);
        updates.billingMetrics = calculateBillingMetrics(
          billingActiveJobs,
          billingLegacyJobs,
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

  const executeBackToJobs = useCallback(() => {
    setSelectedJob(null);
    const backView = isAssessorUser ? 'assessor-dashboard' : 'admin-jobs';
    setActiveView(backView);
    window.history.pushState({}, '', `/${backView}`);

    // Refresh jobs data to show any updates made in modules
    console.log('🔄 Refreshing jobs data after returning from modules');
    loadLiveData(['jobs']);
  }, [loadLiveData, isAssessorUser]);

  const handleBackToJobs = useCallback(() => {
    if (selectedJob && activeView === 'job-modules') {
      pendingExitAction.current = () => executeBackToJobs();
      setShowExitConfirm(true);
      return;
    }
    executeBackToJobs();
  }, [selectedJob, activeView, executeBackToJobs]);

  const handleFileProcessed = useCallback(() => {
    console.log('📁 File processed acknowledged - jobs list will refresh when user returns to jobs');
  }, []);

  const handleWorkflowStatsUpdate = useCallback((stats, persistToDatabase) => {
    console.log('📊 Workflow stats updated:', stats);

    if (persistToDatabase && stats?.needsReprocessing !== undefined && selectedJob?.id) {
      // Persist needs_reprocessing flag to database
      supabase
        .from('jobs')
        .update({ needs_reprocessing: stats.needsReprocessing })
        .eq('id', selectedJob.id)
        .then(() => {
          console.log(`✅ Updated needs_reprocessing to ${stats.needsReprocessing} for job ${selectedJob.id}`);
        })
        .catch((error) => {
          console.error('❌ Failed to update needs_reprocessing flag:', error);
        });
    }
  }, [selectedJob?.id]);

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
    
    const currentYear = new Date().getFullYear();

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
              const billingYear = new Date(event.billing_date).getFullYear();
              if (event.status === 'P') {
                jobPaid += amount;
                // Only count as YTD paid if billing_date is in the current year
                if (billingYear === currentYear) {
                  totalPaid += amount;
                }
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
    let lastYearTotalExpenses = 0;
    let monthlyExpenses = new Array(12).fill(0);
    const currentMonth = new Date().getMonth() + 1;

    if (expenses) {
      expenses.forEach(expense => {
        const amount = parseFloat(expense.amount || 0);
        if (expense.year === currentYear) {
          monthlyExpenses[expense.month - 1] += amount;
          if (expense.month <= currentMonth) {
            currentExpenses += amount;
          }
        } else if (expense.year === currentYear - 1) {
          lastYearTotalExpenses += amount;
        }
      });
    }

    // Calculate daily rate and projections
    // Fallback to last year's total expenses if no current year expenses loaded yet
    const workingDaysYTD = new Date().getMonth() * 21; // Rough estimate
    const totalWorkingDays = 252; // Typical year
    const dailyExpenseRate = workingDaysYTD > 0 ? currentExpenses / workingDaysYTD : 0;
    const projectedExpenses = currentExpenses > 0
      ? dailyExpenseRate * totalWorkingDays
      : lastYearTotalExpenses;
    
    // Calculate projected cash
    const plannedContractsTotal = planningJobs?.reduce((sum, job) => 
      sum + (job.contract_amount || 0), 0) || 0;
    const projectedCash = (totalPaid + totalOpen + totalRemainingExcludingRetainer) - (plannedContractsTotal * 0.6);
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
                  // If viewing a job, also trigger JobContainer to reload its data
                  if (selectedJob && activeView === 'job-modules') {
                    setFileRefreshTrigger(prev => prev + 1);
                  }
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
                onClick={() => setShowHelp(true)}
                className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
                title="How-to guides"
              >
                ❓ Help
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
                👥 {getLabel(tenantConfig, 'employeesTab', 'Employees')} ({appData.employees.length})
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
                📋 Jobs ({filterJobsForUser(appData.jobs).length})
              </button>
              <button
                onClick={() => handleViewChange('appeals')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'appeals'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'appeals' ? {
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                ⚖️ Appeals
              </button>
              {isAdmin && tenantConfig.modules.billing && (
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
              {isAdmin && tenantConfig.modules.payroll && (
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
                🏢 {getLabel(tenantConfig, 'organizationsTab', 'Organizations')}
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
              {canManageUsers && (
              <button
                onClick={() => handleViewChange('geocoding-tool')}
                className={`px-4 py-2 rounded-xl font-medium text-sm border ${
                  activeView === 'geocoding-tool'
                    ? 'text-blue-600 shadow-lg border-white'
                    : 'bg-white bg-opacity-10 text-white hover:bg-opacity-20 backdrop-blur-sm border-white border-opacity-30 hover:border-opacity-50'
                }`}
                style={activeView === 'geocoding-tool' ? {
                  backgroundColor: '#FFFFFF',
                  opacity: 1,
                  backdropFilter: 'none'
                } : {}}
              >
                🗺️ Geocoder
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
              {/* Only show Job Management for admins using View As mode, not real assessors */}
              {viewingAs && canManageUsers && (
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
              )}
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
                
                {/* File Upload Controls - Full for LOJIK users, Code-only for PPA */}
                <div className="border-l border-white border-opacity-30 pl-6">
                  <FileUploadButton
                    job={selectedJob}
                    onFileProcessed={handleFileProcessed}
                    onDataRefresh={handleFileProcessed}
                    onUpdateJobCache={handleJobDataRefresh}
                    codeFileOnly={!isAssessorUser && isPpaJob(selectedJob)}
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {viewingAs && (
                  <button
                    onClick={handleExitViewAs}
                    className="px-4 py-2 bg-purple-500 bg-opacity-80 hover:bg-opacity-100 backdrop-blur-sm rounded-lg text-white font-medium text-sm transition-all duration-200"
                  >
                    Exit View As
                  </button>
                )}
                <button
                  onClick={handleBackToJobs}
                  className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm rounded-lg text-white font-medium transition-all duration-200"
                >
                  ← Back to Jobs
                </button>
              </div>
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
            jobs={filterJobsForUser(appData.jobs)}
            onJobSelect={handleJobSelect}
            planningJobs={filterJobsForUser(appData.planningJobs)}
            archivedJobs={filterJobsForUser(appData.archivedJobs)}
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

        {activeView === 'appeals' && (() => {
          // Appeals Summary is PPA archived jobs only (appeals happen post-completion)
          const filteredPpaJobs = filterJobsForUser(appData.archivedJobs || []);
          const ppaJobIds = new Set(filteredPpaJobs.map(j => j.id));

          // Hardcode Jackson and Maplewood (LOJIK clients with their own org_id where the appeal data lives)
          // The PPA archived drafts are dead weight; the real data is in their LOJIK entries
          const allJobs = [
            ...(appData.archivedJobs || []),
            ...(appData.activeJobs || []),
            ...(appData.planningJobs || []),
            ...(appData.jobs || [])
          ];

          // Deduplicate jobs by ID to avoid React key warnings
          const jobsSeenById = new Set(ppaJobIds);
          const specialJobs = allJobs.filter(job => {
            if (jobsSeenById.has(job.id)) return false; // Skip if already added
            const jobName = (job.job_name || '').toLowerCase().trim();
            if (jobName === 'maplewood' || jobName === 'jackson') {
              jobsSeenById.add(job.id); // Mark as seen
              return true;
            }
            return false;
          });

          return (
            <AppealsSummary
              jobs={[...filteredPpaJobs, ...specialJobs]}
              onJobSelect={handleJobSelect}
            />
          );
        })()}

        {activeView === 'billing' && (isAdmin ? (
          <BillingManagement
            activeJobs={appData.activeJobs?.filter(isPpaJob)}
            legacyJobs={appData.legacyJobs?.filter(isPpaJob)}
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
            jobs={appData.jobs?.filter(isPpaJob)}
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

        {activeView === 'geocoding-tool' && (canManageUsers ? (
          <GeocodingTool />
        ) : (
          <div className="max-w-2xl mx-auto p-6 bg-white rounded shadow">
            <h3 className="text-lg font-semibold">Access Denied</h3>
            <p className="text-sm text-gray-600">This tool is restricted to the primary owner.</p>
          </div>
        ))}

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
              jobFreshness={appData.jobFreshness}
            />
          </>
        )}

        {activeView === 'job-modules' && selectedJob && (
          <div>
            <JobContainer
              selectedJob={selectedJob}
              onBackToJobs={handleBackToJobs}
              onWorkflowStatsUpdate={handleWorkflowStatsUpdate}
              fileRefreshTrigger={fileRefreshTrigger}
              tenantConfig={getJobTenantConfig(selectedJob)}
            />
          </div>
        )}
      </main>

      {/* Help Modal */}
      {showHelp && (() => {
        // Define tabs + steps here. Drop screenshots into public/help/<slug>/
        // and reference them by file name in `img`. If the file doesn't exist
        // the image just hides itself.
        const HELP_TABS = [
          {
            id: 'navigating-os',
            label: 'Navigating your Town with your Copilot',
            intro:
              "The Property Assessment Copilot was created to work WITH your Town's database and data collection vendors (BRT or Microsystems). The application is not connected live but rather is a snapshot of your most recent data file and code file update. Fingers crossed, maybe one day we can integrate directly with both.\n\n" +
              "Because this is a snapshot, the FIRST thing to look at when you Go to a Job is the version banner at the top of the workspace — \"Current Data Version: X | Current Code Version: Y | Last Updated: ...\" That banner tells you exactly which file upload you are working from. If those numbers look stale, you (or whoever handles uploads on your side) can drop a new source or code file in and the snapshot refreshes.\n\n" +
              "From there, the natural flow inside a Town is Market & Land Analysis (Data Quality → Pre-Valuation Setup → Land Valuation → Cost Valuation → Attribute & Card Analytics) into Final Valuation, where you can pick your approach: the Market Data tab (effective ages and depreciation) OR the Sales Comparison (CME) tool for the strict market approach. The CME tool and the Appeal Log are the two pieces that can stand on their own — you do not have to complete a full Market Analysis pass to use them.",
            steps: [
              { text: 'Top header (the dark bar at the very top): your Refresh button pulls the latest snapshot from the database, and Help is what you are reading now.', img: '01-top-nav.png' },
              { text: '📋 Dashboard is your landing page. It says "Your Jobs" and shows one card per Town you have access to. Each card shows the Town\'s key stats — Total Line Items, Inspected, Residential / Commercial, Avg Measured Date, Most Recent Measured. The button on each card is "Go to Job" — that is how you enter a Town\'s workspace. The Dashboard is also where you upload a new source or code file when your vendor sends one.', img: '02-dashboard.png' },
              { text: 'The version banner — read this first every time. Once you Go to a Job, the strip across the top of the workspace shows "Current Data Version: X | Current Code Version: Y" on the left and "Last Updated: <date>" right under it. Data Version goes up every time a new source file is uploaded; Code Version goes up every time a new code file is uploaded. If something on screen looks wrong, the version banner is the first place to check — you may be looking at a stale snapshot.', img: '03-version-banner.png' },
              { text: 'The per-Town tabs (left to right, in the order they appear): Data Visualizations, Inspection Info, Market & Land Analysis, Final Valuation, Appeal Log. Assessor accounts open into Final Valuation by default since that is where you will spend most of your time.', img: '04-job-tabs.png' },
              { text: 'Inspection Info — read-only summary of inspection coverage. Shows Improved Properties / Improved Entries / Improved Entry Rate cards at the top, then "Residential Inspections by VCS", "Breakdown by Property Class", "Inspector Breakdown", and "Missing Entries". Has an "Export PDF" button — good for status meetings.', img: '05-inspection-info.png' },
              { text: 'Data Visualizations — charts only, nothing to edit. Includes Market History, VCS Average Sale Prices, Usable vs Non-Usable Sales, Sales NU Distribution, Design & Style Breakdown, Type & Use Breakdown, Building Class Distribution, Property Class Distribution. Use it to eyeball the data before you start analysis.', img: '06-data-viz.png' },
              { text: 'Market & Land Analysis — the valuation prep workspace. Sub-tabs in the order they appear: "Data Quality / Error Checking", "Pre-Valuation Setup", "Overall Analysis", "Land Valuation", "Cost Valuation", "Attribute & Card Analytics". The 📍 Coordinates sub-tab lives at the end of the Data Quality strip — that is where you fix individual parcel lat/lng (see the Geocoding tab for how that works). Everything in this module flows DOWNSTREAM into Final Valuation.', img: '07-market-analysis.png' },
              { text: 'Final Valuation — where values are actually produced. Sub-tabs in order: "Sales Review", "Market Data", "Ratable Comparison", "Sales Comparison (CME)", "Analytics". You have two ways to land at a value: the Market Data tab (the effective-age and depreciation approach — the "Market Data Approach" preview lives here) OR the Sales Comparison (CME) tool (the strict market approach with comparables, brackets, adjustments). Pick the one that fits the property.', img: '08-final-valuation.png' },
              { text: 'Sales Comparison (CME) and Appeal Log can stand on their own. The CME has its own nested tabs ("Adjustments", "Sales Pool", "Search & Results", "Detailed", "Summary", "Vacant Land Evaluation") and reads its own data. Appeal Log is its own top-level Job tab — it loads the appeal_log directly. So if you only need to handle a few appeals or run one CME, you do not need to do a full Market Analysis pass first.', img: '09-cme-and-appeals.png' },
              { text: 'Bottom line on data freshness: this app is NOT live-connected to BRT or Microsystems. Everything you see is the snapshot from your most recent source-file and code-file upload — and the version banner at the top of every Job tells you exactly which snapshot. When the Town\'s data changes on the vendor side, drop the new file in (see the "Updating your Town" tab) and the snapshot refreshes.', img: '10-snapshot.png' },
            ],
          },
          {
            id: 'updating-town',
            label: 'Updating your Town',
            intro: 'Re-uploading a new source file (BRT or Microsystems) over an existing job. The updater diffs against what is already there, flags new/changed records, and refreshes analytics.',
            steps: [
              { text: 'Open the job, go to the File Upload area, and drop in the new source file.', img: 'help/updating-town/01-upload.png' },
              { text: 'Confirm the vendor was detected correctly (BRT vs Microsystems).', img: 'help/updating-town/02-vendor.png' },
              { text: 'Review the comparison report — adds, removes, and value changes.', img: 'help/updating-town/03-comparison.png' },
              { text: 'Approve the update. The system flags new records and marks the job for analytics refresh.', img: 'help/updating-town/04-approve.png' },
            ],
          },
          {
            id: 'importing-appeal-logs',
            label: 'Importing Appeal Logs',
            intro: 'Bringing appeals into the Appeal Log from XLS, CSV, PDF, or manual entry.',
            steps: [
              { text: 'Open the job → Final Valuation → Appeal Log tab.', img: 'help/importing-appeals/01-open.png' },
              { text: 'Click Import and choose the file type (XLS / CSV / PDF).', img: 'help/importing-appeals/02-import.png' },
              { text: 'Map any unrecognized columns if prompted (county exports vary).', img: 'help/importing-appeals/03-map.png' },
              { text: 'Review the import preview, then confirm to write to the appeal log.', img: 'help/importing-appeals/04-confirm.png' },
            ],
          },
          {
            id: 'powercomp-photos',
            label: 'Appeal Photos with the PowerComp',
            intro: 'PPA appeal reports do not include property photos. Import the BRT PowerComp Batch Taxpayer Report PDF; the system slices the photo pages per subject and stitches them into the appeal report at print time.',
            steps: [
              { text: 'In Appeal Log, click "Import Batch PwrComp PDF".', img: 'help/powercomp/01-import-button.png' },
              { text: 'Upload the PowerComp PDF. The parser matches each subject by Block / Lot / Qualifier.', img: 'help/powercomp/02-upload.png' },
              { text: 'Photo pages are stored per subject in the powercomp-photos bucket (a "BRT Technologies PowerComp" footer is added — leave it on, attribution is required).', img: 'help/powercomp/03-stored.png' },
              { text: 'When you print an appeal report, the photo packet is automatically merged in the canonical order. Re-import to replace if PowerComp re-issues photos.', img: 'help/powercomp/04-print.png' },
            ],
          },
          {
            id: 'geocoding',
            label: 'Geocoding (sources, matching, pitfalls)',
            intro:
              "Geocoding = giving every parcel a latitude/longitude. Coordinates power the Appeal Map and the distance-from-subject filter inside the CME, so a clean geocode pass pays off everywhere downstream.\n\n" +
              "You will not run the bulk Census process — that is an admin tool. What you DO have, inside any Town, is Market Analysis → Data Quality → 📍 Coordinates, which is the cleanup queue for individual parcels that came back un-matched, low-confidence, or that you want to correct by hand.",
            steps: [
              { text: 'Your cleanup queue (Data Quality → 📍 Coordinates): three buckets across the top — Pending (no coords yet), Review (low-confidence Census match — Tie, Non_Exact, ZIP Centroid, Approximate), and Fixed (manual entries plus high-confidence Census matches). Class chips narrow by property class; the Sales Pool chip narrows to parcels in the current sales-pool window so you can prioritize comp candidates.', img: '11-geocoding.png' },
              { text: 'Where the coordinates come from: the U.S. Census Bureau\'s free batch geocoder. We send a CSV of addresses, the Census matches them against TIGER (their nationwide street database), and sends results back. We do this manually instead of using a paid live API because it is free and reliable, and a Town\'s addresses do not change often enough to need a live feed.', img: '12-geocoding-source.png' },
              { text: 'How matches are graded: each row comes back as Exact / Match / Non_Exact / Tie / No_Match / ZIP Centroid / Approximate. Exact and Match are good. Non_Exact and Approximate are usable but worth a sanity check. Tie means Census found more than one address that fits and could not pick. No_Match means Census could not find it at all.', img: '13-geocoding-match-quality.png' },
              { text: 'Address normalization happens automatically before we send to Census: street suffixes are canonicalized (RD/ROAD, ST/STREET, etc.), routes get rewritten, and numbered streets are submitted both as a digit and as a word ("336 3RD ST" AND "336 THIRD ST") because Census indexes them inconsistently from one street segment to the next.', img: '14-geocoding-normalization.png' },
              { text: 'Special handling: condo children (qualifier starts with "C") inherit the mother lot\'s coordinates instead of being geocoded individually — Census usually fails on "123 MAIN ST UNIT 4B". Parcels with no street number, PO boxes, or bare lot descriptions get marked "skipped" so they stop appearing in your cleanup queue. ZIP-sweep variants are sent for stubborn parcels using the Town\'s known ZIPs.', img: '15-geocoding-special-handling.png' },
              { text: 'How to fix one by hand: each row has an "Open" link in the Map column prefilled with the parcel\'s address in Google Maps. Open it, right-click the correct rooftop, copy the lat/lng, click the pin chip on the row, paste, save. The row moves to the Fixed bucket immediately — no refresh needed.', img: '16-geocoding-manual-fix.png' },
              { text: 'Updating after a re-upload: when you upload a new source file, new parcels show up in Pending automatically. Existing coordinates are preserved (we never overwrite a saved coord on a re-upload). So your manual fixes are safe — you just work the new Pending count.', img: '17-geocoding-after-reupload.png' },
              { text: 'PITFALL #1 — ALWAYS check your map on export. A small share of Census matches will be off by a block, on the wrong side of the street, or pinned to a ZIP centroid out in a field. If a comp is showing up at the wrong end of town on the appeal map, that is the symptom. Open the parcel in the Coordinates queue, fix it, re-export.', img: '18-geocoding-pitfall-map.png' },
              { text: 'PITFALL #2 — Tie matches. A "Tie" means more than one street segment fit (often the same address number on two streets with the same name in adjacent boroughs). These need a manual fix. Do not assume Census picked the right one.', img: '19-geocoding-pitfall-ties.png' },
              { text: 'PITFALL #3 — Condo mother-lot inheritance. If the mother lot itself is wrong, every condo child inherits the wrong coordinates. Fix the mother lot first, then any children that did not auto-update can be re-saved.', img: '20-geocoding-pitfall-condos.png' },
              { text: 'PITFALL #4 — Vendor address quality. Garbage in, garbage out. If your source file has "RT 1 BX 47" or "REAR OF 123 MAIN" we cannot geocode it cleanly. These typically end up Skipped or Review and need a manual lat/lng.', img: '21-geocoding-pitfall-bad-addresses.png' },
            ],
          },
        ];
        const activeTab = HELP_TABS.find(t => t.id === helpTab) || HELP_TABS[0];
        return (
          <div
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', zIndex: 9999,
            }}
            onClick={() => setShowHelp(false)}
          >
            <div
              style={{
                background: 'white', borderRadius: '12px', width: '90%', maxWidth: '780px',
                maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Help &amp; How-to</h2>
                <button
                  onClick={() => setShowHelp(false)}
                  style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6b7280' }}
                  title="Close"
                >
                  ×
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                {HELP_TABS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setHelpTab(t.id)}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      border: 'none',
                      background: helpTab === t.id ? 'white' : 'transparent',
                      borderBottom: helpTab === t.id ? '2px solid #2563eb' : '2px solid transparent',
                      color: helpTab === t.id ? '#2563eb' : '#374151',
                      fontWeight: helpTab === t.id ? 600 : 500,
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div style={{ padding: '20px', overflowY: 'auto' }}>
                <p style={{ marginTop: 0, color: '#4b5563', fontSize: '0.95rem', whiteSpace: 'pre-line' }}>{activeTab.intro}</p>
                <ol style={{ paddingLeft: '20px', margin: 0 }}>
                  {activeTab.steps.map((step, i) => (
                    <li key={i} style={{ marginBottom: '20px' }}>
                      <div style={{ marginBottom: '8px', color: '#1f2937' }}>{step.text}</div>
                      {step.img && (
                        <img
                          src={`/${step.img}`}
                          alt=""
                          style={{ maxWidth: '100%', borderRadius: '6px', border: '1px solid #e5e7eb', display: 'block' }}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Footer */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowHelp(false)}
                  style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* Exit Job Confirmation Modal */}
      {showExitConfirm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'white', borderRadius: '12px', padding: '2rem',
            width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: '#1a202c' }}>
              Exit Job?
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '1.5rem', lineHeight: '1.5' }}>
              Are you sure you want to leave <strong>{selectedJob?.job_name || selectedJob?.name}</strong>? Large jobs may take several minutes to reload.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button
                onClick={cancelExitJob}
                style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                Stay in Job
              </button>
              <button
                onClick={confirmExitJob}
                style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, #2a5298, #1e3c72)', color: 'white', fontWeight: '600', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                Yes, Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
