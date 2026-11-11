/**
 * Calendar entry saves (Sales Planner, Route Planner, the Google / iCloud syncs):
 * MongoDB or Postgres by the area's switch (`DB_CUSTOMERS`, src/db/appDb.ts). Routes
 * and the syncs call these, never the twins directly. See ./README.md for the rules;
 * what each takes and answers is in ./scheduleTypes.ts. Sockets and the calls to
 * Google / Apple stay with the callers, after a save returns.
 */
import { appDb, areaOn } from '../../appDb.ts';
import * as mongo from './schedule.mongo.ts';
import * as pg from './schedule.postgres.ts';
import type { Loose } from '../../../types/records.ts';
import type { EntryFields, PlanDayInput, GoogleEventInput, ICloudEventInput, SyncIds, SyncSide } from './scheduleTypes.ts';

export type * from './scheduleTypes.ts';

const onPostgres = () => areaOn('customers') === 'postgres';

export async function createCalendarEntry(userId: string, id: string, fields: EntryFields, retry: boolean) {
  return onPostgres() ? pg.createCalendarEntry(await appDb(), userId, id, fields, retry) : mongo.createCalendarEntry(userId, id, fields, retry);
}

export async function planRouteDay(userId: string, input: PlanDayInput) {
  return onPostgres() ? pg.planRouteDay(await appDb(), userId, input) : mongo.planRouteDay(userId, input);
}

export async function clearPlannedDay(userId: string, date: string) {
  return onPostgres() ? pg.clearPlannedDay(await appDb(), userId, date) : mongo.clearPlannedDay(userId, date);
}

export async function updateCalendarEntry(userId: string, id: string, body: Loose) {
  return onPostgres() ? pg.updateCalendarEntry(await appDb(), userId, id, body) : mongo.updateCalendarEntry(userId, id, body);
}

export async function deleteCalendarEntry(userId: string, id: string) {
  return onPostgres() ? pg.deleteCalendarEntry(await appDb(), userId, id) : mongo.deleteCalendarEntry(userId, id);
}

export async function backfillCompletedEntries() {
  return onPostgres() ? pg.backfillCompletedEntries(await appDb()) : mongo.backfillCompletedEntries();
}

export async function importGoogleEvent(userId: string, event: GoogleEventInput, ids: SyncIds) {
  return onPostgres() ? pg.importGoogleEvent(await appDb(), userId, event, ids) : mongo.importGoogleEvent(userId, event, ids);
}

export async function importICloudEvent(userId: string, event: ICloudEventInput, ids: SyncIds) {
  return onPostgres() ? pg.importICloudEvent(await appDb(), userId, event, ids) : mongo.importICloudEvent(userId, event, ids);
}

export async function entriesToSync(userId: string, side: SyncSide) {
  return onPostgres() ? pg.entriesToSync(await appDb(), userId, side) : mongo.entriesToSync(userId, side);
}

export async function markEntrySynced(id: string, notes: string) {
  return onPostgres() ? pg.markEntrySynced(await appDb(), id, notes) : mongo.markEntrySynced(id, notes);
}
