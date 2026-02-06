# Management OS - Unified Reference Guide

## 🚨 CLAUDE CHAT PROTOCOLS 🚨

**TEAMWORK MAKES THE DREAMWORK!**

- **READ EVERYTHING FULLY** - Don't skim, reference this complete document
- **DON'T CODE UNLESS PROMPTED** - Let's discuss the approach first, partner
- **ALWAYS CHECK THE SCHEMA** - No assumptions, we have the whole schema attached with the fields
- **CHECK CURRENT CODE** - Scan for any deleted schema references that could cause errors
- **ASK IF YOU DON'T HAVE IT** - Don't recreate what we've already built
- **DON'T ENHANCE WITHOUT PERMISSION** - You've done this too many times, buddy!
- **QUALITY > SPEED** - Focus on getting it right, not fast responses
- **DON'T PREDICT** - Use the chat wisely, let me guide the conversation
- **DEFAULT: CODE ARTIFACTS** - Never React unless I explicitly request it

**Critical Reality Checks:**
- **NO CODE? NO FIXES!** - If you didn't give me the component code, STOP ME immediately
- **WRONG FILE ATTACHED?** - If something seems off, SAY IT! Don't politely work with the wrong code
- **VERIFY FIRST** - "Are we looking at AdminJobManagement.jsx or did you mean to attach something else?"
- **SPEAK UP** - If you attached EmployeeManagement but we're discussing ProductionTracker, I need to catch that IMMEDIATELY

**When Providing Fixes:**
- **BE SPECIFIC ABOUT LOCATION** - Tell me exactly where the section starts and ends
- **SHOW CONTEXT** - Include a few lines before/after (especially for closing divs/braces)
- **USE PROPER INDENTATION** - We're copy-pasting, make it match our code style
- **IDENTIFY THE COMPONENT** - Which file, which function, which section

**Remember the "WE"** - This is our collaborative partnership, not just coding help

## Executive Summary

**Company**: LOJIK for Professional Property Appraisers Inc  
**System**: React/Supabase property appraisal workflow management platform  
**Development**: 100% online via GitHub Codespaces (no local files)  
**Deployment**: GitHub → Vercel  
**Tech Stack**: React, Supabase PostgreSQL, file processing pipelines  
**Scale**: Production system handling 50-100K+ property records

**Mission**: Transform Excel-based workflows into database-driven intelligence. Handle entire lifecycle from job creation to appeal defense with sophisticated data processing, real-time analytics, and workflow orchestration.

**Key Value Propositions:**
- Transforms Jim's methodology into documented, repeatable processes
- Enables knowledge transfer and team standardization
- Provides complete audit trails for legal defense
- Scales property assessment operations to enterprise level
- Eliminates Excel hell and Google Drive chaos

## Recent Schema Optimizations (September 2024)

### Job Archive & Lifecycle Management (January 2025)
- **New Feature**: Archive/restore jobs with checklist validation
- **Database Fields**: Added `archived_at` (timestamp) and `archived_by` (uuid) to `jobs` table
- **Billing Integration**: Archived jobs automatically move from Active to Legacy in BillingManagement
- **User Experience**: Warning modal if checklist incomplete, option to archive anyway, restore button on archived jobs
- **Filter Logic**: `activeJobs` excludes archived, `legacyJobs` includes archived regardless of job_type
- **Data Preservation**: All payment history and job data preserved when archived

### The Performance Crisis
- **Problem**: 50,000+ total properties across all jobs (16,000+ in largest single job)
- **Issue**: Each property storing its own `raw_data` JSONB field created massive bottlenecks
- **Symptoms**: File uploads stuck in infinite initialization loops, protected field fetching difficulties

### The Solution Architecture
**Consolidated Raw Data Storage Pattern:**
- **Before**: Every property stored complete `raw_data` JSONB (50,000+ copies!)
- **After**: Single `raw_file_content` TEXT field at job level (1 copy instead of 16,000!)
- **Result**: Dramatically reduced database size, eliminated initialization loops, faster queries

**Field Migration Strategy:**
The optimization split `property_records` into THREE destinations:

1. **jobs table** - Got job-wide settings:
   - `project_start_date` (applies to all properties in job)
   - `validation_status` (overall job validation)
   - `raw_file_content` (consolidated raw data for entire job)
   - Added tracking: `raw_file_parsed_at`, `raw_file_rows_count`, `raw_file_size`
   - `external_inspectors` (comma-separated list of client codes)

2. **property_market_analysis** (NEW TABLE) - Got property-specific analysis fields:
   - Manual entry fields: `asset_key_page`, `asset_map_page`, `asset_zoning`, `location_analysis`, `new_vcs`
   - Calculated values: `values_norm_size`, `values_norm_time`
   - `sales_history` tracking
   - Property-level `validation_status`

3. **market_land_valuation** - Enhanced with:
   - Granular economic obsolescence tracking (4 eco_obs_* fields)
   - Consolidated `zoning_config` JSONB
   - New `target_allocation` and `ignored_issues` features

### Performance Benefits
- Database size reduced by ~95% for raw data storage
- Query performance improved 10x for property listings
- Eliminated timeout issues during file uploads
- Better separation of concerns (job vs property vs analysis data)
- Validation override syncing prevents duplicate key errors
- Processing modal batches decisions for single database write
- Override records include complete property data to avoid lookups

## System Architecture

### Core Data Flow Pattern

```
Vendor Files (BRT/Microsystems) → FileUploadButton (Comparison) → Processors/Updaters → Database → Analytics → UI
```

**Critical Pattern: INSERT vs UPSERT**
- **Initial Import**: AdminJobManagement ��� processors → INSERT new records (job creation)
- **Ongoing Updates**: FileUploadButton → updaters → UPSERT operations (file maintenance)

### Module Data Loading Architecture (NEW)

**JobContainer as Central Data Orchestrator**:
```
JobContainer (loads once with pagination)
    ├── Loads ALL property_records (handles 5K-16K+ records efficiently)
    ├── Applies assignment filtering if has_property_assignments = true
    ├── Fetches job metadata (code definitions, vendor type, dates)
    ├── Shows progress in banner (not modal!)
    └── Distributes via props to:
        ├── ProductionTracker (existing pattern)
        ├── MarketLandAnalysis (NEW: no double loading!)
        ├── ManagementChecklist  
        ├── FinalValuation
        └── AppealCoverage
```

**Assignment-Aware Loading Pattern**:
- Checks `jobs.has_property_assignments` flag
- When true, adds `.eq('is_assigned_property', true)` to query
- Shows "Assigned Properties Only" badge in UI banner
- Single query with proper filtering at database level
- Consistent across all modules receiving data

**Props Interface for ProductionTracker**:
- `properties`: Array of current property_records (filtered if has_property_assignments)
- `inspectionData`: Array of inspection_data records for the job
- `employees`: Array of all employees for inspector validation
- `dataUpdateNotification`: Signal from JobContainer when data refreshes
- `clearDataNotification`: Function to clear the notification
- `latestFileVersion`: Current file version number
- `onUpdateWorkflowStats`: Callback to update App.js state
- `currentWorkflowStats`: Current workflow statistics from App.js

**Loading Performance Metrics**:
- 5,000 properties: ~5 seconds
- 13,000 properties: ~13 seconds
- 16,000+ properties: ~16-20 seconds
- Batch size: 1000 records per page
- Small delay between batches: 100ms

### Repository Structure

**Complete Project Organization:**

```
/
├── public/                            ← Public assets and HTML entry point
│   ├── index.html                     ← App entry point (title: "Mgmt OS")
│   ├── favicon.ico                    ← Browser tab icon
│   └── hr-documents/                  ← Employee handbook and forms
│       ├── employee-handbook.pdf
│       ├── i9-form.pdf
│       └── time-off-request-form.pdf
│
���── sql/                               ← Database migration and optimization scripts
│   ├── optimize_new_structure.sql     ← Schema optimizations (Sept 2024)
│   └── remaining_optimizations.sql    ← Additional performance improvements
│
├── src/                               ← Main application source code
│   ├── components/                    ← React component library
│   │   ├── AdminJobManagement.jsx     ← Job list, creation, assignment management (3,200+ lines!)
│   │   ├── EmployeeManagement.jsx     ← Staff management with bulk operations (2,600+ lines!)
│   │   ├── BillingManagement.jsx      ← Contract setup, billing events, payment tracking (3,300+ lines!)
│   │   ├── PayrollManagement.jsx      ← Office Manager chaos killer, inspection bonuses (1,100 lines)
│   │   ├── LandingPage.jsx            ← Initial dashboard/landing page
│   │   ├── LandingPage.css            ← Landing page styles
│   │   ├── UserManagement.jsx         ← User account management (Primary Owner only)
│   │   ├── UserManagement.css         ← User management styles
│   │   ├── OrganizationManagement.jsx ← Multi-tenant client org management (Primary Owner only)
│   │   ├── OrganizationManagement.css ← Organization management styles
│   │   ├── RevenueManagement.jsx      ← Invoice/billing tracking placeholder (Primary Owner only)
│   │   ├── RevenueManagement.css      ← Revenue management styles
│   │   ├── VirtualPropertyList.jsx    ← Paginated property display component (performance optimization)
│   │   └── job-modules/               ← Job-specific workflow modules
│   │       ├── JobContainer.jsx       ← Job module dispatcher, navigation & DATA LOADER (NEW ROLE!)
│   │       ├── ManagementChecklist.jsx ← 29-item workflow management (IMPLEMENTED)
│   ��       ├── ProductionTracker.jsx  ← Analytics & payroll engine (IMPLEMENTED - 4,400+ lines!)
│   │       ├── FileUploadButton.jsx   ← Comparison engine & workflow orchestrator (CORRECTED LOCATION!)
│   │       ├── MarketAnalysis.jsx     ← 6-tab valuation parent component (173 lines - orchestrator)
│   │       ├── market-tabs/           ← Market analysis tab components (NEW PATTERN!)
│   │       │   ├── DataQualityTab.jsx      ← Data validation and error checking (2,651 lines)
│   │       │   ├── PreValuationTab.jsx     ← Normalization + Page by Page worksheet (3,726 lines)
│   │       │   ├── OverallAnalysisTab.jsx  ← Block mapping + consistency metrics (~1,000 lines)
│   │       │   ├── LandValuationTab.jsx    ← 7-section land methodology (~10,000 lines!) THE BEAST
│   │       │   ├── CostValuationTab.jsx    ← New construction + CCF (~800 lines)
│   │       │   ├── AttributeCardsTab.jsx   ← Condition/misc items + cards (~2,500 lines)
│   │       │   ├── LandValuationTab.css    ← Land valuation styles
│   │       │   └── sharedTabNav.css        ← Shared tab navigation styles
│   │       ├── FinalValuation.jsx     ← 5-tab final valuation parent (IMPLEMENTED - 170 lines)
│   │       ├── final-valuation-tabs/  ← Final valuation tab components (SAME PATTERN!)
│   │       │   ├── SalesReviewTab.jsx      ← Sales history review & decisions (1,879 lines)
│   │       │   ├── MarketDataTab.jsx       ← Depreciation & effective age calc (1,551 lines)
│   │       │   ├── RatableComparisonTab.jsx ← Tax rate impact analysis (1,112 lines)
│   │       │   ├── SalesComparisonTab.jsx  ← CME comparable search (2,812 lines) THE BIG ONE!
│   │       │   ├── AdjustmentsTab.jsx      ← CME adjustment grid config (1,325 lines)
│   │       │   ├── DetailedAppraisalGrid.jsx ← Manual appraisal interface (577 lines)
│   │       │   └── AnalyticsTab.jsx        ← Final value recommendations (441 lines)
│   │       └── AppealCoverage.jsx     ← Litigation support system (PLACEHOLDER)
│   │
│   ├── lib/                           ← Business logic, services, and utilities
│   │   ├── supabaseClient.js          ← Core Supabase config + ALL SERVICES + interpretCodes
│   │   │                                 Contains:
│   │   │                                 - Supabase client initialization
│   │   │                                 - employeeService (CRUD operations)
│   │   │                                 - jobService (Job management)
│   │   │                                 - propertyService (Property data access)
│   │   │                                 - checklistService (Checklist operations)
│   │   │                                 - interpretCodes (Vendor-agnostic code interpretation)
│   │   │                                 - Field mapping utilities (camelCase ↔ snake_case)
│   │   │
│   │   └── data-pipeline/             ← Vendor-specific file processing
│   │       ├── brt-processor.js       ← BRT initial job creation (INSERT)
│   │       ├── brt-updater.js         ← BRT ongoing updates (UPSERT)
│   │       ├─��� microsystems-processor.js  ��� Microsystems initial job creation (INSERT)
│   │       └── microsystems-updater.js    ← Microsystems ongoing updates (UPSERT)
│   │
│   ├── App.js                         ← Central navigation + module state hub (MAIN APP)
│   ├── App.css                        ← Global application styles
│   ├── index.js                       ← React DOM entry point
│   └── index.css                      ← Global CSS reset and utilities
│
├── package.json                       ← Dependencies, scripts, project metadata
├── package-lock.json                  ← Dependency lock file (exact versions)
├── .gitignore                         ← Git exclusion rules
├── README.md                          ← Project documentation
├── COMPONENT_MIGRATION_PLAN.md        ← Component refactoring roadmap
├── DISCLAIMER.md                      ← Legal disclaimer
├── LICENSE                            ← Software license
└── management-os-guide.md             ← THIS DOCUMENT! Complete system documentation
```

**Component Organization Pattern (NEW!):**

The `market-tabs/` sub-folder demonstrates a scalable organization pattern:
- **Parent Orchestrator**: `MarketAnalysis.jsx` (173 lines) - lightweight coordinator
- **Child Tab Components**: In `market-tabs/` sub-folder - heavy implementations
- **Benefits**:
  - Cleaner file organization
  - Easier navigation
  - Logical grouping of related components
  - Potential for code splitting/lazy loading
  - Can be applied to other complex modules (FinalValuation, AppealCoverage)

**Service Architecture Pattern:**

All services in `lib/supabaseClient.js` follow consistent patterns:
- **CRUD Operations**: Create, Read, Update, Delete
- **Field Mapping**: Automatic camelCase ↔ snake_case conversion
- **Error Handling**: Try-catch with detailed error messages
- **Retry Logic**: Exponential backoff for failed operations
- **Validation**: Input validation before database operations
- **Consistency**: Same patterns across all services (employee, job, property, checklist)

**Example Service Pattern:**
```javascript
// lib/supabaseClient.js structure
export const jobService = {
  async getAllJobs() { /* Fetch all jobs */ },
  async getJobById(id) { /* Fetch single job */ },
  async createJob(jobData) { /* Insert new job */ },
  async updateJob(id, updates) { /* Update job */ },
  async deleteJob(id) { /* Delete job + cascade */ }
  // All methods include field mapping and error handling
};

export const employeeService = { /* Same pattern */ };
export const propertyService = { /* Same pattern */ };
export const checklistService = { /* Same pattern */ };
```

**Data Pipeline Structure:**

Processors vs Updaters (Consistent Pattern):
- **Processors** (`*-processor.js`): Initial job creation
  - INSERT operations only
  - Sets `is_new_since_last_upload: true`
  - Cleanup mechanism on failure
  - Used by AdminJobManagement
  
- **Updaters** (`*-updater.js`): Ongoing file updates
  - UPSERT operations (INSERT or UPDATE)
  - Preserves user-modified fields
  - Rollback mechanism on failure
  - Used by FileUploadButton

**SQL Migration Scripts:**

The `sql/` folder contains database optimization scripts:
- **optimize_new_structure.sql**: September 2024 schema optimizations
  - Consolidated raw data storage
  - Added property_market_analysis table
  - Created performance indexes
  - Removed redundant tables/columns
  
- **remaining_optimizations.sql**: Additional improvements
  - Index tuning
  - Query optimization
  - Cascade deletion rules

**Build Configuration:**

- **package.json**: Contains all dependencies and npm scripts
  - `npm start`: Development server
  - `npm run build`: Production build
  - `npm test`: Test suite
  - Dependencies locked via package-lock.json for reproducible builds
  
**Critical File Locations (Corrections):**

- ❌ **WRONG**: `components/FileUploadButton.jsx`
- ✅ **CORRECT**: `components/job-modules/FileUploadButton.jsx`

**Component Line Count Updates:**

| Component | Lines | Module | Notes |
|-----------|-------|--------|-------|
| LandValuationTab.jsx | ~10,000 | Market Analysis | THE ABSOLUTE LARGEST! |
| ProductionTracker.jsx | 4,400+ | Job Container | Analytics engine |
| PreValuationTab.jsx | 3,726 | Market Analysis | Normalization workflows |
| SalesComparisonTab.jsx | 2,812 | Final Valuation | CME comparable search |
| DataQualityTab.jsx | 2,651 | Market Analysis | Data validation |
| AttributeCardsTab.jsx | ~2,500 | Market Analysis | Condition items + cards |
| SalesReviewTab.jsx | 1,879 | Final Valuation | Sales history review |
| MarketDataTab.jsx | 1,551 | Final Valuation | Effective age calc |
| AdjustmentsTab.jsx | 1,325 | Final Valuation | CME adjustment grid |
| RatableComparisonTab.jsx | 1,112 | Final Valuation | Tax rate impact |
| OverallAnalysisTab.jsx | ~1,000 | Market Analysis | Block mapping |
| CostValuationTab.jsx | ~800 | Market Analysis | New construction + CCF |
| DetailedAppraisalGrid.jsx | 577 | Final Valuation | Manual appraisal |
| AnalyticsTab.jsx | 441 | Final Valuation | Final recommendations |

**Public Assets:**

