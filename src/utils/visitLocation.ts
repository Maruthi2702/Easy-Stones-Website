/**
 * Where a visit or resource was logged (owner, 2026-11-19; design: claude.ai
 * artifact "Visit location stamp", https://claude.ai/artifact/Fiu5mUw8yn7ftVsEbHggRK).
 *
 * Every new visit and resource carries one reading of the logger's position,
 * taken when the form opens. The server measures its distance to the
 * customer's map pin and stores the result once (`loggedFrom` on the visit; a
 * resource's is on its placement visit). The browser is never trusted for the
 * mark. Shared by the server and the screens.
 */

export type LocationDevice = 'phone' | 'computer';
export type LocationMark = 'onSite' | 'nearby' | 'away' | 'recorded' | 'noPin';

/** What the browser sends: a single reading. */
export interface LocationReading {
  lat: number;
  lng: number;
  /** The browser's accuracy radius, in metres. */
  accuracyM: number;
  /** When the browser took it (epoch ms), so a form left open for hours can't pass an old one off. */
  takenAtMs: number;
  device: LocationDevice;
}

/** What is stored. */
export interface LoggedFrom {
  lat: number;
  lng: number;
  accuracyM: number;
  /** The server's local clock when it was saved (getNowLocalISO). */
  readAt: string;
  /** Metres to the customer's pin then; null when the mark doesn't judge distance. */
  distanceM: number | null;
  mark: LocationMark;
  device: LocationDevice;
  /** True when the accuracy radius is over 150 m (most computers). */
  approximate: boolean;
}

/** Within 0.25 mi of the customer's pin. */
export const ON_SITE_METERS = 402;
/** Within 1 mi: Nearby. Past it the distance is shown. */
export const NEARBY_METERS = 1609;
/** On site is only claimed for a reading at least this accurate. */
export const ON_SITE_MAX_ACCURACY_M = 400;
/** Over this radius the mark says "approx.". */
export const APPROXIMATE_OVER_M = 150;
/** A reading older than this is refused. */
export const MAX_READING_AGE_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The visit types that judge distance; every other type keeps the reading as "recorded". */
const IN_PERSON = /^(scheduledinperson|unscheduledinperson|resourceplacement|resourceupdate|formalpresentation)/;
const squash = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
export const isInPersonType = (purpose: unknown): boolean => IN_PERSON.test(squash(purpose));

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A reading from a request body, or null when it isn't a real one. */
export function parseReading(input: unknown): LocationReading | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const lat = num(o.lat), lng = num(o.lng), accuracyM = num(o.accuracyM), takenAtMs = num(o.takenAtMs);
  if (lat === null || lng === null || accuracyM === null || takenAtMs === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracyM < 0) return null;
  if (lat === 0 && lng === 0) return null; // the "null island" a broken device sends
  const device: LocationDevice = o.device === 'phone' ? 'phone' : 'computer';
  return { lat, lng, accuracyM: Math.round(accuracyM), takenAtMs, device };
}

/** Why a reading can't be used right now, or '' when it can. */
export function readingProblem(reading: LocationReading, nowMs: number): string {
  const age = nowMs - reading.takenAtMs;
  if (age > MAX_READING_AGE_MS) return 'Your location is out of date. Close the form and open it again.';
  if (age < -CLOCK_SKEW_MS) return 'Your device clock looks wrong, so the location can\'t be used.';
  return '';
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h))));
}

export type Pin = { lat?: number | null; lng?: number | null } | null | undefined;

/** The stored `loggedFrom` for a new visit: distance and mark worked out here. */
export function loggedFromFor(reading: LocationReading, { purpose, pin, readAt }: { purpose: unknown; pin: Pin; readAt: string }): LoggedFrom {
  const base = {
    lat: reading.lat, lng: reading.lng, accuracyM: reading.accuracyM, readAt, device: reading.device,
    approximate: reading.accuracyM > APPROXIMATE_OVER_M
  };
  if (!isInPersonType(purpose)) return { ...base, distanceM: null, mark: 'recorded' };
  const hasPin = pin && num(pin.lat) !== null && num(pin.lng) !== null && !(pin.lat === 0 && pin.lng === 0);
  if (!hasPin) return { ...base, distanceM: null, mark: 'noPin' };
  const distanceM = distanceMeters(reading, { lat: pin!.lat as number, lng: pin!.lng as number });
  let mark: LocationMark = 'away';
  if (distanceM <= ON_SITE_METERS && reading.accuracyM <= ON_SITE_MAX_ACCURACY_M) mark = 'onSite';
  else if (distanceM <= NEARBY_METERS) mark = 'nearby';
  return { ...base, distanceM, mark };
}

