# Farmland Component — Planning Doc

> Status: **idea / pre-design**. Nothing here is built yet. This is the parking
> lot for everything we want the future Farmland Component to do, so we don't
> lose the thread before talking to more assessors who actually have farms in
> their districts.

## Why this exists

Today, "farm sales mode" in Search & Results / Detailed / Appellant Evidence
does two things:

1. Allows NU code **33** (farmland / exempt / abated) as an acceptable comp.
2. When a property is part of a `_pkg.is_farm_package` group, sums the farm
   parcels' lot acreage for display and pairing.

That works as a **safe, simple, deceptive-but-useful approximation**. It is
explicitly *not* a true model of how a farm operation actually exists in the
real world. Specifically:

- **Code 33 is overloaded.** It covers qualified farmland *and* currently
  exempt or abated property. So in farm mode we currently let in some sales
  that are not actually farm sales.
- **Farm packaging is grouping-by-deed.** We rely on `sales_book` +
  `sales_page` + `sales_date` to know what parcels traded together. That works
  for a single-deed transaction inside one town, but…
- **Farms can span more than one 3A/3B pair.** A single farm operation often
  has one 3A homestead + multiple standalone 3Bs. They do usually share the
  same book/page/date when they sell, which is why the current heuristic
  mostly works — but ownership rollups would be more honest.
- **Farms can span more than one town.** Cross-town farm operations are
  invisible to a town-scoped job today.
- **County conventions vary.**
  - **Salem County** mostly uses traditional `QFARM` qualifier tagging plus
    book/page/date deed pairing.
  - **Hunterdon County** uses `Q####` farm operation identifiers (the number
    itself groups the parcels that make up a single farm operation). This is
    very clever and basically a county-scoped operation key.
- **Acreage source varies by vendor.** BRT jobs require us to *calculate* lot
  size from `landur_1..6` × `landurunits_1..6`, which is why we store the
  result in `market_manual_lot_acre` / `market_manual_lot_sf` rather than
  trusting `asset_lot_acre`. Microsystems behaves differently. The Farmland
  Component has to abstract this away.

## Vision

A first-class **Farmland Component** that becomes the source of truth for what
"a farm" actually is in a job, and that **drives** farm sales mode (rather
than farm sales mode being a thin filter).

### Core capabilities

1. **Application import**
   - Import the farmland assessment application (FA-1 / SR-3A / etc.).
   - Support PDF + scan workflows.
   - Decode farmer handwriting where possible (OCR + a manual review queue —
     handwriting in this domain is genuinely awful, this needs human-in-the-
     loop).

2. **Three-way acreage reconciliation**
   - Acreage from MOD-IV (state list).
   - Acreage from CAMA (BRT or Microsystems).
   - Acreage from the application.
   - Surface mismatches with severity flags so the assessor can resolve them
     once and have everyone agree.

3. **Soil-type identification**
   - Pull soil class from the application or USDA SSURGO overlay.
   - Help classify between cropland, pasture, woodland, wetland, etc.
   - Tie into NJ farmland values per soil class.

4. **Annual farmland rates**
   - Maintain the published per-acre values by class, by year.
   - Apply rates to land segments to compute farmland-assessed value.
   - Keep historical rates so prior years can be re-checked.

5. **Pair / depair (the truth layer)**
   - Manual editable grouping that overrides any auto-derived grouping.
   - Supports:
     - **Deed grouping** (same book/page/date).
     - **Q-number grouping** (Hunterdon-style operation key).
     - **Owner rollup** (parcels under same owner / entity).
     - **Manual override** ("these 7 parcels are one farm, period").
   - This is what farm sales mode should consume, not the current heuristic.

6. **Cross-town awareness**
   - At minimum: warn when an owner has farmland in another town we also have
     loaded. Long-term: model the operation across town boundaries.

7. **Vendor input helpers**
   - Tools to push/import correct values back into BRT and Microsystems input
     formats so the assessor can update the production CAMA. (This is where
     this could become a big value-add for assessors who have farm-heavy
     districts.)

### Future / nice-to-haves

- Aerial imagery overlay (NJ NAIP / county GIS) tied to each farm parcel.
- Wetlands / preservation overlays.
- Rollback tax calculator (when farmland comes out of qualified status).
- "Farm operation" entity in Supabase that survives between jobs / years and
  can carry annual application history.
- Generate the farmland app pre-fill from prior year for the assessor to hand
  back to the farmer.

## Schema sketch (for later)

Probably something like:

- `farm_operations`
  - `id`, `job_id`, `organization_id`
  - `name` / `farmer_name`
  - `q_number` (Hunterdon-style operation key, nullable)
  - `cross_town` (bool)
  - `notes`
- `farm_operation_parcels`
  - `farm_operation_id`, `property_composite_key`
  - `role` (`homestead` | `standalone_3b` | `auxiliary` | …)
  - `included_in_sale_pairing` (bool)
- `farm_applications`
  - `farm_operation_id`, `tax_year`
  - parsed application fields
  - source PDF reference
  - reviewer status
- `farmland_rates`
  - `tax_year`, `soil_class`, `per_acre_value`

## Open questions for the assessor conversations

1. Do you think of farmland by **owner** first or by **operation** first? (In
   Hunterdon, the `Q####` answer is "by operation". In Salem we need to ask.)
2. How often do you have farmland that **literally crosses a town line**?
   What's the workflow today?
3. How do you currently reconcile MOD-IV vs CAMA vs application acreage?
4. How much does handwriting decoding actually slow you down each cycle?
5. Would you want to push corrected values back into your CAMA from this
   tool, or just consume the report?
6. What soil-class info do you actually trust — application, USDA SSURGO, or
   field knowledge?
7. Do you want this to be **municipality-scoped** (per-job, like the rest of
   the app today) or **county-scoped** from the start?

## What we are NOT changing right now

- Current `_pkg` farm packaging (deed grouping by book/page/date).
- Current `farm sales mode` toggle behavior in Search & Results, Detailed,
  AppealLog, and the Appellant Evidence panel.
- `BASE_ACCEPTABLE_NU` in `appellantCompEvaluator.js` — `33` stays farm-mode
  acceptable, `32` stays in the base set, etc.

When the Farmland Component lands, **its** pair/depair truth becomes the
input that farm sales mode reads from. Until then, we keep the safe,
deceptive-but-useful approximation we have today.
