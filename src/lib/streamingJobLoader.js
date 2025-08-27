/**
 * STREAMING JOB LOADER
 * Fix the remaining "load all jobs" problem in AdminJobManagement
 */

import { supabase } from './supabaseClient.js';

export class StreamingJobLoader {
  /**
   * Load jobs with pagination instead of all at once
   */
  async loadJobsProgressive(options = {}) {
    const {
      pageSize = 50,
      status = 'active',
      onProgress = null
    } = options;
    
    console.log(`📋 Loading ${status} jobs progressively...`);
    
    try {
      // Get total count first
      const { count, error: countError } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);
      
      if (countError) throw countError;
      
      console.log(`📊 Total ${status} jobs: ${count}`);
      
      // Load first page immediately (fast UI feedback)
      const firstPage = await this.loadJobPage(0, Math.min(pageSize, 20), status);
      
      if (onProgress) {
        onProgress({
          jobs: firstPage.jobs,
          totalCount: count,
          loadedCount: firstPage.jobs.length,
          progress: Math.round((firstPage.jobs.length / count) * 100),
          isComplete: firstPage.jobs.length >= count
        });
      }
      
      // If we have more jobs, load them in background
      if (count > firstPage.jobs.length) {
        this.loadRemainingJobs(firstPage.jobs, count, pageSize, status, onProgress);
      }
      
      return {
        success: true,
        initialJobs: firstPage.jobs,
        totalCount: count
      };
      
    } catch (error) {
      console.error('❌ Error loading jobs:', error);
      return {
        success: false,
        error: error.message,
        initialJobs: [],
        totalCount: 0
      };
    }
  }
  
  /**
   * Load single page of jobs
   */
  async loadJobPage(offset, limit, status) {
    const { data, error } = await supabase
      .from('jobs')
      .select(`
        *,
        job_responsibilities(count),
        job_contracts(
          contract_amount,
          retainer_percentage,
          retainer_amount
        ),
        workflow_stats
      `)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    
    // Transform jobs for AdminJobManagement
    const transformedJobs = (data || []).map(job => ({
      ...job,
      name: job.job_name || job.name || '',
      municipality: job.municipality || '',
      county: job.county || '',
      status: job.status || 'active',
      percentBilled: job.percent_billed || 0,
      totalProperties: job.total_properties || 0,
      totalresidential: job.totalresidential || 0,
      totalcommercial: job.totalcommercial || 0,
      assignedPropertyCount: job.job_responsibilities?.[0]?.count || 0,
      workflowStats: job.workflow_stats || null
    }));
    
    return {
      jobs: transformedJobs,
      count: data?.length || 0
    };
  }
  
  /**
   * Load remaining jobs in background
   */
  async loadRemainingJobs(initialJobs, totalCount, pageSize, status, onProgress) {
    const allJobs = [...initialJobs];
    let offset = initialJobs.length;
    
    while (offset < totalCount) {
      try {
        const page = await this.loadJobPage(offset, pageSize, status);
        allJobs.push(...page.jobs);
        offset += page.count;
        
        if (onProgress) {
          onProgress({
            jobs: [...allJobs],
            totalCount,
            loadedCount: allJobs.length,
            progress: Math.round((allJobs.length / totalCount) * 100),
            isComplete: allJobs.length >= totalCount
          });
        }
        
        console.log(`📥 Loaded ${allJobs.length}/${totalCount} jobs`);
        
        // Small delay to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error loading job page at offset ${offset}:`, error);
        break;
      }
    }
    
    console.log(`✅ Background job loading complete: ${allJobs.length} jobs`);
  }
}

// Singleton instance
export const streamingJobLoader = new StreamingJobLoader();

/**
 * Hook for React components
 */
export function useStreamingJobs(status = 'active') {
  const [state, setState] = React.useState({
    jobs: [],
    totalCount: 0,
    isLoading: true,
    isComplete: false,
    error: null
  });
  
  React.useEffect(() => {
    streamingJobLoader.loadJobsProgressive({
      status,
      onProgress: (progress) => {
        setState({
          jobs: progress.jobs,
          totalCount: progress.totalCount,
          isLoading: false,
          isComplete: progress.isComplete,
          error: null
        });
      }
    }).catch(error => {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
    });
  }, [status]);
  
  return state;
}
