/**
 * Fuel Man's data layer: the routes read and write through a store, one per unit of work, and each picks
 * MongoDB or Postgres by the area's switch (`DB_FUELMAN`, src/db/appDb.ts). Both answer the same
 * (fuelman.parity.test.ts).
 *
 * `fleetTransaction` is every write: it takes the fleet's own state row first (so two writers on one fleet
 * take turns, as MongoDB's write conflict used to make them) and counts a revision, which the screen polls.
 * `snapshot` is a consistent read.
 */
import mongoose from 'mongoose';
import { appDb, areaOn } from '../appDb.ts';
import { FuelState } from '../../fuelman/models.ts';
import { fuelState } from '../schema/accounting.ts';
import { sql } from 'drizzle-orm';
import { mongoStore } from './mongo.ts';
import { pgStore } from './postgres.ts';
import type { FuelStore } from './types.ts';

export type { FuelStore } from './types.ts';
export * from './types.ts';

const onPostgres = () => areaOn('fuelman') === 'postgres';

/** Reads and single writes outside any transaction. */
export async function fuelStore(): Promise<FuelStore> {
  return onPostgres() ? pgStore(await appDb()) : mongoStore(null);
}

/** One consistent look at the data. */
export async function snapshotOf<T>(work: (store: FuelStore) => Promise<T>): Promise<T> {
  if (onPostgres()) {
    const db = await appDb();
    return db.transaction(tx => work(pgStore(tx)), { isolationLevel: 'repeatable read', accessMode: 'read only' } as never);
  }
  const session = await mongoose.startSession(); let result!: T;
  try { await session.withTransaction(async () => { result = await work(mongoStore(session)); }, { readConcern: { level: 'snapshot' } }); return result; }
  finally { await session.endSession(); }
}

/** A write that must land whole, counted as one revision of the fleet. */
export async function fleetTransactionOf<T>(scopeKey: string, work: (store: FuelStore) => Promise<T>): Promise<T> {
  if (onPostgres()) {
    const db = await appDb();
    return db.transaction(async tx => {
      await tx.insert(fuelState).values({ id: scopeKey, revision: 0 }).onConflictDoNothing();
      await tx.update(fuelState).set({ revision: sql`${fuelState.revision} + 1` }).where(sql`${fuelState.id} = ${scopeKey}`);
      return work(pgStore(tx));
    });
  }
  await FuelState.createCollection();
  try { await FuelState.updateOne({ _id: scopeKey }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error; }
  const session = await mongoose.startSession(); let result!: T;
  try {
    await session.withTransaction(async () => {
      await FuelState.updateOne({ _id: scopeKey }, { $inc: { revision: 1 } }, { session });
      result = await work(mongoStore(session));
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}
