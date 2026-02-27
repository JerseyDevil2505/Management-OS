import React, { useMemo } from 'react';
import { Database, CheckCircle, AlertCircle, TrendingUp, Users, FileText, Home } from 'lucide-react';

const InspectionInfo = ({ jobData, properties = [], inspectionData = [] }) => {
  // Extract refusal codes from parsed code definitions
  const getRefusalCodesFromCodeFile = () => {
    const vendor = jobData?.vendor_type || 'BRT';
    const refusalCodes = [];

    // First try to get from infoby_category_config (ProductionTracker)
    if (jobData?.infoby_category_config?.refusal) {
      return jobData.infoby_category_config.refusal;
    }

    // Otherwise extract from parsed_code_definitions (code file)
    const codeDefs = jobData?.parsed_code_definitions;
    if (!codeDefs) return refusalCodes;

    if (vendor === 'BRT') {
      // BRT: Look in Residential section for "REFUSED" descriptions
      const residentialSection = codeDefs.sections?.['Residential'] || {};
      Object.values(residentialSection).forEach(item => {
        if (item?.DATA?.VALUE && item.DATA.VALUE.toUpperCase().includes('REFUSED')) {
          const code = item.KEY || item.DATA.KEY;
          if (code) refusalCodes.push(code);
        }
      });
    } else if (vendor === 'Microsystems') {
      // Microsystems: Look for "REFUSED" in any section
      const sections = codeDefs.sections || {};
      Object.values(sections).forEach(section => {
        if (typeof section === 'object') {
          Object.values(section).forEach(item => {
            if (item?.DATA?.VALUE && item.DATA.VALUE.toUpperCase().includes('REFUSED')) {
              const code = item.KEY || item.DATA.KEY;
              if (code) refusalCodes.push(code);
            }
          });
        }
      });
    }

    return refusalCodes;
  };

  const refusalCodes = getRefusalCodesFromCodeFile();
  const vendor = jobData?.vendor_type || 'BRT';

  const metrics = useMemo(() => {
    if (!properties || properties.length === 0) {
      return {
        totalProperties: 0,
        inspected: 0,
        notInspected: 0,
        entryRate: 0,
        improvedTotal: 0,
        improvedInspected: 0,
        improvedNotInspected: 0,
        improvedEntryRate: 0,
        byClass: {},
        byVCS: {},
        missingInspections: [],
        inspectorBreakdown: {}
      };
    }

    let inspected = 0;
    let notInspected = 0;
    let improvedTotal = 0;
    let improvedInspected = 0;
    let improvedNotInspected = 0;
    const byClass = {};
    const byVCS = {};
    const missingInspections = [];
    const inspectorBreakdown = {};

    properties.forEach(prop => {
      const propertyClass = prop.property_m4_class || 'Unknown';
      if (!byClass[propertyClass]) {
        byClass[propertyClass] = { total: 0, inspected: 0, improvedTotal: 0, improvedInspected: 0 };
      }
      byClass[propertyClass].total++;

      // Determine VCS category
      const vcsCode = prop.new_vcs || prop.vcs_code || '';
      let vcsCategory = 'residential';
      if (vcsCode === '00' || vcsCode.toUpperCase() === 'VACANT') {
        vcsCategory = 'vacant';
      } else if (vcsCode.toUpperCase() === 'COMM' || propertyClass?.toUpperCase().includes('COMM')) {
        vcsCategory = 'commercial';
      }

      // Only include residential for VCS breakdown
      const isResidential = vcsCategory === 'residential';
      if (isResidential) {
        const vcsLabel = vcsCode || 'Unknown';
        if (!byVCS[vcsLabel]) {
          byVCS[vcsLabel] = { total: 0, inspected: 0, refusals: 0 };
        }
        byVCS[vcsLabel].total++;
      }

      // Entry = has list_by + list_date (BRT: LISTBY/LISTDT, Microsystems: Insp By/Insp Date)
      const hasListBy = prop.inspection_list_by && prop.inspection_list_by.trim();
      const hasListDate = prop.inspection_list_date;
      const hasEntry = hasListBy && hasListDate;

      // Refusal check - use vendor-specific code field
      let hasRefusal = false;
      if (vendor === 'Microsystems') {
        // Microsystems: check info_by_code
        const infoByCode = prop.info_by_code;
        hasRefusal = infoByCode && refusalCodes.includes(infoByCode);
      } else {
        // BRT (default): check inspection_info_by field
        const infoByCode = prop.inspection_info_by;
        hasRefusal = infoByCode && refusalCodes.includes(infoByCode);
      }

      // Improved property = has improvement value > 0
      const improvementValue = parseFloat(prop.values_cama_improvement || prop.values_mod_improvement || 0);
      const isImproved = improvementValue > 0;

      if (isImproved) {
        improvedTotal++;
        byClass[propertyClass].improvedTotal++;
      }

      if (hasEntry) {
        inspected++;
        byClass[propertyClass].inspected++;

        if (isResidential) {
          const vcsLabel = vcsCode || 'Unknown';
          byVCS[vcsLabel].inspected++;
        }

        if (isImproved) {
          improvedInspected++;
          byClass[propertyClass].improvedInspected++;
        }

        // Track inspector by list_by
        const inspector = prop.inspection_list_by.trim();
        if (!inspectorBreakdown[inspector]) {
          inspectorBreakdown[inspector] = 0;
        }
        inspectorBreakdown[inspector]++;
      } else {
        notInspected++;
        if (isImproved) {
          improvedNotInspected++;
        }

        // Track refusals in VCS breakdown
        if (hasRefusal && isResidential) {
          const vcsLabel = vcsCode || 'Unknown';
          byVCS[vcsLabel].refusals++;
        }

        // Track missing - limit to first 500 for display
        if (missingInspections.length < 500) {
          missingInspections.push({
            block: prop.property_block || '',
            lot: prop.property_lot || '',
            qualifier: prop.property_qualifier || '',
            location: prop.property_location || '',
            class: propertyClass,
            owner: prop.owner_name || '',
            isImproved,
            isRefusal: hasRefusal
          });
        }
      }
    });

    const entryRate = properties.length > 0
      ? ((inspected / properties.length) * 100).toFixed(1)
      : 0;

    const improvedEntryRate = improvedTotal > 0
      ? ((improvedInspected / improvedTotal) * 100).toFixed(1)
      : 0;

    return {
      totalProperties: properties.length,
      inspected,
      notInspected,
      entryRate: parseFloat(entryRate),
      improvedTotal,
      improvedInspected,
      improvedNotInspected,
      improvedEntryRate: parseFloat(improvedEntryRate),
      byClass,
      byVCS,
      missingInspections,
      inspectorBreakdown
    };
  }, [properties, refusalCodes, vendor]);

  const sortedClasses = Object.entries(metrics.byClass)
    .sort(([a], [b]) => a.localeCompare(b));

  const sortedVCS = Object.entries(metrics.byVCS)
    .sort(([a], [b]) => {
      // Sort with 'Unknown' last
      if (a === 'Unknown') return 1;
      if (b === 'Unknown') return -1;
      return a.localeCompare(b);
    });

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

      {/* Summary Cards - Improved Properties (entry rate only matters for improved) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-lg border-2 border-indigo-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Properties</p>
              <p className="text-3xl font-bold text-indigo-600">{metrics.improvedTotal.toLocaleString()}</p>
            </div>
            <Home className="w-8 h-8 text-indigo-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-green-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Entries</p>
              <p className="text-3xl font-bold text-green-600">{metrics.improvedInspected.toLocaleString()}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-amber-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved No Entry</p>
              <p className="text-3xl font-bold text-amber-600">{metrics.improvedNotInspected.toLocaleString()}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border-2 border-teal-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Improved Entry Rate</p>
              <p className="text-3xl font-bold text-teal-600">{metrics.improvedEntryRate}%</p>
            </div>
            <TrendingUp className="w-8 h-8 text-teal-400" />
          </div>
          <div className="mt-2 bg-gray-200 rounded-full h-2">
            <div
              className="bg-teal-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(metrics.improvedEntryRate, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* By VCS - Residential Only */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
            Residential Inspections by VCS
          </h3>
          {sortedVCS.length === 0 ? (
            <p className="text-gray-400 text-sm">No residential properties found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">VCS Code</th>
                  <th className="text-right py-2 text-gray-500">Total</th>
                  <th className="text-right py-2 text-gray-500">Entry</th>
                  <th className="text-right py-2 text-gray-500">Rate</th>
                  <th className="text-right py-2 text-gray-500">Refusal</th>
                </tr>
              </thead>
              <tbody>
                {sortedVCS.map(([vcsCode, data]) => {
                  const entryRate = data.total > 0 ? (data.inspected / data.total) * 100 : 0;
                  return (
                    <tr key={vcsCode} className="border-b border-gray-100">
                      <td className="py-2 font-medium">{vcsCode}</td>
                      <td className="text-right py-2">{data.total.toLocaleString()}</td>
                      <td className="text-right py-2">{data.inspected.toLocaleString()}</td>
                      <td className="text-right py-2">
                        <span className={`font-medium ${
                          entryRate >= 90 ? 'text-green-600'
                          : entryRate >= 50 ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {entryRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right py-2 text-red-600">{data.refusals.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

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
                <th className="text-right py-2 text-gray-500">Entries</th>
                <th className="text-right py-2 text-gray-500">Rate</th>
                <th className="text-right py-2 text-gray-500">Impr</th>
                <th className="text-right py-2 text-gray-500">Impr Rate</th>
              </tr>
            </thead>
            <tbody>
              {sortedClasses.map(([cls, data]) => {
                const classRate = data.total > 0 ? (data.inspected / data.total) * 100 : 0;
                const imprRate = data.improvedTotal > 0 ? (data.improvedInspected / data.improvedTotal) * 100 : 0;
                return (
                  <tr key={cls} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{cls}</td>
                    <td className="text-right py-2">{data.total.toLocaleString()}</td>
                    <td className="text-right py-2">{data.inspected.toLocaleString()}</td>
                    <td className="text-right py-2">
                      <span className={`font-medium ${
                        classRate >= 90 ? 'text-green-600'
                        : classRate >= 50 ? 'text-amber-600'
                        : 'text-red-600'
                      }`}>
                        {classRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right py-2 text-indigo-600">{data.improvedTotal.toLocaleString()}</td>
                    <td className="text-right py-2">
                      {data.improvedTotal > 0 ? (
                        <span className={`font-medium ${
                          imprRate >= 90 ? 'text-green-600'
                          : imprRate >= 50 ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {imprRate.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                  <th className="text-right py-2 text-gray-500">Entries</th>
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
          Missing Entries
          <span className="text-xs font-normal text-gray-400 ml-2">
            ({metrics.notInspected.toLocaleString()} total
            {metrics.missingInspections.length < metrics.notInspected ? `, showing first ${metrics.missingInspections.length}` : ''})
          </span>
        </h3>
        {metrics.missingInspections.length === 0 ? (
          <div className="text-center py-8 text-green-600">
            <CheckCircle className="w-10 h-10 mx-auto mb-2" />
            <p className="font-medium">All properties have entries!</p>
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
                  <th className="text-center py-2 text-gray-500">Impr</th>
                  <th className="text-center py-2 text-gray-500">Ref</th>
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
                    <td className="py-1.5 text-center">
                      {prop.isImproved ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" title="Improved"></span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="py-1.5 text-center">
                      {prop.isRefusal ? (
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700" title="Refusal">R</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
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
