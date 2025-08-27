/**
 * BATCH PROCESSING UTILITIES
 * 
 * ENTERPRISE-GRADE BATCH PROCESSING:
 * - Handles failures gracefully with exponential backoff
 * - Progress tracking and cancellation support
 * - Memory-efficient chunking for large datasets
 * - Comprehensive error reporting and recovery
 * - Circuit breaker pattern for repeated failures
 * 
 * USE CASES:
 * - Large file imports (16K+ records)
 * - Bulk database operations
 * - API rate-limited operations
 * - Background data processing
 */

import { performanceMonitor } from './streamingDataService.js';

/**
 * BATCH PROCESSOR CLASS - Main batch processing engine
 */
export class BatchProcessor {
  constructor(options = {}) {
    this.options = {
      batchSize: options.batchSize || 500,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      maxConcurrency: options.maxConcurrency || 1,
      progressCallback: options.progressCallback || null,
      errorCallback: options.errorCallback || null,
      ...options
    };
    
    this.stats = {
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
      successfulBatches: 0,
      failedBatches: 0,
      startTime: null,
      endTime: null,
      errors: []
    };
    
    this.isCancelled = false;
    this.circuitBreaker = new CircuitBreaker();
  }

  /**
   * Process array of items in batches with error handling
   */
  async processItems(items, processorFunction, options = {}) {
    console.log(`🚀 Starting batch processing: ${items.length} items`);
    
    this.stats.totalItems = items.length;
    this.stats.startTime = Date.now();
    this.isCancelled = false;
    
    const mergedOptions = { ...this.options, ...options };
    const batches = this.createBatches(items, mergedOptions.batchSize);
    
    try {
      if (mergedOptions.maxConcurrency === 1) {
        // Sequential processing
        await this.processSequentially(batches, processorFunction, mergedOptions);
      } else {
        // Concurrent processing
        await this.processConcurrently(batches, processorFunction, mergedOptions);
      }
      
      this.stats.endTime = Date.now();
      const duration = this.stats.endTime - this.stats.startTime;
      
      console.log(`✅ Batch processing complete in ${duration}ms:`, this.getStats());
      
      return {
        success: true,
        stats: this.getStats(),
        duration
      };
      
    } catch (error) {
      this.stats.endTime = Date.now();
      const duration = this.stats.endTime - this.stats.startTime;
      
      console.error(`❌ Batch processing failed after ${duration}ms:`, error);
      
      return {
        success: false,
        error: error.message,
        stats: this.getStats(),
        duration
      };
    }
  }

  /**
   * Process batches sequentially
   */
  async processSequentially(batches, processorFunction, options) {
    for (let i = 0; i < batches.length; i++) {
      if (this.isCancelled) {
        throw new Error('Processing cancelled by user');
      }
      
      await this.processBatchWithRetry(batches[i], i, processorFunction, options);
      
      // Progress callback
      if (options.progressCallback) {
        options.progressCallback({
          batchIndex: i + 1,
          totalBatches: batches.length,
          processedItems: this.stats.processedItems,
          totalItems: this.stats.totalItems,
          progress: Math.round((this.stats.processedItems / this.stats.totalItems) * 100)
        });
      }
      
      // Delay between batches to prevent overwhelming
      if (i < batches.length - 1 && options.batchDelay) {
        await new Promise(resolve => setTimeout(resolve, options.batchDelay));
      }
    }
  }

