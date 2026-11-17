import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { streetOf, cityLineOf } from '../../utils/customerList';
import type { Loose } from '../../types/records';

/** Google Maps directions to the customer's stored point, else to its address; '' when it has neither. */
export const directionsUrlFor = (customer: Loose = {}): string => {
    const lat = customer.coordinates?.lat;
    const lng = customer.coordinates?.lng;
    const destination = Number.isFinite(lat) && Number.isFinite(lng)
        ? `${lat},${lng}`
        : [streetOf(customer), cityLineOf(customer)].filter(Boolean).join(', ');
    return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : '';
};

export type DirectionsResult = 'opened' | 'no-address' | 'failed';

/** A stop carries its customer as an id or a populated object. */
export const customerIdOfStop = (item: { customerId?: unknown }): string => {
    const c = item.customerId as string | { _id?: unknown } | null | undefined;
    return typeof c === 'string' ? c : String(c?._id || '');
};

// The map link per customer, looked up when a stop's menu opens, so tapping Directions can open
// it in the same tap. (It used to open an empty tab first and point it at the map afterwards; on an
// iPhone Google Maps took over and the empty about:blank page was left sitting in the app.)
const TTL_MS = 2 * 60_000;
const urls = new Map<string, { url: string; at: number }>();
const lookups = new Map<string, Promise<string | null>>();

/** The map link for a customer ('' = no address), or null when the record couldn't be read. */
const lookUp = (customerId: string): Promise<string | null> => {
    const hit = urls.get(customerId);
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.url);
    const running = lookups.get(customerId);
    if (running) return running;
    const started = (async () => {
        try {
            const response = await authFetch(`${API_URL}/api/customers/${customerId}`);
            if (!response.ok) return null;
            const url = directionsUrlFor(await response.json());
            urls.set(customerId, { url, at: Date.now() });
            return url;
        } catch {
            return null;
        } finally {
            lookups.delete(customerId);
        }
    })();
    lookups.set(customerId, started);
    return started;
};

/** Read the customer now (a stop's menu just opened) so Directions can open at once. */
export const prepareDirections = (customerId: string): void => { if (customerId) void lookUp(customerId); };

/**
 * Directions to a stop's customer. When the link is ready (prepareDirections ran as the menu
 * opened) it opens in the same tap, with no placeholder tab. If the tap came first, the record is
 * read, then opened; if the browser blocks that, this page goes to the map instead of
 * leaving the person with nothing.
 */
export async function openDirections(customerId: string): Promise<DirectionsResult> {
    const hit = urls.get(customerId);
    const ready = hit && Date.now() - hit.at < TTL_MS ? hit.url : undefined;
    if (ready) { window.open(ready, '_blank', 'noopener,noreferrer'); return 'opened'; }
    if (ready === '') return 'no-address';
    const url = await lookUp(customerId);
    if (url === null) return 'failed';
    if (!url) return 'no-address';
    if (!window.open(url, '_blank', 'noopener,noreferrer')) window.location.assign(url);
    return 'opened';
}
