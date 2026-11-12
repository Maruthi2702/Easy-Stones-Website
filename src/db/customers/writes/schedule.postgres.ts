/**
 * Calendar entry saves on Postgres. Each writes what the copy would make of the
 * MongoDB entry after the same save (src/db/copy/linkedRows.ts → schedules), and
 * answers what its MongoDB twin in schedule.mongo.ts answers
 * (schedule.parity.test.ts proves both). One transaction per save.
 *
 * Times: an entry's start / end are local clock strings. The copy keeps a local
 * string's clock as written and reads one with a zone (a Google or iCloud import) on
 * the rep's home branch's clock — `toLocalTime`, the copy's own converter, does both
 * here too. Ordinary replies use 'YYYY-MM-DDTHH:mm:ss.SSS'. Legacy source
 * spellings/types are retained separately for exact range matching and ICS feeds.
 */
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import { schedules, customers, visits } from '../../schema/customers.ts';
import { users, locations } from '../../schema/reference.ts';
import { toLocalTime } from '../../copy/values.ts';
import { customerRows } from '../../copy/customerRows.ts';
import { scheduleClockMetadata, scheduleOnDay, scheduleValidationClock } from '../scheduleStart.ts';
import { branchZone } from '../../../config/branches.ts';
import Customer from '../../../models/Customer.ts';
import { cleanScheduleFields } from '../../../utils/scheduleRecord.ts';
import type { Loose } from '../../../types/records.ts';
import type {
  EntryFields, CreateEntryResult, PlanDayInput, PlanDayResult, UpdateEntryResult, BackfillResult,
  GoogleEventInput, ICloudEventInput, SyncIds, SyncSide
} from './scheduleTypes.ts';

type Row = typeof schedules.$inferSelect;

/** An id as Mongoose casts it: 24 hex characters (any case), else a CastError, as MongoDB refuses it. */
function castId(value: unknown, path = '_id'): string {
  if (typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)) return value.toLowerCase();
  const error = new Error(`Cast to ObjectId failed for value "${String(value)}" at path "${path}" for model "Schedule"`);
  error.name = 'CastError';
  throw error;
}

