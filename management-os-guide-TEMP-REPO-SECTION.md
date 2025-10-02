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
│   │   ├── UserManagement.jsx         ← User account management
│   │   ├── UserManagement.css         ← User management styles
│   │   ├── VirtualPropertyList.jsx    ← Paginated property display component (performance optimization)
│   │   └── job-modules/               ← Job-specific workflow modules
│   │       ├── JobContainer.jsx       ← Job module dispatcher, navigation & DATA LOADER (NEW ROLE!)
│   │       ├── ManagementChecklist.jsx ← 29-item workflow management (IMPLEMENTED)
│   │       ├── ProductionTracker.jsx  ← Analytics & payroll engine (IMPLEMENTED - 4,400+ lines!)
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
│   │       ├── FinalValuation.jsx     ← Depreciation optimization engine (PLACEHOLDER)
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
│   │       ├── microsystems-processor.js  ← Microsystems initial job creation (INSERT)
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

| Component | Previous | Updated | Notes |
|-----------|----------|---------|-------|
| LandValuationTab.jsx | 4,400 | ~10,000 | THE ABSOLUTE LARGEST! |
| AttributeCardsTab.jsx | Not listed | ~2,500 | Now documented |
| CostValuationTab.jsx | Not listed | ~800 | Now documented |
| PreValuationTab.jsx | Not listed | 3,726 | Now documented |
| DataQualityTab.jsx | Not listed | 2,651 | Now documented |

**Public Assets:**

- **index.html**: Entry point with app title "Mgmt OS"
- **favicon.ico**: Browser tab icon
- **hr-documents/**: Employee resources (handbook, forms) served statically
