import { CONSENT_VERSION, inTrackingHours, isWeekdayAt, trackingDay, MAX_POINT_AGE_MS, MAX_POINTS_PER_BATCH, type RawPoint } from '../../utils/locationTracking';

export { CONSENT_VERSION };

/**
 * The phone side of location tracking (iOS app, 2026-11-19): when to collect,
 * which positions to keep, and how the unsent ones queue up. Pure; the server
 * re-checks everything (src/utils/locationTracking.ts), so these only save the
 * battery and the data.
 */
export const MIN_SECONDS_BETWEEN_POINTS = 45;
/**
 * Completeness first (owner, 2026-11-22): a point should leave the phone as soon as there is signal, so little
 * is on it if it dies. 30 s (was 60) and every 10 points (was 20); the server takes them in batches of 200.
 */
export const FLUSH_EVERY_MS = 30 * 1000;
export const FLUSH_AT = 10;
/** What the phone says about itself (battery, permission, what is waiting to send). */
export const HEARTBEAT_EVERY_MS = 5 * 60 * 1000;
export const BATTERY_CHECK_MS = 60 * 1000;
/**
 * A phone that hasn't moved sends nothing (the watcher fires on movement), which on the map is
 * indistinguishable from a dead phone. So while tracking runs it reads one position when none was kept for
 * this long: a gap on the manager's screen then really is missing data, not someone sitting still.
 */
export const STILL_EVERY_MS = 5 * 60 * 1000;
export const LOW_BATTERY_PCT = 15;
export const DYING_BATTERY_PCT = 5;
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

/** Time for a "still here" position: none kept for STILL_EVERY_MS (or none yet this run). */
export const needsStillPoint = (lastKeptAt: number | null, nowMs: number) => lastKeptAt === null || nowMs - lastKeptAt >= STILL_EVERY_MS;

export type DeviceState = {
  permission: 'always' | 'when-in-use' | 'denied' | 'unknown';
  lowPower: boolean; batteryPct: number | null; charging: boolean; appVersion: string;
};

/** The battery just fell to 15% or 5% (and isn't charging): flush and say so now, not in five minutes. */
export function batteryCrossed(before: number | null, after: number | null, charging: boolean): boolean {
  if (after === null || charging) return false;
  const was = before ?? 101;
  return (was > LOW_BATTERY_PCT && after <= LOW_BATTERY_PCT) || (was > DYING_BATTERY_PCT && after <= DYING_BATTERY_PCT);
}

/** The body of POST /heartbeat. */
export const heartbeatBody = (device: DeviceState, queued: number, now: Date) => ({
  permission: device.permission, lowPower: device.lowPower, batteryPct: device.batteryPct, charging: device.charging,
  appVersion: device.appVersion, queued, at: now.toISOString()
});

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

/**
 * The words that differ by phone. iPhone: Settings, "Always". Android: the app's permission page, "Allow all the time"
 * (a separate step Android asks for after location itself), and a battery setting phone makers need. Google Play requires the
 * in-app disclosure to say, before the permission prompt, that location is used when the app is closed or not in use.
 */
export type Platform = 'ios' | 'android' | 'web';
export function platformWords(platform: Platform) {
  if (platform === 'android') {
    return {
      settings: 'your phone’s Settings (Apps → Easy Surfaces → Permissions → Location)',
      settingsButton: 'Open Settings',
      background: 'including when the app is closed or not in use',
      next: 'Your phone will ask you to allow location next. Choose “Allow all the time” so this works when the app is closed.',
      battery: 'Some phones stop background apps to save battery. After you allow, set Battery for Easy Surfaces to “Unrestricted”.'
    };
  }
  return {
    settings: 'iPhone Settings',
    settingsButton: 'Open Settings',
    background: 'including when the app is in the background',
    next: 'iPhone will ask you to allow location next. Choose “Always” so this works when the app is closed.',
    battery: ''
  };
}

/**
 * The consent screen's one paragraph (version 3, 2026-11-22; owner: short, no detail on the tracking). Shared by the website's pop-up
 * and the React Native app's own screen. It still says when, why, who sees it and that a manager may ask outside work hours, so the
 * person agrees to what really happens; the wording of an older version is in git. Change it → bump CONSENT_VERSION.
 */
export const consentBody = (platform: Platform) =>
  `Allow Easy Surfaces to use your location during work hours, ${platformWords(platform).background}, to record your visits and show your manager where you are on the job. A manager may also request your location outside work hours.`;
