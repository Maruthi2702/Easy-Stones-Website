import { useCallback, useEffect, useMemo, useRef } from 'react';
import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { trailSegments } from '../../utils/locationTrail';
import type { LocateRequest, TeamPerson, Trail } from './types';

const COLOR = { live: '#2f9e63', earlier: '#d9822b', none: '#8a8f98' } as const;
/** A person who should be reporting but isn't (battery, permission…): ringed red so the map shows who needs a look. */
const QUIET = '#d64545';
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
export default function TeamMap({ people, selectedId, trail, onSelect, requested = null }: {
  people: TeamPerson[]; selectedId: string; trail: Trail | null; onSelect: (id: string) => void;
  /** An answered "Locate now" ask for the picked person: drawn as a ring, separate from the day's trail. */
  requested?: LocateRequest | null;
}) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useJsApiLoader({ id: 'google-map-script', googleMapsApiKey: apiKey || '' });
  const mapRef = useRef<google.maps.Map | null>(null);

  // The trail is cut where the phone sent nothing for a while: never a straight line across a gap, a dashed one marks it.
  const { segments } = useMemo(() => trailSegments((trail?.points ?? []).map((p) => ({ lat: p.lat, lng: p.lng, at: new Date(p.at) }))), [trail]);
  const path = segments.flat().map((p) => ({ lat: p.lat, lng: p.lng }));
  const seen = people.filter((p) => p.lastSeen);
  const answered = requested?.status === 'answered' && requested.lat !== null && requested.lng !== null ? { lat: requested.lat, lng: requested.lng } : null;

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const spots = path.length ? path : seen.map((p) => ({ lat: p.lastSeen!.lat, lng: p.lastSeen!.lng }));
    if (answered) spots.push(answered);
    if (!spots.length) return;
    if (spots.length === 1) { map.setCenter(spots[0]!); map.setZoom(14); return; }
    const bounds = new window.google.maps.LatLngBounds();
    spots.forEach((s) => bounds.extend(s));
    map.fitBounds(bounds, 48);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refit when what's shown changes, not on every render
  }, [selectedId, trail, people.length, requested?.id, requested?.status]);

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
      {segments.map((seg, i) => seg.length > 1 && (
        <Polyline key={`s${i}`} path={seg.map((p) => ({ lat: p.lat, lng: p.lng }))} options={{ strokeColor: '#d4af37', strokeOpacity: 0.95, strokeWeight: 4 }} />
      ))}
      {segments.slice(1).map((seg, i) => (
        <Polyline key={`g${i}`} path={[segments[i]![segments[i]!.length - 1]!, seg[0]!].map((p) => ({ lat: p.lat, lng: p.lng }))}
          options={{ strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, strokeColor: '#9aa3af', scale: 3 }, offset: '0', repeat: '14px' }] }} />
      ))}
      {path.length > 0 && <Marker position={path[0]!} title="First point" icon={dot('#ffffff', 5)} zIndex={1} />}
      {answered && (
        <Marker position={answered} title={`Requested location · ${requested!.answeredAt ? new Date(requested!.answeredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}`}
          icon={{ ...dot('#3b82f6', 10), strokeWeight: 4 }} zIndex={4} />
      )}
      {seen.map((p) => (
        <Marker
          key={p.id}
          position={{ lat: p.lastSeen!.lat, lng: p.lastSeen!.lng }}
          title={`${p.name} · ${p.ago}${p.quiet ? ` · ${p.quiet.text}` : ''}`}
          icon={p.quiet ? { ...dot(COLOR[p.status], p.id === selectedId ? 11 : 8), strokeColor: QUIET, strokeWeight: 4 } : dot(COLOR[p.status], p.id === selectedId ? 11 : 8)}
          zIndex={p.id === selectedId ? 3 : 2}
          onClick={() => onSelect(p.id)}
        />
      ))}
    </GoogleMap>
  );
}
