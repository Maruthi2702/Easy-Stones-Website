/**
 * Calendar entry saves on MongoDB: src/routes/schedule.ts's and the calendar syncs'
 * own code (src/services/icloudSyncService.ts, the Google sync in schedule.ts),
 * moved here unchanged. Its Postgres twin is schedule.postgres.ts; pick between them
 * through schedule.ts.
 */
import mongoose from 'mongoose';
import Schedule from '../../../models/Schedule.ts';
import Customer, { type CustomerData } from '../../../models/Customer.ts';
import type { Loose } from '../../../types/records.ts';
import type {
  EntryFields, CreateEntryResult, PlanDayInput, PlanDayResult, UpdateEntryResult, BackfillResult,
  GoogleEventInput, ICloudEventInput, SyncIds, SyncSide
} from './scheduleTypes.ts';
import { cleanScheduleFields } from '../../../utils/scheduleRecord.ts';

type Populated = { customerId: Pick<CustomerData, 'company' | 'contactName'> | null };
const populate = (id: unknown) => Schedule.findById(id).populate<Populated>('customerId', 'contactName company');

/** POST /api/schedule. `retry`: the client sent its own id, so a repeat answers with what it saved. */
export async function createCalendarEntry(userId: string, id: string, fields: EntryFields, retry: boolean): Promise<CreateEntryResult> {
  if (!(await Customer.exists({ _id: fields.customerId }))) return { kind: 'noCustomer' };

  const alreadySaved = async (): Promise<CreateEntryResult | null> => {
    const existing = await populate(id);
    if (!existing) return null;
    if (String(existing.userId) !== String(userId)) return { kind: 'idTaken' };
    return { kind: 'alreadySaved', entry: existing.toObject() };
  };
  if (retry) {
    const found = await alreadySaved();
    if (found) return found;
  }

  const created = new Schedule({ _id: id, userId, ...fields });
  try {
    await created.save();
  } catch (saveError) {
    // Two identical sends racing: the other one won, so answer with its entry.
    if ((saveError as Error & Loose)?.code === 11000 && retry) {
      const found = await alreadySaved();
      if (found) return found;
    }
    throw saveError;
  }
  return { kind: 'created', entry: await populate(created._id) };
}

