/**
 * Purchasing's data layer: its routes read and write through a store, one per unit of work,
 * and each picks MongoDB or Postgres by the area's switch (`DB_INVENTORY`, shared with stock and in-transit, src/db/appDb.ts).
 * Both answer the same (purchasing.parity.test.ts).
 *
 * Stock, sales reports and transit shipments come from their own layers (sources.ts), which join the unit of
 * work's Postgres transaction (`store.tx`) when the switch is on; holds' reservations still read MongoDB, so on
 * Postgres a unit of work is a MongoDB snapshot session (for those) around one Postgres transaction.
 */
import { appDb, areaOn } from '../appDb.ts';
import { inInventoryTransaction, inInventorySnapshot } from '../../services/inventoryTransaction.ts';
import { mongoStore } from './mongo.ts';
import { pgStore } from './postgres.ts';
import { bumpInventoryRevision } from './sources.ts';
import type { PurchasingStore } from './types.ts';

export type { PurchasingStore, DraftChange } from './types.ts';

const onPostgres = () => areaOn('purchasing') === 'postgres';

/** A write: everything it does lands together or not at all. */
export async function inPurchasingTransaction<T>(work: (store: PurchasingStore) => Promise<T>): Promise<T> {
  if (!onPostgres()) return inInventoryTransaction(session => work(mongoStore(session)));
  const db = await appDb();
  const result = await inInventorySnapshot(session => db.transaction(tx => work(pgStore(tx, session))));
  await bumpInventoryRevision();
  return result;
}

/** A coherent read of everything Purchasing shows. */
export async function inPurchasingSnapshot<T>(work: (store: PurchasingStore) => Promise<T>): Promise<T> {
  if (!onPostgres()) return inInventorySnapshot(session => work(mongoStore(session)));
  const db = await appDb();
  return inInventorySnapshot(session => db.transaction(tx => work(pgStore(tx, session)), { isolationLevel: 'repeatable read', accessMode: 'read only' }));
}
