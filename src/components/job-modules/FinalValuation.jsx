import React, { useState } from 'react';
import { Calculator, TrendingUp, Sliders, BarChart3, FileSpreadsheet } from 'lucide-react';
import SalesReviewTab from './final-valuation-tabs/SalesReviewTab';
import AdjustmentsTab from './final-valuation-tabs/AdjustmentsTab';

const FinalValuation = ({ 
  jobData = {}, 
  properties = [], 
  marketLandData = {},
  hpiData = [],
  onUpdateJobCache = () => {} 
}) => {
  const [activeTab, setActiveTab] = useState('sales-review');

  const tabs = [
    { id: 'sales-review', label: 'Sales Review', icon: FileSpreadsheet },
    { id: 'market-data', label: 'Market Data', icon: Calculator },
    { id: 'adjustments', label: 'Adjustments', icon: Sliders },
    { id: 'sales-comparison', label: 'Sales Comparison', icon: TrendingUp },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 }
  ];

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
            onUpdateJobCache={onUpdateJobCache}
          />
        )}

        {activeTab === 'market-data' && (
          <div className="text-center py-12 text-gray-500">
            Market Data tab - Coming soon
          </div>
        )}

        {activeTab === 'adjustments' && (
          <div className="text-center py-12 text-gray-500">
            Adjustments tab - Coming soon
          </div>
        )}

        {activeTab === 'sales-comparison' && (
          <div className="text-center py-12 text-gray-500">
            Sales Comparison tab - Coming soon
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="text-center py-12 text-gray-500">
            Analytics tab - Coming soon
          </div>
        )}
      </div>
    </div>
  );
};

export default FinalValuation;
