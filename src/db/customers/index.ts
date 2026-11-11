/**
 * The customer area's data layer: every route that reads customers calls these, and
 * each picks MongoDB or Postgres by the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts).
 * Both versions answer the same (customers.parity.test.ts); a new customer read is
 * added to mongo.ts, postgres.ts and the parity test together.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { CustomerPageQuery, CustomerListQuery, CustomerViewCountsQuery } from './types.ts';

export type { CustomerPage, CustomerPageQuery, CustomerList, CustomerListQuery, CustomerViewCounts, CustomerViewCountsQuery } from './types.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

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
export * from './writes/resources.ts';
