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

// NU codes considered "junk" / non-usable (mirrors targetNormalization gating).
const JUNK_NU_CODES = new Set(['25', '26', '07', '7', '32', '36', '10', '33']);

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

const isJunkNu = (nu) => {
  const code = (nu == null ? '' : String(nu)).trim();
  if (code === '') return false;
  return JUNK_NU_CODES.has(code);
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
 *   alreadyUnmasked: { sales_price, sales_date } | null
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
    const currentIsJunk = currentPrice <= junkPriceCeiling || isJunkNu(p.sales_nu);

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
      alreadyUnmasked: p.unmasked_sale
        ? { sales_price: p.unmasked_sale.sales_price, sales_date: p.unmasked_sale.sales_date }
        : null,
    });
  }

  return out;
}

/**
 * Persist a batch of unmask decisions.
 * @param {string} jobId
 * @param {Array<{ property_composite_key, sale, userId }>} decisions
 *   sale = { sales_price, sales_date, sales_nu?, source, hpi_multiplier, values_norm_time }
 *   A null/absent sale clears the unmask (sets column to null).
 */
export async function saveUnmaskedSales(jobId, decisions) {
  if (!jobId || !Array.isArray(decisions) || decisions.length === 0) {
    return { saved: 0, cleared: 0 };
  }

  let saved = 0;
  let cleared = 0;

  for (const d of decisions) {
    const key = d.property_composite_key;
    if (!key) continue;

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

    const { error } = await supabase
      .from('property_market_analysis')
      .update({ unmasked_sale: payload, updated_at: new Date().toISOString() })
      .eq('job_id', jobId)
      .eq('property_composite_key', key);

    if (error) {
      console.error('saveUnmaskedSales failed for', key, error);
      continue;
    }
    if (payload) saved++; else cleared++;
  }

  return { saved, cleared };
}

/**
 * Clear a single parcel's unmasked sale.
 */
export async function clearUnmaskedSale(jobId, compositeKey) {
  return saveUnmaskedSales(jobId, [{ property_composite_key: compositeKey, sale: null }]);
}
