import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Calculator } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const CostValuationTab = ({ jobData, properties = [], marketLandData = {}, onUpdateJobCache }) => {
  const currentYear = new Date().getFullYear();

  // Filters
  const [fromYear, setFromYear] = useState(marketLandData?.cost_valuation_from_year ?? (currentYear - 3));
  const [toYear, setToYear] = useState(marketLandData?.cost_valuation_to_year ?? currentYear);
  // Replace prefix inputs with dropdown groupings
  const [typeGroup, setTypeGroup] = useState('single_family'); // default codes beginning with '1'
  // Price basis for calculations: 'price_time' or 'sale_price'
  const [priceBasis, setPriceBasis] = useState(marketLandData?.cost_valuation_price_basis ?? 'price_time');

  // Factor state (job-level)
  const [costConvFactor, setCostConvFactor] = useState(marketLandData?.cost_conv_factor ?? null);
  const [stateRecommendedFactor, setStateRecommendedFactor] = useState(marketLandData?.cost_conv_recommendation ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRange, setIsSavingRange] = useState(false);
  const [includedMap, setIncludedMap] = useState({});
  const [editedLandMap, setEditedLandMap] = useState({});
  // Debounce timer ref for auto-saving the year range
  const saveTimerRef = useRef(null);

  useEffect(() => {
    setCostConvFactor(marketLandData?.cost_conv_factor ?? null);
    setStateRecommendedFactor(marketLandData?.cost_conv_recommendation ?? null);
    if (marketLandData?.cost_valuation_from_year !== undefined && marketLandData?.cost_valuation_from_year !== null) {
      setFromYear(Number(marketLandData.cost_valuation_from_year));
    }
    if (marketLandData?.cost_valuation_to_year !== undefined && marketLandData?.cost_valuation_to_year !== null) {
      setToYear(Number(marketLandData.cost_valuation_to_year));
    }
  }, [marketLandData]);

  // Auto-save cost valuation year range (debounced) to market_land_valuation
  const [savedYears, setSavedYears] = useState(false);
  const saveYearRange = async (from, to) => {
    if (!jobData?.id) return;
    setIsSavingRange(true);
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .upsert([{ job_id: jobData.id, cost_valuation_from_year: from, cost_valuation_to_year: to, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        // ensure UI reflects saved values
        if (data.cost_valuation_from_year !== undefined && data.cost_valuation_from_year !== null) setFromYear(Number(data.cost_valuation_from_year));
        if (data.cost_valuation_to_year !== undefined && data.cost_valuation_to_year !== null) setToYear(Number(data.cost_valuation_to_year));
      }
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
      setSavedYears(true);
      setTimeout(() => setSavedYears(false), 1500);
      console.log('Saved cost valuation year range', { from, to });
    } catch (e) {
      console.error('Error saving cost valuation date range:', e);
      alert('Failed to save sales year range. See console.');
    } finally {
      setIsSavingRange(false);
    }
  };

  const savePriceBasis = async (basis) => {
    // Persist the selected basis to market_land_valuation
    if (!jobData?.id) { setPriceBasis(basis); return; }
    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .upsert([{ job_id: jobData.id, cost_valuation_price_basis: basis, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();
      if (error) throw error;
      setPriceBasis(basis);
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
    } catch (e) {
      console.error('Error saving price basis:', e);
      alert('Failed to save price basis. See console.');
    } finally {
      setIsSaving(false);
    }
  };

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

      // Require a valid price depending on selected basis
      if (priceBasis === 'price_time') {
        if (!(p.values_norm_time && p.values_norm_time > 0)) return false;
      } else {
        if (!(p.sales_price && Number(p.sales_price) > 0)) return false;
      }

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
  // Use CCF = Improv / ReplWithDepr so a single comparable with CCF 2.88 yields recommendedFactor 2.88
  const recommendedFactor = useMemo(() => {
    const rows = filtered
      .map(p => {
        const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
        const included = includedMap[key] !== undefined ? includedMap[key] : true;
        if (!included) return null;
        const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
        const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
        const baseCost = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
        const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
        const yearBuilt = p.asset_year_built || '';
        const depr = yearBuilt ? (1 - ((currentYear - parseInt(yearBuilt, 10)) / 100)) : '';
        if (!depr) return null;
        const replWithDepr = (detItems + baseCost) * depr;
        if (!replWithDepr || replWithDepr === 0) return null;
        const improv = salePrice - cama - detItems;
        if (!isFinite(improv)) return null;
        const ccf = improv / replWithDepr;
        return isFinite(ccf) ? ccf : null;
      })
      .filter(v => v !== null && v !== undefined && isFinite(v));

    if (rows.length === 0) return null;
    const sum = rows.reduce((a, b) => a + b, 0);
    return sum / rows.length;
  }, [filtered, includedMap, editedLandMap]);

  // Recommended median for robustness
  const recommendedMedian = useMemo(() => {
    const rows = filtered
      .map(p => {
        const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
        const included = includedMap[key] !== undefined ? includedMap[key] : true;
        if (!included) return null;
        const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
        const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
        const baseCost = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
        const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
        const yearBuilt = p.asset_year_built || '';
        const depr = yearBuilt ? (1 - ((currentYear - parseInt(yearBuilt, 10)) / 100)) : '';
        if (!depr) return null;
        const replWithDepr = (detItems + baseCost) * depr;
        if (!replWithDepr || replWithDepr === 0) return null;
        const improv = salePrice - cama - detItems;
        const ccf = improv / replWithDepr;
        return isFinite(ccf) ? ccf : null;
      })
      .filter(v => v !== null && v !== undefined && isFinite(v))
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
      const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
      const timeNorm = (p.values_norm_time !== undefined && p.values_norm_time !== null) ? Number(p.values_norm_time) : '';
      const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
      const baseCost = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
      const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
      const yearBuilt = p.asset_year_built || '';
      const depr = yearBuilt ? (1 - ((currentYear - parseInt(yearBuilt, 10)) / 100)) : '';
      const replWithDepr = (depr !== '' ? Math.round((detItems + baseCost) * depr) : '');
      const improv = (salePrice !== '' ? Math.round(salePrice - cama - detItems) : '');
      const ccf = (replWithDepr && replWithDepr !== '' && replWithDepr !== 0) ? (improv / replWithDepr) : '';
      // adjusted value = Current Land + ((Base Cost * Depr) * CCF) + Det Item
      const adjustedValue = (cama !== '' ? (Number(cama) + ((Number(baseCost) * (depr !== '' ? Number(depr) : 0)) * (ccf !== '' ? Number(ccf) : 0)) + Number(detItems)) : '');
      const adjustedRatio = (salePrice && adjustedValue !== '' && salePrice !== 0) ? (Number(adjustedValue) / Number(salePrice)) : '';

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
  const [savedRecommendation, setSavedRecommendation] = useState(false);
  const saveStateRecommendedFactor = async (factor) => {
    if (!jobData?.id) return alert('Missing job id');
    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .upsert([{ job_id: jobData.id, cost_conv_recommendation: factor, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();
      if (error) throw error;
      setStateRecommendedFactor(factor);
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
      setSavedRecommendation(true);
      setTimeout(() => setSavedRecommendation(false), 1500);
    } catch (e) {
      console.error('Error saving state recommended factor:', e);
      alert('Failed to save state recommended factor. See console.');
    } finally {
      setIsSaving(false);
    }
  };

  // Save job-level cost_conv_factor to market_land_valuation
  const [savedFactor, setSavedFactor] = useState(false);
  const saveCostConvFactor = async (factor) => {
    if (!jobData?.id) return alert('Missing job id');
    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .upsert([{ job_id: jobData.id, cost_conv_factor: factor, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();
      if (error) throw error;
      setCostConvFactor(factor);
      // Invalidate cache if parent provided
      if (onUpdateJobCache && jobData?.id) onUpdateJobCache(jobData.id, null);
      setSavedFactor(true);
      setTimeout(() => setSavedFactor(false), 1500);
    } catch (e) {
      console.error('Error saving cost conv factor:', e);
      alert('Failed to save factor. See console.');
    } finally {
      setIsSaving(false);
    }
  };

  // Summary totals for displayed/included rows (uses job-level CCF for selected row)
  const summaryTotals = useMemo(() => {
    let sumSale = 0;
    let sumAdj = 0;

    filtered.forEach(p => {
      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
      const included = includedMap[key] !== false;
      if (!included) return;

      const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
      if (isFinite(salePrice)) sumSale += salePrice;

      // compute adjusted value for this row using job-level factor if present, otherwise use per-row CCF
      {
        const detItems = (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
        const baseVal = (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
        const yearBuilt = p.asset_year_built || '';
        const depr = yearBuilt ? (1 - ((currentYear - parseInt(yearBuilt, 10)) / 100)) : '';
        if (depr) {
          const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
          let adjustedValue = null;
          if (costConvFactor !== null && costConvFactor !== '') {
            adjustedValue = (cama + ((baseVal * (depr !== '' ? depr : 0)) * Number(costConvFactor)) + detItems);
          } else {
            const replWithDepr = (detItems + baseVal) * depr;
            const improv = salePrice - cama - detItems;
            const ccf = (replWithDepr && replWithDepr !== 0) ? (improv / replWithDepr) : null;
            if (ccf !== null) adjustedValue = (cama + ((baseVal * (depr !== '' ? depr : 0)) * ccf) + detItems);
          }
          if (isFinite(adjustedValue)) sumAdj += adjustedValue;
        }
      }
    });

    const ratioPercent = (sumSale && sumSale !== 0) ? `${Math.round((sumAdj / sumSale) * 100)}%` : '—';

    return { sumSale, sumAdj, ratioPercent };
  }, [filtered, includedMap, costConvFactor, editedLandMap, currentYear]);

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
              {isSaving ? 'Saving...' : (savedFactor ? 'Saved' : 'Save Factor')}
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
                {isSaving ? 'Saving...' : (savedRecommendation ? 'Saved' : 'Save State Recommendation')}
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
            className="px-3 py-2 bg-green-600 text-white rounded text-sm"
            onClick={() => saveYearRange(fromYear, toYear)}
            disabled={isSavingRange}
          >
            {isSavingRange ? 'Saving...' : (savedYears ? 'Saved' : 'Save Years')}
          </button>
          <button
            className="px-3 py-2 bg-indigo-600 text-white rounded text-sm"
            onClick={() => exportCsv()}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Price basis toggle */}
      <div className="mb-3 text-sm text-gray-700">
        <div className="mb-1">Choose basis for calculations: <span className="text-xs text-gray-500">Price Time = normalized price; Sale Price = actual sale price</span></div>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded ${priceBasis === 'price_time' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
            onClick={() => { setPriceBasis('price_time'); savePriceBasis('price_time'); }}
          >Price Time</button>
          <button
            className={`px-3 py-1 rounded ${priceBasis === 'sale_price' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
            onClick={() => { setPriceBasis('sale_price'); savePriceBasis('sale_price'); }}
          >Sale Price</button>
        </div>
      </div>

      {recommendedFactor !== null && (
        <div className="mb-4 p-3 border border-gray-200 rounded bg-green-50 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-700 font-medium">Recommended Factor (mean)</div>
            <div className="text-lg font-semibold">{Number(recommendedFactor).toFixed(2)}</div>
            <div className="text-xs text-gray-500">Based on {filtered.filter(p => {
              const has = (p.values_repl_cost || p.values_base_cost) && (priceBasis === 'price_time' ? p.values_norm_time : p.sales_price);
              const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
              const included = includedMap[key] !== undefined ? includedMap[key] : true;
              return has && included;
            }).length} comparable properties</div>
          </div>
                {/* Recommendation actions removed - keep Save Recommendation manual via Save Factor */}
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
              const salePriceDisplay = (p.sales_price !== undefined && p.sales_price !== null) ? Number(p.sales_price) : 0;
              const priceTimeDisplay = (p.values_norm_time !== undefined && p.values_norm_time !== null) ? Number(p.values_norm_time) : 0;
              const basisPrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
              const repl = p.values_repl_cost || p.values_base_cost || null;
              const factor = (repl && basisPrice) ? (repl / basisPrice) : null;

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

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.sales_date ? new Date(p.sales_date).toLocaleDateString() : '���'}</td>
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
                    // compute adjusted value here: Current Land + ((Base Cost * Depr) * JOB CCF) + Det Item - only when this row is selected
                    if (!replWithDeprRow) return '—';
                    // Use job-level factor when available, otherwise compute per-row CCF
                    let adjustedValueRow = null;
                    if (costConvFactor !== null && costConvFactor !== '') {
                      adjustedValueRow = (camaRow + ((baseVal * (deprRow !== '' ? deprRow : 0)) * Number(costConvFactor)) + detItemsRow);
                    } else {
                      const ccf = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : 0;
                      adjustedValueRow = (camaRow + ((baseVal * (deprRow !== '' ? deprRow : 0)) * ccf) + detItemsRow);
                    }
                    return isFinite(adjustedValueRow) ? formatCurrencyNoCents(Math.round(adjustedValueRow)) : '—';
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
                    let adjustedValueRow = null;
                    if (costConvFactor !== null && costConvFactor !== '') {
                      adjustedValueRow = (camaRow + ((baseVal * (deprRow !== '' ? deprRow : 0)) * Number(costConvFactor)) + detItemsRow);
                    } else {
                      const ccf = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : 0;
                      adjustedValueRow = (camaRow + ((baseVal * (deprRow !== '' ? deprRow : 0)) * ccf) + detItemsRow);
                    }
                    const ratio = (salePriceRow && adjustedValueRow) ? (adjustedValueRow / salePriceRow) : null;
                    return ratio ? formatPercentNoDecimals(ratio) : '—';
                  })()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 border-t pt-3">
        <div className="flex gap-6 text-sm">
          <div>Sum Sale Price: <span className="font-semibold">{formatCurrencyNoCents(summaryTotals.sumSale)}</span></div>
          <div>Sum Adjusted Value: <span className="font-semibold">{formatCurrencyNoCents(summaryTotals.sumAdj)}</span></div>
          <div>Ratio: <span className="font-semibold">{summaryTotals.ratioPercent}</span></div>
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-500">Showing {Math.min(filtered.length, 500).toLocaleString()} of {filtered.length.toLocaleString()} filtered properties (first 500 rows)</div>
    </div>
  );
};

export default CostValuationTab;
