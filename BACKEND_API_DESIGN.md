# Hybrid Backend API Architecture

## Overview
Hybrid approach using **Neon** for heavy operations and **Supabase** for lightweight operations to eliminate initialization hangs and 500/503 errors.

## Service Separation

### Supabase (Keep Current)
**Handles:** Lightweight operations, auth, real-time
- User authentication/sessions
- Simple CRUD operations (employees, basic job info)
- Real-time subscriptions
- File storage (documents, uploads)
- Quick lookups (< 1000 records)

### Neon Backend APIs (New)
**Handles:** Heavy operations causing issues
- Job initialization and property loading
- File processing pipelines (BRT/Microsystems)
- Batch operations and bulk updates
- Complex queries with timeouts
- Multi-user coordination

## API Endpoints

### Core Job Operations
```
POST /api/jobs/initialize
- Replaces problematic direct job loading
- Includes proper timeout handling (30s max)
- Returns progress updates via streaming

POST /api/files/process
- Handles BRT/Microsystems file processing
- Streaming progress updates
- Automatic retry on failure
- Max 5 minute timeout with heartbeat

GET /api/jobs/{id}/properties
- Paginated property loading (1000 per page)
- Cached responses for performance
- Proper error handling

POST /api/properties/batch-update
- Bulk property updates with transaction safety
- Progress tracking for large batches
- Rollback on failure
```

### File Processing Pipeline
```
POST /api/files/upload
- Handles large file uploads with resume
- Virus scanning and validation
- Progress tracking

POST /api/files/parse/{vendor}
- BRT/Microsystems specific parsing
- Memory-optimized for large files
- Error recovery and reporting

POST /api/jobs/sync-properties
- Syncs processed data back to Supabase
- Handles conflicts and duplicates
- Maintains data integrity
```

### Error Recovery
```
GET /api/health
- Service health checks
- Database connection status
- Performance metrics

POST /api/jobs/recover/{id}
- Emergency recovery for stuck jobs
- Resets initialization state
- Clears stuck operations
```

## Request Flow

### Job Initialization (Fixed)
1. Frontend → Neon API `/api/jobs/initialize`
2. Neon processes heavy queries with timeout
3. Returns paginated results to frontend
4. Frontend updates Supabase with status
5. No more hangs or 500 errors

### File Processing (Fixed) 
1. Frontend → Neon API `/api/files/process`
2. Neon handles parsing with progress updates
3. Streaming response prevents timeouts
4. Results synced back to Supabase
5. Emergency stop capability

### Normal Operations (Unchanged)
1. Frontend → Supabase (direct)
2. Simple queries, auth, real-time
3. Fast responses, no backend overhead

## Benefits

### Reliability
- **Timeout handling**: All heavy operations have max timeouts
- **Retry logic**: Automatic retry on network issues
- **Error recovery**: Emergency stop and recovery endpoints
- **Progress tracking**: Real-time updates prevent frozen UI

### Performance  
- **Connection pooling**: Proper database connections
- **Caching**: Intelligent caching for repeated queries
- **Streaming**: Large operations stream results
- **Pagination**: No more loading 50k records at once

### Multi-User Safety
- **Request queuing**: Prevents database overload
- **Transaction safety**: Proper ACID compliance
- **Conflict resolution**: Handles concurrent operations
- **Session isolation**: User operations don't interfere

## Implementation Priority

1. **Job initialization API** (fixes immediate hangs)
2. **File processing API** (fixes upload failures)  
3. **Batch operations API** (fixes 500/503 errors)
4. **Recovery endpoints** (emergency stop capability)
5. **Performance monitoring** (prevents future issues)

## Data Flow Security
- All sensitive operations go through Neon backend
- Supabase RLS policies remain active for direct access
- API authentication via Supabase JWT tokens
- Database credentials only in backend environment

## Cost Impact
- Neon free tier handles 10 users easily
- Supabase Pro remains for existing features
- Overall cost likely neutral or reduced
