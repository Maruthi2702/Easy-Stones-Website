import { describe, it, expect } from 'vitest';
import {
  hasPoint,
  milesBetween,
  withinRadius,
  pointInPolygon,
  isRoutablePrecision,
  RECENCY_BUCKETS,
  visitRecency,
  byNeglect,
  orderStops,
  localISO,
  driveMinutes,
  DEFAULT_DAY,
  planDay,
  daySummary
} from './routePlan';

// Seattle-ish coordinates, spread a few miles apart, used across several
// describe blocks below.
const SEATTLE = { lat: 47.6062, lng: -122.3321 };
const BELLEVUE = { lat: 47.6101, lng: -122.2015 };
const REDMOND = { lat: 47.6740, lng: -122.1215 };

describe('hasPoint', () => {
  it('is true for a stop with finite lat/lng', () => {
    expect(hasPoint({ coordinates: SEATTLE })).toBe(true);
  });

  it('is false when coordinates are missing', () => {
    expect(hasPoint({})).toBe(false);
    expect(hasPoint({ coordinates: null })).toBe(false);
  });

  it('is false when lat/lng are not finite numbers', () => {
    expect(hasPoint({ coordinates: { lat: NaN, lng: -122 } })).toBe(false);
    expect(hasPoint({ coordinates: { lat: 47, lng: undefined } })).toBe(false);
  });
});

describe('milesBetween', () => {
  it('is 0 for the same point', () => {
    expect(milesBetween(SEATTLE, SEATTLE)).toBeCloseTo(0, 5);
  });

  it('matches the known straight-line distance between Seattle and Bellevue (~5.5mi)', () => {
    expect(milesBetween(SEATTLE, BELLEVUE)).toBeGreaterThan(5);
    expect(milesBetween(SEATTLE, BELLEVUE)).toBeLessThan(6.5);
  });

  it('is symmetric', () => {
    expect(milesBetween(SEATTLE, REDMOND)).toBeCloseTo(milesBetween(REDMOND, SEATTLE), 8);
  });

  it('is Infinity when either point is missing', () => {
    expect(milesBetween(null, SEATTLE)).toBe(Infinity);
    expect(milesBetween(SEATTLE, undefined)).toBe(Infinity);
  });
});

