### Supabase Storage Buckets

The system uses Supabase Storage for file uploads and document management. These are NOT database tables but cloud storage buckets.

#### **checklist-documents**
**Used by:** ManagementChecklist.jsx

**Purpose:** Stores uploaded documents for checklist items (contracts, tax maps, brochures, etc.)

**Structure:**
```
checklist-documents/
├── {job_id}/
│   ├── {checklist_item_id}/
│   │   ├── contract_signed_client.pdf
│   │   ├── tax_map_approved.pdf
│   │   └── initial_letter_v2.pdf
│   └── {checklist_item_id}/
│       └── document.pdf
```

**Access Pattern:**
```javascript
// Upload
const { data, error } = await supabase.storage
  .from('checklist-documents')
  .upload(`${jobId}/${checklistItemId}/${fileName}`, file);

// Download/List
const { data, error} = await supabase.storage
  .from('checklist-documents')
  .list(`${jobId}/${checklistItemId}`);
```

**Database Integration:**
- File paths stored in `checklist_documents.file_path`
- Metadata (file_name, file_size, uploaded_at) stored in `checklist_documents` table
- Deletion cascades when job is deleted

**Policies:**
- Authenticated users can upload
- Users can only access files for jobs they have access to
- Public access disabled

#### **hr-documents** (Public Bucket)
**Used by:** EmployeeManagement.jsx (static reference)

**Purpose:** Stores HR forms and employee handbook (public access)

**Structure:**
```
hr-documents/
├── employee-handbook.pdf
├── i9-form.pdf
└── time-off-request-form.pdf
```

**Access Pattern:**
- Static files referenced via public URLs
- No authentication required
- Files served directly from public/ folder (not Supabase Storage in practice)

### Database Views

The system uses database views to simplify complex queries. Views are virtual tables created from SELECT queries.

#### **current_properties** (Not yet implemented)
**Purpose:** Filter to most recent file version properties only

**Intended SQL:**
```sql
CREATE VIEW current_properties AS
SELECT p.*
FROM property_records p
INNER JOIN (
  SELECT job_id, MAX(file_version) as max_version
  FROM property_records
  GROUP BY job_id
) latest ON p.job_id = latest.job_id 
          AND p.file_version = latest.max_version;
```

**Usage:**
- Simplifies queries that need "current" data only
- Excludes historical/superseded versions
- Performance optimization for common queries

**Status:** Referenced in code but not yet created

#### **job_assignments_with_employee** (Not yet implemented)
**Purpose:** Join job_assignments with employee information

**Intended SQL:**
```sql
CREATE VIEW job_assignments_with_employee AS
SELECT 
  ja.*,
  e.first_name,
  e.last_name,
  e.email,
  e.inspector_type,
  e.employment_status,
  (e.first_name || ' ' || e.last_name) as full_name
FROM job_assignments ja
LEFT JOIN employees e ON ja.employee_id = e.id;
```

**Usage:**
- Eliminates repeated joins in AdminJobManagement
- Provides employee context for assignments
- Simplifies React component queries

**Status:** Referenced in code but not yet created

**Implementation Note:** These views should be created in a migration script to improve query performance and simplify component code.

### Missing Table Clarifications

#### **payroll_entries** - Intentionally Not Implemented
**Status:** Deleted/Never Fully Implemented

**Why:** The system uses Excel + ADP for detailed payroll processing. Only payroll_periods tracks high-level data.

**Alternative:** 
- `payroll_periods` table tracks period metadata
- `inspection_data` table tracks individual inspection counts for bonus calculations
- Excel exports from PayrollManagement contain the detailed "entries"

**References in Code:**
- Mentioned in comments as "future enhancement"
- Not actually queried or used
- Can be safely ignored

#### **property_change_log** - Partially Commented Out
**Status:** Experimental/Not Active

**Purpose:** Was intended to track property-level changes over time

**Why Removed:**
- `comparison_reports` provides better change tracking
- `source_file_versions` tracks file-level history
- Property-level changelog was too granular and caused performance issues

**Current Status:**
- Some commented-out code references remain
- Should be fully removed in future cleanup
- Not used in any active features