  /**
   * Process batches concurrently with concurrency limit
   */
  async processConcurrently(batches, processorFunction, options) {
    const concurrencyLimit = options.maxConcurrency;
    const activeBatches = [];
    let batchIndex = 0;
    
    while (batchIndex < batches.length || activeBatches.length > 0) {
      // Start new batches up to concurrency limit
      while (activeBatches.length < concurrencyLimit && batchIndex < batches.length) {
        if (this.isCancelled) {
          throw new Error('Processing cancelled by user');
        }
        
        const batch = batches[batchIndex];
        const currentIndex = batchIndex;
        
        const batchPromise = this.processBatchWithRetry(batch, currentIndex, processorFunction, options)
          .then(() => currentIndex)
          .catch(error => ({ error, index: currentIndex }));
        
        activeBatches.push(batchPromise);
        batchIndex++;
      }
      
      // Wait for at least one batch to complete
      const result = await Promise.race(activeBatches);
      
      // Remove completed batch from active list
      const completedIndex = activeBatches.findIndex(p => p === result);
      if (completedIndex !== -1) {
        activeBatches.splice(completedIndex, 1);
      }
      
      // Handle errors
      if (result && result.error) {
        console.error(`❌ Batch ${result.index} failed:`, result.error);
        this.stats.errors.push({
          batchIndex: result.index,
          error: result.error.message,
          timestamp: Date.now()
        });
      }
      
      // Progress callback
      if (options.progressCallback) {
        options.progressCallback({
          batchIndex: batchIndex,
          totalBatches: batches.length,
          processedItems: this.stats.processedItems,
          totalItems: this.stats.totalItems,
          progress: Math.round((this.stats.processedItems / this.stats.totalItems) * 100)
        });
      }
    }
  }

  /**
   * Process single batch with retry logic
   */
  async processBatchWithRetry(batch, batchIndex, processorFunction, options) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      try {
        // Check circuit breaker
        if (this.circuitBreaker.isOpen()) {
          throw new Error('Circuit breaker is open - too many failures');
        }
        
        console.log(`🔄 Processing batch ${batchIndex + 1}, attempt ${attempt} (${batch.length} items)`);
        
        const result = await processorFunction(batch, batchIndex);
        
        // Update stats
        this.stats.processedItems += batch.length;
        this.stats.successfulBatches++;
        this.circuitBreaker.recordSuccess();
        
        console.log(`✅ Batch ${batchIndex + 1} successful`);
        return result;
        
      } catch (error) {
        lastError = error;
        this.circuitBreaker.recordFailure();
        
        console.error(`❌ Batch ${batchIndex + 1} failed (attempt ${attempt}):`, error.message);
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          console.log(`💀 Non-retryable error for batch ${batchIndex + 1}`);
          break;
        }
        
