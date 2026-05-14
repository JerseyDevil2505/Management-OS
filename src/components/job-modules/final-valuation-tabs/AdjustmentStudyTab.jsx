import React, { useState, useMemo, useCallback } from 'react';
import { FlaskConical, Play, Info, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react';
import { runAdjustmentStudy, reconcile, STUDY_VARIABLES } from '../../../lib/adjustmentStudy';

const VALID_NU_CODES = ['', '0', '00', '7', '07'];
const RES_CLASSES = ['2'];

const fmtUSD = (v, digits = 0) => {
  if (v == null || !Number.isFinite(v)) return '\u2014';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
};

const fmtPct = (v, digits = 1) => {
  if (v == null || !Number.isFinite(v)) return '\u2014';
  return `${(v * 100).toFixed(digits)}%`;
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
  if (p < 0.001) return '\u2605\u2605\u2605';
  if (p < 0.01) return '\u2605\u2605';
  if (p < 0.05) return '\u2605';
  if (p < 0.10) return '\u00b7';
  return '';
};

// Pull a per-attribute "current grid value" out of the user's adjustment grid.
// Strategy: take the median non-zero value across brackets (the grid is
// bracket-aware; the study is currently whole-town, so a representative
// midpoint is the fair comparison). If every bracket is zero, return null.
function gridMidpoint(adjustmentRow) {
  if (!adjustmentRow || !Array.isArray(adjustmentRow.values)) return null;
  const nonZero = adjustmentRow.values.filter((v) => Number(v) !== 0).map(Number);
  if (nonZero.length === 0) return null;
  const sorted = [...nonZero].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Map STUDY_VARIABLES.appliesTo → adjustment row id used in AdjustmentsTab
const APPLIES_TO_GRID_ID = {
  living_area: 'living_area',
  lot_size_sf: 'lot_size_sf',
  bedrooms: 'bedrooms',
  fireplaces: 'fireplaces',
  // Condition + year don't have direct grid rows in the default config
  // (those live in attribute_condition_config and depreciation respectively).
  // We surface them informationally only.
};

const AdjustmentStudyTab = ({
  jobData = {},
  properties = [],
  adjustmentGrid = [],
  cspDateRange,
}) => {
  const [running, setRunning] = useState(false);
  const [study, setStudy] = useState(null);
  const [error, setError] = useState(null);

  const [opts, setOpts] = useState({
    salesDateStart: cspDateRange?.start || '',
    salesDateEnd: cspDateRange?.end || '',
    nuCodeAllowList: VALID_NU_CODES,
    classFilter: RES_CLASSES,
    minPrice: 1000,
    excludeCondoChildren: true,
  });

  const handleRun = useCallback(() => {
    setRunning(true);
    setError(null);
    // Defer to next frame so the spinner paints before the math blocks the UI.
    requestAnimationFrame(() => {
      try {
        const result = runAdjustmentStudy(properties, opts);
        if (!result.ok) {
          setError(result.error);
          setStudy(null);
        } else {
          setStudy(result);
        }
      } catch (e) {
        setError(e?.message || String(e));
        setStudy(null);
      } finally {
        setRunning(false);
      }
    });
  }, [properties, opts]);

  // Pre-compute reconciliation rows whenever the study or grid changes.
  const reconciledRows = useMemo(() => {
    if (!study?.ok) return [];
    return study.variables.map((v) => {
      const gridId = APPLIES_TO_GRID_ID[v.appliesTo];
      const gridRow = gridId ? adjustmentGrid.find((r) => r.id === gridId) : null;
      const gridMid = gridRow ? gridMidpoint(gridRow) : null;
      return reconcile(v, gridMid);
    });
  }, [study, adjustmentGrid]);

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
            Hedonic regression on your town&rsquo;s qualified sales. Coefficients are interpreted as the
            marginal market value of one unit of each attribute, holding the others constant.
            Compare against your current grid to decide whether the data supports keeping,
            raising, or lowering each adjustment. <strong>The tool surfaces evidence; you make the call.</strong>
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || properties.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Play className="w-4 h-4" />
          {running ? 'Running\u2026' : study ? 'Re-run Study' : 'Run Study'}
        </button>
      </div>

      {/* Filter controls */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sales Date From</label>
          <input
            type="date"
            value={opts.salesDateStart}
            onChange={(e) => setOpts({ ...opts, salesDateStart: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Sales Date To</label>
          <input
            type="date"
            value={opts.salesDateEnd}
            onChange={(e) => setOpts({ ...opts, salesDateEnd: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Property Class</label>
          <select
            value={opts.classFilter[0] || '2'}
            onChange={(e) => setOpts({ ...opts, classFilter: [e.target.value] })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            <option value="2">2 \u2014 Residential</option>
            <option value="3A">3A \u2014 Farm Regular</option>
            <option value="3B">3B \u2014 Farm Qualified</option>
            <option value="4A">4A \u2014 Commercial</option>
            <option value="4B">4B \u2014 Industrial</option>
            <option value="4C">4C \u2014 Apartment</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Min Sale Price</label>
          <input
            type="number"
            value={opts.minPrice}
            onChange={(e) => setOpts({ ...opts, minPrice: Number(e.target.value) || 0 })}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800">
          <strong>Could not run study:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!study && !error && (
        <div className="p-8 bg-gray-50 border border-dashed border-gray-300 rounded text-center text-gray-500 text-sm">
          Click <strong>Run Study</strong> to fit the regression on your filtered sales.
          The study runs entirely in your browser \u2014 nothing is saved until you click <em>Apply</em> on a row.
        </div>
      )}

      {/* Results */}
      {study?.ok && (
        <>
          {/* Dataset summary */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryStat label="Qualified Sales" value={study.dataset.n.toLocaleString()} />
            <SummaryStat label="Used in Model" value={study.dataset.nUsed.toLocaleString()} hint={`${study.dataset.n - study.dataset.nUsed} dropped (incomplete data)`} />
            <SummaryStat label="R\u00b2 (fit)" value={study.diagnostics.rSquared.toFixed(3)} hint={`Adj R\u00b2 ${study.diagnostics.adjRSquared.toFixed(3)}`} />
            <SummaryStat label="Mean Sale Price" value={fmtUSD(study.diagnostics.meanPrice)} />
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
                  <th className="px-4 py-3 text-center font-semibold" title="Statistical significance: \u2605\u2605\u2605 p<.001 \u2605\u2605 p<.01 \u2605 p<.05 \u00b7 p<.10">Sig.</th>
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
                        {row.currentGridValue == null ? <span className="text-gray-400">\u2014</span> : fmtUSD(row.currentGridValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmtUSD(row.coef)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                        {fmtUSD(row.ci95[0])} \u2013 {fmtUSD(row.ci95[1])}
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
              <li>Time variable (months since earliest sale) is included in the regression so other coefficients are net of market appreciation.</li>
              <li>Condo qualifiers (C*) excluded \u2014 they share footprints with the mother lot.</li>
              <li>Complete-case observations only \u2014 a sale missing any required attribute is dropped (no imputation).</li>
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
