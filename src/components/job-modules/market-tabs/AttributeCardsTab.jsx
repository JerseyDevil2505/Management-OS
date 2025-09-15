import React, { useState, useMemo, useEffect } from 'react';
import { Layers, FileText } from 'lucide-react';
import './sharedTabNav.css';
import { supabase, propertyService } from '../../../lib/supabaseClient';

// Attribute & Card Analytics tab
// Renders three subtabs: Condition Analysis, Custom Attribute Analysis, Additional Card Analysis

const CSV_BUTTON_CLASS = 'inline-flex items-center gap-2 px-3 py-1.5 border rounded bg-white text-sm text-gray-700 hover:bg-gray-50';

function downloadCsv(filename, headers, rows) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const AttributeCardsTab = ({ jobData = {}, properties = [], marketLandData = {} , onUpdateJobCache = () => {} }) => {
  const [active, setActive] = useState('condition');

  const mlv = jobData.market_land_valuation || marketLandData || {};

  const conditionRollup = mlv.condition_analysis_rollup || {};
  const customRollup = mlv.custom_attribute_rollup || {};
  const addlCards = mlv.additional_cards_rollup || {};
  const propMap = mlv.attribute_card_property_map || {};

  // Editing state for condition rollup
  const [editingCondition, setEditingCondition] = useState(null);
  // Raw fields and custom analysis state
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [customAnalysisResults, setCustomAnalysisResults] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    // Discover raw fields from the first property (same pattern as DataQualityTab)
    const populateRawDataFields = async () => {
      if (!jobData?.id || !Array.isArray(properties) || properties.length === 0) return;
      try {
        const sampleProperty = properties[0];
        const rawData = await propertyService.getRawDataForProperty(sampleProperty.job_id, sampleProperty.property_composite_key);
        if (rawData && typeof rawData === 'object') {
          const fieldNames = Object.keys(rawData).sort();
          setRawFields(fieldNames);
          if (fieldNames.length) setSelectedRawField(fieldNames[0]);
        }
      } catch (e) {
        console.error('Error loading raw data fields:', e);
      }
    };
    populateRawDataFields();
  }, [jobData?.id, properties]);

  useEffect(() => {
    // Initialize editing state from existing rollup
    setEditingCondition(conditionRollup && conditionRollup.buckets ? JSON.parse(JSON.stringify(conditionRollup)) : { buckets: [] });
  }, [conditionRollup]);

  const conditionRows = useMemo(() => {
    const buckets = Array.isArray((editingCondition && editingCondition.buckets) || conditionRollup.buckets) ? (editingCondition && editingCondition.buckets) || conditionRollup.buckets : [];
    return buckets.map((b, idx) => ({
      key: b.key || b.vcs || `bucket-${idx}`,
      type: b.type || '',
      use: b.use || '',
      n: b.n ?? 0,
      avg_values_norm_time: b.avg_values_norm_time ?? '',
      recommended_adj: b.recommended_adj ?? null,
      actual_adj: b.actual_adj ?? null,
      delta_pct: (b.recommended_adj != null && b.actual_adj != null) ? ((b.actual_adj - b.recommended_adj) / (Math.abs(b.recommended_adj) || 1)) * 100 : null
    }));
  }, [conditionRollup, editingCondition]);

  async function saveConditionRollup() {
    if (!jobData?.id) return setStatusMessage('No job selected');
    setStatusMessage('Saving condition rollup...');
    try {
      const payload = { condition_analysis_rollup: editingCondition };
      const { error } = await supabase.from('market_land_valuation').update(payload).eq('job_id', jobData.id);
      if (error) {
        // Try insert if update failed because row doesn't exist
        const insertErr = await supabase.from('market_land_valuation').insert({ job_id: jobData.id, ...payload });
        if (insertErr.error) throw insertErr.error;
      }
      setStatusMessage('Condition rollup saved');
      // Notify parent to refresh cache if provided
      onUpdateJobCache && onUpdateJobCache();
    } catch (e) {
      console.error('Save condition rollup error', e);
      setStatusMessage('Error saving condition rollup');
    }
    setTimeout(() => setStatusMessage(''), 2500);
  }

  // ========== CUSTOM ATTRIBUTE ANALYSIS ===========
  async function runCustomAttributeAnalysis() {
    if (!selectedRawField || !jobData?.id) return;
    setIsAnalyzing(true);
    setStatusMessage('Running custom attribute analysis...');

    try {
      // Use propertyService client-side parsing to fetch source file map once for speed
      // propertyService.getRawDataForProperty will fallback to client-side method efficiently
      const results = {
        overall: { n_with: 0, n_without: 0, avg_with: 0, avg_without: 0, flat_adj: 0, pct_adj: 0 },
        byVCS: {}
      };

      const valueMap = new Map();
      // We'll batch fetch raw data per property with Promise.all but limit to 500 concurrent in small chunks to avoid overloading
      const chunkSize = 500;
      for (let i = 0; i < properties.length; i += chunkSize) {
        const chunk = properties.slice(i, i + chunkSize);
        const promises = chunk.map(async (p) => {
          const raw = await propertyService.getRawDataForProperty(p.job_id, p.property_composite_key);
          return { p, raw };
        });
        const resolved = await Promise.all(promises);
        resolved.forEach(({ p, raw }) => valueMap.set(p.property_composite_key, { property: p, raw }));
      }

      // Evaluate match function
      const isMatch = (rawVal) => {
        if (matchValue === '') return rawVal !== undefined && rawVal !== null && String(rawVal).toString().trim() !== '';
        // exact string match (case-insensitive) or numeric equality
        try {
          if (String(rawVal).trim().toUpperCase() === String(matchValue).trim().toUpperCase()) return true;
        } catch (e) {}
        // numeric compare
        const numA = Number(rawVal);
        const numB = Number(matchValue);
        if (!Number.isNaN(numA) && !Number.isNaN(numB) && Math.abs(numA - numB) < 1e-6) return true;
        return false;
      };

      // Aggregate
      for (const [key, { property: p, raw }] of valueMap.entries()) {
        const rawVal = raw ? raw[selectedRawField] : undefined;
        const hasAttr = isMatch(rawVal);
        const timePrice = (p.values_norm_time !== undefined && p.values_norm_time !== null && Number(p.values_norm_time) > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : null);

        // global
        if (hasAttr) {
          results.overall.n_with++;
          if (timePrice) results.overall.avg_with += timePrice;
        } else {
          results.overall.n_without++;
          if (timePrice) results.overall.avg_without += timePrice;
        }

        // per VCS grouping
        const vcs = p.new_vcs || p.property_vcs || p.property_vcs || 'UNSPEC';
        results.byVCS[vcs] = results.byVCS[vcs] || { n_with: 0, n_without: 0, sum_with: 0, sum_without: 0 };
        if (hasAttr) {
          results.byVCS[vcs].n_with++;
          if (timePrice) results.byVCS[vcs].sum_with += timePrice;
        } else {
          results.byVCS[vcs].n_without++;
          if (timePrice) results.byVCS[vcs].sum_without += timePrice;
        }
      }

      // Finalize averages and adjustments
      if (results.overall.n_with > 0) results.overall.avg_with = Math.round(results.overall.avg_with / results.overall.n_with);
      else results.overall.avg_with = null;
      if (results.overall.n_without > 0) results.overall.avg_without = Math.round(results.overall.avg_without / results.overall.n_without);
      else results.overall.avg_without = null;

      if (results.overall.avg_with != null && results.overall.avg_without != null) {
        results.overall.flat_adj = Math.round(results.overall.avg_with - results.overall.avg_without);
        results.overall.pct_adj = results.overall.avg_without !== 0 ? ((results.overall.flat_adj / results.overall.avg_without) * 100) : null;
      } else {
        results.overall.flat_adj = null; results.overall.pct_adj = null;
      }

      // per VCS finalize
      Object.keys(results.byVCS).forEach(v => {
        const g = results.byVCS[v];
        g.avg_with = g.n_with > 0 ? Math.round(g.sum_with / g.n_with) : null;
        g.avg_without = g.n_without > 0 ? Math.round(g.sum_without / g.n_without) : null;
        if (g.avg_with != null && g.avg_without != null) {
          g.flat_adj = Math.round(g.avg_with - g.avg_without);
          g.pct_adj = g.avg_without !== 0 ? ((g.flat_adj / g.avg_without) * 100) : null;
        } else { g.flat_adj = null; g.pct_adj = null; }
      });

      setCustomAnalysisResults({ field: selectedRawField, matchValue, results });
      setStatusMessage('Custom attribute analysis complete');
    } catch (e) {
      console.error('Custom analysis error', e);
      setStatusMessage('Error during analysis');
    }

    setIsAnalyzing(false);
    setTimeout(() => setStatusMessage(''), 2400);
  }

  async function saveCustomRollup() {
    if (!jobData?.id || !customAnalysisResults) return setStatusMessage('Nothing to save');
    setStatusMessage('Saving custom rollup to job...');
    try {
      const payload = { custom_attribute_rollup: customAnalysisResults };
      const { error } = await supabase.from('market_land_valuation').update(payload).eq('job_id', jobData.id);
      if (error) {
        const ins = await supabase.from('market_land_valuation').insert({ job_id: jobData.id, ...payload });
        if (ins.error) throw ins.error;
      }
      setStatusMessage('Custom rollup saved');
      onUpdateJobCache && onUpdateJobCache();
    } catch (e) {
      console.error('Save custom rollup error', e);
      setStatusMessage('Error saving custom rollup');
    }
    setTimeout(() => setStatusMessage(''), 2400);
  }

  const customRows = useMemo(() => {
    if (!customAnalysisResults) return [];
    const rows = [];
    const o = customAnalysisResults.results;
    rows.push(['Overall', 'n_with', o.overall.n_with, 'n_without', o.overall.n_without, 'avg_with', o.overall.avg_with, 'avg_without', o.overall.avg_without, 'flat_adj', o.overall.flat_adj, 'pct_adj', o.overall.pct_adj ? `${o.overall.pct_adj.toFixed(1)}%` : '']);
    Object.keys(o.byVCS || {}).forEach(vcs => {
      const g = o.byVCS[vcs];
      rows.push([vcs, g.n_with, g.n_without, g.avg_with, g.avg_without, g.flat_adj, g.pct_adj ? `${g.pct_adj.toFixed(1)}%` : '']);
    });
    return rows;
  }, [customAnalysisResults]);

  function exportCustom() {
    if (!customAnalysisResults) return;
    const headers = ['Key','Val1','Val2','Val3','Val4','Flat_adj','Pct_adj'];
    // Flatten rows
    const rows = customRows.map(r => r.map(c => c));
    downloadCsv(`${jobData.job_name || 'job'}-custom-attributes.csv`, headers, rows);
  }

  // Additional card sample helper
  function getSampleProperties() {
    if (!propMap || typeof propMap !== 'object') return [];
    const entries = Object.entries(propMap || {}).slice(0,8);
    return entries.map(([k,v]) => ({ key: k, ...v }));
  }

  // Save any editing changes to condition editingCondition
  function updateConditionBucket(idx, field, val) {
    setEditingCondition(old => {
      const next = JSON.parse(JSON.stringify(old || { buckets: [] }));
      if (!Array.isArray(next.buckets)) next.buckets = [];
      if (!next.buckets[idx]) next.buckets[idx] = {};
      // try parse numeric
      const num = Number(val);
      next.buckets[idx][field] = (val === '' || val === null) ? null : (Number.isFinite(num) ? num : val);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Attribute & Card Analytics</h2>
          <p className="text-gray-600">Condition, custom attribute, and additional card analysis. Tables are optimized for export and client delivery.</p>
        </div>
        <div className="text-gray-400">
          <Layers size={36} />
        </div>
      </div>

      <div className="mt-6 mls-subtab-nav" role="tablist" aria-label="Attribute sub tabs">
        <button onClick={() => setActive('condition')} className={`mls-subtab-btn ${active === 'condition' ? 'mls-subtab-btn--active' : ''}`}>Condition Analysis</button>
        <button onClick={() => setActive('custom')} className={`mls-subtab-btn ${active === 'custom' ? 'mls-subtab-btn--active' : ''}`}>Custom Attribute Analysis</button>
        <button onClick={() => setActive('additional')} className={`mls-subtab-btn ${active === 'additional' ? 'mls-subtab-btn--active' : ''}`}>Additional Card Analysis</button>
      </div>

      <div className="mt-4">
        {active === 'condition' && (
          <section aria-labelledby="condition-table">
            <div className="flex items-center justify-between mb-3">
              <h3 id="condition-table" className="text-lg font-medium">Condition Analysis by bucket</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-condition-analysis.csv`, ['Bucket','Type','Use','N','Avg_values_norm_time','Recommended_adj','Actual_adj','Delta%'], conditionRows.map(r => [r.key,r.type,r.use,r.n,r.avg_values_norm_time,r.recommended_adj,r.actual_adj,r.delta_pct ? `${Math.round(r.delta_pct)}%` : ''] ))} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
                <button className={CSV_BUTTON_CLASS} onClick={() => { setEditingCondition(conditionRollup); setStatusMessage('Edit mode'); setTimeout(()=>setStatusMessage(''),1500); }}>Edit</button>
                <button className={CSV_BUTTON_CLASS} onClick={saveConditionRollup}>Save Changes</button>
              </div>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Use</th>
                    <th className="px-3 py-2">N</th>
                    <th className="px-3 py-2">Avg values_time_norm</th>
                    <th className="px-3 py-2">Recommended Adj</th>
                    <th className="px-3 py-2">Actual Adj</th>
                    <th className="px-3 py-2">Delta %</th>
                  </tr>
                </thead>
                <tbody>
                  {conditionRows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No condition rollup available for this job.</td></tr>
                  )}
                  {conditionRows.map((r, i) => (
                    <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 align-top border-t">{r.key}</td>
                      <td className="px-3 py-2 border-t">{r.type}</td>
                      <td className="px-3 py-2 border-t">{r.use}</td>
                      <td className="px-3 py-2 border-t">{r.n}</td>
                      <td className="px-3 py-2 border-t">{r.avg_values_norm_time}</td>
                      <td className="px-3 py-2 border-t">
                        <input type="number" className="w-full border px-2 py-1 rounded" value={r.recommended_adj ?? ''} onChange={(e) => updateConditionBucket(i, 'recommended_adj', e.target.value)} />
                      </td>
                      <td className="px-3 py-2 border-t">
                        <input type="number" className="w-full border px-2 py-1 rounded" value={r.actual_adj ?? ''} onChange={(e) => updateConditionBucket(i, 'actual_adj', e.target.value)} />
                      </td>
                      <td className="px-3 py-2 border-t">{r.delta_pct != null ? `${Math.round(r.delta_pct)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-sm text-gray-500">{statusMessage}</div>
          </section>
        )}

        {active === 'custom' && (
          <section aria-labelledby="custom-table">
            <div className="flex items-center justify-between mb-3">
              <h3 id="custom-table" className="text-lg font-medium">Custom Attribute Analysis</h3>
              <div className="flex items-center gap-2">
                <select value={selectedRawField} onChange={(e) => setSelectedRawField(e.target.value)} className="border px-2 py-1 rounded text-sm">
                  {rawFields.map(f => <option value={f} key={f}>{f}</option>)}
                </select>
                <input placeholder="match value (leave empty = present)" value={matchValue} onChange={(e) => setMatchValue(e.target.value)} className="border px-2 py-1 rounded text-sm" />
                <button onClick={runCustomAttributeAnalysis} disabled={isAnalyzing} className={CSV_BUTTON_CLASS}>{isAnalyzing ? 'Analyzing...' : 'Run Analysis'}</button>
                <button onClick={exportCustom} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
                <button onClick={saveCustomRollup} className={CSV_BUTTON_CLASS}>Save Rollup</button>
              </div>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">Val A</th>
                    <th className="px-3 py-2">Val B</th>
                    <th className="px-3 py-2">Avg A</th>
                    <th className="px-3 py-2">Avg B</th>
                    <th className="px-3 py-2">Flat Adj</th>
                    <th className="px-3 py-2">% Adj</th>
                  </tr>
                </thead>
                <tbody>
                  {!customAnalysisResults && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Run an analysis to populate results.</td></tr>}
                  {customRows.map((r, i) => (
                    <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                      {r.map((cell, ci) => <td key={ci} className="px-3 py-2 border-t">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-sm text-gray-500">{statusMessage}</div>
          </section>
        )}

        {active === 'additional' && (
          <section aria-labelledby="additional-table">
            <div className="flex items-center justify-between mb-3">
              <h3 id="additional-table" className="text-lg font-medium">Additional Card Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-additional-cards.csv`, ['Section','Key','Value'], addlRows)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded mb-4">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {addlRows.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">No additional card analytics available.</td></tr>}
                  {addlRows.map((r, i) => (
                    <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                      {r.map((cell, ci) => <td key={ci} className="px-3 py-2 border-t">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Sample properties (job-level snapshot)</h4>
              <div className="grid grid-cols-2 gap-3">
                {getSampleProperties().map((p, i) => (
                  <div key={i} className="p-3 border rounded bg-white">
                    <div className="text-sm font-semibold">{p.key}</div>
                    <div className="text-xs text-gray-600 mt-1">Cards: {Array.isArray(p.microsystems_cards) ? p.microsystems_cards.join(', ') : (p.microsystems_cards ? String(p.microsystems_cards) : '—')}</div>
                    <div className="text-xs text-gray-600">BRT cards: {p.brt_card_count ?? '—'}</div>
                    <div className="text-xs text-gray-600">Has comparables: {p.has_comparables ? 'Yes' : 'No'}</div>
                  </div>
                ))}
                {Object.keys(propMap || {}).length === 0 && <div className="col-span-2 px-3 py-6 text-center text-gray-500">No property snapshot available for this job.</div>}
              </div>
            </div>

          </section>
        )}
      </div>

    </div>
  );
};

export default AttributeCardsTab;
