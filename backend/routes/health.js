const express = require('express');
const pino = require('pino');
const { healthCheck } = require('../config/database');

const router = express.Router();
const logger = pino();

// ===== HEALTH CHECK ENDPOINT =====
// Monitors backend service and database health

router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check database connections
    const dbHealth = await healthCheck();
    
    // Check system resources
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    
    // Determine overall health status
    const neonHealthy = dbHealth.neon.status === 'healthy';
    const supabaseHealthy = dbHealth.supabase.status === 'healthy';
    const overallHealthy = neonHealthy && supabaseHealthy;
    
    const response = {
      status: overallHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      responseTime: `${Date.now() - startTime}ms`,
      
      // Database health
      databases: dbHealth,
      
      // System metrics
      system: {
        memory: {
          used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
          total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
          external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
        },
        cpu: {
          user: `${Math.round(cpuUsage.user / 1000)}ms`,
          system: `${Math.round(cpuUsage.system / 1000)}ms`
        },
        node_version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      
      // Service information
      service: {
        name: 'Management OS Backend API',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        pid: process.pid
      }
    };

    // Set appropriate HTTP status
    const statusCode = overallHealthy ? 200 : 503;
    res.status(statusCode).json(response);

    // Log health check result
    if (overallHealthy) {
      logger.debug({
        neonLatency: dbHealth.neon.latency,
        supabaseLatency: dbHealth.supabase.latency,
        responseTime: Date.now() - startTime
      }, 'Health check passed');
    } else {
      logger.warn({
        neonStatus: dbHealth.neon.status,
        supabaseStatus: dbHealth.supabase.status,
        neonError: dbHealth.neon.error,
        supabaseError: dbHealth.supabase.error
      }, 'Health check failed');
    }

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Health check endpoint error');

    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      message: error.message,
      timestamp: new Date().toISOString(),
      responseTime: `${Date.now() - startTime}ms`
    });
  }
});

// ===== DETAILED DATABASE STATUS =====

router.get('/database', async (req, res) => {
  try {
    const dbHealth = await healthCheck();
    
    res.json({
      timestamp: new Date().toISOString(),
      databases: dbHealth,
      summary: {
        neon: {
          status: dbHealth.neon.status,
          latency: dbHealth.neon.latency ? `${dbHealth.neon.latency}ms` : null,
          use_case: 'Heavy operations, batch processing, complex queries'
        },
        supabase: {
          status: dbHealth.supabase.status,
          latency: dbHealth.supabase.latency ? `${dbHealth.supabase.latency}ms` : null,
          use_case: 'Authentication, real-time updates, lightweight operations'
        }
      }
    });

  } catch (error) {
    logger.error({
      error: error.message
    }, 'Database health check failed');

    res.status(500).json({
      error: 'Database health check failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== SYSTEM METRICS =====

router.get('/metrics', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    
    // Get environment info
    const envInfo = {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: process.env.NODE_ENV || 'development',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    res.json({
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        unit: 'MB'
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000),
        system: Math.round(cpuUsage.system / 1000),
        unit: 'ms'
      },
      environment: envInfo,
      process: {
        pid: process.pid,
        title: process.title,
        argv: process.argv.slice(2) // Hide node path and script name
      }
    });

  } catch (error) {
    logger.error({
      error: error.message
    }, 'Metrics collection failed');

    res.status(500).json({
      error: 'Metrics collection failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== READINESS CHECK =====
// Used by load balancers to determine if service can accept traffic

router.get('/ready', async (req, res) => {
  try {
    // Quick database ping
    const dbHealth = await healthCheck();
    
    const ready = dbHealth.neon.status === 'healthy' && dbHealth.supabase.status === 'healthy';
    
    if (ready) {
      res.status(200).json({
        status: 'ready',
        message: 'Service is ready to accept traffic',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        message: 'Service is not ready to accept traffic',
        databases: {
          neon: dbHealth.neon.status,
          supabase: dbHealth.supabase.status
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== LIVENESS CHECK =====
// Used to determine if service should be restarted

router.get('/live', (req, res) => {
  // Simple liveness check - if we can respond, we're alive
  res.status(200).json({
    status: 'alive',
    message: 'Service is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
