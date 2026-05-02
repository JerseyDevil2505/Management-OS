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
            intro:
              "Two kinds of files keep your Town fresh:\n\n" +
              "• DATA FILE (the blue \"Select File\" next to Source) — property record changes, class changes, new sales, ownership, etc. You will update this one often.\n" +
              "• CODE FILE (the green \"Select File\" next to Code) — changes to the codebook itself: a new style, a new land adjustment, VCS edits. Updated much less often.\n\n" +
              "The vendor (BRT vs Microsystems) is auto-detected from the file you pick — you do not have to tell the app which it is. Both imports run a comparison against what is already in the Town: you will see adds / removes / value changes, can review sales changes, keep valid sales that came in masked as $1, and continue normalization if you have already started a pass.\n\n" +
              "Jump to your vendor's export steps below.",
            links: [
              { label: 'Microsystems export →', target: 'micro' },
              { label: 'BRT export →', target: 'brt' },
            ],
            steps: [
              { id: 'upload', heading: 'Where the upload happens (in the app)', text: 'Top of every Job, the file strip shows Source and Code. Blue "Select File" next to Source picks the new data file. Green "Select File" next to Code picks the new code file.\n\nIMPORTANT: picking the file does NOT update the Job. After you pick the file, the button changes to "Update" — you have to click Update to actually run the import. Once it finishes, the version banner just below the file strip bumps — that is your confirmation the snapshot refreshed.', img: '18-FileUpload.png' },
              { heading: 'The File Comparison modal', text: 'After Update runs, the File Comparison Results modal opens. The four tiles across the top show what changed: Added, Deleted, Sales Changes, Class Changes. Click any tile to open that list:\n• Added / Deleted — new and removed line items\n• Sales Changes — every sale where Old vs New differs (book/page, price, NU, date). Per row you can choose Keep Old, Keep New, Keep Both, or Reject.\n• Class Changes — property class flips\nUse "View All Reports" if you want to see the running history of every comparison this Job has had. When you are happy, click "Mark Reviewed & Process" — that batch-applies your decisions to the Job. When it finishes you can close the window.', img: '21-comparison.png' },
              { heading: 'Normalization Review (only if you have already started normalizing)', text: 'If you had already run a pass at Normalization before this update, a Normalization Review modal will pop next. Each changed sale needs a Keep or Reject decision before saving.\n\nWatch this one carefully — this is where a previously hidden / masked sale can be overridden by a < $100 transaction (e.g. a $1 deed transfer that came in on the new file). If you Keep blindly, you will lose the real sale. The bar at the top has an "Auto: Keep Clean / Reject Flagged" shortcut for the obvious ones, but eyeball the flagged rows yourself before saving.', img: '22-norm-rev.png' },
              { id: 'micro', heading: 'MICROSYSTEMS — exporting your latest data + code file', text: 'From the Microsystems main menu, choose option 2 — Residential PRC Information.', img: '13-micro-main.png' },
              { text: 'Once a record is loaded (Query any record, then press Q and Escape), click the WEB icon in the top toolbar. That opens the web version of Microsystems in a new tab.', img: '14-micro-web.png' },
              { text: 'In the web version, click "Menu" in the action bar.', img: '15-micro-menu.png' },
              { text: 'A new tab opens — choose "Upload/Download Menu".', img: '16-micro-UD.png' },
              { text: 'Another tab opens — choose "Export to TXT File". A final tab will open with a "Click here for RPA File" link. Download the zip and extract it — the zip contains BOTH the data file and the code file.\n\nWhich file goes where in the app:\n• dataCCDD.txt → blue "Select File" next to Source (data)\n• codeCCDD.txt → green "Select File" next to Code (code)\n(CCDD = your county+district code, so the actual filenames will look like data0331.txt / code0331.txt for Riverton.)', img: '17-micro-export.png' },
              { id: 'brt', heading: 'BRT — exporting your latest data file', text: 'In BRT Power Cama, open My Reports → Report Writer (or check My Reports first to see if the report is already saved there). The report you want is named COPILOT OS DATA. If it is not in either list, contact Dwayne at BRT or Jim to have it set up for your Town.', img: '19-BRT-Menu.png' },
              { text: 'Once the Report Writer opens with COPILOT OS DATA loaded, click Run Selection Criteria. For larger Towns this can take a while — let it finish. When the Selection Criteria Results grid populates, click Save Results to CSV and pick a folder. That CSV is what you bring into the app using the blue "Select File" button next to Source.', img: '20-BRT-Report.png' },
              { text: 'Code files on BRT: BRT does not currently provide a self-serve way to export the code file. If you make any table / codebook changes (new style, new land adjustment, VCS changes, etc.), contact Jim and he can push the updated code file for your Town.' },
            ],
          },
          {
            id: 'importing-appeal-logs',
            label: 'Importing Appeal Logs',
            intro:
              "The Appeal Log is your workflow tool for defending appeal valuations — it is NOT meant to replace MyNJAppeal or PowerCama appeal tracking. Think of it as the place where you organize what you owe a defense for and what is already settled.\n\n" +
              "You can re-import your appeal file as many times as you need. We check for already-imported appeals and just update hearing dates and judgments instead of creating duplicates.\n\n" +
              "Microsystems users: at this time appeals on the Microsystems side have to be added manually with the \"+ Add Appeal\" button. Skip the vendor sections below — those are for the BRT family of tools.",
            links: [
              { label: 'MyNJAppeal (online) →', target: 'mynj' },
              { label: 'BRT PowerCama →', target: 'brt-appeals' },
            ],
            steps: [
              { id: 'mynj', heading: 'MyNJAppeal — for online appeal users', text: 'In MyNJAppeal, go to Appeal Management. At the bottom of the grid there is a "Click to export data" button — click it. That download is the file you will import into the Copilot.', img: '23-mynjappeal.png' },
              { text: 'Back in the Copilot: open the Job → Appeal Log tab → click "Import MyNJAppeal" (the green button at the top of the log). Pick the file you just downloaded and it will populate your appeals automatically. Re-running the import later just refreshes hearing dates / judgments — no duplicates.', img: '24-mynjappeal-import.png' },
              { id: 'brt-appeals', heading: 'BRT PowerCama — for appeals tracked in PowerCama', text: 'In BRT Power Cama, open the top-level Appeals menu and choose "View County Current Appeals" (or "Add/Edit Appeals" if you are still building the list).', img: '25-BRTappeals.png' },
              { text: 'The appeals modal opens. At the bottom, click "Export to Excel". That XLSX is your import file.', img: '26-BRTappealmodal.png' },
              { text: 'Back in the Copilot: Appeal Log tab → click "Import PwrCama Appeals" and pick the Excel file you just exported. Same rules — re-importing just updates hearing dates and judgments on appeals already in the log.', img: '27-importbrtappeals.png' },
            ],
          },
          {
            id: 'powercomp-photos',
            label: 'Appeal Photos with the PowerComp',
            intro:
              "The Copilot can now generate a strict-market CME defense report and pair it with photos pulled from BRT's PowerComp Batch Taxpayer Report. End result: one PDF per appeal with comps, adjustments, map, and photos — ready for evidence submission.\n\n" +
              "Why we built it this way: the LOJIK CME is a strict market approach (similar to a real appraisal) instead of relying on Building Class / Cost Conversion Factor / Effective Age. The Assessor controls how comps are picked, and you can run multiple appeals at once as long as they share a VCS or market bracket — much faster than running them one-by-one in PowerComp.\n\n" +
              "Below is the full workflow, ordered. There is some one-time setup at the top (PowerComp version + a folder), then the repeatable per-appeal-cycle workflow.",
            links: [
              { label: 'One-time setup →', target: 'pwc-setup' },
              { label: 'CME workflow →', target: 'pwc-cme' },
              { label: 'PowerComp build →', target: 'pwc-build' },
              { label: 'Photos back into Copilot →', target: 'pwc-merge' },
            ],
            steps: [
              { id: 'pwc-setup', heading: '1. One-time setup — PowerComp version', text: 'You must be on PowerComp 2026 V43. The installer file from BRT is named "PowerCompSetup 2026 V43.msi" — reach out to Randy at BRT or Jim if you do not have it. UNINSTALL the older version BEFORE you install V43, otherwise the upgrade will not take cleanly.' },
              { heading: '2. One-time setup — create the duda folder', text: 'Open File Explorer and navigate to C:\\Powerpad\\Comparables. Right-click → New → Folder → name it exactly "duda". This is where the Copilot drops the comp files PowerComp will pick up.', img: '28-filexp.png' },
              { id: 'pwc-cme', heading: '3. Run evidence in the CME — group by VCS / market bracket', text: 'In Final Valuation → Sales Comparison (CME), run evidence on every appeal that needs a defense. Group similar properties (same VCS or market bracket) into the same saved Result Set so they share an adjustment frame. You can save Result Sets however you like — they all live under the Evaluate button so you can come back any time.' },
              { heading: '4. Refine each appeal in the Detailed view', text: 'Open the Detailed view for every appeal. Check the sales pulled in: remove anything you would not stand behind in front of the board, add anything missing, and update appellant evidence if they submitted comps you want to address.', img: '30-loadcomps.png' },
              { heading: '5. Export to PDF and Send to Appeal Log', text: 'When the Comps and Adjustments look right, hit Export to PDF. Verify the Map is accurate. If you want to hide the adjustments grid or hide the Director\'s Ratio study on this report, toggle that here. Instead of downloading the PDF, click "Send to Appeal Log".' },
              { heading: '6. What "Send to Appeal Log" does', text: 'Two things happen back in the Appeal Log:\n• The CME Value column turns into a blue value — that means you have prepared comps and locked in a defended value.\n• The Action column shows a "Report ✓" badge — that means a final report is on file.\nThis is your at-a-glance status of which appeals are defense-ready.', img: '29-appeal-log-cme.png' },
              { id: 'pwc-build', heading: '7. Build PowerComp files in bulk — orange Export CSV (PowerComp)', text: 'At the bottom of the page, click the orange "Export CSV (PowerComp)" button. (Other buttons in this row: green Import Batch PwrComp PDF, blue Batch Print Appeals, purple Bulk Upload Reports — we will use the green one in step 11.)', img: '35-PDF-Import.png' },
              { heading: '8. Pick which Result Sets to ship to PowerComp', text: 'A modal opens listing every saved Result Set. Everything is checked by default — uncheck any saved run you do NOT want to send. Common reason to uncheck: a subject has both an assessor run AND an appellant run, or there is a manager rebuttal you do not want shipped. Click "Export N to CSV" when ready.', img: '31-selectall.png' },
              { heading: '9. In PowerComp — Load Comps from File, then Select Record from File', text: 'Open PowerComp → Utilities → "Load Comps from File" → pick the CSV you just exported. The load is a silent success (no popup). IMMEDIATELY go back to Utilities → "Select Record from File" — that opens a popup listing every appeal. Click "Save All". PowerComp will flicker as it builds a .PWRC file for each appeal — give it time on a large batch.' },
              { heading: '10. Verify the PowerComp output (CRITICAL)', text: 'Open C:\\Powerpad\\Comparables\\<your folder> — you should see one .PWRC per appeal you sent. Open each one and check TWO things:\n\n(a) Phantom comps. If appeal A has 3 comps, appeal B has 4 comps, appeal C has 3 comps — PowerComp sometimes carries the 4th comp from B forward into C. (Reported to Randy, no fix yet.) Delete any phantom column before printing.\n\n(b) Photos. The subject and every comp must show the right exterior photo. If any are missing or wrong, the photos for that parcel have not been pulled into PowerComp yet — go to PowerCama → Cama → "Refresh Pictures" to download photos for the Town. This is slow and may take multiple sessions, but it is a one-time-per-Town hit.\n\nAt this stage you do NOT care about adjustments or values inside PowerComp — those are already locked in by the Copilot. You are only verifying that the right subject + right comps + right photos are loaded.', img: '32-PowerComp-Files.png' },
              { heading: '10a. What a missing-photos / phantom-comp page looks like', text: 'Subject photo present, but Comp 2 and Comp 3 are blank. Fix the photos in PowerCama (Refresh Pictures) before exporting the Batch Taxpayer Report.', img: '33-Photo-Bug.png' },
              { heading: '10b. What a clean page looks like', text: 'Subject + every comp showing the correct exterior photo. This is what you want before you Batch Print.', img: '34-Photo-Complete.png' },
              { id: 'pwc-merge', heading: '11. PowerComp — Batch Taxpayer Report', text: 'In PowerComp, go to File → Batch Taxpayer Report. Save the resulting PDF — that single PDF contains the photo pages for every appeal you just built.' },
              { heading: '12. Back in the Copilot — Import Batch PwrComp PDF', text: 'In the Appeal Log, click the green "Import Batch PwrComp PDF" button (the one we left alone in step 7). Pick the PDF you just saved. The parser matches each subject by Block / Lot / Qualifier and drops the photo pages into the appeal\'s photo bucket.' },
              { heading: '13. The photo badge — your finish line', text: 'In the Appeal Log Action column, the appeal now shows BOTH a "Report ✓" badge AND a small image badge — that means photos are attached. The blue print icon next to it now downloads the FULL evidence PDF (CME report + photo packet stitched together) ready for submission.', img: '36-photo-badge.png' },
            ],
          },
          {
            id: 'geocoding',
            label: 'Geocoding (sources, matching, pitfalls)',
            intro:
              "Geocoding = giving every parcel a lat/lng. Coordinates power the Appeal Map and the distance-from-subject filter in the CME, so clean coords pay off everywhere downstream.\n\n" +
              "Where they come from: the U.S. Census Bureau's free batch geocoder (matched against TIGER, their nationwide street database). The bulk run is an admin job — what you work with is the cleanup queue at Market Analysis → Data Quality → 📍 Coordinates for parcels that came back missing, low-confidence, or that you want to correct by hand.",
            steps: [
              { text: 'The cleanup queue has three buckets: Pending (no coords), Review (low-confidence — Tie, Non_Exact, ZIP Centroid, Approximate), Fixed (manual or high-confidence). Class chips narrow by property class; Sales Pool narrows to parcels inside the current sales-pool window so you can prioritize likely comps.', img: '11-geocoding.png' },
              { text: 'To fix one by hand: click the "Open" link in the Map column → right-click the correct rooftop in Google Maps → copy lat/lng → click the pin chip on the row to bring up the Edit Geocode modal → paste into the single field (Latitude and Longitude both fill automatically) → Save. It jumps to Fixed instantly. After a re-upload, new parcels appear in Pending and your saved coords are preserved.', img: '12-geo-modal.png' },
              { text: 'Pitfalls to know:\n• ALWAYS check your map on export — some Census matches land on the wrong block or at a ZIP centroid in a field. If a comp shows up across town, fix it here and re-export.\n• Tie = Census found more than one address that fits (same number on two streets). Manual fix only.\n• Condos inherit the mother lot\'s coords. If the mother lot is wrong, every child is wrong — fix the mother first.\n• Garbage addresses ("RT 1 BX 47", "REAR OF 123 MAIN") will not geocode cleanly and will need a manual lat/lng.' },
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
              <div id="help-modal-body" style={{ padding: '20px', overflowY: 'auto' }}>
                <p style={{ marginTop: 0, color: '#4b5563', fontSize: '0.95rem', whiteSpace: 'pre-line' }}>{activeTab.intro}</p>
                {activeTab.links && activeTab.links.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 16px' }}>
                    {activeTab.links.map((lnk) => (
                      <button
                        key={lnk.target}
                        onClick={() => {
                          const el = document.getElementById(`help-step-${lnk.target}`);
                          const scroller = document.getElementById('help-modal-body');
                          if (el && scroller) {
                            scroller.scrollTo({ top: el.offsetTop - scroller.offsetTop - 8, behavior: 'smooth' });
                          }
                        }}
                        style={{
                          padding: '6px 12px', borderRadius: '999px', border: '1px solid #d1d5db',
                          background: '#f9fafb', color: '#1f2937', cursor: 'pointer',
                          fontSize: '0.85rem', fontWeight: 500,
                        }}
                      >
                        {lnk.label}
                      </button>
                    ))}
                  </div>
                )}
                <ol style={{ paddingLeft: '20px', margin: 0 }}>
                  {activeTab.steps.map((step, i) => (
                    <li key={i} id={step.id ? `help-step-${step.id}` : undefined} style={{ marginBottom: '20px' }}>
                      {step.heading && (
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827', marginBottom: '6px' }}>
                          {step.heading}
                        </div>
                      )}
                      <div style={{ marginBottom: '8px', color: '#1f2937', whiteSpace: 'pre-line' }}>{step.text}</div>
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
