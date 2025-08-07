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
          const vendor = firstProp.raw_data?.vendor_source || jobData.vendor_source || 'BRT';
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

  // ==================== DATA FETCHING ====================
  useEffect(() => {
    if (jobData?.id) {
      loadInitialData();
    }
  }, [jobData?.id]);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      // Load properties for this job
      const { data: propertiesData, error: propertiesError } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobData.id)
        .order('block', { ascending: true })
        .order('lot', { ascending: true });

      if (propertiesError) throw propertiesError;
      setProperties(propertiesData || []);

      // Load any saved analysis data
      // TODO: Load saved state from database

      console.log(`Loaded ${propertiesData?.length || 0} properties for analysis`);
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

  // ==================== DATA QUALITY FUNCTIONS ====================
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
    const vendor = jobData.vendor_source || 'BRT';
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
  // MOD IV CHECKS
  const m4Class = property.property_m4_class;
  const modImprovement = property.values_mod_improvement || 0;
  
  // Class 1/3B cannot have improvements
  if ((m4Class === '1' || m4Class === '3B') && modImprovement > 0) {
    results.mod_iv.push({
      check: 'vacant_land_improvements',
      severity: 'critical',
      property_key: property.property_composite_key,
      message: `Class ${m4Class} has improvements: $${modImprovement}`,
      details: property
    });
  }
  
  // Class 2/3A/4A-C must have improvements
  if (['2', '3A', '4A', '4B', '4C'].includes(m4Class) && modImprovement === 0) {
    results.mod_iv.push({
      check: 'missing_improvements',
      severity: 'critical',
      property_key: property.property_composite_key,
      message: `Class ${m4Class} missing improvements`,
      details: property
    });
  }
  
  // Add more checks here - keeping it shorter for now
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
    
    const { error } = await supabase
      .from('market_land_valuation')
      .upsert({
        job_id: jobData.id,
        quality_check_results: results,
        quality_check_last_run: new Date().toISOString(),
        quality_issues_count: totalIssues,
        custom_check_definitions: customChecks
      }, {
        onConflict: 'job_id'
      });
    
    if (error) throw error;
    
    setIssueStats({
      critical: criticalCount,
      warning: warningCount,
      info: infoCount,
      total: totalIssues
    });
    
    setUnsavedChanges(false);
    console.log(`Saved quality results: ${totalIssues} issues found`);
  } catch (error) {
    console.error('Error saving quality results:', error);
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
    'vacant_land_improvements': 'Vacant Land with Improvements',
    'missing_improvements': 'Properties Missing Improvements',
    'zero_lot_size': 'Properties with Zero Lot Size',
    'missing_sfla': 'Missing Living Area'
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
  
// Data Quality Tab - PRODUCTION VERSION using App.css classes
const DataQualityTab = () => (
  <div className="tab-content">
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
        onClick={() => alert('Excel export will be implemented')}
        className="px-4 py-2 bg-white border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition-all flex items-center gap-2"
      >
        <Download size={16} />
        Export to Excel
      </button>
      
      <button 
        onClick={() => alert('QC Form generation will be implemented')}
        className="px-4 py-2 bg-white border-2 border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-all"
      >
        Generate QC Form
      </button>
    </div>

    {/* Metrics Cards Grid */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      <div className="card p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Properties</div>
        <div className="text-2xl font-bold text-gray-800">{properties.length.toLocaleString()}</div>
      </div>
      
      <div className="card p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">With Issues</div>
        <div className="text-2xl font-bold text-red-600">{issueStats.total}</div>
      </div>
      
      <div className="card p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Critical</div>
        <div className="text-2xl font-bold text-red-600">{issueStats.critical}</div>
      </div>
      
      <div className="card p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Warnings</div>
        <div className="text-2xl font-bold text-yellow-600">{issueStats.warning}</div>
      </div>
      
      <div className="card p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Info</div>
        <div className="text-2xl font-bold text-blue-600">{issueStats.info}</div>
      </div>
      
      <div className="card p-4 bg-gradient-to-br from-green-500 to-green-600 text-white">
        <div className="text-xs uppercase tracking-wide mb-1 opacity-90">Quality Score</div>
        <div className="text-2xl font-bold">{qualityScore ? `${qualityScore}%` : '—'}</div>
      </div>
    </div>

    {/* Check Results */}
    {Object.keys(checkResults).length > 0 ? (
      <div>
        <h4 className="text-lg font-semibold text-gray-800 mb-4">
          Check Results by Category
        </h4>
        
        {Object.entries(checkResults).map(([category, issues]) => {
          if (issues.length === 0) return null;
          
          const isExpanded = expandedCategories.includes(category);
          const criticalCount = issues.filter(i => i.severity === 'critical').length;
          const warningCount = issues.filter(i => i.severity === 'warning').length;
          const infoCount = issues.filter(i => i.severity === 'info').length;
          
          return (
            <div key={category} className="card mb-3 overflow-hidden">
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
                    {category.replace(/_/g, ' ')} Checks
                  </span>
                </div>
                
                <div className="flex gap-2">
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
  <div className="card p-12 text-center">
    {isLoading ? (
      <>
        <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
          <RefreshCw size={32} className="text-blue-600 animate-spin" />
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Loading Property Data
        </h3>
        <p className="text-gray-600">
          Please wait while we load {totalPropertyCount.toLocaleString()} properties in batches...
        </p>
      </>
    ) : (
      <>
        <AlertCircle size={48} className="text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          No Analysis Run Yet
        </h3>
        <p className="text-gray-600">
          {properties.length.toLocaleString()} properties loaded. Click "Run Analysis" to check for data quality issues.
        </p>
      </>
    )}
  </div>
)}

    {/* Property Details Modal */}
    {showDetailsModal && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
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
          
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Property Key
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
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

  // Pre-Valuation Setup Tab
  const PreValuationTab = () => (
    <div className="tab-content">
      {/* Sub-tabs for Normalization and Page by Page */}
      <div className="sub-tabs">
        <button className="sub-tab active">
          Normalization
        </button>
        <button className="sub-tab">
          Page by Page Worksheet
        </button>
      </div>

      {/* Normalization Settings */}
      <div className="card">
        <h4>Normalization Settings</h4>
        <div className="form-grid">
          <div className="form-group">
            <label>Target Year</label>
            <input
              type="number"
              className="form-input"
              value={targetYear}
              onChange={(e) => setTargetYear(parseInt(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label>Equalization Ratio (%)</label>
            <input
              type="number"
              className="form-input"
              value={equalizationRatio}
              onChange={(e) => setEqualizationRatio(parseFloat(e.target.value))}
              step="0.1"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="button-group">
        <button className="btn btn-primary">
          <RefreshCw size={16} />
          Run Normalization
        </button>
      </div>
    </div>
  );

  // Overall Analysis Tab
  const OverallAnalysisTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Block Value Analysis</h3>
        <p className="text-muted">
          Analyzing values by block with color coding for Bluebeam integration
        </p>
      </div>

      {/* Color Scale Settings */}
      <div className="card">
        <h4>Color Scale Configuration</h4>
        <div className="form-grid">
          <div className="form-group">
            <label>Starting Value</label>
            <input
              type="number"
              className="form-input"
              value={colorScaleStart}
              onChange={(e) => setColorScaleStart(parseInt(e.target.value))}
              step="10000"
            />
          </div>
          <div className="form-group">
            <label>Increment</label>
            <input
              type="number"
              className="form-input"
              value={colorScaleIncrement}
              onChange={(e) => setColorScaleIncrement(parseInt(e.target.value))}
              step="5000"
            />
          </div>
        </div>
      </div>

      {/* Block Analysis Results */}
      <div className="card">
        <h4>Block Analysis Results</h4>
        {/* TODO: Add block analysis grid */}
        <p className="text-muted">
          Run normalization first to see block analysis
        </p>
      </div>
    </div>
  );

  // Land Valuation Tab
  const LandValuationTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Land Valuation System</h3>
        <p className="text-muted">
          7-section comprehensive land analysis with economic obsolescence
        </p>
      </div>

      {/* Land Analysis Sections */}
      <div className="card">
        <h4>Analysis Sections</h4>
        <div className="section-list">
          {[
            'Data Preparation & Import',
            'Raw Land Rate Determination',
            'Land Allocation Validation',
            'Special Condition Rates',
            'VCS Site Value Framework',
            'Economic Obsolescence Analysis',
            'Site Value Calculator'
          ].map((section, index) => (
            <div key={index} className="section-item">
              {index + 1}. {section}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Cost Valuation Tab
  const CostValuationTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Cost Approach Valuation</h3>
        <p className="text-muted">
          New construction analysis and cost conversion factors
        </p>
      </div>

      {/* Cost Conversion Settings */}
      <div className="card">
        <h4>Cost Conversion Factor</h4>
        <div className="form-group">
          <label>Conversion Factor</label>
          <input
            type="number"
            className="form-input small"
            value={costConversionFactor}
            onChange={(e) => setCostConversionFactor(parseFloat(e.target.value))}
            step="0.01"
          />
        </div>
      </div>

      {/* New Construction Analysis */}
      <div className="card">
        <h4>New Construction Properties</h4>
        {/* TODO: Add new construction grid */}
        <p className="text-muted">
          No new construction properties identified
        </p>
      </div>
    </div>
  );

  // Attribute & Card Analytics Tab
  const AttributeCardsTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Attribute & Card Analytics</h3>
        <p className="text-muted">
          Condition adjustments and multi-card property analysis
        </p>
      </div>

      {/* Condition Adjustments */}
      <div className="card">
        <h4>Condition Adjustments</h4>
        <div className="condition-grid">
          {['Excellent', 'Good', 'Average', 'Fair', 'Poor'].map(condition => (
            <div key={condition} className="condition-item">
              <span className="text-muted">{condition}:</span>
              <input
                type="number"
                className="form-input inline small"
                placeholder="0%"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Additional Cards Analysis */}
      <div className="card">
        <h4>Multi-Card Properties</h4>
        {/* TODO: Add additional cards grid */}
        <p className="text-muted">
          {additionalCards.length} properties with multiple cards identified
        </p>
      </div>
    </div>
  );

  // ==================== TAB CONTENT RENDERER ====================
  const renderTabContent = () => {
    switch (activeTab) {
      case 'data-quality':
        return <DataQualityTab />;
      case 'pre-valuation':
        return <PreValuationTab />;
      case 'overall':
        return <OverallAnalysisTab />;
      case 'land':
        return <LandValuationTab />;
      case 'cost-valuation':
        return <CostValuationTab />;
      case 'attribute-cards':
        return <AttributeCardsTab />;
      default:
        return <DataQualityTab />;
    }
  };

  // ==================== MAIN RENDER ====================
  return (
    <div className="module-container">
      {/* Header */}
      <div className="module-header">
        <div>
          <h2 className="module-title">Market & Land Analysis</h2>
          <p className="text-muted">
            {jobData?.job_number} - {jobData?.municipality || 'Municipality'} ({jobData?.county || 'County'} County, {jobData?.state || 'State'})
          </p>
        </div>
        <div className="header-actions">
          {lastSaved && (
            <span className="last-saved">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b-2 border-gray-200 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-medium text-sm transition-all ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-500 text-blue-600 -mb-[2px]'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="content-area">
        {isLoading ? (
          <div className="loading-state">
            <RefreshCw size={20} className="spin" />
            Loading property data...
          </div>
        ) : (
          renderTabContent()
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="status-bar">
        <span>{properties.length} properties loaded</span>
        <span>
          {unsavedChanges && (
            <span className="unsaved-indicator">
              <AlertCircle size={12} />
              Unsaved changes
            </span>
          )}
          Ready
        </span>
      </div>
    </div>
  );
};

export default MarketLandAnalysis;
