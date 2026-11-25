import { displayNameOf } from '../../utils/salesReps';
import { isBigReceipt, missingFor, missingLine, onBank, statusTotals, subLabel } from '../../utils/cardReceipts';
import { ALL_PEOPLE, viewerLocations, workLocationsOf } from '../../utils/teamScope';
import type { PersonOption } from '../../api/myTeam';
import type { Loose } from '../../types/records';
import type { ApprovalChip, Category, Expense, ExpenseActions, Reminders, RemindGroups, WaitingReason } from './types';

/** "Gas · Truck": the category and, when it has one, the type. */
export const categoryText = (categories: readonly Category[], e: { category: string; subcategory?: string }) => {
  const sub = e.subcategory ? subLabel(categories.find((c) => c.name === e.category), e.subcategory) : '';
  return [categoryLabel(categories, e.category), sub].filter(Boolean).join(' · ');
};

/** What the Filters panel, the search box and the status tiles narrow the list to. */
/** `people` is the cardholders ticked in the People filter; [] = everyone in view. */
/** `bank`: '' (every bank), 'amex' or 'encore'. `statement`: '' (all), 'on' (matched with a statement line) or 'off' (not on one yet). */
export type ReceiptFilters = { search: string; status: string; people: string[]; category: string; bank: string; statement: string };
export const NO_FILTERS: ReceiptFilters = { search: '', status: 'all', people: [], category: '', bank: '', statement: '' };

/** The Statement filter's choices (2026-11-24): the Expenses list's green rows and amber rows. */
export const STATEMENT_FILTERS = [
  { key: 'on', label: 'On the statement', dot: 'ok' },
  { key: 'off', label: 'Not on the statement', dot: 'wait' }
] as const;
/** 'on' / 'off' / '' (unknown) for one expense, as the rows and the filter read it. */
export const statementState = (e: Pick<Expense, 'onStatement'>) => (e.onStatement === true ? 'on' : e.onStatement === false ? 'off' : '');

export const categoryLabel = (categories: readonly Category[], name: string) =>
  categories.find((c) => c.name === name)?.label || (name ? name.replace(/_/g, ' ') : '');

/**
 * `base` is the list before the status tile and search (what the tiles count),
 * `rows` what's shown. Voided ones stay out unless asked for.
 */
export function visibleExpenses(list: readonly Expense[], f: ReceiptFilters, categories: readonly Category[]) {
  const base = list.filter((e) => !e.voided
    && (!f.people.length || f.people.includes(e.userId))
    && (!f.category || e.category === f.category)
    && (!f.statement || statementState(e) === f.statement)
    && onBank(e, f.bank));
  const q = f.search.trim().toLowerCase();
  const rows = base.filter((e) => (f.status === 'all' || e.status === f.status)
    && (!q || [e.merchant, e.holderName, e.cardLabel, e.note, e.purpose, e.customerName, categoryText(categories, e), e.location]
      .some((v) => String(v || '').toLowerCase().includes(q))));
  return { base, rows, totals: statusTotals(base), shown: statusTotals(rows) };
}

export const isPdfUrl = (url: string) => /\.pdf($|\?)/i.test(url) || url.startsWith('data:application/pdf');

/** What the cardholder still has to do, or why it was sent back — the line beside the status. */
export function statusLine(e: Expense, categories: readonly Category[]) {
  if (e.status === 'sent_back' && e.sentBack?.comment) return `“${e.sentBack.comment}” · ${e.sentBack.byName}`;
  if (e.status === 'draft' || e.status === 'sent_back' || e.status === 'missing') {
    return missingLine(missingFor(e, categories.find((c) => c.name === e.category)));
  }
  return '';
}

// ── Approvals, questions and reminders (2026-11-23) ─────────────────────────
// The server works out what the viewer may do (src/utils/receiptApproval.ts) and sends it on every
// expense as `actions` / `chips` / `waitingReason`; these only read it, with safe defaults.

