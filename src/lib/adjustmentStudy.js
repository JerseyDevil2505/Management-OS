// src/lib/adjustmentStudy.js
//
// Adjustment Study engine — derives evidence-based per-attribute adjustments
// from a town's qualified sales using hedonic OLS regression.
//
// Two modes (intentional, see Copilot OS guide §12 ground rules):
//
//   mode: 'vetted' (DEFAULT, recommended)
//     - Dependent variable = `values_norm_time` (already vetted by the
//       time-normalization workflow AND already adjusted to the valuation
//       date). Sales without `values_norm_time > 0` are excluded — they
//       failed the vetting step.
//     - The time-trend variable is dropped from the regression because the
//       dependent variable is already detrended.
//     - This is the defensible path: an underwriter asks "how did you
//       choose which sales to use?" and the answer is "the same vetting
//       process that drives every other CME analysis in this report."
//
//   mode: 'all'
//     - Dependent variable = `sales_price` (raw).
//     - Filter via the canonical CME sales code allowlist + an optional
//       date window.
//     - The time-trend variable IS included so other coefficients are net
//       of market appreciation.
//
// Other choices:
// - Linear-additive form (IAAO standard, easiest to interpret/defend).
// - Condo qualifiers (`C*`) excluded (footprint shared with mother lot).
// - Class-stratified by default (one class per study).
// - Condition rank comes from the job's own
//   `attribute_condition_config` via a caller-supplied `conditionRanker`
//   closure — same logic CME uses, no duplicated rank tables.
// - Pure JS, no deps. OLS via normal equations + Gauss-Jordan inverse.

import {
  STUDY_DEFAULT_SALES_CODES,
  normalizeSalesCode,
} from './salesCodes';

// ---------------------------------------------------------------------------
// Matrix helpers (no deps — sized for hundreds-to-thousands of obs × <20 vars)
// ---------------------------------------------------------------------------

function transpose(A) {
  const m = A.length, n = A[0].length;
  const T = Array.from({ length: n }, () => new Array(m));
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

function matMul(A, B) {
  const m = A.length, k = A[0].length, n = B[0].length;
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let r = 0; r < k; r++) s += A[i][r] * B[r][j];
      C[i][j] = s;
    }
  }
  return C;
}

function matVec(A, x) {
  const m = A.length, n = A[0].length;
  const y = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}

