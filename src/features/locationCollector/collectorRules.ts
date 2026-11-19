import { CONSENT_VERSION, inTrackingHours, isWeekdayAt, trackingDay, MAX_POINT_AGE_MS, MAX_POINTS_PER_BATCH, type RawPoint } from '../../utils/locationTracking';

export { CONSENT_VERSION };

/**
 * The phone side of location tracking (iOS app, 2026-11-19): when to collect,
 * which positions to keep, and how the unsent ones queue up. Pure; the server
 * re-checks everything (src/utils/locationTracking.ts), so these only save the
 * battery and the data.
 */
export const MIN_SECONDS_BETWEEN_POINTS = 45;
export const FLUSH_EVERY_MS = 60 * 1000;
export const FLUSH_AT = 20;
export const STATUS_EVERY_MS = 5 * 60 * 1000;
export const MAX_QUEUE = 2000;

/** `consented`: the server has this person's agreement to the current wording (the only record that counts). */
export type TrackingStatus = {
  tracked: boolean; consented: boolean; branch: string; windowNow: boolean; windowStart: number; windowEnd: number; canView?: boolean;
  /** The branch-clock day the server answered for, whether tracking is on that day, and why not ('timeOff' | 'weekend'). */
  day?: string; dayOn?: boolean; dayOffReason?: '' | 'timeOff' | 'weekend';
};

/**
 * Is tracking on today? The server's answer for its day (time off, weekend work);
 * once the day has rolled over and the answer is old, the plain weekday rule
 * until the next status arrives.
 */
export const dayIsOn = (status: TrackingStatus, now: Date): boolean =>
  status.day && status.day === trackingDay(now, status.branch) && typeof status.dayOn === 'boolean'
    ? status.dayOn
    : isWeekdayAt(now, status.branch);

/** The status was answered for an earlier day: ask again. */
export const statusIsStale = (status: TrackingStatus | null, now: Date): boolean =>
  Boolean(status?.day) && status!.day !== trackingDay(now, status!.branch);
/** off: not tracked or not the app · needs-consent · denied: iOS location is off · running · waiting: tracked, outside 7–6. */
export type Phase = 'off' | 'needs-consent' | 'denied' | 'running' | 'waiting';

export function phaseFor(input: { status: TrackingStatus | null; denied: boolean; now: Date }): Phase {
  const { status, denied, now } = input;
  if (!status?.tracked) return 'off';
  if (!status.consented) return 'needs-consent';
  if (denied) return 'denied';
  return dayIsOn(status, now) && inTrackingHours(now, status.branch) ? 'running' : 'waiting';
}

export type PluginLocation = { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null; time?: number | null };

/** The server's point shape, or null for a location that isn't one. `rand` makes the id unique when two share a millisecond. */
export function toRawPoint(loc: PluginLocation, rand: string): RawPoint | null {
  const time = Number(loc.time);
  if (!Number.isFinite(time) || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
  return {
    id: `${Math.round(time)}-${rand}`, at: new Date(time).toISOString(), lat: loc.latitude, lng: loc.longitude,
    accuracy: loc.accuracy ?? undefined, speed: loc.speed != null && loc.speed >= 0 ? loc.speed : undefined
  };
}

/** Keep a point only if enough time has passed since the last kept one (a still phone reports often). */
export const shouldKeep = (lastKeptAt: number | null, at: number) =>
  lastKeptAt === null || at - lastKeptAt >= MIN_SECONDS_BETWEEN_POINTS * 1000;

/** Drop what the server would refuse as stale and cap the queue, keeping the newest. */
export function trimQueue(queue: RawPoint[], nowMs: number): RawPoint[] {
  const fresh = queue.filter((p) => nowMs - new Date(String(p.at)).getTime() <= MAX_POINT_AGE_MS);
  return fresh.length > MAX_QUEUE ? fresh.slice(fresh.length - MAX_QUEUE) : fresh;
}

/** The oldest batch to send, and what is left. */
export function takeBatch(queue: RawPoint[]) {
  return { batch: queue.slice(0, MAX_POINTS_PER_BATCH), rest: queue.slice(MAX_POINTS_PER_BATCH) };
}

/** "6 PM" for the banner, from the server's window end hour. */
export const untilText = (endHour: number) => {
  const h = endHour % 12 === 0 ? 12 : endHour % 12;
  return `${h} ${endHour < 12 ? 'AM' : 'PM'}`;
};
