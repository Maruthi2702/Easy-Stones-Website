import type { Loose } from '../types/records.ts';
// Payments received (src/routes/paymentsReceived.ts) against a throwaway
// in-memory MongoDB: who may do what, branch access, the Return sign, a
// repeated save, edits with their history, voids, and the submitted-day lock.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createPaymentsReceivedRouter } = await import('./paymentsReceived.ts');
const { default: PaymentReceived } = await import('../models/PaymentReceived.ts');
const { default: DailyReport } = await import('../models/DailyReport.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;

const ALL = ['view_payments', 'add_payments', 'edit_payments', 'void_payments'];
const CLERK = { username: 'dee', displayName: 'Dee', permissions: ALL, assignedLocations: ['Seattle'] };
const VIEWER = { username: 'vic', permissions: ['view_payments'], assignedLocations: ['Seattle'] };
const REPORT_ONLY = { username: 'rae', permissions: ['view_daily_report'], assignedLocations: ['Seattle'] };
const ADMIN = { username: 'ada', permissions: ALL, assignedLocations: ['*'] };
const DAY = '2026-10-30';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/payments-received', createPaymentsReceivedRouter({
    authenticate: (req: Loose, res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({}))
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await PaymentReceived.collection.deleteMany({});
  await DailyReport.collection.deleteMany({});
});

const as = (user: Loose) => ({
  get: (url: string) => request(app).get(`/api/payments-received${url}`).set('x-test-user', JSON.stringify(user)),
  post: (url: string, body: Loose) => request(app).post(`/api/payments-received${url}`).set('x-test-user', JSON.stringify(user)).send(body),
  put: (url: string, body: Loose) => request(app).put(`/api/payments-received${url}`).set('x-test-user', JSON.stringify(user)).send(body)
});
const newId = () => new mongoose.Types.ObjectId().toString();
const payment = (over: Loose = {}) => ({
  id: newId(), location: 'Seattle', date: DAY, customerId: 'c1', customerName: 'Cascade Countertops',
  method: 'check', amount: '4,850', invoice: 'INV-20418', reference: '10233', ...over
});
const submit = (date = DAY) => DailyReport.collection.insertOne({ date, location: 'Seattle', status: 'submitted', submittedBy: 'Maya' });