/**
 * A visit without its `loggedFrom`. Who may see where a visit was logged is a
 * Users & Roles switch that isn't built yet, so until it is, the routes that answer
 * with a visit they didn't just create leave it out (a new visit's own answer
 * carries it back to the person who logged it).
 */
export const withoutLoggedFrom = <T extends object | null | undefined>(visit: T): T => {
  if (!visit || typeof visit !== 'object' || !('loggedFrom' in visit)) return visit;
  const { loggedFrom: _hidden, ...rest } = visit as Record<string, unknown>;
  return rest as T;
};

/** "0.1 mi" / "12 mi" from metres. */
export function milesText(metres: number): string {
  const mi = metres / 1609.344;
  return mi < 1 ? `${(Math.round(mi * 10) / 10).toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/** The chip's words, e.g. "On site", "Nearby · 0.6 mi", "18 mi away", "Location recorded". */
export function markLabel(l: Pick<LoggedFrom, 'mark' | 'distanceM' | 'approximate'>): string {
  const tail = l.approximate ? ' · approx.' : '';
  const d = l.distanceM === null ? '' : milesText(l.distanceM);
  switch (l.mark) {
    case 'onSite': return `On site${tail}`;
    case 'nearby': return `Nearby · ${d}${tail}`;
    case 'away': return `${d} away${tail}`;
    case 'noPin': return 'Customer not on map';
    default: return 'Location recorded';
  }
}

/** Phone or computer, from the browser's own words. */
export function deviceKind(userAgent: string, maxTouchPoints = 0): LocationDevice {
  const ua = String(userAgent || '');
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(ua)) return 'phone';
  if (/iPad|Android/i.test(ua)) return 'phone'; // a tablet in the field reads like a phone
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'phone'; // iPadOS says "Macintosh"
  return 'computer';
}

/** The dashboard's "Where logged" filter. `older` = no reading (saved before location was recorded, or not one the viewer may see). */
export type WhereFilter = 'any' | 'onSite' | 'nearby' | 'away' | 'older';
export const WHERE_FILTERS: { value: WhereFilter; label: string }[] = [
  { value: 'any', label: 'Any' }, { value: 'onSite', label: 'On site' }, { value: 'nearby', label: 'Nearby' },
  { value: 'away', label: 'Away' }, { value: 'older', label: 'No reading' }
];

/** Whether a visit's reading (or lack of one) passes the filter. Calls, notes and "customer not on map" have no verdict, so only Any and No reading show them. */
export const matchesWhere = (reading: Pick<LoggedFrom, 'mark'> | null | undefined, filter: WhereFilter): boolean => {
  if (filter === 'any') return true;
  if (filter === 'older') return !reading;
  return reading?.mark === filter;
};

/** How many of these have a verdict (in person, with a pin) and how many of those were On site: By rep's column. */
export const onSiteTally = (readings: Array<Pick<LoggedFrom, 'mark'> | null | undefined>) => {
  let judged = 0, onSite = 0;
  for (const r of readings) {
    if (!r || (r.mark !== 'onSite' && r.mark !== 'nearby' && r.mark !== 'away')) continue;
    judged++;
    if (r.mark === 'onSite') onSite++;
  }
  return { judged, onSite };
};

/** Google Maps link to a point. */
export const mapsLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;

/** The three Excel columns for a visit or resource that has (or lacks) a reading: Where Logged, Distance From Customer, Logged From. "-" when there is none. */
export const locationExportColumns = (reading: LoggedFrom | null | undefined) => ({
  'Where Logged': reading ? markLabel(reading) : '-',
  'Distance From Customer': reading && reading.distanceM !== null ? milesText(reading.distanceM) : '-',
  'Logged From': reading ? `${reading.device === 'phone' ? 'Phone' : 'Computer'}${reading.approximate ? ' (approximate)' : ''}` : '-'
});