- **index.html**: Entry point with app title "Mgmt OS"
- **favicon.ico**: Browser tab icon
- **hr-documents/**: Employee resources (handbook, forms) served statically
### Data Interpretation Layer (interpretCodes) - ENHANCED

**Location**: `src/lib/supabaseClient.js` - interpretCodes export

**Purpose**: Vendor-agnostic utility service for MarketLandAnalysis module's complex property data validation across BRT and Microsystems vendors.

**Complete Architecture**:
```javascript
export const interpretCodes = {
  // Configuration Maps - Vendor-specific field mappings
  microsystemsPrefixMap: {
    'inspection_info_by': '140',    // InfoBy codes
    'asset_building_class': '345',  // Quality class
    'asset_ext_cond': '490',       // Exterior condition
    'asset_int_cond': '491',       // Interior condition
    'asset_type_use': '500',       // Property type
    'asset_stories': '510',        // Story height
    'asset_design_style': '520',   // Design/style
    'vcs': '210',                  // VCS = Neighborhood!
    'topo': '115',                 // Topography
    'road': '120',                 // Road type
    'curbing': '125',              // Curbing
    'sidewalk': '130',             // Sidewalk
    'utilities': '135',            // Utilities
    'zone_table': '205',           // Zoning
    'farmland_override': '212',    // Farmland
    'land_adjustments': '220',     // Land adjustments
    'renovation_impr': '235',      // Renovations
    'bath_kitchen_dep': '245',     // Bath/kitchen depreciation
    'functional_depr': '250',      // Functional depreciation
    'locational_depr': '260',      // Locational depreciation
    'item_adjustment': '346',      // Item adjustments
    'exterior': '530',             // Exterior walls
    'roof_type': '540',            // Roof type
    'roof_material': '545',        // Roof material
    'foundation': '550',           // Foundation
    'interior_wall': '555',        // Interior walls
    'electric': '557',             // Electric
    'roof_pitch': '559',           // Roof pitch
    'heat_source': '565',          // Heat source
    'built_ins_590': '590',        // Built-ins
    'built_ins_591': '591',        // More built-ins
    'detached_items': '680'        // Detached items
  },
  
  brtSectionMap: {
    'asset_design_style': '23',    // Design section
    'asset_building_class': '20',  // Building class section
    'asset_type_use': '21',        // Type use section
    'asset_stories': '22',         // Stories section
    'asset_ext_cond': '60',        // Condition section (exterior)
    'asset_int_cond': '60',        // Condition section (interior)
    'inspection_info_by': '53',    // InfoBy section
    'roof_type': '24',             // Roof type section
    'roof_material': '25',         // Roof material section
    'exterior_finish': '26',       // Exterior finish section
    'foundation': '27',            // Foundation section
    'interior_finish': '28',       // Interior finish section
    'floor_finish': '29',          // Floor finish section
    'basement': '30',              // Basement section
    'heat_source': '31',           // Heat source section
    'heat_system': '32',           // Heat system section
    'electric': '33',              // Electric section
    'air_cond': '34',              // Air conditioning section
    'plumbing': '35',              // Plumbing section
    'fireplace': '36',             // Fireplace section
    'attic_dormer': '37',          // Attic/dormer section
    'garages': '41',               // Garages section
    'neighborhood': '50',          // Neighborhood section
    'view': '51',                  // View section
    'utilities': '52',             // Utilities section
    'road': '54',                  // Road section
    'curbing': '55',               // Curbing section
    'sidewalk': '56',              // Sidewalk section
    'condition': '60',             // General condition section
    'vcs': 'special'               // VCS handled specially
  },
  
  // Core Lookup Functions
  getMicrosystemsValue(property, codeDefinitions, fieldName),  // Handles PREFIX+CODE+9999 format
  getBRTValue(property, codeDefinitions, fieldName, sectionNumber), // Navigates nested MAP structures
  
  // Code Interpreters - Human-readable translations
  getDesignName(property, codeDefinitions, vendorType),        // "CL" → "COLONIAL"
  getTypeName(property, codeDefinitions, vendorType),          // "10" → "SINGLE FAMILY"
  getExteriorConditionName(property, codeDefinitions, vendorType), // "G" → "GOOD"
  getInteriorConditionName(property, codeDefinitions, vendorType), // "F" → "FAIR"
  
  // VCS (Valuation Control Sector) = Neighborhood Functions
  getVCSDescription(property, codeDefinitions, vendorType),    // "41" → "NORTH SIDE (EAST OF WASH)"
  getAllVCSCodes(codeDefinitions, vendorType),                // Returns all codes for dropdowns
  
  // Data Aggregators - Combine multiple fields
  getTotalLotSize(property, vendorType),      // Sums LANDUR fields, converts units
  getBathroomPlumbingSum(property, vendorType), // BRT PLUMBING2FIX through PLUMBING6FIX
  getBathroomFixtureSum(property, vendorType),  // Microsystems summary fields
  getBathroomRoomSum(property, vendorType),     // Microsystems floor-specific (B,1,2,3)
  getBedroomRoomSum(property, vendorType),      // Microsystems floor-specific
  
  // Field Accessors
  getRawDataValue(property, fieldName, vendorType), // Vendor-aware field name mapping
  isFieldEmpty(value)                              // Null/undefined/whitespace checking
};
```

**VCS Structure Differences (Critical for MarketLandAnalysis)**:
- **BRT**: Nested JSON at `sections.VCS[number]["9"]["DATA"]["VALUE"]` 
  - Example: VCS section 41 → subsection 9 → "NORTH SIDE (EAST OF WASH)"
  - Typically 55+ neighborhood entries
- **Microsystems**: Flat structure `210XXXX9999` format 
  - Example: "210BCLR9999" → "BIDDLE CREEK LOW RES"
  - Over 200 neighborhood codes

## Database Schema (Current - Post-September 2024 Optimization)

### ✅ Database Optimization Summary
- **14 tables deleted** (saved ~488 kB)
- **Multiple columns dropped** from remaining tables
- **4 duplicate indexes removed**
- **5 new performance indexes added**
- **NEW table added**: `property_market_analysis` for field migration
- **Major refactor**: Raw data consolidated from property to job level

### Multi-Tenant Architecture (February 2025)

**Purpose**: Enable external client access (Lojik CME assessor clients) while keeping PPA internal operations separate.

**Organization Types:**
- `internal` - PPA Associates (never charged, full access)
- `assessor` - External clients (billed based on line items + users)

**Pricing Model:**
- Base fee based on line item count (primary cards only)
- Primary user: $500/year
- Additional staff: $250/year each
- Government billing: Invoice → PO → Payment (no Stripe)

**Tables Modified:**
- `jobs` - Added `organization_id` (required)
- `employees` - Added `organization_id` (required)
- `profiles` - Added `organization_id` (required)
- `planning_jobs` - Added `organization_id` (required)

**New UI Components:**
- `OrganizationManagement.jsx` - Add/manage client orgs, staff, billing status
- `RevenueManagement.jsx` - Placeholder for invoice tracking (coming soon)

**Access Control:**
| Tab | Who Can See |
|-----|-------------|
| Employees, Jobs, Appeal Coverage | All Users |
| Billing, Payroll | Admin + Owner |
| Users, Organizations, Revenue | Primary Owner Only |

#### **organizations** (NEW - February 2025)
**Component:** `OrganizationManagement.jsx`

| Column | Data Type | Description |
|--------|-----------|-------------|
| id | uuid | Primary key |
| name | text | Organization name |
| slug | text | URL-friendly identifier |
| org_type | text | 'internal' or 'assessor' |
| single_job_mode | boolean | Skip job list on login |
| default_job_id | uuid | For single-job orgs |
| tab_config | jsonb | Which tabs org users can see |
| primary_contact_name | text | Billing contact |
| primary_contact_email | text | Billing email |
| billing_address | text | Invoice address |
| line_item_count | integer | For fee calculation |
| subscription_status | text | active/suspended/cancelled/trial |
| invoice_sent_date | date | Billing workflow |
| po_received_date | date | Billing workflow |
| payment_received_date | date | Billing workflow |
| renewal_date | date | Annual renewal |
| annual_fee | numeric | Calculated fee |
| created_at | timestamptz | Audit |
| updated_at | timestamptz | Audit |

**PPA Organization ID:** `00000000-0000-0000-0000-000000000001`

---

### Core Production Tables with Component Mappings

#### **billing_events**
**Component:** `BillingManagement.jsx`
- Individual billing records with dates, percentages, invoice numbers, and amounts
- Key fields: job_id, billing_date, billing_percentage, invoice_number, amount

#### **checklist_documents**
**Component:** `ManagementChecklist.jsx`

| Column | Data Type |
|--------|-----------|
| id | uuid |
| checklist_item_id | uuid |
| file_path | text |
| generated_at | timestamp with time zone |
| is_custom | boolean |
| created_at | timestamp with time zone |
| file_name | text |
| job_id | uuid |
| file_size | bigint |
| uploaded_at | timestamp with time zone |

#### **checklist_item_status**
**Component:** `ManagementChecklist.jsx`

| Column | Data Type |
|--------|-----------|
| id | uuid |
| job_id | uuid |
| item_id | text |
| status | text |
| completed_at | timestamp with time zone |
| completed_by | uuid |
| client_approved | boolean |
| client_approved_date | timestamp with time zone |
| client_approved_by | uuid |
| file_attachment_path | text |
| created_at | timestamp with time zone |
| updated_at | timestamp with time zone |

#### **checklist_items**
**Component:** `ManagementChecklist.jsx`

| Column | Data Type |
|--------|-----------|
| allows_file_upload | boolean |
| auto_completed | boolean |
| auto_update_source | text |
| category | text |
| client_approved | boolean |
| client_approved_by | uuid |
| client_approved_date | timestamp with time zone |
| completed_at | timestamp with time zone |
| completed_by | uuid |
| created_at | timestamp with time zone |
| file_attachment_path | text |
| id | uuid |
| item_order | integer |
| item_text | text |
| job_id | uuid |
| priority | text |
| requires_client_approval | boolean |
| status | text |
| template_item_id | uuid |
| updated_at | timestamp with time zone |

#### **comparison_reports** ⚠️ SCHEMA CHANGED
**Component:** `FileUploadButton.jsx`

| Column | Data Type | Notes |
|--------|-----------|-------|
| created_at | timestamp with time zone | |
| generated_by | text | |
| id | uuid | |
| job_id | uuid | |
| properties_added | jsonb | **NEW** - Track newly added properties |
| properties_modified | jsonb | **NEW** - Track modified properties |
| properties_removed | jsonb | **NEW** - Track removed properties |
| report_data | jsonb | |
| report_date | timestamp with time zone | |
| status | text | |

**Removed columns:** reviewed_by, reviewed_date

#### **county_hpi_data**
**Components:** Created in `AdminJobManagement.jsx`, Used in `PreValuation.jsx`

| Column | Data Type |
|--------|-----------|
| county_name | text |
| created_at | timestamp with time zone |
| hpi_index | numeric |
| id | uuid |
| observation_year | integer |
| updated_at | timestamp with time zone |

#### **employees**
**Component:** `EmployeeManagement.jsx`

| Column | Data Type |
|--------|-----------|
| auth_user_id | uuid |
| created_at | timestamp with time zone |
| created_by | uuid |
| email | text |
| employee_number | text |
| employment_status | text |
| first_name | text |
| has_account | boolean |
| hire_date | date |
| id | uuid |
| initials | text |
| inspector_type | text |
| last_name | text |
| phone | text |
| region | text |
| role | text |
| termination_date | date |
| updated_at | timestamp with time zone |
| weekly_hours | numeric |

#### **expenses**
**Component:** `BillingManagement.jsx`

| Column | Data Type |
|--------|-----------|
| amount | numeric |
| category | character varying |
| created_at | timestamp with time zone |
| id | uuid |
| month | integer |
| year | integer |

#### **inspection_data**
**Components:** Created in `ProductionTracker.jsx`, Used by `EmployeeManagement.jsx` (for global inspector stats)

| Column | Data Type | Notes |
|--------|-----------|-------|
| block | text | |
| card | character varying | |
| file_version | integer | |
| id | uuid | |
| import_session_id | uuid | |
| info_by_code | text | |
| job_id | uuid | |
| list_by | text | |
| list_date | date | |
| lot | text | |
| measure_by | text | |
| measure_date | date | |
| override_applied | boolean | Manager exception flag |
| override_by | text | Who approved override |
| override_date | timestamp without time zone | When override applied |
| override_reason | text | Explanation for exception |
| payroll_period_end | date | |
| payroll_processed_date | date | |
| price_by | text | |
| price_date | date | |
| project_start_date | date | |
| property_class | text | |
| property_composite_key | character varying | Unique constraint |
| property_location | text | |
| qualifier | text | |
| upload_date | timestamp without time zone | |

**Key Pattern**: Single record per property with override fields. Overrides sync to current file_version automatically to prevent duplicate key errors.

#### **job_assignments**
**Component:** `AdminJobManagement.jsx`

| Column | Data Type |
|--------|-----------|
| assigned_by | uuid |
| assigned_date | date |
| created_at | timestamp with time zone |
| employee_id | uuid |
| id | uuid |
| is_active | boolean |
| job_id | uuid |
| role | text |

#### **job_contracts**
**Component:** `BillingManagement.jsx`

| Column | Data Type |
|--------|-----------|
| contract_amount | numeric |
| created_at | timestamp without time zone |
| end_of_job_amount | numeric |
| end_of_job_percentage | numeric |
| first_year_appeals_amount | numeric |
| first_year_appeals_percentage | numeric |
| id | uuid |
| job_id | uuid |
| retainer_amount | numeric |
| retainer_percentage | numeric |
| second_year_appeals_amount | numeric |
| second_year_appeals_percentage | numeric |
| third_year_appeals_amount | numeric |
| third_year_appeals_percentage | numeric |
| updated_at | timestamp without time zone |

#### **job_responsibilities**
**Component:** `AdminJobManagement.jsx`

| Column | Data Type |
|--------|-----------|
| created_at | timestamp with time zone |
| id | uuid |
| job_id | uuid |
| property_addl_card | text |
| property_block | text |
| property_composite_key | text |
| property_location | text |
| property_lot | text |
| property_qualifier | text |
| responsibility_file_name | text |
| responsibility_file_uploaded_at | timestamp without time zone |
| updated_at | timestamp with time zone |
| uploaded_by | uuid |

#### **jobs** ⚠️ SCHEMA CHANGED
**Components:** Created by `AdminJobManagement.jsx`, Used by multiple components

| Column | Data Type | Notes |
|--------|-----------|-------|
| archived_at | timestamp with time zone | **NEW** - Job archive timestamp |
| archived_by | uuid | **NEW** - User who archived the job |
| assessor_email | text | |
| assessor_name | text | |
| assigned_has_commercial | boolean | |
| attribute_condition_config | jsonb | **NEW** - Attribute condition configuration for AttributeCardsTab |
| billing_setup_complete | boolean | |
| ccdd_code | character varying | |
| client_name | text | |
| code_file_content | text | |
| code_file_name | text | |
| code_file_status | character varying | |
| code_file_uploaded_at | timestamp with time zone | |
| code_file_version | integer | |
| county | character varying | |
| created_at | timestamp with time zone | |
| created_by | uuid | |
| current_class_1_count | integer | **NEW** - Current year Class 1 count (ratable comparison) |
| current_class_1_total | bigint | **NEW** - Current year Class 1 valuation (ratable comparison) |
| current_class_1_abatements | integer | **NEW** - Current year Class 1 abatements (ratable comparison) |
| current_class_2_count | integer | **NEW** - Current year Class 2 count (ratable comparison) |
| current_class_2_total | bigint | **NEW** - Current year Class 2 valuation (ratable comparison) |
| current_class_2_abatements | integer | **NEW** - Current year Class 2 abatements (ratable comparison) |
| current_class_3a_count | integer | **NEW** - Current year Class 3A count (ratable comparison) |
| current_class_3a_total | bigint | **NEW** - Current year Class 3A valuation (ratable comparison) |
| current_class_3b_count | integer | **NEW** - Current year Class 3B count (ratable comparison) |
| current_class_3b_total | bigint | **NEW** - Current year Class 3B valuation (ratable comparison) |
| current_class_4_count | integer | **NEW** - Current year Class 4 (A,B,C) count (ratable comparison) |
| current_class_4_total | bigint | **NEW** - Current year Class 4 (A,B,C) valuation (ratable comparison) |
| current_class_4_abatements | integer | **NEW** - Current year Class 4 abatements (ratable comparison) |
| current_class_6_count | integer | **NEW** - Current year Class 6 (A,B,C) count (ratable comparison) |
| current_class_6_total | bigint | **NEW** - Current year Class 6 (A,B,C) valuation (ratable comparison) |
| current_total_count | integer | **NEW** - Current year total count (ratable comparison) |
| current_total_total | bigint | **NEW** - Current year total valuation (ratable comparison) |
| current_commercial_base_pct | decimal(5,2) | **NEW** - Current year commercial base % (ratable comparison) |
| end_date | date | |
| external_inspectors | text | Comma-separated client codes |
| has_property_assignments | boolean | |
| id | uuid | |
| infoby_category_config | jsonb | |
| job_name | text | |
| job_type | character varying | |
| municipality | text | |
| parsed_code_definitions | jsonb | |
| payment_status | character varying | |
| percent_billed | numeric | |
| priority | text | |
| project_start_date | date | **NEW** - Moved from property_records |
| project_type | text | Project classification field (still exists in schema) |
| raw_file_content | text | **NEW** - Consolidated raw data storage |
| raw_file_parsed_at | timestamp with time zone | **NEW** - Parsing timestamp |
| raw_file_rows_count | integer | **NEW** - Row count tracking |
| raw_file_size | bigint | **NEW** - File size tracking |
| rate_calc_budget | decimal(15,2) | **NEW** - Tax rate calculator budget input |
| rate_calc_current_rate | decimal(6,3) | **NEW** - Tax rate calculator current rate input |
| rate_calc_buffer_for_loss | decimal(5,2) | **NEW** - Tax rate calculator buffer for loss % |
| previous_projected_class_1_count | integer | **NEW** - Previous file's projected Class 1 count (delta tracking) |
| previous_projected_class_1_total | bigint | **NEW** - Previous file's projected Class 1 total (delta tracking) |
| previous_projected_class_2_count | integer | **NEW** - Previous file's projected Class 2 count (delta tracking) |
| previous_projected_class_2_total | bigint | **NEW** - Previous file's projected Class 2 total (delta tracking) |
| previous_projected_class_3a_count | integer | **NEW** - Previous file's projected Class 3A count (delta tracking) |
| previous_projected_class_3a_total | bigint | **NEW** - Previous file's projected Class 3A total (delta tracking) |
| previous_projected_class_3b_count | integer | **NEW** - Previous file's projected Class 3B count (delta tracking) |
| previous_projected_class_3b_total | bigint | **NEW** - Previous file's projected Class 3B total (delta tracking) |
| previous_projected_class_4_count | integer | **NEW** - Previous file's projected Class 4 count (delta tracking) |
| previous_projected_class_4_total | bigint | **NEW** - Previous file's projected Class 4 total (delta tracking) |
| previous_projected_class_6_count | integer | **NEW** - Previous file's projected Class 6 count (delta tracking) |
| previous_projected_class_6_total | bigint | **NEW** - Previous file's projected Class 6 total (delta tracking) |
| previous_projected_total_count | integer | **NEW** - Previous file's total property count (delta tracking) |
| previous_projected_total_total | bigint | **NEW** - Previous file's total ratable base (delta tracking) |
| source_file_name | text | |
| source_file_status | character varying | |
| source_file_uploaded_at | timestamp with time zone | |
| source_file_version_id | uuid | |
| source_file_version | text | **NEW** - Text version identifier for source file |
| staged_unit_rate_config | jsonb | **NEW** - Staged unit rate configuration (pending changes) |
| start_date | date | |
| state | character varying | |
| status | text | |
| target_completion_date | date | |
| total_properties | integer | |
| totalcommercial | integer | |
| totalresidential | integer | |
| unit_rate_config | jsonb | **NEW** - Unit rate configuration for land valuation |
| updated_at | timestamp with time zone | |
| validation_status | text | **NEW** - Moved from property_records |
| vendor_detection | jsonb | |
| vendor_type | character varying | |
| workflow_stats | jsonb | |

#### **market_land_valuation** ⚠️ SCHEMA CHANGED
**Components:** All market-tabs folder components

| Column | Data Type | Notes |
|--------|-----------|-------|
| allocation_study | jsonb | |
| block_consistency_metrics | jsonb | |
| bracket_analysis | jsonb | |
| cascade_rates | jsonb | |
| check_results | jsonb | |
| condition_adjustments | jsonb | |
| created_at | timestamp with time zone | |
| created_by | uuid | |
| critical_count | integer | |
| custom_check_definitions | jsonb | |
| custom_checks | jsonb | |
| eco_obs_applied_adjustments | jsonb | **NEW** - Applied economic obsolescence |
| eco_obs_code_config | jsonb | **NEW** - Eco obs configuration |
| eco_obs_compound_overrides | jsonb | **NEW** - Compound overrides |
| eco_obs_summary_adjustments | jsonb | **NEW** - Summary adjustments |
| economic_obsolescence | jsonb | **REMOVED** - Replaced by eco_obs_* fields |
| id | uuid | |
| ignored_issues | jsonb | **NEW** - Quality check ignored issues |
| info_count | integer | |
| job_id | uuid | |
| land_rate | numeric | |
| land_rate_recommendation | jsonb | |
| last_normalization_run | timestamp with time zone | |
| last_worksheet_save | timestamp with time zone | |
| location_analysis_standard | text | |
| manual_key_page | text | |
| manual_location_analysis | text | |
| manual_map_page | text | |
| manual_vcs | text | |
| normalization_config | jsonb | |
| normalization_flags | jsonb | |
| normalization_stats | jsonb | |
| overall_analysis_config | jsonb | |
| overall_analysis_results | jsonb | |
| overall_analysis_stale | boolean | |
| overall_analysis_updated_at | timestamp without time zone | |
| property_composite_key | text | |
| quality_check_last_run | timestamp without time zone | |
| quality_check_results | jsonb | |
| quality_issues_count | integer | |
| quality_score | numeric | |
| raw_land_config | jsonb | |
| site_value_calculated | numeric | |
| size_normalized_value | numeric | |
| target_allocation | numeric | **NEW** - Target allocation percentage |
| time_normalized_sales | jsonb | |
| time_normalized_value | numeric | |
| updated_at | timestamp with time zone | |
| vacant_sales_analysis | jsonb | |
| valuation_method | text | |
| warning_count | integer | |
| worksheet_data | jsonb | |
| worksheet_stats | jsonb | |
| zone_depth_table | text | **REMOVED** - Moved to zoning_config |
| zone_description | text | **REMOVED** - Moved to zoning_config |
| zone_min_depth | numeric | **REMOVED** - Moved to zoning_config |
| zone_min_frontage | numeric | **REMOVED** - Moved to zoning_config |
| zone_min_size | numeric | **REMOVED** - Moved to zoning_config |
| zoning_config | jsonb | **NEW** - Consolidated zoning data |

#### **office_receivables**
**Component:** `BillingManagement.jsx`

| Column | Data Type |
|--------|-----------|
| amount | numeric |
| created_at | timestamp with time zone |
| event_description | text |
| id | uuid |
| invoice_number | character varying |
| job_name | character varying |
| status | character |
| updated_at | timestamp with time zone |

#### **payroll_periods**
**Component:** `PayrollManagement.jsx`

| Column | Data Type |
|--------|-----------|
| bonus_calculation_start | date |
| created_at | timestamp with time zone |
| created_by | uuid |
| end_date | date |
| expected_hours | integer |
| id | uuid |
| inspection_count | integer |
| job_id | uuid |
| pay_per_property | numeric |
| period_name | text |
| processed_date | date |
| processing_settings | jsonb |
| start_date | date |
| status | text |
| total_amount | numeric |
| total_appt_ot | numeric |
| total_field_bonus | numeric |
| total_hours | numeric |
| total_ot | numeric |
| updated_at | timestamp with time zone |

#### **planning_jobs**
**Component:** `AdminJobManagement.jsx`

| Column | Data Type |
|--------|-----------|
| ccdd_code | character varying |
| comments | text |
| contract_amount | numeric |
| created_at | timestamp with time zone |
| created_by | uuid |
| end_date | date |
| id | uuid |
| is_archived | boolean |
| job_name | character varying |
| municipality | character varying |

#### **profiles**
**Component:** User authentication system

| Column | Data Type |
|--------|-----------|
| id | uuid |
| email | text |
| full_name | text |
| employment_status | text |
| role | text |
| created_at | timestamp with time zone |
| updated_at | timestamp with time zone |
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


#### **property_market_analysis** ���� NEW TABLE
**Component:** Market analysis modules, field preservation during updates

| Column | Data Type | Notes |
|--------|-----------|-------|
| asset_key_page | text | Moved from property_records |
| asset_map_page | text | Moved from property_records |
| asset_zoning | text | Moved from property_records |
| created_at | timestamp with time zone | |
| id | uuid | |
| job_id | uuid | |
| location_analysis | text | Moved from property_records |
| new_vcs | text | Moved from property_records |
| property_composite_key | text | |
| sales_history | jsonb | Moved from property_records |
| updated_at | timestamp with time zone | |
| validation_status | text | Property-level validation |
| values_norm_size | numeric | Moved from property_records |
| values_norm_time | numeric | Moved from property_records |

#### **final_valuation_data** ⚠️ NEW TABLE (January 2025)
**Components:** MarketDataTab.jsx (Final Valuation), SalesComparisonTab.jsx

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| property_composite_key | text | Unique property identifier |
| special_notes | text | User freeform notes (Column 17) |
| actual_efa | numeric | **USER INPUT** - Actual Effective Age (Column 58) |
| sale_comment | text | User freeform sale notes (Column 46) |
| recommended_efa | numeric | Calculated recommended EFA (Column 57) |
| depr_factor | numeric | Depreciation factor capped at 1.0 (Column 59) |
| new_calculated_value | numeric | New Value calculation (Column 60) |
| projected_improvement | numeric | Projected improvement value (Column 54) |
| projected_total | numeric | Projected total assessment (Column 55) |
| new_land_allocation_percent | numeric | New land allocation % (Column 53) |
| cme_projected_assessment | numeric | LOJIK CME projected value |
| cme_min_range | numeric | CME minimum range |
| cme_max_range | numeric | CME maximum range |
| cme_comparable_blq | text | Comparable B/L/Q reference |
| cme_comp1 | text | Comparable 1 |
| cme_comp2 | text | Comparable 2 |
| cme_comp3 | text | Comparable 3 |
| cme_comp4 | text | Comparable 4 |
| cme_comp5 | text | Comparable 5 |
| final_method_used | text | 'market_data' or 'cme' |
| final_recommended_value | numeric | Final value recommendation |
| final_notes | text | Additional notes |
| projected_6_override | numeric | **NEW** - Manual override for Class 6 projected values |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Unique Constraint:** (job_id, property_composite_key)
**Indexes:** idx_final_valuation_job, idx_final_valuation_composite

**Purpose:** Stores Market Data Approach calculations and CME (Comparative Market Evaluation) results for the Final Valuation module. Each property gets one record per job with user-entered effective age, calculated projections, and final valuation recommendations.

#### **job_tax_rates** ⚠️ NEW TABLE (January 2025)
**Component:** TaxRateCalculatorTab.jsx (Final Valuation)

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| current_tax_year | integer | Current assessment year |
| current_general_rate | numeric(10,6) | Current general tax rate |
| current_school_rate | numeric(10,6) | Current school tax rate |
| current_county_rate | numeric(10,6) | Current county tax rate |
| current_total_rate | numeric(10,6) | Current total tax rate |
| projected_tax_year | integer | Projected assessment year |
| projected_general_rate | numeric(10,6) | Projected general tax rate |
| projected_school_rate | numeric(10,6) | Projected school tax rate |
| projected_county_rate | numeric(10,6) | Projected county tax rate |
| projected_total_rate | numeric(10,6) | Projected total tax rate |
| current_ratable_base | numeric | Current total ratable base |
| projected_ratable_base | numeric | Projected total ratable base |
| current_total_levy | numeric | Current total levy amount |
| projected_total_levy | numeric | Projected total levy amount |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Unique Constraint:** (job_id, current_tax_year)
**Index:** idx_job_tax_rates_job

**Purpose:** Stores current and projected tax rates used for calculating property tax impact in the Market Data Approach tab. Rates are entered at the job level and apply to all properties in the assessment calculation.

#### **property_class_changes** ⚠️ NEW TABLE (January 2025)
**Components:** ClassChangesTab.jsx (Market Analysis), FileUploadButton.jsx comparison modal

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| property_composite_key | text | Property identifier |
| change_type | text | 'class_mismatch', 'user_edit', 'file_addition', 'file_deletion' |
| old_m4_class | text | Previous M4 class value |
| new_m4_class | text | New M4 class value |
| old_cama_class | text | Previous CAMA class value |
| new_cama_class | text | New CAMA class value |
| property_block | text | For display in reports |
| property_lot | text | For display in reports |
| property_qualifier | text | For display in reports |
| property_location | text | For display in reports |
| change_source | text | 'comparison_modal', 'user_edit', 'file_upload', 'initial_import' |
| changed_by | uuid | Foreign key to employees |
| changed_at | timestamp with time zone | When change occurred |
| notes | text | Additional context |
| resolved | boolean | Change acknowledged/resolved |
| resolved_at | timestamp with time zone | When resolved |
| resolved_by | uuid | Foreign key to employees |

**Indexes:** idx_property_class_changes_job, idx_property_class_changes_composite, idx_property_class_changes_type, idx_property_class_changes_resolved

**Purpose:** Audit trail for property class changes (M4 vs CAMA mismatches). Tracks when property classifications change through file updates or user edits, enabling quality control and class consistency reporting.

#### **job_adjustment_grid** ⚠️ NEW TABLE (January 2025)
**Component:** AdjustmentsTab.jsx (Final Valuation)

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| adjustment_id | text | Adjustment identifier (e.g., 'living_area', 'garage', 'pool') |
| adjustment_name | text | Display name (e.g., 'Living Area (Sq Ft)', 'Garage', 'Pool') |
| adjustment_type | text | 'flat', 'per_sqft', 'percent' |
| category | text | 'physical', 'amenity', 'quality', 'custom' |
| is_default | boolean | System default vs user-created |
| sort_order | integer | Display order in grid |
| bracket_0 | numeric | Adjustment value for price bracket 0 ($0-$99,999) |
| bracket_1 | numeric | Adjustment value for price bracket 1 ($100K-$199K) |
| bracket_2 | numeric | Adjustment value for price bracket 2 ($200K-$299K) |
| bracket_3 | numeric | Adjustment value for price bracket 3 ($300K-$399K) |
| bracket_4 | numeric | Adjustment value for price bracket 4 ($400K-$499K) |
| bracket_5 | numeric | Adjustment value for price bracket 5 ($500K-$749K) |
| bracket_6 | numeric | Adjustment value for price bracket 6 ($750K-$999K) |
| bracket_7 | numeric | Adjustment value for price bracket 7 ($1M-$1.5M) |
| bracket_8 | numeric | Adjustment value for price bracket 8 ($1.5M-$2M) |
| bracket_9 | numeric | Adjustment value for price bracket 9 (Over $2M) |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Unique Constraint:** (job_id, adjustment_id)
**Index:** idx_job_adjustment_grid_job

**Purpose:** Stores adjustment grid values used in the Sales Comparison (CME) tab. Each adjustment attribute has values for 10 price brackets, allowing differentiated adjustments based on property value ranges. System includes default adjustments (Living Area, Basement, Garage, etc.) and supports user-defined custom adjustments.

#### **job_custom_brackets** ⚠️ NEW TABLE (January 2025)
**Component:** SalesComparisonTab.jsx (Final Valuation) - Custom CME price brackets

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| bracket_id | text | Custom bracket identifier |
| bracket_name | text | Display name for bracket |
| sort_order | integer | Display order |
| adjustment_values | jsonb | JSONB object with adjustment values |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Unique Constraint:** (job_id, bracket_id)

**Purpose:** Stores custom price bracket definitions for CME analysis when default 10 brackets don't fit market conditions. Allows job-specific bracket ranges and custom adjustment configurations.

#### **job_settings** ⚠️ NEW TABLE (January 2025)
**Component:** Various - Generic key-value settings storage

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| setting_key | text | Setting identifier |
| setting_value | text | Setting value (string format) |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Unique Constraint:** (job_id, setting_key)

**Purpose:** Generic key-value store for job-specific configuration settings that don't warrant dedicated columns. Allows flexible setting storage without schema changes.

#### **job_cme_evaluations** ⚠️ ACTIVE TABLE (Updated 2025)
**Component:** SalesComparisonTab.jsx - Set-aside evaluation storage

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| evaluation_run_id | uuid | Batch evaluation identifier |
| subject_property_id | uuid | Property being evaluated |
| subject_pams | text | Property composite key (block-lot-qualifier) |
| subject_address | text | Property address |
| search_criteria | jsonb | Filter criteria used for this evaluation |
| comparables | jsonb | Array of comparable properties with adjustedPrice, adjustmentPercent, rank |
| projected_assessment | numeric | CME projected value (weighted average of adjusted comps) |
| weighted_average_price | numeric | Average of comps |
| confidence_score | numeric | Quality metric (0-100) |
| status | text | 'set_aside' (committed results) |
| notes | text | Evaluation notes |
| created_by | uuid | User who ran evaluation |
| created_at | timestamp with time zone | |
| updated_at | timestamp with time zone | |

**Status:** ACTIVE - Used for "Set Aside" workflow. When a user evaluates properties and sets aside successful results, they are saved here with status='set_aside'. The Summary tab aggregates these records to show working totals, VCS completion tracking, and projected net valuation.

**Purpose:** Stores committed CME evaluation results. Users evaluate in batches (by VCS, type/use, etc.), review results, then "Set Aside" successful evaluations (those with sufficient comparables). The Summary tab uses these records as the source of truth for the projected valuation table and export.

#### **job_cme_result_sets** ⚠️ NEW TABLE (2025)
**Component:** SalesComparisonTab.jsx - Named result set snapshots

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| name | text | User-provided name for the result set |
| adjustment_bracket | text | Bracket mode used ('auto', 'bracket_0', etc.) |
| search_criteria | jsonb | Complete compFilters state at time of save |
| results | jsonb | Full serialized evaluation results (subjects + comparables with all property fields) |
| created_at | timestamp with time zone | |

**Purpose:** Allows users to save named snapshots of evaluation results for later recall. Preserves complete subject and comparable property data so results can be reloaded and viewed in DetailedAppraisalGrid without re-running the evaluation. Users can load, delete, and manage multiple saved sets per job.

#### **job_cme_bracket_mappings** ⚠️ NEW TABLE (2025)
**Component:** AdjustmentsTab.jsx - Bracket Mapping sub-tab (drag-and-drop UI)

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| vcs_codes | text[] | Array of VCS codes (null if type/use mapping) |
| type_use_codes | text[] | Array of Type/Use codes (null if VCS mapping) |
| bracket_value | text | Target bracket identifier (e.g., 'bracket_0', 'bracket_5') |
| sort_order | integer | Processing priority order |
| created_at | timestamp with time zone | |

**Purpose:** Maps VCS and Type/Use codes to specific adjustment brackets. When CME runs in "Auto (based on mapping)" mode, each subject property is routed to the correct bracket based on its VCS or Type/Use code rather than falling back to price-based bracket selection. This is critical because a property's current assessed value may not reflect its true market segment — a $300K-assessed property in a $500K neighborhood should use the $500K bracket adjustments.

**Drag-and-Drop UI:** Left side shows unassigned Type/Use and VCS codes stacked vertically. Right side shows bracket buckets in a 2-column grid with color-coding and average sale prices. Users drag codes into brackets to assign them.

**Qualifying Sales Filter:** Average sale prices shown in bracket hints only include:
- Building class > 10 (residential only)
- Valid sales codes: 00, 0, 7, 07, 32, 36
- Properties with values_norm_time > 0

#### **analytics_runs** ⚠️ NEW TABLE (January 2025)
**Component:** ProductionTracker.jsx - Analytics history tracking

| Column | Data Type | Notes |
|--------|-----------|-------|
| id | uuid | Primary key |
| job_id | uuid | Foreign key to jobs |
| run_name | text | Descriptive name for run |
| run_data | jsonb | Complete analytics snapshot |
| created_at | timestamp with time zone | When analytics were generated |

**Purpose:** Stores historical analytics run data from ProductionTracker. Enables comparison over time and audit trail of inspection/pricing analytics. The run_data JSONB contains complete snapshot including inspector stats, validation reports, and workflow metrics.

**JSONB Structure (run_data):**
```javascript
{
  totalRecords: number,
  validInspections: number,
  jobEntryRate: number,
  jobRefusalRate: number,
  commercialCompletePercent: number,
  pricingCompletePercent: number,
  inspectorBreakdown: [{
    inspector: string,
    totalAssigned: number,
    completed: number,
    // ... more stats
  }],
  validationReport: { /* ... */ },
  timestamp: ISO8601 string
}
```

#### **property_records** ⚠️ MAJOR SCHEMA CHANGES
**Components:** Created in `AdminJobManagement.jsx`, Updated by `FileUploadButton.jsx`, Used by multiple components

| Column | Data Type | Notes |
|--------|-----------|-------|
| asset_building_class | text | |
| asset_design_style | text | |
| asset_effective_age | integer | **NEW** - Vendor-sourced effective age (BRT: EFFAGE year, Microsystems: converted from age) |
| asset_ext_cond | text | |
| asset_int_cond | text | |
| asset_key_page | text | **REMOVED** - Moved to property_market_analysis |
| asset_lot_acre | numeric | |
| asset_lot_depth | numeric | |
| asset_lot_frontage | numeric | |
| asset_lot_sf | numeric | |
| LANDUR_1 | text | BRT parsed land use code (zero-padded, e.g. '01') |
| LANDUR_2 | text | BRT parsed land use code (zero-padded) |
| LANDUR_3 | text | BRT parsed land use code (zero-padded) |
| LANDUR_4 | text | BRT parsed land use code (zero-padded) |
| LANDUR_5 | text | BRT parsed land use code (zero-padded) |
| LANDUR_6 | text | BRT parsed land use code (zero-padded) |
| LANDURUNITS_1 | numeric | Numeric units corresponding to LANDUR_1 |
| LANDURUNITS_2 | numeric | Numeric units corresponding to LANDUR_2 |
| LANDURUNITS_3 | numeric | Numeric units corresponding to LANDUR_3 |
| LANDURUNITS_4 | numeric | Numeric units corresponding to LANDUR_4 |
| LANDURUNITS_5 | numeric | Numeric units corresponding to LANDUR_5 |
| LANDURUNITS_6 | numeric | Numeric units corresponding to LANDUR_6 |
| asset_map_page | text | **REMOVED** - Moved to property_market_analysis |
| asset_neighborhood | text | |
| asset_sfla | numeric | |
| asset_story_height | numeric | |
| asset_type_use | text | |
| asset_view | text | |
| asset_year_built | integer | |
| asset_bedrooms | integer | Bedroom count (BRT: BEDTOT, Microsystems: Total Bedrms) |
| asset_zoning | text | **REMOVED** - Moved to property_market_analysis |
| ac_area | numeric | **NEW** - Air conditioning area in square feet (CME attribute) |
| barn_area | numeric | **NEW** - Barn area in square feet (CME attribute) |
| basement_area | numeric | **NEW** - Basement area in square feet (CME attribute) |
| deck_area | numeric | **NEW** - Deck area in square feet (CME attribute) |
| det_garage_area | numeric | **NEW** - Detached garage area in square feet (CME attribute) |
| enclosed_porch_area | numeric | **NEW** - Enclosed porch area in square feet (CME attribute) |
| fin_basement_area | numeric | **NEW** - Finished basement area in square feet (CME attribute) |
| fireplace_count | integer | **NEW** - Number of fireplaces (CME attribute) |
| fireplaces | numeric | **NEW** - Fireplace count/area (CME attribute) |
| garage_area | numeric | **NEW** - Attached garage area in square feet (CME attribute) |
| open_porch_area | numeric | **NEW** - Open porch area in square feet (CME attribute) |
| patio_area | numeric | **NEW** - Patio area in square feet (CME attribute) |
| pole_barn_area | numeric | **NEW** - Pole barn area in square feet (CME attribute) |
| pool_area | numeric | **NEW** - Pool area in square feet (CME attribute) |
| stable_area | numeric | **NEW** - Stable area in square feet (CME attribute) |
| attachedcode_1 | text | **NEW** - BRT attached item code 1 |
| attachedcode_2 | text | **NEW** - BRT attached item code 2 |
| attachedcode_3 | text | **NEW** - BRT attached item code 3 |
| attachedcode_4 | text | **NEW** - BRT attached item code 4 |
| attachedcode_5 | text | **NEW** - BRT attached item code 5 |
| attachedcode_6 | text | **NEW** - BRT attached item code 6 |
| attachedcode_7 | text | **NEW** - BRT attached item code 7 |
| attachedcode_8 | text | **NEW** - BRT attached item code 8 |
| attachedcode_9 | text | **NEW** - BRT attached item code 9 |
| attachedcode_10 | text | **NEW** - BRT attached item code 10 |
| attachedcode_11 | text | **NEW** - BRT attached item code 11 |
| attachedcode_12 | text | **NEW** - BRT attached item code 12 |
| attachedcode_13 | text | **NEW** - BRT attached item code 13 |
| attachedcode_14 | text | **NEW** - BRT attached item code 14 |
| attachedcode_15 | text | **NEW** - BRT attached item code 15 |
| attachedarea_1 | numeric | **NEW** - BRT attached item area 1 |
| attachedarea_2 | numeric | **NEW** - BRT attached item area 2 |
| attachedarea_3 | numeric | **NEW** - BRT attached item area 3 |
| attachedarea_4 | numeric | **NEW** - BRT attached item area 4 |
| attachedarea_5 | numeric | **NEW** - BRT attached item area 5 |
| attachedarea_6 | numeric | **NEW** - BRT attached item area 6 |
| attachedarea_7 | numeric | **NEW** - BRT attached item area 7 |
| attachedarea_8 | numeric | **NEW** - BRT attached item area 8 |
| attachedarea_9 | numeric | **NEW** - BRT attached item area 9 |
| attachedarea_10 | numeric | **NEW** - BRT attached item area 10 |
| attachedarea_11 | numeric | **NEW** - BRT attached item area 11 |
| attachedarea_12 | numeric | **NEW** - BRT attached item area 12 |
| attachedarea_13 | numeric | **NEW** - BRT attached item area 13 |
| attachedarea_14 | numeric | **NEW** - BRT attached item area 14 |
| attachedarea_15 | numeric | **NEW** - BRT attached item area 15 |
| detachedcode_1 | text | **NEW** - BRT detached item code 1 |
| detachedcode_2 | text | **NEW** - BRT detached item code 2 |
| detachedcode_3 | text | **NEW** - BRT detached item code 3 |
| detachedcode_4 | text | **NEW** - BRT detached item code 4 |
| detachedcode_5 | text | **NEW** - BRT detached item code 5 |
| detachedcode_6 | text | **NEW** - BRT detached item code 6 |
| detachedcode_7 | text | **NEW** - BRT detached item code 7 |
| detachedcode_8 | text | **NEW** - BRT detached item code 8 |
| detachedcode_9 | text | **NEW** - BRT detached item code 9 |
| detachedcode_10 | text | **NEW** - BRT detached item code 10 |
| detachedcode_11 | text | **NEW** - BRT detached item code 11 |
| detacheddcsize_1 | numeric | **NEW** - BRT detached item size 1 |
| detacheddcsize_2 | numeric | **NEW** - BRT detached item size 2 |
| detacheddcsize_3 | numeric | **NEW** - BRT detached item size 3 |
| detacheddcsize_4 | numeric | **NEW** - BRT detached item size 4 |
| detacheddcsize_5 | numeric | **NEW** - BRT detached item size 5 |
| detacheddcsize_6 | numeric | **NEW** - BRT detached item size 6 |
| detacheddcsize_7 | numeric | **NEW** - BRT detached item size 7 |
| detacheddcsize_8 | numeric | **NEW** - BRT detached item size 8 |
| detacheddcsize_9 | numeric | **NEW** - BRT detached item size 9 |
| detacheddcsize_10 | numeric | **NEW** - BRT detached item size 10 |
| detacheddcsize_11 | numeric | **NEW** - BRT detached item size 11 |
| detachednc_1 | numeric | **NEW** - BRT detached item count 1 |
| detachednc_2 | numeric | **NEW** - BRT detached item count 2 |
| detachednc_3 | numeric | **NEW** - BRT detached item count 3 |
| detachednc_4 | numeric | **NEW** - BRT detached item count 4 |
| detachednc_5 | numeric | **NEW** - BRT detached item count 5 |
| detachednc_6 | numeric | **NEW** - BRT detached item count 6 |
| detachednc_7 | numeric | **NEW** - BRT detached item count 7 |
| detachednc_8 | numeric | **NEW** - BRT detached item count 8 |
| detachednc_9 | numeric | **NEW** - BRT detached item count 9 |
| detachednc_10 | numeric | **NEW** - BRT detached item count 10 |
| detachednc_11 | numeric | **NEW** - BRT detached item count 11 |
| detached_item_code1 | text | **NEW** - Microsystems detached item code 1 |
| detached_item_code2 | text | **NEW** - Microsystems detached item code 2 |
| detached_item_code3 | text | **NEW** - Microsystems detached item code 3 |
| detached_item_code4 | text | **NEW** - Microsystems detached item code 4 |
| detachedbuilding1 | text | **NEW** - Microsystems detached building code 1 |
| detachedbuilding2 | text | **NEW** - Microsystems detached building code 2 |
| detachedbuilding3 | text | **NEW** - Microsystems detached building code 3 |
| detachedbuilding4 | text | **NEW** - Microsystems detached building code 4 |
| depth1 | numeric | **NEW** - Microsystems detached item depth 1 |
| depth2 | numeric | **NEW** - Microsystems detached item depth 2 |
| depth3 | numeric | **NEW** - Microsystems detached item depth 3 |
| depth4 | numeric | **NEW** - Microsystems detached item depth 4 |
| depthn1 | numeric | **NEW** - Microsystems detached building depth 1 |
| depthn2 | numeric | **NEW** - Microsystems detached building depth 2 |
| depthn3 | numeric | **NEW** - Microsystems detached building depth 3 |
| depthn4 | numeric | **NEW** - Microsystems detached building depth 4 |
| width1 | numeric | **NEW** - Microsystems detached item width 1 |
| width2 | numeric | **NEW** - Microsystems detached item width 2 |
| width3 | numeric | **NEW** - Microsystems detached item width 3 |
| width4 | numeric | **NEW** - Microsystems detached item width 4 |
| widthn1 | numeric | **NEW** - Microsystems detached building width 1 |
| widthn2 | numeric | **NEW** - Microsystems detached building width 2 |
| widthn3 | numeric | **NEW** - Microsystems detached building width 3 |
| widthn4 | numeric | **NEW** - Microsystems detached building width 4 |
| misc_1_brt | text | **NEW** - BRT miscellaneous item 1 |
| misc_2_brt | text | **NEW** - BRT miscellaneous item 2 |
| misc_3_brt | text | **NEW** - BRT miscellaneous item 3 |
| misc_4_brt | text | **NEW** - BRT miscellaneous item 4 |
| misc_5_brt | text | **NEW** - BRT miscellaneous item 5 |
| misc_item_1 | text | **NEW** - Microsystems miscellaneous item 1 |
| misc_item_2 | text | **NEW** - Microsystems miscellaneous item 2 |
| misc_item_3 | text | **NEW** - Microsystems miscellaneous item 3 |
| miscnum_1 | numeric | **NEW** - BRT miscellaneous item count 1 |
| miscnum_2 | numeric | **NEW** - BRT miscellaneous item count 2 |
| miscnum_3 | numeric | **NEW** - BRT miscellaneous item count 3 |
| miscnum_4 | numeric | **NEW** - BRT miscellaneous item count 4 |
| miscnum_5 | numeric | **NEW** - BRT miscellaneous item count 5 |
| landffcond_1 | text | **NEW** - BRT land favorable condition 1 |
| landffcond_2 | text | **NEW** - BRT land favorable condition 2 |
| landffcond_3 | text | **NEW** - BRT land favorable condition 3 |
| landffcond_4 | text | **NEW** - BRT land favorable condition 4 |
| landffcond_5 | text | **NEW** - BRT land favorable condition 5 |
| landffcond_6 | text | **NEW** - BRT land favorable condition 6 |
| landffinfl_1 | text | **NEW** - BRT land unfavorable influence 1 |
| landffinfl_2 | text | **NEW** - BRT land unfavorable influence 2 |
| landffinfl_3 | text | **NEW** - BRT land unfavorable influence 3 |
| landffinfl_4 | text | **NEW** - BRT land unfavorable influence 4 |
| landffinfl_5 | text | **NEW** - BRT land unfavorable influence 5 |
| landffinfl_6 | text | **NEW** - BRT land unfavorable influence 6 |
| landur_1 | text | **NEW** - Microsystems land use code 1 (lowercase variant) |
| landur_2 | text | **NEW** - Microsystems land use code 2 (lowercase variant) |
| landur_3 | text | **NEW** - Microsystems land use code 3 (lowercase variant) |
| landur_4 | text | **NEW** - Microsystems land use code 4 (lowercase variant) |
| landur_5 | text | **NEW** - Microsystems land use code 5 (lowercase variant) |
| landur_6 | text | **NEW** - Microsystems land use code 6 (lowercase variant) |
| landurcond_1 | text | **NEW** - BRT land urban condition 1 |
| landurcond_2 | text | **NEW** - BRT land urban condition 2 |
| landurcond_3 | text | **NEW** - BRT land urban condition 3 |
| landurcond_4 | text | **NEW** - BRT land urban condition 4 |
| landurcond_5 | text | **NEW** - BRT land urban condition 5 |
| landurcond_6 | text | **NEW** - BRT land urban condition 6 |
| landurinfl_1 | text | **NEW** - BRT land urban influence 1 |
| landurinfl_2 | text | **NEW** - BRT land urban influence 2 |
| landurinfl_3 | text | **NEW** - BRT land urban influence 3 |
| landurinfl_4 | text | **NEW** - BRT land urban influence 4 |
| landurinfl_5 | text | **NEW** - BRT land urban influence 5 |
| landurinfl_6 | text | **NEW** - BRT land urban influence 6 |
| landurunits_1 | numeric | **NEW** - Microsystems land use units 1 (lowercase variant) |
| landurunits_2 | numeric | **NEW** - Microsystems land use units 2 (lowercase variant) |
| landurunits_3 | numeric | **NEW** - Microsystems land use units 3 (lowercase variant) |
| landurunits_4 | numeric | **NEW** - Microsystems land use units 4 (lowercase variant) |
| landurunits_5 | numeric | **NEW** - Microsystems land use units 5 (lowercase variant) |
| landurunits_6 | numeric | **NEW** - Microsystems land use units 6 (lowercase variant) |
| functional1 | numeric | **NEW** - Functional item 1 |
| functional2 | numeric | **NEW** - Functional item 2 |
| functional3 | numeric | **NEW** - Functional item 3 |
| functional4 | numeric | **NEW** - Functional item 4 |
| functional_depr1 | numeric | **NEW** - Functional depreciation 1 |
| functional_depr2 | numeric | **NEW** - Functional depreciation 2 |
| functional_depr3 | numeric | **NEW** - Functional depreciation 3 |
| functional_depr4 | numeric | **NEW** - Functional depreciation 4 |
| location_economic1 | numeric | **NEW** - Location economic factor 1 |
| location_economic2 | numeric | **NEW** - Location economic factor 2 |
| location_economic3 | numeric | **NEW** - Location economic factor 3 |
| location_economic4 | numeric | **NEW** - Location economic factor 4 |
| locationl_depr1 | numeric | **NEW** - Locational depreciation 1 |
| locationl_depr2 | numeric | **NEW** - Locational depreciation 2 |
| locationl_depr3 | numeric | **NEW** - Locational depreciation 3 |
| locationl_depr4 | numeric | **NEW** - Locational depreciation 4 |
| physical_depr1 | numeric | **NEW** - Physical depreciation 1 |
| physical_depr2 | numeric | **NEW** - Physical depreciation 2 |
| physical_depr3 | numeric | **NEW** - Physical depreciation 3 |
| physical_depr4 | numeric | **NEW** - Physical depreciation 4 |
| pysical1 | numeric | **NEW** - Physical item 1 (note: typo in schema, likely should be "physical") |
| pysical2 | numeric | **NEW** - Physical item 2 (note: typo in schema) |
| pysical3 | numeric | **NEW** - Physical item 3 (note: typo in schema) |
| pysical4 | numeric | **NEW** - Physical item 4 (note: typo in schema) |
| overall_adj_reason1 | text | **NEW** - Overall adjustment reason 1 |
| overall_adj_reason2 | text | **NEW** - Overall adjustment reason 2 |
| overall_adj_reason3 | text | **NEW** - Overall adjustment reason 3 |
| overall_adj_reason4 | text | **NEW** - Overall adjustment reason 4 |
| raw_detached_items | text | **NEW** - Raw detached items text field |
| special_tax_code_1 | text | **NEW** - Special tax district code 1 (BRT: EXEMPT_SPECIAL_TAXCODE1, Micro: Sp Tax Cd1) |
| special_tax_code_2 | text | **NEW** - Special tax district code 2 (BRT: EXEMPT_SPECIAL_TAXCODE2, Micro: Sp Tax Cd2) |
| special_tax_code_3 | text | **NEW** - Special tax district code 3 (BRT: EXEMPT_SPECIAL_TAXCODE3, Micro: N/A) |
| special_tax_code_4 | text | **NEW** - Special tax district code 4 (BRT: EXEMPT_SPECIAL_TAXCODE4, Micro: N/A) |
| code_file_updated_at | timestamp without time zone | |
| created_at | timestamp with time zone | |
| created_by | uuid | |
| file_version | integer | |
| id | uuid | |
| inspection_info_by | character varying | |
| inspection_list_by | text | |
| inspection_list_date | date | |
| inspection_measure_by | text | |
| inspection_measure_date | date | |
| inspection_price_by | text | |
| inspection_price_date | date | |
| is_assigned_property | boolean | Only field kept for performance |
| is_new_since_last_upload | boolean | |
| job_id | uuid | |
| location_analysis | text | **REMOVED** - Moved to property_market_analysis |
| new_vcs | text | **REMOVED** - Moved to property_market_analysis |
| owner_csz | text | |
| owner_name | text | |
| owner_street | text | |
| processed_at | timestamp without time zone | |
| project_start_date | date | **REMOVED** - Moved to jobs table |
| property_addl_card | text | |
| property_block | text | |
| property_cama_class | text | |
| property_composite_key | text | |
| property_facility | text | |
| property_location | text | |
| property_lot | text | |
| property_m4_class | text | |
| property_qualifier | text | |
| property_vcs | text | |
| raw_data | jsonb | **REMOVED** - THE BIG ONE! Consolidated to jobs.raw_file_content |
| sales_book | text | |
| sales_date | date | |
| sales_history | jsonb | **REMOVED** - Moved to property_market_analysis |
| sales_nu | text | |
| sales_page | text | |
| sales_price | numeric | |
| source_file_name | text | |
| source_file_uploaded_at | timestamp without time zone | |
| source_file_version_id | uuid | |
| total_baths_calculated | numeric | |
| updated_at | timestamp with time zone | |
| upload_date | timestamp without time zone | |
| validation_status | text | **REMOVED** - Moved to jobs table |
| values_base_cost | numeric | |
| values_cama_improvement | numeric | |
| values_cama_land | numeric | |
| values_cama_total | numeric | |
| values_det_items | numeric | |
| values_mod_improvement | numeric | |
| values_mod_land | numeric | |
| values_mod_total | numeric | |
| values_norm_size | numeric | **REMOVED** - Moved to property_market_analysis |
| values_norm_time | numeric | **REMOVED** - Moved to property_market_analysis |
| values_repl_cost | numeric | |
| vendor_source | text | |

#### **shareholder_distributions**
**Component:** `BillingManagement.jsx`

| Column | Data Type |
|--------|-----------|
| amount | numeric |
| created_at | timestamp with time zone |
| distribution_date | date |
| distribution_group_id | uuid |
| id | uuid |
| month | integer |
| notes | text |
| ownership_percentage | numeric |
| shareholder_name | character varying |
| status | character varying |
| year | integer |

### Views (Dynamic - No Storage)

#### **current_properties**
- Filtered view of property_records showing only most recent file_version per property
- Used by components needing current property state without version history

#### **job_assignments_with_employee**  
- Join view of job_assignments with employee details
- Simplifies queries in AdminJobManagement for assignment displays

### Deleted Tables Reference (For Code Review)

These tables were removed during optimization. Ensure no references remain in code:

1. **archived_jobs** - Using status field in jobs table instead
2. **billing_data** - Empty, BillingManagement works without it
3. **checklist_item_dependencies** - Over-engineered, handle updates directly
4. **checklist_templates** - Hardcoded in ManagementChecklist.jsx
5. **checklist_template_items** - Hardcoded in ManagementChecklist.jsx
6. **documents** - Using Supabase Storage + checklist_documents
7. **job_checklists** - Part of abandoned template system
8. **notifications** - Never implemented
9. **payment_reminders** - Handled in BillingManagement component
10. **payroll_entries** - Using Excel+ADP, only tracking periods
11. **production_data** - Replaced by inspection_data
12. **revenue_summary** - Unused aggregation
13. **sales_decisions** - Using property_records.sales_history JSONB
14. **property_change_log** - Using comparison_reports for change tracking

**Note:** `source_file_versions` was previously listed as deleted but remains ACTIVE. See table documentation below.

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

---

## 🔄 Latest Session Summary (January 2025)

### ✅ COMPLETED: All Excel Export Standardization

**Context:** Comprehensive standardization of all Excel exports across the platform with professional formatting, formula-based totals, and consistent styling using `xlsx-js-style` library.

**Key Accomplishments:**

1. **Additional Cards Analysis Export (AttributeCardsTab.jsx)**:
   - ✅ **Removed unnecessary note header** - First row now starts with column headers
   - ✅ **Fixed calculation discrepancy** - Export now matches UI's positive dollar/percent impact
   - ✅ **Filter logic correction** - Only includes VCS with complete data on BOTH sides (matching UI)
   - ✅ **Row reference updates** - Adjusted firstDataRow from 5 to 4, lastDataRow calculations
   - ✅ **All Additional Cards Detail Export**:
     - Red font flag (DC2626, bold) for missing SFLA and Year Built
     - Export button added to table header
     - Remove Price Time column (doesn't populate for additional cards)
     - Centered alignment for Address, SFLA, Year Built, Sales Price
     - VCS sections collapsed by default (not expanded)

2. **Payroll Management Export (PayrollManagement.jsx)**:
   - ✅ **Converted CSV to Excel (.xlsx)** - Professional format with formulas
   - ✅ **Formula-based totals** for summary row:
     - Hours: `SUMIF(B2:B{lastRow},">0")` (only numeric values)
     - Appt OT: `SUM(C2:C{lastRow})`
     - Field Bonus: `SUM(D2:D{lastRow})`
     - TOTAL OT: `SUM(E2:E{lastRow})`
   - ✅ **Leelawadee font, size 10** throughout
   - ✅ **Bold headers and totals row** for emphasis
   - ✅ **Centered alignment** for numeric columns
   - ✅ **Proper number formatting**: Hours as `0`, currency as `0.00`
   - ✅ **Column widths** optimized for readability

3. **Land Valuation Export (LandValuationTab.jsx)** - Previous Session:
   - ✅ **Method 2 (Implied Acreage)**: SFLA-based formulas, smart coloring, summary sections
   - ✅ **Economic Obsolescence**: Professional formatting, location summary aggregation
   - ✅ **Export All Integration**: Multi-sheet workbook with all formatting preserved

**Formatting Standards Established:**
- **Library**: `xlsx-js-style` for all Excel exports
- **Font**: Leelawadee, size 10
- **Alignment**: Center for data, left for addresses/names
- **Headers**: Bold, centered
- **Totals**: Formula-based (SUM, SUMIF, AVERAGE) not hardcoded values
- **Red Flags**: RGB DC2626, bold font for missing/invalid data
- **Column Widths**: Optimized to prevent truncation

**Files Modified:**
- `src/components/job-modules/market-tabs/AttributeCardsTab.jsx` (~3,800 lines)
- `src/components/PayrollManagement.jsx` (~1,450 lines)
- `src/components/job-modules/market-tabs/LandValuationTab.jsx` (~10,000 lines)

**Status:** ✅ **COMPLETE** - All export functionality standardized and working. Ready for PR.

---

### ✅ COMPLETED: CME Attribute Display & Garage Per-Car Categorization (January 2025)

**Context:** Implementation of comprehensive attribute extraction system for Sales Comparison (CME) with configurable garage categorization based on square footage thresholds.

**Key Accomplishments:**

1. **Attribute Extraction System**:
   - ✅ **97 detail columns extracted** for BRT vendor (attached/detached items, misc items, land adjustments)
   - ✅ **Code configuration system** - Auto-loads from job_settings during file processing
   - ✅ **Smart code matching** - `codeMatches()` helper handles leading zeros and descriptions ("02" matches "2 - CONC PATIO")
   - ✅ **Dimension-based fallback** - Calculates area from width × depth when direct area unavailable
   - ✅ **Percentage value handling** - Converts "100%" to actual value by multiplying with SFLA

2. **Code Configuration Loading**:
   - ✅ **Processor integration** - brt-processor.js loads configuration automatically
   - ✅ **Updater integration** - brt-updater.js mirrors processor pattern for UPSERT operations
   - ✅ **Edge Function sync** - recalculate-amenities function uses same codeMatches() logic
   - ✅ **9 extraction methods** added: garage, deck, patio, open_porch, enclosed_porch, det_garage, pool, barn, stable, pole_barn
   - ✅ **Bug fixes**: Finished basement field name (BSMNTFINISHAREA → BSMNTFINISHAREA), clearRawDataCache location fix

3. **Garage Per-Car Categorization System**:
   - ✅ **Configurable thresholds** (default: 1-399=ONE CAR, 400-799=TWO CAR, 800-999=THREE CAR, 1000+=MULTI CAR)
   - ✅ **UI display format** - Shows "TWO CAR (650 SF)" instead of raw square footage
   - ✅ **Category-based adjustments** - Adjustment = category_difference × adjustment_value
     - Example: Subject ONE CAR (cat 1), Comp TWO CAR (cat 2) → -1 category → -$10,000
     - Example: Subject MULTI CAR (cat 4), Comp TWO CAR (cat 2) → +2 category → +$20,000
   - ✅ **Configuration UI** - AdjustmentsTab includes threshold editor with real-time category range display
   - ✅ **State management** - Garage thresholds loaded from job_settings in multiple components
   - ✅ **Adjustment type** - Changed default from 'flat' to 'count' for both garage and det_garage

4. **DetailedAppraisalGrid Display Fix**:
   - ✅ **Removed YES/NONE override** - Garage area now displays category + SF format
   - ✅ **No Edge Function needed** - Display change only, data already populated from processors
   - ✅ **Preserved YES/NONE** for other amenities (deck, patio, pool, etc.)

**Files Modified:**
- `src/lib/data-pipeline/brt-processor.js` - Added code config loading, codeMatches(), 9 extraction methods
- `src/lib/data-pipeline/brt-updater.js` - Mirrored processor changes for UPSERT operations
- `src/components/job-modules/final-valuation-tabs/AdjustmentsTab.jsx` - Garage threshold configuration UI
- `src/components/job-modules/final-valuation-tabs/DetailedAppraisalGrid.jsx` - Category display for garage area
- `src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx` - Category-based adjustment calculation
- `src/components/job-modules/FileUploadButton.jsx` - Fixed clearRawDataCache bug
- `supabase/functions/recalculate-amenities/index.ts` - Added codeMatches() helper

**Database Changes:**
- Added 97 new columns to property_records table (see schema documentation)
- Added job_settings entries for garage thresholds: garage_threshold_one_car_max, garage_threshold_two_car_max, garage_threshold_three_car_max

**Code Pattern Established:**
```javascript
// Smart code matching (handles "02" matching "2 - CONC PATIO")
codeMatches(rawCode, configuredCodes) {
  const normalizedRaw = String(rawCode).replace(/^0+/, '') || '0';
  return configuredCodes.some(configCode => {
    const codePart = String(configCode).split(' - ')[0].trim();
    const normalizedConfig = codePart.replace(/^0+/, '') || '0';
    return normalizedRaw === normalizedConfig;
  });
}

