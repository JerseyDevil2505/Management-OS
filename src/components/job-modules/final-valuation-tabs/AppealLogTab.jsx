import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Trash2, X, Upload, Download, FileText, Paperclip, Printer, Image as ImageIcon, Camera } from 'lucide-react';
import { supabase, parseDateLocal, formatDateLocalYMD } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx-js-style';
import { COLOR_CLASSES } from '../../../lib/appellantCompEvaluator';
import AppellantEvidencePanel from './AppellantEvidencePanel';
import { parsePowerCompPdf, buildPhotoPacketPdf } from '../../../lib/powercompPdfParser';
import {
  downloadPdf,
  downloadAppealReportsZip,
  safeFilenamePart,
} from '../../../lib/appealReportBuilder';

const AppealLogTab = ({ jobData, properties = [], inspectionData = [], marketLandData = {}, tenantConfig = null, onNavigateToCME = () => {}, onAppealsStatUpdate = () => {} }) => {
  // State
  const [appeals, setAppeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);

  // Column group visibility toggles
  const [expandedGroups, setExpandedGroups] = useState({
    propertyInfo: true,
    legal: true,
    workflow: true,
    valuation: true,
    notes: true
  });

  // Sort state
  const [sortState, setSortState] = useState({ column: null, direction: 'asc' });

  // Filter state - separates pending (UI) from active (applied)
  const [pendingFilters, setPendingFilters] = useState({
    statuses: new Set(['D', 'S', 'H', 'W', 'Z', 'A', 'AP', 'AWP', 'NA']),
    classes: new Set(['2,3A', '4A,4B,4C', '1,3B', 'other']),
    attorneys: new Set(),
    vcs: new Set()
  });

  const [filters, setFilters] = useState({
    statuses: new Set(['D', 'S', 'H', 'W', 'Z', 'A', 'AP', 'AWP', 'NA']),
    classes: new Set(['2,3A', '4A,4B,4C', '1,3B', 'other']),
    attorneys: new Set(),
    vcs: new Set()
  });

  // Modal and add appeal state
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState(1); // 1 = property search, 2 = appeal details
  const [searchBlock, setSearchBlock] = useState('');
  const [searchLot, setSearchLot] = useState('');
  const [searchQualifier, setSearchQualifier] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [formData, setFormData] = useState({
    appeal_number: '',
    appeal_year: new Date().getFullYear(),
    status: '',
    appeal_type: '',
    petitioner_name: '',
    taxpayer_name: '',
    attorney: '',
    attorney_address: '',
    attorney_city_state: '',
    current_assessment: 0,
    requested_value: 0,
    hearing_date: '',
    submission_type: '',
    evidence_status: '',
    stip_status: 'not_started',
    inspected: false,
    tax_court_pending: false,
    comments: '',
    property_block: '',
    property_lot: '',
    property_qualifier: '',
    property_location: '',
    property_composite_key: ''
  });

  // Track if attorney fields should be disabled (for Pro Se)
  const [attorneyFieldsDisabled, setAttorneyFieldsDisabled] = useState(false);

  // Inline editing state
  const [editingCell, setEditingCell] = useState(null); // { appealId, field }
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Bracket column state
  const [vcsBracketMap, setVcsBracketMap] = useState({});
  const [cmeBracketMappings, setCmeBracketMappings] = useState({});

  // Evidence (appellant comps / BS-meter) modal state — actual editing lives in AppellantEvidencePanel.
  const [evidenceModalAppeal, setEvidenceModalAppeal] = useState(null); // appeal object being edited

  // Selection state for Send to CME
  const [selectedAppeals, setSelectedAppeals] = useState(new Set());
  const [showMixedBracketModal, setShowMixedBracketModal] = useState(false);
  const [mixedBracketInfo, setMixedBracketInfo] = useState({});
  const [isSendingToCME, setIsSendingToCME] = useState(false);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importProcessing, setImportProcessing] = useState(false);
  const [importResult, setImportResult] = useState(null); // { imported, skipped, unmatched }

  // PWR CAMA state
  const [showPwrCamaModal, setShowPwrCamaModal] = useState(false);
  const [pwrCamaFile, setPwrCamaFile] = useState(null);
  const [pwrCamaProcessing, setPwrCamaProcessing] = useState(false);
  const [pwrCamaResult, setPwrCamaResult] = useState(null);

  // Last-import timestamps (job_settings keys: appeal_log_mynjappeal_last_import / appeal_log_pwrcama_last_import)
  // ISO strings or null. Rendered under each import button; updated after each successful import.
  const [mynjAppealLastImport, setMynjAppealLastImport] = useState(null);
  const [pwrCamaLastImport, setPwrCamaLastImport] = useState(null);

  // Import from export state
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  const [importExportFile, setImportExportFile] = useState(null);
  const [importExportResult, setImportExportResult] = useState(null);
  const [importExportProcessing, setImportExportProcessing] = useState(false);

  // PowerComp PDF (photo packet) import state
  const [showPwrCompPdfModal, setShowPwrCompPdfModal] = useState(false);
  const [pwrCompPdfFile, setPwrCompPdfFile] = useState(null);
  const [pwrCompPdfBytes, setPwrCompPdfBytes] = useState(null);
  const [pwrCompPdfParsing, setPwrCompPdfParsing] = useState(false);
  const [pwrCompPdfSaving, setPwrCompPdfSaving] = useState(false);
  const [pwrCompPdfPreview, setPwrCompPdfPreview] = useState(null); // { totalPages, packets: [{...packet, matchedKey, matchedAddress}] }
  const [pwrCompPdfSaveResult, setPwrCompPdfSaveResult] = useState(null); // { saved, replaced, failed }
  const [pwrCompPdfSaveProgress, setPwrCompPdfSaveProgress] = useState(null); // { current, total, label, status: 'uploading'|'done'|'failed' }
  const [printingAppealId, setPrintingAppealId] = useState(null);

  // PowerComp CSV export selection modal. Lets the user pick which saved
  // result sets to ship when a subject has more than one (e.g. assessor
  // run + appellant run + manager rebuttal). All entries are checked by
  // default; the user unchecks anything they don't want sent to BRT.
  const [showExportCsvModal, setShowExportCsvModal] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [exportCsvCandidates, setExportCsvCandidates] = useState([]); // [{id, checked, ...}]

  const [showBatchPrintModal, setShowBatchPrintModal] = useState(false);
  const [batchPrintScope, setBatchPrintScope] = useState('selected'); // 'selected' | 'filtered'
  const [batchPrintRunning, setBatchPrintRunning] = useState(false);
  const [batchPrintProgress, setBatchPrintProgress] = useState(null); // { current, total, label }
  const [batchPrintResult, setBatchPrintResult] = useState(null); // { built, withPhotos, failed }
  const [photoPacketsByKey, setPhotoPacketsByKey] = useState({}); // composite_key -> { id, page_count, imported_at, source_filename, storage_path }
  const [directPhotosByKey, setDirectPhotosByKey] = useState({}); // composite_key -> appeal_photos row

  // Appeal reports (uploaded from Detailed tab). Bucket is the source of truth
  // for what the per-row print + batch print actually output.
  const [appealReportsByKey, setAppealReportsByKey] = useState({}); // composite_key -> { storage_path, source_filename, page_count, uploaded_at }

  // Bulk-upload state for already-existing local PDFs
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [bulkUploadFiles, setBulkUploadFiles] = useState([]); // [{ file, key, status, message }]
  const [bulkUploadRunning, setBulkUploadRunning] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState(null); // { current, total, label }

  // Bulk apply hearing date state
  const [showBulkDateModal, setShowBulkDateModal] = useState(false);
  const [bulkHearingDate, setBulkHearingDate] = useState('');
  const [isApplyingBulkDate, setIsApplyingBulkDate] = useState(false);

  // CME Brackets constant
  const CME_BRACKETS = [
    { min: 0, max: 99999, label: 'Under $100K', color: '#FF9999', textColor: 'black' },
    { min: 100000, max: 199999, label: '$100K-$199K', color: '#FFB366', textColor: 'black' },
    { min: 200000, max: 299999, label: '$200K-$299K', color: '#FFCC99', textColor: 'black' },
    { min: 300000, max: 399999, label: '$300K-$399K', color: '#FFFF99', textColor: 'black' },
    { min: 400000, max: 499999, label: '$400K-$499K', color: '#CCFF99', textColor: 'black' },
    { min: 500000, max: 749999, label: '$500K-$749K', color: '#99FF99', textColor: 'black' },
    { min: 750000, max: 999999, label: '$750K-$999K', color: '#99CCFF', textColor: 'black' },
    { min: 1000000, max: 1499999, label: '$1M-$1.49M', color: '#9999FF', textColor: 'black' },
    { min: 1500000, max: 1999999, label: '$1.5M-$1.99M', color: '#CC99FF', textColor: 'black' },
    { min: 2000000, max: 99999999, label: '$2M+', color: '#FF99FF', textColor: 'black' }
  ];

  // ==================== STATS COMPUTATION ====================

  const computeAndEmitStats = useCallback((currentAppeals) => {
    if (typeof onAppealsStatUpdate !== 'function') return;

    const stats = {
      total_appeals: currentAppeals.length,
      open: currentAppeals.filter(a => a.status !== 'C').length,
      closed: currentAppeals.filter(a => a.status === 'C').length,
      total_current_assessment_at_risk: currentAppeals.reduce((sum, a) => sum + (a.current_assessment || 0), 0),
      total_projected_loss: currentAppeals.reduce((sum, a) => sum + (a.loss || 0), 0),
      hearing_date: currentAppeals.find(a => a.hearing_date)?.hearing_date || null,
      evidence_due_date: currentAppeals.find(a => a.evidence_due_date)?.evidence_due_date || null,
      stip_status_breakdown: currentAppeals.reduce((acc, a) => {
        const s = a.stip_status || 'not_started';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {}),
      by_class: currentAppeals.reduce((acc, a) => {
        const cls = a.property_m4_class || 'Unknown';
        if (!acc[cls]) acc[cls] = { count: 0, loss: 0 };
        acc[cls].count++;
        acc[cls].loss += (a.loss || 0);
        return acc;
      }, {})
    };

    onAppealsStatUpdate(stats);
  }, [onAppealsStatUpdate]);

  // ==================== SNAPSHOT SAVE ====================

  const saveSnapshot = useCallback(async (currentAppeals) => {
    if (!jobData?.id) return;
    try {
      await supabase
        .from('jobs')
        .update({ appeal_summary_snapshot: currentAppeals })
        .eq('id', jobData.id);
    } catch (e) {
      console.warn('Appeal snapshot save failed:', e);
    }
  }, [jobData?.id]);

  // Load last-import timestamps from job_settings on mount / job change
  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('job_settings')
        .select('setting_key, setting_value')
        .eq('job_id', jobData.id)
        .in('setting_key', ['appeal_log_mynjappeal_last_import', 'appeal_log_pwrcama_last_import']);
      if (cancelled || !data) return;
      const map = Object.fromEntries(data.map(r => [r.setting_key, r.setting_value]));
      setMynjAppealLastImport(map.appeal_log_mynjappeal_last_import || null);
      setPwrCamaLastImport(map.appeal_log_pwrcama_last_import || null);
    })();
    return () => { cancelled = true; };
  }, [jobData?.id]);

  // Helper: stamp a "last import" timestamp into job_settings and update local state
  const stampLastImport = useCallback(async (settingKey, setter) => {
    if (!jobData?.id) return;
    const iso = new Date().toISOString();
    try {
      await supabase
        .from('job_settings')
        .upsert(
          { job_id: jobData.id, setting_key: settingKey, setting_value: iso, updated_at: iso },
          { onConflict: 'job_id,setting_key' }
        );
      setter(iso);
    } catch (e) {
      console.warn(`Failed to stamp ${settingKey}:`, e);
    }
  }, [jobData?.id]);

  // Format an ISO timestamp for the "Last imported" labels under the import buttons
  const formatLastImport = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // Compute VCS to bracket mapping on mount
  useEffect(() => {
    if (!jobData?.end_date || properties.length === 0) return;

    // Helper: Get bracket label for a given price value
    const getBracketLabel = (priceValue) => {
      const bracket = CME_BRACKETS.find(b => priceValue >= b.min && priceValue <= b.max);
      return bracket ? bracket.label : null;
    };

    const endDateLocal = parseDateLocal(jobData.end_date);
    const assessmentYear = endDateLocal ? endDateLocal.getFullYear() : new Date().getFullYear();

    // Define period boundaries (local time, month is 0-indexed)
    const cspStart = new Date(assessmentYear - 1, 9, 1);    // Oct 1 prior year
    const cspEnd   = new Date(assessmentYear,     11, 31);  // Dec 31 assessment year
    const pspStart = new Date(assessmentYear - 2, 9, 1);    // Oct 1 two years prior
    const pspEnd   = new Date(assessmentYear - 1, 8, 30);   // Sep 30 prior year
    const hspStart = new Date(assessmentYear - 3, 9, 1);    // Oct 1 three years prior
    const hspEnd   = new Date(assessmentYear - 2, 8, 30);   // Sep 30 two years prior

    const inPeriod = (saleDate, start, end) => {
      const date = parseDateLocal(saleDate);
      return date && date >= start && date <= end;
    };

    // Build bracket map
    const newMap = {};
    const vcsValues = [...new Set(properties
      .filter(p => p.new_vcs && p.values_norm_time > 0)
      .map(p => p.new_vcs))];

    vcsValues.forEach(vcs => {
      const vcsProps = properties.filter(p => p.new_vcs === vcs && p.values_norm_time > 0);

      // Try to find >= 3 sales in CSP/PSP/HSP periods
      const periodSales = vcsProps.filter(p =>
        inPeriod(p.sales_date, cspStart, cspEnd) ||
        inPeriod(p.sales_date, pspStart, pspEnd) ||
        inPeriod(p.sales_date, hspStart, hspEnd)
      );

      let avgPrice;
      if (periodSales.length >= 3) {
        avgPrice = periodSales.reduce((sum, p) => sum + (p.values_norm_time || 0), 0) / periodSales.length;
      } else {
        // Fallback to all values
        avgPrice = vcsProps.reduce((sum, p) => sum + (p.values_norm_time || 0), 0) / vcsProps.length;
      }

      newMap[vcs] = getBracketLabel(avgPrice);
    });

    setVcsBracketMap(newMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.end_date, properties]);

  // Load CME bracket mappings for fallback
  useEffect(() => {
    if (!jobData?.id) return;

    const loadMappings = async () => {
      try {
        const { data, error } = await supabase
          .from('job_cme_bracket_mappings')
          .select('vcs_codes, bracket_value')
          .eq('job_id', jobData.id);

        if (error) throw error;

        const mappingObj = {};
        (data || []).forEach(row => {
          if (row.vcs_codes && Array.isArray(row.vcs_codes)) {
            row.vcs_codes.forEach(vcs => {
              mappingObj[vcs] = row.bracket_value;
            });
          }
        });

        setCmeBracketMappings(mappingObj);
      } catch (error) {
        console.error('Error loading CME bracket mappings:', error);
      }
    };

    loadMappings();
  }, [jobData?.id]);

  // Load appeals from database
  useEffect(() => {
    if (!jobData?.id) return;
    
    const loadAppeals = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('appeal_log')
          .select('*')
          .eq('job_id', jobData.id)
          .order('appeal_number', { ascending: true });

        if (error) throw error;

        // Auto-sync `inspected` from property_records.inspection_list_by/date.
        // The boolean is set to false on insert and never refreshed by imports,
        // so we recompute it here on every load. We then write back any rows
        // where the stored value is out of sync — keeps the DB column honest
        // for any downstream consumer (manual-edit form, future filters, etc.).
        const inspectedSyncUpdates = [];

        // Enrich with property data and re-parse appeal_type if null
        const enrichedAppeals = (data || []).map(appeal => {
          const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);

          // Re-parse appeal_type for existing records where it's null but appeal_number exists
          let appealType = appeal.appeal_type;
          if (!appealType && appeal.appeal_number) {
            const parsed = parseAppealNumber(appeal.appeal_number);
            appealType = parsed.appealType;
          }

          // Compute fresh inspected status from current property data.
          const computedInspected = !!(property?.inspection_list_by && property?.inspection_list_date);
          if (appeal.id && appeal.inspected !== computedInspected) {
            inspectedSyncUpdates.push({ id: appeal.id, inspected: computedInspected });
          }

          return {
            ...appeal,
            inspected: computedInspected,
            appeal_type: appealType,
            // Derived fields from property match
            property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
            asset_type_use: property?.asset_type_use || appeal.asset_type_use || null,
            new_vcs: property?.new_vcs || null,
            owner_name: property?.owner_name || null,
            owner_street: property?.owner_street || null,
            owner_csz: property?.owner_csz || null,
            property_block: appeal.property_block || property?.property_block || null,
            property_lot: appeal.property_lot || property?.property_lot || null,
            property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
            property_location: appeal.property_location || property?.property_location || null
          };
        });

        // Fire-and-forget bulk sync of any drifted `inspected` values. We do
        // this in parallel so it never blocks rendering, and we batch in
        // chunks of 100 to avoid huge single-statement UPDATEs on large jobs.
        if (inspectedSyncUpdates.length > 0) {
          (async () => {
            try {
              const CHUNK = 100;
              for (let i = 0; i < inspectedSyncUpdates.length; i += CHUNK) {
                const batch = inspectedSyncUpdates.slice(i, i + CHUNK);
                // PostgREST doesn't support per-row updates in a single call, so
                // group by value and update all ids of each group at once.
                const trueIds = batch.filter(u => u.inspected).map(u => u.id);
                const falseIds = batch.filter(u => !u.inspected).map(u => u.id);
                if (trueIds.length > 0) {
                  await supabase.from('appeal_log').update({ inspected: true }).in('id', trueIds);
                }
                if (falseIds.length > 0) {
                  await supabase.from('appeal_log').update({ inspected: false }).in('id', falseIds);
                }
              }
            } catch (e) {
              console.warn('appeal_log.inspected auto-sync failed (non-critical):', e);
            }
          })();
        }

        setAppeals(enrichedAppeals);

        // Emit stats on initial load
        computeAndEmitStats(enrichedAppeals);

        // Save snapshot on initial load
        saveSnapshot(enrichedAppeals);

        // Build unique years from data + current year
        const yearsFromData = [...new Set(enrichedAppeals.map(a => a.appeal_year).filter(Boolean))];
        const currentYear = new Date().getFullYear();
        const allYears = [...new Set([...yearsFromData, currentYear])].sort((a, b) => b - a);
        setAvailableYears(allYears.length > 0 ? allYears : [currentYear]);
      } catch (error) {
        console.error('Error loading appeals:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAppeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobData?.id, properties]);

  // Get unique attorney and VCS values from appeals
  const uniqueAttorneys = useMemo(() => {
    const attorneys = [...new Set(appeals
      .map(a => a.attorney)
      .filter(Boolean))];
    return attorneys.sort();
  }, [appeals]);

  const uniqueVCS = useMemo(() => {
    const vcs = [...new Set(appeals
      .map(a => a.new_vcs)
      .filter(Boolean))];
    return vcs.sort();
  }, [appeals]);

  // Helper: Render bracket cell content
  const renderBracketCell = (appeal) => {
    // Helper to get bracket color by label
    const getBracketColorAndText = (label) => {
      const bracket = CME_BRACKETS.find(b => b.label === label);
      return bracket ? { color: bracket.color, textColor: bracket.textColor } : { color: '#FF9999', textColor: 'black' };
    };

    // Check if manual override exists
    if (appeal.cme_bracket) {
      const { color, textColor } = getBracketColorAndText(appeal.cme_bracket);
      return (
        <div className="inline-flex items-center gap-1">
          <span
            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
            style={{ backgroundColor: color, color: textColor }}
          >
            {appeal.cme_bracket}
          </span>
          <span className="text-xs text-gray-500">(manual)</span>
        </div>
      );
    }

    // Find matching property and VCS
    const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);
    if (!property || !property.new_vcs) {
      return <span className="text-gray-400">-</span>;
    }

    // Use vcsBracketMap
    const bracket = vcsBracketMap[property.new_vcs];
    if (bracket) {
      const { color, textColor } = getBracketColorAndText(bracket);
      return (
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: color, color: textColor }}
        >
          {bracket}
        </span>
      );
    }

    // Fallback to cmeBracketMappings
    const fallbackBracket = cmeBracketMappings[property.new_vcs];
    if (fallbackBracket) {
      const { color, textColor } = getBracketColorAndText(fallbackBracket);
      return (
        <span
          className="inline-block px-2 py-0.5 rounded text-xs font-medium"
          style={{ backgroundColor: color, color: textColor }}
        >
          {fallbackBracket}
        </span>
      );
    }

    return <span className="text-gray-400">-</span>;
  };

  // ==================== APPELLANT COMPS / EVIDENCE ====================

  // Open / close the AppellantEvidencePanel modal. Editing + save logic lives in the panel itself.
  const openEvidenceModal = (appeal) => setEvidenceModalAppeal(appeal);
  const closeEvidenceModal = () => setEvidenceModalAppeal(null);

  // Render the Y/N evidence cell
  const renderEvidenceCell = (appeal) => {
    const hasEvidence = Array.isArray(appeal.appellant_comps) && appeal.appellant_comps.length > 0;
    const cls = hasEvidence ? COLOR_CLASSES.green : COLOR_CLASSES.na;
    return (
      <button
        type="button"
        onClick={() => openEvidenceModal(appeal)}
        title={hasEvidence ? 'View / edit appellant comps' : 'Add appellant comps'}
        className={`inline-flex items-center justify-center px-3 py-0.5 rounded-full text-xs font-semibold border ${cls.bg} ${cls.text} ${cls.border} hover:opacity-80 cursor-pointer`}
      >
        {hasEvidence ? `Y · ${appeal.appellant_comps.length}` : 'N'}
      </button>
    );
  };

  // Helper: Render inspected cell content
  const renderInspectedCell = (appeal) => {
    const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);

    if (property && property.inspection_list_by && property.inspection_list_date) {
      const date = new Date(property.inspection_list_date);
      const formatted = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
      return <span className="text-green-600 font-medium">{formatted}</span>;
    }

    return <span className="text-gray-400">No</span>;
  };

  // Helper: Determine class category
  const getClassCategory = (classCode) => {
    if (!classCode) return 'other';
    if (['2', '3A'].includes(classCode)) return '2,3A';
    if (['4A', '4B', '4C'].includes(classCode)) return '4A,4B,4C';
    if (['1', '3B'].includes(classCode)) return '1,3B';
    return 'other';
  };

  // Helper: Compare function for sorting
  const compareValues = (a, b, direction) => {
    const multiplier = direction === 'asc' ? 1 : -1;
    if (a == null && b == null) return 0;
    if (a == null) return multiplier;
    if (b == null) return -multiplier;
    if (a < b) return -multiplier;
    if (a > b) return multiplier;
    return 0;
  };

  // Helper: Render sortable column header
  const SortableHeader = ({ label, columnKey, sticky = false, left = '0', minWidth = null, maxWidth = null }) => {
    const isActive = sortState.column === columnKey;
    const handleClick = () => {
      if (sortState.column === columnKey) {
        // Toggle direction
        setSortState({ column: columnKey, direction: sortState.direction === 'asc' ? 'desc' : 'asc' });
      } else {
        // New column, default to asc
        setSortState({ column: columnKey, direction: 'asc' });
      }
    };

    const baseClass = sticky
      ? `sticky z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200 cursor-pointer hover:bg-blue-100`
      : `px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-blue-100`;

    const stickyStyle = sticky ? { left } : {};
    const widthStyle = { ...stickyStyle };
    if (minWidth) widthStyle.minWidth = minWidth;
    if (maxWidth) widthStyle.maxWidth = maxWidth;

    return (
      <th className={baseClass} onClick={handleClick} style={widthStyle}>
        <div className="flex items-center gap-1">
          <span>{label}</span>
          {isActive && (
            <span className="text-xs font-bold">
              {sortState.direction === 'asc' ? '↑' : '↓'}
            </span>
          )}
        </div>
      </th>
    );
  };

  // Filter and sort appeals
  const filteredAppeals = useMemo(() => {
    let result = appeals.filter(a => !a.appeal_year || a.appeal_year === selectedYear);

    // Apply active filters
    result = result.filter(a => {
      // Status filter
      if (filters.statuses.size > 0 && !filters.statuses.has(a.status || 'NA')) return false;

      // Class filter
      const classCategory = getClassCategory(a.property_m4_class);
      if (filters.classes.size > 0 && !filters.classes.has(classCategory)) return false;

      // Attorney filter
      if (filters.attorneys.size > 0) {
        const attorneyKey = a.attorney || 'Pro Se';
        if (!filters.attorneys.has(attorneyKey)) return false;
      }

      // VCS filter
      if (filters.vcs.size > 0 && !filters.vcs.has(a.new_vcs)) return false;

      return true;
    });


    // Apply sorting
    if (sortState.column) {
      result.sort((a, b) => {
        let aVal, bVal;

        switch (sortState.column) {
          case 'status': aVal = a.status || 'NA'; bVal = b.status || 'NA'; break;
          case 'year': aVal = a.appeal_year; bVal = b.appeal_year; break;
          case 'appeal_number': aVal = a.appeal_number; bVal = b.appeal_number; break;
          case 'block': aVal = parseInt(a.property_block) || 0; bVal = parseInt(b.property_block) || 0; break;
          case 'lot': aVal = parseInt(a.property_lot) || 0; bVal = parseInt(b.property_lot) || 0; break;
          case 'location': aVal = a.property_location; bVal = b.property_location; break;
          case 'class': aVal = a.property_m4_class; bVal = b.property_m4_class; break;
          case 'type_use': aVal = a.asset_type_use; bVal = b.asset_type_use; break;
          case 'vcs': aVal = a.new_vcs; bVal = b.new_vcs; break;
          case 'bracket': {
            const getBracketIndex = (appeal) => {
              const label = appeal.cme_bracket
                || vcsBracketMap[appeal.new_vcs]
                || cmeBracketMappings[appeal.new_vcs]
                || null;
              if (!label) return -1;
              return CME_BRACKETS.findIndex(b => b.label === label);
            };
            aVal = getBracketIndex(a);
            bVal = getBracketIndex(b);
            break;
          }
          case 'current_assessment': aVal = a.current_assessment; bVal = b.current_assessment; break;
          case 'requested': aVal = a.requested_value; bVal = b.requested_value; break;
          case 'cme_value': aVal = a.cme_projected_value; bVal = b.cme_projected_value; break;
          case 'judgment': aVal = a.judgment_value; bVal = b.judgment_value; break;
          case 'actual_loss': aVal = a.loss; bVal = b.loss; break;
          case 'loss_pct': aVal = a.loss_pct; bVal = b.loss_pct; break;
          case 'hearing_date': aVal = a.hearing_date; bVal = b.hearing_date; break;
          case 'attorney': aVal = a.attorney; bVal = b.attorney; break;
          case 'evidence': {
            aVal = Array.isArray(a.appellant_comps) ? a.appellant_comps.length : 0;
            bVal = Array.isArray(b.appellant_comps) ? b.appellant_comps.length : 0;
            break;
          }
          default: return 0;
        }

        return compareValues(aVal, bVal, sortState.direction);
      });
    }

    return result;
  }, [appeals, selectedYear, filters, sortState]);

  // Helper: Check if any filters are active
  const areFiltersActive = useMemo(() => {
    return filters.statuses.size < 8 ||
           filters.classes.size < 4 ||
           filters.attorneys.size > 0 ||
           filters.vcs.size > 0;
  }, [filters]);

  // Calculate statistics
  const stats = useMemo(() => {
    const filtered = filteredAppeals;

    const totalAppeals = filtered.length;
    const totalAssessmentExposure = filtered.reduce((sum, a) => sum + (a.current_assessment || 0), 0);

    // Total Actual Loss: only include where judgment_value is not null
    const settledAppeals = filtered.filter(a => a.judgment_value !== null && a.judgment_value !== undefined);
    const totalActualLoss = settledAppeals.reduce((sum, a) => sum + (a.loss || 0), 0);

    // Total % Loss: (Total Actual Loss / Total Assessment Exposure) × 100
    const totalLossPercent = totalAssessmentExposure > 0
      ? (totalActualLoss / totalAssessmentExposure) * 100
      : 0;

    // Calculate total ratables (same logic as RatableComparisonTab)
    const totalRatables = properties.reduce((sum, p) => {
      // Exclude EXEMPT properties
      if (p.property_facility === 'EXEMPT') return sum;

      // Only count main cards: '1' (BRT), 'M' (Microsystems), or null/empty
      const cardType = p.property_addl_card;
      const isMainCard = cardType === '1' || cardType?.toUpperCase() === 'M' || !cardType;

      if (!isMainCard) return sum;

      return sum + (p.values_mod_total || 0);
    }, 0);

    // Calculate % of ratables
    const ratablePercent = totalRatables > 0 ? (totalAssessmentExposure / totalRatables) * 100 : 0;

    // Status counts (X is included for display purposes in tiles)
    const statusCounts = {
      S: 0, D: 0, H: 0, W: 0, A: 0, AP: 0, AWP: 0, NA: 0, X: 0
    };
    filtered.forEach(a => {
      const status = a.status?.toUpperCase() || 'NA';
      if (statusCounts.hasOwnProperty(status)) {
        statusCounts[status]++;
      }
    });

    // Class counts
    const residentialCount = filtered.filter(a => ['2', '3A'].includes(a.property_m4_class)).length;
    const commercialCount = filtered.filter(a => ['4A', '4B', '4C'].includes(a.property_m4_class)).length;
    const vacantCount = filtered.filter(a => ['1', '3B'].includes(a.property_m4_class)).length;
    const otherCount = totalAppeals - residentialCount - commercialCount - vacantCount;

    // Appeal type counts
    const petitionerCount = filtered.filter(a => a.appeal_type === 'petitioner').length;
    const representedCount = filtered.filter(a => a.appeal_type === 'represented').length;
    const assessorCount = filtered.filter(a => a.appeal_type === 'assessor').length;
    const crossCount = filtered.filter(a => a.appeal_type === 'cross').length;
    const unknownTypeCount = totalAppeals - petitionerCount - representedCount - assessorCount - crossCount;

    return {
      totalAppeals,
      totalAssessmentExposure,
      totalActualLoss,
      totalLossPercent,
      totalRatables,
      ratablePercent,
      statusCounts,
      residentialCount,
      commercialCount,
      vacantCount,
      otherCount,
      petitionerCount,
      representedCount,
      assessorCount,
      crossCount,
      unknownTypeCount
    };
  }, [filteredAppeals, properties]);

  // Helper: Format currency
  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Helper: Check owner mismatch
  const hasOwnerMismatch = (appeal) => {
    if (!appeal.petitioner_name || !appeal.owner_name) return false;
    const pet = appeal.petitioner_name.toLowerCase().trim();
    const own = appeal.owner_name.toLowerCase().trim();
    return pet !== own;
  };

  // Helper: Render editable cell with proper formatting
  const renderEditableCell = (appealId, field, value, type = 'text') => {
    const isEditing = editingCell?.appealId === appealId && editingCell?.field === field;
    const isCurrencyField = ['current_assessment', 'requested_value', 'judgment_value', 'possible_loss', 'loss', 'cme_projected_value'].includes(field);
    const isDateField = type === 'date';

    // Convert date to YYYY-MM-DD format for input (without timezone conversion)
    const getDateInputValue = (dateVal) => {
      if (!dateVal) return '';
      // If it's already in YYYY-MM-DD format, use it directly
      if (typeof dateVal === 'string' && dateVal.match(/^\d{4}-\d{2}-\d{2}/)) {
        return dateVal.split('T')[0];
      }
      // Otherwise parse and format
      const date = parseDateLocal(dateVal) || new Date(dateVal);
      return formatDateLocalYMD(date);
    };

    if (isEditing) {
      return (
        <input
          autoFocus
          type={type}
          value={isDateField ? getDateInputValue(editValue) : editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => handleSaveEdit(appealId, field, editValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveEdit(appealId, field, editValue);
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full px-1 py-0.5 border border-blue-500 rounded text-xs"
        />
      );
    }

    let displayValue = '-';
    if (isDateField && value) {
      // Parse YYYY-MM-DD format directly without timezone conversion
      const parts = value.split('-');
      if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        displayValue = date.toLocaleDateString();
      }
    } else if (isCurrencyField && value) {
      displayValue = formatCurrency(value);
    } else if (value) {
      displayValue = value;
    }

    return (
      <div
        onClick={() => handleStartEdit(appealId, field, value)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded whitespace-nowrap ${isCurrencyField ? 'text-right' : ''}`}
        title="Click to edit"
      >
        {displayValue}
      </div>
    );
  };

  // Helper: Calculate AC%
  const calculateACPercent = (appeal) => {
    if (!appeal.current_assessment || !appeal.judgment_value) return null;
    const pct = ((appeal.current_assessment - appeal.judgment_value) / appeal.current_assessment) * 100;
    return Math.round(pct * 10) / 10;
  };

  // Helper: Calculate evidence due (hearing_date - 7 days)
  const getEvidenceDueDate = (appeal) => {
    if (!appeal.hearing_date) return null;
    const date = new Date(appeal.hearing_date);
    date.setDate(date.getDate() - 7);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Helper: Sanitize date fields (convert empty string to null)
  const sanitizeDate = (val) => (val && val.trim() !== '' ? val : null);

  // Helper: Parse appeal number and extract only the suffix (D, L, A, X)
  const parseAppealNumber = (appealNumber) => {
    if (!appealNumber || appealNumber.trim() === '') {
      return { suffix: '', appealType: null };
    }

    // Extract suffix (trailing letter(s): D, L, A, X - case insensitive)
    // Using the exact regex format with proper anchoring
    const suffix = appealNumber.trim().match(/([DLAXZdlaxz]+)$/)
      ?.[1]?.toUpperCase();

    // Map suffix to appeal_type
    const appealTypeMap = {
      'D': 'petitioner',
      'L': 'represented',
      'A': 'assessor',
      'X': 'cross',
      'Z': 'dismissed'
    };

    return {
      suffix: suffix || '',
      appealType: appealTypeMap[suffix] || 'petitioner'
    };
  };

  // Helper: Get bracket for an appeal
  const getBracketForAppeal = (appeal) => {
    if (appeal.cme_bracket) return appeal.cme_bracket;
    const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);
    if (!property || !property.new_vcs) return null;
    const bracket = vcsBracketMap[property.new_vcs];
    if (bracket) return bracket;
    return cmeBracketMappings[property.new_vcs] || null;
  };

  // Helper: Get brackets for selected appeals
  const getSelectedAppealsBrackets = () => {
    const brackets = {};
    selectedAppeals.forEach(appealId => {
      const appeal = filteredAppeals.find(a => a.id === appealId);
      if (appeal) {
        const bracket = getBracketForAppeal(appeal);
        if (bracket) {
          brackets[bracket] = (brackets[bracket] || 0) + 1;
        }
      }
    });
    return brackets;
  };

  // Handle checkbox selection
  const handleToggleAppealSelection = (appealId) => {
    setSelectedAppeals(prev => {
      const next = new Set(prev);
      if (next.has(appealId)) {
        next.delete(appealId);
      } else {
        next.add(appealId);
      }
      return next;
    });
  };

  // Handle select all checkbox — only selects appeals whose status is 'D' (defendable)
  const handleToggleSelectAll = () => {
    const defendable = filteredAppeals.filter(a => (a.status || 'NA') === 'D');
    if (defendable.length > 0 && defendable.every(a => selectedAppeals.has(a.id))) {
      setSelectedAppeals(new Set());
    } else {
      setSelectedAppeals(new Set(defendable.map(a => a.id)));
    }
  };

  // Handle Send to CME
  const handleSendToCME = () => {
    if (selectedAppeals.size === 0) return;

    const bracketCounts = getSelectedAppealsBrackets();
    const distinctBrackets = Object.keys(bracketCounts);

    // If multiple brackets, show warning modal
    if (distinctBrackets.length > 1) {
      setMixedBracketInfo({
        brackets: bracketCounts,
        count: distinctBrackets.length
      });
      setShowMixedBracketModal(true);
      return;
    }

    // Proceed with single bracket
    proceedWithCMENavigation(distinctBrackets[0]);
  };

  // Proceed with CME navigation
  const proceedWithCMENavigation = (dominantBracket) => {
    setIsSendingToCME(true);

    try {
      const subjects = Array.from(selectedAppeals).map(appealId => {
        const appeal = filteredAppeals.find(a => a.id === appealId);
        return {
          block: appeal.property_block,
          lot: appeal.property_lot,
          qualifier: appeal.property_qualifier,
          property_composite_key: appeal.property_composite_key
        };
      });

      const payload = {
        source: 'appeal_log',
        subjects,
        bracket: dominantBracket,
        fromAppealLog: true
      };

      onNavigateToCME(payload);
      setSelectedAppeals(new Set());
      setShowMixedBracketModal(false);
    } finally {
      setIsSendingToCME(false);
    }
  };

  // ==================== MODAL & ADD APPEAL HANDLERS ====================

  const handleOpenModal = () => {
    setShowModal(true);
    setModalStep(1);
    setSearchBlock('');
    setSearchLot('');
    setSearchQualifier('');
    setSearchResults([]);
    setAttorneyFieldsDisabled(false);
    setFormData({
      appeal_number: '',
      appeal_year: new Date().getFullYear(),
      status: '',
      appeal_type: '',
      petitioner_name: '',
      taxpayer_name: '',
      attorney: '',
      attorney_address: '',
      attorney_city_state: '',
      current_assessment: 0,
      requested_value: 0,
      hearing_date: '',
      submission_type: '',
      evidence_status: '',
      stip_status: 'not_started',
      inspected: false,
      tax_court_pending: false,
      comments: '',
      property_block: '',
      property_lot: '',
      property_qualifier: '',
      property_location: '',
      property_composite_key: ''
    });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setModalStep(1);
  };

  // Filter properties based on block, lot, and qualifier fields
  const performPropertySearch = (block, lot, qualifier) => {
    // If both block and lot are empty, show no results
    if (!block.trim() && !lot.trim()) {
      setSearchResults([]);
      return;
    }

    const blockTrimmed = block.trim().toLowerCase();
    const lotTrimmed = lot.trim().toLowerCase();
    const qualTrimmed = qualifier.trim().toLowerCase();

    const results = properties.filter(p => {
      const pBlock = (p.property_block || '').toString().toLowerCase().trim();
      const pLot = (p.property_lot || '').toString().toLowerCase().trim();
      const pQual = (p.property_qualifier || '').toString().toLowerCase().trim();

      // If only block is entered, match only block
      if (blockTrimmed && !lotTrimmed) {
        const blockMatches = pBlock === blockTrimmed;
        if (!blockMatches) return false;
        // If qualifier is specified, it must match too
        if (qualTrimmed) {
          return pQual === qualTrimmed;
        }
        return true;
      }

      // If both block and lot are entered, match both
      if (blockTrimmed && lotTrimmed) {
        const blockMatches = pBlock === blockTrimmed;
        const lotMatches = pLot === lotTrimmed;
        if (!blockMatches || !lotMatches) return false;
        // If qualifier is specified, it must match too
        if (qualTrimmed) {
          return pQual === qualTrimmed;
        }
        return true;
      }

      return false;
    });

    setSearchResults(results.slice(0, 20)); // Limit to 20 results
  };

  const handleSelectProperty = (property) => {
    setFormData(prev => ({
      ...prev,
      property_block: property.property_block || '',
      property_lot: property.property_lot || '',
      property_qualifier: property.property_qualifier || '',
      property_location: property.property_location || '',
      property_composite_key: property.property_composite_key || '',
      current_assessment: property.values_mod_total || 0,
      petitioner_name: property.owner_name || '',
      taxpayer_name: property.owner_name || ''
    }));
    setModalStep(2);
  };

  const handleSkipSearch = () => {
    // Pre-populate form with manually entered block/lot/qualifier
    setFormData(prev => ({
      ...prev,
      property_block: searchBlock.trim() || '',
      property_lot: searchLot.trim() || '',
      property_qualifier: searchQualifier.trim() || '',
      property_composite_key: '' // Will be empty since property not in our records
    }));
    setModalStep(2);
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAppealNumberBlur = () => {
    const parsed = parseAppealNumber(formData.appeal_number);

    // Update appeal_type based on suffix
    setFormData(prev => ({
      ...prev,
      appeal_type: parsed.appealType
    }));

    // Disable attorney fields if suffix is D (Pro Se)
    if (parsed.suffix === 'D') {
      setAttorneyFieldsDisabled(true);
      setFormData(prev => ({
        ...prev,
        attorney: '',
        attorney_address: '',
        attorney_city_state: ''
      }));
    } else {
      setAttorneyFieldsDisabled(false);
    }
  };

  const handleSaveAppeal = async () => {
    try {
      setIsSaving(true);

      // Calculate derived fields
      const calculatedEvidenceDueDate = formData.hearing_date
        ? (() => {
            const h = parseDateLocal(formData.hearing_date);
            if (!h) return null;
            const d = new Date(h.getTime() - 7 * 24 * 60 * 60 * 1000);
            return formatDateLocalYMD(d);
          })()
        : null;

      const appealData = {
        job_id: jobData.id,
        ...formData,
        status: formData.status || 'D',
        // Sanitize date fields
        hearing_date: sanitizeDate(formData.hearing_date),
        evidence_due_date: sanitizeDate(calculatedEvidenceDueDate)
      };

      const { data, error } = await supabase
        .from('appeal_log')
        .insert([appealData])
        .select()
        .single();

      if (error) throw error;

      // Reload appeals
      const { data: fetchData, error: fetchError } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .order('appeal_number', { ascending: true });

      if (fetchError) throw fetchError;

      const enrichedAppeals = (fetchData || []).map(appeal => {
        const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);

        // Re-parse appeal_type for existing records where it's null but appeal_number exists
        let appealType = appeal.appeal_type;
        if (!appealType && appeal.appeal_number) {
          const parsed = parseAppealNumber(appeal.appeal_number);
          appealType = parsed.appealType;
        }

        return {
          ...appeal,
          appeal_type: appealType,
          property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
          asset_type_use: property?.asset_type_use || appeal.asset_type_use || null,
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          owner_street: property?.owner_street || null,
          owner_csz: property?.owner_csz || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      computeAndEmitStats(enrichedAppeals);
      saveSnapshot(enrichedAppeals);
      handleCloseModal();
    } catch (error) {
      console.error('Error saving appeal:', error);
      alert(`Failed to save appeal: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== INLINE EDITING HANDLERS ====================

  const handleStartEdit = (appealId, field, currentValue) => {
    setEditingCell({ appealId, field });
    setEditValue(currentValue || '');
  };

  const handleSaveEdit = async (appealId, field, value) => {
    try {
      setIsSaving(true);

      // Handle calculated fields
      let updateData = { [field]: value };

      const appeal = appeals.find(a => a.id === appealId);
      if (!appeal) return;

      // Recalculate dependent fields
      if (field === 'hearing_date' && value) {
        // Parse date string (YYYY-MM-DD) without timezone conversion
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        date.setDate(date.getDate() - 7);
        const evidenceDueYear = date.getFullYear();
        const evidenceDueMonth = String(date.getMonth() + 1).padStart(2, '0');
        const evidenceDueDay = String(date.getDate()).padStart(2, '0');
        updateData.evidence_due_date = `${evidenceDueYear}-${evidenceDueMonth}-${evidenceDueDay}`;
      }

      if (field === 'appeal_number') {
        const parsed = parseAppealNumber(value);
        updateData.appeal_type = parsed.appealType;
      }

      if (field === 'judgment_value') {
        const jv = parseFloat(value) || 0;
        const loss = (appeal.current_assessment || 0) - jv;
        updateData.loss = loss;
        updateData.loss_pct = appeal.current_assessment ? (loss / appeal.current_assessment) * 100 : null;
      }

      // Sanitize date fields before sending to Supabase
      if (updateData.hearing_date !== undefined) {
        updateData.hearing_date = sanitizeDate(updateData.hearing_date);
      }
      if (updateData.evidence_due_date !== undefined) {
        updateData.evidence_due_date = sanitizeDate(updateData.evidence_due_date);
      }

      const { error } = await supabase
        .from('appeal_log')
        .update(updateData)
        .eq('id', appealId);

      if (error) throw error;

      // Update local state
      const updatedAppeals = appeals.map(a =>
        a.id === appealId ? { ...a, ...updateData } : a
      );
      setAppeals(updatedAppeals);
      computeAndEmitStats(updatedAppeals);
      saveSnapshot(updatedAppeals);
      setEditingCell(null);
    } catch (error) {
      console.error('Error saving field:', error);
      alert(`Failed to save: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAppeal = async (appealId) => {
    if (!window.confirm('Are you sure you want to delete this appeal?')) return;

    try {
      const { error } = await supabase
        .from('appeal_log')
        .delete()
        .eq('id', appealId);

      if (error) throw error;

      const updatedAppeals = appeals.filter(a => a.id !== appealId);
      setAppeals(updatedAppeals);
      computeAndEmitStats(updatedAppeals);
      saveSnapshot(updatedAppeals);
    } catch (error) {
      console.error('Error deleting appeal:', error);
      alert(`Failed to delete: ${error.message}`);
    }
  };

  const handleDropdownChange = async (appealId, field, value) => {
    // Status and Stip Status dropdowns save immediately
    try {
      const { error } = await supabase
        .from('appeal_log')
        .update({ [field]: value })
        .eq('id', appealId);

      if (error) throw error;

      const updatedAppeals = appeals.map(a =>
        a.id === appealId ? { ...a, [field]: value } : a
      );
      setAppeals(updatedAppeals);
      computeAndEmitStats(updatedAppeals);
      saveSnapshot(updatedAppeals);
    } catch (error) {
      console.error('Error updating field:', error);
    }
  };

  const handleApplyBulkHearingDate = async () => {
    if (!bulkHearingDate || selectedAppeals.size === 0) {
      alert('Please select appeals and enter a hearing date');
      return;
    }

    try {
      setIsApplyingBulkDate(true);
      const selectedAppealIds = Array.from(selectedAppeals);

      // Calculate evidence due date (7 days before hearing) without timezone conversion
      const [year, month, day] = bulkHearingDate.split('-').map(Number);
      const hearingDate = new Date(year, month - 1, day);
      const evidenceDueDate = new Date(hearingDate);
      evidenceDueDate.setDate(evidenceDueDate.getDate() - 7);
      const evidenceDueYear = evidenceDueDate.getFullYear();
      const evidenceDueMonth = String(evidenceDueDate.getMonth() + 1).padStart(2, '0');
      const evidenceDueDay = String(evidenceDueDate.getDate()).padStart(2, '0');
      const evidenceDueDateStr = `${evidenceDueYear}-${evidenceDueMonth}-${evidenceDueDay}`;

      // Update all selected appeals in parallel
      const updates = selectedAppealIds.map(appealId =>
        supabase
          .from('appeal_log')
          .update({
            hearing_date: bulkHearingDate,
            evidence_due_date: evidenceDueDateStr
          })
          .eq('id', appealId)
      );

      const results = await Promise.all(updates);

      // Check for errors
      const hasError = results.some(result => result.error);
      if (hasError) {
        throw new Error('Failed to update some appeals');
      }

      // Update local state
      const updatedAppeals = appeals.map(a =>
        selectedAppeals.has(a.id)
          ? { ...a, hearing_date: bulkHearingDate, evidence_due_date: evidenceDueDateStr }
          : a
      );
      setAppeals(updatedAppeals);
      computeAndEmitStats(updatedAppeals);
      saveSnapshot(updatedAppeals);

      setShowBulkDateModal(false);
      setBulkHearingDate('');
      setSelectedAppeals(new Set());
      alert(`Successfully updated ${selectedAppealIds.length} appeals with hearing date ${new Date(bulkHearingDate).toLocaleDateString()}`);
    } catch (error) {
      console.error('Error applying bulk hearing date:', error);
      alert(`Failed to apply bulk hearing date: ${error.message}`);
    } finally {
      setIsApplyingBulkDate(false);
    }
  };

  // Load PowerComp photo-packet metadata for chip + per-row export use.
  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('appeal_powercomp_photos')
        .select('property_composite_key, storage_path, page_count, source_filename, imported_at')
        .eq('job_id', jobData.id);
      if (cancelled) return;
      if (error) {
        console.error('load photo packets failed', error);
        return;
      }
      const map = {};
      for (const row of data || []) map[row.property_composite_key] = row;
      setPhotoPacketsByKey(map);
    })();
    return () => { cancelled = true; };
  }, [jobData?.id]);

  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('appeal_photos')
        .select('property_composite_key, storage_path, original_filename, source, picked_at')
        .eq('job_id', jobData.id);
      if (cancelled) return;
      if (error) { console.error('load direct photos failed', error); return; }
      const map = {};
      for (const row of data || []) map[row.property_composite_key] = row;
      setDirectPhotosByKey(map);
    })();
    return () => { cancelled = true; };
  }, [jobData?.id]);

  const handlePreviewDirectPhoto = async (compositeKey) => {
    const row = directPhotosByKey[compositeKey];
    if (!row) return;
    const { data, error } = await supabase
      .storage.from('appeal-photos')
      .createSignedUrl(row.storage_path, 60 * 5);
    if (error || !data?.signedUrl) {
      alert('Could not open direct photo: ' + (error?.message || 'unknown error'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  // Load uploaded appeal reports for this job. The Appeal Log row chip and
  // the print pipeline both key off this map.
  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('appeal_reports')
        .select('property_composite_key, storage_path, source_filename, page_count, uploaded_at')
        .eq('job_id', jobData.id);
      if (cancelled) return;
      if (error) {
        console.error('load appeal reports failed', error);
        return;
      }
      const map = {};
      for (const row of data || []) map[row.property_composite_key] = row;
      setAppealReportsByKey(map);
    })();
    return () => { cancelled = true; };
  }, [jobData?.id]);

  const loadAppealReports = async () => {
    if (!jobData?.id) return;
    const { data, error } = await supabase
      .from('appeal_reports')
      .select('property_composite_key, storage_path, source_filename, page_count, uploaded_at')
      .eq('job_id', jobData.id);
    if (error) {
      console.error('load appeal reports failed', error);
      return;
    }
    const map = {};
    for (const row of data || []) map[row.property_composite_key] = row;
    setAppealReportsByKey(map);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Loading appeals...</p>
      </div>
    );
  }

  // ==================== CSV IMPORT HANDLER ====================

  const handleImportCSV = async () => {
    if (!importFile) return;
    setImportProcessing(true);
    setImportResult(null);

    try {
      const text = await importFile.text();
      const lines = text.split('\n');

      // Parse header row — strip BOM if present
      const rawHeader = lines[0].replace(/^\uFEFF/, '');
      const headers = rawHeader.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      // Column index helpers
      const col = (name) => headers.findIndex(h => h === name);

      const idxBLQ       = col('BLQ');
      const idxAppealNum = col('Appeal #');
      const idxName      = col('Name');
      const idxLocation  = col('Location');
      const idxClass     = col('Class.');
      const idxAssess    = col('Assessment');
      const idxTaxCrt    = col('Tax Crt?');
      const idxEntry     = col('Entry');
      const idxContact   = col('Adtl. Contact');
      const idxAddr      = col('Addl Contact Address');
      const idxCityState = col('Addl Contact City, State');
      const idxStatus    = col('Appeal Status');

      // Parse a CSV line respecting quoted fields
      const parseCSVLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        result.push(current.trim());
        return result;
      };

      // Parse BLQ — format: "188-26", "155-7.01", "96-4-C0102"
      const parseBLQ = (blq) => {
        if (!blq) return { block: '', lot: '', qualifier: '' };

        // Handle Excel date corruption: "8-Dec" should be "12-8"
        // Excel converts "12-8" to Dec-8 and displays as "8-Dec"
        const excelDateMatch = blq.match(/^(\d+)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i);
        if (excelDateMatch) {
          const monthMap = {
            jan:'1', feb:'2', mar:'3', apr:'4', may:'5', jun:'6',
            jul:'7', aug:'8', sep:'9', oct:'10', nov:'11', dec:'12'
          };
          const day = excelDateMatch[1];
          const month = monthMap[excelDateMatch[2].toLowerCase()];
          return { block: month, lot: day, qualifier: '' };
        }

        const parts = blq.split('-');
        if (parts.length === 3) {
          // Three segments: block-lot-qualifier (e.g. 96-4-C0102)
          return { block: parts[0], lot: parts[1], qualifier: parts[2] };
        } else if (parts.length === 2) {
          // Two segments: block-lot (qualifier is empty, lot may have decimal)
          return { block: parts[0], lot: parts[1], qualifier: '' };
        }
        return { block: blq, lot: '', qualifier: '' };
      };

      // Fetch existing appeal numbers for this job to detect duplicates
      const { data: existingAppeals } = await supabase
        .from('appeal_log')
        .select('appeal_number')
        .eq('job_id', jobData.id);

      const existingNumbers = new Set(
        (existingAppeals || []).map(a => a.appeal_number)
      );

      // Fetch DRAFT rows (no appeal_number yet) so we can merge proactive
      // appellant-evidence drafts into the official import instead of duplicating.
      const { data: draftRows } = await supabase
        .from('appeal_log')
        .select('id, property_composite_key, appellant_comps, appellant_comps_updated_at, farm_mode')
        .eq('job_id', jobData.id)
        .is('appeal_number', null);
      const draftByCompositeKey = new Map();
      (draftRows || []).forEach(d => {
        if (d.property_composite_key) draftByCompositeKey.set(d.property_composite_key, d);
      });

      let imported = 0;
      let skipped = 0;
      let unmatched = 0;
      let mergedDrafts = 0;
      const records = [];
      const draftUpdates = []; // { id, payload }

      // Process data rows (skip header row 0)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCSVLine(line);
        const getValue = (idx) => (idx >= 0 && cols[idx] ? cols[idx].replace(/^"|"$/g, '').trim() : '');

        const rawAppealNumber = getValue(idxAppealNum);
        if (!rawAppealNumber) continue;
        const appealNumber = rawAppealNumber.startsWith('20@')
          ? rawAppealNumber.slice(3)
          : rawAppealNumber;

        // Skip duplicates
        if (existingNumbers.has(appealNumber)) {
          skipped++;
          continue;
        }

        const blqRaw = getValue(idxBLQ);
        const { block, lot, qualifier } = parseBLQ(blqRaw);

        // Attempt property match against in-memory properties array
        const matchedProperty = properties.find(p => {
          const pBlock = (p.property_block || '').toString().trim();
          const pLot = (p.property_lot || '').toString().trim();
          const pQual = (p.property_qualifier || '').toString().trim();
          return pBlock === block && pLot === lot && pQual === qualifier;
        });

        if (!matchedProperty) unmatched++;

        // Parse appeal_type from appeal number suffix
        const { appealType } = parseAppealNumber(appealNumber);

        // Map submission type
        const entryRaw = getValue(idxEntry);
        const validSubmissionTypes = ['ONLINE', 'PAPER', 'ELECTRONIC'];
        const submissionType = validSubmissionTypes.includes(entryRaw) ? entryRaw : null;

        // Map tax_court_pending
        const taxCrtRaw = cols.find(c =>
          c.trim().toUpperCase() === 'TRUE' ||
          c.trim().toUpperCase() === 'FALSE'
        )?.trim().toUpperCase();
        const taxCourtPending = taxCrtRaw === 'TRUE';

        // Attorney fields — only populate when Adtl. Contact column has a value
        const attorney = getValue(idxContact);
        const attorneyAddress = attorney ? getValue(idxAddr) : '';
        const attorneyCityState = attorney ? getValue(idxCityState) : '';

        // Assessment — strip commas just in case
        const assessmentRaw = getValue(idxAssess).replace(/,/g, '');
        const currentAssessment = parseFloat(assessmentRaw) || 0;

        // Property class — stored as-is (2, 1, 6A, 15D etc.)
        const propertyClass = getValue(idxClass);

        const record = {
          job_id: jobData.id,
          appeal_number: appealNumber,
          appeal_year: new Date().getFullYear(),
          appeal_type: appealType,
          status: 'D',
          stip_status: 'not_started',
          petitioner_name: getValue(idxName),
          taxpayer_name: getValue(idxName),
          attorney: attorney || '',
          attorney_address: attorneyAddress,
          attorney_city_state: attorneyCityState,
          current_assessment: matchedProperty?.values_mod_total || currentAssessment || 0,
          requested_value: 0,
          property_block: block,
          property_lot: lot,
          property_qualifier: qualifier,
          property_location: getValue(idxLocation),
          property_composite_key: matchedProperty?.property_composite_key || '',
          submission_type: submissionType,
          tax_court_pending: taxCourtPending,
          inspected: false,
          comments: '',
          hearing_date: null,
          evidence_due_date: null,
          evidence_status: ''
        };

        // If a draft row already exists for this property, merge instead of insert.
        const draftMatch = matchedProperty?.property_composite_key
          ? draftByCompositeKey.get(matchedProperty.property_composite_key)
          : null;
        if (draftMatch) {
          // Preserve evidence fields already saved by the user, overwrite the rest.
          const { appellant_comps, appellant_comps_updated_at, farm_mode, ...officialFields } = record;
          draftUpdates.push({
            id: draftMatch.id,
            payload: {
              ...officialFields,
              // keep existing draft evidence intact
              appellant_comps: draftMatch.appellant_comps,
              appellant_comps_updated_at: draftMatch.appellant_comps_updated_at,
              farm_mode: draftMatch.farm_mode
            }
          });
          mergedDrafts++;
          // Remove from map so it isn't matched twice
          draftByCompositeKey.delete(matchedProperty.property_composite_key);
          continue;
        }

        records.push(record);
      }

      // Apply draft merges (one update per draft to preserve evidence fields)
      for (const { id, payload } of draftUpdates) {
        const { error } = await supabase
          .from('appeal_log')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      }

      // Batch insert non-draft records
      if (records.length > 0) {
        const { error } = await supabase
          .from('appeal_log')
          .insert(records);

        if (error) throw error;
        imported = records.length;
      }

      // Reload appeals
      const { data: fetchData, error: fetchError } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .order('appeal_number', { ascending: true });

      if (fetchError) throw fetchError;

      const enrichedAppeals = (fetchData || []).map(appeal => {
        const property = properties.find(
          p => p.property_composite_key === appeal.property_composite_key
        );
        let appealType = appeal.appeal_type;
        if (!appealType && appeal.appeal_number) {
          const parsed = parseAppealNumber(appeal.appeal_number);
          appealType = parsed.appealType;
        }
        return {
          ...appeal,
          appeal_type: appealType,
          property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
          asset_type_use: property?.asset_type_use || appeal.asset_type_use || null,
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          owner_street: property?.owner_street || null,
          owner_csz: property?.owner_csz || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      computeAndEmitStats(enrichedAppeals);
      saveSnapshot(enrichedAppeals);
      setImportResult({ imported, skipped, unmatched, mergedDrafts });
      setImportFile(null);

      // Stamp last-import timestamp for the MyNJAppeal source
      stampLastImport('appeal_log_mynjappeal_last_import', setMynjAppealLastImport);

    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setImportProcessing(false);
    }
  };

  // ==================== PWR CAMA IMPORT HANDLER ====================

  const handleImportPwrCama = async () => {
    if (!pwrCamaFile) return;
    setPwrCamaProcessing(true);
    setPwrCamaResult(null);
    try {
      const arrayBuffer = await pwrCamaFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, cellDates: true, raw: false });

      // Fetch full existing rows (not just numbers) so we can refresh hearing_date
      // and judgment fields on re-import instead of skipping.
      const { data: existingAppeals } = await supabase
        .from('appeal_log')
        .select('id, appeal_number, current_assessment')
        .eq('job_id', jobData.id);
      const existingByNumber = new Map();
      (existingAppeals || []).forEach(a => {
        if (a.appeal_number) existingByNumber.set(String(a.appeal_number).trim(), a);
      });

      // Fetch DRAFT rows so proactive evidence drafts merge into the official import.
      const { data: draftRows } = await supabase
        .from('appeal_log')
        .select('id, property_composite_key, appellant_comps, appellant_comps_updated_at, farm_mode')
        .eq('job_id', jobData.id)
        .is('appeal_number', null);
      const draftByCompositeKey = new Map();
      (draftRows || []).forEach(d => {
        if (d.property_composite_key) draftByCompositeKey.set(d.property_composite_key, d);
      });

      let imported = 0;
      let refreshed = 0;
      let unmatched = 0;
      let mergedDrafts = 0;
      const records = [];
      const draftUpdates = [];
      const refreshUpdates = []; // { id, payload } - hearing_date / judgment refresh on existing rows

      for (const row of rows) {
        const appealNumber = row['APPEALS'] ? String(row['APPEALS']).trim() : null;
        if (!appealNumber) continue;

        const block = row['PROP_BLOCK'] != null ? String(row['PROP_BLOCK']).trim() : '';
        const lot = row['PROP_LOT'] != null ? String(row['PROP_LOT']).trim() : '';
        const qualifier = row['PROP_QUALIFIER'] != null ? String(row['PROP_QUALIFIER']).trim() : '';

        const matchedProperty = properties.find(p =>
          (p.property_block || '').toString().trim() === block &&
          (p.property_lot || '').toString().trim() === lot &&
          (p.property_qualifier || '').toString().trim() === qualifier
        );
        if (!matchedProperty) unmatched++;

        const attorney = row['ATTORNEY_NAME'] ? String(row['ATTORNEY_NAME']).trim() : '';
        const appealType = attorney ? 'represented' : 'petitioner';

        let hearingDate = null;
        if (row['HEARING_DATE']) {
          // Excel/XLSX returns Date objects for date cells; format using local components
          // so a date-only cell isn't shifted by UTC conversion.
          const raw = row['HEARING_DATE'];
          const hd = raw instanceof Date ? raw : (parseDateLocal(raw) || new Date(raw));
          if (!isNaN(hd.getTime())) hearingDate = formatDateLocalYMD(hd);
        }
        let evidenceDueDate = null;
        if (hearingDate) {
          const d = parseDateLocal(hearingDate);
          if (d) {
            d.setDate(d.getDate() - 7);
            evidenceDueDate = formatDateLocalYMD(d);
          }
        }

        const taxCourtPending = String(row['ATTRIB_TAXCOURTPENDING'] || '').trim().toUpperCase() === 'Y';
        const jdgNet = row['ASSESSMENT_JDG.NET'];
        const judgmentValue = jdgNet != null && !isNaN(Number(jdgNet)) ? Number(jdgNet) : null;
        const curNet = row['ASSESSMENT_CUR.NET'];
        const currentAssessment = matchedProperty?.values_mod_total || (curNet != null && !isNaN(Number(curNet)) ? Number(curNet) : 0);
        let loss = null;
        let lossPct = null;
        if (judgmentValue !== null && currentAssessment) {
          loss = currentAssessment - judgmentValue;
          lossPct = (loss / currentAssessment) * 100;
        }

        const ownerName = row['OWNER_NAME'] ? String(row['OWNER_NAME']).trim() : '';
        const record = {
          job_id: jobData.id,
          appeal_number: appealNumber,
          appeal_year: new Date().getFullYear(),
          appeal_type: appealType,
          status: 'D',
          stip_status: 'not_started',
          petitioner_name: ownerName,
          taxpayer_name: ownerName,
          attorney,
          attorney_address: row['ATTORNEY_ADDR1'] ? String(row['ATTORNEY_ADDR1']).trim() : '',
          attorney_city_state: row['ATTORNEY_CITYST'] ? String(row['ATTORNEY_CITYST']).trim() : '',
          current_assessment: currentAssessment,
          requested_value: 0,
          judgment_value: judgmentValue,
          loss,
          loss_pct: lossPct,
          property_block: block,
          property_lot: lot,
          property_qualifier: qualifier,
          property_location: row['PROP_LOCATION'] ? String(row['PROP_LOCATION']).trim() : '',
          property_composite_key: matchedProperty?.property_composite_key || '',
          hearing_date: hearingDate,
          evidence_due_date: evidenceDueDate,
          tax_court_pending: taxCourtPending,
          submission_type: null,
          evidence_status: '',
          inspected: false,
          comments: row['NOTES'] ? String(row['NOTES']).trim() : ''
        };

        // Merge into existing draft row if one exists for this property.
        const draftMatch = matchedProperty?.property_composite_key
          ? draftByCompositeKey.get(matchedProperty.property_composite_key)
          : null;
        if (draftMatch) {
          draftUpdates.push({
            id: draftMatch.id,
            payload: {
              ...record,
              appellant_comps: draftMatch.appellant_comps,
              appellant_comps_updated_at: draftMatch.appellant_comps_updated_at,
              farm_mode: draftMatch.farm_mode
            }
          });
          mergedDrafts++;
          draftByCompositeKey.delete(matchedProperty.property_composite_key);
          continue;
        }

        // Re-import path: row already exists for this appeal_number.
        // Refresh hearing_date, evidence_due_date, judgment_value, loss, loss_pct
        // (and tax_court_pending). Leave user-managed fields (status, comments,
        // appellant_comps, etc.) alone.
        const existingRow = existingByNumber.get(appealNumber);
        if (existingRow) {
          // Recompute loss against the existing row's current_assessment if we
          // didn't get a fresh one from the import row.
          const baseAssessment = currentAssessment || existingRow.current_assessment || 0;
          let refreshedLoss = null;
          let refreshedLossPct = null;
          if (judgmentValue !== null && baseAssessment) {
            refreshedLoss = baseAssessment - judgmentValue;
            refreshedLossPct = (refreshedLoss / baseAssessment) * 100;
          }
          refreshUpdates.push({
            id: existingRow.id,
            payload: {
              hearing_date: hearingDate,
              evidence_due_date: evidenceDueDate,
              judgment_value: judgmentValue,
              loss: refreshedLoss,
              loss_pct: refreshedLossPct,
              tax_court_pending: taxCourtPending
            }
          });
          refreshed++;
          continue;
        }

        records.push(record);
      }

      // Apply draft merges first (one update per draft to preserve evidence fields)
      for (const { id, payload } of draftUpdates) {
        const { error } = await supabase
          .from('appeal_log')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      }

      // Apply refresh updates (hearing_date, judgment) on existing appeal rows
      for (const { id, payload } of refreshUpdates) {
        const { error } = await supabase
          .from('appeal_log')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      }

      if (records.length > 0) {
        const { error } = await supabase.from('appeal_log').insert(records);
        if (error) throw error;
        imported = records.length;
      }

      const { data: fetchData, error: fetchError } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .order('appeal_number', { ascending: true });
      if (fetchError) throw fetchError;

      const enrichedAppeals = (fetchData || []).map(appeal => {
        const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);
        let appealType = appeal.appeal_type;
        if (!appealType && appeal.appeal_number) {
          const parsed = parseAppealNumber(appeal.appeal_number);
          appealType = parsed.appealType;
        }
        return {
          ...appeal,
          appeal_type: appealType,
          property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
          asset_type_use: property?.asset_type_use || appeal.asset_type_use || null,
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          owner_street: property?.owner_street || null,
          owner_csz: property?.owner_csz || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      computeAndEmitStats(enrichedAppeals);
      saveSnapshot(enrichedAppeals);
      setPwrCamaResult({ imported, refreshed, unmatched, mergedDrafts });
      setPwrCamaFile(null);

      // Stamp last-import timestamp for the PwrCama source
      stampLastImport('appeal_log_pwrcama_last_import', setPwrCamaLastImport);
    } catch (error) {
      console.error('PowerCama import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setPwrCamaProcessing(false);
    }
  };

  // ==================== POWERCOMP PHOTO PACKET (PDF) IMPORT ====================
  // Match a parsed packet (block/lot/qual/card) against a property in this job.
  const matchPacketToProperty = (packet) => {
    if (!packet || !Array.isArray(properties) || !properties.length) return null;
    const normBLQ = (v) => String(v ?? '').trim().toUpperCase();
    const pBlock = normBLQ(packet.block);
    const pLot = normBLQ(packet.lot);
    const pQual = normBLQ(packet.qualifier);
    const pCard = normBLQ(packet.card);

    // Step 1: filter by block/lot/qualifier first
    const candidates = properties.filter((p) => {
      if (normBLQ(p.property_block) !== pBlock) return false;
      if (normBLQ(p.property_lot) !== pLot) return false;
      const q = normBLQ(p.property_qualifier);
      // PowerComp prints blank qualifier; treat NULL/'' as equivalent.
      if ((pQual || '') !== (q || '')) return false;
      return true;
    });
    if (!candidates.length) return null;

    // Step 2: prefer the matching card; if none matches, fall back to the
    // vendor's "main" card (1 or M) so we always have a target.
    const byCard = candidates.find((p) => normBLQ(p.property_addl_card) === pCard);
    if (byCard) return byCard;
    const mainCard = candidates.find((p) => {
      const c = normBLQ(p.property_addl_card);
      return c === '1' || c === 'M' || c === '';
    });
    return mainCard || candidates[0];
  };

  // Step 1 of the modal: parse + match (no writes).
  const handleParsePwrCompPdf = async () => {
    if (!pwrCompPdfFile) return;
    setPwrCompPdfParsing(true);
    setPwrCompPdfPreview(null);
    setPwrCompPdfSaveResult(null);
    try {
      // NOTE: pdfjs transfers ownership of the Uint8Array we hand it to its
      // worker, which detaches the underlying ArrayBuffer. If we later pass
      // those same bytes to pdf-lib it sees an empty buffer and throws
      // "No PDF header found". So we keep one pristine copy for pdf-lib and
      // give pdfjs its own copy to consume.
      const original = new Uint8Array(await pwrCompPdfFile.arrayBuffer());
      setPwrCompPdfBytes(original);
      const forParser = new Uint8Array(original); // independent copy
      const parsed = await parsePowerCompPdf(forParser);
      const packets = parsed.packets.map((pkt) => {
        const match = matchPacketToProperty(pkt);
        return {
          ...pkt,
          matchedKey: match ? match.property_composite_key : null,
          matchedAddress: match ? match.property_location : null,
        };
      });
      setPwrCompPdfPreview({ totalPages: parsed.totalPages, packets });
    } catch (err) {
      console.error('PowerComp PDF parse error:', err);
      alert(`Could not read that PDF: ${err.message}`);
    } finally {
      setPwrCompPdfParsing(false);
    }
  };

  // Step 2 of the modal: build per-subject sub-PDFs, upload, upsert metadata.
  const handleSavePwrCompPackets = async () => {
    if (!pwrCompPdfPreview || !pwrCompPdfBytes || !jobData?.id) return;
    const matched = pwrCompPdfPreview.packets.filter(
      (p) => p.matchedKey && p.photoPageIndices.length > 0,
    );
    if (!matched.length) {
      alert('No matched packets with photo pages to save.');
      return;
    }
    setPwrCompPdfSaving(true);
    setPwrCompPdfSaveProgress({ current: 0, total: matched.length, label: '', status: 'uploading' });
    let saved = 0, replaced = 0, failed = 0;
    try {
      for (let i = 0; i < matched.length; i++) {
        const pkt = matched[i];
        const label = `${pkt.block}-${pkt.lot}${pkt.qualifier ? '-' + pkt.qualifier : ''}${pkt.card ? ' / ' + pkt.card : ''}`;
        setPwrCompPdfSaveProgress({ current: i + 1, total: matched.length, label, status: 'uploading' });
        try {
          // Look up the appeal number for this subject so the photo
          // packet header can show "Appeal #: ..." like the rest of the
          // report. Falls back to '' if no appeal is on file.
          const matchingAppeal = appeals.find(
            (a) =>
              (a.property_composite_key || '') === pkt.matchedKey,
          );
          const appealNumber = matchingAppeal?.appeal_number || '';
          // Give pdf-lib its own copy so nothing downstream can detach our master bytes.
          const subPdf = await buildPhotoPacketPdf(
            new Uint8Array(pwrCompPdfBytes),
            pkt,
            { appealNumber },
          );
          if (!subPdf) continue;
          const path = `${jobData.id}/${pkt.matchedKey}.pdf`;
          const { error: upErr } = await supabase
            .storage
            .from('powercomp-photos')
            .upload(path, subPdf, {
              contentType: 'application/pdf',
              upsert: true,
            });
          if (upErr) throw upErr;
          const wasExisting = !!photoPacketsByKey[pkt.matchedKey];
          const { error: dbErr } = await supabase
            .from('appeal_powercomp_photos')
            .upsert(
              {
                job_id: jobData.id,
                property_composite_key: pkt.matchedKey,
                storage_path: path,
                page_count: pkt.photoPageIndices.length,
                source_filename: pwrCompPdfFile?.name || null,
                imported_at: new Date().toISOString(),
              },
              { onConflict: 'job_id,property_composite_key' },
            );
          if (dbErr) throw dbErr;
          if (wasExisting) replaced++; else saved++;
        } catch (e) {
          console.error('packet save failed', pkt, e);
          failed++;
        }
      }
      await loadPhotoPackets();
      setPwrCompPdfSaveResult({ saved, replaced, failed });
      setPwrCompPdfSaveProgress((prev) => prev ? { ...prev, status: failed > 0 ? 'failed' : 'done' } : null);
    } finally {
      setPwrCompPdfSaving(false);
    }
  };

  const loadPhotoPackets = async () => {
    if (!jobData?.id) return;
    const { data, error } = await supabase
      .from('appeal_powercomp_photos')
      .select('property_composite_key, storage_path, page_count, source_filename, imported_at')
      .eq('job_id', jobData.id);
    if (error) {
      console.error('load photo packets failed', error);
      return;
    }
    const map = {};
    for (const row of data || []) map[row.property_composite_key] = row;
    setPhotoPacketsByKey(map);
  };

  const handleRemovePhotoPacket = async (compositeKey) => {
    const row = photoPacketsByKey[compositeKey];
    if (!row) return;
    if (!window.confirm('Remove the imported PowerComp photo packet for this subject?')) return;
    await supabase.storage.from('powercomp-photos').remove([row.storage_path]);
    await supabase
      .from('appeal_powercomp_photos')
      .delete()
      .eq('job_id', jobData.id)
      .eq('property_composite_key', compositeKey);
    await loadPhotoPackets();
  };

  const handlePreviewPhotoPacket = async (compositeKey) => {
    const row = photoPacketsByKey[compositeKey];
    if (!row) return;
    const { data, error } = await supabase
      .storage
      .from('powercomp-photos')
      .createSignedUrl(row.storage_path, 60 * 5);
    if (error) {
      alert(`Could not open packet: ${error.message}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  // ==================== APPEAL REPORT (bucket-backed, per-row + batch) ====================

  // Build the composite key the same way the matcher / metadata layer does.
  const compositeKeyForAppeal = (appeal) => {
    if (!appeal) return '';
    if (appeal.property_composite_key) return appeal.property_composite_key;
    const norm = (v) => (v == null ? '' : String(v).trim());
    return `${norm(appeal.property_block)}-${norm(appeal.property_lot)}-${norm(appeal.property_qualifier)}`;
  };

  // Whatever PDF was last uploaded to appeal-reports for this subject *is* the
  // defense report. No more interpreting saved CME sets — that decision is made
  // on the Detailed tab when the user clicks "Save to Appeal Log".
  const getReportForAppeal = (appeal) => {
    if (!appeal) return null;
    const key = compositeKeyForAppeal(appeal);
    return appealReportsByKey[key] || null;
  };

  const muniLabel = (jobData?.municipality || jobData?.name || '').toString();

  const fetchPhotoPacketBytes = async (compositeKey) => {
    const meta = photoPacketsByKey[compositeKey];
    if (!meta) return null;
    const { data, error } = await supabase
      .storage
      .from('powercomp-photos')
      .download(meta.storage_path);
    if (error || !data) {
      console.warn('photo packet download failed', meta, error);
      return null;
    }
    return new Uint8Array(await data.arrayBuffer());
  };

  // Download the saved appeal report PDF for this subject from the bucket and,
  // if a PowerComp photo packet exists, append its pages using pdf-lib.
  // Returns Uint8Array of the merged PDF, or null if no report exists.
  const buildPrintablePdfForAppeal = async (appeal) => {
    const reportMeta = getReportForAppeal(appeal);
    if (!reportMeta) return { bytes: null, hasPhotos: false };

    const { data: rptBlob, error: rptErr } = await supabase
      .storage
      .from('appeal-reports')
      .download(reportMeta.storage_path);
    if (rptErr || !rptBlob) {
      throw new Error(`Could not download saved report: ${rptErr?.message || 'unknown error'}`);
    }
    const reportBytes = new Uint8Array(await rptBlob.arrayBuffer());

    const key = compositeKeyForAppeal(appeal);
    const photoBytes = await fetchPhotoPacketBytes(key);

    // Even with no photos, we still want to enforce the canonical section
    // order in the saved report:
    //   1. Static comp grid (Detailed Evaluation)
    //   2. Dynamic Adjustments
    //   3. PowerComp photo packet (if present)
    //   4. Subject & Comps Location Map (if present)
    //   5. Appellant Evidence Summary (if present)
    //   6. Chapter 123 Test (Director's Ratio)
    // Anything we can't classify gets appended at the end in its original
    // order so we never silently drop a page.
    let PDFDocument;
    try {
      ({ PDFDocument } = await import('pdf-lib'));
    } catch (err) {
      if (/Loading chunk|Failed to fetch dynamically imported module/i.test(err?.message || '')) {
        throw new Error('App was updated since this tab loaded. Please refresh the page and try again.');
      }
      throw err;
    }
    const reportDoc = await PDFDocument.load(reportBytes);

    // Classify each report page by scanning its text content.
    const buckets = {
      static: [],
      dynamic: [],
      photos: [], // NEW: subject + comps photos page emitted by DetailedAppraisalGrid from appeal_photos
      map: [],
      appellant: [],
      chapter123: [],
      other: [],
    };
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
      const scanCopy = new Uint8Array(reportBytes.byteLength);
      scanCopy.set(reportBytes);
      const loadingTask = pdfjs.getDocument({ data: scanCopy });
      const pdfDoc = await loadingTask.promise;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((it) => it.str).join(' ').toLowerCase();
        const idx = i - 1;
        if (text.includes('chapter 123')) {
          buckets.chapter123.push(idx);
        } else if (text.includes('subject & comps photos') || text.includes('subject &amp; comps photos')) {
          buckets.photos.push(idx);
        } else if (text.includes('subject & comps location map') || text.includes('subject &amp; comps location map')) {
          buckets.map.push(idx);
        } else if (text.includes('appellant evidence summary') || text.includes('no evidence supplied by appellant')) {
          buckets.appellant.push(idx);
        } else if (text.includes('dynamic adjustments')) {
          buckets.dynamic.push(idx);
        } else if (text.includes('detailed evaluation') || idx === 0) {
          // First page (or any page that includes the comp grid header) is
          // treated as the static section. Defaulting to page 0 keeps things
          // sane for legacy exports that don't carry the literal header text.
          buckets.static.push(idx);
        } else {
          buckets.other.push(idx);
        }
        try { await page.cleanup?.(); } catch (_) {}
      }
      try { await pdfDoc.destroy(); } catch (_) {}
    } catch (e) {
      // If the scan fails for any reason, fall back to original order with
      // photos appended at the end — same as legacy behavior.
      console.warn('pdfjs section scan failed; falling back to original order', e);
      buckets.static = reportDoc.getPageIndices();
    }

    const out = await PDFDocument.create();
    const reportPages = await out.copyPages(reportDoc, reportDoc.getPageIndices());
    const addReportRange = (indices) => {
      for (const i of indices) {
        if (i >= 0 && i < reportPages.length) out.addPage(reportPages[i]);
      }
    };

    // 1. Static comp grid
    addReportRange(buckets.static);
    // 2. Dynamic Adjustments
    addReportRange(buckets.dynamic);
    // 3a. Direct-from-folder Photos page (new appeal_photos workflow). Always
    //     preferred over the legacy PowerComp packet when present.
    addReportRange(buckets.photos);
    // 3b. Legacy PowerComp photo packet (fallback for pre-appeal_photos reports)
    let hasPhotos = buckets.photos.length > 0;
    if (photoBytes && !hasPhotos) {
      const photoDoc = await PDFDocument.load(photoBytes);
      const photoPages = await out.copyPages(photoDoc, photoDoc.getPageIndices());
      for (const p of photoPages) out.addPage(p);
      hasPhotos = true;
    }
    // 4. Map
    addReportRange(buckets.map);
    // 5. Appellant Evidence
    addReportRange(buckets.appellant);
    // 6. Chapter 123
    addReportRange(buckets.chapter123);
    // Anything we couldn't classify
    addReportRange(buckets.other);

    // Safety: if classification missed every page (shouldn't happen), make
    // sure we don't return an empty PDF.
    if (out.getPageCount() === 0) {
      for (const p of reportPages) out.addPage(p);
      if (photoBytes) {
        const photoDoc = await PDFDocument.load(photoBytes);
        const photoPages = await out.copyPages(photoDoc, photoDoc.getPageIndices());
        for (const p of photoPages) out.addPage(p);
        hasPhotos = true;
      }
    }

    return { bytes: await out.save(), hasPhotos };
  };

  const handlePrintAppeal = async (appeal) => {
    if (!appeal) return;
    const reportMeta = getReportForAppeal(appeal);
    if (!reportMeta) {
      alert('No saved report on file for this subject. Run CME → Detailed → check "Save to Appeal Log" → Download PDF first.');
      return;
    }
    setPrintingAppealId(appeal.id);
    try {
      const { bytes, hasPhotos } = await buildPrintablePdfForAppeal(appeal);
      const key = compositeKeyForAppeal(appeal);
      const base = safeFilenamePart(appeal.appeal_number || key || 'report');
      const fname = `Appeal_${base}${hasPhotos ? '_with_Photos' : ''}.pdf`;
      downloadPdf(bytes, fname);
    } catch (e) {
      console.error('Print appeal failed', e);
      alert(`Could not print appeal report: ${e.message}`);
    } finally {
      setPrintingAppealId(null);
    }
  };

  const handleRunBatchPrint = async () => {
    const sourceList =
      batchPrintScope === 'selected'
        ? filteredAppeals.filter((a) => selectedAppeals.has(a.id))
        : filteredAppeals;
    if (!sourceList.length) {
      alert('Nothing to print for the selected scope.');
      return;
    }
    setBatchPrintRunning(true);
    setBatchPrintResult(null);
    setBatchPrintProgress({ current: 0, total: sourceList.length, label: '' });
    let built = 0, withPhotos = 0, failed = 0, skipped = 0;
    const reports = [];
    try {
      for (let i = 0; i < sourceList.length; i++) {
        const appeal = sourceList[i];
        const key = compositeKeyForAppeal(appeal);
        const label =
          `${appeal.property_block || '-'}-${appeal.property_lot || '-'}` +
          (appeal.property_qualifier ? `-${appeal.property_qualifier}` : '');
        setBatchPrintProgress({ current: i + 1, total: sourceList.length, label });
        try {
          const reportMeta = getReportForAppeal(appeal);
          if (!reportMeta) {
            skipped++;
            continue; // No saved report, skip silently.
          }
          const { bytes, hasPhotos } = await buildPrintablePdfForAppeal(appeal);
          if (!bytes) {
            skipped++;
            continue;
          }
          if (hasPhotos) withPhotos++;
          built++;
          const base = safeFilenamePart(appeal.appeal_number || label);
          const fname = `Appeal_${base}${hasPhotos ? '_with_Photos' : ''}.pdf`;
          reports.push({ filename: fname, bytes });
        } catch (e) {
          console.error('batch report failed', appeal, e);
          failed++;
        }
      }
      if (reports.length === 1) {
        downloadPdf(reports[0].bytes, reports[0].filename);
      } else if (reports.length > 1) {
        const muni = safeFilenamePart(muniLabel || 'job');
        const stamp = new Date().toISOString().slice(0, 10);
        await downloadAppealReportsZip(reports, `${muni}_appeal_reports_${stamp}.zip`);
      }
      setBatchPrintResult({ built, withPhotos, failed, skipped });
    } finally {
      setBatchPrintRunning(false);
    }
  };

  // ==================== BULK UPLOAD EXISTING APPEAL REPORT PDFs ====================
  // Auto-matches each file by the CME export naming convention:
  //   CME_<ccdd>_<block>_<lot>[_<qualifier>].pdf
  // Matched files upsert into the appeal-reports bucket and metadata table.
  // Unmatched files are listed so the user can decide what to do.

  const parseCmeFilename = (filename) => {
    if (!filename) return null;
    const m = String(filename).match(/^CME_[^_]+_([^_]+)_([^_.]+)(?:_([^.]+))?\.pdf$/i);
    if (!m) return null;
    const [, block, lot, qualifier] = m;
    return {
      block: block || '',
      lot: lot || '',
      qualifier: qualifier || '',
      key: `${block}-${lot}-${qualifier || ''}`,
    };
  };

  const matchUploadFileToProperty = (parsed) => {
    if (!parsed) return null;
    const norm = (v) => (v == null ? '' : String(v).trim().toUpperCase());
    return properties.find((p) =>
      norm(p.property_block) === norm(parsed.block) &&
      norm(p.property_lot) === norm(parsed.lot) &&
      norm(p.property_qualifier) === norm(parsed.qualifier),
    ) || null;
  };

  const handleBulkUploadFilesChosen = (fileList) => {
    const arr = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name));
    const enriched = arr.map((file) => {
      const parsed = parseCmeFilename(file.name);
      const property = parsed ? matchUploadFileToProperty(parsed) : null;
      const key = property ? property.property_composite_key : (parsed ? parsed.key : null);
      return {
        file,
        parsedKey: key,
        matchedAddress: property ? property.property_location : null,
        status: parsed && property ? 'ready' : (parsed ? 'no_property' : 'unparseable'),
        message: parsed && property
          ? null
          : (parsed ? `No property in this job matches ${parsed.key}` : 'Filename does not match CME naming pattern'),
      };
    });
    setBulkUploadFiles(enriched);
  };

  const handleRunBulkUpload = async () => {
    if (!jobData?.id) return;
    const ready = bulkUploadFiles.filter((f) => f.status === 'ready');
    if (!ready.length) {
      alert('No files match the CME naming pattern AND a property in this job.');
      return;
    }
    setBulkUploadRunning(true);
    setBulkUploadProgress({ current: 0, total: ready.length, label: '' });
    let uploaded = 0, failed = 0;
    try {
      for (let i = 0; i < ready.length; i++) {
        const item = ready[i];
        setBulkUploadProgress({ current: i + 1, total: ready.length, label: item.file.name });
        try {
          const path = `${jobData.id}/${item.parsedKey}.pdf`;
          const { error: upErr } = await supabase
            .storage
            .from('appeal-reports')
            .upload(path, item.file, {
              contentType: 'application/pdf',
              upsert: true,
            });
          if (upErr) throw upErr;
          const { error: dbErr } = await supabase
            .from('appeal_reports')
            .upsert(
              {
                job_id: jobData.id,
                property_composite_key: item.parsedKey,
                storage_path: path,
                source_filename: item.file.name,
                uploaded_at: new Date().toISOString(),
              },
              { onConflict: 'job_id,property_composite_key' },
            );
          if (dbErr) throw dbErr;
          uploaded++;
        } catch (e) {
          console.error('bulk upload row failed', item, e);
          failed++;
        }
      }
      await loadAppealReports();
      alert(`Done. ✓ ${uploaded} uploaded${failed ? ` · ✗ ${failed} failed` : ''}.`);
      setBulkUploadFiles([]);
    } finally {
      setBulkUploadRunning(false);
      setBulkUploadProgress(null);
    }
  };

  // ==================== EXPORT HANDLER ====================

  const handleExportToExcel = () => {
    if (filteredAppeals.length === 0) {
      alert('No appeals to export');
      return;
    }

    // Format a Postgres date (YYYY-MM-DD or YYYY-MM-DDT...) without any
    // timezone shift. `new Date('2026-05-14')` parses as UTC midnight and
    // toLocaleDateString() then shifts it back to local time, which in any
    // tz west of UTC drops a day (5/14 -> 5/13). Matches the UI helper at
    // line ~847.
    const formatDateLocal = (dateVal) => {
      if (!dateVal) return '-';
      const str = String(dateVal);
      const datePart = str.split('T')[0];
      const parts = datePart.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          const local = new Date(y, m - 1, d);
          return local.toLocaleDateString();
        }
      }
      // Fallback for non-ISO strings (e.g. already formatted)
      const fallback = new Date(dateVal);
      return isNaN(fallback.getTime()) ? '-' : fallback.toLocaleDateString();
    };

    // Prepare data for export with all available fields
    const exportData = filteredAppeals.map(appeal => {
      // Get property for bracket and inspection data
      const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);

      // Compute bracket the same way as UI
      let bracketLabel = appeal.cme_bracket; // Manual override if set
      if (!bracketLabel && property && property.new_vcs) {
        // Try vcsBracketMap first
        bracketLabel = vcsBracketMap[property.new_vcs];
        // Fall back to cmeBracketMappings
        if (!bracketLabel) {
          bracketLabel = cmeBracketMappings[property.new_vcs];
        }
      }

      // Get inspection info from property — parse YYYY-MM-DD locally
      // (no timezone shift) so the date matches what's shown in the UI.
      let inspectionDate = null;
      if (property && property.inspection_list_by && property.inspection_list_date) {
        const str = String(property.inspection_list_date).split('T')[0];
        const parts = str.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const mo = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          if (!isNaN(y) && !isNaN(mo) && !isNaN(d)) {
            const month = String(mo).padStart(2, '0');
            const day = String(d).padStart(2, '0');
            inspectionDate = `${month}/${day}/${y}`;
          }
        }
      }

      return {
        Status: appeal.status || '-',
        'Appeal #': appeal.appeal_number || '-',
        'Appeal Year': appeal.appeal_year || '-',
        Block: appeal.property_block || '-',
        Lot: appeal.property_lot || '-',
        Qual: appeal.property_qualifier || '-',
        Location: appeal.property_location || '-',
        Class: appeal.property_m4_class || '-',
        'T/U': appeal.asset_type_use || '-',
        VCS: appeal.new_vcs || '-',
        Bracket: bracketLabel || '-',
        Inspected: inspectionDate ? 'Yes' : 'No',
        'Last Inspection': inspectionDate || '-',
        Petitioner: appeal.petitioner_name || '-',
        'Petitioner Address': appeal.owner_street || '-',
        'Petitioner City/State': appeal.owner_csz || '-',
        Taxpayer: appeal.taxpayer_name || '-',
        Attorney: appeal.attorney || '-',
        'Atty Address': appeal.attorney_address || '-',
        'Atty City/State': appeal.attorney_city_state || '-',
        'Atty Phone': appeal.attorney_phone || '-',
        'Atty Email': appeal.attorney_email || '-',
        'Evidence Due': formatDateLocal(appeal.evidence_due_date),
        'Hearing Date': formatDateLocal(appeal.hearing_date),
        'Evidence Status': appeal.evidence_status || '-',
        'Submission Type': appeal.submission_type || '-',
        'Stip Status': appeal.stip_status || '-',
        'Tax Court': appeal.tax_court_pending ? 'Yes' : 'No',
        'Current Assessment': appeal.current_assessment || 0,
        'Requested Value': appeal.requested_value || 0,
        'CME Value': appeal.cme_projected_value || 0,
        'Ratio': (() => {
          // Director's ratio first, fallback to equalization ratio, cap at 100%
          let ratio = 1.0;
          if (jobData?.director_ratio) {
            ratio = parseFloat(jobData.director_ratio);
            if (ratio > 1) ratio = ratio / 100;
          } else if (marketLandData?.normalization_config?.equalizationRatio) {
            ratio = parseFloat(marketLandData.normalization_config.equalizationRatio);
            if (ratio > 1) ratio = ratio / 100;
          }
          return Math.min(ratio, 1.0);
        })(),
        'CME Assessment': (() => {
          const cmeValue = appeal.cme_projected_value || 0;
          if (!cmeValue) return 0;
          let ratio = 1.0;
          if (jobData?.director_ratio) {
            ratio = parseFloat(jobData.director_ratio);
            if (ratio > 1) ratio = ratio / 100;
          } else if (marketLandData?.normalization_config?.equalizationRatio) {
            ratio = parseFloat(marketLandData.normalization_config.equalizationRatio);
            if (ratio > 1) ratio = ratio / 100;
          }
          ratio = Math.min(ratio, 1.0);
          return Math.round(cmeValue * ratio);
        })(),
        Judgment: appeal.judgment_value || 0,
        Loss: '',  // Will be populated with formula
        'Loss %': '',  // Will be populated with formula
        'Possible Loss': (() => {
          const cmeValue = appeal.cme_projected_value || 0;
          if (!cmeValue) return appeal.possible_loss || 0;
          let ratio = 1.0;
          if (jobData?.director_ratio) {
            ratio = parseFloat(jobData.director_ratio);
            if (ratio > 1) ratio = ratio / 100;
          } else if (marketLandData?.normalization_config?.equalizationRatio) {
            ratio = parseFloat(marketLandData.normalization_config.equalizationRatio);
            if (ratio > 1) ratio = ratio / 100;
          }
          ratio = Math.min(ratio, 1.0);
          const cmeAssessment = Math.round(cmeValue * ratio);
          const currentAssessment = appeal.current_assessment || 0;
          // Loss only if CME assessment is less than current
          return cmeAssessment < currentAssessment ? currentAssessment - cmeAssessment : 0;
        })(),
        'Appeal Type': appeal.appeal_type || '-',
        'Status Code': appeal.status_code || '-',
        Result: appeal.result || '-',
        Comments: appeal.comments || '-',
        'Import Source': appeal.import_source || '-',
        'Import Date': appeal.import_date ? new Date(appeal.import_date).toLocaleDateString() : '-'
      };
    });

    // Create workbook with data
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Appeals');

    // Get headers from first row
    const headers = Object.keys(exportData[0] || {});
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Define styles matching other exports (Leelawadee, size 10)
    const baseStyle = {
      font: { name: 'Leelawadee', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' }
    };

    const headerStyle = {
      font: { name: 'Leelawadee', sz: 10, bold: true, color: { rgb: '000000' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      fill: { fgColor: { rgb: 'E2E8F0' }, patternType: 'solid' },
      border: { left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } }
    };

    // Set column widths - expand for readability
    ws['!cols'] = headers.map(key => {
      if (key.includes('Address') || key.includes('Comments')) return { wch: 30 };
      if (key.includes('Location') || key.includes('Petitioner') || key.includes('Attorney') || key === 'Taxpayer') return { wch: 28 };
      if (key.includes('Phone') || key.includes('Email') || key.includes('Inspection')) return { wch: 22 };
      if (key.includes('Assessment') || key.includes('Judgment') || key.includes('Loss') || key.includes('Value') || key.includes('CME')) return { wch: 20 };
      if (key.includes('Bracket')) return { wch: 18 };
      if (key.includes('Date')) return { wch: 16 };
      return { wch: 16 };
    });

    // CME Brackets with colors matching AdjustmentsTab definitions
    const CME_BRACKETS_COLORS = [
      { min: 0, max: 99999, color: 'FF9999' },           // up to $99,999
      { min: 100000, max: 199999, color: 'FFB366' },     // $100K-$199K
      { min: 200000, max: 299999, color: 'FFCC99' },     // $200K-$299K
      { min: 300000, max: 399999, color: 'FFFF99' },     // $300K-$399K
      { min: 400000, max: 499999, color: 'CCFF99' },     // $400K-$499K
      { min: 500000, max: 749999, color: '99FF99' },     // $500K-$749K
      { min: 750000, max: 999999, color: '99CCFF' },     // $750K-$999K
      { min: 1000000, max: 1499999, color: '9999FF' },   // $1M-$1.5M
      { min: 1500000, max: 1999999, color: 'CC99FF' },   // $1.5M-$2M
      { min: 2000000, max: 99999999, color: 'FF99FF' }   // Over $2M
    ];

    // Function to get bracket color based on judgment value
    const getBracketColor = (value) => {
      if (!value || value === 0) return 'FFFFFF';
      const numValue = Number(value);
      for (let bracket of CME_BRACKETS_COLORS) {
        if (numValue >= bracket.min && numValue <= bracket.max) {
          return bracket.color;
        }
      }
      return 'FFFFFF';
    };

    // Format cells
    const currencyColumns = ['Current Assessment', 'Requested Value', 'CME Value', 'CME Assessment', 'Judgment', 'Loss', 'Possible Loss'];
    const percentColumns = ['Loss %'];
    const textColumns = ['Block', 'Lot', 'Qual', 'Card'];

    // Define a function to create proper cell style
    const getCellStyle = (columnName, bgFill, isFormula = false) => {
      const thinBorder = { style: 'thin', color: { rgb: 'D0D0D0' } };
      const baseStyle = {
        font: { name: 'Leelawadee', sz: 10, color: { rgb: '000000' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        fill: bgFill,
        border: { left: thinBorder, right: thinBorder, top: thinBorder, bottom: thinBorder }
      };

      if (currencyColumns.includes(columnName)) {
        return { ...baseStyle, numFmt: '$#,##0' };
      }
      if (percentColumns.includes(columnName)) {
        return { ...baseStyle, numFmt: '0%' };
      }
      if (textColumns.includes(columnName)) {
        return { ...baseStyle, numFmt: '@' };  // Text format
      }

      return baseStyle;
    };

    // Format header row
    for (let C = 0; C < headers.length; C++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws[cellRef]) {
        ws[cellRef].s = headerStyle;
      }
    }

    // Find column indices for Loss and Loss % and Judgment/Current Assessment
    const lossColIndex = headers.indexOf('Loss');
    const lossPctColIndex = headers.indexOf('Loss %');
    const judgmentColIndex = headers.indexOf('Judgment');
    const currentAssessmentColIndex = headers.indexOf('Current Assessment');

    // Helper: Get bracket color by bracket label (not judgment value)
    const getBracketColorByLabel = (label) => {
      const bracket = CME_BRACKETS.find(b => b.label === label);
      return bracket ? bracket.color.substring(1) : 'FFFFFF';  // Remove # and convert to hex
    };

    // Format data rows
    const defaultBgFill = { fgColor: { rgb: 'FFFFFF' }, patternType: 'solid' };
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 0; C < headers.length; C++) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const columnName = headers[C];

        if (!ws[cellRef]) ws[cellRef] = {};

        // For Bracket column, use bracket-specific color; all other columns use white
        let cellBgFill = defaultBgFill;
        if (C === headers.indexOf('Bracket')) {
          const bracketLabel = exportData[R - 1]?.Bracket || '-';
          const bracketColorHex = getBracketColorByLabel(bracketLabel);
          cellBgFill = { fgColor: { rgb: bracketColorHex }, patternType: 'solid' };
        }

        // Get appropriate cell style
        const cellStyle = getCellStyle(columnName, cellBgFill);

        // Set formulas for Loss columns
        if (C === lossColIndex && judgmentColIndex >= 0 && currentAssessmentColIndex >= 0) {
          // Loss = Current Assessment - Judgment (using R+1 because R=1 is first data row = Excel row 2)
          const caColLetter = XLSX.utils.encode_col(currentAssessmentColIndex);
          const judgmentColLetter = XLSX.utils.encode_col(judgmentColIndex);
          ws[cellRef].f = `=${caColLetter}${R + 1}-${judgmentColLetter}${R + 1}`;
          ws[cellRef].s = cellStyle;
        } else if (C === lossPctColIndex && lossColIndex >= 0 && currentAssessmentColIndex >= 0) {
          // Loss % = Loss / Current Assessment (using R+1 for correct Excel row)
          const lossColLetter = XLSX.utils.encode_col(lossColIndex);
          const caColLetter = XLSX.utils.encode_col(currentAssessmentColIndex);
          ws[cellRef].f = `=${lossColLetter}${R + 1}/${caColLetter}${R + 1}`;
          ws[cellRef].s = cellStyle;
        } else {
          // For text columns, ensure text format is preserved
          if (textColumns.includes(columnName)) {
            ws[cellRef].t = 's';
          }
          ws[cellRef].s = cellStyle;
        }
      }
    }

    // Generate filename with job name and date
    const jobName = jobData?.job_name || 'Appeals';
    const timestamp = formatDateLocalYMD(new Date());
    const filename = `${jobName}_AppealLog_${timestamp}.xlsx`;

    // Add data validation dropdowns for Status Code and Stip Status
    const statusCodeColIndex = headers.indexOf('Status Code');
    const stipStatusColIndex = headers.indexOf('Stip Status');
    if (!ws['!dataValidation']) ws['!dataValidation'] = [];
    if (statusCodeColIndex >= 0) {
      ws['!dataValidation'].push({
        ref: `${XLSX.utils.encode_col(statusCodeColIndex)}2:${XLSX.utils.encode_col(statusCodeColIndex)}${range.e.r + 1}`,
        type: 'list',
        operator: 'equal',
        formula1: '"D,S,H,W,Z,A,AP,AWP,NA"',
        showDropDown: true
      });
    }
    if (stipStatusColIndex >= 0) {
      ws['!dataValidation'].push({
        ref: `${XLSX.utils.encode_col(stipStatusColIndex)}2:${XLSX.utils.encode_col(stipStatusColIndex)}${range.e.r + 1}`,
        type: 'list',
        operator: 'equal',
        formula1: '"not_started,drafted,sent,signed,filed"',
        showDropDown: true
      });
    }

    // Save file
    XLSX.writeFile(wb, filename);
  };

  // ==================== IMPORT HANDLER (Status Code + Stip Status from exported Excel) ====================
  const handleImportFromExport = async () => {
    if (!importExportFile) return;
    try {
      setImportExportProcessing(true);
      const arrayBuffer = await importExportFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      let updated = 0;
      let skipped = 0;
      let notFound = 0;
      let invalid = 0;

      for (const row of rows) {
        const appealNumber = String(row['Appeal #'] || '').trim();
        const appealYear = row['Appeal Year'];
        if (!appealNumber || appealNumber === '-' || !appealYear) {
          skipped++;
          continue;
        }

        // Find matching appeal
        const match = appeals.find(a =>
          String(a.appeal_number || '').trim() === appealNumber &&
          String(a.appeal_year) === String(appealYear)
        );
        if (!match) {
          notFound++;
          continue;
        }

        // Build update with only allowed fields
        const updateData = {};
        const newStatus = String(row['Status Code'] || '').trim();
        const newStip = String(row['Stip Status'] || '').trim();
        const validStatuses = ['D', 'S', 'H', 'W', 'Z', 'A', 'AP', 'AWP', 'NA'];
        const validStips = ['not_started', 'drafted', 'sent', 'signed', 'filed'];

        if (newStatus && newStatus !== '-') {
          if (validStatuses.includes(newStatus)) {
            if (newStatus !== (match.status_code || '')) updateData.status_code = newStatus;
          } else {
            invalid++;
          }
        }
        if (newStip && newStip !== '-') {
          if (validStips.includes(newStip)) {
            if (newStip !== (match.stip_status || '')) updateData.stip_status = newStip;
          } else {
            invalid++;
          }
        }

        // Hearing Date — parse from Excel and auto-calculate Evidence Due (7 days prior)
        const rawHearing = row['Hearing Date'];
        if (rawHearing && String(rawHearing).trim() !== '-' && String(rawHearing).trim() !== '') {
          let hearingDate = null;
          const rawStr = String(rawHearing).trim();
          // Handle Excel serial number dates
          if (typeof rawHearing === 'number') {
            const excelEpoch = new Date(1899, 11, 30);
            hearingDate = new Date(excelEpoch.getTime() + rawHearing * 86400000);
          } else {
            hearingDate = new Date(rawStr);
          }
          if (hearingDate && !isNaN(hearingDate.getTime())) {
            const hYear = hearingDate.getFullYear();
            const hMonth = String(hearingDate.getMonth() + 1).padStart(2, '0');
            const hDay = String(hearingDate.getDate()).padStart(2, '0');
            const hearingDateStr = `${hYear}-${hMonth}-${hDay}`;
            // Only update if different from current
            const currentHearing = match.hearing_date ? match.hearing_date.split('T')[0] : '';
            if (hearingDateStr !== currentHearing) {
              updateData.hearing_date = hearingDateStr;
              // Auto-calculate evidence due date (7 days prior)
              const evidenceDue = new Date(hearingDate);
              evidenceDue.setDate(evidenceDue.getDate() - 7);
              const eYear = evidenceDue.getFullYear();
              const eMonth = String(evidenceDue.getMonth() + 1).padStart(2, '0');
              const eDay = String(evidenceDue.getDate()).padStart(2, '0');
              updateData.evidence_due_date = `${eYear}-${eMonth}-${eDay}`;
            }
          }
        }

        if (Object.keys(updateData).length === 0) {
          skipped++;
          continue;
        }

        const { error } = await supabase
          .from('appeal_log')
          .update(updateData)
          .eq('id', match.id);

        if (!error) updated++;
        else skipped++;
      }

      // Refresh appeals
      const { data: fetchData } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .eq('appeal_year', selectedYear);

      if (fetchData) {
        const enrichedAppeals = (fetchData || []).map(appeal => {
          const property = properties.find(p =>
            p.property_block === appeal.property_block &&
            p.property_lot === appeal.property_lot &&
            (p.property_qualifier || '') === (appeal.property_qualifier || '')
          );
          const { appealType } = parseAppealNumber(appeal.appeal_number);
          return {
            ...appeal,
            appeal_type: appealType,
            property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
            asset_type_use: property?.asset_type_use || appeal.asset_type_use || null,
            new_vcs: property?.new_vcs || null,
            owner_name: property?.owner_name || null,
            owner_street: property?.owner_street || null,
            owner_csz: property?.owner_csz || null,
            property_block: appeal.property_block || property?.property_block || null,
            property_lot: appeal.property_lot || property?.property_lot || null,
            property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
            property_location: appeal.property_location || property?.property_location || null
          };
        });
        setAppeals(enrichedAppeals);
        computeAndEmitStats(enrichedAppeals);
        saveSnapshot(enrichedAppeals);
      }

      setImportExportResult({ updated, skipped, notFound, invalid, total: rows.length });
    } catch (error) {
      console.error('Import from export error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setImportExportProcessing(false);
    }
  };

  // ==================== EXPORT SAVED COMPS CSV (for BRT PowerComp) ====================
  // Two-step flow:
  //   1. handleOpenExportCsvModal() — fetch every saved result set, build a
  //      flat list of "candidates" (one per subject per result set). All
  //      candidates start checked. Opens the selection modal so the user can
  //      uncheck the runs they don't want shipped (e.g. an assessor run when
  //      they only want the appellant run, or a manager's rebuttal that
  //      shouldn't go to BRT).
  //   2. handleConfirmExportCsv() — build the CSV from the checked
  //      candidates only and trigger the download.
  // Only candidates with an appeal number are shown; PowerComp keys on the
  // appeal # so anything without one would be silently dropped anyway.
  const handleOpenExportCsvModal = async () => {
    if (!jobData?.id) return;
    setExportCsvLoading(true);
    try {
      const { data: resultSets, error } = await supabase
        .from('job_cme_result_sets')
        .select('id, name, created_at, updated_at, results')
        .eq('job_id', jobData.id)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      const norm = (v) => (v == null ? '' : String(v).trim());
      const compositeOf = (block, lot, qualifier) =>
        `${norm(block)}-${norm(lot)}-${norm(qualifier)}`;
      const appealByKey = new Map();
      (appeals || []).forEach(a => {
        const key = a.property_composite_key
          || compositeOf(a.property_block, a.property_lot, a.property_qualifier);
        if (key && !appealByKey.has(key)) appealByKey.set(key, a);
      });

      const candidates = [];
      (resultSets || []).forEach(rs => {
        (rs.results || []).forEach((r, idx) => {
          const subj = r?.subject;
          if (!subj) return;
          const subjKey = subj.property_composite_key
            || compositeOf(subj.property_block, subj.property_lot, subj.property_qualifier);
          if (!subjKey) return;
          const appeal = appealByKey.get(subjKey);
          if (!appeal?.appeal_number) return; // PowerComp needs an appeal #

          const comps = (Array.isArray(r.comparables) ? r.comparables : [])
            .filter(c => c && (c.property_block || c.property_lot));
          if (comps.length === 0) return;

          candidates.push({
            id: `${rs.id}::${subjKey}::${idx}`,
            checked: true,
            subjectKey: subjKey,
            subj_block: norm(subj.property_block),
            subj_lot: norm(subj.property_lot),
            subj_qualifier: norm(subj.property_qualifier),
            subj_address: subj.property_location || '',
            appeal_number: appeal.appeal_number,
            result_set_id: rs.id,
            result_set_name: rs.name || '(unnamed)',
            saved_at: rs.updated_at || rs.created_at || null,
            comps: comps.map(c => ({
              block: norm(c.property_block),
              lot: norm(c.property_lot),
              qualifier: norm(c.property_qualifier),
            })),
          });
        });
      });

      if (!candidates.length) {
        alert(
          'No saved result sets matched any appeals.\n\n' +
          'Run an evaluation in Sales Comparison (CME) → Search & Results, click "Save Result Set", ' +
          'then come back here. Only subjects with an appeal number are shown.'
        );
        return;
      }

      // Sort by subject (so multiple runs for the same subject appear
      // adjacent), then by saved date desc within each subject group.
      candidates.sort((a, b) => {
        if (a.subjectKey !== b.subjectKey) {
          return a.subjectKey.localeCompare(b.subjectKey);
        }
        return (b.saved_at || '').localeCompare(a.saved_at || '');
      });

      setExportCsvCandidates(candidates);
      setShowExportCsvModal(true);
    } catch (e) {
      console.error('Export saved comps CSV (open modal) failed:', e);
      alert('Could not load saved result sets: ' + (e?.message || e));
    } finally {
      setExportCsvLoading(false);
    }
  };

  const handleConfirmExportCsv = () => {
    const selected = exportCsvCandidates.filter(c => c.checked);
    if (!selected.length) {
      alert('Nothing selected — check at least one result set to export.');
      return;
    }

    const maxComps = selected.reduce((m, r) => Math.max(m, r.comps.length), 0);
    const header = ['Appeal #', 'Result Set', 'Subject Block', 'Subject Lot', 'Subject Qualifier'];
    for (let i = 1; i <= maxComps; i++) {
      header.push(`Comp ${i} Block`, `Comp ${i} Lot`, `Comp ${i} Qualifier`);
    }

    const escape = (val) => {
      const s = val == null ? '' : String(val);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    // Strict CSV — block/lot/qualifier values keep their exact string form
    // (including trailing zeros) inside the CSV structure itself. Excel may
    // reinterpret them as numbers on open, but PowerComp parses the raw CSV
    // and was rejecting the previous `="..."` formula-style wrappers.
    const lines = [header.map(escape).join(',')];
    selected.forEach(r => {
      const cells = [
        escape(r.appeal_number),
        escape(r.result_set_name),
        escape(r.subj_block),
        escape(r.subj_lot),
        escape(r.subj_qualifier),
      ];
      for (let i = 0; i < maxComps; i++) {
        const c = r.comps[i] || { block: '', lot: '', qualifier: '' };
        cells.push(escape(c.block), escape(c.lot), escape(c.qualifier));
      }
      lines.push(cells.join(','));
    });

    const csv = lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const muni = (jobData?.municipality || jobData?.name || 'job').replace(/[^A-Za-z0-9]+/g, '_');
    a.href = url;
    a.download = `${muni}_appeal_comps_${selectedYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportCsvModal(false);
  };

  const toggleExportCsvCandidate = (id) => {
    setExportCsvCandidates(prev =>
      prev.map(c => (c.id === id ? { ...c, checked: !c.checked } : c)),
    );
  };
  const setAllExportCsvCandidates = (checked) => {
    setExportCsvCandidates(prev => prev.map(c => ({ ...c, checked })));
  };

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* TOOLBAR */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 flex items-center gap-2"
          >
            + Add Appeal
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Appeal Year:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col items-stretch gap-0.5">
            <button
              onClick={() => { setShowImportModal(true); setImportResult(null); setImportFile(null); }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import MyNJAppeal
            </button>
            <span className="text-[10px] text-gray-500 text-center leading-tight">
              {mynjAppealLastImport
                ? `Last imported: ${formatLastImport(mynjAppealLastImport)}`
                : (appeals.some(a => a.appeal_number) ? 'Previously imported' : 'Never imported')}
            </span>
          </div>
          <div className="flex flex-col items-stretch gap-0.5">
            <button
              onClick={() => { setShowPwrCamaModal(true); setPwrCamaResult(null); setPwrCamaFile(null); }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import PwrCama Appeals
            </button>
            <span className="text-[10px] text-gray-500 text-center leading-tight">
              {pwrCamaLastImport
                ? `Last imported: ${formatLastImport(pwrCamaLastImport)}`
                : (appeals.some(a => a.appeal_number) ? 'Previously imported' : 'Never imported')}
            </span>
          </div>
          <button
            onClick={handleExportToExcel}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2"
          >
            📊 Export to Excel
          </button>
          <button
            onClick={() => { setShowImportExportModal(true); setImportExportResult(null); setImportExportFile(null); }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import from Export
          </button>
        </div>
      </div>

      {/* EMPTY STATE */}
      {filteredAppeals.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 bg-white rounded-lg border border-gray-200">
          <AlertCircle className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No Appeals Logged</p>
          <p className="text-sm text-gray-400 mt-1">Click \"+ Add Appeal\" to create one</p>
        </div>
      )}

      {/* STATS ROW 1 - TOTALS */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Appeals</p>
          <div className="mt-2">
            <p className="text-2xl font-bold text-gray-900">{stats.totalAppeals}</p>
            {areFiltersActive && <p className="text-xs text-gray-500 mt-1">(filtered)</p>}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Assessment Exposure</p>
          <p className="text-xl font-bold text-blue-600 mt-2">{formatCurrency(stats.totalAssessmentExposure)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">% of Ratables</p>
          <p className={`text-xl font-bold mt-2 ${
            stats.totalRatables === 0 ? 'text-gray-600' :
            stats.ratablePercent < 5 ? 'text-blue-600' :
            stats.ratablePercent < 10 ? 'text-amber-600' :
            'text-red-600'
          }`}>
            {stats.totalRatables === 0 ? 'N/A' : `${Math.round(stats.ratablePercent * 100) / 100}%`}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total Actual Loss</p>
          <p className="text-xl font-bold text-red-600 mt-2">{formatCurrency(stats.totalActualLoss)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Total % Loss</p>
          <p className="text-xl font-bold text-red-600 mt-2">{stats.totalLossPercent !== null ? `${Math.round(stats.totalLossPercent * 10) / 10}%` : '-'}</p>
        </div>
      </div>

      {/* STATS ROW 2 - BY STATUS TILES */}
      <div className="grid grid-cols-5 gap-4">
        {/* Tile 1: Defend / Heard */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Defend / Heard</p>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">D:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['D'] || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">H:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['H'] || 0}</span>
            </div>
          </div>
        </div>

        {/* Tile 2: Stipulated */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Stipulated</p>
          <div className="text-center">
            <span className="text-lg font-bold text-gray-900">S: {stats.statusCounts['S'] || 0}</span>
          </div>
        </div>

        {/* Tile 3: Assessor / Cross */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Assessor / Cross</p>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">A:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['A'] || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">X:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['X'] || 0}</span>
            </div>
          </div>
        </div>

        {/* Tile 4: Withdrawn / Non Appearance */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Withdrawn / Non Appearance</p>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">W:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['W'] || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">Z:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['Z'] || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">NA:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['NA'] || 0}</span>
            </div>
          </div>
        </div>

        {/* Tile 5: Affirmed */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Affirmed</p>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">AP:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['AP'] || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-600">AWP:</span>
              <span className="text-lg font-bold text-gray-900">{stats.statusCounts['AWP'] || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* STATS ROW 3 - BY CLASS */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Residential</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.residentialCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Commercial</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.commercialCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Vacant Land</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.vacantCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Other</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.otherCount}</p>
        </div>
      </div>

      {/* STATS ROW 4 - BY TYPE */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">By Type</p>
        <div className="flex gap-2 flex-wrap">
          {[
            { type: 'Petitioner', count: stats.petitionerCount, badge: 'bg-blue-100', text: 'text-blue-700' },
            { type: 'Represented', count: stats.representedCount, badge: 'bg-green-100', text: 'text-green-700' },
            { type: 'Assessor', count: stats.assessorCount, badge: 'bg-purple-100', text: 'text-purple-700' },
            { type: 'Cross', count: stats.crossCount, badge: 'bg-amber-100', text: 'text-amber-700' },
            { type: 'Unknown', count: stats.unknownTypeCount, badge: 'bg-gray-100', text: 'text-gray-700' }
          ].map(item => (
            <div key={item.type} className={`${item.badge} ${item.text} px-3 py-1 rounded-full text-sm font-medium`}>
              {item.type}: <span className="font-bold">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FILTER BAR - DROPDOWN WITH CHIPS */}
      <div className="space-y-4">
        {/* Filter Cards Grid */}
        <div className="grid grid-cols-2 gap-4">
          {/* STATUS FILTER CARD */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setPendingFilters(prev => ({
                    ...prev,
                    statuses: new Set([...prev.statuses, val])
                  }));
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">+ Add Status</option>
              {[
                { code: 'D', label: 'Defend' },
                { code: 'S', label: 'Stipulated' },
                { code: 'H', label: 'Heard' },
                { code: 'W', label: 'Withdrawn' },
                { code: 'Z', label: 'Dismissed' },
                { code: 'A', label: 'Assessor' },
                { code: 'AP', label: 'Affirmed w/Prejudice' },
                { code: 'AWP', label: 'Affirmed w/o Prejudice' },
                { code: 'NA', label: 'Non Appearance' }
              ]
                .filter(s => !pendingFilters.statuses.has(s.code))
                .map(s => (
                  <option key={s.code} value={s.code}>
                    {s.code} - {s.label}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 flex-wrap mt-3">
              {Array.from(pendingFilters.statuses).map(status => (
                <div
                  key={status}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                >
                  {status}
                  <button
                    onClick={() =>
                      setPendingFilters(prev => {
                        const newSet = new Set(prev.statuses);
                        newSet.delete(status);
                        return { ...prev, statuses: newSet };
                      })
                    }
                    className="text-blue-700 hover:text-blue-900 font-bold"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* CLASS FILTER CARD */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Class</label>
            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setPendingFilters(prev => ({
                    ...prev,
                    classes: new Set([...prev.classes, val])
                  }));
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">+ Add Class</option>
              {[
                { key: '2,3A', label: 'Residential' },
                { key: '4A,4B,4C', label: 'Commercial' },
                { key: '1,3B', label: 'Vacant Land' },
                { key: 'other', label: 'Other' }
              ]
                .filter(c => !pendingFilters.classes.has(c.key))
                .map(c => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 flex-wrap mt-3">
              {Array.from(pendingFilters.classes).map(classKey => {
                const labels = {
                  '2,3A': 'Residential',
                  '4A,4B,4C': 'Commercial',
                  '1,3B': 'Vacant Land',
                  'other': 'Other'
                };
                return (
                  <div
                    key={classKey}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                  >
                    {labels[classKey]}
                    <button
                      onClick={() =>
                        setPendingFilters(prev => {
                          const newSet = new Set(prev.classes);
                          newSet.delete(classKey);
                          return { ...prev, classes: newSet };
                        })
                      }
                      className="text-blue-700 hover:text-blue-900 font-bold"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* VCS FILTER CARD */}
          {uniqueVCS.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">VCS</label>
              <select
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) {
                    setPendingFilters(prev => ({
                      ...prev,
                      vcs: new Set([...prev.vcs, val])
                    }));
                    e.target.value = '';
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">+ Add VCS</option>
                {uniqueVCS
                  .sort()
                  .filter(v => !pendingFilters.vcs.has(v))
                  .map(vcs => (
                    <option key={vcs} value={vcs}>
                      {vcs}
                    </option>
                  ))}
              </select>
              <div className="flex gap-2 flex-wrap mt-3">
                {Array.from(pendingFilters.vcs).map(vcs => (
                  <div
                    key={vcs}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                  >
                    {vcs}
                    <button
                      onClick={() =>
                        setPendingFilters(prev => {
                          const newSet = new Set(prev.vcs);
                          newSet.delete(vcs);
                          return { ...prev, vcs: newSet };
                        })
                      }
                      className="text-blue-700 hover:text-blue-900 font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ATTORNEY FILTER CARD */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Attorney</label>
            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  setPendingFilters(prev => ({
                    ...prev,
                    attorneys: new Set([...prev.attorneys, val])
                  }));
                  e.target.value = '';
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">+ Add Attorney</option>
              {['Pro Se', ...uniqueAttorneys.sort()]
                .filter(a => !pendingFilters.attorneys.has(a))
                .map(attorney => (
                  <option key={attorney} value={attorney}>
                    {attorney.length > 20 ? attorney.substring(0, 20) + '...' : attorney}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 flex-wrap mt-3">
              {Array.from(pendingFilters.attorneys).map(attorney => (
                <div
                  key={attorney}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                  title={attorney}
                >
                  {attorney.length > 20 ? attorney.substring(0, 20) + '...' : attorney}
                  <button
                    onClick={() =>
                      setPendingFilters(prev => {
                        const newSet = new Set(prev.attorneys);
                        newSet.delete(attorney);
                        return { ...prev, attorneys: newSet };
                      })
                    }
                    className="text-blue-700 hover:text-blue-900 font-bold"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setFilters({
              statuses: new Set(pendingFilters.statuses),
              classes: new Set(pendingFilters.classes),
              attorneys: new Set(pendingFilters.attorneys),
              vcs: new Set(pendingFilters.vcs)
            })}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700"
          >
            Apply Filters
          </button>
          <button
            onClick={() => {
              const defaultPending = {
                statuses: new Set(['D', 'S', 'H', 'W', 'A', 'AP', 'AWP', 'NA']),
                classes: new Set(['2,3A', '4A,4B,4C', '1,3B', 'other']),
                attorneys: new Set(),
                vcs: new Set()
              };
              setPendingFilters(defaultPending);
              setFilters(defaultPending);
            }}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
          >
            Clear All
          </button>
          {areFiltersActive && (
            <p className="text-sm text-gray-500 ml-auto">
              Filtered: {filteredAppeals.length} of {appeals.length} appeals
            </p>
          )}
        </div>
      </div>

      {/* SEND TO CME TOOLBAR */}
      {selectedAppeals.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700">
              {selectedAppeals.size} selected
            </span>
            <button
              onClick={() => setShowBulkDateModal(true)}
              disabled={isSendingToCME}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bulk Apply Hearing Date
            </button>
            <button
              onClick={handleSendToCME}
              disabled={isSendingToCME}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSendingToCME ? '...' : 'Send to CME'}
            </button>
          </div>
          <button
            onClick={() => setSelectedAppeals(new Set())}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* MIXED BRACKET WARNING MODAL */}
      {showMixedBracketModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Mixed Brackets Detected</h2>
            <p className="text-sm text-gray-600 mb-4">
              You have selected properties across {mixedBracketInfo.count} different brackets:
            </p>
            <div className="space-y-2 mb-6 bg-gray-50 rounded p-3">
              {Object.entries(mixedBracketInfo.brackets || {}).map(([bracket, count]) => (
                <div key={bracket} className="flex justify-between text-sm">
                  <span className="text-gray-700">{bracket}</span>
                  <span className="font-medium text-gray-900">{count} {count === 1 ? 'property' : 'properties'}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mb-6">
              CME adjustments are bracket-specific. Mixing brackets may produce inaccurate results.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => proceedWithCMENavigation(Object.keys(mixedBracketInfo.brackets || {})[0])}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700"
              >
                Proceed Anyway
              </button>
              <button
                onClick={() => setShowMixedBracketModal(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK APPLY HEARING DATE MODAL */}
      {showBulkDateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Apply Hearing Date to Selected Appeals</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will apply the hearing date to all {selectedAppeals.size} selected appeal{selectedAppeals.size !== 1 ? 's' : ''} and automatically set the evidence due date 7 days prior.
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Hearing Date</label>
              <input
                type="date"
                value={bulkHearingDate}
                onChange={(e) => setBulkHearingDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowBulkDateModal(false);
                  setBulkHearingDate('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyBulkHearingDate}
                disabled={isApplyingBulkDate || !bulkHearingDate}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isApplyingBulkDate ? 'Applying...' : 'Apply to All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS LEGEND BAR */}
      <div className="bg-gray-50 border-t border-b border-gray-200 px-4 py-2 text-xs text-gray-600">
        <span className="font-medium">Status Legend:</span> D = Defend · S = Stipulated · H = Heard · W = Withdrawn · A = Assessor · AP = Affirmed w/ Prejudice · AWP = Affirmed w/o Prejudice · NA = Non Appearance
      </div>

      {/* TABLE - HORIZONTALLY SCROLLABLE WITH STICKY LEFT COLUMNS */}
      {filteredAppeals.length > 0 && (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-green-50 border-b border-gray-200">
              {/* CHECKBOX COLUMN */}
              <th className="sticky left-0 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-center border-r border-gray-200" style={{ minWidth: '50px', maxWidth: '50px' }}>
                {(() => {
                  const defendable = filteredAppeals.filter(a => (a.status || 'NA') === 'D');
                  const allDefendableSelected = defendable.length > 0 && defendable.every(a => selectedAppeals.has(a.id));
                  return (
                    <input
                      type="checkbox"
                      checked={allDefendableSelected}
                      disabled={defendable.length === 0}
                      onChange={handleToggleSelectAll}
                      title={defendable.length === 0 ? 'No defendable (status D) appeals to select' : 'Select all defendable (status D) appeals'}
                      className={`w-4 h-4 rounded border-gray-300 text-blue-600 ${defendable.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                    />
                  );
                })()}
              </th>
              {/* FROZEN LEFT COLUMNS */}
              <SortableHeader label="Status" columnKey="status" sticky={true} left="50px" minWidth="85px" maxWidth="85px" />
              <SortableHeader label="Appeal #" columnKey="appeal_number" sticky={true} left="135px" minWidth="120px" maxWidth="120px" />
              <SortableHeader label="Block" columnKey="block" sticky={true} left="255px" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Lot" columnKey="lot" sticky={true} left="315px" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Qual" columnKey="qualifier" minWidth="50px" maxWidth="50px" />
              <SortableHeader label="Location" columnKey="location" minWidth="120px" />
              <SortableHeader label="Class" columnKey="class" minWidth="50px" maxWidth="50px" />
              <SortableHeader label="T/U" columnKey="type_use" minWidth="40px" maxWidth="40px" />
              <SortableHeader label="VCS" columnKey="vcs" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Bracket" columnKey="bracket" minWidth="110px" maxWidth="110px" />
              <SortableHeader label="Inspected" columnKey="inspected" minWidth="90px" maxWidth="90px" />
              <SortableHeader label="Petitioner" columnKey="petitioner_name" minWidth="120px" />
              <SortableHeader label="Attorney" columnKey="attorney" minWidth="100px" />
              <SortableHeader label="Evidence" columnKey="evidence" minWidth="95px" maxWidth="95px" />
              <SortableHeader label="Hearing" columnKey="hearing_date" minWidth="120px" />
              <SortableHeader label="Tax Court" columnKey="tax_court_pending" minWidth="100px" />

              {/* VALUATION GROUP (always visible) */}
              <SortableHeader label="Current Assessment" columnKey="current_assessment" minWidth="120px" maxWidth="120px" />
              <SortableHeader label="CME Value" columnKey="cme_value" minWidth="100px" maxWidth="100px" />
              <SortableHeader label="Judgment" columnKey="judgment" minWidth="100px" maxWidth="100px" />
              <SortableHeader label="$Loss" columnKey="actual_loss" minWidth="100px" maxWidth="100px" />

              {/* DELETE COLUMN */}
              <th className="px-3 py-2 text-center font-medium text-gray-700">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredAppeals.map((appeal, idx) => {
              const ownerMismatch = hasOwnerMismatch(appeal);
              const acPercent = calculateACPercent(appeal);
              const evidenceDue = getEvidenceDueDate(appeal);
              const isResolved = ['S', 'W', 'Z', 'AWP', 'AP', 'NA', 'A'].includes(appeal.status);
              const resolvedBg = '#ecfdf5'; // pastel mint green
              const rowBg = selectedAppeals.has(appeal.id) ? 'bg-blue-50' : isResolved ? '' : 'hover:bg-gray-50';
              const textMuted = isResolved ? 'text-gray-500' : 'text-gray-600';
              const textStrong = isResolved ? 'text-gray-600' : 'text-gray-900';

              return (
                <tr key={idx} className={`border-b border-gray-100 ${rowBg}`} style={isResolved && !selectedAppeals.has(appeal.id) ? { backgroundColor: resolvedBg } : undefined}>
                  {/* CHECKBOX COLUMN */}
                  <td className="sticky left-0 z-10 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-center" style={{ minWidth: '50px', maxWidth: '50px', backgroundColor: selectedAppeals.has(appeal.id) ? '#eff6ff' : isResolved ? resolvedBg : '#fff' }}>
                    {(() => {
                      const isDefendable = (appeal.status || 'NA') === 'D';
                      return (
                        <input
                          type="checkbox"
                          checked={selectedAppeals.has(appeal.id)}
                          disabled={!isDefendable}
                          onChange={() => handleToggleAppealSelection(appeal.id)}
                          title={isDefendable ? '' : 'Only defendable (status D) appeals can be selected'}
                          className={`w-4 h-4 rounded border-gray-300 text-blue-600 ${isDefendable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                        />
                      );
                    })()}
                  </td>
                  {/* FROZEN LEFT COLUMNS */}
                  <td className="sticky z-10 px-3 py-2 whitespace-nowrap border-r border-gray-200" style={{ left: '50px', minWidth: '85px', maxWidth: '85px', backgroundColor: selectedAppeals.has(appeal.id) ? '#eff6ff' : isResolved ? resolvedBg : '#fff' }}>
                    <select
                      value={appeal.status === 'Pending' ? 'D' : (appeal.status || 'NA')}
                      onChange={(e) => handleDropdownChange(appeal.id, 'status', e.target.value || 'NA')}
                      className="px-1 py-0.5 border border-gray-300 rounded text-xs cursor-pointer"
                      style={{ width: '70px' }}
                    >
                      <option value="D">D</option>
                      <option value="S">S</option>
                      <option value="H">H</option>
                      <option value="W">W</option>
                      <option value="Z">Z</option>
                      <option value="A">A</option>
                      <option value="AP">AP</option>
                      <option value="AWP">AWP</option>
                      <option value="NA">NA</option>
                    </select>
                  </td>
                  <td className={`sticky z-10 px-3 py-2 whitespace-nowrap border-r border-gray-200 ${textStrong} font-medium`} style={{ left: '135px', minWidth: '120px', maxWidth: '120px', backgroundColor: selectedAppeals.has(appeal.id) ? '#eff6ff' : isResolved ? resolvedBg : '#fff' }}>
                    {renderEditableCell(appeal.id, 'appeal_number', appeal.appeal_number, 'text')}
                  </td>
                  <td className={`sticky z-10 px-3 py-2 whitespace-nowrap border-r border-gray-200 ${textStrong}`} style={{ left: '255px', minWidth: '60px', maxWidth: '60px', backgroundColor: selectedAppeals.has(appeal.id) ? '#eff6ff' : isResolved ? resolvedBg : '#fff' }}>{appeal.property_block || '-'}</td>
                  <td className={`sticky z-10 px-3 py-2 whitespace-nowrap border-r border-gray-200 ${textStrong}`} style={{ left: '315px', minWidth: '60px', maxWidth: '60px', backgroundColor: selectedAppeals.has(appeal.id) ? '#eff6ff' : isResolved ? resolvedBg : '#fff' }}>{appeal.property_lot || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '50px', maxWidth: '50px' }}>{appeal.property_qualifier || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '120px' }}>{appeal.property_location || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '50px', maxWidth: '50px' }}>{appeal.property_m4_class || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '40px', maxWidth: '40px' }}>{appeal.asset_type_use || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '60px', maxWidth: '60px' }}>{appeal.new_vcs || '-'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '110px', maxWidth: '110px' }}>
                    {renderBracketCell(appeal)}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '90px', maxWidth: '90px' }}>
                    {renderInspectedCell(appeal)}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'petitioner_name', appeal.petitioner_name, 'text')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '100px' }}>
                    {renderEditableCell(appeal.id, 'attorney', appeal.attorney, 'text')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-center" style={{ minWidth: '95px', maxWidth: '95px' }}>
                    {renderEvidenceCell(appeal)}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'hearing_date', appeal.hearing_date, 'date')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textMuted}`} style={{ minWidth: '100px' }}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={appeal.tax_court_pending || false}
                        onChange={(e) => handleDropdownChange(appeal.id, 'tax_court_pending', e.target.checked)}
                        className="w-4 h-4"
                      />
                    </label>
                  </td>

                  {/* VALUATION GROUP */}
                  <td className={`px-3 py-2 whitespace-nowrap ${textStrong} font-medium`} style={{ minWidth: '120px', maxWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'current_assessment', appeal.current_assessment, 'number')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${isResolved ? 'text-blue-400' : 'text-blue-600'} font-semibold`} style={{ minWidth: '100px', maxWidth: '100px' }}>
                    {renderEditableCell(appeal.id, 'cme_projected_value', appeal.cme_projected_value, 'number')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textStrong} font-medium`} style={{ minWidth: '100px', maxWidth: '100px' }}>
                    {renderEditableCell(appeal.id, 'judgment_value', appeal.judgment_value, 'number')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${appeal.judgment_value !== null && appeal.loss > 0 ? 'text-red-600' : 'text-gray-600'}`} style={{ minWidth: '100px', maxWidth: '100px' }}>
                    {appeal.judgment_value !== null && appeal.judgment_value !== undefined ? formatCurrency(appeal.loss) : '-'}
                  </td>

                  {/* ACTION BUTTONS */}
                  <td className="px-3 py-2 whitespace-nowrap text-center relative">
                    <div className="flex items-center justify-center gap-1">
                      {(() => {
                        const key = compositeKeyForAppeal(appeal);
                        const hasPacket = !!photoPacketsByKey[key];
                        const directPhoto = directPhotosByKey[key];
                        const hasDirect = !!directPhoto;
                        const reportMeta = appealReportsByKey[key];
                        const printable = !!reportMeta;
                        const chipClass = printable
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-gray-100 text-gray-500 border-gray-200';
                        const chipLabel = printable ? 'Report ✓' : 'No report';
                        const chipTitle = printable
                          ? `Report on file: ${reportMeta.source_filename || '(unnamed)'} · uploaded ${new Date(reportMeta.uploaded_at).toLocaleDateString()} · ${reportMeta.page_count || '?'} pages`
                          : 'No saved report. Run CME → Detailed → check "Save to Appeal Log" → Download PDF.';
                        return (
                          <>
                            <span
                              title={chipTitle}
                              className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${chipClass}`}
                            >
                              {chipLabel}
                            </span>
                            {hasDirect && (
                              <button
                                onClick={() => handlePreviewDirectPhoto(key)}
                                className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded"
                                title={`Direct photo on file (${directPhoto.original_filename || 'photo'}) — click to preview`}
                              >
                                <Camera className="w-4 h-4" />
                              </button>
                            )}
                            {hasPacket && (
                              <button
                                onClick={() => handlePreviewPhotoPacket(key)}
                                className="text-teal-600 hover:text-teal-800 p-1 hover:bg-teal-50 rounded"
                                title={`PowerComp photo packet on file (legacy) (${photoPacketsByKey[key].page_count || '?'} pages) — click to preview`}
                              >
                                <ImageIcon className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handlePrintAppeal(appeal)}
                              disabled={printingAppealId === appeal.id || !printable}
                              className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                              title={
                                !printable
                                  ? 'No saved report — generate one from CME → Detailed first'
                                  : (hasDirect
                                      ? 'Print Appeal Report (with direct photos embedded)'
                                      : (hasPacket ? 'Print Appeal Report (with PowerComp photos appended)' : 'Print Appeal Report'))
                              }
                            >
                              <Printer className={`w-4 h-4 ${printingAppealId === appeal.id ? 'animate-pulse' : ''}`} />
                            </button>
                            <button
                              onClick={() => handleDeleteAppeal(appeal.id)}
                              className="text-gray-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded"
                              title="Delete appeal"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* TOTALS ROW */}
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-gray-900">
              {/* Checkbox column */}
              <td style={{ minWidth: '50px', maxWidth: '50px' }}></td>
              {/* Status */}
              <td style={{ minWidth: '85px', maxWidth: '85px' }}></td>
              {/* Appeal # */}
              <td style={{ minWidth: '120px', maxWidth: '120px' }}></td>
              {/* Block */}
              <td style={{ minWidth: '60px', maxWidth: '60px' }}></td>
              {/* Lot */}
              <td style={{ minWidth: '60px', maxWidth: '60px' }}></td>
              {/* Qualifier */}
              <td style={{ minWidth: '50px', maxWidth: '50px' }}></td>
              {/* Location */}
              <td style={{ minWidth: '120px' }}></td>
              {/* Class */}
              <td style={{ minWidth: '50px', maxWidth: '50px' }}></td>
              {/* T/U */}
              <td style={{ minWidth: '40px', maxWidth: '40px' }}></td>
              {/* VCS */}
              <td style={{ minWidth: '60px', maxWidth: '60px' }}></td>
              {/* Bracket */}
              <td style={{ minWidth: '110px', maxWidth: '110px' }}></td>
              {/* Inspected */}
              <td style={{ minWidth: '90px', maxWidth: '90px' }}></td>
              {/* Petitioner */}
              <td style={{ minWidth: '120px' }}></td>
              {/* Attorney */}
              <td style={{ minWidth: '100px' }}></td>
              {/* Evidence */}
              <td style={{ minWidth: '95px', maxWidth: '95px' }}></td>
              {/* Hearing - TOTALS label goes here */}
              <td className="px-3 py-3 text-right" style={{ minWidth: '120px' }}>TOTALS:</td>
              {/* Tax Court */}
              <td style={{ minWidth: '100px' }}></td>
              {/* Current Assessment */}
              <td className="px-3 py-3 whitespace-nowrap text-right" style={{ minWidth: '120px', maxWidth: '120px' }}>{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.current_assessment || 0), 0))}</td>
              {/* CME Value */}
              <td className="px-3 py-3 whitespace-nowrap text-blue-600 text-right" style={{ minWidth: '100px', maxWidth: '100px' }}>{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (Number(a.cme_projected_value) || 0), 0))}</td>
              {/* Judgment */}
              <td className="px-3 py-3 whitespace-nowrap text-right" style={{ minWidth: '100px', maxWidth: '100px' }}>{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.judgment_value || 0), 0))}</td>
              {/* Loss */}
              <td className="px-3 py-3 whitespace-nowrap text-red-600 text-right" style={{ minWidth: '100px', maxWidth: '100px' }}>{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.loss || 0), 0))}</td>
              {/* Action */}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {/* POWERCOMP ROUND-TRIP ACTIONS (kept under the table to reduce toolbar crowding) */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold text-gray-800">PowerComp Round-Trip</p>
          <p className="text-xs text-gray-500">
            Export saved comps to BRT PowerComp, then re-import the returned Batch Taxpayer Report PDF to attach photo packets per subject.
          </p>
        </div>
        <button
          onClick={handleOpenExportCsvModal}
          disabled={exportCsvLoading}
          title="Pick which saved CME runs to ship to PowerComp (handy when a subject has multiple saved sets — assessor vs. appellant runs, etc.)"
          style={{ backgroundColor: '#ea580c', color: 'white' }}
          className="px-4 py-2 rounded-lg font-medium text-sm hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          {exportCsvLoading ? 'Loading…' : 'Export CSV (PowerComp)'}
        </button>
        <button
          onClick={() => {
            setShowPwrCompPdfModal(true);
            setPwrCompPdfFile(null);
            setPwrCompPdfBytes(null);
            setPwrCompPdfPreview(null);
            setPwrCompPdfSaveResult(null);
            setPwrCompPdfSaveProgress(null);
          }}
          title="Import a PowerComp Batch Taxpayer Report PDF and attach photo packets to each subject"
          style={{ backgroundColor: '#0f766e', color: 'white' }}
          className="px-4 py-2 rounded-lg font-medium text-sm hover:opacity-90 flex items-center gap-2"
        >
          <FileText className="w-4 h-4" />
          Import Batch PwrComp PDF
        </button>
        <button
          onClick={() => {
            setShowBatchPrintModal(true);
            setBatchPrintResult(null);
            setBatchPrintProgress(null);
            setBatchPrintScope(selectedAppeals.size > 0 ? 'selected' : 'filtered');
          }}
          title="Generate one Appeal Report PDF per subject (with photo packets where available) and download as a zip"
          style={{ backgroundColor: '#1d4ed8', color: 'white' }}
          className="px-4 py-2 rounded-lg font-medium text-sm hover:opacity-90 flex items-center gap-2"
        >
          <Printer className="w-4 h-4" />
          Batch Print Appeals
        </button>
        <button
          onClick={() => {
            setShowBulkUploadModal(true);
            setBulkUploadFiles([]);
            setBulkUploadProgress(null);
          }}
          title="Bulk-upload existing appeal report PDFs (auto-matched by CME filename) into the appeal-reports bucket"
          style={{ backgroundColor: '#7c3aed', color: 'white' }}
          className="px-4 py-2 rounded-lg font-medium text-sm hover:opacity-90 flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          Bulk Upload Reports
        </button>
      </div>

      {/* BULK UPLOAD MODAL */}
      {showBulkUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 flex flex-col gap-4 max-h-[85vh]">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Bulk Upload Appeal Reports</h2>
              <button onClick={() => setShowBulkUploadModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-gray-600">
              Drop or pick PDFs you've already exported from CME → Detailed. Files are auto-matched by their CME filename (<code>CME_ccdd_block_lot_qualifier.pdf</code>) to a property in this job and uploaded to the appeal-reports bucket. Existing entries are replaced.
            </div>

            <div className="border-2 border-dashed border-purple-300 rounded-lg p-6 text-center hover:bg-purple-50/40">
              <input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                id="bulk-upload-input"
                className="hidden"
                onChange={(e) => handleBulkUploadFilesChosen(e.target.files)}
              />
              <label htmlFor="bulk-upload-input" className="cursor-pointer">
                <Upload className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                <p className="text-sm text-gray-700">
                  {bulkUploadFiles.length > 0 ? `${bulkUploadFiles.length} file(s) selected — click to choose a different set` : 'Click to choose PDF files (multi-select)'}
                </p>
              </label>
            </div>

            {bulkUploadFiles.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex justify-between text-xs">
                  <span className="font-semibold text-gray-700">
                    {bulkUploadFiles.filter((f) => f.status === 'ready').length} ready · {bulkUploadFiles.filter((f) => f.status !== 'ready').length} need attention
                  </span>
                  <span className="text-gray-500">
                    ✓ ready · ⚠ no property match · ✗ unparseable
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-1.5">File</th>
                        <th className="text-left px-3 py-1.5">Subject</th>
                        <th className="text-center px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkUploadFiles.map((f, i) => (
                        <tr key={i} className={f.status === 'ready' ? '' : 'bg-amber-50/40'}>
                          <td className="px-3 py-1.5 font-mono truncate max-w-[280px]">{f.file.name}</td>
                          <td className="px-3 py-1.5">
                            {f.matchedAddress ? (
                              <span className="text-gray-700">{f.matchedAddress}</span>
                            ) : f.parsedKey ? (
                              <span className="text-amber-700">{f.parsedKey}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {f.status === 'ready'
                              ? <span className="text-green-700" title="Ready to upload">✓</span>
                              : f.status === 'no_property'
                                ? <span className="text-amber-700" title={f.message}>⚠</span>
                                : <span className="text-red-700" title={f.message}>✗</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {bulkUploadProgress && bulkUploadRunning && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-purple-800">
                    Uploading {bulkUploadProgress.current} of {bulkUploadProgress.total}
                  </span>
                  <span className="text-purple-700 font-mono text-xs truncate max-w-[280px]">{bulkUploadProgress.label}</span>
                </div>
                <div className="w-full bg-purple-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-purple-600 h-2 transition-all duration-200"
                    style={{
                      width: `${Math.round((bulkUploadProgress.current / bulkUploadProgress.total) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setShowBulkUploadModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={handleRunBulkUpload}
                disabled={bulkUploadRunning || !bulkUploadFiles.some((f) => f.status === 'ready')}
                style={{ backgroundColor: '#7c3aed', color: 'white' }}
                className="px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {bulkUploadRunning
                  ? (bulkUploadProgress ? `Uploading ${bulkUploadProgress.current}/${bulkUploadProgress.total}…` : 'Uploading…')
                  : 'Upload Selected'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BATCH PRINT MODAL */}
      {showBatchPrintModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900">Batch Print Appeals</h2>
              <button onClick={() => setShowBatchPrintModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-gray-600">
              Generates one Appeal Report PDF per subject. If two or more reports are produced
              they are bundled into a zip — no merged mega-PDF.
            </div>

            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="batchScope"
                  checked={batchPrintScope === 'selected'}
                  onChange={() => setBatchPrintScope('selected')}
                  disabled={selectedAppeals.size === 0}
                />
                <div>
                  <div className="font-medium text-gray-800">
                    Selected appeals ({selectedAppeals.size})
                  </div>
                  <div className="text-xs text-gray-500">
                    Only the rows you've checked in the table.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="batchScope"
                  checked={batchPrintScope === 'filtered'}
                  onChange={() => setBatchPrintScope('filtered')}
                />
                <div>
                  <div className="font-medium text-gray-800">
                    All currently visible appeals ({filteredAppeals.length})
                  </div>
                  <div className="text-xs text-gray-500">
                    Everything in the table given the current year/filter.
                  </div>
                </div>
              </label>
            </div>

            {batchPrintProgress && batchPrintRunning && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-blue-800">
                    Building report {batchPrintProgress.current} of {batchPrintProgress.total}
                  </span>
                  <span className="text-blue-700 font-mono text-xs">{batchPrintProgress.label}</span>
                </div>
                <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 transition-all duration-200"
                    style={{
                      width: `${Math.round(
                        (batchPrintProgress.current / batchPrintProgress.total) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {batchPrintResult && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-emerald-800">Done</p>
                <p className="text-emerald-700">
                  ✓ {batchPrintResult.built} report{batchPrintResult.built === 1 ? '' : 's'} built
                  · 📷 {batchPrintResult.withPhotos} with photo packet
                  {batchPrintResult.skipped > 0 ? ` · ⊘ ${batchPrintResult.skipped} skipped (no saved report)` : ''}
                  {batchPrintResult.failed > 0 ? ` · ✗ ${batchPrintResult.failed} failed` : ''}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setShowBatchPrintModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                {batchPrintResult ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={handleRunBatchPrint}
                disabled={batchPrintRunning}
                style={{ backgroundColor: '#1d4ed8', color: 'white' }}
                className="px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
              >
                {batchPrintRunning
                  ? (batchPrintProgress
                      ? `Building ${batchPrintProgress.current}/${batchPrintProgress.total}…`
                      : 'Building…')
                  : 'Build Reports'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {modalStep === 1 ? 'Add Appeal - Select Property' : 'Add Appeal - Enter Details'}
              </h2>
              <button onClick={handleCloseModal} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {modalStep === 1 ? (
                // STEP 1: PROPERTY SEARCH
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Search for Property</label>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Block</label>
                        <input
                          type="text"
                          placeholder="Enter block"
                          value={searchBlock}
                          onChange={(e) => {
                            setSearchBlock(e.target.value);
                            performPropertySearch(e.target.value, searchLot, searchQualifier);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Lot</label>
                        <input
                          type="text"
                          placeholder="Enter lot"
                          value={searchLot}
                          onChange={(e) => {
                            setSearchLot(e.target.value);
                            performPropertySearch(searchBlock, e.target.value, searchQualifier);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Qualifier <span className="text-gray-400">(optional)</span></label>
                        <input
                          type="text"
                          placeholder="Enter qualifier"
                          value={searchQualifier}
                          onChange={(e) => {
                            setSearchQualifier(e.target.value);
                            performPropertySearch(searchBlock, searchLot, e.target.value);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Block</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Lot</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Qual</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Location</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Owner Name</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Class</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700">Assessment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map((prop, idx) => (
                            <tr
                              key={idx}
                              className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                              onClick={() => handleSelectProperty(prop)}
                            >
                              <td className="px-3 py-2">{prop.property_block || '-'}</td>
                              <td className="px-3 py-2">{prop.property_lot || '-'}</td>
                              <td className="px-3 py-2">{prop.property_qualifier || '-'}</td>
                              <td className="px-3 py-2 truncate">{prop.property_location || '-'}</td>
                              <td className="px-3 py-2 truncate">{prop.owner_name || '-'}</td>
                              <td className="px-3 py-2">{prop.property_m4_class || '-'}</td>
                              <td className="px-3 py-2 text-right">{formatCurrency(prop.values_mod_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex gap-2 justify-end mt-4">
                    <button
                      onClick={handleCloseModal}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSkipSearch}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300"
                    >
                      Skip Search
                    </button>
                  </div>
                </div>
              ) : (
                // STEP 2: APPEAL DETAILS
                <div className="grid grid-cols-2 gap-6 max-h-80 overflow-y-auto">
                  {/* LEFT COLUMN */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Appeal Number</label>
                      <input
                        type="text"
                        value={formData.appeal_number}
                        onChange={(e) => handleFormChange('appeal_number', e.target.value)}
                        onBlur={handleAppealNumberBlur}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Appeal Year</label>
                      <input
                        type="number"
                        value={formData.appeal_year}
                        onChange={(e) => handleFormChange('appeal_year', parseInt(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => handleFormChange('status', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      >
                        <option value="">Select status...</option>
                        <option value="D">D - Defend</option>
                        <option value="S">S - Stipulated</option>
                        <option value="H">H - Heard</option>
                        <option value="W">W - Withdrawn</option>
                        <option value="A">A - Assessor</option>
                        <option value="AP">AP - Affirmed with Prejudice</option>
                        <option value="AWP">AWP - Affirmed without Prejudice</option>
                        <option value="NA">NA - Non Appearance</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Petitioner Name</label>
                      <input
                        type="text"
                        value={formData.petitioner_name}
                        onChange={(e) => handleFormChange('petitioner_name', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Taxpayer Name</label>
                      <input
                        type="text"
                        value={formData.taxpayer_name}
                        onChange={(e) => handleFormChange('taxpayer_name', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Attorney</label>
                      <input
                        type="text"
                        value={formData.attorney}
                        onChange={(e) => handleFormChange('attorney', e.target.value)}
                        disabled={attorneyFieldsDisabled}
                        placeholder={attorneyFieldsDisabled ? 'Pro Se — no legal rep' : ''}
                        className={`w-full px-2 py-1.5 border border-gray-300 rounded text-xs ${
                          attorneyFieldsDisabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Attorney Address</label>
                      <input
                        type="text"
                        value={formData.attorney_address}
                        onChange={(e) => handleFormChange('attorney_address', e.target.value)}
                        disabled={attorneyFieldsDisabled}
                        placeholder={attorneyFieldsDisabled ? 'Pro Se — no legal rep' : ''}
                        className={`w-full px-2 py-1.5 border border-gray-300 rounded text-xs ${
                          attorneyFieldsDisabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Attorney City/State</label>
                      <input
                        type="text"
                        value={formData.attorney_city_state}
                        onChange={(e) => handleFormChange('attorney_city_state', e.target.value)}
                        disabled={attorneyFieldsDisabled}
                        placeholder={attorneyFieldsDisabled ? 'Pro Se — no legal rep' : ''}
                        className={`w-full px-2 py-1.5 border border-gray-300 rounded text-xs ${
                          attorneyFieldsDisabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
                        }`}
                      />
                    </div>
                  </div>

                  {/* RIGHT COLUMN */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Current Assessment</label>
                      <input
                        type="number"
                        value={formData.current_assessment}
                        onChange={(e) => handleFormChange('current_assessment', parseFloat(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Requested Value</label>
                      <input
                        type="number"
                        value={formData.requested_value}
                        onChange={(e) => handleFormChange('requested_value', parseFloat(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Hearing Date</label>
                      <input
                        type="date"
                        value={formData.hearing_date}
                        onChange={(e) => handleFormChange('hearing_date', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Submission Type</label>
                      <select
                        value={formData.submission_type}
                        onChange={(e) => handleFormChange('submission_type', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      >
                        <option value="">-</option>
                        <option value="ONLINE">Online</option>
                        <option value="PAPER">Paper/Mail</option>
                        <option value="ELECTRONIC">Electronic</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Evidence Status</label>
                      <select
                        value={formData.evidence_status}
                        onChange={(e) => handleFormChange('evidence_status', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      >
                        <option value="">-</option>
                        <option value="None">None</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Exchanged">Exchanged</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Stip Status</label>
                      <select
                        value={formData.stip_status}
                        onChange={(e) => handleFormChange('stip_status', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs"
                      >
                        <option value="not_started">Not Started</option>
                        <option value="drafted">Drafted</option>
                        <option value="sent">Sent to Taxpayer</option>
                        <option value="signed">Signed</option>
                        <option value="filed">Filed</option>
                      </select>
                    </div>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.inspected}
                          onChange={(e) => handleFormChange('inspected', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-gray-700">Inspected</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.tax_court_pending}
                          onChange={(e) => handleFormChange('tax_court_pending', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-xs text-gray-700">Tax Court</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {modalStep === 2 && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <label className="block text-xs font-medium text-gray-700 mb-2">Comments</label>
                  <textarea
                    value={formData.comments}
                    onChange={(e) => handleFormChange('comments', e.target.value)}
                    className="w-full px-2 py-2 border border-gray-300 rounded text-xs"
                    rows="2"
                    placeholder="Add any comments"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 p-6 border-t border-gray-200 bg-gray-50">
              {modalStep === 2 && (
                <button
                  onClick={() => setModalStep(1)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-100"
              >
                Cancel
              </button>
              {modalStep === 2 && (
                <button
                  onClick={handleSaveAppeal}
                  disabled={isSaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Appeal'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Import Appeals from CSV</h2>
              <button onClick={() => setShowImportModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Supports the BRT online appeal system CSV export format.
                Duplicate appeal numbers will be skipped automatically.
              </p>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".csv"
                  id="import-csv-input"
                  className="hidden"
                  onChange={(e) => setImportFile(e.target.files[0] || null)}
                />
                <label htmlFor="import-csv-input" className="cursor-pointer">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    {importFile ? importFile.name : 'Click to select CSV file'}
                  </p>
                </label>
              </div>

              {importResult && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
                  <p className="font-semibold text-gray-800">Import Complete</p>
                  <p className="text-green-700">✓ {importResult.imported} records imported</p>
                  {importResult.skipped > 0 && (
                    <p className="text-amber-700">⚠ {importResult.skipped} skipped (duplicates)</p>
                  )}
                  {importResult.unmatched > 0 && (
                    <p className="text-blue-700">ℹ {importResult.unmatched} unmatched to property records</p>
                  )}
                  {importResult.mergedDrafts > 0 && (
                    <p className="text-emerald-700">✓ {importResult.mergedDrafts} merged into existing draft row{importResult.mergedDrafts === 1 ? '' : 's'} (appellant evidence preserved)</p>
                  )}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  {importResult ? 'Close' : 'Cancel'}
                </button>
                {!importResult && (
                  <button
                    onClick={handleImportCSV}
                    disabled={!importFile || importProcessing}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {importProcessing ? 'Importing...' : 'Import'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* POWERCAMA IMPORT MODAL */}
      {showPwrCamaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Import Appeals from PowerCama</h2>
              <button onClick={() => setShowPwrCamaModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Supports the PowerCama appeals export (.xlsx). New appeals are inserted with status <strong>D (Defend)</strong>. Re-importing an existing appeal refreshes <strong>hearing date</strong> and <strong>judgment value</strong> in place — no manual entry needed for bulk judgment loads.
              </p>
              <div className="border-2 border-dashed border-purple-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  id="pwrcama-import-input"
                  className="hidden"
                  onChange={(e) => setPwrCamaFile(e.target.files[0] || null)}
                />
                <label htmlFor="pwrcama-import-input" className="cursor-pointer">
                  <Upload className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    {pwrCamaFile ? pwrCamaFile.name : 'Click to select .xlsx file'}
                  </p>
                </label>
              </div>
              {pwrCamaResult && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
                  <p className="font-semibold text-gray-800">Import Complete</p>
                  <p className="text-green-700">✓ {pwrCamaResult.imported} records imported</p>
                  {pwrCamaResult.refreshed > 0 && <p className="text-emerald-700">✓ {pwrCamaResult.refreshed} existing appeal{pwrCamaResult.refreshed === 1 ? '' : 's'} refreshed (hearing date / judgment updated)</p>}
                  {pwrCamaResult.unmatched > 0 && <p className="text-blue-700">ℹ {pwrCamaResult.unmatched} unmatched to property records</p>}
                  {pwrCamaResult.mergedDrafts > 0 && <p className="text-emerald-700">✓ {pwrCamaResult.mergedDrafts} merged into existing draft row{pwrCamaResult.mergedDrafts === 1 ? '' : 's'} (appellant evidence preserved)</p>}
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setShowPwrCamaModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
                  {pwrCamaResult ? 'Close' : 'Cancel'}
                </button>
                {!pwrCamaResult && (
                  <button
                    onClick={handleImportPwrCama}
                    disabled={!pwrCamaFile || pwrCamaProcessing}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pwrCamaProcessing ? 'Importing...' : 'Import'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT FROM EXPORT MODAL */}
      {showImportExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Import from Exported Excel</h3>
              <button onClick={() => setShowImportExportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Upload a previously exported Appeal Log Excel file to update <strong>Status Code</strong>, <strong>Stip Status</strong>, and <strong>Hearing Date</strong> values.
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Appeals are matched by Appeal # and Appeal Year. Only Status Code, Stip Status, and Hearing Date are imported — all other columns are ignored. Evidence Due is auto-calculated (7 days before hearing).
            </p>
            <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-700">Accepted Values Reference</p>
              </div>
              <div className="p-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1">Status Code</p>
                  <div className="space-y-0.5">
                    {[
                      ['D', 'Defend'],
                      ['S', 'Settled'],
                      ['H', 'Heard'],
                      ['W', 'Withdrawn'],
                      ['A', 'Assessor'],
                      ['AP', 'Affirmed Pending'],
                      ['AWP', 'Affirmed w/ Prejudice'],
                      ['Z', 'Dismissed'],
                      ['NA', 'Nonappearance']
                    ].map(([code, label]) => (
                      <div key={code} className="flex items-center gap-1.5">
                        <code className="text-xs bg-white border border-gray-300 px-1.5 py-0.5 rounded font-mono select-all cursor-pointer" title="Click to select">{code}</code>
                        <span className="text-xs text-gray-500">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1">Stip Status</p>
                  <div className="space-y-0.5">
                    {[
                      ['not_started', 'Not Started'],
                      ['drafted', 'Drafted'],
                      ['sent', 'Sent to Taxpayer'],
                      ['signed', 'Signed'],
                      ['filed', 'Filed']
                    ].map(([code, label]) => (
                      <div key={code} className="flex items-center gap-1.5">
                        <code className="text-xs bg-white border border-gray-300 px-1.5 py-0.5 rounded font-mono select-all cursor-pointer" title="Click to select">{code}</code>
                        <span className="text-xs text-gray-500">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setImportExportFile(e.target.files[0])}
              className="w-full mb-4 text-sm"
            />
            {importExportResult && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                <p className="font-medium mb-1">Import Complete</p>
                <p>Updated: <strong>{importExportResult.updated}</strong></p>
                <p>Skipped (no changes): <strong>{importExportResult.skipped}</strong></p>
                <p>Not found: <strong>{importExportResult.notFound}</strong></p>
                {importExportResult.invalid > 0 && (
                  <p className="text-red-600">Invalid values rejected: <strong>{importExportResult.invalid}</strong></p>
                )}
                <p className="text-gray-500 mt-1">Total rows: {importExportResult.total}</p>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowImportExportModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
              >
                {importExportResult ? 'Close' : 'Cancel'}
              </button>
              {!importExportResult && (
                <button
                  onClick={handleImportFromExport}
                  disabled={!importExportFile || importExportProcessing}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importExportProcessing ? 'Importing...' : 'Import'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== EXPORT CSV (POWERCOMP) SELECTION MODAL ==================== */}
      {showExportCsvModal && (
        <div className="csv-export-modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="csv-export-modal-box bg-white rounded-lg shadow-xl p-6">
            <div className="flex justify-between items-center mb-3 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">
                Select Result Sets for PowerComp Export
              </h2>
              <button
                onClick={() => setShowExportCsvModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3 flex-shrink-0">
              Everything is checked by default. Uncheck any saved runs you don't
              want to send to BRT — useful when a subject has both an assessor
              run and an appellant run, or a manager rebuttal you don't want
              shipped.
            </p>
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <div className="text-xs text-gray-500">
                {exportCsvCandidates.filter(c => c.checked).length} of{' '}
                {exportCsvCandidates.length} selected
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAllExportCsvCandidates(true)}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Check all
                </button>
                <button
                  onClick={() => setAllExportCsvCandidates(false)}
                  className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Uncheck all
                </button>
              </div>
            </div>
            <div className="csv-export-modal-scroll border border-gray-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr className="text-left text-xs text-gray-600">
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        title={
                          exportCsvCandidates.length > 0 &&
                          exportCsvCandidates.every(c => c.checked)
                            ? 'Deselect all'
                            : 'Select all'
                        }
                        checked={
                          exportCsvCandidates.length > 0 &&
                          exportCsvCandidates.every(c => c.checked)
                        }
                        ref={el => {
                          if (el) {
                            const checkedCount = exportCsvCandidates.filter(c => c.checked).length;
                            el.indeterminate =
                              checkedCount > 0 &&
                              checkedCount < exportCsvCandidates.length;
                          }
                        }}
                        onChange={(e) => setAllExportCsvCandidates(e.target.checked)}
                      />
                    </th>
                    <th className="px-2 py-2">Subject</th>
                    <th className="px-2 py-2">Appeal #</th>
                    <th className="px-2 py-2">Result Set</th>
                    <th className="px-2 py-2 text-center">Comps</th>
                    <th className="px-2 py-2">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {exportCsvCandidates.map((c, i) => {
                    const prev = exportCsvCandidates[i - 1];
                    const isNewSubject = !prev || prev.subjectKey !== c.subjectKey;
                    return (
                      <tr
                        key={c.id}
                        className={`border-t ${isNewSubject ? 'border-gray-300' : 'border-gray-100'} hover:bg-gray-50`}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={c.checked}
                            onChange={() => toggleExportCsvCandidate(c.id)}
                          />
                        </td>
                        <td className="px-2 py-2 font-medium text-gray-800">
                          {isNewSubject ? (
                            <>
                              {c.subj_block}/{c.subj_lot}
                              {c.subj_qualifier ? `/${c.subj_qualifier}` : ''}
                              {c.subj_address && (
                                <div className="text-xs text-gray-500 font-normal">
                                  {c.subj_address}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-gray-700">
                          {c.appeal_number}
                        </td>
                        <td className="px-2 py-2 text-gray-700">
                          {c.result_set_name}
                        </td>
                        <td className="px-2 py-2 text-center text-gray-600">
                          {c.comps.length}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-500">
                          {c.saved_at
                            ? new Date(c.saved_at).toLocaleDateString()
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4 flex-shrink-0">
              <button
                onClick={() => setShowExportCsvModal(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmExportCsv}
                disabled={!exportCsvCandidates.some(c => c.checked)}
                style={{ backgroundColor: '#ea580c', color: 'white' }}
                className="px-4 py-2 rounded-lg text-sm hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export {exportCsvCandidates.filter(c => c.checked).length} to CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== POWERCOMP PDF (PHOTO PACKETS) MODAL ==================== */}
      {showPwrCompPdfModal && (
        <div className="csv-export-modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="csv-export-modal-box bg-white rounded-lg shadow-xl p-6">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900">Import Batch PwrComp PDF (Photo Packets)</h2>
              <button onClick={() => setShowPwrCompPdfModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3 flex-shrink-0">
              Upload a BRT PowerComp <strong>Batch Taxpayer Report</strong> PDF. We'll group pages by subject Block / Lot / Qualifier, strip just the photo pages, and attach them to each matching property in this job. The photo pages get a footer crediting <em>BRT Technologies PowerComp</em>.
            </p>

            <div className="border-2 border-dashed border-teal-300 rounded-lg p-4 text-center mb-3 flex-shrink-0">
              <input
                type="file"
                accept=".pdf,application/pdf"
                id="pwrcomp-pdf-input"
                className="hidden"
                onChange={(e) => {
                  setPwrCompPdfFile(e.target.files[0] || null);
                  setPwrCompPdfBytes(null);
                  setPwrCompPdfPreview(null);
                  setPwrCompPdfSaveResult(null);
                  setPwrCompPdfSaveProgress(null);
                }}
              />
              <label htmlFor="pwrcomp-pdf-input" className="cursor-pointer">
                <FileText className="w-8 h-8 text-teal-500 mx-auto mb-2" />
                <p className="text-sm text-gray-700">
                  {pwrCompPdfFile ? pwrCompPdfFile.name : 'Click to select PowerComp PDF'}
                </p>
              </label>
            </div>

            <div className="csv-export-modal-scroll -mx-1 px-1">
              {pwrCompPdfPreview && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex justify-between text-xs">
                    <span className="font-semibold text-gray-700">
                      {pwrCompPdfPreview.packets.length} subject packet{pwrCompPdfPreview.packets.length === 1 ? '' : 's'} found · {pwrCompPdfPreview.totalPages} pages total
                    </span>
                    <span className="text-gray-500">
                      ✓ matched · ⚠ no property match · — no photo pages
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-1.5">B-L-Q / Card</th>
                        <th className="text-left px-3 py-1.5">Address (PDF)</th>
                        <th className="text-left px-3 py-1.5">Matched Property</th>
                        <th className="text-right px-3 py-1.5">Pages (data / photo)</th>
                        <th className="text-center px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pwrCompPdfPreview.packets.map((p, i) => {
                        const ok = !!p.matchedKey && p.photoPageIndices.length > 0;
                        const noPhotos = !!p.matchedKey && p.photoPageIndices.length === 0;
                        return (
                          <tr key={i} className={ok ? '' : 'bg-amber-50/40'}>
                            <td className="px-3 py-1.5 font-mono">
                              {p.block}-{p.lot}{p.qualifier ? `-${p.qualifier}` : ''} / {p.card || '?'}
                            </td>
                            <td className="px-3 py-1.5">{p.address || '—'}</td>
                            <td className="px-3 py-1.5">
                              {p.matchedKey
                                ? <span className="text-gray-700">{p.matchedAddress || p.matchedKey}</span>
                                : <span className="text-amber-700">no match in this job</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right text-gray-600">
                              {p.dataPageIndices.length} / {p.photoPageIndices.length}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              {ok ? <span className="text-green-700">✓</span>
                                : noPhotos ? <span className="text-gray-400">—</span>
                                : <span className="text-amber-700">⚠</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {pwrCompPdfSaveProgress && pwrCompPdfSaveProgress.status === 'uploading' && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-center mb-1">
                    <p className="font-semibold text-blue-800">
                      Uploading packet {pwrCompPdfSaveProgress.current} of {pwrCompPdfSaveProgress.total}
                    </p>
                    <p className="text-blue-700 font-mono text-xs">{pwrCompPdfSaveProgress.label}</p>
                  </div>
                  <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 transition-all duration-200"
                      style={{
                        width: `${Math.round(
                          (pwrCompPdfSaveProgress.current / pwrCompPdfSaveProgress.total) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {pwrCompPdfSaveResult && (
                <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-emerald-800">Saved</p>
                  <p className="text-emerald-700">✓ {pwrCompPdfSaveResult.saved} new · ↻ {pwrCompPdfSaveResult.replaced} replaced{pwrCompPdfSaveResult.failed > 0 ? ` · ✗ ${pwrCompPdfSaveResult.failed} failed` : ''}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-3 border-t border-gray-100 mt-3 flex-shrink-0">
              <button
                onClick={() => setShowPwrCompPdfModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                {pwrCompPdfSaveResult ? 'Close' : 'Cancel'}
              </button>
              {!pwrCompPdfPreview && (
                <button
                  onClick={handleParsePwrCompPdf}
                  disabled={!pwrCompPdfFile || pwrCompPdfParsing}
                  style={{ backgroundColor: '#0f766e', color: 'white' }}
                  className="px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {pwrCompPdfParsing ? 'Reading PDF…' : 'Parse & Match'}
                </button>
              )}
              {pwrCompPdfPreview && !pwrCompPdfSaveResult && (
                <button
                  onClick={handleSavePwrCompPackets}
                  disabled={pwrCompPdfSaving || !pwrCompPdfPreview.packets.some(p => p.matchedKey && p.photoPageIndices.length)}
                  style={{ backgroundColor: '#15803d', color: 'white' }}
                  className="px-4 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {pwrCompPdfSaving
                    ? (pwrCompPdfSaveProgress
                        ? `Saving ${pwrCompPdfSaveProgress.current}/${pwrCompPdfSaveProgress.total}…`
                        : 'Saving…')
                    : 'Save Photo Packets'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== EVIDENCE / APPELLANT COMPS MODAL ==================== */}
      {evidenceModalAppeal && (
        <AppellantEvidencePanel
          appeal={evidenceModalAppeal}
          jobData={jobData}
          marketLandData={marketLandData}
          properties={properties}
          tenantConfig={tenantConfig}
          mode="modal"
          onClose={closeEvidenceModal}
          onSaved={(updatedAppeal) => {
            setAppeals(prev => prev.map(a => a.id === updatedAppeal.id ? { ...a, ...updatedAppeal } : a));
          }}
        />
      )}
    </div>
  );
};

export default AppealLogTab;
