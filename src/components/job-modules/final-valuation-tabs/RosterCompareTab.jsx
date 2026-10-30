import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { Upload, Download, RefreshCw, AlertCircle } from 'lucide-react';
import {
  CATEGORIES, MANAGER_COLUMNS, compareRosters, formatCompareValue, normalizeCell,
  loadSnapshotMeta, loadSnapshotRows, saveCompareResult, loadCompareResult
} from '../../../lib/rosterCompare';

const ROW_LIMIT = 500;
const KEY_HIGHLIGHT = ['Block (text)', 'Lot (text)', 'Block', 'Lot', 'Qualifier'];

const parseRosterFile = async (file) => {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets['Market Data Approach'] || wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const headers = (aoa[0] || []).map(h => String(h).trim());
  const rows = aoa.slice(1)
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(arr => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = arr[i]; });
      return o;
    });
  return { headers: headers.filter(Boolean), rows };
};

const headerKey = (h) => String(h).replace(/\s+/g, ' ').trim().toUpperCase();

// Managers often re-case headers (e.g. "BLOCK (TEXT)"); map them back to the export's names.
const canonicalizeRoster = (roster, currentHeaders) => {
  const byKey = new Map(currentHeaders.map(h => [headerKey(h), h]));
  const rename = (h) => byKey.get(headerKey(h)) || h;
  return {
    ...roster,
    headers: roster.headers.map(rename),
    rows: roster.rows.map(r => {
      const o = {};
      Object.keys(r).forEach(h => { o[rename(h)] = r[h]; });
      return o;
    })
  };
};

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// The export writes condition codes as "01"; Excel may have turned them into 1.
const managerCellValue = (col, v) => {
  if ((col === 'Exterior' || col === 'Interior') && /^\d$/.test(String(v).trim())) return String(v).trim().padStart(2, '0');
  return v;
};

