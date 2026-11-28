import { describe, it, expect } from 'vitest';
import { isQuickStopId, newQuickStopId, planDayRoute, quickDayStops, realChanges, type DayStop, type QuickStop } from './routeDay.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m).getTime();
// Points run west→east along one road, ~0.7 mi per 0.01° of longitude at this latitude.
const p = (x: number) => ({ lat: 47.6, lng: -122.4 + x * 0.02 });
const stop = (id: string, x: number | null, h: number, extra: Partial<DayStop> = {}): DayStop =>
  ({ id, start: at(h), minutes: 30, hasEnd: true, point: x === null ? null : p(x), ...extra });

describe('planDayRoute', () => {
  it('visits stops along the road in order instead of zig-zagging', () => {
    const plan = planDayRoute([stop('a', 0, 9), stop('c', 8, 10), stop('b', 4, 11), stop('d', 12, 12)], { origin: p(-1) });
    expect(plan.stops.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.milesAfter).toBeLessThan(plan.milesBefore);
  });

  it('opens the day at 8 AM even when a stop was saved at an odd hour', () => {
    const plan = planDayRoute([stop('a', 0, 1), stop('b', 4, 23)], { origin: null });
    expect(plan.stops[0].start.getTime()).toBe(at(8));
  });

  it('opens at startAt when given (today, from now)', () => {
    const plan = planDayRoute([stop('a', 0, 9), stop('b', 4, 10)], { origin: null, startAt: at(14, 20) });
    expect(plan.stops[0].start.getTime()).toBe(at(14, 20));
  });

  it('starts at the day\'s first time and lays times down with drive time between', () => {
    const plan = planDayRoute([stop('a', 0, 9), stop('b', 4, 11)], { origin: null });
    expect(plan.stops[0].start.getTime()).toBe(at(8));
    expect(plan.stops[1].start.getTime()).toBeGreaterThan(plan.stops[0].end.getTime());
    expect(plan.stops[1].start.getTime()).toBeLessThan(at(11));
  });

  it('starts from the starting point: the nearest stop goes first', () => {
    const plan = planDayRoute([stop('far', 10, 9), stop('near', 1, 10)], { origin: p(0) });
    expect(plan.stops[0].id).toBe('near');
  });

  it('keeps a fixed appointment at its time and fits the rest around it', () => {
    const stops = [stop('a', 0, 9), stop('fixed', 6, 13), stop('b', 2, 14), stop('c', 4, 15)];
    const plan = planDayRoute(stops, { origin: p(-1), mode: 'fixed', fixedIds: ['fixed'] });
    const fixed = plan.stops.find((s) => s.id === 'fixed')!;
    expect(fixed.start.getTime()).toBe(at(13));
    expect(fixed.kept).toBe('fixed');
    const order = plan.stops.map((s) => s.id);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('fixed'));
    // nothing overlaps
    const sorted = [...plan.stops].sort((x, y) => x.start.getTime() - y.start.getTime());
    sorted.slice(1).forEach((s, i) => expect(s.start.getTime()).toBeGreaterThanOrEqual(sorted[i].end.getTime()));
  });

  it('ignores fixed marks in re-order-everything mode', () => {
    const plan = planDayRoute([stop('a', 8, 9), stop('b', 0, 13)], { origin: p(-1), mode: 'all', fixedIds: ['b'] });
    expect(plan.stops[0].id).toBe('b');
    expect(plan.stops.every((s) => s.kept === null)).toBe(true);
  });

  it('leaves a stop with no map point at its time', () => {
    const plan = planDayRoute([stop('a', 0, 9), stop('lost', null, 12), stop('b', 4, 10)], { origin: p(-1) });
    const lost = plan.stops.find((s) => s.id === 'lost')!;
    expect(lost.kept).toBe('no-point');
    expect(lost.start.getTime()).toBe(at(12));
  });

  it('carries the length only for a booking that had an end time', () => {
    const plan = planDayRoute([stop('a', 0, 9, { hasEnd: false, minutes: 30 }), stop('b', 4, 10, { minutes: 60 })]);
    expect(plan.stops.find((s) => s.id === 'a')!.patch.endTime).toBeUndefined();
    const b = plan.stops.find((s) => s.id === 'b')!;
    expect(new Date(b.patch.endTime!).getTime() - new Date(b.patch.startTime).getTime()).toBe(60 * 60_000);
  });

  it('says so when the day is already in the best order', () => {
    expect(planDayRoute([stop('a', 0, 9), stop('b', 4, 10)], { origin: p(-1) }).unchanged).toBe(false); // times tighten
    const plan = planDayRoute([stop('a', 0, 8)], { origin: null });
    expect(plan.unchanged).toBe(true);
  });

  it('counts the finishing place: the last stop is the one nearest it, and the drive there is reported', () => {
    // Start and finish both at the west end: the far stop should come last... or the loop is shortest either way.
    const plan = planDayRoute([stop('a', 2, 9), stop('b', 10, 10), stop('c', 5, 11)], { origin: p(0), end: p(0) });
    expect(plan.finish).not.toBeNull();
    expect(plan.finish!.arrive.getTime()).toBeGreaterThan(plan.stops[plan.stops.length - 1].end.getTime());
    expect(plan.milesAfter).toBeLessThanOrEqual(plan.milesBefore);
  });

  it('ends the day at a far finishing place by ending on the stop nearest it', () => {
    const plan = planDayRoute([stop('west', 1, 9), stop('east', 9, 10), stop('mid', 5, 11)], { origin: p(0), end: p(12) });
    expect(plan.stops.map((s) => s.id)).toEqual(['west', 'mid', 'east']);
  });

  it('has no finish leg when none was asked for', () => {
    expect(planDayRoute([stop('a', 0, 9), stop('b', 4, 10)]).finish).toBeNull();
  });

  it('a longer stop pushes the rest of the day later, and a length change alone is a change', () => {
    const short = planDayRoute([stop('a', 0, 9), stop('b', 4, 10)], { origin: null });
    const long = planDayRoute([stop('a', 0, 9, { minutes: 60, wasMinutes: 30 }), stop('b', 4, 10, { minutes: 60, wasMinutes: 30 })], { origin: null });
    expect(long.stops[1].start.getTime()).toBeGreaterThan(short.stops[1].start.getTime());
    const only = planDayRoute([stop('a', 0, 9, { minutes: 60, wasMinutes: 30 })], { origin: null });
    expect(only.unchanged).toBe(false);
    expect(only.stops[0].patch.endTime).toBeDefined();
  });
});

