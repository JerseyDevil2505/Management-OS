/**
 * MASKED SALES SERVICE (BRT-only)
 * ===============================
 * BRT ships up to ~4 prior sales per parcel in `property_records.prev_sales`
 * (shape: [{ date, price, source: 'brt_prev_sale_N' }]). When a good sale is
 * overwritten by a later junk transaction (e.g. a $1 deed-of-correction), the
 * good sale gets "masked" — it disappears from Sales Review (which keys off the
 * current sale's normalized value) and from the Sales Pool (which shows the most
 * recent sampling).
 *
 * This service:
 *   1. detectMaskedCandidates() — mines prev_sales for healthy older sales the
 *      user might want to surface, scoped to a date window.
 *   2. timeNormalizeUnmasked() — HPI time-adjusts an unmasked sale so it sorts
 *      and compares alongside real normalized sales (mirrors targetNormalization).
 *   3. saveUnmaskedSales() / clearUnmaskedSale() — persist the user's choice to
 *      property_market_analysis.unmasked_sale (singular, one per parcel).
 *
 * Idempotent: storage is a single JSONB column per parcel, so re-running the
 * scan or re-saving simply overwrites — never duplicates.
 */

import { supabase, parseDateLocal } from './supabaseClient';

// Default detection thresholds.
export const MASKED_DEFAULTS = {
  priceThreshold: 50000, // a prior sale must clear this to be a candidate
  junkPriceCeiling: 1000, // current sale at/below this is "junk"
  fromYear: 2012, // Sales Review floor
  normalizeToYear: 2025,
};

const getYear = (dateStr) => {
  if (!dateStr) return null;
  const d = parseDateLocal(dateStr);
  return d ? d.getFullYear() : null;
};

/**
 * Build an HPI multiplier function for a county. Returns null if no HPI data.
 */
export async function loadHpiMultiplier(county, normalizeToYear = MASKED_DEFAULTS.normalizeToYear) {
  const { data: hpiData, error } = await supabase
    .from('county_hpi_data')
    .select('observation_year, hpi_index')
    .ilike('county_name', county || 'Bergen')
    .order('observation_year');

  if (error || !hpiData || hpiData.length === 0) return null;

  const maxHPIYear = Math.max(...hpiData.map(h => h.observation_year));
  return (saleYear) => {
    if (!saleYear) return 1.0;
    if (saleYear > maxHPIYear) return 1.0;
    const effectiveTargetYear = normalizeToYear > maxHPIYear ? maxHPIYear : normalizeToYear;
    if (saleYear === effectiveTargetYear) return 1.0;
    const saleYearData = hpiData.find(h => h.observation_year === saleYear);
    const targetYearData = hpiData.find(h => h.observation_year === effectiveTargetYear);
    if (!saleYearData || !targetYearData) return 1.0;
    return (targetYearData.hpi_index || 100) / (saleYearData.hpi_index || 100);
  };
}

/**
 * Time-normalize a single unmasked sale via HPI.
 * @returns { hpi_multiplier, values_norm_time }
 */
export function timeNormalizeUnmasked(sale, hpiMultiplierFn, normalizeToYear = MASKED_DEFAULTS.normalizeToYear) {
  const price = Number(sale?.sales_price ?? sale?.price) || 0;
  const dateStr = sale?.sales_date ?? sale?.date;
  const saleYear = getYear(dateStr);
  if (!price || !saleYear || !hpiMultiplierFn) {
    return { hpi_multiplier: 1.0, values_norm_time: price };
  }
  const mult = hpiMultiplierFn(saleYear);
  return { hpi_multiplier: mult, values_norm_time: Math.round(price * mult) };
}

/**
 * Detect masked-sale candidates from a property list.
 *
 * @param {Array} properties - enriched property rows (must include prev_sales,
 *   sales_price, sales_date, sales_nu, property_composite_key, unmasked_sale?)
 * @param {Object} opts
 *   - fromYear:    earliest prior-sale year to consider (Sales Review = 2012)
 *   - toDate:      latest prior-sale date to consider (Sales Pool = window end). Optional.
 *   - priceThreshold: minimum prior-sale price to qualify
 *   - vendorType:  must be 'BRT' (Microsystems has no prev_sales feed yet)
 *   - mainCardOnly: default true — only scan main cards
 * @returns Array<{
 *   property_composite_key, property_block, property_lot, property_qualifier, property_location,
 *   current: { sales_price, sales_date, sales_nu },
 *   candidates: Array<{ sales_price, sales_date, source }>,  // healthy priors, newest first
 *   best: { sales_price, sales_date, source },               // top candidate
 *   currentIsJunk: boolean,
 *   autoSuggest: boolean,                                     // pre-check in UI
 *   alreadyUnmasked: { sales_price, sales_date } | null,
 *   alreadySkipped: boolean
 * }>
 */