// Garage category conversion
getGarageCategory(sqft, thresholds) {
  if (!sqft || sqft === 0) return 0; // NONE
  if (sqft <= thresholds.one_car_max) return 1; // ONE CAR
  if (sqft <= thresholds.two_car_max) return 2; // TWO CAR
  if (sqft <= thresholds.three_car_max) return 3; // THREE CAR
  return 4; // MULTI CAR
}
```

**Next Session Priorities:**
1. ✅ Verify adjustment calculation logic works correctly (category differences)
2. 🎯 Add modal with Edge Function to edit attributes on-the-fly
3. 🎯 End-to-end testing of garage categorization workflow

**Status:** ✅ **COMPLETE** - All attribute extraction and garage categorization implemented. Ready for testing.

---

### ✅ COMPLETED: Final Valuation Component Implementation (January 2025)

**Context:** Comprehensive final valuation system with Market Data Approach, CME (Comparative Market Evaluation), and Tax Rate Impact Analysis

**Key Accomplishments:**

1. **FinalValuation.jsx Parent Component (170 lines)**:
   - ✅ 5-tab orchestrator following market-tabs pattern
   - ✅ Integrated with JobContainer data loading
   - ✅ Props distribution to all child tabs
   - ✅ Unified final_valuation_data management

2. **Sales Review Tab (1,879 lines)**:
   - ✅ Sales filtering and validation
   - ✅ Usability decisions (usable, unusable, pending)
   - ✅ Bulk operations and comment system
   - ✅ Excel export with professional formatting

3. **Market Data Tab (1,551 lines)**:
   - ✅ Effective age calculation (BRT & Microsystems)
   - ✅ Depreciation factor optimization
   - ✅ New value projection calculations
   - ✅ "Build Final Roster" export with grouping logic
   - ✅ Expandable breakdowns by VCS, Type, Design
   - ✅ Tax Rate Calculator integration

4. **Ratable Comparison Tab (1,112 lines)**:
   - ✅ Current vs Projected ratable base analysis
   - ✅ Property class consolidation (vendor-specific)
   - ✅ Class 6 override functionality
   - ✅ Tax rate impact projections
   - ✅ Editable current year data
   - ✅ Excel comparison report export

5. **Sales Comparison (CME) Tab (2,812 lines) + Adjustments (1,325 lines)**:
   - ✅ Automated comparable search engine
   - ✅ 15+ filter criteria with smart defaults
   - ✅ 10 price bracket adjustment grid
   - ✅ Bulk property evaluation workflow
   - ✅ Manual appraisal grid (DetailedAppraisalGrid 577 lines)
   - ✅ Custom adjustment configuration
   - ✅ Fresh vs Keep evaluation modes

6. **Analytics Tab (441 lines)**:
   - ✅ Value approach integration (Market Data + CME)
   - ✅ Final recommendation logic
   - ✅ Confidence scoring system
   - ✅ Quality metrics and review flags
   - ✅ Variance analysis
   - ✅ Comprehensive analytics export

**Database Enhancements:**
- ✅ Created `final_valuation_data` table (property-level)
- ✅ Created `job_tax_rates` table (job-level)
- ✅ Created `job_adjustment_grid` table (CME configuration)

**Total Implementation:**
- **9,697 lines of code** across 7 components
- **6 Excel export functions** with formula-based calculations
- **3 database tables** with proper indexing
- **Multiple sub-tab architectures** for complex workflows

**Files Created:**
- `src/components/job-modules/FinalValuation.jsx` (170 lines)
- `src/components/job-modules/final-valuation-tabs/SalesReviewTab.jsx` (1,879 lines)
- `src/components/job-modules/final-valuation-tabs/MarketDataTab.jsx` (1,551 lines)
- `src/components/job-modules/final-valuation-tabs/RatableComparisonTab.jsx` (1,112 lines)
- `src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx` (2,812 lines)
- `src/components/job-modules/final-valuation-tabs/AdjustmentsTab.jsx` (1,325 lines)
- `src/components/job-modules/final-valuation-tabs/DetailedAppraisalGrid.jsx` (577 lines)
- `src/components/job-modules/final-valuation-tabs/AnalyticsTab.jsx` (441 lines)

**Status:** ✅ **COMPLETE** - Full final valuation system implemented and documented. Ready for production use.

---

### 📋 Next Phase: Appeal Coverage Component Development

**Upcoming Work:**
1. **AppealCoverage.jsx** (Currently placeholder) - Build litigation support system
   - Evidence gathering interfaces
   - Comparable sales packages
   - Expert report generation
   - Document management
   - Timeline tracking

**Status:** 🎯 **READY TO START** - All prerequisite modules (Market Analysis, Final Valuation) complete.

---

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

### JSONB Field Structures

Many tables use JSONB fields to store complex, flexible data structures. Below are the documented schemas for key JSONB fields:

#### **jobs.workflow_stats**
**Used by:** ProductionTracker, AdminJobManagement

```javascript
workflow_stats: {
  totalRecords: number,              // Total property records
  validInspections: number,          // Properties with valid inspection data
  jobEntryRate: number,              // Percentage with job entry
  jobRefusalRate: number,            // Percentage refused/no entry
  commercialCompletePercent: number, // Commercial pricing completion
  pricingCompletePercent: number,    // Overall pricing completion
  lastProcessed: timestamp,          // Last analytics run
  isProcessed: boolean               // Analytics have been run
}
```

#### **jobs.parsed_code_definitions**
**Used by:** MarketAnalysis tabs, interpretCodes utility

```javascript
parsed_code_definitions: {
  // BRT Format
  "Residential": {
    "23": { /* Design codes */ },
    "20": { /* Building class codes */ },
    "21": { /* Type use codes */ }
    // ... more sections
  },
  "VCS": {
    "41": { "9": { "DATA": { "VALUE": "NORTH SIDE (EAST OF WASH)" } } }
    // ... more VCS codes
  },
  
  // Microsystems Format
  "520CLON9999": "COLONIAL",
  "500SNGL9999": "SINGLE FAMILY",
  "210BCLR9999": "BIDDLE CREEK LOW RES"
  // ... flat key-value pairs with prefix codes
}
```

#### **jobs.vendor_detection**
**Used by:** FileUploadButton, data processors

```javascript
vendor_detection: {
  detectedVendor: "BRT" | "Microsystems",
  confidence: number,              // 0-100
  indicators: {
    hasCAMAFields: boolean,
    hasBRTStructure: boolean,
    hasMicrosystemsPrefix: boolean,
    fieldCount: number
  },
  detectedAt: timestamp
}
```

#### **jobs.infoby_category_config**
**Used by:** ProductionTracker for inspector categorization

```javascript
infoby_category_config: {
  categories: {
    "FIELD": ["F", "FLD", "FIELD"],           // Field inspector codes
    "APPT": ["A", "APT", "APPT"],             // Appointment codes
    "OFFICE": ["O", "OFC", "OFFICE"],         // Office review codes
    "CLIENT": ["C", "CLT", "CLIENT"],         // Client-provided codes
    "EXTERNAL": ["EXT", "EXTERNAL", "VENDOR"] // External inspector codes
  },
  customCodes: {
    "JIM": "FIELD",      // Manager overrides
    "SARAH": "APPT"
  },
  lastModified: timestamp
}
```

#### **market_land_valuation.eco_obs_code_config**
**Used by:** LandValuationTab Economic Obsolescence section

```javascript
eco_obs_code_config: {
  defaultCodes: [
    { code: "BS", name: "Busy Street", adjustment: -8, isNegative: true },
    { code: "RR", name: "Railroad", adjustment: -5, isNegative: true },
    { code: "HW", name: "Highway", adjustment: -10, isNegative: true },
    { code: "WF", name: "Waterfront", adjustment: +15, isNegative: false },
    { code: "PK", name: "Park", adjustment: +5, isNegative: false }
    // ... more codes
  ],
  customCodes: [
    { code: "NZ", name: "Noise Zone", adjustment: -7, isNegative: true }
    // User-defined codes
  ],
  trafficLevels: {
    "BS": {
      "5000": -3,    // ADT (Average Daily Traffic)
      "10000": -5,
      "25000": -8,
      "50000": -12
    }
  },
  compoundRules: {
    "BS/RR": { method: "additive", cap: -15 },
    "WF/PK": { method: "multiplicative", boost: 1.25 }
  }
}
```

#### **market_land_valuation.eco_obs_applied_adjustments**
**Used by:** LandValuationTab to track actual property adjustments

```javascript
eco_obs_applied_adjustments: {
  "property_composite_key_1": {
    factors: ["BS", "RR"],
    adjustments: [-8, -5],
    totalAdjustment: -13,
    compoundOverride: false,
    appliedDate: timestamp
  },
  "property_composite_key_2": {
    factors: ["WF"],
    adjustments: [+15],
    totalAdjustment: +15,
    appliedDate: timestamp
  }
  // ... per-property adjustments
}
```

#### **market_land_valuation.worksheet_data**
**Used by:** LandValuationTab VCS Sheet configuration

```javascript
worksheet_data: {
  "A1": {  // VCS Code
    actSite: 45000,           // Manual override rate
    recSite: 42500,           // Calculated recommendation
    vcsType: "Residential",
    zoning: {
      minLotSize: 0.25,       // acres
      maxFAR: 0.35,
      setbacks: {
        front: 25,
        side: 10,
        rear: 30
      },
      specialRestrictions: "Historic district overlay"
    },
    specialRegion: "Historic",
    propertyCount: 1234
  }
  // ... more VCS codes
}
```

#### **market_land_valuation.cascade_rates**
**Used by:** LandValuationTab Rate Tables section

```javascript
cascade_rates: {
  "A1": {  // VCS Code
    mode: "acre",  // or "squarefoot" or "frontfoot"
    breakPoints: [
      { min: 0.00, max: 0.50, rate: 45000, degradation: 0 },
      { min: 0.51, max: 1.00, rate: 42000, degradation: -6.7 },
      { min: 1.01, max: 2.00, rate: 38000, degradation: -15.6 },
      { min: 2.01, max: 5.00, rate: 32000, degradation: -28.9 },
      { min: 5.01, max: 10.0, rate: 25000, degradation: -44.4 },
      { min: 10.01, max: null, rate: 18000, degradation: -60.0 }
    ],
    method: "automatic"  // or "manual"
  }
  // ... more VCS codes
}
```

#### **market_land_valuation.allocation_study**
**Used by:** LandValuationTab Allocation Study section

```javascript
allocation_study: {
  targetAllocation: 30,  // Target percentage
  results: {
    "A1": {  // VCS Code
      avgAllocation: 28.5,
      targetAllocation: 30,
      withinRange: true,
      outliers: [
        { propertyKey: "2024-123-45", allocation: 45.2, reason: "high land value" }
      ],
      propertyCount: 1234
    }
    // ... more VCS codes
  },
  calculatedAt: timestamp
}
```

#### **property_market_analysis.sales_history**
**Used by:** PreValuationTab, various market analysis tabs

```javascript
sales_history: {
  timeNormalized: {
    targetYear: 2012,
    hpiMultiplier: 1.15,
    normalizedPrice: 285000,
    originalPrice: 247826,
    appliedDate: timestamp
  },
  sizeNormalized: {
    method: "jim_50_percent",
    groupAvgSize: 1850,
    propertySize: 1920,
    adjustment: -5925,
    normalizedPrice: 319075,
    appliedDate: timestamp
  },
  outlierStatus: {
    isOutlier: false,
    ratio: 0.685,
    equalizationRatio: 0.70,
    threshold: 0.15,
    decision: "keep"  // or "reject" or "pending"
  }
}
```

#### **payroll_periods.processing_settings**
**Used by:** PayrollManagement for bonus calculations

```javascript
processing_settings: {
  bonusCalculation: {
    enabled: true,
    startDate: "2024-01-15",
    endDate: "2024-01-28",
    payPerProperty: 2.50,
    minimumProperties: 100
  },
  overtimeRules: {
    enabled: true,
    weeklyThreshold: 40,
    dailyThreshold: 8,
    overtimeMultiplier: 1.5
  },
  appointmentBonus: {
    enabled: true,
    appointmentRate: 5.00
  }
}
```

#### **comparison_reports.report_data**
**Used by:** FileUploadButton comparison engine

```javascript
report_data: {
  summary: {
    propertiesAdded: 45,
    propertiesModified: 234,
    propertiesRemoved: 12,
    totalProperties: 5234
  },
  fieldChanges: {
    "asset_building_class": { changed: 89, percentChanged: 1.7 },
    "asset_ext_cond": { changed: 156, percentChanged: 3.0 }
    // ... per-field statistics
  },
  significantChanges: [
    {
      propertyKey: "2024-123-45",
      field: "sale_price",
      oldValue: 250000,
      newValue: 285000,
      changePercent: 14.0
    }
    // ... flagged changes
  ]
}
```

### Database Performance Optimizations

#### Indexes Added
1. `idx_checklist_documents_job_id` - Speed up document lookups by job
2. `idx_inspection_data_job_id` - Critical for finding inspections by job
3. `idx_property_records_file_version` - Version history lookups
4. `idx_jobs_status` - Filter jobs by status
5. `idx_jobs_vendor_type` - Filter jobs by vendor

#### Duplicate Indexes Removed
1. `idx_property_composite_key` (kept unique constraint)
2. `idx_market_land_valuation_job_id` (kept unique constraint)
3. `idx_property_records_job` (kept other job_id index)
4. `idx_property_records_composite_key` (kept unique constraint)

## Vendor Systems & File Formats

### BRT (New Jersey)

**Source Files**: .csv format (but tab-delimited content, not comma-separated)  
**Code Files**: Mixed format - Section headers + nested JSON structures  
**Pricing**: Dedicated pricing fields in source data  
**Detection**: FileUploadButton sees .csv extension → routes to BRT processor

**Source File Formats:**
- **CSV Format**: Standard comma-separated with quote handling
- **Tab-Delimited**: Despite .csv extension, often tab-separated
- **Auto-Detection**: Counts tabs vs commas to determine format

**Code File Structure:**
```
Section Header (e.g., "Residential", "VCS", "Mobile Home")
{nested JSON structure with numbered items}

Section Header  
{nested JSON structure with numbered items}
```

**Nested JSON Pattern:**
```json
{
  "1": {
    "KEY": "01",
    "DATA": {
      "KEY": "01", 
      "VALUE": "OWNER"
    },
    "MAP": { ... }
  }
}
```

**VCS Section Example (BRT)**:
```json
"VCS": {
  "41": {
    "KEY": "NER",
    "MAP": {
      "1": { /* SFFR rate data */ },
      "2": { /* EFFR rate data */ },
      "8": { /* URC land rates */ },
      "9": {
        "KEY": "NEIGHBORHOOD",
        "DATA": {
          "KEY": "NEIGHBORHOOD",
          "VALUE": "NORTH SIDE (EAST OF WASH)"
        }
      }
    }
  }
}
```

**InfoBy Code Location:**
- **Primary**: `parsed_code_definitions.sections['Residential']['30'].MAP`
- **Fallback**: Recursive search for keywords (OWNER, SPOUSE, TENANT, AGENT, REFUSED, ESTIMATED)

**Key Sections:**
- **Residential**: Building component codes (01-GROUND FLR, 02-UPPER STY, etc.)
- **VCS**: Land valuation codes/neighborhoods (01, 04, 05, 051, 052, etc.)
- **Mobile/QF/Depth/Depr**: Additional property attributes

**Land Calculation Logic:**
- Searches LANDUR codes for 'ACRE'/'AC' vs 'SITE'/'SF'
- Auto-converts: Square feet ÷ 43,560 = Acres
- Sums multiple land segments (LANDUR_1 through LANDUR_6)

**InfoBy Code Categories:**
- **Entry Codes**: 01 (OWNER), 02 (SPOUSE), 03 (TENANT), 04 (AGENT)
- **Refusal Codes**: 06 (REFUSED)
- **Estimation Codes**: 07 (ESTIMATED)
- **Invalid Codes**: 05 (AT DOOR) - varies by job requirements
- **Commercial/Pricing**: 20 (CONVERSION), 08/09 (additional pricing codes)

### Microsystems

**Source Files**: Pipe-delimited text files  
**Code Files**: Pipe-delimited text files with 3-digit prefix system  
**Pricing**: InfoBy codes for pricing logic  
**Detection**: FileUploadButton detects pipe-delimited content → routes to Microsystems processor

**Code File Format:**
```
CODE|DESCRIPTION|RATE|CONSTANT|CATEGORY|TABLE|UPDATED
140R   9999|REFUSED INT|0|0|INFORMATION|0|07/05/18|
520CL  9999|COLONIAL|0|0|DESIGN|0|05/14/92|
210BCLR9999|BIDDLE CREEK LOW RES|0|0|VCS|0|06/24/02|
8FA16  0399|FORCED HOT AIR|4700|0|FORCED HOT AIR|E|06/24/02|
```

**AAACCCCSSSS Parsing Patterns:**
- **HVAC (8 prefix)**: "8ED16  0399" → prefix="8", suffix="ED" (2 chars after 8)
- **InfoBy (140 prefix)**: "140R   9999" → prefix="140", suffix="R" (single char)
- **VCS (210 prefix)**: "210BCLR9999" → prefix="210", suffix="BCLR" (4 chars)
- **Other codes**: "520CL  9999" → prefix="520", suffix="CL" (multi-char)

**Property Class Mapping:**
- **Residential**: Classes 2, 3A
- **Commercial**: Classes 4A, 4B, 4C
- **Other**: Classes 1, 3B, 5A, 5B (not counted in totals)

**3-Digit Prefix System:**
- **140**: InfoBy codes (140A=AGENT, 140O=OWNER, 140R=REFUSED, etc.)
- **210**: VCS/Neighborhood codes (210BCLR=BIDDLE CREEK LOW RES, etc.)
- **345**: Building quality class codes
- **490/491**: Condition codes (exterior/interior)
- **500**: Type use codes
- **520**: Design codes (520CL=COLONIAL, etc.)
- **8**: HVAC codes (8ED=AC ADDED, 8FA=FORCED HOT AIR, etc.)
- **Storage Pattern**: Stripped codes (A, O, R) vs lookup codes (140A, 140O, 140R)

## Key Services & APIs

### propertyService (Critical Discovery!)

**Location**: Part of `src/lib/supabaseClient.js` services

**Purpose**: Bridge between job-level raw_file_content storage and property-level access after September optimization

**Key Methods:**
```javascript
// Server-side RPC call to get raw data for specific property
getRawDataForProperty(job_id, property_composite_key)

// Client-side fallback for performance (directly accesses jobs.raw_file_content)
getRawDataForPropertyClientSide(job_id, property_composite_key)

// Vendor-aware acreage calculation
getCalculatedAcreage(property, vendor_type)

