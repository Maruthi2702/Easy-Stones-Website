/**
 * Calendar entry saves leave MongoDB and Postgres the same (writeParity.ts): each save
 * runs on both, answers the same, and afterwards every table equals the copy of MongoDB.
 * Apple and Google are never called: the syncs' database halves are tested alone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import Schedule from '../../../models/Schedule.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { cleanScheduleFields } from '../../../utils/scheduleRecord.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), rep = oid(), other = oid();
const acme = newId(), pat = newId(), gone = newId(), deletedLater = newId();
let t: WriteParity;

const fields = (over: Record<string, unknown> = {}) =>
  cleanScheduleFields({ customerId: acme, startTime: '2026-11-12T09:00:00.000', endTime: '2026-11-12T09:30:00.000', activityType: 'Call', notes: 'hi', ...over }).fields!;
const stop = (customerId: string, startTime: string, over: Record<string, unknown> = {}) => ({ id: newId(), fields: fields({ customerId, startTime, endTime: undefined, ...over }) });
const entryIds = async () => (await Schedule.find({}).select('_id').lean()).map(e => String(e._id)).sort();

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: seattle, name: 'Seattle' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertMany([
      { _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' },
      { _id: other, username: 'sam', displayName: 'Sam', password: 'x', role: 'sales_rep' }
    ]);
    await Customer.insertMany([
      { _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', location: 'Seattle', visits: [{ date: '2026-11-13', purpose: 'Visit', createdAt: '2026-11-13T10:00:00.000' }] },
      { _id: pat, contactName: 'Pat', email: 'pat@plain.example', location: 'Seattle' },
      { _id: deletedLater, company: 'Soon Gone', contactName: 'Gil', email: 'gil@gone.example', location: 'Seattle' }
    ]);
    await Schedule.insertMany([
      { userId: rep, customerId: acme, startTime: '2026-11-13T09:00:00.000', source: 'route_planner' },          // no end time
      { userId: rep, customerId: pat, startTime: '2026-11-13T10:00:00.000', endTime: '2026-11-13T10:30:00.000', source: 'route_planner' },
      { userId: rep, customerId: pat, startTime: '2026-11-13T11:00:00.000', endTime: '2026-11-13T11:30:00.000' },  // typed by hand
      { userId: other, customerId: pat, startTime: '2026-11-13T09:00:00.000', source: 'route_planner' },
      { userId: rep, customerId: pat, startTime: '2026-11-14T09:00:00.000', source: 'route_planner' },
      { userId: rep, customerId: pat, startTime: '2026-11-13T12:00:00.000', source: 'visit_log', status: 'Completed' }, // a logged visit: the planner never touches it
      { userId: rep, customerId: gone, startTime: '2026-11-15T09:00:00.000', notes: 'for a deleted customer' },
      { userId: rep, customerId: acme, startTime: '2026-11-13T15:00:00.000', endTime: '2026-11-13T15:30:00.000', status: 'Scheduled' }
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 60_000);

afterAll(async () => { await t?.close(); }, 60_000);

const same = async (run: () => Promise<unknown>) => {
  const { mongo, postgres } = await t.both(run);
  expect(normalize(postgres)).toEqual(normalize(mongo));
  expect(await t.differences()).toEqual([]);
  return { mongo, postgres };
};

describe('POST /api/schedule', () => {
  it('a new entry, with and without an end time', async () => {
    const [a, b] = [newId(), newId()];
    await same(() => data.createCalendarEntry(String(rep), a, fields(), false));
    await same(() => data.createCalendarEntry(String(rep), b, fields({ endTime: undefined, startTime: '2026-11-12T11:00:00.000' }), false));
  });

  it('a retried send (same id) answers with what it saved and writes nothing more', async () => {
    const id = newId();
    const first = await same(() => data.createCalendarEntry(String(rep), id, fields({ notes: 'retry' }), true));
    expect((first.mongo as { kind: string }).kind).toBe('created');
    const again = await same(() => data.createCalendarEntry(String(rep), id, fields({ notes: 'retry' }), true));
    expect((again.mongo as { kind: string }).kind).toBe('alreadySaved');
    expect((again.postgres as { kind: string }).kind).toBe('alreadySaved');
  });

  it("another person's entry id is refused", async () => {
    const id = newId();
    await same(() => data.createCalendarEntry(String(other), id, fields(), true));
    const { mongo, postgres } = await same(() => data.createCalendarEntry(String(rep), id, fields(), true));
    expect(mongo).toEqual({ kind: 'idTaken' });
    expect(postgres).toEqual({ kind: 'idTaken' });
  });

  it('a customer that no longer exists is refused, nothing written', async () => {
    const id = newId();
    const { mongo, postgres } = await same(() => data.createCalendarEntry(String(rep), id, fields({ customerId: gone }), false));
    expect(mongo).toEqual({ kind: 'noCustomer' });
    expect(postgres).toEqual({ kind: 'noCustomer' });
  });

  it('an entry for a person with no home branch is read on the default clock', async () => {
    const id = newId();
    await same(() => data.createCalendarEntry(String(other), id, fields({ startTime: '2026-11-12T13:15:00.000', endTime: undefined }), false));
  });
});

describe('POST /api/schedule/bulk', () => {
  it('replaces the planner\'s own stops on the day, keeping hand-typed ones and other people\'s', async () => {
    const stops = [stop(acme, '2026-11-13T09:00:00.000'), stop(pat, '2026-11-13T09:30:00.000', { activityType: 'Drop-off' })];
    const { mongo } = await same(() => data.planRouteDay(String(rep), { stops, replace: true, date: '2026-11-13', retry: false }));
    expect((mongo as { replaced: number }).replaced).toBe(2);
  });

  it('adds without replacing', async () => {
    const stops = [stop(pat, '2026-11-16T09:00:00.000')];
    await same(() => data.planRouteDay(String(rep), { stops, replace: false, date: '', retry: false }));
  });

  it('a one-stop repeat answers with the entry it has', async () => {
    const one = [stop(pat, '2026-11-17T09:00:00.000')];
    await same(() => data.planRouteDay(String(rep), { stops: one, replace: false, date: '', retry: true }));
    const again = await same(() => data.planRouteDay(String(rep), { stops: one, replace: false, date: '', retry: true }));
    expect((again.postgres as { kind: string }).kind).toBe('alreadySaved');
  });

  it("refuses another person's id", async () => {
    const one = [stop(pat, '2026-11-18T09:00:00.000')];
    await same(() => data.planRouteDay(String(other), { stops: one, replace: false, date: '', retry: true }));
    const { postgres } = await same(() => data.planRouteDay(String(rep), { stops: one, replace: false, date: '', retry: true }));
    expect(postgres).toEqual({ kind: 'idTaken' });
  });

  it('a bad row leaves the old plan and writes nothing', async () => {
    const before = await t.differences();
    expect(before).toEqual([]);
    const missing = [stop(acme, '2026-11-14T09:00:00.000'), stop(gone, '2026-11-14T10:00:00.000')];
    const a = await same(() => data.planRouteDay(String(rep), { stops: missing, replace: true, date: '2026-11-14', retry: false }));
    expect(a.postgres).toEqual({ kind: 'unknownCustomer' });
    const off = [stop(acme, '2026-11-20T09:00:00.000')];
    const b = await same(() => data.planRouteDay(String(rep), { stops: off, replace: true, date: '2026-11-14', retry: false }));
    expect(b.postgres).toEqual({ kind: 'offDate' });
    const c = await same(() => data.planRouteDay(String(rep), { stops: off, replace: true, date: 'soon', retry: false }));
    expect(c.postgres).toEqual({ kind: 'needDate' });
    // A row the model itself refuses: both fail, and the day it would replace is untouched.
    const bad = [{ id: newId(), fields: { ...fields({ customerId: acme, startTime: '2026-11-14T09:00:00.000', endTime: undefined }), activityType: 'Lunch' } }];
    await expect(t.on('mongo', () => data.planRouteDay(String(rep), { stops: bad, replace: true, date: '2026-11-14', retry: false }))).rejects.toThrow();
    await expect(t.on('postgres', () => data.planRouteDay(String(rep), { stops: bad, replace: true, date: '2026-11-14', retry: false }))).rejects.toThrow();
    expect(await t.differences()).toEqual([]);
  });
});

describe('PUT /api/schedule/:id', () => {
  const idOfNote = async (notes: string) => String((await Schedule.findOne({ notes }).lean())!._id);

  it('changes the fields it may, and nothing else', async () => {
    const id = await idOfNote('hi');
    await same(() => data.updateCalendarEntry(String(rep), id, { notes: 'new', status: 'Completed', userId: String(other), source: 'route_planner', linkedVisitId: newId() }));
  });

  it('a start moved, an end cleared of nothing; the stored end is checked', async () => {
    const id = await idOfNote('new');
    const bad = await same(() => data.updateCalendarEntry(String(rep), id, { startTime: '2026-11-12T10:00:00.000' }));
    expect((bad.postgres as { kind: string }).kind).toBe('invalid');
    await same(() => data.updateCalendarEntry(String(rep), id, { startTime: '2026-11-12T10:00:00.000', endTime: '2026-11-12T10:30:00.000', activityType: 'Visit', customerId: pat }));
  });

  it('an entry with no end time can be moved', async () => {
    const id = String((await Schedule.findOne({ startTime: '2026-11-16T09:00:00.000' }).lean())!._id);
    await same(() => data.updateCalendarEntry(String(rep), id, { startTime: '2026-11-16T09:15:00.000' }));
  });

  it("an entry whose customer was deleted can still be edited, but not pointed at a missing one", async () => {
    const id = await idOfNote('for a deleted customer');
    await same(() => data.updateCalendarEntry(String(rep), id, { notes: 'for a deleted customer, edited' }));
    const { postgres } = await same(() => data.updateCalendarEntry(String(rep), id, { customerId: gone }));
    expect(postgres).toEqual({ kind: 'noCustomer' });
  });

  it("someone else's entry or a made-up one is not found", async () => {
    const id = await idOfNote('for a deleted customer, edited');
    const a = await same(() => data.updateCalendarEntry(String(other), id, { notes: 'x' }));
    expect(a.postgres).toEqual({ kind: 'notFound' });
    const missing = newId();
    await same(() => data.updateCalendarEntry(String(rep), missing, { notes: 'x' }));
  });

  it('a garbage id is refused by both', async () => {
    await expect(t.on('mongo', () => data.deleteCalendarEntry(String(rep), 'not-an-id'))).rejects.toThrow();
    await expect(t.on('postgres', () => data.deleteCalendarEntry(String(rep), 'not-an-id'))).rejects.toThrow();
  });
});

describe('DELETE', () => {
  it("one entry; someone else's or a missing one is refused", async () => {
    const mine = String((await Schedule.findOne({ userId: rep, startTime: '2026-11-13T11:00:00.000' }).lean())!._id);
    const theirs = String((await Schedule.findOne({ userId: other }).lean())!._id);
    expect((await same(() => data.deleteCalendarEntry(String(rep), theirs))).postgres).toBe(false);
    const missing = newId();
    expect((await same(() => data.deleteCalendarEntry(String(rep), missing))).postgres).toBe(false);
    expect((await same(() => data.deleteCalendarEntry(String(rep), mine))).postgres).toBe(true);
    expect((await same(() => data.deleteCalendarEntry(String(rep), mine))).postgres).toBe(false);
  });

  it("a day's planned stops: only the planner's own, only mine", async () => {
    const stops = [stop(pat, '2026-11-21T09:00:00.000'), stop(acme, '2026-11-21T10:00:00.000')];
    const manual = newId();
    await same(() => data.planRouteDay(String(rep), { stops, replace: false, date: '', retry: false }));
    await same(() => data.createCalendarEntry(String(rep), manual, fields({ startTime: '2026-11-21T12:00:00.000', endTime: undefined }), false));
    expect((await same(() => data.clearPlannedDay(String(rep), '2026-11-21'))).postgres).toBe(2);
    expect((await same(() => data.clearPlannedDay(String(rep), '2026-11-21'))).postgres).toBe(0);
  });
});

describe('the backfill', () => {
  it('marks a Scheduled entry Completed when its customer has a visit that day, once', async () => {
    const first = await same(() => data.backfillCompletedEntries());
    const done = (first.mongo as { linked: unknown[] }).linked.length;
    expect(done).toBeGreaterThan(0);
    expect((first.postgres as { linked: unknown[] }).linked).toHaveLength(done);
    expect((await same(() => data.backfillCompletedEntries())).postgres).toMatchObject({ linked: [] });
  });
});

describe('the Google and iCloud syncs (their database halves)', () => {
  // Ids are made once per call, so both databases get the same ones.
  const withIds = <T>(run: (ids: { entryId: string; customerId: string }) => Promise<T>) => {
    const ids = { entryId: newId(), customerId: newId() };
    return same(() => run(ids));
  };
  const google = { id: 'g1', description: 'Lunch', startTime: '2026-11-22T09:00:00-08:00', endTime: '2026-11-22T10:00:00-08:00' };
  const icloud = { uid: 'ic1', description: 'Dentist', startTime: new Date('2026-11-24T17:00:00Z'), endTime: new Date('2026-11-24T18:00:00Z') };

  it('MongoDB refuses to make the stand-in customer (its status "Lead" is not in the model), so does Postgres, and nothing is written', async () => {
    const ids = { entryId: newId(), customerId: newId() };
    await expect(t.on('mongo', () => data.importGoogleEvent(String(rep), google, ids))).rejects.toThrow(/validation failed/);
    await expect(t.on('postgres', () => data.importGoogleEvent(String(rep), google, ids))).rejects.toThrow(/validation failed/);
    await expect(t.on('mongo', () => data.importICloudEvent(String(rep), icloud, ids))).rejects.toThrow(/validation failed/);
    await expect(t.on('postgres', () => data.importICloudEvent(String(rep), icloud, ids))).rejects.toThrow(/validation failed/);
    expect(await t.differences()).toEqual([]);
    // Events that need no new customer (cancelled, or with no start) are fine.
    expect((await withIds(ids => data.importGoogleEvent(String(rep), { ...google, status: 'cancelled' }, ids))).postgres).toBe(false);
    expect((await withIds(ids => data.importICloudEvent(String(rep), { ...icloud, startTime: null }, ids))).postgres).toBe(false);

    // The stand-in customers exist from here on (as they do on the live database).
    const now = new Date();
    await mongoose.connection.db!.collection('customers').insertMany([
      { _id: oid(), company: 'Google Calendar Sync', contactName: 'Google Event Sync', phone: '000-000-0000', email: 'sync@easystones.com', status: 'Lead', location: 'Seattle', createdAt: now, updatedAt: now },
      { _id: oid(), company: 'iCloud Calendar Sync', contactName: 'iCloud Event Sync', phone: '000-000-0000', email: 'icloud-sync@easystones.com', status: 'Lead', location: 'Seattle', createdAt: now, updatedAt: now }
    ]);
    await t.resync();
    expect(await t.differences()).toEqual([]);
  });

  it('a Google event is added, changed, left alone, and removed when cancelled', async () => {
    expect((await withIds(ids => data.importGoogleEvent(String(rep), google, ids))).postgres).toBe(true);
    expect((await withIds(ids => data.importGoogleEvent(String(rep), google, ids))).postgres).toBe(false);
    expect((await withIds(ids => data.importGoogleEvent(String(rep), { ...google, endTime: '2026-11-22T11:00:00-08:00' }, ids))).postgres).toBe(true);
    await withIds(ids => data.importGoogleEvent(String(rep), { id: 'g2', startTime: '2026-11-23', endTime: '2026-11-24' }, ids)); // all-day
    expect((await withIds(ids => data.importGoogleEvent(String(rep), { ...google, status: 'cancelled' }, ids))).postgres).toBe(true);
    expect((await withIds(ids => data.importGoogleEvent(String(rep), { ...google, status: 'cancelled' }, ids))).postgres).toBe(false);
  });

  it('an iCloud event is added once, then updated', async () => {
    expect((await withIds(ids => data.importICloudEvent(String(rep), icloud, ids))).postgres).toBe(true);
    expect((await withIds(ids => data.importICloudEvent(String(rep), icloud, ids))).postgres).toBe(false);
    await withIds(ids => data.importICloudEvent(String(rep), { ...icloud, endTime: null, description: 'Dentist, moved' }, ids));
    await withIds(ids => data.importICloudEvent(String(rep), { ...icloud, uid: 'ic2', startTime: null }, ids));
  });

  it('the sync note is written on the planner entries to send, and they leave the list once synced', async () => {
    const toSend = async () => (await data.entriesToSync(String(rep), 'google')).map(e => String(e._id)).sort();
    const first = await t.on('mongo', toSend);
    expect(first.length).toBeGreaterThan(1);
    expect(await t.on('postgres', toSend)).toEqual(first);
    const [id, second] = first;
    await same(() => data.markEntrySynced(id, 'hi\n\n[Synced to Google ID: abc123]'));
    expect(await t.on('postgres', toSend)).not.toContain(id);
    expect(await t.on('mongo', toSend)).not.toContain(id);
    // Cancelling one drops it from what's sent, in both.
    await same(() => data.updateCalendarEntry(String(rep), second, { status: 'Cancelled' }));
    expect(await t.on('postgres', toSend)).toEqual(await t.on('mongo', toSend));
    expect(await t.on('postgres', toSend)).not.toContain(second);
    // The entry gone before the note is written: both fail.
    const missing = newId();
    await expect(t.on('mongo', () => data.markEntrySynced(missing, 'x'))).rejects.toThrow();
    await expect(t.on('postgres', () => data.markEntrySynced(missing, 'x'))).rejects.toThrow();
  });
});

describe('after a customer is deleted', () => {
  it('its entry stays on the calendar with no customer, in both', async () => {
    const id = newId();
    await same(() => data.createCalendarEntry(String(rep), id, fields({ customerId: deletedLater }), false));
    await Customer.deleteOne({ _id: deletedLater });
    await t.resync(); // the copy of MongoDB now: the entry keeps its place, with no customer
    await same(() => data.updateCalendarEntry(String(rep), id, { notes: 'still here' }));
    expect(await entryIds()).toContain(id);
  }, 60_000);
});
