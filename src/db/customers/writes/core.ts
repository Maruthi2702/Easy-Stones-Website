/**
 * Customer saves (add, edit, delete, bulk, active, quick note): MongoDB or Postgres by
 * the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts). Routes call these, never the
 * twins directly. See ./README.md for the rules every save follows.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './core.mongo.ts';
import * as pg from './core.postgres.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function setQuickNote(id: string, quickNote: unknown) {
  return onPostgres() ? pg.setQuickNote(await appDb(), id, quickNote) : mongo.setQuickNote(id, quickNote);
}
