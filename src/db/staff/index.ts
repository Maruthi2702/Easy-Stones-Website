/**
 * Staff accounts, roles and locations: the routes read through these, and each picks MongoDB
 * or Postgres by the area's switch (`DB_STAFF`, src/db/appDb.ts). Both answer the same
 * (staff.parity.test.ts). Last area to move (DB_MOVE_CHECKLIST.md §5): nothing is switched
 * on until its cutover, and the Mongo → Postgres reference sync (src/db/reference/) stops then.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
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
