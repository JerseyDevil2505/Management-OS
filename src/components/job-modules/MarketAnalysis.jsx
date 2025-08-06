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
} from 'lucide-react';

const MarketLandAnalysis = ({ jobData, onBackToJobs }) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('data-quality');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [properties, setProperties] = useState([]);
  const [lastSaved, setLastSaved] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // Data Quality State
  const [dataIssues, setDataIssues] = useState([]);
  const [dataQualityScore, setDataQualityScore] = useState(null);
  
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

  // ==================== TAB COMPONENTS ====================
  
  // Data Quality Tab
  const DataQualityTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h3>Data Quality Analysis</h3>
        <p className="text-muted">
          Analyzing {properties.length} properties for data integrity issues
        </p>
      </div>

      {/* Quality Score Card */}
      <div className="card">
        <div className="flex-between">
          <span className="text-muted">Overall Data Quality Score</span>
          <span className="metric-large text-success">
            {dataQualityScore ? `${dataQualityScore}%` : 'Calculating...'}
          </span>
        </div>
      </div>

      {/* Issues List */}
      <div className="card">
        <h4>Identified Issues</h4>
        {/* TODO: Add issues list */}
        <p className="text-muted">
          No critical issues found
        </p>
      </div>
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
