import React from 'react';
import { BarChart } from 'lucide-react';

const OverallAnalysisTab = ({ jobData, properties }) => {
  return (
    <div className="bg-white rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Overall Analysis</h2>
      <p className="text-gray-600">View comprehensive property analysis and block-level insights.</p>
      <div className="mt-8 text-center text-gray-400">
        <BarChart size={48} className="mx-auto mb-4" />
        <p>Block analysis and mapping components coming soon</p>
      </div>
    </div>
  );
};

export default OverallAnalysisTab;
