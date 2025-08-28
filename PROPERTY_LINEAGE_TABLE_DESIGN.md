# Property Lineage Tracking System Design

## 🎯 **Problem Statement**

**Current Issue**: When properties are added/removed between source file versions, we lose historical lineage:
- Can't reconstruct what any previous source file contained
- Can't track when properties were added/removed  
- Orphaned properties accumulate in database
- Comparison logic works on mixed-version data

## 🔑 **Key Insight: Composite Key Structure**

All properties in a job share the same prefix:
```
{TAX_YEAR}{CCDD_CODE}-{BLOCK}-{LOT}_{QUALIFIER}-{CARD}-{LOCATION}
```

Where:
- **TAX_YEAR**: From `jobs.start_date` (e.g., "2026") - **STATIC per job**
- **CCDD_CODE**: From `jobs.ccdd_code` - **STATIC per job**
- Property parts: From source file data - **DYNAMIC per property**

Example for Milford 2026:
- `2026MILFORD-001-001_NONE-NONE-123 MAIN ST`
- `2026MILFORD-001-002_NONE-NONE-125 MAIN ST`

## 📊 **Table Design**

### **Table 1: `source_file_versions`**
*Complete historical reconstruction capability*

```sql
CREATE TABLE source_file_versions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_version integer NOT NULL,
  
  -- Complete file storage for reconstruction
  file_content text NOT NULL,
  vendor_type text NOT NULL CHECK (vendor_type IN ('BRT', 'Microsystems')),
  original_filename text,
  file_size bigint,
  row_count integer,
  
  -- Property snapshot for this version
  property_composite_keys text[] NOT NULL, -- All keys that existed in this file version
  property_count integer GENERATED ALWAYS AS (array_length(property_composite_keys, 1)) STORED,
  
  -- Change summary (vs previous version)
  properties_added text[], -- Keys added in this version
  properties_removed text[], -- Keys removed in this version
  properties_modified text[], -- Keys with data changes
  
  -- Metadata
  uploaded_by uuid,
  uploaded_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  processing_status text DEFAULT 'stored',
  
  UNIQUE(job_id, file_version)
);
```

### **Table 2: `property_lifecycle_events`**
*Efficient change tracking and querying*

```sql
CREATE TABLE property_lifecycle_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  property_composite_key text NOT NULL,
  
  -- Event details
  event_type text NOT NULL CHECK (event_type IN ('ADDED', 'REMOVED', 'MODIFIED', 'RESTORED')),
  from_file_version integer, -- Version where it disappeared (for REMOVED)
  to_file_version integer NOT NULL, -- Version where it appeared/changed
  
  -- Change details (for MODIFIED events)
  changed_fields text[], -- Which fields changed
  old_values jsonb, -- Previous values
  new_values jsonb, -- New values
  
  -- Context
  created_at timestamp with time zone DEFAULT now(),
  source_file_version_id uuid REFERENCES source_file_versions(id)
);
```

### **Table 3: `property_version_snapshots`** *(Optional - for performance)*
*Fast property state reconstruction*

```sql
CREATE TABLE property_version_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL,
  property_composite_key text NOT NULL,
  file_version integer NOT NULL,
  
  -- Full property data at this version
  property_data jsonb NOT NULL,
  
  -- Metadata
  created_at timestamp with time zone DEFAULT now(),
  source_file_version_id uuid REFERENCES source_file_versions(id),
  
  UNIQUE(job_id, property_composite_key, file_version)
);
```

## 🔍 **Query Capabilities**

### **Historical Reconstruction**
```sql
-- Get all properties that existed in file version 1
SELECT unnest(property_composite_keys) as property_key
FROM source_file_versions 
WHERE job_id = 'job-uuid' AND file_version = 1;

-- Reconstruct complete source file for version 1
SELECT file_content 
FROM source_file_versions 
WHERE job_id = 'job-uuid' AND file_version = 1;
```

### **Property Lifecycle Tracking**
```sql
-- When was property XYZ added?
SELECT to_file_version, created_at
FROM property_lifecycle_events
WHERE property_composite_key = '2026MILFORD-001-001_NONE-NONE-123 MAIN ST'
  AND event_type = 'ADDED';

-- What properties were removed in version 3?
SELECT property_composite_key, from_file_version
FROM property_lifecycle_events
WHERE job_id = 'job-uuid' 
  AND to_file_version = 3 
  AND event_type = 'REMOVED';
```

### **Change Analysis**
```sql
-- Compare any two versions
SELECT 
  v1.property_composite_keys as version_1_properties,
  v2.property_composite_keys as version_2_properties,
  array_length(v1.property_composite_keys, 1) as v1_count,
  array_length(v2.property_composite_keys, 1) as v2_count
FROM source_file_versions v1, source_file_versions v2
WHERE v1.job_id = 'job-uuid' AND v1.file_version = 1
  AND v2.job_id = 'job-uuid' AND v2.file_version = 2;
```

## 🔄 **Integration with Current System**

### **FileUploadButton Changes**
1. When processing a new file:
   - Store complete file in `source_file_versions`
   - Calculate property changes vs previous version
   - Record lifecycle events
   - Update `property_records` as usual

### **Comparison Logic Updates**
```javascript
// OLD: Compare against mixed-version database
const dbRecords = await supabase.from('property_records')...

// NEW: Compare against specific file version
const previousVersion = await supabase
  .from('source_file_versions')
  .select('property_composite_keys, file_content')
  .eq('job_id', jobId)
  .eq('file_version', currentVersion - 1);
```

### **Automatic Sync Changes**
- Automatic sync only reprocesses existing version (no new version)
- No new entries in `source_file_versions`
- No lifecycle events recorded

## 🎯 **Benefits**

1. **Complete Historical Reconstruction** - Can rebuild any previous state
2. **Accurate Comparisons** - Compare against specific versions, not mixed data
3. **Property Lifecycle Tracking** - Know exactly when properties were added/removed
4. **Audit Trail** - Full change history with timestamps
5. **Cleanup Capability** - Can safely remove truly deleted properties
6. **Performance** - Indexed queries for common operations

## 🚧 **Implementation Steps**

1. **Create tables** (SQL)
2. **Update processors** to populate `source_file_versions`
3. **Update FileUploadButton** to calculate lifecycle events  
4. **Update comparison logic** to use versioned data
5. **Add cleanup mechanism** for removed properties
6. **Add UI for version history**

## 📊 **Storage Impact**

**Current**: Duplicated `raw_data` per property (~590 properties × JSON)
**New**: Complete file stored once per version (1 file × version)

**Result**: Significantly reduced storage while gaining complete lineage tracking!
