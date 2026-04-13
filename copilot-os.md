# Copilot OS — Internal Architecture Reference

> Lean reference for the NJ property-assessment management platform.
> Covers repo layout, component map, database schema, data pipeline, and vendor-specific business rules.
> Updated April 2025.

---

## 1. Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 (CRA), Tailwind CSS, Lucide icons |
| Backend / DB | Supabase (Postgres), Row-Level Security |
| Auth | Supabase Auth (email/password) |
| Exports | jsPDF (PDF), xlsx-js-style (Excel) |
| Multi-tenant | `organizations` table, `organization_id` FK on jobs/employees/profiles |

---

## 2. Repository Structure

```
src/
├── App.js                          (1,772)  Router + auth guard + tenant context
├── index.js                        (11)     Entry point
│
├── components/                     Top-level pages (rendered by App.js router)
│   ├── AdminJobManagement.jsx      (3,280)  Job CRUD, archiving, status lifecycle
│   ├── AppealsSummary.jsx          (376)    Cross-job appeal dashboard
│   ├── AssessorDashboard.jsx       (1,079)  External assessor client view
│   ├── BillingManagement.jsx       (4,721)  Contracts, billing events, invoices
│   ├── EmployeeManagement.jsx      (2,478)  HR, inspector management, analytics
│   ├── LandingPage.jsx             (217)    Public landing / login
│   ├── OrganizationManagement.jsx  (748)    Org CRUD, subscriptions
│   ├── PayrollManagement.jsx       (1,540)  Payroll periods, processing
│   ├── RevenueManagement.jsx       (1,538)  Revenue tracking, proposals
│   ├── UserManagement.jsx          (1,126)  Profile/user admin
│   │
│   └── job-modules/                Job-scoped modules (loaded inside JobContainer)
│       ├── JobContainer.jsx        (1,466)  Module dispatcher + data orchestrator
│       ├── FileUploadButton.jsx    (3,766)  Source-file upload + comparison engine
│       ├── ProductionTracker.jsx   (4,632)  Inspection analytics, charts
│       ├── DataVisualizations.jsx  (1,182)  Data viz / chart components
│       ├── InspectionInfo.jsx      (582)    Inspection data viewer
│       ├── ManagementChecklist.jsx (1,736)  Checklist management per job
│       ├── AppealCoverage.jsx      (19)     Placeholder / redirect
│       │
│       ├── MarketAnalysis.jsx      (372)    Orchestrator → market-tabs/
│       ├── market-tabs/
│       │   ├── LandValuationTab.jsx    (12,678) ★ LARGEST — land rates, brackets, eco-obs
│       │   ├── PreValuationTab.jsx     (6,408)  Normalization workflows
│       │   ├── AttributeCardsTab.jsx   (4,624)  Condition items + attribute cards
│       │   ├── OverallAnalysisTab.jsx  (4,275)  Block mapping, condos, overall analysis
│       │   ├── DataQualityTab.jsx      (3,279)  Data validation checks
│       │   └── CostValuationTab.jsx    (1,072)  New construction, CCF
│       │
│       ├── FinalValuation.jsx      (182)    Orchestrator → final-valuation-tabs/
│       └── final-valuation-tabs/
│           ├── SalesComparisonTab.jsx      (5,684)  CME comparable search + evaluation
│           ├── AppealLogTab.jsx            (3,116)  Appeal log CRUD + import
│           ├── DetailedAppraisalGrid.jsx   (2,532)  Manual appraisal + PDF export
│           ├── AdjustmentsTab.jsx          (2,277)  CME grid + bracket mapping
│           ├── SalesReviewTab.jsx          (1,870)  Sales history review
│           ├── MarketDataTab.jsx           (1,692)  Effective age / depreciation
│           ├── VacantLandAppraisalTab.jsx  (1,549)  Vacant land evaluation
│           ├── RatableComparisonTab.jsx    (1,109)  Tax rate impact analysis
│           └── AnalyticsTab.jsx            (468)    Final recommendations
│
├── lib/
│   ├── supabaseClient.js           (5,058)  Supabase client, service layer, interpretCodes
│   ├── targetNormalization.js      (402)    Time/size normalization math
│   ├── tenantConfig.js             (142)    Multi-tenant helpers
│   └── data-pipeline/
│       ├── brt-processor.js        (1,551)  BRT source-file parser → property_records
│       ├── brt-updater.js          (1,998)  BRT re-upload delta processor
│       ├── microsystems-processor.js (1,420) Microsystems parser → property_records
│       └── microsystems-updater.js (1,873)  Microsystems re-upload delta processor
│
├── App.css / index.css             Global styles
└── (component-level .css files)    LandValuationTab.css, sharedTabNav.css, etc.
```

