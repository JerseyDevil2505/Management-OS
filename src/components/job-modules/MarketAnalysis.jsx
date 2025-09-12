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

const MarketLandAnalysis = ({ jobData, properties, marketLandData, hpiData, onUpdateJobCache }) => {
  // ==================== STATE MANAGEMENT ====================
  const [activeTab, setActiveTab] = useState('data-quality');
  
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
      // Raw data fields now come from source file content parsing
      // For now, return empty array - this functionality would need job context for source file access
      const rawDataFields = [];

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
                onUpdateJobCache={onUpdateJobCache}
              />
            )}    
            
            {activeTab === 'pre-valuation' && (
              <PreValuationTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                hpiData={hpiData}
                onUpdateJobCache={onUpdateJobCache}
              />
            )}
            
            {activeTab === 'overall-analysis' && (
              <OverallAnalysisTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                hpiData={hpiData}
                onUpdateJobCache={onUpdateJobCache}
              />
            )}      
            
            {activeTab === 'land-valuation' && (
              <LandValuationTab
                jobData={jobData}
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onAnalysisUpdate={(data) => {
                  // Invalidate cache when land valuation data changes
                  if (onUpdateJobCache) {
                    onUpdateJobCache(jobData.id, null);
                  }
                }}
              />
            )}
            
            {activeTab === 'cost-valuation' && (
              <CostValuationTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onUpdateJobCache={onUpdateJobCache}
              />
            )}
            
            {activeTab === 'attribute-cards' && (
              <AttributeCardsTab 
                jobData={jobData} 
                properties={properties}
                vendorType={vendorType}
                codeDefinitions={codeDefinitions}
                marketLandData={marketLandData}
                onUpdateJobCache={onUpdateJobCache}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MarketLandAnalysis;
