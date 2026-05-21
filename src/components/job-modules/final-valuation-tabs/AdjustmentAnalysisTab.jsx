import React, { useState, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  Database,
  Play,
  Info,
  Download,
  Anchor,
  Hourglass,
  X,
} from 'lucide-react';
import {
  CME_BRACKETS,
  GRID_ATTRIBUTE_MAP,
  ANALYSIS_FLOOR,
  ANALYSIS_COMFORTABLE,
  HIT_TOLERANCE,
  runAnalysis,
} from '../../../lib/adjustmentAnalysis';
import { exportAdjustmentAnalysisPdf } from '../../../lib/adjustmentAnalysisPdf';
import { STUDY_DEFAULT_SALES_CODES } from '../../../lib/salesCodes';

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
const fmtMoney = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toFixed(2)}`;
};

const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);

// Color → Tailwind classes for the colored cells / chips. Stays within the
// app's already-compiled palette (green/yellow/red/gray/purple) so JIT
// actually emits these. Muted via -50 backgrounds and -400 dots.
const COLOR_CLASSES = {
  green:    { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-400' },
  yellow:   { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-400' },
  red:      { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400' },
  grey:     { bg: 'bg-gray-50',   text: 'text-gray-500',   border: 'border-gray-200',   dot: 'bg-gray-300' },
  pending:  { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', dot: 'bg-purple-300' },
  inactive: { bg: 'bg-white',     text: 'text-gray-300',   border: 'border-gray-100',   dot: 'bg-gray-200' },
  unpriced: { bg: 'bg-white',     text: 'text-gray-300',   border: 'border-gray-100',   dot: 'bg-gray-200' },
};

// Small soft CSS dot — replaces the high-saturation emoji circles so the
// grid reads as a heatmap, not a traffic light.
const ColorDot = ({ color = 'grey', size = 'md' }) => {
  const c = COLOR_CLASSES[color] || COLOR_CLASSES.grey;
  const cls = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  return <span className={`inline-block rounded-full ${cls} ${c.dot}`} aria-hidden="true" />;
};

const YEAR_CHIPS = [
  { id: 'all', label: 'All Time', years: null },
  { id: '5y',  label: 'Last 5 yr', years: 5 },
  { id: '3y',  label: 'Last 3 yr', years: 3 },
  { id: '2y',  label: 'Last 2 yr', years: 2 },
  { id: '1y',  label: 'Last 1 yr', years: 1 },
];

const CLASS_OPTIONS = [
  { value: '2',  label: '2 — Residential' },
  { value: '3A', label: '3A — Farm Regular' },
  { value: '3B', label: '3B — Farm Qualified' },
  { value: '4A', label: '4A — Commercial' },
  { value: '4B', label: '4B — Industrial' },
  { value: '4C', label: '4C — Apartment' },
];

function getReferenceYear(jobData, tenantConfig) {
  const isLojik = tenantConfig?.orgType === 'assessor'
    || jobData?.organizations?.org_type === 'assessor'
    || jobData?.org_type === 'assessor';
  const end = jobData?.end_date ? new Date(jobData.end_date) : null;
  if (!end || !Number.isFinite(end.getTime())) return new Date().getFullYear();
  const raw = end.getFullYear();
  return isLojik ? raw - 1 : raw;
}

// ---------------------------------------------------------------------------
// Plain-English drill-in content
// ---------------------------------------------------------------------------
function bracketDrillText(b) {
  const lines = [];
  if (b.verdict.band === 'cant_verify') {
    lines.push(`Only ${b.n} qualified sales in this bracket — not enough to evaluate.`);
    return lines;
  }
  lines.push(`${b.n} qualified sales in this bracket. Your grid predicted ${b.hits} of them accurately (within ±10% of sale price).`);
  const drift = b.medianSignedError;
  if (b.verdict.color === 'green') {
    if (drift != null && Math.abs(drift) > 0) {
      lines.push(`Typical miss was about ${fmtMoney(drift)} ${drift > 0 ? 'low' : 'high'} — well within market noise.`);
    } else {
      lines.push('No systematic drift in the misses — they balance out.');
    }
  } else if (b.verdict.color === 'yellow') {
    lines.push(`Sales came in about ${fmtMoney(Math.abs(drift))} ${drift > 0 ? 'higher' : 'lower'} than your grid predicted, on average — some drift to review.`);
  } else if (b.verdict.color === 'red') {
    lines.push(`Sales came in about ${fmtMoney(Math.abs(drift))} ${drift > 0 ? 'higher' : 'lower'} than your grid predicted, on average — significant drift, worth reviewing.`);
  }
  return lines;
}

function attrDrillText(b, attrId, def) {
  const cell = b.perAttribute?.[attrId];
  const label = def.label;
  if (!cell) return [`${label} — no data for this bracket.`];
  if (cell.color === 'pending') return [`${label} — extractor not yet wired. The data is not feeding into the analysis for this attribute.`];
  if (cell.color === 'inactive') return [`${label} — this lot-size method is not active for this job, so it's intentionally excluded.`];
  if (cell.color === 'unpriced') return [`${label} — your grid value for this bracket is zero, so this attribute isn't contributing to the prediction here.`];
  if (cell.noSpread) return [`${label} — the sales in this bracket don't vary enough on this attribute to read a drift signal.`];
  const lines = [];
  const diff = cell.diff;
  if (cell.color === 'green') {
    lines.push(`Your ${label.toLowerCase()} adjustment is performing well in this bracket — no systematic drift between sales above and below the typical value.`);
  } else if (cell.color === 'yellow') {
    if (diff > 0) {
      lines.push(`Sales with more ${label.toLowerCase()} than the bracket's typical house tend to come in ${fmtMoney(Math.abs(diff))} above your grid's prediction. Worth a look at this adjustment for this bracket.`);
    } else {
      lines.push(`Sales with more ${label.toLowerCase()} than the bracket's typical house tend to come in ${fmtMoney(Math.abs(diff))} below your grid's prediction. Worth a look at this adjustment for this bracket.`);
    }
  } else if (cell.color === 'red') {
    lines.push(`Sales with more ${label.toLowerCase()} than the bracket's typical house come in ${fmtMoney(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} your grid's prediction — significant signal in this bracket.`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Sales-per-year mini-bar chart
// ---------------------------------------------------------------------------
const SalesYearBars = ({ data }) => {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-12">
      {data.map((d) => (
        <div key={d.year} className="flex flex-col items-center" title={`${d.year}: ${d.count} sales`}>
          <div
            className="w-5 bg-blue-400 rounded-t"
            style={{ height: `${Math.max(4, (d.count / max) * 40)}px` }}
          />
          <div className="text-[10px] text-gray-500 mt-0.5">'{String(d.year).slice(-2)}</div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const AdjustmentAnalysisTab = ({
  jobData = {},
  properties = [],
  adjustmentGrid = [],
  cspDateRange,
  tenantConfig,
}) => {
  const [running, setRunning] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [drillIn, setDrillIn] = useState(null); // { kind:'bracket'|'attr', bracketIdx, attrId? }

  const [mode, setMode] = useState('vetted');
  const [yearChip, setYearChip] = useState('all');
  const [allDateStart, setAllDateStart] = useState(cspDateRange?.start || '');
  const [allDateEnd, setAllDateEnd] = useState(cspDateRange?.end || '');
  const [classFilter, setClassFilter] = useState(['2']);
  const [minPrice] = useState(1000);

  const opts = useMemo(() => {
    const base = {
      mode,
      classFilter,
      minPrice,
      excludeCondoChildren: true,
      salesCodes: STUDY_DEFAULT_SALES_CODES,
    };
    if (mode === 'vetted') {
      const chip = YEAR_CHIPS.find((c) => c.id === yearChip);
      if (chip?.years != null) {
        const refYear = getReferenceYear(jobData, tenantConfig);
        base.salesDateStart = `${refYear - chip.years + 1}-01-01`;
        base.salesDateEnd = `${refYear}-12-31`;
      }
    } else {
      base.salesDateStart = allDateStart;
      base.salesDateEnd = allDateEnd;
    }
    return base;
  }, [mode, classFilter, minPrice, yearChip, allDateStart, allDateEnd, jobData, tenantConfig]);

  const handleRun = useCallback(() => {
    setRunning(true);
    setError(null);
    setCopied(false);
    setDrillIn(null);
    requestAnimationFrame(() => {
      try {
        const result = runAnalysis({ properties, gridRows: adjustmentGrid, opts: { ...opts, jobData } });
        if (!result.ok) { setError(result.error); setAnalysis(null); }
        else setAnalysis(result);
      } catch (e) {
        setError(e?.message || String(e));
        setAnalysis(null);
      } finally {
        setRunning(false);
      }
    });
  }, [properties, adjustmentGrid, opts, jobData]);

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (!analysis || exporting) return;
    setExporting(true);
    try {
      await exportAdjustmentAnalysisPdf(analysis, {
        jobName: jobData?.job_name || jobData?.name || jobData?.municipality || '',
        county: jobData?.county || jobData?.county_name || '',
        jobId: jobData?.id || '',
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('PDF export failed', err);
      setError(err?.message || String(err));
    } finally {
      setExporting(false);
    }
  }, [analysis, jobData, exporting]);

  // Visible brackets in the grid = those that landed any sales at all. (We
  // still show "Can't verify" columns for ones in the schedule that have a
  // few sales but below floor; they're greyed.)
  const visibleBrackets = analysis?.perBracket?.filter((b) => b.n > 0 || b.nInBracket > 0) || [];

  const attrEntries = Object.entries(GRID_ATTRIBUTE_MAP);

  return (
    <div className="adjustment-analysis-tab">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Adjustment Analysis
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-3xl">
            Applies your adjustment grid to every qualified sale and reports how often the prediction lands within ±10% of the sale price. The tool measures grid performance — it never proposes adjustment values.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || properties.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Play className="w-4 h-4" />
          {running ? 'Running…' : analysis ? 'Re-run Analysis' : 'Run Analysis'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="mb-2 inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden text-sm">
        <button
          onClick={() => setMode('vetted')}
          className={`px-4 py-2 inline-flex items-center gap-2 ${mode === 'vetted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          <ShieldCheck className="w-4 h-4" /> Vetted Sales (recommended)
        </button>
        <button
          onClick={() => setMode('all')}
          className={`px-4 py-2 inline-flex items-center gap-2 border-l border-gray-300 ${mode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          <Database className="w-4 h-4" /> All Allowable Sales
        </button>
      </div>
      <div className="mb-4 text-xs text-gray-600">
        {mode === 'vetted' ? (
          <>Predictions are compared against <code className="px-1 bg-gray-100 rounded">values_norm_time</code> — the time-adjusted price from the normalization workflow. Brackets use raw sale price.</>
        ) : (
          <>Predictions are compared against raw <code className="px-1 bg-gray-100 rounded">sales_price</code>. Best paired with a recent date window so untreated time-trend doesn't distort the test.</>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
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
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Sales Window</label>
            <div className="flex flex-wrap gap-1.5">
              {YEAR_CHIPS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setYearChip(c.id)}
                  className={`px-3 py-1.5 text-xs rounded-full border transition ${
                    yearChip === c.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
              <input type="date" value={allDateStart} onChange={(e) => setAllDateStart(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
              <input type="date" value={allDateEnd} onChange={(e) => setAllDateEnd(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" />
            </div>
          </div>
        )}
      </div>

      {/* Pre-flight */}
      {analysis?.ok && (
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3 p-3 bg-blue-50 border border-blue-200 rounded">
          <div className="text-sm text-blue-900">
            <span className="font-semibold">{analysis.nQualifiedTotal.toLocaleString()}</span> qualified sales,{' '}
            <span className="font-semibold">{analysis.nLandedInAnyBracket.toLocaleString()}</span> landed in a CME bracket.
            {analysis.anchorIdx >= 0 && (
              <span className="ml-3 inline-flex items-center gap-1 text-blue-800">
                <Anchor className="w-3.5 h-3.5" />
                Anchor: {CME_BRACKETS[analysis.anchorIdx].shortLabel}
              </span>
            )}
          </div>
          <SalesYearBars data={analysis.salesPerYear} />
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Generating…' : copied ? 'PDF downloaded' : 'Export for Tax Board'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <strong>Could not run analysis:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!analysis && !error && (
        <div className="p-6 bg-gray-50 border border-dashed border-gray-300 rounded text-center text-gray-500 text-sm">
          Set the mode, class, and date window, then click <strong>Run Analysis</strong>. The tool will apply your adjustment grid to each qualified sale and report the hit rate per bracket.
        </div>
      )}

      {/* Results — the legacy grid */}
      {analysis?.ok && visibleBrackets.length > 0 && (
        <>
          {/* Lot-size warning */}
          {analysis.lotSize?.warning && (
            <div className="mb-4 p-3 bg-orange-50 border border-orange-300 rounded text-sm text-orange-900">
              <div className="font-semibold mb-1">Multiple lot-size methods have values in the grid.</div>
              <div className="text-xs">{analysis.lotSize.warning}</div>
            </div>
          )}

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 text-left text-xs font-semibold text-gray-700 px-3 py-2 border-b border-gray-200 min-w-[180px]">
                    Attribute
                  </th>
                  {visibleBrackets.map((b) => {
                    const c = COLOR_CLASSES[b.verdict.color];
                    const interactable = b.verdict.band !== 'cant_verify';
                    return (
                      <th
                        key={b.bracketIdx}
                        onClick={() => interactable && setDrillIn({ kind: 'bracket', bracketIdx: b.bracketIdx })}
                        className={`text-center px-2 py-2 border-b border-l border-gray-200 align-top min-w-[120px] ${interactable ? 'cursor-pointer hover:bg-gray-100' : ''} ${b.isAnchor ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
                      >
                        <div className="text-xs font-semibold text-gray-800">{b.bracket.shortLabel}</div>
                        {b.isAnchor && (
                          <div className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white mt-0.5">
                            <Anchor className="w-2.5 h-2.5" /> Anchor
                          </div>
                        )}
                        <div className="text-[11px] text-gray-600 mt-1">{b.n} sales</div>
                        <div className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-1 border ${c.bg} ${c.text} ${c.border}`}>
                          {b.verdict.label}
                        </div>
                        <div className="text-xs mt-1 inline-flex items-center gap-1.5 text-gray-700">
                          <ColorDot color={b.verdict.color} />
                          <span className="font-medium">
                            {b.hitRate != null ? `${pct(b.hitRate)} hit` : '—'}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {attrEntries.map(([attrId, def]) => (
                  <tr key={attrId} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white text-xs font-medium text-gray-800 px-3 py-2 border-b border-gray-100">
                      {def.label}
                      {def.pending && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-purple-700">
                          <Hourglass className="w-3 h-3" /> pending
                        </span>
                      )}
                    </td>
                    {visibleBrackets.map((b) => {
                      const cell = b.perAttribute?.[attrId] || { color: 'grey' };
                      const c = COLOR_CLASSES[cell.color] || COLOR_CLASSES.grey;
                      const interactable = !['inactive', 'pending'].includes(cell.color)
                        && b.verdict.band !== 'cant_verify';
                      return (
                        <td
                          key={b.bracketIdx}
                          onClick={() => interactable && setDrillIn({ kind: 'attr', bracketIdx: b.bracketIdx, attrId })}
                          className={`text-center px-2 py-2 border-b border-l border-gray-100 ${c.bg} ${interactable ? 'cursor-pointer hover:opacity-80' : ''}`}
                        >
                          <ColorDot color={cell.color} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Methodology footer */}
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
            <div className="font-semibold mb-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> Methodology
            </div>
            <p>
              Tolerance is set at ±{Math.round(HIT_TOLERANCE * 100)}% of sale price, consistent with USPAP guidance on individual adjustment limits. The tool evaluates the performance of the user's existing grid against qualified sales — it does not derive or propose adjustment values.
            </p>
            <p className="mt-1 text-gray-600">
              Brackets with fewer than {ANALYSIS_FLOOR} sales are reported as "Can't verify." Brackets with {ANALYSIS_FLOOR}–{ANALYSIS_COMFORTABLE - 1} sales are evaluated with "Limited" flagging. Brackets with {ANALYSIS_COMFORTABLE}+ sales receive full verification.
            </p>
          </div>
        </>
      )}

      {/* Drill-in card */}
      {drillIn && analysis?.ok && (() => {
        const b = analysis.perBracket[drillIn.bracketIdx];
        if (!b) return null;
        const isAttr = drillIn.kind === 'attr';
        const def = isAttr ? GRID_ATTRIBUTE_MAP[drillIn.attrId] : null;
        const lines = isAttr ? attrDrillText(b, drillIn.attrId, def) : bracketDrillText(b);
        const colorKey = isAttr
          ? (b.perAttribute?.[drillIn.attrId]?.color || 'grey')
          : b.verdict.color;
        const colorClass = COLOR_CLASSES[colorKey] || COLOR_CLASSES.grey;
        return (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setDrillIn(null)}>
            <div
              className="bg-white border border-gray-200 rounded-lg shadow-xl max-w-lg w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-base font-semibold text-gray-900">
                    {isAttr ? `${def?.label} — ${b.bracket.label}` : b.bracket.label}
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${colorClass.bg} ${colorClass.text} ${colorClass.border}`}>
                    <ColorDot color={colorKey} />
                    {isAttr
                      ? (colorKey === 'green' ? 'Looks clean' : colorKey === 'yellow' ? 'Some drift' : colorKey === 'red' ? 'Drift detected' : 'No signal')
                      : b.verdict.label}
                  </span>
                </div>
                <button onClick={() => setDrillIn(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="text-sm text-gray-800 space-y-2">
                {lines.map((l, i) => <p key={i}>{l}</p>)}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AdjustmentAnalysisTab;
