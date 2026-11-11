/**
 * Duplicate customers (Resolve / Undo on the import screen): MongoDB or Postgres by the
 * area's switch. Routes call these, never the twins. See ./README.md for the rules.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './merge.mongo.ts';
import * as pg from './merge.postgres.ts';
import type { ResolveDuplicatesInput } from './mergeTypes.ts';

export type { ResolveDuplicatesInput, ResolveDuplicatesResult, UndoDuplicatesResult, DuplicateAction } from './mergeTypes.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function resolveDuplicates(input: ResolveDuplicatesInput) {
  return onPostgres() ? pg.resolveDuplicates(await appDb(), input) : mongo.resolveDuplicates(input);
}

export async function undoDuplicates(ids: string[]) {
  return onPostgres() ? pg.undoDuplicates(await appDb(), ids) : mongo.undoDuplicates(ids);
}
