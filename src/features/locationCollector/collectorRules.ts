import { inTrackingWindow, MAX_POINT_AGE_MS, MAX_POINTS_PER_BATCH, type RawPoint } from '../../utils/locationTracking';

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
/** Bump when the consent wording changes: everyone is asked again. */
export const CONSENT_VERSION = 1;

export type TrackingStatus = { tracked: boolean; branch: string; windowNow: boolean; windowStart: number; windowEnd: number; canView?: boolean };
/** off: not tracked or not the app · needs-consent · denied: iOS location is off · running · waiting: tracked, outside 7–6. */
export type Phase = 'off' | 'needs-consent' | 'denied' | 'running' | 'waiting';

export function phaseFor(input: { status: TrackingStatus | null; consented: boolean; denied: boolean; now: Date }): Phase {
  const { status, consented, denied, now } = input;
  if (!status?.tracked) return 'off';
  if (!consented) return 'needs-consent';
  if (denied) return 'denied';
  return inTrackingWindow(now, status.branch) ? 'running' : 'waiting';
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
