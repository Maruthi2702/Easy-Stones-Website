import { driveMinutes, localISO, milesBetween, orderStops } from './routePlan.ts';

/*
 * "Optimize route" for one day on the Sales Planner: put the day's stops in an
 * order that doesn't criss-cross the map, and give each a new time to match.
 * Pure rules, no screen; the dialog (features/salesPlanner/components/
 * OptimizeRouteDialog.tsx) only lays the result out and saves it.
 *
 * Two modes (owner's call, 2026-11-11 — the rep picks):
 *   'all'   every stop with a map point is re-ordered;
 *   'fixed' stops the rep marked as a fixed appointment keep their time and the
 *           rest are fitted around them.
 * A stop whose customer has no map point can't be placed by distance, so it
 * always keeps its time (and is reported as such).
 */

export type LatLng = { lat: number; lng: number };

export type DayStop = {
  id: string;
  /** Current start, ms since the epoch (local time as stored). */
  start: number;
  /** Minutes the stop takes (30 when the booking has no end time). */
  minutes: number;
  /** The booking has an end time, so a move should carry one too. */
  hasEnd: boolean;
  point: LatLng | null;
};

export type RouteMode = 'all' | 'fixed';

export type RoutedStop = {
  id: string;
  start: Date;
  end: Date;
  /** Minutes driving from the previous stop (or from the starting point). */
  driveMinutes: number;
  /** Miles from the previous stop (or from the starting point). */
  miles: number;
  /** Kept at its time: marked fixed, or no map point. */
  kept: 'fixed' | 'no-point' | null;
  /** Its time or its place in the day changed. */
  changed: boolean;
  patch: { startTime: string; endTime?: string };
};

export type RoutePlan = {
  stops: RoutedStop[];
  milesBefore: number;
  milesAfter: number;
  /** Nothing would change (already the best order this finds). */
  unchanged: boolean;
};

const MINUTE = 60_000;
/** Times are tidied to 5 minutes (rounded up) so the day reads cleanly. */
const roundUp = (ms: number, step = 5 * MINUTE) => Math.ceil(ms / step) * step;

/** Total miles driving the stops in this order, from `origin` when there is one. */
export const routeMiles = (points: (LatLng | null)[], origin: LatLng | null): number => {
  let from = origin;
  let total = 0;
  for (const p of points) {
    if (!p) continue;
    if (from) total += milesBetween(from, p);
    from = p;
  }
  return Math.round(total * 10) / 10;
};

export function planDayRoute(
  stops: DayStop[],
  { origin = null, mode = 'all', fixedIds = [] }: { origin?: LatLng | null; mode?: RouteMode; fixedIds?: string[] } = {},
): RoutePlan {
  const byTime = [...stops].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const fixedSet = new Set(mode === 'fixed' ? fixedIds : []);

  const keptReason = (s: DayStop): 'fixed' | 'no-point' | null =>
    !s.point ? 'no-point' : fixedSet.has(s.id) ? 'fixed' : null;

  const pinned = byTime.filter((s) => keptReason(s));
  const free = byTime.filter((s) => !keptReason(s));

  // The nearest-first order (with 2-opt) for the stops that can move.
  const ordered = orderStops(free.map((s) => ({ s, coordinates: s.point })), origin).map((x) => x.s as DayStop);

  const dayStart = byTime.length ? byTime[0].start : 0;
  let cursor = dayStart;
  let pos: LatLng | null = origin;

  const rows: RoutedStop[] = [];
  const place = (s: DayStop, kept: RoutedStop['kept']) => {
    const miles = pos && s.point ? milesBetween(pos, s.point) : 0;
    const drive = pos && s.point ? driveMinutes(miles) : 0;
    const start = kept ? s.start : roundUp(cursor + drive * MINUTE);
    const end = start + s.minutes * MINUTE;
    cursor = Math.max(cursor, end);
    if (s.point) pos = s.point;
    const length = s.minutes * MINUTE;
    rows.push({
      id: s.id,
      start: new Date(start),
      end: new Date(end),
      driveMinutes: drive,
      miles: Math.round(miles * 10) / 10,
      kept,
      changed: false,
      patch: { startTime: localISO(new Date(start)), ...(s.hasEnd ? { endTime: localISO(new Date(start + length)) } : {}) },
    });
  };

  let pi = 0;
  for (const f of ordered) {
    // Fixed appointments that come before this stop could even start.
    // Place one first when this stop would not be finished (and the drive on to
    // the appointment made) before it begins.
    while (pi < pinned.length) {
      const p = pinned[pi];
      const toF = pos && f.point ? driveMinutes(milesBetween(pos, f.point)) : 0;
      const fEnd = roundUp(cursor + toF * MINUTE) + f.minutes * MINUTE;
      const onward = f.point && p.point ? driveMinutes(milesBetween(f.point, p.point)) : 0;
      if (fEnd + onward * MINUTE <= p.start) break;
      place(p, keptReason(p));
      pi += 1;
    }
    place(f, null);
  }
  while (pi < pinned.length) { place(pinned[pi], keptReason(pinned[pi])); pi += 1; }

  // Changed = a different place in the day, or a different time.
  const before = new Map(byTime.map((s, i) => [s.id, { i, start: s.start }]));
  rows.forEach((r, i) => {
    const was = before.get(r.id)!;
    r.changed = was.i !== i || was.start !== r.start.getTime();
  });

  return {
    stops: rows,
    milesBefore: routeMiles(byTime.map((s) => s.point), origin),
    milesAfter: routeMiles(rows.map((r) => stops.find((s) => s.id === r.id)!.point), origin),
    unchanged: rows.every((r) => !r.changed),
  };
}
