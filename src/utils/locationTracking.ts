/**
 * Location tracking for the iOS app (2026-11-19, owner's ask: managers see
 * where their sales reps and drivers are). Every rule is here, shared by the
 * server (what it keeps) and the app (when it collects), so they can't differ.
 *
 *   When     7:00 AM up to 6:00 PM on the person's BRANCH clock, Monday to
 *            Friday. The app stops itself at 6 PM and the server drops any
 *            point stamped outside the window, so an old app version or a
 *            bug can't record anyone at night.
 *   Who      a role with `track_location` is tracked; a role with
 *            `view_team_locations` sees the people on its team (teamScope.ts,
 *            by the rep's branch). Nobody holds either until an admin ticks
 *            it — suppliers have no staff role, so they are never tracked.
 *   Kept     90 days, then deleted.
 *
 * Which days: Monday–Friday, except a day the person logged **Personal Time Off**
 * (an Office visit, src/utils/officeAccounts.ts); a Saturday or Sunday only when they
 * have scheduled work — a calendar entry (not cancelled) or, for a driver, a delivery
 * on their column — that day (`DayFacts`, `trackingDayOn`). An In-office admin day
 * is a normal workday. Facts are read per request (src/db/locationPoints/workDays.ts).
 * Pure: no database, no DOM. Tested in locationTracking.test.ts.
 */
import { branchZone } from '../config/branches.ts';

export const TRACKING = Object.freeze({
  /** Users & Roles → Location card: this role's people are tracked. */
  TRACKED: 'track_location',
  /** Users & Roles → Location card: see where the people on one's team are. */
  VIEW_TEAM: 'view_team_locations'
});

/** The consent wording's version (src/features/locationCollector). Bump it when the wording changes: everyone is asked again. */
export const CONSENT_VERSION = 1;

/** The visit type that marks a day off (an Office visit, src/utils/officeAccounts.ts OFFICE_VISIT_TYPES). */
export const TIME_OFF_VISIT_TYPE = 'Personal Time Off';

export const WINDOW_START_HOUR = 7;
export const WINDOW_END_HOUR = 18;
export const RETENTION_DAYS = 90;
/** A batch from the phone is at most this many points (it sends the backlog after a dead spot in pieces). */
export const MAX_POINTS_PER_BATCH = 200;
/** A point older than this on arrival is dropped (a phone that was offline all night). */
export const MAX_POINT_AGE_MS = 24 * 60 * 60 * 1000;
/** A point stamped further ahead than this (a wrong phone clock) is dropped. */
export const MAX_FUTURE_MS = 5 * 60 * 1000;
/** Worse than this and the position is too vague to put on a map. */
export const MAX_ACCURACY_METRES = 500;
/** Seen within this long = "Live"; within the next stretch = "Recently"; else "Last seen …". */
export const LIVE_MS = 10 * 60 * 1000;

export const canBeTracked = (user: { permissions?: string[] } | null | undefined) =>
  Boolean(user?.permissions?.includes(TRACKING.TRACKED));
export const canViewTeamLocations = (user: { permissions?: string[] } | null | undefined) =>
  Boolean(user?.permissions?.includes(TRACKING.VIEW_TEAM));

const parts = (at: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const got = Object.fromEntries(f.formatToParts(at).map(p => [p.type, p.value]));
  return { weekday: String(got.weekday), hour: Number(got.hour), minute: Number(got.minute) };
};

/** What the person's records say about one day (read by the server; the phone gets today's answer in /status). */
export type DayFacts = { timeOff: boolean; scheduledWork: boolean };
export const NO_FACTS: DayFacts = Object.freeze({ timeOff: false, scheduledWork: false });

/** Whether tracking is on for a day: not time off, and a weekday or a day with scheduled work. */
export const trackingDayOn = (weekday: boolean, facts: DayFacts = NO_FACTS): boolean =>
  !facts.timeOff && (weekday || facts.scheduledWork);

/** Why a day is off, in words for the phone and the manager ('' when it's on). */
export const dayOffReason = (weekday: boolean, facts: DayFacts = NO_FACTS): '' | 'timeOff' | 'weekend' =>
  facts.timeOff ? 'timeOff' : weekday || facts.scheduledWork ? '' : 'weekend';

/** True on Monday to Friday on the branch's clock. */
export const isWeekdayAt = (at: Date, branch: string): boolean => {
  const { weekday } = parts(at, branchZone(branch));
  return weekday !== 'Sat' && weekday !== 'Sun';
};

/** True between 7:00 AM and 6:00 PM on the branch's clock, whatever the day. */
export function inTrackingHours(at: Date, branch: string): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const { hour } = parts(at, branchZone(branch));
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * True when `at` is inside 7:00 AM–6:00 PM on that branch's clock on a day tracking is on.
 * Without `facts` that is Monday to Friday; the server passes the day's facts.
 */
