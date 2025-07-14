import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// EXISTING SERVICES (keeping your current ones)
export const employeeService = {
  async getAll() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('last_name');
    
    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async create(employee) {
    const { data, error } = await supabase
      .from('employees')
      .insert([employee])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('employees')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('employees')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  async bulkImport(employees) {
    const { data, error } = await supabase
      .from('employees')
      .insert(employees)
      .select();
    
    if (error) throw error;
    return data;
  },

  // Get managers only (for job assignment)
  async getManagers() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .in('role', ['admin', 'manager'])
      .eq('employment_status', 'active')
      .order('last_name');
    
    if (error) throw error;
    return data;
  }
};

// NEW JOB MANAGEMENT SERVICES
export const jobService = {
  async getAll() {
    const { data, error } = await supabase
      .from('jobs')
      .select(`
        *,
        job_managers (
          id,
          role,
          employee:employees (
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
    
    // Transform the data to match component expectations
    return data.map(job => ({
      ...job,
      assignedManagers: job.job_managers.map(jm => ({
        id: jm.employee.id,
        name: `${jm.employee.first_name} ${jm.employee.last_name}`,
        role: jm.role,
        email: jm.employee.email,
        region: jm.employee.region
      }))
    }));
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('jobs')
      .select(`
        *,
        job_managers (
          id,
          role,
          employee:employees (
            id,
            first_name,
            last_name,
            email,
            region
          )
        )
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    // Transform the data
    return {
      ...data,
      assignedManagers: data.job_managers.map(jm => ({
        id: jm.employee.id,
        name: `${jm.employee.first_name} ${jm.employee.last_name}`,
        role: jm.role,
        email: jm.employee.email,
        region: jm.employee.region
      }))
    };
  },

  async create(jobData) {
    const { assignedManagers, ...jobFields } = jobData;
    
    // Create the job
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert([jobFields])
      .select()
      .single();
    
    if (jobError) throw jobError;

    // Assign managers if provided
    if (assignedManagers && assignedManagers.length > 0) {
      const managerAssignments = assignedManagers.map(manager => ({
        job_id: job.id,
        employee_id: manager.id,
        role: manager.role,
        assigned_by: jobFields.created_by
      }));

      const { error: managerError } = await supabase
        .from('job_managers')
        .insert(managerAssignments);
      
      if (managerError) throw managerError;
    }

    return job;
  },

  async update(id, updates) {
    const { assignedManagers, ...jobFields } = updates;
    
    // Update job fields
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .update(jobFields)
      .eq('id', id)
      .select()
      .single();
    
    if (jobError) throw jobError;

    // Update manager assignments if provided
    if (assignedManagers !== undefined) {
      // Remove existing assignments
      await supabase
        .from('job_managers')
        .delete()
        .eq('job_id', id);

      // Add new assignments
      if (assignedManagers.length > 0) {
        const managerAssignments = assignedManagers.map(manager => ({
          job_id: id,
          employee_id: manager.id,
          role: manager.role,
          assigned_by: jobFields.updated_by || 'system'
        }));

        const { error: managerError } = await supabase
          .from('job_managers')
          .insert(managerAssignments);
        
        if (managerError) throw managerError;
      }
    }

    return job;
  },

  async delete(id) {
    // Managers will be deleted automatically due to CASCADE
    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  },

  async updateWorkflowStats(jobId, stats) {
    const { data, error } = await supabase
      .from('jobs')
      .update({ workflow_stats: stats })
      .eq('id', jobId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateProgress(jobId, inspectedProperties) {
    const { data, error } = await supabase
      .from('jobs')
      .update({ inspected_properties: inspectedProperties })
      .eq('id', jobId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

export const planningJobService = {
  async getAll() {
    const { data, error } = await supabase
      .from('planning_jobs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  async create(planningJob) {
    const { data, error } = await supabase
      .from('planning_jobs')
      .insert([planningJob])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async convertToJob(planningJobId, jobData) {
    // Create the full job
    const job = await jobService.create(jobData);
    
    // Delete the planning job
    await supabase
      .from('planning_jobs')
      .delete()
      .eq('id', planningJobId);
    
    return job;
  },

  async delete(id) {
    const { error } = await supabase
      .from('planning_jobs')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
};

export const jobManagerService = {
  async getByJobId(jobId) {
    const { data, error } = await supabase
      .from('job_managers')
      .select(`
        *,
        employee:employees (
          id,
          first_name,
          last_name,
          email,
          region,
          can_be_lead
        )
      `)
      .eq('job_id', jobId);
    
    if (error) throw error;
    return data;
  },

  async assign(jobId, employeeId, role, assignedBy) {
    const { data, error } = await supabase
      .from('job_managers')
      .insert([{
        job_id: jobId,
        employee_id: employeeId,
        role: role,
        assigned_by: assignedBy
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateRole(jobManagerId, newRole) {
    const { data, error } = await supabase
      .from('job_managers')
      .update({ role: newRole })
      .eq('id', jobManagerId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async remove(jobManagerId) {
    const { error } = await supabase
      .from('job_managers')
      .delete()
      .eq('id', jobManagerId);
    
    if (error) throw error;
  },

  // Get manager workload across all jobs
  async getManagerWorkload() {
    const { data, error } = await supabase
      .from('job_managers')
      .select(`
        employee_id,
        role,
        job:jobs (
          id,
          name,
          status,
          vendor_type
        ),
        employee:employees (
          id,
          first_name,
          last_name,
          email,
          region,
          can_be_lead
        )
      `)
      .eq('job.status', 'active');
    
    if (error) throw error;
    
    // Group by employee and calculate workload
    const workloadMap = {};
    data.forEach(assignment => {
      const empId = assignment.employee_id;
      if (!workloadMap[empId]) {
        workloadMap[empId] = {
          ...assignment.employee,
          activeJobs: 0,
          assignments: []
        };
      }
      workloadMap[empId].activeJobs++;
      workloadMap[empId].assignments.push({
        job: assignment.job,
        role: assignment.role
      });
    });
    
    return Object.values(workloadMap);
  }
};

export const sourceFileService = {
  async createVersion(jobId, fileName, fileSize, uploadedBy) {
    const { data, error } = await supabase
      .from('job_files')
      .insert([{
        job_id: jobId,
        file_type: 'source',
        original_filename: fileName,
        file_size: fileSize,
        processing_status: 'pending',
        uploaded_by: uploadedBy,
        version: 1 // Will be auto-incremented in real implementation
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async updateVersion(fileId, updates) {
    const { data, error } = await supabase
      .from('job_files')
      .update(updates)
      .eq('id', fileId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getByJobId(jobId) {
    const { data, error } = await supabase
      .from('job_files')
      .select('*')
      .eq('job_id', jobId)
      .order('uploaded_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
};

export const propertyService = {
  async importCSVData(jobId, fileVersionId, csvData, importedBy) {
    // This would handle the actual property data import
    // For now, return mock success
    return {
      imported: csvData.length,
      total: csvData.length,
      errors: []
    };
  },

  async getByJobId(jobId, filters = {}) {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('job_id', jobId);
    
    if (error) throw error;
    return data;
  },

  async updateInspectionStatus(propertyId, inspectionData) {
    const { data, error } = await supabase
      .from('properties')
      .update(inspectionData)
      .eq('id', propertyId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

export const productionDataService = {
  async updateSummary(jobId) {
    // Calculate and update production summary stats
    // This would aggregate property inspection data
    const { data, error } = await supabase
      .rpc('calculate_production_summary', { job_id: jobId });
    
    if (error) throw error;
    return data;
  },

  async getStats(jobId) {
    const { data, error } = await supabase
      .from('production_summary')
      .select('*')
      .eq('job_id', jobId)
      .single();
    
    if (error) throw error;
    return data;
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
    } catch (err) {
      return { success: false, error: err };
    }
  },

  async getStats() {
    const [employees, jobs, propertyRecords, sourceFiles] = await Promise.all([
      supabase.from('employees').select('id', { count: 'exact', head: true }),
      supabase.from('jobs').select('id', { count: 'exact', head: true }),
      supabase.from('properties').select('id', { count: 'exact', head: true }),
      supabase.from('job_files').select('id', { count: 'exact', head: true })
    ]);

    return {
      employees: employees.count || 0,
      jobs: jobs.count || 0,
      propertyRecords: propertyRecords.count || 0,
      sourceFiles: sourceFiles.count || 0
    };
  }
};

// VENDOR DETECTION SERVICE (for file processing)
export const vendorDetectionService = {
  async analyzeFile(file) {
    // This would integrate with your existing processor logic
    const text = await file.text();
    
    // Microsystems detection
    if (file.name.endsWith('.txt') && text.includes('Block|Lot|Qual')) {
      return {
        vendor: 'Microsystems',
        confidence: 100,
        detectedFormat: 'Microsystems Text Delimited',
        fileStructure: 'Block|Lot|Qual headers with pipe separators'
      };
    }
    
    // BRT detection
    if ((file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) && 
        text.includes('VALUES_LANDTAXABLEVALUE')) {
      return {
        vendor: 'BRT',
        confidence: 100,
        detectedFormat: 'BRT CSV Export',
        fileStructure: '370 columns with VALUES_LANDTAXABLEVALUE header'
      };
    }
    
    return null;
  }
};

// AUTH SERVICE (for user management)
export const authService = {
  async getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    
    if (user) {
      // Get employee profile
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();
      
      if (empError) throw empError;
      
      return {
        ...user,
        employee,
        role: employee.role,
        canAccessBilling: ['admin', 'owner'].includes(employee.role) || employee.id === 'your-user-id'
      };
    }
    
    return null;
  },

  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
};

export default supabase;
