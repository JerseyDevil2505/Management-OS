# Final Valuation Component - Technical Specification

**Document Version:** 1.0  
**Last Updated:** January 2025  
**Status:** Planning Phase  

---

## Executive Summary

The Final Valuation component is the culmination of the property appraisal workflow, where users apply valuation methodologies to determine final assessed values. This module consolidates sales data analysis, supports two distinct valuation approaches (Market Data cost approach and LOJIK CME comparative market evaluation), and produces final assessment recommendations.

**Key Objectives:**
- Provide comprehensive sales review and filtering interface
- Support traditional cost approach (Market Data method)
- Rebuild LOJIK CME engine natively in React/Supabase
- Generate analytics and final valuation reports
- Replace expensive external AWS-hosted system ($7,500/year)

---

## Tab Structure

### Tab Navigation
1. **Sales Review** - Foundation tab for all sales analysis
2. **Market Data** - Traditional cost approach with effective year optimization
3. **Adjustments** - Adjustment grid system for CME normalization
4. **Sales Comparison** - LOJIK CME engine (native rebuild)
5. **Analytics** - Results, reports, and valuation summaries

---

## Sales Period Classifications

### Date Range Calculation Logic

Based on `jobs.end_date` (pre-tax year):

**Example: 2026 Tax Year (end_date = 2026-XX-XX)**

- **CSP** (Current Sampling Period): 10/1/2024 → 12/31/2025 (15 months)
- **PSP** (Prior Sampling Period): 10/1/2023 → 9/30/2024 (12 months)
- **HSP** (Historical Sampling Period): 10/1/2022 → 9/30/2023 (12 months)

**Formula:**
```javascript
const taxYear = new Date(jobs.end_date).getFullYear();
const yearOfValue = taxYear - 1; // 2026 → 2025

const csp = {
  start: new Date(yearOfValue - 1, 9, 1), // Oct 1, 2024
  end: new Date(yearOfValue, 11, 31)      // Dec 31, 2025
};

const psp = {
  start: new Date(yearOfValue - 2, 9, 1),  // Oct 1, 2023
  end: new Date(yearOfValue - 1, 8, 30)    // Sep 30, 2024
};

const hsp = {
  start: new Date(yearOfValue - 3, 9, 1),  // Oct 1, 2022
  end: new Date(yearOfValue - 2, 8, 30)    // Sep 30, 2023
};
```

**Color Coding:**
- CSP: Light Green (`#D1FAE5` or similar)
- PSP: Light Blue (`#DBEAFE` or similar)
- HSP: Light Orange (`#FED7AA` or similar)

---

## Schema Changes Required

### Option 1: Add to `property_market_analysis` table

```sql
ALTER TABLE property_market_analysis
ADD COLUMN cme_include_override BOOLEAN DEFAULT NULL,
ADD COLUMN effective_year INTEGER,
ADD COLUMN effective_age INTEGER,
ADD COLUMN market_data_notes TEXT,
ADD COLUMN cme_adjustment_data JSONB;
```

### Option 2: Create new `final_valuation_data` table

```sql
CREATE TABLE final_valuation_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  property_composite_key TEXT NOT NULL,
  
  -- CME Controls
  cme_include_override BOOLEAN, -- User checkmark/X override
  cme_adjustment_data JSONB,     -- Adjustment calculations
  
  -- Market Data Method
  effective_year INTEGER,        -- User-set effective year
  effective_age INTEGER,         -- Calculated: year_of_value - effective_year
  depreciation_factor NUMERIC,   -- Calculated: 1.0 - (effective_age * 0.01)
  market_data_value NUMERIC,     -- repl_cost × depreciation_factor
  
  -- Final Recommendation
  final_method_used TEXT,        -- 'market_data' or 'cme'
  final_recommended_value NUMERIC,
  final_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(job_id, property_composite_key)
);

CREATE INDEX idx_final_valuation_job ON final_valuation_data(job_id);
CREATE INDEX idx_final_valuation_composite ON final_valuation_data(property_composite_key);
```

**Recommendation:** Use Option 2 (new table) for clean separation and easier maintenance.

---

## Component Architecture

### File Structure

