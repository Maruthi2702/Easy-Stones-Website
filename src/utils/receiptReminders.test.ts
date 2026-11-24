import { describe, it, expect } from 'vitest';
import {
  DAY2_MS, DAY3_MS, HOUR_MS, RECEIPT_REMINDER_MIGRATION, approverIds, cleanRemindBody, defaultGroupsFor, dueMissingReminders,
  groupByRecipient, missingRecipients, nobodyReason, previewGroups, missingStageOf, pacificDay, remindProblem, reminderEmailWords, reminderHistory,
  reminderPushWords, resolveGroups, staffIndex, type Person, type ReminderExpense
} from './receiptReminders.ts';

const id = (n: number) => n.toString(16).padStart(24, '0');
const P = {
  rep: id(1), rep2: id(2), mgr: id(3), dir: id(4), acct: id(5), acct2: id(6), admin: id(7), admin2: id(8), kentMgr: id(9), gone: id(10), allMgr: id(11), mgrNoBranch: id(12)
};
const STAFF: Person[] = [
  { _id: P.rep, displayName: 'Maria Lopez', role: 'sales_rep', location: 'Seattle', email: 'maria@x.test' },
  { _id: P.rep2, displayName: 'Ray Ortiz', role: 'sales_rep', location: 'Kent', email: 'ray@x.test' },
  { _id: P.mgr, displayName: 'Dana Whitfield', role: 'manager', location: 'Seattle', email: 'dana@x.test' },
  { _id: P.dir, displayName: 'Dee Rector', role: 'director', location: 'Tacoma', assignedLocations: ['Seattle'], email: 'dee@x.test' },
  { _id: P.acct, displayName: 'Ann Count', role: 'accounting', email: 'ann@x.test' },
  { _id: P.acct2, displayName: 'Al Ledger', role: 'Accounting', email: '' },
  { _id: P.admin, displayName: 'Ada Min', role: 'admin', assignedLocations: ['*'], email: 'ada@x.test' },
  { _id: P.admin2, displayName: 'Abe Root', role: 'admin', email: 'abe@x.test' },
  { _id: P.kentMgr, displayName: 'Ken Boss', role: 'manager', location: 'Kent', email: 'ken@x.test' },
  { _id: P.gone, displayName: 'Old Manager', role: 'manager', location: 'Seattle', email: 'old@x.test', isActive: false },
  { _id: P.allMgr, displayName: 'Star Manager', role: 'manager', assignedLocations: ['*'], email: 'star@x.test' },
  { _id: P.mgrNoBranch, displayName: 'Lone Manager', role: 'manager', location: 'Spokane', email: 'lone@x.test' }
];
const staff = staffIndex(STAFF);
const NOW = new Date('2026-11-23T20:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const missing = (over: Partial<ReminderExpense> = {}): ReminderExpense => ({
  _id: id(100), userId: P.rep, holderName: 'Maria Lopez', merchant: 'Shell', cents: 6120, date: '2026-11-20', location: 'Seattle',
  status: 'missing', voidedAt: null, reminders: {}, createdAt: ago(DAY2_MS), ...over
});
const decision = (by: string) => ({ by, byName: 'x', at: NOW, comment: '' });
const waiting = (over: Partial<ReminderExpense> = {}) => missing({ status: 'waiting', ...over });

describe('which Missing rows are due', () => {
  it('nothing before 48 h, day 2 at 48 h, day 3 at 72 h', () => {
    expect(missingStageOf(missing({ createdAt: ago(47 * HOUR_MS) }), NOW)).toBeNull();
    expect(missingStageOf(missing({ createdAt: ago(DAY2_MS) }), NOW)).toEqual({ stage: 'day2', stamps: { missing2At: NOW.toISOString() } });
    expect(missingStageOf(missing({ createdAt: ago(60 * HOUR_MS), reminders: { missing2At: ago(12 * HOUR_MS) } }), NOW)).toBeNull();
    expect(missingStageOf(missing({ createdAt: ago(DAY3_MS), reminders: { missing2At: ago(DAY3_MS - DAY2_MS) } }), NOW))
      .toEqual({ stage: 'day3', stamps: { missing3At: NOW.toISOString() } });
  });
  it('an old row first seen past 72 h gets only day 3, both stamps set', () => {
    expect(missingStageOf(missing({ createdAt: ago(10 * 24 * HOUR_MS) }), NOW))
      .toEqual({ stage: 'day3', stamps: { missing2At: NOW.toISOString(), missing3At: NOW.toISOString() } });
  });
  it('never twice, never a voided row, another status or a row with no cardholder', () => {
    const both = { missing2At: ago(1), missing3At: ago(1) };
    expect(missingStageOf(missing({ createdAt: ago(DAY3_MS), reminders: both }), NOW)).toBeNull();
    expect(missingStageOf(missing({ voidedAt: NOW }), NOW)).toBeNull();
    expect(missingStageOf(missing({ status: 'draft' }), NOW)).toBeNull();
    expect(missingStageOf(missing({ userId: '' }), NOW)).toBeNull();
    expect(missingStageOf(missing({ userId: null }), NOW)).toBeNull();
    expect(dueMissingReminders([missing(), missing({ createdAt: ago(1) }), missing({ userId: null })], NOW)).toHaveLength(1);
  });
});

