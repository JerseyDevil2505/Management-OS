import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calculator, TrendingUp, BarChart3, FileSpreadsheet, DollarSign, Scale } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import SalesReviewTab from './final-valuation-tabs/SalesReviewTab';
import MarketDataTab from './final-valuation-tabs/MarketDataTab';
import RatableComparisonTab from './final-valuation-tabs/RatableComparisonTab';
import SalesComparisonTab from './final-valuation-tabs/SalesComparisonTab';
import AnalyticsTab from './final-valuation-tabs/AnalyticsTab';
import AppealLogTab from './final-valuation-tabs/AppealLogTab';

const FinalValuation = ({
  jobData = {},
  properties = [],
  marketLandData = {},
  hpiData = [],
  onUpdateJobCache = () => {},
  tenantConfig = null
}) => {
  const isAssessor = tenantConfig?.orgType === 'assessor';
  const [activeTab, setActiveTab] = useState(isAssessor ? 'sales-comparison' : 'sales-review');
  const [finalValuationData, setFinalValuationData] = useState({});
  const [isLoadingFinalData, setIsLoadingFinalData] = useState(true);

  // CME navigation: when set, switches to sales-comparison tab with this BLQ pre-loaded
  const [cmeNavigationTarget, setCmeNavigationTarget] = useState(null);
  const salesCompRef = useRef(null);

  const tabs = [
    { id: 'sales-review', label: 'Sales Review', icon: FileSpreadsheet },
    { id: 'market-data', label: 'Market Data', icon: Calculator },
    { id: 'ratable-comparison', label: 'Ratable Comparison', icon: DollarSign },
    { id: 'sales-comparison', label: 'Sales Comparison (CME)', icon: TrendingUp },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'appeal-log', label: 'Appeal Log', icon: Scale }
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
            tenantConfig={tenantConfig}
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

        {activeTab === 'sales-comparison' && (
          <SalesComparisonTab
            jobData={jobData}
            properties={properties}
            hpiData={hpiData}
            onUpdateJobCache={handleCacheUpdate}
            tenantConfig={tenantConfig}
            initialManualSubject={cmeNavigationTarget}
            onManualSubjectConsumed={() => setCmeNavigationTarget(null)}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab
            jobData={jobData}
            properties={properties}
            finalValuationData={finalValuationData}
          />
        )}

        {activeTab === 'appeal-log' && (
          <AppealLogTab
            jobData={jobData}
            properties={properties}
            onNavigateToCME={(blq) => {
              setCmeNavigationTarget(blq);
              setActiveTab('sales-comparison');
            }}
          />
        )}
      </div>
    </div>
  );
};

export default FinalValuation;
