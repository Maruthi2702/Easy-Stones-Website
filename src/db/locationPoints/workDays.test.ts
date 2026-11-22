import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../schema/index.ts';
import { migrateDb } from '../client.ts';
import type { Db } from '../copy/plan.ts';
import { dayFactsFor, dayFactsForPeople } from './workDays.ts';

const USER = 'a1'.repeat(12), OTHER = 'b2'.repeat(12), CUST = 'c3'.repeat(12), LOC = '000000000000000000000001';

describe('dayFactsFor', () => {
  let client: PGlite; let db: Db;
  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrateDb(db, 'pglite:memory');
    await db.insert(schema.locations).values({ id: LOC, name: 'Seattle' });
    await db.insert(schema.roles).values({ id: 'ab'.repeat(12), name: 'driver', displayName: 'Driver' } as never);
    await db.insert(schema.users).values([{ id: USER, username: 'dan', role: 'driver', passwordHash: 'x' }, { id: OTHER, username: 'other', role: 'driver', passwordHash: 'x' }] as never);
    await db.insert(schema.customers).values({ id: CUST, company: 'Granite Co', contactName: 'T', email: 'g@x.test', locationId: LOC } as never);
    // Time off Thu Nov 19; a normal visit that day by the other person is not his.
    await db.insert(schema.visits).values([
      { id: 'd1'.repeat(12), customerId: CUST, position: 1, visitDate: '2026-11-19', visitType: 'Personal Time Off', createdById: USER, createdAt: '2026-11-18 08:00:00' },
      { id: 'd2'.repeat(12), customerId: CUST, position: 2, visitDate: '2026-11-20', visitType: 'In Office Administration Day', createdById: USER, createdAt: '2026-11-18 08:00:00' },
      { id: 'd3'.repeat(12), customerId: CUST, position: 3, visitDate: '2026-11-18', visitType: 'Personal Time Off', createdById: OTHER, createdAt: '2026-11-18 08:00:00' }
    ] as never);
    // Calendar: Saturday stop (counts), a cancelled Sunday stop (doesn't), another person's Friday stop.
    await db.insert(schema.schedules).values([
      { id: 'e1'.repeat(12), userId: USER, customerId: CUST, startsAt: '2026-11-21 09:30:00' },
      { id: 'e2'.repeat(12), userId: USER, customerId: CUST, startsAt: '2026-11-22 10:00:00', status: 'Cancelled' },
      { id: 'e3'.repeat(12), userId: OTHER, customerId: CUST, startsAt: '2026-11-20 10:00:00' }
    ] as never);
    // Deliveries on Dan's column: Sunday (counts), a cancelled Monday one (doesn't).
    await db.insert(schema.deliveries).values([
      { id: 'f1'.repeat(12), ticketId: 'del_1', customerName: 'Granite Co', truckKey: 'drv_dan', day: '2026-11-22', locationId: LOC },
      { id: 'f2'.repeat(12), ticketId: 'del_2', customerName: 'Granite Co', truckKey: 'drv_dan', day: '2026-11-23', status: 'cancelled', locationId: LOC }
    ] as never);
  }, 60_000);
  afterAll(async () => { await client?.close(); });

  it('finds time off, scheduled stops and deliveries on the person\'s own column, per day', async () => {
    const days = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
    const facts = await dayFactsFor({ id: USER, username: 'dan' }, days, db);
    const f = (day: string) => facts.get(day);
    expect(f('2026-11-18')).toEqual({ timeOff: false, scheduledWork: false });   // only the other person's time off
    expect(f('2026-11-19')).toEqual({ timeOff: true, scheduledWork: false });    // Personal Time Off
    expect(f('2026-11-20')).toEqual({ timeOff: false, scheduledWork: false });   // admin day is a normal workday; the other person's stop is not his
    expect(f('2026-11-21')).toEqual({ timeOff: false, scheduledWork: true });    // Saturday stop
    expect(f('2026-11-22')).toEqual({ timeOff: false, scheduledWork: true });    // cancelled stop doesn't count, the delivery does
    expect(f('2026-11-23')).toEqual({ timeOff: false, scheduledWork: false });   // cancelled delivery
  });
  it('answers every asked day, ignores bad ones and survives nothing to ask', async () => {
    expect((await dayFactsFor({ id: USER, username: 'dan' }, ['2026-11-30', 'soon'], db)).size).toBe(1);
    expect((await dayFactsFor({ id: USER, username: 'dan' }, [], db)).size).toBe(0);
  });

  it('reads many people at once, each for their own day, matching the one-person answer', async () => {
    const many = await dayFactsForPeople([
      { id: USER, username: 'dan', day: '2026-11-19' },     // Dan's time off
      { id: OTHER, username: 'other', day: '2026-11-18' }   // the other person's time off
    ], db);
    expect(many.get(USER)).toEqual({ timeOff: true, scheduledWork: false });
    expect(many.get(OTHER)).toEqual({ timeOff: true, scheduledWork: false });
    // a person is judged on THEIR day only: Dan on the 18th has no time off even though another person does
    expect((await dayFactsForPeople([{ id: USER, username: 'dan', day: '2026-11-18' }], db)).get(USER)).toEqual({ timeOff: false, scheduledWork: false });
    const sat = await dayFactsForPeople([{ id: USER, username: 'dan', day: '2026-11-21' }, { id: OTHER, username: 'other', day: '2026-11-20' }], db);
    expect(sat.get(USER)).toEqual({ timeOff: false, scheduledWork: true });   // Saturday stop
    expect(sat.get(OTHER)).toEqual({ timeOff: false, scheduledWork: true });  // Friday stop
    expect((await dayFactsForPeople([{ id: USER, username: 'dan', day: '2026-11-22' }], db)).get(USER)).toEqual({ timeOff: false, scheduledWork: true }); // delivery, cancelled stop ignored
    expect((await dayFactsForPeople([], db)).size).toBe(0);
    expect((await dayFactsForPeople([{ id: USER, username: 'dan', day: 'soon' }], db)).size).toBe(0);
  });
});
