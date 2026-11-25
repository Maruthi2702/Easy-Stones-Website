import { describe, it, expect } from 'vitest';
import {
  GOAL_PERMISSIONS, canViewTeamGoals, canSetGoals, mayViewGoalsOf, mayChangeGoalsOf, readGoalMonths, sumCents, annualGoal, spreadEvenly,
  repNameKey, matchReportReps, asOfIn, monthPace, yearPace, focusMonth, monthLine, monthLines, toDate, quarterTotals, yearLine, moneyFull, moneyCompact, daysInMonth
} from './salesGoals.ts';

const rep = { id: 'r1', permissions: ['view_dashboard'] };
const director = { id: 'd1', permissions: [GOAL_PERMISSIONS.SET] };
const viewer = { id: 'v1', permissions: [GOAL_PERMISSIONS.VIEW_TEAM] };
const team = new Set(['r1', 'r2', 'd1', 'v1']);

describe('who may see and change goals', () => {
  it('a rep sees only their own, a teammate\'s never', () => {
    expect(mayViewGoalsOf(rep, 'r1', team)).toBe(true);
    expect(mayViewGoalsOf(rep, 'r2', team)).toBe(false);
    expect(mayViewGoalsOf(rep, 'r2', '*')).toBe(false);
  });
  it('a team-goals switch sees the team, not outside it', () => {
    expect(canViewTeamGoals(viewer)).toBe(true);
    expect(mayViewGoalsOf(viewer, 'r2', team)).toBe(true);
    expect(mayViewGoalsOf(viewer, 'zz', team)).toBe(false);
    expect(mayViewGoalsOf(viewer, 'zz', '*')).toBe(true);
  });
  it('Set goals implies seeing the team, and only it changes goals', () => {
    expect(canViewTeamGoals(director)).toBe(true);
    expect(canSetGoals(director)).toBe(true);
    expect(canSetGoals(viewer)).toBe(false);
    expect(mayChangeGoalsOf(director, 'r2', team)).toBe(true);
    expect(mayChangeGoalsOf(director, 'zz', team)).toBe(false);
    expect(mayChangeGoalsOf(viewer, 'r2', team)).toBe(false);
    expect(mayChangeGoalsOf(rep, 'r1', team)).toBe(false);
    expect(mayChangeGoalsOf(null, 'r1', team)).toBe(false);
  });
});

describe('readGoalMonths', () => {
  const twelve = (v: unknown) => Array.from({ length: 12 }, () => v);
  it('turns dollars into cents and blanks into no goal', () => {
    const r = readGoalMonths([70000, '85,000', '$90000.50', '', null, undefined, 0, 1, 2, 3, 4, 5]);
    expect(r).toEqual({ ok: true, cents: [7000000, 8500000, 9000050, null, null, null, 0, 100, 200, 300, 400, 500] });
  });
  it('refuses the wrong count, junk, negatives and a typing slip', () => {
    expect(readGoalMonths([1, 2])).toMatchObject({ ok: false });
    expect(readGoalMonths('x')).toMatchObject({ ok: false });
    expect(readGoalMonths(twelve('abc'))).toMatchObject({ ok: false, message: expect.stringMatching(/number/) });
    expect(readGoalMonths(twelve(-1))).toMatchObject({ ok: false, message: expect.stringMatching(/negative/) });
    expect(readGoalMonths(twelve(1e12))).toMatchObject({ ok: false, message: expect.stringMatching(/more than/) });
  });
});

describe('totals and spreading', () => {
  it('adds the months; an annual goal needs at least one month set', () => {
    expect(sumCents([100, null, 250])).toBe(350);
    expect(annualGoal([null, null])).toBeNull();
    expect(annualGoal([0, null])).toBe(0);
    expect(annualGoal([100, 200])).toBe(300);
  });
  it('spreads evenly in whole cents that add back up exactly', () => {
    const s = spreadEvenly(100_000_000);
    expect(s).toHaveLength(12);
    expect(sumCents(s)).toBe(100_000_000);
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    expect(sumCents(spreadEvenly(100_000_001))).toBe(100_000_001);
    expect(spreadEvenly(-5)).toEqual(Array(12).fill(0));
  });
});

describe('pace', () => {
  const nov25 = { year: 2026, month: 11, day: 25 };
  it('reads today on the company clock', () => {
    // 2026-11-26 03:00 UTC is still Nov 25 in Seattle.
    expect(asOfIn(new Date('2026-11-26T03:00:00Z'))).toEqual(nov25);
    expect(asOfIn(new Date('2026-11-26T09:00:00Z'))).toEqual({ year: 2026, month: 11, day: 26 });
  });
  it('how far through the month and year we are', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(monthPace(nov25, 2026, 10)).toBe(1);
    expect(monthPace(nov25, 2026, 12)).toBe(0);
    expect(monthPace(nov25, 2026, 11)).toBeCloseTo(25 / 30);
    expect(monthPace(nov25, 2025, 11)).toBe(1);
    expect(monthPace(nov25, 2027, 1)).toBe(0);
    expect(yearPace(nov25, 2026)).toBeCloseTo(329 / 365);
    expect(yearPace(nov25, 2025)).toBe(1);
    expect(yearPace(nov25, 2027)).toBe(0);
  });
  it('the focus month', () => {
    expect(focusMonth(nov25, 2026)).toBe(11);
    expect(focusMonth(nov25, 2025)).toBe(12);
    expect(focusMonth(nov25, 2027)).toBe(1);
  });
});

