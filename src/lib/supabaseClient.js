import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://zxvavttfvpsagzluqqwn.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4dmF2dHRmdnBzYWd6bHVxcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDA4NjcsImV4cCI6MjA2NzkxNjg2N30.Rrn2pTnImCpBIoKPcdlzzZ9hMwnYtIO5s7i1ejwQReg';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Define fields that must be preserved during file updates
const PRESERVED_FIELDS = [
  'project_start_date',      // ProductionTracker
  'is_assigned_property',    // AdminJobManagement  
  'validation_status',       // ProductionTracker
  'asset_building_class',    // FinalValuation
  'asset_design_style',      // FinalValuation
  'asset_ext_cond',         // FinalValuation
  'asset_int_cond',         // FinalValuation
  'asset_type_use',         // FinalValuation
  'asset_year_built',       // FinalValuation
  'asset_zoning',           // FinalValuation
  'location_analysis',      // MarketAnalysis
  'new_vcs',                // AppealCoverage
  'values_norm_size',       // Valuation adjustments
  'values_norm_time'        // Valuation adjustments
];

// ===== EMPLOYEE MANAGEMENT SERVICES =====
export const employeeService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('last_name');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return null;
    }
  },

  async create(employee) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert([employee])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkImport(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert(employees)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkUpsert(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .upsert(employees, { 
          onConflict: 'email',
          ignoreDuplicates: false 
        })
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee bulk upsert error:', error);
      throw error;
    }
  },

  async bulkUpdate(employees) {
    try {
      const updates = await Promise.all(
        employees.map(emp => 
          supabase
            .from('employees')
            .update(emp)
            .eq('id', emp.id)
            .select()
        )
      );
      
      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Employee bulk update error:', error);
      throw error;
    }
  },

  async getManagers() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .in('role', ['Management', 'Owner'])
        .order('last_name');
      
      if (error) throw error;
      
      // Hard-code admin capabilities for the three admins
      const managersWithAdminRoles = data.map(emp => {
        const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
        
        const isAdmin = emp.role === 'Owner' || 
                       fullName.includes('tom davis') || 
                       fullName.includes('brian schneider') || 
                       fullName.includes('james duda');
        
        return {
          ...emp,
          can_be_lead: true,
          is_admin: isAdmin,
          effective_role: 'admin'
        };
      });
      
      return managersWithAdminRoles;
    } catch (error) {
      console.error('Manager service error:', error);
      return this.getAll();
    }
  }
};

