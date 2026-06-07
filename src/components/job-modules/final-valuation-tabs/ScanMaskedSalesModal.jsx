import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  detectMaskedCandidates,
  loadHpiMultiplier,
  timeNormalizeUnmasked,
  saveUnmaskedSales,
  MASKED_DEFAULTS,
} from '../../../lib/unmaskedSales';

/**
 * Scan Masked Sales modal. Mounted in both Sales Review (wide window) and Sales
 * Pool (user date window). Reads BRT prev_sales, lets the user unmask a healthy
 * older sale per parcel. Idempotent — re-running re-reads; saving overwrites the
 * single unmasked_sale column.
 *
 * Props:
 *   isOpen, onClose
 *   properties   - enriched property rows (include prev_sales, unmasked_sale)
 *   jobData      - { id, county, vendor_type }
 *   userId       - current user id (for audit)
 *   dateRange    - { fromYear, toDate } scopes detection
 *   onSaved      - callback after a successful save (parent should refresh cache)
 *   surfaceLabel - 'Sales Review' | 'Sales Pool' (header copy only)
 */
const ScanMaskedSalesModal = ({
  isOpen,
  onClose,
  properties = [],
  jobData = {},
  userId = null,
  dateRange = {},
  onSaved = () => {},
  surfaceLabel = 'Sales Review',
}) => {
  const vendorType = jobData?.vendor_type || 'BRT';
  const county = jobData?.county || 'Bergen';
  const fromYear = dateRange.fromYear || MASKED_DEFAULTS.fromYear;
  const toDate = dateRange.toDate || null;

  const [hpiFn, setHpiFn] = useState(null);
  const [hpiLoaded, setHpiLoaded] = useState(false);
  // rows: { [compositeKey]: { decision: 'pending'|'unmask'|'skip', chosenSource } }
  const [rows, setRows] = useState({});
  const [hideReviewed, setHideReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // "Skip" decisions (reviewed in BRT, decided not to unmask) are parcel-level
  // truth, so they persist per job in localStorage — survives reopen/surface
  // switch without a DB column. Unmask decisions persist in the DB itself.
  const skipStorageKey = jobData?.id ? `masked-skip-${jobData.id}` : null;
  const loadSkipSet = useCallback(() => {
    if (!skipStorageKey) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(skipStorageKey) || '[]')); }
    catch { return new Set(); }
  }, [skipStorageKey]);

  const candidates = useMemo(() => {
    if (!isOpen) return [];
    return detectMaskedCandidates(properties, { fromYear, toDate, vendorType });
  }, [isOpen, properties, fromYear, toDate, vendorType]);

  // Load HPI multiplier when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setHpiLoaded(false);
    loadHpiMultiplier(county, MASKED_DEFAULTS.normalizeToYear).then(fn => {
      if (cancelled) return;
      setHpiFn(() => fn);
      setHpiLoaded(true);
    });
    return () => { cancelled = true; };
  }, [isOpen, county]);

  // Seed rows: nothing is auto-unmasked anymore. Already-unmasked → 'unmask',
  // previously-skipped → 'skip', everything else starts 'pending' so the user
  // must deliberately review each one (verify the NU in BRT first).
  useEffect(() => {
    if (!isOpen) return;
    const skipped = loadSkipSet();
    const seed = {};
    candidates.forEach(c => {
      const key = c.property_composite_key;
      let decision = 'pending';
      if (c.alreadyUnmasked) decision = 'unmask';
      else if (skipped.has(key)) decision = 'skip';
      seed[key] = { decision, chosenSource: c.best?.source || null };
    });
    setRows(seed);
    setSaveResult(null);
  }, [isOpen, candidates, loadSkipSet]);

  const setDecision = useCallback((key, decision) => {
    setRows(prev => ({ ...prev, [key]: { ...prev[key], decision } }));
  }, []);

  const setChosen = useCallback((key, chosenSource) => {
    setRows(prev => ({ ...prev, [key]: { ...prev[key], chosenSource } }));
  }, []);

  const counts = useMemo(() => {
    let unmask = 0, skip = 0, pending = 0;
    candidates.forEach(c => {
      const d = rows[c.property_composite_key]?.decision || 'pending';
      if (d === 'unmask') unmask++;
      else if (d === 'skip') skip++;
      else pending++;
    });
    const total = candidates.length;
    const reviewed = unmask + skip;
    return { unmask, skip, pending, reviewed, total, pct: total ? Math.round((reviewed / total) * 100) : 0 };
  }, [candidates, rows]);

  const visibleCandidates = useMemo(() => {
    if (!hideReviewed) return candidates;
    return candidates.filter(c => (rows[c.property_composite_key]?.decision || 'pending') === 'pending');
  }, [candidates, rows, hideReviewed]);

  const handleSave = useCallback(async () => {
    if (!jobData?.id) return;
    setSaving(true);
    setSaveResult(null);

    const decisions = candidates.map(c => {
      const r = rows[c.property_composite_key];
      const decision = r?.decision || 'pending';
      if (decision !== 'unmask') {
        // skip/pending → clear any existing unmask (only if previously set).
        return c.alreadyUnmasked
          ? { property_composite_key: c.property_composite_key, sale: null }
          : null;
      }
      const chosen = c.candidates.find(s => s.source === r.chosenSource) || c.best;
      const norm = timeNormalizeUnmasked(chosen, hpiFn, MASKED_DEFAULTS.normalizeToYear);
      return {
        property_composite_key: c.property_composite_key,
        userId,
        sale: {
          sales_price: chosen.sales_price,
          sales_date: chosen.sales_date,
          sales_nu: null, // BRT prev_sales carry no NU code
          source: chosen.source,
          hpi_multiplier: norm.hpi_multiplier,
          values_norm_time: norm.values_norm_time,
        },
      };
    }).filter(Boolean);

    // Persist the skip set: clear current-scope keys, re-add current skips.
    if (skipStorageKey) {
      const set = loadSkipSet();
      candidates.forEach(c => set.delete(c.property_composite_key));
      candidates.forEach(c => {
        if ((rows[c.property_composite_key]?.decision || 'pending') === 'skip') {
          set.add(c.property_composite_key);
        }
      });
      try { localStorage.setItem(skipStorageKey, JSON.stringify([...set])); } catch { /* ignore quota */ }
    }

    try {
      const res = await saveUnmaskedSales(jobData.id, decisions);
      setSaveResult(res);
      onSaved(res);
    } catch (err) {
      console.error('Failed to save unmasked sales:', err);
      setSaveResult({ error: err.message });
    } finally {
      setSaving(false);
    }
  }, [candidates, rows, hpiFn, jobData?.id, userId, onSaved, skipStorageKey, loadSkipSet]);

  if (!isOpen) return null;

  const fmt = (n) => (n || n === 0) ? `$${Math.round(Number(n)).toLocaleString()}` : '—';
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US') : '—';

  return createPortal((
    <div className="csv-export-modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="csv-export-modal-box bg-white rounded-lg shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Scan Masked Sales — {surfaceLabel}</h2>
            <p className="text-xs text-gray-500 mt-1">
              BRT prior sales that may have been masked by a later junk transaction.
              {toDate
                ? ` Window: ${fromYear} through ${fmtDate(toDate)} (pool dates).`
                : ` Window: ${fromYear} to present.`}
              {' '}Unmasked sales are time-adjusted by county HPI and surface as their own row.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Progress bar */}
        {candidates.length > 0 && (
          <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-4 flex-shrink-0">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>
                  Reviewed <span className="font-semibold text-gray-900">{counts.reviewed}</span> of {counts.total}
                  <span className="ml-2 text-green-700">✓ {counts.unmask} to unmask</span>
                  <span className="ml-2 text-gray-500">⊘ {counts.skip} skipped</span>
                  <span className="ml-2 text-amber-600">● {counts.pending} pending</span>
                </span>
                <span className="font-semibold text-gray-700">{counts.pct}%</span>
              </div>
              <div className="h-2 w-full rounded bg-gray-200 overflow-hidden">
                <div className="h-full bg-green-500 transition-all" style={{ width: `${counts.pct}%` }} />
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={hideReviewed}
                onChange={(e) => setHideReviewed(e.target.checked)}
              />
              Hide reviewed
            </label>
          </div>
        )}

        {/* Body */}
        <div className="csv-export-modal-scroll p-5">
          {!hpiLoaded ? (
            <div className="text-center text-gray-500 py-12">Loading HPI data…</div>
          ) : candidates.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              No masked-sale candidates found in this window. 🎉
            </div>
          ) : visibleCandidates.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              All {counts.total} reviewed. Uncheck “Hide reviewed” to see them again.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-white sticky top-0 z-10">
                  <th className="px-2 py-2 bg-white">Parcel</th>
                  <th className="px-2 py-2 bg-white">Location</th>
                  <th className="px-2 py-2 text-right bg-white">Current (Masking) Sale</th>
                  <th className="px-2 py-2 bg-white">Unmask Sale</th>
                  <th className="px-2 py-2 text-right bg-white">HPI Norm.</th>
                  <th className="px-2 py-2 text-center bg-white w-44">Decision</th>
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map(c => {
                  const r = rows[c.property_composite_key] || {};
                  const decision = r.decision || 'pending';
                  const chosen = c.candidates.find(s => s.source === r.chosenSource) || c.best;
                  const norm = timeNormalizeUnmasked(chosen, hpiFn, MASKED_DEFAULTS.normalizeToYear);
                  const rowBg = decision === 'unmask'
                    ? 'bg-green-50'
                    : decision === 'skip'
                    ? 'bg-gray-100 text-gray-400'
                    : 'hover:bg-gray-50';
                  return (
                    <tr key={c.property_composite_key} className={`border-b ${rowBg}`}>
                      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap">
                        {c.property_block}/{c.property_lot}{c.property_qualifier ? `/${c.property_qualifier}` : ''}
                      </td>
                      <td className="px-2 py-2 text-xs">{c.property_location}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <span className={c.currentIsJunk ? 'text-red-600 font-medium' : ''}>{fmt(c.current.sales_price)}</span>
                        <div className="text-[10px] text-gray-400">
                          {fmtDate(c.current.sales_date)}{c.current.sales_nu ? ` · NU ${c.current.sales_nu}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {c.candidates.length > 1 ? (
                          <select
                            value={r.chosenSource || c.best?.source || ''}
                            onChange={(e) => setChosen(c.property_composite_key, e.target.value)}
                            className="text-xs border border-gray-300 rounded px-1 py-0.5"
                          >
                            {c.candidates.map(s => (
                              <option key={s.source} value={s.source}>
                                {fmt(s.sales_price)} — {fmtDate(s.sales_date)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs">{fmt(chosen?.sales_price)} — {fmtDate(chosen?.sales_date)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap text-xs text-gray-700">
                        {fmt(norm.values_norm_time)}
                        <div className="text-[10px] text-gray-400">×{(norm.hpi_multiplier || 1).toFixed(3)}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setDecision(c.property_composite_key, decision === 'unmask' ? 'pending' : 'unmask')}
                            className={`px-2 py-1 text-xs rounded border ${
                              decision === 'unmask'
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                            }`}
                            title="Unmask this prior sale"
                          >
                            ✓ Unmask
                          </button>
                          <button
                            onClick={() => setDecision(c.property_composite_key, decision === 'skip' ? 'pending' : 'skip')}
                            className={`px-2 py-1 text-xs rounded border ${
                              decision === 'skip'
                                ? 'bg-gray-600 text-white border-gray-600'
                                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                            }`}
                            title="Reviewed — do not unmask (remembered for this job)"
                          >
                            Skip
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-between rounded-b-lg flex-shrink-0">
          <div className="text-xs text-gray-500">
            {counts.total} candidate{counts.total === 1 ? '' : 's'} · {counts.unmask} to unmask · {counts.pending} still pending
            {saveResult && !saveResult.error && (
              <span className="ml-2 text-green-600">
                ✓ Saved {saveResult.saved} · cleared {saveResult.cleared} — 🔧 CME data ready
              </span>
            )}
            {saveResult?.error && <span className="ml-2 text-red-600">Error: {saveResult.error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100">
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || candidates.length === 0}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Unmask Decisions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
};

export default ScanMaskedSalesModal;
