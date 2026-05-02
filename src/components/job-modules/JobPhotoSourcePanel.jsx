// src/components/job-modules/JobPhotoSourcePanel.jsx
//
// Per-Job widget that lets the user connect a local photo folder for THIS
// Town. Sits next to the version banner inside JobContainer.
//
// - Persistent (FileSystemDirectoryHandle stored in IndexedDB keyed by jobId)
// - Validates the picked folder against the Job's CCDD before saving
// - Re-prompts for permission silently on subsequent visits
// - "Re-index" button to rebuild the parcel map after Refresh Pictures
//
// No upload happens here — index is in-memory + filenames only. Picking a
// "front photo" per appeal (which writes to Supabase) lives in the Appeal Log.

import React, { useEffect, useState, useCallback } from 'react';
import {
  canUsePersistentPicker,
  getJobSource,
  pickJobSource,
  clearJobSource,
  indexJobSource,
} from '../../lib/localPhotoSource';

export default function JobPhotoSourcePanel({ jobId, ccdd }) {
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState(null);
  const [indexResult, setIndexResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const supported = canUsePersistentPicker();

  const refresh = useCallback(async () => {
    if (!jobId) return;
    setError('');
    setWarning('');
    try {
      const rec = await getJobSource(jobId);
      setSource(rec || null);
      if (rec) {
        // Auto-index in the background once permission is granted
        const result = await indexJobSource(jobId);
        setIndexResult(result || null);
        if (result?.error) setWarning(result.error);
      } else {
        setIndexResult(null);
      }
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoaded(true);
    }
  }, [jobId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!ccdd) return null; // no CCDD → no point

  const openInNewTab = () => {
    try { window.open(window.location.href, '_blank', 'noopener'); } catch (_e) {}
  };

  const handleConnect = async (allowMismatch = false) => {
    setError('');
    setWarning('');
    if (!supported) {
      setError('IFRAME_BLOCKED');
      return;
    }
    setBusy(true);
    try {
      const res = await pickJobSource(jobId, ccdd, { allowMismatch });
      if (!res.ok) {
        if (res.reason === 'cancelled') { setBusy(false); return; }
        if (res.reason === 'unsupported') {
          setError('IFRAME_BLOCKED');
          setBusy(false);
          return;
        }
        if (res.reason === 'mismatch') {
          setWarning(`The folder you picked ("${res.folderName}") does not contain a "${res.ccdd}" subfolder, and is not named "${res.ccdd}" itself. Pick the CCDD folder for this Town, or click "Use Anyway" if you know what you're doing.`);
          setBusy(false);
          return;
        }
        setError(res.reason || 'Failed to connect folder.');
        setBusy(false);
        return;
      }
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await clearJobSource(jobId);
      setSource(null);
      setIndexResult(null);
      setWarning('');
      setError('');
    } finally {
      setBusy(false);
    }
  };

  const handleReindex = async () => {
    setBusy(true);
    setWarning('');
    try {
      const result = await indexJobSource(jobId);
      setIndexResult(result || null);
      if (result?.error) setWarning(result.error);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  // Compact UI — collapsed when connected, expanded when not
  const connected = !!source && !!indexResult && !indexResult.error;
  const parcels = indexResult?.totals?.parcels || 0;
  const files = indexResult?.totals?.files || 0;

  return (
    <div className="mb-3 border border-blue-100 bg-white rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span>📷</span>
          {connected ? (
            <span className="text-gray-800">
              Photos: <strong>{source.label}</strong>
              {' '}<span className="text-gray-500">({files.toLocaleString()} files · {parcels.toLocaleString()} parcels with photos)</span>
            </span>
          ) : (
            <span className="text-gray-700">No photo folder connected for this Town.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <button
                onClick={handleReindex}
                disabled={busy}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                title="Re-walk the folder (use after Refresh Pictures)"
              >
                {busy ? 'Re-indexing…' : 'Re-Index'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={busy}
                className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => handleConnect(false)}
              disabled={busy}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              title={`Pick a folder for CCDD ${ccdd} (e.g. C:\\Powerpad\\Pictures\\${ccdd})`}
            >
              + Connect Photo Folder for CCDD {ccdd}
            </button>
          )}
        </div>
      </div>

      {error === 'IFRAME_BLOCKED' && (
        <div className="mt-2 px-3 py-2 bg-amber-50 text-amber-900 rounded text-xs flex items-center justify-between gap-2">
          <span>
            The folder picker is blocked inside the editor preview iframe (Chromium security rule).
            Open the app in its own browser tab to connect a folder. Your choice will persist on this machine afterward.
          </span>
          <button
            onClick={openInNewTab}
            className="px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 whitespace-nowrap"
          >
            Open in New Tab ↗
          </button>
        </div>
      )}
      {error && error !== 'IFRAME_BLOCKED' && (
        <div className="mt-2 px-2 py-1 bg-red-50 text-red-800 rounded text-xs">{error}</div>
      )}
      {warning && (
        <div className="mt-2 px-2 py-1 bg-amber-50 text-amber-900 rounded text-xs flex items-center justify-between gap-2">
          <span>{warning}</span>
          {warning.startsWith('The folder you picked') && (
            <button
              onClick={() => handleConnect(true)}
              className="px-2 py-0.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Use Anyway
            </button>
          )}
        </div>
      )}
      {!supported && !connected && error !== 'IFRAME_BLOCKED' && (
        <div className="mt-2 text-xs text-gray-500">
          Tip: persistent folder access requires Chrome / Edge / Brave / Opera in a full browser tab.
        </div>
      )}
    </div>
  );
}