export function inTrackingWindow(at: Date, branch: string, facts: DayFacts = NO_FACTS): boolean {
  if (Number.isNaN(at.getTime())) return false;
  return trackingDayOn(isWeekdayAt(at, branch), facts) && inTrackingHours(at, branch);
}

/** The calendar day (YYYY-MM-DD) on the branch's clock — a day's trail is read by it. */
export const trackingDay = (at: Date, branch: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: branchZone(branch), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** [start, end) instants of a branch-clock day (YYYY-MM-DD), found by bisecting the offset so DST days are right. */
export function dayBounds(day: string, branch: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const zone = branchZone(branch);
  const at = (d: string) => {
    // Local midnight of d in zone: start from UTC midnight and correct by the zone's offset there.
    const guess = new Date(`${d}T00:00:00Z`);
    if (Number.isNaN(guess.getTime())) return null;
    for (let i = 0; i < 3; i++) {
      const shown = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(guess).reduce<Record<string, string>>((o, p) => (p.type === 'literal' ? o : { ...o, [p.type]: p.value }), {});
      const asUtc = Date.UTC(+shown.year, +shown.month - 1, +shown.day, +shown.hour, +shown.minute, +shown.second);
      const want = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
      const diff = want - asUtc;
      if (diff === 0) return guess;
      guess.setTime(guess.getTime() + diff);
    }
    return guess;
  };
  const from = at(day);
  if (!from) return null;
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const to = at(next.toISOString().slice(0, 10));
  return to ? { from, to } : null;
}

export type RawPoint = { id?: unknown; at?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown; speed?: unknown };
export type CleanPoint = { clientId: string; recordedAt: Date; lat: number; lng: number; accuracyM: number | null; speedMps: number | null };

/**
 * What a batch from the phone is allowed to keep: real coordinates, a real
 * time not in the future and not stale, inside the window on the person's
 * branch clock, accurate enough to map. Everything else is counted as dropped,
 * not an error — a phone that sends the backlog must still get a 200.
 * `id` is the phone's own id for the point, so a repeated batch saves nothing twice.
 */
export function cleanPoints(raw: unknown, branch: string, now: Date = new Date(), factsFor?: (day: string) => DayFacts) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_POINTS_PER_BATCH) : [];
  const kept: CleanPoint[] = [];
  const dropped = { invalid: 0, outsideWindow: 0, stale: 0, vague: 0, tooMany: Math.max(0, (Array.isArray(raw) ? raw.length : 0) - MAX_POINTS_PER_BATCH) };
  const seen = new Set<string>();
  for (const item of list) {
    const p = (item && typeof item === 'object' ? item : {}) as RawPoint;
    const at = new Date(typeof p.at === 'string' || typeof p.at === 'number' ? p.at : NaN);
    const lat = Number(p.lat), lng = Number(p.lng);
    const clientId = typeof p.id === 'string' ? p.id.trim().slice(0, 64) : '';
    if (!clientId || Number.isNaN(at.getTime()) || !Number.isFinite(lat) || !Number.isFinite(lng)
      || p.lat === null || p.lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { dropped.invalid++; continue; }
    if (at.getTime() - now.getTime() > MAX_FUTURE_MS || now.getTime() - at.getTime() > MAX_POINT_AGE_MS) { dropped.stale++; continue; }
    if (!inTrackingWindow(at, branch, factsFor?.(trackingDay(at, branch)))) { dropped.outsideWindow++; continue; }
    const accuracy = p.accuracy === undefined || p.accuracy === null ? null : Number(p.accuracy);
    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METRES)) { dropped.vague++; continue; }
    if (seen.has(clientId)) continue;
    seen.add(clientId);
    const speed = p.speed === undefined || p.speed === null ? null : Number(p.speed);
    kept.push({ clientId, recordedAt: at, lat, lng, accuracyM: accuracy, speedMps: speed !== null && Number.isFinite(speed) && speed >= 0 ? speed : null });
  }
  return { kept, dropped };
}

/** The instant before which points are deleted. */
export const retentionCutoff = (now: Date = new Date()) => new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

export type SeenStatus = 'live' | 'earlier' | 'none';
/** "Live" (within 10 minutes), "earlier" (today, older), or none. */
export function seenStatus(lastAt: Date | null | undefined, now: Date = new Date()): SeenStatus {
  if (!lastAt) return 'none';
  return now.getTime() - lastAt.getTime() <= LIVE_MS ? 'live' : 'earlier';
}

/** "4 min ago", "2 h ago" — for the manager's list. */
export function agoText(lastAt: Date | null | undefined, now: Date = new Date()): string {
  if (!lastAt) return 'No location today';
  const min = Math.max(0, Math.round((now.getTime() - lastAt.getTime()) / 60000));
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** Miles along a trail (points in order), by great-circle steps; gaps over 30 min are not counted as driving. */
export function trailMiles(points: { lat: number; lng: number; at: Date }[]): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.at.getTime() - a.at.getTime() > 30 * 60 * 1000) continue;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return Math.round(total * 10) / 10;
}
