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

**Rollback:** restore the old condition in `App.js:checkSession` and redeploy.
The Builder dev environment keeps auto-logging in as admin regardless, so there
is no lock-out scenario.

---

## 4. Supabase dashboard items (manual)

- [x] Site URL → `https://lojikre.com`; added to Redirect URLs.
      (`www` handled by a GoDaddy redirect. `production-black-seven.vercel.app`
      stays in the list — it is the main-branch deployment, not dead.)
- [ ] Email OTP expiration → 3600s or less (`auth_otp_long_expiry`)
- [ ] Leaked password protection → on (`auth_leaked_password_protection`)
- [ ] Postgres security upgrade — has downtime, schedule deliberately

---

## 5. Next: RLS

### Phase A — enable everywhere, authenticated-only

One tracked migration: RLS on across all public tables with an
authenticated-only policy each. Clears every ERROR-level advisor and shuts off
anon access. Signed-in behavior is unchanged because the app already scopes its
own queries. Reversible per table.

Current advisor state: 40 tables with RLS disabled, 8 more with policies written
but RLS never enabled (dead weight — the source of the resource warning), 1
SECURITY DEFINER view (`job_assignments_with_employee`), 10 functions with
mutable `search_path`, and `delete_organization_cascade` executable by `anon`.

### Phase B — org scoping

Backfill `employees.auth_user_id` (only Jim's is set today), add a
`SECURITY DEFINER` helper resolving `auth.uid()` → org set + admin flag, then
scope the tenant tables. Test each with JWT impersonation
(`set local role authenticated` + `request.jwt.claims`) before committing.

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
