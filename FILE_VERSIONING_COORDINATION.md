# File Versioning Coordination

## 🎯 **Problem Solved**

The automatic source file sync service needed to coordinate with the manual file upload versioning system to avoid conflicts and ensure proper version tracking.

## 📊 **How File Versioning Works**

### **Manual File Uploads (FileUploadButton)**
```javascript
// Gets current version from database
const currentVersion = await supabase
  .from('property_records')
  .select('file_version')
  .eq('job_id', jobId)
  .single();

// Increments version for new upload
const newFileVersion = currentVersion + 1;

// Processes with new version
await propertyService.updateCSVData(sourceFileContent, ..., {
  file_version: newFileVersion,
  source_file_name: uploadedFile.name
});
```

### **Automatic Sync Service**
```javascript
// Gets current version but DOESN'T increment
const { data: currentVersionData } = await supabase
  .from('property_records')
  .select('file_version')
  .eq('job_id', jobId)
  .single();

// Uses SAME version (no increment)
const currentVersion = currentVersionData.file_version || 1;

// Processes with existing version
await brtUpdater.processFile(sourceFileContent, ..., {
  file_version: currentVersion, // No increment!
  is_automatic_sync: true,
  source_file_name: 'Auto-sync from stored source'
});
```

## 🔄 **Version Flow Examples**

### **Normal Upload Sequence**
1. Job created → `file_version: 1`
2. User uploads new file → `file_version: 2`
3. User uploads another file → `file_version: 3`

### **With Automatic Sync**
1. Job created → `file_version: 1`
2. Source file content changes → Auto sync runs with `file_version: 1` (no increment)
3. User uploads new file → `file_version: 2` (continues sequence)
4. Source file content changes again → Auto sync runs with `file_version: 2` (no increment)

## 📋 **Validation Status Tracking**

### **Manual Uploads**
- `validation_status: 'updated'` - User manually uploaded new data
- `is_new_since_last_upload: false` - For UPSERT operations

### **Automatic Sync**  
- `validation_status: 'auto_synced'` - System automatically synchronized data
- `is_automatic_sync: true` - Flag indicating automatic operation
- `source_file_name: 'Auto-sync from stored source'` - Clear indication of source

## 🎯 **Why This Works**

### **No Version Conflicts**
- Manual uploads increment the version (new data)
- Automatic sync preserves the version (same data, just reprocessed)
- Version numbers remain sequential and meaningful

### **Clear Data Lineage**
- `validation_status` shows whether data came from user upload or automatic sync
- `source_file_name` indicates the operation type
- `is_automatic_sync` flag provides programmatic detection

### **Comparison Logic Preserved**
- FileUploadButton comparison still works correctly
- Version increments only happen for actual new file uploads
- Automatic sync doesn't create "fake" versions

## 📊 **Database Impact**

### **Before Fix (Problem)**
```sql
-- Manual upload
file_version: 1 → 2 (correct)

-- Automatic sync  
file_version: 2 → 1640995200000 (timestamp - WRONG!)

-- Next manual upload
file_version: ??? (broken sequence)
```

### **After Fix (Solution)**
```sql
-- Manual upload
file_version: 1 → 2 (correct)

-- Automatic sync
file_version: 2 → 2 (no change - correct)

-- Next manual upload  
file_version: 2 → 3 (continues sequence - correct)
```

## 🔍 **Monitoring and Debugging**

### **Check Version Status**
```sql
SELECT 
  job_id,
  file_version,
  validation_status,
  source_file_name,
  processed_at
FROM property_records 
WHERE job_id = 'your-job-id'
ORDER BY processed_at DESC
LIMIT 10;
```

### **Identify Automatic Syncs**
```sql
SELECT 
  job_id,
  COUNT(*) as auto_sync_count,
  MAX(processed_at) as last_auto_sync
FROM property_records 
WHERE validation_status = 'auto_synced'
GROUP BY job_id;
```

### **Version Sequence Check**
```sql
-- This should show a clean sequence (1, 2, 3, ...)
SELECT DISTINCT 
  file_version,
  validation_status,
  source_file_name
FROM property_records 
WHERE job_id = 'your-job-id'
ORDER BY file_version;
```

## ✅ **Benefits**

1. **Clean Version History** - No timestamp pollution in version numbers
2. **Preserved Comparison Logic** - FileUploadButton still works correctly  
3. **Clear Audit Trail** - Can distinguish manual vs automatic operations
4. **No User Confusion** - Version numbers remain meaningful to users
5. **Future-Proof** - System can handle any combination of manual/automatic operations

## 🚨 **Important Notes**

- **Automatic sync never increments versions** - Only reprocesses existing data
- **Manual uploads always increment versions** - Indicates new source data
- **Version numbers are sacred** - They must remain sequential and meaningful
- **Validation status is key** - Use this to distinguish operation types
