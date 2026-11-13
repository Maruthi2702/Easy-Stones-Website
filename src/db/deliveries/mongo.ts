/** The Delivery Schedule's reads on MongoDB — the routes' own queries, moved here unchanged. */
import Delivery from '../../models/Delivery.ts';
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
