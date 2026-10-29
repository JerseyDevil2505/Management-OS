import { supabase } from './supabaseClient';

export const SNAPSHOT_BUCKET = 'roster-snapshots';
export const SNAPSHOT_SETTING_KEY = 'roster_snapshot';

// Emitted as Excel formulas in the roster. An app-built snapshot has no cached
// result for them, so they are only compared via the assessment check.
export const FORMULA_COLUMNS = new Set([
  'Check', 'Test', 'Eff Year', 'Total SFLA', 'Ext Cond Rate', 'Int Cond Rate',
  'Sales Ratio', 'CLA', 'PLA', 'Cama/Proj Imp', 'Proj Total', 'Delta %',
  'Recommended EFA', 'DEPR', 'New Value'
]);

const KEY_COLUMNS = new Set(['Block (text)', 'Lot (text)', 'Block', 'Lot', 'Qualifier']);

// Columns the manager works in Excel; the merged roster keeps their value.
export const MANAGER_COLUMNS = ['Actual EFA', 'Exterior', 'Interior', 'Special'];

export const CATEGORIES = [
  { id: 'added', label: 'Added Parcels' },
  { id: 'removed', label: 'Removed Parcels' },
  { id: 'assessment', label: 'Assessment Mismatch' },
  { id: 'sales', label: 'Sales' },
  { id: 'class', label: 'Class' },
  { id: 'efa', label: 'Effective Age' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'values', label: 'Values' },
  { id: 'taxes', label: 'Taxes' },
  { id: 'characteristics', label: 'Characteristics' }
];

const CATEGORY_BY_COLUMN = {
  'Owner Name': 'ownership', 'Owner Address': 'ownership', 'Owner City State': 'ownership', 'Owner Zip': 'ownership',
  'MOD IV': 'class', 'CAMA': 'class',
  'Code': 'sales', 'Sale Date': 'sales', 'Sale Book': 'sales', 'Sale Page': 'sales', 'Sale Price': 'sales',
  'HPI Multiplier': 'sales', 'Norm Time Value': 'sales', 'Sales NU Code': 'sales', 'Sale Comment': 'sales',
  'Current EFA': 'efa', 'Actual EFA': 'efa',
  'Det Items': 'values', 'Cost New': 'values', 'Current Land': 'values', 'Current Impr': 'values',
  'Current Total': 'values', 'CAMA Land': 'values',
  'Current Taxes': 'taxes', 'Projected Taxes': 'taxes', 'Tax Delta $': 'taxes'
};

export const categoryOf = (column) => CATEGORY_BY_COLUMN[column] || 'characteristics';

const unwrap = (v) => (v && typeof v === 'object' && 'v' in v ? v.v : v);

export const normalizeCell = (raw) => {
  const v = unwrap(raw);
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
};

const isEmptyish = (v) => v === '' || v === 0;

export const cellsEqual = (a, b) => {
  const na = normalizeCell(a);
  const nb = normalizeCell(b);
  if (isEmptyish(na) && isEmptyish(nb)) return true;
  if (typeof na === 'number' && typeof nb === 'number') {
    return Math.abs(na - nb) <= Math.max(1e-6, Math.abs(nb) * 1e-9);
  }
  return String(na).toUpperCase() === String(nb).toUpperCase();
};

const normKeyPart = (v, numeric) => {
  const s = String(unwrap(v) ?? '').trim().toUpperCase();
  if (numeric && /^\d+(\.\d+)?$/.test(s)) return String(parseFloat(s));
  return s;
};

// Text block/lot keep "1.10" distinct from "1.1"; the numeric columns are only a
// fallback when a manager deleted the text ones, and then both sides normalize alike.
export const makeKeyFn = (rosterHeaders) => {
  const hasText = rosterHeaders.includes('Block (text)') && rosterHeaders.includes('Lot (text)');
  return (row) => {
    const block = hasText ? row['Block (text)'] : (row['Block'] ?? row['Block (text)']);
    const lot = hasText ? row['Lot (text)'] : (row['Lot'] ?? row['Lot (text)']);
    return [normKeyPart(block, !hasText), normKeyPart(lot, !hasText), normKeyPart(row['Qualifier'], false)].join('|');
  };
};

const indexRows = (rows, keyFn) => {
  const map = new Map();
  rows.forEach((row, idx) => {
    let key = keyFn(row);
    let n = 2;
    while (map.has(key)) key = `${keyFn(row)}#${n++}`;
    map.set(key, { row, idx });
  });
  return map;
};

const parcelLabel = (row) => ({
  block: unwrap(row['Block (text)'] ?? row['Block']) ?? '',
  lot: unwrap(row['Lot (text)'] ?? row['Lot']) ?? '',
  qualifier: unwrap(row['Qualifier']) ?? '',
  address: unwrap(row['Address']) ?? ''
});

/**
 * rosterRows / currentRows: arrays of { header: value }.
 * currentCamaTotals: array aligned with currentRows (values_cama_total).
 * withAssessment: only meaningful for an Excel-saved roster, where formula cells carry results.
 */
