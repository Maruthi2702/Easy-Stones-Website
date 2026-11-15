/**
 * Accounting (3rd-party freight), through the real router and the delivery sync: each request run on MongoDB,
 * then on Postgres, must answer the same and leave the same records behind (`t.differences()` is the copy's own
 * check of every table, so the copy's row builders are the spec for what Postgres writes).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import createAccountingRouter from '../../accounting/router.ts';
import { createFreightSync } from '../../accounting/sync.ts';
import { ALL_ACCOUNTING_PERMISSIONS, FREIGHT } from '../../accounting/permissions.ts';
import { Carrier } from '../../accounting/models.ts';
import Delivery from '../../models/Delivery.ts';
import User from '../../models/User.ts';
import { copyAreaFromMongo, verifyArea, COPY_AREAS } from '../copy/plan.ts';
import { readMongo } from '../copy/readMongo.ts';
import type { Loose } from '../../types/records.ts';

// Every request is checked against a full table-by-table comparison, which takes a moment.
vi.setConfig({ testTimeout: 180000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0, txn: [] as string[], txnUsed: 0, pay: [] as string[], payUsed: 0 }));
// A new record's id is made by the layer: both runs of one request must get the same one (and the same TX- / PAY- ids).
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});
vi.mock('../../accounting/ids.ts', async original => {
  const real = await original<typeof import('../../accounting/ids.ts')>();
  return {
    ...real,
    newTxnId: (now?: Date) => { ids.txn[ids.txnUsed] ??= real.newTxnId(now); return ids.txn[ids.txnUsed++]; },
    newPaymentId: (now?: Date) => { ids.pay[ids.payUsed] ??= real.newPaymentId(now); return ids.pay[ids.payUsed++]; }
  };
});

const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ADMIN = { id: 'u-admin', displayName: 'Krish', permissions: [...ALL_ACCOUNTING_PERMISSIONS], assignedLocations: ['*'] };
const SEATTLE = { id: 'u-sea', displayName: 'Maria', permissions: [...ALL_ACCOUNTING_PERMISSIONS], assignedLocations: ['Seattle'] };
const VIEWER = { id: 'u-view', displayName: 'Vi', permissions: [FREIGHT.VIEW], assignedLocations: ['*'] };
const PAY_ONLY = { id: 'u-pay', displayName: 'Pat', permissions: [FREIGHT.VIEW, FREIGHT.PAY], assignedLocations: ['*'] };
const NOBODY = { id: 'u-no', displayName: 'No', permissions: [], assignedLocations: ['Seattle'] };

let t: WriteParity;
let app: express.Express;
let sync: Loose;
let clock = Date.parse('2026-11-10T17:30:00.000Z');

const delivery = (id: string, over: Loose = {}) => ({
  id, customerName: 'Bella Pietra', soNumber: `SO${id.slice(-3)}`, status: 'completed', deliveryType: 'jobsite', truckId: 'drv_3rdparty',
  date: '2026-10-08', location: 'Seattle', carrierName: 'ABC Freight', proNumber: `BOL-${id.slice(-3)}`, freightFee: 450, ...over
});

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await User.collection.insertMany([{ username: '3rdparty', name: '3rd Party - Contract' }, { username: 'sergio', name: 'Sergio' }]);
    await Carrier.create([
      { name: 'ABC Freight Inc', nameKey: 'abc freight', aliases: ['ABC'], createdBy: { id: 'u-admin', name: 'Krish' }, updatedBy: { id: 'u-admin', name: 'Krish' } },
      { name: 'Pacific Haul', nameKey: 'pacific haul', paymentTerms: 'per_invoice', active: true }
    ]);
    await Delivery.create([
      delivery('del_a01'), delivery('del_a02', { date: '2026-10-09', freightFee: 0 }), delivery('del_a03', { location: 'Spokane', date: '2026-10-10', freightFee: 800 }),
      delivery('del_a04', { carrierName: 'Somebody New', date: '2026-10-11' }), delivery('del_a05', { deliveryType: 'will_call' }),
      delivery('del_a06', { truckId: 'drv_sergio' }), delivery('del_a07', { date: '2026-09-01' })
    ]);
  }, 'DB_ACCOUNTING');

  sync = createFreightSync({ Delivery, User, startDate: '2026-10-01', log: { error: () => {} } });
  app = express();
  app.use(express.json());
  app.use('/api/accounting', createAccountingRouter({
    authenticate: (req: Loose, res: Loose, next: () => void) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'Not signed in.' });
      req.user = JSON.parse(raw);
      return next();
    },
    sync
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Only Accounting's own tables (the seeded deliveries and Fuel Man are not what these requests change). */
const differences = async () => (await t.differences()).filter(d => /^acct_(?!fuelman)/.test(d));

