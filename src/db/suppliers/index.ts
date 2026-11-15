/**
 * Supplier POs and the supplier portal's data layer: the staff routes, the portal routes and the portal's
 * sign-in read and write only through a store, one per unit of work, and each picks MongoDB or Postgres by
 * the area's switch (`DB_SUPPLIERS`, src/db/appDb.ts). Both answer the same (suppliers.parity.test.ts).
 * Users and Roles are not here: the buyers list and a buyer's email stay on MongoDB until the Users area moves.
 */
import { appDb, areaOn } from '../appDb.ts';
import { mongoStore } from './mongo.ts';
import { pgStore } from './postgres.ts';
import type { SuppliersStore } from './types.ts';

export type { SuppliersStore, HistoryLine, PoQuery } from './types.ts';

const onPostgres = () => areaOn('suppliers') === 'postgres';

/** Reads and single writes outside any transaction. */
export async function suppliersStore(): Promise<SuppliersStore> {
  return onPostgres() ? pgStore(await appDb()) : mongoStore();
}

/** Writes that must land together or not at all (on MongoDB they run one after the other, as they always did). */
export async function inSuppliersTransaction<T>(work: (store: SuppliersStore) => Promise<T>): Promise<T> {
  if (!onPostgres()) return work(mongoStore());
  return (await appDb()).transaction(tx => work(pgStore(tx)));
}
