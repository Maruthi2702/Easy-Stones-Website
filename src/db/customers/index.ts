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
import type { ClientSession } from 'mongoose';

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

/** Shape the actual saved record; uploader names come from the database that saved it. */
export const customerRecordResponse = async (record: Loose, scope: CustomerHistoryScope) =>
  onPostgres() ? pg.customerRecordResponse(await appDb(), record, scope) : mongo.customerRecordResponse(record, scope);

// Small reads shared by customer routes and the other areas' customer lookups.
export async function customerVCard(id: string) {
  return onPostgres() ? pg.customerVCard(await appDb(), id) : mongo.customerVCard(id);
}

export async function customerModa(id: string) {
  return onPostgres() ? pg.customerModa(await appDb(), id) : mongo.customerModa(id);
}

export async function customerById(id: string, session: ClientSession | null = null) {
  return onPostgres() ? pg.customerById(await appDb(), id) : mongo.customerById(id, session);
}

export async function customerContactsForMatching() {
  return onPostgres() ? pg.customerContactsForMatching(await appDb()) : mongo.customerContactsForMatching();
}

export async function customerAttribution(id: string) {
  return onPostgres() ? pg.customerAttribution(await appDb(), id) : mongo.customerAttribution(id);
}

export async function customerPriceLevel(id: string) {
  return onPostgres() ? pg.customerPriceLevel(await appDb(), id) : mongo.customerPriceLevel(id);
}

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

// Route Planner, duplicate checks and calendar reads.
export async function mapCustomerPins() {
  return onPostgres() ? pg.mapCustomerPins(await appDb()) : mongo.mapCustomerPins();
}
export async function mapCustomerRecord(id: string) {
  return onPostgres() ? pg.mapCustomerRecord(await appDb(), id) : mongo.mapCustomerRecord(id);
}
export async function duplicateSignals() {
  return onPostgres() ? pg.duplicateSignals(await appDb()) : mongo.duplicateSignals();
}
export async function duplicateCustomers(ids: string[]) {
  return onPostgres() ? pg.duplicateCustomers(await appDb(), ids) : mongo.duplicateCustomers(ids);
}
export async function calendarEntries(query: import('./types.ts').CalendarReadQuery) {
  return onPostgres() ? pg.calendarEntries(await appDb(), query) : mongo.calendarEntries(query);
}

// Dashboard reads: scope and date boundaries are decided by the HTTP routes.
export type { DashboardReadQuery, DashboardRollupQuery, DashboardRollups } from './types.ts';
export async function dashboardVisits(q: import('./types.ts').DashboardReadQuery) {
  return onPostgres() ? pg.dashboardVisits(await appDb(), q) : mongo.dashboardVisits(q);
}
export async function dashboardResources(q: import('./types.ts').DashboardReadQuery) {
  return onPostgres() ? pg.dashboardResources(await appDb(), q) : mongo.dashboardResources(q);
}
export async function dashboardRollups(q: import('./types.ts').DashboardRollupQuery) {
  return onPostgres() ? pg.dashboardRollups(await appDb(), q) : mongo.dashboardRollups(q);
}