export const NO_ACTIONS: ExpenseActions = { approve: null, sendBack: false, ask: false, withdrawAsk: false, answer: false, reopen: false, fillDetails: false };
export const actionsOf = (e: Expense): ExpenseActions => ({ ...NO_ACTIONS, ...(e.actions || {}) });
/** Why it's in Waiting for me; an older answer without `waitingReason` counts a decidable one as the Accounting kind. */
export const reasonOf = (e: Expense): WaitingReason | null => e.waitingReason ?? (e.canDecide ? 'accounting' : null);
export const askIsOpen = (e: Expense) => Boolean(e.ask && !e.ask.answeredAt);
/** Approvals chips show on a receipt waiting for approval or approved (a draft's "waiting" would mislead). */
export const chipsShown = (e: Expense): ApprovalChip[] => (e.status === 'waiting' || e.status === 'approved' ? e.chips || [] : []);
/** "Accounting ✓ Maria" / "Manager or Admin — waiting". */
export const chipText = (c: ApprovalChip) => (c.done ? `${c.label} ✓ ${c.by}`.trim() : `${c.label} — waiting`);
/** The table's short form: "Acct ✓ · Mgr –". */
export const chipShort = (c: ApprovalChip) =>
  `${c.key === 'accounting' ? 'Acct' : c.label === 'Admin' ? 'Admin' : 'Mgr'} ${c.done ? '✓' : '–'}`;
export const firstName = (name: string) => String(name || '').trim().split(/\s+/)[0] || '';

/** Waiting for me's filter: All · Needs Accounting · Needs second approval · Asked of me. */
export type WaitFilter = 'all' | WaitingReason;
export const WAIT_FILTERS: readonly { key: WaitFilter; label: string; short: string }[] = [
  { key: 'all', label: 'All', short: 'All' },
  { key: 'accounting', label: 'Needs Accounting', short: 'Accounting' },
  { key: 'second', label: 'Needs second approval', short: 'Second' },
  { key: 'asked', label: 'Asked of me', short: 'Asked' }
];
export const waitCounts = (list: readonly Expense[]) => {
  const n: Record<WaitFilter, number> = { all: 0, accounting: 0, second: 0, asked: 0 };
  for (const e of list) {
    if (e.voided) continue;
    n.all += 1;
    const r = reasonOf(e);
    if (r) n[r] += 1;
  }
  return n;
};
export const byWaitFilter = (list: readonly Expense[], f: WaitFilter) => (f === 'all' ? [...list] : list.filter((e) => reasonOf(e) === f));

/** A reminder can be sent about a receipt that isn't finished: not approved, not voided. */
/** Still the cardholder's to finish (the To-do list, review B1): a Missing receipt, a Draft, one Sent back. */
export const isTodo = (e: Pick<Expense, 'status' | 'voided'>) => !e.voided && (e.status === 'missing' || e.status === 'draft' || e.status === 'sent_back');
/** How many To-do cards show before "Show all". */
export const TODO_SHOWN = 6;

export const remindable = (e: Expense) => !e.voided && e.status !== 'approved';

/** Send reminder…'s starting ticks: missing / draft / sent back → the cardholder; waiting → whoever must approve. */
export function remindDefaults(list: readonly Expense[]): RemindGroups {
  const holder = list.some((e) => ['missing', 'draft', 'sent_back'].includes(e.status));
  const approvers = list.some((e) => e.status === 'waiting');
  return { holder: holder || !approvers, managers: false, accounting: false, admins: false, approvers };
}

