import { createClient } from '@supabase/supabase-js';

/**
 * SELECTIVE CACHING LAYER
 * ======================
 * Cache only truly static data that rarely changes.
 * Everything else uses live data pattern.
 */

// Cache configuration
const CACHE_CONFIG = {
  CODE_DEFINITIONS: 30 * 60 * 1000,  // 30 minutes - code files rarely change
  EMPLOYEE_LIST: 10 * 60 * 1000,     // 10 minutes - employee data is relatively static
  COUNTY_HPI: 60 * 60 * 1000,        // 60 minutes - historical HPI data never changes
  MANAGERS: 10 * 60 * 1000,          // 10 minutes - manager list is stable
};

// Simple cache implementation
class DataCache {
  constructor() {
    this.cache = new Map();
  }

  set(key, data, ttl = 5 * 60 * 1000) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > cached.ttl) {
      // Cache expired, remove it
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  clear(key) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  has(key) {
    const cached = this.cache.get(key);
    if (!cached) return false;

    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

// Export cache instance
export const dataCache = new DataCache();

/**
 * Helper function to safely extract error message from any error type
 */
function getErrorMessage(error) {
  if (!error) return 'Unknown error';

  // If it's a string, return it directly
  if (typeof error === 'string') return error;

  // Try various error message properties
  if (error.message) return error.message;
  if (error.msg) return error.msg;
  if (error.error) return error.error;
  if (error.details) return error.details;

  // If it's an object with specific error info
  if (error.code && error.hint) {
    return `${error.code}: ${error.hint}`;
  }

  // Try to stringify if it's an object
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch (e) {
      return 'Error object could not be serialized';
    }
  }

  // Fallback to string conversion
  return String(error);
}

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.warn('⚠️ REACT_APP_SUPABASE_URL not found in environment variables');
}

if (!supabaseKey) {
  console.warn('⚠️ REACT_APP_SUPABASE_ANON_KEY not found in environment variables');
}

// Enhanced Supabase client with custom fetch options for better timeout handling
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public'
  },
  realtime: {
    params: {
      eventsPerSecond: 2
    }
  },
  global: {
    headers: {
      'x-client-info': 'property-app'
    }
  }
});

// ===== SOURCE FILE DATA ACCESS HELPERS =====
// These replace raw_data access with source file content parsing

/**
 * Cache for parsed source file data to avoid repeated parsing
 */
/**
 * Get parsed raw data for a job (with caching)
 */
export async function getRawDataForJob(jobId) {
  // Check cache first - trust it since it's cleared on file updates
  const cacheKey = `job_raw_data_${jobId}`;
  const cached = dataCache.get(cacheKey);
  if (cached) {
    // Silent return - no console spam
    return cached;
  }

  try {
    const { data: job, error } = await supabase
      .from('jobs')
      .select('raw_file_content, parsed_code_definitions, vendor_type, ccdd_code, start_date')
      .eq('id', jobId)
      .single();

    if (error || !job?.raw_file_content) {
      return null;
    }

    // Determine vendor type and year
    const vendorType = job.vendor_type || detectVendorTypeFromContent(job.raw_file_content);
    const yearCreated = new Date(job.start_date).getFullYear();
    const ccddCode = job.ccdd_code;

    // Parse the source file
    const parsedData = parseSourceFileContent(job.raw_file_content, vendorType) || [];

    // Create property lookup map by composite key
    const propertyMap = new Map();
    if (Array.isArray(parsedData)) {
      parsedData.forEach(record => {
        if (record) {
          const compositeKey = generateCompositeKeyFromRecord(record, vendorType, yearCreated, ccddCode);
          if (compositeKey) {
            propertyMap.set(compositeKey, record);
          }
        }
      });
    }

    const result = {
      vendorType: vendorType || 'Unknown',
      yearCreated: yearCreated || new Date().getFullYear(),
      ccddCode: ccddCode || '',
      propertyMap: propertyMap || new Map(),
      codeDefinitions: job.parsed_code_definitions,
      parsed_code_definitions: job.parsed_code_definitions
    };

    // Cache - it will be cleared when files are updated via updateCSVData
    dataCache.set(cacheKey, result, CACHE_CONFIG.CODE_DEFINITIONS);

    return result;

  } catch (error) {
    console.error('Error getting source file data for job:', getErrorMessage(error));
    return null;
  }
}

// Helper: persist unit rate run summary to jobs table if column exists; otherwise fallback to market_land_valuation
async function persistUnitRateRunSummary(jobId, jobPayload) {
  try {
    const { error } = await supabase.from('jobs').update(jobPayload).eq('id', jobId);
    if (!error) return { updated: true, target: 'jobs' };

    const isMissingColumn = error && (error.code === 'PGRST204' || (error.message && error.message.includes("Could not find the 'unit_rate_last_run'")));
    if (!isMissingColumn) return { updated: false, error };

    try {
      const { data: existing, error: selErr } = await supabase.from('market_land_valuation').select('*').eq('job_id', jobId).single();
      if (selErr && selErr.code === 'PGRST116') {
        // Create new record preserving any data that might exist
        const { error: insErr } = await supabase.from('market_land_valuation').insert({
          job_id: jobId,
          unit_rate_last_run: jobPayload.unit_rate_last_run,
          unit_rate_codes_applied: jobPayload.unit_rate_codes_applied || null
        });
        if (insErr) return { updated: false, error: insErr };
        return { updated: true, target: 'market_land_valuation', action: 'insert' };
      }

      const updateObj = { unit_rate_last_run: jobPayload.unit_rate_last_run };
      if (jobPayload.unit_rate_codes_applied) updateObj.unit_rate_codes_applied = jobPayload.unit_rate_codes_applied;
      const { error: updErr } = await supabase.from('market_land_valuation').update(updateObj).eq('job_id', jobId);
      if (updErr) return { updated: false, error: updErr };
      return { updated: true, target: 'market_land_valuation', action: 'update' };
    } catch (e2) {
      return { updated: false, error: e2 };
    }
  } catch (e) {
    return { updated: false, error: e };
  }
}

/**
 * Get raw data for a specific property
 */
async function getRawDataForProperty(jobId, propertyCompositeKey) {
  const rawData = await getRawDataForJob(jobId);
  if (!rawData) return null;

  return rawData.propertyMap.get(propertyCompositeKey) || null;
}

/**
 * Normalize selected codes into canonical VCSKEY::CODE format where possible.
 * Accepts inputs like 'CHSP·02', 'CHSP:02', '23::02', '02' and returns normalized array.
 */
export async function normalizeSelectedCodes(jobId, selectedCodes = []) {
  const rawDataForJob = await getRawDataForJob(jobId);
  const codeDefinitions = rawDataForJob?.codeDefinitions || rawDataForJob?.parsed_code_definitions || null;
  const vcsSection = codeDefinitions && codeDefinitions.sections && codeDefinitions.sections.VCS ? codeDefinitions.sections.VCS : null;
  const vcsIdMap = new Map();
  const vcsLabelToKey = new Map();

  if (vcsSection) {
    Object.keys(vcsSection).forEach(vkey => {
      const entry = vcsSection[vkey];
      const ids = new Set();
      ids.add(String(vkey));
      if (entry?.DATA?.VALUE) ids.add(String(entry.DATA.VALUE));
      if (entry?.DATA?.KEY) ids.add(String(entry.DATA.KEY));
      if (entry?.KEY) ids.add(String(entry.KEY));
      vcsIdMap.set(String(vkey), ids);

      // Map label variants to key (uppercased)
      const short = (entry?.DATA?.KEY && String(entry.DATA.KEY).trim()) || (entry?.KEY && String(entry.KEY).trim()) || (entry?.DATA?.VALUE && String(entry.DATA.VALUE).trim()) || String(vkey);
      if (short) vcsLabelToKey.set(String(short).trim().toUpperCase(), String(vkey));
      if (entry?.DATA?.VALUE) vcsLabelToKey.set(String(entry.DATA.VALUE).trim().toUpperCase(), String(vkey));
      if (entry?.DATA?.KEY) vcsLabelToKey.set(String(entry.DATA.KEY).trim().toUpperCase(), String(vkey));
    });
  }

  const normalized = [];
  for (const raw of (Array.isArray(selectedCodes) ? selectedCodes : [])) {
    try {
      if (!raw && raw !== 0) continue;
      const s = String(raw).trim();
      if (!s) continue;

      // Normalize separators to support '::', '·', '.', ':'
      let sep = null;
      if (s.includes('::')) sep = '::';
      else if (s.includes('·')) sep = '·';
      else if (s.includes(':')) sep = ':';
      else if (s.includes('.')) sep = '.';

      if (sep) {
        const parts = s.split(sep).map(p => p.trim()).filter(Boolean);
        const vcsPart = (parts[0] || '').toUpperCase();
        const codePart = (parts[1] || '').replace(/[^0-9]/g, '').padStart(2, '0');
        if (!codePart) continue;

        // Try to map vcsPart to numeric key
        let vkey = null;
        if (vcsIdMap.has(vcsPart)) vkey = vcsPart;
        if (!vkey && vcsLabelToKey.has(vcsPart)) vkey = vcsLabelToKey.get(vcsPart);
        if (!vkey) {
          // Try to find by idSet membership
          for (const [k, idSet] of vcsIdMap.entries()) {
            if (Array.from(idSet).some(id => String(id).trim().toUpperCase() === vcsPart)) {
              vkey = k; break;
            }
          }
        }

        if (vkey) normalized.push(`${vkey}::${codePart}`);
        else normalized.push(`${vcsPart}::${codePart}`);
      } else {
        // Code-only
        const codeOnly = s.replace(/[^0-9]/g, '').padStart(2, '0');
        if (codeOnly) normalized.push(codeOnly);
      }
    } catch (e) {
      // Skip malformed entries
      continue;
    }
  }

  return normalized;
}

/**
 * Diagnostic helper: compute lot acreage for a single property using header-mapped LANDUR/LANDURUNITS
 * Returns detailed debug object (codes, units, included flag, totals)
 */
export async function computeLotAcreForProperty(jobId, propertyCompositeKey, selectedCodes = [], options = {}) {
  if (!jobId || !propertyCompositeKey) throw new Error('jobId and propertyCompositeKey required');

  // Load property record from property_records table (authoritative source)
  const { data: propRow, error: propErr } = await supabase
    .from('property_records')
    .select('*')
    .eq('job_id', jobId)
    .eq('property_composite_key', propertyCompositeKey)
    .single();

  if (propErr || !propRow) return { property_composite_key: propertyCompositeKey, error: 'No property record found for this property' };

  const rawRecord = propRow;

  // Build VCS id map for namespaced selections if needed (use parsed code definitions when available)
  let codeDefinitions = null;
  let rawDataForJob = null;
  try {
    rawDataForJob = await getRawDataForJob(jobId);
    codeDefinitions = rawDataForJob?.codeDefinitions || rawDataForJob?.parsed_code_definitions || null;
  } catch (e) {
    codeDefinitions = null;
    rawDataForJob = null;
  }

  const vcsIdMap = new Map();
  if (codeDefinitions && codeDefinitions.sections && codeDefinitions.sections.VCS) {
    Object.keys(codeDefinitions.sections.VCS).forEach(vkey => {
      const entry = codeDefinitions.sections.VCS[vkey];
      const ids = new Set();
      ids.add(String(vkey));
      if (entry?.DATA?.VALUE) ids.add(String(entry.DATA.VALUE));
      if (entry?.DATA?.KEY) ids.add(String(entry.DATA.KEY));
      if (entry?.KEY) ids.add(String(entry.KEY));
      vcsIdMap.set(String(vkey), ids);
    });
  }

  // Determine property's VCS value from common columns
  const propVcsRaw = rawRecord.property_vcs || rawRecord.propertyVcs || rawRecord.VCS || rawRecord.vcs || rawRecord.VCS_CODE || null;
  const propVcs = propVcsRaw ? String(propVcsRaw).trim() : null;

  const details = [];
  let totalAcres = 0;
  let totalSf = 0;

  // Helper to read land code/unit fields with fallbacks for naming differences
  const readField = (obj, base, i) => {
    const candidates = [
      `${base}_${i}`,
      `${base}${i}`,
      `${base} ${i}`,
      `${base.toLowerCase()}_${i}`,
      `${base.toLowerCase()}${i}`,
      `${base.toLowerCase()} ${i}`
    ];
    for (const k of candidates) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
    }
    return undefined;
  };

  for (let i = 1; i <= 6; i++) {
    const codeRaw = readField(rawRecord, 'LANDUR', i);
    const unitsRaw = readField(rawRecord, 'LANDURUNITS', i);
    const codeStr = codeRaw !== undefined && codeRaw !== null ? String(codeRaw).replace(/[^0-9]/g, '').padStart(2, '0') : '';
    const unitsNum = unitsRaw !== undefined && unitsRaw !== null ? parseFloat(String(unitsRaw).replace(/[,$\s\"]/g, '')) : NaN;

    const detail = { index: i, code_raw: codeRaw, code: codeStr, units_raw: unitsRaw, units: isNaN(unitsNum) ? null : unitsNum, included: false };

    if (isNaN(unitsNum) || unitsNum <= 0) { details.push(detail); continue; }
    if (codeStr === '01') { details.push(detail); continue; }

    const treatEmptyAsExplicit = !!options.useJobConfig;
    const shouldApplySelection = (selCodes) => treatEmptyAsExplicit ? true : (Array.isArray(selCodes) && selCodes.length > 0);

    detail.comparison_logs = [];
    let include = true;
    if (shouldApplySelection(selectedCodes)) {
      include = false;
      for (let si = 0; si < selectedCodes.length; si++) {
        const scRaw = selectedCodes[si];
        const scOrig = scRaw;
        const sc = String(scRaw).trim();
        const logEntry = { selected_raw: scOrig, selected_norm: sc, code_raw: codeRaw, code_norm: codeStr, propVcs_raw: propVcsRaw, propVcs_norm: propVcs, matched: false, reason: null };

        if (sc.includes('::') || sc.includes('·') || sc.includes('.') || sc.includes(':')) {
          const sep = sc.includes('::') ? '::' : (sc.includes('·') ? '·' : (sc.includes(':') ? ':' : '.'));
          const parts = sc.split(sep).map(s => s.trim()).filter(Boolean);
          const vcsKeySel = parts[0] || '';
          const codeSel = parts[1] || '';

          logEntry.vcsKeySel = vcsKeySel;
          logEntry.codeSel = codeSel;

          if (!codeSel) { logEntry.reason = 'no_code_in_selection'; detail.comparison_logs.push(logEntry); continue; }
          const codeMatches = (codeSel === codeStr) || (codeSel.padStart(2, '0') === codeStr.padStart(2, '0'));
          if (!codeMatches) { logEntry.reason = 'code_mismatch'; detail.comparison_logs.push(logEntry); continue; }

          const idSet = vcsIdMap.get(String(vcsKeySel));
          if (idSet && propVcs) {
            const matchedVcs = Array.from(idSet).some(id => String(id).trim() === String(propVcs).trim());
            if (matchedVcs) { logEntry.matched = true; logEntry.reason = 'code_and_vcs_match'; include = true; detail.comparison_logs.push(logEntry); break; }
            else { logEntry.reason = 'vcs_idset_mismatch'; detail.comparison_logs.push(logEntry); continue; }
          } else {
            if (propVcs && (String(propVcs).trim() === String(vcsKeySel).trim() || String(propVcs).trim().padStart(2,'0') === String(vcsKeySel).trim().padStart(2,'0'))) { logEntry.matched = true; logEntry.reason = 'vcs_direct_match'; include = true; detail.comparison_logs.push(logEntry); break; }
            else { logEntry.reason = 'vcs_direct_mismatch'; detail.comparison_logs.push(logEntry); continue; }
          }
        } else {
          const codeSel = sc;
          logEntry.codeSel = codeSel;
          const codeMatches = (codeSel === codeStr) || (codeSel.padStart(2, '0') === codeStr.padStart(2, '0'));
          if (codeMatches) { logEntry.matched = true; logEntry.reason = 'code_only_match'; include = true; detail.comparison_logs.push(logEntry); break; }
          else { logEntry.reason = 'code_only_mismatch'; detail.comparison_logs.push(logEntry); continue; }
        }
      }
    }

    if (include) { detail.included = true; if (unitsNum >= 1000) totalSf += unitsNum; else totalAcres += unitsNum; }
    details.push(detail);
  }

  const finalAcres = totalAcres + (totalSf / 43560);

  // If we couldn't derive acres from LANDUR fields, fall back to other property fields (asset_lot_acre or asset_lot_sf)
  let resultAcres = (isFinite(finalAcres) && finalAcres > 0) ? parseFloat(finalAcres.toFixed(2)) : null;
  if (!resultAcres) {
    try {
      const vendorType = (rawDataForJob && rawDataForJob.vendorType) || 'BRT';
      const fallback = await interpretCodes.getTotalLotSize(rawRecord, vendorType, codeDefinitions);
      if (fallback && !isNaN(Number(fallback)) && Number(fallback) > 0) {
        resultAcres = parseFloat(Number(fallback).toFixed(2));
      }
    } catch (e) {
      // ignore fallback errors
    }
  }

  return {
    property_composite_key: propertyCompositeKey,
    job_id: jobId,
    selected_codes: selectedCodes,
    propVcs: propVcs,
    details,
    total_acres: resultAcres,
    total_sf: resultAcres !== null ? Math.round(resultAcres * 43560) : null
  };
}

/**
 * Persist computed lot acreage for a single property and update job-level applied codes map
 */
export async function persistComputedLotAcre(jobId, propertyCompositeKey, selectedCodes = []) {
  if (!jobId || !propertyCompositeKey) throw new Error('jobId and propertyCompositeKey required');
  try {
    // If no selectedCodes provided, try to fetch saved job config and use it (including empty explicit selection)
    let sel = Array.isArray(selectedCodes) ? selectedCodes : [];
    let useJobConfig = false;
    if ((!sel || sel.length === 0)) {
      try {
        const { data: jobRow, error: jobErr } = await supabase.from('jobs').select('unit_rate_config').eq('id', jobId).single();
        if (!jobErr && jobRow) {
          const saved = jobRow.unit_rate_config?.codes || jobRow.unit_rate_config || [];
          sel = Array.isArray(saved) ? saved : [];
          useJobConfig = true;
        }
      } catch (e) {
        // ignore and proceed with empty selection
      }
    }

    // Normalize selection before computing
    let normalizedSel = [];
    try {
      normalizedSel = await normalizeSelectedCodes(jobId, sel);
    } catch (e) {
      normalizedSel = Array.isArray(sel) ? sel : [];
    }

    const result = await computeLotAcreForProperty(jobId, propertyCompositeKey, normalizedSel, { useJobConfig });
    const acres = result?.total_acres ?? null;

    // Upsert into property_market_analysis (include SF as well)
    const upsertRow = {
      job_id: jobId,
      property_composite_key: propertyCompositeKey,
      market_manual_lot_acre: acres !== null ? parseFloat(Number(acres).toFixed(2)) : null,
      market_manual_lot_sf: (acres !== null && !isNaN(acres)) ? Math.round(Number(acres) * 43560) : null,
      updated_at: new Date().toISOString()
    };

    const { error: upsertError } = await supabase.from('property_market_analysis').upsert([upsertRow], { onConflict: ['job_id','property_composite_key'] });
    if (upsertError) {
      console.error('Error upserting computed lot acre:', upsertError);
      throw upsertError;
    }

    // Persist property-level applied codes into the jobs row (do not use market_land_valuation)
    try {
      const { data: jobRow, error: jobErr } = await supabase.from('jobs').select('unit_rate_codes_applied').eq('id', jobId).single();
      let applied = {};
      if (!jobErr && jobRow && jobRow.unit_rate_codes_applied) {
        try {
          applied = typeof jobRow.unit_rate_codes_applied === 'string' ? JSON.parse(jobRow.unit_rate_codes_applied) : jobRow.unit_rate_codes_applied || {};
        } catch (e) { applied = {}; }
      }
      applied[propertyCompositeKey] = normalizedSel || [];

      const jobPayload = {
        unit_rate_codes_applied: applied,
        unit_rate_last_run: {
          timestamp: new Date().toISOString(),
          selected_codes: selectedCodes || [],
          updated_count: 1
        },
        updated_at: new Date().toISOString()
      };

      const persistResult = await persistUnitRateRunSummary(jobId, jobPayload);
      if (!persistResult.updated) console.warn('Failed to persist unit-rate run summary (compute property path):', persistResult.error);
    } catch (e) {
      console.warn('Error updating jobs row with unit rate run info:', e);
    }

    return { property_composite_key: propertyCompositeKey, job_id: jobId, market_manual_lot_acre: acres };

  } catch (error) {
    console.error('persistComputedLotAcre error:', error);
    throw error;
  }
}

/**
 * Clear legacy asset_lot_acre/asset_lot_sf values in property_records for a job
 * when a market_manual_lot_acre exists and the property has no explicit frontage/depth.
 * This helps remove earlier LANDUR-derived values that are no longer authoritative.
 */
export async function clearLegacyAssetLotFields(jobId) {
  if (!jobId) throw new Error('jobId required');
  try {
    // 1) Load market manual acre map
    const { data: mmaData, error: mmaErr } = await supabase
      .from('property_market_analysis')
      .select('property_composite_key, market_manual_lot_acre, market_manual_lot_sf')
      .eq('job_id', jobId);
    if (mmaErr) throw mmaErr;
    const manualMap = new Map();
    (mmaData || []).forEach(r => manualMap.set(r.property_composite_key, { acre: r.market_manual_lot_acre, sf: r.market_manual_lot_sf }));

    // 2) Find property_records with non-null asset_lot_acre
    const { data: props, error: propsErr } = await supabase
      .from('property_records')
      .select('property_composite_key, asset_lot_acre, asset_lot_sf, asset_lot_frontage, asset_lot_depth')
      .eq('job_id', jobId)
      .not('asset_lot_acre', 'is', null);
    if (propsErr) throw propsErr;

    const toClear = [];
    for (const p of (props || [])) {
      const manual = manualMap.get(p.property_composite_key);
      const hasFrontageOrDepth = (p.asset_lot_frontage && Number(p.asset_lot_frontage) > 0) || (p.asset_lot_depth && Number(p.asset_lot_depth) > 0);
      // Clear only if manual exists (we computed market_manual) AND no explicit frontage/depth
      if (manual && (manual.acre !== null && manual.acre !== undefined) && !hasFrontageOrDepth) {
        toClear.push(p.property_composite_key);
      }
    }

    if (toClear.length === 0) {
      console.log('clearLegacyAssetLotFields: no records to clear');
      return { cleared: 0 };
    }

    // 3) Update in batches
    const batchSize = 500;
    let cleared = 0;
    for (let i = 0; i < toClear.length; i += batchSize) {
      const batch = toClear.slice(i, i + batchSize);
      const { error: upErr } = await supabase
        .from('property_records')
        .update({ asset_lot_acre: null, asset_lot_sf: null, updated_at: new Date().toISOString() })
        .in('property_composite_key', batch)
        .eq('job_id', jobId);
      if (upErr) {
        console.error('Error clearing legacy asset lot fields for batch:', upErr);
      } else {
        cleared += batch.length;
      }
    }

    console.log(`clearLegacyAssetLotFields: cleared ${cleared} records`);
    return { cleared };

  } catch (error) {
    console.error('clearLegacyAssetLotFields error:', error);
    throw error;
  }
}

// Expose quick debug helper on window in dev mode
if (typeof window !== 'undefined') {
  window.__computeLotAcreForProperty = async (jobId, propertyCompositeKey, selectedCodes = []) => {
    try {
      // If no selectedCodes passed, attempt to use saved job config (including empty explicit selection)
      let sel = Array.isArray(selectedCodes) ? selectedCodes : [];
      let useJobConfig = false;
      if ((!sel || sel.length === 0) && jobId) {
        try {
          const { data: jobRow } = await supabase.from('jobs').select('unit_rate_config').eq('id', jobId).single();
          if (jobRow) {
            const saved = jobRow.unit_rate_config?.codes || jobRow.unit_rate_config || [];
            sel = Array.isArray(saved) ? saved : [];
            useJobConfig = true;
          }
        } catch (e) {
          // ignore
        }
      }

      const res = await computeLotAcreForProperty(jobId, propertyCompositeKey, sel, { useJobConfig });
      console.log('computeLotAcreForProperty result:', res);
      return res;
    } catch (e) {
      console.error('Error in __computeLotAcreForProperty:', e);
      throw e;
    }
  };
}

if (typeof window !== 'undefined') {
  // Expose convenience debug function to clear legacy asset lot fields
  window.clearLegacyAssetLotFields = clearLegacyAssetLotFields;
}

/**
 * Detect vendor type from source file content
 */
function detectVendorTypeFromContent(fileContent) {
  const firstLine = fileContent.split('\n')[0];

  if (firstLine.includes('BLOCK') && firstLine.includes('LOT') && firstLine.includes('QUALIFIER')) {
    return 'BRT';
  } else if (firstLine.includes('Block') && firstLine.includes('Lot') && firstLine.includes('Qual')) {
    return 'Microsystems';
  }

  return 'Unknown';
}

/**
 * Parse source file content based on vendor type
 */
function parseSourceFileContent(fileContent, vendorType) {
  const lines = fileContent.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  let headers, separator;

  if (vendorType === 'BRT') {
    // Auto-detect BRT separator
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;

    separator = (tabCount > 10 && tabCount > commaCount * 2) ? '\t' : ',';
    headers = separator === ',' ? parseCSVLine(firstLine) : firstLine.split('\t').map(h => h.trim());
  } else if (vendorType === 'Microsystems') {
    separator = '|';
    const originalHeaders = lines[0].split('|');
    headers = renameDuplicateHeaders(originalHeaders);
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    let values;

    if (vendorType === 'BRT') {
      values = separator === ',' ? parseCSVLine(lines[i]) : lines[i].split('\t').map(v => v.trim());
    } else if (vendorType === 'Microsystems') {
      values = lines[i].split('|');
    }

    if (values.length !== headers.length) continue;

    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] || null;
    });

    records.push(record);
  }

  return records;
}

