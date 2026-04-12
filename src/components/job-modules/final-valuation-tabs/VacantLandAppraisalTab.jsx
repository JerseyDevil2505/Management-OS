import { Download, X, Save, Filter } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const VacantLandAppraisalTab = ({ 
  properties = [], 
  jobData,
  vendorType = 'BRT',
  codeDefinitions,
  marketLandData = {},
  onUpdateJobCache,
  vacantLandSubject,
  setVacantLandSubject,
  vacantLandComps,
  setVacantLandComps,
  vacantLandEvaluating,
  setVacantLandEvaluating,
  vacantLandResult,
  setVacantLandResult
}) => {
  const [loadedProperties, setLoadedProperties] = useState({});
  const [savedAppraisals, setSavedAppraisals] = useState([]);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Valuation method - default from job's land valuation config
  const jobValuationMethod = marketLandData?.cascade_rates?.mode || marketLandData?.raw_land_config?.cascade_config?.mode || 'acre';
  const [valuationMethod, setValuationMethod] = useState(jobValuationMethod);

  // Filters for the Method 1 sales table
  const [filters, setFilters] = useState({
    vcs: [],
    zoning: [],
    utilityGas: 'any',
    utilityWater: 'any',
    utilitySewer: 'any',
    category: 'all', // all, building_lot, teardown, pre-construction
  });

  // Build the vacant land sales array from Method 1 saved data
  const method1Sales = useMemo(() => {
    const savedSales = marketLandData?.vacant_sales_analysis?.sales || [];
    if (savedSales.length === 0) return [];

    // Build a lookup of property data by ID
    const propMap = {};
    properties.forEach(p => { if (p.id) propMap[p.id] = p; });

    // Cross-reference saved sale IDs with full property records
    return savedSales
      .filter(s => s.included !== false) // only included sales
      .map(s => {
        const prop = propMap[s.id];
        if (!prop) return null;
        return {
          ...prop,
          _category: s.category || null,
          _specialRegion: s.special_region || 'Normal',
          _notes: s.notes || null,
          _manuallyAdded: s.manually_added || false,
        };
      })
      .filter(Boolean);
  }, [marketLandData, properties]);

  // Unique VCS and zoning from method1Sales
  const uniqueVCS = useMemo(() => {
    const set = new Set();
    method1Sales.forEach(p => { if (p.property_vcs) set.add(p.property_vcs); });
    return Array.from(set).sort();
  }, [method1Sales]);

  const uniqueZoning = useMemo(() => {
    const set = new Set();
    method1Sales.forEach(p => { if (p.property_zoning) set.add(p.property_zoning); });
    return Array.from(set).sort();
  }, [method1Sales]);

  const uniqueCategories = useMemo(() => {
    const set = new Set();
    method1Sales.forEach(p => { if (p._category) set.add(p._category); });
    return Array.from(set).sort();
  }, [method1Sales]);

  // Filtered sales
  const filteredSales = useMemo(() => {
    return method1Sales.filter(prop => {
      if (filters.vcs.length > 0 && !filters.vcs.includes(prop.property_vcs)) return false;
      if (filters.zoning.length > 0 && !filters.zoning.includes(prop.property_zoning)) return false;
      if (filters.category !== 'all' && prop._category !== filters.category) return false;

      if (filters.utilityGas !== 'any') {
        const hasGas = prop.utility_heat && prop.utility_heat.toLowerCase().includes('gas');
        if (filters.utilityGas === 'yes' && !hasGas) return false;
        if (filters.utilityGas === 'no' && hasGas) return false;
      }
      if (filters.utilityWater !== 'any') {
        const hasWater = prop.utility_water && prop.utility_water.toLowerCase().includes('public');
        if (filters.utilityWater === 'yes' && !hasWater) return false;
        if (filters.utilityWater === 'no' && hasWater) return false;
      }
      if (filters.utilitySewer !== 'any') {
        const hasSewer = prop.utility_sewer && prop.utility_sewer.toLowerCase().includes('public');
        if (filters.utilitySewer === 'yes' && !hasSewer) return false;
        if (filters.utilitySewer === 'no' && hasSewer) return false;
      }

      return true;
    });
  }, [method1Sales, filters]);

  // Load saved appraisals on mount
  useEffect(() => {
    if (jobData?.id) loadSavedAppraisals();
  }, [jobData?.id]);

  const loadSavedAppraisals = async () => {
    try {
      const { data } = await supabase
        .from('market_land_valuation')
        .select('vacant_land_appraisals')
        .eq('job_id', jobData.id)
        .single();
      
      if (data?.vacant_land_appraisals) {
        setSavedAppraisals(data.vacant_land_appraisals);
      }
    } catch (err) {
      console.warn('Could not load saved appraisals:', err.message);
    }
  };

  // Property lookup
  const getPropertyData = useCallback((block, lot, qualifier) => {
    if (!block || !lot) return null;
    const blockStr = String(block).trim();
    const lotStr = String(lot).trim();
    const qualStr = String(qualifier || '').trim();
    
    return properties.find(p => {
      if (!p.property_block || !p.property_lot) return false;
      const pBlock = String(p.property_block).trim();
      const pLot = String(p.property_lot).trim();
      const pQual = String(p.property_qualifier || '').trim();
      return pBlock === blockStr && pLot === lotStr && 
             (!qualStr || pQual === qualStr || !pQual);
    }) || null;
  }, [properties]);

  // Lot size helpers
  const getLotSizeForMethod = useCallback((prop) => {
    if (!prop) return 0;
    if (valuationMethod === 'ff') return parseFloat(prop.asset_lot_frontage) || 0;
    if (valuationMethod === 'sf') return (parseFloat(prop.asset_lot_acre) || 0) * 43560;
    return parseFloat(prop.asset_lot_acre) || 0;
  }, [valuationMethod]);

  const getUnitLabel = useCallback(() => {
    if (valuationMethod === 'ff') return '$/FF';
    if (valuationMethod === 'sf') return '$/SF';
    return '$/Acre';
  }, [valuationMethod]);

  const getSizeLabel = useCallback(() => {
    if (valuationMethod === 'ff') return 'Front Ft';
    if (valuationMethod === 'sf') return 'Sq Ft';
    return 'Acres';
  }, [valuationMethod]);

  const formatSize = useCallback((prop) => {
    const size = getLotSizeForMethod(prop);
    if (size === 0) return '-';
    if (valuationMethod === 'acre') return size.toFixed(3);
    if (valuationMethod === 'sf') return Math.round(size).toLocaleString();
    return Math.round(size).toLocaleString();
  }, [valuationMethod, getLotSizeForMethod]);

  const getCategoryLabel = (cat) => {
    switch (cat) {
      case 'building_lot': return 'Bldg Lot';
      case 'teardown': return 'Teardown';
      case 'pre-construction': return 'Pre-Con';
      default: return cat || 'Vacant';
    }
  };

  const getCategoryColor = (cat) => {
    switch (cat) {
      case 'teardown': return 'bg-orange-100 text-orange-700';
      case 'pre-construction': return 'bg-purple-100 text-purple-700';
      case 'building_lot': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  // Estimated land value
  const estimatedLandValue = useMemo(() => {
    const subjectProp = loadedProperties.subject;
    const subjectSize = getLotSizeForMethod(subjectProp);
    if (!subjectSize || subjectSize === 0) return null;

    const comps = Object.keys(loadedProperties)
      .filter(key => key.startsWith('comp_'))
      .map(key => loadedProperties[key])
      .filter(prop => {
        if (!prop || !prop.sales_price) return false;
        const size = getLotSizeForMethod(prop);
        return size > 0 && parseFloat(prop.sales_price) > 0;
      });

    if (comps.length === 0) return null;

    const avgPricePerUnit = comps.reduce((sum, prop) => {
      const size = getLotSizeForMethod(prop);
      return sum + (parseFloat(prop.sales_price) / size);
    }, 0) / comps.length;

    return Math.round(subjectSize * avgPricePerUnit);
  }, [loadedProperties, getLotSizeForMethod]);

  // Evaluate handler
  const handleEvaluate = () => {
    setVacantLandEvaluating(true);
    const subjectData = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
    const loaded = { subject: subjectData };
    
    vacantLandComps.forEach((comp, idx) => {
      const compData = getPropertyData(comp.block, comp.lot, comp.qualifier);
      loaded[`comp_${idx}`] = compData;
    });
    
    setLoadedProperties(loaded);
    setVacantLandEvaluating(false);
  };

  // Recalculate result when loadedProperties changes
  useEffect(() => {
    if (loadedProperties.subject && estimatedLandValue !== null) {
      setVacantLandResult(estimatedLandValue);
    }
  }, [loadedProperties, estimatedLandValue, setVacantLandResult]);

  // Add from sales table to comp slot
  const addToComp = (prop) => {
    const emptyIdx = vacantLandComps.findIndex(c => !c.block && !c.lot);
    if (emptyIdx >= 0) {
      const newComps = [...vacantLandComps];
      newComps[emptyIdx] = {
        block: prop.property_block || '',
        lot: prop.property_lot || '',
        qualifier: prop.property_qualifier || ''
      };
      setVacantLandComps(newComps);
    }
  };

  // Save appraisal
  const handleSave = async (name) => {
    if (!loadedProperties.subject) return;
    
    const appraisal = {
      id: Date.now().toString(),
      name: name || `Appraisal ${savedAppraisals.length + 1}`,
      created_at: new Date().toISOString(),
      valuation_method: valuationMethod,
      subject: {
        block: vacantLandSubject.block,
        lot: vacantLandSubject.lot,
        qualifier: vacantLandSubject.qualifier,
      },
      comps: vacantLandComps.filter(c => c.block || c.lot).map(c => ({
        block: c.block,
        lot: c.lot,
        qualifier: c.qualifier,
      })),
      result: vacantLandResult,
    };

    const updated = [...savedAppraisals, appraisal];

    try {
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();

      if (existing) {
        await supabase
          .from('market_land_valuation')
          .update({ vacant_land_appraisals: updated })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('market_land_valuation')
          .insert({ job_id: jobData.id, vacant_land_appraisals: updated });
      }

      setSavedAppraisals(updated);
      setShowSaveInput(false);
      setSaveNameInput('');
    } catch (err) {
      console.error('Failed to save appraisal:', err);
    }
  };

  // Load a saved appraisal
  const handleLoadAppraisal = (appraisal) => {
    setVacantLandSubject(appraisal.subject);
    
    const newComps = [
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' },
      { block: '', lot: '', qualifier: '' }
    ];
    (appraisal.comps || []).forEach((c, i) => {
      if (i < 5) newComps[i] = c;
    });
    setVacantLandComps(newComps);
    
    if (appraisal.valuation_method) setValuationMethod(appraisal.valuation_method);
    
    setTimeout(() => {
      const subjectData = getPropertyData(appraisal.subject.block, appraisal.subject.lot, appraisal.subject.qualifier);
      const loaded = { subject: subjectData };
      newComps.forEach((comp, idx) => {
        loaded[`comp_${idx}`] = getPropertyData(comp.block, comp.lot, comp.qualifier);
      });
      setLoadedProperties(loaded);
    }, 100);
  };

  // Delete a saved appraisal
  const handleDeleteAppraisal = async (id) => {
    const updated = savedAppraisals.filter(a => a.id !== id);
    try {
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();

      if (existing) {
        await supabase
          .from('market_land_valuation')
          .update({ vacant_land_appraisals: updated })
          .eq('id', existing.id);
      }
      setSavedAppraisals(updated);
    } catch (err) {
      console.error('Failed to delete appraisal:', err);
    }
  };

  const handleExport = () => {
    alert('Export to PDF coming soon - will generate appraisal report');
  };

  const subjectProp = loadedProperties.subject;

  // Helper to render a data row in the appraisal grid
  const renderDataRow = (label, getValue, options = {}) => (
    <tr className={`border-t border-gray-200 ${options.className || ''}`}>
      <td className={`px-2 py-1.5 font-medium text-gray-700 text-xs whitespace-nowrap ${options.bold ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`px-2 py-1.5 text-center ${options.subjectBg || 'bg-yellow-50'} text-xs ${options.bold ? 'font-semibold' : ''}`}>
        {getValue(subjectProp)}
      </td>
      {vacantLandComps.map((comp, idx) => {
        const prop = loadedProperties[`comp_${idx}`];
        return (
          <td key={idx} className={`px-2 py-1.5 text-center ${options.compBg || 'bg-blue-50'} border-l border-gray-300 text-xs ${options.bold ? 'font-semibold' : ''}`}>
            {getValue(prop)}
          </td>
        );
      })}
    </tr>
  );

  const activeFilterCount = [
    filters.vcs.length > 0,
    filters.zoning.length > 0,
    filters.category !== 'all',
    filters.utilityGas !== 'any',
    filters.utilityWater !== 'any',
    filters.utilitySewer !== 'any',
  ].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Header with method toggle */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-blue-900 text-sm">Vacant Land Appraisal</h3>
            <p className="text-xs text-blue-700">
              {method1Sales.length > 0
                ? `${method1Sales.length} vacant land sale${method1Sales.length !== 1 ? 's' : ''} from Land Valuation Method 1`
                : 'No vacant land sales found — run Land Valuation Method 1 first'}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-white rounded-lg border border-blue-200 p-0.5">
            {[
              { key: 'acre', label: 'Acre' },
              { key: 'sf', label: 'Sq Ft' },
              { key: 'ff', label: 'Front Ft' },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => setValuationMethod(m.key)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  valuationMethod === m.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Saved Appraisals */}
      {savedAppraisals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-600">Saved:</span>
          {savedAppraisals.map(a => (
            <div key={a.id} className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-2 py-0.5">
              <button
                onClick={() => handleLoadAppraisal(a)}
                className="text-xs text-blue-700 hover:text-blue-900 hover:underline font-medium"
              >
                {a.name}
              </button>
              <span className="text-xs text-gray-400">({new Date(a.created_at).toLocaleDateString()})</span>
              <button
                onClick={() => handleDeleteAppraisal(a.id)}
                className="ml-0.5 text-red-400 hover:text-red-600"
                title="Delete"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Vacant Land Sales from Method 1 */}
      {method1Sales.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Vacant Land Sales
              {filteredSales.length !== method1Sales.length && (
                <span className="text-xs text-gray-500 ml-1">
                  ({filteredSales.length} of {method1Sales.length})
                </span>
              )}
            </span>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-3 h-3" />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          {/* Inline Filters */}
          {showFilters && (
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex flex-wrap items-end gap-3">
              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Type</label>
                <select
                  value={filters.category}
                  onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
                  className="px-2 py-1 text-xs border border-gray-300 rounded"
                >
                  <option value="all">All</option>
                  {uniqueCategories.map(c => (
                    <option key={c} value={c}>{getCategoryLabel(c)}</option>
                  ))}
                </select>
              </div>

              {/* VCS */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">VCS</label>
                <div className="flex flex-wrap items-center gap-1">
                  {filters.vcs.map(v => (
                    <span key={v} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full bg-blue-100 border border-blue-300 text-blue-800">
                      {v}
                      <button onClick={() => setFilters(prev => ({ ...prev, vcs: prev.vcs.filter(x => x !== v) }))}><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !filters.vcs.includes(e.target.value)) {
                        setFilters(prev => ({ ...prev, vcs: [...prev.vcs, e.target.value] }));
                      }
                    }}
                    className="px-1.5 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="">+ VCS</option>
                    {uniqueVCS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Zoning */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Zoning</label>
                <div className="flex flex-wrap items-center gap-1">
                  {filters.zoning.map(z => (
                    <span key={z} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs rounded-full bg-green-100 border border-green-300 text-green-800">
                      {z}
                      <button onClick={() => setFilters(prev => ({ ...prev, zoning: prev.zoning.filter(x => x !== z) }))}><X className="w-2.5 h-2.5" /></button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !filters.zoning.includes(e.target.value)) {
                        setFilters(prev => ({ ...prev, zoning: [...prev.zoning, e.target.value] }));
                      }
                    }}
                    className="px-1.5 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="">+ Zone</option>
                    {uniqueZoning.map(z => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
              </div>

              {/* Utilities */}
              {[
                { key: 'utilityGas', label: 'Gas' },
                { key: 'utilityWater', label: 'Water' },
                { key: 'utilitySewer', label: 'Sewer' },
              ].map(u => (
                <div key={u.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">{u.label}</label>
                  <select
                    value={filters[u.key]}
                    onChange={(e) => setFilters(prev => ({ ...prev, [u.key]: e.target.value }))}
                    className="px-1.5 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="any">Any</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              ))}

              {activeFilterCount > 0 && (
                <button
                  onClick={() => setFilters({ vcs: [], zoning: [], utilityGas: 'any', utilityWater: 'any', utilitySewer: 'any', category: 'all' })}
                  className="px-2 py-1 text-xs text-red-600 hover:text-red-800 font-medium"
                >
                  Clear All
                </button>
              )}
            </div>
          )}

          {/* Sales Table */}
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-16">Block</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-14">Lot</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-10">Q</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-12">VCS</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-14">Zone</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-16">Type</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-16">{getSizeLabel()}</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-20">Sale Price</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-20">Sale Date</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-16">{getUnitLabel()}</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-12">Region</th>
                  <th className="px-2 py-1.5 text-center font-medium text-gray-600 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-4 text-center text-gray-500 text-xs">
                      {method1Sales.length > 0
                        ? 'No sales match the current filters'
                        : 'No vacant land sales data available'}
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((prop, i) => {
                    const size = getLotSizeForMethod(prop);
                    const pricePerUnit = size > 0 ? parseFloat(prop.sales_price) / size : 0;
                    return (
                      <tr key={prop.id || i} className="border-t border-gray-100 hover:bg-blue-50">
                        <td className="px-2 py-1">{prop.property_block}</td>
                        <td className="px-2 py-1">{prop.property_lot}</td>
                        <td className="px-2 py-1">{prop.property_qualifier || ''}</td>
                        <td className="px-2 py-1">{prop.property_vcs || ''}</td>
                        <td className="px-2 py-1">{prop.property_zoning || ''}</td>
                        <td className="px-2 py-1">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${getCategoryColor(prop._category)}`}>
                            {getCategoryLabel(prop._category)}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right">{formatSize(prop)}</td>
                        <td className="px-2 py-1 text-right">${Math.round(parseFloat(prop.sales_price)).toLocaleString()}</td>
                        <td className="px-2 py-1">{prop.sales_date ? new Date(prop.sales_date).toLocaleDateString() : ''}</td>
                        <td className="px-2 py-1 text-right font-medium">${Math.round(pricePerUnit).toLocaleString()}</td>
                        <td className="px-2 py-1 text-gray-500">{prop._specialRegion !== 'Normal' ? prop._specialRegion : ''}</td>
                        <td className="px-2 py-1 text-center">
                          <button
                            onClick={() => addToComp(prop)}
                            className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                            title="Add as comparable"
                          >
                            + Comp
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Method 1 data message */}
      {method1Sales.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-center">
          <p className="text-sm text-amber-800 font-medium">No Vacant Land Sales Available</p>
          <p className="text-xs text-amber-600 mt-1">
            Run Land Valuation Method 1 and save to populate this table with identified vacant land sales.
          </p>
        </div>
      )}

      {/* Entry Section */}
      <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-3 py-2 border-b border-gray-300">
          <h4 className="font-semibold text-gray-900 text-sm">Property Entry</h4>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className="px-2 py-1.5 text-left font-semibold text-gray-700 w-24"></th>
                <th className="px-2 py-1.5 text-center font-semibold bg-yellow-50 w-20">Subject</th>
                {[1, 2, 3, 4, 5].map((compNum) => (
                  <th key={compNum} className="px-2 py-1.5 text-center font-semibold bg-blue-50 border-l border-gray-300 w-20">
                    Comp {compNum}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {/* Block */}
              <tr className="border-t border-gray-200">
                <td className="px-2 py-1.5 font-medium text-gray-700 text-xs">Block</td>
                <td className="px-2 py-1.5 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.block}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, block: e.target.value }))}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Block"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.block}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], block: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Block"
                    />
                  </td>
                ))}
              </tr>

              {/* Lot */}
              <tr className="border-t border-gray-200">
                <td className="px-2 py-1.5 font-medium text-gray-700 text-xs">Lot</td>
                <td className="px-2 py-1.5 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.lot}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, lot: e.target.value }))}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Lot"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.lot}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], lot: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Lot"
                    />
                  </td>
                ))}
              </tr>

              {/* Qualifier */}
              <tr className="border-t border-gray-200">
                <td className="px-2 py-1.5 font-medium text-gray-700 text-xs">Qual</td>
                <td className="px-2 py-1.5 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.qualifier}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, qualifier: e.target.value }))}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Qual"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.qualifier}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], qualifier: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Qual"
                    />
                  </td>
                ))}
              </tr>

              {/* Lot Size preview */}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-2 py-1.5 font-medium text-gray-700 text-xs whitespace-nowrap">Size ({getSizeLabel()})</td>
                <td className="px-2 py-1.5 text-center bg-yellow-50 text-xs font-medium">
                  {(() => {
                    const prop = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
                    return formatSize(prop);
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => {
                  const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                  return (
                    <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300 text-xs font-medium">
                      {formatSize(prop)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Evaluate Button Section */}
        <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
          <button
            onClick={handleEvaluate}
            disabled={!vacantLandSubject.block || !vacantLandSubject.lot || vacantLandEvaluating}
            className="flex-1 px-3 py-2 bg-blue-500 text-white rounded font-medium text-sm hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {vacantLandEvaluating ? 'Loading...' : 'Evaluate & Load Properties'}
          </button>

          {/* Save */}
          {showSaveInput ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={saveNameInput}
                onChange={(e) => setSaveNameInput(e.target.value)}
                placeholder="Appraisal name..."
                className="px-2 py-1.5 text-xs border border-gray-300 rounded w-32"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSave(saveNameInput)}
              />
              <button
                onClick={() => handleSave(saveNameInput)}
                className="px-2.5 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600"
              >
                Save
              </button>
              <button
                onClick={() => { setShowSaveInput(false); setSaveNameInput(''); }}
                className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveInput(true)}
              disabled={!subjectProp}
              className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded font-medium text-sm hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              <Save size={14} /> Save
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={!vacantLandResult}
            className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded font-medium text-sm hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Appraisal Grid */}
      {subjectProp && (
        <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-3 py-2 border-b border-gray-300">
            <h4 className="font-semibold text-gray-900 text-sm">Appraisal Grid</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-gray-300">
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-700 w-28">Attribute</th>
                  <th className="px-2 py-1.5 text-center font-semibold bg-yellow-50 w-20">Subject</th>
                  {[1, 2, 3, 4, 5].map((compNum) => (
                    <th key={compNum} className="px-2 py-1.5 text-center font-semibold bg-blue-50 border-l border-gray-300 w-20">
                      Comp {compNum}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {renderDataRow('Location', p => p?.property_location || '-')}
                {renderDataRow('Lot FF', p => p?.asset_lot_frontage ? parseFloat(p.asset_lot_frontage).toFixed(0) : '-')}
                {renderDataRow('Lot SF', p => p?.asset_lot_sf ? Math.round(parseFloat(p.asset_lot_sf)).toLocaleString() : '-')}
                {renderDataRow('Lot Acre', p => p?.asset_lot_acre ? parseFloat(p.asset_lot_acre).toFixed(3) : '-')}
                {renderDataRow('VCS', p => p?.property_vcs || '-')}
                {renderDataRow('Zoning', p => p?.property_zoning || '-')}
                {renderDataRow('Topography', p => p?.topography || '-')}
                {renderDataRow('Clearing', p => p?.clearing || '-')}
                {renderDataRow('Utility — Heat', p => p?.utility_heat || '-')}
                {renderDataRow('Utility — Water', p => p?.utility_water || '-')}
                {renderDataRow('Utility — Sewer', p => p?.utility_sewer || '-')}
                {renderDataRow('Current Assess', p => {
                  const total = p?.values_mod_total || p?.values_cama_total || 0;
                  return total > 0 ? '$' + Math.round(total).toLocaleString() : '-';
                })}
                {renderDataRow('Sales Price', p => p?.sales_price ? '$' + Math.round(parseFloat(p.sales_price)).toLocaleString() : '-')}
                {renderDataRow('Sales Date', p => p?.sales_date ? new Date(p.sales_date).toLocaleDateString() : '-')}
                {renderDataRow(getUnitLabel(), p => {
                  if (!p?.sales_price) return '-';
                  const size = getLotSizeForMethod(p);
                  if (size <= 0) return '-';
                  return '$' + Math.round(parseFloat(p.sales_price) / size).toLocaleString();
                }, { bold: true, subjectBg: 'bg-yellow-100', compBg: 'bg-blue-100' })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {vacantLandResult && (
        <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-green-900">Estimated Vacant Land Value</p>
          <p className="text-3xl font-bold text-green-700 mt-2">
            ${vacantLandResult.toLocaleString('en-US', {maximumFractionDigits: 0})}
          </p>
          <p className="text-xs text-green-700 mt-2">
            {(() => {
              const validComps = Object.keys(loadedProperties).filter(k => k.startsWith('comp_')).filter(k => loadedProperties[k]).length;
              const subjectSize = getLotSizeForMethod(subjectProp);
              return `${validComps} comparable(s) — avg ${getUnitLabel().replace('$/', '')} rate × ${
                valuationMethod === 'acre' ? (subjectSize || 0).toFixed(3) + ' acres' :
                valuationMethod === 'sf' ? Math.round(subjectSize || 0).toLocaleString() + ' SF' :
                Math.round(subjectSize || 0).toLocaleString() + ' FF'
              }`;
            })()}
          </p>
        </div>
      )}
    </div>
  );
};

export default VacantLandAppraisalTab;
