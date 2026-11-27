import type { Loose } from '../types/records.ts';
import { displayNameOf, isSalesRep, worksAtAny } from './salesReps.ts';
import { branchNow } from '../config/branches.ts';

/**
 * Which events send a push to the iOS app, who gets each, and the words (owner's list, 2026-11-21):
 *   a receipt sent back → its cardholder · a delivery put on a driver's truck → that driver ·
 *   follow-ups due today → the person who logged them (one summary, ~8 AM on their branch's clock) ·
 *   a Daily Report submitted → the branch's Daily Report email list (as people with logins) ·
 *   a new check-in → the rep named on it, else the branch's sales reps (never the person who logged it).
 * Sending is src/services/pushEvents.ts; this file is the rules, so they're testable.
 */
export type Message = { title: string; body: string; path: string };

const money = (cents: unknown) => `$${(Math.abs(Number(cents) || 0) / 100).toFixed(2)}`;
const clip = (s: unknown, n = 120) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const active = (u: Loose) => u?.isActive !== false;

export function receiptSentBackMessage(expense: Loose, comment: unknown): Message {
  const what = [clip(expense.merchant, 40), money(expense.cents)].filter(Boolean).join(' · ');
  const why = clip(comment, 140);
  return { title: 'Receipt sent back', body: why ? `${what} — ${why}` : what, path: '/sales?tab=card_receipts' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-20' → 'Nov 20' (a receipt's day as the messages say it). */
export const shortDay = (day: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}`.trim() : '';
};
const firstName = (name: unknown) => String(name ?? '').trim().split(/\s+/)[0] || '';
/** "Dan’s $240.00 receipt (Shell, Nov 20)" — which receipt a question or a reopen is about. */
export function receiptPhrase(expense: Loose) {
  const holder = firstName(expense.holderName);
  const where = [clip(expense.merchant, 40), shortDay(expense.date)].filter(Boolean).join(', ');
  return `${holder ? `${holder}’s ` : ''}${money(expense.cents)} receipt${where ? ` (${where})` : ''}`;
}

/** Accounting asked someone about a receipt (receiptApproval.ts's Ask): to the person asked. */
export function receiptAskedMessage(expense: Loose, ask: Loose): Message {
  const who = firstName(ask.byName) || 'Accounting';
  return { title: 'Question about a receipt', body: `${who} asked about ${receiptPhrase(expense)}: ${clip(ask.question, 140)}`, path: '/sales?tab=card_receipts' };
}

/** The person asked answered (and approved): to whoever asked. */
export function receiptAnsweredMessage(expense: Loose, ask: Loose): Message {
  const who = firstName(ask.toName) || 'They';
  // Answered without approving (Return to Accounting): it is back in the asker's queue.
  if (ask.declined) return { title: 'Receipt returned to you', body: `${who} didn’t approve ${receiptPhrase(expense)}: ${clip(ask.answer, 140)}`, path: '/sales?tab=card_receipts' };
  return { title: 'Question answered', body: `${who} answered about ${receiptPhrase(expense)}: ${clip(ask.answer, 140)}`, path: '/sales?tab=card_receipts' };
}

/** An approved receipt was reopened by Accounting or an Admin: to its cardholder. */
export function receiptReopenedMessage(expense: Loose, reason: unknown): Message {
  const what = [clip(expense.merchant, 40), money(expense.cents)].filter(Boolean).join(' · ');
  const why = clip(reason, 140);
  return { title: 'Receipt reopened', body: why ? `${what} — ${why}` : what, path: '/sales?tab=card_receipts' };
}

/** 'drv_jsmith' is a driver's board column; the login is the user named jsmith. */
export function driverUserFor(truckId: unknown, staff: Loose[]): Loose | null {
  const id = String(truckId ?? '');
  if (!id.startsWith('drv_')) return null;
  const username = id.slice(4).toLowerCase();
  return staff.find(u => active(u) && String(u.username || '').toLowerCase() === username) || null;
}

/** Only when the ticket lands on a different driver than it was on (a move within the same truck stays quiet). */
export const driverChanged = (before: unknown, after: unknown) => String(after ?? '').startsWith('drv_') && String(before ?? '') !== String(after ?? '');

export function driverAssignedMessage(delivery: Loose): Message {
  const who = clip(delivery.customerName, 60) || 'a delivery';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(delivery.date || '')) ? ` on ${delivery.date}` : '';
  return { title: 'New delivery assigned', body: `${who}${day}`, path: '/sales?tab=delivery_schedule' };
}

export function reportSubmittedMessage(report: Loose): Message {
  const by = report.autoSubmitted ? 'submitted automatically' : report.submittedBy ? `submitted by ${clip(report.submittedBy, 40)}` : 'submitted';
  return { title: 'Daily Report submitted', body: `${report.location} · ${report.date} · ${by}`, path: '/sales?tab=daily_report' };
}

/** The Daily Report email list holds user ids; push goes to those who are still active. */
export const reportRecipients = (userIds: unknown, staff: Loose[]): string[] => {
  const want = new Set((Array.isArray(userIds) ? userIds : []).map(String));
  return staff.filter(u => want.has(String(u._id)) && active(u)).map(u => String(u._id));
};

export function checkInMessage(checkIn: Loose): Message {
  const where = clip(checkIn.location, 30);
  return { title: 'New check-in', body: [clip(checkIn.name, 60) || 'A visitor', where].filter(Boolean).join(' · '), path: '/sales?tab=checkin' };
}

/** The rep named on the check-in; with none, the branch's sales reps (role sales_rep, working there). */
export function checkInRecipients(checkIn: Loose, staff: Loose[]): string[] {
  const loggerId = String(checkIn.loggedBy?.userId || '');
  const named = String(checkIn.salesRep || '').trim().toLowerCase();
  const people = named
    ? staff.filter(u => active(u) && displayNameOf(u).trim().toLowerCase() === named)
    : staff.filter(u => active(u) && isSalesRep(u) && String(u.role).toLowerCase() === 'sales_rep' && worksAtAny(u, [String(checkIn.location || '')]) && !(u.assignedLocations || []).includes('*'));
  return people.map(u => String(u._id)).filter(id => id && id !== loggerId);
}

export function followUpsDueMessage(count: number): Message {
  return { title: 'Follow-ups due today', body: `You have ${count} follow-up${count === 1 ? '' : 's'} due today`, path: '/sales?tab=dashboard' };
}

/** Morning push hour on the person's own branch clock. */
export const FOLLOW_UP_PUSH_HOUR = 8;

/** The person's branch day, and whether it's the push hour there (branches with no known clock use Seattle's). */
export function followUpClock(branch: unknown, at: Date = new Date()) {
  const now = branchNow(String(branch || ''), at);
  return { today: now.date, isPushHour: Math.floor(now.minutes / 60) === FOLLOW_UP_PUSH_HOUR };
}