// Package sale detection (same deed book/page)
getPackageSaleData(properties)
```

**Why This Exists**: After moving raw_data from property_records to jobs.raw_file_content for performance, components still need property-specific raw data access. This service extracts individual property data from the consolidated job-level storage.

**Performance Pattern**: Components should use client-side method when possible, with caching via Map() to avoid repeated parsing of large raw_file_content.

### worksheetService

**Location**: Part of `src/lib/supabaseClient.js` services

**Purpose**: Handles worksheet data persistence for PreValuationTab

**Key Functions:**
- Saves normalization configuration
- Persists time normalized sales decisions
- Stores worksheet statistics
- Updates `market_land_valuation` table

### checklistService

**Location**: Part of `src/lib/supabaseClient.js` services

**Purpose**: Updates workflow checklist completion status

**Key Functions:**
- Updates checklist item completion when data is entered
- Marks items as auto-completed based on module activity
- Syncs with ManagementChecklist component

### App.js - System Orchestrator & Live Data Hub 🎯

**Core Philosophy**: Live data without caching - always fresh, always accurate

**Key Features:**
- **URL-Based Navigation**: Browser back/forward support, F5 refresh preservation
- **Live Data Loading**: No caching layer - direct database queries for freshness
- **Central State Management**: All job module data flows through App.js
- **Module State Persistence**: Analytics survive navigation between modules
- **Real-Time Data Flow**: ProductionTracker → App.js state → AdminJobManagement tiles
- **Job-Centric Navigation**: Select job first, then access modules
- **Role-Based Access**: Admin/Owner only for billing/payroll sections

**State Management Structure:**
```javascript
appData = {
  // Core Data
  jobs: [],              // Active jobs
  employees: [],         // All employees
  managers: [],          // Management type employees
  planningJobs: [],      // Future projects
  archivedJobs: [],      // Completed/draft jobs

  // Billing Data
  activeJobs: [],        // Standard billing jobs
  legacyJobs: [],        // Legacy billing jobs
  expenses: [],          // Monthly expenses
  receivables: [],       // Office receivables
  distributions: [],     // Shareholder distributions
  billingMetrics: {},    // Calculated financial metrics

  // Computed Data
  jobFreshness: {},      // File upload vs production run dates
  assignedPropertyCounts: {},
  workflowStats: {},     // ProductionTracker analytics
  globalInspectionAnalytics: null,

  // State Flags
  isLoading: false,
  isInitialized: false
}
```

**URL Routing Pattern:**
- Main views: /admin-jobs, /billing, /employees, /payroll, /users
- Job-specific: /job/{jobId} - Automatically restores job selection after F5
- Browser history: Full back/forward support with state restoration

**Live Data Loading (loadLiveData):**
- Component-specific loading: ['jobs'], ['billing'], ['employees']
- Full refresh: ['all'] - Used on initial load
- Job freshness calculation: Compares file uploads vs production runs
- Workflow stats extraction: Reads from jobs.workflow_stats field
- Error handling: Timeout detection, user-friendly messages

**Data Flow Patterns:**

**1. Job Selection Flow:**
User clicks job → handleJobSelect() → Updates URL → Sets selectedJob → Shows JobContainer

**2. Module Analytics Flow:**
ProductionTracker processes → Calls onUpdateWorkflowStats → Updates App.js state ���
Persists to jobs.workflow_stats → Available in AdminJobManagement tiles

**3. File Processing Flow:**
FileUploadButton processes → Triggers onFileProcessed → Sets refresh flag →
Refreshes data when user returns to jobs list

**Smart Patterns:**
- **Deferred State Updates**: Uses `setTimeout(() => setState(), 0)` to prevent React Error #301
- **Job Creation Lock**: `isCreatingJob` flag prevents race conditions during heavy operations
- **Analytics Completion Detection**: Tracks when ProductionTracker finishes initial processing
- **Workflow Stats Persistence**: All analytics stored in `jobs.workflow_stats` for navigation survival
- **Surgical Updates**: Billing changes reload only billing data, not entire app

**Job Transformation Logic:**
- Extracts workflow stats from either string or object format
- Maps job_assignments to assignedManagers array
- Calculates totalProperties from multiple fallback sources
- Determines freshness status for each job
- Transforms billing events for display

**Performance Monitoring:**
```javascript
performanceRef = {
  appStartTime: Date.now(),
  dbQueries: 0,
  avgLoadTime: 0
}
```

**Authentication Integration:**
- Supabase auth session management
- Role-based view restrictions
- Automatic redirect to landing page when logged out
- User context available throughout app

**Error Handling:**
- Database timeout detection (57014 error code)
- User-friendly error messages
- Cache status bar for error display
- Graceful fallbacks for missing data

**Calculation Functions:**
- `calculateBillingMetrics`: Financial rollups across jobs
- `calculateInspectionAnalytics`: Global employee performance
- `loadJobFreshness`: Determines which jobs need updates

**Component Props Distribution:**
Each component receives:
- Relevant data slice from appData
- onDataUpdate callback for changes
- onRefresh callback for fresh data
- Component-specific handlers

**Critical Implementation Notes:**
- NO caching - always fetch fresh data
- URL updates without page reload via pushState
- Job selection persists through F5 refresh
- Billing updates trigger multi-component refresh
- Workflow stats update both state and database

### JobContainer.jsx - Module Orchestrator & Central Data Loader 🎛️

**Scale**: ~500 lines, central hub for all job modules with unified data loading

**Core Philosophy**: Load data once, distribute everywhere - eliminate duplicate queries

**Key Features:**
- **Single Property Load Pattern**: Loads ALL property_records once with pagination
- **Assignment-Aware Filtering**: Respects `has_property_assignments` flag
- **Progress Bar in Banner**: Shows real-time loading progress (no modal!)
- **Handles 16K+ Records**: Pagination at 1000 records per batch
- **Module Tab Navigation**: Clean switching between 5 modules
- **Version Tracking**: Shows current data/code versions
- **Props Distribution**: Passes loaded data to all child modules
- **Analytics State Bridge**: Connects ProductionTracker to App.js

**Data Loading Stages:**
1. **Initialize**: Load job metadata, file versions, code definitions
2. **Check Assignments**: Query `has_property_assignments` flag
3. **Load Properties**: Paginated query with optional assignment filter
4. **Load Supporting Data**: Inspection data, market data, HPI data, checklist
5. **Load Employees**: For inspector validation
6. **Distribute Props**: Pass all data to active module

**Loading Progress Display:**
```
┌─��───────────────────────────────────────────────┐
│ Loading property records                     75% │
│ ███████████���████████████░░��░░░░░  12,450/16,600 │
│ records loaded (assigned only)                   │
└─────────────────────────────────────��───────────┘
```

**Assignment Filtering Logic:**
```javascript
if (jobData.has_property_assignments) {
  query = query.eq('is_assigned_property', true);
  // Shows "Assigned Properties Only" badge
}
```

**Module Navigation:**
- Checklist (ManagementChecklist)
- ProductionTracker (shows ✓ when processed)
- Market & Land Analysis
- Final Valuation (placeholder)
- Appeal Coverage (placeholder)

**Props Distribution Pattern:**
```javascript
baseProps = {
  jobData,              // Complete job metadata
  properties,           // ALL loaded properties
  inspectionData,       // Inspection records
  marketLandData,       // Market land valuation
  hpiData,              // County HPI data
  checklistItems,       // Checklist status
  employees,            // For validation
  latestFileVersion,    // Current data version
  onFileProcessed,      // Callback for updates
  onUpdateJobCache,     // Job refresh callback
}
```

**ProductionTracker Integration:**
- Passes currentWorkflowStats from App.js
- Handles onAnalyticsUpdate callback
- Transforms analytics to App.js format
- Persists to jobs.workflow_stats
- Shows green checkmark when processed

**Performance Metrics:**
- 5,000 properties: ~5 seconds total load time
- 13,000 properties: ~13 seconds total load time
- 16,000+ properties: ~16-20 seconds total load time
- Batch size: 1000 records per database query
- Delay between batches: 100ms to prevent overload

**Smart Behaviors:**
- **No Double Loading**: Properties load once, shared across all modules
- **Progress Calculation**: (loadedCount / totalCount) * 100
- **Error Recovery**: Retry button for failed loads
- **Module State Preservation**: Switching tabs doesn't reload data
- **File Processing Hook**: Refreshes when FileUploadButton processes
- **Analytics Completion Detection**: Shows indicator when ProductionTracker finishes

**Version Banner States:**
- **Loading**: Shows progress bar with percentage
- **Success**: Blue banner with version info and property count
- **Error**: Red banner with error message and retry option
- **Assignment Mode**: Yellow badge "Assigned Properties Only"

**Data Update Flow:**
```
FileUploadButton processes → setFileRefreshTrigger →
JobContainer reloads → Updates all module props
```

**Module Props Interface:**
Each module receives the complete data package, preventing need for individual queries:
- Properties array (filtered if assignments active)
- Supporting data (inspection, market, HPI)
- Callbacks for updates and refresh
- Version tracking information
- Loading state indicators

**Critical Implementation Notes:**
- Always loads from property_records, never from cache
- Pagination prevents Supabase timeout on large datasets
- Assignment filtering happens at database level, not client
- Progress bar updates smoothly with each batch
- Module switching preserves all loaded data
- FileUploadButton integration triggers automatic refresh

### AdminJobManagement.jsx - Enterprise Job Operations Platform 🚀

**Scale**: 3,200+ lines managing entire job lifecycle with real-time monitoring

**Core Features:**
- **Five-Tab Command Center with Live Counts**: Each tab shows real-time record counts
  - Active Jobs: Live metrics, assignment management, freshness tracking, database connection indicator
  - Planning Jobs: Pipeline management with job conversion workflow, Add/Edit/Delete functionality
  - Archived Jobs: Historical reference system (includes both 'archived' and 'draft' status)
  - County HPI: Housing Price Index data management per county with import/update buttons
  - Manager Assignments: Workload distribution analytics (excludes Tom Davis from display)

- **Real-Time Batch Processing Monitor**: Console.log hijacking shows users live import progress
- **Property Assignment System**: Handles 1000+ property CSV uploads with batch processing
- **Payroll Period Detection**: Knows when updates are needed for accurate payroll/billing
- **Live Metrics Integration**: Prioritizes real-time data from App.js over database values
- **Freshness Tracking**: Color-coded indicators (Green ≤3 days, Yellow ≤14 days, Red >14 days)
- **URL-Based Job Selection**: Restores selected job from URL path on page refresh (/job/{id})

**Job Data Transformation Pipeline:**
- Transforms raw database records to UI-ready format
- Maps `workflow_stats` (string or object) to property counts
- Converts `job_assignments` to `assignedManagers` array
- Falls back to multiple fields for counts (workflow_stats → inspected_properties → 0)
- Handles job type differentiation (standard vs legacy_billing)

**Planning Jobs Features:**
- Create new planning jobs with metadata
- Edit existing planning job details
- Convert planning job to active job
- Delete planning jobs
- Track potential contract values

**Archive & Job Lifecycle Management:**
- **Archive Job Function**: Moves completed jobs from Active to Archived status
  - Validates checklist completion before archiving (shows warning modal if items incomplete)
  - Option to archive anyway if checklist has open items
  - Sets `archived_at` timestamp and `archived_by` user ID
  - Changes job status to 'archived'
  - Archives button only visible on Active Jobs tab
- **Restore Job Function**: Restores archived jobs back to active status
  - Clears `archived_at` and `archived_by` fields
  - Changes job status back to 'active'
  - Unarchive button only visible on Archived Jobs tab
- **Billing Integration**: Archived jobs automatically move from Active Jobs to Legacy Jobs in BillingManagement
  - Filter logic: `activeJobs` = standard jobs NOT archived
  - Filter logic: `legacyJobs` = legacy_billing jobs OR archived jobs
  - Payment history preserved when archived
- **Checklist Integration**: Uses `checklistService.getChecklistItems()` to verify completion status
- **User Experience**:
  - Archive confirmation modal with clear messaging
  - Checklist warning modal shows incomplete items by name
  - "Restore to Active" button with green styling on archived jobs
  - Processing states prevent double-clicks
- **Database Fields**:
  - `jobs.archived_at` - timestamp with time zone
  - `jobs.archived_by` - uuid reference to users table
  - `jobs.status` - updated to 'archived' or 'active'

**Manager Assignments Display:**
- Visual workload cards per manager
- Color-coded workload levels (green/yellow/red)
- Active job count per manager
- Filters out owner-level users from management view
- Shows unassigned jobs separately

**Smart Patterns:**
- **Assignment-Aware Display**: Shows "Residential Only" when no commercial properties assigned
- **Parallel Data Loading**: Everything loads at once, then async updates for better UX
- **Composite Key Matching**: Generates keys EXACTLY like processors for accurate matching
- **Smart Job Sorting**: By year → billing % → municipality
- **Force Quit Option**: Escape hatch for problematic imports
- **Tab Navigation Memory**: Maintains active tab during data refreshes

**Production Details:**
- Batch size: 500 records for large file processing (assignments and job creation)
- Query batch size: 100 records for property matching checks
- Timing gaps: 200ms between batches to prevent database overload
- Detects payroll periods (15th and end of month)
- Valuation phase jobs (91%+ billed) don't need production updates
- Dynamic property count calculation for assigned properties
- Human-friendly time displays ("2 days ago", "3 weeks ago")
- Force Quit option for problematic imports
- Enhanced assignment results with match rate tracking

### FileUploadButton.jsx - Comparison Engine & Workflow Orchestrator

**Core Philosophy**: Comparison-first workflow - always show changes before processing

**Key Features:**
- **Vendor Auto-Detection**: .csv → BRT, pipe-delimited → Microsystems
- **Comparison Analysis**: Missing records, deletions, sales changes, class changes
- **Sales Decision System**: Keep Old/Keep New/Keep Both for price conflicts
- **Report Generation**: Saves to comparison_reports table + CSV export
- **Version Tracking**: Separate handling for source vs code files
- **Batch Monitoring**: Real-time progress via console.log interception
- **Zero-Change Processing**: Updates version even when no changes detected

**Workflow Pattern:**
1. User selects file → Auto-detect vendor type
2. Compare against database → Show changes in modal
3. User makes sales decisions → Reviews all changes
4. Process approved changes → Call appropriate updater
5. Save comparison report → Update job metadata
6. Trigger data refresh → Notify parent components

**Comparison Categories:**
- **New Records**: Properties in file but not in database
- **Deletions**: Properties in database but not in file
- **Sales Changes**: Price/date differences requiring decisions
- **Class Changes**: Property classification modifications
- **Fuzzy Matches**: Near-matches for manual review (optional)

**Sales Decision Handling:**
- **Keep Old**: Reverts to database values
- **Keep New**: Uses file values (default)
- **Keep Both**: Stores new as current, old in sales_history
- Decisions persist to `sales_history` JSONB field
- Scroll position maintained during decision-making

**File Version Management:**
- Source file versions: `property_records.file_version`
- Code file versions: `jobs.code_file_version`
- Banner indicators: "Imported at Job Creation" (v1) vs "Updated via FileUpload" (v2+)
- Version increments even with no changes (tracks review activity)

**Composite Key Generation:**
- Generates keys EXACTLY matching processor logic
- BRT: `YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION`
- Microsystems: `YEAR+CCDD-Block-Lot_Qual-Bldg-Location`
- Handles edge cases: missing qualifiers, zero padding

**Batch Processing Modal:**
- Real-time console.log interception
- Progress indicators with record counts
- Color-coded log levels (info, warning, error, success)
- Expandable log entries with metadata
- Auto-scroll to latest entries
- Force quit option for problematic operations

**Report Export Features:**
- CSV format matching legacy structure
- Headers: Report_Date, Composite_Key, Change_Type, etc.
- Includes sales decisions and review status
- Compatible with Excel for manual review

**Integration Points:**
- Calls processors for initial imports (INSERT)
- Calls updaters for file updates (UPSERT)
- Triggers `onFileProcessed` callback to parent
- Updates job validation status
- Refreshes report count badge

**Error Handling:**
- Validates file content before processing
- Handles vendor detection failures
- Manages comparison timeouts
- Provides detailed error logging
- Rollback support for failed batches

**Performance Optimizations:**
- Targeted deletion using composite key lists
- Batch processing with configurable sizes
- Efficient comparison algorithms
- Minimal database round-trips
- Scroll position preservation during updates

**Sales Decision Persistence:**
```javascript
sales_history: {
  comparison_date: date,
  sales_decision: {
    decision_type: 'Keep Old/New/Both',
    old_price, new_price, old_date, new_date,
    decided_by: user, decided_at: timestamp
  }
}
```

### ProductionTracker.jsx - Analytics & Data Processing Engine 🚀

**Scale**: 4,400+ lines managing the entire data processing pipeline with real-time validation

**Core Philosophy**: Transform raw property data → clean inspection_data → real-time analytics → business intelligence

**Key Features:**
- **Pagination Engine**: Handles 100K+ properties bypassing Supabase limits with batch processing
- **Real-Time Validation Modal**: Pauses mid-processing for manager override decisions
- **Assignment-Aware Processing**: Filters by `is_assigned_property` when job has assignments
- **Nine Validation Rules**: Comprehensive data quality checks with business logic
- **Inspector Type Analytics**: Role-specific metrics (Residential, Commercial, Management)
- **Five-Tab Dashboard**: Inspector Analytics, Billing Summary, Validation Report, Missing Properties, Override Management
- **Dynamic InfoBy Configuration**: Reads code files, cleans vendor-specific formats
- **Validation Override System**: Complete CRUD with audit trail, persists to inspection_data
- **Module State Bridge**: Sends complete analytics package to App.js for navigation survival
- **Persistence Layer**: UPSERTs all valid records to inspection_data in one batch
- **External Inspector Support**: Handles client codes merged with regular employee data

**The Nine Validation Rules:**
1. **Valid date + missing initials** → scrub (remove from inspection_data)
2. **Valid initials + missing/invalid date** → scrub
3. **Invalid InfoBy codes** → scrub
4. **Refusal code but missing listing data** → flag for review
5. **Entry code but missing listing data** ��� flag for review
6. **Estimation code but has listing data** → flag for review
7. **Residential inspector on commercial property** → flag for review
8. **Zero improvement but missing listing data** → flag for review
9. **Price field validation (BRT only)** → scrub if invalid

**Processing Flow:**
1. **Lock project start date** → Filters old inspector noise
2. **Configure InfoBy categories** → Reads from parsed_code_definitions
3. **Start session** → UUID tracking for batch integrity
4. **Load ALL properties with pagination** → Handles 16K+ records
5. **Validate with 9 rules** → Collects issues for modal review
6. **Show validation modal** → One issue at a time with navigation
7. **Apply override decisions** → Skip or override during processing
8. **UPSERT to inspection_data** → Batch of 250 with retry logic
9. **Calculate analytics** → Entry rates, refusal rates, completion percentages
10. **Update App.js state** → Force navigation survival
11. **Persist to database** → jobs.workflow_stats for permanent storage

**Five-Tab Dashboard:**

**1. Inspector Analytics Tab:**
- Individual inspector performance tiles
- Entry/Refusal/Estimation rates
- Daily averages and totals
- Role-specific metrics (Residential vs Commercial vs Management)
- External inspector support with "(External)" suffix

**2. Billing Summary Tab:**
- Job-level completion metrics
- Entry rate: Entries ÷ Total Residential × 100
- Refusal rate: Refusals ÷ Total Residential × 100
- Commercial complete %: Inspected ÷ Total Commercial × 100
- Pricing complete %: Priced ÷ Total Commercial × 100

**3. Validation Report Tab:**
- All properties with validation issues
- Grouped error messages per property
- Override management interface
- Export to CSV functionality
- Shows WHY properties were excluded

**4. Missing Properties Tab:**
- Properties not in inspection_data
- Reason codes for exclusion
- Export capability
- Helps identify data gaps

**5. Override Management Tab:**
- CRUD operations for overrides
- Audit trail with timestamps
- Custom reason tracking
- Bulk operations support

**Smart Processing Details:**
- **Project start date locking**: Filters old inspector noise
- **Session-based processing**: UUID tracking for batch integrity
- **Special codes category**: V, N bypass validation
- **External contractor awareness**: Tracks unassigned properties
- **Data staleness detection**: Knows when to reprocess
- **Compound validation messages**: Groups issues per property
- **Export everything**: 3 different CSV reports
- **Force navigation survival**: via `jobs.workflow_stats`
- **Validation override syncing**: Prevents duplicate key errors by updating file_version
- **Promise-based modal wait**: Uses `window._resolveProcessingModal` pattern (temporary solution)
- **Single validation review**: Shows one issue at a time with navigation controls
- **Progress notifications**: Every 5000 records for large datasets

**Performance Optimizations:**
- Batch size: 250 records for UPSERT operations
- Retry logic: 50 attempts with exponential backoff
- Pagination: 1000 records per page from JobContainer
- Validation decision batching: Single database write
- Override lookup map: Fast O(1) checking
- Complete property data in overrides: Avoids additional lookups

**External Inspector Pattern:**
- Stored as comma-separated string in `jobs.external_inspectors`
- Merged with regular employees for validation
- Display with "(External)" suffix in analytics
- Count toward analytics but flagged separately
- Configured in ProductionTracker settings panel

**Data Flow to App.js:**
```javascript
workflowStats = {
  jobEntryRate: 85.2,
  jobRefusalRate: 6.3,
  commercialCompletePercent: 92.5,
  pricingCompletePercent: 78.4,
  validInspections: 4231,
  totalRecords: 5142,
  lastProcessed: timestamp,
  needsRefresh: boolean
}
```

### MarketAnalysis.jsx - Comprehensive Valuation System Parent 🎯

**Scale**: 173 lines - lightweight orchestrator for 6 heavyweight tab components

**Core Philosophy**: Tab orchestrator receiving props from JobContainer, no double loading

**Architecture Pattern:**
```
JobContainer loads data once → MarketAnalysis receives props → Distributes to tabs
```

**Props Received from JobContainer:**
- `properties` - Complete property array (pre-loaded, filtered if assigned)
- `jobData` - Job metadata including vendor_type, parsed_code_definitions
- `marketLandData` - market_land_valuation record
- `hpiData` - County HPI data for normalization
- `checklistStatus` - For auto-completion tracking
- `onUpdateJobCache` - Callback for refreshing parent data

**Tab Structure:**
1. **Data Quality/Error Checking** - Validate data integrity, identify issues
2. **Pre-Valuation Setup** - Normalization (time/size) + Page by Page Worksheet
3. **Overall Analysis** - General analysis including Condos
4. **Land Valuation** - Complete 7-section land system with Economic Obsolescence (4,400+ lines!)
5. **Cost Valuation** - New Construction + Cost Conversion Factor
6. **Attribute & Card Analytics** - Condition/Misc Items + Additional Cards

**Data Flow Management:**
- **No Double Loading**: Uses properties from JobContainer props
- **Vendor Detection**: Extracts from jobData.vendor_type
- **Code Definitions**: Uses jobData.parsed_code_definitions
- **Property Count**: Displays in header from props.length
- **Unsaved Changes**: Tracks via landValuationSession state

**Tab Component Complexity:**
- **LandValuationTab**: 4,400+ lines (THE BEAST!)
- **PreValuationTab**: 3,726 lines
- **DataQualityTab**: 2,651 lines
- **CostValuationTab**: ~1,500 lines
- **OverallAnalysisTab**: ~1,000 lines
- **AttributeCardsTab**: ~800 lines

**Inter-Tab Communication:**
- Custom events for navigation from ManagementChecklist
- `navigate_market_analysis_tab` event listener
- `navigate_prevaluation_subtab` for inner tab navigation
- `navigate_landvaluation_subtab` for land section navigation

**Session Management:**
```javascript
landValuationSession = {
  hasUnsavedChanges: boolean,
  lastSaved: timestamp,
  currentSection: string,
  dataVersion: number
}
```

**Header Display:**
```
Market & Land Analysis
Properties: 5,234 | Vendor: BRT | [Unsaved Changes indicator]
```

**Tab Navigation Pattern:**
- Maintains active tab state
- No data reload on tab switch
- Preserves work between tabs
- Shows unsaved changes warning

**External Navigation Support:**
From ManagementChecklist, items can directly navigate to specific tabs:
- "Market Analysis" → pre-valuation → marketAnalysis subtab
- "Page by Page Analysis" → pre-valuation → worksheet subtab
- "VCS Reviewed/Reset" → land-valuation → vcs-sheet subtab
- "Cost Conversion Factor Set" → cost-valuation tab
- "Land Value Tables Built" → land-valuation tab

**Browser Integration:**
- beforeunload handler warns about unsaved changes
- Scroll to top on external navigation
- Tab state persists during module switches

**Available Fields Detection:**
Builds list of available fields from properties for dropdown menus:
```javascript
const fieldList = properties.length > 0 ?
  Object.keys(properties[0]).filter(key =>
    typeof properties[0][key] !== 'object'
  ) : [];
```

**Props Distribution to Tabs:**
Each tab receives:
- All parent props (properties, jobData, etc.)
- activeTab for visibility control
- vendorType extracted from jobData
- codeDefinitions from parsed_code_definitions
- onUpdateJobCache for parent refresh

**Critical Implementation Notes:**
- Lightweight parent, heavy lifting in tabs
- No duplicate data loading
- Tab components handle their own state
- External navigation events respected
- Unsaved changes protection
- Property count always visible

### DataQualityTab.jsx - Data Quality & Error Checking Engine 🔍

**Scale**: 2,651 lines of comprehensive data validation and quality checks

**Core Philosophy**: Catch data issues early, provide actionable insights, enable manager decisions

**Key Features:**
- **14 Standard Validation Checks**: Pre-built business logic validations
- **Custom Check Builder**: Create job-specific validation rules
- **Ignore System**: Mark false positives to reduce noise
- **Quality Score**: 0-100% score based on issue severity
- **Issue Categorization**: Critical, Warning, Info levels
- **Excel Export**: Export all issues or ignored items
- **QC Form Template**: Generate PDF for field verification
- **Run History**: Track multiple analysis runs with timestamps

**Three Sub-Tabs:**
1. **Overview**: Dashboard with metrics, run button, history
2. **Standard Checks**: Pre-built validations with results
3. **Custom Checks**: User-defined rules builder
4. **Ignored**: Manage false positives

**Standard Validation Checks:**

**Vacant Land Checks:**
- Vacant land with improvements
- Missing improvements on non-vacant
- CAMA vacant land with improvements
- CAMA properties missing improvements

**Data Completeness:**
- Missing facility information
- Missing design style
- Missing type use
- Missing building dimensions
- Zero improvement value issues

**Classification Errors:**
- Farm building without qualifier
- Non-residential with wrong building class
- Residential properties with building class 10
- Type use/building class mismatches
- Design without proper building class
- Design without type use

**Custom Check Builder:**
```javascript
// Example custom check configuration
{
  name: "Commercial without Tax ID",
  severity: "warning",
  conditions: [
    { field: "property_m4_class", operator: "is one of", value: "4A,4B,4C" },
    { field: "tax_id", operator: "is null", logic: "AND" }
  ]
}
```

**Condition Operators:**
- equals, not equals
- >, <, >=, <=
- is null, is not null
- contains
- is one of, is not one of

**Logic Support:**
- AND conditions (all must match)
- OR conditions (any must match)
- Multiple condition groups

**Issue Statistics Display:**
```
┌────────────���──────────────��─────────────────┐
│ Total Properties: 5,234                     │
│ Properties with Issues: 342                 │
│ Critical: 45 | Warnings: 187 | Info: 110   │
│ Quality Score: 93.4%                        │
���──────────────────────────────────────��──────┘
```

**Quality Score Calculation:**
```javascript
// Weighted deductions per issue type
issueWeights = {
  critical: 10,  // Heavy penalty
  warning: 5,    // Moderate penalty
  info: 1        // Light penalty
};
score = 100 - (totalDeductions / propertyCount)
```

**Ignore System Workflow:**
1. Run analysis → Find issues
2. Review false positives
3. Click "Ignore" on specific issues
4. Issues move to Ignored tab
5. Persist ignored list to database
6. Future runs auto-filter ignored items

**Database Persistence:**
- Saves to market_land_valuation.quality_check_results
- Stores custom checks configuration
- Maintains ignored issues list
- Tracks run history with timestamps

**Export Features:**

**Main Export (Excel):**
- All categories and issues
- Property details
- Severity levels
- Issue descriptions
- Composite keys for reference

**Ignored Export:**
- Only ignored items
- Reason for ignoring
- Original issue details

**QC Form Template (PDF):**
- Printable field verification form
- Checkboxes for common issues
- Space for notes
- Property identification fields

**Performance Optimizations:**
- Batch processing of checks
- Category-based grouping
- Lazy loading of property details
- Cached check results
- Efficient field access patterns

**Integration Points:**
- Receives properties from JobContainer
- Uses vendor type for specific checks
- Accesses code definitions for validation
- Saves results to market_land_valuation
- Updates parent via onUpdateJobCache

**Smart Behaviors:**
- Auto-expands categories with issues
- Collapses empty categories
- Shows issue counts per check
- Highlights critical issues
- Preserves ignored items between runs
- Clear visual severity indicators

**Modal System:**
- Property details modal for deep inspection
- Issue list with pagination
- Direct property editing capability
- Bulk ignore functionality

**Critical Implementation Notes:**
- Standard checks hardcoded for consistency
- Custom checks saved per job
- Ignored items persist across sessions
- Quality score updates real-time
- Export includes all metadata
- Run history limited to last 10 runs

### PreValuationTab.jsx - Pre-Valuation Setup & Normalization Engine 📊

**Scale**: 3,726 lines of sophisticated normalization and worksheet management

**Core Philosophy**: Prepare properties for valuation through systematic normalization and review

**Two Main Components:**
1. **Normalization** - Time and size adjustments for market comparison
2. **Page by Page Worksheet** - Systematic property review interface

**Normalization Component:**

**Time Normalization Features:**
- **HPI-Based Adjustment**: Uses county_hpi_data table for multipliers
- **Formula**: `Sale Price × (Target Year HPI ÷ Sale Year HPI)`
- **Target Year Selection**: Typically normalize to 2012 or current year
- **Sales Filtering**:
  - Minimum sale price threshold (default $10,000)
  - Year range selection (e.g., 2010-2024)
  - Sales NU validation (empty, null, 00, 7, or 07 are valid)
  - Card filtering (Card 1 for BRT, Card M for Microsystems)
- **Package Sale Detection**: Identifies same deed book/page transactions
- **Additional Cards Handling**: Aggregates SFLA from multiple cards

**Size Normalization (Jim's 50% Method):**
```javascript
Formula: (((Group Avg Size - Sale Size) × ((Sale Price ÷ Sale Size) × 0.50)) + Sale Price)

