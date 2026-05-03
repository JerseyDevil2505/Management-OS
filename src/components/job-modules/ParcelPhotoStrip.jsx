// src/components/job-modules/ParcelPhotoStrip.jsx
//
// Renders one row per parcel (Subject + each Comp + each Appellant comp).
// Each row:
//   - Large preview of the currently focused photo
//   - Thumbnail strip (sorted by photoNum asc; default focus = highest = most recent)
//   - ◀ / ▶ arrow buttons + arrow-key navigation when row has focus
//   - Star ("Use as front photo") -> uploads bytes to `appeal-photos` bucket and
//     upserts an `appeal_photos` row keyed by (job_id, property_composite_key)
//   - "Add Photo" target: drag-drop a file OR paste from clipboard
//   - Empty state: "no photos found in folder for <key>" + add affordance
//
// Reads from JobPhotoSourceContext (no folder walk here).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Star, Upload, Loader2, Check } from 'lucide-react';
import { useJobPhotoSource } from '../../contexts/JobPhotoSourceContext';
import { readPhoto } from '../../lib/localPhotoSource';
import { supabase } from '../../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_PASTE_MIME = /^image\//;

function fmtCaptureTs(ts) {
  if (!ts || ts.length !== 14) return null;
  // T20241106144506 -> 11/06/24 2:45pm
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
// Per-parcel row
// ---------------------------------------------------------------------------

function ParcelRow({ parcel, jobId, savedPhoto, onSaved }) {
  const { getPhotosFor, connected, source } = useJobPhotoSource();
  const folderPhotos = useMemo(
    () => getPhotosFor(parcel.block, parcel.lot, parcel.qualifier),
    [getPhotosFor, parcel.block, parcel.lot, parcel.qualifier],
  );

  // Local additions made in this session that aren't on disk (paste/drag)
  const [extras, setExtras] = useState([]); // [{ name, file, photoNum, source }]
  const photos = useMemo(() => [...folderPhotos, ...extras], [folderPhotos, extras]);

  // Default focus = most recent (last in sorted asc list)
  const [focusIdx, setFocusIdx] = useState(() => Math.max(0, photos.length - 1));
  useEffect(() => {
    setFocusIdx((i) => Math.min(Math.max(0, i), Math.max(0, photos.length - 1)));
  }, [photos.length]);

  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewUrlRef = useRef(null);

  // Build preview blob URL whenever focus changes
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const m = photos[focusIdx];
      if (!m) {
        setPreviewUrl(null);
        return;
      }
      setPreviewBusy(true);
      try {
        const file = await readPhoto(m);
        if (cancelled) return;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(file);
        previewUrlRef.current = url;
        setPreviewUrl(url);
      } catch (e) {
        setPreviewUrl(null);
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
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

      // If a previous front photo exists, remove its blob to keep the bucket tidy.
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

  // ----- arrow-key navigation -----
  const rowRef = useRef(null);
  const onKeyDown = (e) => {
    if (photos.length === 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + photos.length) % photos.length);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % photos.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Quick keyboard pick
      e.preventDefault();
      handlePick();
    }
  };

  // ----- drag/drop and paste add-photo -----
  const [dragOver, setDragOver] = useState(false);
  const addExtra = useCallback((file, source) => {
    if (!file || !file.type || !SUPPORTED_PASTE_MIME.test(file.type)) return;
    setExtras((arr) => {
      const next = [...arr, {
        name: file.name || `${source}-${Date.now()}.png`,
        file,
        // Sort to the end (newest)
        photoNum: Number.MAX_SAFE_INTEGER - (1000 - arr.length),
        source,
        vendor: null,
        captureTs: null,
      }];
      // Move focus to the new one
      setTimeout(() => setFocusIdx(folderPhotos.length + next.length - 1), 0);
      return next;
    });
  }, [folderPhotos.length]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) addExtra(file, 'user_upload');
  };

  // Paste handler scoped to the row when it has focus
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

  return (
    <div
      ref={rowRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`outline-none border rounded-lg p-3 mb-3 ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'} focus:ring-2 focus:ring-blue-400`}
    >
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${parcel.roleColor || 'bg-gray-100 text-gray-700'}`}>
            {parcel.roleLabel}
          </span>
          <span className="text-sm font-medium text-gray-800">
            {parcel.address || `${parcel.block}-${parcel.lot}${parcel.qualifier ? '-' + parcel.qualifier : ''}`}
          </span>
          <span className="text-xs text-gray-500">
            {photos.length > 0
              ? `Photo ${focusIdx + 1} of ${photos.length}`
              : 'No photos found'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            disabled={photos.length < 2}
            onClick={() => setFocusIdx((i) => (i - 1 + photos.length) % photos.length)}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
            title="Previous photo (←)"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            disabled={photos.length < 2}
            onClick={() => setFocusIdx((i) => (i + 1) % photos.length)}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
            title="Next photo (→)"
          >
            <ChevronRight size={18} />
          </button>
          <button
            disabled={!photos.length || saving}
            onClick={handlePick}
            className={`ml-2 px-2 py-1 text-xs rounded flex items-center gap-1 ${
              isPicked
                ? 'bg-green-100 text-green-800'
                : 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500 disabled:opacity-50'
            }`}
            title="Use as front photo for this parcel"
          >
            {saving ? <Loader2 size={14} className="animate-spin" />
              : isPicked ? <Check size={14} /> : <Star size={14} />}
            {isPicked ? 'Front photo' : 'Use as front photo'}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        {/* Large preview */}
        <div className="w-72 h-48 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
          {previewBusy ? (
            <Loader2 size={20} className="animate-spin text-gray-400" />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="object-contain w-full h-full" />
          ) : (
            <span className="text-xs text-gray-400 px-3 text-center">
              {connected
                ? 'No photo. Drag-drop, paste from clipboard, or capture in the field.'
                : 'Connect a photo folder for this Town to preview photos →'}
            </span>
          )}
        </div>

        {/* Thumbnail strip */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div className="flex gap-1.5">
            {photos.map((p, i) => (
              <Thumb
                key={`${p.name}-${i}`}
                photo={p}
                active={i === focusIdx}
                onClick={() => setFocusIdx(i)}
              />
            ))}
            <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center text-gray-400 text-[10px] text-center px-1 flex-shrink-0">
              <Upload size={16} />
              <span>Drag/Paste</span>
            </div>
          </div>
          <div className="text-[11px] text-gray-500 mt-2">
            {(() => {
              const m = photos[focusIdx];
              if (!m) return source ? 'Tip: drag a JPG onto this row or paste a screenshot (Ctrl+V).' : null;
              const ts = m.captureTs ? fmtCaptureTs(m.captureTs) : null;
              return (
                <>
                  <span className="font-mono">{m.name}</span>
                  {ts && <> · captured {ts}</>}
                  {m.source && <> · {m.source}</>}
                </>
              );
            })()}
          </div>
          {saveError && <div className="text-xs text-red-700 mt-1">{saveError}</div>}
        </div>
      </div>
    </div>
  );
}

function Thumb({ photo, active, onClick }) {
  const [url, setUrl] = useState(null);
  const urlRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = await readPhoto(photo);
        if (cancelled) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const u = URL.createObjectURL(file);
        urlRef.current = u;
        setUrl(u);
      } catch (_e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [photo]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <button
      onClick={onClick}
      className={`w-20 h-20 rounded overflow-hidden border-2 flex-shrink-0 ${active ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-gray-400'}`}
      title={photo.name}
    >
      {url ? <img src={url} alt="" className="object-cover w-full h-full" /> : <div className="w-full h-full bg-gray-100" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
//
// Props:
//   jobId
//   parcels: Array<{
//     composite_key, block, lot, qualifier, address,
//     roleLabel, roleColor (tailwind chip classes), appeal_id (optional)
//   }>
//
// Loads existing `appeal_photos` for this job in one round-trip and caches
// per-composite_key for the rows.

// ---------------------------------------------------------------------------
// Export modal preview - read-only thumbnail row of currently-picked photos
// ---------------------------------------------------------------------------
//
// Lives inside the Export PDF modal. Shows ONLY the photo that's been picked
// for each parcel (or a "no front photo" placeholder). Clicking a thumbnail
// scrolls the main Detailed strip into view via a hash so the user can swap
// the pick without leaving the modal feel. No upload happens here.

export function ExportPhotosPreview({ jobId, parcels = [] }) {
  const [savedMap, setSavedMap] = useState({});
  const [urls, setUrls] = useState({}); // composite_key -> blob/object URL (signed)

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

      // Get signed URLs for each picked photo
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
          To change a pick, scroll down to the parcel photo strip in the main view.
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {parcels.map((p) => {
          const url = urls[p.composite_key];
          return (
            <div key={p.composite_key} className="flex-shrink-0 w-32">
              <div className="w-32 h-24 bg-gray-100 rounded overflow-hidden border border-gray-200 flex items-center justify-center">
                {url ? (
                  <img src={url} alt="" className="object-cover w-full h-full" />
                ) : (
                  <span className="text-[10px] text-gray-400 px-2 text-center">No front photo</span>
                )}
              </div>
              <div className="text-[10px] mt-1">
                <span className={`font-semibold px-1 rounded ${p.roleColor}`}>{p.roleLabel}</span>
                <div className="text-gray-600 truncate" title={p.address}>{p.address}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ParcelPhotoStrip({ jobId, parcels = [] }) {
  const { connected, indexResult, source } = useJobPhotoSource();
  const [savedMap, setSavedMap] = useState({}); // composite_key -> appeal_photos row

  // Bulk-load existing front photos for these parcels
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
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          📷 Parcel Photos
          {connected && indexResult && (
            <span className="text-xs text-gray-500 font-normal">
              ({indexResult.totals.parcels.toLocaleString()} parcels indexed from {source.label})
            </span>
          )}
        </h3>
        <span className="text-[11px] text-gray-500">Click a thumbnail or use ← → · Star to pick the front photo · Drag-drop or paste to add</span>
      </div>
      {!connected && (
        <div className="mb-3 px-3 py-2 bg-amber-50 text-amber-900 rounded text-xs">
          No photo folder connected for this Town. Photos can still be added per-parcel via drag-drop or paste, but the disk index is empty.
        </div>
      )}
      {parcels.map((p) => (
        <ParcelRow
          key={p.composite_key}
          parcel={p}
          jobId={jobId}
          savedPhoto={savedMap[p.composite_key]}
          onSaved={(row) => setSavedMap((m) => ({ ...m, [row.property_composite_key]: row }))}
        />
      ))}
    </div>
  );
}
