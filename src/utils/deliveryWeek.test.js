import { describe, it, expect } from 'vitest';
import {
  weekdayIndex,
  isWeekendDate,
  dayLabel,
  getWeekMonday,
  getWeekDates,
  visibleWeekDates,
  formatWeekRangeText
} from './deliveryWeek.js';

// 2026-09-07 is a Monday; the week it starts runs through Sunday 2026-09-13.
const MON = '2026-09-07';
const FRI = '2026-09-11';
const SAT = '2026-09-12';
const SUN = '2026-09-13';

describe('weekdayIndex / isWeekendDate', () => {
  it('reads the weekday from the date parts', () => {
    expect(weekdayIndex(MON)).toBe(1);
    expect(weekdayIndex(FRI)).toBe(5);
    expect(weekdayIndex(SAT)).toBe(6);
    expect(weekdayIndex(SUN)).toBe(0);
  });

  it('flags only Saturday and Sunday', () => {
    expect(isWeekendDate(MON)).toBe(false);
    expect(isWeekendDate(FRI)).toBe(false);
    expect(isWeekendDate(SAT)).toBe(true);
    expect(isWeekendDate(SUN)).toBe(true);
  });

  it('survives a missing or unparseable date rather than throwing', () => {
    expect(weekdayIndex('')).toBeNull();
    expect(weekdayIndex(null)).toBeNull();
    expect(isWeekendDate('')).toBe(false);
    expect(dayLabel('')).toEqual({ name: '', short: '' });
  });
});

describe('dayLabel', () => {
  it('names the day from the date, not from a caller-supplied position', () => {
    expect(dayLabel(MON)).toEqual({ name: 'Monday', short: 'Mon' });
    expect(dayLabel(SAT)).toEqual({ name: 'Saturday', short: 'Sat' });
    expect(dayLabel(SUN)).toEqual({ name: 'Sunday', short: 'Sun' });
  });
});

describe('getWeekMonday', () => {
  it.each([
    ['2026-09-07', 'Monday itself'],
    ['2026-09-09', 'midweek'],
    ['2026-09-11', 'Friday'],
    ['2026-09-12', 'Saturday']
  ])('rolls %s (%s) back to the Monday of its own week', (date) => {
    expect(getWeekMonday(date).getDate()).toBe(7);
  });

  // The five-day board sent Sunday forward to the next Monday. Now that Sunday
  // can carry a delivery, it has to resolve to the week that contains it, or
  // opening the board on a Sunday would hide that day's own stops.
  it('keeps Sunday in the week it closes rather than advancing to the next one', () => {
    const monday = getWeekMonday(SUN);
    expect(monday.getDate()).toBe(7);
    expect(monday.getMonth()).toBe(8); // September
  });
});

describe('getWeekDates', () => {
  it('spans Monday through Sunday so weekend deliveries fall inside the fetch range', () => {
    const dates = getWeekDates(getWeekMonday(MON));
    expect(dates).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13'
    ]);
  });
});

describe('visibleWeekDates', () => {
  const week = getWeekDates(getWeekMonday(MON));

  it('shows only the five weekdays when nothing is scheduled at the weekend', () => {
    expect(visibleWeekDates(week, [])).toEqual([MON, '2026-09-08', '2026-09-09', '2026-09-10', FRI]);
  });

  it('reveals Saturday once it carries a delivery, leaving Sunday hidden', () => {
    expect(visibleWeekDates(week, [SAT])).toEqual([
      MON, '2026-09-08', '2026-09-09', '2026-09-10', FRI, SAT
    ]);
  });

  it('reveals Sunday on its own without dragging Saturday along', () => {
    const visible = visibleWeekDates(week, [SUN]);
    expect(visible).toContain(SUN);
    expect(visible).not.toContain(SAT);
  });

  it('keeps weekdays visible even when they hold nothing', () => {
    // A quiet Monday must still render — absence of stops is information.
    expect(visibleWeekDates(week, [FRI])).toContain(MON);
  });

  it('accepts a Set as well as an array, since callers build one from deliveries', () => {
    expect(visibleWeekDates(week, new Set([SAT]))).toContain(SAT);
  });
});

describe('formatWeekRangeText', () => {
  it('spans whichever days are actually on screen', () => {
    expect(formatWeekRangeText([MON, '2026-09-08', '2026-09-09', '2026-09-10', FRI]))
      .toBe('Sep 7 — Sep 11');
    expect(formatWeekRangeText([MON, '2026-09-08', '2026-09-09', '2026-09-10', FRI, SAT]))
      .toBe('Sep 7 — Sep 12');
  });

  it('returns empty for no dates rather than printing a broken range', () => {
    expect(formatWeekRangeText([])).toBe('');
    expect(formatWeekRangeText(null)).toBe('');
  });
});
