#!/usr/bin/env node

/**
 * Backend startup script that uses Builder.io environment variables
 */

// Set environment variables from Builder.io system
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.BACKEND_PORT || '3002';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

// Use the environment variables from Builder.io
process.env.NEON_DATABASE_URL = process.env.NEON_DATABASE_URL;
process.env.SUPABASE_URL = process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Backend environment check:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('- NEON_DATABASE_URL:', process.env.NEON_DATABASE_URL ? 'SET' : 'MISSING');
console.log('- SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');

// Check for required variables
const required = ['NEON_DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter(name => !process.env[name]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing);
  console.log('\n📋 Available env vars containing these terms:');
  Object.keys(process.env).forEach(key => {
    if (key.includes('NEON') || key.includes('SUPABASE') || key.includes('DATABASE')) {
      console.log(`   - ${key}: ${process.env[key] ? 'SET' : 'EMPTY'}`);
    }
  });
  process.exit(1);
}

console.log('✅ All environment variables set, starting server...');

// Start the actual server
require('./server.js');