// ===== JOB MANAGEMENT SERVICES =====
export const jobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          job_assignments (
            id,
            role,
            employee:employees!job_assignments_employee_id_fkey (
              id,
              first_name,
              last_name,
              email,
              region
            )
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
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
        
        // ✅ FIXED: Added missing residential/commercial totals from database
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
        updated_at: job.updated_at,
        
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
    } catch (error) {
      console.error('Jobs service error:', error);
      return [];
    }
  },

  async create(jobData) {
    try {
      const { assignedManagers, ...componentFields } = jobData;
      
      const dbFields = {
        job_name: componentFields.name,
        client_name: componentFields.municipality,
        ccdd_code: componentFields.ccdd,
        municipality: componentFields.municipality,
        county: componentFields.county,
        state: componentFields.state || 'NJ',
        vendor_type: componentFields.vendor,
        status: componentFields.status || 'draft',
        start_date: componentFields.createdDate || new Date().toISOString().split('T')[0],
        end_date: componentFields.dueDate,
        target_completion_date: componentFields.dueDate,
        total_properties: componentFields.totalProperties || 0,
        // inspected_properties: componentFields.inspectedProperties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live App.js analytics
        source_file_status: componentFields.sourceFileStatus || 'pending',
        code_file_status: componentFields.codeFileStatus || 'pending',
        vendor_detection: componentFields.vendorDetection,
        workflow_stats: componentFields.workflowStats,
        percent_billed: componentFields.percentBilled || 0,
        
        // ADDED: File version tracking
        source_file_version: componentFields.source_file_version || 1,
        code_file_version: componentFields.code_file_version || 1,
        
        // ADDED: File tracking fields for FileUploadButton
        source_file_name: componentFields.source_file_name,
        source_file_version_id: componentFields.source_file_version_id,
        source_file_uploaded_at: componentFields.source_file_uploaded_at,
        
        created_by: componentFields.created_by || componentFields.createdBy
      };
      
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (jobError) throw jobError;

      if (assignedManagers && assignedManagers.length > 0) {
        const assignments = assignedManagers.map(manager => ({
          job_id: job.id,
          employee_id: manager.id,
          role: manager.role,
          assigned_by: dbFields.created_by,
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true
        }));

        const { error: assignError } = await supabase
          .from('job_assignments')
          .insert(assignments);
        
        if (assignError) {
          console.error('Manager assignment error:', assignError);
        }
      }

      return job;
    } catch (error) {
      console.error('Job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { assignedManagers, ...componentFields } = updates;
      
      
      const dbFields = {};
      
      // Map component fields to database fields
      if (componentFields.name) dbFields.job_name = componentFields.name;
      if (componentFields.municipality) dbFields.municipality = componentFields.municipality;
      if (componentFields.ccdd) dbFields.ccdd_code = componentFields.ccdd;
      if (componentFields.county) dbFields.county = componentFields.county;
      if (componentFields.state) dbFields.state = componentFields.state;
      if (componentFields.vendor) dbFields.vendor_type = componentFields.vendor;
      if (componentFields.status) dbFields.status = componentFields.status;
      if (componentFields.dueDate) {
        dbFields.end_date = componentFields.dueDate;
        dbFields.target_completion_date = componentFields.dueDate;
      }
      if (componentFields.totalProperties !== undefined) dbFields.total_properties = componentFields.totalProperties;
      // if (componentFields.inspectedProperties !== undefined) dbFields.inspected_properties = componentFields.inspectedProperties;  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
      if (componentFields.sourceFileStatus) dbFields.source_file_status = componentFields.sourceFileStatus;
      if (componentFields.codeFileStatus) dbFields.code_file_status = componentFields.codeFileStatus;
      if (componentFields.vendorDetection) dbFields.vendor_detection = componentFields.vendorDetection;
      if (componentFields.workflowStats) dbFields.workflow_stats = componentFields.workflowStats;
      
      // FIXED PERCENT BILLED MAPPING WITH DEBUG
      if (componentFields.percent_billed !== undefined) {
        dbFields.percent_billed = componentFields.percent_billed;
      } else {
      }


      const { data, error } = await supabase
        .from('jobs')
        .update(dbFields)
        .eq('id', id)
        .select()
        .single();
      
      if (error) {
        console.error('❌ DEBUG - Supabase update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Job update error:', error);
      throw error;
    }
  },

  // ENHANCED: Delete method with proper cascade deletion
  async delete(id) {
    try {

      // Step 1: Delete related comparison_reports first
      const { error: reportsError } = await supabase
        .from('comparison_reports')
        .delete()
        .eq('job_id', id);
      
      if (reportsError) {
        console.error('Error deleting comparison reports:', reportsError);
        // Don't throw here - continue with job deletion even if no reports exist
      } else {
      }

      // Step 2: Delete related property_change_log records (commented out - table doesn't exist)
      // const { error: changeLogError } = await supabase
      //   .from('property_change_log')
      //   .delete()
      //   .eq('job_id', id);
      // 
      // if (changeLogError) {
      //   console.error('Error deleting change log:', changeLogError);
      //   // Don't throw here - table might not exist or no records
      // } else {
      // }

      // Step 3: Delete related job_assignments
      const { error: assignmentsError } = await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', id);
      
      if (assignmentsError) {
        console.error('Error deleting job assignments:', assignmentsError);
      } else {
      }

      // Step 4: Delete related job_responsibilities (property assignments)
      const { error: responsibilitiesError } = await supabase
        .from('job_responsibilities')
        .delete()
        .eq('job_id', id);
      
      if (responsibilitiesError) {
        console.error('Error deleting job responsibilities:', responsibilitiesError);
      } else {
      }

      // Step 5: Delete related property_records
      const { error: propertyError } = await supabase
        .from('property_records')
        .delete()
        .eq('job_id', id);
      
      if (propertyError) {
        console.error('Error deleting property records:', propertyError);
      } else {
      }

      // Step 6: Delete related source_file_versions
      const { error: sourceFileError } = await supabase
        .from('source_file_versions')
        .delete()
        .eq('job_id', id);
      
      if (sourceFileError) {
        console.error('Error deleting source file versions:', sourceFileError);
      } else {
      }

      // Step 7: Finally delete the job itself
      const { error: jobError } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);
      
      if (jobError) {
        console.error('❌ FINAL ERROR - Failed to delete job:', jobError);
        throw jobError;
      }

      
    } catch (error) {
      console.error('Job deletion error:', error);
      throw error;
    }
  }
};

