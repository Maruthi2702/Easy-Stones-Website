import { describe, expect, it } from 'vitest';
import { parseHeartbeat, quietReason, type Heartbeat } from './locationHealth.ts';
import { trailSegments, metresBetween } from './locationTrail.ts';

const now = new Date('2026-11-18T22:00:00Z'); // 2 PM Seattle
const hb = (o: Partial<Heartbeat> = {}): Heartbeat => ({ permission: 'always', lowPower: false, batteryPct: 80, charging: false, appVersion: '1.0', queued: 0, reportedAt: new Date('2026-11-18T21:58:00Z'), ...o });
const reason = (o: { lastPointAt?: Date | null; heartbeat?: Heartbeat | null; windowNow?: boolean }) =>
  quietReason({ windowNow: true, lastPointAt: new Date('2026-11-18T21:00:00Z'), heartbeat: hb(), now, zone: 'America/Los_Angeles', ...o });

describe('parseHeartbeat', () => {
  it('cleans a heartbeat and clamps what a phone could get wrong', () => {
    const h = parseHeartbeat({ permission: 'when-in-use', lowPower: true, batteryPct: 3.4, charging: false, appVersion: ' 1.2.3 ', queued: 1e9, at: '2030-01-01T00:00:00Z' }, now)!;
    expect(h).toMatchObject({ permission: 'when-in-use', lowPower: true, batteryPct: 3, appVersion: '1.2.3', queued: 100000 });
    expect(h.reportedAt).toEqual(now); // a clock in the future falls back to now
  });
  it('treats unknown values as unknown, not as a problem', () => {
    expect(parseHeartbeat({ permission: 'weird', batteryPct: 250 }, now)).toMatchObject({ permission: 'unknown', batteryPct: null, lowPower: false });
    expect(parseHeartbeat('x', now)).toBeNull();
    expect(parseHeartbeat(null, now)).toBeNull();
  });
});

describe('quietReason', () => {
  it('says nothing while the person is reporting, or outside the window', () => {
    expect(reason({ lastPointAt: new Date('2026-11-18T21:55:00Z') })).toBeNull();
    expect(reason({ windowNow: false })).toBeNull();
  });
  it('names a permission problem even while points still arrive', () => {
    expect(reason({ lastPointAt: new Date('2026-11-18T21:59:00Z'), heartbeat: hb({ permission: 'when-in-use' }) })?.code).toBe('when-in-use');
    expect(reason({ heartbeat: hb({ permission: 'denied' }) })?.code).toBe('denied');
  });
  it('explains a quiet phone by its battery first, with the time it said so', () => {
    const r = reason({ heartbeat: hb({ batteryPct: 3, reportedAt: new Date('2026-11-18T21:30:00Z') }) })!;
    expect(r.code).toBe('battery-dying');
    expect(r.text).toBe('Battery 3% at 1:30 PM — the phone has probably died');
    expect(reason({ heartbeat: hb({ batteryPct: 12 }) })?.code).toBe('battery-low');
    expect(reason({ heartbeat: hb({ batteryPct: 3, charging: true }) })?.code).toBe('silent'); // charging: not the battery
  });
  it('then Low Power Mode, a backlog on the phone, then plain silence', () => {
    expect(reason({ heartbeat: hb({ lowPower: true }) })?.code).toBe('low-power');
    expect(reason({ heartbeat: hb({ queued: 120 }) })?.text).toBe('120 points are waiting on the phone to send');
    expect(reason({ heartbeat: null })?.text).toBe('No signal from the phone since 1:00 PM');
    expect(reason({ heartbeat: null, lastPointAt: null })?.text).toBe('No location from this phone today');
  });
  it('ignores a heartbeat too old to explain anything', () => {
    expect(reason({ heartbeat: hb({ lowPower: true, reportedAt: new Date('2026-11-18T18:00:00Z') }) })?.code).toBe('silent');
  });
});

describe('trailSegments', () => {
  const p = (min: number) => ({ at: new Date(Date.UTC(2026, 10, 18, 17, min)), lat: 47.6, lng: -122.3 });
  it('cuts the trail at a gap instead of joining across it, and lists the gap', () => {
    const { segments, gaps } = trailSegments([p(0), p(5), p(10), p(70), p(75)]);
    expect(segments.map(s => s.length)).toEqual([3, 2]);
    expect(gaps).toEqual([{ from: p(10).at, to: p(70).at, minutes: 60 }]);
  });
  it('one segment and no gaps for a steady trail; nothing for no points', () => {
    expect(trailSegments([p(0), p(5), p(10)]).gaps).toEqual([]);
    expect(trailSegments([])).toEqual({ segments: [], gaps: [] });
  });
});

describe('metresBetween', () => {
  it('is zero for the same place and about 111 km per degree of latitude', () => {
    expect(metresBetween({ lat: 47.6, lng: -122.3 }, { lat: 47.6, lng: -122.3 })).toBe(0);
    expect(Math.round(metresBetween({ lat: 47, lng: -122 }, { lat: 48, lng: -122 }) / 1000)).toBe(111);
  });
});
