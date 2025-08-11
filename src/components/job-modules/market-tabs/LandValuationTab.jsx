import React from 'react';
import { Map } from 'lucide-react';

const LandValuationTab = ({ jobData, properties }) => {
  return (
    <div className="bg-white rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Land Valuation</h2>
      <p className="text-gray-600">Analyze vacant sales and calculate land rates by VCS.</p>
      <div className="mt-8 text-center text-gray-400">
        <Map size={48} className="mx-auto mb-4" />
        <p>7-section land valuation system coming soon</p>
      </div>
    </div>
  );
};

export default LandValuationTab;
