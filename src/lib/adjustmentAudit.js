// src/lib/adjustmentAudit.js
//
// Bracket-anchored adjustment AUDIT (not derivation).
//
// Philosophy: judgment goes in (the user's grid value), the data audits it
// inside its own bracket. We do NOT produce a recommended adjustment — we
// produce a verdict on the human-set one.
//
// For one attribute at a time, for one bracket at a time:
//
//   1. Gather qualified sales whose sale_price lands in this bracket.
//   2. Compute a per-bracket baseline (median quantity for every grid attr).
//   3. For each sale, strip every OTHER grid attribute from the price using
//      that sale's deviation from the baseline:
//          residual = price − Σ [ gridValue × (qty − baselineQty) ]    (other attrs)
//   4. Single-variable least squares of residual on (qty − baseline) for
//      the attribute under test → slope b and 95% CI on b.
//   5. Compare grid value for this bracket against [b_lo, b_hi].
//
// Three-band verdict driven by sample size + spread:
//   N < VERIFY_FLOOR             → "Can't verify"           (no range shown)
//   VERIFY_FLOOR ≤ N < VERIFY_COMFORTABLE → "Limited support" (range shown, flagged)
//   N ≥ VERIFY_COMFORTABLE       → "Verified"               (range shown)
//
// Spread gate (overrides upward bands): if the attribute has no real
// variation in this bracket, the slope is unreadable regardless of N.
// Count gets you in the door, spread is what's actually in the room.

import { filterQualifiedSales } from './adjustmentStudy';
import { buildConditionRanker } from './conditionRanking';

// ---------------------------------------------------------------------------
// Tunable constants — calibrate against real towns.
// ---------------------------------------------------------------------------
export const VERIFY_FLOOR = 10;
export const VERIFY_COMFORTABLE = 25;
export const BINARY_M_PER_SIDE = 8; // require ≥ M with-it AND ≥ M without-it
export const CV_FLOOR = 0.10;       // continuous: stddev/|mean| must clear this

// ---------------------------------------------------------------------------
// CME bracket schedule — MUST match AdjustmentsTab.CME_BRACKETS.
// Kept here so the audit engine doesn't import a UI component.
// ---------------------------------------------------------------------------
export const CME_BRACKETS = [
  { min: 0,        max: 99999,    label: '$0 – $99,999',          shortLabel: '$0-$99K' },
  { min: 100000,   max: 199999,   label: '$100,000 – $199,999',   shortLabel: '$100K-$199K' },
  { min: 200000,   max: 299999,   label: '$200,000 – $299,999',   shortLabel: '$200K-$299K' },
  { min: 300000,   max: 399999,   label: '$300,000 – $399,999',   shortLabel: '$300K-$399K' },
  { min: 400000,   max: 499999,   label: '$400,000 – $499,999',   shortLabel: '$400K-$499K' },
  { min: 500000,   max: 749999,   label: '$500,000 – $749,999',   shortLabel: '$500K-$749K' },
  { min: 750000,   max: 999999,   label: '$750,000 – $999,999',   shortLabel: '$750K-$999K' },
  { min: 1000000,  max: 1499999,  label: '$1.0M – $1.499M',       shortLabel: '$1M-$1.5M' },
  { min: 1500000,  max: 1999999,  label: '$1.5M – $1.999M',       shortLabel: '$1.5M-$2M' },
  { min: 2000000,  max: 99999999, label: 'Over $2M',              shortLabel: 'Over $2M' },
];

export function assignBracket(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return -1;
  for (let i = 0; i < CME_BRACKETS.length; i++) {
    if (p >= CME_BRACKETS[i].min && p <= CME_BRACKETS[i].max) return i;
  }
  return -1;
}

// Mode-aware price field. In vetted mode the entire pipeline (bracket
// assignment AND residual) uses values_norm_time so the audit stays
// internally consistent. In all-allowable mode we use raw sales_price.
export function priceFieldFor(mode) {
  return mode === 'vetted' ? 'values_norm_time' : 'sales_price';
}

function getSalePrice(sale, mode) {
  const v = Number(sale[priceFieldFor(mode)]);
  return Number.isFinite(v) ? v : null;
}

