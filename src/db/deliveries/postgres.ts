/** The Delivery Schedule's reads on Postgres, answering in MongoDB's shape (deliveryDoc.ts). */
import { eq, sql, asc, desc, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { deliveries, trucks } from '../schema/operations.ts';
import { customers } from '../schema/customers.ts';
import Delivery from '../../models/Delivery.ts';
import { deliveryRowOf } from '../copy/operationsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { newId } from '../ids.ts';
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

// ── Writes ──
//
// A save builds the ticket as MongoDB would hold it after the same $set (the stored
// ticket with the new fields over it; a new one starts from Mongoose's own defaults), then
// turns that into a row with the copy's own builder (deliveryRowOf). So a save writes
// exactly what a re-copy of MongoDB would make. A field the model doesn't declare is kept
// by MongoDB and dropped here, as the copy drops it.

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const lockOne = async (tx: Tx | Db, filter: Loose) => {
  const [row] = await selectTickets(tx as Db).where(deliveryWhere(filter)).limit(1).for('update', { of: deliveries });
  return row ?? null;
};

async function rowFor(tx: Tx | Db, doc: Loose) {
  const ref = await referenceIndexOf(tx as Db);
  const wanted = typeof doc.customerId === 'string' ? doc.customerId.toLowerCase() : '';
  const found = /^[0-9a-f]{24}$/.test(wanted)
    ? await (tx as Db).select({ id: customers.id }).from(customers).where(eq(customers.id, wanted)) : [];
  const row = deliveryRowOf(doc, ref, { customerIds: new Set(found.map(f => f.id)) }, []);
  // A save that names a ticket status or type the table refuses fails here, as it can't be copied.
  return row;
}

const answer = async (tx: Tx | Db, id: string, projection?: Record<string, number>): Promise<Loose> => {
  const [row] = await selectTickets(tx as Db).where(eq(deliveries.id, id));
  return projectDelivery(deliveryDoc(row.d, row), projection);
};

/** The stored ticket with `set` over it, as a MongoDB document. */
const withSet = (row: { d: typeof deliveries.$inferSelect; locationName: string | null; destinationName: string | null },
  set: Loose, at: Date): Loose => ({ ...deliveryDoc(row.d, row), ...set, _id: row.d.id, updatedAt: at });

export async function updateDelivery(db: Db, filter: Loose, set: Loose, projection?: Record<string, number>): Promise<Loose | null> {
  return db.transaction(async tx => {
    const found = await lockOne(tx, filter);
    if (!found) return null;
    const row = await rowFor(tx, withSet(found, set, new Date()));
    const { id: _id, createdAt: _created, ...columns } = row;
    await tx.update(deliveries).set(columns).where(eq(deliveries.id, found.d.id));
    return answer(tx, found.d.id, projection);
  });
}

export async function saveDelivery(db: Db, ticketId: string, set: Loose): Promise<Loose> {
  return db.transaction(async tx => {
    const found = await lockOne(tx, { id: ticketId });
    const at = new Date();
    if (found) {
      const row = await rowFor(tx, withSet(found, set, at));
      const { id: _id, createdAt: _created, ...columns } = row;
      await tx.update(deliveries).set(columns).where(eq(deliveries.id, found.d.id));
      return answer(tx, found.d.id);
    }
    const id = newId();
    const fresh = new Delivery({ ...set, id: ticketId }).toObject() as Loose;
    await tx.insert(deliveries).values(await rowFor(tx, { ...fresh, _id: id, createdAt: at, updatedAt: at }));
    return answer(tx, id);
  });
}

export async function createDelivery(db: Db, doc: Loose): Promise<void> {
  const at = new Date();
  const id = newId();
  const fresh = new Delivery(doc).toObject() as Loose;
  await db.insert(deliveries).values(await rowFor(db, { ...fresh, _id: id, createdAt: at, updatedAt: at }));
}

export async function deleteDelivery(db: Db, filter: Loose): Promise<Loose | null> {
  return db.transaction(async tx => {
    const found = await lockOne(tx, filter);
    if (!found) return null;
    const doc = deliveryDoc(found.d, found);
    await tx.delete(deliveries).where(eq(deliveries.id, found.d.id));
    return doc;
  });
}

export async function setRouteNumbers(db: Db, changes: { id: string; routeNumber: number }[]): Promise<void> {
  if (!changes.length) return;
  const at = new Date();
  await db.transaction(async tx => {
    for (const c of changes) await tx.update(deliveries).set({ routeNumber: c.routeNumber, updatedAt: at }).where(eq(deliveries.ticketId, c.id));
  });
}

export async function movePending(db: Db, rowIds: string[]): Promise<void> {
  if (!rowIds.length) return;
  await db.update(deliveries).set({ truckKey: '', status: 'pending', updatedAt: new Date() }).where(inArray(deliveries.id, rowIds));
}

const truckDoc = (t: typeof trucks.$inferSelect): Loose => ({
  _id: t.id, id: t.truckKey, name: t.name, driver: t.driver, color: t.color, location: t.location,
  createdAt: t.createdAt, updatedAt: t.updatedAt
});

export async function findTrucks(db: Db): Promise<Loose[]> {
  return (await db.select().from(trucks).orderBy(asc(trucks.id))).map(truckDoc);
}

export async function saveTruck(db: Db, truck: Loose): Promise<void> {
  const at = new Date();
  await db.transaction(async tx => {
    const [existing] = await tx.select().from(trucks).where(eq(trucks.truckKey, String(truck.id))).for('update');
    const merged = { ...(existing ? truckDoc(existing) : new (await import('../../models/Truck.ts')).default({ id: truck.id }).toObject()), ...truck };
    const values = {
      truckKey: String(merged.id), name: String(merged.name ?? ''), driver: String(merged.driver ?? ''),
      color: String(merged.color ?? '#D4AF37'), location: String(merged.location ?? ''), updatedAt: at
    };
    if (existing) await tx.update(trucks).set(values).where(eq(trucks.id, existing.id));
    else await tx.insert(trucks).values({ id: newId(), ...values, createdAt: at });
  });
}