export const compareRosters = ({ rosterHeaders, rosterRows, currentHeaders, currentRows, currentCamaTotals = [], withAssessment }) => {
  const keyFn = makeKeyFn(rosterHeaders);
  const rosterIdx = indexRows(rosterRows, keyFn);
  const currentIdx = indexRows(currentRows, keyFn);

  const columns = rosterHeaders.filter(h => currentHeaders.includes(h) && !KEY_COLUMNS.has(h) && !FORMULA_COLUMNS.has(h));
  const missingColumns = currentHeaders.filter(h => !rosterHeaders.includes(h));

  const items = [];

  currentIdx.forEach(({ row }, key) => {
    if (!rosterIdx.has(key)) {
      items.push({ key, category: 'added', column: '', rosterValue: '', currentValue: '', ...parcelLabel(row) });
    }
  });

  rosterIdx.forEach(({ row: rRow }, key) => {
    const cur = currentIdx.get(key);
    if (!cur) {
      items.push({ key, category: 'removed', column: '', rosterValue: '', currentValue: '', ...parcelLabel(rRow) });
      return;
    }
    const cRow = cur.row;
    const label = parcelLabel(cRow);
    columns.forEach(col => {
      if (!cellsEqual(rRow[col], cRow[col])) {
        items.push({
          key, category: categoryOf(col), column: col,
          rosterValue: normalizeCell(rRow[col]), currentValue: normalizeCell(cRow[col]),
          ...label
        });
      }
    });

    if (withAssessment) {
      const rosterProj = normalizeCell(rRow['Proj Total']);
      const camaTotal = Number(currentCamaTotals[cur.idx]) || 0;
      if (typeof rosterProj === 'number' && Math.round(rosterProj) !== Math.round(camaTotal)) {
        items.push({
          key, category: 'assessment', column: 'Proj Total vs CAMA Total',
          rosterValue: Math.round(rosterProj), currentValue: Math.round(camaTotal),
          ...label
        });
      }
    }
  });

  const counts = {};
  CATEGORIES.forEach(c => { counts[c.id] = 0; });
  const parcelsByCategory = {};
  items.forEach(it => {
    if (it.category === 'added' || it.category === 'removed' || it.category === 'assessment') {
      counts[it.category]++;
    } else {
      if (!parcelsByCategory[it.category]) parcelsByCategory[it.category] = new Set();
      parcelsByCategory[it.category].add(it.key);
    }
  });
  Object.entries(parcelsByCategory).forEach(([cat, set]) => { counts[cat] = set.size; });

  return { items, counts, columnsCompared: columns, missingColumns, keyFn };
};

export const formatCompareValue = (column, v) => {
  if (v === '' || v === null || v === undefined) return '—';
  if (column === 'Sale Date' && typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return String(v);
};

// ---------- snapshot storage ----------

const gzip = async (text) => {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([text], { type: 'application/json' }), compressed: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), compressed: true };
};

const gunzipText = async (blob, compressed) => {
  if (!compressed) return blob.text();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
};

export const saveRosterSnapshot = async ({ jobData, headers, rows }) => {
  const values = rows.map(r => headers.map(h => (FORMULA_COLUMNS.has(h) ? null : normalizeCell(r[h]))));
  const { blob, compressed } = await gzip(JSON.stringify({ headers, rows: values }));
  const path = `${jobData.id}/current.json${compressed ? '.gz' : ''}`;

  const { error: upErr } = await supabase.storage.from(SNAPSHOT_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: compressed ? 'application/gzip' : 'application/json'
  });
  if (upErr) throw upErr;

  const { data: userData } = await supabase.auth.getUser();
  const meta = {
    path,
    compressed,
    built_at: new Date().toISOString(),
    built_by: userData?.user?.email || null,
    row_count: rows.length,
    source_file_version: jobData.source_file_version ?? null
  };
  const { error: metaErr } = await supabase.from('job_settings').upsert(
    { job_id: jobData.id, setting_key: SNAPSHOT_SETTING_KEY, setting_value: JSON.stringify(meta), updated_at: meta.built_at },
    { onConflict: 'job_id,setting_key' }
  );
  if (metaErr) throw metaErr;
  return meta;
};

export const loadSnapshotMeta = async (jobId) => {
  const { data, error } = await supabase
    .from('job_settings')
    .select('setting_value')
    .eq('job_id', jobId)
    .eq('setting_key', SNAPSHOT_SETTING_KEY)
    .maybeSingle();
  if (error) throw error;
  if (!data?.setting_value) return null;
  return typeof data.setting_value === 'string' ? JSON.parse(data.setting_value) : data.setting_value;
};

export const loadSnapshotRows = async (meta) => {
  const { data, error } = await supabase.storage.from(SNAPSHOT_BUCKET).download(meta.path);
  if (error) throw error;
  const parsed = JSON.parse(await gunzipText(data, meta.compressed));
  const rows = parsed.rows.map(vals => {
    const o = {};
    parsed.headers.forEach((h, i) => { o[h] = vals[i]; });
    return o;
  });
  return { headers: parsed.headers, rows };
};
