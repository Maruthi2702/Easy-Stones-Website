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
 * Hand a map link to the device. On a phone or an installed app, a new tab / window is a browser of
 * its own: iOS passes the link to the Google Maps app and leaves that browser sitting empty in front of
 * the app (the blank page this used to leave). So there the link goes to this window instead: the maps
 * app takes it and this page stays as it was. A laptop opens a new tab.
 */
export const openMapLink = (url: string): void => {
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & { standalone?: boolean };
    const standalone = nav.standalone === true || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
    const touch = /iPhone|iPad|iPod|Android/i.test(nav.userAgent || '') || ((nav.platform === 'MacIntel') && (nav.maxTouchPoints || 0) > 1);
    if (standalone || touch) { window.location.assign(url); return; }
    if (!window.open(url, '_blank', 'noopener,noreferrer')) window.location.assign(url);
};

/**
 * Directions to a stop's customer. The link is read when the menu opens (prepareDirections), so
 * the tap opens it at once; a tap before that reads the record first.
 */
export async function openDirections(customerId: string): Promise<DirectionsResult> {
    const hit = urls.get(customerId);
    const ready = hit && Date.now() - hit.at < TTL_MS ? hit.url : undefined;
    if (ready) { openMapLink(ready); return 'opened'; }
    if (ready === '') return 'no-address';
    const url = await lookUp(customerId);
    if (url === null) return 'failed';
    if (!url) return 'no-address';
    openMapLink(url);
    return 'opened';
}
