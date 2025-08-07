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
  ChevronLeft
  ChevronRight
} from 'lucide-react';

const MarketLandAnalysis = ({ jobData, onBackToJobs }) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('data-quality');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [properties, setProperties] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // DATA QUALITY STATE (ADD THESE HERE!)
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

  // ==================== TAB CONFIGURATION ====================
  const tabs = [
    { 
      id: 'data-quality', 
      label: 'Data Quality/Error Checking', 
      icon: AlertCircle,
      description: 'Validate data integrity and identify issues'
    },
    { 
      id: 'pre-valuation', 
      label: 'Pre-Valuation Setup', 
      icon: Settings,
      description: 'Normalization and Page by Page Worksheet'
    },
    { 
      id: 'overall', 
      label: 'Overall Analysis', 
      icon: BarChart,
      description: 'General analysis including Condos'
    },
    { 
      id: 'land', 
      label: 'Land Valuation', 
      icon: Map,
      description: 'Complete land system with Economic Obsolescence'
    },
    { 
      id: 'cost-valuation', 
      label: 'Cost Valuation', 
      icon: Calculator,
      description: 'New Construction and Cost Conversion Factor'
    },
    { 
      id: 'attribute-cards', 
      label: 'Attribute & Card Analytics', 
      icon: Layers,
      description: 'Condition/Misc Items and Additional Cards'
    }
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
  
// Data Quality Tab
const DataQualityTab = () => (
  <div className="tab-content">
    <div className="tab-header" style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3>Data Quality Analysis</h3>
          <p style={{ color: '#6b7280' }}>
            Analyzing {properties.length} properties for data integrity issues
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className="btn btn-primary"
            onClick={runQualityChecks}
            disabled={isRunningChecks}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isRunningChecks ? (
              <>
                <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Running...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Run Analysis
              </>
            )}
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => alert('Excel export would be implemented here')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Download size={16} />
            Export Excel
          </button>
        </div>
      </div>
    </div>

    {/* Quality Score Cards */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: '15px',
      marginBottom: '30px'
    }}>
      <div className="card">
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px'
        }}>Quality Score</div>
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: '#10b981'
        }}>
          {qualityScore ? `${qualityScore}%` : '—'}
        </div>
      </div>
      <div className="card">
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px'
        }}>Total Issues</div>
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: '#1f2937'
        }}>
          {issueStats.total}
        </div>
      </div>
      <div className="card">
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px'
        }}>Critical</div>
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: '#ef4444'
        }}>
          {issueStats.critical}
        </div>
      </div>
      <div className="card">
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px'
        }}>Warnings</div>
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: '#f59e0b'
        }}>
          {issueStats.warning}
        </div>
      </div>
      <div className="card">
        <div style={{
          color: '#6b7280',
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '8px'
        }}>Info</div>
        <div style={{
          fontSize: '28px',
          fontWeight: '600',
          color: '#3b82f6'
        }}>
          {issueStats.info}
        </div>
      </div>
    </div>

    {/* Check Results */}
    {Object.keys(checkResults).length > 0 && (
      <>
        <h4 style={{ marginBottom: '15px' }}>Check Results by Category</h4>
        <div style={{ display: 'grid', gap: '15px' }}>
          {Object.entries(checkResults).map(([category, issues]) => {
            const isExpanded = expandedCategories.includes(category);
            const criticalCount = issues.filter(i => i.severity === 'critical').length;
            const warningCount = issues.filter(i => i.severity === 'warning').length;
            const infoCount = issues.filter(i => i.severity === 'info').length;
            
            if (issues.length === 0) return null;
            
            return (
              <div key={category} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  onClick={() => toggleQualityCategory(category)}
                  style={{
                    padding: '12px 16px',
                    background: '#f9fafb',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ChevronRight
                      size={16}
                      style={{
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s'
                      }}
                    />
                    <span style={{ fontWeight: '600', textTransform: 'capitalize' }}>
                      {category.replace('_', ' ')} Checks
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {criticalCount > 0 && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: '#fee2e2',
                        color: '#991b1b'
                      }}>
                        {criticalCount} Critical
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: '#fef3c7',
                        color: '#92400e'
                      }}>
                        {warningCount} Warning
                      </span>
                    )}
                    {infoCount > 0 && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: '#dbeafe',
                        color: '#1e40af'
                      }}>
                        {infoCount} Info
                      </span>
                    )}
                  </div>
                </div>
                
                {isExpanded && (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {Object.entries(
                      issues.reduce((acc, issue) => {
                        if (!acc[issue.check]) acc[issue.check] = [];
                        acc[issue.check].push(issue);
                        return acc;
                      }, {})
                    ).map(([checkType, checkIssues]) => (
                      <div
                        key={checkType}
                        style={{
                          padding: '10px 16px',
                          borderTop: '1px solid #e5e7eb',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <span style={{ fontSize: '14px' }}>
                          {getCheckTitle(checkType)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            fontWeight: '600',
                            fontSize: '14px',
                            color: checkIssues[0].severity === 'critical' ? '#ef4444' :
                                   checkIssues[0].severity === 'warning' ? '#f59e0b' : '#3b82f6'
                          }}>
                            {checkIssues.length} properties
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              showPropertyDetails(checkType, category);
                            }}
                            style={{
                              color: '#3b82f6',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '13px',
                              textDecoration: 'underline'
                            }}
                          >
                            View
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
      </>
    )}

    {/* No results message */}
    {Object.keys(checkResults).length === 0 && !isRunningChecks && (
      <div style={{ 
        textAlign: 'center', 
        padding: '40px',
        background: '#f9fafb',
        borderRadius: '8px',
        color: '#6b7280'
      }}>
        <AlertCircle size={48} style={{ margin: '0 auto 16px', display: 'block' }} />
        <p>No quality check results yet.</p>
        <p>Click "Run Analysis" to check for data quality issues.</p>
      </div>
    )}

    {/* Property Details Modal */}
    {showDetailsModal && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          background: 'white',
          borderRadius: '8px',
          maxWidth: '90%',
          maxHeight: '80%',
          width: '800px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            padding: '20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h3>{modalData.title}</h3>
            <button
              onClick={() => setShowDetailsModal(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                color: '#6b7280',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '8px', textAlign: 'left', fontSize: '12px', color: '#6b7280' }}>
                    PROPERTY KEY
                  </th>
                  <th style={{ padding: '8px', textAlign: 'left', fontSize: '12px', color: '#6b7280' }}>
                    MESSAGE
                  </th>
                </tr>
              </thead>
              <tbody>
                {modalData.properties.map((prop, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '8px', fontSize: '14px' }}>
                      {prop.property_key}
                    </td>
                    <td style={{ padding: '8px', fontSize: '14px' }}>
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
          <button
            onClick={handleSave}
            disabled={isSaving || !unsavedChanges}
            className={`btn ${unsavedChanges ? 'btn-primary' : 'btn-disabled'}`}
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onBackToJobs}
            className="btn btn-secondary"
          >
            <ChevronLeft size={16} />
            Back to Jobs
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-button ${isActive ? 'active' : ''}`}
              title={tab.description}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
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