const resetIds = () => { ids.made.length = 0; ids.txn.length = 0; ids.pay.length = 0; };
async function both<T>(work: () => Promise<T>) {
  resetIds();
  clock += 60000;
  const out = await t.both(async () => { ids.used = 0; ids.txnUsed = 0; ids.payUsed = 0; return work(); }, new Date(clock));
  return out;
}

/** Each call runs at its own minute, so lists never tie on the time something was made. */
async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  const { mongo, postgres } = await both(async () => { const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; });
  expect(postgres.status, JSON.stringify(postgres.body)).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  expect(await differences()).toEqual([]);
  return mongo;
}

const api = (path: string) => `/api/accounting${path}`;
const allCharges = async () => (await same(ADMIN, a => a.get(api('/freight-charges?status=all&limit=100')))).body.items as Loose[];
const bySo = async (so: string) => (await allCharges()).find(c => c.soNumber === so)!;
const item = (c: Loose) => ({ id: c._id, version: c.version });
const pay = (extra: Loose = {}) => ({ paidOn: '2026-11-10', method: 'check', reference: '1042', ...extra });

describe('the delivery sync', () => {
  it('makes a charge for each completed 3rd-party delivery, matching carriers, and is safe to run again', async () => {
    const first = await both(() => sync.syncDeliveryIds(['del_a01', 'del_a02', 'del_a03', 'del_a04', 'del_a05', 'del_a06', 'del_a07', 'del_missing']));
    expect(first.postgres).toEqual(first.mongo);
    expect(await differences()).toEqual([]);
    const again = await both(() => sync.syncDeliveryIds(['del_a01', 'del_a02']));
    expect(again.postgres).toEqual(again.mongo);
    expect(await differences()).toEqual([]);
    expect((await allCharges()).map(c => c.soNumber).sort()).toEqual(['SOa01', 'SOa02', 'SOa03', 'SOa04']);
  });

  it('follows a delivery that changed (draft) and flags one that changed after approval', async () => {
    await Delivery.updateOne({ id: 'del_a01' }, { freightFee: 500, proNumber: 'BOL-NEW' });
    const r = await both(() => sync.reconcile());
    expect(r.postgres).toEqual(r.mongo);
    expect(await differences()).toEqual([]);
    const c = await bySo('SOa03');
    await same(ADMIN, a => a.post(api('/freight-charges/approve')).send({ items: [item(c)] }));
    await Delivery.updateOne({ id: 'del_a03' }, { freightFee: 900 });
    const flagged = await both(() => sync.syncDeliveryIds(['del_a03']));
    expect(flagged.postgres).toEqual(flagged.mongo);
    expect(await differences()).toEqual([]);
    const now = await bySo('SOa03');
    expect(now.openFlags).toHaveLength(1);
    // A delivery reopened: flagged, then completed again: cleared.
    await Delivery.updateOne({ id: 'del_a03' }, { status: 'scheduled' });
    await both(() => sync.syncDeliveryIds(['del_a03']));
    expect(await differences()).toEqual([]);
    await Delivery.updateOne({ id: 'del_a03' }, { status: 'completed' });
    await both(() => sync.syncDeliveryIds(['del_a03']));
    expect(await differences()).toEqual([]);
    const c_SOa03_143 = await bySo('SOa03');
    await same(ADMIN, a => a.post(api(`/freight-charges/${now._id}/resolve-flags`)).send({ version: c_SOa03_143.version }));
    const c_SOa03_144 = await bySo('SOa03');
    await same(ADMIN, a => a.post(api('/freight-charges/unapprove')).send({ items: [item(c_SOa03_144)] }));
  });

  it('matches waiting charges when a carrier is added', async () => {
    expect((await bySo('SOa04')).carrierId).toBeFalsy();
    await same(ADMIN, a => a.post(api('/carriers')).send({ name: 'Somebody New LLC', aliases: ['somebody new'] }));
    expect((await bySo('SOa04')).carrier?.name).toBe('Somebody New LLC');
  });
});

