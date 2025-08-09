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
  const [vendorType, setVendorType] = useState(null);
  const [codeDefinitions, setCodeDefinitions] = useState(null);
  const [availableFields, setAvailableFields] = useState([]);
  
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
        {/* Loading Overlay */}
        {isLoading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
              <div className="flex flex-col items-center">
                <RefreshCw size={48} className="text-blue-600 animate-spin mb-4" />
                <h3 className="text-xl font-semibold text-gray-800 mb-2">
                  Loading Property Data
                </h3>
                <p className="text-gray-600 text-center mb-4">
                  Please wait while we load {totalPropertyCount.toLocaleString()} properties...
                </p>
                
                {/* Progress Bar */}
                <div className="w-full mb-2">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Progress</span>
                    <span>{loadingProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                      style={{ width: `${loadingProgress}%` }}
                    />
                  </div>
                </div>
                
                <p className="text-sm text-gray-500 mt-2">
                  Loaded {loadedCount.toLocaleString()} of {totalPropertyCount.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'data-quality' && (
          <DataQualityTab 
            properties={properties}
            jobData={jobData}
            vendorType={vendorType}
            codeDefinitions={codeDefinitions}
            availableFields={availableFields}
          />
        )}
        {activeTab === 'pre-valuation' && <PreValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'overall-analysis' && <OverallAnalysisTab jobData={jobData} properties={properties} />}
        {activeTab === 'land-valuation' && <LandValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'cost-valuation' && <CostValuationTab jobData={jobData} properties={properties} />}
        {activeTab === 'attribute-cards' && <AttributeCardsTab jobData={jobData} properties={properties} />}
      </div>

    </div>
  );
};

export default MarketLandAnalysis;
