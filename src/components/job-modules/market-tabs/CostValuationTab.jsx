
import React from 'react';
import { Calculator } from 'lucide-react';

const CostValuationTab = ({ jobData, properties }) => {
  return (
    <div className="bg-white rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Cost Valuation</h2>
      <p className="text-gray-600">Review cost approach factors and new construction analysis.</p>
      <div className="mt-8 text-center text-gray-400">
        <Calculator size={48} className="mx-auto mb-4" />
        <p>Cost conversion and new construction components coming soon</p>
      </div>
    </div>
  );
};

export default CostValuationTab;