export function detectMaskedCandidates(properties, opts = {}) {
  const {
    fromYear = MASKED_DEFAULTS.fromYear,
    toDate = null,
    priceThreshold = MASKED_DEFAULTS.priceThreshold,
    junkPriceCeiling = MASKED_DEFAULTS.junkPriceCeiling,
    vendorType = 'BRT',
    mainCardOnly = true,
  } = opts;

  if (vendorType !== 'BRT' || !Array.isArray(properties)) return [];

  const toTime = toDate ? parseDateLocal(toDate)?.getTime() ?? null : null;
  const out = [];

  for (const p of properties) {
    if (mainCardOnly && p._isMainCard === false) continue;

    const prev = Array.isArray(p.prev_sales) ? p.prev_sales : null;
    if (!prev || prev.length === 0) continue;

    const candidates = prev
      .map(s => ({
        sales_price: Number(s.price) || 0,
        sales_date: s.date || null,
        sales_book: s.book || null,
        sales_page: s.page || null,
        source: s.source || null,
      }))
      .filter(s => {
        if (!s.sales_price || s.sales_price < priceThreshold) return false;
        if (!s.sales_date) return false;
        const yr = getYear(s.sales_date);
        if (!yr || yr < fromYear) return false;
        if (toTime != null) {
          const t = parseDateLocal(s.sales_date)?.getTime() ?? null;
          if (t == null || t > toTime) return false;
        }
        return true;
      })
      .sort((a, b) => (parseDateLocal(b.sales_date)?.getTime() || 0) - (parseDateLocal(a.sales_date)?.getTime() || 0));

    if (candidates.length === 0) continue;

    const currentPrice = Number(p.sales_price) || 0;
    // A sale is "masked" when the CURRENT sale is a junk dollar-sale (e.g. a $1
    // deed-of-correction) sitting on top of a healthy older sale. We gate on
    // price — BRT NU codes are unreliable/withheld, so a $600k sale with an NU
    // flag is NOT what we're hunting here.
    const currentIsJunk = currentPrice <= junkPriceCeiling;
    const alreadyUnmasked = p.unmasked_sale
      ? { sales_price: p.unmasked_sale.sales_price, sales_date: p.unmasked_sale.sales_date }
      : null;
    const alreadySkipped = p.masked_review_skipped === true;

    // Only surface true masked candidates (junk current sale) — plus any parcel
    // already unmasked, so the user can review/clear that decision.
    if (!currentIsJunk && !alreadyUnmasked) continue;

    out.push({
      property_composite_key: p.property_composite_key,
      property_block: p.property_block,
      property_lot: p.property_lot,
      property_qualifier: p.property_qualifier || '',
      property_location: p.property_location,
      current: {
        sales_price: currentPrice,
        sales_date: p.sales_date || null,
        sales_nu: p.sales_nu || null,
      },
      candidates,
      best: candidates[0],
      currentIsJunk,
      autoSuggest: currentIsJunk, // pre-check rows where current sale is junk
      alreadyUnmasked,
      alreadySkipped,
    });
  }

  return out;
}

// Marks an override as ours, so clearing an unmask never reverts a sale that
// was promoted by the Detailed grid's swap-hidden-sale UI.
export const UNMASK_PROMOTED_FROM = 'masked_scan';

/**
 * Persist a batch of unmask decisions.
 *
 * An unmask *promotes* the recovered prior into property_records — the same
 * operation as DetailedAppraisalGrid's swap-hidden-sale and the updater's
 * "Keep Old". Once promoted it is simply the parcel's sale, so normalization,
 * the sales-period gate and the land/CME analyses all read it without knowing
 * unmasking exists. sales_override protects it from the next file upload (see
 * the respect_sales_override trigger), and sales_override_meta.original_sale
 * carries the displaced junk deed so the decision can be reversed.
 *
 * @param {string} jobId
 * @param {Array<{ property_composite_key, sale, userId, skipped? }>} decisions
 *   sale = { sales_price, sales_date, sales_nu?, sales_book?, sales_page?,
 *            source, hpi_multiplier, values_norm_time }
 *   A null/absent sale clears the unmask and restores the displaced sale.
 *   skipped is only written when the caller passes an explicit boolean, so
 *   callers that only manage unmasks (the post-upload re-check) leave it alone.
 */