/** POST /api/schedule/bulk, from the one-stop repeat check on. */
export async function planRouteDay(userId: string, input: PlanDayInput): Promise<PlanDayResult> {
  const { stops, replace, date, retry } = input;
  if (retry) {
    const existing = await populate(stops[0].id);
    if (existing) {
      if (String(existing.userId) !== String(userId)) return { kind: 'idTaken' };
      return { kind: 'alreadySaved', stops: [existing] };
    }
  }

  const wanted = stops.map(stop => stop.fields.customerId);
  const known = await Customer.find({ _id: { $in: wanted } }).select('_id').lean();
  if (known.length !== new Set(wanted.map(String)).size) return { kind: 'unknownCustomer' };

  if (replace && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { kind: 'needDate' };

  const documents = stops.map(stop => new Schedule({
    _id: stop.id,
    userId,
    ...stop.fields,
    source: 'route_planner'
  }));
  // insertMany's validation occurs after the old plan would be deleted.
  // Do it now as well, returning bad input without starting a transaction.
  await Promise.all(documents.map(document => document.validate()));
  if (replace && documents.some(document => !document.startTime.startsWith(`${date}T`))) return { kind: 'offDate' };

  let replaced = 0;
  let created!: Loose;
  await mongoose.connection.transaction(async session => {
    replaced = 0; // A transient transaction failure may retry this callback.
    if (replace) {
      const result = await Schedule.deleteMany({
        userId,
        source: 'route_planner',
        startTime: { $regex: `^${date}` }
      }, { session });
      replaced = result.deletedCount;
    }
    created = await Schedule.insertMany(documents, { ordered: true, session });
  });

  const populated = await Schedule.find({ _id: { $in: created.map((item: Loose) => item._id) } })
    .populate<Populated>('customerId', 'contactName company')
    .sort({ startTime: 1 });
  return { kind: 'saved', stops: populated, replaced, created: created.length };
}

/** DELETE /api/schedule/route: the route planner's own stops on that day. */
export async function clearPlannedDay(userId: string, date: string): Promise<number> {
  const { deletedCount } = await Schedule.deleteMany({
    userId,
    source: 'route_planner',
    startTime: { $regex: `^${date}` }
  });
  return deletedCount;
}

/** PUT /api/schedule/:id: only the signed-in person's own entry. */
export async function updateCalendarEntry(userId: string, id: string, body: Loose): Promise<UpdateEntryResult> {
  const existing = await Schedule.findOne({ _id: id, userId }).lean();
  if (!existing) return { kind: 'notFound' };

  const { fields, error } = cleanScheduleFields(body, existing);
  if (error) return { kind: 'invalid', message: error };
  if (fields!.customerId && !(await Customer.exists({ _id: fields!.customerId }))) return { kind: 'noCustomer' };

  const item = await Schedule.findOneAndUpdate(
    { _id: id, userId },
    { $set: fields },
    { new: true }
  ).populate<Populated>('customerId', 'contactName company');
  return item ? { kind: 'updated', entry: item } : { kind: 'notFound' };
}

/** DELETE /api/schedule/:id. false = not this person's, or no such entry. */
export async function deleteCalendarEntry(userId: string, id: string): Promise<boolean> {
  const result = await Schedule.deleteOne({ _id: id, userId });
  return result.deletedCount !== 0;
}

/** POST /api/admin/schedule/backfill-completed. */
export async function backfillCompletedEntries(): Promise<BackfillResult> {
  const pending = await Schedule.find({ status: 'Scheduled' }).select('_id customerId startTime userId');
  const linked: { id: string; userId: string }[] = [];
  for (const entry of pending) {
    const day = String(entry.startTime).slice(0, 10);
    const customerWithVisit = await Customer.findOne(
      { _id: entry.customerId, 'visits.date': day },
      { 'visits.$': 1 }
    ).lean();
    const visit = customerWithVisit?.visits?.[0];
    if (!visit) continue;

    const updated = await Schedule.findOneAndUpdate(
      { _id: entry._id, status: 'Scheduled' },
      { $set: { status: 'Completed', linkedVisitId: visit._id } },
      { new: true }
    );
    if (updated) linked.push({ id: String(updated._id), userId: String(updated.userId) });
  }
  return { checked: pending.length, linked };
}

/* ---- Google Calendar / iCloud sync: the database half of each step ---- */

/** The sync's stand-in customer for imported events, made the first time it's needed. */
async function syncCustomerId(side: SyncSide, customerId: string) {
  const names = side === 'google'
    ? { company: 'Google Calendar Sync', contactName: 'Google Event Sync', email: 'sync@easystones.com' }
    : { company: 'iCloud Calendar Sync', contactName: 'iCloud Event Sync', email: 'icloud-sync@easystones.com' };
  let syncCustomer = await Customer.findOne({ company: names.company });
  if (!syncCustomer) {
    syncCustomer = new Customer({
      _id: customerId,
      company: names.company,
      contactName: names.contactName,
      phone: '000-000-0000',
      email: names.email,
      status: 'Lead'
    });
    await syncCustomer.save();
  }
  return syncCustomer._id;
}

/** One Google event into the planner (Google → Sales Planner). true = the planner changed. */
export async function importGoogleEvent(userId: string, gEvent: GoogleEventInput, ids: SyncIds): Promise<boolean> {
  const existingImport = await Schedule.findOne({
    userId,
    notes: new RegExp(`Google ID: ${gEvent.id}`)
  });

  if (gEvent.status === 'cancelled') {
    if (existingImport) {
      await Schedule.deleteOne({ _id: existingImport._id });
      return true;
    }
    return false;
  }

  const { startTime, endTime } = gEvent;
  if (!startTime) return false;

  if (existingImport) {
    const notes = `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`;
    if (
      String(existingImport.startTime) !== String(startTime) ||
      String(existingImport.endTime) !== String(endTime) ||
      existingImport.notes !== notes
    ) {
      existingImport.startTime = startTime;
      existingImport.endTime = endTime;
      existingImport.notes = notes;
      await existingImport.save();
      return true;
    }
    return false;
  }

  const newItem = new Schedule({
    _id: ids.entryId,
    userId,
    customerId: await syncCustomerId('google', ids.customerId),
    startTime,
    endTime,
    activityType: 'Other',
    notes: `Google Calendar Event\n[Google ID: ${gEvent.id}]\n\n${gEvent.description || ''}`,
    status: 'Scheduled'
  });
  await newItem.save();
  return true;
}

/** One iCloud event into the planner (iCloud → Sales Planner). true = a new entry was added. */
export async function importICloudEvent(userId: string, event: ICloudEventInput, ids: SyncIds): Promise<boolean> {
  const existingImport = await Schedule.findOne({
    userId,
    notes: new RegExp(`iCloud ID: ${event.uid}`)
  });

  if (!event.startTime) return false;

  if (existingImport) {
    existingImport.startTime = event.startTime.toISOString();
    existingImport.endTime = event.endTime ? event.endTime.toISOString() : event.startTime.toISOString();
    existingImport.notes = `iCloud Event\n[iCloud ID: ${event.uid}]\n\n${event.description || ''}`;
    await existingImport.save();
    return false;
  }

  const newItem = new Schedule({
    _id: ids.entryId,
    userId,
    customerId: await syncCustomerId('icloud', ids.customerId),
    startTime: event.startTime.toISOString(),
    endTime: event.endTime ? event.endTime.toISOString() : event.startTime.toISOString(),
    activityType: 'Other',
    notes: `iCloud Event\n[iCloud ID: ${event.uid}]\n\n${event.description || ''}`,
    status: 'Scheduled'
  });
  await newItem.save();
  return true;
}

/** The planner's own entries to send out (Sales Planner → Google / iCloud): not imported from that side, not cancelled. */
export async function entriesToSync(userId: string, side: SyncSide): Promise<Loose[]> {
  return Schedule.find({
    userId,
    notes: { $not: side === 'google' ? /Google ID:/ : /iCloud ID:/ },
    status: { $ne: 'Cancelled' }
  }).populate<Populated>('customerId', 'contactName company');
}

/** Note on an entry that it now has a copy on the other calendar (its notes as the sync wrote them). */
export async function markEntrySynced(id: string, notes: string): Promise<void> {
  const schedule = await Schedule.findById(id);
  // The sync used to save the entry it had read: gone by now is the same failure.
  if (!schedule) throw new Error(`No document found for query "{ _id: ${id} }" on model "Schedule"`);
  schedule.notes = notes;
  await schedule.save();
}
