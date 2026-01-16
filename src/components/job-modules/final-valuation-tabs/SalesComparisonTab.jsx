import React, { useState, useEffect, useMemo } from 'react';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';
import { Search, Save, X, Download, Upload, Plus, Sliders, BarChart, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import AdjustmentsTab from './AdjustmentsTab';

const SalesComparisonTab = ({ jobData, properties, hpiData, onUpdateJobCache }) => {
  // ==================== NESTED TAB STATE ====================
  const [activeSubTab, setActiveSubTab] = useState('search');
  
  // ==================== SUBJECT PROPERTIES STATE ====================
  const [subjectVCS, setSubjectVCS] = useState([]);
  const [subjectTypeUse, setSubjectTypeUse] = useState([]);
  const [manualProperties, setManualProperties] = useState([]);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [manualBlockLot, setManualBlockLot] = useState({ block: '', lot: '', qualifier: '' });
  
  // ==================== COMPARABLE FILTERS STATE ====================
  const [compFilters, setCompFilters] = useState({
    adjustmentBracket: 'auto', // 'auto' or 'bracket_0', 'bracket_1', etc.
    autoAdjustment: true, // Auto checkbox
    salesCodes: [],
    salesDateStart: '',
    salesDateEnd: '',
    vcs: [],
    sameVCS: false,
    neighborhood: [],
    sameNeighborhood: false,
    builtWithinYears: 25,
    useBuiltRange: false,
    builtYearMin: '',
    builtYearMax: '',
    sizeWithinSqft: 500,
    useSizeRange: false,
    sizeMin: '',
    sizeMax: '',
    zone: [],
    sameZone: false,
    buildingClass: [],
    sameBuildingClass: false,
    typeUse: [],
    sameTypeUse: false,
    style: [],
    sameStyle: false,
    storyHeight: [],
    sameStoryHeight: false,
    view: [],
    sameView: false,
    individualAdjPct: 0,
    netAdjPct: 0,
    grossAdjPct: 0
  });
  
  // ==================== EVALUATION STATE ====================
  const [evaluationMode, setEvaluationMode] = useState('fresh'); // 'fresh' or 'keep'
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResults, setEvaluationResults] = useState(null);
  const [adjustmentGrid, setAdjustmentGrid] = useState([]);
  const [customBrackets, setCustomBrackets] = useState([]);

  const vendorType = jobData?.vendor_type || 'BRT';
  const codeDefinitions = jobData?.parsed_code_definitions;

  // ==================== CME PRICE BRACKETS ====================
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'up to $99,999' },
    { min: 100000, max: 199999, label: '$100,000-$199,999' },
    { min: 200000, max: 299999, label: '$200,000-$299,999' },
    { min: 300000, max: 399999, label: '$300,000-$399,999' },
    { min: 400000, max: 499999, label: '$400,000-$499,999' },
    { min: 500000, max: 749999, label: '$500,000-$749,999' },
    { min: 750000, max: 999999, label: '$750,000-$999,999' },
    { min: 1000000, max: 1499999, label: '$1,000,000-$1,499,999' },
    { min: 1500000, max: 1999999, label: '$1,500,000-$1,999,999' },
    { min: 2000000, max: 99999999, label: 'Over $2,000,000' }
  ];

  // ==================== LOAD ADJUSTMENT GRID AND CUSTOM BRACKETS ====================
  useEffect(() => {
    if (jobData?.id) {
      loadAdjustmentGrid();
      loadCustomBrackets();
    }
  }, [jobData?.id]);

  const loadAdjustmentGrid = async () => {
    try {
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;
      setAdjustmentGrid(data || []);
    } catch (error) {
      console.error('Error loading adjustment grid:', error);
    }
  };

  const loadCustomBrackets = async () => {
    try {
      const { data, error } = await supabase
        .from('job_custom_brackets')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;
      setCustomBrackets(data || []);
    } catch (error) {
      console.error('Error loading custom brackets:', error);
    }
  };

  // ==================== EXTRACT UNIQUE VALUES ====================
  const uniqueVCS = useMemo(() => {
    const vcsSet = new Set();
    properties.forEach(p => {
      if (p.property_vcs) vcsSet.add(p.property_vcs);
    });
    return Array.from(vcsSet).sort();
  }, [properties]);

  const uniqueTypeUse = useMemo(() => {
    const typeSet = new Set();
    properties.forEach(p => {
      if (p.asset_type_use) typeSet.add(p.asset_type_use);
    });
    return Array.from(typeSet).sort();
  }, [properties]);

  const uniqueSalesCodes = useMemo(() => {
    const codeSet = new Set();
    properties.forEach(p => {
      if (p.sales_nu) codeSet.add(p.sales_nu);
    });
    return Array.from(codeSet).sort();
  }, [properties]);

  const uniqueNeighborhood = useMemo(() => {
    // Assuming neighborhood data exists
    const nbSet = new Set();
    properties.forEach(p => {
      if (p.asset_neighborhood) nbSet.add(p.asset_neighborhood);
    });
    return Array.from(nbSet).sort();
  }, [properties]);

  const uniqueZone = useMemo(() => {
    const zoneSet = new Set();
    properties.forEach(p => {
      if (p.asset_zoning) zoneSet.add(p.asset_zoning);
    });
    return Array.from(zoneSet).sort();
  }, [properties]);

  const uniqueBuildingClass = useMemo(() => {
    const classSet = new Set();
    properties.forEach(p => {
      if (p.asset_building_class) classSet.add(p.asset_building_class);
    });
    return Array.from(classSet).sort();
  }, [properties]);

  const uniqueStyle = useMemo(() => {
    const styleSet = new Set();
    properties.forEach(p => {
      if (p.asset_design_style) styleSet.add(p.asset_design_style);
    });
    return Array.from(styleSet).sort();
  }, [properties]);

  const uniqueStoryHeight = useMemo(() => {
    const storySet = new Set();
    properties.forEach(p => {
      if (p.asset_story_height) storySet.add(p.asset_story_height);
    });
    return Array.from(storySet).sort();
  }, [properties]);

  const uniqueView = useMemo(() => {
    const viewSet = new Set();
    properties.forEach(p => {
      if (p.asset_view) viewSet.add(p.asset_view);
    });
    return Array.from(viewSet).sort();
  }, [properties]);

  // ==================== HANDLE CHIP TOGGLES ====================
  const toggleChip = (array, setter) => (value) => {
    if (array.includes(value)) {
      setter(array.filter(v => v !== value));
    } else {
      setter([...array, value]);
    }
  };

  const toggleCompFilterChip = (field) => (value) => {
    if (compFilters[field].includes(value)) {
      setCompFilters(prev => ({
        ...prev,
        [field]: prev[field].filter(v => v !== value)
      }));
    } else {
      setCompFilters(prev => ({
        ...prev,
        [field]: [...prev[field], value]
      }));
    }
  };

  // ==================== MANUAL PROPERTY ENTRY ====================
  const handleAddManualProperty = () => {
    if (!manualBlockLot.block || !manualBlockLot.lot) {
      alert('Please enter both Block and Lot');
      return;
    }

    const compositeKey = `${manualBlockLot.block}-${manualBlockLot.lot}-${manualBlockLot.qualifier || ''}`;
    
    if (manualProperties.includes(compositeKey)) {
      alert('This property is already added');
      return;
    }

    setManualProperties(prev => [...prev, compositeKey]);
    setManualBlockLot({ block: '', lot: '', qualifier: '' });
    setShowManualEntryModal(false);
  };

  const handleImportExcel = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Assuming columns: Block, Lot, Qualifier
        const imported = jsonData.map(row => {
          const block = row.Block || row.block || '';
          const lot = row.Lot || row.lot || '';
          const qualifier = row.Qualifier || row.qualifier || row.Qual || '';
          return `${block}-${lot}-${qualifier}`.trim();
        }).filter(key => key && key !== '--');

        setManualProperties(prev => {
          const combined = [...new Set([...prev, ...imported])];
          return combined;
        });

        alert(`Imported ${imported.length} properties`);
      } catch (error) {
        console.error('Error importing Excel:', error);
        alert('Failed to import Excel file');
      }
    };
    input.click();
  };

  // ==================== EVALUATE COMPARABLES ====================
  const handleEvaluate = async () => {
    setIsEvaluating(true);

    try {
      // Step 1: Determine subject properties
      let subjects = [];

      if (manualProperties.length > 0) {
        // Use manually entered properties
        subjects = properties.filter(p => 
          manualProperties.includes(p.property_composite_key)
        );
      } else {
        // Use VCS + Type/Use filters
        subjects = properties.filter(p => {
          if (subjectVCS.length > 0 && !subjectVCS.includes(p.property_vcs)) return false;
          if (subjectTypeUse.length > 0 && !subjectTypeUse.includes(p.asset_type_use)) return false;
          return true;
        });
      }

      if (subjects.length === 0) {
        alert('No subject properties match your criteria');
        setIsEvaluating(false);
        return;
      }

      // Step 2: Get eligible sales (from Sales Review logic)
      const eligibleSales = getEligibleSales();

      // Step 3: For each subject, find matching comparables
      const results = [];

      for (const subject of subjects) {
        const matchingComps = eligibleSales.filter(comp => {
          // Exclude self
          if (comp.property_composite_key === subject.property_composite_key) return false;

          // Sales codes filter
          if (compFilters.salesCodes.length > 0) {
            const nuCode = (comp.sales_nu || '').trim();
            if (!compFilters.salesCodes.includes(nuCode)) return false;
          }

          // Sales date range
          if (compFilters.salesDateStart && comp.sales_date < compFilters.salesDateStart) return false;
          if (compFilters.salesDateEnd && comp.sales_date > compFilters.salesDateEnd) return false;

          // VCS filter
          if (compFilters.sameVCS) {
            if (comp.property_vcs !== subject.property_vcs) return false;
          } else if (compFilters.vcs.length > 0) {
            if (!compFilters.vcs.includes(comp.property_vcs)) return false;
          }

          // Neighborhood filter
          if (compFilters.sameNeighborhood) {
            if (comp.asset_neighborhood !== subject.asset_neighborhood) return false;
          } else if (compFilters.neighborhood.length > 0) {
            if (!compFilters.neighborhood.includes(comp.asset_neighborhood)) return false;
          }

          // Year built filter
          if (compFilters.useBuiltRange) {
            if (compFilters.builtYearMin && comp.asset_year_built < parseInt(compFilters.builtYearMin)) return false;
            if (compFilters.builtYearMax && comp.asset_year_built > parseInt(compFilters.builtYearMax)) return false;
          } else {
            const yearDiff = Math.abs((comp.asset_year_built || 0) - (subject.asset_year_built || 0));
            if (yearDiff > compFilters.builtWithinYears) return false;
          }

          // Size filter
          if (compFilters.useSizeRange) {
            if (compFilters.sizeMin && comp.asset_sfla < parseInt(compFilters.sizeMin)) return false;
            if (compFilters.sizeMax && comp.asset_sfla > parseInt(compFilters.sizeMax)) return false;
          } else {
            const sizeDiff = Math.abs((comp.asset_sfla || 0) - (subject.asset_sfla || 0));
            if (sizeDiff > compFilters.sizeWithinSqft) return false;
          }

          // Zone filter
          if (compFilters.sameZone) {
            if (comp.asset_zoning !== subject.asset_zoning) return false;
          } else if (compFilters.zone.length > 0) {
            if (!compFilters.zone.includes(comp.asset_zoning)) return false;
          }

          // Building class filter
          if (compFilters.sameBuildingClass) {
            if (comp.asset_building_class !== subject.asset_building_class) return false;
          } else if (compFilters.buildingClass.length > 0) {
            if (!compFilters.buildingClass.includes(comp.asset_building_class)) return false;
          }

          // Type/Use filter
          if (compFilters.sameTypeUse) {
            if (comp.asset_type_use !== subject.asset_type_use) return false;
          } else if (compFilters.typeUse.length > 0) {
            if (!compFilters.typeUse.includes(comp.asset_type_use)) return false;
          }

          // Style filter
          if (compFilters.sameStyle) {
            if (comp.asset_design_style !== subject.asset_design_style) return false;
          } else if (compFilters.style.length > 0) {
            if (!compFilters.style.includes(comp.asset_design_style)) return false;
          }

          // Story height filter
          if (compFilters.sameStoryHeight) {
            if (comp.asset_story_height !== subject.asset_story_height) return false;
          } else if (compFilters.storyHeight.length > 0) {
            if (!compFilters.storyHeight.includes(comp.asset_story_height)) return false;
          }

          // View filter
          if (compFilters.sameView) {
            if (comp.asset_view !== subject.asset_view) return false;
          } else if (compFilters.view.length > 0) {
            if (!compFilters.view.includes(comp.asset_view)) return false;
          }

          return true;
        });

        // Calculate adjustments for each comparable
        const compsWithAdjustments = matchingComps.map(comp => {
          const { adjustments, totalAdjustment, adjustedPrice, adjustmentPercent } = 
            calculateAllAdjustments(subject, comp);

          // Apply adjustment tolerance filters
          let passesTolerance = true;

          // Individual adjustment tolerance
          if (compFilters.individualAdjPct > 0) {
            const hasLargeAdjustment = adjustments.some(adj => 
              Math.abs((adj.amount / comp.values_norm_time) * 100) > compFilters.individualAdjPct
            );
            if (hasLargeAdjustment) passesTolerance = false;
          }

          // Net adjustment tolerance
          if (compFilters.netAdjPct > 0) {
            if (Math.abs(adjustmentPercent) > compFilters.netAdjPct) passesTolerance = false;
          }

          // Gross adjustment tolerance (sum of absolute values)
          if (compFilters.grossAdjPct > 0) {
            const grossPct = adjustments.reduce((sum, adj) => 
              sum + Math.abs((adj.amount / comp.values_norm_time) * 100), 0
            );
            if (grossPct > compFilters.grossAdjPct) passesTolerance = false;
          }

          return {
            ...comp,
            adjustments,
            totalAdjustment,
            adjustedPrice,
            adjustmentPercent,
            passesTolerance
          };
        });

        // Filter by tolerance
        const validComps = compsWithAdjustments.filter(c => c.passesTolerance);

        results.push({
          subject,
          comparables: validComps,
          totalFound: matchingComps.length,
          totalValid: validComps.length
        });
      }

      setEvaluationResults(results);
      setActiveSubTab('results');
      
    } catch (error) {
      console.error('Error evaluating:', error);
      alert(`Evaluation failed: ${error.message}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // ==================== GET ELIGIBLE SALES ====================
  const getEligibleSales = () => {
    if (!jobData?.end_date) return [];
    
    const assessmentYear = new Date(jobData.end_date).getFullYear();

    const cspStart = new Date(assessmentYear - 1, 9, 1);
    const cspEnd = new Date(assessmentYear, 11, 31);
    const pspStart = new Date(assessmentYear - 2, 9, 1);
    const pspEnd = new Date(assessmentYear - 1, 8, 30);
    const hspStart = new Date(assessmentYear - 3, 9, 1);
    const hspEnd = new Date(assessmentYear - 2, 8, 30);
    
    return properties.filter(p => {
      if (!p.sales_date || !p.values_norm_time) return false;
      
      const saleDate = new Date(p.sales_date);
      const inPeriod = (saleDate >= cspStart && saleDate <= cspEnd) ||
                       (saleDate >= pspStart && saleDate <= pspEnd) ||
                       (saleDate >= hspStart && saleDate <= hspEnd);
      
      return inPeriod;
    });
  };

  // ==================== CALCULATE ADJUSTMENTS ====================
  const calculateAllAdjustments = (subject, comp) => {
    const adjustments = adjustmentGrid.map(adjDef => {
      const amount = calculateAdjustment(subject, comp, adjDef);
      return {
        name: adjDef.adjustment_name,
        category: adjDef.category,
        amount
      };
    });
    
    const totalAdjustment = adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    const adjustedPrice = (comp.values_norm_time || 0) + totalAdjustment;
    
    return {
      adjustments,
      totalAdjustment,
      adjustedPrice,
      adjustmentPercent: comp.values_norm_time > 0 ? (totalAdjustment / comp.values_norm_time) * 100 : 0
    };
  };

  const getPriceBracketIndex = (normPrice) => {
    // Check if user selected a specific bracket (not auto)
    if (compFilters.adjustmentBracket && compFilters.adjustmentBracket !== 'auto') {
      // Extract bracket index from 'bracket_0', 'bracket_1', etc.
      const match = compFilters.adjustmentBracket.match(/bracket_(\d+)/);
      if (match) {
        return parseInt(match[1]);
      }
    }

    // Auto mode: determine bracket based on sale price
    if (!normPrice) return 0;
    const bracket = CME_BRACKETS.findIndex(b => normPrice >= b.min && normPrice <= b.max);
    return bracket >= 0 ? bracket : 0;
  };

  const calculateAdjustment = (subject, comp, adjustmentDef) => {
    if (!subject || !comp || !adjustmentDef) return 0;
    
    const bracketIndex = getPriceBracketIndex(comp.values_norm_time);
    const adjustmentValue = adjustmentDef[`bracket_${bracketIndex}`] || 0;
    
    // Simplified adjustment logic - full implementation would check property codes
    let subjectValue, compValue;
    
    switch (adjustmentDef.adjustment_id) {
      case 'living_area':
        subjectValue = subject.asset_sfla || 0;
        compValue = comp.asset_sfla || 0;
        break;
      default:
        return 0;
    }
    
    const difference = subjectValue - compValue;
    
    switch (adjustmentDef.adjustment_type) {
      case 'flat':
        return difference * adjustmentValue;
      case 'per_sqft':
        return difference * adjustmentValue;
      case 'percent':
        return (comp.values_norm_time || 0) * (adjustmentValue / 100) * Math.sign(difference);
      default:
        return 0;
    }
  };

  // ==================== RENDER ====================
  const subTabs = [
    { id: 'adjustments', label: 'Adjustments', icon: Sliders },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'results', label: 'Results', icon: BarChart },
    { id: 'detailed', label: 'Detailed', icon: FileText }
  ];

  return (
    <div className="sales-comparison-cme">
      {/* Nested Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`
                  whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {/* ADJUSTMENTS TAB */}
        {activeSubTab === 'adjustments' && (
          <AdjustmentsTab jobData={jobData} />
        )}

        {/* SEARCH TAB */}
        {activeSubTab === 'search' && (
          <div className="space-y-8">
            {/* SECTION 1: Which properties do you want to evaluate? */}
            <div className="bg-white border border-gray-300 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Which properties do you want to evaluate?
              </h3>

              <div className="space-y-4">
                {/* VCS Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">VCS</label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        toggleChip(subjectVCS, setSubjectVCS)(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select VCS to add...</option>
                    {uniqueVCS.map(vcs => (
                      <option key={vcs} value={vcs}>{vcs}</option>
                    ))}
                  </select>
                  {/* VCS Chips */}
                  {subjectVCS.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {subjectVCS.map(vcs => (
                        <span
                          key={vcs}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                        >
                          {vcs}
                          <button
                            onClick={() => toggleChip(subjectVCS, setSubjectVCS)(vcs)}
                            className="ml-1 text-blue-600 hover:text-blue-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Type/Use Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Type/Use Codes</label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        toggleChip(subjectTypeUse, setSubjectTypeUse)(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Type/Use to add...</option>
                    {uniqueTypeUse.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  {/* Type/Use Chips */}
                  {subjectTypeUse.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {subjectTypeUse.map(type => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                        >
                          {type}
                          <button
                            onClick={() => toggleChip(subjectTypeUse, setSubjectTypeUse)(type)}
                            className="ml-1 text-green-600 hover:text-green-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Manual Entry Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowManualEntryModal(true)}
                    className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm font-medium"
                  >
                    New Block/Lot/Qual
                  </button>
                  <button
                    onClick={handleImportExcel}
                    className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm font-medium inline-flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Import Block/Lot/Qual
                  </button>
                </div>

                {/* Manual Properties Chips */}
                {manualProperties.length > 0 && (
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manual Properties ({manualProperties.length})
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {manualProperties.map(key => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm"
                        >
                          {key}
                          <button
                            onClick={() => setManualProperties(prev => prev.filter(k => k !== key))}
                            className="ml-1 text-purple-600 hover:text-purple-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 2: Which comparables do you want to use? */}
            <div className="bg-white border border-gray-300 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Which comparables do you want to use?
              </h3>

              {/* Adjustment Bracket Selection */}
              <div className="mb-6 pb-4 border-b border-gray-200">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Adjustment Bracket
                    </label>
                    <select
                      value={compFilters.adjustmentBracket || 'auto'}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setCompFilters(prev => ({
                          ...prev,
                          adjustmentBracket: newValue,
                          autoAdjustment: newValue === 'auto'
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="auto">Auto (based on sale price)</option>
                      <optgroup label="Default Brackets">
                        {CME_BRACKETS.map((bracket, idx) => (
                          <option key={idx} value={`bracket_${idx}`}>
                            {bracket.label}
                          </option>
                        ))}
                      </optgroup>
                      {customBrackets.length > 0 && (
                        <optgroup label="Custom Brackets">
                          {customBrackets.map((bracket) => (
                            <option key={bracket.bracket_id} value={bracket.bracket_id}>
                              {bracket.bracket_name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={compFilters.adjustmentBracket === 'auto'}
                      onChange={(e) => {
                        setCompFilters(prev => ({
                          ...prev,
                          adjustmentBracket: e.target.checked ? 'auto' : 'bracket_1',
                          autoAdjustment: e.target.checked
                        }));
                      }}
                      className="rounded"
                      id="auto-adjustment"
                    />
                    <label htmlFor="auto-adjustment" className="text-sm text-gray-700">
                      Auto
                    </label>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Select which adjustment bracket to use for comparable evaluations.
                  "Auto" automatically selects the bracket based on each comparable's sale price.
                  {customBrackets.length > 0 && ' Custom brackets allow you to define your own price ranges and adjustment values.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* LEFT COLUMN */}
                <div className="space-y-4">
                  {/* Sales Codes */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Sales Codes</label>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          toggleCompFilterChip('salesCodes')(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select code...</option>
                      {uniqueSalesCodes.map(code => (
                        <option key={code} value={code}>{code || '(blank)'}</option>
                      ))}
                    </select>
                    {compFilters.salesCodes.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {compFilters.salesCodes.map(code => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                          >
                            {code || '(blank)'}
                            <button
                              onClick={() => toggleCompFilterChip('salesCodes')(code)}
                              className="ml-1 text-blue-600 hover:text-blue-800"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sales Between */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Sales Between</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={compFilters.salesDateStart}
                        onChange={(e) => setCompFilters(prev => ({ ...prev, salesDateStart: e.target.value }))}
                        className="px-3 py-2 border border-gray-300 rounded"
                      />
                      <input
                        type="date"
                        value={compFilters.salesDateEnd}
                        onChange={(e) => setCompFilters(prev => ({ ...prev, salesDateEnd: e.target.value }))}
                        className="px-3 py-2 border border-gray-300 rounded"
                      />
                    </div>
                  </div>

                  {/* VCS */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">VCS</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameVCS}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameVCS: e.target.checked }))}
                          className="rounded"
                        />
                        Same VCS
                      </label>
                    </div>
                    {!compFilters.sameVCS && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('vcs')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select VCS...</option>
                          {uniqueVCS.map(vcs => (
                            <option key={vcs} value={vcs}>{vcs}</option>
                          ))}
                        </select>
                        {compFilters.vcs.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.vcs.map(vcs => (
                              <span key={vcs} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                                {vcs}
                                <button onClick={() => toggleCompFilterChip('vcs')(vcs)} className="ml-1 text-blue-600 hover:text-blue-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Neighborhood */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Neighborhood</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameNeighborhood}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameNeighborhood: e.target.checked }))}
                          className="rounded"
                        />
                        Same Neighborhood
                      </label>
                    </div>
                    {!compFilters.sameNeighborhood && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('neighborhood')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select neighborhood...</option>
                          {uniqueNeighborhood.map(nb => (
                            <option key={nb} value={nb}>{nb}</option>
                          ))}
                        </select>
                        {compFilters.neighborhood.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.neighborhood.map(nb => (
                              <span key={nb} className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                                {nb}
                                <button onClick={() => toggleCompFilterChip('neighborhood')(nb)} className="ml-1 text-green-600 hover:text-green-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Year Built */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Year Built</label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={!compFilters.useBuiltRange}
                          onChange={() => setCompFilters(prev => ({ ...prev, useBuiltRange: false }))}
                        />
                        <span className="text-sm">Built within</span>
                        <input
                          type="number"
                          value={compFilters.builtWithinYears}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, builtWithinYears: parseInt(e.target.value) || 0 }))}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <span className="text-sm">years of each other</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={compFilters.useBuiltRange}
                          onChange={() => setCompFilters(prev => ({ ...prev, useBuiltRange: true }))}
                        />
                        <span className="text-sm">Comparable built between</span>
                        <input
                          type="number"
                          value={compFilters.builtYearMin}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, builtYearMin: e.target.value }))}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="YYYY"
                        />
                        <span className="text-sm">and</span>
                        <input
                          type="number"
                          value={compFilters.builtYearMax}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, builtYearMax: e.target.value }))}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="YYYY"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Size */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Size (SFLA)</label>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={!compFilters.useSizeRange}
                          onChange={() => setCompFilters(prev => ({ ...prev, useSizeRange: false }))}
                        />
                        <span className="text-sm">Size within</span>
                        <input
                          type="number"
                          value={compFilters.sizeWithinSqft}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sizeWithinSqft: parseInt(e.target.value) || 0 }))}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                        />
                        <span className="text-sm">sqft of each other</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={compFilters.useSizeRange}
                          onChange={() => setCompFilters(prev => ({ ...prev, useSizeRange: true }))}
                        />
                        <span className="text-sm">Comparable size between</span>
                        <input
                          type="number"
                          value={compFilters.sizeMin}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sizeMin: e.target.value }))}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="sqft"
                        />
                        <span className="text-sm">and</span>
                        <input
                          type="number"
                          value={compFilters.sizeMax}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sizeMax: e.target.value }))}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="sqft"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-4">
                  {/* Zone */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Zone</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameZone}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameZone: e.target.checked }))}
                          className="rounded"
                        />
                        Same Zone
                      </label>
                    </div>
                    {!compFilters.sameZone && uniqueZone.length > 0 && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('zone')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select zone...</option>
                          {uniqueZone.map(z => (
                            <option key={z} value={z}>{z}</option>
                          ))}
                        </select>
                        {compFilters.zone.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.zone.map(z => (
                              <span key={z} className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
                                {z}
                                <button onClick={() => toggleCompFilterChip('zone')(z)} className="ml-1 text-yellow-600 hover:text-yellow-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Building Class */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Building Class</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameBuildingClass}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameBuildingClass: e.target.checked }))}
                          className="rounded"
                        />
                        Same
                      </label>
                    </div>
                    {!compFilters.sameBuildingClass && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('buildingClass')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select class...</option>
                          {uniqueBuildingClass.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        {compFilters.buildingClass.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.buildingClass.map(c => (
                              <span key={c} className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm">
                                {c}
                                <button onClick={() => toggleCompFilterChip('buildingClass')(c)} className="ml-1 text-purple-600 hover:text-purple-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Type/Use */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Type/Use</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameTypeUse}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameTypeUse: e.target.checked }))}
                          className="rounded"
                        />
                        Same
                      </label>
                    </div>
                    {!compFilters.sameTypeUse && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('typeUse')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select type...</option>
                          {uniqueTypeUse.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        {compFilters.typeUse.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.typeUse.map(t => (
                              <span key={t} className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                                {t}
                                <button onClick={() => toggleCompFilterChip('typeUse')(t)} className="ml-1 text-green-600 hover:text-green-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Style */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Style</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameStyle}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameStyle: e.target.checked }))}
                          className="rounded"
                        />
                        Same
                      </label>
                    </div>
                    {!compFilters.sameStyle && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('style')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select style...</option>
                          {uniqueStyle.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        {compFilters.style.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.style.map(s => (
                              <span key={s} className="inline-flex items-center gap-1 px-3 py-1 bg-pink-100 text-pink-800 rounded-full text-sm">
                                {s}
                                <button onClick={() => toggleCompFilterChip('style')(s)} className="ml-1 text-pink-600 hover:text-pink-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Story Height */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Story Height</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameStoryHeight}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameStoryHeight: e.target.checked }))}
                          className="rounded"
                        />
                        Same
                      </label>
                    </div>
                    {!compFilters.sameStoryHeight && uniqueStoryHeight.length > 0 && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('storyHeight')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select height...</option>
                          {uniqueStoryHeight.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        {compFilters.storyHeight.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.storyHeight.map(h => (
                              <span key={h} className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm">
                                {h}
                                <button onClick={() => toggleCompFilterChip('storyHeight')(h)} className="ml-1 text-indigo-600 hover:text-indigo-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* View */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">View</label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={compFilters.sameView}
                          onChange={(e) => setCompFilters(prev => ({ ...prev, sameView: e.target.checked }))}
                          className="rounded"
                        />
                        Same View
                      </label>
                    </div>
                    {!compFilters.sameView && uniqueView.length > 0 && (
                      <>
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              toggleCompFilterChip('view')(e.target.value);
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded"
                        >
                          <option value="">Select view...</option>
                          {uniqueView.map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                        {compFilters.view.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {compFilters.view.map(v => (
                              <span key={v} className="inline-flex items-center gap-1 px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm">
                                {v}
                                <button onClick={() => toggleCompFilterChip('view')(v)} className="ml-1 text-teal-600 hover:text-teal-800">
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Adjustment Tolerance Filters */}
              <div className="mt-6 pt-6 border-t border-gray-300">
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Adjustment Tolerances</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Individual adjustments within
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={compFilters.individualAdjPct}
                        onChange={(e) => setCompFilters(prev => ({ ...prev, individualAdjPct: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                        min="0"
                      />
                      <span className="text-sm">% of sale for comparison</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Net adjusted valuation within
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={compFilters.netAdjPct}
                        onChange={(e) => setCompFilters(prev => ({ ...prev, netAdjPct: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                        min="0"
                      />
                      <span className="text-sm">% of sale for comparison</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      Gross adjusted valuation within
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={compFilters.grossAdjPct}
                        onChange={(e) => setCompFilters(prev => ({ ...prev, grossAdjPct: parseFloat(e.target.value) || 0 }))}
                        className="w-20 px-2 py-1 border border-gray-300 rounded"
                        min="0"
                      />
                      <span className="text-sm">% of sale for comparison</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Evaluate Button */}
              <div className="mt-6 pt-6 border-t border-gray-300 flex items-center justify-between">
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={evaluationMode === 'fresh'}
                      onChange={() => setEvaluationMode('fresh')}
                      className="rounded"
                    />
                    <span className="text-sm">Fresh evaluation (delete all saved results)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={evaluationMode === 'keep'}
                      onChange={() => setEvaluationMode('keep')}
                      className="rounded"
                    />
                    <span className="text-sm">Keep saved results</span>
                  </label>
                </div>

                <button
                  onClick={handleEvaluate}
                  disabled={isEvaluating}
                  className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-lg"
                >
                  {isEvaluating ? 'Evaluating...' : 'Evaluate'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* RESULTS TAB */}
        {activeSubTab === 'results' && (
          <div className="space-y-6">
            {!evaluationResults ? (
              <div className="bg-white border border-gray-300 rounded-lg p-12 text-center">
                <BarChart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Results Yet</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Configure your search criteria and click "Evaluate" to generate results
                </p>
                <button
                  onClick={() => setActiveSubTab('search')}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Go to Search
                </button>
              </div>
            ) : (
              <>
                <div className="bg-white border border-gray-300 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Evaluation Results
                  </h3>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Total Subjects</div>
                      <div className="text-2xl font-bold text-blue-900">{evaluationResults.length}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Total Comparables Found</div>
                      <div className="text-2xl font-bold text-green-900">
                        {evaluationResults.reduce((sum, r) => sum + r.totalFound, 0)}
                      </div>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4">
                      <div className="text-sm text-gray-600">Valid After Tolerance</div>
                      <div className="text-2xl font-bold text-purple-900">
                        {evaluationResults.reduce((sum, r) => sum + r.totalValid, 0)}
                      </div>
                    </div>
                  </div>

                  {/* Results Table */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Subject Property</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">VCS</th>
                          <th className="px-4 py-3 text-left font-medium text-gray-700">Type/Use</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-700">SFLA</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-700">Comps Found</th>
                          <th className="px-4 py-3 text-right font-medium text-gray-700">Valid Comps</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {evaluationResults.map((result, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {result.subject.property_block}-{result.subject.property_lot}-{result.subject.property_qualifier}
                            </td>
                            <td className="px-4 py-3 text-gray-700">{result.subject.property_vcs}</td>
                            <td className="px-4 py-3 text-gray-700">{result.subject.asset_type_use}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{result.subject.asset_sfla?.toLocaleString()}</td>
                            <td className="px-4 py-3 text-right text-gray-700">{result.totalFound}</td>
                            <td className="px-4 py-3 text-right font-semibold text-green-700">{result.totalValid}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* DETAILED TAB */}
        {activeSubTab === 'detailed' && (
          <div className="bg-white border border-gray-300 rounded-lg p-12 text-center">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Detailed Analysis</h3>
            <p className="text-sm text-gray-600">
              Per-property detailed comparable analysis will appear here
            </p>
          </div>
        )}
      </div>

      {/* Manual Entry Modal */}
      {showManualEntryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Add Property</h3>
              <button
                onClick={() => setShowManualEntryModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Block</label>
                <input
                  type="text"
                  value={manualBlockLot.block}
                  onChange={(e) => setManualBlockLot(prev => ({ ...prev, block: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lot</label>
                <input
                  type="text"
                  value={manualBlockLot.lot}
                  onChange={(e) => setManualBlockLot(prev => ({ ...prev, lot: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Qualifier (Optional)</label>
                <input
                  type="text"
                  value={manualBlockLot.qualifier}
                  onChange={(e) => setManualBlockLot(prev => ({ ...prev, qualifier: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowManualEntryModal(false)}
                className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManualProperty}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Property
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesComparisonTab;
