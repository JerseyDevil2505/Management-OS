import { Download, X } from 'lucide-react';
import { useMemo } from 'react';

const VacantLandAppraisalTab = ({ 
  properties = [], 
  jobData,
  vacantLandSubject,
  setVacantLandSubject,
  vacantLandComps,
  setVacantLandComps,
  vacantLandEvaluating,
  setVacantLandEvaluating,
  vacantLandResult,
  setVacantLandResult
}) => {
  // Get property data for a given BLQ
  const getPropertyData = (block, lot, qualifier) => {
    if (!block || !lot) return null;
    const composite = block + '-' + lot + (qualifier || '');
    return properties.find(p => p.property_composite_key === composite);
  };

  // Calculate estimated land value: average price per acre x subject lot size
  const estimatedLandValue = useMemo(() => {
    const subjectProp = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
    if (!subjectProp?.asset_lot_acre || parseFloat(subjectProp.asset_lot_acre) === 0) return null;

    const validComps = vacantLandComps
      .map(comp => getPropertyData(comp.block, comp.lot, comp.qualifier))
      .filter(prop => prop?.sales_price && prop?.asset_lot_acre && parseFloat(prop.asset_lot_acre) > 0);

    if (validComps.length === 0) return null;

    // Average price per acre from comps
    const avgPricePerAcre = validComps.reduce((sum, prop) => {
      const pricePerAcre = parseFloat(prop.sales_price) / parseFloat(prop.asset_lot_acre);
      return sum + pricePerAcre;
    }, 0) / validComps.length;

    // Estimate = subject lot acres x avg price per acre
    const estimate = parseFloat(subjectProp.asset_lot_acre) * avgPricePerAcre;
    return Math.round(estimate);
  }, [vacantLandSubject, vacantLandComps, properties]);

  return (
    <div className="space-y-6">
      {/* Header with Manual Entry Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">Vacant Land Appraisal</h3>
        <p className="text-sm text-blue-700">
          Enter subject block/lot/qualifier and comparable vacant land sales below. The grid will auto-populate lot size (FF, SF, Acres), zoning, sales price, sales date, and price per acre. Estimated land value = average comp price/acre × subject lot acres.
        </p>
      </div>

      {/* Manual Entry Grid */}
      <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-3 border-b border-gray-300 flex items-center justify-between">
          <h4 className="font-semibold text-gray-900">Property Entry</h4>
          <div className="flex gap-2">
            <button
              onClick={() => alert('Save functionality coming soon')}
              className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
            >
              Save
            </button>
            <button
              onClick={() => alert('PDF export coming soon')}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600"
            >
              <Download size={14} />
              Export PDF
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-32"></th>
                <th className="px-3 py-2 text-center font-semibold bg-yellow-50 w-20">Subject</th>
                {[1, 2, 3, 4, 5].map((compNum) => (
                  <th key={compNum} className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300 w-20">
                    Comp {compNum}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {/* Block */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Block</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.block}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, block: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Block"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.block}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], block: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Block"
                    />
                  </td>
                ))}
              </tr>

              {/* Lot */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Lot</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.lot}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, lot: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Lot"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.lot}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], lot: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Lot"
                    />
                  </td>
                ))}
              </tr>

              {/* Qualifier */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Qual</td>
                <td className="px-3 py-2 text-center bg-yellow-50">
                  <input
                    type="text"
                    value={vacantLandSubject.qualifier}
                    onChange={(e) => setVacantLandSubject(prev => ({ ...prev, qualifier: e.target.value }))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    placeholder="Qual"
                  />
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300">
                    <input
                      type="text"
                      value={comp.qualifier}
                      onChange={(e) => {
                        const newComps = [...vacantLandComps];
                        newComps[idx] = { ...newComps[idx], qualifier: e.target.value };
                        setVacantLandComps(newComps);
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                      placeholder="Qual"
                    />
                  </td>
                ))}
              </tr>

              {/* Location (read-only) */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Location</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.property_location || '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.property_location || '-'}
                  </td>
                ))}
              </tr>

              {/* Lot Size - FF (frontage) */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Lot Size FF</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.asset_lot_frontage ? 
                    parseFloat(getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier).asset_lot_frontage).toFixed(0) : '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.asset_lot_frontage ? 
                      parseFloat(getPropertyData(comp.block, comp.lot, comp.qualifier).asset_lot_frontage).toFixed(0) : '-'}
                  </td>
                ))}
              </tr>

              {/* Lot Size - SF (square feet) */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Lot Size SF</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.asset_lot_sf ? 
                    Math.round(parseFloat(getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier).asset_lot_sf)).toLocaleString() : '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.asset_lot_sf ? 
                      Math.round(parseFloat(getPropertyData(comp.block, comp.lot, comp.qualifier).asset_lot_sf)).toLocaleString() : '-'}
                  </td>
                ))}
              </tr>

              {/* Lot Size - Acre */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Lot Size Acre</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.asset_lot_acre ? 
                    parseFloat(getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier).asset_lot_acre).toFixed(3) : '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.asset_lot_acre ? 
                      parseFloat(getPropertyData(comp.block, comp.lot, comp.qualifier).asset_lot_acre).toFixed(3) : '-'}
                  </td>
                ))}
              </tr>

              {/* Zoning */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Zoning</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.property_zoning || '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.property_zoning || '-'}
                  </td>
                ))}
              </tr>

              {/* Current Assessment */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Current Assess</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {(() => {
                    const prop = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
                    if (!prop) return '-';
                    const total = prop.values_mod_total || prop.values_cama_total || 0;
                    return total > 0 ? '$' + Math.round(total).toLocaleString() : '-';
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {(() => {
                      const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                      if (!prop) return '-';
                      const total = prop.values_mod_total || prop.values_cama_total || 0;
                      return total > 0 ? '$' + Math.round(total).toLocaleString() : '-';
                    })()}
                  </td>
                ))}
              </tr>

              {/* Sales Price */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Sales Price</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.sales_price ? 
                    '$' + Math.round(parseFloat(getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier).sales_price)).toLocaleString() : '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.sales_price ? 
                      '$' + Math.round(parseFloat(getPropertyData(comp.block, comp.lot, comp.qualifier).sales_price)).toLocaleString() : '-'}
                  </td>
                ))}
              </tr>

              {/* Sales Date */}
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">Sales Date</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                  {getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier)?.sales_date ? 
                    new Date(getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier).sales_date).toLocaleDateString() : '-'}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                    {getPropertyData(comp.block, comp.lot, comp.qualifier)?.sales_date ? 
                      new Date(getPropertyData(comp.block, comp.lot, comp.qualifier).sales_date).toLocaleDateString() : '-'}
                  </td>
                ))}
              </tr>

              {/* Price Per Acre */}
              <tr className="border-t border-gray-200 font-semibold">
                <td className="px-3 py-2 font-medium text-gray-700">Price/Acre</td>
                <td className="px-3 py-2 text-center bg-yellow-100 text-xs font-semibold">
                  {(() => {
                    const prop = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
                    if (prop?.sales_price && prop?.asset_lot_acre && parseFloat(prop.asset_lot_acre) > 0) {
                      const pricePerAcre = parseFloat(prop.sales_price) / parseFloat(prop.asset_lot_acre);
                      return '$' + Math.round(pricePerAcre).toLocaleString();
                    }
                    return '-';
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => (
                  <td key={idx} className="px-3 py-2 text-center bg-blue-100 border-l border-gray-300 text-xs font-semibold">
                    {(() => {
                      const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                      if (prop?.sales_price && prop?.asset_lot_acre && parseFloat(prop.asset_lot_acre) > 0) {
                        const pricePerAcre = parseFloat(prop.sales_price) / parseFloat(prop.asset_lot_acre);
                        return '$' + Math.round(pricePerAcre).toLocaleString();
                      }
                      return '-';
                    })()}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Evaluate Button */}
        <div className="px-4 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={() => {
              if (estimatedLandValue !== null) {
                setVacantLandResult(estimatedLandValue);
              }
            }}
            disabled={!vacantLandSubject.block || !vacantLandSubject.lot || estimatedLandValue === null}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded font-medium text-sm hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Evaluate & Calculate Land Value
          </button>
        </div>

        {/* Results */}
        {vacantLandResult && (
          <div className="px-4 py-4 bg-green-50 border-t border-green-200">
            <p className="text-sm font-semibold text-green-900">Estimated Vacant Land Value</p>
            <p className="text-3xl font-bold text-green-700 mt-2">
              ${vacantLandResult.toLocaleString('en-US', {maximumFractionDigits: 0})}
            </p>
            <p className="text-xs text-green-700 mt-2">
              Based on average comparable price/acre × subject lot acres
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VacantLandAppraisalTab;
