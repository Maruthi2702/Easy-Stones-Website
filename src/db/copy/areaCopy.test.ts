import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { eq } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import * as schema from '../schema/index.ts';
import { copyFromMongo, copyAreaFromMongo, verifyArea, lockArea, lockCopies, AreaLockedError, emptySource, type CopySource } from './plan.ts';

const oid = () => new ObjectId();
const seattle = oid(), oldCustomer = oid(), d1 = oid(), d2 = oid(), t1 = oid();

const source = (): CopySource => ({
  ...emptySource(),
  locations: [{ _id: seattle, name: 'Seattle', shortCode: 'SEA' }],
  customers: [{ _id: oldCustomer, company: 'Old Co', contactName: 'Ann', email: 'a@old.example', location: 'Seattle' }],
  deliveries: [
    { _id: d1, id: 'del_1', customerName: 'Old Co', customerId: String(oldCustomer), location: 'Seattle', date: '2026-11-13', status: 'pending' },
    { _id: d2, id: 'del_2', customerName: 'New Co', customerId: '', location: 'Seattle', date: '2026-11-13', status: 'pending' }
  ],
  trucks: [{ _id: t1, id: 'truck1', name: 'Truck 1' }]
} as unknown as CopySource);

let open: OpenDb;
beforeAll(async () => {
  open = await openDb('pglite:memory');
  await migrateDb(open.db, 'pglite:memory');
  await copyFromMongo(open.db, source(), { write: true });
  await lockCopies(open.db, 'cutover'); // the whole-database copy is locked, as live is
}, 60_000);
afterAll(async () => { await open?.close(); });

describe('the deliveries-only copy', () => {
  it('refills deliveries and trucks, leaves customers alone, and works though the whole copy is locked', async () => {
    // A customer made in Postgres after cutover, which MongoDB has never heard of.
    const newCustomer = oid();
    await open.db.insert(schema.customers).values({ id: String(newCustomer), company: 'New Co', contactName: 'Bo', email: 'b@new.example', locationId: String(seattle) });
    const src = source();
    (src.deliveries as unknown[])[1] = { ...(src.deliveries as Record<string, unknown>[])[1], customerId: String(newCustomer) };
    (src.deliveries as unknown[]).push({ _id: oid(), id: 'del_3', customerName: 'Old Co', location: 'Seattle', date: '2026-11-14' });

    const report = await copyAreaFromMongo(open.db, src, 'deliveries', { write: true });
    expect(report.tables).toEqual({ deliveries: 3, trucks: 1 });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(3);
    const row = (await open.db.select().from(schema.deliveries).where(eq(schema.deliveries.ticketId, 'del_2')))[0];
    expect(row.customerId).toBe(String(newCustomer)); // linked to the live Postgres customer
    const customers = await open.db.select().from(schema.customers);
    expect(customers.map(c => c.company).sort()).toEqual(['New Co', 'Old Co']); // untouched
    expect(await verifyArea(open.db, src, 'deliveries')).toEqual([]);
  });

  it('verify reports a ticket that differs', async () => {
    const src = source();
    (src.deliveries as Record<string, unknown>[])[0].notes = 'changed in Mongo';
    expect((await verifyArea(open.db, src, 'deliveries')).join('\n')).toMatch(/deliveries/);
  });

  it('refuses for good once the area is locked, and does not touch the rows', async () => {
    await lockArea(open.db, 'deliveries', 'cutover');
    const before = (await open.db.select().from(schema.deliveries)).length;
    await expect(copyAreaFromMongo(open.db, emptySource(), 'deliveries', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.deliveries)).length).toBe(before);
    // a dry run still works, and the lock is kept alongside the global one
    await copyAreaFromMongo(open.db, source(), 'deliveries', { write: false });
    const [state] = await open.db.select().from(schema.mongoCopyState);
    expect(state.lockedAreas).toEqual(['deliveries']);
    expect(state.lockedAt).toBeTruthy();
  });
});

describe('the operations copy (Payments, Check In + Selection Sheet, Daily Reports)', () => {
  const at = new Date('2026-11-13T21:05:00Z');
  const report = oid(), payment = oid(), checkIn = oid(), selection = oid();
  const withOps = (): CopySource => {
    const src = source();
    return {
      ...src,
      dailyReports: [{
        _id: report, date: '2026-11-13', location: 'Seattle', status: 'submitted', visitors: { homeowners: 3, fabricators: null },
        payments: { cash: { count: 1, amount: 20.25 } }, transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 4, auto: true, ticketIds: ['del_1'] }],
        containers: [{ poNumber: 'PO1', material: 'Calacatta', slabs: 12 }], log: [{ at, by: 'Jo', action: 'submitted', note: '' }],
        submittedAt: at, createdAt: at, updatedAt: at
      }],
      paymentsReceived: [{
        _id: payment, location: 'Seattle', date: '2026-11-13', customerId: String(oldCustomer), customerName: 'Old Co', method: 'return',
        cents: -100000, history: [{ at, by: 'Jo', action: 'added' }], createdAt: at, updatedAt: at
      }],
      officeCheckIns: [{
        _id: checkIn, name: 'Visitor', phone: '555', location: 'Seattle', status: 'New',
        selections: [{ _id: selection, material: 'Taj', priceCentsPerSf: 2500 }], createdAt: at, updatedAt: at
      }]
    } as unknown as CopySource;
  };

  it('fills only its eight tables and leaves customers and deliveries alone', async () => {
    const deliveriesBefore = (await open.db.select().from(schema.deliveries)).length;
    const report1 = await copyAreaFromMongo(open.db, withOps(), 'operations', { write: true });
    expect(report1.tables).toEqual({
      payments_received: 1, payment_history: 1, office_check_ins: 1, check_in_selections: 1,
      daily_reports: 1, daily_report_transfers: 1, daily_report_containers: 1, daily_report_log: 1
    });
    expect((await open.db.select().from(schema.deliveries)).length).toBe(deliveriesBefore);
    expect((await open.db.select().from(schema.customers)).length).toBeGreaterThan(0);
    expect(await verifyArea(open.db, withOps(), 'operations')).toEqual([]);
  });

  it('verify reports a report that differs, then refuses for good once locked', async () => {
    const src = withOps();
    (src.dailyReports as Record<string, unknown>[])[0].status = 'draft';
    expect((await verifyArea(open.db, src, 'operations')).join('\n')).toMatch(/daily_reports/);
    await lockArea(open.db, 'operations', 'cutover');
    await expect(copyAreaFromMongo(open.db, emptySource(), 'operations', { write: true })).rejects.toBeInstanceOf(AreaLockedError);
    expect((await open.db.select().from(schema.dailyReports)).length).toBe(1);
    const [state] = await open.db.select().from(schema.mongoCopyState);
    expect(state.lockedAreas).toContain('operations');
  });
});
