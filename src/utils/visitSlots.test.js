import { describe, it, expect } from 'vitest';
import { quickDates, firstFreeSlot, minutesOf, clockLabel, timeOptions, startEnd } from './visitSlots';

describe('quickDates', () => {
  it('offers tomorrow, next Monday and the Monday after', () => {
    // Sun Oct 18 2026
    expect(quickDates('2026-10-18')).toEqual([
      { label: 'Tomorrow', value: '2026-10-19' },
      { label: 'Next week', value: '2026-10-26' },
      { label: 'In 2 weeks', value: '2026-11-02' }
    ]);
  });
  it('never calls today’s own Monday "next week"', () => {
    // Mon Oct 19 2026 → next Monday is the 26th
    expect(quickDates('2026-10-19')[1].value).toBe('2026-10-26');
  });
  it('rolls over month and year ends', () => {
    expect(quickDates('2026-12-30').map(d => d.value)).toEqual(['2026-12-31', '2027-01-04', '2027-01-11']);
  });
  it('skips tomorrow’s Monday on a Sunday, which Tomorrow already offers', () => {
    expect(quickDates('2026-10-25').map(d => d.value)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });
  it('treats a Friday’s next week as the coming Monday', () => {
    // Fri Oct 23 2026
    expect(quickDates('2026-10-23')[1].value).toBe('2026-10-26');
  });
});

describe('firstFreeSlot', () => {
  const at = (s, e) => ({ startTime: `2026-10-27T${s}:00.000`, endTime: `2026-10-27T${e}:00.000` });
  it('is 9:00 on an empty day', () => expect(firstFreeSlot([])).toBe('09:00'));
  it('starts after what is booked at the start of the day', () => {
    expect(firstFreeSlot([at('09:00', '10:00')])).toBe('10:00');
  });
  it('uses a gap between visits when the visit fits in it', () => {
    expect(firstFreeSlot([at('09:00', '10:00'), at('11:00', '12:00')], { minutes: 45 })).toBe('10:00');
    expect(firstFreeSlot([at('09:00', '10:00'), at('10:30', '12:00')], { minutes: 45 })).toBe('12:00');
  });
  it('treats a booking with no end as one visit long', () => {
    expect(firstFreeSlot([{ startTime: '2026-10-27T09:00:00.000' }], { minutes: 45 })).toBe('09:45');
  });
  it('is null when the day has no room', () => {
    expect(firstFreeSlot([at('09:00', '17:00')])).toBeNull();
  });
  it('does not run past the end of the day', () => {
    expect(firstFreeSlot([at('09:00', '16:30')], { minutes: 45 })).toBeNull();
  });
  it('ignores a booking it cannot read', () => {
    expect(firstFreeSlot([{ startTime: 'tbd' }, null].filter(Boolean))).toBe('09:00');
  });
});

describe('clock helpers', () => {
  it('reads times and stored date-times', () => {
    expect(minutesOf('10:30')).toBe(630);
    expect(minutesOf('2026-10-27T13:15:00.000')).toBe(795);
    expect(minutesOf('')).toBeNull();
  });
  it('labels a 12-hour clock', () => {
    expect(clockLabel(0)).toBe('12:00 AM');
    expect(clockLabel(9 * 60)).toBe('9:00 AM');
    expect(clockLabel(12 * 60 + 5)).toBe('12:05 PM');
    expect(clockLabel(17 * 60 + 45)).toBe('5:45 PM');
  });
  it('lists the quarter hours of a working day', () => {
    const opts = timeOptions();
    expect(opts[0]).toEqual({ value: '06:00', label: '6:00 AM' });
    expect(opts.at(-1)).toEqual({ value: '20:00', label: '8:00 PM' });
    expect(opts).toHaveLength(57);
  });
  it('builds the stored start and end', () => {
    expect(startEnd('2026-10-27', '10:00', 45)).toEqual({ startTime: '2026-10-27T10:00:00.000', endTime: '2026-10-27T10:45:00.000' });
  });
});