```
src/components/job-modules/
├── FinalValuation.jsx                    (~200 lines - orchestrator)
└── final-valuation-tabs/
    ├── SalesReviewTab.jsx                (~2,500 lines - foundation)
    ├── MarketDataTab.jsx                 (~1,500 lines - cost approach)
    ├── AdjustmentsTab.jsx                (~2,000 lines - adjustment grids)
    ├── SalesComparisonTab.jsx            (~3,000 lines - CME engine)
    ├── AnalyticsTab.jsx                  (~1,200 lines - reports)
    └── sharedFinalValuationStyles.css    (shared styles)
```

### Parent Orchestrator Pattern

**FinalValuation.jsx** follows the MarketAnalysis pattern:
- Lightweight coordinator (similar to MarketAnalysis.jsx at 173 lines)
- Tab navigation state management
- Props distribution to child tabs
- No heavy data processing (JobContainer handles that)

```javascript
const FinalValuation = ({ 
  jobData, 
  properties, 
  marketLandData,
  hpiData,
  onUpdateJobCache 
}) => {
  const [activeTab, setActiveTab] = useState('sales-review');
  
  return (
    <div className="final-valuation-container">
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
      
      {activeTab === 'sales-review' && (
        <SalesReviewTab 
          jobData={jobData}
          properties={properties}
          marketLandData={marketLandData}
          hpiData={hpiData}
          onUpdateJobCache={onUpdateJobCache}
        />
      )}
      
      {/* Other tabs... */}
    </div>
  );
};
```

---

## Tab 1: Sales Review - Detailed Specification

### Purpose
Foundation tab providing comprehensive sales data review, filtering, and period classification. All subsequent tabs depend on this data.

### Data Sources
- `property_records` table (primary source)
- Fields used:
  - `sales_date`, `sales_price`, `sales_nu`
  - `values_norm_time` (time-normalized price)
  - `values_mod_total` (current assessment - always mod4, never cama)
  - `asset_*` fields (property characteristics)
  - `property_vcs`, `property_block`, `property_lot`, `property_qualifier`

### Default Filter Logic
```javascript
// Active normalized sales only
const defaultFilter = properties.filter(p => 
  p.sales_date !== null && 
  p.sales_date !== undefined &&
  p.values_norm_time !== null &&
  p.values_norm_time !== undefined &&
  p.values_norm_time > 0
);
```

### Column Specifications

| # | Column | Source | Calculation/Notes |
|---|--------|--------|-------------------|
| 1 | VCS | `property_vcs` | - |
| 2 | Block | `property_block` | - |
| 3 | Lot | `property_lot` | - |
| 4 | Qualifier | `property_qualifier` | **Package:** Yes/No via `interpretCodes.getPackageSaleData()` |
| 5 | Address | `property_location` | - |
| 6 | Current Assessment | `values_mod_total` | Always use mod4, never cama |
| 7 | Period Code | Calculated | CSP/PSP/HSP (text only, no color) |
| 8 | Lot Frontage | `asset_lot_frontage` | - |
| 9 | Lot Acre | `asset_lot_acre` | - |
| 10 | Lot Sq Ft | `asset_lot_sf` | - |
| 11 | Type Use | `asset_type_use` | Toggle: code or meaning via `interpretCodes` |
| 12 | Building Class | `asset_building_class` | Toggle: code or meaning |
| 13 | Design | `asset_design_style` | Toggle: code or meaning |
| 14 | Exterior Condition | `asset_ext_cond` | Toggle: code or meaning |
| 15 | Interior Condition | `asset_int_cond` | Toggle: code or meaning |
| 16 | Year Built | `asset_year_built` | - |
| 17 | SFLA | `asset_sfla` | - |
| 18 | Sale Date | `sales_date` | Format: MM/DD/YYYY |
| 19 | Sales NU Code | `sales_nu` | - |
| 20 | Sale Price | `sales_price` | Currency format |
| 21 | Price Per Sq Ft | Calculated | `sales_price / asset_sfla` |
| 22 | Normalized Price | `values_norm_time` | Editable for manual overrides |
| 23 | Normalized Price Per Sq Ft | Calculated | `values_norm_time / asset_sfla` |
| 24 | Sales Ratio | Calculated | `values_mod_total / values_norm_time` |

### Package Detection Logic

Uses existing `interpretCodes.getPackageSaleData(properties, targetProperty)`:

**Additional Cards:**
- Same `block-lot-qualifier`
- Multiple card values (1,2,3 for BRT or M,A,B for Microsystems)

