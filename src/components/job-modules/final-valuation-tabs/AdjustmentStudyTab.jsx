import React, { useState, useMemo, useCallback } from 'react';
import {
  ShieldCheck,
  Database,
  Play,
  Info,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Hourglass,
  ClipboardCopy,
  Anchor,
} from 'lucide-react';
import {
  CME_BRACKETS,
  GRID_ATTRIBUTE_MAP,
  isAttributeReady,
  runAudit,
  buildDocumentationBlock,
  VERIFY_FLOOR,
  VERIFY_COMFORTABLE,
} from '../../../lib/adjustmentAudit';
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

const VERDICT_STYLES = {
  verified:    { color: 'text-green-800',  bg: 'bg-green-50',  border: 'border-green-300',  Icon: CheckCircle2,  label: 'Verified' },
  limited:     { color: 'text-yellow-800', bg: 'bg-yellow-50', border: 'border-yellow-300', Icon: AlertTriangle, label: 'Limited support' },
  cant_verify: { color: 'text-gray-700',   bg: 'bg-gray-50',   border: 'border-gray-300',   Icon: HelpCircle,    label: "Can't verify" },
  pending:     { color: 'text-purple-800', bg: 'bg-purple-50', border: 'border-purple-300', Icon: Hourglass,     label: 'Extractor pending' },
};

