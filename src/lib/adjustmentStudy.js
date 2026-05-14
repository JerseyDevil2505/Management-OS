// src/lib/adjustmentStudy.js
//
// Adjustment Study engine — derives evidence-based per-attribute adjustments
// from a town's own qualified sales using hedonic OLS regression with a
// linear time trend.
//
// Inputs are plain `property_records` rows (already in memory in the parent).
// Output is a per-attribute summary the UI can render side-by-side with the
// current adjustment grid.
//
// Design choices (intentional, see Copilot OS guide §12 ground rules):
// - Linear-additive form. IAAO standard, easiest to interpret, easiest to
//   defend in a board hearing. Multiplicative / log forms can come later.
// - Time variable goes INTO the regression (months since earliest sale)
//   instead of pre-time-normalizing — the coefficient on time IS the
//   monthly appreciation rate, and the other coefficients are automatically
//   net of market movement.
// - We exclude condo qualifiers (`C*`) since they share footprints with
//   their mother lot and would inject duplicate observations.
// - Class-stratified by default (only one class per study). Mixing Class 2
//   residential with Class 4 commercial poisons every coefficient.
// - Pure JS, no deps. OLS via normal equations + Gauss-Jordan inverse.

// ---------------------------------------------------------------------------
// Matrix helpers (no deps — sized for hundreds-to-thousands of obs × <20 vars)
// ---------------------------------------------------------------------------

function transpose(A) {
  const m = A.length;
  const n = A[0].length;
  const T = Array.from({ length: n }, () => new Array(m));
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

function matMul(A, B) {
  const m = A.length;
  const k = A[0].length;
  const n = B[0].length;
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
  const m = A.length;
  const n = A[0].length;
  const y = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += A[i][j] * x[j];
    y[i] = s;
  }
  return y;
}

// Invert a square matrix via Gauss-Jordan with partial pivoting.
// Throws if singular. Caller catches and surfaces a "model failed" error.
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
    if (pivot !== i) {
      const tmp = M[i]; M[i] = M[pivot]; M[pivot] = tmp;
    }
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

// Categorical → ordinal score for condition fields. BRT and Microsystems
// both use a small vocabulary; we map to a 1-5 scale so condition can ride
// in the regression as a continuous "quality" variable. Unknowns → null
// (the row is dropped from the model).
const CONDITION_SCORE = {
  'EXCELLENT': 5, 'EX': 5, 'E': 5,
  'GOOD': 4, 'GD': 4, 'G': 4,
  'AVERAGE': 3, 'AVG': 3, 'AV': 3, 'A': 3, 'NORMAL': 3,
  'FAIR': 2, 'FR': 2, 'F': 2,
  'POOR': 1, 'PR': 1, 'P': 1,
};

function conditionScore(raw) {
  if (raw == null) return null;
  const k = String(raw).trim().toUpperCase();
  return CONDITION_SCORE[k] ?? null;
}

// Months between two dates (fractional, signed)
function monthsBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

// ---------------------------------------------------------------------------
// Variable definitions
// ---------------------------------------------------------------------------
//
// Each variable knows how to extract itself from a property row, what unit
// its coefficient represents, and how the UI should label it.

export const STUDY_VARIABLES = [
  {
    id: 'sfla',
    label: 'Living Area (per SF)',
    extract: (p) => NUM(p.asset_sfla),
    unit: '$ / SF',
    appliesTo: 'living_area',
  },
  {
    id: 'lot_sf',
    label: 'Lot Size (per SF)',
    extract: (p) => NUM(p.asset_lot_sf),
    unit: '$ / SF',
    appliesTo: 'lot_size_sf',
  },
  {
    id: 'age',
    label: 'Effective Age (per year)',
    // Use year_built as a proxy — older = lower price. We feed AGE not year
    // so the coefficient is interpretable as "$/year of age".
    extract: (p) => {
      const yb = NUM(p.asset_year_built);
      if (!yb || yb < 1700 || yb > 2100) return null;
      return new Date().getFullYear() - yb;
    },
    unit: '$ / year of age',
    appliesTo: 'year_built',
  },
  {
    id: 'bedrooms',
    label: 'Bedrooms (per bedroom)',
    extract: (p) => NUM(p.asset_bedrooms),
    unit: '$ / bedroom',
    appliesTo: 'bedrooms',
  },
  {
    id: 'fireplaces',
    label: 'Fireplaces (per fireplace)',
    extract: (p) => NUM(p.asset_fireplaces),
    unit: '$ / fireplace',
    appliesTo: 'fireplaces',
  },
  {
    id: 'condition_int',
    label: 'Interior Condition (per quality step)',
    extract: (p) => conditionScore(p.asset_int_cond),
    unit: '$ / step (Poor→Excellent on 1-5 scale)',
    appliesTo: 'int_condition',
  },
  {
    id: 'condition_ext',
    label: 'Exterior Condition (per quality step)',
    extract: (p) => conditionScore(p.asset_ext_cond),
    unit: '$ / step (Poor→Excellent on 1-5 scale)',
    appliesTo: 'ext_condition',
  },
  {
    id: 'time_months',
    label: 'Time Trend (per month)',
    // Computed at model-build time, not from the row
    extract: null,
    unit: '$ / month appreciation',
    appliesTo: null, // not applied to grid
  },
];

// ---------------------------------------------------------------------------
// Filter qualified sales
// ---------------------------------------------------------------------------

