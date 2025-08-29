/**
 * Backend API Service Client
 * Handles communication with the Management OS Backend API
 * Replaces direct Supabase calls for heavy operations
 */

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

// Debug logging for backend configuration
console.log('🔍 BACKEND DEBUG - Service configuration:', {
  REACT_APP_BACKEND_URL: process.env.REACT_APP_BACKEND_URL,
  BACKEND_URL: BACKEND_URL,
  env_keys: Object.keys(process.env).filter(k => k.includes('BACKEND')),
  timestamp: new Date().toISOString()
});

// ===== ERROR HANDLING =====

class BackendError extends Error {
  constructor(message, status, operation, details = {}) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.operation = operation;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Makes HTTP requests to backend with proper error handling
 */
async function makeRequest(endpoint, options = {}) {
  const url = `${BACKEND_URL}${endpoint}`;

  console.log('🔍 BACKEND DEBUG - Making request:', {
    url,
    method: options.method || 'GET',
    BACKEND_URL,
    endpoint,
    timestamp: new Date().toISOString()
  });

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      // Pass through Supabase auth token if available
      ...getAuthHeaders()
    },
    timeout: options.timeout || 30000
  };

  const requestOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  console.log('🔍 BACKEND DEBUG - Request options:', {
    method: requestOptions.method || 'GET',
    headers: Object.keys(requestOptions.headers),
    timeout: requestOptions.timeout,
    hasBody: !!requestOptions.body
  });

  try {
    console.log('🔍 BACKEND DEBUG - Starting fetch request...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('🔍 BACKEND DEBUG - Request timeout after', requestOptions.timeout, 'ms');
      controller.abort();
    }, requestOptions.timeout);

    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('🔍 BACKEND DEBUG - Fetch response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorData = await response.json().catch((e) => {
        console.error('🔍 BACKEND DEBUG - Failed to parse error response as JSON:', e);
        return {};
      });

      console.error('🔍 BACKEND DEBUG - Backend returned error:', errorData);

      throw new BackendError(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        endpoint,
        errorData
      );
    }

    console.log('🔍 BACKEND DEBUG - Request successful');
    return response;

  } catch (error) {
    console.error('🔍 BACKEND DEBUG - Request failed:', {
      errorName: error.name,
      errorMessage: error.message,
      errorType: typeof error,
      isAbortError: error.name === 'AbortError',
      isBackendError: error instanceof BackendError,
      stack: error.stack
    });

    if (error.name === 'AbortError') {
      throw new BackendError(
        'Request timeout - operation took too long',
        408,
        endpoint,
        { timeout: requestOptions.timeout }
      );
    }

    if (error instanceof BackendError) {
      throw error;
    }

    // Network errors, CORS errors, connection refused, etc.
    const networkError = new BackendError(
      error.message || 'Network error occurred',
      0,
      endpoint,
      {
        originalError: error.message,
        errorType: error.name,
        url: url
      }
    );

    console.error('🔍 BACKEND DEBUG - Throwing BackendError:', networkError);
    throw networkError;
  }
}

/**
 * Get auth headers from current Supabase session
 */
function getAuthHeaders() {
  // Try to get the current user token from Supabase
  const supabaseAuth = localStorage.getItem('supabase.auth.token');
  if (supabaseAuth) {
    try {
      const authData = JSON.parse(supabaseAuth);
      if (authData.access_token) {
        return {
          'Authorization': `Bearer ${authData.access_token}`,
          'x-supabase-auth': authData.access_token
        };
      }
    } catch (e) {
      console.warn('Failed to parse Supabase auth token');
    }
  }

  return {};
}

// ===== JOB OPERATIONS =====

/**
 * Initialize a job with streaming progress updates
 * Replaces the problematic direct job loading
 */