export async function saveUnmaskedSales(jobId, decisions) {
  if (!jobId || !Array.isArray(decisions) || decisions.length === 0) {
    return { saved: 0, cleared: 0, skipped: 0, changed: 0 };
  }

  // Read the sale each parcel currently carries so a promotion can record
  // exactly what it displaced, and a reversal knows what to put back.
  const keys = decisions.map(d => d.property_composite_key).filter(Boolean);
  const currentByKey = new Map();
  for (let i = 0; i < keys.length; i += 500) {
    const slice = keys.slice(i, i + 500);
    const { data, error } = await supabase
      .from('property_records')
      .select('property_composite_key, sales_price, sales_date, sales_nu, sales_book, sales_page, sales_override, sales_override_meta')
      .eq('job_id', jobId)
      .in('property_composite_key', slice);
    if (error) {
      console.error('saveUnmaskedSales: could not load current sales', error);
      continue;
    }
    (data || []).forEach(r => currentByKey.set(r.property_composite_key, r));
  }

  let saved = 0;
  let cleared = 0;
  let skipped = 0;

  for (const d of decisions) {
    const key = d.property_composite_key;
    if (!key) continue;

    const current = currentByKey.get(key) || {};
    const ourOverride = current.sales_override === true
      && current.sales_override_meta?.promoted_from === UNMASK_PROMOTED_FROM;

    const payload = d.sale
      ? {
          sales_price: d.sale.sales_price,
          sales_date: d.sale.sales_date,
          sales_nu: d.sale.sales_nu ?? null,
          source: d.sale.source ?? null,
          hpi_multiplier: d.sale.hpi_multiplier ?? null,
          values_norm_time: d.sale.values_norm_time ?? null,
          unmasked_at: new Date().toISOString(),
          unmasked_by: d.userId ?? null,
        }
      : null;

    let salesPatch = null;

    if (payload) {
      // Re-unmasking an already-promoted parcel must keep pointing at the real
      // file sale, not at the prior we promoted last time.
      const displaced = ourOverride
        ? current.sales_override_meta.original_sale
        : {
            date: current.sales_date ?? null,
            price: current.sales_price ?? null,
            nu: current.sales_nu ?? null,
            book: current.sales_book ?? null,
            page: current.sales_page ?? null,
          };

      salesPatch = {
        sales_date: d.sale.sales_date ?? null,
        sales_price: d.sale.sales_price ?? null,
        sales_nu: d.sale.sales_nu ?? null,
        sales_book: d.sale.sales_book ?? null,
        sales_page: d.sale.sales_page ?? null,
        sales_override: true,
        sales_override_meta: {
          promoted_from: UNMASK_PROMOTED_FROM,
          source_entry: d.sale.source ?? null,
          original_sale: displaced,
          decided_at: new Date().toISOString(),
          decided_by: d.userId ?? 'user',
        },
      };
    } else if (ourOverride) {
      const orig = current.sales_override_meta.original_sale || {};
      salesPatch = {
        sales_date: orig.date ?? null,
        sales_price: orig.price ?? null,
        sales_nu: orig.nu ?? null,
        sales_book: orig.book ?? null,
        sales_page: orig.page ?? null,
        sales_override: false,
        sales_override_meta: null,
      };
    }

    if (salesPatch) {
      const { error: srErr } = await supabase
        .from('property_records')
        .update(salesPatch)
        .eq('job_id', jobId)
        .eq('property_composite_key', key);
      if (srErr) {
        console.error('saveUnmaskedSales: promote/revert failed for', key, srErr);
        continue;
      }
    }

    const updates = { unmasked_sale: payload, updated_at: new Date().toISOString() };
    if (typeof d.skipped === 'boolean') updates.masked_review_skipped = d.skipped;
    // The promoted sale is a real sale now, so it carries a real normalized
    // value. Reverting puts the junk deed back, which must not keep one.
    if (payload) updates.values_norm_time = payload.values_norm_time ?? null;
    else if (salesPatch) updates.values_norm_time = null;

    const { error } = await supabase
      .from('property_market_analysis')
      .update(updates)
      .eq('job_id', jobId)
      .eq('property_composite_key', key);

    if (error) {
      console.error('saveUnmaskedSales failed for', key, error);
      continue;
    }
    if (payload) saved++;
    else if (d.skipped === true) skipped++;
    else cleared++;
  }

  return { saved, cleared, skipped, changed: saved + cleared + skipped };
}

/**
 * Clear a single parcel's unmasked sale.
 */
export async function clearUnmaskedSale(jobId, compositeKey) {
  return saveUnmaskedSales(jobId, [{ property_composite_key: compositeKey, sale: null }]);
}

