/** The Delivery Schedule's reads on Postgres, answering in MongoDB's shape (deliveryDoc.ts). */
import { eq, sql, asc, desc, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { deliveries } from '../schema/operations.ts';
import { deliveryWhere, origin, destination } from './filter.ts';
import { deliveryDoc, projectDelivery } from './deliveryDoc.ts';
import type { Loose } from '../../types/records.ts';
import type { DeliveryFind } from './types.ts';

const selectTickets = (db: Db) => db.select({ d: deliveries, locationName: origin.name, destinationName: destination.name })
  .from(deliveries)
  .leftJoin(origin, eq(origin.id, deliveries.locationId))
  .leftJoin(destination, eq(destination.id, deliveries.transferDestinationId));

export async function findDeliveries(db: Db, { filter = {}, projection, sort, limit }: DeliveryFind): Promise<Loose[]> {
  const order: SQL[] = [];
  if (sort?.createdAt) order.push(sort.createdAt === 1 ? asc(deliveries.createdAt) : desc(deliveries.createdAt));
  if (sort?.date) {
    const blankFirstDay = sql`coalesce(${deliveries.day}::text, '')`;
    order.push(sort.date === 1 ? asc(blankFirstDay) : desc(blankFirstDay));
  }
  // Tickets that tie on the asked order: MongoDB reads its index in the sort's direction, so ties
  // come back in creation order for an ascending sort and newest first for a descending one
  // (an id starts with its creation time).
  const direction = sort?.date ?? sort?.createdAt ?? 1;
  let q = selectTickets(db).where(deliveryWhere(filter)).$dynamic().orderBy(...order, direction === 1 ? asc(deliveries.id) : desc(deliveries.id));
  if (limit) q = q.limit(limit);
  return (await q).map(r => projectDelivery(deliveryDoc(r.d, r), projection));
}

export async function findDelivery(db: Db, filter: Loose, projection?: Record<string, number>): Promise<Loose | null> {
  const [row] = await selectTickets(db).where(deliveryWhere(filter)).limit(1);
  return row ? projectDelivery(deliveryDoc(row.d, row), projection) : null;
}
