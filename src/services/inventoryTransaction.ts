import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import InventoryRevision from '../models/InventoryRevision.ts';
import { sql, eq } from 'drizzle-orm';
import { areaOn, appDb } from '../db/appDb.ts';
import { inventoryRevision as revisionTable } from '../db/schema/index.ts';

/**
 * With `DB_INVENTORY=postgres` the publication counter lives in Postgres (src/db/inventory/). Holds and
 * the other writers that still work in a MongoDB transaction bump it right after that commits, and every
 * reader reads it from there, so the one counter still says "stock or holds changed".
 */
const revisionOnPostgres = () => areaOn('inventory') === 'postgres';
async function pgRevision(tx: unknown = null): Promise<number> {
  const [row] = await ((tx as Awaited<ReturnType<typeof appDb>> | null) ?? await appDb()).select().from(revisionTable).where(eq(revisionTable.id, 'inventory'));
  return row?.revision || 0;
}
async function pgBumpRevision(): Promise<void> {
  await (await appDb()).insert(revisionTable).values({ id: 'inventory', revision: 1 })
    .onConflictDoUpdate({ target: revisionTable.id, set: { revision: sql`${revisionTable.revision} + 1` } });
}

/** All inventory/hold/purchasing writers acquire this first, in their transaction. */
export async function prepareInventoryRevision(): Promise<void> {
  if (revisionOnPostgres()) return;
  await InventoryRevision.createCollection();
  try {
    await InventoryRevision.updateOne({ _id: 'inventory' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
  }
}
export async function touchInventoryRevision(session: ClientSession): Promise<number> {
  const record = await InventoryRevision.findOneAndUpdate({ _id: 'inventory' }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
  if (!record) throw new Error('Inventory publication guard is unavailable');
  return record.revision;
}
export async function inventoryRevision(session: ClientSession | null = null, tx: unknown = null): Promise<number> {
  if (revisionOnPostgres()) return pgRevision(tx);
  return (await InventoryRevision.findById('inventory').session(session).lean())?.revision || 0;
}
export async function inInventoryTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  await prepareInventoryRevision();
  const session = await mongoose.startSession();
  let result!: T;
  try {
    const onPostgres = revisionOnPostgres();
    await session.withTransaction(async () => {
      if (!onPostgres) await touchInventoryRevision(session);
      result = await work(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    if (onPostgres) await pgBumpRevision();
    return result;
  } finally { await session.endSession(); }
}

/** Coherent multi-source read without incrementing the publication revision. */
export async function inInventorySnapshot<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' } });
    return result;
  } finally { await session.endSession(); }
}
