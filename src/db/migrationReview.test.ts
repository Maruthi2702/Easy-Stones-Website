/** Regression checks for failures that sequential Mongo/copy parity did not expose. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from './schema/index.ts';
import { migrateDb } from './client.ts';
import type { Db } from './copy/plan.ts';
import { createCustomer, editCustomer, setCustomerActive, setQuickNote } from './customers/writes/core.postgres.ts';
import { deleteUser } from './staff/users.postgres.ts';
import { deleteLocation } from './staff/locations.postgres.ts';
import { staffDeletionError } from './staff/deleteError.ts';
import { savePermits } from './permits/writesPostgres.ts';
import { pgStore } from './holds/postgres.ts';

const id = (n: number) => n.toString(16).padStart(24, '0');
const location = id(1), user = id(2), customer = id(3);
const now = new Date('2026-11-16T12:00:00Z');
const statements: string[] = [];
let capture = false, client: PGlite, db: Db;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema, casing: 'snake_case', logger: { logQuery(query) { if (capture) statements.push(query); } } }) as unknown as Db;
  await migrateDb(db, 'pglite:memory');
  await db.insert(schema.locations).values({ id: location, name: 'Seattle' });
  await db.insert(schema.roles).values({ id: id(4), name: 'sales_rep', displayName: 'Sales Rep' });
  await db.insert(schema.users).values({ id: user, username: 'review', passwordHash: 'hash', role: 'sales_rep' });
  await createCustomer(db, { id: customer, fields: { company: 'Review', contactName: 'Test', email: 'review@example.test', location: 'Seattle', quickNote: 'old note' },
    rep: { salesRep: null, salesRepName: '' }, geo: {}, createdBy: user });
}, 60_000);
afterAll(async () => { await client?.close(); });

describe('customer edit concurrency', () => {
  it('preserves independent changes saved while geocoding is pending', async () => {
    const result = await editCustomer(db, customer, {
      updateData: { company: 'Edited company' }, salesRep: undefined, address: { street: '1 Main', city: 'Seattle' }, city: undefined,
      geocode: async () => {
        await setQuickNote(db, customer, 'newer note');
        await setCustomerActive(db, customer, false);
        await db.update(schema.customers).set({ spsKey: 'connected-during-edit' }).where(eq(schema.customers.id, customer));
        return null;
      }
    });
    const [saved] = await db.select().from(schema.customers).where(eq(schema.customers.id, customer));
    expect(saved).toMatchObject({ company: 'Edited company', quickNote: 'newer note', isActive: false, spsKey: 'connected-during-edit' });
    expect(result).toMatchObject({ customer: { quickNote: 'newer note', isActive: false, sps: { key: 'connected-during-edit' } } });
  });
});

describe('staff deletion conflicts', () => {
  it('keeps a scheduled user and translates the actual foreign key error into an actionable conflict', async () => {
    await db.insert(schema.schedules).values({ id: id(5), userId: user, customerId: customer, startsAt: '2026-11-16 09:00:00' });
    const error = await deleteUser(db, user).catch(e => e);
    expect(staffDeletionError(error, 'user')).toMatchObject({ status: 409, body: { message: expect.stringContaining('Deactivate') } });
    expect(await db.select().from(schema.users).where(eq(schema.users.id, user))).toHaveLength(1);
    expect(await db.select().from(schema.schedules)).toHaveLength(1);
  });

  it('keeps a location and its customers when deletion is blocked', async () => {
    const error = await deleteLocation(db, location).catch(e => e);
    expect(staffDeletionError(error, 'location')).toMatchObject({ status: 409, body: { message: expect.stringContaining('Reassign') } });
    expect(await db.select().from(schema.customers)).toHaveLength(1);
    expect(await db.select().from(schema.locations)).toHaveLength(1);
  });

  it('does not turn unrelated errors into deletion conflicts', () => {
    expect(staffDeletionError(new Error('database unavailable'), 'user').status).toBe(500);
  });
});

describe('permit batch saves', () => {
  const permits = Array.from({ length: 1100 }, (_, n) => ({ permitNumber: `REVIEW-${n}`, category: 'residential', issuedOn: '2026-11-16',
    address: `${n} Main`, contacts: [{ kind: 'contractor', company: 'Test', license: 'TEST123' }] }));
  const ids = permits.map((_, n) => id(1000 + n));

  it('saves a multi-chunk import and keeps an unchanged refresh to a bounded query count', async () => {
    expect(await savePermits(db, 'review', permits, ids, now, true)).toEqual({ added: 1100, updated: 0 });
    statements.length = 0;
    capture = true;
    try {
      expect(await savePermits(db, 'review', permits.slice(0, 100), ids.slice(0, 100), now, false)).toEqual({ added: 0, updated: 0 });
    } finally { capture = false; }
    expect(statements.length).toBeLessThanOrEqual(5); // previously 201 queries for these same 100 permits
    expect(await db.select().from(schema.permits)).toHaveLength(1100);
    expect(await db.select().from(schema.permitContacts)).toHaveLength(1100);
  }, 30_000);

  it('merges repeated numbers, retains insert-only fields and replaces contacts only with the final value', async () => {
    const fields = { permitNumber: 'DUP', categoryIfNew: 'residential', issuedOn: '2026-11-16', contacts: [{ company: 'Initial' }] };
    expect(await savePermits(db, 'review', [fields, { ...fields, address: 'New address' }, { ...fields, contacts: [] }], [id(3000), id(3001), id(3002)], now, true))
      .toEqual({ added: 1, updated: 2 });
    expect(await savePermits(db, 'review', [{ permitNumber: 'DUP', categoryIfNew: 'commercial' }], [id(3003)], new Date(now.getTime() + 1000), false))
      .toEqual({ added: 0, updated: 0 });
    const [saved] = await db.select().from(schema.permits).where(eq(schema.permits.permitNumber, 'DUP'));
    expect(saved).toMatchObject({ id: id(3000), category: 'residential', address: 'New address', firstSeenAt: now, detailsAt: now });
  });
});

describe('Holds SQL pagination', () => {
  it('returns a later page and overlapping tab counts without fetching the whole list', async () => {
    await db.insert(schema.salesHolds).values(Array.from({ length: 60 }, (_, n) => ({
      id: id(4000 + n), number: n + 1, locationId: location, status: n < 30 ? 'active' : n < 45 ? 'released' : 'converted',
      expiresOn: '2026-11-16', expiresAt: new Date(now.getTime() + (n < 10 ? -1 : n < 20 ? 1 : 10) * 86400000),
      releaseAt: new Date(now.getTime() + 20 * 86400000), createdAt: new Date(now.getTime() + n * 1000)
    })));
    statements.length = 0;
    capture = true;
    let result;
    try { result = await pgStore(db).listHolds({ scope: {}, status: 'all', now, page: 2, limit: 7 }); }
    finally { capture = false; }
    expect(result.total).toBe(60);
    expect(result.items.map(h => h.number)).toEqual([53, 52, 51, 50, 49, 48, 47]);
    expect(result.counts).toEqual({ all: 60, active: 20, expiring: 10, expired: 10, released: 15, converted: 15 });
    expect(statements.length).toBeLessThanOrEqual(4);
    const empty = await pgStore(db).listHolds({ scope: { branch: 'Unknown' }, status: 'active', now, page: 1, limit: 7 });
    expect(empty).toMatchObject({ total: 0, items: [], counts: { all: 0, active: 0 } });
  });
});
