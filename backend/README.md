# Management OS Backend Service


## 🚀 Quick Setup

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Create Environment File
Create `backend/.env` with your credentials:

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Your Neon connection string (from Neon dashboard)
NEON_DATABASE_URL=postgresql://neondb_owner:your-password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require

# Your Supabase credentials (from existing .env)
SUPABASE_URL=https://zxvavttfvpsagzluqqwn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 3. Setup Neon Database
1. **Open Neon SQL Editor** in your dashboard
2. **Run the schema setup**:
   ```sql
   -- Copy and paste contents of setup-neon-schema.sql
   ```

### 4. Start Backend
```bash
npm run dev
```

## ✅ Verify Setup

### Health Check
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
Visit your Management OS app and look for the **"Backend File Processing"** section with the green "Enhanced" badge.

## 🔧 What This Fixes

- ✅ **No more initialization hangs** - Proper streaming responses
- ✅ **No more 500/503 errors** - Better error handling  
- ✅ **Reliable file uploads** - Progress tracking and recovery
- ✅ **Multi-user support** - Connection pooling and queuing

## 📊 API Endpoints

- `GET /api/health` - Service health check
- `POST /api/jobs/initialize/:jobId` - Initialize job (replaces hangs)
- `POST /api/files/upload` - Upload files with progress
- `POST /api/files/process/:jobId` - Process files with streaming
- `GET /api/jobs/:jobId/properties` - Paginated property loading
- `POST /api/jobs/:jobId/recover` - Emergency recovery

## 🆘 Troubleshooting

### Backend won't start
```bash
# Check environment variables
node start.js
```

### Can't connect to Neon
```bash
# Test connection
psql $NEON_DATABASE_URL -c "SELECT 1;"
```

### Frontend can't reach backend
```bash
# Check CORS
curl -H "Origin: http://localhost:3000" http://localhost:3001/api/health
```

## 🔄 Development

- **Logs**: Real-time structured logging with Pino
- **Hot reload**: Use `npm run dev` for development
- **Error handling**: All endpoints have proper timeout and error recovery
- **Performance**: Connection pooling and query optimization