export async function initializeJob(jobId, options = {}) {
  const { onProgress, skipCache = false, userId } = options;

  console.log('🔍 BACKEND DEBUG - Job initialization starting:', {
    jobId,
    userId,
    skipCache,
    BACKEND_URL,
    timestamp: new Date().toISOString()
  });

  // First check if backend is reachable
  console.log('🔍 BACKEND DEBUG - Checking backend health...');
  try {
    const healthResponse = await fetch(`${BACKEND_URL}/api/health`, {
      method: 'GET',
      timeout: 5000
    });
    console.log('🔍 BACKEND DEBUG - Health check response:', {
      status: healthResponse.status,
      ok: healthResponse.ok
    });
  } catch (healthError) {
    console.error('🔍 BACKEND DEBUG - Health check failed:', {
      error: healthError.message,
      name: healthError.name,
      url: `${BACKEND_URL}/api/health`
    });
    throw new BackendError(
      `Backend service unreachable at ${BACKEND_URL}. Health check failed: ${healthError.message}`,
      503,
      'health_check',
      {
        healthError: healthError.message,
        backendUrl: BACKEND_URL,
        suggestion: 'Check if backend service is running'
      }
    );
  }

  try {
    const response = await makeRequest(`/api/jobs/initialize/${jobId}`, {
      method: 'POST',
      body: JSON.stringify({ skipCache, userId }),
      timeout: 60000 // 1 minute timeout
    });

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const results = {};

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          
          // Store data by type
          results[data.type] = data.data || data;
          
          // Call progress callback if provided
          if (onProgress) {
            onProgress(data);
          }

          // Handle completion
          if (data.type === 'initialization_complete') {
            return {
              success: true,
              results,
              jobId,
              timestamp: data.timestamp
            };
          }

          // Handle errors
          if (data.type === 'error') {
            throw new BackendError(
              data.error,
              500,
              'job_initialization',
              { jobId, results }
            );
          }

        } catch (parseError) {
          console.warn('Failed to parse streaming response line:', line);
        }
      }
    }

    return {
      success: true,
      results,
      jobId
    };

  } catch (error) {
    console.error('Job initialization failed:', error);
    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'job_initialization',
      { jobId }
    );
  }
}

/**
 * Get job properties with pagination
 * Replaces heavy property loading
 */
export async function getJobProperties(jobId, options = {}) {
  const {
    page = 1,
    limit = 1000,
    building_class,
    assigned_only,
    has_sales,
    search
  } = options;

  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString()
  });

  if (building_class) params.append('building_class', building_class);
  if (assigned_only) params.append('assigned_only', 'true');
  if (has_sales) params.append('has_sales', 'true');
  if (search) params.append('search', search);

  try {
    const response = await makeRequest(`/api/jobs/${jobId}/properties?${params}`, {
      timeout: 45000 // 45 second timeout
    });

    return await response.json();

  } catch (error) {
    console.error('Failed to load properties:', error);
    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'get_properties',
      { jobId, page, limit }
    );
  }
}

/**
 * Get job analytics without heavy queries
 */
export async function getJobAnalytics(jobId) {
  try {
    const response = await makeRequest(`/api/jobs/${jobId}/analytics`, {
      timeout: 30000
    });

    return await response.json();

  } catch (error) {
    console.error('Failed to get job analytics:', error);
    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'job_analytics',
      { jobId }
    );
  }
}

/**
 * Emergency recovery for stuck jobs
 */
export async function recoverJob(jobId, operation = 'full', userId) {
  try {
    const response = await makeRequest(`/api/jobs/${jobId}/recover`, {
      method: 'POST',
      body: JSON.stringify({ operation, userId }),
      timeout: 30000
    });

    return await response.json();

  } catch (error) {
    console.error('Job recovery failed:', error);
    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'job_recovery',
      { jobId, operation }
    );
  }
}

// ===== FILE OPERATIONS =====

/**
 * Upload and process files with progress tracking
 */
