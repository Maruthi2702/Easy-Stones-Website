import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import { quickDates, defaultVisitDate, earliestStart, firstFreeSlot, bookedSpan, overlapsOf, bookedForCustomer, startIsPast, rangeLabel, nextDayWithRoom, newScheduleId, minutesOf, clockLabel, timeOptions, startEnd } from './visitSlots';

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
  const at = (s: Loose, e: unknown): Loose => ({ startTime: `2026-10-27T${s}:00.000`, endTime: `2026-10-27T${e}:00.000` });
  it('is 9:00 on an empty day', () => expect(firstFreeSlot([])).toBe('09:00'));
  it('starts after what is booked at the start of the day', () => {
    expect(firstFreeSlot([at('09:00', '10:00')])).toBe('10:00');
  });
  it('uses a gap between visits when the visit fits in it', () => {
    expect(firstFreeSlot([at('09:00', '10:00'), at('11:00', '12:00')], { minutes: 45 })).toBe('10:00');
    expect(firstFreeSlot([at('09:00', '10:00'), at('10:30', '12:00')], { minutes: 45 })).toBe('12:00');
  });
  it('treats a booking with no end as 30 minutes, whatever length is being added', () => {
    const noEnd = [{ startTime: '2026-10-27T09:00:00.000' }];
    expect(firstFreeSlot(noEnd, { minutes: 45 })).toBe('09:30');
    expect(firstFreeSlot(noEnd, { minutes: 15 })).toBe('09:30');
    expect(firstFreeSlot(noEnd)).toBe('09:30');
  });
  it('keeps three 9:00 bookings with no end blocking 9:15', () => {
    const three = [0, 1, 2].map(() => ({ startTime: '2026-10-27T09:00:00.000' }));
    expect(firstFreeSlot(three, { minutes: 15 })).toBe('09:30');
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

describe('defaultVisitDate', () => {
  it('is today before 6 PM', () => {
    expect(defaultVisitDate(new Date(2026, 9, 29, 9, 0))).toBe('2026-10-29');
    expect(defaultVisitDate(new Date(2026, 9, 29, 17, 59))).toBe('2026-10-29');
  });
  it('is tomorrow from 6 PM, across a month end', () => {
    expect(defaultVisitDate(new Date(2026, 9, 29, 18, 0))).toBe('2026-10-30');
    expect(defaultVisitDate(new Date(2026, 9, 31, 23, 30))).toBe('2026-11-01');
  });
});

describe('earliestStart', () => {
  it('is 9:00 on another day, or earlier in the morning today', () => {
    expect(earliestStart('2026-10-30', new Date(2026, 9, 29, 14, 0))).toBe(540);
    expect(earliestStart('2026-10-29', new Date(2026, 9, 29, 7, 10))).toBe(540);
  });
  it('is the next quarter hour once today has started', () => {
    expect(earliestStart('2026-10-29', new Date(2026, 9, 29, 14, 7))).toBe(14 * 60 + 15);
    expect(earliestStart('2026-10-29', new Date(2026, 9, 29, 14, 0))).toBe(14 * 60);
  });
});

describe('what a time collides with', () => {
  const row = (s: Loose, e: unknown, extra: Loose = {}): Loose => ({ startTime: `2026-10-27T${s}:00.000`, ...(e ? { endTime: `2026-10-27T${e}:00.000` } : {}), ...extra });
  it('reads a booking’s span, assuming 30 minutes without an end', () => {
    expect(bookedSpan(row('09:00', '09:45'))).toEqual({ start: 540, end: 585, assumed: false });
    expect(bookedSpan(row('09:00'))).toEqual({ start: 540, end: 570, assumed: true });
    expect(bookedSpan({ startTime: 'tbd' })).toBeNull();
  });
  it('lists the bookings a visit would overlap', () => {
    const booked = [row('09:00', '09:30', { label: 'A' }), row('10:00', '10:30', { label: 'B' })];
    expect(overlapsOf(booked, 540, 30).map((b) => b.label)).toEqual(['A']);
    expect(overlapsOf(booked, 570, 30)).toEqual([]);
    expect(overlapsOf(booked, 555, 60).map((b) => b.label)).toEqual(['A', 'B']);
  });
  it('treats a booking with no end as 30 minutes, whatever length is chosen', () => {
    expect(overlapsOf([row('09:00')], 555, 15)).toHaveLength(1);
    expect(overlapsOf([row('09:00')], 570, 15)).toHaveLength(0);
  });
  it('finds the same customer’s bookings', () => {
    const booked = [row('09:00', '09:30', { customerId: 'c1' }), row('10:00', '10:30', { customerId: 'c2' })];
    expect(bookedForCustomer(booked, 'c1')).toHaveLength(1);
    expect(bookedForCustomer(booked, '')).toEqual([]);
  });
  it('knows a start that has already gone by today, and only today', () => {
    const now = new Date(2026, 9, 29, 14, 10);
    expect(startIsPast('2026-10-29', 14 * 60, now)).toBe(true);
    expect(startIsPast('2026-10-29', 14 * 60 + 15, now)).toBe(false);
    expect(startIsPast('2026-10-30', 9 * 60, now)).toBe(false);
  });
  it('labels a range', () => {
    expect(rangeLabel(540, 570)).toBe('9:00 – 9:30 AM');
    expect(rangeLabel(660, 720)).toBe('11:00 AM – 12:00 PM');
    expect(rangeLabel(780, 825)).toBe('1:00 – 1:45 PM');
  });
});

describe('nextDayWithRoom', () => {
  const full = [{ startTime: '2026-10-29T09:00:00.000', endTime: '2026-10-29T17:00:00.000' }];
  const now = new Date(2026, 9, 29, 8, 0);
  const bookedOn = (iso: string) => (iso === '2026-10-29' ? full : []);
  it('is the day itself when it has room', () => {
    expect(nextDayWithRoom('2026-10-30', bookedOn, 60, now)).toBe('2026-10-30');
  });
  it('skips a full day', () => {
    expect(nextDayWithRoom('2026-10-29', bookedOn, 60, now)).toBe('2026-10-30');
  });
  it('skips the weekend', () => {
    const everyWeekdayFull = (iso: string) => (iso <= '2026-10-30' ? [{ startTime: `${iso}T09:00:00.000`, endTime: `${iso}T17:00:00.000` }] : []);
    expect(nextDayWithRoom('2026-10-30', everyWeekdayFull, 60, now)).toBe('2026-11-02');
  });
  it('is null when nothing in two weeks has room', () => {
    const always = (iso: string) => [{ startTime: `${iso}T09:00:00.000`, endTime: `${iso}T17:00:00.000` }];
    expect(nextDayWithRoom('2026-10-29', always, 60, now)).toBeNull();
  });
});

describe('newScheduleId', () => {
  it('is a 24-hex id, different each time', () => {
    const a = newScheduleId();
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(newScheduleId()).not.toBe(a);
  });
});