// ===== PLANNING JOB SERVICES =====
export const planningJobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('planning_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(pj => ({
        id: pj.id,
        ccddCode: pj.ccdd_code,
        ccdd: pj.ccdd_code, // Alternative accessor
        municipality: pj.municipality,
        end_date: pj.end_date,  // Use end_date instead
        comments: pj.comments
      }));
    } catch (error) {
      console.error('Planning jobs error:', error);
      return [];
    }
  },

  async create(planningJobData) {
    try {
      const dbFields = {
        ccdd_code: planningJobData.ccddCode || planningJobData.ccdd,
        municipality: planningJobData.municipality,
        end_date: planningJobData.end_date,
        comments: planningJobData.comments,
        created_by: planningJobData.created_by
      };
      
      const { data, error } = await supabase
        .from('planning_jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const dbFields = {
        ccdd_code: updates.ccddCode || updates.ccdd,
        municipality: updates.municipality,
        end_date: updates.end_date,
        comments: updates.comments
      };

      const { data, error } = await supabase
        .from('planning_jobs')
        .update(dbFields)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('planning_jobs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Planning job deletion error:', error);
      throw error;
    }
  }
};

// ===== CHECKLIST MANAGEMENT SERVICES =====
export const checklistService = {
  // Get all checklist items for a job
  async getChecklistItems(jobId) {
    try {
      
      const { data, error } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('job_id', jobId)
        .order('item_order');
      
      if (error) throw error;
      
      return data || [];
    } catch (error) {
      console.error('Checklist items fetch error:', error);
      return [];
    }
  },

  // Update item status (completed, pending, etc.)
  async updateItemStatus(itemId, status, completedBy) {
    try {
      const updates = {
        status: status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
        completed_by: status === 'completed' ? completedBy : null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Checklist status update error:', error);
      throw error;
    }
  },

  // Update client approval
  async updateClientApproval(itemId, approved, approvedBy) {
    try {
      const updates = {
        client_approved: approved,
        client_approved_date: approved ? new Date().toISOString() : null,
        client_approved_by: approved ? approvedBy : null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Client approval update error:', error);
      throw error;
    }
  },

  // Create initial checklist items for a new job
  async createChecklistForJob(jobId, checklistType = 'revaluation') {
    try {
      
      // The 29 template items
      const templateItems = [
        // Setup Category (1-8)
        { item_order: 1, item_text: 'Contract Signed by Client', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 2, item_text: 'Contract Signed/Approved by State', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 3, item_text: 'Tax Maps Approved', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 4, item_text: 'Tax Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 5, item_text: 'Zoning Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 6, item_text: 'Zoning Bulk and Use Regulations Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 7, item_text: 'PPA Website Updated', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 8, item_text: 'Data Collection Parameters', category: 'setup', requires_client_approval: true, allows_file_upload: false },
        
        // Inspection Category (9-14)
        { item_order: 9, item_text: 'Initial Mailing List', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_mailing_list' },
        { item_order: 10, item_text: 'Initial Letter and Brochure', category: 'inspection', requires_client_approval: false, allows_file_upload: true, special_action: 'generate_letter' },
        { item_order: 11, item_text: 'Initial Mailing Sent', category: 'inspection', requires_client_approval: false, allows_file_upload: false },
        { item_order: 12, item_text: 'First Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, auto_update_source: 'production_tracker' },
        { item_order: 13, item_text: 'Second Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_second_attempt_mailer' },
        { item_order: 14, item_text: 'Third Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_third_attempt_mailer' },
        
        // Analysis Category (15-26)
        { item_order: 15, item_text: 'Market Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: true },
        { item_order: 16, item_text: 'Page by Page Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 17, item_text: 'Lot Sizing Completed', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 18, item_text: 'Lot Sizing Questions Complete', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 19, item_text: 'VCS Reviewed/Reset', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 20, item_text: 'Land Value Tables Built', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 21, item_text: 'Land Values Entered', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 22, item_text: 'Economic Obsolescence Study', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 23, item_text: 'Cost Conversion Factor Set', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 24, item_text: 'Building Class Review/Updated', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 25, item_text: 'Effective Age Loaded/Set', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 26, item_text: 'Final Values Ready', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        
        // Completion Category (27-29)
        { item_order: 27, item_text: 'View Value Mailer', category: 'completion', requires_client_approval: false, allows_file_upload: true, special_action: 'view_impact_letter' },
        { item_order: 28, item_text: 'Generate Turnover Document', category: 'completion', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_turnover_pdf' },
        { item_order: 29, item_text: 'Turnover Date', category: 'completion', requires_client_approval: false, allows_file_upload: false, input_type: 'date', special_action: 'archive_trigger' }
      ];

      // Add job_id and default status to each item
      const itemsToInsert = templateItems.map(item => ({
        ...item,
        job_id: jobId,
        status: 'pending',
        checklist_type: checklistType,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert)
        .select();
      
      if (error) throw error;
      
      return data;
    } catch (error) {
      console.error('Checklist creation error:', error);
      throw error;
    }
  },

  // Update client/assessor name on job
  async updateClientName(jobId, clientName) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          client_name: clientName,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Client name update error:', error);
      throw error;
    }
  },

  // Upload file for checklist item
  async uploadFile(itemId, jobId, file, completedBy) {
    try {
      // Create unique file name
      const timestamp = Date.now();
      const fileName = `${jobId}/${itemId}_${timestamp}_${file.name}`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('checklist-documents')
        .upload(fileName, file);
      
      if (uploadError) throw uploadError;
      
      // Save file info to checklist_documents table
      const { data: docData, error: docError } = await supabase
        .from('checklist_documents')
        .insert({
          checklist_item_id: itemId,
          job_id: jobId,
          file_name: file.name,
          file_path: fileName,
          file_size: file.size,
          uploaded_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (docError) throw docError;
      
      // Update checklist item to completed status
      const { data: itemData, error: itemError } = await supabase
        .from('checklist_items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: completedBy,
          file_attachment_path: fileName,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (itemError) throw itemError;
      
      return itemData;
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  },

  // Generate mailing list from property records
  async generateMailingList(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('property_block, property_lot, property_location, owner_name, owner_address')
        .eq('job_id', jobId)
        .order('property_block, property_lot')
        .limit(1000);
      
      if (error) throw error;
      
      return data;
    } catch (error) {
      console.error('Mailing list generation error:', error);
      throw error;
    }
  },

  // Update notes for a checklist item
  async updateItemNotes(itemId, notes) {
    try {
      const { data, error } = await supabase
        .from('checklist_items')
        .update({ 
          notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Notes update error:', error);
      throw error;
    }
  },

  // Archive job when turnover date is set
  async archiveJob(jobId, turnoverDate) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          status: 'archived',
          turnover_date: turnoverDate,
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Job archive error:', error);
      throw error;
    }
  }
};

// ===== UNIFIED PROPERTY MANAGEMENT SERVICES =====
export const propertyService = {
  async getAll(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return null;
    }
  },

  async create(propertyData) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert([propertyData])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property creation error:', error);
      throw error;
    }
  },

  async bulkCreate(propertyDataArray) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert(propertyDataArray)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property bulk creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('property_records')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Property deletion error:', error);
      throw error;
    }
  },

  // EXISTING: Import method with versionInfo parameter for FileUploadButton support - CALLS PROCESSORS (INSERT)
  async importCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      
      // Use updated processors for single-table insertion
      if (vendorType === 'BRT') {
        const { brtProcessor } = await import('./data-pipeline/brt-processor.js');
        return await brtProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsProcessor } = await import('./data-pipeline/microsystems-processor.js');
        return await microsystemsProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property import error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // ENHANCED: Update method with field preservation that calls UPDATERS (UPSERT) for existing jobs
  async updateCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      
      // Store preserved fields handler in versionInfo for updaters to use
      versionInfo.preservedFieldsHandler = this.createPreservedFieldsHandler.bind(this);
      versionInfo.preservedFields = PRESERVED_FIELDS;
      
      // Use updaters for UPSERT operations
      if (vendorType === 'BRT') {
        const { brtUpdater } = await import('./data-pipeline/brt-updater.js');
        return await brtUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsUpdater } = await import('./data-pipeline/microsystems-updater.js');
        return await microsystemsUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property update error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // Helper method to create a preserved fields handler for the updaters
  async createPreservedFieldsHandler(jobId, compositeKeys) {
    const preservedDataMap = new Map();
    
    try {
      // Batch fetch in chunks to avoid query limits
      const chunkSize = 500;
      for (let i = 0; i < compositeKeys.length; i += chunkSize) {
        const chunk = compositeKeys.slice(i, i + chunkSize);
        
        const { data: existingRecords, error } = await supabase
          .from('property_records')
          .select(`
            property_composite_key,
            ${PRESERVED_FIELDS.join(',')}
          `)
          .eq('job_id', jobId)
          .in('property_composite_key', chunk);

        if (error) {
          console.error('Error fetching preserved data:', error);
          continue;
        }

        // Build preservation map
        existingRecords?.forEach(record => {
          const preserved = {};
          PRESERVED_FIELDS.forEach(field => {
            if (record[field] !== null && record[field] !== undefined) {
              preserved[field] = record[field];
            }
          });
          
          // Only add to map if there's data to preserve
          if (Object.keys(preserved).length > 0) {
            preservedDataMap.set(record.property_composite_key, preserved);
          }
        });
      }
      
    } catch (error) {
      console.error('Error in createPreservedFieldsHandler:', error);
    }

    return preservedDataMap;
  },

  // Query raw_data JSON field for dynamic reporting
  async queryRawData(jobId, fieldName, value) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .eq(`raw_data->>${fieldName}`, value);
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property raw data query error:', error);
      return [];
    }
  },

  // Advanced filtering for analysis
  async getByCondition(jobId, condition) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .eq('condition_rating', condition)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property condition query error:', error);
      return [];
    }
  },

  // Get properties needing inspection
  async getPendingInspections(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .is('inspection_info_by', null)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property pending inspections query error:', error);
      return [];
    }
  },

  // Bulk update inspection data
  async bulkUpdateInspections(inspectionUpdates) {
    try {
      const updates = await Promise.all(
        inspectionUpdates.map(update => 
          supabase
            .from('property_records')
            .update({
              ...update.data,
              updated_at: new Date().toISOString()
            })
            .eq('id', update.id)
            .select()
        )
      );
      
      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Property bulk inspection update error:', error);
      throw error;
    }
  }
};

// ===== SOURCE FILE SERVICES =====
export const sourceFileService = {
  async createVersion(jobId, fileName, fileSize, uploadedBy) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .insert([{
          job_id: jobId,
          file_name: fileName,
          file_size: fileSize,
          status: 'pending',
          uploaded_by: uploadedBy
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file creation error:', error);
      return {
        id: Date.now(),
        version_number: 1,
        file_name: fileName,
        status: 'pending'
      };
    }
  },

  async getVersions(jobId) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file versions error:', error);
      return [];
    }
  },

  async updateStatus(id, status) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file status update error:', error);
      throw error;
    }
  }
};

