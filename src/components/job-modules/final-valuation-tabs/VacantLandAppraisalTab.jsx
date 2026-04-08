import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';

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
  const [loadedProperties, setLoadedProperties] = useState({});

  // Better property lookup - match by block and lot flexibly
  const getPropertyData = (block, lot, qualifier) => {
    if (!block || !lot) return null;
    
    // Try exact composite key match first (with qualifier variations)
    const blockStr = String(block).trim();
    const lotStr = String(lot).trim();
    const qualStr = String(qualifier || '').trim();
    
    // Search through properties to find matching block/lot
    const prop = properties.find(p => {
      if (!p.property_block || !p.property_lot) return false;
      const pBlock = String(p.property_block).trim();
      const pLot = String(p.property_lot).trim();
      const pQual = String(p.property_qualifier || '').trim();
      
      // Match block and lot, qualifier is flexible (empty or exact match)
      return pBlock === blockStr && pLot === lotStr && 
             (!qualStr || pQual === qualStr || !pQual);
    });
    
    return prop || null;
  };

  // Calculate estimated land value
  const estimatedLandValue = useMemo(() => {
    const subjectProp = loadedProperties.subject;
    if (!subjectProp?.asset_lot_acre || parseFloat(subjectProp.asset_lot_acre) === 0) return null;

    const comps = Object.keys(loadedProperties)
      .filter(key => key.startsWith('comp_'))
      .map(key => loadedProperties[key])
      .filter(prop => prop && prop.sales_price && prop.asset_lot_acre && parseFloat(prop.asset_lot_acre) > 0);

    if (comps.length === 0) return null;

    // Average price per acre from comps
    const avgPricePerAcre = comps.reduce((sum, prop) => {
      const pricePerAcre = parseFloat(prop.sales_price) / parseFloat(prop.asset_lot_acre);
      return sum + pricePerAcre;
    }, 0) / comps.length;

    // Estimate = subject lot acres x avg price per acre
    const estimate = parseFloat(subjectProp.asset_lot_acre) * avgPricePerAcre;
    return Math.round(estimate);
  }, [loadedProperties]);

  // Load properties on Evaluate click
  const handleEvaluate = () => {
    setVacantLandEvaluating(true);
    
    // Load subject property
    const subjectData = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
    const loaded = { subject: subjectData };
    
    // Load all comps
    vacantLandComps.forEach((comp, idx) => {
      const compData = getPropertyData(comp.block, comp.lot, comp.qualifier);
      loaded[`comp_${idx}`] = compData;
    });
    
    setLoadedProperties(loaded);
    
    // Set result if we have valid data
    if (estimatedLandValue !== null) {
      setVacantLandResult(estimatedLandValue);
    }
    
    setVacantLandEvaluating(false);
  };

  const handleSave = () => {
    alert('Save functionality coming soon - will store this appraisal to the database');
  };

  const handleExport = () => {
    alert('Export to PDF coming soon - will generate appraisal report');
  };

  const subjectProp = loadedProperties.subject;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-semibold text-blue-900 mb-2">Vacant Land Appraisal</h3>
        <p className="text-sm text-blue-700">
          Enter subject block/lot/qualifier and comparable vacant land sales. Click "Evaluate" to load property data and calculate estimated land value based on average comp price/acre.
        </p>
      </div>

      {/* Entry Section */}
      <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
        <div className="bg-gray-100 px-4 py-3 border-b border-gray-300">
          <h4 className="font-semibold text-gray-900">Property Entry</h4>
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
                    tabIndex={1}
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
                      tabIndex={4 + (idx * 3)}
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
                    tabIndex={2}
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
                      tabIndex={5 + (idx * 3)}
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
                    tabIndex={3}
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
                      tabIndex={6 + (idx * 3)}
                    />
                  </td>
                ))}
              </tr>

              {/* Lot Size Acre (Display Only) */}
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-700 text-xs">Lot Size (Acre)</td>
                <td className="px-3 py-2 text-center bg-yellow-50 text-xs font-medium">
                  {(() => {
                    const prop = getPropertyData(vacantLandSubject.block, vacantLandSubject.lot, vacantLandSubject.qualifier);
                    return prop?.asset_lot_acre ? parseFloat(prop.asset_lot_acre).toFixed(3) : '-';
                  })()}
                </td>
                {vacantLandComps.map((comp, idx) => {
                  const prop = getPropertyData(comp.block, comp.lot, comp.qualifier);
                  return (
                    <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs font-medium">
                      {prop?.asset_lot_acre ? parseFloat(prop.asset_lot_acre).toFixed(3) : '-'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Evaluate Button Section */}
        <div className="px-4 py-4 border-t border-gray-200 bg-gray-50 flex gap-3">
          <button
            onClick={handleEvaluate}
            disabled={!vacantLandSubject.block || !vacantLandSubject.lot || vacantLandEvaluating}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded font-medium text-sm hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {vacantLandEvaluating ? 'Loading...' : 'Evaluate & Load Properties'}
          </button>
          <button
            onClick={handleSave}
            disabled={!subjectProp}
            className="px-4 py-2 bg-green-500 text-white rounded font-medium text-sm hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            onClick={handleExport}
            disabled={!vacantLandResult}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded font-medium text-sm hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download size={14} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Appraisal Grid (shown after Evaluate is clicked) */}
      {subjectProp && (
        <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-3 border-b border-gray-300">
            <h4 className="font-semibold text-gray-900">Appraisal Grid</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-100 border-b-2 border-gray-300">
                  <th className="px-3 py-2 text-left font-semibold text-gray-700 w-32">Attribute</th>
                  <th className="px-3 py-2 text-center font-semibold bg-yellow-50 w-24">Subject</th>
                  {[1, 2, 3, 4, 5].map((compNum) => (
                    <th key={compNum} className="px-3 py-2 text-center font-semibold bg-blue-50 border-l border-gray-300 w-24">
                      Comp {compNum}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {/* Location */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Location</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.property_location || '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.property_location || '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Lot Size FF */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Lot Size FF</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.asset_lot_frontage ? parseFloat(subjectProp.asset_lot_frontage).toFixed(0) : '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.asset_lot_frontage ? parseFloat(prop.asset_lot_frontage).toFixed(0) : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Lot Size SF */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Lot Size SF</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.asset_lot_sf ? Math.round(parseFloat(subjectProp.asset_lot_sf)).toLocaleString() : '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.asset_lot_sf ? Math.round(parseFloat(prop.asset_lot_sf)).toLocaleString() : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Lot Size Acre */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Lot Size Acre</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.asset_lot_acre ? parseFloat(subjectProp.asset_lot_acre).toFixed(3) : '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.asset_lot_acre ? parseFloat(prop.asset_lot_acre).toFixed(3) : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Zoning */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Zoning</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.property_zoning || '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.property_zoning || '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Current Assessment */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Current Assess</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">
                    {(() => {
                      const total = subjectProp?.values_mod_total || subjectProp?.values_cama_total || 0;
                      return total > 0 ? '$' + Math.round(total).toLocaleString() : '-';
                    })()}
                  </td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    const total = prop?.values_mod_total || prop?.values_cama_total || 0;
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {total > 0 ? '$' + Math.round(total).toLocaleString() : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Sales Price */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Sales Price</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.sales_price ? '$' + Math.round(parseFloat(subjectProp.sales_price)).toLocaleString() : '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.sales_price ? '$' + Math.round(parseFloat(prop.sales_price)).toLocaleString() : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Sales Date */}
                <tr className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">Sales Date</td>
                  <td className="px-3 py-2 text-center bg-yellow-50 text-xs">{subjectProp?.sales_date ? new Date(subjectProp.sales_date).toLocaleDateString() : '-'}</td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-50 border-l border-gray-300 text-xs">
                        {prop?.sales_date ? new Date(prop.sales_date).toLocaleDateString() : '-'}
                      </td>
                    );
                  })}
                </tr>

                {/* Price Per Acre */}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="px-3 py-2 font-medium text-gray-700">Price/Acre</td>
                  <td className="px-3 py-2 text-center bg-yellow-100 text-xs font-semibold">
                    {(() => {
                      if (subjectProp?.sales_price && subjectProp?.asset_lot_acre && parseFloat(subjectProp.asset_lot_acre) > 0) {
                        const pricePerAcre = parseFloat(subjectProp.sales_price) / parseFloat(subjectProp.asset_lot_acre);
                        return '$' + Math.round(pricePerAcre).toLocaleString();
                      }
                      return '-';
                    })()}
                  </td>
                  {vacantLandComps.map((comp, idx) => {
                    const prop = loadedProperties[`comp_${idx}`];
                    return (
                      <td key={idx} className="px-3 py-2 text-center bg-blue-100 border-l border-gray-300 text-xs font-semibold">
                        {(() => {
                          if (prop?.sales_price && prop?.asset_lot_acre && parseFloat(prop.asset_lot_acre) > 0) {
                            const pricePerAcre = parseFloat(prop.sales_price) / parseFloat(prop.asset_lot_acre);
                            return '$' + Math.round(pricePerAcre).toLocaleString();
                          }
                          return '-';
                        })()}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {vacantLandResult && (
        <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
          <p className="text-sm font-semibold text-green-900">Estimated Vacant Land Value</p>
          <p className="text-4xl font-bold text-green-700 mt-3">
            ${vacantLandResult.toLocaleString('en-US', {maximumFractionDigits: 0})}
          </p>
          <p className="text-sm text-green-700 mt-3">
            Calculated as: {Object.keys(loadedProperties).filter(k => k.startsWith('comp_')).filter(k => loadedProperties[k]).length} comparable(s) × average price/acre × {subjectProp?.asset_lot_acre ? parseFloat(subjectProp.asset_lot_acre).toFixed(3) : 0} acres
          </p>
        </div>
      )}
    </div>
  );
};

export default VacantLandAppraisalTab;
