// Coordinates sub-tab for DataQualityTab.
//
// Lightweight per-job geocode cleanup tool open to all users with access to
// the job (managers, Lojik clients, admins). The full batch geocoder lives
// in src/components/GeocodingTool.jsx and stays admin-only.
//
// Behavior:
//   - Reads the already-loaded `properties` prop (no extra DB round-trip).
//   - Buckets properties into Pending / Review / Fixed.
//   - Reuses <GeocodeStatusChip /> for the actual save (which already stamps
//     geocode_source = 'manual' so future batch sweeps don't overwrite it).
//   - "Open in Google Maps" link prefilled with the address so users can
//     right-click the parcel, copy "lat, lng", and paste into the chip modal.

import { useMemo, useState } from 'react';
import GeocodeStatusChip from '../../GeocodeStatusChip';

// Quality strings the Census batch returns that we treat as "needs review".
// Anything not in this list and not 'Manual' / 'Exact' / 'Match' is also
// treated as review (defensive default).
const LOW_CONFIDENCE_QUALITIES = new Set([
  'ZIP Centroid',
  'ZIP_Centroid',
  'Tie',
  'Non_Exact',
  'Non Exact',
  'Approximate',
]);
const HIGH_CONFIDENCE_QUALITIES = new Set([
  'Manual',
  'Exact',
  'Match',
  'Rooftop',
]);

const hasCoords = (p) =>
  p &&
  p.property_latitude != null &&
  p.property_longitude != null &&
  !Number.isNaN(parseFloat(p.property_latitude)) &&
  !Number.isNaN(parseFloat(p.property_longitude));

const bucketFor = (p) => {
  if (!hasCoords(p)) return 'pending';
  if (p.geocode_source === 'manual') return 'fixed';
  const q = p.geocode_match_quality;
  if (LOW_CONFIDENCE_QUALITIES.has(q)) return 'review';
  if (q && !HIGH_CONFIDENCE_QUALITIES.has(q)) return 'review';
  return 'fixed';
};

const formatAddress = (p) => {
  const parts = [
    p.property_location,
    p.property_city || p.property_municipality,
    'NJ',
    p.property_zip,
  ].filter(Boolean);
  return parts.join(', ');
};

const googleMapsUrl = (p) => {
  const addr = formatAddress(p);
  if (!addr) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
};

