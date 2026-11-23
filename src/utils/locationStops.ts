/**
 * Stops in a day's trail (2026-11-22). A stop is a stretch where the person stayed within `radiusM` of where it
 * began for at least `minMinutes`. Pure, no database; tested in locationStops.test.ts. Missing data is never a
 * stop: if two points are further apart in time than the trail's gap (locationTrail.ts), the run ends there,
 * so a phone that was off for an hour does not show as "stopped for an hour".
 */
import { GAP_MS, metresBetween } from './locationTrail.ts';

export const STOP_RADIUS_M = 75;
export const STOP_MIN_MINUTES = 10;

export type StopPoint = { lat: number; lng: number; at: Date };
export type Stop = { from: Date; to: Date; minutes: number; lat: number; lng: number; points: number };

export function findStops(points: StopPoint[], { radiusM = STOP_RADIUS_M, minMinutes = STOP_MIN_MINUTES, gapMs = GAP_MS }: { radiusM?: number; minMinutes?: number; gapMs?: number } = {}): Stop[] {
  const stops: Stop[] = [];
  let run: StopPoint[] = [];
  const close = () => {
    const first = run[0], last = run[run.length - 1];
    if (first && last) {
      const minutes = Math.round((last.at.getTime() - first.at.getTime()) / 60000);
      if (minutes >= minMinutes && run.length >= 2) {
        stops.push({
          from: first.at, to: last.at, minutes, points: run.length,
          lat: run.reduce((n, p) => n + p.lat, 0) / run.length, lng: run.reduce((n, p) => n + p.lng, 0) / run.length
        });
      }
    }
  };
  for (const p of points) {
    const anchor = run[0], prev = run[run.length - 1];
    if (anchor && prev && metresBetween(anchor, p) <= radiusM && p.at.getTime() - prev.at.getTime() <= gapMs) run.push(p);
    else { close(); run = [p]; }
  }
  close();
  return stops;
}

/** "40 min", "1 h 5 min", "2 h". */
export const durationText = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};
