/**
 * Card receipt reminders (owner, 2026-11-23). Pure rules, shared by the hourly job
 * (src/jobs/missingReceiptReminders.ts), the Send reminder route (src/routes/cardReceiptReminders.ts) and the
 * sender (src/services/receiptReminders.ts). Who approves is src/utils/receiptApproval.ts; never re-decided here.
 *
 *   - **Missing receipt, day 2** (48 h after the Missing row was made): email the cardholder and their branch's
 *     managers / directors (the Admins when the branch has none); push the cardholder.
 *   - **Day 3** (72 h): email and push the cardholder, the branch's managers, every Accounting member and every Admin.
 *   - Each sent once per receipt (`reminders.missing2At` / `missing3At`). A row already past 72 h when first seen gets
 *     only the day-3 one, and both stamps are set. One email per person per run, listing all their receipts.
 *   - **Send reminder** (switch `send_receipt_reminders`): one receipt or many, once per receipt per Pacific day
 *     (`reminders.lastDay`). Accounting and Admins about anyone's; managers / directors about their team's
 *     (src/utils/teamScope.ts). Never a voided or approved receipt, never to the sender.
 *   - Only active staff are reminded.
 */
import { CARD_RECEIPTS, can, formatMoney, usDate } from './cardReceipts.ts';
import {
  branchManagersOf, holderKindOf, isAccountingRole, isAccountingSide, isAdminRole, isManagerRole, stillNeeded,
  type ApprovalState
} from './receiptApproval.ts';
import { displayNameOf } from './salesReps.ts';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY2_MS = 48 * HOUR_MS;
export const DAY3_MS = 72 * HOUR_MS;
export const REMINDER_ZONE = 'America/Los_Angeles';
/** The most receipts one Send reminder takes. */
export const MAX_REMIND_IDS = 200;
export const MAX_REMIND_MESSAGE = 300;
/** Where a reminder opens: Sales → Credit Card Receipts. */
export const RECEIPTS_PATH = '/sales?tab=card_receipts';
/** The name automatic reminders carry in a receipt's history. */
export const AUTOMATIC_BY = 'Easy Surfaces';
export const REMINDER_ACTION = 'sent a reminder';
/** The staff fields the job and the route read (staffData.findUsers). */
export const STAFF_FIELDS = '_id username displayName email role isActive location assignedLocations';

/** Every role that can approve receipts gets Send reminders once (server.ts ACTION_MIGRATIONS). */
export const RECEIPT_REMINDER_MIGRATION = Object.freeze([
  { from: CARD_RECEIPTS.APPROVE, grant: [CARD_RECEIPTS.REMIND] }
]);

export const REMINDER_GROUPS = ['holder', 'managers', 'accounting', 'admins', 'approvers'] as const;
export type ReminderGroup = typeof REMINDER_GROUPS[number];
export type GroupFlags = Partial<Record<ReminderGroup, boolean>>;

export type Person = {
  _id?: unknown; id?: unknown; username?: string | null; displayName?: string | null; email?: string | null;
  role?: string | null; isActive?: boolean | null; location?: string | null; assignedLocations?: string[] | null;
};
export type Reminders = { missing2At?: string; missing3At?: string; lastDay?: string; lastAt?: string; lastBy?: string; lastByName?: string };
/** What the rules read off an expense (the stored record). */
export type ReminderExpense = {
  _id?: unknown; id?: unknown; userId?: string | null; holderName?: string | null; merchant?: string | null; cents?: number | null;
  date?: string | null; location?: string | null; status: string; voidedAt?: unknown;
  approval?: ApprovalState['approval']; secondApproval?: ApprovalState['secondApproval']; ask?: ApprovalState['ask'];
  reminders?: Reminders | null; createdAt?: string | Date | null;
};

export const idOf = (x: { _id?: unknown; id?: unknown } | null | undefined) => String(x?._id ?? x?.id ?? '');
export const nameOfPerson = (p: Person | null | undefined) => displayNameOf(p as never);
const isActive = (p: Person) => p.isActive !== false;
const time = (v: unknown) => (v == null || v === '' ? NaN : new Date(v as string).getTime());

/** The Pacific day of a moment, 'YYYY-MM-DD' (Send reminder's "once a day"). */
export const pacificDay = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: REMINDER_ZONE });

// ── Automatic Missing-receipt reminders ─────────────────────────────────────

