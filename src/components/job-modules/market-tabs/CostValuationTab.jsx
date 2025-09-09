import React, { useMemo, useState, useEffect } from 'react';
import { Calculator } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const CostValuationTab = ({ jobData, properties = [], marketLandData = {}, onUpdateJobCache }) => {
  const currentYear = new Date().getFullYear();

  // Filters
  const [fromYear, setFromYear] = useState(currentYear - 3);
  const [toYear, setToYear] = useState(currentYear);
  // Replace prefix inputs with dropdown groupings
  const [typeGroup, setTypeGroup] = useState('single_family'); // default codes beginning with '1'

  // Factor state (job-level)
  const [costConvFactor, setCostConvFactor] = useState(marketLandData?.cost_conv_factor ?? null);
  const [stateRecommendedFactor, setStateRecommendedFactor] = useState(marketLandData?.cost_conv_recommendation ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [includedMap, setIncludedMap] = useState({});
  const [editedLandMap, setEditedLandMap] = useState({});

  useEffect(() => {
    setCostConvFactor(marketLandData?.cost_conv_factor ?? null);
    setStateRecommendedFactor(marketLandData?.cost_conv_recommendation ?? null);
  }, [marketLandData]);

  // Derive sale year safely
  const safeSaleYear = (p) => {
    try {
      if (!p.sales_date) return null;
      const d = new Date(p.sales_date);
      if (isNaN(d)) return null;
      return d.getFullYear();
    } catch (e) {
      return null;
    }
  };

  // Filter properties by sale year, require normalized price and year built (new/newer: <=20 years)
  const filtered = useMemo(() => {
    return properties.filter(p => {
      const year = safeSaleYear(p);
      if (!year) return false;
      if (year < fromYear || year > toYear) return false;

      // Require a valid time-normalized price
      if (!(p.values_norm_time && p.values_norm_time > 0)) return false;

      // asset_type_use exists on property_records
      const typeVal = p.asset_type_use ? p.asset_type_use.toString().trim() : '';

      // Apply typeGroup filter
      if (typeGroup && typeGroup !== 'all') {
        if (typeGroup === 'single_family' && !typeVal.startsWith('1')) return false;
        if (typeGroup === 'semi_detached' && !typeVal.startsWith('2')) return false;
        if (typeGroup === 'townhouses' && !typeVal.startsWith('3')) return false;
        if (typeGroup === 'multifamily' && !typeVal.startsWith('4')) return false;
        if (typeGroup === 'conversions' && !typeVal.startsWith('5')) return false;
        if (typeGroup === 'condominiums' && !typeVal.startsWith('6')) return false;
        if (typeGroup === 'commercial' && !typeVal.startsWith('4') && !typeVal.startsWith('5') && !typeVal.startsWith('6') && !typeVal.startsWith('7')) {
          // coarse commercial check - leave as-is for non-residential
        }
      }

      // Require year built and be new or newer (<= 20 years)
      const yearBuilt = p.asset_year_built || null;
      if (!yearBuilt) return false;
      const age = currentYear - parseInt(yearBuilt, 10);
      if (age > 20) return false;

      return true;
    });
  }, [properties, fromYear, toYear, typeGroup]);

  // Initialize include map and edited land map when filtered results change
  useEffect(() => {
    const map = {};
    const landMap = {};
    filtered.forEach(p => {
      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
      map[key] = true;
      landMap[key] = p.values_cama_land !== undefined && p.values_cama_land !== null ? p.values_cama_land : '';
    });
    setIncludedMap(map);
    setEditedLandMap(landMap);
  }, [filtered]);

  // formatting helpers
  const formatCurrency = (v) => {
    if (v === '' || v === null || v === undefined || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const formatCurrencyNoCents = (v) => {
    if (v === '' || v === null || v === undefined || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  const formatPercentNoDecimals = (v) => {
    if (v === '' || v === null || v === undefined || !isFinite(Number(v))) return '—';
    return `${Math.round(Number(v) * 100)}%`;
  };

  // Recommended mean (average) based on included comparables
  const recommendedFactor = useMemo(() => {
    const rows = filtered
      .map(p => {
        const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? p.values_norm_time : (p.sales_price || 0);
        const repl = p.values_repl_cost || p.values_base_cost || null;
        if (!repl || !salePrice || salePrice === 0) return null;
        const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
        const included = includedMap[key] !== undefined ? includedMap[key] : true;
        return included ? (repl / salePrice) : null;
      })
      .filter(v => v && isFinite(v));

    if (rows.length === 0) return null;
    const sum = rows.reduce((a, b) => a + b, 0);
    return sum / rows.length;
  }, [filtered, includedMap, editedLandMap]);

  // Recommended median for robustness
  const recommendedMedian = useMemo(() => {
    const rows = filtered
      .map(p => {
        const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? p.values_norm_time : (p.sales_price || 0);
        const repl = p.values_repl_cost || p.values_base_cost || null;
        if (!repl || !salePrice || salePrice === 0) return null;
        const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
        const included = includedMap[key] !== undefined ? includedMap[key] : true;
        return included ? (repl / salePrice) : null;
      })
      .filter(v => v && isFinite(v))
      .sort((a, b) => a - b);

    if (rows.length === 0) return null;
    const mid = Math.floor(rows.length / 2);
    return rows.length % 2 !== 0 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
  }, [filtered, includedMap, editedLandMap]);

  // Export CSV of current filtered results
  const exportCsv = () => {
    if (!filtered || filtered.length === 0) return alert('No data to export');
    const headers = [
      'Incl','Block','Lot','Qualifier','Card','Location','Sales Date','Sale Price','Sale NU','Price Time','Year Built','Depr','Building Class','Living Area','Current Land','Det Item','Base Cost','Repl w/Depr','Improv','CCF','Adjusted Ratio','Adjusted Value'
    ];
    const rows = filtered.map(p => {
      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
      const included = includedMap[key] !== false;
      const saleDate = p.sales_date ? new Date(p.sales_date).toISOString().slice(0,10) : '';
      const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
      const timeNorm = (p.values_norm_time !== undefined && p.values_norm_time !== null) ? Number(p.values_norm_time) : '';
      const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
      const baseCost = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
      const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
      const yearBuilt = p.asset_year_built || '';
      const depr = yearBuilt ? (1 - ((currentYear - parseInt(yearBuilt, 10)) / 100)) : '';
      const replWithDepr = (depr !== '' ? Math.round((detItems + baseCost) * depr) : '');
      const improv = (salePrice !== '' ? Math.round(salePrice - cama - detItems) : '');
      const ccf = (replWithDepr && replWithDepr !== '' && replWithDepr !== 0) ? (improv / replWithDepr) : '';
      const baseRef = costConvFactor || recommendedMedian || recommendedFactor || 1;
      const adjustedRatio = (ccf && baseRef) ? (ccf / baseRef) : '';
      const adjustedValue = (salePrice && adjustedRatio) ? Math.round(salePrice * adjustedRatio) : '';

      return [included ? '1' : '0', p.property_block || '', p.property_lot || '', p.asset_qualifier || p.qualifier || '', p.property_card || '', p.property_location || '', saleDate, salePrice, p.sales_nu || '', timeNorm, yearBuilt, depr !== '' ? Number(depr).toFixed(3) : '', p.asset_building_class || '', p.asset_living_area || p.living_area || '', cama, p.values_det_items || '', baseCost || '', replWithDepr !== '' ? Number(replWithDepr).toFixed(0) : '', improv !== '' ? Number(improv).toFixed(0) : '', ccf ? Number(ccf).toFixed(2) : '', adjustedRatio ? Number(adjustedRatio).toFixed(2) : '', adjustedValue !== '' ? Number(adjustedValue).toFixed(0) : ''];
    });

    const csvContent = [headers, ...rows].map(r => r.map(cell => {
      if (cell === null || cell === undefined) return '';
      const str = String(cell).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost_valuation_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  // Save state recommended factor to market_land_valuation
  const saveStateRecommendedFactor = async (factor) => {
    if (!jobData?.id) return alert('Missing job id');
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .update({ cost_conv_recommendation: factor, updated_at: new Date().toISOString() })
        .eq('job_id', jobData.id);
      if (error) throw error;
      setStateRecommendedFactor(factor);
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
      alert('Saved state recommended factor');
    } catch (e) {
      console.error('Error saving state recommended factor:', e);
      alert('Failed to save state recommended factor. See console.');
    } finally {
      setIsSaving(false);
    }
  };

  // Save job-level cost_conv_factor to market_land_valuation
  const saveCostConvFactor = async (factor) => {
    if (!jobData?.id) return alert('Missing job id');
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('market_land_valuation')
        .update({ cost_conv_factor: factor, updated_at: new Date().toISOString() })
        .eq('job_id', jobData.id);
      if (error) throw error;
      setCostConvFactor(factor);
      // Invalidate cache if parent provided
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
      alert('Saved cost conversion factor');
    } catch (e) {
      console.error('Error saving cost conv factor:', e);
      alert('Failed to save factor. See console.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h2 className="text-xl font-semibold">Cost Valuation</h2>
          <p className="text-gray-600">Global Cost Conversion Factor and New Construction analysis (job-level)</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-sm text-gray-600">Job Factor</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.001"
              value={costConvFactor ?? ''}
              onChange={(e) => setCostConvFactor(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="px-3 py-2 border rounded-md w-36"
              placeholder="e.g. 1.25"
            />
            <button
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={() => saveCostConvFactor(costConvFactor)}
              disabled={isSaving || costConvFactor === null || costConvFactor === ''}
            >
              {isSaving ? 'Saving...' : 'Save Factor'}
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Stored on market_land_valuation for this job</div>
          <div className="mt-3 w-full">
            <div className="text-sm text-gray-600">State Recommended Factor</div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="number"
                step="0.01"
                value={stateRecommendedFactor ?? ''}
                onChange={(e) => setStateRecommendedFactor(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="px-3 py-2 border rounded-md w-36"
                placeholder="e.g. 1.25"
              />
              <button
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                onClick={() => saveStateRecommendedFactor(stateRecommendedFactor)}
                disabled={isSaving || stateRecommendedFactor === null || stateRecommendedFactor === ''}
              >
                {isSaving ? 'Saving...' : 'Save State Recommendation'}
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-1">Stored on market_land_valuation as cost_conv_recommendation</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end mb-4">
        <div>
          <label className="text-sm text-gray-600 block">Sales From Year</label>
          <input
            type="number"
            value={fromYear}
            onChange={(e) => setFromYear(parseInt(e.target.value) || currentYear - 3)}
            className="px-3 py-2 border rounded w-32"
          />
        </div>
        <div>
          <label className="text-sm text-gray-600 block">Sales To Year</label>
          <input
            type="number"
            value={toYear}
            onChange={(e) => setToYear(parseInt(e.target.value) || currentYear)}
            className="px-3 py-2 border rounded w-32"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 block">Property Type</label>
          <select
            value={typeGroup}
            onChange={(e) => setTypeGroup(e.target.value)}
            className="px-3 py-2 border rounded w-48"
          >
            <option value="single_family">Single Family (1x)</option>
            <option value="semi_detached">Semi-Detached (2x)</option>
            <option value="townhouses">Row/Townhouses (3x)</option>
            <option value="multifamily">Multifamily (4x)</option>
            <option value="conversions">Conversions (5x)</option>
            <option value="condominiums">Condominiums (6x)</option>
            <option value="all_residential">All Residential</option>
            <option value="commercial">Commercial</option>
            <option value="all">All Properties</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-3 py-2 bg-gray-100 rounded text-sm"
            onClick={() => { setFromYear(currentYear - 3); setToYear(currentYear); setTypeGroup('single_family'); }}
          >
            Reset
          </button>
          <button
            className="px-3 py-2 bg-indigo-600 text-white rounded text-sm"
            onClick={() => exportCsv()}
          >
            Export CSV
          </button>
        </div>
      </div>

      {recommendedFactor !== null && (
        <div className="mb-4 p-3 border border-gray-200 rounded bg-green-50 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-700 font-medium">Recommended Factor (mean)</div>
            <div className="text-lg font-semibold">{Number(recommendedFactor).toFixed(2)}</div>
            <div className="text-xs text-gray-500">Based on {filtered.filter(p => {
              const has = (p.values_repl_cost || p.values_base_cost) && (p.values_norm_time || p.sales_price);
              const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
              const included = includedMap[key] !== undefined ? includedMap[key] : true;
              return has && included;
            }).length} comparable properties</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 bg-yellow-600 text-white rounded text-sm"
              onClick={() => setCostConvFactor(Number(recommendedFactor.toFixed(2)))}
            >
              Use Recommendation
            </button>
            <button
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm"
              onClick={() => saveCostConvFactor(Number(recommendedFactor.toFixed(2)))}
            >
              Save Recommendation
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border rounded border-gray-200">
        <table className="min-w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Incl</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Block</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Lot</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Qualifier</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Card</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Location</th>

              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Sales Date</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Sale Price</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Sale NU</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Price Time</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Year Built</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Depr</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Building Class</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Living Area</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Current Land</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Det Item</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Base Cost</th>

              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Repl w/Depr</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">Improv</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-r border-gray-200">CCF</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-gray-200">Adjusted Value</th>
              <th className="px-3 py-2 text-xs text-gray-600 border-b border-gray-200">Adjusted Ratio</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((p, i) => {
              const saleYear = safeSaleYear(p);
              const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? p.values_norm_time : (p.sales_price || 0);
              const repl = p.values_repl_cost || p.values_base_cost || null;
              const factor = (repl && salePrice) ? (repl / salePrice) : null;

              return (
                <tr key={p.property_composite_key || i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">
                    <input type="checkbox" checked={includedMap[p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`] !== false} onChange={(e) => {
                      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                      setIncludedMap(prev => ({ ...prev, [key]: e.target.checked }));
                    }} />
                  </td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_block || ''}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_lot || ''}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_qualifier || p.qualifier || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_card || ''}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_location || ''}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.sales_date ? new Date(p.sales_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{formatCurrencyNoCents(salePrice)}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.sales_nu || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.values_norm_time ? formatCurrencyNoCents(Number(p.values_norm_time)) : '—'}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_year_built || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(p.asset_year_built ? (1 - ((currentYear - parseInt(p.asset_year_built, 10)) / 100)).toFixed(2) : '—')}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_building_class || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_living_area || p.living_area || '—'}</td>
                  {/* Current Land editable */}
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">
                    {(() => {
                      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                      const val = editedLandMap && editedLandMap[key] !== undefined ? editedLandMap[key] : (p.values_cama_land !== undefined && p.values_cama_land !== null ? p.values_cama_land : '');
                      return (
                        <input
                          type="number"
                          step="1"
                          value={val}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEditedLandMap(prev => ({ ...prev, [key]: raw === '' ? '' : parseFloat(raw) }));
                          }}
                          className="px-2 py-1 border rounded w-28"
                        />
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.values_det_items ? formatCurrencyNoCents(Number(p.values_det_items)) : '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.values_base_cost ? formatCurrencyNoCents(Number(p.values_base_cost)) : '—'}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
                    const baseVal = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
                    const depr = p.asset_year_built ? (1 - ((currentYear - parseInt(p.asset_year_built, 10)) / 100)) : '';
                    const val = depr !== '' ? Math.round((detItems + baseVal) * depr) : '';
                    return (val !== '' && isFinite(val)) ? formatCurrencyNoCents(val) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const salePriceRow = (p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const detItemsRow = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
                    const val = Math.round(salePriceRow - camaRow - detItemsRow);
                    return isFinite(val) ? formatCurrencyNoCents(val) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
                    const baseVal = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = (p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const improvRow = Math.round(salePriceRow - camaRow - detItemsRow);
                    if (!replWithDeprRow) return <span className="text-xs text-yellow-800">Missing repl</span>;
                    const val = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : null;
                    return val ? Number(val).toFixed(2) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
                    const baseVal = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = (p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const improvRow = Math.round(salePriceRow - camaRow - detItemsRow);
                    if (!replWithDeprRow) return '—';
                    const ccf = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : null;
                    const baseRef = costConvFactor || recommendedMedian || recommendedFactor || 1;
                    const ratio = (ccf && baseRef) ? (ccf / baseRef) : null;
                    return ratio ? Number(ratio).toFixed(2) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
                    const baseVal = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = (p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const improvRow = Math.round(salePriceRow - camaRow - detItemsRow);
                    const baseRef = costConvFactor || recommendedMedian || recommendedFactor || 1;
                    const ccf = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : null;
                    const ratio = (ccf && baseRef) ? (ccf / baseRef) : null;
                    const adjustedValue = (salePriceRow && ratio) ? Math.round(salePriceRow * ratio) : null;
                    return adjustedValue !== null ? adjustedValue.toLocaleString() : '—';
                  })()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-sm text-gray-500">Showing {Math.min(filtered.length, 500).toLocaleString()} of {filtered.length.toLocaleString()} filtered properties (first 500 rows)</div>
    </div>
  );
};

export default CostValuationTab;
