import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://zxvavttfvpsagzluqqwn.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4dmF2dHRmdnBzYWd6bHVxcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDA4NjcsImV4cCI6MjA2NzkxNjg2N30.Rrn2pTnImCpBIoKPcdlzzZ9hMwnYtIO5s7i1ejwQReg';

export const supabase = createClient(supabaseUrl, supabaseKey);

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
        inspectedProperties: job.inspected_properties || 0,
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
        inspected_properties: componentFields.inspectedProperties || 0,
        source_file_status: componentFields.sourceFileStatus || 'pending',
        code_file_status: componentFields.codeFileStatus || 'pending',
        vendor_detection: componentFields.vendorDetection,
        workflow_stats: componentFields.workflowStats,
        percent_billed: componentFields.percentBilled || 0,
        
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
      
      console.log('🔧 DEBUG - jobService.update() called with:', { id, updates });
      console.log('🔧 DEBUG - componentFields after destructuring:', componentFields);
      
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
      if (componentFields.inspectedProperties !== undefined) dbFields.inspected_properties = componentFields.inspectedProperties;
      if (componentFields.sourceFileStatus) dbFields.source_file_status = componentFields.sourceFileStatus;
      if (componentFields.codeFileStatus) dbFields.code_file_status = componentFields.codeFileStatus;
      if (componentFields.vendorDetection) dbFields.vendor_detection = componentFields.vendorDetection;
      if (componentFields.workflowStats) dbFields.workflow_stats = componentFields.workflowStats;
      
      // FIXED PERCENT BILLED MAPPING WITH DEBUG
      if (componentFields.percent_billed !== undefined) {
        console.log('🎯 DEBUG - Found percent_billed field, value:', componentFields.percent_billed);
        dbFields.percent_billed = componentFields.percent_billed;
      } else {
        console.log('⚠️ DEBUG - percent_billed field NOT found in componentFields');
        console.log('📋 DEBUG - Available fields:', Object.keys(componentFields));
      }

      console.log('💾 DEBUG - Final dbFields being sent to Supabase:', dbFields);

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
      
      console.log('✅ DEBUG - Supabase update successful, returned data:', data);
      return data;
    } catch (error) {
      console.error('Job update error:', error);
      throw error;
    }
  },

  // ENHANCED: Delete method with proper cascade deletion
  async delete(id) {
    try {
      console.log(`🗑️ Starting deletion process for job ${id}...`);

      // Step 1: Delete related comparison_reports first
      const { error: reportsError } = await supabase
        .from('comparison_reports')
        .delete()
        .eq('job_id', id);
      
      if (reportsError) {
        console.error('Error deleting comparison reports:', reportsError);
        // Don't throw here - continue with job deletion even if no reports exist
      } else {
        console.log('✅ Deleted comparison_reports for job', id);
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
      //   console.log('✅ Deleted property_change_log for job', id);
      // }

      // Step 3: Delete related job_assignments
      const { error: assignmentsError } = await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', id);
      
      if (assignmentsError) {
        console.error('Error deleting job assignments:', assignmentsError);
      } else {
        console.log('✅ Deleted job_assignments for job', id);
      }

      // Step 4: Delete related job_responsibilities (property assignments)
      const { error: responsibilitiesError } = await supabase
        .from('job_responsibilities')
        .delete()
        .eq('job_id', id);
      
      if (responsibilitiesError) {
        console.error('Error deleting job responsibilities:', responsibilitiesError);
      } else {
        console.log('✅ Deleted job_responsibilities for job', id);
      }

      // Step 5: Delete related property_records
      const { error: propertyError } = await supabase
        .from('property_records')
        .delete()
        .eq('job_id', id);
      
      if (propertyError) {
        console.error('Error deleting property records:', propertyError);
      } else {
        console.log('✅ Deleted property_records for job', id);
      }

      // Step 6: Delete related source_file_versions
      const { error: sourceFileError } = await supabase
        .from('source_file_versions')
        .delete()
        .eq('job_id', id);
      
      if (sourceFileError) {
        console.error('Error deleting source file versions:', sourceFileError);
      } else {
        console.log('✅ Deleted source_file_versions for job', id);
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

      console.log('🎉 Job deletion completed successfully!');
      
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
        potentialYear: pj.potential_year,
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
        potential_year: planningJobData.potentialYear,
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
        potential_year: updates.potentialYear,
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

  // FIXED: Import method with versionInfo parameter for FileUploadButton support
  async importCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      console.log(`Processing ${vendorType} files for job ${jobId}`);
      console.log('🔍 DEBUG - versionInfo received:', versionInfo);
      
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
      console.log(`Updating production summary for job ${jobId}`);
      
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
          inspected_properties: inspectedCount || 0,
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

  // FIXED: Enhanced stats function with correct property class field names
  async getStats() {
    try {
      // Get basic counts separately to avoid Promise.all masking errors
      const { count: employeeCount, error: empError } = await supabase
        .from('employees')
        .select('id', { count: 'exact', head: true });

      const { count: jobCount, error: jobError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true });

      const { count: propertyCount, error: propError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true });

      // FIXED: Use property_m4_class (not property_cama_class) for Microsystems compatibility
      // Get residential properties (M4 class 1, 2, 3A, 3B)
      const { count: residentialCount, error: residentialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['2', '3A']);

      // Get commercial properties (M4 class 4A, 4B, 4C)
      const { count: commercialCount, error: commercialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['4A', '4B', '4C']);

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
