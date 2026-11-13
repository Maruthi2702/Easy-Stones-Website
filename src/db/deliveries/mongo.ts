/** The Delivery Schedule's reads on MongoDB — the routes' own queries, moved here unchanged. */
import Delivery from '../../models/Delivery.ts';
import Truck from '../../models/Truck.ts';
import type { Loose } from '../../types/records.ts';
import type { DeliveryFind } from './types.ts';

export async function findDeliveries({ filter = {}, projection, sort, limit }: DeliveryFind): Promise<Loose[]> {
  let q = Delivery.find(filter, projection);
  if (sort) q = q.sort(sort);
  if (limit) q = q.limit(limit);
  return q.lean() as unknown as Promise<Loose[]>;
}

export async function findDelivery(filter: Loose, projection?: Record<string, number>): Promise<Loose | null> {
  return Delivery.findOne(filter, projection).lean() as unknown as Promise<Loose | null>;
}

// ── Writes: the routes' own Mongoose calls, moved here unchanged ──

/** POST /deliveries: one save for create and edit, by ticket id. Answers the stored ticket. */
export async function saveDelivery(ticketId: string, set: Loose): Promise<Loose> {
  return Delivery.findOneAndUpdate({ id: ticketId }, { $set: set }, { upsert: true, new: true }).lean().orFail() as unknown as Promise<Loose>;
}

/** Change the one ticket the filter finds; null when it finds none (the filter may carry a "still as I read it" check). */
export async function updateDelivery(filter: Loose, set: Loose, projection?: Record<string, number>): Promise<Loose | null> {
  return Delivery.findOneAndUpdate(filter, { $set: set }, { new: true, projection }).lean() as unknown as Promise<Loose | null>;
}

export async function createDelivery(doc: Loose): Promise<void> {
  await Delivery.create(doc);
}

/** Remove the one ticket the filter finds; answers what it was, or null. */
export async function deleteDelivery(filter: Loose): Promise<Loose | null> {
  return Delivery.findOneAndDelete(filter).lean() as unknown as Promise<Loose | null>;
}

export async function setRouteNumbers(changes: { id: string; routeNumber: number }[]): Promise<void> {
  if (!changes.length) return;
  await Delivery.bulkWrite(
    changes.map(c => ({ updateOne: { filter: { id: c.id }, update: { $set: { routeNumber: c.routeNumber } } } })),
    { ordered: false }
  );
}

/** Take these tickets (row ids) off their trucks: no driver, Pending. */
export async function movePending(rowIds: string[]): Promise<void> {
  await Delivery.updateMany({ _id: { $in: rowIds } }, { $set: { truckId: '', status: 'pending' } });
}

export async function findTrucks(): Promise<Loose[]> {
  return Truck.find().lean() as unknown as Promise<Loose[]>;
}

export async function saveTruck(truck: Loose): Promise<void> {
  await Truck.findOneAndUpdate({ id: truck.id }, { $set: truck }, { upsert: true });
}
