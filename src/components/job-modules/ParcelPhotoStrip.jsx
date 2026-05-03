// src/components/job-modules/ParcelPhotoStrip.jsx
//
// Compact horizontal photo row that mirrors the comp-grid columns above.
// One small column per parcel (Subject + each Comp). Each column shows the
// currently-focused photo, a counter, ◀ / ▶ to cycle, and a star to mark it
// as the front photo for that parcel. Empty cell -> click to add (file
// picker), or paste from clipboard while the cell is focused.
//
// Reads the indexed photo map from JobPhotoSourceContext.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Star, Plus, Loader2, Check } from 'lucide-react';
import { useJobPhotoSource } from '../../contexts/JobPhotoSourceContext';
import { readPhoto } from '../../lib/localPhotoSource';
import { supabase } from '../../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_PASTE_MIME = /^image\//;

function fmtCaptureTs(ts) {
  if (!ts || ts.length !== 14) return null;
  const yy = ts.slice(2, 4);
  const mm = ts.slice(4, 6);
  const dd = ts.slice(6, 8);
  let hh = parseInt(ts.slice(8, 10), 10);
  const mi = ts.slice(10, 12);
  const ampm = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12 || 12;
  return `${mm}/${dd}/${yy} ${hh}:${mi}${ampm}`;
}