export async function uploadFile(file, jobId, fileType, options = {}) {
  const { onProgress, vendorType } = options;

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('jobId', jobId);
    formData.append('fileType', fileType);
    if (vendorType) formData.append('vendorType', vendorType);

    const response = await makeRequest('/api/files/upload', {
      method: 'POST',
      body: formData,
      headers: {
        // Remove Content-Type to let browser set boundary for FormData
        ...getAuthHeaders()
      },
      timeout: 120000 // 2 minute timeout for large files
    });

    const result = await response.json();

    // Call progress callback with completion
    if (onProgress) {
      onProgress({
        type: 'upload_complete',
        fileInfo: result.fileInfo,
        success: true
      });
    }

    return result;

  } catch (error) {
    console.error('File upload failed:', error);
    
    // Call progress callback with error
    if (onProgress) {
      onProgress({
        type: 'upload_error',
        error: error.message,
        success: false
      });
    }

    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'file_upload',
      { jobId, fileType, fileName: file.name }
    );
  }
}

/**
 * Process uploaded files with streaming progress
 */
export async function processFile(jobId, options = {}) {
  const { 
    fileType = 'source', 
    forceReprocess = false, 
    batchSize = 1000,
    onProgress 
  } = options;

  try {
    const response = await makeRequest(`/api/files/process/${jobId}`, {
      method: 'POST',
      body: JSON.stringify({ fileType, forceReprocess, batchSize }),
      timeout: 300000 // 5 minute timeout for large files
    });

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const results = {};

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          
          // Store results
          results[data.type] = data;
          
          // Call progress callback
          if (onProgress) {
            onProgress(data);
          }

          // Handle completion
          if (data.type === 'processing_complete') {
            return {
              success: true,
              results,
              jobId,
              fileType
            };
          }

          // Handle errors
          if (data.type === 'error') {
            throw new BackendError(
              data.error,
              500,
              'file_processing',
              { jobId, fileType, results }
            );
          }

        } catch (parseError) {
          console.warn('Failed to parse processing response line:', line);
        }
      }
    }

    return {
      success: true,
      results,
      jobId,
      fileType
    };

  } catch (error) {
    console.error('File processing failed:', error);
    throw error instanceof BackendError ? error : new BackendError(
      error.message,
      500,
      'file_processing',
      { jobId, fileType }
    );
  }
}

// ===== HEALTH MONITORING =====

/**
 * Check backend service health
 */
export async function checkHealth() {
  try {
    const response = await makeRequest('/api/health', {
      timeout: 10000
    });

    return await response.json();

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Check if backend is ready to accept requests
 */
export async function checkReadiness() {
  try {
    const response = await makeRequest('/api/health/ready', {
      timeout: 5000
    });

    return await response.json();

  } catch (error) {
    return {
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// ===== UTILITIES =====

/**
 * Format backend errors for user display
 */
export function formatBackendError(error) {
  if (error instanceof BackendError) {
    return {
      title: 'Operation Failed',
      message: error.message,
      operation: error.operation,
      status: error.status,
      timestamp: error.timestamp,
      isRetryable: error.status >= 500 || error.status === 408,
      suggestion: getSuggestionForError(error)
    };
  }

  return {
    title: 'Unexpected Error',
    message: error.message || 'An unexpected error occurred',
    isRetryable: true,
    suggestion: 'Please try again. If the problem persists, contact support.'
  };
}

function getSuggestionForError(error) {
  if (error.status === 408) {
    return 'The operation timed out. Try breaking it into smaller chunks or check your internet connection.';
  }
  
  if (error.status >= 500) {
    return 'Server error occurred. Please wait a moment and try again.';
  }
  
  if (error.status === 404) {
    return 'The requested resource was not found. Please check your request and try again.';
  }
  
  if (error.status === 400) {
    return 'Invalid request. Please check your input and try again.';
  }
  
  return 'Please try again. If the problem persists, contact support.';
}

export { BackendError };
