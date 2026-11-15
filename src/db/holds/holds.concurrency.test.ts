/**
 * The races Cart & Holds must never lose, on a REAL Postgres (PGlite runs one connection, so the parity
 * test can't make two writes overlap). Skipped unless PG_RACE_URL points at a scratch database, e.g.
 *
 *   createdb es_race && PG_RACE_URL=postgres:///es_race npx vitest run src/db/holds/holds.concurrency.test.ts
 *
 * The database is migrated and its holds tables emptied by the test; never point it at anything you keep.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { locations } from '../schema/reference.ts';
import { salesHolds, salesSlabReservations, salesHoldHistory, salesCarts, salesCartLines } from '../schema/checkInsHolds.ts';
import { pgStore } from './postgres.ts';
import type { HoldsStore } from './types.ts';
import type { Loose } from '../../types/records.ts';

const url = process.env.PG_RACE_URL;
let conn: OpenDb;
const oid = () => String(new mongoose.Types.ObjectId());
const by = { id: 'u1', name: 'Racer' };
const line = (slabKey: string) => ({ slabKey, serial: slabKey, sfHundredths: 6446, priceCentsPerSf: 2450 });
const newHold = (slabKey: string, i: number) => ({
  _id: oid(), status: 'active', branch: 'Seattle', customer: { id: '', name: `Customer ${i}` }, expiresOn: '2026-12-01',
  expiresAt: new Date('2026-12-02T08:00:00Z'), releaseAt: new Date('2026-12-09T08:00:00Z'), lines: [line(slabKey)], createdBy: by, updatedBy: by, requestId: `race-${slabKey}-${i}`
});
/** Each call is its own transaction, as each request is. */
const inTx = <T>(work: (s: HoldsStore) => Promise<T>) => conn.db.transaction(tx => work(pgStore(tx)));
/** The router's create: number, hold, locks, history — and the whole thing undone if a slab is taken. */
const create = (slabKey: string, i: number) => inTx(async s => {
  const number = await s.nextHoldNumber();
  const hold = await s.createHold({ ...newHold(slabKey, i), number });
  const taken = await s.lockSlabs(hold, hold.lines, by);
  if (taken.length) throw Object.assign(new Error('taken'), { code: 11000 });
  await s.addHistory([{ holdId: hold._id, holdNumber: hold.number, action: 'created', by, note: 'race' }]);
  return hold;
});

describe.skipIf(!url)('on a real Postgres', { timeout: 60000 }, () => {
  beforeAll(async () => {
    conn = await openDb(url!, { max: 12 });
    await migrateDb(conn.db, url!);
    await conn.db.execute(sql`truncate sales_holds, sales_carts, sales_counters, sales_hold_history cascade`);
    await conn.db.insert(locations).values({ id: oid(), name: 'Seattle' }).onConflictDoNothing();
  }, 120000);
  afterAll(async () => { await conn?.close(); }, 30000);

  it('ten holds on the same slab at once: one wins, the rest are undone whole, one lock row', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => create('RACE-1', i)));
    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    for (const a of attempts) if (a.status === 'rejected') expect((a.reason as { code?: unknown }).code).toBe(11000);
    expect(await conn.db.select().from(salesSlabReservations)).toHaveLength(1);
    expect(await conn.db.select().from(salesHolds)).toHaveLength(1);
    expect(await conn.db.select().from(salesHoldHistory)).toHaveLength(1);
  });

  it('holds on different slabs at once all succeed, and get different numbers with none skipped', async () => {
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => create(`RACE-OK-${i}`, i)));
    const numbers = made.map(h => h.number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);
    // The rolled-back attempts of the first test took no numbers: they run 1..9 with the first hold's 1.
    expect(numbers[7] - numbers[0]).toBe(7);
  });

  it('ten saves of one hold at the same version: one wins, the version goes up by one', async () => {
    const hold = await create('RACE-SAVE', 99);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => inTx(async s => {
      const current = (await s.findHold(hold._id))!;
      return s.saveHold({ ...current, job: `job ${i}`, __v: hold.__v });
    })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(((await inTx(s => s.findHold(hold._id))) as Loose).__v).toBe(hold.__v + 1);
  });

  it('ten adds of the same slab to one cart at once: it lands once', async () => {
    const userId = oid();
    await inTx(s => s.ensureCart(userId, 'Racer'));
    const added = await Promise.all(Array.from({ length: 10 }, () => inTx(s => s.addCartLines(userId, [{ slabKey: 'RACE-CART', product: 'Taj', addedAt: new Date() }]))));
    expect(added.filter(Boolean)).toHaveLength(1);
    const [cart] = await conn.db.select().from(salesCarts);
    expect(await conn.db.select().from(salesCartLines)).toHaveLength(1);
    expect(cart.userId).toBe(userId);
  });
});