describe('reading charges', () => {
  it('lists by tab, branch, carrier, day and search, pages, exports, and opens one with its history', async () => {
    for (const q of ['', '?status=all', '?status=draft', '?status=to_approve', '?status=flagged', '?status=missing_price', '?status=approved', '?status=paid', '?status=void',
      '?status=all&location=Seattle', '?status=all&location=Spokane', '?status=all&from=2026-10-09&to=2026-10-10', '?status=all&search=bella', '?status=all&search=BOL-01',
      '?status=all&search=100%25', '?status=all&limit=25&page=2', '?status=all&limit=100&page=1']) {
      await same(ADMIN, a => a.get(api(`/freight-charges${q}`)));
    }
    const abc = (await same(ADMIN, a => a.get(api('/carriers')))).body.find((c: Loose) => c.name === 'ABC Freight Inc');
    await same(ADMIN, a => a.get(api(`/freight-charges?status=all&carrierId=${abc._id}`)));
    await same(SEATTLE, a => a.get(api('/freight-charges?status=all')));
    await same(SEATTLE, a => a.get(api('/freight-charges?status=all&location=Spokane')));
    await same(ADMIN, a => a.get(api('/freight-charges/export?status=all')));
    const c = await bySo('SOa01');
    await same(ADMIN, a => a.get(api(`/freight-charges/${c._id}`)));
    await same(VIEWER, a => a.get(api(`/freight-charges/${c._id}`)));
    await same(ADMIN, a => a.get(api(`/freight-charges/${c._id}/history`)));
    const c_SOa03_170 = await bySo('SOa03');
    await same(SEATTLE, a => a.get(api(`/freight-charges/${c_SOa03_170._id}`)));
    await same(ADMIN, a => a.get(api(`/freight-charges/${'0'.repeat(24)}`)));
    await same(ADMIN, a => a.get(api('/freight-charges/not-an-id')));
    await same(NOBODY, a => a.get(api('/freight-charges')));
  });
});

