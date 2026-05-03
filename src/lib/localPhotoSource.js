// src/lib/localPhotoSource.js
//
// Local photo source utility for the property-photo workflow.
//
// What this does:
//   1. Lets the user pick one or more local folders (e.g. C:\Powerpad\Pictures,
//      C:\PowerCama\pictures) using the File System Access API.
//   2. Persists the resulting FileSystemDirectoryHandle objects in IndexedDB
//      so the user does not have to re-pick on every page load.
//   3. Walks a CCDD subfolder under each source on demand and parses filenames
//      against the BRT and Microsystems naming conventions, returning a map
//      keyed by "block-lot-qualifier" so the Appeal Log / CME can light up
//      photo matches per parcel.
//
// Notes on browser support:
//   - Persistent handles + showDirectoryPicker work in Chrome / Edge / Brave / Opera.
//   - In other browsers we expose isSupported() === false; the UI should hide
//     the feature there.

const DB_NAME = 'lojik-photo-sources';
const DB_VERSION = 2;
const STORE_SOURCES = 'sources';        // global / multi-source list (v1, kept for back-compat)
const STORE_JOB_SOURCES = 'job_sources'; // per-job source map: { jobId, ccdd, label, handle, ... }

// ---------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SOURCES)) {
        db.createObjectStore(STORE_SOURCES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_JOB_SOURCES)) {
        db.createObjectStore(STORE_JOB_SOURCES, { keyPath: 'jobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db, mode, storeName = STORE_SOURCES) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isSupported() {
  return typeof window !== 'undefined'
    && typeof window.showDirectoryPicker === 'function'
    && typeof window.indexedDB !== 'undefined';
}

/** True only when we are in a top-level browsing context (not iframed). */
export function canUsePersistentPicker() {
  if (!isSupported()) return false;
  try {
    return window.top === window.self;
  } catch (_e) {
    // cross-origin iframe — accessing window.top throws
    return false;
  }
}

/**
 * Prompt the user to pick a folder, persist the handle, and return the saved
 * record. The optional `label` lets the user tag a source ("Powerpad",
 * "PowerCama", etc.) — if omitted we use the folder's name.
 */
export async function addSource(label) {
  if (!isSupported()) throw new Error('File System Access API is not supported in this browser.');
  const handle = await window.showDirectoryPicker({ id: 'lojik-photos', mode: 'read' });
  // Verify (or request) read permission
  const perm = await ensurePermission(handle, 'read');
  if (perm !== 'granted') throw new Error('Permission to read the selected folder was denied.');

  const id = `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    label: label || handle.name,
    handle,
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  await reqAsPromise(txStore(db, 'readwrite').put(record));
  db.close();
  return record;
}

export async function listSources() {
  if (!isSupported()) return [];
  const db = await openDb();
  const records = await reqAsPromise(txStore(db, 'readonly').getAll());
  db.close();
  return records || [];
}

export async function removeSource(id) {
  const db = await openDb();
  await reqAsPromise(txStore(db, 'readwrite').delete(id));
  db.close();
}

export async function ensurePermission(handle, mode = 'read') {
  if (!handle?.queryPermission) return 'granted';
  const opts = { mode };
  let p = await handle.queryPermission(opts);
  if (p === 'granted') return p;
  p = await handle.requestPermission(opts);
  return p;
}

// ---------------------------------------------------------------------------
// Filename parser
// ---------------------------------------------------------------------------
//
// Microsystems: CCDD-B-L-Q--N.ext   (decimal lot uses "_": 3.02 -> 3_02; no Q -> empty between dashes -> "--")
// BRT:          CCDD_B_L_Q__N.ext   (decimal lot uses "-": 3.02 -> 3-02; no Q -> empty between underscores -> "__")
//
// Strategy: count "-" vs "_" in the stem; whichever is more numerous is the
// field separator. The other character is reserved for the decimal lot.
// We split on the field separator, expect exactly 5 parts, and normalize the
// lot back to a "." for keying.

const IMG_EXT_RE = /\.(jpe?g|png|gif|bmp|tiff?)$/i;

export function parsePhotoName(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (!IMG_EXT_RE.test(filename)) return null;
  const stem = filename.replace(IMG_EXT_RE, '');

  const dashCount = (stem.match(/-/g) || []).length;
  const undCount = (stem.match(/_/g) || []).length;

  // Pick whichever character has at least 4 instances (one between each of the
  // 5 fields). If both qualify, prefer the one with more instances.
  let fieldSep;
  if (dashCount >= 4 && dashCount >= undCount) fieldSep = '-';
  else if (undCount >= 4) fieldSep = '_';
  else return null;

  const parts = stem.split(fieldSep);
  if (parts.length !== 5) return null;

  const [ccdd, block, lotRaw, qualifier, photoNum] = parts;
  if (!/^\d{4}$/.test(ccdd)) return null;
  if (!/^\d+$/.test(photoNum)) return null;
  if (!block) return null;
  if (!lotRaw) return null;

  // Decimal char is the "other" separator
  const decimalChar = fieldSep === '-' ? '_' : '-';
  const lot = lotRaw.includes(decimalChar) ? lotRaw.replace(decimalChar, '.') : lotRaw;

  return {
    ccdd,
    block,
    lot,
    qualifier: qualifier || null,
    photoNum: Number(photoNum),
    vendor: fieldSep === '-' ? 'micro' : 'brt',
  };
}

/** Build the canonical key the Appeal Log / CME use for a parcel. */
export function parcelKey(block, lot, qualifier) {
  const q = qualifier && String(qualifier).trim() ? String(qualifier).trim().toUpperCase() : '';
  return `${String(block).trim()}-${String(lot).trim()}-${q}`;
}

// ---------------------------------------------------------------------------
// Indexer
// ---------------------------------------------------------------------------

/**
 * Walk the CCDD subfolder under each connected source and return:
 *   {
 *     bySource: [{ sourceId, sourceLabel, found: <count>, error: <string|null> }],
 *     totals:   { sources: N, files: N, parcels: N, unmatched: N },
 *     index:    Map<parcelKey, [{ sourceId, sourceLabel, vendor, fileHandle, name, photoNum }]>,
 *   }
 *
 * The index value-array is sorted by photoNum ascending so callers can take
 * the highest-numbered (most-recent) photo by default.
 *
 * `ccdd` is the 4-digit county+district code (e.g. "1705"). We look for an
 * immediate child folder of the source that matches the CCDD (case-insensitive,
 * leading zeros preserved).
 */
export async function indexSourcesForCcdd(ccdd, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const sources = await listSources();
  const index = new Map();
  let totalFiles = 0;
  let unmatched = 0;
  const bySource = [];

  for (const src of sources) {
    const report = { sourceId: src.id, sourceLabel: src.label, found: 0, error: null };
    try {
      const perm = await ensurePermission(src.handle, 'read');
      if (perm !== 'granted') {
        report.error = 'permission denied';
        bySource.push(report);
        continue;
      }
      // Find the CCDD subfolder (case-insensitive)
      let ccddDir = null;
      for await (const [name, entry] of src.handle.entries()) {
        if (entry.kind === 'directory' && String(name).toLowerCase() === String(ccdd).toLowerCase()) {
          ccddDir = entry;
          break;
        }
      }
      if (!ccddDir) {
        report.error = `no "${ccdd}" subfolder`;
        bySource.push(report);
        continue;
      }

      // Walk files inside the CCDD subfolder (one level deep is fine for both vendors)
      for await (const [name, entry] of ccddDir.entries()) {
        if (entry.kind !== 'file') continue;
        totalFiles += 1;
        const parsed = parsePhotoName(name);
        if (!parsed) {
          unmatched += 1;
          continue;
        }
        // Defensive: make sure the parsed CCDD matches what we asked for
        if (parsed.ccdd !== String(ccdd)) {
          unmatched += 1;
          continue;
        }
        const key = parcelKey(parsed.block, parsed.lot, parsed.qualifier);
        const arr = index.get(key) || [];
        arr.push({
          sourceId: src.id,
          sourceLabel: src.label,
          vendor: parsed.vendor,
          fileHandle: entry,
          name,
          photoNum: parsed.photoNum,
        });
        index.set(key, arr);
        report.found += 1;
        if (report.found % 200 === 0) onProgress({ source: src.label, found: report.found });
      }
    } catch (e) {
      report.error = e?.message || String(e);
    }
    bySource.push(report);
  }

  // Sort each parcel's photos by photoNum asc
  for (const arr of index.values()) {
    arr.sort((a, b) => a.photoNum - b.photoNum);
  }

  return {
    bySource,
    totals: {
      sources: sources.length,
      files: totalFiles,
      parcels: index.size,
      unmatched,
    },
    index,
  };
}

/** Convenience: read the bytes of a single matched photo. */
export async function readPhoto(match) {
  if (match?.file) return match.file; // session-source already holds the File
  if (!match?.fileHandle) throw new Error('No file handle on match.');
  const file = await match.fileHandle.getFile();
  return file;
}

// ---------------------------------------------------------------------------
// Per-Job source — the recommended path
// ---------------------------------------------------------------------------
//
// Each Job remembers the folder its photos live in. Stored in IndexedDB keyed
// by jobId so a single browser/machine resolves the right folder
// automatically when the Job opens. Per-Town, per-machine, persistent.
//
// Shape: { jobId, ccdd, label, handle, createdAt }
//
// Workflow:
//   1. JobContainer mounts → call getJobSource(jobId).
//   2. If found → ensurePermission(handle) → indexJobSource(jobId, ccdd).
//   3. If not found → user clicks "Connect Photo Folder" → pickJobSource(jobId, ccdd).

/**
 * Validate that a folder either IS the CCDD subfolder, or contains it as a
 * direct child. Returns one of:
 *   { matches: true,  foundAs: 'self',   resolvedHandle: <ccdd dir handle> }
 *   { matches: true,  foundAs: 'parent', resolvedHandle: <ccdd dir handle> }
 *   { matches: false, foundAs: null,     resolvedHandle: null }
 */
export async function validateSourceForCcdd(handle, ccdd) {
  if (!handle || !ccdd) return { matches: false, foundAs: null, resolvedHandle: null };
  const ccddStr = String(ccdd).toLowerCase();

  // Case 1: the picked folder IS the CCDD folder
  if (handle.name && handle.name.toLowerCase() === ccddStr) {
    return { matches: true, foundAs: 'self', resolvedHandle: handle };
  }

  // Case 2: the picked folder contains a CCDD subfolder
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory' && name.toLowerCase() === ccddStr) {
        return { matches: true, foundAs: 'parent', resolvedHandle: entry };
      }
    }
  } catch (_e) {
    // permission revoked or empty
  }
  return { matches: false, foundAs: null, resolvedHandle: null };
}

/** Read the saved per-Job source (if any) and re-grant permission. */
export async function getJobSource(jobId) {
  if (!isSupported() || !jobId) return null;
  const db = await openDb();
  const rec = await reqAsPromise(txStore(db, 'readonly', STORE_JOB_SOURCES).get(jobId));
  db.close();
  if (!rec) return null;
  // Re-request permission silently if granted, otherwise caller decides
  try {
    await ensurePermission(rec.handle, 'read');
  } catch (_e) {/* caller handles */ }
  return rec;
}

/**
 * Open the persistent picker, validate against the Job's CCDD, persist on success.
 * Returns:
 *   { ok: true, record }                               — saved
 *   { ok: false, reason: 'mismatch', folderName }      — folder does not contain CCDD
 *   { ok: false, reason: 'permission' | <error> }
 */
export async function pickJobSource(jobId, ccdd, opts = {}) {
  if (!canUsePersistentPicker()) {
    return { ok: false, reason: 'unsupported' };
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: `lojik-photos-${ccdd}`, mode: 'read' });
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: e?.message || String(e) };
  }
  const perm = await ensurePermission(handle, 'read');
  if (perm !== 'granted') return { ok: false, reason: 'permission' };

  const v = await validateSourceForCcdd(handle, ccdd);
  if (!v.matches && !opts.allowMismatch) {
    return { ok: false, reason: 'mismatch', folderName: handle.name, ccdd };
  }

  const record = {
    jobId,
    ccdd: String(ccdd),
    label: handle.name,
    handle, // store the original picked handle (so user can move CCDD subfolders inside later)
    foundAs: v.foundAs,
    createdAt: new Date().toISOString(),
  };
  const db = await openDb();
  await reqAsPromise(txStore(db, 'readwrite', STORE_JOB_SOURCES).put(record));
  db.close();
  return { ok: true, record };
}

export async function clearJobSource(jobId) {
  if (!isSupported() || !jobId) return;
  const db = await openDb();
  await reqAsPromise(txStore(db, 'readwrite', STORE_JOB_SOURCES).delete(jobId));
  db.close();
}

/**
 * Walk the saved per-Job source's CCDD subfolder and build the parcel index.
 * Same shape as indexSourcesForCcdd but for a single Job.
 */
export async function indexJobSource(jobId) {
  const rec = await getJobSource(jobId);
  if (!rec) return null;
  const v = await validateSourceForCcdd(rec.handle, rec.ccdd);
  if (!v.matches) return { error: 'CCDD subfolder no longer found in saved source.' };
  const ccddDir = v.resolvedHandle;
  const index = new Map();
  let totalFiles = 0;
  let unmatched = 0;
  try {
    for await (const [name, entry] of ccddDir.entries()) {
      if (entry.kind !== 'file') continue;
      totalFiles += 1;
      const parsed = parsePhotoName(name);
      if (!parsed || parsed.ccdd !== rec.ccdd) {
        unmatched += 1;
        continue;
      }
      const key = parcelKey(parsed.block, parsed.lot, parsed.qualifier);
      const arr = index.get(key) || [];
      arr.push({
        sourceLabel: rec.label,
        vendor: parsed.vendor,
        fileHandle: entry,
        name,
        photoNum: parsed.photoNum,
      });
      index.set(key, arr);
    }
  } catch (e) {
    return { error: e?.message || String(e) };
  }
  for (const arr of index.values()) {
    arr.sort((a, b) => a.photoNum - b.photoNum);
  }
  return {
    label: rec.label,
    ccdd: rec.ccdd,
    totals: { files: totalFiles, parcels: index.size, unmatched },
    index,
  };
}

// ---------------------------------------------------------------------------
// Session-only fallback (works inside cross-origin iframes via <input webkitdirectory>)
// ---------------------------------------------------------------------------
//
// When the persistent File System Access API is unavailable (Safari, Firefox,
// or cross-origin iframe like the Builder editor preview), the UI can fall
// back to <input type="file" webkitdirectory multiple>. That gives us a flat
// list of File objects with relative paths. We hold them in memory only for
// this session (no IndexedDB, no persistence).

const sessionSources = []; // [{ id, label, files: File[] }]

export function addSessionSource(label, fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return null;
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const rec = { id, label: label || `Session folder (${files.length} files)`, files, session: true };
  sessionSources.push(rec);
  return rec;
}

export function listSessionSources() {
  return sessionSources.map(({ id, label, files }) => ({ id, label, files: files.length, session: true }));
}

export function removeSessionSource(id) {
  const i = sessionSources.findIndex((s) => s.id === id);
  if (i >= 0) sessionSources.splice(i, 1);
}

/**
 * Index session-source File lists for a CCDD. Same shape as
 * indexSourcesForCcdd so callers can use either path uniformly.
 *
 * For each session source we look at each File's webkitRelativePath; the path
 * segment immediately under the chosen folder must match the CCDD (so the user
 * can either pick the parent Pictures folder OR the CCDD subfolder directly,
 * and we handle both).
 */
export function indexSessionSourcesForCcdd(ccdd) {
  const ccddStr = String(ccdd);
  const index = new Map();
  const bySource = [];
  let totalFiles = 0;
  let unmatched = 0;

  for (const src of sessionSources) {
    const report = { sourceId: src.id, sourceLabel: src.label, found: 0, error: null };
    for (const file of src.files) {
      // webkitRelativePath looks like "Pictures/1705/1705-1-1--1.jpg" or
      // "1705/1705-1-1--1.jpg" if they picked the CCDD folder directly.
      const rel = file.webkitRelativePath || file.name;
      const segments = rel.split('/').filter(Boolean);
      // Require the file to live under a CCDD-matching segment, or be one folder deep
      const inCcdd = segments.some((seg) => seg.toLowerCase() === ccddStr.toLowerCase());
      if (!inCcdd) continue;
      totalFiles += 1;
      const parsed = parsePhotoName(file.name);
      if (!parsed || parsed.ccdd !== ccddStr) {
        unmatched += 1;
        continue;
      }
      const key = parcelKey(parsed.block, parsed.lot, parsed.qualifier);
      const arr = index.get(key) || [];
      arr.push({
        sourceId: src.id,
        sourceLabel: src.label,
        vendor: parsed.vendor,
        file,
        name: file.name,
        photoNum: parsed.photoNum,
      });
      index.set(key, arr);
      report.found += 1;
    }
    bySource.push(report);
  }

  for (const arr of index.values()) {
    arr.sort((a, b) => a.photoNum - b.photoNum);
  }

  return {
    bySource,
    totals: { sources: sessionSources.length, files: totalFiles, parcels: index.size, unmatched },
    index,
  };
}

/**
 * Combined indexer: walks both persistent sources (if supported) and any
 * session-only sources, returning a merged result.
 */
export async function indexAllForCcdd(ccdd, opts = {}) {
  const persistent = isSupported()
    ? await indexSourcesForCcdd(ccdd, opts)
    : { bySource: [], totals: { sources: 0, files: 0, parcels: 0, unmatched: 0 }, index: new Map() };
  const session = indexSessionSourcesForCcdd(ccdd);

  // Merge maps
  const index = new Map(persistent.index);
  for (const [key, arr] of session.index.entries()) {
    const existing = index.get(key) || [];
    existing.push(...arr);
    existing.sort((a, b) => a.photoNum - b.photoNum);
    index.set(key, existing);
  }

  return {
    bySource: [...persistent.bySource, ...session.bySource],
    totals: {
      sources: persistent.totals.sources + session.totals.sources,
      files: persistent.totals.files + session.totals.files,
      parcels: index.size,
      unmatched: persistent.totals.unmatched + session.totals.unmatched,
    },
    index,
  };
}
