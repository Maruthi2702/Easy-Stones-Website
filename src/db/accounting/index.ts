/**
 * Accounting's (3rd-party freight) data layer: the router and the delivery sync read and write through a store,
 * one per unit of work, and each picks MongoDB or Postgres by the area's switch (`DB_ACCOUNTING`, src/db/appDb.ts).
 * Both answer the same (accounting.parity.test.ts). Fuel Man is a separate area and keeps its own database code.
 */
import mongoose from 'mongoose';
import { appDb, areaOn } from '../appDb.ts';
import { mongoStore } from './mongo.ts';
import { pgStore } from './postgres.ts';
import type { AccountingStore } from './types.ts';

export type { AccountingStore, ChargeQuery, InvoiceQuery } from './types.ts';

const onPostgres = () => areaOn('accounting') === 'postgres';

/** A write that must land together or not at all (a change and its history line, a payment and every charge it paid). */
export async function inAccountingTransaction<T>(work: (store: AccountingStore) => Promise<T>): Promise<T> {
  if (onPostgres()) return (await appDb()).transaction(tx => work(pgStore(tx)));
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => { out = await work(mongoStore(session)); });
    return out;
  } finally {
    await session.endSession();
  }
}

/** Reads and single writes outside any transaction. */
export async function accountingStore(): Promise<AccountingStore> {
  return onPostgres() ? pgStore(await appDb()) : mongoStore(null);
}
