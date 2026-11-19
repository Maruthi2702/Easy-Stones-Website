import { describe, expect, it } from 'vitest';
import {
  agoText, canBeTracked, canViewTeamLocations, cleanPoints, dayBounds, inTrackingWindow, MAX_POINTS_PER_BATCH,
  retentionCutoff, seenStatus, trackingDay, trailMiles, TRACKING
} from './locationTracking.ts';

// Wed 2026-11-18. Seattle is UTC-8 (PST), Atlanta UTC-5 (EST).
const at = (iso: string) => new Date(iso);

describe('the 7 AM – 6 PM window on the branch clock', () => {
  it('is on the branch\'s own clock, not the server\'s', () => {
    expect(inTrackingWindow(at('2026-11-18T15:00:00Z'), 'Seattle')).toBe(true);   // 7:00 AM PST
    expect(inTrackingWindow(at('2026-11-18T14:59:00Z'), 'Seattle')).toBe(false);  // 6:59 AM
    expect(inTrackingWindow(at('2026-11-18T14:59:00Z'), 'Atlanta')).toBe(true);   // 9:59 AM EST
    expect(inTrackingWindow(at('2026-11-19T01:59:00Z'), 'Seattle')).toBe(true);   // 5:59 PM
    expect(inTrackingWindow(at('2026-11-19T02:00:00Z'), 'Seattle')).toBe(false);  // 6:00 PM exactly is out
  });
  it('is Monday to Friday only', () => {
    expect(inTrackingWindow(at('2026-11-21T20:00:00Z'), 'Seattle')).toBe(false); // Saturday noon
    expect(inTrackingWindow(at('2026-11-22T20:00:00Z'), 'Seattle')).toBe(false); // Sunday
    expect(inTrackingWindow(at('2026-11-20T20:00:00Z'), 'Seattle')).toBe(true);  // Friday
  });
  it('follows daylight saving (Seattle in July is UTC-7)', () => {
    expect(inTrackingWindow(at('2026-07-15T14:00:00Z'), 'Seattle')).toBe(true);  // 7:00 AM PDT
    expect(inTrackingWindow(at('2026-07-15T13:59:00Z'), 'Seattle')).toBe(false);
  });
  it('rejects a bad date', () => expect(inTrackingWindow(new Date('x'), 'Seattle')).toBe(false));
});

describe('days', () => {
  it('names the day on the branch clock', () => {
    expect(trackingDay(at('2026-11-19T03:00:00Z'), 'Seattle')).toBe('2026-11-18');
    expect(trackingDay(at('2026-11-19T03:00:00Z'), 'Atlanta')).toBe('2026-11-18');
    expect(trackingDay(at('2026-11-19T06:00:00Z'), 'Atlanta')).toBe('2026-11-19');
  });
  it('bounds a day by local midnight, including the daylight-saving days', () => {
    expect(dayBounds('2026-11-18', 'Seattle')).toEqual({ from: at('2026-11-18T08:00:00Z'), to: at('2026-11-19T08:00:00Z') });
    const spring = dayBounds('2026-03-08', 'Seattle')!; // 23 hours long
    expect(spring.to.getTime() - spring.from.getTime()).toBe(23 * 3600 * 1000);
    const fall = dayBounds('2026-11-01', 'Seattle')!;   // 25 hours long
    expect(fall.to.getTime() - fall.from.getTime()).toBe(25 * 3600 * 1000);
    expect(dayBounds('nope', 'Seattle')).toBeNull();
  });
});

describe('cleanPoints', () => {
  const now = at('2026-11-18T20:00:00Z'); // noon in Seattle
  const good = (over: object = {}) => ({ id: 'p1', at: '2026-11-18T19:55:00Z', lat: 47.6, lng: -122.3, accuracy: 20, ...over });
  it('keeps a good point', () => {
    const { kept, dropped } = cleanPoints([good()], 'Seattle', now);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ clientId: 'p1', lat: 47.6, lng: -122.3, accuracyM: 20, speedMps: null });
    expect(Object.values(dropped).every(n => n === 0)).toBe(true);
  });
  it('drops what is outside the window, stale, in the future, vague or not a place', () => {
    const r = cleanPoints([
      good({ id: 'a', at: '2026-11-18T14:00:00Z' }),            // 6 AM Seattle
      good({ id: 'b', at: '2026-11-17T19:00:00Z' }),            // over 24 h old: stale
      good({ id: 'c', at: '2026-11-18T20:30:00Z' }),            // 30 min ahead
      good({ id: 'd', accuracy: 900 }),
      good({ id: 'e', lat: 0, lng: 0 }),
      good({ id: 'f', lat: 91 }),
      good({ id: 'g', lat: null }),
      good({ id: '' }),
      'junk', null
    ], 'Seattle', now);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toEqual({ invalid: 6, outsideWindow: 1, stale: 2, vague: 1, tooMany: 0 });
  });
  it('treats a repeated id in one batch as one point', () => {
    expect(cleanPoints([good(), good()], 'Seattle', now).kept).toHaveLength(1);
  });
  it('caps a batch and counts the rest', () => {
    const many = Array.from({ length: MAX_POINTS_PER_BATCH + 5 }, (_, i) => good({ id: `p${i}` }));
    const r = cleanPoints(many, 'Seattle', now);
    expect(r.kept).toHaveLength(MAX_POINTS_PER_BATCH);
    expect(r.dropped.tooMany).toBe(5);
  });
  it('is not an error to send nothing', () => expect(cleanPoints(undefined, 'Seattle', now).kept).toEqual([]));
});

describe('permissions and wording', () => {
  it('needs the switch', () => {
    expect(canBeTracked({ permissions: [TRACKING.TRACKED] })).toBe(true);
    expect(canBeTracked({ permissions: ['view_team_locations'] })).toBe(false);
    expect(canViewTeamLocations({ permissions: [TRACKING.VIEW_TEAM] })).toBe(true);
    expect(canViewTeamLocations(null)).toBe(false);
  });
  it('says how long ago', () => {
    const now = at('2026-11-18T20:00:00Z');
    expect(agoText(null, now)).toBe('No location today');
    expect(agoText(at('2026-11-18T19:59:40Z'), now)).toBe('Just now');
    expect(agoText(at('2026-11-18T19:56:00Z'), now)).toBe('4 min ago');
    expect(agoText(at('2026-11-18T17:00:00Z'), now)).toBe('3 h ago');
    expect(seenStatus(at('2026-11-18T19:56:00Z'), now)).toBe('live');
    expect(seenStatus(at('2026-11-18T19:00:00Z'), now)).toBe('earlier');
    expect(seenStatus(null, now)).toBe('none');
  });
  it('keeps 90 days', () => expect(retentionCutoff(at('2026-11-18T00:00:00Z'))).toEqual(at('2026-08-20T00:00:00Z')));
});

describe('trailMiles', () => {
  it('adds the steps and skips a long gap', () => {
    const a = { lat: 47.6, lng: -122.3, at: at('2026-11-18T18:00:00Z') };
    const b = { lat: 47.7, lng: -122.3, at: at('2026-11-18T18:10:00Z') }; // ~6.9 mi north
    const c = { lat: 47.8, lng: -122.3, at: at('2026-11-18T19:30:00Z') }; // after a 80 min gap: not counted
    expect(trailMiles([a, b])).toBeGreaterThan(6.5);
    expect(trailMiles([a, b])).toBeLessThan(7.3);
    expect(trailMiles([a, b, c])).toBe(trailMiles([a, b]));
    expect(trailMiles([a])).toBe(0);
  });
});
