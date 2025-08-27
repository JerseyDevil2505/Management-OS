/**
 * STREAMING DATA SERVICE
 * Client-side utilities for new database-side performance functions
 * Replaces client-side batch processing with server-side bulk operations
 */

import { supabase } from './supabaseClient.js';

/**
 * BULK PROPERTY OPERATIONS - Replace client-side batch processing
 */
export const bulkPropertyOperations = {
  /**
   * Process CSV file with preserved fields (replaces BRT/Microsystems updaters)
   */
  async processCSVUpdate(jobId, properties, preservedFields = null) {
    console.log(`🚀 Processing ${properties.length} properties server-side with preserved fields`);
    
    const startTime = Date.now();
    
    try {
      // Use database-side function instead of client-side batching
      const { data, error } = await supabase
        .rpc('bulk_property_upsert_with_preservation', {
          p_job_id: jobId,
          p_properties: properties,
          p_preserved_fields: preservedFields || [
            'project_start_date',
            'is_assigned_property', 
            'validation_status',
            'location_analysis',
            'new_vcs',
            'values_norm_time',
            'values_norm_size',
            'sales_history'
          ]
        });
      
      if (error) {
        console.error('❌ Server-side processing failed:', error);
        throw error;
      }
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Server-side processing complete in ${processingTime}ms:`, {
        inserted: data.inserted_count,
        preserved: data.preserved_count,
        total: data.total_processed,
        serverTime: `${data.execution_time_ms}ms`
      });
      
      return {
        success: true,
        stats: data,
        clientTime: processingTime
      };
      
    } catch (error) {
      console.error('❌ Error in bulk property processing:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Compare CSV with existing data (replaces FileUploadButton client-side comparison)
   */
  async compareWithExisting(jobId, newProperties) {
    console.log(`🔍 Comparing ${newProperties.length} properties server-side`);
    
    try {
      const { data, error } = await supabase
        .rpc('compare_properties_with_csv', {
          p_job_id: jobId,
          p_new_properties: newProperties
        });
      
      if (error) {
        console.error('❌ Server-side comparison failed:', error);
        throw error;
      }
      
      console.log(`✅ Comparison complete in ${data.execution_time_ms}ms:`, data.summary);
      
      return {
        success: true,
        comparison: data
      };
      
    } catch (error) {
      console.error('❌ Error in property comparison:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * INSPECTION DATA OPERATIONS - Replace ProductionTracker massive UPSERTs
 */
export const inspectionDataOperations = {
  /**
   * Bulk upsert inspection data (replaces ProductionTracker client-side UPSERT)
   */
  async bulkUpsertInspections(jobId, inspectionData) {
    console.log(`�� Processing ${inspectionData.length} inspection records server-side`);
    
    const startTime = Date.now();
    
    try {
      // Use database-side function
      const { data, error } = await supabase
        .rpc('bulk_inspection_data_upsert', {
          p_job_id: jobId,
          p_inspection_data: inspectionData
        });
      
      if (error) {
        console.error('❌ Server-side inspection processing failed:', error);
        throw error;
      }
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Inspection processing complete in ${processingTime}ms:`, {
        upserted: data.upserted_count,
        total: data.total_processed,
        serverTime: `${data.execution_time_ms}ms`
      });
      
      return {
        success: true,
        stats: data,
        clientTime: processingTime
      };
      
    } catch (error) {
      console.error('❌ Error in bulk inspection processing:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

/**
 * STREAMING DATA LOADER - Replace bulk loading with progressive loading
 */
export const streamingDataLoader = {
  /**
   * Stream properties with pagination (replaces JobContainer bulk loading)
   */
  async* streamProperties(jobId, options = {}) {
    const {
      assignedOnly = false,
      orderBy = 'property_composite_key',
      pageSize = 1000,
      maxRecords = null
    } = options;
    
    let offset = 0;
    let totalLoaded = 0;
    let hasMore = true;
    let totalCount = null;
    
    console.log(`📡 Starting property stream for job ${jobId}`);
    
    while (hasMore) {
      try {
        const { data, error } = await supabase
          .rpc('get_properties_page', {
            p_job_id: jobId,
            p_offset: offset,
            p_limit: pageSize,
            p_assigned_only: assignedOnly,
            p_order_by: orderBy
          });
        
        if (error) {
          throw error;
        }
        
        const { properties, total_count, has_more } = data;
        
        if (totalCount === null) {
          totalCount = total_count;
        }
        
        totalLoaded += properties.length;
        hasMore = has_more && (!maxRecords || totalLoaded < maxRecords);
        offset += pageSize;
        
        // Yield current page
        yield {
          properties,
          totalCount,
          loadedCount: totalLoaded,
          progress: totalCount > 0 ? Math.round((totalLoaded / totalCount) * 100) : 100,
          hasMore,
          pageNumber: Math.floor(offset / pageSize)
        };
        
        // Small delay to keep UI responsive
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
      } catch (error) {
        console.error(`❌ Error streaming properties at offset ${offset}:`, error);
        throw error;
      }
    }
    
    console.log(`✅ Property stream complete: ${totalLoaded} records`);
  },

  /**
   * Load properties progressively for components
   */
  async loadPropertiesProgressive(jobId, options = {}, onProgress = null) {
    const properties = [];
    let totalCount = 0;
    
    try {
      for await (const page of this.streamProperties(jobId, options)) {
        properties.push(...page.properties);
        totalCount = page.totalCount;
        
        // Call progress callback
        if (onProgress) {
          onProgress({
            properties: [...properties],
            totalCount,
            loadedCount: properties.length,
            progress: page.progress,
            hasMore: page.hasMore
          });
        }
      }
      
      return {
        success: true,
        properties,
        totalCount
      };
      
    } catch (error) {
      console.error('❌ Error in progressive loading:', error);
      return {
        success: false,
        error: error.message,
        properties,
        totalCount
      };
    }
  }
};

/**
 * BACKGROUND JOB SYSTEM - For heavy operations
 */
export const backgroundJobs = {
  /**
   * Queue a file processing job
   */
  async queueFileProcessing(jobId, fileType, fileData) {
    console.log(`📋 Queuing file processing job: ${fileType}`);
    
    try {
      const { data, error } = await supabase
        .rpc('queue_file_processing_job', {
          p_job_id: jobId,
          p_file_type: fileType,
          p_file_data: fileData
        });
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ File processing job queued: ${data}`);
      return { success: true, jobId: data };
      
    } catch (error) {
      console.error('❌ Error queuing file processing:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Poll job status with automatic retry
   */
  async pollJobStatus(jobId, options = {}) {
    const {
      maxAttempts = 60,
      intervalMs = 1000,
      onProgress = null
    } = options;
    
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        const { data, error } = await supabase
          .rpc('get_job_status', { p_job_id: jobId });
        
        if (error) {
          throw error;
        }
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        // Call progress callback
        if (onProgress) {
          onProgress(data);
        }
        
        // Check if complete
        if (data.status === 'completed') {
          console.log(`✅ Background job completed: ${jobId}`);
          return { success: true, result: data.result };
        }
        
        if (data.status === 'failed') {
          throw new Error(data.error_message || 'Job failed');
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
        
      } catch (error) {
        console.error(`❌ Error polling job status (attempt ${attempts + 1}):`, error);
        
        if (attempts >= maxAttempts - 1) {
          return { success: false, error: error.message };
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        attempts++;
      }
    }
    
    return { success: false, error: 'Job polling timeout' };
  }
};

/**
 * SMART CACHING - With dependency tracking and invalidation
 */
export class SmartCache {
  constructor() {
    this.cache = new Map();
    this.dependencies = new Map();
    this.listeners = new Map();
  }
  
  /**
   * Set cached data with dependencies
   */
  set(key, data, dependencies = []) {
    const cacheEntry = {
      data,
      timestamp: Date.now(),
      dependencies: new Set(dependencies)
    };
    
    this.cache.set(key, cacheEntry);
    
    // Register dependencies
    dependencies.forEach(dep => {
      if (!this.dependencies.has(dep)) {
        this.dependencies.set(dep, new Set());
      }
      this.dependencies.get(dep).add(key);
    });
    
    console.log(`💾 Cached: ${key} (deps: ${dependencies.join(', ')})`);
  }
  
  /**
   * Get cached data with staleness check
   */
  get(key, maxAgeMs = 5 * 60 * 1000) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    const age = Date.now() - entry.timestamp;
    if (age > maxAgeMs) {
      console.log(`🗑️ Cache expired: ${key} (age: ${Math.round(age / 1000)}s)`);
      this.cache.delete(key);
      return null;
    }
    
    console.log(`📦 Cache hit: ${key} (age: ${Math.round(age / 1000)}s)`);
    return entry.data;
  }
  
  /**
   * Invalidate cache by dependency
   */
  invalidate(dependency) {
    const keysToInvalidate = this.dependencies.get(dependency);
    
    if (keysToInvalidate) {
      keysToInvalidate.forEach(key => {
        console.log(`🗑️ Invalidating: ${key} (dependency: ${dependency})`);
        this.cache.delete(key);
      });
      
      // Notify listeners
      keysToInvalidate.forEach(key => {
        const listeners = this.listeners.get(key);
        if (listeners) {
          listeners.forEach(callback => callback(key, dependency));
        }
      });
    }
  }
  
  /**
   * Add invalidation listener
   */
  onInvalidate(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
  }
  
  /**
   * Clear all cache
   */
  clear() {
    console.log('🗑️ Clearing all cache');
    this.cache.clear();
    this.dependencies.clear();
  }
}

// Global cache instance
export const globalCache = new SmartCache();

/**
 * PERFORMANCE MONITORING - Track query performance
 */
export const performanceMonitor = {
  queries: [],
  
  /**
   * Log query performance
   */
  logQuery(queryName, duration, recordCount = null) {
    const entry = {
      queryName,
      duration,
      recordCount,
      timestamp: Date.now()
    };
    
    this.queries.push(entry);
    
    // Keep only last 100 queries
    if (this.queries.length > 100) {
      this.queries.shift();
    }
    
    console.log(`⏱️ Query: ${queryName} - ${duration}ms${recordCount ? ` (${recordCount} records)` : ''}`);
  },
  
  /**
   * Get performance summary
   */
  getSummary() {
    if (this.queries.length === 0) {
      return { message: 'No queries recorded' };
    }
    
    const totalQueries = this.queries.length;
    const avgDuration = this.queries.reduce((sum, q) => sum + q.duration, 0) / totalQueries;
    const slowestQuery = this.queries.reduce((max, q) => q.duration > max.duration ? q : max);
    
    return {
      totalQueries,
      avgDuration: Math.round(avgDuration),
      slowestQuery: {
        name: slowestQuery.queryName,
        duration: slowestQuery.duration,
        recordCount: slowestQuery.recordCount
      },
      recentQueries: this.queries.slice(-10)
    };
  }
};
