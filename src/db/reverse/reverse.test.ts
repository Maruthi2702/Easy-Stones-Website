/**
 * The way back (src/db/reverse): copy MongoDB → Postgres, reverse Postgres → MongoDB, and the
 * result must copy forward into exactly the same Postgres rows. That fixed point is what
 * "nothing is lost on a rollback" means; the documents may spell a time differently
 * (README), the data may not differ.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { readMongo } from '../copy/readMongo.ts';
import { copyPlan } from '../copy/plan.ts';
import { readPostgres } from './readPostgres.ts';
import { reverseDocs } from './docs.ts';
import { writeMongo } from './writeMongo.ts';
import { newId } from '../ids.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const oid = (id?: string) => new ObjectId(id);
const seattle = oid(), roleId = oid(), rep = oid();
const ann = newId(), bob = newId(), visit1 = newId(), res1 = newId(), run = newId();
let t: WriteParity;

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle', timeZone: 'America/Los_Angeles' });
    await db.collection('roles').insertOne({ _id: roleId, name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'rae', displayName: 'Rae', password: 'x', role: 'sales_rep', location: 'Seattle', isActive: true });
    await db.collection('customers').insertMany([
      { _id: oid(ann), company: 'Ann Stone', contactName: 'Ann', email: 'ann@x.example', location: 'Seattle', salesRep: rep, password: '$2b$10$hash', loginAttempts: 2,
        loginIps: ['1.1.1.1'], associatedCustomers: [oid(bob)], modaDisplay: 'Yes', modaBinder: '3', coordinates: { lat: 47.6, lng: -122.3 },
        contacts: [{ _id: oid(), name: 'First', phone: '111', createdAt: '2026-10-01T09:00:00.000', isPrimary: true }, { name: 'No id' }],
        visits: [{ _id: oid(visit1), date: '2026-10-02', purpose: 'Showroom Visit', notes: 'hi', image: ['https://x/a.jpg', 'https://x/b.jpg'],
          createdBy: String(rep), createdByName: 'Rae', createdAt: '2026-10-02T10:00:00.000', followUp: 'call', followUpDate: '2026-10-09',
          followUpHistory: [{ action: 'snooze', at: '2026-10-03T08:00:00.000', from: '2026-10-05', to: '2026-10-09', by: String(rep), byName: 'Rae' }],
          reactions: [{ _id: oid(), type: 'like', userId: String(rep), userName: 'Rae', createdAt: '2026-10-02T11:00:00.000' }] }],
        resources: [{ _id: oid(res1), visitId: oid(visit1), date: '2026-10-02', resourceType: 'Display Tower', title: 'Tower', qty: 2, image: ['https://x/t.jpg'], createdAt: '2026-10-02T10:05:00.000' }] },
      { _id: oid(bob), contactName: 'Bob', email: 'bob@x.example', location: 'Seattle' }
    ]);
    await db.collection('schedules').insertMany([
      { _id: oid(), userId: rep, customerId: oid(ann), startTime: '2026-10-05T09:30:00.000', endTime: '2026-10-05T10:00:00.000', activityType: 'Visit', status: 'Scheduled', source: 'manual', createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') },
      { _id: oid(), userId: rep, customerId: oid(bob), startTime: new Date('2026-10-06T16:00:00.000Z'), activityType: 'Call', notes: 'n', status: 'Completed', source: 'route_planner', linkedVisitId: oid(visit1) }
    ]);
    await db.collection('activitylogs').insertMany([
      { _id: oid(), entityType: 'Visit', entityId: oid(visit1), customerId: oid(ann), action: 'create', performedBy: String(rep), performedByName: 'Rae', timestamp: '2026-10-02T10:00:00.000', details: { a: 1 } },
      { _id: oid(), entityType: 'Customer', entityId: oid(bob), customerId: oid(bob), action: 'update', performedBy: String(rep), performedByName: 'Rae', timestamp: new Date('2026-10-03T17:00:00.000Z') }
    ]);
    await db.collection('customerdeletebackups').insertOne({ _id: oid(), batchId: 'b1', customerId: oid(), customer: { _id: oid(), email: 'gone@x.example', visits: [] }, source: 'bulk', deletedBy: 'rae', spsKeepDeleted: false, spsKeepRun: '', undoneBy: '', createdAt: new Date(), updatedAt: new Date() });
    await db.collection('customermergebackups').insertOne({ _id: oid(), group: { survivorId: ann, losers: [] }, action: 'merge', createdBy: 'rae', createdAt: new Date(), updatedAt: new Date() });
    await db.collection('importmemories').insertOne({ _id: oid(), kind: 'customer', repAliases: { a: 'b' }, branchAliases: {}, decisions: {}, updatedBy: 'rae', createdAt: new Date(), updatedAt: new Date() });
    await db.collection('spsimportruns').insertOne({ _id: oid(run), fileName: 'f.xls', fingerprint: 'x', createdBy: 'rae', status: 'done', mapping: {}, repAliases: {}, branchAliases: {}, answers: {}, results: {}, planCounts: {}, rowsRead: 1, total: 1, done: 1, createdAt: new Date(), updatedAt: new Date(), __v: 3 });
    await db.collection('spsimportitems').insertOne({ _id: oid(), runId: run, seq: 1, key: 'k', rowNumber: 1, name: 'Ann', action: 'update', customerId: ann, connect: false, unset: [], changes: [], warnings: [], state: 'done', result: '', reason: '', createdId: '', __v: 1 });
  });
  expect(await t.differences()).toEqual([]);
});
afterAll(async () => { await t?.close(); });

describe('reverse copy', () => {
  it('copies forward into exactly the rows it came from', async () => {
    const src = await readMongo(t.uri, 'reverse-test');
    const docs = reverseDocs(await readPostgres(t.pg.db));
    const back = { ...src, customers: docs.customers, schedules: docs.schedules, activityLogs: docs.activitylogs,
      customerDeleteBackups: docs.customerdeletebackups, customerMergeBackups: docs.customermergebackups,
      importMemories: docs.importmemories, spsImportRuns: docs.spsimportruns, spsImportItems: docs.spsimportitems };
    const names = (plan: ReturnType<typeof copyPlan>) => plan.map(([, rows]) => JSON.parse(JSON.stringify(rows)));
    expect(names(copyPlan(back as typeof src, []))).toEqual(names(copyPlan(src, [])));
  });

  it('writes the shapes MongoDB had: ObjectIds, nested visits, the rep name', async () => {
    const docs = reverseDocs(await readPostgres(t.pg.db));
    const ann1 = docs.customers.find(c => c.email === 'ann@x.example')!;
    expect(ann1._id).toBeInstanceOf(ObjectId);
    expect(ann1.salesRep).toBeInstanceOf(ObjectId);
    expect(ann1.salesRepName).toBe('Rae');
    expect(ann1.password).toBe('$2b$10$hash');
    expect(ann1.visits[0].image).toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
    expect(ann1.visits[0].resourceId).toBeInstanceOf(ObjectId);
    expect(ann1.resources[0].visitId).toBeInstanceOf(ObjectId);
    expect(ann1.contacts).toHaveLength(2);
    expect(docs.schedules.find(s => s.activityType === 'Call')!.startTime).toBeInstanceOf(Date);
  });

  it('swaps collections in whole and keeps their indexes, or changes nothing', async () => {
    const docs = reverseDocs(await readPostgres(t.pg.db));
    const db = mongoose.connection.db!;
    await db.collection('customers').createIndex({ email: 1 }, { unique: true, name: 'email_unique' });
    const before = await db.collection('customers').countDocuments();
    const report = await writeMongo(t.uri, docs);
    expect(report.find(r => r.collection === 'customers')).toMatchObject({ before, after: 2 });
    expect((await db.collection('customers').indexes()).map(i => i.name)).toContain('email_unique');
    expect(await db.listCollections({ name: /__reverse$/ }).toArray()).toEqual([]);
    // A duplicate email stops it before anything real is touched.
    const dup = { ...docs, customers: [docs.customers[0], { ...docs.customers[1], email: docs.customers[0].email }] };
    await expect(writeMongo(t.uri, dup)).rejects.toThrow();
    expect(await db.collection('customers').countDocuments()).toBe(2);
    expect(await db.listCollections({ name: /__reverse$/ }).toArray()).toEqual([]);
  });
});
