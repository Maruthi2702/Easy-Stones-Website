import { useCallback, useEffect, useRef } from 'react';
import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import type { TeamPerson, Trail } from './types';

const COLOR = { live: '#2f9e63', earlier: '#d9822b', none: '#8a8f98' } as const;
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || '';
const OPTIONS: google.maps.MapOptions = {
  streetViewControl: false, mapTypeControl: false, fullscreenControl: false, gestureHandling: 'greedy', clickableIcons: false,
  ...(MAP_ID ? { mapId: MAP_ID } : {})
};
const US = { lat: 39.5, lng: -98.35 };

/**
 * Where the team is: one pin per person last seen today (green live, amber
 * earlier), and the picked person's trail for the day. Same Maps loader call
 * as the Route Planner, so the two never load Google twice.
 */
export default function TeamMap({ people, selectedId, trail, onSelect }: {
  people: TeamPerson[]; selectedId: string; trail: Trail | null; onSelect: (id: string) => void;
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });
  const mapRef = useRef<google.maps.Map | null>(null);

  const path = trail?.points.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [];
  const seen = people.filter((p) => p.lastSeen);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const spots = path.length ? path : seen.map((p) => ({ lat: p.lastSeen!.lat, lng: p.lastSeen!.lng }));
    if (!spots.length) return;
    if (spots.length === 1) { map.setCenter(spots[0]!); map.setZoom(14); return; }
    const bounds = new window.google.maps.LatLngBounds();
    spots.forEach((s) => bounds.extend(s));
    map.fitBounds(bounds, 48);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refit when what's shown changes, not on every render
  }, [selectedId, trail, people.length]);

  useEffect(() => { fit(); }, [fit]);

  if (!apiKey || loadError) {
    return <div className="tl-map-note" role="status">The map isn’t available. The list still shows who was seen and when.</div>;
  }
  if (!isLoaded) return <div className="tl-map-note" role="status">Loading the map…</div>;

  const dot = (color: string, scale: number): google.maps.Symbol => ({
    path: window.google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3
  });

  return (
    <GoogleMap mapContainerClassName="tl-map" center={US} zoom={4} options={OPTIONS} onLoad={(m) => { mapRef.current = m; fit(); }}>
      {path.length > 1 && <Polyline path={path} options={{ strokeColor: '#d4af37', strokeOpacity: 0.95, strokeWeight: 4 }} />}
      {path.length > 0 && <Marker position={path[0]!} title="First point" icon={dot('#ffffff', 5)} zIndex={1} />}
      {seen.map((p) => (
        <Marker
          key={p.id}
          position={{ lat: p.lastSeen!.lat, lng: p.lastSeen!.lng }}
          title={`${p.name} · ${p.ago}`}
          icon={dot(COLOR[p.status], p.id === selectedId ? 11 : 8)}
          zIndex={p.id === selectedId ? 3 : 2}
          onClick={() => onSelect(p.id)}
        />
      ))}
    </GoogleMap>
  );
}
