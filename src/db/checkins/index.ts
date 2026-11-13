/**
 * The Check In page's data layer (and the Selection Sheet, which lives on the check-in): the
 * routes and the Daily Report's visitor count read and write check-ins through these, and each
 * picks MongoDB or Postgres by the area's switch (`DB_CHECKIN`, src/db/appDb.ts). Both answer
 * the same (checkins.parity.test.ts).
 *
 * Filters are MongoDB-style objects (src/routes/checkIn.ts builds them); filter.ts turns the
 * few shapes they use into SQL.
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './mongo.ts';
import * as pg from './postgres.ts';
import type OfficeCheckIn from '../../models/OfficeCheckIn.ts';
import type { Loose } from '../../types/records.ts';

type Document = InstanceType<typeof OfficeCheckIn>;
const onPostgres = () => areaOn('checkin') === 'postgres';

export async function countCheckIns(filter: Loose | undefined): Promise<number> {
  return onPostgres() ? pg.count(await appDb(), filter) : mongo.count(filter);
}

/** Newest first: `limit` of them after skipping `skip`. */
export async function listCheckIns(filter: Loose | undefined, skip: number, limit: number): Promise<Loose[]> {
  return onPostgres() ? pg.list(await appDb(), filter, skip, limit) : mongo.list(filter, skip, limit);
}

/** The newest check-in matching the filter (Postgres always answers every field). */
export async function newestCheckIn(filter: Loose | undefined, fields?: string): Promise<Loose | null> {
  return onPostgres() ? pg.newest(await appDb(), filter) : mongo.newest(filter, fields);
}

/** One check-in as a document to change and `saveCheckIn`; null when there is none. */
export async function findCheckIn(id: string): Promise<Document | null> {
  return onPostgres() ? pg.find(await appDb(), id) : mongo.find(id);
}

export async function createCheckIn(data: Loose): Promise<Document> {
  return onPostgres() ? pg.create(await appDb(), data) : mongo.create(data);
}

export async function saveCheckIn(checkIn: Document): Promise<void> {
  return onPostgres() ? pg.save(await appDb(), checkIn) : mongo.save(checkIn);
}

export async function deleteCheckIn(id: string): Promise<void> {
  return onPostgres() ? pg.remove(await appDb(), id) : mongo.remove(id);
}
