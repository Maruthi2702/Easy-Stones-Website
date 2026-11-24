import type { Loose } from '../types/records.ts';
// Send reminder (src/routes/cardReceiptReminders.ts) against a throwaway in-memory MongoDB, with fake senders:
// one email and push per person for all their receipts, skips with their reasons, the history line, the
// once-a-day stamp, updatedAt left alone, the switch, and a manager limited to their team.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createRemindersRouter } = await import('./cardReceiptReminders.ts');
const { CardExpense } = await import('../models/CardReceipts.ts');
const { default: User } = await import('../models/User.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;
const emails: { to: string; subject: string; html: string }[] = [];
const pushes: { ids: string[]; title: string; body: string }[] = [];
let failEmail = false;
const flush = () => new Promise((r) => setTimeout(r, 20));

const oid = () => new mongoose.Types.ObjectId().toString();
const P = { rep: oid(), rep2: oid(), mgr: oid(), acct: oid(), admin: oid() };
const REMIND = 'send_receipt_reminders';
const ACCT = { id: P.acct, displayName: 'Ann Count', role: 'accounting', permissions: [REMIND] };
const MGR = { id: P.mgr, displayName: 'Dana Whitfield', role: 'manager', location: 'Seattle', assignedLocations: ['Seattle'], permissions: [REMIND] };
const NOSWITCH = { ...ACCT, permissions: ['approve_card_receipts'] };
const NOW = new Date('2026-11-23T20:00:00Z');
const OLD = new Date('2026-11-18T19:00:00Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await CardExpense.init();
  app = express();
  app.use(express.json());
  app.use('/api/card-receipts', createRemindersRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); req.userId = req.user.id; next(); },
    now: () => NOW,
    senders: {
      sendEmail: async (o) => { emails.push(o); return failEmail ? { success: false, error: 'down' } : { success: true }; },
      sendPush: async (ids, m) => { pushes.push({ ids, title: m.title, body: m.body }); },
      phonesOf: async (ids) => ids.filter((i) => i === P.rep)
    }
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const exp = { waiting: oid(), missing: oid(), missing2: oid(), approved: oid(), voided: oid(), kent: oid(), remindedToday: oid() };
beforeEach(async () => {
  emails.length = 0; pushes.length = 0; failEmail = false;
  await Promise.all([CardExpense, User].map((M) => (M as Loose).collection.deleteMany({})));
  const u = (id: string, f: Loose) => ({ _id: new mongoose.Types.ObjectId(id), password: 'x'.repeat(10), isActive: true, ...f });
  await User.collection.insertMany([
    u(P.rep, { username: 'maria', displayName: 'Maria Lopez', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], email: 'maria@x.test' }),
    u(P.rep2, { username: 'ray', displayName: 'Ray Ortiz', role: 'sales_rep', location: 'Kent', assignedLocations: ['Kent'], email: '' }),
    u(P.mgr, { username: 'dana', displayName: 'Dana Whitfield', role: 'manager', location: 'Seattle', assignedLocations: ['Seattle'], email: 'dana@x.test' }),
    u(P.acct, { username: 'ann', displayName: 'Ann Count', role: 'accounting', email: 'ann@x.test' }),
    u(P.admin, { username: 'ada', displayName: 'Ada Min', role: 'admin', assignedLocations: ['*'], email: 'ada@x.test' })
  ]);
  const base = { userId: P.rep, holderName: 'Maria Lopez', cardLabel: 'MARU92069', location: 'Seattle', date: '2026-11-18', month: '2026-11',
    cents: 6120, category: '', receiptUrl: '', status: 'missing', approval: null, voidedAt: null, history: [], createdAt: OLD, updatedAt: OLD };
  const e = (id: string, f: Loose) => ({ ...base, _id: new mongoose.Types.ObjectId(id), ...f });
  await CardExpense.collection.insertMany([
    e(exp.waiting, { merchant: 'Hilton', status: 'waiting', cents: 900, category: 'fuel', history: [{ at: OLD, by: 'Maria Lopez', action: 'added', changes: '' }] }),
    e(exp.missing, { merchant: 'Shell' }),
    e(exp.missing2, { merchant: 'Chevron', cents: 4000 }),
    e(exp.approved, { merchant: 'Office Depot', status: 'approved' }),
    e(exp.voided, { merchant: 'Lyft', voidedAt: OLD }),
    e(exp.kent, { merchant: 'Arco', userId: P.rep2, holderName: 'Ray Ortiz', location: 'Kent' }),
    e(exp.remindedToday, { merchant: 'Subway', reminders: { lastDay: '2026-11-23' } })
  ]);
});

