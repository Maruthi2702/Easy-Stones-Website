import { describe, expect, it } from 'vitest';
import { durationText, findStops } from './locationStops.ts';

const at = (m: number) => new Date(Date.UTC(2026, 10, 19, 17, 0) + m * 60000);
const pt = (m: number, dLat = 0) => ({ lat: 47.6 + dLat, lng: -122.3, at: at(m) });

describe('findStops', () => {
  it('finds a stretch spent in one place', () => {
    const s = findStops([pt(0), pt(5), pt(10), pt(15), pt(20, 0.05)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ minutes: 15, points: 4 });
  });
  it('ignores a pause shorter than ten minutes', () => {
    expect(findStops([pt(0), pt(4), pt(8), pt(9, 0.05)])).toEqual([]);
  });
  it('never counts missing data as a stop', () => {
    expect(findStops([pt(0), pt(5), pt(90)])).toEqual([]);                    // the phone was off for 85 minutes
  });
  it('splits two stops and drops the drive between', () => {
    const s = findStops([pt(0), pt(6), pt(12), pt(14, 0.02), pt(16, 0.04), pt(30, 0.06), pt(36, 0.06), pt(42, 0.06)]);
    expect(s.map((x) => x.minutes)).toEqual([12, 12]);
  });
  it('is empty for no points or one', () => {
    expect(findStops([])).toEqual([]);
    expect(findStops([pt(0)])).toEqual([]);
  });
});
describe('durationText', () => {
  it('says minutes and hours', () => {
    expect(durationText(40)).toBe('40 min'); expect(durationText(65)).toBe('1 h 5 min'); expect(durationText(120)).toBe('2 h');
  });
});
