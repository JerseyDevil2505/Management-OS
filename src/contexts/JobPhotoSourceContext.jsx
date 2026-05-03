// src/contexts/JobPhotoSourceContext.jsx
//
// Lifts the per-Job photo folder index out of JobPhotoSourcePanel so it can
// be shared with downstream consumers (ParcelPhotoStrip in DetailedAppraisalGrid,
// future photo-strip in AppealLog). One walk of the disk per session, one
// source of truth.
//
// Provider lives in JobContainer (it already knows jobId + ccdd). The Panel
// becomes a thin UI on top of this context. The strip just consumes it.
//
// Shape:
//   {
//     ccdd, jobId,
//     supported,          // boolean - persistent picker available
//     loaded,             // first refresh has resolved
//     source,             // saved source record or null
//     indexResult,        // { label, ccdd, totals, index: Map<parcelKey, [photos]> } | null
//     busy, error, warning,
//     refresh(), connect(allowMismatch?), disconnect(), reindex(),
//     getPhotosFor(block, lot, qualifier)  // [photo, ...] or []
//   }

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  canUsePersistentPicker,
  getJobSource,
  pickJobSource,
  clearJobSource,
  indexJobSource,
  parcelKey,
} from '../lib/localPhotoSource';

const Ctx = createContext(null);

export function JobPhotoSourceProvider({ jobId, ccdd, children }) {
  const supported = canUsePersistentPicker();

  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState(null);
  const [indexResult, setIndexResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const refresh = useCallback(async () => {
    if (!jobId) { setLoaded(true); return; }
    setError('');
    setWarning('');
    try {
      const rec = await getJobSource(jobId);
      setSource(rec || null);
      if (rec) {
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

  const connect = useCallback(async (allowMismatch = false) => {
    setError('');
    setWarning('');
    if (!supported) {
      setError('IFRAME_BLOCKED');
      return { ok: false, reason: 'IFRAME_BLOCKED' };
    }
    setBusy(true);
    try {
      const res = await pickJobSource(jobId, ccdd, { allowMismatch });
      if (!res.ok) {
        if (res.reason === 'cancelled') return res;
        if (res.reason === 'unsupported') {
          setError('IFRAME_BLOCKED');
          return res;
        }
        if (res.reason === 'mismatch') {
          setWarning(`The folder you picked ("${res.folderName}") does not contain a "${res.ccdd}" subfolder, and is not named "${res.ccdd}" itself. Pick the CCDD folder for this Town, or click "Use Anyway" if you know what you're doing.`);
          return res;
        }
        setError(res.reason || 'Failed to connect folder.');
        return res;
      }
      await refresh();
      return res;
    } catch (e) {
      setError(e?.message || String(e));
      return { ok: false, reason: e?.message };
    } finally {
      setBusy(false);
    }
  }, [jobId, ccdd, supported, refresh]);

  const disconnect = useCallback(async () => {
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
  }, [jobId]);

  const reindex = useCallback(async () => {
    setBusy(true);
    setWarning('');
    try {
      const result = await indexJobSource(jobId);
      setIndexResult(result || null);
      if (result?.error) setWarning(result.error);
    } finally {
      setBusy(false);
    }
  }, [jobId]);

  const getPhotosFor = useCallback((block, lot, qualifier) => {
    if (!indexResult?.index) return [];
    const key = parcelKey(block, lot, qualifier);
    return indexResult.index.get(key) || [];
  }, [indexResult]);

  const value = useMemo(() => ({
    jobId,
    ccdd,
    supported,
    loaded,
    source,
    indexResult,
    busy,
    error,
    warning,
    refresh,
    connect,
    disconnect,
    reindex,
    getPhotosFor,
    connected: !!source && !!indexResult && !indexResult.error,
  }), [jobId, ccdd, supported, loaded, source, indexResult, busy, error, warning, refresh, connect, disconnect, reindex, getPhotosFor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Returns the context, or a safe no-op shape when unused (no provider). */
export function useJobPhotoSource() {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    jobId: null,
    ccdd: null,
    supported: false,
    loaded: true,
    source: null,
    indexResult: null,
    busy: false,
    error: '',
    warning: '',
    connected: false,
    refresh: async () => {},
    connect: async () => ({ ok: false, reason: 'no-provider' }),
    disconnect: async () => {},
    reindex: async () => {},
    getPhotosFor: () => [],
  };
}
