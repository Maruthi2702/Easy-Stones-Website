import { describe, it, expect } from 'vitest';
import { utcOffsetMinutes } from './branches.js';

// Fixed instants with a known DST state, so these assertions don't depend on
// what timezone the machine running the test happens to be in — everything
// here is computed from the named IANA zone, never the runtime's own.
const JAN = new Date('2026-01-15T12:00:00Z'); // standard time everywhere below
const JUL = new Date('2026-07-15T12:00:00Z'); // daylight time everywhere below

describe('utcOffsetMinutes', () => {
  it('matches the sign convention deriveFromSystem expects: negative west of UTC', () => {
    // -420 for Pacific is the exact value named in deriveFromSystem's own
    // comment in src/routes/dailyReports.js — this is the contract that
    // number has to satisfy, not an arbitrary sanity check.
    expect(utcOffsetMinutes('Seattle', JUL)).toBe(-420);
  });

  it('tracks daylight saving through the platform, not a hand-picked constant', () => {
    expect(utcOffsetMinutes('Seattle', JAN)).toBe(-480); // PST
    expect(utcOffsetMinutes('Seattle', JUL)).toBe(-420); // PDT
  });

  it('gives every branch timezone its correct offset', () => {
    expect(utcOffsetMinutes('Salt Lake City', JAN)).toBe(-420); // MST
    expect(utcOffsetMinutes('Salt Lake City', JUL)).toBe(-360); // MDT
    expect(utcOffsetMinutes('Dallas', JAN)).toBe(-360);          // CST
    expect(utcOffsetMinutes('Dallas', JUL)).toBe(-300);          // CDT
    expect(utcOffsetMinutes('Atlanta', JAN)).toBe(-300);         // EST
    expect(utcOffsetMinutes('Atlanta', JUL)).toBe(-240);         // EDT
  });

  it('agrees with the client formula (-new Date().getTimezoneOffset()) for a machine actually on that clock', () => {
    // Can't force the test runner onto another OS timezone, but it always
    // runs somewhere — assert the one branch that offset would actually be
    // correct for: whichever zone this machine happens to be in right now.
    const offsetHere = -new Date().getTimezoneOffset();
    const branchInThatZone = Object.entries({
      Seattle: 'America/Los_Angeles', 'Salt Lake City': 'America/Denver',
      Dallas: 'America/Chicago', Atlanta: 'America/New_York'
    }).find(([, tz]) => Intl.DateTimeFormat().resolvedOptions().timeZone === tz)?.[0];
    if (!branchInThatZone) return; // test machine isn't on one of these clocks
    expect(utcOffsetMinutes(branchInThatZone, new Date())).toBe(offsetHere);
  });

  it('falls back to Pacific for an unknown branch name, same as branchZone does', () => {
    expect(utcOffsetMinutes('Nowhere', JUL)).toBe(-420);
  });
});
