/**
 * Duplicate merge / delete / undo leave MongoDB and Postgres the same (writeParity.ts).
 *
 * One difference is known and checked apart: the backup's `group`. MongoDB's holds whole
 * MongoDB documents; Postgres's holds the same survivorId / moved plus `pg`, the rows as
 * they were (merge.postgres.ts). So `customer_merge_backups.group` is set aside in
 * `same()` and its readable parts are compared in 'the backup' below.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
import Customer from '../../../models/Customer.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { customerMergeBackups } from '../../schema/customers.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), repRole = oid(), rep = oid(), goneRep = oid();
const ids = Object.fromEntries(['k1', 'l1', 'l2', 't', 'x', 'k2', 'd1', 'm2', 'k3', 'l3', 'k4', 'm4'].map(k => [k, oid()])) as Record<string, mongoose.Types.ObjectId>;
const id = (k: string) => String(ids[k]);
const [v1, v2, v3, r1, r2, r3] = [oid(), oid(), oid(), oid(), oid(), oid()];
const [s1, s2, a1, dl1, ls1, c1, c2] = [oid(), oid(), oid(), oid(), oid(), oid(), oid()];
let t: WriteParity;

/** Same data in both databases, except the backup's group (see the header). */
const same = async () => (await t.differences()).filter(d => !d.startsWith('customer_merge_backups'));

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: repRole, name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' });
    await db.collection('resourcefamilies').insertMany([{ _id: oid(), name: 'tower', label: 'Towers', system: true }, { _id: oid(), name: 'binder', label: 'Binders', system: true }]);
    await db.collection('resourcetypes').insertMany([
      { _id: oid(), name: 'Display Tower', label: 'Tower', family: 'tower' },
      { _id: oid(), name: 'Sample Binder', label: 'Binder', family: 'binder' }
    ]);
    const base = { location: 'Seattle' };
    await Customer.insertMany([
      // Group A: keep k1, merge l1 and l2.
      {
        ...base, _id: ids.k1, company: 'Keep Co', contactName: 'Kay', email: 'kay@keep.example', phone: '', salesRep: rep, salesRepName: 'Jo',
        contacts: [{ _id: c1, name: 'Kay', email: 'shared@keep.example' }], associatedCustomers: [ids.x, ids.l1], notDuplicateOf: [ids.t],
        modaDisplay: 'No', modaBinder: '2',
        visits: [{ _id: v1, date: '2026-10-01', purpose: 'Sales Call', createdAt: '2026-10-01T09:00:00.000' }],
        resources: [{ _id: r1, title: 'Binder', resourceType: 'Sample Binder', qty: 2, status: 'Active', date: '2026-10-01', createdAt: '2026-10-01T09:05:00.000' }]
      },
      {
        ...base, _id: ids.l1, company: 'Keep Company LLC', contactName: 'Lee', email: 'lee@keep.example', phone: '555-0101', salesRep: goneRep, salesRepName: 'Gone',
        address: { street: '9 Elm', city: 'Kent', state: 'WA', zipCode: '98030' },
        contacts: [{ name: 'Lee', email: 'shared@keep.example' }], associatedCustomers: [ids.k1, ids.x], notDuplicateOf: [ids.k1],
        visits: [{ _id: v2, date: '2026-10-05', purpose: 'Sales Call', createdAt: '2026-10-05T09:00:00.000', createdBy: String(rep) }],
        resources: [{ _id: r2, title: 'Tower', resourceType: 'Display Tower', qty: 1, status: 'Active', date: '2026-10-05', createdAt: '2026-10-05T09:05:00.000' }]
      },
      { ...base, _id: ids.l2, contactName: 'Pat', email: 'pat@other.example', phone: '555-0102', associatedCustomers: [ids.t] },
      { ...base, _id: ids.t, contactName: 'Tess', email: 'tess@third.example', associatedCustomers: [ids.l1, ids.x], notDuplicateOf: [ids.l2, ids.x] },
      { ...base, _id: ids.x, contactName: 'Xi', email: 'xi@else.example' },
      // Group B: delete d1 and merge m2 into k2 in one go, mark none separate.
      { ...base, _id: ids.k2, contactName: 'Kim', email: 'kim@keep2.example', salesRep: rep, salesRepName: 'Jo' },
      { ...base, _id: ids.d1, contactName: 'Dee', email: 'dee@keep2.example', visits: [{ _id: v3, date: '2026-09-01', createdAt: '2026-09-01T09:00:00.000' }], resources: [{ _id: r3, title: 'Sample', status: 'Active', createdAt: '2026-09-01T09:05:00.000' }] },
      { ...base, _id: ids.m2, contactName: 'Moe', email: 'moe@keep2.example', phone: '555-0103' },
      // Group C: keep k3, only separate l3.
      { ...base, _id: ids.k3, contactName: 'Kit', email: 'kit@c.example' },
      { ...base, _id: ids.l3, contactName: 'Lou', email: 'lou@c.example' },
      // Group D: a merge undone later.
      { ...base, _id: ids.k4, contactName: 'Kai', email: 'kai@d.example', associatedCustomers: [ids.m4] },
      { ...base, _id: ids.m4, contactName: 'Mia', email: 'mia@d.example', associatedCustomers: [ids.k4], visits: [{ _id: oid(), date: '2026-08-01', createdAt: '2026-08-01T09:00:00.000' }] }
    ]);
    await db.collection('schedules').insertMany([
      { _id: s1, userId: rep, customerId: ids.l1, startTime: '2026-11-12T09:00:00.000', activityType: 'Visit', status: 'Scheduled', source: 'manual', linkedVisitId: v2 },
      { _id: s2, userId: rep, customerId: ids.m4, startTime: '2026-11-13T09:00:00.000', activityType: 'Call', status: 'Scheduled', source: 'manual' }
    ]);
    await db.collection('activitylogs').insertOne({ _id: a1, entityType: 'Customer', entityId: ids.l1, customerId: ids.l1, action: 'UPDATE', performedBy: String(rep), performedByName: 'Jo', timestamp: '2026-10-05T09:00:00.000' });
    await db.collection('deliveries').insertOne({ _id: dl1, id: 'del_1', customerId: String(ids.l1), customerName: 'Keep Company', location: 'Seattle', status: 'pending' });
    await db.collection('lostsales').insertOne({ _id: ls1, customerName: 'Keep Company', customerId: String(ids.l1), productName: 'Slab', location: 'Seattle' });
  });
  expect(await same()).toEqual([]);
}, 90_000);

