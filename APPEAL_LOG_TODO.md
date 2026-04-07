# Appeal Log - Outstanding Items

## 1. Bracket Not Carrying Over to CME (PRIORITY)

**Problem:**
When appeals are sent from Appeal Log to CME via 
"Send to CME" button, the bracket is not pre-selecting 
in the Adjustment Bracket dropdown despite the fix attempt.

**What we tried:**
In SalesComparisonTab.jsx useEffect for initialAppealSubjects,
we convert the bracket label (e.g. "$100K-$199K") to bracket 
key format (e.g. "bracket_1") using CME_BRACKETS.findIndex.

**What to check tomorrow:**
1. Log the initialBracket value coming into SalesComparisonTab
   to confirm it's arriving correctly from AppealLogTab
2. Log the converted bracketKey to confirm findIndex is 
   finding the right index
3. Log compFilters.adjustmentBracket after setCompFilters 
   to confirm state is being set
4. Check if the bracket dropdown is reading from 
   compFilters.adjustmentBracket correctly
5. The bracket value stored in appeal_log.cme_bracket may 
   be in a different format than CME_BRACKETS labels —
   verify what format AppealLogTab is sending in the payload

**Files involved:**
- src/components/job-modules/final-valuation-tabs/AppealLogTab.jsx
  (builds the navigation payload with bracket value)
- src/components/job-modules/JobContainer.jsx  
  (passes payload through navigateToCME)
- src/components/job-modules/final-valuation-tabs/FinalValuation.jsx
  (passes initialBracket prop to SalesComparisonTab)
- src/components/job-modules/final-valuation-tabs/SalesComparisonTab.jsx
  (receives initialBracket and sets compFilters)

---

## 2. Appeal Import (Phase 2)

**Overview:**
Allow importing appeal lists from Excel, CSV, or PDF.
Each county formats differently so we need a flexible 
column mapper approach.

**Planned flow:**
1. User clicks "Import Appeals" button in AppealLogTab toolbar
2. User uploads file (Excel, CSV, or PDF)
3. System detects columns and presents a column mapper UI:
   - Left column: fields from the file
   - Right column: dropdown to map to appeal_log fields
4. User maps columns and clicks Import
5. System processes rows and inserts into appeal_log
6. System attempts to match each row to property_records 
   via Block/Lot/Qualifier to auto-populate:
   - property_composite_key
   - current_assessment (values_mod_total)
   - petitioner_name (owner_name as default)
   - new_vcs (for bracket auto-assign)
   - inspection data
7. Mismatches or unmatched properties flagged for review

**County format notes:**
- Salem County: paper only, very basic info
- Atlantic, Ocean, Camden: 2-digit year in appeal number
- Salem County (district 17): 4-digit year
- Suffix standard across counties: D, L, A, X
- Some counties have online systems, some paper only
- Evidence exchange: 7 days before hearing date

**Appeal number parsing:**
- Only parse suffix (D/L/A/X) — reliable across counties
- Do NOT parse year from appeal number — too inconsistent
- Year comes from form field only (default current year)

**PDF handling:**
- Complex, handle last
- Excel and CSV first priority

---

## 3. Appeal Summary Top Level Component (Phase 3)

**Overview:**
AppealsSummary.jsx at the top navigation level becomes 
an executive dashboard showing all appeals across 
all active and archived jobs.

**One row per job showing:**
- Job name / municipality
- Total appeals
- By type counts (D/L/A/X)
- By status counts
- Assessment exposure
- % of ratables
- Total actual loss (as judgments come in)

**Data source:**
Aggregate query from appeal_log grouped by job_id.
All the hard schema work is done — this is just 
a rollup view.

---

## 4. Export to Excel (Quick Win)

**Status:** Button is stubbed in toolbar, not yet wired up.

**Expected columns in export:**
Status | Appeal # | Block | Lot | Qual | Location | 
Class | VCS | Bracket | Inspected | Petitioner | 
Attorney | Attny Address | Attny City/State |
Submission | Evidence | Evidence Due | Hearing Date | 
Stip Status | Tax Court | Current Assessment | 
Requested | CME Value | Judgment | Actual Loss | % Loss |
Comments

**Pattern:** Use same XLSX pattern as ProductionTracker 
and other components — already imported in the file.
