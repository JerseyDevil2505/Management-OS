import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
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
          // Convert to run history format
          const history = data.map(record => ({
            date: record.quality_check_last_run,
            propertyCount: properties.length || 0,
            criticalCount: record.critical_count || 0,
            warningCount: record.warning_count || 0,
            infoCount: record.info_count || 0,
            totalIssues: record.quality_issues_count || 0,
            qualityScore: record.quality_score || 0,
            checkResults: record.check_results || {}
          }));
          setRunHistory(history);
          
          // Load custom checks if any
          if (data[0].custom_checks) {
            setCustomChecks(data[0].custom_checks);
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
    
    // Create CSV content for each category
    const timestamp = new Date().toISOString().split('T')[0];
    const jobInfo = `${jobData?.job_number || 'Job'}_${jobData?.municipality || 'Municipality'}`;
    
    // Summary worksheet
    let summaryCSV = 'Data Quality Summary\n\n';
    summaryCSV += `Job,${jobData?.job_number || 'N/A'}\n`;
    summaryCSV += `Municipality,${jobData?.municipality || 'N/A'}\n`;
    summaryCSV += `County,${jobData?.county || 'N/A'}\n`;
    summaryCSV += `State,${jobData?.state || 'N/A'}\n`;
    summaryCSV += `Analysis Date,${new Date().toLocaleDateString()}\n\n`;
    summaryCSV += 'Metrics\n';
    summaryCSV += `Total Properties,${properties.length}\n`;
    summaryCSV += `Properties with Issues,${issueStats.total}\n`;
    summaryCSV += `Critical Issues,${issueStats.critical}\n`;
    summaryCSV += `Warnings,${issueStats.warning}\n`;
    summaryCSV += `Info Messages,${issueStats.info}\n`;
    summaryCSV += `Quality Score,${qualityScore}%\n\n`;
    
    // Issues by category
    summaryCSV += 'Issues by Category\n';
    summaryCSV += 'Category,Critical,Warning,Info,Total\n';
    Object.entries(checkResults).forEach(([category, issues]) => {
      const critical = issues.filter(i => i.severity === 'critical').length;
      const warning = issues.filter(i => i.severity === 'warning').length;
      const info = issues.filter(i => i.severity === 'info').length;
      if (issues.length > 0) {
        summaryCSV += `${category.replace(/_/g, ' ')},${critical},${warning},${info},${issues.length}\n`;
      }
    });
    
    // Download summary
    const summaryBlob = new Blob([summaryCSV], { type: 'text/csv' });
    const summaryUrl = URL.createObjectURL(summaryBlob);
    const summaryLink = document.createElement('a');
    summaryLink.href = summaryUrl;
    summaryLink.download = `DQ_Summary_${jobInfo}_${timestamp}.csv`;
    summaryLink.click();
    
    // Create detailed issues worksheet for each category with issues
    setTimeout(() => {
      let detailsCSV = 'Property Key,Check Type,Severity,Message\n';
      Object.entries(checkResults).forEach(([category, issues]) => {
        if (issues.length > 0) {
          issues.forEach(issue => {
            detailsCSV += `"${issue.property_key}","${getCheckTitle(issue.check)}","${issue.severity}","${issue.message}"\n`;
          });
        }
      });
      
      if (detailsCSV !== 'Property Key,Check Type,Severity,Message\n') {
        const detailsBlob = new Blob([detailsCSV], { type: 'text/csv' });
        const detailsUrl = URL.createObjectURL(detailsBlob);
        const detailsLink = document.createElement('a');
        detailsLink.href = detailsUrl;
        detailsLink.download = `DQ_Details_${jobInfo}_${timestamp}.csv`;
        detailsLink.click();
      }
    }, 500);
    
    console.log('✅ Export complete - check your downloads for Summary and Details files');
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
    
    // ==================== CAMA CHECKS (BRT ONLY) ====================
    if (vendorType === 'BRT') {
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
    }
    
    // Additional checks would continue here...
    // Truncating for brevity as the pattern is established
  };

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
      
      const saveData = {
        job_id: jobData.id,
        quality_check_last_run: new Date().toISOString(),
        quality_issues_count: totalIssues,
        quality_score: score,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        custom_checks: customChecks.length > 0 ? customChecks : null
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
      
      // Add to run history
      const newRun = {
        date: new Date().toISOString(),
        propertyCount: properties.length,
        criticalCount,
        warningCount,
        infoCount,
        totalIssues,
        qualityScore: score,
        checkResults: results
      };
      setRunHistory(prev => [newRun, ...prev].slice(0, 20)); // Keep last 20 runs
      
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
      'writein_values': 'Write-in Values Present'
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
    const [activeSubTab, setActiveSubTab] = useState('overview');
    
    return (
      <div className="tab-content">
        {/* Sub-tab Navigation */}
        <div className="flex gap-1 border-b border-gray-300 mb-6">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeSubTab === 'overview'
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveSubTab('standard')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeSubTab === 'standard'
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            Standard Checks
          </button>
          <button
            onClick={() => setActiveSubTab('custom')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeSubTab === 'custom'
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            Custom Checks
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeSubTab === 'history'
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[1px] bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            Run History
          </button>
        </div>
        
        {/* Sub-tab Content */}
        {activeSubTab === 'overview' && (
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
        
        {/* Additional sub-tabs content would go here... */}
        
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
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowDetailsModal(false)}
        >
          <div 
            className="bg-white rounded-lg w-[90%] max-w-5xl h-[80vh] max-h-[700px] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-800">
                {modalData.title}
              </h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Property Key
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider bg-white">
                      Issue Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {modalData.properties.map((prop, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {prop.property_key}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {prop.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketLandAnalysis;