const NUM = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// MVP grid-attribute extractors.
//
// `kind`:
//   'continuous' → real-valued quantity (sfla, lot sf, age)
//   'count'      → integer (or half-step) count   (beds, baths, fireplaces, garage cars)
//   'binary'     → 0/1 presence flag              (basement, ac, finished basement)
//
// `applyType`:
//   how the grid value applies to the quantity to produce a $ contribution.
//
// `pending: true` → recognized grid row but no extractor yet. UI must show
// these as visually distinct from "verified at zero" — never as a number we
// can't stand behind.
// ---------------------------------------------------------------------------
export const GRID_ATTRIBUTE_MAP = {
  // ---- MVP: shipped extractors ----
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
  year_built: {
    label: 'Year Built (Effective Age)',
    kind: 'continuous',
    applyType: 'flat_per_year',
    quantityUnit: 'yrs',
    extract: (p) => {
      const yb = NUM(p.asset_year_built);
      if (!yb || yb < 1700 || yb > 2100) return null;
      return new Date().getFullYear() - yb;
    },
  },
  bedrooms: {
    label: 'Bedrooms',
    kind: 'count',
    applyType: 'count',
    quantityUnit: 'beds',
    extract: (p) => NUM(p.asset_bedrooms),
  },
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
  deck: {
    label: 'Deck',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.deck_area) > 0 ? 1 : 0),
  },
  patio: {
    label: 'Patio',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.patio_area) > 0 ? 1 : 0),
  },
  open_porch: {
    label: 'Open Porch',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.open_porch_area) > 0 ? 1 : 0),
  },
  enclosed_porch: {
    label: 'Enclosed Porch',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.enclosed_porch_area) > 0 ? 1 : 0),
  },
  pool: {
    label: 'Pool',
    kind: 'binary',
    applyType: 'flat',
    quantityUnit: 'present',
    extract: (p) => (NUM(p.pool_area) > 0 ? 1 : 0),
  },

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
// Grid lookup helpers — `gridRows` are the rows from `job_adjustment_grid`
// (one row per attribute, columns bracket_0..bracket_9).
// ---------------------------------------------------------------------------
export function gridValueFor(gridRows, attrId, bracketIdx) {
  const row = gridRows.find((r) => r.adjustment_id === attrId);
  if (!row) return null;
  const v = row[`bracket_${bracketIdx}`];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Per-bracket baseline = median quantity for each MVP attribute among the
// sales that fall in this bracket. Pending attributes are skipped (they
// can't be stripped — the audit notes that explicitly).
// ---------------------------------------------------------------------------
function median(arr) {
  const xs = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

export function computeBracketBaselines(salesInBracket, ctx = {}) {
  const baselines = {};
  for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
    if (!isAttributeReady(attrId)) continue;
    const qs = salesInBracket.map((p) => def.extract(p, ctx)).filter((q) => q != null);
    baselines[attrId] = median(qs);
  }
  return baselines;
}

// ---------------------------------------------------------------------------
// Strip all OTHER attributes from the sale price, centered on the bracket
// baseline. Returns null if any non-pending OTHER attribute is missing on
// this sale (complete-case stripping — no imputation).
// ---------------------------------------------------------------------------
// Module-level counter — UI can read it after a run to surface the
// most common reason sales dropped during stripping. Reset at the start
// of each runAudit().
export const STRIP_DROP_REASONS = { byAttr: {} };
function _bumpDropReason(attrId) {
  STRIP_DROP_REASONS.byAttr[attrId] = (STRIP_DROP_REASONS.byAttr[attrId] || 0) + 1;
}

function stripOtherAdjustments(sale, bracketIdx, attrUnderTest, gridRows, baselines, mode = 'vetted', ctx = {}) {
  let residual = getSalePrice(sale, mode);
  if (residual == null) return null;

  for (const [attrId, def] of Object.entries(GRID_ATTRIBUTE_MAP)) {
    if (attrId === attrUnderTest) continue;
    if (def.pending) continue; // can't strip what we can't extract; documented in footer
    const grid = gridValueFor(gridRows, attrId, bracketIdx);
    // If the grid carries no value here, this attribute can't change the
    // residual either way — skip it without requiring the quantity. Otherwise
    // a missing extractor on an attribute the grid doesn't even use would
    // wrongly drop the sale.
    if (grid == null || grid === 0) continue;
    const qty = def.extract(sale, ctx);
    if (qty == null) { _bumpDropReason(attrId); return null; } // complete-case ONLY when the grid relies on this attribute
    const base = baselines[attrId];
    if (base == null) continue;

    const delta = qty - base;
    let dollars = 0;
    switch (def.applyType) {
      case 'per_sqft':
      case 'per_acre':
      case 'per_ff':
        dollars = grid * delta;
        break;
      case 'flat_per_year':
        // grid value is "$ per year of effective age". delta already in years.
        dollars = grid * delta;
        break;
      case 'count':
      case 'flat':
        dollars = grid * delta;
        break;
      default:
        dollars = 0;
    }
    residual -= dollars;
  }
  return residual;
}

// ---------------------------------------------------------------------------
// Single-variable OLS: y = a + b*(x - x_bar). Returns slope, intercept,
// 95% CI on slope, sample size, and the centered x_bar used.
//
// CI uses normal approximation (t ≈ 1.96) — fine at N≥25, slightly loose
// at N=10–24 which is exactly why those cases are flagged "limited."
// ---------------------------------------------------------------------------
function fitSingleVarOLS(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const xbar = xs.reduce((s, v) => s + v, 0) / n;
  const ybar = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xbar;
    sxx += dx * dx;
    sxy += dx * (ys[i] - ybar);
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  const a = ybar; // intercept at x = xbar; this IS the bracket's baseline expected price
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yhat = a + b * (xs[i] - xbar);
    const r = ys[i] - yhat;
    ssRes += r * r;
  }
  const sigma2 = ssRes / Math.max(1, n - 2);
  const se_b = Math.sqrt(sigma2 / sxx);
  const ci95 = [b - 1.96 * se_b, b + 1.96 * se_b];
  return { n, b, a, se_b, ci95, xbar };
}