function safeStorageKey(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

// ---------------------------------------------------------------------------
// Per-parcel column
// ---------------------------------------------------------------------------

function ParcelColumn({ parcel, jobId, savedPhoto, onSaved }) {
  const { getPhotosFor, connected } = useJobPhotoSource();
  const folderPhotos = useMemo(
    () => getPhotosFor(parcel.block, parcel.lot, parcel.qualifier),
    [getPhotosFor, parcel.block, parcel.lot, parcel.qualifier],
  );

  // Local additions (paste / file-picker) not on disk
  const [extras, setExtras] = useState([]);
  const photos = useMemo(() => [...folderPhotos, ...extras], [folderPhotos, extras]);

  const [focusIdx, setFocusIdx] = useState(() => Math.max(0, photos.length - 1));
  useEffect(() => {
    setFocusIdx((i) => Math.min(Math.max(0, i), Math.max(0, photos.length - 1)));
  }, [photos.length]);

  const [previewUrl, setPreviewUrl] = useState(null);
  const previewUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const m = photos[focusIdx];
      if (!m) { setPreviewUrl(null); return; }
      try {
        const file = await readPhoto(m);
        if (cancelled) return;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      } catch (_e) { setPreviewUrl(null); }
    }
    run();
    return () => { cancelled = true; };
  }, [focusIdx, photos]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const isPicked = (() => {
    const m = photos[focusIdx];
    if (!m || !savedPhoto) return false;
    return savedPhoto.original_filename === m.name;
  })();

  const handlePick = useCallback(async () => {
    const m = photos[focusIdx];
    if (!m || !jobId) return;
    setSaving(true);
    setSaveError('');
    try {
      const file = await readPhoto(m);
      const ext = (m.name?.split('.').pop() || 'jpg').toLowerCase();
      const path = `${jobId}/${safeStorageKey(parcel.composite_key)}/front_${Date.now()}.${ext}`;

      if (savedPhoto?.storage_path) {
        try { await supabase.storage.from('appeal-photos').remove([savedPhoto.storage_path]); } catch (_e) {}
      }

      const { error: uploadErr } = await supabase.storage
        .from('appeal-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: userResp } = await supabase.auth.getUser();
      const row = {
        job_id: jobId,
        property_composite_key: parcel.composite_key,
        appeal_id: parcel.appeal_id || null,
        storage_path: path,
        source: m.source === 'clipboard' ? 'clipboard'
              : m.source === 'user_upload' ? 'user_upload'
              : (m.vendor === 'brt' ? 'powerpad' : 'powercama'),
        original_filename: m.name,
        capture_ts: m.captureTs || null,
        picked_by: userResp?.user?.id || null,
        picked_at: new Date().toISOString(),
      };
      const { data, error: dbErr } = await supabase
        .from('appeal_photos')
        .upsert(row, { onConflict: 'job_id,property_composite_key' })
        .select()
        .single();
      if (dbErr) throw dbErr;
      onSaved?.(data);
    } catch (e) {
      setSaveError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [photos, focusIdx, jobId, parcel.composite_key, parcel.appeal_id, savedPhoto, onSaved]);

  // Arrow keys when this column has focus
  const onKeyDown = (e) => {
    if (photos.length < 2) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + photos.length) % photos.length);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % photos.length);
    }
  };

  // Add-photo: file picker (click) + clipboard paste (when focused)
  const fileInputRef = useRef(null);
  const addExtra = useCallback((file, source) => {
    if (!file || !file.type || !SUPPORTED_PASTE_MIME.test(file.type)) return;
    setExtras((arr) => {
      const next = [...arr, {
        name: file.name || `${source}-${Date.now()}.png`,
        file,
        photoNum: Number.MAX_SAFE_INTEGER - (1000 - arr.length),
        source,
        vendor: null,
        captureTs: null,
      }];
      setTimeout(() => setFocusIdx(folderPhotos.length + next.length - 1), 0);
      return next;
    });
  }, [folderPhotos.length]);

  const onPaste = useCallback((e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.kind === 'file' && SUPPORTED_PASTE_MIME.test(item.type)) {
        const file = item.getAsFile();
        if (file) {
          addExtra(file, 'clipboard');
          e.preventDefault();
          return;
        }
      }
    }
  }, [addExtra]);

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (file) addExtra(file, 'user_upload');
    e.target.value = '';
  };

  const empty = photos.length === 0;

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className="flex-1 min-w-0 flex flex-col items-stretch outline-none focus:ring-2 focus:ring-blue-400 rounded"
    >
      {/* Role chip header (mirrors comp grid header) */}
      <div className="flex items-center justify-center mb-1">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${parcel.roleColor || 'bg-gray-100 text-gray-700'}`}>
          {parcel.roleLabel}
        </span>
      </div>

      {/* Photo cell */}
      {empty ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full aspect-square bg-gray-50 hover:bg-blue-50 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded flex flex-col items-center justify-center text-gray-400 hover:text-blue-600 text-[10px] gap-1 px-1 text-center"
          title={connected ? 'Click to add a photo (or paste with Ctrl+V)' : 'No photo folder connected. Click to add a photo.'}
        >
          <Plus size={18} />
          <span>Add photo</span>
        </button>
      ) : (
        <div className="relative w-full aspect-square bg-gray-100 rounded overflow-hidden border border-gray-200">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="object-cover w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 size={16} className="animate-spin text-gray-400" />
            </div>
          )}
          {/* Picked badge */}
          {isPicked && (
            <span className="absolute top-1 right-1 bg-green-600 text-white rounded-full p-0.5">
              <Check size={10} />
            </span>
          )}
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between mt-1 gap-1">
        <button
          disabled={photos.length < 2}
          onClick={() => setFocusIdx((i) => (i - 1 + photos.length) % photos.length)}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20"
          title="Previous (←)"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[10px] text-gray-500 tabular-nums">
          {empty ? '0/0' : `${focusIdx + 1}/${photos.length}`}
        </span>
        <button
          disabled={photos.length < 2}
          onClick={() => setFocusIdx((i) => (i + 1) % photos.length)}
          className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-20"
          title="Next (→)"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Pick + Add row */}
      <div className="flex items-center gap-1 mt-1">
        <button
          disabled={empty || saving}
          onClick={handlePick}
          className={`flex-1 px-1.5 py-0.5 text-[10px] rounded flex items-center justify-center gap-1 ${
            isPicked
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 disabled:opacity-40 disabled:bg-gray-100 disabled:text-gray-400'
          }`}
          title="Use as front photo"
        >
          {saving ? <Loader2 size={10} className="animate-spin" />
            : isPicked ? <Check size={10} /> : <Star size={10} />}
          {isPicked ? 'Front' : 'Use'}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-1 py-0.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 rounded flex items-center gap-0.5"
          title="Add another photo (or paste with Ctrl+V while focused)"
        >
          <Plus size={10} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFilePicked} />
      </div>

      {saveError && <div className="text-[10px] text-red-700 mt-0.5 truncate" title={saveError}>{saveError}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export modal preview - read-only thumbnail row of currently-picked photos
// ---------------------------------------------------------------------------

export function ExportPhotosPreview({ jobId, parcels = [] }) {
  const [savedMap, setSavedMap] = useState({});
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!jobId || parcels.length === 0) return;
      const keys = parcels.map((p) => p.composite_key).filter(Boolean);
      const { data } = await supabase
        .from('appeal_photos')
        .select('*')
        .eq('job_id', jobId)
        .in('property_composite_key', keys);
      if (cancelled) return;
      const map = {};
      (data || []).forEach((r) => { map[r.property_composite_key] = r; });
      setSavedMap(map);

      const urlMap = {};
      await Promise.all((data || []).map(async (r) => {
        try {
          const { data: signed } = await supabase.storage
            .from('appeal-photos')
            .createSignedUrl(r.storage_path, 60 * 30);
          if (signed?.signedUrl) urlMap[r.property_composite_key] = signed.signedUrl;
        } catch (_e) {}
      }));
      if (!cancelled) setUrls(urlMap);
    })();
    return () => { cancelled = true; };
  }, [jobId, parcels]);

  const pickedCount = Object.keys(savedMap).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          📷 Photos in PDF
          <span className="text-xs text-gray-500 font-normal">
            ({pickedCount} of {parcels.length} parcels have a front photo)
          </span>
        </div>
        <span className="text-[11px] text-gray-500">
          To change a pick, scroll to the parcel photo strip in the main view.
        </span>
      </div>
      <div className="flex gap-2">
        {parcels.map((p) => {
          const url = urls[p.composite_key];
          return (
            <div key={p.composite_key} className="flex-1 min-w-0">
              <div className="text-center mb-1">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${p.roleColor}`}>{p.roleLabel}</span>
              </div>
              <div className="w-full aspect-square bg-gray-100 rounded overflow-hidden border border-gray-200 flex items-center justify-center">
                {url ? (
                  <img src={url} alt="" className="object-cover w-full h-full" />
                ) : (
                  <span className="text-[10px] text-gray-400 px-2 text-center">No front photo</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main: compact horizontal strip aligned with the comp grid above
// ---------------------------------------------------------------------------

export default function ParcelPhotoStrip({ jobId, parcels = [] }) {
  const { connected, indexResult, source } = useJobPhotoSource();
  const [savedMap, setSavedMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!jobId || parcels.length === 0) return;
      const keys = parcels.map((p) => p.composite_key).filter(Boolean);
      if (keys.length === 0) return;
      const { data, error } = await supabase
        .from('appeal_photos')
        .select('*')
        .eq('job_id', jobId)
        .in('property_composite_key', keys);
      if (cancelled || error) return;
      const map = {};
      (data || []).forEach((r) => { map[r.property_composite_key] = r; });
      setSavedMap(map);
    })();
    return () => { cancelled = true; };
  }, [jobId, parcels]);

  if (parcels.length === 0) return null;

  return (
    <div className="mt-3 border-t border-gray-200 pt-2">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-2">
          📷 Parcel Photos
          {connected && indexResult && (
            <span className="text-[10px] text-gray-500 font-normal">
              ({indexResult.totals.parcels.toLocaleString()} parcels indexed from {source.label})
            </span>
          )}
        </h3>
        <span className="text-[10px] text-gray-500">← → cycle · ⭐ pick · + add (or Ctrl+V to paste)</span>
      </div>

      {/* Layout mirrors the comp grid: a left "Attribute" gutter then one
          equal-width cell per parcel. Using a CSS grid with minmax(0, 1fr)
          guarantees every parcel column is exactly the same width, which in
          turn keeps every aspect-square thumbnail visually identical. */}
      <div
        className="grid gap-2 items-start parcel-photo-grid"
        style={{ gridTemplateColumns: `110px repeat(${parcels.length}, minmax(0, 1fr))` }}
      >
        <div aria-hidden="true" />
        {parcels.map((p) => (
          <ParcelColumn
            key={p.composite_key}
            parcel={p}
            jobId={jobId}
            savedPhoto={savedMap[p.composite_key]}
            onSaved={(row) => setSavedMap((m) => ({ ...m, [row.property_composite_key]: row }))}
          />
        ))}
      </div>
    </div>
  );
}
