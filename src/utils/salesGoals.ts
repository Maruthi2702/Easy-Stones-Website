import type { Loose } from '../types/records.ts';
/**
 * Sales goals: what a rep is aiming to sell each month, against what the SPS report says
 * they sold (2026-11-25, owner's design: claude.ai artifact **Sales Dash — Rep Sales & Goals**,
 * https://claude.ai/artifact/KZhMwDU6dzH8pgtGhCs66X). Shared by the server and the screens.
 *
 * Who sees what (owner's call): a rep sees only their own goals, sales against goals and
 * months — never a teammate's, never the team total. A person with **Team goals**
 * (`view_team_goals`) or **Set goals** (`set_sales_goals`) on their role sees the people on
 * their team (teamScope.ts, by the rep's branch); only **Set goals** changes them. The server
 * sends only what the caller may see, so the screen never has to hide anything.
 *
 * Money is whole cents. A goal is one number per month (twelve a year); the annual goal is
 * their sum. A month with no goal is `null`, which is not a zero goal.
 */
import { inTeam } from './teamScope.ts';
import { displayNameOf } from './salesReps.ts';

export const GOAL_PERMISSIONS = Object.freeze({
  VIEW_TEAM: 'view_team_goals',
  SET: 'set_sales_goals'
});

/** The most a single month's goal may be, in dollars (a typing slip, not a real limit). */
export const MAX_GOAL_DOLLARS = 100_000_000;

const permsOf = (user: Loose | null | undefined): string[] => (Array.isArray(user?.permissions) ? user.permissions : []);
const idOf = (user: Loose | null | undefined) => String(user?.id ?? user?._id ?? '');

/** Whether the role may see other people's goals (Set goals implies it). */
export const canViewTeamGoals = (user: Loose | null | undefined) =>
  permsOf(user).includes(GOAL_PERMISSIONS.VIEW_TEAM) || permsOf(user).includes(GOAL_PERMISSIONS.SET);

export const canSetGoals = (user: Loose | null | undefined) => permsOf(user).includes(GOAL_PERMISSIONS.SET);

/** Your own always; someone else's only with a team-goals switch and only when they are on your team. */
export const mayViewGoalsOf = (user: Loose | null | undefined, targetId: unknown, team: '*' | ReadonlySet<string> | null | undefined) => {
  const target = String(targetId ?? '');
  if (!target) return false;
  if (target === idOf(user)) return true;
  return canViewTeamGoals(user) && inTeam(team, target);
};

/** Setting needs the Set goals switch and the person on your team (yourself included). */
export const mayChangeGoalsOf = (user: Loose | null | undefined, targetId: unknown, team: '*' | ReadonlySet<string> | null | undefined) => {
  const target = String(targetId ?? '');
  if (!target || !canSetGoals(user)) return false;
  return target === idOf(user) || inTeam(team, target);
};

/** Is the viewer someone the Goals view is for: a sales rep by role, or anyone with a goals switch. */
export const wantsGoalsView = (user: Loose | null | undefined, isRep: boolean) => isRep || canViewTeamGoals(user);

export type GoalMonths = (number | null)[];

/**
 * The twelve monthly goals a person typed, in dollars, as whole cents. A blank month is no
 * goal. Refused: not twelve entries, anything that isn't a number, a negative, or over the cap.
 */
export function readGoalMonths(raw: unknown): { ok: true; cents: GoalMonths } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length !== 12) return { ok: false, message: 'Send twelve months, January to December.' };
  const cents: GoalMonths = [];
  for (let i = 0; i < 12; i++) {
    const v = raw[i];
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) { cents.push(null); continue; }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) return { ok: false, message: `Month ${i + 1}: that isn't a number.` };
    if (n < 0) return { ok: false, message: `Month ${i + 1}: a goal can't be negative.` };
    if (n > MAX_GOAL_DOLLARS) return { ok: false, message: `Month ${i + 1}: that is more than the most a goal can be.` };
    cents.push(Math.round(n * 100));
  }
  return { ok: true, cents };
}

