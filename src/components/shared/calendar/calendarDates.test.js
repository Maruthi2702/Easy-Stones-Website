import { describe, it, expect } from 'vitest';
import {
    parseISO, isValidISO, parseMonth, parseYear, shiftDay, shiftMonth, withMonth, shiftMonthKey,
    weekdayLabels, monthGrid, weekBounds, decadeStart, yearCells,
    dayOutside, monthOutside, yearOutside, clampDay,
    formatDateText, formatMonthText, formatRangeText, dayAfterKey, inDays,
    readDateTime, roundedNow, clockParts, withClock, withDay, localDateTime, isoOf
} from './calendarDates';

describe('reading the strings', () => {
    it('accepts real days and refuses rolled ones', () => {
        expect(parseISO('2026-10-17')).toEqual({ y: 2026, m: 9, d: 17 });
        expect(isValidISO('2026-02-29')).toBe(false); // 2026 isn't a leap year
        expect(isValidISO('2028-02-29')).toBe(true);
        expect(isValidISO('2026-13-01')).toBe(false);
        expect(isValidISO('')).toBe(false);
        expect(isValidISO(undefined)).toBe(false);
        expect(isValidISO('10/17/2026')).toBe(false);
    });
    it('reads a date-time as its date', () => {
        expect(parseISO('2026-10-17T09:30:00.000')).toEqual({ y: 2026, m: 9, d: 17 });
    });
    it('reads months and years', () => {
        expect(parseMonth('2026-10')).toEqual({ y: 2026, m: 9 });
        expect(parseMonth('2026-13')).toBeNull();
        expect(parseMonth('2026-1')).toBeNull();
        expect(parseYear(2026)).toBe(2026);
        expect(parseYear('2026')).toBe(2026);
        expect(parseYear('26')).toBeNull();
    });
});

describe('moving around', () => {
    it('moves days across month and year ends', () => {
        expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
        expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
        expect(shiftDay('2026-10-17', 7)).toBe('2026-10-24');
    });
    it('clamps the day number when a month is shorter', () => {
        expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
        expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28');
        expect(shiftMonth('2028-03-31', -1)).toBe('2028-02-29');
        expect(shiftMonth('2026-10-17', 3)).toBe('2027-01-17');
        expect(shiftMonth('2026-10-17', -12)).toBe('2025-10-17');
    });
    it('moves a day into another month, clamped', () => {
        expect(withMonth('2026-01-31', '2026-02')).toBe('2026-02-28');
        expect(withMonth('2026-10-17', '2027-03')).toBe('2027-03-17');
        expect(withMonth('2026-10-17', 'junk')).toBe('2026-10-17');
    });
    it('moves a month key', () => {
        expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
        expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    });
});

describe('the month grid', () => {
    it('is six Monday-first rows spilling into the months either side', () => {
        const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
        expect(g).toHaveLength(42);
        expect(g[0]).toBe('2026-09-28');
        expect(g[3]).toBe('2026-10-01');
        expect(g[33]).toBe('2026-10-31');
        expect(g[41]).toBe('2026-11-08');
    });
    it('starts on Sunday when asked', () => {
        const g = monthGrid(2026, 9, 0);
        expect(g[0]).toBe('2026-09-27');
        expect(weekdayLabels(0)[0]).toBe('Su');
    });
    it('labels Monday first by default', () => {
        expect(weekdayLabels()).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    });
    it('finds the week a day is in', () => {
        expect(weekBounds('2026-10-21')).toEqual({ start: '2026-10-19', end: '2026-10-25' });
        expect(weekBounds('2026-10-25')).toEqual({ start: '2026-10-19', end: '2026-10-25' }); // Sunday ends its week
        expect(weekBounds('2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-10-25' });
        expect(weekBounds('2026-10-21', 0)).toEqual({ start: '2026-10-18', end: '2026-10-24' });
    });
    it('lays a decade out with a year either side', () => {
        expect(decadeStart(2026)).toBe(2020);
        expect(decadeStart(2030)).toBe(2030);
        expect(yearCells(2020)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030]);
    });
});

describe('limits', () => {
    it('refuses days outside min / max', () => {
        expect(dayOutside('2026-10-16', '2026-10-17', '')).toBe(true);
        expect(dayOutside('2026-10-17', '2026-10-17', '2026-10-20')).toBe(false);
        expect(dayOutside('2026-10-21', '2026-10-17', '2026-10-20')).toBe(true);
        expect(dayOutside('2026-10-21', '', '')).toBe(false);
        expect(dayOutside('2026-10-21', undefined, undefined)).toBe(false);
    });
    it('refuses a month or year only when none of it fits', () => {
        expect(monthOutside('2026-10', '2026-10-17', '')).toBe(false); // the 17th onward is still allowed
        expect(monthOutside('2026-09', '2026-10-17', '')).toBe(true);
        expect(monthOutside('2026-11', '', '2026-10-31')).toBe(true);
        expect(yearOutside(2025, '2026-01-01', '')).toBe(true);
        expect(yearOutside(2026, '2026-10-17', '2026-12-31')).toBe(false);
    });
    it('pulls a day back inside', () => {
        expect(clampDay('2026-01-01', '2026-10-17', '')).toBe('2026-10-17');
        expect(clampDay('2027-01-01', '', '2026-12-31')).toBe('2026-12-31');
        expect(clampDay('2026-11-01', '2026-10-17', '2026-12-31')).toBe('2026-11-01');
    });
});