// Groups properties by type (single family, multi-family, etc.)
// Applies 50% adjustment factor for size differences
// Preserves time normalization results
```

**Sales Ratio Analysis:**
- **Ratio Calculation**: Assessed Value ÷ Time Normalized Price
- **Outlier Detection**: Flags sales outside equalization ratio threshold
- **Default Settings**:
  - Equalization Ratio: 70%
  - Outlier Threshold: 15%
  - Properties flagged if ratio differs >15% from 70%

**Keep/Reject Decision Interface:**
- Manual review of flagged outliers
- Keep/Reject/Pending status for each sale
- Batch operations (Keep All, Reject All)
- Decisions persist to database
- Visual indicators for outliers

**Statistics Dashboard:**
```
┌─────────────────────────────────────────────┐
│ Total Sales: 1,234                          │
│ Time Normalized: 1,234                      │
│ Average Ratio: 68.5%                        │
│ Flagged Outliers: 142                       │
│ Pending Review: 42                          │
│ Kept: 89 | Rejected: 11                     │
└───���─────────────────────────────────────────┘
```

**Page by Page Worksheet Component:**

**Excel-Like Data Grid Features:**
- **Sortable Columns**: Block, Lot, Location, Class, etc.
- **Manual Entry Fields**:
  - new_vcs - Manager-assigned neighborhood codes
  - location_analysis - Location factors (Railroad, Highway, etc.)
  - asset_zoning - Zoning classification
  - asset_map_page - Tax map page reference
  - asset_key_page - Key map page reference
  - worksheet_notes - General notes field

**Smart Features:**
- **Multi-Page Support**: Format "12,13,14" or "12-15" for spanning pages
- **Location Standardization**: Fuzzy matching prevents typos
  - "railraod" → "Railroad"
  - "hwy" → "Highway"
  - Common misspellings auto-corrected
- **VCS Validation**: Alphanumeric codes (A1, DOWNTOWN, SECTOR-5)
- **Bulk Operations**: Apply values to filtered selections
- **Auto-Save**: Every 30 seconds to prevent data loss

**Filtering & Search:**
- Search by any field
- Filter by map page
- Filter by VCS code
- Filter by class
- Quick filters for empty fields

**Progress Tracking:**
```
Overall Progress: 1,045/1,234 (84.7%)
Page 12: 45/50 complete
Page 13: 38/42 complete
```

**Standardized Location Values:**
```javascript
standardLocations = [
  'Railroad', 'Highway', 'Power Lines', 'River',
  'Commercial', 'Industrial', 'School',
  'Park', 'Cemetery', 'Golf Course'
]
```

**Data Persistence:**

**Time Normalization Results:**
- Saved to market_land_valuation.time_normalized_sales
- Includes all sales with decisions
- Format: JSONB array of normalized sales

**Size Normalization Results:**
- Updates property_market_analysis.values_norm_time
- Updates property_market_analysis.values_norm_size

**Worksheet Data:**
- Saves to property_market_analysis table
- Fields: new_vcs, location_analysis, asset_zoning, asset_map_page, asset_key_page
- Auto-save every 30 seconds
- Manual save button also available

**Configuration Storage:**
- Normalization settings saved to market_land_valuation.normalization_config
- Includes year ranges, thresholds, target years
- Statistics saved to normalization_stats

**Performance Optimizations:**

**Batch Processing:**
- Processes 100 properties at a time for normalization
- Progress bar with real-time updates
- Prevents UI freezing on large datasets

**Smart Data Loading:**
- Only loads enhanced sales data when needed
- Caches HPI data for quick lookups
- Debounced search (300ms delay)

**Memory Management:**
- Pagination for large result sets
- Virtual scrolling for worksheet
- Lazy loading of additional cards

**Integration Points:**
- HPI Data: Uses county_hpi_data table
- Additional Cards: Aggregates from property_records
- Package Detection: interpretCodes.getPackageSaleData()
- Composite Key Parsing: Handles both BRT and Microsystems formats
- Vendor Detection: Adapts UI based on vendor type

**Business Rules:**
- Valid Sales NU: Empty, null, "00", "7", or "07"
- Building Class Filter: Must be > 10
- Required Fields: Type use and design style must exist
- Card Selection: Card 1 (BRT) or Card M (Microsystems)
- Outlier Threshold: Default 15% from equalization ratio
- Auto-Save Interval: 30 seconds for worksheet data

### OverallAnalysisTab.jsx - Overall Market & Condo Analysis 📈

**Scale**: ~1,000 lines of comprehensive property analysis and condo valuation

**Core Philosophy**: Provide market insights through systematic analysis and visual mapping

**Two Main Tabs:**
1. **Market Analysis** - Type/use, design, year built, VCS analysis
2. **Condo Analysis** - Floor premiums, design variations, bedroom configurations

**Market Analysis Tab:**

**Type & Use Analysis:**
- Groups properties by type use codes (10=single family, 60=condo, etc.)
- Calculates statistics for ALL properties vs properties WITH SALES
- Shows average year built and SFLA for each group
- **CME Bracket Calculation**: Maps average adjusted price to brackets
- **Delta Analysis**: Percentage difference from baseline group
- **Size-Adjusted Pricing**: Uses 50% method for normalization

**Statistics Display:**
```
┌─────────────────────────��────────────────���───────────────���─��
│ Type Use │ Total │ Avg Year │ Avg Size │ Sales │ Adj Price │
├───────────────────────────────────────────���────────────────┤
│ Single   │ 1,234 │   1985   │  1,850   │  156  │ $285,000  │
│ Multi    │   432 │   1972   │  1,450   │   45  │ $225,000  │
│ Condo    │   789 │   1998   │  1,100   │   89  │ $165,000  │
└───────────────────���────────────────────────────────────────┘
```

**Design Style Analysis:**
- Groups by design codes (Colonial, Ranch, Cape Cod, etc.)
- Vendor-aware code interpretation (BRT vs Microsystems)
- Shows distribution percentages
- Sales analysis per design type
- Average pricing by style

**Year Built Analysis:**
- Decade grouping (1950-1959, 1960-1969, etc.)
- Visual bar chart for distribution
- Average price trends by decade
- Construction boom identification

**VCS by Type Analysis:**
- Cross-tabulation of VCS codes with property types
- Neighborhood-specific type distributions
- Average values by VCS/type combination
- Market segmentation insights

**Condo Analysis Tab:**

**Specialized Condo Features:**
- **Type Use Detection**: Code 6 (Microsystems) or 60 (BRT)
- **Floor Premium Analysis**: Calculates % difference from 1st floor baseline
- **Bedroom Configuration**: Studio, 1BED, 2BED, 3BED detection
- **Design Grouping**: Groups similar condo designs
- **VCS Complex Analysis**: Groups condos by VCS and bedroom count

**Floor Premium Calculation:**
```javascript
// Size-adjusted price for floor comparison
adjustedPrice = salePrice + ((avgSize - unitSize) × (pricePerSF × 0.5))
// Premium calculation
floorPremium = ((floorPrice - firstFloorPrice) / firstFloorPrice) × 100
```

**Floor Analysis Table:**
```
┌──────────────────────────────────────────────┐
│ Floor     │ Count │ Avg Price │ Premium      │
├──────────────────────────────────────────────┤
│ 1ST FLOOR │  234  │ $165,000  │ BASELINE     │
│ 2ND FLOOR │  189  │ $162,000  │ -2%          │
│ 3RD FLOOR │  145  │ $158,000  │ -4%          │
│ PENTHOUSE │   12  │ $195,000  │ +18%         │
└──────���─────────────����─────────────────────────┘
```

**Bedroom Detection Logic:**
- **Primary Method**: Checks design style for bedroom indicators
- **BRT Specific**: Looks for BEDTOT field in raw data
- **Microsystems**: Parses design codes (1BR, 2BR patterns)
- **Fallback**: Async enrichment from raw_data if available
- **Unknown Handling**: Groups separately for review

**VCS/Bedroom Grouping:**
```
VCS: RIVERSIDE COMPLEX
├── STUDIO: 45 units, Avg: $125,000
├── 1BED: 123 units, Avg: $145,000
├── 2BED: 89 units, Avg: $175,000
└── 3BED: 12 units, Avg: $225,000
```

**Block Value Mapping:**

**Color Scale Configuration:**
- Starting Value: Base price for first color
- Increment: Price step between colors
- 32-Color Palette: Matches Bluebeam Revu for PDF maps
- Consistency Metrics: Age, size, design uniformity

**Consistency Calculations:**

**Age Consistency:**
- High: ≤10 year range
- Medium: 11-25 year range
- Low: 26-50 year range
- Mixed: >50 year range

**Size Consistency:** Coefficient of variation
- High: CV ��15%
- Medium: CV 16-30%
- Low: CV >30%

**Design Consistency:** Unique design count
- High: 1-2 designs
- Medium: 3-4 designs
- Low: 5+ designs

**Export Options:**
- CSV Export: All analysis types
- PDF Reference: Color legend for mapping
- Block Summary: Statistics per block

**Performance Features:**

**Data Processing:**
- Memoized calculations with useMemo
- Async bedroom enrichment (BRT only)
- Single-pass analysis for all metrics
- Cached results prevent redundant processing

**Smart Behaviors:**
- Auto-runs analysis on data load
- Collapsible sections for space management
- Visual indicators for data quality issues
- Handles missing data gracefully

**Integration Points:**
- Uses interpretCodes for vendor-aware code lookup
- Accesses normalized prices from PreValuationTab
- Shares consistency metrics with other tabs
- Updates parent via onDataChange callback

**Business Rules:**
- Baseline Group: Most common type/use becomes baseline
- CME Brackets: Standard ranges for market segmentation
- Floor Premium Limits: Typically -10% to +20% range
- Condo Identification: Type use starts with '6'
- Size Adjustment: Always uses 50% method
- Minimum Sales: Groups need 3+ sales for statistics

### LandValuationTab.jsx - Complete 7-Section Land Valuation System 🏞️

**Scale**: ~10,000 lines - **THE ABSOLUTE LARGEST COMPONENT IN THE ENTIRE SYSTEM**

**Core Philosophy**: Comprehensive land valuation using multiple methodologies, economic obsolescence analysis, and VCS-based rate structures

**Three Valuation Modes:**
1. **Acre Mode** (Default) - Uses acreage for calculations
2. **Square Foot Mode** - Alternative calculation method for smaller lots
3. **Front Foot Mode** - When frontage data is available (SFFR/EFFR rates)

**Seven Main Sections:**
1. **VCS Sheet** - Neighborhood configuration and zoning parameters
2. **Method 1: Vacant Land Sales Analysis** - Direct vacant land sales comparison
3. **Method 2: Lot Size Analysis** - Modal distribution analysis
4. **Rate Tables** - Cascade configuration with break points
5. **Economic Obsolescence** - Location factor adjustments
6. **Allocation Study** - Validation and distribution analysis
7. **Special Regions** - Region-specific rate overrides

**Valuation Mode Configuration:**

**Acre Mode (Default):**
- Primary calculation: Total Acreage × Rate per Acre
- Auto-converts SF to acres (÷ 43,560)
- Cascade breaks on acreage thresholds
- Typical for suburban/rural properties

**Square Foot Mode:**
- Direct SF calculation without conversion
- Rate per square foot
- Cascade breaks on SF thresholds
- Typical for urban/high-density areas

**Front Foot Mode:**
- Uses asset_lot_frontage field
- Frontage × Depth × Rate per Front Foot
- SFFR/EFFR rate structures
- Common for commercial/waterfront properties

**Section 1: VCS Sheet Configuration**

**Key Features:**
- **Act Site vs Rec Site**: Manual override vs calculated recommendation
- **VCS Type Classification**: Residential/Commercial/Mixed designation
- **Zoning Configuration**: Complete zoning parameters per VCS
- **Property Count Display**: Shows affected property counts per VCS
- **Collapsible Field Groups**: UI optimization for large datasets

**VCS Sheet Fields:**
```
VCS Code: A1 (DOWNTOWN RESIDENTIAL)
├── Type: Residential
├── Properties: 1,234 affected
├── Act Site Rate: $45,000/acre (manual override)
├── Rec Site Rate: $42,500/acre (calculated)
├── Zoning Config:
│   ├── Minimum Lot Size: 0.25 acres
│   ├── Max FAR: 0.35
│   ├── Setback Requirements: Front 25', Side 10', Rear 30'
│   └── Special Restrictions: Historic district overlay
└── Special Region: None
```

**VCS Configuration Storage:**
- Saves to market_land_valuation.worksheet_data
- JSONB structure for flexible schema
- Tracks manual overrides vs calculated recommendations
- Version history for rate changes

**Section 2: Method 1 - Vacant Land Sales Analysis**

**Process:**
- Filters properties with minimal/no improvements
- Analyzes sale prices per acre/SF
- Excludes outliers and non-arms-length transactions
- Groups by VCS for rate recommendation

**Exclusion Management:**
- Track excluded sales per method
- Reasons: Package sale, non-market, contaminated, etc.
- Exclusion persistence across sessions
- Export capability for audit trail

**Method 1 Results:**
```
VCS A1 - Vacant Land Analysis
├── Valid Sales: 45
├── Excluded: 12 (reasons tracked)
├── Average $/Acre: $42,500
├── Median $/Acre: $41,200
├── Range: $28,000 - $65,000
├── Standard Deviation: $8,200
└── Recommended Rate: $42,500 (median)
```

**Section 3: Method 2 - Lot Size Analysis**

**Modal Analysis:**
- Distribution analysis of lot sizes
- Identifies predominant lot size(s)
- Price per acre for modal lots
- Detailed review modal for verification

**Modal Review Features:**
- Interactive histogram
- Outlier identification
- Size clustering visualization
- Sale validation interface

**Method 2 Results:**
```
VCS A1 - Lot Size Analysis
├── Total Properties: 1,234
├── Modal Size: 0.50 acres (789 properties)
├── Secondary Modal: 0.25 acres (234 properties)
├── Sales at Modal Size: 23
├── Average Price: $21,250 per lot
├── Calculated Rate: $42,500/acre ($21,250 ÷ 0.50)
└── Confidence: High (large sample)
```

**Conservative Selection:**
- System recommends lower of Method 1 and Method 2
- Safety margin for defensible valuations
- Override capability with justification required
- Tracks selection rationale in database

**Section 4: Cascade Configuration**

**Break Points Configuration:**
- Customizable acreage/SF thresholds
- 3-6 step cascades (flexible)
- Rate stepping: automatic or manual degradation
- Visual rate table with color coding

**Standard 6-Step Cascade Example:**
```
VCS A1 - Residential Cascade
┌──────────���────────────────���───────��─────────┐
│ Break Point │ Rate/Acre │ Degradation      │
├─────────────────────────────────────────────┤
│ 0.00 - 0.50 │ $45,000   │ BASELINE         │
│ 0.51 - 1.00 │ $42,000   │ -6.7%            │
│ 1.01 - 2.00 │ $38,000   │ -9.5%            │
│ 2.01 - 5.00 │ $32,000   │ -15.8%           │
│ 5.01 - 10.0 │ $25,000   │ -21.9%           │
│ 10.01+      │ $18,000   │ -28.0%           │
└─────────────────────────────────────────────┘
```

**Rate Stepping Options:**
- **Automatic**: System calculates degradation based on market data
- **Manual**: Manager sets each rate individually
- **Percentage**: Define degradation % per step
- **Copy from VCS**: Inherit cascade from similar neighborhood

**Special Region Cascades:**
- Separate cascade logic per region
- Region-specific rate adjustments
- Override standard VCS rates when applicable
- Visual highlighting in rate tables

**Section 5: Economic Obsolescence Analysis**

**9 Default Location Codes:**
1. **BS** - Busy Street (with traffic level integration)
2. **RR** - Railroad
3. **HW** - Highway
4. **IN** - Industrial
5. **CO** - Commercial
6. **PL** - Power Lines
7. **WF** - Waterfront (positive factor)
8. **PK** - Park (positive factor)
9. **GC** - Golf Course (positive factor)

**Traffic Level Integration:**
- For BS (Busy Street) code, tracks specific traffic volumes
- ADT (Average Daily Traffic) ranges
- Adjustment scales with traffic intensity
- Example: BS-5000 (5,000 ADT) vs BS-25000 (25,000 ADT)

**Compound Factors:**
- System handles multiple factors: "BS/RR" (Busy Street + Railroad)
- Compound calculation: Applies both adjustments
- Standalone vs Compound Analysis: Separates single factors from combinations
- Override capability for unusual combinations

**Custom Location Codes:**
- Users can add beyond the 9 default codes
- Custom code configuration (positive/negative)
- Adjustment percentage per code
- Persistence across sessions

**Economic Obsolescence Workflow:**
```
1. Identify Location Factors:
   Property 123-45-67: BS/RR (Busy Street + Railroad)

2. Apply Adjustments:
   Base Land Value: $50,000
   BS Adjustment: -8%
   RR Adjustment: -5%
   Compound Total: -13% (additive)
   Adjusted Value: $43,500

3. Summary Adjustments:
   Cross-VCS averaging for consistent application
   Review compound factors for reasonableness
   Export worksheet for documentation
```

**Positive/Negative Split:**
- Separate fields for beneficial vs detrimental factors
- eco_obs_positive: Waterfront, Park, Golf Course
- eco_obs_negative: Busy Street, Railroad, Highway, Industrial
- Net adjustment calculation
- Visual indicators (green/red) in UI

**Summary Adjustments:**
- Cross-VCS averaging for consistent application
- Identifies inconsistencies across neighborhoods
- Recommended standard adjustments
- Manager review and approval workflow

**Data Persistence:**
Saves to market_land_valuation table:
- `eco_obs_code_config` - Complete configuration (codes, percentages, custom codes)
- `eco_obs_applied_adjustments` - Actual percentages applied per property
- `eco_obs_compound_overrides` - Compound factor handling rules
- `eco_obs_summary_adjustments` - Cross-VCS summary statistics

**Section 6: Special Regions Feature**

**9 Predefined Regions:**
1. **Pinelands** - NJ Pinelands National Reserve
2. **Highlands** - NJ Highlands Water Protection Area
3. **Coastal** - CAFRA zones
4. **Wetlands** - DEP wetlands restrictions
5. **Historic** - Historic district overlays
6. **Flood** - FEMA flood zones
7. **Airport** - Airport noise zones
8. **Brownfield** - Contaminated/remediation sites
9. **Agricultural** - Farmland preservation areas

**Custom Region Creation:**
- Define new region with boundaries
- Set region-specific rate overrides
- Attach to properties via GIS or manual assignment
- Track region impact on valuations

**Region-Specific Rate Overrides:**
```
VCS A1 - Base Rate: $45,000/acre
├── Standard Properties: $45,000/acre
├── Pinelands Override: $15,000/acre (-67%)
├── Wetlands Override: $8,000/acre (-82%)
└── Historic District: $52,000/acre (+16%)
```

**Visual Highlighting:**
- Color-coded rate tables by region
- Map integration (if available)
- Property count per region
- Impact analysis dashboard

**Section 7: Allocation Study & Validation**

**Purpose:**
- Validates land value as % of total property value
- Identifies over/under-valued land assessments
- Ensures defensible allocation ratios
- Tracks target allocation percentage

**Target Allocation Configuration:**
- Saves to market_land_valuation.target_allocation
- Typical residential: 25-35% land
- Commercial varies widely: 15-60%
- VCS-specific targets

**Allocation Study Results:**
```
┌─────��────────────────────────��──────────────────┐
│ VCS │ Avg Allocation �� Target │ Status          │
├───────��─────────────────────────────────────────┤
│ A1  │ 28.5%          │ 30%    │ ✓ Within Range  │
│ B2  │ 42.1%          │ 30%    │ ⚠ High - Review │
│ C3  │ 18.2%          │ 30%    │ ⚠ Low - Review  │
└─────────────────────────────────────────────────┘
```

**Validation Results:**
- Properties outside target range flagged
- Outlier analysis
- Recommended adjustments
- Export for detailed review

**Export Capabilities:**

**1. Land Rates Excel Export:**
- Complete rate analysis by VCS
- Cascade tables with all break points
- Economic obsolescence configuration
- Special region overrides
- Formatted for presentation/documentation

**2. Allocation Study Export:**
- Validation results per VCS
- Property-level allocation percentages
- Outlier identification
- Statistical summary

**3. VCS Sheet CSV:**
- For mapping software integration
- Rate assignments per property
- Geographic data included
- Import-ready format

**4. Economic Obsolescence Worksheet:**
- Excel format with all calculations
- Location factor assignments
- Adjustment percentages
- Compound factor analysis
- Property-level detail

**5. Complete Analysis Export:**
- All sections combined
- Executive summary
- Methodology documentation
- Statistical appendices
- Audit-ready package

**Data Persistence Details:**

**Saves to market_land_valuation table:**
```javascript
{
  // Configuration
  eco_obs_code_config: {
    defaultCodes: [...9 standard codes...],
    customCodes: [...user-defined codes...],
    adjustmentPercentages: {...},
    trafficLevels: {...}
  },

  // Applied Adjustments
  eco_obs_applied_adjustments: {
    propertyId: {
      factors: ['BS', 'RR'],
      adjustments: [-8, -5],
      totalAdjustment: -13,
      compoundOverride: false
    }
  },

  // Compound Factor Rules
  eco_obs_compound_overrides: {
    'BS/RR': { method: 'additive', cap: -15 },
    'WF/PK': { method: 'multiplicative', boost: 1.25 }
  },

  // Cross-VCS Summaries
  eco_obs_summary_adjustments: {
    averageByVCS: {...},
    standardDeviations: {...},
    recommendedStandards: {...}
  },

  // VCS Configuration
  worksheet_data: {
    vcsCode: {
      actSite: number,
      recSite: number,
      vcsType: 'Residential|Commercial|Mixed',
      zoning: {...},
      specialRegion: string|null
    }
  },

  // Allocation Target
  target_allocation: 30  // Percentage (e.g., 30%)
}
```

**Integration with ManagementChecklist:**

**Auto-Sync Completion Status:**
- **"Land Value Tables Built"** - Checks if cascade rates are configured
- **"Land Values Entered"** - Verifies VCS sheet completion
- **"Economic Obsolescence Study"** - Confirms eco obs analysis complete

**Workflow Integration:**
```
LandValuationTab saves data
    ↓
Updates market_land_valuation fields
    ↓
ManagementChecklist queries for completion
    ↓
Auto-checks checkboxes if criteria met
    ↓
Updates checklist_item_status table
```

**Completion Criteria:**
- Land Value Tables: cascade_rates field not empty
- Land Values Entered: worksheet_data populated for all active VCS codes
- Economic Obsolescence: eco_obs_code_config configured AND eco_obs_applied_adjustments populated

**Performance Optimizations (for 10K+ lines):**

**Lazy Loading:**
- Data loads on tab activation (not on parent mount)
- Section-by-section loading (VCS sheet → Methods → Rates → Eco Obs)
- Prevents initial render blocking
- Reduces memory footprint

**Debounced Saves:**
- Auto-save with 500ms delay
- Prevents excessive database writes
- Batches rapid changes
- User feedback via non-blocking notifications

**Pagination:**
- Vacant sales modal handles large datasets (1000+ sales)
- VCS sheet paginated for 100+ neighborhoods
- Property lists virtualized
- Lazy rendering of rate tables

**Memoization:**
- Uses useCallback for expensive calculations
- useMemo for cascade rate generation
- Cached VCS code lookups
- Prevents redundant processing

**Notification System:**
- Non-blocking save confirmations (toast messages)
- Progress indicators for long operations
- Error notifications with retry options
- Success feedback without interrupting workflow

**Debug Mode:**

**Enable Debug Logging:**
```javascript
// In browser console
window.DEBUG_LAND_VALUATION = true
```

**Debug Features:**
- Tracks all calculations and state changes
- Logs cascade rate generation logic
- Monitors economic obsolescence application
- Allocation calculation transparency
- Essential for troubleshooting allocation issues

**Debug Output Example:**
```
[LandVal] VCS A1: Calculating cascade rates
[LandVal] Method 1 result: $42,500/acre (45 sales)
[LandVal] Method 2 result: $42,500/acre (modal: 0.50ac)
[LandVal] Conservative selection: $42,500 (equal, using Method 1)
[LandVal] Cascade generated: 6 steps
[LandVal] Eco Obs applied: 234 properties, avg adjustment: -6.5%
[LandVal] Allocation check: VCS A1 = 28.5% (target: 30%, ✓)
[LandVal] Save complete: 1,234 properties updated
```

**Debug Use Cases:**
- Troubleshooting allocation percentage discrepancies
- Verifying cascade rate degradation logic
- Confirming economic obsolescence compound factors
- Validating Method 1 vs Method 2 selection
- Investigating performance bottlenecks

**Method 1 vs Method 2 Analysis:**

**Method 1: Vacant Land Sales Analysis**
- **Approach**: Direct analysis of vacant land sales
- **Data Source**: Properties with minimal/no improvements
- **Filters**:
  - Improvement value < 10% of total value
  - Valid arms-length transactions
  - Sale date within analysis period
  - Excludes package sales
- **Calculation**: Sale Price ÷ Lot Size (acres or SF)
- **Strengths**: Direct market evidence
- **Weaknesses**: Limited sales in some VCS areas

**Method 2: Lot Size Analysis**
- **Approach**: Modal distribution of lot sizes with sales at modal
- **Data Source**: All properties in VCS
- **Process**:
  1. Identify predominant lot size(s)
  2. Filter sales at or near modal size
  3. Calculate average price per lot
  4. Divide by modal lot size for rate
- **Strengths**: Works with limited vacant sales
- **Weaknesses**: Assumes consistent lot values

**Detailed Review Modal:**
- Interactive comparison of both methods
- Side-by-side results display
- Statistical confidence indicators
- Sale-by-sale breakdown
- Manager selection interface
- Justification notes field

**Conservative Selection Logic:**
```javascript
// System recommends lower value for defensibility
const recommendedRate = Math.min(method1Result, method2Result);

// Example:
// Method 1: $45,000/acre (15 vacant sales)
// Method 2: $42,500/acre (modal analysis)
// Recommended: $42,500/acre (conservative)
```

**Override Capability:**
- Manager can select higher value
- Requires justification note
- Tracks override in database
- Audit trail for review
- Warning displayed if override exceeds 10% difference

**Business Rules:**
- Minimum 3 sales required for Method 1 validity
- Modal size must represent >20% of properties for Method 2
- Conservative selection default unless overridden
- All calculations documented for defensibility
- State equalization ratio compliance checks

**Critical Implementation Notes:**
- Largest component requires careful state management
- Heavy use of JSONB for flexible data structures
- Cross-VCS consistency essential for legal defense
- Integration with ManagementChecklist for workflow tracking
- Export capabilities critical for documentation
- Debug mode essential for complex troubleshooting
- Performance optimizations mandatory for usability

### CostValuationTab.jsx - Cost Conversion Factor Analysis 💰

**Scale**: ~800 lines of new construction analysis and cost conversion calculations

**Core Philosophy**: Calculate and apply Cost Conversion Factor (CCF) for accurate property valuations based on replacement cost methodology

**Purpose**:
- Calculate Cost Conversion Factor (CCF) for property valuations
- Analyze new construction sales to determine market-to-cost relationships
- Apply consistent CCF across property types
- Validate replacement cost calculations

**Key Valuation Formula:**
```javascript
Adjusted Value = Current Land + ((Base Cost × Depreciation) × CCF) + Detached Items

// Where:
// Current Land = Land valuation from LandValuationTab
// Base Cost = Replacement cost of improvements
// Depreciation = 1 - ((Current Year - Year Built) / 100)
// CCF = Cost Conversion Factor (market adjustment)
// Detached Items = Garages, sheds, pools, etc.
```

**Dual CCF System:**

The component supports two CCF values with smart selection logic:

**1. Custom CCF (Job-Specific Override):**
- Set by manager for entire job
- Overrides all individual property calculations
- Used when market conditions require uniform adjustment
- Takes precedence over State County CCF
- Common when market data is limited or inconsistent

**2. State County CCF (Recommended Factor):**
- State or county guidelines
- Used as baseline/reference
- Can be overridden by Custom CCF
- Displayed for comparison purposes

**Selection Logic:**
```javascript
// When Custom CCF is set
if (customCCF) {
  appliedCCF = customCCF;  // Use for ALL properties
} else {
  // Calculate individual property CCF
  propertyCCF = improvementValue / replacementWithDepreciation;
  // Recommended factor = median of all included property CCFs
  recommendedCCF = median(allIncludedPropertyCCFs);
}
```

**Custom CCF Use Cases:**
- Market significantly above/below replacement cost
- Consistent adjustment needed across all property types
- Limited new construction sales data
- Manager override based on experience/judgment

**Price Basis Options:**

Component allows switching between two price calculation methods:

**1. Price Time (Default):**
- Uses normalized time values from PreValuationTab
- Accounts for market changes over time
- Recommended for multi-year sales periods
- Field: `values_norm_time` or time-adjusted sale price

**2. Sale Price (Raw):**
- Uses raw sale prices without time normalization
- Appropriate for recent sales only
- Simpler calculation
- Field: `sale_price`

**Price Basis Configuration:**
```
┌─────��───────────────────────────────────┐
│ Price Basis: ⦿ Price Time              │
│              ○ Sale Price               │
│                                         │
│ Using time-normalized values from       │
│ Pre-Valuation tab for accuracy         ���
└─────────────────────────────────────────┘
```

**Data Persistence:**
- Saves to `market_land_valuation.cost_valuation_price_basis`
- Persists selection across sessions
- Applied consistently to all calculations

**Property Type Grouping:**

Instead of prefix filtering, uses dropdown for property type groups based on `asset_type_use` field:

**Group Definitions:**
- **Group '1'** - Single family residential (type use codes starting with '1')
- **Group '2'** - Two family residential (type use codes starting with '2')
- **Group '3'** - Three family residential (type use codes starting with '3')
- **Group '4'** - Four+ family/commercial (type use codes starting with '4'+)

**Filtering Logic:**
```javascript
// Filter by first digit of asset_type_use
const filteredProperties = properties.filter(p => {
  const typeUse = p.asset_type_use?.toString() || '';
  return typeUse.startsWith(selectedGroup);
});
```

**Group Selection UI:**
```
Property Type: [Group 1 ▼]
  ├── Group 1 (Single Family) - 1,234 properties
  ├── Group 2 (Two Family) - 89 properties
  ├─��� Group 3 (Three Family) - 45 properties
  └── Group 4 (Multi/Commercial) - 234 properties
```

**Purpose:**
- Focus analysis on comparable property types
- Different CCF factors may apply to different property classes
- Residential vs commercial typically have different market-to-cost relationships

**Comprehensive Analysis Grid:**

The component displays a detailed analysis table with the following columns:

**Property Identification:**
- Block - Tax block number
- Lot - Tax lot number
- Qualifier - Lot qualifier (if applicable)
- Card - Card number for condos/multiple units

**Sales Data:**
- Sale Date - Transaction date
- Sale Price - Raw or time-normalized (based on price basis)
- NU Code - Sales validity code
- Price Time - Time-normalized price (if using Price Time basis)

**Building Characteristics:**
- Year Built - Construction year
- Class - Building quality class
- Living Area - Square footage of living space

**Valuation Components:**
- Current Land - Land value from LandValuationTab
- Det Items - Detached items value (garages, pools, etc.)
- Base Cost - Replacement cost of main structure

**Calculations:**
- Depreciation - Age-based depreciation percentage
- Replacement w/Depreciation - (Base Cost + Det Items) × Depreciation
- Improvement Value - Sale Price - Current Land - Det Items

**CCF Analysis:**
- CCF Calculation - Improvement Value ÷ Replacement w/Depreciation
- Adjusted Value - Using CCF formula
- Adjusted Ratio - (Adjusted Value ÷ Sale Price) × 100%

**Grid Display:**
```
┌─────────────────────────────────────────────���──────────────────────────────────────────────────┐
│ ☑ │ Block │ Lot │ Qual │ Card │ Sale Date │ Price    │ Year │ Class │ SFLA  │ Land   │ CCF   │
├─────────────────────────────────────────────────────────────────────────────────────────���──────┤
│ ☑ │ 123   │ 45  │      │ 1    │ 03/15/24  │ $285,000 │ 2020 │ C+3   │ 1,850 │ $45,000│ 1.15  │
│ ☑ │ 124   │ 12  │      │ 1    │ 06/22/24  │ $310,000 │ 2021 │ C+4   │ 2,100 │ $48,000│ 1.18  │
│ ☐ │ 125   │ 78  │      │ 1    │ 01/10/24  │ $265,000 │ 2019 │ C+2   │ 1,650 │ $42,000│ 1.08  │
└─────────────────────────────��────────────────────��─────────────────────────────────────────────┘
```

**Inclusion/Exclusion Feature:**

**Checkbox Per Property:**
- Allows manager to include/exclude individual properties from calculations
- Affects recommended CCF factor calculation
- Does not affect data persistence (session-only)

**Use Cases:**
- Exclude outliers (unusual sales, package sales)
- Exclude properties with data quality issues
- Focus on most comparable sales
- Test impact of specific properties on recommended factor

**Exclusion Workflow:**
```
1. Review grid and identify outliers
2. Uncheck properties to exclude
3. Recommended CCF recalculates automatically
4. Compare median with/without outliers
5. Make informed decision on final CCF
```

**Session-Only Behavior:**
- Inclusion/exclusion state not saved to database
- Resets when tab is closed/reopened
- Prevents accidental permanent exclusions
- Forces intentional review each session

**Impact Display:**
```
┌─────────────────────────────────────────┐
│ Total Properties: 45                    │
│ Included: 42                            │
│ Excluded: 3                             │
��                                         │
│ Recommended CCF (all): 1.15             │
│ Recommended CCF (included): 1.12        │
│ Difference: -2.6%                       │
└─────────────────────────────────────────┘
```

**Land Value Editing:**

**Inline Editing Capability:**
- Click on Current Land value to edit
- Override values from LandValuationTab
- Useful for testing "what if" scenarios
- Session-only changes (not saved to database)

**Editing Workflow:**
```
1. Click on Current Land cell
2. Enter new value
3. Press Enter to apply
4. All dependent calculations update automatically:
   - Improvement Value recalculates
   - CCF recalculates
   - Adjusted Value recalculates
   - Adjusted Ratio recalculates
```

**Visual Indicators:**
- Edited cells highlighted in light yellow
- Original value shown in tooltip on hover
- Reset button to restore original values

**Use Cases:**
- Test impact of different land values on CCF
- Override obviously incorrect land values
- Scenario analysis for different land rate structures
- Validation of land valuation methodology

**Important Note:**
- Changes are session-only
- Does not update property_market_analysis table
- Does not affect LandValuationTab calculations
- Resets when tab closed/reopened

**Year Range Filtering:**

**Purpose:**
- Focus on newer construction (≤20 years old)
- Filter properties by sale year
- Default: Last 3 years to current year

**Configuration:**
```
┌─────────────────────────────────────────┐
│ Sale Year Range:                        │
│ From: [2021 ▼]  To: [2024 ▼]           │
│                                         │
│ Properties in range: 45                 │
│ Newer construction (≤20 yrs): 42        │
└──────────────���──────────────────────────┘
```

**Auto-Save:**
- Saves range to market_land_valuation table
- Fields: `cost_valuation_from_year`, `cost_valuation_to_year`
- Persists across sessions
- Debounced save (500ms delay)

**Filtering Logic:**
```javascript
// Filter by sale year
const filtered = properties.filter(p => {
  const saleYear = new Date(p.sale_date).getFullYear();
  return saleYear >= fromYear && saleYear <= toYear;
});

// Additional filter: newer construction only
const newerConstruction = filtered.filter(p => {
  const age = currentYear - p.year_built;
  return age <= 20;
});
```

**Why Focus on Newer Construction:**
- More consistent with modern building costs
- Less depreciation complexity
- Better representation of current market-to-cost relationships
- Reduced impact of deferred maintenance

**Calculation Methods:**

**1. Depreciation Formula (Simple Straight-Line):**
```javascript
Depreciation = 1 - ((Current Year - Year Built) / 100)

// Example:
// Current Year: 2024
// Year Built: 2020
// Age: 4 years
// Depreciation: 1 - (4 / 100) = 0.96 (96%)
```

**Depreciation Characteristics:**
- 1% per year depreciation rate
- Simple, defensible methodology
- Caps at 0% (100 years old = fully depreciated)
- No accelerated or curved depreciation

**2. Cost Conversion Factor (CCF) Calculation:**

**When NO Custom CCF is set:**
```javascript
// Per-property calculation
Improvement Value = Sale Price - Current Land - Detached Items
Replacement w/Depreciation = (Detached Items + Base Cost) × Depreciation
CCF = Improvement Value / Replacement w/Depreciation

// Example:
// Sale Price: $285,000
// Current Land: $45,000
// Detached Items: $5,000
// Base Cost: $200,000
// Depreciation: 0.96 (4 years old)
//
// Improvement Value = $285,000 - $45,000 - $5,000 = $235,000
// Replacement w/Depr = ($5,000 + $200,000) × 0.96 = $196,800
// CCF = $235,000 / $196,800 = 1.194
```

**3. Recommended Factor Calculation:**

**Uses Median (NOT Mean):**
```javascript
// Collect all CCFs from included properties
const includedCCFs = properties
  .filter(p => p.included)
  .map(p => p.calculatedCCF)
  .sort((a, b) => a - b);

