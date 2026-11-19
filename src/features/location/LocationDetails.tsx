import { ExternalLink } from 'lucide-react';
import { mapsLink, milesText } from '../../utils/visitLocation';
import type { LoggedFrom } from '../../utils/visitLocation';
import { formatDate } from '../../utils/dateUtils';
import LocationChip from './LocationChip';
import './Location.css';

/**
 * "Where it was logged" in the Visit view and View resource: the mark, how far from the
 * customer's pin, when it was read and how accurate, the device, and a Google Maps link to
 * the point. Only rendered when the caller may see the reading (the server leaves it out
 * otherwise). `day` is the visit's own date: a reading taken on another day says so.
 */
export default function LocationDetails({ location, day }: { location: LoggedFrom | null | undefined; day?: string }) {
    if (!location) return null;
    const readDay = String(location.readAt || '').slice(0, 10);
    const later = Boolean(day) && /^\d{4}-\d{2}-\d{2}$/.test(readDay) && readDay !== String(day).slice(0, 10);
    const time = String(location.readAt || '').slice(11, 16);
    const accuracy = location.accuracyM < 1000 ? `${location.accuracyM} m` : `${(location.accuracyM / 1000).toFixed(1)} km`;
    return (
        <section className="loc-details" aria-label="Where it was logged">
            <h3>Where it was logged</h3>
            <dl>
                <div><dt>Mark</dt><dd><LocationChip location={location} /></dd></div>
                {location.distanceM !== null && <div><dt>Distance</dt><dd>{milesText(location.distanceM)} from the customer's pin</dd></div>}
                <div><dt>Read</dt><dd>{[time, `accurate to about ${accuracy}`].filter(Boolean).join(' · ')}</dd></div>
                {later && <div><dt>Logged on</dt><dd>{formatDate(readDay, { month: 'short', day: 'numeric' })}, after this entry's date</dd></div>}
                <div><dt>Device</dt><dd>{location.device === 'phone' ? 'Phone' : 'Computer'}{location.approximate ? ' · approximate' : ''}</dd></div>
            </dl>
            <a className="loc-details-link" href={mapsLink(location)} target="_blank" rel="noopener noreferrer">
                Open the point in Google Maps <ExternalLink size={13} aria-hidden="true" />
            </a>
        </section>
    );
}