/** '2026-10-30 09:00:00' (Postgres) → '2026-10-30T09:00:00.000' (what the app sends and reads). */
export function appLocalTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const [day, clock = '00:00:00'] = value.split(/[ T]/);
  const [hms, fraction = ''] = clock.split('.');
  return `${day}T${hms}.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

/** A sync compares the saved String path spelling, not merely the normalized clock. */
const sameSpelling = (legacy: Row['legacyStartTime'], stored: string | null, raw: unknown) =>
  scheduleValidationClock(legacy, appLocalTime(stored)) === raw;

/** A rep's clock: their home branch's (the copy's `zoneOfUser`). */
async function zoneOfUser(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ zone: locations.timeZone }).from(users)
    .innerJoin(locations, eq(locations.id, users.homeLocationId))
    .where(eq(users.id, userId)).limit(1);
  return row?.zone ?? 'America/Los_Angeles';
}

/** A time as the copy stores it (null for none). One the copy couldn't read is refused, not guessed. */
function localTime(value: unknown, zone: string): string | null {
  const result = toLocalTime(value, zone);
  if (!result.ok) throw new Error(`Calendar time not saved: ${result.reason}`);
  return result.value;
}

const customerExists = async (db: Db, id: unknown) =>
  (await db.select({ id: customers.id }).from(customers).where(eq(customers.id, castId(id, 'customerId'))).limit(1)).length > 0;

/** Entries as the routes answer them, the customer's name parts in `customerId`. */
async function readEntries(db: Db, where: SQL | undefined, order = false): Promise<Loose[]> {
  const query = db.select({ s: schedules, company: customers.company, contactName: customers.contactName })
    .from(schedules).leftJoin(customers, eq(customers.id, schedules.customerId)).where(where);
  const rows = order ? await query.orderBy(asc(schedules.startsAt), asc(schedules.id)) : await query;
  return rows.map(({ s, company, contactName }) => entryDoc(s, contactName == null ? null : { company, contactName }));
}

function entryDoc(s: Row, customer: { company: string | null; contactName: string } | null): Loose {
  return {
    _id: s.id,
    userId: s.userId,
    customerId: customer && s.customerId ? { _id: s.customerId, company: customer.company, contactName: customer.contactName, id: s.customerId } : null,
    startTime: appLocalTime(s.startsAt),
    endTime: appLocalTime(s.endsAt),
    activityType: s.activityType,
    notes: s.notes,
    status: s.status,
    linkedVisitId: s.visitId ?? undefined,
    source: s.source,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  };
}

const readEntry = async (db: Db, id: string) => (await readEntries(db, eq(schedules.id, id)))[0] ?? null;

/** The stored row's columns for the fields a write sets. */
function columnsFor(fields: EntryFields, zone: string): Partial<typeof schedules.$inferInsert> {
  const out: Partial<typeof schedules.$inferInsert> = {};
  if (fields.customerId !== undefined) out.customerId = castId(fields.customerId, 'customerId');
  if (fields.startTime !== undefined) {
    out.startsAt = localTime(fields.startTime, zone)!;
    out.legacyStartTime = scheduleClockMetadata(fields.startTime, out.startsAt);
  }
  if (fields.endTime !== undefined) {
    out.endsAt = localTime(fields.endTime, zone);
    out.legacyEndTime = scheduleClockMetadata(fields.endTime, out.endsAt);
  }
  if (fields.activityType !== undefined) out.activityType = fields.activityType;
  if (fields.notes !== undefined) out.notes = fields.notes ?? '';
  if (fields.status !== undefined) out.status = fields.status;
  return out;
}

/** POST /api/schedule. */
export async function createCalendarEntry(db: Db, userId: string, id: string, fields: EntryFields, retry: boolean): Promise<CreateEntryResult> {
  return db.transaction(async tx => {
    if (!(await customerExists(tx, fields.customerId))) return { kind: 'noCustomer' } as const;
    const alreadySaved = async (): Promise<CreateEntryResult | null> => {
      const existing = await readEntry(tx, id);
      if (!existing) return null;
      if (existing.userId !== String(userId)) return { kind: 'idTaken' };
      return { kind: 'alreadySaved', entry: existing };
    };
    if (retry) {
      const found = await alreadySaved();
      if (found) return found;
    }
    const zone = await zoneOfUser(tx, userId);
    const now = new Date();
    const inserted = await tx.insert(schedules).values({
      id: castId(id), userId: castId(userId, 'userId'), customerId: null, startsAt: '', ...columnsFor(fields, zone),
      createdAt: now, updatedAt: now
    } as typeof schedules.$inferInsert).onConflictDoNothing({ target: schedules.id }).returning({ id: schedules.id });
    if (!inserted.length) {
      // Two identical sends racing: the other one won, so answer with its entry.
      const found = retry ? await alreadySaved() : null;
      if (found) return found;
      throw new Error('That entry id is already saved');
    }
    return { kind: 'created', entry: await readEntry(tx, id) };
  });
}

/** The planner's own raw string-day prefix, as MongoDB's anchored regex matches it. */
const plannedOn = (userId: string, date: string) =>
  and(eq(schedules.userId, userId), eq(schedules.source, 'route_planner'), scheduleOnDay(date));

/** POST /api/schedule/bulk, from the one-stop repeat check on. */
export async function planRouteDay(db: Db, userId: string, input: PlanDayInput): Promise<PlanDayResult> {
  const { stops, replace, date, retry } = input;
  if (retry) {
    const existing = await readEntry(db, castId(stops[0].id));
    if (existing) {
      if (existing.userId !== String(userId)) return { kind: 'idTaken' };
      return { kind: 'alreadySaved', stops: [existing] };
    }
  }

  const wanted = [...new Set(stops.map(stop => castId(stop.fields.customerId, 'customerId')))];
  const known = await db.select({ id: customers.id }).from(customers).where(inArray(customers.id, wanted));
  if (known.length !== wanted.length) return { kind: 'unknownCustomer' };

  if (replace && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { kind: 'needDate' };
  if (replace && stops.some(stop => !String(stop.fields.startTime).startsWith(`${date}T`))) return { kind: 'offDate' };

  const owner = castId(userId, 'userId');
  return db.transaction(async tx => {
    let replaced = 0;
    if (replace) {
      replaced = (await tx.delete(schedules).where(plannedOn(owner, String(date))).returning({ id: schedules.id })).length;
    }
    const zone = await zoneOfUser(tx, owner);
    const now = new Date();
    const ids = stops.map(stop => castId(stop.id));
    await tx.insert(schedules).values(stops.map((stop, i) => ({
      id: ids[i], userId: owner, customerId: null, startsAt: '', ...columnsFor(stop.fields, zone),
      source: 'route_planner', createdAt: now, updatedAt: now
    } as typeof schedules.$inferInsert)));
    const saved = await readEntries(tx, inArray(schedules.id, ids), true);
    return { kind: 'saved', stops: saved, replaced, created: ids.length } as const;
  });
}

/** DELETE /api/schedule/route. */
export async function clearPlannedDay(db: Db, userId: string, date: string): Promise<number> {
  return db.transaction(async tx =>
    (await tx.delete(schedules).where(plannedOn(castId(userId, 'userId'), date)).returning({ id: schedules.id })).length);
}

/** PUT /api/schedule/:id. */
export async function updateCalendarEntry(db: Db, userId: string, id: string, body: Loose): Promise<UpdateEntryResult> {
  return db.transaction(async tx => {
    const owner = castId(userId, 'userId');
    const [row] = await tx.select().from(schedules)
      .where(and(eq(schedules.id, castId(id)), eq(schedules.userId, owner))).for('update');
    if (!row) return { kind: 'notFound' } as const;

    const { fields, error } = cleanScheduleFields(body, {
      startTime: scheduleValidationClock(row.legacyStartTime, appLocalTime(row.startsAt)),
      endTime: scheduleValidationClock(row.legacyEndTime, appLocalTime(row.endsAt))
    });
    if (error) return { kind: 'invalid', message: error } as const;
    if (fields!.customerId && !(await customerExists(tx, fields!.customerId))) return { kind: 'noCustomer' } as const;

    await tx.update(schedules)
      .set({ ...columnsFor(fields!, await zoneOfUser(tx, owner)), updatedAt: new Date() })
      .where(eq(schedules.id, row.id));
    return { kind: 'updated', entry: await readEntry(tx, row.id) } as const;
  });
}

/** DELETE /api/schedule/:id. */
export async function deleteCalendarEntry(db: Db, userId: string, id: string): Promise<boolean> {
  return db.transaction(async tx => {
    const gone = await tx.delete(schedules)
      .where(and(eq(schedules.id, castId(id)), eq(schedules.userId, castId(userId, 'userId'))))
      .returning({ id: schedules.id });
    return gone.length > 0;
  });
}

/** POST /api/admin/schedule/backfill-completed: one transaction per entry, as MongoDB saves each alone. */
export async function backfillCompletedEntries(db: Db): Promise<BackfillResult> {
  const pending = await db.select({ id: schedules.id, customerId: schedules.customerId, startsAt: schedules.startsAt, legacyStartTime: schedules.legacyStartTime })
    .from(schedules).where(eq(schedules.status, 'Scheduled')).orderBy(asc(schedules.id));
  const linked: BackfillResult['linked'] = [];
  for (const entry of pending) {
    if (!entry.customerId) continue;
    // A hydrated legacy BSON Date becomes Date.toString(), whose first ten characters are not a visit day.
    if (entry.legacyStartTime?.kind === 'date') continue;
    const day = (entry.legacyStartTime?.value ?? entry.startsAt).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const [visit] = await db.select({ id: visits.id }).from(visits)
      .where(and(eq(visits.customerId, entry.customerId), eq(visits.visitDate, day)))
      .orderBy(asc(visits.position)).limit(1);
    if (!visit) continue;
    const updated = await db.transaction(tx => tx.update(schedules)
      .set({ status: 'Completed', visitId: visit.id, updatedAt: new Date() })
      .where(and(eq(schedules.id, entry.id), eq(schedules.status, 'Scheduled')))
      .returning({ id: schedules.id, userId: schedules.userId }));
    if (updated.length) linked.push({ id: updated[0].id, userId: updated[0].userId });
  }
  return { checked: pending.length, linked };
}

/* ---- Google Calendar / iCloud sync ---- */

const SYNC_CUSTOMERS = {
  google: { company: 'Google Calendar Sync', contactName: 'Google Event Sync', email: 'sync@easystones.com' },
  icloud: { company: 'iCloud Calendar Sync', contactName: 'iCloud Event Sync', email: 'icloud-sync@easystones.com' }
} as const;

/**
 * The sync's stand-in customer, made the first time it's needed: the row the copy
 * would make of the MongoDB customer the sync saves (the model's defaults included —
 * read from a new, unsaved document, never from MongoDB).
 */
async function syncCustomerId(db: Db, side: SyncSide, customerId: string): Promise<string> {
  const names = SYNC_CUSTOMERS[side];
  const [found] = await db.select({ id: customers.id }).from(customers)
    .where(eq(customers.company, names.company)).orderBy(asc(customers.id)).limit(1);
  if (found) return found.id;

  const now = new Date();
  const made = new Customer({ _id: customerId, ...names, phone: '000-000-0000', status: 'Lead' });
  await made.validate(); // refused exactly as MongoDB's save refuses it
  const doc = made.toObject({ virtuals: false, depopulate: true });
  Object.assign(doc, { createdAt: now, updatedAt: now });
  const branches = await db.select({ id: locations.id, name: locations.name }).from(locations);
  const problems: Parameters<typeof customerRows>[2] = [];
  const { rows } = customerRows([doc], {
    locationIdByName: new Map(branches.map(b => [b.name, b.id])), zoneOfLocation: name => branchZone(String(name ?? '')),
    userIds: new Set(), zoneOfUser: () => branchZone(''), resourceTypeNames: new Set(), visitTypeNames: new Set()
  }, problems);
  if (rows.customers.length !== 1) throw new Error(`The ${names.company} customer could not be saved: ${problems.map(p => p.reason).join('; ')}`);
  await db.insert(customers).values(rows.customers[0]);
  return customerId;
}

/** The newest-first-free import with this tag in its notes (MongoDB's `findOne` with a RegExp). */
async function importTagged(db: Db, userId: string, pattern: string): Promise<Row | null> {
  const [row] = await db.select().from(schedules)
    .where(and(eq(schedules.userId, userId), sql`${schedules.notes} ~ ${pattern}`))
    .orderBy(asc(schedules.id)).limit(1);
  return row ?? null;
}

/** Google → Sales Planner, one event. */
export async function importGoogleEvent(db: Db, userId: string, gEvent: GoogleEventInput, ids: SyncIds): Promise<boolean> {
  return db.transaction(async tx => {
    const owner = castId(userId, 'userId');
    const existingImport = await importTagged(tx, owner, `Google ID: ${gEvent.id}`);

    if (gEvent.status === 'cancelled') {
      if (!existingImport) return false;
      await tx.delete(schedules).where(eq(schedules.id, existingImport.id));
      return true;
    }

    const { startTime, endTime } = gEvent;
    if (!startTime) return false;
    const zone = await zoneOfUser(tx, owner);
    const notes = `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`;
    const startsAt = localTime(startTime, zone)!;
    const endsAt = localTime(endTime, zone);

    if (existingImport) {
      if (sameSpelling(existingImport.legacyStartTime, existingImport.startsAt, startTime) && sameSpelling(existingImport.legacyEndTime, existingImport.endsAt, endTime) && existingImport.notes === notes) return false;
      await tx.update(schedules).set({ startsAt, legacyStartTime: scheduleClockMetadata(startTime, startsAt), endsAt, legacyEndTime: scheduleClockMetadata(endTime, endsAt), notes, updatedAt: new Date() }).where(eq(schedules.id, existingImport.id));
      return true;
    }

    const now = new Date();
    await tx.insert(schedules).values({
      id: castId(ids.entryId), userId: owner, customerId: await syncCustomerId(tx, 'google', castId(ids.customerId)),
      startsAt, legacyStartTime: scheduleClockMetadata(startTime, startsAt), endsAt, legacyEndTime: scheduleClockMetadata(endTime, endsAt), activityType: 'Other', notes, status: 'Scheduled', createdAt: now, updatedAt: now
    });
    return true;
  });
}

/** iCloud → Sales Planner, one event. true only when a new entry was added (as the sync always answered). */
export async function importICloudEvent(db: Db, userId: string, event: ICloudEventInput, ids: SyncIds): Promise<boolean> {
  return db.transaction(async tx => {
    const owner = castId(userId, 'userId');
    const existingImport = await importTagged(tx, owner, `iCloud ID: ${event.uid}`);
    if (!event.startTime) return false;

    const zone = await zoneOfUser(tx, owner);
    const notes = `iCloud Event\n[iCloud ID: ${event.uid}]\n\n${event.description || ''}`;
    const startsAt = localTime(event.startTime.toISOString(), zone)!;
    const endsAt = localTime((event.endTime ?? event.startTime).toISOString(), zone);

    if (existingImport) {
      // MongoDB saves only what changed, and nothing (not even updatedAt) when nothing did.
      if (!sameSpelling(existingImport.legacyStartTime, existingImport.startsAt, event.startTime.toISOString()) || !sameSpelling(existingImport.legacyEndTime, existingImport.endsAt, (event.endTime ?? event.startTime).toISOString()) || existingImport.notes !== notes) {
        await tx.update(schedules).set({ startsAt, legacyStartTime: scheduleClockMetadata(event.startTime.toISOString(), startsAt), endsAt, legacyEndTime: scheduleClockMetadata((event.endTime ?? event.startTime).toISOString(), endsAt), notes, updatedAt: new Date() }).where(eq(schedules.id, existingImport.id));
      }
      return false;
    }

    const now = new Date();
    await tx.insert(schedules).values({
      id: castId(ids.entryId), userId: owner, customerId: await syncCustomerId(tx, 'icloud', castId(ids.customerId)),
      startsAt, legacyStartTime: scheduleClockMetadata(event.startTime.toISOString(), startsAt), endsAt, legacyEndTime: scheduleClockMetadata((event.endTime ?? event.startTime).toISOString(), endsAt), activityType: 'Other', notes, status: 'Scheduled', createdAt: now, updatedAt: now
    });
    return true;
  });
}

/** Sales Planner → Google / iCloud: the entries to send out. */
export async function entriesToSync(db: Db, userId: string, side: SyncSide): Promise<Loose[]> {
  const tag = side === 'google' ? 'Google ID:' : 'iCloud ID:';
  return readEntries(db, and(eq(schedules.userId, castId(userId, 'userId')),
    sql`${schedules.notes} !~ ${tag}`, ne(schedules.status, 'Cancelled')), true);
}

/** Note on an entry that it now has a copy on the other calendar. */
export async function markEntrySynced(db: Db, id: string, notes: string): Promise<void> {
  await db.transaction(async tx => {
    const done = await tx.update(schedules).set({ notes, updatedAt: new Date() })
      .where(eq(schedules.id, castId(id))).returning({ id: schedules.id });
    if (!done.length) throw new Error(`No document found for query "{ _id: ${id} }" on model "Schedule"`);
  });
}
