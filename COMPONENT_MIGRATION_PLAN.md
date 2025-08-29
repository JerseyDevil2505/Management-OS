# Component Migration Plan: Job Metrics

## Fields Moving from property_records → jobs table:
- `validation_status` ("imported" vs "updated")
- `project_start_date` (inspection start date)

## Components That Need Updates:

### 1. ProductionTracker.jsx 
**Current:** Reads/writes `project_start_date` from property_records
```javascript
// OLD: Per-property query
.from('property_records')
.select('project_start_date')
.eq('job_id', jobData.id)

// NEW: Job-level query  
.from('jobs')
.select('project_start_date')
.eq('id', jobData.id)
.single()
```

### 2. VirtualPropertyList.jsx
**Current:** Shows validation_status badge per property
```javascript
// OLD: Property-level badge
{property.validation_status && (
  <span className="validation-badge">{property.validation_status}</span>
)}

// NEW: Job-level indicator (show once, not per property)
{jobData.validation_status && (
  <div className="job-status-banner">{jobData.validation_status}</div>
)}
```

### 3. FileUploadButton.jsx 
**Current:** Sets validation_status on properties during processing
```javascript
// OLD: Set on each property
validation_status: 'imported' | 'updated'

// NEW: Set once on job
await supabase
  .from('jobs')
  .update({ validation_status: 'updated' })
  .eq('id', jobId)
```

### 4. BRT/Microsystems Processors
**Current:** Set validation_status in property baseRecord
```javascript
// OLD: In mapToPropertyRecord()
validation_status: 'imported'

// NEW: Set on job after processing
await supabase
  .from('jobs') 
  .update({ validation_status: 'imported' })
  .eq('id', jobId)
```

## Benefits:
- **Performance:** Only 1 field per job vs 52,939 fields per job
- **Logic:** Job metrics stored at job level (proper architecture)
- **Preservation:** No need to preserve job metrics during property upserts
- **UI:** Show job status once instead of duplicating across properties

## Migration Order:
1. ✅ Add columns to jobs table
2. ✅ Migrate existing data  
3. ⏳ Update ProductionTracker queries
4. ⏳ Update VirtualPropertyList UI
5. ⏳ Update processors to set job-level status
6. ⏳ Remove fields from property_records
7. ⏳ Test FileUploadButton banner shows job status

## Final PRESERVED_FIELDS Result:
```javascript
const PRESERVED_FIELDS = [
  'is_assigned_property'  // Only 1 field instead of 3!
]
```

**Performance Improvement:** 
- Before: 3 fields × 52,939 properties = 158,817 preserved field fetches
- After: 1 field × 52,939 properties = 52,939 preserved field fetches  
- **Improvement: ~67% reduction!**
