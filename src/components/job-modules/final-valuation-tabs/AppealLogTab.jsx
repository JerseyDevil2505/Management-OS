import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Search, Plus, Trash2, Upload, Download, Save, ExternalLink, FileText, AlertCircle, CheckCircle, XCircle, Scale } from 'lucide-react';

const AppealLogTab = ({ jobData, properties, onNavigateToCME }) => {
  // ==================== STATE ====================
  const [appeals, setAppeals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [directorRatio, setDirectorRatio] = useState('');
  const [ratioSaved, setRatioSaved] = useState(false);

  // Search/add state
  const [searchBlock, setSearchBlock] = useState('');
  const [searchLot, setSearchLot] = useState('');
  const [searchQualifier, setSearchQualifier] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  // Editing state
  const [editingCell, setEditingCell] = useState(null); // { id, field }
  const [editValue, setEditValue] = useState('');

  // ==================== LOAD DATA ====================
  useEffect(() => {
    if (jobData?.id) {
      loadAppeals();
      loadDirectorRatio();
    }
  }, [jobData?.id]);

  const loadAppeals = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('appeal_log')
        .select('*')
        .eq('job_id', jobData.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setAppeals(data || []);
    } catch (err) {
      console.error('Error loading appeals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDirectorRatio = async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('director_ratio')
        .eq('id', jobData.id)
        .single();

      if (error) throw error;
      if (data?.director_ratio != null) {
        setDirectorRatio(String(data.director_ratio));
      }
    } catch (err) {
      console.error('Error loading director ratio:', err);
    }
  };

  // ==================== DIRECTOR'S RATIO ====================
  const saveDirectorRatio = async () => {
    const val = parseFloat(directorRatio);
    if (isNaN(val) || val <= 0 || val > 2) {
      alert('Please enter a valid ratio (e.g. 0.8734 or 87.34). Values > 2 are not valid.');
      return;
    }

    try {
      setIsSaving(true);
      const { error } = await supabase
        .from('jobs')
        .update({ director_ratio: val })
        .eq('id', jobData.id);

      if (error) throw error;
      setRatioSaved(true);
      setTimeout(() => setRatioSaved(false), 2000);

      // Recalculate Chapter 123 for all appeals
      recalculateAllAppeals(val);
    } catch (err) {
      console.error('Error saving director ratio:', err);
      alert('Failed to save director ratio');
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== CLR CALCULATIONS ====================
  const parsedRatio = useMemo(() => {
    const val = parseFloat(directorRatio);
    return isNaN(val) || val <= 0 ? null : val;
  }, [directorRatio]);

  const clrBounds = useMemo(() => {
    if (!parsedRatio) return null;
    return {
      lower: parsedRatio * 0.85,
      upper: parsedRatio * 1.15
    };
  }, [parsedRatio]);

  const getChapter123Result = useCallback((currentAssessment, cmeProjectedValue) => {
    if (!parsedRatio || !currentAssessment || !cmeProjectedValue || cmeProjectedValue === 0) {
      return { ratio: null, result: 'N/A' };
    }
    const ratio = currentAssessment / cmeProjectedValue;
    const lower = parsedRatio * 0.85;
    const upper = parsedRatio * 1.15;

    if (ratio >= lower && ratio <= upper) {
      return { ratio, result: 'Within CLR' };
    } else if (ratio > upper) {
      return { ratio, result: 'Exceeds CLR' };
    } else {
      return { ratio, result: 'Below CLR' };
    }
  }, [parsedRatio]);

  // ==================== SEARCH PROPERTIES ====================
  const handleSearch = () => {
    if (!searchBlock && !searchLot) return;

    const results = properties.filter(p => {
      const blockMatch = !searchBlock || (p.property_block || '').trim().toUpperCase().includes(searchBlock.trim().toUpperCase());
      const lotMatch = !searchLot || (p.property_lot || '').trim().toUpperCase().includes(searchLot.trim().toUpperCase());
      const qualMatch = !searchQualifier || (p.property_qualifier || '').trim().toUpperCase().includes(searchQualifier.trim().toUpperCase());
      return blockMatch && lotMatch && qualMatch;
    });

    setSearchResults(results.slice(0, 20));
  };

  // ==================== ADD PROPERTY TO LOG ====================
  const addPropertyToLog = async (property) => {
    // Check if already in log
    const exists = appeals.some(a =>
      a.property_block === property.property_block &&
      a.property_lot === property.property_lot &&
      (a.property_qualifier || '') === (property.property_qualifier || '')
    );

    if (exists) {
      alert('This property is already in the appeal log.');
      return;
    }

    const currentAssessment = parseFloat(property.total_assessed_value || property.assessed_total || 0);
    // Try to get CME projected value from evaluation results or property data
    const cmeProjected = parseFloat(property.cme_projected_assessment || property.projected_assessment || 0);
    const ch123 = getChapter123Result(currentAssessment, cmeProjected);

    const newAppeal = {
      job_id: jobData.id,
      appeal_number: '',
      property_block: property.property_block || '',
      property_lot: property.property_lot || '',
      property_qualifier: property.property_qualifier || '',
      property_location: property.property_location || '',
      current_assessment: currentAssessment || null,
      requested_value: null,
      cme_projected_value: cmeProjected || null,
      assessment_ratio: ch123.ratio,
      chapter_123_result: ch123.result,
      taxpayer_name: property.owner_name || property.taxpayer_name || '',
      attorney: '',
      hearing_date: null,
      status: 'Pending',
      result: '',
      comments: ''
    };

    try {
      const { data, error } = await supabase
        .from('appeal_log')
        .insert(newAppeal)
        .select()
        .single();

      if (error) throw error;
      setAppeals(prev => [...prev, data]);
    } catch (err) {
      console.error('Error adding appeal:', err);
      alert('Failed to add property to appeal log');
    }
  };

  // ==================== DELETE APPEAL ====================
  const deleteAppeal = async (id) => {
    if (!window.confirm('Remove this property from the appeal log?')) return;

    try {
      const { error } = await supabase
        .from('appeal_log')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setAppeals(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Error deleting appeal:', err);
    }
  };

  // ==================== INLINE EDIT ====================
  const startEdit = (id, field, currentValue) => {
    setEditingCell({ id, field });
    setEditValue(currentValue || '');
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const { id, field } = editingCell;

    let value = editValue;
    // Parse numeric fields
    if (['current_assessment', 'requested_value', 'cme_projected_value'].includes(field)) {
      value = parseFloat(editValue) || null;
    }

    try {
      const updateData = { [field]: value, updated_at: new Date().toISOString() };

      // Recalculate Chapter 123 if assessment or CME value changed
      const appeal = appeals.find(a => a.id === id);
      if (appeal && (field === 'current_assessment' || field === 'cme_projected_value')) {
        const assessment = field === 'current_assessment' ? value : appeal.current_assessment;
        const cme = field === 'cme_projected_value' ? value : appeal.cme_projected_value;
        const ch123 = getChapter123Result(assessment, cme);
        updateData.assessment_ratio = ch123.ratio;
        updateData.chapter_123_result = ch123.result;
      }

      const { error } = await supabase
        .from('appeal_log')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      setAppeals(prev => prev.map(a => a.id === id ? { ...a, ...updateData } : a));
    } catch (err) {
      console.error('Error updating appeal:', err);
    }

    setEditingCell(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  // ==================== RECALCULATE ALL ====================
  const recalculateAllAppeals = async (ratio) => {
    const updates = appeals.map(a => {
      const ch123 = getChapter123Result(a.current_assessment, a.cme_projected_value);
      return { ...a, assessment_ratio: ch123.ratio, chapter_123_result: ch123.result };
    });

    setAppeals(updates);

    // Batch update in DB
    for (const a of updates) {
      if (a.assessment_ratio !== null) {
        await supabase
          .from('appeal_log')
          .update({
            assessment_ratio: a.assessment_ratio,
            chapter_123_result: a.chapter_123_result,
            updated_at: new Date().toISOString()
          })
          .eq('id', a.id);
      }
    }
  };

  // ==================== PDF IMPORT PLACEHOLDER ====================
  const handlePDFImport = () => {
    alert('PDF Import will be available in May. When ready, you\'ll be able to upload a County Tax Board appeal list PDF and it will automatically parse the properties into this log.');
  };

  // ==================== NAVIGATE TO CME ====================
  const handleNavigateToCME = (appeal) => {
    if (onNavigateToCME) {
      onNavigateToCME({
        block: appeal.property_block,
        lot: appeal.property_lot,
        qualifier: appeal.property_qualifier || ''
      });
    }
  };

  // ==================== STATUS COLORS ====================
  const getStatusColor = (status) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Scheduled': return 'bg-blue-100 text-blue-800';
      case 'Settled': return 'bg-green-100 text-green-800';
      case 'Dismissed': return 'bg-gray-100 text-gray-800';
      case 'Withdrawn': return 'bg-gray-100 text-gray-600';
      case 'Judgment': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCh123Color = (result) => {
    if (result === 'Within CLR') return 'text-green-700 bg-green-50';
    if (result === 'Exceeds CLR') return 'text-red-700 bg-red-50';
    if (result === 'Below CLR') return 'text-amber-700 bg-amber-50';
    return 'text-gray-500';
  };

  // ==================== RENDER ====================
  const fmt = (val) => val != null ? Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
  const fmtPct = (val) => val != null ? (val * 100).toFixed(2) + '%' : '—';

  return (
    <div className="space-y-6">
      {/* Director's Ratio Card */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6 text-indigo-600" />
            <div>
              <h3 className="text-lg font-bold text-indigo-900">Director's Ratio — Chapter 123</h3>
              <p className="text-sm text-indigo-700 mt-0.5">
                N.J.S.A. 54:51A-6 · Common Level Range = Ratio ± 15%
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Ratio:</label>
              <input
                type="text"
                value={directorRatio}
                onChange={(e) => setDirectorRatio(e.target.value)}
                placeholder="e.g. 0.8734"
                className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <button
              onClick={saveDirectorRatio}
              disabled={isSaving || !directorRatio}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            {ratioSaved && (
              <span className="inline-flex items-center gap-1 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </div>

        {/* CLR Display */}
        {clrBounds && (
          <div className="mt-3 flex items-center gap-6 text-sm">
            <div className="bg-white rounded-lg px-4 py-2 border border-indigo-100">
              <span className="text-gray-500">Lower Bound:</span>{' '}
              <span className="font-semibold text-indigo-800">{fmtPct(clrBounds.lower)}</span>
            </div>
            <div className="bg-white rounded-lg px-4 py-2 border border-indigo-100">
              <span className="text-gray-500">Director's Ratio:</span>{' '}
              <span className="font-bold text-indigo-900">{fmtPct(parsedRatio)}</span>
            </div>
            <div className="bg-white rounded-lg px-4 py-2 border border-indigo-100">
              <span className="text-gray-500">Upper Bound:</span>{' '}
              <span className="font-semibold text-indigo-800">{fmtPct(clrBounds.upper)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Property
          </button>
          <button
            onClick={handlePDFImport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
          >
            <Upload className="w-4 h-4" />
            Import PDF
          </button>
        </div>
        <div className="text-sm text-gray-500">
          {appeals.length} {appeals.length === 1 ? 'appeal' : 'appeals'} logged
        </div>
      </div>

      {/* Property Search Panel */}
      {showSearch && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-3">Search Properties by Block / Lot / Qualifier</h4>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Block</label>
              <input
                type="text"
                value={searchBlock}
                onChange={(e) => setSearchBlock(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Block"
                className="w-24 px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Lot</label>
              <input
                type="text"
                value={searchLot}
                onChange={(e) => setSearchLot(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Lot"
                className="w-24 px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Qualifier</label>
              <input
                type="text"
                value={searchQualifier}
                onChange={(e) => setSearchQualifier(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Qual"
                className="w-20 px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
            </div>
            <button
              onClick={handleSearch}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
            >
              <Search className="w-4 h-4" />
              Search
            </button>
            <button
              onClick={() => { setShowSearch(false); setSearchResults([]); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-blue-100">
                    <th className="px-2 py-1 text-left">Block</th>
                    <th className="px-2 py-1 text-left">Lot</th>
                    <th className="px-2 py-1 text-left">Qual</th>
                    <th className="px-2 py-1 text-left">Location</th>
                    <th className="px-2 py-1 text-left">Owner</th>
                    <th className="px-2 py-1 text-right">Assessment</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((p, idx) => (
                    <tr key={idx} className="border-b border-blue-100 hover:bg-blue-50">
                      <td className="px-2 py-1.5 font-medium">{p.property_block}</td>
                      <td className="px-2 py-1.5">{p.property_lot}</td>
                      <td className="px-2 py-1.5">{p.property_qualifier || ''}</td>
                      <td className="px-2 py-1.5">{p.property_location || ''}</td>
                      <td className="px-2 py-1.5">{p.owner_name || p.taxpayer_name || ''}</td>
                      <td className="px-2 py-1.5 text-right font-mono">${fmt(p.total_assessed_value || p.assessed_total || 0)}</td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => addPropertyToLog(p)}
                          className="px-2 py-0.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                        >
                          + Add
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {searchResults.length === 0 && searchBlock && (
            <p className="mt-3 text-sm text-gray-500">No properties found. Try a different search.</p>
          )}
        </div>
      )}

      {/* Appeal Log Table */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-3">Loading appeal log...</p>
        </div>
      ) : appeals.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <Scale className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h4 className="text-lg font-medium text-gray-700">No Appeals Logged</h4>
          <p className="text-sm text-gray-500 mt-1">
            Use "Add Property" to search and add properties to the appeal log, or import a PDF when available.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200">
                <th className="px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">Appeal #</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Block</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Lot</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Qual</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">Property Location</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">Taxpayer</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-700 whitespace-nowrap">Current Assessment</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-700 whitespace-nowrap">Requested Value</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-700 whitespace-nowrap">CME Projected</th>
                <th className="px-2 py-2 text-center font-semibold text-gray-700 whitespace-nowrap">A/V Ratio</th>
                <th className="px-2 py-2 text-center font-semibold text-gray-700 whitespace-nowrap">Ch. 123</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Attorney</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">Hearing Date</th>
                <th className="px-2 py-2 text-center font-semibold text-gray-700">Status</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Result</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-700">Comments</th>
                <th className="px-2 py-2 text-center font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {appeals.map((appeal, idx) => (
                <tr
                  key={appeal.id}
                  className={`border-b border-gray-100 hover:bg-blue-50 ${
                    appeal.chapter_123_result === 'Exceeds CLR' ? 'bg-red-50' :
                    appeal.chapter_123_result === 'Within CLR' ? 'bg-green-50' : ''
                  }`}
                >
                  {/* Appeal Number - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'appeal_number' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-20 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline text-blue-600"
                        onClick={() => startEdit(appeal.id, 'appeal_number', appeal.appeal_number)}
                      >
                        {appeal.appeal_number || '—'}
                      </span>
                    )}
                  </td>

                  {/* Block/Lot/Qual - clickable to CME */}
                  <td className="px-2 py-1.5 font-medium">
                    <button
                      onClick={() => handleNavigateToCME(appeal)}
                      className="text-blue-700 hover:underline font-semibold"
                      title="Open in CME"
                    >
                      {appeal.property_block}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => handleNavigateToCME(appeal)}
                      className="text-blue-700 hover:underline"
                      title="Open in CME"
                    >
                      {appeal.property_lot}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-gray-500">{appeal.property_qualifier || ''}</td>

                  {/* Location */}
                  <td className="px-2 py-1.5 whitespace-nowrap">{appeal.property_location || '—'}</td>

                  {/* Taxpayer - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'taxpayer_name' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-32 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'taxpayer_name', appeal.taxpayer_name)}
                      >
                        {appeal.taxpayer_name || '—'}
                      </span>
                    )}
                  </td>

                  {/* Current Assessment - editable */}
                  <td className="px-2 py-1.5 text-right font-mono">
                    {editingCell?.id === appeal.id && editingCell?.field === 'current_assessment' ? (
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-24 px-1 py-0.5 border rounded text-xs text-right"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'current_assessment', appeal.current_assessment)}
                      >
                        {appeal.current_assessment != null ? `$${fmt(appeal.current_assessment)}` : '—'}
                      </span>
                    )}
                  </td>

                  {/* Requested Value - editable */}
                  <td className="px-2 py-1.5 text-right font-mono">
                    {editingCell?.id === appeal.id && editingCell?.field === 'requested_value' ? (
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-24 px-1 py-0.5 border rounded text-xs text-right"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'requested_value', appeal.requested_value)}
                      >
                        {appeal.requested_value != null ? `$${fmt(appeal.requested_value)}` : '—'}
                      </span>
                    )}
                  </td>

                  {/* CME Projected - editable */}
                  <td className="px-2 py-1.5 text-right font-mono">
                    {editingCell?.id === appeal.id && editingCell?.field === 'cme_projected_value' ? (
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-24 px-1 py-0.5 border rounded text-xs text-right"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'cme_projected_value', appeal.cme_projected_value)}
                      >
                        {appeal.cme_projected_value != null ? `$${fmt(appeal.cme_projected_value)}` : '—'}
                      </span>
                    )}
                  </td>

                  {/* A/V Ratio */}
                  <td className="px-2 py-1.5 text-center font-mono">
                    {appeal.assessment_ratio != null ? fmtPct(appeal.assessment_ratio) : '—'}
                  </td>

                  {/* Chapter 123 Result */}
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getCh123Color(appeal.chapter_123_result)}`}>
                      {appeal.chapter_123_result || 'N/A'}
                    </span>
                  </td>

                  {/* Attorney - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'attorney' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-28 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'attorney', appeal.attorney)}
                      >
                        {appeal.attorney || '—'}
                      </span>
                    )}
                  </td>

                  {/* Hearing Date - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'hearing_date' ? (
                      <input
                        type="date"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-32 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'hearing_date', appeal.hearing_date || '')}
                      >
                        {appeal.hearing_date ? new Date(appeal.hearing_date).toLocaleDateString() : '—'}
                      </span>
                    )}
                  </td>

                  {/* Status - dropdown */}
                  <td className="px-2 py-1.5 text-center">
                    <select
                      value={appeal.status || 'Pending'}
                      onChange={async (e) => {
                        const newStatus = e.target.value;
                        await supabase.from('appeal_log').update({ status: newStatus }).eq('id', appeal.id);
                        setAppeals(prev => prev.map(a => a.id === appeal.id ? { ...a, status: newStatus } : a));
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded border-0 font-medium ${getStatusColor(appeal.status)}`}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Scheduled">Scheduled</option>
                      <option value="Settled">Settled</option>
                      <option value="Dismissed">Dismissed</option>
                      <option value="Withdrawn">Withdrawn</option>
                      <option value="Judgment">Judgment</option>
                    </select>
                  </td>

                  {/* Result - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'result' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-28 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => startEdit(appeal.id, 'result', appeal.result)}
                      >
                        {appeal.result || '—'}
                      </span>
                    )}
                  </td>

                  {/* Comments - editable */}
                  <td className="px-2 py-1.5">
                    {editingCell?.id === appeal.id && editingCell?.field === 'comments' ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && cancelEdit()}
                        className="w-40 px-1 py-0.5 border rounded text-xs"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded max-w-[160px] truncate inline-block"
                        onClick={() => startEdit(appeal.id, 'comments', appeal.comments)}
                        title={appeal.comments || ''}
                      >
                        {appeal.comments || '—'}
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleNavigateToCME(appeal)}
                        className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                        title="View in CME"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteAppeal(appeal.id)}
                        className="p-1 text-red-500 hover:bg-red-100 rounded"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary Stats */}
      {appeals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-800">{appeals.length}</div>
            <div className="text-xs text-gray-500">Total Appeals</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-700">
              {appeals.filter(a => a.chapter_123_result === 'Within CLR').length}
            </div>
            <div className="text-xs text-green-600">Within CLR</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-700">
              {appeals.filter(a => a.chapter_123_result === 'Exceeds CLR').length}
            </div>
            <div className="text-xs text-red-600">Exceeds CLR</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-700">
              {appeals.filter(a => a.status === 'Pending').length}
            </div>
            <div className="text-xs text-yellow-600">Pending</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppealLogTab;