export function filterQualifiedSales(properties, opts = {}) {
  const {
    salesDateStart, // 'YYYY-MM-DD'
    salesDateEnd,
    nuCodeAllowList = ['', '0', '00', '7', '07'],
    classFilter = ['2'], // default residential
    minPrice = 1000,
    excludeCondoChildren = true,
  } = opts;

  const startMs = salesDateStart ? new Date(salesDateStart).getTime() : -Infinity;
  const endMs = salesDateEnd ? new Date(salesDateEnd).getTime() : Infinity;
  const nuSet = new Set(nuCodeAllowList.map((c) => String(c).trim()));
  const classSet = new Set(classFilter.map((c) => String(c).trim().toUpperCase()));

  return properties.filter((p) => {
    if (!p.sales_price || Number(p.sales_price) < minPrice) return false;
    if (!p.sales_date) return false;
    const t = new Date(p.sales_date).getTime();
    if (!Number.isFinite(t) || t < startMs || t > endMs) return false;
    const nu = String(p.sales_nu ?? '').trim();
    if (!nuSet.has(nu)) return false;
    const cls = String(p.property_m4_class ?? '').trim().toUpperCase();
    if (classSet.size > 0 && !classSet.has(cls)) return false;
    if (excludeCondoChildren) {
      const q = String(p.property_qualifier ?? '').trim().toUpperCase();
      if (q.startsWith('C')) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// OLS fit
// ---------------------------------------------------------------------------

export function fitHedonicOLS(properties, opts = {}) {
  const variables = opts.variables || STUDY_VARIABLES;

  // Build observations: drop any sale missing any required variable.
  // (Simple complete-case approach. Imputation would muddy the defensibility
  // story we're selling — better to be honest about N.)
  const dates = properties
    .map((p) => new Date(p.sales_date))
    .filter((d) => Number.isFinite(d.getTime()));
  if (dates.length === 0) {
    return { ok: false, error: 'No sales with valid dates.' };
  }
  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));

  const rows = [];
  const droppedReasons = { missing_y: 0, missing_x: 0 };
  for (const p of properties) {
    const y = NUM(p.sales_price);
    if (!y || y <= 0) { droppedReasons.missing_y += 1; continue; }
    const xs = [];
    let bad = false;
    for (const v of variables) {
      let x;
      if (v.id === 'time_months') {
        const d = new Date(p.sales_date);
        x = Number.isFinite(d.getTime()) ? monthsBetween(d, earliest) : null;
      } else {
        x = v.extract(p);
      }
      if (x == null) { bad = true; break; }
      xs.push(x);
    }
    if (bad) { droppedReasons.missing_x += 1; continue; }
    rows.push({ y, xs, p });
  }

  const n = rows.length;
  const k = variables.length + 1; // +1 for intercept
  if (n < k * 5) {
    return {
      ok: false,
      error: `Not enough complete-case observations (${n}) for ${variables.length} variables. Need ~${k * 5}+.`,
      n,
    };
  }

  // Design matrix X (n × k) with intercept column of 1s
  const X = rows.map((r) => [1, ...r.xs]);
  const y = rows.map((r) => r.y);

  // β = (XᵀX)⁻¹ Xᵀ y
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

  // Residuals + diagnostics
  const yHat = matVec(X, beta);
  const residuals = y.map((yi, i) => yi - yHat[i]);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const rSquared = 1 - ssRes / ssTot;
  const adjR = 1 - (1 - rSquared) * (n - 1) / (n - k);
  const sigma2 = ssRes / (n - k); // residual variance

  // Standard errors of coefficients = sqrt(sigma2 * diag(XtX_inv))
  const seCoef = XtX_inv.map((row, i) => Math.sqrt(sigma2 * row[i]));

  // t-stat and approximate two-sided p-value via normal approximation
  // (n is large enough that t ≈ z; saves us a Student-t CDF implementation)
  const coefSummary = beta.map((b, i) => {
    const se = seCoef[i];
    const t = se > 0 ? b / se : 0;
    const p = approxPValueTwoSided(t);
    const ci95 = [b - 1.96 * se, b + 1.96 * se];
    return { coef: b, se, t, p, ci95 };
  });

  // Map back to variable IDs (skip intercept at index 0)
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
    earliestSaleDate: earliest.toISOString().split('T')[0],
    intercept: coefSummary[0],
    variables: variableResults,
    diagnostics: {
      rSquared,
      adjRSquared: adjR,
      residualStdError: Math.sqrt(sigma2),
      meanPrice: yMean,
    },
  };
}

// Two-sided p-value via the normal CDF approximation. Good enough for the
// "is this coefficient meaningfully different from zero" question that the
// UI displays as a star rating. Not for academic publication.
function approxPValueTwoSided(t) {
  const z = Math.abs(t);
  // Abramowitz & Stegun 7.1.26 erf approximation
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
// Recommendation reconciliation
// ---------------------------------------------------------------------------
//
// Takes a regression result + the user's current grid value for the same
// attribute and produces a "recommendation row" with status flag:
//   - 'agree'      grid value is within the 95% CI → keep current
//   - 'low'        regression suggests grid value is conservative (below CI)
//   - 'high'       regression suggests grid value is aggressive (above CI)
//   - 'weak'       p > 0.10, regression doesn't have enough signal to argue
//   - 'no-grid'    user has no current value to compare against

export function reconcile(variableResult, currentGridValue) {
  const v = variableResult;
  if (v.p > 0.10) {
    return {
      ...v,
      currentGridValue,
      status: 'weak',
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
// Top-level orchestrator
// ---------------------------------------------------------------------------

export function runAdjustmentStudy(properties, opts = {}) {
  const qualified = filterQualifiedSales(properties, opts);
  if (qualified.length === 0) {
    return { ok: false, error: 'No sales matched the filter (date range, NU codes, class).', dataset: { n: 0 } };
  }
  const fit = fitHedonicOLS(qualified, opts);
  if (!fit.ok) {
    return { ok: false, error: fit.error, dataset: { n: qualified.length } };
  }
  return {
    ok: true,
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
  };
}