        // Don't retry on last attempt
        if (attempt < options.maxRetries) {
          const delay = this.calculateRetryDelay(attempt, options.retryDelay);
          console.log(`⏳ Retrying batch ${batchIndex + 1} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    this.stats.failedItems += batch.length;
    this.stats.failedBatches++;
    
    const error = new Error(`Batch ${batchIndex + 1} failed after ${options.maxRetries} attempts: ${lastError?.message}`);
    
    if (options.errorCallback) {
      options.errorCallback(error, batch, batchIndex);
    }
    
    throw error;
  }

  /**
   * Create batches from array of items
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    console.log(`📦 Created ${batches.length} batches of size ${batchSize}`);
    return batches;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(attempt, baseDelay) {
    return Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Max 30 seconds
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableCodes = [
      '57014', // Query canceled
      '08003', // Connection error
      '08006', // Connection failure
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND'
    ];
    
    return retryableCodes.some(code => 
      error.code === code || 
      error.message.includes(code) ||
      error.message.includes('timeout') ||
      error.message.includes('connection')
    );
  }

  /**
   * Get processing statistics
   */
  getStats() {
    const duration = this.stats.endTime ? this.stats.endTime - this.stats.startTime : Date.now() - this.stats.startTime;
    
    return {
      ...this.stats,
      duration,
      successRate: this.stats.totalItems > 0 ? Math.round((this.stats.processedItems / this.stats.totalItems) * 100) : 0,
      itemsPerSecond: duration > 0 ? Math.round((this.stats.processedItems / duration) * 1000) : 0
    };
  }

  /**
   * Cancel processing
   */
  cancel() {
    console.log('🛑 Cancelling batch processing...');
    this.isCancelled = true;
  }
}

/**
 * CIRCUIT BREAKER - Prevents cascading failures
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 60000; // 1 minute
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(`⚡ Circuit breaker opened after ${this.failureCount} failures`);
    }
  }

  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        console.log('⚡ Circuit breaker half-open - attempting recovery');
        return false;
      }
      return true;
    }
    return false;
  }
}

/**
 * FILE IMPORT PROCESSOR - Specialized for large file imports
 */
export class FileImportProcessor extends BatchProcessor {
  constructor(options = {}) {
    super({
      batchSize: 500,
      maxRetries: 5,
      retryDelay: 2000,
      maxConcurrency: 1,
      ...options
    });
  }

  /**
   * Process CSV file import with validation
   */
  async processCSVImport(csvRecords, jobId, processorFunction, options = {}) {
    console.log(`📄 Starting CSV import: ${csvRecords.length} records`);
    
    const validationResults = {
      valid: [],
      invalid: [],
      warnings: []
    };
    
    // Validate records first
    for (let i = 0; i < csvRecords.length; i++) {
      const record = csvRecords[i];
      const validation = this.validateCSVRecord(record, i);
      
      if (validation.isValid) {
        validationResults.valid.push(record);
      } else {
        validationResults.invalid.push({
          record,
          row: i + 1,
          errors: validation.errors
        });
      }
      
      if (validation.warnings.length > 0) {
        validationResults.warnings.push({
          record,
          row: i + 1,
          warnings: validation.warnings
        });
      }
    }
    
    console.log(`✅ Validation complete: ${validationResults.valid.length} valid, ${validationResults.invalid.length} invalid`);
    
    if (validationResults.invalid.length > 0 && !options.skipInvalid) {
      throw new Error(`${validationResults.invalid.length} invalid records found. Fix errors or set skipInvalid: true`);
    }
    
    // Process valid records
    const result = await this.processItems(
      validationResults.valid,
      processorFunction,
      options
    );
    
    return {
      ...result,
      validation: validationResults
    };
  }

  /**
   * Validate CSV record
   */
  validateCSVRecord(record, rowIndex) {
    const errors = [];
    const warnings = [];
    
    // Required fields validation
    const requiredFields = ['BLOCK', 'LOT', 'LOCATION'];
    for (const field of requiredFields) {
      if (!record[field] || record[field].trim() === '') {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Data type validation
    if (record.SFLA && isNaN(parseFloat(record.SFLA))) {
      warnings.push('SFLA is not a valid number');
    }
    
    if (record.YEARBUILT && (isNaN(parseInt(record.YEARBUILT)) || parseInt(record.YEARBUILT) < 1800)) {
      warnings.push('Year built is not valid');
    }
    
    // Business rule validation
    if (record.SALEPRICE && parseFloat(record.SALEPRICE) > 50000000) {
      warnings.push('Sale price seems unusually high');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}

/**
 * API BATCH PROCESSOR - For rate-limited API operations
 */
export class APIBatchProcessor extends BatchProcessor {
  constructor(options = {}) {
    super({
      batchSize: 100,
      maxRetries: 3,
      retryDelay: 1000,
      maxConcurrency: 2,
      rateLimitDelay: 100,
      ...options
    });
  }

  /**
   * Process API requests with rate limiting
   */
  async processAPIRequests(requests, apiFunction, options = {}) {
    const mergedOptions = {
      ...this.options,
      ...options,
      batchDelay: options.rateLimitDelay || this.options.rateLimitDelay
    };
    
    return this.processItems(requests, apiFunction, mergedOptions);
  }
}

/**
 * CONVENIENCE FUNCTIONS - Easy-to-use batch processing
 */

/**
 * Simple batch processing function
 */
export async function processBatch(items, processorFunction, options = {}) {
  const processor = new BatchProcessor(options);
  return processor.processItems(items, processorFunction, options);
}

/**
 * Process CSV file import
 */
export async function processCSVFile(csvRecords, jobId, processorFunction, options = {}) {
  const processor = new FileImportProcessor(options);
  return processor.processCSVImport(csvRecords, jobId, processorFunction, options);
}

/**
 * Process API requests with rate limiting
 */
export async function processAPIBatch(requests, apiFunction, options = {}) {
  const processor = new APIBatchProcessor(options);
  return processor.processAPIRequests(requests, apiFunction, options);
}

/**
 * PROGRESS TRACKER - UI component helper
 */
export class ProgressTracker {
  constructor(onUpdate = null) {
    this.onUpdate = onUpdate;
    this.data = {
      stage: 'idle',
      progress: 0,
      message: '',
      itemsProcessed: 0,
      totalItems: 0,
      batchIndex: 0,
      totalBatches: 0,
      errors: [],
      startTime: null,
      estimatedCompletion: null
    };
  }

  update(updates) {
    Object.assign(this.data, updates);
    
    // Calculate estimated completion
    if (this.data.progress > 0 && this.data.startTime) {
      const elapsed = Date.now() - this.data.startTime;
      const rate = this.data.progress / elapsed;
      const remaining = (100 - this.data.progress) / rate;
      this.data.estimatedCompletion = Date.now() + remaining;
    }
    
    if (this.onUpdate) {
      this.onUpdate(this.data);
    }
  }

  start(totalItems) {
    this.update({
      stage: 'processing',
      progress: 0,
      totalItems,
      startTime: Date.now(),
      message: 'Starting...'
    });
  }

  updateProgress(processed, total, message = '') {
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
    this.update({
      progress,
      itemsProcessed: processed,
      totalItems: total,
      message
    });
  }

  addError(error) {
    this.data.errors.push({
      error: error.message,
      timestamp: Date.now()
    });
    this.update({});
  }

  complete(success = true) {
    this.update({
      stage: success ? 'completed' : 'failed',
      progress: 100,
      message: success ? 'Processing complete' : 'Processing failed'
    });
  }

  getData() {
    return { ...this.data };
  }
}

/**
 * PERFORMANCE UTILITIES
 */
export const batchPerformanceUtils = {
  /**
   * Measure batch processing performance
   */
  async measureBatchPerformance(items, processorFunction, options = {}) {
    const startTime = Date.now();
    const processor = new BatchProcessor(options);
    
    const result = await processor.processItems(items, processorFunction, options);
    const endTime = Date.now();
    
    const performance = {
      totalTime: endTime - startTime,
      itemsPerSecond: result.stats.itemsPerSecond,
      throughput: items.length / ((endTime - startTime) / 1000),
      efficiency: result.stats.successRate,
      memoryUsage: process.memoryUsage ? process.memoryUsage() : null
    };
    
    performanceMonitor.logQuery(
      'BATCH_PROCESSING',
      performance.totalTime,
      items.length
    );
    
    console.log('📊 Batch performance:', performance);
    
    return {
      ...result,
      performance
    };
  },

  /**
   * Optimize batch size based on performance testing
   */
  async optimizeBatchSize(items, processorFunction, options = {}) {
    const testSizes = [100, 250, 500, 1000, 2000];
    const sampleSize = Math.min(1000, items.length);
    const testItems = items.slice(0, sampleSize);
    
    console.log('🔍 Testing optimal batch size...');
    
    const results = [];
    
    for (const batchSize of testSizes) {
      try {
        const testOptions = { ...options, batchSize };
        const result = await this.measureBatchPerformance(testItems, processorFunction, testOptions);
        
        results.push({
          batchSize,
          throughput: result.performance.throughput,
          successRate: result.stats.successRate,
          totalTime: result.performance.totalTime
        });
        
        console.log(`✅ Batch size ${batchSize}: ${result.performance.throughput.toFixed(1)} items/sec`);
        
      } catch (error) {
        console.log(`❌ Batch size ${batchSize} failed: ${error.message}`);
        results.push({
          batchSize,
          throughput: 0,
          successRate: 0,
          error: error.message
        });
      }
    }
    
    // Find optimal batch size
    const optimal = results
      .filter(r => r.successRate > 90)
      .sort((a, b) => b.throughput - a.throughput)[0];
    
    console.log('🎯 Optimal batch size:', optimal);
    
    return {
      optimal: optimal ? optimal.batchSize : 500,
      results
    };
  }
};

export default BatchProcessor;