**Total source lines: ~98,000+**

### Component Organization Pattern

Both `market-tabs/` and `final-valuation-tabs/` follow the same pattern:

- **Parent Orchestrator** — lightweight coordinator (`MarketAnalysis` 372 lines, `FinalValuation` 182 lines)
- **Child Tab Components** — heavy implementations live in sub-folders
- **Benefits** — clean file organization, logical grouping, no double data loading

### JobContainer Role

`JobContainer.jsx` is the central dispatcher for all job-scoped modules. It:
- Loads job metadata, property records, and market analysis data
- Passes shared state to child modules via props
- Handles assignment-aware loading (filters by `is_assigned_property` when applicable)
- Manages vendor detection and passes `vendorType` downstream

---

## 3. Database Schema (Live — April 2025)

All tables in `public` schema. RLS is enabled on `job_cme_result_sets`, `job_cme_bracket_mappings`, and `job_sales_pool_overrides`. Other tables rely on application-level auth.

### Core Tables

#### `organizations`
Multi-tenant root. Types: `internal` (PPA) or `assessor` (client).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| slug | text | unique |
| org_type | text | `internal` or `assessor` |
| single_job_mode | bool | assessor clients with one job |
| default_job_id | uuid | for single-job-mode orgs |
| tab_config | jsonb | controls which nav tabs are visible |
| subscription_status | text | `active`, `suspended`, `cancelled`, `trial`, `free` |
| annual_fee | numeric | |
| is_free_account | bool | |

#### `profiles`
Auth users. FK → `organizations.id` via `organization_id`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | FK → auth.users |
| email | text | unique |
| role | text | `admin`, `manager`, `inspector`, `viewer` |
| employment_status | text | `active`, `inactive`, `terminated` |
| organization_id | uuid | FK → organizations |

#### `employees`
Operational staff records (separate from auth profiles).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| employee_number | text | |
| first_name, last_name, initials | text | |
| role | text | |
| inspector_type | text | |
| employment_status | text | |
| auth_user_id | uuid | optional link to auth.users |
| has_account | bool | |
| organization_id | uuid | FK → organizations |
| accessible_organization_ids | uuid[] | cross-org access |

#### `employee_organizations`
Many-to-many for cross-org employee access.

#### `jobs`
Central entity — one job = one municipality revaluation project.

| Key Columns | Type | Notes |
|-------------|------|-------|
| id | uuid PK | |
| job_name, client_name | text | |
| status | text | `draft`, `active`, `suspended`, `terminated`, `expired`, `complete`, `archived` |
| ccdd_code | varchar | county-district-district code |
| county, state, municipality | text | NJ default |
| vendor_type | varchar | `BRT` or `Microsystems` |
| vendor_detection | jsonb | auto-detected vendor info |
| organization_id | uuid | FK → organizations |
| parent_job_id | uuid | self-FK for archived snapshots |
| year_of_value | int | |
| director_ratio | numeric | |
| total_properties | int | |
| source_file_version | text | |
| source_file_version_id | uuid | |
| parsed_code_definitions | jsonb | from code-file upload |
| infoby_category_config | jsonb | info-by code groupings |
| unit_rate_config / staged_unit_rate_config | jsonb | |
| attribute_condition_config | jsonb | |
| story_height_config | jsonb | code → floor-level mappings |
| workflow_stats | jsonb | |
| needs_reprocessing | bool | flag for analytics refresh |
| appeal_summary_snapshot | jsonb | cached appeal stats |
| current_class_*_count/total | int/bigint | Class 1,2,3A,3B,4,6 current values |
| previous_projected_class_*_count/total | int/bigint | delta tracking from prior upload |
| rate_calc_budget, rate_calc_current_rate | numeric | |

#### `job_assignments`
Links employees to jobs with roles (`Lead Manager`, `Assistant Manager`, `inspector`, `reviewer`).

### Property Data

#### `property_records` (~314K rows)
Master property table. One row per block/lot/qualifier/card per job.

