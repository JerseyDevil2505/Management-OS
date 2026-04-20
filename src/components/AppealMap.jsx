import React, { useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * AppealMap
 * ---------
 * Renders a Subject + numbered Comps map for an appeal export.
 *
 * Props:
 *   subject:  { latitude, longitude, address, block, lot, qualifier }
 *   comps:    Array<{ latitude, longitude, address, block, lot, qualifier, rank }>
 *   height:   number (px) — default 360
 *   showLines: bool — draws line from subject to each comp (default true)
 *   id:       string — DOM id for html2canvas capture (default 'appeal-map')
 *
 * The map auto-fits to the bounding box of all visible markers.
 */

// Build a circular numbered marker (HTML icon — works with Leaflet's divIcon).
function buildPin({ label, color, textColor = '#ffffff', size = 30 }) {
  return L.divIcon({
    className: 'appeal-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        color: ${textColor};
        border: 2px solid #ffffff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: ${size >= 30 ? 13 : 11}px;
        line-height: 1;
      ">${label}</div>
    `,
  });
}

// Helper component — Leaflet does not auto-fit on mount in react-leaflet v4.
// This child component grabs the map instance via useMap() and calls fitBounds.
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0][0], points[0][1]], 15);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p[0], p[1]]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [points, map]);
  return null;
}

const AppealMap = ({
  subject,
  comps = [],
  height = 360,
  showLines = true,
  id = 'appeal-map',
}) => {
  const containerRef = useRef(null);

  const subjectLatLng = useMemo(() => {
    const lat = parseFloat(subject?.latitude);
    const lng = parseFloat(subject?.longitude);
    if (isNaN(lat) || isNaN(lng)) return null;
    return [lat, lng];
  }, [subject]);

  const compPoints = useMemo(() => {
    return comps
      .map((c, idx) => {
        const lat = parseFloat(c.latitude);
        const lng = parseFloat(c.longitude);
        if (isNaN(lat) || isNaN(lng)) return null;
        return {
          latLng: [lat, lng],
          rank: c.rank ?? idx + 1,
          address: c.address || '',
          block: c.block || '',
          lot: c.lot || '',
          qualifier: c.qualifier || '',
        };
      })
      .filter(Boolean);
  }, [comps]);

  const allPoints = useMemo(() => {
    const pts = [];
    if (subjectLatLng) pts.push(subjectLatLng);
    compPoints.forEach((c) => pts.push(c.latLng));
    return pts;
  }, [subjectLatLng, compPoints]);

  if (!subjectLatLng) {
    return (
      <div
        style={{
          height,
          background: '#f3f4f6',
          color: '#6b7280',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          fontSize: 13,
          fontStyle: 'italic',
        }}
      >
        Subject is not geocoded — map unavailable.
      </div>
    );
  }

  return (
    <div
      id={id}
      ref={containerRef}
      style={{
        height,
        width: '100%',
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid #d1d5db',
      }}
    >
      <MapContainer
        center={subjectLatLng}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        // preferCanvas helps html2canvas capture cleanly
        preferCanvas={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // Cross-origin so html2canvas can capture tiles
          crossOrigin="anonymous"
        />

        {/* Subject — red star pin labeled "S" */}
        <Marker
          position={subjectLatLng}
          icon={buildPin({ label: 'S', color: '#dc2626', size: 34 })}
        >
          <Popup>
            <strong>SUBJECT</strong>
            <br />
            {subject?.address || ''}
            {subject?.block ? (
              <>
                <br />
                Block {subject.block}/{subject.lot}
                {subject.qualifier ? `/${subject.qualifier}` : ''}
              </>
            ) : null}
          </Popup>
        </Marker>

        {/* Comp markers — blue numbered */}
        {compPoints.map((c, idx) => (
          <Marker
            key={idx}
            position={c.latLng}
            icon={buildPin({ label: String(c.rank), color: '#2563eb', size: 28 })}
          >
            <Popup>
              <strong>COMP {c.rank}</strong>
              <br />
              {c.address}
              <br />
              Block {c.block}/{c.lot}
              {c.qualifier ? `/${c.qualifier}` : ''}
            </Popup>
          </Marker>
        ))}

        {/* Connector lines from subject to each comp */}
        {showLines &&
          compPoints.map((c, idx) => (
            <Polyline
              key={`line-${idx}`}
              positions={[subjectLatLng, c.latLng]}
              pathOptions={{
                color: '#2563eb',
                weight: 1.5,
                opacity: 0.45,
                dashArray: '4 4',
              }}
            />
          ))}

        <FitBounds points={allPoints} />
      </MapContainer>
    </div>
  );
};

export default AppealMap;