describe('withinRadius', () => {
  it('is true when the stop has a point inside the radius', () => {
    expect(withinRadius({ coordinates: BELLEVUE }, SEATTLE, 10)).toBe(true);
  });

  it('is false when the stop is outside the radius', () => {
    expect(withinRadius({ coordinates: REDMOND }, SEATTLE, 1)).toBe(false);
  });

  it('is false when the stop has no point at all', () => {
    expect(withinRadius({}, SEATTLE, 100)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  // A simple square around SEATTLE, well outside BELLEVUE/REDMOND.
  const square = [
    { lat: 47.5, lng: -122.5 },
    { lat: 47.5, lng: -122.1 },
    { lat: 47.7, lng: -122.1 },
    { lat: 47.7, lng: -122.5 }
  ];

  it('is true for a point inside the polygon', () => {
    expect(pointInPolygon(SEATTLE, square)).toBe(true);
  });

  it('is false for a point outside the polygon', () => {
    const farAway = { lat: 40, lng: -100 };
    expect(pointInPolygon(farAway, square)).toBe(false);
  });

  it('is false with fewer than 3 vertices', () => {
    expect(pointInPolygon(SEATTLE, [square[0], square[1]])).toBe(false);
  });

  it('is false with a missing point or path', () => {
    expect(pointInPolygon(null, square)).toBe(false);
    expect(pointInPolygon(SEATTLE, null)).toBe(false);
  });
});

describe('isRoutablePrecision', () => {
  it('accepts rooftop, range, and geometric', () => {
    expect(isRoutablePrecision('rooftop')).toBe(true);
    expect(isRoutablePrecision('range')).toBe(true);
    expect(isRoutablePrecision('geometric')).toBe(true);
  });

  it('rejects approximate and unknown/blank precisions', () => {
    expect(isRoutablePrecision('approximate')).toBe(false);
    expect(isRoutablePrecision('')).toBe(false);
    expect(isRoutablePrecision(undefined)).toBe(false);
  });
});

describe('visitRecency', () => {
  const today = new Date('2026-08-15T12:00:00');

  it('is "never" when there is no last-visit date', () => {
    const result = visitRecency(null, today);
    expect(result.key).toBe('never');
    expect(result.days).toBeNull();
  });

  it('buckets a visit from yesterday as "recent"', () => {
    expect(visitRecency('2026-08-14', today).key).toBe('recent');
  });

  it('buckets a visit from 40 days ago as "due"', () => {
    const result = visitRecency('2026-07-06', today);
    expect(result.key).toBe('due');
    expect(result.days).toBe(40);
  });

  it('buckets a visit from 120 days ago as "overdue"', () => {
    expect(visitRecency('2026-04-17', today).key).toBe('overdue');
  });

  it('every non-never bucket key in RECENCY_BUCKETS is reachable', () => {
    const keys = new Set(RECENCY_BUCKETS.map(b => b.key));
    expect(keys).toEqual(new Set(['never', 'overdue', 'due', 'recent']));
  });
});

describe('byNeglect', () => {
  it('sorts never-visited before any dated visit', () => {
    const never = { lastVisitAt: null };
    const dated = { lastVisitAt: '2020-01-01' };
    expect(byNeglect(never, dated)).toBeLessThan(0);
    expect(byNeglect(dated, never)).toBeGreaterThan(0);
  });

  it('sorts the older visit before the more recent one', () => {
    const older = { lastVisitAt: '2020-01-01' };
    const newer = { lastVisitAt: '2026-01-01' };
    expect(byNeglect(older, newer)).toBeLessThan(0);
  });

  it('treats two never-visited stops as equal', () => {
    expect(byNeglect({ lastVisitAt: null }, { lastVisitAt: null })).toBe(0);
  });
});

describe('orderStops', () => {
  it('returns an empty array for fewer than 2 routable stops', () => {
    expect(orderStops([], SEATTLE)).toEqual([]);
    expect(orderStops([{ coordinates: SEATTLE }], null)).toHaveLength(1);
  });

  it('drops stops with no coordinates', () => {
    const stops = [{ id: 'a', coordinates: SEATTLE }, { id: 'b' }, { id: 'c', coordinates: BELLEVUE }];
    const result = orderStops(stops, SEATTLE);
    expect(result.map(s => s.id).sort()).toEqual(['a', 'c']);
  });

  it('starting from Seattle, visits Bellevue before the farther Redmond', () => {
    const stops = [{ id: 'redmond', coordinates: REDMOND }, { id: 'bellevue', coordinates: BELLEVUE }];
    const result = orderStops(stops, SEATTLE);
    expect(result[0].id).toBe('bellevue');
    expect(result[1].id).toBe('redmond');
  });

  it('never invents or drops a stop — same set in, same set out', () => {
    const stops = [
      { id: 1, coordinates: SEATTLE },
      { id: 2, coordinates: BELLEVUE },
      { id: 3, coordinates: REDMOND }
    ];
    const result = orderStops(stops, null);
    expect(result.map(s => s.id).sort()).toEqual([1, 2, 3]);
  });
});

describe('localISO', () => {
  it('formats a local date with no timezone suffix', () => {
    const d = new Date(2026, 7, 15, 9, 5, 3); // Aug 15 2026, 09:05:03 local
    expect(localISO(d)).toBe('2026-08-15T09:05:03.000');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5); // Jan 2 2026, 03:04:05
    expect(localISO(d)).toBe('2026-01-02T03:04:05.000');
  });
});

describe('driveMinutes', () => {
  it('is 0 for a hop of essentially no distance', () => {
    expect(driveMinutes(0)).toBe(0);
    expect(driveMinutes(0.01)).toBe(0);
  });

  it('never goes below the 5-minute floor for a short but real hop', () => {
    expect(driveMinutes(0.1)).toBe(5);
  });

  it('scales up for a longer distance', () => {
    // 35mph, 1.3x road factor: 20mi -> 20*1.3/35*60 = 44.57 -> ceil 45
    expect(driveMinutes(20)).toBe(45);
  });

  it('respects custom speed/roadFactor/minimum options', () => {
    expect(driveMinutes(10, { speedMph: 60, roadFactor: 1, minimum: 1 })).toBe(10);
  });
});

describe('planDay', () => {
  it('returns an empty array for no stops', () => {
    expect(planDay([])).toEqual([]);
  });

  it('lays out ordered stops starting at the given time, numbering them from 1', () => {
    const stops = [{ id: 'a', coordinates: SEATTLE }, { id: 'b', coordinates: BELLEVUE }];
    const day = planDay(stops, {
      date: new Date(2026, 7, 15),
      startHour: 9,
      startMinute: 0,
      stopMinutes: 30,
      origin: SEATTLE
    });

    expect(day).toHaveLength(2);
    expect(day[0].order).toBe(1);
    expect(day[1].order).toBe(2);
    // First stop is the origin itself (0 miles/0 drive time from "here").
    expect(day[0].milesFromPrevious).toBe(0);
    expect(day[0].driveMinutes).toBe(0);
    expect(day[0].startTime).toBe('2026-08-15T09:00:00.000');
    // Second stop starts after the first stop's dwell time plus travel.
    expect(new Date(day[1].startTime).getTime()).toBeGreaterThan(new Date(day[0].endTime).getTime() - 1);
  });

  it('carries the original stop fields through untouched', () => {
    const stops = [{ id: 'a', company: 'Acme', coordinates: SEATTLE }];
    const day = planDay(stops, { origin: SEATTLE });
    expect(day[0].company).toBe('Acme');
    expect(day[0].id).toBe('a');
  });
});

describe('daySummary', () => {
  it('is all zeros for an empty day', () => {
    expect(daySummary([])).toEqual({ stops: 0, miles: 0, drivingMinutes: 0, endsAt: null });
  });

  it('totals stops, miles, and driving minutes, and reports the last stop\'s end time', () => {
    const stops = [{ id: 'a', coordinates: SEATTLE }, { id: 'b', coordinates: BELLEVUE }];
    const day = planDay(stops, {
      date: new Date(2026, 7, 15),
      stopMinutes: DEFAULT_DAY.stopMinutes,
      origin: SEATTLE
    });
    const summary = daySummary(day);

    expect(summary.stops).toBe(2);
    expect(summary.miles).toBeGreaterThan(0);
    expect(summary.drivingMinutes).toBeGreaterThan(0);
    expect(summary.endsAt).toBe(day[1].endTime);
  });
});
