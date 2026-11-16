/**
 * Visit Types, Resource Types and Families: the router and the few other readers go through these, and
 * each picks MongoDB or Postgres by the area's switch (`DB_TYPES`, src/db/appDb.ts; unset = MongoDB).
 * Both answer the same (types.parity.test.ts). Postgres needs `DB_CUSTOMERS=postgres` (customers already are):
 * deleting a type moves the customers' records in the same transaction.
 */
import type { ClientSession } from 'mongoose';
import { appDb, areaOn } from '../appDb.ts';
import ResourceType from '../../models/ResourceType.ts';
import { mongoTypeStore, type MongoTypeOptions } from './mongo.ts';
import { pgTypeStore, familyRowsOf, resourceTypeByName as pgResourceTypeByName } from './postgres.ts';
import type { Loose } from '../../types/records.ts';
import type { TypeKind, TypeStore } from './store.ts';

export type { TypeStore, TypeKind, RemoveResult } from './store.ts';
export type { MongoTypeOptions } from './mongo.ts';

const onPostgres = () => areaOn('types') === 'postgres';

/**
 * The store for one list. `mongo` carries what the MongoDB side needs (its model and how it moves records);
 * it is used only while the area is on MongoDB. Resolved per call, so a switch flip takes effect at once.
 */
export function typeStore(kind: TypeKind, mongo: MongoTypeOptions): TypeStore {
  const mongoSide = mongoTypeStore(mongo);
  const call = <K extends keyof TypeStore>(method: K) => (async (...args: unknown[]) =>
    onPostgres()
      ? (pgTypeStore(await appDb(), kind)[method] as (...a: unknown[]) => unknown)(...args)
      : (mongoSide[method] as (...a: unknown[]) => unknown)(...args)) as TypeStore[K];
  return {
    list: call('list'), byId: call('byId'), add: call('add'), reorder: call('reorder'),
    edit: call('edit'), uses: call('uses'), remove: call('remove'), families: call('families')
  };
}

/** A resource type by its stored name (the add / edit resource check), or null. */
export async function resourceTypeByName(name: string): Promise<Loose | null> {
  return onPostgres() ? pgResourceTypeByName(await appDb(), name) : (await ResourceType.findOne({ name }).select('active').lean()) as Loose | null;
}

/** Name → family for every resource type (the Moda counts read it). */
export async function familyRows(session?: ClientSession | null): Promise<Loose[]> {
  return onPostgres() ? familyRowsOf(await appDb()) : (await ResourceType.find({}).select('name family').session(session ?? null).lean()) as Loose[];
}

/** True once the lists live on Postgres: the start-up seed (MongoDB's empty-collection fill) stands down. */
export const typesOnPostgres = onPostgres;