const as = (user: Loose) => ({
  remind: (body: Loose) => request(app).post('/api/card-receipts/expenses/remind').set('x-test-user', JSON.stringify(user)).send(body)
});
const body = (ids: string[], over: Loose = {}) => ({ ids, to: { holder: true }, email: true, push: true, ...over });

describe('POST /expenses/remind', () => {
  it('needs the switch', async () => {
    await as(NOSWITCH).remind(body([exp.missing])).expect(403);
    await as({}).remind(body([exp.missing])).expect(403);
  });

  it('checks the body', async () => {
    const res = await as(ACCT).remind({ ids: [], to: {}, email: false, push: false }).expect(400);
    expect(Object.keys(res.body.problems)).toEqual(expect.arrayContaining(['ids', 'to', 'how']));
  });

  it('sends one email and one push per person for all their receipts, and skips with reasons', async () => {
    const ids = [exp.missing, exp.missing2, exp.approved, exp.voided, exp.remindedToday, oid()];
    const res = await as(ACCT).remind(body(ids, { message: 'Please upload these today' })).expect(200);
    expect(res.body.sent).toEqual({ people: 1, receipts: 2 });
    expect(res.body.skipped).toEqual([
      { id: exp.approved, merchant: 'Office Depot', reason: 'It’s already approved.' },
      { id: exp.voided, merchant: 'Lyft', reason: 'It was voided.' },
      { id: exp.remindedToday, merchant: 'Subway', reason: 'A reminder was already sent today.' },
      { id: ids[5], merchant: '', reason: 'Not found.' }
    ]);
    expect(res.body.noEmail).toEqual([]);
    expect(res.body.noPhone).toEqual([]);
    await flush();
    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toBe('maria@x.test');
    expect(emails[0]!.subject).toBe('Reminder: 2 card receipts');
    expect(emails[0]!.html).toContain('Ann Count sent you a reminder');
    expect(emails[0]!.html).toContain('Please upload these today');
    expect(pushes).toEqual([{ ids: [P.rep], title: 'Receipt reminder', body: '2 charges need a receipt (from Ann Count)' }]);
  });

  it('writes the history line and the once-a-day stamp without moving updatedAt', async () => {
    await as(ACCT).remind(body([exp.waiting], { to: { holder: true, managers: true }, push: false, message: 'Thanks' })).expect(200);
    const saved = (await CardExpense.findById(exp.waiting).lean()) as Loose;
    expect(new Date(saved.updatedAt).getTime()).toBe(OLD.getTime());
    expect(saved.reminders).toEqual({ lastDay: '2026-11-23', lastAt: NOW.toISOString(), lastBy: P.acct, lastByName: 'Ann Count' });
    expect(saved.history).toHaveLength(2);
    expect(saved.history[1]).toMatchObject({ by: 'Ann Count', action: 'sent a reminder', changes: 'to Maria Lopez, Dana Whitfield · email · “Thanks”' });
    // A second try the same day is skipped and sends nothing.
    emails.length = 0;
    const again = await as(ACCT).remind(body([exp.waiting])).expect(200);
    expect(again.body.sent).toEqual({ people: 0, receipts: 0 });
    expect(again.body.skipped[0].reason).toBe('A reminder was already sent today.');
    await flush();
    expect(emails).toHaveLength(0);
  });

  it('reminds whoever still has to approve a waiting receipt, never the sender', async () => {
    const res = await as(ACCT).remind(body([exp.waiting], { to: { approvers: true } })).expect(200);
    expect(res.body.sent).toEqual({ people: 1, receipts: 1 }); // Accounting (the sender) and the Admin → only the Admin
    expect(res.body.noPhone).toEqual(['Ada Min']);
    await flush();
    expect(emails.map((e) => e.to)).toEqual(['ada@x.test']);
  });

  it('a manager reminds about their team only; who has no email or phone is named', async () => {
    const res = await as(MGR).remind(body([exp.missing, exp.kent], { to: { holder: true, accounting: true } })).expect(200);
    expect(res.body.skipped).toEqual([{ id: exp.kent, merchant: 'Arco', reason: 'Not on your team.' }]);
    expect(res.body.sent).toEqual({ people: 2, receipts: 1 });
    expect(res.body.noPhone).toEqual(['Ann Count']);
    // Ray has neither an email address nor a phone: nothing can reach him, so it isn't "sent" and isn't stamped.
    const acctRes = await as(ACCT).remind(body([exp.kent])).expect(200);
    expect(acctRes.body.sent).toEqual({ people: 0, receipts: 0 });
    expect(acctRes.body.skipped[0].reason).toMatch(/Ray Ortiz has no email address or phone with the app/);
    expect(acctRes.body.noContact).toEqual(['Ray Ortiz']);
    expect(((await CardExpense.findById(exp.kent).lean()) as Loose).reminders ?? {}).toEqual({});
  });

  it('a receipt with nobody to remind is skipped, not stamped', async () => {
    const res = await as(ACCT).remind(body([exp.missing], { to: { managers: true }, email: true, push: false, ids: [exp.kent] })).expect(200);
    expect(res.body.skipped).toEqual([{ id: exp.kent, merchant: 'Arco', reason: 'Nobody to remind.' }]);
    expect(((await CardExpense.findById(exp.kent).lean()) as Loose).reminders ?? {}).toEqual({});
  });
  it('says so when the sender is the only person in the groups picked', async () => {
    const res = await as(ACCT).remind(body([exp.missing], { to: { accounting: true } })).expect(200);
    expect(res.body.sent).toEqual({ people: 0, receipts: 0 });
    expect(res.body.skipped[0].reason).toMatch(/only person in the groups you picked/);
    expect(((await CardExpense.findById(exp.missing).lean()) as Loose).reminders ?? {}).toEqual({});
  });
});

