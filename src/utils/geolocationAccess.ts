/**
 * Location on the Route Planner, without asking on every visit.
 *
 * Every new visit and resource must carry a reading (src/features/location/), and the
 * form that adds one asks for it when it opens. (An "Allow location" sheet on opening
 * the app existed 2026-11-19 to 2026-11-20 and was removed at the owner's request.)
 * Everything below still holds: the browser's permission belongs to the whole site,
 * so once it's allowed the planner follows quietly.
 *
 * The browser owns the permission (a website can't grant itself location, or
 * keep it past what the browser allows), so this does the two things that are
 * ours: the map opens on the last known spot and, from 2026-11-27 (owner: "show
 * them where they are when they open the map"), asks for the position as it
 * opens — once; a refusal is remembered and only a tap on Locate asks again —
 * and, once it's allowed, follows their position quietly. "Allow" in the browser's site
 * settings is what makes that last across visits; Safari's "Allow once" and a
 * home-screen app on iPhone can still forget, and then Locate asks again.
 */

const LAST_KEY = 'rp_last_position';
const OK_KEY = 'rp_location_ok';
const REFUSED_KEY = 'rp_location_refused';

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
export const rememberPosition = ({ lat, lng }: { lat: unknown; lng: unknown }): void => {
  if (!isPoint({ lat, lng })) return;
  write(LAST_KEY, JSON.stringify({ lat, lng }));
  write(OK_KEY, '1');
  remove(REFUSED_KEY);
};

/** The browser said no: stop assuming it works, and don't ask again on open (Locate still can). */
export const forgetLocationOk = () => { remove(OK_KEY); write(REFUSED_KEY, '1'); };

export const locationWasOk = (): boolean => read(OK_KEY) === '1';

/** Whether the last attempt was refused, so opening the map doesn't ask again. */
export const locationWasRefused = (): boolean => read(REFUSED_KEY) === '1';

/** 'granted' | 'prompt' | 'denied' | 'unknown' (a browser that can't say). */
export type LocationPermission = PermissionState | 'unknown';

export const locationPermission = async (): Promise<LocationPermission> => {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch { return 'unknown'; }
};

/**
 * Whether to read the position when the map opens, without a tap on Locate, so
 * the "You" dot is there straight away: yes when the browser says it's allowed,
 * and also when it says to prompt or can't say — the browser (or the app) asks
 * the first time. Never when it says denied, and not again after a refusal until
 * a tap on Locate succeeds.
 */
export const shouldAutoLocate = (permission: LocationPermission, refused: unknown): boolean =>
  permission === 'granted' || (permission !== 'denied' && !refused);
