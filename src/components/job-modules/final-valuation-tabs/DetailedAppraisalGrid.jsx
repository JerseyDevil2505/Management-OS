import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { interpretCodes, supabase } from '../../../lib/supabaseClient';
import { FileDown, X, Eye, EyeOff, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const DetailedAppraisalGrid = ({ result, jobData, codeDefinitions, vendorType, adjustmentGrid = [], compFilters = null, cmeBrackets = [], isJobContainerLoading = false }) => {
  const subject = result.subject;
  const comps = result.comparables || [];

  // ==================== PDF EXPORT STATE ====================
  const [showExportModal, setShowExportModal] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(true); // Toggle for comps-only mode
  const [rowVisibility, setRowVisibility] = useState({}); // { attrId: boolean }
  const [editableData, setEditableData] = useState({}); // { attrId_colIdx: value } for modal edits

  // Determine which bracket is being used
  const getBracketLabel = () => {
    if (!compFilters) return 'Auto';

    const selectedBracket = compFilters.adjustmentBracket;

    if (selectedBracket === 'auto') {
      // Show the auto-determined bracket based on subject's value
      const subjectValue = subject.values_norm_time || subject.sales_price || subject.values_mod_total || subject.values_cama_total || 0;
      const bracketIndex = cmeBrackets.findIndex(b => subjectValue >= b.min && subjectValue <= b.max);
      if (bracketIndex >= 0 && cmeBrackets[bracketIndex]) {
        return `Auto (${cmeBrackets[bracketIndex].label})`;
      }
      return 'Auto';
    } else if (selectedBracket && selectedBracket.startsWith('bracket_')) {
      // User selected a specific bracket
      const bracketIndex = parseInt(selectedBracket.replace('bracket_', ''));
      if (cmeBrackets[bracketIndex]) {
        return cmeBrackets[bracketIndex].label;
      }
    } else if (selectedBracket && selectedBracket.startsWith('custom_')) {
      return 'Custom Bracket';
    }

    return 'Unknown';
  };

  // Load garage thresholds from job settings
  const [garageThresholds, setGarageThresholds] = useState({
    one_car_max: 399,
    two_car_max: 799,
    three_car_max: 999
  });

  useEffect(() => {
    const loadGarageThresholds = async () => {
      try {
        const { data, error } = await supabase
          .from('job_settings')
          .select('setting_key, setting_value')
          .eq('job_id', jobData.id)
          .in('setting_key', ['garage_threshold_one_car_max', 'garage_threshold_two_car_max', 'garage_threshold_three_car_max']);

        if (error || !data) return;

        const newThresholds = { ...garageThresholds };
        data.forEach(setting => {
          const key = setting.setting_key.replace('garage_threshold_', '');
          newThresholds[key] = parseInt(setting.setting_value, 10) || garageThresholds[key];
        });
        setGarageThresholds(newThresholds);
      } catch (error) {
        // Silent error handling - don't interfere with job loading
        console.warn('⚠️ Garage thresholds loading error (non-critical):', error.message || error);
      }
    };

    // Wait for property loading to complete before loading settings
    if (jobData?.id && !isJobContainerLoading) {
      loadGarageThresholds();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, isJobContainerLoading]);

  // Garage category helpers
  const getGarageCategory = (sqft) => {
    if (!sqft || sqft === 0) return 0; // NONE
    if (sqft <= garageThresholds.one_car_max) return 1; // ONE CAR
    if (sqft <= garageThresholds.two_car_max) return 2; // TWO CAR
    if (sqft <= garageThresholds.three_car_max) return 3; // THREE CAR
    return 4; // MULTI CAR
  };

  const getGarageCategoryLabel = (category) => {
    const labels = ['NONE', 'ONE CAR', 'TWO CAR', 'THREE CAR', 'MULTI CAR'];
    return labels[category] || 'NONE';
  };

  const getGarageDisplayText = (sqft) => {
    if (!sqft || sqft === 0) return 'None';
    const category = getGarageCategory(sqft);
    const label = getGarageCategoryLabel(category);
    return `${label} (${sqft.toLocaleString()} SF)`;
  };

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
    if (!attributeName || !comp.adjustments) return null;

    // First try exact match
    let match = comp.adjustments.find(a => a.name === attributeName);
    if (match) return match;

    // Then try case-insensitive exact match
    const lowerName = attributeName.toLowerCase();
    match = comp.adjustments.find(a => a.name?.toLowerCase() === lowerName);
    if (match) return match;

    // No substring matching - too risky (e.g., "AC" matches "Lot Size (ACre)")
    return null;
  };

  // Helper to get adjustment definition from adjustmentGrid
  const getAdjustmentDef = (adjustmentName) => {
    if (!adjustmentName || !adjustmentGrid) return null;

    // First try exact match
    let match = adjustmentGrid.find(adj => adj.adjustment_name === adjustmentName);
    if (match) return match;

    // Then try case-insensitive exact match
    const lowerName = adjustmentName.toLowerCase();
    match = adjustmentGrid.find(adj => adj.adjustment_name?.toLowerCase() === lowerName);
    if (match) return match;

    // No substring matching
    return null;
  };

  // Helper to check if adjustment is flat type (YES/NONE display)
  const isAdjustmentFlat = (adjustmentName) => {
    const adjDef = getAdjustmentDef(adjustmentName);

    // If adjustment definition exists, use it
    if (adjDef) {
      return adjDef.adjustment_type === 'flat';
    }

    // Fallback: Common amenities that are typically flat adjustments
    const flatAmenities = [
      'Garage', 'Det Garage', 'Deck', 'Patio', 'Open Porch', 'Enclosed Porch',
      'Pool', 'Basement', 'Finished Basement', 'AC'
    ];
    return flatAmenities.some(amenity =>
      adjustmentName?.toLowerCase().includes(amenity.toLowerCase())
    );
  };

  // Helper to check if adjustment is count type (show numeric value)
  const isAdjustmentCount = (adjustmentName) => {
    const adjDef = getAdjustmentDef(adjustmentName);

    // If adjustment definition exists, use it
    if (adjDef) {
      return adjDef.adjustment_type === 'count';
    }

    // Fallback: Common count adjustments
    const countAmenities = ['Bathrooms', 'Bedrooms', 'Fireplaces'];
    return countAmenities.some(amenity =>
      adjustmentName?.toLowerCase().includes(amenity.toLowerCase())
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
      render: (prop) => prop.new_vcs || prop.property_vcs || 'N/A',
      adjustmentName: null // No adjustment for VCS
    },
    {
      id: 'block_lot_qual',
      label: 'Block/Lot/Qual',
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
      label: 'Prev. Assessment',
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
      render: (prop) => prop.property_m4_class || prop.property_cama_class || 'N/A',
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
      label: 'Type/Use Code',
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
      render: (prop) => {
        const code = prop.asset_stories || prop.asset_story_height;
        if (!code) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getStoryHeightName(prop, codeDefinitions, vendorType);
          return name ? `${code} (${name})` : code;
        }
        return code;
      },
      adjustmentName: null
    },
    {
      id: 'view_code',
      label: 'View Code',
      render: (prop) => {
        const code = prop.asset_view || prop.asset_view_code;
        if (!code) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getViewName(prop, codeDefinitions, vendorType);
          return name ? `${code} (${name})` : code;
        }
        return code;
      },
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
      id: 'lot_size_sf',
      label: 'Lot Size',
      render: (prop) => (prop.market_manual_lot_sf || prop.asset_lot_sf)?.toLocaleString() || 'N/A',
      adjustmentName: 'Lot Size (SF)',
      bold: true
    },
    {
      id: 'lot_size_ff',
      label: 'Lot Size (Front Foot)',
      render: (prop) => (prop.market_manual_lot_ff || prop.asset_lot_ff || prop.asset_lot_frontage)?.toLocaleString() || 'N/A',
      adjustmentName: 'Lot Size (FF)'
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
      label: 'Fin. Bsmt. Area',
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
        // Use new ac_area column if available
        if (prop.ac_area !== undefined && prop.ac_area !== null) {
          return prop.ac_area > 0 ? `${prop.ac_area.toLocaleString()} SF` : 'None';
        }
        // Fallback to boolean indicator
        return prop.asset_ac ? 'Yes' : 'No';
      },
      adjustmentName: 'AC'
    },
    {
      id: 'fireplaces',
      label: '# Fireplaces',
      render: (prop) => {
        // Use new fireplace_count column if available (sum of FIREPLACECNT_1 and FIREPLACECNT_2 for BRT)
        if (prop.fireplace_count !== undefined && prop.fireplace_count !== null) {
          return prop.fireplace_count;
        }
        return prop.asset_fireplaces || '0';
      },
      adjustmentName: 'Fireplaces'
    },
    {
      id: 'garage_area',
      label: 'Garage Area (Per Car)',
      render: (prop) => {
        // Use garage_area column with category display
        if (prop.garage_area !== undefined && prop.garage_area !== null) {
          return getGarageDisplayText(prop.garage_area);
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
      label: 'Det. Garage Area (Per Car)',
      render: (prop) => {
        // Use det_garage_area column with category display
        if (prop.det_garage_area !== undefined && prop.det_garage_area !== null) {
          return getGarageDisplayText(prop.det_garage_area);
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
          return prop.deck_area > 0 ? `${prop.deck_area.toLocaleString()} SF` : 'No';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific deck codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'No';
        } else {
          return prop.asset_deck ? 'Yes' : 'No';
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
          return prop.patio_area > 0 ? `${prop.patio_area.toLocaleString()} SF` : 'No';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific patio codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'No';
        } else {
          return prop.asset_patio ? 'Yes' : 'No';
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
          return prop.open_porch_area > 0 ? `${prop.open_porch_area.toLocaleString()} SF` : 'No';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific open porch codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'No';
        } else {
          return prop.asset_open_porch ? 'Yes' : 'No';
        }
      },
      adjustmentName: 'Open Porch'
    },
    {
      id: 'enclosed_porch_area',
      label: 'Encl Porch Area',
      render: (prop) => {
        // Check if enclosed_porch_area column exists (future)
        if (prop.enclosed_porch_area !== undefined) {
          return prop.enclosed_porch_area > 0 ? `${prop.enclosed_porch_area.toLocaleString()} SF` : 'No';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['11']); // Approximate - need specific enclosed porch codes
          return area > 0 ? `${area.toLocaleString()} SF` : 'No';
        } else {
          return prop.asset_enclosed_porch ? 'Yes' : 'No';
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
          return prop.pool_area > 0 ? `${prop.pool_area.toLocaleString()} SF` : 'No';
        }
        // Fallback
        if (vendorType === 'BRT') {
          const area = getBRTItemArea(prop, ['15']); // Category 15 includes pools
          return area > 0 ? `${area.toLocaleString()} SF` : 'No';
        } else {
          return prop.asset_pool ? 'Yes' : 'No';
        }
      },
      adjustmentName: 'Pool'
    },
    {
      id: 'ext_condition',
      label: 'Ext. Condition',
      render: (prop) => {
        if (!prop.asset_ext_cond) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getExteriorConditionName(prop, codeDefinitions, vendorType);
          return name || prop.asset_ext_cond;
        }
        return prop.asset_ext_cond;
      },
      adjustmentName: 'Exterior Condition'
    },
    {
      id: 'int_condition',
      label: 'Int. Condition',
      render: (prop) => {
        if (!prop.asset_int_cond) return 'N/A';
        if (codeDefinitions) {
          const name = interpretCodes.getInteriorConditionName(prop, codeDefinitions, vendorType);
          return name || prop.asset_int_cond;
        }
        return prop.asset_int_cond;
      },
      adjustmentName: 'Interior Condition'
    }
  ];

  // Get dynamic attributes from adjustmentGrid (exclude default ones)
  const dynamicAttributes = useMemo(() => adjustmentGrid
    .filter(adj => !adj.is_default)
    .map(adj => ({
      id: adj.adjustment_id,
      label: adj.adjustment_name, // Use the ACTUAL adjustment name from grid (already title-cased)
      render: (prop) => {
        // Helper to normalize code for comparison
        const normalizeCode = (c) => String(c).trim().replace(/^0+/, '').toUpperCase() || '0';

        // Extract code from adjustment_id (e.g., "pole_barn_PBAR" -> "PBAR")
        const code = adj.adjustment_id.replace(/^(barn|pole_barn|stable|miscellaneous|land_positive|land_negative)_/, '');
        const targetCode = normalizeCode(code);

        // Check if this property has the code
        const hasCode = () => {
          if (vendorType === 'Microsystems') {
            // MICROSYSTEMS COLUMN MAPPING:
            // - Detached items (barn, pole_barn, stable) → detached_item_code1-4, detachedbuilding1-4
            // - Miscellaneous items → misc_item_1-3
            // - Land adjustments (positive/negative) → overall_adj_reason1-4

            if (adj.adjustment_id.startsWith('land_positive_') || adj.adjustment_id.startsWith('land_negative_')) {
              // Land adjustments: check overall_adj_reason1-4
              for (let i = 1; i <= 4; i++) {
                const reasonCode = prop[`overall_adj_reason${i}`];
                if (reasonCode && normalizeCode(reasonCode) === targetCode) {
                  return true;
                }
              }
            }
            else if (adj.adjustment_id.startsWith('barn_') || adj.adjustment_id.startsWith('pole_barn_') || adj.adjustment_id.startsWith('stable_')) {
              // Detached items: check detached_item_code1-4, detachedbuilding1-4
              for (let i = 1; i <= 4; i++) {
                const itemCode = prop[`detached_item_code${i}`];
                if (itemCode && normalizeCode(itemCode) === targetCode) {
                  return true;
                }
              }
              for (let i = 1; i <= 4; i++) {
                const buildingCode = prop[`detachedbuilding${i}`];
                if (buildingCode && normalizeCode(buildingCode) === targetCode) {
                  return true;
                }
              }
            }
            else if (adj.adjustment_id.startsWith('miscellaneous_')) {
              // Miscellaneous items: check misc_item_1-3 ONLY
              for (let i = 1; i <= 3; i++) {
                const miscCode = prop[`misc_item_${i}`];
                if (miscCode && normalizeCode(miscCode) === targetCode) {
                  return true;
                }
              }
            }
          } else {
            // BRT COLUMN MAPPING:
            // - Detached items (barn, pole_barn, stable) → detachedcode_1-11
            // - Miscellaneous items → misc_1_brt through misc_5_brt (with counts in miscnum_1-5)
            // - Positive Land adjustments → landffcond_1-6 + landurcond_1-6
            // - Negative Land adjustments → landffinfl_1-6 + landurinfl_1-6

            if (adj.adjustment_id.startsWith('land_positive_')) {
              // Positive land: check landffcond_1-6 and landurcond_1-6
              for (let i = 1; i <= 6; i++) {
                const ffcondCode = prop[`landffcond_${i}`];
                if (ffcondCode && normalizeCode(ffcondCode) === targetCode) {
                  return true;
                }
                const urcondCode = prop[`landurcond_${i}`];
                if (urcondCode && normalizeCode(urcondCode) === targetCode) {
                  return true;
                }
              }
            }
            else if (adj.adjustment_id.startsWith('land_negative_')) {
              // Negative land: check landffinfl_1-6 and landurinfl_1-6
              for (let i = 1; i <= 6; i++) {
                const ffinflCode = prop[`landffinfl_${i}`];
                if (ffinflCode && normalizeCode(ffinflCode) === targetCode) {
                  return true;
                }
                const urinflCode = prop[`landurinfl_${i}`];
                if (urinflCode && normalizeCode(urinflCode) === targetCode) {
                  return true;
                }
              }
            }
            else if (adj.adjustment_id.startsWith('miscellaneous_')) {
              // BRT Miscellaneous: check misc_1_brt through misc_5_brt
              for (let i = 1; i <= 5; i++) {
                const miscCode = prop[`misc_${i}_brt`];
                if (miscCode && normalizeCode(miscCode) === targetCode) {
                  return true;
                }
              }
            }
            else if (adj.adjustment_id.startsWith('barn_') || adj.adjustment_id.startsWith('pole_barn_') || adj.adjustment_id.startsWith('stable_')) {
              // BRT Detached items: check detachedcode_1-11
              for (let i = 1; i <= 11; i++) {
                const detachedCode = prop[`detachedcode_${i}`];
                if (detachedCode && normalizeCode(detachedCode) === targetCode) {
                  return true;
                }
              }
            }
          }
          return false;
        };

        // Helper to get miscellaneous count for BRT
        const getMiscCount = () => {
          if (vendorType !== 'BRT') return 0;
          for (let i = 1; i <= 5; i++) {
            const miscCode = prop[`misc_${i}_brt`];
            if (miscCode && normalizeCode(miscCode) === targetCode) {
              return parseInt(prop[`miscnum_${i}`], 10) || 1; // Default to 1 if count is missing
            }
          }
          return 0;
        };

        // Land adjustments: show YES/NONE (binary)
        if (adj.adjustment_id.startsWith('land_positive_') || adj.adjustment_id.startsWith('land_negative_')) {
          return hasCode() ? 'YES' : 'NONE';
        }

        // Miscellaneous items: show count for BRT, YES/NONE for Microsystems
        if (adj.adjustment_id.startsWith('miscellaneous_')) {
          if (vendorType === 'BRT') {
            const count = getMiscCount();
            return count > 0 ? count : 'NONE';
          }
          return hasCode() ? 'YES' : 'NONE';
        }

        // Detached items (pole barn, barn, stable): show YES/NONE if detected, with area if available
        if (adj.adjustment_id.startsWith('barn_') || adj.adjustment_id.startsWith('pole_barn_') || adj.adjustment_id.startsWith('stable_')) {
          // First check if code exists in raw columns
          if (hasCode()) {
            // Try to get area from common column mappings
            const areaColumnMap = {
              'PBAR': 'pole_barn_area',
              'BARN': 'barn_area',
              'STBL': 'stable_area',
              'SHED': 'shed_area'
            };

            const areaColumn = areaColumnMap[code.toUpperCase()];
            if (areaColumn && prop[areaColumn] !== undefined && prop[areaColumn] !== null && prop[areaColumn] > 0) {
              return `YES (${prop[areaColumn].toLocaleString()} SF)`;
            }
            return 'YES';
          }
          return 'NONE';
        }

        // Legacy: For non-coded dynamic adjustments with area columns
        const columnMap = {
          'barn': 'barn_area',
          'stable': 'stable_area',
          'pole_barn': 'pole_barn_area'
        };

        const columnName = columnMap[adj.adjustment_id];
        if (columnName && prop[columnName] !== undefined && prop[columnName] !== null) {
          return prop[columnName] > 0 ? `YES (${prop[columnName].toLocaleString()} SF)` : 'NONE';
        }

        return 'N/A';
      },
      adjustmentName: adj.adjustment_name,
      isDynamic: true
    })), [adjustmentGrid, vendorType]);

  // Combine static and dynamic attributes
  const allAttributes = useMemo(() => [...ATTRIBUTE_ORDER, ...dynamicAttributes], [dynamicAttributes]);

  // Initialize row visibility when attributes change (all checked by default)
  useEffect(() => {
    const initialVisibility = {};
    allAttributes.forEach(attr => {
      initialVisibility[attr.id] = true;
    });
    // Also add net_adjustment and adjusted_valuation
    initialVisibility['net_adjustment'] = true;
    initialVisibility['adjusted_valuation'] = true;
    setRowVisibility(initialVisibility);
  }, [allAttributes]);

  // Toggle row visibility
  const toggleRowVisibility = useCallback((attrId) => {
    setRowVisibility(prev => ({
      ...prev,
      [attrId]: !prev[attrId]
    }));
  }, []);

  // ==================== PDF EXPORT FUNCTIONS ====================

  // Get cell value with optional edits applied
  const getCellValue = useCallback((attrId, colIdx, defaultValue) => {
    const editKey = `${attrId}_${colIdx}`;
    return editableData[editKey] !== undefined ? editableData[editKey] : defaultValue;
  }, [editableData]);

  // Update editable data in modal
  const updateEditableData = useCallback((attrId, colIdx, value) => {
    setEditableData(prev => ({
      ...prev,
      [`${attrId}_${colIdx}`]: value
    }));
  }, []);

  // Reset modal state when opening
  const openExportModal = useCallback(() => {
    setEditableData({});
    setShowExportModal(true);
  }, []);

  // Generate PDF document
  const generatePDF = useCallback(() => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 30;

    // Lojik blue color
    const lojikBlue = [0, 102, 204];

    // Try to load logo (if exists in public folder)
    const addHeader = (blockLot) => {
      // Logo placeholder - would need actual logo file
      doc.setFillColor(...lojikBlue);
      doc.rect(margin, margin, 60, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('LOJIK', margin + 8, margin + 20);
      
      // Block/Lot in top right
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(blockLot, pageWidth - margin, margin + 20, { align: 'right' });
    };

    const subjectBlockLot = `${subject.property_block}/${subject.property_lot}${subject.property_qualifier ? '/' + subject.property_qualifier : ''}`;
    addHeader(subjectBlockLot);

    // Prepare table data
    const visibleAttributes = allAttributes.filter(attr => rowVisibility[attr.id]);
    const headers = [['VCS', 'Subject', 'Comparable 1', 'Comparable 2', 'Comparable 3', 'Comparable 4', 'Comparable 5']];

    // Separate static and dynamic attributes
    const staticAttrs = visibleAttributes.filter(a => !a.isDynamic);
    const dynamicAttrs = visibleAttributes.filter(a => a.isDynamic);

    // Build rows for static attributes (Page 1)
    const staticRows = staticAttrs.map(attr => {
      const row = [attr.label];
      
      // Subject column
      let subjectVal = attr.render(subject);
      subjectVal = getCellValue(attr.id, 'subject', subjectVal);
      row.push(String(subjectVal));

      // Comp columns
      for (let i = 0; i < 5; i++) {
        const comp = comps[i];
        if (comp) {
          let compVal = attr.render(comp);
          compVal = getCellValue(attr.id, i, compVal);
          const adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
          
          if (showAdjustments && adj && adj.amount !== 0) {
            const adjStr = adj.amount > 0 ? `+$${Math.round(adj.amount).toLocaleString()}` : `-$${Math.abs(Math.round(adj.amount)).toLocaleString()}`;
            row.push(`${compVal}\n${adjStr}`);
          } else {
            row.push(String(compVal));
          }
        } else {
          row.push('-');
        }
      }
      return row;
    });

    // Add Net Adjustment row if visible and showing adjustments
    if (showAdjustments && rowVisibility['net_adjustment']) {
      const netRow = ['Net Adjustment', '-'];
      for (let i = 0; i < 5; i++) {
        const comp = comps[i];
        if (comp) {
          const total = comp.totalAdjustment || 0;
          const pct = comp.adjustmentPercent || 0;
          const sign = total > 0 ? '+' : '';
          netRow.push(`${sign}$${Math.round(total).toLocaleString()} (${sign}${pct.toFixed(0)}%)`);
        } else {
          netRow.push('-');
        }
      }
      staticRows.push(netRow);
    }

    // Add Adjusted Valuation row if visible and showing adjustments
    if (showAdjustments && rowVisibility['adjusted_valuation']) {
      const valRow = ['Adjusted Valuation'];
      // Subject gets projected assessment
      valRow.push(result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-');
      for (let i = 0; i < 5; i++) {
        const comp = comps[i];
        if (comp) {
          valRow.push(`$${Math.round(comp.adjustedPrice || 0).toLocaleString()}`);
        } else {
          valRow.push('-');
        }
      }
      staticRows.push(valRow);
    }

    // Generate main table
    doc.autoTable({
      head: headers,
      body: staticRows,
      startY: margin + 50,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 7,
        cellPadding: 3,
        lineColor: [200, 200, 200],
        lineWidth: 0.5,
        valign: 'middle'
      },
      headStyles: {
        fillColor: lojikBlue,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 80 },
        1: { fillColor: [255, 255, 230], halign: 'center' },
        2: { fillColor: [230, 242, 255], halign: 'center' },
        3: { fillColor: [230, 242, 255], halign: 'center' },
        4: { fillColor: [230, 242, 255], halign: 'center' },
        5: { fillColor: [230, 242, 255], halign: 'center' },
        6: { fillColor: [230, 242, 255], halign: 'center' }
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250]
      },
      didParseCell: function(data) {
        // Style Net Adjustment row
        if (data.row.raw && data.row.raw[0] === 'Net Adjustment') {
          data.cell.styles.fillColor = [240, 240, 240];
          data.cell.styles.fontStyle = 'bold';
        }
        // Style Adjusted Valuation row
        if (data.row.raw && data.row.raw[0] === 'Adjusted Valuation') {
          data.cell.styles.fillColor = [200, 230, 255];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    // Page 2: Dynamic adjustments (if any exist and are visible)
    if (dynamicAttrs.length > 0) {
      doc.addPage();
      addHeader(subjectBlockLot);

      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text('Dynamic Adjustments', margin, margin + 55);

      // Build dynamic rows
      const dynamicRows = dynamicAttrs.map(attr => {
        const row = [attr.label];
        
        // Subject column
        let subjectVal = attr.render(subject);
        row.push(String(subjectVal));

        // Comp columns
        for (let i = 0; i < 5; i++) {
          const comp = comps[i];
          if (comp) {
            let compVal = attr.render(comp);
            const adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
            
            if (showAdjustments && adj && adj.amount !== 0) {
              const adjStr = adj.amount > 0 ? `+$${Math.round(adj.amount).toLocaleString()}` : `-$${Math.abs(Math.round(adj.amount)).toLocaleString()}`;
              row.push(`${compVal}\n${adjStr}`);
            } else {
              row.push(String(compVal));
            }
          } else {
            row.push('-');
          }
        }
        return row;
      });

      // Add Net Adjustment and Valuation rows to page 2 as well
      if (showAdjustments && rowVisibility['net_adjustment']) {
        const netRow = ['Net Adjustment', '-'];
        for (let i = 0; i < 5; i++) {
          const comp = comps[i];
          if (comp) {
            const total = comp.totalAdjustment || 0;
            const pct = comp.adjustmentPercent || 0;
            const sign = total > 0 ? '+' : '';
            netRow.push(`${sign}$${Math.round(total).toLocaleString()} (${sign}${pct.toFixed(0)}%)`);
          } else {
            netRow.push('-');
          }
        }
        dynamicRows.push(netRow);
      }

      if (showAdjustments && rowVisibility['adjusted_valuation']) {
        const valRow = ['Adjusted Valuation'];
        valRow.push(result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-');
        for (let i = 0; i < 5; i++) {
          const comp = comps[i];
          if (comp) {
            valRow.push(`$${Math.round(comp.adjustedPrice || 0).toLocaleString()}`);
          } else {
            valRow.push('-');
          }
        }
        dynamicRows.push(valRow);
      }

      doc.autoTable({
        head: headers,
        body: dynamicRows,
        startY: margin + 65,
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 7,
          cellPadding: 3,
          lineColor: [200, 200, 200],
          lineWidth: 0.5,
          valign: 'middle'
        },
        headStyles: {
          fillColor: lojikBlue,
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center'
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 80 },
          1: { fillColor: [255, 255, 230], halign: 'center' },
          2: { fillColor: [230, 242, 255], halign: 'center' },
          3: { fillColor: [230, 242, 255], halign: 'center' },
          4: { fillColor: [230, 242, 255], halign: 'center' },
          5: { fillColor: [230, 242, 255], halign: 'center' },
          6: { fillColor: [230, 242, 255], halign: 'center' }
        },
        didParseCell: function(data) {
          if (data.row.raw && data.row.raw[0] === 'Net Adjustment') {
            data.cell.styles.fillColor = [240, 240, 240];
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.row.raw && data.row.raw[0] === 'Adjusted Valuation') {
            data.cell.styles.fillColor = [200, 230, 255];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });
    }

    // Save the PDF
    const fileName = `DetailedEvaluation_${subject.property_block}_${subject.property_lot}.pdf`;
    doc.save(fileName);
    setShowExportModal(false);
  }, [allAttributes, rowVisibility, showAdjustments, subject, comps, result, getCellValue, getAdjustment]);

  return (
    <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
      <div className="bg-blue-600 px-4 py-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-white">Detailed Evaluation</h4>
          <div className="flex items-center gap-4">
            <div className="text-sm text-blue-100">
              <span className="font-medium">Adjustment Bracket:</span>{' '}
              <span className="font-semibold text-white">{getBracketLabel()}</span>
            </div>
            <button
              onClick={openExportModal}
              className="flex items-center gap-2 px-3 py-1.5 bg-white text-blue-600 rounded text-sm font-medium hover:bg-blue-50 transition-colors"
            >
              <FileDown size={16} />
              Export PDF
            </button>
          </div>
        </div>
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
                  <input 
                    type="checkbox" 
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={rowVisibility[attr.id] ?? true}
                    onChange={() => toggleRowVisibility(attr.id)}
                  />
                </td>
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900 border-r-2 border-gray-300">
                  {attr.label}
                  {attr.isDynamic && (
                    <span className="ml-2 text-xs text-purple-600">(Custom)</span>
                  )}
                </td>
                <td className={`px-3 py-2 text-center bg-yellow-50 ${attr.bold ? 'font-semibold' : 'text-xs'}`}>
                  {(() => {
                    let value = attr.render(subject);

                    // ONLY apply YES/NONE to specific amenity area attributes
                    // Exclude garage_area and det_garage_area as they use category display (ONE CAR, TWO CAR, etc.)
                    const amenityAreaIds = [
                      'deck_area', 'patio_area',
                      'open_porch_area', 'enclosed_porch_area', 'pool_area',
                      'basement_area', 'fin_bsmt_area', 'ac_area'
                    ];

                    if (amenityAreaIds.includes(attr.id)) {
                      let rawPropertyValue = null;

                      switch(attr.id) {
                        case 'garage_area': rawPropertyValue = subject.garage_area; break;
                        case 'det_garage_area': rawPropertyValue = subject.det_garage_area; break;
                        case 'deck_area': rawPropertyValue = subject.deck_area; break;
                        case 'patio_area': rawPropertyValue = subject.patio_area; break;
                        case 'open_porch_area': rawPropertyValue = subject.open_porch_area; break;
                        case 'enclosed_porch_area': rawPropertyValue = subject.enclosed_porch_area; break;
                        case 'pool_area': rawPropertyValue = subject.pool_area; break;
                        case 'basement_area': rawPropertyValue = subject.basement_area; break;
                        case 'fin_bsmt_area': rawPropertyValue = subject.fin_basement_area; break;
                        case 'ac_area': rawPropertyValue = subject.ac_area; break;
                        default: break;
                      }

                      const hasValue = rawPropertyValue !== null &&
                                      rawPropertyValue !== undefined &&
                                      rawPropertyValue > 0;

                      value = hasValue ? 'Yes' : 'No';
                    }

                    return value;
                  })()}
                </td>
                {renderCompCells((comp, idx) => {
                  let value = attr.render(comp);
                  const adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;

                  // ONLY apply YES/NONE to specific amenity area attributes
                  // Exclude: lot sizes, year built, count fields (bathrooms, bedrooms, fireplaces)
                  // Exclude garage_area and det_garage_area as they use category display (ONE CAR, TWO CAR, etc.)
                  const amenityAreaIds = [
                    'deck_area', 'patio_area',
                    'open_porch_area', 'enclosed_porch_area', 'pool_area',
                    'basement_area', 'fin_bsmt_area', 'ac_area'
                  ];

                  if (amenityAreaIds.includes(attr.id)) {
                    // Get raw property value based on attribute id
                    let rawPropertyValue = null;

                    switch(attr.id) {
                      case 'garage_area':
                        rawPropertyValue = comp.garage_area;
                        break;
                      case 'det_garage_area':
                        rawPropertyValue = comp.det_garage_area;
                        break;
                      case 'deck_area':
                        rawPropertyValue = comp.deck_area;
                        break;
                      case 'patio_area':
                        rawPropertyValue = comp.patio_area;
                        break;
                      case 'open_porch_area':
                        rawPropertyValue = comp.open_porch_area;
                        break;
                      case 'enclosed_porch_area':
                        rawPropertyValue = comp.enclosed_porch_area;
                        break;
                      case 'pool_area':
                        rawPropertyValue = comp.pool_area;
                        break;
                      case 'basement_area':
                        rawPropertyValue = comp.basement_area;
                        break;
                      case 'fin_bsmt_area':
                        rawPropertyValue = comp.fin_basement_area;
                        break;
                      case 'ac_area':
                        rawPropertyValue = comp.ac_area;
                        break;
                      default:
                        break;
                    }

                    // Check if has value
                    const hasValue = rawPropertyValue !== null &&
                                    rawPropertyValue !== undefined &&
                                    rawPropertyValue > 0;

                    value = hasValue ? 'Yes' : 'No';
                  }

                  return (
                    <div>
                      <div className={attr.bold ? 'font-semibold' : 'text-xs'}>{value}</div>
                      {adj && adj.amount !== 0 && (
                        <div className={`text-xs font-bold mt-1 ${adj.amount > 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {adj.amount > 0 ? '+' : ''}${Math.round(adj.amount).toLocaleString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </tr>
            ))}

            {/* Net Adjustment */}
            <tr className="border-b-2 border-gray-400 bg-gray-50">
              <td className="px-2 py-2">
                <input 
                  type="checkbox" 
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={rowVisibility['net_adjustment'] ?? true}
                  onChange={() => toggleRowVisibility('net_adjustment')}
                />
              </td>
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-3 font-bold text-gray-900 border-r-2 border-gray-300">
                Net Adjustment
              </td>
              <td className="px-3 py-3 text-center bg-yellow-50">-</td>
              {renderCompCells((comp) => (
                <div className={`font-bold ${comp.totalAdjustment > 0 ? 'text-green-700' : comp.totalAdjustment < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                  {comp.totalAdjustment > 0 ? '+' : ''}${Math.round(comp.totalAdjustment || 0).toLocaleString()}
                  <div className="text-xs mt-1">
                    ({comp.adjustmentPercent > 0 ? '+' : ''}{comp.adjustmentPercent?.toFixed(0) || '0'}%)
                  </div>
                </div>
              ))}
            </tr>

            {/* Adjusted Valuation */}
            <tr className="border-b-4 border-gray-400 bg-blue-50">
              <td className="px-2 py-2">
                <input 
                  type="checkbox" 
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={rowVisibility['adjusted_valuation'] ?? true}
                  onChange={() => toggleRowVisibility('adjusted_valuation')}
                />
              </td>
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

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Printer className="text-white" size={24} />
                <h3 className="text-lg font-semibold text-white">Export Detailed Evaluation</h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-white hover:text-blue-200 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* Modal Options */}
            <div className="px-6 py-4 bg-gray-50 border-b flex items-center justify-between">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAdjustments}
                    onChange={(e) => setShowAdjustments(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Show Adjustments & Valuation</span>
                </label>
                <div className="text-sm text-gray-500">
                  {showAdjustments ? (
                    <span className="flex items-center gap-1"><Eye size={14} /> Full evaluation with adjustments</span>
                  ) : (
                    <span className="flex items-center gap-1"><EyeOff size={14} /> Comps only (no adjustments)</span>
                  )}
                </div>
              </div>
              <div className="text-sm text-gray-600">
                <span className="font-medium">{Object.values(rowVisibility).filter(Boolean).length}</span> rows selected for export
              </div>
            </div>

            {/* Modal Content - Preview Table */}
            <div className="flex-1 overflow-auto p-6">
              <div className="border rounded-lg overflow-hidden">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-blue-600 text-white">
                      <th className="px-2 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={Object.values(rowVisibility).every(Boolean)}
                          onChange={(e) => {
                            const newVisibility = {};
                            Object.keys(rowVisibility).forEach(key => {
                              newVisibility[key] = e.target.checked;
                            });
                            setRowVisibility(newVisibility);
                          }}
                          className="rounded border-white text-blue-600"
                        />
                      </th>
                      <th className="px-3 py-2 text-left font-semibold">VCS</th>
                      <th className="px-3 py-2 text-center font-semibold bg-yellow-600">Subject</th>
                      {[1, 2, 3, 4, 5].map(n => (
                        <th key={n} className="px-3 py-2 text-center font-semibold">Comp {n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {allAttributes.map(attr => (
                      <tr key={attr.id} className={`border-b ${!rowVisibility[attr.id] ? 'opacity-40 bg-gray-100' : ''}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={rowVisibility[attr.id] ?? true}
                            onChange={() => toggleRowVisibility(attr.id)}
                            className="rounded border-gray-300 text-blue-600"
                          />
                        </td>
                        <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                          {attr.label}
                          {attr.isDynamic && <span className="ml-1 text-purple-500 text-xs">(Dyn)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center bg-yellow-50">
                          <input
                            type="text"
                            className="w-full text-center text-xs border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded"
                            defaultValue={attr.render(subject)}
                            onChange={(e) => updateEditableData(attr.id, 'subject', e.target.value)}
                          />
                        </td>
                        {[0, 1, 2, 3, 4].map(i => {
                          const comp = comps[i];
                          return (
                            <td key={i} className="px-3 py-1.5 text-center bg-blue-50">
                              {comp ? (
                                <input
                                  type="text"
                                  className="w-full text-center text-xs border-0 bg-transparent focus:ring-1 focus:ring-blue-500 rounded"
                                  defaultValue={attr.render(comp)}
                                  onChange={(e) => updateEditableData(attr.id, i, e.target.value)}
                                />
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                    {/* Net Adjustment Row */}
                    {showAdjustments && (
                      <tr className={`border-b bg-gray-100 ${!rowVisibility['net_adjustment'] ? 'opacity-40' : ''}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={rowVisibility['net_adjustment'] ?? true}
                            onChange={() => toggleRowVisibility('net_adjustment')}
                            className="rounded border-gray-300 text-blue-600"
                          />
                        </td>
                        <td className="px-3 py-1.5 font-bold">Net Adjustment</td>
                        <td className="px-3 py-1.5 text-center bg-yellow-50">-</td>
                        {[0, 1, 2, 3, 4].map(i => {
                          const comp = comps[i];
                          if (!comp) return <td key={i} className="px-3 py-1.5 text-center bg-blue-50 text-gray-400">-</td>;
                          const total = comp.totalAdjustment || 0;
                          const pct = comp.adjustmentPercent || 0;
                          return (
                            <td key={i} className={`px-3 py-1.5 text-center font-bold ${total > 0 ? 'text-green-700' : total < 0 ? 'text-red-700' : ''}`}>
                              {total > 0 ? '+' : ''}${Math.round(total).toLocaleString()} ({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)
                            </td>
                          );
                        })}
                      </tr>
                    )}

                    {/* Adjusted Valuation Row */}
                    {showAdjustments && (
                      <tr className={`border-b-2 bg-blue-100 ${!rowVisibility['adjusted_valuation'] ? 'opacity-40' : ''}`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={rowVisibility['adjusted_valuation'] ?? true}
                            onChange={() => toggleRowVisibility('adjusted_valuation')}
                            className="rounded border-gray-300 text-blue-600"
                          />
                        </td>
                        <td className="px-3 py-1.5 font-bold">Adjusted Valuation</td>
                        <td className="px-3 py-1.5 text-center bg-yellow-100 font-bold text-green-700">
                          {result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-'}
                        </td>
                        {[0, 1, 2, 3, 4].map(i => {
                          const comp = comps[i];
                          return (
                            <td key={i} className="px-3 py-1.5 text-center font-bold">
                              {comp ? `$${Math.round(comp.adjustedPrice || 0).toLocaleString()}` : '-'}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 text-sm text-gray-500">
                <p>Edit any cell above to customize the exported PDF. Uncheck rows to exclude them from the export.</p>
                {dynamicAttributes.length > 0 && (
                  <p className="mt-1 text-purple-600">Dynamic adjustments will appear on page 2 of the PDF.</p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t flex items-center justify-end gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={generatePDF}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <FileDown size={18} />
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DetailedAppraisalGrid;
