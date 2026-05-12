import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Archive, ArchiveRestore, RefreshCw, Tag, Trash2, AlertCircle } from 'lucide-react';

const ARCHIVE_CATEGORIES = [
  { value: 'appeals', label: 'Appeals' },
  { value: 'added_assessments', label: 'Added Assessments' },
  { value: 'valuations', label: 'Valuations' },
  { value: 'annuals', label: 'Annuals' },
  { value: 'coah', label: 'COAH (New Construction)' },
];

const categoryLabel = (value) =>
  ARCHIVE_CATEGORIES.find(c => c.value === value)?.label || value || '—';

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: '2-digit'
    });
  } catch {
    return iso;
  }
};

const ManageResultSetsTab = ({ jobData }) => {
  const [resultSets, setResultSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showArchived, setShowArchived] = useState(true);
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterYear, setFilterYear] = useState('all');
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveCategory, setArchiveCategory] = useState('valuation');
  const [archiveYear, setArchiveYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (jobData?.id) loadResultSets();
  }, [jobData?.id]);

  const loadResultSets = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_cme_result_sets')
        .select('id, name, adjustment_bracket, created_at, updated_at, archived_at, archive_category, archive_year, results')
        .eq('job_id', jobData.id)
        .order('archived_at', { ascending: false, nullsFirst: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setResultSets(data || []);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Error loading result sets:', err);
      alert(`Failed to load result sets: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredSets = useMemo(() => {
    return resultSets.filter(rs => {
      const isArchived = !!rs.archived_at;
      if (!showArchived && isArchived) return false;
      if (filterCategory !== 'all' && rs.archive_category !== filterCategory) return false;
      if (filterYear !== 'all' && String(rs.archive_year) !== String(filterYear)) return false;
      return true;
    });
  }, [resultSets, showArchived, filterCategory, filterYear]);

  const groupedSets = useMemo(() => {
    const groups = new Map();
    const activeKey = '__active__';
    filteredSets.forEach(rs => {
      if (!rs.archived_at) {
        if (!groups.has(activeKey)) groups.set(activeKey, []);
        groups.get(activeKey).push(rs);
      } else {
        const key = `${categoryLabel(rs.archive_category)} ${rs.archive_year || ''}`.trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rs);
      }
    });
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === activeKey) return -1;
      if (b === activeKey) return 1;
      return b.localeCompare(a);
    });
  }, [filteredSets]);

  const availableYears = useMemo(() => {
    const years = new Set();
    resultSets.forEach(rs => { if (rs.archive_year) years.add(rs.archive_year); });
    return [...years].sort((a, b) => b - a);
  }, [resultSets]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAllInGroup = (rows) => {
    const rowIds = rows.map(r => r.id);
    const allSelected = rowIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) rowIds.forEach(id => next.delete(id));
      else rowIds.forEach(id => next.add(id));
      return next;
    });
  };

  const selectedRows = useMemo(
    () => resultSets.filter(rs => selectedIds.has(rs.id)),
    [resultSets, selectedIds]
  );
  const selectedActiveCount = selectedRows.filter(r => !r.archived_at).length;
  const selectedArchivedCount = selectedRows.filter(r => !!r.archived_at).length;

  const handleArchiveSelected = async () => {
    if (selectedActiveCount === 0) return;
    setArchiveCategory('valuations');
    setArchiveYear(new Date().getFullYear());
    setArchiveModalOpen(true);
  };

  const confirmArchive = async () => {
    if (!archiveCategory || !archiveYear) {
      alert('Pick a category and year before archiving.');
      return;
    }
    try {
      setBusy(true);
      const ids = selectedRows.filter(r => !r.archived_at).map(r => r.id);
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('job_cme_result_sets')
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user?.id || null,
          archive_category: archiveCategory,
          archive_year: parseInt(archiveYear, 10),
        })
        .in('id', ids);
      if (error) throw error;
      setArchiveModalOpen(false);
      await loadResultSets();
    } catch (err) {
      console.error('Archive failed:', err);
      alert(`Archive failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUnarchiveSelected = async () => {
    if (selectedArchivedCount === 0) return;
    if (!window.confirm(`Restore ${selectedArchivedCount} result set(s) to active?`)) return;
    try {
      setBusy(true);
      const ids = selectedRows.filter(r => !!r.archived_at).map(r => r.id);
      const { error } = await supabase
        .from('job_cme_result_sets')
        .update({
          archived_at: null,
          archived_by: null,
          archive_category: null,
          archive_year: null,
        })
        .in('id', ids);
      if (error) throw error;
      await loadResultSets();
    } catch (err) {
      console.error('Unarchive failed:', err);
      alert(`Unarchive failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRelabelSelected = async () => {
    if (selectedArchivedCount === 0) return;
    setArchiveCategory(selectedRows[0]?.archive_category || 'valuations');
    setArchiveYear(selectedRows[0]?.archive_year || new Date().getFullYear());
    // Reuse the archive modal — confirmRelabel mode keyed by selectedArchivedCount
    setArchiveModalOpen('relabel');
  };

  const confirmRelabel = async () => {
    if (!archiveCategory || !archiveYear) return;
    try {
      setBusy(true);
      const ids = selectedRows.filter(r => !!r.archived_at).map(r => r.id);
      const { error } = await supabase
        .from('job_cme_result_sets')
        .update({
          archive_category: archiveCategory,
          archive_year: parseInt(archiveYear, 10),
        })
        .in('id', ids);
      if (error) throw error;
      setArchiveModalOpen(false);
      await loadResultSets();
    } catch (err) {
      console.error('Relabel failed:', err);
      alert(`Relabel failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.length === 0) return;
    if (!window.confirm(
      `Permanently delete ${selectedRows.length} result set(s)? This cannot be undone.`
    )) return;
    try {
      setBusy(true);
      const ids = selectedRows.map(r => r.id);
      const { error } = await supabase
        .from('job_cme_result_sets')
        .delete()
        .in('id', ids);
      if (error) throw error;
      await loadResultSets();
    } catch (err) {
      console.error('Delete failed:', err);
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="manage-result-sets-loading flex items-center justify-center py-16 text-gray-500">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading result sets...
      </div>
    );
  }

  return (
    <div className="manage-result-sets space-y-4">
      <div className="header-row flex items-start justify-between gap-4">
        <div>
          <h3 className="title text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Archive className="w-5 h-5 text-blue-600" />
            Manage Result Sets
          </h3>
          <p className="subtitle text-sm text-gray-600 mt-1">
            Archive CME runs you no longer need in the active picker. Archived sets stay viewable here and
            can be restored or relabeled at any time. Use categories like Appeal, Valuation, or Added with
            the assessment year so prior cycles don't bleed into the current run.
          </p>
        </div>
        <button
          onClick={loadResultSets}
          className="refresh-btn px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="filter-bar flex flex-wrap items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <label className="show-archived inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show archived
        </label>
        <div className="filter-group flex items-center gap-2 text-sm">
          <span className="text-gray-600">Category:</span>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="all">All</option>
            {ARCHIVE_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="filter-group flex items-center gap-2 text-sm">
          <span className="text-gray-600">Year:</span>
          <select
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="all">All</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="spacer flex-1" />
        <div className="selection-info text-sm text-gray-600">
          {selectedIds.size > 0
            ? `${selectedIds.size} selected (${selectedActiveCount} active, ${selectedArchivedCount} archived)`
            : 'No rows selected'}
        </div>
      </div>

      <div className="action-bar flex flex-wrap items-center gap-2">
        <button
          onClick={handleArchiveSelected}
          disabled={selectedActiveCount === 0 || busy}
          className="action-btn archive px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Archive className="w-4 h-4" />
          Archive ({selectedActiveCount})
        </button>
        <button
          onClick={handleUnarchiveSelected}
          disabled={selectedArchivedCount === 0 || busy}
          className="action-btn unarchive px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <ArchiveRestore className="w-4 h-4" />
          Unarchive ({selectedArchivedCount})
        </button>
        <button
          onClick={handleRelabelSelected}
          disabled={selectedArchivedCount === 0 || busy}
          className="action-btn relabel px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Tag className="w-4 h-4" />
          Relabel ({selectedArchivedCount})
        </button>
        <div className="spacer flex-1" />
        <button
          onClick={handleDeleteSelected}
          disabled={selectedRows.length === 0 || busy}
          className="action-btn delete px-3 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Delete
        </button>
      </div>

      {filteredSets.length === 0 ? (
        <div className="empty-state px-6 py-12 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="empty-title text-base font-medium">No result sets match the current filters.</p>
          <p className="empty-hint text-sm mt-1">Save a CME run from Search & Results to see it here.</p>
        </div>
      ) : (
        <div className="result-sets-list space-y-6">
          {groupedSets.map(([groupKey, rows]) => {
            const isActiveGroup = groupKey === '__active__';
            const groupTitle = isActiveGroup ? 'Active' : groupKey;
            const allSelected = rows.every(r => selectedIds.has(r.id));
            return (
              <div
                key={groupKey}
                className={`group-card border rounded-lg overflow-hidden ${isActiveGroup ? 'border-blue-200' : 'border-gray-200'}`}
              >
                <div className={`group-header flex items-center justify-between px-4 py-2 ${isActiveGroup ? 'bg-blue-50' : 'bg-gray-50'} border-b border-gray-200`}>
                  <div className="group-title text-sm font-semibold text-gray-800">
                    {groupTitle} <span className="text-gray-500 font-normal">({rows.length})</span>
                  </div>
                  <button
                    onClick={() => toggleSelectAllInGroup(rows)}
                    className="select-all text-xs text-blue-600 hover:text-blue-800"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <table className="result-sets-table w-full text-sm">
                  <thead className="bg-white">
                    <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                      <th className="th-check w-10 px-3 py-2"></th>
                      <th className="th-name px-3 py-2 text-left">Name</th>
                      <th className="th-bracket px-3 py-2 text-left">Bracket</th>
                      <th className="th-subjects px-3 py-2 text-center">Subjects</th>
                      <th className="th-created px-3 py-2 text-left">Created</th>
                      <th className="th-updated px-3 py-2 text-left">Updated</th>
                      {!isActiveGroup && (
                        <>
                          <th className="th-category px-3 py-2 text-left">Category</th>
                          <th className="th-year px-3 py-2 text-center">Year</th>
                          <th className="th-archived px-3 py-2 text-left">Archived</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(rs => {
                      const subjectCount = Array.isArray(rs.results) ? rs.results.length : 0;
                      const isSelected = selectedIds.has(rs.id);
                      return (
                        <tr
                          key={rs.id}
                          className={`row border-b border-gray-100 last:border-b-0 ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="td-check px-3 py-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(rs.id)}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="td-name px-3 py-2 font-medium text-gray-900">{rs.name}</td>
                          <td className="td-bracket px-3 py-2 text-gray-700">{rs.adjustment_bracket || '—'}</td>
                          <td className="td-subjects px-3 py-2 text-center text-gray-700">{subjectCount}</td>
                          <td className="td-created px-3 py-2 text-gray-600">{formatDate(rs.created_at)}</td>
                          <td className="td-updated px-3 py-2 text-gray-600">{formatDate(rs.updated_at)}</td>
                          {!isActiveGroup && (
                            <>
                              <td className="td-category px-3 py-2 text-gray-700">{categoryLabel(rs.archive_category)}</td>
                              <td className="td-year px-3 py-2 text-center text-gray-700">{rs.archive_year || '—'}</td>
                              <td className="td-archived px-3 py-2 text-gray-600">{formatDate(rs.archived_at)}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {archiveModalOpen && (
        <div className="modal-overlay fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="modal-card bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h4 className="modal-title text-lg font-semibold text-gray-900 mb-2">
              {archiveModalOpen === 'relabel' ? 'Relabel Archived Sets' : 'Archive Result Sets'}
            </h4>
            <p className="modal-subtitle text-sm text-gray-600 mb-4">
              {archiveModalOpen === 'relabel'
                ? `Update category and year for ${selectedArchivedCount} archived set(s).`
                : `Tag ${selectedActiveCount} result set(s) so you can find them later. They'll be removed from the Evaluate picker but stay viewable on this tab.`}
            </p>
            <div className="form-row mb-3">
              <label className="form-label block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={archiveCategory}
                onChange={e => setArchiveCategory(e.target.value)}
                className="form-input w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {ARCHIVE_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-row mb-4">
              <label className="form-label block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="number"
                value={archiveYear}
                onChange={e => setArchiveYear(e.target.value)}
                min="2000"
                max="2100"
                className="form-input w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="modal-actions flex items-center justify-end gap-2">
              <button
                onClick={() => setArchiveModalOpen(false)}
                disabled={busy}
                className="btn-cancel px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={archiveModalOpen === 'relabel' ? confirmRelabel : confirmArchive}
                disabled={busy}
                className="btn-confirm px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Saving...' : (archiveModalOpen === 'relabel' ? 'Update' : 'Archive')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageResultSetsTab;
