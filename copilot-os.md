# Copilot OS — Internal Architecture Reference

> Lean reference for the NJ property-assessment management platform.
> Covers repo layout, component map, database schema, data pipeline, and vendor-specific business rules.
> Updated April 2025 (rev. — geocoder, appeal map, distance filter, PowerComp PDF round-trip,
> user-facing Coordinates cleanup sub-tab, sales-pool chip filter w/ Lojik year adjustment,
> ties-only ZIP variant CSV, numbered-street ordinal variants, AppealLog→CME bracket label parity).

---

## 1. Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 (CRA), Tailwind CSS, Lucide icons |
| Mapping | Leaflet + react-leaflet (subject/comp maps), pdf-lib (PDF merge), pdfjs-dist (PDF parsing) |
| Geocoding | U.S. Census Bureau Batch Geocoder (free, manual round-trip CSV) + manual lat/lng entry |
| Backend / DB | Supabase (Postgres), Row-Level Security — **Project ID: `zxvavttfvpsagzluqqwn`** |
| Auth | Supabase Auth (email/password) |
| Exports | jsPDF (PDF), xlsx-js-style (Excel) |
| Multi-tenant | `organizations` table, `organization_id` FK on jobs/employees/profiles |

---

## 2. Repository Structure

```
public/
├── index.html                      App shell
├── lojik-logo.PNG                  Brand logo
├── lojik-pamphlet.pdf              Generated marketing pamphlet
├── Property Assessment Copilot.pdf Product overview PDF
├── hr-documents/                   Employee forms (handbook, I-9, time-off request)
└── templates/                      Document template folders (brochures, forms, letters, maps)

scripts/
└── generate-pamphlet.js            PDF-lib script to generate the Lojik pamphlet

supabase/
└── functions/
    └── recalculate-amenities/
        └── index.ts                Edge Function — recalculates property amenity areas

src/
├── App.js                          (1,772)  Router + auth guard + tenant context
├── index.js                        (11)     Entry point
│
├── components/                     Top-level pages (rendered by App.js router)
│   ├── AdminJobManagement.jsx      (3,280)  Job CRUD, archiving, status lifecycle
│   ├── AppealMap.jsx                (290)   Leaflet subject+comps map (numbered pins, html2canvas capture)
│   ├── AppealsSummary.jsx          (376)    Cross-job appeal dashboard
│   ├── AssessorDashboard.jsx       (1,079)  External assessor client view
│   ├── BillingManagement.jsx       (4,721)  Contracts, billing events, invoices
│   ├── EmployeeManagement.jsx      (2,478)  HR, inspector management, analytics
│   ├── GeocodeStatusChip.jsx        (390)   Inline lat/lng status pin + edit modal for comp grids
│   ├── GeocodingTool.jsx           (2,674)  Admin-only Census batch geocoder (CSV round-trip + manual)
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
│       │   ├── CoordinatesSubTab.jsx   ( --- )  User-facing geocode cleanup queue (Pending/Review/Fixed buckets, class + sales-pool chips, inline GeocodeStatusChip edits)
│       │   └── CostValuationTab.jsx    (1,072)  New construction, CCF
│       │
│       ├── FinalValuation.jsx      (182)    Orchestrator → final-valuation-tabs/
│       └── final-valuation-tabs/
│           ├── SalesComparisonTab.jsx      (5,684)  CME comparable search + evaluation (incl. distance-from-subject filter)
│           ├── AppealLogTab.jsx            (3,116)  Appeal log CRUD + import + PowerComp PDF merge + CSV export to BRT
│           ├── DetailedAppraisalGrid.jsx   (2,532)  Manual appraisal + PDF export (uploads to `appeal-reports` bucket)
│           ├── AdjustmentsTab.jsx          (2,277)  CME grid + bracket mapping
│           ├── SalesReviewTab.jsx          (1,870)  Sales history review
│           ├── MarketDataTab.jsx           (1,692)  Effective age / depreciation
│           ├── VacantLandAppraisalTab.jsx  (1,549)  Vacant land evaluation
│           ├── RatableComparisonTab.jsx    (1,109)  Tax rate impact analysis
│           ├── AppellantEvidencePanel.jsx  ( -- )   Appellant-supplied comps panel + BS Meter
│           └── AnalyticsTab.jsx            (468)    Final recommendations
│
├── data/
│   └── njZipToCity.js              (654)    NJ ZIP → city lookup (Census geocoder ZIP-sweep helper)
│
├── lib/
│   ├── supabaseClient.js           (5,058)  Supabase client, service layer, interpretCodes
│   ├── targetNormalization.js      (402)    Time/size normalization math
│   ├── tenantConfig.js             (142)    Multi-tenant helpers
│   ├── powercompPdfParser.js       (948)    Parses BRT PowerComp Batch Taxpayer PDFs → per-subject photo packets
│   ├── appellantCompEvaluator.js   (397)    BS Meter — scores appellant comps (NU codes, date range, similarity)
│   ├── appealReportBuilder.js       (60)    PDF download / zip-of-PDFs / safe filename helpers
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
| property_latitude, property_longitude | numeric | Geocoded coordinates (Census, manual, or inherited from mother lot) |
| geocode_source | text | `census`, `manual`, `inherited_motherlot`, `skipped`, or null |
| geocode_match_quality | text | Census match type, `Manual`, `inherited_motherlot`, `no_street_number`, etc. |
| geocoded_at | timestamptz | Last geocode update timestamp |

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
| property_composite_key | text | Direct link to `property_records` |
| appeal_type | text | Standard improved vs vacant land workflow |
| vla_projected_value | numeric | Vacant Land Appraisal projected value (used when `appeal_type` = vacant land) |
| appellant_comps | jsonb | Appellant-supplied comps captured in `AppellantEvidencePanel` |
| appellant_comps_updated_at | timestamptz | Last edit timestamp for appellant comps |
| farm_mode | bool | Toggle that loosens NU acceptability (allows `33`) for farm appeals |

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
| `appeal_powercomp_photos` | Per-property photo-packet metadata imported from BRT PowerComp PDFs. **Legacy / fallback** — superseded by `appeal_photos` for new appeals. Columns: `id`, `job_id`, `property_composite_key`, `storage_path`, `page_count`, `source_filename`, `imported_at`, `imported_by`. |
| `appeal_photos` | Per-parcel front-photo picks for appeal reports, populated from the local Pictures folder via `ParcelPhotoStrip` (Detailed tab). One row per `(job_id, property_composite_key)` — re-picking replaces. Columns: `id`, `job_id`, `property_composite_key`, `appeal_id` (nullable), `storage_path`, `source` (`powercama` / `powerpad` / `user_upload` / `clipboard`), `original_filename`, `capture_ts` (T<14 digits> if from a PowerCama-stamped file), `picked_by`, `picked_at`, `caption`. |
| `appeal_reports` | Per-subject Appeal Report PDFs uploaded from the Detailed tab. Source of truth for what gets printed from the Appeal Log; uploads replace prior versions for the same subject. Columns: `id`, `job_id`, `property_composite_key`, `appeal_id`, `storage_path`, `source_filename`, `page_count`, `uploaded_at`, `uploaded_by`. |
| `nu_code_dictionary` | NJ NU (non-usable) deed transaction code dictionary (N.J.A.C. 18:12-1.1). Columns: `code`, `short_form` (human-readable label used in autogenerated commentary), `category`, `description`, `usable` (bool), `notes`, `source`, `updated_at`. |

### Storage Buckets (Supabase Storage)

| Bucket | Purpose |
|--------|---------|
| `appeal-reports` | Appeal report PDFs generated by `DetailedAppraisalGrid` (one per subject, keyed by `CME_<ccdd>_<block>_<lot>[_<qual>].pdf`). Downloaded on demand by Appeal Log for batch print. |
| `powercomp-photos` | Photo-only PDF packets sliced out of imported BRT PowerComp Batch Taxpayer Reports. **Legacy / fallback** — superseded by `appeal-photos` for new appeals. Still merged into appeal reports at print time via pdf-lib when no `appeal_photos` rows exist for the subject. |
| `appeal-photos` | Front photos picked per parcel via `ParcelPhotoStrip` from the local PowerCama/Powerpad Pictures folder. Path convention: `<jobId>/<safe_composite_key>/front_<timestamp>.<ext>`. Read at PDF-generation time to emit the "Subject & Comps Photos" page. Re-picking auto-deletes the prior blob. |

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

## 9. Geocoding & Mapping (Added Post-Initial Guide)

### 9.1 Geocoder Component (`GeocodingTool.jsx`)

Admin-only top-level utility (nav: **🗺️ Geocoder**, route `/geocoding-tool`, gated by `canManageUsers`). Wired in `App.js:1510` and rendered at `App.js:1732`.

**Pipeline (Option B — manual round-trip):**

1. Pick a job → tool reads `property_records` for that job and computes coverage stats.
2. **Generate input CSV(s)** — one row per *parcel identity* (block/lot/qualifier — the date prefix in `property_composite_key` is stripped so multiple roll-year copies of the same parcel collapse). Chunked at exactly **10,000 rows per file** (Census batch limit) and downloaded as `<job-name>_part-N-of-M.csv`.
3. Admin uploads each CSV to <https://geocoding.geo.census.gov/geocoder/geographies/addressbatch> (benchmark `Public_AR_Current`, vintage `Current_Current`).
4. **ZIP-sweep variants** — for stubborn rows the tool can emit synthetic ZIP variants using `src/data/njZipToCity.js`. Variant rows use a `__<zipIdx>` suffix on the composite key; on result import the suffix is stripped via `stripVariantSuffix()` so the matched coords collapse back onto the single parent parcel.
5. Admin downloads result CSV(s) from Census and uploads them back into the tool.
6. **Preview match stats → commit to `property_records`** with `geocode_source = 'census'`, `geocode_match_quality = <Census match type>`, `geocoded_at = now`.
7. **Manual entry pass** — for `No_Match` / suspect rows, paste a `lat, lng` copied from a Google Maps right-click. Stamped `geocode_source = 'manual'` / `geocode_match_quality = 'Manual'`.
8. **Skipped rows** — addresses with no street number (or otherwise un-geocodable) are stamped `geocode_source = 'skipped'` so they don't keep showing up as outstanding work. They can be un-skipped from the manual list.
9. **Mother-lot inheritance** — condo children (`property_qualifier` matching `C%`) without coords inherit the mother lot's lat/lng with `geocode_source = 'inherited_motherlot'`. This runs both as part of a manual save (children of the saved parent) and as a one-shot "inherit from mother lot" pass.

### 9.2 Inline Geocode Status Chip (`GeocodeStatusChip.jsx`)

Tiny circular pin chip embedded in every comp grid (Sales Comparison, Vacant Land, Detailed/Appellant). Click → modal with two text inputs that accept either `40.123, -74.567` (Google right-click format) or two whitespace-separated numbers. Save writes directly to `property_records` by `property_composite_key` and stamps `geocode_source = 'manual'`. Calls `onSaved(coords)` so the parent can patch its in-memory copy without a full reload.

### 9.3 Appeal Map (`AppealMap.jsx`)

Leaflet + react-leaflet renderer used in the Detailed Appraisal report.

- Draws a numbered subject pin and numbered comp pins, with optional polylines from subject → each comp.
- `FitBounds` helper auto-fits the cluster on mount with `padding=20`, `maxZoom=16`, plus a small zoom nudge for tight clusters (Leaflet otherwise picks an overly conservative level).
- Exports `distanceMiles(a, b)` — Haversine miles between two `[lat, lng]` points. **Re-used by `SalesComparisonTab` for the distance filter** (`import { distanceMiles } from '../../AppealMap'`).
- Map div carries an `id` for `html2canvas` capture so the Detailed PDF can embed the rendered map as a "Subject & Comps Location Map" page.

### 9.4 Step 5 Manual Cleanup Chips (`GeocodingTool.jsx`)

The Step 5 "Manual entry (No_Match fallback)" panel has two filter chip rows that narrow the manual cleanup queue (`manualCandidates`). They do **not** affect the bulk CSV emitters in Step 2 — those still ship the full ungeocoded set.

- **Class chips** (multi-select). Built from distinct `property_m4_class` values present on the loaded job, sorted in canonical NJ order (`1, 2, 3A, 3B, 4A, 4B, 4C, 5A, 5B, 6A, 6B, 6C`, then anything else alphabetical). Each chip shows a live count derived from the *base* manual list (search + `manualFilter` applied, but before chip filters), so the count tells you exactly what that chip would yield if toggled. A `clear` link appears once at least one class is active.
- **Sales-pool chip** (single toggle). When on, restricts to parcels with `sales_date` inside the sales-pool window (see 9.5). The chip's count is computed against the *class-filtered* base, so it adapts when classes are toggled. The chip is hidden when the selected job has no `end_date` to anchor the window.

Implementation notes:

- `manualBaseList` (memo) does the manual-filter / search / dedupe work without the chip filter. `manualCandidates` = `manualBaseList.filter(passesCsvFilters).slice(0, 100)`. Per-chip counts are derived from `manualBaseList` so they don't lie when other chips are on.
- `passesCsvFilters` is the predicate: empty class set + `csvSalesInPool=false` = original full base. The same predicate is used by `manualCandidates` only — Step 2's bulk generators (`generateCsvBatches`, `generateVariantCsvBatches`, `generateTiesOnlyVariantCsv`) intentionally do not consult it.
- The `jobs` query (`GeocodingTool.jsx:432`) was extended to select `end_date` and the joined `organizations(org_type)` so the chips can compute the sales-pool window and apply the Lojik adjustment without a second round-trip.
- `fetchAllJobProperties` (`GeocodingTool.jsx:323`) was extended to select `sales_date` — without it the chip filter silently matched zero rows.

### 9.5 Sales-Pool Window & Lojik Year Adjustment

Both the Step 5 chip in the admin Geocoder and the user-facing `CoordinatesSubTab` use the same window math, anchored on `jobs.end_date`:

```
assessmentYear = isLojik ? (end_date.year - 1) : end_date.year
isLojik        = job.organizations.org_type === 'assessor'
window.start   = 10/1 (assessmentYear - 2)
window.end     = 10/31 (assessmentYear - 1)
```

This matches the convention used by `SalesComparisonTab.getCSPDateRange`, `AppellantEvidencePanel.sampleRange`, and `DetailedAppraisalGrid` (search those for `isLojikTenant ? rawYear - 1 : rawYear`). The Lojik adjustment exists because for assessor-tenant jobs `end_date` is the *job* end (one year after the assessment year), not the assessment date itself — so the raw year would shift every window forward by twelve months and quietly wrong-bucket ~12 months of sales on every Lojik job.

The window deliberately covers a single 13-month span (10/1 to 10/31 the next assessment year forward — the +1 month tail keeps late-October recordings safely inside) instead of the older multi-period CSP/PSP/HSP options. We removed those buttons because the cleanup queue cares about "is this a sale we'll need a coordinate for at search-radius time?", not which sub-bucket it belongs in. If the multi-period concept ever needs to come back, both `csvSalesWindow` (Geocoder) and `salesWindow` (CoordinatesSubTab) are the only places to extend.

### 9.6 Recovery Sweep & Ties-Only ZIP Variant CSV (`GeocodingTool.jsx`)

The Step 2 "Recovery sweep" panel hosts ZIP-variant emitters for long-tail recovery. There are now two:

- **`generateVariantCsvBatches`** — the original ZIP sweep. Takes every still-pending parcel, explodes it into one CSV row per configured ZIP (configured per job via the `variant_postal_zips` `job_settings` row, edited with the ZIP modal). Each row's composite key carries a `__<zipIdx>` suffix so the result import can map matches back to the parent parcel.
- **`generateTiesOnlyVariantCsv`** — added after the Dunellen tie problem. Uses the same per-ZIP sweep but restricts to parcels Census flagged as `Tie` in the most-recently imported result (`parsedResults.matchStatus === 'Tie'`). Same `__<zipIdx>` suffix scheme and same downstream import path; just a much smaller payload aimed at re-resolving ties by forcing the configured ZIPs/cities for that town instead of letting Census guess between adjacent boroughs.

Address normalization for both flows runs through `normalizeAddressForCensus` (route rewrite, suffix canon, ordinal handling) and the `ordinalWordVariant` helper. The main CSV emits **both** the numeric (`336 3RD ST`) and the word-form (`336 THIRD ST`) variant per parcel via a `__o1` suffix, because TIGER inconsistently indexes numbered streets in either form on a per-segment basis. The ties-only emitter does the same on top of the per-ZIP sweep when ordinals are present (`__<zipIdx>n` for numeric, `__<zipIdx>w` for word).

### 9.7 User-Facing Coordinates Cleanup Sub-Tab (`CoordinatesSubTab.jsx`)

Lives at **Job → Market Analysis → Data Quality → 📍 Coordinates**. Open to all users with access to the job (managers, Lojik clients, admins) — the full admin Geocoder stays admin-only. The sub-tab reads the already-loaded `properties` prop (no extra DB round-trip) and gives users a focused queue for filling/correcting individual coordinates without touching the bulk Census flow.

- **Buckets** — `Pending` (no coords), `Review` (low-confidence Census quality: `Tie`, `Non_Exact`, `ZIP Centroid`, `Approximate`), `Fixed` (`geocode_source = 'manual'` or high-confidence quality `Exact` / `Match` / `Rooftop`). Bucket counts shown as colored chips at the top.
- **Inline edits** — each row uses `<GeocodeStatusChip />`, which writes lat/lng directly to `property_records` and stamps `geocode_source = 'manual'` / `geocode_match_quality = 'Manual'`. Local patch map keeps the row's bucket up to date without a refetch.
- **Same chip pair** as the admin Geocoder Step 5 (class multi-select + sales-pool toggle, both with live counts). Same Lojik year adjustment. The class-chip count is derived from the post-skipped base; the sales-pool count is derived from the class-filtered base for the same "tells the truth as you compose" property.
- **Show skipped** checkbox (default off) — `geocode_source = 'skipped'` rows are intentional non-actionable parcels and should stay out of the everyday queue.
- **Open in Google Maps** link prefilled with `address, town, county, NJ, zip` so a user can right-click the parcel, copy the `lat, lng`, and paste it into the chip modal.

If `jobData.organizations.org_type` isn't already in the `properties` parent loader, the Lojik adjustment falls back to `jobData.org_type` and finally to "no Lojik adjustment" — the chip just hides itself if no `end_date` is available rather than silently filtering zero rows.

### 9.8 CME Distance-from-Subject Filter (`SalesComparisonTab.jsx`)

New `compFilters.maxDistanceMiles` field (default `''` = no filter, see `SalesComparisonTab.jsx:62`). When set:

- Comps without lat/lng are **excluded** under this rule (we can't prove they're in range).
- Subject without lat/lng → filter is **disabled in the UI** (we don't pretend we can filter when we don't have a reference point).
- Step `0.25` mile increments. Applied via `distanceMiles([sLat, sLng], [cLat, cLng])` against `maxDistance`.

---

## 10. Appeal PDF Round-Trip with BRT PowerComp (Added Post-Initial Guide)

A two-direction integration with BRT's PowerComp tool, all driven from `AppealLogTab.jsx`.

### 10.1 PowerComp PDF Photo-Packet Import

PPA's appeal reports lack property photos. BRT PowerComp's "Batch Taxpayer Report" PDFs do have them. We import the PowerComp PDF, slice out just the photo pages per subject, and stitch them back into our own appeal reports at print time.

- **Parser** — `src/lib/powercompPdfParser.js` (`parsePowerCompPdf(input)`).
  - Uses `pdfjs-dist` with the CDN worker (`pdfjsLib.GlobalWorkerOptions.workerSrc`).
  - Walks every page, classifying as **data page** (contains keywords like `Sales Date`, `SFLA`, `Per Sq Ft Value`, etc.) or **photo page** (everything else).
  - Reads the subject BLQ off each data page using textual landmarks (`Subject` → `Block Lot Qualifier Card` row), tolerating 3- or 4-cell rows since the qualifier cell is often blank.
  - Returns per-subject **packets**: `{ block, lot, qualifier, address, dataPageIndices, photoPageIndices, allPageIndices }`.
- **Import flow** (Appeal Log → "Import Batch PwrComp PDF" modal, `AppealLogTab.jsx:4923`):
  1. User uploads the PowerComp PDF.
  2. Parser produces packets; matched against this job's properties by normalized BLQ.
  3. For each match, the photo pages are extracted with `pdf-lib` into a small per-subject sub-PDF, uploaded to the `powercomp-photos` storage bucket, and a metadata row upserted into `appeal_powercomp_photos` (composite key, storage path, page count, source filename, imported_at).
  4. The photo packet pages get a footer crediting **BRT Technologies PowerComp** (attribution is mandatory — they generated the photos).
- **Print/merge flow** — `buildPrintablePdfForAppeal(appeal)` in `AppealLogTab.jsx:2163`:
  1. Downloads the saved appeal report from `appeal-reports` bucket.
  2. Downloads the PowerComp photo packet from `powercomp-photos` bucket (if any).
  3. Uses `pdfjs-dist` to **scan and classify each report page** by keyword (`detailed evaluation`, `dynamic adjustments`, `subject & comps location map`, `appellant evidence summary`, `chapter 123`) into buckets.
  4. Re-emits the merged PDF in the canonical section order:
     1. Static comp grid (Detailed Evaluation)
     2. Dynamic Adjustments
     3. **PowerComp photo packet** (if present)
     4. Subject & Comps Location Map (if present)
     5. Appellant Evidence Summary (if present)
     6. Chapter 123 Test (Director's Ratio)
  5. Anything that can't be classified is appended at the end in original order (we never silently drop a page). If the pdfjs scan fails, we fall back to original-order with photos appended at the end.

### 10.2 Selective CME → BRT PowerComp CSV Export

Round-trip companion: lets staff hand the *finalized* CME comps back to BRT PowerComp so PowerComp can pre-fill its own report. Driven by the **"Select Result Sets for PowerComp Export"** modal (`AppealLogTab.jsx:4798`).

- Candidates list = every saved CME result set currently linked to an appeal in this job.
- All candidates are **checked by default**. The point of the modal is to *un-check* runs you don't want shipped — common when a single subject has both an assessor run and an appellant run, or a manager rebuttal that shouldn't go to BRT.
- Subjects are visually grouped (block/lot/qualifier + address shown only on the first row of each subject; subsequent rows show `—`).
- Confirm → emits a CSV in BRT's expected format. Excel-safe value handling — values are written as raw cell content (no `="..."` formula wrappers, which BRT was rejecting in earlier revs).

---

## 11. Direct Local-Folder Photo Workflow (replaces PowerComp PDF rip)

The PowerComp PDF round-trip in section 10.1 was a workaround for the fact
that PPA's appeal reports lack property photos. The direct workflow makes
that workaround unnecessary by reading photos straight off the user's
machine (`C:\Powerpad\Pictures\<CCDD>` or `C:\PowerCama\pictures\<CCDD>`)
and uploading only the user-chosen front photo per parcel into Supabase.

**Files involved:**

| File | Role |
|------|------|
| `src/lib/localPhotoSource.js` | Filename parser + per-Job IndexedDB store + folder picker + indexer. Vendor-aware filename parser handles BRT (`CCDD_B_L_Q__N`), Microsystems (`CCDD-B-L-Q--N`), and PowerCama T-stamps (`CCDD_B_L_Q__T20241106144506-01.jpg`). `.BAK` tombstones (PowerCama soft-delete) are skipped entirely. |
| `src/contexts/JobPhotoSourceContext.jsx` | Provider mounted in `JobContainer` keyed off `jobId + ccdd`. Single source of truth for the indexed photo map. Walks the disk once per session; both the panel and the strip read from this. |
| `src/components/job-modules/JobPhotoSourcePanel.jsx` | Connect/disconnect/re-index UI under the version banner. Shows file count + parcel count when connected. Surfaces the `IFRAME_BLOCKED` error with an "Open in New Tab" affordance (note: even the new-tab fallback hits the same restriction inside the editor host — testing requires a real deploy). |
| `src/components/job-modules/ParcelPhotoStrip.jsx` | Compact horizontal strip mounted at the bottom of `DetailedAppraisalGrid`. One column per parcel (Subject + non-manual Comps). Arrow-key cycling, click-to-pick (`⭐ Use`), file-picker `+`, `Ctrl+V` paste. Default export = `ParcelPhotoStrip` (the strip); named export `ExportPhotosPreview` is the read-only thumbnail row used inside the Export PDF modal. |
| `src/components/job-modules/final-valuation-tabs/DetailedAppraisalGrid.jsx` | Builds `photoStripParcels`, mounts the strip, adds an "Include Photos" toggle in the export modal, makes the map preview collapsible (capture div stays mounted offscreen for `html2canvas`), and emits the new "Subject & Comps Photos" page in `generatePDF`. |
| `src/components/job-modules/final-valuation-tabs/AppealLogTab.jsx` | `buildPrintablePdfForAppeal` recognizes `subject & comps photos` as a new bucket and slots it into canonical order. Prefers the new page over the legacy PowerComp packet — PowerComp is now a fallback only for legacy reports. |

**Storage contract:**

- One row per `(job_id, property_composite_key)` in `appeal_photos` — the
  unique constraint is the enforcement point. Re-picking calls
  `storage.remove([oldStoragePath])` then upserts the row.
- Storage bucket `appeal-photos` is private. Path
  `<jobId>/<safe_composite_key>/front_<timestamp>.<ext>` where
  `safe_composite_key` is the composite key with non-`[a-zA-Z0-9._-]`
  characters replaced by `_`.
- `source` column tracks provenance (`powercama` / `powerpad` /
  `user_upload` / `clipboard`).
- `capture_ts` column carries the PowerCama T-stamp when present so the
  caption can show "captured 11/06/24 2:45pm" downstream.

**PDF output integration:**

`DetailedAppraisalGrid.generatePDF` adds the Photos page after the Map
page. 3×2 grid on a landscape letter, role label only as caption (no
addresses — those are already on the comp grid earlier in the report).
Page is silently skipped if no parcels in `photoStripParcels` have a
picked photo.

`AppealLogTab.buildPrintablePdfForAppeal` re-classifies the saved report
PDF's pages by keyword scanning. New `buckets.photos` matches
`subject & comps photos` (handling both `&` and `&amp;`). Canonical print
order is now:

1. Static comp grid
2. Dynamic Adjustments
3. **Direct-from-folder Photos page** (new — preferred)
4. Legacy PowerComp packet (fallback only when (3) is absent)
5. Subject & Comps Location Map
6. Appellant Evidence Summary
7. Chapter 123 Test
8. Anything unclassified, in original order

**Key constraints enforced by the design:**

- **Per parcel, not per role.** A parcel that's a Subject in one appeal
  and a Comp in another shares the same picked photo. `appeal_photos` has
  `unique (job_id, property_composite_key)`. There is intentionally no
  `parcel_role` column.
- **Appellant comps are NOT included in the Detailed strip.** Per user
  request, those will get their own pick UI off `AppellantEvidencePanel`
  (next branch).
- **The folder picker is blocked in the editor preview iframe** by
  Chromium spec. `canUsePersistentPicker()` returns false and the panel
  surfaces an `IFRAME_BLOCKED` warning with an "Open in New Tab" button.
  Push-and-test is the only way to validate the full flow.

---

## 12. Ground Rules for New Branches

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
| Geocoder uses a manual CSV round-trip instead of an API call | The Census Bureau batch geocoder is free but rate-limited and synchronous. Doing it manually (download CSV → upload to Census → upload result back) avoids API keys, billing, and throttling. The tool chunks at exactly 10,000 rows because that's the Census batch ceiling. |
| `property_composite_key` gets a `__<zipIdx>` suffix on Census variant rows | The ZIP-sweep pass deliberately submits multiple postal-ZIP variants for the same parcel. The synthetic suffix is stripped on result import (`stripVariantSuffix`) so all variant matches collapse back to the same parent property. |
| `geocode_source = 'skipped'` is a real value, not a null | We need to remember that a parcel was *intentionally* skipped (no street number, etc.) so it stops re-appearing in the outstanding-work list. Treat it as a third state, not as "missing coords". |
| Condo children inherit the mother lot's lat/lng instead of being geocoded individually | Condo children share a footprint with the mother lot, and Census often can't geocode a `<address> UNIT 4B` cleanly. Inherited coords are stamped `geocode_source = 'inherited_motherlot'` so they're distinguishable from real Census matches. |
| `AppealLogTab` re-classifies pages of a saved appeal report at print time | The Detailed tab uploads the report once. Photos / map / appellant evidence / Chapter 123 sections may not all exist on every subject, and we want a canonical print order regardless. We use pdfjs to *read* each page's text and bucket it, then re-emit with `pdf-lib` — this is intentional and handles legacy exports that pre-date the section headers. |
| PowerComp PDF parser keys off textual landmarks, not coordinates | BRT regenerates these PDFs from layout templates that drift slightly between releases. Keying off `Subject` / `Block Lot Qualifier Card` / `Sales Date` text is layout-tolerant; switching to coordinate-based extraction would break on the next BRT update. |
| PowerComp photo pages carry a "BRT Technologies PowerComp" footer | Attribution is required — they generated the photos, we're just bundling them into our deliverable. Don't strip the footer. |
| `AppealLogTab.CME_BRACKETS` and `SalesComparisonTab.CME_BRACKETS` are two separate arrays with different labels | Appeal Log uses short labels (`$200K-$299K`) so they fit the column; CME uses long labels (`$200,000-$299,999`) for the dropdown. They share identical `min`/`max`/order, and the AppealLog→CME handoff matches by `min` (with a literal-label fast path) so the two label vocabularies don't have to converge. |
| Sales-pool window subtracts one year from `end_date.year` for Lojik tenants (`org_type = 'assessor'`) | For Lojik jobs, `end_date` is the *job* end (one year past the assessment year). Without the `-1`, every sales-window-based filter (CSP, sales pool, coordinate cleanup queue) shifts forward by 12 months and silently wrong-buckets a year of sales. |
| Step 5 chip filters in the Geocoder narrow only the manual cleanup list — not the bulk CSV emitters | Bulk Census runs are intentionally always full-job. Chip filters are scoped to the human cleanup queue so a manager can prioritize CSP-class-2 sales without accidentally emitting a partial Census CSV that *looks* like a complete town. |
| The user-facing `CoordinatesSubTab` reads `properties` from its parent and **does not** refetch | The Data Quality parent already loads everything needed. A second fetch would race with manual saves and confuse the patch-overlay model used to move rows between Pending/Review/Fixed buckets without a reload. |
| `appeal_photos` is unique on `(job_id, property_composite_key)` — no `parcel_role` column | Per user decision, one parcel = one front photo regardless of which appeal is using it as Subject vs Comp. Re-picking replaces. Don't add `parcel_role`; it would create duplicate uploads of the same image and complicate the AppealLog batch-print classifier. |
| Folder-picker code paths still exist even though they don't work in the iframe | We can't run `showDirectoryPicker` from inside the editor preview, but the code must still work on real deploys (Netlify, staging URL). The panel surfaces an `IFRAME_BLOCKED` warning + "Open in New Tab" affordance, then the user pushes to test. |
| `parsePhotoName` skips `.BAK` files entirely (not even counted as `unmatched`) | PowerCama "soft-deletes" photos by appending `.BAK` to the original filename. They're tombstones, not photos. Counting them inflates the `unmatched` total and makes the parser look broken. |
| `parsePhotoName` accepts `T<14 digits>` in the photo-number slot | PowerCama embeds a `TYYYYMMDDHHMMSS` capture timestamp instead of (or in addition to) a simple sequence number. Without this, Glen Gardner (CCDD 1012) returned `0 parcels with photos` even with 722 photo files on disk. The 14-digit timestamp is parsed into `captureTs + captureSeq` and combined into a single sortable `photoNum` so "highest = most recent" still works. |
| `JobPhotoSourceContext` walks the disk once per session; the strip reads from the same map | The disk walk is the expensive operation (a `for await` over thousands of file entries). The Panel and the Strip MUST share the index — re-walking from each consumer would multiply the cost by N consumers and create drift if the user re-indexes mid-session. |
| `AppealLogTab.buildPrintablePdfForAppeal` prefers the `appeal_photos` page over the `powercomp-photos` packet | The two are mutually exclusive in canonical order. The new direct-from-folder page is the source of truth. The PowerComp packet stays as a fallback so legacy appeals (pre-`appeal_photos`) still render correctly. |

### Lessons Learned the Hard Way

1. **The EFA conversion chain** — Microsystems stores effective age as years-of-age in their source file. The processor converts it to a year (`yearPrior - age`) for storage. `MarketDataTab` converts it back to age for display. The DEPR formula uses age directly for Microsystems and `yearPrior - year` for BRT. Touching any part of this chain without understanding the full flow will produce incorrect valuations across the entire job.

2. **Don't "fix" the data pipeline processors** — `brt-processor.js` and `microsystems-processor.js` map vendor-specific field names to our normalized schema. The field mappings look arbitrary but match exact vendor export formats that municipalities provide. Renaming or reordering breaks real uploads.

3. **Large components are load-bearing** — `LandValuationTab.jsx` (12,678 lines) handles bracket analysis, vacant sales, allocation studies, cascade rates, eco-obs adjustments, and per-block worksheets. These features share internal state. Previous attempts to split it created race conditions and stale-state bugs.

4. **CME adjustment grid is bracket-aware** — The `job_adjustment_grid` has `bracket_0` through `bracket_9` columns. These map to price brackets defined in `job_cme_bracket_mappings`. The mapping between VCS codes, type-use codes, and brackets is municipality-specific. Don't assume uniform bracket definitions.

5. **Multi-tenant scoping is not optional** — Every query that touches jobs, employees, or properties must respect `organization_id`. The `internal` org can see everything, `assessor` orgs can only see their own data. The `job_access_grants` table allows controlled cross-job access for specific employees — this is not a bug.

6. **Appeal log import formats vary** — Each county board has its own export format. The import logic in `AppealLogTab` handles XLS, CSV, PDF, and manual entry. The field mapping is deliberately flexible because no two counties produce the same export.

7. **Don't add loading states or spinners** to working flows — If a component doesn't show a loading spinner, it's probably because the data loads fast enough that a spinner causes more visual disruption than a brief blank frame.

8. **`comparison_reports` are generated, not user-created** — They're produced automatically when a new source file is uploaded over an existing one. Don't expose CRUD for them.

9. **The geocoder is the *only* source of `property_latitude` / `property_longitude`** — Don't write coords from anywhere else. The four-value contract (`property_latitude`, `property_longitude`, `geocode_source`, `geocode_match_quality`) must be written together so downstream filters (CME distance filter, AppealMap, GeocodeStatusChip) can trust the source provenance. Mother-lot inheritance and manual entry already follow this contract — match it.

10. **Distance filter must short-circuit when subject has no coords** — Don't silently include or exclude comps when the subject is un-geocoded. Disable the filter input and explain why, so the user understands they need to geocode the subject first.

11. **Don't change BRT's PowerComp CSV format without testing it in BRT** — BRT silently rejects rows that don't match its expected column layout. The `="..."` formula-style wrappers were rejected in an earlier rev; we now write raw cell values. If you change the export shape, validate by re-importing the CSV into PowerComp before shipping.

12. **PowerComp photo packets are immutable post-import** — We store sliced sub-PDFs in the `powercomp-photos` bucket. If PowerComp re-issues a different photo set for the same property, re-import; don't try to merge or diff.

13. **AppealLog → CME bracket label parity** — `AppealLogTab.jsx` defines its own `CME_BRACKETS` array with **abbreviated** labels (`Under $100K`, `$200K-$299K`, `$1M-$1.49M`, `$2M+`) so the bracket column fits the table. `SalesComparisonTab.jsx` defines its own `CME_BRACKETS` with **full** labels (`up to $99,999`, `$200,000-$299,999`, `Over $2,000,000`). When Appeal Log sends selected subjects to CME via the navigation payload, the `bracket` field carries the abbreviated label. The two arrays share identical `min` values and identical order, so `SalesComparisonTab` matches `initialBracket` first by literal label compare and then falls back to a `parseAppealLogBracketMin` helper that turns the abbreviated label into a number and matches by `min`. Keep both arrays in sync — if you add a price tier to one, add it to the other and preserve the index/min mapping. Don't try to "unify" the labels by editing one side; the abbreviated labels exist for column-width reasons in Appeal Log.

14. **The chip-filter sales window must use `sales_date`, and the loader must select it** — The admin Geocoder's `fetchAllJobProperties` originally didn't select `sales_date`, so the Step 5 sales-pool chip silently matched zero rows on every job. Same trap will apply to any new filter that depends on a column not already in the loader's `select` list. When adding a chip filter that reads a property field, audit the loader query first — the SubTab loader is the parent component (DataQualityTab parent), the admin Geocoder loader is `fetchAllJobProperties` near the top of `GeocodingTool.jsx`.

15. **Sales-pool window math is shared and Lojik-aware** — `SalesComparisonTab.getCSPDateRange`, `AppellantEvidencePanel.sampleRange`, `DetailedAppraisalGrid` (inline in the comps prep), the admin Geocoder's `csvSalesWindow`, and `CoordinatesSubTab.salesWindow` all anchor on `jobs.end_date` and all subtract one from the year when `organizations.org_type === 'assessor'` (Lojik). Don't fork this convention. If the window definition needs to change, change all five usages together — and confirm with the user, because that math is the basis for sales review, sales pool inclusion, comp date ranges, and the coordinate cleanup queue.

😊
