# Backend Deployment - Fix Your Performance Issues

## Quick Deploy to Vercel (5 minutes)

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy from backend folder:**
   ```bash
   cd backend
   vercel
   ```

3. **Set environment variables in Vercel dashboard:**
   - `NEON_DATABASE_URL` = your Neon connection string
   - `SUPABASE_URL` = your Supabase URL  
   - `SUPABASE_SERVICE_ROLE_KEY` = your service role key (NOT anon key)
   - `FRONTEND_URL` = https://your-frontend-domain.com

4. **Update frontend environment:**
   ```bash
   # In your main project (not backend folder)
   export REACT_APP_BACKEND_URL=https://your-backend-url.vercel.app
   ```

## Alternative: Railway Deploy (also 5 minutes)

1. **Push backend to GitHub**
2. **Connect Railway to your repo**
3. **Set same environment variables**
4. **Deploy**

## Test Backend is Working

```bash
curl https://your-backend-url.vercel.app/api/health
```

Should return:
```json
{
  "status": "healthy",
  "databases": {
    "neon": {"status": "healthy"},
    "supabase": {"status": "healthy"}
  }
}
```

## What This Fixes

- ✅ **16K+ record jobs** won't timeout
- ✅ **Heavy JSONB operations** processed server-side
- ✅ **File uploads** with progress tracking
- ✅ **Bulk operations** without browser crashes
- ✅ **Connection pooling** prevents database overload

The backend handles the exact operations that are choking your Supabase direct calls.