| Key Columns | Type | Notes |
|-------------|------|-------|
| property_composite_key | text | unique — `{job_id}_{block}_{lot}_{qual}_{card}` |
| property_block, property_lot, property_qualifier | text | |
| property_m4_class, property_cama_class | text | |
| property_location | text | street address |
| property_vcs | text | value comparison set |
| owner_name, owner_street, owner_csz | text | |
| sales_price, sales_date, sales_nu | numeric/date/text | |
| values_mod_land/improvement/total | numeric | MOD (current) values |
| values_cama_land/improvement/total | numeric | CAMA values |
| values_base_cost, values_det_items, values_repl_cost | numeric | cost approach components |
| asset_* fields | various | building attributes (year_built, sfla, lot_sf, bedrooms, story_height, etc.) |
| asset_effective_age | int | **BRT: stored as year; Micro: stored as yearPrior - age** |
| landur_1..6, landurunits_1..6 | text/numeric | land-use codes and units |
| landffcond_*, landurcond_*, landffinfl_*, landurinfl_* | text | land condition/influence codes |
| special_tax_code_1..4 | text | special tax district codes |
| basement/garage/deck/patio/porch/pool areas | numeric | extracted physical attributes |
| utility_heat/water/sewer | text | translated utility info |
| topography, clearing | text | |
| detached/attached item codes + areas | text/numeric | up to 11 detached, 15 attached |
| is_assigned_property | bool | filtered inspection scope |
| inspection_measure/list/price_by | text | inspector initials |
| inspection_info_by | varchar | info-by category code |
| vendor_source | text | `BRT` or `Microsystems` |
| is_new_since_last_upload | bool | |
| net_condition_pct | numeric | BRT NCOVR field |

#### `property_market_analysis` (~230K rows)
Per-property market analysis data. FK → `property_records` via `property_composite_key`.

| Column | Type | Notes |
|--------|------|-------|
| values_norm_size | numeric | size-normalized value |
| values_norm_time | numeric | time-normalized value |
| location_analysis | text | location code |
| new_vcs | text | reassigned VCS |
| sales_history | jsonb | historical sales |
| cme_include_override | bool | force include/exclude from CME |

#### `inspection_data` (~117K rows)
Inspector field data with override tracking and payroll linkage.

### Market Analysis Data

#### `market_land_valuation`
One row per job. Stores all land-valuation config and results.

| Key Fields | Notes |
|------------|-------|
| worksheet_data | jsonb — per-block land worksheets |
| bracket_config, bracket_analysis | bracket definitions and results |
| cascade_rates | block-to-block rate cascading |
| allocation_study | land allocation analysis |
| overall_analysis_results/config | block mapping, condo analysis |
| normalization_config, time_normalized_sales | normalization settings/results |
| eco_obs_code_config | location code definitions (35=Busy Street, FL=Flood, etc.) |
| eco_obs_summary_adjustments | policy-level adjustments by location |
| eco_obs_applied_adjustments | computed per-property adjustments |
| cost_conv_factor | cost conversion factor (CCF) |
| vacant_land_appraisals | jsonb array of saved VLA results |
| custom_attribute_rollup, additional_cards_rollup | attribute card summaries |
| zoning_config | zoning code mappings |
| target_allocation | target land allocation % |

### Final Valuation Data

#### `final_valuation_data`
Per-property final values.

| Column | Type | Notes |
|--------|------|-------|
| actual_efa, recommended_efa | numeric | effective age values |
| depr_factor | numeric | depreciation factor |
| new_calculated_value | numeric | cost approach result |
| projected_improvement, projected_total | numeric | |
| cme_projected_assessment | numeric | CME result |
| cme_min_range, cme_max_range | numeric | CME confidence range |
| cme_comp1..5 | text | comparable property keys |
| final_method_used | text | `cost`, `cme`, `manual` |
| final_recommended_value | numeric | |
| projected_6_override | numeric | manual Class 6 override |
| result_name | text | named result set |
| imported_from, import_date | text/timestamptz | cross-job import tracking |

#### `job_tax_rates`
Current and projected tax rates per job (general, school, county).

#### `job_adjustment_grid`
CME adjustment definitions per job. Columns: `bracket_0` through `bracket_9` for price-bracket values.

#### `job_settings`
Key-value settings per job (e.g., `year_prior_to_due_year`).

