# New Providence — Vendor Swap (BRT → Microsystems)

## Situation
- Job was set up as BRT but needs to convert to Microsystems
- Currently at 91% billed with real invoice history in `billing_events` and `job_contracts`

## Recommended Approach: Reset in Place (Option 2)

Instead of deleting and recreating the job (which would orphan billing data), reset the job in place:

1. **Update `jobs.vendor_type`** from `'BRT'` to `'Microsystems'`
2. **Delete `property_records`** for this job_id (wipe old BRT property data)
3. **Delete `source_file_versions`** for this job_id (clear old file tracking)
4. **Delete `comparison_reports`** for this job_id (old comparisons are BRT-format)
5. **Clear `property_market_analysis`** for this job_id (normalization values are BRT-based)
6. **Clear `market_land_valuation`** normalization fields for this job_id (time_normalized_sales, normalization_config, normalization_stats)
7. **Upload new Microsystems code and data files** — process fresh
8. **Billing stays intact** — all invoices, contract, percent_billed preserved

## Things to Verify Before Executing
- Card filtering changes: BRT uses Card `'1'`, Microsystems uses Card `'M'` or `'A'`
- Composite key format may differ between vendors — confirm property_composite_key generation works correctly after swap
- Any job-level cached fields (property counts, last processed dates) will need to refresh after new data load
- Check if `job_assignments` / `job_responsibilities` need clearing (inspector property assignments tied to old BRT composite keys)
