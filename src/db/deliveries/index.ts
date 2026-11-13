/**
 * The Delivery Schedule's data layer: every route that reads or changes tickets calls
 * these, and each picks MongoDB or Postgres by the area's switch (`DB_DELIVERIES`,
 * src/db/appDb.ts). Both answer the same (deliveries.parity.test.ts); a new read goes in
 * mongo.ts, postgres.ts and the parity test together.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type { DeliveryFind } from './types.ts';
import type { Loose } from '../../types/records.ts';
import type DeliveryModel from '../../models/Delivery.ts';

export type { DeliveryFind } from './types.ts';

const onPostgres = () => areaOn('deliveries') === 'postgres';

/** A ticket as the routes read it: MongoDB's shape, `id` always there. */
export type Ticket = (typeof DeliveryModel extends import('mongoose').Model<infer T> ? T : never) & Loose;

export async function findDeliveries(query: DeliveryFind): Promise<Ticket[]> {
  return (onPostgres() ? pg.findDeliveries(await appDb(), query) : mongo.findDeliveries(query)) as Promise<Ticket[]>;
}

export async function findDelivery(filter: Loose, projection?: Record<string, number>) {
  return onPostgres() ? pg.findDelivery(await appDb(), filter, projection) : mongo.findDelivery(filter, projection);
}

export async function saveDelivery(ticketId: string, set: Loose) {
  return onPostgres() ? pg.saveDelivery(await appDb(), ticketId, set) : mongo.saveDelivery(ticketId, set);
}

export async function updateDelivery(filter: Loose, set: Loose, projection?: Record<string, number>) {
  return onPostgres() ? pg.updateDelivery(await appDb(), filter, set, projection) : mongo.updateDelivery(filter, set, projection);
}

export async function createDelivery(doc: Loose) {
  return onPostgres() ? pg.createDelivery(await appDb(), doc) : mongo.createDelivery(doc);
}

export async function deleteDelivery(filter: Loose) {
  return onPostgres() ? pg.deleteDelivery(await appDb(), filter) : mongo.deleteDelivery(filter);
}

export async function setRouteNumbers(changes: { id: string; routeNumber: number }[]) {
  return onPostgres() ? pg.setRouteNumbers(await appDb(), changes) : mongo.setRouteNumbers(changes);
}

/** Take these tickets (by row id) off their trucks and make them Pending. */
export async function movePending(rowIds: string[]) {
  return onPostgres() ? pg.movePending(await appDb(), rowIds) : mongo.movePending(rowIds);
}

export async function findTrucks() {
  return onPostgres() ? pg.findTrucks(await appDb()) : mongo.findTrucks();
}

export async function saveTruck(truck: Loose) {
  return onPostgres() ? pg.saveTruck(await appDb(), truck) : mongo.saveTruck(truck);
}

/**
 * The two reads Accounting's freight sync makes, shaped like the Mongoose calls it was
 * written against (`findOne(filter, 'a b c').lean()`), so it needs no change until Accounting moves.
 */
const fieldsOf = (fields: string | Record<string, number> | undefined) =>
  typeof fields === 'string' ? Object.fromEntries(fields.split(/\s+/).filter(Boolean).map(f => [f, 1])) : fields;

export const freightDeliveries = {
  findOne: (filter: Loose, fields?: string) => ({ lean: () => findDelivery(filter, fieldsOf(fields)) }),
  find: (filter: Loose, fields?: string) => ({ lean: () => findDeliveries({ filter, projection: fieldsOf(fields) }) })
};

/** The activity-log line for a ticket change (ePOD cleared, arrival logged). Never throws into the caller's save. */
export async function logDeliveryActivity(entry: import('../customers/writes/activityLog.ts').ActivityEntry) {
  if (!onPostgres()) return (await import('../customers/writes/activityLog.ts')).logActivityMongo(entry);
  return (await import('../customers/writes/activityLog.ts')).insertActivityLog(await appDb(), entry);
}
