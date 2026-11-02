import type { Loose } from '../types/records.ts';
// The Daily Report's Payments from the Payments page (2026-11-02): from
// PAYMENTS_FROM_PAGE_SINCE the day's figures are its live entries, Return
// included; "Nothing taken today" stands when there are none; a voided entry
// doesn't linger; days before the start keep what was typed; Submit freezes.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createDailyReportsRouter } = await import('./dailyReports.ts');
const { default: DailyReport } = await import('../models/DailyReport.ts');
const { default: PaymentReceived } = await import('../models/PaymentReceived.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;
const USER = { username: 'dee', permissions: ['view_daily_report', 'edit_daily_report', 'submit_daily_report'], assignedLocations: ['Seattle'] };
const DAY = '2026-11-10';
const OLD_DAY = '2026-10-20';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/daily-reports', createDailyReportsRouter({
    authenticate: (req: Loose, res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({})),
    logActivity: async () => {}
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await DailyReport.collection.deleteMany({});
  await PaymentReceived.collection.deleteMany({});
});

const get = (date = DAY) => request(app).get(`/api/daily-reports/${date}?location=Seattle`).set('x-test-user', JSON.stringify(USER)).expect(200);
const put = (body: Loose, date = DAY) => request(app).put(`/api/daily-reports/${date}`).set('x-test-user', JSON.stringify(USER)).send({ location: 'Seattle', ...body });
const pay = async (method: string, cents: number, o: Loose = {}) => (await PaymentReceived.collection.insertOne({
  location: 'Seattle', date: DAY, customerId: 'c1', customerName: 'Cascade', method, cents, voidedAt: null, ...o
})).insertedId;

describe('from the Payments page', () => {
  it('fills every method from the day\'s live entries, Return negative, and says so', async () => {
    await pay('check', 485000);
    await pay('card', 127550);
    await pay('card', 92500);
    await pay('return', -200000);
    await pay('cash', 64000, { voidedAt: new Date(), voidReason: 'typo' });
    const res = await get();
    expect(res.body.report.payments).toEqual({
      ach: { count: 0, amount: 0 }, cash: { count: 0, amount: 0 }, card: { count: 2, amount: 2200.5 },
      check: { count: 1, amount: 4850 }, return: { count: 1, amount: -2000 }
    });
    expect(res.body.derived).toMatchObject({ paymentsFromPage: true, paymentEntries: 4 });
  });

  it('ignores payments typed into the report on such a day', async () => {
    await pay('check', 10000);
    await put({ payments: { check: { count: 9, amount: 999 } } }).expect(200);
    expect((await get()).body.report.payments.check).toEqual({ count: 1, amount: 100 });
  });

  it('keeps "Nothing taken today" while there are no entries, and replaces it when one is added', async () => {
    const zero = { count: 0, amount: 0 };
    await put({ payments: { ach: zero, cash: zero, card: zero, check: zero, return: zero } }).expect(200);
    expect((await get()).body.report.payments.cash).toEqual(zero);
    await pay('cash', 5000);
    expect((await get()).body.report.payments.cash).toEqual({ count: 1, amount: 50 });
  });

  it('goes back to not recorded when the only entry is voided', async () => {
    const id = await pay('check', 10000);
    await put({ payments: (await get()).body.report.payments }).expect(200);
    await PaymentReceived.collection.updateOne({ _id: id }, { $set: { voidedAt: new Date() } });
    expect((await get()).body.report.payments.check).toEqual({ count: null, amount: null });
  });

  it('freezes what the page said at Submit', async () => {
    await pay('check', 10000);
    await put({}).expect(200); // the day is saved before it can be submitted
    await request(app).post(`/api/daily-reports/${DAY}/submit`).set('x-test-user', JSON.stringify(USER)).send({ location: 'Seattle' }).expect(200);
    await pay('cash', 5000); // can't happen through the page (the day is locked), but the report mustn't move
    const stored = await DailyReport.findOne({ date: DAY, location: 'Seattle' }).lean();
    expect(stored?.payments?.check).toMatchObject({ count: 1, amount: 100 });
    expect((await get()).body.report.payments.cash).toMatchObject({ count: 0, amount: 0 });
  });
});

describe('before the switch-over day', () => {
  it('keeps what was typed and ignores the page', async () => {
    await PaymentReceived.collection.insertOne({ location: 'Seattle', date: OLD_DAY, customerId: 'c1', customerName: 'A', method: 'check', cents: 10000, voidedAt: null });
    await put({ payments: { check: { count: 3, amount: 1500 } } }, OLD_DAY).expect(200);
    const res = await get(OLD_DAY);
    expect(res.body.report.payments.check).toEqual({ count: 3, amount: 1500 });
    expect(res.body.derived.paymentsFromPage).toBe(false);
  });
});
