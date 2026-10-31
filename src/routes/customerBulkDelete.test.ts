import type { Loose } from '../types/records.ts';
// Bulk delete from the Customer List, and its Undo, against a throwaway
// in-memory MongoDB: only the Delete switch (with View) may, every customer is
// saved whole before it goes, Undo brings it back under the same id (so what
// points at it by id finds it again), and a clash on Undo is reported, not
// fatal.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createCustomerBulkDeleteRouter, backupAndDeleteCustomer } = await import('./customerBulkDelete.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: CustomerDeleteBackup } = await import('../models/CustomerDeleteBackup.ts');

let mongo;
let app;
const emit = vi.fn();

const DELETER = { username: 'krish', permissions: ['view_customers', 'delete_customers'] };
const EDITOR = { username: 'ed', permissions: ['view_customers', 'manage_customers'] };
const NO_VIEW = { username: 'nv', permissions: ['delete_customers'] };
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const del = (ids: string[], user = DELETER) => request(app).post('/api/customers/bulk-delete').set(as(user)).send({ ids });
const undo = (batchId: Loose, user = DELETER) => request(app).post('/api/customers/bulk-delete/undo').set(as(user)).send({ batchId });

const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const C = new mongoose.Types.ObjectId();
const visitDate = new Date('2026-09-01T17:00:00Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Customer.syncIndexes();
  app = express();
  app.use(express.json());
  app.set('io', { emit });
  app.use('/api/customers', createCustomerBulkDeleteRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  emit.mockClear();
  await Customer.collection.deleteMany({});
  await CustomerDeleteBackup.collection.deleteMany({});
  await Customer.collection.insertMany([
    { _id: A, company: 'Acme Stone', email: 'a@acme.com', visits: [{ date: visitDate, notes: 'Looked at quartz' }], extra: { kept: true } },
    { _id: B, company: 'Bay Granite', email: 'b@bay.com' },
    { _id: C, company: 'Cobalt Counters', email: 'c@cobalt.com' }
  ]);
});

describe('POST /api/customers/bulk-delete', () => {
  it('needs the Delete switch and View', async () => {
    await del([String(A)], EDITOR).expect(403);
    await del([String(A)], NO_VIEW).expect(403);
    expect(await Customer.collection.countDocuments()).toBe(3);
  });

  it('refuses a bad list without deleting anything', async () => {
    await del([]).expect(400);
    await del(['not-an-id']).expect(400);
    await del(Array.from({ length: 501 }, () => String(new mongoose.Types.ObjectId()))).expect(400);
    expect(await Customer.collection.countDocuments()).toBe(3);
  });

  it('deletes the chosen customers in one go and saves each one whole first', async () => {
    const res = await del([String(A), String(B), String(A)]).expect(200);
    expect(res.body).toMatchObject({ deleted: 2, missing: 0 });
    expect(res.body.batchId).toMatch(/^[a-f0-9]{24}$/);
    expect((await Customer.collection.find().toArray()).map((c) => c.company)).toEqual(['Cobalt Counters']);

    const saved = await CustomerDeleteBackup.find({ batchId: res.body.batchId }).lean();
    expect(saved).toHaveLength(2);
    const acme = saved.find((b) => String(b.customerId) === String(A));
    expect(acme.deletedBy).toBe('krish');
    expect(acme.customer.visits[0].notes).toBe('Looked at quartz');
    expect(acme.customer.extra).toEqual({ kept: true });
    expect(emit).toHaveBeenCalledWith('customer_update');
  });

  it('counts customers that were already gone, and 404s when all were', async () => {
    const gone = String(new mongoose.Types.ObjectId());
    const res = await del([String(C), gone]).expect(200);
    expect(res.body).toMatchObject({ deleted: 1, missing: 1 });
    await del([gone]).expect(404);
  });
});

describe('POST /api/customers/bulk-delete/undo', () => {
  it('puts every customer back exactly, under the same id', async () => {
    const { body } = await del([String(A), String(B)]);
    const res = await undo(body.batchId).expect(200);
    expect(res.body).toEqual({ restored: 2, failed: [] });

    const acme = await Customer.collection.findOne({ _id: A });
    expect(acme.company).toBe('Acme Stone');
    expect(acme.visits[0].date).toEqual(visitDate);
    expect(acme.extra).toEqual({ kept: true });
    expect(await Customer.collection.countDocuments()).toBe(3);

    const saved = await CustomerDeleteBackup.find({ batchId: body.batchId }).lean();
    expect(saved.every((b) => b.undoneAt && b.undoneBy === 'krish')).toBe(true);
  });

  it('only undoes once', async () => {
    const { body } = await del([String(A)]);
    await undo(body.batchId).expect(200);
    await undo(body.batchId).expect(409);
    expect(await Customer.collection.countDocuments()).toBe(3);
  });

  it('reports one that can’t come back (its email was taken since) and restores the rest', async () => {
    const { body } = await del([String(A), String(B)]);
    await Customer.collection.insertOne({ company: 'New Acme', email: 'a@acme.com' });
    const res = await undo(body.batchId).expect(200);
    expect(res.body).toEqual({ restored: 1, failed: [{ id: String(A), company: 'Acme Stone' }] });
    expect(await Customer.collection.findOne({ _id: B })).toBeTruthy();
    // The one that failed stays saved and can be tried again once the clash is fixed.
    const left = await CustomerDeleteBackup.findOne({ customerId: A }).lean();
    expect(left.undoneAt).toBeNull();
  });

  it('skips a customer that is somehow still there instead of failing', async () => {
    const { body } = await del([String(A)]);
    await Customer.collection.insertOne({ _id: A, company: 'Acme Stone', email: 'a@acme.com' });
    const res = await undo(body.batchId).expect(200);
    expect(res.body).toEqual({ restored: 1, failed: [] });
  });

  it('needs the Delete switch too', async () => {
    const { body } = await del([String(A)]);
    await undo(body.batchId, EDITOR).expect(403);
    await undo('nonsense').expect(400);
  });
});

describe('backupAndDeleteCustomer (the single Delete)', () => {
  it('saves the customer whole, then removes it, naming who did it', async () => {
    const batchId = await backupAndDeleteCustomer(String(A), 'krish');
    expect(batchId).toMatch(/^[a-f0-9]{24}$/);
    expect(await Customer.collection.findOne({ _id: A })).toBeNull();
    const saved = await CustomerDeleteBackup.findOne({ customerId: A }).lean();
    expect(saved).toMatchObject({ source: 'single', deletedBy: 'krish', batchId });
    expect(saved.customer.visits[0].notes).toBe('Looked at quartz');
    // …and the same Undo brings it back.
    await undo(batchId).expect(200);
    expect(await Customer.collection.findOne({ _id: A })).toBeTruthy();
  });

  it('answers null for an unknown or malformed id and deletes nothing', async () => {
    expect(await backupAndDeleteCustomer(String(new mongoose.Types.ObjectId()), 'krish')).toBeNull();
    expect(await backupAndDeleteCustomer('nope', 'krish')).toBeNull();
    expect(await Customer.collection.countDocuments()).toBe(3);
  });
});