describe('adding', () => {
  it('saves a payment in cents with who entered it, and lists it for the day', async () => {
    const res = await as(CLERK).post('', payment()).expect(201);
    expect(res.body.payment).toMatchObject({ cents: 485000, method: 'check', enteredBy: 'Dee', voided: null });
    const list = await as(VIEWER).get(`?location=Seattle&date=${DAY}`).expect(200);
    expect(list.body.payments).toHaveLength(1);
    expect(list.body.day.submitted).toBe(false);
    expect(list.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('saves a Return negative whichever sign was typed', async () => {
    const a = await as(CLERK).post('', payment({ method: 'return', amount: '1000' })).expect(201);
    const b = await as(CLERK).post('', payment({ method: 'return', amount: '-2000' })).expect(201);
    expect([a.body.payment.cents, b.body.payment.cents]).toEqual([-100000, -200000]);
  });

  it('answers a repeated save with the payment it has, not a second one', async () => {
    const body = payment();
    await as(CLERK).post('', body).expect(201);
    const again = await as(CLERK).post('', body).expect(200);
    expect(again.body.alreadySaved).toBe(true);
    expect(await PaymentReceived.countDocuments()).toBe(1);
  });

  it('names each problem and saves nothing', async () => {
    const res = await as(CLERK).post('', { id: newId(), location: 'Seattle' }).expect(400);
    expect(Object.keys(res.body.problems).sort()).toEqual(['amount', 'customer', 'date', 'method']);
    const minus = await as(CLERK).post('', payment({ method: 'cash', amount: '-5' })).expect(400);
    expect(minus.body.problems.amount).toBe('Use Return for money going back');
    expect(await PaymentReceived.countDocuments()).toBe(0);
  });

  it('keeps only a card\'s last 4 digits', async () => {
    const res = await as(CLERK).post('', payment({ method: 'card', reference: '4111 1111 1111 4421' })).expect(201);
    expect(res.body.payment.reference).toBe('4421');
  });
});

describe('who may', () => {
  it('needs the switch for each action', async () => {
    await as(VIEWER).post('', payment()).expect(403);
    await as(REPORT_ONLY).get(`?location=Seattle&date=${DAY}`).expect(403);
  });

  it('keeps to the branches assigned, \'*\' meaning every real one', async () => {
    await as(CLERK).post('', payment({ location: 'Dallas' })).expect(403);
    await as(CLERK).get(`?location=Dallas&date=${DAY}`).expect(403);
    await as(ADMIN).post('', payment({ location: 'Dallas' })).expect(201);
    await as(ADMIN).post('', payment({ location: 'Nowhere' })).expect(403);
    expect((await as(CLERK).get('/locations').expect(200)).body.locations).toEqual(['Seattle']);
  });

  it('lets the Daily Report read the day\'s totals as its grid', async () => {
    await as(CLERK).post('', payment()).expect(201);
    await as(CLERK).post('', payment({ method: 'return', amount: '1000' })).expect(201);
    const res = await as(REPORT_ONLY).get(`/summary?location=Seattle&date=${DAY}`).expect(200);
    expect(res.body).toMatchObject({ count: 2, net: 385000, taken: 485000, returned: -100000 });
    expect(res.body.grid.check).toEqual({ count: 1, amount: 4850 });
    expect(res.body.grid.return).toEqual({ count: 1, amount: -1000 });
  });
});

describe('editing and voiding', () => {
  it('records what an edit changed', async () => {
    const { body } = await as(CLERK).post('', payment()).expect(201);
    const res = await as(CLERK).put(`/${body.payment.id}`, payment({ amount: '4,900', method: 'ach' })).expect(200);
    expect(res.body.payment.cents).toBe(490000);
    expect(res.body.payment.history.map((h: Loose) => h.action)).toEqual(['added', 'edited']);
    expect(res.body.payment.history[1].changes).toBe('method Check → ACH, amount $4,850.00 → $4,900.00');
  });

  it('voids with a reason, keeps the record, and leaves it out of the totals', async () => {
    const { body } = await as(CLERK).post('', payment()).expect(201);
    await as(CLERK).post(`/${body.payment.id}/void`, {}).expect(400);
    const res = await as(CLERK).post(`/${body.payment.id}/void`, { reason: 'Typed the wrong amount' }).expect(200);
    expect(res.body.payment.voided).toMatchObject({ by: 'Dee', reason: 'Typed the wrong amount' });
    await as(CLERK).put(`/${body.payment.id}`, payment()).expect(409);
    const sum = await as(VIEWER).get(`/summary?location=Seattle&date=${DAY}`).expect(200);
    expect(sum.body.count).toBe(0);
    expect(await PaymentReceived.countDocuments()).toBe(1);
  });
});

describe('a submitted day is locked', () => {
  it('refuses adding, editing and voiding on it', async () => {
    const { body } = await as(CLERK).post('', payment()).expect(201);
    await submit();
    await as(CLERK).post('', payment()).expect(409);
    await as(CLERK).put(`/${body.payment.id}`, payment({ amount: '1' })).expect(409);
    await as(CLERK).post(`/${body.payment.id}/void`, { reason: 'x' }).expect(409);
    expect((await as(VIEWER).get(`?location=Seattle&date=${DAY}`)).body.day).toMatchObject({ submitted: true, submittedBy: 'Maya' });
  });

  it('refuses moving a payment into a submitted day', async () => {
    await submit('2026-10-29');
    const { body } = await as(CLERK).post('', payment()).expect(201);
    await as(CLERK).put(`/${body.payment.id}`, payment({ date: '2026-10-29' })).expect(409);
  });
});
