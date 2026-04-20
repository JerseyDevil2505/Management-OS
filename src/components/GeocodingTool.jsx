import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabaseClient';

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

function sanitizeForCsv(value) {
  if (value === null || value === undefined) return '';
  // Strip commas, quotes, and newlines that would break Census's parser.
  // Census batch CSV is positional and very intolerant of escaping.
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '')
    .replace(/,/g, ' ')
    .trim();
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
        'property_composite_key, property_location, property_block, property_lot, property_qualifier, property_addl_card, property_latitude, property_longitude'
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

const GeocodingTool = () => {
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [properties, setProperties] = useState([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  // Result-side state
  const [parsedResults, setParsedResults] = useState([]); // raw rows from Census result CSVs
  const [committing, setCommitting] = useState(false);
  const [commitSummary, setCommitSummary] = useState(null);

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
          .select('id, job_name, municipality, county, total_properties, vendor_type, status')
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

    // Only geocode properties with an address AND no coords yet
    const candidates = properties.filter(
      (p) => (p.property_location || '').trim() && p.property_latitude == null
    );

    if (candidates.length === 0) {
      setStatus({
        kind: 'info',
        message: 'No ungeocoded properties with addresses found for this job.',
      });
      return;
    }

    const city = sanitizeForCsv(selectedJob.municipality || '');
    const state = 'NJ';

    // Census batch CSV format (no header):
    //   uniqueId, streetAddress, city, state, zip
    const buildRow = (p) =>
      [
        sanitizeForCsv(p.property_composite_key),
        sanitizeForCsv(p.property_location),
        city,
        state,
        '', // zip unknown — Census tolerates blank
      ].join(',');

    const totalChunks = Math.ceil(candidates.length / CENSUS_BATCH_LIMIT);
    const safeJobName = (selectedJob.job_name || 'job')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();

    for (let i = 0; i < totalChunks; i++) {
      const slice = candidates.slice(i * CENSUS_BATCH_LIMIT, (i + 1) * CENSUS_BATCH_LIMIT);
      const csv = slice.map(buildRow).join('\n');
      const filename =
        totalChunks === 1
          ? `${safeJobName}_geocode-input.csv`
          : `${safeJobName}_geocode-input_part-${i + 1}-of-${totalChunks}.csv`;
      downloadFile(filename, csv);
    }

    setStatus({
      kind: 'success',
      message:
        totalChunks === 1
          ? `Generated 1 CSV with ${candidates.length} addresses. Upload it to Census.`
          : `Generated ${totalChunks} CSVs (${candidates.length} addresses total, ${CENSUS_BATCH_LIMIT}-row chunks). Upload each to Census separately.`,
    });
  }, [selectedJob, properties]);

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
          // Census result CSV columns:
          //   0: uniqueId
          //   1: input address
          //   2: match status (Match | No_Match | Tie)
          //   3: match type (Exact | Non_Exact)
          //   4: matched address
          //   5: lon,lat (comma-separated inside one field — but quoted)
          //   6: tigerline id
          //   7: side
          //   8+ : geographies (state, county, tract, block) when using /geographies/addressbatch
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
              compositeKey,
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

    // reset input so same file can be selected again
    event.target.value = '';
  }, []);

  const resultStats = useMemo(() => {
    if (parsedResults.length === 0) return null;
    const matched = parsedResults.filter((r) => r.latitude != null && r.longitude != null);
    const noMatch = parsedResults.filter((r) => r.matchStatus === 'No_Match');
    const tie = parsedResults.filter((r) => r.matchStatus === 'Tie');
    const exact = parsedResults.filter((r) => r.matchType === 'Exact');
    const nonExact = parsedResults.filter((r) => r.matchType === 'Non_Exact');
    return {
      total: parsedResults.length,
      matched: matched.length,
      noMatch: noMatch.length,
      tie: tie.length,
      exact: exact.length,
      nonExact: nonExact.length,
      matchPct: parsedResults.length
        ? ((matched.length / parsedResults.length) * 100).toFixed(1)
        : '0.0',
    };
  }, [parsedResults]);

  const commitResults = useCallback(async () => {
    if (parsedResults.length === 0 || !selectedJobId) return;
    const matched = parsedResults.filter((r) => r.latitude != null && r.longitude != null);
    if (matched.length === 0) {
      setError('No matched coordinates to commit.');
      return;
    }

    setCommitting(true);
    setError(null);
    setCommitSummary(null);
    const now = new Date().toISOString();

    try {
      // Update in batches of 100 to keep individual statements small.
      const BATCH = 100;
      let updated = 0;
      let failed = 0;

      const updateOne = (r) =>
        supabase
          .from('property_records')
          .update({
            property_latitude: r.latitude,
            property_longitude: r.longitude,
            geocode_source: 'census',
            geocode_match_quality: r.matchType || r.matchStatus || null,
            geocoded_at: now,
          })
          .eq('property_composite_key', r.compositeKey)
          .eq('job_id', selectedJobId);

      for (let i = 0; i < matched.length; i += BATCH) {
        const slice = matched.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(slice.map(updateOne));
        for (const res of results) {
          if (res.error) failed += 1;
          else updated += 1;
        }
      }

      setCommitSummary({ updated, failed, attempted: matched.length });
      setStatus({
        kind: 'success',
        message: `Committed ${updated} of ${matched.length} coordinate updates.`,
      });

      // Refresh property list to reflect new coords
      const refreshed = await fetchAllJobProperties(selectedJobId);
      setProperties(refreshed);
    } catch (e) {
      setError(`Commit failed: ${e.message || e}`);
    } finally {
      setCommitting(false);
    }
  }, [parsedResults, selectedJobId]);

  const previewRows = parsedResults.slice(0, 10);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        🗺️ Geocoding Tool (Census Batch)
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        One-time geocoding of property addresses via the free U.S. Census Bureau batch geocoder.
        Manual upload/download flow — admin only.
      </p>

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
                const ungeocoded = properties.filter(
                  (p) => (p.property_location || '').trim() && p.property_latitude == null
                ).length;
                const chunks = Math.ceil(ungeocoded / CENSUS_BATCH_LIMIT);
                return (
                  <p style={{ fontSize: 14, color: '#374151', marginTop: 12 }}>
                    Will generate <strong>{chunks}</strong> CSV file{chunks === 1 ? '' : 's'} (
                    {ungeocoded.toLocaleString()} addresses, max{' '}
                    {CENSUS_BATCH_LIMIT.toLocaleString()} rows per file).
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
              </div>

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

              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
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
};

const td = {
  padding: '6px 8px',
  borderBottom: '1px solid #f3f4f6',
};

export default GeocodingTool;
