/**
 * Delete, bulk delete and Undo leave MongoDB and Postgres the same (writeParity.ts).
 *
 * One difference is known and checked apart: the backup's `customer`. MongoDB's holds the
 * raw document; Postgres's holds the customer as the API sends it plus `pg` (its rows, what
 * was blanked and the lists that held it — customerRemoval.postgres.ts). So
 * `customer_delete_backups` is set aside in `same()` and its readable parts are compared
 * in 'the backup'.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
import Customer from '../../../models/Customer.ts';
import CustomerDeleteBackup from '../../../models/CustomerDeleteBackup.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { customerDeleteBackups } from '../../schema/customers.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';
import type { Loose } from '../../../types/records.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), rep = oid();
const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'old'] as const;
const ids = Object.fromEntries(names.map(k => [k, oid()])) as Record<typeof names[number], mongoose.Types.ObjectId>;
const id = (k: typeof names[number]) => String(ids[k]);
const [v1, r1, c1, s1, s2, dl1, ls1, pay1, a1] = [oid(), oid(), oid(), oid(), oid(), oid(), oid(), oid(), oid()];
let t: WriteParity;
let tick = 0;
const later = () => new Date(Date.UTC(2026, 10, 10, 19, 0, ++tick));
const caught = (p: Promise<unknown>): Promise<Loose> => p.catch((e: unknown) => e) as Promise<Loose>;

/** Same data in both databases, except the delete backups (see the header). */
const same = async () => (await t.differences()).filter(d => !d.startsWith('customer_delete_backups'));

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' });
    await Customer.syncIndexes();
    const base = { location: 'Seattle' };
    await Customer.insertMany([
      {
        ...base, _id: ids.a, company: 'Alpha Stone', contactName: 'Ann', email: 'ann@alpha.example', phone: '555-0100', salesRep: rep, salesRepName: 'Jo',
        address: { street: '1 Main', city: 'Seattle', state: 'WA', zipCode: '98101' },
        contacts: [{ _id: c1, name: 'Bo', email: 'bo@alpha.example', createdAt: '2026-10-01T08:00:00.000' }],
        associatedCustomers: [ids.b], notDuplicateOf: [ids.c],
        visits: [{ _id: v1, resourceId: r1, date: '2026-10-01', purpose: 'Sales Call', createdAt: '2026-10-01T09:00:00.000', createdBy: String(rep), createdByName: 'Jo', image: ['https://files.example/v.jpg'] }],
        resources: [{ _id: r1, visitId: v1, title: 'Binder', resourceType: 'Sample Binder', qty: 1, status: 'Active', date: '2026-10-01', createdAt: '2026-10-01T09:05:00.000' }]
      },
      { ...base, _id: ids.b, company: 'Beta', contactName: 'Bea', email: 'bea@beta.example', associatedCustomers: [ids.c, ids.a, ids.d] },
      { ...base, _id: ids.c, company: 'Gamma', contactName: 'Cy', email: 'cy@gamma.example', notDuplicateOf: [ids.a, ids.b] },
      { ...base, _id: ids.d, company: 'Delta', contactName: 'Di', email: 'di@delta.example' },
      { ...base, _id: ids.e, company: 'Epsilon', contactName: 'Ed', email: 'ed@eps.example' },
      { ...base, _id: ids.f, company: 'Zeta', contactName: 'Fay', email: 'fay@zeta.example', visits: [{ _id: oid(), date: '2026-09-01', createdAt: '2026-09-01T09:00:00.000', createdBy: id('d') }] },
      { ...base, _id: ids.g, contactName: 'Gus', email: 'gus@g.example' },
      { ...base, _id: ids.h, company: 'Eta', contactName: 'Hal', email: 'hal@eta.example' }
    ]);
    await db.collection('schedules').insertMany([
      { _id: s1, userId: rep, customerId: ids.a, startTime: '2026-11-12T09:00:00.000', activityType: 'Visit', status: 'Scheduled', source: 'manual', linkedVisitId: v1 },
      { _id: s2, userId: rep, customerId: ids.d, startTime: '2026-11-13T09:00:00.000', activityType: 'Call', status: 'Scheduled', source: 'manual' }
    ]);
    await db.collection('activitylogs').insertOne({ _id: a1, entityType: 'Customer', entityId: ids.a, customerId: ids.a, action: 'UPDATE', performedBy: String(rep), performedByName: 'Jo', timestamp: '2026-10-05T09:00:00.000' });
    await db.collection('deliveries').insertOne({ _id: dl1, id: 'del_1', customerId: String(ids.a), customerName: 'Alpha Stone', location: 'Seattle', status: 'pending' });
    await db.collection('lostsales').insertOne({ _id: ls1, customerName: 'Alpha Stone', customerId: String(ids.a), productName: 'Slab', location: 'Seattle' });
    await db.collection('paymentreceiveds').insertOne({ _id: pay1, location: 'Seattle', date: '2026-11-01', method: 'cash', cents: 1000, customerId: String(ids.a), customerName: 'Alpha Stone' });
    // A delete saved by MongoDB before the move: the raw document, no Postgres rows in it.
    await CustomerDeleteBackup.collection.insertOne({
      _id: oid(), batchId: String(ids.old), customerId: ids.old, source: 'bulk', deletedBy: 'krish', spsKeepDeleted: false, spsKeepRun: '', undoneBy: '', undoneAt: null,
      customer: { _id: ids.old, company: 'Old Co', contactName: 'Olly', email: 'olly@old.example', location: 'Seattle', visits: [], resources: [], contacts: [], associatedCustomers: [], notDuplicateOf: [], createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
      createdAt: new Date('2026-02-01T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z')
    });
  });
  expect(await same()).toEqual([]);
}, 90_000);