**Multi-Property Package:**
- Different `block-lot-qualifier` 
- Same sales book/page (deed)

**Display:** 
- "Yes" if `packageAnalysis.is_additional_card` or `packageAnalysis.is_multi_property_package`
- "No" otherwise

### Manual Time Normalization Override

For older sales without recent HPI data (e.g., 2007 sales):

1. User clicks "Edit" on Normalized Price cell
2. Modal opens with:
   - Original sale date and price
   - Manual normalized price input
   - HPI reference year (default: 2012/2013)
   - Notes field
3. Save overwrites `values_norm_time` field
4. Progressive system: Once in Final Valuation, unlikely to revisit PreValuation

**Storage:** Direct update to `property_records.values_norm_time`

### CME Inclusion Controls

**Default Included Sales NU Codes:**
- Blank (NULL)
- "0"
- "00"
- "7"
- "07"
- "32"

**User Override:**
- Checkmark (✓): Force include in CME analysis
- X mark (✗): Force exclude from CME analysis
- Empty: Use default NU code logic

**Visual Pattern (from LOJIK screenshots):**
- Green row highlight for eligible sales
- Checkmark/X icons in dedicated column
- Default view shows only eligible sales

**Storage:** 
```javascript
// Option 1: Use existing sales_decision structure
property_records.sales_history = {
  sales_decision: {
    cme_override: true | false | null
  }
}

// Option 2: New field in final_valuation_data
final_valuation_data.cme_include_override = true | false | null
```

### Filter Controls

**Sales Date Range:**
- Default: CSP period (10/1/prior-prior year → 12/31/prior year)
- Date pickers for custom range
- Quick buttons: "CSP Only", "PSP Only", "HSP Only", "All Periods"

**Sales NU Code Filter:**
- Multi-select checkboxes
- Default: blank, 0, 00, 7, 07, 32
- Option to include "10" and other codes

**Property Filters:**
- VCS (multi-select dropdown)
- Type/Use (multi-select)
- Design/Style (multi-select)
- View codes (if applicable)
- Building class (multi-select)

### Expandable Analytics Sections

**Pattern from LOJIK screenshots:**

Each section collapses/expands independently:

#### 1. Show VCS Analysis
Displays aggregated sales by VCS code:
- VCS Code
- # Sales
- Sum Sale Price
- Sum Sale Price (normalized)
- Avg. Sale Price
- PPSF
- Avg. SFLA
- Avg. Age
- COD (Coefficient of Dispersion)
- PRD (Price-Related Differential)

#### 2. Show Style Analysis
Same structure grouped by Design/Style

#### 3. Show Type/Use Analysis
Same structure grouped by Type/Use

#### 4. Show View Analysis
Same structure grouped by View codes (if applicable)

**Export Button:** "Export [Analysis Type]" for each section

### Save/Load Settings

**Settings to Persist:**
- Date range selection
- NU code filters
- Property filters (VCS, Type, Design, View)
- Show/hide columns
- Sort order
- Expanded analytics sections
- Code vs. Meaning toggle state

**Storage:**
```javascript
localStorage.setItem(`sales-review-settings-${jobId}`, JSON.stringify({
  dateRange: { start, end },
  nuCodes: [...],
  vcsFilter: [...],
  typeFilter: [...],
  designFilter: [...],
  viewFilter: [...],
  showCodes: true/false,
  expandedSections: [...],
  sortColumn: 'sale_date',
  sortDirection: 'desc'
}));
```

**UI:**
- "Save" button (saves current settings)
- "Load" button (restores saved settings)
- Settings name input (optional)

### Excel Export

**Filename:** `Sales_Review_[JobName]_[Date].xlsx`

**Formatting Standards:**
- Font: Leelawadee, size 10
- Headers: Bold, centered
- Data: Centered for numeric, left-aligned for text
- Period Code column: Text only (no background color in export)
- Currency columns: `$#,##0` format
- Percentage columns: `0.0%` format
- Column widths: Auto-fit with minimum 10

---

## Tab 2: Market Data - Detailed Specification

### Purpose
Traditional cost approach using replacement cost and depreciation. User tests effective years to find optimal depreciation that aligns calculated values with actual sales.

### Methodology

**Formula:**
```
Market Data Value = Replacement Cost × Depreciation Factor
Depreciation Factor = 1.0 - (Effective Age × 0.01)
Effective Age = Year of Value - Effective Year
```

