# Source File Synchronization Solution

## 🎯 **Problem Solved**

Previously, when `jobs.source_file_content` was updated, there was no mechanism to automatically update the corresponding `property_records`. This created a synchronization gap where raw data and processed records could become inconsistent.

## 🏗️ **Complete Solution Architecture**

### 1. **Database Triggers** (`sql/create_source_file_sync_triggers.sql`)

#### **Automatic Trigger**
- **Trigger**: `jobs_source_file_content_changed`
- **Fires**: When `jobs.source_file_content` is updated
- **Action**: Automatically marks all related `property_records` as `needs_reprocessing`

#### **Helper Functions**
- **`get_raw_data_for_property(job_id, composite_key)`**
  - Extracts raw data for a specific property from stored source file
  - Supports both BRT and Microsystems formats
  - Returns JSON object with original raw data

- **`reprocess_property_records_from_source(job_id)`**
  - Marks all property records for a job as needing reprocessing
  - Creates audit log entries

- **`app_reprocess_job_from_source(job_id, force)`**
  - Application-level function to trigger reprocessing
  - Returns status and next steps

#### **Audit Logging**
- All source file changes are logged to `audit_log` table
- Tracks who changed what and when
- Provides full history of reprocessing activities

### 2. **Application Services** (`src/lib/supabaseClient.js`)

#### **New Functions Added to `propertyService`**

```javascript
// Get raw data for specific property from jobs.source_file_content
await propertyService.getRawDataForProperty(jobId, compositeKey)

// Check if job needs reprocessing
await propertyService.checkJobReprocessingStatus(jobId)

// Trigger database-level reprocessing
await propertyService.triggerJobReprocessing(jobId, force)

// Manually reprocess using application processors
await propertyService.manualReprocessFromSource(jobId)
```

### 3. **UI Component** (`src/components/SourceFileSyncManager.jsx`)

#### **Features**
- **Real-time sync status** - Shows if records need reprocessing
- **Manual triggers** - Buttons to reprocess changed or all records
- **Activity logging** - Shows reprocessing progress and results
- **Error handling** - Displays errors and recovery options

#### **Usage Example**
```jsx
import SourceFileSyncManager from '../components/SourceFileSyncManager';

<SourceFileSyncManager 
  job={selectedJob}
  onReprocessComplete={(result) => {
    console.log(`Reprocessed ${result.processed} records`);
  }}
/>
```

## 🔄 **How It Works**

### **Automatic Flow**
1. User updates `jobs.source_file_content` (e.g., via direct database edit)
2. Database trigger detects the change
3. All related `property_records` are marked `validation_status = 'needs_reprocessing'`
4. Audit log entry is created

### **Manual Reprocessing Flow**
1. User opens `SourceFileSyncManager` component
2. Component shows sync status and count of records needing reprocessing
3. User clicks "Reprocess Changed Records" or "Force Reprocess All"
4. System calls appropriate processor (BRT/Microsystems) with stored source file content
5. Property records are updated with new data while preserving user modifications
6. Sync status is updated to show completion

## 📊 **Database Schema Changes**

### **New Columns in `jobs`**
- `source_file_content` - Complete source file text (already added)
- `source_file_size` - Size in bytes (already added)  
- `source_file_rows_count` - Number of data rows (already added)
- `source_file_parsed_at` - When source was last parsed (already added)

### **New Table: `audit_log`**
```sql
CREATE TABLE audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action text NOT NULL,
    changes jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid REFERENCES employees(id)
);
```

### **Property Records Changes**
- **REMOVED**: `raw_data` column (to eliminate duplication)
- **ADDED**: `validation_status = 'needs_reprocessing'` state

## 🎛️ **Usage Scenarios**

### **Scenario 1: Admin Updates Source File**
```sql
-- Admin updates source file content
UPDATE jobs SET source_file_content = '...' WHERE id = 'job-id';

-- Trigger automatically marks records for reprocessing
-- Use SourceFileSyncManager UI to complete reprocessing
```

### **Scenario 2: Bulk Source File Migration**
```sql
-- Use app function for controlled reprocessing
SELECT app_reprocess_job_from_source('job-id'::uuid, true);
```

### **Scenario 3: Check Sync Status**
```javascript
const status = await propertyService.checkJobReprocessingStatus(jobId);
console.log(`${status.recordsNeedingReprocessing} records need reprocessing`);
```

### **Scenario 4: Get Raw Data for Analysis**
```javascript
const rawData = await propertyService.getRawDataForProperty(jobId, compositeKey);
console.log('Original data:', rawData);
```

## ⚡ **Performance Benefits**

### **Storage Optimization**
- **Eliminated**: Duplicate `raw_data` JSON in every property record
- **Centralized**: Single source file storage in `jobs` table
- **Reduced**: Database size by ~60-80% (estimate)

### **Processing Efficiency**
- **Faster**: Batch operations without massive JSON fields
- **Reliable**: Automatic cleanup and rollback on failures
- **Traceable**: Full audit trail of all changes

## 🔧 **Implementation Steps**

### **1. Run Database Setup**
```sql
\i sql/create_source_file_sync_triggers.sql
\i sql/drop_raw_data_column.sql
```

### **2. Deploy Application Changes**
- Updated `supabaseClient.js` with new functions
- Added `SourceFileSyncManager.jsx` component
- Modified all processors to remove `raw_data` field

### **3. Test the System**
```sql
-- Test automatic trigger
UPDATE jobs SET source_file_content = 'test content' WHERE id = 'test-job-id';

-- Check if records were marked for reprocessing  
SELECT COUNT(*) FROM property_records 
WHERE job_id = 'test-job-id' AND validation_status = 'needs_reprocessing';

-- Test manual reprocessing
SELECT app_reprocess_job_from_source('test-job-id'::uuid, false);
```

## 🛡️ **Safety Features**

### **Automatic Rollback**
- If reprocessing fails, all changes are automatically rolled back
- Prevents partial job states

### **Field Preservation** 
- User-modified fields are preserved during reprocessing
- Only source-derived fields are updated

### **Audit Trail**
- Every change is logged with timestamp and reason
- Full history available for troubleshooting

### **Graceful Degradation**
- If triggers fail, manual reprocessing still works
- If source file is missing, existing records remain unchanged

## 📈 **Future Enhancements**

1. **Real-time Notifications** - Alert users when reprocessing is needed
2. **Scheduled Reprocessing** - Automatic reprocessing during off-hours
3. **Selective Reprocessing** - Reprocess only specific property ranges
4. **Version Control** - Track multiple versions of source files
5. **Change Detection** - Smart detection of what actually changed

## 🎉 **Summary**

This solution provides a complete, robust system for keeping property records synchronized with source file content. It includes:

- ✅ **Automatic detection** of source file changes
- ✅ **Manual control** over reprocessing timing  
- ✅ **Performance optimization** by eliminating data duplication
- ✅ **Safety features** with rollback and preservation
- ✅ **User-friendly interface** for monitoring and control
- ✅ **Full audit trail** for compliance and debugging

The architecture ensures data consistency while providing flexibility and performance improvements.
