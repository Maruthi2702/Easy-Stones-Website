/**
 * Check-ins on Postgres, answering in MongoDB's shape (checkInDoc.ts). A save builds the
 * check-in through the same Mongoose model MongoDB uses (so trimming, lower-casing, length
 * limits and defaults are the model's own), then makes its rows with the copy's own builder
 * (checkInRowsOf), so it writes what a re-copy of MongoDB would.
 *
 * One of MongoDB's behaviours is kept on purpose: an id that isn't a real id makes the read
 * throw (Mongoose's CastError), which the routes answer as a 500.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import mongoose from 'mongoose';
import type { Db } from '../copy/plan.ts';
import { officeCheckIns, checkInSelections } from '../schema/checkInsHolds.ts';
import { locations } from '../schema/reference.ts';
import { checkInRowsOf } from '../copy/checkInsHoldsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import OfficeCheckIn from '../../models/OfficeCheckIn.ts';
import { checkInDoc } from './checkInDoc.ts';
import { whereOf } from './filter.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Document = InstanceType<typeof OfficeCheckIn>;

const selectCheckIns = (db: Db | Tx) => (db as Db).select({ c: officeCheckIns, locationName: locations.name })
  .from(officeCheckIns).leftJoin(locations, eq(locations.id, officeCheckIns.locationId));

async function withLines(db: Db | Tx, rows: { c: typeof officeCheckIns.$inferSelect; locationName: string | null }[]): Promise<Loose[]> {
  if (!rows.length) return [];
  const lines = await (db as Db).select().from(checkInSelections)
    .where(inArray(checkInSelections.checkInId, rows.map(r => r.c.id))).orderBy(asc(checkInSelections.position));
  return rows.map(r => checkInDoc(r.c, r.locationName, lines.filter(l => l.checkInId === r.c.id)));
}

export async function count(db: Db, filter: Loose | undefined): Promise<number> {
  const [row] = await (db as Db).select({ n: sql<number>`count(*)::int` }).from(officeCheckIns)
    .leftJoin(locations, eq(locations.id, officeCheckIns.locationId)).where(whereOf(filter));
  return row?.n ?? 0;
}

export async function list(db: Db, filter: Loose | undefined, skip: number, limit: number): Promise<Loose[]> {
  const rows = await selectCheckIns(db).where(whereOf(filter)).orderBy(desc(officeCheckIns.createdAt), desc(officeCheckIns.id))
    .offset(skip).limit(limit);
  return withLines(db, rows);
}

export async function newest(db: Db, filter: Loose | undefined): Promise<Loose | null> {
  return (await list(db, filter, 0, 1))[0] ?? null;
}

export async function find(db: Db, id: string): Promise<Document | null> {
  if (!mongoose.isValidObjectId(id) || String(id).length !== 24) {
    throw new mongoose.Error.CastError('ObjectId', id, '_id');
  }
  const rows = await selectCheckIns(db).where(eq(officeCheckIns.id, id.toLowerCase()));
  const doc = (await withLines(db, rows))[0];
  return doc ? OfficeCheckIn.hydrate(doc) as Document : null;
}

/** Write one check-in's row and lines (insert, or replace what is there). */
async function write(tx: Tx, plain: Loose, isNew: boolean) {
  const built = checkInRowsOf(plain, await referenceIndexOf(tx as unknown as Db), []);
  if (!built) throw new Error('That check-in can’t be stored: it has no id.');
  if (isNew) {
    await tx.insert(officeCheckIns).values(built.checkIn);
  } else {
    const { id: _id, createdAt: _created, ...columns } = built.checkIn;
    await tx.update(officeCheckIns).set(columns).where(eq(officeCheckIns.id, built.checkIn.id));
    await tx.delete(checkInSelections).where(eq(checkInSelections.checkInId, built.checkIn.id));
  }
  if (built.selections.length) await tx.insert(checkInSelections).values(built.selections);
}

export async function create(db: Db, data: Loose): Promise<Document> {
  const doc = new OfficeCheckIn(data);
  await doc.validate();
  const now = new Date();
  doc.set({ createdAt: now, updatedAt: now });
  await db.transaction(tx => write(tx, doc.toObject(), true));
  return doc;
}

export async function save(db: Db, doc: Document): Promise<void> {
  // Like Mongoose: nothing changed, nothing written, updatedAt stays.
  if (!doc.isModified()) return;
  await doc.validate();
  doc.set('updatedAt', new Date());
  await db.transaction(tx => write(tx, doc.toObject(), false));
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(officeCheckIns).where(and(eq(officeCheckIns.id, id.toLowerCase())));
}
