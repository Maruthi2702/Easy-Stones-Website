/**
 * Which day and month a check-in belongs to: its own branch's, on that
 * branch's clock (src/config/branches.js) — the same rule the Daily Report
 * counts visitors by. An Atlanta visit at 12:30 AM on Oct 1 is an October
 * visit for everyone, including a Seattle admin whose clock still says
 * Sep 30. The list's month filter and Today/Month counts (src/routes/
 * checkIn.js), the dates and times on the log and the export all go through
 * here, so they can't disagree with each other or with the report.
 *
 * Pure: shared by the server and the browser, tested in checkInClock.test.js.
 */
import { BRANCHES, branchZone } from '../config/branches.js';

const KNOWN_BRANCHES = Object.keys(BRANCHES);

/** The zone a branch's check-ins are read in (Pacific for a name branches.js doesn't know). */
export const checkInZone = (location) => branchZone(location);

/**
 * A query clause limiting check-ins to a time window read on each one's own
 * branch clock. `scope` is the location clause the route already built:
 * { location: 'Dallas' }, { location: { $in: [...] } }, or {} for every branch.
 * `windowFor(zone)` returns the createdAt condition for that zone, e.g.
 * { $gte: <midnight Oct 1 there>, $lt: <midnight Nov 1 there> }.
 *
 * Branches are grouped by zone, so "every branch" is four or five index
 * ranges, not one per branch. Every branch still gets a window: a location
 * branches.js doesn't list is read on Pacific time, as branchZone does.
 */
export function byBranchClock(scope, windowFor) {
  const loc = scope?.location;
  if (typeof loc === 'string') return { location: loc, createdAt: windowFor(checkInZone(loc)) };

  const names = Array.isArray(loc?.$in) ? loc.$in : null; // null = every branch
  const byZone = new Map();
  for (const name of names || KNOWN_BRANCHES) {
    const zone = checkInZone(name);
    byZone.set(zone, [...(byZone.get(zone) || []), name]);
  }
  const clauses = [...byZone].map(([zone, list]) => ({
    location: list.length === 1 ? list[0] : { $in: list },
    createdAt: windowFor(zone)
  }));
  if (!names) clauses.push({ location: { $nin: KNOWN_BRANCHES }, createdAt: windowFor(checkInZone('')) });
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

const dayKey = (at, timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
}).format(at);

/**
 * How a check-in's moment reads on its branch's clock: 'Oct 1, 2026',
 * '12:30 AM', and whether that's today there. `zone` is the short zone name
 * ('EDT') when it differs from the viewer's own, else '' — a Seattle admin
 * sees "12:30 AM EDT" for Atlanta and plain times for Seattle.
 */
export function checkInMoment(createdAt, location, { now = new Date(), viewerZone } = {}) {
  const at = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!createdAt || Number.isNaN(at.getTime())) return { date: '', time: '', zone: '', isToday: false };
  const timeZone = checkInZone(location);
  const viewer = viewerZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Same rules in both zones at this moment → no label needed.
  const sameClock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', day: 'numeric', hourCycle: 'h23' }).format(at)
    === new Intl.DateTimeFormat('en-US', { timeZone: viewer, hour: 'numeric', minute: 'numeric', day: 'numeric', hourCycle: 'h23' }).format(at);
  const zone = sameClock ? '' : (new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '');
  return {
    date: new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(at),
    time: new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at),
    zone,
    isToday: dayKey(at, timeZone) === dayKey(now, timeZone)
  };
}