afterAll(async () => { await t?.close(); });

const resolve = (keep: string, actions: Record<string, 'merge' | 'delete' | 'separate'>, ghost?: string) => {
  const input = { keepId: id(keep), actions: [...Object.entries(actions).map(([k, a]) => [id(k), a] as [string, typeof a]), ...(ghost ? [[ghost, 'merge'] as [string, 'merge']] : [])], who: 'boss', backupIds: { delete: newId(), merge: newId() } };
  return t.both(() => data.resolveDuplicates(input));
};

describe('resolve', () => {
  let undoA: string[] = [];

  it('merges two records into one: contacts, links, history, Moda, rep', async () => {
    const { mongo, postgres } = await resolve('k1', { l1: 'merge', l2: 'merge' });
    expect(normalize(postgres)).toMatchObject({ merged: 2, deleted: 0, separate: 0 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    undoA = (postgres as { undoIds: string[] }).undoIds;
    expect(await same()).toEqual([]);
  });

  it('the backup keeps what Undo needs, the same in both', async () => {
    const rows = await t.pg.db.select().from(customerMergeBackups).where(eq(customerMergeBackups.id, undoA[0]));
    const mongoRow = await mongoose.connection.db!.collection('customermergebackups').findOne({ _id: new mongoose.Types.ObjectId(undoA[0]) });
    const pgGroup = rows[0].group as { survivorId: string; moved: { collection: string; from: string; ids: string[] }[] };
    expect(pgGroup.survivorId).toBe(mongoRow!.group.survivorId);
    const key = (m: { collection: string; from: string; ids: string[] }) => `${m.collection}:${m.from}:${[...m.ids].sort().join(',')}`;
    expect(pgGroup.moved.map(key).sort()).toEqual((mongoRow!.group.moved as typeof pgGroup.moved).map(key).sort());
    expect(rows[0].action).toBe(mongoRow!.action);
  });

  it('undo after the merge puts everything back', async () => {
    const { mongo, postgres } = await t.both(() => data.undoDuplicates(undoA));
    expect(postgres).toEqual({ restored: 2 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });

  it('undoing twice says it was already undone, in both', async () => {
    const { mongo, postgres } = await t.both(() => data.undoDuplicates(undoA));
    expect(postgres).toEqual({ alreadyUndone: true });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });

  it('a delete and a merge in one click, then both undone', async () => {
    const { mongo, postgres } = await resolve('k2', { d1: 'delete', m2: 'merge' });
    expect(normalize(postgres)).toMatchObject({ merged: 1, deleted: 1 });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
    const undoIds = (postgres as { undoIds: string[] }).undoIds;
    const back = await t.both(() => data.undoDuplicates(undoIds));
    expect(normalize(back.postgres)).toEqual(normalize(back.mongo));
    expect(await same()).toEqual([]);
  });

  it('keeping accounts separate marks each pair on both', async () => {
    const { mongo, postgres } = await resolve('k3', { l3: 'separate' });
    expect(postgres).toMatchObject({ separate: 1, undoIds: [] });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });

  it('a merge where the removed record linked back and had calendar entries', async () => {
    const { mongo, postgres } = await resolve('k4', { m4: 'merge' });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
    const undoIds = (postgres as { undoIds: string[] }).undoIds;
    const back = await t.both(() => data.undoDuplicates(undoIds));
    expect(normalize(back.postgres)).toEqual(normalize(back.mongo));
    expect(await same()).toEqual([]);
  });

  it('a customer that is gone: refused by both, nothing changed', async () => {
    const { mongo, postgres } = await resolve('k3', { x: 'merge' }, newId());
    expect(postgres).toEqual({ missing: true });
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await same()).toEqual([]);
  });
});
