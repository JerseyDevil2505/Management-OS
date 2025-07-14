// supabaseClient.js
// Database services for PPA Management OS

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zxvavttfvpsagzluqqwn.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4dmF2dHRmdnBzYWd6bHVxcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDA4NjcsImV4cCI6MjA2NzkxNjg2N30.Rrn2pTnImCpBIoKPcdlzzZ9hMwnYtIO5s7i1ejwQReg'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Add anonymous authentication for development
export const signInAnonymously = async () => {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) console.error('Auth error:', error);
  return data;
};

// =============================================
// EMPLOYEE SERVICES
// =============================================
export const employeeService = {
  // Get all employees
  async getAll() {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .order('last_name', { ascending: true })
    
    if (error) throw error
    return data
  },

  // Get employee by initials
  async getByInitials(initials) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('initials', initials)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error
    return data
  },

  // Create new employee
  async create(employeeData) {
    const { data, error } = await supabase
      .from('employees')
      .insert([employeeData])
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Bulk import employees - Using simple insert for now
  async bulkImport(employeeList) {
    const { data, error } = await supabase
      .from('employees')
      .insert(employeeList)
      .select()
    
    if (error) throw error
    return data
  }
}

// =============================================
// JOB SERVICES  
// =============================================
export const jobService = {
  // Get all jobs (uses your existing jobs table)
  async getAll() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },

  // Get job by ID
  async getById(id) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) throw error
    return data
  }
}

