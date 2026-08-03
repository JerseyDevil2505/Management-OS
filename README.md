# PPA Property Assessment Copilot

A New Jersey property-assessment management platform. It runs the full lifecycle
of a municipal reassessment or revaluation — source-file ingestion, inspection
tracking, market and land valuation, comparable-sales evaluation, and tax appeal
defense — plus the billing, payroll, and HR side of running the firm.

Built for two kinds of users out of one codebase:

| Tenant | `org_type` | What they see |
|---|---|---|
| **PPA Inc** (internal) | `internal` | Everything: all jobs, employees, billing, payroll, revenue, organizations |
| **LOJIK clients** (municipal assessors) | `assessor` | Only their own municipality's job(s) — assessor dashboard, checklist, valuation, appeals |

Module visibility, terminology, and defaults are driven by `src/lib/tenantConfig.js`.
Data access is enforced independently at the database level (see Security below).

## Stack

- **React 18** (Create React App), Tailwind CSS, Lucide icons
- **Supabase** — Postgres, Auth, Storage, Edge Functions
- **Leaflet** / react-leaflet for subject-and-comparable maps
- **pdf-lib** and **pdfjs-dist** for PDF assembly and parsing, **jsPDF** for report generation
- **xlsx-js-style** for Excel export, **papaparse** for CSV

## Getting started

```bash
npm install
npm start          # dev server on :3000
npm run build      # production build
```

Create a `.env` in the project root:

```
REACT_APP_SUPABASE_URL=https://<project-ref>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<publishable/anon key>
```

Only the anon key belongs in the browser. The service-role key must never appear
in `.env` or any file under `src/` — it bypasses all database access rules. It is
used exclusively inside Edge Functions, read from the platform environment.

There is no auto-login in any environment, including local development. You need
a real account to get past the landing page.

## How the data gets in

Municipal source files arrive from one of two CAMA vendors, each with its own
parser and its own delta processor for re-uploads:

- **BRT** — `src/lib/data-pipeline/brt-processor.js`, `brt-updater.js`
- **Microsystems** — `microsystems-processor.js`, `microsystems-updater.js`

Uploads are versioned per job (`property_records.file_version`), so a re-upload
is compared against the previous version rather than overwriting it. Vendor type
is detected on import and passed down through `JobContainer` to every module.

## Layout

```
src/
├── App.js                    Router, auth guard, tenant context
├── components/               Top-level pages
│   └── job-modules/          Job-scoped modules, dispatched by JobContainer.jsx
│       ├── market-tabs/      Land valuation, pre-valuation, attribute cards, data quality
│       └── final-valuation-tabs/  CME comparables, appeal log, appraisal grid
├── lib/
│   ├── supabaseClient.js     Client + service layer + code interpretation
│   ├── tenantConfig.js       Per-tenant module/label/behavior config
│   └── data-pipeline/        Vendor parsers and delta processors
└── data/                     Static lookups (NJ ZIP → city)

supabase/functions/           Edge Functions (service-role, server-side only)
```

`copilot-os.md` has the full component map with line counts, the database
schema, and the vendor-specific business rules.

## Security

Row Level Security is enabled on **all 48 `public` tables**. The database — not
the React code — decides what each account can see. An assessor client reaching
the API directly still only gets their own municipality.

Before adding a table, view, or RPC, read the policy rules in `copilot-os.md`
§ 3 (Database Schema & RLS). The three that bite hardest:

1. Never call a scoping helper bare in a policy predicate — wrap it as
   `(select private.app_is_staff())`, or it is evaluated per row and large tables
   time out.
2. New helpers go in the `private` schema. Anything in `public` becomes a public
   REST endpoint.
3. New views need `security_invoker = true`, or they bypass RLS entirely.

## Documentation

| File | What it covers |
|---|---|
| `copilot-os.md` | Architecture reference — components, schema, pipeline, business rules |
| `SECURITY-REMEDIATION.md` | Access model, policy map, and why it is shaped this way |
| `LOCAL_PHOTO_SOURCE.md` | Local-folder photo workflow for appeal reports |
| `SURGICAL_PATCH_IMPLEMENTATION.md` | Targeted cache updates that avoid full job reloads on large jobs |
| `IP-PROTECTION-PLAN.md` | Proprietary-logic inventory |
| `farmland-component-plan.md` | Farmland module — idea stage, nothing built |
| `SUPABASE_RESOURCE_FIX.md` | Superseded pre-RLS plan — do not follow its instructions |
| `DISCLAIMER.md` | Legal and data-handling notice |

## Deployment

Pushing to the remote does not deploy. Builds go out through the hosting
platform separately.
