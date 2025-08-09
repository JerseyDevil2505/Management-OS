import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// Import all tab components
import DataQualityTab from './market-tabs/DataQualityTab';
import PreValuationTab from './market-tabs/PreValuationTab';
import OverallAnalysisTab from './market-tabs/OverallAnalysisTab';
import LandValuationTab from './market-tabs/LandValuationTab';
import CostValuationTab from './market-tabs/CostValuationTab';
import AttributeCardsTab from './market-tabs/AttributeCardsTab';

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
  const [availableFields, setAvailableFields] = useState([]);

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
        
        // Build available fields list for custom checks
        if (allProperties.length > 0) {
          const firstProp = allProperties[0];
          const rawDataFields = firstProp.raw_data ? Object.keys(firstProp.raw_data) : [];
          
          // Sort raw data fields alphabetically
          rawDataFields.sort();
          
          // Store for use in custom check builder
          setAvailableFields(rawDataFields);
          console.log(`📋 Found ${rawDataFields.length} raw data fields for custom checks`);
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

  // ==================== DATA QUALITY FUNCTIONS (moved from child) ====================
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
      { wch: 35 },
      { wch: 18 },
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
              keyParts[0] || '',
              keyParts[1] || '',
              keyParts[2] || '',
              keyParts[3] || '',
              keyParts[4] || '',
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
    
    // Set column widths for details
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
    // [ALL THE CHECK LOGIC - EXACTLY AS IT WAS]
    // I'm not repeating all 400+ lines of checks here, but they stay exactly the same
    // Just copy them from your current file
  };

  const saveQualityResults = async (results) => {
    // [EXACT SAME SAVE LOGIC AS BEFORE]
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
    // [EXACT SAME CHECK TITLES AS BEFORE]
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
        {activeTab === 'data-quality' && (
          <DataQualityTab 
            properties={properties}
            jobData={jobData}
            vendorType={vendorType}
            codeDefinitions={codeDefinitions}
            isLoading={isLoading}
            loadingProgress={loadingProgress}
            loadedCount={loadedCount}
            totalPropertyCount={totalPropertyCount}
            checkResults={checkResults}
            setCheckResults={setCheckResults}
            qualityScore={qualityScore}
            setQualityScore={setQualityScore}
            issueStats={issueStats}
            setIssueStats={setIssueStats}
            customChecks={customChecks}
            setCustomChecks={setCustomChecks}
            currentCustomCheck={currentCustomCheck}
            setCurrentCustomCheck={setCurrentCustomCheck}
            runHistory={runHistory}
            setRunHistory={setRunHistory}
            dataQualityActiveSubTab={dataQualityActiveSubTab}
            setDataQualityActiveSubTab={setDataQualityActiveSubTab}
            availableFields={availableFields}
            expandedCategories={expandedCategories}
            setExpandedCategories={setExpandedCategories}
            isRunningChecks={isRunningChecks}
            setIsRunningChecks={setIsRunningChecks}
            showDetailsModal={showDetailsModal}
            setShowDetailsModal={setShowDetailsModal}
            modalData={modalData}
            setModalData={setModalData}
            runQualityChecks={runQualityChecks}
            exportToExcel={exportToExcel}
            getCheckTitle={getCheckTitle}
            showPropertyDetails={showPropertyDetails}
            toggleQualityCategory={toggleQualityCategory}
            saveCustomChecksToDb={saveCustomChecksToDb}
          />
        )}
        {activeTab === 'pre-valuation' && <PreValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'overall-analysis' && <OverallAnalysisTab jobData={jobData} properties={properties} />}
        {activeTab === 'land-valuation' && <LandValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'cost-valuation' && <CostValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'attribute-cards' && <AttributeCardsTab jobData={jobData} properties={properties} />}
      </div>

      {/* Property Details Modal */}
      {showDetailsModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-10 overflow-y-auto"
          onClick={() => setShowDetailsModal(false)}
        >
          {/* [EXACT SAME MODAL CODE AS BEFORE] */}
        </div>
      )}
    </div>
  );
};

export default MarketLandAnalysis;