describe('words', () => {
    it('writes a date, a month and a run of days', () => {
        expect(formatDateText('2026-10-20')).toBe('Tue, Oct 20, 2026');
        expect(formatDateText('nope')).toBe('');
        expect(formatMonthText('2026-10')).toBe('October 2026');
        expect(formatMonthText('')).toBe('');
        expect(formatRangeText('2026-10-19', '2026-10-25')).toBe('Oct 19 – 25, 2026');
        expect(formatRangeText('2026-10-26', '2026-11-01')).toBe('Oct 26 – Nov 1, 2026');
        expect(formatRangeText('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
    });
});

describe('keyboard', () => {
    it('moves by day, week, month and year', () => {
        expect(dayAfterKey('2026-10-17', 'ArrowLeft')).toBe('2026-10-16');
        expect(dayAfterKey('2026-10-17', 'ArrowRight')).toBe('2026-10-18');
        expect(dayAfterKey('2026-10-17', 'ArrowUp')).toBe('2026-10-10');
        expect(dayAfterKey('2026-10-17', 'ArrowDown')).toBe('2026-10-24');
        expect(dayAfterKey('2026-10-31', 'PageDown')).toBe('2026-11-30');
        expect(dayAfterKey('2026-10-17', 'PageUp', true)).toBe('2025-10-17');
    });
    it('jumps to the ends of the week and ignores other keys', () => {
        expect(dayAfterKey('2026-10-21', 'Home')).toBe('2026-10-19');
        expect(dayAfterKey('2026-10-21', 'End')).toBe('2026-10-25');
        expect(dayAfterKey('2026-10-21', 'a')).toBeNull();
        expect(dayAfterKey('2026-10-21', 'Enter')).toBeNull();
    });
});

describe('shortcuts', () => {
    it('lands days from today', () => {
        expect(inDays('+1 week', 7, '2026-10-17')).toEqual({ label: '+1 week', value: '2026-10-24' });
    });
});

describe('a date with a time', () => {
    it('reads local times as typed, with or without a Z', () => {
        const a = readDateTime('2026-10-17T14:30:00.000');
        const b = readDateTime('2026-10-17T14:30:00.000Z');
        expect(a.getHours()).toBe(14);
        expect(b.getHours()).toBe(14);
        expect(readDateTime('garbage') instanceof Date).toBe(true);
    });
    it('rounds now to five minutes, rolling the hour', () => {
        expect(localDateTime(roundedNow(new Date(2026, 9, 17, 9, 32)))).toBe('2026-10-17T09:30:00.000');
        expect(localDateTime(roundedNow(new Date(2026, 9, 17, 9, 58)))).toBe('2026-10-17T10:00:00.000');
        expect(localDateTime(roundedNow(new Date(2026, 9, 17, 23, 58)))).toBe('2026-10-18T00:00:00.000');
    });
    it('splits and rebuilds the 12-hour clock', () => {
        expect(clockParts(new Date(2026, 9, 17, 0, 3))).toEqual({ hour: 12, minute: 5, period: 'AM' });
        expect(clockParts(new Date(2026, 9, 17, 12, 0))).toEqual({ hour: 12, minute: 0, period: 'PM' });
        expect(clockParts(new Date(2026, 9, 17, 15, 40))).toEqual({ hour: 3, minute: 40, period: 'PM' });
        expect(withClock('2026-10-17T09:00:00.000', 12, 0, 'AM')).toBe('2026-10-17T00:00:00.000');
        expect(withClock('2026-10-17T09:00:00.000', 12, 30, 'PM')).toBe('2026-10-17T12:30:00.000');
        expect(withClock('2026-10-17T09:00:00.000', 3, 15, 'PM')).toBe('2026-10-17T15:15:00.000');
    });
    it('moves the day and keeps the time, even onto a 31st', () => {
        expect(withDay('2026-02-10T14:30:00.000', '2026-03-31')).toBe('2026-03-31T14:30:00.000');
        expect(withDay('2026-10-17T14:30:00.000', 'junk')).toBe('2026-10-17T14:30:00.000');
    });
    it('writes isoOf for a local date', () => {
        expect(isoOf(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
});