describe('quick stops', () => {
  const quick = (id: string, x: number, minutes = 30): QuickStop => ({ id, label: 'Lunch', address: 'Somewhere', point: p(x), minutes });

  it('have their own ids and start after the day\'s real stops', () => {
    expect(isQuickStopId(newQuickStopId())).toBe(true);
    expect(isQuickStopId('64b0c0ffee0000000000abcd')).toBe(false);
    const real = [stop('a', 0, 9), stop('b', 4, 11)];
    const q = quickDayStops([quick('quick:1', 2), quick('quick:2', 3)], real);
    expect(q[0].start).toBeGreaterThan(at(11));
    expect(q[1].start).toBeGreaterThan(q[0].start);
    expect(q.every((s) => s.hasEnd && s.point)).toBe(true);
  });

  it('are ordered into the drive and hold their minutes', () => {
    const real = [stop('a', 0, 9), stop('b', 10, 10)];
    const withQuick = [...real, ...quickDayStops([quick('quick:1', 5, 45)], real)];
    const plan = planDayRoute(withQuick, { origin: p(-1) });
    expect(plan.stops.map((s) => s.id)).toEqual(['a', 'quick:1', 'b']);
    const [, lunch, b] = plan.stops;
    expect(lunch.end.getTime() - lunch.start.getTime()).toBe(45 * 60_000);
    expect(b.start.getTime()).toBeGreaterThanOrEqual(lunch.end.getTime());
  });

  it('are never among the changes that get saved', () => {
    const real = [stop('a', 0, 9), stop('b', 10, 10)];
    const plan = planDayRoute([...real, ...quickDayStops([quick('quick:1', 5)], real)], { origin: p(-1) });
    expect(plan.stops.find((s) => s.id === 'quick:1')!.changed).toBe(true);
    expect(realChanges(plan).some((s) => isQuickStopId(s.id))).toBe(false);
    expect(realChanges(plan).map((s) => s.id)).toContain('b');
  });

  it('leave a day that was already in order with nothing to save', () => {
    const first = planDayRoute([stop('a', 0, 9), stop('b', 4, 10)], { origin: p(-1), startAt: at(9) });
    const settled = first.stops.map((r) => ({ id: r.id, start: r.start.getTime(), minutes: 30, hasEnd: true, point: r.id === 'a' ? p(0) : p(4) }));
    expect(realChanges(planDayRoute(settled, { origin: p(-1), startAt: at(9) }))).toHaveLength(0);
  });
});
