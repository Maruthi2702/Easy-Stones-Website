/**
 * Users, roles, locations and the type lists reach Postgres as they change in MongoDB, and what
 * Postgres holds afterwards is exactly what a fresh whole-database copy would make (verifyCopy).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { readMongo } from '../copy/readMongo.ts';
import { verifyCopy } from '../copy/plan.ts';
import { syncReference } from './syncReference.ts';
import { readReference, startReferenceSync, type ReferenceSyncHandle } from './referenceSync.ts';
import * as S from '../schema/index.ts';
import { newId } from '../ids.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const oid = (id?: string) => new ObjectId(id);
const seattle = oid(), kent = oid(), roleRep = oid(), roleMgr = oid(), rae = oid(), sam = oid(), zed = oid();
const ann = newId();
let t: WriteParity;
const mongo = () => mongoose.connection.db!;
const sync = async () => syncReference(t.pg.db, await readReference(mongo()));
const same = async () => expect(await verifyCopy(t.pg.db, await readMongo(t.uri, 'ref-sync-test'))).toEqual([]);

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: kent, name: 'Kent' }]);
    await db.collection('roles').insertMany([{ _id: roleRep, name: 'sales_rep', permissions: [] }, { _id: roleMgr, name: 'manager', permissions: ['x'] }]);
    await db.collection('users').insertMany([
      { _id: rae, username: 'rae', displayName: 'Rae', password: 'x', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle'], isActive: true },
      { _id: sam, username: 'sam', password: 'x', role: 'sales_rep', location: 'Kent', isActive: true },
      { _id: zed, username: 'zed', password: 'x', role: 'sales_rep', location: 'Kent', isActive: true }
    ]);
    await db.collection('visittypes').insertOne({ _id: oid(), name: 'Showroom Visit', label: 'Showroom', order: 0, active: true, system: true, fields: { notes: true, outcome: false, followUp: 'none' } });
    await db.collection('customers').insertOne({ _id: oid(ann), contactName: 'Ann', email: 'ann@x.example', location: 'Seattle', salesRep: sam });
  });
  expect(await t.differences()).toEqual([]);
});
afterAll(async () => { await t?.close(); });

describe('reference sync', () => {
  it('does nothing when nothing changed', async () => {
    await sync(); await same();
  });

  it('follows renames, new and changed people, new types, and removals', async () => {
    const db = mongo();
    await db.collection('locations').updateOne({ _id: kent }, { $set: { name: 'Kent WA' } });
    await db.collection('users').updateOne({ _id: sam }, { $set: { location: 'Seattle', assignedLocations: ['Seattle', 'Kent WA'] } });
    await db.collection('users').insertOne({ _id: oid(), username: 'newbie', password: 'x', role: 'manager', location: 'Seattle', isActive: true });
    await db.collection('users').updateOne({ _id: rae }, { $set: { role: 'manager', displayName: 'Rae R' } });
    await db.collection('roles').updateOne({ _id: roleMgr }, { $set: { permissions: ['x', 'y'] } });
    await db.collection('visittypes').insertOne({ _id: oid(), name: 'Phone Call', label: 'Call', order: 1, active: true, system: false, fields: { notes: true, outcome: true, followUp: 'optional' } });
    const report = await sync();
    expect(report.kept).toEqual([]);
    await same();
  });

  it('a removed person nothing needs goes; one a customer points at goes and the customer keeps no rep', async () => {
    const db = mongo();
    await db.collection('users').deleteOne({ _id: zed });
    await db.collection('users').deleteOne({ _id: sam });
    const report = await sync();
    expect(report.deleted.users).toBe(2);
    const [customer] = await t.pg.db.select().from(S.customers);
    expect(customer.salesRepId).toBeNull();
    await same();
  });

  it('a person removed and added again under the same username does not collide with the old row', async () => {
    const db = mongo();
    await db.collection('users').deleteOne({ _id: rae });
    await db.collection('users').insertOne({ _id: oid(), username: 'rae', displayName: 'Rae again', password: 'x', role: 'manager', location: 'Seattle', isActive: true });
    await sync(); await same();
  });

  it('keeps a row a calendar entry still needs, says so, and syncs the rest', async () => {
    const db = mongo();
    const bob = oid();
    await db.collection('users').insertOne({ _id: bob, username: 'bob', password: 'x', role: 'manager', location: 'Seattle', isActive: true });
    await sync();
    await db.collection('schedules').insertOne({ _id: oid(), userId: bob, customerId: oid(ann), startTime: '2026-10-05T09:30:00.000', activityType: 'Visit', status: 'Scheduled', source: 'manual' });
    await t.resync();
    await db.collection('users').deleteOne({ _id: bob });
    await db.collection('locations').updateOne({ _id: seattle }, { $set: { fullName: 'Seattle HQ' } });
    const report = await sync();
    expect(report.kept).toEqual([`users ${bob.toHexString()}`]);
    const [loc] = await t.pg.db.select().from(S.locations);
    expect(loc.fullName).toBeDefined();
    expect((await t.pg.db.select().from(S.locations)).map(l => l.fullName)).toContain('Seattle HQ');
    // (Calendar entries aren't this sync's job: the whole-database copy brings them back in line.)
    await db.collection('schedules').deleteMany({});
    await t.resync(); await same();
  });
});

describe('the watcher', () => {
  let handle: ReferenceSyncHandle | null = null;
  afterEach(() => { handle?.stop(); handle = null; delete process.env.DB_CUSTOMERS; });

  it('is off until the customer area is on Postgres', () => {
    expect(startReferenceSync(mongo())).toBeNull();
  });

  it('syncs at start and on each change, without anyone calling it', async () => {
    process.env.DB_CUSTOMERS = 'postgres';
    handle = startReferenceSync(mongo(), { safetyMs: 3_600_000 });
    expect(handle).not.toBeNull();
    await handle!.syncNow();
    await mongo().collection('locations').insertOne({ _id: oid(), name: 'Tacoma' });
    const seen = async () => (await t.pg.db.select().from(S.locations)).some(l => l.name === 'Tacoma');
    for (let i = 0; i < 100 && !(await seen()); i++) await new Promise(r => setTimeout(r, 100));
    expect(await seen()).toBe(true);
    await same();
  });
});
