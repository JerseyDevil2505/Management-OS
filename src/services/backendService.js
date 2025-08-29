/**
 * Backend Service Stub
 * This file provides stub implementations to maintain compatibility
 * after backend service removal.
 */

// Stub error class for compatibility
export class BackendError extends Error {
  constructor(message, status = 500, operation = 'unknown', details = {}) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.operation = operation;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// Stub function for job initialization - always fails gracefully
export async function initializeJob(jobId, options = {}) {
  console.log('Backend service has been removed. Job initialization will use direct Supabase calls.');
  
  throw new BackendError(
    'Backend service unavailable - using direct database calls',
    503,
    'job_initialization',
    { fallback: 'direct_supabase' }
  );
}

// Stub function for file uploads - always fails gracefully
export async function uploadFile(file, jobId, fileType, options = {}) {
  console.log('Backend service has been removed. File upload will use direct Supabase calls.');
  
  throw new BackendError(
    'Backend service unavailable - use direct file handling',
    503,
    'file_upload',
    { fallback: 'direct_supabase' }
  );
}

// Stub function for file processing - always fails gracefully
export async function processFile(jobId, options = {}) {
  console.log('Backend service has been removed. File processing will use direct methods.');
  
  throw new BackendError(
    'Backend service unavailable - use direct processing',
    503,
    'file_processing',
    { fallback: 'direct_processing' }
  );
}

// Format error function for compatibility
export function formatBackendError(error) {
  if (error instanceof BackendError) {
    return {
      title: 'Backend Unavailable',
      message: 'Backend service has been removed. Using direct database calls.',
      operation: error.operation,
      status: error.status,
      timestamp: error.timestamp,
      isRetryable: false,
      suggestion: 'Application will automatically use direct database calls.'
    };
  }

  return {
    title: 'Error',
    message: error.message || 'An error occurred',
    isRetryable: false,
    suggestion: 'Please try again.'
  };
}

// Health check stub - always returns unavailable
export async function checkHealth() {
  return {
    status: 'unavailable',
    message: 'Backend service has been removed',
    timestamp: new Date().toISOString()
  };
}
