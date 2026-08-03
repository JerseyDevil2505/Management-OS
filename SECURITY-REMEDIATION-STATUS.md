# Security Remediation — Status & Next Steps

Session date: 2026-08-02. Supabase project `zxvavttfvpsagzluqqwn`.
Companion to `SUPABASE_RESOURCE_FIX.md` (the original RLS plan, still accurate
on the advisor inventory).

Everything below is committed to the branch but **not yet deployed**. Nothing in
the RLS project has started.

---

## 1. Shipped in this branch (code)

### 1.1 Dev auto-login no longer bypasses authentication

`src/App.js` (`checkSession`)

Was: auto-login as the primary owner when the hostname matched any of a list
(`production-black-seven`, `preview`, `builder.io`, …) **or** when the URL
carried `?dev=true`. That made `<any-deployed-url>/?dev=true` a full admin
session for anyone, with no password.

Now: gated on `process.env.NODE_ENV !== 'production'` only, and the query-string
escape hatch is explicitly refused.

- Builder preview and localhost still auto-login (they run `npm start`).
- Any Vercel production build now requires a real sign-in. **This includes
  black-seven**, which previously relied on the hostname match.

### 1.2 Login resolves identity by auth ID, then email

`src/components/LandingPage.jsx`, `src/App.js`, `src/lib/supabaseClient.js`
(`authHelpers.getCurrentUser`)

All three did `.eq('email', …).single()` against `employees`. The admin account's
auth email is `dudj23@gmail.com` but its employee row is `ppalead1@gmail.com`, so
a real sign-in authenticated and then failed with "Employee record not found."

Now: `.or('auth_user_id.eq.<uid>,email.eq.<email>').limit(1).maybeSingle()`.

Verified in SQL that this resolves to the Jim Duda row. The other 20 users have
a null `auth_user_id`, so they still match on email — no behavior change.

### 1.3 Self-service password recovery

- `src/components/ResetPassword.jsx` (new) — set-new-password screen, min 8
  chars, signs out afterward so the new password is used on next sign-in.
- `src/components/LandingPage.jsx` — "Forgot password?" calls
  `resetPasswordForEmail` with `redirectTo: window.location.origin`.
- `src/App.js` — `recoveryMode` state, set from a `#type=recovery` hash or the
  `PASSWORD_RECOVERY` auth event, rendered ahead of everything else.
- `src/components/LandingPage.css` — `.forgot-password-link`,
  `.reset-sent-message`.

