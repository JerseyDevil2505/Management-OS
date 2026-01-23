import React from 'react';
import { interpretCodes } from '../../../lib/supabaseClient';

const DetailedAppraisalGrid = ({ result, jobData, codeDefinitions, vendorType, adjustmentGrid = [] }) => {
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

  // Helper to get adjustment for a specific attribute
  const getAdjustment = (comp, attributeName) => {
    return comp.adjustments?.find(a => 
      a.name === attributeName || 
      a.name?.toLowerCase().includes(attributeName.toLowerCase())
    );
  };

  // Helper to count BRT items by category codes
  const countBRTItems = (property, categoryCodes) => {
    if (vendorType !== 'BRT' || !property.raw_brt_items) return 0;
    try {
      const items = JSON.parse(property.raw_brt_items);
      return items.filter(item => categoryCodes.includes(item.category)).length;
    } catch {
      return 0;
    }
  };

  // Helper to get BRT item area by category codes
  const getBRTItemArea = (property, categoryCodes) => {
    if (vendorType !== 'BRT' || !property.raw_brt_items) return 0;
    try {
      const items = JSON.parse(property.raw_brt_items);
      const matchingItems = items.filter(item => categoryCodes.includes(item.category));
      return matchingItems.reduce((sum, item) => sum + (parseFloat(item.area) || 0), 0);
    } catch {
      return 0;
    }
  };

  // Define attribute order as specified by user
  const ATTRIBUTE_ORDER = [
    { 
      id: 'vcs', 
      label: 'VCS',
      render: (prop) => `${prop.property_block}/${prop.property_lot}${prop.property_qualifier ? '/' + prop.property_qualifier : ''}`,
      adjustmentName: null // No adjustment for VCS
    },
    {
      id: 'block_lot_qual',
      label: 'Block/Lot/Qualifier',
      render: (prop) => `${prop.property_block}/${prop.property_lot}${prop.property_qualifier ? '/' + prop.property_qualifier : ''}`,
      adjustmentName: null,
      bold: true
    },
    {
      id: 'location',
      label: 'Location',
      render: (prop) => prop.property_location || 'N/A',
      adjustmentName: null
    },
    {
      id: 'prev_assessment',
      label: 'Prev Assessment',
      render: (prop) => {
        const value = prop.values_mod4_total || prop.values_mod_total || prop.values_cama_total || 0;
        return value ? `$${value.toLocaleString()}` : 'N/A';
      },
      adjustmentName: null,
      bold: true
    },
    {
      id: 'property_class',
      label: 'Property Class',
      render: (prop) => prop.property_class || prop.asset_property_class || 'N/A',
      adjustmentName: null
    },
    {
      id: 'building_class',
      label: 'Building Class',
      render: (prop) => prop.asset_building_class || 'N/A',
      adjustmentName: null
    },
    {
      id: 'style_code',
      label: 'Style Code',
      render: (prop) => {
        if (!prop.asset_design_style) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getDesignName(prop, codeDefinitions, vendorType);
          return name ? `${prop.asset_design_style} (${name})` : prop.asset_design_style;
        }
        return prop.asset_design_style;
      },
      adjustmentName: null
    },
    {
      id: 'type_use_code',
      label: 'Type Use Code',
      render: (prop) => {
        if (!prop.asset_type_use) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getTypeName(prop, codeDefinitions, vendorType);
          return name ? `${prop.asset_type_use} (${name})` : prop.asset_type_use;
        }
        return prop.asset_type_use;
      },
      adjustmentName: null
    },
    {
      id: 'story_height_code',
      label: 'Story Height Code',
      render: (prop) => prop.asset_stories || prop.asset_story_height || 'N/A',
      adjustmentName: null
    },
    {
      id: 'view_code',
      label: 'View Code',
      render: (prop) => prop.asset_view || prop.asset_view_code || 'N/A',
      adjustmentName: null
    },
    {
      id: 'sales_code',
      label: 'Sales Code',
      render: (prop) => prop.sales_nu || prop.sales_code || '0',
      adjustmentName: null
    },
    {
      id: 'sales_date',
      label: 'Sales Date',
      render: (prop) => prop.sales_date || 'N/A',
      adjustmentName: null
    },
    {
      id: 'sales_price',
      label: 'Sales Price',
      render: (prop) => prop.sales_price ? `$${prop.sales_price.toLocaleString()}` : 'N/A',
      adjustmentName: null,
      bold: true
    },
    {
      id: 'lot_size_ff',
      label: 'Lot Size (FF)',
      render: (prop) => (prop.market_manual_lot_ff || prop.asset_lot_ff || prop.asset_lot_frontage)?.toLocaleString() || 'N/A',
      adjustmentName: 'Lot Size (FF)'
    },
    {
      id: 'lot_size_sf',
      label: 'Lot Size (SF)',
      render: (prop) => (prop.market_manual_lot_sf || prop.asset_lot_sf)?.toLocaleString() || 'N/A',
      adjustmentName: 'Lot Size (SF)',
      bold: true
    },
    {
      id: 'lot_size_acre',
      label: 'Lot Size (Acre)',
      render: (prop) => {
        const acres = prop.market_manual_lot_acre || prop.asset_lot_acre;
        return acres ? acres.toFixed(2) : 'N/A';
      },
      adjustmentName: 'Lot Size (Acre)'
    },
    {
      id: 'liveable_area',
      label: 'Liveable Area',
      render: (prop) => prop.asset_sfla?.toLocaleString() || 'N/A',
      adjustmentName: 'Living Area (Sq Ft)',
      bold: true
    },
    {
      id: 'year_built',
      label: 'Year Built',
      render: (prop) => prop.asset_year_built || 'N/A',
      adjustmentName: 'Year Built',
      bold: true
    },
    {
      id: 'basement_area',
      label: 'Basement Area',
      render: (prop) => {
        // Check if basement_area column exists (future)
        if (prop.basement_area !== undefined) {
          return prop.basement_area > 0 ? `${prop.basement_area.toLocaleString()} SF` : 'None';
        }
        // Fallback to boolean check
        if (vendorType === 'BRT') {
          return prop.asset_basement || prop.brt_basement ? 'Yes' : 'None';
        } else {
          return prop.asset_basement ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Basement'
    },
    {
      id: 'fin_bsmt_area',
      label: 'Fin Bsmt Area',
      render: (prop) => {
        // Check if fin_basement_area column exists (future)
        if (prop.fin_basement_area !== undefined) {
          return prop.fin_basement_area > 0 ? `${prop.fin_basement_area.toLocaleString()} SF` : 'None';
        }
        // Fallback to boolean check
        if (vendorType === 'BRT') {
          return prop.asset_fin_basement || prop.brt_fin_basement ? 'Yes' : 'None';
        } else {
          return prop.asset_fin_basement ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Finished Basement'
    },
    {
      id: 'bathrooms',
      label: '# Bathrooms',
      render: (prop) => prop.total_baths_calculated || prop.asset_bathrooms || 'N/A',
      adjustmentName: 'Bathrooms',
      bold: true
    },
    {
      id: 'bedrooms',
      label: '# Bedrooms',
      render: (prop) => prop.asset_bedrooms || 'N/A',
      adjustmentName: 'Bedrooms',
      bold: true
    },
    {
      id: 'ac_area',
      label: 'AC Area',
      render: (prop) => {
        if (prop.ac_area !== undefined) {
          return prop.ac_area > 0 ? `${prop.ac_area.toLocaleString()} SF` : 'None';
        }
        return prop.asset_ac ? 'Yes' : 'None';
      },
      adjustmentName: 'AC'
    },
    {
      id: 'fireplaces',
      label: '# Fireplaces',
      render: (prop) => prop.asset_fireplaces || '0',
      adjustmentName: 'Fireplaces'
    },
    {
      id: 'garage_area',
      label: 'Garage Area (Per Car)',
      render: (prop) => {
        // Check if garage_area column exists (future)
        if (prop.garage_area !== undefined) {
          return prop.garage_area > 0 ? `${prop.garage_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const count = countBRTItems(prop, ['11']); // Category 11 is attached items including garage
          return count > 0 ? `${count} car` : 'None';
        } else {
          return prop.asset_garage ? `${prop.asset_garage} car` : 'None';
        }
      },
      adjustmentName: 'Garage'
    },
    {
      id: 'det_garage_area',
      label: 'Det Garage Area (Per Car)',
      render: (prop) => {
        // Check if det_garage_area column exists (future)
        if (prop.det_garage_area !== undefined) {
          return prop.det_garage_area > 0 ? `${prop.det_garage_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const count = countBRTItems(prop, ['15']); // Category 15 is detached items
          return count > 0 ? `${count} car` : 'None';
        } else {
          return prop.asset_det_garage ? `${prop.asset_det_garage} car` : 'None';
        }
      },
      adjustmentName: 'Det Garage'
    },
    {
      id: 'deck_area',
      label: 'Deck Area',
      render: (prop) => {
        // Check if deck_area column exists (future)
        if (prop.deck_area !== undefined) {
          return prop.deck_area > 0 ? `${prop.deck_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific deck codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'None';
        } else {
          return prop.asset_deck ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Deck'
    },
    {
      id: 'patio_area',
      label: 'Patio Area',
      render: (prop) => {
        // Check if patio_area column exists (future)
        if (prop.patio_area !== undefined) {
          return prop.patio_area > 0 ? `${prop.patio_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific patio codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'None';
        } else {
          return prop.asset_patio ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Patio'
    },
    {
      id: 'open_porch_area',
      label: 'Open Porch Area',
      render: (prop) => {
        // Check if open_porch_area column exists (future)
        if (prop.open_porch_area !== undefined) {
          return prop.open_porch_area > 0 ? `${prop.open_porch_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific open porch codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'None';
        } else {
          return prop.asset_open_porch ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Open Porch'
    },
    {
      id: 'enclosed_porch_area',
      label: 'Enclosed Porch Area',
      render: (prop) => {
        // Check if enclosed_porch_area column exists (future)
        if (prop.enclosed_porch_area !== undefined) {
          return prop.enclosed_porch_area > 0 ? `${prop.enclosed_porch_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific enclosed porch codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'None';
        } else {
          return prop.asset_enclosed_porch ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Enclosed Porch'
    },
    {
      id: 'pool_area',
      label: 'Pool Area',
      render: (prop) => {
        // Check if pool_area column exists (future)
        if (prop.pool_area !== undefined) {
          return prop.pool_area > 0 ? `${prop.pool_area.toLocaleString()} SF` : 'None';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['15']); // Category 15 includes pools
          return area > 0 ? `${area.toLocaleString()} SF` : 'None';
        } else {
          return prop.asset_pool ? 'Yes' : 'None';
        }
      },
      adjustmentName: 'Pool'
    },
    {
      id: 'ext_condition',
      label: 'Ext Condition',
      render: (prop) => prop.asset_ext_condition || prop.asset_exterior_condition || 'N/A',
      adjustmentName: 'Exterior Condition'
    },
    {
      id: 'int_condition',
      label: 'Int Condition',
      render: (prop) => prop.asset_int_condition || prop.asset_interior_condition || 'N/A',
      adjustmentName: 'Interior Condition'
    }
  ];

  // Get dynamic attributes from adjustmentGrid (exclude default ones)
  const dynamicAttributes = adjustmentGrid
    .filter(adj => !adj.is_default)
    .map(adj => ({
      id: adj.adjustment_id,
      label: adj.adjustment_name,
      render: (prop) => {
        // For dynamic attributes, try to find corresponding property data
        // This will need custom logic based on your data structure
        return 'N/A'; // Placeholder - will need property-specific rendering
      },
      adjustmentName: adj.adjustment_name,
      isDynamic: true
    }));

  // Combine static and dynamic attributes
  const allAttributes = [...ATTRIBUTE_ORDER, ...dynamicAttributes];

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
                Subject
              </th>
              {[1, 2, 3, 4, 5].map((compNum) => {
                const comp = comps[compNum - 1];
                const bgColor = comp?.isSubjectSale ? 'bg-green-50' : 'bg-blue-50';
                return (
                  <th key={compNum} className={`px-3 py-3 text-center font-semibold ${bgColor} border-l border-gray-300`}>
                    Comparable {compNum}
                    {comp?.isSubjectSale && (
                      <span className="block text-xs text-green-700 font-semibold mt-1">(Subject Sale)</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {/* Render all attributes in order */}
            {allAttributes.map((attr) => (
              <tr key={attr.id} className="border-b hover:bg-gray-50">
                <td className="px-2 py-2">
                  <input type="checkbox" className="rounded" />
                </td>
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                  {attr.label}
                  {attr.isDynamic && (
                    <span className="ml-2 text-xs text-purple-600">(Custom)</span>
                  )}
                </td>
                <td className={`px-3 py-2 text-center bg-yellow-50 ${attr.bold ? 'font-semibold' : 'text-xs'}`}>
                  {attr.render(subject)}
                </td>
                {renderCompCells((comp) => {
                  const value = attr.render(comp);
                  const adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
                  
                  return (
                    <div>
                      <div className={attr.bold ? 'font-semibold' : 'text-xs'}>{value}</div>
                      {adj && adj.amount !== 0 && (
                        <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {adj.amount > 0 ? '+' : ''}${adj.amount.toLocaleString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </tr>
            ))}

            {/* Net Adjustment */}
            <tr className="border-b-2 border-gray-400 bg-gray-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                Net Adjustment
              </td>
              <td className="px-3 py-3 text-center bg-yellow-50">-</td>
              {renderCompCells((comp) => (
                <div className={`font-bold ${comp.totalAdjustment > 0 ? 'text-green-700' : comp.totalAdjustment < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                  {comp.totalAdjustment > 0 ? '+' : ''}${comp.totalAdjustment?.toLocaleString() || '0'}
                  <div className="text-xs mt-1">
                    ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(0) || '0'}%)
                  </div>
                </div>
              ))}
            </tr>

            {/* Adjusted Valuation */}
            <tr className="border-b-4 border-gray-400 bg-blue-50">
              <td className="px-2 py-2"><input type="checkbox" className="rounded" /></td>
              <td className="sticky left-0 z-10 bg-blue-50 px-3 py-4 font-bold text-gray-900 border-r-2 border-gray-300 text-base">
                Adjusted Valuation
              </td>
              <td className="px-3 py-4 text-center bg-yellow-100">
                {result.projectedAssessment && (
                  <div>
                    <div className="text-lg font-bold text-green-700">
                      ${result.projectedAssessment.toLocaleString()}
                    </div>
                    <div className="text-sm font-semibold text-green-600 mt-1">
                      {(() => {
                        const current = subject.values_mod_total || subject.values_cama_total || 0;
                        if (current === 0) return '';
                        const changePercent = ((result.projectedAssessment - current) / current) * 100;
                        const isCloserToZero = Math.abs(changePercent) < 5;
                        return (
                          <span className={isCloserToZero ? 'text-green-700' : 'text-orange-600'}>
                            ({changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%)
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </td>
              {renderCompCells((comp) => {
                const absAdjPercent = Math.abs(comp.adjustmentPercent || 0);
                const isCloserToZero = absAdjPercent < 10; // Closer to 0% is better
                
                return (
                  <div>
                    <div className="text-base font-bold text-gray-900">
                      ${Math.round(comp.adjustedPrice || 0).toLocaleString()}
                    </div>
                    <div className={`text-sm font-semibold mt-1 ${isCloserToZero ? 'text-green-600' : 'text-orange-600'}`}>
                      ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(0) || '0'}% adj)
                    </div>
                  </div>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DetailedAppraisalGrid;
