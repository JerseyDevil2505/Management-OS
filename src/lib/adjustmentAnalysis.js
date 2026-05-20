// src/lib/adjustmentAnalysis.js
//
// Adjustment Analysis engine — KISS grid-performance test.
//
// Question this answers: "Does the user's grid, applied as a whole, produce
// predictions that match the bracket's actual sales?"
//
// This is NOT a coefficient-derivation tool. We never estimate a regression,
// never propose an adjustment value, never strip CAMA land. The grid IS the
// hypothesis. The data is the test. The output is a hit rate.
//
// Engine in one paragraph: For each bracket, compute a median-baseline
// property and a median baseline price. For each sale, apply the user's
// grid to the sale's deviations from baseline to produce a predicted price.
// Count a sale as a "hit" when |actual − predicted| ≤ 10% of the actual
// sale price (USPAP-aligned individual-adjustment tolerance). Bracket
// verdict = hit rate banded green/yellow/red. Per-attribute cell color =
// whether sales whose deviation on THAT attribute is large also have
// larger prediction errors (diagnostic only — never prescriptive).
//
// Carry-forward from the deleted audit/study files:
//   - filterQualifiedSales (vetted vs all-allowable, NU codes, class, condo)
//   - mode-aware price field (vetted = values_norm_time, all = sales_price)
//     for the response variable; bracket assignment ALWAYS uses sales_price
//   - lot-size active-method detection (skip inactive lot rows everywhere)
//   - vendor-branched effective age via asset_effective_age
//   - extractor map with `pending` flag for unfinished rows

import {
  STUDY_DEFAULT_SALES_CODES,
  normalizeSalesCode,
} from './salesCodes';
import { buildConditionRanker } from './conditionRanking';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------
export const ANALYSIS_FLOOR = 10;        // below this, can't verify
export const ANALYSIS_COMFORTABLE = 25;  // at/above, fully trusted band
export const HIT_TOLERANCE = 0.10;       // ±10% of sale price = a hit
export const HIT_RATE_GREEN = 0.70;
export const HIT_RATE_YELLOW = 0.50;
export const ATTR_DRIFT_YELLOW = 0.05;   // 5% of bracket median price
export const ATTR_DRIFT_RED = 0.10;      // 10% of bracket median price
export const BRACKET_DRIFT_YELLOW = 0.05; // median signed error vs bracket median price

// ---------------------------------------------------------------------------
// CME bracket schedule — keep in sync with AdjustmentsTab.CME_BRACKETS
// ---------------------------------------------------------------------------
export const CME_BRACKETS = [
  { min: 0,        max: 99999,    label: '$0 – $99,999',         shortLabel: '$0-$99K' },
  { min: 100000,   max: 199999,   label: '$100,000 – $199,999',  shortLabel: '$100K-$199K' },
  { min: 200000,   max: 299999,   label: '$200,000 – $299,999',  shortLabel: '$200K-$299K' },
  { min: 300000,   max: 399999,   label: '$300,000 – $399,999',  shortLabel: '$300K-$399K' },
  { min: 400000,   max: 499999,   label: '$400,000 – $499,999',  shortLabel: '$400K-$499K' },
  { min: 500000,   max: 749999,   label: '$500,000 – $749,999',  shortLabel: '$500K-$749K' },
  { min: 750000,   max: 999999,   label: '$750,000 – $999,999',  shortLabel: '$750K-$999K' },
  { min: 1000000,  max: 1499999,  label: '$1.0M – $1.499M',      shortLabel: '$1M-$1.5M' },
  { min: 1500000,  max: 1999999,  label: '$1.5M – $1.999M',      shortLabel: '$1.5M-$2M' },
  { min: 2000000,  max: 99999999, label: 'Over $2M',             shortLabel: 'Over $2M' },
];

export function assignBracket(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return -1;
  for (let i = 0; i < CME_BRACKETS.length; i++) {
    if (p >= CME_BRACKETS[i].min && p <= CME_BRACKETS[i].max) return i;
  }
  return -1;
}

