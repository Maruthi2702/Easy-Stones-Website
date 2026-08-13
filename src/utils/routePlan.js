/**
 * Turning a handful of pins into a day worth driving.
 *
 * Pure functions over plain objects — no map, no network, no React. A "stop" is
 * anything carrying `coordinates: { lat, lng }`; everything else on it is
 * passed through untouched, so the caller's customer records come out the far
 * end with an order and a time attached.
 *
 * The distances here are straight lines, not roads. That is deliberate: an
 * as-the-crow-flies ordering of a dozen stops within a county is the same
 * ordering roads give you almost every time, and it costs nothing and needs no
 * API key. Where it shows is the clock, so travel estimates are inflated by a
 * road factor rather than pretending a straight line is a drive.
 */

// ── geometry ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_MILES = 3958.8;
const toRad = (deg) => (deg * Math.PI) / 180;

export const hasPoint = (stop) =>
  Number.isFinite(stop?.coordinates?.lat) && Number.isFinite(stop?.coordinates?.lng);

/** Great-circle miles between two { lat, lng } points. */
export const milesBetween = (a, b) => {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const withinRadius = (stop, center, miles) =>
  hasPoint(stop) && milesBetween(stop.coordinates, center) <= miles;

/**
 * Is this point good enough to drive to?
 *
 * Everything except 'approximate'. A rooftop hit is the building; an
 * interpolated range is a house number estimated along a road; a geometric
 * centre is the middle of the parcel or street the address names — all three
 * put you at the right door or within sight of it. 'approximate' is the
 * geocoder giving up and returning the middle of the town, which looks
 * identical on a map and wastes the stop, so only that one is called out.
 *
 * Lives here rather than beside the geocoder because the browser needs it and
 * the geocoder module holds the API key.
 */
export const isRoutablePrecision = (precision) =>
  ['rooftop', 'range', 'geometric'].includes(precision || '');

// ── how overdue is this account ─────────────────────────────────────────────

/**
 * The buckets a map needs to answer "who near here have I neglected". Ordered
 * worst-first, which is also the order they should sort and stack in: a pin you
 * have not visited in a year must not hide behind one you saw on Tuesday.
 */
export const RECENCY_BUCKETS = [
  { key: 'never', label: 'Never visited', minDays: Infinity },
  { key: 'overdue', label: '90+ days', minDays: 90 },
  { key: 'due', label: '30–89 days', minDays: 30 },
  { key: 'recent', label: 'Under 30 days', minDays: 0 }
];

const DAY_MS = 86400000;

/** Whole days between an 'YYYY-MM-DD' visit date and today, or null if never. */
const daysSinceVisit = (lastVisitAt, today = new Date()) => {
  if (!lastVisitAt) return null;
  const then = new Date(`${String(lastVisitAt).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((midnight - then) / DAY_MS));
};

/** Which bucket an account falls in, and how many days that is. */
export const visitRecency = (lastVisitAt, today = new Date()) => {
  const days = daysSinceVisit(lastVisitAt, today);
  if (days === null) return { key: 'never', days: null, label: 'Never visited' };
  const bucket = RECENCY_BUCKETS.find(b => b.key !== 'never' && days >= b.minDays);
  return { key: bucket.key, days, label: `${days} day${days === 1 ? '' : 's'} ago` };
};

/**
 * Worst first. Used to decide which pin to draw on top and which stop to keep
 * when a day is trimmed — never-visited outranks everything, then oldest.
 */
export const byNeglect = (a, b) => {
  const da = daysSinceVisit(a.lastVisitAt);
  const db = daysSinceVisit(b.lastVisitAt);
  if (da === null && db === null) return 0;
  if (da === null) return -1;
  if (db === null) return 1;
  return db - da;
};

// ── ordering the day ────────────────────────────────────────────────────────

/** Total miles of a route that starts at `origin` and takes `stops` in order. */
const routeMiles = (stops, origin) => {
  let total = 0;
  let from = origin;
  for (const stop of stops) {
    if (from) total += milesBetween(from, stop.coordinates);
    from = stop.coordinates;
  }
  return total;
};

/**
 * A sane driving order, nearest-neighbour then improved by 2-opt.
 *
 * Nearest-neighbour alone is quick but leaves one long backtrack near the end —
 * it greedily takes the closest stop and strands whatever it skipped. 2-opt
 * repeatedly reverses any segment that shortens the whole route, which fixes
 * exactly that. At a dozen stops both are instant, and the result is within a
 * few percent of optimal — far inside the error of using straight lines at all.
 */
export const orderStops = (stops, origin) => {
  const placed = stops.filter(hasPoint);
  if (placed.length < 2) return [...placed];

  const remaining = [...placed];
  const route = [];
  let from = origin || remaining[0].coordinates;

  while (remaining.length) {
    let bestIndex = 0;
    let bestMiles = Infinity;
    remaining.forEach((stop, i) => {
      const miles = milesBetween(from, stop.coordinates);
      if (miles < bestMiles) {
        bestMiles = miles;
        bestIndex = i;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    route.push(next);
    from = next.coordinates;
  }

  // 2-opt. Bounded rather than "until no improvement" so a pathological set
  // cannot spin: each pass is O(n²) and a dozen passes is far more than a day's
  // worth of stops ever needs.
  for (let pass = 0; pass < 12; pass += 1) {
    let improved = false;
    for (let i = 0; i < route.length - 1; i += 1) {
      for (let k = i + 1; k < route.length; k += 1) {
        const candidate = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        if (routeMiles(candidate, origin) < routeMiles(route, origin) - 0.01) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return route;
};

// ── putting it on the clock ─────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

/**
 * 'YYYY-MM-DDTHH:mm:ss.000', local, no zone suffix.
 *
 * This is the planner's storage contract, not a choice — see localISO in
 * SalesPlannerTab.jsx. A value with a 'Z' on it lands on the wrong day for
 * anyone east of UTC.
 */
export const localISO = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
  `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000`;

/**
 * Straight-line miles → minutes behind the wheel, rounded up to whole minutes.
 *
 * The floor stops two stops in the same business park from reading as instant —
 * parking and finding the door is five minutes whatever the map says. It does
 * not apply to a hop of no distance at all, which is the first stop when you
 * are already standing at it.
 */
export const driveMinutes = (miles, { speedMph = 35, roadFactor = 1.3, minimum = 5 } = {}) => {
  if (!(miles > 0.05)) return 0;
  return Math.max(minimum, Math.ceil((miles * roadFactor) / speedMph * 60));
};

export const DEFAULT_DAY = {
  startHour: 9,
  startMinute: 0,
  stopMinutes: 45,
  speedMph: 35
};

/**
 * An ordered list of stops, laid out down a day.
 *
 * Returns one row per stop carrying the times the planner stores plus the
 * reasoning behind them — miles and drive time from the previous stop — so the
 * screen can show why a day runs to 4pm rather than just asserting it.
 */
export const planDay = (orderedStops, options = {}) => {
  const {
    date = new Date(),
    startHour = DEFAULT_DAY.startHour,
    startMinute = DEFAULT_DAY.startMinute,
    stopMinutes = DEFAULT_DAY.stopMinutes,
    speedMph = DEFAULT_DAY.speedMph,
    origin = null
  } = options;

  const cursor = new Date(date);
  cursor.setHours(startHour, startMinute, 0, 0);

  let from = origin;

  return orderedStops.map((stop, index) => {
    const miles = from ? milesBetween(from, stop.coordinates) : 0;
    const travel = from ? driveMinutes(miles, { speedMph }) : 0;

    cursor.setMinutes(cursor.getMinutes() + travel);
    const arrive = new Date(cursor);
    cursor.setMinutes(cursor.getMinutes() + stopMinutes);
    const leave = new Date(cursor);

    from = stop.coordinates;

    return {
      ...stop,
      order: index + 1,
      startTime: localISO(arrive),
      endTime: localISO(leave),
      driveMinutes: travel,
      milesFromPrevious: Math.round(miles * 10) / 10
    };
  });
};

/** Human summary of a planned day: stop count, miles, and when it ends. */
export const daySummary = (plannedStops) => {
  if (!plannedStops.length) return { stops: 0, miles: 0, drivingMinutes: 0, endsAt: null };
  return {
    stops: plannedStops.length,
    miles: Math.round(plannedStops.reduce((sum, s) => sum + s.milesFromPrevious, 0) * 10) / 10,
    drivingMinutes: plannedStops.reduce((sum, s) => sum + s.driveMinutes, 0),
    endsAt: plannedStops[plannedStops.length - 1].endTime
  };
};
