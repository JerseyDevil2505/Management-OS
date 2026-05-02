// src/components/PhotoSourcesModal.jsx
//
// Admin-only test surface for the local photo sources feature.
// Lets you:
//   - Add a folder source (Powerpad\Pictures, PowerCama\pictures, ...)
//   - See your saved sources
//   - Remove a source
//   - Run a "Test Index" against an arbitrary CCDD to confirm the matcher works
//
// Wired into App.js header behind an admin-only "📷 Photos" button.

import React, { useEffect, useRef, useState } from 'react';
import {
  isSupported,
  canUsePersistentPicker,
  addSource,
  listSources,
  removeSource,
  addSessionSource,
  listSessionSources,
  removeSessionSource,
  indexAllForCcdd,
} from '../lib/localPhotoSource';

export default function PhotoSourcesModal({ open, onClose, defaultCcdd }) {
  const [sources, setSources] = useState([]);
  const [sessionSources, setSessionSources] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [ccdd, setCcdd] = useState(defaultCcdd || '');
  const [testResult, setTestResult] = useState(null);
  const fileInputRef = useRef(null);

  const supported = isSupported();
  const persistentOk = canUsePersistentPicker();

  useEffect(() => {
    if (open) {
      setError('');
      setInfo('');
      setTestResult(null);
      if (defaultCcdd) setCcdd(String(defaultCcdd));
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultCcdd]);

  const refresh = async () => {
    try {
      const list = supported ? await listSources() : [];
      setSources(list);
      setSessionSources(listSessionSources());
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const handleAdd = async () => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      const rec = await addSource();
      setInfo(`Connected "${rec.label}".`);
      await refresh();
    } catch (e) {
      // User cancelling the picker throws AbortError — quiet that one
      if (e?.name !== 'AbortError') setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSessionPick = () => {
    setError('');
    setInfo('');
    fileInputRef.current?.click();
  };

  const handleSessionFiles = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    // Derive a friendly label from the first file's relative path
    const firstRel = files[0].webkitRelativePath || files[0].name;
    const folderLabel = firstRel.split('/')[0] || `Session folder`;
    const rec = addSessionSource(`${folderLabel} (session)`, files);
    if (rec) setInfo(`Loaded ${rec.files.length} files from "${rec.label}". Session-only — they will not persist after a reload.`);
    refresh();
    // Allow re-picking the same folder later
    e.target.value = '';
  };

  const handleRemove = async (id) => {
    setError('');
    setBusy(true);
    try {
      if (id.startsWith('sess_')) {
        removeSessionSource(id);
      } else {
        await removeSource(id);
      }
      await refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setInfo('');
    setTestResult(null);
    if (!ccdd || !/^\d{4}$/.test(ccdd.trim())) {
      setError('Enter a 4-digit CCDD (e.g. 1705 for Lower Alloways Creek).');
      return;
    }
    setBusy(true);
    try {
      const result = await indexAllForCcdd(ccdd.trim());
      setTestResult(result);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', borderRadius: '12px', width: '90%', maxWidth: '720px',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>📷 Photo Sources <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>(beta)</span></h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6b7280' }} title="Close">×</button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto' }}>
          {!supported && (
            <div style={{ padding: '12px', background: '#fef3c7', color: '#92400e', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem' }}>
              Your browser does not support the persistent folder picker. Use Chrome, Edge, Brave, or Opera for the full experience — or use the "Pick Folder (session only)" fallback below.
            </div>
          )}
          {supported && !persistentOk && (
            <div style={{ padding: '12px', background: '#fef3c7', color: '#92400e', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem' }}>
              The persistent folder picker is blocked because the app is running inside a preview iframe. Open the app in a full browser tab for persistent access — or use the session-only picker below to test the indexer right now.
            </div>
          )}

          <p style={{ marginTop: 0, color: '#4b5563', fontSize: '0.9rem' }}>
            Connect the folders that hold your Town photos — typically <code>C:\Powerpad\Pictures</code> and <code>C:\PowerCama\pictures</code>. The Copilot only reads inside the folders you pick; nothing else on your machine is accessible.
          </p>

          {/* Add source */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button
              onClick={handleAdd}
              disabled={!persistentOk || busy}
              style={{ padding: '8px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: persistentOk && !busy ? 'pointer' : 'not-allowed', fontWeight: 500, opacity: persistentOk && !busy ? 1 : 0.5 }}
              title={persistentOk ? 'Persistent — saved across reloads' : 'Open the app in a full browser tab to use the persistent picker'}
            >
              + Add Photo Source (persistent)
            </button>
            <button
              onClick={handleSessionPick}
              disabled={busy}
              style={{ padding: '8px 14px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: busy ? 0.5 : 1 }}
              title="Works in iframes / Safari / Firefox — session only, not saved across reloads"
            >
              + Pick Folder (session only)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleSessionFiles}
              style={{ display: 'none' }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', marginBottom: '12px', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ padding: '10px 12px', background: '#ecfdf5', color: '#065f46', borderRadius: '6px', marginBottom: '12px', fontSize: '0.85rem' }}>
              {info}
            </div>
          )}

          {/* Source list */}
          <h3 style={{ fontSize: '0.95rem', margin: '12px 0 8px', color: '#111827' }}>Connected sources</h3>
          {sources.length === 0 && sessionSources.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.9rem', fontStyle: 'italic' }}>None yet.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[...sources, ...sessionSources].map((s) => (
                <li key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '6px' }}>
                  <div>
                    <div style={{ fontWeight: 500, color: '#1f2937' }}>
                      {s.label}{' '}
                      {s.session && <span style={{ fontSize: '0.7rem', color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' }}>session</span>}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      {s.session ? `${s.files} files` : `added ${new Date(s.createdAt).toLocaleString()}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(s.id)}
                    style={{ padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Test indexer */}
          <h3 style={{ fontSize: '0.95rem', margin: '20px 0 8px', color: '#111827' }}>Test the indexer</h3>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 0 }}>
            Enter a CCDD (4-digit county+district code, e.g. <code>1705</code> for Lower Alloways Creek). We will look for a subfolder of that name inside each connected source and tell you what we matched.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <input
              type="text"
              value={ccdd}
              onChange={(e) => setCcdd(e.target.value)}
              placeholder="e.g. 1705"
              maxLength={4}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', width: '120px', fontSize: '0.9rem' }}
            />
            <button
              onClick={handleTest}
              disabled={busy || (sources.length === 0 && sessionSources.length === 0)}
              style={{ padding: '6px 14px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', cursor: busy || (sources.length === 0 && sessionSources.length === 0) ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: busy || (sources.length === 0 && sessionSources.length === 0) ? 0.5 : 1 }}
            >
              {busy ? 'Indexing…' : 'Run Test Index'}
            </button>
          </div>

          {testResult && (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '12px', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 600, color: '#111827', marginBottom: '6px' }}>Results for CCDD {ccdd}</div>
              <ul style={{ paddingLeft: '18px', margin: '0 0 10px' }}>
                {testResult.bySource.map((r) => (
                  <li key={r.sourceId} style={{ marginBottom: '2px', color: r.error ? '#991b1b' : '#1f2937' }}>
                    <strong>{r.sourceLabel}</strong>: {r.error ? `error — ${r.error}` : `${r.found} files matched`}
                  </li>
                ))}
              </ul>
              <div style={{ color: '#374151' }}>
                Totals — files seen: {testResult.totals.files} · parcels matched: {testResult.totals.parcels} · unmatched filenames: {testResult.totals.unmatched}
              </div>
              {testResult.totals.parcels > 0 && (
                <details style={{ marginTop: '10px' }}>
                  <summary style={{ cursor: 'pointer', color: '#2563eb' }}>Sample (first 10 parcels)</summary>
                  <ul style={{ paddingLeft: '18px', marginTop: '6px', maxHeight: '200px', overflow: 'auto' }}>
                    {Array.from(testResult.index.entries()).slice(0, 10).map(([key, arr]) => (
                      <li key={key} style={{ color: '#1f2937' }}>
                        <code>{key}</code> — {arr.length} photo{arr.length === 1 ? '' : 's'} ({arr.map(a => `#${a.photoNum}`).join(', ')})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
