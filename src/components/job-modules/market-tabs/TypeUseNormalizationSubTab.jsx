import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Save, Check, RefreshCw } from 'lucide-react';

const STANDARD_TARGETS = {
  BRT: [
    { code: '00', label: 'Vacant / Other' },
    { code: '10', label: 'Single Family' },
    { code: '20', label: 'Semi-Detached' },
    { code: '30', label: 'Row/Townhouse' },
    { code: '31', label: 'End Row' },
    { code: '42', label: 'MultiFamily Duplex' },
    { code: '43', label: 'MultiFamily Triplex' },
    { code: '44', label: 'MultiFamily Quad+' },
    { code: '51', label: 'Conversion 2-Fam' },
    { code: '52', label: 'Conversion 3-Fam' },
    { code: '53', label: 'Conversion 4-Fam' },
    { code: '60', label: 'Condo' },
  ],
  Microsystems: [
    { code: '1', label: 'Single Family' },
    { code: '2', label: 'Semi-Detached' },
    { code: '3E', label: 'End Row' },
    { code: '3I', label: 'Row/Townhouse (Interior)' },
    { code: '42', label: 'MultiFamily Duplex' },
    { code: '43', label: 'MultiFamily Triplex' },
    { code: '44', label: 'MultiFamily Quad+' },
    { code: '6', label: 'Condo' },
  ],
};

const TypeUseNormalizationSubTab = ({ jobData, properties, vendorType, onSaved }) => {
  const [mapping, setMapping] = useState({});
  const [savedMapping, setSavedMapping] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    const initial = jobData?.type_use_normalization_map || {};
    setMapping({ ...initial });
    setSavedMapping({ ...initial });
  }, [jobData?.id, jobData?.type_use_normalization_map]);

  const standardList = STANDARD_TARGETS[vendorType] || STANDARD_TARGETS.BRT;
  const standardSet = useMemo(() => new Set(standardList.map(s => s.code)), [standardList]);

  const codeStats = useMemo(() => {
    const counts = new Map();
    (properties || []).forEach(p => {
      const raw = (p.asset_type_use_raw ?? p.asset_type_use ?? '').toString().trim();
      if (!raw) return;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([code, n]) => ({ code, count: n, isStandard: standardSet.has(code) }))
      .sort((a, b) => {
        if (a.isStandard !== b.isStandard) return a.isStandard ? 1 : -1;
        return b.count - a.count;
      });
  }, [properties, standardSet]);

  const nonStandard = codeStats.filter(c => !c.isStandard);
  const standard = codeStats.filter(c => c.isStandard);

  const setTarget = (rawCode, target) => {
    setMapping(prev => {
      const next = { ...prev };
      if (!target) delete next[rawCode];
      else next[rawCode] = target;
      return next;
    });
  };

  const autoSuggest = () => {
    const suggestions = { ...mapping };
    nonStandard.forEach(({ code }) => {
      if (suggestions[code]) return;
      const stripped = code.replace(/^0+/, '') || '0';
      const padded = code.padStart(2, '0');
      const candidates = [stripped, padded, code.toUpperCase()];
      const hit = candidates.find(c => standardSet.has(c));
      if (hit) suggestions[code] = hit;
    });
    setMapping(suggestions);
  };

  const dirty = JSON.stringify(mapping) !== JSON.stringify(savedMapping);

  const handleSave = async () => {
    if (!jobData?.id) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = Object.keys(mapping).length === 0 ? null : mapping;
      const { error } = await supabase
        .from('jobs')
        .update({ type_use_normalization_map: payload })
        .eq('id', jobData.id);
      if (error) throw error;
      setSavedMapping({ ...mapping });
      setSaveMsg('Saved. Reload the job for changes to apply throughout the app.');
      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      setSaveMsg(`Save failed: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-2">
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Type &amp; Use Code Mapper</h3>
            <p className="text-sm text-gray-600 mt-1">
              Map this job's non-standard <code>asset_type_use</code> codes to the standard{' '}
              <span className="font-medium">{vendorType}</span> codes the app expects. Set once per job; the mapping
              applies everywhere (Land Valuation Method 2, Sales Comparison, Appellant Evidence, etc.) at fetch time.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Leave a row unmapped to keep the original (it will continue to be filtered out by standard-code consumers).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={autoSuggest}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm flex items-center gap-1"
              title="Suggest standard codes by stripping leading zeros / matching common patterns"
            >
              <RefreshCw className="w-4 h-4" /> Auto-suggest
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className={`px-3 py-2 rounded text-sm flex items-center gap-1 ${
                dirty && !saving ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Mapping'}
            </button>
          </div>
        </div>

        {saveMsg && (
          <div className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded p-2">{saveMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              Non-Standard Codes ({nonStandard.length})
            </h4>
            {nonStandard.length === 0 ? (
              <div className="text-sm text-gray-500 bg-green-50 border border-green-200 rounded p-3 flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                All distinct <code>asset_type_use</code> values in this job are already standard {vendorType} codes.
              </div>
            ) : (
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">Job Code</th>
                    <th className="text-right px-3 py-2">Count</th>
                    <th className="text-left px-3 py-2">Map To</th>
                  </tr>
                </thead>
                <tbody>
                  {nonStandard.map(({ code, count }) => (
                    <tr key={code} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono">{code || '(blank)'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{count.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <select
                          value={mapping[code] || ''}
                          onChange={(e) => setTarget(code, e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="">— leave as-is —</option>
                          {standardList.map(s => (
                            <option key={s.code} value={s.code}>
                              {s.code} — {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              Standard {vendorType} Codes (already in this job: {standard.length})
            </h4>
            <table className="w-full text-sm border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Label</th>
                  <th className="text-right px-3 py-2">In Job</th>
                </tr>
              </thead>
              <tbody>
                {standardList.map(s => {
                  const hit = standard.find(c => c.code === s.code);
                  return (
                    <tr key={s.code} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono">{s.code}</td>
                      <td className="px-3 py-2">{s.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {hit ? hit.count.toLocaleString() : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TypeUseNormalizationSubTab;
