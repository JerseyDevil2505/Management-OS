# Backend Integration Guide

## 🎯 Overview

This hybrid backend architecture eliminates:
- ❌ **Initialization hangs** → ✅ **Streaming responses with timeouts**
- ❌ **500/503 errors** → ✅ **Proper error handling and recovery**
- ❌ **Upload failures** → ✅ **Progress tracking and resume capability**
- ❌ **Multi-user conflicts** → ✅ **Connection pooling and queuing**

## 🔧 Setup Instructions

### 1. Frontend Environment Variables
Add to your existing `.env` file:
```env
# Backend API URL
REACT_APP_BACKEND_URL=http://localhost:3001
```

### 2. Backend Setup
```bash
# Install backend dependencies
cd backend
npm install

# Create backend/.env file
cp .env.example .env
# Edit with your Neon connection string and Supabase credentials
```

### 3. Neon Database Setup
1. **Copy your Neon connection string** from the dashboard
2. **Run the schema setup** in Neon SQL Editor:
   ```sql
   -- Copy contents of backend/setup-neon-schema.sql
   ```

### 4. Start Services
```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend  
cd ..
npm start
```

## 🔄 Architecture Flow

### Heavy Operations → Backend Service
- **Job initialization**: `POST /api/jobs/initialize/:jobId`
- **File processing**: `POST /api/files/process/:jobId`
- **Property loading**: `GET /api/jobs/:jobId/properties`
- **Emergency recovery**: `POST /api/jobs/:jobId/recover`

### Light Operations → Direct Supabase
- **Authentication**: Direct Supabase auth
- **Simple queries**: Employee management, job metadata
- **Real-time updates**: Supabase realtime subscriptions

### Automatic Fallback
- If backend is unavailable, frontend automatically falls back to direct Supabase calls
- No data loss or functionality loss during backend maintenance

## 🚀 New Components

### Enhanced File Upload
Replace `FileUploadButton` with `BackendFileUploadButton` for:
- ✅ **Progress tracking** with real-time updates
- ✅ **Error recovery** with detailed error messages
- ✅ **Streaming processing** prevents UI freezing
- ✅ **Emergency stop** capability for stuck operations

### Backend-Aware Job Loading
`JobContainer` now:
- ✅ **Tries backend first** for job initialization
- ✅ **Falls back gracefully** if backend unavailable
- ✅ **Streams progress updates** during loading
- ✅ **Handles timeouts properly** with recovery options

## 🧪 Testing

### Verify Backend Health
```bash
curl http://localhost:3001/api/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "databases": {
    "neon": { "status": "healthy", "latency": 45 },
    "supabase": { "status": "healthy", "latency": 32 }
  }
}
```

### Test File Upload
1. **Go to a job** in your app
2. **Look for "Backend File Processing"** section with green "Enhanced" badge
3. **Upload a file** and watch real-time progress tracking
4. **Verify no hangs** and proper error handling

### Test Multi-User Scenario
1. **Open 3 browser tabs** with different users
2. **Initialize same job simultaneously** in all tabs
3. **Verify all complete** without conflicts or hangs

## 🔧 Environment Variables Reference

### Frontend (`.env`)
```env
REACT_APP_BACKEND_URL=http://localhost:3001
REACT_APP_SUPABASE_URL=your-supabase-url
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

### Backend (`backend/.env`)
```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
NEON_DATABASE_URL=your-neon-connection-string
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 🆘 Troubleshooting

### Backend won't start
```bash
cd backend
node start.js  # Validates environment variables
```

### Frontend can't reach backend
```bash
# Check if backend is running
curl http://localhost:3001/

# Check environment variable
echo $REACT_APP_BACKEND_URL
```

### Database connection issues
```bash
# Test Neon connection
psql $NEON_DATABASE_URL -c "SELECT 1;"

# Test Supabase connection
curl "$SUPABASE_URL/rest/v1/jobs?select=count" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

## 📊 Monitoring

### Backend Logs
- **Structured JSON logging** with Pino
- **Request/response tracking** with duration
- **Database query monitoring** with latency
- **Error details** with stack traces

### Performance Metrics
- **Connection pool status** via `/api/health`
- **Query performance** logged automatically  
- **Memory usage** tracked per operation
- **Error rates** monitored and reported

## 🔄 Deployment Notes

### Development
- Backend runs on port 3001
- Frontend connects automatically
- Hot reload enabled

### Production
- Deploy backend to your hosting platform
- Update `REACT_APP_BACKEND_URL` to production backend URL
- Ensure database firewall allows backend server IP
- Set production environment variables
