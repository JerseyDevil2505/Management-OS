import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Trash2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

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

        // Enrich with property data
        const enrichedAppeals = (data || []).map(appeal => {
          const property = properties.find(p => p.property_composite_key === appeal.property_composite_key);
          return {
            ...appeal,
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

  // Filter appeals by selected year
  const filteredAppeals = useMemo(() => {
    return appeals.filter(a => !a.appeal_year || a.appeal_year === selectedYear);
  }, [appeals, selectedYear]);

  // Calculate statistics
  const stats = useMemo(() => {
    const filtered = filteredAppeals;

    const totalAppeals = filtered.length;
    const totalAssessmentExposure = filtered.reduce((sum, a) => sum + (a.current_assessment || 0), 0);

    // Total Actual Loss: only include where judgment_value is not null
    const settledAppeals = filtered.filter(a => a.judgment_value !== null && a.judgment_value !== undefined);
    const totalActualLoss = settledAppeals.reduce((sum, a) => sum + (a.loss || 0), 0);

    // Avg % Loss: weighted average of loss_pct for settled appeals
    const avgLossPercent = settledAppeals.length > 0
      ? settledAppeals.reduce((sum, a) => sum + (a.loss_pct || 0), 0) / settledAppeals.length
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

    // Status counts
    const statusCounts = {
      S: 0, D: 0, H: 0, W: 0, A: 0, AP: 0, AWP: 0, NA: 0
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
      avgLossPercent,
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

  // Helper: Get status badge styling
  const getStatusStyle = (status) => {
    const s = status?.toUpperCase() || 'NA';
    switch (s) {
      case 'S': return { bg: 'bg-green-50', text: 'text-green-700', badge: 'bg-green-100' };
      case 'D':
      case 'H': return { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100' };
      case 'W': return { bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-100' };
      case 'A':
      case 'AP':
      case 'AWP': return { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100' };
      default: return { bg: 'bg-gray-50', text: 'text-gray-700', badge: 'bg-gray-100' };
    }
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

  // Helper: Parse appeal number and extract suffix, year, and appeal type
  const parseAppealNumber = (appealNumber) => {
    if (!appealNumber || appealNumber.trim() === '') {
      return { suffix: '', year: null, appealType: '' };
    }

    const upperNum = appealNumber.trim().toUpperCase();

    // Extract suffix (last letter: D, L, A, X)
    const suffix = upperNum.slice(-1);
    const isValidSuffix = ['D', 'L', 'A', 'X'].includes(suffix) ? suffix : '';

    // Extract year (look for 4-digit or 2-digit number)
    let year = null;
    const fourDigitMatch = upperNum.match(/\b(20[2-9]\d)\b/);
    if (fourDigitMatch) {
      year = parseInt(fourDigitMatch[1]);
    } else {
      const twoDigitMatch = upperNum.match(/\b(\d{2})\b/);
      if (twoDigitMatch) {
        year = 2000 + parseInt(twoDigitMatch[1]);
      }
    }

    // Map suffix to appeal_type
    const appealTypeMap = {
      'D': 'petitioner',
      'L': 'represented',
      'A': 'assessor',
      'X': 'cross'
    };

    return {
      suffix: isValidSuffix,
      year,
      appealType: appealTypeMap[isValidSuffix] || ''
    };
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

    // Auto-populate appeal_year if extracted
    if (parsed.year) {
      setFormData(prev => ({
        ...prev,
        appeal_year: parsed.year,
        appeal_type: parsed.appealType
      }));
    } else if (parsed.appealType) {
      setFormData(prev => ({
        ...prev,
        appeal_type: parsed.appealType
      }));
    }

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
        return {
          ...appeal,
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
        if (parsed.appealType) {
          updateData.appeal_type = parsed.appealType;
        }
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
          <p className="text-2xl font-bold text-gray-900 mt-2">{stats.totalAppeals}</p>
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
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Avg % Loss</p>
          <p className="text-xl font-bold text-red-600 mt-2">{stats.avgLossPercent !== null ? `${Math.round(stats.avgLossPercent * 10) / 10}%` : '-'}</p>
        </div>
      </div>

      {/* STATS ROW 2 - STATUS BADGES */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">By Status</p>
        <div className="flex gap-2 flex-wrap">
          {['S', 'D', 'H', 'W', 'A', 'AP', 'AWP', 'NA'].map(status => {
            const count = stats.statusCounts[status] || 0;
            const style = getStatusStyle(status);
            return (
              <div key={status} className={`${style.badge} ${style.text} px-3 py-1 rounded-full text-sm font-medium`}>
                {status}: <span className="font-bold">{count}</span>
              </div>
            );
          })}
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

      {/* COLUMN GROUP TOGGLES */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 flex gap-2 flex-wrap">
        {[
          { key: 'propertyInfo', label: 'Property Info' },
          { key: 'legal', label: 'Legal' },
          { key: 'workflow', label: 'Workflow' },
          { key: 'notes', label: 'Notes' }
        ].map(group => (
          <button
            key={group.key}
            onClick={() => setExpandedGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
            className="text-xs font-medium px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 flex items-center gap-1"
          >
            {group.label}
            {expandedGroups[group.key] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ))}
      </div>

      {/* TABLE - HORIZONTALLY SCROLLABLE WITH STICKY LEFT COLUMNS */}
      {filteredAppeals.length > 0 && (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-green-50 border-b border-gray-200">
              {/* FROZEN LEFT COLUMNS */}
              <th className="sticky left-0 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Status</th>
              <th className="sticky left-16 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Year</th>
              <th className="sticky left-28 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Appeal #</th>
              <th className="sticky left-48 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Block</th>
              <th className="sticky left-64 z-10 bg-gradient-to-r from-blue-50 to-green-50 px-3 py-2 text-left font-medium text-gray-700 border-r border-gray-200">Lot</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Qual</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Location</th>

              {/* PROPERTY INFO GROUP */}
              {expandedGroups.propertyInfo && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Class</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">VCS</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Bracket</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Inspected</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Owner</th>
                </>
              )}

              {/* LEGAL GROUP */}
              {expandedGroups.legal && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Petitioner</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attorney</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attny Address</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Attny City/State</th>
                </>
              )}

              {/* WORKFLOW GROUP */}
              {expandedGroups.workflow && (
                <>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Submission</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Evidence</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Evidence Due</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Hearing</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Stip</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">Tax Court</th>
                </>
              )}

              {/* VALUATION GROUP (always visible) */}
              <th className="px-3 py-2 text-left font-medium text-gray-700">Current Assessment</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Requested</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 text-blue-600">CME Value</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Judgment</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">Actual Loss</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700">% Loss</th>

              {/* NOTES GROUP */}
              {expandedGroups.notes && (
                <th className="px-3 py-2 text-left font-medium text-gray-700">Comments</th>
              )}

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
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  {/* FROZEN LEFT COLUMNS */}
                  <td className="sticky left-0 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200">
                    <select
                      value={appeal.status === 'Pending' ? 'D' : (appeal.status || 'NA')}
                      onChange={(e) => handleDropdownChange(appeal.id, 'status', e.target.value || 'NA')}
                      className="px-1 py-0.5 border border-gray-300 rounded text-xs cursor-pointer"
                    >
                      <option value="D">D - Defend</option>
                      <option value="S">S - Stipulated</option>
                      <option value="H">H - Heard</option>
                      <option value="W">W - Withdrawn</option>
                      <option value="A">A - Assessor</option>
                      <option value="AP">AP - Affirmed with Prejudice</option>
                      <option value="AWP">AWP - Affirmed without Prejudice</option>
                      <option value="NA">NA - Non Appearance</option>
                    </select>
                  </td>
                  <td className="sticky left-16 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.appeal_year || '-'}</td>
                  <td className="sticky left-28 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900 font-medium">
                    {renderEditableCell(appeal.id, 'appeal_number', appeal.appeal_number, 'text')}
                  </td>
                  <td className="sticky left-48 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.property_block || '-'}</td>
                  <td className="sticky left-64 z-10 bg-white hover:bg-gray-50 px-3 py-2 whitespace-nowrap border-r border-gray-200 text-gray-900">{appeal.property_lot || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_qualifier || '-'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_location || '-'}</td>

                  {/* PROPERTY INFO GROUP */}
                  {expandedGroups.propertyInfo && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.property_m4_class || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{appeal.new_vcs || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'cme_bracket', appeal.cme_bracket, 'text')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={appeal.inspected || false}
                            onChange={(e) => handleDropdownChange(appeal.id, 'inspected', e.target.checked)}
                            className="w-4 h-4"
                          />
                        </label>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 flex items-center gap-1">
                        {appeal.owner_name || '-'}
                        {ownerMismatch && <span className="text-yellow-600">⚠️</span>}
                      </td>
                    </>
                  )}

                  {/* LEGAL GROUP */}
                  {expandedGroups.legal && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'petitioner_name', appeal.petitioner_name, 'text')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'attorney', appeal.attorney, 'text')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'attorney_address', appeal.attorney_address, 'text')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'attorney_city_state', appeal.attorney_city_state, 'text')}
                      </td>
                    </>
                  )}

                  {/* WORKFLOW GROUP */}
                  {expandedGroups.workflow && (
                    <>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        <select
                          value={appeal.submission_type || ''}
                          onChange={(e) => handleDropdownChange(appeal.id, 'submission_type', e.target.value)}
                          className="px-1 py-0.5 border border-gray-300 rounded text-xs cursor-pointer"
                        >
                          <option value="">-</option>
                          <option value="ONLINE">Online</option>
                          <option value="PAPER">Paper/Mail</option>
                          <option value="ELECTRONIC">Electronic</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        <select
                          value={appeal.evidence_status || ''}
                          onChange={(e) => handleDropdownChange(appeal.id, 'evidence_status', e.target.value)}
                          className="px-1 py-0.5 border border-gray-300 rounded text-xs cursor-pointer"
                        >
                          <option value="">-</option>
                          <option value="None">None</option>
                          <option value="Submitted">Submitted</option>
                          <option value="Exchanged">Exchanged</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{evidenceDue || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {renderEditableCell(appeal.id, 'hearing_date', appeal.hearing_date, 'date')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        <select
                          value={appeal.stip_status || 'not_started'}
                          onChange={(e) => handleDropdownChange(appeal.id, 'stip_status', e.target.value)}
                          className="px-1 py-0.5 border border-gray-300 rounded text-xs cursor-pointer"
                        >
                          <option value="not_started">Not Started</option>
                          <option value="drafted">Drafted</option>
                          <option value="sent">Sent</option>
                          <option value="signed">Signed</option>
                          <option value="filed">Filed</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={appeal.tax_court_pending || false}
                            onChange={(e) => handleDropdownChange(appeal.id, 'tax_court_pending', e.target.checked)}
                            className="w-4 h-4"
                          />
                        </label>
                      </td>
                    </>
                  )}

                  {/* VALUATION GROUP */}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">
                    {renderEditableCell(appeal.id, 'current_assessment', appeal.current_assessment, 'number')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">
                    {renderEditableCell(appeal.id, 'requested_value', appeal.requested_value, 'number')}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-blue-600 font-semibold">{formatCurrency(appeal.cme_projected_value)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900 font-medium">
                    {renderEditableCell(appeal.id, 'judgment_value', appeal.judgment_value, 'number')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${appeal.judgment_value !== null && appeal.loss > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {appeal.judgment_value !== null && appeal.judgment_value !== undefined ? formatCurrency(appeal.loss) : '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {appeal.judgment_value !== null && appeal.judgment_value !== undefined ? `${acPercent}%` : '-'}
                  </td>

                  {/* NOTES GROUP */}
                  {expandedGroups.notes && (
                    <td className="px-3 py-2 text-gray-600">
                      {renderEditableCell(appeal.id, 'comments', appeal.comments, 'text')}
                    </td>
                  )}

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
              <td colSpan="7" className="px-3 py-3 text-right">TOTALS:</td>
              {expandedGroups.propertyInfo && <td colSpan="5"></td>}
              {expandedGroups.legal && <td colSpan="4"></td>}
              {expandedGroups.workflow && <td colSpan="6"></td>}
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.current_assessment || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.requested_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-blue-600">{formatCurrency(filteredAppeals.reduce((sum, a) => sum + (a.cme_projected_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.judgment_value || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap text-red-600">{formatCurrency(filteredAppeals.filter(a => a.judgment_value !== null && a.judgment_value !== undefined).reduce((sum, a) => sum + (a.loss || 0), 0))}</td>
              <td className="px-3 py-3 whitespace-nowrap">-</td>
              {expandedGroups.notes && <td></td>}
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
    </div>
  );
};

export default AppealLogTab;