function invert(A) {
  const n = A.length;
  const M = A.map((row, i) => {
    const r = row.slice();
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    }
    if (Math.abs(M[pivot][i]) < 1e-12) {
      throw new Error('Singular matrix — likely perfect collinearity between variables.');
    }
    if (pivot !== i) { const t = M[i]; M[i] = M[pivot]; M[pivot] = t; }
    const div = M[i][i];
    for (let j = 0; j < 2 * n; j++) M[i][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = M[r][i];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[i][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// ---------------------------------------------------------------------------
// Variable extraction
// ---------------------------------------------------------------------------

const NUM = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function monthsBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

// Each variable knows how to extract itself from a property row, what the
// coefficient unit means, and which adjustment-grid row it maps to.
//
// `extract` accepts (property, ctx) where ctx supplies the conditionRanker
// closure and any other job-scoped helpers. Returning null = "missing,
// drop this row from the model under complete-case rules".

export const STUDY_VARIABLES = [
  {
    id: 'sfla',
    label: 'Living Area',
    unit: '$ / SF',
    appliesTo: 'living_area',
    extract: (p) => NUM(p.asset_sfla),
  },
  {
    id: 'lot_sf',
    label: 'Lot Size',
    unit: '$ / SF',
    appliesTo: 'lot_size_sf',
    extract: (p) => NUM(p.asset_lot_sf),
  },
  {
    id: 'age',
    label: 'Effective Age',
    unit: '$ / year of age (negative = older = less)',
    appliesTo: 'year_built',
    extract: (p) => {
      const yb = NUM(p.asset_year_built);
      if (!yb || yb < 1700 || yb > 2100) return null;
      return new Date().getFullYear() - yb;
    },
  },
  {
    id: 'bedrooms',
    label: 'Bedrooms',
    unit: '$ / bedroom',
    appliesTo: 'bedrooms',
    extract: (p) => NUM(p.asset_bedrooms),
  },
  {
    id: 'fireplaces',
    label: 'Fireplaces',
    unit: '$ / fireplace',
    appliesTo: 'fireplaces',
    extract: (p) => NUM(p.asset_fireplaces),
  },
  {
    id: 'condition_int',
    label: 'Interior Condition',
    unit: '$ / rank step (uses your Attribute Cards config)',
    appliesTo: 'interior_condition',
    extract: (p, ctx) => {
      if (!ctx?.conditionRanker) return null;
      return ctx.conditionRanker(p.asset_int_cond, 'interior', { ncovrPct: p.net_condition_pct });
    },
  },
  {
    id: 'condition_ext',
    label: 'Exterior Condition',
    unit: '$ / rank step (uses your Attribute Cards config)',
    appliesTo: 'exterior_condition',
    extract: (p, ctx) => {
      if (!ctx?.conditionRanker) return null;
      return ctx.conditionRanker(p.asset_ext_cond, 'exterior', { ncovrPct: p.net_condition_pct });
    },
  },
  {
    id: 'time_months',
    label: 'Time Trend',
    unit: '$ / month appreciation',
    appliesTo: null,
    extract: null, // computed at fit time when present
  },
];

// ---------------------------------------------------------------------------
// Filter qualified sales — mode-aware
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
    // Class filter (always applied)
    const cls = String(p.property_m4_class ?? '').trim().toUpperCase();
    if (classSet.size > 0 && !classSet.has(cls)) return false;

    // Condo child exclusion (always applied)
    if (excludeCondoChildren) {
      const q = String(p.property_qualifier ?? '').trim().toUpperCase();
      if (q.startsWith('C')) return false;
    }

    if (mode === 'vetted') {
      // Vetted mode: must have a positive `values_norm_time`. That's the
      // canonical "this sale was vetted" signal used by AttributeCardsTab
      // and AppealLogTab. Date filter still applies if caller supplied one
      // (so users can scope to recent sales even within the vetted set).
      const nt = Number(p.values_norm_time);
      if (!Number.isFinite(nt) || nt <= 0) return false;
      if (p.sales_date) {
        const t = new Date(p.sales_date).getTime();
        if (Number.isFinite(t) && (t < startMs || t > endMs)) return false;
      }
      return true;
    }

    // 'all' mode: raw sales_price + sales code allowlist + date window
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
// Per-variable availability — answers "how many of the qualified sales
// have data for variable X". UI calls this BEFORE running so users can
// disable sparse variables and see complete-case N before clicking Run.
// ---------------------------------------------------------------------------

export function variableAvailability(qualifiedSales, ctx = {}, variables = STUDY_VARIABLES) {
  return variables
    .filter((v) => v.id !== 'time_months')
    .map((v) => {
      let count = 0;
      for (const p of qualifiedSales) {
        const x = v.extract ? v.extract(p, ctx) : null;
        if (x != null) count += 1;
      }
      const pct = qualifiedSales.length === 0 ? 0 : count / qualifiedSales.length;
      return { id: v.id, label: v.label, count, pct };
    });
}

// ---------------------------------------------------------------------------
// OLS fit
// ---------------------------------------------------------------------------

export function fitHedonicOLS(qualifiedSales, opts = {}) {
  const mode = opts.mode || 'vetted';
  const ctx = opts.ctx || {};
  const includeIds = opts.includeVariables;
  // Filter to selected variables; in vetted mode, automatically drop time_months.
  const variables = STUDY_VARIABLES.filter((v) => {
    if (includeIds && !includeIds.includes(v.id)) return false;
    if (v.id === 'time_months' && mode === 'vetted') return false;
    return true;
  });

  if (variables.length === 0) {
    return { ok: false, error: 'No variables selected.' };
  }

  // Earliest sale date for the time variable (if present)
  const dates = qualifiedSales
    .map((p) => new Date(p.sales_date))
    .filter((d) => Number.isFinite(d.getTime()));
  const earliest = dates.length > 0
    ? new Date(Math.min(...dates.map((d) => d.getTime())))
    : null;

  // Build observations: complete-case only.
  const rows = [];
  const droppedReasons = { missing_y: 0, missing_x: 0 };
  const dependentField = mode === 'vetted' ? 'values_norm_time' : 'sales_price';

  for (const p of qualifiedSales) {
    const y = NUM(p[dependentField]);
    if (!y || y <= 0) { droppedReasons.missing_y += 1; continue; }
    const xs = [];
    let bad = false;
    for (const v of variables) {
      let x;
      if (v.id === 'time_months') {
        const d = new Date(p.sales_date);
        x = (earliest && Number.isFinite(d.getTime()))
          ? monthsBetween(d, earliest)
          : null;
      } else {
        x = v.extract(p, ctx);
      }
      if (x == null) { bad = true; break; }
      xs.push(x);
    }
    if (bad) { droppedReasons.missing_x += 1; continue; }
    rows.push({ y, xs });
  }

  const n = rows.length;
  const k = variables.length + 1;
  if (n < k * 5) {
    return {
      ok: false,
      error: `Only ${n} sales have complete data for the ${variables.length} selected variables. Need ~${k * 5}+. Try unchecking sparse variables in the availability panel above.`,
      n,
      droppedReasons,
    };
  }

  const X = rows.map((r) => [1, ...r.xs]);
  const y = rows.map((r) => r.y);

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  let XtX_inv;
  try {
    XtX_inv = invert(XtX);
  } catch (e) {
    return { ok: false, error: e.message, n };
  }
  const Xty = matVec(Xt, y);
  const beta = matVec(XtX_inv, Xty);

  const yHat = matVec(X, beta);
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const rSquared = 1 - ssRes / ssTot;
  const adjR = 1 - (1 - rSquared) * (n - 1) / (n - k);
  const sigma2 = ssRes / (n - k);

  const seCoef = XtX_inv.map((row, i) => Math.sqrt(sigma2 * row[i]));

  const coefSummary = beta.map((b, i) => {
    const se = seCoef[i];
    const t = se > 0 ? b / se : 0;
    const p = approxPValueTwoSided(t);
    const ci95 = [b - 1.96 * se, b + 1.96 * se];
    return { coef: b, se, t, p, ci95 };
  });

  const variableResults = variables.map((v, i) => ({
    id: v.id,
    label: v.label,
    unit: v.unit,
    appliesTo: v.appliesTo,
    ...coefSummary[i + 1],
  }));

  return {
    ok: true,
    n,
    k,
    droppedReasons,
    earliestSaleDate: earliest ? earliest.toISOString().split('T')[0] : null,
    intercept: coefSummary[0],
    variables: variableResults,
    diagnostics: {
      rSquared,
      adjRSquared: adjR,
      residualStdError: Math.sqrt(sigma2),
      meanPrice: yMean,
      dependentField,
    },
  };
}

function approxPValueTwoSided(t) {
  const z = Math.abs(t);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const tt = 1.0 / (1.0 + p * x);
  const erf = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-x * x);
  const cdf = 0.5 * (1 + sign * erf);
  return 2 * (1 - cdf);
}

// ---------------------------------------------------------------------------
// Reconciliation — same status semantics as before
// ---------------------------------------------------------------------------

export function reconcile(variableResult, currentGridValue) {
  const v = variableResult;
  if (v.p > 0.10) {
    return {
      ...v, currentGridValue, status: 'weak',
      message: 'Regression coefficient is not statistically distinguishable from zero (p > 0.10). Keep grid value or seek paired-sales support.',
    };
  }
  if (currentGridValue == null) {
    return { ...v, currentGridValue, status: 'no-grid', message: 'No current grid value to compare.' };
  }
  const [lo, hi] = v.ci95;
  if (currentGridValue >= lo && currentGridValue <= hi) {
    return { ...v, currentGridValue, status: 'agree', message: 'Current grid value falls inside the 95% confidence interval — supported.' };
  }
  if (currentGridValue < lo) {
    return { ...v, currentGridValue, status: 'low', message: `Current grid value (${currentGridValue}) is below the 95% CI (${lo.toFixed(0)} – ${hi.toFixed(0)}). The data suggests a higher adjustment.` };
  }
  return { ...v, currentGridValue, status: 'high', message: `Current grid value (${currentGridValue}) is above the 95% CI (${lo.toFixed(0)} – ${hi.toFixed(0)}). The data suggests a lower adjustment.` };
}

// ---------------------------------------------------------------------------
// Sales-per-year diagnostic — quick look at the temporal distribution of
// the qualified sales so the user can see what they're feeding the model.
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
// Top-level orchestrator
// ---------------------------------------------------------------------------

export function runAdjustmentStudy(properties, opts = {}) {
  const qualified = filterQualifiedSales(properties, opts);
  if (qualified.length === 0) {
    return {
      ok: false,
      error: opts.mode === 'vetted'
        ? 'No qualified sales found. Vetted mode requires sales with values_norm_time > 0 — run time normalization in PreValuation first.'
        : 'No sales matched the filter (date range, NU codes, class).',
      dataset: { n: 0 },
    };
  }
  const fit = fitHedonicOLS(qualified, opts);
  if (!fit.ok) {
    return { ok: false, error: fit.error, dataset: { n: qualified.length, droppedReasons: fit.droppedReasons } };
  }
  return {
    ok: true,
    mode: opts.mode || 'vetted',
    dataset: {
      n: qualified.length,
      nUsed: fit.n,
      droppedReasons: fit.droppedReasons,
      earliestSaleDate: fit.earliestSaleDate,
      filter: opts,
    },
    diagnostics: fit.diagnostics,
    intercept: fit.intercept,
    variables: fit.variables,
    salesPerYear: salesPerYear(qualified),
  };
}
