# Supabase Resource Exhaustion - Fix Plan

## Overview
Your Supabase project is showing "exhausting multiple resources" warning. Root cause: **RLS policies are defined but not enabled**, causing unnecessary overhead.

---

## Quick Fix (Immediate - Do This First)

### Delete Unused RLS Policies
Since RLS is disabled on your tables, the policies are just dead weight. Removing them will free up resources without touching app code.

**Steps:**
1. Go to Supabase Dashboard → SQL Editor
2. Run queries to disable/drop policies on these tables:
   - `appeal_log`
   - `employees`
   - `job_assignments`
   - `jobs`
   - `payroll_periods`
   - `planning_jobs`
   - `profiles`
   - `property_records`
3. Also check: `job_access_grants`, `property_class_changes`, `organizations`, `job_custom_brackets`, `checklist_documents`, `checklist_item_status`, `billing_events`, and others listed in the Advisors output

**Timeline:** ~30 minutes  
**Risk:** None - RLS not enabled anyway  
**Expected Result:** "Exhausting resources" warning should disappear

---

## Medium-Term Fixes (When You Have Time)

### 1. Remove Unused Indexes
You have 60+ unused indexes eating storage and slowing down writes.

**Examples:**
- `idx_property_market_analysis_new_vcs`
- `idx_property_market_analysis_location`
- `idx_jobs_project_start_date`
- `idx_source_file_versions_job_version`
- `idx_final_valuation_job`
- Plus ~50 more...

**Timeline:** 1-2 hours  
**Impact:** Reclaim storage, improve write performance

### 2. Add Missing Indexes to Foreign Keys
~12 foreign key constraints don't have covering indexes, impacting query performance.

**Examples:**
- `checklist_item_status.checklist_item_status_client_approved_by_fkey`
- `job_access_grants.job_access_grants_source_job_id_fkey`
- `jobs.jobs_archived_by_fkey`
- `property_records.property_class_changes_changed_by_fkey`

**Timeline:** 1-2 hours  
**Impact:** Faster queries

### 3. Fix Duplicate Indexes
Two tables have duplicate indexes that can be consolidated:

- `property_market_analysis`: `idx_pma_job_composite`, `property_market_analysis_job_id_property_composite_key_key`, `property_market_analysis_job_property_unique`
- `property_records`: `idx_property_records_assignment_filter`, `idx_property_records_job_assigned`

**Timeline:** 30 minutes  
**Impact:** Storage savings

### 4. Update PostgreSQL
Current version: `supabase-postgres-17.4.1.074` has security patches available.

**Timeline:** 15 minutes (usually)  
**Impact:** Security improvements

---

## Long-Term (When Building for Production)

### Enable RLS Properly
Don't tackle this until you're ready for production. You'll need to:
1. Define proper RLS policies aligned with your app logic
2. Enable RLS on critical tables
3. Test thoroughly before going live

This is a larger refactor but necessary for security in production.

---

## Priority Order

1. ✅ **Delete RLS policies** (tonight or tomorrow - 30 min)
2. 🔄 **Remove unused indexes** (this week - 1-2 hours)
3. 🔄 **Add foreign key indexes** (this week - 1-2 hours)
4. 🔄 **Fix duplicates** (this week - 30 min)
5. 🔄 **Update PostgreSQL** (next week - 15 min)
6. 🚀 **Enable RLS for production** (when going live - TBD)

---

## Notes

- Advisors output shows 90+ lint issues total, but the above covers the main resource hogs
- RLS disabled is fine for development/small scale - this is common during iteration
- Once you remove policies, you should be able to operate normally without "exhausting resources" warnings