describe('a charge, from draft to void', () => {
  it('adds one by hand and edits it (a stale screen is refused)', async () => {
    const abc = (await same(ADMIN, a => a.get(api('/carriers')))).body.find((c: Loose) => c.name === 'ABC Freight Inc');
    const manual = { location: 'Seattle', deliveryDate: '2026-11-03', carrierId: abc._id, amount: '$85.50', description: 'Detention', soNumber: 'M-1', customerName: 'Acme', notes: 'n' };
    const made = (await same(ADMIN, a => a.post(api('/freight-charges')).send(manual))).body;
    expect(made.amountCents).toBe(8550);
    // MongoDB keeps any branch text; Postgres can't link one that isn't a location, and says so (README, intended difference).
    const nowhere = await t.on('postgres', async () => (await request(app).post(api('/freight-charges')).set(as(ADMIN)).send({ ...manual, location: 'Nowhere' })));
    expect(nowhere.status).toBe(400);
    await same(SEATTLE, a => a.post(api('/freight-charges')).send({ ...manual, location: 'Spokane' }));
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ ...manual, carrierId: '0'.repeat(24) }));
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ ...manual, amount: '0' }));
    await same(PAY_ONLY, a => a.post(api('/freight-charges')).send(manual));
    const edited = (await same(ADMIN, a => a.patch(api(`/freight-charges/${made._id}`)).send({ version: made.version, amount: '90', bolNumber: 'B-9', notes: 'moved' }))).body;
    expect(edited.version).toBe(made.version + 1);
    await same(ADMIN, a => a.patch(api(`/freight-charges/${made._id}`)).send({ version: made.version, notes: 'stale' }));
    await same(ADMIN, a => a.patch(api(`/freight-charges/${made._id}`)).send({ version: edited.version }));
    // A schedule-made charge: a field fixed by hand stops following the delivery.
    const sched = await bySo('SOa01');
    await same(ADMIN, a => a.patch(api(`/freight-charges/${sched._id}`)).send({ version: sched.version, amount: '475.00', carrierId: null }));
  });

  it('approves, un-approves and pays one or several (one step when allowed, a repeat answers the same)', async () => {
    const a1 = await bySo('SOa01'), a2 = await bySo('SOa02');
    await same(ADMIN, a => a.post(api('/freight-charges/approve')).send({ items: [item(a1), item(a2)] }));
    await same(ADMIN, a => a.post(api('/freight-charges/approve')).send({ items: [item(a1)] }));
    const m = await bySo('M-1');
    await same(ADMIN, a => a.post(api('/freight-charges/pay')).send({ items: [item(a1), item(m)], ...pay() }));
    await same(PAY_ONLY, a => a.post(api('/freight-charges/pay')).send({ items: [item(m)], ...pay() }));
    const first = await same(ADMIN, a => a.post(api('/freight-charges/pay')).send({ items: [item(m)], ...pay({ requestId: 'request-001', reference: 'CK-77' }) }));
    expect(first.body.payment.paymentId).toMatch(/^PAY-/);
    const replay = await same(ADMIN, a => a.post(api('/freight-charges/pay')).send({ items: [item(m)], ...pay({ requestId: 'request-001' }) }));
    expect(replay.body.replayed).toBe(true);
    const c_SOa03_208 = await bySo('SOa03');
    await same(SEATTLE, a => a.post(api('/freight-charges/pay')).send({ items: [item(c_SOa03_208)], ...pay() }));
    const c_SOa02_209 = await bySo('SOa02');
    await same(ADMIN, a => a.post(api('/freight-charges/unapprove')).send({ items: [item(c_SOa02_209)] }));
    await same(ADMIN, a => a.post(api('/freight-charges/approve')).send({ items: [{ id: '0'.repeat(24), version: 0 }] }));
    await same(VIEWER, a => a.post(api('/freight-charges/approve')).send({ items: [item(a2)] }));
  });

  it('looks a payment up by its id, and voids a charge with a reason', async () => {
    const paid = await bySo('M-1');
    const pid = paid.payment.paymentId as string;
    await same(ADMIN, a => a.get(api(`/payments/${pid}`)));
    await same(SEATTLE, a => a.get(api(`/payments/${pid}`)));
    await same(ADMIN, a => a.get(api('/payments/PAY-20260101-ABCDEFGH')));
    await same(ADMIN, a => a.get(api('/payments/nope')));
    const draft = await bySo('SOa02');
    await same(ADMIN, a => a.post(api(`/freight-charges/${draft._id}/void`)).send({ version: draft.version, reason: '' }));
    await same(ADMIN, a => a.post(api(`/freight-charges/${paid._id}/void`)).send({ version: paid.version, reason: 'too late' }));
    await same(ADMIN, a => a.post(api(`/freight-charges/${draft._id}/void`)).send({ version: draft.version, reason: 'Duplicate' }));
    await same(ADMIN, a => a.get(api(`/freight-charges/${draft._id}/history`)));
  });
});