// ===== PRODUCTION DATA SERVICES =====
export const productionDataService = {
  async updateSummary(jobId) {
    try {
      
      // Get property counts from single table
      const { count, error: countError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId);

      if (countError) throw countError;

      // Count properties with inspection data
      const { count: inspectedCount, error: inspectedError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .not('inspection_info_by', 'is', null);

      if (inspectedError) throw inspectedError;

      // Update job with current totals
      const { data, error } = await supabase
        .from('jobs')
        .update({
          total_properties: count || 0,
          // inspected_properties: inspectedCount || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
          workflow_stats: {
            properties_processed: count || 0,
            properties_inspected: inspectedCount || 0,
            last_updated: new Date().toISOString()
          }
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Production data update error:', error);
      return { success: false, error: error.message };
    }
  }
};

// ===== UTILITY SERVICES =====
export const utilityService = {
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id')
        .limit(1);
      
      return { success: !error, error };
    } catch (error) {
      return { success: false, error: error };
    }
  },

  // ENHANCED: Assignment-aware stats function with correct property class field names
  async getStats() {
    try {
      // Get basic counts separately to avoid Promise.all masking errors
      const { count: employeeCount, error: empError } = await supabase
        .from('employees')
        .select('id', { count: 'exact', head: true });

      const { count: jobCount, error: jobError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true });

      // UPDATED: Count all properties (assigned or unassigned)
      const { count: propertyCount, error: propError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get residential properties (M4 class 2, 3A) - assignment-aware
      const { count: residentialCount, error: residentialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['2', '3A'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get commercial properties (M4 class 4A, 4B, 4C) - assignment-aware
      const { count: commercialCount, error: commercialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['4A', '4B', '4C'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // Log any errors but don't fail completely
      if (empError) console.error('Employee count error:', empError);
      if (jobError) console.error('Job count error:', jobError);
      if (propError) console.error('Property count error:', propError);
      if (residentialError) console.error('Residential count error:', residentialError);
      if (commercialError) console.error('Commercial count error:', commercialError);

      const totalProperties = propertyCount || 0;
      const residential = residentialCount || 0;
      const commercial = commercialCount || 0;
      const other = Math.max(0, totalProperties - residential - commercial);

      return {
        employees: employeeCount || 0,
        jobs: jobCount || 0,
        properties: totalProperties,
        propertiesBreakdown: {
          total: totalProperties,
          residential: residential,
          commercial: commercial,
          other: other
        }
      };
    } catch (error) {
      console.error('Stats fetch error:', error);
      return {
        employees: 0,
        jobs: 0,
        properties: 0,
        propertiesBreakdown: {
          total: 0,
          residential: 0,
          commercial: 0,
          other: 0
        }
      };
    }
  }
};

// ===== AUTHENTICATION SERVICES =====
export const authService = {
  async getCurrentUser() {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      if (user) {
        const { data: employee, error: empError } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', user.id)
          .single();
        
        if (empError) {
          console.warn('Employee profile not found');
          return {
            ...user,
            role: 'admin',
            canAccessBilling: true
          };
        }
        
        return {
          ...user,
          employee,
          role: employee.role,
          canAccessBilling: ['admin', 'owner'].includes(employee.role) || user.id === '5df85ca3-7a54-4798-a665-c31da8d9caad'
        };
      }
      
      return null;
    } catch (error) {
      console.error('Auth error:', error);
      return null;
    }
  },

  async signInAsDev() {
    return {
      user: {
        id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
        email: 'ppalead1@gmail.com'
      },
      role: 'admin',
      canAccessBilling: true
    };
  },

  async signIn(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  },

  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }
};

// ===== LEGACY COMPATIBILITY =====
export const signInAsDev = authService.signInAsDev;

export default supabase;
