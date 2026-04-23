// ============================================================
// AppellantEvidencePanel
// ------------------------------------------------------------
// Shared editable panel rendered in TWO places:
//   1. AppealLogTab evidence modal
//   2. SalesComparisonTab "Detailed" sub-tab (embedded inline)
//
// Both render the same UI and write to the same `appeal_log`
// row, so saving in one place persists to the other.
// ============================================================
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import {
  evaluateAppellantComp,
  COLOR_CLASSES,
  getNuShortForm,
  loadNuDictionary
} from '../../../lib/appellantCompEvaluator';

// ============================================================
// AddressLookupModal — modal-on-modal for finding a property by
// partial street address when the appellant only supplied an
// address (no block/lot). Filters the in-memory `properties`
// list with simple case-insensitive substring matching, debounced
// at the input level.
// ============================================================
const AddressLookupModal = ({ properties, onSelect, onSelectMulti, maxMulti = 5, onClose }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]); // array of composite keys, in click order
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (let i = 0; i < properties.length && out.length < 50; i++) {
      const p = properties[i];
      const loc = (p.property_location || '').toLowerCase();
      if (loc.includes(q)) out.push(p);
    }
    return out;
  }, [query, properties]);

  const keyFor = (p) => p.property_composite_key
    || `${p.property_block}-${p.property_lot}-${p.property_qualifier}-${p.property_addl_card || p.property_card}`;

  const toggle = (p) => {
    const k = keyFor(p);
    setSelected(prev => {
      if (prev.includes(k)) return prev.filter(x => x !== k);
      if (prev.length >= maxMulti) return prev; // cap
      return [...prev, k];
    });
  };

  const applyMulti = () => {
    if (selected.length === 0) return;
    const byKey = new Map(matches.map(p => [keyFor(p), p]));
    const ordered = selected.map(k => byKey.get(k)).filter(Boolean);
    if (onSelectMulti) onSelectMulti(ordered);
  };

  // z-[60] sits above the parent panel modal (z-50) so the lookup is always
  // on top. Compact width/height so it fits centered without dwarfing the
  // underlying panel; the result list scrolls vertically inside.
  return (
    <div className="address-lookup-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
      <div className="address-lookup-box bg-white rounded-lg shadow-xl w-full max-w-md h-[70vh] flex flex-col">
        <div className="flex justify-between items-center px-3 py-2 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Lookup by Address</h3>
            <p className="text-[10px] text-gray-600">{`Pick up to ${maxMulti} \u00b7 fills empty slots in order`}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-gray-100">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={'e.g. 4 TURNBERRY or MAIN ST'}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="address-lookup-results flex-1 overflow-y-scroll">
          {query.trim().length < 2 ? (
            <div className="p-4 text-[11px] text-gray-500 italic text-center">{'Start typing to search\u2026'}</div>
          ) : matches.length === 0 ? (
            <div className="p-4 text-[11px] text-gray-500 italic text-center">No properties match that address.</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-gray-700 border-b border-gray-200">
                  <th className="px-2 py-1 font-semibold w-6"></th>
                  <th className="px-2 py-1 font-semibold">Address</th>
                  <th className="px-2 py-1 font-semibold">Blk</th>
                  <th className="px-2 py-1 font-semibold">Lot</th>
                  <th className="px-2 py-1 font-semibold">Q</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((p) => {
                  const k = keyFor(p);
                  const isSel = selected.includes(k);
                  const order = isSel ? selected.indexOf(k) + 1 : null;
                  return (
                    <tr
                      key={k}
                      className={`border-b border-gray-100 cursor-pointer ${isSel ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                      onClick={() => toggle(p)}
                      onDoubleClick={() => onSelect(p)}
                      title="Click to multi-select, double-click to apply just this one"
                    >
                      <td className="px-2 py-1 text-center">
                        {isSel ? (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-bold">{order}</span>
                        ) : (
                          <span className="inline-block w-4 h-4 border border-gray-300 rounded-full" />
                        )}
                      </td>
                      <td className="px-2 py-1 text-gray-900 truncate max-w-[160px]">{p.property_location || '\u2014'}</td>
                      <td className="px-2 py-1 text-gray-700">{p.property_block || '\u2014'}</td>
                      <td className="px-2 py-1 text-gray-700">{p.property_lot || '\u2014'}</td>
                      <td className="px-2 py-1 text-gray-700">{p.property_qualifier || '\u2014'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {matches.length >= 50 && (
          <div className="px-2 py-1 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-200 text-center">
            {'Showing first 50 matches \u2014 type more to narrow.'}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 bg-gray-50">
          <div className="text-[10px] text-gray-600">{`${selected.length} / ${maxMulti} selected`}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-2 py-1 text-[11px] text-gray-700 border border-gray-300 rounded hover:bg-white"
            >
              Cancel
            </button>
            <button
              onClick={applyMulti}
              disabled={selected.length === 0}
              className="px-2 py-1 text-[11px] text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {`Apply (${selected.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const buildEmptyDraft = () => Array.from({ length: 5 }, (_, i) => ({
  slot: i + 1,
  block: '',
  lot: '',
  qualifier: '',
  card: '',
  sales_date: '',
  sales_price: '',
  sales_nu: '',
  manual_notes: '',
  // Manual entry fields — used when the comp is out-of-district (no matching
  // property_records row). Toggled per-row via the "M" button. When is_manual
  // is true, the read-only display cells (VCS/Design/T&U/Cond/Year Built/SFLA/
  // Lot Size) become editable inputs/dropdowns sourced from in-job code usage.
  is_manual: false,
  manual_address: '',
  manual_vcs: '',
  manual_design: '',
  manual_type_use: '',
  manual_condition: '',
  manual_year_built: '',
  manual_sfla: '',
  manual_lot_size: ''
}));

const fmtCompDate = (d) => {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().split('T')[0];
  } catch (e) { return ''; }
};

const AppellantEvidencePanel = ({
  appeal,                 // appeal_log row (must include id, property_composite_key, appeal_number, appeal_year)
  jobData,
  marketLandData = {},
  properties = [],
  tenantConfig = null,
  mode = 'inline',        // 'inline' | 'modal'
  onClose,                // required when mode='modal'
  onSaved,                // (updatedAppeal) => void — called after successful save
  onPromoteComp           // optional — (compProperty, slotData) => void — Detailed +Comp button
}) => {
  // ----- Derived job/market context -----
  const isLojikTenant = tenantConfig?.orgType === 'assessor';
  const sampleRange = useMemo(() => {
    if (!jobData?.end_date) return { start: '', end: '' };
    const rawYear = new Date(jobData.end_date).getFullYear();
    const assessmentYear = isLojikTenant ? rawYear - 1 : rawYear;
    return {
      start: new Date(assessmentYear - 1, 9, 1).toISOString().split('T')[0],
      end: new Date(assessmentYear, 9, 31).toISOString().split('T')[0]
    };
  }, [jobData?.end_date, isLojikTenant]);

  const landMethod = useMemo(() => (
    marketLandData?.land_method
      || marketLandData?.valuation_mode
      || marketLandData?.cascade_rates?.mode
      || 'ac'
  ), [marketLandData]);

  const vendorType = jobData?.vendor_type || jobData?.vendor_detection?.vendor || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions || null;

  // ----- Lookup helpers -----
  const propertyByCompositeKey = useMemo(() => {
    const map = new Map();
    properties.forEach(p => {
      if (p.property_composite_key) map.set(p.property_composite_key, p);
    });
    return map;
  }, [properties]);

  const findCompProperty = useCallback((block, lot, qualifier, card) => {
    if (!block || !lot) return null;
    // Case-insensitive trim — users frequently type qualifiers like "c0801"
    // when the canonical value on the property is "C0801".
    const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();
    const b = norm(block);
    const l = norm(lot);
    const q = norm(qualifier);
    const c = norm(card);
    return properties.find(p => {
      if (norm(p.property_block) !== b) return false;
      if (norm(p.property_lot) !== l) return false;
      // Qualifier must match. A blank qualifier in the input must match a blank
      // qualifier on the property — otherwise we'd silently grab a related
      // condo unit (e.g. C0101) when the user meant the parent parcel.
      if (norm(p.property_qualifier) !== q) return false;
      if (c && norm(p.property_addl_card || p.property_card) !== c) return false;
      return true;
    }) || null;
  }, [properties]);

  const decodeField = useCallback((property, field) => {
    if (!property || !codeDefinitions) return property?.[field] || null;
    try {
      const decoded = vendorType === 'Microsystems'
        ? interpretCodes.getMicrosystemsValue?.(property, codeDefinitions, field)
        : interpretCodes.getBRTValue?.(property, codeDefinitions, field);
      return decoded || property[field] || null;
    } catch (e) {
      return property[field] || null;
    }
  }, [codeDefinitions, vendorType]);

  // ----- Manual entry dropdown options -----
  // Build code-with-label option lists for the manual-entry dropdowns by
  // walking the loaded properties and collecting unique values per field.
  // We use the existing decodeField() helper so labels match what the
  // read-only cells show for matched properties (consistent vocab).
  const buildCodeOptions = useCallback((field) => {
    const seen = new Map(); // code -> label
    for (const p of properties) {
      const code = p?.[field];
      if (code == null || code === '') continue;
      const key = String(code).trim();
      if (!key || seen.has(key)) continue;
      const decoded = decodeField(p, field);
      const label = decoded && String(decoded).trim().toUpperCase() !== key.toUpperCase()
        ? `${key} \u00b7 ${decoded}`
        : key;
      seen.set(key, label);
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([code, label]) => ({ code, label }));
  }, [properties, decodeField]);

  const designOptions = useMemo(() => buildCodeOptions('asset_design_style'), [buildCodeOptions]);
  const typeUseOptions = useMemo(() => buildCodeOptions('asset_type_use'), [buildCodeOptions]);
  const conditionOptions = useMemo(() => buildCodeOptions('asset_int_cond'), [buildCodeOptions]);

  const codeWithName = (property, field) => {
    const code = property?.[field];
    if (!code) return '\u2014';
    const decoded = decodeField(property, field);
    if (!decoded || String(decoded).trim().toUpperCase() === String(code).trim().toUpperCase()) return String(code);
    return `${code} \u00b7 ${decoded}`;
  };

  const compLotDisplay = (property) => {
    if (!property) return '\u2014';
    // Farm-package summation — mirrors SalesComparisonTab `lot_size_acre` rule
    // (SalesComparisonTab.jsx:2757-2777). When farm mode is on and the
    // property is part of a 3A house + 3B qfarm deed-pair (detected centrally
    // in JobContainer.enrichPropertiesWithPackageData), display the combined
    // acreage instead of the single-parcel value so the appellant table
    // matches what Search & Results uses for filtering/adjustments.
    if (
      farmMode &&
      property._pkg?.is_farm_package &&
      property._pkg.combined_lot_acres > 0
    ) {
      return `${property._pkg.combined_lot_acres.toFixed(2)} ac (combined)`;
    }
    if (property.asset_lot_acre && parseFloat(property.asset_lot_acre) > 0) {
      return `${parseFloat(property.asset_lot_acre).toFixed(2)} ac`;
    }
    if (property.market_manual_lot_acre && parseFloat(property.market_manual_lot_acre) > 0) {
      return `${parseFloat(property.market_manual_lot_acre).toFixed(2)} ac`;
    }
    if (property.asset_lot_sf && parseFloat(property.asset_lot_sf) > 0) {
      return `${parseInt(property.asset_lot_sf, 10).toLocaleString()} sf`;
    }
    if (property.market_manual_lot_sf && parseFloat(property.market_manual_lot_sf) > 0) {
      return `${parseInt(property.market_manual_lot_sf, 10).toLocaleString()} sf`;
    }
    if (property.asset_lot_frontage && parseFloat(property.asset_lot_frontage) > 0) {
      return `${parseFloat(property.asset_lot_frontage).toFixed(0)} ff`;
    }
    try {
      const acres = parseFloat(interpretCodes.getCalculatedAcreage(property, vendorType));
      if (acres > 0) return `${acres.toFixed(2)} ac`;
    } catch (e) {}
    return '\u2014';
  };

  const fmtSubjectVal = (v) => v == null || v === '' ? '\u2014' : v;

  // ----- Subject -----
  const subject = appeal?.property_composite_key
    ? propertyByCompositeKey.get(appeal.property_composite_key) || null
    : null;

  // ----- Local editable state, hydrated from latest DB row on mount/appeal change -----
  const [draft, setDraft] = useState(() => {
    const existing = Array.isArray(appeal?.appellant_comps) ? appeal.appellant_comps : [];
    return buildEmptyDraft().map((empty, i) => ({ ...empty, ...(existing[i] || {}) }));
  });

  const [farmMode, setFarmMode] = useState(() => {
    if (appeal?.farm_mode != null) return !!appeal.farm_mode;
    return subject?.property_m4_class === '3A';
  });

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'saved' | 'error' | null
  const [loadingFresh, setLoadingFresh] = useState(false);
  const [nuDictReady, setNuDictReady] = useState(false);
  const [lookupSlotIdx, setLookupSlotIdx] = useState(null); // open address-lookup modal for which row
  // Current Assessment source: 'mod' (values_mod_total, default) or 'cama' (values_cama_total).
  // Persisted to job_settings under key 'current_assessment_source' so the choice
  // syncs between this panel (Detailed view) and SalesComparisonTab (Search & Results).
  const [assmtSource, setAssmtSource] = useState('mod');

  // Load assessment-source preference once per job.
  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    supabase
      .from('job_settings')
      .select('setting_value')
      .eq('job_id', jobData.id)
      .eq('setting_key', 'current_assessment_source')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const v = data?.setting_value;
        if (v === 'mod' || v === 'cama') setAssmtSource(v);
      });
    return () => { cancelled = true; };
  }, [jobData?.id]);

  const updateAssmtSource = async (next) => {
    if (next !== 'mod' && next !== 'cama') return;
    setAssmtSource(next);
    // Broadcast so any other mounted panel (e.g. SalesComparisonTab Search &
    // Results) flips live without needing to remount or refresh.
    if (jobData?.id) {
      try {
        window.dispatchEvent(new CustomEvent('assmt-source-changed', {
          detail: { jobId: jobData.id, value: next }
        }));
      } catch (e) {}
    }
    if (!jobData?.id) return;
    try {
      await supabase
        .from('job_settings')
        .upsert(
          { job_id: jobData.id, setting_key: 'current_assessment_source', setting_value: next },
          { onConflict: 'job_id,setting_key' }
        );
    } catch (e) {
      console.warn('Failed to persist current_assessment_source:', e);
    }
  };

  // Live-sync: react to assmt-source changes broadcast from other panels (e.g.
  // user toggles MOD/CAMA in Search & Results while this panel is mounted).
  useEffect(() => {
    const handler = (e) => {
      if (!e?.detail) return;
      if (jobData?.id && e.detail.jobId !== jobData.id) return;
      const v = e.detail.value;
      if (v === 'mod' || v === 'cama') setAssmtSource(v);
    };
    window.addEventListener('assmt-source-changed', handler);
    return () => window.removeEventListener('assmt-source-changed', handler);
  }, [jobData?.id]);

  // Resolve subject's current assessment based on selected source.
  const subjectAssmt = (() => {
    if (!subject) return null;
    if (assmtSource === 'cama') return subject.values_cama_total ?? subject.values_mod_total ?? null;
    return subject.values_mod_total ?? subject.values_cama_total ?? null;
  })();

  // Apply a property selected in the address-lookup modal to the active comp slot.
  const applyLookupProperty = (property) => {
    if (lookupSlotIdx == null || !property) {
      setLookupSlotIdx(null);
      return;
    }
    const idx = lookupSlotIdx;
    const newBlock = String(property.property_block || '').trim();
    const newLot = String(property.property_lot || '').trim();
    const newQual = String(property.property_qualifier || '').trim();
    const newCard = String(property.property_addl_card || property.property_card || '').trim();
    setDraft(prev => prev.map((s, i) => i === idx ? {
      ...s,
      block: newBlock,
      lot: newLot,
      qualifier: newQual,
      card: newCard
    } : s));
    // Clear any pending uncommitted edits on this row's BLQ inputs so the
    // freshly-applied values take precedence.
    setPendingBLQ(p => {
      const n = { ...p };
      delete n[`${idx}-block`];
      delete n[`${idx}-lot`];
      delete n[`${idx}-qualifier`];
      return n;
    });
    setSaveStatus(null);
    setLookupSlotIdx(null);
  };

  // Apply multiple properties selected in the address-lookup modal. Fills the
  // row the user opened the lookup from FIRST, then continues into subsequent
  // empty slots. Skips already-populated rows so we never overwrite user data.
  const applyLookupPropertiesMulti = (props) => {
    if (lookupSlotIdx == null || !Array.isArray(props) || props.length === 0) {
      setLookupSlotIdx(null);
      return;
    }
    const startIdx = lookupSlotIdx;
    setDraft(prev => {
      const next = [...prev];
      const isEmpty = (s) => !s.block && !s.lot && !s.qualifier && !s.card;
      // Build the order of target slot indices: starting slot first (always
      // overwritten), then any remaining empty slots in order.
      const order = [startIdx];
      for (let i = 0; i < next.length; i++) {
        if (i === startIdx) continue;
        if (isEmpty(next[i])) order.push(i);
      }
      for (let i = 0; i < props.length && i < order.length; i++) {
        const p = props[i];
        const idx = order[i];
        next[idx] = {
          ...next[idx],
          block: String(p.property_block || '').trim(),
          lot: String(p.property_lot || '').trim(),
          qualifier: String(p.property_qualifier || '').trim(),
          card: String(p.property_addl_card || p.property_card || '').trim()
        };
      }
      return next;
    });
    // Clear any pending BLQ edits on touched rows.
    setPendingBLQ(p => {
      const n = { ...p };
      const isEmpty = (s) => !s.block && !s.lot && !s.qualifier && !s.card;
      const order = [startIdx];
      for (let i = 0; i < draft.length; i++) {
        if (i === startIdx) continue;
        if (isEmpty(draft[i])) order.push(i);
      }
      for (let i = 0; i < props.length && i < order.length; i++) {
        const idx = order[i];
        delete n[`${idx}-block`];
        delete n[`${idx}-lot`];
        delete n[`${idx}-qualifier`];
      }
      return n;
    });
    setSaveStatus(null);
    setLookupSlotIdx(null);
  };

  // Load NU dictionary from Supabase once; triggers a re-render so
  // freshly-merged short forms (like "ESTATE SALE" for code 10) appear
  // immediately in the auto-generated comments.
  useEffect(() => {
    let cancelled = false;
    loadNuDictionary().then(() => { if (!cancelled) setNuDictReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Pending edits for Block / Lot / Qualifier are held locally so we don't
  // re-run the comp lookup (and re-render the entire grid) on every keystroke.
  // Committed to draft on blur or Enter.
  const [pendingBLQ, setPendingBLQ] = useState({});
  const blqValue = (idx, field) => {
    const key = `${idx}-${field}`;
    return pendingBLQ[key] !== undefined ? pendingBLQ[key] : (draft[idx][field] || '');
  };
  const setBlqPending = (idx, field, value) => {
    setPendingBLQ(p => ({ ...p, [`${idx}-${field}`]: value }));
    setSaveStatus(null);
  };
  const commitBlq = (idx, field) => {
    const key = `${idx}-${field}`;
    if (pendingBLQ[key] === undefined) return;
    const value = pendingBLQ[key];
    setPendingBLQ(p => { const n = { ...p }; delete n[key]; return n; });
    setDraft(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  // On open / appeal change, re-fetch the latest row from supabase so we never
  // show stale state (two-way sync between Detailed and AppealLog).
  useEffect(() => {
    if (!appeal?.id) return;
    let cancelled = false;
    setLoadingFresh(true);
    supabase
      .from('appeal_log')
      .select('id, appellant_comps, appellant_comps_updated_at, farm_mode, appeal_year, appeal_number, property_composite_key')
      .eq('id', appeal.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const existing = Array.isArray(data.appellant_comps) ? data.appellant_comps : [];
        setDraft(buildEmptyDraft().map((empty, i) => ({ ...empty, ...(existing[i] || {}) })));
        if (data.farm_mode != null) {
          setFarmMode(!!data.farm_mode);
        } else if (subject?.property_m4_class === '3A') {
          setFarmMode(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFresh(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appeal?.id]);

  const updateSlot = (idx, field, value) => {
    setDraft(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setSaveStatus(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const cleaned = draft
        .map((s, i) => ({ ...s, slot: i + 1 }))
        .filter(s => (
          s.block || s.lot || s.qualifier || s.card ||
          s.sales_date || s.sales_price || s.sales_nu || s.manual_notes ||
          // Keep manual rows even if BLQ is blank (out-of-town comps)
          s.is_manual || s.manual_address ||
          s.manual_vcs || s.manual_design || s.manual_type_use ||
          s.manual_condition || s.manual_year_built || s.manual_sfla || s.manual_lot_size
        ));

      const evidencePayload = {
        appellant_comps: cleaned.length > 0 ? cleaned : null,
        appellant_comps_updated_at: new Date().toISOString(),
        farm_mode: farmMode
      };

      // DRAFT INSERT path: no appeal_log row yet (proactive evidence work
      // before the official appeal list is synced). Insert a stub row tagged
      // with status 'D' (Draft) and the subject identifiers so the official
      // import can later merge into it via property_composite_key.
      if (!appeal?.id) {
        if (!appeal?.job_id || !appeal?.property_composite_key) {
          throw new Error('Missing job_id or property_composite_key for draft appeal.');
        }
        const stub = {
          job_id: appeal.job_id,
          property_composite_key: appeal.property_composite_key,
          property_block: appeal.property_block || null,
          property_lot: appeal.property_lot || null,
          property_qualifier: appeal.property_qualifier || null,
          property_location: appeal.property_location || null,
          appeal_year: appeal.appeal_year || new Date().getFullYear(),
          status: 'D',
          ...evidencePayload
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('appeal_log')
          .insert([stub])
          .select()
          .single();
        if (insertErr) throw insertErr;
        setSaveStatus('saved');
        if (onSaved) onSaved(inserted);
        if (mode === 'modal' && onClose) onClose();
        return;
      }

      // UPDATE path: existing appeal_log row.
      const { error } = await supabase
        .from('appeal_log')
        .update(evidencePayload)
        .eq('id', appeal.id);
      if (error) throw error;

      setSaveStatus('saved');
      if (onSaved) onSaved({ ...appeal, ...evidencePayload });
      if (mode === 'modal' && onClose) onClose();
    } catch (e) {
      console.error('Failed to save appellant comps:', e);
      setSaveStatus('error');
      alert('Failed to save evidence: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  // ----- Director's Ratio (NO 100% cap — appeal-FMV is true ratio) -----
  let ratioDecimal = null;
  let ratioSource = 'none';
  let ratioUpdatedAt = null;
  if (jobData?.director_ratio) {
    let r = parseFloat(jobData.director_ratio);
    if (Number.isFinite(r) && r > 0) {
      if (r > 1) r = r / 100;
      ratioDecimal = r;
      ratioSource = 'director';
    }
  }
  if (ratioDecimal === null && marketLandData?.normalization_config?.equalizationRatio) {
    let r = parseFloat(marketLandData.normalization_config.equalizationRatio);
    if (Number.isFinite(r) && r > 0) {
      if (r > 1) r = r / 100;
      ratioDecimal = r;
      ratioSource = 'equalization';
      ratioUpdatedAt = marketLandData?.last_normalization_run || marketLandData?.updated_at || null;
    }
  }
  const ratioPctStr = ratioDecimal ? `${(ratioDecimal * 100).toFixed(2)}%` : null;
  const fmvByRatio = (subjectAssmt && ratioDecimal)
    ? Math.round(Number(subjectAssmt) / ratioDecimal)
    : null;
  const ratioLabel = ratioSource === 'director'
    ? "Director's Ratio"
    : ratioSource === 'equalization'
      ? 'Equalization Ratio (fallback)'
      : 'Ratio not set';
  const ratioUpdatedStr = ratioUpdatedAt ? new Date(ratioUpdatedAt).toLocaleDateString() : null;

  // ----- Sampling-window check on subject sale -----
  const apYear = parseInt(appeal?.appeal_year, 10) || new Date().getFullYear();
  const subjectWindowStart = new Date(`${apYear - 2}-10-01`);
  const subjectWindowEnd   = new Date(`${apYear - 1}-10-31`);
  const isSubjectSaleOutsideWindow = (() => {
    if (!subject?.sales_date) return false;
    const d = new Date(subject.sales_date);
    if (Number.isNaN(d.getTime())) return false;
    return d < subjectWindowStart || d > subjectWindowEnd;
  })();

  // ----- Per-row evaluation -----
  const evaluations = draft.map(slot => {
    const compProp = findCompProperty(slot.block, slot.lot, slot.qualifier, slot.card);
    const evalResult = evaluateAppellantComp(subject, compProp, slot, {
      vendorType, landMethod, sampleRange, farmMode
    });
    return { compProp, evalResult };
  });

  // ----- Render -----
  // NOTE: Do NOT define a Wrapper component inside render — React would treat it
  // as a new component type each render and unmount/remount every input on every
  // keystroke (focus loss, single-char typing). Inline the wrapper JSX instead.
  const isModal = mode === 'modal';
  const body = (
    <>
      {/* Header */}
      <div className={`flex justify-between items-center p-4 border-b border-gray-200 ${isModal ? 'sticky top-0 bg-white z-10' : ''}`}>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-gray-900">Appellant Evidence Comps</h2>
            {!appeal?.id && (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 bg-amber-100 border border-amber-300 rounded" title="No appeal_log row yet — saving will create a Draft row that the official appeal list will merge into.">
                Draft (no appeal synced)
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-0.5">
            {`Appeal #${appeal?.appeal_number || (appeal?.id ? '\u2014' : 'pending')} \u00b7 Block ${appeal?.property_block} Lot ${appeal?.property_lot}${appeal?.property_qualifier ? ` Qual ${appeal.property_qualifier}` : ''} \u00b7 ${appeal?.property_location || ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ratioPctStr && (
            <div className="text-[11px] text-gray-700 leading-tight text-right">
              <div><span className="font-semibold">{ratioLabel}:</span> {ratioPctStr}</div>
              {ratioUpdatedStr && (
                <div className="text-[10px] text-gray-500">Updated {ratioUpdatedStr}</div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white" title="Source for Current Assessment. Persists per job and syncs with Search & Results.">
            <span className="font-semibold">Current Assmt:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="assmt-src" value="mod" checked={assmtSource === 'mod'} onChange={() => updateAssmtSource('mod')} className="w-3 h-3" />
              MOD
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="assmt-src" value="cama" checked={assmtSource === 'cama'} onChange={() => updateAssmtSource('cama')} className="w-3 h-3" />
              CAMA
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={farmMode}
              onChange={(e) => { setFarmMode(e.target.checked); setSaveStatus(null); }}
              className="w-4 h-4"
            />
            Farm sale mode (NU 33 acceptable)
          </label>
          {isModal && onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Subject summary */}
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-blue-900">Subject Property</div>
          {loadingFresh && <div className="text-[10px] text-gray-500 italic">{'syncing\u2026'}</div>}
        </div>
        {subject ? (
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2 text-xs text-gray-900">
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500" title={`Source: ${assmtSource === 'cama' ? 'values_cama_total' : 'values_mod_total'}`}>{`Current Assmt (${assmtSource.toUpperCase()})`}</div><div className="font-semibold">{subjectAssmt ? `$${Number(subjectAssmt).toLocaleString()}` : '\u2014'}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500" title={ratioPctStr ? `${ratioLabel}: ${ratioPctStr}` : ''}>FMV by Ratio</div><div className="font-semibold">{fmvByRatio ? `$${fmvByRatio.toLocaleString()}` : '\u2014'}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">VCS</div><div className="font-semibold">{fmtSubjectVal(subject.new_vcs || subject.property_vcs)}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Design</div><div className="font-semibold">{codeWithName(subject, 'asset_design_style')}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">T&amp;U</div><div className="font-semibold">{codeWithName(subject, 'asset_type_use')}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Cond</div><div className="font-semibold">{codeWithName(subject, 'asset_int_cond')}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Year Built</div><div className="font-semibold">{fmtSubjectVal(subject.asset_year_built)}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">SFLA</div><div className="font-semibold">{fmtSubjectVal(subject.asset_sfla)}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Lot Size</div><div className="font-semibold">{compLotDisplay(subject)}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Sale Date</div><div className="font-semibold">{fmtSubjectVal(fmtCompDate(subject.sales_date))}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">Sale Price</div><div className="font-semibold">{subject.sales_price ? `$${Number(subject.sales_price).toLocaleString()}` : '\u2014'}</div></div>
            <div><div className="text-[9px] uppercase tracking-wide text-gray-500">NU</div><div className="font-semibold" title={getNuShortForm(subject.sales_nu) || ''}>{fmtSubjectVal(subject.sales_nu)}</div></div>
          </div>
        ) : (
          <div className="text-xs text-red-700">Subject property not found in current dataset.</div>
        )}
        <div className="text-[10px] text-gray-500 mt-2">
          {`Sale-date range: ${sampleRange.start || '\u2014'} \u2192 ${sampleRange.end || '\u2014'} \u00b7 Land method: ${landMethod.toUpperCase()} \u00b7 Vendor: ${vendorType}`}
        </div>
      </div>

      {/* Comp grid */}
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-gray-700">
              <th className="px-2 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">Block</th>
              <th className="px-2 py-2 text-left font-semibold">Lot</th>
              <th className="px-2 py-2 text-left font-semibold">Qual</th>
              <th className="px-2 py-2 text-left font-semibold">Card</th>
              <th className="px-2 py-2 text-left font-semibold">Sale Date</th>
              <th className="px-2 py-2 text-left font-semibold">Sale Price</th>
              <th className="px-2 py-2 text-left font-semibold">NU</th>
              <th className="px-2 py-2 text-left font-semibold">VCS</th>
              <th className="px-2 py-2 text-left font-semibold">Design</th>
              <th className="px-2 py-2 text-left font-semibold">T&amp;U</th>
              <th className="px-2 py-2 text-left font-semibold">Cond</th>
              <th className="px-2 py-2 text-left font-semibold">Year Built</th>
              <th className="px-2 py-2 text-left font-semibold">SFLA</th>
              <th className="px-2 py-2 text-left font-semibold">Lot Size</th>
              {onPromoteComp && <th className="px-2 py-2 text-left font-semibold">Action</th>}
            </tr>
          </thead>
          <tbody>
            {draft.map((slot, idx) => {
              const { compProp, evalResult } = evaluations[idx];
              const cellCls = (key) => {
                const c = evalResult.flags[key]?.color || 'na';
                return `${COLOR_CLASSES[c].bg} ${COLOR_CLASSES[c].text} px-2 py-1`;
              };
              const cellTitle = (key) => evalResult.flags[key]?.detail || '';
              return (
                <tr key={idx} className="border-b border-gray-100">
                  <td className="px-2 py-1 font-semibold text-gray-700">
                    <div className="flex items-center gap-1">
                      <span>#{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => setLookupSlotIdx(idx)}
                        className="p-0.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                        title="Look up property by address"
                      >
                        <Search className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSlot(idx, 'is_manual', !slot.is_manual)}
                        className={`px-1 py-0.5 text-[10px] font-bold rounded border ${slot.is_manual ? 'bg-amber-200 text-amber-900 border-amber-400' : 'text-gray-500 border-gray-300 hover:bg-gray-50'}`}
                        title={slot.is_manual ? 'Manual entry on \u2014 click to revert to property lookup' : 'Out-of-district comp \u2014 enable manual entry'}
                      >
                        M
                      </button>
                    </div>
                  </td>
                  {slot.is_manual ? (
                    <td className="px-2 py-1" colSpan={3}>
                      <input
                        type="text"
                        value={slot.manual_address || ''}
                        onChange={e => updateSlot(idx, 'manual_address', e.target.value)}
                        placeholder="Street address (out-of-town)"
                        className="w-full px-1 py-0.5 border border-gray-300 rounded text-xs bg-amber-50"
                      />
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-1"><input type="text" value={blqValue(idx, 'block')} onChange={e => setBlqPending(idx, 'block', e.target.value)} onBlur={() => commitBlq(idx, 'block')} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitBlq(idx, 'block'); }} className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs" /></td>
                      <td className="px-2 py-1"><input type="text" value={blqValue(idx, 'lot')} onChange={e => setBlqPending(idx, 'lot', e.target.value)} onBlur={() => commitBlq(idx, 'lot')} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitBlq(idx, 'lot'); }} className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs" /></td>
                      <td className="px-2 py-1"><input type="text" value={blqValue(idx, 'qualifier')} onChange={e => setBlqPending(idx, 'qualifier', e.target.value)} onBlur={() => commitBlq(idx, 'qualifier')} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitBlq(idx, 'qualifier'); }} className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs" /></td>
                    </>
                  )}
                  <td className={cellCls('card')} title={cellTitle('card')}>
                    <input type="text" value={slot.card} onChange={e => updateSlot(idx, 'card', e.target.value)} placeholder={compProp ? String(compProp.property_addl_card || compProp.property_card || '') : ''} className="w-12 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                  </td>
                  <td className={cellCls('sale_date')} title={cellTitle('sale_date')}>
                    <input type="date" value={slot.sales_date || (compProp ? fmtCompDate(compProp.sales_date) : '')} onChange={e => updateSlot(idx, 'sales_date', e.target.value)} className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                  </td>
                  <td className={cellCls('sale_price')} title={cellTitle('sale_price')}>
                    <input type="number" value={slot.sales_price || (compProp?.sales_price ?? '')} onChange={e => updateSlot(idx, 'sales_price', e.target.value)} placeholder={compProp?.sales_price ? String(compProp.sales_price) : ''} className="w-24 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                  </td>
                  <td className={cellCls('sale_nu')} title={cellTitle('sale_nu')}>
                    <input type="text" value={slot.sales_nu || (compProp?.sales_nu || '')} onChange={e => updateSlot(idx, 'sales_nu', e.target.value)} placeholder={compProp?.sales_nu || ''} className="w-12 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                  </td>
                  <td className={cellCls('vcs')} title={cellTitle('vcs')}>
                    {slot.is_manual
                      ? <input type="text" value={slot.manual_vcs || ''} onChange={e => updateSlot(idx, 'manual_vcs', e.target.value)} placeholder="VCS" className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                      : (compProp ? (compProp.new_vcs || compProp.property_vcs || '\u2014') : '\u2014')}
                  </td>
                  <td className={cellCls('design')} title={cellTitle('design')}>
                    {slot.is_manual ? (
                      <select value={slot.manual_design || ''} onChange={e => updateSlot(idx, 'manual_design', e.target.value)} className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white max-w-[160px]">
                        <option value="">{'\u2014'}</option>
                        {designOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    ) : (compProp ? codeWithName(compProp, 'asset_design_style') : '\u2014')}
                  </td>
                  <td className={cellCls('type_use')} title={cellTitle('type_use')}>
                    {slot.is_manual ? (
                      <select value={slot.manual_type_use || ''} onChange={e => updateSlot(idx, 'manual_type_use', e.target.value)} className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white max-w-[160px]">
                        <option value="">{'\u2014'}</option>
                        {typeUseOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    ) : (compProp ? codeWithName(compProp, 'asset_type_use') : '\u2014')}
                  </td>
                  <td className={cellCls('condition')} title={cellTitle('condition')}>
                    {slot.is_manual ? (
                      <select value={slot.manual_condition || ''} onChange={e => updateSlot(idx, 'manual_condition', e.target.value)} className="px-1 py-0.5 border border-gray-300 rounded text-xs bg-white max-w-[160px]">
                        <option value="">{'\u2014'}</option>
                        {conditionOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    ) : (compProp ? codeWithName(compProp, 'asset_int_cond') : '\u2014')}
                  </td>
                  <td className={cellCls('year_built')} title={cellTitle('year_built')}>
                    {slot.is_manual
                      ? <input type="number" value={slot.manual_year_built || ''} onChange={e => updateSlot(idx, 'manual_year_built', e.target.value)} placeholder="YYYY" className="w-16 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                      : (compProp?.asset_year_built || '\u2014')}
                  </td>
                  <td className={cellCls('sfla')} title={cellTitle('sfla')}>
                    {slot.is_manual
                      ? <input type="number" value={slot.manual_sfla || ''} onChange={e => updateSlot(idx, 'manual_sfla', e.target.value)} placeholder="sf" className="w-20 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                      : (compProp?.asset_sfla || '\u2014')}
                  </td>
                  <td className={cellCls('lot_size')} title={cellTitle('lot_size')}>
                    {slot.is_manual
                      ? <input type="text" value={slot.manual_lot_size || ''} onChange={e => updateSlot(idx, 'manual_lot_size', e.target.value)} placeholder="0.5 ac" className="w-20 px-1 py-0.5 border border-gray-300 rounded text-xs bg-white" />
                      : compLotDisplay(compProp)}
                  </td>
                  {onPromoteComp && (
                    <td className="px-2 py-1">
                      {compProp ? (
                        <button
                          type="button"
                          onClick={() => onPromoteComp(compProp, slot)}
                          className="inline-block whitespace-nowrap px-2 py-1 text-[11px] font-semibold text-white bg-green-600 hover:bg-green-700 border border-green-700 rounded shadow-sm"
                          title="Promote into CME comp grid"
                        >
                          + Comp
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">{'\u2014'}</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Auto-generated comments */}
        <div className="mt-4 border border-gray-200 rounded p-3 bg-gray-50">
          <div className="text-xs font-semibold text-gray-700 mb-2">Auto-Generated Comments</div>
          <div className="space-y-1 text-xs text-gray-800 font-mono">
            {(() => {
              if (!subject?.sales_date || !subject?.sales_price) return null;
              const price = Number(subject.sales_price);
              if (!Number.isFinite(price) || price <= 100) return null;
              const saleDt = new Date(subject.sales_date);
              if (Number.isNaN(saleDt.getTime())) return null;
              const currentYear = new Date().getFullYear();
              if (saleDt.getFullYear() < currentYear - 3) return null;
              const dateStr = `${String(saleDt.getMonth() + 1).padStart(2, '0')}/${String(saleDt.getDate()).padStart(2, '0')}/${saleDt.getFullYear()}`;
              const priceStr = `$${price.toLocaleString()}`;
              const nuRaw = (subject.sales_nu == null ? '' : String(subject.sales_nu)).trim();
              const nuLabel = (!nuRaw || nuRaw === '0' || nuRaw === '00')
                ? "ARM'S LENGTH"
                : (getNuShortForm(nuRaw) || `NU ${nuRaw}`).toUpperCase();
              const prefix = isSubjectSaleOutsideWindow ? 'SUBJECT SOLD OUTSIDE SAMPLING PERIOD' : 'SUBJECT SOLD';
              return (
                <div className="font-semibold text-blue-900">
                  {prefix} {dateStr} FOR {priceStr} &mdash; {nuLabel}
                </div>
              );
            })()}
            {evaluations.map(({ evalResult }, idx) => {
              const slot = draft[idx];
              const hasAny = slot.block || slot.lot || slot.sales_date || slot.sales_price || slot.is_manual || slot.manual_address;
              if (!hasAny) return null;
              const oot = slot.is_manual
                ? `OUT OF TOWN${slot.manual_address ? ` (${slot.manual_address.toUpperCase()})` : ''} \u2014 `
                : '';
              return (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1">
                    <span className="font-semibold">APPELLANT COMP#{idx + 1}</span> &mdash; {oot}{evalResult.autoNote}
                    {slot.manual_notes && (
                      <span className="text-gray-700"> &mdash; {slot.manual_notes}</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={slot.manual_notes || ''}
                    onChange={e => updateSlot(idx, 'manual_notes', e.target.value)}
                    placeholder={'add note\u2026'}
                    className="w-64 px-2 py-0.5 border border-gray-300 rounded text-xs font-sans"
                  />
                </div>
              );
            })}
            {evaluations.every(({ evalResult }, idx) => {
              const slot = draft[idx];
              return !(slot.block || slot.lot || slot.sales_date || slot.sales_price || slot.is_manual || slot.manual_address);
            }) && (
              <div className="text-gray-500 italic">No comps entered yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className={`flex justify-end items-center gap-2 p-4 border-t border-gray-200 ${isModal ? 'sticky bottom-0 bg-white' : ''}`}>
        {saveStatus === 'saved' && <span className="text-xs text-green-700 mr-auto">{'\u2713 Saved'}</span>}
        {saveStatus === 'error' && <span className="text-xs text-red-700 mr-auto">Save failed</span>}
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving\u2026' : 'Save Evidence'}
        </button>
      </div>
    </>
  );

  const lookupModal = lookupSlotIdx != null ? (
    <AddressLookupModal
      properties={properties}
      onSelect={applyLookupProperty}
      onSelectMulti={applyLookupPropertiesMulti}
      maxMulti={5}
      onClose={() => setLookupSlotIdx(null)}
    />
  ) : null;

  return isModal ? (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl max-h-[92vh] overflow-y-auto">
          {body}
        </div>
      </div>
      {lookupModal}
    </>
  ) : (
    <>
      <div className="bg-white rounded-lg border border-blue-300 shadow-sm">
        {body}
      </div>
      {lookupModal}
    </>
  );
};

export default AppellantEvidencePanel;
