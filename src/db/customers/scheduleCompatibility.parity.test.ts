/** Legacy BSON clocks keep MongoDB membership/order while customer-calendar writes run. */
import { beforeAll, afterAll, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
import Customer from '../../models/Customer.ts';
import Schedule from '../../models/Schedule.ts';
import { schedules } from '../schema/customers.ts';
import * as data from './index.ts';
import { calendarParityContext, knownCalendarDifference } from './calendarParity.ts';
import { diffEntries, normalize } from './parity.ts';
import { openWriteParity, type WriteParity } from './writes/writeParity.ts';
import type { Loose } from '../../types/records.ts';

const oid = () => new mongoose.Types.ObjectId();
const owner = oid(), customer = oid(), resourceCustomer = oid();
const legacy = oid(), canonical = oid(), later = oid(), minute = oid(), google = oid(), icloud = oid();
const backfillDate = oid(), backfillString = oid(), backfillManual = oid(), zonedString = oid(), linkDate = oid(), resourceDate = oid(), historicalVisit = oid();
const now = () => '2026-01-14T10:00:00.000';
const stamp = { createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z') };
let t: WriteParity;
beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertOne({ _id: oid(), name: 'Dallas' });
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertOne({ _id: owner, username: 'rep', displayName: 'Rep', password: 'x', role: 'sales_rep', location: 'Dallas' });
    await Customer.insertMany([
      { _id: customer, contactName: 'Ann', company: 'Acme', email: 'ann@acme.example', location: 'Dallas',
        visits: [{ _id: historicalVisit, date: '2026-01-11', purpose: 'Visit', createdAt: now() }] },
      { _id: resourceCustomer, contactName: 'Ben', company: 'Bolt', email: 'ben@bolt.example', location: 'Dallas' }
    ]);
    const entry = (_id: mongoose.Types.ObjectId, startTime: unknown, over: Loose = {}) => ({
      _id, userId: owner, customerId: customer, startTime, activityType: 'Visit', status: 'Scheduled', source: 'route_planner', ...stamp, ...over
    });
    // Insert via the driver: Mongoose's current String path must not erase the legacy BSON Date type.
    await db.collection('schedules').insertMany([
      entry(legacy, new Date('2026-01-07T12:00:00.000Z'), { endTime: new Date('2026-01-07T12:30:00.000Z') }),
      entry(zonedString, '2026-01-06T15:30:00.000Z', { endTime: '2026-01-06T16:30:00.000Z' }),
      entry(canonical, '2026-01-07T10:00:00.000'), entry(later, '2026-02-01T09:00:00.000'),
      entry(minute, '2026-01-08T09:00'),
      entry(google, new Date('2026-01-09T12:00:00.000Z'), { notes: 'Google Calendar Event\n[Google ID: g-legacy]\n\nBefore', source: 'manual' }),
      entry(icloud, new Date('2026-01-10T12:00:00.000Z'), { notes: 'iCloud Event\n[iCloud ID: i-legacy]\n\nBefore', source: 'manual' }),
      entry(backfillDate, new Date('2026-01-11T12:00:00.000Z'), { endTime: new Date('2026-01-11T12:30:00.000Z') }), entry(backfillString, '2026-01-11T10:00:00.000'),
      entry(backfillManual, '2026-01-11T11:00:00.000', { source: 'manual' }),
      entry(linkDate, new Date('2026-01-12T12:00:00.000Z')),
      entry(resourceDate, new Date('2026-01-13T12:00:00.000Z'), { customerId: resourceCustomer })
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 120_000);
afterAll(async () => { await t?.close(); }, 60_000);
const row = async (id: mongoose.Types.ObjectId) => (await t.pg.db.select().from(schedules).where(eq(schedules.id, String(id))))[0];
const idsOf = (rows: Loose[]) => rows.map(item => String(item._id));
async function sameCalendar(start?: string, end?: string) {
  const source = await Schedule.collection.find({}).toArray();
  const users = await mongoose.connection.db!.collection('users').find({}).toArray();
  const facts = calendarParityContext(source, users);
  const result = await t.both(() => data.calendarEntries({ people: '*', start, end }));
  expect(idsOf(result.postgres)).toEqual(idsOf(result.mongo));
  const postgres = normalize(result.postgres);
  expect(diffEntries(normalize(result.mongo), postgres).filter(d => !knownCalendarDifference(d, { postgres, calendar: facts }))).toEqual([]);
  return result;
}

it('copies only noncanonical start metadata and preserves BSON sorting plus string-range membership', async () => {
  expect((await row(legacy)).legacyStartTime).toEqual({ kind: 'date', value: '2026-01-07T12:00:00.000Z' });
  expect((await row(canonical)).legacyStartTime).toBeNull();
  expect((await row(minute)).legacyStartTime).toEqual({ kind: 'string', value: '2026-01-08T09:00' });
  const all = await sameCalendar();
  expect(idsOf(all.postgres).indexOf(String(later))).toBeLessThan(idsOf(all.postgres).indexOf(String(legacy)));
  const range = await sameCalendar('2026-01-01T00:00:00.000', '2026-12-31T23:59:59.999');
  expect(range.mongo).toHaveLength(6); expect(range.postgres).toHaveLength(6);
  const exact = await sameCalendar('2026-01-08T09:00', '2026-01-08T09:00');
  expect(idsOf(exact.postgres)).toEqual([String(minute)]);
});
it('retains legacy clocks on note/status-only edits, then replaces them on an explicit canonical start edit', async () => {
  await t.both(() => data.updateCalendarEntry(String(owner), String(legacy), { notes: 'Note only', status: 'Scheduled' }));
  expect((await row(legacy)).legacyStartTime?.kind).toBe('date');
  expect((await Schedule.collection.findOne({ _id: legacy }))!.startTime).toBeInstanceOf(Date);
  expect(await t.differences()).toEqual([]);
  await sameCalendar();
  // The legacy end is intentionally not revalidated; MongoDB accepts this start-only edit.
  const edit = await t.both(() => data.updateCalendarEntry(String(owner), String(legacy), { startTime: '2026-01-07T11:00:00.000' }));
  expect(edit.mongo.kind).toBe('updated'); expect(edit.postgres.kind).toBe('updated');
  expect((await row(legacy)).legacyEndTime?.kind).toBe('date');
  expect((await row(legacy)).legacyStartTime).toBeNull();
  expect(await t.differences()).toEqual([]);
  await sameCalendar();
});
it('clears only raw string-day planner entries, preserving a BSON-Date entry on that day', async () => {
  // The earlier explicit edit made legacy canonical; backfillDate remains a real BSON Date.
  const result = await t.both(() => data.clearPlannedDay(String(owner), '2026-01-11'));
  expect(result.mongo).toBe(1); expect(result.postgres).toBe(1);
  expect(await row(backfillDate)).toBeDefined(); expect(await row(backfillString)).toBeUndefined();
  expect(await t.differences()).toEqual([]);
});
it('does not backfill a BSON-Date entry from a normalized visit day', async () => {
  const result = await t.both(data.backfillCompletedEntries);
  expect(result.postgres).toEqual(result.mongo);
  expect(result.postgres.linked.map(entry => entry.id)).toContain(String(backfillManual));
  expect((await row(backfillDate)).status).toBe('Scheduled');
  expect(await t.differences()).toEqual([]);
});
it('does not relink a BSON-Date entry when adding a visit; creates the normal drop-in instead', async () => {
  const visitId = String(oid()), dropInId = String(oid()), logId = String(oid());
  await t.both(async () => {
    const saved = await data.addVisit({ customerId: String(customer), visit: { _id: visitId, date: '2026-01-12', purpose: 'Visit',
      createdBy: String(owner), createdByName: 'Rep', createdAt: now() },
      calendar: { userId: String(owner), dropInId }, log: { id: logId, performedBy: String(owner), performedByName: 'Rep' }, now });
    if (saved.kind === 'saved') await saved.afterAnswer(() => {});
    return saved.kind;
  });
  expect((await row(linkDate)).status).toBe('Scheduled');
  expect((await t.pg.db.select().from(schedules).where(eq(schedules.id, dropInId)))[0].source).toBe('visit_log');
  expect(await t.differences()).toEqual([]);
});
it('does not relink a BSON-Date entry when adding a placement resource', async () => {
  const ids = { resourceId: String(oid()), visitId: String(oid()), dropInId: String(oid()) };
  await t.both(() => data.addResource({ customerId: String(resourceCustomer),
    fields: { title: 'Catalog', date: '2026-01-13', qty: 1, image: [] }, performer: { id: String(owner), name: 'Rep' },
    scheduleUserId: String(owner), now, ids }));
  expect((await row(resourceDate)).status).toBe('Scheduled');
  expect((await t.pg.db.select().from(schedules).where(eq(schedules.id, ids.dropInId)))[0].source).toBe('visit_log');
  expect(await t.differences()).toEqual([]);
});
it('keeps a true legacy Google sync no-op when the source String path already matches', async () => {
  const event = { id: 'g-legacy', startTime: new Date('2026-01-09T12:00:00.000Z').toString(), description: 'Before' };
  const result = await t.both(() => data.importGoogleEvent(String(owner), event, { entryId: String(oid()), customerId: String(oid()) }));
  expect(result.mongo).toBe(false); expect(result.postgres).toBe(false);
  expect((await row(google)).legacyStartTime?.kind).toBe('date');
  expect(await t.differences()).toEqual([]);
});
it('Google sync replaces a legacy Date with its new string spelling and a repeated event is unchanged', async () => {
  const ids = { entryId: String(oid()), customerId: String(oid()) };
  const event = { id: 'g-legacy', startTime: '2026-01-09T12:00:00.000Z', description: 'After' };
  const result = await t.both(() => data.importGoogleEvent(String(owner), event, ids));
  expect(result.mongo).toBe(true); expect(result.postgres).toBe(true);
  expect((await row(google)).legacyStartTime).toEqual({ kind: 'string', value: event.startTime });
  expect(await t.differences()).toEqual([]);
  const repeated = await t.both(() => data.importGoogleEvent(String(owner), event, ids));
  expect(repeated.mongo).toBe(false); expect(repeated.postgres).toBe(false);
  expect(await t.differences()).toEqual([]);
});
it('iCloud sync replaces a legacy Date with the ISO string it saved, retaining correct range membership', async () => {
  const ids = { entryId: String(oid()), customerId: String(oid()) };
  const event = { uid: 'i-legacy', startTime: new Date('2026-01-10T12:00:00.000Z'), endTime: null, description: 'After' };
  const result = await t.both(() => data.importICloudEvent(String(owner), event, ids));
  expect(result.mongo).toBe(false); expect(result.postgres).toBe(false);
  expect((await row(icloud)).legacyStartTime).toEqual({ kind: 'string', value: event.startTime.toISOString() });
  expect(await t.differences()).toEqual([]);
  await sameCalendar('2026-01-01T00:00:00.000', '2026-12-31T23:59:59.999');
});

it('preserves ICS start/end instants and raw zoned strings under UTC and Pacific hosts, without a clock allowance', async () => {
  const priorZone = process.env.TZ;
  const instant = (value: unknown) => value ? new Date(value as string).toISOString() : '';
  try {
    for (const zone of ['UTC', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      const result = await t.both(() => data.calendarEntries({ people: '*', feed: true }));
      const byId = (values: Loose[]) => [...values].sort((a, b) => String(a._id).localeCompare(String(b._id)));
      expect(normalize(byId(result.postgres))).toEqual(normalize(byId(result.mongo)));
      const source = new Map(result.mongo.map(item => [String(item._id), item]));
      for (const item of result.postgres) {
        const original = source.get(String(item._id))!;
        expect(instant(item.startTime)).toBe(instant(original.startTime));
        expect(instant(item.endTime)).toBe(instant(original.endTime));
      }
      const legacyClocks = result.postgres.find(item => String(item._id) === String(backfillDate))!;
      expect(legacyClocks.startTime).toBe('2026-01-11T12:00:00.000Z');
      expect(legacyClocks.endTime).toBe('2026-01-11T12:30:00.000Z');
      const imported = result.postgres.find(item => String(item._id) === String(zonedString))!;
      expect(imported.startTime).toBe('2026-01-06T15:30:00.000Z');
      expect(imported.endTime).toBe('2026-01-06T16:30:00.000Z');
    }
  } finally { if (priorZone === undefined) delete process.env.TZ; else process.env.TZ = priorZone; }
});
