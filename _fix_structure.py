#!/usr/bin/env python3
with open('management-os-guide.md', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines 138-213 (0-indexed: 137-212) need replacement
before = lines[:137]
after = lines[213:]

new_section = """├── src/                               ← Main application source code
│   ├── components/                    ← React component library
│   │   ├── AdminJobManagement.jsx     ← Job list, creation, assignment (3,280 lines)
│   │   ├── AppealsSummary.jsx         ← Cross-job appeal summary (376 lines)
│   │   ├── AssessorDashboard.jsx      ← External client dashboard (1,079 lines)
│   │   ├── BillingManagement.jsx      ← Financial control tower (4,721 lines)
│   │   ├── EmployeeManagement.jsx     ← HR + analytics (2,478 lines)
│   │   ├── LandingPage.jsx            ← Initial dashboard (217 lines)
│   │   ├── LandingPage.css            ← Landing page styles
│   │   ├── OrganizationManagement.jsx ← Multi-tenant org management (748 lines)
│   │   ├── OrganizationManagement.css ← Organization management styles
│   │   ├── PayrollManagement.jsx      ← Payroll processing (1,540 lines)
│   │   ├── RevenueManagement.jsx      ← Revenue + proposals (1,538 lines)
│   │   ├── RevenueManagement.css      ← Revenue management styles
│   │   ├── UserManagement.jsx         ← User account management (1,126 lines)
│   │   ├── UserManagement.css         ← User management styles
│   │   └── job-modules/               ← Job-specific workflow modules
│   │       ├── AppealCoverage.jsx     ← Litigation support placeholder (19 lines)
│   │       ├── DataVisualizations.jsx ← Data viz charts (1,182 lines)
│   │       ├── FileUploadButton.jsx   ← Comparison engine (3,766 lines)
│   │       ├── FinalValuation.jsx     ← 9-tab final valuation parent (182 lines)
│   │       ├── InspectionInfo.jsx     ← Inspection info display (582 lines)
│   │       ├── JobContainer.jsx       ← Module dispatcher + data loader (1,466 lines)
│   │       ├── ManagementChecklist.jsx ← 29-item workflow management (1,736 lines)
│   │       ├── MarketAnalysis.jsx     ← 6-tab valuation parent (372 lines)
│   │       ├── ProductionTracker.jsx  ← Analytics engine (4,632 lines)
│   │       ├── market-tabs/           ← Market analysis tab components
│   │       │   ├── AttributeCardsTab.jsx   ← Condition/misc items (4,624 lines)
│   │       │   ├── CostValuationTab.jsx    ← New construction + CCF (1,072 lines)
│   │       │   ├── DataQualityTab.jsx      ← Data validation (3,279 lines)
│   │       │   ├── LandValuationTab.jsx    ← Land methodology (12,678 lines!) THE BEAST
│   │       │   ├── LandValuationTab.css    ← Land valuation styles
│   │       │   ├── OverallAnalysisTab.jsx  ← Block mapping + condos (4,275 lines)
│   │       │   ├── PreValuationTab.jsx     ← Normalization + worksheet (6,408 lines)
│   │       │   └── sharedTabNav.css        ← Shared tab navigation styles
│   │       └── final-valuation-tabs/  ← Final valuation tab components
│   │           ├── AdjustmentsTab.jsx      ← CME grid + bracket mapping (2,277 lines)
│   │           ├── AnalyticsTab.jsx        ← Final recommendations (468 lines)
│   │           ├── AppealLogTab.jsx        ← Appeal log & import (3,116 lines)
│   │           ├── DetailedAppraisalGrid.jsx ← Manual appraisal + PDF (2,532 lines)
│   │           ├── MarketDataTab.jsx       ← Effective age calc (1,692 lines)
│   │           ├── RatableComparisonTab.jsx ← Tax rate impact (1,109 lines)
│   │           ├── SalesComparisonTab.jsx  ← CME comparable search (5,684 lines) THE BIG ONE!
│   │           ├── SalesReviewTab.jsx      ← Sales history review (1,870 lines)
│   │           └── VacantLandAppraisalTab.jsx ← Vacant land evaluation (1,549 lines)
│   │
│   ├── lib/                           ← Business logic, services, and utilities
│   │   ├── supabaseClient.js          ← Core Supabase config + services + interpretCodes (5,058 lines)
│   │   ├── targetNormalization.js     ← Target normalization utilities (402 lines)
│   │   ├── tenantConfig.js            ← Multi-tenant configuration (142 lines)
│   │   └── data-pipeline/             ← Vendor-specific file processing
│   │       ├── brt-processor.js       ← BRT initial job creation (1,551 lines)
│   │       ├── brt-updater.js         ← BRT ongoing updates (1,998 lines)
│   │       ├── microsystems-processor.js  ← Microsystems initial (1,420 lines)
│   │       └── microsystems-updater.js    ← Microsystems updates (1,873 lines)
│   │
│   ├── App.js                         ← Central navigation + module state hub (1,772 lines)
│   ├── App.css                        ← Global application styles
│   ├── index.js                       ← React DOM entry point
│   └── index.css                      ← Global CSS reset and utilities
│
├── supabase/functions/                ← Supabase Edge Functions
│   └── recalculate-amenities/index.ts
│
├── scripts/generate-pamphlet.js       ← PDF pamphlet generator
├── notes/new-providence-vendor-swap.md ← Vendor swap reference
├── package.json                       ← Dependencies, scripts, project metadata
├── DISCLAIMER.md                      ← Legal disclaimer
├── LICENSE                            ← Software license
├── SUPABASE_RESOURCE_FIX.md           ← RLS policy optimization guide
└── management-os-guide.md             ← THIS DOCUMENT! Complete system documentation
"""

with open('management-os-guide.md', 'w', encoding='utf-8') as f:
    f.writelines(before)
    f.write(new_section)
    f.writelines(after)

print('Done! Replaced lines 138-213 with updated repo structure')