describe('who each stage reaches', () => {
  it('day 2: emails the holder and the branch managers (directors by assignment, never the deactivated or "*" ones); pushes the holder', () => {
    const [due] = dueMissingReminders([missing()], NOW);
    expect(missingRecipients(due!, staff)).toEqual({ email: [P.rep, P.mgr, P.dir], push: [P.rep] });
  });
  it('day 2 at a branch with no manager: the Admins instead', () => {
    const [due] = dueMissingReminders([missing({ location: 'Bellingham' })], NOW);
    expect(missingRecipients(due!, staff)).toEqual({ email: [P.rep, P.admin, P.admin2], push: [P.rep] });
  });
  it('day 3: holder, managers, every Accounting member and every Admin, by email and push', () => {
    const [due] = dueMissingReminders([missing({ createdAt: ago(DAY3_MS) })], NOW);
    const want = [P.rep, P.mgr, P.dir, P.acct, P.acct2, P.admin, P.admin2];
    expect(missingRecipients(due!, staff)).toEqual({ email: want, push: want });
  });
  it('a deactivated cardholder is dropped, the others still hear', () => {
    const s = staffIndex(STAFF.map((p) => (p._id === P.rep ? { ...p, isActive: false } : p)));
    const [due] = dueMissingReminders([missing()], NOW);
    expect(missingRecipients(due!, s)).toEqual({ email: [P.mgr, P.dir], push: [] });
  });
  it('an Admin’s own charge is never chased (it waits for Accounting)', () => {
    const [due] = dueMissingReminders([missing({ userId: P.admin })], NOW);
    expect(missingRecipients(due!, staff)).toEqual({ email: [], push: [] });
  });
});

describe('groups by hand', () => {
  it('never the sender, never twice, active only', () => {
    expect(resolveGroups({ holder: true, managers: true, accounting: true }, missing(), staff, { senderId: P.mgr }))
      .toEqual([P.rep, P.dir, P.acct, P.acct2]);
    expect(resolveGroups(['admins', 'approvers'], waiting(), staff, { senderId: P.admin })).not.toContain(P.admin);
    expect(resolveGroups({ managers: true }, missing({ location: 'Bellingham' }), staff)).toEqual([]);
  });
  it('approvers: Accounting (and Admins) while the Accounting approval is open', () => {
    expect(approverIds(waiting({ cents: 1000 }), staff)).toEqual([P.acct, P.acct2, P.admin, P.admin2]);
  });
  it('approvers: the second approvers for a staff member’s $150+ receipt once Accounting approved', () => {
    expect(approverIds(waiting({ cents: 15_000, approval: decision(P.acct) }), staff)).toEqual([P.mgr, P.dir, P.admin, P.admin2]);
  });
  it('approvers: both slots open lists both, an Admin who gave the second is not asked for the first', () => {
    expect(new Set(approverIds(waiting({ cents: 20_000 }), staff))).toEqual(new Set([P.acct, P.acct2, P.admin, P.admin2, P.mgr, P.dir]));
    expect(approverIds(waiting({ cents: 20_000, secondApproval: decision(P.admin) }), staff)).toEqual([P.acct, P.acct2, P.admin2]);
  });
  it('approvers: Admins only for a manager’s, director’s or accounting member’s $150+ receipt', () => {
    expect(approverIds(waiting({ userId: P.mgr, cents: 15_000, approval: decision(P.acct) }), staff)).toEqual([P.admin, P.admin2]);
    expect(approverIds(waiting({ userId: P.acct, cents: 15_000, approval: decision(P.acct2) }), staff)).toEqual([P.admin, P.admin2]);
  });
  it('approvers: an Admin’s receipt needs only Accounting (another Admin may stand in), never the holder', () => {
    expect(approverIds(waiting({ userId: P.admin, cents: 50_000 }), staff)).toEqual([P.acct, P.acct2, P.admin2]);
  });
  it('approvers: an open question → only the person asked', () => {
    const ask = { to: P.dir, toName: 'Dee', by: P.acct, byName: 'Ann', at: NOW, question: 'Who was this?', answer: '', answeredAt: null };
    expect(approverIds(waiting({ cents: 15_000, ask }), staff)).toEqual([P.dir]);
  });
  it('approvers: nobody for a receipt that isn’t waiting', () => {
    expect(approverIds(missing(), staff)).toEqual([]);
    expect(approverIds(waiting({ status: 'approved' }), staff)).toEqual([]);
  });
  it('the screen ticks the holder for a receipt they owe, the approvers for one that waits', () => {
    expect(defaultGroupsFor('missing')).toEqual({ holder: true });
    expect(defaultGroupsFor('sent_back')).toEqual({ holder: true });
    expect(defaultGroupsFor('waiting')).toEqual({ approvers: true });
  });
});

