import React, { useState, useEffect, useRef } from 'react';
import { 
  AlertCircle, 
  RefreshCw,
  Download,
  Check,
  X,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase, interpretCodes } from '../../../lib/supabaseClient';

const DataQualityTab = ({ 
  // Props from parent
  properties,
  jobData,
  vendorType,
  codeDefinitions,
  availableFields
}) => {
  // ==================== INTERNAL STATE MANAGEMENT ====================
  const [checkResults, setCheckResults] = useState({});
  const [qualityScore, setQualityScore] = useState(null);
  const [issueStats, setIssueStats] = useState({
    critical: 0,
    warning: 0,
    info: 0,
    total: 0
  });
  const [customChecks, setCustomChecks] = useState([]);
  const [currentCustomCheck, setCurrentCustomCheck] = useState({
    conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
  });
  const [runHistory, setRunHistory] = useState([]);
  const [dataQualityActiveSubTab, setDataQualityActiveSubTab] = useState('overview');
  const [expandedCategories, setExpandedCategories] = useState(['mod_iv']);
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [modalData, setModalData] = useState({ title: '', properties: [] });
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [templateLibrary, setTemplateLibrary] = useState([
    {
      category: 'BRT Validation',
      templates: [
        {
          id: 'tpl_sf_building',
          name: 'Single Family Building Class',
          severity: 'critical',
          conditions: [
            { logic: 'IF', field: 'asset_type_use', operator: '=', value: '1' },
            { logic: 'AND', field: 'asset_building_class', operator: 'is not one of', value: '16,17,18,19,20,21,22,23' }
          ]
        },
        {
          id: 'tpl_mf_building',
          name: 'Multi Family Building Class',
          severity: 'critical',
          conditions: [
            { logic: 'IF', field: 'asset_type_use', operator: 'is one of', value: '42,43,44' },
            { logic: 'AND', field: 'asset_building_class', operator: 'is not one of', value: '43,45,47,49' }
          ]
        }
      ]
    },
    {
      category: 'Data Integrity',
      templates: [
        {
          id: 'tpl_missing_design',
          name: 'Missing Design Style',
          severity: 'warning',
          conditions: [
            { logic: 'IF', field: 'asset_building_class', operator: '>', value: '10' },
            { logic: 'AND', field: 'asset_design_style', operator: 'is null', value: '' }
          ]
        }
      ]
    }
  ]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Refs for uncontrolled inputs
  const customCheckNameInputRef = useRef(null);
  const customCheckSeveritySelectRef = useRef(null);

  // Load saved data on mount
  useEffect(() => {
    const loadSavedData = async () => {
      if (!jobData?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('market_land_valuation')
          .select('*')
          .eq('job_id', jobData.id)
          .single();
        
        if (data) {
          // Load run history
          if (data.quality_check_results?.history) {
            setRunHistory(data.quality_check_results.history);
          }
          
          // Load custom checks
          if (data.custom_checks) {
            setCustomChecks(data.custom_checks);
          }
          
          // Load quality score
          if (data.quality_score) {
            setQualityScore(data.quality_score);
          }
        }
      } catch (error) {
        console.error('Error loading saved data:', error);
      }
    };
    
    loadSavedData();
  }, [jobData?.id]);

  // ESC key handler for modal
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowDetailsModal(false);
      }
    };
    
    if (showDetailsModal) {
      window.addEventListener('keydown', handleEsc);
      return () => {
        window.removeEventListener('keydown', handleEsc);
      };
    }
  }, [showDetailsModal]);  
  

  // ==================== DATA QUALITY FUNCTIONS ====================
  const exportToExcel = () => {
    if (Object.keys(checkResults).length === 0) return;
    
    const wb = XLSX.utils.book_new();
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    // SUMMARY SHEET
    const summaryData = [
      ['Data Quality Summary Report'],
      [],
      ['Job Information'],
      ['Job Number', jobData?.job_number || 'N/A'],
      ['Municipality', jobData?.municipality || 'N/A'],
      ['County', jobData?.county || 'N/A'],
      ['State', jobData?.state || 'N/A'],
      ['Analysis Date', new Date().toLocaleDateString()],
      [],
      ['Overall Metrics'],
      ['Total Properties', properties.length],
      ['Properties with Issues', issueStats.total],
      ['Critical Issues', issueStats.critical],
      ['Warnings', issueStats.warning],
      ['Info Messages', issueStats.info],
      ['Quality Score', `${qualityScore}%`],
      [],
      ['Issues by Category'],
      ['Category', 'Critical', 'Warning', 'Info', 'Total']
    ];
    
    Object.entries(checkResults).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        const critical = issues.filter(i => i.severity === 'critical').length;
        const warning = issues.filter(i => i.severity === 'warning').length;
        const info = issues.filter(i => i.severity === 'info').length;
        summaryData.push([
          category.replace(/_/g, ' ').toUpperCase(),
          critical,
          warning,
          info,
          issues.length
        ]);
      }
    });
    
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [
      { wch: 35 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ];
    
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    
    // DETAILS SHEET
    const detailsData = [
      ['Block', 'Lot', 'Qualifier', 'Card', 'Location', 'Class', 'Check Type', 'Severity', 'Message']
    ];
    
    Object.entries(checkResults).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        issues.forEach(issue => {
          const property = properties.find(p => p.property_composite_key === issue.property_key);
          
          if (property) {
            detailsData.push([
              property.property_block || '',
              property.property_lot || '',
              property.property_qualifier || '',
              property.property_card || '',
              property.property_location || '',
              property.property_m4_class || '',
              getCheckTitle(issue.check),
              issue.severity,
              issue.message
            ]);
          } else {
            // Fallback if property not found - parse the composite key
            // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
            const mainParts = issue.property_key.split('-');
            const block = mainParts[1] || '';
            const lotQual = mainParts[2] || '';
            const [lot, qualifier] = lotQual.split('_');
            const card = mainParts[3] || '';
            const location = mainParts[4] || '';
            
            detailsData.push([
              block,
              lot || '',
              qualifier || '',
              card,
              location,
              '',
              getCheckTitle(issue.check),
              issue.severity,
              issue.message
            ]);
          }
        });
      }
    });
    
    const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);
    detailsSheet['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 20 },
      { wch: 10 },
      { wch: 45 },
      { wch: 12 },
      { wch: 60 }
    ];
    
    const range = XLSX.utils.decode_range(detailsSheet['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_col(C) + "1";
      if (!detailsSheet[address]) continue;
      detailsSheet[address].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: "EEEEEE" } }
      };
    }
    
    XLSX.utils.book_append_sheet(wb, detailsSheet, 'Details');
    XLSX.writeFile(wb, `DQ_Report_${jobInfo}_${timestamp}.xlsx`);
    
    console.log('✅ Excel report exported successfully');
  };
  
  const runQualityChecks = async () => {
    setIsRunningChecks(true);
    const results = {
      mod_iv: [],
      cama: [],
      characteristics: [],
      special: [],
      rooms: [],
      custom: []
    };
    
    try {
      const vendor = vendorType || jobData.vendor_source || 'BRT';
      
      const pageSize = 1000;
      const totalPages = Math.ceil(properties.length / pageSize);
      
      for (let page = 0; page < totalPages; page++) {
        const batch = properties.slice(page * pageSize, (page + 1) * pageSize);
        console.log(`Processing batch ${page + 1} of ${totalPages}...`);
        
        for (const property of batch) {
          await runPropertyChecks(property, results);
        }
      }

      console.log('=== QUALITY CHECK COMPLETE ===');
      console.log(`Total properties analyzed: ${properties.length}`);
      console.log('Issues found by category:');
      Object.entries(results).forEach(([category, issues]) => {
        console.log(`  ${category}: ${issues.length} issues`);
        if (category === 'special' && issues.length > 0) {
          const specialTypes = [...new Set(issues.map(i => i.check))];
          specialTypes.forEach(type => {
            const count = issues.filter(i => i.check === type).length;
            console.log(`    - ${type}: ${count} properties`);
          });
        }
      });
      
      // Run all custom checks automatically
      if (customChecks.length > 0) {
        console.log(`Running ${customChecks.length} custom checks...`);
        
        // Reset custom results first
        setCheckResults(prev => ({ ...prev, custom: [] }));
        
        // Run each custom check
        for (const check of customChecks) {
          await runCustomCheck(check);
        }
      }
      
      await saveQualityResults(results);
      
      const score = calculateQualityScore(results);
      setQualityScore(score);
      setCheckResults(results);
     
      console.log('Quality check complete!');
    } catch (error) {
      console.error('Error running quality checks:', error);
    } finally {
      setIsRunningChecks(false);
    }
  };

  const runPropertyChecks = async (property, results) => {
    const vendor = property.vendor_source || jobData.vendor_source || 'BRT';
    const rawData = property.raw_data || {};
    
    // MOD IV CHECKS
    const m4Class = property.property_m4_class;
    const modImprovement = property.values_mod_improvement || 0;
    const modLand = property.values_mod_land || 0;
    const modTotal = property.values_mod_total || 0;
    
    if ((m4Class === '1' || m4Class === '3B') && modImprovement > 0) {
      results.mod_iv.push({
        check: 'vacant_land_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property has improvements: $${modImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    if (['2', '3A', '4A', '4B', '4C'].includes(m4Class) && modImprovement === 0) {
      results.mod_iv.push({
        check: 'missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property missing improvements`,
        details: property
      });
    }
    
    if (['15A', '15B', '15C', '15D', '15E', '15F'].includes(m4Class) && !property.property_facility) {
      results.mod_iv.push({
        check: 'missing_facility',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} missing facility information`,
        details: property
      });
    }
    
    if (m4Class === '3B' && !property.property_composite_key.includes('Q')) {
      results.mod_iv.push({
        check: 'farm_building_no_qualifier',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Class 3B with no qualifier (should be farm building)',
        details: property
      });
    }
    
    // CAMA CHECKS
    const camaClass = property.property_cama_class;
    const camaImprovement = property.values_cama_improvement || 0;
    
    if ((camaClass === '1' || camaClass === '3B') && camaImprovement > 0) {
      results.cama.push({
        check: 'cama_vacant_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} has improvements: $${camaImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    if (['2', '3A', '4A', '4B', '4C'].includes(camaClass) && camaImprovement === 0) {
      results.cama.push({
        check: 'cama_missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} missing improvements`,
        details: property
      });
    }
    
    // BUILDING CLASS CHECKS
    const buildingClass = property.asset_building_class;
    const typeUse = property.asset_type_use;
    const designStyle = property.asset_design_style;
    
    if (m4Class && m4Class !== '2' && m4Class !== '3A') {
      if (buildingClass && parseInt(buildingClass) !== 10) {
        results.characteristics.push({
          check: 'non_residential_wrong_building_class',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Class ${m4Class} should have building class 10 (has ${buildingClass})`,
          details: property
        });
      }
    }
    
    if ((m4Class === '2' || m4Class === '3A') && parseInt(buildingClass) === 10) {
      results.characteristics.push({
        check: 'residential_building_class_10',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} shouldn't have building class 10 (needs >10)`,
        details: property
      });
    }
    
    if (buildingClass > 10) {
      if (!designStyle) {
        results.characteristics.push({
          check: 'missing_design_style',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Building class > 10 missing design style',
          details: property
        });
      }
      if (!typeUse) {
        results.characteristics.push({
          check: 'missing_type_use',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Building class > 10 missing type use',
          details: property
        });
      }
    }
    
    if ((m4Class === '2' || m4Class === '3A') && designStyle && designStyle.trim() !== '') {
      if (!buildingClass || buildingClass <= 10) {
        results.characteristics.push({
          check: 'design_without_proper_building_class',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Has design style "${designStyle}" but building class is ${buildingClass || 'missing'} (should be > 10)`,
          details: property
        });
      }
      if (!typeUse || typeUse.trim() === '') {
        results.characteristics.push({
          check: 'design_without_type_use',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Has design style "${designStyle}" but missing type use`,
          details: property
        });
      }
    }
    
    if (modImprovement === 0) {
      if (designStyle && designStyle.trim() !== '') {
        results.characteristics.push({
          check: 'zero_improvement_with_design',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Zero improvement value but has design style: ${designStyle}`,
          details: property
        });
      }
      
      if (typeUse && typeUse.trim() !== '') {
        results.characteristics.push({
          check: 'zero_improvement_with_type',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Zero improvement value but has type use: ${typeUse}`,
          details: property
        });
      }
    }
    
    if (m4Class === '4A' || m4Class === '4B' || m4Class === '4C') {
      if (designStyle && designStyle.trim() !== '') {
        results.characteristics.push({
          check: 'commercial_with_design',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Commercial property (Class ${m4Class}) has residential design style: ${designStyle}`,
          details: property
        });
      }
      
      if (typeUse && typeUse.trim() !== '') {
        results.characteristics.push({
          check: 'commercial_with_type',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Commercial property (Class ${m4Class}) has residential type use: ${typeUse}`,
          details: property
        });
      }
    }
    
    // LOT SIZE CHECKS
    const lotAcre = property.asset_lot_acre || 0;
    const lotSf = property.asset_lot_sf || 0;
    const lotFrontage = property.asset_lot_frontage || 0;
    
    if (lotAcre === 0 && lotSf === 0 && lotFrontage === 0) {
      results.characteristics.push({
        check: 'zero_lot_size',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: 'Property has zero lot size (acre, sf, and frontage all zero)',
        details: property
      });
    }
    
    // LIVING AREA & YEAR BUILT
    const sfla = property.asset_sfla || 0;
    const yearBuilt = property.asset_year_built;
    
    if ((m4Class === '2' || m4Class === '3A') && sfla === 0) {
      results.characteristics.push({
        check: 'missing_sfla',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property missing living area`,
        details: property
      });
    }
    
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10 && !yearBuilt) {
      results.characteristics.push({
        check: 'missing_year_built',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Improved property missing year built',
        details: property
      });
    }
    
    // VCS CHECK
    if (!property.property_vcs) {
      results.special.push({
        check: 'missing_vcs',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Property missing VCS code',
        details: property
      });
    }
    
    // CONDITION CHECKS
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (!property.asset_ext_cond) {
        results.characteristics.push({
          check: 'missing_ext_condition',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Improved property missing exterior condition',
          details: property
        });
      }
      if (!property.asset_int_cond) {
        results.characteristics.push({
          check: 'missing_int_condition',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: 'Improved property missing interior condition',
          details: property
        });
      }
    }
    
    // PARTIAL HEATING/COOLING SYSTEMS
    if (vendor === 'BRT') {
      if (!interpretCodes.isFieldEmpty(rawData.ACPARTIAL)) {
        results.special.push({
          check: 'partial_cooling',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial AC system',
          details: property
        });
      }
      if (!interpretCodes.isFieldEmpty(rawData.HEATSYSPARTIAL)) {
        results.special.push({
          check: 'partial_heating',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial heating system',
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const heatType1 = rawData['Heat System Type1'] || rawData['Heat Source'];
      const heatType2 = rawData['Heat System Type2'];
      if (heatType1 && heatType1.toString().trim() !== '' && 
          heatType2 && heatType2.toString().trim() !== '') {
        results.special.push({
          check: 'partial_heating',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has partial heating system (multiple heat types)',
          details: property
        });
      }
    }
    
    // BEDROOM COUNT VALIDATION
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (vendor === 'BRT') {
        const bedTotal = interpretCodes.getRawDataValue(property, 'bedrooms', vendor);
        if (!bedTotal || parseInt(bedTotal) === 0) {
          results.rooms.push({
            check: 'zero_bedrooms',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: 'Residential property has zero bedrooms',
            details: property
          });
        }
      } else if (vendor === 'Microsystems') {
        const totalBeds = interpretCodes.getBedroomRoomSum(property, vendor);
        
        if (totalBeds === 0) {
          results.rooms.push({
            check: 'zero_bedrooms',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: 'Residential property has zero bedrooms',
            details: property
          });
        }
      }
    }
    
    // BATHROOM COUNT CROSS-CHECK
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (vendor === 'BRT') {
        const bathTotal = parseInt(rawData.BATHTOT) || 0;
        const plumbingSum = interpretCodes.getBathroomPlumbingSum(property, vendor);
        
        if (bathTotal !== plumbingSum && plumbingSum > 0) {
          results.rooms.push({
            check: 'bathroom_count_mismatch',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: `Bathroom total (${bathTotal}) doesn't match plumbing sum (${plumbingSum})`,
            details: property
          });
        }
      } else if (vendor === 'Microsystems') {
        const fixtureSum = interpretCodes.getBathroomFixtureSum(property, vendor);
        const roomSum = interpretCodes.getBathroomRoomSum(property, vendor);
        
        if (fixtureSum !== roomSum && roomSum > 0) {
          results.rooms.push({
            check: 'bathroom_count_mismatch',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: `Bathroom summary (${fixtureSum}) doesn't match floor totals (${roomSum})`,
            details: property
          });
        }
      }
    }
 
    // DETACHED ITEMS MISSING DEPRECIATION
    if (vendor === 'BRT') {
      for (let i = 1; i <= 11; i++) {
        const detachedCode = rawData[`DETACHEDCODE_${i}`];
        const detachedNC = rawData[`DETACHEDNC_${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          if (!detachedNC || parseFloat(detachedNC) === 0) {
            results.special.push({
              check: 'detached_missing_depreciation',
              severity: 'warning',
              property_key: property.property_composite_key,
              message: `Detached item ${i} (${detachedCode}) missing depreciation`,
              details: property
            });
          }
        }
      }
    } else if (vendor === 'Microsystems') {
      for (let i = 1; i <= 4; i++) {
        const detachedCode = rawData[`Detached Item Code${i}`];
        const physicalDepr = rawData[`Physical Depr${i}`];
        const functionalDepr = rawData[`Functional Depr${i}`];
        const locationalDepr = rawData[`Locational Depr${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          const hasPhys = physicalDepr && parseFloat(physicalDepr) !== 0;
          const hasFunc = functionalDepr && parseFloat(functionalDepr) !== 0;
          const hasLoc = locationalDepr && parseFloat(locationalDepr) !== 0;
          
          if (!hasPhys && !hasFunc && !hasLoc) {
            results.special.push({
              check: 'detached_missing_depreciation',
              severity: 'warning',
              property_key: property.property_composite_key,
              message: `Detached item ${i} (${detachedCode}) has no depreciation values`,
              details: property
            });
          }
        }
      }
    }
    
    // LAND ADJUSTMENTS
    if (vendor === 'BRT') {
      let hasLandAdjustments = false;
      
      for (let i = 1; i <= 6; i++) {
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURCONDPC_${i}`] && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURINFL_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURINFLPC_${i}`] && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDFFCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDFFCONDPC_${i}`] && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        if (!interpretCodes.isFieldEmpty(rawData[`LANDFFINFL_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDFFINFLPC_${i}`] && parseFloat(rawData[`LANDFFINFLPC_${i}`]) !== 0 && parseFloat(rawData[`LANDFFINFLPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
      }
      
      if (hasLandAdjustments) {
        results.special.push({
          check: 'land_adjustments_exist',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has land adjustments applied',
          details: property
        });
      }
      
    } else if (vendor === 'Microsystems') {
      let hasLandAdjustments = false;
      
      for (let i = 1; i <= 3; i++) {
        const netAdj = rawData[`Net Adjustment${i}`];
        const adjCode = rawData[`Adj Reason Code${i}`];
        const netAdjValue = parseFloat(netAdj) || 0;
        
        if (netAdjValue !== 0 || !interpretCodes.isFieldEmpty(adjCode)) {
          hasLandAdjustments = true;
          break;
        }
      }
      
      if (!hasLandAdjustments) {
        for (let i = 1; i <= 4; i++) {
          const overallPercent = rawData[`Overall Adj Percent${i}`];
          const overallReason = rawData[`Overall Adj Reason${i}`];
          const percentValue = parseFloat(overallPercent) || 0;
          
          if ((percentValue !== 0 && percentValue !== 100) || !interpretCodes.isFieldEmpty(overallReason)) {
            hasLandAdjustments = true;
            break;
          }
        }
      }
      
      if (!hasLandAdjustments) {
        const unitAdj1 = rawData['Unit Adjustment1'];
        const unitAdj2 = rawData['Unit Adjustment2'];
        const unitAdj = rawData['Unit Adjustment'];
        const unitCode1 = rawData['Unit Adj Code1'];
        const unitCode2 = rawData['Unit Adj Code2'];
        const unitCode = rawData['Unit Adj Code'];
        
        const unitAdj1Value = parseFloat(unitAdj1) || 0;
        const unitAdj2Value = parseFloat(unitAdj2) || 0;
        const unitAdjValue = parseFloat(unitAdj) || 0;
        
        if (unitAdj1Value !== 0 || 
            unitAdj2Value !== 0 ||
            unitAdjValue !== 0 ||
            !interpretCodes.isFieldEmpty(unitCode1) ||
            !interpretCodes.isFieldEmpty(unitCode2) ||
            !interpretCodes.isFieldEmpty(unitCode)) {
          hasLandAdjustments = true;
        }
      }
      
      if (hasLandAdjustments) {
        results.special.push({
          check: 'land_adjustments_exist',
          severity: 'info',
          property_key: property.property_composite_key,
          message: 'Property has land adjustments applied',
          details: property
        });
      }
    }

    // MARKET ADJUSTMENTS
    if (vendor === 'BRT') {
      const issues = [];
      
      if (rawData.MKTADJ && parseFloat(rawData.MKTADJ) !== 1) {
        issues.push(`MKTADJ = ${rawData.MKTADJ} (should be 1)`);
      }
      
      if (rawData.NCOVR && parseFloat(rawData.NCOVR) !== 0) {
        issues.push(`NCOVR = ${rawData.NCOVR} (should be 0)`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.NCREDIRECT)) {
        issues.push('NC Redirect value present');
      }
      
      if (rawData.NCMKTINFLNC && parseFloat(rawData.NCMKTINFLNC) !== 0) {
        issues.push(`NC Market Influence = ${rawData.NCMKTINFLNC}`);
      }
      if (rawData.NCMKTINFPC && parseFloat(rawData.NCMKTINFPC) !== 0) {
        issues.push(`NC Market Influence % = ${rawData.NCMKTINFPC}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.MKTECONDESC)) {
        issues.push('Economic description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTFUNCDESC)) {
        issues.push('Functional description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTMKTDESC)) {
        issues.push('Market description present');
      }
      if (!interpretCodes.isFieldEmpty(rawData.MKTPHYSDESC)) {
        issues.push('Physical description present');
      }
      
      if (rawData.MKTECONPC && parseFloat(rawData.MKTECONPC) !== 100 && parseFloat(rawData.MKTECONPC) !== 0) {
        issues.push(`Economic % = ${rawData.MKTECONPC} (should be 100)`);
      }
      if (rawData.MKTFUNCPC && parseFloat(rawData.MKTFUNCPC) !== 100 && parseFloat(rawData.MKTFUNCPC) !== 0) {
        issues.push(`Functional % = ${rawData.MKTFUNCPC} (should be 100)`);
      }
      if (rawData.MKTMKTPC && parseFloat(rawData.MKTMKTPC) !== 100 && parseFloat(rawData.MKTMKTPC) !== 0) {
        issues.push(`Market % = ${rawData.MKTMKTPC} (should be 100)`);
      }
      if (rawData.MKTPHYSPC && parseFloat(rawData.MKTPHYSPC) !== 100 && parseFloat(rawData.MKTPHYSPC) !== 0) {
        issues.push(`Physical % = ${rawData.MKTPHYSPC} (should be 100)`);
      }
      
      if (issues.length > 0) {
        results.special.push({
          check: 'market_adjustments_exist',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Market adjustments present: ${issues.join(', ')}`,
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const issues = [];
      
      if (!interpretCodes.isFieldEmpty(rawData['Over Improved Depr1'])) {
        issues.push(`Over Improved Depr1: ${rawData['Over Improved Depr1']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Over Improved Depr2'])) {
        issues.push(`Over Improved Depr2: ${rawData['Over Improved Depr2']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Economic Depr'])) {
        issues.push(`Economic Depr: ${rawData['Economic Depr']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Function Depr'])) {
        issues.push(`Function Depr: ${rawData['Function Depr']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Location Code'])) {
        issues.push(`Location Code: ${rawData['Location Code']}`);
      }
      
      if (!interpretCodes.isFieldEmpty(rawData['Phys Depr Code'])) {
        issues.push(`Phys Depr Code: ${rawData['Phys Depr Code']}`);
      }
      
      const netFunctional = parseFloat(rawData['Net Functional Depr']) || 0;
      if (netFunctional !== 100 && netFunctional !== 0) {
        issues.push(`Net Functional Depr = ${netFunctional}`);
      }
      
      const netLocational = parseFloat(rawData['Net Locational Depr']) || 0;
      if (netLocational !== 100 && netLocational !== 0) {
        issues.push(`Net Locational Depr = ${netLocational}`);
      }
      
      const underImpr = parseFloat(rawData['Under Improved Depr']) || 0;
      if (underImpr !== 100 && underImpr !== 0) {
        issues.push(`Under Improved Depr = ${underImpr}`);
      }
      
      if (issues.length > 0) {
        results.special.push({
          check: 'market_adjustments_exist',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Market adjustments present: ${issues.join(', ')}`,
          details: property
        });
      }
    }
    
    // FLAT ADD VALUES/OVERRIDES
    if (vendor === 'BRT') {
      const overrides = [];
      
      if (!interpretCodes.isFieldEmpty(rawData.IMPROVVALUEOVR)) {
        overrides.push('Improvement value override');
      }
      if (!interpretCodes.isFieldEmpty(rawData.LANDVALUEOVR)) {
        overrides.push('Land value override');
      }
      
      if (!interpretCodes.isFieldEmpty(rawData.WRITEIN_1)) {
        overrides.push(`Write-in 1: ${rawData.WRITEIN_1}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData.WRITEIN_2)) {
        overrides.push(`Write-in 2: ${rawData.WRITEIN_2}`);
      }
      if (rawData.WRITEINVALUE_1 && parseFloat(rawData.WRITEINVALUE_1) !== 0) {
        overrides.push(`Write-in value 1: $${rawData.WRITEINVALUE_1}`);
      }
      if (rawData.WRITEINVALUE_2 && parseFloat(rawData.WRITEINVALUE_2) !== 0) {
        overrides.push(`Write-in value 2: $${rawData.WRITEINVALUE_2}`);
      }
      
      if (overrides.length > 0) {
        results.special.push({
          check: 'value_overrides',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Manual overrides: ${overrides.join(', ')}`,
          details: property
        });
      }
    } else if (vendor === 'Microsystems') {
      const overrides = [];
      
      if (!interpretCodes.isFieldEmpty(rawData['Flat Add Desc1'])) {
        overrides.push(`Flat Add 1: ${rawData['Flat Add Desc1']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Flat Add Desc2'])) {
        overrides.push(`Flat Add 2: ${rawData['Flat Add Desc2']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Base Cost Flat Add Desc1'])) {
        overrides.push(`Base Cost Add 1: ${rawData['Base Cost Flat Add Desc1']}`);
      }
      if (!interpretCodes.isFieldEmpty(rawData['Base Cost Flat Add Desc2'])) {
        overrides.push(`Base Cost Add 2: ${rawData['Base Cost Flat Add Desc2']}`);
      }
      
      if (rawData['Flat Add Value1'] && parseFloat(rawData['Flat Add Value1']) !== 0) {
        overrides.push(`Flat value 1: $${rawData['Flat Add Value1']}`);
      }
      if (rawData['Flat Add Value2'] && parseFloat(rawData['Flat Add Value2']) !== 0) {
        overrides.push(`Flat value 2: $${rawData['Flat Add Value2']}`);
      }
      if (rawData['Base Cost Flat Add Value1'] && parseFloat(rawData['Base Cost Flat Add Value1']) !== 0) {
        overrides.push(`Base cost value 1: $${rawData['Base Cost Flat Add Value1']}`);
      }
      if (rawData['Base Cost Flat Add Value2'] && parseFloat(rawData['Base Cost Flat Add Value2']) !== 0) {
        overrides.push(`Base cost value 2: $${rawData['Base Cost Flat Add Value2']}`);
      }
      
      if (overrides.length > 0) {
        results.special.push({
          check: 'value_overrides',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Manual overrides: ${overrides.join(', ')}`,
          details: property
        });
      }
    }
  };

  const runSingleCustomCheck = async (check) => {
    const checkResults = [];
    
    for (const property of properties) {
      let conditionMet = true;
      
      // [SAME LOGIC AS IN runCustomCheck but returns array instead of setting state]
      // ... all the condition checking logic ...
      
      if (conditionMet) {
        checkResults.push({
          check: `custom_${check.id}`,
          severity: check.severity,
          property_key: property.property_composite_key,
          message: check.name,
          details: property
        });
      }
    }
    
    return checkResults;
  };

  

  const saveQualityResults = async (results) => {
    try {
      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      
      Object.values(results).forEach(category => {
        category.forEach(issue => {
          if (issue.severity === 'critical') criticalCount++;
          else if (issue.severity === 'warning') warningCount++;
          else if (issue.severity === 'info') infoCount++;
        });
      });
      
      const totalIssues = criticalCount + warningCount + infoCount;
      const score = calculateQualityScore(results);
      
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id, quality_check_results')
        .eq('job_id', jobData.id)
        .single();
      
      const newRun = {
        date: new Date().toISOString(),
        propertyCount: properties.length,
        criticalCount,
        warningCount,
        infoCount,
        totalIssues,
        qualityScore: score
      };
      
      const existingResults = existing?.quality_check_results || {};
      const existingHistory = existingResults.history || [];
      const updatedHistory = [newRun, ...existingHistory].slice(0, 50);
      
      const qualityCheckResults = {
        summary: {
          mod_iv: results.mod_iv?.length || 0,
          cama: results.cama?.length || 0,
          characteristics: results.characteristics?.length || 0,
          special: results.special?.length || 0,
          rooms: results.rooms?.length || 0,
          custom: results.custom?.length || 0,
          timestamp: new Date().toISOString()
        },
        history: updatedHistory
      };
      
      const saveData = {
        job_id: jobData.id,
        quality_check_last_run: new Date().toISOString(),
        quality_issues_count: totalIssues,
        quality_score: score,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        custom_checks: customChecks.length > 0 ? customChecks : null,
        quality_check_results: qualityCheckResults
      };
      
      if (existing) {
        const { error } = await supabase
          .from('market_land_valuation')
          .update(saveData)
          .eq('job_id', jobData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('market_land_valuation')
          .insert(saveData);
        if (error) throw error;
      }
      
      setRunHistory(updatedHistory);
      
      setCheckResults(results);
      setIssueStats({
        critical: criticalCount,
        warning: warningCount,
        info: infoCount,
        total: totalIssues
      });
      
      console.log(`✅ Saved: ${totalIssues} issues found`);
      
    } catch (error) {
      console.error('Error saving:', error);
      setCheckResults(results);
    }
  };

  const calculateQualityScore = (results) => {
    const totalProps = properties.length || 1;
    const issueWeights = { critical: 10, warning: 5, info: 1 };
    let totalDeductions = 0;
    
    Object.values(results).forEach(category => {
      category.forEach(issue => {
        totalDeductions += issueWeights[issue.severity] || 0;
      });
    });
    
    const score = Math.max(0, 100 - (totalDeductions / totalProps));
    return score.toFixed(1);
  };

  const toggleQualityCategory = (categoryId) => {
    setExpandedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };
  const getCheckTitle = (checkType) => {
    // Handle custom checks
    if (checkType.startsWith('custom_')) {
      const checkId = checkType.replace('custom_', '');
      const customCheck = customChecks.find(c => c.id.toString() === checkId);
      return customCheck ? customCheck.name : checkType;
    }
    
    const titles = {
      'vacant_land_improvements': 'Vacant Land with Improvements',
      'missing_improvements': 'Properties Missing Improvements',
      'missing_facility': 'Missing Facility Information',
      'farm_building_no_qualifier': 'Farm Building Without Qualifier',
      'cama_vacant_improvements': 'CAMA Vacant Land with Improvements',
      'cama_missing_improvements': 'CAMA Properties Missing Improvements',
      'non_residential_wrong_building_class': 'Non-Residential with Wrong Building Class',
      'residential_building_class_10': 'Residential Properties with Building Class 10',
      'missing_design_style': 'Missing Design Style',
      'missing_type_use': 'Missing Type Use',
      'design_without_proper_building_class': 'Has Design but Wrong Building Class',
      'design_without_type_use': 'Has Design but Missing Type Use',
      'type_use_building_class_mismatch': 'Type Use/Building Class Mismatch',
      'zero_lot_size': 'Properties with Zero Lot Size',
      'missing_sfla': 'Missing Living Area',
      'missing_year_built': 'Missing Year Built',
      'missing_ext_condition': 'Missing Exterior Condition',
      'missing_int_condition': 'Missing Interior Condition',
      'zero_bedrooms': 'Properties with Zero Bedrooms',
      'bathroom_count_mismatch': 'Bathroom Count Mismatch',
      'missing_vcs': 'Missing VCS Code',
      'partial_cooling': 'Partial AC System',
      'partial_heating': 'Partial Heating System',
      'detached_missing_depreciation': 'Detached Items Missing Depreciation',
      'land_adjustments_exist': 'Properties with Land Adjustments',
      'market_adjustments_exist': 'Properties with Market Adjustments',
      'value_overrides': 'Manual Value Overrides Present',
      'zero_improvement_with_design': 'Zero Improvements with Design Style',
      'zero_improvement_with_type': 'Zero Improvements with Type Use',
      'commercial_with_design': 'Commercial Property with Residential Design',
      'commercial_with_type': 'Commercial Property with Residential Type'
    };
    return titles[checkType] || checkType;
  };

  const showPropertyDetails = (checkType, category) => {
    const issues = checkResults[category]?.filter(r => r.check === checkType) || [];
    setModalData({
      title: getCheckTitle(checkType),
      properties: issues
    });
    setShowDetailsModal(true);
  };

  const saveCustomChecksToDb = async (checks) => {
    try {
      await supabase
        .from('market_land_valuation')
        .update({ custom_checks: checks })
        .eq('job_id', jobData.id);
    } catch (error) {
      console.error('Error saving custom checks:', error);
    }
  };

  // Custom check functions
  const addConditionToCustomCheck = () => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: [...prev.conditions, { logic: 'AND', field: '', operator: '=', value: '' }]
    }));
  };
  
  const updateCustomCheckCondition = (index, field, value) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.map((cond, i) => 
        i === index ? { ...cond, [field]: value } : cond
      )
    }));
  };
  
  const removeCustomCheckCondition = (index) => {
    setCurrentCustomCheck(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index)
    }));
  };
  
  const saveCustomCheck = () => {
    const checkName = customCheckNameInputRef.current?.value;
    const checkSeverity = customCheckSeveritySelectRef.current?.value;
    
    if (!checkName || currentCustomCheck.conditions.some(c => !c.field)) {
      alert('Please complete all fields before saving');
      return;
    }
    
    const newCheck = {
      ...currentCustomCheck,
      name: checkName,
      severity: checkSeverity,
      id: Date.now()
    };
    
    setCustomChecks(prev => [...prev, newCheck]);
    
    customCheckNameInputRef.current.value = '';
    customCheckSeveritySelectRef.current.value = 'warning';
    setCurrentCustomCheck({
      name: '',
      severity: 'warning',
      conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
    });
    
    saveCustomChecksToDb([...customChecks, newCheck]);
  };
  
  const deleteCustomCheck = (checkId) => {
    setCustomChecks(prev => prev.filter(check => check.id !== checkId));
    saveCustomChecksToDb(customChecks.filter(check => check.id !== checkId));
  };
  
  const editCustomCheck = (check) => {
    customCheckNameInputRef.current.value = check.name;
    customCheckSeveritySelectRef.current.value = check.severity;
    setCurrentCustomCheck({
      ...check,
      conditions: check.conditions
    });
    // Remove from list so it can be re-saved with same or new name
    setCustomChecks(prev => prev.filter(c => c.id !== check.id));
  };

    // Add these drag and drop handler functions HERE:
  const handleDragStart = (e, template) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('template', JSON.stringify(template));
  }; 

    const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e) => {
    // Only set to false if we're leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    try {
      const template = JSON.parse(e.dataTransfer.getData('template'));
      
      // Check if this check already exists
      const exists = customChecks.some(c => c.name === template.name);
      if (exists) {
        alert(`"${template.name}" already exists in saved checks`);
        return;
      }
      
      // Add to custom checks with new ID
      const newCheck = {
        ...template,
        id: Date.now()
      };
      
      const updatedChecks = [...customChecks, newCheck];
      setCustomChecks(updatedChecks);
      saveCustomChecksToDb(updatedChecks);
      
      console.log(`✅ Added "${template.name}" from template library`);
    } catch (error) {
      console.error('Error adding template:', error);
    }
  };  
  
  const runCustomCheck = async (check) => {
    const results = { custom: [] };
    
    for (const property of properties) {
      let conditionMet = true;
      
      for (let i = 0; i < check.conditions.length; i++) {
        const condition = check.conditions[i];
            
        let fieldValue;
        if (condition.field.startsWith('raw_data.')) {
          const rawFieldName = condition.field.replace('raw_data.', '');
          fieldValue = property.raw_data ? property.raw_data[rawFieldName] : null;
        } else {
          fieldValue = property[condition.field];
        }
        const compareValue = condition.value;
        let thisConditionMet = false;
        
        switch (condition.operator) {
          case '=':
            thisConditionMet = fieldValue == compareValue;
            break;
          case '!=':
            thisConditionMet = fieldValue != compareValue;
            break;
          case '>':
            thisConditionMet = parseFloat(fieldValue) > parseFloat(compareValue);
            break;
          case '<':
            thisConditionMet = parseFloat(fieldValue) < parseFloat(compareValue);
            break;
          case '>=':
            thisConditionMet = parseFloat(fieldValue) >= parseFloat(compareValue);
            break;
          case '<=':
            thisConditionMet = parseFloat(fieldValue) <= parseFloat(compareValue);
            break;
          case 'is null':
            thisConditionMet = !fieldValue || fieldValue === '';
            break;
          case 'is not null':
            thisConditionMet = fieldValue && fieldValue !== '';
            break;
          case 'contains':
            thisConditionMet = fieldValue && fieldValue.toString().toLowerCase().includes(compareValue.toLowerCase());
            break;
          case 'is one of':
            const validValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = validValues.includes(fieldValue);
            break;
          case 'is not one of':
            const invalidValues = compareValue.split(',').map(v => v.trim());
            thisConditionMet = !invalidValues.includes(fieldValue);
            break;
        }
        
        if (i === 0) {
          conditionMet = thisConditionMet;
        } else {
          if (condition.logic === 'AND') {
            conditionMet = conditionMet && thisConditionMet;
          } else if (condition.logic === 'OR') {
            conditionMet = conditionMet || thisConditionMet;
          }
        }
      }
      
      if (conditionMet) {
        results.custom.push({
          check: `custom_${check.id}`,
          severity: check.severity,
          property_key: property.property_composite_key,
          message: check.name,
          details: property
        });
      }
    }
    
    setCheckResults(prev => ({
      ...prev,
      custom: [...(prev.custom || []), ...results.custom]
    }));
    
    const newStats = {
      critical: results.custom.filter(i => i.severity === 'critical').length,
      warning: results.custom.filter(i => i.severity === 'warning').length,
      info: results.custom.filter(i => i.severity === 'info').length,
      total: results.custom.length
    };
    
    setIssueStats(prev => ({
      critical: prev.critical + newStats.critical,
      warning: prev.warning + newStats.warning,
      info: prev.info + newStats.info,
      total: prev.total + newStats.total
    }));
    
    console.log(`✅ Custom check "${check.name}" found ${results.custom.length} issues`);
  };
  
  const runAllCustomChecks = async () => {
    // Start with existing results but clear custom
    const updatedResults = {
      ...checkResults,
      custom: []
    };
    
    // Run all custom checks and collect results
    for (const check of customChecks) {
      const customResults = [];
      
      for (const property of properties) {
        let conditionMet = true;
        
        // Check conditions (same logic as runCustomCheck)
        for (let i = 0; i < check.conditions.length; i++) {
          const condition = check.conditions[i];
          
          let fieldValue;
          if (condition.field.startsWith('raw_data.')) {
            const rawFieldName = condition.field.replace('raw_data.', '');
            fieldValue = property.raw_data ? property.raw_data[rawFieldName] : null;
          } else {
            fieldValue = property[condition.field];
          }
          
          const compareValue = condition.value;
          let thisConditionMet = false;
          
          switch (condition.operator) {
            case '=':
              thisConditionMet = fieldValue == compareValue;
              break;
            case '!=':
              thisConditionMet = fieldValue != compareValue;
              break;
            case '>':
              thisConditionMet = parseFloat(fieldValue) > parseFloat(compareValue);
              break;
            case '<':
              thisConditionMet = parseFloat(fieldValue) < parseFloat(compareValue);
              break;
            case '>=':
              thisConditionMet = parseFloat(fieldValue) >= parseFloat(compareValue);
              break;
            case '<=':
              thisConditionMet = parseFloat(fieldValue) <= parseFloat(compareValue);
              break;
            case 'is null':
              thisConditionMet = !fieldValue || fieldValue === '';
              break;
            case 'is not null':
              thisConditionMet = fieldValue && fieldValue !== '';
              break;
            case 'contains':
              thisConditionMet = fieldValue && fieldValue.toString().toLowerCase().includes(compareValue.toLowerCase());
              break;
            case 'is one of':
              const validValues = compareValue.split(',').map(v => v.trim());
              thisConditionMet = validValues.includes(fieldValue);
              break;
            case 'is not one of':
              const invalidValues = compareValue.split(',').map(v => v.trim());
              thisConditionMet = !invalidValues.includes(fieldValue);
              break;
          }
          
          if (i === 0) {
            conditionMet = thisConditionMet;
          } else {
            if (condition.logic === 'AND') {
              conditionMet = conditionMet && thisConditionMet;
            } else if (condition.logic === 'OR') {
              conditionMet = conditionMet || thisConditionMet;
            }
          }
        }
        
        if (conditionMet) {
          customResults.push({
            check: `custom_${check.id}`,
            severity: check.severity,
            property_key: property.property_composite_key,
            message: check.name,
            details: property
          });
        }
      }
      
      // Add to updated results
      updatedResults.custom.push(...customResults);
    }
    
    // Update state with complete results
    setCheckResults(updatedResults);
    
    // Calculate stats
    let criticalCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    
    Object.values(updatedResults).forEach(category => {
      category.forEach(issue => {
        if (issue.severity === 'critical') criticalCount++;
        else if (issue.severity === 'warning') warningCount++;
        else if (issue.severity === 'info') infoCount++;
      });
    });
    
    const totalIssues = criticalCount + warningCount + infoCount;
    const score = calculateQualityScore(updatedResults);
    
    // Update issue stats
    setIssueStats({
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      total: totalIssues
    });
    
    setQualityScore(score);
    
    // Save to database with complete results
    await saveQualityResults(updatedResults);
    
    console.log(`✅ Custom checks complete: ${updatedResults.custom.length} issues found`);
    
    // Jump back to overview
    setDataQualityActiveSubTab('overview');
  };
  // RENDER
  return (
    <div className="tab-content">
      {/* Sub-tab Navigation */}
      <div className="flex gap-1 border-b border-gray-300 mb-6">
        <button
          onClick={() => setDataQualityActiveSubTab('overview')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'overview'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('standard')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'standard'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Standard & Custom Check Results
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('custom')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'custom'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Custom Checks/Definitions
        </button>
        <button
          onClick={() => setDataQualityActiveSubTab('history')}
          className={`px-4 py-2 font-medium text-sm transition-all ${
            dataQualityActiveSubTab === 'history'
              ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
              : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
          }`}
        >
          Run History
        </button>
      </div>
      
      {/* OVERVIEW TAB CONTENT */}
      {dataQualityActiveSubTab === 'overview' && (
        <div>
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              Data Quality Analysis
            </h3>
            <p className="text-gray-600">
              Analyzing {properties.length.toLocaleString()} properties for data integrity issues
            </p>
          </div>

          <div className="flex gap-3 mb-6">
            <button 
              onClick={runQualityChecks}
              disabled={isRunningChecks || properties.length === 0}
              className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                isRunningChecks || properties.length === 0
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <RefreshCw size={16} className={isRunningChecks ? 'animate-spin' : ''} />
              {isRunningChecks ? 'Running Analysis...' : 'Run Analysis'}
            </button>
            
            <button 
              onClick={exportToExcel}
              disabled={Object.keys(checkResults).length === 0}
              className={`px-4 py-2 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-all flex items-center gap-2 ${
                Object.keys(checkResults).length === 0 ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <Download size={16} />
              Export to Excel
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Properties</div>
              <div className="text-2xl font-bold text-gray-800">{properties.length.toLocaleString()}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Properties with Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.total}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Critical Issues</div>
              <div className="text-2xl font-bold text-red-600">{issueStats.critical}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Warnings</div>
              <div className="text-2xl font-bold text-yellow-600">{issueStats.warning}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Info Messages</div>
              <div className="text-2xl font-bold text-blue-600">{issueStats.info}</div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-lg p-4 bg-gradient-to-br from-green-50 to-green-100">
              <div className="text-xs text-gray-600 uppercase tracking-wide mb-1">Data Quality Score</div>
              <div className="text-2xl font-bold text-green-700">{qualityScore ? `${qualityScore}%` : '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* STANDARD CHECKS TAB CONTENT */}
      {dataQualityActiveSubTab === 'standard' && (
        <div>
          {Object.keys(checkResults).length > 0 ? (
            <div>
              <h4 className="text-lg font-semibold text-gray-800 mb-4">
                Check Results by Category
              </h4>
              
              {Object.entries(checkResults).map(([category, issues]) => {
                if (!issues || issues.length === 0) return null;
                
                const isExpanded = expandedCategories.includes(category);
                const criticalCount = issues.filter(i => i.severity === 'critical').length;
                const warningCount = issues.filter(i => i.severity === 'warning').length;
                const infoCount = issues.filter(i => i.severity === 'info').length;
                const uniquePropertiesWithIssues = new Set(issues.map(i => i.property_key)).size;
                const passCount = properties.length - uniquePropertiesWithIssues;
                
                return (
                  <div key={category} className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
                    <div
                      onClick={() => toggleQualityCategory(category)}
                      className="p-4 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors flex justify-between items-center"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={20}
                          className={`text-gray-500 transform transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`}
                        />
                        <span className="font-semibold text-gray-800 capitalize">
                          {category.replace(/_/g, ' ')} Checks ({issues.length} issues)
                        </span>
                      </div>
                      
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {criticalCount > 0 && (
                          <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                            {criticalCount} Critical
                          </span>
                        )}
                        {warningCount > 0 && (
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">
                            {warningCount} Warning
                          </span>
                        )}
                        {infoCount > 0 && (
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                            {infoCount} Info
                          </span>
                        )}
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          {passCount.toLocaleString()} Pass
                        </span>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="p-4 border-t border-gray-200">
                        {Object.entries(
                          issues.reduce((acc, issue) => {
                            if (!acc[issue.check]) acc[issue.check] = [];
                            acc[issue.check].push(issue);
                            return acc;
                          }, {})
                        ).map(([checkType, checkIssues]) => (
                          <div
                            key={checkType}
                            className="p-3 bg-gray-50 rounded-lg mb-2 flex justify-between items-center"
                          >
                            <span className="text-sm text-gray-700">
                              {getCheckTitle(checkType)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-semibold ${
                                checkIssues[0].severity === 'critical' ? 'text-red-600' :
                                checkIssues[0].severity === 'warning' ? 'text-yellow-600' : 
                                'text-blue-600'
                              }`}>
                                {checkIssues.length} properties
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showPropertyDetails(checkType, category);
                                }}
                                className="px-3 py-1 text-xs bg-white border border-blue-600 text-blue-600 rounded hover:bg-blue-50 transition-colors"
                              >
                                View Details
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
              <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                No Analysis Run Yet
              </h3>
              <p className="text-gray-600">
                Click "Run Analysis" in the Overview tab to check for data quality issues.
              </p>
            </div>
          )}
        </div>
      )}
      
