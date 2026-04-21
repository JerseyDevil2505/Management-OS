// Tiny status chip + edit modal for a single property's geocode coordinates.
// Drops into any comps grid (sales, vacant land, appellant) so the user can
// see at a glance whether a comp has lat/lng, and fix it inline before
// generating a PDF.
//
// Behavior:
//   * Green pin     → coords present (Census or manual)
//   * Amber "?"     → coords missing
//   * Click chip    → modal with lat/lng inputs (paste from Google Maps right-click)
//   * Save          → writes to property_records by property_composite_key,
//                     stamps geocode_source = 'manual' / geocode_match_quality = 'Manual'
//
// onSaved(coords) is called after a successful save so the parent can patch
// its in-memory copy of the property without a full reload.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function parseLatLngText(text) {
  // Accept "40.12345, -74.56789" (Google right-click format) OR two numbers
  // separated by whitespace. Returns { lat, lng } or null.
  if (!text) return null;
  const cleaned = String(text).replace(/[()]/g, '').trim();
  const parts = cleaned.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export default function GeocodeStatusChip({
  property,
  size = 'sm',
  onSaved,
  showLabelWhenMissing = false,
}) {
  const [open, setOpen] = useState(false);
  const hasCoords =
    property &&
    property.property_latitude != null &&
    property.property_longitude != null &&
    !Number.isNaN(parseFloat(property.property_latitude)) &&
    !Number.isNaN(parseFloat(property.property_longitude));

  if (!property) return null;

  const dim = size === 'sm' ? 18 : 22;
  const baseChip = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dim,
    height: dim,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    padding: 0,
    flex: '0 0 auto',
  };
  const okChip = { ...baseChip, background: '#dcfce7', color: '#166534' };
  const missingChip = { ...baseChip, background: '#fef3c7', color: '#92400e' };

  return (
    <>
      <button
        type="button"
        title={
          hasCoords
            ? `Geocoded (${property.geocode_source || 'unknown'}). Click to edit.`
            : 'No geocode — click to add lat/lng manually.'
        }
        style={hasCoords ? okChip : missingChip}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {hasCoords ? '📍' : '?'}
      </button>
      {showLabelWhenMissing && !hasCoords && (
        <span style={{ marginLeft: 4, fontSize: 11, color: '#92400e' }}>
          no geocode
        </span>
      )}
      {open && (
        <GeocodeEditModal
          property={property}
          onClose={() => setOpen(false)}
          onSaved={(coords) => {
            setOpen(false);
            if (onSaved) onSaved(coords);
          }}
        />
      )}
    </>
  );
}

function GeocodeEditModal({ property, onClose, onSaved }) {
  const initialLat =
    property.property_latitude != null ? String(property.property_latitude) : '';
  const initialLng =
    property.property_longitude != null ? String(property.property_longitude) : '';
  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [pasted, setPasted] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Auto-split a "lat, lng" paste into the two fields.
  useEffect(() => {
    if (!pasted) return;
    const parsed = parseLatLngText(pasted);
    if (parsed) {
      setLat(String(parsed.lat));
      setLng(String(parsed.lng));
    }
  }, [pasted]);

  const handleSave = async () => {
    setError(null);
    const parsed = parseLatLngText(`${lat}, ${lng}`);
    if (!parsed) {
      setError('Lat/Lng look invalid. Lat must be -90..90, Lng -180..180.');
      return;
    }
    if (!property.property_composite_key) {
      setError('Missing property_composite_key — cannot save.');
      return;
    }
    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from('property_records')
        .update({
          property_latitude: parsed.lat,
          property_longitude: parsed.lng,
          geocode_source: 'manual',
          geocode_match_quality: 'Manual',
        })
        .eq('property_composite_key', property.property_composite_key);
      if (upErr) throw upErr;
      onSaved({
        property_latitude: parsed.lat,
        property_longitude: parsed.lng,
        geocode_source: 'manual',
        geocode_match_quality: 'Manual',
      });
    } catch (e) {
      setError(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    if (!property.property_composite_key) return;
    if (
      !window.confirm(
        'Clear the saved coordinates for this parcel? It will go back to "no geocode".',
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from('property_records')
        .update({
          property_latitude: null,
          property_longitude: null,
          geocode_source: null,
          geocode_match_quality: null,
        })
        .eq('property_composite_key', property.property_composite_key);
      if (upErr) throw upErr;
      onSaved({
        property_latitude: null,
        property_longitude: null,
        geocode_source: null,
        geocode_match_quality: null,
      });
    } catch (e) {
      setError(e?.message || 'Clear failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          padding: 20,
          borderRadius: 8,
          width: 460,
          maxWidth: '92vw',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Edit Geocode</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18 }}
          >
            ×
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#374151' }}>
          <div>
            <strong>{property.property_location || '(no address)'}</strong>
          </div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>
            {property.property_composite_key}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: 10,
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            fontSize: 12,
            color: '#374151',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <strong>Tip:</strong> open Google Maps, right-click the parcel, and click the
            "lat, lng" line at the top of the popup to copy. Paste it below — both fields fill
            automatically.
          </div>
          <input
            type="text"
            placeholder="Paste &quot;40.12345, -74.56789&quot; here"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            style={{
              width: '100%',
              padding: 6,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: 13,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <label style={{ flex: 1, fontSize: 12, color: '#374151' }}>
            Latitude
            <input
              type="text"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              style={{
                width: '100%',
                padding: 6,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                boxSizing: 'border-box',
                marginTop: 2,
              }}
            />
          </label>
          <label style={{ flex: 1, fontSize: 12, color: '#374151' }}>
            Longitude
            <input
              type="text"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              style={{
                width: '100%',
                padding: 6,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                boxSizing: 'border-box',
                marginTop: 2,
              }}
            />
          </label>
        </div>

        {error && (
          <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 12 }}>{error}</div>
        )}

        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={handleClear}
            disabled={saving || (!initialLat && !initialLng)}
            style={{
              padding: '6px 10px',
              background: 'transparent',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: 12,
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: !initialLat && !initialLng ? 0.4 : 1,
            }}
          >
            Clear
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: '6px 12px',
                background: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '6px 14px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper: given a list of properties, returns the ones missing coords.
export function findMissingGeocodes(props) {
  if (!Array.isArray(props)) return [];
  return props.filter(
    (p) =>
      p &&
      (p.property_latitude == null ||
        p.property_longitude == null ||
        Number.isNaN(parseFloat(p.property_latitude)) ||
        Number.isNaN(parseFloat(p.property_longitude))),
  );
}
