import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, TrendingUp, Sliders, BarChart3, FileSpreadsheet, DollarSign, LineChart } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import SalesReviewTab from './final-valuation-tabs/SalesReviewTab';
import MarketDataTab from './final-valuation-tabs/MarketDataTab';
import RatableComparisonTab from './final-valuation-tabs/RatableComparisonTab';
import AdjustmentsTab from './final-valuation-tabs/AdjustmentsTab';
import SalesComparisonTab from './final-valuation-tabs/SalesComparisonTab';
import AnalyticsTab from './final-valuation-tabs/AnalyticsTab';
import DataVisualizationTab from './final-valuation-tabs/DataVisualizationTab';

const FinalValuation = ({
  jobData = {},
  properties = [],
  marketLandData = {},
  hpiData = [],
  onUpdateJobCache = () => {}
}) => {
  const [activeTab, setActiveTab] = useState('sales-review');
  const [finalValuationData, setFinalValuationData] = useState({});
  const [isLoadingFinalData, setIsLoadingFinalData] = useState(true);

  const tabs = [
    { id: 'sales-review', label: 'Sales Review', icon: FileSpreadsheet },
    { id: 'market-data', label: 'Market Data', icon: Calculator },
    { id: 'ratable-comparison', label: 'Ratable Comparison', icon: DollarSign },
    { id: 'adjustments', label: 'Adjustments', icon: Sliders },
    { id: 'sales-comparison', label: 'Sales Comparison', icon: TrendingUp },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'visualizations', label: 'Data Visualizations', icon: LineChart }
  ];

  // Load final valuation data for analytics
  useEffect(() => {
    if (jobData?.id) {
      loadFinalValuationData();
    }
  }, [jobData?.id]);

  const loadFinalValuationData = async () => {
    try {
      setIsLoadingFinalData(true);
      const { data, error } = await supabase
        .from('final_valuation_data')
        .select('*')
        .eq('job_id', jobData.id);

      if (error) throw error;

      // Convert to map by composite key
      const dataMap = {};
      (data || []).forEach(item => {
        dataMap[item.property_composite_key] = item;
      });
      setFinalValuationData(dataMap);
    } catch (error) {
      console.error('Error loading final valuation data:', error);
    } finally {
      setIsLoadingFinalData(false);
    }
  };

  // Refresh final data when cache updates
  const handleCacheUpdate = (...args) => {
    loadFinalValuationData();
    if (onUpdateJobCache) {
      onUpdateJobCache(...args);
    }
  };

  return (
    <div className="final-valuation-container">
      {/* Tab Navigation */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm inline-flex items-center gap-2
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'sales-review' && (
          <SalesReviewTab
            jobData={jobData}
            properties={properties}
            marketLandData={marketLandData}
            hpiData={hpiData}
            onUpdateJobCache={handleCacheUpdate}
          />
        )}

        {activeTab === 'market-data' && (
          <MarketDataTab
            jobData={jobData}
            properties={properties}
            marketLandData={marketLandData}
            hpiData={hpiData}
            onUpdateJobCache={handleCacheUpdate}
          />
        )}

        {activeTab === 'ratable-comparison' && (
          <RatableComparisonTab
            jobData={jobData}
            properties={properties}
            onUpdateJobCache={handleCacheUpdate}
          />
        )}

        {activeTab === 'adjustments' && (
          <AdjustmentsTab
            jobData={jobData}
          />
        )}

        {activeTab === 'sales-comparison' && (
          <SalesComparisonTab
            jobData={jobData}
            properties={properties}
            hpiData={hpiData}
            onUpdateJobCache={handleCacheUpdate}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab
            jobData={jobData}
            properties={properties}
            finalValuationData={finalValuationData}
          />
        )}

        {activeTab === 'visualizations' && (
          <DataVisualizationTab
            jobData={jobData}
            properties={properties}
          />
        )}
      </div>
    </div>
  );
};

export default FinalValuation;