// Mode-aware dependent variable. EVERYTHING downstream — baseline price,
// predicted-vs-actual error, hit tolerance, drill-in card prose — uses
// dependentValue(). Only assignBracket() uses bracketAssignmentPrice().
//
// Vetted mode: dependent = values_norm_time (time-adjusted). Required so
// the hit test isn't fighting decade-old market drift the normalization
// workflow specifically removed.
// All-allowable mode: dependent = raw sales_price.
//
// Bracket assignment always uses raw sales_price in both modes — the
// bracket question is "where did this house physically transact," which
// is always the actual sale price, never a normalized number.
function dependentValue(sale, mode) {
  const v = mode === 'vetted' ? Number(sale.values_norm_time) : Number(sale.sales_price);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function bracketAssignmentPrice(sale) {
  const v = Number(sale.sales_price);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const NUM = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// Grid attribute map — extractor per row, with `pending` for not-yet-wired
// rows. Keys MUST match `adjustment_id` values stored in job_adjustment_grid.
//
// `applyType` shapes how the grid value combines with quantity:
//   per_sqft / per_acre / per_ff / count / flat / flat_per_year → grid × delta
//   percent → grid × delta (rank-step semantics, matches CME convention)
//
// `kind`:
//   continuous → any real-valued quantity
//   count      → integer/half-step counts
//   binary     → 0/1 presence flag
// ---------------------------------------------------------------------------
export const GRID_ATTRIBUTE_MAP = {
  living_area: {
    label: 'Living Area',
    kind: 'continuous',
    applyType: 'per_sqft',
    quantityUnit: 'sf',
    extract: (p) => NUM(p.asset_sfla),
  },
  lot_size_sf: {
    label: 'Lot Size (SF)',
    kind: 'continuous',
    applyType: 'per_sqft',
    quantityUnit: 'sf',
    extract: (p) => {
      const sf = NUM(p.asset_lot_sf) ?? NUM(p.market_manual_lot_sf);
      if (sf && sf > 0) return sf;
      const acre = NUM(p.asset_lot_acre)
        ?? NUM(p.market_manual_lot_acre)
        ?? NUM(p.market_manual_acre)
        ?? NUM(p.calculated_lot_acre);
      if (acre && acre > 0) return acre * 43560;
      return null;
    },
  },
  lot_size_acre: {
    label: 'Lot Size (Acre)',
    kind: 'continuous',
    applyType: 'per_acre',
    quantityUnit: 'acre',
    extract: (p) => {
      const acre = NUM(p.asset_lot_acre)
        ?? NUM(p.market_manual_lot_acre)
        ?? NUM(p.market_manual_acre)
        ?? NUM(p.calculated_lot_acre);
      if (acre && acre > 0) return acre;
      const sf = NUM(p.asset_lot_sf) ?? NUM(p.market_manual_lot_sf);
      if (sf && sf > 0) return sf / 43560;
      return null;
    },
  },
  lot_size_ff: {
    label: 'Lot Size (FF)',
    kind: 'continuous',
    applyType: 'per_ff',
    quantityUnit: 'ft',
    extract: (p) => NUM(p.asset_lot_frontage) ?? NUM(p.market_manual_lot_ff),
  },

  // ---------------------------------------------------------------------------
  // Effective Age (NOT chronological age, NOT asset_year_built).
  //
  // Per Copilot OS guide §5 (the EFA conversion chain):
  //   BRT          → asset_effective_age is stored as a calendar year.
  //   Microsystems → asset_effective_age is stored as (yearPrior − age),
  //                  which also looks like a year. Conversion back to age
  //                  is the same arithmetic: age = referenceYear − stored.
  // Source-of-truth: MarketDataTab.jsx (`getCalculatedValues` / `getCurrentEFA`).
  //
  // DO NOT "simplify" this to asset_year_built — that would break effective-
  // age adjustments on every renovated property in the job. The vendor branch
  // is preserved even though arithmetic is currently identical, so future
  // vendor changes are explicit, not implicit.
  //
  // Key stays `year_built` because the grid row's adjustment_id is `year_built`.
  // ---------------------------------------------------------------------------
  year_built: {
    label: 'Effective Age',
    kind: 'continuous',
    applyType: 'flat_per_year',
    quantityUnit: 'yrs',
    extract: (p, ctx) => {
      const stored = NUM(p.asset_effective_age);
      if (stored == null) return null;
      const vendor = ctx?.vendorType || 'BRT';
      const ref = ctx?.referenceYear || new Date().getFullYear();
      let age;
      if (vendor === 'Microsystems') age = ref - stored;
      else age = ref - stored;
      if (!Number.isFinite(age) || age < 0 || age > 200) return null;
      return age;
    },
  },

  // Bedrooms — both vendors normalize into asset_bedrooms (BRT BEDTOT,
  // Microsystems "Total Bedrms"). Verified in data-pipeline processors.
  bedrooms: {
    label: 'Bedrooms',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'beds',
    extract: (p) => NUM(p.asset_bedrooms),
  },

  // Bathrooms — both vendors normalize into total_baths_calculated via
  // calculateTotalBaths() in data-pipeline processors. Authoritative
  // weighted count; asset_bathrooms is a fallback only.
  bathrooms: {
    label: 'Bathrooms',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'baths',
    extract: (p) => NUM(p.total_baths_calculated) ?? NUM(p.asset_bathrooms),
  },

  fireplaces: {
    label: 'Fireplaces',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'fp',
    extract: (p) => NUM(p.fireplace_count),
  },
  basement: {
    label: 'Basement',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => {
      const a = NUM(p.basement_area);
      if (a != null) return a > 0 ? 1 : 0;
      if (typeof p.asset_basement === 'string') {
        const s = p.asset_basement.trim().toUpperCase();
        if (s === '' || s === 'NO' || s === 'NONE') return 0;
        return 1;
      }
      return null;
    },
  },
  garage: {
    label: 'Garage (attached)',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'cars',
    extract: (p) => {
      const a = NUM(p.garage_area);
      if (a == null) return null;
      if (a <= 0) return 0;
      if (a <= 399) return 1;
      if (a <= 799) return 2;
      if (a <= 999) return 3;
      return 4;
    },
  },
  finished_basement: {
    label: 'Finished Basement',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.fin_basement_area) > 0 ? 1 : 0),
  },
  ac: {
    label: 'AC',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.ac_area) > 0 ? 1 : 0),
  },
  det_garage: {
    label: 'Det Garage',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'cars',
    extract: (p) => {
      const a = NUM(p.det_garage_area);
      if (a == null) return null;
      if (a <= 0) return 0;
      if (a <= 399) return 1;
      if (a <= 799) return 2;
      if (a <= 999) return 3;
      return 4;
    },
  },
  deck:           { label: 'Deck',           kind: 'binary', applyType: 'flat', quantityUnit: 'present', extract: (p) => (NUM(p.deck_area) > 0 ? 1 : 0) },
  patio:          { label: 'Patio',          kind: 'binary', applyType: 'flat', quantityUnit: 'present', extract: (p) => (NUM(p.patio_area) > 0 ? 1 : 0) },
  open_porch:     { label: 'Open Porch',     kind: 'binary', applyType: 'flat', quantityUnit: 'present', extract: (p) => (NUM(p.open_porch_area) > 0 ? 1 : 0) },
  enclosed_porch: { label: 'Enclosed Porch', kind: 'binary', applyType: 'flat', quantityUnit: 'present', extract: (p) => (NUM(p.enclosed_porch_area) > 0 ? 1 : 0) },
  pool:           { label: 'Pool',           kind: 'binary', applyType: 'flat', quantityUnit: 'present', extract: (p) => (NUM(p.pool_area) > 0 ? 1 : 0) },

  interior_condition: {
    label: 'Interior Condition',
    kind: 'continuous',
    applyType: 'percent',
    quantityUnit: 'rank',
    extract: (p, ctx) => {
      if (!ctx?.conditionRanker) return null;
      return ctx.conditionRanker(p.asset_int_cond, 'interior', { ncovrPct: p.net_condition_pct });
    },
  },
  exterior_condition: {
    label: 'Exterior Condition',
    kind: 'continuous',
    applyType: 'percent',
    quantityUnit: 'rank',
    extract: (p, ctx) => {
      if (!ctx?.conditionRanker) return null;
      return ctx.conditionRanker(p.asset_ext_cond, 'exterior', { ncovrPct: p.net_condition_pct });
    },
  },
};

