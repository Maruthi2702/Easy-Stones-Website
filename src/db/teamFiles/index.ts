/**
 * Team Files' data layer (the Dashboard's folders, files and links): the routes read and write through these, and each picks
 * MongoDB or Postgres by the small ones' switch (`DB_SMALL`, src/db/appDb.ts). Both answer the same (teamFiles.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import { newId } from '../ids.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { Loose } from '../../types/records.ts';

const onPostgres = () => areaOn('small') === 'postgres';

export async function listResources(parentId: string | null) { return onPostgres() ? pg.list(await appDb(), parentId) : mongo.list(parentId); }
export async function getResource(id: string) { return onPostgres() ? pg.get(await appDb(), id) : mongo.get(id); }
export async function createResource(fields: Loose) {
  const id = newId();
  return onPostgres() ? pg.create(await appDb(), fields, id) : mongo.create(fields, id);
}
export async function updateResource(id: string, patch: Loose) { return onPostgres() ? pg.update(await appDb(), id, patch) : mongo.update(id, patch); }
/** Removes the item (and a folder's whole tree); answers the content of every file removed, for the disk files. */
export async function removeResourceTree(id: string) { return onPostgres() ? pg.removeTree(await appDb(), id) : mongo.removeTree(id); }
