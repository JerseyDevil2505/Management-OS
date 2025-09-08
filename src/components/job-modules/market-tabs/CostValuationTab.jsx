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
  const [useGroup, setUseGroup] = useState('single_family');
  const [constructionAge, setConstructionAge] = useState('all'); // 'all' | 'new' (<=10) | 'newer' (<=20)

  // Factor state (job-level)
  const [costConvFactor, setCostConvFactor] = useState(marketLandData?.cost_conv_factor ?? null);
  const [recommendedFactor, setRecommendedFactor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCostConvFactor(marketLandData?.cost_conv_factor ?? null);
  }, [marketLandData?.cost_conv_factor]);

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

  // Filter properties by year and type/use prefixes
  const filtered = useMemo(() => {
    return properties.filter(p => {
      const year = safeSaleYear(p);
      if (!year) return false;
      if (year < fromYear || year > toYear) return false;

      // asset_type_use exists on property_records
      const typeVal = p.asset_type_use ? p.asset_type_use.toString().trim() : '';
      const useVal = p.asset_building_class ? p.asset_building_class.toString().trim() : '';

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

      // Apply useGroup filter (uses building class when available)
      if (useGroup && useGroup !== 'all') {
        if (useGroup === 'single_family' && !useVal.startsWith('1')) return false;
        if (useGroup === 'multi_family' && !(useVal.startsWith('4') || useVal.startsWith('3'))) return false;
      }

      // Apply construction age
      if (constructionAge !== 'all') {
        const yearBuilt = p.asset_year_built || null;
        if (!yearBuilt) return false; // if missing, exclude when filtering by age
        const age = currentYear - parseInt(yearBuilt);
        if (constructionAge === 'new' && !(age <= 10)) return false;
        if (constructionAge === 'newer' && !(age <= 20)) return false;
      }

      return true;
    });
  }, [properties, fromYear, toYear, typeGroup, useGroup, constructionAge]);

  // Compute recommended factor based on available replacement/base cost and normalized sale price
  const computeRecommendedFactor = () => {
    const rows = filtered
      .map(p => {
        const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? p.values_norm_time : (p.sales_price || 0);
        const repl = p.values_repl_cost || p.values_base_cost || null;
        if (!repl || !salePrice || salePrice === 0) return null;
        return repl / salePrice; // how many dollars of replacement cost per normalized sale dollar
      })
      .filter(v => v && isFinite(v));

    if (rows.length === 0) {
      setRecommendedFactor(null);
      return null;
    }

    // Use median for robustness
    const sorted = rows.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    setRecommendedFactor(median);
    return median;
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

        <div>
          <label className="text-sm text-gray-600 block">Use/Building Class</label>
          <select
            value={useGroup}
            onChange={(e) => setUseGroup(e.target.value)}
            className="px-3 py-2 border rounded w-48"
          >
            <option value="single_family">Single Family Classes (1x)</option>
            <option value="multi_family">Multi/Other Classes</option>
            <option value="all">All Classes</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-gray-600 block">Construction Age</label>
          <select
            value={constructionAge}
            onChange={(e) => setConstructionAge(e.target.value)}
            className="px-3 py-2 border rounded w-40"
          >
            <option value="all">All Ages</option>
            <option value="new">New (&le; 10 years)</option>
            <option value="newer">Newer (&le; 20 years)</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-3 py-2 bg-gray-100 rounded text-sm"
            onClick={() => { setFromYear(currentYear - 3); setToYear(currentYear); setTypeGroup('single_family'); setUseGroup('single_family'); setConstructionAge('all'); }}
          >
            Reset
          </button>
          <button
            className="px-3 py-2 bg-green-600 text-white rounded text-sm"
            onClick={() => computeRecommendedFactor()}
          >
            Compute Recommended Factor
          </button>
        </div>
      </div>

      {recommendedFactor !== null && (
        <div className="mb-4 p-3 border border-gray-200 rounded bg-green-50 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-700 font-medium">Recommended Factor (median)</div>
            <div className="text-lg font-semibold">{Number(recommendedFactor).toFixed(3)}</div>
            <div className="text-xs text-gray-500">Based on {filtered.filter(p => (p.values_repl_cost || p.values_base_cost) && (p.values_norm_time || p.sales_price)).length} comparable properties</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 bg-yellow-600 text-white rounded text-sm"
              onClick={() => setCostConvFactor(Number(recommendedFactor.toFixed(3)))}
            >
              Use Recommendation
            </button>
            <button
              className="px-3 py-2 bg-blue-600 text-white rounded text-sm"
              onClick={() => saveCostConvFactor(Number(recommendedFactor.toFixed(3)))}
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
              <th className="px-3 py-2 text-xs text-gray-600">Block</th>
              <th className="px-3 py-2 text-xs text-gray-600">Lot</th>
              <th className="px-3 py-2 text-xs text-gray-600">Card</th>
              <th className="px-3 py-2 text-xs text-gray-600">Location</th>
              <th className="px-3 py-2 text-xs text-gray-600">Sale Year</th>
              <th className="px-3 py-2 text-xs text-gray-600">Sale Price</th>
              <th className="px-3 py-2 text-xs text-gray-600">Time Norm Price</th>
              <th className="px-3 py-2 text-xs text-gray-600">Replacement Cost</th>
              <th className="px-3 py-2 text-xs text-gray-600">Factor (repl / sale)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((p, i) => {
              const saleYear = safeSaleYear(p);
              const salePrice = (p.values_norm_time && p.values_norm_time > 0) ? p.values_norm_time : (p.sales_price || 0);
              const repl = p.values_repl_cost || p.values_base_cost || null;
              const factor = (repl && salePrice) ? (repl / salePrice) : null;

              return (
                <tr key={p.property_composite_key || i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm">{p.property_block || ''}</td>
                  <td className="px-3 py-2 text-sm">{p.property_lot || ''}</td>
                  <td className="px-3 py-2 text-sm">{p.property_card || ''}</td>
                  <td className="px-3 py-2 text-sm">{p.property_location || ''}</td>
                  <td className="px-3 py-2 text-sm">{saleYear || ''}</td>
                  <td className="px-3 py-2 text-sm">{salePrice ? salePrice.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-sm">{p.values_norm_time ? p.values_norm_time.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-sm">{repl ? repl.toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 text-sm">{factor ? Number(factor).toFixed(3) : '—'}</td>
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