// =============================================
// SOURCE FILE SERVICES
// =============================================
export const sourceFileService = {
  // Create new file version
  async createVersion(jobId, fileName, fileSize, uploadedBy) {
    // Get next version number
    const { data: existingVersions } = await supabase
      .from('source_file_versions')
      .select('version_number')
      .eq('job_id', jobId)
      .order('version_number', { ascending: false })
      .limit(1)
    
    const nextVersion = existingVersions.length > 0 ? existingVersions[0].version_number + 1 : 1
    
    const { data, error } = await supabase
      .from('source_file_versions')
      .insert([{
        job_id: jobId,
        version_number: nextVersion,
        file_name: fileName,
        file_size: fileSize,
        uploaded_by: uploadedBy
      }])
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Update file version with processing results
  async updateVersion(versionId, updates) {
    const { data, error } = await supabase
      .from('source_file_versions')
      .update(updates)
      .eq('id', versionId)
      .select()
      .single()
    
    if (error) throw error
    return data
  },

  // Get file versions for a job
  async getVersionsByJob(jobId) {
    const { data, error } = await supabase
      .from('source_file_versions')
      .select('*')
      .eq('job_id', jobId)
      .order('version_number', { ascending: false })
    
    if (error) throw error
    return data
  }
}

// =============================================
// PROPERTY RECORDS SERVICES
// =============================================
export const propertyService = {
  // Import CSV data with versioning
  async importCSVData(jobId, sourceFileVersionId, csvData, createdBy) {
    // Transform CSV data to match database schema
    const propertyRecords = csvData.map(row => ({
      job_id: jobId,
      source_file_version_id: sourceFileVersionId,
      block: row.BLOCK,
      lot: row.LOT,
      qualifier: row.QUALIFIER || null,
      card: row.CARD,
      property_location: row.PROPERTY_LOCATION || null,
      property_class: row.PROPCLASS || row.PROPERTY_CLASS,
      measure_by: row.MEASUREBY,
      measure_dt: row.MEASUREDT ? new Date(row.MEASUREDT).toISOString().split('T')[0] : null,
      list_by: row.LISTBY,
      list_dt: row.LISTDT ? new Date(row.LISTDT).toISOString().split('T')[0] : null,
      price_by: row.PRICEBY,
      price_dt: row.PRICEDT ? new Date(row.PRICEDT).toISOString().split('T')[0] : null,
      info_by: row.INFOBY,
      field_calls: {
        call_1: { by: row.FIELDCALL_1, date: row.FIELDCALLDT_1 },
        call_2: { by: row.FIELDCALL_2, date: row.FIELDCALLDT_2 },
        call_3: { by: row.FIELDCALL_3, date: row.FIELDCALLDT_3 },
        call_4: { by: row.FIELDCALL_4, date: row.FIELDCALLDT_4 },
        call_5: { by: row.FIELDCALL_5, date: row.FIELDCALLDT_5 },
        call_6: { by: row.FIELDCALL_6, date: row.FIELDCALLDT_6 },
        call_7: { by: row.FIELDCALL_7, date: row.FIELDCALLDT_7 }
      },
      property_values: {
        land_taxable_value: row.VALUES_LANDTAXABLEVALUE,
        improvement_taxable_value: row.VALUES_IMPROVTAXABLEVALUE,
        total_taxable_value: row.VALUES_TOTALTAXABLEVALUE
      },
      raw_data: row,
      created_by: createdBy
    }))

    // Insert in batches (1000 records per batch)
    const batchSize = 1000
    const results = []
    
    for (let i = 0; i < propertyRecords.length; i += batchSize) {
      const batch = propertyRecords.slice(i, i + batchSize)
      const { data, error } = await supabase
        .from('property_records')
        .insert(batch)
        .select('id')
      
      if (error) throw error
      results.push(...data)
    }

    return { imported: results.length, total: propertyRecords.length }
  },

  // Get property records for a job
  async getByJob(jobId) {
    const { data, error } = await supabase
      .from('property_records')
      .select('*')
      .eq('job_id', jobId)
      .order('block', { ascending: true })
      .order('lot', { ascending: true })
    
    if (error) throw error
    return data
  },

  // Get inspector stats using the database function
  async getInspectorStats(jobId) {
    const { data, error } = await supabase
      .rpc('get_job_inspector_stats', { job_uuid: jobId })
    
    if (error) throw error
    return data
  }
}

// =============================================
// PRODUCTION DATA SERVICES (works with your existing table)
// =============================================
export const productionDataService = {
  // Update your existing production_data table
  async updateSummary(jobId, inspectorId, createdBy) {
    // Use the database function to update production summary
    const { error } = await supabase
      .rpc('update_job_production_summary', { job_uuid: jobId })
    
    if (error) throw error

    // Also update with inspector info if provided
    if (inspectorId) {
      const { data, error: updateError } = await supabase
        .from('production_data')
        .update({ 
          inspector_id: inspectorId,
          updated_at: new Date().toISOString()
        })
        .eq('job_id', jobId)
      
      if (updateError) throw updateError
    }
  },

  // Get production data for a job
  async getByJob(jobId) {
    const { data, error } = await supabase
      .from('production_data')
      .select('*')
      .eq('job_id', jobId)
      .order('record_date', { ascending: false })
    
    if (error) throw error
    return data
  }
}

// =============================================
// UTILITY SERVICES
// =============================================
export const utilityService = {
  // Test database connection
  async testConnection() {
    try {
      const { error } = await supabase
        .from('employees')
        .select('count', { count: 'exact', head: true })
      
      if (error) throw error
      return { success: true, message: 'Database connection successful' }
    } catch (error) {
      return { success: false, message: error.message }
    }
  },

  // Get database statistics
  async getStats() {
    const [employees, jobs, propertyRecords, sourceFiles] = await Promise.all([
      supabase.from('employees').select('count', { count: 'exact', head: true }),
      supabase.from('jobs').select('count', { count: 'exact', head: true }),
      supabase.from('property_records').select('count', { count: 'exact', head: true }),
      supabase.from('source_file_versions').select('count', { count: 'exact', head: true })
    ])

    return {
      employees: employees.count || 0,
      jobs: jobs.count || 0,
      propertyRecords: propertyRecords.count || 0,
      sourceFiles: sourceFiles.count || 0
    }
  }
}
