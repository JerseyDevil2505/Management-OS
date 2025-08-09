import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, interpretCodes } from '../../lib/supabaseClient';
import { 
  AlertCircle, 
  Settings, 
  BarChart, 
  Map, 
  Calculator, 
  Layers,
  Check,
  X,
  RefreshCw,
  Download,
  Upload,
  Save,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import * as XLSX from 'xlsx';

const MarketLandAnalysis = ({ jobData }) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('data-quality');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [properties, setProperties] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalPropertyCount, setTotalPropertyCount] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  // DATA QUALITY STATE
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
    name: '',
    severity: 'warning',
    conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
  });
  const [vendorType, setVendorType] = useState(null);
  const [codeDefinitions, setCodeDefinitions] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [modalData, setModalData] = useState({ title: '', properties: [] });
  const [expandedCategories, setExpandedCategories] = useState(['mod_iv']);
  const [isRunningChecks, setIsRunningChecks] = useState(false);
  const [dataQualityActiveSubTab, setDataQualityActiveSubTab] = useState('overview');


  // ESC key handler for modal
  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setShowDetailsModal(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);
  
  // Load run history on mount
  useEffect(() => {
    const loadRunHistory = async () => {
      if (!jobData?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('market_land_valuation')
          .select('*')
          .eq('job_id', jobData.id)
          .order('quality_check_last_run', { ascending: false });
        
if (data && data.length > 0) {
          // Load run history from quality_check_results
          if (data[0].quality_check_results?.history) {
            setRunHistory(data[0].quality_check_results.history);
          }
          
          // Load current results if any
          if (data[0].quality_check_results?.current) {
            setCheckResults(data[0].quality_check_results.current);
            
            // Calculate stats from loaded results
            let critical = 0, warning = 0, info = 0;
            Object.values(data[0].quality_check_results.current).forEach(category => {
              category.forEach(issue => {
                if (issue.severity === 'critical') critical++;
                else if (issue.severity === 'warning') warning++;
                else if (issue.severity === 'info') info++;
              });
            });
            
            setIssueStats({
              critical,
              warning,
              info,
              total: critical + warning + info
            });
          }
          
          // Load custom checks if any
          if (data[0].custom_checks) {
            setCustomChecks(data[0].custom_checks);
          }
          
          // Set quality score if available
          if (data[0].quality_score) {
            setQualityScore(data[0].quality_score);
          }
        }
      } catch (error) {
        console.error('Error loading run history:', error);
      }
    };
    
    loadRunHistory();
  }, [jobData?.id, properties.length]);
  
  // Pre-Valuation State (Normalization + Page by Page)
  const [targetYear, setTargetYear] = useState(2012);
  const [equalizationRatio, setEqualizationRatio] = useState(85.0);
  const [normalizedData, setNormalizedData] = useState([]);
  const [pageByPageData, setPageByPageData] = useState([]);
  
  // Overall Analysis State
  const [blockAnalysis, setBlockAnalysis] = useState([]);
  const [colorScaleStart, setColorScaleStart] = useState(100000);
  const [colorScaleIncrement, setColorScaleIncrement] = useState(50000);
  
  // Land Valuation State
  const [vacantSales, setVacantSales] = useState([]);
  const [rawLandRate, setRawLandRate] = useState(null);
  const [vcsRates, setVcsRates] = useState({});
  const [economicFactors, setEconomicFactors] = useState([]);
  
  // Cost Valuation State
  const [costConversionFactor, setCostConversionFactor] = useState(1.0);
  const [newConstructionData, setNewConstructionData] = useState([]);
  
  // Attribute & Card Analytics State
  const [conditionAdjustments, setConditionAdjustments] = useState({});
  const [additionalCards, setAdditionalCards] = useState([]);

  // ==================== LOAD PROPERTIES WITH PAGINATION ====================
  useEffect(() => {
    const loadProperties = async () => {
      if (!jobData?.id) return;
      
      setIsLoading(true);
      setLoadingProgress(0);
      setLoadedCount(0);
      
      try {
        // First, get the total count
        const { count, error: countError } = await supabase
          .from('property_records')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', jobData.id);
        
        if (countError) throw countError;
        
        setTotalPropertyCount(count || 0);
        console.log(`📊 Total properties to load: ${count}`);
        
        if (!count || count === 0) {
          setProperties([]);
          setIsLoading(false);
          return;
        }
        
        // Calculate number of pages needed (1000 per page)
        const pageSize = 1000;
        const totalPages = Math.ceil(count / pageSize);
        const allProperties = [];
        
        // Load properties in batches
        for (let page = 0; page < totalPages; page++) {
          const start = page * pageSize;
          const end = Math.min(start + pageSize - 1, count - 1);
          
          console.log(`📥 Loading batch ${page + 1}/${totalPages} (${start}-${end})...`);
          
          const { data, error } = await supabase
            .from('property_records')
            .select('*')
            .eq('job_id', jobData.id)
            .order('property_composite_key')
            .range(start, end);
          
          if (error) throw error;
          
          if (data) {
            allProperties.push(...data);
            const loaded = allProperties.length;
            setLoadedCount(loaded);
            setLoadingProgress(Math.round((loaded / count) * 100));
            
            // Update properties state incrementally for better UX
            setProperties([...allProperties]);
          }
          
          // Small delay between batches to prevent overwhelming the server
          if (page < totalPages - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        console.log(`✅ Successfully loaded ${allProperties.length} properties`);
        
        // Detect vendor type from the first property
        if (allProperties.length > 0) {
          const firstProp = allProperties[0];
          const vendor = firstProp.vendor_source || jobData.vendor_source || 'BRT';
          setVendorType(vendor);
          console.log(`🏢 Vendor type detected: ${vendor}`);
        }
        
        // Parse code definitions if available
        if (jobData.parsed_code_definitions) {
          setCodeDefinitions(jobData.parsed_code_definitions);
        }
        
      } catch (error) {
        console.error('❌ Error loading properties:', error);
        setProperties([]);
      } finally {
        setIsLoading(false);
        setLoadingProgress(100);
      }
    };

    loadProperties();
  }, [jobData?.id]);  

  // ==================== TAB CONFIGURATION ====================
  const tabs = [
    { id: 'data-quality', label: 'Data Quality/Error Checking', icon: '📊' },
    { id: 'pre-valuation', label: 'Pre-Valuation Setup', icon: '⚙️' },
    { id: 'overall-analysis', label: 'Overall Analysis', icon: '📈' },
    { id: 'land-valuation', label: 'Land Valuation', icon: '🏞️' },
    { id: 'cost-valuation', label: 'Cost Valuation', icon: '💰' },
    { id: 'attribute-cards', label: 'Attribute & Card Analytics', icon: '🎯' }
  ];

  // ==================== SAVE FUNCTIONALITY ====================
  const handleSave = async () => {
    setIsSaving(true);
    try {
      // TODO: Implement save logic for current tab
      setLastSaved(new Date());
      setUnsavedChanges(false);
      console.log('Analysis data saved successfully');
    } catch (error) {
      console.error('Error saving analysis:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== CUSTOM CHECK FUNCTIONS ====================
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
    if (!currentCustomCheck.name || currentCustomCheck.conditions.some(c => !c.field)) {
      alert('Please complete all fields before saving');
      return;
    }
    
    setCustomChecks(prev => [...prev, { ...currentCustomCheck, id: Date.now() }]);
    setCurrentCustomCheck({
      name: '',
      severity: 'warning',
      conditions: [{ logic: 'IF', field: '', operator: '=', value: '' }]
    });
    
    // Save to database
    saveCustomChecksToDb([...customChecks, currentCustomCheck]);
  };
  
  const deleteCustomCheck = (checkId) => {
    setCustomChecks(prev => prev.filter(check => check.id !== checkId));
    saveCustomChecksToDb(customChecks.filter(check => check.id !== checkId));
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
  
  const runCustomCheck = async (check) => {
    const results = { custom: [] };
    
    for (const property of properties) {
      let conditionMet = true;
      
      for (let i = 0; i < check.conditions.length; i++) {
        const condition = check.conditions[i];
        const fieldValue = property[condition.field];
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
    
    // Merge with existing results
    setCheckResults(prev => ({
      ...prev,
      custom: [...(prev.custom || []), ...results.custom]
    }));
    
    // Update stats
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
    // Clear existing custom results
    setCheckResults(prev => ({ ...prev, custom: [] }));
    
    for (const check of customChecks) {
      await runCustomCheck(check);
    }
  };

  // ==================== DATA QUALITY FUNCTIONS ====================
const exportToExcel = () => {
    if (Object.keys(checkResults).length === 0) return;
    
    // Create a new workbook
    const wb = XLSX.utils.book_new();
    
    // Get job info for filename
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    // === SUMMARY SHEET ===
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
    
    // Add category breakdowns
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
    
    // Set column widths for summary
    summarySheet['!cols'] = [
      { wch: 35 }, // Category column (was 30)
      { wch: 18 }, // Numbers columns (was 15)
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ];
    
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    
    // === DETAILS SHEET ===
    const detailsData = [
      ['Block', 'Lot', 'Qualifier', 'Card', 'Location', 'Class', 'Check Type', 'Severity', 'Message']
    ];
    
    // Process all issues
    Object.entries(checkResults).forEach(([category, issues]) => {
      if (issues && issues.length > 0) {
        issues.forEach(issue => {
          // Find the full property details
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
            const keyParts = issue.property_key.split('_');
            detailsData.push([
              keyParts[0] || '',  // Block
              keyParts[1] || '',  // Lot
              keyParts[2] || '',  // Qualifier
              keyParts[3] || '',  // Card
              keyParts[4] || '',  // Location
              '',  // Class (can't determine from key)
              getCheckTitle(issue.check),
              issue.severity,
              issue.message
            ]);
          }
        });
      }
    });
    
    const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Set column widths for details
    detailsSheet['!cols'] = [
      { wch: 15 }, // Block
      { wch: 15 }, // Lot  
      { wch: 12 }, // Qualifier
      { wch: 10 }, // Card
      { wch: 20 }, // Location
      { wch: 10 }, // Class
      { wch: 45 }, // Check Type
      { wch: 12 }, // Severity
      { wch: 60 }  // Message
    ];
    
    // Apply header formatting (bold)
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
    
    // Write the file
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
      // Detect vendor type
      const vendor = vendorType || jobData.vendor_source || 'BRT';
      setVendorType(vendor);
      
      // Process properties in batches
      const pageSize = 1000;
      const totalPages = Math.ceil(properties.length / pageSize);
      
      for (let page = 0; page < totalPages; page++) {
        const batch = properties.slice(page * pageSize, (page + 1) * pageSize);
        console.log(`Processing batch ${page + 1} of ${totalPages}...`);
        
        for (const property of batch) {
          await runPropertyChecks(property, results);
        }
      }

      // Debug what we found before saving
      console.log('=== QUALITY CHECK COMPLETE ===');
      console.log(`Total properties analyzed: ${properties.length}`);
      console.log('Issues found by category:');
      Object.entries(results).forEach(([category, issues]) => {
        console.log(`  ${category}: ${issues.length} issues`);
        if (category === 'special' && issues.length > 0) {
          // Log types of special issues found
          const specialTypes = [...new Set(issues.map(i => i.check))];
          specialTypes.forEach(type => {
            const count = issues.filter(i => i.check === type).length;
            console.log(`    - ${type}: ${count} properties`);
          });
        }
      });
      
      // Save results
      await saveQualityResults(results);
      
      // Calculate quality score
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
    const vendorType = property.vendor_source || jobData.vendor_source || 'BRT';
    const rawData = property.raw_data || {};
    
    // ==================== MOD IV CHECKS ====================
    const m4Class = property.property_m4_class;
    const modImprovement = property.values_mod_improvement || 0;
    const modLand = property.values_mod_land || 0;
    const modTotal = property.values_mod_total || 0;
    
    // Class 1/3B cannot have improvements
    if ((m4Class === '1' || m4Class === '3B') && modImprovement > 0) {
      results.mod_iv.push({
        check: 'vacant_land_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property has improvements: $${modImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    // Class 2/3A/4A-C must have improvements
    if (['2', '3A', '4A', '4B', '4C'].includes(m4Class) && modImprovement === 0) {
      results.mod_iv.push({
        check: 'missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property missing improvements`,
        details: property
      });
    }
    
    // Class 15A-15F must have facility populated
    if (['15A', '15B', '15C', '15D', '15E', '15F'].includes(m4Class) && !property.property_facility) {
      results.mod_iv.push({
        check: 'missing_facility',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} missing facility information`,
        details: property
      });
    }
    
    // Farmland pairing checks
    if (m4Class === '3B' && !property.property_composite_key.includes('Q')) {
      results.mod_iv.push({
        check: 'farm_building_no_qualifier',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Class 3B with no qualifier (should be farm building)',
        details: property
      });
    }
    
// ==================== CAMA CHECKS ====================
    // Run for BOTH vendors, not just BRT
    const camaClass = property.property_cama_class;
    const camaImprovement = property.values_cama_improvement || 0;
    
    // Class 1/3B shouldn't have CAMA improvements
    if ((camaClass === '1' || camaClass === '3B') && camaImprovement > 0) {
      results.cama.push({
        check: 'cama_vacant_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} has improvements: $${camaImprovement.toLocaleString()}`,
        details: property
      });
    }
    
    // Class 2/3A/4A-C must have CAMA improvements
    if (['2', '3A', '4A', '4B', '4C'].includes(camaClass) && camaImprovement === 0) {
      results.cama.push({
        check: 'cama_missing_improvements',
        severity: 'critical',
        property_key: property.property_composite_key,
        message: `CAMA Class ${camaClass} missing improvements`,
        details: property
      });
    }
    
    // ==================== BUILDING CLASS CHECKS ====================
    const buildingClass = property.asset_building_class;
    const typeUse = property.asset_type_use;
    const designStyle = property.asset_design_style;
    
    // Rule 1: Non-residential classes (not 2 or 3A) should be building class 10
    if (m4Class && m4Class !== '2' && m4Class !== '3A') {
      if (buildingClass && buildingClass !== 10) {
        results.characteristics.push({
          check: 'non_residential_wrong_building_class',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Class ${m4Class} should have building class 10 (has ${buildingClass})`,
          details: property
        });
      }
    }
    
    // Rule 2: Residential classes (2 or 3A) should NOT be building class 10
    if ((m4Class === '2' || m4Class === '3A') && buildingClass === 10) {
      results.characteristics.push({
        check: 'residential_building_class_10',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} shouldn't have building class 10 (needs >10)`,
        details: property
      });
    }
    
    // If building class > 10, must have design and type use
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
    
    // INVERSE CHECK: If design is populated, should have building class > 10 and type use
    if (designStyle && designStyle.trim() !== '') {
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
    
    // ==================== DESIGN STYLE CHECKS ====================
    if (designStyle) {
      // Use the utility to get the decoded design name
      const designDescription = interpretCodes.getDesignName(property, codeDefinitions, vendorType) || designStyle;
      
      // Now do fuzzy matching against standard designs
      const designLower = designDescription.toLowerCase();
      const standardDesigns = [
        'colonial', 'split level', 'split-level', 'bilevel', 'bi-level', 'bi level',
        'cape cod', 'cape', 'ranch', 'rancher', 'raised ranch', 'bungalow', 
        'twin', 'townhouse end', 'townhouse int', 'townhouse interior', 'townhouse',
        'one bed', '1bed', '1 bed', '1 bedroom', 'one bedroom',
        'two bed', '2bed', '2 bed', '2 bedroom', 'two bedroom',
        'three bed', '3bed', '3 bed', '3 bedroom', 'three bedroom'
      ];
      
      const isStandard = standardDesigns.some(std => {
        const stdLower = std.toLowerCase();
        return designLower.includes(stdLower) || stdLower.includes(designLower);
      });
      
      if (!isStandard) {
        results.characteristics.push({
          check: 'non_standard_design',
          severity: 'info',
          property_key: property.property_composite_key,
          message: `Non-standard design: ${designDescription}${designStyle !== designDescription ? ` (code: ${designStyle})` : ''}`,
          details: property
        });
      }
    }
    
    // ==================== TYPE USE TO BUILDING CLASS VALIDATION ====================
    if (typeUse && buildingClass) {
      // Use the utility to get the decoded type name
      const typeUseDescription = interpretCodes.getTypeName(property, codeDefinitions, vendorType) || typeUse;
      
      // Fuzzy matching on the description
      const typeUseLower = typeUseDescription.toLowerCase();
      let validClasses = [];
      
      if (typeUseLower.includes('single') || typeUseLower.includes('one family') || 
          typeUseLower.includes('1 family') || typeUseLower.includes('1family') ||
          typeUseLower.includes('onefamily') || typeUseLower === 'sf') {
        validClasses = [16, 17, 18, 19, 20, 21, 22, 23];
      } 
      else if (typeUseLower.includes('twin') || typeUseLower.includes('semi') || 
               typeUseLower.includes('semidetached') || typeUseLower.includes('duplex')) {
        validClasses = [25, 27, 29, 31];
      } 
      else if (typeUseLower.includes('condo') || typeUseLower.includes('townhouse') || 
               typeUseLower.includes('townhome') || typeUseLower.includes('row')) {
        validClasses = [33, 35, 37, 39];
      } 
      else if (typeUseLower.includes('multi') || typeUseLower.includes('two family') || 
               typeUseLower.includes('2 family') || typeUseLower.includes('apartment')) {
        validClasses = [43, 45, 47, 49];
      }
      
      if (validClasses.length > 0 && !validClasses.includes(buildingClass)) {
        results.characteristics.push({
          check: 'type_use_building_class_mismatch',
          severity: 'warning',
          property_key: property.property_composite_key,
          message: `Type use "${typeUseDescription}"${typeUse !== typeUseDescription ? ` (code: ${typeUse})` : ''} doesn't match building class ${buildingClass} (expected: ${validClasses.join(', ')})`,
          details: property
        });
      }
    }
    
    // ==================== LOT SIZE CHECKS ====================
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
    
    // ==================== LIVING AREA & YEAR BUILT ====================
    const sfla = property.asset_sfla || 0;
    const yearBuilt = property.asset_year_built;
    
    // Class 2/3A must have living area
    if ((m4Class === '2' || m4Class === '3A') && sfla === 0) {
      results.characteristics.push({
        check: 'missing_sfla',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: `Class ${m4Class} property missing living area`,
        details: property
      });
    }
    
    // Year built validation for improved properties
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10 && !yearBuilt) {
      results.characteristics.push({
        check: 'missing_year_built',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Improved property missing year built',
        details: property
      });
    }
    
    // ==================== VCS CHECK ====================
    if (!property.property_vcs) {
      results.special.push({
        check: 'missing_vcs',
        severity: 'warning',
        property_key: property.property_composite_key,
        message: 'Property missing VCS code',
        details: property
      });
    }
    
    // ==================== CONDITION CHECKS ====================
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
    
// ==================== PARTIAL HEATING/COOLING SYSTEMS (RAW_DATA) ====================
    if (vendorType === 'BRT') {
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
    } else if (vendorType === 'Microsystems') {
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
    
// ==================== BEDROOM COUNT VALIDATION (RAW_DATA) ====================
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (vendorType === 'BRT') {
        const bedTotal = interpretCodes.getRawDataValue(property, 'bedrooms', vendorType);
        if (!bedTotal || parseInt(bedTotal) === 0) {
          results.rooms.push({
            check: 'zero_bedrooms',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: 'Residential property has zero bedrooms',
            details: property
          });
        }
      } else if (vendorType === 'Microsystems') {
        const totalBeds = interpretCodes.getBedroomRoomSum(property, vendorType);
        
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
    // ==================== BATHROOM COUNT CROSS-CHECK ====================
    if ((m4Class === '2' || m4Class === '3A') && buildingClass > 10) {
      if (vendorType === 'BRT') {
        // For BRT: Compare BATHTOT to sum of PLUMBING2FIX through PLUMBING6FIX
        const bathTotal = parseInt(rawData.BATHTOT) || 0;
        const plumbingSum = interpretCodes.getBathroomPlumbingSum(property, vendorType);
        
        if (bathTotal !== plumbingSum && plumbingSum > 0) {
          results.rooms.push({
            check: 'bathroom_count_mismatch',
            severity: 'warning',
            property_key: property.property_composite_key,
            message: `Bathroom total (${bathTotal}) doesn't match plumbing sum (${plumbingSum})`,
            details: property
          });
        }
      } else if (vendorType === 'Microsystems') {
        // For Microsystems: Compare summary fields to floor-specific fields
        const fixtureSum = interpretCodes.getBathroomFixtureSum(property, vendorType);
        const roomSum = interpretCodes.getBathroomRoomSum(property, vendorType);
        
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
 
    // ==================== DETACHED ITEMS MISSING DEPRECIATION ====================
    // Check if detached items exist but have no depreciation
    if (vendorType === 'BRT') {
      // BRT: Check DETACHEDCODE_1 through DETACHEDCODE_11
      for (let i = 1; i <= 11; i++) {
        const detachedCode = rawData[`DETACHEDCODE_${i}`];
        const detachedNC = rawData[`DETACHEDNC_${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          // Has a detached item, check if depreciation is missing or zero
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
    } else if (vendorType === 'Microsystems') {
      // Microsystems: Check Detached Item Code1-4 and their depreciation fields
      for (let i = 1; i <= 4; i++) {
        const detachedCode = rawData[`Detached Item Code${i}`];
        const physicalDepr = rawData[`Physical Depr${i}`];
        const functionalDepr = rawData[`Functional Depr${i}`];
        const locationalDepr = rawData[`Locational Depr${i}`];
        
        if (!interpretCodes.isFieldEmpty(detachedCode)) {
          // Has a detached item, check if ALL depreciation fields are missing/zero
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
// ==================== LAND ADJUSTMENTS ====================
    // Flag properties with any land adjustments (want clean slate)
    if (vendorType === 'BRT') {
      // BRT: Check all LANDUR condition/influence fields
      let hasLandAdjustments = false;
      
for (let i = 1; i <= 6; i++) {
        // Check urban condition
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURCONDPC_${i}`] && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        // Check urban influence
        if (!interpretCodes.isFieldEmpty(rawData[`LANDURINFL_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDURINFLPC_${i}`] && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 0 && parseFloat(rawData[`LANDURINFLPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        // Check frontage condition
        if (!interpretCodes.isFieldEmpty(rawData[`LANDFFCOND_${i}`])) {
          hasLandAdjustments = true;
          break;
        }
        if (rawData[`LANDFFCONDPC_${i}`] && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 0 && parseFloat(rawData[`LANDFFCONDPC_${i}`]) !== 100) {
          hasLandAdjustments = true;
          break;
        }
        // Check frontage influence
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
    } else if (vendorType === 'Microsystems') {
      // Microsystems: Check Net Adjustment and Unit Adjustment fields
      let hasLandAdjustments = false;
      
      // Check Net Adjustments
      for (let i = 1; i <= 3; i++) {
        const netAdj = rawData[`Net Adjustment${i}`];
        const adjCode = rawData[`Adj Reason Code${i}`];
        
        if ((netAdj && parseFloat(netAdj) !== 0) || !interpretCodes.isFieldEmpty(adjCode)) {
          hasLandAdjustments = true;
          break;
        }
      }
      
      // Check Unit Adjustments
      if (!hasLandAdjustments) {
        const unitAdj1 = rawData['Unit Adjustment1'];
        const unitAdj2 = rawData['Unit Adjustment2'];
        const unitAdj = rawData['Unit Adjustment'];
        const unitCode1 = rawData['Unit Adj Code1'];
        const unitCode2 = rawData['Unit Adj Code2'];
        const unitCode = rawData['Unit Adj Code'];
        
        if ((unitAdj1 && parseFloat(unitAdj1) !== 0) || 
            (unitAdj2 && parseFloat(unitAdj2) !== 0) ||
            (unitAdj && parseFloat(unitAdj) !== 0) ||
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

    // ==================== MARKET ADJUSTMENTS ====================
    // Flag pre-existing market adjustments (want clean baseline)
    if (vendorType === 'BRT') {
      // BRT: Check multiple market adjustment fields
      const issues = [];
      
      // MKTADJ should equal 1
      if (rawData.MKTADJ && parseFloat(rawData.MKTADJ) !== 1) {
        issues.push(`MKTADJ = ${rawData.MKTADJ} (should be 1)`);
      }
      
      // NCOVR should equal 0
      if (rawData.NCOVR && parseFloat(rawData.NCOVR) !== 0) {
        issues.push(`NCOVR = ${rawData.NCOVR} (should be 0)`);
      }
      
      // NCREDIRECT should be empty
      if (!interpretCodes.isFieldEmpty(rawData.NCREDIRECT)) {
        issues.push('NC Redirect value present');
      }
      
      // Market influence fields should be 0
      if (rawData.NCMKTINFLNC && parseFloat(rawData.NCMKTINFLNC) !== 0) {
        issues.push(`NC Market Influence = ${rawData.NCMKTINFLNC}`);
      }
      if (rawData.NCMKTINFPC && parseFloat(rawData.NCMKTINFPC) !== 0) {
        issues.push(`NC Market Influence % = ${rawData.NCMKTINFPC}`);
      }
      
      // Market descriptions should be empty
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
      
      // Market percentages should be 100
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
    } else if (vendorType === 'Microsystems') {
      // Microsystems: Check depreciation fields
      const issues = [];
      
      if (rawData['Over Improved Depr1'] && parseFloat(rawData['Over Improved Depr1']) !== 0) {
        issues.push('Over Improved Depr1');
      }
      if (rawData['Over Improved Depr2'] && parseFloat(rawData['Over Improved Depr2']) !== 0) {
        issues.push('Over Improved Depr2');
      }
      if (rawData['Economic Depr'] && parseFloat(rawData['Economic Depr']) !== 0) {
        issues.push('Economic Depr');
      }
      if (rawData['Under Improved Depr'] && parseFloat(rawData['Under Improved Depr']) !== 0) {
        issues.push('Under Improved Depr');
      }
      if (rawData['Function Depr'] && parseFloat(rawData['Function Depr']) !== 0) {
        issues.push('Function Depr');
      }
      if (!interpretCodes.isFieldEmpty(rawData['Location Code'])) {
        issues.push('Location Code');
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
    
    // ==================== FLAT ADD VALUES/OVERRIDES ====================
    // Flag manual overrides that bypass calculations
    if (vendorType === 'BRT') {
      const overrides = [];
      
      // Check value overrides
      if (!interpretCodes.isFieldEmpty(rawData.IMPROVVALUEOVR)) {
        overrides.push('Improvement value override');
      }
      if (!interpretCodes.isFieldEmpty(rawData.LANDVALUEOVR)) {
        overrides.push('Land value override');
      }
      
      // Check write-in values
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
    } else if (vendorType === 'Microsystems') {
      const overrides = [];
      
      // Check flat add descriptions
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
      // Check flat add values
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
  };  // This closes runPropertyChecks function

  const saveQualityResults = async (results) => {
    try {
      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      
      // Count issues without storing details
      Object.values(results).forEach(category => {
        category.forEach(issue => {
          if (issue.severity === 'critical') criticalCount++;
          else if (issue.severity === 'warning') warningCount++;
          else if (issue.severity === 'info') infoCount++;
        });
      });
      
      const totalIssues = criticalCount + warningCount + infoCount;
      const score = calculateQualityScore(results);
      
      // Check if record exists
      const { data: existing } = await supabase
        .from('market_land_valuation')
        .select('id')
        .eq('job_id', jobData.id)
        .single();
      
    // Create new run entry
      const newRun = {
        date: new Date().toISOString(),
        propertyCount: properties.length,
        criticalCount,
        warningCount,
        infoCount,
        totalIssues,
        qualityScore: score
      };
      
      // Get existing history from quality_check_results or create new structure
      const existingResults = existing?.quality_check_results || {};
      const existingHistory = existingResults.history || [];
      const updatedHistory = [newRun, ...existingHistory].slice(0, 50); // Keep last 50 runs
      
      // Store summary and history only (not full results with details)
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
        history: updatedHistory  // Historical runs
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
        quality_check_results: qualityCheckResults  // Store everything here
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
      
      // Update local state with new history
      setRunHistory(updatedHistory);
      
      // Keep full results in state for display
      setCheckResults(results);
      setIssueStats({
        critical: criticalCount,
        warning: warningCount,
        info: infoCount,
        total: totalIssues
      });
      
      setUnsavedChanges(false);
      console.log(`✅ Saved: ${totalIssues} issues found`);
      
    } catch (error) {
      console.error('Error saving:', error);
      setCheckResults(results); // Still show results even if save fails
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
    const titles = {
      // MOD IV
      'vacant_land_improvements': 'Vacant Land with Improvements',
      'missing_improvements': 'Properties Missing Improvements',
      'missing_facility': 'Missing Facility Information',
      'farm_building_no_qualifier': 'Farm Building Without Qualifier',
      
      // CAMA
      'cama_vacant_improvements': 'CAMA Vacant Land with Improvements',
      'cama_missing_improvements': 'CAMA Properties Missing Improvements',
      
      // Building/Design - UPDATED!
      'non_residential_wrong_building_class': 'Non-Residential with Wrong Building Class',
      'residential_building_class_10': 'Residential Properties with Building Class 10',
      'missing_design_style': 'Missing Design Style',
      'missing_type_use': 'Missing Type Use',
      'design_without_proper_building_class': 'Has Design but Wrong Building Class',
      'design_without_type_use': 'Has Design but Missing Type Use',
      'type_use_building_class_mismatch': 'Type Use/Building Class Mismatch',
      'non_standard_design': 'Non-Standard Design',
      'colonial_story_mismatch': 'Colonial Story Height Issue',
      'ranch_story_mismatch': 'Ranch Story Height Issue',
      'split_level_story_mismatch': 'Split Level Story Height Issue',
      'raised_ranch_story_mismatch': 'Raised Ranch Story Height Issue',
      'cape_bungalow_story_mismatch': 'Cape/Bungalow Story Height Issue',
      
      // Characteristics
      'zero_lot_size': 'Properties with Zero Lot Size',
      'missing_sfla': 'Missing Living Area',
      'missing_year_built': 'Missing Year Built',
      'missing_ext_condition': 'Missing Exterior Condition',
      'missing_int_condition': 'Missing Interior Condition',
      
      // Rooms
      'zero_bedrooms': 'Properties with Zero Bedrooms',
      'bathroom_count_mismatch': 'Bathroom Count Mismatch',
      
      // Special
      'missing_vcs': 'Missing VCS Code',
      'partial_cooling': 'Partial AC System',
      'partial_heating': 'Partial Heating System',
      'living_basement': 'Properties with Living Basement',
      'detached_missing_depreciation': 'Detached Items Missing Depreciation',
      'land_adjustments_exist': 'Properties with Land Adjustments',
      'market_adjustments_exist': 'Properties with Market Adjustments',
      'market_adjustment_factor': 'Market Adjustment Factor Issue',
      'ncovr_not_zero': 'NCOVR Not Zero',
      'market_adjustment_descriptions': 'Market Adjustment Descriptions Present',
      'market_adjustment_percentages': 'Market Adjustment Percentages Not 100%',
      'nc_redirect_exists': 'NC Redirect Value Present',
      'nc_market_influence': 'NC Market Influence Values Present',
      'flat_add_values': 'Flat Add/Override Values Present',
      'value_overrides': 'Value Overrides Present',
      'writein_values': 'Write-in Values Present',
      
      // Add any missing check types we've created
      'detached_missing_depreciation': 'Detached Items Missing Depreciation',
      'land_adjustments_exist': 'Properties with Land Adjustments',
      'market_adjustments_exist': 'Properties with Market Adjustments',
      'value_overrides': 'Manual Value Overrides Present'
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

  // ==================== TAB COMPONENTS ====================
  
  // Data Quality Tab
  const DataQualityTab = () => {
  // activeSubTab state is now managed by parent
    
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
            Standard Checks
          </button>
          <button
            onClick={() => setDataQualityActiveSubTab('custom')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              dataQualityActiveSubTab === 'custom'
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            Custom Checks
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
        
        {/* Sub-tab Content */}
        {dataQualityActiveSubTab === 'overview' && (
          <div>
            {/* Header Section */}
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-gray-800 mb-2">
                Data Quality Analysis
              </h3>
              <p className="text-gray-600">
                {isLoading 
                  ? `Loading ${loadedCount.toLocaleString()} of ${totalPropertyCount.toLocaleString()} properties...`
                  : `Analyzing ${properties.length.toLocaleString()} properties for data integrity issues`
                }
              </p>
            </div>

            {/* Loading Progress Bar */}
            {isLoading && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Loading Properties</span>
                  <span className="text-sm font-medium text-blue-600">{loadingProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                  >
                    <div className="h-full bg-white bg-opacity-30 animate-pulse"></div>
                  </div>
                </div>
                <div className="mt-2 text-center text-sm text-gray-600">
                  {loadedCount > 0 && (
                    <span>
                      Loaded {loadedCount.toLocaleString()} properties
                      {loadedCount < totalPropertyCount && 
                        ` • ${Math.ceil((totalPropertyCount - loadedCount) / 1000)} batches remaining`
                      }
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 mb-6">
              <button 
                onClick={runQualityChecks}
                disabled={isRunningChecks || isLoading}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-all ${
                  isRunningChecks || isLoading
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

            {/* Metrics Cards Grid */}
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
        
        {/* Standard Checks Tab */}
        {dataQualityActiveSubTab === 'standard' && (
          <div>
            {/* Debug logging */}
            {console.log('🔍 Standard Checks - checkResults:', checkResults)}
            {console.log('🔍 Standard Checks - mod_iv issues:', checkResults.mod_iv?.length || 0)}
            
            {/* Check Results */}
            {Object.keys(checkResults).length > 0 ? (
              <div>
                <h4 className="text-lg font-semibold text-gray-800 mb-4">
                  Check Results by Category
                </h4>
                
                {Object.entries(checkResults).map(([category, issues]) => {
                  // Add null check and skip empty categories
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
        
        {/* Custom Checks Tab */}
        {dataQualityActiveSubTab === 'custom' && (
          <div>
            <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Custom Check Builder</h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Check Name</label>
                    <input 
                      type="text"
                      placeholder="e.g., Missing Tax ID for Commercial"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={currentCustomCheck.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setCurrentCustomCheck(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                    <select 
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      value={currentCustomCheck.severity}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setCurrentCustomCheck(prev => ({ ...prev, severity: e.target.value }))}
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
                        <option value="property_m4_class">Property M4 Class</option>
                        <option value="asset_building_class">Building Class</option>
                        <option value="asset_sfla">Living Area (SFLA)</option>
                        <option value="asset_year_built">Year Built</option>
                        <option value="values_mod_improvement">Mod Improvement Value</option>
                        <option value="values_mod_land">Mod Land Value</option>
                        <option value="property_vcs">VCS Code</option>
                        <option value="asset_design_style">Design Style</option>
                        <option value="asset_type_use">Type Use</option>
                        <option value="asset_lot_acre">Lot Acres</option>
                        <option value="asset_ext_cond">Exterior Condition</option>
                        <option value="asset_int_cond">Interior Condition</option>
                      </select>
                      
                      <select 
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        value={condition.operator}
                        onClick={(e) => e.stopPropagation()}
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
                      </select>
                      
                      <input 
                        type="text" 
                        placeholder="Value"
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1"
                        value={condition.value}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateCustomCheckCondition(index, 'value', e.target.value)}
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
            
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Saved Custom Checks</h3>
                {customChecks.length > 0 && (
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
                <p className="text-gray-500 text-center py-8">No custom checks saved yet</p>
              )}
            </div>
          </div>
        )}
        
        {/* Run History Tab */}
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
      </div>
    );
  };

  // ==================== MAIN RENDER ====================
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Market & Land Analysis</h1>
              <p className="text-sm text-gray-600 mt-1">
                Job #{jobData?.job_number} • {jobData?.municipality}, {jobData?.county} {jobData?.state}
              </p>
            </div>
            <div className="flex items-center gap-4">
              {lastSaved && (
                <span className="text-sm text-gray-500">
                  Last saved: {lastSaved.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={isSaving || !unsavedChanges}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  isSaving || !unsavedChanges
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 font-medium text-sm transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="px-6 py-6">
        {activeTab === 'data-quality' && <DataQualityTab />}
        {activeTab === 'pre-valuation' && (
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Pre-Valuation Setup</h2>
            <p className="text-gray-600">Configure normalization and page-by-page analysis settings.</p>
          </div>
        )}
        {activeTab === 'overall-analysis' && (
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Overall Analysis</h2>
            <p className="text-gray-600">View comprehensive property analysis and block-level insights.</p>
          </div>
        )}
        {activeTab === 'land-valuation' && (
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Land Valuation</h2>
            <p className="text-gray-600">Analyze vacant sales and calculate land rates by VCS.</p>
          </div>
        )}
        {activeTab === 'cost-valuation' && (
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Cost Valuation</h2>
            <p className="text-gray-600">Review cost approach factors and new construction analysis.</p>
          </div>
        )}
        {activeTab === 'attribute-cards' && (
          <div className="bg-white rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Attribute & Card Analytics</h2>
            <p className="text-gray-600">Analyze property attributes and generate analytical cards.</p>
          </div>
        )}
      </div>

      {/* Property Details Modal */}
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
                    // Get the full property details from the details object
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
            
            {/* Navigation Footer - Back to Top button when many properties */}
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

export default MarketLandAnalysis;