describe('one email and one push per person', () => {
  it('groups every receipt a person gets', () => {
    const a = missing({ _id: id(101) }), b = missing({ _id: id(102), userId: P.rep2, location: 'Kent' });
    const batches = groupByRecipient([
      { expense: a, stage: 'day2', email: [P.rep, P.mgr], push: [P.rep] },
      { expense: b, stage: 'day3', email: [P.rep2, P.mgr], push: [P.mgr] }
    ]);
    const mgr = batches.find((x) => x.userId === P.mgr)!;
    expect(mgr.email.map((i) => i.expense)).toEqual([a, b]);
    expect(mgr.push.map((i) => i.expense)).toEqual([b]);
    expect(batches).toHaveLength(3);
  });
});

describe('Send reminder by hand', () => {
  const today = pacificDay(NOW);
  const ACCT = { _id: P.acct, role: 'accounting', permissions: ['send_receipt_reminders'] };
  const MGR = { _id: P.mgr, role: 'manager', permissions: ['send_receipt_reminders'] };
  const team = new Set([P.rep, P.mgr]);
  it('Accounting and Admins about anyone', () => {
    expect(remindProblem(ACCT, missing({ userId: P.rep2 }), new Set(), today)).toBe('');
    expect(remindProblem({ ...ACCT, role: 'admin' }, missing({ userId: P.rep2 }), new Set(), today)).toBe('');
  });
  it('a manager only about their team', () => {
    expect(remindProblem(MGR, missing(), team, today)).toBe('');
    expect(remindProblem(MGR, missing({ userId: P.rep2 }), team, today)).toBe('Not on your team.');
    expect(remindProblem(MGR, missing({ userId: P.rep2 }), '*', today)).toBe('');
    expect(remindProblem({ ...MGR, role: 'sales_rep' }, missing(), team, today)).toBe('Not yours to remind.');
  });
  it('never a voided or approved receipt, once a day, and only with the switch', () => {
    expect(remindProblem(ACCT, missing({ voidedAt: NOW }), '*', today)).toBe('It was voided.');
    expect(remindProblem(ACCT, waiting({ status: 'approved' }), '*', today)).toBe('It’s already approved.');
    expect(remindProblem(ACCT, missing({ reminders: { lastDay: today } }), '*', today)).toBe('A reminder was already sent today.');
    expect(remindProblem(ACCT, missing({ reminders: { lastDay: '2026-11-22' } }), '*', today)).toBe('');
    expect(remindProblem({ ...ACCT, permissions: [] }, missing(), '*', today)).toBe('You can’t send reminders.');
  });
  it('the day is Pacific', () => {
    expect(pacificDay(new Date('2026-11-24T05:00:00Z'))).toBe('2026-11-23');
    expect(pacificDay(new Date('2026-11-24T09:00:00Z'))).toBe('2026-11-24');
  });
  it('checks the body', () => {
    expect(cleanRemindBody({ ids: [id(1)], to: { holder: true }, email: true, push: false }).value)
      .toEqual({ ids: [id(1)], to: { holder: true }, email: true, push: false, message: '' });
    expect(cleanRemindBody({ ids: [], to: {}, email: false, push: false }).problems).toMatchObject({ ids: expect.any(String), to: expect.any(String), how: expect.any(String) });
    expect(cleanRemindBody({ ids: Array.from({ length: 201 }, (_, i) => id(i + 1)), to: { holder: true }, email: true }).problems.ids).toMatch(/200/);
    expect(cleanRemindBody({ ids: ['nope'], to: { holder: true }, email: true }).problems.ids).toBeTruthy();
    expect(cleanRemindBody({ ids: [id(1)], to: { holder: true }, email: true, message: 'x'.repeat(301) }).problems.message).toBeTruthy();
    expect(cleanRemindBody({ ids: [id(1), id(1).toUpperCase()], to: { holder: 'yes', admins: true }, push: true }).value)
      .toMatchObject({ ids: [id(1)], to: { admins: true } });
  });
});

