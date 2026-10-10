// The Accounting API end to end, against a real (throwaway, in-memory) MongoDB
// replica set — transactions included — so permissions, branches, the schedule
// sync, approvals, payments, invoices and the append-only history are tested as
// they run, not as mocks of themselves.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createAccountingRouter from './router.js';
import { createFreightSync } from './sync.js';
import { Carrier, FreightCharge, CarrierInvoice, AccountingAudit, Payment } from './models.js';
import { ID_PATTERN } from './ids.js';
import { ALL_ACCOUNTING_PERMISSIONS, FREIGHT, CARRIERS } from './permissions.js';
import Delivery from '../models/Delivery.js';
import User from '../models/User.js';

let rs;
let app;
let sync;

const ALL = { id: 'u1', displayName: 'Krish', role: 'admin', permissions: [...ALL_ACCOUNTING_PERMISSIONS], assignedLocations: ['*'] };
const as = (user) => ({ 'x-test-user': JSON.stringify(user) });
const api = (method, url, user = ALL) => request(app)[method](`/api/accounting${url}`).set(as(user));

const newDelivery = (over = {}) => Delivery.create({
  id: `del_${Math.random().toString(36).slice(2)}`, customerName: 'Bella Pietra', soNumber: '150352',
  status: 'completed', deliveryType: 'jobsite', truckId: 'drv_3rdparty', date: '2026-10-08',
  location: 'Seattle', carrierName: 'ABC Freight', proNumber: 'BOL-9', freightFee: 450, ...over
});

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([Carrier.init(), FreightCharge.init(), CarrierInvoice.init(), AccountingAudit.init(), Payment.init()]);
  sync = createFreightSync({ Delivery, User, startDate: '2026-10-01', log: { error: () => {} } });
  app = express();
  app.use(express.json());
  app.use('/api/accounting', createAccountingRouter({
    authenticate: (req, res, next) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'Not signed in.' });
      req.user = JSON.parse(raw);
      return next();
    },
    sync
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});

beforeEach(async () => {
  await Promise.all([Carrier.deleteMany({}), FreightCharge.deleteMany({}), CarrierInvoice.deleteMany({}),
    AccountingAudit.collection.deleteMany({}), Payment.collection.deleteMany({}), Delivery.deleteMany({}), User.collection.deleteMany({})]);
  await User.collection.insertMany([
    { username: '3rdparty', name: '3rd Party - Contract' },
    { username: 'sergio', name: 'Sergio' }
  ]);
});

const addCarrier = async (over = {}) => (await api('post', '/carriers').send({ name: 'ABC Freight Inc', ...over })).body;
const chargeOf = (deliveryId) => FreightCharge.findOne({ deliveryId }).lean();

describe('permissions', () => {
  it('nothing opens without the switch for it', async () => {
    await request(app).get('/api/accounting/freight-charges').expect(401);
    const viewer = { ...ALL, permissions: [FREIGHT.VIEW] };
    await api('get', '/freight-charges', { ...ALL, permissions: [] }).expect(403);
    await api('get', '/freight-charges', viewer).expect(200);
    await api('post', '/carriers', viewer).send({ name: 'X' }).expect(403);
    await api('get', '/freight-charges/export', viewer).expect(403);
    await api('post', '/freight-charges/approve', viewer).send({ items: [{ id: '0'.repeat(24), version: 0 }] }).expect(403);
  });

  it('history is shown only with View history', async () => {
    await addCarrier();
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    const charge = await chargeOf(d.id);
    const withIt = await api('get', `/freight-charges/${charge._id}`).expect(200);
    expect(withIt.body.history.length).toBeGreaterThan(0);
    const without = await api('get', `/freight-charges/${charge._id}`, { ...ALL, permissions: [FREIGHT.VIEW] }).expect(200);
    expect(without.body.history).toBeUndefined();
  });
});