export default function CoordinatesSubTab({ properties = [], jobData }) {
  // Local patch map so saves move rows between buckets without a full reload.
  // Keyed by property_composite_key → partial property record overlay.
  const [patches, setPatches] = useState({});
  const [activeBucket, setActiveBucket] = useState('pending');
  const [search, setSearch] = useState('');

  const merged = useMemo(() => {
    if (!Array.isArray(properties)) return [];
    return properties.map((p) => {
      const patch = patches[p.property_composite_key];
      return patch ? { ...p, ...patch } : p;
    });
  }, [properties, patches]);

  const buckets = useMemo(() => {
    const out = { pending: [], review: [], fixed: [] };
    merged.forEach((p) => {
      out[bucketFor(p)].push(p);
    });
    return out;
  }, [merged]);

  const visibleRows = useMemo(() => {
    const rows = buckets[activeBucket] || [];
    if (!search.trim()) return rows.slice(0, 500);
    const needle = search.trim().toLowerCase();
    return rows
      .filter((p) => {
        const hay = [
          p.property_block,
          p.property_lot,
          p.property_qualifier,
          p.property_location,
          p.property_composite_key,
          p.property_m4_class,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 500);
  }, [buckets, activeBucket, search]);

  const handleSaved = (compositeKey, coords) => {
    setPatches((prev) => ({
      ...prev,
      [compositeKey]: {
        property_latitude: coords.property_latitude,
        property_longitude: coords.property_longitude,
        geocode_source: coords.geocode_source,
        geocode_match_quality: coords.geocode_match_quality,
      },
    }));
  };

  const totalRows = buckets[activeBucket]?.length || 0;

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-2xl font-bold text-gray-800 mb-1">
          📍 Coordinates Cleanup
        </h3>
        <p className="text-gray-600 text-sm">
          Fix or fill in property coordinates for{' '}
          <strong>{jobData?.municipality || jobData?.name || 'this job'}</strong>.
          Open Google Maps, right-click the parcel, copy the "lat, lng" line,
          paste into the edit modal. Manual saves are protected from being
          overwritten by future batch geocoding runs.
        </p>
      </div>

      {/* Counters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <BucketChip
          label="Pending"
          subtitle="no coordinates"
          color="amber"
          count={buckets.pending.length}
          active={activeBucket === 'pending'}
          onClick={() => setActiveBucket('pending')}
        />
        <BucketChip
          label="Review"
          subtitle="low-confidence match"
          color="orange"
          count={buckets.review.length}
          active={activeBucket === 'review'}
          onClick={() => setActiveBucket('review')}
        />
        <BucketChip
          label="Fixed"
          subtitle="manual or exact match"
          color="green"
          count={buckets.fixed.length}
          active={activeBucket === 'fixed'}
          onClick={() => setActiveBucket('fixed')}
        />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter by block / lot / address / class…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-3 py-2 border border-gray-300 rounded text-sm"
        />
        <span className="text-xs text-gray-500">
          {visibleRows.length.toLocaleString()} of {totalRows.toLocaleString()}
          {totalRows > 500 ? ' (capped at 500 — narrow with filter)' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded overflow-hidden bg-white">
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="text-left text-xs uppercase text-gray-600">
                <th className="px-3 py-2 w-12"></th>
                <th className="px-3 py-2">Block / Lot / Qual</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Lat / Lng</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2">Map</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                    {totalRows === 0
                      ? `No properties in the "${activeBucket}" bucket. 🎉`
                      : 'No matches for that filter.'}
                  </td>
                </tr>
              ) : (
                visibleRows.map((p) => {
                  const lat = p.property_latitude;
                  const lng = p.property_longitude;
                  const mapUrl = googleMapsUrl(p);
                  return (
                    <tr
                      key={p.property_composite_key}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2">
                        <GeocodeStatusChip
                          property={p}
                          onSaved={(coords) =>
                            handleSaved(p.property_composite_key, coords)
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.property_block}/{p.property_lot}
                        {p.property_qualifier ? ` / ${p.property_qualifier}` : ''}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.property_m4_class || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {p.property_location || (
                          <span className="text-gray-400 italic">no address</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {lat != null && lng != null
                          ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.geocode_source || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.geocode_match_quality || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {mapUrl ? (
                          <a
                            href={mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs"
                          >
                            Open ↗
                          </a>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        <strong>How it works:</strong> Click the chip on any row to enter or
        correct coordinates. Saves are tagged <code>geocode_source = manual</code>{' '}
        and are not overwritten by future batch geocoding runs.
      </div>
    </div>
  );
}

function BucketChip({ label, subtitle, color, count, active, onClick }) {
  const palette = {
    amber: { bg: '#fef3c7', text: '#92400e', activeBg: '#f59e0b', activeText: '#fff' },
    orange: { bg: '#ffedd5', text: '#9a3412', activeBg: '#ea580c', activeText: '#fff' },
    green: { bg: '#dcfce7', text: '#166534', activeBg: '#16a34a', activeText: '#fff' },
  }[color];
  const style = active
    ? { background: palette.activeBg, color: palette.activeText }
    : { background: palette.bg, color: palette.text };
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-4 py-2 text-left transition border border-transparent"
      style={{ ...style, minWidth: 160, cursor: 'pointer' }}
    >
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-bold leading-tight">{count.toLocaleString()}</div>
      <div className="text-[11px] opacity-80">{subtitle}</div>
    </button>
  );
}
