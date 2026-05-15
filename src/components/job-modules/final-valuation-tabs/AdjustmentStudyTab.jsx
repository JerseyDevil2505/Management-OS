import React, { useState, useMemo, useCallback } from 'react';
import { FlaskConical, Play, Info, TrendingUp, TrendingDown, CheckCircle2, MinusCircle, ShieldCheck, Database } from 'lucide-react';
import {
  runAdjustmentStudy,
  reconcile,
  STUDY_VARIABLES,
  filterQualifiedSales,
  variableAvailability,
  salesPerYear,
} from '../../../lib/adjustmentStudy';
import { buildConditionRanker } from '../../../lib/conditionRanking';
import { STUDY_DEFAULT_SALES_CODES } from '../../../lib/salesCodes';

const fmtUSD = (v, digits = 0) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
};

const STATUS_STYLES = {
  agree: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', Icon: CheckCircle2, label: 'Agrees with grid' },
  low: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', Icon: TrendingUp, label: 'Grid is conservative' },
  high: { color: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200', Icon: TrendingDown, label: 'Grid is aggressive' },
  weak: { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200', Icon: MinusCircle, label: 'Weak signal (keep grid)' },
  'no-grid': { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200', Icon: Info, label: 'No grid value' },
};

const significanceStars = (p) => {
  if (p == null || !Number.isFinite(p)) return '';
  if (p < 0.001) return '★★★';
  if (p < 0.01) return '★★';
  if (p < 0.05) return '★';
  if (p < 0.10) return '·';
  return '';
};

// Median of non-zero bracket values, used as a representative "current grid"
// number to compare against the regression coefficient.
function gridMidpoint(adjustmentRow) {
  if (!adjustmentRow || !Array.isArray(adjustmentRow.values)) return null;
  const nonZero = adjustmentRow.values.filter((v) => Number(v) !== 0).map(Number);
  if (nonZero.length === 0) return null;
  const sorted = [...nonZero].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const APPLIES_TO_GRID_ID = {
  living_area: 'living_area',
  lot_size_sf: 'lot_size_sf',
  bedrooms: 'bedrooms',
  fireplaces: 'fireplaces',
  interior_condition: 'interior_condition',
  exterior_condition: 'exterior_condition',
};

// Year chips for the vetted-mode quick filter
const YEAR_CHIPS = [
  { id: 'all', label: 'All Time', years: null },
  { id: '5y', label: 'Last 5 yr', years: 5 },
  { id: '3y', label: 'Last 3 yr', years: 3 },
  { id: '2y', label: 'Last 2 yr', years: 2 },
  { id: '1y', label: 'Last 1 yr', years: 1 },
];

const CLASS_OPTIONS = [
  { value: '2', label: '2 — Residential' },
  { value: '3A', label: '3A — Farm Regular' },
  { value: '3B', label: '3B — Farm Qualified' },
  { value: '4A', label: '4A — Commercial' },
  { value: '4B', label: '4B — Industrial' },
  { value: '4C', label: '4C — Apartment' },
];

// Lojik-aware reference year — same convention as
// SalesComparisonTab.getCSPDateRange and CoordinatesSubTab.salesWindow.
function getReferenceYear(jobData, tenantConfig) {
  const isLojik = tenantConfig?.orgType === 'assessor'
    || jobData?.organizations?.org_type === 'assessor'
    || jobData?.org_type === 'assessor';
  const end = jobData?.end_date ? new Date(jobData.end_date) : null;
  if (!end || !Number.isFinite(end.getTime())) return new Date().getFullYear();
  const raw = end.getFullYear();
  return isLojik ? raw - 1 : raw;
}

const AdjustmentStudyTab = ({
  jobData = {},
  properties = [],
  adjustmentGrid = [],
  cspDateRange,
  tenantConfig,
}) => {
  const [running, setRunning] = useState(false);
  const [study, setStudy] = useState(null);
  const [error, setError] = useState(null);

  // Mode: vetted (default) vs all-allowable
  const [mode, setMode] = useState('vetted');

  // Vetted-mode date scoping: chip-driven
  const [yearChip, setYearChip] = useState('all');

  // All-mode: explicit date pickers
  const [allDateStart, setAllDateStart] = useState(cspDateRange?.start || '');
  const [allDateEnd, setAllDateEnd] = useState(cspDateRange?.end || '');

  // Class + min price
  const [classFilter, setClassFilter] = useState(['2']);
  const [minPrice, setMinPrice] = useState(1000);

  // Variable selection (for the pre-flight availability panel).
  // Default-on: high-coverage core variables. Sparse ones (fireplaces,
  // exterior condition) are opt-in so the first run isn't blocked by a
  // single rarely-populated field.
  const DEFAULT_ON_IDS = ['sfla', 'lot_sf', 'age', 'bedrooms', 'condition_int'];
  const [includeIds, setIncludeIds] = useState(
    () => STUDY_VARIABLES
      .filter((v) => DEFAULT_ON_IDS.includes(v.id))
      .map((v) => v.id)
  );

  // Build the condition ranker once per job — closes over jobData.attribute_condition_config
  const conditionRanker = useMemo(() => buildConditionRanker(jobData), [jobData]);

  // Compose filter opts from current state. Pure derivation, used in three
  // places: pre-flight availability, sales-per-year chart, and the run.
  const opts = useMemo(() => {
    const base = {
      mode,
      classFilter,
      minPrice,
      excludeCondoChildren: true,
      salesCodes: STUDY_DEFAULT_SALES_CODES,
      includeVariables: mode === 'vetted'
        ? includeIds.filter((id) => id !== 'time_months')
        : [...includeIds, 'time_months'],
      ctx: { conditionRanker },
    };
    if (mode === 'vetted') {
      const chip = YEAR_CHIPS.find((c) => c.id === yearChip);
      if (chip?.years != null) {
        const refYear = getReferenceYear(jobData, tenantConfig);
        // Window = (refYear - years + 1, 1, 1) → (refYear, 12, 31)
        base.salesDateStart = `${refYear - chip.years + 1}-01-01`;
        base.salesDateEnd = `${refYear}-12-31`;
      }
    } else {
      base.salesDateStart = allDateStart;
      base.salesDateEnd = allDateEnd;
    }
    return base;
  }, [mode, classFilter, minPrice, includeIds, yearChip, allDateStart, allDateEnd, conditionRanker, jobData, tenantConfig]);

  // Pre-flight: qualified sales + per-variable availability + per-year counts.
  // Recomputes whenever filters change. Cheap (linear in N).
  const preflight = useMemo(() => {
    const qualified = filterQualifiedSales(properties, opts);
    const avail = variableAvailability(qualified, opts.ctx);
    const perYear = salesPerYear(qualified);
    // Estimated complete-case N for the currently-selected variables
    const sel = new Set(opts.includeVariables.filter((id) => id !== 'time_months'));
    let completeCase = 0;
    for (const p of qualified) {
      let ok = true;
      for (const v of STUDY_VARIABLES) {
        if (!sel.has(v.id) || v.id === 'time_months') continue;
        const x = v.extract ? v.extract(p, opts.ctx) : null;
        if (x == null) { ok = false; break; }
      }
      // Need a positive dependent variable too
      const yField = mode === 'vetted' ? 'values_norm_time' : 'sales_price';
      if (ok && (!Number(p[yField]) || Number(p[yField]) <= 0)) ok = false;
      if (ok) completeCase += 1;
    }
    return { qualified, avail, perYear, completeCase };
  }, [properties, opts, mode]);

  const handleRun = useCallback(() => {
    setRunning(true);
    setError(null);
    requestAnimationFrame(() => {
      try {
        const result = runAdjustmentStudy(properties, opts);
        if (!result.ok) { setError(result.error); setStudy(null); }
        else setStudy(result);
      } catch (e) {
        setError(e?.message || String(e));
        setStudy(null);
      } finally {
        setRunning(false);
      }
    });
  }, [properties, opts]);

  const reconciledRows = useMemo(() => {
    if (!study?.ok) return [];
    return study.variables.map((v) => {
      const gridId = APPLIES_TO_GRID_ID[v.appliesTo];
      const gridRow = gridId ? adjustmentGrid.find((r) => r.id === gridId) : null;
      const gridMid = gridRow ? gridMidpoint(gridRow) : null;
      return reconcile(v, gridMid);
    });
  }, [study, adjustmentGrid]);

  const conditionConfigured = !!jobData?.attribute_condition_config?.interior;

  return (
    <div className="adjustment-study-tab">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-purple-600" />
            Adjustment Study (Evidence-Based)
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-3xl">
            Hedonic regression on your town&rsquo;s qualified sales. Coefficients are interpreted as
            the marginal market value of one unit of each attribute, holding the others constant.
            Compare against your current grid to decide whether the data supports keeping,
            raising, or lowering each adjustment. <strong>The tool surfaces evidence; you make the call.</strong>
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || properties.length === 0 || preflight.completeCase < 20}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Play className="w-4 h-4" />
          {running ? 'Running…' : study ? 'Re-run Study' : 'Run Study'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="mb-4 inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden text-sm">
        <button
          onClick={() => setMode('vetted')}
          className={`px-4 py-2 inline-flex items-center gap-2 ${mode === 'vetted' ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          title="Use only sales already vetted by the time-normalization workflow."
        >
          <ShieldCheck className="w-4 h-4" />
          Vetted Sales (recommended)
        </button>
        <button
          onClick={() => setMode('all')}
          className={`px-4 py-2 inline-flex items-center gap-2 border-l border-gray-300 ${mode === 'all' ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          title="Use all sales matching the CME allowable codes + date window."
        >
          <Database className="w-4 h-4" />
          All Allowable Sales
        </button>
      </div>

      {/* Mode explainer */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        {mode === 'vetted' ? (
          <>
            <strong>Vetted mode:</strong> Dependent variable is <code className="px-1 bg-blue-100 rounded">values_norm_time</code>{' '}
            — sales already vetted AND already time-adjusted to the valuation date by the
            normalization workflow. Estate / short / sheriff sales never pass that vetting,
            so they're excluded automatically. The time variable is dropped from the regression
            because the dependent variable is already detrended.
          </>
        ) : (
          <>
            <strong>All-allowable mode:</strong> Dependent variable is raw <code className="px-1 bg-blue-100 rounded">sales_price</code>{' '}
            filtered by the same NU code allowlist CME uses ({STUDY_DEFAULT_SALES_CODES.join(', ')})
            and your date window. A time-trend variable is included so other coefficients are
            net of market appreciation. Use this when you want to see ALL allowable sales
            (e.g. to verify the vetted view), not as the defensible primary.
          </>
        )}
      </div>

      {/* Filter row */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Property Class</label>
          <select
            value={classFilter[0] || '2'}
            onChange={(e) => setClassFilter([e.target.value])}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            {CLASS_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {mode === 'vetted' ? (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Sales Window</label>
            <div className="flex flex-wrap gap-1.5">
              {YEAR_CHIPS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setYearChip(c.id)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition ${
                    yearChip === c.id
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sales Date From</label>
              <input
                type="date"
                value={allDateStart}
                onChange={(e) => setAllDateStart(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sales Date To</label>
              <input
                type="date"
                value={allDateEnd}
                onChange={(e) => setAllDateEnd(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Min Sale Price</label>
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(Number(e.target.value) || 0)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
          </>
        )}
      </div>

      {/* Pre-flight: variable availability + complete-case N */}
      <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Variable Availability</div>
            <div className="text-xs text-gray-600">
              Uncheck sparse variables to keep more sales in the model.
              {!conditionConfigured && (
                <span className="ml-2 text-amber-700">
                  ⚠ Condition ranking not configured for this job — go to Market Analysis → Attribute Cards first.
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Qualified sales</div>
            <div className="text-2xl font-bold text-gray-900">{preflight.qualified.length.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              <span className={preflight.completeCase < 50 ? 'text-amber-700 font-semibold' : 'text-green-700'}>
                {preflight.completeCase.toLocaleString()}
              </span>{' '}
              with complete data for selected variables
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {preflight.avail.map((a) => {
            const checked = includeIds.includes(a.id);
            const sparse = a.pct < 0.5;
            return (
              <label
                key={a.id}
                className={`flex items-center gap-2 p-2 border rounded cursor-pointer text-sm ${
                  checked ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'
                } ${sparse ? 'opacity-75' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) setIncludeIds([...includeIds, a.id]);
                    else setIncludeIds(includeIds.filter((id) => id !== a.id));
                  }}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{a.label}</div>
                  <div className={`text-xs ${sparse ? 'text-amber-700' : 'text-gray-500'}`}>
                    {a.count.toLocaleString()} / {preflight.qualified.length.toLocaleString()} ({(a.pct * 100).toFixed(0)}%)
                    {sparse && ' — sparse'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Sales per year mini-chart */}
        {preflight.perYear.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-gray-600 mb-1">Sales per year (qualified)</div>
            <div className="flex items-end gap-1 h-16">
              {(() => {
                const maxCount = Math.max(...preflight.perYear.map((p) => p.count));
                return preflight.perYear.map((p) => (
                  <div key={p.year} className="flex-1 flex flex-col items-center min-w-[24px]" title={`${p.year}: ${p.count} sales`}>
                    <div
                      className="w-full bg-purple-400 rounded-t"
                      style={{ height: `${(p.count / maxCount) * 100}%`, minHeight: '2px' }}
                    />
                    <div className="text-[10px] text-gray-600 mt-0.5">{String(p.year).slice(-2)}</div>
                    <div className="text-[10px] text-gray-500">{p.count}</div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800">
          <strong>Could not run study:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!study && !error && (
        <div className="p-6 bg-gray-50 border border-dashed border-gray-300 rounded text-center text-gray-500 text-sm">
          Adjust filters above and click <strong>Run Study</strong>. Math runs entirely in your browser.
        </div>
      )}

      {/* Results */}
      {study?.ok && (
        <>
          {/* Dataset summary */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryStat label="Mode" value={study.mode === 'vetted' ? 'Vetted' : 'All Allowable'} hint={study.diagnostics.dependentField} />
            <SummaryStat label="Used in Model" value={study.dataset.nUsed.toLocaleString()} hint={`${study.dataset.n} qualified, ${study.dataset.n - study.dataset.nUsed} dropped`} />
            <SummaryStat label="R²" value={study.diagnostics.rSquared.toFixed(3)} hint={`Adj R² ${study.diagnostics.adjRSquared.toFixed(3)}`} />
            <SummaryStat label="Mean Price" value={fmtUSD(study.diagnostics.meanPrice)} />
            <SummaryStat label="Residual Std Err" value={fmtUSD(study.diagnostics.residualStdError)} hint="Typical model error" />
          </div>

          {/* Reconciliation table */}
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Attribute</th>
                  <th className="px-4 py-3 text-right font-semibold">Current Grid (mid)</th>
                  <th className="px-4 py-3 text-right font-semibold">Regression Coef.</th>
                  <th className="px-4 py-3 text-right font-semibold">95% CI</th>
                  <th className="px-4 py-3 text-center font-semibold" title="★★★ p<.001  ★★ p<.01  ★ p<.05  · p<.10">Sig.</th>
                  <th className="px-4 py-3 text-left font-semibold">Recommendation</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {reconciledRows.map((row) => {
                  const style = STATUS_STYLES[row.status] || STATUS_STYLES['no-grid'];
                  const Icon = style.Icon;
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.label}</div>
                        <div className="text-xs text-gray-500">{row.unit}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.currentGridValue == null ? <span className="text-gray-400">—</span> : fmtUSD(row.currentGridValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmtUSD(row.coef)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                        {fmtUSD(row.ci95[0])} – {fmtUSD(row.ci95[1])}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-amber-600" title={`p = ${row.p?.toExponential(2) || 'n/a'}`}>
                        {significanceStars(row.p)}
                      </td>
                      <td className={`px-4 py-3 ${style.bg} border-l ${style.border}`}>
                        <div className={`flex items-start gap-2 text-xs ${style.color}`}>
                          <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold">{style.label}</div>
                            <div className="mt-0.5 text-gray-700">{row.message}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Methodology footer */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
            <div className="font-semibold mb-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> Methodology
            </div>
            <ul className="list-disc ml-5 space-y-0.5">
              <li>Linear-additive hedonic OLS, IAAO standard form. Coefficients = $ contribution per unit of each attribute, holding the others constant.</li>
              <li>Condition rank uses your job's <em>Attribute Cards</em> configuration (baseline / better / worse).</li>
              <li>Condo qualifiers (C*) excluded — they share footprints with the mother lot.</li>
              <li>Complete-case observations only — a sale missing any selected variable is dropped (no imputation).</li>
              <li>P-values are normal approximations of two-sided t-tests. <strong>Apply professional judgment</strong> before overriding any grid value.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

const SummaryStat = ({ label, value, hint }) => (
  <div className="p-3 bg-white border border-gray-200 rounded shadow-sm">
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="mt-1 text-xl font-bold text-gray-900">{value}</div>
    {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
  </div>
);

export default AdjustmentStudyTab;