export function isAttributeReady(attrId) {
  const entry = GRID_ATTRIBUTE_MAP[attrId];
  return !!entry && !entry.pending && typeof entry.extract === 'function';
}

// ---------------------------------------------------------------------------
// Active lot-size method detection — only ONE lot row is priced per job.
// If multiple have non-zero values, warn and pick the largest.
// ---------------------------------------------------------------------------
export const LOT_SIZE_METHOD_IDS = ['lot_size_sf', 'lot_size_acre', 'lot_size_ff'];

export function detectActiveLotSizeMethod(gridRows = []) {
  const totals = {};
  for (const id of LOT_SIZE_METHOD_IDS) {
    const row = gridRows.find((r) => r.adjustment_id === id);
    if (!row) { totals[id] = 0; continue; }
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const v = Number(row[`bracket_${i}`]);
      if (Number.isFinite(v)) sum += Math.abs(v);
    }
    totals[id] = sum;
  }
  const withValues = LOT_SIZE_METHOD_IDS.filter((id) => totals[id] > 0);
  if (withValues.length === 0) return { active: null, allWithValues: [], warning: null };
  if (withValues.length === 1) return { active: withValues[0], allWithValues: withValues, warning: null };
  const winner = withValues.slice().sort((a, b) => totals[b] - totals[a])[0];
  const warning =
    `Multiple lot-size methods have non-zero values (${withValues.join(', ')}). ` +
    `Treating "${winner}" as active (largest bracket totals). Review your grid — ` +
    `only one lot-size method should be priced.`;
  // eslint-disable-next-line no-console
  console.warn('[AdjustmentAnalysis] ' + warning);
  return { active: winner, allWithValues: withValues, warning };
}