**Example:**
- Tax Year: 2026
- Year of Value: 2025
- Replacement Cost: $450,000
- User tests Effective Year: 2020
- Effective Age: 2025 - 2020 = 5 years
- Depreciation Factor: 1.0 - (5 × 0.01) = 0.95
- Market Data Value: $450,000 × 0.95 = $427,500

### User Workflow

1. **Filter Sales:**
   - Select VCS
   - Select Type/Use
   - Optionally select Design (depends on property type)
   - Note: Multi-family may skip design filter

2. **Test Effective Year:**
   - Input/slider for effective year (e.g., 2020)
   - System calculates for all filtered properties:
     - Effective Age
     - Depreciation Factor
     - Market Data Value
   
3. **Compare to Sales:**
   - Show side-by-side:
     - Market Data Value (calculated)
     - Normalized Sale Price (actual)
     - Variance ($)
     - Variance (%)
   
4. **Optimize:**
   - Adjust effective year until variance approaches 0% for most sales
   - Target: Majority of sales within ±5% variance
   
5. **Apply to Non-Sales:**
   - Once satisfied with effective year
   - Bulk apply to all properties matching filters
   - Properties without sales get calculated Market Data Value

### Data Display

**Columns (filtered properties only):**
- VCS
- Block-Lot-Qualifier
- Address
- Type/Use
- Design
- Year Built
- SFLA
- Repl Cost (`values_repl_cost`)
- **Effective Year** (user input, uniform for filtered group)
- **Effective Age** (calculated)
- **Depreciation %** (calculated)
- **Market Data Value** (calculated)
- Sale Date (if sold)
- Normalized Price (if sold)
- Variance $ (if sold)
- Variance % (if sold)

**Color Coding (Variance %):**
- Green: Within ±5%
- Yellow: ±5% to ±10%
- Red: >±10%

### Bulk Application

**UI Flow:**
1. User clicks "Apply to All Matching Properties"
2. Confirmation modal shows:
   - Filter criteria (VCS, Type, Design)
   - Effective year being applied
   - Count of properties affected
   - Preview: First 10 properties
3. On confirm:
   - Update `final_valuation_data.effective_year` for all matching
   - Calculate and store `effective_age`, `depreciation_factor`, `market_data_value`

### Storage

```javascript
// Per property in final_valuation_data table
{
  effective_year: 2020,
  effective_age: 5,
  depreciation_factor: 0.95,
  market_data_value: 427500,
  market_data_notes: "Applied to Type 1, VCS A1 group"
}
```

---

## Tab 3: Adjustments - Detailed Specification

### Purpose
Build adjustment grids for CME comparative market evaluation. Define adjustment categories, values, and application rules.

### Adjustment Categories

Based on property comparison factors:

1. **Location Adjustments**
   - VCS differences
   - Proximity to amenities/detractors
   - Neighborhood quality tiers

2. **Design/Style Adjustments**
   - Colonial vs Ranch vs Cape, etc.
   - Architectural appeal
   - Market preference variations

3. **Condition Adjustments**
   - Exterior condition differential
   - Interior condition differential
   - Overall maintenance level

4. **Size Adjustments**
   - SFLA differential
   - Lot size differential
   - Room count differential

5. **Age/Year Built Adjustments**
   - Effective age differential
   - Renovation impact
   - Depreciation alignment

6. **Amenity/Feature Adjustments**
   - Garage (attached/detached/none)
   - Basement (finished/unfinished)
   - Fireplace, pool, deck, etc.
   - Built-in features

### Adjustment Grid UI

**Pattern:**
Table with adjustment rules defined:

| Category | Factor | Comparison | Adjustment $ | Adjustment % | Notes |
|----------|--------|------------|--------------|--------------|-------|
| Location | VCS | A1 → B2 | -15,000 | -5% | Inferior location |
| Design | Style | Colonial → Ranch | +8,000 | +3% | Colonial premium |
| Condition | Exterior | Good → Fair | -12,000 | -4% | Needs siding |
| Size | SFLA | Per 100 SF | +5,000 | - | Size adjustment |

**Add/Edit/Delete Controls:**
- "Add Adjustment" button
- Inline editing
- Delete with confirmation

### Adjustment Application Logic

**Two methods:**

