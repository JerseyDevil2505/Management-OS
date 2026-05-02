import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { supabase, parseDateLocal } from '../lib/supabaseClient';
import { njCityForZip } from '../data/njZipToCity';
import { isPpaJob } from '../lib/tenantConfig';

// ---------- Variant CSV (postal-ZIP sweep) helpers ----------
// Synthetic ID format used by the variant CSV: "{compositeKey}__{zipIdx}".
// On result-import we strip everything after the "__" so multiple variant
// rows for the same parcel collapse back into one update.
const VARIANT_DELIM = '__';
function stripVariantSuffix(key) {
  if (!key) return key;
  const i = String(key).indexOf(VARIANT_DELIM);
  return i === -1 ? key : String(key).slice(0, i);
}
function variantSuffix(key) {
  if (!key) return null;
  const i = String(key).indexOf(VARIANT_DELIM);
  return i === -1 ? null : String(key).slice(i + VARIANT_DELIM.length);
}

/**
 * GeocodingTool
 * -------------
 * Admin-only top-level utility for one-time geocoding of property addresses
 * via the U.S. Census Bureau's free batch geocoder.
 *
 * Flow (manual / Option B):
 *   1. Pick a job
 *   2. Generate input CSV(s) — chunked at exactly 10,000 rows per file
 *      (Census batch limit). Files download as job-name_part-N-of-M.csv
 *   3. Admin uploads those CSV(s) to:
 *        https://geocoding.geo.census.gov/geocoder/geographies/addressbatch
 *      (benchmark: Public_AR_Current, vintage: Current_Current)
 *   4. Admin downloads result CSV(s) from Census
 *   5. Upload result CSV(s) back here
 *   6. Preview match stats, commit to property_records
 *   7. (NEW) Manual entry pass: for No_Match / suspect rows, paste lat/lng
 *      copied from Google Maps, etc. Stamped geocode_source = 'manual'.
 *
 * No nav link — accessed only via /geocoding-tool URL by primary owner.
 */

const CENSUS_BATCH_LIMIT = 10000;
const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/addressbatch';

const buttonBase = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 14,
};

const primaryButton = {
  ...buttonBase,
  background: '#2563eb',
  color: '#ffffff',
  border: '1px solid #1d4ed8',
};

const dangerButton = {
  ...buttonBase,
  background: '#dc2626',
  color: '#ffffff',
  border: '1px solid #b91c1c',
};

const smallButton = {
  ...buttonBase,
  padding: '4px 10px',
  fontSize: 12,
};

const smallPrimary = {
  ...smallButton,
  background: '#2563eb',
  color: '#ffffff',
  border: '1px solid #1d4ed8',
};

function downloadFile(filename, content, mimeType = 'text/csv') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Build a parcel-identity key that is stable across roll years (i.e. ignores
// the YYYYMMDD date prefix in property_composite_key). Used to dedupe
// CSV generation and to propagate manual save / skip / Census commits to
// every roll-year copy of the same parcel within the same job.
function parcelIdentity(p) {
  return [
    p.property_block || '',
    p.property_lot || '',
    p.property_qualifier || '',
    p.property_addl_card == null ? '' : String(p.property_addl_card),
  ].join('|');
}

// A condo "child" record — same block/lot as the mother lot, but with a
// C-qualifier (C0001, C0002, ...). Its property_location is often missing the
// unit number, or is identical to the mother lot's address, so geocoding it
// independently is a waste — it lives at the same building footprint.
function isCondoChild(p) {
  return /^C\d/i.test(String(p.property_qualifier || '').trim());
}

// Mother-lot identity (ignores qualifier) — used to find the parent parcel for
// a condo child. block | lot | addl_card.
function motherLotKey(p) {
  return [
    p.property_block || '',
    p.property_lot || '',
    p.property_addl_card == null ? '' : String(p.property_addl_card),
  ].join('|');
}

// True if the address string begins with a street number (digit, optionally
// followed by letters/fractions like "12A" or "12-1/2"). Census batch geocoding
// requires a street number; entries like "WILLOW DR" or "REAR LIN BLVD" can
// never match and just create No_Match noise.
function hasStreetNumber(address) {
  if (!address) return false;
  return /^\s*\d/.test(String(address));
}

// US Highway numbers that pass through New Jersey. Used by
// normalizeAddressForCensus to decide whether `RT 1` should become `US 1`
// (federal highway) or `NJ 1` (state highway). NJ has no NJ-1, NJ-9 etc —
// those are all US routes — so a generic `RT N` rewrite would silently
// produce a non-existent address for those.
const NJ_US_HIGHWAY_NUMBERS = new Set([
  '1', '9', '22', '30', '40', '46', '130', '202', '206', '322',
]);

// Word-form ordinals → numeric ordinals. TIGER indexes numbered streets in
// the numeric form ("1ST", "2ND", "3RD", "42ND"), so a parcel on
// "FIRST AVENUE" or "TWENTY-THIRD STREET" is invisible to a literal Census
// match. We canonicalize to the numeric form on the way out, and also strip
// hyphens so "TWENTY-THIRD" / "TWENTY THIRD" both work.
const ORDINAL_WORD_TO_NUM = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
  ELEVENTH: '11TH', TWELFTH: '12TH', THIRTEENTH: '13TH', FOURTEENTH: '14TH',
  FIFTEENTH: '15TH', SIXTEENTH: '16TH', SEVENTEENTH: '17TH', EIGHTEENTH: '18TH',
  NINETEENTH: '19TH', TWENTIETH: '20TH',
};

// Reverse of ORDINAL_WORD_TO_NUM. Used to emit a second variant row
// ("1ST AVE" + "FIRST AVE") so the geocoder can pick whichever form TIGER
// has indexed for that segment.
const ORDINAL_NUM_TO_WORD = Object.fromEntries(
  Object.entries(ORDINAL_WORD_TO_NUM).map(([w, n]) => [n, w]),
);

// If the normalized address contains a numeric ordinal token (1ST/2ND/...),
// return the address with that token swapped to its word form. Returns null
// when nothing changes.
function ordinalWordVariant(normalizedAddr) {
  if (!normalizedAddr) return null;
  const tokens = String(normalizedAddr).split(' ');
  let changed = false;
  for (let i = 0; i < tokens.length; i++) {
    const w = ORDINAL_NUM_TO_WORD[tokens[i]];
    if (w) {
      tokens[i] = w;
      changed = true;
    }
  }
  return changed ? tokens.join(' ') : null;
}

// Normalize a property address for Census batch geocoding:
//   * Collapse street suffixes to USPS-canonical form (LA / LANE → LN,
//     AVE. → AVE, BOULEVARD → BLVD, etc.) using the existing SUFFIX_LOOKUP.
//   * Rewrite `RT NN` / `RTE NN` / `ROUTE NN` → `US NN` for known US
//     highway numbers, `NJ NN` for everything else (state + county routes).
//     This pulls 100+ Franklin / Lebanon / Hunterdon parcels off the
//     pending list because TIGER indexes routes under NJ/US prefixes
//     rather than the local "RT" abbreviation.
//   * Strip stray periods (`AVE.` → `AVE`) and collapse whitespace.
//   * Preserve the leading street number — the rest of the pipeline
//     already drops rows that don't have one.
function normalizeAddressForCensus(addr) {
  if (!addr) return addr;
  let s = String(addr)
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return s;

  // Route rewrite: RT/RTE/ROUTE <NN> → US <NN> or NJ <NN>.
  s = s.replace(/\b(RT|RTE|ROUTE)\s+(\d{1,3})\b/g, (_, _kw, num) => {
    return NJ_US_HIGHWAY_NUMBERS.has(num) ? `US ${num}` : `NJ ${num}`;
  });

  // Suffix canonicalization: walk tokens and collapse known aliases. Only
  // apply to tokens AFTER the first one (so a leading directional like "N"
  // isn't mistaken for a suffix). Keep order intact. Same loop also folds
  // word-ordinals to numeric ("FIRST" → "1ST") so TIGER's numbered-street
  // index can find them.
  const tokens = s.split(' ');
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (ORDINAL_WORD_TO_NUM[t]) tokens[i] = ORDINAL_WORD_TO_NUM[t];
    else if (SUFFIX_LOOKUP[t]) tokens[i] = SUFFIX_LOOKUP[t];
  }
  return tokens.join(' ').trim();
}

function sanitizeForCsv(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .replace(/,/g, ' ')
    .trim();
}

// ---------- Owner address fuzzy match helpers ----------
// USPS street suffix normalization map. Anything on the right collapses to
// the left so "PEAR TREE LANE" and "PEAR TREE LA" both reduce to "PEAR TREE LN".
const STREET_SUFFIX_MAP = {
  ST: ['ST', 'STR', 'STREET'],
  AVE: ['AV', 'AVE', 'AVN', 'AVENUE'],
  BLVD: ['BL', 'BLV', 'BLVD', 'BOULEVARD'],
  RD: ['RD', 'ROAD'],
  DR: ['DR', 'DRV', 'DRIVE'],
  LN: ['LA', 'LN', 'LANE'],
  CT: ['CT', 'CRT', 'COURT'],
  PL: ['PL', 'PLACE'],
  CIR: ['CIR', 'CIRC', 'CIRCLE'],
  TER: ['TR', 'TER', 'TERR', 'TERRACE'],
  WAY: ['WY', 'WAY'],
  PKWY: ['PK', 'PKY', 'PKWY', 'PARKWAY'],
  HWY: ['HW', 'HWY', 'HIGHWAY'],
  TRL: ['TR', 'TRL', 'TRAIL'],
  ALY: ['AL', 'ALY', 'ALLEY'],
  SQ: ['SQ', 'SQUARE'],
  XING: ['XING', 'CROSSING'],
  RUN: ['RUN'],
  PATH: ['PATH'],
  ROW: ['ROW'],
};
const SUFFIX_LOOKUP = (() => {
  const m = {};
  for (const [canon, aliases] of Object.entries(STREET_SUFFIX_MAP)) {
    for (const a of aliases) m[a] = canon;
  }
  return m;
})();
const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW',
  'NORTH', 'SOUTH', 'EAST', 'WEST']);
const DIR_CANON = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
};

function normalizeStreet(s) {
  if (!s) return '';
  const cleaned = String(s)
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned === '.') return '';
  const tokens = cleaned.split(' ');
  return tokens
    .map((t, i) => {
      // Canonicalize leading directional
      if (i === 1 && DIRECTIONALS.has(t)) return DIR_CANON[t] || t;
      // Canonicalize trailing suffix
      if (SUFFIX_LOOKUP[t]) return SUFFIX_LOOKUP[t];
      return t;
    })
    .join(' ');
}

