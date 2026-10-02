/**
 * Keeps a rep's calendar (Schedule) in step with the visits they log.
 *
 * Logging a visit used to touch the calendar only when that customer was
 * already scheduled that day — the entry was marked Completed. A stop made on
 * the way, with nothing planned, left no trace on the calendar at all, so the
 * calendar showed the plan rather than the day. Now:
 *
 *   - the logger's own Scheduled entry for that customer and day is completed
 *     and linked to the visit, as before — but only the logger's: matching any
 *     rep's entry let one rep's visit tick off a colleague's planned stop;
 *   - otherwise a "drop-in" entry is added to the logger's calendar, already
 *     Completed, tagged source 'visit_log' so it can be told apart from a
 *     planned one (and so the route planner, which only ever replaces its own
 *     'route_planner' entries, can never clear it).
 *
 * Moving a visit to another day moves its entry; removing the visit removes a
 * drop-in, or puts a planned entry back to Scheduled. Only visits logged from
 * here on get entries — past visits are deliberately not backfilled.
 *
 * Shared by every route that creates, edits or removes a visit in server.js:
 * Add/Edit/Delete Visit, and Add/Edit/Delete Resource (a resource placement
 * writes its own visit, and is a stop like any other).
 */
import mongoose from 'mongoose';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import { branchNow } from '../config/branches.js';
import { YMD_RE } from '../utils/visitDates.js';

/** How long a drop-in occupies on the calendar. */
export const DROP_IN_MINUTES = 30;

/** Start time for a drop-in logged on a later day, when the real time isn't known. */
export const DROP_IN_DEFAULT_TIME = '12:00';

const pad = (n) => String(n).padStart(2, '0');

/**
 * When a drop-in starts, as the naive local string schedules are stored in
 * ('YYYY-MM-DDTHH:MM:SS.000', no zone — see localISO in SalesPlannerTab.jsx).
 * Logged the same day it happened → the time it was logged, on the logger's
 * own branch clock. Logged afterwards → DROP_IN_DEFAULT_TIME, since a visit
 * stores only a date.
 */
export const dropInStartTime = (visitDate, branch, now = new Date()) => {
  const { date, minutes } = branchNow(branch, now);
  const hhmm = date === visitDate
    ? `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
    : DROP_IN_DEFAULT_TIME;
  return `${visitDate}T${hhmm}:00.000`;
};

/**
 * A naive local time string plus `minutes`, worked in UTC parts so the
 * server's own timezone can't shift it. Past midnight rolls into the next day.
 */
export const addMinutesToLocal = (localTime, minutes) => {
  const [datePart, timePart = '00:00:00'] = String(localTime).split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi + minutes));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00.000`;
};

/** A resource placement is a drop-off; everything else logged is a visit. */
export const activityTypeForVisit = (purpose = '') =>
  (/^resource placement/i.test(String(purpose)) ? 'Drop-off' : 'Visit');

/**
 * Put a just-logged visit on the logger's calendar. `userId` is the staff
 * user who logged it; anything else (a customer login, a missing id) is
 * skipped, since only staff have calendars. `startTime` overrides the
 * computed start — used when a visit moves day and keeps its time of day.
 * `emit` is server.js's emitScheduleUpdate, so open calendars refresh live.
 */
export async function linkVisitToSchedule({ customerId, visitId, visitDate, userId, purpose, startTime, emit = () => {} }) {
  // visitDate goes into a startTime prefix $regex below: only ever a real date.
  if (!userId || !mongoose.isValidObjectId(userId) || !YMD_RE.test(String(visitDate || ''))) return null;

  const planned = await Schedule.findOneAndUpdate(
    { userId, customerId, status: 'Scheduled', startTime: { $regex: `^${visitDate}` } },
    { $set: { status: 'Completed', linkedVisitId: visitId } },
    { new: true }
  );
  if (planned) {
    emit({ type: 'upsert', userId: planned.userId, id: String(planned._id) });
    return planned;
  }

  const user = await User.findById(userId).select('location assignedLocations').lean();
  if (!user) return null;
  const branch = user.location || user.assignedLocations?.[0] || '';
  const start = startTime || dropInStartTime(visitDate, branch);

  const dropIn = await Schedule.create({
    userId,
    customerId,
    startTime: start,
    endTime: addMinutesToLocal(start, DROP_IN_MINUTES),
    activityType: activityTypeForVisit(purpose),
    notes: purpose || '',
    status: 'Completed',
    linkedVisitId: visitId,
    source: 'visit_log'
  });
  emit({ type: 'upsert', userId: dropIn.userId, id: String(dropIn._id) });
  return dropIn;
}

/**
 * Take a visit back off the calendar: its drop-in is deleted, and a planned
 * entry it had completed goes back to Scheduled (unlinked), as if the visit
 * had never been logged. Returns the deleted drop-in's start time, if any, so
 * a visit that's only moving day can keep its time of day.
 */
export async function unlinkVisitFromSchedule({ visitId, emit = () => {} }) {
  if (!visitId) return null;

  const dropIn = await Schedule.findOneAndDelete({ linkedVisitId: visitId, source: 'visit_log' });
  if (dropIn) emit({ type: 'delete', userId: dropIn.userId, id: String(dropIn._id) });

  const planned = await Schedule.find({ linkedVisitId: visitId, source: { $ne: 'visit_log' } }).select('_id userId').lean();
  if (planned.length) {
    await Schedule.updateMany(
      { _id: { $in: planned.map((p) => p._id) } },
      { $set: { status: 'Scheduled' }, $unset: { linkedVisitId: '' } }
    );
    for (const p of planned) emit({ type: 'upsert', userId: p.userId, id: String(p._id) });
  }

  return dropIn?.startTime || null;
}

/**
 * A visit moved to another day: off the old day, onto the new one, keeping
 * the drop-in's time of day when it had one. `userId` is the visit's original
 * logger (visit.createdBy), not whoever edited it — the entry belongs on the
 * calendar of the person who made the stop.
 */
export async function moveVisitOnSchedule({ customerId, visitId, newDate, userId, purpose, emit = () => {} }) {
  const oldStart = await unlinkVisitFromSchedule({ visitId, emit });
  const keptTime = oldStart ? `${newDate}T${String(oldStart).split('T')[1]}` : undefined;
  return linkVisitToSchedule({ customerId, visitId, visitDate: newDate, userId, purpose, startTime: keptTime, emit });
}