export type MissingStage = 'day2' | 'day3';
export type DueReminder = { expense: ReminderExpense; stage: MissingStage; stamps: Reminders };

/**
 * Whether this Missing row is due a reminder at `now`, and the stamps that record it. Day 3 wins when both are
 * due (an old row gets only the day-3 one, with both stamps set).
 */
export function missingStageOf(e: ReminderExpense, now: Date): { stage: MissingStage; stamps: Reminders } | null {
  if (e.status !== 'missing' || e.voidedAt || !e.userId) return null;
  const age = now.getTime() - time(e.createdAt);
  if (!Number.isFinite(age)) return null;
  const r = e.reminders || {};
  const at = now.toISOString();
  if (age >= DAY3_MS && !r.missing3At) return { stage: 'day3', stamps: r.missing2At ? { missing3At: at } : { missing2At: at, missing3At: at } };
  if (age >= DAY2_MS && !r.missing2At && !r.missing3At) return { stage: 'day2', stamps: { missing2At: at } };
  return null;
}

export const dueMissingReminders = (list: readonly ReminderExpense[], now: Date): DueReminder[] =>
  list.flatMap((expense) => {
    const due = missingStageOf(expense, now);
    return due ? [{ expense, ...due }] : [];
  });

/** Who each stage emails and pushes. Day 2's managers fall back to the Admins when the branch has none. */
export const STAGE_GROUPS: Readonly<Record<MissingStage, { email: readonly ReminderGroup[]; push: readonly ReminderGroup[] }>> = Object.freeze({
  day2: { email: ['holder', 'managers'], push: ['holder'] },
  day3: { email: ['holder', 'managers', 'accounting', 'admins'], push: ['holder', 'managers', 'accounting', 'admins'] }
});

// ── Who a group is ──────────────────────────────────────────────────────────

export type StaffIndex = { list: readonly Person[]; byId: Map<string, Person> };
export const staffIndex = (staff: readonly Person[]): StaffIndex => ({ list: staff, byId: new Map(staff.map((p) => [idOf(p), p])) });

/** The rules' view of an expense, with the cardholder's role now. */
export const approvalStateOf = (e: ReminderExpense, staff: StaffIndex): ApprovalState => ({
  userId: String(e.userId ?? ''), holderRole: staff.byId.get(String(e.userId ?? ''))?.role ?? null, location: e.location ?? '',
  cents: Number(e.cents) || 0, status: e.status, voided: e.voidedAt || null,
  approval: e.approval ?? null, secondApproval: e.secondApproval ?? null, ask: e.ask ?? null
});

const activeWhere = (staff: StaffIndex, test: (p: Person) => boolean) => staff.list.filter((p) => isActive(p) && test(p)).map(idOf);

/** Who still has to approve a waiting receipt (stillNeeded): Accounting (+ Admins), the second approvers, or the person asked. */
export function approverIds(e: ReminderExpense, staff: StaffIndex): string[] {
  const s = approvalStateOf(e, staff);
  const need = stillNeeded(s);
  if (need.askedId) return [need.askedId];
  const holder = s.userId;
  const ids: string[] = [];
  const gaveSecond = String(s.secondApproval?.by ?? '');
  const gaveAccounting = String(s.approval?.by ?? '');
  if (need.accounting) ids.push(...activeWhere(staff, (p) => isAccountingSide(p.role)).filter((id) => id !== gaveSecond));
  if (need.second) {
    const admins = activeWhere(staff, (p) => isAdminRole(p.role));
    const managers = holderKindOf(s.holderRole) === 'staff' ? branchManagersOf(staff.list as never[], s.location, holder).map(idOf) : [];
    ids.push(...[...managers, ...admins].filter((id) => id !== gaveAccounting));
  }
  return ids.filter((id) => id !== holder);
}

/**
 * The people a set of groups means for one receipt: active staff only, never `senderId`, no repeats.
 * `managersOrAdmins`: a branch with no manager / director has the Admins instead (day 2's email).
 */