describe('the schedule creates charges', () => {
  it('a completed 3rd-party delivery from the start date on becomes one draft, matched to its carrier', async () => {
    const carrier = await addCarrier();
    const d = await newDelivery({ carrierName: 'abc freight' });
    const before = await newDelivery({ date: '2026-09-30' });
    const notDone = await newDelivery({ status: 'scheduled' });
    const ourTruck = await newDelivery({ truckId: 'drv_sergio' });
    const willCall = await newDelivery({ deliveryType: 'will_call' });
    await sync.syncDeliveryIds([d.id, before.id, notDone.id, ourTruck.id, willCall.id]);
    await sync.syncDeliveryIds([d.id]); // safe to repeat
    const charges = await FreightCharge.find().lean();
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ status: 'draft', amountCents: 45000, bolNumber: 'BOL-9', location: 'Seattle' });
    expect(String(charges[0].carrierId)).toBe(carrier._id);
    expect(await AccountingAudit.countDocuments({ entityId: String(charges[0]._id), action: 'created' })).toBe(1);
  });

  it('reconcile catches what a save missed, and the built-in 3rd-party row counts too', async () => {
    await newDelivery({ truckId: 'trk_3rd_party' });
    await newDelivery();
    const result = await sync.reconcile();
    expect(result.create).toBe(2);
    expect(await FreightCharge.countDocuments()).toBe(2);
    expect((await sync.reconcile()).create).toBeUndefined();
  });

  it('a 3rd-party driver account added a moment ago is recognised straight away', async () => {
    await sync.reconcile(); // warms the truck list
    await User.collection.insertOne({ username: 'contract2', name: '3rd party - delivery' });
    const d = await newDelivery({ truckId: 'drv_contract2' });
    await sync.syncDeliveryIds([d.id]);
    expect(await chargeOf(d.id)).not.toBeNull();
  });

  it('a draft follows the delivery; an approved one is frozen and flagged', async () => {
    await addCarrier();
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    await Delivery.updateOne({ id: d.id }, { freightFee: 500 });
    await sync.syncDeliveryIds([d.id]);
    let charge = await chargeOf(d.id);
    expect(charge.amountCents).toBe(50000);

    await api('post', '/freight-charges/approve').send({ items: [{ id: String(charge._id), version: charge.__v }] }).expect(200);
    await Delivery.updateOne({ id: d.id }, { freightFee: 600 });
    await sync.syncDeliveryIds([d.id]);
    charge = await chargeOf(d.id);
    expect(charge.amountCents).toBe(50000);
    expect(charge.flags.find((f) => !f.resolvedAt).code).toBe('delivery_changed');

    await api('post', `/freight-charges/${charge._id}/resolve-flags`).send({ version: charge.__v }).expect(200);
    expect((await chargeOf(d.id)).flags.every((f) => f.resolvedAt)).toBe(true);
  });

  it('a cancelled delivery flags its charge for review — never deletes it', async () => {
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    await Delivery.updateOne({ id: d.id }, { status: 'cancelled' });
    await sync.syncDeliveryIds([d.id]);
    await Delivery.deleteOne({ id: d.id });
    await sync.syncDeliveryIds([d.id]);
    const charge = await chargeOf(d.id);
    expect(charge.status).toBe('draft');
    expect(charge.flags.filter((f) => !f.resolvedAt)).toHaveLength(1);
  });

  it('an amount corrected by hand stops following the schedule', async () => {
    await addCarrier();
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    let charge = await chargeOf(d.id);
    await api('patch', `/freight-charges/${charge._id}`).send({ version: charge.__v, amount: '475.00' }).expect(200);
    await Delivery.updateOne({ id: d.id }, { freightFee: 999 });
    await sync.syncDeliveryIds([d.id]);
    charge = await chargeOf(d.id);
    expect(charge.amountCents).toBe(47500);
  });

  it('adding a carrier matches charges that were waiting for one', async () => {
    const d = await newDelivery({ carrierName: 'Western Express LLC' });
    await sync.syncDeliveryIds([d.id]);
    expect((await chargeOf(d.id)).carrierId).toBeNull();
    await addCarrier({ name: 'Western Express' });
    expect((await chargeOf(d.id)).carrierId).not.toBeNull();
  });
});

