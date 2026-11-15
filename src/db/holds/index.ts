/**
 * Cart & Holds' data layer: the router, the expiry job and Purchasing read and write through a store, one per
 * unit of work, and each picks MongoDB or Postgres by the area's switch (`DB_HOLDS`, src/db/appDb.ts).
 * Both answer the same (holds.parity.test.ts).
 *
 * The stock revision (src/services/inventoryTransaction.ts) is bumped by every hold write: inside the write's
 * own MongoDB transaction on MongoDB, right after the Postgres commit on Postgres.
 */
import type { ClientSession } from 'mongoose';
import { appDb, areaOn } from '../appDb.ts';
import { inInventoryTransaction } from '../../services/inventoryTransaction.ts';
import { mongoStore } from './mongo.ts';
import { pgStore } from './postgres.ts';
import type { Db } from '../copy/plan.ts';
import type { HoldsStore } from './types.ts';
import type { Loose } from '../../types/records.ts';

export type { HoldsStore, HoldQuery } from './types.ts';

const onPostgres = () => areaOn('holds') === 'postgres';

/** A write that must land together or not at all (a hold, its locks, its history). */
export async function inHoldsTransaction<T>(work: (store: HoldsStore) => Promise<T>): Promise<T> {
  if (!onPostgres()) return inInventoryTransaction(session => work(mongoStore(session)));
  const db = await appDb();
  const result = await db.transaction(tx => work(pgStore(tx)));
  await inInventoryTransaction(async () => {});
  return result;
}

/** Reads and single writes outside any transaction. */
export async function holdsStore(): Promise<HoldsStore> {
  return onPostgres() ? pgStore(await appDb()) : mongoStore(null);
}

/** Purchasing's read of the slab locks at its branches, inside its own unit of work (`session` on MongoDB, `tx` on Postgres). */
export async function lockedSlabsAtBranches(branches: string[], session: ClientSession | null, tx: unknown = null): Promise<Loose[]> {
  if (!onPostgres()) return mongoStore(session).locksAtBranches(branches);
  return pgStore((tx as Db | null) ?? await appDb()).locksAtBranches(branches);
}
