import { describe, it, expect } from 'vitest';
import { planDayRoute, type DayStop } from './routeDay.ts';

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

  it('starts at the day\'s first time and lays times down with drive time between', () => {
    const plan = planDayRoute([stop('a', 0, 9), stop('b', 4, 11)], { origin: null });
    expect(plan.stops[0].start.getTime()).toBe(at(9));
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
    const plan = planDayRoute([stop('a', 0, 9)], { origin: null });
    expect(plan.unchanged).toBe(true);
  });
});
