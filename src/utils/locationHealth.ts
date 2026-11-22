/**
 * What the phone says about itself, and what a manager is told when someone goes quiet (location v2,
 * 2026-11-22). Pure: no database, no DOM. Shared by the server (parses a heartbeat, writes the
 * reason into the live list) and the screens. Tested in locationHealth.test.ts.
 *
 * A heartbeat is sent every few minutes and with each batch; it never carries a position. It is how
 * "No location since 2:14 PM" becomes "Battery 3% at 2:14 PM" or "Location set to While Using".
 */
export const PERMISSIONS = ['always', 'when-in-use', 'denied', 'unknown'] as const;
export type Permission = typeof PERMISSIONS[number];

/** The phone is "quiet" when its newest point is older than this while the window is open. */
export const QUIET_MS = 12 * 60 * 1000;
/** A battery at or under this and not charging is the likely reason a phone went quiet. */
export const LOW_BATTERY_PCT = 15;
export const DYING_BATTERY_PCT = 5;
/** A heartbeat older than this is too old to explain anything. */
export const HEARTBEAT_FRESH_MS = 30 * 60 * 1000;
export const MAX_QUEUED = 100_000;

export type Heartbeat = {
  permission: Permission; lowPower: boolean; batteryPct: number | null; charging: boolean;
  appVersion: string; queued: number; reportedAt: Date;
};

/** A heartbeat body cleaned, or null when it isn't one (a missing or future time falls back to `now`). */
export function parseHeartbeat(raw: unknown, now: Date = new Date()): Heartbeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const permission = PERMISSIONS.includes(r.permission as Permission) ? (r.permission as Permission) : 'unknown';
  const pct = r.batteryPct === null || r.batteryPct === undefined ? null : Number(r.batteryPct);
  const batteryPct = pct !== null && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct) : null;
  const queued = Math.min(MAX_QUEUED, Math.max(0, Math.round(Number(r.queued) || 0)));
  let reportedAt = new Date(typeof r.at === 'string' || typeof r.at === 'number' ? r.at : NaN);
  if (Number.isNaN(reportedAt.getTime()) || reportedAt.getTime() > now.getTime()) reportedAt = now;
  return {
    permission, lowPower: r.lowPower === true, batteryPct, charging: r.charging === true,
    appVersion: typeof r.appVersion === 'string' ? r.appVersion.trim().slice(0, 32) : '', queued, reportedAt
  };
}

export type QuietCode = 'denied' | 'when-in-use' | 'battery-dying' | 'battery-low' | 'low-power' | 'backlog' | 'silent';
export type Quiet = { code: QuietCode; text: string };

const clock = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);

/**
 * Why a person who should be reporting isn't, in words for the manager — or null when nothing is wrong
 * (reporting, or the window is closed). `heartbeat` is the newest one; `zone` is the person's branch zone,
 * for the clock time. Order: a permission problem first (nothing will arrive until they fix it), then the
 * battery, then Low Power Mode, then a backlog still on the phone, then plain silence.
 */
export function quietReason(
  input: { windowNow: boolean; lastPointAt: Date | null; heartbeat: Heartbeat | null; now: Date; zone: string }
): Quiet | null {
  const { windowNow, lastPointAt, heartbeat: h, now, zone } = input;
  if (!windowNow) return null;
  const fresh = h && now.getTime() - h.reportedAt.getTime() <= HEARTBEAT_FRESH_MS ? h : null;
  if (fresh?.permission === 'denied') return { code: 'denied', text: 'Location is off for the app on this phone' };
  if (fresh?.permission === 'when-in-use') return { code: 'when-in-use', text: 'Location is set to “While Using” — it stops when the app is closed' };
  const quiet = !lastPointAt || now.getTime() - lastPointAt.getTime() > QUIET_MS;
  if (!quiet) return null;
  if (h && h.batteryPct !== null && !h.charging) {
    if (h.batteryPct <= DYING_BATTERY_PCT) return { code: 'battery-dying', text: `Battery ${h.batteryPct}% at ${clock(h.reportedAt, zone)} — the phone has probably died` };
    if (h.batteryPct <= LOW_BATTERY_PCT) return { code: 'battery-low', text: `Battery low (${h.batteryPct}% at ${clock(h.reportedAt, zone)})` };
  }
  if (fresh?.lowPower) return { code: 'low-power', text: 'Low Power Mode is on' };
  if (fresh && fresh.queued >= 20) return { code: 'backlog', text: `${fresh.queued} points are waiting on the phone to send` };
  return { code: 'silent', text: lastPointAt ? `No signal from the phone since ${clock(lastPointAt, zone)}` : 'No location from this phone today' };
}
