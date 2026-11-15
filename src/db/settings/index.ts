/**
 * App-wide settings by key (today the side nav's order): the route reads and writes through
 * these, and each picks MongoDB or Postgres by the area's switch (`DB_SETTINGS`,
 * src/db/appDb.ts). Both answer the same (settings.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import { newId } from '../ids.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';

const onPostgres = () => areaOn('settings') === 'postgres';

/** The stored value, or undefined when the key was never saved (or was cleared). */
export async function readSetting(key: string): Promise<unknown> {
  return onPostgres() ? pg.readSetting(await appDb(), key) : mongo.readSetting(key);
}

export async function writeSetting(key: string, value: unknown, by: string): Promise<void> {
  const id = newId();
  return onPostgres() ? pg.writeSetting(await appDb(), key, value, by, id) : mongo.writeSetting(key, value, by, id);
}

export async function removeSetting(key: string): Promise<void> {
  return onPostgres() ? pg.removeSetting(await appDb(), key) : mongo.removeSetting(key);
}