/**
 * Generate composite key from source record
 */
function generateCompositeKeyFromRecord(record, vendorType, yearCreated, ccddCode) {
  if (vendorType === 'BRT') {
    const blockValue = String(record.BLOCK || '').trim();
    const lotValue = String(record.LOT || '').trim();
    const qualifierValue = String(record.QUALIFIER || '').trim() || 'NONE';
    const cardValue = String(record.CARD || '').trim() || 'NONE';
    const locationValue = String(record.PROPERTY_LOCATION || '').trim() || 'NONE';

    return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualifierValue}-${cardValue}-${locationValue}`;
  } else if (vendorType === 'Microsystems') {
    const blockValue = String(record['Block'] || '').trim();
    const lotValue = String(record['Lot'] || '').trim();
    const qualValue = String(record['Qual'] || '').trim() || 'NONE';
    const bldgValue = String(record['Bldg'] || '').trim() || 'NONE';
    const locationValue = String(record['Location'] || '').trim() || 'NONE';

    return `${yearCreated}${ccddCode}-${blockValue}-${lotValue}_${qualValue}-${bldgValue}-${locationValue}`;
  }

  return null;
}

/**
 * Parse CSV line with proper quote handling
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      i++;
      continue;
    } else {
      current += char;
    }

    i++;
  }

  result.push(current.trim());
  return result;
}

/**
 * Rename duplicate headers for Microsystems
 */
function renameDuplicateHeaders(originalHeaders) {
  const headerCounts = {};
  return originalHeaders.map(header => {
    if (headerCounts[header]) {
      headerCounts[header]++;
      return `${header}${headerCounts[header]}`;
    } else {
      headerCounts[header] = 1;
      return header;
    }
  });
}

// Define fields that must be preserved during file updates
// ULTRA-OPTIMIZED: Only critical per-property fields
const PRESERVED_FIELDS = [
  'is_assigned_property',    // AdminJobManagement - from assignments
]

// MOVED TO jobs table (job-level metrics, not per-property):
// - project_start_date (inspection start date)
// - validation_status (imported vs updated)

// MOVED TO property_market_analysis table (market analysis fields):
// - location_analysis, new_vcs, asset_map_page, asset_key_page,
// - asset_zoning, values_norm_size, values_norm_time, sales_history

// ===== CODE INTERPRETATION UTILITIES =====
/**
 * Get depth factor from depth tables
 * @param {number} depth - Lot depth in feet
 * @param {string} depthTableName - Name of the depth table to use
 * @param {object} depthTables - Object containing all depth table definitions
 * @returns {number} - Depth factor (typically 0.5 to 1.5)
 */
export function getDepthFactor(depth, depthTableName, depthTables) {
  if (!depth || !depthTableName || !depthTables) return 1.0;

  const table = depthTables[depthTableName];
  if (!table || !Array.isArray(table)) return 1.0;

  // Find the appropriate depth range
  for (const entry of table) {
    if (depth >= entry.min_depth && depth <= entry.max_depth) {
      return entry.factor || 1.0;
    }
  }

  // If depth exceeds all ranges, use the last entry's factor
  if (table.length > 0) {
    const lastEntry = table[table.length - 1];
    if (depth > lastEntry.max_depth) {
      return lastEntry.factor || 1.0;
    }
  }

  return 1.0; // Default if no match found
}

/**
 * Get all depth tables from code definitions
 * @param {object} codeDefinitions - Parsed code definitions
 * @param {string} vendorType - Vendor type (BRT, Microsystems, etc)
 * @returns {object} - Object containing depth table definitions
 */
export function getDepthFactors(codeDefinitions, vendorType = 'BRT') {
  if (!codeDefinitions || !codeDefinitions.depth_tables) {
    // Return default depth tables if none defined
    return {
      'STANDARD': [
        { min_depth: 0, max_depth: 100, factor: 1.0 },
        { min_depth: 101, max_depth: 150, factor: 1.05 },
        { min_depth: 151, max_depth: 200, factor: 1.10 },
        { min_depth: 201, max_depth: 999, factor: 1.15 }
      ],
      '100FT': [
        { min_depth: 0, max_depth: 100, factor: 1.0 }
      ]
    };
  }

  return codeDefinitions.depth_tables;
}

// Utilities for interpreting vendor-specific codes in MarketLandAnalysis
export const interpretCodes = {
  // Utility function to diagnose and repair Microsystems code definitions
  diagnoseMicrosystemsDefinitions: async function(jobId) {
    try {
      console.log('🔍 Diagnosing Microsystems code definitions for job:', jobId);

      const { data: job, error } = await supabase
        .from('jobs')
        .select('parsed_code_definitions, code_file_content, vendor_type')
        .eq('id', jobId)
        .single();

      if (error || !job) {
        console.error('❌ Could not fetch job data:', error);
        return { status: 'error', message: 'Could not fetch job data' };
      }

      if (job.vendor_type !== 'Microsystems') {
        return { status: 'error', message: 'Job is not Microsystems vendor type' };
      }

      const definitions = job.parsed_code_definitions;
      console.log('📊 Current parsed_code_definitions structure:', {
        hasDefinitions: !!definitions,
        vendorType: definitions?.vendor_type,
        hasFieldCodes: !!definitions?.field_codes,
        hasFlatLookup: !!definitions?.flat_lookup,
        fieldCodesCount: definitions?.field_codes ? Object.keys(definitions.field_codes).length : 0,
        flatLookupCount: definitions?.flat_lookup ? Object.keys(definitions.flat_lookup).length : 0,
        rootKeysCount: definitions ? Object.keys(definitions).filter(k => k.match(/^\d/)).length : 0
      });

      // Check if we need to repair the structure
      if (!definitions?.flat_lookup && definitions?.field_codes) {
        console.log('🔧 Attempting to repair flat_lookup from field_codes...');

        const flatLookup = {};
        Object.entries(definitions.field_codes).forEach(([prefix, codes]) => {
          Object.entries(codes).forEach(([code, codeData]) => {
            // Store both the clean code and full code formats
            flatLookup[code] = codeData.description;
            if (codeData.full_code) {
              flatLookup[codeData.full_code] = codeData.description;
            }
          });
        });

        const updatedDefinitions = {
          ...definitions,
          flat_lookup: flatLookup
        };

        // Update the database
        const { error: updateError } = await supabase
          .from('jobs')
          .update({ parsed_code_definitions: updatedDefinitions })
          .eq('id', jobId);

        if (updateError) {
          console.error('❌ Failed to repair definitions:', updateError);
          return { status: 'error', message: 'Failed to repair definitions' };
        }

        console.log('✅ Successfully repaired flat_lookup structure');
        return { status: 'repaired', message: 'Repaired flat_lookup structure', flatLookupCount: Object.keys(flatLookup).length };
      }

      return {
        status: 'ok',
        message: 'Code definitions appear to be properly structured',
        flatLookupCount: definitions?.flat_lookup ? Object.keys(definitions.flat_lookup).length : 0
      };

    } catch (error) {
      console.error('❌ Error diagnosing Microsystems definitions:', error);
      return { status: 'error', message: error.message };
    }
  },

  // Microsystems field to prefix mapping
  microsystemsPrefixMap: {
    'inspection_info_by': '140',
    'asset_building_class': '345',
    'asset_ext_cond': '490',
    'asset_int_cond': '491',
    'asset_type_use': '500',
    'asset_stories': '510',
    'asset_story_height': '510',
    'asset_design_style': '520',
    // Raw data fields
    'topo': '115',
    'road': '120',
    'curbing': '125',
    'sidewalk': '130',
    'utilities': '135',
    'zone_table': '205',
    'vcs': '210',
    'farmland_override': '212',
    'land_adjustments': '220',
    'renovation_impr': '235',
    'bath_kitchen_dep': '245',
    'functional_depr': '250',
    'locational_depr': '260',
    'item_adjustment': '346',
    'exterior': '530',
    'roof_type': '540',
    'roof_material': '545',
    'foundation': '550',
    'interior_wall': '555',
    'electric': '557',
    'roof_pitch': '559',
    'heat_source': '565',
    'built_ins_590': '590',
    'built_ins_591': '591',
    'detached_items': '680'
  },
 // Add this to interpretCodes object
brtParsedStructureMap: {
  // Format: fieldName: { parent: 'X', section: 'Y' }
  'asset_design_style': { parent: '9', section: '23' },
  'asset_building_class': { parent: '6', section: '20' },
  'asset_type_use': { parent: '7', section: '21' },
  'asset_stories': { parent: '8', section: '22' },
  'asset_story_height': { parent: '8', section: '22' },
  'asset_ext_cond': { parent: '34', section: '60' },
  'asset_int_cond': { parent: '34', section: '60' },
  'inspection_info_by': { parent: '30', section: '53' },
  // Raw data fields
  'attached_items': { parent: '4', section: '11' },
  'detached_items': { parent: '5', section: '15' },
  'roof_type': { parent: '10', section: '24' },
  'roof_material': { parent: '11', section: '25' },
  'exterior_finish': { parent: '12', section: '26' },
  'foundation': { parent: '13', section: '27' },
  'interior_finish': { parent: '14', section: '28' },
  'floor_finish': { parent: '15', section: '29' },
  'basement': { parent: '16', section: '30' },
  'heat_source': { parent: '17', section: '31' },
  'heat_system': { parent: '18', section: '32' },
  'electric': { parent: '19', section: '33' },
  'air_cond': { parent: '20', section: '34' },
  'plumbing': { parent: '21', section: '35' },
  'fireplace': { parent: '22', section: '36' },
  'attic_dormer': { parent: '23', section: '37' },
  'unfinished_area': { parent: '24', section: '38' },
  'miscellaneous': { parent: '25', section: '39' },
  'roof_pitch': { parent: '26', section: '41' },
  'neighborhood': { parent: '27', section: '50' },
  'view': { parent: '28', section: '51' },
  'utilities': { parent: '29', section: '52' },
  'road': { parent: '31', section: '53' },
  'class_adj': { parent: '32', section: '55' },
  'sidewalk': { parent: '33', section: '56' },
  'mkt_infl': { parent: '35', section: '61' },
  'land_adj': { parent: '36', section: '62' },
  'land_infl': { parent: '37', section: '63' },
  'land_udessc': { parent: '38', section: '64' },
  'field_call_result': { parent: '39', section: '70' },
},

  // Get decoded value for Microsystems property field
  getMicrosystemsValue: function(property, codeDefinitions, fieldName) {
    if (!property || !codeDefinitions) {
      return null;
    }

    const prefix = this.microsystemsPrefixMap[fieldName];
    if (!prefix) {
      return null;
    }

    // Get the code value from property (check both column and raw_data)
    let code = property[fieldName];
    if (!code && property.raw_data) {
      code = property.raw_data[fieldName];
    }

    if (!code || code.trim() === '') return null;

    // FIXED: Only look up codes within the correct prefix category to prevent cross-contamination
    const fieldCodes = codeDefinitions.field_codes;
    if (!fieldCodes || !fieldCodes[prefix]) {
      return code; // Return original code if no definitions found for this prefix
    }

    // Look up the code ONLY within the correct prefix category
    const categoryData = fieldCodes[prefix];
    const cleanCode = code.trim().toUpperCase();

    // Debug logging for story height
    if (fieldName === 'asset_story_height' && !window._storyHeightDebugLogged) {
      console.log('🔍 Story Height Lookup Debug:', {
        fieldName,
        prefix,
        codeFromProperty: code,
        cleanCode,
        propertyBlock: property.property_block,
        propertyLot: property.property_lot,
        availableCodesInCategory: Object.keys(categoryData),
        sampleCategoryData: Object.entries(categoryData).slice(0, 5).map(([k, v]) => ({
          code: k,
          description: v.description
        }))
      });
      window._storyHeightDebugLogged = true;
    }

    // First try exact match
    if (categoryData[cleanCode] && categoryData[cleanCode].description) {
      const result = categoryData[cleanCode].description;

      // Debug logging for story height
      if (fieldName === 'asset_story_height' && !window._storyHeightResultLogged) {
        console.log('✅ Story Height Found (exact match):', {
          cleanCode,
          result,
          categoryDataKeys: Object.keys(categoryData).slice(0, 10)
        });
        window._storyHeightResultLogged = true;
      }

      return result;
    }

    // If not found, try looking for codes that might have the prefix stripped
    // e.g., looking for "CL" in the 520 category
    for (const [storedCode, codeData] of Object.entries(categoryData)) {
      if (storedCode === cleanCode && codeData.description) {
        return codeData.description;
      }
    }

    // Fallback to flat_lookup only as last resort, but verify it belongs to the right category
    const flatLookup = codeDefinitions.flat_lookup || {};

    // Try multiple lookup patterns for Microsystems
    const lookupPatterns = [
      `${prefix}${cleanCode}9999`,           // Direct: "51019999"
      `${prefix}${cleanCode.padEnd(4)}9999`, // Padded: "5101   9999"
      `${prefix}${cleanCode.padStart(4, '0')}9999`, // Zero-padded: "510000019999"
    ];

    for (const lookupKey of lookupPatterns) {
      if (flatLookup[lookupKey]) {
        const result = flatLookup[lookupKey];

        // Debug logging for story height
        if (fieldName === 'asset_story_height' && !window._storyHeightResultLogged) {
          console.log('✅ Story Height Found (flat_lookup):', {
            cleanCode,
            lookupKey,
            result,
            allPatternsTried: lookupPatterns
          });
          window._storyHeightResultLogged = true;
        }

        return result;
      }
    }

    // Return original code if no valid description found in the correct category
    return code;
  },
// Core BRT lookup function - FIXED to handle the actual structure
getBRTValue: function(property, codeDefinitions, fieldName) {
  if (!property || !codeDefinitions) return null;

  // Get the code from the property
  let code = property[fieldName];
  if (!code || code.trim() === '') return null;

  // Check if we have sections (BRT structure)
  if (!codeDefinitions.sections?.Residential) {
    return code;
  }


  // Get the ORIGINAL BRT section number for this field
  const originalSectionMap = {
    'asset_design_style': '23',
    'asset_building_class': '20',
    'asset_type_use': '21',
    'asset_stories': '22',
    'asset_story_height': '22',
    'asset_ext_cond': '60',
    'asset_int_cond': '60',
    'asset_view': '51',
    'inspection_info_by': '53'
  };
  
  const targetSectionNumber = originalSectionMap[fieldName];
  if (!targetSectionNumber) {
    console.warn(`No BRT section mapping for field: ${fieldName}`);
    return code;
  }
  
  // Find the section that has KEY matching our target section number
  const residentialSections = codeDefinitions.sections.Residential;
  let targetSection = null;
  

  for (const [sectionKey, sectionData] of Object.entries(residentialSections)) {
    if (sectionData.KEY === targetSectionNumber) {
      targetSection = sectionData;
      break;
    }
  }


  if (!targetSection || !targetSection.MAP) {
    return code;
  }

  // Now look through the MAP for our code
  for (const [mapKey, mapValue] of Object.entries(targetSection.MAP)) {
    if (mapValue.KEY === code || mapValue.DATA?.KEY === code) {
      return mapValue.DATA?.VALUE || mapValue.VALUE || code;
    }
  }

  return code; // Return original if no match found
},

  // REPLACE the existing getDesignName with this:
  getDesignName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;
    
    const designCode = property.asset_design_style;
    if (!designCode || designCode.trim() === '') return null;
    
    if (vendorType === 'Microsystems') {
      return this.getMicrosystemsValue(property, codeDefinitions, 'asset_design_style');
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_design_style');
    }
    
    return designCode;
  },

  // REPLACE the existing getTypeName with this:
  getTypeName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;

    const typeCode = property.asset_type_use;
    if (!typeCode || typeCode.trim() === '') return null;

    if (vendorType === 'Microsystems') {
      return this.getMicrosystemsValue(property, codeDefinitions, 'asset_type_use');
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_type_use');
    }

    return typeCode;
  },

  getViewName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;

    const viewCode = property.asset_view;
    if (!viewCode || viewCode.trim() === '') return null;

    if (vendorType === 'Microsystems') {
      // Microsystems doesn't provide view data
      return null;
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_view');
    }

    return viewCode;
  },

  getStoryHeightName: function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;

    const storyCode = property.asset_story_height || property.asset_stories;
    if (!storyCode || storyCode.toString().trim() === '') return null;

    if (vendorType === 'Microsystems') {
      return this.getMicrosystemsValue(property, codeDefinitions, 'asset_story_height');
    } else if (vendorType === 'BRT') {
      return this.getBRTValue(property, codeDefinitions, 'asset_story_height');
    }

    return storyCode;
  },

  // Check if a field is empty (handles spaces, null, undefined, and BRT's "00")
  isFieldEmpty: function(value) {
    if (!value) return true;
    const strValue = value.toString().trim();
    return strValue === '' || strValue === '00';
  }, 
 
// Fix getExteriorConditionName:
getExteriorConditionName: function(property, codeDefinitions, vendorType) {
  if (!property || !codeDefinitions) return null;
  
  const condCode = property.asset_ext_cond;
  if (!condCode || condCode.trim() === '') return null;
  
  if (vendorType === 'Microsystems') {
    return this.getMicrosystemsValue(property, codeDefinitions, 'asset_ext_cond');
  } else if (vendorType === 'BRT') {
    // ADD THE SECTION NUMBER HERE - need to find what section exterior condition is in
    return this.getBRTValue(property, codeDefinitions, 'asset_ext_cond'); 
  }
  
  return condCode;
},

// Fix getInteriorConditionName:
getInteriorConditionName: function(property, codeDefinitions, vendorType) {
  if (!property || !codeDefinitions) return null;
  
  const condCode = property.asset_int_cond;
  if (!condCode || condCode.trim() === '') return null;
  
  if (vendorType === 'Microsystems') {
    return this.getMicrosystemsValue(property, codeDefinitions, 'asset_int_cond');
  } else if (vendorType === 'BRT') {
    // ADD THE SECTION NUMBER HERE - need to find what section interior condition is in
    return this.getBRTValue(property, codeDefinitions, 'asset_int_cond');
  }
  
  return condCode;
},

  // ===== NEW: STORY HEIGHT / FLOOR INTERPRETER =====
  getStoryHeight: async function(property, codeDefinitions, vendorType) {
    if (!property) return null;

    // NEW: First check asset_story_height column (now preserved as text with values like "2A", "1.5", etc.)
    if (property.asset_story_height) {
      return property.asset_story_height;
    }

    // Fallback: Check source file data for the original text value
    if (property.job_id && property.property_composite_key) {
      const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
      if (rawData) {
        if (vendorType === 'BRT') {
          // BRT stores in various possible field names
          const rawStory = rawData.STORYHGT ||
                          rawData.STORY_HEIGHT ||
                          rawData['Story Height'] ||
                          rawData.STORIES;
          if (rawStory) return rawStory;
        } else if (vendorType === 'Microsystems') {
          // Look for 510-prefixed fields in source data
          for (const key in rawData) {
            if (key.startsWith('510')) {
              const value = rawData[key];
              if (value) return value;
            }
          }
          // Also check common field names
          const rawStory = rawData['Story Height'] ||
                          rawData.STORY_HEIGHT ||
                          rawData.STORIES;
          if (rawStory) return rawStory;
        }
      }
    }
    
    // If no raw_data, try to decode from asset_stories using code definitions
    const storyCode = property.asset_stories;
    if (storyCode && codeDefinitions) {
      if (vendorType === 'Microsystems') {
        // Look up in code definitions with 510 prefix
        const lookupKey = `510${String(storyCode).padEnd(4)}9999`;
        if (codeDefinitions[lookupKey]) {
          return codeDefinitions[lookupKey];
        }
      } else if (vendorType === 'BRT') {
        // Look in section 22 for story height
        if (codeDefinitions.sections && codeDefinitions.sections['22']) {
          const section = codeDefinitions.sections['22'];
          const sectionMap = section.MAP || {};
          
          for (const [key, value] of Object.entries(sectionMap)) {
            if (value.KEY === storyCode || value.DATA?.KEY === storyCode) {
              return value.DATA?.VALUE || value.VALUE || storyCode;
            }
          }
        }
      }
    }
    
    // Return whatever we have
    return storyCode;
  },

  // ===== SNEAKY CONDO FLOOR EXTRACTOR =====
  getCondoFloor: function(property, codeDefinitions, vendorType) {
    // First get the story height description
    const storyHeight = this.getStoryHeight(property, codeDefinitions, vendorType);
    
    if (!storyHeight) return null;
    
    // Convert to string to handle both text and numeric values
    const storyStr = String(storyHeight).toUpperCase();
    
    // SNEAKY PART: Look for ANY description with "FLOOR" in it!
    if (storyStr.includes('FLOOR')) {
      // Try to extract floor number from various patterns:
      // "CONDO 1ST FLOOR", "1ST FLOOR", "FLOOR 1", "3RD FLOOR UNIT", etc.
      
      // Pattern 1: "1ST FLOOR", "2ND FLOOR", "3RD FLOOR", "4TH FLOOR"
      const ordinalMatch = storyStr.match(/(\d+)(ST|ND|RD|TH)\s*FLOOR/);
      if (ordinalMatch) {
        return parseInt(ordinalMatch[1]);
      }
      
      // Pattern 2: "FLOOR 1", "FLOOR 2", etc.
      const floorNumMatch = storyStr.match(/FLOOR\s*(\d+)/);
      if (floorNumMatch) {
        return parseInt(floorNumMatch[1]);
      }
      
      // Pattern 3: Just a number before FLOOR
      const numberBeforeMatch = storyStr.match(/(\d+)\s*FLOOR/);
      if (numberBeforeMatch) {
        return parseInt(numberBeforeMatch[1]);
      }
      
      // Pattern 4: Written out floors
      if (storyStr.includes('FIRST FLOOR') || storyStr.includes('GROUND FLOOR')) return 1;
      if (storyStr.includes('SECOND FLOOR')) return 2;
      if (storyStr.includes('THIRD FLOOR')) return 3;
      if (storyStr.includes('FOURTH FLOOR')) return 4;
      if (storyStr.includes('FIFTH FLOOR')) return 5;
      if (storyStr.includes('SIXTH FLOOR')) return 6;
      if (storyStr.includes('SEVENTH FLOOR')) return 7;
      if (storyStr.includes('EIGHTH FLOOR')) return 8;
      if (storyStr.includes('NINTH FLOOR')) return 9;
      if (storyStr.includes('TENTH FLOOR')) return 10;
      
      // Pattern 5: Penthouse or top floor
      if (storyStr.includes('PENTHOUSE') || storyStr.includes('PH')) return 99; // Special code for penthouse
      
      // If we found "FLOOR" but couldn't extract a number, return -1 to indicate unknown floor
      return -1;
    }
    
    // Also check for "CONDO" patterns even without "FLOOR"
    if (storyStr.includes('CONDO')) {
      // "CONDO 1", "CONDO 2", "CONDO 1ST", etc.
      const condoMatch = storyStr.match(/CONDO\s*(\d+)/);
      if (condoMatch) {
        return parseInt(condoMatch[1]);
      }
    }
    
    // Check property_location or property_qualifier for unit numbers that might indicate floor
    if (property.property_location) {
      const location = String(property.property_location).toUpperCase();
      // Common pattern: "3A", "2B" where first digit is floor
      const unitMatch = location.match(/^(\d)[A-Z]/);
      if (unitMatch) {
        const floor = parseInt(unitMatch[1]);
        if (floor >= 1 && floor <= 9) return floor;
      }
    }
    
    if (property.property_qualifier) {
      const qualifier = String(property.property_qualifier).toUpperCase();
      // Check for floor indicators in qualifier
      const qualMatch = qualifier.match(/(\d)(ST|ND|RD|TH)|FLOOR\s*(\d)|^(\d)[A-Z]/);
      if (qualMatch) {
        const floor = parseInt(qualMatch[1] || qualMatch[3] || qualMatch[4]);
        if (floor >= 1 && floor <= 99) return floor;
      }
    }
    
    return null;
  },

  // ===== CONDO-SPECIFIC DATA QUALITY CHECK =====
  hasCondoFloorData: function(property, codeDefinitions, vendorType) {
    const floor = this.getCondoFloor(property, codeDefinitions, vendorType);
    return floor !== null && floor !== -1; // -1 means we found "FLOOR" but couldn't parse
  },

  // Get raw data value with vendor awareness
  getRawDataValue: async function(property, fieldName, vendorType) {
    if (!property) return null;

    // Get source file data for this property
    if (!property.job_id || !property.property_composite_key) return null;

    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    if (!rawData) return null;
    
    // Handle vendor-specific field name differences
    if (vendorType === 'BRT') {
      const brtFieldMap = {
        'bedrooms': 'BEDTOT',
        'bathrooms': 'BATHTOT',
        'stories': 'STORYHGT',
        'year_built': 'YEARBUILT',
        'building_class': 'BLDGCLASS',
        'design': 'DESIGN',
        'type_use': 'TYPEUSE',
        'exterior_condition': 'EXTERIORNC',
        'interior_condition': 'INTERIORNC',
        'info_by': 'INFOBY'
      };
      const brtField = brtFieldMap[fieldName] || fieldName;
      return rawData[brtField];
    } else if (vendorType === 'Microsystems') {
      const microFieldMap = {
        'bedrooms': 'Total Bedrms',
        'stories': 'Story Height',
        'year_built': 'Year Built',
        'building_class': 'Bldg Qual Class Code',
        'design': 'Style Code',
        'type_use': 'Type Use Code',
        'condition': 'Condition',
        'info_by': 'Information By'
      };
      const microField = microFieldMap[fieldName] || fieldName;
      return rawData[microField];
    }

    return rawData[fieldName];
  },

// Get total lot size (aggregates multiple fields)
getTotalLotSize: async function(property, vendorType, codeDefinitions) {
  if (!property) return null;

  // 1) Explicit manual acreage from unit-rate processing (preferred)
  const manualAcre = property.market_manual_lot_acre ?? property.market_manual_acre ?? property.manual_lot_acre ?? null;
  if (manualAcre !== undefined && manualAcre !== null) {
    const num = parseFloat(manualAcre);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2) Explicit asset acreage
  let totalAcres = parseFloat(property.asset_lot_acre) || 0;

  // 3) Explicit square feet fields (manual then asset) -> convert to acres
  const sfCandidates = (property.market_manual_lot_sf && parseFloat(property.market_manual_lot_sf)) || (property.asset_lot_sf && parseFloat(property.asset_lot_sf)) || 0;
  let totalSf = sfCandidates || 0;

  // 4) If still nothing, compute from frontage × depth
  if (totalAcres === 0 && totalSf === 0) {
    const frontage = parseFloat(property.asset_lot_frontage) || 0;
    const depth = parseFloat(property.asset_lot_depth) || 0;
    if (frontage > 0 && depth > 0) {
      totalSf = frontage * depth;
    }
  }

  // 5) BRT: Check LANDUR codes only if still no data and code definitions are available
  if (totalAcres === 0 && totalSf === 0 && vendorType === 'BRT' && property.job_id && property.property_composite_key && codeDefinitions) {
    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    const propertyVCS = rawData?.VCS || property.property_vcs;

    if (propertyVCS && codeDefinitions.sections?.VCS) {
      let vcsData = codeDefinitions.sections.VCS[propertyVCS];

      if (!vcsData) {
        // Search for matching VCS
        for (const [key, value] of Object.entries(codeDefinitions.sections.VCS)) {
          if (value.KEY === propertyVCS || value.DATA?.KEY === propertyVCS) {
            vcsData = value;
            break;
          }
        }
      }

      if (vcsData?.MAP?.["8"]?.MAP) {
        const urcMap = vcsData.MAP["8"].MAP;

        for (let i = 1; i <= 6; i++) {
          const landCode = rawData?.[`LANDUR_${i}`];
          const landUnits = parseFloat(rawData?.[`LANDURUNITS_${i}`]) || 0;

          // BRT stores single digit codes without leading zero, pad them
          const paddedCode = landCode ? String(landCode).padStart(2, '0') : null;

          if (paddedCode && landUnits > 0) {
            // Find the matching code entry (they're numbered "1", "2", "3" etc)
            for (const key in urcMap) {
              if (urcMap[key].KEY === paddedCode && urcMap[key].MAP?.["1"]?.DATA?.VALUE) {
                const description = urcMap[key].MAP["1"].DATA.VALUE.toUpperCase();

                if ((description.includes('ACRE') || description.includes('AC')) &&
                    !description.includes('SITE VALUE')) {
                  totalAcres += landUnits;
                } else if ((description.includes('SF') || description.includes('SQUARE')) &&
                           !description.includes('SITE VALUE')) {
                  totalSf += landUnits;
                }
                break;
              }
            }
          }
        }
      }
    }
  }

  // Convert sf to acres and return the first positive result
  const finalAcres = (totalAcres && totalAcres > 0) ? totalAcres : (totalSf && totalSf > 0 ? (totalSf / 43560) : null);
  return finalAcres && finalAcres > 0 ? finalAcres : null;
},
// Get bathroom plumbing sum (BRT only)
  getBathroomPlumbingSum: async function(property, vendorType) {
    if (!property || vendorType !== 'BRT' || !property.job_id || !property.property_composite_key) return 0;

    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    if (!rawData) return 0;

    let sum = 0;
    for (let i = 2; i <= 6; i++) {
      sum += parseInt(rawData[`PLUMBING${i}FIX`]) || 0;
    }
    return sum;
  },

  // Get bathroom fixture sum (Microsystems only - summary fields)
  getBathroomFixtureSum: async function(property, vendorType) {
    if (!property || vendorType !== 'Microsystems' || !property.job_id || !property.property_composite_key) return 0;

    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    if (!rawData) return 0;

    return (parseInt(rawData['4 Fixture Bath']) || 0) +
           (parseInt(rawData['3 Fixture Bath']) || 0) +
           (parseInt(rawData['2 Fixture Bath']) || 0) +
           (parseInt(rawData['Num 5 Fixture Baths']) || 0);
  },

  // Get bathroom room sum (Microsystems only - floor-specific fields)
  getBathroomRoomSum: async function(property, vendorType) {
    if (!property || vendorType !== 'Microsystems' || !property.job_id || !property.property_composite_key) return 0;

    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    if (!rawData) return 0;

    let sum = 0;
    const floorSuffixes = ['B', '1', '2', '3'];
    const fixtureTypes = ['2 Fixture Bath', '3 Fixture Bath', '4 Fixture Bath'];

    for (const fixture of fixtureTypes) {
      for (const floor of floorSuffixes) {
        const fieldName = `${fixture} ${floor}`;
        sum += parseInt(rawData[fieldName]) || 0;
      }
    }

    // Add the summary 5-fixture field since there are no floor-specific ones
    sum += parseInt(rawData['Num 5 Fixture Baths']) || 0;

    return sum;
  },

  // Get bedroom room sum (Microsystems only)
  getBedroomRoomSum: async function(property, vendorType) {
    if (!property || vendorType !== 'Microsystems' || !property.job_id || !property.property_composite_key) return 0;

    const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
    if (!rawData) return 0;

    return (parseInt(rawData['Bedrm B']) || 0) +
           (parseInt(rawData['Bedrm 1']) || 0) +
           (parseInt(rawData['Bedrm 2']) || 0) +
           (parseInt(rawData['Bedrm 3']) || 0);
  },

  // Get VCS (Valuation Control Sector) description - aka Neighborhood
  getVCSDescription: async function(property, codeDefinitions, vendorType) {
    if (!property || !codeDefinitions) return null;
    
    // Get VCS code from property (check multiple possible fields)
    let vcsCode = property.newVCS || property.new_vcs || property.vcs;
    if (!vcsCode && property.job_id && property.property_composite_key) {
      const rawData = await getRawDataForProperty(property.job_id, property.property_composite_key);
      if (rawData) {
        vcsCode = rawData.vcs ||
                  rawData.VCS ||
                  rawData.NEIGHBORHOOD ||
                  rawData.neighborhood;
      }
    }  
    
    if (!vcsCode || vcsCode.toString().trim() === '') return null;
    
    // Clean the VCS code
    vcsCode = vcsCode.toString().trim();
    
    if (vendorType === 'Microsystems') {
      // Microsystems: Direct lookup with 210 prefix
      // The codes have format: 210XXXX9999 where XXXX is the VCS code
      // We need to pad the code to 4 characters
      const paddedCode = vcsCode.padEnd(4, ' ');
      
      // Try multiple lookup patterns (1000, 5000, 9999 suffixes)
      const suffixes = ['9999', '5000', '1000'];
      
      for (const suffix of suffixes) {
        const lookupKey = `210${paddedCode}${suffix}`;
        if (codeDefinitions[lookupKey]) {
          return codeDefinitions[lookupKey];
        }
      }
      
      // If no match found, return the original code
      return vcsCode;
      
    } else if (vendorType === 'BRT') {
      // BRT: Navigate the nested structure
      // Structure: sections.VCS[number]["9"]["DATA"]["VALUE"]
      
      if (!codeDefinitions.sections || !codeDefinitions.sections.VCS) {
        return vcsCode;
      }
      
      const vcsSection = codeDefinitions.sections.VCS;
      
      // VCS code in BRT is typically the key number (1-55 in your example)
      // Check if the code is a direct key in the VCS section
      if (vcsSection[vcsCode]) {
        // Navigate to the neighborhood value
        const entry = vcsSection[vcsCode];
        if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
          return entry['9']['DATA']['VALUE'];
        }
      }
      
      // If not found by direct key, search through all entries
      for (const key in vcsSection) {
        const entry = vcsSection[key];
        // Check if this entry's KEY matches our VCS code
        if (entry.KEY === vcsCode || entry.DATA?.KEY === vcsCode) {
          if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
            return entry['9']['DATA']['VALUE'];
          }
        }
      }
      
      // Return original code if no match found
      return vcsCode;
    }
    
    return vcsCode;
  },
  // Get all available VCS codes and descriptions for a job
  getAllVCSCodes: function(codeDefinitions, vendorType) {
    const vcsCodes = [];
    
    if (!codeDefinitions) return vcsCodes;
    
    if (vendorType === 'Microsystems') {
      // Extract all 210-prefixed codes
      for (const key in codeDefinitions) {
        if (key.startsWith('210') && key.endsWith('9999')) {
          // Extract the VCS code part (characters 3-7)
          const vcsCode = key.substring(3, 7).trim();
          const description = codeDefinitions[key];
          
          // Avoid duplicates
          if (!vcsCodes.find(v => v.code === vcsCode)) {
            vcsCodes.push({
              code: vcsCode,
              description: description
            });
          }
        }
      }
      
    } else if (vendorType === 'BRT') {
      // Extract from nested VCS section
      if (codeDefinitions.sections && codeDefinitions.sections.VCS) {
        const vcsSection = codeDefinitions.sections.VCS;
        
        for (const key in vcsSection) {
          const entry = vcsSection[key];
          if (entry['9'] && entry['9']['DATA'] && entry['9']['DATA']['VALUE']) {
            vcsCodes.push({
              code: key,
              description: entry['9']['DATA']['VALUE']
            });
          }
        }
      }
    }
    
    // Sort by code
    return vcsCodes.sort((a, b) => {
      // Try numeric sort first
      const numA = parseInt(a.code);
      const numB = parseInt(b.code);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      // Fall back to string sort
      return a.code.localeCompare(b.code);
    });
  },

  // ===== PACKAGE SALE AGGREGATOR =====
  getPackageSaleData: function(properties, targetProperty) {
    // Check if we have the required fields for package sale detection
    if (!targetProperty?.sales_date || !targetProperty?.sales_book || !targetProperty?.sales_page) {
      return null;
    }
    
    // Find all properties in the same package (same date, book, and page)
    const packageProperties = properties.filter(p => 
      p.sales_date === targetProperty.sales_date &&
      p.sales_book === targetProperty.sales_book &&
      p.sales_page === targetProperty.sales_page
    );
    
    // If only one property, it's not a package sale
    if (packageProperties.length <= 1) {
      return null;
    }
    
    // Check if any properties have "Keep Both" decisions in sales_history
    const hasKeepBothHistory = packageProperties.some(p => 
      p.sales_history?.sales_decision?.decision_type === 'Keep Both'
    );
    
    // Sort by building class to find primary property (lowest class number)
    const sortedByClass = [...packageProperties].sort((a, b) => {
      const classA = parseInt(a.asset_building_class) || 999;
      const classB = parseInt(b.asset_building_class) || 999;
      return classA - classB;
    });
    
    const primary = sortedByClass[0];
    
    // Calculate combined lot size (sum of sf and acres converted)
    const combinedLotSF = packageProperties.reduce((sum, p) => {
      const sf = parseFloat(p.asset_lot_sf) || 0;
      const acres = parseFloat(p.asset_lot_acre) || 0;
      return sum + sf + (acres * 43560); // Convert acres to SF
    }, 0);
    
    // Calculate combined assessed value
    const combinedAssessed = packageProperties.reduce((sum, p) => {
      const assessed = parseFloat(p.values_mod_total) || 0;
      return sum + assessed;
    }, 0);
    
    // Get unique property classes
    const propertyClasses = [...new Set(packageProperties.map(p => p.asset_building_class))];
    
    // Check for specific class types
    const hasVacant = packageProperties.some(p => 
      p.asset_building_class === '1' || p.asset_building_class === '3B'
    );
    
    const hasFarmland = packageProperties.some(p => {
      const propClass = p.property_m4_class || p.property_class;
      return propClass === '3B';
    });

    // Determine package type using robust checks:
    // 1) If only one record -> not a package (handled earlier)
    // 2) If multiple records but all share same base property (block-lot-qualifier) AND there are multiple distinct card values -> additional cards
    // 3) If multiple distinct base properties -> multi-property package

    let isAdditionalCard = false;
    let isMultiPropertyPackage = false;

    // Build sets of base keys and card identifiers using explicit fields when available
    const baseKeys = new Set();
    const cardIds = new Set();

    packageProperties.forEach(p => {
      const block = (p.property_block || '').toString().trim();
      const lot = (p.property_lot || '').toString().trim();
      const qual = (p.property_qualifier || '').toString().trim();
      const baseKey = `${block}-${lot}-${qual}`;
      baseKeys.add(baseKey);

      // Card can be in explicit field or parsed from composite key
      let card = p.property_card || p.property_addl_card || null;
      if (!card && p.property_composite_key) {
        const parts = p.property_composite_key.split('-').map(s => s.trim());
        // heuristic: card is often the 4th or 5th part; try common positions
        card = parts[4] || parts[3] || null;
      }
      if (card) cardIds.add(String(card).trim().toUpperCase());
    });

    if (baseKeys.size === 1) {
      // All records refer to same base property. Determine if there are multiple distinct cards
      // Apply vendor-specific rules to interpret cards
      if (cardIds.size > 1) {
        // For BRT, card values are numeric; require at least one numeric card > 1 to be additional
        const sampleVendorCheck = packageProperties[0]?.vendor || null;
        if (sampleVendorCheck === 'BRT') {
          const numericCards = Array.from(cardIds).map(c => parseInt(c)).filter(n => !isNaN(n));
          // If multiple numeric card values and at least one > 1, it's additional cards
          if (numericCards.length > 1 && numericCards.some(n => n > 1)) {
            isAdditionalCard = true;
          }
        } else {
          // Microsystems or others: treat 'M' as main, other letters as additional
          const nonMain = Array.from(cardIds).filter(c => c !== 'M');
          if (nonMain.length > 0 && cardIds.size > 1) {
            isAdditionalCard = true;
          } else if (cardIds.size > 1) {
            // Fallback: multiple distinct card identifiers -> additional
            isAdditionalCard = true;
          }
        }

        // Safety: if cardIds.size <=1, treat as single property sale (not additional)
      } else {
        // Only one unique card value across multiple records — treat as single property sale (avoid false positive)
        // Do not mark as additional card
        isAdditionalCard = false;
      }
    } else if (baseKeys.size > 1) {
      // Multiple different base properties -> true package
      isMultiPropertyPackage = true;
    }

    // If neither additional nor multi-property detected, but packageProperties.length > 1, default to package
    if (!isAdditionalCard && !isMultiPropertyPackage && packageProperties.length > 1) {
      // In ambiguous cases assume multi-property package to be safe
      isMultiPropertyPackage = true;
    }
    
    const hasResidential = packageProperties.some(p => {
      const propClass = p.asset_building_class;
      return propClass === '2' || propClass === '3A';
    });
    
    const hasCommercial = packageProperties.some(p => {
      const propClass = p.asset_building_class;
      return propClass === '4A' || propClass === '4B' || propClass === '4C';
    });
    
    // Create package ID for grouping
    const packageId = `${targetProperty.sales_book}-${targetProperty.sales_page}-${targetProperty.sales_date}`;
    
    // Check for previous individual sales (from Keep Both decisions in sales_history)
    const previousIndividualSales = packageProperties
      .filter(p => p.sales_history?.sales_decision?.old_price)
      .map(p => ({
        composite_key: p.property_composite_key,
        old_price: p.sales_history.sales_decision.old_price,
        old_date: p.sales_history.sales_decision.old_date,
        package_discount: p.sales_history.sales_decision.old_price - (p.sales_price / packageProperties.length)
      }));
    
    return {
      is_package_sale: true,
      is_farm_package: hasFarmland,
      is_additional_card: isAdditionalCard,
      package_count: packageProperties.length,
      package_id: packageId,
      combined_lot_sf: combinedLotSF,
      combined_lot_acres: combinedLotSF / 43560,
      combined_assessed: combinedAssessed,
      primary_type_use: primary.asset_type_use,
      primary_building_class: primary.asset_building_class,
      property_classes: propertyClasses,
      has_vacant: hasVacant,
      has_farmland: hasFarmland,
      has_residential: hasResidential,
      has_commercial: hasCommercial,
      has_keep_both_history: hasKeepBothHistory,
      sale_price: parseFloat(targetProperty.sales_price), // Use original, not multiplied
      sales_nu: targetProperty.sales_nu,
      previous_individual_sales: previousIndividualSales,
      package_properties: packageProperties.map(p => ({
        composite_key: p.property_composite_key,
        building_class: p.asset_building_class,
        lot_sf: p.asset_lot_sf,
        lot_acre: p.asset_lot_acre,
        assessed_value: p.values_mod_total,
        has_sales_history: !!p.sales_history,
        location: p.property_location,
        block: p.property_block,
        lot: p.property_lot
      }))
    };
  },
    // ===== DEPTH FACTOR INTERPRETERS =====
  // Get depth factors from parsed code definitions
  getDepthFactors: function(codeDefinitions, vendorType) {
    if (!codeDefinitions) return null;
    
    if (vendorType === 'BRT') {
      // BRT stores depth factors in the "Depth" section
      const depthSection = codeDefinitions.sections?.['Depth'];
      if (!depthSection) return null;
      
      // Extract all depth tables
      const depthTables = {};
      
      Object.keys(depthSection).forEach(tableKey => {
        const table = depthSection[tableKey];
        if (table.DATA?.VALUE && table.MAP) {
          // Table name like "100FT Table", "125FT Table"
          const tableName = table.DATA.VALUE;
          const factors = {};
          
          // Extract depth factors from the MAP
          Object.values(table.MAP).forEach(entry => {
            const depth = parseInt(entry.KEY);
            const factor = parseFloat(entry.DATA.VALUE);
            if (!isNaN(depth) && !isNaN(factor)) {
              factors[depth] = factor;
            }
          });
          
          depthTables[tableName] = {
            standardDepth: parseInt(tableName.match(/(\d+)FT/)?.[1]) || 100,
            factors: factors
          };
        }
      });
      
      return depthTables;
      
    } else if (vendorType === 'Microsystems') {
      // Microsystems uses prefix 200 for depth factors
      const depthTables = {};
      
      Object.keys(codeDefinitions).forEach(key => {
        if (key.startsWith('200')) {
          // Parse: 200[Type][StandardDepth][ActualDepth]
          const match = key.match(/^200([CR])(\d{3})(\d{4})$/);
          if (match) {
            const [, type, standardDepth, actualDepth] = match;
            const tableType = type === 'C' ? 'Commercial' : 'Residential';
            const tableName = `${tableType}-${standardDepth}FT`;
            
            if (!depthTables[tableName]) {
              depthTables[tableName] = {
                standardDepth: parseInt(standardDepth),
                factors: {}
              };
            }
            
            // Only add if there's a value (not empty string)
            const factor = codeDefinitions[key];
            if (factor !== '') {
              depthTables[tableName].factors[parseInt(actualDepth)] = parseFloat(factor);
            }
          }
        }
      });
      
      // Return null if no factors loaded (rural town case)
      return Object.keys(depthTables).length > 0 ? depthTables : null;
    }
    
    return null;
  },

  // Get depth factor for a specific depth using bracket system
  getDepthFactor: function(depth, selectedTable, depthTables) {
    const table = depthTables[selectedTable];
    if (!table || !table.factors) return 1.0;
    
    // Find the appropriate bracket
    const depths = Object.keys(table.factors).map(Number).sort((a, b) => a - b);
    
    // Find the bracket this depth falls into
    for (let i = depths.length - 1; i >= 0; i--) {
      if (depth >= depths[i]) {
        return table.factors[depths[i]];
      }
    }
    
    // If smaller than smallest depth, use the smallest factor
    return table.factors[depths[0]];
  },

  // Get front foot configuration with depth factors
  getFrontFootConfig: function(codeDefinitions, vendorType) {
    const depthTables = this.getDepthFactors(codeDefinitions, vendorType);
    
    if (!depthTables) return null;
    
    // Return the first table as default, or let manager select
    const defaultTable = Object.values(depthTables)[0];
    
    return {
      availableTables: depthTables,
      defaultTable: defaultTable,
      standardDepth: defaultTable?.standardDepth || 100,
      depthFactors: defaultTable?.factors || {},
      minimumFrontage: null // Manager must set this
    };
  },
  // ===== SMART ACREAGE CALCULATOR =====
  getCalculatedAcreage: function(property, vendorType) {
    // Defensive: if property is falsy, return zero acres string
    if (!property) return '0.00';

    const marketAnalysis = (property && (property.property_market_analysis || property.property_market_analysis_raw)) || null;

    // ===== NEW CORRECT WORKFLOW FOR BRT =====
    if (vendorType === 'BRT') {
      // 1. FIRST: Check for lot dimensions (frontage × depth)
      const frontage = marketAnalysis?.asset_lot_frontage ?? property.asset_lot_frontage;
      const depth = marketAnalysis?.asset_lot_depth ?? property.asset_lot_depth;

      if (frontage && depth && parseFloat(frontage) > 0 && parseFloat(depth) > 0) {
        const sf = parseFloat(frontage) * parseFloat(depth);
        const acres = (sf / 43560).toFixed(2);
        // Calculated from frontage × depth
        return acres;
      }

      // 2. FALLBACK: Use Unit Rate Config results (market_manual_lot_acre)
      const manualAcre = marketAnalysis?.market_manual_lot_acre ?? property.market_manual_lot_acre;
      if (manualAcre && parseFloat(manualAcre) > 0) {
        // Using Unit Rate Config manual acres
        return parseFloat(manualAcre).toFixed(2);
      }

      // 3. Check if we can derive from market_manual_lot_sf
      const manualSf = marketAnalysis?.market_manual_lot_sf ?? property.market_manual_lot_sf;
      if (manualSf && parseFloat(manualSf) > 0) {
        const acres = (parseFloat(manualSf) / 43560).toFixed(2);
        // Calculated from Unit Rate Config SF
        return acres;
      }

      // 4. Final fallback: Check for pre-calculated fields (unlikely for BRT but just in case)
      const acreField = marketAnalysis?.asset_lot_acre ?? property.asset_lot_acre;
      if (acreField && parseFloat(acreField) > 0) {
        // Using pre-calculated asset_lot_acre field
        return parseFloat(acreField).toFixed(2);
      }

      const sfField = marketAnalysis?.asset_lot_sf ?? property.asset_lot_sf;
      if (sfField && parseFloat(sfField) > 0) {
        const acres = (parseFloat(sfField) / 43560).toFixed(2);
        // Calculated from asset_lot_sf field
        return acres;
      }

      // BRT: No more LANDUR summation - that was the old incorrect way
      // No valid lot size source found for BRT property
      return '0.00';
    }

    // ===== NON-BRT VENDORS (existing logic) =====

    // 1. Prefer a manual override field in property_market_analysis
    const manualAcre = marketAnalysis?.market_manual_lot_acre ?? marketAnalysis?.market_manual_acre ?? property.market_manual_lot_acre;
    if (manualAcre && parseFloat(manualAcre) > 0) {
      return parseFloat(manualAcre).toFixed(2);
    }

    // 2. Prefer property_market_analysis fields (migrated schema)
    const acreField = marketAnalysis?.asset_lot_acre ?? property.asset_lot_acre;
    if (acreField && parseFloat(acreField) > 0) {
      return parseFloat(acreField).toFixed(2);
    }

    // 3. Check square feet field on market analysis or property
    const sfField = marketAnalysis?.asset_lot_sf ?? property.asset_lot_sf;
    if (sfField && parseFloat(sfField) > 0) {
      return (parseFloat(sfField) / 43560).toFixed(2);
    }

    // 4. Calculate from frontage × depth (market analysis first)
    const frontage = marketAnalysis?.asset_lot_frontage ?? property.asset_lot_frontage;
    const depth = marketAnalysis?.asset_lot_depth ?? property.asset_lot_depth;
    if (frontage && depth && parseFloat(frontage) > 0 && parseFloat(depth) > 0) {
      const sf = parseFloat(frontage) * parseFloat(depth);
      return (sf / 43560).toFixed(2);
    }

    // 5. Microsystems vendor check using attached raw_data
    try {
      if (vendorType === 'Microsystems' && property.raw_data) {
        const lotArea = property.raw_data['Lot Area'] || property.raw_data['Site Area'] || property.raw_data['Acreage'] || property.raw_data['Acres'];
        if (lotArea) {
          const numValue = parseFloat(String(lotArea).replace(/[,$]/g, ''));
          if (!isNaN(numValue)) {
            if (numValue > 1000) return (numValue / 43560).toFixed(2);
            return numValue.toFixed(2);
          }
        }
      }
    } catch (e) {
      console.error('Error while parsing raw_data for acreage calculation fallback:', e);
    }

    // 6. Fall back to PROPERTY_ACREAGE (divide by 10000) if present
    if (property.PROPERTY_ACREAGE || property.property_acreage) {
      const propAcreage = parseFloat(property.PROPERTY_ACREAGE ?? property.property_acreage);
      if (!isNaN(propAcreage) && propAcreage > 0) {
        const acres = propAcreage / 10000;
        return acres.toFixed(2);
      }
    }

    // Default return if no acreage can be calculated
    return '0.00';
  }
};  

// ===== UNIT RATE LOT CALCULATION =====
export async function runUnitRateLotCalculation(jobId, selectedCodes = []) {
  // existing implementation continues...
  // selectedCodes: array of code identifiers (strings) to include
  if (!jobId) throw new Error('jobId required');

  try {
    // Get parsed source file and code definitions
    const rawDataForJob = await getRawDataForJob(jobId);
    if (!rawDataForJob) {
      throw new Error('No source file parsed data available for this job');
    }

    const codeDefinitions = rawDataForJob.vendorType === 'BRT' ? (rawDataForJob.codeDefinitions || rawDataForJob.parsed_code_definitions || null) : null;

    // Build VCS identifier map from codeDefinitions for robust matching (vcsKey -> set of identifiers)
    const vcsIdMap = new Map();
    if (codeDefinitions && codeDefinitions.sections && codeDefinitions.sections.VCS) {
      Object.keys(codeDefinitions.sections.VCS).forEach(vkey => {
        const entry = codeDefinitions.sections.VCS[vkey];
        const ids = new Set();
        ids.add(String(vkey));
        if (entry?.DATA?.VALUE) ids.add(String(entry.DATA.VALUE));
        if (entry?.DATA?.KEY) ids.add(String(entry.DATA.KEY));
        // Also include any MAP keys that might identify the VCS
        if (entry?.KEY) ids.add(String(entry.KEY));
        vcsIdMap.set(String(vkey), ids);
      });
    }

    // Iterate over parsed property map and compute acreage based on selectedCodes
    const updates = [];
    const appliedCodesMap = {};
    for (const [compositeKey, rawRecord] of rawDataForJob.propertyMap.entries()) {
      let totalAcres = 0;
      let totalSf = 0;

      // determine property VCS identifier
      const propVcsRaw = rawRecord.VCS || rawRecord.vcs || rawRecord.property_vcs || rawRecord.VCS_CODE || null;
      const propVcs = propVcsRaw ? String(propVcsRaw).trim() : null;

      for (let i = 1; i <= 6; i++) {
        const landCode = rawRecord[`LANDUR_${i}`];
        const landUnitsRaw = rawRecord[`LANDURUNITS_${i}`];
        const units = landUnitsRaw !== undefined && landUnitsRaw !== null ? parseFloat(String(landUnitsRaw).replace(/[,$\s\"]/g, '')) : NaN;
        if (isNaN(units) || units <= 0) continue;

        // If no selected codes, include everything. Otherwise, include only if code matches selectedCodes
        if (selectedCodes && selectedCodes.length > 0) {
          if (!landCode) continue;
          const codeStr = String(landCode).trim();

          // selectedCodes entries are expected to be namespaced as 'VCSKEY::CODE'
          const matches = selectedCodes.some(scRaw => {
            const sc = String(scRaw).trim();
            if (sc.includes('::')) {
              const [vcsKeySel, codeSel] = sc.split('::').map(s => s.trim());
              if (!codeSel) return false;

              // code must match
              const codeMatches = codeSel === codeStr || codeSel.padStart(2, '0') === codeStr.padStart(2, '0');
              if (!codeMatches) return false;

              // vcs must match property vcs - check known identifiers
              const idSet = vcsIdMap.get(String(vcsKeySel));
              if (!idSet) {
                // fallback: match vcsKeySel against propVcs directly
                return propVcs && (String(propVcs) === String(vcsKeySel) || String(propVcs).padStart(2,'0') === String(vcsKeySel).padStart(2,'0'));
              }

              if (!propVcs) return false;
              return Array.from(idSet).some(id => String(id).trim() === String(propVcs).trim());

            } else {
              // legacy: user selected un-namespaced code -> match code only across all VCS
              return sc === codeStr || sc.padStart(2, '0') === codeStr.padStart(2, '0');
            }
          });

          if (!matches) continue;
        }

        // Heuristic: treat >=1000 as SF, else acres
        if (units >= 1000) totalSf += units;
        else totalAcres += units;
      }

      const acres = totalAcres + (totalSf / 43560);

      // Save into property_market_analysis for this composite key (do NOT persist applied codes here)
      const acreVal = acres > 0 ? parseFloat(acres.toFixed(2)) : null;
      const sfVal = acreVal !== null ? Math.round(acreVal * 43560) : null;
      updates.push({
        job_id: jobId,
        property_composite_key: compositeKey,
        market_manual_lot_acre: acreVal,
        market_manual_lot_sf: sfVal
      });

      // Track what codes were applied for this property in a job-level map
      appliedCodesMap[compositeKey] = selectedCodes || [];
    }

    // Upsert updates in batches
    const batchSize = 200;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const { error } = await supabase.from('property_market_analysis').upsert(batch, { onConflict: ['job_id','property_composite_key'] });
      if (error) {
        console.error('Error upserting market analysis batch:', error);
        const msg = (error && error.message) ? error.message : JSON.stringify(error);
        throw new Error(`Upsert batch failed: ${msg}`);
      }
    }

    // Persist job-level map of applied codes into market_land_valuation for audit and global visibility
    try {
      const payload = {
        job_id: jobId,
        unit_rate_codes_applied: appliedCodesMap || {},
        unit_rate_last_run: {
          timestamp: new Date().toISOString(),
          selected_codes: selectedCodes || [],
          updated_count: updates.length
        },
        updated_at: new Date().toISOString()
      };
      const { error: mvError } = await supabase.from('market_land_valuation').upsert([payload], { onConflict: 'job_id' });
      if (mvError) {
        try {
          console.error('Failed to persist appliedCodesMap to market_land_valuation:', JSON.stringify(mvError));
        } catch (logErr) {
          console.error('Failed to persist appliedCodesMap to market_land_valuation (error object):', mvError);
        }

        // Attempt fallback: persist only summary info (smaller payload)
        try {
          const summaryPayload = {
            job_id: jobId,
            unit_rate_codes_applied: {},
            unit_rate_last_run: {
              timestamp: new Date().toISOString(),
              selected_codes: selectedCodes || [],
              updated_count: updates.length,
              acreage_set: updates.filter(u => u.market_manual_lot_acre !== null).length,
              acreage_null: updates.filter(u => u.market_manual_lot_acre === null).length
            },
            updated_at: new Date().toISOString()
          };
          const { error: mvError2 } = await supabase.from('market_land_valuation').upsert([summaryPayload], { onConflict: 'job_id' });
          if (mvError2) {
            try { console.error('Fallback upsert to market_land_valuation failed:', JSON.stringify(mvError2)); } catch(e2) { console.error('Fallback upsert failed (object):', mvError2); }
          } else {
            console.warn('Persisted unit-rate run summary (fallback) to market_land_valuation');
          }
        } catch (fbErr) {
          console.error('Error during fallback persist to market_land_valuation:', fbErr);
        }
      }
    } catch (e) {
      console.error('Error writing appliedCodesMap to market_land_valuation:', e);
    }

    return { updated: updates.length };

  } catch (error) {
    // Ensure we surface a readable error message to callers/UI
    console.error('runUnitRateLotCalculation error:', error);
    const msg = (error && error.message) ? error.message : JSON.stringify(error);
    throw new Error(msg);
  }
}

// ===== UNIT RATE LOT CALCULATION (v2) =====
export async function runUnitRateLotCalculation_v2(jobId, selectedCodes = [], options = {}) {
  if (!jobId) throw new Error('jobId required');
  try {
    const rawDataForJob = await getRawDataForJob(jobId);
    if (!rawDataForJob) throw new Error('No source file parsed data available for this job');

    const codeDefinitions = rawDataForJob.vendorType === 'BRT' ? (rawDataForJob.codeDefinitions || rawDataForJob.parsed_code_definitions || null) : null;

    const vcsIdMap = new Map();
    if (codeDefinitions && codeDefinitions.sections && codeDefinitions.sections.VCS) {
      Object.keys(codeDefinitions.sections.VCS).forEach(vkey => {
        const entry = codeDefinitions.sections.VCS[vkey];
        const ids = new Set();
        ids.add(String(vkey));
        if (entry?.DATA?.VALUE) ids.add(String(entry.DATA.VALUE));
        if (entry?.DATA?.KEY) ids.add(String(entry.DATA.KEY));
        if (entry?.KEY) ids.add(String(entry.KEY));
        vcsIdMap.set(String(vkey), ids);
      });
    }

    // Build a propertyMap fallback if parsed map is empty
    let propertyMap = rawDataForJob.propertyMap instanceof Map ? rawDataForJob.propertyMap : new Map();

    // Determine whether to treat an empty selectedCodes as an explicit selection (i.e. use saved job config even if empty)
    const treatEmptyAsExplicit = !!options.useJobConfig;

    // Helper to decide if selection filtering should be applied for a given property
    const shouldApplySelection = (selCodes) => {
      if (treatEmptyAsExplicit) return true; // use provided selCodes even if empty
      return Array.isArray(selCodes) && selCodes.length > 0;
    };

    if ((!propertyMap || propertyMap.size === 0)) {
      // fetch raw content directly
      const { data: job, error: jobErr } = await supabase
        .from('jobs')
        .select('raw_file_content, ccdd_code, start_date')
        .eq('id', jobId)
        .single();

      if (!jobErr && job?.raw_file_content) {
        const lines = job.raw_file_content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const headers = parseCSVLine(lines[0]).map(h => String(h || '').trim());
          const map = new Map();
          const yearCreated = job.start_date ? new Date(job.start_date).getFullYear() : (new Date()).getFullYear();
          const ccddCode = job.ccdd_code || '';

          for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length !== headers.length) continue;
            const rec = {};
            headers.forEach((h, idx) => {
              const key = (h || `F${idx+1}`).toString().trim();
              rec[key] = values[idx] !== undefined ? values[idx] : null;
            });

            let compositeKey = null;
            try { compositeKey = generateCompositeKeyFromRecord(rec, rawDataForJob.vendorType || 'BRT', yearCreated, ccddCode); } catch (e) { compositeKey = null; }
            if (!compositeKey) {
              const f1 = (values[0] || '').toString().replace(/[^0-9A-Za-z\.\-_ ]/g, '').trim();
              const f2 = (values[1] || '').toString().replace(/[^0-9A-Za-z\.\-_ ]/g, '').trim();
              const f3 = (values[2] || '').toString().replace(/[^0-9A-Za-z\.\-_ ]/g, '').trim();
              const f4 = (values[3] || '').toString().replace(/[^0-9A-Za-z\.\-_ ]/g, '').trim();
              const addr = (values[6] || '').toString().replace(/["\n\r]/g, '').trim() || 'NONE';
              compositeKey = `${yearCreated}${ccddCode}-${f1}-${f2}_${f3}-${f4}-${addr}`;
            }
            map.set(compositeKey, rec);
          }

          if (map.size > 0) propertyMap = map;
        }
      }
    }

    const updates = [];
    const appliedCodesMap = {};
    const stats = { totalParsed: 0, acreageSet: 0, sampledNullKeys: [] };

    for (const [compositeKey, rawRecord] of propertyMap.entries()) {
  
      stats.totalParsed++;
      let totalAcres = 0; let totalSf = 0;

      const propVcsRaw = rawRecord.VCS || rawRecord.vcs || rawRecord.property_vcs || rawRecord.VCS_CODE || rawRecord.vcs_code || null;
      const propVcs = propVcsRaw ? String(propVcsRaw).trim() : null;

      // First, attempt authoritative LANDUR/LANDURUNITS header-mapped extraction
      for (let i = 1; i <= 6; i++) {
        const landKeys = [`LANDUR_${i}`, `LANDUR${i}`, `LANDUR ${i}`];
        const unitKeys = [`LANDURUNITS_${i}`, `LANDURUNITS${i}`, `LANDURUNITS ${i}`];
        let landCode = null; let landUnitsRaw = null;
        for (const k of landKeys) { if (rawRecord[k] !== undefined) { landCode = rawRecord[k]; break; } }
        for (const k of unitKeys) { if (rawRecord[k] !== undefined) { landUnitsRaw = rawRecord[k]; break; } }

        // Normalize and parse units (allow decimals, commas, currency)
        const units = landUnitsRaw !== undefined && landUnitsRaw !== null ? parseFloat(String(landUnitsRaw).replace(/[,$\s\"]/g, '')) : NaN;
        if (isNaN(units) || units <= 0) continue;

        // Normalize land code (digits only, pad to 2)
        const codeStr = landCode !== undefined && landCode !== null ? String(landCode).replace(/[^0-9]/g, '').padStart(2, '0') : '';

        // If user provided selectedCodes (or we are using job-level config), treat them as an INCLUSION list: only include matching codes
        if (shouldApplySelection(selectedCodes)) {
          if (!landCode) continue;
          const isIncluded = selectedCodes.some(scRaw => {
            const sc = String(scRaw).trim();
            if (sc.includes('::')) {
              const [vcsKeySel, codeSel] = sc.split('::').map(s => s.trim());
              if (!codeSel) return false;
              const codeMatches = codeSel === codeStr || codeSel.padStart(2, '0') === codeStr.padStart(2, '0');
              if (!codeMatches) return false;
              const idSet = vcsIdMap.get(String(vcsKeySel));
              if (!idSet) return propVcs && (String(propVcs) === String(vcsKeySel) || String(propVcs).padStart(2,'0') === String(vcsKeySel).padStart(2,'0'));
              if (!propVcs) return false;
              return Array.from(idSet).some(id => String(id).trim() === String(propVcs).trim());
            } else {
              return sc === codeStr || sc.padStart(2, '0') === codeStr.padStart(2, '0');
            }
          });
          if (!isIncluded) continue;
        }

        if (units >= 1000) totalSf += units; else totalAcres += units;
      }

      // If no units from LANDUR_* fields, attempt positional scan for code/unit pairs (BRT fixed layout)

      // If no units from LANDUR_* fields, attempt positional scan for code/unit pairs (BRT fixed layout)
      if (totalAcres === 0 && totalSf === 0) {
        try {
          const orderedValues = Object.keys(rawRecord).map(k => rawRecord[k]);
          for (let idx = 0; idx < orderedValues.length - 1; idx++) {
            const codeCand = orderedValues[idx];
            const unitsCand = orderedValues[idx + 1];
            if (codeCand === undefined || unitsCand === undefined) continue;
            const codeStrRaw = String(codeCand || '').replace(/[^0-9]/g, '');
            const unitsStrRaw = String(unitsCand || '').replace(/[^0-9\.\,]/g, '');
            if (!/^[0-9]{1,2}$/.test(codeStrRaw)) continue;
            const codeNumStr = codeStrRaw.padStart(2, '0');
            const unitsNum = parseFloat(unitsStrRaw.replace(/,/g, ''));
            if (isNaN(unitsNum) || unitsNum <= 0) continue;

            // Treat selectedCodes as INCLUSION list for positional codes as well
            let isIncludedPos = true;
            if (shouldApplySelection(selectedCodes)) {
              isIncludedPos = selectedCodes.some(scRaw => {
                const sc = String(scRaw).trim();
                if (sc.includes('::')) {
                  const [vcsKeySel, codeSel] = sc.split('::').map(s => s.trim());
                  if (!codeSel) return false;
                  const codeMatches = codeSel === codeNumStr || codeSel.padStart(2, '0') === codeNumStr;
                  if (!codeMatches) return false;
                  const idSet = vcsIdMap.get(String(vcsKeySel));
                  if (!idSet) return propVcs && (String(propVcs) === String(vcsKeySel) || String(propVcs).padStart(2, '0') === String(vcsKeySel).padStart(2, '0'));
                  if (!propVcs) return false;
                  return Array.from(idSet).some(id => String(id).trim() === String(propVcs).trim());
                } else {
                  return sc === codeNumStr || sc.padStart(2, '0') === codeNumStr;
                }
              });
            }

            if (!isIncludedPos) continue;

            if (unitsNum >= 1000) totalSf += unitsNum; else totalAcres += unitsNum;
          }
        } catch (e) {
          // ignore positional fallback errors
        }
      }

      // No free-text ACRE fallback — only LANDUR/LANDURUNITS and positional numeric code/unit pairs are used for BRT

      const acres = totalAcres + (totalSf / 43560);
      const recordAcre = acres > 0 ? parseFloat(acres.toFixed(2)) : null;
      if (recordAcre !== null) stats.acreageSet++; else { if (stats.sampledNullKeys.length < 20) stats.sampledNullKeys.push(compositeKey); }
      const recordSf = recordAcre !== null ? Math.round(recordAcre * 43560) : null;

      updates.push({ job_id: jobId, property_composite_key: compositeKey, market_manual_lot_acre: recordAcre, market_manual_lot_sf: recordSf });
      appliedCodesMap[compositeKey] = selectedCodes || [];
    }

    // Upsert in batches
    const batchSize = 200;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const { error } = await supabase.from('property_market_analysis').upsert(batch, { onConflict: ['job_id','property_composite_key'] });
      if (error) {
        console.error('Error upserting market analysis batch (v2):', error);
        const msg = (error && error.message) ? error.message : JSON.stringify(error);
        throw new Error(`Upsert batch failed: ${msg}`);
      }
    }

    // Persist job-level summary into jobs table instead of market_land_valuation
    try {
      const jobPayload = {
        unit_rate_codes_applied: appliedCodesMap || {},
        unit_rate_last_run: {
          timestamp: new Date().toISOString(),
          selected_codes: selectedCodes || [],
          updated_count: updates.length,
          acreage_set: updates.filter(u => u.market_manual_lot_acre !== null).length,
          acreage_null: updates.filter(u => u.market_manual_lot_acre === null).length
        },
        updated_at: new Date().toISOString()
      };
      const { error: jobUpdateErr } = await supabase.from('jobs').update(jobPayload).eq('id', jobId);
      if (jobUpdateErr) {
        try { console.warn('Failed to persist appliedCodesMap summary to jobs table:', JSON.stringify(jobUpdateErr)); } catch (logErr) { console.warn('Failed to persist appliedCodesMap summary to jobs table (object):', jobUpdateErr); }
      }
    } catch (e) {
      console.warn('Error writing appliedCodesMap summary to jobs table:', e);
    }

    return { updated: updates.length, acreage_set: stats.acreageSet, acreage_null: updates.length - stats.acreageSet, sample_null_keys: stats.sampledNullKeys };

  } catch (error) {
    console.error('runUnitRateLotCalculation_v2 error:', error);
    const msg = (error && error.message) ? error.message : JSON.stringify(error);
    throw new Error(msg);
  }
}

// ===== EMPLOYEE MANAGEMENT SERVICES =====
// Generate lot sizes for entire job using mappings stored in unit_rate_config (streamlined)
export async function generateLotSizesForJob(jobId) {
  if (!jobId) throw new Error('jobId required');

  // Get job data with parsed code definitions
  const { data: jobRow, error: jobErr } = await supabase
    .from('jobs')
    .select('unit_rate_config, parsed_code_definitions, vendor_type')
    .eq('id', jobId)
    .single();

  if (jobErr || !jobRow) throw new Error('Job not found');

  // Get current file version to only process latest records
  const { data: versionData, error: versionErr } = await supabase
    .from('property_records')
    .select('file_version')
    .eq('job_id', jobId)
    .order('file_version', { ascending: false })
    .limit(1)
    .single();

  const currentFileVersion = versionData?.file_version || 1;
  console.log(`📊 Processing lot sizes for file_version ${currentFileVersion} only`);

  const mappings = jobRow.unit_rate_config;
  const codeDefinitions = jobRow.parsed_code_definitions;
  const vendorType = jobRow.vendor_type;

  if (!mappings) throw new Error('No unit rate mappings found');

  // Helper function to parse composite key and extract card
  const parseCompositeKey = (compositeKey) => {
    if (!compositeKey) return { card: '' };
    // Format: YEAR+CCDD-BLOCK-LOT_QUALIFIER-CARD-LOCATION
    const parts = compositeKey.split('-');
    return {
      card: parts[3] === 'NONE' ? '' : parts[3] || ''
    };
  };

  // Determine valid main cards based on vendor type
  const isMainCard = (card) => {
    const cardUpper = String(card || '').toUpperCase();
    if (vendorType === 'Microsystems') {
      return cardUpper === 'M' || cardUpper === '';
    } else {
      // BRT or default
      return cardUpper === '1' || cardUpper === '';
    }
  };

  // Build VCS name-to-key lookup
  const vcsNameToKey = new Map();
  if (codeDefinitions?.sections?.VCS) {
    Object.keys(codeDefinitions.sections.VCS).forEach(vkey => {
      const entry = codeDefinitions.sections.VCS[vkey];
      const vcsName = entry?.DATA?.KEY || entry?.KEY;
      if (vcsName) {
        vcsNameToKey.set(String(vcsName).trim(), String(vkey));
      }
    });
  }

  // Get properties with LANDUR fields and VCS - use batch loading to handle >5000 records
  const BATCH_SIZE = 1000;
  let allProps = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error: propsErr } = await supabase
      .from('property_records')
      .select(`
        property_composite_key,
        property_vcs,
        landur_1, landurunits_1,
        landur_2, landurunits_2,
        landur_3, landurunits_3,
        landur_4, landurunits_4,
        landur_5, landurunits_5,
        landur_6, landurunits_6,
        property_market_analysis(new_vcs)
      `)
      .eq('job_id', jobId)
      .eq('file_version', currentFileVersion)
      .order('property_composite_key')
      .range(offset, offset + BATCH_SIZE - 1);

    if (propsErr) throw propsErr;

    if (batch && batch.length > 0) {
      allProps = allProps.concat(batch);
      offset += BATCH_SIZE;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  const props = allProps;

  // Properties loaded successfully

  const updates = [];
  const diagnostics = {
    totalProperties: props.length,
    processed: 0,
    skipped: 0,
    noVcsMapping: 0,
    noLandurData: 0,
    allCodesExcluded: 0,
    unmappedCodes: new Set(),
    vcsSummary: {}
  };

  // Ready to process properties

  for (const p of props) {
    // Filter: only process main cards (card 1 for BRT, card M for Microsystems)
    const parsed = parseCompositeKey(p.property_composite_key);
    if (!isMainCard(parsed.card)) {
      diagnostics.skipped++;
      continue;
    }
    // Prefer new_vcs from property_market_analysis over property_vcs
    // Handle both object and array returns from Supabase JOIN
    let newVcs = null;
    if (Array.isArray(p.property_market_analysis)) {
      newVcs = p.property_market_analysis[0]?.new_vcs;
    } else {
      newVcs = p.property_market_analysis?.new_vcs;
    }

    const rawVcs = newVcs || p.property_vcs;
    let vcs = rawVcs ? String(rawVcs).trim().replace(/^0+/, '') : null;

    // Try to resolve VCS name to numeric key
    let mapForVcs = null;

    // Direct numeric match
    if (vcs && mappings[vcs]) {
      mapForVcs = mappings[vcs];
    }
    // VCS name lookup
    else if (vcs && vcsNameToKey.has(vcs)) {
      const numericKey = vcsNameToKey.get(vcs);
      if (mappings[numericKey]) {
        mapForVcs = mappings[numericKey];
      }
    }

    if (!mapForVcs) {
      diagnostics.skipped++;
      diagnostics.noVcsMapping++;
      continue; // Skip if no mapping found
    }

    let totalAcres = 0;
    let totalSf = 0;
    let hasAnyLandurData = false;
    let processedAnyCodes = false;

    // Process LANDUR codes 1-6
    for (let i = 1; i <= 6; i++) {
      const code = p[`landur_${i}`];
      const units = p[`landurunits_${i}`];

      if (!code || units === null || units === undefined) continue;

      hasAnyLandurData = true;
      const codeStr = String(code).padStart(2, '0');

      // Check mapping
      if (Array.isArray(mapForVcs.exclude) && mapForVcs.exclude.includes(codeStr)) {
        continue; // Skip excluded codes
      }

      if (Array.isArray(mapForVcs.acre) && mapForVcs.acre.includes(codeStr)) {
        totalAcres += Number(units) || 0;
        processedAnyCodes = true;
        continue;
      }

      if (Array.isArray(mapForVcs.sf) && mapForVcs.sf.includes(codeStr)) {
        totalSf += Number(units) || 0;
        processedAnyCodes = true;
        continue;
      }

      // Code not in any bucket - track as unmapped
      diagnostics.unmappedCodes.add(`${vcs}::${codeStr}`);
    }

    // Track diagnostics
    if (!hasAnyLandurData) {
      diagnostics.skipped++;
      diagnostics.noLandurData++;
      continue;
    }

    if (!processedAnyCodes) {
      diagnostics.skipped++;
      diagnostics.allCodesExcluded++;
      continue;
    }

    // Calculate final values - PRESERVE ORIGINAL SF WHEN POSSIBLE
    let finalAcres;
    let finalSf;

    if (totalAcres > 0 && totalSf > 0) {
      // Mixed: have both acres and SF - must convert
      finalAcres = parseFloat((totalAcres + (totalSf / 43560)).toFixed(2));
      finalSf = Math.round(finalAcres * 43560);
    } else if (totalAcres > 0) {
      // Only acres - convert to SF
      finalAcres = parseFloat(totalAcres.toFixed(2));
      finalSf = Math.round(totalAcres * 43560);
    } else if (totalSf > 0) {
      // Only SF - PRESERVE ORIGINAL SF, calculate acres from it
      finalSf = totalSf;
      finalAcres = parseFloat((totalSf / 43560).toFixed(2));
    } else {
      // No data
      finalAcres = null;
      finalSf = null;
    }

    updates.push({
      job_id: jobId,
      property_composite_key: p.property_composite_key,
      market_manual_lot_acre: finalAcres,
      market_manual_lot_sf: finalSf,
      updated_at: new Date().toISOString()
    });

    diagnostics.processed++;

    // Track VCS summary
    if (!diagnostics.vcsSummary[vcs]) {
      diagnostics.vcsSummary[vcs] = { processed: 0, totalSf: 0, totalAcres: 0 };
    }
    diagnostics.vcsSummary[vcs].processed++;
    if (finalSf) diagnostics.vcsSummary[vcs].totalSf += finalSf;
    if (finalAcres) diagnostics.vcsSummary[vcs].totalAcres += finalAcres;
  }

  // Summary only in diagnostics return object, not logged

  // Batch upsert
  const batchSize = 500;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const { error } = await supabase
      .from('property_market_analysis')
      .upsert(batch, { onConflict: ['job_id','property_composite_key'] });
    if (error) throw error;
  }

  return {
    job_id: jobId,
    updated: updates.length,
    diagnostics: {
      totalProperties: diagnostics.totalProperties,
      processed: diagnostics.processed,
      skipped: diagnostics.skipped,
      noVcsMapping: diagnostics.noVcsMapping,
      noLandurData: diagnostics.noLandurData,
      allCodesExcluded: diagnostics.allCodesExcluded,
      unmappedCodes: Array.from(diagnostics.unmappedCodes),
      vcsSummary: diagnostics.vcsSummary
    }
  };
}

// Save unit rate mappings (merge into existing mappings)
export async function saveUnitRateMappings(jobId, vcsKey, mappingObj) {
  if (!jobId) throw new Error('jobId required');
  if (!vcsKey) throw new Error('vcsKey required');

  // Merge mapping into jobs.unit_rate_codes_applied.mappings (do not use market_land_valuation)
  const { data: jobRow, error: jobErr } = await supabase.from('jobs').select('unit_rate_codes_applied').eq('id', jobId).single();
  let payloadObj = { mappings: {} };
  if (!jobErr && jobRow && jobRow.unit_rate_codes_applied) {
    try { payloadObj = typeof jobRow.unit_rate_codes_applied === 'string' ? JSON.parse(jobRow.unit_rate_codes_applied) : jobRow.unit_rate_codes_applied; } catch(e) { payloadObj = { mappings: {} }; }
  }

  payloadObj.mappings = payloadObj.mappings || {};
  // normalize codes to 2-digit strings
  const normalizeArr = (arr) => Array.isArray(arr) ? arr.map(c => String(c).replace(/[^0-9]/g,'').padStart(2,'0')) : [];
  payloadObj.mappings[vcsKey] = {
    acre: normalizeArr(mappingObj.acre),
    sf: normalizeArr(mappingObj.sf),
    exclude: normalizeArr(mappingObj.exclude)
  };

  const jobPayload = { unit_rate_codes_applied: payloadObj, unit_rate_last_run: { timestamp: new Date().toISOString() }, updated_at: new Date().toISOString() };
  const persistResult = await persistUnitRateRunSummary(jobId, jobPayload);
  if (!persistResult.updated) {
    throw persistResult.error || new Error('Failed to persist unit rate mappings summary');
  }
  return { ok: true };
}

export const employeeService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('last_name');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      return null;
    }
  },

  async create(employee) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert([employee])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkImport(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .insert(employees)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee service error:', error);
      throw error;
    }
  },

  async bulkUpsert(employees) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .upsert(employees, { 
          onConflict: 'email',
          ignoreDuplicates: false 
        })
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Employee bulk upsert error:', error);
      throw error;
    }
  },

  async bulkUpdate(employees) {
    try {
      const updates = await Promise.all(
        employees.map(emp => 
          supabase
            .from('employees')
            .update(emp)
            .eq('id', emp.id)
            .select()
        )
      );
      
      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Employee bulk update error:', error);
      throw error;
    }
  },

  async getManagers() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .in('role', ['Management', 'Owner'])
        .order('last_name');
      
      if (error) throw error;
      
      // Hard-code admin capabilities for the three admins
      const managersWithAdminRoles = data.map(emp => {
        const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
        
        const isAdmin = emp.role === 'Owner' || 
                       fullName.includes('tom davis') || 
                       fullName.includes('brian schneider') || 
                       fullName.includes('james duda');
        
        return {
          ...emp,
          can_be_lead: true,
          is_admin: isAdmin,
          effective_role: 'admin'
        };
      });
      
      return managersWithAdminRoles;
    } catch (error) {
      console.error('Manager service error:', error);
      return this.getAll();
    }
  }
};

// ===== JOB MANAGEMENT SERVICES =====
export const jobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          *,
          job_assignments (
            id,
            role,
            employee:employees!job_assignments_employee_id_fkey (
              id,
              first_name,
              last_name,
              email,
              region
            )
          )
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(job => ({
        id: job.id,
        name: job.job_name,
        ccddCode: job.ccdd_code,
        ccdd: job.ccdd_code, // ADDED: Alternative accessor for backward compatibility
        municipality: job.municipality || job.client_name,
        job_number: job.job_number,
        year_created: job.start_date ? new Date(job.start_date).getFullYear() : new Date().getFullYear(),
        county: job.county,
        state: job.state,
        vendor: job.vendor_type,
        status: job.status,
        createdDate: job.start_date,
        dueDate: job.end_date || job.target_completion_date,
        totalProperties: job.total_properties || 0,
        
        // ✅ FIXED: Added missing residential/commercial totals from database
        totalresidential: job.totalresidential || 0,
        totalcommercial: job.totalcommercial || 0,
        
        // inspectedProperties: job.inspected_properties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live analytics
        sourceFileStatus: job.source_file_status || 'pending',
        codeFileStatus: job.code_file_status || 'pending',
        vendorDetection: job.vendor_detection,
        workflowStats: job.workflow_stats,
        percent_billed: job.percent_billed,  // FIXED: was percentBilling, now percent_billed
        
        // ADDED: Property assignment tracking for enhanced metrics
        has_property_assignments: job.has_property_assignments || false,
        assigned_has_commercial: job.assigned_has_commercial || false,
        assignedPropertyCount: job.assigned_property_count || 0,
        
        // ADDED: File timestamp tracking for FileUploadButton
        created_at: job.created_at,
        source_file_uploaded_at: job.source_file_uploaded_at,
        code_file_uploaded_at: job.code_file_uploaded_at,
        updated_at: job.updated_at,
        
        // ADDED: File version tracking
        source_file_version: job.source_file_version || 1,
        code_file_version: job.code_file_version || 1,
        
        assignedManagers: job.job_assignments?.map(ja => ({
          id: ja.employee.id,
          name: `${ja.employee.first_name} ${ja.employee.last_name}`,
          role: ja.role,
          email: ja.employee.email,
          region: ja.employee.region
        })) || []
      }));
    } catch (error) {
      console.error('Jobs service error:', error);
      return [];
    }
  },

  async create(jobData) {
    try {
      const { assignedManagers, ...componentFields } = jobData;
      
      const dbFields = {
        job_name: componentFields.name,
        client_name: componentFields.municipality,
        ccdd_code: componentFields.ccdd,
        municipality: componentFields.municipality,
        county: componentFields.county,
        state: componentFields.state || 'NJ',
        vendor_type: componentFields.vendor,
        status: componentFields.status || 'draft',
        start_date: componentFields.createdDate || new Date().toISOString().split('T')[0],
        end_date: componentFields.dueDate,
        target_completion_date: componentFields.dueDate,
        total_properties: componentFields.totalProperties || 0,
        // inspected_properties: componentFields.inspectedProperties || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table, now using live App.js analytics
        source_file_status: componentFields.sourceFileStatus || 'pending',
        code_file_status: componentFields.codeFileStatus || 'pending',
        vendor_detection: componentFields.vendorDetection,
        workflow_stats: componentFields.workflowStats,
        percent_billed: componentFields.percentBilled || 0,
        
        // ADDED: File version tracking
        source_file_version: componentFields.source_file_version || 1,
        code_file_version: componentFields.code_file_version || 1,
        
        // ADDED: File tracking fields for FileUploadButton
        source_file_name: componentFields.source_file_name,
        source_file_version_id: componentFields.source_file_version_id,
        source_file_uploaded_at: componentFields.source_file_uploaded_at,
        
        created_by: componentFields.created_by || componentFields.createdBy
      };
      
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (jobError) throw jobError;

      if (assignedManagers && assignedManagers.length > 0) {
        const assignments = assignedManagers.map(manager => ({
          job_id: job.id,
          employee_id: manager.id,
          role: manager.role,
          assigned_by: dbFields.created_by,
          assigned_date: new Date().toISOString().split('T')[0],
          is_active: true
        }));

        const { error: assignError } = await supabase
          .from('job_assignments')
          .insert(assignments);
        
        if (assignError) {
          console.error('Manager assignment error:', assignError);
        }
      }

      return job;
    } catch (error) {
      console.error('Job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { assignedManagers, ...componentFields } = updates;
      
      
      const dbFields = {};
      
      // Map component fields to database fields
      if (componentFields.name) dbFields.job_name = componentFields.name;
      if (componentFields.municipality) dbFields.municipality = componentFields.municipality;
      if (componentFields.ccdd) dbFields.ccdd_code = componentFields.ccdd;
      if (componentFields.county) dbFields.county = componentFields.county;
      if (componentFields.state) dbFields.state = componentFields.state;
      if (componentFields.vendor) dbFields.vendor_type = componentFields.vendor;
      if (componentFields.status) dbFields.status = componentFields.status;
      if (componentFields.dueDate) {
        dbFields.end_date = componentFields.dueDate;
        dbFields.target_completion_date = componentFields.dueDate;
      }
      if (componentFields.totalProperties !== undefined) dbFields.total_properties = componentFields.totalProperties;
      // if (componentFields.inspectedProperties !== undefined) dbFields.inspected_properties = componentFields.inspectedProperties;  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
      if (componentFields.sourceFileStatus) dbFields.source_file_status = componentFields.sourceFileStatus;
      if (componentFields.codeFileStatus) dbFields.code_file_status = componentFields.codeFileStatus;
      if (componentFields.vendorDetection) dbFields.vendor_detection = componentFields.vendorDetection;
      if (componentFields.workflowStats) dbFields.workflow_stats = componentFields.workflowStats;
      
      // FIXED PERCENT BILLED MAPPING WITH DEBUG
      if (componentFields.percent_billed !== undefined) {
        dbFields.percent_billed = componentFields.percent_billed;
      } else {
      }

      // File version and upload timestamp mappings (MISSING - causing code version update to fail!)
      if (componentFields.source_file_version !== undefined) dbFields.source_file_version = componentFields.source_file_version;
      if (componentFields.code_file_version !== undefined) dbFields.code_file_version = componentFields.code_file_version;
      if (componentFields.source_file_uploaded_at) dbFields.source_file_uploaded_at = componentFields.source_file_uploaded_at;
      if (componentFields.code_file_uploaded_at) dbFields.code_file_uploaded_at = componentFields.code_file_uploaded_at;


      const { data, error } = await supabase
       .from('jobs')
       .update({
         ...dbFields,
         updated_at: new Date().toISOString()
       })
       .eq('id', id)
       .select()
       .single();
      
      if (error) {
        console.error('❌ Job update error:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Job update error:', error);
      throw error;
    }
  },

  // ENHANCED: Delete method with proper cascade deletion
  async delete(id) {
    try {

      // Step 1: Delete related comparison_reports first
      const { error: reportsError } = await supabase
        .from('comparison_reports')
        .delete()
        .eq('job_id', id);
      
      if (reportsError) {
        console.error('Error deleting comparison reports:', reportsError);
        // Don't throw here - continue with job deletion even if no reports exist
      } else {
      }

      // Step 2: Delete related property_change_log records (commented out - table doesn't exist)
      // const { error: changeLogError } = await supabase
      //   .from('property_change_log')
      //   .delete()
      //   .eq('job_id', id);
      // 
      // if (changeLogError) {
      //   console.error('Error deleting change log:', changeLogError);
      //   // Don't throw here - table might not exist or no records
      // } else {
      // }

      // Step 3: Delete related job_assignments
      const { error: assignmentsError } = await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', id);
      
      if (assignmentsError) {
        console.error('Error deleting job assignments:', assignmentsError);
      } else {
      }

      // Step 4: Delete related job_responsibilities (property assignments)
      const { error: responsibilitiesError } = await supabase
        .from('job_responsibilities')
        .delete()
        .eq('job_id', id);
      
      if (responsibilitiesError) {
        console.error('Error deleting job responsibilities:', responsibilitiesError);
      } else {
      }

      // Step 5: Delete related property_records
      const { error: propertyError } = await supabase
        .from('property_records')
        .delete()
        .eq('job_id', id);
      
      if (propertyError) {
        console.error('Error deleting property records:', propertyError);
      } else {
      }

      // Step 6: Delete related source_file_versions
      const { error: sourceFileError } = await supabase
        .from('source_file_versions')
        .delete()
        .eq('job_id', id);
      
      if (sourceFileError) {
        console.error('Error deleting source file versions:', sourceFileError);
      } else {
      }

      // Step 7: Finally delete the job itself
      const { error: jobError } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);
      
      if (jobError) {
        console.error('❌ FINAL ERROR - Failed to delete job:', jobError);
        throw jobError;
      }

      
    } catch (error) {
      console.error('Job deletion error:', error);
      throw error;
    }
  }
};

// ===== PLANNING JOB SERVICES =====
export const planningJobService = {
  async getAll() {
    try {
      const { data, error } = await supabase
        .from('planning_jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(pj => ({
        id: pj.id,
        ccddCode: pj.ccdd_code,
        ccdd: pj.ccdd_code, // Alternative accessor
        municipality: pj.municipality,
        end_date: pj.end_date,  // Use end_date instead
        comments: pj.comments
      }));
    } catch (error) {
      console.error('Planning jobs error:', error);
      return [];
    }
  },

  async create(planningJobData) {
    try {
      const dbFields = {
        ccdd_code: planningJobData.ccddCode || planningJobData.ccdd,
        municipality: planningJobData.municipality,
        end_date: planningJobData.end_date,
        comments: planningJobData.comments,
        created_by: planningJobData.created_by
      };
      
      const { data, error } = await supabase
        .from('planning_jobs')
        .insert([dbFields])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const dbFields = {
        ccdd_code: updates.ccddCode || updates.ccdd,
        municipality: updates.municipality,
        end_date: updates.end_date,
        comments: updates.comments
      };

      const { data, error } = await supabase
        .from('planning_jobs')
        .update(dbFields)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Planning job update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('planning_jobs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Planning job deletion error:', error);
      throw error;
    }
  }
};

// ===== CHECKLIST MANAGEMENT SERVICES =====
export const checklistService = {
  // Get all checklist items for a job
  async getChecklistItems(jobId) {
    try {
      console.log('📋 Loading checklist items for job:', jobId);
      
      const { data, error } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('job_id', jobId)
        .order('item_order');
      
      if (error) throw error;
      
      console.log(`�� Loaded ${data?.length || 0} checklist items`);
      return data || [];
    } catch (error) {
      console.error('Checklist items fetch error:', error);
      return [];
    }
  },

  // Update item status (completed, pending, etc.) for a specific job
  // Note: this upserts into checklist_item_status (per-job status table)
  async updateItemStatus(jobId, itemId, status, completedBy) {
    try {
      // Validate completedBy exists in employees (or users) table to avoid FK violations
      let validatedCompletedBy = null;
      if (status === 'completed' && completedBy) {
        try {
          const { data: emp } = await supabase.from('employees').select('id').eq('id', completedBy).maybeSingle();
          if (emp && emp.id) {
            validatedCompletedBy = completedBy;
          } else {
            // Try auth.users-like table (if present)
            try {
              const { data: usr } = await supabase.from('users').select('id').eq('id', completedBy).maybeSingle();
              if (usr && usr.id) validatedCompletedBy = completedBy;
            } catch (e) {
              // ignore
            }
          }
        } catch (e) {
          // ignore lookup errors and fall back to null
        }
      }

      const payload = {
        job_id: jobId,
        item_id: itemId,
        status: status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
        completed_by: validatedCompletedBy,
        updated_at: new Date().toISOString()
      };

      // First try an update for existing row
      try {
        const { data: updatedData, error: updateError } = await supabase
          .from('checklist_item_status')
          .update(payload)
          .match({ job_id: jobId, item_id: itemId })
          .select();

        if (!updateError && updatedData && updatedData.length > 0) {
          return updatedData[0];
        }
      } catch (e) {
        // ignore and try insert
      }

      // If update didn't find a row, insert a new one
      const { data: insertData, error: insertError } = await supabase
        .from('checklist_item_status')
        .insert(payload)
        .select();

      if (insertError) throw insertError;
      return Array.isArray(insertData) ? insertData[0] : insertData;
    } catch (error) {
      const msg = getErrorMessage(error);
      console.error('Checklist status update error:', msg, error);
      throw new Error(msg);
    }
  },

  // Update client approval for a checklist item (per-job)
  async updateClientApproval(jobId, itemId, approved, approvedBy) {
    try {
      const payload = {
        job_id: jobId,
        item_id: itemId,
        client_approved: approved,
        client_approved_date: approved ? new Date().toISOString() : null,
        client_approved_by: approved ? approvedBy : null,
        updated_at: new Date().toISOString()
      };

      // Try update first
      try {
        const { data: updatedData, error: updateError } = await supabase
          .from('checklist_item_status')
          .update(payload)
          .match({ job_id: jobId, item_id: itemId })
          .select();
        if (!updateError && updatedData && updatedData.length > 0) return updatedData[0];
      } catch (e) {
        // ignore
      }

      // Insert as fallback
      const { data: insertData, error: insertError } = await supabase
        .from('checklist_item_status')
        .insert(payload)
        .select();

      if (insertError) throw insertError;
      return Array.isArray(insertData) ? insertData[0] : insertData;
    } catch (error) {
      const msg = getErrorMessage(error);
      console.error('Client approval update error:', msg, error);
      throw new Error(msg);
    }
  },

  // Create initial checklist items for a new job
  async createChecklistForJob(jobId, checklistType = 'revaluation') {
    try {
      console.log('🔨 Creating checklist items for job:', jobId);
      
      // The 29 template items
      const templateItems = [
        // Setup Category (1-8)
        { item_order: 1, item_text: 'Contract Signed by Client', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 2, item_text: 'Contract Signed/Approved by State', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 3, item_text: 'Tax Maps Approved', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 4, item_text: 'Tax Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 5, item_text: 'Zoning Map Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 6, item_text: 'Zoning Bulk and Use Regulations Upload', category: 'setup', requires_client_approval: false, allows_file_upload: true },
        { item_order: 7, item_text: 'PPA Website Updated', category: 'setup', requires_client_approval: false, allows_file_upload: false },
        { item_order: 8, item_text: 'Data Collection Parameters', category: 'setup', requires_client_approval: true, allows_file_upload: false },
        
        // Inspection Category (9-14)
        { item_order: 9, item_text: 'Initial Mailing List', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_mailing_list' },
        { item_order: 10, item_text: 'Initial Letter and Brochure', category: 'inspection', requires_client_approval: false, allows_file_upload: true, special_action: 'generate_letter' },
        { item_order: 11, item_text: 'Initial Mailing Sent', category: 'inspection', requires_client_approval: false, allows_file_upload: false },
        { item_order: 12, item_text: 'First Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, auto_update_source: 'production_tracker' },
        { item_order: 13, item_text: 'Second Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_second_attempt_mailer' },
        { item_order: 14, item_text: 'Third Attempt Inspections', category: 'inspection', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_third_attempt_mailer' },
        
        // Analysis Category (15-26)
        { item_order: 15, item_text: 'Market Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: true },
        { item_order: 16, item_text: 'Page by Page Analysis', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 17, item_text: 'Lot Sizing Completed', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 18, item_text: 'Lot Sizing Questions Complete', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 19, item_text: 'VCS Reviewed/Reset', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 20, item_text: 'Land Value Tables Built', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 21, item_text: 'Land Values Entered', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 22, item_text: 'Economic Obsolescence Study', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 23, item_text: 'Cost Conversion Factor Set', category: 'analysis', requires_client_approval: true, allows_file_upload: false },
        { item_order: 24, item_text: 'Building Class Review/Updated', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 25, item_text: 'Effective Age Loaded/Set', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        { item_order: 26, item_text: 'Final Values Ready', category: 'analysis', requires_client_approval: false, allows_file_upload: false },
        
        // Completion Category (27-29)
        { item_order: 27, item_text: 'View Value Mailer', category: 'completion', requires_client_approval: false, allows_file_upload: true, special_action: 'view_impact_letter' },
        { item_order: 28, item_text: 'Generate Turnover Document', category: 'completion', requires_client_approval: false, allows_file_upload: false, special_action: 'generate_turnover_pdf' },
        { item_order: 29, item_text: 'Turnover Date', category: 'completion', requires_client_approval: false, allows_file_upload: false, input_type: 'date', special_action: 'archive_trigger' }
      ];

      // Add job_id and default status to each item
      const itemsToInsert = templateItems.map(item => ({
        ...item,
        job_id: jobId,
        status: 'pending',
        checklist_type: checklistType,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert)
        .select();
      
      if (error) throw error;
      
      console.log(`�� Created ${data.length} checklist items for job`);
      return data;
    } catch (error) {
      console.error('Checklist creation error:', error);
      throw error;
    }
  },

  // Update client/assessor name on job
  async updateClientName(jobId, clientName) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          client_name: clientName,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Updated client name:', clientName);
      return data;
    } catch (error) {
      console.error('Client name update error:', error);
      throw error;
    }
  },

  // Update assessor email on job
  async updateAssessorEmail(jobId, assessorEmail) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          assessor_email: assessorEmail,
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Updated assessor email:', assessorEmail);
      return data;
    } catch (error) {
      console.error('Assessor email update error:', error);
      throw error;
    }
  },

  // Upload file for checklist item
  async uploadFile(itemId, jobId, file, completedBy) {
    try {
      // Create unique file name
      const timestamp = Date.now();
      const fileName = `${jobId}/${itemId}_${timestamp}_${file.name}`;
      
      console.log('📤 Uploading file to storage:', fileName);
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('checklist-documents')
        .upload(fileName, file);
      
      if (uploadError) throw uploadError;
      
      console.log('💾 Saving file info to database...');
      
      // Save file info to checklist_documents table
      const { data: docData, error: docError } = await supabase
        .from('checklist_documents')
        .insert({
          checklist_item_id: itemId,
          job_id: jobId,
          file_name: file.name,
          file_path: fileName,
          file_size: file.size,
          uploaded_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (docError) throw docError;
      
      console.log('✅ Updating checklist item status...');
      
      // Update checklist item to completed status
      const { data: itemData, error: itemError } = await supabase
        .from('checklist_items')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: completedBy,
          file_attachment_path: fileName,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (itemError) throw itemError;
      
      console.log('✅ File uploaded successfully:', fileName);
      return itemData;
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  },

  // UPDATED: Generate mailing list with correct fields - NO FILTERING IN SUPABASE
  async generateMailingList(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select(`
          property_block, 
          property_lot, 
          property_location, 
          property_m4_class,
          property_facility,
          owner_name, 
          owner_street,
          owner_csz
        `)
        .eq('job_id', jobId)
        .order('property_block')
        .order('property_lot')
        .limit(1000);
      
      if (error) throw error;
      
      console.log(`�� Loaded ${data?.length || 0} properties for mailing list`);
      return data || [];
    } catch (error) {
      console.error('Mailing list generation error:', error);
      throw error;
    }
  },

  // NEW: Get inspection data with pagination for 2nd/3rd attempt mailers
  async getInspectionData(jobId, page = 1, pageSize = 100) {
    try {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await supabase
        .from('inspection_data')
        .select('*', { count: 'exact' })
        .eq('job_id', jobId)
        .order('property_block')
        .order('property_lot')
        .range(from, to);
      
      if (error) throw error;
      
      console.log(`✅ Loaded inspection data page ${page} with ${data?.length || 0} records (total: ${count})`);
      
      return {
        data: data || [],
        page,
        pageSize,
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
        hasMore: to < (count || 0) - 1
      };
    } catch (error) {
      console.error('Inspection data fetch error:', error);
      throw error;
    }
  },

  // Helper to get ALL inspection data (handles pagination automatically)
  async getAllInspectionData(jobId) {
    try {
      let allData = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await this.getInspectionData(jobId, page, 1000);
        allData = [...allData, ...result.data];
        hasMore = result.hasMore;
        page++;

        // Add timing gap between page loads to prevent database overload
        if (hasMore) {
          console.log(`⏳ Waiting 250ms before next page to prevent database overload...`);
          await new Promise(resolve => setTimeout(resolve, 250));
        }

        // Safety limit to prevent infinite loops
        if (page > 100) {
          console.warn('Reached pagination limit of 100 pages');
          break;
        }
      }

      console.log(`✅ Loaded total of ${allData.length} inspection records`);
      return allData;
    } catch (error) {
      console.error('Error fetching all inspection data:', error);
      throw error;
    }
  },

  // Update notes for a checklist item
  async updateItemNotes(itemId, notes) {
    try {
      const { data, error } = await supabase
        .from('checklist_items')
        .update({ 
          notes: notes,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Notes update error:', error);
      throw error;
    }
  },

  // Archive job when turnover date is set
  async archiveJob(jobId, turnoverDate) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ 
          status: 'archived',
          turnover_date: turnoverDate,
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', jobId)
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Job archived successfully');
      return data;
    } catch (error) {
      console.error('Job archive error:', error);
      throw error;
    }
  }
};

// ===== UNIFIED PROPERTY MANAGEMENT SERVICES =====
export const propertyService = {
  async getAll(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return [];
    }
  },

  async getById(id) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property service error:', error);
      return null;
    }
  },

  async create(propertyData) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert([propertyData])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property creation error:', error);
      throw error;
    }
  },

  async bulkCreate(propertyDataArray) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .insert(propertyDataArray)
        .select();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property bulk creation error:', error);
      throw error;
    }
  },

  async update(id, updates) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property update error:', error);
      throw error;
    }
  },

  async delete(id) {
    try {
      const { error } = await supabase
        .from('property_records')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Property deletion error:', error);
      throw error;
    }
  },

  // EXISTING: Import method with versionInfo parameter for FileUploadButton support - CALLS PROCESSORS (INSERT)
  async importCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    try {
      console.log(`🔄 Importing ${vendorType} data for job ${jobId}`);
      
      // Use updated processors for single-table insertion
      if (vendorType === 'BRT') {
        const { brtProcessor } = await import('./data-pipeline/brt-processor.js');
        return await brtProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsProcessor } = await import('./data-pipeline/microsystems-processor.js');
        return await microsystemsProcessor.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property import error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // ENHANCED: Update method with field preservation that calls UPDATERS (UPSERT) for existing jobs
  async updateCSVData(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, vendorType, versionInfo = {}) {
    // Clear any cached data for this job when updating
    dataCache.clear(`job_${jobId}`);
    dataCache.clear(`job_raw_data_${jobId}`);
    console.log(`🗑️ Cleared cache for job ${jobId} due to CSV update`);

    try {
      console.log(`🔄 Updating ${vendorType} data for job ${jobId} with field preservation`);
      
      // Store preserved fields handler in versionInfo for updaters to use
      versionInfo.preservedFieldsHandler = this.createPreservedFieldsHandler.bind(this);
      versionInfo.preservedFields = PRESERVED_FIELDS;

      // OPTIMIZED: Extract deletion list from versionInfo for targeted deletion
      const deletionsList = versionInfo.deletionsList || null;
      console.log(`🎯 DELETION OPTIMIZATION: ${deletionsList ? `Passing ${deletionsList.length} properties for targeted deletion` : 'No deletion list provided'}`);

      // Use updaters for UPSERT operations with optimized deletion
      if (vendorType === 'BRT') {
        const { brtUpdater } = await import('./data-pipeline/brt-updater.js');
        return await brtUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo, deletionsList);
      } else if (vendorType === 'Microsystems') {
        const { microsystemsUpdater } = await import('./data-pipeline/microsystems-updater.js');
        return await microsystemsUpdater.processFile(sourceFileContent, codeFileContent, jobId, yearCreated, ccddCode, versionInfo, deletionsList);
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Property update error:', error);
      return {
        processed: 0,
        errors: 1,
        warnings: [error.message]
      };
    }
  },

  // Helper method to create a preserved fields handler for the updaters
  async createPreservedFieldsHandler(jobId, compositeKeys) {
    const preservedDataMap = new Map();

    try {
      // Check if we have any preserved fields to fetch
      if (PRESERVED_FIELDS.length === 0) {
        return preservedDataMap;
      }

      console.log(`🔄 Preserving fields for ${compositeKeys.length} properties...`);

      // OPTIMIZED: Only one field, larger chunks, no delay
      const chunkSize = 1000;
      const totalChunks = Math.ceil(compositeKeys.length / chunkSize);

      for (let i = 0; i < compositeKeys.length; i += chunkSize) {
        const chunk = compositeKeys.slice(i, i + chunkSize);

        // OPTIMIZED: Fetch all properties for full update processing
        const { data: existingRecords, error } = await supabase
          .from('property_records')
          .select('property_composite_key, is_assigned_property')
          .eq('job_id', jobId)
          .in('property_composite_key', chunk);

        if (error) {
          console.error(`❌ Failed to fetch preserved fields for chunk:`, error.message);
          continue;
        }

        // Build preservation map
        existingRecords?.forEach(record => {
          const preserved = {};
          PRESERVED_FIELDS.forEach(field => {
            if (record[field] !== null && record[field] !== undefined) {
              preserved[field] = record[field];
            }
          });

          // Only add to map if there's data to preserve
          if (Object.keys(preserved).length > 0) {
            preservedDataMap.set(record.property_composite_key, preserved);
          }
        });
      }

      console.log(`✅ Preserved ${preservedDataMap.size} property assignments`);

    } catch (error) {
      console.error(`❌ Error in preserved fields handler:`, error.message);
    }

    return preservedDataMap;
  },

  // Query source file data for dynamic reporting
  async querySourceFileData(jobId, fieldName, value) {
    try {
      // Get all properties for the job
      const { data: properties, error } = await supabase
        .from('property_records')
        .select('id, job_id, property_composite_key')
        .eq('job_id', jobId);

      if (error) throw error;

      const rawData = await getRawDataForJob(jobId);
      if (!rawData) return [];

      // Filter properties based on source file data field value
      const matchingProperties = [];
      for (const property of properties) {
        const propertySourceData = rawData.propertyMap.get(property.property_composite_key);
        if (propertySourceData && propertySourceData[fieldName] === value) {
          // Get full property data
          const { data: fullProperty, error: propError } = await supabase
            .from('property_records')
            .select('*')
            .eq('id', property.id)
            .single();

          if (!propError && fullProperty) {
            matchingProperties.push(fullProperty);
          }
        }
      }

      return matchingProperties;
    } catch (error) {
      console.error('Property source file data query error:', error);
      return [];
    }
  },

  // Advanced filtering for analysis
  async getByCondition(jobId, condition) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .eq('condition_rating', condition)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property condition query error:', error);
      return [];
    }
  },

  // Get properties needing inspection
  async getPendingInspections(jobId) {
    try {
      const { data, error } = await supabase
        .from('property_records')
        .select('*')
        .eq('job_id', jobId)
        .is('inspection_info_by', null)
        .order('property_location');
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Property pending inspections query error:', error);
      return [];
    }
  },

  // Bulk update inspection data
  async bulkUpdateInspections(inspectionUpdates) {
    try {
      const updates = await Promise.all(
        inspectionUpdates.map(update =>
          supabase
            .from('property_records')
            .update({
              ...update.data,
              updated_at: new Date().toISOString()
            })
            .eq('id', update.id)
            .select()
        )
      );

      return updates.map(result => result.data).flat();
    } catch (error) {
      console.error('Property bulk inspection update error:', error);
      throw error;
    }
  },

  // NEW: Get raw file data for a specific property from jobs.raw_file_content
  async getRawDataForProperty(jobId, propertyCompositeKey) {
    try {
      // Try RPC first (if function exists)
      const { data, error } = await supabase.rpc('get_raw_data_for_property', {
        p_job_id: jobId,
        p_property_composite_key: propertyCompositeKey
      });

      if (error) {
        // RPC failed or not available — fall back silently to client-side parsing
        return await this.getRawDataForPropertyClientSide(jobId, propertyCompositeKey);
      }

      if (data) return data;

      // No RPC data — use client-side parsing
      return await this.getRawDataForPropertyClientSide(jobId, propertyCompositeKey);

    } catch (error) {
      // On unexpected errors, attempt client-side fallback and avoid noisy logging
      try {
        return await this.getRawDataForPropertyClientSide(jobId, propertyCompositeKey);
      } catch (e) {
        return null;
      }
    }
  },

  // Fallback: Client-side raw data parsing
  async getRawDataForPropertyClientSide(jobId, propertyCompositeKey) {
    const rawData = await getRawDataForJob(jobId);
    if (!rawData || !rawData.propertyMap) return null;

    const propertyRawData = rawData.propertyMap.get(propertyCompositeKey);
    if (propertyRawData) return propertyRawData;

    return null;
  },

  // Clear raw data cache for a specific job (called before quality checks to ensure fresh data)
  clearRawDataCache(jobId) {
    const cacheKey = `job_raw_data_${jobId}`;
    dataCache.clear(cacheKey);
    console.log(`🗑️ Cleared raw data cache for job ${jobId}`);
  },

  // NEW: Check if job needs reprocessing due to source file changes
  async checkJobReprocessingStatus(jobId) {
    try {
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('raw_file_content, raw_file_parsed_at, updated_at')
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;

      const { count: needsReprocessingCount, error: countError } = await supabase
        .from('property_records')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('validation_status', 'needs_reprocessing');

      if (countError) throw countError;

      return {
        hasSourceFile: !!job.raw_file_content,
        sourceFileParsedAt: job.raw_file_parsed_at,
        lastUpdated: job.updated_at,
        recordsNeedingReprocessing: needsReprocessingCount || 0,
        needsReprocessing: (needsReprocessingCount || 0) > 0
      };
    } catch (error) {
      console.error('Error checking job reprocessing status:', getErrorMessage(error));
      console.error('Error details:', error);
      return {
        hasSourceFile: false,
        recordsNeedingReprocessing: 0,
        needsReprocessing: false,
        error: getErrorMessage(error)
      };
    }
  },

  // NEW: Trigger reprocessing of property records from source file
  async triggerJobReprocessing(jobId, force = false) {
    try {
      const { data, error } = await supabase.rpc('app_reprocess_job_from_source', {
        p_job_id: jobId,
        p_force: force
      });

      if (error) throw error;

      console.log('✅ Job reprocessing triggered:', data);
      return data;
    } catch (error) {
      console.error('Error triggering job reprocessing:', getErrorMessage(error));
      console.error('Error details:', error);
      throw error;
    }
  },

  // NEW: Manually reprocess property records using current processors
  async manualReprocessFromSource(jobId) {
    try {
      // First, get the job details and source file content
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError) throw jobError;

      if (!job.raw_file_content) {
        throw new Error('No raw file content available for reprocessing');
      }

      console.log('���� Starting automatic reprocessing from stored source file...');

      // CRITICAL: Get the current file_version to avoid interfering with FileUploadButton versioning
      const { data: currentVersionData, error: versionError } = await supabase
        .from('property_records')
        .select('file_version')
        .eq('job_id', jobId)
        .limit(1)
        .single();

      let currentVersion = 1;
      if (currentVersionData && !versionError) {
        currentVersion = currentVersionData.file_version || 1;
      }

      console.log(`📊 Using existing file_version ${currentVersion} for automatic sync (no increment)`);

      // Determine vendor type and call appropriate updater
      const vendorType = job.vendor_source;

      if (vendorType === 'BRT') {
        const { brtUpdater } = await import('./data-pipeline/brt-updater.js');
        return await brtUpdater.processFile(
          job.raw_file_content,
          job.code_file_content,
          jobId,
          job.year_created,
          job.ccdd_code,
          {
            source_file_name: 'Auto-sync from stored source',
            file_version: currentVersion, // FIXED: Use current version, don't increment
            preservedFieldsHandler: this.createPreservedFieldsHandler.bind(this),
            preservedFields: PRESERVED_FIELDS,
            is_automatic_sync: true // Mark as automatic sync
          }
        );
      } else if (vendorType === 'Microsystems') {
        const { microsystemsUpdater } = await import('./data-pipeline/microsystems-updater.js');
        return await microsystemsUpdater.processFile(
          job.raw_file_content,
          job.code_file_content,
          jobId,
          job.year_created,
          job.ccdd_code,
          {
            source_file_name: 'Auto-sync from stored source',
            file_version: currentVersion, // FIXED: Use current version, don't increment
            preservedFieldsHandler: this.createPreservedFieldsHandler.bind(this),
            preservedFields: PRESERVED_FIELDS,
            is_automatic_sync: true // Mark as automatic sync
          }
        );
      } else {
        throw new Error(`Unsupported vendor type: ${vendorType}`);
      }
    } catch (error) {
      console.error('Automatic reprocessing failed:', getErrorMessage(error));
      console.error('Error details:', error);
      throw error;
    }
  }
};

// ===== SOURCE FILE SERVICES =====
export const sourceFileService = {
  async createVersion(jobId, fileName, fileSize, uploadedBy) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .insert([{
          job_id: jobId,
          file_name: fileName,
          file_size: fileSize,
          status: 'pending',
          uploaded_by: uploadedBy
        }])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file creation error:', error);
      return {
        id: Date.now(),
        version_number: 1,
        file_name: fileName,
        status: 'pending'
      };
    }
  },

  async getVersions(jobId) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file versions error:', error);
      return [];
    }
  },

  async updateStatus(id, status) {
    try {
      const { data, error } = await supabase
        .from('source_file_versions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Source file status update error:', error);
      throw error;
    }
  }
};

// ===== PRODUCTION DATA SERVICES =====
export const productionDataService = {
  async updateSummary(jobId) {
    try {
      console.log(`📊 Updating production summary for job ${jobId}`);
      
      // Get property counts from single table
      const { count, error: countError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId);

      if (countError) throw countError;

      // Count properties with inspection data
      const { count: inspectedCount, error: inspectedError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .not('inspection_info_by', 'is', null);

      if (inspectedError) throw inspectedError;

      // Update job with current totals
      const { data, error } = await supabase
        .from('jobs')
        .update({
          total_properties: count || 0,
          // inspected_properties: inspectedCount || 0,  // ❌ REMOVED 2025-01-XX: Field deleted from jobs table
          workflow_stats: {
            properties_processed: count || 0,
            properties_inspected: inspectedCount || 0,
            last_updated: new Date().toISOString()
          }
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error) throw error;
      return { success: true, data };
    } catch (error) {
      console.error('Production data update error:', error);
      return { success: false, error: error.message };
    }
  }
};

// ===== UTILITY SERVICES =====
export const utilityService = {
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id')
        .limit(1);
      
      return { success: !error, error };
    } catch (error) {
      return { success: false, error: error };
    }
  },

  // ENHANCED: Assignment-aware stats function with correct property class field names
  async getStats() {
    try {
      // Get basic counts separately to avoid Promise.all masking errors
      const { count: employeeCount, error: empError } = await supabase
        .from('employees')
        .select('id', { count: 'exact', head: true });

      const { count: jobCount, error: jobError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true });

      // UPDATED: Count all properties (assigned or unassigned)
      const { count: propertyCount, error: propError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get residential properties (M4 class 2, 3A) - assignment-aware
      const { count: residentialCount, error: residentialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['2', '3A'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // UPDATED: Get commercial properties (M4 class 4A, 4B, 4C) - assignment-aware
      const { count: commercialCount, error: commercialError } = await supabase
        .from('property_records')
        .select('id', { count: 'exact', head: true })
        .in('property_m4_class', ['4A', '4B', '4C'])
        .or('is_assigned_property.is.null,is_assigned_property.eq.true');

      // Log any errors but don't fail completely
      if (empError) console.error('Employee count error:', empError);
      if (jobError) console.error('Job count error:', jobError);
      if (propError) console.error('Property count error:', propError);
      if (residentialError) console.error('Residential count error:', residentialError);
      if (commercialError) console.error('Commercial count error:', commercialError);

      const totalProperties = propertyCount || 0;
      const residential = residentialCount || 0;
      const commercial = commercialCount || 0;
      const other = Math.max(0, totalProperties - residential - commercial);

      return {
        employees: employeeCount || 0,
        jobs: jobCount || 0,
        properties: totalProperties,
        propertiesBreakdown: {
          total: totalProperties,
          residential: residential,
          commercial: commercial,
          other: other
        }
      };
    } catch (error) {
      console.error('Stats fetch error:', error);
      return {
        employees: 0,
        jobs: 0,
        properties: 0,
        propertiesBreakdown: {
          total: 0,
          residential: 0,
          commercial: 0,
          other: 0
        }
      };
    }
  }
};

// ===== AUTHENTICATION SERVICES =====
export const authService = {
  async getCurrentUser() {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      if (user) {
        const { data: employee, error: empError } = await supabase
          .from('employees')
          .select('*')
          .eq('auth_user_id', user.id)
          .single();
        
        if (empError) {
          console.warn('Employee profile not found');
          return {
            ...user,
            role: 'admin',
            canAccessBilling: true
          };
        }
        
        return {
          ...user,
          employee,
          role: employee.role,
          canAccessBilling: ['admin', 'owner'].includes(employee.role) || user.id === '5df85ca3-7a54-4798-a665-c31da8d9caad'
        };
      }
      
      return null;
    } catch (error) {
      console.error('Auth error:', error);
      return null;
    }
  },

  async signInAsDev() {
    return {
      user: {
        id: '5df85ca3-7a54-4798-a665-c31da8d9caad',
        email: 'ppalead1@gmail.com'
      },
      role: 'admin',
      canAccessBilling: true
    };
  },

  async signIn(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Sign in error:', error);
      throw error;
    }
  },

  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }
};

// ===== LEGACY COMPATIBILITY =====
export const signInAsDev = authService.signInAsDev;

// ===== PRESERVED FIELDS HANDLER EXPORT =====
// Export the handler for FileUploadButton to pass to updaters
export const preservedFieldsHandler = propertyService.createPreservedFieldsHandler;

// ===== AUTH HELPER FUNCTIONS =====
export const authHelpers = {
  // Get current user with role
  getCurrentUser: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('email', session.user.email.toLowerCase())
        .single();

      return {
        ...session.user,
        role: employee?.role || 'inspector',
        employeeData: employee
      };
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  },

  // Check if user has required role
  hasRole: async (requiredRole) => {
    const user = await authHelpers.getCurrentUser();
    if (!user) return false;

    const roleHierarchy = {
      admin: 3,
      manager: 2,
      inspector: 1
    };

    return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
  },

  // Subscribe to auth changes
  onAuthStateChange: (callback) => {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const user = await authHelpers.getCurrentUser();
        callback(event, user);
      } else {
        callback(event, null);
      }
    });
  },

  // Update user has_account flag when account is created
  updateHasAccount: async (email) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ has_account: true })
        .eq('email', email.toLowerCase());

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('Error updating has_account:', error);
      return { success: false, error };
    }
  }
};

// ===== WORKSHEET SERVICE FOR PRE-VALUATION SETUP =====
export const worksheetService = {
  // Initialize or get existing market_land_valuation record
  async initializeMarketLandRecord(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('*')
      .eq('job_id', jobId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Record doesn't exist, create it with minimal data to preserve any future fields
      const { data: newRecord, error: createError } = await supabase
        .from('market_land_valuation')
        .insert({
          job_id: jobId,
          normalization_config: {},
          time_normalized_sales: [],
          normalization_stats: {},
          worksheet_data: {},
          worksheet_stats: {
            last_saved: new Date().toISOString(),
            entries_completed: 0,
            ready_to_process: 0,
            location_variations: {}
          },
          // Preserve empty valuation_method and cascade_rates so they don't get lost
          valuation_method: null,
          cascade_rates: null
        })
        .select()
        .single();

      if (createError) throw createError;
      return newRecord;
    }

    if (error) throw error;
    return data;
  },

  // Save normalization configuration (merge with existing config to avoid overwrites)
  async saveNormalizationConfig(jobId, config) {
    await this.initializeMarketLandRecord(jobId);

    // Load existing config
    const { data: existingRecord, error: loadError } = await supabase
      .from('market_land_valuation')
      .select('normalization_config')
      .eq('job_id', jobId)
      .single();

    if (loadError && loadError.code !== 'PGRST116') throw loadError;

    const existingConfig = existingRecord?.normalization_config || {};

    // Merge existing config with incoming partial config
    const mergedConfig = {
      ...existingConfig,
      ...config
    };

    // If selectedCounty is not provided, fall back to the job's county from the jobs table
    try {
      if (!mergedConfig.selectedCounty) {
        const { data: jobRecord, error: jobError } = await supabase
          .from('jobs')
          .select('county')
          .eq('id', jobId)
          .single();
        if (!jobError && jobRecord?.county) {
          mergedConfig.selectedCounty = jobRecord.county;
        }
      }
    } catch (e) {
      // Ignore job lookup failure and proceed with whatever mergedConfig contains
      console.warn('Could not fetch job county for normalization config fallback:', e);
    }

    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        normalization_config: mergedConfig,
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);

    if (error) throw error;
  },

  // Save time normalized sales results (use upsert so it persists even if no record exists yet)
  async saveTimeNormalizedSales(jobId, sales, stats) {
    const payload = {
      job_id: jobId,
      time_normalized_sales: sales,
      normalization_stats: stats,
      last_normalization_run: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('market_land_valuation')
      .upsert(payload, { onConflict: 'job_id' });

    if (error) throw error;
  },

  // Load saved normalization data
  async loadNormalizationData(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('normalization_config, time_normalized_sales, normalization_stats, last_normalization_run')
      .eq('job_id', jobId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // No record exists yet
      return null;
    }
    
    if (error) throw error;
    return data;
  },

  // Save worksheet stats
  async saveWorksheetStats(jobId, stats) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_stats: stats,
        last_worksheet_save: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Save worksheet data changes
  async saveWorksheetData(jobId, worksheetData) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_data: worksheetData,
        last_worksheet_save: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  },

  // Load saved worksheet data
  async loadWorksheetData(jobId) {
    const { data, error } = await supabase
      .from('market_land_valuation')
      .select('worksheet_data, worksheet_stats, last_worksheet_save')
      .eq('job_id', jobId)
      .single();
    
    if (error && error.code === 'PGRST116') {
      // No record exists yet
      return null;
    }
    
    if (error) throw error;
    return data;
  },

  // Update location standards
  async updateLocationStandards(jobId, locationVariations) {
    const { error } = await supabase
      .from('market_land_valuation')
      .update({
        worksheet_stats: {
          location_variations: locationVariations
        }
      })
      .eq('job_id', jobId);
    
    if (error) throw error;
  }
};

/**
 * County HPI Data Service (with caching)
 */
export const countyHpiService = {
  async getAll() {
    // Check cache first
    const cacheKey = 'county_hpi_all';
    const cached = dataCache.get(cacheKey);
    if (cached) {
      console.log('📦 Returning cached county HPI data');
      return cached;
    }

    try {
      const { data, error } = await supabase
        .from('county_hpi_data')
        .select('*')
        .order('county_name, observation_year');

      if (error) throw error;

      // Cache with long TTL since historical data doesn't change
      dataCache.set(cacheKey, data, CACHE_CONFIG.COUNTY_HPI);
      console.log('��� Cached county HPI data');

      return data;
    } catch (error) {
      console.error('County HPI service error:', error);
      throw error;
    }
  },

  clearCache() {
    dataCache.clear('county_hpi_all');
  }
};

export default supabase;
