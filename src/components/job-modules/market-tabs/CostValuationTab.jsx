import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Calculator } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';

const CostValuationTab = ({ jobData, properties = [], marketLandData = {}, onUpdateJobCache }) => {
  const currentYear = new Date().getFullYear();

  // Filters
  const [fromYear, setFromYear] = useState(marketLandData?.cost_valuation_from_year ?? (currentYear - 3));
  const [toYear, setToYear] = useState(marketLandData?.cost_valuation_to_year ?? currentYear);
  // Replace prefix inputs with dropdown groupings
  const [typeGroup, setTypeGroup] = useState(marketLandData?.type_group ?? '1'); // default codes beginning with '1'
  // Price basis for calculations: 'price_time' or 'sale_price'
  const [priceBasis, setPriceBasis] = useState(marketLandData?.cost_valuation_price_basis ?? 'price_time');

  // Factor state (job-level)
  const [costConvFactor, setCostConvFactor] = useState(marketLandData?.cost_conv_factor ?? null);
  const [stateRecommendedFactor, setStateRecommendedFactor] = useState(marketLandData?.cost_conv_recommendation ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRange, setIsSavingRange] = useState(false);
  const [includedMap, setIncludedMap] = useState({});
  const [editedLandMap, setEditedLandMap] = useState({});
  const [editedDetItemMap, setEditedDetItemMap] = useState({});
  const [editedBaseCostMap, setEditedBaseCostMap] = useState({});
  const [editedBuildingClassMap, setEditedBuildingClassMap] = useState({});
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });
  // Persisted exclusions. Kept separate from includedMap because that map only
  // covers rows in the current filter, and narrowing the years must not silently
  // drop exclusions for rows that scrolled out of scope.
  const [excludedKeys, setExcludedKeys] = useState(new Set());
  const excludedList = useMemo(() => Array.from(excludedKeys), [excludedKeys]);

  // Helpers to get effective values (edited override or original)
  const getEffectiveDetItems = (p) => {
    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
    if (editedDetItemMap[key] !== undefined && editedDetItemMap[key] !== '') return Number(editedDetItemMap[key]);
    return (p.values_det_items !== undefined && p.values_det_items !== null) ? Number(p.values_det_items) : 0;
  };
  const getEffectiveBaseCost = (p) => {
    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
    if (editedBaseCostMap[key] !== undefined && editedBaseCostMap[key] !== '') return Number(editedBaseCostMap[key]);
    return (p.values_base_cost !== undefined && p.values_base_cost !== null) ? Number(p.values_base_cost) : 0;
  };
  const getEffectiveBuildingClass = (p) => {
    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
    if (editedBuildingClassMap[key] !== undefined) return editedBuildingClassMap[key];
    return p.asset_building_class || '';
  };
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
    if (Array.isArray(marketLandData?.cost_valuation_excluded)) {
      setExcludedKeys(new Set(marketLandData.cost_valuation_excluded));
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
        .upsert([{ job_id: jobData.id, cost_valuation_from_year: from, cost_valuation_to_year: to, cost_valuation_excluded: excludedList, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        // ensure UI reflects saved values
        if (data.cost_valuation_from_year !== undefined && data.cost_valuation_from_year !== null) setFromYear(Number(data.cost_valuation_from_year));
        if (data.cost_valuation_to_year !== undefined && data.cost_valuation_to_year !== null) setToYear(Number(data.cost_valuation_to_year));
      }
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 CostValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }
      setSavedYears(true);
      setTimeout(() => setSavedYears(false), 1500);
      console.log('Saved cost valuation year range', { from, to, excluded: excludedList.length });
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

    const extractErrorMessage = (err) => {
      if (!err) return 'Unknown error';
      if (typeof err === 'string') return err;
      if (err.message) return err.message;
      if (err.error) return err.error;
      if (err.details) return err.details;
      try { return JSON.stringify(err); } catch (e) { return String(err); }
    };

    try {
      const { data, error } = await supabase
        .from('market_land_valuation')
        .upsert([{ job_id: jobData.id, cost_valuation_price_basis: basis, updated_at: new Date().toISOString() }], { onConflict: 'job_id' })
        .select()
        .single();

      if (error) {
        // Fallback: try update then insert
        console.warn('Upsert failed, attempting update/insert fallback', error);
        const errMsg = extractErrorMessage(error);

        try {
          const { error: updateError } = await supabase
            .from('market_land_valuation')
            .update({ cost_valuation_price_basis: basis, updated_at: new Date().toISOString() })
            .eq('job_id', jobData.id);
          if (updateError) {
            // Try insert
            const { error: insertError } = await supabase
              .from('market_land_valuation')
              .insert({ job_id: jobData.id, cost_valuation_price_basis: basis, updated_at: new Date().toISOString() });
            if (insertError) throw insertError;
          }
        } catch (fallbackErr) {
          console.error('Fallback update/insert failed saving price basis:', fallbackErr);
          const msg = extractErrorMessage(fallbackErr);
          alert(`Failed to save price basis: ${msg}`);
          return;
        }
      }

      setPriceBasis(basis);
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 CostValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }
    } catch (e) {
      const msg = extractErrorMessage(e);
      console.error('Error saving price basis:', e);
      alert(`Failed to save price basis: ${msg}`);
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

      // The study population is the normalized sales set on either basis. The Sale
      // Price toggle swaps the numerator in the CCF math; it does not admit sales the
      // normalization pass rejected. Those are $1 deeds and non-usable NU codes, and
      // they drive improv (and so CCF) negative.
      if (!(p.values_norm_time && p.values_norm_time > 0)) return false;

      // asset_type_use exists on property_records
      const typeVal = p.asset_type_use ? p.asset_type_use.toString().trim() : '';

      // Apply typeGroup filter using code prefixes
      if (typeGroup && typeGroup !== 'all') {
        // Normalize typeVal to string
        const tv = (typeVal || '').toString();
        if (typeGroup === 'all_residential') {
          // Accept codes starting with 1-6
          if (!['1','2','3','4','5','6'].some(prefix => tv.startsWith(prefix))) return false;
        } else if (typeGroup === 'commercial') {
          // Coarse commercial: exclude residential prefixes 1-6
          if (['1','2','3','4','5','6'].some(prefix => tv.startsWith(prefix))) return false;
        } else {
          // Single prefix/group (e.g., '1','2','3','4','5','6')
          if (!tv.startsWith(typeGroup)) return false;
        }
      }

      // Require year built and be new or newer (<= 20 years)
      const yearBuilt = p.asset_year_built || null;
      if (!yearBuilt) return false;
      const age = currentYear - parseInt(yearBuilt, 10);
      if (age > 20) return false;

      return true;
    });
  }, [properties, fromYear, toYear, typeGroup, currentYear]);

  // Unique building class codes from all properties in this town
  const uniqueBuildingClasses = useMemo(() => {
    const classes = new Set();
    properties.forEach(p => {
      if (p.asset_building_class) classes.add(String(p.asset_building_class).trim());
    });
    return Array.from(classes).sort();
  }, [properties]);

  // Initialize include map and edited land map when filtered results change
  useEffect(() => {
    const map = {};
    const landMap = {};
    filtered.forEach(p => {
      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
      map[key] = !excludedKeys.has(key);
      landMap[key] = p.values_cama_land !== undefined && p.values_cama_land !== null ? p.values_cama_land : '';
    });
    setIncludedMap(map);
    setEditedLandMap(landMap);
  }, [filtered, excludedKeys]);

  // formatting helpers
  const getLivingAreaValue = (p) => {
    // Common field names that may contain living area
    const candidates = [
      'asset_living_area',
      'living_area',
      'asset_sfla',
      'asset_sfl_a',
      'asset_sf_la',
      'sf_la',
      'sf_living_area',
      'asset_liv_area',
      'asset_livingarea'
    ];
    for (const key of candidates) {
      if (p[key] !== undefined && p[key] !== null && p[key] !== '') return Number(p[key]);
    }
    // Check nested raw_data if present
    if (p.raw_data) {
      for (const key of candidates) {
        if (p.raw_data[key] !== undefined && p.raw_data[key] !== null && p.raw_data[key] !== '') return Number(p.raw_data[key]);
      }
    }
    return null;
  };

  const formatNumberNoDecimals = (v) => {
    if (v === '' || v === null || v === undefined || !isFinite(Number(v))) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

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

  const rowKey = (p) => p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;

  // Derived columns recompute the CCF math here rather than reading it off the
  // rendered row, the same way recommendedFactors and summaryTotals do.
  const sortValue = (p, field) => {
    const key = rowKey(p);
    const depr = p.asset_year_built ? (1 - ((currentYear - parseInt(p.asset_year_built, 10)) / 100)) : null;
    const detItems = getEffectiveDetItems(p);
    const baseCost = getEffectiveBaseCost(p);
    const cama = (editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land ?? 0);
    const basisPrice = (priceBasis === 'price_time' && p.values_norm_time > 0) ? Number(p.values_norm_time) : Number(p.sales_price || 0);
    const replWithDepr = depr ? (detItems + baseCost) * depr : null;
    const improv = basisPrice - cama - detItems;
    const ccf = (replWithDepr && replWithDepr !== 0) ? improv / replWithDepr : null;
    const factor = (costConvFactor !== null && costConvFactor !== '') ? Number(costConvFactor) : (ccf ?? 0);
    const adjusted = depr ? (cama + ((baseCost * depr) * factor) + detItems) : null;

    switch (field) {
      case 'incl': return includedMap[key] !== false ? 1 : 0;
      case 'block': return p.property_block;
      case 'lot': return p.property_lot;
      case 'qualifier': return p.asset_qualifier || p.qualifier || '';
      case 'card': return p.property_card;
      case 'location': return p.property_location || '';
      case 'vcs': return p.new_vcs || p.property_vcs || '';
      case 'salesDate': return p.sales_date || '';
      case 'salePrice': return Number(p.sales_price || 0);
      case 'saleNu': return p.sales_nu || '';
      case 'priceTime': return Number(p.values_norm_time || 0);
      case 'yearBuilt': return Number(p.asset_year_built || 0);
      case 'depr': return depr;
      case 'buildingClass': return editedBuildingClassMap[key] ?? p.asset_building_class ?? '';
      case 'livingArea': return getLivingAreaValue(p);
      case 'currentLand': return cama;
      case 'detItem': return detItems;
      case 'baseCost': return baseCost;
      case 'replDepr': return replWithDepr;
      case 'improv': return improv;
      case 'ccf': return ccf;
      case 'adjustedValue': return adjusted;
      case 'adjustedRatio': return (adjusted && basisPrice) ? adjusted / basisPrice : null;
      default: return null;
    }
  };

  const sortedFiltered = useMemo(() => {
    if (!sortConfig.field) return filtered;
    const dir = sortConfig.direction === 'desc' ? -1 : 1;
    const isBlank = (v) => v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v));

    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortConfig.field);
      const bv = sortValue(b, sortConfig.field);
      // Blanks always sink, so flipping direction doesn't fill the top with empties.
      if (isBlank(av) && isBlank(bv)) return 0;
      if (isBlank(av)) return 1;
      if (isBlank(bv)) return -1;

      const an = typeof av === 'number' ? av : parseFloat(av);
      const bn = typeof bv === 'number' ? bv : parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortConfig, includedMap, editedLandMap, editedDetItemMap, editedBaseCostMap, editedBuildingClassMap, priceBasis, costConvFactor, currentYear]);

  const toggleSort = (field) => {
    setSortConfig(prev => prev.field === field
      ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: 'asc' });
  };

  const sortableTh = (label, field, lastCol) => {
    const active = sortConfig.field === field;
    const arrow = !active ? '\u21C5' : (sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC');
    return (
      <th
        onClick={() => toggleSort(field)}
        title={`Sort by ${label}`}
        className={`px-3 py-2 text-xs border-b ${lastCol ? '' : 'border-r'} border-gray-200 cursor-pointer select-none hover:bg-gray-100 ${active ? 'text-gray-900 font-semibold' : 'text-gray-600'}`}
      >
        {label}
        <span className="ml-1" style={{ fontSize: '10px', opacity: active ? 1 : 0.35 }}>{arrow}</span>
      </th>
    );
  };

  // Recommended mean (average) based on included comparables
  // Use CCF = Improv / ReplWithDepr so a single comparable with CCF 2.88 yields recommendedFactor 2.88
  // Both bases are computed so the banner can show them side by side. Same
  // population and same math either way, only the numerator differs.
  const recommendedFactors = useMemo(() => {
    const meanForBasis = (basis) => {
      const rows = filtered
        .map(p => {
          const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
          const included = includedMap[key] !== undefined ? includedMap[key] : true;
          if (!included) return null;
          const salePrice = (basis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
          const detItems = getEffectiveDetItems(p);
          const baseCost = getEffectiveBaseCost(p);
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
    };

    return { price_time: meanForBasis('price_time'), sale_price: meanForBasis('sale_price') };
  }, [filtered, includedMap, editedLandMap, editedDetItemMap, editedBaseCostMap, currentYear]);

  const recommendedFactor = recommendedFactors[priceBasis] ?? null;

  // Recommended median for robustness
  const recommendedMedian = useMemo(() => {
    const rows = filtered
      .map(p => {
        const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
        const included = includedMap[key] !== undefined ? includedMap[key] : true;
        if (!included) return null;
        const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
        const detItems = getEffectiveDetItems(p);
        const baseCost = getEffectiveBaseCost(p);
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
  }, [filtered, includedMap, editedLandMap, editedDetItemMap, editedBaseCostMap, priceBasis, currentYear]);

  // Export to Excel with formulas and formatting
  const exportToExcel = () => {
    if (!filtered || filtered.length === 0) return alert('No data to export');

    const headers = [
      'Incl','Block','Lot','Qualifier','Card','Location','VCS','Sales Date','Sale Price','Sale NU','Price Time','Year Built','Depr','Building Class','Living Area','Current Land','Det Item','Base Cost','Repl w/Depr','Improv','CCF','Adjusted Value','Adjusted Ratio'
    ];

    // Column indexes for reference (0-based)
    const COL = {
      INCL: 0, BLOCK: 1, LOT: 2, QUAL: 3, CARD: 4, LOCATION: 5, VCS: 6,
      SALE_DATE: 7, SALE_PRICE: 8, SALE_NU: 9, PRICE_TIME: 10, YEAR_BUILT: 11,
      DEPR: 12, BLDG_CLASS: 13, LIVING_AREA: 14, CURRENT_LAND: 15, DET_ITEM: 16,
      BASE_COST: 17, REPL_DEPR: 18, IMPROV: 19, CCF: 20, ADJ_VALUE: 21, ADJ_RATIO: 22
    };

    // Sale Price (I) always carries the raw sale, matching the on-screen grid.
    // The basis drives the math only, so the ratio and improv formulas point at
    // Price Time (K) when the user picked that basis.
    const basisCol = priceBasis === 'price_time' ? 'K' : 'I';

    // Base cell style - Leelawadee, size 10, centered
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Header style - bold, no borders
    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    // Number formats
    const currencyFormat = '$#,##0';
    const percentFormat = '0%';
    const decimalFormat = '0.00';

    // Create worksheet data
    const wsData = [];

    // Add headers
    wsData.push(headers);

    // Add data rows with formulas
    filtered.forEach((p, idx) => {
      const rowNum = idx + 2; // Excel row number (1-based, +1 for header)
      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
      const included = includedMap[key] !== false;

      const saleDate = p.sales_date ? new Date(p.sales_date).toISOString().slice(0,10) : '';
      const salePrice = (priceBasis === 'price_time' && p.values_norm_time && p.values_norm_time > 0) ? Number(p.values_norm_time) : (p.sales_price !== undefined && p.sales_price !== null ? Number(p.sales_price) : 0);
      const rawSalePrice = (p.sales_price !== undefined && p.sales_price !== null) ? Number(p.sales_price) : 0;
      const timeNorm = (p.values_norm_time !== undefined && p.values_norm_time !== null) ? Number(p.values_norm_time) : '';
      const detItems = getEffectiveDetItems(p);
      const baseCost = getEffectiveBaseCost(p);
      const cama = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
      const yearBuilt = p.asset_year_built || '';
      const vcs = p.new_vcs || p.property_vcs || '';
      const livingArea = getLivingAreaValue(p);

      const row = [];

      // Incl
      row[COL.INCL] = included ? '1' : '0';
      // Block, Lot, Qualifier, Card, Location, VCS
      row[COL.BLOCK] = p.property_block || '';
      row[COL.LOT] = p.property_lot || '';
      row[COL.QUAL] = p.asset_qualifier || p.qualifier || '';
      row[COL.CARD] = p.property_card || '';
      row[COL.LOCATION] = p.property_location || '';
      row[COL.VCS] = vcs;

      // Sales Date, Sale Price, Sale NU, Price Time
      row[COL.SALE_DATE] = saleDate;
      row[COL.SALE_PRICE] = rawSalePrice || '';
      row[COL.SALE_NU] = p.sales_nu || '';
      row[COL.PRICE_TIME] = timeNorm || '';

      // Year Built
      row[COL.YEAR_BUILT] = yearBuilt;

      // Depr - FORMULA: =1-((CURRENT_YEAR - L{rowNum})/100)
      if (yearBuilt) {
        row[COL.DEPR] = { f: `1-((${currentYear}-L${rowNum})/100)`, t: 'n' };
      } else {
        row[COL.DEPR] = '';
      }

      // Building Class, Living Area
      row[COL.BLDG_CLASS] = getEffectiveBuildingClass(p);
      row[COL.LIVING_AREA] = livingArea !== null ? livingArea : '';

      // Current Land, Det Item, Base Cost
      row[COL.CURRENT_LAND] = cama || 0;
      row[COL.DET_ITEM] = detItems || 0;  // Always 0 instead of empty to prevent #VALUE errors
      row[COL.BASE_COST] = baseCost || 0;

      // Repl w/Depr - FORMULA: =(Q{rowNum} + R{rowNum}) * M{rowNum}
      if (yearBuilt) {
        row[COL.REPL_DEPR] = { f: `(Q${rowNum}+R${rowNum})*M${rowNum}`, t: 'n' };
      } else {
        row[COL.REPL_DEPR] = '';
      }

      // Improv - FORMULA: =I{rowNum} - P{rowNum} - Q{rowNum}
      if (salePrice) {
        row[COL.IMPROV] = { f: `${basisCol}${rowNum}-P${rowNum}-Q${rowNum}`, t: 'n' };
      } else {
        row[COL.IMPROV] = '';
      }

      // CCF - FORMULA: =T{rowNum} / S{rowNum}
      if (yearBuilt && salePrice) {
        row[COL.CCF] = { f: `IF(S${rowNum}=0,"",T${rowNum}/S${rowNum})`, t: 'n' };
      } else {
        row[COL.CCF] = '';
      }

      // Adjusted Value - FORMULA: =P{rowNum} + ((R{rowNum} * M{rowNum}) * U{rowNum}) + Q{rowNum}
      if (yearBuilt && salePrice) {
        row[COL.ADJ_VALUE] = { f: `P${rowNum}+((R${rowNum}*M${rowNum})*U${rowNum})+Q${rowNum}`, t: 'n' };
      } else {
        row[COL.ADJ_VALUE] = '';
      }

      // Adjusted Ratio - FORMULA: =V{rowNum} / I{rowNum}
      if (yearBuilt && salePrice) {
        row[COL.ADJ_RATIO] = { f: `IF(${basisCol}${rowNum}=0,"",V${rowNum}/${basisCol}${rowNum})`, t: 'n' };
      } else {
        row[COL.ADJ_RATIO] = '';
      }

      wsData.push(row);
    });

    // Add summary row
    const summaryRowNum = filtered.length + 2; // +1 for header, +1 for next row
    const lastDataRow = filtered.length + 1; // Last row with data
    const summaryRow = [];

    // Add TOTALS label in VCS column
    summaryRow[COL.INCL] = '';
    summaryRow[COL.BLOCK] = '';
    summaryRow[COL.LOT] = '';
    summaryRow[COL.QUAL] = '';
    summaryRow[COL.CARD] = '';
    summaryRow[COL.LOCATION] = '';
    summaryRow[COL.VCS] = 'TOTALS';
    summaryRow[COL.SALE_DATE] = '';

    // Summary formulas
    summaryRow[COL.SALE_PRICE] = { f: `SUM(I2:I${lastDataRow})`, t: 'n' };
    summaryRow[COL.SALE_NU] = '';
    summaryRow[COL.PRICE_TIME] = { f: `SUM(K2:K${lastDataRow})`, t: 'n' };
    summaryRow[COL.YEAR_BUILT] = '';
    summaryRow[COL.DEPR] = '';
    summaryRow[COL.BLDG_CLASS] = '';
    summaryRow[COL.LIVING_AREA] = '';
    summaryRow[COL.CURRENT_LAND] = '';
    summaryRow[COL.DET_ITEM] = '';
    summaryRow[COL.BASE_COST] = '';
    summaryRow[COL.REPL_DEPR] = { f: `SUM(S2:S${lastDataRow})`, t: 'n' };
    summaryRow[COL.IMPROV] = { f: `SUM(T2:T${lastDataRow})`, t: 'n' };
    summaryRow[COL.CCF] = { f: `IF(S${summaryRowNum}=0,"",T${summaryRowNum}/S${summaryRowNum})`, t: 'n' }; // Overall CCF
    summaryRow[COL.ADJ_VALUE] = { f: `SUM(V2:V${lastDataRow})`, t: 'n' };
    summaryRow[COL.ADJ_RATIO] = { f: `IF(${basisCol}${summaryRowNum}=0,"",V${summaryRowNum}/${basisCol}${summaryRowNum})`, t: 'n' }; // Overall Adjusted Ratio

    wsData.push(summaryRow);

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const colWidths = [
      { wch: 5 },  // Incl
      { wch: 8 },  // Block
      { wch: 8 },  // Lot
      { wch: 10 }, // Qualifier
      { wch: 6 },  // Card
      { wch: 25 }, // Location
      { wch: 15 }, // VCS
      { wch: 12 }, // Sales Date
      { wch: 12 }, // Sale Price
      { wch: 8 },  // Sale NU
      { wch: 12 }, // Price Time
      { wch: 10 }, // Year Built
      { wch: 8 },  // Depr
      { wch: 12 }, // Building Class
      { wch: 12 }, // Living Area
      { wch: 12 }, // Current Land
      { wch: 12 }, // Det Item
      { wch: 12 }, // Base Cost
      { wch: 12 }, // Repl w/Depr
      { wch: 12 }, // Improv
      { wch: 8 },  // CCF
      { wch: 14 }, // Adjusted Value
      { wch: 12 }  // Adjusted Ratio
    ];
    ws['!cols'] = colWidths;

    // Apply styles to all cells
    const range = XLSX.utils.decode_range(ws['!ref']);
    const summaryRowIndex = filtered.length + 1; // 0-based index of summary row

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // Apply base style
        if (R === 0) {
          // Header row
          ws[cellAddress].s = headerStyle;
        } else if (R === summaryRowIndex) {
          // Summary row - bold
          const style = {
            font: { name: 'Leelawadee', sz: 10, bold: true },
            alignment: { horizontal: 'center', vertical: 'center' }
          };

          // Apply number formats based on column
          if (C === COL.SALE_PRICE || C === COL.PRICE_TIME || C === COL.CURRENT_LAND ||
              C === COL.DET_ITEM || C === COL.BASE_COST || C === COL.REPL_DEPR ||
              C === COL.IMPROV || C === COL.ADJ_VALUE) {
            style.numFmt = currencyFormat;
          } else if (C === COL.DEPR) {
            style.numFmt = decimalFormat;
          } else if (C === COL.CCF) {
            style.numFmt = decimalFormat;
          } else if (C === COL.ADJ_RATIO) {
            style.numFmt = percentFormat;
          }

          ws[cellAddress].s = style;
        } else {
          // Data rows
          const style = { ...baseStyle };

          // Apply number formats based on column
          if (C === COL.SALE_PRICE || C === COL.PRICE_TIME || C === COL.CURRENT_LAND ||
              C === COL.DET_ITEM || C === COL.BASE_COST || C === COL.REPL_DEPR ||
              C === COL.IMPROV || C === COL.ADJ_VALUE) {
            style.numFmt = currencyFormat;
          } else if (C === COL.DEPR) {
            style.numFmt = decimalFormat;
          } else if (C === COL.CCF) {
            style.numFmt = decimalFormat;
          } else if (C === COL.ADJ_RATIO) {
            style.numFmt = percentFormat;
          }

          ws[cellAddress].s = style;
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Cost Valuation Analysis');

    // Generate Excel file
    const fileName = `cost_valuation_analysis_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
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
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 CostValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }
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
      // After saving factors
      if (onUpdateJobCache) {
        setTimeout(() => {
          console.log('🔄 CostValuationTab requesting parent refresh...');
          onUpdateJobCache();
        }, 500);
      }
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
        const detItems = getEffectiveDetItems(p);
        const baseVal = getEffectiveBaseCost(p);
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
  }, [filtered, includedMap, costConvFactor, editedLandMap, editedDetItemMap, editedBaseCostMap, currentYear, priceBasis]);

  return (
    <div className="bg-white rounded-lg p-6">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h2 className="text-xl font-semibold">Cost Valuation</h2>
          <p className="text-gray-600">Global Cost Conversion Factor and New Construction analysis (job-level)</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-sm text-gray-600">Custom CCF</div>
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
            <div className="text-sm text-gray-600">State County CCF</div>
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
                {isSaving ? 'Saving...' : (savedRecommendation ? 'Saved' : 'Save State Factor')}
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
          <label className="text-sm text-gray-600 block">Type & Use</label>
          <select
            value={typeGroup}
            onChange={(e) => setTypeGroup(e.target.value)}
            className="px-3 py-2 border rounded w-48"
          >
            <option value="1">1 — Single Family</option>
            <option value="2">2 — Duplex / Semi-Detached</option>
            <option value="3">3* — Row / Townhouse (3E, 3I, 30, 31)</option>
            <option value="4">4* — MultiFamily (42,43,44)</option>
            <option value="5">5* — Conversions (51,52,53)</option>
            <option value="6">6 — Condominium</option>
            <option value="all_residential">All Residential</option>
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
            {isSavingRange ? 'Saving...' : (savedYears ? 'Saved' : (excludedList.length > 0 ? `Save Years + ${excludedList.length} Excluded` : 'Save Years'))}
          </button>
          <button
            className="px-3 py-2 bg-indigo-600 text-white rounded text-sm"
            onClick={() => exportToExcel()}
          >
            Export Excel
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
            <div className="flex items-end gap-6 mt-1">
              <div>
                <div className={`text-xs ${priceBasis === 'price_time' ? 'text-indigo-700 font-medium' : 'text-gray-500'}`}>Price Time</div>
                <div className={`text-lg ${priceBasis === 'price_time' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                  {recommendedFactors.price_time !== null ? Number(recommendedFactors.price_time).toFixed(2) : '—'}
                </div>
              </div>
              <div>
                <div className={`text-xs ${priceBasis === 'sale_price' ? 'text-indigo-700 font-medium' : 'text-gray-500'}`}>Sale Price</div>
                <div className={`text-lg ${priceBasis === 'sale_price' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                  {recommendedFactors.sale_price !== null ? Number(recommendedFactors.sale_price).toFixed(2) : '—'}
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">Based on {filtered.filter(p => {
              const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
              const included = includedMap[key] !== undefined ? includedMap[key] : true;
              return (p.values_repl_cost || p.values_base_cost) && included;
            }).length} comparable properties &middot; bold is the active basis</div>
          </div>
                {/* Recommendation actions removed - keep Save Recommendation manual via Save Factor */}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border rounded border-gray-200">
        <table className="min-w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              {sortableTh('Incl', 'incl')}
              {sortableTh('Block', 'block')}
              {sortableTh('Lot', 'lot')}
              {sortableTh('Qualifier', 'qualifier')}
              {sortableTh('Card', 'card')}
              {sortableTh('Location', 'location')}
              {sortableTh('VCS', 'vcs')}

              {sortableTh('Sales Date', 'salesDate')}
              {sortableTh('Sale Price', 'salePrice')}
              {sortableTh('Sale NU', 'saleNu')}
              {sortableTh('Price Time', 'priceTime')}
              {sortableTh('Year Built', 'yearBuilt')}
              {sortableTh('Depr', 'depr')}
              {sortableTh('Building Class', 'buildingClass')}
              {sortableTh('Living Area', 'livingArea')}
              {sortableTh('Current Land', 'currentLand')}
              {sortableTh('Det Item', 'detItem')}
              {sortableTh('Base Cost', 'baseCost')}

              {sortableTh('Repl w/Depr', 'replDepr')}
              {sortableTh('Improv', 'improv')}
              {sortableTh('CCF', 'ccf')}
              {sortableTh('Adjusted Value', 'adjustedValue', true)}
              {sortableTh('Adjusted Ratio', 'adjustedRatio', true)}
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.slice(0, 500).map((p, i) => {
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
                      const checked = e.target.checked;
                      setIncludedMap(prev => ({ ...prev, [key]: checked }));
                      setExcludedKeys(prev => {
                        const next = new Set(prev);
                        if (checked) next.delete(key); else next.add(key);
                        return next;
                      });
                    }} />
                  </td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_block || ''}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_lot || ''}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_qualifier || p.qualifier || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_card || ''}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.property_location || ''}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.new_vcs || p.property_vcs || '—'}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.sales_date ? new Date(p.sales_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{formatCurrencyNoCents(salePriceDisplay)}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.sales_nu || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{priceTimeDisplay ? formatCurrencyNoCents(priceTimeDisplay) : '—'}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{p.asset_year_built || '—'}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(p.asset_year_built ? (1 - ((currentYear - parseInt(p.asset_year_built, 10)) / 100)).toFixed(2) : '—')}</td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">
                    {(() => {
                      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                      const val = editedBuildingClassMap[key] !== undefined ? editedBuildingClassMap[key] : (p.asset_building_class || '');
                      return (
                        <select
                          value={val}
                          onChange={(e) => setEditedBuildingClassMap(prev => ({ ...prev, [key]: e.target.value }))}
                          className="px-1 py-1 border rounded text-sm w-20"
                        >
                          <option value="">—</option>
                          {uniqueBuildingClasses.map(cls => (
                            <option key={cls} value={cls}>{cls}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">{(() => {
                    const la = getLivingAreaValue(p);
                    return la !== null ? formatNumberNoDecimals(la) : '—';
                  })()}</td>
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
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">
                    {(() => {
                      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                      const val = editedDetItemMap[key] !== undefined ? editedDetItemMap[key] : (p.values_det_items !== undefined && p.values_det_items !== null ? p.values_det_items : '');
                      return (
                        <input
                          type="number"
                          step="1"
                          value={val}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEditedDetItemMap(prev => ({ ...prev, [key]: raw === '' ? '' : parseFloat(raw) }));
                          }}
                          className="px-2 py-1 border rounded w-28"
                        />
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100">
                    {(() => {
                      const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                      const val = editedBaseCostMap[key] !== undefined ? editedBaseCostMap[key] : (p.values_base_cost !== undefined && p.values_base_cost !== null ? p.values_base_cost : '');
                      return (
                        <input
                          type="number"
                          step="1"
                          value={val}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setEditedBaseCostMap(prev => ({ ...prev, [key]: raw === '' ? '' : parseFloat(raw) }));
                          }}
                          className="px-2 py-1 border rounded w-28"
                        />
                      );
                    })()}
                  </td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const detItems = getEffectiveDetItems(p);
                    const baseVal = getEffectiveBaseCost(p);
                    const depr = p.asset_year_built ? (1 - ((currentYear - parseInt(p.asset_year_built, 10)) / 100)) : '';
                    const val = depr !== '' ? Math.round((detItems + baseVal) * depr) : '';
                    return (val !== '' && isFinite(val)) ? formatCurrencyNoCents(val) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const salePriceRow = basisPrice;
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const detItemsRow = getEffectiveDetItems(p);
                    const val = Math.round(salePriceRow - camaRow - detItemsRow);
                    return isFinite(val) ? formatCurrencyNoCents(val) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = getEffectiveDetItems(p);
                    const baseVal = getEffectiveBaseCost(p);
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = basisPrice;
                    const camaRow = (editedLandMap && editedLandMap[key] !== undefined && editedLandMap[key] !== '') ? Number(editedLandMap[key]) : (p.values_cama_land !== undefined && p.values_cama_land !== null ? Number(p.values_cama_land) : 0);
                    const improvRow = Math.round(salePriceRow - camaRow - detItemsRow);
                    if (!replWithDeprRow) return <span className="text-xs text-yellow-800">Missing repl</span>;
                    const val = (improvRow && replWithDeprRow) ? (improvRow / replWithDeprRow) : null;
                    return val ? Number(val).toFixed(2) : '-';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = getEffectiveDetItems(p);
                    const baseVal = getEffectiveBaseCost(p);
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = basisPrice;
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
                    return isFinite(adjustedValueRow) ? formatCurrencyNoCents(Math.round(adjustedValueRow)) : '—';
                  })()}</td>

                  <td className="px-3 py-2 text-sm border-b border-r border-gray-100 bg-yellow-50">{(() => {
                    const key = p.property_composite_key || `${p.property_block}-${p.property_lot}-${p.property_card}`;
                    const detItemsRow = getEffectiveDetItems(p);
                    const baseVal = getEffectiveBaseCost(p);
                    const yearBuiltRow = p.asset_year_built || '';
                    const deprRow = yearBuiltRow ? (1 - ((currentYear - parseInt(yearBuiltRow, 10)) / 100)) : '';
                    const replWithDeprRow = (deprRow !== '' ? Math.round((detItemsRow + baseVal) * deprRow) : null);
                    const salePriceRow = basisPrice;
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
