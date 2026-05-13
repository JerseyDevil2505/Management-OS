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

### What RLS Actually Is (Plain-English Refresher)

Row-Level Security is a Postgres feature that lets the **database** decide which
rows a connection can see or modify, instead of relying on app-side `WHERE`
clauses. With RLS off, anyone holding the anon/authenticated key can technically
read or write every row of every exposed table — the only thing keeping that
from happening is the filters our React code remembers to add. With RLS on,
every query is automatically rewritten with a scoping clause based on the
current session (typical patterns: `auth.uid() = user_id`,
`organization_id = ...`, or a join into `job_access_grants`).

In Supabase's role model:
- **anon** and **authenticated** keys go through PostgREST as low-privilege roles
  and are subject to RLS.
- **service_role** bypasses RLS entirely. It must only ever be used server-side.
- That's why the security advisor keeps flagging us — the keys we ship to the
  browser today aren't being constrained by the database.

### Why It's Off Today

Early development. Writing policies before the data model stabilized would have
been thrown-away work, and we had no production users to protect.

### Will Turning It Back On Require Code Changes?

Mostly no — RLS lives in the database, not in supabase-js calls. The work is:

1. **Audit any `service_role` usage in client code.** That key bypasses RLS, so
   if it ever leaked into the browser bundle we have to move that call to a
   server route / edge function before enabling RLS, otherwise it's the only
   real refactor risk.
2. **Confirm every existing query already has a scoping filter.** Once RLS is
   on, a query like `supabase.from('jobs').select('*')` will silently return
   only the rows the current user is allowed to see. Usually that's what we
   want — but any UI that assumed "I'm getting everything" needs to either
   become an `internal`-org-only view or get an explicit filter.
3. **Make sure `auth.uid()` is populated** anywhere the anon/authenticated key
   writes rows on a user's behalf (i.e., the user is signed in).
4. **Write the policies.** One pass per table, mirroring the
   `organization_id` / `job_id` / `job_access_grants` logic the app already
   enforces in `WHERE` clauses today. The `internal` org gets a "see all" check
   so admins keep working as they do now.

### Recommended Sequencing

1. Inventory every `service_role` usage and confirm none of it ships to the
   browser.
2. Roll out the pattern on one low-risk table first (e.g., `profiles`) — enable
   RLS, write policies, smoke test.
3. Apply the same pattern table by table, starting with the most sensitive
   (`property_records`, `appeal_log`, `employees`, `jobs`) and ending with the
   read-mostly lookup tables.
4. Advisor warnings (and the monthly vulnerability email) drop off as each
   table is enabled.

---

**Current state (audited):** 41 of 44 `public.*` tables have RLS **disabled**. The
only three with RLS enabled are the newer CME-related tables:
- `job_cme_bracket_mappings`
- `job_cme_result_sets`
- `job_sales_pool_overrides`

When the production push happens, every other table needs an RLS policy pass —
most queries are scoped by `organization_id` / `job_id` / `job_access_grants`,
so the policies should mirror that logic rather than invent new rules.

---

## Supabase Data API Default-Grant Change (May 30 / Oct 30, 2026)

Supabase is changing the default so that **new** tables in `public` are no longer
exposed to the Data API (supabase-js, PostgREST, GraphQL) unless an explicit
`GRANT` is added.

- **May 30, 2026:** default for newly-created Supabase projects.
- **Oct 30, 2026:** enforced on **all existing projects**, including ours.

**What stays safe:** every table that already exists keeps its current grants —
nothing breaks on the cutover.

**What changes for us:** any new `public.*` table created on or after Oct 30,
2026 must include explicit grants in its migration, or supabase-js will return a
`42501` error from the client.

### Required boilerplate for new-table migrations going forward

```sql
-- Whatever your CREATE TABLE statement is...
create table public.your_new_table ( ... );

-- Required: expose it to the Data API roles the app uses.
-- (anon is only needed if the table should be readable without auth.)
grant select, insert, update, delete on public.your_new_table to authenticated;
grant select, insert, update, delete on public.your_new_table to service_role;

-- Strongly recommended: enable RLS at create time so the table is never
-- briefly world-writable while we figure out policies later.
alter table public.your_new_table enable row level security;

-- Add at least one policy (example — replace with real scope):
create policy "tenant scoped read"
  on public.your_new_table
  for select to authenticated
  using ( /* org/job scoping check */ );
```

If a grant is missing in production, PostgREST returns `42501` with the exact
GRANT statement to fix it — don't paper over that error, run the grant.

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
