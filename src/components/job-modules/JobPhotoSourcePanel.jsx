// src/components/job-modules/JobPhotoSourcePanel.jsx
//
// Per-Job widget that lets the user connect a local photo folder for THIS
// Town. Sits next to the version banner inside JobContainer.
//
// All state now lives in JobPhotoSourceContext so the index can be shared
// with downstream consumers (ParcelPhotoStrip in DetailedAppraisalGrid, etc.).
// This component is purely presentational + click handlers.

import React from 'react';
import { useJobPhotoSource } from '../../contexts/JobPhotoSourceContext';

export default function JobPhotoSourcePanel() {
  const {
    ccdd,
    supported,
    loaded,
    source,
    indexResult,
    busy,
    error,
    warning,
    connected,
    connect,
    disconnect,
    reindex,
  } = useJobPhotoSource();

  if (!ccdd) return null; // no CCDD → no point
  if (!loaded) return null;

  const openInNewTab = () => {
    try { window.open(window.location.href, '_blank', 'noopener'); } catch (_e) {}
  };

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
                onClick={reindex}
                disabled={busy}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                title="Re-walk the folder (use after Refresh Pictures)"
              >
                {busy ? 'Re-indexing…' : 'Re-Index'}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => connect(false)}
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
              onClick={() => connect(true)}
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