Previously no recovery handling existed at all, which is why recovery links
silently signed people in and never offered a password field (Dawn's bug).

**Never executed end to end.** Compiles only.

### 1.4 Plaintext passwords removed

Three write sites deleted (`App.js` change-password, `UserManagement` create user
and reset password). No read sites existed — nothing in the UI displayed it.

### 1.5 Landing page

Removed the "For Professional Property Appraisers" tagline. The `.tagline` and
`.title-group` CSS rules are now unused but left in place.

---

## 2. Shipped already (live, not gated on deploy)

### 2.1 `update-user-password` edge function — v4

Source now tracked at `supabase/functions/update-user-password/index.ts`.

The deployed v3 accepted the **publishable/anon key as authorization** and then
used `service_role` to set any user's password by email. Anyone who read the key
out of the JS bundle could take over any account, unauthenticated.

v4: `verify_jwt` on, anon-key branch removed, caller must be a signed-in user
whose `profiles.role = 'admin'`, minimum 8 characters, resets logged.

Verified after deploy:

| Request | Result |
|---|---|
| No auth header | 401 `UNAUTHORIZED_NO_AUTH_HEADER` |
| Garbage bearer token | 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` |
| Publishable key (the real attack) | 401 `Unauthorized` |

Side effect: the Users-tab reset button will not work from the Builder preview
(dev mode has no real session). It works from a deployed build when signed in.

### 2.2 Migration `remove_plaintext_employee_passwords`

Nulled 74 stored cleartext passwords, then dropped `employees.initial_password`.
All 81 employee rows otherwise intact.

### 2.3 Deleted stale auth user

`richard.carabelli@franklinnj.gov` — never signed in, never confirmed, retired.

---

## 3. ✅ Deployed and verified — login works

Verified live: recovery email → `ResetPassword` screen → new password →
signed in as `dudj23@gmail.com` with admin access. This closes 1.2 and 1.3
(the `.or(auth_user_id, email)` lookup resolves the Jim Duda employee row, and
self-service password recovery works end to end).

### 3.1 Dev auto-login removed entirely

`src/App.js` (`checkSession`) no longer fakes a session in dev. It used to set
`user` in React state without ever calling Supabase auth, which meant the
database connection ran as **anon** in the Builder preview and on localhost.
That is fine while RLS is off, but any `authenticated`-scoped policy would have
returned zero rows in the preview while working correctly in production —
untestable, and the kind of gap that gets discovered after deploy.

All environments now require a real sign-in. Verified in the preview: signing in
as `dudj23@gmail.com` loads the full job list and the complete nav.

No access regression for Jim: `isAdmin` (`App.js:231`) already accepts `owner`,
and `canManageUsers` (`App.js:235`) keys off the user UUID, which matches the
auth ID.

**Rollback:** re-add the `process.env.NODE_ENV !== 'production'` block that set
a hardcoded `user` object and returned early.

---

## 4. Supabase dashboard items (manual)

- [x] Site URL → `https://lojikre.com`; added to Redirect URLs.
      (`www` handled by a GoDaddy redirect. `production-black-seven.vercel.app`
      stays in the list — it is the main-branch deployment, not dead.)
- [x] **Anonymous sign-ins → disabled.** It was **enabled**. An anonymous
      session carries the `authenticated` role, so anyone could have minted one
      and passed every `to authenticated` policy — during the Phase A window
      that meant full read of all 331k property records. Phase B independently
      closed it (an anonymous user has no `employees` row, so `app_is_staff()`
      is false and `app_job_ids()` is empty), but it was open before today.
      Checked `auth.users`: **0 anonymous users ever created**, so nothing was
      exploited.
- [x] Email OTP expiration → was **86400** (24 hours), set to 3600.
      This governs all email one-time tokens: magic links, signup confirmation,
      email change, and **password recovery**. Recovery links were live for a
      full day in the recipient's inbox.
- [ ] Leaked password protection → on (`auth_leaked_password_protection`)
- [ ] Postgres security upgrade — has downtime, schedule deliberately

### ⚠️ Noted, not changed — `handle_new_user` defaults new profiles to PPA

```sql
coalesce((new.raw_user_meta_data->>'organization_id')::uuid,
         '00000000-0000-0000-0000-000000000001'::uuid)
```

Any auth account created without an explicit `organization_id` in its metadata
gets a `profiles` row inside **PPA Inc**. Harmless today because access is
resolved from `employees`, not `profiles` — but it becomes a privilege-escalation
path the moment a policy keys off `profiles.organization_id`. Left as-is rather
than change working signup behavior; revisit before writing any such policy.

---

## 5. Next: RLS

### Phase A — ✅ APPLIED (2026-08-03)

RLS is on across **all 48** public tables, each with a single
`authenticated_full_access` policy (`for all to authenticated using (true) with
check (true)`). The anon role now has no table access. Signed-in behavior is
unchanged because the app already scopes its own queries. Org/job scoping is
Phase B.

Two migrations:

1. `phase_a_rls_canary_county_hpi_data` — one table first, to prove the pattern.
   Verified by role-switch probe: anon saw 0 rows, authenticated saw 541. Jim
   confirmed the County HPI tab still reads *and* writes.
2. `phase_a_rls_all_public_tables` — the remaining 47. Driven off `pg_class` in
   a `DO` loop rather than a hand-typed list, so nothing was missed.

That second migration also **replaced the policies on the three tables that
already had RLS enabled**. `job_cme_result_sets`, `job_cme_bracket_mappings`,
and `job_sales_pool_overrides` each had `USING (true)` policies targeting
`public` — so they read as protected on the dashboard while anon could read and
write them. Do not assume "RLS enabled" means closed; check `polroles`.

Post-migration verification (role-switch probe, `set local role`):

| Table | anon sees | signed-in sees |
|---|---|---|
| property_records | 0 | 331,447 |
| appeal_log | 0 | 2,487 |
| employees | 0 | 81 |
| jobs | 0 | 55 |
| billing_events | 0 | 275 |
| profiles | 0 | 21 |

Writes confirmed blocked too: `insert into employees` as `anon` raised, and no
row landed.

Catalog check after: 0 tables unprotected, 48 protected, 0 unexpected policies.

Both edge functions (`recalculate-amenities`, `update-user-password`) use
`SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS — unaffected. The anon key in
`update-user-password` is only used to verify the caller's JWT.

**Rollback per table:**

```sql
alter table public.<t> disable row level security;
drop policy if exists "authenticated_full_access" on public.<t>;
```

#### Storage — `phase_a_storage_authenticated_only`

Tables were only half the exposure. All 16 `storage.objects` policies granted
`anon` select/insert/update/**delete** on every bucket, and
`checklist-documents` was a **public** bucket (reachable by URL with no key at
all). Four of the policies were named `Allow All For Testing eh7235_*`.

What was open: 1,562 files / ~2.1 GB — 386 appeal report PDFs (1.6 GB, the
valuation and appeal-strategy work product), 992 appeal photos, 97 checklist
documents (tax maps, zoning maps, brochures, contact letters), 87 PowerComp
packets. Readable *and deletable* by anyone who pulled the publishable key out
of the JS bundle.

Now one `for all to authenticated` policy per bucket, and all four buckets
private. Verified: anon sees 0 objects, authenticated sees 1,562.

Safe because every read path already uses `createSignedUrl`, which works on
private buckets — `AppealLogTab` (appeal-photos, powercomp-photos),
`ParcelPhotoStrip` (appeal-photos), `ManagementChecklist` (checklist-documents,
1h expiry). The one `getPublicUrl` call (`ManagementChecklist.jsx:1446`) is a
third-resort fallback behind `createSignedUrl` and `.download()`; it is now dead
but harmless, and was left in place rather than churn working code.

Current advisor state: 40 tables with RLS disabled, 8 more with policies written
but RLS never enabled (dead weight — the source of the resource warning), 1
SECURITY DEFINER view (`job_assignments_with_employee`), 10 functions with
mutable `search_path`, and `delete_organization_cascade` executable by `anon`.

#### ⚠️ `employees.role` is NOT a valid admin signal

Audited 2026-08-03. `employees.role` contains `Admin` for **11 rows**, and all
eleven are assessor clients (Dawn Guttschall/Dunellen, Chris Murray/Orange,
Peter Maher/Jackson, Lisa Stephens/Piscataway, …). Any policy keyed off
`employees.role = 'Admin'` hands every town assessor full cross-tenant access.

`profiles.role` is the trustworthy field: exactly one `admin`
(`ppalead1@gmail.com` = Jim, auth email `dudj23@gmail.com`), all other 20 are
`viewer`. Phase B policies key off `profiles.role`.

**Resolved** — migration `rename_assessor_employee_role_to_lojik_user` collapsed
`Admin` (11) and `client_user` (1) into `lojik_user` (12). Internal staff keep
their job-function roles (Residential 40, Commercial 10, Management 8, Clerical
8, Owner 3), so `employees.role` no longer contains any value that `isAdmin`
matches for a non-PPA user. Rollback SQL is in the migration body.

Code landed with it, and the DB change is not safe without it:

- `UserManagement.jsx:92` filters the Users list by
  `role in ('Management','Admin','Owner','client_user')`. Renaming without this
  edit would have silently dropped all 12 client accounts off the Users screen
  while leaving them able to sign in.
- `UserManagement` create flow only renders the Role dropdown for PPA orgs, so
  client accounts inherited the form default (`'Admin'`) — that is how all 11
  got the value. Now forced to `lojik_user` via `roleToSave`, and `Admin` is
  gone from both dropdowns.
- `App.js:1720` rendered `<UserManagement>` behind `isAdmin` while its nav
  button used `canManageUsers`. Two rules on one door; now both `canManageUsers`.

Owners, for the record: Jim Duda (only one who signs in), Brian Schneider (last
sign-in 2025-09-16), Tom Davis (employee row, no auth account at all). User
Management is additionally gated to Jim's UUID alone.

#### Step 1 (applied) — drop the 18 inert legacy policies

All 18 sat on tables with RLS **disabled**, so they were never enforced and
dropping them changed no runtime behavior. Seven granted write access to
`PUBLIC` (which includes `anon`) — including insert and update on `employees`,
the table sign-in reads to resolve a user's role. They would have become live
grants the moment RLS was enabled on those tables.

**Restore SQL** (only needed to undo this step; Phase A replaces them anyway):

```sql
create policy "Authenticated users can manage appeal_log" on public.appeal_log
  as permissive for all to authenticated using (true) with check (true);

create policy "Allow all access to employees" on public.employees
  as permissive for all to authenticated using (true);
create policy "Allow authenticated reads" on public.employees
  as permissive for select to authenticated using (true);
create policy "Allow authenticated inserts" on public.employees
  as permissive for insert to authenticated with check (true);
create policy "Allow authenticated updates" on public.employees
  as permissive for update to authenticated using (true);
create policy "Allow authenticated deletes" on public.employees
  as permissive for delete to authenticated using (true);
create policy "Allow public insert" on public.employees
  as permissive for insert to public with check (true);
create policy "Allow public update" on public.employees
  as permissive for update to public using (true);

create policy "Users can view job assignments" on public.job_assignments
  as permissive for select to public using (true);
create policy "Managers can create job assignments" on public.job_assignments
  as permissive for insert to public with check (auth.role() = 'authenticated');

create policy "Users can view PPAs" on public.jobs
  as permissive for select to public using (true);
create policy "Users can update jobs" on public.jobs
  as permissive for update to public using (true) with check (true);
create policy "Authenticated users can create PPAs" on public.jobs
  as permissive for insert to public with check (auth.role() = 'authenticated');

create policy "Allow all access to payroll_periods" on public.payroll_periods
  as permissive for all to authenticated using (true);

create policy "Allow public read access" on public.planning_jobs
  as permissive for select to public using (true);

create policy "Users can view own profile" on public.profiles
  as permissive for select to public using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  as permissive for update to public using (auth.uid() = id);

create policy "Allow all access to property_records" on public.property_records
  as permissive for all to authenticated using (true);
```

Note for Phase A: `profiles` only ever had own-row policies. Enabling RLS there
without a replacement breaks `UserManagement`, which lists all 21 profiles.

Post-cleanup advisor state: 45 `rls_disabled_in_public` ERRORs (Phase A's job),
and zero policies remain on RLS-disabled tables.

Also surfaced — the three tables that *do* have RLS on are not actually closed.
`job_cme_result_sets`, `job_cme_bracket_mappings`, and `job_sales_pool_overrides`
each have `USING (true)` policies granted to `public`, so `anon` can read and
write them. Same for the `appeal_photos_*` policies on `storage.objects` and the
`checklist-documents` bucket's broad SELECT. These need rewriting in Phase A,
not just left alone because the table shows "RLS enabled".

### Phase B — ✅ APPLIED (2026-08-03)

#### Step 1 — `phase_b_backfill_employee_auth_user_id`

Only 1 of 81 employees had `auth_user_id` set, so the DB could not resolve
`auth.uid()` → employee → org. All 20 unlinked auth users matched exactly one
employee by email (verified before running). Now 21/21 linked, 0 orphans, 0
duplicates. Side benefit: `App.js:1180`'s `.or(auth_user_id, email)` lookup now
hits the ID branch for everyone instead of falling through to email.

#### Step 2 — `phase_b_identity_helper_functions`

`app_is_admin()`, `app_is_staff()`, `app_org_ids()`, `app_job_ids()`. All
`stable security definer set search_path = public, pg_temp`, `execute` revoked
from `anon`.

SECURITY DEFINER is load-bearing, not decorative: these read `profiles` and
`employees`, which themselves carry policies that call these functions. Running
as the owner (who bypasses RLS) is what prevents infinite recursion.

`app_org_ids()` unions the primary `organization_id`, the
`employee_organizations` junction, and the legacy `accessible_organization_ids`
array. All three are live: Dawn → Dunellen + Middlesex via the junction, Rich's
`rbuscemi29@` → Waterford + Runnemede + Springfield, Ron → +Maplewood +Jackson
via the array.

#### Step 3 — the policies

| Group | Tables | Rule |
|---|---|---|
| Money | billing_events, job_contracts, payroll_periods, expenses, office_receivables, shareholder_distributions, proposals | admin only |
| Job data | 30 tables incl. property_records, property_market_analysis, inspection_data, appeal_log, all `job_cme_*`, checklist, market_land_valuation | staff, or own job |
| Identity | jobs, employees, employee_organizations | staff, or own org |
| organizations | | read: staff or own org · write: admin |
| profiles | | read: self or admin · write: admin |
| user_billed_jobs | | self or admin |
| No tenant column | employee_status_history, job_access_grants | staff only |
| Reference | county_hpi_data, nu_code_dictionary | any authenticated |

`planning_jobs` deliberately stays open to all authenticated — it drives the
"Planning Jobs" tab on the Jobs screen that staff use, even though `App.js:725`
loads it inside the billing block. Confirmed with Jim.

`user_billed_jobs` is named like a billing table but is the per-user "I billed
this" toggle on `AppealsSummary` (`user_id = auth.uid()`). Admin-only would have
broken every staffer's checkboxes.

#### ⚠️ The performance trap — `phase_b_fix_rls_per_row_function_calls`

The first version of these policies was **correct and unusable**. Written as:

```sql
using (public.app_is_staff() or job_id = any (public.app_job_ids()))
```

the planner emitted `Filter: (app_is_staff() OR (job_id = ANY (app_job_ids())))`
— a **per-row** call. On `property_records` that is 331,447 invocations of two
SECURITY DEFINER functions, each running its own subqueries. A plain
`select count(*)` as a client user **timed out**.

`STABLE` is not sufficient. A SECURITY DEFINER function cannot be inlined, so
the planner leaves it in the row filter. The fix is to force an InitPlan by
putting each call behind an uncorrelated subquery:

```sql
using ((select public.app_is_staff()) or job_id in (select unnest(public.app_job_ids())))
```

Result: `InitPlan 1` + `hashed SubPlan 2`, both evaluated once. Same query,
**121 ms**.

Do not write a helper call bare in a policy predicate. Always
`(select fn())`, and `in (select unnest(fn()))` for the array case — note
`= any((select fn()))` fails outright with `operator does not exist: uuid =
uuid[]`, because ANY-over-subquery expects rows and the function returns one
array value.

#### Verification (JWT impersonation)

| Person | jobs | employees | properties | appeals | billing |
|---|---|---|---|---|---|
| Jim (admin) | 55 | 81 | 331,447 | 2,487 | 275 |
| Ron (PPA staff) | 55 | 81 | 331,447 | 2,487 | **0** |
| Jim @ Riverton | 1 | 1 | 2,024 | 0 | 0 |
| Dawn (2 towns) | 2 | 1 | 7,376 | 32 | 0 |
| Rich @ Waterford (3 towns) | 3 | 1 | — | — | 0 |
| Catherine @ Franklin | 1 | **2** | — | — | 0 |
| Novelette @ Atlantic City | 1 | 1 | 16,826 | 1,269 | 0 |

Catherine seeing 2 employees is correct — she and John Gillooly are both
Franklin.

#### Step 4 — `secure_delete_organization_cascade` (the worst find of the day)

`delete_organization_cascade(org_id)` deletes an entire tenant: every job and
all its `property_records`, `inspection_data`, appeals, valuations, CME data,
then the employees, profiles and the organization row. It is SECURITY DEFINER,
so **RLS never applied to it**, and `EXECUTE` was granted to `anon`.

An unauthenticated caller with the publishable key could have destroyed
Atlantic City (16,826 properties, 1,269 appeals) via
`/rest/v1/rpc/delete_organization_cascade`. Any signed-in client assessor could
have targeted PPA's org id and taken out all 41 jobs.

Three fixes: a hard `app_is_admin()` guard inside the function body (so the
protection does not depend on the UI gate or on grants staying correct),
`EXECUTE` revoked from `anon`/`public`, and `search_path` pinned. Verified: Dawn
attempting to cascade-delete PPA Inc raises `insufficient_privilege`, and all
15 orgs / 55 jobs / 331,447 properties remained intact.

`handle_new_user()` had `EXECUTE` to anon too. It is an auth trigger — triggers
fire regardless of grants — so exposing it as an RPC endpoint had no purpose.
Revoked from all API roles.

#### Step 5 — `harden_view_and_function_search_paths`

`job_assignments_with_employee` was a SECURITY DEFINER view joining
`job_assignments` to `employees`. Views run with their creator's rights by
default, so it **bypassed every policy in Phase B** — a client assessor could
have listed every assignment and employee name across all 15 orgs through it.
Not referenced anywhere in `src/`, so it was switched to
`security_invoker = true` rather than dropped.

Lesson: a view is a hole in RLS unless it is explicitly `security_invoker`.
Audit `pg_class.reloptions` for any new view.

`search_path` pinned on the remaining 10 functions.

#### Step 6 — `tighten_helper_grants_and_reference_tables`

`revoke execute ... from anon` on the helpers was **not sufficient** — Postgres
grants `EXECUTE` to `PUBLIC` on every new function and `anon` inherits it. Had
to `revoke ... from public` then `grant ... to authenticated`. Authenticated
must keep EXECUTE: policy expressions are evaluated as the calling role.

`county_hpi_data`, `nu_code_dictionary` and `planning_jobs` had blanket
read+write for any signed-in user. Split: read stays open (all three feed
screens everyone uses), writes narrowed to staff. Verified — all roles read 545
HPI rows; admin and staff update 1 row; Dawn's update affects 0 rows (RLS
filters UPDATE silently, no error).

#### Step 7 — `move_rls_helpers_to_private_schema`

The four helpers lived in `public`, so PostgREST published them as
`/rest/v1/rpc/app_is_admin` etc. No data leak — each only reports the caller's
own standing — but Supabase emails org owners a weekly advisory summary that
[includes warnings](https://supabase.com/blog/hardening-supabase) and offers no
way to acknowledge or mute a finding.

Moved to a `private` schema, which PostgREST does not expose. `usage` granted to
`authenticated` only; `execute` revoked from `public` and `anon`. Policies still
resolve them normally. All ~45 policies repointed, then the `public` copies
dropped (they cannot be dropped while a policy depends on them).

`delete_organization_cascade` stays in `public` — the app calls it via
`supabase.rpc()`. Its guard now calls `private.app_is_admin()`. It was later
converted to SECURITY INVOKER (see below), which cleared its advisory too.

Re-verified after the move, identical to before: same per-user counts, same
plan (`InitPlan` + `hashed SubPlan`, 118 ms on property_records), Dawn's
cascade-delete attempt still blocked, 0 leftover `public.app_*` functions.

#### Step 5 — `delete_organization_cascade` → SECURITY INVOKER

The last function advisory was not about the grant, it was about the
combination: SECURITY DEFINER **and** reachable at `/rest/v1/rpc`. Deleting a
job raises no advisory because it is a plain `DELETE` that RLS evaluates
normally; only the org delete went through a definer function that ran as the
owner and skipped RLS entirely.

That privilege escalation was unnecessary. Every one of the 32 tables the
function touches already has an admin-passing policy for `ALL`/`DELETE`
(`app_is_admin` implies `app_is_staff`), so an admin caller can perform each
delete under their own rights. Converted with
`delete_organization_cascade_security_invoker`:

```sql
CREATE OR REPLACE FUNCTION public.delete_organization_cascade(org_id uuid)
  ... SECURITY INVOKER SET search_path TO 'public','pg_temp'
```

The in-function `private.app_is_admin()` guard was kept. Without it a PPA staff
user would delete the jobs and their property records but stall on
`organizations`/`profiles` (admin-only), leaving a half-deleted tenant. The
guard fails the whole call before anything is touched.

RLS is now the real enforcement rather than a hand-written check inside a
privileged function — the delete behaves exactly like deleting a job.

Verified end to end on two throwaway orgs (both cleaned up):

| Caller | Outcome |
|---|---|
| Jim (admin, impersonated) | org deleted, 0 rows remaining |
| Client assessor (impersonated) | rejected, org still present |
| anon | `42501` at the grant level |

Grants unchanged: `authenticated` + `service_role` + owner, `anon` revoked.

#### Step 6 — split the admin `FOR ALL` policies off SELECT

`organizations` and `profiles` each carried two permissive policies that
overlapped on SELECT: a read policy plus an admin policy declared `FOR ALL`
(which includes SELECT). Postgres must evaluate every permissive policy and OR
the results, so each read paid for a redundant `app_is_admin()` check that the
read policy already covered.

Fixed by `split_admin_all_policies_off_select` — the two `FOR ALL` policies were
replaced with explicit INSERT / UPDATE / DELETE policies (same
`(select private.app_is_admin())` predicate, `USING` + `WITH CHECK` on UPDATE).
SELECT is now served by exactly one policy per table.

No access change — both read policies already admitted admins
(`app_is_admin` implies `app_is_staff`; `profiles_self_read` is
`id = auth.uid() OR app_is_admin()`). Re-verified by impersonation:

| Caller | organizations | profiles |
|---|---|---|
| Jim (admin) | 15 | 21 |
| PPA staff | 15 | 1 |
| Client assessor | 1 | 1 |

Admin insert/update/delete on `organizations` all succeed; client insert is
rejected. Test rows cleaned up.

**Apply this shape to any new table:** never use `FOR ALL` alongside a separate
SELECT policy. Write the admin side as INSERT/UPDATE/DELETE.

#### Advisor state — final

**Zero ERROR-level lints. One WARN:** `vulnerable_postgres_version`, which
clears when the patch is scheduled. Nothing else outstanding.

Performance advisor: zero WARNs. What remains is all INFO and pre-dates this
work — unindexed foreign keys, unused indexes, and the Auth connection
allocation strategy. None are caused by RLS. Triaged below.

### Index triage (INFO-level performance lints)

#### `unindexed_foreign_keys` (18) — ignore permanently

The linter does not weigh table size. Every table it flags is tiny:
`job_cme_evaluations` 4,331 rows, `appeal_photos` 992, `checklist_item_status`
549, `appeal_reports` 386, `appeal_log_archives` 23, `user_billed_jobs` 8, and
`job_access_grants` / `proposals` / `property_class_changes` /
`appeal_powercomp_photos` are all **0**. The columns are `*_by` audit fields
nothing searches on. Indexing them would add write cost for a scan the planner
would skip anyway. Revisit only if one of these tables grows.

#### `unused_index` — six dropped, the rest kept

`property_records` carried 17 indexes / 263 MB against 331k rows and 1.09M
writes, so every import maintained all 17. Six indexes had **0 scans over the
full history of the database** (`pg_stat_database.stats_reset` is null, so the
counters are complete) and were dropped in
`drop_six_never_used_indexes`:

| Index | Size | Why dead |
|---|---|---|
| `idx_property_records_ncovr_pct` | 54 MB | `net_condition_pct` is read off already-fetched rows (`DetailedAppraisalGrid`, `conditionRanking.js`); never a filter |
| `idx_property_records_bedrooms` | 15 MB | `asset_bedrooms` is displayed and compared, never searched |
| `idx_property_records_file_version` | 8.5 MB | Bare `(file_version)`; queries always include `job_id`, so `idx_property_records_job_file_version` (72,203 scans) wins |
| `idx_property_records_is_assigned` | 168 kB | Superseded by `idx_property_records_job_assigned` (159 scans) |
| `idx_property_market_analysis_new_vcs` | 4 MB | That table's reads go through `idx_property_market_analysis_composite_key` (829M scans) |
| `idx_property_market_analysis_location` | 760 kB | Same |

Result: `property_records` indexes 263 MB → 186 MB (17 → 13), database
1,196 MB → 1,113 MB. Verified after: the latest-file_version lookup runs
0.19 ms on an Index Only Scan of `idx_property_records_job_file_version`, and a
full 331k-row aggregate under an admin session runs 147 ms with the RLS
predicate still hoisted (`InitPlan` + `hashed SubPlan`, never executed).

**Rebuild statements**, if any of these ever turns out to be needed:

```sql
CREATE INDEX idx_property_records_ncovr_pct ON public.property_records
  USING btree (job_id, net_condition_pct) WHERE (net_condition_pct IS NOT NULL);
CREATE INDEX idx_property_records_bedrooms ON public.property_records
  USING btree (job_id, asset_bedrooms);
CREATE INDEX idx_property_records_file_version ON public.property_records
  USING btree (file_version);
CREATE INDEX idx_property_records_is_assigned ON public.property_records
  USING btree (is_assigned_property) WHERE (is_assigned_property = true);
CREATE INDEX idx_property_market_analysis_new_vcs ON public.property_market_analysis
  USING btree (new_vcs) WHERE (new_vcs IS NOT NULL);
CREATE INDEX idx_property_market_analysis_location ON public.property_market_analysis
  USING btree (location_analysis) WHERE (location_analysis IS NOT NULL);
```

Kept despite being flagged: everything on `jobs` and `market_land_valuation`
(16–208 kB on 52- and 55-row tables — dropping them changes nothing).

**"0 scans" is not by itself a verdict.** `property_market_analysis_pkey` also
reports 0 scans at 11 MB. Always read `pg_get_indexdef` and check for a
composite that supersedes the flagged index before dropping.

**The Postgres upgrade resets these counters.** Everything will look unused for
weeks afterward. Do not re-run this triage until the database has been through a
full busy cycle post-upgrade.

##### ⚠️ History: the cascade advisory drifted twice before being fixed properly

Both times via the Supabase dashboard AI:

1. **`REVOKE EXECUTE ... FROM anon, authenticated`.** The advisory disappeared,
   but so did the feature — the Organizations delete button then failed for
   *everyone including the admin* (verified: `42501 permission denied for
   function delete_organization_cascade`). The warning went away because the
   capability went away.
2. **Re-granting** restored `anon:EXECUTE` alongside `authenticated`, reopening
   the unauthenticated `/rest/v1/rpc` surface closed earlier the same day, and
   producing *two* advisories instead of one.

Corrected by `restore_cascade_delete_authenticated_only_grant`. Verified:

| Caller | Outcome |
|---|---|
| Jim (admin) | reaches the function, guard passes |
| Dawn (client) | `42501` — rejected by the in-function guard |
| anon | `42501` — rejected at the grant level |

**Correct grant set: `authenticated` + `service_role` + owner. Leave it.** No
*grant* change removes the advisory while keeping the button working — that is
why the fix was the SECURITY INVOKER conversion above, not a revoke.

The UI gate (`App.js:1724`, Organizations restricted to Jim's UUID) is **not**
the protection. Any signed-in user can POST to
`/rest/v1/rpc/delete_organization_cascade` without ever loading the UI. The
in-function `private.app_is_admin()` guard is the only thing between a client
assessor and deleting all 41 PPA jobs. Never remove it.

Cleared along the way: 45 `rls_disabled_in_public` ERRORs, the SECURITY DEFINER
view, 10 mutable `search_path` functions, 2 anon-executable SECURITY DEFINER
functions, 4 helper-function advisories, and all
`auth_allow_anonymous_sign_ins` (anonymous sign-ins were enabled; now off).

#### Testing note — "View As" does NOT exercise RLS

`handleViewAs` swaps the user in React state; the Supabase session is still the
admin's, so the database still answers as admin. The only real tests are a
genuine sign-in or the `set local role authenticated` + `request.jwt.claims`
probe used above. Jim has a real client account (`jduda@riverton-nj.com`,
Borough of Riverton, 1 job) that can be used for a true end-to-end check.

### Access model (confirmed with Jim)

| Who | Data access |
|---|---|
| Jim (`5df85ca3…`, `profiles.role = 'admin'`) | Everything |
| PPA internal staff (8, all `viewer`) | All jobs, employees, appeals. **No** billing/payroll/revenue |
| Assessor clients (12) | Only their linked org(s) |

Billing/payroll stay admin-only — Brian Schneider last signed in 2025-09-16 and
Tom Davis has no account, so a separate "owner" tier isn't worth building.

### Things that will bite

- **Multi-org clients are real.** `employee_organizations` is the junction
  `AssessorDashboard.jsx:72-76` reads. Dawn Guttschall → Dunellen + Middlesex.
  Rich Buscemi → Runnemede + Springfield + Waterford. Policies must honor it,
  not just `profiles.organization_id`.
- `job_access_grants` (2 rows, Ron Breining) has `grantee_employee_id` with a
  null `auth_user_id` — unusable as a policy basis until backfilled.
- Admin is a **hardcoded UUID** in the frontend (`PRIMARY_OWNER_ID`, `App.js`).
  RLS should key off `profiles.role` instead so there's one source of truth.
- Each assessor org owns exactly one job; PPA Inc owns 41. Some towns exist
  twice (PPA's "Dunellen" and Dawn's "Dunellen" are different job rows).

---

## 6. Unrelated data work completed this session

- **Atlantic City** appeal log: bulk-applied judgment-code → status mapping for
  2026 (6B/6A → AWP, 3 → S, 7 → W, 5A → NA, 2B → H). 1,268 rows. Zero `D`
  remaining.
- **Raritan** 36/7 card 1: `inspection_info_by` `00` → `01`.
- **Raritan** phantom validation flags diagnosed as a stale source file
  (re-uploaded a 7/14-vintage export twice), not a code bug. Resolved by
  re-exporting from BRT.
