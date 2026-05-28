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
  // selections: { [compositeKey]: { checked, chosenSource } }
  const [selections, setSelections] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

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

  // Seed selections from candidates (auto-check suggested rows; default to best).
  useEffect(() => {
    if (!isOpen) return;
    const seed = {};
    candidates.forEach(c => {
      seed[c.property_composite_key] = {
        checked: c.alreadyUnmasked ? true : c.autoSuggest,
        chosenSource: c.best?.source || null,
      };
    });
    setSelections(seed);
    setSaveResult(null);
  }, [isOpen, candidates]);

  const setRow = useCallback((key, patch) => {
    setSelections(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const checkedCount = useMemo(
    () => Object.values(selections).filter(s => s?.checked).length,
    [selections]
  );

  const handleSave = useCallback(async () => {
    if (!jobData?.id) return;
    setSaving(true);
    setSaveResult(null);

    const decisions = candidates.map(c => {
      const sel = selections[c.property_composite_key];
      if (!sel?.checked) {
        // Unchecked → clear any existing unmask (only if it was previously set).
        return c.alreadyUnmasked
          ? { property_composite_key: c.property_composite_key, sale: null }
          : null;
      }
      const chosen = c.candidates.find(s => s.source === sel.chosenSource) || c.best;
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
  }, [candidates, selections, hpiFn, jobData?.id, userId, onSaved]);

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

        {/* Body */}
        <div className="csv-export-modal-scroll p-5">
          {!hpiLoaded ? (
            <div className="text-center text-gray-500 py-12">Loading HPI data…</div>
          ) : candidates.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              No masked-sale candidates found in this window. 🎉
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-white sticky top-0 z-10">
                  <th className="px-2 py-2 w-10 bg-white">Use</th>
                  <th className="px-2 py-2 bg-white">Parcel</th>
                  <th className="px-2 py-2 bg-white">Location</th>
                  <th className="px-2 py-2 text-right bg-white">Current (Masking) Sale</th>
                  <th className="px-2 py-2 bg-white">Unmask Sale</th>
                  <th className="px-2 py-2 text-right bg-white">HPI Norm.</th>
                  <th className="px-2 py-2 bg-white">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => {
                  const sel = selections[c.property_composite_key] || {};
                  const chosen = c.candidates.find(s => s.source === sel.chosenSource) || c.best;
                  const norm = timeNormalizeUnmasked(chosen, hpiFn, MASKED_DEFAULTS.normalizeToYear);
                  return (
                    <tr key={c.property_composite_key} className="border-b hover:bg-gray-50">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={!!sel.checked}
                          onChange={(e) => setRow(c.property_composite_key, { checked: e.target.checked })}
                        />
                      </td>
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
                            value={sel.chosenSource || c.best?.source || ''}
                            onChange={(e) => setRow(c.property_composite_key, { chosenSource: e.target.value })}
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
                      <td className="px-2 py-2 text-xs">
                        {c.alreadyUnmasked ? (
                          <span className="text-green-600">Unmasked</span>
                        ) : c.autoSuggest ? (
                          <span className="text-amber-600">Suggested</span>
                        ) : (
                          <span className="text-gray-400">Optional</span>
                        )}
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
            {candidates.length} candidate{candidates.length === 1 ? '' : 's'} · {checkedCount} selected to unmask
            {saveResult && !saveResult.error && (
              <span className="ml-2 text-green-600">
                ✓ Saved {saveResult.saved} · cleared {saveResult.cleared}
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