const shortDay = (at: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T12:00:00`) : new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** "Reminded today by Maria" / "Reminder sent Nov 23 by Maria" / "Automatic reminder sent Nov 21"; '' when none. */
export function reminderLine(r: Reminders | null | undefined, today: string) {
  if (!r) return '';
  if (r.lastDay || r.lastAt) {
    const by = r.lastByName ? ` by ${r.lastByName}` : '';
    if (today && r.lastDay === today) return `Reminded today${by}`;
    const day = shortDay(r.lastAt || r.lastDay || '');
    return day ? `Reminder sent ${day}${by}` : '';
  }
  const auto = r.missing3At || r.missing2At;
  const day = auto ? shortDay(auto) : '';
  return day ? `Automatic reminder sent ${day}` : '';
}

/**
 * The People filter's list: each cardholder in the list once, under the branch
 * they work at (the Visits People filter's headings). The list the server sent
 * is already limited to the viewer's access (View all / View branch → their
 * team), so only those people are offered. A person under two branches sits
 * under one the viewer is assigned, else their first; someone the staff list
 * doesn't know sits under the branch on their receipt.
 */
export function holderPeople(
  list: readonly Expense[], staff: readonly Loose[], viewer: Loose | null | undefined,
  /** Everyone with a card (GET /cardholders), so the list isn't only who has an expense in this month. */
  holders: readonly { id: string; name: string }[] = []
): PersonOption[] {
  const mine = viewerLocations(viewer);
  const byId = new Map(staff.map((p) => [String(p._id ?? p.id), p]));
  const seen = new Map<string, { name: string; location: string }>();
  for (const h of holders) if (!seen.has(h.id)) seen.set(h.id, { name: h.name, location: '' });
  for (const e of list) seen.set(e.userId, { name: e.holderName || e.cardLabel || seen.get(e.userId)?.name || '', location: e.location || '' });
  return [...seen.entries()].map(([id, e]) => {
    const person = byId.get(id);
    const works = person ? workLocationsOf(person) : [];
    const heading = (mine === ALL_PEOPLE ? works[0] : works.find((l) => mine.includes(l)) || works[0]) || e.location || '';
    return { value: id, id, label: person ? displayNameOf(person) : e.name, location: heading, locations: works, inactive: Boolean(person && person.isActive === false) };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

export type StatusBand = {
  tone: 'wait' | 'ok' | 'back' | 'draft';
  icon: string;
  title: string;
  sub: string;
  /** The thin progress bar: sent → each approval the receipt needs (its chips) → approved. Empty when there is no path to show. */
  segs: ('done' | 'now' | 'off')[];
};

/**
 * The one thin band at the top of an opened receipt (it replaces the Status
 * field and the Approvals chips row): the state, who it waits on, and how far
 * the approvals are. It reads the server's `chips` and `ask`; voided ones have
 * their own note, so none here.
 */
export function statusBandOf(e: Expense, categories: readonly Category[]): StatusBand | null {
  if (e.voided) return null;
  const chips = chipsShown(e);
  const pending = chips.findIndex((c) => !c.done);
  const segs: StatusBand['segs'] = ['done', ...chips.map((c, i): 'done' | 'now' | 'off' => (c.done ? 'done' : i === pending ? 'now' : 'off')), e.status === 'approved' ? 'done' : 'off'];
  const doneText = chips.map(chipText).join(' · ');
  if (e.status === 'waiting') {
    if (askIsOpen(e) && e.ask) return { tone: 'wait', icon: '?', title: `Waiting for ${e.ask.toName}`, sub: `${e.ask.byName} asked a question`, segs };
    const next = chips[pending];
    return {
      tone: 'wait', icon: '●',
      title: next ? `Waiting for ${next.key === 'accounting' ? 'Accounting' : next.label}` : 'Waiting for approval',
      sub: doneText || (e.needsSecond || isBigReceipt(e.cents) ? 'Over $150 also needs a second approval' : 'Accounting approves every receipt'),
      segs,
    };
  }
  if (e.status === 'approved') return { tone: 'ok', icon: '✓', title: 'Approved', sub: doneText || 'Locked until it is reopened', segs };
  if (e.status === 'sent_back') {
    return { tone: 'back', icon: '!', title: `${e.sentBack?.byName || 'An approver'} sent this back`, sub: e.sentBack?.comment ? `“${e.sentBack.comment}”` : statusLine(e, categories), segs: [] };
  }
  if (e.status === 'missing') return { tone: 'back', icon: '!', title: 'Missing receipt', sub: statusLine(e, categories), segs: [] };
  if (e.status === 'draft') return { tone: 'draft', icon: '✎', title: 'Draft, not sent yet', sub: statusLine(e, categories), segs: [] };
  return null;
}