1. **Dollar Amount:** Fixed $ adjustment
   ```
   Adjusted Price = Sale Price + Adjustment $
   ```

2. **Percentage:** Percentage of sale price
   ```
   Adjusted Price = Sale Price × (1 + Adjustment %)
   ```

3. **Combined:** Both methods applied
   ```
   Adjusted Price = (Sale Price + Adjustment $) × (1 + Adjustment %)
   ```

### Storage

```javascript
// In final_valuation_data.cme_adjustment_data JSONB
{
  adjustment_rules: [
    {
      id: uuid(),
      category: 'location',
      factor: 'vcs',
      from_value: 'A1',
      to_value: 'B2',
      adjustment_dollar: -15000,
      adjustment_percent: -5,
      notes: 'Inferior location'
    },
    // ... more rules
  ],
  last_updated: timestamp
}
```

### Pre-built Templates

**Option to load common adjustment templates:**
- "Residential Standard" (typical residential adjustments)
- "Multi-Family" (multi-family specific)
- "Commercial" (commercial property adjustments)
- "Custom" (user-built from scratch)

---

## Tab 4: Sales Comparison (LOJIK CME) - Detailed Specification

### Purpose
Native rebuild of LOJIK CME engine - direct sales comparison approach with adjustments for apples-to-apples comparison. Weighted average of adjusted sales determines final recommended value.

### Methodology Overview

For each subject property:

1. **Select Comparables:**
   - User-defined search criteria (VCS, Type, Design, proximity, etc.)
   - Filter to eligible sales (from Sales Review tab)
   - Manual selection or auto-suggest

2. **Apply Adjustments:**
   - Reference adjustment grid from Tab 3
   - Calculate adjustments for each comparable
   - Show before/after values

3. **Weight Comparables:**
   - User assigns weight to each comp (0-100%)
   - Closer/better comps get higher weight
   - Total weight must equal 100%

4. **Calculate Recommended Value:**
   ```
   Recommended Value = Σ (Adjusted Sale Price × Weight)
   ```

### Comparable Selection Interface

**Subject Property Panel (Left):**
- Address, Block-Lot-Qualifier
- VCS, Type, Design
- Year Built, SFLA
- Current Assessment
- Map thumbnail (optional future enhancement)

**Comparable Search (Right):**
- Filter controls:
  - VCS (multi-select, default: same VCS ± nearby)
  - Type/Use (match subject)
  - Design (match or similar)
  - SFLA range (subject SFLA ± 20%)
  - Sale date range (default: CSP period)
  - Distance from subject (future: radius search)

**Search Results:**
- Table of matching sales
- Checkbox to select as comparable
- Quick stats: Price, PPSF, SFLA, Date
- Limit: 10 comparables per subject

### Adjustment Application

**For each selected comparable:**

Show adjustment grid:

| Adjustment Category | Subject Value | Comp Value | Difference | Adjustment $ | Adjusted Price |
|---------------------|---------------|------------|------------|--------------|----------------|
| VCS | A1 | A1 | None | $0 | $450,000 |
| Design | Colonial | Ranch | Superior | +$8,000 | $458,000 |
| Exterior Cond | Good | Fair | Superior | +$12,000 | $470,000 |
| SFLA | 2,400 | 2,200 | +200 SF | +$10,000 | $480,000 |
| **Total Adjustments** | | | | **+$30,000** | **$480,000** |

**Original Sale Price:** $450,000  
**Adjusted Sale Price:** $480,000  
**Total Adjustment:** +$30,000 (+6.7%)

### Weighting Interface

**Comparable cards with weight sliders:**

```
Comparable 1: 123 Main St
Adjusted Price: $480,000
Distance: 0.2 mi
Sale Date: 03/15/2025
Quality: Excellent match
Weight: [========== 40%]

Comparable 2: 456 Oak Ave
Adjusted Price: $465,000
Distance: 0.5 mi
Sale Date: 01/10/2025
Quality: Good match
Weight: [======= 30%]

Comparable 3: 789 Elm Dr
Adjusted Price: $495,000
Distance: 0.8 mi
Sale Date: 11/20/2024
Quality: Fair match
Weight: [===== 20%]

Comparable 4: 321 Pine Ln
Adjusted Price: $470,000
Distance: 1.2 mi
Sale Date: 08/05/2024
Quality: Acceptable
Weight: [== 10%]

Total Weight: 100% ✓
```

