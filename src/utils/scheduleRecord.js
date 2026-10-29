/**
 * What a calendar entry (Schedule) may hold, shared by the server's write
 * routes (src/routes/schedule.js) and the schedule form. Pure, so it's tested
 * in scheduleRecord.test.js.
 *
 * Times are the stored local shape 'YYYY-MM-DDTHH:mm[:ss[.SSS]]' with no zone.
 * Only what a write sends is checked: older entries (a Google import carries a
 * zone) are never rejected for what they already hold.
 */

/** How long a booking with no end time is taken to last, and a new one defaults to. */
export const DEFAULT_VISIT_MINUTES = 30;

export const ACTIVITY_TYPES = ['Visit', 'Call', 'Drop-off', 'Other'];
export const STATUSES = ['Scheduled', 'Completed', 'Cancelled'];
export const NOTES_MAX = 2000;

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const isObjectId = (value) => typeof value === 'string' && OBJECT_ID.test(value);

/** Minutes since 1970 of a stored local time, or null when it isn't a real one. */
export const localMinutes = (value) => {
  const m = LOCAL_TIME.exec(String(value ?? ''));
  if (!m) return null;
  const [y, mo, d, h, mi, s = 0] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || s > 59) return null;
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // A 31st of a 30-day month rolls over: that isn't a real day.
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) return null;
  return at.getTime() / 60000;
};

const has = (body, key) => body[key] !== undefined && body[key] !== null && body[key] !== '';

/**
 * The fields a write may set, or the reason it can't.
 *
 * Creating (`existing` null): a customer and a start time are required, the
 * type defaults to Visit. Updating: only the fields sent are changed, and a
 * start sent alone is checked against the entry's stored end. Nothing else in
 * the body (userId, source, linkedVisitId) is ever copied.
 *
 * @returns {{ fields: Record<string, string> } | { error: string }}
 */
export const cleanScheduleFields = (body = {}, existing = null) => {
  const fields = {};

  if (has(body, 'customerId')) {
    if (!isObjectId(String(body.customerId))) return { error: 'That customer is not valid' };
    fields.customerId = String(body.customerId);
  } else if (!existing) {
    return { error: 'Pick a customer' };
  }

  if (has(body, 'startTime')) {
    if (localMinutes(body.startTime) === null) return { error: 'That start time is not a real date and time' };
    fields.startTime = String(body.startTime);
  } else if (!existing) {
    return { error: 'Pick a start time' };
  }

  if (has(body, 'endTime')) {
    if (localMinutes(body.endTime) === null) return { error: 'That end time is not a real date and time' };
    fields.endTime = String(body.endTime);
  }

  const start = localMinutes(fields.startTime ?? existing?.startTime);
  const end = localMinutes(fields.endTime ?? existing?.endTime);
  if (start !== null && end !== null && end <= start) return { error: 'The end has to be after the start' };

  if (body.activityType !== undefined) {
    if (!ACTIVITY_TYPES.includes(body.activityType)) return { error: `The type has to be ${ACTIVITY_TYPES.join(', ')}` };
    fields.activityType = body.activityType;
  } else if (!existing) {
    fields.activityType = 'Visit';
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return { error: 'Notes have to be text' };
    if (body.notes.length > NOTES_MAX) return { error: `Notes can be up to ${NOTES_MAX} characters` };
    fields.notes = body.notes;
  } else if (!existing) {
    fields.notes = '';
  }

  if (existing && body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { error: `The status has to be ${STATUSES.join(', ')}` };
    fields.status = body.status;
  }

  return { fields };
};
