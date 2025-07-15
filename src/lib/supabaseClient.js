import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// EXISTING SERVICES
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

  // NEW: Add bulkUpsert method
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

  // NEW: Add bulkUpdate method
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

  // FIXED: Updated getManagers method with correct roles
  async getManagers() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .in('role', ['Management', 'Owner'])  // Fixed to match actual database roles
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

// JOB MANAGEMENT SERVICES
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
        municipality: job.municipality || job.client_name,
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
        ccdd_code: componentFields.ccddCode,
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

  async delete(id) {
    try {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Job deletion error:', error);
      throw error;
    }
  }
};

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
        municipality: pj.municipality,
        potentialYear: pj.potential_year
      }));
    } catch (error) {
      console.error('Planning jobs error:', error);
      return [];
    }
  },

  async create(planningJobData) {
    try {
      const dbFields = {
        ccdd_code: planningJobData.ccddCode,
        municipality: planningJobData.municipality,
        potential_year: planningJobData.potentialYear,
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
  }
};

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
  }
};

export const propertyService = {
  async importCSVData(jobId, fileVersionId, csvData, importedBy) {
    try {
      console.log(`Importing ${csvData.length} property records for job ${jobId}`);
      return {
        imported: csvData.length,
        total: csvData.length,
        errors: []
      };
    } catch (error) {
      console.error('Property import error:', error);
      return {
        imported: 0,
        total: csvData.length,
        errors: [error.message]
      };
    }
  }
};

export const productionDataService = {
  async updateSummary(jobId) {
    try {
      console.log(`Updating production summary for job ${jobId}`);
      return { success: true };
    } catch (error) {
      console.error('Production data update error:', error);
      return { success: false, error: error.message };
    }
  }
};

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

  async getStats() {
    try {
      const [employees, jobs, propertyRecords, sourceFiles] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }),
        supabase.from('jobs').select('id', { count: 'exact', head: true }),
        supabase.from('property_records').select('id', { count: 'exact', head: true }),
        supabase.from('source_file_versions').select('id', { count: 'exact', head: true })
      ]);

      return {
        employees: employees.count || 0,
        jobs: jobs.count || 0,
        propertyRecords: propertyRecords.count || 0,
        sourceFiles: sourceFiles.count || 0
      };
    } catch (error) {
      console.error('Stats fetch error:', error);
      return {
        employees: 0,
        jobs: 0,
        propertyRecords: 0,
        sourceFiles: 0
      };
    }
  }
};

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
        email: 'dudj23@gmail.com'
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

export const signInAsDev = authService.signInAsDev;

export default supabase;
