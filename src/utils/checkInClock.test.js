import { describe, it, expect } from 'vitest';
import { byBranchClock, checkInMoment, checkInZone } from './checkInClock.js';
import { BRANCHES, branchDayWindow } from '../config/branches.js';

// The window a test asks for: just the zone, so the clause shape is easy to read.
const tag = (zone) => ({ zone });

// A minimal matcher for the clauses byBranchClock builds, with a real window.
const matches = (doc, q) => Object.entries(q).every(([k, cond]) => {
  if (k === '$or') return cond.some((c) => matches(doc, c));
  const v = doc[k];
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('$in' in cond && !cond.$in.includes(v)) return false;
    if ('$nin' in cond && cond.$nin.includes(v)) return false;
    if ('$gte' in cond && !(v >= cond.$gte)) return false;
    if ('$lt' in cond && !(v < cond.$lt)) return false;
    return true;
  }
  return v === cond;
});
const dayWindow = (iso) => (zone) => {
  const branch = Object.keys(BRANCHES).find((b) => BRANCHES[b].timeZone === zone) || 'Seattle';
  const { start, end } = branchDayWindow(branch, iso);
  return { $gte: start, $lt: end };
};

describe('byBranchClock', () => {
  it('one branch: its own zone', () => {
    expect(byBranchClock({ location: 'Atlanta' }, tag)).toEqual({ location: 'Atlanta', createdAt: { zone: 'America/New_York' } });
  });

  it('several branches: one window per zone', () => {
    const q = byBranchClock({ location: { $in: ['Seattle', 'Spokane', 'Dallas'] } }, tag);
    expect(q).toEqual({ $or: [
      { location: { $in: ['Seattle', 'Spokane'] }, createdAt: { zone: 'America/Los_Angeles' } },
      { location: 'Dallas', createdAt: { zone: 'America/Chicago' } }
    ] });
  });

  it('every branch: each zone once, plus Pacific for a name branches.js doesn\'t list', () => {
    const q = byBranchClock({}, tag);
    const zones = q.$or.map((c) => c.createdAt.zone);
    expect(new Set(zones).size).toBe(zones.length - 1); // Pacific twice: known + unknown
    expect(q.$or.at(-1)).toEqual({ location: { $nin: Object.keys(BRANCHES) }, createdAt: { zone: 'America/Los_Angeles' } });
  });

  it('an Atlanta visit at 12:30 AM Oct 1 is Oct 1, whoever asks — same day as the Daily Report', () => {
    const atl = { location: 'Atlanta', createdAt: new Date('2026-10-01T04:30:00Z') };
    for (const scope of [{ location: 'Atlanta' }, { location: { $in: ['Seattle', 'Atlanta'] } }, {}]) {
      expect(matches(atl, byBranchClock(scope, dayWindow('2026-10-01')))).toBe(true);
      expect(matches(atl, byBranchClock(scope, dayWindow('2026-09-30')))).toBe(false);
    }
    const { start, end } = branchDayWindow('Atlanta', '2026-10-01');
    expect(atl.createdAt >= start && atl.createdAt < end).toBe(true);
  });

  it('a Seattle visit at 11 PM is still that day in Seattle, not the next (Eastern) day', () => {
    const sea = { location: 'Seattle', createdAt: new Date('2026-10-02T06:00:00Z') }; // 11 PM Oct 1 Pacific
    expect(matches(sea, byBranchClock({}, dayWindow('2026-10-01')))).toBe(true);
  });
});

describe('checkInMoment', () => {
  const now = new Date('2026-10-01T15:00:00Z');

  it('reads the moment on the branch clock, labelled when it isn\'t the viewer\'s', () => {
    const m = checkInMoment('2026-10-01T04:30:00Z', 'Atlanta', { now, viewerZone: 'America/Los_Angeles' });
    expect(m).toEqual({ date: 'Oct 1, 2026', time: '12:30 AM', zone: 'EDT', isToday: true });
    expect(checkInMoment('2026-10-01T04:30:00Z', 'Atlanta', { now, viewerZone: 'America/New_York' }).zone).toBe('');
  });

  it('no label for Spokane seen from Seattle (same clock)', () => {
    expect(checkInMoment('2026-10-01T16:00:00Z', 'Spokane', { now, viewerZone: 'America/Los_Angeles' }).zone).toBe('');
  });

  it('"today" is the branch\'s today', () => {
    // 11:30 PM Sep 30 in Dallas is yesterday there, though it's still Sep 30 for a Seattle viewer at 9:30 PM.
    const late = checkInMoment('2026-10-01T04:30:00Z', 'Dallas', { now: new Date('2026-10-01T05:00:00Z'), viewerZone: 'America/Los_Angeles' });
    expect(late).toMatchObject({ date: 'Sep 30, 2026', time: '11:30 PM', zone: 'CDT', isToday: false });
  });

  it('a missing or bad date reads blank', () => {
    expect(checkInMoment(null, 'Seattle')).toEqual({ date: '', time: '', zone: '', isToday: false });
    expect(checkInMoment('nope', 'Seattle').date).toBe('');
  });

  it('unknown branch reads Pacific', () => {
    expect(checkInZone('Narnia')).toBe('America/Los_Angeles');
  });
});