describe('what the answer says happened', () => {
  it('a send that gets through nowhere is not "reminded": the day is freed and a line says so', async () => {
    failEmail = true;
    const res = await as(ACCT).remind(body([exp.missing], { push: false, to: { managers: true } })).expect(200);
    expect(res.body.sent).toEqual({ people: 0, receipts: 0 });
    expect(res.body.skipped[0].reason).toMatch(/could not be sent/);
    const saved = (await CardExpense.findById(exp.missing).lean()) as Loose;
    expect(saved.reminders.lastDay).toBe('');
    expect(saved.history.at(-1)).toMatchObject({ action: 'reminder not delivered' });
    failEmail = false;
    const again = await as(ACCT).remind(body([exp.missing], { push: false, to: { managers: true } })).expect(200);
    expect(again.body.sent).toEqual({ people: 1, receipts: 1 });
  });
});

describe('POST /expenses/remind/preview', () => {
  const preview = (user: Loose, ids: string[]) => request(app).post('/api/card-receipts/expenses/remind/preview').set('x-test-user', JSON.stringify(user)).send({ ids });

  it('needs the switch and a receipt', async () => {
    await preview(NOSWITCH, [exp.missing]).expect(403);
    await preview(ACCT, []).expect(400);
  });

  it('leaves out receipts the send would skip, and says why', async () => {
    const res = await preview(ACCT, [exp.missing, exp.approved, exp.remindedToday]).expect(200);
    expect(res.body.skipped.map((x: Loose) => x.reason)).toEqual(['It’s already approved.', 'A reminder was already sent today.']);
    expect(res.body.groups.holder.names).toEqual(['Maria Lopez']);
    const mgrRes = await preview(MGR, [exp.kent]).expect(200);
    expect(mgrRes.body.skipped[0].reason).toBe('Not on your team.');
    expect(mgrRes.body.groups.holder.names).toEqual([]);
  });

  it('names who each group means and marks the sender, who is never named', async () => {
    const res = await preview(ACCT, [exp.missing]).expect(200);
    expect(res.body.groups.holder).toEqual({ names: ['Maria Lopez'], ids: [P.rep], self: false });
    expect(res.body.groups.managers.names).toEqual(['Dana Whitfield']);
    expect(res.body.groups.accounting).toEqual({ names: [], ids: [], self: true });
    expect(res.body.groups.admins.names).toEqual(['Ada Min']);
    expect(res.body.contact[P.admin]).toEqual({ email: true, phone: false });
    expect(res.body.contact[P.rep]).toEqual({ email: true, phone: true });
  });
});
