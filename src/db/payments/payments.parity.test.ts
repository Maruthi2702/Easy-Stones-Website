/**
 * Payments received, through the real router: each request run on MongoDB, then on
 * Postgres, must answer the same and leave the same payments behind (Postgres' rows are
 * compared with what the copy makes of MongoDB's — paymentRowsOf is the spec). The
 * Daily Report's lock stays on MongoDB's DailyReport in both runs: that area moves later.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import PaymentReceived from '../../models/PaymentReceived.ts';
import Customer from '../../models/Customer.ts';
import DailyReport from '../../models/DailyReport.ts';
import { paymentsReceived, paymentHistory } from '../schema/operations.ts';
import { paymentRowsOf } from '../copy/operationsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { paymentFigures } from './index.ts';
import createPaymentsReceivedRouter from '../../routes/paymentsReceived.ts';
import type { Loose } from '../../types/records.ts';

const oid = () => String(new mongoose.Types.ObjectId());
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ALL = ['view_payments', 'add_payments', 'edit_payments', 'void_payments'];
const SEATTLE = { username: 'dee', displayName: 'Dee', permissions: ALL, assignedLocations: ['Seattle'] };
const ADMIN = { username: 'root', displayName: 'Root', permissions: ALL, assignedLocations: ['*'] };
const VIEWER = { username: 'vi', permissions: ['view_payments'], assignedLocations: ['Seattle'] };
const SPOKANE = { username: 'ken', permissions: ALL, assignedLocations: ['Spokane'] };

let t: WriteParity;
let app: express.Express;
const acme = oid(), zeta = oid();
const DAY = '2026-11-09';

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await Customer.insertMany([
      { _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test' },
      { _id: zeta, company: 'Zeta Tile', contactName: 'Zed', email: 'zed@zeta.test' }
    ]);
    // A submitted day: Spokane 2026-11-08.
    await DailyReport.collection.insertOne({ _id: new mongoose.Types.ObjectId(), location: 'Spokane', date: '2026-11-08', status: 'submitted', submittedBy: 'Sam', submittedAt: new Date('2026-11-08T23:00:00Z') });
    await PaymentReceived.insertMany([
      { _id: oid(), location: 'Seattle', date: DAY, customerId: acme, customerName: 'Acme Stone', method: 'check', cents: 120000, invoice: 'INV-1',
        enteredBy: 'Dee', updatedBy: 'Dee', createdAt: new Date('2026-11-09T18:00:00Z'), history: [{ at: new Date('2026-11-09T18:00:00Z'), by: 'Dee', action: 'added' }] },
      { _id: oid(), location: 'Seattle', date: DAY, customerId: zeta, customerName: 'Zeta Tile', method: 'card', cents: 5000, reference: '4242',
        enteredBy: 'Dee', updatedBy: 'Dee', createdAt: new Date('2026-11-09T19:00:00Z'), voidedAt: new Date('2026-11-09T20:00:00Z'), voidedBy: 'Dee', voidReason: 'duplicate',
        history: [{ at: new Date('2026-11-09T19:00:00Z'), by: 'Dee', action: 'added' }, { at: new Date('2026-11-09T20:00:00Z'), by: 'Dee', action: 'voided', changes: 'duplicate' }] },
      { _id: oid(), location: 'Spokane', date: '2026-11-08', customerId: acme, customerName: 'Acme Stone', method: 'cash', cents: 700,
        enteredBy: 'Sam', updatedBy: 'Sam', createdAt: new Date('2026-11-08T18:00:00Z'), history: [{ at: new Date('2026-11-08T18:00:00Z'), by: 'Sam', action: 'added' }] }
    ]);
  }, 'DB_PAYMENTS');

  app = express();
  app.use(express.json());
  app.use('/api/payments-received', createPaymentsReceivedRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Ids a request makes for itself: the same ones on both runs of one request, new for the next request. */
const made: string[] = [];
let used = 0;
const nextId = () => (made[used] ??= oid(), made[used++]);

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  made.length = 0;
  const ask = async () => {
    used = 0; const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  await expectSamePayments();
  return mongo;
}

/** Postgres' payments and history = what the copy makes of MongoDB's now. */
async function expectSamePayments() {
  const ref = await referenceIndexOf(t.pg.db);
  const built = (await PaymentReceived.find().lean()).map(d => paymentRowsOf(d as Loose, ref, { customerIds: new Set([acme, zeta]) }, []))
    .filter(Boolean).sort((a, b) => a!.payment.id.localeCompare(b!.payment.id));
  const payments = await t.pg.db.select().from(paymentsReceived).orderBy(asc(paymentsReceived.id));
  expect(payments).toEqual(built.map(b => b!.payment));
  const history = await t.pg.db.select().from(paymentHistory).orderBy(asc(paymentHistory.paymentId), asc(paymentHistory.position));
  expect(history).toEqual(built.flatMap(b => b!.history));
}

const body = (over: Loose = {}) => ({ id: nextId(), location: 'Seattle', date: DAY, customerId: acme, customerName: 'Acme Stone', method: 'cash', amount: '250.00', ...over });

