import { metresBetween } from '../../../src/utils/locationTrail';

/**
 * Waking a closed app (iPhone only). Expo has no "significant change" call, but iOS restarts a terminated app when a **geofence** event
 * fires ("The system will restart the terminated app when a new geofence event occurs" — Expo Location docs). So the collector keeps one
 * circle around the newest in-window position; leaving or re-entering it starts the app with no screen, and the collector resumes from
 * what the phone saved (`resume()`), which re-centres the circle on its first new point. Android's docs say a terminated app is NOT
 * restarted by geofences, so nothing is armed there. Only plain rules live here; the OS calls are in nativeCollector.ts.
 *
 * Privacy: no position is read or kept outside the 7–6 window for this — the circle is placed from a point the window already allowed,
 * and a wake outside the window only asks the server for the status and goes back to sleep.
 */
export const WAKE_RADIUS_M = 200;
/** Move the circle once the phone is this far from its centre, so it follows a drive without being re-registered at every point. */
export const WAKE_REARM_METRES = 100;
/** …and at most this often. */
export const WAKE_REARM_EVERY_MS = 60 * 1000;
/** A position vaguer than this isn't a good place to centre a 200 m circle. */
export const WAKE_MAX_ACCURACY_M = 100;

export type WakeCenter = { lat: number; lng: number; at: number };

export function shouldRearm(center: WakeCenter | null, here: { lat: number; lng: number; accuracy: number | null }, now: number): boolean {
  if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return false;
  if (here.accuracy !== null && (!Number.isFinite(here.accuracy) || here.accuracy > WAKE_MAX_ACCURACY_M)) return false;
  if (!center) return true;
  if (now - center.at < WAKE_REARM_EVERY_MS) return false;
  return metresBetween(center, here) >= WAKE_REARM_METRES;
}