// "FRANKLIN PARK, NJ 08823" or "FRANKLIN PARK NJ 08823" -> {city, state, zip}
function parseCsz(csz) {
  if (!csz) return null;
  const cleaned = String(csz).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  // Capture trailing 5-digit zip (optionally +4)
  const m = cleaned.match(/^(.+?)\s+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?$/i);
  if (!m) return null;
  const city = m[1].trim().toUpperCase();
  const state = m[2].toUpperCase();
  const zip = m[3];
  if (!city || city === '.' || zip === '99999') return null;
  return { city, state, zip };
}

// Compare property situs street to owner mailing street. Returns true if the
// normalized forms match exactly (so "25 PEAR TREE LA" == "25 PEAR TREE LANE").
function ownerMatchesSitus(propertyLocation, ownerStreet) {
  const a = normalizeStreet(propertyLocation);
  const b = normalizeStreet(ownerStreet);
  if (!a || !b) return false;
  return a === b;
}

async function fetchAllJobProperties(jobId) {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('property_records')
      .select(
        'property_composite_key, property_location, property_block, property_lot, property_qualifier, property_addl_card, property_m4_class, property_latitude, property_longitude, geocode_source, owner_street, owner_csz, sales_date'
      )
      .eq('job_id', jobId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Vendor-aware "is this row the main card" check. BRT uses '1' (or null/blank),
// Microsystems uses 'M'. Anything else is treated as an additional card so we
// don't double-count parcels with sub-cards (A, B, C, …) toward totals or %.
// Used by every "main cards only" filter in this component.
const MAIN_CARD_VALUES = new Set(['1', 'M']);
function isMainCardRow(p) {
  if (!p) return false;
  const raw = p.property_addl_card;
  if (raw == null) return true;
  const v = String(raw).trim().toUpperCase();
  if (v === '') return true;
  return MAIN_CARD_VALUES.has(v);
}

async function fetchCoverageForJob(jobId) {
  // Only count main cards so additional cards on the same parcel don't
  // inflate totals or punish the % complete. We accept both BRT ('1' / null)
  // and Microsystems ('M') main markers — a hardcoded '1' filter silently
  // returned 0 of 0 for every Microsystems town.
  const mainCardFilter = (q) => q.in('property_addl_card', ['1', 'M']);
  const total = await mainCardFilter(
    supabase
      .from('property_records')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId),
  );
  const geocoded = await mainCardFilter(
    supabase
      .from('property_records')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .not('property_latitude', 'is', null),
  );
  const skipped = await mainCardFilter(
    supabase
      .from('property_records')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('geocode_source', 'skipped'),
  );
  return {
    total: total.count || 0,
    geocoded: geocoded.count || 0,
    skipped: skipped.count || 0,
  };
}

const GeocodingTool = () => {
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [properties, setProperties] = useState([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  // Result-side state
  const [parsedResults, setParsedResults] = useState([]);
  const [committing, setCommitting] = useState(false);
  const [commitSummary, setCommitSummary] = useState(null);

  // Shared progress for any batched operation (Census commit, bulk skip,
  // mother-lot inherit). { label, current, total } | null.
  const [batchProgress, setBatchProgress] = useState(null);

  // Coverage overview
  const [coverage, setCoverage] = useState({}); // { jobId: { total, geocoded } }
  const [coverageLoading, setCoverageLoading] = useState(false);

  // ---- Variant CSV state (ZIP-keyed recovery sweep) ----
  // List of ZIPs configured for the currently-selected job. Persisted in
  // job_settings under the key 'variant_postal_zips' (JSON array of 5-digit
  // strings). Empty until the admin opens the modal and saves.
  const [variantZips, setVariantZips] = useState([]);
  const [variantZipsLoading, setVariantZipsLoading] = useState(false);
  const [variantZipsSaving, setVariantZipsSaving] = useState(false);
  const [variantModalOpen, setVariantModalOpen] = useState(false);

  // Manual entry
  const [manualSearch, setManualSearch] = useState('');
  const [manualEdits, setManualEdits] = useState({}); // { compositeKey: { lat, lng } }
  const [manualSaving, setManualSaving] = useState({}); // { compositeKey: bool }
  const [manualFilter, setManualFilter] = useState('ungeocoded'); // 'ungeocoded' | 'all'

  // Manual cleanup queue filters — mirror the user-facing CoordinatesSubTab
  // so I can prioritize parcels that landed in the sales pool (so an
  // ungeocoded sale doesn't slip through search-radius later).
  const [csvClassFilter, setCsvClassFilter] = useState(() => new Set());
  const [csvSalesInPool, setCsvSalesInPool] = useState(false);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId]
  );

  // Load jobs once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error: jobsError } = await supabase
          .from('jobs')
          .select('id, job_name, municipality, county, total_properties, vendor_type, status, organization_id, end_date, organizations:organization_id(org_type)')
          .order('job_name', { ascending: true });
        if (jobsError) throw jobsError;
        if (mounted) {
          setJobs(data || []);
          setJobsLoading(false);
        }
      } catch (e) {
        if (mounted) {
          setError(`Failed to load jobs: ${e.message || e}`);
          setJobsLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load coverage for all jobs once jobs are loaded
  const loadCoverage = useCallback(async (jobsList) => {
    if (!jobsList || jobsList.length === 0) return;
    setCoverageLoading(true);
    try {
      const CHUNK = 6;
      const next = {};
      for (let i = 0; i < jobsList.length; i += CHUNK) {
        const slice = jobsList.slice(i, i + CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(
          slice.map((j) => fetchCoverageForJob(j.id).then((c) => [j.id, c]))
        );
        for (const [id, c] of results) next[id] = c;
        setCoverage((prev) => ({ ...prev, ...next }));
      }
    } catch (e) {
      // non-fatal — overview can fail silently
      // eslint-disable-next-line no-console
      console.warn('Coverage load failed:', e);
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!jobsLoading && jobs.length > 0) {
      loadCoverage(jobs);
    }
  }, [jobsLoading, jobs, loadCoverage]);

  // Load properties when job changes
  useEffect(() => {
    if (!selectedJobId) {
      setProperties([]);
      return;
    }
    let mounted = true;
    setPropsLoading(true);
    setError(null);
    setStatus(null);
    setParsedResults([]);
    setCommitSummary(null);
    setManualEdits({});
    setManualSearch('');
    (async () => {
      try {
        const data = await fetchAllJobProperties(selectedJobId);
        if (mounted) setProperties(data);
      } catch (e) {
        if (mounted) setError(`Failed to load properties: ${e.message || e}`);
      } finally {
        if (mounted) setPropsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedJobId]);

  // Load saved variant ZIPs for the selected job from job_settings. Reset to
  // empty when no job is selected so the modal/card doesn't carry over.
  useEffect(() => {
    if (!selectedJobId) {
      setVariantZips([]);
      return;
    }
    let mounted = true;
    setVariantZipsLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('job_settings')
          .select('setting_value')
          .eq('job_id', selectedJobId)
          .eq('setting_key', 'variant_postal_zips')
          .maybeSingle();
        if (!mounted) return;
        let parsed = [];
        if (data?.setting_value) {
          try {
            const arr = JSON.parse(data.setting_value);
            if (Array.isArray(arr)) {
              parsed = arr.filter((z) => /^\d{5}$/.test(String(z))).map(String);
            }
          } catch (e) { /* ignore */ }
        }
        setVariantZips(parsed);
      } catch (e) {
        // non-fatal
      } finally {
        if (mounted) setVariantZipsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [selectedJobId]);

  // Suggest ZIPs from owner mailing data (owner-occupied parcels' ZIPs).
  // Returns array of { zip, count } sorted by count desc. Used to pre-fill
  // the modal so the admin doesn't type the obvious ones.
  const ownerDerivedZips = useMemo(() => {
    if (!properties || properties.length === 0) return [];
    const counts = new Map();
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (!ownerMatchesSitus(p.property_location, p.owner_street)) continue;
      const parsed = parseCsz(p.owner_csz);
      if (!parsed) continue;
      counts.set(parsed.zip, (counts.get(parsed.zip) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([zip, count]) => ({ zip, count }))
      .sort((a, b) => b.count - a.count);
  }, [properties]);

  const saveVariantZips = useCallback(async (zips) => {
    if (!selectedJobId) return;
    setVariantZipsSaving(true);
    try {
      const value = JSON.stringify(zips);
      // Upsert by (job_id, setting_key). job_settings has no composite UNIQUE
      // constraint by default, so do select-then-update/insert.
      const { data: existing } = await supabase
        .from('job_settings')
        .select('id')
        .eq('job_id', selectedJobId)
        .eq('setting_key', 'variant_postal_zips')
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('job_settings')
          .update({ setting_value: value, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('job_settings')
          .insert({
            job_id: selectedJobId,
            setting_key: 'variant_postal_zips',
            setting_value: value,
          });
      }
      setVariantZips(zips);
    } catch (e) {
      setError(`Failed to save ZIP variants: ${e.message || e}`);
    } finally {
      setVariantZipsSaving(false);
    }
  }, [selectedJobId]);

  // Distinct m4 classes present in the loaded properties, sorted in NJ
  // canonical order so the chip row is predictable.
  const csvAvailableClasses = useMemo(() => {
    const set = new Set();
    properties.forEach((p) => {
      if (p.property_m4_class) set.add(String(p.property_m4_class).trim());
    });
    const ORDER = ['1', '2', '3A', '3B', '4A', '4B', '4C', '5A', '5B', '6A', '6B', '6C'];
    return Array.from(set).sort((a, b) => {
      const ai = ORDER.indexOf(a);
      const bi = ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [properties]);

  // Sales-pool window: 10/1 (assessmentYear-2) → 10/31 (assessmentYear-1).
  // Anchored on the selected job's end_date with the same Lojik adjustment
  // (org_type = 'assessor' → assessmentYear = end_date.year - 1) used by
  // SalesComparisonTab. One window only — replaces the old CSP/PSP/HSP
  // chip set since the cleanup queue cares about "is this parcel a sale
  // we'll need a coordinate for", not which sub-bucket it lives in.
  const csvSalesWindow = useMemo(() => {
    if (!selectedJob?.end_date) return null;
    const endLocal = parseDateLocal(selectedJob.end_date);
    const rawYear = endLocal ? endLocal.getFullYear() : null;
    if (!rawYear) return null;
    const isLojik = selectedJob?.organizations?.org_type === 'assessor';
    const ay = isLojik ? rawYear - 1 : rawYear;
    return {
      start: new Date(ay - 2, 9, 1),  // 10/1 two years before assessment year
      end: new Date(ay - 1, 9, 31),   // 10/31 last year (relative to assessment year)
      isLojik,
      assessmentYear: ay,
    };
  }, [selectedJob?.end_date, selectedJob?.organizations?.org_type]);

  // Predicate applied inside the manual cleanup queue. csvSalesInPool = true
  // restricts to parcels whose sales_date falls inside the sales-pool window
  // (10/1 ay-2 → 10/31 ay-1). Class filter is unchanged (multi-select set).
  const passesCsvFilters = useCallback(
    (p) => {
      if (csvClassFilter.size > 0) {
        const c = String(p.property_m4_class || '').trim();
        if (!csvClassFilter.has(c)) return false;
      }
      if (csvSalesInPool && csvSalesWindow) {
        if (!p.sales_date) return false;
        const d = parseDateLocal(p.sales_date);
        if (!d) return false;
        if (d < csvSalesWindow.start || d > csvSalesWindow.end) return false;
      }
      return true;
    },
    [csvClassFilter, csvSalesInPool, csvSalesWindow],
  );

  const csvFiltersActive = csvClassFilter.size > 0 || csvSalesInPool;

  const stats = useMemo(() => {
    const total = properties.length;
    const withCoords = properties.filter(
      (p) => p.property_latitude != null && p.property_longitude != null
    ).length;
    const withAddress = properties.filter((p) => (p.property_location || '').trim()).length;
    return {
      total,
      withCoords,
      withoutCoords: total - withCoords,
      withAddress,
      withoutAddress: total - withAddress,
    };
  }, [properties]);

  const generateCsvBatches = useCallback(() => {
    if (!selectedJob || properties.length === 0) return;

    // Only main cards, with an address that has a street number, not yet
    // geocoded, and not skipped. Dedupe across roll years — one row per
    // unique parcel. Addresses without a leading street number ("WILLOW DR",
    // "REAR LIN BLVD") are excluded — Census can't match them anyway.
    const seen = new Set();
    const candidates = [];
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (!(p.property_location || '').trim()) continue;
      if (!hasStreetNumber(p.property_location)) continue;
      if (p.property_latitude != null) continue;
      if (p.geocode_source === 'skipped') continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(p);
    }

    if (candidates.length === 0) {
      setStatus({
        kind: 'info',
        message: 'No ungeocoded properties with addresses found for this job.',
      });
      return;
    }

    const fallbackCity = sanitizeForCsv(selectedJob.municipality || '');
    const fallbackState = 'NJ';

    let ownerHits = 0;

    // For each parcel, prefer the owner's mailing city/state/zip when the
    // owner street fuzzy-matches the property location (owner-occupied). This
    // gives Census the real postal city + ZIP, which dramatically improves
    // match rates in townships where the postal city differs from the
    // municipal name (e.g. Franklin Twp → Somerset / Franklin Park).
    let ordinalVariantRows = 0;
    const buildRows = (p) => {
      let city = fallbackCity;
      let state = fallbackState;
      let zip = '';
      if (ownerMatchesSitus(p.property_location, p.owner_street)) {
        const parsed = parseCsz(p.owner_csz);
        if (parsed) {
          city = sanitizeForCsv(parsed.city);
          state = sanitizeForCsv(parsed.state);
          zip = sanitizeForCsv(parsed.zip);
          ownerHits += 1;
        }
      }
      const normalized = normalizeAddressForCensus(p.property_location);
      const key = sanitizeForCsv(p.property_composite_key);
      const rows = [
        [key, sanitizeForCsv(normalized), city, state, zip].join(','),
      ];
      // Emit a second row with the word-form ordinal so the geocoder can
      // resolve whichever form TIGER has on file for that segment. Tagged
      // with __o1 so the result parser collapses it back onto the same
      // parcel and keeps the better match.
      const wordForm = ordinalWordVariant(normalized);
      if (wordForm) {
        rows.push(
          [`${key}${VARIANT_DELIM}o1`, sanitizeForCsv(wordForm), city, state, zip].join(','),
        );
        ordinalVariantRows += 1;
      }
      return rows;
    };

    const totalChunks = Math.ceil(candidates.length / CENSUS_BATCH_LIMIT);
    const safeJobName = (selectedJob.job_name || 'job')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    for (let i = 0; i < totalChunks; i++) {
      const slice = candidates.slice(i * CENSUS_BATCH_LIMIT, (i + 1) * CENSUS_BATCH_LIMIT);
      const csv = slice.flatMap(buildRows).join('\n');
      const filename =
        totalChunks === 1
          ? `${safeJobName}_geocode-input.csv`
          : `${safeJobName}_geocode-input_part-${i + 1}-of-${totalChunks}.csv`;
      downloadFile(filename, csv);
    }

    const ownerNote = ownerHits > 0
      ? ` ${ownerHits.toLocaleString()} rows used owner-derived city/ZIP.`
      : '';
    const ordinalNote = ordinalVariantRows > 0
      ? ` Added ${ordinalVariantRows.toLocaleString()} ordinal variant row(s) (1ST↔FIRST).`
      : '';
    setStatus({
      kind: 'success',
      message:
        (totalChunks === 1
          ? `Generated 1 CSV with ${candidates.length} addresses. Upload it to Census.`
          : `Generated ${totalChunks} CSVs (${candidates.length} addresses total, ${CENSUS_BATCH_LIMIT}-row chunks). Upload each to Census separately.`) +
        ownerNote + ordinalNote,
    });
  }, [selectedJob, properties]);

  const generateVariantCsvBatches = useCallback(() => {
    if (!selectedJob || properties.length === 0 || variantZips.length === 0) return;

    // Same filter logic as the main CSV: pending main cards with a real
    // street number, deduped across roll years.
    const seen = new Set();
    const candidates = [];
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (!(p.property_location || '').trim()) continue;
      if (!hasStreetNumber(p.property_location)) continue;
      if (p.property_latitude != null) continue;
      if (p.geocode_source === 'skipped') continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(p);
    }

    if (candidates.length === 0) {
      setStatus({
        kind: 'info',
        message: 'No ungeocoded properties with addresses found for this job.',
      });
      return;
    }

    // Build one row per parcel × per ZIP. The synthetic ID encodes the ZIP
    // index (0..N-1) so the result parser can attribute matches back to a
    // specific variant for the per-ZIP recovery breakdown.
    const rows = [];
    for (const p of candidates) {
      variantZips.forEach((zip, zipIdx) => {
        const city = sanitizeForCsv(njCityForZip(zip) || '');
        rows.push([
          `${sanitizeForCsv(p.property_composite_key)}${VARIANT_DELIM}${zipIdx}`,
          sanitizeForCsv(normalizeAddressForCensus(p.property_location)),
          city,
          'NJ',
          sanitizeForCsv(zip),
        ].join(','));
      });
    }

    const totalChunks = Math.ceil(rows.length / CENSUS_BATCH_LIMIT);
    const safeJobName = (selectedJob.job_name || 'job')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    for (let i = 0; i < totalChunks; i++) {
      const slice = rows.slice(i * CENSUS_BATCH_LIMIT, (i + 1) * CENSUS_BATCH_LIMIT);
      const csv = slice.join('\n');
      const filename =
        totalChunks === 1
          ? `${safeJobName}_geocode-variants.csv`
          : `${safeJobName}_geocode-variants_part-${i + 1}-of-${totalChunks}.csv`;
      downloadFile(filename, csv);
    }

    setStatus({
      kind: 'success',
      message: `Generated ${totalChunks} variant CSV(s) — ${candidates.length.toLocaleString()} parcels × ${variantZips.length} ZIP(s) = ${rows.length.toLocaleString()} rows. Upload each to Census.`,
    });
  }, [selectedJob, properties, variantZips]);

  const handleResultUpload = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setStatus(null);
    setError(null);
    setCommitSummary(null);

    const allRows = [];
    let filesParsed = 0;

    files.forEach((file) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (res) => {
          res.data.forEach((row) => {
            if (!row || row.length < 3) return;
            const compositeKey = row[0];
            const matchStatus = row[2];
            let lat = null;
            let lon = null;
            const coords = row[5];
            if (coords && typeof coords === 'string' && coords.includes(',')) {
              const [lonStr, latStr] = coords.split(',');
              const lonN = parseFloat(lonStr);
              const latN = parseFloat(latStr);
              if (!isNaN(lonN) && !isNaN(latN)) {
                lon = lonN;
                lat = latN;
              }
            }
            allRows.push({
              // Underlying composite key (variant suffix stripped) — used to
              // match back to property_records.
              compositeKey: stripVariantSuffix(compositeKey),
              // Original key including __zipIdx (null for non-variant rows).
              variantIdx: variantSuffix(compositeKey),
              matchStatus,
              matchType: row[3] || '',
              matchedAddress: row[4] || '',
              latitude: lat,
              longitude: lon,
              sourceFile: file.name,
            });
          });
          filesParsed += 1;
          if (filesParsed === files.length) {
            setParsedResults(allRows);
            setStatus({
              kind: 'info',
              message: `Parsed ${allRows.length} result rows across ${files.length} file(s).`,
            });
          }
        },
        error: (err) => {
          setError(`Parse error in ${file.name}: ${err.message || err}`);
        },
      });
    });

    event.target.value = '';
  }, []);

  const resultStats = useMemo(() => {
    if (parsedResults.length === 0) return null;
    // Variant CSVs explode each parcel into N rows (one per ZIP). For headline
    // stats we want unique-parcel counts, not raw row counts. We collapse by
    // underlying composite_key, preferring the BEST match: Exact > Non_Exact
    // > everything else. Ties / No_Match collapse to a single failed row.
    const isVariant = parsedResults.some((r) => r.variantIdx != null);
    const byParcel = new Map();
    for (const r of parsedResults) {
      const key = r.compositeKey;
      const existing = byParcel.get(key);
      const rank = (rr) => (rr.matchType === 'Exact' ? 3
        : rr.matchType === 'Non_Exact' ? 2
        : rr.latitude != null ? 1 : 0);
      if (!existing || rank(r) > rank(existing)) byParcel.set(key, r);
    }
    const collapsed = Array.from(byParcel.values());
    const matched = collapsed.filter((r) => r.latitude != null && r.longitude != null);
    const noMatch = collapsed.filter((r) => r.matchStatus === 'No_Match');
    const tie = collapsed.filter((r) => r.matchStatus === 'Tie');
    const exact = collapsed.filter((r) => r.matchType === 'Exact');
    const nonExact = collapsed.filter((r) => r.matchType === 'Non_Exact');
    // Per-ZIP recovery: only meaningful for variant-CSV uploads. Maps zipIdx
    // -> count of parcels whose WINNING match came from that variant.
    const perZip = new Map();
    if (isVariant) {
      for (const r of matched) {
        const idx = r.variantIdx;
        if (idx == null) continue;
        perZip.set(idx, (perZip.get(idx) || 0) + 1);
      }
    }
    return {
      total: parsedResults.length,
      uniqueParcels: collapsed.length,
      isVariant,
      matched: matched.length,
      noMatch: noMatch.length,
      tie: tie.length,
      exact: exact.length,
      nonExact: nonExact.length,
      matchPct: collapsed.length
        ? ((matched.length / collapsed.length) * 100).toFixed(1)
        : '0.0',
      perZip,
    };
  }, [parsedResults]);

  // ---------- Ties-only variant CSV ----------
  // Same per-ZIP sweep as the main Recovery Sweep, but restricted to parcels
  // Census flagged as Tie in the most recent imported result. Forces the
  // configured city + ZIP for each variant row so Census can distinguish
  // adjacent boroughs that share the same street name (the actual cause of
  // most NJ ties — not parser-level confusion).
  const generateTiesOnlyVariantCsv = useCallback(() => {
    if (!selectedJob || variantZips.length === 0 || parsedResults.length === 0) return;

    // Tied parcels from the imported result, deduped by underlying composite key.
    const tiedKeys = new Set();
    for (const r of parsedResults) {
      if (r.matchStatus === 'Tie') tiedKeys.add(r.compositeKey);
    }
    if (tiedKeys.size === 0) {
      setStatus({ kind: 'info', message: 'No Tie rows in the imported results.' });
      return;
    }

    const propsByKey = new Map(properties.map((p) => [p.property_composite_key, p]));
    const candidates = [];
    for (const key of tiedKeys) {
      const p = propsByKey.get(key);
      if (!p) continue;
      if (!(p.property_location || '').trim()) continue;
      if (!hasStreetNumber(p.property_location)) continue;
      candidates.push(p);
    }
    if (candidates.length === 0) {
      setStatus({
        kind: 'info',
        message: 'Tied parcels had no usable addresses to retry.',
      });
      return;
    }

    const rows = [];
    for (const p of candidates) {
      const numericAddr = normalizeAddressForCensus(p.property_location);
      // TIGER sometimes indexes a numbered street under its word form
      // (THIRD ST) instead of the numeric form (3RD ST), or vice versa.
      // Emit both so the geocoder can match whichever one its segment
      // table actually has. wordAddr is null when no ordinal token is
      // present, in which case we just emit the numeric row.
      const wordAddr = ordinalWordVariant(numericAddr);
      variantZips.forEach((zip, zipIdx) => {
        const city = sanitizeForCsv(njCityForZip(zip) || '');
        rows.push([
          `${sanitizeForCsv(p.property_composite_key)}${VARIANT_DELIM}${zipIdx}n`,
          sanitizeForCsv(numericAddr),
          city,
          'NJ',
          sanitizeForCsv(zip),
        ].join(','));
        if (wordAddr) {
          rows.push([
            `${sanitizeForCsv(p.property_composite_key)}${VARIANT_DELIM}${zipIdx}w`,
            sanitizeForCsv(wordAddr),
            city,
            'NJ',
            sanitizeForCsv(zip),
          ].join(','));
        }
      });
    }

    const totalChunks = Math.ceil(rows.length / CENSUS_BATCH_LIMIT);
    const safeJobName = (selectedJob.job_name || 'job')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    for (let i = 0; i < totalChunks; i++) {
      const slice = rows.slice(i * CENSUS_BATCH_LIMIT, (i + 1) * CENSUS_BATCH_LIMIT);
      const csv = slice.join('\n');
      const filename =
        totalChunks === 1
          ? `${safeJobName}_ties-variants.csv`
          : `${safeJobName}_ties-variants_part-${i + 1}-of-${totalChunks}.csv`;
      downloadFile(filename, csv);
    }

    setStatus({
      kind: 'success',
      message:
        `Generated ${totalChunks} ties-only variant CSV(s) — ${candidates.length.toLocaleString()} tied parcels × ${variantZips.length} ZIP(s) = ${rows.length.toLocaleString()} rows. Upload to Census, then re-import via Step 4.`,
    });
  }, [parsedResults, selectedJob, properties, variantZips]);

  const commitResults = useCallback(async () => {
    if (parsedResults.length === 0 || !selectedJobId) return;
    // Collapse multi-variant rows to one best row per underlying parcel so
    // we don't issue multiple updates that would overwrite each other.
    const rank = (rr) => (rr.matchType === 'Exact' ? 3
      : rr.matchType === 'Non_Exact' ? 2
      : rr.latitude != null ? 1 : 0);
    const bestByParcel = new Map();
    for (const r of parsedResults) {
      const existing = bestByParcel.get(r.compositeKey);
      if (!existing || rank(r) > rank(existing)) bestByParcel.set(r.compositeKey, r);
    }
    const matched = Array.from(bestByParcel.values()).filter(
      (r) => r.latitude != null && r.longitude != null
    );
    if (matched.length === 0) {
      setError('No matched coordinates to commit.');
      return;
    }

    setCommitting(true);
    setError(null);
    setCommitSummary(null);
    const now = new Date().toISOString();

    try {
      const BATCH = 100;
      let updated = 0;
      let failed = 0;

      // Look up parcel identity for each result composite key so we can
      // propagate the same lat/lng to every roll-year copy in this job.
      const propsByKey = new Map(
        properties.map((p) => [p.property_composite_key, p])
      );

      const updateOne = (r) => {
        const src = propsByKey.get(r.compositeKey);
        const payload = {
          property_latitude: r.latitude,
          property_longitude: r.longitude,
          geocode_source: 'census',
          geocode_match_quality: r.matchType || r.matchStatus || null,
          geocoded_at: now,
        };
        let q = supabase.from('property_records').update(payload).eq('job_id', selectedJobId);
        if (src) {
          q = q
            .eq('property_block', src.property_block)
            .eq('property_lot', src.property_lot)
            .eq('property_addl_card', src.property_addl_card);
          if (src.property_qualifier == null) {
            q = q.is('property_qualifier', null);
          } else {
            q = q.eq('property_qualifier', src.property_qualifier);
          }
        } else {
          q = q.eq('property_composite_key', r.compositeKey);
        }
        return q;
      };

      setBatchProgress({ label: 'Committing Census results', current: 0, total: matched.length });
      for (let i = 0; i < matched.length; i += BATCH) {
        const slice = matched.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(slice.map(updateOne));
        for (const res of results) {
          if (res.error) failed += 1;
          else updated += 1;
        }
        setBatchProgress({
          label: 'Committing Census results',
          current: Math.min(i + BATCH, matched.length),
          total: matched.length,
        });
      }
      setBatchProgress(null);

      setCommitSummary({ updated, failed, attempted: matched.length });
      setStatus({
        kind: 'success',
        message: `Committed ${updated} of ${matched.length} coordinate updates.`,
      });

      const refreshed = await fetchAllJobProperties(selectedJobId);
      setProperties(refreshed);
      // refresh coverage row for this job
      const c = await fetchCoverageForJob(selectedJobId);
      setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
    } catch (e) {
      setError(`Commit failed: ${e.message || e}`);
    } finally {
      setBatchProgress(null);
      setCommitting(false);
    }
  }, [parsedResults, selectedJobId, properties]);

  // ---------- Manual entry helpers ----------

  const manualBaseList = useMemo(() => {
    // Manual cleanup base: main cards + manualFilter (ungeocoded/skipped/all)
    // + search + dedup, *before* the class/sales chips. Used both as the
    // input to the visible list and as the source for live chip counts.
    // Vendor-aware so Microsystems jobs (Carneys Point, etc.) actually
    // populate — their main marker is 'M', not '1'.
    let list = properties.filter(isMainCardRow);
    if (manualFilter === 'ungeocoded') {
      list = list.filter(
        (p) => p.property_latitude == null && p.geocode_source !== 'skipped'
      );
    } else if (manualFilter === 'skipped') {
      list = list.filter((p) => p.geocode_source === 'skipped');
    }
    const q = manualSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          (p.property_location || '').toLowerCase().includes(q) ||
          (p.property_composite_key || '').toLowerCase().includes(q) ||
          (p.property_block || '').toString().toLowerCase().includes(q) ||
          (p.property_lot || '').toString().toLowerCase().includes(q)
      );
    }
    // Dedupe across roll years — one row per unique parcel identity.
    const seen = new Set();
    const deduped = [];
    for (const p of list) {
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push(p);
    }
    return deduped;
  }, [properties, manualSearch, manualFilter]);

  // Final visible list = base ∩ chip filters, capped at 100. Chips never
  // affect the base — they just narrow it.
  const manualCandidates = useMemo(() => {
    return manualBaseList.filter(passesCsvFilters).slice(0, 100);
  }, [manualBaseList, passesCsvFilters]);

  // Per-chip live counts derived from manualBaseList so the user can see
  // exactly how many parcels each chip would survive against the current
  // base (search + manualFilter), independent of other chip selections.
  const classChipCounts = useMemo(() => {
    const m = new Map();
    for (const p of manualBaseList) {
      const c = String(p.property_m4_class || '').trim();
      if (!c) continue;
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [manualBaseList]);

  const salesPoolChipCount = useMemo(() => {
    if (!csvSalesWindow) return 0;
    let n = 0;
    for (const p of manualBaseList) {
      if (!p.sales_date) continue;
      const d = parseDateLocal(p.sales_date);
      if (!d) continue;
      if (d >= csvSalesWindow.start && d <= csvSalesWindow.end) n += 1;
    }
    return n;
  }, [manualBaseList, csvSalesWindow]);

  const manualUngeocodedCount = useMemo(() => {
    const seen = new Set();
    let n = 0;
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (!(p.property_latitude == null && p.geocode_source !== 'skipped')) continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      n += 1;
    }
    return n;
  }, [properties]);

  const manualSkippedCount = useMemo(() => {
    const seen = new Set();
    let n = 0;
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (p.geocode_source !== 'skipped') continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      n += 1;
    }
    return n;
  }, [properties]);

  // Count of unique main-card parcels with no street number that are still
  // unresolved (no coords, not already skipped). These are auto-skip candidates.
  const noNumberCandidates = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (p.property_latitude != null) continue;
      if (p.geocode_source === 'skipped') continue;
      const addr = (p.property_location || '').trim();
      if (!addr) continue; // separate concern; leave blanks alone
      if (hasStreetNumber(addr)) continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push(p);
    }
    return list;
  }, [properties]);

  const [bulkSkipping, setBulkSkipping] = useState(false);

  // ---------- Condo mother-lot inheritance ----------
  // Build a one-shot list of unresolved condo (C-qualifier) parcels whose
  // mother lot (same block/lot/addl_card, no/non-C qualifier) already has
  // coordinates. We can copy the mother lot's coords into every child unit.
  const condoInheritCandidates = useMemo(() => {
    // Index mother lots by motherLotKey — prefer rows that already have coords.
    const motherCoords = new Map(); // key -> {lat, lng}
    for (const p of properties) {
      if (isCondoChild(p)) continue;
      if (p.property_latitude == null || p.property_longitude == null) continue;
      const k = motherLotKey(p);
      if (!motherCoords.has(k)) {
        motherCoords.set(k, {
          lat: Number(p.property_latitude),
          lng: Number(p.property_longitude),
        });
      }
    }
    // Now collect unresolved condo children that have a matching mother.
    const seen = new Set();
    const list = [];
    for (const p of properties) {
      if (!isCondoChild(p)) continue;
      if (p.property_latitude != null) continue;
      if (p.geocode_source === 'skipped') continue;
      const m = motherCoords.get(motherLotKey(p));
      if (!m) continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ property: p, mother: m });
    }
    return list;
  }, [properties]);

  const [inheriting, setInheriting] = useState(false);

  const inheritFromMotherLots = useCallback(async () => {
    if (condoInheritCandidates.length === 0 || !selectedJobId) return;
    if (
      !window.confirm(
        `Copy mother-lot coordinates to ${condoInheritCandidates.length} unresolved condo units? ` +
          `(All units inherit the building's lat/lng, propagated across roll years.)`
      )
    )
      return;
    setInheriting(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      const BATCH = 50;
      let updated = 0;
      let failed = 0;
      setBatchProgress({
        label: 'Inheriting mother-lot coords',
        current: 0,
        total: condoInheritCandidates.length,
      });
      for (let i = 0; i < condoInheritCandidates.length; i += BATCH) {
        const slice = condoInheritCandidates.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(
          slice.map(({ property, mother }) => {
            let q = supabase
              .from('property_records')
              .update({
                property_latitude: mother.lat,
                property_longitude: mother.lng,
                geocode_source: 'inherited_motherlot',
                geocode_match_quality: 'inherited_motherlot',
                geocoded_at: now,
              })
              .eq('job_id', selectedJobId)
              .eq('property_block', property.property_block)
              .eq('property_lot', property.property_lot)
              .eq('property_addl_card', property.property_addl_card)
              .eq('property_qualifier', property.property_qualifier);
            return q;
          })
        );
        for (const r of results) {
          if (r.error) failed += 1;
          else updated += 1;
        }
        setBatchProgress({
          label: 'Inheriting mother-lot coords',
          current: Math.min(i + BATCH, condoInheritCandidates.length),
          total: condoInheritCandidates.length,
        });
      }
      setBatchProgress(null);
      // Refresh local state
      const inheritedIds = new Map(
        condoInheritCandidates.map(({ property, mother }) => [
          parcelIdentity(property),
          mother,
        ])
      );
      setProperties((prev) =>
        prev.map((p) => {
          const m = inheritedIds.get(parcelIdentity(p));
          return m
            ? {
                ...p,
                property_latitude: m.lat,
                property_longitude: m.lng,
                geocode_source: 'inherited_motherlot',
              }
            : p;
        })
      );
      const c = await fetchCoverageForJob(selectedJobId);
      setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
      setStatus({
        kind: 'success',
        message: `Inherited mother-lot coords for ${updated} condo units${
          failed > 0 ? ` (${failed} failed)` : ''
        }.`,
      });
    } catch (e) {
      setError(`Inherit failed: ${e.message || e}`);
    } finally {
      setBatchProgress(null);
      setInheriting(false);
    }
  }, [condoInheritCandidates, selectedJobId]);

  // Download an address-only CSV (one full address per line) for the
  // unresolved parcels in the currently selected job. Useful for pasting into
  // Google Maps, Geocodio, BatchGeo, etc.
  const downloadAddressOnlyCsv = useCallback(() => {
    if (!selectedJob) return;
    const seen = new Set();
    const rows = [];
    for (const p of properties) {
      if (!isMainCardRow(p)) continue;
      if (p.property_latitude != null) continue;
      if (p.geocode_source === 'skipped') continue;
      const addr = (p.property_location || '').trim();
      if (!addr) continue;
      const id = parcelIdentity(p);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(p);
    }
    if (rows.length === 0) {
      setStatus({ kind: 'info', message: 'No unresolved parcels to export.' });
      return;
    }
    const city = sanitizeForCsv(selectedJob.municipality || '');
    const state = 'NJ';
    // Single-column "full address" format — works as-is in Geocodio,
    // BatchGeo, etc.
    const csv = rows
      .map((p) => `${sanitizeForCsv(p.property_location)} ${city} ${state}`.replace(/\s+/g, ' ').trim())
      .join('\n');
    const safeJobName = (selectedJob.job_name || 'job')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    downloadFile(`${safeJobName}_addresses-only.csv`, csv);
    setStatus({
      kind: 'success',
      message: `Downloaded ${rows.length} addresses (city + NJ).`,
    });
  }, [selectedJob, properties]);

  const bulkSkipNoNumber = useCallback(async () => {
    if (noNumberCandidates.length === 0 || !selectedJobId) return;
    if (
      !window.confirm(
        `Auto-skip ${noNumberCandidates.length} parcels with no street number? ` +
          `(Census can't match these — they'll be marked skipped across all roll years.)`
      )
    )
      return;
    setBulkSkipping(true);
    setError(null);
    const now = new Date().toISOString();
    try {
      const BATCH = 50;
      let updated = 0;
      let failed = 0;
      setBatchProgress({
        label: 'Auto-skipping no-number addresses',
        current: 0,
        total: noNumberCandidates.length,
      });
      for (let i = 0; i < noNumberCandidates.length; i += BATCH) {
        const slice = noNumberCandidates.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(
          slice.map((property) => {
            let q = supabase
              .from('property_records')
              .update({
                geocode_source: 'skipped',
                geocode_match_quality: 'no_street_number',
                geocoded_at: now,
              })
              .eq('job_id', selectedJobId)
              .eq('property_block', property.property_block)
              .eq('property_lot', property.property_lot)
              .eq('property_addl_card', property.property_addl_card);
            if (property.property_qualifier == null) {
              q = q.is('property_qualifier', null);
            } else {
              q = q.eq('property_qualifier', property.property_qualifier);
            }
            return q;
          })
        );
        for (const r of results) {
          if (r.error) failed += 1;
          else updated += 1;
        }
        setBatchProgress({
          label: 'Auto-skipping no-number addresses',
          current: Math.min(i + BATCH, noNumberCandidates.length),
          total: noNumberCandidates.length,
        });
      }
      setBatchProgress(null);
      const skipIds = new Set(noNumberCandidates.map(parcelIdentity));
      setProperties((prev) =>
        prev.map((p) =>
          skipIds.has(parcelIdentity(p)) ? { ...p, geocode_source: 'skipped' } : p
        )
      );
      const c = await fetchCoverageForJob(selectedJobId);
      setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
      setStatus({
        kind: 'success',
        message: `Auto-skipped ${updated} no-street-number parcels${
          failed > 0 ? ` (${failed} failed)` : ''
        }.`,
      });
    } catch (e) {
      setError(`Bulk skip failed: ${e.message || e}`);
    } finally {
      setBatchProgress(null);
      setBulkSkipping(false);
    }
  }, [noNumberCandidates, selectedJobId]);

  const setManualField = (key, field, value) => {
    setManualEdits((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: value },
    }));
  };

  const skipManual = useCallback(
    async (property) => {
      const key = property.property_composite_key;
      const id = parcelIdentity(property);
      setError(null);
      setManualSaving((prev) => ({ ...prev, [key]: true }));
      try {
        let q = supabase
          .from('property_records')
          .update({
            geocode_source: 'skipped',
            geocode_match_quality: 'skipped',
            geocoded_at: new Date().toISOString(),
          })
          .eq('job_id', selectedJobId)
          .eq('property_block', property.property_block)
          .eq('property_lot', property.property_lot)
          .eq('property_addl_card', property.property_addl_card);
        if (property.property_qualifier == null) {
          q = q.is('property_qualifier', null);
        } else {
          q = q.eq('property_qualifier', property.property_qualifier);
        }
        const { error: upErr } = await q;
        if (upErr) throw upErr;
        setProperties((prev) =>
          prev.map((p) =>
            parcelIdentity(p) === id
              ? { ...p, geocode_source: 'skipped' }
              : p
          )
        );
        const c = await fetchCoverageForJob(selectedJobId);
        setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
      } catch (e) {
        setError(`Skip failed for ${key}: ${e.message || e}`);
      } finally {
        setManualSaving((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [selectedJobId]
  );

  const unskipManual = useCallback(
    async (property) => {
      const key = property.property_composite_key;
      const id = parcelIdentity(property);
      setError(null);
      setManualSaving((prev) => ({ ...prev, [key]: true }));
      try {
        let q = supabase
          .from('property_records')
          .update({
            geocode_source: null,
            geocode_match_quality: null,
            geocoded_at: null,
          })
          .eq('job_id', selectedJobId)
          .eq('property_block', property.property_block)
          .eq('property_lot', property.property_lot)
          .eq('property_addl_card', property.property_addl_card);
        if (property.property_qualifier == null) {
          q = q.is('property_qualifier', null);
        } else {
          q = q.eq('property_qualifier', property.property_qualifier);
        }
        const { error: upErr } = await q;
        if (upErr) throw upErr;
        setProperties((prev) =>
          prev.map((p) =>
            parcelIdentity(p) === id
              ? { ...p, geocode_source: null }
              : p
          )
        );
        const c = await fetchCoverageForJob(selectedJobId);
        setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
      } catch (e) {
        setError(`Unskip failed for ${key}: ${e.message || e}`);
      } finally {
        setManualSaving((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [selectedJobId]
  );

  const saveManual = useCallback(
    async (property) => {
      const key = property.property_composite_key;
      const edit = manualEdits[key] || {};
      const lat = parseFloat(edit.lat);
      const lng = parseFloat(edit.lng);
      if (isNaN(lat) || isNaN(lng)) {
        setError(`Invalid lat/lng for ${key}`);
        return;
      }
      const id = parcelIdentity(property);
      setError(null);
      setManualSaving((prev) => ({ ...prev, [key]: true }));
      try {
        let q = supabase
          .from('property_records')
          .update({
            property_latitude: lat,
            property_longitude: lng,
            geocode_source: 'manual',
            geocode_match_quality: 'manual',
            geocoded_at: new Date().toISOString(),
          })
          .eq('job_id', selectedJobId)
          .eq('property_block', property.property_block)
          .eq('property_lot', property.property_lot)
          .eq('property_addl_card', property.property_addl_card);
        if (property.property_qualifier == null) {
          q = q.is('property_qualifier', null);
        } else {
          q = q.eq('property_qualifier', property.property_qualifier);
        }
        const { error: upErr } = await q;
        if (upErr) throw upErr;

        // If this is a mother lot (non-condo), also push the same coords down
        // to any unresolved condo children (same block/lot/addl_card,
        // C-qualifier). One save = whole building handled.
        let condoChildrenUpdated = 0;
        if (!isCondoChild(property)) {
          const motherKey = motherLotKey(property);
          const childIds = new Set();
          for (const p of properties) {
            if (motherLotKey(p) !== motherKey) continue;
            if (!isCondoChild(p)) continue;
            if (p.property_latitude != null) continue;
            if (p.geocode_source === 'skipped') continue;
            childIds.add(parcelIdentity(p));
          }
          if (childIds.size > 0) {
            const { error: childErr } = await supabase
              .from('property_records')
              .update({
                property_latitude: lat,
                property_longitude: lng,
                geocode_source: 'inherited_motherlot',
                geocode_match_quality: 'inherited_motherlot',
                geocoded_at: new Date().toISOString(),
              })
              .eq('job_id', selectedJobId)
              .eq('property_block', property.property_block)
              .eq('property_lot', property.property_lot)
              .eq('property_addl_card', property.property_addl_card)
              .like('property_qualifier', 'C%')
              .is('property_latitude', null);
            if (!childErr) condoChildrenUpdated = childIds.size;
          }
        }

        // Update local state — propagate to every roll-year copy of this
        // parcel, plus any condo children that just inherited.
        setProperties((prev) =>
          prev.map((p) => {
            if (parcelIdentity(p) === id) {
              return {
                ...p,
                property_latitude: lat,
                property_longitude: lng,
                geocode_source: 'manual',
              };
            }
            if (
              !isCondoChild(property) &&
              isCondoChild(p) &&
              motherLotKey(p) === motherLotKey(property) &&
              p.property_latitude == null &&
              p.geocode_source !== 'skipped'
            ) {
              return {
                ...p,
                property_latitude: lat,
                property_longitude: lng,
                geocode_source: 'inherited_motherlot',
              };
            }
            return p;
          })
        );
        setManualEdits((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        // refresh coverage tally for this job
        const c = await fetchCoverageForJob(selectedJobId);
        setCoverage((prev) => ({ ...prev, [selectedJobId]: c }));
        if (condoChildrenUpdated > 0) {
          setStatus({
            kind: 'success',
            message: `Saved + propagated to ${condoChildrenUpdated} condo unit(s).`,
          });
        }
      } catch (e) {
        setError(`Save failed for ${key}: ${e.message || e}`);
      } finally {
        setManualSaving((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [manualEdits, selectedJobId, properties]
  );

  const buildMapsUrl = (p) => {
    const muni = selectedJob?.municipality || '';
    const addr = `${p.property_location || ''} ${muni} NJ`.replace(/\s+/g, '+');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  };

  const previewRows = parsedResults.slice(0, 10);

  // ---------- Coverage overview rendering helpers ----------

  const coverageRows = useMemo(() => {
    return jobs.map((j) => {
      const c = coverage[j.id];
      const total = c?.total ?? null;
      const geocoded = c?.geocoded ?? null;
      const skipped = c?.skipped ?? 0;
      let pct = null;
      let bucket = 'unknown';
      if (total != null && geocoded != null) {
        // Treat skipped as "addressed" for completion purposes.
        const addressed = geocoded + skipped;
        pct = total > 0 ? (addressed / total) * 100 : 0;
        if (addressed === 0) bucket = 'none';
        else if (pct < 95) bucket = 'partial';
        else bucket = 'complete';
      }
      return { job: j, total, geocoded, skipped, pct, bucket };
    });
  }, [jobs, coverage]);

  const coverageSummary = useMemo(() => {
    const counts = { none: 0, partial: 0, complete: 0, unknown: 0 };
    coverageRows.forEach((r) => {
      counts[r.bucket] += 1;
    });
    return counts;
  }, [coverageRows]);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        🗺️ Geocoding Tool (Census Batch)
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        One-time geocoding of property addresses via the free U.S. Census Bureau batch geocoder.
        Manual upload/download flow — admin only.
      </p>

      {/* Sticky batch progress */}
      {batchProgress && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: '#1e3a8a',
            color: '#ffffff',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 16,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span>
              <strong>{batchProgress.label}…</strong>{' '}
              {batchProgress.current.toLocaleString()} / {batchProgress.total.toLocaleString()}
            </span>
            <span>
              {batchProgress.total > 0
                ? `${((batchProgress.current / batchProgress.total) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
          <div
            style={{
              height: 8,
              background: 'rgba(255,255,255,0.25)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width:
                  batchProgress.total > 0
                    ? `${(batchProgress.current / batchProgress.total) * 100}%`
                    : '0%',
                background: '#22c55e',
                transition: 'width 120ms ease-out',
              }}
            />
          </div>
        </div>
      )}

      {/* Coverage overview */}
      <section style={section}>
        <h2 style={h2}>Town coverage overview</h2>
        <div style={{ ...statsBox, marginBottom: 12 }}>
          <div>
            <strong style={{ color: '#16a34a' }}>{coverageSummary.complete}</strong> complete ·{' '}
            <strong style={{ color: '#d97706' }}>{coverageSummary.partial}</strong> partial ·{' '}
            <strong style={{ color: '#dc2626' }}>{coverageSummary.none}</strong> none ·{' '}
            <strong style={{ color: '#6b7280' }}>{coverageSummary.unknown}</strong> unknown
            {coverageLoading ? ' · loading…' : ''}
          </div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>Org</th>
                <th style={th}>Municipality</th>
                <th style={th}>County</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Geocoded</th>
                <th style={{ ...th, textAlign: 'right' }}>Total</th>
                <th style={{ ...th, textAlign: 'right' }}>%</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {coverageRows.map(({ job, total, geocoded, skipped, pct, bucket }) => (
                <tr key={job.id}>
                  <td style={td}>{job.job_name}</td>
                  <td style={td}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        background: isPpaJob(job) ? '#dcfce7' : '#dbeafe',
                        color: isPpaJob(job) ? '#166534' : '#1e40af',
                      }}
                    >
                      {isPpaJob(job) ? 'PPA' : 'LOJIK'}
                    </span>
                  </td>
                  <td style={td}>{job.municipality || '—'}</td>
                  <td style={td}>{job.county || '—'}</td>
                  <td style={td}>
                    <span style={badgeStyle(bucket)}>{bucketLabel(bucket)}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {geocoded != null ? geocoded.toLocaleString() : '…'}
                    {skipped > 0 && (
                      <span style={{ color: '#6b7280', fontSize: 11 }}>
                        {' '}+{skipped} skip
                      </span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {total != null ? total.toLocaleString() : '…'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {pct != null ? `${pct.toFixed(1)}%` : '…'}
                  </td>
                  <td style={td}>
                    <button
                      style={smallButton}
                      onClick={() => setSelectedJobId(job.id)}
                      disabled={selectedJobId === job.id}
                    >
                      {selectedJobId === job.id ? 'selected' : 'select'}
                    </button>
                  </td>
                </tr>
              ))}
              {coverageRows.length === 0 && (
                <tr>
                  <td style={td} colSpan={9}>
                    No jobs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Step 1: Job picker */}
      <section style={section}>
        <h2 style={h2}>Step 1 — Select a job</h2>
        {jobsLoading ? (
          <p>Loading jobs…</p>
        ) : (
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            style={{ ...buttonBase, minWidth: 380 }}
          >
            <option value="">— Pick a job —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_name} {j.municipality ? `(${j.municipality})` : ''}
                {j.county ? ` — ${j.county}` : ''}
                {j.status ? ` [${j.status}]` : ''}
              </option>
            ))}
          </select>
        )}

        {selectedJob && (
          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>
              <strong>Vendor:</strong> {selectedJob.vendor_type || '—'} ·{' '}
              <strong>Municipality:</strong> {selectedJob.municipality || '—'} ·{' '}
              <strong>County:</strong> {selectedJob.county || '—'}
            </div>
          </div>
        )}
      </section>

      {/* Step 2: Generate CSV */}
      {selectedJobId && (
        <section style={section}>
          <h2 style={h2}>Step 2 — Generate Census input CSV</h2>
          {propsLoading ? (
            <p>Loading properties…</p>
          ) : (
            <>
              <div style={statsBox}>
                <div>
                  <strong>{stats.total.toLocaleString()}</strong> total properties
                </div>
                <div>
                  <strong>{stats.withAddress.toLocaleString()}</strong> with address ·{' '}
                  <strong>{stats.withoutAddress.toLocaleString()}</strong> without
                </div>
                <div>
                  <strong>{stats.withCoords.toLocaleString()}</strong> already geocoded ·{' '}
                  <strong>{stats.withoutCoords.toLocaleString()}</strong> remaining
                </div>
              </div>

              {(() => {
                const seen = new Set();
                let ungeocoded = 0;
                let ownerHits = 0;
                for (const p of properties) {
                  if (!isMainCardRow(p)) continue;
                  if (!(p.property_location || '').trim()) continue;
                  if (!hasStreetNumber(p.property_location)) continue;
                  if (p.property_latitude != null) continue;
                  if (p.geocode_source === 'skipped') continue;
                  const id = parcelIdentity(p);
                  if (seen.has(id)) continue;
                  seen.add(id);
                  ungeocoded += 1;
                  if (
                    ownerMatchesSitus(p.property_location, p.owner_street) &&
                    parseCsz(p.owner_csz)
                  ) {
                    ownerHits += 1;
                  }
                }
                const chunks = Math.ceil(ungeocoded / CENSUS_BATCH_LIMIT);
                const ownerPct = ungeocoded > 0
                  ? ((ownerHits / ungeocoded) * 100).toFixed(0)
                  : '0';
                return (
                  <p style={{ fontSize: 14, color: '#374151', marginTop: 12 }}>
                    Will generate <strong>{chunks}</strong> CSV file{chunks === 1 ? '' : 's'} (
                    {ungeocoded.toLocaleString()} unique parcels, max{' '}
                    {CENSUS_BATCH_LIMIT.toLocaleString()} rows per file).
                    <br />
                    <span style={{ color: '#16a34a' }}>
                      <strong>{ownerHits.toLocaleString()}</strong> ({ownerPct}%) will use the
                      owner's mailing city/ZIP (owner street fuzzy-matches situs).
                    </span>{' '}
                    The rest fall back to <code>{selectedJob?.municipality || ''}, NJ</code>.
                    <br />
                    <span style={{ color: '#6b7280', fontSize: 12 }}>
                      Addresses are normalized before sending: <code>LA</code>/<code>LANE</code>{' '}
                      → <code>LN</code>, <code>RT 27</code> → <code>NJ 27</code>,{' '}
                      <code>RT 1</code> → <code>US 1</code>, <code>AVE.</code> →{' '}
                      <code>AVE</code>, etc. Numbered streets (<code>1ST</code> /{' '}
                      <code>FIRST</code>, <code>2ND</code> / <code>SECOND</code>, …) are sent in{' '}
                      <strong>both</strong> forms so the geocoder picks whichever TIGER has
                      indexed.
                    </span>
                  </p>
                );
              })()}

              <button
                style={primaryButton}
                onClick={generateCsvBatches}
                disabled={propsLoading || stats.total === 0}
              >
                ⬇ Generate &amp; Download CSV(s)
              </button>

              {/* ----- Recovery sweep (ZIP variant CSV, optional) ----- */}
              <div
                style={{
                  marginTop: 20,
                  padding: 14,
                  background: '#f9fafb',
                  border: '1px dashed #d1d5db',
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                  Recovery sweep (optional, ZIP variants)
                </div>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px 0' }}>
                  For long-tail recovery in towns with multiple postal cities (Franklin Twp →
                  Somerset / Princeton / Kingston / Zarephath / etc). Explodes each remaining
                  parcel into one row per ZIP and lets Census pick the best match. Run only after
                  the main CSV has done its pass.
                </p>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 10 }}>
                  ZIPs configured for this town:{' '}
                  <strong>{variantZipsLoading ? '…' : variantZips.length}</strong>
                  {variantZips.length > 0 && (
                    <span style={{ color: '#6b7280' }}>
                      {' '}({variantZips.map((z) => `${z} ${njCityForZip(z) || 'unknown'}`).join(' · ')})
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    style={smallButton}
                    onClick={() => setVariantModalOpen(true)}
                    disabled={propsLoading || variantZipsLoading}
                  >
                    ⚙ Configure ZIPs
                  </button>
                  <button
                    style={{
                      ...smallPrimary,
                      opacity: variantZips.length === 0 ? 0.5 : 1,
                    }}
                    onClick={generateVariantCsvBatches}
                    disabled={propsLoading || variantZips.length === 0 || stats.total === 0}
                    title={variantZips.length === 0 ? 'Add at least one ZIP first' : ''}
                  >
                    ⬇ Generate Variant CSV
                  </button>
                  <button
                    style={{
                      ...smallButton,
                      background: '#fb923c',
                      color: '#fff',
                      border: '1px solid #f97316',
                      opacity:
                        variantZips.length === 0 ||
                        !resultStats ||
                        resultStats.tie === 0
                          ? 0.5
                          : 1,
                    }}
                    onClick={generateTiesOnlyVariantCsv}
                    disabled={
                      propsLoading ||
                      variantZips.length === 0 ||
                      !resultStats ||
                      resultStats.tie === 0
                    }
                    title={
                      variantZips.length === 0
                        ? 'Add at least one ZIP first'
                        : !resultStats || resultStats.tie === 0
                        ? 'Import a Census result with Tie rows first (Step 4)'
                        : 'Re-emit only the tied parcels as a per-ZIP variant CSV'
                    }
                  >
                    🎯 Variant CSV — ties only
                    {resultStats && resultStats.tie > 0
                      ? ` (${resultStats.tie.toLocaleString()})`
                      : ''}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {/* Step 3: Census instructions */}
      {selectedJobId && (
        <section style={section}>
          <h2 style={h2}>Step 3 — Upload to Census, then download results</h2>
          <ol style={{ lineHeight: 1.7, fontSize: 14, paddingLeft: 20 }}>
            <li>
              Go to{' '}
              <a href={CENSUS_BATCH_URL} target="_blank" rel="noreferrer">
                {CENSUS_BATCH_URL}
              </a>
            </li>
            <li>Choose the CSV you just downloaded</li>
            <li>
              Benchmark: <code>Public_AR_Current</code> · Vintage: <code>Current_Current</code>
            </li>
            <li>Submit. Census processes server-side and returns a result CSV (download it).</li>
            <li>Repeat for each chunk if the job had more than one CSV.</li>
            <li>Then upload all result CSVs below.</li>
          </ol>
        </section>
      )}

      {/* Step 4: Result upload */}
      {selectedJobId && (
        <section style={section}>
          <h2 style={h2}>Step 4 — Upload Census result CSV(s)</h2>
          <input type="file" accept=".csv" multiple onChange={handleResultUpload} />

          {resultStats && (
            <div style={{ marginTop: 16 }}>
              <div style={statsBox}>
                <div>
                  <strong>{resultStats.total.toLocaleString()}</strong> rows ·{' '}
                  <strong>{resultStats.matched.toLocaleString()}</strong> matched (
                  {resultStats.matchPct}%)
                </div>
                <div>
                  Exact: <strong>{resultStats.exact.toLocaleString()}</strong> · Non-exact:{' '}
                  <strong>{resultStats.nonExact.toLocaleString()}</strong> · No match:{' '}
                  <strong>{resultStats.noMatch.toLocaleString()}</strong> · Tie:{' '}
                  <strong>{resultStats.tie.toLocaleString()}</strong>
                </div>
                {resultStats.isVariant && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#374151' }}>
                    Variant CSV detected — collapsed{' '}
                    <strong>{resultStats.total.toLocaleString()}</strong> rows to{' '}
                    <strong>{resultStats.uniqueParcels.toLocaleString()}</strong> unique parcels.
                  </div>
                )}
              </div>

              {resultStats.isVariant && variantZips.length > 0 && resultStats.perZip.size > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#075985', marginBottom: 4 }}>
                    Per-ZIP recovery (winning variant per parcel)
                  </div>
                  {variantZips.map((zip, idx) => {
                    const n = resultStats.perZip.get(String(idx)) || 0;
                    const city = njCityForZip(zip) || 'unknown';
                    return (
                      <div key={zip} style={{ color: n > 0 ? '#075985' : '#9ca3af' }}>
                        <strong style={{ fontFamily: 'monospace' }}>{zip}</strong> {city}:{' '}
                        <strong>{n.toLocaleString()}</strong>
                        {n === 0 && <span> — consider removing</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 16, marginBottom: 8 }}>
                Preview (first 10 rows)
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Composite Key</th>
                      <th style={th}>Match</th>
                      <th style={th}>Type</th>
                      <th style={th}>Matched Address</th>
                      <th style={th}>Lat</th>
                      <th style={th}>Lon</th>
                      <th style={th}>Map</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, idx) => (
                      <tr key={idx}>
                        <td style={td}>{r.compositeKey}</td>
                        <td style={td}>{r.matchStatus}</td>
                        <td style={td}>{r.matchType}</td>
                        <td style={td}>{r.matchedAddress}</td>
                        <td style={td}>{r.latitude ?? ''}</td>
                        <td style={td}>{r.longitude ?? ''}</td>
                        <td style={td}>
                          {r.latitude != null && r.longitude != null ? (
                            <a
                              href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              view
                            </a>
                          ) : (
                            ''
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  style={primaryButton}
                  onClick={commitResults}
                  disabled={committing || resultStats.matched === 0}
                >
                  {committing ? 'Committing…' : `✓ Commit ${resultStats.matched} coordinates`}
                </button>
                <button
                  style={dangerButton}
                  onClick={() => {
                    setParsedResults([]);
                    setCommitSummary(null);
                    setStatus(null);
                  }}
                  disabled={committing}
                >
                  Discard parsed results
                </button>
              </div>
              {resultStats.tie > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: '#9a3412',
                    background: '#fff7ed',
                    border: '1px solid #fed7aa',
                    borderRadius: 6,
                    padding: '8px 10px',
                  }}
                >
                  <strong>{resultStats.tie.toLocaleString()} ties detected.</strong>{' '}
                  Scroll up to <em>Step 2 → Recovery sweep</em> and click{' '}
                  <strong>🎯 Variant CSV — ties only</strong> to re-emit just
                  the tied parcels with the configured ZIPs forced. Upload to
                  Census and re-import here.
                </div>
              )}

              {commitSummary && (
                <div style={{ marginTop: 12, fontSize: 14 }}>
                  Updated <strong>{commitSummary.updated}</strong> of{' '}
                  <strong>{commitSummary.attempted}</strong> ·{' '}
                  {commitSummary.failed > 0 ? (
                    <span style={{ color: '#dc2626' }}>
                      {commitSummary.failed} failed
                    </span>
                  ) : (
                    <span style={{ color: '#16a34a' }}>0 failed</span>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Step 5: Manual entry (fallback for No_Match / suspect) */}
      {selectedJobId && (
        <section style={section}>
          <h2 style={h2}>Step 5 — Manual entry (No_Match fallback)</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
            For properties Census couldn't resolve, find the parcel in Google Maps,
            right-click the rooftop, and copy the lat/lng. Paste below and save. Stamped
            <code style={{ margin: '0 4px' }}>geocode_source = 'manual'</code>so we always know
            which were human-verified.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              placeholder="Search address, block, lot, or composite key…"
              style={{ ...buttonBase, flex: '1 1 280px', minWidth: 240 }}
            />
            <select
              value={manualFilter}
              onChange={(e) => setManualFilter(e.target.value)}
              style={buttonBase}
            >
              <option value="ungeocoded">Ungeocoded only ({manualUngeocodedCount.toLocaleString()})</option>
              <option value="skipped">Skipped only ({manualSkippedCount.toLocaleString()})</option>
              <option value="all">All main cards</option>
            </select>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              showing {manualCandidates.length} (capped at 100)
            </span>
            <button
              style={smallButton}
              onClick={downloadAddressOnlyCsv}
              title="Download address,city,state CSV of all unresolved parcels"
            >
              ⬇ address-only CSV
            </button>
          </div>

          {/* Optional class + sales-period chips for the manual cleanup
              queue. Empty class set + 'all' period = no restriction. Useful
              for prioritizing parcels that will land in the sales review /
              sales pool windows so we don't ship a CSP sale ungeocoded. */}
          <div style={{ marginBottom: 12 }}>
            {csvAvailableClasses.length > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
                  Class:
                </span>
                {csvAvailableClasses.map((cls) => {
                  const active = csvClassFilter.has(cls);
                  const count = classChipCounts.get(cls) || 0;
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => {
                        setCsvClassFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(cls)) next.delete(cls);
                          else next.add(cls);
                          return next;
                        });
                      }}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        border: '1px solid',
                        cursor: 'pointer',
                        ...(active
                          ? { background: '#2563eb', color: '#fff', borderColor: '#2563eb' }
                          : { background: '#fff', color: '#374151', borderColor: '#d1d5db' }),
                      }}
                    >
                      {cls} <span style={{ opacity: 0.75, marginLeft: 4 }}>({count.toLocaleString()})</span>
                    </button>
                  );
                })}
                {csvClassFilter.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setCsvClassFilter(new Set())}
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      color: '#6b7280',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    clear
                  </button>
                )}
              </div>
            )}
            {csvSalesWindow && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
                  Sales pool:
                </span>
                <button
                  type="button"
                  onClick={() => setCsvSalesInPool(!csvSalesInPool)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    border: '1px solid',
                    cursor: 'pointer',
                    ...(csvSalesInPool
                      ? { background: '#7c3aed', color: '#fff', borderColor: '#7c3aed' }
                      : { background: '#fff', color: '#374151', borderColor: '#d1d5db' }),
                  }}
                  title={`Sales between ${csvSalesWindow.start.toLocaleDateString()} and ${csvSalesWindow.end.toLocaleDateString()}`}
                >
                  In sales pool window <span style={{ opacity: 0.75, marginLeft: 4 }}>({salesPoolChipCount.toLocaleString()})</span>
                </button>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>
                  ({csvSalesWindow.start.toLocaleDateString()} – {csvSalesWindow.end.toLocaleDateString()}
                  {csvSalesWindow.isLojik ? ' · Lojik' : ''})
                </span>
              </div>
            )}
            {csvFiltersActive && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#7c3aed' }}>
                Filters active — manual cleanup list narrowed to matching parcels.
              </div>
            )}
          </div>

          {condoInheritCandidates.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                marginBottom: 12,
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong>{condoInheritCandidates.length}</strong> unresolved condo units
                have a mother lot (same block/lot, no C-qualifier) that's already
                geocoded. Inherit those coords?
              </span>
              <button
                style={primaryButton}
                onClick={inheritFromMotherLots}
                disabled={inheriting}
              >
                {inheriting
                  ? 'inheriting…'
                  : `Inherit ${condoInheritCandidates.length} from mother lot`}
              </button>
            </div>
          )}

          {noNumberCandidates.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                marginBottom: 12,
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1 }}>
                <strong>{noNumberCandidates.length}</strong> unresolved parcels have
                addresses without a street number (e.g. “WILLOW DR”, “REAR LIN BLVD”).
                Census can't match these.
              </span>
              <button
                style={primaryButton}
                onClick={bulkSkipNoNumber}
                disabled={bulkSkipping}
              >
                {bulkSkipping
                  ? 'skipping…'
                  : `Auto-skip ${noNumberCandidates.length} no-number addresses`}
              </button>
            </div>
          )}

          <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Address</th>
                  <th style={th}>Block/Lot/Qual</th>
                  <th style={th}>Class</th>
                  <th style={th}>Current</th>
                  <th style={th}>Lat</th>
                  <th style={th}>Lng</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {manualCandidates.map((p) => {
                  const key = p.property_composite_key;
                  const edit = manualEdits[key] || {};
                  const saving = !!manualSaving[key];
                  return (
                    <tr key={key}>
                      <td style={td}>
                        <div>{p.property_location || <em style={{ color: '#9ca3af' }}>(no address)</em>}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          <a
                            href={buildMapsUrl(p)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            open in Google Maps ↗
                          </a>
                        </div>
                      </td>
                      <td style={td}>
                        {p.property_block || '—'}/{p.property_lot || '—'}/
                        {p.property_qualifier || 'NONE'}
                      </td>
                      <td style={td}>
                        {p.property_m4_class ? (
                          <span style={classBadge(p.property_m4_class)}>
                            {p.property_m4_class}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={td}>
                        {p.property_latitude != null ? (
                          <span style={{ fontSize: 11 }}>
                            {Number(p.property_latitude).toFixed(5)},{' '}
                            {Number(p.property_longitude).toFixed(5)}
                            <br />
                            <span style={{ color: '#6b7280' }}>
                              {p.geocode_source || ''}
                            </span>
                          </span>
                        ) : (
                          <span style={{ color: '#dc2626', fontSize: 12 }}>none</span>
                        )}
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          value={edit.lat || ''}
                          onChange={(e) => setManualField(key, 'lat', e.target.value)}
                          placeholder="40.00847"
                          style={{ ...buttonBase, width: 100, padding: '4px 6px', fontSize: 12 }}
                        />
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          value={edit.lng || ''}
                          onChange={(e) => setManualField(key, 'lng', e.target.value)}
                          placeholder="-75.00680"
                          style={{ ...buttonBase, width: 100, padding: '4px 6px', fontSize: 12 }}
                        />
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button
                            style={smallPrimary}
                            onClick={() => saveManual(p)}
                            disabled={saving || !edit.lat || !edit.lng}
                          >
                            {saving ? 'saving…' : 'save'}
                          </button>
                          {p.geocode_source === 'skipped' ? (
                            <button
                              style={smallButton}
                              onClick={() => unskipManual(p)}
                              disabled={saving}
                              title="Unskip — return to ungeocoded list"
                            >
                              unskip
                            </button>
                          ) : (
                            <button
                              style={smallButton}
                              onClick={() => skipManual(p)}
                              disabled={saving}
                              title="Skip — class 6A/5A/15, vacant ROW, etc."
                            >
                              skip
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {manualCandidates.length === 0 && (
                  <tr>
                    <td style={td} colSpan={7}>
                      {propsLoading
                        ? 'Loading…'
                        : 'No matching properties.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 6,
            marginTop: 16,
          }}
        >
          {error}
        </div>
      )}
      {status && (
        <div
          style={{
            padding: 12,
            background: status.kind === 'success' ? '#f0fdf4' : '#eff6ff',
            border:
              status.kind === 'success' ? '1px solid #bbf7d0' : '1px solid #bfdbfe',
            color: status.kind === 'success' ? '#166534' : '#1e40af',
            borderRadius: 6,
            marginTop: 16,
          }}
        >
          {status.message}
        </div>
      )}

      {/* ===================== Configure ZIPs Modal ===================== */}
      {variantModalOpen && (
        <VariantZipModal
          municipality={selectedJob?.municipality || ''}
          initialZips={variantZips}
          suggestions={ownerDerivedZips}
          saving={variantZipsSaving}
          onCancel={() => setVariantModalOpen(false)}
          onSave={async (zips) => {
            await saveVariantZips(zips);
            setVariantModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

// ============================================================
// VariantZipModal — typo-safe ZIP entry with bundled USPS city
// ============================================================
const VariantZipModal = ({ municipality, initialZips, suggestions, saving, onCancel, onSave }) => {
  const [zips, setZips] = useState(initialZips || []);
  const [draft, setDraft] = useState('');
  const [draftErr, setDraftErr] = useState('');

  const addZip = (raw) => {
    const v = String(raw || '').trim();
    if (!/^\d{5}$/.test(v)) {
      setDraftErr('Enter a 5-digit ZIP.');
      return false;
    }
    if (zips.includes(v)) {
      setDraftErr('Already in the list.');
      return false;
    }
    setZips((prev) => [...prev, v]);
    setDraft('');
    setDraftErr('');
    return true;
  };

  const removeZip = (z) => setZips((prev) => prev.filter((x) => x !== z));

  const overlay = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  };
  const modal = {
    background: '#ffffff',
    borderRadius: 10,
    width: 'min(560px, 100%)',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const headerStyle = {
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };
  const body = { padding: 20 };
  const footer = {
    padding: '12px 20px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    background: '#f9fafb',
  };
  const chip = (good) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontFamily: 'monospace',
    background: good ? '#dcfce7' : '#fef3c7',
    color: good ? '#166534' : '#92400e',
    border: `1px solid ${good ? '#86efac' : '#fcd34d'}`,
    marginRight: 6,
    marginBottom: 6,
  });

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Postal ZIP variants</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{municipality}</div>
          </div>
          <button style={{ ...buttonBase, padding: '4px 10px' }} onClick={onCancel}>✕</button>
        </div>

        <div style={body}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
              Add a ZIP
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                value={draft}
                onChange={(e) => { setDraft(e.target.value.replace(/\D/g, '').slice(0, 5)); setDraftErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addZip(draft); } }}
                placeholder="e.g. 08823"
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  border: `1px solid ${draftErr ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: 'monospace',
                }}
                inputMode="numeric"
                maxLength={5}
              />
              <button style={smallPrimary} onClick={() => addZip(draft)} type="button">
                Add
              </button>
            </div>
            {draftErr && (
              <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>{draftErr}</div>
            )}
            {draft.length === 5 && !draftErr && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Will save as <strong>{draft}</strong>{' '}
                {njCityForZip(draft)
                  ? <span style={{ color: '#16a34a' }}>· {njCityForZip(draft)} ✓</span>
                  : <span style={{ color: '#92400e' }}>· unknown (still works, ZIP-only)</span>}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Configured ({zips.length})
            </div>
            {zips.length === 0 ? (
              <div style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
                None yet. Type a ZIP above or click a suggestion below.
              </div>
            ) : (
              <div>
                {zips.map((z) => {
                  const city = njCityForZip(z);
                  return (
                    <span key={z} style={chip(!!city)}>
                      <strong>{z}</strong>
                      <span>· {city || 'unknown'}</span>
                      <button
                        type="button"
                        onClick={() => removeZip(z)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: 0,
                        }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {suggestions && suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Suggested from owner data
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                ZIPs from owner_csz where owner street matches situs (owner-occupied parcels).
                Click to add.
              </div>
              <div>
                {suggestions.slice(0, 12).map((s) => {
                  const already = zips.includes(s.zip);
                  const city = njCityForZip(s.zip);
                  return (
                    <button
                      key={s.zip}
                      type="button"
                      disabled={already}
                      onClick={() => addZip(s.zip)}
                      style={{
                        ...buttonBase,
                        padding: '4px 10px',
                        marginRight: 6,
                        marginBottom: 6,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        background: already ? '#e5e7eb' : '#ffffff',
                        color: already ? '#6b7280' : '#374151',
                        cursor: already ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {s.zip} {city ? `(${city})` : ''} · {s.count.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={footer}>
          <button style={buttonBase} onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            style={primaryButton}
            onClick={() => onSave(zips)}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save ZIPs'}
          </button>
        </div>
      </div>
    </div>
  );
};

const section = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
};

const h2 = {
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
};

const statsBox = {
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  padding: 12,
  fontSize: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const table = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const th = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '2px solid #e5e7eb',
  background: '#f9fafb',
  position: 'sticky',
  top: 0,
};

const td = {
  padding: '6px 8px',
  borderBottom: '1px solid #f3f4f6',
};

function bucketLabel(b) {
  switch (b) {
    case 'complete':
      return 'Complete';
    case 'partial':
      return 'Partial';
    case 'none':
      return 'Not started';
    default:
      return '—';
  }
}

function classBadge(cls) {
  // Color-code NJ MOD-IV property classes so skip candidates pop visually.
  const base = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'monospace',
  };
  const c = String(cls || '').toUpperCase();
  // Residential
  if (c === '2' || c === '3A' || c === '3B') {
    return { ...base, background: '#dbeafe', color: '#1e40af' };
  }
  // Commercial / industrial / apartment
  if (c === '4A' || c === '4B' || c === '4C') {
    return { ...base, background: '#fef3c7', color: '#92400e' };
  }
  // Vacant land
  if (c === '1') {
    return { ...base, background: '#f3f4f6', color: '#374151' };
  }
  // Farm
  if (c === '3A' || c === '3B') {
    return { ...base, background: '#dcfce7', color: '#166534' };
  }
  // Railroad / public utility / exempt — typical SKIP candidates
  if (c.startsWith('5') || c.startsWith('6') || c.startsWith('15')) {
    return { ...base, background: '#fee2e2', color: '#991b1b' };
  }
  return { ...base, background: '#e5e7eb', color: '#374151' };
}

function badgeStyle(b) {
  const base = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
  };
  switch (b) {
    case 'complete':
      return { ...base, background: '#dcfce7', color: '#166534' };
    case 'partial':
      return { ...base, background: '#fef3c7', color: '#92400e' };
    case 'none':
      return { ...base, background: '#fee2e2', color: '#991b1b' };
    default:
      return { ...base, background: '#f3f4f6', color: '#6b7280' };
  }
}

export default GeocodingTool;
