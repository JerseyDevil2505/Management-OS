const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const timeout = require('express-timeout-handler');
const pino = require('pino');
require('dotenv').config();

// Import route handlers
const jobRoutes = require('./routes/jobs');
const fileRoutes = require('./routes/files');
const healthRoutes = require('./routes/health');

// Configure logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3001;

// ===== SECURITY & PERFORMANCE MIDDLEWARE =====

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false // Allow frontend communication
}));

// Compression for better performance
app.use(compression());

// CORS configuration for frontend communication
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-supabase-auth']
}));

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Special rate limiting for heavy operations
const heavyOperationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Only 10 heavy operations per 5 minutes
  keyGenerator: (req) => {
    // Rate limit by user + operation type
    const userId = req.headers['x-user-id'] || req.ip;
    const operation = req.path.split('/')[2]; // /api/jobs/initialize -> 'jobs'
    return `${userId}:${operation}`;
  }
});

// JSON parsing with size limits
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb' 
}));

// ===== TIMEOUT HANDLING =====

// Global timeout handler - prevents hanging requests
app.use(timeout.handler({
  timeout: 30000, // 30 second default timeout
  onTimeout: function(req, res, next) {
    const operation = req.path;
    logger.error({
      operation,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }, 'Request timeout occurred');

    res.status(408).json({
      error: 'Request timeout',
      message: 'Operation took too long to complete. Please try again.',
      operation: operation,
      timeout: '30 seconds',
      suggestion: 'Try breaking down the operation into smaller chunks'
    });
  },
  onDelayedResponse: function(req, method, args, requestTime) {
    logger.warn({
      operation: req.path,
      method: req.method,
      requestTime
    }, 'Delayed response detected');
  }
}));

// ===== REQUEST LOGGING =====

app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'error' : 'info';
    
    logger[logLevel]({
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentLength: res.get('Content-Length')
    }, 'HTTP Request');
  });
  
  next();
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    service: 'Management OS Backend API',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      jobs: '/api/jobs/*',
      files: '/api/files/*',
      health: '/api/health'
    }
  });
});

// ===== API ROUTES =====

// Apply heavy operation rate limiting to specific routes
app.use('/api/jobs/initialize', heavyOperationLimiter);
app.use('/api/files/process', heavyOperationLimiter);
app.use('/api/properties/batch-update', heavyOperationLimiter);

// Mount route handlers
app.use('/api/health', healthRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/files', fileRoutes);

// ===== ERROR HANDLING =====

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `${req.method} ${req.originalUrl} is not a valid endpoint`,
    availableEndpoints: [
      'GET /api/health',
      'POST /api/jobs/initialize',
      'POST /api/files/process',
      'GET /api/jobs/{id}/properties'
    ]
  });
});

// Global error handler
app.use((error, req, res, next) => {
  const errorId = Math.random().toString(36).substring(7);
  
  logger.error({
    errorId,
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  }, 'Unhandled error occurred');

  // Don't leak error details in production
  const isDev = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    error: 'Internal server error',
    message: isDev ? error.message : 'An unexpected error occurred',
    errorId: errorId,
    timestamp: new Date().toISOString(),
    ...(isDev && { stack: error.stack })
  });
});

// ===== GRACEFUL SHUTDOWN =====

const server = app.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    pid: process.pid
  }, 'Management OS Backend API started successfully');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal({
    error: error.message,
    stack: error.stack
  }, 'Uncaught exception occurred');
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({
    reason,
    promise
  }, 'Unhandled promise rejection occurred');
  
  process.exit(1);
});

module.exports = app;