// Difference of means with CI for binary attribute (presence flag).
// b = mean(residual | qty=1) − mean(residual | qty=0).
function fitBinaryMeanDiff(xs, ys) {
  const yes = ys.filter((_, i) => xs[i] === 1);
  const no = ys.filter((_, i) => xs[i] === 0);
  const n1 = yes.length, n0 = no.length;
  if (n1 < BINARY_M_PER_SIDE || n0 < BINARY_M_PER_SIDE) return null;
  const m1 = yes.reduce((s, v) => s + v, 0) / n1;
  const m0 = no.reduce((s, v) => s + v, 0) / n0;
  const v1 = yes.reduce((s, v) => s + (v - m1) ** 2, 0) / Math.max(1, n1 - 1);
  const v0 = no.reduce((s, v) => s + (v - m0) ** 2, 0) / Math.max(1, n0 - 1);
  const se = Math.sqrt(v1 / n1 + v0 / n0);
  const b = m1 - m0;
  return { n: n1 + n0, n1, n0, b, a: m0, se_b: se, ci95: [b - 1.96 * se, b + 1.96 * se] };
}

// ---------------------------------------------------------------------------
// Audit ONE bracket for ONE attribute. Returns a verdict object the UI can
// render directly — no math knowledge required downstream.
// ---------------------------------------------------------------------------
export function auditBracket({ attrId, bracketIdx, allSales, gridRows, mode = 'vetted', ctx = {} }) {
  const def = GRID_ATTRIBUTE_MAP[attrId];
  const bracket = CME_BRACKETS[bracketIdx];
  const gridValue = gridValueFor(gridRows, attrId, bracketIdx);

  const base = {
    bracketIdx,
    bracket,
    gridValue,
    attrId,
    attrLabel: def?.label || attrId,
    isAnchor: false,
  };

  if (!def || def.pending) {
    return { ...base, verdict: 'pending', message: `${def?.label || attrId} extractor not yet wired — audit can't run on this row.`, n: 0 };
  }

  // Pull just the sales that landed in this bracket — using the price field
  // appropriate to the audit mode (values_norm_time for vetted, sales_price
  // for all-allowable). Same field is used to compute the residual so the
  // audit stays internally consistent.
  const inBracket = allSales.filter((p) => assignBracket(getSalePrice(p, mode)) === bracketIdx);
  const baselines = computeBracketBaselines(inBracket, ctx);
  const baselineQty = baselines[attrId];

  // Build (x, y) pairs. Track WHY sales drop so the UI can explain it.
  const pts = [];
  let droppedNoQty = 0, droppedStrip = 0;
  for (const sale of inBracket) {
    const qty = def.extract(sale, ctx);
    if (qty == null) { droppedNoQty += 1; continue; }
    const residual = stripOtherAdjustments(sale, bracketIdx, attrId, gridRows, baselines, mode, ctx);
    if (residual == null || !Number.isFinite(residual)) { droppedStrip += 1; continue; }
    pts.push({ x: qty, y: residual });
  }
  base.nLanded = inBracket.length;
  base.droppedNoQty = droppedNoQty;
  base.droppedStrip = droppedStrip;

  const n = pts.length;
  if (n < VERIFY_FLOOR) {
    return {
      ...base,
      n,
      baselineQty,
      verdict: 'cant_verify',
      message: `Only ${n} qualified sale(s) in this bracket — not enough to validate. This bracket remains a judgment call.`,
    };
  }

  // Spread gate (per kind)
  const xs = pts.map((p) => p.x);
  if (def.kind === 'binary') {
    const yes = xs.filter((x) => x === 1).length;
    const no = xs.filter((x) => x === 0).length;
    if (yes < BINARY_M_PER_SIDE || no < BINARY_M_PER_SIDE) {
      return {
        ...base,
        n,
        verdict: 'cant_verify',
        message: `Need at least ${BINARY_M_PER_SIDE} sales with and ${BINARY_M_PER_SIDE} without to read a presence/absence value. This bracket has ${yes} with / ${no} without.`,
      };
    }
  } else {
    // continuous / count → CV check
    const xMean = xs.reduce((s, v) => s + v, 0) / n;
    const xVar = xs.reduce((s, v) => s + (v - xMean) ** 2, 0) / Math.max(1, n - 1);
    const cv = Math.abs(xMean) > 0 ? Math.sqrt(xVar) / Math.abs(xMean) : 0;
    if (cv < CV_FLOOR) {
      return {
        ...base,
        n,
        verdict: 'cant_verify',
        message: `Sales in this bracket lack enough variation in ${def.label} to read a value (spread ${(cv * 100).toFixed(1)}% — floor ${(CV_FLOOR * 100).toFixed(0)}%).`,
      };
    }
  }

  // Fit
  const ys = pts.map((p) => p.y);
  const fit = def.kind === 'binary' ? fitBinaryMeanDiff(xs, ys) : fitSingleVarOLS(xs, ys);
  if (!fit) {
    return { ...base, n, verdict: 'cant_verify', message: `Math couldn't converge on this bracket (degenerate sample).` };
  }

  const [lo, hi] = fit.ci95;
  const bandConfident = n >= VERIFY_COMFORTABLE;

  // Compare grid value to interval
  let comparison = 'no_grid';
  let comparisonText = '';
  if (gridValue == null) {
    comparison = 'no_grid';
    comparisonText = 'No grid value set for this bracket.';
  } else if (gridValue >= lo && gridValue <= hi) {
    comparison = 'inside';
    comparisonText = `Your grid value of ${fmtMoney(gridValue)} ${def.kind === 'binary' ? '' : `per ${def.quantityUnit} `}falls inside the market range — supported.`;
  } else if (gridValue < lo) {
    comparison = 'below';
    comparisonText = `Market evidence in this bracket sits at ${fmtMoney(lo)} – ${fmtMoney(hi)}; your grid is ${fmtMoney(gridValue)}. The data is pulling harder than your adjustment — review whether this is conservative-by-design or conservative-by-default.`;
  } else {
    comparison = 'above';
    comparisonText = `Market evidence in this bracket sits at ${fmtMoney(lo)} – ${fmtMoney(hi)}; your grid is ${fmtMoney(gridValue)}. The data sits below your adjustment — review whether this bracket may be aggressive.`;
  }

  return {
    ...base,
    n,
    verdict: bandConfident ? 'verified' : 'limited',
    fit: { slope: fit.b, intercept: fit.a, ci95: fit.ci95, n: fit.n },
    comparison,
    comparisonText,
    baselineQty,
    message: `${n} qualified sales in this bracket. Market range ${fmtMoney(lo)} – ${fmtMoney(hi)}.`,
  };
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Top-level: run the audit for one attribute across all 10 brackets.
// Identifies the anchor bracket (most qualified sales among the verifiable
// ones; falls back to overall most populous when nothing verifies).
// Computes interpolation diagnostics when ≥2 brackets verify.
// ---------------------------------------------------------------------------
export function runAudit({ attrId, properties, gridRows, opts = {} }) {
  if (!isAttributeReady(attrId)) {
    return { ok: false, error: 'Selected attribute is not yet wired (extractor pending).', attrId };
  }
  // Reuse the existing qualified-sales filter (mode/window/class/sales codes)
  const qualified = filterQualifiedSales(properties, opts);
  if (qualified.length === 0) {
    return { ok: false, error: 'No qualified sales matched the current filters.', attrId };
  }

  const mode = opts.mode || 'vetted';
  const ctx = {
    conditionRanker: opts.jobData ? buildConditionRanker(opts.jobData) : null,
  };

  // Reset the strip-drop reason counter for this run
  STRIP_DROP_REASONS.byAttr = {};

  // Diagnostic: count how many qualified sales actually landed in *any* bracket
  // using the mode-aware price field. If 0 → the price field isn't populated
  // the way bracket assignment expects, and EVERY bracket will report 0.
  let landed = 0, missingPrice = 0, outOfRange = 0;
  let minP = Infinity, maxP = -Infinity, sumP = 0;
  for (const p of qualified) {
    const px = getSalePrice(p, mode);
    if (px == null || px <= 0) { missingPrice += 1; continue; }
    minP = Math.min(minP, px);
    maxP = Math.max(maxP, px);
    sumP += px;
    const idx = assignBracket(px);
    if (idx < 0) outOfRange += 1; else landed += 1;
  }
  const priceDiagnostic = {
    field: priceFieldFor(mode),
    landed,
    missingPrice,
    outOfRange,
    min: landed + outOfRange > 0 ? minP : null,
    max: landed + outOfRange > 0 ? maxP : null,
    mean: landed + outOfRange > 0 ? sumP / (landed + outOfRange) : null,
  };

  const perBracket = CME_BRACKETS.map((_, idx) =>
    auditBracket({ attrId, bracketIdx: idx, allSales: qualified, gridRows, mode, ctx })
  );

  // Anchor = most-populous verified; fallback = most-populous overall
  const verified = perBracket.filter((b) => b.verdict === 'verified');
  const verifiedSorted = [...verified].sort((a, b) => b.n - a.n);
  let anchorIdx = -1;
  if (verifiedSorted.length > 0) {
    anchorIdx = verifiedSorted[0].bracketIdx;
  } else {
    const fallbackSorted = [...perBracket].sort((a, b) => (b.n || 0) - (a.n || 0));
    if (fallbackSorted.length > 0 && (fallbackSorted[0].n || 0) > 0) {
      anchorIdx = fallbackSorted[0].bracketIdx;
    }
  }
  if (anchorIdx >= 0) perBracket[anchorIdx].isAnchor = true;

  // Interpolation diagnostic when ≥2 verified
  let interpolation = null;
  if (verified.length >= 2) {
    const sorted = [...verified].sort((a, b) => a.bracketIdx - b.bracketIdx);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const checks = [];
    for (let i = lo.bracketIdx + 1; i < hi.bracketIdx; i++) {
      const between = perBracket[i];
      if (between.gridValue == null) continue;
      // Linear interpolation on grid value between lo and hi expected market
      const tFrac = (i - lo.bracketIdx) / (hi.bracketIdx - lo.bracketIdx);
      const expected = lo.fit.slope + (hi.fit.slope - lo.fit.slope) * tFrac;
      const within =
        between.fit
          ? expected >= between.fit.ci95[0] && expected <= between.fit.ci95[1]
          : null;
      checks.push({
        bracketIdx: i,
        bracket: CME_BRACKETS[i],
        gridValue: between.gridValue,
        expectedFromLine: expected,
        within,
      });
    }
    interpolation = { anchors: [lo.bracketIdx, hi.bracketIdx], checks };
  }

  return {
    ok: true,
    attrId,
    attrLabel: GRID_ATTRIBUTE_MAP[attrId].label,
    nQualifiedTotal: qualified.length,
    perBracket,
    anchorIdx,
    interpolation,
    priceDiagnostic,
    stripDropReasons: { ...STRIP_DROP_REASONS.byAttr },
    mode,
  };
}

// ---------------------------------------------------------------------------
// Documentation block — clean, professional prose for the client's
// defensible write-up. This is the deliverable, not a footer afterthought.
// ---------------------------------------------------------------------------
export function buildDocumentationBlock(audit, jobName = '') {
  if (!audit?.ok) return '';
  const lines = [];
  const title = jobName ? `${jobName} — ` : '';
  lines.push(`${title}Adjustment Audit: ${audit.attrLabel}`);
  lines.push('');
  lines.push(`Total qualified sales: ${audit.nQualifiedTotal.toLocaleString()}`);

  const anchor = audit.anchorIdx >= 0 ? audit.perBracket[audit.anchorIdx] : null;
  if (anchor && anchor.verdict === 'verified') {
    const [lo, hi] = anchor.fit.ci95;
    lines.push('');
    lines.push(`Anchor bracket: ${anchor.bracket.label}`);
    lines.push(`  • ${anchor.n} qualified sales`);
    lines.push(`  • Grid value: ${fmtMoney(anchor.gridValue)}`);
    lines.push(`  • Market range: ${fmtMoney(lo)} – ${fmtMoney(hi)}`);
    lines.push(`  • Verdict: VERIFIED — ${anchor.comparisonText}`);
  } else if (anchor) {
    lines.push('');
    lines.push(`Anchor bracket: ${anchor.bracket.label} (${anchor.n} sales — ${anchor.verdict.replace('_', ' ').toUpperCase()})`);
    lines.push(`  ${anchor.message}`);
  } else {
    lines.push('');
    lines.push('No bracket had enough qualified sales to serve as an anchor.');
  }

  lines.push('');
  lines.push('Per-bracket detail:');
  for (const b of audit.perBracket) {
    const tag = b.isAnchor ? ' [ANCHOR]' : '';
    if (b.verdict === 'verified' || b.verdict === 'limited') {
      const [lo, hi] = b.fit.ci95;
      lines.push(`  • ${b.bracket.label}${tag} — ${b.verdict === 'verified' ? 'Verified' : 'Limited support'} (${b.n} sales). Grid ${fmtMoney(b.gridValue)} vs market ${fmtMoney(lo)} – ${fmtMoney(hi)}. ${b.comparisonText}`);
    } else if (b.verdict === 'cant_verify') {
      lines.push(`  • ${b.bracket.label}${tag} — Can't verify (${b.n} sales). ${b.message}`);
    } else if (b.verdict === 'pending') {
      lines.push(`  • ${b.bracket.label}${tag} — Extractor pending.`);
    }
  }

  if (audit.interpolation && audit.interpolation.checks.length > 0) {
    lines.push('');
    const [aIdx, bIdx] = audit.interpolation.anchors;
    lines.push(`Interpolation check (between verified brackets ${CME_BRACKETS[aIdx].shortLabel} and ${CME_BRACKETS[bIdx].shortLabel}):`);
    for (const c of audit.interpolation.checks) {
      const ok = c.within == null ? 'no model' : (c.within ? 'consistent' : 'off-line');
      lines.push(`  • ${c.bracket.label} — grid ${fmtMoney(c.gridValue)}, line implies ${fmtMoney(c.expectedFromLine)} → ${ok}`);
    }
  }

  lines.push('');
  lines.push('Methodology: For each bracket, every other grid attribute is stripped from the sale price relative to the bracket\'s median baseline property using that sale\'s own bracket column. The remaining residual is regressed against the audited attribute. Grid values inside the resulting market range are supported; values outside flag a review. Verified = 25+ qualified sales with adequate spread. Limited = 10–24 sales. Below 10, the bracket remains a judgment call.');
  return lines.join('\n');
}
