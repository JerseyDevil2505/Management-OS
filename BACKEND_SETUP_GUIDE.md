# Backend Service Setup & Testing Guide

## 🚀 Quick Setup

### 1. Backend Setup
```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Create .env file with your credentials
cp CONFIGURATION.md .env
# Edit .env with your actual Neon and Supabase credentials

# Start backend service
npm run dev
```

### 2. Frontend Integration
The frontend automatically detects the backend service and provides:
- **Hybrid operation**: Falls back to original methods if backend is unavailable
- **Enhanced file upload**: New `BackendFileUploadButton` component with streaming progress
- **Better error handling**: Detailed error messages and recovery suggestions

### 3. Environment Variables Required

Create `backend/.env` file:
```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Replace with your Neon database URL
NEON_DATABASE_URL=postgresql://username:password@ep-example-123456.us-east-1.aws.neon.tech/neondb?sslmode=require

# Your existing Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 🧪 Testing the Backend Service

### Health Check Tests
```bash
# Basic health check
curl http://localhost:3001/api/health

# Database connectivity check  
curl http://localhost:3001/api/health/database

# Service readiness check
curl http://localhost:3001/api/health/ready
```

### File Upload Tests
```bash
# Test file upload (replace with actual job ID and file)
curl -X POST http://localhost:3001/api/files/upload \
  -F "file=@test-file.csv" \
  -F "jobId=your-job-id" \
  -F "fileType=source"
```

### Job Initialization Tests
```bash
# Test job initialization (replace with actual job ID)
curl -X POST http://localhost:3001/api/jobs/initialize/your-job-id \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","skipCache":false}'
```

## 🎯 What This Fixes

### Before (Problems):
- ❌ **Initialization hangs**: Jobs get stuck during loading
- ❌ **500/503 errors**: Database overload from heavy operations  
- ❌ **Upload failures**: Large files timeout or fail
- ❌ **Multi-user conflicts**: Concurrent operations interfere

### After (Solutions):
- ✅ **Streaming responses**: No more hangs or timeouts
- ✅ **Connection pooling**: Proper database connection management
- ✅ **Error recovery**: Emergency recovery endpoints available
- ✅ **Progress tracking**: Real-time progress updates
- ✅ **Fallback safety**: Falls back to original methods if backend unavailable

## 🔧 Multi-User Testing Scenarios

### Test 1: Concurrent Job Initialization
1. Open 3 browser tabs with different users
2. Initialize the same job simultaneously in all tabs
3. **Expected**: All should complete without hanging or conflicts

### Test 2: Simultaneous File Uploads
1. Upload large files from 2 different users to different jobs
2. **Expected**: Both uploads should progress independently with real-time updates

### Test 3: Database Load Testing
1. Create 5+ concurrent property loading operations
2. **Expected**: All should complete with proper pagination and timeouts

### Test 4: Error Recovery Testing
1. Start a large operation and simulate network interruption
2. Use emergency recovery endpoint
3. **Expected**: Clean state restoration without data corruption

## 📊 Monitoring & Troubleshooting

### Backend Logs
```bash
# View backend logs
npm run dev

# Production logs with filtering
npm start | grep ERROR
```

### Performance Monitoring
- **Health endpoint**: Monitor `/api/health` for system status
- **Metrics endpoint**: Monitor `/api/health/metrics` for resource usage
- **Database latency**: Check connection times in health responses

### Common Issues & Solutions

**Issue**: Backend not connecting to Neon
```bash
# Check environment variables
echo $NEON_DATABASE_URL

# Test connection directly
psql $NEON_DATABASE_URL -c "SELECT 1;"
```

**Issue**: Frontend can't reach backend
```bash
# Check backend is running
curl http://localhost:3001/

# Check CORS configuration
curl -H "Origin: http://localhost:3000" http://localhost:3001/api/health
```

**Issue**: File uploads failing
```bash
# Check file size limits (100MB max)
# Check file types allowed (.csv, .txt, .dat)
# Check disk space and memory
```

## 🔒 Security Considerations

- ✅ **Authentication**: Passes through Supabase JWT tokens
- ✅ **Rate limiting**: 1000 requests per 15 minutes per IP
- ✅ **File validation**: Size and type restrictions
- ✅ **Error sanitization**: No sensitive data in error responses
- ✅ **Connection security**: SSL/TLS required for production

## 📈 Performance Expectations

### Typical Response Times:
- **Health check**: < 100ms
- **Job initialization**: 5-30 seconds (vs previous hangs)
- **File upload**: 1-2 minutes for 50MB files
- **Property loading**: 2-5 seconds per 1000 properties

### Resource Usage:
- **Memory**: ~100-200MB for 10 concurrent users
- **CPU**: Low usage with connection pooling
- **Database connections**: Max 20 concurrent (vs unlimited direct calls)

## 🔄 Deployment Notes

### Development
- Backend runs on port 3001
- Frontend connects automatically
- Hot reload enabled for development

### Production
- Deploy backend to your preferred hosting (Netlify Functions, Vercel, etc.)
- Update `REACT_APP_BACKEND_URL` in frontend environment
- Ensure database firewall allows backend server IP
- Set production environment variables

## 🆘 Emergency Procedures

### If Backend Goes Down:
1. Frontend automatically falls back to original methods
2. Users can continue working with reduced performance
3. Fix backend and restart - no data loss

### If Database Issues:
1. Use emergency recovery endpoints
2. Check connection pooling status
3. Restart backend service if needed
4. Monitor health endpoints for recovery

### If File Processing Stuck:
1. Use emergency stop in frontend
2. Call recovery endpoint: `POST /api/jobs/{id}/recover`
3. Check processing logs for root cause
4. Restart operation with smaller batch sizes

## 📞 Getting Help

1. **Check backend logs** for specific error messages
2. **Use health endpoints** to diagnose system status  
3. **Test with curl** to isolate frontend vs backend issues
4. **Review environment variables** for configuration problems
5. **Monitor database connections** for pool exhaustion

---

**Success Criteria**: 
- ✅ 10 concurrent users can work without conflicts
- ✅ File uploads complete reliably with progress tracking
- ✅ Job initialization completes in < 30 seconds
- ✅ No more 500/503 errors during normal operations
- ✅ Emergency recovery works when needed