// Calculate median
const median = includedCCFs[Math.floor(includedCCFs.length / 2)];

// Why median?
// - More resistant to outliers than average
// - Better represents "typical" market conditions
// - Reduces impact of unusual sales
```

**Median vs Mean Example:**
```
Property CCFs: [0.95, 1.05, 1.08, 1.12, 1.15, 1.18, 2.50]
                                                      ↑ outlier
Mean (Average): 1.29 (heavily skewed by outlier)
Median: 1.12 (represents typical market)

Recommended Factor: 1.12 (median)
```

**Export Functionality:**

**CSV Export Features:**
- Exports all filtered results
- Includes all calculation columns
- Filename format: `cost_valuation_analysis_YYYY-MM-DD.csv`

**Export Button:**
```
┌─────────────────────────────────────────┐
│ [📥 Export to CSV]                      │
│                                         │
│ Exports 42 included properties with:   │
│ - All property identification           │
│ - Sales data and characteristics        │
│ - Complete calculations                 │
│ - CCF analysis results                  │
└─────────────────────────────────────────┘
```

**Exported Columns:**
1. Block, Lot, Qualifier, Card
2. Sale Date, Sale Price, NU Code
3. Year Built, Building Class, Living Area
4. Current Land, Detached Items, Base Cost
5. Depreciation, Replacement w/Depreciation
6. Improvement Value, CCF Calculation
7. Adjusted Value, Adjusted Ratio
8. Included (Yes/No)

**Use Cases:**
- Documentation for client presentations
- State submission requirements
- Audit trail for methodology
- Further analysis in Excel
- Archive of analysis results

**Summary Statistics:**

**Bottom-of-Component Display:**
```
┌──���──────────────────────────────────────────────────────────┐
│                    SUMMARY STATISTICS                       │
├────────────���────────────────────────────────────────────────┤
│ Included Properties: 42                                     │
│                                                             │
│ Sum of Sale Prices:      $12,450,000                        │
│ Sum of Adjusted Values:  $12,280,000                        │
│ Overall Ratio:           98.6%                              │
│                                                             │
│ Recommended CCF (Median): 1.12                              │
│ Custom CCF Applied:       1.15                              │
│ State County CCF:         1.10                              │
└─────────────────────────��───────────────────────────────────┘
```

**Statistics Explained:**

**Sum of Sale Prices:**
- Total of all included property sale prices
- Represents total market value

**Sum of Adjusted Values:**
- Total of all calculated adjusted values using CCF formula
- Should closely match sale price sum for validation

**Overall Ratio:**
- (Sum of Adjusted Values ÷ Sum of Sale Prices) × 100%
- Target: ~100% (indicates accurate CCF)
- >100%: CCF may be too high
- <100%: CCF may be too low

**CCF Values:**
- Recommended: Median of included properties
- Custom: Manager override (if set)
- State County: Reference value (if available)

**Performance Optimizations:**

**1. Row Display Limit (500 Properties):**
```javascript
// Display only first 500 rows for performance
const displayedProperties = filteredProperties.slice(0, 500);

// Warning message if more than 500
if (filteredProperties.length > 500) {
  showWarning(`Showing first 500 of ${filteredProperties.length} properties.
               Use filters to narrow results.`);
}
```

**Why 500 Limit:**
- Prevents browser freezing with large datasets
- Maintains responsive UI
- Encourages use of filters for focused analysis
- All properties still included in calculations (only display limited)

**2. Debounced Auto-Save:**
```javascript
// Year range changes auto-save with 500ms delay
const debouncedSave = useCallback(
  debounce((fromYear, toYear) => {
    saveYearRange(fromYear, toYear);
  }, 500),
  []
);
```

**Benefits:**
- Prevents excessive database writes
- Allows user to adjust both years without multiple saves
- Smooth user experience
- Reduces server load

**3. Memoized Calculations:**
```javascript
// Expensive calculations cached with useMemo
const calculatedResults = useMemo(() => {
  return properties.map(p => ({
    ...p,
    depreciation: calculateDepreciation(p),
    replacementWithDepr: calculateReplacement(p),
    ccf: calculateCCF(p),
    adjustedValue: calculateAdjusted(p)
  }));
}, [properties, customCCF, priceBasis, currentLandOverrides]);
```

**Benefits:**
- Recalculates only when dependencies change
- Prevents redundant processing
- Faster re-renders
- Reduced CPU usage

**Data Persistence:**

**All Settings Saved to market_land_valuation Table:**

**Fields:**
```javascript
{
  // CCF Values
  cost_conv_factor: number,           // Custom CCF (job-wide override)
  cost_conv_recommendation: number,   // State County CCF (reference)

  // Filtering
  cost_valuation_from_year: number,   // Filter start year
  cost_valuation_to_year: number,     // Filter end year
  type_group: string,                 // Property type filter ('1', '2', '3', '4')

  // Configuration
  cost_valuation_price_basis: string  // 'price_time' or 'sale_price'
}
```

**Save Triggers:**
- Custom CCF: Manual save button
- State County CCF: Manual save button
- Year range: Auto-save with debouncing
- Type group: Auto-save on change
- Price basis: Auto-save on change

**Session-Only Data (NOT Saved):**
- Inclusion/exclusion checkboxes
- Current land value overrides
- Sort order and UI state

**Integration with ManagementChecklist:**

**Auto-Update Workflow:**
```
CostValuationTab saves Custom CCF
    ↓
Updates market_land_valuation.cost_conv_factor
    ↓
ManagementChecklist queries for completion
    ↓
Auto-checks "Cost Conversion Factor Set" if factor exists
    ↓
Updates checklist_item_status table
```

**Completion Criteria:**
```javascript
// Checklist item #24: "Cost Conversion Factor Set"
const isComplete =
  marketLandValuation.cost_conv_factor !== null &&
  marketLandValuation.cost_conv_factor > 0;
```

**Workflow Integration:**
- Syncs completion status with workflow engine
- Requires client approval (configurable)
- Tracks completion timestamp
- Records completing user

**Checklist Display:**
```
��� 24. Cost Conversion Factor Set ✓
     Completed: 2024-01-15 14:30
     By: Jim Smith
     Client Approved: Yes (2024-01-16)
     CCF Value: 1.15
```

**Living Area Field Detection:**

**Intelligent Field Search:**

The component searches for living area in multiple field names to handle vendor differences:

**Primary Fields (BRT):**
- `asset_living_area`
- `living_area`
- `asset_sfla`

**Alternate Fields (Microsystems):**
- `asset_sfl_a`
- `asset_sf_la`
- `sf_la`

**Additional Variants:**
- `sf_living_area`
- `asset_liv_area`
- `asset_livingarea`

**Nested Raw Data Search:**
- Also checks `property.raw_data.SFLA`
- Handles JSONB nested structures
- Vendor-specific raw data formats

**Field Detection Logic:**
```javascript
const getLivingArea = (property) => {
  // Try standard fields first
  const standardFields = [
    'asset_living_area', 'living_area', 'asset_sfla',
    'asset_sfl_a', 'asset_sf_la', 'sf_la',
    'sf_living_area', 'asset_liv_area', 'asset_livingarea'
  ];

  for (const field of standardFields) {
    if (property[field]) return property[field];
  }

  // Try nested raw_data
  if (property.raw_data?.SFLA) {
    return property.raw_data.SFLA;
  }

  // Return null if not found
  return null;
};
```

**Missing Data Handling:**
- Properties without living area flagged in UI
- Warning icon displayed
- Excludes from CCF calculation (no valid living area = no base cost)
- Summary shows count of properties with missing data

**Critical Implementation Notes:**
- Focuses on newer construction (≤20 years) for accuracy
- Median recommended factor more defensible than mean
- Session-only overrides prevent accidental data corruption
- Custom CCF takes precedence over calculated values
- Integration with ManagementChecklist for workflow tracking
- Export capabilities essential for client presentations
- Performance optimizations critical for large datasets
- Living area detection handles vendor variations

### AttributeCardsTab.jsx - Attribute & Additional Card Analysis 🏷️

**Scale**: ~2,500 lines of comprehensive attribute and card impact analysis

**Core Philosophy**: Quantify the market impact of property attributes and additional dwelling units through statistical comparison

**Purpose**:
- Analyze property attributes (condition, features) and their impact on valuation
- Assess additional card impacts on property values
- Calculate adjustment factors for unique property characteristics
- Support defensible valuation adjustments

**Three Sub-Tabs:**
1. **Condition Analysis** - Interior/exterior condition impact on values
2. **Custom Attribute Analysis** - Impact of any raw field attribute
3. **Additional Card Analysis** - Multiple dwelling units/structures analysis

**Sub-Tab 1: Condition Analysis**

**Purpose:**
- Analyzes interior and exterior condition impacts on property values
- Uses normalized time values for accurate comparisons
- Groups properties by condition codes
- Calculates dollar and percentage adjustments

**Condition Code Groups:**
- **EX** - Excellent
- **GD** - Good (often baseline)
- **AV** - Average
- **FR** - Fair
- **PR** - Poor
- Vendor-specific codes supported

**Analysis Features:**

**1. Property Grouping by Condition:**
```
Condition: GOOD (Baseline)
��── Count: 234 properties
├── Average SFLA: 1,850 SF
├── Average Year Built: 1985
├── Average Normalized Value: $285,000
└── Price per SF: $154.05

Condition: EXCELLENT
├── Count: 89 properties
├── Average SFLA: 1,920 SF
├── Average Year Built: 1992
└── Average Normalized Value: $325,000
```

**2. Jim's Formula Adjustment:**
```javascript
// Adjusts for SFLA differences between conditions
jimAdjusted = withAvg + ((withoutSFLA - withSFLA) × (withAvg / withSFLA) × 0.5)
flatAdj = jimAdjusted - withoutAvg
pctAdj = (flatAdj / withoutAvg) × 100

// Example: Excellent vs Good (baseline)
// withAvg = $325,000 (excellent average)
// withSFLA = 1,920 SF (excellent SFLA)
// withoutAvg = $285,000 (good average)
// withoutSFLA = 1,850 SF (good SFLA)
//
// jimAdjusted = $325,000 + ((1,850 - 1,920) × ($325,000 / 1,920) × 0.5)
// jimAdjusted = $325,000 + (-70 × $169.27 × 0.5)
// jimAdjusted = $325,000 - $5,925 = $319,075
// flatAdj = $319,075 - $285,000 = $34,075
// pctAdj = ($34,075 / $285,000) × 100 = 11.95%
```

**3. Baseline Selection:**
- **Manual Baseline**: Manager selects reference condition (typically "Good")
- **Auto-Detect**: System identifies most common condition as baseline
- Baseline shown with highlighted background
- All other conditions compared to baseline

**4. Interior Inspections Toggle:**
```
☑ Only Include Properties with Interior Inspections

Purpose:
- Ensures condition ratings are based on actual inspections
- Excludes drive-by/exterior-only inspections
- More reliable condition assessments
- Filters by inspection_info_by field
```

**5. Filtered by Property Type:**
- Dropdown filter for type/use codes
- Single Family, Duplex, Condo, etc.
- Ensures comparable property comparisons
- Prevents mixing commercial/residential

**Condition Analysis Results Table:**
```
┌─────────────────────────────���────────────────────────────────────────────────┐
│ Condition │ Count │ Avg SFLA │ Avg Year │ Avg Value  │ Flat Adj  │ % Adj    │
├���────────────────────────────��─────────────────────────────��──────────────────┤
│ EXCELLENT │   89  │  1,920   │   1992   │ $325,000   │ +$34,075  │ +11.95%  │
│ GOOD ⭐   │  234  │  1,850   │   1985   │ $285,000   │ BASELINE  │ BASELINE │
│ AVERAGE   │  156  │  1,830   │   1978   │ $255,000   │ -$30,000  │ -10.53%  │
│ FAIR      │   45  │  1,780   │   1972   │ $215,000   │ -$70,000  │ -24.56%  │
│ POOR      │   12  │  1,650   │   1965   │ $175,000   │-$110,000  │ -38.60%  │
└─────────────────────────────────────────────────────���────────────────────────┘
```

**Visual Indicators:**
- ⭐ Baseline condition marked
- Green text for positive adjustments
- Red text for negative adjustments
- Gray text when no data available

**Sub-Tab 2: Custom Attribute Analysis**

**Purpose:**
- Analyze impact of ANY raw field from property data
- Compare properties WITH attribute vs WITHOUT attribute
- Calculate market impact using Jim's formula
- Support for pools, garages, basements, fireplaces, etc.

**Workflow:**

**1. Field Selection:**
```
Select Field: [Choose from property data ▼]
  ├── POOL (from raw_data)
  ├── GARAGE_TYPE (from raw_data)
  ├── BASEMENT_TYPE (from raw_data)
  ├── FIREPLACE (from raw_data)
  ├── CENTRAL_AIR (from raw_data)
  └── [Any other field in raw_data]
```

**Field Dropdown Population:**
- Populated from actual property data
- Scans raw_data JSONB field
- Excludes empty/null fields
- Alphabetically sorted

**2. Match Value Entry:**
```
Field: POOL
Match Value: [Y___]  (Enter value to search for)

System searches for properties where raw_data.POOL = "Y"
```

**3. Analysis Execution:**
```
Run Analysis button triggers:
1. Split properties into WITH and WITHOUT groups
2. Calculate averages for each group
3. Apply Jim's formula for size adjustment
4. Display flat and percentage adjustments
```

**Custom Attribute Results:**
```
┌──────────────────��──────────────────────────────────────────────────┐
│ Attribute: POOL = "Y"                                               │
├───��─────────────────────────────────────────────────────────────────┤
│ WITH Pool (89 properties):                                          │
│   ├── Average SFLA: 2,100 SF                                        │
│   ├── Average Year Built: 1995                                      │
│   └── Average Normalized Value: $345,000                            │
│                                                                      │
│ WITHOUT Pool (1,145 properties):                                    │
│   ├── Average SFLA: 1,850 SF                                        │
│   ├── Average Year Built: 1985                                      │
│   └── Average Normalized Value: $285,000                            │
│                                                                      │
│ Jim's Adjusted Impact:                                              │
│   ├��─ Flat Adjustment: +$35,250                                     │
│   ├── Percentage: +12.37%                                           │
│   └── (Size-adjusted using 50% method)                              │
└─��───────────────────────────────────────────────────────────────────┘
```

**Supported Field Types:**
- Text fields (Y/N, codes)
- Numeric fields (values, counts)
- Nested JSONB fields
- Vendor-specific fields

**Use Cases:**
- Pool impact analysis
- Garage/carport value
- Basement finish impact
- Fireplace adjustments
- Central air value
- Any custom feature

**Sub-Tab 3: Additional Card Analysis (Most Complex)**

**Purpose:**
- Analyze impact of additional dwelling units/structures
- Identify package sales (multiple properties sold together)
- Calculate premiums/discounts for multi-unit properties
- Provide detailed property-level data

**Vendor-Specific Card Logic:**

**BRT Vendor:**
- Card 1 = Main dwelling (baseline)
- Cards 2, 3, 4+ = Additional structures
- Additional cards indicate: Mother-in-law suite, garage apartment, separate cottage, etc.

**Microsystems Vendor:**
- Card M = Main dwelling (baseline)
- Cards A-Z (except M) = Additional structures
- Different card scheme but same concept

**Three Analysis Components:**

**1. Package Pair Analysis:**

**Purpose:**
- Identifies properties sold as packages (same deed book/page)
- Compares package sales to single-property baseline
- Calculates premium/discount for packages

**Package Detection Logic:**
```javascript
// Group properties by deed book + page + sale date
const packages = properties.reduce((acc, prop) => {
  const key = `${prop.deed_book}-${prop.deed_page}-${prop.sale_date}`;
  if (!acc[key]) acc[key] = [];
  acc[key].push(prop);
  return acc;
}, {});

// Filter to only packages (2+ properties)
const packagePairs = Object.values(packages).filter(group => group.length > 1);
```

**Package Analysis Results:**
```
┌────────────────��────────────────────────────────────────────────────┐
│ Package Sales Analysis                                              │
├────────────────���────────────────────────────────────────────────────┤
│ Package Pairs Found: 12                                             │
│                                                                      │
│ Average Package Price: $425,000                                     │
│ Average Single Property (same VCS): $285,000                        │
│ Expected Value (2 × $285,000): $570,000                             │
│                                                                      ��
│ Package Discount: -$145,000 (-25.4%)                                │
│ (Typical: Buyers pay less for bulk purchases)                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Package Pair Details:**
```
Deed Book 1234, Page 567 (Sale Date: 03/15/2024)
├── Property 1: Block 45, Lot 12 - $210,000
├── Property 2: Block 45, Lot 13 - $215,000
└── Total Package: $425,000 (vs $570,000 expected)
```

**2. VCS Rollup Analysis:**

**Purpose:**
- Groups by VCS (neighborhood) code
- Compares properties WITH additional cards vs WITHOUT
- Shows impact of additional units on value
- Neighborhood-specific analysis

**VCS Rollup Results:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ VCS: A1 - DOWNTOWN RESIDENTIAL                                              │
├─────────────────���───────────────────────────���───────────────────────────────┤
│ WITH Additional Cards (23 properties):                                      │
│   ├── Average SFLA: 2,450 SF (combined from all cards)                      │
│   ├── Average Year Built: 1988                                              │
│   ├── Average Normalized Value: $385,000                                    │
│   └── Cards: Avg 2.3 cards per property                                     │
│                                                                              │
│ WITHOUT Additional Cards (211 properties):                                  │
│   ���── Average SFLA: 1,850 SF                                                │
│   ├── Average Year Built: 1985                                              │
│   └── Average Normalized Value: $285,000                                    │
│                                                                              │
│ Jim's Adjusted Impact:                                                      │
│   ├── Flat Adjustment: +$65,000 per additional card                         │
│   ├── Percentage: +22.81%                                                   │
│   └── (Accounts for increased living area)                                  │
├─────���──────────────────────────���────────────────────────────────────────────┤
│ [Expand/Collapse] Show Individual Properties ▼                              │
└───────────────────────────��───────────────────────���─────────────────��───────┘
```

**Expandable VCS Sections:**
- Click to expand/collapse
- Show all properties with additional cards in VCS
- Performance optimization (don't render all at once)
- Yellow highlighting in debug mode

**3. Individual Property List:**

**Purpose:**
- Shows ALL properties with additional cards
- Sortable columns for analysis
- Export functionality
- Detailed property-level data

**Property List Columns:**
- VCS Code
- Block/Lot/Qualifier/Card
- Sale Date
- Sale Price
- Time-Normalized Price
- Year Built
- Total SFLA (all cards combined)
- Number of Cards
- Card Details (expandable)

**Sortable Columns:**
```
┌──────────────────────────────────────────────────��──────────���────────────��───┐
│ VCS ▲│ Block │ Lot │ Cards │ Sale Price  │ Norm Price  │ SFLA  │ Year Built │
├─────────────��───────────────────────────────────────────────���────────────────┤
│ A1   ���  123  │  45 │  2    │  $385,000   │  $390,000   │ 2,450 │    1988    │
│ A1   │  124  │  12 │  3    │  $425,000   │  $435,000   │ 2,850 │    1992    │
│ B2   │  234  │  67 │  2    │  $310,000   │  $315,000   │ 2,100 │    1985    │
└──────────────────────────────────────────────────────────────────────────────┘
Click column headers to sort ▲▼
```

**Export to CSV:**
```
[📥 Export Additional Cards to CSV]

Exports all properties with:
- Complete property identification
- All card details
- Sales data
- Calculated adjustments
- VCS groupings
```

**Jim's Formula Implementation (Used Across All Tabs)**

**The Core Formula:**
```javascript
// Jim's 50% Size Adjustment Method
jimAdjusted = withAvg + ((withoutSFLA - withSFLA) × (withAvg / withSFLA) × 0.5)
flatAdj = jimAdjusted - withoutAvg
pctAdj = (flatAdj / withoutAvg) × 100
```

**Variables:**
- `withAvg` - Average normalized value WITH the attribute
- `withSFLA` - Average SFLA WITH the attribute
- `withoutAvg` - Average normalized value WITHOUT the attribute
- `withoutSFLA` - Average SFLA WITHOUT the attribute

**Why This Formula:**
- Accounts for size differences between groups
- 50% factor represents typical market adjustment for size
- Prevents overstating impact when attribute correlates with larger homes
- Widely accepted methodology in appraisal industry

**Step-by-Step Example:**
```
Analyzing Pool Impact:

Step 1: Calculate Averages
├── WITH Pool: $345,000 avg, 2,100 SF avg
└── WITHOUT Pool: $285,000 avg, 1,850 SF avg

Step 2: Apply Jim's Formula
jimAdjusted = $345,000 + ((1,850 - 2,100) × ($345,000 / 2,100) × 0.5)
jimAdjusted = $345,000 + (-250 × $164.29 × 0.5)
jimAdjusted = $345,000 - $20,536
jimAdjusted = $324,464

Step 3: Calculate Adjustments
flatAdj = $324,464 - $285,000 = $39,464
pctAdj = ($39,464 / $285,000) × 100 = 13.85%

Result: Pool adds ~$39,500 or 13.85% to value (size-adjusted)
```

**Data Persistence:**

**Saves to market_land_valuation Table:**
```javascript
{
  // Condition Analysis Results
  condition_rollup: {
    baseline: 'GOOD',
    results: {
      'EXCELLENT': { count: 89, avgSFLA: 1920, avgValue: 325000, flatAdj: 34075, pctAdj: 11.95 },
      'GOOD': { count: 234, avgSFLA: 1850, avgValue: 285000, flatAdj: 0, pctAdj: 0 },
      'AVERAGE': { count: 156, avgSFLA: 1830, avgValue: 255000, flatAdj: -30000, pctAdj: -10.53 }
      // ... more conditions
    }
  },

  // Custom Attribute Results
  custom_attribute_rollup: {
    field: 'POOL',
    matchValue: 'Y',
    withCount: 89,
    withoutCount: 1145,
    flatAdj: 35250,
    pctAdj: 12.37
  },

  // Additional Card Analysis
  additional_cards_rollup: {
    packagePairsFound: 12,
    avgPackageDiscount: -25.4,
    vcsSummary: {
      'A1': { withCards: 23, withoutCards: 211, flatAdj: 65000, pctAdj: 22.81 },
      'B2': { withCards: 15, withoutCards: 189, flatAdj: 52000, pctAdj: 18.92 }
      // ... more VCS codes
    }
  }
}
```

**Auto-Save Behavior:**
- Results saved after each analysis run
- JSONB format for flexible structure
- Timestamp tracking for audit trail
- No manual save required

**Property Type Filter (Applies to All Tabs)**

**Filter Dropdown:**
```
Type/Use Filter: [All Residential ▼]
  ├── All Properties
  ├── 1 — Single Family
  ├── 2 — Duplex/Semi-Detached
  ├── 3* — Row/Townhouse
  ├── 4* — MultiFamily
  ├── 5* — Conversions
  ├── 6 — Condominium
  └── All Residential (1-6)
```

**Filter Logic:**
```javascript
// Filters by first digit of asset_type_use
const filterByType = (properties, selectedType) => {
  if (selectedType === 'all') return properties;
  if (selectedType === 'residential') {
    return properties.filter(p => {
      const type = p.asset_type_use?.toString()[0];
      return ['1','2','3','4','5','6'].includes(type);
    });
  }
  return properties.filter(p =>
    p.asset_type_use?.toString().startsWith(selectedType)
  );
};
```

**Why Filter by Type:**
- Ensures apples-to-apples comparisons
- Different property types have different value drivers
- Condition impacts vary by property class
- Prevents skewed results from mixing types

**Filter Persistence:**
- Saves to local storage
- Persists across tab switches
- Resets on job change
- Applied to all three sub-tabs consistently

**Export Capabilities:**

**1. Condition Analysis Export:**
```
[📥 Export Condition Rollup]

CSV includes:
- Condition code
- Property count
- Average SFLA
- Average year built
- Average normalized value
- Flat adjustment
- Percentage adjustment
- Baseline indicator
```

**2. Custom Attribute Export:**
```
[📥 Export Attribute Analysis]

CSV includes:
- Field name and match value
- WITH group statistics
- WITHOUT group statistics
- Jim's adjusted calculations
- Sample properties from each group
```

**3. Additional Cards Export:**
```
[📥 Export Property List with Cards]

CSV includes:
- Complete property identification
- All card numbers
- Combined SFLA
- Sales data
- VCS grouping
- Calculated adjustments
```

**Export Format:**
- UTF-8 encoding
- Excel-compatible
- Timestamp in filename
- Ready for presentation/documentation

**Integration with PreValuationTab:**

**SFLA Aggregation Logic:**

The component is aware of additional cards when calculating normalization:

```javascript
// Aggregates SFLA from all cards for main property
const getTotalSFLA = (property) => {
  let totalSFLA = property.asset_living_area || 0;

  // Check for additional cards
  if (property.additional_cards && property.additional_cards.length > 0) {
    property.additional_cards.forEach(card => {
      totalSFLA += card.asset_living_area || 0;
    });
  }

  return totalSFLA;
};
```

**Impact on Size Normalization:**
- Prevents understating living area when multiple cards exist
- Ensures accurate price-per-SF calculations
- Used in PreValuationTab's size normalization
- Critical for multi-unit properties

**Cross-Tab Data Flow:**
```
AttributeCardsTab identifies properties with additional cards
    ↓
Flags properties with has_additional_cards: true
    ↓
PreValuationTab aggregates SFLA from all cards
    ↓
Size normalization uses correct total SFLA
    ↓
Accurate market analysis results
```

**Performance Considerations:**

**1. Sales Data Filtering:**
```javascript
// Filters properties with valid sales data only
const validSales = properties.filter(p => {
  return p.sale_price > 0 &&
         p.sale_date &&
         p.values_norm_time > 0 &&
         isValidSalesNU(p.sale_nu);
});
```

**Benefits:**
- Reduces dataset size
- Faster grouping operations
- More accurate analysis
- Excludes non-market transactions

**2. Efficient Grouping Using Map Structures:**
```javascript
// Use Map for O(1) lookups instead of array filtering
const groupByCondition = (properties) => {
  const groups = new Map();
  properties.forEach(p => {
    const condition = p.asset_ext_cond || 'UNKNOWN';
    if (!groups.has(condition)) groups.set(condition, []);
    groups.get(condition).push(p);
  });
  return groups;
};
```

**Performance Benefits:**
- O(1) lookup vs O(n) filtering
- Memory efficient
- Scalable to large datasets
- Faster re-grouping on filter changes

**3. Memoized Calculations:**
```javascript
// Expensive calculations cached with useMemo
const analysisResults = useMemo(() => {
  return calculateConditionImpacts(
    filteredProperties,
    baselineCondition,
    interiorInspectionsOnly
  );
}, [filteredProperties, baselineCondition, interiorInspectionsOnly]);
```

**4. Local Storage for Preferences:**
```javascript
// Persist user preferences
localStorage.setItem('attributeCards_typeFilter', selectedType);
localStorage.setItem('attributeCards_baselineCondition', baseline);
localStorage.setItem('attributeCards_interiorOnly', interiorToggle);
```

**Benefits:**
- User settings persist across sessions
- No database calls for UI state
- Faster component initialization
- Better user experience

**Visual Indicators:**

**Color Coding:**
- **Green text**: Positive adjustments (adds value)
  - Example: "EXCELLENT: +$34,075 (+11.95%)"
- **Red text**: Negative adjustments (reduces value)
  - Example: "POOR: -$110,000 (-38.60%)"
- **Gray text**: Neutral/no data
  - Example: "UNKNOWN: No data available"
- **Yellow highlighting**: Debug information (when debug mode enabled)
  - Example: "Expected 45 sales, found 42 (3 excluded for valid sales NU)"

**Expandable/Collapsible Sections:**
```
VCS: A1 - DOWNTOWN RESIDENTIAL [+]
  ↓ (click to expand)
VCS: A1 - DOWNTOWN RESIDENTIAL [-]
├── WITH Additional Cards: 23 properties
├── WITHOUT Additional Cards: 211 properties
├── Adjustment: +$65,000 (+22.81%)
└── [Show Individual Properties ▼]
    ├── Block 123, Lot 45 - 2 cards - $385,000
    ├── Block 124, Lot 12 - 3 cards - $425,000
    └── ... (more properties)
```

**Icons and Badges:**
- ⭐ Baseline indicator
- 🏠 Single card (main dwelling only)
- 🏘️ Multiple cards (additional units)
- ⚠️ Warning for data quality issues
- ✓ Checkmark for interior inspection completed
- 📊 Chart icon for expandable statistics

**Package Sale Detection Logic:**

**Sophisticated Detection System:**

**Step 1: Group by Deed Reference:**
```javascript
// Create composite key from deed book + page + date
const packageKey = (property) => {
  const deedBook = property.deed_book || 'UNKNOWN';
  const deedPage = property.deed_page || 'UNKNOWN';
  const saleDate = property.sale_date || 'UNKNOWN';
  return `${deedBook}-${deedPage}-${saleDate}`;
};

// Group properties
const grouped = properties.reduce((acc, prop) => {
  const key = packageKey(prop);
  if (!acc[key]) acc[key] = [];
  acc[key].push(prop);
  return acc;
}, {});
```

**Step 2: Distinguish True Packages from Additional Cards:**
```javascript
// True package: Multiple separate properties (different blocks/lots)
// Additional cards: Same property with multiple cards

const isTruePackage = (group) => {
  // Check if properties have different blocks OR lots
  const uniqueBlockLots = new Set(
    group.map(p => `${p.block}-${p.lot}`)
  );
  return uniqueBlockLots.size > 1;
};

const packagePairs = Object.values(grouped)
  .filter(group => group.length > 1 && isTruePackage(group));