describe('branches', () => {
  it('staff see and change only their assigned branches', async () => {
    await addCarrier();
    const sea = await newDelivery({ location: 'Seattle' });
    const spo = await newDelivery({ location: 'Spokane' });
    await sync.syncDeliveryIds([sea.id, spo.id]);
    const seattleOnly = { ...ALL, assignedLocations: ['Seattle'] };
    const list = await api('get', '/freight-charges?status=all', seattleOnly).expect(200);
    expect(list.body.items.map((c) => c.location)).toEqual(['Seattle']);
    expect(list.body.summary.draft.count).toBe(1);
    const spokane = await chargeOf(spo.id);
    await api('get', `/freight-charges/${spokane._id}`, seattleOnly).expect(404);
    await api('post', '/freight-charges/approve', seattleOnly).send({ items: [{ id: String(spokane._id), version: spokane.__v }] }).expect(404);
    await api('get', '/freight-charges?location=Spokane', seattleOnly).expect(403);
  });
});

describe('approve, pay, void', () => {
  const setup = async (carrierOver = {}) => {
    const carrier = await addCarrier(carrierOver);
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    return { carrier, charge: await chargeOf(d.id) };
  };

  it('approve → pay, with the payment recorded and the charge locked after', async () => {
    const { charge } = await setup();
    const item = (c) => ({ id: String(c._id), version: c.__v });
    // Someone who can pay but not approve needs an approved charge.
    const payOnly = { ...ALL, permissions: [FREIGHT.VIEW, FREIGHT.PAY] };
    await api('post', '/freight-charges/pay', payOnly).send({ items: [item(charge)], paidOn: '2026-10-09', method: 'check', reference: '1042' }).expect(400);
    await api('post', '/freight-charges/approve').send({ items: [item(charge)] }).expect(200);
    let c = await FreightCharge.findById(charge._id).lean();
    expect(c.status).toBe('approved');
    await api('post', '/freight-charges/pay').send({ items: [item(c)], paidOn: '2026-10-09', method: 'check', reference: '1042' }).expect(200);
    c = await FreightCharge.findById(charge._id).lean();
    expect(c).toMatchObject({ status: 'paid', payment: { paidOn: '2026-10-09', method: 'check', reference: '1042' } });
    await api('post', `/freight-charges/${c._id}/void`).send({ version: c.__v, reason: 'oops' }).expect(400);
    await api('patch', `/freight-charges/${c._id}`).send({ version: c.__v, amount: '1' }).expect(400);
    const actions = (await AccountingAudit.find({ entityId: String(c._id) }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['created', 'approved', 'paid']));
  });

  it('a stale screen can’t overwrite someone else’s change', async () => {
    const { charge } = await setup();
    await api('patch', `/freight-charges/${charge._id}`).send({ version: charge.__v, bolNumber: 'B-1' }).expect(200);
    const stale = await api('patch', `/freight-charges/${charge._id}`).send({ version: charge.__v, bolNumber: 'B-2' }).expect(409);
    expect(stale.body.error).toMatch(/changed by someone else/);
    expect((await FreightCharge.findById(charge._id).lean()).bolNumber).toBe('B-1');
  });

  it('a batch is all or nothing', async () => {
    await addCarrier();
    const good = await newDelivery();
    const noPrice = await newDelivery({ freightFee: 0 });
    await sync.syncDeliveryIds([good.id, noPrice.id]);
    const a = await chargeOf(good.id);
    const b = await chargeOf(noPrice.id);
    const res = await api('post', '/freight-charges/approve').send({ items: [{ id: String(a._id), version: a.__v }, { id: String(b._id), version: b.__v }] }).expect(400);
    expect(res.body.problems).toHaveLength(1);
    expect((await FreightCharge.findById(a._id).lean()).status).toBe('draft');
  });

  it('a per-invoice carrier’s charge is approved through its invoice', async () => {
    const { charge } = await setup({ paymentTerms: 'per_invoice' });
    const res = await api('post', '/freight-charges/approve').send({ items: [{ id: String(charge._id), version: charge.__v }] }).expect(400);
    expect(res.body.error).toMatch(/per invoice/);
  });

  it('void needs a reason and keeps the record', async () => {
    const { charge } = await setup();
    await api('post', `/freight-charges/${charge._id}/void`).send({ version: charge.__v, reason: '' }).expect(400);
    await api('post', `/freight-charges/${charge._id}/void`).send({ version: charge.__v, reason: 'Duplicate' }).expect(200);
    expect(await FreightCharge.findById(charge._id).lean()).toMatchObject({ status: 'void', voidReason: 'Duplicate' });
  });

  it('a charge added by hand needs a carrier, an amount and a reason', async () => {
    const carrier = await addCarrier();
    await api('post', '/freight-charges').send({ location: 'Seattle', deliveryDate: '2026-10-09', carrierId: carrier._id, amount: '0', description: 'Detention' }).expect(400);
    const ok = await api('post', '/freight-charges').send({ location: 'Seattle', deliveryDate: '2026-10-09', carrierId: carrier._id, amount: '$85.50', description: 'Detention' }).expect(201);
    expect(ok.body).toMatchObject({ source: 'manual', amountCents: 8550, status: 'draft' });
    await api('post', '/freight-charges', { ...ALL, assignedLocations: ['Kent'] }).send({ location: 'Seattle', deliveryDate: '2026-10-09', carrierId: carrier._id, amount: '1', description: 'x' }).expect(403);
  });
});