function isInactiveLotMethod(attrId, ctx) {
  if (!LOT_SIZE_METHOD_IDS.includes(attrId)) return false;
  const active = ctx?.activeLotSizeMethod;
  if (!active) return true;
  return attrId !== active;
}

// ---------------------------------------------------------------------------
// Grid lookup — one row per adjustment_id, columns bracket_0..bracket_9
// ---------------------------------------------------------------------------
export function gridValueFor(gridRows, attrId, bracketIdx) {
  const row = gridRows.find((r) => r.adjustment_id === attrId);
  if (!row) return null;
  const v = row[`bracket_${bracketIdx}`];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Filter qualified sales — mode-aware. Recreated here so the deleted
// adjustmentStudy.js is no longer a dependency.
// ---------------------------------------------------------------------------
export function filterQualifiedSales(properties, opts = {}) {
  const {
    mode = 'vetted',
    salesDateStart,
    salesDateEnd,
    salesCodes = STUDY_DEFAULT_SALES_CODES,
    classFilter = ['2'],
    minPrice = 1000,
    excludeCondoChildren = true,
  } = opts;

  const startMs = salesDateStart ? new Date(salesDateStart).getTime() : -Infinity;
  const endMs = salesDateEnd ? new Date(salesDateEnd).getTime() : Infinity;
  const codeSet = new Set(salesCodes.map((c) => normalizeSalesCode(c)));
  const classSet = new Set(classFilter.map((c) => String(c).trim().toUpperCase()));

  return properties.filter((p) => {
    const cls = String(p.property_m4_class ?? '').trim().toUpperCase();
    if (classSet.size > 0 && !classSet.has(cls)) return false;
    if (excludeCondoChildren) {
      const q = String(p.property_qualifier ?? '').trim().toUpperCase();
      if (q.startsWith('C')) return false;
    }
    if (mode === 'vetted') {
      const nt = Number(p.values_norm_time);
      if (!Number.isFinite(nt) || nt <= 0) return false;
      if (p.sales_date) {
        const t = new Date(p.sales_date).getTime();
        if (Number.isFinite(t) && (t < startMs || t > endMs)) return false;
      }
      return true;
    }
    const price = Number(p.sales_price);
    if (!price || price < minPrice) return false;
    if (!p.sales_date) return false;
    const t = new Date(p.sales_date).getTime();
    if (!Number.isFinite(t) || t < startMs || t > endMs) return false;
    const nu = normalizeSalesCode(p.sales_nu);
    if (!codeSet.has(nu)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Sales-per-year diagnostic — kept for the pre-flight mini-chart
// ---------------------------------------------------------------------------
export function salesPerYear(qualifiedSales) {
  const counts = new Map();
  for (const p of qualifiedSales) {
    if (!p.sales_date) continue;
    const d = new Date(p.sales_date);
    if (!Number.isFinite(d.getTime())) continue;
    const y = d.getFullYear();
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
function median(arr) {
  const xs = arr.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function mean(arr) {
  const xs = arr.filter((x) => Number.isFinite(x));
  if (xs.length === 0) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

// ---------------------------------------------------------------------------
// Per-bracket baseline = median qty for each ready attribute (skipping
// inactive lot-size methods).
// ---------------------------------------------------------------------------
function computeBaselines(salesInBracket, ctx) {
  const baselines = {};
  for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
    if (!isAttributeReady(attrId)) continue;
    if (isInactiveLotMethod(attrId, ctx)) continue;
    const qs = salesInBracket.map((p) => def.extract(p, ctx)).filter((q) => q != null);
    baselines[attrId] = median(qs);
  }
  return baselines;
}

// ---------------------------------------------------------------------------
// Apply the grid to one sale → predicted_value.
//   predicted = baselinePrice + Σ gridValue × (saleQty − baselineQty)
// Skips: attributes where qty is missing on the sale, where baseline is null,
//        where the grid value is 0/null, or that are inactive lot methods.
// Returns { predicted, attrContribs: { attrId: { qty, baseline, delta, dollars } } }
// ---------------------------------------------------------------------------
function applyGridToSale(sale, bracketIdx, gridRows, baselines, baselinePrice, ctx) {
  let predicted = baselinePrice;
  const contribs = {};
  for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
    if (!isAttributeReady(attrId)) continue;
    if (isInactiveLotMethod(attrId, ctx)) continue;
    const grid = gridValueFor(gridRows, attrId, bracketIdx);
    if (grid == null || grid === 0) continue;
    const qty = def.extract(sale, ctx);
    if (qty == null) continue;
    const base = baselines[attrId];
    if (base == null) continue;
    const delta = qty - base;
    const dollars = grid * delta;
    predicted += dollars;
    contribs[attrId] = { qty, baseline: base, delta, dollars };
  }
  return { predicted, contribs };
}

// ---------------------------------------------------------------------------
// Verdict bands
// ---------------------------------------------------------------------------
function bracketVerdict(n, hitRate, medianSignedError, bracketMedianPrice) {
  if (n < ANALYSIS_FLOOR) {
    return { band: 'cant_verify', color: 'grey', label: "Can't verify" };
  }
  const limited = n < ANALYSIS_COMFORTABLE;
  let color;
  if (hitRate >= HIT_RATE_GREEN) color = 'green';
  else if (hitRate >= HIT_RATE_YELLOW) color = 'yellow';
  else color = 'red';

  // Demote a green to yellow if median signed error indicates systematic drift
  if (color === 'green'
      && bracketMedianPrice > 0
      && Math.abs(medianSignedError) > BRACKET_DRIFT_YELLOW * bracketMedianPrice) {
    color = 'yellow';
  }
  return {
    band: limited ? 'limited' : 'verified',
    color,
    label: limited ? 'Limited' : 'Verified',
  };
}

function attributeCellColor(splitHalves, bracketMedianPrice) {
  if (!splitHalves || !bracketMedianPrice) return 'grey';
  const { aboveAvgError, belowAvgError, hasSpread } = splitHalves;
  if (!hasSpread) return 'grey';
  const diff = Math.abs(aboveAvgError - belowAvgError);
  if (diff > ATTR_DRIFT_RED * bracketMedianPrice) return 'red';
  if (diff > ATTR_DRIFT_YELLOW * bracketMedianPrice) return 'yellow';
  return 'green';
}

// Split bracket sales into above-median-deviation and below-median-deviation
// halves on a single attribute, compute average signed error in each half.
function splitErrorByAttributeDeviation(samples, attrId) {
  const withQty = samples
    .filter((s) => s.qtyByAttr[attrId] != null && s.baselineByAttr[attrId] != null)
    .map((s) => ({
      dev: s.qtyByAttr[attrId] - s.baselineByAttr[attrId],
      error: s.error,
    }));
  if (withQty.length < ANALYSIS_FLOOR) return { hasSpread: false };
  const devs = withQty.map((r) => r.dev);
  const medDev = median(devs);
  const minDev = Math.min(...devs);
  const maxDev = Math.max(...devs);
  if (minDev === maxDev) return { hasSpread: false }; // no variation
  const above = withQty.filter((r) => r.dev > medDev).map((r) => r.error);
  const below = withQty.filter((r) => r.dev <= medDev).map((r) => r.error);
  if (above.length < 3 || below.length < 3) return { hasSpread: false };
  return {
    hasSpread: true,
    aboveAvgError: mean(above) ?? 0,
    belowAvgError: mean(below) ?? 0,
    nAbove: above.length,
    nBelow: below.length,
  };
}

// ---------------------------------------------------------------------------
// Analyze ONE bracket
// ---------------------------------------------------------------------------
function analyzeBracket(bracketIdx, allSales, gridRows, mode, ctx) {
  const bracket = CME_BRACKETS[bracketIdx];
  const inBracket = allSales.filter((p) => assignBracket(bracketAssignmentPrice(p)) === bracketIdx);
  const baselines = computeBaselines(inBracket, ctx);

  // Baseline price = median of the mode-aware dependent value.
  // This is also the price denominator used for all drift coloring — same
  // value space as the actual/predicted being compared.
  const dependentVals = inBracket
    .map((p) => dependentValue(p, mode))
    .filter((v) => v != null);
  const baselinePrice = median(dependentVals);
  const bracketMedianDependent = baselinePrice;

  if (inBracket.length < ANALYSIS_FLOOR || baselinePrice == null) {
    return {
      bracketIdx,
      bracket,
      n: inBracket.length,
      verdict: { band: 'cant_verify', color: 'grey', label: "Can't verify" },
      hitRate: null,
      hits: 0,
      message: `Only ${inBracket.length} qualified sales in this bracket — not enough to evaluate.`,
      baselines,
      baselinePrice,
      bracketMedianDependent,
      perAttribute: {},
    };
  }

  // Apply grid to every sale → samples with predicted, actual, error.
  // Hit tolerance is ±10% of the mode-aware dependent value (not raw sale
  // price) so vetted mode doesn't re-introduce time drift via the tolerance.
  const samples = [];
  for (const sale of inBracket) {
    const actual = dependentValue(sale, mode);
    if (actual == null) continue;
    const { predicted, contribs } = applyGridToSale(sale, bracketIdx, gridRows, baselines, baselinePrice, ctx);
    const error = actual - predicted;
    const tolDollars = HIT_TOLERANCE * actual;
    const hit = Math.abs(error) <= tolDollars;
    // Per-attribute snapshot for the cell-drift analysis below
    const qtyByAttr = {};
    const baselineByAttr = {};
    for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
      if (!isAttributeReady(attrId)) continue;
      if (isInactiveLotMethod(attrId, ctx)) continue;
      qtyByAttr[attrId] = def.extract(sale, ctx);
      baselineByAttr[attrId] = baselines[attrId];
    }
    samples.push({ actual, predicted, error, hit, contribs, qtyByAttr, baselineByAttr });
  }

  if (samples.length === 0) {
    return {
      bracketIdx, bracket, n: 0,
      verdict: { band: 'cant_verify', color: 'grey', label: "Can't verify" },
      hitRate: null, hits: 0, baselines, baselinePrice, bracketMedianDependent,
      perAttribute: {},
      message: 'No samples could be evaluated in this bracket.',
    };
  }

  const hits = samples.filter((s) => s.hit).length;
  const hitRate = hits / samples.length;
  const medianSignedError = median(samples.map((s) => s.error)) ?? 0;
  const meanSignedError = mean(samples.map((s) => s.error)) ?? 0;
  const verdict = bracketVerdict(samples.length, hitRate, medianSignedError, bracketMedianDependent || baselinePrice);

  // Per-attribute drift cells
  const perAttribute = {};
  for (const attrId of Object.keys(GRID_ATTRIBUTE_MAP)) {
    if (!isAttributeReady(attrId)) {
      perAttribute[attrId] = { color: 'pending' };
      continue;
    }
    if (isInactiveLotMethod(attrId, ctx)) {
      perAttribute[attrId] = { color: 'inactive' };
      continue;
    }
    // The grid value must be priced at this bracket — otherwise the attribute
    // isn't actually doing anything here and we can't meaningfully test it.
    const grid = gridValueFor(gridRows, attrId, bracketIdx);
    if (grid == null || grid === 0) {
      perAttribute[attrId] = { color: 'unpriced' };
      continue;
    }
    const split = splitErrorByAttributeDeviation(samples, attrId);
    const color = attributeCellColor(split, bracketMedianDependent || baselinePrice);
    perAttribute[attrId] = {
      color,
      ...(split.hasSpread ? {
        aboveAvgError: split.aboveAvgError,
        belowAvgError: split.belowAvgError,
        diff: split.aboveAvgError - split.belowAvgError,
        nAbove: split.nAbove,
        nBelow: split.nBelow,
      } : { noSpread: true }),
    };
  }

  return {
    bracketIdx,
    bracket,
    n: samples.length,
    nInBracket: inBracket.length,
    verdict,
    hitRate,
    hits,
    medianSignedError,
    meanSignedError,
    baselines,
    baselinePrice,
    bracketMedianDependent,
    perAttribute,
  };
}

// ---------------------------------------------------------------------------
// Top-level: run the analysis across all 10 brackets.
// ---------------------------------------------------------------------------
export function runAnalysis({ properties, gridRows, opts = {} }) {
  const qualified = filterQualifiedSales(properties, opts);
  if (qualified.length === 0) {
    return {
      ok: false,
      error: opts.mode === 'vetted'
        ? 'No qualified sales found. Vetted mode requires sales with values_norm_time > 0 — run time normalization in PreValuation first.'
        : 'No sales matched the filter (date range, NU codes, class).',
    };
  }

  const mode = opts.mode || 'vetted';
  const lotSize = detectActiveLotSizeMethod(gridRows);
  const vendorType = opts.jobData?.vendor_type
    || opts.jobData?.vendor_source
    || opts.vendorType
    || 'BRT';
  const endDate = opts.jobData?.end_date ? new Date(opts.jobData.end_date) : null;
  const referenceYear = (endDate && Number.isFinite(endDate.getTime()))
    ? endDate.getFullYear() - 1
    : new Date().getFullYear();

  const ctx = {
    conditionRanker: opts.jobData ? buildConditionRanker(opts.jobData) : null,
    activeLotSizeMethod: lotSize.active,
    vendorType,
    referenceYear,
  };

  // Bracket-assignment diagnostic — counts sales whose raw sales_price
  // lands in any bracket, so the UI can surface "no sales landed" cases.
  let landed = 0;
  for (const p of qualified) {
    const px = bracketAssignmentPrice(p);
    if (px == null) continue;
    if (assignBracket(px) >= 0) landed += 1;
  }

  const perBracket = CME_BRACKETS.map((_, idx) => analyzeBracket(idx, qualified, gridRows, mode, ctx));

  // Anchor = bracket with the most qualified sales among those clearing the floor
  const eligible = perBracket.filter((b) => b.verdict.band !== 'cant_verify');
  const anchorIdx = eligible.length > 0
    ? eligible.slice().sort((a, b) => b.n - a.n)[0].bracketIdx
    : -1;
  if (anchorIdx >= 0) perBracket[anchorIdx].isAnchor = true;

  return {
    ok: true,
    nQualifiedTotal: qualified.length,
    nLandedInAnyBracket: landed,
    perBracket,
    anchorIdx,
    lotSize,
    vendorType,
    referenceYear,
    mode,
    salesPerYear: salesPerYear(qualified),
  };
}

// ---------------------------------------------------------------------------
// Documentation block — copy-to-clipboard prose for the tax-board packet
// ---------------------------------------------------------------------------
function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toFixed(2)}`;
}

function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

export function buildDocumentationBlock(analysis, jobName = '') {
  if (!analysis?.ok) return '';
  const lines = [];
  lines.push(`Adjustment Analysis${jobName ? ' — ' + jobName : ''}`);
  lines.push('');
  lines.push(`Total qualified sales: ${analysis.nQualifiedTotal.toLocaleString()}`);

  const anchor = analysis.anchorIdx >= 0 ? analysis.perBracket[analysis.anchorIdx] : null;
  if (anchor) {
    lines.push('');
    lines.push(`Anchor bracket: ${anchor.bracket.label}`);
    lines.push(`${anchor.n} qualified sales. Grid produced predictions within 10% of sale price on ${pct(anchor.hitRate)} of sales. Median miss: ${fmtMoney(anchor.medianSignedError)}.`);
  }

  const others = analysis.perBracket.filter((b) => b.bracketIdx !== analysis.anchorIdx && b.verdict.band !== 'cant_verify');
  if (others.length > 0) {
    lines.push('');
    lines.push('Adjacent verified brackets:');
    for (const b of others) {
      const lim = b.verdict.band === 'limited' ? ', limited support' : '';
      lines.push(`  • ${b.bracket.label} (${b.n} sales${lim}) — ${pct(b.hitRate)} hit rate`);
    }
  }

  lines.push('');
  lines.push('Methodology: For each bracket, the assessor\'s adjustment grid is applied to every qualified sale to produce a predicted value. A sale is counted as accurately predicted when the predicted value falls within 10% of the actual sale price, consistent with USPAP guidance on individual adjustment tolerances. Brackets with fewer than ' + ANALYSIS_FLOOR + ' sales are reported as judgment calls and not evaluated. Brackets with ' + ANALYSIS_FLOOR + '-' + (ANALYSIS_COMFORTABLE - 1) + ' sales are evaluated with "limited support" flagging. Brackets with ' + ANALYSIS_COMFORTABLE + '+ sales receive full verification.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Structured export data for the PDF builder. Pure data; no rendering.
// jobMeta is { jobName, county, analysisDate (Date), jobId }.
// ---------------------------------------------------------------------------
function describeTypicalMiss(medianSignedError) {
  if (medianSignedError == null || !Number.isFinite(medianSignedError) || medianSignedError === 0) return '';
  const dir = medianSignedError > 0 ? 'low' : 'high';
  return `${fmtMoney(Math.abs(medianSignedError))} ${dir}`;
}

function formatBracketYears(salesPerYear) {
  if (!Array.isArray(salesPerYear) || salesPerYear.length === 0) return '';
  const ys = salesPerYear.map((s) => s.year).filter(Number.isFinite);
  if (ys.length === 0) return '';
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function buildAnalysisExportData(analysis, jobMeta = {}) {
  if (!analysis?.ok) return null;
  const today = jobMeta.analysisDate instanceof Date ? jobMeta.analysisDate : new Date();
  const isoStamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const idShort = jobMeta.jobId ? String(jobMeta.jobId).split('-')[0] : 'job';
  const runId = `${idShort}-${isoStamp}`;
  const dateLabel = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const yearRange = formatBracketYears(analysis.salesPerYear);

  // Per-bracket rows — only brackets that received any qualified sales.
  const rows = analysis.perBracket
    .filter((b) => (b.n || 0) > 0 || (b.nInBracket || 0) > 0)
    .map((b) => {
      const isAnchor = b.bracketIdx === analysis.anchorIdx;
      const isCantVerify = b.verdict.band === 'cant_verify';
      const verdictLabel = isAnchor
        ? 'Anchor'
        : (isCantVerify ? "Can't verify" : (b.verdict.band === 'limited' ? 'Limited' : 'Verified'));
      return {
        bracketIdx: b.bracketIdx,
        bracketLabel: b.bracket.label + (isAnchor ? ' (Anchor)' : ''),
        bracketLabelPlain: b.bracket.label,
        isAnchor,
        n: b.n || 0,
        verdict: verdictLabel,
        verdictBand: b.verdict.band,
        verdictColor: b.verdict.color,
        hitRate: isCantVerify ? null : b.hitRate,
        hitRateText: isCantVerify ? '' : (b.hitRate != null ? `${Math.round(b.hitRate * 100)}%` : ''),
        typicalMiss: isCantVerify ? '' : describeTypicalMiss(b.medianSignedError),
      };
    });

  // Anchor summary
  const anchor = analysis.anchorIdx >= 0 ? analysis.perBracket[analysis.anchorIdx] : null;

  // Verified brackets for "ranged from" sentence
  const verifiedBrackets = analysis.perBracket.filter((b) => b.verdict.band !== 'cant_verify' && b.hitRate != null);
  const hitRates = verifiedBrackets.map((b) => b.hitRate);
  const minHit = hitRates.length ? Math.min(...hitRates) : null;
  const maxHit = hitRates.length ? Math.max(...hitRates) : null;

  // Per-attribute observations — only attrs with yellow/red in any verified bracket.
  const verifiedBracketIdxs = new Set(verifiedBrackets.map((b) => b.bracketIdx));
  const attrFindings = [];
  for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
    if (def.pending) continue;
    const flagged = [];
    for (const b of analysis.perBracket) {
      if (!verifiedBracketIdxs.has(b.bracketIdx)) continue;
      const cell = b.perAttribute?.[attrId];
      if (!cell) continue;
      if (cell.color === 'yellow' || cell.color === 'red') {
        flagged.push({
          bracketLabel: b.bracket.label,
          severity: cell.color === 'red' ? 'significant' : 'some',
          isLimited: b.verdict.band === 'limited',
        });
      }
    }
    if (flagged.length > 0) {
      attrFindings.push({ attrId, label: def.label, flagged });
    }
  }

  // Compose summary paragraph
  const summaryParts = [];
  summaryParts.push(
    `Analysis was conducted on ${analysis.nQualifiedTotal.toLocaleString()} qualified sales${yearRange ? ` from ${yearRange}` : ''}${jobMeta.jobName ? ` in ${jobMeta.jobName}` : ''}.`
  );
  if (anchor) {
    const hitTxt = anchor.hitRate != null ? `${Math.round(anchor.hitRate * 100)}%` : '—';
    summaryParts.push(
      `The anchor bracket — the bracket with the most qualified sales available for evaluation — was ${anchor.bracket.label} with ${anchor.n} sales, where the assessor's adjustment grid produced predictions within ±10% of the actual sale price on ${hitTxt} of sales.`
    );
  }
  if (verifiedBrackets.length >= 2) {
    summaryParts.push(
      `Across ${verifiedBrackets.length} verified brackets, hit rates ranged from ${Math.round(minHit * 100)}% to ${Math.round(maxHit * 100)}%.`
    );
  }
  if (analysis.lotSize?.warning && analysis.lotSize?.active) {
    const activeLabel = GRID_ATTRIBUTE_MAP[analysis.lotSize.active]?.label || analysis.lotSize.active;
    summaryParts.push(
      `Note: Multiple lot-size methods are priced in the grid — the active method for this analysis was ${activeLabel.replace(/^Lot Size \((.*)\)$/, '$1')}.`
    );
  }
  const summaryParagraph = summaryParts.join(' ');

  // Compose per-attribute observations block
  let attributeBlock;
  if (attrFindings.length === 0) {
    attributeBlock = ['No notable per-attribute drift was observed in the verified brackets.'];
  } else {
    attributeBlock = attrFindings.map((f) => {
      const first = f.flagged[0];
      const severityWord = first.severity === 'significant' ? 'Significant' : 'Some';
      const limitedTag = first.isLimited ? ' (limited)' : '';
      let line = `${f.label}: ${severityWord} drift observed in the ${first.bracketLabel} bracket${limitedTag}.`;
      if (f.flagged.length > 1) {
        const extras = f.flagged.slice(1).map((x) => `the ${x.bracketLabel} bracket`).join(', ');
        line += ` Also observed in ${extras}.`;
      }
      return line;
    });
  }

  const methodology = [
    "This analysis applies the assessor's existing adjustment grid to each qualified sale in a bracket to produce a predicted value.",
    "A sale is counted as accurately predicted when the predicted value falls within ±10% of the actual sale price, consistent with USPAP guidance on individual adjustment tolerances.",
    "The analysis evaluates grid performance against qualified sales — it does not derive or propose adjustment values. Brackets with fewer than 10 qualified sales are reported as judgment calls and excluded from numerical evaluation.",
  ];

  return {
    runId,
    dateLabel,
    jobName: jobMeta.jobName || '',
    county: jobMeta.county || '',
    title: 'Adjustment Grid Performance Analysis',
    summaryParagraph,
    bracketRows: rows,
    attributeBlock,
    methodology,
  };
}
