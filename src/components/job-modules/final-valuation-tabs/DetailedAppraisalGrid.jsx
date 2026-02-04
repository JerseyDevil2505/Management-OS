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

  // Editable data for export modal - stores property overrides
  // Structure: { subject: {...propertyOverrides}, comp_0: {...}, comp_1: {...}, etc. }
  const [editableProperties, setEditableProperties] = useState({});

  // Calculated adjustments based on edited values
  const [editedAdjustments, setEditedAdjustments] = useState({});

  // Define which attributes are editable and their input types
  const EDITABLE_CONFIG = {
    // Numeric inputs
    lot_size_sf: { type: 'number', field: 'asset_lot_sf', altField: 'market_manual_lot_sf' },
    sales_date: { type: 'date', field: 'sales_date' },
    lot_size_ff: { type: 'number', field: 'asset_lot_ff', altField: 'market_manual_lot_ff' },
    lot_size_acre: { type: 'number', field: 'asset_lot_acre', altField: 'market_manual_lot_acre', step: 0.01 },
    liveable_area: { type: 'number', field: 'asset_sfla' },
    year_built: { type: 'number', field: 'asset_year_built' },
    bathrooms: { type: 'number', field: 'asset_bathrooms', step: 0.5 },
    bedrooms: { type: 'number', field: 'asset_bedrooms' },
    fireplaces: { type: 'number', field: 'asset_fireplaces' },
    sales_price: { type: 'number', field: 'sales_price' },
    // Yes/No dropdowns
    basement_area: { type: 'yesno', field: 'asset_basement' },
    fin_bsmt_area: { type: 'yesno', field: 'asset_fin_basement' },
    ac_area: { type: 'yesno', field: 'asset_ac' },
    deck_area: { type: 'yesno', field: 'asset_deck' },
    patio_area: { type: 'yesno', field: 'asset_patio' },
    open_porch_area: { type: 'yesno', field: 'asset_open_porch' },
    enclosed_porch_area: { type: 'yesno', field: 'asset_enclosed_porch' },
    pool_area: { type: 'yesno', field: 'asset_pool' },
    // Garage dropdown
    garage_area: { type: 'garage', field: 'garage_area' },
    det_garage_area: { type: 'garage', field: 'det_garage_area' },
    // Condition dropdown
    ext_condition: { type: 'condition', field: 'asset_ext_cond' },
    int_condition: { type: 'condition', field: 'asset_int_cond' }
  };

  // Garage options
  const GARAGE_OPTIONS = [
    { value: 0, label: 'None' },
    { value: 1, label: 'One Car' },
    { value: 2, label: 'Two Car' },
    { value: 3, label: 'Three Car' },
    { value: 4, label: 'Multi Car' }
  ];

  // Condition options (will be populated from code definitions)
  const getConditionOptions = useCallback(() => {
    // Try to get from code definitions
    if (codeDefinitions?.field_codes) {
      const extCondCodes = codeDefinitions.field_codes['260'] || codeDefinitions.field_codes['exterior_condition'] || {};
      const options = Object.entries(extCondCodes).map(([code, data]) => ({
        value: code,
        label: data.description || code
      }));
      if (options.length > 0) return options;
    }
    // Fallback standard options
    return [
      { value: 'E', label: 'Excellent' },
      { value: 'G', label: 'Good' },
      { value: 'A', label: 'Average' },
      { value: 'F', label: 'Fair' },
      { value: 'P', label: 'Poor' }
    ];
  }, [codeDefinitions]);

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
      label: 'Lot Size (Square Foot)',
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

  // Generate a storage key based on job data to persist visibility per job
  const storageKey = useMemo(() => {
    const jobId = jobData?.id || 'default';
    return `detailedGrid_rowVisibility_${jobId}`;
  }, [jobData?.id]);

  // Initialize row visibility - load from localStorage or default to all checked
  useEffect(() => {
    // Try to load from localStorage first
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with any new attributes that might not be in saved state
        const merged = { ...parsed };
        allAttributes.forEach(attr => {
          if (merged[attr.id] === undefined) {
            merged[attr.id] = true;
          }
        });
        if (merged['net_adjustment'] === undefined) merged['net_adjustment'] = true;
        if (merged['adjusted_valuation'] === undefined) merged['adjusted_valuation'] = true;
        setRowVisibility(merged);
        return;
      } catch (e) {
        console.warn('Failed to parse saved row visibility:', e);
      }
    }

    // Default: all checked
    const initialVisibility = {};
    allAttributes.forEach(attr => {
      initialVisibility[attr.id] = true;
    });
    initialVisibility['net_adjustment'] = true;
    initialVisibility['adjusted_valuation'] = true;
    setRowVisibility(initialVisibility);
  }, [allAttributes, storageKey]);

  // Save row visibility to localStorage when it changes
  useEffect(() => {
    if (Object.keys(rowVisibility).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(rowVisibility));
    }
  }, [rowVisibility, storageKey]);

  // Toggle row visibility
  const toggleRowVisibility = useCallback((attrId) => {
    setRowVisibility(prev => ({
      ...prev,
      [attrId]: !prev[attrId]
    }));
  }, []);

  // ==================== PDF EXPORT FUNCTIONS ====================

  // Get raw value from property for a given attribute
  const getRawValue = useCallback((prop, attrId) => {
    if (!prop) return null;
    const config = EDITABLE_CONFIG[attrId];
    if (!config) return null;
    return prop[config.field];
  }, []);

  // Get edited value or fall back to original
  const getEditedValue = useCallback((propKey, attrId) => {
    const edited = editableProperties[propKey];
    if (edited && edited[attrId] !== undefined) {
      return edited[attrId];
    }
    // Get original value
    const prop = propKey === 'subject' ? subject : comps[parseInt(propKey.replace('comp_', ''))];
    return getRawValue(prop, attrId);
  }, [editableProperties, subject, comps, getRawValue]);

  // Update a single cell value
  const updateEditedValue = useCallback((propKey, attrId, value) => {
    setEditableProperties(prev => ({
      ...prev,
      [propKey]: {
        ...(prev[propKey] || {}),
        [attrId]: value
      }
    }));
  }, []);

  // Calculate adjustment for a single attribute between subject and comp
  const calculateSingleAdjustment = useCallback((subjectVal, compVal, adjustmentDef, compSalesPrice) => {
    if (!adjustmentDef) return 0;

    const adjustmentValue = adjustmentDef.bracket_0 || 0; // Use first bracket as default
    const adjustmentType = adjustmentDef.adjustment_type || 'flat';

    const subjectNum = parseFloat(subjectVal) || 0;
    const compNum = parseFloat(compVal) || 0;
    const difference = subjectNum - compNum;

    if (difference === 0) return 0;

    switch (adjustmentType) {
      case 'flat':
        return difference > 0 ? adjustmentValue : -adjustmentValue;
      case 'per_sqft':
        return difference * adjustmentValue;
      case 'count':
        return difference * adjustmentValue;
      case 'percent':
        return (compSalesPrice || 0) * (adjustmentValue / 100) * Math.sign(difference);
      default:
        return 0;
    }
  }, []);

  // Recalculate all adjustments based on edited values
  const recalculateAdjustments = useCallback(() => {
    const newAdjustments = {};

    comps.forEach((comp, idx) => {
      if (!comp) return;

      const compKey = `comp_${idx}`;
      const compAdjustments = [];
      let totalAdjustment = 0;

      // Get comp's sales price (edited or original)
      const compSalesPrice = getEditedValue(compKey, 'sales_price') || comp.values_norm_time || comp.sales_price || 0;

      // Calculate adjustments for each adjustable attribute
      Object.keys(EDITABLE_CONFIG).forEach(attrId => {
        const config = EDITABLE_CONFIG[attrId];
        if (!config) return;

        // Find the adjustment definition
        const attrObj = allAttributes.find(a => a.id === attrId);
        if (!attrObj?.adjustmentName) return;

        const adjustmentDef = adjustmentGrid.find(adj =>
          adj.adjustment_name?.toLowerCase() === attrObj.adjustmentName?.toLowerCase()
        );
        if (!adjustmentDef) return;

        // Get subject and comp values (edited or original)
        let subjectVal = getEditedValue('subject', attrId);
        let compVal = getEditedValue(compKey, attrId);

        // Convert Yes/No to 1/0 for flat adjustments
        if (config.type === 'yesno') {
          subjectVal = (subjectVal === true || subjectVal === 'Yes' || subjectVal === 1) ? 1 : 0;
          compVal = (compVal === true || compVal === 'Yes' || compVal === 1) ? 1 : 0;
        }

        // Convert garage category to number
        if (config.type === 'garage') {
          subjectVal = parseInt(subjectVal) || 0;
          compVal = parseInt(compVal) || 0;
        }

        const adjustment = calculateSingleAdjustment(subjectVal, compVal, adjustmentDef, compSalesPrice);
        if (adjustment !== 0) {
          compAdjustments.push({
            name: attrObj.adjustmentName,
            amount: adjustment
          });
          totalAdjustment += adjustment;
        }
      });

      const adjustedPrice = compSalesPrice + totalAdjustment;
      const adjustmentPercent = compSalesPrice > 0 ? (totalAdjustment / compSalesPrice) * 100 : 0;

      newAdjustments[compKey] = {
        adjustments: compAdjustments,
        totalAdjustment,
        adjustedPrice,
        adjustmentPercent
      };
    });

    setEditedAdjustments(newAdjustments);
  }, [comps, getEditedValue, calculateSingleAdjustment, allAttributes, adjustmentGrid]);

  // Recalculate when edited properties change
  useEffect(() => {
    if (showExportModal && Object.keys(editableProperties).length > 0) {
      recalculateAdjustments();
    }
  }, [editableProperties, showExportModal, recalculateAdjustments]);

  // Initialize editable properties from actual data when modal opens
  const openExportModal = useCallback(() => {
    // Initialize with current property values
    const initialData = { subject: {} };

    Object.keys(EDITABLE_CONFIG).forEach(attrId => {
      const config = EDITABLE_CONFIG[attrId];
      if (config.type === 'yesno') {
        initialData.subject[attrId] = subject[config.field] ? 'Yes' : 'No';
      } else if (config.type === 'garage') {
        initialData.subject[attrId] = getGarageCategory(subject[config.field] || 0);
      } else {
        initialData.subject[attrId] = subject[config.field];
      }
    });

    comps.forEach((comp, idx) => {
      if (!comp) return;
      const compKey = `comp_${idx}`;
      initialData[compKey] = {};

      Object.keys(EDITABLE_CONFIG).forEach(attrId => {
        const config = EDITABLE_CONFIG[attrId];
        if (config.type === 'yesno') {
          initialData[compKey][attrId] = comp[config.field] ? 'Yes' : 'No';
        } else if (config.type === 'garage') {
          initialData[compKey][attrId] = getGarageCategory(comp[config.field] || 0);
        } else {
          initialData[compKey][attrId] = comp[config.field];
        }
      });
    });

    setEditableProperties(initialData);
    setEditedAdjustments({});
    setShowExportModal(true);
  }, [subject, comps, getGarageCategory]);

  // Generate PDF document
  const generatePDF = useCallback(async () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 30;

    // Lojik blue color
    const lojikBlue = [0, 102, 204];

    // Load logo image
    let logoImage = null;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = '/lojik-logo.PNG';
      });
      logoImage = img;
    } catch (e) {
      console.warn('Could not load logo image:', e);
    }

    // Add header with logo
    const addHeader = (blockLot) => {
      if (logoImage) {
        // Calculate aspect ratio to fit logo nicely
        const logoHeight = 35;
        const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
        doc.addImage(logoImage, 'PNG', margin, margin - 5, logoWidth, logoHeight);
      } else {
        // Fallback text if logo not loaded
        doc.setFillColor(...lojikBlue);
        doc.rect(margin, margin, 60, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('LOJIK', margin + 8, margin + 20);
      }

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

    // Helper to get display value for PDF (uses edited values)
    const getDisplayValue = (attr, propKey) => {
      const config = EDITABLE_CONFIG[attr.id];
      const editedVal = editableProperties[propKey]?.[attr.id];

      if (editedVal !== undefined) {
        // Format edited value for display
        if (config?.type === 'garage') {
          return GARAGE_OPTIONS.find(o => o.value === editedVal)?.label || 'None';
        }
        if (config?.type === 'yesno') {
          return editedVal;
        }
        if (config?.type === 'number' && attr.id === 'sales_price') {
          return editedVal ? `$${parseFloat(editedVal).toLocaleString()}` : 'N/A';
        }
        return editedVal?.toLocaleString?.() || String(editedVal);
      }

      // Fall back to original render
      const prop = propKey === 'subject' ? subject : comps[parseInt(propKey.replace('comp_', ''))];
      return prop ? attr.render(prop) : 'N/A';
    };

    // Build rows for static attributes (Page 1)
    const staticRows = staticAttrs.map(attr => {
      const row = [attr.label];

      // Subject column - use edited value if available
      const subjectVal = getDisplayValue(attr, 'subject');
      row.push(String(subjectVal));

      // Comp columns
      for (let i = 0; i < 5; i++) {
        const comp = comps[i];
        const compKey = `comp_${i}`;
        if (comp) {
          const compVal = getDisplayValue(attr, compKey);

          // Get adjustment from edited adjustments or original
          const editedAdj = editedAdjustments[compKey]?.adjustments?.find(a =>
            a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
          );
          const origAdj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
          const adj = editedAdj || origAdj;

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
        const compKey = `comp_${i}`;
        if (comp) {
          // Use edited adjustments if available, otherwise original
          const compData = editedAdjustments[compKey] || comp;
          const total = compData.totalAdjustment || 0;
          const pct = compData.adjustmentPercent || 0;
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
        const compKey = `comp_${i}`;
        if (comp) {
          // Use edited adjustments if available, otherwise original
          const compData = editedAdjustments[compKey] || comp;
          valRow.push(`$${Math.round(compData.adjustedPrice || 0).toLocaleString()}`);
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
        const subjectVal = attr.render(subject);
        row.push(String(subjectVal));

        // Comp columns
        for (let i = 0; i < 5; i++) {
          const comp = comps[i];
          const compKey = `comp_${i}`;
          if (comp) {
            const compVal = attr.render(comp);

            // Get adjustment from edited adjustments or original
            const editedAdj = editedAdjustments[compKey]?.adjustments?.find(a =>
              a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
            );
            const origAdj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
            const adj = editedAdj || origAdj;

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
          const compKey = `comp_${i}`;
          if (comp) {
            const compData = editedAdjustments[compKey] || comp;
            const total = compData.totalAdjustment || 0;
            const pct = compData.adjustmentPercent || 0;
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
          const compKey = `comp_${i}`;
          if (comp) {
            const compData = editedAdjustments[compKey] || comp;
            valRow.push(`$${Math.round(compData.adjustedPrice || 0).toLocaleString()}`);
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
  }, [allAttributes, rowVisibility, showAdjustments, subject, comps, result, editableProperties, editedAdjustments, getAdjustment, GARAGE_OPTIONS]);

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
              <th className="px-3 py-3 text-center font-semibold bg-slate-100">
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
                <td className={`px-3 py-2 text-center bg-slate-50 ${attr.bold ? 'font-semibold' : 'text-xs'}`}>
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
              <td className="px-3 py-3 text-center bg-slate-100">-</td>
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
              <td className="px-3 py-4 text-center bg-slate-100">
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

      {/* Export Modal - Editable Grid */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-2">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-7xl flex flex-col" style={{ maxHeight: 'calc(100vh - 40px)' }}>
            {/* Modal Header */}
            <div className="bg-blue-600 px-4 py-3 flex items-center justify-between rounded-t-lg flex-shrink-0">
              <div className="flex items-center gap-3">
                <Printer className="text-white" size={20} />
                <h3 className="text-base font-semibold text-white">Export PDF - Edit Values</h3>
              </div>
              <div className="flex items-center gap-4">
                {/* Hide Adjustments Toggle */}
                <label className="flex items-center gap-2 cursor-pointer text-white text-sm">
                  <input
                    type="checkbox"
                    checked={!showAdjustments}
                    onChange={(e) => setShowAdjustments(!e.target.checked)}
                    className="rounded border-white text-blue-600"
                  />
                  <span className="flex items-center gap-1">
                    {showAdjustments ? <Eye size={14} /> : <EyeOff size={14} />}
                    Hide Adjustments
                  </span>
                </label>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-white hover:text-blue-200 transition-colors p-1"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content - Editable Grid */}
            <div className="flex-1 overflow-auto p-2">
              <table className="min-w-full text-xs border-collapse border border-gray-300">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-blue-600 text-white">
                    <th className="px-2 py-2 text-left font-semibold border-r border-blue-500 w-40">Attribute</th>
                    <th className="px-2 py-2 text-center font-semibold bg-slate-600 border-r border-slate-500 w-28">Subject</th>
                    {[0, 1, 2, 3, 4].map(idx => (
                      <th key={idx} className="px-2 py-2 text-center font-semibold border-r border-blue-500 w-28">
                        Comp {idx + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allAttributes.filter(attr => rowVisibility[attr.id] !== false).map(attr => {
                    const config = EDITABLE_CONFIG[attr.id];
                    const isEditable = !!config;

                    // Render cell for a property
                    const renderCell = (propKey, bgClass) => {
                      const prop = propKey === 'subject' ? subject : comps[parseInt(propKey.replace('comp_', ''))];
                      if (!prop && propKey !== 'subject') {
                        return <td key={propKey} className={`px-2 py-1 text-center ${bgClass} border-r border-gray-200 text-gray-400`}>-</td>;
                      }

                      const editedVal = editableProperties[propKey]?.[attr.id];
                      const displayVal = editedVal !== undefined ? editedVal : attr.render(prop);

                      // Get adjustment for this comp (if applicable)
                      const compAdj = propKey.startsWith('comp_') && showAdjustments ?
                        editedAdjustments[propKey]?.adjustments?.find(a =>
                          a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
                        ) : null;

                      if (!isEditable) {
                        return (
                          <td key={propKey} className={`px-2 py-1 text-center ${bgClass} border-r border-gray-200`}>
                            <div className="text-xs">{displayVal}</div>
                            {compAdj && compAdj.amount !== 0 && (
                              <div className={`text-xs font-bold ${compAdj.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {compAdj.amount > 0 ? '+' : ''}${Math.round(compAdj.amount).toLocaleString()}
                              </div>
                            )}
                          </td>
                        );
                      }

                      // Editable cell
                      return (
                        <td key={propKey} className={`px-1 py-1 text-center ${bgClass} border-r border-gray-200`}>
                          {config.type === 'number' && (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={editedVal ?? (prop ? prop[config.field] : '') ?? ''}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs text-center border rounded focus:ring-1 focus:ring-blue-500"
                            />
                          )}
                          {config.type === 'yesno' && (
                            <select
                              value={editedVal ?? (prop && prop[config.field] ? 'Yes' : 'No')}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                            </select>
                          )}
                          {config.type === 'garage' && (
                            <select
                              value={editedVal ?? getGarageCategory(prop ? prop[config.field] : 0)}
                              onChange={(e) => updateEditedValue(propKey, attr.id, parseInt(e.target.value))}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              {GARAGE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {config.type === 'condition' && (
                            <select
                              value={editedVal ?? (prop ? prop[config.field] : '')}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">-</option>
                              {getConditionOptions().map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {compAdj && compAdj.amount !== 0 && (
                            <div className={`text-xs font-bold ${compAdj.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {compAdj.amount > 0 ? '+' : ''}${Math.round(compAdj.amount).toLocaleString()}
                            </div>
                          )}
                        </td>
                      );
                    };

                    return (
                      <tr key={attr.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-2 py-1 font-medium text-gray-900 border-r border-gray-200 whitespace-nowrap">
                          {attr.label}
                          {attr.isDynamic && <span className="ml-1 text-purple-500 text-xs">(D)</span>}
                        </td>
                        {renderCell('subject', 'bg-slate-50')}
                        {[0, 1, 2, 3, 4].map(idx => renderCell(`comp_${idx}`, 'bg-blue-50'))}
                      </tr>
                    );
                  })}

                  {/* Net Adjustment Row */}
                  {showAdjustments && rowVisibility['net_adjustment'] !== false && (
                    <tr className="border-b-2 border-gray-400 bg-gray-100">
                      <td className="px-2 py-2 font-bold text-gray-900 border-r border-gray-300">Net Adjustment</td>
                      <td className="px-2 py-2 text-center bg-slate-100 border-r border-gray-300">-</td>
                      {[0, 1, 2, 3, 4].map(idx => {
                        const compKey = `comp_${idx}`;
                        const compData = editedAdjustments[compKey] || comps[idx] || {};
                        const total = compData.totalAdjustment || 0;
                        const pct = compData.adjustmentPercent || 0;
                        return (
                          <td key={idx} className={`px-2 py-2 text-center font-bold border-r border-gray-300 ${total > 0 ? 'text-green-700' : total < 0 ? 'text-red-700' : ''}`}>
                            {comps[idx] ? (
                              <>
                                {total > 0 ? '+' : ''}${Math.round(total).toLocaleString()}
                                <div className="text-xs font-normal">({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</div>
                              </>
                            ) : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  )}

                  {/* Adjusted Valuation Row */}
                  {showAdjustments && rowVisibility['adjusted_valuation'] !== false && (
                    <tr className="border-b-2 border-gray-400 bg-blue-100">
                      <td className="px-2 py-2 font-bold text-gray-900 border-r border-gray-300">Adjusted Valuation</td>
                      <td className="px-2 py-2 text-center bg-slate-100 border-r border-gray-300 font-bold text-green-700">
                        {result.projectedAssessment ? `$${result.projectedAssessment.toLocaleString()}` : '-'}
                      </td>
                      {[0, 1, 2, 3, 4].map(idx => {
                        const compKey = `comp_${idx}`;
                        const compData = editedAdjustments[compKey] || comps[idx] || {};
                        const adjustedPrice = compData.adjustedPrice || 0;
                        return (
                          <td key={idx} className="px-2 py-2 text-center font-bold border-r border-gray-300">
                            {comps[idx] ? `$${Math.round(adjustedPrice).toLocaleString()}` : '-'}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between rounded-b-lg flex-shrink-0">
              <p className="text-xs text-gray-500">
                Edit values directly in the grid. Adjustments recalculate automatically.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={generatePDF}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                >
                  <FileDown size={16} />
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DetailedAppraisalGrid;
