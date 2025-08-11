import React from 'react';
import { Layers } from 'lucide-react';

const AttributeCardsTab = ({ jobData, properties }) => {
  return (
    <div className="bg-white rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">Attribute & Card Analytics</h2>
      <p className="text-gray-600">Analyze property attributes and generate analytical cards.</p>
      <div className="mt-8 text-center text-gray-400">
        <Layers size={48} className="mx-auto mb-4" />
        <p>Condition adjustments and card analytics coming soon</p>
      </div>
    </div>
  );
};

export default AttributeCardsTab;