describe('carrier invoices', () => {
  it('total must match → approve → pay moves every charge; a paid invoice is final', async () => {
    const carrier = await addCarrier({ name: 'Western Express', paymentTerms: 'per_invoice' });
    const d1 = await newDelivery({ carrierName: 'Western Express', freightFee: 300 });
    const d2 = await newDelivery({ carrierName: 'Western Express', freightFee: 200 });
    await sync.syncDeliveryIds([d1.id, d2.id]);
    const ids = [String((await chargeOf(d1.id))._id), String((await chargeOf(d2.id))._id)];

    const created = await api('post', '/carrier-invoices').send({ carrierId: carrier._id, invoiceNumber: 'INV-77', invoiceDate: '2026-10-09', total: '450.00', chargeIds: ids }).expect(201);
    let inv = created.body;
    const mismatch = await api('post', `/carrier-invoices/${inv._id}/approve`).send({ version: inv.version }).expect(400);
    expect(mismatch.body.error).toMatch(/\$500.00.*\$450.00/);

    inv = (await api('patch', `/carrier-invoices/${inv._id}`).send({ version: inv.version, total: '500' }).expect(200)).body;
    inv = (await api('post', `/carrier-invoices/${inv._id}/approve`).send({ version: inv.version }).expect(200)).body;
    expect((await FreightCharge.find({ _id: { $in: ids } }).lean()).every((c) => c.status === 'approved')).toBe(true);

    // On an invoice, a charge can't be paid on its own.
    const one = await FreightCharge.findById(ids[0]).lean();
    await api('post', '/freight-charges/pay').send({ items: [{ id: ids[0], version: one.__v }], paidOn: '2026-10-10', method: 'ach' }).expect(400);

    inv = (await api('post', `/carrier-invoices/${inv._id}/pay`).send({ version: inv.version, paidOn: '2026-10-10', method: 'ach', reference: 'ACH-5' }).expect(200)).body;
    expect((await FreightCharge.find({ _id: { $in: ids } }).lean()).every((c) => c.status === 'paid' && c.payment.reference === 'ACH-5')).toBe(true);
    await api('post', `/carrier-invoices/${inv._id}/void`).send({ version: inv.version, reason: 'x' }).expect(400);
  });

  it('voiding an invoice puts its charges back, off the invoice', async () => {
    const carrier = await addCarrier({ name: 'Western Express', paymentTerms: 'per_invoice' });
    const d = await newDelivery({ carrierName: 'Western Express' });
    await sync.syncDeliveryIds([d.id]);
    const charge = await chargeOf(d.id);
    const inv = (await api('post', '/carrier-invoices').send({ carrierId: carrier._id, invoiceNumber: 'INV-1', invoiceDate: '2026-10-09', total: '450', chargeIds: [String(charge._id)] }).expect(201)).body;
    await api('post', `/carrier-invoices/${inv._id}/void`).send({ version: inv.version, reason: 'Wrong carrier' }).expect(200);
    expect(await chargeOf(d.id)).toMatchObject({ status: 'draft', invoiceId: null });
  });

  it('the same invoice number can’t be entered twice for a carrier', async () => {
    const carrier = await addCarrier({ name: 'Western Express', paymentTerms: 'per_invoice' });
    const d1 = await newDelivery({ carrierName: 'Western Express' });
    const d2 = await newDelivery({ carrierName: 'Western Express' });
    await sync.syncDeliveryIds([d1.id, d2.id]);
    const body = (c) => ({ carrierId: carrier._id, invoiceNumber: 'INV-9', invoiceDate: '2026-10-09', total: '450', chargeIds: [String(c._id)] });
    await api('post', '/carrier-invoices').send(body(await chargeOf(d1.id))).expect(201);
    await api('post', '/carrier-invoices').send(body(await chargeOf(d2.id))).expect(409);
    expect((await chargeOf(d2.id)).invoiceId).toBeNull();
  });
});