describe('monthLine', () => {
  const nov25 = { year: 2026, month: 11, day: 25 };
  it('finished months are Goal met or Under', () => {
    expect(monthLine(nov25, 2026, 3, 8_000_000, 8_000_000)).toMatchObject({ pct: 100, state: 'met' });
    // 99.5% is not the goal: it reads 99 and Under, never 100 and met.
    expect(monthLine(nov25, 2026, 3, 7_960_000, 8_000_000)).toMatchObject({ pct: 99, state: 'under' });
    expect(monthLine(nov25, 2026, 4, 7_960_000, 8_500_000)).toMatchObject({ pct: 94, state: 'under' });
  });
  it('the month in progress is judged against the share of it gone (83% on the 25th of 30)', () => {
    expect(monthLine(nov25, 2026, 11, 8_420_000, 9_000_000)).toMatchObject({ pct: 94, state: 'onpace', current: true });
    expect(monthLine(nov25, 2026, 11, 6_000_000, 9_000_000)).toMatchObject({ pct: 67, state: 'behind' });
    expect(monthLine(nov25, 2026, 11, 9_500_000, 9_000_000)).toMatchObject({ pct: 106, state: 'met' });
  });
  it('a month not started is Upcoming; a month with no goal is none, never a miss', () => {
    expect(monthLine(nov25, 2026, 12, null, 7_000_000)).toMatchObject({ state: 'upcoming', pct: null });
    expect(monthLine(nov25, 2026, 5, 500, null)).toMatchObject({ state: 'none', pct: null });
    expect(monthLine(nov25, 2026, 5, 500, 0)).toMatchObject({ state: 'none', pct: null });
  });
  it('a month with sales missing counts as nothing sold against its goal', () => {
    expect(monthLine(nov25, 2026, 2, null, 7_000_000)).toMatchObject({ pct: 0, state: 'under' });
  });
});

describe('totals over the year', () => {
  const nov25 = { year: 2026, month: 11, day: 25 };
  const goals = [70, 70, 80, 85, 90, 90, 80, 85, 95, 95, 90, 70].map((k) => k * 100_000);
  const sales = [72.4, 78.9, 85.1, 79.6, 88.3, 91.2, 76.8, 82.5, 93.4, 89.0, 84.2, null].map((k) => (k == null ? null : Math.round(k * 100_000)));
  const lines = monthLines(nov25, 2026, sales, goals);
  it('to date adds only the months that have started', () => {
    expect(toDate(lines)).toEqual({ salesCents: 92_140_000, goalCents: 93_000_000, pct: 99 });
  });
  it('quarters add their started months; Q4 is to date', () => {
    const q = quarterTotals(lines);
    expect(q[0]).toEqual({ salesCents: 23_640_000, goalCents: 22_000_000, pct: 107 });
    expect(q[1]).toMatchObject({ pct: 98 });
    expect(q[2]).toMatchObject({ pct: 97 });
    expect(q[3]).toEqual({ salesCents: 17_320_000, goalCents: 18_500_000, pct: 94 });
    expect(quarterTotals(monthLines({ year: 2026, month: 2, day: 3 }, 2026, [], goals))[3]).toBeNull();
  });
  it('the year against its whole goal and the share of the year gone', () => {
    const y = yearLine(nov25, 2026, sales, goals);
    expect(y).toMatchObject({ salesCents: 92_140_000, goalCents: 100_000_000, pct: 92, state: 'onpace' });
    expect(y.pace).toBeCloseTo(329 / 365);
    expect(yearLine(nov25, 2026, sales.map((s) => (s ?? 0) / 2), goals).state).toBe('behind');
    expect(yearLine(nov25, 2026, [101_000_000], goals).state).toBe('met');
    expect(yearLine(nov25, 2026, sales, Array(12).fill(null))).toMatchObject({ goalCents: null, pct: null, state: 'none' });
  });
});

describe('matching the report\'s sales person to staff', () => {
  const staff = [
    { _id: 'm1', username: 'maria.r', displayName: 'Maria Rojas' },
    { _id: 'm2', username: 'maria.s', displayName: 'Maria Silva' },
    { _id: 'd1', username: 'daniel', displayName: 'Daniel Kim' },
    { _id: 'k1', username: 'krish', displayName: '' }
  ];
  it('spelling, case, dots and spacing don\'t matter', () => {
    expect(repNameKey('  DANIEL   Kim ')).toBe('daniel kim');
    expect(repNameKey('Kim, Daniel.')).toBe('kim daniel');
    const m = matchReportReps(staff, ['DANIEL KIM', 'Maria  Rojas', 'krish']);
    expect(m.get('daniel kim')).toBe('d1');
    expect(m.get('maria rojas')).toBe('m1');
    expect(m.get('krish')).toBe('k1');
  });
  it('a one-word name matches the one person it starts, never one of two, and a full name that fits nobody stays out', () => {
    const m = matchReportReps(staff, ['Daniel', 'Maria', 'Priya Shah', 'Daniel Park']);
    expect(m.get('daniel')).toBe('d1');
    expect(m.has('maria')).toBe(false);          // two Marias: not guessed
    expect(m.has('priya shah')).toBe(false);
    expect(m.has('daniel park')).toBe(false);    // a different Daniel is not Daniel Kim
  });
});

describe('money', () => {
  it('full and compact', () => {
    expect(moneyFull(8_420_000)).toBe('$84,200');
    expect(moneyFull(100_000_000)).toBe('$1,000,000');
    expect(moneyCompact(8_420_000)).toBe('$84.2k');
    expect(moneyCompact(9_000_000)).toBe('$90k');
    expect(moneyCompact(108_630_000)).toBe('$1.09M');
    expect(moneyCompact(100_000_000)).toBe('$1M');
    expect(moneyCompact(95_000)).toBe('$950');
    expect(moneyCompact(0)).toBe('$0');
  });
});