afterAll(async () => { await t?.close(); }, 60_000);

const backupsOf = async (customerId: string) => {
  const pgRows = await t.pg.db.select().from(customerDeleteBackups).where(eq(customerDeleteBackups.customerId, customerId));
  const mongoRows = await CustomerDeleteBackup.collection.find({ customerId: new mongoose.Types.ObjectId(customerId) }).toArray();
  return { pg: pgRows, mongo: mongoRows };
};

describe('single delete', () => {
  it('a customer with visits, resources, contacts, links, a calendar entry, a ticket, a payment and a lost sale', async () => {
    const { mongo, postgres } = await t.both(() => data.backupAndDeleteCustomer(id('a'), 'krish'), later());
    expect(typeof mongo).toBe('string');
    expect(typeof postgres).toBe('string');
    expect(await same()).toEqual([]);
  });

  it('the backup: the same readable parts in both', async () => {
    const { pg, mongo } = await backupsOf(id('a'));
    expect(pg).toHaveLength(1);
    expect(mongo).toHaveLength(1);
    expect(pg[0]).toMatchObject({ batchId: expect.any(String), source: 'single', deletedBy: 'krish', spsKeepDeleted: false, undoneBy: '' });
    expect(pg[0].undoneAt).toBeNull();
    expect(mongo[0]).toMatchObject({ source: 'single', deletedBy: 'krish', undoneAt: null });
    const pgCustomer = pg[0].customer as Loose;
    for (const k of ['company', 'contactName', 'email', 'phone', 'location']) expect(pgCustomer[k]).toBe(mongo[0].customer[k]);
    expect(pgCustomer._id).toBe(String(mongo[0].customer._id));
    expect(pgCustomer.pg.visits).toHaveLength(mongo[0].customer.visits.length);
    expect(pgCustomer.pg.resources).toHaveLength(mongo[0].customer.resources.length);
    expect(pgCustomer.pg.contacts).toHaveLength(mongo[0].customer.contacts.length);
    // What Postgres blanked is written down, by row id.
    const blanked = Object.fromEntries((pgCustomer.pg.detached as { kind: string; ids: string[] }[]).map(d => [d.kind, d.ids]));
    expect(blanked).toMatchObject({ schedules: [String(s1)], deliveries: [String(dl1)], payments_received: [String(pay1)], lost_sales: [String(ls1)] });
    expect((pgCustomer.pg.incomingLinks as { customerId: string; kind: string; ids: string[] }[]).map(l => `${l.customerId}:${l.kind}`).sort())
      .toEqual([`${id('b')}:associated`, `${id('c')}:not_duplicate`].sort());
  });

  it('the same delete again: nothing there, null from both', async () => {
    const { mongo, postgres } = await t.both(() => data.backupAndDeleteCustomer(id('a'), 'krish'), later());
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
  });

  it('a customer that never existed, and ids that are not ids', async () => {
    for (const bad of [newId(), 'zzz', '']) {
      const { mongo, postgres } = await t.both(() => data.backupAndDeleteCustomer(bad, 'krish'), later());
      expect(mongo).toBeNull();
      expect(postgres).toBeNull();
    }
    expect(await same()).toEqual([]);
  });

  it('a source other than single is kept (the SPS import deletes as sps-undo)', async () => {
    await t.both(() => data.backupAndDeleteCustomer(id('e'), 'SPS import undo', 'sps-undo'), later());
    expect((await backupsOf(id('e'))).pg[0].source).toBe('sps-undo');
    expect(await same()).toEqual([]);
  });
});

describe('bulk delete', () => {
  it('several at once, one that does not exist, one with a visit by a customer', async () => {
    const run = () => data.bulkDeleteCustomers([id('d'), id('f'), id('g'), newId()], 'krish');
    const { mongo, postgres } = await t.both(run, later());
    expect(mongo).toMatchObject({ deleted: 3, missing: 1 });
    expect(postgres).toMatchObject({ deleted: 3, missing: 1 });
    expect(await same()).toEqual([]);
    const rows = await t.pg.db.select().from(customerDeleteBackups);
    expect(new Set(rows.filter(r => [id('d'), id('f'), id('g')].includes(r.customerId)).map(r => r.batchId)).size).toBe(1); // one click, one batch
  });

  it('nobody exists: null from both, nothing written', async () => {
    const { mongo, postgres } = await t.both(() => data.bulkDeleteCustomers([newId(), newId()], 'krish'), later());
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
    expect(await same()).toEqual([]);
  });
});

