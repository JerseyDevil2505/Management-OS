const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const pino = require('pino');

const logger = pino();

// ===== NEON DATABASE CONNECTION =====

// Neon connection pool for heavy operations
const neonPool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Connection pool settings optimized for concurrent users
  max: 20, // Maximum connections
  min: 2,  // Minimum connections
  idleTimeoutMillis: 30000, // 30 seconds
  connectionTimeoutMillis: 10000, // 10 seconds
  acquireTimeoutMillis: 60000, // 1 minute max wait for connection
  
  // Retry settings
  application_name: 'management-os-backend',
  statement_timeout: 30000, // 30 second query timeout
  query_timeout: 30000,
  
  // Health check
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Test Neon connection on startup
neonPool.connect((err, client, release) => {
  if (err) {
    logger.fatal({
      error: err.message,
      code: err.code
    }, 'Failed to connect to Neon database');
    process.exit(1);
  } else {
    logger.info('Successfully connected to Neon database');
    release();
  }
});

// Handle Neon pool errors
neonPool.on('error', (err, client) => {
  logger.error({
    error: err.message,
    code: err.code
  }, 'Unexpected error on Neon pool client');
});

neonPool.on('connect', () => {
  logger.debug('New Neon database connection established');
});

neonPool.on('acquire', () => {
  logger.debug('Neon database connection acquired from pool');
});

neonPool.on('remove', () => {
  logger.debug('Neon database connection removed from pool');
});

// ===== SUPABASE CLIENT =====

// Supabase client for lightweight operations and data sync
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY, // Service role for backend access
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'x-client-info': 'management-os-backend',
        'x-application-name': 'backend-service'
      }
    }
  }
);

// Test Supabase connection
supabase.from('jobs').select('count').limit(1)
  .then(({ error }) => {
    if (error) {
      logger.error({
        error: error.message,
        code: error.code
      }, 'Failed to connect to Supabase');
    } else {
      logger.info('Successfully connected to Supabase');
    }
  })
  .catch(err => {
    logger.error({
      error: err.message
    }, 'Supabase connection test failed');
  });

// ===== DATABASE HELPER FUNCTIONS =====

/**
 * Execute a query on Neon with proper error handling and timeout
 */
async function executeNeonQuery(query, params = [], timeout = 30000) {
  const client = await neonPool.connect();
  const startTime = Date.now();
  
  try {
    // Set query timeout
    await client.query(`SET statement_timeout = ${timeout}`);
    
    const result = await client.query(query, params);
    const duration = Date.now() - startTime;
    
    logger.debug({
      query: query.substring(0, 100) + '...',
      params: params.length,
      rows: result.rowCount,
      duration: `${duration}ms`
    }, 'Neon query executed successfully');
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error({
      error: error.message,
      code: error.code,
      query: query.substring(0, 100) + '...',
      params: params.length,
      duration: `${duration}ms`
    }, 'Neon query failed');
    
    throw new DatabaseError(error.message, error.code, 'neon');
  } finally {
    client.release();
  }
}

/**
 * Execute a transaction on Neon with rollback on failure
 */
async function executeNeonTransaction(queries) {
  const client = await neonPool.connect();
  
  try {
    await client.query('BEGIN');
    
    const results = [];
    for (const { query, params } of queries) {
      const result = await client.query(query, params);
      results.push(result);
    }
    
    await client.query('COMMIT');
    
    logger.info({
      operations: queries.length,
      totalRows: results.reduce((sum, r) => sum + r.rowCount, 0)
    }, 'Neon transaction completed successfully');
    
    return results;
    
  } catch (error) {
    await client.query('ROLLBACK');
    
    logger.error({
      error: error.message,
      code: error.code,
      operations: queries.length
    }, 'Neon transaction failed and rolled back');
    
    throw new DatabaseError(error.message, error.code, 'neon');
  } finally {
    client.release();
  }
}

/**
 * Execute Supabase query with error handling
 */
async function executeSupabaseQuery(table, operation, options = {}) {
  const startTime = Date.now();
  
  try {
    let query = supabase.from(table);
    
    // Apply operation
    switch (operation.type) {
      case 'select':
        query = query.select(operation.columns || '*');
        break;
      case 'insert':
        query = query.insert(operation.data);
        break;
      case 'update':
        query = query.update(operation.data);
        break;
      case 'delete':
        query = query.delete();
        break;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
    
    // Apply filters
    if (operation.filters) {
      for (const [method, args] of Object.entries(operation.filters)) {
        query = query[method](...args);
      }
    }
    
    // Apply options
    if (options.limit) query = query.limit(options.limit);
    if (options.order) query = query.order(options.order.column, { ascending: options.order.ascending });
    if (options.range) query = query.range(options.range.from, options.range.to);
    
    const { data, error, count } = await query;
    const duration = Date.now() - startTime;
    
    if (error) {
      throw new DatabaseError(error.message, error.code, 'supabase');
    }
    
    logger.debug({
      table,
      operation: operation.type,
      rows: data?.length || count || 0,
      duration: `${duration}ms`
    }, 'Supabase query executed successfully');
    
    return { data, count };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error({
      error: error.message,
      table,
      operation: operation.type,
      duration: `${duration}ms`
    }, 'Supabase query failed');
    
    throw error instanceof DatabaseError ? error : new DatabaseError(error.message, null, 'supabase');
  }
}

/**
 * Custom database error class
 */
class DatabaseError extends Error {
  constructor(message, code, source) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.source = source; // 'neon' or 'supabase'
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Health check for both databases
 */
async function healthCheck() {
  const results = {
    neon: { status: 'unknown', latency: null, error: null },
    supabase: { status: 'unknown', latency: null, error: null }
  };
  
  // Test Neon
  try {
    const start = Date.now();
    await executeNeonQuery('SELECT 1');
    results.neon = {
      status: 'healthy',
      latency: Date.now() - start,
      error: null
    };
  } catch (error) {
    results.neon = {
      status: 'unhealthy',
      latency: null,
      error: error.message
    };
  }
  
  // Test Supabase
  try {
    const start = Date.now();
    await executeSupabaseQuery('jobs', { type: 'select', columns: 'id' }, { limit: 1 });
    results.supabase = {
      status: 'healthy',
      latency: Date.now() - start,
      error: null
    };
  } catch (error) {
    results.supabase = {
      status: 'unhealthy',
      latency: null,
      error: error.message
    };
  }
  
  return results;
}

/**
 * Graceful shutdown of database connections
 */
async function shutdown() {
  logger.info('Closing database connections...');
  
  try {
    await neonPool.end();
    logger.info('Neon pool closed successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Error closing Neon pool');
  }
  
  // Supabase client doesn't need explicit cleanup
  logger.info('Database connections closed');
}

module.exports = {
  neonPool,
  supabase,
  executeNeonQuery,
  executeNeonTransaction,
  executeSupabaseQuery,
  DatabaseError,
  healthCheck,
  shutdown
};
