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
export async function locationByNameAnyCase(name: string): Promise<Loose | null> {
  return onPostgres() ? locPg.locationByNameAnyCase(await appDb(), name) : locMongo.locationByNameAnyCase(name);
}
/** Saves a branch's Delivery Schedule column order; null when there is no such branch. */
export async function setDeliveryColumns(name: string, columns: string[]): Promise<{ name: string; deliveryColumns: string[] } | null> {
  return onPostgres() ? locPg.setDeliveryColumns(await appDb(), name, columns) : locMongo.setDeliveryColumns(name, columns);
}

// ── Users ────────────────────────────────────────────────────────────────────
// A document you will change (`userDoc`, `newUserDoc`, `roleDocFor`, `newRoleDoc`) is the
// Mongoose document on MongoDB and a `PgUser` / `PgRole` on Postgres: set fields, `await save()`.
// Reads (`find…`) answer plain MongoDB-shaped objects; `select`, `sort` and `session` as in Mongoose.
import * as peopleMongo from './people.mongo.ts';
import * as usersPg from './users.postgres.ts';
import * as rolesPg from './roles.postgres.ts';
import type { MongoReadOptions } from './people.mongo.ts';
export type { MongoReadOptions as ReadOptions } from './people.mongo.ts';
type Doc = Loose & { save(): Promise<unknown> };

export const findUsers = async (filter: Loose = {}, o: MongoReadOptions = {}): Promise<Loose[]> =>
  onPostgres() ? usersPg.findUsers(await appDb(), filter, o) : peopleMongo.findUsers(filter, o);
export const findUser = async (filter: Loose, o: MongoReadOptions = {}): Promise<Loose | null> =>
  onPostgres() ? usersPg.findUser(await appDb(), filter, o) : peopleMongo.findUser(filter, o);
export const userById = (id: unknown, o: MongoReadOptions = {}) => findUser({ _id: String(id) }, o);
export const userExists = async (filter: Loose): Promise<unknown> =>
  onPostgres() ? usersPg.userExists(await appDb(), filter) : peopleMongo.userExists(filter);
export const countUsers = async (): Promise<number> => onPostgres() ? usersPg.countUsers(await appDb()) : peopleMongo.countUsers();
export const userDoc = async (filter: Loose, o: MongoReadOptions = {}): Promise<(Doc & Loose) | null> =>
  onPostgres() ? usersPg.userDoc(await appDb(), filter, o) as never : peopleMongo.userDoc(filter, o);
export const userDocById = (id: unknown, o: MongoReadOptions = {}) => userDoc({ _id: String(id) }, o);
/** A new account (not stored until `save()`); its id is made here, so both databases agree on it. */
export const newUserDoc = async (fields: Loose): Promise<Doc & Loose> => {
  const withId = { _id: newId(), ...fields };
  return onPostgres() ? usersPg.newUserDoc(await appDb(), withId) as never : peopleMongo.newUserDoc(withId) as never;
};
/** MongoDB's updateOne: the first match gets $set / $unset / $inc. */
export const updateUser = async (filter: Loose, update: Loose) =>
  onPostgres() ? usersPg.updateUser(await appDb(), filter, update) : peopleMongo.updateUser(filter, update);
export const updateUserById = (id: unknown, update: Loose) => updateUser({ _id: String(id) }, update);
export const findUserAndUpdate = async (filter: Loose, update: Loose, o: MongoReadOptions = {}) =>
  onPostgres() ? usersPg.findUserAndUpdate(await appDb(), filter, update, o) : peopleMongo.findUserAndUpdate(filter, update, o);
export const deleteUser = async (id: string): Promise<boolean> =>
  onPostgres() ? usersPg.deleteUser(await appDb(), id) : peopleMongo.deleteUser(id);
export const touchLastSeen = async (id: string, at: Date): Promise<void> =>
  onPostgres() ? usersPg.touchLastSeen(await appDb(), id, at) : peopleMongo.touchLastSeen(id, at);

// ── Roles ────────────────────────────────────────────────────────────────────
export const findRoles = async (filter: Loose = {}, o: MongoReadOptions = {}): Promise<Loose[]> =>
  onPostgres() ? rolesPg.findRoles(await appDb(), filter, o) : peopleMongo.findRoles(filter, o);
export const findRole = async (filter: Loose, o: MongoReadOptions = {}): Promise<Loose | null> =>
  onPostgres() ? rolesPg.findRole(await appDb(), filter, o) : peopleMongo.findRole(filter, o);
export const roleExists = async (filter: Loose): Promise<unknown> =>
  onPostgres() ? rolesPg.roleExists(await appDb(), filter) : peopleMongo.roleExists(filter);
export const roleDocFor = async (filter: Loose): Promise<(Doc & Loose) | null> =>
  onPostgres() ? rolesPg.roleDocFor(await appDb(), filter) as never : peopleMongo.roleDocFor(filter);
export const roleDocById = (id: unknown) => roleDocFor({ _id: String(id) });
export const newRoleDoc = async (fields: Loose): Promise<Doc & Loose> => {
  const withId = { _id: newId(), ...fields };
  return onPostgres() ? rolesPg.newRoleDoc(await appDb(), withId) as never : peopleMongo.newRoleDoc(withId) as never;
};
export const deleteRole = async (id: string): Promise<boolean> =>
  onPostgres() ? rolesPg.deleteRole(await appDb(), id) : peopleMongo.deleteRole(id);