#### `job_cme_evaluations` (RLS: no)
Individual CME evaluation results. Stores comparables array (jsonb), projected assessment, confidence score.
Status workflow: `pending` → `saved` → `applied` / `set_aside`.

#### `job_cme_result_sets` (RLS: yes)
Named saved CME result batches per bracket.

#### `job_cme_bracket_mappings` (RLS: yes)
Maps VCS/type-use codes to CME price brackets.

#### `job_custom_brackets`
User-defined custom price bracket columns with per-attribute adjustment values.

### Appeal Tracking

#### `appeal_log` (~1,859 rows)
Full appeal lifecycle tracking.

| Key Fields | Notes |
|------------|-------|
| appeal_number, appeal_year | |
| property_block/lot/qualifier | |
| status_code | `W`, `S`, `D`, `H`, `AWOP`, `AWP`, `A`, `M` |
| cme_bracket | `CSP`, `PSP`, `HSP`, `ALL` |
| judgment_value, loss, possible_loss, loss_pct | |
| attorney_*, petitioner_name | |
| evidence_status, stip_status | |
| import_source | `ONLINE_SYSTEM`, `XLS`, `CSV`, `PDF`, `MANUAL` |

### Financial / Operations

#### `job_contracts`
Contract terms per job (retainer, end-of-job, appeals year 1-3 splits).

#### `billing_events`
Individual billing entries per job.

#### `payroll_periods`
Payroll period definitions with processing settings.

#### `expenses`
Monthly expense tracking by category.

#### `shareholder_distributions`
Owner distribution tracking.

#### `office_receivables`
Outstanding receivables.

#### `proposals`
Business development proposals → can convert to organization.

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `source_file_versions` | Version history of uploaded source files |
| `comparison_reports` | Upload-to-upload diff reports |
| `property_class_changes` | Class change audit trail |
| `analytics_runs` | Saved VCS analysis snapshots |
| `county_hpi_data` | FHFA House Price Index by NJ county |
| `job_responsibilities` | Assigned property scope per job |
| `job_access_grants` | Cross-job data access for assessor employees |
| `job_sales_pool_overrides` (RLS) | Named sales pool filter overrides |
| `checklist_items` | Per-job checklist items |
| `checklist_item_status` | Checklist completion tracking |
| `checklist_documents` | File attachments on checklist items |
| `planning_jobs` | Pre-contract pipeline planning |

---

## 4. Data Pipeline

### Source File Upload Flow

```
User uploads .txt/.csv
  → FileUploadButton.jsx detects vendor (BRT vs Microsystems)
  → Calls processor:
      brt-processor.js        OR  microsystems-processor.js
  → Parser extracts fields → upserts into property_records
  → Stores version in source_file_versions
  → On re-upload, uses updater:
      brt-updater.js          OR  microsystems-updater.js
  → Updater diffs against existing, generates comparison_report
  → Updates property_records, flags is_new_since_last_upload
  → Sets job.needs_reprocessing = true
```

### Processor vs Updater Split

- **Processor** — first-time ingest: parses raw vendor file, maps fields, inserts `property_records`
- **Updater** — subsequent uploads: diffs new file against existing records, tracks adds/removes/changes, creates `comparison_reports`

### Code File Upload

Separate from source file. Uploads a code-definitions file that gets parsed into `jobs.parsed_code_definitions` (jsonb). Used by `interpretCodes()` in `supabaseClient.js` to translate numeric codes to human-readable descriptions (e.g., building class codes, VCS codes).

---

## 5. Vendor Differences: BRT vs Microsystems

### Effective Age / Depreciation (Critical)

This is the most important vendor difference in the system.

| Concept | BRT | Microsystems |
|---------|-----|--------------|
| `asset_effective_age` stored as | Calendar year (e.g., 2015) | `yearPrior - age` (stored as year) |
| Actual EFA display | Show as-is (year) | Convert back: `yearPrior - storedValue` = age |
| Recommended EFA formula output | Year (e.g., 2015) | Age in years (e.g., 10) |
| DEPR formula | `1 - ((yearPrior - year) / 100)` | `1 - (age / 100)` |

**The Microsystems processor converts age → year for storage**, so the DB always stores a year-like value. The UI layer in `MarketDataTab.jsx` converts back to age for display.

### Field Mapping Differences