```

**Step 3: Calculate Package Premium/Discount:**
```javascript
// Compare to single-property baseline in same VCS
const packageAnalysis = packagePairs.map(pkg => {
  const totalPackagePrice = pkg.reduce((sum, p) => sum + p.sale_price, 0);
  const avgSinglePrice = getAvgSinglePriceInVCS(pkg[0].vcs);
  const expectedTotal = avgSinglePrice * pkg.length;
  const discount = totalPackagePrice - expectedTotal;
  const discountPct = (discount / expectedTotal) * 100;

  return {
    properties: pkg,
    totalPrice: totalPackagePrice,
    expectedPrice: expectedTotal,
    discount: discount,
    discountPct: discountPct
  };
});
```

**Package vs Additional Cards Comparison:**
```
TRUE PACKAGE:
Deed Book 1234, Page 567
├── Block 45, Lot 12 (separate property #1)
└── Block 45, Lot 13 (separate property #2)
Total: $425,000 (bulk discount applied)

ADDITIONAL CARDS (NOT a package):
Deed Book 1234, Page 789
├── Block 56, Lot 78, Card 1 (main dwelling)
└── Block 56, Lot 78, Card 2 (same property, mother-in-law suite)
Total: One property with two structures
```

**Debug Features:**

**Enable Debug Mode:**
```javascript
// In browser console
window.DEBUG_ATTRIBUTE_CARDS = true
```

**Debug Information Displayed:**

**1. Expected vs Actual Sales Counts:**
```
┌───────────────────���────────────���────────────┐
│ 🐛 DEBUG INFO                               │
├─────────────────────────────────────────────┤
│ Total Properties: 1,500                     │
│ Expected Sales: 450 (30% sales ratio)       │
│ Actual Valid Sales: 423                     ���
│ Excluded: 27 (invalid sales NU)             │
│                                             │
│ Breakdown:                                  │
│ ├── Valid NU codes: 423                     │
│ ├── Invalid NU codes: 18                    │
│ ├── Missing sale price: 6                   │
│ └── Missing sale date: 3                    ��
└─────────────────────────────────────────────┘
```

**2. Package Pairs Found Counter:**
```
Package Detection Debug:
├── Total deed groups: 1,234
├── Groups with 2+ properties: 45
├── True package pairs (different blocks): 12
├── Additional card groups (same block/lot): 33
└── Average package size: 2.3 properties
```

**3. Sample Property Data Logging:**
```javascript
// Logs sample properties from each group
console.log('Sample WITH attribute:', sampleWith);
console.log('Sample WITHOUT attribute:', sampleWithout);
console.log('Calculation breakdown:', {
  withAvg, withSFLA, withoutAvg, withoutSFLA,
  jimAdjusted, flatAdj, pctAdj
});
```

**4. Helps Troubleshoot Data Issues:**
- Identifies properties with missing fields
- Shows which properties excluded and why
- Validates grouping logic
- Confirms calculation accuracy

**Debug Output Example:**
```
[AttributeCards] Condition Analysis Started
[AttributeCards] Filtered to 423 properties with valid sales
[AttributeCards] Grouped by condition:
  - EXCELLENT: 89 properties
  - GOOD: 234 properties (BASELINE)
  - AVERAGE: 156 properties
  - FAIR: 45 properties
  - POOR: 12 properties
[AttributeCards] Jim's Formula applied:
  - EXCELLENT: +$34,075 (+11.95%)
  - AVERAGE: -$30,000 (-10.53%)
  - FAIR: -$70,000 (-24.56%)
  - POOR: -$110,000 (-38.60%)
[AttributeCards] Analysis complete, results saved
```

**Empty State Handling:**

**Each Tab Handles No-Data Scenarios:**

**1. Before Analysis Run:**
```
┌─────────────────────────────────────────────┐
│   📊 Condition Analysis                     │
│                                             │
│   No analysis has been run yet.             │
│                                             │
│   [▶ Run Condition Analysis]                │
│                                             │
│   This will analyze property condition      │
│   impacts on value using Jim's formula.     │
└─────────────────────────────────────────────┘
```

**2. No Matching Data Found:**
```
┌──────────��─────────────────��────────────────┐
│   🔍 Custom Attribute Analysis              │
│                                             │
│   Field: POOL                               │
│   Match Value: Y                            │
│                                             │
│   ⚠️ No properties found with POOL = "Y"   │
│                                             │
│   Suggestions:                              │
│   • Check spelling of match value           │
│   • Try different field                     ���
│   • Verify field exists in raw data         │
│   • Check property type filter              │
└────────────��────────────────────────────────��
```

**3. Insufficient Data for Analysis:**
```
┌─────────────────────────────────────────────┐
│   📈 Additional Card Analysis               │
│                                             │
│   Only 2 properties found with additional   │
│   cards. Minimum 10 required for            │
│   statistically valid analysis.             │
│                                             │
│   Current filters:                          │
│   • Type: Single Family                     │
│   • VCS: All                                │
│                                             │
│   Try:                                      │
│   • Expand to "All Residential"             │
│   • Remove VCS filter                       │
│   • Check if data has additional cards      │
└─────────────────────────────────────────────┘
```

**4. Clear Instructions:**
- Step-by-step guidance for first-time users
- Explanations of what each analysis does
- Examples of typical use cases
- Troubleshooting tips for common issues

**Empty State Benefits:**
- Prevents user confusion
- Guides users to successful analysis
- Provides helpful error messages
- Reduces support requests

**Critical Implementation Notes:**
- Jim's formula essential for size-adjusted comparisons
- Package detection prevents false multi-unit classifications
- VCS rollup provides neighborhood-specific insights
- Integration with PreValuationTab ensures accurate SFLA totals
- Debug mode critical for troubleshooting complex analyses
- Empty state handling improves user experience
- Export capabilities essential for documentation and presentations
- Performance optimizations necessary for large datasets
- Visual indicators (color coding) aid quick interpretation
- Filter persistence improves workflow efficiency

---

## FinalValuation.jsx - Depreciation Optimization & Value Reconciliation System 🎯

**Scale**: 170 lines parent orchestrator + 9,697 lines across 7 tab components

**Core Philosophy**: Complete final valuation system integrating Market Data Approach, Comparative Market Evaluation (CME), and Tax Rate Impact Analysis

**Architecture Pattern:**
```
JobContainer loads data once → FinalValuation receives props → Distributes to 5 tabs
```

**Props Received from JobContainer:**
- `properties` - Complete property array (pre-loaded, filtered if assigned)
- `jobData` - Job metadata including vendor_type, parsed_code_definitions, end_date
- `marketLandData` - market_land_valuation record from Market Analysis
- `hpiData` - County HPI data for normalization
- `onUpdateJobCache` - Callback for refreshing parent data

**Tab Structure:**
1. **Sales Review** - Sales history review & usability decisions (1,879 lines)
2. **Market Data** - Depreciation optimization & effective age calculation (1,551 lines)
3. **Ratable Comparison** - Tax rate impact & projected ratable base (1,112 lines)
4. **Sales Comparison (CME)** - Comparable Market Evaluation search (2,812 lines) + Adjustments (1,325 lines)
5. **Analytics** - Final value recommendations & quality metrics (441 lines)

**Database Tables:**
- `final_valuation_data` - Property-level calculations and CME results
- `job_tax_rates` - Current and projected tax rates
- `job_adjustment_grid` - CME adjustment grid configuration (10 price brackets)

**Data Flow:**
- Loads final_valuation_data on mount (one-time)
- Property joins with final_valuation_data by composite_key
- Tax rates loaded separately (job-level)
- All calculations auto-save to database
- Export functions use live data + formulas

**Tab Navigation:**
- Maintains active tab state
- No data reload on tab switch
- Preserves work between tabs
- Auto-save on data changes

### SalesReviewTab.jsx - Sales History Review & Decision Engine 📋

**Scale**: 1,879 lines of sales filtering, validation, and usability tracking

**Core Philosophy**: Systematically review all sales to determine which are usable for valuation analysis

**Key Features:**
- **Sales Filtering**: By price range, date range, sales code, property class, VCS
- **Usability Decisions**: Track sales as usable, unusable, or pending review
- **Bulk Operations**: Select multiple properties for batch decisions
- **Comment System**: Add notes explaining usability decisions
- **Export to Excel**: Professional report with formulas and styling
- **Progress Tracking**: Shows % of sales reviewed

**Sales Decision Types:**
1. **Usable** - Valid market sale, can be used for analysis
2. **Unusable** - Non-arm's length, REO, family transfer, etc.
3. **Pending Review** - Default state, needs manager review

**Filtering Options:**
- **Price Range**: Min/max sale price sliders
- **Date Range**: Sales date start/end
- **Sales Code**: NU field values (00, 07, 32, etc.)
- **Property Class**: 1, 2, 3A, 3B, 4A/B/C, 6A/B
- **VCS**: Neighborhood filtering
- **Property Type**: Type use codes
- **Reviewed Status**: Show all, reviewed only, pending only

**Sales Review Table:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Block | Lot | Qual | Location        | Sale Price | Sale Date  | NU | Status │
├──────────────────────────────────────────────────────────────────────────────┤
│  123  | 45  |      | 123 MAIN ST     │ $325,000  │ 03/15/2024 │ 00 │ Usable │
│  124  | 12  |      | 456 OAK AVE     │ $285,000  │ 02/10/2024 │ 07 │ Pending│
│  125  | 8   | C0001│ 789 ELM STREET  │ $15,000   │ 01/05/2024 │ 32 │ Unusable│
└──────────────────────────────────────────────────────────────────────────────┘
```

**Bulk Operations:**
- Select multiple rows with checkboxes
- Mark Selected as Usable button
- Mark Selected as Unusable button
- Clear Selection button
- Shows "X properties selected"

**Comment Modal:**
- Click property to open comment dialog
- Freeform text area for notes
- Auto-saves to final_valuation_data.sale_comment field
- Displays existing comments in table

**Excel Export Features:**
- All sales with filters applied
- Includes: Block, Lot, Qualifier, Location, Class, Sales Price, Date, NU Code
- Usability decision column
- Comments column
- Professional formatting (Leelawadee font, centered alignment)
- Formula-based counts and summaries
- File name: `Sales_Review_[JobName]_[Date].xlsx`

**Database Integration:**
- Saves to final_valuation_data table
- Uses property_composite_key for joins
- Updates sale_comment field
- Tracks final_method_used field

**Progress Metrics:**
```
┌─────────────────────────────────────┐
│ Sales Review Progress               │
├─────────────────────────────────────┤
│ Total Sales: 1,234                  │
│ Reviewed: 856 (69%)                 │
│ Usable: 542 (44%)                   │
│ Unusable: 314 (25%)                 │
│ Pending: 378 (31%)                  │
└─────────────────────────────────────┘
```

### MarketDataTab.jsx - Depreciation Optimization & Effective Age Calculator 🏗️

**Scale**: 1,551 lines of depreciation analysis, effective age calculation, and value projection

**Core Philosophy**: Use market data to determine optimal depreciation factors and project new assessments

**Two Main Approaches:**
1. **Market Data Approach** - Calculate new values using depreciation factors
2. **Tax Rate Calculator** - Project tax impact of ratable base changes

**Market Data Approach Workflow:**

**Step 1: Effective Age Metrics**

Displays for ENTIRE dataset (not preview):
- Current Year column (year before due year)
- Effective Age column (calculated from vendor data)
- Calculation source indicator (BRT vs Microsystems logic)

**BRT Formula:**
```javascript
effectiveAge = currentYear - asset_effective_age_year
// asset_effective_age_year comes from EFFAGE field
```

**Microsystems Formula:**
```javascript
effectiveAge = asset_effective_age (already a number in dataset)
```

**Step 2: Depreciation Factor Calculation**

**Formula:**
```javascript
depreciationFactor = 1 - (effectiveAge / 100)
// Capped at 1.0 maximum (no appreciation via age)
```

**Examples:**
- Effective Age 35 → Factor 0.65 (35% depreciated)
- Effective Age 50 → Factor 0.50 (50% depreciated)
- Effective Age 100+ → Factor 0.00 (fully depreciated)

**Step 3: New Value Calculation**

**Formula:**
```javascript
newCalculatedValue = values_repl_cost × depreciationFactor
```

**Step 4: Projected Assessments**

**Calculations:**
```javascript
projectedImprovement = newCalculatedValue + values_det_items
projectedTotal = projectedImprovement + values_mod_land
newLandAllocationPercent = (values_mod_land / projectedTotal) × 100
```

**Editable Fields:**
- **Special Notes** (Column 17) - Freeform text per property
- **Actual EFA** (Column 58) - Override effective age if needed

**Preview Table (First 500 Properties):**
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Block │ Lot │ Location    │ Eff Age │ Depr │ New Value │ Proj Impr │ Proj Total│
├────────────────────────────────────────────────────────────────────────────────┤
│  123  │ 45  │ 123 MAIN ST │   35    │ 0.65 │ $195,000  │ $210,000  │ $285,000  │
│  124  │ 12  │ 456 OAK AVE │   42    │ 0.58 │ $174,000  │ $185,000  │ $265,000  │
│  125  │  8  │ 789 ELM ST  │   28    │ 0.72 │ $216,000  │ $228,000  │ $315,000  │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Expandable Breakdowns:**
- VCS (Neighborhood) - Collapse/expand by neighborhood
- Type Use - Collapse/expand by property type
- Design Style - Collapse/expand by design

**Preview Notice:**
```
⚠️ Displaying first 500 properties for performance
   Export includes ALL properties with calculations
```

**Excel Export - "Build Final Roster":**

**Grouping Logic:**
- Groups properties by Block-Lot-Qualifier-Location
- Detects main cards vs additional cards (vendor-specific)
- Main card gets full data row
- Additional cards show as sub-rows with aggregate SFLA

**Export Columns:**
1. Property identifiers (Block, Lot, Qualifier, Location)
2. Owner information
3. Current values (MOD Land, MOD Improvement, MOD Total)
4. Building details (Year Built, SFLA, Class)
5. Effective Age Metrics (Current Year, Recommended EFA, Actual EFA override)
6. Calculations (Depr Factor, New Value, Proj Improvement, Proj Total)
7. Land allocation %
8. Special Notes

**Formula-Based Export:**
- All calculations use Excel formulas (not hardcoded values)
- Depreciation factor: `=1-(EFA/100)`
- New value: `=ReplCost*DeprFactor`
- Professional formatting (Leelawadee, size 10, centered numbers)

**Tax Rate Calculator:**

**Purpose**: Calculate projected tax rates based on new ratable base

**Inputs (Job Level):**
- Budget (municipal budget amount)
- Current Tax Rate (prior year rate)
- Buffer for Loss % (e.g., 2% cushion)

**Current Year Data (Editable):**
- Class 1, 2, 3A, 3B, 4, 6 counts and totals
- Abatement counts for Class 1, 2, 4
- Total ratable base
- Commercial base percentage

**Projected Year Calculation:**
- Uses Projected Total from Market Data calculations
- Aggregates by property class
- Calculates new ratable base
- Projects new tax rate needed to meet budget

**Tax Rate Formula:**
```javascript
projectedRate = (budget × (1 + bufferPct)) / projectedRatableBase
```

**Comparison Display:**
```
┌─────────────────────────────────────────┐
│ Current Year (2025)                     │
│ Total Ratable Base: $1,234,567,890      │
│ Tax Rate: 2.450                         │
│                                         │
│ Projected Year (2026)                   │
│ Total Ratable Base: $1,345,678,901      │
│ Projected Tax Rate: 2.287               │
│                                         │
│ Impact: -0.163 (-6.7%)                  │
└─────────────────────────────────────────┘
```

**Database Integration:**
- Saves to final_valuation_data table (property-level)
- Saves to job_tax_rates table (job-level)
- Auto-saves on field changes
- Preserves user edits (actual_efa, special_notes)

### RatableComparisonTab.jsx - Tax Rate Impact & Ratable Base Analysis 💰

**Scale**: 1,112 lines of tax impact analysis and property class comparison

**Core Philosophy**: Understand tax implications of revaluation by comparing current vs projected ratable bases

**Two Sub-Tabs:**
1. **Comparison** - Side-by-side current vs projected ratable analysis
2. **Tax Rate Calculator** - Detailed tax rate projection tool

**Comparison Sub-Tab:**

**Purpose:**
- Compare current year (filed with county) vs projected year (new revaluation)
- Calculate changes by property class
- Identify tax rate impact
- Export comprehensive comparison report

**Vendor-Specific Consolidation:**

Properties are consolidated (main cards only) to match county reporting:
- **BRT**: Main card = Card 1 or null
- **Microsystems**: Main card = Card M or null
- Additional cards rolled into main property totals

**Property Class Categories:**
- Class 1 (Residential Vacant Land)
- Class 2 (Residential 4+ Families)
- Class 3A (Farm Regular)
- Class 3B (Farm Qualified)
- Class 4A/B/C (Commercial/Industrial)
- Class 6A/B (Dedicated Cemetery/Historic/Charitable)

**Current Year Data (Editable):**

Loaded from jobs table fields:
- `current_class_1_count`, `current_class_1_total`, `current_class_1_abatements`
- `current_class_2_count`, `current_class_2_total`, `current_class_2_abatements`
- `current_class_3a_count`, `current_class_3a_total`
- `current_class_3b_count`, `current_class_3b_total`
- `current_class_4_count`, `current_class_4_total`, `current_class_4_abatements`
- `current_class_6_count`, `current_class_6_total`

**Projected Year Data (Calculated):**

Aggregates from properties using either:
1. `projected_total` from final_valuation_data (if exists)
2. `values_mod_total` from property_records (fallback)

**Class 6 Override Feature:**

Special handling for Class 6 properties (exempt/charitable):
- Input field per property for manual override
- Uses override value if set, otherwise uses projected_total
- Saves to final_valuation_data.projected_6_override

**Comparison Table:**
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Class │ Current Count │ Current Total  │ Projected Count │ Projected Total │ Delta│
├───────────────────────────────────────────────────────────────────────────────────┤
│   1   │     1,234     │ $123,456,789   │      1,245      │  $135,678,901  │ +9.9%│
│   2   │       89      │  $45,678,901   │        92       │   $48,901,234  │ +7.1%│
│  3A   │       45      │  $12,345,678   │        43       │   $13,456,789  │ +9.0%│
│  3B   │       12      │   $5,678,901   │        12       │    $6,123,456  │ +7.8%│
│ 4A/B/C│      234      │ $234,567,890   │       245       │  $256,789,012  │ +9.5%│
│ 6A/B  │       23      │  $12,345,678   │        24       │   $13,456,789  │ +9.0%│
├───────────────────────────────────────────────────────────────────────────────────┤
│ TOTAL │     1,637     │ $434,073,837   │      1,661      │  $474,405,181  │ +9.3%│
└───────────────────────────────────────────────────────────────────────────────────┘

Commercial Base %: Current 54.1% → Projected 54.2% (▲0.1%)
```

**Visual Indicators:**
- Green text for increases (▲)
- Red text for decreases (▼)
- Percentage changes calculated
- Total row highlighted

**Save Functionality:**
- Saves edited current year data to jobs table
- Updates multiple fields in single transaction
- Shows "Saving..." and "Saved!" status
- Unsaved changes indicator

**Excel Export:**

Professional comparison report with:
- Side-by-side current vs projected
- Delta columns (absolute and %)
- Formula-based totals
- Leelawadee font, size 10
- Centered alignment for numbers
- File name: `Ratable_Comparison_[JobName]_[Date].xlsx`

**Tax Rate Calculator Sub-Tab:**

**Purpose:**
- Calculate exact projected tax rate
- Account for budget, abatements, exemptions
- Provide "what-if" scenarios

**Inputs (Saved to jobs table):**
- `rate_calc_budget` - Municipal budget
- `rate_calc_current_rate` - Current tax rate
- `rate_calc_buffer_for_loss` - % cushion (e.g., 2%)

**Calculation:**
```javascript
// Net ratable base = Total - Abatements
netRatableBase = totalRatable - (class1Abate + class2Abate + class4Abate);

// Projected rate with buffer
projectedRate = (budget × (1 + bufferPct)) / netRatableBase;

// Tax impact per property class
class1Tax = class1Total × projectedRate / 100;
class2Tax = class2Total × projectedRate / 100;
// ... etc for each class
```

**Rate Comparison Display:**
```
┌──────────────────────────────────────────┐
│ Tax Rate Analysis                        │
├──────────────────────────────────────────┤
│ Budget: $12,500,000                      │
│ Buffer for Loss: 2.0%                    │
│                                          │
│ Current Year (2025)                      │
│ Net Ratable Base: $434,073,837           │
│ Current Tax Rate: 2.875                  │
│                                          │
│ Projected Year (2026)                    │
│ Net Ratable Base: $474,405,181           │
│ Projected Tax Rate: 2.684                │
│                                          │
│ Impact: -0.191 (-6.6%)                   │
│ Average Taxpayer Savings: $191 per year │
└──────────────────────────────────────────┘
```

**Class-by-Class Impact:**
```
Class 1: $123.4M @ 2.684% = $3,311,656 total tax
Class 2:  $48.9M @ 2.684% = $1,312,209 total tax
Class 4: $256.8M @ 2.684% = $6,892,196 total tax
```

**Database Integration:**
- Loads current year data from jobs table
- Loads projected values from final_valuation_data
- Saves calculator inputs to jobs table
- Auto-recalculates on data changes

**Critical Implementation Notes:**
- Consolidation logic MUST match county reporting
- Main card detection is vendor-specific
- Projected values prefer final_valuation_data over property_records
- Class 6 overrides allow manual adjustments
- Buffer for loss adds cushion to rate calculation
- All formulas use 2 decimal precision for rates

### SalesComparisonTab.jsx - Comparative Market Evaluation (CME) Engine 🔍

**Scale**: 2,812 lines - THE LARGEST Final Valuation component!

**Core Philosophy**: Automated comparable search with sophisticated filtering and adjustment grid integration

**Key Features:**
- **Subject Property Selection** - Multi-select by VCS, Type Use, or manual entry
- **Comparable Filtering** - 15+ filter criteria with smart defaults
- **Adjustment Grid Integration** - 10 price brackets with attribute adjustments
- **Automated Evaluation** - Process hundreds/thousands of properties
- **Manual Appraisal Mode** - Detailed grid for custom comparable selection
- **Excel Export** - Comprehensive CME analysis report

**Three Nested Sub-Tabs:**
1. **Search** - Subject selection and comparable filtering
2. **Evaluate** - Run automated CME analysis
3. **Detailed** - Manual comparable appraisal grid

**Search Sub-Tab:**

**Subject Property Selection (3 Methods):**

**1. By VCS (Neighborhood):**
- Multi-select VCS codes from dropdown
- Shows property count per VCS
- Example: "A1 - DOWNTOWN (234 properties)"

**2. By Type Use:**
- Multi-select property types
- Filters: Single Family, Duplex, Condo, etc.
- Shows count per type

**3. Manual Entry:**
- Enter Block-Lot-Qualifier directly
- Validates property exists
- Allows pinpoint selection

**Comparable Filters (15 Criteria):**

**1. Sales Price Range:**
- CSP (Common Sales Price) checkbox - uses NU codes 00, 07, 32, 36
- Manual price range: Min/Max sliders

**2. Sales Date Range:**
- Default: 10/1 prior-prior year → 12/31 prior year
- Customizable start/end dates
- Based on job end_date (assessment year)

**3. VCS Filter:**
- Same VCS as subject (default ON)
- Or select specific VCS codes
- Neighborhood matching logic

**4. Type Use Filter:**
- Same Type Use as subject (default ON)
- Or select specific types
- Ensures comparable property types

**5. Design Style Filter:**
- Same Style as subject (default ON)
- Or select specific designs
- Colonial, Ranch, Cape, etc.

**6. Year Built Range:**
- "Built within X years" mode (default: 25 years)
- Or specific year range (min/max)
- Adjustable tolerance

**7. SFLA (Living Area) Range:**
- "Within X sqft" mode (default: 500 SF)
- Or specific size range (min/max)
- Size matching logic

**8. Zoning Filter:**
- Same Zone checkbox
- Or select specific zones
- R-1, R-2, C-1, etc.

**9. Building Class Filter:**
- Same Class checkbox
- Or select specific classes
- Quality grade matching

**10. Story Height Filter:**
- Same Stories checkbox
- Or select specific heights
- 1, 1.5, 2, 2.5, 3 story options

**11. View Filter:**
- Same View checkbox
- Lake, Ocean, Mountain, etc.

**12. Adjustment Threshold Filters:**
- Individual Adjustment % (max acceptable adjustment per attribute)
- Net Adjustment % (max total after offsetting)
- Gross Adjustment % (max absolute total)

**13. Minimum Comps Required:**
- User-selectable threshold (default: 3)
- Properties with fewer comps marked as failures
- Quality control setting

**Filter UI:**
```
┌───────────────────────────────────────────────────────────────────────────┐
│ Comparable Search Filters                                                 │
├───────────────────────────────────────────────────────────────────────────┤
│ ☑ CSP Only (NU: 00, 07, 32, 36)                                          │
│ Sales Date: [10/01/2024] to [12/31/2025]                                 │
│                                                                            │
│ ☑ Same VCS as subject    ☑ Same Type Use    ☑ Same Style                │
│                                                                            │
│ Built Within: [25___] years   OR   Year Range: [____] to [____]          │
│ Size Within:  [500__] SF      OR   SFLA Range: [____] to [____]          │
│                                                                            │
│ Adjustment Limits:                                                         │
│   Individual Adjustment: [15___]%                                          │
│   Net Adjustment:        [25___]%                                          │
│   Gross Adjustment:      [35___]%                                          │
│                                                                            │
│ Minimum Comps Required: [3___]                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Evaluate Sub-Tab:**

**Automated CME Workflow:**

**Step 1: Evaluation Mode Selection:**
- **Fresh Evaluation** - Overwrites existing CME data
- **Keep Existing** - Only evaluates properties without CME data

**Step 2: Process Properties:**
```javascript
for each subject property:
  1. Find comparables matching all filter criteria
  2. Apply adjustment grid for subject's price bracket
  3. Calculate adjusted sale prices
  4. Select best 5 comparables
  5. Calculate min, max, average ranges
  6. Save to final_valuation_data (cme_* fields)
```

**Step 3: Progress Display:**
```
Processing CME Analysis...
Progress: 456 / 1,234 properties (37%)
Successes: 389 (85%)
Failures: 67 (15%)
Current: Block 123, Lot 45
```

**Adjustment Grid Application:**

**10 Price Brackets:**
- $0-$99,999 (Bracket 0)
- $100K-$199K (Bracket 1)
- $200K-$299K (Bracket 2)
- $300K-$399K (Bracket 3)
- $400K-$499K (Bracket 4)
- $500K-$749K (Bracket 5)
- $750K-$999K (Bracket 6)
- $1M-$1.5M (Bracket 7)
- $1.5M-$2M (Bracket 8)
- Over $2M (Bracket 9)

**Auto-Adjustment:**
- Determines subject's price bracket from sales price
- Applies corresponding adjustment values
- Adjustments configured in AdjustmentsTab

**Example Adjustment:**
```
Subject: $325,000 (Bracket 3: $300K-$399K)
Comparable: $285,000

Adjustments from Grid (Bracket 3):
  Living Area: Subject 1,920 SF vs Comp 1,850 SF → +$40/SF × 70 = +$2,800
  Garage: Subject 2-car vs Comp 1-car → +$8,500
  Pool: Subject has pool, Comp doesn't → +$12,000
  Condition: Subject Good vs Comp Average → +$15,000

Total Adjustment: +$38,300
Adjusted Sale Price: $285,000 + $38,300 = $323,300
```

**Comparable Selection Logic:**
```javascript
// 1. Apply all adjustments
adjustedPrice = salePrice + totalAdjustments;

// 2. Check adjustment thresholds
if (individualAdj > threshold) reject;
if (netAdj > threshold) reject;
if (grossAdj > threshold) reject;

// 3. Sort by proximity to subject value
sortedComps = comps.sort((a, b) =>
  Math.abs(a.adjustedPrice - subjectPrice) -
  Math.abs(b.adjustedPrice - subjectPrice)
);

// 4. Select best 5
bestComps = sortedComps.slice(0, 5);
```

**CME Result Calculation:**
```javascript
cme_projected_assessment = average(bestComps.map(c => c.adjustedPrice));
cme_min_range = Math.min(...bestComps.map(c => c.adjustedPrice));
cme_max_range = Math.max(...bestComps.map(c => c.adjustedPrice));
```

**Evaluation Results:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CME Evaluation Results                                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Total Properties: 1,234                                                       │
│ Successfully Evaluated: 1,156 (93.7%)                                         │
│ Failed (< 3 comps): 78 (6.3%)                                                │
│                                                                                │
│ Average CME Projected: $312,456                                               │
│ Average Range: $285,000 - $342,000                                            │
│ Confidence: High (avg 4.8 comps per property)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Detailed Sub-Tab (Manual Appraisal):**

**Purpose:**
- Manual comparable selection for specific properties
- Override automated CME results
- Detailed appraisal grid interface

**Workflow:**
1. Enter subject Block-Lot-Qualifier
2. Manually enter up to 5 comparable Block-Lot-Qualifiers
3. System loads property details for all
4. Applies adjustment grid automatically
5. Displays detailed appraisal grid
6. Option to save as CME result

**Detailed Appraisal Grid:**

Integrated component (DetailedAppraisalGrid.jsx - 577 lines):
- Subject property details
- Comparable property details (5 columns)
- Row-by-row attribute comparison
- Automatic adjustment calculations
- Final adjusted values
- Min/max/average ranges

**Grid Rows:**
- Address
- Sale Price / Sale Date
- Living Area (SFLA)
- Year Built
- Lot Size
- Style
- Condition
- Garage
- Basement
- Fireplace
- Pool
- Central Air
- [Custom attributes from grid]
- Total Adjustments
- Adjusted Sale Price

**Database Integration:**
- Saves to final_valuation_data table
- Fields: cme_projected_assessment, cme_min_range, cme_max_range
- Comparable references: cme_comp1, cme_comp2, cme_comp3, cme_comp4, cme_comp5
- Preserves manual overrides

**Excel Export:**

Comprehensive CME report with:
- Subject property list
- Comparable details for each
- Adjustment breakdown
- Adjusted sale prices
- CME projected range
- Formula-based calculations
- Professional formatting

**Integration with AdjustmentsTab:**

Adjustments grid configured in separate tab:
- 10 price brackets
- Default adjustments (Living Area, Garage, Pool, etc.)
- Custom adjustments (user-defined)
- Per-bracket customization
- Saved to job_adjustment_grid table

**Critical Implementation Notes:**
- Filter presets optimized for CSP methodology
- Auto-adjustment uses subject's sales price bracket
- Manual mode allows override of automated results
- Export includes all comparables and adjustments
- Performance optimized for 1,000+ subject properties
- Progress tracking essential for large evaluations

---

### 🚧 **CME_NEEDS_WORK_JAN2025** - Sales Comparison Issues to Address

**SEARCHPHRASE for quick find: CME_NEEDS_WORK_JAN2025**

**Priority Items for Next Session:**

**1. ATTRIBUTE DATA VERIFICATION (CRITICAL):**
- **Issue**: Attributes showing up in adjustment grid (decks, patios, pools, garages, etc.) need verification at individual Block-Lot level
- **Action Required**:
  - Check specific Block-Lot combinations in database vs what's displayed in CME grid
  - Verify data is coming from correct source (property_records vs raw fields)
  - Ensure Microsystems attribute mapping is correct (garage_area, pool_area, deck_area, etc.)
  - Cross-reference with property detail views to confirm accuracy
- **Files**: SalesComparisonTab.jsx, DetailedAppraisalGrid.jsx
- **Database**: property_records table - attribute fields

**2. PROGRESS BAR REALISM (UX):**
- **Issue**: Evaluation progress bar jumps to 99% instantly, not realistic
- **Current Behavior**: Bar hits 99% in ~1 second regardless of property count
- **Desired Behavior**: Progressive real-time updates as evaluation proceeds:
  - Find comparables (Phase 1)
  - Calculate adjustments (Phase 2)
  - Rank and select best comps (Phase 3)
  - Save results (Phase 4)
- **Action Required**: Implement true progress tracking with status updates per property
- **Files**: SalesComparisonTab.jsx - Evaluate sub-tab
- **Implementation**: Use state updates in evaluation loop, possibly with batching for performance

**3. ADJUSTMENT CALCULATION VERIFICATION (POST-DATA FIX):**
- **Issue**: Once attribute data is verified correct, need to validate adjustment calculations
- **Action Required**:
  - Manual spot-check of adjustment math
  - Verify bracket-based adjustment values applying correctly
  - Confirm total adjustments, net adjustments, gross adjustments formulas
  - Test edge cases (missing attributes, zero values, etc.)
- **Dependencies**: Complete Item #1 first
- **Files**: DetailedAppraisalGrid.jsx, SalesComparisonTab.jsx

**Status**: Ready for investigation - Microsystems jobs showing issues, BRT appears functional

---

### AdjustmentsTab.jsx - CME Adjustment Grid Configuration ⚙️

**Scale**: 1,325 lines of adjustment grid management

**Core Philosophy**: Configure market-based adjustments across 10 price brackets for automated CME

**Purpose:**
- Define adjustment values for property attributes
- Differentiate by price bracket (market segmentation)
- Support both system defaults and custom adjustments
- Feed into Sales Comparison automated evaluation

**10 Price Brackets:**
```
Bracket 0: $0 - $99,999
Bracket 1: $100,000 - $199,999
Bracket 2: $200,000 - $299,999
Bracket 3: $300,000 - $399,999
Bracket 4: $400,000 - $499,999
Bracket 5: $500,000 - $749,999
Bracket 6: $750,000 - $999,999
Bracket 7: $1,000,000 - $1,499,999
Bracket 8: $1,500,000 - $1,999,999
Bracket 9: $2,000,000+
```

**Default Adjustment Attributes:**

1. **Living Area (SQFT)** - Per square foot adjustment
   - Type: per_sqft
   - Example: Bracket 0: $40/SF, Bracket 9: $150/SF

2. **Basement (Finished)** - Flat dollar amount
   - Type: flat
   - Example: Bracket 0: $5,000, Bracket 9: $35,000

3. **Garage** - Flat dollar amount per car
   - Type: flat
   - Example: Bracket 0: $8,000, Bracket 9: $25,000

4. **Pool (In-Ground)** - Flat dollar amount
   - Type: flat
   - Example: Bracket 0: $10,000, Bracket 9: $45,000

5. **Fireplace** - Flat dollar amount per fireplace
   - Type: flat
   - Example: Bracket 0: $3,000, Bracket 9: $12,000

6. **Condition (Good vs Average)** - Percentage adjustment
   - Type: percent
   - Example: Bracket 0: 10%, Bracket 9: 8%

7. **Central Air** - Flat dollar amount
   - Type: flat
   - Example: Bracket 0: $4,000, Bracket 9: $15,000

8. **Year Built (Per Year)** - Flat amount per year difference
   - Type: per_year
   - Example: Bracket 0: $500/year, Bracket 9: $1,500/year

**Adjustment Grid Interface:**
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Adjustment Grid Configuration                                                    │
├──────────────────────────────────────────────────────────────────────────────────┤
│                │ $0-$99K │ $100K-  │ $200K-  │ $300K-  │ $400K-  │ $500K-  │ ... │
│                │         │ $199K   │ $299K   │ $399K   │ $499K   │ $749K   │     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Living Area    │  $40/SF │  $50/SF │  $65/SF │  $75/SF │  $90/SF │ $110/SF │ ... │
│ (per sqft)     │         │         │         │         │         │         │     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Basement       │  $5,000 │  $8,000 │ $12,000 │ $15,000 │ $18,000 │ $22,000 │ ... │
│ (flat)         │         │         │         │         │         │         │     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Garage         │  $8,000 │ $10,000 │ $12,000 │ $14,000 │ $16,000 │ $18,000 │ ... │
│ (flat)         │         │         │         │         │         │         │     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Pool           │ $10,000 │ $15,000 │ $18,000 │ $22,000 │ $25,000 │ $30,000 │ ... │
│ (flat)         │         │         │         │         │         │         │     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Custom Adjustments:**

**Add Custom Adjustment Workflow:**
1. Click "Add Custom Adjustment"
2. Enter adjustment name (e.g., "Waterfront View")
3. Select type (flat, per_sqft, percent, per_year)
4. Select category (physical, amenity, quality, custom)
5. Enter values for all 10 brackets
6. Save to database

**Custom Adjustment Example:**
```
Name: Waterfront View
Type: Flat
Category: Amenity

Bracket 0: $25,000
Bracket 1: $35,000
Bracket 2: $45,000
Bracket 3: $60,000
Bracket 4: $75,000
Bracket 5: $100,000
Bracket 6: $125,000
Bracket 7: $150,000
Bracket 8: $175,000
Bracket 9: $200,000
```

**Adjustment Types:**

1. **Flat** - Fixed dollar amount
   - Applied directly to sale price
   - Example: Pool = $15,000

2. **Per SQFT** - Dollar amount per square foot
   - Multiplied by SQFT difference
   - Example: Living Area = $65/SF × (2,000 - 1,800) = $13,000

3. **Percent** - Percentage of sale price
   - Applied as % of comparable's sale price
   - Example: Condition = 10% × $285,000 = $28,500

4. **Per Year** - Dollar amount per year difference
   - Multiplied by year built difference
   - Example: Age = $500/year × (1995 - 1985) = $5,000

**Edit Functionality:**
- Click any cell to edit value
- Auto-saves on blur
- Validates numeric input
- Shows save status indicator

**Delete Custom Adjustments:**
- System defaults cannot be deleted
- Custom adjustments have delete button
- Confirmation dialog before deletion

**Database Integration:**
- Saves to job_adjustment_grid table
- Unique constraint: (job_id, adjustment_id)
- Default adjustments created on first load
- Custom adjustments persist per job

**Usage in Sales Comparison:**

When CME evaluates a property:
```javascript
// 1. Determine subject's price bracket
const subjectBracket = determineBracket(subject.salesPrice);

// 2. Load adjustment grid for that bracket
const adjustments = getAdjustmentsForBracket(subjectBracket);

// 3. Apply each adjustment to comparables
adjustments.forEach(adj => {
  if (adj.type === 'flat') {
    adjustment = adj.value;
  } else if (adj.type === 'per_sqft') {
    adjustment = adj.value × (subject.sfla - comp.sfla);
  } else if (adj.type === 'percent') {
    adjustment = comp.salePrice × (adj.value / 100);
  } else if (adj.type === 'per_year') {
    adjustment = adj.value × (subject.yearBuilt - comp.yearBuilt);
  }
});
```

**Excel Export:**

Export adjustment grid to spreadsheet:
- All 10 brackets as columns
- All adjustments as rows
- Professional formatting
- File name: `CME_Adjustment_Grid_[JobName].xlsx`

**Critical Implementation Notes:**
- Default adjustments cover 90% of use cases
- Custom adjustments allow job-specific factors
- Price bracket segmentation reflects market reality
- Per-sqft adjustments account for size differences
- Percent adjustments scale with property value
- Grid values derived from market analysis

### AnalyticsTab.jsx - Final Value Recommendations & Quality Metrics 📊

**Scale**: 441 lines of value analysis and quality scoring

**Core Philosophy**: Provide final valuation recommendations with confidence metrics

**Purpose:**
- Aggregate results from Market Data and CME approaches
- Calculate final recommended values
- Show confidence scores and data quality
- Identify properties needing manual review

**Value Approach Integration:**

**1. Market Data Approach:**
- Source: MarketDataTab calculations
- Field: final_valuation_data.new_calculated_value
- Based on: Depreciation × Replacement Cost
- Includes: Detached items and land value
- Best for: Properties with reliable cost data

**2. CME Approach:**
- Source: SalesComparisonTab evaluation
- Field: final_valuation_data.cme_projected_assessment
- Based on: Adjusted comparable sales
- Includes: Min/max range from 5 comps
- Best for: Properties with good sales data

**Final Recommendation Logic:**
```javascript
if (cmeExists && marketDataExists) {
  // Both approaches available - compare
  if (Math.abs(cme - marketData) / marketData < 0.15) {
    // Within 15% - high confidence
    finalValue = (cme + marketData) / 2;  // Average both
    confidence = 'HIGH';
    method = 'BOTH';
  } else {
    // Significant variance - flag for review
    finalValue = cme;  // Prefer CME
    confidence = 'REVIEW REQUIRED';
    method = 'CME';
  }
} else if (cmeExists) {
  // Only CME available
  finalValue = cme;
  confidence = cmeRange < 0.20 ? 'MEDIUM' : 'LOW';
  method = 'CME';
} else if (marketDataExists) {
  // Only Market Data available
  finalValue = marketData;
  confidence = 'MEDIUM';
  method = 'MARKET DATA';
} else {
  // No valuation data
  finalValue = null;
  confidence = 'NO DATA';
  method = null;
}
```

**Analytics Dashboard:**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Final Valuation Analytics                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Total Properties: 1,234                                                       │
│                                                                                │
│ Valuation Method Distribution:                                                │
│   Both Approaches: 856 (69%) - HIGHEST CONFIDENCE                             │
│   CME Only: 234 (19%)                                                         │
│   Market Data Only: 89 (7%)                                                   │
│   No Valuation: 55 (4%) - NEEDS ATTENTION                                    │
│                                                                                │
│ Confidence Levels:                                                             │
│   High: 912 (74%)                                                             │
│   Medium: 267 (22%)                                                           │
│   Low: 45 (4%)                                                                │
│   Review Required: 10 (<1%)                                                   │
│                                                                                │
│ Average Values:                                                                │
│   Market Data Approach: $312,456                                              │
│   CME Approach: $318,234                                                      │
│   Final Recommended: $315,345                                                 │
│   Variance: 1.8% (Excellent agreement)                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Property-Level Analytics Table:**
```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Block │ Lot │ Market Data │ CME Value │ Final Value │ Confidence │ Method         │
├────────────────────────────────────────────────────────────────────────────────────┤
│  123  │ 45  │  $285,000   │ $288,500  │  $286,750   │    HIGH    │ Both (avg)     │
│  124  │ 12  │  $315,000   │ $312,000  │  $313,500   │    HIGH    │ Both (avg)     │
│  125  │  8  │  $245,000   │    ---    │  $245,000   │   MEDIUM   │ Market Data    │
│  126  │ 22  │     ---     │ $425,000  │  $425,000   │   MEDIUM   │ CME            │
│  127  │ 15  │  $385,000   │ $465,000  │  $465,000   │   REVIEW   │ Variance >15%  │
│  128  │  9  │     ---     │    ---    │     ---     │   NO DATA  │ Manual needed  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Quality Metrics:**

**CME Quality Indicators:**
- Number of comparables found (min 3, ideal 5)
- Range spread (min to max): <20% = excellent, <30% = good, >30% = review
- Average adjustment %: <15% = excellent, <25% = good, >25% = review
- Sales recency: Within 2 years ideal

**Market Data Quality Indicators:**
- Effective age reasonableness: Within expected range
- Depreciation factor: 0.00-1.00 valid range
- Replacement cost availability: From cost tables
- Year built accuracy: Verified vs assessment records

**Review Flags:**
```
┌─────────────────────────────────────────────────────────────┐
│ Properties Requiring Manual Review (10)                     │
├─────────────────────────────────────────────────────────────┤
│ Block 127, Lot 15 - Market Data vs CME variance 20.8%       │
│   └─ Market Data: $385,000  CME: $465,000                   │
│                                                              │
│ Block 145, Lot 8 - CME range too wide (35% spread)          │
│   └─ Min: $285,000  Max: $385,000  (needs more comps)       │
│                                                              │
│ Block 156, Lot 22 - Effective age outlier (120 years)       │
│   └─ Check year built accuracy                              │
└─────────────────────────────────────────────────────────────┘
```

**Filters:**
- Confidence level filter (High, Medium, Low, Review, No Data)
- Method filter (Both, CME Only, Market Data Only)
- Value range filter
- Property class filter
- VCS filter

**Excel Export:**

Comprehensive analytics report:
- Property-level recommendations
- Confidence scores
- Both approach values
- Variance analysis
- Review flags
- Quality metrics
- Professional formatting

**Database Integration:**
- Reads from final_valuation_data table
- Updates final_recommended_value field
- Updates final_method_used field
- Updates final_notes field
- Auto-saves recommendations

**Critical Implementation Notes:**
- Preference: Average both approaches when <15% variance
- CME preferred over Market Data when variance high
- No Data properties require manual appraisal
- Review flags essential for quality control
- Export includes all metrics for client reporting

---

**Final Valuation Module Summary:**

**Total Lines of Code:** 9,697 (nearly 10,000 lines!)

**Component Breakdown:**
- SalesComparisonTab: 2,812 lines (29%)
- SalesReviewTab: 1,879 lines (19%)
- MarketDataTab: 1,551 lines (16%)
- AdjustmentsTab: 1,325 lines (14%)
- RatableComparisonTab: 1,112 lines (11%)
- DetailedAppraisalGrid: 577 lines (6%)
- AnalyticsTab: 441 lines (5%)

**Database Tables:**
- final_valuation_data (property-level)
- job_tax_rates (job-level)
- job_adjustment_grid (CME configuration)

**Excel Exports:**
- Sales Review Report
- Build Final Roster (Market Data with grouping)
- Ratable Comparison Report
- CME Analysis Report
- Adjustment Grid Export
- Analytics Summary Report

**Key Integration Points:**
- Uses properties from JobContainer props
- Integrates with MarketAnalysis normalization data
- Feeds ManagementChecklist completion tracking
- Supports Appeal Coverage evidence gathering

---

### ManagementChecklist.jsx - 29-Item Workflow Management System ✅

**Scale**: Complete workflow tracker with document management and client approvals

**Core Philosophy**: Track every critical step from contract to turnover with visual progress indicators

**29 Workflow Items (Hardcoded Template):**

**Setup Phase (Items 1-8):**
1. Contract Signed by Client (file upload)
2. Contract Signed/Approved by State (file upload)
3. Tax Maps Approved
4. Tax Map Upload (file upload)
5. Zoning Map Upload (file upload)
6. Zoning Bulk and Use Regulations Upload (file upload)
7. PPA Website Updated
8. Data Collection Parameters (requires client approval)

**Inspection Phase (Items 9-16):**
9. Initial Mailing List (special action: generate_mailing_list)
10. Initial Letter and Brochure (multiple file uploads supported)
11. Initial Mailing Sent
12. First Attempt Inspections (auto-updates from ProductionTracker stats)
13. Second Attempt Inspections (special action: generate_second_attempt_mailer)
14. Third Attempt Inspections (special action: generate_third_attempt_mailer)
15. Lot Sizing Completed
16. Lot Sizing Questions Complete

**Analysis Phase (Items 17-26):**
17. Data Quality Analysis
18. Market Analysis (synced from component)
19. Page by Page Analysis (synced from component)
20. Land Value Tables Built (synced from component)
21. Land Values Entered (requires client approval, synced)
22. Economic Obsolescence Study (synced from component)
23. VCS Reviewed/Reset (requires client approval)
24. Cost Conversion Factor Set (requires client approval, synced)
25. Building Class Review/Updated (synced from component)
26. Effective Age Loaded/Set (synced from component)

**Completion Phase (Items 27-29):**
27. Final Values Ready (requires client approval, synced)
28. Generate Turnover Document (file upload)
29. Turnover Date (date input, special action: archive_trigger)

**Key Features:**
- **Status Tracking**: pending → in_progress → completed states
- **Client Approval System**: Track approval status, date, and approver
- **Document Management**: Upload/download files via Supabase Storage
- **Multiple File Support**: Initial Letter can have multiple documents
- **Auto-Sync Items**: 11 items marked as `is_analysis_item` sync from MarketAnalysis tabs
- **Special Actions**: Generate mailing lists, trigger archive on turnover
- **Reassessment Mode**: Certain items marked "Not Applicable" for reassessment jobs
- **File Verification**: Checks actual file existence in storage

**Visual Indicators:**
- **Color-coded categories**: Setup (blue), Inspection (green), Analysis (purple), Completion (gray)
- **Progress badges**: Synced from Analysis, Not Applicable badges
- **Client approval badges**: Purple indicators for approved items with dates
- **Completion status**: Green checkmarks with completion dates
- **File indicators**: Blue file icons for uploaded documents

**Database Integration:**
- Status stored in `checklist_item_status` table per job
- Documents tracked in `checklist_documents` table
- File paths reference Supabase Storage locations
- Per-job status tracking (not global template)

**Component Integration:**
- Receives inspection data from JobContainer props
- Updates First Attempt item with ProductionTracker stats
- Syncs with MarketAnalysis tab completion events
- Saves assessor name/email changes to jobs table

**Smart Behaviors:**
- Auto-populates inspection counts from workflow stats
- Enables special actions based on item completion
- Validates file existence before showing download links
- Handles both single and multiple file uploads per item
- Preserves scroll position during status updates

**Special Actions:**
- **generate_mailing_list**: Creates inspection mailing list
- **generate_second_attempt_mailer**: Second attempt letters
- **generate_third_attempt_mailer**: Third attempt letters
- **archive_trigger**: Archives job on turnover date entry

**Reassessment Handling:**
- Items 10-14 marked "Not Applicable" for reassessment projects
- Based on `jobData.data_collection_status === 'reassessment'`
- Visual gray styling for non-applicable items

### BillingManagement.jsx - Financial Control Tower 💰

**Scale**: 3,300 lines of integrated financial management

**Core Features:**
- **Six-Tab Command Center with Live Counts**:
  - Active Jobs: Contract setup, billing events, payment tracking with visual status indicators
  - Planned Jobs: Pipeline management with contract values and 90% collection assumption
  - Legacy Jobs: Historical billing management for special cases
  - Expenses: Monthly tracking with Excel import, auto-calculation of daily fringe rate
  - Office Receivables: Non-job revenue tracking with status management (Open/Paid)
  - Shareholder Distributions: Profit distribution analysis with equity tracking

- **Global Business Metrics Dashboard**:
  - Real-time P&L with profit margin percentages
  - Collection rate tracking (YTD and projected)
  - Cash flow analysis with working capital calculations
  - Daily expense rate based on actual working days
  - Projected year-end financials

- **Contract Management System**:
  - Standard Templates: 10% retainer, 5% end, 3%+2% appeals structure
  - Custom contract configuration per job
  - Visual indicators for missing contracts (⚠️ Contract Setup Required)
  - Automatic billing percentage calculations

- **Billing Event Features**:
  - Bulk billing import from Excel with parsing
  - Payment status tracking (Pending/Paid)
  - Invoice number management
  - Remaining due calculations excluding retainer amounts
  - Visual completion indicators (✅ 100% Billed)

**Distribution Calculator:**
- Conservative Analysis: Based on actual collections only
- Projected Analysis: Includes planned contracts at 90% collection
- Operating Reserve Settings: 0-2 months configurable
- Cash Reserve: $200k default (adjustable)
- Equity-based distribution maintenance
- YTD distribution tracking per shareholder

**Financial Intelligence:**
- **"Remaining (No Retainer)"**: Shows actual work left excluding 10% holdbacks
- **Job Status Color Coding**: Visual indicators based on billing percentage
- **Payroll Period Detection**: Alerts for 15th and month-end periods
- **Collection Efficiency**: Monitors payment velocity and aging
- **Working Days Calculation**: Dynamic based on actual calendar (252/year typical)

**Ownership Structure:**
- Thomas Davis: 10%
- Brian Schneider: 45%
- Kristine Duda: 45%

**Excel Integration:**
- Expense import with monthly allocation
- Billing history paste from clipboard
- Automatic parsing and validation
- Error handling for malformed data

**Key Business Rules:**
- Planned contracts: 90% collection rate assumption
- Operating reserves: Configurable 0-2 months
- Cash reserve: $200k default (adjustable)
- Distribution equity: Maintained for tax purposes
- Working days: 21 per month average, 252 per year
- Daily fringe: Current expenses ÷ working days YTD
- Profit margin: (Revenue - Expenses) ÷ Revenue × 100

**Tab-Specific Features:**

**Active Jobs Tab:**
- Sort by billing percentage (lowest first)
- Contract setup warnings
- Billing completion badges
- Quick actions: Setup Contract, Add Billing, View History
- **Archive Integration**: Only shows jobs with `job_type = 'standard'` AND `archived_at IS NULL`
  - Archived jobs automatically move to Legacy Jobs tab

**Legacy Jobs Tab:**
- Shows jobs with `job_type = 'legacy_billing'` OR `archived_at IS NOT NULL`
- **Archive Integration**: Archived jobs from Active appear here automatically
- Payment history and contract details preserved for archived jobs
- All billing functionality remains available for archived jobs

**Expenses Tab:**
- Monthly breakdown grid
- Excel import functionality
- YTD totals and projections
- Daily expense rate calculations

**Office Receivables Tab:**
- Status management (Open/Paid/Cancelled)
- Invoice number tracking
- Non-job revenue categorization
- Quick edit/delete actions

**Shareholder Distributions Tab:**
- Individual shareholder tracking
- Distribution group management
- Monthly/yearly aggregations
- Equity percentage calculations
- Notes and documentation

### PayrollManagement.jsx - Office Manager Chaos Killer 💸

**Scale**: 1,100 lines of smart payroll processing and worksheet validation

**Core Features:**
- **Three-Step Workflow**: Upload worksheet → Calculate bonuses → Export to ADP
- **Excel Worksheet Validation**: Detects formula issues, frozen panes, total mismatches, missing data
- **Email Feedback Generator**: Creates friendly emails about worksheet issues with copy button
- **Inspection Bonus Calculation**: $2.00 per residential inspection from inspection_data
- **Smart Period Detection**: Knows payroll runs 15th and month-end
- **Data Freshness Warnings**: Alerts if inspection data might be stale
- **Archive System**: Saves to payroll_periods and payroll_entries tables

**Worksheet Intelligence:**
- Detects hardcoded zeros vs formulas in Excel cells
- Validates SUM formulas against individual row totals
- Identifies frozen panes and merged cells
- Finds employee header row automatically (looks for "EMPLOYEE")
- Shows "Salary" badge for employees with "same" hours notation
- Calculates expected hours based on actual working days
- Color codes validation issues (red=error, amber=warning, blue=suggestion)

**Bonus Calculation Engine:**
- Queries inspection_data for residential inspections (classes 2, 3A)
- Filters by date range (payroll start to end)
- Groups by inspector initials
- Applies $2.00 per inspection rate
- Tracks inspection IDs to prevent double-payment
- Debug output shows all matched initials

**Payroll Processing Features:**
- Merges worksheet data with calculated bonuses
- Updates Appt OT with Field Bonus amounts
- Calculates new totals automatically
- Shows inspection counts per employee
- Visual row highlighting for employees with issues
- Auto-populates next period dates after processing

**Export & Archive:**
- Generates ADP-compatible CSV format
- Includes headers: Employee Name, Hours, Appt OT, Field Bonus, TOTAL OT
- Adds totals row at bottom
- Archives period data to payroll_periods table
- Marks inspections as processed with period end date
- Saves processing settings and issues found

**Business Rules:**
- Bimonthly payroll periods (1-15, 16-end of month)
- Only residential inspectors get bonuses (classes 2, 3A)
- Expected hours calculation excludes weekends
- $2.00 bonus per residential inspection
- Inspections marked processed to prevent double-payment
- Salary employees show "same" for hours
- Total validation tolerance: 0.01 for floating point

**User Experience:**
- Progress indicators for each step
- Success messages with inspection counts
- Email template generator for worksheet feedback
- Copy-to-clipboard functionality
- Next period auto-population
- Color-coded validation feedback
- Tip boxes for guidance
- Archive view with historical periods

### EmployeeManagement.jsx - Human Capital Analytics Platform 💪

**Scale**: 2,600+ lines combining HR operations with cross-job performance analytics

**Core Features:**
- **Global Inspector Performance Analytics**: Loads ALL inspection data across ALL jobs with pagination (45K+ records)
- **Smart Employee Import**: Excel upload with automatic role detection and inactive status management
- **FTE Calculation Engine**: Real workforce capacity based on hours worked (part-time = hours/40)
- **Inspector Performance Tiles**: ProductionTracker-style metrics by role type
- **Bulk Communication System**: Email by role, region, or selection with clipboard support
- **Employee Enrichment Pipeline**: Matches inspection records with employees via initials lookup

**Tabs = Mini Applications:**
- **Overview**: Full analytics dashboard + FTE analysis + Role distribution panels
- **Directory**: Complete contact management with filtering
- **HR Forms**: Document repository
- **Data Management**: Import/export/quality control

**Key Display Components:**
- **FTE Analysis Panel**: Shows Total FTE, Full-Time FTE, Part-Time FTE, and FTE Efficiency (FTE vs headcount ratio)
- **Role Distribution Visual**:
  - Inspector Types: Residential, Commercial, Management, Clerical, Owners
  - Employment Types: Full-Time, Part-Time, Contractors with counts
- **Top Performers Tracking**: Identifies best residential and commercial inspectors by metrics
- **Regional Statistics**: Aggregates total inspections and inspector counts by region

**Analytics Processing Pipeline:**
1. Load 45K+ inspection records with pagination (500/batch)
2. Enrich with employee data via initials matching
3. Add job-specific InfoBy configs and vendor types
4. Handle special cases: "PO" (Per Office) and empty initials
5. Cache both raw and processed data for 5 minutes
6. Allow filter changes without database reload

**Key Patterns:**
- Inactive employee auto-detection from import files
- Different metrics for different inspector types:
  - Residential: Entry/Refusal rates, daily averages
  - Commercial: Inspection counts, pricing metrics
  - Management: Combined view of both residential AND commercial
- The "three kings" hardcoded: Tom Davis (Owner), Brian Schneider (Owner), James Duda (Management) 👑

**Production Details:**
- Handles cross-job analytics aggregation
- Paginated loading for handling millions of inspection records (500 per batch)
- Smart FTE calculations for workforce planning (part-time = hours/40)
- Bulk operations with role-based filtering
- Export functionality for HR reporting
- Quarter filtering for analytics (Q1-Q4 2024-2025)
- 3-retry logic with exponential backoff for failed data loads
- **Enhanced Caching**:
  - Stores both `rawData` (45K records) and `processedResults`
  - 5-minute cache expiration with timestamp tracking
  - Enables instant filter changes without database hits

## Component Complexity Rankings (Reality Check!)

Based on actual line counts from our review:

### The Monsters (3,000+ lines):
1. **LandValuationTab.jsx** - 4,400+ lines (THE BEAST!)
2. **ProductionTracker.jsx** - 4,400 lines
3. **PreValuationTab.jsx** - 3,726 lines
4. **BillingManagement.jsx** - 3,300 lines
5. **AdminJobManagement.jsx** - 3,200+ lines

### The Heavyweights (2,000-3,000 lines):
1. **DataQualityTab.jsx** - 2,651 lines
2. **EmployeeManagement.jsx** - 2,600+ lines

### The Middleweights (1,000-2,000 lines):
1. **PayrollManagement.jsx** - 1,100 lines

### The Lightweights (<500 lines):
1. **MarketLandAnalysis.jsx** - 173 lines (just an orchestrator!)
2. **JobContainer.jsx** - ~500 lines (estimated)

### Not Yet Built:
1. **FinalValuation.jsx** - Placeholder
2. **AppealCoverage.jsx** - Placeholder

### InfoBy Code Categories & Job-Specific Configuration

```javascript
// BRT Example (parsed from Residential['30'].MAP)
const categoryConfig = {
  entry: ['01', '02', '03', '04'],     // OWNER, SPOUSE, TENANT, AGENT
  refusal: ['06'],                     // REFUSED
  estimation: ['07'],                  // ESTIMATED  
  invalid: ['05'],                     // AT DOOR (job-specific)
  commercial: ['20', '08', '09']       // CONVERSION + pricing codes
};

// Microsystems Example (140 prefix codes)
const categoryConfig = {
  entry: ['140A', '140O', '140S', '140T'],     // AGENT, OWNER, SPOUSE, TENANT
  refusal: ['140R'],                           // REFUSED INT
  estimation: ['140E', '140F', '140V'],        // ESTIMATED varieties
  invalid: ['140D'],                           // AT DOOR
  commercial: ['140P', '140N', '140B']         // PRICED, NARRATIVE, ENCODED
};
```
### Enhanced Validation Rules (ProductionTracker)

1. Valid date + missing initials → scrub
2. Valid initials + missing/invalid date → scrub
3. Invalid InfoBy codes → scrub
4. Refusal code but missing listing data → flag
5. Entry code but missing listing data → flag
6. Estimation code but has listing data → flag
7. Residential inspector on commercial property → flag
8. Zero improvement but missing listing data → flag
9. Price field validation (BRT only) → scrub

### Processing Modal Decision Flow

When validation issues are found during processing:
1. Modal pauses processing with promise-based wait
2. User can only "Skip" issues (keep as errors) during processing
3. Override functionality moved to post-processing Validation Report tab
4. Skipped issues remain in validation report for later override
5. Processing continues after user reviews all issues
6. Shows one validation issue at a time with navigation controls
7. Promise stored in `window._resolveProcessingModal` (temporary pattern)

### External Inspector Pattern

External inspectors (client codes like "GL", "ABC") are:
1. Stored as comma-separated string in `jobs.external_inspectors`
2. Merged with regular employees for validation
3. Display with "(External)" suffix in analytics
4. Count toward analytics but flagged separately
5. Configured in ProductionTracker settings panel

### Payroll Period Detection

```javascript
const isPayrollPeriod = () => {
  const dayOfMonth = new Date().getDate();
  return (dayOfMonth >= 13 && dayOfMonth <= 15) || dayOfMonth >= 28;
};
System knows when payroll is due and alerts users to run ProductionTracker for accurate compensation.
Freshness Tracking Logic
javascriptconst needsProductionUpdate = (lastProductionRun, lastFileUpload, percentBilled) => {
  // Valuation phase jobs (91%+ billed) don't need regular updates
  if (percentBilled >= 0.91) return false;
  
  // Never run? Definitely needs update
  if (!lastProductionRun) return true;
  
  // File newer than production? Needs update
  if (lastFileUpload && new Date(lastFileUpload) > new Date(lastProductionRun)) return true;
  
  // Older than 14 days? Needs update
  return getDaysSince(lastProductionRun) > 14;
};
Property Assignment Composite Key Generation
javascript// Must match processor format EXACTLY for accurate matching
const compositeKey = `${year}${ccdd}-${block}-${lot}_${qual || 'NONE'}-${card || 'NONE'}-${location || 'NONE'}`;
Validation Override Syncing
Before processing, ProductionTracker syncs existing overrides to current file version:
javascriptconst syncOverridesToCurrentVersion = async () => {
  // Get count of overrides from older versions
  const { count } = await supabase
    .from('inspection_data')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobData.id)
    .eq('override_applied', true)
    .lt('file_version', latestFileVersion);
  
  if (count > 0) {
    // Update them all to current version
    await supabase
      .from('inspection_data')
      .update({ 
        file_version: latestFileVersion,
        upload_date: new Date().toISOString()
      })
      .eq('job_id', jobData.id)
      .eq('override_applied', true)
      .lt('file_version', latestFileVersion);
  }
};
This prevents duplicate key errors when processing after file updates.
Module State Architecture
ProductionTracker → App.js state → AdminJobManagement tiles
                         ↓
                  workflow_stats (persisted to jobs table)
Key Implementation Details:

Persistence: All analytics stored in jobs.workflow_stats field for navigation survival
Job Creation Lock: isCreatingJob flag prevents race conditions during job creation
Deferred Updates: Uses setTimeout(() => setState(), 0) to prevent React Error #301
Analytics Detection: Tracks when isProcessed changes from false to true
File Processing: Preserves module state during file updates (no more resets!)

Workflow Stats Structure:
javascript{
  totalRecords: number,
  validInspections: number,
  jobEntryRate: number,
  jobRefusalRate: number,
  commercialCompletePercent: number,
  pricingCompletePercent: number,
  lastProcessed: timestamp,
  isProcessed: boolean
}
Part 2: Architecture Patterns & Data Processing
markdown## Architecture Patterns

### Service Architecture Pattern
- Clean separation with dedicated services (employeeService, jobService, propertyService, etc.)
- Consistent field mapping between component state and database schema
- Component fields (camelCase) → Database fields (snake_case)

### Single Load Pattern (NEW!)
JobContainer loads properties ONCE and distributes via props:
- Eliminates double loading between modules
- Consistent data freshness across all modules
- Better performance (single database query)
- Assignment filtering applied at query level
- Properties passed to ProductionTracker, MarketLandAnalysis, etc.

### Raw Data Consolidation Pattern (NEW - September 2024!)
To solve performance bottlenecks with 50,000+ properties:
- **Before**: Each property stored `raw_data` JSONB individually
- **After**: Single `raw_file_content` TEXT at job level
- **Access Pattern**: Components parse from job-level raw content on demand
- **Benefits**: ~95% reduction in storage, 10x query performance improvement

### PRESERVED_FIELDS Pattern
During file updates, critical fields from different modules are preserved:
```javascript
// ProductionTracker fields
'project_start_date', 'validation_status'
// AdminJobManagement fields  
'is_assigned_property'
// FinalValuation fields
'asset_building_class', 'asset_design_style', 'asset_ext_cond'
// MarketAnalysis fields (now in property_market_analysis table)
'location_analysis', 'new_vcs', 'values_norm_time', 'values_norm_size'
'asset_key_page', 'asset_map_page', 'asset_zoning'
// AppealCoverage fields
'new_vcs'
Field Mapping Pattern
javascript// Consistent transformation across all services
if (componentFields.name) dbFields.job_name = componentFields.name;
if (componentFields.municipality) dbFields.municipality = componentFields.municipality;
Cascade Deletion Order
When deleting jobs, related records are deleted in this order to avoid foreign key constraints:

comparison_reports
job_assignments
job_responsibilities
property_records
property_market_analysis (NEW)
inspection_data
market_land_valuation
checklist_items
checklist_item_status
checklist_documents
job_contracts
billing_events
payroll_periods
source_file_versions
jobs (finally)

Deferred State Update Pattern
To avoid React Error #301, the system uses deferred updates throughout:
javascriptsetTimeout(() => {
  setMetricsRefreshTrigger(prev => prev + 1);
}, 0);
Job Creation Lock Pattern
Prevents race conditions during heavy operations:
javascriptconst [isCreatingJob, setIsCreatingJob] = useState(false);
// Lock prevents stats refresh during job creation
Console.log Monitoring Pattern
javascript// Capture batch processing logs for user feedback
const originalConsoleLog = console.log;
console.log = (...args) => {
  const message = args.join(' ');
  if (message.includes('✅') || message.includes('Batch inserting')) {
    logs.push({ timestamp: new Date().toLocaleTimeString(), message });
  }
  originalConsoleLog(...args);
};
Users see real-time processing progress in a friendly UI!
Parallel Data Loading Pattern
javascript// Load everything at once for better performance
const [connectionTest, jobsData, planningData, managersData, statsData, userData] = 
  await Promise.all([...]);
// Then update counts asynchronously after UI renders
Promise-Based Modal Pattern (Temporary)
ProductionTracker uses promise-based waiting for validation decisions:
javascriptconst waitForUserDecision = new Promise((resolve) => {
  window._resolveProcessingModal = resolve;
});
await waitForUserDecision;
This is marked as temporary and should be replaced with proper React state management.
Data Processing Architecture
Processors vs Updaters Pattern

Processors (INSERT): Used for initial job creation, all new records

Sets is_new_since_last_upload: true
Calculates initial property class totals
Has cleanup mechanism on failure (prevents partial job creation)


Updaters (UPSERT): Used for file updates, preserves user work

Sets is_new_since_last_upload: false
Has rollback mechanism on failure
Smart field preservation through omission (doesn't map user-defined fields)



Smart Field Preservation Through Omission
Key Innovation: Updaters don't include user-defined fields in their mapping, so UPSERT won't overwrite them:

is_assigned_property - Set by AdminJobManagement, preserved during updates
Fields in property_market_analysis table - Completely separate from update process
Any future user-defined fields - Safe by default if not in updater mapping

Cleanup vs Rollback Strategy

Processors: Cleanup mechanism removes all inserted records on failure
Updaters: Rollback mechanism removes only records from current update attempt
Both: 50 retry attempts to ensure data consistency

Batch Processing Pattern
All processors/updaters use consistent batching:

Batch Size: 250 records
Retry Logic: 50 attempts with exponential backoff
Error Codes Handled:

57014 (query canceled)
08003/08006 (connection errors)


Delay Between Batches: Prevents overwhelming the database
Progress Notifications: For files > 1000 records
Console.log Monitoring: Users see real-time progress

Part 3: Component Complexity Rankings & Key Services
markdown## Component Complexity Rankings (Reality Check!)

Based on actual line counts from our review:

### The Monsters (3,000+ lines):
1. **LandValuationTab.jsx** - 4,400+ lines (THE BEAST!)
2. **ProductionTracker.jsx** - 4,400 lines
3. **PreValuationTab.jsx** - 3,726 lines
4. **BillingManagement.jsx** - 3,300 lines
5. **AdminJobManagement.jsx** - 3,200+ lines

### The Heavyweights (2,000-3,000 lines):
1. **DataQualityTab.jsx** - 2,651 lines
2. **EmployeeManagement.jsx** - 2,600+ lines

### The Middleweights (1,000-2,000 lines):
1. **PayrollManagement.jsx** - 1,100 lines

### The Lightweights (<500 lines):
1. **MarketLandAnalysis.jsx** - 173 lines (just an orchestrator!)
2. **JobContainer.jsx** - ~500 lines (estimated)

### Not Yet Built:
1. **FinalValuation.jsx** - Placeholder
2. **AppealCoverage.jsx** - Placeholder

## Key Services & APIs

### propertyService (Critical Discovery!)

**Location**: Part of `src/lib/supabaseClient.js` services

**Purpose**: Bridge between job-level raw_file_content storage and property-level access after September optimization

**Key Methods:**
```javascript
// Server-side RPC call to get raw data for specific property
getRawDataForProperty(job_id, property_composite_key)

// Client-side fallback for performance (directly accesses jobs.raw_file_content)
getRawDataForPropertyClientSide(job_id, property_composite_key)

// Vendor-aware acreage calculation
getCalculatedAcreage(property, vendor_type)

// Package sale detection (same deed book/page)
getPackageSaleData(properties)
Why This Exists: After moving raw_data from property_records to jobs.raw_file_content for performance, components still need property-specific raw data access. This service extracts individual property data from the consolidated job-level storage.
Performance Pattern: Components should use client-side method when possible, with caching via Map() to avoid repeated parsing of large raw_file_content.
worksheetService
Location: Part of src/lib/supabaseClient.js services
Purpose: Handles worksheet data persistence for PreValuationTab
Key Functions:

Saves normalization configuration
Persists time normalized sales decisions
Stores worksheet statistics
Updates market_land_valuation table

checklistService
Location: Part of src/lib/supabaseClient.js services
Purpose: Updates workflow checklist completion status
Key Functions:

Updates checklist item completion when data is entered
Marks items as auto-completed based on module activity
Syncs with ManagementChecklist component

