import { describe, it, expect } from 'vitest';
import { idOf, isRealDay, toDay, toLocalTime, toMoment, wallClockIn, rowConverter, type CopyProblem } from './values.ts';

const PT = 'America/Los_Angeles';
const ET = 'America/New_York';
class FakeObjectId { hex: string; constructor(hex: string) { this.hex = hex; } toHexString() { return this.hex; } }

describe('idOf', () => {
  it('reads ObjectIds and 24-hex strings, lowercased', () => {
    expect(idOf(new FakeObjectId('64B1C2D3E4F5A6B7C8D9E0F1'))).toBe('64b1c2d3e4f5a6b7c8d9e0f1');
    expect(idOf('64b1c2d3e4f5a6b7c8d9e0f1')).toBe('64b1c2d3e4f5a6b7c8d9e0f1');
  });
  it('refuses anything else', () => {
    expect(idOf('Jeremy')).toBeNull();
    expect(idOf('')).toBeNull();
    expect(idOf(null)).toBeNull();
    expect(idOf(undefined)).toBeNull();
  });
});

describe('isRealDay', () => {
  it('knows real days from look-alikes', () => {
    expect(isRealDay('2026-02-28')).toBe(true);
    expect(isRealDay('2028-02-29')).toBe(true);
    expect(isRealDay('2026-02-29')).toBe(false);
    expect(isRealDay('2026-13-01')).toBe(false);
    expect(isRealDay('2026-1-1')).toBe(false);
  });
});

describe('toDay', () => {
  it('keeps day strings and blanks empty ones', () => {
    expect(toDay('2026-10-23', PT)).toEqual({ ok: true, value: '2026-10-23' });
    expect(toDay('', PT)).toEqual({ ok: true, value: null });
    expect(toDay(null, PT)).toEqual({ ok: true, value: null });
    expect(toDay(undefined, PT)).toEqual({ ok: true, value: null });
  });
  it('reads a midnight-UTC Date as that day, not the day before on Pacific time', () => {
    expect(toDay(new Date('2026-10-23T00:00:00.000Z'), PT)).toMatchObject({ ok: true, value: '2026-10-23' });
  });
  it('reads any other Date on the zone given', () => {
    expect(toDay(new Date('2026-10-24T03:00:00.000Z'), PT)).toMatchObject({ ok: true, value: '2026-10-23' });
    expect(toDay(new Date('2026-10-24T03:00:00.000Z'), ET)).toMatchObject({ ok: true, value: '2026-10-23' });
  });
  it('refuses a day that does not exist', () => {
    expect(toDay('2026-02-30', PT).ok).toBe(false);
    expect(toDay('next week', PT).ok).toBe(false);
  });
});

describe('toLocalTime', () => {
  it('keeps a local clock string exactly as written', () => {
    expect(toLocalTime('2026-10-23T14:05:00.000', PT)).toEqual({ ok: true, value: '2026-10-23 14:05:00.000' });
    expect(toLocalTime('2026-10-23T14:05', PT)).toEqual({ ok: true, value: '2026-10-23 14:05:00.000' });
    expect(toLocalTime('2026-10-23T14:05:09.5', PT)).toEqual({ ok: true, value: '2026-10-23 14:05:09.500' });
  });
  it('reads an instant on the branch clock, across daylight saving', () => {
    expect(toLocalTime(new Date('2026-07-01T21:30:00.000Z'), PT)).toMatchObject({ value: '2026-07-01 14:30:00.000' });
    expect(toLocalTime(new Date('2026-12-01T21:30:00.000Z'), PT)).toMatchObject({ value: '2026-12-01 13:30:00.000' });
    expect(toLocalTime('2026-12-01T21:30:00.000Z', ET)).toMatchObject({ value: '2026-12-01 16:30:00.000' });
  });
  it('keeps the clock a Date.toString() string was written on', () => {
    expect(toLocalTime('Thu Oct 22 2026 14:05:07 GMT-0700 (Pacific Daylight Time)', ET))
      .toMatchObject({ ok: true, value: '2026-10-22 14:05:07.000' });
  });
  it('reads the old formatter’s hour 24 as just after midnight that day', () => {
    expect(toLocalTime('2026-03-09T24:00:33.636', PT)).toEqual({ ok: true, value: '2026-03-09 00:00:33.636', converted: 'hour 24 read as 00 on the same day' });
  });
  it('refuses impossible times', () => {
    expect(toLocalTime('2026-10-23T25:00:00.000', PT).ok).toBe(false);
    expect(toLocalTime('soon', PT).ok).toBe(false);
  });
});

describe('toMoment', () => {
  it('takes Dates and zoned ISO text, refuses local text', () => {
    const at = new Date('2026-10-23T21:05:00.000Z');
    expect(toMoment(at)).toEqual({ ok: true, value: at });
    expect(toMoment('2026-10-23T21:05:00.000Z')).toEqual({ ok: true, value: at });
    expect(toMoment('2026-10-23T14:05:00.000').ok).toBe(false);
    expect(toMoment(null)).toEqual({ ok: true, value: null });
  });
});

describe('wallClockIn', () => {
  it('formats the zone clock with milliseconds', () => {
    expect(wallClockIn(new Date('2026-03-08T10:00:00.123Z'), PT)).toBe('2026-03-08 03:00:00.123');
  });
});

describe('rowConverter', () => {
  it('blanks a bad value and records why, without the value itself', () => {
    const problems: CopyProblem[] = [];
    const c = rowConverter(problems, 'visits', 'a'.repeat(24));
    expect(c.day('follow_up_date', 'tomorrow 5pm', PT)).toBeNull();
    expect(problems).toEqual([{ table: 'visits', id: 'a'.repeat(24), field: 'follow_up_date', reason: 'not a day: a 9a', outcome: 'blanked' }]);
  });
  it('notes a rule-based conversion', () => {
    const problems: CopyProblem[] = [];
    const c = rowConverter(problems, 'schedules', 'b'.repeat(24));
    expect(c.localTime('starts_at', new Date('2026-07-01T21:30:00.000Z'), PT)).toBe('2026-07-01 14:30:00.000');
    expect(problems[0]).toMatchObject({ outcome: 'converted', reason: `instant read on ${PT}` });
  });
});