| Data Point | BRT Field | Microsystems Field |
|------------|-----------|-------------------|
| Story height | STORYHGT | Story Height |
| Bedrooms | BEDTOT | Total Bedrms |
| Special tax codes | EXEMPT_SPECIAL_TAXCODE1-4 | Sp Tax Cd1-2 (max 2) |
| Finished basement | BSMNTFINISHCODE/AREA | direct SF |
| Detached items | Code+Width+Depth | Code+Area (with raw_detached_items jsonb) |
| Utilities | UTILS codes (cat 52 translation) | Gas Yn / Water Yn / Sewer Yn |

---

## 6. Key Business Concepts

### Property Classification (NJ)
- **Class 1** — Vacant land
- **Class 2** — Residential
- **Class 3A** — Farm (regular)
- **Class 3B** — Farm (qualified)
- **Class 4** — Commercial/Industrial (4A/4B/4C)
- **Class 6** — Personal property (6A/6B/6C)

### Valuation Methods
1. **Cost Approach** (MarketDataTab) — replacement cost × depreciation + land value
2. **Sales Comparison / CME** (SalesComparisonTab) — comparable market evaluation with weighted comps
3. **Manual / Override** (DetailedAppraisalGrid) — appraiser-entered values with PDF export

### CME Workflow
```
AdjustmentsTab: Define adjustment grid (attributes × price brackets)
  → Map VCS/type-use codes to brackets (job_cme_bracket_mappings)
  → SalesComparisonTab: Run iterative evaluation
    → Find comparable sales within filters
    → Apply adjustments from grid
    → Weight by similarity score
    → Generate projected_assessment
  → Save result sets (job_cme_result_sets)
  → Apply to final_valuation_data
```

### Land Valuation Workflow (LandValuationTab)
```
Bracket setup → Vacant sales analysis → Allocation study
  → Land rate recommendation → Cascade rates across blocks
  → Eco-obs adjustments (location codes)
  → Per-property land values written to property_market_analysis
```

### Appeal Log Workflow
- Appeals imported via XLS/CSV/PDF or manual entry
- Tracked through status codes: W(Withdrawn), S(Settled), D(Dismissed), H(Heard), etc.
- Auto-linked to CME evaluations for projected values
- Supports evidence tracking and stipulation workflow

### Multi-Tenant Architecture
- `organizations` table is the root tenant
- Jobs, employees, profiles all FK → organization_id
- `internal` org = PPA (sees everything)
- `assessor` orgs = external clients (scoped to their jobs)
- `single_job_mode` + `default_job_id` for simple assessor setups
- `tab_config` controls which navigation sections are visible per org

---

## 7. Service Layer (supabaseClient.js)

Key exports beyond the Supabase client itself:

- **`interpretCodes(jobId, category, code)`** — translates numeric vendor codes to descriptions using `parsed_code_definitions`
- **Data fetch helpers** — centralized queries for properties, market analysis, final valuation
- **Inspection data services** — CRUD for inspection_data with override tracking
- **File processing orchestration** — coordinates processor/updater pipeline

---

## 8. Export Capabilities

| Format | Component | What |
|--------|-----------|------|
| PDF | DetailedAppraisalGrid | Individual property appraisal report |
| PDF | VacantLandAppraisalTab | Vacant land appraisal report |
| Excel | SalesComparisonTab | CME evaluation results |
| Excel | AppealLogTab | Appeal log export |
| Excel | MarketDataTab | Market data / EFA worksheet |
| Excel | LandValuationTab | Land worksheets, bracket analysis |
| Excel | ProductionTracker | Inspection analytics |

Both PDF generators support appeal-number auto-detection from `appeal_log` and manual override.

---

## 9. Ground Rules for New Branches

**READ BEFORE TOUCHING ANYTHING.**

This codebase has been built iteratively over the course of a year. Every pattern that looks "weird" was likely solved through multiple rounds of debugging with the user. Before refactoring, restructuring, or "improving" existing code:

