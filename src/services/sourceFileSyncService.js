/**
 * Automatic Source File Synchronization Service
 * Runs as a background service to automatically sync property records when source files change
 * Can be scheduled to run periodically or triggered by database changes
 */

import { supabase, propertyService } from '../lib/supabaseClient.js';

/**
 * Helper function to safely extract error message from any error type
 */
function getErrorMessage(error) {
  if (!error) return 'Unknown error';

  // If it's a string, return it directly
  if (typeof error === 'string') return error;

  // Try various error message properties
  if (error.message) return error.message;
  if (error.msg) return error.msg;
  if (error.error) return error.error;
  if (error.details) return error.details;

  // If it's an object with specific error info
  if (error.code && error.hint) {
    return `${error.code}: ${error.hint}`;
  }

  // Try to stringify if it's an object
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch (e) {
      return 'Error object could not be serialized';
    }
  }

  // Fallback to string conversion
  return String(error);
}

class SourceFileSyncService {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.runInterval = 30 * 60 * 1000; // 30 minutes - reduced from 5 to prevent I/O spikes
    this.maxRetries = 3;
    this.retryDelay = 30000; // 30 seconds
  }

  /**
   * Start the automatic sync service
   */
  async start() {
    if (this.isRunning) {
      console.log('🔄 Source file sync service is already running');
      return;
    }

    console.log('🚀 Starting automatic source file sync service...');
    this.isRunning = true;
    
    // Run immediately on start
    await this.runSyncCycle();
    
    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.runSyncCycle();
    }, this.runInterval);

    console.log(`✅ Source file sync service started (runs every ${this.runInterval / 60000} minutes)`);
  }

  /**
   * Stop the automatic sync service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('🛑 Source file sync service stopped');
  }

  /**
   * Run a complete sync cycle
   */
  async runSyncCycle() {
    if (!this.isRunning) return;

    const startTime = Date.now();
    console.log(`🔄 Starting sync cycle at ${new Date().toISOString()}`);

    try {
      // Find all jobs that need reprocessing
      const jobsNeedingSync = await this.findJobsNeedingSync();
      
      if (jobsNeedingSync.length === 0) {
        console.log('✅ No jobs need synchronization');
        this.lastRun = new Date().toISOString();
        return;
      }

      console.log(`📊 Found ${jobsNeedingSync.length} jobs needing synchronization`);
      
      const results = {
        processed: 0,
        errors: 0,
        skipped: 0
      };

      // Process each job
      for (const job of jobsNeedingSync) {
        try {
          await this.processJobSync(job);
          results.processed++;
          console.log(`✅ Synced job: ${job.job_name} (${job.vendor_source})`);
        } catch (error) {
          results.errors++;
          console.error(`❌ Failed to sync job ${job.job_name}:`, getErrorMessage(error));
          console.error('Error details:', error);

          // Log error to audit table
          await this.logSyncError(job.id, error);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`🎉 Sync cycle completed in ${duration}ms:`, results);
      
      // Log successful cycle
      await this.logSyncCycle(results, duration);
      this.lastRun = new Date().toISOString();

    } catch (error) {
      console.error('❌ Sync cycle failed:', getErrorMessage(error));
      console.error('Error details:', error);
      await this.logSyncError(null, error);
    }
  }

  /**
   * Find jobs that need synchronization
   */
  async findJobsNeedingSync() {
    try {
      // Get jobs where property records are marked as needing reprocessing
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select(`
          id,
          job_name,
          municipality,
          vendor_source,
          source_file_content,
          source_file_parsed_at,
          ccdd_code,
          year_created
        `)
        .not('source_file_content', 'is', null)
        .in('vendor_source', ['BRT', 'Microsystems']);

      if (error) throw error;

      const jobsNeedingSync = [];

      for (const job of jobs) {
        // Check if this job has records needing reprocessing
        const { count, error: countError } = await supabase
          .from('property_records')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', job.id)
          .eq('validation_status', 'needs_reprocessing');

        if (countError) {
          console.error(`Error checking records for job ${job.job_name}:`, getErrorMessage(countError));
          console.error('Details:', countError);
          continue;
        }

        if (count > 0) {
          jobsNeedingSync.push({
            ...job,
            recordsNeedingSync: count
          });
        }
      }

      return jobsNeedingSync;
    } catch (error) {
      console.error('Error finding jobs needing sync:', getErrorMessage(error));
      console.error('Error details:', error);
      throw error;
    }
  }

  /**
   * Process synchronization for a single job
   */
  async processJobSync(job, retryCount = 0) {
    try {
      console.log(`🔄 Processing sync for job: ${job.job_name} (${job.recordsNeedingSync} records)`);

      // Use the existing manual reprocessing function
      const result = await propertyService.manualReprocessFromSource(job.id);

      if (result.errors > 0) {
        console.warn(`⚠️ Job ${job.job_name} completed with ${result.errors} errors`);
      }

      // Mark sync as completed in audit log
      await this.logJobSync(job.id, result);

      return result;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.log(`🔄 Retrying job ${job.job_name} in ${this.retryDelay / 1000}s (attempt ${retryCount + 1}/${this.maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return await this.processJobSync(job, retryCount + 1);
      } else {
        console.error(`❌ Failed to sync job ${job.job_name} after ${this.maxRetries} retries:`, getErrorMessage(error));
        console.error('Final error details:', error);
        throw error;
      }
    }
  }

  /**
   * Log successful sync cycle to audit table
   */
  async logSyncCycle(results, duration) {
    try {
      await supabase
        .from('audit_log')
        .insert({
          table_name: 'source_file_sync_service',
          record_id: null,
          action: 'sync_cycle_completed',
          changes: {
            ...results,
            duration_ms: duration,
            timestamp: new Date().toISOString()
          }
        });
    } catch (error) {
      console.error('Failed to log sync cycle:', getErrorMessage(error));
      console.error('Log error details:', error);
    }
  }

  /**
   * Log successful job sync to audit table
   */
  async logJobSync(jobId, result) {
    try {
      await supabase
        .from('audit_log')
        .insert({
          table_name: 'jobs',
          record_id: jobId,
          action: 'automatic_sync_completed',
          changes: {
            processed: result.processed,
            errors: result.errors,
            sync_method: 'automatic_background_service',
            timestamp: new Date().toISOString()
          }
        });
    } catch (error) {
      console.error('Failed to log job sync:', getErrorMessage(error));
      console.error('Log error details:', error);
    }
  }

  /**
   * Log sync error to audit table
   */
  async logSyncError(jobId, error) {
    try {
      await supabase
        .from('audit_log')
        .insert({
          table_name: jobId ? 'jobs' : 'source_file_sync_service',
          record_id: jobId,
          action: 'sync_error',
          changes: {
            error: getErrorMessage(error),
            stack: error.stack || 'No stack trace available',
            timestamp: new Date().toISOString()
          }
        });
    } catch (logError) {
      console.error('Failed to log sync error:', getErrorMessage(logError));
      console.error('Log error details:', logError);
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      runInterval: this.runInterval,
      nextRun: this.isRunning && this.lastRun 
        ? new Date(new Date(this.lastRun).getTime() + this.runInterval).toISOString()
        : null
    };
  }

  /**
   * Force run sync cycle immediately (for manual triggers)
   */
  async forceSyncNow() {
    console.log('🚀 Force running sync cycle...');
    await this.runSyncCycle();
  }

  /**
   * Get recent sync history from audit logs
   */
  async getSyncHistory(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .in('action', ['sync_cycle_completed', 'automatic_sync_completed', 'sync_error'])
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching sync history:', getErrorMessage(error));
      console.error('Error details:', error);
      return [];
    }
  }
}

// Create singleton instance
export const sourceFileSyncService = new SourceFileSyncService();

// Auto-start in development environments
if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
  console.log('🔄 Auto-starting source file sync service in development mode');
  sourceFileSyncService.start();
}

export default sourceFileSyncService;
