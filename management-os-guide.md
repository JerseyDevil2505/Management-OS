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

```
src/
├── components/
│   ├── AdminJobManagement.jsx         ← Job list, creation, assignment management (3,200+ lines!)
│   ├── EmployeeManagement.jsx         ← Staff management with bulk operations (2,600+ lines!)
│   ├── BillingManagement.jsx          ← Contract setup, billing events, payment tracking (3,300+ lines!)
│   ├── PayrollManagement.jsx          ← Office Manager chaos killer, inspection bonuses (1,100 lines)
│   ├── FileUploadButton.jsx           ← Comparison engine & workflow orchestrator
│   └── job-modules/
│       ├── JobContainer.jsx           ← Job module dispatcher, navigation & DATA LOADER (NEW ROLE!)
│       ├── ManagementChecklist.jsx    ← 29-item workflow management (✅ IMPLEMENTED)
���       ├─�� ProductionTracker.jsx      ← Analytics & payroll engine (✅ IMPLEMENTED - 4,400+ lines!)
│       ├── MarketLandAnalysis.jsx     ← 6-tab valuation parent component (🚧 IN DEVELOPMENT)
│       ├── market-tabs/               ← Individual tab components (NEW STRUCTURE)
│       │   ├── DataQualityTab.jsx    ← Data validation and error checking
��       │   ├── PreValuationTab.jsx   ← Normalization + Page by Page worksheet
│       │   ├── OverallAnalysisTab.jsx ← Block mapping + consistency metrics
│       │   ├── LandValuationTab.jsx  ← 7-section land methodology
│       │   ├── CostValuationTab.jsx  ← New construction + CCF
│       │   └── AttributeCardsTab.jsx ← Condition/misc items + cards
│       ├── FinalValuation.jsx         ← Depreciation optimization engine (📄 PLACEHOLDER)
│       └── AppealCoverage.jsx         ← Litigation support system (📄 PLACEHOLDER)
├── lib/
│   ├── supabaseClient.js              ← Core services, business logic & interpretCodes (ENHANCED!)
│   └── data-pipeline/
│       ├─��� brt-processor.js           ← BRT initial job creation (INSERT)
│       ├── brt-updater.js             ← BRT ongoing updates (UPSERT)
│       ├── microsystems-processor.js  ← Microsystems initial job creation (INSERT)
│       └── microsystems-updater.js    ← Microsystems ongoing updates (UPSERT)
├── App.js                             ← Central navigation + module state hub
├── App.css
���── index.js
```

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
| assessor_email | text | |
| assessor_name | text | |
| assigned_has_commercial | boolean | |
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
| project_type | text | **REMOVED** - No longer in schema |
| raw_file_content | text | **NEW** - Consolidated raw data storage |
| raw_file_parsed_at | timestamp with time zone | **NEW** - Parsing timestamp |
| raw_file_rows_count | integer | **NEW** - Row count tracking |
| raw_file_size | bigint | **NEW** - File size tracking |
| source_file_name | text | |
| source_file_status | character varying | |
| source_file_uploaded_at | timestamp with time zone | |
| source_file_version_id | uuid | |
| start_date | date | |
| state | character varying | |
| status | text | |
| target_completion_date | date | |
| total_properties | integer | |
| totalcommercial | integer | |
| totalresidential | integer | |
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

#### **property_market_analysis** �� NEW TABLE
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

#### **property_records** ⚠️ MAJOR SCHEMA CHANGES
**Components:** Created in `AdminJobManagement.jsx`, Updated by `FileUploadButton.jsx`, Used by multiple components

| Column | Data Type | Notes |
|--------|-----------|-------|
| asset_building_class | text | |
| asset_design_style | text | |
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
| asset_zoning | text | **REMOVED** - Moved to property_market_analysis |
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
14. **source_file_versions** - Using property_records.file_version

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
ProductionTracker processes → Calls onUpdateWorkflowStats → Updates App.js state →
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
┌─────────────────────────────────────────────────┐
│ Loading property records                     75% │
│ ████████████████████████░░��░░░░░  12,450/16,600 │
│ records loaded (assigned only)                   │
└─────────────────────────────────────────────────┘
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
└─────────────────────────────────────────────┘
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
└─────────────────────────────────────────────┘
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
┌────────────────────────────────────────────────────────────┐
│ Type Use │ Total │ Avg Year │ Avg Size │ Sales │ Adj Price │
├────────────────────────────────────────────────────────────┤
│ Single   │ 1,234 │   1985   │  1,850   │  156  │ $285,000  │
│ Multi    │   432 │   1972   │  1,450   │   45  │ $225,000  │
│ Condo    │   789 │   1998   │  1,100   │   89  │ $165,000  │
└────────────────────────────────────────────────────────────┘
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
└──────────────────────────────────────────────┘
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
- High: CV ≤15%
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
