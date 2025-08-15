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

const MarketLandAnalysis = ({ jobData, properties, marketLandData }) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('data-quality');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  
  // ==================== DERIVE DATA FROM PROPS ====================
  // Extract vendor type and code definitions from jobData
  const vendorType = useMemo(() => {
    return jobData?.vendor_type || 'BRT';
  }, [jobData?.vendor_type]);
  
  const codeDefinitions = useMemo(() => {
    return jobData?.parsed_code_definitions || null;
  }, [jobData?.parsed_code_definitions]);
  
  // Build available fields list from properties for custom checks
  const availableFields = useMemo(() => {
    if (properties && properties.length > 0) {
      const firstProp = properties[0];
      const rawDataFields = firstProp.raw_data ? Object.keys(firstProp.raw_data) : [];
      
      // Sort raw data fields alphabetically
      rawDataFields.sort();
      
      console.log(`📋 Found ${rawDataFields.length} raw data fields for custom checks`);
      return rawDataFields;
    }
    return [];
  }, [properties]);

  // Get property count
  const propertyCount = useMemo(() => {
    return properties ? properties.length : 0;
  }, [properties]);

  // Log initial load info
  useEffect(() => {
    if (properties && properties.length > 0) {
      console.log(`✅ MarketLandAnalysis received ${properties.length} properties`);
      console.log(`🏢 Vendor type: ${vendorType}`);
      console.log(`📚 Code definitions loaded: ${codeDefinitions ? 'Yes' : 'No'}`);
      if (jobData?.has_property_assignments) {
        console.log(`📋 Working with assigned properties only`);
      }
    }
  }, [properties, vendorType, codeDefinitions, jobData?.has_property_assignments]);

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
      // This will vary based on which tab is active
      
      // Example structure:
      // if (activeTab === 'pre-valuation') {
      //   await worksheetService.saveWorksheetData(jobData.id, worksheetData);
      // } else if (activeTab === 'land-valuation') {
      //   await landService.saveLandData(jobData.id, landData);
      // }
      
      setLastSaved(new Date());
      setUnsavedChanges(false);
      console.log('Analysis data saved successfully');
    } catch (error) {
      console.error('Error saving analysis:', error);
      alert('Failed to save data. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Auto-save reminder
  useEffect(() => {
    if (unsavedChanges) {
      const timer = setTimeout(() => {
        console.log('💾 Reminder: You have unsaved changes');
      }, 60000); // Remind after 1 minute of unsaved changes
      
      return () => clearTimeout(timer);
    }
  }, [unsavedChanges]);

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
                {jobData?.has_property_assignments && (
                  <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                    Assigned Properties Only
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-500">
                {propertyCount.toLocaleString()} properties loaded
              </div>
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
        {/* Check if we have properties */}
        {!properties || properties.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8">
            <div className="text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">No Properties Loaded</h3>
              <p className="mt-1 text-sm text-gray-500">
                {jobData?.has_property_assignments 
                  ? 'No assigned properties found for this job.'
                  : 'No properties found for this job.'}
              </p>
              <p className="mt-2 text-xs text-gray-400">
                Properties should be automatically loaded from the job data.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Render active tab with all necessary props */}
            {activeTab === 'data-quality' && (
              <DataQualityTab 
                properties={properties}
                jobData={jobData}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                availableFields={availableFields}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}    
            
            {activeTab === 'pre-valuation' && (
              <PreValuationTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}
            
            {activeTab === 'overall-analysis' && (
              <OverallAnalysisTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}      
            
            {activeTab === 'land-valuation' && (
              <LandValuationTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}
            
            {activeTab === 'cost-valuation' && (
              <CostValuationTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}
            
            {activeTab === 'attribute-cards' && (
              <AttributeCardsTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onDataChange={() => setUnsavedChanges(true)}
              />
            )}
          </>
        )}
      </div>

      {/* Floating Save Reminder */}
      {unsavedChanges && (
        <div className="fixed bottom-4 right-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-lg p-4 flex items-center gap-3">
          <AlertCircle className="text-yellow-600" size={20} />
          <div>
            <p className="text-sm font-medium text-yellow-800">Unsaved Changes</p>
            <p className="text-xs text-yellow-600">Remember to save your work</p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="ml-4 px-3 py-1.5 bg-yellow-600 text-white text-sm font-medium rounded hover:bg-yellow-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Now'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MarketLandAnalysis;