describe('carriers', () => {
  it('adds, edits (names must stay unique), deactivates and reactivates', async () => {
    const made = (await same(ADMIN, a => a.post(api('/carriers')).send({ name: 'Northwest Express', aliases: ['NW Express'], paymentTerms: 'per_invoice', notes: 'x' }))).body;
    await same(ADMIN, a => a.post(api('/carriers')).send({ name: 'northwest express inc' }));
    await same(ADMIN, a => a.post(api('/carriers')).send({ name: '   ' }));
    await same(VIEWER, a => a.post(api('/carriers')).send({ name: 'No Rights' }));
    const edited = (await same(ADMIN, a => a.patch(api(`/carriers/${made._id}`)).send({ version: made.version, name: 'Northwest Express Co', aliases: ['NWE'], notes: 'y' }))).body;
    await same(ADMIN, a => a.patch(api(`/carriers/${made._id}`)).send({ version: made.version, notes: 'stale' }));
    await same(ADMIN, a => a.patch(api(`/carriers/${made._id}`)).send({ version: edited.version, name: 'ABC Freight' }));
    await same(ADMIN, a => a.patch(api(`/carriers/${'0'.repeat(24)}`)).send({ version: 0, notes: 'x' }));
    const off = (await same(ADMIN, a => a.post(api(`/carriers/${made._id}/deactivate`)).send({ version: edited.version }))).body;
    await same(ADMIN, a => a.post(api(`/carriers/${made._id}/deactivate`)).send({ version: off.version }));
    await same(ADMIN, a => a.post(api(`/carriers/${made._id}/reactivate`)).send({ version: off.version }));
    await same(ADMIN, a => a.get(api('/carriers')));
    await same(VIEWER, a => a.get(api('/carriers')));
    // A deactivated carrier can't take a new charge.
    const current = (await same(ADMIN, b => b.get(api('/carriers')))).body.find((c: Loose) => c._id === made._id);
    await same(ADMIN, a => a.post(api(`/carriers/${made._id}/deactivate`)).send({ version: current.version }));
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ location: 'Seattle', deliveryDate: '2026-11-03', carrierId: made._id, amount: '5', description: 'x' }));
  });
});