{/* CUSTOM CHECKS TAB CONTENT */}
      {dataQualityActiveSubTab === 'custom' && (
        <div>
          {/* View Template Library Button */}
          <div className="mb-4">
            <button
              onClick={() => setShowTemplateLibrary(!showTemplateLibrary)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {showTemplateLibrary ? 'Hide' : 'View'} Template Library
            </button>
          </div>

          <div className="flex gap-6">
            {/* Template Library Panel */}
            {showTemplateLibrary && (
              <div className="w-1/3 bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  📚 Template Library
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Drag templates to saved checks →
                </p>
                
                {templateLibrary.map((category) => (
                  <div key={category.category} className="mb-4">
                    <h4 className="font-medium text-gray-700 mb-2">
                      {category.category}
                    </h4>
                    {category.templates.map((template) => (
                      <div
                        key={template.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, template)}
                        className="p-2 mb-2 bg-blue-50 border border-blue-200 rounded cursor-move hover:bg-blue-100 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">📋</span>
                          <span className="text-sm font-medium text-gray-800">
                            {template.name}
                          </span>
                        </div>
                        <span className={`text-xs ml-6 ${
                          template.severity === 'critical' ? 'text-red-600' :
                          template.severity === 'warning' ? 'text-yellow-600' :
                          'text-blue-600'
                        }`}>
                          {template.severity}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Main Content Area */}
            <div className={showTemplateLibrary ? 'w-2/3' : 'w-full'}>
              {/* Custom Check Builder */}
              <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">
                  Custom Check/Definition Builder
                </h3>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Check Name</label>
                      <input 
                        ref={customCheckNameInputRef}
                        type="text"
                        placeholder="e.g., Missing Tax ID for Commercial"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                      <select 
                        ref={customCheckSeveritySelectRef}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        defaultValue="warning"
                        onClick={(e) => e.stopPropagation()}
                      >  
                        <option value="critical">Critical</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                      </select>
                    </div>
                  </div>
                  
                  <div className="border-t pt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Conditions</label>
                    {currentCustomCheck.conditions.map((condition, index) => (
                      <div key={index} className="flex gap-2 items-center mb-2">
                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={condition.logic}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateCustomCheckCondition(index, 'logic', e.target.value)}
                          disabled={index === 0}
                        >
                          <option>IF</option>
                          <option>AND</option>
                          <option>OR</option>
                        </select>
                        
                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                          value={condition.field}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateCustomCheckCondition(index, 'field', e.target.value)}
                        >
                          <option value="">-- Select Field --</option>
                          
                          <optgroup label="Property Identification">
                            <option value="property_block">Block</option>
                            <option value="property_lot">Lot</option>
                            <option value="property_qualifier">Qualifier</option>
                            <option value="property_card">Card</option>
                            <option value="property_location">Location</option>
                            <option value="property_m4_class">M4 Class</option>
                            <option value="property_cama_class">CAMA Class</option>
                            <option value="property_vcs">VCS Code</option>
                            <option value="property_facility">Facility</option>
                          </optgroup>
                          
                          <optgroup label="Values">
                            <option value="values_mod_improvement">Mod Improvement</option>
                            <option value="values_mod_land">Mod Land</option>
                            <option value="values_mod_total">Mod Total</option>
                            <option value="values_cama_improvement">CAMA Improvement</option>
                            <option value="values_cama_land">CAMA Land</option>
                            <option value="values_cama_total">CAMA Total</option>
                            <option value="values_norm_time">Normalized Time Value</option>
                            <option value="values_norm_size">Normalized Size Value</option>
                          </optgroup>
                          
                          <optgroup label="Asset Information">
                            <option value="asset_building_class">Building Class</option>
                            <option value="asset_design_style">Design Style</option>
                            <option value="asset_type_use">Type Use</option>
                            <option value="asset_sfla">Living Area (SFLA)</option>
                            <option value="asset_year_built">Year Built</option>
                            <option value="asset_lot_acre">Lot Acres</option>
                            <option value="asset_lot_sf">Lot Square Feet</option>
                            <option value="asset_lot_frontage">Lot Frontage</option>
                            <option value="asset_ext_cond">Exterior Condition</option>
                            <option value="asset_int_cond">Interior Condition</option>
                            <option value="asset_zoning">Zoning</option>
                            <option value="asset_map_page">Map Page</option>
                            <option value="asset_key_page">Key Page</option>
                          </optgroup>
                          
                          <optgroup label="Sale Information">
                            <option value="sale_date">Sale Date</option>
                            <option value="sale_price">Sale Price</option>
                            <option value="sale_nu">Sale NU</option>
                            <option value="sale_book">Sale Book</option>
                            <option value="sale_page">Sale Page</option>
                          </optgroup>
                          
                          <optgroup label="Market Analysis">
                            <option value="location_analysis">Location Analysis</option>
                            <option value="newVCS">New VCS</option>
                          </optgroup>
                          
                          {availableFields.length > 0 && (
                            <optgroup label={`Raw Data Fields (${vendorType || 'Vendor'})`}>
                              {availableFields.map(field => (
                                <option key={field} value={`raw_data.${field}`}>
                                  {field}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>

                        <select 
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={condition.operator}
                          onChange={(e) => updateCustomCheckCondition(index, 'operator', e.target.value)}
                        >
                          <option value="=">=</option>
                          <option value="!=">!=</option>
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="is null">is null</option>
                          <option value="is not null">is not null</option>
                          <option value="contains">contains</option>
                          <option value="is one of">is one of</option>
                          <option value="is not one of">is not one of</option>
                        </select>
                        
                        <input 
                          type="text" 
                          placeholder="Value"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                          value={condition.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateCustomCheckCondition(index, 'value', e.target.value);
                          }}
                          disabled={condition.operator === 'is null' || condition.operator === 'is not null'}
                        />      
                        
                        <button 
                          type="button"
                          className="p-2 text-red-500 hover:bg-red-50 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCustomCheckCondition(index);
                          }}
                          disabled={currentCustomCheck.conditions.length === 1}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                    
                    <button
                      type="button"
                      className="text-blue-600 text-sm hover:text-blue-700 mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        addConditionToCustomCheck();
                      }}
                    >
                      + Add Condition
                    </button>
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <button
                      type="button" 
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveCustomCheck();
                      }}
                    >
                      Save Custom Check
                    </button>
                  </div>
                </div>
              </div>

              {/* Saved Custom Checks with Drop Zone */}
              <div 
                className={`bg-white border-2 rounded-lg p-6 transition-all ${
                  isDraggingOver 
                    ? 'border-blue-400 bg-blue-50 border-dashed' 
                    : 'border-gray-200'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">
                    ✅ Saved Custom Checks/Definitions
                  </h3>
                  <div className="flex items-center gap-4">
                    {customChecks.length > 0 && !isDraggingOver && (
                      <>
                        <span className="text-sm text-gray-600">
                          {customChecks.length} custom check{customChecks.length !== 1 ? 's' : ''} will run with analysis
                        </span>
                        <button
                          type="button"
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            runAllCustomChecks();
                          }}
                        >
                          Run All Custom Checks
                        </button>
                      </>
                    )}
                  </div>
                  {isDraggingOver && (
                    <span className="text-sm text-blue-600 font-medium">
                      Drop here to add to saved checks
                    </span>
                  )}
                </div>
                  {isDraggingOver && (
                    <span className="text-sm text-blue-600 font-medium">
                      Drop here to add to saved checks
                    </span>
                  )}
                </div>
                
                {customChecks.length > 0 ? (
                  <div className="space-y-2">
                    {customChecks.map((check) => (
                      <div key={check.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <div className="font-medium text-gray-800">{check.name}</div>
                          <div className="text-sm text-gray-600">
                            {check.conditions.length} condition{check.conditions.length !== 1 ? 's' : ''} • 
                            <span className={`ml-1 font-medium ${
                              check.severity === 'critical' ? 'text-red-600' :
                              check.severity === 'warning' ? 'text-yellow-600' :
                              'text-blue-600'
                            }`}>
                              {check.severity}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              runCustomCheck(check);
                            }}
                          >
                            Run
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              editCustomCheck(check);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button" 
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCustomCheck(check.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    {isDraggingOver 
                      ? "Drop templates here to add them" 
                      : "No custom checks saved yet"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* HISTORY TAB CONTENT */}
      {dataQualityActiveSubTab === 'history' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Run Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Properties Analyzed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issues Found
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quality Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {runHistory.length > 0 ? (
                  runHistory.map((run, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(run.date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {run.propertyCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-red-600 font-medium">{run.criticalCount}</span> Critical,{' '}
                        <span className="text-yellow-600 font-medium">{run.warningCount}</span> Warning,{' '}
                        <span className="text-blue-600 font-medium">{run.infoCount}</span> Info
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="font-medium text-green-600">{run.qualityScore}%</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                      No analysis runs yet. Run an analysis to see history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* PROPERTY DETAILS MODAL */}
      {showDetailsModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 overflow-y-auto"
          onClick={() => setShowDetailsModal(false)}
        >
          <div 
            className="bg-white rounded-lg w-[95%] max-w-6xl my-8 shadow-2xl flex flex-col"
            style={{ maxHeight: 'calc(100vh - 100px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  {modalData.title}
                </h3>
                <span className="text-sm text-gray-500">
                  ({modalData.properties.length} properties)
                </span>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none p-2"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Block
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Lot
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Qualifier
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Card
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Location
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Class
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Issue Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modalData.properties.map((prop, index) => {
                    const property = prop.details;
                    
                    return (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_block || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_lot || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_qualifier || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_card || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_location || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-900">
                          {property?.property_m4_class || ''}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {prop.message}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {modalData.properties.length > 10 && (
              <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center flex-shrink-0">
                <div className="text-sm text-gray-600">
                  Showing {modalData.properties.length} properties
                </div>
                <button
                  onClick={() => {
                    const scrollableDiv = document.querySelector('.overflow-y-auto.flex-1');
                    if (scrollableDiv) scrollableDiv.scrollTop = 0;
                  }}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Back to Top ↑
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DataQualityTab;
      