**Auto-weight suggestions:**
- Quality score based on:
  - Similarity to subject (fewer adjustments = higher quality)
  - Proximity (closer = better)
  - Recency (newer = better)
  - Sale quality (NU code = better)

### Final Recommendation Calculation

```javascript
const recommendedValue = comparables.reduce((sum, comp) => {
  return sum + (comp.adjusted_price * comp.weight);
}, 0);

// Example:
// Comp 1: $480,000 × 0.40 = $192,000
// Comp 2: $465,000 × 0.30 = $139,500
// Comp 3: $495,000 × 0.20 = $99,000
// Comp 4: $470,000 × 0.10 = $47,000
// Recommended Value: $477,500
```

### Comparison to Current Assessment

**Display:**
```
Current Assessment: $425,000
CME Recommended Value: $477,500
Difference: +$52,500 (+12.4%)
Action: Increase recommended
```

**Color coding:**
- Green: Within ±5% (no significant change)
- Yellow: ±5% to ±15% (moderate change)
- Red: >±15% (significant change, may require review)

### Storage

```javascript
// In final_valuation_data table
{
  property_composite_key: "2024-123-45-M",
  cme_adjustment_data: {
    comparables: [
      {
        comp_property_key: "2024-124-12-M",
        comp_address: "123 Main St",
        original_price: 450000,
        adjustments: [
          { category: 'design', amount: 8000 },
          { category: 'condition', amount: 12000 },
          { category: 'size', amount: 10000 }
        ],
        total_adjustment: 30000,
        adjusted_price: 480000,
        weight: 0.40,
        quality_score: 95,
        distance: 0.2,
        sale_date: '2025-03-15'
      },
      // ... more comps
    ],
    recommended_value: 477500,
    confidence_level: 'high', // high/medium/low
    analysis_date: timestamp
  },
  final_method_used: 'cme',
  final_recommended_value: 477500
}
```

### Batch Processing

**For multiple properties:**

1. Group by similar characteristics (VCS, Type, Design)
2. Apply same search criteria to all in group
3. Auto-select comparable pool
4. User reviews and adjusts weights
5. Bulk save results

---

## Tab 5: Analytics - Detailed Specification

### Purpose
Aggregate results, generate reports, compare methods, and export final recommendations.

### Summary Statistics

**Overall Job Statistics:**
- Total properties analyzed
- Properties with sales data
- Properties valued using Market Data method
- Properties valued using CME method
- Properties requiring manual review
- Average assessment change
- Total assessment impact

**By VCS Breakdown:**
- Properties per VCS
- Average Market Data value
- Average CME value
- Assessment change statistics
- Recommendation: Increase/Decrease/No change

### Method Comparison

**Side-by-side comparison for properties with both methods:**

| Property | Current | Market Data | CME | Difference | Recommended |
|----------|---------|-------------|-----|------------|-------------|
| 123-45-M | $425K | $427K (+0.5%) | $478K (+12.4%) | -$51K | CME |
| 124-12-M | $510K | $495K (-2.9%) | $505K (-1.0%) | -$10K | CME |

**Insights:**
- Which method produces higher/lower values
- Variance between methods
- Recommendation logic

### Quality Control Checks

**Automated flags:**
- Properties with >20% variance between methods
- Properties with insufficient comparables (<3 comps)
- Properties with high adjustment totals (>15%)
- Properties without sales data in VCS
- Outliers (>2 standard deviations from VCS average)

### Export Options

**Excel Exports:**

1. **Summary Report**
   - Job overview
   - VCS-level statistics
   - Method comparison summary

2. **Detailed Property List**
   - All columns from Sales Review
   - Market Data values
   - CME values
   - Final recommendations
   - Notes/flags

3. **Assessment Change Report**
   - Properties with recommended changes
   - Grouped by increase/decrease
   - Supporting documentation (comps, adjustments)

4. **CME Comparable Report**
   - Per-property comparable analysis
   - Adjustment grids
   - Weighting documentation
   - Visual charts (future enhancement)

**PDF Reports (Future):**
- Professional formatted reports
- Include maps, photos (if available)
- Legal documentation for appeals
- Client-ready deliverables

---

## Data Flow & Dependencies

### JobContainer Integration

FinalValuation receives data from JobContainer (follows ProductionTracker pattern):

