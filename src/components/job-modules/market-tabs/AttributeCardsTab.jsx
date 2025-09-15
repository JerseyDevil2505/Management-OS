import React, { useState, useMemo, useEffect } from 'react';
import { Layers, FileText } from 'lucide-react';
import './sharedTabNav.css';
import { supabase, propertyService } from '../../../lib/supabaseClient';

const CSV_BUTTON_CLASS = 'inline-flex items-center gap-2 px-3 py-1.5 border rounded bg-white text-sm text-gray-700 hover:bg-gray-50';

// Jim's size normalization formula
function sizeNormalize(salePrice, saleSize, targetSize) {
  if (!saleSize || saleSize <= 0 || !salePrice) return salePrice || null;
  if (!targetSize || targetSize <= 0) return salePrice;
  const repl = salePrice;
  const adj = ((targetSize - saleSize) * ((salePrice / saleSize) * 0.50));
  return Math.round(repl + adj);
}

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

const AttributeCardsTab = ({ jobData = {}, properties = [], marketLandData = {}, onUpdateJobCache = () => {} }) => {
  const vendorType = jobData?.vendor_type || jobData?.vendor_source || '';

  const [active, setActive] = useState('condition');

  // Condition analysis UI state
  const [entryFilter, setEntryFilter] = useState(true); // toggle for inspection_info_by 01-04
  const [conditionWorking, setConditionWorking] = useState(false);
  const [conditionResults, setConditionResults] = useState(marketLandData.condition_analysis_rollup || { exterior: {}, interior: {}, tested_adjustments: {} });

  // Custom attribute UI state
  const [rawFields, setRawFields] = useState([]);
  const [selectedRawField, setSelectedRawField] = useState('');
  const [matchValue, setMatchValue] = useState('');
  const [customWorking, setCustomWorking] = useState(false);
  const [customResults, setCustomResults] = useState(marketLandData.custom_attribute_rollup || null);

  // Additional cards
  const [additionalWorking, setAdditionalWorking] = useState(false);
  const [additionalResults, setAdditionalResults] = useState(marketLandData.additional_cards_rollup || null);

  // Discover raw fields once
  useEffect(() => {
    let mounted = true;
    async function discover() {
      if (!jobData?.id || !properties || properties.length === 0) return;
      try {
        const sample = properties[0];
        const raw = await propertyService.getRawDataForProperty(sample.job_id, sample.property_composite_key);
        if (!mounted) return;
        if (raw && typeof raw === 'object') {
          const keys = Object.keys(raw).sort();
          setRawFields(keys);
          if (!selectedRawField && keys.length) setSelectedRawField(keys[0]);
        }
      } catch (e) {
        console.error('discover raw fields', e);
      }
    }
    discover();
    return () => { mounted = false; };
  }, [jobData?.id, properties]);

  // Helper: filter valid sales (values_norm_time primary)
  const getValidSales = (props) => props.filter(p => p && (p.values_norm_time !== undefined && p.values_norm_time !== null && Number(p.values_norm_time) > 0));

  // Helper: entry filter check (inspection_info_by codes 01-04)
  const passesEntryFilter = (p) => {
    if (!entryFilter) return true;
    const code = (p.inspection_info_by || p.info_by || p.raw_info_by || '').toString();
    return ['01','02','03','04','140A','140O','140S','140T'].includes(code) || code.startsWith('140');
  };

  // Compute Condition Analysis (exterior or interior)
  const computeConditionAnalysis = async () => {
    setConditionWorking(true);
    try {
      const valid = getValidSales(properties).filter(p => passesEntryFilter(p));
      // We'll build: { exterior: { byVCS: { [vcs]: { EXC: {...}, GOOD: {...}, ... } } }, interior: {...}, tested_adjustments: { exterior: {EXC: {flat,pct}}, ...}, snapshots }
      const exterior = { byVCS: {} };
      const interior = { byVCS: {} };

      const collect = (groupObj, vcs, rating, prop) => {
        groupObj.byVCS[vcs] = groupObj.byVCS[vcs] || {};
        const bucket = groupObj.byVCS[vcs][rating] = groupObj.byVCS[vcs][rating] || { n:0, total_price:0, total_size:0, sample: [] };
        const price = Number(prop.values_norm_time || 0);
        const size = Number(prop.asset_sfla || prop.asset_sfla_calc || 0);
        bucket.n += 1;
        bucket.total_price += price;
        bucket.total_size += size;
        if (bucket.sample.length < 6) bucket.sample.push({ key: prop.property_composite_key, price, size, year_built: prop.asset_year_built || prop.property_year_built || null });
      };

      valid.forEach(p => {
        const vcs = p.new_vcs || p.property_vcs || p.property_vcs || 'UNSPEC';
        const ext = (p.asset_ext_cond || p.asset_ext_cond === 0) ? String(p.asset_ext_cond).toUpperCase() : null;
        const int = (p.asset_int_cond || p.asset_int_cond === 0) ? String(p.asset_int_cond).toUpperCase() : null;

        // normalize condition codes to EXC/GOOD/FAIR/POOR keywords if they are codes like G/F/P/E
        const mapCond = (c) => {
          if (!c) return 'UNKNOWN';
          const v = c.toString().toUpperCase();
          if (['E','EXC','EXCELLENT'].includes(v)) return 'EXC';
          if (['G','GOOD'].includes(v)) return 'GOOD';
          if (['F','FAIR'].includes(v)) return 'FAIR';
          if (['P','POOR'].includes(v)) return 'POOR';
          return v;
        };

        const extR = mapCond(ext);
        const intR = mapCond(int);
        collect(exterior, vcs, extR, p);
        collect(interior, vcs, intR, p);
      });

      // finalize averages
      const finalize = (groupObj) => {
        const byVCS = groupObj.byVCS || {};
        Object.keys(byVCS).forEach(vcs => {
          Object.keys(byVCS[vcs]).forEach(rating => {
            const b = byVCS[vcs][rating];
            b.avg_price = b.n > 0 ? Math.round(b.total_price / b.n) : null;
            b.avg_size = b.n > 0 ? Math.round(b.total_size / b.n) : null;
            b.price_per_sf = (b.avg_price && b.avg_size) ? Number((b.avg_price / b.avg_size).toFixed(2)) : null;
          });
        });
      };

      finalize(exterior);
      finalize(interior);

      // Compute tested adjustments: for each rating compute delta vs GOOD baseline across all VCS combined
      const aggByRating = (groupObj) => {
        const totals = {}; // rating -> {n, total_price}
        Object.values(groupObj.byVCS || {}).forEach(vcsObj => {
          Object.entries(vcsObj).forEach(([rating, b]) => {
            totals[rating] = totals[rating] || { n:0, total_price:0 };
            totals[rating].n += b.n || 0;
            totals[rating].total_price += b.total_price || 0;
          });
        });
        const baseline = totals['GOOD'] && totals['GOOD'].n > 0 ? (totals['GOOD'].total_price / totals['GOOD'].n) : null;
        const tested = {};
        Object.keys(totals).forEach(r => {
          const avg = totals[r].n > 0 ? (totals[r].total_price / totals[r].n) : null;
          if (avg != null && baseline != null) {
            const flat = Math.round(avg - baseline);
            const pct = baseline !== 0 ? (flat / baseline) * 100 : null;
            tested[r] = { avg: Math.round(avg), flat_adj: flat, pct_adj: pct != null ? Number(pct.toFixed(1)) : null };
          } else {
            tested[r] = { avg: avg != null ? Math.round(avg) : null, flat_adj: null, pct_adj: null };
          }
        });
        return { baseline: baseline ? Math.round(baseline) : null, tested };
      };

      const tested_exterior = aggByRating(exterior);
      const tested_interior = aggByRating(interior);

      const rollup = { exterior, interior, tested_adjustments: { exterior: tested_exterior, interior: tested_interior }, generated_at: new Date().toISOString() };

      setConditionResults(rollup);

      // Save to DB
      await saveRollupToDB(jobData.id, { condition_analysis_rollup: rollup });

    } catch (e) {
      console.error('computeConditionAnalysis', e);
    }
    setConditionWorking(false);
  };

  // Save helper
  const saveRollupToDB = async (jobId, payloadObj) => {
    try {
      const { error } = await supabase.from('market_land_valuation').update(payloadObj).eq('job_id', jobId);
      if (error) {
        const ins = await supabase.from('market_land_valuation').insert({ job_id: jobId, ...payloadObj });
        if (ins.error) throw ins.error;
      }
      onUpdateJobCache && onUpdateJobCache();
    } catch (e) {
      console.error('saveRollupToDB', e);
      throw e;
    }
  };

  // Custom attribute analysis enhanced to apply size-normalization when group sizes differ
  const runCustomAttributeAnalysis = async () => {
    if (!selectedRawField || !jobData?.id) return;
    setCustomWorking(true);
    try {
      const valid = getValidSales(properties);
      // We'll need raw values - batch fetch raw using propertyService.getRawDataForProperty
      const lookup = new Map();
      const chunk = 500;
      for (let i=0;i<valid.length;i+=chunk) {
        const slice = valid.slice(i,i+chunk);
        const resolved = await Promise.all(slice.map(p => propertyService.getRawDataForProperty(p.job_id, p.property_composite_key).then(raw=>({p,raw}), ()=>({p,raw:null}))));
        resolved.forEach(({p,raw}) => lookup.set(p.property_composite_key, { p, raw }));
      }

      const withList = [];
      const withoutList = [];

      lookup.forEach(({p,raw}) => {
        const rawVal = raw ? (raw[selectedRawField] ?? raw[selectedRawField.toUpperCase()]) : undefined;
        const has = (() => {
          if (matchValue === '') return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';
          try { if (String(rawVal).trim().toUpperCase() === String(matchValue).trim().toUpperCase()) return true; } catch(e){}
          const a = Number(rawVal); const b = Number(matchValue);
          if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a-b) < 1e-6) return true;
          return false;
        })();
        if (has) withList.push(p); else withoutList.push(p);
      });

      const agg = (arr) => {
        const n = arr.length;
        const total = arr.reduce((s,p)=>s + Number(p.values_norm_time || 0),0);
        const totalSize = arr.reduce((s,p)=>s + Number(p.asset_sfla || 0),0);
        return { n, avg_price: n>0?Math.round(total/n):null, avg_size: n>0?Math.round(totalSize/n):null };
      };

      const w = agg(withList);
      const wo = agg(withoutList);

      // Apply size normalization if sizes differ by >10%
      if (w.avg_price != null && wo.avg_price != null && w.avg_size && wo.avg_size) {
        const diff = Math.abs(w.avg_size - wo.avg_size) / ((w.avg_size + wo.avg_size)/2);
        if (diff > 0.10) {
          // normalize withList prices to withoutList avg_size for fair comparison
          const adjustedWithPrices = withList.map(p => sizeNormalize(Number(p.values_norm_time || 0), Number(p.asset_sfla || 0) || 0, wo.avg_size || 0));
          const adjustedAvgWith = adjustedWithPrices.length ? Math.round(adjustedWithPrices.reduce((a,b)=>a+(b||0),0)/adjustedWithPrices.length) : w.avg_price;
          w.adj_avg_price = adjustedAvgWith;
        }
      }

      const flat = (w.adj_avg_price || w.avg_price || 0) - (wo.avg_price || 0);
      const pct = (wo.avg_price && wo.avg_price !== 0) ? (flat / wo.avg_price) * 100 : null;

      const results = { field: selectedRawField, matchValue, overall: { with: w, without: wo, flat_adj: Math.round(flat), pct_adj: pct != null ? Number(pct.toFixed(1)) : null } };

      // group by VCS as well
      const byVCS = {};
      lookup.forEach(({p,raw}) => {
        const vcs = p.new_vcs || p.property_vcs || 'UNSPEC';
        byVCS[vcs] = byVCS[vcs] || { with: [], without: [] };
        const rawVal = raw ? (raw[selectedRawField] ?? raw[selectedRawField.toUpperCase()]) : undefined;
        const has = (() => {
          if (matchValue === '') return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '';
          try { if (String(rawVal).trim().toUpperCase() === String(matchValue).trim().toUpperCase()) return true; } catch(e){}
          const a = Number(rawVal); const b = Number(matchValue);
          if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a-b) < 1e-6) return true;
          return false;
        })();
        if (has) byVCS[vcs].with.push(p); else byVCS[vcs].without.push(p);
      });

      const byVCSResults = {};
      Object.keys(byVCS).forEach(v => {
        const wa = agg(byVCS[v].with);
        const woa = agg(byVCS[v].without);
        byVCSResults[v] = { with: wa, without: woa };
      });

      const rollup = { results, byVCS: byVCSResults, generated_at: new Date().toISOString() };
      setCustomResults(rollup);
      await saveRollupToDB(jobData.id, { custom_attribute_rollup: rollup });

    } catch (e) {
      console.error('runCustomAttributeAnalysis', e);
    }
    setCustomWorking(false);
  };

  // Additional card analysis
  const runAdditionalCardAnalysis = async () => {
    setAdditionalWorking(true);
    try {
      const valid = getValidSales(properties);
      const lookup = new Map();
      const chunk = 500;
      for (let i=0;i<valid.length;i+=chunk) {
        const slice = valid.slice(i,i+chunk);
        const resolved = await Promise.all(slice.map(p => propertyService.getRawDataForProperty(p.job_id, p.property_composite_key).then(raw=>({p,raw}), ()=>({p,raw:null}))));
        resolved.forEach(({p,raw}) => lookup.set(p.property_composite_key, { p, raw }));
      }

      const byVCS = {};
      lookup.forEach(({p,raw}) => {
        const vcs = p.new_vcs || p.property_vcs || 'UNSPEC';
        byVCS[vcs] = byVCS[vcs] || { with_addl: [], without_addl: [] };
        // Detect additional cards
        let hasAddl = false;
        // BRT style: property_addl_card exists and not 'M' and not '1'
        if (p.property_addl_card) {
          const v = String(p.property_addl_card).trim().toUpperCase();
          if (v && v !== 'NONE' && v !== 'M' && v !== '1') hasAddl = true;
        }
        // or microsystems raw has building indicators: look for keys like 'BLDG2','Bldg2','BUILDING_2' or numeric BLDG count
        if (!hasAddl && raw && typeof raw === 'object') {
          const keys = Object.keys(raw).map(k=>k.toUpperCase());
          const bldgKeys = keys.filter(k => /BLDG|BLD|BUILDING/.test(k));
          if (bldgKeys.length) {
            for (const bk of bldgKeys) {
              const val = raw[bk] || raw[bk.toLowerCase()];
              if (val && Number(val) > 1) { hasAddl = true; break; }
              if (typeof val === 'string' && /BLDG\s*2|BLDG2|BLD2|2ND/.test(String(val).toUpperCase())) { hasAddl = true; break; }
            }
          }
        }

        if (hasAddl) byVCS[vcs].with_addl.push(p);
        else byVCS[vcs].without_addl.push(p);
      });

      // aggregate
      const aggStats = (arr) => {
        const n = arr.length;
        if (n === 0) return { n:0, avg_price:null, avg_size:null, avg_age:null };
        const totalPrice = arr.reduce((s,p)=>s + Number(p.values_norm_time || 0),0);
        const totalSize = arr.reduce((s,p)=>s + Number(p.asset_sfla || 0),0);
        const totalAge = arr.reduce((s,p)=>s + (p.asset_year_built ? (new Date().getFullYear() - Number(p.asset_year_built)) : 0),0);
        return { n, avg_price: Math.round(totalPrice/n), avg_size: Math.round(totalSize/n), avg_age: Math.round(totalAge/n) };
      };

      const vcsResults = {};
      Object.keys(byVCS).forEach(v => {
        const withStats = aggStats(byVCS[v].with_addl);
        const withoutStats = aggStats(byVCS[v].without_addl);
        const flat = (withStats.avg_price || 0) - (withoutStats.avg_price || 0);
        const pct = (withoutStats.avg_price && withoutStats.avg_price !== 0) ? (flat / withoutStats.avg_price) * 100 : null;
        vcsResults[v] = { with: withStats, without: withoutStats, flat_adj: Math.round(flat), pct_adj: pct != null ? Number(pct.toFixed(1)) : null };
      });

      const rollup = { byVCS: vcsResults, generated_at: new Date().toISOString() };
      setAdditionalResults(rollup);
      await saveRollupToDB(jobData.id, { additional_cards_rollup: rollup });

    } catch (e) {
      console.error('runAdditionalCardAnalysis', e);
    }
    setAdditionalWorking(false);
  };

  // CSV helpers for condition tables
  const conditionExteriorRowsForCsv = useMemo(() => {
    const rows = [];
    const ext = conditionResults.exterior || {};
    Object.keys(ext.byVCS || {}).forEach(vcs=>{
      const buckets = ext.byVCS[vcs];
      Object.keys(buckets).forEach(rating=>{
        const b = buckets[rating];
        rows.push([vcs, rating, b.n, b.avg_price, b.avg_size, b.price_per_sf]);
      });
    });
    return rows;
  }, [conditionResults]);

  const conditionInteriorRowsForCsv = useMemo(() => {
    const rows = [];
    const it = conditionResults.interior || {};
    Object.keys(it.byVCS || {}).forEach(vcs=>{
      const buckets = it.byVCS[vcs];
      Object.keys(buckets).forEach(rating=>{
        const b = buckets[rating];
        rows.push([vcs, rating, b.n, b.avg_price, b.avg_size, b.price_per_sf]);
      });
    });
    return rows;
  }, [conditionResults]);

  // CSV for custom
  const customCsvRows = useMemo(() => {
    if (!customResults) return [];
    const rows = [];
    rows.push(['Overall', customResults.results?.overall?.with?.n ?? '', customResults.results?.overall?.with?.avg_price ?? '', customResults.results?.overall?.without?.n ?? '', customResults.results?.overall?.without?.avg_price ?? '', customResults.results?.overall?.flat_adj ?? '', customResults.results?.overall?.pct_adj ?? '']);
    Object.keys(customResults.byVCS || {}).forEach(v => {
      const g = customResults.byVCS[v];
      rows.push([v, g.with.n, g.with.avg_price, g.without.n, g.without.avg_price]);
    });
    return rows;
  }, [customResults]);

  // CSV for additional
  const additionalCsvRows = useMemo(() => {
    if (!additionalResults) return [];
    const rows = [];
    Object.keys(additionalResults.byVCS || {}).forEach(v => {
      const g = additionalResults.byVCS[v];
      rows.push([v, g.with.n, g.with.avg_size, g.with.avg_price, g.with.avg_age, g.without.n, g.without.avg_price, g.flat_adj, g.pct_adj]);
    });
    return rows;
  }, [additionalResults]);

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-1">Attribute & Card Analytics</h2>
          <p className="text-gray-600">Condition, custom attribute, and additional card analysis. Tables are optimized for export and client delivery.</p>
        </div>
        <div className="text-gray-400"><Layers size={36} /></div>
      </div>

      <div className="mt-6 mls-subtab-nav" role="tablist" aria-label="Attribute sub tabs">
        <button onClick={() => setActive('condition')} className={`mls-subtab-btn ${active === 'condition' ? 'mls-subtab-btn--active' : ''}`}>Condition Analysis</button>
        <button onClick={() => setActive('custom')} className={`mls-subtab-btn ${active === 'custom' ? 'mls-subtab-btn--active' : ''}`}>Custom Attribute Analysis</button>
        <button onClick={() => setActive('additional')} className={`mls-subtab-btn ${active === 'additional' ? 'mls-subtab-btn--active' : ''}`}>Additional Card Analysis</button>
      </div>

      <div className="mt-4">
        {active === 'condition' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Condition Analysis</h3>
              <div className="flex items-center gap-2">
                <label className="text-sm">Entry filter (01-04)</label>
                <input type="checkbox" checked={entryFilter} onChange={() => setEntryFilter(v=>!v)} />
                <button onClick={computeConditionAnalysis} className={CSV_BUTTON_CLASS}>{conditionWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-condition-exterior.csv`, ['VCS','Rating','N','AvgPrice','AvgSize','PricePerSF'], conditionExteriorRowsForCsv)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Exterior CSV</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-condition-interior.csv`, ['VCS','Rating','N','AvgPrice','AvgSize','PricePerSF'], conditionInteriorRowsForCsv)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export Interior CSV</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2">Exterior Condition (by VCS)</h4>
                <div className="overflow-auto border rounded">
                  <table className="min-w-full table-auto text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-left"><th className="px-2 py-2">VCS</th><th className="px-2 py-2">Rating</th><th className="px-2 py-2">N</th><th className="px-2 py-2">Avg Price</th><th className="px-2 py-2">Avg Size</th><th className="px-2 py-2">$/SF</th></tr>
                    </thead>
                    <tbody>
                      {Object.keys(conditionResults.exterior?.byVCS || {}).length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No exterior rollup yet.</td></tr>}
                      {Object.entries(conditionResults.exterior?.byVCS || {}).map(([vcs, ratings]) => (
                        Object.entries(ratings).map(([rating, b], idx) => (
                          <tr key={`${vcs}-${rating}`} className={idx%2? 'bg-white':'bg-gray-50'}>
                            <td className="px-2 py-2 border-t">{vcs}</td>
                            <td className="px-2 py-2 border-t">{rating}</td>
                            <td className="px-2 py-2 border-t">{b.n}</td>
                            <td className="px-2 py-2 border-t">{b.avg_price ?? '—'}</td>
                            <td className="px-2 py-2 border-t">{b.avg_size ?? '—'}</td>
                            <td className="px-2 py-2 border-t">{b.price_per_sf ?? '—'}</td>
                          </tr>
                        ))
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">Interior Condition (by VCS)</h4>
                <div className="overflow-auto border rounded">
                  <table className="min-w-full table-auto text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-left"><th className="px-2 py-2">VCS</th><th className="px-2 py-2">Rating</th><th className="px-2 py-2">N</th><th className="px-2 py-2">Avg Price</th><th className="px-2 py-2">Avg Size</th><th className="px-2 py-2">$/SF</th></tr>
                    </thead>
                    <tbody>
                      {Object.keys(conditionResults.interior?.byVCS || {}).length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">No interior rollup yet.</td></tr>}
                      {Object.entries(conditionResults.interior?.byVCS || {}).map(([vcs, ratings]) => (
                        Object.entries(ratings).map(([rating, b], idx) => (
                          <tr key={`${vcs}-${rating}`} className={idx%2? 'bg-white':'bg-gray-50'}>
                            <td className="px-2 py-2 border-t">{vcs}</td>
                            <td className="px-2 py-2 border-t">{rating}</td>
                            <td className="px-2 py-2 border-t">{b.n}</td>
                            <td className="px-2 py-2 border-t">{b.avg_price ?? '—'}</td>
                            <td className="px-2 py-2 border-t">{b.avg_size ?? '—'}</td>
                            <td className="px-2 py-2 border-t">{b.price_per_sf ?? '—'}</td>
                          </tr>
                        ))
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="font-medium">Tested vs Actual Adjustments (summary)</h4>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="p-3 border rounded">
                  <div className="text-sm font-semibold">Exterior Tested Adjustments</div>
                  <pre className="text-xs mt-2">{JSON.stringify(conditionResults.tested_adjustments?.exterior || {}, null, 2)}</pre>
                </div>
                <div className="p-3 border rounded">
                  <div className="text-sm font-semibold">Interior Tested Adjustments</div>
                  <pre className="text-xs mt-2">{JSON.stringify(conditionResults.tested_adjustments?.interior || {}, null, 2)}</pre>
                </div>
              </div>
            </div>
          </section>
        )}

        {active === 'custom' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Custom Attribute Analysis</h3>
              <div className="flex items-center gap-2">
                <select value={selectedRawField} onChange={(e)=>setSelectedRawField(e.target.value)} className="border px-2 py-1 rounded text-sm">
                  {rawFields.map(f=> <option key={f} value={f}>{f}</option>)}
                </select>
                <input placeholder="match value (leave empty = present)" value={matchValue} onChange={(e)=>setMatchValue(e.target.value)} className="border px-2 py-1 rounded text-sm" />
                <button onClick={runCustomAttributeAnalysis} disabled={customWorking} className={CSV_BUTTON_CLASS}>{customWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-custom-attributes.csv`, ['Key','With_N','With_Avg','Without_N','Without_Avg','FlatAdj','PctAdj'], customCsvRows)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left"><th className="px-2 py-2">Group</th><th className="px-2 py-2">N with</th><th className="px-2 py-2">Avg with</th><th className="px-2 py-2">N without</th><th className="px-2 py-2">Avg without</th><th className="px-2 py-2">Flat Adj</th><th className="px-2 py-2">% Adj</th></tr>
                </thead>
                <tbody>
                  {!customResults && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Run an analysis to populate results.</td></tr>}
                  {customResults && (
                    <>
                      <tr className="bg-white"><td className="px-2 py-2">Overall</td><td className="px-2 py-2">{customResults.results?.overall?.with?.n}</td><td className="px-2 py-2">{customResults.results?.overall?.with?.avg_price}</td><td className="px-2 py-2">{customResults.results?.overall?.without?.n}</td><td className="px-2 py-2">{customResults.results?.overall?.without?.avg_price}</td><td className="px-2 py-2">{customResults.results?.overall?.flat_adj}</td><td className="px-2 py-2">{customResults.results?.overall?.pct_adj}</td></tr>
                      {Object.keys(customResults.byVCS || {}).map((v, i) => (<tr key={v} className={i%2? 'bg-white':'bg-gray-50'}><td className="px-2 py-2">{v}</td><td className="px-2 py-2">{customResults.byVCS[v].with.n}</td><td className="px-2 py-2">{customResults.byVCS[v].with.avg_price}</td><td className="px-2 py-2">{customResults.byVCS[v].without.n}</td><td className="px-2 py-2">{customResults.byVCS[v].without.avg_price}</td><td className="px-2 py-2">—</td><td className="px-2 py-2">—</td></tr>))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {active === 'additional' && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-medium">Additional Card Analysis</h3>
              <div className="flex items-center gap-2">
                <button onClick={runAdditionalCardAnalysis} className={CSV_BUTTON_CLASS}>{additionalWorking ? 'Working...' : 'Run Analysis'}</button>
                <button onClick={() => downloadCsv(`${jobData.job_name || 'job'}-additional-cards.csv`, ['VCS','WithN','WithSize','WithPrice','WithAge','WithoutN','WithoutPrice','FlatAdj','PctAdj'], additionalCsvRows)} className={CSV_BUTTON_CLASS}><FileText size={14}/> Export CSV</button>
              </div>
            </div>

            <div className="overflow-auto border rounded mb-4">
              <table className="min-w-full table-auto text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left"><th className="px-2 py-2">VCS</th><th className="px-2 py-2">With N</th><th className="px-2 py-2">With Size</th><th className="px-2 py-2">With Price</th><th className="px-2 py-2">With Age</th><th className="px-2 py-2">Without N</th><th className="px-2 py-2">Without Price</th><th className="px-2 py-2">FlatAdj</th><th className="px-2 py-2">%Adj</th></tr>
                </thead>
                <tbody>
                  {!additionalResults && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Run analysis to populate results.</td></tr>}
                  {additionalResults && Object.keys(additionalResults.byVCS || {}).map((v, i) => {
                    const g = additionalResults.byVCS[v];
                    return (<tr key={v} className={i%2? 'bg-white':'bg-gray-50'}><td className="px-2 py-2">{v}</td><td className="px-2 py-2">{g.with.n}</td><td className="px-2 py-2">{g.with.avg_size}</td><td className="px-2 py-2">{g.with.avg_price}</td><td className="px-2 py-2">{g.with.avg_age}</td><td className="px-2 py-2">{g.without.n}</td><td className="px-2 py-2">{g.without.avg_price}</td><td className="px-2 py-2">{g.flat_adj}</td><td className="px-2 py-2">{g.pct_adj}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default AttributeCardsTab;
