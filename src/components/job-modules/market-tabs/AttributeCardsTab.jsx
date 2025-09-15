import React, { useState, useMemo } from 'react';
import { Layers, FileText } from 'lucide-react';

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

const AttributeCardsTab = ({ jobData = {}, properties = [] }) => {
  const [active, setActive] = useState('condition');

  const mlv = jobData.market_land_valuation || {};

  const conditionRollup = mlv.condition_analysis_rollup || {};
  const customRollup = mlv.custom_attribute_rollup || {};
  const addlCards = mlv.additional_cards_rollup || {};
  const propMap = mlv.attribute_card_property_map || {};

  const conditionRows = useMemo(() => {
    // Expecting conditionRollup structure: { buckets: [{ key, type, use, vcs, n, avg_values_norm_time, recommended_adj, actual_adj }] }
    const buckets = Array.isArray(conditionRollup.buckets) ? conditionRollup.buckets : [];
    return buckets.map(b => [b.key || b.vcs || '', b.type || '', b.use || '', b.n ?? 0, b.avg_values_norm_time ?? '', b.recommended_adj ?? '', b.actual_adj ?? '', b.n > 0 && b.recommended_adj != null && b.actual_adj != null ? `${Math.round(((b.actual_adj - b.recommended_adj) / (Math.abs(b.recommended_adj) || 1)) * 100)}%` : '']);
  }, [conditionRollup]);

  const customRows = useMemo(() => {
    // Expecting customRollup.attributes: { attrName: { n_with, n_without, avg_with, avg_without, flat_adj, pct_adj, confidence } }
    const attrs = customRollup.attributes || {};
    return Object.keys(attrs).map(k => {
      const v = attrs[k] || {};
      return [k, v.n_with ?? 0, v.n_without ?? 0, v.avg_with ?? '', v.avg_without ?? '', v.flat_adj ?? '', v.pct_adj ?? '', `${v.confidence ?? ''}`];
    });
  }, [customRollup]);

  const addlRows = useMemo(() => {
    // additional_cards_rollup expected structure: { microsystems: {A: n,...}, brt_card_counts: [{count, n}], vcs_summary: [{vcs, sample_properties: []}] }
    const rows = [];
    const micros = addlCards.microsystems || {};
    if (micros && Object.keys(micros).length) {
      rows.push(['Microsystems Card Summary', 'Card', 'Count']);
      Object.keys(micros).forEach(k => rows.push(['', k, micros[k]]));
    }
    const brt = Array.isArray(addlCards.brt_card_counts) ? addlCards.brt_card_counts : [];
    if (brt.length) {
      rows.push(['BRT Card Counts', 'Count', 'Properties']);
      brt.forEach(b => rows.push(['', b.count, b.n]));
    }
    const vcs = Array.isArray(addlCards.vcs_summary) ? addlCards.vcs_summary : [];
    if (vcs.length) {
      rows.push(['VCS Summary', 'VCS', 'Sample Properties (count)']);
      vcs.forEach(v => rows.push(['', v.vcs, (Array.isArray(v.sample_properties) ? v.sample_properties.length : (v.n || 0))]));
    }
    return rows;
  }, [addlCards]);

  function exportCondition() {
    const headers = ['Bucket','Type','Use','N','Avg_values_norm_time','Recommended_adj','Actual_adj','Delta%'];
    downloadCsv(`${jobData.job_name || 'job'}-condition-analysis.csv`, headers, conditionRows);
  }
  function exportCustom() {
    const headers = ['Attribute','N_with','N_without','Avg_with','Avg_without','Flat_adj','Pct_adj','Confidence'];
    downloadCsv(`${jobData.job_name || 'job'}-custom-attributes.csv`, headers, customRows);
  }
  function exportAdditional() {
    const headers = ['Section','Key','Value'];
    downloadCsv(`${jobData.job_name || 'job'}-additional-cards.csv`, headers, addlRows);
  }

  // helper to get sample properties for a key from propMap
  function getSampleProperties(key) {
    if (!propMap || typeof propMap !== 'object') return [];
    const entries = Object.entries(propMap || {}).slice(0,8);
    return entries.map(([k,v]) => ({ key: k, ...v }));
  }

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Attribute & Card Analytics</h2>
          <p className="text-gray-600">Condition, custom attribute, and additional card analysis. Tables are optimized for export.</p>
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
                <button onClick={exportCondition} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
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
                      {r.map((cell, ci) => <td key={ci} className="px-3 py-2 align-top border-t">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {active === 'custom' && (
          <section aria-labelledby="custom-table">
            <div className="flex items-center justify-between mb-3">
              <h3 id="custom-table" className="text-lg font-medium">Custom Attribute Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={exportCustom} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2">Attribute</th>
                    <th className="px-3 py-2">N with</th>
                    <th className="px-3 py-2">N without</th>
                    <th className="px-3 py-2">Avg (with)</th>
                    <th className="px-3 py-2">Avg (without)</th>
                    <th className="px-3 py-2">Flat Adj</th>
                    <th className="px-3 py-2">% Adj</th>
                    <th className="px-3 py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {customRows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No custom attribute rollups found.</td></tr>}
                  {customRows.map((r, i) => (
                    <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50'}>
                      {r.map((cell, ci) => <td key={ci} className="px-3 py-2 border-t">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {active === 'additional' && (
          <section aria-labelledby="additional-table">
            <div className="flex items-center justify-between mb-3">
              <h3 id="additional-table" className="text-lg font-medium">Additional Card Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={exportAdditional} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
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
