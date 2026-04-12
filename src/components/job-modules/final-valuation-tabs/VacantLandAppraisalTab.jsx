import { Download, X, Save, Filter, FileDown, Printer, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { interpretCodes, supabase } from '../../../lib/supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Canonical category values matching Method 1 dropdown
const CATEGORY_OPTIONS = [
  { value: 'uncategorized', label: 'Uncategorized' },
  { value: 'raw_land', label: 'Raw Land' },
  { value: 'building_lot', label: 'Building Lot' },
  { value: 'commercial_land', label: 'Commercial Land' },
  { value: 'wetlands', label: 'Wetlands' },
  { value: 'landlocked', label: 'Landlocked' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'teardown', label: 'Teardown' },
  { value: 'pre-construction', label: 'Pre-Construction' },
];

// Normalize category values (Method 1 auto-categorize uses hyphens sometimes)
const normalizeCategory = (cat) => {
  if (!cat) return 'uncategorized';
  const c = cat.toLowerCase().replace(/-/g, '_');
  if (c === 'building_lot' || c === 'building lot') return 'building_lot';
  if (c === 'pre_construction' || c === 'pre construction') return 'pre-construction';
  return cat;
};

const getCategoryLabel = (cat) => {
  const normalized = normalizeCategory(cat);
  const found = CATEGORY_OPTIONS.find(o => o.value === normalized);
  return found ? found.label : cat || 'Uncategorized';
};

const getCategoryColor = (cat) => {
  const normalized = normalizeCategory(cat);
  switch (normalized) {
    case 'teardown': return 'bg-orange-100 text-orange-700';
    case 'pre-construction': return 'bg-purple-100 text-purple-700';
    case 'building_lot': return 'bg-blue-100 text-blue-700';
    case 'raw_land': return 'bg-green-100 text-green-700';
    case 'wetlands': return 'bg-teal-100 text-teal-700';
    case 'landlocked': return 'bg-red-100 text-red-700';
    case 'conservation': return 'bg-emerald-100 text-emerald-700';
    case 'commercial_land': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

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
  const [showExportModal, setShowExportModal] = useState(false);
  const [editableProperties, setEditableProperties] = useState({});
  const [appealNumber, setAppealNumber] = useState('');
  const [appealAutoDetected, setAppealAutoDetected] = useState(false);

  // Refs for tab order
  const inputRefs = useRef({});

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
    category: 'all',
    sizeMin: '',
    sizeMax: '',
  });

  // Calculate acreage using the same helper as Method 1
  const calculateAcreage = useCallback((property) => {
    if (!property) return 0;
    return parseFloat(interpretCodes.getCalculatedAcreage(property, vendorType)) || 0;
  }, [vendorType]);

  // Build the vacant land sales array from Method 1 saved data
  const method1Sales = useMemo(() => {
    const savedSales = marketLandData?.vacant_sales_analysis?.sales || [];
    if (savedSales.length === 0) return [];

    const propMap = {};
    properties.forEach(p => { if (p.id) propMap[p.id] = p; });

    return savedSales
      .filter(s => s.included !== false)
      .map(s => {
        const prop = propMap[s.id];
        if (!prop) return null;
        const acres = calculateAcreage(prop);
        return {
          ...prop,
          _calculatedAcres: acres,
          _category: normalizeCategory(s.category),
          _specialRegion: s.special_region || 'Normal',
          _notes: s.notes || null,
          _manuallyAdded: s.manually_added || false,
        };
      })
      .filter(Boolean);
  }, [marketLandData, properties, calculateAcreage]);

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

  // Lot size helpers using calculateAcreage
  const getLotSizeForMethod = useCallback((prop) => {
    if (!prop) return 0;
    if (valuationMethod === 'ff') return parseFloat(prop.asset_lot_frontage) || 0;
    const acres = prop._calculatedAcres !== undefined ? prop._calculatedAcres : calculateAcreage(prop);
    if (valuationMethod === 'sf') return acres * 43560;
    return acres;
  }, [valuationMethod, calculateAcreage]);

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

  // Filtered sales
  const filteredSales = useMemo(() => {
    return method1Sales.filter(prop => {
      if (filters.vcs.length > 0 && !filters.vcs.includes(prop.property_vcs)) return false;
      if (filters.zoning.length > 0 && !filters.zoning.includes(prop.property_zoning)) return false;
      if (filters.category !== 'all' && prop._category !== filters.category) return false;

      // Size range filter
      const size = getLotSizeForMethod(prop);
      if (filters.sizeMin !== '' && size < parseFloat(filters.sizeMin)) return false;
      if (filters.sizeMax !== '' && size > parseFloat(filters.sizeMax)) return false;

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
  }, [method1Sales, filters, getLotSizeForMethod]);

  // Load saved appraisals on mount
  useEffect(() => {
    if (jobData?.id) loadSavedAppraisals();
  }, [jobData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Auto-detect appeal number for subject
    if (subjectData && jobData?.id) {
      lookupAppealNumber(subjectData);
    }
  };

  // Look up active appeal for subject property
  const lookupAppealNumber = async (subjectProp) => {
    try {
      const { data } = await supabase
        .from('appeal_log')
        .select('appeal_number, status')
        .eq('job_id', jobData.id)
        .eq('property_block', subjectProp.property_block)
        .eq('property_lot', subjectProp.property_lot);

      if (data && data.length > 0) {
        // Find active appeal (not Closed)
        const active = data.find(a => a.status !== 'C');
        if (active && active.appeal_number) {
          setAppealNumber(active.appeal_number);
          setAppealAutoDetected(true);
          return;
        }
      }
      // No active appeal found - keep manual entry
      if (!appealNumber) {
        setAppealAutoDetected(false);
      }
    } catch (err) {
      console.warn('Could not look up appeal:', err.message);
    }
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
      appeal_number: appealNumber || null,
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
    if (appraisal.appeal_number) {
      setAppealNumber(appraisal.appeal_number);
      setAppealAutoDetected(true);
    }
    
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

  // ==================== EXPORT MODAL LOGIC ====================
  
  const updateEditedValue = useCallback((propKey, field, value) => {
    setEditableProperties(prev => ({
      ...prev,
      [propKey]: {
        ...(prev[propKey] || {}),
        [field]: value
      }
    }));
  }, []);

  const getEditedValue = useCallback((propKey, field) => {
    return editableProperties[propKey]?.[field];
  }, [editableProperties]);

  // Get display value for export modal (edited or original)
  const getExportValue = useCallback((propKey, field, prop) => {
    const edited = getEditedValue(propKey, field);
    if (edited !== undefined) return edited;
    if (!prop) return '';
    
    switch (field) {
      case 'location': return prop.property_location || '';
      case 'lot_ff': return prop.asset_lot_frontage ? parseFloat(prop.asset_lot_frontage).toFixed(0) : '';
      case 'lot_sf': {
        const acres = calculateAcreage(prop);
        return acres > 0 ? Math.round(acres * 43560).toLocaleString() : '';
      }
      case 'lot_acre': return calculateAcreage(prop) > 0 ? calculateAcreage(prop).toFixed(3) : '';
      case 'vcs': return prop.property_vcs || '';
      case 'zoning': return prop.property_zoning || '';
      case 'topography': return prop.topography || '';
      case 'clearing': return prop.clearing || '';
      case 'utility_heat': return prop.utility_heat || '';
      case 'utility_water': return prop.utility_water || '';
      case 'utility_sewer': return prop.utility_sewer || '';
      case 'current_assess': {
        const total = prop.values_mod_total || prop.values_cama_total || 0;
        return total > 0 ? '$' + Math.round(total).toLocaleString() : '';
      }
      case 'sales_price': return prop.sales_price ? '$' + Math.round(parseFloat(prop.sales_price)).toLocaleString() : '';
      case 'sales_date': return prop.sales_date ? new Date(prop.sales_date).toLocaleDateString() : '';
      case 'price_per_unit': {
        if (!prop.sales_price) return '';
        const size = getLotSizeForMethod(prop);
        if (size <= 0) return '';
        return '$' + Math.round(parseFloat(prop.sales_price) / size).toLocaleString();
      }
      default: return '';
    }
  }, [getEditedValue, calculateAcreage, getLotSizeForMethod]);

  // Calculate recalculated value from export modal edits
  const recalculatedValue = useMemo(() => {
    const subjectProp = loadedProperties.subject;
    if (!subjectProp) return null;

    // Get subject lot size (edited or original)
    let subjectSize;
    if (valuationMethod === 'ff') {
      const editedFF = getEditedValue('subject', 'lot_ff');
      subjectSize = editedFF !== undefined ? parseFloat(editedFF) || 0 : (parseFloat(subjectProp.asset_lot_frontage) || 0);
    } else if (valuationMethod === 'sf') {
      const editedSF = getEditedValue('subject', 'lot_sf');
      if (editedSF !== undefined) {
        subjectSize = parseFloat(String(editedSF).replace(/,/g, '')) || 0;
      } else {
        subjectSize = calculateAcreage(subjectProp) * 43560;
      }
    } else {
      const editedAcre = getEditedValue('subject', 'lot_acre');
      subjectSize = editedAcre !== undefined ? parseFloat(editedAcre) || 0 : calculateAcreage(subjectProp);
    }

    if (!subjectSize || subjectSize === 0) return null;

    const compRates = [];
    for (let i = 0; i < 5; i++) {
      const compProp = loadedProperties[`comp_${i}`];
      if (!compProp || !compProp.sales_price) continue;

      // Get edited sales price
      const editedPrice = getEditedValue(`comp_${i}`, 'sales_price');
      const price = editedPrice !== undefined
        ? parseFloat(String(editedPrice).replace(/[$,]/g, '')) || 0
        : parseFloat(compProp.sales_price) || 0;
      if (price <= 0) continue;

      // Get comp lot size
      let compSize;
      if (valuationMethod === 'ff') {
        const editedFF = getEditedValue(`comp_${i}`, 'lot_ff');
        compSize = editedFF !== undefined ? parseFloat(editedFF) || 0 : (parseFloat(compProp.asset_lot_frontage) || 0);
      } else if (valuationMethod === 'sf') {
        const editedSF = getEditedValue(`comp_${i}`, 'lot_sf');
        if (editedSF !== undefined) {
          compSize = parseFloat(String(editedSF).replace(/,/g, '')) || 0;
        } else {
          compSize = calculateAcreage(compProp) * 43560;
        }
      } else {
        const editedAcre = getEditedValue(`comp_${i}`, 'lot_acre');
        compSize = editedAcre !== undefined ? parseFloat(editedAcre) || 0 : calculateAcreage(compProp);
      }

      if (compSize > 0) {
        compRates.push(price / compSize);
      }
    }

    if (compRates.length === 0) return null;
    const avgRate = compRates.reduce((s, r) => s + r, 0) / compRates.length;
    return Math.round(subjectSize * avgRate);
  }, [loadedProperties, editableProperties, valuationMethod, calculateAcreage, getEditedValue]);

  // Open export modal
  const openExportModal = useCallback(() => {
    setEditableProperties({});
    setShowExportModal(true);
  }, []);

  // Send evaluation result to appeal log
  const handleSendToAppealLog = async () => {
    const subjectProp = loadedProperties.subject;
    if (!subjectProp || !estimatedLandValue) return;

    try {
      // Find existing appeal for this property
      const { data: appeals } = await supabase
        .from('appeal_log')
        .select('id, appeal_number, status')
        .eq('job_id', jobData.id)
        .eq('property_block', subjectProp.property_block)
        .eq('property_lot', subjectProp.property_lot);

      if (!appeals || appeals.length === 0) {
        alert('No appeal log entry found for this property. Create one in the Appeal Log tab first.');
        return;
      }

      // Prefer active appeal, fall back to most recent
      const active = appeals.find(a => a.status !== 'C') || appeals[0];

      const { error } = await supabase
        .from('appeal_log')
        .update({
          vla_projected_value: estimatedLandValue,
          updated_at: new Date().toISOString()
        })
        .eq('id', active.id);

      if (error) throw error;

      alert(`Sent land evaluation value ($${estimatedLandValue.toLocaleString()}) to Appeal Log${active.appeal_number ? ` — Appeal #${active.appeal_number}` : ''}`);
    } catch (err) {
      console.error('Error sending to appeal log:', err);
      alert('Failed to send to Appeal Log: ' + err.message);
    }
  };

  // Generate PDF
  const generatePDF = useCallback(async () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 30;
    const lojikBlue = [0, 102, 204];

    // Load logo
    let logoDataUrl = null;
    try {
      const response = await fetch('/lojik-logo.PNG');
      const blob = await response.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('Could not load logo:', err);
    }

    const subjectProp = loadedProperties.subject;
    const subjectBLQ = `${vacantLandSubject.block}/${vacantLandSubject.lot}${vacantLandSubject.qualifier ? '/' + vacantLandSubject.qualifier : ''}`;

    // Header
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', margin, margin - 5, 80, 35); } catch (e) { /* fallback */ }
    }

    // Appeal number above BLQ
    let headerY = margin + 10;
    const currentAppealNumber = appealNumber || '';
    if (currentAppealNumber) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Appeal #: ${currentAppealNumber}`, pageWidth - margin, headerY, { align: 'right' });
      headerY += 14;
    }

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(subjectBLQ, pageWidth - margin, headerY + 10, { align: 'right' });

    // Title
    doc.setFontSize(14);
    doc.setTextColor(...lojikBlue);
    doc.text('Vacant Land Evaluation', margin, margin + 50);

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    const methodLabel = valuationMethod === 'ff' ? 'Front Foot' : valuationMethod === 'sf' ? 'Square Foot' : 'Acre';
    doc.text(`Valuation Method: ${methodLabel}  |  ${jobData?.ccdd || ''}  |  ${new Date().toLocaleDateString()}`, margin, margin + 62);

    // Build table data
    const compSlots = [0, 1, 2, 3, 4];
    const activeComps = compSlots.filter(i => loadedProperties[`comp_${i}`]);
    
    const headers = [['Attribute', 'Subject', ...activeComps.map(i => `Comp ${i + 1}`)]];

    const rows = [
      { label: 'Location', field: 'location' },
      { label: 'Lot Size FF', field: 'lot_ff' },
      { label: 'Lot Size SF', field: 'lot_sf' },
      { label: 'Lot Size Acre', field: 'lot_acre' },
      { label: 'VCS', field: 'vcs' },
      { label: 'Zoning', field: 'zoning' },
      { label: 'Topography', field: 'topography' },
      { label: 'Clearing', field: 'clearing' },
      { label: 'Utility — Heat', field: 'utility_heat' },
      { label: 'Utility — Water', field: 'utility_water' },
      { label: 'Utility — Sewer', field: 'utility_sewer' },
      { label: 'Current Assess', field: 'current_assess' },
      { label: 'Sales Price', field: 'sales_price' },
      { label: 'Sales Date', field: 'sales_date' },
      { label: getUnitLabel(), field: 'price_per_unit' },
    ];

    const bodyRows = rows.map(row => {
      const subjectVal = getExportValue('subject', row.field, subjectProp);
      const compVals = activeComps.map(i => getExportValue(`comp_${i}`, row.field, loadedProperties[`comp_${i}`]));
      return [row.label, subjectVal || '-', ...compVals.map(v => v || '-')];
    });

    // Add estimated value row
    const finalValue = recalculatedValue || vacantLandResult || 0;
    bodyRows.push(['Est. Land Value', finalValue > 0 ? '$' + finalValue.toLocaleString() : '-', ...activeComps.map(() => '')]);

    autoTable(doc, {
      head: headers,
      body: bodyRows,
      startY: margin + 72,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.5, valign: 'middle' },
      headStyles: { fillColor: lojikBlue, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 80 },
        1: { fillColor: [255, 255, 230], halign: 'center' },
        ...Object.fromEntries(activeComps.map((_, i) => [i + 2, { fillColor: [230, 242, 255], halign: 'center' }]))
      },
      didParseCell: function(data) {
        if (data.row.raw && data.row.raw[0] === 'Est. Land Value') {
          data.cell.styles.fillColor = [200, 230, 255];
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.row.raw && data.row.raw[0] === getUnitLabel()) {
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    const ccdd = jobData?.ccdd || 'UNKNOWN';
    const fileName = `VLA_${ccdd}_${vacantLandSubject.block}_${vacantLandSubject.lot}${vacantLandSubject.qualifier ? '_' + vacantLandSubject.qualifier : ''}.pdf`;
    doc.save(fileName);
    setShowExportModal(false);
  }, [loadedProperties, vacantLandSubject, vacantLandResult, recalculatedValue, valuationMethod, jobData, appealNumber, getExportValue, getUnitLabel]);

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
    filters.sizeMin !== '',
    filters.sizeMax !== '',
  ].filter(Boolean).length;

  // Tab order: column-first (subject block → subject lot → subject qual → comp1 block → comp1 lot → comp1 qual → ...)
  const handleTabKeyDown = (e, colIndex, rowField) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const fieldOrder = ['block', 'lot', 'qualifier'];
    const currentFieldIdx = fieldOrder.indexOf(rowField);
    
    if (e.shiftKey) {
      // Reverse tab
      if (currentFieldIdx > 0) {
        // Go up in same column
        const prevField = fieldOrder[currentFieldIdx - 1];
        inputRefs.current[`${colIndex}_${prevField}`]?.focus();
      } else if (colIndex > 0) {
        // Go to bottom of previous column
        const prevCol = colIndex - 1;
        inputRefs.current[`${prevCol}_qualifier`]?.focus();
      }
    } else {
      // Forward tab
      if (currentFieldIdx < fieldOrder.length - 1) {
        // Go down in same column
        const nextField = fieldOrder[currentFieldIdx + 1];
        inputRefs.current[`${colIndex}_${nextField}`]?.focus();
      } else if (colIndex < 5) {
        // Go to top of next column
        const nextCol = colIndex + 1;
        inputRefs.current[`${nextCol}_block`]?.focus();
      }
    }
  };

  const setInputRef = (colIndex, field, el) => {
    inputRefs.current[`${colIndex}_${field}`] = el;
  };

  // Export modal rows definition
  const EXPORT_ROWS = [
    { label: 'Location', field: 'location', editable: false },
    { label: 'Lot Size FF', field: 'lot_ff', editable: true, type: 'number' },
    { label: 'Lot Size SF', field: 'lot_sf', editable: true, type: 'number' },
    { label: 'Lot Size Acre', field: 'lot_acre', editable: true, type: 'number', step: '0.001' },
    { label: 'VCS', field: 'vcs', editable: false },
    { label: 'Zoning', field: 'zoning', editable: false },
    { label: 'Topography', field: 'topography', editable: true, type: 'text' },
    { label: 'Clearing', field: 'clearing', editable: true, type: 'text' },
    { label: 'Utility — Heat', field: 'utility_heat', editable: true, type: 'text' },
    { label: 'Utility — Water', field: 'utility_water', editable: true, type: 'text' },
    { label: 'Utility — Sewer', field: 'utility_sewer', editable: true, type: 'text' },
    { label: 'Current Assess', field: 'current_assess', editable: false },
    { label: 'Sales Price', field: 'sales_price', editable: true, type: 'text' },
    { label: 'Sales Date', field: 'sales_date', editable: false },
    { label: getUnitLabel(), field: 'price_per_unit', editable: false },
  ];

  return (
    <div className="space-y-3">
      {/* Header with method toggle */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-blue-900 text-sm">Vacant Land Evaluation</h3>
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
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Category</label>
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

              {/* Size Range */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">{getSizeLabel()} Range</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={filters.sizeMin}
                    onChange={(e) => setFilters(prev => ({ ...prev, sizeMin: e.target.value }))}
                    placeholder="Min"
                    className="px-1.5 py-1 text-xs border border-gray-300 rounded w-16"
                    step={valuationMethod === 'acre' ? '0.01' : '1'}
                  />
                  <span className="text-xs text-gray-400">—</span>
                  <input
                    type="number"
                    value={filters.sizeMax}
                    onChange={(e) => setFilters(prev => ({ ...prev, sizeMax: e.target.value }))}
                    placeholder="Max"
                    className="px-1.5 py-1 text-xs border border-gray-300 rounded w-16"
                    step={valuationMethod === 'acre' ? '0.01' : '1'}
                  />
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
                  onClick={() => setFilters({ vcs: [], zoning: [], utilityGas: 'any', utilityWater: 'any', utilitySewer: 'any', category: 'all', sizeMin: '', sizeMax: '' })}
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
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-20">Category</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-16">{getSizeLabel()}</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-20">Sale Price</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-20">Sale Date</th>
                  <th className="px-2 py-1.5 text-right font-medium text-gray-600 w-16">{getUnitLabel()}</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-10">Heat</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-10">Water</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-10">Sewer</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 w-12">Region</th>
                  <th className="px-2 py-1.5 text-center font-medium text-gray-600 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-3 py-4 text-center text-gray-500 text-xs">
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
                        <td className="px-2 py-1 text-gray-500 truncate" title={prop.utility_heat || ''}>{prop.utility_heat || '-'}</td>
                        <td className="px-2 py-1 text-gray-500 truncate" title={prop.utility_water || ''}>{prop.utility_water || '-'}</td>
                        <td className="px-2 py-1 text-gray-500 truncate" title={prop.utility_sewer || ''}>{prop.utility_sewer || '-'}</td>
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
        <div className="bg-gray-100 px-3 py-2 border-b border-gray-300 flex items-center justify-between">
          <h4 className="font-semibold text-gray-900 text-sm">Property Entry</h4>
          {/* Appeal Number */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Appeal #:</label>
            <input
              type="text"
              value={appealNumber}
              onChange={(e) => { setAppealNumber(e.target.value); setAppealAutoDetected(false); }}
              placeholder="Enter or auto-detected"
              className={`px-2 py-1 text-xs border rounded w-36 ${
                appealAutoDetected ? 'border-green-400 bg-green-50' : 'border-gray-300'
              }`}
            />
            {appealAutoDetected && <span className="text-xs text-green-600">Auto</span>}
          </div>
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
                    ref={(el) => setInputRef(0, 'block', el)}
                    type="text"
                    value={vacantLandSubject.block}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, block: e.target.value }))}
                    onKeyDown={(e) => handleTabKeyDown(e, 0, 'block')}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Block"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      ref={(el) => setInputRef(idx + 1, 'block', el)}
                      type="text"
                      value={comp.block}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], block: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      onKeyDown={(e) => handleTabKeyDown(e, idx + 1, 'block')}
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
                    ref={(el) => setInputRef(0, 'lot', el)}
                    type="text"
                    value={vacantLandSubject.lot}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, lot: e.target.value }))}
                    onKeyDown={(e) => handleTabKeyDown(e, 0, 'lot')}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Lot"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      ref={(el) => setInputRef(idx + 1, 'lot', el)}
                      type="text"
                      value={comp.lot}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], lot: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      onKeyDown={(e) => handleTabKeyDown(e, idx + 1, 'lot')}
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
                    ref={(el) => setInputRef(0, 'qualifier', el)}
                    type="text"
                    value={vacantLandSubject.qualifier}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, qualifier: e.target.value }))}
                    onKeyDown={(e) => handleTabKeyDown(e, 0, 'qualifier')}
                    className="w-full px-1.5 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Qual"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      ref={(el) => setInputRef(idx + 1, 'qualifier', el)}
                      type="text"
                      value={comp.qualifier}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], qualifier: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      onKeyDown={(e) => handleTabKeyDown(e, idx + 1, 'qualifier')}
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
                    if (!prop) return '-';
                    const size = getLotSizeForMethod({ ...prop, _calculatedAcres: calculateAcreage(prop) });
                    if (size === 0) return '-';
                    if (valuationMethod === 'acre') return size.toFixed(3);
                    return Math.round(size).toLocaleString();
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => {
                  const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                  const enriched = prop ? { ...prop, _calculatedAcres: calculateAcreage(prop) } : null;
                  const size = enriched ? getLotSizeForMethod(enriched) : 0;
                  return (
                    <td key={idx} className="px-2 py-1.5 text-center bg-blue-50 border-l border-gray-300 text-xs font-medium">
                      {size === 0 ? '-' : (valuationMethod === 'acre' ? size.toFixed(3) : Math.round(size).toLocaleString())}
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
            onClick={openExportModal}
            disabled={!subjectProp}
            className="flex items-center gap-1 px-3 py-2 bg-purple-500 text-white rounded font-medium text-sm hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download size={14} /> Export
          </button>

          <button
            onClick={handleSendToAppealLog}
            disabled={!subjectProp || !estimatedLandValue}
            className="flex items-center gap-1 px-3 py-2 bg-amber-500 text-white rounded font-medium text-sm hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            title="Send evaluation result to Appeal Log"
          >
            <Send size={14} /> Send to Appeal Log
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
                {renderDataRow('Lot SF', p => {
                  if (!p) return '-';
                  const acres = calculateAcreage(p);
                  return acres > 0 ? Math.round(acres * 43560).toLocaleString() : '-';
                })}
                {renderDataRow('Lot Acre', p => {
                  if (!p) return '-';
                  const acres = calculateAcreage(p);
                  return acres > 0 ? acres.toFixed(3) : '-';
                })}
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
                  const enriched = { ...p, _calculatedAcres: calculateAcreage(p) };
                  const size = getLotSizeForMethod(enriched);
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
              const subjectSize = subjectProp ? getLotSizeForMethod({ ...subjectProp, _calculatedAcres: calculateAcreage(subjectProp) }) : 0;
              return `${validComps} comparable(s) — avg ${getUnitLabel().replace('$/', '')} rate × ${
                valuationMethod === 'acre' ? (subjectSize || 0).toFixed(3) + ' acres' :
                valuationMethod === 'sf' ? Math.round(subjectSize || 0).toLocaleString() + ' SF' :
                Math.round(subjectSize || 0).toLocaleString() + ' FF'
              }`;
            })()}
          </p>
        </div>
      )}

      {/* ==================== EXPORT MODAL ==================== */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-2">
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-7xl flex flex-col"
            style={{ maxHeight: 'calc(100vh - 40px)' }}
          >
            {/* Modal Header */}
            <div className="bg-blue-600 px-4 py-3 flex items-center justify-between rounded-t-lg flex-shrink-0">
              <div className="flex items-center gap-3">
                <Printer className="text-white" size={20} />
                <h3 className="text-base font-semibold text-white">Export PDF — Vacant Land Evaluation</h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-white hover:text-blue-200 transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>

            {/* Appeal Number Row */}
            <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-4 flex-shrink-0">
              <label className="text-sm font-medium text-gray-700">Appeal/Petition #:</label>
              <input
                type="text"
                value={appealNumber}
                onChange={(e) => { setAppealNumber(e.target.value); setAppealAutoDetected(false); }}
                placeholder="Enter appeal number (appears on PDF header)"
                className={`px-3 py-1.5 text-sm border rounded w-64 ${
                  appealAutoDetected ? 'border-green-400 bg-green-50' : 'border-gray-300'
                }`}
              />
              {appealAutoDetected && <span className="text-xs text-green-600 font-medium">Auto-detected from Appeal Log</span>}
              {!appealAutoDetected && !appealNumber && <span className="text-xs text-gray-400">Optional — will appear above Block/Lot on PDF</span>}
            </div>

            {/* Modal Content - Editable Grid */}
            <div className="flex-1 overflow-auto p-3">
              <table className="min-w-full text-xs border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-blue-600 text-white">
                    <th className="px-2 py-2 text-left font-semibold border border-blue-500 w-28">Attribute</th>
                    <th className="px-2 py-2 text-center font-semibold border border-blue-500 w-24 bg-yellow-600">Subject</th>
                    {[0, 1, 2, 3, 4].map(i => {
                      const prop = loadedProperties[`comp_${i}`];
                      if (!prop) return null;
                      return (
                        <th key={i} className="px-2 py-2 text-center font-semibold border border-blue-500 w-24">
                          Comp {i + 1}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {EXPORT_ROWS.map((row) => {
                    const activeCompIndices = [0, 1, 2, 3, 4].filter(i => loadedProperties[`comp_${i}`]);
                    return (
                      <tr key={row.field} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="px-2 py-1.5 font-medium text-gray-700 border border-gray-300">{row.label}</td>
                        {/* Subject cell */}
                        <td className="px-2 py-1.5 text-center border border-gray-300 bg-yellow-50">
                          {row.editable ? (
                            <input
                              type={row.type === 'number' ? 'text' : 'text'}
                              inputMode={row.type === 'number' ? 'decimal' : 'text'}
                              value={getEditedValue('subject', row.field) ?? getExportValue('subject', row.field, subjectProp)}
                              onChange={(e) => updateEditedValue('subject', row.field, e.target.value)}
                              className="w-full px-1 py-0.5 border border-gray-300 rounded text-center text-xs"
                              step={row.step}
                            />
                          ) : (
                            <span className="text-xs">{getExportValue('subject', row.field, subjectProp) || '-'}</span>
                          )}
                        </td>
                        {/* Comp cells */}
                        {activeCompIndices.map(i => {
                          const prop = loadedProperties[`comp_${i}`];
                          return (
                            <td key={i} className="px-2 py-1.5 text-center border border-gray-300 bg-blue-50">
                              {row.editable ? (
                                <input
                                  type={row.type === 'number' ? 'text' : 'text'}
                                  inputMode={row.type === 'number' ? 'decimal' : 'text'}
                                  value={getEditedValue(`comp_${i}`, row.field) ?? getExportValue(`comp_${i}`, row.field, prop)}
                                  onChange={(e) => updateEditedValue(`comp_${i}`, row.field, e.target.value)}
                                  className="w-full px-1 py-0.5 border border-gray-300 rounded text-center text-xs"
                                  step={row.step}
                                />
                              ) : (
                                <span className="text-xs">{getExportValue(`comp_${i}`, row.field, prop) || '-'}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {/* Estimated Value Row */}
                  <tr className="border-t-2 border-gray-400 bg-green-50">
                    <td className="px-2 py-2 font-bold text-gray-900 border border-gray-300">Est. Land Value</td>
                    <td className="px-2 py-2 text-center font-bold text-green-700 border border-gray-300 bg-yellow-100">
                      {(recalculatedValue || vacantLandResult) ? '$' + (recalculatedValue || vacantLandResult).toLocaleString() : '-'}
                    </td>
                    {[0, 1, 2, 3, 4].filter(i => loadedProperties[`comp_${i}`]).map(i => (
                      <td key={i} className="px-2 py-2 border border-gray-300"></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between rounded-b-lg flex-shrink-0">
              <p className="text-xs text-gray-500">
                Edit values above — changes auto-recalculate. Then download PDF.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={generatePDF}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                >
                  <FileDown size={16} />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VacantLandAppraisalTab;
