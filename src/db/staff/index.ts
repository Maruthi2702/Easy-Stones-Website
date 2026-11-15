/**
 * Staff accounts, roles and locations: the routes read through these, and each picks MongoDB
 * or Postgres by the area's switch (`DB_STAFF`, src/db/appDb.ts). Both answer the same
 * (staff.parity.test.ts). Last area to move (DB_MOVE_CHECKLIST.md §5): nothing is switched
 * on until its cutover, and the Mongo → Postgres reference sync (src/db/reference/) stops then.
 */
import { appDb, areaOn } from '../appDb.ts';
import { newId } from '../ids.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import * as locMongo from './locations.mongo.ts';
import * as locPg from './locations.postgres.ts';
import type { Loose } from '../../types/records.ts';

const onPostgres = () => areaOn('staff') === 'postgres';

/** What `authenticate` needs about a signed-in staff id: null when there is no such account. */
export async function authIdentity(userId: string): Promise<Loose | null> {
  return onPostgres() ? pg.authIdentity(await appDb(), userId) : mongo.authIdentity(userId);
}

export async function roleByName(name: string): Promise<Loose | null> {
  return onPostgres() ? pg.roleByName(await appDb(), name) : mongo.roleByName(name);
}

export async function rolesList(): Promise<Loose[]> {
  return onPostgres() ? pg.rolesList(await appDb()) : mongo.rolesList();
}

// ── Locations ────────────────────────────────────────────────────────────────
export type { Geocoder, SaveResult } from './locations.mongo.ts';

export async function locationsList(): Promise<Loose[]> {
  return onPostgres() ? locPg.locationsList(await appDb()) : locMongo.locationsList();
}
export async function locationNames(): Promise<string[]> {
  return onPostgres() ? locPg.locationNames(await appDb()) : locMongo.locationNames();
}
/** `{ _id, name, shortCode }` of every location (the Add / Edit form's duplicate check). */
export async function locationBriefs(): Promise<Loose[]> {
  return onPostgres() ? locPg.locationBriefs(await appDb()) : locMongo.locationBriefs();
}
export async function locationByName(name: string): Promise<Loose | null> {
  return onPostgres() ? locPg.locationByName(await appDb(), name) : locMongo.locationByName(name);
}
export async function locationById(id: string): Promise<Loose | null> {
  return onPostgres() ? locPg.locationById(await appDb(), id) : locMongo.locationById(id);
}
export async function createLocation(record: Loose, by: string, geocode: locMongo.Geocoder): Promise<locMongo.SaveResult> {
  const id = newId();
  return onPostgres() ? locPg.createLocation(await appDb(), id, record, by, geocode) : locMongo.createLocation(id, record, by, geocode);
}
export async function updateLocation(id: string, record: Loose, by: string, geocode: locMongo.Geocoder): Promise<Loose | null> {
  return onPostgres() ? locPg.updateLocation(await appDb(), id, record, by, geocode) : locMongo.updateLocation(id, record, by, geocode);
}
export async function deleteLocation(id: string): Promise<boolean> {
  return onPostgres() ? locPg.deleteLocation(await appDb(), id) : locMongo.deleteLocation(id);
}