export function resolveGroups(groups: readonly ReminderGroup[] | GroupFlags, e: ReminderExpense, staff: StaffIndex,
  { senderId = '', managersOrAdmins = false }: { senderId?: string; managersOrAdmins?: boolean } = {}): string[] {
  const want = new Set<ReminderGroup>(Array.isArray(groups) ? groups : REMINDER_GROUPS.filter((g) => (groups as GroupFlags)[g]));
  const holder = String(e.userId ?? '');
  const ids: string[] = [];
  if (want.has('holder') && holder) ids.push(holder);
  if (want.has('managers')) {
    const managers = branchManagersOf(staff.list as never[], e.location, holder).map(idOf);
    ids.push(...(managers.length || !managersOrAdmins ? managers : activeWhere(staff, (p) => isAdminRole(p.role))));
  }
  if (want.has('accounting')) ids.push(...activeWhere(staff, (p) => isAccountingRole(p.role)));
  if (want.has('admins')) ids.push(...activeWhere(staff, (p) => isAdminRole(p.role)));
  if (want.has('approvers')) ids.push(...approverIds(e, staff));
  const out: string[] = [];
  for (const id of ids) {
    const p = staff.byId.get(id);
    if (!id || id === String(senderId) || out.includes(id) || !p || !isActive(p)) continue;
    out.push(id);
  }
  return out;
}

/** Why a receipt had nobody to remind: the sender is the only one the ticked groups hold, or nobody is in them. */
export function nobodyReason(groups: readonly ReminderGroup[] | GroupFlags, e: ReminderExpense, staff: StaffIndex, senderId: string): string {
  const withSender = resolveGroups(groups, e, staff);
  if (withSender.length && withSender.every((id) => id === String(senderId))) {
    return 'You’re the only person in the groups you picked, and a reminder never goes to the person who sends it.';
  }
  return 'Nobody to remind.';
}

/** Names of who each group means, for one or more receipts, never the sender: what the form shows before sending. */
export function previewGroups(expenses: readonly ReminderExpense[], staff: StaffIndex, senderId: string): Record<ReminderGroup, { names: string[]; self: boolean }> {
  const out = {} as Record<ReminderGroup, { names: string[]; self: boolean }>;
  for (const g of REMINDER_GROUPS) {
    const ids = new Set<string>();
    for (const e of expenses) for (const id of resolveGroups([g], e, staff)) ids.add(id);
    out[g] = {
      names: [...ids].filter((id) => id !== String(senderId)).map((id) => nameOfPerson(staff.byId.get(id))),
      self: ids.has(String(senderId))
    };
  }
  return out;
}

/** A Missing row's people for its stage: { email, push } ids. A cardholder who is an Admin is never reminded (their charge waits for Accounting). */
export function missingRecipients(due: DueReminder, staff: StaffIndex): { email: string[]; push: string[] } {
  const holder = staff.byId.get(String(due.expense.userId ?? ''));
  if (holder && holderKindOf(holder.role) === 'admin') return { email: [], push: [] };
  const groups = STAGE_GROUPS[due.stage];
  return {
    email: resolveGroups(groups.email, due.expense, staff, { managersOrAdmins: due.stage === 'day2' }),
    push: resolveGroups(groups.push, due.expense, staff, { managersOrAdmins: due.stage === 'day2' })
  };
}

// ── One batch per person ────────────────────────────────────────────────────

export type ReminderItem = { expense: ReminderExpense; stage: MissingStage | 'manual'; email: readonly string[]; push: readonly string[] };
export type RecipientBatch = { userId: string; email: ReminderItem[]; push: ReminderItem[] };

/** Each person once, with the receipts they get by email and by push (one email and one push per person per run). */
export function groupByRecipient(items: readonly ReminderItem[]): RecipientBatch[] {
  const by = new Map<string, RecipientBatch>();
  const of = (id: string) => by.get(id) ?? (by.set(id, { userId: id, email: [], push: [] }), by.get(id)!);
  for (const item of items) {
    for (const id of item.email) of(id).email.push(item);
    for (const id of item.push) of(id).push.push(item);
  }
  return [...by.values()];
}

// ── Send reminder (by hand) ─────────────────────────────────────────────────

export type Sender = Person & { permissions?: readonly string[] | null };
/** The sender's team: '*' (everyone) or the ids on it (src/services/teamDirectory.ts teamOfRequest). */
export type Team = '*' | ReadonlySet<string>;

/** Why `sender` may not remind about this receipt now, or ''. */
export function remindProblem(sender: Sender, e: ReminderExpense, team: Team, today: string): string {
  if (!can(sender, CARD_RECEIPTS.REMIND)) return 'You can’t send reminders.';
  if (e.voidedAt) return 'It was voided.';
  if (e.status === 'approved') return 'It’s already approved.';
  if (e.reminders?.lastDay === today) return 'A reminder was already sent today.';
  if (isAccountingSide(sender.role)) return '';
  if (isManagerRole(sender.role) && (team === '*' || team.has(String(e.userId ?? '')))) return '';
  return isManagerRole(sender.role) ? 'Not on your team.' : 'Not yours to remind.';
}

