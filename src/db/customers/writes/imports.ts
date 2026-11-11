/**
 * The customer imports' saves (SPS connect, Excel import, its remembered answers): MongoDB or
 * Postgres by the area's switch. Routes call these, never the twins. See ./README.md.
 * Reads here (`customersForPlan`, `readImportMemory`) are the ones a plan needs beside its save.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './imports.mongo.ts';
import * as pg from './imports.postgres.ts';
import type { ConnectInput, ImportUpdate, MemorySave } from './importsTypes.ts';
import type { Loose } from '../../../types/records.ts';

export type { ConnectInput, ConnectResult, ImportUpdate, MemorySave } from './importsTypes.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

/** `select` is the MongoDB field list the route used; Postgres reads whole records. */
export async function customersForPlan(select: string) {
  return onPostgres() ? pg.customersForPlan(await appDb()) : mongo.customersForPlan(select);
}
export async function readImportMemory() {
  return onPostgres() ? pg.readImportMemory(await appDb()) : mongo.readImportMemory();
}
export async function saveImportMemory(save: MemorySave) {
  return onPostgres() ? pg.saveImportMemory(await appDb(), save) : mongo.saveImportMemory(save);
}
export async function forgetImportMemory() {
  return onPostgres() ? pg.forgetImportMemory(await appDb()) : mongo.forgetImportMemory();
}
export async function connectSps(input: ConnectInput) {
  return onPostgres() ? pg.connectSps(await appDb(), input) : mongo.connectSps(input);
}
/** `docs` are validated Mongoose documents; Postgres takes their plain form. */
export async function insertImportedCustomers(docs: Loose[], batchSize = 500) {
  return onPostgres()
    ? pg.insertImportedCustomers(await appDb(), docs.map(d => (typeof d.toObject === 'function' ? d.toObject({ virtuals: false, getters: false }) : d)))
    : mongo.insertImportedCustomers(docs, batchSize);
}
export async function updateImportedCustomers(batch: ImportUpdate[]) {
  return onPostgres() ? pg.updateImportedCustomers(await appDb(), batch) : mongo.updateImportedCustomers(batch);
}
