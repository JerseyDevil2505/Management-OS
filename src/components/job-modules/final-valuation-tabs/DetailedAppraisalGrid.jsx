import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { interpretCodes, supabase } from '../../../lib/supabaseClient';
import { FileDown, X, Eye, EyeOff, Printer, Map as MapIcon, History, Flag } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { evaluateAppellantComp, getNuShortForm } from '../../../lib/appellantCompEvaluator';
import AppealMap, { distanceMiles } from '../../AppealMap';
import ParcelPhotoStrip from '../ParcelPhotoStrip';
import GeocodeStatusChip from '../../GeocodeStatusChip';

// Locally-controlled input for the export-modal cells. Holding the typed value
// in component-local state means each keystroke only re-renders this one cell
// instead of the entire 6-column x ~50-row grid (which would otherwise re-run
// every attr.render(...) on every key, causing visible lag in sales_nu /
// sales_date / sales_price). The committed value is pushed to the parent on
// blur or when the user presses Enter. The modal is conditionally mounted, so
// remounting on each open is enough to reset state — no external sync needed.
const EditableInput = React.memo(function EditableInput({
  initialValue,
  onCommit,
  type = 'text',
  inputMode,
  className,
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const commit = useCallback(() => {
    onCommit(value);
  }, [value, onCommit]);
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
      className={className}
    />
  );
});