/** The groups the screen ticks first: the cardholder for a receipt they owe, whoever must approve one that's waiting. */
export const defaultGroupsFor = (status: string): GroupFlags => (status === 'waiting' ? { approvers: true } : { holder: true });

export type RemindBody = { ids: string[]; to: GroupFlags; email: boolean; push: boolean; message: string };

/** Checks Send reminder's body. */
export function cleanRemindBody(body: unknown): { value: RemindBody | null; problems: Record<string, string> } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const problems: Record<string, string> = {};
  const raw = Array.isArray(b.ids) ? b.ids : null;
  const ids = raw ? [...new Set(raw.map((x) => String(x ?? '').trim().toLowerCase()))] : [];
  if (!raw || !ids.length) problems.ids = 'Pick at least one receipt.';
  else if (ids.length > MAX_REMIND_IDS) problems.ids = `Pick at most ${MAX_REMIND_IDS} receipts.`;
  else if (ids.some((id) => !/^[0-9a-f]{24}$/.test(id))) problems.ids = 'A receipt id isn’t valid.';
  const toRaw = (b.to && typeof b.to === 'object' ? b.to : {}) as Record<string, unknown>;
  const to: GroupFlags = {};
  for (const g of REMINDER_GROUPS) if (toRaw[g] === true) to[g] = true;
  if (!Object.keys(to).length) problems.to = 'Pick who to remind.';
  const email = b.email === true, push = b.push === true;
  if (!email && !push) problems.how = 'Pick email, phone or both.';
  if (b.message != null && typeof b.message !== 'string') problems.message = 'The message must be text.';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (message.length > MAX_REMIND_MESSAGE) problems.message = `Keep the message under ${MAX_REMIND_MESSAGE} characters.`;
  return Object.keys(problems).length ? { value: null, problems } : { value: { ids, to, email, push, message }, problems };
}

// ── Words ───────────────────────────────────────────────────────────────────

const clip = (s: unknown, n: number) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const merchantOf = (e: ReminderExpense) => clip(e.merchant, 60) || 'A charge';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Names for a history line: "Maria Lopez, Dana Whitfield +3 more". */
export function namesLine(names: readonly string[], max = 4) {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}

/** How it went: "email + phone", "email", "phone". */
export const channelsLine = (email: boolean, push: boolean) => [email && 'email', push && 'phone'].filter(Boolean).join(' + ');

/** The history line a reminder leaves on a receipt: `{by} sent a reminder: {changes}`. */
export function reminderHistory({ byName, names, email, push, message = '', stage }: {
  byName: string; names: readonly string[]; email: boolean; push: boolean; message?: string; stage?: MissingStage;
}) {
  const what = stage ? `Missing receipt, day ${stage === 'day2' ? 2 : 3} · ` : '';
  const quote = message ? ` · “${clip(message, MAX_REMIND_MESSAGE)}”` : '';
  return { by: byName, action: REMINDER_ACTION, changes: `${what}to ${namesLine(names)} · ${channelsLine(email, push)}${quote}` };
}

/** What the reader is asked to do about one receipt. */
function needLine(e: ReminderExpense, own: boolean, holder: string) {
  switch (e.status) {
    case 'missing': return own ? 'Upload the receipt' : `${holder} hasn’t uploaded the receipt`;
    case 'draft': return own ? 'Finish it and send it for approval' : `${holder} hasn’t finished it`;
    case 'sent_back': return own ? 'Fix it and send it again' : `Sent back to ${holder}`;
    case 'waiting': return own ? 'Waiting for approval' : `${holder}’s receipt is waiting for approval`;
    default: return '';
  }
}

/** One line per receipt: "10-03-2026 · Shell · $61.20 — Upload the receipt". */
export function receiptLine(e: ReminderExpense, readerId: string) {
  const own = String(e.userId ?? '') === readerId;
  const holder = clip(e.holderName, 40) || 'The cardholder';
  const head = [e.date ? usDate(String(e.date)) : '', merchantOf(e), formatMoney(Number(e.cents) || 0)].filter(Boolean).join(' · ');
  const need = needLine(e, own, holder);
  return need ? `${head} — ${need}` : head;
}

