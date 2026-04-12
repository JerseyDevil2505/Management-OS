import { Download, Search, X, Save } from 'lucide-react';
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [savedAppraisals, setSavedAppraisals] = useState([]);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Valuation method - default from job's land valuation config
  const jobValuationMethod = marketLandData?.cascade_rates?.mode || marketLandData?.raw_land_config?.cascade_config?.mode || 'acre';
  const [valuationMethod, setValuationMethod] = useState(jobValuationMethod);

  // Search filters
  const [searchFilters, setSearchFilters] = useState({
    dateStart: new Date(new Date().getFullYear() - 5, 0, 1).toISOString().split('T')[0],
    dateEnd: new Date().toISOString().split('T')[0],
    vcs: [],
    zoning: [],
    utilityGas: 'any',
    utilityWater: 'any',
    utilitySewer: 'any',
  });

  // Unique VCS and zoning values from properties
  const uniqueVCS = useMemo(() => {
    const set = new Set();
    properties.forEach(p => { if (p.property_vcs) set.add(p.property_vcs); });
    return Array.from(set).sort();
  }, [properties]);

  const uniqueZoning = useMemo(() => {
    const set = new Set();
    properties.forEach(p => { if (p.property_zoning) set.add(p.property_zoning); });
    return Array.from(set).sort();
  }, [properties]);

  // Load saved appraisals on mount
  useEffect(() => {
    if (jobData?.id) loadSavedAppraisals();
  }, [jobData?.id]);

  const loadSavedAppraisals = async () => {
    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .select('id, job_id, created_at, updated_at')
        .eq('job_id', jobData.id);
      
      if (error) throw error;
      
      // Load vacant_land_appraisals from the job's market land data
      const existing = data?.[0];
      if (existing) {
        const { data: full } = await supabase
          .from('market_land_valuation')
          .select('vacant_land_appraisals')
          .eq('id', existing.id)
          .single();
        
        if (full?.vacant_land_appraisals) {
          setSavedAppraisals(full.vacant_land_appraisals);
        }
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

  // Get lot size value based on current valuation method
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
    if (valuationMethod === 'ff') return 'Front Feet';
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

  // Calculate estimated land value
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

  // Search for vacant land sales
  const handleSearch = useCallback(() => {
    const results = properties.filter(prop => {
      // Must have a valid sale
      const hasValidSale = prop.sales_date && prop.sales_price && Number(prop.sales_price) > 10;
      if (!hasValidSale) return false;

      // Date range check
      const saleDate = new Date(prop.sales_date);
      const startDate = new Date(searchFilters.dateStart);
      startDate.setHours(0,0,0,0);
      const endDate = new Date(searchFilters.dateEnd);
      endDate.setHours(23,59,59,999);
      if (saleDate < startDate || saleDate > endDate) return false;

      // NU code check (valid sales only)
      const nu = (prop.sales_nu || '').toString().trim();
      const validNu = nu === '' || ['00','07','7'].includes(nu) || prop.sales_nu?.toString().startsWith(' ');
      if (!validNu) return false;

      // Must be vacant class (1 or 3B) or teardown or pre-construction
      const m4Class = String(prop.property_m4_class || '').toUpperCase();
      const isVacantClass = m4Class === '1' || m4Class === '3B';
      const isTeardown = m4Class === '2' && 
                         prop.asset_building_class && parseInt(prop.asset_building_class) > 10 &&
                         (prop.values_mod_improvement || 0) < 10000;
      const isPreConstruction = m4Class === '2' &&
                               prop.asset_year_built && prop.sales_date &&
                               new Date(prop.sales_date).getFullYear() < prop.asset_year_built;
      
      if (!isVacantClass && !isTeardown && !isPreConstruction) return false;

      // Skip additional cards
      if (prop.property_addl_card) {
        const card = String(prop.property_addl_card).trim().toUpperCase();
        if (vendorType === 'BRT') {
          if (card !== '' && card !== 'NONE' && !card.startsWith('1')) return false;
        } else {
          if (card !== '' && card !== 'NONE' && card !== 'M') return false;
        }
      }

      // VCS filter
      if (searchFilters.vcs.length > 0 && !searchFilters.vcs.includes(prop.property_vcs)) return false;

      // Zoning filter
      if (searchFilters.zoning.length > 0 && !searchFilters.zoning.includes(prop.property_zoning)) return false;

      // Utility filters
      if (searchFilters.utilityGas !== 'any') {
        const hasGas = prop.utility_heat && prop.utility_heat.toLowerCase().includes('gas');
        if (searchFilters.utilityGas === 'yes' && !hasGas) return false;
        if (searchFilters.utilityGas === 'no' && hasGas) return false;
      }
      if (searchFilters.utilityWater !== 'any') {
        const hasPublicWater = prop.utility_water && prop.utility_water.toLowerCase().includes('public');
        if (searchFilters.utilityWater === 'yes' && !hasPublicWater) return false;
        if (searchFilters.utilityWater === 'no' && hasPublicWater) return false;
      }
      if (searchFilters.utilitySewer !== 'any') {
        const hasPublicSewer = prop.utility_sewer && prop.utility_sewer.toLowerCase().includes('public');
        if (searchFilters.utilitySewer === 'yes' && !hasPublicSewer) return false;
        if (searchFilters.utilitySewer === 'no' && hasPublicSewer) return false;
      }

      return true;
    });

    // Sort by sale date descending
    results.sort((a, b) => new Date(b.sales_date) - new Date(a.sales_date));
    setSearchResults(results);
  }, [properties, searchFilters, vendorType]);

  // Add search result to a comp slot
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
      // Upsert into market_land_valuation
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
    
    // Auto-evaluate
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

  // Helper to render a simple data row
  const renderDataRow = (label, getValue, options = {}) => (
    <tr className={`border-t border-gray-200 ${options.className || ''}`}>
      <td className={`px-3 py-2 font-medium text-gray-700 ${options.bold ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`px-3 py-2 text-center ${options.subjectBg || 'bg-yellow-50'} text-xs ${options.bold ? 'font-semibold' : ''}`}>
        {getValue(subjectProp)}
      </td>
      {vacantLandComps.map((comp, idx) => {
        const prop = loadedProperties[`comp_${idx}`];
        return (
          <td key={idx} className={`px-3 py-2 text-center ${options.compBg || 'bg-blue-50'} border-l border-gray-300 text-xs ${options.bold ? 'font-semibold' : ''}`}>
            {getValue(prop)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Header with method toggle */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">Vacant Land Appraisal</h3>
            <p className="text-xs text-blue-700">
              Search for vacant land sales, enter subject/comps, and evaluate estimated land value.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-white rounded-lg border border-blue-200 p-1">
            {[
              { key: 'acre', label: 'Acre' },
              { key: 'sf', label: 'Sq Ft' },
              { key: 'ff', label: 'Front Ft' },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => setValuationMethod(m.key)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-600">Saved:</span>
          {savedAppraisals.map(a => (
            <div key={a.id} className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded px-2.5 py-1">
              <button
                onClick={() => handleLoadAppraisal(a)}
                className="text-xs text-blue-700 hover:text-blue-900 hover:underline font-medium"
              >
                {a.name}
              </button>
              <span className="text-xs text-gray-400 ml-1">({new Date(a.created_at).toLocaleDateString()})</span>
              <button
                onClick={() => handleDeleteAppraisal(a.id)}
                className="ml-1 text-red-400 hover:text-red-600 text-xs font-bold"
                title="Delete"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search Engine */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Search Vacant Land Sales</span>
            {searchResults.length > 0 && (
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">{searchResults.length} found</span>
            )}
          </div>
          <span className="text-gray-400 text-sm">{showSearch ? '▲' : '▼'}</span>
        </button>

        {showSearch && (
          <div className="p-4 space-y-3 border-t border-gray-200">
            {/* Filter Row 1: Dates */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sales Date From</label>
                <input
                  type="date"
                  value={searchFilters.dateStart}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, dateStart: e.target.value }))}
                  className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sales Date To</label>
                <input
                  type="date"
                  value={searchFilters.dateEnd}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, dateEnd: e.target.value }))}
                  className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                />
              </div>
            </div>

            {/* Filter Row 2: VCS + Zoning */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">VCS</label>
                <div className="flex flex-wrap items-center gap-1">
                  {searchFilters.vcs.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 border border-blue-300 text-blue-800">
                      {v}
                      <button onClick={() => setSearchFilters(prev => ({ ...prev, vcs: prev.vcs.filter(x => x !== v) }))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !searchFilters.vcs.includes(e.target.value)) {
                        setSearchFilters(prev => ({ ...prev, vcs: [...prev.vcs, e.target.value] }));
                      }
                    }}
                    className="px-2 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="">+ VCS</option>
                    {uniqueVCS.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Zoning</label>
                <div className="flex flex-wrap items-center gap-1">
                  {searchFilters.zoning.map(z => (
                    <span key={z} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 border border-green-300 text-green-800">
                      {z}
                      <button onClick={() => setSearchFilters(prev => ({ ...prev, zoning: prev.zoning.filter(x => x !== z) }))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && !searchFilters.zoning.includes(e.target.value)) {
                        setSearchFilters(prev => ({ ...prev, zoning: [...prev.zoning, e.target.value] }));
                      }
                    }}
                    className="px-2 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="">+ Zone</option>
                    {uniqueZoning.map(z => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Filter Row 3: Utilities */}
            <div className="flex flex-wrap items-end gap-4">
              {[
                { key: 'utilityGas', label: 'Gas' },
                { key: 'utilityWater', label: 'Public Water' },
                { key: 'utilitySewer', label: 'Public Sewer' },
              ].map(u => (
                <div key={u.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{u.label}</label>
                  <select
                    value={searchFilters[u.key]}
                    onChange={(e) => setSearchFilters(prev => ({ ...prev, [u.key]: e.target.value }))}
                    className="px-2 py-1 text-xs border border-gray-300 rounded"
                  >
                    <option value="any">Any</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              ))}
            </div>

            {/* Search Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
              >
                <span className="flex items-center gap-1"><Search className="w-3.5 h-3.5" /> Search</span>
              </button>
              {searchResults.length > 0 && (
                <span className="text-xs text-gray-500">{searchResults.length} vacant land sale{searchResults.length !== 1 ? 's' : ''} found</span>
              )}
            </div>

            {/* Search Results Table */}
            {searchResults.length > 0 && (
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Block</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Lot</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Qual</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">VCS</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Zone</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-600">{getSizeLabel()}</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-600">Sale Price</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Sale Date</th>
                      <th className="px-2 py-1.5 text-right font-medium text-gray-600">{getUnitLabel()}</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Heat</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Water</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-600">Sewer</th>
                      <th className="px-2 py-1.5 text-center font-medium text-gray-600"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((prop, i) => {
                      const size = getLotSizeForMethod(prop);
                      const pricePerUnit = size > 0 ? parseFloat(prop.sales_price) / size : 0;
                      return (
                        <tr key={i} className="border-t border-gray-100 hover:bg-blue-50">
                          <td className="px-2 py-1.5">{prop.property_block}</td>
                          <td className="px-2 py-1.5">{prop.property_lot}</td>
                          <td className="px-2 py-1.5">{prop.property_qualifier || ''}</td>
                          <td className="px-2 py-1.5">{prop.property_vcs || ''}</td>
                          <td className="px-2 py-1.5">{prop.property_zoning || ''}</td>
                          <td className="px-2 py-1.5 text-right">{formatSize(prop)}</td>
                          <td className="px-2 py-1.5 text-right">${Math.round(parseFloat(prop.sales_price)).toLocaleString()}</td>
                          <td className="px-2 py-1.5">{prop.sales_date ? new Date(prop.sales_date).toLocaleDateString() : ''}</td>
                          <td className="px-2 py-1.5 text-right font-medium">${Math.round(pricePerUnit).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-gray-500">{prop.utility_heat || ''}</td>
                          <td className="px-2 py-1.5 text-gray-500">{prop.utility_water || ''}</td>
                          <td className="px-2 py-1.5 text-gray-500">{prop.utility_sewer || ''}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={() => addToComp(prop)}
                              className="px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                              title="Add as comparable"
                            >
                              + Comp
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Entry Section */}
      <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-3 border-b border-gray-300">
          <h4 className="font-semibold text-gray-900">Property Entry</h4>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-32"></th>
                <th className="px-3 py-2 text-center font-semibold bg-yellow-50 w-20">Subject</th>
                {[1, 2, 3, 4, 5].map((compNum) => (
                  <th key={compNum} className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300 w-20">
                    Comp {compNum}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {/* Block */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Block</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.block}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, block: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Block"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.block}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], block: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Block"
                    />
                  </td>
                ))}
              </tr>

              {/* Lot */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Lot</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.lot}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, lot: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Lot"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.lot}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], lot: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Lot"
                    />
                  </td>
                ))}
              </tr>

              {/* Qualifier */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Qual</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.qualifier}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, qualifier: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Qual"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.qualifier}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], qualifier: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Qual"
                    />
                  </td>
                ))}
              </tr>

              {/* Lot Size preview */}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-700 text-xs">Lot Size ({getSizeLabel()})</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs font-medium">
                  {(() => {
                    const prop = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
                    return formatSize(prop);
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => {
                  const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                  return (
                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs font-medium">
                      {formatSize(prop)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Evaluate Button Section */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-3">
          <button
            onClick={handleEvaluate}
            disabled={!vacantLandSubject.block || !vacantLandSubject.lot || vacantLandEvaluating}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded font-medium text-sm hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {vacantLandEvaluating ? 'Loading...' : 'Evaluate & Load Properties'}
          </button>

          {/* Save */}
          {showSaveInput ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={saveNameInput}
                onChange={(e) => setSaveNameInput(e.target.value)}
                placeholder="Appraisal name..."
                className="px-2 py-1.5 text-xs border border-gray-300 rounded w-40"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSave(saveNameInput)}
              />
              <button
                onClick={() => handleSave(saveNameInput)}
                className="px-3 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600"
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
              className="flex items-center gap-1 px-4 py-2 bg-green-500 text-white rounded font-medium text-sm hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              <Save size={14} /> Save
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={!vacantLandResult}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded font-medium text-sm hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Appraisal Grid */}
      {subjectProp && (
        <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-3 border-b border-gray-300">
            <h4 className="font-semibold text-gray-900">Appraisal Grid</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-gray-300">
                  <th className="px-3 py-2 text-left font-semibold text-gray-700 w-32">Attribute</th>
                  <th className="px-3 py-2 text-center font-semibold bg-yellow-50 w-24">Subject</th>
                  {[1, 2, 3, 4, 5].map((compNum) => (
                    <th key={compNum} className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300 w-24">
                      Comp {compNum}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {renderDataRow('Location', p => p?.property_location || '-')}
                {renderDataRow('Lot Size FF', p => p?.asset_lot_frontage ? parseFloat(p.asset_lot_frontage).toFixed(0) : '-')}
                {renderDataRow('Lot Size SF', p => p?.asset_lot_sf ? Math.round(parseFloat(p.asset_lot_sf)).toLocaleString() : '-')}
                {renderDataRow('Lot Size Acre', p => p?.asset_lot_acre ? parseFloat(p.asset_lot_acre).toFixed(3) : '-')}
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
        <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
          <p className="text-sm font-semibold text-green-900">Estimated Vacant Land Value</p>
          <p className="text-4xl font-bold text-green-700 mt-3">
            ${vacantLandResult.toLocaleString('en-US', {maximumFractionDigits: 0})}
          </p>
          <p className="text-sm text-green-700 mt-3">
            {(() => {
              const validComps = Object.keys(loadedProperties).filter(k => k.startsWith('comp_')).filter(k => loadedProperties[k]).length;
              const subjectSize = getLotSizeForMethod(subjectProp);
              return `${validComps} comparable(s) × avg ${getUnitLabel().replace('$/', '')} rate × ${
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