```javascript
<FinalValuation
  jobData={currentJob}
  properties={allProperties}           // All property_records for job
  marketLandData={marketLandData}      // market_land_valuation data
  hpiData={hpiData}                    // county_hpi_data
  onUpdateJobCache={handleJobCacheUpdate}
/>
```

### Cross-Tab Data Flow

```
Sales Review Tab
    ↓ (provides filtered sales + period classifications)
Market Data Tab (filters → effective year → calculated values)
    ↓
Adjustments Tab (defines adjustment rules)
    ↓
Sales Comparison Tab (applies adjustments → weights → recommendations)
    ↓
Analytics Tab (aggregates results → exports)
```

### External Dependencies

**From PreValuationTab:**
- `values_norm_time` (time-normalized prices)
- HPI data for manual normalization

**From LandValuationTab:**
- Land value allocations (optional reference)
- VCS configurations

**From AttributeCardsTab:**
- Condition analysis results (reference for adjustments)

---

## UI/UX Patterns to Follow

### Existing Pattern References

1. **Tab Navigation:** Follow MarketAnalysis pattern
   - Clean tab buttons with icons
   - Active tab highlighting
   - Smooth transitions

2. **Data Tables:** Follow ProductionTracker/PreValuationTab patterns
   - Sortable columns
   - Filter controls above table
   - Pagination for large datasets
   - Export buttons

3. **Modal Dialogs:** Follow existing modal patterns
   - Confirmation modals for bulk actions
   - Edit modals for data entry
   - Clean, centered, responsive

4. **Excel Exports:** Follow established standards
   - Font: Leelawadee, size 10
   - Formula-based totals (not hardcoded)
   - Professional formatting
   - Proper column widths

5. **Color Coding:** Follow AttributeCardsTab pattern
   - Red flags for issues (DC2626)
   - Green for positive/good (similar to LOJIK light green)
   - Yellow/orange for warnings
   - Blue for informational

### Accessibility

- Keyboard navigation support
- Screen reader friendly labels
- High contrast mode compatible
- Focus indicators on interactive elements

---

## Implementation Phases

### Phase 1: Foundation (Sales Review Tab)
**Estimated Effort:** 2-3 days

- [ ] Create FinalValuation.jsx orchestrator
- [ ] Create SalesReviewTab.jsx component
- [ ] Implement period classification logic (CSP/PSP/HSP)
- [ ] Build property table with all 24 columns
- [ ] Add filter controls (date, NU codes, VCS, Type, Design)
- [ ] Implement package detection integration
- [ ] Add code/meaning toggle
- [ ] Build expandable analytics sections
- [ ] Implement Save/Load settings
- [ ] Create Excel export functionality
- [ ] Test with real job data

### Phase 2: Market Data Method
**Estimated Effort:** 1-2 days

- [ ] Create MarketDataTab.jsx component
- [ ] Create/update schema (final_valuation_data table)
- [ ] Build filter controls (VCS, Type, Design)
- [ ] Implement effective year input/slider
- [ ] Calculate depreciation and market values
- [ ] Display comparison grid (calculated vs actual sales)
- [ ] Add variance color coding
- [ ] Build bulk application modal
- [ ] Implement database persistence
- [ ] Create Excel export for Market Data results
- [ ] Test calculation accuracy

### Phase 3: Adjustment System
**Estimated Effort:** 2 days

- [ ] Create AdjustmentsTab.jsx component
- [ ] Build adjustment category structure
- [ ] Implement adjustment grid UI (add/edit/delete)
- [ ] Create adjustment templates (Residential, Multi-Family, etc.)
- [ ] Add adjustment calculation logic ($ and %)
- [ ] Implement adjustment storage (JSONB)
- [ ] Build import/export for adjustment rules
- [ ] Test adjustment application

### Phase 4: CME Engine (LOJIK Rebuild)
**Estimated Effort:** 4-5 days

- [ ] Create SalesComparisonTab.jsx component
- [ ] Build subject property panel
- [ ] Implement comparable search interface
- [ ] Create comparable selection UI (checkbox table)
- [ ] Build adjustment application grid per comparable
- [ ] Implement weighting interface (sliders)
- [ ] Add auto-weight suggestions
- [ ] Calculate final recommended values
- [ ] Build comparison to current assessment
- [ ] Implement batch processing for multiple properties
- [ ] Add quality scoring logic
- [ ] Create database persistence for CME results
- [ ] Build CME-specific Excel exports
- [ ] Test with real sales data

