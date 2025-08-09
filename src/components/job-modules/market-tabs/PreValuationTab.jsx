
import React from 'react';
import { Settings } from 'lucide-react';

const PreValuationTab = ({ jobData, properties }) => {
  return (
    <div className="bg-white rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Pre-Valuation Setup</h2>
      <p className="text-gray-600">Configure normalization and page-by-page analysis settings.</p>
      <div className="mt-8 text-center text-gray-400">
        <Settings size={48} className="mx-auto mb-4" />
        <p>Normalization and Page-by-Page components coming soon</p>
      </div>
    </div>
  );
};

export default PreValuationTab;