const COMPARISON_BADGES = {
  inside:  { label: 'Supported',    color: 'bg-green-100 text-green-800 border-green-300' },
  below:   { label: 'Grid is low',  color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  above:   { label: 'Grid is high', color: 'bg-red-100 text-red-800 border-red-300' },
  no_grid: { label: 'No grid',      color: 'bg-gray-100 text-gray-700 border-gray-300' },
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
// Component
// ---------------------------------------------------------------------------
const AdjustmentStudyTab = ({
  jobData = {},
  properties = [],
  adjustmentGrid = [],
  cspDateRange,
  tenantConfig,
}) => {
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Attribute selector — default to Living Area (almost always populated)
  const [attrId, setAttrId] = useState('living_area');

  // Filters
  const [mode, setMode] = useState('vetted');
  const [yearChip, setYearChip] = useState('all');
  const [allDateStart, setAllDateStart] = useState(cspDateRange?.start || '');
  const [allDateEnd, setAllDateEnd] = useState(cspDateRange?.end || '');
  const [classFilter, setClassFilter] = useState(['2']);
  const [minPrice, setMinPrice] = useState(1000);

  const opts = useMemo(() => {
    const base = {
      mode,
      classFilter,
      minPrice,
      excludeCondoChildren: true,
      salesCodes: STUDY_DEFAULT_SALES_CODES,
      includeVariables: [],
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
    requestAnimationFrame(() => {
      try {
        const result = runAudit({ attrId, properties, gridRows: adjustmentGrid, opts: { ...opts, jobData } });
        if (!result.ok) { setError(result.error); setAudit(null); }
        else setAudit(result);
      } catch (e) {
        setError(e?.message || String(e));
        setAudit(null);
      } finally {
        setRunning(false);
      }
    });
  }, [attrId, properties, adjustmentGrid, opts, jobData]);

  const handleCopy = useCallback(async () => {
    if (!audit) return;
    const block = buildDocumentationBlock(audit, jobData?.job_name || jobData?.name || '');
    try {
      await navigator.clipboard.writeText(block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: open prompt
      window.prompt('Copy the documentation block:', block);
    }
  }, [audit, jobData]);

  // ---- Attribute dropdown options. Pending entries are visually distinct. ----
  const attrOptions = Object.entries(GRID_ATTRIBUTE_MAP).map(([id, def]) => ({
    id, label: def.label, pending: !!def.pending,
  }));

  const selectedDef = GRID_ATTRIBUTE_MAP[attrId];
  const selectedReady = isAttributeReady(attrId);

  return (
    <div className="adjustment-study-tab">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Adjustment Audit
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-3xl">
            For one attribute at a time, the audit checks whether your grid value in each market
            bracket is consistent with the actual sales in that bracket — after stripping the
            other adjustments using each sale's own bracket column.
            <strong> The grid value goes in as judgment; the data audits it. Nothing is auto-derived.</strong>
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || properties.length === 0 || !selectedReady}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          title={!selectedReady ? 'Selected attribute is not yet wired (extractor pending).' : ''}
        >
          <Play className="w-4 h-4" />
          {running ? 'Running…' : audit ? 'Re-run Audit' : 'Run Audit'}
        </button>
      </div>

      {/* Mode toggle */}
      <div className="mb-2 inline-flex rounded-md shadow-sm border border-gray-300 overflow-hidden text-sm">
        <button
          onClick={() => setMode('vetted')}
          className={`px-4 py-2 inline-flex items-center gap-2 ${mode === 'vetted' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          title="Use only sales already vetted by the time-normalization workflow. Bracket assignment + residual both use values_norm_time."
        >
          <ShieldCheck className="w-4 h-4" /> Vetted Sales (recommended)
        </button>
        <button
          onClick={() => setMode('all')}
          className={`px-4 py-2 inline-flex items-center gap-2 border-l border-gray-300 ${mode === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          title="Use all sales matching the CME allowable codes + date window. Bracket assignment + residual both use raw sales_price."
        >
          <Database className="w-4 h-4" /> All Allowable Sales
        </button>
      </div>
      <div className="mb-4 text-xs text-gray-600">
        {mode === 'vetted' ? (
          <>Brackets and residuals both use <code className="px-1 bg-gray-100 rounded">values_norm_time</code> — the time-adjusted price from the normalization workflow.</>
        ) : (
          <>Brackets and residuals both use raw <code className="px-1 bg-gray-100 rounded">sales_price</code>. Best paired with a recent date window so untreated time-trend doesn't distort the audit.</>
        )}
      </div>

      {/* Filters */}
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

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Attribute to Audit</label>
          <select
            value={attrId}
            onChange={(e) => setAttrId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
          >
            <optgroup label="Ready to audit">
              {attrOptions.filter((a) => !a.pending).map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </optgroup>
            <optgroup label="Extractor pending — coming soon">
              {attrOptions.filter((a) => a.pending).map((a) => (
                <option key={a.id} value={a.id}>{a.label} (pending)</option>
              ))}
            </optgroup>
          </select>
          {!selectedReady && (
            <div className="mt-1 text-xs text-purple-700 flex items-center gap-1">
              <Hourglass className="w-3 h-3" />
              {selectedDef?.label} extractor is on the build list — pick a ready attribute to run the audit.
            </div>
          )}
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

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded text-sm text-rose-800">
          <strong>Could not run audit:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!audit && !error && (
        <div className="p-6 bg-gray-50 border border-dashed border-gray-300 rounded text-center text-gray-500 text-sm">
          Pick an attribute and click <strong>Run Audit</strong>. Each market bracket is checked
          independently against your grid value for that bracket.
        </div>
      )}

      {/* Results */}
      {audit?.ok && (
        <>
          {/* Diagnostic: multiple lot-size methods priced in the grid */}
          {audit.lotSize?.warning && (
            <div className="mb-4 p-4 bg-orange-50 border border-orange-300 rounded text-sm text-orange-900">
              <div className="font-semibold mb-1">Multiple lot-size methods have values in the grid.</div>
              <div className="text-xs">{audit.lotSize.warning}</div>
            </div>
          )}

          {/* Diagnostic: bracket-assignment failure (no sales landed) */}
          {audit.priceDiagnostic && audit.priceDiagnostic.landed === 0 && audit.nQualifiedTotal > 0 && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded text-sm text-yellow-900">
              <div className="font-semibold mb-1">No sales landed in any bracket — price field looks off.</div>
              <div className="text-xs">
                Field used: <code className="px-1 bg-yellow-100 rounded">{audit.priceDiagnostic.field}</code>{' '}
                ({audit.mode === 'vetted' ? 'vetted mode uses time-normalized values' : 'all-allowable mode uses raw sale price'}).
                Of {audit.nQualifiedTotal} qualified sales: <strong>{audit.priceDiagnostic.missingPrice}</strong> had no value in this field,{' '}
                <strong>{audit.priceDiagnostic.outOfRange}</strong> had a value that didn't match any bracket range.
                {audit.priceDiagnostic.min != null && (
                  <> Observed range: <strong>{fmtMoney(audit.priceDiagnostic.min)} – {fmtMoney(audit.priceDiagnostic.max)}</strong> (mean {fmtMoney(audit.priceDiagnostic.mean)}).</>
                )}
                {audit.mode === 'vetted' && audit.priceDiagnostic.max != null && audit.priceDiagnostic.max < 1000 && (
                  <div className="mt-2"><strong>Likely cause:</strong> <code>values_norm_time</code> is storing a ratio/multiplier instead of a dollar amount. Switch to <em>All Allowable Sales</em> mode and pick a recent date window, or re-run time normalization with a target year.</div>
                )}
              </div>
            </div>
          )}

          {/* Diagnostic: sales DID land in brackets but stripping dropped them all */}
          {audit.priceDiagnostic && audit.priceDiagnostic.landed > 0 && audit.perBracket.every((b) => (b.n || 0) === 0) && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded text-sm text-yellow-900">
              <div className="font-semibold mb-1">Sales landed in brackets, but every one was dropped during stripping.</div>
              <div className="text-xs space-y-1">
                <div>
                  Field used: <code className="px-1 bg-yellow-100 rounded">{audit.priceDiagnostic.field}</code>.
                  Landed in brackets: <strong>{audit.priceDiagnostic.landed}</strong> sales.
                  Observed range: <strong>{fmtMoney(audit.priceDiagnostic.min)} – {fmtMoney(audit.priceDiagnostic.max)}</strong>.
                </div>
                {Object.keys(audit.stripDropReasons || {}).length > 0 ? (
                  <div>
                    <strong>Dropped because these grid attributes had non-zero values but no extractable data on the sales:</strong>
                    <ul className="list-disc ml-5 mt-1">
                      {Object.entries(audit.stripDropReasons)
                        .sort((a, b) => b[1] - a[1])
                        .map(([attr, n]) => (
                          <li key={attr}>
                            <code className="px-1 bg-yellow-100 rounded">{attr}</code> — {n} sale(s) missing this field. Set this row's bracket value to 0 in your grid, or fix the source data.
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : (
                  <div>No specific attribute caught the drop, which is unusual — likely the audited attribute itself ({audit.attrLabel}) is missing on every sale in every bracket.</div>
                )}
              </div>
            </div>
          )}

          {/* Summary bar */}
          <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm text-gray-700">
              Auditing <span className="font-semibold">{audit.attrLabel}</span> across{' '}
              <span className="font-semibold">{audit.nQualifiedTotal.toLocaleString()}</span> qualified sales.
              {audit.anchorIdx >= 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-blue-700">
                  <Anchor className="w-3.5 h-3.5" />
                  Anchor: {CME_BRACKETS[audit.anchorIdx].shortLabel}
                </span>
              )}
            </div>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
              title="Copy a clean prose summary you can paste into your write-up"
            >
              <ClipboardCopy className="w-4 h-4" />
              {copied ? 'Copied!' : 'Copy Documentation'}
            </button>
          </div>

          {/* Per-bracket cards */}
          <div className="space-y-2">
            {audit.perBracket.map((b) => {
              const style = VERDICT_STYLES[b.verdict] || VERDICT_STYLES.cant_verify;
              const Icon = style.Icon;
              const cmp = b.comparison ? COMPARISON_BADGES[b.comparison] : null;
              const fitLo = b.fit ? b.fit.ci95[0] : null;
              const fitHi = b.fit ? b.fit.ci95[1] : null;
              const bothNegative = b.fit && fitLo < 0 && fitHi < 0;
              return (
                <div
                  key={b.bracketIdx}
                  className={`border rounded-lg p-3 bg-white ${b.isAnchor ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200'}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 ${style.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-gray-900">{b.bracket.label}</div>
                        {b.isAnchor && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">
                            <Anchor className="w-3 h-3" /> Anchor
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${style.bg} ${style.color} ${style.border}`}>
                          {style.label}
                        </span>
                        {cmp && b.verdict !== 'pending' && b.verdict !== 'cant_verify' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${cmp.color}`}>{cmp.label}</span>
                        )}
                        {bothNegative && (
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-orange-50 text-orange-800 border-orange-300">
                            Inverse signal
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-gray-800">
                        <span className="text-gray-600">Qualified sales: </span>
                        <span className="font-semibold">{b.n}</span>
                        <span className="ml-3 text-gray-600">Grid value: </span>
                        <span className="font-semibold">{fmtMoney(b.gridValue)}</span>
                        {b.fit && (
                          <>
                            <span className="ml-3 text-gray-600">Market range: </span>
                            <span className="font-semibold">{fmtMoney(fitLo)} – {fmtMoney(fitHi)}</span>
                          </>
                        )}
                      </div>
                      {bothNegative && (
                        <div className="mt-1 text-xs text-orange-800">
                          Range is entirely negative — in this bracket, more of this attribute correlates with a <em>lower</em> residual price, the opposite of a typical positive adjustment. Usually a sign of a confounded sample (e.g. larger lots here also have older homes), small N, or genuine market behavior worth investigating. Don't treat the negative number as a recommended adjustment.
                        </div>
                      )}
                      {b.comparisonText && (
                        <div className="mt-1 text-sm text-gray-700">{b.comparisonText}</div>
                      )}
                      {b.verdict === 'cant_verify' && (
                        <div className="mt-1 text-sm text-gray-700">{b.message}</div>
                      )}
                      {b.verdict === 'pending' && (
                        <div className="mt-1 text-sm text-gray-700">{b.message}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interpolation diagnostic */}
          {audit.interpolation && audit.interpolation.checks.length > 0 && (
            <div className="mt-6 p-4 border border-blue-200 bg-blue-50 rounded text-sm text-blue-900">
              <div className="font-semibold mb-1">Interpolation Check</div>
              <div className="text-xs mb-2">
                With two verified brackets ({CME_BRACKETS[audit.interpolation.anchors[0]].shortLabel} and{' '}
                {CME_BRACKETS[audit.interpolation.anchors[1]].shortLabel}), the brackets between them are
                checked against the line those two define. Anything off-line warrants a closer look.
              </div>
              <ul className="list-disc ml-5 space-y-0.5">
                {audit.interpolation.checks.map((c) => (
                  <li key={c.bracketIdx}>
                    {c.bracket.label}: grid {fmtMoney(c.gridValue)}, line implies {fmtMoney(c.expectedFromLine)}
                    {c.within == null
                      ? <span className="ml-2 text-gray-700">— (no model for this bracket)</span>
                      : c.within
                        ? <span className="ml-2 text-blue-800 font-semibold">— consistent</span>
                        : <span className="ml-2 text-yellow-800 font-semibold">— off-line, review</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Methodology footer */}
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
            <div className="font-semibold mb-1 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" /> Methodology
            </div>
            <ul className="list-disc ml-5 space-y-0.5">
              <li>For each bracket, every other grid attribute is stripped from the sale price <strong>relative to that bracket's median baseline property</strong>, using the sale's own bracket column.</li>
              <li>The remaining residual is regressed against the audited attribute's quantity (or compared as a presence/absence difference for binary attributes).</li>
              <li>The resulting market range is the interval the data is comfortable with. Grid values inside the range are supported; values outside flag a review.</li>
              <li><strong>Verified</strong> = {VERIFY_COMFORTABLE}+ qualified sales with adequate spread. <strong>Limited support</strong> = {VERIFY_FLOOR}–{VERIFY_COMFORTABLE - 1} sales (directional only). <strong>Below {VERIFY_FLOOR}</strong> = remains a judgment call.</li>
              <li>Pending attributes are not yet wired to the audit — they are intentionally surfaced so you can see what's coming, never shown as zero.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default AdjustmentStudyTab;
