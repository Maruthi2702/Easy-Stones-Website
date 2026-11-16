/**
 * Locations on Postgres, answering and saving in MongoDB's shape. A save builds the record
 * as MongoDB would hold it, then makes the row with the copy's own builder (`referenceRows`),
 * so it writes what a re-copy would.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { locations, locationReportRecipients, users } from '../schema/reference.ts';
import { referenceRows } from '../copy/referenceRows.ts';
import { locationDoc, mergeRecord } from './locationDoc.ts';
import type { Loose } from '../../types/records.ts';
import type { Geocoder, SaveResult } from './locations.mongo.ts';

const isId = (v: string) => /^[0-9a-f]{24}$/.test(v);

async function docsOf(db: Db, where?: SQL): Promise<Loose[]> {
  const rows = await db.select().from(locations).where(where).orderBy(asc(locations.name));
  if (!rows.length) return [];
  const rec = await db.select().from(locationReportRecipients)
    .where(inArray(locationReportRecipients.locationId, rows.map(r => r.id))).orderBy(asc(locationReportRecipients.position));
  return rows.map(r => locationDoc(r, rec.filter(x => x.locationId === r.id).map(x => x.userId)));
}

export const locationsList = (db: Db) => docsOf(db);
export const locationNames = async (db: Db) => (await db.select({ name: locations.name }).from(locations).orderBy(asc(locations.name))).map(r => r.name);
export const locationBriefs = async (db: Db) =>
  (await db.select({ _id: locations.id, name: locations.name, shortCode: locations.shortCode }).from(locations));
export const locationByName = async (db: Db, name: string) => (await docsOf(db, eq(locations.name, name)))[0] ?? null;
export const locationByNameAnyCase = async (db: Db, name: string) =>
  (await docsOf(db, sql`lower(${locations.name}) = ${name.toLowerCase()}`))[0] ?? null;
export async function setDeliveryColumns(db: Db, name: string, columns: string[]) {
  const [l] = await db.update(locations).set({ deliveryColumns: columns, updatedAt: new Date() }).where(eq(locations.name, name))
    .returning({ name: locations.name, deliveryColumns: locations.deliveryColumns });
  return l ?? null;
}
export const locationById = async (db: Db, id: string) => (isId(id) ? (await docsOf(db, eq(locations.id, id)))[0] ?? null : null);

/** Row + recipients for a whole record; a recipient who isn't a user is left out, as the copy does. */
async function write(db: Db, doc: Loose, insert: boolean): Promise<void> {
  const { rows } = referenceRows({ locations: [doc], roles: [], users: [], visitTypes: [], resourceFamilies: [], resourceTypes: [] }, []);
  const [row] = rows.locations;
  if (!row) throw new Error('That location can’t be stored.');
  const ids: string[] = Array.isArray(doc.dailyReportEmail?.userIds) ? doc.dailyReportEmail.userIds.map(String) : [];
  const known = ids.length ? new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map(u => u.id)) : new Set<string>();
  const recipients = [...new Set(ids)].filter(id => known.has(id)).map((userId, position) => ({ locationId: row.id, userId, position }));
  await db.transaction(async tx => {
    if (insert) await tx.insert(locations).values(row);
    else {
      const { id: _id, createdAt: _c, ...columns } = row;
      await tx.update(locations).set(columns).where(eq(locations.id, row.id));
    }
    await tx.delete(locationReportRecipients).where(eq(locationReportRecipients.locationId, row.id));
    if (recipients.length) await tx.insert(locationReportRecipients).values(recipients);
  });
}

export async function createLocation(db: Db, id: string, record: Loose, by: string, geocode: Geocoder): Promise<SaveResult> {
  const now = new Date();
  const doc: Loose = {
    ...record, _id: id, editedBy: by, editedAt: now, createdAt: now, updatedAt: now,
    coordinates: { lat: null, lng: null }, geocode: { status: '', precision: '', formattedAddress: '', addressKey: '', updatedAt: null, error: '' }
  };
  await geocode(doc);
  try {
    await write(db, doc, true);
  } catch (err) {
    const code = (err as Loose)?.cause?.code ?? (err as Loose)?.code;
    if (code === '23505') return { ok: false, duplicate: true };
    throw err;
  }
  return { ok: true, location: doc };
}

export async function updateLocation(db: Db, id: string, record: Loose, by: string, geocode: Geocoder): Promise<Loose | null> {
  const current = await locationById(db, id);
  if (!current) return null;
  const doc = mergeRecord(current, { ...record, editedBy: by, editedAt: new Date() });
  doc.updatedAt = new Date();
  await geocode(doc);
  await write(db, doc, false);
  return doc;
}

export async function deleteLocation(db: Db, id: string): Promise<boolean> {
  const current = await locationById(db, id);
  if (!current) return false;
  await db.transaction(async tx => {
    await tx.delete(locations).where(eq(locations.id, id));
    await tx.update(locations).set({ rdc: '' }).where(eq(locations.rdc, current.name));
  });
  return true;
}