### Do NOT:
- Refactor working code that wasn't part of the request
- "Clean up" vendor-specific branching logic — it exists because BRT and Microsystems genuinely work differently
- Simplify the EFA/depreciation math — the conversions between age-as-year and age-as-age are correct and intentional
- Remove or consolidate what looks like duplicate logic between BRT and Microsystems paths — they are intentionally separate
- Add abstractions, wrapper functions, or "helper utilities" around code that works fine inline
- Change how `interpretCodes` works — it handles vendor-specific code translation and the structure is deliberate
- Normalize database field names or suggest schema migrations unless explicitly asked
- Add TypeScript, PropTypes, or type annotations unless asked
- Add error boundaries, loading skeletons, or UX polish that wasn't requested
- Move files, rename components, or restructure folders

### Do:
- Read the relevant component fully before making changes
- Ask "is this intentional?" before changing any pattern that seems odd
- Check this document for context on vendor differences before touching anything in the data pipeline or EFA logic
- Make surgical, minimal changes scoped to exactly what was requested
- Trust that large components (LandValuationTab at 12,678 lines) are large for a reason — they contain complex, interrelated workflows that break when split apart

### Patterns That Look Wrong But Are Correct

| Pattern | Why It's Intentional |
|---------|---------------------|
| `asset_effective_age` stores a year, not an age (Microsystems) | Processor converts age→year for uniform storage; UI converts back for display |
| Separate processor + updater files per vendor | First upload vs re-upload have fundamentally different logic (diff tracking, comparison reports) |
| `MarketAnalysis.jsx` is only 372 lines | It's an orchestrator — all real work is in `market-tabs/` children |
| `FinalValuation.jsx` is only 182 lines | Same pattern — orchestrator for `final-valuation-tabs/` |
| `supabaseClient.js` at 5,058 lines | Centralized service layer — it's large because it's the single source of truth for data operations |
| Components with 2,000-12,000 lines | These are full workflow modules with inline state, calculations, and UI — splitting them creates worse problems than keeping them together |
| Inline calculations in JSX components | The depreciation/normalization/CME math needs to live close to the UI that displays it — extracting to separate files creates synchronization bugs |
| `property_composite_key` used as FK (not uuid) | Block+lot+qualifier+card is the natural key in NJ tax assessment — it's the identifier that survives across file uploads |
| Multiple jsonb columns on `market_land_valuation` | One row per job with rich jsonb fields is the correct model — it avoids join complexity for data that's always loaded together |
| `is_assigned_property` filter vs dedicated join table | Assignment-aware loading was solved at the flag level intentionally — the join table `job_responsibilities` stores the upload, but the flag on `property_records` is what the app queries |

### Lessons Learned the Hard Way

1. **The EFA conversion chain** — Microsystems stores effective age as years-of-age in their source file. The processor converts it to a year (`yearPrior - age`) for storage. `MarketDataTab` converts it back to age for display. The DEPR formula uses age directly for Microsystems and `yearPrior - year` for BRT. Touching any part of this chain without understanding the full flow will produce incorrect valuations across the entire job.

2. **Don't "fix" the data pipeline processors** — `brt-processor.js` and `microsystems-processor.js` map vendor-specific field names to our normalized schema. The field mappings look arbitrary but match exact vendor export formats that municipalities provide. Renaming or reordering breaks real uploads.

3. **Large components are load-bearing** — `LandValuationTab.jsx` (12,678 lines) handles bracket analysis, vacant sales, allocation studies, cascade rates, eco-obs adjustments, and per-block worksheets. These features share internal state. Previous attempts to split it created race conditions and stale-state bugs.

4. **CME adjustment grid is bracket-aware** — The `job_adjustment_grid` has `bracket_0` through `bracket_9` columns. These map to price brackets defined in `job_cme_bracket_mappings`. The mapping between VCS codes, type-use codes, and brackets is municipality-specific. Don't assume uniform bracket definitions.

5. **Multi-tenant scoping is not optional** — Every query that touches jobs, employees, or properties must respect `organization_id`. The `internal` org can see everything, `assessor` orgs can only see their own data. The `job_access_grants` table allows controlled cross-job access for specific employees — this is not a bug.

6. **Appeal log import formats vary** — Each county board has its own export format. The import logic in `AppealLogTab` handles XLS, CSV, PDF, and manual entry. The field mapping is deliberately flexible because no two counties produce the same export.

7. **Don't add loading states or spinners** to working flows — If a component doesn't show a loading spinner, it's probably because the data loads fast enough that a spinner causes more visual disruption than a brief blank frame.

8. **`comparison_reports` are generated, not user-created** — They're produced automatically when a new source file is uploaded over an existing one. Don't expose CRUD for them.
