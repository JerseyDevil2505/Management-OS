#### **source_file_versions** ✅ ACTIVE TABLE
**Component:** Used in job deletion cascade, file version tracking

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs table |
| file_version | integer | Version number for tracking updates |
| upload_date | timestamp with time zone | When file was uploaded |
| uploaded_by | uuid | User who uploaded the file |
| file_type | text | 'source' or 'code' |
| file_name | text | Original filename |
| record_count | integer | Number of records in this version |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Purpose:**
- Tracks file upload history per job
- Enables version comparison in comparison_reports
- Used in cascade deletion when jobs are deleted
- Supports rollback functionality

**⚠️ Previously Listed as Deleted:** This table was incorrectly listed as deleted in earlier documentation. It remains ACTIVE and is used in:
- Job deletion cascade (jobService.deleteJob)
- File version tracking in FileUploadButton
- Comparison report generation