const DetailedAppraisalGrid = ({ result, jobData, codeDefinitions, vendorType, adjustmentGrid = [], compFilters = null, cmeBrackets = [], isJobContainerLoading = false, allProperties = [], marketLandData = {}, tenantConfig = null, onSalesSwapped = null }) => {
  const subject = result.subject;
  // Real comps coming from the comparables search. Manual "M" comps (entered
  // directly in the export modal for out-of-town properties) are layered on
  // top of these via `manualComps` below to produce the unified `comps` array
  // that every downstream consumer (cells, recalc, PDF) reads from.
  const rawComps = result.comparables || [];

  // ==================== MANUAL COMP STATE ====================
  // Keyed by slot index 0..4. When set, this slot renders as a fully editable
  // out-of-town manual comp instead of (or in place of) the corresponding
  // rawComps entry. Manual comps participate in Recalculate exactly like real
  // comps; the user fills attribute values via the existing editable cells.
  const [manualComps, setManualComps] = useState({});

  // Build a stable manual-comp record. Property-shaped so the rest of the grid
  // can read fields off it. All attribute values start blank; the user fills
  // them via the editable cells, which already overlay onto comps via
  // editableProperties[`comp_${idx}`].
  const buildManualComp = (idx) => ({
    is_manual_comp: true,
    property_composite_key: `__manual_comp_${idx}__`,
    property_block: '',
    property_lot: '',
    property_qualifier: '',
    property_card: '',
    property_location: '',
    property_class: '',
    property_m4_class: '',
    sales_date: '',
    sales_price: 0,
    sales_book: '',
    sales_page: '',
    sales_nu: '',
    asset_year_built: '',
    asset_sfla: 0,
    asset_lot_acre: 0,
    asset_lot_sf: 0,
    asset_design: '',
    asset_type_use: '',
    asset_ext_cond: '',
    asset_int_cond: '',
    values_mod_total: 0,
    adjustedPrice: 0,
  });

  const toggleManualComp = useCallback((idx) => {
    setManualComps(prev => {
      const next = { ...prev };
      if (next[idx]) {
        delete next[idx];
      } else {
        next[idx] = buildManualComp(idx);
      }
      return next;
    });
    // Clear edits/adjustments for that slot so old comp data does not bleed
    // into a freshly-toggled manual comp (and vice versa).
    setEditableProperties(prev => {
      const next = { ...prev };
      delete next[`comp_${idx}`];
      return next;
    });
    setEditedAdjustments(prev => {
      const next = { ...prev };
      delete next[`comp_${idx}`];
      return next;
    });
    setHasEdits(true);
  }, []);

  // Unified comps array: manual override wins per slot, otherwise rawComps.
  // Length always matches max(rawComps.length, 5) so the 5-column grid is
  // stable regardless of how many real comps came back.
  const comps = useMemo(() => {
    const len = Math.max(rawComps.length, 5);
    const merged = [];
    for (let i = 0; i < len; i++) {
      merged.push(manualComps[i] || rawComps[i] || null);
    }
    return merged;
  }, [rawComps, manualComps]);

  // ==================== ADDITIONAL CARDS DETECTION ====================
  // Helper to check if a card identifier is a main card
  const isMainCard = useCallback((cardValue) => {
    const card = (cardValue || '').toString().trim();
    if (vendorType === 'Microsystems') {
      const cardUpper = card.toUpperCase();
      return cardUpper === 'M' || cardUpper === 'MAIN' || cardUpper === '';
    } else { // BRT
      const cardNum = parseInt(card);
      return cardNum === 1 || card === '' || isNaN(cardNum);
    }
  }, [vendorType]);

  // Helper to get all cards for a property (main + additional)
  const getPropertyCards = useCallback((prop) => {
    if (!prop || !allProperties || allProperties.length === 0) return [prop];

    const baseKey = `${prop.property_block || ''}-${prop.property_lot || ''}-${prop.property_qualifier || ''}`;

    return allProperties.filter(p => {
      const pBaseKey = `${p.property_block || ''}-${p.property_lot || ''}-${p.property_qualifier || ''}`;
      return pBaseKey === baseKey;
    });
  }, [allProperties]);

  // Helper to aggregate data across all cards for a property
  const getAggregatedPropertyData = useCallback((prop) => {
    const allCards = getPropertyCards(prop);
    if (allCards.length <= 1) return prop; // No additional cards, return as-is

    // Aggregate data across all cards
    const aggregated = { ...prop };

    // SUM: SFLA, bathrooms, bedrooms, fireplaces, basement_area, fin_basement_area,
    // garage_area, det_garage_area, deck_area, patio_area, pool_area, open_porch_area, enclosed_porch_area
    // Includes lot acre for farm properties with multiple cards like 3A + 3B
    const sumFields = [
      'asset_sfla', 'asset_lot_acre', 'total_baths_calculated', 'asset_bathrooms', 'asset_bedrooms',
      'fireplace_count', 'asset_fireplaces', 'basement_area', 'fin_basement_area',
      'garage_area', 'det_garage_area', 'deck_area', 'patio_area', 'pool_area',
      'open_porch_area', 'enclosed_porch_area', 'barn_area', 'stable_area', 'pole_barn_area', 'ac_area'
    ];

    sumFields.forEach(field => {
      const total = allCards.reduce((sum, card) => sum + (parseFloat(card[field]) || 0), 0);
      if (total > 0) aggregated[field] = total;
    });

    // AVERAGE: year_built
    const validYears = allCards
      .map(card => parseInt(card.asset_year_built))
      .filter(year => year > 1800 && year <= new Date().getFullYear());
    if (validYears.length > 0) {
      aggregated.asset_year_built = Math.round(validYears.reduce((a, b) => a + b, 0) / validYears.length);
    }

    // OR logic for boolean amenities (if any card has it, show Yes)
    const booleanFields = [
      'asset_basement', 'asset_fin_basement', 'asset_ac', 'asset_deck',
      'asset_patio', 'asset_open_porch', 'asset_enclosed_porch', 'asset_pool'
    ];

    booleanFields.forEach(field => {
      const hasAny = allCards.some(card => card[field] && card[field] !== 'No' && card[field] !== 'NONE');
      aggregated[field] = hasAny;
    });

    // Store additional cards count
    aggregated._additionalCardsCount = allCards.length - 1;

    // For farm properties, ensure asset_lot_acre matches the combined lot from _pkg
    // This keeps the editable value in sync with the display render function
    if (aggregated._pkg?.is_farm_package && aggregated._pkg?.combined_lot_acres > 0) {
      aggregated.asset_lot_acre = aggregated._pkg.combined_lot_acres;
    }

    return aggregated;
  }, [getPropertyCards]);

  // Get aggregated subject and comps
  const aggregatedSubject = useMemo(() => getAggregatedPropertyData(subject), [subject, getAggregatedPropertyData]);
  const aggregatedComps = useMemo(() => comps.map(comp => {
    if (!comp) return null;
    // Manual comps are not in property_records, so skip the additional-cards
    // aggregation pass entirely - just return them as-is.
    if (comp.is_manual_comp) return comp;
    return { ...comp, ...getAggregatedPropertyData(comp) };
  }), [comps, getAggregatedPropertyData]);

  // ==================== PDF EXPORT STATE ====================
  const [showExportModal, setShowExportModal] = useState(false);
  // PDF section toggles persisted to localStorage. Each remembers the user's last pick across exports.
  // Some assessors run the full detailed grid as the deliverable (no need for the inline appellant page),
  // and others prefer to omit the Director's Ratio / Chapter 123 page when the new value drops sharply
  // and they're settling somewhere in between.
  const readToggle = (key, defaultValue) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return raw === 'true';
    } catch (e) { return defaultValue; }
  };
  const [showAdjustments, setShowAdjustments] = useState(() => readToggle('detailedExport_showAdjustments', true));
  const [rowVisibility, setRowVisibility] = useState({}); // { attrId: boolean }
  const [includeMap, setIncludeMap] = useState(() => readToggle('detailedExport_includeMap', true)); // Embed subject+comps map in PDF
  const [hideAppellantEvidence, setHideAppellantEvidence] = useState(() => readToggle('detailedExport_hideAppellantEvidence', false));
  const [hideDirectorsRatio, setHideDirectorsRatio] = useState(() => readToggle('detailedExport_hideDirectorsRatio', false));
  const [includePhotos, setIncludePhotos] = useState(() => readToggle('detailedExport_includePhotos', true));
  // Map preview is collapsed by default (it dominated the modal). Click to expand.
  const [mapExpanded, setMapExpanded] = useState(() => readToggle('detailedExport_mapExpanded', false));

  // Persist toggle state across sessions
  useEffect(() => { try { localStorage.setItem('detailedExport_showAdjustments', String(showAdjustments)); } catch (e) {} }, [showAdjustments]);
  useEffect(() => { try { localStorage.setItem('detailedExport_includeMap', String(includeMap)); } catch (e) {} }, [includeMap]);
  useEffect(() => { try { localStorage.setItem('detailedExport_hideAppellantEvidence', String(hideAppellantEvidence)); } catch (e) {} }, [hideAppellantEvidence]);
  useEffect(() => { try { localStorage.setItem('detailedExport_hideDirectorsRatio', String(hideDirectorsRatio)); } catch (e) {} }, [hideDirectorsRatio]);
  useEffect(() => { try { localStorage.setItem('detailedExport_includePhotos', String(includePhotos)); } catch (e) {} }, [includePhotos]);
  useEffect(() => { try { localStorage.setItem('detailedExport_mapExpanded', String(mapExpanded)); } catch (e) {} }, [mapExpanded]);
  const mapCaptureRef = useRef(null); // DOM ref for html2canvas capture
  // Appellant-supplied comps (loaded from appeal_log on modal open). Each
  // entry is the saved slot enriched with the resolved property record so we
  // can pull lat/lng for the map. Empty array if no appeal exists or no
  // appellant comps were saved.
  const [appellantCompsState, setAppellantCompsState] = useState([]);

  // Local in-memory overrides for geocode coordinates set via the inline
  // GeocodeStatusChip edit modal. Keyed by property_composite_key. Lets the
  // user fix a missing/wrong geocode and have the map + PDF reflect it
  // without a full grid reload. Persisted to property_records by the chip.
  const [geocodePatches, setGeocodePatches] = useState({});
  const applyGeocodePatch = useCallback(
    (p) => {
      if (!p || !p.property_composite_key) return p;
      const patch = geocodePatches[p.property_composite_key];
      return patch ? { ...p, ...patch } : p;
    },
    [geocodePatches],
  );
  const handleGeocodeSaved = useCallback((compositeKey, patch) => {
    if (!compositeKey) return;
    setGeocodePatches((prev) => ({ ...prev, [compositeKey]: patch }));
  }, []);

  // ==================== SALES HISTORY (Hidden / Cover Sale Swap) ====================
  // When a property's current sale is a cover ($1, family transfer, estate, etc.)
  // and `prev_sales` from the BRT file contains a real arm's-length sale, the
  // user can swap that prior sale into the current slot via this modal. The
  // selection is persisted to property_records with sales_override=true so the
  // file updater (see DB trigger respect_sales_override) won't clobber it on
  // re-upload — unless a strictly newer usable sale arrives later.
  const [salesHistoryModal, setSalesHistoryModal] = useState(null); // { propKey, property }
  const [salesHistoryPatches, setSalesHistoryPatches] = useState({}); // composite_key -> { sales_date, sales_price, sales_nu, sales_book, sales_page, sales_override }
  const applySalesHistoryPatch = useCallback((p) => {
    if (!p || !p.property_composite_key) return p;
    const patch = salesHistoryPatches[p.property_composite_key];
    return patch ? { ...p, ...patch } : p;
  }, [salesHistoryPatches]);
  const openSalesHistoryModal = useCallback((propKey, property) => {
    if (!property?.property_composite_key) return;
    setSalesHistoryModal({ propKey, property: applySalesHistoryPatch(property) });
  }, [applySalesHistoryPatch]);
  const closeSalesHistoryModal = useCallback(() => setSalesHistoryModal(null), []);

  // Build the subject + comps payload for AppealMap. Pulls lat/lng off the
  // already-aggregated subject/comps. If the subject is not geocoded, the
  // map will render a placeholder and the PDF export skips it gracefully.
  const mapData = useMemo(() => {
    const subjectPatched = applyGeocodePatch(subject);
    const sLat = parseFloat(subjectPatched?.property_latitude);
    const sLng = parseFloat(subjectPatched?.property_longitude);
    const subjectPayload = (!isNaN(sLat) && !isNaN(sLng))
      ? {
          latitude: sLat,
          longitude: sLng,
          address: subjectPatched?.property_location || '',
          block: subjectPatched?.property_block || '',
          lot: subjectPatched?.property_lot || '',
          qualifier: subjectPatched?.property_qualifier || '',
        }
      : null;
    const compsPayload = (comps || [])
      .map((rawC, idx) => {
        // Slot may be null (padding) or a manual out-of-town comp without
        // lat/lng - drop both so the map only paints geocoded real comps.
        if (!rawC || rawC.is_manual_comp) return null;
        const c = applyGeocodePatch(rawC);
        if (!c) return null;
        const lat = parseFloat(c.property_latitude);
        const lng = parseFloat(c.property_longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        return {
          latitude: lat,
          longitude: lng,
          address: c.property_location || '',
          block: c.property_block || '',
          lot: c.property_lot || '',
          qualifier: c.property_qualifier || '',
          rank: idx + 1,
        };
      })
      .filter(Boolean);
    // Appellant comps: each saved slot is resolved to its property record
    // (block/lot/qualifier/card) in `appellantCompsState`, then we pull
    // lat/lng off that record. Slots whose property isn't geocoded are
    // dropped silently (same behavior as appraisal comps above).
    const appellantPayload = (appellantCompsState || [])
      .map((entry, idx) => {
        const p = applyGeocodePatch(entry.property);
        if (!p) return null;
        const lat = parseFloat(p.property_latitude);
        const lng = parseFloat(p.property_longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        return {
          latitude: lat,
          longitude: lng,
          address: p.property_location || '',
          block: p.property_block || entry.slot?.block || '',
          lot: p.property_lot || entry.slot?.lot || '',
          qualifier: p.property_qualifier || entry.slot?.qualifier || '',
          rank: idx + 1,
        };
      })
      .filter(Boolean);

    return { subject: subjectPayload, comps: compsPayload, appellantComps: appellantPayload };
  }, [subject, comps, appellantCompsState, applyGeocodePatch]);

  // Parcels payload for the per-parcel photo strip (Subject + Comps + Appellant comps).
  // Independent of geocoding — photos work regardless of lat/lng.
  const photoStripParcels = useMemo(() => {
    const out = [];
    if (subject?.property_composite_key) {
      out.push({
        composite_key: subject.property_composite_key,
        block: subject.property_block,
        lot: subject.property_lot,
        qualifier: subject.property_qualifier,
        address: subject.property_location || '',
        roleLabel: 'SUBJECT',
        roleColor: 'bg-red-100 text-red-800',
      });
    }
    (comps || []).forEach((c, i) => {
      // Render every comp slot the grid renders so picker labels stay aligned
      // with the grid columns (COMP 1, COMP 2, ...). Manual comps and slots
      // missing a composite_key still get a cell — they just won't have a DB
      // lookup; the cell falls back to its empty/add state.
      if (!c) return;
      const slotKey = c.property_composite_key || `slot-${i + 1}`;
      out.push({
        composite_key: slotKey,
        block: c.property_block,
        lot: c.property_lot,
        qualifier: c.property_qualifier,
        address: c.property_location || '',
        roleLabel: `COMP ${i + 1}`,
        roleColor: 'bg-blue-100 text-blue-800',
        isManual: !!c.is_manual_comp,
        hasParcelKey: !!c.property_composite_key,
      });
    });
    // Appellant comps intentionally NOT included here. They get their own
    // photos via the Appellant Evidence flow when those parcels are searched
    // separately as detailed-grid subjects.
    // Dedupe only on real composite_keys (synthetic slot-N keys are unique by
    // construction). Subject is preserved; only later duplicates are dropped.
    const seen = new Set();
    return out.filter((p) => {
      if (!p.composite_key.startsWith('slot-')) {
        if (seen.has(p.composite_key)) return false;
        seen.add(p.composite_key);
      }
      return true;
    });
  }, [subject, comps]);

  const mapHasSubject = !!mapData.subject;
  const mapGeocodedCount =
    (mapData.subject ? 1 : 0) + mapData.comps.length + mapData.appellantComps.length;
  // Only count real, non-manual comps toward the "X of Y geocoded" total -
  // null padding slots and manual out-of-town comps are not expected to have
  // coordinates and would otherwise inflate the denominator misleadingly.
  const mapTotalCount =
    1 +
    (comps?.filter(c => c && !c.is_manual_comp).length || 0) +
    (appellantCompsState?.length || 0);

  // Per-comp distance (miles) from subject. Always 1 decimal.
  const compDistances = useMemo(() => {
    if (!mapData.subject) return [];
    const subjLL = [mapData.subject.latitude, mapData.subject.longitude];
    return mapData.comps.map((c) => ({
      rank: c.rank,
      address: c.address,
      block: c.block,
      lot: c.lot,
      qualifier: c.qualifier,
      miles: distanceMiles(subjLL, [c.latitude, c.longitude]),
    }));
  }, [mapData]);

  // Per-appellant-comp distance (miles) from subject.
  const appellantDistances = useMemo(() => {
    if (!mapData.subject) return [];
    const subjLL = [mapData.subject.latitude, mapData.subject.longitude];
    return mapData.appellantComps.map((c) => ({
      rank: c.rank,
      address: c.address,
      block: c.block,
      lot: c.lot,
      qualifier: c.qualifier,
      miles: distanceMiles(subjLL, [c.latitude, c.longitude]),
    }));
  }, [mapData]);

  // Editable data for export modal - stores property overrides
  // Structure: { subject: {...propertyOverrides}, comp_0: {...}, comp_1: {...}, etc. }
  const [editableProperties, setEditableProperties] = useState({});

  // Calculated adjustments based on edited values
  const [editedAdjustments, setEditedAdjustments] = useState({});
  const [hasEdits, setHasEdits] = useState(false);
  const [recalculatedProjectedAssessment, setRecalculatedProjectedAssessment] = useState(null);

  // Appeal number for PDF export
  const [appealNumber, setAppealNumber] = useState('');
  const [appealAutoDetected, setAppealAutoDetected] = useState(false);

  // Define which attributes are editable and their input types
  const EDITABLE_CONFIG = {
    // Numeric inputs
    lot_size_sf: { type: 'number', field: 'asset_lot_sf', altField: 'market_manual_lot_sf' },
    sales_date: { type: 'date', field: 'sales_date' },
    lot_size_ff: { type: 'number', field: 'asset_lot_ff', altField: 'market_manual_lot_ff' },
    lot_size_acre: { type: 'number', field: 'asset_lot_acre', altField: 'market_manual_lot_acre', step: 0.01 },
    liveable_area: { type: 'number', field: 'asset_sfla' },
    year_built: { type: 'number', field: 'asset_year_built' },
    bathrooms: { type: 'number', field: 'asset_bathrooms', altField: 'total_baths_calculated', step: 0.5 },
    bedrooms: { type: 'number', field: 'asset_bedrooms' },
    fireplaces: { type: 'number', field: 'asset_fireplaces', altField: 'fireplace_count' },
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
    int_condition: { type: 'condition', field: 'asset_int_cond' },
    // Code dropdowns - sourced from codes actually used in this job's properties
    // so the user picks a real code that the rest of the system knows how to
    // decode/display. Sales code is a free-text input since NU codes are public
    // record and easily looked up by the assessor.
    style_code: { type: 'code', field: 'asset_design_style', codeType: 'design' },
    type_use_code: { type: 'code', field: 'asset_type_use', codeType: 'typeUse' },
    story_height_code: { type: 'code', field: 'asset_stories', altField: 'asset_story_height', codeType: 'storyHeight' },
    view_code: { type: 'code', field: 'asset_view', altField: 'asset_view_code', codeType: 'view' },
    sales_code: { type: 'text', field: 'sales_nu', altField: 'sales_code' }
  };

  // Build dropdown options for code-backed fields by walking allProperties to
  // find every distinct code in use, then decoding it via interpretCodes so
  // the user sees the same `CODE (Name)` pairing they're used to seeing in
  // the cells.
  const getCodeOptions = useCallback((codeType) => {
    if (!Array.isArray(allProperties) || allProperties.length === 0) return [];
    const seen = new Map();
    for (const p of allProperties) {
      let code = null;
      let name = null;
      if (codeType === 'design') {
        code = p.asset_design_style;
        if (code && codeDefinitions) name = interpretCodes.getDesignName(p, codeDefinitions, vendorType);
      } else if (codeType === 'typeUse') {
        code = p.asset_type_use;
        if (code && codeDefinitions) name = interpretCodes.getTypeName(p, codeDefinitions, vendorType);
      } else if (codeType === 'storyHeight') {
        code = p.asset_stories || p.asset_story_height;
        if (code && codeDefinitions) name = interpretCodes.getStoryHeightName(p, codeDefinitions, vendorType);
      } else if (codeType === 'view') {
        code = p.asset_view || p.asset_view_code;
        if (code && codeDefinitions) name = interpretCodes.getViewName(p, codeDefinitions, vendorType);
      }
      if (!code) continue;
      const key = String(code);
      if (!seen.has(key)) {
        seen.set(key, { value: key, label: name ? `${key} (${name})` : key });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.value.localeCompare(b.value));
  }, [allProperties, codeDefinitions, vendorType]);

  // Garage options
  const GARAGE_OPTIONS = [
    { value: 0, label: 'None' },
    { value: 1, label: 'One Car' },
    { value: 2, label: 'Two Car' },
    { value: 3, label: 'Three Car' },
    { value: 4, label: 'Multi Car' }
  ];

  // Condition options (will be populated from code definitions)
  const getConditionOptions = useCallback((configType) => {
    // Pull from condition config (same source used for ranking/adjustments)
    const conditionConfig = jobData?.attribute_condition_config;
    if (conditionConfig && conditionConfig[configType]) {
      const config = conditionConfig[configType];
      const options = [];
      // Better conditions (best first)
      if (config.better) {
        [...config.better].reverse().forEach(name => options.push({ value: name, label: name }));
      }
      // Baseline
      if (config.baseline) {
        options.push({ value: config.baseline, label: config.baseline });
      }
      // Worse conditions (least bad first)
      if (config.worse) {
        config.worse.forEach(name => options.push({ value: name, label: name }));
      }
      if (options.length > 0) return options;
    }
    // Fallback standard options
    return [
      { value: 'Excellent', label: 'Excellent' },
      { value: 'Good', label: 'Good' },
      { value: 'Average', label: 'Average' },
      { value: 'Fair', label: 'Fair' },
      { value: 'Poor', label: 'Poor' }
    ];
  }, [jobData]);

  // Determine which bracket is being used
  const getBracketLabel = () => {
    if (!compFilters) return 'Auto';

    const selectedBracket = compFilters.adjustmentBracket;

    if (selectedBracket === 'auto') {
      // If a mapped bracket was used for this result, show that
      if (result.mappedBracket) {
        const match = result.mappedBracket.match(/bracket_(\d+)/);
        if (match) {
          const idx = parseInt(match[1]);
          if (cmeBrackets[idx]) {
            return `Auto - Mapped (${cmeBrackets[idx].label})`;
          }
        }
        return `Auto - Mapped`;
      }
      // Fall back to price-based bracket
      const subjectValue = subject.sales_price || subject.values_mod_total || subject.values_cama_total || 0;
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
  // Uses aggregatedComps which includes data from additional cards
  const renderCompCells = (renderFunc) => {
    return [0, 1, 2, 3, 4].map((idx) => {
      const comp = aggregatedComps[idx];
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

  // Helper: Map NCOVR percentage to Franklin condition name
  const mapNCOVRToConditionName = (ncovr_pct) => {
    if (!ncovr_pct && ncovr_pct !== 0) return null;

    const pct = parseFloat(ncovr_pct);
    if (isNaN(pct)) return null;

    // Franklin NCOVR scale (stored as 0.00-1.00 decimal)
    if (pct >= 0.86) return 'EXCELLENT';
    if (pct >= 0.71) return 'GOOD';
    if (pct >= 0.56) return 'AVERAGE';
    if (pct >= 0.41) return 'FAIR';
    if (pct >= 0.26) return 'POOR';
    if (pct >= 0.01) return 'DILAPIDATED';

    return null;
  };

  // Franklin Township: Exclude finished basement with heat (code "02") from SFLA
  const getAdjustedSFLA = (prop) => {
    if (!prop || !prop.asset_sfla) return prop?.asset_sfla || null;

    const isFranklinJob = jobData?.municipality?.toLowerCase().includes('franklin');
    if (!isFranklinJob) {
      return prop.asset_sfla; // No adjustment for other townships
    }

    // For Franklin: exclude fin_basement_area if code is "02 FIN B W/HEAT" or similar
    let sfla = prop.asset_sfla;
    const code1 = (prop.fin_basement_code_1 || '').toString().trim().toUpperCase();
    const code2 = (prop.fin_basement_code_2 || '').toString().trim().toUpperCase();

    // If finish code 1 is "02", subtract the corresponding area (fin_basement_area_1)
    if ((code1.includes('02') || code1.includes('FIN B W/HEAT')) && prop.fin_basement_area_1) {
      sfla -= prop.fin_basement_area_1;
    }

    // If finish code 2 is "02", subtract the corresponding area (fin_basement_area_2)
    if ((code2.includes('02') || code2.includes('FIN B W/HEAT')) && prop.fin_basement_area_2) {
      sfla -= prop.fin_basement_area_2;
    }

    return Math.max(0, sfla); // Ensure SFLA doesn't go negative
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
      render: (prop) => {
        // Manual out-of-town comps don't have a Block/Lot - surface that
        // explicitly so the assessor can see at a glance which column is
        // a hand-entered comp vs. a real district parcel.
        if (prop?.is_manual_comp) return 'Out of Town';
        return `${prop.property_block}/${prop.property_lot}${prop.property_qualifier ? '/' + prop.property_qualifier : ''}`;
      },
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
        // For farm properties with farmSalesMode enabled, use combined lot acres (3A + 3B)
        if (compFilters?.farmSalesMode && allProperties?.length > 0) {
          const pkgData = prop._pkg;
          if (pkgData?.is_farm_package && pkgData.combined_lot_acres > 0) {
            return `${pkgData.combined_lot_acres.toFixed(2)} (Farm)`;
          }
        }
        const acres = prop.market_manual_lot_acre || prop.asset_lot_acre;
        return acres ? acres.toFixed(2) : 'N/A';
      },
      adjustmentName: 'Lot Size (Acre)'
    },
    {
      id: 'liveable_area',
      label: 'Liveable Area',
      render: (prop) => {
        const adjustedSFLA = getAdjustedSFLA(prop);
        return adjustedSFLA ? adjustedSFLA.toLocaleString() : 'N/A';
      },
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
        // Check if using NCOVR override method
        const conditionMethod = jobData?.attribute_condition_config?.conditionHandlingMethod;
        if (conditionMethod === 'ncovr_override') {
          // Use NCOVR percentage to determine condition
          const conditionName = mapNCOVRToConditionName(prop.net_condition_pct);
          return conditionName || 'N/A';
        }

        // Standard condition code lookup
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
        // Check if using NCOVR override method
        const conditionMethod = jobData?.attribute_condition_config?.conditionHandlingMethod;
        if (conditionMethod === 'ncovr_override') {
          // Use NCOVR percentage to determine condition
          const conditionName = mapNCOVRToConditionName(prop.net_condition_pct);
          return conditionName || 'N/A';
        }

        // Standard condition code lookup
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

        // Legacy / single-aggregated dynamic rows for barn / pole_barn / stable
        // Always normalize to YES/NONE so the "hide if all NONE" filter works in
        // both the UI and the PDF export (matches how land adjustments behave).
        const columnMap = {
          'barn': 'barn_area',
          'stable': 'stable_area',
          'pole_barn': 'pole_barn_area'
        };

        const columnName = columnMap[adj.adjustment_id];
        if (columnName) {
          const val = prop[columnName];
          if (val !== undefined && val !== null && val > 0) {
            return `YES (${val.toLocaleString()} SF)`;
          }
          return 'NONE';
        }

        return 'NONE';
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
    // Check altField first (for cases like market_manual_lot_sf vs asset_lot_sf)
    if (config.altField && prop[config.altField] !== undefined && prop[config.altField] !== null) {
      return prop[config.altField];
    }
    return prop[config.field];
  }, []);

  // Update a single cell value
  const updateEditedValue = useCallback((propKey, attrId, value) => {
    setEditableProperties(prev => ({
      ...prev,
      [propKey]: {
        ...(prev[propKey] || {}),
        [attrId]: value
      }
    }));
    setHasEdits(true);
  }, []);

  // Helper: Get condition rank from condition code/name (mirrors SalesComparisonTab logic)
  const getConditionRank = useCallback((conditionCode, configType) => {
    if (!conditionCode || String(conditionCode).trim() === '') return 0;
    const conditionConfig = jobData?.attribute_condition_config;
    if (!conditionConfig || !conditionConfig[configType]) return 0;

    const config = conditionConfig[configType];
    const code = String(conditionCode).toUpperCase().trim();
    const baseline = config.baseline?.toUpperCase().trim();
    const betterCodes = (config.better || []).map(c => c.toUpperCase().trim());
    const worseCodes = (config.worse || []).map(c => c.toUpperCase().trim());

    // Also try translating code to name via code definitions
    let codeName = code;
    if (codeDefinitions) {
      const nameFromCode = configType === 'exterior'
        ? interpretCodes.getExteriorConditionName({ asset_ext_cond: conditionCode }, codeDefinitions, vendorType)
        : interpretCodes.getInteriorConditionName({ asset_int_cond: conditionCode }, codeDefinitions, vendorType);
      if (nameFromCode) codeName = nameFromCode.toUpperCase().trim();
    }

    if (code === baseline || codeName === baseline) return 0;
    const betterIdx = betterCodes.indexOf(code) !== -1 ? betterCodes.indexOf(code) : betterCodes.indexOf(codeName);
    if (betterIdx !== -1) return betterIdx + 1;
    const worseIdx = worseCodes.indexOf(code) !== -1 ? worseCodes.indexOf(code) : worseCodes.indexOf(codeName);
    if (worseIdx !== -1) return -(worseIdx + 1);
    return 0;
  }, [jobData, codeDefinitions, vendorType]);

  // Helper: Get bracket index based on compFilters, mapped bracket, and comp price
  const getBracketIndex = useCallback((compNormTime) => {
    // If a specific bracket is selected (not auto), use it
    if (compFilters?.adjustmentBracket && compFilters.adjustmentBracket !== 'auto') {
      const match = compFilters.adjustmentBracket.match(/bracket_(\d+)/);
      if (match) return parseInt(match[1]);
    }
    // If auto with a mapped bracket for this subject, use the mapped bracket
    if (result.mappedBracket) {
      const match = result.mappedBracket.match(/bracket_(\d+)/);
      if (match) return parseInt(match[1]);
    }
    // Fall back to price-based bracket
    if (!compNormTime || !cmeBrackets?.length) return 0;
    const bracket = cmeBrackets.findIndex(b => compNormTime >= b.min && compNormTime <= b.max);
    return bracket >= 0 ? bracket : 0;
  }, [compFilters, cmeBrackets, result.mappedBracket]);

  // Calculate adjustment for a single attribute between subject and comp
  const calculateSingleAdjustment = useCallback((subjectVal, compVal, adjustmentDef, compSalesPrice) => {
    if (!adjustmentDef) return 0;

    const bracketIndex = getBracketIndex(compSalesPrice);
    const adjustmentValue = adjustmentDef[`bracket_${bracketIndex}`] || 0;
    const adjustmentType = adjustmentDef.adjustment_type || 'flat';

    const subjectNum = parseFloat(subjectVal) || 0;
    const compNum = parseFloat(compVal) || 0;
    const difference = subjectNum - compNum;

    if (difference === 0) return 0;

    switch (adjustmentType) {
      case 'flat':
        // Lot size and garage adjustments multiply by difference (not binary)
        if (adjustmentDef.adjustment_id?.includes('lot_size') ||
            adjustmentDef.adjustment_id === 'garage' ||
            adjustmentDef.adjustment_id === 'det_garage') {
          return difference * adjustmentValue;
        }
        // Boolean amenities: binary adjustment
        return difference > 0 ? adjustmentValue : (difference < 0 ? -adjustmentValue : 0);
      case 'per_sqft':
        return difference * adjustmentValue;
      case 'count':
        return difference * adjustmentValue;
      case 'percent':
        return (compSalesPrice || 0) * (adjustmentValue / 100) * difference;
      default:
        return 0;
    }
  }, [getBracketIndex]);

  // Recalculate all adjustments based on edited values.
  //
  // Two correctness rules baked in here (see history of bugs around NCOVR
  // condition + missing amenity flags causing spurious adjustments on Recalc):
  //
  // 1. We read each attribute's value the SAME way the cell displays it,
  //    not from the raw DB column. This matters for:
  //      - yes/no amenity rows (deck/patio/porches/pool/basement/AC), where
  //        the raw `asset_*` flag may be null even though the area field is
  //        populated. The cell uses `attr.render(prop)` to decide Yes vs No;
  //        recalc must use the same source or amenities flip from Yes->No
  //        and adjustments invert.
  //      - condition rows on jobs using NCOVR overrides, where the displayed
  //        condition is mapped from `net_condition_pct`. Reading raw
  //        `asset_ext_cond` ranks against a different value than what is
  //        on screen and produces phantom condition adjustments.
  //
  // 2. We only recompute adjustments for comps that the user actually edited
  //    (or all comps if the subject was edited, since that affects every
  //    comp's diff). Untouched comps keep their original adjustments from
  //    the canonical pipeline, so re-deriving them through the editable
  //    shadow data can't introduce drift.
  const recalculateAdjustments = useCallback(() => {
    // Render-aware value reader. Uses the same logic the cell uses for
    // display when no edit exists, so recalc and display can never disagree.
    const getRecalcValue = (propKey, attrId, attrObj, config) => {
      const edited = editableProperties[propKey];
      if (edited && edited[attrId] !== undefined) return edited[attrId];

      const prop = propKey === 'subject'
        ? subject
        : comps[parseInt(propKey.replace('comp_', ''))];
      if (!prop) return null;

      // Yes/No rows: derive from rendered value, mirroring getDefaultYesNo
      // in the cell renderer. An empty / 'No' / 'None' / 'N/A' render means
      // No; anything else (including a formatted area like "240 SF") is Yes.
      if (config?.type === 'yesno') {
        const rendered = attrObj?.render ? attrObj.render(prop) : null;
        if (!rendered) return 'No';
        const renderedStr = String(rendered).toLowerCase();
        if (renderedStr === 'no' || renderedStr === 'none' || renderedStr === 'n/a') return 'No';
        return 'Yes';
      }

      // Condition rows: use the rendered condition name so NCOVR-mapped
      // values flow through. getConditionRank already accepts names.
      if (config?.type === 'condition' && attrObj?.render) {
        const rendered = attrObj.render(prop);
        if (rendered && rendered !== 'N/A') return rendered;
      }

      return getRawValue(prop, attrId);
    };

    // Did the user edit anything on the subject row? If so every comp's
    // diff is potentially affected and we have to recalc all of them.
    const subjectEdits = editableProperties['subject'];
    const subjectWasEdited = !!subjectEdits && Object.keys(subjectEdits).length > 0;

    // Start from any previously-recalculated state so repeated Recalcs
    // don't lose work, then layer fresh entries on top.
    const newAdjustments = { ...editedAdjustments };

    comps.forEach((comp, idx) => {
      if (!comp) return;

      const compKey = `comp_${idx}`;
      const compEdits = editableProperties[compKey];
      const compWasEdited = !!compEdits && Object.keys(compEdits).length > 0;

      // Untouched comp + untouched subject => leave its original adjustments
      // alone. If we already have a recalculated entry from a prior pass,
      // keep that (the user may have edited and reverted edits since).
      if (!compWasEdited && !subjectWasEdited) {
        if (!newAdjustments[compKey]) {
          // Mirror canonical pipeline values into our local map so the
          // projected-assessment loop below can treat all slots uniformly.
          newAdjustments[compKey] = {
            adjustments: comp.adjustments || [],
            totalAdjustment: comp.totalAdjustment || 0,
            adjustedPrice: comp.adjustedPrice || (comp.sales_price || 0),
            adjustmentPercent: comp.adjustmentPercent || 0
          };
        }
        return;
      }

      const compAdjustments = [];
      let totalAdjustment = 0;

      // Get comp's sales price (edited or original), parsed as number
      const compSalesPrice = parseFloat(getRecalcValue(compKey, 'sales_price', null, EDITABLE_CONFIG.sales_price))
        || parseFloat(comp.sales_price)
        || 0;

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

        // Get subject and comp values (edited or render-equivalent)
        let subjectVal = getRecalcValue('subject', attrId, attrObj, config);
        let compVal = getRecalcValue(compKey, attrId, attrObj, config);

        // Convert Yes/No to 1/0 for flat adjustments
        if (config.type === 'yesno') {
          subjectVal = (subjectVal === true || subjectVal === 'Yes' || subjectVal === 1) ? 1 : 0;
          compVal = (compVal === true || compVal === 'Yes' || compVal === 1) ? 1 : 0;
        }

        // Convert garage to category number
        // Edited values are already categories (0-4), raw values are sq ft that need conversion
        if (config.type === 'garage') {
          subjectVal = parseInt(subjectVal) || 0;
          compVal = parseInt(compVal) || 0;
          if (subjectVal > 4) subjectVal = getGarageCategory(subjectVal);
          if (compVal > 4) compVal = getGarageCategory(compVal);
        }

        // Convert condition code/name to rank
        if (config.type === 'condition') {
          const configType = attrId === 'ext_condition' ? 'exterior' : 'interior';
          subjectVal = getConditionRank(subjectVal, configType);
          compVal = getConditionRank(compVal, configType);
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

      // Preserve dynamic adjustment rows (detached items, miscellaneous,
      // positive/negative land) that aren't in EDITABLE_CONFIG. These come
      // from SalesComparisonTab.calculateAdjustment and aren't user-editable
      // in the export modal, so they should pass through unchanged when a
      // comp is recalculated due to edits on other fields.
      const dynamicPrefixes = ['barn_', 'pole_barn_', 'stable_', 'miscellaneous_', 'land_positive_', 'land_negative_'];
      const dynamicAdjustmentNames = new Set(
        (adjustmentGrid || [])
          .filter(adj => adj?.adjustment_id && dynamicPrefixes.some(p => adj.adjustment_id.startsWith(p)))
          .map(adj => (adj.adjustment_name || '').toLowerCase())
          .filter(Boolean)
      );
      const originalAdjustments = comp.adjustments || [];
      originalAdjustments.forEach(orig => {
        if (!orig?.name) return;
        if (dynamicAdjustmentNames.has(String(orig.name).toLowerCase())) {
          compAdjustments.push({ name: orig.name, amount: orig.amount || 0 });
          totalAdjustment += (orig.amount || 0);
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

    // Calculate weighted average projected assessment based on recalculated adjustments
    const validComps = comps.filter(c => c && newAdjustments[`comp_${comps.indexOf(c)}`]);
    if (validComps.length > 0) {
      // Calculate weights based on closeness to 0% adjustment (inverse adjustment percentage)
      const totalInverseAdjPct = validComps.reduce((sum, comp) => {
        const idx = comps.indexOf(comp);
        const adjPct = Math.abs(newAdjustments[`comp_${idx}`]?.adjustmentPercent || 0);
        return sum + (1 / (adjPct + 1)); // +1 to avoid division by zero
      }, 0);

      // Calculate weighted average of adjusted prices
      let newProjectedAssessment = 0;
      validComps.forEach((comp) => {
        const idx = comps.indexOf(comp);
        const adjData = newAdjustments[`comp_${idx}`];
        const adjPct = Math.abs(adjData.adjustmentPercent || 0);
        const weight = (1 / (adjPct + 1)) / totalInverseAdjPct;
        newProjectedAssessment += adjData.adjustedPrice * weight;
      });

      setRecalculatedProjectedAssessment(Math.round(newProjectedAssessment));
    }

    setEditedAdjustments(newAdjustments);
    setHasEdits(false);
  }, [comps, subject, editableProperties, editedAdjustments, getRawValue, calculateSingleAdjustment, allAttributes, adjustmentGrid, getConditionRank]);

  const openExportModal = useCallback(async () => {
    setEditableProperties({});
    setEditedAdjustments({});
    setRecalculatedProjectedAssessment(null);
    setHasEdits(false);
    setAppellantCompsState([]);
    setAppealUploadStatus(null);
    setShowExportModal(true);

    // Auto-detect appeal number for subject AND load appellant_comps so the
    // map preview can paint orange "A#" pins alongside the blue appraisal
    // comps. Appellant slots are resolved against allProperties to pick up
    // lat/lng.
    if (subject && jobData?.id) {
      try {
        const { data } = await supabase
          .from('appeal_log')
          .select('appeal_number, status, appellant_comps, property_composite_key')
          .eq('job_id', jobData.id)
          .eq('property_block', subject.property_block)
          .eq('property_lot', subject.property_lot);

        let active = null;
        if (data && data.length > 0) {
          active = data.find(a => a.status !== 'C') || null;
          if (active && active.appeal_number) {
            setAppealNumber(active.appeal_number);
            setAppealAutoDetected(true);
          } else {
            setAppealNumber('');
            setAppealAutoDetected(false);
          }
        } else {
          setAppealNumber('');
          setAppealAutoDetected(false);
        }

        // Resolve appellant_comps -> property records (for lat/lng + address).
        const slots = Array.isArray(active?.appellant_comps) ? active.appellant_comps : [];
        if (slots.length > 0 && Array.isArray(allProperties) && allProperties.length > 0) {
          const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();
          const resolved = slots.map((slot) => {
            const b = norm(slot.block);
            const l = norm(slot.lot);
            const q = norm(slot.qualifier);
            const c = norm(slot.card);
            if (!b || !l) return { slot, property: null };
            const property = allProperties.find((p) => {
              if (norm(p.property_block) !== b) return false;
              if (norm(p.property_lot) !== l) return false;
              if (norm(p.property_qualifier) !== q) return false;
              if (c && norm(p.property_addl_card || p.property_card) !== c) return false;
              return true;
            }) || null;
            return { slot, property };
          });
          setAppellantCompsState(resolved);
        } else {
          setAppellantCompsState([]);
        }
      } catch (err) {
        console.warn('Could not look up appeal:', err.message);
        setAppellantCompsState([]);
      }
    }
  }, [subject, jobData?.id, allProperties]);

  // ==================== APPEAL LOG UPLOAD STATE ====================
  // Tracks the "Send to Appeal Log" upload progress so the modal can show
  // a status chip and disable the button while the upload is in flight.
  const [appealUploadStatus, setAppealUploadStatus] = useState(null); // { status: 'idle'|'uploading'|'done'|'error', message? }

  // Generate PDF document
  const generatePDF = useCallback(async (opts = {}) => {
    // Pre-export geocode gate: warn if subject or any displayed comp is
    // missing lat/lng. The user can still proceed (some reports don't need
    // a map), but at least they won't be surprised by a blank map page.
    const checkList = [
      { label: 'Subject', p: applyGeocodePatch(aggregatedSubject) },
      ...(aggregatedComps || [])
        .map((c, i) => ({ label: `Comparable ${i + 1}`, p: applyGeocodePatch(c) }))
        .filter((x) => x.p),
    ];
    const missing = checkList.filter(({ p }) => {
      if (!p) return false;
      const lat = parseFloat(p.property_latitude);
      const lng = parseFloat(p.property_longitude);
      return isNaN(lat) || isNaN(lng);
    });
    if (missing.length > 0 && includeMap) {
      const lines = missing
        .map(({ label, p }) => `  • ${label}: ${p.property_location || '(no address)'}`)
        .join('\n');
      const proceed = window.confirm(
        `${missing.length} propert${missing.length === 1 ? 'y is' : 'ies are'} missing geocode coordinates and won't appear on the map:\n\n${lines}\n\nClose this dialog and click the 📍? chip on the column header to fix them now,\nor click OK to export anyway.`,
      );
      if (!proceed) return;
    }

    // Landscape letter (792 x 612 pt). All tables auto-size between left/right
    // margins and headers/right-aligned text use pageWidth dynamically, so
    // most sections adapt automatically. The only spots that needed manual
    // re-tuning were the map page (capped image height + right column) — see
    // notes there. Landscape gives the 6-column comp grid (~80pt label +
    // ~115pt per data col) and the 15-column appellant evidence table room
    // to breathe, and matches the BRT PowerComp photo packets we merge in.
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'letter'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 30;

    // Lojik blue color
    const lojikBlue = [0, 102, 204];

    // Load the LOJIK logo image
    let logoDataUrl = null;
    try {
      const response = await fetch('/lojik-logo.PNG');
      const blob = await response.blob();
      logoDataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('Could not load logo image for PDF:', err);
    }

    // Helper to add the LOJIK logo to PDF
    const addLogoToPage = (x, y) => {
      if (logoDataUrl) {
        // Add the actual logo image (height ~35pt, auto width to maintain aspect ratio)
        try {
          doc.addImage(logoDataUrl, 'PNG', x, y, 80, 35);
        } catch (err) {
          console.warn('Could not add logo to PDF:', err);
          // Fallback: draw text
          doc.setTextColor(...lojikBlue);
          doc.setFontSize(16);
          doc.setFont('helvetica', 'bold');
          doc.text('LOJIK', x, y + 20);
        }
      } else {
        // Fallback: draw LOJIK text if image failed to load
        doc.setTextColor(...lojikBlue);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('LOJIK', x, y + 20);
      }
    };

    // Add header with logo
    const addHeader = (blockLot, includeBlockLotRow = false) => {
      // Add the LOJIK logo image
      addLogoToPage(margin, margin - 5);

      // Appeal number above block/lot if present
      let headerY = margin + 10;
      if (appealNumber) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(`Appeal #: ${appealNumber}`, pageWidth - margin, headerY, { align: 'right' });
        headerY += 14;
      }

      // Block/Lot in top right
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(blockLot, pageWidth - margin, headerY + 10, { align: 'right' });

      // If this is page 2+, add Block/Lot/Qualifier row under header
      if (includeBlockLotRow) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        const blqText = `Block: ${subject.property_block} | Lot: ${subject.property_lot}${subject.property_qualifier ? ` | Qualifier: ${subject.property_qualifier}` : ''}`;
        doc.text(blqText, margin, margin + 45);
      }
    };

    const subjectBlockLot = `${subject.property_block}/${subject.property_lot}${subject.property_qualifier ? '/' + subject.property_qualifier : ''}`;
    addHeader(subjectBlockLot);

    // Prepare table data
    const visibleAttributes = allAttributes
      .filter(attr => rowVisibility[attr.id])
      .filter(attr => {
        // Mirror the on-screen filter: hide dynamic rows (barn / pole_barn / stable / land / misc)
        // when neither the subject nor any comp meets the criteria.
        if (!attr.isDynamic) return true;
        const subjectVal = attr.render(aggregatedSubject);
        if (subjectVal !== 'NONE') return true;
        for (let i = 0; i < aggregatedComps.length; i++) {
          if (aggregatedComps[i]) {
            const compVal = attr.render(aggregatedComps[i]);
            if (compVal !== 'NONE') return true;
          }
        }
        return false;
      });

    // Build headers with additional cards badge
    const subjectAdditionalCards = aggregatedSubject._additionalCardsCount || 0;
    const subjectHeader = subjectAdditionalCards > 0 ? `Subject (+${subjectAdditionalCards})` : 'Subject';

    const compHeaders = aggregatedComps.slice(0, 5).map((comp, idx) => {
      // Manual out-of-town comps render with an OUT OF TOWN label and the
      // user-entered street address (if provided) so the assessor / county
      // reviewer can identify the parcel without a Block/Lot.
      if (comp?.is_manual_comp) {
        const addr = (editableProperties[`comp_${idx}`]?.property_location || '').trim();
        return addr ? `OUT OF TOWN ${idx + 1}\n${addr}` : `OUT OF TOWN ${idx + 1}`;
      }
      const additionalCards = comp?._additionalCardsCount || 0;
      const baseLabel = `Comparable ${idx + 1}`;
      return additionalCards > 0 ? `${baseLabel} (+${additionalCards})` : baseLabel;
    });

    // Pad with empty comps if less than 5
    while (compHeaders.length < 5) {
      compHeaders.push(`Comparable ${compHeaders.length + 1}`);
    }

    const headers = [['VCS', subjectHeader, ...compHeaders]];

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
      if (!prop) return 'N/A';

      // For amenity area attributes, convert to Yes/No for PDF display
      const amenityAreaIds = [
        'deck_area', 'patio_area', 'open_porch_area', 'enclosed_porch_area',
        'pool_area', 'basement_area', 'fin_bsmt_area', 'ac_area'
      ];

      if (amenityAreaIds.includes(attr.id)) {
        let rawValue = null;
        switch(attr.id) {
          case 'deck_area': rawValue = prop.deck_area; break;
          case 'patio_area': rawValue = prop.patio_area; break;
          case 'open_porch_area': rawValue = prop.open_porch_area; break;
          case 'enclosed_porch_area': rawValue = prop.enclosed_porch_area; break;
          case 'pool_area': rawValue = prop.pool_area; break;
          case 'basement_area': rawValue = prop.basement_area; break;
          case 'fin_bsmt_area': rawValue = prop.fin_basement_area; break;
          case 'ac_area': rawValue = prop.ac_area; break;
          default: break;
        }
        return (rawValue !== null && rawValue !== undefined && rawValue > 0) ? 'Yes' : 'No';
      }

      return attr.render(prop);
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

          // Get adjustment from edited adjustments if available
          // If we have editedAdjustments for this comp, use those; otherwise use original
          let adj = null;
          if (editedAdjustments[compKey]) {
            // If we recalculated this comp, use the recalculated adjustments
            adj = editedAdjustments[compKey].adjustments?.find(a =>
              a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
            );
            // If no matching adjustment found in recalculated, create a zero adjustment
            // (it was removed because it became zero after recalculation)
            if (!adj && attr.adjustmentName) {
              adj = { name: attr.adjustmentName, amount: 0 };
            }
          } else {
            // No recalculation - use original adjustment
            adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
          }

          if (showAdjustments && adj && adj.amount !== 0) {
            const adjSign = adj.amount > 0 ? '+' : '-';
            const adjStr = `${adjSign}$${Math.abs(Math.round(adj.amount)).toLocaleString()}`;
            // Cell content stays as just the value (single-line, neutral
            // color). The adjustment is drawn on the right edge of the cell
            // in green/red by the didDrawCell hook below — that way every
            // body row is the same height and the adjustment sits inline
            // with the value rather than wrapping underneath it.
            row.push({ content: String(compVal), adjAmount: adj.amount, adjStr });
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
          // Store adjustment amount for coloring
          netRow.push({ content: `${sign}$${Math.round(total).toLocaleString()} (${sign}${pct.toFixed(0)}%)`, adjAmount: total });
        } else {
          netRow.push('-');
        }
      }
      staticRows.push(netRow);
    }

    // Add Adjusted Valuation row if visible and showing adjustments
    if (showAdjustments && rowVisibility['adjusted_valuation']) {
      const valRow = ['Adjusted Valuation'];
      // Subject gets projected assessment (use recalculated if available, otherwise original)
      const projectedValue = recalculatedProjectedAssessment || result.projectedAssessment;
      valRow.push(projectedValue ? `$${projectedValue.toLocaleString()}` : '-');
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
    autoTable(doc, {
      head: headers,
      body: staticRows,
      startY: margin + 50,
      margin: { left: margin, right: margin },
      // fontSize/cellPadding tightened so the full static attribute set
      // (~30 rows + Net Adjustment + Adjusted Valuation) fits on a single
      // landscape page. Same values mirrored on the dynamic table below
      // so the two pages look visually consistent.
      styles: {
        fontSize: 6.5,
        cellPadding: 2,
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
          // Net Adjustment is the one row where the cell *itself* is the
          // adjustment (no separate value to keep neutral) — color the text.
          const cellData = data.row.raw?.[data.column.index];
          if (cellData && typeof cellData === 'object' && cellData.adjAmount !== undefined) {
            if (cellData.adjAmount > 0) data.cell.styles.textColor = [34, 139, 34];
            else if (cellData.adjAmount < 0) data.cell.styles.textColor = [220, 20, 60];
          }
        }
        // Style Adjusted Valuation row
        if (data.row.raw && data.row.raw[0] === 'Adjusted Valuation') {
          data.cell.styles.fillColor = [200, 230, 255];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      willDrawCell: function(data) {
        // Cell content for value-with-adjustment cells is just the value
        // string; the adjustment is overlaid in didDrawCell. Net Adjustment
        // and Adjusted Valuation rows already store their full string in
        // cellData.content and need it unwrapped here.
        const cellData = data.row.raw?.[data.column.index];
        if (cellData && typeof cellData === 'object' && cellData.content) {
          data.cell.text = [cellData.content];
        }
      },
      didDrawCell: function(data) {
        // Paint the adjustment to the right of the cell value in green/red.
        // Skip for the Net Adjustment row (its cell content already IS the
        // adjustment) and the header row.
        if (data.section !== 'body') return;
        const rawRow = data.row.raw;
        if (!rawRow || rawRow[0] === 'Net Adjustment' || rawRow[0] === 'Adjusted Valuation') return;
        const cellData = rawRow[data.column.index];
        if (!cellData || typeof cellData !== 'object' || !cellData.adjStr) return;
        const color = cellData.adjAmount > 0 ? [34, 139, 34] : [220, 20, 60];
        const prevSize = doc.getFontSize();
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...color);
        doc.text(
          cellData.adjStr,
          data.cell.x + data.cell.width - 3,
          data.cell.y + data.cell.height / 2 + 2,
          { align: 'right' }
        );
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(prevSize);
      }
    });

    // Page 2: Dynamic adjustments (if any exist and are visible)
    if (dynamicAttrs.length > 0) {
      doc.addPage();
      addHeader(subjectBlockLot, true); // Include Block/Lot/Qualifier row on page 2

      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text('Dynamic Adjustments', margin, margin + 55);

      // ✅ FILTER: Only show dynamic attributes that have actual values
      // (not "NONE" for subject or all comparables)
      const relevantDynamicAttrs = dynamicAttrs.filter(attr => {
        const subjectVal = attr.render(subject);

        // Check if subject has a non-NONE value
        if (subjectVal !== 'NONE') return true;

        // Check if any comparable has a non-NONE value
        for (let i = 0; i < comps.length; i++) {
          if (comps[i]) {
            const compVal = attr.render(comps[i]);
            if (compVal !== 'NONE') return true;
          }
        }

        return false; // All values are NONE - hide this row
      });

      // Build dynamic rows using filtered attributes
      const dynamicRows = relevantDynamicAttrs.map(attr => {
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

            // Get adjustment from edited adjustments if available
            // If we have editedAdjustments for this comp, use those; otherwise use original
            let adj = null;
            if (editedAdjustments[compKey]) {
              // If we recalculated this comp, use the recalculated adjustments
              adj = editedAdjustments[compKey].adjustments?.find(a =>
                a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
              );
              // If no matching adjustment found in recalculated, create a zero adjustment
              // (it was removed because it became zero after recalculation)
              if (!adj && attr.adjustmentName) {
                adj = { name: attr.adjustmentName, amount: 0 };
              }
            } else {
              // No recalculation - use original adjustment
              adj = attr.adjustmentName ? getAdjustment(comp, attr.adjustmentName) : null;
            }

            if (showAdjustments && adj && adj.amount !== 0) {
              const adjSign = adj.amount > 0 ? '+' : '-';
              const adjStr = `${adjSign}$${Math.abs(Math.round(adj.amount)).toLocaleString()}`;
              // Same single-line + right-overlay pattern as the static page.
              row.push({ content: String(compVal), adjAmount: adj.amount, adjStr });
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
            netRow.push({ content: `${sign}$${Math.round(total).toLocaleString()} (${sign}${pct.toFixed(0)}%)`, adjAmount: total });
          } else {
            netRow.push('-');
          }
        }
        dynamicRows.push(netRow);
      }

      if (showAdjustments && rowVisibility['adjusted_valuation']) {
        const valRow = ['Adjusted Valuation'];
        const projectedValue = recalculatedProjectedAssessment || result.projectedAssessment;
        valRow.push(projectedValue ? `$${projectedValue.toLocaleString()}` : '-');
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

      // Only render the table if there are relevant dynamic attributes
      if (relevantDynamicAttrs.length > 0) {
        autoTable(doc, {
          head: headers,
          body: dynamicRows,
          startY: margin + 65,
          margin: { left: margin, right: margin },
          // Mirror the static-grid sizing so the two pages render with the
          // same row density and visual rhythm.
          styles: {
            fontSize: 6.5,
            cellPadding: 2,
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
              const cellData = data.row.raw?.[data.column.index];
              if (cellData && typeof cellData === 'object' && cellData.adjAmount !== undefined) {
                if (cellData.adjAmount > 0) data.cell.styles.textColor = [34, 139, 34];
                else if (cellData.adjAmount < 0) data.cell.styles.textColor = [220, 20, 60];
              }
            }
            if (data.row.raw && data.row.raw[0] === 'Adjusted Valuation') {
              data.cell.styles.fillColor = [200, 230, 255];
              data.cell.styles.fontStyle = 'bold';
            }
          },
          willDrawCell: function(data) {
            const cellData = data.row.raw?.[data.column.index];
            if (cellData && typeof cellData === 'object' && cellData.content) {
              data.cell.text = [cellData.content];
            }
          },
          didDrawCell: function(data) {
            if (data.section !== 'body') return;
            const rawRow = data.row.raw;
            if (!rawRow || rawRow[0] === 'Net Adjustment' || rawRow[0] === 'Adjusted Valuation') return;
            const cellData = rawRow[data.column.index];
            if (!cellData || typeof cellData !== 'object' || !cellData.adjStr) return;
            const color = cellData.adjAmount > 0 ? [34, 139, 34] : [220, 20, 60];
            const prevSize = doc.getFontSize();
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...color);
            doc.text(
              cellData.adjStr,
              data.cell.x + data.cell.width - 3,
              data.cell.y + data.cell.height / 2 + 2,
              { align: 'right' }
            );
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(prevSize);
          }
        });
      }
    }

    // ==================== APPELLANT EVIDENCE SUMMARY PAGE ====================
    // Rendered after the appraisal grid (and any dynamic-adjustment pages) and
    // before Chapter 123. Only added if an appeal_log row exists for this subject.
    // If the appeal exists but no appellant_comps are saved, we still render the
    // page with a "No Evidence supplied by Appellant" line so the report shows
    // that fact explicitly. User can suppress entirely via the export modal toggle.
    try {
      const compositeKey = subject?.property_composite_key;
      if (!hideAppellantEvidence && compositeKey && jobData?.id) {
        const { data: appealRow } = await supabase
          .from('appeal_log')
          .select('id, appeal_number, appeal_year, property_block, property_lot, property_qualifier, property_location, appellant_comps, farm_mode')
          .eq('job_id', jobData.id)
          .eq('property_composite_key', compositeKey)
          .maybeSingle();

        if (appealRow) {
          doc.addPage();
          addHeader(subjectBlockLot, true);

          let evY = margin + 60;
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...lojikBlue);
          doc.text('Appellant Evidence Summary', margin, evY);
          evY += 18;

          doc.setFontSize(10);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(60, 60, 60);
          const appealLine = `Appeal #${appealRow.appeal_number || '(pending)'}  \u00b7  Block ${appealRow.property_block || subject.property_block} Lot ${appealRow.property_lot || subject.property_lot}${(appealRow.property_qualifier || subject.property_qualifier) ? ` Qual ${appealRow.property_qualifier || subject.property_qualifier}` : ''}  \u00b7  ${appealRow.property_location || subject.property_location || ''}`;
          doc.text(appealLine, margin, evY);
          evY += 16;

          // Director's ratio (no 100% cap for FMV-by-Ratio display)
          let evRatioDecimal = null;
          let evRatioSource = 'none';
          if (jobData?.director_ratio) {
            let r = parseFloat(jobData.director_ratio);
            if (Number.isFinite(r) && r > 0) {
              if (r > 1) r = r / 100;
              evRatioDecimal = r;
              evRatioSource = "Director's";
            }
          }
          if (evRatioDecimal === null && marketLandData?.normalization_config?.equalizationRatio) {
            let r = parseFloat(marketLandData.normalization_config.equalizationRatio);
            if (Number.isFinite(r) && r > 0) {
              if (r > 1) r = r / 100;
              evRatioDecimal = r;
              evRatioSource = 'Equalization';
            }
          }
          // Load Current Assessment source preference (synced with Detailed and Search & Results).
          let evAssmtSource = 'mod';
          try {
            const { data: srcRow } = await supabase
              .from('job_settings')
              .select('setting_value')
              .eq('job_id', jobData.id)
              .eq('setting_key', 'current_assessment_source')
              .maybeSingle();
            if (srcRow?.setting_value === 'cama' || srcRow?.setting_value === 'mod') {
              evAssmtSource = srcRow.setting_value;
            }
          } catch (e) { /* default to mod */ }
          const subjAssmtRaw = evAssmtSource === 'cama'
            ? (subject?.values_cama_total ?? subject?.values_mod_total ?? null)
            : (subject?.values_mod_total ?? subject?.values_cama_total ?? null);
          const fmvByRatio = (subjAssmtRaw && evRatioDecimal)
            ? Math.round(Number(subjAssmtRaw) / evRatioDecimal)
            : null;

          const currentAsmt = subjAssmtRaw
            ? `$${Number(subjAssmtRaw).toLocaleString()} (${evAssmtSource.toUpperCase()})`
            : '\u2014';
          const fmvStr = fmvByRatio ? `$${fmvByRatio.toLocaleString()}` : '\u2014';
          const ratioStr = evRatioDecimal ? `${(evRatioDecimal * 100).toFixed(2)}% ${evRatioSource}` : 'n/a';
          doc.setFontSize(9);
          doc.setTextColor(40, 40, 40);
          doc.text(`Current Assessment: ${currentAsmt}    FMV by Ratio: ${fmvStr}    Ratio: ${ratioStr}`, margin, evY);
          evY += 14;

          const appellantComps = Array.isArray(appealRow.appellant_comps) ? appealRow.appellant_comps : [];

          if (appellantComps.length === 0) {
            doc.setFontSize(11);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(150, 30, 30);
            doc.text('No Evidence supplied by Appellant.', margin, evY + 16);
          } else {
            const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();
            const findCompProperty = (b0, l0, q0, c0) => {
              if (!b0 || !l0) return null;
              const b = norm(b0), l = norm(l0), q = norm(q0), c = norm(c0);
              return (allProperties || []).find(p => {
                if (norm(p.property_block) !== b) return false;
                if (norm(p.property_lot) !== l) return false;
                if (norm(p.property_qualifier) !== q) return false;
                if (c && norm(p.property_addl_card || p.property_card) !== c) return false;
                return true;
              }) || null;
            };
            const decodeField = (property, field) => {
              if (!property || !codeDefinitions) return property?.[field] || '';
              try {
                const decoded = vendorType === 'Microsystems'
                  ? interpretCodes.getMicrosystemsValue?.(property, codeDefinitions, field)
                  : interpretCodes.getBRTValue?.(property, codeDefinitions, field);
                return decoded || property[field] || '';
              } catch (e) { return property[field] || ''; }
            };
            const codeWithName = (property, field) => {
              const code = property?.[field];
              if (!code) return '\u2014';
              const decoded = decodeField(property, field);
              if (!decoded || String(decoded).trim().toUpperCase() === String(code).trim().toUpperCase()) return String(code);
              return `${code}-${decoded}`;
            };
            const lotDisplay = (p) => {
              if (!p) return '\u2014';
              // Farm-mode: use combined 3A+3B acreage so PDF matches Detailed.
              // Mirrors the lot_size_acre attribute render and SalesComparisonTab's
              // farm-package logic; see Bug 1 (Bethlehem) for context.
              if (compFilters?.farmSalesMode && p._pkg?.is_farm_package && p._pkg?.combined_lot_acres > 0) {
                return `${parseFloat(p._pkg.combined_lot_acres).toFixed(2)} ac (Farm)`;
              }
              if (p.asset_lot_acre && parseFloat(p.asset_lot_acre) > 0) return `${parseFloat(p.asset_lot_acre).toFixed(2)} ac`;
              if (p.market_manual_lot_acre && parseFloat(p.market_manual_lot_acre) > 0) return `${parseFloat(p.market_manual_lot_acre).toFixed(2)} ac`;
              if (p.asset_lot_sf && parseFloat(p.asset_lot_sf) > 0) return `${parseInt(p.asset_lot_sf, 10).toLocaleString()} sf`;
              if (p.market_manual_lot_sf && parseFloat(p.market_manual_lot_sf) > 0) return `${parseInt(p.market_manual_lot_sf, 10).toLocaleString()} sf`;
              if (p.asset_lot_frontage && parseFloat(p.asset_lot_frontage) > 0) return `${parseFloat(p.asset_lot_frontage).toFixed(0)} ff`;
              try {
                const ac = parseFloat(interpretCodes.getCalculatedAcreage(p, vendorType));
                if (ac > 0) return `${ac.toFixed(2)} ac`;
              } catch (e) {}
              return '\u2014';
            };

            // Mirror AppellantEvidencePanel's sample-range math EXACTLY so
            // the PDF doesn't paint sale dates red when the on-screen panel
            // shows them green. For Lojik (assessor) tenants the assessment
            // year is end_date.year - 1.
            const sampleRange = (() => {
              if (!jobData?.end_date) return { start: '', end: '' };
              const rawYear = new Date(jobData.end_date).getFullYear();
              const isLojikTenant = tenantConfig?.orgType === 'assessor';
              const assessmentYear = isLojikTenant ? rawYear - 1 : rawYear;
              return {
                start: new Date(assessmentYear - 1, 9, 1).toISOString().split('T')[0],
                end: new Date(assessmentYear, 9, 31).toISOString().split('T')[0]
              };
            })();
            const landMethod = marketLandData?.land_method || marketLandData?.valuation_mode || marketLandData?.cascade_rates?.mode || 'ac';
            const farmMode = !!appealRow.farm_mode;

            const evalHeader = [['#', 'Block', 'Lot', 'Qual', 'Card', 'Sale Date', 'Sale Price', 'NU', 'VCS', 'Design', 'T&U', 'Cond', 'YrBuilt', 'SFLA', 'Lot Size']];
            const subjRow = [
              'SUBJ',
              subject.property_block || '',
              subject.property_lot || '',
              subject.property_qualifier || '',
              subject.property_addl_card || subject.property_card || '\u2014',
              subject.sales_date ? new Date(subject.sales_date).toISOString().split('T')[0] : '\u2014',
              subject.sales_price ? `$${Number(subject.sales_price).toLocaleString()}` : '\u2014',
              subject.sales_nu || '\u2014',
              subject.new_vcs || subject.property_vcs || '\u2014',
              codeWithName(subject, 'asset_design_style'),
              codeWithName(subject, 'asset_type_use'),
              codeWithName(subject, 'asset_int_cond'),
              subject.asset_year_built || '\u2014',
              subject.asset_sfla || '\u2014',
              lotDisplay(subject)
            ];
            const evaluations = appellantComps.map(slot => {
              const compProp = findCompProperty(slot.block, slot.lot, slot.qualifier, slot.card);
              const evalResult = evaluateAppellantComp(subject, compProp, slot, { vendorType, landMethod, sampleRange, farmMode });
              return { slot, compProp, evalResult };
            });
            // For manual (out-of-town) rows, decode dropdown codes through the
            // same code-definitions path used for matched properties so the PDF
            // shows "code-label" instead of just the raw code.
            const manualCodeWithName = (code, field) => {
              if (!code) return '\u2014';
              const synthetic = { [field]: code };
              const decoded = decodeField(synthetic, field);
              if (!decoded || String(decoded).trim().toUpperCase() === String(code).trim().toUpperCase()) return String(code);
              return `${code}-${decoded}`;
            };
            const compRows = evaluations.map(({ slot, compProp }, i) => {
              if (slot.is_manual) {
                const addr = slot.manual_address ? String(slot.manual_address).toUpperCase() : 'OUT OF TOWN';
                const lotSize = slot.manual_lot_size || '\u2014';
                return [
                  `#${i + 1}`,
                  // BLQ collapses into a single "OOT — address" cell across cols 1-3
                  addr, '', '',
                  slot.card || '\u2014',
                  slot.sales_date || '\u2014',
                  slot.sales_price ? `$${Number(slot.sales_price).toLocaleString()}` : '\u2014',
                  slot.sales_nu || '\u2014',
                  slot.manual_vcs || '\u2014',
                  manualCodeWithName(slot.manual_design, 'asset_design_style'),
                  manualCodeWithName(slot.manual_type_use, 'asset_type_use'),
                  manualCodeWithName(slot.manual_condition, 'asset_int_cond'),
                  slot.manual_year_built || '\u2014',
                  slot.manual_sfla || '\u2014',
                  lotSize
                ];
              }
              return [
                `#${i + 1}`,
                slot.block || (compProp?.property_block || ''),
                slot.lot || (compProp?.property_lot || ''),
                slot.qualifier || (compProp?.property_qualifier || ''),
                slot.card || (compProp?.property_addl_card || compProp?.property_card || '\u2014'),
                slot.sales_date || (compProp?.sales_date ? new Date(compProp.sales_date).toISOString().split('T')[0] : '\u2014'),
                (slot.sales_price || compProp?.sales_price) ? `$${Number(slot.sales_price || compProp.sales_price).toLocaleString()}` : '\u2014',
                slot.sales_nu || compProp?.sales_nu || '\u2014',
                compProp ? (compProp.new_vcs || compProp.property_vcs || '\u2014') : '\u2014',
                compProp ? codeWithName(compProp, 'asset_design_style') : '\u2014',
                compProp ? codeWithName(compProp, 'asset_type_use') : '\u2014',
                compProp ? codeWithName(compProp, 'asset_int_cond') : '\u2014',
                compProp?.asset_year_built || '\u2014',
                compProp?.asset_sfla || '\u2014',
                lotDisplay(compProp)
              ];
            });

            // Map PDF column index → evalResult.flags key. PDF columns now
            // mirror the on-screen modal (including the Card column) so the
            // color heat-map lines up 1:1 with what reviewers saw in the UI.
            // null = column has no evidence-evaluation flag and stays uncolored.
            const COL_TO_FLAG = [
              null,         // 0: #
              null,         // 1: Block
              null,         // 2: Lot
              null,         // 3: Qual
              'card',       // 4: Card
              'sale_date',  // 5
              'sale_price', // 6
              'sale_nu',    // 7
              'vcs',        // 8
              'design',     // 9
              'type_use',   // 10
              'condition',  // 11
              'year_built', // 12
              'sfla',       // 13
              'lot_size'    // 14
            ];
            // Same pastel hexes used in the panel UI (Tailwind {color}-100).
            const COLOR_FILL = {
              green:  [220, 252, 231],
              yellow: [254, 249, 195],
              red:    [254, 226, 226]
            };

            autoTable(doc, {
              startY: evY + 10,
              head: evalHeader,
              body: [subjRow, ...compRows],
              theme: 'grid',
              styles: { fontSize: 7, cellPadding: 2 },
              headStyles: { fillColor: lojikBlue, textColor: 255, fontStyle: 'bold' },
              didParseCell: (data) => {
                if (data.section !== 'body') return;
                // Subject row (index 0): light blue, bold — preserves prior behavior.
                if (data.row.index === 0) {
                  data.cell.styles.fillColor = [219, 234, 254];
                  data.cell.styles.fontStyle = 'bold';
                  return;
                }
                // Comp rows: paint each cell with its evaluator color flag.
                const compIdx = data.row.index - 1;
                const evalResult = evaluations[compIdx]?.evalResult;
                if (!evalResult || !evalResult.resolved) return;
                const flagKey = COL_TO_FLAG[data.column.index];
                if (!flagKey) return;
                const color = evalResult.flags[flagKey]?.color;
                const fill = COLOR_FILL[color];
                if (fill) data.cell.styles.fillColor = fill;
              },
              margin: { left: margin, right: margin }
            });

            let commentsY = doc.lastAutoTable.finalY + 16;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text('Notes', margin, commentsY);
            commentsY += 12;

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(40, 40, 40);

            if (subject?.sales_date && subject?.sales_price) {
              const saleDt = new Date(subject.sales_date);
              const price = Number(subject.sales_price);
              if (!Number.isNaN(saleDt.getTime()) && Number.isFinite(price) && price > 100) {
                const apYear = parseInt(appealRow.appeal_year, 10) || new Date().getFullYear();
                const subjStart = new Date(`${apYear - 2}-10-01`);
                const subjEnd = new Date(`${apYear - 1}-10-31`);
                const outside = saleDt < subjStart || saleDt > subjEnd;
                const dateStr = `${String(saleDt.getMonth() + 1).padStart(2, '0')}/${String(saleDt.getDate()).padStart(2, '0')}/${saleDt.getFullYear()}`;
                const nuRaw = (subject.sales_nu == null ? '' : String(subject.sales_nu)).trim();
                const nuLabel = (!nuRaw || nuRaw === '0' || nuRaw === '00')
                  ? "ARM'S LENGTH"
                  : (getNuShortForm(nuRaw) || `NU ${nuRaw}`).toUpperCase();
                const prefix = outside ? 'SUBJECT SOLD OUTSIDE SAMPLING PERIOD' : 'SUBJECT SOLD';
                doc.setFont('helvetica', 'bold');
                doc.text(`${prefix} ${dateStr} FOR $${price.toLocaleString()} \u2014 ${nuLabel}`, margin, commentsY);
                doc.setFont('helvetica', 'normal');
                commentsY += 12;
              }
            }

            evaluations.forEach(({ slot, evalResult }, i) => {
              const has = slot.block || slot.lot || slot.sales_date || slot.sales_price || slot.is_manual || slot.manual_address;
              if (!has) return;
              const oot = slot.is_manual
                ? `OUT OF TOWN${slot.manual_address ? ` (${String(slot.manual_address).toUpperCase()})` : ''} \u2014 `
                : '';
              const note = `APPELLANT COMP#${i + 1} \u2014 ${oot}${evalResult.autoNote}${slot.manual_notes ? ` \u2014 ${slot.manual_notes}` : ''}`;
              const wrapped = doc.splitTextToSize(note, doc.internal.pageSize.getWidth() - 2 * margin);
              doc.text(wrapped, margin, commentsY);
              commentsY += wrapped.length * 10;
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to render appellant evidence summary page:', e);
    }

    // ==================== CHAPTER 123 TEST ====================
    // Add Chapter 123 Analysis on a new page. User can suppress entirely via the
    // export modal toggle (used when assessor doesn't want the taxpayer to see a
    // huge ratio swing before settling).
    if (!hideDirectorsRatio) {
    doc.addPage();
    addHeader(subjectBlockLot, true);

    const ch123StartY = margin + 60;

    doc.setFontSize(14);
    doc.setTextColor(...lojikBlue);
    doc.setFont('helvetica', 'bold');
    doc.text('Chapter 123 Test', margin, ch123StartY);

    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.text('N.J.S.A. 54:51A-6 — Common Level Range Analysis', margin, ch123StartY + 16);

    // Gather data for the Chapter 123 test
    const currentAssessment = subject.values_mod4_total || subject.values_mod_total || subject.values_cama_total || 0;
    const projectedValue = (recalculatedProjectedAssessment || result.projectedAssessment) || 0;

    // Get comparable adjusted prices for the weighted average
    const compAdjustedPrices = [];
    for (let i = 0; i < 5; i++) {
      const comp = comps[i];
      const compKey = `comp_${i}`;
      if (comp) {
        const compData = editedAdjustments[compKey] || comp;
        const adjPrice = compData.adjustedPrice || 0;
        if (adjPrice > 0) compAdjustedPrices.push(adjPrice);
      }
    }

    const avgAdjustedPrice = compAdjustedPrices.length > 0
      ? compAdjustedPrices.reduce((a, b) => a + b, 0) / compAdjustedPrices.length
      : 0;
    const medianAdjustedPrice = compAdjustedPrices.length > 0
      ? [...compAdjustedPrices].sort((a, b) => a - b)[Math.floor(compAdjustedPrices.length / 2)]
      : 0;

    // Calculate Assessment-to-Value ratio
    const assessmentRatio = projectedValue > 0 ? (currentAssessment / projectedValue) : 0;

    // Chapter 123 thresholds: Common Level Range is Director's Ratio +/- 15%
    // Use job-level director_ratio if saved, fallback to equalization ratio from normalization, cap at 100%
    let directorsRatio = 1.0;
    if (jobData?.director_ratio) {
      directorsRatio = parseFloat(jobData.director_ratio);
      // If stored as percentage (e.g. 98.5), convert to decimal
      if (directorsRatio > 1) directorsRatio = directorsRatio / 100;
    } else if (marketLandData?.normalization_config?.equalizationRatio) {
      directorsRatio = parseFloat(marketLandData.normalization_config.equalizationRatio);
      // If stored as percentage (e.g. 107.29), convert to decimal
      if (directorsRatio > 1) directorsRatio = directorsRatio / 100;
    }
    // Cap at 100% — cannot exceed
    directorsRatio = Math.min(directorsRatio, 1.0);
    const upperLimit = directorsRatio * 1.15;
    const lowerLimit = directorsRatio * 0.85;

    // Hard cap: Assessment ratio cannot exceed 100% (1.0), regardless of director ratio
    const effectiveUpperLimit = Math.min(upperLimit, 1.0);

    const ch123Pass = assessmentRatio <= effectiveUpperLimit;
    const exceedsBy = assessmentRatio > effectiveUpperLimit
      ? ((assessmentRatio - effectiveUpperLimit) * 100).toFixed(1)
      : 0;

    // Build Chapter 123 summary table
    const ch123Rows = [
      ['Current Assessment', currentAssessment > 0 ? `$${currentAssessment.toLocaleString()}` : 'N/A'],
      ['CME Projected Value', projectedValue > 0 ? `$${Math.round(projectedValue).toLocaleString()}` : 'N/A'],
      ['Avg. Adjusted Price (Comps)', avgAdjustedPrice > 0 ? `$${Math.round(avgAdjustedPrice).toLocaleString()}` : 'N/A'],
      ['Median Adjusted Price (Comps)', medianAdjustedPrice > 0 ? `$${Math.round(medianAdjustedPrice).toLocaleString()}` : 'N/A'],
      ['Assessment-to-Value Ratio', assessmentRatio > 0 ? `${(assessmentRatio * 100).toFixed(2)}%` : 'N/A'],
      ["Director's Ratio", `${(directorsRatio * 100).toFixed(2)}%`],
      ['Common Level Range (Upper)', `${(effectiveUpperLimit * 100).toFixed(2)}%`],
      ['Common Level Range (Lower)', `${(lowerLimit * 100).toFixed(2)}%`],
      ['Chapter 123 Result', ch123Pass ? 'WITHIN RANGE' : `EXCEEDS by ${exceedsBy}%`]
    ];

    autoTable(doc, {
      body: ch123Rows,
      startY: ch123StartY + 28,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        fontSize: 9,
        cellPadding: 6,
        lineColor: [200, 200, 200],
        lineWidth: 0.5
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 220, fillColor: [245, 247, 250] },
        1: { halign: 'center', cellWidth: 180 }
      },
      didParseCell: function(data) {
        // Highlight the result row
        if (data.row.index === ch123Rows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize = 10;
          if (data.column.index === 1) {
            if (ch123Pass) {
              data.cell.styles.textColor = [34, 139, 34];
              data.cell.styles.fillColor = [230, 255, 230];
            } else {
              data.cell.styles.textColor = [220, 20, 60];
              data.cell.styles.fillColor = [255, 230, 230];
            }
          }
        }
        // Highlight ratio row
        if (data.row.index === 4 && data.column.index === 1) {
          data.cell.styles.fontStyle = 'bold';
          if (assessmentRatio > effectiveUpperLimit) {
            data.cell.styles.textColor = [220, 20, 60];
          } else if (assessmentRatio < lowerLimit) {
            data.cell.styles.textColor = [200, 150, 0];
          } else {
            data.cell.styles.textColor = [34, 139, 34];
          }
        }
      }
    });

    // Add explanatory note
    const ch123TableEndY = doc.lastAutoTable.finalY + 20;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.setFont('helvetica', 'italic');
    doc.text(
      'Under N.J.S.A. 54:51A-6, a property assessment is presumed valid if it falls within the Common Level Range',
      margin,
      ch123TableEndY
    );
    doc.text(
      "(Director's Ratio +/- 15%). If the ratio exceeds the upper limit, the taxpayer may have grounds for appeal.",
      margin,
      ch123TableEndY + 12
    );
    } // end !hideDirectorsRatio

    // ============== Subject + Comps Map page (optional) ==============
    if (includeMap && mapHasSubject && mapCaptureRef.current) {
      try {
        // Wait one tick so any tile loads in the DOM are flushed before capture
        await new Promise((resolve) => setTimeout(resolve, 700));
        const canvas = await html2canvas(mapCaptureRef.current, {
          useCORS: true,
          allowTaint: false,
          scale: 2,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const mapImg = canvas.toDataURL('image/png');

        doc.addPage();
        // Use the same LOJIK header (logo + Appeal # + Block/Lot) as every
        // other page so batch-printed packets always carry orientation info.
        addHeader(subjectBlockLot);
        doc.setFontSize(14);
        doc.setTextColor(...lojikBlue);
        doc.setFont('helvetica', 'bold');
        doc.text('Subject & Comps Location Map', pageWidth / 2, 70, { align: 'center' });

        // Two-column layout: map on the left, info column on the right.
        // Landscape letter is 792 x 612 pt, so we cap mapH at ~430pt to
        // leave room for the attribution line below the map (and to keep
        // the map from looking absurdly tall vs its width). Right column
        // widened slightly so longer comp addresses don't wrap as often.
        const pageHeight = doc.internal.pageSize.getHeight();
        const topY = 95;
        const colGap = 14;
        const rightColW = 230;
        const mapW = pageWidth - margin * 2 - colGap - rightColW;
        const ratio = canvas.width / canvas.height;
        const maxMapH = Math.max(280, pageHeight - topY - 60);
        const mapH = Math.min(mapW / ratio, maxMapH);
        doc.addImage(mapImg, 'PNG', margin, topY, mapW, mapH);

        // Right column: subject + comp list with distances
        const rightX = margin + mapW + colGap;
        let cursorY = topY;

        // Subject card
        doc.setFillColor(220, 38, 38);
        doc.circle(rightX + 7, cursorY + 7, 6, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('S', rightX + 7, cursorY + 9, { align: 'center' });

        doc.setTextColor(20, 20, 20);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('SUBJECT', rightX + 18, cursorY + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const subjBlq = `Block ${subject?.property_block || ''}/${subject?.property_lot || ''}${subject?.property_qualifier ? '/' + subject.property_qualifier : ''}`;
        doc.text(subjBlq, rightX + 18, cursorY + 16);
        const subjAddrLines = doc.splitTextToSize(subject?.property_location || '', rightColW - 22);
        doc.text(subjAddrLines, rightX + 18, cursorY + 25);
        cursorY += 26 + (subjAddrLines.length - 1) * 9 + 8;

        // Helper to draw a comp/appellant card in the right column with a
        // colored circular badge. Returns the new cursorY (or null if it
        // wouldn't fit).
        const drawCard = (c, fillRGB, badgeLabel, titlePrefix) => {
          const addrLines = doc.splitTextToSize(c.address || '', rightColW - 22);
          const cardH = 26 + (addrLines.length - 1) * 9;
          if (cursorY + cardH > topY + mapH + 30) return false;

          doc.setFillColor(...fillRGB);
          doc.circle(rightX + 7, cursorY + 7, 6, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(badgeLabel.length > 1 ? 7 : 8);
          doc.setFont('helvetica', 'bold');
          doc.text(badgeLabel, rightX + 7, cursorY + 9, { align: 'center' });

          doc.setTextColor(20, 20, 20);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          const titleLine = `${titlePrefix}${c.miles != null ? `  ·  ${c.miles.toFixed(1)} mi` : ''}`;
          doc.text(titleLine, rightX + 18, cursorY + 6);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          const compBlq = `Block ${c.block || ''}/${c.lot || ''}${c.qualifier ? '/' + c.qualifier : ''}`;
          doc.text(compBlq, rightX + 18, cursorY + 16);
          doc.text(addrLines, rightX + 18, cursorY + 25);
          cursorY += cardH + 6;
          return true;
        };

        // Comp cards (blue)
        compDistances.forEach((c) => {
          drawCard(c, [37, 99, 235], String(c.rank), `COMP ${c.rank}`);
        });

        // Appellant comp cards (orange) — separated by a thin label
        if (appellantDistances.length > 0) {
          if (cursorY + 18 < topY + mapH + 30) {
            doc.setDrawColor(220, 220, 220);
            doc.line(rightX, cursorY, rightX + rightColW, cursorY);
            cursorY += 8;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(194, 65, 12);
            doc.text('APPELLANT COMPS', rightX, cursorY);
            cursorY += 10;
          }
          appellantDistances.forEach((c) => {
            drawCard(c, [234, 88, 12], `A${c.rank}`, `APPELLANT ${c.rank}`);
          });
        }

        // Attribution under map
        const footerY = topY + mapH + 16;
        doc.setFontSize(7);
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'normal');
        doc.text(
          'Map data © OpenStreetMap contributors. Distances are straight-line (Haversine) from subject. Coordinates from U.S. Census Bureau geocoder, manual verification, or mother-lot inheritance.',
          margin,
          footerY,
          { maxWidth: mapW }
        );
      } catch (mapErr) {
        // Map capture failure is non-fatal — PDF still saves without it.
        // eslint-disable-next-line no-console
        console.warn('Map capture failed:', mapErr);
      }
    }

    // ============== Subject & Comps Photos page (optional) ==============
    // Pulls picked front photos from `appeal_photos` for every parcel in
    // photoStripParcels. One image per parcel, captioned with role + address.
    // Skipped silently if includePhotos is off, no jobId, no parcels, or
    // every parcel returns nothing (so we don't emit a blank page).
    if (includePhotos && jobData?.id && photoStripParcels.length > 0) {
      try {
        const keys = photoStripParcels.map((p) => p.composite_key).filter(Boolean);
        const { data: photoRows } = await supabase
          .from('appeal_photos')
          .select('storage_path, property_composite_key, original_filename, capture_ts')
          .eq('job_id', jobData.id)
          .in('property_composite_key', keys);
        const photoByKey = {};
        (photoRows || []).forEach((r) => { photoByKey[r.property_composite_key] = r; });
        const parcelsWithPhotos = photoStripParcels.filter((p) => photoByKey[p.composite_key]);

        if (parcelsWithPhotos.length > 0) {
          // Download each picked photo and convert to data URL for jsPDF
          const photoCells = await Promise.all(parcelsWithPhotos.map(async (p) => {
            const row = photoByKey[p.composite_key];
            try {
              const { data: blob } = await supabase.storage
                .from('appeal-photos')
                .download(row.storage_path);
              if (!blob) return null;
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { parcel: p, dataUrl };
            } catch (_e) {
              return null;
            }
          }));
          const usable = photoCells.filter(Boolean);

          // Split into subject + comps. Subject is always first in
          // photoStripParcels (see the useMemo above). If subject has no
          // photo, we still paginate by comps with subject row left blank
          // — but in practice a Photos page with no subject is almost
          // never useful, so we just skip in that case.
          const subjectCell = usable.find((u) => u.parcel.roleLabel === 'SUBJECT') || null;
          const compCells = usable.filter((u) => u.parcel.roleLabel !== 'SUBJECT');

          if (subjectCell || compCells.length > 0) {
            // Legacy PowerComp packet layout, faithfully ported:
            //   - landscape letter (792 x 612 pt)
            //   - margin 36, header band 56, footer band 22
            //   - subject sits on top row, centered, capped to a landscape
            //     aspect so a 4:3 home photo fills the cell
            //   - comps sit on a single row below, 3 per page max
            //   - 4 or 5 comps => second page repeats the subject on top
            //     and shows comps 4 (and 5) below
            const blqLabel = subjectBlockLot;
            const PAGE_W = 792;
            const PAGE_H = 612;
            const lMargin = 36;
            const headerH = 56;
            const footerH = 22;
            const captionGap = 4;
            const captionH = 12;
            const cellPad = 2;
            const rowGap = 14;
            const colGap = 14;

            const contentTop = lMargin + headerH;
            const contentBottom = PAGE_H - lMargin - footerH;
            const contentH = contentBottom - contentTop;
            const contentW = PAGE_W - lMargin * 2;

            const subjRowH = Math.floor((contentH - rowGap) * 0.46);
            const compRowH = contentH - rowGap - subjRowH;
            const subjPhotoH = subjRowH - captionGap - captionH - cellPad * 2;
            const compPhotoH = compRowH - captionGap - captionH - cellPad * 2;

            const subjPhotoW = Math.min(contentW * 0.75, subjPhotoH * 1.5);
            const subjCellW = subjPhotoW + cellPad * 2;
            const subjCellH = subjPhotoH + cellPad * 2;
            const subjX = lMargin + (contentW - subjCellW) / 2;
            const subjY = contentTop;

            const compPhotoW = (contentW - colGap * 2) / 3 - cellPad * 2;
            const compCellW = compPhotoW + cellPad * 2;
            const compsY = contentTop + subjRowH + rowGap;

            const drawPhotoPageHeader = () => {
              addLogoToPage(lMargin, lMargin - 5);
              let hY = lMargin + 10;
              if (appealNumber) {
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(80, 80, 80);
                doc.text(`Appeal #: ${appealNumber}`, PAGE_W - lMargin, hY, { align: 'right' });
                hY += 14;
              }
              doc.setTextColor(0, 0, 0);
              doc.setFontSize(18);
              doc.setFont('helvetica', 'bold');
              doc.text(blqLabel, PAGE_W - lMargin, hY + 10, { align: 'right' });

              doc.setFontSize(13);
              doc.setTextColor(...lojikBlue);
              doc.setFont('helvetica', 'bold');
              doc.text('Subject & Comps Photos', PAGE_W / 2, lMargin + 28, { align: 'center' });
            };
            const drawPhotoPageFooter = () => {
              doc.setFontSize(7);
              doc.setTextColor(150, 150, 150);
              doc.setFont('helvetica', 'italic');
              doc.text('Subject and comparable photographs.', lMargin, PAGE_H - lMargin + 8);
              doc.setFont('helvetica', 'normal');
              doc.text(blqLabel, PAGE_W - lMargin, PAGE_H - lMargin + 8, { align: 'right' });
            };
            const drawSubjectCell = () => {
              if (!subjectCell) return;
              try {
                doc.addImage(
                  subjectCell.dataUrl, 'JPEG',
                  subjX + cellPad, subjY + cellPad,
                  subjPhotoW, subjPhotoH,
                  undefined, 'FAST'
                );
              } catch (_e) {
                try {
                  doc.addImage(
                    subjectCell.dataUrl, 'PNG',
                    subjX + cellPad, subjY + cellPad,
                    subjPhotoW, subjPhotoH,
                    undefined, 'FAST'
                  );
                } catch (_e2) {}
              }
              doc.setFontSize(11);
              doc.setTextColor(140, 0, 0);
              doc.setFont('helvetica', 'bold');
              doc.text(
                'Subject',
                subjX + subjCellW / 2,
                subjY + subjCellH + captionGap + captionH - 2,
                { align: 'center' }
              );
            };
            const drawCompRow = (slots) => {
              const totalW = compCellW * slots.length + colGap * Math.max(0, slots.length - 1);
              const startX = lMargin + (contentW - totalW) / 2;
              slots.forEach((cell, i) => {
                const x = startX + i * (compCellW + colGap);
                if (cell) {
                  try {
                    doc.addImage(
                      cell.dataUrl, 'JPEG',
                      x + cellPad, compsY + cellPad,
                      compPhotoW, compPhotoH,
                      undefined, 'FAST'
                    );
                  } catch (_e) {
                    try {
                      doc.addImage(
                        cell.dataUrl, 'PNG',
                        x + cellPad, compsY + cellPad,
                        compPhotoW, compPhotoH,
                        undefined, 'FAST'
                      );
                    } catch (_e2) {}
                  }
                }
                doc.setFontSize(10);
                doc.setTextColor(30, 60, 140);
                doc.setFont('helvetica', 'bold');
                doc.text(
                  cell ? cell.parcel.roleLabel : '',
                  x + compCellW / 2,
                  compsY + compPhotoH + cellPad * 2 + captionGap + captionH - 2,
                  { align: 'center' }
                );
              });
            };

            // Page 1: subject + comps 1-3
            doc.addPage([PAGE_W, PAGE_H], 'landscape');
            drawPhotoPageHeader();
            drawSubjectCell();
            drawCompRow(compCells.slice(0, 3));
            drawPhotoPageFooter();

            // Page 2: subject (repeated) + comps 4-5
            if (compCells.length > 3) {
              doc.addPage([PAGE_W, PAGE_H], 'landscape');
              drawPhotoPageHeader();
              drawSubjectCell();
              drawCompRow(compCells.slice(3, 5));
              drawPhotoPageFooter();
            }
          }
        }
      } catch (photosErr) {
        console.warn('Photos page generation failed:', photosErr);
      }
    }

    // Save the PDF with CME naming format: CME_ccdd_block_lot_qualifier.pdf
    const ccdd = jobData?.ccdd || 'UNKNOWN';
    const block = subject.property_block || '';
    const lot = subject.property_lot || '';
    const qualifier = subject.property_qualifier || '';
    const fileName = `CME_${ccdd}_${block}_${lot}${qualifier ? '_' + qualifier : ''}.pdf`;

    // "Send to Appeal Log" path: upload the PDF bytes to the appeal-reports
    // bucket (so Appeal Log can print it later with photos appended) AND
    // sync the recalculated CME projected value onto the appeal_log row so
    // the user can see it in the Appeal Log without having to re-run CME.
    const wantUpload = opts.uploadToAppealLog ?? false;
    if (wantUpload && jobData?.id) {
      try {
        setAppealUploadStatus({ status: 'uploading' });
        const pdfBytes = doc.output('arraybuffer');
        const compositeKey =
          subject.property_composite_key ||
          `${block}-${lot}-${qualifier}`;
        const path = `${jobData.id}/${compositeKey}.pdf`;
        const { error: upErr } = await supabase
          .storage
          .from('appeal-reports')
          .upload(path, new Uint8Array(pdfBytes), {
            contentType: 'application/pdf',
            upsert: true,
          });
        if (upErr) throw upErr;
        const { error: dbErr } = await supabase
          .from('appeal_reports')
          .upsert(
            {
              job_id: jobData.id,
              property_composite_key: compositeKey,
              storage_path: path,
              source_filename: fileName,
              page_count: doc.getNumberOfPages(),
              uploaded_at: new Date().toISOString(),
            },
            { onConflict: 'job_id,property_composite_key' },
          );
        if (dbErr) throw dbErr;

        // Mirror Sales Comparison's "Save to Appeal Log" behavior for this
        // single subject — push the CME projected assessment onto the
        // matching appeal_log row(s) so the log reflects the latest run.
        const projected =
          recalculatedProjectedAssessment ?? result?.projectedAssessment ?? null;
        if (projected) {
          try {
            await supabase
              .from('appeal_log')
              .update({
                cme_projected_value: projected,
                updated_at: new Date().toISOString(),
              })
              .eq('job_id', jobData.id)
              .eq('property_block', block)
              .eq('property_lot', lot)
              .eq('property_qualifier', qualifier || '');
          } catch (cmeErr) {
            // Non-fatal: report still saved, CME sync failed.
            console.warn('appeal_log CME sync failed', cmeErr);
          }
        }

        setAppealUploadStatus({ status: 'done', message: 'Sent to Appeal Log' });
      } catch (e) {
        console.error('appeal-reports upload failed', e);
        setAppealUploadStatus({ status: 'error', message: e.message || 'Upload failed' });
      }
    }

    // Local download is now opt-in (Download PDF button passes
    // downloadLocal: true). Send-to-Appeal-Log skips the download to keep
    // users' Downloads folder clean.
    if (opts.downloadLocal === true) {
      doc.save(fileName);
    }
    // Keep the modal open after a successful Send-to-Appeal-Log so the
    // user can see the green "Sent ✓" confirmation. Close on local download
    // (the file landing in Downloads is its own confirmation) and on
    // explicit caller request.
    const shouldClose = opts.uploadToAppealLog
      ? opts.closeModal === true
      : opts.closeModal !== false;
    if (shouldClose) {
      setShowExportModal(false);
    }
  }, [allAttributes, rowVisibility, showAdjustments, subject, comps, result, editableProperties, editedAdjustments, recalculatedProjectedAssessment, getAdjustment, GARAGE_OPTIONS, jobData, marketLandData, allProperties, codeDefinitions, vendorType, includeMap, includePhotos, photoStripParcels, hideAppellantEvidence, hideDirectorsRatio, mapHasSubject, mapData, compDistances, appellantDistances, aggregatedSubject, aggregatedComps, applyGeocodePatch]);

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
                <div className="flex items-center justify-center gap-1">
                  <span>Subject</span>
                  <GeocodeStatusChip
                    property={applyGeocodePatch(aggregatedSubject)}
                    onSaved={(patch) =>
                      handleGeocodeSaved(aggregatedSubject?.property_composite_key, patch)
                    }
                  />
                </div>
                {aggregatedSubject._additionalCardsCount > 0 && (
                  <span className="block text-xs text-purple-700 font-semibold mt-1 bg-purple-100 rounded px-1">
                    (+{aggregatedSubject._additionalCardsCount} cards)
                  </span>
                )}
              </th>
              {[1, 2, 3, 4, 5].map((compNum) => {
                const comp = aggregatedComps[compNum - 1];
                const bgColor = comp?.isSubjectSale ? 'bg-green-50' : 'bg-blue-50';
                return (
                  <th key={compNum} className={`px-3 py-3 text-center font-semibold ${bgColor} border-l border-gray-300`}>
                    <div className="flex items-center justify-center gap-1">
                      <span>Comparable {compNum}</span>
                      {comp && (
                        <GeocodeStatusChip
                          property={applyGeocodePatch(comp)}
                          onSaved={(patch) =>
                            handleGeocodeSaved(comp?.property_composite_key, patch)
                          }
                        />
                      )}
                    </div>
                    {comp?.isSubjectSale && (
                      <span className="block text-xs text-green-700 font-semibold mt-1">(Subject Sale)</span>
                    )}
                    {comp?._additionalCardsCount > 0 && (
                      <span className="block text-xs text-purple-700 font-semibold mt-1 bg-purple-100 rounded px-1">
                        (+{comp._additionalCardsCount} cards)
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {/* Render all attributes in order */}
            {allAttributes
              .filter(attr => {
                // ✅ FILTER: Hide dynamic attributes with all NONE values
                if (!attr.isDynamic) return true; // Always show non-dynamic attributes

                const subjectVal = attr.render(aggregatedSubject);
                if (subjectVal !== 'NONE') return true; // Show if subject has value

                // Check if any comparable has a non-NONE value
                for (let i = 0; i < aggregatedComps.length; i++) {
                  if (aggregatedComps[i]) {
                    const compVal = attr.render(aggregatedComps[i]);
                    if (compVal !== 'NONE') return true;
                  }
                }

                return false; // Hide if all values are NONE
              })
              .map((attr) => (
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
                  {attr.id === 'sales_date' && aggregatedSubject?.property_composite_key && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openSalesHistoryModal('subject', applySalesHistoryPatch(aggregatedSubject)); }}
                      title={aggregatedSubject.sales_override ? 'Manually selected sale — view/change history' : 'Sales history (swap hidden sale)'}
                      className={`float-right p-0.5 rounded hover:bg-blue-100 ${aggregatedSubject.sales_override ? 'text-amber-600' : 'text-gray-400 hover:text-blue-600'}`}
                    >
                      {aggregatedSubject.sales_override ? <Flag size={12} /> : <History size={12} />}
                    </button>
                  )}
                  {(() => {
                    // Use aggregated subject data for properties with additional cards
                    let value = attr.render(aggregatedSubject);

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
                        case 'garage_area': rawPropertyValue = aggregatedSubject.garage_area; break;
                        case 'det_garage_area': rawPropertyValue = aggregatedSubject.det_garage_area; break;
                        case 'deck_area': rawPropertyValue = aggregatedSubject.deck_area; break;
                        case 'patio_area': rawPropertyValue = aggregatedSubject.patio_area; break;
                        case 'open_porch_area': rawPropertyValue = aggregatedSubject.open_porch_area; break;
                        case 'enclosed_porch_area': rawPropertyValue = aggregatedSubject.enclosed_porch_area; break;
                        case 'pool_area': rawPropertyValue = aggregatedSubject.pool_area; break;
                        case 'basement_area': rawPropertyValue = aggregatedSubject.basement_area; break;
                        case 'fin_bsmt_area': rawPropertyValue = aggregatedSubject.fin_basement_area; break;
                        case 'ac_area': rawPropertyValue = aggregatedSubject.ac_area; break;
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
                      <div className={`flex items-center justify-center gap-1 ${attr.bold ? 'font-semibold' : 'text-xs'}`}>
                        <span>{value}</span>
                        {attr.id === 'sales_date' && comp?.property_composite_key && !comp.is_manual_comp && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openSalesHistoryModal(`comp_${idx}`, applySalesHistoryPatch(comp)); }}
                            title={comp.sales_override ? 'Manually selected sale — view/change history' : 'Sales history (swap hidden sale)'}
                            className={`shrink-0 p-0.5 rounded hover:bg-blue-100 ${comp.sales_override ? 'text-amber-600' : 'text-gray-400 hover:text-blue-600'}`}
                          >
                            {comp.sales_override ? <Flag size={12} /> : <History size={12} />}
                          </button>
                        )}
                      </div>
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
                {mapHasSubject && (
                  <label className="flex items-center gap-2 cursor-pointer text-white text-sm">
                    <input
                      type="checkbox"
                      checked={includeMap}
                      onChange={(e) => setIncludeMap(e.target.checked)}
                      className="rounded border-white text-blue-600"
                    />
                    <span className="flex items-center gap-1">
                      <MapIcon size={14} />
                      Include Map
                    </span>
                  </label>
                )}
                {/* Include Photos Toggle - emit a Photos page in the PDF using the picked appeal_photos */}
                <label className="flex items-center gap-2 cursor-pointer text-white text-sm">
                  <input
                    type="checkbox"
                    checked={includePhotos}
                    onChange={(e) => setIncludePhotos(e.target.checked)}
                    className="rounded border-white text-blue-600"
                  />
                  <span className="flex items-center gap-1">📷 Include Photos</span>
                </label>
                {/* Hide Appellant Evidence Toggle - some assessors prefer to package only the detailed grids */}
                <label className="flex items-center gap-2 cursor-pointer text-white text-sm">
                  <input
                    type="checkbox"
                    checked={hideAppellantEvidence}
                    onChange={(e) => setHideAppellantEvidence(e.target.checked)}
                    className="rounded border-white text-blue-600"
                  />
                  <span className="flex items-center gap-1">
                    {hideAppellantEvidence ? <EyeOff size={14} /> : <Eye size={14} />}
                    Hide Appellant Evidence
                  </span>
                </label>
                {/* Hide Director's Ratio Study Toggle - omit Chapter 123 page when settling */}
                <label className="flex items-center gap-2 cursor-pointer text-white text-sm">
                  <input
                    type="checkbox"
                    checked={hideDirectorsRatio}
                    onChange={(e) => setHideDirectorsRatio(e.target.checked)}
                    className="rounded border-white text-blue-600"
                  />
                  <span className="flex items-center gap-1">
                    {hideDirectorsRatio ? <EyeOff size={14} /> : <Eye size={14} />}
                    Hide Director's Ratio
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

            {/* Appeal Number Row */}
            <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-4 flex-shrink-0">
              <label className="text-sm font-medium text-gray-700">Appeal/Petition #:</label>
              <input
                type="text"
                value={appealNumber}
                onChange={(e) => { setAppealNumber(e.target.value); setAppealAutoDetected(false); }}
                placeholder="Enter appeal number (appears on PDF header)"
                className={`px-3 py-1.5 text-sm border rounded w-64 ${
                  appealAutoDetected ? 'border-green-400 bg-green-50' : 'border-gray-300'
                }`}
              />
              {appealAutoDetected && <span className="text-xs text-green-600 font-medium">Auto-detected from Appeal Log</span>}
              {!appealAutoDetected && !appealNumber && <span className="text-xs text-gray-400">Optional — will appear above Block/Lot on PDF</span>}
              {appealUploadStatus?.status === 'uploading' && (
                <span className="ml-auto text-xs text-blue-700 font-medium">Saving to Appeal Log…</span>
              )}
              {appealUploadStatus?.status === 'done' && (
                <span className="ml-auto text-xs text-emerald-700 font-medium">✓ {appealUploadStatus.message}</span>
              )}
              {appealUploadStatus?.status === 'error' && (
                <span className="ml-auto text-xs text-red-700 font-medium">✗ Save to Appeal Log failed: {appealUploadStatus.message}</span>
              )}
            </div>

            {/* Modal Content - Editable Grid */}
            <div className="flex-1 overflow-auto p-2">
              <table className="min-w-full text-xs border-collapse border border-gray-300">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-blue-600 text-white">
                    <th className="px-2 py-2 text-left font-semibold border-r border-blue-500 w-40">Attribute</th>
                    <th className="px-2 py-2 text-center font-semibold bg-slate-600 border-r border-slate-500 w-28">Subject</th>
                    {[0, 1, 2, 3, 4].map(idx => {
                      const isManual = !!manualComps[idx];
                      const manualAddr = isManual ? (editableProperties[`comp_${idx}`]?.property_location || '') : '';
                      return (
                        <th key={idx} className={`px-2 py-2 text-center font-semibold border-r border-blue-500 w-28 ${isManual ? 'bg-amber-600' : ''}`}>
                          <div className="flex items-center justify-center gap-1">
                            <span>{isManual ? `OUT OF TOWN ${idx + 1}` : `Comp ${idx + 1}`}</span>
                            <button
                              type="button"
                              onClick={() => toggleManualComp(idx)}
                              title={isManual ? 'Switch back to real comp' : 'Enter a manual out-of-town comp in this slot'}
                              className={`ml-1 inline-flex items-center justify-center rounded text-[10px] font-bold border px-1.5 py-0.5 ${isManual ? 'bg-white text-amber-700 border-white' : 'bg-blue-700 text-white border-blue-300 hover:bg-blue-800'}`}
                            >
                              M
                            </button>
                          </div>
                          {isManual && (
                            <input
                              type="text"
                              value={manualAddr}
                              onChange={(e) => updateEditedValue(`comp_${idx}`, 'property_location', e.target.value)}
                              placeholder="Street address"
                              className="mt-1 w-full px-1 py-0.5 text-xs text-gray-900 rounded border border-amber-300 bg-amber-50"
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {allAttributes
                    .filter(attr => rowVisibility[attr.id] !== false)
                    .filter(attr => {
                      // ✅ FILTER: Hide dynamic attributes with all NONE values
                      if (!attr.isDynamic) return true; // Always show non-dynamic attributes

                      const subjectVal = attr.render(subject);
                      if (subjectVal !== 'NONE') return true; // Show if subject has value

                      // Check if any comparable has a non-NONE value
                      for (let i = 0; i < comps.length; i++) {
                        if (comps[i]) {
                          const compVal = attr.render(comps[i]);
                          if (compVal !== 'NONE') return true;
                        }
                      }

                      return false; // Hide if all values are NONE
                    })
                    .map(attr => {
                    const config = EDITABLE_CONFIG[attr.id];
                    // Make both configured fields AND dynamic rows editable
                    const isEditable = !!config || attr.isDynamic;
                    // For dynamic rows, treat as yesno type
                    const effectiveConfig = config || (attr.isDynamic ? { type: 'yesno', field: attr.id } : null);

                    // Render cell for a property
                    const renderCell = (propKey, bgClass) => {
                      const prop = propKey === 'subject' ? subject : comps[parseInt(propKey.replace('comp_', ''))];
                      if (!prop && propKey !== 'subject') {
                        return <td key={propKey} className={`px-2 py-1 text-center ${bgClass} border-r border-gray-200 text-gray-400`}>-</td>;
                      }

                      const editedVal = editableProperties[propKey]?.[attr.id];
                      const displayVal = editedVal !== undefined ? editedVal : attr.render(prop);

                      // Get adjustment for this comp - use edited if recalculated, otherwise original
                      let compAdj = null;
                      if (propKey.startsWith('comp_') && showAdjustments && attr.adjustmentName) {
                        const editedCompData = editedAdjustments[propKey];
                        if (editedCompData) {
                          compAdj = editedCompData.adjustments.find(a =>
                            a.name?.toLowerCase() === attr.adjustmentName?.toLowerCase()
                          ) || null;
                        } else {
                          compAdj = getAdjustment(prop, attr.adjustmentName);
                        }
                      }

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

                      // Editable cell - use effectiveConfig for type detection
                      const cfg = effectiveConfig;
                      // For ALL yesno fields, derive default from rendered value to match detailed component
                      const getDefaultYesNo = () => {
                        if (editedVal !== undefined) return editedVal;
                        // Use the render function to determine actual value - this matches what detailed component shows
                        const rendered = attr.render(prop);
                        if (!rendered) return 'No';
                        // Check for various "yes" patterns in rendered output
                        const renderedStr = String(rendered).toLowerCase();
                        if (renderedStr === 'no' || renderedStr === 'none' || renderedStr === 'n/a') {
                          return 'No';
                        }
                        // If it shows Yes, a number, or an area (SF), it's Yes
                        return 'Yes';
                      };

                      // Farm-mode: source lot_size_acre from the combined
                      // 3A+3B package value when available, mirroring the
                      // Detailed view's lot_size_acre render. Without this
                      // the export modal would seed only the 3A acreage.
                      const numberInitial = (() => {
                        if (editedVal !== undefined) return editedVal;
                        if (!prop) return '';
                        if (
                          attr.id === 'lot_size_acre' &&
                          compFilters?.farmSalesMode &&
                          prop._pkg?.is_farm_package &&
                          prop._pkg.combined_lot_acres > 0
                        ) {
                          return prop._pkg.combined_lot_acres;
                        }
                        return (prop[cfg.altField] || prop[cfg.field]) ?? '';
                      })();
                      return (
                        <td key={propKey} className={`px-1 py-1 text-center ${bgClass} border-r border-gray-200`}>
                          {cfg.type === 'number' && (
                            <EditableInput
                              type="text"
                              inputMode="decimal"
                              initialValue={numberInitial}
                              onCommit={(v) => updateEditedValue(propKey, attr.id, v)}
                              className="w-full px-1 py-0.5 text-xs text-center border rounded focus:ring-1 focus:ring-blue-500"
                            />
                          )}
                          {cfg.type === 'date' && (
                            <EditableInput
                              type="date"
                              initialValue={editedVal ?? (prop ? prop[cfg.field] : '') ?? ''}
                              onCommit={(v) => updateEditedValue(propKey, attr.id, v)}
                              className="w-full px-1 py-0.5 text-xs text-center border rounded focus:ring-1 focus:ring-blue-500"
                            />
                          )}
                          {cfg.type === 'yesno' && (
                            <select
                              value={getDefaultYesNo()}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                            </select>
                          )}
                          {cfg.type === 'garage' && (
                            <select
                              value={editedVal ?? getGarageCategory(prop ? prop[cfg.field] : 0)}
                              onChange={(e) => updateEditedValue(propKey, attr.id, parseInt(e.target.value))}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              {GARAGE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {cfg.type === 'condition' && (
                            <select
                              value={editedVal ?? (prop ? attr.render(prop) : '')}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">-</option>
                              {getConditionOptions(attr.id === 'ext_condition' ? 'exterior' : 'interior').map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {cfg.type === 'code' && (
                            <select
                              value={editedVal ?? (prop ? (prop[cfg.field] || prop[cfg.altField] || '') : '')}
                              onChange={(e) => updateEditedValue(propKey, attr.id, e.target.value)}
                              className="w-full px-1 py-0.5 text-xs border rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="">-</option>
                              {getCodeOptions(cfg.codeType).map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          )}
                          {cfg.type === 'text' && (
                            <EditableInput
                              type="text"
                              initialValue={editedVal ?? (prop ? (prop[cfg.field] || prop[cfg.altField] || '') : '') ?? ''}
                              onCommit={(v) => updateEditedValue(propKey, attr.id, v)}
                              className="w-full px-1 py-0.5 text-xs text-center border rounded focus:ring-1 focus:ring-blue-500"
                            />
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

                  {/* Net Adjustment Row - use edited if recalculated, otherwise original */}
                  {showAdjustments && rowVisibility['net_adjustment'] !== false && (
                    <tr className="border-b-2 border-gray-400 bg-gray-100">
                      <td className="px-2 py-2 font-bold text-gray-900 border-r border-gray-300">Net Adjustment</td>
                      <td className="px-2 py-2 text-center bg-slate-100 border-r border-gray-300">-</td>
                      {[0, 1, 2, 3, 4].map(idx => {
                        const comp = comps[idx];
                        if (!comp) {
                          return <td key={idx} className="px-2 py-2 text-center border-r border-gray-300">-</td>;
                        }
                        const editedData = editedAdjustments[`comp_${idx}`];
                        const total = editedData ? editedData.totalAdjustment : (comp.totalAdjustment || 0);
                        const pct = editedData ? editedData.adjustmentPercent : (comp.adjustmentPercent || 0);
                        return (
                          <td key={idx} className={`px-2 py-2 text-center font-bold border-r border-gray-300 ${total > 0 ? 'text-green-700' : total < 0 ? 'text-red-700' : ''}`}>
                            {total > 0 ? '+' : ''}${Math.round(total).toLocaleString()}
                            <div className="text-xs font-normal">({pct > 0 ? '+' : ''}{pct.toFixed(0)}%)</div>
                          </td>
                        );
                      })}
                    </tr>
                  )}

                  {/* Adjusted Valuation Row - use edited if recalculated, otherwise original */}
                  {showAdjustments && rowVisibility['adjusted_valuation'] !== false && (
                    <tr className="border-b-2 border-gray-400 bg-blue-100">
                      <td className="px-2 py-2 font-bold text-gray-900 border-r border-gray-300">Adjusted Valuation</td>
                      <td className="px-2 py-2 text-center bg-slate-100 border-r border-gray-300 font-bold text-green-700">
                        {(recalculatedProjectedAssessment || result.projectedAssessment) ? `$${(recalculatedProjectedAssessment || result.projectedAssessment).toLocaleString()}` : '-'}
                      </td>
                      {[0, 1, 2, 3, 4].map(idx => {
                        const comp = comps[idx];
                        if (!comp) {
                          return <td key={idx} className="px-2 py-2 text-center border-r border-gray-300">-</td>;
                        }
                        const editedData = editedAdjustments[`comp_${idx}`];
                        const adjustedPrice = editedData ? editedData.adjustedPrice : (comp.adjustedPrice || 0);
                        return (
                          <td key={idx} className="px-2 py-2 text-center font-bold border-r border-gray-300">
                            ${Math.round(adjustedPrice).toLocaleString()}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Map preview (also captured by html2canvas for the PDF).
                Renders at a fixed 600x420 size so the on-screen preview matches
                what gets embedded in the PDF, including auto-zoom level.
                Collapsed by default - click the header to expand. When
                collapsed we keep the capture div mounted off-screen so
                html2canvas can still grab it for the PDF. */}
            {includeMap && mapHasSubject && (
              <div className="px-4 py-3 border-t bg-gray-50 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setMapExpanded((v) => !v)}
                  className="w-full flex items-center justify-between mb-2 hover:bg-gray-100 rounded px-1 py-0.5 -mx-1"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <span className="text-gray-500">{mapExpanded ? '▾' : '▸'}</span>
                    <MapIcon size={16} className="text-blue-600" />
                    Subject &amp; Comps Map (PDF preview)
                  </div>
                  <span className="text-xs text-gray-500">
                    {mapGeocodedCount} of {mapTotalCount} parcels geocoded ·
                    click to {mapExpanded ? 'collapse' : 'expand'}
                  </span>
                </button>
                <div
                  style={mapExpanded ? {} : { position: 'absolute', left: -99999, top: 0, width: 600, pointerEvents: 'none' }}
                  aria-hidden={!mapExpanded}
                >
                <div className="flex gap-3 items-start">
                  <div ref={mapCaptureRef} style={{ width: 600, flex: '0 0 600px' }}>
                    <AppealMap
                      subject={mapData.subject}
                      comps={mapData.comps}
                      appellantComps={mapData.appellantComps}
                      height={420}
                      id="appeal-map-capture"
                    />
                  </div>
                  <div className="flex-1 text-xs">
                    <div className="font-semibold text-gray-700 mb-1">Legend</div>
                    <div className="bg-white border border-gray-200 rounded p-2">
                      <div className="flex items-start gap-2 mb-1.5">
                        <span className="inline-block rounded-full text-white font-bold flex items-center justify-center"
                          style={{ background: '#dc2626', width: 18, height: 18, fontSize: 10, lineHeight: 1 }}>S</span>
                        <div>
                          <div className="font-semibold">SUBJECT</div>
                          <div className="text-gray-600">
                            {mapData.subject.block}/{mapData.subject.lot}
                            {mapData.subject.qualifier ? `/${mapData.subject.qualifier}` : ''}
                          </div>
                          <div className="text-gray-700">{mapData.subject.address}</div>
                        </div>
                      </div>
                      {compDistances.map((c) => (
                        <div key={c.rank} className="flex items-start gap-2 mb-1.5">
                          <span className="inline-block rounded-full text-white font-bold flex items-center justify-center"
                            style={{ background: '#2563eb', width: 18, height: 18, fontSize: 10, lineHeight: 1 }}>{c.rank}</span>
                          <div>
                            <div className="font-semibold">COMP {c.rank}</div>
                            <div className="text-gray-600">
                              {c.block}/{c.lot}{c.qualifier ? `/${c.qualifier}` : ''}
                              {c.miles != null && (
                                <span className="ml-1 text-blue-700 font-medium">
                                  · {c.miles.toFixed(1)} mi
                                </span>
                              )}
                            </div>
                            <div className="text-gray-700">{c.address}</div>
                          </div>
                        </div>
                      ))}
                      {appellantDistances.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="font-semibold text-orange-700 mb-1">Appellant Comps</div>
                          {appellantDistances.map((c) => (
                            <div key={`a-${c.rank}`} className="flex items-start gap-2 mb-1.5">
                              <span className="inline-block rounded-full text-white font-bold flex items-center justify-center"
                                style={{ background: '#ea580c', width: 18, height: 18, fontSize: 9, lineHeight: 1 }}>A{c.rank}</span>
                              <div>
                                <div className="font-semibold">APPELLANT {c.rank}</div>
                                <div className="text-gray-600">
                                  {c.block}/{c.lot}{c.qualifier ? `/${c.qualifier}` : ''}
                                  {c.miles != null && (
                                    <span className="ml-1 text-orange-700 font-medium">
                                      · {c.miles.toFixed(1)} mi
                                    </span>
                                  )}
                                </div>
                                <div className="text-gray-700">{c.address}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {mapGeocodedCount < mapTotalCount && (
                  <p className="text-xs text-amber-700 mt-1">
                    {mapTotalCount - mapGeocodedCount} parcel(s) missing
                    coordinates won't appear on the map. Use the Geocoder to
                    add them.
                  </p>
                )}
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between rounded-b-lg flex-shrink-0">
              <p className="text-xs text-gray-500">
                Edit values, then click Recalculate to update adjustments before exporting.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={recalculateAdjustments}
                  disabled={!hasEdits}
                  className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                    hasEdits
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Recalculate
                </button>
                <button
                  onClick={() => generatePDF({ downloadLocal: true })}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors text-sm"
                  title="Download a local copy only — does not update the Appeal Log."
                >
                  <FileDown size={16} />
                  Download PDF
                </button>
                <button
                  onClick={() =>
                    generatePDF({ uploadToAppealLog: true, downloadLocal: false })
                  }
                  disabled={appealUploadStatus?.status === 'uploading'}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm ${
                    appealUploadStatus?.status === 'done'
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300'
                  }`}
                  title="Upload this report to the Appeal Log (creates the Report ✓ chip) and sync the CME projected value. No local download."
                >
                  <FileDown size={16} />
                  {appealUploadStatus?.status === 'uploading'
                    ? 'Sending…'
                    : appealUploadStatus?.status === 'done'
                    ? 'Sent ✓'
                    : appealUploadStatus?.status === 'error'
                    ? 'Retry Send'
                    : 'Send to Appeal Log'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sales History (Hidden Sale Swap) Modal */}
      {salesHistoryModal && (
        <SalesHistoryModal
          propKey={salesHistoryModal.propKey}
          property={salesHistoryModal.property}
          onClose={closeSalesHistoryModal}
          onApply={(patch) => {
            const compositeKey = salesHistoryModal.property.property_composite_key;
            // Local UI patch so the cell shows the new sale immediately
            setSalesHistoryPatches((prev) => ({
              ...prev,
              [compositeKey]: patch
            }));
            // Also push the new sale into the editable export-modal overlay so
            // recalc and PDF export see the swapped values without retyping.
            const pk = salesHistoryModal.propKey;
            if (patch.sales_date !== undefined) updateEditedValue(pk, 'sales_date', patch.sales_date || '');
            if (patch.sales_price !== undefined) updateEditedValue(pk, 'sales_price', patch.sales_price ?? '');
            if (patch.sales_nu !== undefined) updateEditedValue(pk, 'sales_code', patch.sales_nu || '');
            closeSalesHistoryModal();
            // Auto-trigger recalc inside the export modal (covers the case
            // where the swap was initiated from inside the export modal).
            setTimeout(() => {
              try { recalculateAdjustments(); } catch (e) { /* ignore — export modal not open */ }
            }, 0);
            // Notify parent so it can refresh the in-memory property and
            // re-run the comp evaluation. This is what makes the main
            // Detailed grid update its adjustments without a manual rerun.
            if (typeof onSalesSwapped === 'function') {
              try { onSalesSwapped(compositeKey, patch); } catch (e) { console.warn('onSalesSwapped failed:', e); }
            }
          }}
        />
      )}

      {/* Per-parcel photo strip — preview/select/add the front photo for each parcel.
          Lives at the bottom of Detailed (NOT in the export modal). The picked
          photo is uploaded to `appeal-photos` storage and recorded in the
          `appeal_photos` table, keyed by (job_id, property_composite_key). */}
      <div className="px-4 pb-4">
        <ParcelPhotoStrip jobId={jobData?.id} parcels={photoStripParcels} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SalesHistoryModal
// Lists the property's prev_sales (vendor-supplied prior arm's-length sales)
// plus the current sale. User can promote a prior sale to "current" — this
// writes to property_records with sales_override=true so the file updater
// won't overwrite it on re-upload (see DB trigger respect_sales_override).
// "Revert to file sale" clears the override so the next file upload restores
// vendor data.
// ---------------------------------------------------------------------------
const SalesHistoryModal = ({ propKey, property, onClose, onApply }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const prevSales = Array.isArray(property?.prev_sales) ? property.prev_sales : [];
  // Filter obvious BRT garbage: 1901-01-01 placeholder dates and absurd prices.
  const cleanPrev = prevSales.filter(s => {
    if (!s) return false;
    if (s.date === '1901-01-01') return false;
    const yr = s.date ? parseInt(String(s.date).slice(0, 4), 10) : 0;
    if (yr && yr < 1950) return false;
    return true;
  });

  const promote = async (entry) => {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        sales_date: entry.date || null,
        sales_price: entry.price ?? null,
        sales_nu: entry.nu || null,
        sales_book: entry.book || null,
        sales_page: entry.page || null,
        sales_override: true,
        sales_override_meta: {
          promoted_from: entry.source || 'prev_sales',
          source_entry: entry,
          original_sale: {
            date: property.sales_date || null,
            price: property.sales_price ?? null,
            nu: property.sales_nu || null,
            book: property.sales_book || null,
            page: property.sales_page || null
          },
          decided_at: new Date().toISOString(),
          decided_by: 'user'
        }
      };
      const { error: upErr } = await supabase
        .from('property_records')
        .update(patch)
        .eq('property_composite_key', property.property_composite_key);
      if (upErr) throw upErr;
      onApply(patch);
    } catch (e) {
      console.error('Promote sale failed:', e);
      setError(e.message || 'Failed to save');
      setSaving(false);
    }
  };

  const revert = async () => {
    setSaving(true);
    setError(null);
    try {
      // Restore the original sale (from sales_override_meta) and clear the flag
      const meta = property.sales_override_meta || {};
      const orig = meta.original_sale || {};
      const patch = {
        sales_date: orig.date || null,
        sales_price: orig.price ?? null,
        sales_nu: orig.nu || null,
        sales_book: orig.book || null,
        sales_page: orig.page || null,
        sales_override: false,
        sales_override_meta: null
      };
      const { error: upErr } = await supabase
        .from('property_records')
        .update(patch)
        .eq('property_composite_key', property.property_composite_key);
      if (upErr) throw upErr;
      onApply(patch);
    } catch (e) {
      console.error('Revert sale failed:', e);
      setError(e.message || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4"
      style={{ zIndex: 9999 }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Sales History</h3>
            <p className="text-xs text-gray-500">
              Block {property.property_block} Lot {property.property_lot}
              {property.property_qualifier ? ` Qual ${property.property_qualifier}` : ''}
              {property.property_location ? ` — ${property.property_location}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Current sale */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">Current Sale</div>
            <div className={`flex items-center justify-between border rounded p-2 ${property.sales_override ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-sm">
                <span className="font-medium">{property.sales_date || '—'}</span>
                <span className="ml-3">${property.sales_price ? Number(property.sales_price).toLocaleString() : '—'}</span>
                <span className="ml-3 text-gray-600">NU {property.sales_nu || '—'}</span>
                {property.sales_override && (
                  <span className="ml-3 inline-flex items-center gap-1 text-xs text-amber-700">
                    <Flag size={12} /> manually selected
                  </span>
                )}
              </div>
              {property.sales_override && (
                <button
                  onClick={revert}
                  disabled={saving}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-white disabled:opacity-50"
                >
                  Revert to file sale
                </button>
              )}
            </div>
          </div>

          {/* Prior sales from prev_sales */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">
              Prior Sales {cleanPrev.length > 0 && <span className="text-gray-500 font-normal">({cleanPrev.length})</span>}
            </div>
            {cleanPrev.length === 0 ? (
              <div className="text-sm text-gray-500 italic border border-dashed border-gray-200 rounded p-3 text-center">
                No prior sales available for this property.
              </div>
            ) : (
              <div className="space-y-1">
                {cleanPrev.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border border-gray-200 rounded p-2 hover:bg-blue-50">
                    <div className="text-sm">
                      <span className="font-medium">{s.date || '—'}</span>
                      <span className="ml-3">${s.price ? Number(s.price).toLocaleString() : '—'}</span>
                      {s.nu && <span className="ml-3 text-gray-600">NU {s.nu}</span>}
                      <span className="ml-3 text-xs text-gray-400">{s.source}</span>
                    </div>
                    <button
                      onClick={() => promote(s)}
                      disabled={saving}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Use this sale
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}

          <div className="text-xs text-gray-500 italic">
            Promoted sales persist across file uploads. They are only auto-replaced if a strictly newer, usable arm's-length sale arrives in a future file.
          </div>
        </div>

        <div className="px-4 py-2 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DetailedAppraisalGrid;
