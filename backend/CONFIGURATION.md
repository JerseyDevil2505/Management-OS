# Backend Configuration Guide

## Environment Variables Required

Create a `.env` file in the backend directory with these variables:

### Server Configuration
```
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
FRONTEND_URL=http://localhost:3000
```

### Neon Database (Replace with your actual Neon connection)
```
NEON_DATABASE_URL=postgresql://username:password@ep-example-123456.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Supabase Configuration (Use your existing values)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Important**: Use `SUPABASE_SERVICE_ROLE_KEY` for backend (not ANON_KEY) to allow proper database access.

## Quick Setup

1. **Install Dependencies**:
   ```bash
   cd backend
   npm install
   ```

2. **Create .env file** with your actual values

3. **Start Backend**:
   ```bash
   npm run dev
   ```

4. **Test Health**:
   ```bash
   curl http://localhost:3001/api/health
   ```

## What This Fixes

- ✅ **Initialization Hangs**: Proper timeout handling and streaming responses
- ✅ **500/503 Errors**: Better error handling and connection pooling  
- ✅ **File Upload Failures**: Robust upload processing with progress tracking
- ✅ **Multi-user Issues**: Request queuing and proper transaction handling

## Architecture

- **Neon**: Heavy operations (job initialization, file processing, complex queries)
- **Supabase**: Lightweight operations (auth, simple CRUD, real-time updates)
- **Frontend**: Updated to call backend APIs for problematic operations
