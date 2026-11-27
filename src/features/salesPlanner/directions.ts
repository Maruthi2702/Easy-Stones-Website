import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import { streetOf, cityLineOf } from '../../utils/customerList';
import type { Loose } from '../../types/records';

/** Which app a rep wants directions in. Remembered on this device only. */
export type MapsApp = 'google' | 'apple' | 'waze';

export const MAPS_APP_LABELS: Record<MapsApp, string> = { google: 'Google Maps', apple: 'Apple Maps', waze: 'Waze' };

const MAPS_APP_KEY = 'pl_maps_app';

const onAppleDevice = (): boolean => {
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator;
    return /iPhone|iPad|iPod|Macintosh/i.test(nav.userAgent || '') || nav.platform === 'MacIntel';
};

/** The apps offered here: Apple Maps only on an iPhone, iPad or Mac (elsewhere it is just a web page). */
export const mapsAppsHere = (): MapsApp[] => (onAppleDevice() ? ['google', 'apple', 'waze'] : ['google', 'waze']);

/** The remembered app, or Google Maps (what Directions always opened) when none was chosen or it isn't offered here. */
export const readMapsApp = (): MapsApp => {
    try {
        const saved = window.localStorage.getItem(MAPS_APP_KEY) as MapsApp | null;
        if (saved && mapsAppsHere().includes(saved)) return saved;
    } catch { /* private window: nothing remembered */ }
    return 'google';
};

export const saveMapsApp = (app: MapsApp): void => {
    try { window.localStorage.setItem(MAPS_APP_KEY, app); } catch { /* private window: not remembered */ }
};

/** Where to: the customer's stored point ("lat,lng"), else its address; '' when it has neither. */
export const destinationOf = (customer: Loose = {}): string => {
    const lat = customer.coordinates?.lat;
    const lng = customer.coordinates?.lng;
    return Number.isFinite(lat) && Number.isFinite(lng)
        ? `${lat},${lng}`
        : [streetOf(customer), cityLineOf(customer)].filter(Boolean).join(', ');
};

const IS_POINT = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

/** The directions link for a destination in the chosen app; '' when there is no destination. */
export const mapLinkFor = (destination: string, app: MapsApp = 'google'): string => {
    if (!destination) return '';
    const to = encodeURIComponent(destination);
    if (app === 'apple') return `https://maps.apple.com/?daddr=${to}&dirflg=d`;
    if (app === 'waze') return IS_POINT.test(destination) ? `https://waze.com/ul?ll=${to}&navigate=yes` : `https://waze.com/ul?q=${to}&navigate=yes`;
    return `https://www.google.com/maps/dir/?api=1&destination=${to}`;
};

/** Directions to the customer's stored point, else to its address; '' when it has neither. Google Maps unless another app is asked for. */
export const directionsUrlFor = (customer: Loose = {}, app: MapsApp = 'google'): string => mapLinkFor(destinationOf(customer), app);

export type DirectionsResult = 'opened' | 'no-address' | 'failed';

/** A stop carries its customer as an id or a populated object. */
export const customerIdOfStop = (item: { customerId?: unknown }): string => {
    const c = item.customerId as string | { _id?: unknown } | null | undefined;
    return typeof c === 'string' ? c : String(c?._id || '');
};

// The destination per customer, looked up when a stop's menu opens, so tapping Directions can open
// it in the same tap. (It used to open an empty tab first and point it at the map afterwards; on an
// iPhone Google Maps took over and the empty about:blank page was left sitting in the app.)
const TTL_MS = 2 * 60_000;
const urls = new Map<string, { destination: string; at: number }>();
const lookups = new Map<string, Promise<string | null>>();

/** Where a customer is ('' = no address), or null when the record couldn't be read. */
const lookUp = (customerId: string): Promise<string | null> => {
    const hit = urls.get(customerId);
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.destination);
    const running = lookups.get(customerId);
    if (running) return running;
    const started = (async () => {
        try {
            const response = await authFetch(`${API_URL}/api/customers/${customerId}`);
            if (!response.ok) return null;
            const destination = destinationOf(await response.json());
            urls.set(customerId, { destination, at: Date.now() });
            return destination;
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
export async function openDirections(customerId: string, app: MapsApp = readMapsApp()): Promise<DirectionsResult> {
    const hit = urls.get(customerId);
    const ready = hit && Date.now() - hit.at < TTL_MS ? hit.destination : undefined;
    if (ready) { openMapLink(mapLinkFor(ready, app)); return 'opened'; }
    if (ready === '') return 'no-address';
    const destination = await lookUp(customerId);
    if (destination === null) return 'failed';
    if (!destination) return 'no-address';
    openMapLink(mapLinkFor(destination, app));
    return 'opened';
}
