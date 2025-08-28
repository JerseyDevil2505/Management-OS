#!/usr/bin/env node

/**
 * Backend startup script with environment validation
 */

const fs = require('fs');
const path = require('path');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ Error: .env file not found!');
  console.log('\n📋 Create backend/.env with these variables:');
  console.log(`
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
NEON_DATABASE_URL=your-neon-connection-string
SUPABASE_URL=https://zxvavttfvpsagzluqqwn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
`);
  process.exit(1);
}

// Load environment variables
require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
  'NEON_DATABASE_URL',
  'SUPABASE_URL', 
  'SUPABASE_SERVICE_ROLE_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.log('\n📋 Please add these to your .env file');
  process.exit(1);
}

// Validate Neon URL format
if (!process.env.NEON_DATABASE_URL.includes('neon.tech')) {
  console.error('❌ NEON_DATABASE_URL appears to be invalid');
  console.log('   Expected format: postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/db');
  process.exit(1);
}

// Validate Supabase URL format
if (!process.env.SUPABASE_URL.includes('supabase.co')) {
  console.error('❌ SUPABASE_URL appears to be invalid');
  console.log('   Expected format: https://your-project.supabase.co');
  process.exit(1);
}

console.log('✅ Environment validation passed');
console.log(`🚀 Starting Management OS Backend on port ${process.env.PORT || 3001}...`);
console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
console.log(`📊 Database: ${process.env.NEON_DATABASE_URL.split('@')[1]?.split('/')[0] || 'Unknown'}`);

// Start the server
require('./server.js');
