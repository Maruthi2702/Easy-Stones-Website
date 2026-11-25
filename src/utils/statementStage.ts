/**
 * What the Statements tab's Status column says for one bank line (2026-11-24; claude.ai artifact
 * "Statement row colours", https://claude.ai/artifact/GSbdExUZTArcH7EgsDWQjP, board C).
 *
 * The row's background already says matched (green) or waiting for a receipt (red), so this never says
 * "Matched". For a matched line it says where the receipt is in its approvals — the rules are
 * receiptApproval.ts (Accounting always; from $150 a Manager or Admin, or an Admin, as well) — and for
 * every other line what it is. Worked out on the server, so the tab and the receipt never disagree.
 */
import { holderKindOf, secondNeeded } from './receiptApproval.ts';
import type { Ask, Decision } from './receiptApproval.ts';
import type { LineStatus } from './amexStatement.ts';

/** The dot's colour: ok green, wait gold, back orange, miss red, none a hollow grey ring. */
export type StageTone = 'ok' | 'wait' | 'back' | 'miss' | 'none';
export type LineStage = { tone: StageTone; label: string; detail: string };

/** The receipt a matched line answers, as the approval rules need it. */
export type StageExpense = {
  day: string; status: string; cents: number; holderRole: string | null | undefined; holderName: string;
  approval: Pick<Decision, 'byName' | 'at'> | null | undefined;
  secondApproval: Pick<Decision, 'byName' | 'at'> | null | undefined;
  ask: Pick<Ask, 'toName' | 'answeredAt'> | null | undefined;
  sentBackAt: string | Date | null | undefined;
};

/** A stored moment or a 'YYYY-MM-DD' day as the Pacific day it fell on. */
export function pacificDay(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** '2026-11-21' → '11-21' (the year is the statement's). */
export const shortDay = (day: string) => (day.length >= 10 ? `${day.slice(5, 7)}-${day.slice(8, 10)}` : '');

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); never below 0. */
export function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const waitedWords = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);

/** The Status column for one line: its dot, its words and the grey line under them. */
export function lineStage(status: LineStatus, line: { date: string }, expense: StageExpense | null, today: string): LineStage {
  switch (status) {
    case 'missing': return { tone: 'miss', label: `No receipt · ${waitedWords(daysBetween(line.date, today))}`, detail: '' };
    case 'awaiting': return { tone: 'wait', label: 'Waiting for Accounting', detail: 'Admin charge · no upload' };
    case 'no_card': return { tone: 'back', label: 'Card not set up', detail: 'Set it up under Cards' };
    case 'unassigned': return { tone: 'back', label: 'Waiting for a login', detail: 'The card has no holder yet' };
    case 'before_start': return { tone: 'none', label: 'Before the check started', detail: '' };
    case 'no_receipt': return { tone: 'none', label: 'No receipt needed', detail: '' };
    case 'refunded': return { tone: 'none', label: 'Refunded', detail: '' };
    case 'dismissed': return { tone: 'none', label: 'Removed', detail: 'No receipt asked for' };
    case 'matched': return matchedStage(expense);
  }
}

function matchedStage(e: StageExpense | null): LineStage {
  if (!e) return { tone: 'wait', label: 'Receipt uploaded', detail: '' };
  const receipt = e.day ? `Receipt of ${shortDay(e.day)}` : '';
  if (e.status === 'draft') return { tone: 'wait', label: 'Draft', detail: `${firstName(e.holderName)} is finishing it` };
  if (e.status === 'sent_back') {
    const on = shortDay(pacificDay(e.sentBackAt));
    return { tone: 'back', label: 'Sent back', detail: [`To ${firstName(e.holderName)}`, on].filter(Boolean).join(' · ') };
  }
  if (e.status === 'approved') {
    // The last approval given names who finished it.
    const last = [e.approval, e.secondApproval].filter((d): d is NonNullable<typeof d> => Boolean(d))
      .sort((a, b) => pacificDay(a.at).localeCompare(pacificDay(b.at))).at(-1);
    return { tone: 'ok', label: 'Approved', detail: last ? [last.byName, shortDay(pacificDay(last.at))].filter(Boolean).join(' · ') : '' };
  }
  if (e.status !== 'waiting') return { tone: 'wait', label: 'Receipt uploaded', detail: receipt };
  if (e.ask && !e.ask.answeredAt) return { tone: 'wait', label: `Asked ${e.ask.toName || 'a manager'}`, detail: 'Waiting for an answer' };
  const second = secondNeeded({ cents: e.cents, holderRole: e.holderRole });
  const secondWho = holderKindOf(e.holderRole) === 'staff' ? 'Manager or Admin' : 'Admin';
  const needAccounting = !e.approval;
  const needSecond = second && !e.secondApproval;
  if (needAccounting && needSecond) return { tone: 'wait', label: `Waiting for Accounting, ${secondWho}`, detail: '$150+ · needs both' };
  if (needAccounting) {
    return { tone: 'wait', label: 'Waiting for Accounting', detail: e.secondApproval ? `${secondWho} ✓ ${e.secondApproval.byName}` : receipt };
  }
  if (needSecond) return { tone: 'wait', label: `Waiting for ${secondWho}`, detail: `Accounting ✓ ${e.approval?.byName ?? ''}`.trim() };
  return { tone: 'wait', label: 'Waiting for approval', detail: receipt };
}
