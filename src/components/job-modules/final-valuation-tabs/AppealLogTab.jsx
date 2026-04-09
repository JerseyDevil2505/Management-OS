import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Trash2, X, Upload } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import * as XLSX from 'xlsx';

const AppealLogTab = ({ jobData, properties = [], inspectionData = [], onNavigateToCME = () => {} }) => {
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
    statuses: new Set(['D', 'S', 'H', 'W', 'A', 'AP', 'AWP', 'NA']),
    classes: new Set(['2,3A', '4A,4B,4C', '1,3B', 'other']),
    attorneys: new Set(),
    vcs: new Set()
  });

  const [filters, setFilters] = useState({
    statuses: new Set(['D', 'S', 'H', 'W', 'A', 'AP', 'AWP', 'NA']),
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

  // Compute VCS to bracket mapping on mount
  useEffect(() => {
    if (!jobData?.end_date || properties.length === 0) return;

    // Helper: Get bracket label for a given price value
    const getBracketLabel = (priceValue) => {
      const bracket = CME_BRACKETS.find(b => priceValue >= b.min && priceValue <= b.max);
      return bracket ? bracket.label : null;
    };

    const assessmentYear = new Date(jobData.end_date).getFullYear();

    // Define period boundaries
    const cspStart = new Date(`${assessmentYear - 1}-10-01`);
    const cspEnd = new Date(`${assessmentYear}-12-31`);
    const pspStart = new Date(`${assessmentYear - 2}-10-01`);
    const pspEnd = new Date(`${assessmentYear - 1}-09-30`);
    const hspStart = new Date(`${assessmentYear - 3}-10-01`);
    const hspEnd = new Date(`${assessmentYear - 2}-09-30`);

    const inPeriod = (saleDate, start, end) => {
      const date = new Date(saleDate);
      return date >= start && date <= end;
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

        // DEBUG: Log raw data from DB
        console.log('DEBUG: Raw appeals from DB:', data?.length);

        // Enrich with property data and re-parse appeal_type if null
        const enrichedAppeals = (data || []).map(appeal => {
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
            // Derived fields from property match
            property_m4_class: property?.property_m4_class || appeal.property_m4_class || null,
            new_vcs: property?.new_vcs || null,
            owner_name: property?.owner_name || null,
            property_block: appeal.property_block || property?.property_block || null,
            property_lot: appeal.property_lot || property?.property_lot || null,
            property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
            property_location: appeal.property_location || property?.property_location || null
          };
        });

        setAppeals(enrichedAppeals);
        console.log('DEBUG: Appeals state set with:', enrichedAppeals.length, 'records');

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
    console.log('DEBUG: After year filter:', result.length);

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

    console.log('DEBUG: After all filters:', result.length);

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
          case 'vcs': aVal = a.new_vcs; bVal = b.new_vcs; break;
          case 'current_assessment': aVal = a.current_assessment; bVal = b.current_assessment; break;
          case 'requested': aVal = a.requested_value; bVal = b.requested_value; break;
          case 'cme_value': aVal = a.cme_projected_value; bVal = b.cme_projected_value; break;
          case 'judgment': aVal = a.judgment_value; bVal = b.judgment_value; break;
          case 'actual_loss': aVal = a.loss; bVal = b.loss; break;
          case 'loss_pct': aVal = a.loss_pct; bVal = b.loss_pct; break;
          case 'hearing_date': aVal = a.hearing_date; bVal = b.hearing_date; break;
          case 'attorney': aVal = a.attorney; bVal = b.attorney; break;
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

    if (isEditing) {
      return (
        <input
          autoFocus
          type={type}
          value={editValue}
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

    const displayValue = isCurrencyField ? formatCurrency(value) : (value || '-');
    const isCurrency = isCurrencyField;

    return (
      <div
        onClick={() => handleStartEdit(appealId, field, value)}
        className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded whitespace-nowrap ${isCurrency ? 'text-right' : ''}`}
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
    const suffix = appealNumber.trim().match(/([DLAXdlax]+)$/)
      ?.[1]?.toUpperCase();

    // Map suffix to appeal_type
    const appealTypeMap = {
      'D': 'petitioner',
      'L': 'represented',
      'A': 'assessor',
      'X': 'cross'
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

  // Handle select all checkbox
  const handleToggleSelectAll = () => {
    if (selectedAppeals.size === filteredAppeals.length) {
      setSelectedAppeals(new Set());
    } else {
      setSelectedAppeals(new Set(filteredAppeals.map(a => a.id)));
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
        ? new Date(new Date(formData.hearing_date).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : null;

      const appealData = {
        job_id: jobData.id,
        ...formData,
        status: formData.status || 'D',
        // Sanitize date fields
        hearing_date: sanitizeDate(formData.hearing_date),
        evidence_due_date: sanitizeDate(calculatedEvidenceDueDate)
      };

      // DEBUG: Check job_id
      console.log('DEBUG: job_id present?', !!appealData.job_id, 'value:', appealData.job_id);

      // DEBUG: Log payload keys before insert
      console.log('DEBUG: Payload keys:', Object.keys(appealData).sort());

      // DEBUG: Log full payload
      console.log('DEBUG: Attempting insert with payload:', JSON.stringify(appealData, null, 2));

      const { data, error } = await supabase
        .from('appeal_log')
        .insert([appealData])
        .select()
        .single();

      // DEBUG: Log insert results
      console.log('DEBUG: Insert result - data:', data);
      console.log('DEBUG: Insert result - error:', error);

      if (error) {
        console.error('SUPABASE INSERT ERROR:', error);
        throw error;
      }

      console.log('DEBUG: Insert succeeded, reloading appeals...');

      // Reload appeals
      const { data: fetchData, error: fetchError } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .order('appeal_number', { ascending: true });

      if (fetchError) throw fetchError;

      console.log('DEBUG: Fetched appeals count:', fetchData?.length || 0);

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
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      console.log('DEBUG: Appeals state updated with', enrichedAppeals.length, 'records');
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
        const date = new Date(value);
        date.setDate(date.getDate() - 7);
        updateData.evidence_due_date = date.toISOString().split('T')[0];
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
      setAppeals(prev => prev.map(a =>
        a.id === appealId ? { ...a, ...updateData } : a
      ));
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

      setAppeals(prev => prev.filter(a => a.id !== appealId));
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

      setAppeals(prev => prev.map(a =>
        a.id === appealId ? { ...a, [field]: value } : a
      ));
    } catch (error) {
      console.error('Error updating field:', error);
    }
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

      console.log('CSV Headers:', headers);
      console.log('Entry col index:', col('Entry'));
      console.log('Hearing Type col index:', col('Hearing Type'));

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

      let imported = 0;
      let skipped = 0;
      let unmatched = 0;
      const records = [];

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

        records.push(record);
      }

      // Batch insert
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
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      setImportResult({ imported, skipped, unmatched });
      setImportFile(null);

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

      const { data: existingAppeals } = await supabase
        .from('appeal_log')
        .select('appeal_number')
        .eq('job_id', jobData.id);
      const existingNumbers = new Set((existingAppeals || []).map(a => a.appeal_number));

      let imported = 0;
      let skipped = 0;
      let unmatched = 0;
      const records = [];

      for (const row of rows) {
        const appealNumber = row['APPEALS'] ? String(row['APPEALS']).trim() : null;
        if (!appealNumber) continue;
        if (existingNumbers.has(appealNumber)) { skipped++; continue; }

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
        if (row['HEARING_DATE'] && !isNaN(new Date(row['HEARING_DATE']).getTime())) {
          hearingDate = new Date(row['HEARING_DATE']).toISOString().split('T')[0];
        }
        let evidenceDueDate = null;
        if (hearingDate) {
          const d = new Date(hearingDate);
          d.setDate(d.getDate() - 7);
          evidenceDueDate = d.toISOString().split('T')[0];
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
        records.push({
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
        });
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
          new_vcs: property?.new_vcs || null,
          owner_name: property?.owner_name || null,
          property_block: appeal.property_block || property?.property_block || null,
          property_lot: appeal.property_lot || property?.property_lot || null,
          property_qualifier: appeal.property_qualifier || property?.property_qualifier || null,
          property_location: appeal.property_location || property?.property_location || null
        };
      });

      setAppeals(enrichedAppeals);
      setPwrCamaResult({ imported, skipped, unmatched });
      setPwrCamaFile(null);
    } catch (error) {
      console.error('PowerCama import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setPwrCamaProcessing(false);
    }
  };

  // ==================== EXPORT HANDLER ====================

  const handleExportToExcel = () => {
    if (filteredAppeals.length === 0) {
      alert('No appeals to export');
      return;
    }

    // Prepare data for export with all available fields
    const exportData = filteredAppeals.map(appeal => ({
      Status: appeal.status || '-',
      'Appeal #': appeal.appeal_number || '-',
      'Appeal Year': appeal.appeal_year || '-',
      Block: appeal.property_block || '-',
      Lot: appeal.property_lot || '-',
      Qual: appeal.property_qualifier || '-',
      Location: appeal.property_location || '-',
      Class: appeal.property_m4_class || '-',
      VCS: appeal.new_vcs || '-',
      Bracket: appeal.cme_bracket || '-',
      Inspected: appeal.inspected ? 'Yes' : 'No',
      Petitioner: appeal.petitioner_name || '-',
      Taxpayer: appeal.taxpayer_name || '-',
      Attorney: appeal.attorney || '-',
      'Atty Address': appeal.attorney_address || '-',
      'Atty City/State': appeal.attorney_city_state || '-',
      'Atty Phone': appeal.attorney_phone || '-',
      'Atty Email': appeal.attorney_email || '-',
      'Hearing Date': appeal.hearing_date ? new Date(appeal.hearing_date).toLocaleDateString() : '-',
      'Evidence Due': appeal.evidence_due_date ? new Date(appeal.evidence_due_date).toLocaleDateString() : '-',
      'Evidence Status': appeal.evidence_status || '-',
      'Submission Type': appeal.submission_type || '-',
      'Stip Status': appeal.stip_status || '-',
      'Tax Court': appeal.tax_court_pending ? 'Yes' : 'No',
      'Current Assessment': appeal.current_assessment || '-',
      'Requested Value': appeal.requested_value || '-',
      'CME Value': appeal.cme_projected_value || '-',
      'CME Assessment': appeal.cme_new_assessment || '-',
      Judgment: appeal.judgment_value || '-',
      Loss: appeal.judgment_value !== null ? (appeal.loss || '-') : '-',
      'Loss %': appeal.judgment_value !== null && appeal.loss_pct !== null ? appeal.loss_pct : '-',
      'Possible Loss': appeal.possible_loss || '-',
      'Appeal Type': appeal.appeal_type || '-',
      'Status Code': appeal.status_code || '-',
      Result: appeal.result || '-',
      Comments: appeal.comments || '-',
      'Inspection Date': appeal.inspection_date ? new Date(appeal.inspection_date).toLocaleDateString() : '-',
      'Import Source': appeal.import_source || '-',
      'Import Date': appeal.import_date ? new Date(appeal.import_date).toLocaleDateString() : '-'
    }));

    // Create workbook with data
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Appeals');

    // Get headers from first row
    const headers = Object.keys(exportData[0] || {});

    // Set column widths
    ws['!cols'] = headers.map(key => {
      if (key.includes('Address') || key.includes('Comments') || key.includes('Location')) return { wch: 25 };
      if (key.includes('Phone') || key.includes('Email')) return { wch: 20 };
      if (key.includes('Assessment') || key.includes('Judgment') || key.includes('Loss') || key.includes('Value')) return { wch: 18 };
      return { wch: 14 };
    });

    // Format header row (bold, gray background, borders)
    for (let i = 0; i < headers.length; i++) {
      const cellRef = XLSX.utils.encode_col(i) + '1';
      ws[cellRef] = ws[cellRef] || {};
      ws[cellRef].s = {
        font: { bold: true, size: 11, color: { rgb: '000000' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        fill: { fgColor: { rgb: 'D3D3D3' } },
        border: {
          top: { style: 'thin', color: '000000' },
          bottom: { style: 'thin', color: '000000' },
          left: { style: 'thin', color: '000000' },
          right: { style: 'thin', color: '000000' }
        }
      };
    }

    // Format data rows
    const numericColumns = ['Current Assessment', 'Requested Value', 'CME Value', 'CME Assessment', 'Judgment', 'Loss', 'Loss %', 'Possible Loss'];
    const dateColumns = ['Hearing Date', 'Evidence Due', 'Inspection Date', 'Import Date'];
    const centerColumns = ['Status', 'Inspected', 'Tax Court', 'Stip Status', 'Appeal Year'];

    for (let row = 2; row <= exportData.length + 1; row++) {
      for (let col = 0; col < headers.length; col++) {
        const cellRef = XLSX.utils.encode_col(col) + row;
        const cellKey = headers[col];

        if (!ws[cellRef]) ws[cellRef] = {};

        if (numericColumns.includes(cellKey)) {
          ws[cellRef].s = {
            alignment: { horizontal: 'right', vertical: 'center' },
            font: { size: 10 },
            numFmt: '#,##0.00'
          };
        } else if (dateColumns.includes(cellKey) || centerColumns.includes(cellKey)) {
          ws[cellRef].s = {
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { size: 10 }
          };
        } else {
          ws[cellRef].s = {
            font: { size: 10 },
            alignment: { horizontal: 'left', vertical: 'center' }
          };
        }
      }
    }

    // Generate filename with job name and date
    const jobName = jobData?.job_name || 'Appeals';
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${jobName}_AppealLog_${timestamp}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
  };

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* TOOLBAR */}
      <div className="flex justify-between items-center">
        <button
          onClick={handleOpenModal}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 flex items-center gap-2"
        >
          + Add Appeal
        </button>
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
          <button
            onClick={() => { setShowImportModal(true); setImportResult(null); setImportFile(null); }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import MyNJAppeal
          </button>
          <button
            onClick={() => { setShowPwrCamaModal(true); setPwrCamaResult(null); setPwrCamaFile(null); }}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import PwrCama Appeals
          </button>
          <button
            onClick={handleExportToExcel}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-300"
          >
            📊 Export to Excel
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
                <input
                  type="checkbox"
                  checked={filteredAppeals.length > 0 && selectedAppeals.size === filteredAppeals.length}
                  onChange={handleToggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                />
              </th>
              {/* FROZEN LEFT COLUMNS */}
              <SortableHeader label="Status" columnKey="status" sticky={true} left="50px" minWidth="85px" maxWidth="85px" />
              <SortableHeader label="Appeal #" columnKey="appeal_number" sticky={true} left="135px" minWidth="120px" maxWidth="120px" />
              <SortableHeader label="Block" columnKey="block" sticky={true} left="255px" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Lot" columnKey="lot" sticky={true} left="315px" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Qual" columnKey="qualifier" minWidth="50px" maxWidth="50px" />
              <SortableHeader label="Location" columnKey="location" minWidth="120px" />
              <SortableHeader label="Class" columnKey="class" minWidth="50px" maxWidth="50px" />
              <SortableHeader label="VCS" columnKey="vcs" minWidth="60px" maxWidth="60px" />
              <SortableHeader label="Bracket" columnKey="bracket" minWidth="110px" maxWidth="110px" />
              <SortableHeader label="Inspected" columnKey="inspected" minWidth="90px" maxWidth="90px" />
              <SortableHeader label="Petitioner" columnKey="petitioner_name" minWidth="120px" />
              <SortableHeader label="Attorney" columnKey="attorney" minWidth="100px" />
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

              return (
                <tr key={idx} className={`border-b border-gray-100 ${selectedAppeals.has(appeal.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  {/* CHECKBOX COLUMN */}
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 whitespace-nowrap border-r border-gray-200 text-center" style={{ minWidth: '50px', maxWidth: '50px' }}>
                    <input
                      type="checkbox"
                      checked={selectedAppeals.has(appeal.id)}
                      onChange={() => handleToggleAppealSelection(appeal.id)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  {/* FROZEN LEFT COLUMNS */}
                  <td className="sticky z-10 bg-white px-3 py-2 whitespace-nowrap border-r border-gray-200" style={{ left: '50px', minWidth: '85px', maxWidth: '85px' }}>
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
                      <option value="A">A</option>
                      <option value="AP">AP</option>
                      <option value="AWP">AWP</option>
                      <option value="NA">NA</option>
                    </select>
                  </td>
                  <td className="sticky z-10 bg-white px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900 font-medium" style={{ left: '135px', minWidth: '120px', maxWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'appeal_number', appeal.appeal_number, 'text')}
                  </td>
                  <td className="sticky z-10 bg-white px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900" style={{ left: '255px', minWidth: '60px', maxWidth: '60px' }}>{appeal.property_block || '-'}</td>
                  <td className="sticky z-10 bg-white px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900" style={{ left: '315px', minWidth: '60px', maxWidth: '60px' }}>{appeal.property_lot || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '50px', maxWidth: '50px' }}>{appeal.property_qualifier || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '120px' }}>{appeal.property_location || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '50px', maxWidth: '50px' }}>{appeal.property_m4_class || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '60px', maxWidth: '60px' }}>{appeal.new_vcs || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '110px', maxWidth: '110px' }}>
                    {renderBracketCell(appeal)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '90px', maxWidth: '90px' }}>
                    {renderInspectedCell(appeal)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'petitioner_name', appeal.petitioner_name, 'text')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '100px' }}>
                    {renderEditableCell(appeal.id, 'attorney', appeal.attorney, 'text')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '120px' }}>
                    {appeal.hearing_date ? new Date(appeal.hearing_date).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600" style={{ minWidth: '100px' }}>
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
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium" style={{ minWidth: '120px', maxWidth: '120px' }}>
                    {renderEditableCell(appeal.id, 'current_assessment', appeal.current_assessment, 'number')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-blue-600 font-semibold" style={{ minWidth: '100px', maxWidth: '100px' }}>{formatCurrency(appeal.cme_projected_value)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium" style={{ minWidth: '100px', maxWidth: '100px' }}>
                    {renderEditableCell(appeal.id, 'judgment_value', appeal.judgment_value, 'number')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${appeal.judgment_value !== null && appeal.loss > 0 ? 'text-red-600' : 'text-gray-600'}`} style={{ minWidth: '100px', maxWidth: '100px' }}>
                    {appeal.judgment_value !== null && appeal.judgment_value !== undefined ? formatCurrency(appeal.loss) : '-'}
                  </td>

                  {/* DELETE BUTTON */}
                  <td className="px-3 py-2 whitespace-nowrap text-center">
                    <button
                      onClick={() => handleDeleteAppeal(appeal.id)}
                      className="text-gray-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded"
                      title="Delete appeal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* TOTALS ROW */}
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-gray-900">
              <td colSpan="10" className="px-3 py-3 text-right">TOTALS:</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.current_assessment || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-blue-600">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.cme_projected_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.judgment_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-red-600">{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.loss || 0), 0))}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
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
                Supports the PowerCama appeals export (.xlsx). All imported appeals will be set to status <strong>D (Defend)</strong>. Duplicates are skipped automatically.
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
                  {pwrCamaResult.skipped > 0 && <p className="text-amber-700">⚠ {pwrCamaResult.skipped} skipped (duplicates)</p>}
                  {pwrCamaResult.unmatched > 0 && <p className="text-blue-700">ℹ {pwrCamaResult.unmatched} unmatched to property records</p>}
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
    </div>
  );
};

export default AppealLogTab;
