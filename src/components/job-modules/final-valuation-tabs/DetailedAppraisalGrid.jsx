import React from 'react';
import { interpretCodes } from '../../../lib/supabaseClient';

const DetailedAppraisalGrid = ({ result, jobData, codeDefinitions, vendorType }) => {
  const subject = result.subject;
  const comps = result.comparables || [];

  // Helper to render comp cells (shows all 5 even if empty)
  const renderCompCells = (renderFunc) => {
    return [0, 1, 2, 3, 4].map((idx) => {
      const comp = comps[idx];
      const bgColor = comp?.isSubjectSale ? 'bg-green-50' : 'bg-blue-50';
      return (
        <td key={idx} className={`px-3 py-2 text-center ${bgColor} border-l border-gray-300`}>
          {comp ? renderFunc(comp, idx) : <span className="text-gray-400">-</span>}
        </td>
      );
    });
  };

  return (
    <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <div className="bg-blue-600 px-4 py-3">
        <h4 className="font-semibold text-white">Detailed Evaluation</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <th className="w-8 px-2 py-3"></th>
              <th className="sticky left-0 z-10 bg-gray-100 px-3 py-3 text-left font-semibold text-gray-700 border-r-2 border-gray-300">
                Attribute
              </th>
              <th className="px-3 py-3 text-center font-semibold bg-yellow-50">
                Subject<br/>
                <span className="font-normal text-xs text-gray-600">
                  {subject.property_block}/{subject.property_lot}
                </span>
              </th>
              {[1, 2, 3, 4, 5].map((compNum) => {
                const comp = comps[compNum - 1];
                const bgColor = comp?.isSubjectSale ? 'bg-green-50' : 'bg-blue-50';
                return (
                  <th key={compNum} className={`px-3 py-3 text-center font-semibold ${bgColor} border-l border-gray-300`}>
                    Comparable {compNum}<br/>
                    {comp && (
                      <span className="font-normal text-xs text-gray-600">
                        {comp.property_block}/{comp.property_lot}
                      </span>
                    )}
                    {comp?.isSubjectSale && (
                      <span className="block text-xs text-green-700 font-semibold mt-1">(Subject Sale)</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {/* Block/Lot/Qual */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Block/Lot/Qual
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold text-xs">
                {subject.property_block}/{subject.property_lot}/{subject.property_qualifier || ''}
              </td>
              {renderCompCells((comp) => <span className="font-semibold text-xs">{comp.property_block}/{comp.property_lot}/{comp.property_qualifier || ''}</span>)}
            </tr>

            {/* Location */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Location
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.property_location || 'N/A'}</td>
              {renderCompCells((comp) => <span className="text-xs">{comp.property_location || 'N/A'}</span>)}
            </tr>

            {/* Building Code */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Building Class
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_building_class || 'N/A'}</td>
              {renderCompCells((comp) => <span className="text-xs">{comp.asset_building_class || 'N/A'}</span>)}
            </tr>

            {/* Type/Use */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Type/Use Code
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                {subject.asset_type_use ? (
                  codeDefinitions ? interpretCodes.getTypeName(subject, codeDefinitions, vendorType)
                    ? `${subject.asset_type_use} (${interpretCodes.getTypeName(subject, codeDefinitions, vendorType)})`
                    : subject.asset_type_use
                  : subject.asset_type_use
                ) : 'N/A'}
              </td>
              {renderCompCells((comp) => (
                <span className="text-xs">
                  {comp.asset_type_use ? (
                    codeDefinitions ? interpretCodes.getTypeName(comp, codeDefinitions, vendorType)
                      ? `${comp.asset_type_use} (${interpretCodes.getTypeName(comp, codeDefinitions, vendorType)})`
                      : comp.asset_type_use
                    : comp.asset_type_use
                  ) : 'N/A'}
                </span>
              ))}
            </tr>

            {/* Style Code */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Style Code
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                {subject.asset_design_style ? (
                  codeDefinitions ? interpretCodes.getDesignName(subject, codeDefinitions, vendorType)
                    ? `${subject.asset_design_style} (${interpretCodes.getDesignName(subject, codeDefinitions, vendorType)})`
                    : subject.asset_design_style
                  : subject.asset_design_style
                ) : 'N/A'}
              </td>
              {renderCompCells((comp) => (
                <span className="text-xs">
                  {comp.asset_design_style ? (
                    codeDefinitions ? interpretCodes.getDesignName(comp, codeDefinitions, vendorType)
                      ? `${comp.asset_design_style} (${interpretCodes.getDesignName(comp, codeDefinitions, vendorType)})`
                      : comp.asset_design_style
                    : comp.asset_design_style
                  ) : 'N/A'}
                </span>
              ))}
            </tr>

            {/* Sales Code */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Sale Code
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.sales_nu || '0'}</td>
              {renderCompCells((comp) => <span className="text-xs">{comp.sales_nu || '0'}</span>)}
            </tr>

            {/* Sales Date */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Sale Date
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.sales_date || 'N/A'}</td>
              {renderCompCells((comp) => <span className="text-xs">{comp.sales_date || 'N/A'}</span>)}
            </tr>

            {/* Sales Price */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Sale Price
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">
                {subject.sales_price ? `$${subject.sales_price.toLocaleString()}` : 'N/A'}
              </td>
              {renderCompCells((comp) => <span className="font-semibold">${comp.sales_price?.toLocaleString() || 'N/A'}</span>)}
            </tr>

            {/* Lot Size (SF) */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Lot Area Area
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">
                {(subject.market_manual_lot_sf || subject.asset_lot_sf)?.toLocaleString() || 'N/A'}
              </td>
              {renderCompCells((comp) => {
                const lotSF = comp.market_manual_lot_sf || comp.asset_lot_sf;
                const adj = comp.adjustments?.find(a => a.name?.includes('Lot Size (SF)'));
                return (
                  <div>
                    <div className="font-semibold">{lotSF?.toLocaleString() || 'N/A'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Liveable Area */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Liveable Area
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.asset_sfla?.toLocaleString() || 'N/A'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Living Area (Sq Ft)');
                return (
                  <div>
                    <div className="font-semibold">{comp.asset_sfla?.toLocaleString() || 'N/A'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Year Built */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Year Built
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.asset_year_built || 'N/A'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Year Built');
                return (
                  <div>
                    <div className="font-semibold">{comp.asset_year_built || 'N/A'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Bedrooms */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Bedrooms
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.asset_bedrooms || 'N/A'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Bedrooms');
                return (
                  <div>
                    <div className="font-semibold">{comp.asset_bedrooms || 'N/A'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Bathrooms */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Full Bathroom
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 font-semibold">{subject.total_baths_calculated || 'N/A'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Bathrooms');
                return (
                  <div>
                    <div className="font-semibold">{comp.total_baths_calculated || 'N/A'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Garage */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Garage Size
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_garage ? `${subject.asset_garage} car` : 'None'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Garage');
                return (
                  <div>
                    <div className="text-xs">{comp.asset_garage ? `${comp.asset_garage} car` : 'None'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Basement */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Basement Area
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_basement ? 'Yes' : 'No'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name === 'Basement');
                return (
                  <div>
                    <div className="text-xs">{comp.asset_basement ? 'Yes' : 'No'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Finished Basement */}
            <tr className="border-b hover:bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                Fin. Bsmt. Area
              </td>
              <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subject.asset_fin_basement ? 'Yes' : 'No'}</td>
              {renderCompCells((comp) => {
                const adj = comp.adjustments?.find(a => a.name?.includes('Finished Basement'));
                return (
                  <div>
                    <div className="text-xs">{comp.asset_fin_basement ? 'Yes' : 'No'}</div>
                    {adj && adj.amount !== 0 && (
                      <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </tr>

            {/* Net Adjustment */}
            <tr className="border-b-2 border-gray-400">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                Net Adjustment
              </td>
              <td className="px-3 py-3 text-center bg-yellow-50">-</td>
              {renderCompCells((comp) => (
                <div className={`font-bold ${comp.totalAdjustment > 0 ? 'text-green-700' : comp.totalAdjustment < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                  {comp.totalAdjustment > 0 ? '+' : ''}${comp.totalAdjustment?.toLocaleString() || '0'} ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(0) || '0'}%)
                </div>
              ))}
            </tr>

            {/* Adjusted Valuation */}
            <tr className="border-b-4 border-gray-400">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-white px-3 py-4 font-bold text-gray-900 border-r-2 border-gray-300 text-lg">
                Adjusted Valuation
              </td>
              <td className="px-3 py-4 text-center bg-yellow-50">
                {result.projectedAssessment && (
                  <div>
                    <div className="text-xl font-bold text-green-700">
                      ${result.projectedAssessment.toLocaleString()}
                    </div>
                    <div className="text-sm font-semibold text-green-600">
                      {(() => {
                        const current = subject.values_mod_total || subject.values_cama_total || 0;
                        if (current === 0) return '';
                        const changePercent = ((result.projectedAssessment - current) / current) * 100;
                        return `(${changePercent > 0 ? '+' : ''}${changePercent.toFixed(0)}%)`;
                      })()}
                    </div>
                  </div>
                )}
              </td>
              {renderCompCells((comp) => (
                <div className="font-bold text-gray-700">
                  ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                </div>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DetailedAppraisalGrid;
