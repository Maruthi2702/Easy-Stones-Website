/**
 * The phone's receipt list (2026-11-26, owner's design: claude.ai canvas "Card Receipts — Expenses, Waiting,
 * Statements", boards "Phone 390 · proposed" and variant B): receipts under a heading per day with that day's total,
 * each row the cardholder and card ID, the merchant, the category, and on the right the amount and the status as
 * coloured words. Pure rules only — no React — so they are tested (phoneList.test.ts).
 */
import { shiftDay } from '../../components/shared/calendar/calendarDates';
import { approveProblem } from '../../utils/receiptApproval';
import { actionsOf } from './cardReceiptsView';
import type { Expense } from './types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "Tue, Nov 24". */
export const shortWeekday = (day: string) => {
  if (!DAY.test(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** The day heading: "Today · Wed, Nov 25", "Yesterday · Tue, Nov 24", then "Mon, Nov 23". `today` is the branch's clock. */
export const dayHeading = (day: string, today = '') => {
  if (!DAY.test(day)) return day || 'No date';
  const label = shortWeekday(day);
  if (DAY.test(today)) {
    if (day === today) return `Today · ${label}`;
    if (day === shiftDay(today, -1)) return `Yesterday · ${label}`;
  }
  return label;
};

export type DayGroup<T> = { day: string; heading: string; cents: number; rows: T[] };

/**
 * Rows under their day, in the order the list already has (newest first): a day's group starts where it first
 * appears, and a day seen again later joins that group. The total is the net of what's listed that day.
 */
export function groupByDay<T extends { date: string; cents: number }>(rows: readonly T[], today = ''): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const seen = new Map<string, DayGroup<T>>();
  for (const r of rows) {
    let g = seen.get(r.date);
    if (!g) { g = { day: r.date, heading: dayHeading(r.date, today), cents: 0, rows: [] }; seen.set(r.date, g); groups.push(g); }
    g.rows.push(r);
    g.cents += r.cents;
  }
  return groups;
}

/** The status in one or two words, for the right-hand column (the table says "Waiting for approval"). */
export const SHORT_STATUS: Record<string, string> = { missing: 'Missing receipt', draft: 'Draft', waiting: 'Waiting', sent_back: 'Sent back', approved: 'Approved' };
export const shortStatus = (status: string) => SHORT_STATUS[status] || status;

/** What a Waiting for me row's main button says and does: approve in one tap, or open the receipt first. */
export type ApproveButton = { label: string; /** true = the tap approves; false = it opens the receipt. */ direct: boolean };

/**
 * The main button on a row in Waiting for me, from what the server says the viewer may do. One tap approves only
 * when nothing more is asked for — no comment (a lost receipt), no category to fill in first (an Admin's own
 * receipt) — which is the drawer's own rule (`approveProblem` with an empty comment). Otherwise the button opens the
 * receipt, where those are asked. Null: nothing to decide here.
 */
export function approveButton(e: Expense): ApproveButton | null {
  const act = actionsOf(e);
  if (act.answer) return { label: 'Answer', direct: false };
  if (!act.approve) return null;
  const problem = approveProblem({
    userId: e.userId, holderRole: e.holderRole, location: e.location, cents: e.cents, status: e.status, voided: e.voided,
    approval: e.approval, secondApproval: e.secondApproval, ask: e.ask, lostReason: e.lostReason, receiptUrl: e.receiptUrl, category: e.category
  }, '');
  if (!problem) {
    // $150 and up needs two people: the second one to give theirs says Final approval, the first says how far along it is.
    const otherDone = act.approve === 'accounting' ? Boolean(e.secondApproval) : Boolean(e.approval);
    return { label: !e.needsSecond ? 'Approve' : otherDone ? 'Final approval' : 'Approve · 1 of 2', direct: true };
  }
  return { label: e.lostReason && !e.receiptUrl ? 'Approve with comment' : 'Review', direct: false };
}
