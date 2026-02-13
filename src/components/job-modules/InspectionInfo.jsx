import React, { useMemo } from 'react';
import { Database, CheckCircle, AlertCircle, TrendingUp, Users, FileText } from 'lucide-react';

const InspectionInfo = ({ jobData, properties = [], inspectionData = [] }) => {

  const metrics = useMemo(() => {
    if (!properties || properties.length === 0) {
      return {
        totalProperties: 0,
        inspected: 0,
        notInspected: 0,
        entryRate: 0,
        byClass: {},
        missingInspections: [],
        inspectorBreakdown: {}
      };
    }

    let inspected = 0;
    let notInspected = 0;
    const byClass = {};
    const missingInspections = [];
    const inspectorBreakdown = {};

    properties.forEach(prop => {
      const propertyClass = prop.property_m4_class || 'Unknown';
      if (!byClass[propertyClass]) {
        byClass[propertyClass] = { total: 0, inspected: 0 };
      }
      byClass[propertyClass].total++;

      const hasMeasureBy = prop.inspection_measure_by && prop.inspection_measure_by.trim();
      const hasMeasureDate = prop.inspection_measure_date;

      if (hasMeasureBy && hasMeasureDate) {
        inspected++;
        byClass[propertyClass].inspected++;

        // Track inspector
        const inspector = prop.inspection_measure_by.trim();
        if (!inspectorBreakdown[inspector]) {
          inspectorBreakdown[inspector] = 0;
        }
        inspectorBreakdown[inspector]++;
      } else {
        notInspected++;
        // Track missing - limit to first 500 for display
        if (missingInspections.length < 500) {
          missingInspections.push({
            block: prop.property_block || '',
            lot: prop.property_lot || '',
            qualifier: prop.property_qualifier || '',
            location: prop.property_location || '',
            class: propertyClass,
            owner: prop.owner_name || ''
          });
        }
      }
    });

    const entryRate = properties.length > 0
      ? ((inspected / properties.length) * 100).toFixed(1)
      : 0;

    return {
      totalProperties: properties.length,
      inspected,
      notInspected,
      entryRate: parseFloat(entryRate),
      byClass,
      missingInspections,
      inspectorBreakdown
    };
  }, [properties]);

  const sortedClasses = Object.entries(metrics.byClass)
    .sort(([a], [b]) => a.localeCompare(b));

  const sortedInspectors = Object.entries(metrics.inspectorBreakdown)
    .sort(([, a], [, b]) => b - a);

  if (!properties || properties.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="text-center text-gray-500 py-12">
          <Database className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold mb-2">No Property Data</h3>
          <p>Upload property data files to see inspection metrics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
        <Database className="w-5 h-5 text-blue-600" />
        Inspection Info
      </h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg border-2 border-blue-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Properties</p>
              <p className="text-3xl font-bold text-blue-600">{metrics.totalProperties.toLocaleString()}</p>
            </div>
            <FileText className="w-8 h-8 text-blue-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-green-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Inspected</p>
              <p className="text-3xl font-bold text-green-600">{metrics.inspected.toLocaleString()}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-amber-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Not Inspected</p>
              <p className="text-3xl font-bold text-amber-600">{metrics.notInspected.toLocaleString()}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-purple-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Entry Rate</p>
              <p className="text-3xl font-bold text-purple-600">{metrics.entryRate}%</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-400" />
          </div>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(metrics.entryRate, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* By Class */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
            Breakdown by Property Class
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-gray-500">Class</th>
                <th className="text-right py-2 text-gray-500">Total</th>
                <th className="text-right py-2 text-gray-500">Inspected</th>
                <th className="text-right py-2 text-gray-500">Rate</th>
              </tr>
            </thead>
            <tbody>
              {sortedClasses.map(([cls, data]) => (
                <tr key={cls} className="border-b border-gray-100">
                  <td className="py-2 font-medium">{cls}</td>
                  <td className="text-right py-2">{data.total.toLocaleString()}</td>
                  <td className="text-right py-2">{data.inspected.toLocaleString()}</td>
                  <td className="text-right py-2">
                    <span className={`font-medium ${
                      data.total > 0 && (data.inspected / data.total) >= 0.9
                        ? 'text-green-600'
                        : data.total > 0 && (data.inspected / data.total) >= 0.5
                        ? 'text-amber-600'
                        : 'text-red-600'
                    }`}>
                      {data.total > 0 ? ((data.inspected / data.total) * 100).toFixed(1) : 0}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Inspector Breakdown */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide flex items-center gap-2">
            <Users className="w-4 h-4" />
            Inspector Breakdown
          </h3>
          {sortedInspectors.length === 0 ? (
            <p className="text-gray-400 text-sm">No inspections recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">Inspector</th>
                  <th className="text-right py-2 text-gray-500">Inspected</th>
                  <th className="text-right py-2 text-gray-500">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedInspectors.map(([inspector, count]) => (
                  <tr key={inspector} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{inspector}</td>
                    <td className="text-right py-2">{count.toLocaleString()}</td>
                    <td className="text-right py-2 text-gray-500">
                      {((count / metrics.inspected) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Missing Inspections */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          Missing Inspections
          <span className="text-xs font-normal text-gray-400 ml-2">
            ({metrics.notInspected.toLocaleString()} total
            {metrics.missingInspections.length < metrics.notInspected ? `, showing first ${metrics.missingInspections.length}` : ''})
          </span>
        </h3>
        {metrics.missingInspections.length === 0 ? (
          <div className="text-center py-8 text-green-600">
            <CheckCircle className="w-10 h-10 mx-auto mb-2" />
            <p className="font-medium">All properties have been inspected!</p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">Block</th>
                  <th className="text-left py-2 text-gray-500">Lot</th>
                  <th className="text-left py-2 text-gray-500">Qual</th>
                  <th className="text-left py-2 text-gray-500">Class</th>
                  <th className="text-left py-2 text-gray-500">Location</th>
                  <th className="text-left py-2 text-gray-500">Owner</th>
                </tr>
              </thead>
              <tbody>
                {metrics.missingInspections.map((prop, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5">{prop.block}</td>
                    <td className="py-1.5">{prop.lot}</td>
                    <td className="py-1.5">{prop.qualifier || '-'}</td>
                    <td className="py-1.5">{prop.class}</td>
                    <td className="py-1.5 text-gray-600">{prop.location}</td>
                    <td className="py-1.5 text-gray-600">{prop.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default InspectionInfo;
