/**
 * Location on the Route Planner, without asking on every visit.
 *
 * The browser owns the permission (a website can't grant itself location, or
 * keep it past what the browser allows), so this does the two things that are
 * ours: never ask unprompted — the map opens on the last known spot and only a
 * tap on Locate asks — and, once someone has allowed it (the browser says
 * "granted", or an earlier fix succeeded on a browser that can't say), follow
 * their position quietly without a prompt. "Allow" in the browser's site
 * settings is what makes that last across visits; Safari's "Allow once" and a
 * home-screen app on iPhone can still forget, and then Locate asks again.
 */

const LAST_KEY = 'rp_last_position';
const OK_KEY = 'rp_location_ok';

const read = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { window.localStorage.setItem(key, value); } catch { /* private window: nothing remembered */ } };
const remove = (key: string): void => { try { window.localStorage.removeItem(key); } catch { /* as above */ } };

export type LatLng = { lat: number; lng: number };

const isPoint = (p: { lat?: unknown; lng?: unknown } | null | undefined): p is LatLng => Boolean(p) && Number.isFinite((p as LatLng).lat) && Number.isFinite((p as LatLng).lng) && Math.abs((p as LatLng).lat) <= 90 && Math.abs((p as LatLng).lng) <= 180;

/** The last fix this device made, { lat, lng }, or null. */
export const readLastPosition = (): LatLng | null => {
  try {
    const p = JSON.parse(read(LAST_KEY) || 'null');
    return isPoint(p) ? { lat: p.lat, lng: p.lng } : null;
  } catch { return null; }
};

/** A fix succeeded: remember where, and that location works here. */
export const rememberPosition = ({ lat, lng }: LatLng): void => {
  if (!isPoint({ lat, lng })) return;
  write(LAST_KEY, JSON.stringify({ lat, lng }));
  write(OK_KEY, '1');
};

/** The browser said no: stop assuming it works. */
export const forgetLocationOk = () => remove(OK_KEY);

export const locationWasOk = (): boolean => read(OK_KEY) === '1';

/** 'granted' | 'prompt' | 'denied' | 'unknown' (a browser that can't say). */
export type LocationPermission = PermissionState | 'unknown';

export const locationPermission = async (): Promise<LocationPermission> => {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch { return 'unknown'; }
};

/**
 * Whether to read the position without anyone tapping: yes when the browser
 * says it's granted; when it can't say, only if a fix worked before; never
 * when it says to prompt or denied.
 */
export const shouldAutoLocate = (permission: LocationPermission, wasOk: unknown): boolean =>
  permission === 'granted' || (permission === 'unknown' && Boolean(wasOk));