export type EmailRow = { title: string; sub: string; amount: string };
export type EmailWords = { subject: string; headline: string; intro: string; lines: string[]; rows: EmailRow[]; total: string; message: string; button: string };

/** The email one person gets for their receipts in a run (or one Send reminder). */
export function reminderEmailWords({ readerId, items, senderName = '', message = '' }: {
  readerId: string; items: readonly ReminderItem[]; senderName?: string; message?: string;
}): EmailWords {
  const list = items.map((i) => i.expense);
  const n = list.length;
  const manual = items.every((i) => i.stage === 'manual');
  const late = items.some((i) => i.stage === 'day3');
  const allOwn = list.every((e) => String(e.userId ?? '') === readerId);
  const allMissing = list.every((e) => e.status === 'missing');
  const one = list[0]!;
  const single = `${merchantOf(one)} ${formatMoney(Number(one.cents) || 0)}`;
  let subject: string, headline: string, intro: string;
  if (manual) {
    subject = n === 1 ? `Reminder: ${single}` : `Reminder: ${plural(n, 'card receipt')}`;
    headline = n === 1 ? 'A card receipt needs you' : `${plural(n, 'card receipt')} need you`;
    intro = senderName ? `${senderName} sent you a reminder about ${n === 1 ? 'this receipt' : 'these receipts'}.` : 'A reminder about these receipts.';
  } else {
    const word = late ? 'Still missing' : 'Missing receipt';
    subject = n === 1 ? `${word}: ${single}` : `${word}: ${plural(n, 'card receipt')}`;
    headline = allOwn
      ? (n === 1 ? 'Please upload your receipt' : 'Please upload your receipts')
      : (n === 1 ? 'A card receipt hasn’t been uploaded' : `${plural(n, 'card receipt')} haven’t been uploaded`);
    intro = allOwn
      ? `${n === 1 ? 'This charge has' : 'These charges have'} no receipt yet${late ? ' after three days' : ''}. Upload ${n === 1 ? 'it' : 'them'} in Credit Card Receipts.`
      : `${n === 1 ? 'This company-card charge has' : 'These company-card charges have'} had no receipt for ${late ? 'three days' : 'two days'}.`;
  }
  if (!allMissing && !manual) intro = 'These receipts need attention.';
  const rows = list.map((e) => {
    const need = needLine(e, String(e.userId ?? '') === readerId, clip(e.holderName, 40) || 'The cardholder');
    return { title: merchantOf(e), sub: [e.date ? usDate(String(e.date)) : '', need].filter(Boolean).join(' · '), amount: formatMoney(Number(e.cents) || 0) };
  });
  const total = n > 1 ? formatMoney(list.reduce((sum, e) => sum + (Number(e.cents) || 0), 0)) : '';
  return { subject, headline, intro, lines: list.map((e) => receiptLine(e, readerId)), rows, total, message: clip(message, MAX_REMIND_MESSAGE), button: 'Open Credit Card Receipts' };
}

/** The push one person gets: title and body (opens Credit Card Receipts). */
export function reminderPushWords({ readerId, items, senderName = '' }: { readerId: string; items: readonly ReminderItem[]; senderName?: string }) {
  const list = items.map((i) => i.expense);
  const manual = items.every((i) => i.stage === 'manual');
  const late = items.some((i) => i.stage === 'day3');
  const title = manual ? 'Receipt reminder' : late ? 'Receipt still missing' : 'Missing receipt';
  if (list.length === 1) {
    const e = list[0]!;
    const own = String(e.userId ?? '') === readerId;
    const what = `${merchantOf(e)} · ${formatMoney(Number(e.cents) || 0)}${e.date ? ` on ${usDate(String(e.date))}` : ''}`;
    const need = needLine(e, own, clip(e.holderName, 40) || 'The cardholder');
    return { title, body: clip(`${what}${need ? ` — ${need}` : ''}${manual && senderName ? ` (from ${senderName})` : ''}`, 220), path: RECEIPTS_PATH };
  }
  const own = list.every((e) => String(e.userId ?? '') === readerId);
  const from = manual && senderName ? ` (from ${senderName})` : '';
  const body = own && list.every((e) => e.status === 'missing')
    ? `${plural(list.length, 'charge')} need a receipt${from}`
    : `${plural(list.length, 'card receipt')} need attention${from}`;
  return { title, body, path: RECEIPTS_PATH };
}