const RosterCompareTab = ({ jobData, buildRosterRows, buildFinalRoster, snapshotVersion }) => {
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [mode, setMode] = useState('snapshot');
  const [uploaded, setUploaded] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [activeCats, setActiveCats] = useState(new Set(CATEGORIES.map(c => c.id)));
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!jobData?.id) return;
    setMetaLoading(true);
    loadSnapshotMeta(jobData.id)
      .then(setMeta)
      .catch(e => { console.error('Failed to load roster snapshot info:', e); setMeta(null); })
      .finally(() => setMetaLoading(false));
  }, [jobData?.id, snapshotVersion]);

  useEffect(() => {
    if (!jobData?.id) return;
    let cancelled = false;
    loadCompareResult(jobData.id)
      .then(saved => {
        if (cancelled || !saved) return;
        setResult(prev => prev || saved);
        setMode(saved.source);
      })
      .catch(e => console.error('Failed to load last roster compare:', e));
    return () => { cancelled = true; };
  }, [jobData?.id]);

  const fileUpdatedSinceSnapshot = useMemo(() => {
    const uploadedAt = jobData?.source_file_uploaded_at || jobData?.raw_file_parsed_at;
    if (!meta?.built_at || !uploadedAt) return null;
    return new Date(uploadedAt) > new Date(meta.built_at);
  }, [meta, jobData?.source_file_uploaded_at, jobData?.raw_file_parsed_at]);

  const runCompare = async (source) => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      let roster;
      if (source === 'snapshot') {
        if (!meta) throw new Error('No saved roster for this job yet. Build the Final Roster first.');
        roster = await loadSnapshotRows(meta);
      } else {
        if (!uploaded) throw new Error('Choose a roster file first.');
        roster = uploaded;
      }

      const { rows: currentRows, consolidatedProperties } = buildRosterRows();
      if (currentRows.length === 0) throw new Error('No properties loaded for this job.');
      const currentHeaders = Object.keys(currentRows[0]);
      if (source === 'upload') roster = canonicalizeRoster(roster, currentHeaders);

      const hasProjResults = source === 'upload' && roster.headers.includes('Proj Total') &&
        roster.rows.some(r => { const v = normalizeCell(r['Proj Total']); return typeof v === 'number' && v !== 0; });

      const res = compareRosters({
        rosterHeaders: roster.headers,
        rosterRows: roster.rows,
        currentHeaders,
        currentRows,
        currentCamaTotals: consolidatedProperties.map(p => p.values_cama_total),
        withAssessment: hasProjResults
      });

      const next = {
        ...res,
        source,
        roster,
        assessmentChecked: hasProjResults,
        assessmentSkippedReason: source === 'snapshot'
          ? 'Upload the worked roster to check assessments; the saved copy has no manager edits.'
          : (!roster.headers.includes('Proj Total')
            ? 'Proj Total column was deleted from this roster.'
            : (!hasProjResults ? 'Proj Total has no calculated values. Open and save the roster in Excel, then upload again.' : null))
      };
      setResult(next);
      saveCompareResult({ jobId: jobData.id, result: next })
        .then(m => setResult(r => (r === next ? { ...next, comparedAt: m.compared_at, comparedBy: m.compared_by } : r)))
        .catch(e => console.error('Failed to save roster compare:', e));
    } catch (e) {
      console.error('Roster compare failed:', e);
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseRosterFile(file);
      const keys = new Set(parsed.headers.map(headerKey));
      if (!keys.has('QUALIFIER') || !(keys.has('BLOCK (TEXT)') || keys.has('BLOCK'))) {
        throw new Error('This does not look like a Final Roster (missing Block/Lot/Qualifier columns).');
      }
      setUploaded({ ...parsed, fileName: file.name });
    } catch (err) {
      setUploaded(null);
      setError(err.message || String(err));
    }
    e.target.value = '';
  };

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toUpperCase();
    return result.items.filter(it => {
      if (!activeCats.has(it.category)) return false;
      if (!q) return true;
      return `${it.block} ${it.lot} ${it.qualifier} ${it.address} ${it.column}`.toUpperCase().includes(q);
    });
  }, [result, activeCats, search]);

  const toggleCat = (id) => {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportChanges = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const headerStyle = { font: { name: 'Leelawadee', sz: 10, bold: true }, fill: { fgColor: { rgb: 'D3D3D3' } }, alignment: { horizontal: 'center' } };
    const styleHeader = (ws, n) => {
      for (let c = 0; c < n; c++) {
        const ref = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[ref]) ws[ref].s = headerStyle;
      }
    };

    const summary = [['Category', 'Count'], ...CATEGORIES.map(c => [c.label, result.counts[c.id] || 0])];
    summary.push([]);
    summary.push(['Compared against', result.source === 'snapshot' ? `Saved roster built ${fmtDateTime(meta?.built_at)}` : (result.roster.fileName || 'Uploaded roster')]);
    if (result.missingColumns.length) summary.push(['Columns not in roster', result.missingColumns.join(', ')]);
    const wsSum = XLSX.utils.aoa_to_sheet(summary);
    styleHeader(wsSum, 2);
    wsSum['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');

    CATEGORIES.forEach(cat => {
      const items = result.items.filter(it => it.category === cat.id);
      if (items.length === 0) return;
      const parcelOnly = cat.id === 'added' || cat.id === 'removed';
      const head = parcelOnly ? ['Block', 'Lot', 'Qualifier', 'Address'] : ['Block', 'Lot', 'Qualifier', 'Address', 'Field', 'Roster', 'Current'];
      const aoa = [head, ...items.map(it => parcelOnly
        ? [it.block, it.lot, it.qualifier, it.address]
        : [it.block, it.lot, it.qualifier, it.address, it.column, formatCompareValue(it.column, it.rosterValue), formatCompareValue(it.column, it.currentValue)])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      styleHeader(ws, head.length);
      ws['!cols'] = head.map(h => ({ wch: h === 'Address' ? 30 : h === 'Field' ? 22 : 14 }));
      XLSX.utils.book_append_sheet(wb, ws, cat.label.slice(0, 31));
    });

    XLSX.writeFile(wb, `Roster_Changes_${jobData.job_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const buildMerged = async () => {
    if (!result) return;
    const keepManager = result.source === 'upload';
    const overrides = new Map();
    if (keepManager) {
      const managerCols = MANAGER_COLUMNS.filter(c => result.roster.headers.includes(c));
      result.roster.rows.forEach(r => {
        const o = {};
        managerCols.forEach(c => { o[c] = managerCellValue(c, r[c]); });
        overrides.set(result.keyFn(r), o);
      });
    }

    const highlights = new Map();
    const mark = (key, col) => {
      if (!highlights.has(key)) highlights.set(key, new Set());
      highlights.get(key).add(col);
    };
    result.items.forEach(it => {
      if (it.category === 'added') KEY_HIGHLIGHT.forEach(c => mark(it.key, c));
      else if (it.category === 'assessment') mark(it.key, 'Proj Total');
      else if (it.column && !(keepManager && MANAGER_COLUMNS.includes(it.column))) mark(it.key, it.column);
    });

    await buildFinalRoster({ overrides, highlights, keyFn: result.keyFn, fileLabel: 'Final_Roster_Merged' });
  };

  const totalChanges = result ? result.items.length : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Roster Compare</h2>
        <p className="text-sm text-gray-600 mt-1">
          Audits a Final Roster against the job's current data: new sales, class changes, ownership, characteristics,
          values, and parcels added or removed since the roster was built.
        </p>
      </div>

      {/* Source picker */}
      <div className="grid grid-cols-2 gap-4">
        <div className={`rounded-lg border p-4 ${mode === 'snapshot' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <label className="flex items-center gap-2 font-semibold text-gray-900 cursor-pointer">
            <input type="radio" checked={mode === 'snapshot'} onChange={() => setMode('snapshot')} />
            Saved roster
          </label>
          <div className="text-sm text-gray-600 mt-2">
            {metaLoading ? 'Loading...' : meta ? (
              <>
                Built {fmtDateTime(meta.built_at)}{meta.built_by ? ` by ${meta.built_by}` : ''} &middot; {Number(meta.row_count || 0).toLocaleString()} parcels
                {fileUpdatedSinceSnapshot === true && (
                  <div className="mt-1 text-green-700 font-medium">Source file updated since this roster was built</div>
                )}
                {fileUpdatedSinceSnapshot === false && (
                  <div className="mt-1 text-gray-500">No file update since this roster was built</div>
                )}
              </>
            ) : 'No saved roster yet. Building the Final Roster saves one automatically.'}
          </div>
          <button
            onClick={() => runCompare('snapshot')}
            disabled={running || !meta}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${running && mode === 'snapshot' ? 'animate-spin' : ''}`} />
            Compare to saved roster
          </button>
        </div>

        <div className={`rounded-lg border p-4 ${mode === 'upload' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <label className="flex items-center gap-2 font-semibold text-gray-900 cursor-pointer">
            <input type="radio" checked={mode === 'upload'} onChange={() => setMode('upload')} />
            Upload worked roster
          </label>
          <div className="text-sm text-gray-600 mt-2">
            Use the manager's Excel roster to also check effective age changes and that every Proj Total matches the current CAMA total exactly.
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-sm cursor-pointer">
              <Upload className="w-4 h-4" />
              {uploaded ? 'Change file' : 'Choose file'}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { setMode('upload'); handleFile(e); }} />
            </label>
            <button
              onClick={() => runCompare('upload')}
              disabled={running || !uploaded}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${running && mode === 'upload' ? 'animate-spin' : ''}`} />
              Compare
            </button>
          </div>
          {uploaded && (
            <div className="text-xs text-gray-500 mt-2">{uploaded.fileName} &middot; {uploaded.rows.length.toLocaleString()} rows</div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          {error}
        </div>
      )}

      {result && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-gray-900">
                {totalChanges === 0 ? 'No differences found' : `${totalChanges.toLocaleString()} differences`}
                <span className="font-normal text-gray-500 text-sm ml-2">
                  vs {result.source === 'snapshot' ? 'saved roster' : (result.roster.fileName || 'uploaded roster')}
                </span>
              </div>
              {result.comparedAt && (
                <div className="text-xs text-gray-500 mt-1">
                  Compared {fmtDateTime(result.comparedAt)}{result.comparedBy ? ` by ${result.comparedBy}` : ''}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                {result.columnsCompared.length} columns compared.
                {result.missingColumns.length > 0 && ` Not in roster (skipped): ${result.missingColumns.join(', ')}.`}
              </div>
              {result.assessmentSkippedReason && (
                <div className="text-xs text-yellow-700 mt-1">Assessment check skipped: {result.assessmentSkippedReason}</div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportChanges}
                disabled={totalChanges === 0}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
              >
                <Download className="w-4 h-4" />
                Export Changes
              </button>
              <button
                onClick={buildMerged}
                className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                title={result.source === 'upload'
                  ? 'Fresh roster from current data, keeping the manager\'s Actual EFA, Exterior, Interior and Special; changed cells highlighted. Becomes the saved roster.'
                  : 'Fresh roster from current data with changed cells highlighted. Becomes the saved roster.'}
              >
                <Download className="w-4 h-4" />
                Build Merged Roster
              </button>
            </div>
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(cat => {
              const count = result.counts[cat.id] || 0;
              const on = activeCats.has(cat.id);
              const disabled = cat.id === 'assessment' && !result.assessmentChecked;
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCat(cat.id)}
                  disabled={disabled}
                  className={`px-3 py-1 rounded-full text-xs font-medium border ${
                    disabled ? 'bg-gray-50 text-gray-400 border-gray-200'
                      : on ? (count > 0 ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-200 text-gray-700 border-gray-300')
                        : 'bg-white text-gray-500 border-gray-300'
                  }`}
                >
                  {cat.label}: {disabled ? 'n/a' : count.toLocaleString()}
                </button>
              );
            })}
            <button onClick={() => setActiveCats(new Set(CATEGORIES.map(c => c.id)))} className="text-xs text-blue-600 hover:underline ml-1">all</button>
            <button onClick={() => setActiveCats(new Set())} className="text-xs text-blue-600 hover:underline">none</button>
          </div>
          <div className="text-xs text-gray-500">Counts are parcels per category; a parcel can appear in more than one.</div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search block, lot, address or field..."
            className="w-80 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />

          <div className="overflow-auto border border-gray-200 rounded" style={{ maxHeight: '60vh' }}>
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Block', 'Lot', 'Qual', 'Address', 'Category', 'Field', 'Roster', 'Current'].map(h => (
                    <th key={h} className="px-2 py-2 text-left font-semibold border border-gray-200">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, ROW_LIMIT).map((it, i) => (
                  <tr key={`${it.key}-${it.column}-${i}`} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-200">{it.block}</td>
                    <td className="px-2 py-1 border border-gray-200">{it.lot}</td>
                    <td className="px-2 py-1 border border-gray-200">{it.qualifier}</td>
                    <td className="px-2 py-1 border border-gray-200 whitespace-nowrap">{it.address}</td>
                    <td className="px-2 py-1 border border-gray-200">{CATEGORIES.find(c => c.id === it.category)?.label}</td>
                    <td className="px-2 py-1 border border-gray-200">{it.column || (it.category === 'added' ? 'New in data' : 'Gone from data')}</td>
                    <td className="px-2 py-1 border border-gray-200 bg-red-50">{it.column ? formatCompareValue(it.column, it.rosterValue) : ''}</td>
                    <td className="px-2 py-1 border border-gray-200 bg-green-50">{it.column ? formatCompareValue(it.column, it.currentValue) : ''}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-500">Nothing to show for the selected categories.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > ROW_LIMIT && (
            <div className="text-xs text-gray-500">Showing first {ROW_LIMIT.toLocaleString()} of {filtered.length.toLocaleString()}. Export Changes for the full list.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default RosterCompareTab;