### Phase 5: Analytics & Reporting
**Estimated Effort:** 2-3 days

- [ ] Create AnalyticsTab.jsx component
- [ ] Build summary statistics dashboard
- [ ] Implement method comparison analysis
- [ ] Create quality control check logic
- [ ] Build VCS-level breakdowns
- [ ] Implement all Excel export variations
- [ ] Add data visualization (charts/graphs - optional)
- [ ] Create assessment change reports
- [ ] Build CME comparable documentation export
- [ ] Test report accuracy and formatting

### Phase 6: Polish & Integration
**Estimated Effort:** 1-2 days

- [ ] Add JobContainer integration
- [ ] Implement loading states and error handling
- [ ] Add help tooltips and user guidance
- [ ] Optimize performance for large datasets
- [ ] Cross-browser testing
- [ ] Responsive design verification
- [ ] Accessibility audit
- [ ] User acceptance testing
- [ ] Documentation updates

**Total Estimated Effort:** 12-17 days

---

## Testing Strategy

### Unit Tests
- Period classification calculations
- Depreciation formula accuracy
- Adjustment application logic
- Weight distribution validation
- Recommended value calculations

### Integration Tests
- Data flow between tabs
- JobContainer data loading
- Database persistence
- Excel export generation
- Filter combinations

### User Acceptance Tests
- Complete workflow with real job data
- Market Data method accuracy verification
- CME comparable selection and weighting
- Export report validation
- Performance with large datasets (10K+ properties)

---

## Future Enhancements

### Short-term (Next 6 months)
- Map integration for proximity-based comp selection
- Photo/image upload for properties
- PDF report generation
- Advanced filtering (Boolean logic)
- Saved comparable sets

### Long-term (Next year)
- Machine learning for auto-comp selection
- GIS integration for location analysis
- Mobile-responsive interface
- Real-time collaboration features
- API integration with external valuation services

---

## Success Metrics

### Technical Metrics
- Page load time < 3 seconds (for 10K properties)
- Export generation time < 10 seconds
- Database query performance < 500ms
- Zero data loss during bulk operations

### Business Metrics
- Replace LOJIK external system ($7,500/year savings)
- Reduce valuation time by 30%
- Increase consistency across appraisers
- Enable full audit trail for appeals
- Support 50+ concurrent users

---

## Notes & Considerations

### Package Sales Handling
- Additional Cards: Show aggregated data in main table, expandable detail
- Multi-Property Packages: Display as single row with combined values
- Override options for package treatment

### Sales Decision Integration
- Leverage existing `sales_history.sales_decision` structure
- Maintain backward compatibility with FileUploadButton
- Distinguish between file comparison decisions and CME inclusion overrides

### Progressive System Philosophy
- Once in Final Valuation, rarely revisit earlier tabs
- Allow overrides/edits but preserve audit trail
- Final Valuation is the "source of truth" for assessment recommendations

### Performance Considerations
- Lazy load analytics calculations (don't run until tab opened)
- Pagination for large tables (1000 rows per page)
- Debounce filter inputs (300ms delay)
- Cache expensive calculations (period classifications)
- Batch database updates (don't save on every keystroke)

### Security & Data Integrity
- Require confirmation for bulk operations
- Log all user actions (audit trail)
- Validate calculations server-side (don't trust client)
- Prevent concurrent editing conflicts
- Backup before major changes

---

## Questions to Resolve Before Implementation

1. **Schema decision:** New `final_valuation_data` table vs. expand `property_market_analysis`?
   - **Recommendation:** New table for clean separation

2. **CME override storage:** Reuse `sales_decision` or new field?
   - **Recommendation:** New field `cme_include_override` to avoid confusion

3. **Adjustment templates:** Pre-populate with standard templates or start blank?
   - **Recommendation:** Include 3 pre-built templates (Residential, Multi-Family, Commercial)

4. **Distance calculation:** Implement now or defer to future enhancement?
   - **Recommendation:** Defer to Phase 6 (requires geocoding)

5. **Photo/map integration:** Include in initial build or future phase?
   - **Recommendation:** Future enhancement (not blocking MVP)

---

## Document Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2025 | Jersey Devil + Claude | Initial specification document created |

---

**End of Specification Document**