export const sumCents = (list: ReadonlyArray<number | null>) => list.reduce<number>((a, c) => a + (c ?? 0), 0);
/** The annual goal: the months added up, or null when no month has one. */
export const annualGoal = (goals: ReadonlyArray<number | null>) => (goals.some((g) => g != null) ? sumCents(goals) : null);

/**
 * An annual goal spread evenly over twelve months in whole cents; the cents left over go to
 * the first months, so the twelve add back up to exactly the annual goal.
 */
export function spreadEvenly(annualCents: number): number[] {
  const whole = Math.max(0, Math.round(annualCents));
  const base = Math.floor(whole / 12);
  const extra = whole - base * 12;
  return Array.from({ length: 12 }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Today in the company's clock (Pacific): the day the dashboard measures pace against. */
export type AsOf = { year: number; month: number; day: number };

export function asOfIn(now: Date, timeZone = 'America/Los_Angeles'): AsOf {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const daysInYear = (year: number) => (daysInMonth(year, 2) === 29 ? 366 : 365);
const dayOfYear = (asOf: AsOf) => {
  let n = asOf.day;
  for (let m = 1; m < asOf.month; m++) n += daysInMonth(asOf.year, m);
  return n;
};

/** How far through a month we are: 0 not started, 1 over, else the share of its days gone. */
export function monthPace(asOf: AsOf, year: number, month: number): number {
  if (year < asOf.year) return 1;
  if (year > asOf.year) return 0;
  if (month < asOf.month) return 1;
  if (month > asOf.month) return 0;
  return asOf.day / daysInMonth(year, month);
}

/** How far through a year we are (0–1). */
export function yearPace(asOf: AsOf, year: number): number {
  if (year < asOf.year) return 1;
  if (year > asOf.year) return 0;
  return dayOfYear(asOf) / daysInYear(year);
}

/** The month the table's first money columns speak of: this month in this year, else the year's last (or first). */
export const focusMonth = (asOf: AsOf, year: number) => (year === asOf.year ? asOf.month : year < asOf.year ? 12 : 1);

export type MonthState = 'met' | 'under' | 'onpace' | 'behind' | 'upcoming' | 'none';

export type MonthLine = {
  month: number;
  salesCents: number | null;
  goalCents: number | null;
  /** Sales as a share of the goal, whole percent; null with no goal. */
  pct: number | null;
  state: MonthState;
  /** This month, in this year — the row that gets "This month". */
  current: boolean;
};

/** Whole percent of the goal; 100 only when the goal is actually reached, so 99.6% reads 99. */
const pctOf = (sales: number, goal: number) => {
  const r = Math.round((sales / goal) * 100);
  return sales >= goal ? Math.max(100, r) : Math.min(99, r);
};

/**
 * One month's line. A finished month is Goal met (at or over) or Under; the month in progress
 * is Goal met, On pace (at or past the share of the month gone) or Behind pace; a month that
 * hasn't started is Upcoming; a month with no goal is none, never a miss.
 */
export function monthLine(asOf: AsOf, year: number, month: number, salesCents: number | null, goalCents: number | null): MonthLine {
  const pace = monthPace(asOf, year, month);
  const current = year === asOf.year && month === asOf.month;
  if (pace === 0) return { month, salesCents, goalCents, pct: null, state: 'upcoming', current };
  if (goalCents == null || goalCents <= 0) return { month, salesCents, goalCents, pct: null, state: 'none', current };
  const pct = pctOf(salesCents ?? 0, goalCents);
  const state: MonthState = (salesCents ?? 0) >= goalCents ? 'met' : pace === 1 ? 'under' : pct >= Math.round(pace * 100) ? 'onpace' : 'behind';
  return { month, salesCents, goalCents, pct, state, current };
}

export const monthLines = (asOf: AsOf, year: number, sales: ReadonlyArray<number | null>, goals: ReadonlyArray<number | null>): MonthLine[] =>
  Array.from({ length: 12 }, (_, i) => monthLine(asOf, year, i + 1, sales[i] ?? null, goals[i] ?? null));

export type Total = { salesCents: number; goalCents: number | null; pct: number | null };

const totalOf = (lines: MonthLine[]): Total => {
  const started = lines.filter((l) => l.state !== 'upcoming');
  const withGoal = started.filter((l) => l.goalCents != null);
  const goalCents = withGoal.length ? sumCents(withGoal.map((l) => l.goalCents)) : null;
  const salesCents = sumCents(started.map((l) => l.salesCents));
  return { salesCents, goalCents, pct: goalCents ? pctOf(salesCents, goalCents) : null };
};

/** Sales and goals for the months that have started, as one total ("To date"). */
export const toDate = (lines: MonthLine[]): Total => totalOf(lines);

/** Each quarter's totals over its months that have started; a quarter that hasn't started is null. */
export const quarterTotals = (lines: MonthLine[]): (Total | null)[] =>
  [0, 1, 2, 3].map((q) => {
    const chunk = lines.slice(q * 3, q * 3 + 3);
    return chunk.some((l) => l.state !== 'upcoming') ? totalOf(chunk) : null;
  });

export type YearLine = {
  salesCents: number;
  /** The whole year's goal (all twelve months), or null when none is set. */
  goalCents: number | null;
  pct: number | null;
  /** Share of the year gone, for the pace mark. */
  pace: number;
  state: 'met' | 'onpace' | 'behind' | 'none';
};

/** The year against its whole goal: On pace when the share sold is at or past the share of the year gone. */
export function yearLine(asOf: AsOf, year: number, sales: ReadonlyArray<number | null>, goals: ReadonlyArray<number | null>): YearLine {
  const salesCents = sumCents(sales);
  const goalCents = annualGoal(goals);
  const pace = yearPace(asOf, year);
  if (!goalCents) return { salesCents, goalCents: null, pct: null, pace, state: 'none' };
  const pct = pctOf(salesCents, goalCents);
  const state = salesCents >= goalCents ? 'met' : pct >= Math.round(pace * 100) ? 'onpace' : 'behind';
  return { salesCents, goalCents, pct, pace, state };
}

/** "$84,200" (whole dollars). */
export const moneyFull = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/** "$84.2k", "$1.09M", "$950" — for tight columns. */
export function moneyCompact(cents: number): string {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (d >= 1000) return `${sign}$${(d / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}$${Math.round(d).toLocaleString('en-US')}`;
}

/** A sales person's name as the SPS report spells it, lowercased, with dots and commas and extra spaces dropped. */
export const repNameKey = (name: unknown) =>
  String(name ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Which staff member each SPS report sales person is (report name key → user id). A name matches a
 * person's Display Name or username exactly (spacing and punctuation aside); a one-word name ("Maria")
 * also matches the one person whose Display Name starts with it. A name that fits two people, or nobody,
 * is left out — never guessed — and the screen lists it so an admin can fix the spelling in SPS or the
 * Display Name in Users & Roles.
 */
export function matchReportReps(staff: Loose[], names: Iterable<string>): Map<string, string> {
  const full = new Map<string, Set<string>>();
  const first = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, id: string) => {
    if (!key) return;
    (m.get(key) ?? m.set(key, new Set()).get(key)!).add(id);
  };
  for (const u of staff) {
    const id = String(u._id ?? u.id ?? '');
    if (!id) continue;
    for (const label of [u.displayName, u.username, displayNameOf(u)]) add(full, repNameKey(label), id);
    add(first, repNameKey(displayNameOf(u)).split(' ')[0], id);
  }
  const out = new Map<string, string>();
  for (const raw of names) {
    const key = repNameKey(raw);
    if (!key) continue;
    const exact = full.get(key);
    if (exact?.size === 1) { out.set(key, [...exact][0]); continue; }
    if (!exact && !key.includes(' ')) {
      const byFirst = first.get(key);
      if (byFirst?.size === 1) out.set(key, [...byFirst][0]);
    }
  }
  return out;
}

export const MONTH_NAMES =['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