describe('carriers', () => {
  it('no duplicates by name or alias', async () => {
    await addCarrier({ aliases: ['ABC Trucking'] });
    await api('post', '/carriers').send({ name: 'abc freight' }).expect(409);
    await api('post', '/carriers').send({ name: 'Other', aliases: ['ABC Trucking LLC'] }).expect(409);
  });
  it('deactivate needs its own switch', async () => {
    const c = await addCarrier();
    await api('post', `/carriers/${c._id}/deactivate`, { ...ALL, permissions: [CARRIERS.VIEW, CARRIERS.EDIT] }).send({ version: c.version }).expect(403);
    await api('post', `/carriers/${c._id}/deactivate`).send({ version: c.version }).expect(200);
  });
});

describe('history', () => {
  it('can’t be edited or deleted', async () => {
    await AccountingAudit.create({ entityType: 'charge', entityId: 'x', action: 'created' });
    await expect(AccountingAudit.updateOne({ entityId: 'x' }, { action: 'hacked' })).rejects.toThrow(/append-only/);
    await expect(AccountingAudit.deleteMany({})).rejects.toThrow(/append-only/);
    const doc = await AccountingAudit.findOne({ entityId: 'x' });
    doc.action = 'hacked';
    await expect(doc.save()).rejects.toThrow(/append-only/);
  });
});

