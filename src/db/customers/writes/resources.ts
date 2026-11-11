/**
 * Resource saves (add, edit / move, delete, a visit's delete with its resource) and the
 * type-list changes that rewrite customers' visits and resources: MongoDB or Postgres
 * by the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts). Routes call these, never the
 * twins directly. See ./README.md for the rules every save follows.
 *
 * The type collections themselves stay on MongoDB; only the customers' rows move. So
 * `replaceFamily` (which also changes the family on each type) and the family lookup a
 * recount reads stay with MongoDB's types, and `session` is MongoDB's transaction: on
 * Postgres the customer rows save in their own transaction.
 */
import type { ClientSession } from 'mongoose';
import { appDb, areaOn } from '../../appDb.ts';
import ResourceType from '../../../models/ResourceType.ts';
import { loadFamilies } from '../../../services/modaCount.ts';
import * as mongo from './resources.mongo.ts';
import * as pg from './resources.postgres.ts';
import type { AddResourceInput, UpdateResourceInput, DeleteResourceInput, DeleteVisitInput } from './resources.rules.ts';

export { ResourceError } from './resources.rules.ts';
export type { AddResourceInput, UpdateResourceInput, DeleteResourceInput, DeleteVisitInput, DeleteVisitResult, ResourceActor } from './resources.rules.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function addResource(input: AddResourceInput) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.addResource(tx, input)) : mongo.addResource(input);
}

export async function resourceForEdit(resourceId: string) {
  return onPostgres() ? pg.resourceForEdit(await appDb(), resourceId) : mongo.resourceForEdit(resourceId);
}

export async function updateResource(input: UpdateResourceInput) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.updateResource(tx, input)) : mongo.updateResource(input);
}

export async function deleteResource(input: DeleteResourceInput) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.deleteResource(tx, input)) : mongo.deleteResource(input);
}

export async function deleteVisitWithResource(input: DeleteVisitInput) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.deleteVisitWithResource(tx, input)) : mongo.deleteVisitWithResource(input);
}

// Type lists (src/routes/typeLists.ts).

export async function countVisitTypeUses(name: string) {
  return onPostgres() ? pg.countVisitTypeUses(await appDb(), name) : mongo.countVisitTypeUses(name);
}

export async function countResourceTypeUses(name: string) {
  return onPostgres() ? pg.countResourceTypeUses(await appDb(), name) : mongo.countResourceTypeUses(name);
}

export async function replaceVisitType(from: string, to: string, session: ClientSession) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.replaceVisitType(tx, from, to)) : mongo.replaceVisitType(from, to, session);
}

export async function replaceResourceType(from: string, to: string, session: ClientSession) {
  return onPostgres() ? (await appDb()).transaction(tx => pg.replaceResourceType(tx, from, to)) : mongo.replaceResourceType(from, to, session);
}

export async function recountForFamilyChange(typeName: string, from: string | undefined, to: string | undefined, session: ClientSession) {
  if (!onPostgres()) return mongo.recountForFamilyChange(typeName, from, to, session);
  const before = await loadFamilies(session);
  return (await appDb()).transaction(tx => pg.recountForFamilyChange(tx, typeName, from, to, before));
}

export async function replaceFamily(from: string, to: string, session: ClientSession) {
  if (!onPostgres()) return mongo.replaceFamily(from, to, session);
  // The types are MongoDB's: each moves in turn, and each recount reads the families as they are.
  const types = await ResourceType.find({ family: from }).select('name').session(session).lean();
  for (const type of types) {
    await recountForFamilyChange(type.name, from, to, session);
    await ResourceType.updateOne({ _id: type._id }, { $set: { family: to } }, { session });
  }
  return types.length;
}

/** How many resource types are in this family: the type list's own collection. */
export const countFamilyUses = mongo.countFamilyUses;
