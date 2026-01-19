import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, interpretCodes, getRawDataForJob } from '../../../lib/supabaseClient';
import { Search, X, Upload, Sliders, FileText, Check } from 'lucide-react';
import * as XLSX from 'xlsx';
import AdjustmentsTab from './AdjustmentsTab';

const SalesComparisonTab = ({ jobData, properties, hpiData, onUpdateJobCache }) => {
  // ==================== NESTED TAB STATE ====================
  const [activeSubTab, setActiveSubTab] = useState('search');
  const resultsRef = React.useRef(null);
  const [codeDefinitions, setCodeDefinitions] = useState(null);
  
  // ==================== SUBJECT PROPERTIES STATE ====================
  const [subjectVCS, setSubjectVCS] = useState([]);
  const [subjectTypeUse, setSubjectTypeUse] = useState([]);
  const [manualProperties, setManualProperties] = useState([]);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [manualBlockLot, setManualBlockLot] = useState({ block: '', lot: '', qualifier: '' });
  
  // ==================== COMPARABLE FILTERS STATE ====================
  // Calculate CSP date range on mount
  const getCSPDateRange = useCallback(() => {
    if (!jobData?.end_date) return { start: '', end: '' };
    const assessmentYear = new Date(jobData.end_date).getFullYear();
    return {
      start: new Date(assessmentYear - 1, 9, 1).toISOString().split('T')[0], // 10/1 prior-prior year
      end: new Date(assessmentYear, 11, 31).toISOString().split('T')[0] // 12/31 prior year
    };
  }, [jobData?.end_date]);

  const cspDateRange = useMemo(() => getCSPDateRange(), [getCSPDateRange]);

  const [compFilters, setCompFilters] = useState({
    adjustmentBracket: 'auto', // 'auto' or 'bracket_0', 'bracket_1', etc.
    autoAdjustment: true, // Auto checkbox
    salesCodes: ['', '00', '07', '32', '36'], // CSP default codes
    salesDateStart: cspDateRange.start,
    salesDateEnd: cspDateRange.end,
    vcs: [],
    sameVCS: true, // Default checked
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
    sameTypeUse: true, // Default checked
    style: [],
    sameStyle: true, // Default checked
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
  const [evaluationProgress, setEvaluationProgress] = useState({ current: 0, total: 0 });
  const [evaluationResults, setEvaluationResults] = useState(null);
  const [adjustmentGrid, setAdjustmentGrid] = useState([]);
  const [customBrackets, setCustomBrackets] = useState([]);
  const [minCompsForSuccess, setMinCompsForSuccess] = useState(3); // User-selectable threshold
  const [selectedPropertyForDetail, setSelectedPropertyForDetail] = useState(null); // For detailed tab

  const vendorType = jobData?.vendor_type || 'BRT';

  // Helper function to format attribute values with inline adjustments (for Detailed tab)
  const formatAttributeWithAdjustment = (compValue, adjAmount, showDiff = null, suffix = '') => {
    if (!compValue && compValue !== 0) return 'N/A';

    return (
      <div className="text-center">
        <div className="font-semibold">{typeof compValue === 'number' ? compValue.toLocaleString() : compValue}{suffix}</div>
        {adjAmount && adjAmount !== 0 && (
          <div className={`text-xs font-bold mt-1 ${adjAmount > 0 ? 'text-green-700' : 'text-red-700'}`}>
            {adjAmount > 0 ? '+' : ''}${adjAmount.toLocaleString()}
            {showDiff && <div className="text-xs text-gray-600">({showDiff})</div>}
          </div>
        )}
      </div>
    );
  };

  // ==================== SALES CODE NORMALIZATION ====================
  const normalizeSalesCode = useCallback((code) => {
    if (code === null || code === undefined || code === '' || code === '00') return '';
    return String(code).trim();
  }, []);

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
      loadCodeDefinitions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id]);

  const loadAdjustmentGrid = async () => {
    try {
      const { data, error } = await supabase
        .from('job_adjustment_grid')
        .select('*')
        .eq('job_id', jobData.id)
        .order('sort_order');

      if (error) throw error;

      console.log(`🔄 Loaded adjustment grid: ${data?.length || 0} entries`);
      if (data && data.length > 0) {
        console.log(`📋 Sample entry:`, data[0]);
      } else {
        console.warn(`⚠️  No adjustment data found in database for job ${jobData.id}`);
        console.warn(`   Have you saved adjustments in the Adjustments tab?`);
      }

      setAdjustmentGrid(data || []);
    } catch (error) {
      console.error('❌ Error loading adjustment grid:', error);
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

  const loadCodeDefinitions = async () => {
    try {
      const rawData = await getRawDataForJob(jobData.id);
      if (rawData?.codeDefinitions || rawData?.parsed_code_definitions) {
        setCodeDefinitions(rawData.codeDefinitions || rawData.parsed_code_definitions);
      }
    } catch (error) {
      console.error('Error loading code definitions:', error);
    }
  };

  // Reload adjustment grid when returning to search tab (in case it was updated in Adjustments tab)
  useEffect(() => {
    if (activeSubTab === 'search' && jobData?.id) {
      console.log('🔄 Switched to Search tab - reloading adjustment grid...');
      loadAdjustmentGrid();
      loadCustomBrackets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, jobData?.id]);

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

  // ==================== SET ASIDE SUCCESSFUL ====================
  const handleSetAsideSuccessful = async () => {
    if (!evaluationResults) return;

    const successful = evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess);

    if (successful.length === 0) {
      alert(`No properties with ${minCompsForSuccess}+ comparables to set aside`);
      return;
    }

    try {
      // Update status to 'set_aside' in database for these evaluations
      const subjectIds = successful.map(r => r.subject.id);

      const { error } = await supabase
        .from('job_cme_evaluations')
        .update({ status: 'set_aside' })
        .in('subject_property_id', subjectIds)
        .eq('job_id', jobData.id);

      if (error) throw error;

      // Remove set-aside properties from current subject filters
      const remainingResults = evaluationResults.filter(r => r.comparables.length < 3);

      alert(`${successful.length} properties set aside successfully. ${remainingResults.length} properties remain for re-evaluation.`);

      // Update results to show only remaining
      setEvaluationResults(remainingResults.length > 0 ? remainingResults : null);

    } catch (error) {
      console.error('Error setting aside properties:', error);
      alert(`Failed to set aside properties: ${error.message}`);
    }
  };

  // ==================== APPLY TO FINAL ROSTER ====================
  const handleApplyToFinalRoster = async () => {
    if (!evaluationResults) return;

    const valued = evaluationResults.filter(r => r.projectedAssessment);

    if (valued.length === 0) {
      alert('No properties with projected assessments to apply');
      return;
    }

    const confirmation = window.confirm(
      `Apply ${valued.length} projected assessments to Final Valuation?\n\n` +
      `This will update the CME fields in the final_valuation_data table.`
    );

    if (!confirmation) return;

    try {
      // For each valued property, update or insert into final_valuation_data
      for (const result of valued) {
        const compKeys = result.comparables.map((c, idx) =>
          `${c.property_block}-${c.property_lot}-${c.property_qualifier || ''}`
        );

        const finalData = {
          job_id: jobData.id,
          property_composite_key: result.subject.property_composite_key,
          cme_projected_assessment: result.projectedAssessment,
          cme_comp1: compKeys[0] || null,
          cme_comp2: compKeys[1] || null,
          cme_comp3: compKeys[2] || null,
          cme_comp4: compKeys[3] || null,
          cme_comp5: compKeys[4] || null
        };

        // Upsert into final_valuation_data
        const { error } = await supabase
          .from('final_valuation_data')
          .upsert(finalData, {
            onConflict: 'job_id,property_composite_key'
          });

        if (error) throw error;
      }

      // Update evaluation status to 'applied'
      const subjectIds = valued.map(r => r.subject.id);

      await supabase
        .from('job_cme_evaluations')
        .update({ status: 'applied' })
        .in('subject_property_id', subjectIds)
        .eq('job_id', jobData.id);

      alert(`Successfully applied ${valued.length} projected assessments to Final Valuation!`);

      // Clear results to indicate completion
      setEvaluationResults(null);
      setActiveSubTab('search');

    } catch (error) {
      console.error('Error applying to final roster:', error);
      alert(`Failed to apply values: ${error.message}`);
    }
  };

  // ==================== EVALUATE COMPARABLES ====================
  const handleEvaluate = async () => {
    setIsEvaluating(true);
    setEvaluationProgress({ current: 0, total: 0 });

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
        setEvaluationProgress({ current: 0, total: 0 });
        return;
      }

      console.log(`🔍 Evaluating ${subjects.length} subject properties...`);

      // Step 2: Get eligible sales (from Sales Review logic)
      const eligibleSales = getEligibleSales();
      console.log(`📊 Found ${eligibleSales.length} eligible sales (CSP period)`);

      if (eligibleSales.length === 0) {
        alert(`No eligible sales found for comparison.\n\nThe CSP period (${compFilters.salesDateStart} to ${compFilters.salesDateEnd}) has no valid sales with time-adjusted prices.\n\nPlease check your Sales Review tab or adjust your date range.`);
        setIsEvaluating(false);
        setEvaluationProgress({ current: 0, total: 0 });
        return;
      }

      // Log adjustment configuration
      const bracketLabel = compFilters.adjustmentBracket === 'auto' ? 'auto' :
        compFilters.adjustmentBracket?.startsWith('bracket_') ?
        CME_BRACKETS[parseInt(compFilters.adjustmentBracket.replace('bracket_', ''))]?.label || compFilters.adjustmentBracket :
        compFilters.adjustmentBracket;

      console.log(`📊 Adjustment Configuration:`);
      console.log(`   - Grid entries: ${adjustmentGrid.length}`);
      console.log(`   - Selected bracket: ${compFilters.adjustmentBracket} (${bracketLabel})`);
      console.log(`   - Custom brackets: ${customBrackets.length}`);

      if (adjustmentGrid.length === 0) {
        console.warn(`⚠️  WARNING: No adjustment grid entries found!`);
        console.warn(`   All adjustments will be $0. Configure adjustments in the Adjustments tab first.`);
      }

      // Note: Evaluation can proceed even without adjustment grid - comps will have $0 adjustments
      // This allows users to see comp matches before setting up adjustments

      // Step 3: For each subject, find matching comparables
      const results = [];
      setEvaluationProgress({ current: 0, total: subjects.length });

      // Force a small delay to ensure progress bar renders
      await new Promise(resolve => setTimeout(resolve, 50));

      // Process in smaller batches for more frequent UI updates
      const BATCH_SIZE = 10;

      for (let i = 0; i < subjects.length; i++) {
        const subject = subjects[i];

        // Update progress immediately
        setEvaluationProgress(prev => ({ current: i + 1, total: subjects.length }));

        // Allow UI to update every batch (more frequently for responsive progress)
        if (i > 0 && i % BATCH_SIZE === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        // Debug: Log first property's matching process
        const isFirstProperty = i === 0;
        if (isFirstProperty) {
          console.log(`\n🔍 DEBUG: Matching comps for first subject property:`);
          console.log(`   Subject: ${subject.property_block}-${subject.property_lot}`);
          console.log(`   VCS: ${subject.property_vcs}, Type: ${subject.asset_type_use}`);
          console.log(`   Year Built: ${subject.asset_year_built}, SFLA: ${subject.asset_sfla}`);
          console.log(`   Eligible sales pool: ${eligibleSales.length}`);
        }

        let debugFilters = {
          self: 0,
          salesCodes: 0,
          salesDate: 0,
          vcs: 0,
          neighborhood: 0,
          yearBuilt: 0,
          size: 0,
          zone: 0,
          buildingClass: 0,
          typeUse: 0,
          style: 0,
          storyHeight: 0,
          view: 0,
          passed: 0
        };

        const matchingComps = eligibleSales.filter(comp => {
          // Exclude self
          if (comp.property_composite_key === subject.property_composite_key) {
            if (isFirstProperty) debugFilters.self++;
            return false;
          }

          // Sales codes filter (normalize blank, '00', '0' to '')
          if (compFilters.salesCodes.length > 0) {
            const normalizedCompCode = normalizeSalesCode(comp.sales_nu);
            const normalizedFilterCodes = compFilters.salesCodes.map(normalizeSalesCode);
            if (!normalizedFilterCodes.includes(normalizedCompCode)) {
              if (isFirstProperty) debugFilters.salesCodes++;
              return false;
            }
          }

          // Sales date range
          if (compFilters.salesDateStart && comp.sales_date < compFilters.salesDateStart) {
            if (isFirstProperty) debugFilters.salesDate++;
            return false;
          }
          if (compFilters.salesDateEnd && comp.sales_date > compFilters.salesDateEnd) {
            if (isFirstProperty) debugFilters.salesDate++;
            return false;
          }

          // VCS filter
          if (compFilters.sameVCS) {
            if (comp.property_vcs !== subject.property_vcs) {
              if (isFirstProperty) debugFilters.vcs++;
              return false;
            }
          } else if (compFilters.vcs.length > 0) {
            if (!compFilters.vcs.includes(comp.property_vcs)) {
              if (isFirstProperty) debugFilters.vcs++;
              return false;
            }
          }

          // Neighborhood filter
          if (compFilters.sameNeighborhood) {
            if (comp.asset_neighborhood !== subject.asset_neighborhood) {
              if (isFirstProperty) debugFilters.neighborhood++;
              return false;
            }
          } else if (compFilters.neighborhood.length > 0) {
            if (!compFilters.neighborhood.includes(comp.asset_neighborhood)) {
              if (isFirstProperty) debugFilters.neighborhood++;
              return false;
            }
          }

          // Year built filter
          if (compFilters.useBuiltRange) {
            if (compFilters.builtYearMin && comp.asset_year_built < parseInt(compFilters.builtYearMin)) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
            if (compFilters.builtYearMax && comp.asset_year_built > parseInt(compFilters.builtYearMax)) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
          } else {
            const yearDiff = Math.abs((comp.asset_year_built || 0) - (subject.asset_year_built || 0));
            if (yearDiff > compFilters.builtWithinYears) {
              if (isFirstProperty) debugFilters.yearBuilt++;
              return false;
            }
          }

          // Size filter
          if (compFilters.useSizeRange) {
            if (compFilters.sizeMin && comp.asset_sfla < parseInt(compFilters.sizeMin)) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
            if (compFilters.sizeMax && comp.asset_sfla > parseInt(compFilters.sizeMax)) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
          } else {
            const sizeDiff = Math.abs((comp.asset_sfla || 0) - (subject.asset_sfla || 0));
            if (sizeDiff > compFilters.sizeWithinSqft) {
              if (isFirstProperty) debugFilters.size++;
              return false;
            }
          }

          // Zone filter
          if (compFilters.sameZone) {
            if (comp.asset_zoning !== subject.asset_zoning) {
              if (isFirstProperty) debugFilters.zone++;
              return false;
            }
          } else if (compFilters.zone.length > 0) {
            if (!compFilters.zone.includes(comp.asset_zoning)) {
              if (isFirstProperty) debugFilters.zone++;
              return false;
            }
          }

          // Building class filter
          if (compFilters.sameBuildingClass) {
            if (comp.asset_building_class !== subject.asset_building_class) {
              if (isFirstProperty) debugFilters.buildingClass++;
              return false;
            }
          } else if (compFilters.buildingClass.length > 0) {
            if (!compFilters.buildingClass.includes(comp.asset_building_class)) {
              if (isFirstProperty) debugFilters.buildingClass++;
              return false;
            }
          }

          // Type/Use filter
          if (compFilters.sameTypeUse) {
            if (comp.asset_type_use !== subject.asset_type_use) {
              if (isFirstProperty) debugFilters.typeUse++;
              return false;
            }
          } else if (compFilters.typeUse.length > 0) {
            if (!compFilters.typeUse.includes(comp.asset_type_use)) {
              if (isFirstProperty) debugFilters.typeUse++;
              return false;
            }
          }

          // Style filter
          if (compFilters.sameStyle) {
            if (comp.asset_design_style !== subject.asset_design_style) {
              if (isFirstProperty) debugFilters.style++;
              return false;
            }
          } else if (compFilters.style.length > 0) {
            if (!compFilters.style.includes(comp.asset_design_style)) {
              if (isFirstProperty) debugFilters.style++;
              return false;
            }
          }

          // Story height filter
          if (compFilters.sameStoryHeight) {
            if (comp.asset_story_height !== subject.asset_story_height) {
              if (isFirstProperty) debugFilters.storyHeight++;
              return false;
            }
          } else if (compFilters.storyHeight.length > 0) {
            if (!compFilters.storyHeight.includes(comp.asset_story_height)) {
              if (isFirstProperty) debugFilters.storyHeight++;
              return false;
            }
          }

          // View filter
          if (compFilters.sameView) {
            if (comp.asset_view !== subject.asset_view) {
              if (isFirstProperty) debugFilters.view++;
              return false;
            }
          } else if (compFilters.view.length > 0) {
            if (!compFilters.view.includes(comp.asset_view)) {
              if (isFirstProperty) debugFilters.view++;
              return false;
            }
          }

          if (isFirstProperty) debugFilters.passed++;
          return true;
        });

        // Log debug results for first property
        if (isFirstProperty) {
          console.log(`\n📊 Filter Results:`);
          console.log(`   ❌ Excluded (self): ${debugFilters.self}`);
          console.log(`   ❌ Failed sales codes: ${debugFilters.salesCodes}`);
          console.log(`   ❌ Failed sales date: ${debugFilters.salesDate}`);
          console.log(`   ❌ Failed VCS: ${debugFilters.vcs}`);
          console.log(`   ❌ Failed neighborhood: ${debugFilters.neighborhood}`);
          console.log(`   ❌ Failed year built: ${debugFilters.yearBuilt}`);
          console.log(`   ❌ Failed size (SFLA): ${debugFilters.size}`);
          console.log(`   ❌ Failed zone: ${debugFilters.zone}`);
          console.log(`   ❌ Failed building class: ${debugFilters.buildingClass}`);
          console.log(`   ❌ Failed type/use: ${debugFilters.typeUse}`);
          console.log(`   ❌ Failed style: ${debugFilters.style}`);
          console.log(`   ❌ Failed story height: ${debugFilters.storyHeight}`);
          console.log(`   ❌ Failed view: ${debugFilters.view}`);
          console.log(`   ✅ Passed initial filters: ${debugFilters.passed}`);
        }

        // Calculate adjustments for each comparable
        const compsWithAdjustments = matchingComps.map(comp => {
          const { adjustments, totalAdjustment, adjustedPrice, adjustmentPercent } =
            calculateAllAdjustments(subject, comp);

          const grossAdjustment = adjustments.reduce((sum, adj) => sum + Math.abs(adj.amount), 0);
          const grossAdjustmentPercent = comp.values_norm_time > 0
            ? (grossAdjustment / comp.values_norm_time) * 100
            : 0;

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
            if (grossAdjustmentPercent > compFilters.grossAdjPct) passesTolerance = false;
          }

          return {
            ...comp,
            adjustments,
            totalAdjustment,
            grossAdjustment,
            grossAdjustmentPercent,
            adjustedPrice,
            adjustmentPercent,
            passesTolerance
          };
        });

        // Filter by tolerance
        let validComps = compsWithAdjustments.filter(c => c.passesTolerance);

        // Debug tolerance filtering
        if (isFirstProperty) {
          const failedTolerance = compsWithAdjustments.length - validComps.length;
          console.log(`\n🎯 Adjustment Tolerance Results:`);
          console.log(`   Before tolerance: ${compsWithAdjustments.length} comps`);
          console.log(`   ❌ Failed tolerance: ${failedTolerance}`);
          console.log(`   ✅ Passed tolerance: ${validComps.length}`);
          if (compFilters.individualAdjPct > 0) {
            console.log(`      Individual adj limit: ${compFilters.individualAdjPct}%`);
          }
          if (compFilters.netAdjPct > 0) {
            console.log(`      Net adj limit: ${compFilters.netAdjPct}%`);
          }
          if (compFilters.grossAdjPct > 0) {
            console.log(`      Gross adj limit: ${compFilters.grossAdjPct}%`);
          }
        }

        // SUBJECT SALE PRIORITY: If subject sold in CSP, it becomes Comp #1 with 0% adjustment
        const assessmentYear = new Date(jobData.end_date).getFullYear();
        const cspStart = new Date(assessmentYear - 1, 9, 1);
        const cspEnd = new Date(assessmentYear, 11, 31);

        const subjectSaleDate = subject.sales_date ? new Date(subject.sales_date) : null;
        const subjectSoldInCSP = subjectSaleDate &&
          (subjectSaleDate >= cspStart && subjectSaleDate <= cspEnd) &&
          subject.values_norm_time > 0;

        let priorityComp = null;
        if (subjectSoldInCSP) {
          priorityComp = {
            ...subject,
            adjustments: [],
            totalAdjustment: 0,
            grossAdjustment: 0,
            grossAdjustmentPercent: 0,
            adjustedPrice: subject.values_norm_time,
            adjustmentPercent: 0,
            passesTolerance: true,
            isSubjectSale: true,
            rank: 1
          };
        }

        // RANK COMPARABLES: Sort by absolute Net Adj % (closest to 0% is best)
        validComps.sort((a, b) => {
          return Math.abs(a.adjustmentPercent) - Math.abs(b.adjustmentPercent);
        });

        // SELECT TOP 5 (or Top 4 if subject sale exists)
        const maxComps = priorityComp ? 4 : 5;
        let topComps = validComps.slice(0, maxComps);

        // Add subject sale as Comp #1 if it exists
        if (priorityComp) {
          topComps = [priorityComp, ...topComps];
        }

        // Assign ranks
        topComps.forEach((comp, idx) => {
          if (!comp.isSubjectSale) {
            comp.rank = idx + 1;
          }
        });

        // CALCULATE WEIGHTED AVERAGE
        let projectedAssessment = null;
        let confidenceScore = 0;

        if (topComps.length >= 1) {
          // Calculate weights based on closeness to 0% adjustment
          const totalInverseAdjPct = topComps.reduce((sum, comp) => {
            return sum + (1 / (Math.abs(comp.adjustmentPercent) + 1)); // +1 to avoid division by zero
          }, 0);

          topComps.forEach(comp => {
            comp.weight = (1 / (Math.abs(comp.adjustmentPercent) + 1)) / totalInverseAdjPct;
          });

          // Weighted average of adjusted prices
          projectedAssessment = topComps.reduce((sum, comp) => {
            return sum + (comp.adjustedPrice * comp.weight);
          }, 0);

          // Confidence score: 100 for 5 comps with 0% avg adjustment, decreasing from there
          const avgAdjPct = topComps.reduce((sum, c) => sum + Math.abs(c.adjustmentPercent), 0) / topComps.length;
          confidenceScore = Math.max(0, Math.min(100,
            (topComps.length / 5) * 100 - (avgAdjPct * 2)
          ));
        }

        results.push({
          subject,
          comparables: topComps,
          totalFound: matchingComps.length,
          totalValid: validComps.length,
          projectedAssessment: projectedAssessment ? Math.round(projectedAssessment) : null,
          confidenceScore: Math.round(confidenceScore),
          hasSubjectSale: !!priorityComp
        });
      }

      console.log(`✅ Processed ${results.length} properties`);
      console.log(`   - With 3+ comps: ${results.filter(r => r.comparables.length >= 3).length}`);
      console.log(`   - With 0 comps: ${results.filter(r => r.comparables.length === 0).length}`);
      console.log(`   - With projected values: ${results.filter(r => r.projectedAssessment).length}`);

      // Update progress: Start database save phase
      setEvaluationProgress({ current: subjects.length, total: subjects.length + 1 });
      console.log(`💾 Saving ${results.length} evaluations to database...`);

      // Save results to database
      const evaluationRunId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : ((r & 0x3) | 0x8);
          return v.toString(16);
        });

      for (const result of results) {
        const evaluationData = {
          job_id: jobData.id,
          evaluation_run_id: evaluationRunId,
          subject_property_id: result.subject.id,
          subject_pams: result.subject.property_composite_key,
          subject_address: result.subject.property_location,
          search_criteria: compFilters,
          comparables: result.comparables.map(comp => ({
            property_id: comp.id,
            pams_id: comp.property_composite_key,
            address: comp.property_location,
            sale_price: comp.sales_price,
            sale_date: comp.sales_date,
            time_adjusted_price: comp.values_norm_time,
            rank: comp.rank,
            is_subject_sale: comp.isSubjectSale || false,
            adjustments: comp.adjustments.reduce((obj, adj) => {
              obj[adj.name] = { amount: adj.amount, category: adj.category };
              return obj;
            }, {}),
            gross_adjustment: comp.grossAdjustment,
            net_adjustment: comp.totalAdjustment,
            net_adjustment_percent: comp.adjustmentPercent,
            gross_adjustment_percent: comp.grossAdjustmentPercent,
            adjusted_sale_price: comp.adjustedPrice,
            weight: comp.weight || 0
          })),
          projected_assessment: result.projectedAssessment,
          weighted_average_price: result.projectedAssessment,
          confidence_score: result.confidenceScore,
          status: 'pending'
        };

        const { error } = await supabase
          .from('job_cme_evaluations')
          .insert(evaluationData);

        if (error) {
          console.error('Error saving evaluation:', error);
        }
      }

      console.log(`✅ Database save complete`);

      // Update progress: Rendering results
      setEvaluationProgress({ current: subjects.length + 1, total: subjects.length + 1 });
      console.log(`📊 Rendering results table...`);

      // Set results and immediately scroll to them
      setEvaluationResults(results);

      // Calculate summary stats for console logging
      const successful = results.filter(r => r.comparables.length >= 3).length;
      const needsMoreComps = results.filter(r => r.comparables.length > 0 && r.comparables.length < 3).length;
      const noComps = results.filter(r => r.comparables.length === 0).length;

      console.log(`✅ Evaluation Complete!`);
      console.log(`   - ${successful} properties with 3-5 comps (ready to value)`);
      console.log(`   - ${needsMoreComps} properties with 1-2 comps (need more comps)`);
      console.log(`   - ${noComps} properties with 0 comps (no matches found)`);

      // Auto-scroll to results immediately
      setTimeout(() => {
        if (resultsRef.current) {
          resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);

    } catch (error) {
      console.error('❌ Error during evaluation:', error);
      console.error('Error stack:', error.stack);
      alert(
        `Evaluation failed!\n\n` +
        `Error: ${error.message}\n\n` +
        `Check the browser console for more details.`
      );
    } finally {
      setIsEvaluating(false);
      setEvaluationProgress({ current: 0, total: 0 });
    }
  };

  // ==================== GET ELIGIBLE SALES ====================
  const getEligibleSales = () => {
    if (!jobData?.end_date) return [];

    const assessmentYear = new Date(jobData.end_date).getFullYear();

    const cspStart = new Date(assessmentYear - 1, 9, 1);
    const cspEnd = new Date(assessmentYear, 11, 31);

    return properties.filter(p => {
      if (!p.sales_date || !p.values_norm_time) return false;

      const saleDate = new Date(p.sales_date);
      const inCSP = saleDate >= cspStart && saleDate <= cspEnd;

      // Check for manual override from Sales Review (property_market_analysis.cme_include_override)
      const includeOverride = p.cme_include_override; // null, true, or false

      // If override exists, respect it; otherwise use default (CSP auto-included)
      if (includeOverride === true) return true; // Manual include (even if not in CSP)
      if (includeOverride === false) return false; // Manual exclude (even if in CSP)

      // Default: Include if in CSP period
      return inCSP;
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

  // ==================== HELPER: COUNT BRT ITEMS ====================
  const countBRTItems = useCallback((property, categoryCodes) => {
    if (vendorType !== 'BRT' || !property.raw_brt_items) return 0;

    try {
      const items = JSON.parse(property.raw_brt_items);
      return items.filter(item => categoryCodes.includes(item.category)).length;
    } catch {
      return 0;
    }
  }, [vendorType]);

  // ==================== HELPER: READ MICRO VALUE ====================
  const readMicroValue = useCallback((property, fieldName) => {
    if (vendorType !== 'Microsystems') return null;
    return property[fieldName];
  }, [vendorType]);

  const calculateAdjustment = (subject, comp, adjustmentDef) => {
    if (!subject || !comp || !adjustmentDef) return 0;

    const selectedBracket = compFilters.adjustmentBracket;
    let adjustmentValue = 0;
    let adjustmentType = adjustmentDef.adjustment_type;

    // Check if using a custom bracket
    if (selectedBracket && selectedBracket.startsWith('custom_')) {
      const customBracket = customBrackets.find(b => b.bracket_id === selectedBracket);
      if (customBracket && customBracket.adjustment_values) {
        const customValue = customBracket.adjustment_values[adjustmentDef.adjustment_id];
        if (customValue) {
          adjustmentValue = customValue.value || 0;
          adjustmentType = customValue.type || adjustmentDef.adjustment_type;
        }
      }
    } else {
      // Use default bracket
      const bracketIndex = getPriceBracketIndex(comp.values_norm_time);
      adjustmentValue = adjustmentDef[`bracket_${bracketIndex}`] || 0;

      // Debug first property only
      if (!window._adjDebugLogged && adjustmentDef.adjustment_id === 'living_area') {
        console.log(`📐 Adjustment Debug (${adjustmentDef.adjustment_name}):`);
        console.log(`   - Selected bracket filter: ${compFilters.adjustmentBracket}`);
        console.log(`   - Bracket index: ${bracketIndex}`);
        console.log(`   - Looking for: bracket_${bracketIndex}`);
        console.log(`   - Adjustment value: ${adjustmentValue}`);
        console.log(`   - Adjustment grid entry:`, adjustmentDef);
        window._adjDebugLogged = true;
      }
    }

    if (adjustmentValue === 0) return 0; // No adjustment needed

    // Extract subject and comp values based on adjustment type
    let subjectValue = 0, compValue = 0;

    switch (adjustmentDef.adjustment_id) {
      case 'living_area':
        subjectValue = subject.asset_sfla || 0;
        compValue = comp.asset_sfla || 0;
        break;

      case 'bedrooms':
        // BRT: Count category 11, Micro: use bedrooms column
        if (vendorType === 'BRT') {
          subjectValue = countBRTItems(subject, ['11']);
          compValue = countBRTItems(comp, ['11']);
        } else {
          subjectValue = readMicroValue(subject, 'bedrooms') || 0;
          compValue = readMicroValue(comp, 'bedrooms') || 0;
        }
        break;

      case 'bathrooms':
        subjectValue = subject.total_baths_calculated || 0;
        compValue = comp.total_baths_calculated || 0;
        break;

      case 'garage':
        // BRT: Count category 15, Micro: use garage column
        if (vendorType === 'BRT') {
          subjectValue = countBRTItems(subject, ['15']);
          compValue = countBRTItems(comp, ['15']);
        } else {
          subjectValue = readMicroValue(subject, 'garage') || 0;
          compValue = readMicroValue(comp, 'garage') || 0;
        }
        break;

      case 'basement':
        if (vendorType === 'Microsystems') {
          subjectValue = readMicroValue(subject, 'basement') || 0;
          compValue = readMicroValue(comp, 'basement') || 0;
        }
        break;

      case 'deck':
        if (vendorType === 'Microsystems') {
          subjectValue = readMicroValue(subject, 'deck') || 0;
          compValue = readMicroValue(comp, 'deck') || 0;
        }
        break;

      case 'patio':
        if (vendorType === 'Microsystems') {
          subjectValue = readMicroValue(subject, 'patio') || 0;
          compValue = readMicroValue(comp, 'patio') || 0;
        }
        break;

      case 'lot_size_ff':
        subjectValue = subject.asset_lot_frontage || 0;
        compValue = comp.asset_lot_frontage || 0;
        break;

      case 'lot_size_sf':
        subjectValue = subject.asset_lot_sf || 0;
        compValue = comp.asset_lot_sf || 0;
        break;

      case 'lot_size_acre':
        subjectValue = subject.asset_lot_acre || 0;
        compValue = comp.asset_lot_acre || 0;
        break;

      case 'year_built':
        subjectValue = subject.asset_year_built || 0;
        compValue = comp.asset_year_built || 0;
        break;

      default:
        return 0; // Unknown attribute
    }

    const difference = subjectValue - compValue;

    // Apply adjustment based on type
    // Rule: Subject Better = ADD to comp price; Comp Better = SUBTRACT from comp price
    switch (adjustmentType) {
      case 'flat':
        return difference > 0 ? adjustmentValue : (difference < 0 ? -adjustmentValue : 0);

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
    { id: 'search', label: 'Search & Results', icon: Search },
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

              {/* Auto-Include Logic Info */}
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>Auto-Include Logic:</strong> CSP period sales (10/1 prior-prior year to 12/31 prior year) are automatically included.
                  Use <span className="inline-flex items-center mx-1"><Check className="w-3 h-3 text-green-600" /></span> and <span className="inline-flex items-center mx-1"><X className="w-3 h-3 text-red-600" /></span> buttons
                  in <strong>Sales Review</strong> tab to manually override.
                </p>
              </div>

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

              {/* Adjustment Grid Warning */}
              {adjustmentGrid.length === 0 && (
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-yellow-600">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-yellow-900 mb-1">
                        No Adjustment Grid Configured
                      </h4>
                      <p className="text-sm text-yellow-800 mb-2">
                        All comparable adjustments will be <strong>$0</strong> until you configure adjustment values.
                      </p>
                      <p className="text-xs text-yellow-700">
                        <strong>To fix:</strong> Go to the <button onClick={() => setActiveSubTab('adjustments')} className="underline font-semibold hover:text-yellow-900">Adjustments tab</button>,
                        review the default values, make any changes, and click <strong>"Save Adjustments"</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Evaluate Button */}
              <div className="mt-6 pt-6 border-t border-gray-300">
                <div className="flex items-center justify-between mb-4">
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
                    {isEvaluating
                      ? `Evaluating ${evaluationProgress.current}/${evaluationProgress.total}...`
                      : 'Evaluate'
                    }
                  </button>
                </div>

                {/* Progress Bar */}
                {isEvaluating && evaluationProgress.total > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm font-semibold text-blue-700 mb-2">
                      <span>
                        {evaluationProgress.current > evaluationProgress.total - 1
                          ? 'Saving and rendering results...'
                          : `Evaluating ${evaluationProgress.current} of ${evaluationProgress.total} properties`}
                      </span>
                      <span>{Math.round((evaluationProgress.current / evaluationProgress.total) * 100)}% Complete</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3 shadow-inner">
                      <div
                        className="bg-blue-600 h-3 rounded-full transition-all duration-150 ease-out"
                        style={{
                          width: `${Math.min(100, (evaluationProgress.current / evaluationProgress.total) * 100)}%`
                        }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* INLINE RESULTS - Show directly below search filters */}
            {evaluationResults && (
              <div ref={resultsRef} className="mt-6 bg-white border border-gray-300 rounded-lg p-4">
                {/* Summary Statistics */}
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-semibold text-gray-700">Total Evaluated:</span>
                      <span className="ml-2 text-gray-900">{evaluationResults.length} properties</span>
                    </div>
                    <div>
                      <span className="font-semibold text-red-700">No Comparables:</span>
                      <span className="ml-2 text-red-900 font-bold">
                        {evaluationResults.filter(r => r.comparables.length === 0).length} of {evaluationResults.length}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-green-700">With {minCompsForSuccess}+ Comps:</span>
                      <span className="ml-2 text-green-900 font-bold">
                        {evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess).length} of {evaluationResults.length}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Evaluation Results
                  </h3>
                  <div className="flex items-center gap-3">
                    {/* Minimum Comps Selector */}
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Min Comps:</label>
                      <select
                        value={minCompsForSuccess}
                        onChange={(e) => setMinCompsForSuccess(parseInt(e.target.value))}
                        className="px-3 py-1.5 border border-gray-300 rounded text-sm"
                      >
                        <option value="1">1+</option>
                        <option value="2">2+</option>
                        <option value="3">3+</option>
                        <option value="4">4+</option>
                        <option value="5">5</option>
                      </select>
                    </div>
                    <button
                      onClick={handleSetAsideSuccessful}
                      disabled={!evaluationResults || evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess).length === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      Set Aside ({evaluationResults ? evaluationResults.filter(r => r.comparables.length >= minCompsForSuccess).length : 0})
                    </button>
                    <button
                      onClick={handleApplyToFinalRoster}
                      disabled={!evaluationResults || evaluationResults.filter(r => r.projectedAssessment).length === 0}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      Apply to Final Roster
                    </button>
                  </div>
                </div>

                {/* Results Table - Legacy Format */}
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="bg-gray-100">
                      <tr>
                        {/* Subject Property Info */}
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">VCS</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">Block</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">Lot</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">Qual</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">Location</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">TypeUse</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-left font-semibold">Style</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-right font-semibold bg-yellow-50">Current Asmt</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-right font-semibold bg-green-50">New Asmt</th>
                        <th rowSpan="2" className="border border-gray-300 px-2 py-2 text-right font-semibold bg-blue-50">%Change</th>
                        {/* Comparable Columns */}
                        {[1, 2, 3, 4, 5].map(num => (
                          <th key={num} colSpan="2" className="border border-gray-300 px-2 py-2 text-center font-semibold bg-blue-50">
                            Comparable {num}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {/* Sub-headers for each comparable */}
                        {[1, 2, 3, 4, 5].map(num => (
                          <React.Fragment key={num}>
                            <th className="border border-gray-300 px-2 py-1 text-center text-xs font-medium">BLQ</th>
                            <th className="border border-gray-300 px-2 py-1 text-center text-xs font-medium">Adjusted Value</th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {evaluationResults.map((result, idx) => {
                        // Decode Type Use and Style codes
                        const typeUseDecoded = codeDefinitions
                          ? interpretCodes.getTypeName(result.subject, codeDefinitions, vendorType)
                          : result.subject.asset_type_use;
                        const styleDecoded = codeDefinitions
                          ? interpretCodes.getDesignName(result.subject, codeDefinitions, vendorType)
                          : result.subject.asset_design_style;

                        // Format decoded values with code
                        const typeUseDisplay = typeUseDecoded && typeUseDecoded !== result.subject.asset_type_use
                          ? `${result.subject.asset_type_use}-${typeUseDecoded}`
                          : result.subject.asset_type_use || '';
                        const styleDisplay = styleDecoded && styleDecoded !== result.subject.asset_design_style
                          ? `${result.subject.asset_design_style}-${styleDecoded}`
                          : result.subject.asset_design_style || '';

                        return (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            {/* Subject Property Info */}
                            <td className="border border-gray-300 px-2 py-2 text-sm">{result.subject.property_vcs}</td>
                            <td className="border border-gray-300 px-2 py-2 text-sm font-medium">{result.subject.property_block}</td>
                            <td className="border border-gray-300 px-2 py-2 text-sm font-medium">{result.subject.property_lot}</td>
                            <td className="border border-gray-300 px-2 py-2 text-sm">{result.subject.property_qualifier || ''}</td>
                            <td className="border border-gray-300 px-2 py-2 text-xs max-w-xs truncate">{result.subject.property_location || ''}</td>
                            <td className="border border-gray-300 px-2 py-2 text-xs">{typeUseDisplay}</td>
                            <td className="border border-gray-300 px-2 py-2 text-xs">{styleDisplay}</td>
                            <td className="border border-gray-300 px-2 py-2 text-right text-sm font-semibold bg-yellow-50">
                              ${(result.subject.values_mod_total || result.subject.values_cama_total || 0).toLocaleString()}
                            </td>
                            <td
                              className="border border-gray-300 px-2 py-2 text-right text-sm font-bold bg-green-50 text-green-700 cursor-pointer hover:underline"
                              onClick={() => {
                                setSelectedPropertyForDetail(result);
                                setActiveSubTab('detailed');
                              }}
                              title="Click to view detailed analysis"
                            >
                              {result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-'}
                            </td>
                            <td className="border border-gray-300 px-2 py-2 text-right text-sm font-semibold bg-blue-50">
                              {(() => {
                                const currentAsmt = result.subject.values_mod_total || result.subject.values_cama_total || 0;
                                const newAsmt = result.projectedAssessment;
                                if (!newAsmt || currentAsmt === 0) return '-';
                                const changePercent = ((newAsmt - currentAsmt) / currentAsmt) * 100;
                                const color = changePercent > 0 ? 'text-green-700' : changePercent < 0 ? 'text-red-700' : 'text-gray-700';
                                return (
                                  <span className={color}>
                                    {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                  </span>
                                );
                              })()}
                            </td>
                            {/* Comparables 1-5 */}
                            {[0, 1, 2, 3, 4].map(compIdx => {
                              const comp = result.comparables[compIdx];
                              if (!comp) {
                                return (
                                  <React.Fragment key={compIdx}>
                                    <td className="border border-gray-300 px-2 py-2 text-center text-xs text-red-600 font-semibold">NO COMPS</td>
                                    <td className="border border-gray-300 px-2 py-2 text-center text-xs text-red-600 font-semibold">$0</td>
                                  </React.Fragment>
                                );
                              }
                              // Format BLQ with / separator and preserve full values
                              const blqFormatted = `${comp.property_block}/${comp.property_lot}${comp.property_qualifier && comp.property_qualifier !== 'NONE' ? `/${comp.property_qualifier}` : ''}`;

                              return (
                                <React.Fragment key={compIdx}>
                                  <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                                    {blqFormatted}
                                  </td>
                                  <td className="border border-gray-300 px-2 py-2 text-right text-xs font-semibold">
                                    ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Detailed Comparable Breakdown */}
                <div className="mt-8 space-y-6">
                  <h4 className="text-lg font-semibold text-gray-900">Comparable Details</h4>
                  {evaluationResults.map((result, resultIdx) => (
                    <div key={resultIdx} className="border border-gray-300 rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-gray-900">
                            Subject: <span className="text-blue-600">{result.subject.property_vcs}</span> | Block {result.subject.property_block} | Lot {result.subject.property_lot}{result.subject.property_qualifier ? ` | Qual ${result.subject.property_qualifier}` : ''}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            {result.subject.property_location} • {result.subject.asset_type_use} • {result.subject.asset_sfla?.toLocaleString()} SF
                          </div>
                        </div>
                        {result.projectedAssessment && (
                          <div className="text-right">
                            <div className="text-xs text-gray-600">Projected Assessment</div>
                            <div className="text-xl font-bold text-green-700">
                              ${result.projectedAssessment.toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>

                      {result.comparables.length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-500">
                          No valid comparables found
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Rank</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-700">Comparable</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Sale Price</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Time Adj</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Net Adj</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Net Adj %</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Adjusted Price</th>
                                <th className="px-3 py-2 text-right font-medium text-gray-700">Weight</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {result.comparables.map((comp, compIdx) => (
                                <tr key={compIdx} className={comp.isSubjectSale ? 'bg-green-50' : 'hover:bg-gray-50'}>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                      comp.rank === 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                                    }`}>
                                      {comp.rank}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-gray-900">
                                      {comp.property_block}-{comp.property_lot}-{comp.property_qualifier}
                                    </div>
                                    <div className="text-gray-600">{comp.property_location}</div>
                                    {comp.isSubjectSale && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-200 text-green-900">
                                        Subject Sale (Auto Comp #1)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-700">
                                    ${comp.sales_price?.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-700">
                                    ${comp.values_norm_time?.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={comp.totalAdjustment >= 0 ? 'text-green-700' : 'text-red-700'}>
                                      {comp.totalAdjustment >= 0 ? '+' : ''}${comp.totalAdjustment?.toLocaleString()}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <span className={`font-semibold ${
                                      Math.abs(comp.adjustmentPercent) < 5 ? 'text-green-700' :
                                      Math.abs(comp.adjustmentPercent) < 15 ? 'text-yellow-700' :
                                      'text-red-700'
                                    }`}>
                                      {comp.adjustmentPercent >= 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(2)}%
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-gray-900">
                                    ${comp.adjustedPrice?.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-700">
                                    {(comp.weight * 100)?.toFixed(1)}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}


        {/* DETAILED TAB */}
        {activeSubTab === 'detailed' && (
          <div className="space-y-6">
            {!selectedPropertyForDetail && !evaluationResults ? (
              <div className="bg-white border border-gray-300 rounded-lg p-12 text-center">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Property Selected</h3>
                <p className="text-sm text-gray-600">
                  Run an evaluation from the Search tab, then click on a "New Asmt" value to view detailed analysis.
                </p>
              </div>
            ) : (
              (() => {
                // Use selected property or first evaluation result
                const result = selectedPropertyForDetail || (evaluationResults && evaluationResults[0]);

                if (!result) {
                  return (
                    <div className="bg-white border border-gray-300 rounded-lg p-12 text-center">
                      <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No Data Available</h3>
                      <p className="text-sm text-gray-600">Run an evaluation to see detailed analysis.</p>
                    </div>
                  );
                }

                const subject = result.subject;
                const comps = result.comparables || [];

                return (
                  <div>
                    {/* Header */}
                    <div className="bg-white border border-gray-300 rounded-lg p-6 mb-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">Detailed Appraisal Analysis</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            Subject: <span className="font-semibold">{subject.property_vcs}</span> | Block {subject.property_block} | Lot {subject.property_lot}
                          </p>
                        </div>
                        {evaluationResults && evaluationResults.length > 1 && (
                          <select
                            value={evaluationResults.indexOf(result)}
                            onChange={(e) => {
                              setSelectedPropertyForDetail(evaluationResults[parseInt(e.target.value)]);
                            }}
                            className="px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                          >
                            {evaluationResults.map((r, idx) => (
                              <option key={idx} value={idx}>
                                {r.subject.property_block}-{r.subject.property_lot} | {r.subject.property_location}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Summary Stats */}
                      <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                        <div>
                          <div className="text-xs text-gray-600">Current Assessment</div>
                          <div className="text-lg font-bold text-gray-900">
                            ${(subject.values_mod_total || subject.values_cama_total || 0).toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600">New Assessment</div>
                          <div className="text-lg font-bold text-green-700">
                            {result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600">Change</div>
                          <div className="text-lg font-bold">
                            {(() => {
                              const current = subject.values_mod_total || subject.values_cama_total || 0;
                              const projected = result.projectedAssessment;
                              if (!projected || current === 0) return 'N/A';
                              const changePercent = ((projected - current) / current) * 100;
                              const color = changePercent > 0 ? 'text-green-700' : changePercent < 0 ? 'text-red-700' : 'text-gray-700';
                              return (
                                <span className={color}>
                                  {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-600">Comparables Found</div>
                          <div className="text-lg font-bold text-blue-700">{comps.length} / 5</div>
                        </div>
                      </div>
                    </div>

                    {comps.length === 0 ? (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
                        <p className="text-yellow-900 font-semibold mb-2">No Comparables Found</p>
                        <p className="text-sm text-yellow-700">
                          Adjust your search criteria to find matching properties.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Appraisal Grid */}
                        <div className="bg-white border border-gray-300 rounded-lg overflow-hidden mb-6">
                          <div className="bg-blue-600 px-4 py-3">
                            <h4 className="font-semibold text-white">Comparable Sales Appraisal Grid</h4>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-xs border-collapse">
                              <thead>
                                <tr className="bg-gray-100 border-b-2 border-gray-300">
                                  <th className="sticky left-0 z-10 bg-gray-100 px-3 py-3 text-left font-semibold text-gray-700 border-r-2 border-gray-300">
                                    Attribute
                                  </th>
                                  <th className="px-3 py-3 text-center font-semibold bg-yellow-50">
                                    Subject<br/>
                                    <span className="font-normal text-xs text-gray-600">
                                      {subject.property_block}/{subject.property_lot}
                                    </span>
                                  </th>
                                  {comps.map((comp, idx) => (
                                    <th key={idx} className="px-3 py-3 text-center font-semibold bg-blue-50 border-l border-gray-300">
                                      Comp #{comp.rank}<br/>
                                      <span className="font-normal text-xs text-gray-600">
                                        {comp.property_block}/{comp.property_lot}
                                      </span>
                                      {comp.isSubjectSale && (
                                        <span className="block text-xs text-green-700 font-semibold mt-1">(Subject Sale)</span>
                                      )}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                {/* VCS */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    VCS
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold text-xs">{subject.property_vcs || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 font-semibold text-xs">
                                      {comp.property_vcs || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Block/Lot/Qual */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Block/Lot/Qual
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold text-xs">
                                    {subject.property_block}/{subject.property_lot}/{subject.property_qualifier || ''}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 font-semibold text-xs">
                                      {comp.property_block}/{comp.property_lot}/{comp.property_qualifier || ''}
                                    </td>
                                  ))}
                                </tr>

                                {/* Address */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Location
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.property_location || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.property_location || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Prev. Assessment */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Prev. Assessment
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">
                                    ${(subject.values_mod_total || subject.values_cama_total || 0).toLocaleString()}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 font-semibold">
                                      ${(comp.values_mod_total || comp.values_cama_total || 0).toLocaleString()}
                                    </td>
                                  ))}
                                </tr>

                                {/* Property Class */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Property Class
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.property_class || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.property_class || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Building Class */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Building Class
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                                    {subject.asset_building_class ? `${subject.asset_building_class} (QUALITY ${subject.asset_building_class})` : 'N/A'}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.asset_building_class ? `${comp.asset_building_class} (QUALITY ${comp.asset_building_class})` : 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Style Code */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Style Code
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                                    {subject.asset_design_style ? (
                                      codeDefinitions ? interpretCodes.getDesignName(subject, codeDefinitions, vendorType)
                                        ? `${subject.asset_design_style} (${interpretCodes.getDesignName(subject, codeDefinitions, vendorType)})`
                                        : subject.asset_design_style
                                      : subject.asset_design_style
                                    ) : 'N/A'}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.asset_design_style ? (
                                        codeDefinitions ? interpretCodes.getDesignName(comp, codeDefinitions, vendorType)
                                          ? `${comp.asset_design_style} (${interpretCodes.getDesignName(comp, codeDefinitions, vendorType)})`
                                          : comp.asset_design_style
                                        : comp.asset_design_style
                                      ) : 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Type/Use Code */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Type/Use Code
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                                    {subject.asset_type_use ? (
                                      codeDefinitions ? interpretCodes.getTypeName(subject, codeDefinitions, vendorType)
                                        ? `${subject.asset_type_use} (${interpretCodes.getTypeName(subject, codeDefinitions, vendorType)})`
                                        : subject.asset_type_use
                                      : subject.asset_type_use
                                    ) : 'N/A'}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.asset_type_use ? (
                                        codeDefinitions ? interpretCodes.getTypeName(comp, codeDefinitions, vendorType)
                                          ? `${comp.asset_type_use} (${interpretCodes.getTypeName(comp, codeDefinitions, vendorType)})`
                                          : comp.asset_type_use
                                        : comp.asset_type_use
                                      ) : 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Story Height Code */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Story Height Code
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_story_height || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.asset_story_height || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* View Code */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    View Code
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_view || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.asset_view || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Sales Code */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Sales Code
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.sales_nu || '0'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.sales_nu || '0'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Sales Date */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Sales Date
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.sales_date || 'N/A'}</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                                      {comp.sales_date || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Sale Price */}
                                <tr className="border-b hover:bg-gray-50 bg-green-50">
                                  <td className="sticky left-0 z-10 bg-green-50 px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Sale Price
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">
                                    {subject.sales_price ? `$${subject.sales_price.toLocaleString()}` : 'N/A'}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 font-semibold">
                                      ${comp.sales_price?.toLocaleString() || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Time Adjusted Price */}
                                <tr className="border-b hover:bg-gray-50 bg-green-50">
                                  <td className="sticky left-0 z-10 bg-green-50 px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Time Adjusted Price
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">
                                    {subject.values_norm_time ? `$${subject.values_norm_time.toLocaleString()}` : 'N/A'}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 font-semibold">
                                      ${comp.values_norm_time?.toLocaleString() || 'N/A'}
                                    </td>
                                  ))}
                                </tr>

                                {/* Living Area */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Living Area (SF)
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.asset_sfla?.toLocaleString() || 'N/A'}</td>
                                  {comps.map((comp, idx) => {
                                    const diff = (subject.asset_sfla || 0) - (comp.asset_sfla || 0);
                                    const adj = comp.adjustments?.find(a => a.name === 'Living Area (Sq Ft)');
                                    return (
                                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                                        <div className="font-semibold">{comp.asset_sfla?.toLocaleString() || 'N/A'}</div>
                                        {adj && (
                                          <div className={`text-xs font-semibold ${adj.amount > 0 ? 'text-green-700' : adj.amount < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                            {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                                            <div className="text-xs text-gray-600">({diff > 0 ? '+' : ''}{diff} SF)</div>
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* Year Built */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Year Built
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.asset_year_built || 'N/A'}</td>
                                  {comps.map((comp, idx) => {
                                    const diff = (subject.asset_year_built || 0) - (comp.asset_year_built || 0);
                                    const adj = comp.adjustments?.find(a => a.name === 'Year Built');
                                    return (
                                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                                        <div className="font-semibold">{comp.asset_year_built || 'N/A'}</div>
                                        {adj && adj.amount !== 0 && (
                                          <div className={`text-xs font-semibold ${adj.amount > 0 ? 'text-green-700' : adj.amount < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                            {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                                            <div className="text-xs text-gray-600">({diff > 0 ? '+' : ''}{diff} yrs)</div>
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* Bathrooms */}
                                <tr className="border-b hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                    Bathrooms
                                  </td>
                                  <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.total_baths_calculated || 'N/A'}</td>
                                  {comps.map((comp, idx) => {
                                    const diff = (subject.total_baths_calculated || 0) - (comp.total_baths_calculated || 0);
                                    const adj = comp.adjustments?.find(a => a.name === 'Bathrooms');
                                    return (
                                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                                        <div className="font-semibold">{comp.total_baths_calculated || 'N/A'}</div>
                                        {adj && adj.amount !== 0 && (
                                          <div className={`text-xs font-semibold ${adj.amount > 0 ? 'text-green-700' : adj.amount < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                            {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                                            <div className="text-xs text-gray-600">({diff > 0 ? '+' : ''}{diff})</div>
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>

                                {/* Other adjustments */}
                                {adjustmentGrid.map((adjDef, adjIdx) => {
                                  // Skip already shown attributes
                                  if (['Living Area (Sq Ft)', 'Year Built', 'Bathrooms'].includes(adjDef.adjustment_name)) {
                                    return null;
                                  }

                                  // Only show if at least one comp has non-zero adjustment
                                  const hasAdjustments = comps.some(comp => {
                                    const adj = comp.adjustments?.find(a => a.name === adjDef.adjustment_name);
                                    return adj && adj.amount !== 0;
                                  });

                                  if (!hasAdjustments) return null;

                                  return (
                                    <tr key={adjIdx} className="border-b hover:bg-gray-50">
                                      <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                                        {adjDef.adjustment_name}
                                      </td>
                                      <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">-</td>
                                      {comps.map((comp, idx) => {
                                        const adj = comp.adjustments?.find(a => a.name === adjDef.adjustment_name);
                                        return (
                                          <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                                            {adj && adj.amount !== 0 ? (
                                              <div className={`text-xs font-semibold ${adj.amount > 0 ? 'text-green-700' : adj.amount < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                                                {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                                              </div>
                                            ) : (
                                              <span className="text-gray-400">$0</span>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}

                                {/* Total Adjustment */}
                                <tr className="border-b-2 border-gray-400 bg-gray-100 font-bold">
                                  <td className="sticky left-0 z-10 bg-gray-100 px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                                    Total Adjustment
                                  </td>
                                  <td className="px-3 py-3 text-center bg-yellow-50">-</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-3 text-center bg-blue-50 border-l border-gray-300">
                                      <div className={`font-bold ${comp.totalAdjustment > 0 ? 'text-green-700' : comp.totalAdjustment < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                                        {comp.totalAdjustment > 0 ? '+' : ''}${comp.totalAdjustment?.toLocaleString() || '0'}
                                      </div>
                                      <div className={`text-xs font-semibold ${Math.abs(comp.adjustmentPercent) < 5 ? 'text-green-600' : Math.abs(comp.adjustmentPercent) < 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(2)}%)
                                      </div>
                                    </td>
                                  ))}
                                </tr>

                                {/* Adjusted Sale Price */}
                                <tr className="bg-green-100 border-b-2 border-green-400">
                                  <td className="sticky left-0 z-10 bg-green-100 px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                                    Adjusted Sale Price
                                  </td>
                                  <td className="px-3 py-3 text-center bg-yellow-50">-</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-3 text-center bg-green-50 border-l border-gray-300">
                                      <div className="text-lg font-bold text-green-700">
                                        ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                                      </div>
                                    </td>
                                  ))}
                                </tr>

                                {/* Net Adjustment (matches PDF format) */}
                                <tr className="bg-gray-100 border-b-2 border-gray-400">
                                  <td className="sticky left-0 z-10 bg-gray-100 px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                                    Net Adjustment
                                  </td>
                                  <td className="px-3 py-3 text-center bg-yellow-50">-</td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-3 text-center bg-blue-50 border-l border-gray-300">
                                      <div className={`font-bold ${comp.totalAdjustment > 0 ? 'text-green-700' : comp.totalAdjustment < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                                        {comp.totalAdjustment > 0 ? '+' : ''}${comp.totalAdjustment?.toLocaleString() || '0'} ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(0) || '0'}%)
                                      </div>
                                    </td>
                                  ))}
                                </tr>

                                {/* Adjusted Valuation (final row with projected assessment) */}
                                <tr className="bg-yellow-100 border-b-4 border-yellow-500">
                                  <td className="sticky left-0 z-10 bg-yellow-100 px-3 py-4 font-bold text-gray-900 border-r-2 border-gray-300 text-lg">
                                    Adjusted Valuation
                                  </td>
                                  <td className="px-3 py-4 text-center bg-yellow-50">
                                    {result.projectedAssessment && (
                                      <div>
                                        <div className="text-xl font-bold text-green-700">
                                          ${result.projectedAssessment.toLocaleString()}
                                        </div>
                                        <div className="text-sm font-semibold text-green-600">
                                          {(() => {
                                            const current = subject.values_mod_total || subject.values_cama_total || 0;
                                            if (current === 0) return '';
                                            const changePercent = ((result.projectedAssessment - current) / current) * 100;
                                            return `(${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`;
                                          })()}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                  {comps.map((comp, idx) => (
                                    <td key={idx} className="px-3 py-4 text-center bg-blue-50 border-l border-gray-300">
                                      <div className="font-bold text-gray-700">
                                        ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                                      </div>
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Weighted Average Calculation */}
                        {result.projectedAssessment && (
                          <div className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-400 rounded-lg p-6">
                            <h4 className="font-bold text-lg text-gray-900 mb-4">Weighted Average Calculation</h4>
                            <div className="space-y-2 text-sm">
                              {comps.map((comp, idx) => {
                                const weightedValue = (comp.adjustedPrice || 0) * (comp.weight || 0);
                                return (
                                  <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-200">
                                    <span className="text-gray-700">
                                      Comp #{comp.rank}: ${Math.round(comp.adjustedPrice || 0).toLocaleString()} × {((comp.weight || 0) * 100).toFixed(2)}%
                                    </span>
                                    <span className="font-semibold text-gray-900">
                                      = ${Math.round(weightedValue).toLocaleString()}
                                    </span>
                                  </div>
                                );
                              })}
                              <div className="flex items-center justify-between py-3 mt-2 border-t-2 border-green-400">
                                <span className="font-bold text-lg text-gray-900">
                                  Projected Assessment:
                                </span>
                                <span className="font-bold text-2xl text-green-700">
                                  ${result.projectedAssessment.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {comps.length > 0 && comps.length < 3 && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
                            <h4 className="font-semibold text-blue-900 mb-2">Limited Comparables</h4>
                            <p className="text-sm text-blue-700">
                              This property has {comps.length} comparable{comps.length !== 1 ? 's' : ''}.
                              For higher confidence, consider broadening search criteria to find 3-5 comparables.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()
            )}
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