describe('reading', () => {
  it('a branch day, every branch, the totals, and what is refused', async () => {
    const day = await same(SEATTLE, a => a.get(`/api/payments-received?location=Seattle&date=${DAY}`));
    expect(day.body.payments).toHaveLength(2);
    expect(day.body.payments[1].voided.reason).toBe('duplicate');
    await same(ADMIN, a => a.get(`/api/payments-received?location=*&date=${DAY}`));
    await same(ADMIN, a => a.get('/api/payments-received?location=Spokane&date=2026-11-08'));
    expect((await same(SEATTLE, a => a.get(`/api/payments-received?location=Spokane&date=${DAY}`))).status).toBe(403);
    expect((await same(SEATTLE, a => a.get('/api/payments-received?location=Seattle&date=nope'))).status).toBe(400);
    const sum = await same(SEATTLE, a => a.get(`/api/payments-received/summary?location=Seattle&date=${DAY}`));
    expect(sum.body.net).toBe(120000);
    await same(SEATTLE, a => a.get('/api/payments-received/locations'));
  });

  it('the Daily Report’s figures leave voided payments out', async () => {
    const run = (live: boolean) => paymentFigures('Seattle', DAY, live);
    const { mongo: m1, postgres: p1 } = await t.both(() => run(true));
    const { mongo: m2, postgres: p2 } = await t.both(() => run(false));
    expect(p1).toEqual(m1); expect(m1).toHaveLength(1);
    expect(p2).toEqual(m2); expect(m2).toHaveLength(2);
  });
});

describe('adding', () => {
  it('each method, a Return saved negative, and a card keeping its last 4 digits', async () => {
    await same(SEATTLE, a => a.post('/api/payments-received').send(body()));
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ method: 'check', amount: '1000', invoice: 'INV-9', note: 'deposit' })));
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ method: 'card', amount: '12.34', reference: '4111 1111 1111 1111' })));
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ method: 'ach', amount: '99', customerId: zeta, customerName: 'Zeta Tile' })));
    const ret = await same(SEATTLE, a => a.post('/api/payments-received').send(body({ method: 'return', amount: '1000' })));
    expect(ret.body.payment.cents).toBe(-100000);
  });

  it('a repeated save answers alreadySaved; a bad one, a stranger’s branch and a locked day are refused', async () => {
    const once = body({ amount: '5' });
    await same(SEATTLE, a => a.post('/api/payments-received').send(once));
    const again = await same(SEATTLE, a => a.post('/api/payments-received').send(once));
    expect(again.body.alreadySaved).toBe(true);
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ amount: '-5' })));
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ date: '2099-01-01' })));
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ location: 'Spokane' })));
    await same(VIEWER, a => a.post('/api/payments-received').send(body()));
    expect((await same(SPOKANE, a => a.post('/api/payments-received').send(body({ location: 'Spokane', date: '2026-11-08' })))).status).toBe(409);
  });

  it('a company that is not a customer: MongoDB keeps the typed id, Postgres has no link (the one intended difference)', async () => {
    const send = body({ customerId: 'walk-in', customerName: 'Walk-in customer', amount: '40' });
    const ask = async () => { const r = await request(app).post('/api/payments-received').send(send).set(as(SEATTLE)); return { status: r.status, payment: r.body.payment }; };
    const { mongo, postgres } = await t.both(ask);
    expect(postgres.status).toBe(201);
    expect(mongo.payment.customerId).toBe('walk-in');
    expect(postgres.payment.customerId).toBe('');
    expect(normalize({ ...postgres.payment, customerId: undefined })).toEqual(normalize({ ...mongo.payment, customerId: undefined }));
    await expectSamePayments();
  });
});

describe('editing and voiding', () => {
  it('edits, keeping each change in its history; an unchanged save changes nothing', async () => {
    const id = oid();
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ id, amount: '300', invoice: 'A' })));
    await same(SEATTLE, a => a.put(`/api/payments-received/${id}`).send(body({ amount: '350', invoice: 'B', note: 'fixed', method: 'check', customerId: zeta, customerName: 'Zeta Tile' })));
    const unchanged = await same(SEATTLE, a => a.put(`/api/payments-received/${id}`).send(body({ amount: '350', invoice: 'B', note: 'fixed', method: 'check', customerId: zeta, customerName: 'Zeta Tile' })));
    expect(unchanged.body.unchanged).toBe(true);
    await same(SEATTLE, a => a.put(`/api/payments-received/${id}`).send(body({ date: '2026-11-08' })));
    await same(VIEWER, a => a.put(`/api/payments-received/${id}`).send(body()));
    await same(SPOKANE, a => a.put(`/api/payments-received/${id}`).send(body()));
  });

  it('voids with a reason, once; a voided payment cannot be edited; a locked day cannot be changed', async () => {
    const id = oid();
    await same(SEATTLE, a => a.post('/api/payments-received').send(body({ id, amount: '80' })));
    await same(SEATTLE, a => a.post(`/api/payments-received/${id}/void`).send({ reason: '' }));
    await same(SEATTLE, a => a.post(`/api/payments-received/${id}/void`).send({ reason: 'Keyed twice' }));
    const again = await same(SEATTLE, a => a.post(`/api/payments-received/${id}/void`).send({ reason: 'Keyed twice' }));
    expect(again.body.alreadyVoided).toBe(true);
    await same(SEATTLE, a => a.put(`/api/payments-received/${id}`).send(body({ amount: '81' })));
    const kentId = (await PaymentReceived.findOne({ location: 'Spokane' }).lean())!._id;
    await same(SPOKANE, a => a.post(`/api/payments-received/${kentId}/void`).send({ reason: 'nope' }));
    await same(SEATTLE, a => a.post(`/api/payments-received/${oid()}/void`).send({ reason: 'nope' }));
    await same(SEATTLE, a => a.put('/api/payments-received/not-an-id').send(body()));
  });
});
