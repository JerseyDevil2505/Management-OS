# NORM-PRESERVE: Normalization Preservation on File Update

**Label:** `NORM-PRESERVE`
**Branch:** Current working branch
**Status:** Built, needs testing with real sales changes

---

## What We Built

When an assessor uploads an updated source file (with new/changed sales), the system now **preserves previously-vetted normalized values** for unchanged sales instead of wiping everything.

### Core Workflow

1. **File Upload & Comparison** — System detects changed sales via composite key matching
2. **Comparison Modal** — Assessor sees Keep Old / Keep New / Keep Both / **Reject** options per sale
3. **Selective Cleanup** — Only changed or rejected sales have `values_norm_time` cleared from `property_market_analysis`
4. **Auto-Normalization** — New/changed valid sales are auto-normalized using HPI and set to **"keep"** (no pending step)
5. **Rejected Sales Skipped** — Sales marked Reject are excluded from auto-normalization entirely
6. **Staleness Warning** — Amber banner appears on Pre-Valuation tab: "Re-run size normalization"

### Files Changed

| File | What Changed |
|------|-------------|
| `src/components/job-modules/FileUploadButton.jsx` | Reject button in modal, selective cleanup of `values_norm_time`, pass rejected keys to auto-normalize |
| `src/lib/autoNormalization.js` | Accept `rejectedKeys` option, skip rejected sales, default to "keep" instead of "pending", sync results to `property_market_analysis` |
| `src/components/job-modules/market-tabs/PreValuationTab.jsx` | Amber stale warning banner, clear `sizeNormStale` flag after re-run |

### Decision Logic (autoNormalization.js)

- **New/changed sales** → auto-set to `keep`
- **Previously rejected + unchanged** → stays `reject`
- **Previously rejected + now changed** → reset to `keep`

---

## What Needs Testing

Find a job where the updated source file has **actual sales price or date changes** for existing properties.

### Test Checklist

- [ ] Upload updated file — comparison modal shows changed sales
- [ ] Use **Reject** on at least one sale — confirm dark gray button works
- [ ] Use **Keep New** or **Keep Both** on other changed sales
- [ ] After processing: rejected sales have NO `values_norm_time` in `property_market_analysis`
- [ ] After processing: changed accepted sales get fresh auto-normalized values
- [ ] After processing: **unchanged sales retain their old normalized values** (the whole point)
- [ ] Amber "File Updated" warning appears on Pre-Valuation tab
- [ ] Re-run size normalization — amber warning clears
- [ ] Sales Review tab shows correct keep/reject decisions
- [ ] Batch logs show rejected keys were excluded from auto-normalization

### How to Verify Data

```sql
-- Check which sales lost normalized values (should only be changed/rejected)
SELECT property_composite_key, values_norm_time, keep_reject
FROM property_market_analysis
WHERE job_id = '<JOB_ID>'
ORDER BY values_norm_time IS NULL DESC;
```

---

## Also In This Branch

- **Entry Rate for Improved Properties** — `InspectionInfo.jsx` now tracks `list_by`/`list_date` (interior inspection) and separates improved properties (improvement_value > 0) from vacant land
- **Pamphlet PDF** — Uses uploaded `Property Assessment Copilot.pdf` from public folder