describe('words', () => {
  it('the history line', () => {
    expect(reminderHistory({ byName: 'Ann Count', names: ['Maria Lopez'], email: true, push: true, message: 'Please upload it' }))
      .toEqual({ by: 'Ann Count', action: 'sent a reminder', changes: 'to Maria Lopez · email + phone · “Please upload it”' });
    expect(reminderHistory({ byName: 'Easy Surfaces', names: ['A', 'B', 'C', 'D', 'E', 'F'], email: true, push: false, stage: 'day3' }).changes)
      .toBe('Missing receipt, day 3 · to A, B, C, D +2 more · email');
  });
  it('the cardholder is asked to upload; a manager is told who hasn’t', () => {
    const item = { expense: missing(), stage: 'day2' as const, email: [], push: [] };
    const own = reminderEmailWords({ readerId: P.rep, items: [item] });
    expect(own.subject).toBe('Missing receipt: Shell $61.20');
    expect(own.headline).toBe('Please upload your receipt');
    expect(own.lines).toEqual(['11-20-2026 · Shell · $61.20 — Upload the receipt']);
    const mgr = reminderEmailWords({ readerId: P.mgr, items: [item, { ...item, stage: 'day3' }] });
    expect(mgr.subject).toBe('Still missing: 2 card receipts');
    expect(mgr.lines[0]).toBe('11-20-2026 · Shell · $61.20 — Maria Lopez hasn’t uploaded the receipt');
  });
  it('email rows carry the amount and a total only for several', () => {
    const item = { expense: missing(), stage: 'day2' as const, email: [], push: [] };
    const one = reminderEmailWords({ readerId: P.rep, items: [item] });
    expect(one.rows).toEqual([{ title: 'Shell', sub: '11-20-2026 · Upload the receipt', amount: '$61.20' }]);
    expect(one.total).toBe('');
    expect(reminderEmailWords({ readerId: P.rep, items: [item, item] }).total).toBe('$122.40');
  });
  it('says when the sender is the only one in the groups, and names who each group means', () => {
    const solo = staffIndex(STAFF.filter((p) => p._id !== P.acct2));
    expect(nobodyReason(['accounting'], waiting(), solo, P.acct)).toMatch(/only person in the groups you picked/);
    expect(nobodyReason(['accounting'], waiting(), staff, P.rep)).toBe('Nobody to remind.');
    const pv = previewGroups([waiting()], solo, P.acct);
    expect(pv.accounting).toEqual({ names: [], ids: [], self: true });
    expect(pv.holder.names).toEqual(['Maria Lopez']);
  });
  it('a manual reminder carries who sent it and the note', () => {
    const item = { expense: waiting(), stage: 'manual' as const, email: [], push: [] };
    const words = reminderEmailWords({ readerId: P.acct, items: [item], senderName: 'Dana Whitfield', message: 'Please look today' });
    expect(words.subject).toBe('Reminder: Shell $61.20');
    expect(words.intro).toMatch(/Dana Whitfield/);
    expect(words.message).toBe('Please look today');
    expect(reminderPushWords({ readerId: P.acct, items: [item], senderName: 'Dana Whitfield' }))
      .toEqual({ title: 'Receipt reminder', body: 'Shell · $61.20 on 11-20-2026 — Maria Lopez’s receipt is waiting for approval (from Dana Whitfield)', path: '/sales?tab=card_receipts' });
    expect(reminderPushWords({ readerId: P.rep, items: [{ ...item, expense: missing(), stage: 'day2' }, { ...item, expense: missing(), stage: 'day2' }] }).body)
      .toBe('2 charges need a receipt');
  });
  it('Approve holders get Send reminders once', () => {
    expect(RECEIPT_REMINDER_MIGRATION).toEqual([{ from: 'approve_card_receipts', grant: ['send_receipt_reminders'] }]);
  });
});