// Resolve the effective current sale for a changed parcel given the user's
// Keep Old / Keep New / Keep Both / Reject decision in the upload review.
const effectiveCurrentFromChange = (change, decision) => {
  const d = (decision || 'Keep New (default)').toString();
  const oldPrice = Number(change?.differences?.sales_price?.old) || 0;
  const newPrice = Number(change?.differences?.sales_price?.new) || 0;
  // "Keep Old" and "Reject" leave (or revert to) the old sale as current.
  if (d.startsWith('Keep Old') || d.startsWith('Reject')) return oldPrice;
  // Keep New / Keep New (default) / Keep Both → the new sale is current.
  return newPrice;
};

/**
 * Post-upload masked-sale re-check (BRT only). Runs inside the file-upload flow
 * (before the job loads) off this upload's own sales changes — no expensive
 * prev_sales scan. Classifies two directions:
 *
 *   stale   — a parcel that has an unmasked_sale but whose effective current
 *             sale is now valid (> junk ceiling). The recent real sale makes the
 *             recovered prior unnecessary → clear it.
 *   newMasks — a parcel where the user kept a junk dollar-sale (≤ ceiling) over a
 *             previously healthy sale → the good old sale just got masked → flag.
 *
 * @param {string} jobId
 * @param {Object} opts
 *   - salesChanges:  comparisonResults.details.salesChanges
 *   - salesDecisions: Map<compositeKey, decision>
 *   - vendorType:    must be 'BRT'
 * @returns {Promise<{ stale: string[], newMasks: Array<{key, block, lot, qualifier, location, oldPrice}> }>}
 */
export async function recheckMaskedAfterUpload(jobId, opts = {}) {
  const {
    salesChanges = [],
    salesDecisions = new Map(),
    vendorType = 'BRT',
    junkPriceCeiling = MASKED_DEFAULTS.junkPriceCeiling,
    priceThreshold = MASKED_DEFAULTS.priceThreshold,
  } = opts;

  const empty = { stale: [], newMasks: [] };
  if (vendorType !== 'BRT' || !jobId || !Array.isArray(salesChanges) || salesChanges.length === 0) {
    return empty;
  }

  const getDecision = (key) =>
    (salesDecisions instanceof Map ? salesDecisions.get(key) : salesDecisions?.[key]) || 'Keep New (default)';

  const changedKeys = salesChanges.map(c => c.property_composite_key).filter(Boolean);
  if (changedKeys.length === 0) return empty;

  // Which of the changed parcels currently carry an unmasked_sale marker?
  const unmaskedKeys = new Set();
  // Which still carry our promotion? The respect_sales_override trigger drops
  // the override when the upload brings a newer, valid, arm's-length sale — so
  // a marker without a matching override means the trigger already superseded
  // this unmask and the marker has to follow.
  const stillPromoted = new Set();
  // Supabase .in() caps out on huge lists; chunk to be safe.
  for (let i = 0; i < changedKeys.length; i += 500) {
    const slice = changedKeys.slice(i, i + 500);
    const { data, error } = await supabase
      .from('property_market_analysis')
      .select('property_composite_key, unmasked_sale')
      .eq('job_id', jobId)
      .in('property_composite_key', slice);
    if (error) {
      console.error('recheckMaskedAfterUpload load failed:', error);
      continue;
    }
    (data || []).forEach(r => { if (r.unmasked_sale) unmaskedKeys.add(r.property_composite_key); });

    const { data: srData, error: srError } = await supabase
      .from('property_records')
      .select('property_composite_key, sales_override, sales_override_meta')
      .eq('job_id', jobId)
      .in('property_composite_key', slice);
    if (srError) {
      console.error('recheckMaskedAfterUpload override load failed:', srError);
      continue;
    }
    (srData || []).forEach(r => {
      if (r.sales_override === true && r.sales_override_meta?.promoted_from === UNMASK_PROMOTED_FROM) {
        stillPromoted.add(r.property_composite_key);
      }
    });
  }

  const stale = [];
  const newMasks = [];

  for (const c of salesChanges) {
    const key = c.property_composite_key;
    if (!key) continue;
    const decision = getDecision(key);
    const effPrice = effectiveCurrentFromChange(c, decision);
    const oldPrice = Number(c?.differences?.sales_price?.old) || 0;

    if (unmaskedKeys.has(key)) {
      // The trigger already decided whether the promotion survives this upload.
      // If it dropped the override, the marker is stale — clearing it only
      // removes the marker, since property_records is already correct.
      if (!stillPromoted.has(key)) stale.push(key);
    } else if (effPrice > 0 && effPrice <= junkPriceCeiling && oldPrice >= priceThreshold) {
      // Kept a junk dollar-sale over a healthy prior → newly masked.
      newMasks.push({
        key,
        block: c.property_block,
        lot: c.property_lot,
        qualifier: c.property_qualifier || '',
        location: c.property_location,
        oldPrice,
      });
    }
  }

  return { stale, newMasks };
}