describe('carrier invoices', () => {
  it('creates, edits, approves, pays, voids and lists', async () => {
    const abc = (await same(ADMIN, a => a.get(api('/carriers')))).body.find((c: Loose) => c.name === 'ABC Freight Inc');
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ location: 'Seattle', deliveryDate: '2026-11-04', carrierId: abc._id, amount: '100', description: 'Liftgate', soNumber: 'I-1' }));
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ location: 'Seattle', deliveryDate: '2026-11-05', carrierId: abc._id, amount: '50.25', description: 'Pallet', soNumber: 'I-2' }));
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ location: 'Spokane', deliveryDate: '2026-11-05', carrierId: abc._id, amount: '70', description: 'Far', soNumber: 'I-3' }));
    const [i1, i2, i3] = [await bySo('I-1'), await bySo('I-2'), await bySo('I-3')];
    await same(ADMIN, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-1', invoiceDate: '2026-11-06', total: '150.25', chargeIds: [] }));
    await same(ADMIN, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-1', invoiceDate: '2026-11-06', total: '150.25', chargeIds: [i1._id, i2._id] }));
    await same(ADMIN, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-1', invoiceDate: '2026-11-06', total: '1', chargeIds: [i3._id] }));
    await same(SEATTLE, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-2', invoiceDate: '2026-11-06', total: '70', chargeIds: [i3._id] }));
    await same(ADMIN, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-3', invoiceDate: '2026-11-06', total: '70', chargeIds: [i1._id] }));
    const list = (await same(ADMIN, a => a.get(api('/carrier-invoices')))).body;
    let inv = list.items.find((i: Loose) => i.invoiceNumber === 'INV-1');
    expect(inv.chargeIds).toHaveLength(2);
    await same(ADMIN, a => a.get(api(`/carrier-invoices/${inv._id}`)));
    await same(SEATTLE, a => a.get(api(`/carrier-invoices/${inv._id}`)));
    await same(VIEWER, a => a.get(api('/carrier-invoices?status=draft')));
    inv = (await same(ADMIN, a => a.patch(api(`/carrier-invoices/${inv._id}`)).send({ version: inv.version, total: '151.00', notes: 'fixed', invoiceDate: '2026-11-07' }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/approve`)).send({ version: inv.version }));
    await same(ADMIN, a => a.patch(api(`/carrier-invoices/${inv._id}`)).send({ version: 0, notes: 'stale' }));
    // Drop one charge, add another, then the total matches.
    inv = (await same(ADMIN, a => a.patch(api(`/carrier-invoices/${inv._id}`)).send({ version: inv.version, chargeIds: [i1._id], total: '100' }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    inv = (await same(ADMIN, a => a.patch(api(`/carrier-invoices/${inv._id}`)).send({ version: inv.version, chargeIds: [i1._id, i2._id], total: '150.25' }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    inv = (await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/approve`)).send({ version: inv.version }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    await same(ADMIN, a => a.patch(api(`/carrier-invoices/${inv._id}`)).send({ version: inv.version, notes: 'locked' }));
    inv = (await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/unapprove`)).send({ version: inv.version }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    inv = (await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/approve`)).send({ version: inv.version }))).body; expect(inv.version, JSON.stringify(inv)).toBeGreaterThanOrEqual(0);
    const c_I1_278 = await bySo('I-1');
    await same(ADMIN, a => a.post(api('/freight-charges/pay')).send({ items: [item(c_I1_278)], ...pay() }));
    const paid = await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/pay`)).send({ version: inv.version, ...pay({ method: 'ach', reference: 'ACH-5', requestId: 'invoice-pay-1' }) }));
    expect(paid.body.status, JSON.stringify(paid.body)).toBe('paid');
    const replay = await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/pay`)).send({ version: inv.version, ...pay({ method: 'ach', reference: 'ACH-5', requestId: 'invoice-pay-1' }) }));
    expect(replay.body.replayed).toBe(true);
    await same(ADMIN, a => a.post(api(`/carrier-invoices/${inv._id}/void`)).send({ version: paid.body.version, reason: 'paid already' }));
    await same(ADMIN, a => a.get(api(`/payments/${paid.body.payment.paymentId}`)));
    // A one-step invoice payment (approve + pay) and a void that puts its charges back.
    await same(ADMIN, a => a.post(api('/freight-charges')).send({ location: 'Seattle', deliveryDate: '2026-11-08', carrierId: abc._id, amount: '20', description: 'One', soNumber: 'I-4' }));
    const i4 = await bySo('I-4');
    const made = (await same(ADMIN, a => a.post(api('/carrier-invoices')).send({ carrierId: abc._id, invoiceNumber: 'INV-4', invoiceDate: '2026-11-08', total: '20', chargeIds: [i4._id] }))).body;
    await same(PAY_ONLY, a => a.post(api(`/carrier-invoices/${made._id}/pay`)).send({ version: made.version, ...pay() }));
    const voided = await same(ADMIN, a => a.post(api(`/carrier-invoices/${made._id}/void`)).send({ version: made.version, reason: 'Wrong carrier' }));
    expect(voided.body.status).toBe('void');
    await same(ADMIN, a => a.get(api('/carrier-invoices?status=all')));
    await same(ADMIN, a => a.get(api(`/carrier-invoices?status=void&carrierId=${abc._id}&limit=25`)));
    const c_I4_293 = await bySo('I-4');
    await same(ADMIN, a => a.get(api(`/freight-charges/${c_I4_293._id}`)));
  });
});

describe('the cutover copy', () => {
  it('refills only the 8 freight tables from MongoDB and verifies equal', async () => {
    const source = await readMongo(t.uri, 'accounting-area-copy');
    const before = (await t.pg.db.select().from((await import('../schema/accounting.ts')).acctPayments)).length;
    const report = await copyAreaFromMongo(t.pg.db, source, 'accounting', { write: true });
    expect(Object.keys(report.tables).sort()).toEqual([...COPY_AREAS.accounting].sort());
    expect(report.tables.acct_payments).toBe(before);
    expect(await verifyArea(t.pg.db, source, 'accounting')).toEqual([]);
  });
});

describe('every table matches a fresh copy of MongoDB', () => {
  it('after all of the above', async () => {
    expect(await differences()).toEqual([]);
  });
});
