# Supabase Resource / RLS Plan — SUPERSEDED

> **Do not follow the instructions that used to be in this file.**
>
> This was the pre-RLS plan, written when Row Level Security was disabled. It
> told the reader to **drop the RLS policies** ("Risk: None — RLS not enabled
> anyway") and to postpone enabling RLS until "production." Both statements were
> true when written and are dangerously wrong now.
>
> **RLS has been enabled on all 48 `public` tables since 2026-08-03.** Following
> the old quick-fix would dismantle the access model protecting every town's
> data.
>
> Current state, policy map, and the rules for adding new tables/views/RPCs:
> **`SECURITY-REMEDIATION.md`**. Day-to-day rules: **`copilot-os.md`**.

## What happened to each item in the old plan

| Old item | Outcome |
|---|---|
| Delete unused RLS policies | **Reversed.** Policies were written properly and RLS enabled on all 48 tables |
| Remove unused indexes | **Done selectively.** Six never-used indexes dropped 2026-08-03; the rest were kept on purpose (most sat on tables with <100 rows). Reasoning in `SECURITY-REMEDIATION.md` |
| Add indexes to unindexed foreign keys | **Deliberately not done.** Every flagged table holds under 4,400 rows and several are empty; indexes there cost writes and would never be used |
| Fix duplicate indexes | Folded into the index triage above |
| Update PostgreSQL | **Still open.** Patch available for `supabase-postgres-17.4.1.074`, to be scheduled during a quiet period |

## Kept: what RLS actually is (plain-English refresher)

Row-Level Security is a Postgres feature that lets the **database** decide which
rows a connection can see or modify, instead of relying on app-side `WHERE`
clauses. With RLS off, anyone holding the anon/authenticated key can technically
read or write every row of every exposed table — the only thing preventing that
is the filters the React code remembers to add. With RLS on, every query is
automatically rewritten with a scoping clause based on the current session.

In Supabase's role model:

- **anon** and **authenticated** keys go through PostgREST as low-privilege
  roles and are subject to RLS.
- **service_role** bypasses RLS entirely. It must only ever be used server-side
  (in this repo: edge functions).

That last point is why the anon key shipping in the browser bundle is safe now
and was not before.