describe('one-step pay and transaction ids', () => {
  const item = (c) => ({ id: String(c._id), version: c.__v });
  const pay = (over = {}) => ({ paidOn: '2026-10-09', method: 'check', reference: '1042', ...over });
  const twoCharges = async () => {
    await addCarrier();
    const d1 = await newDelivery();
    const d2 = await newDelivery({ soNumber: '150516', freightFee: 380 });
    await sync.syncDeliveryIds([d1.id, d2.id]);
    return [await chargeOf(d1.id), await chargeOf(d2.id)];
  };

  it('approve + pay can pay a draft in one step: both lines in the history, one payment id on everything', async () => {
    const [a, b] = await twoCharges();
    const res = await api('post', '/freight-charges/pay').send({ items: [item(a), item(b)], ...pay() }).expect(200);
    const { paymentId } = res.body.payment;
    expect(paymentId).toMatch(ID_PATTERN);
    expect(res.body.payment).toMatchObject({ kind: 'charges', totalCents: 83000, approvedInSameStep: true, reference: '1042' });

    const charges = await FreightCharge.find({ _id: { $in: [a._id, b._id] } }).lean();
    for (const c of charges) {
      expect(c).toMatchObject({ status: 'paid', approvedBy: { name: 'Krish' }, payment: { paymentId, reference: '1042' } });
      expect(c.approvedAt).toBeTruthy();
    }
    const lines = await AccountingAudit.find({ entityId: String(a._id) }).sort({ at: 1 }).lean();
    expect(lines.map((l) => l.action)).toEqual(['created', 'approved', 'paid']);
    expect(lines.filter((l) => l.paymentId === paymentId).map((l) => l.action)).toEqual(['approved', 'paid']);

    // Every history line has its own transaction id.
    const all = await AccountingAudit.find({}).lean();
    expect(all.every((l) => ID_PATTERN.test(l.txnId) && l.txnId.startsWith('TX-'))).toBe(true);
    expect(new Set(all.map((l) => l.txnId)).size).toBe(all.length);

    // The payment can be looked up by its id, with every charge it paid.
    const look = await api('get', `/payments/${paymentId.toLowerCase()}`).expect(200);
    expect(look.body.charges.map((c) => c.soNumber).sort()).toEqual(['150352', '150516']);
    expect(look.body.carrier.name).toBe('ABC Freight Inc');
    await api('get', `/payments/${paymentId}`, { ...ALL, assignedLocations: ['Spokane'] }).expect(404);
    // …and found from the list by searching for it.
    const found = await api('get', `/freight-charges?status=paid&search=${paymentId}`).expect(200);
    expect(found.body.total).toBe(2);
  });

  it('pay without approve still needs an approved charge; one step still runs the approval checks', async () => {
    await addCarrier();
    const noPrice = await newDelivery({ freightFee: 0 });
    await sync.syncDeliveryIds([noPrice.id]);
    const c = await chargeOf(noPrice.id);
    const r1 = await api('post', '/freight-charges/pay').send({ items: [item(c)], ...pay() }).expect(400);
    expect(r1.body.error).toMatch(/amount/);
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('the same click sent twice pays once', async () => {
    const [a] = await twoCharges();
    const requestId = 'req_7f3a9c21b4';
    const first = await api('post', '/freight-charges/pay').send({ items: [item(a)], ...pay({ requestId }) }).expect(200);
    // The retry still carries the version the screen had before paying.
    const again = await api('post', '/freight-charges/pay').send({ items: [item(a)], ...pay({ requestId }) }).expect(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.payment.paymentId).toBe(first.body.payment.paymentId);
    expect(await Payment.countDocuments()).toBe(1);
    expect(await AccountingAudit.countDocuments({ entityId: String(a._id), action: 'paid' })).toBe(1);
  });

  it('one payment is one carrier', async () => {
    await addCarrier();
    await addCarrier({ name: 'Western Express' });
    const d1 = await newDelivery();
    const d2 = await newDelivery({ carrierName: 'Western Express' });
    await sync.syncDeliveryIds([d1.id, d2.id]);
    const res = await api('post', '/freight-charges/pay').send({ items: [item(await chargeOf(d1.id)), item(await chargeOf(d2.id))], ...pay() }).expect(400);
    expect(res.body.error).toMatch(/one carrier/);
  });

  it('a draft invoice can be paid in one step when its total matches', async () => {
    const carrier = await addCarrier({ name: 'Western Express', paymentTerms: 'per_invoice' });
    const d = await newDelivery({ carrierName: 'Western Express', freightFee: 300 });
    await sync.syncDeliveryIds([d.id]);
    const charge = await chargeOf(d.id);
    const inv = (await api('post', '/carrier-invoices').send({ carrierId: carrier._id, invoiceNumber: 'INV-5', invoiceDate: '2026-10-09', total: '300', chargeIds: [String(charge._id)] }).expect(201)).body;
    const payOnly = { ...ALL, permissions: [FREIGHT.VIEW, FREIGHT.PAY] };
    await api('post', `/carrier-invoices/${inv._id}/pay`, payOnly).send({ version: inv.version, ...pay({ method: 'ach' }) }).expect(400);
    const paid = (await api('post', `/carrier-invoices/${inv._id}/pay`).send({ version: inv.version, ...pay({ method: 'ach' }) }).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(paid.payment.paymentId).toMatch(ID_PATTERN);
    expect(await chargeOf(d.id)).toMatchObject({ status: 'paid', payment: { paymentId: paid.payment.paymentId } });
    expect(await Payment.findOne({ paymentId: paid.payment.paymentId }).lean()).toMatchObject({ kind: 'invoice', totalCents: 30000, approvedInSameStep: true });
  });

  it('the payment register can’t be edited or deleted', async () => {
    const [a] = await twoCharges();
    const { paymentId } = (await api('post', '/freight-charges/pay').send({ items: [item(a)], ...pay() }).expect(200)).body.payment;
    await expect(Payment.updateOne({ paymentId }, { reference: 'x' })).rejects.toThrow(/append-only/);
    await expect(Payment.deleteOne({ paymentId })).rejects.toThrow(/append-only/);
  });
});

describe('tabs', () => {
  it('To approve holds drafts and anything flagged for review; Approved, Paid and All as named', async () => {
    await addCarrier();
    const waiting = await newDelivery({ soNumber: 'A1' });
    const changed = await newDelivery({ soNumber: 'B2' });
    const paid = await newDelivery({ soNumber: 'C3' });
    await sync.syncDeliveryIds([waiting.id, changed.id, paid.id]);
    const item = async (d) => { const c = await chargeOf(d.id); return { id: String(c._id), version: c.__v }; };
    await api('post', '/freight-charges/approve').send({ items: [await item(changed)] }).expect(200);
    await api('post', '/freight-charges/pay').send({ items: [await item(paid)], paidOn: '2026-10-09', method: 'ach' }).expect(200);
    // The approved one's delivery changes afterwards → flagged for review.
    await Delivery.updateOne({ id: changed.id }, { freightFee: 520 });
    await sync.syncDeliveryIds([changed.id]);

    const so = async (status) => (await api('get', `/freight-charges${status ? `?status=${status}` : ''}`).expect(200)).body;
    const list = (body) => body.items.map((c) => c.soNumber).sort();
    const toApprove = await so('');
    expect(list(toApprove)).toEqual(['A1', 'B2']); // the default tab
    expect(toApprove.summary.toApprove).toBe(2);
    expect(list(await so('approved'))).toEqual(['B2']);
    expect(list(await so('paid'))).toEqual(['C3']);
    expect(list(await so('all'))).toEqual(['A1', 'B2', 'C3']);

    // Reviewed → it leaves To approve and stays Approved.
    const b = await chargeOf(changed.id);
    await api('post', `/freight-charges/${b._id}/resolve-flags`).send({ version: b.__v }).expect(200);
    expect(list(await so('to_approve'))).toEqual(['A1']);
  });
});

describe('a deleted delivery', () => {
  it('flags its charge, which can’t be approved or paid until it’s reviewed — and is never deleted', async () => {
    await addCarrier();
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    await Delivery.deleteOne({ id: d.id });
    await sync.syncDeliveryIds([d.id]);
    let c = await chargeOf(d.id);
    expect(c.status).toBe('draft');
    expect(c.flags.find((f) => !f.resolvedAt).detail).toBe('The delivery was deleted');

    const item = () => ({ id: String(c._id), version: c.__v });
    const pay = { paidOn: '2026-10-09', method: 'check' };
    expect((await api('post', '/freight-charges/pay').send({ items: [item()], ...pay }).expect(400)).body.error).toMatch(/deleted.*reviewed/);
    await api('post', '/freight-charges/approve').send({ items: [item()] }).expect(400);
    expect(await Payment.countDocuments()).toBe(0);

    // "Yes, we still owe it": reviewed → it can be paid.
    await api('post', `/freight-charges/${c._id}/resolve-flags`).send({ version: c.__v }).expect(200);
    c = await chargeOf(d.id);
    await api('post', '/freight-charges/pay').send({ items: [item()], ...pay }).expect(200);
  });

  it('an approved charge whose delivery is deleted can’t be paid until reviewed', async () => {
    await addCarrier();
    const d = await newDelivery();
    await sync.syncDeliveryIds([d.id]);
    let c = await chargeOf(d.id);
    await api('post', '/freight-charges/approve').send({ items: [{ id: String(c._id), version: c.__v }] }).expect(200);
    await Delivery.deleteOne({ id: d.id });
    await sync.syncDeliveryIds([d.id]);
    c = await chargeOf(d.id);
    expect(c.status).toBe('approved');
    await api('post', '/freight-charges/pay').send({ items: [{ id: String(c._id), version: c.__v }], paidOn: '2026-10-09', method: 'ach' }).expect(400);
    // Or void it — the record stays, with the reason.
    await api('post', `/freight-charges/${c._id}/void`).send({ version: c.__v, reason: 'Delivery deleted' }).expect(200);
    expect(await chargeOf(d.id)).toMatchObject({ status: 'void', voidReason: 'Delivery deleted' });
  });
});
