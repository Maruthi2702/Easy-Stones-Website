/**
 * Customer saves (add, edit, delete, bulk, active, quick note): MongoDB or Postgres by
 * the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts). Routes call these, never the
 * twins directly. See ./README.md for the rules every save follows.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './core.mongo.ts';
import * as pg from './core.postgres.ts';
import type { Loose } from '../../../types/records.ts';
import type { CreateCustomerInput, EditCustomerInput } from './coreTypes.ts';

export type { CreateCustomerInput, EditCustomerInput, EditResult, GeocodePatch, ResolvedRep } from './coreTypes.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function setQuickNote(id: string, quickNote: unknown) {
  return onPostgres() ? pg.setQuickNote(await appDb(), id, quickNote) : mongo.setQuickNote(id, quickNote);
}

/** A rep id → { salesRep, salesRepName } (an empty or unknown id clears both). */
export async function resolveSalesRep(salesRepId: unknown) {
  return onPostgres() ? pg.resolveSalesRep(await appDb(), salesRepId) : mongo.resolveSalesRep(salesRepId);
}

/** POST /api/customers: answers the saved customer (a Mongoose document or a plain record in its shape). */
export async function createCustomer(input: CreateCustomerInput) {
  return onPostgres() ? pg.createCustomer(await appDb(), input) : mongo.createCustomer(input);
}

/** PUT /api/customers/:id. */
export async function editCustomer(id: string, input: EditCustomerInput) {
  return onPostgres() ? pg.editCustomer(await appDb(), id, input) : mongo.editCustomer(id, input);
}

/** PATCH /api/customers/bulk (valid ids; `update` is status and / or the rep pair). */
export async function bulkUpdateCustomers(ids: string[], update: Loose) {
  return onPostgres() ? pg.bulkUpdateCustomers(await appDb(), ids, update) : mongo.bulkUpdateCustomers(ids, update);
}

/** PATCH /api/customers/:id/active. false = no such customer. */
export async function setCustomerActive(id: string, isActive: unknown) {
  return onPostgres() ? pg.setCustomerActive(await appDb(), id, isActive) : mongo.setCustomerActive(id, isActive);
}

/** A user was renamed: relabel the customers they own (MongoDB) — Postgres reads the name by a join and writes nothing. */
export async function renameRepOnCustomers(userId: unknown, nameAfter: string) {
  return onPostgres() ? pg.renameRepOnCustomers(await appDb(), userId, nameAfter) : mongo.renameRepOnCustomers(userId, nameAfter);
}