/** Undo each database with the batch id it was given. */
async function undoBoth(batch: { mongo: string | null; postgres: string | null }, by = 'krish') {
  const mongo = await t.on('mongo', () => data.undoBulkDelete(batch.mongo!, by));
  const postgres = await t.on('postgres', () => data.undoBulkDelete(batch.postgres!, by));
  return { mongo, postgres };
}

describe('undo', () => {
  it('brings the customer back with its visits, resources, contacts, links and everything that pointed at it', async () => {
    // a was deleted above; undo its single delete.
    const batch = {
      mongo: (await backupsOf(id('a'))).mongo[0].batchId as string,
      postgres: (await backupsOf(id('a'))).pg[0].batchId
    };
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(later());
    let result: Awaited<ReturnType<typeof undoBoth>>;
    try { result = await undoBoth(batch); } finally { vi.useRealTimers(); }
    expect(result.mongo).toEqual({ restored: 1, failed: [] });
    expect(normalize(result.postgres)).toEqual(normalize(result.mongo));
    expect(await same()).toEqual([]); // the calendar entry, ticket, payment, lost sale and both lists point at it again
  });

  it('undoing the same delete again: already undone, null from both', async () => {
    const batch = {
      mongo: (await backupsOf(id('a'))).mongo[0].batchId as string,
      postgres: (await backupsOf(id('a'))).pg[0].batchId
    };
    const { mongo, postgres } = await undoBoth(batch);
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
    const after = await backupsOf(id('a'));
    expect(after.pg[0].undoneBy).toBe('krish');
    expect(after.pg[0].undoneAt).not.toBeNull();
  });

  it('a bulk delete undone: all of it back', async () => {
    const batch = {
      mongo: (await backupsOf(id('d'))).mongo[0].batchId as string,
      postgres: (await backupsOf(id('d'))).pg[0].batchId
    };
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(later());
    let result: Awaited<ReturnType<typeof undoBoth>>;
    try { result = await undoBoth(batch); } finally { vi.useRealTimers(); }
    expect(result.mongo).toEqual({ restored: 3, failed: [] });
    expect(normalize(result.postgres)).toEqual(normalize(result.mongo));
    expect(await same()).toEqual([]);
  });

  it('one whose email was taken since fails alone, the rest come back', async () => {
    const deleted = await t.both(() => data.bulkDeleteCustomers([id('h'), id('b')], 'krish'), later());
    const taker = { id: newId(), fields: { company: 'New Eta', contactName: 'Nia', email: 'hal@eta.example' }, rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: String(rep) };
    await t.both(() => data.createCustomer(taker), later());
    const result = await undoBoth({ mongo: (deleted.mongo as Loose).batchId, postgres: (deleted.postgres as Loose).batchId });
    expect(result.mongo).toEqual({ restored: 1, failed: [{ id: id('h'), company: 'Eta' }] });
    expect(normalize(result.postgres)).toEqual(normalize(result.mongo));
    expect(await same()).toEqual([]);
  });

  it('a delete saved by MongoDB before the move comes back from its raw document', async () => {
    const batch = { mongo: id('old'), postgres: id('old') };
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(later());
    let result: Awaited<ReturnType<typeof undoBoth>>;
    try { result = await undoBoth(batch, 'boss'); } finally { vi.useRealTimers(); }
    expect(result.mongo).toEqual({ restored: 1, failed: [] });
    expect(normalize(result.postgres)).toEqual(normalize(result.mongo));
    expect(await same()).toEqual([]);
  });

  it('a delete that was never saved: null from both', async () => {
    const { mongo, postgres } = await undoBoth({ mongo: newId(), postgres: newId() });
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
  });

  it('a customer deleted by the SPS import comes back too, and deleting twice keeps both copies', async () => {
    const first = { mongo: (await backupsOf(id('e'))).mongo[0].batchId as string, postgres: (await backupsOf(id('e'))).pg[0].batchId };
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(later());
    let result: Awaited<ReturnType<typeof undoBoth>>;
    try { result = await undoBoth(first, 'SPS import'); } finally { vi.useRealTimers(); }
    expect(result.mongo).toEqual({ restored: 1, failed: [] });
    expect(normalize(result.postgres)).toEqual(normalize(result.mongo));
    await t.both(() => data.backupAndDeleteCustomer(id('e'), 'krish'), later());
    expect((await backupsOf(id('e'))).pg).toHaveLength(2);
    expect((await backupsOf(id('e'))).mongo).toHaveLength(2);
    expect(await same()).toEqual([]);
  });
});
