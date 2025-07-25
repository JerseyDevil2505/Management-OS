// In supabaseClient.js, update the jobService.getAll() return mapping:

return data.map(job => ({
  id: job.id,
  name: job.job_name,
  ccddCode: job.ccdd_code,
  ccdd: job.ccdd_code, // ADDED: Alternative accessor for backward compatibility
  municipality: job.municipality || job.client_name,
  job_number: job.job_number,
  year_created: job.year_created,
  county: job.county,
  state: job.state,
  vendor: job.vendor_type,
  status: job.status,
  createdDate: job.start_date,
  dueDate: job.end_date || job.target_completion_date,
  totalProperties: job.total_properties || 0,
  
  // ✅ ADDED: Missing residential/commercial totals from database
  totalresidential: job.totalresidential || 0,
  totalcommercial: job.totalcommercial || 0,
  
  // inspectedProperties: job.inspected_properties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live analytics
  sourceFileStatus: job.source_file_status || 'pending',
  codeFileStatus: job.code_file_status || 'pending',
  vendorDetection: job.vendor_detection,
  workflowStats: job.workflow_stats,
  percent_billed: job.percent_billed,  // FIXED: was percentBilling, now percent_billed
  
  // ADDED: Property assignment tracking for enhanced metrics
  has_property_assignments: job.has_property_assignments || false,
  assigned_has_commercial: job.assigned_has_commercial || false,
  assignedPropertyCount: job.assigned_property_count || 0,
  
  // ADDED: File timestamp tracking for FileUploadButton
  created_at: job.created_at,
  source_file_uploaded_at: job.source_file_uploaded_at,
  code_file_uploaded_at: job.code_file_uploaded_at,
  
  // ADDED: File version tracking
  source_file_version: job.source_file_version || 1,
  code_file_version: job.code_file_version || 1,
  
  assignedManagers: job.job_assignments?.map(ja => ({
    id: ja.employee.id,
    name: `${ja.employee.first_name} ${ja.employee.last_name}`,
    role: ja.role,
    email: ja.employee.email,
    region: ja.employee.region
  })) || []
}));
