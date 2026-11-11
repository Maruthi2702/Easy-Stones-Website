/**
 * The customer area's data layer: every route that reads customers calls these, and
 * each picks MongoDB or Postgres by the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts).
 * Both versions answer the same (customers.parity.test.ts); a new customer read is
 * added to mongo.ts, postgres.ts and the parity test together.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { CustomerPageQuery, CustomerListQuery, CustomerViewCountsQuery, CustomerHistoryScope, CustomerHistoryKind } from './types.ts';
import type { Loose } from '../../types/records.ts';

export type { CustomerPage, CustomerPageQuery, CustomerList, CustomerListQuery, CustomerViewCounts, CustomerViewCountsQuery,
  CustomerHistoryScope, CustomerHistoryKind } from './types.ts';

export { isHistoryId } from './profileShape.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function customerProfile(id: string, scope: CustomerHistoryScope) {
  return onPostgres() ? pg.customerProfile(await appDb(), id, scope) : mongo.customerProfile(id, scope);
}

export async function customerHistoryEntry(customerId: string, kind: CustomerHistoryKind, entryId: string,
  people: CustomerHistoryScope['people']) {
  return onPostgres() ? pg.customerHistoryEntry(await appDb(), customerId, kind, entryId, people)
    : mongo.customerHistoryEntry(customerId, kind, entryId, people);
}

/** Customer writes still use MongoDB; shape the actual saved record, never an older Postgres copy. */
export const customerRecordResponse = (record: Loose, scope: CustomerHistoryScope) => mongo.customerRecordResponse(record, scope);

export async function dropdownCustomers() {
  return onPostgres() ? pg.dropdownCustomers(await appDb()) : mongo.dropdownCustomers();
}

export async function customerCities() {
  return onPostgres() ? pg.customerCities(await appDb()) : mongo.customerCities();
}

export async function customerPage(q: CustomerPageQuery) {
  return onPostgres() ? pg.customerPage(await appDb(), q) : mongo.customerPage(q);
}

export async function customerList(q: CustomerListQuery) {
  return onPostgres() ? pg.customerList(await appDb(), q) : mongo.customerList(q);
}

export async function customerViewCounts(q: CustomerViewCountsQuery) {
  return onPostgres() ? pg.customerViewCounts(await appDb(), q) : mongo.customerViewCounts(q);
}

// Saves: one file per group in ./writes (core, visits, resources, …), each picking
// MongoDB or Postgres itself. One line per group, so groups built in parallel merge cleanly.
export * from './writes/core.ts';
export * from './writes/visits.ts';
export * from './writes/accounts.ts';
export * from './writes/resources.ts';
export * from './writes/schedule.ts';
export * from './writes/merge.ts';
export * from './writes/imports.ts';
export * from './writes/sps.ts';
