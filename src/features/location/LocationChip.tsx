import { Crosshair, MapPin } from 'lucide-react';
import { markLabel } from '../../utils/visitLocation';
import type { LoggedFrom } from '../../utils/visitLocation';
import './Location.css';

/**
 * The mark on a visit or resource row: On site (green), Nearby (amber), "N mi away" (red),
 * "Location recorded" for calls and notes (grey), "Customer not on map" (grey). A target icon
 * so it can't be mistaken for the grey branch pin beside it.
 */
export default function LocationChip({ location }: { location: LoggedFrom | null | undefined }) {
    if (!location) return null;
    const tone = location.mark === 'onSite' ? 'ok' : location.mark === 'nearby' ? 'warn' : location.mark === 'away' ? 'bad' : 'none';
    const label = markLabel(location);
    return (
        <span className={`loc-chip loc-chip--${tone}`} title={`Where this was logged: ${label}`}>
            {tone === 'none' ? <MapPin size={11} aria-hidden="true" /> : <Crosshair size={11} aria-hidden="true" />}
            {label}
        </span>
    );
}
