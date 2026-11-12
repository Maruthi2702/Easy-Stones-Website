/**
 * Visit saves on Postgres. Each writes what the copy would make of the MongoDB record
 * after the same save (src/db/copy/customerRows.ts: visits, attachments, reactions,
 * follow-up history; linkedRows.ts: schedules and the log) and answers what its twin in
 * visits.mongo.ts answers (visits.parity.test.ts proves both).
 *
 * One transaction per save: the visit, its parts, the calendar entry it completes /
 * adds / moves, and the activity-log line. Open calendars are told after the commit
 * (`afterAnswer`).
 */
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import {
  customers, visits, visitAttachments, visitReactions, visitFollowUpEvents, resources, schedules
} from '../../schema/customers.ts';
import { users, locations, userLocations, visitTypes } from '../../schema/reference.ts';
import { toLocalTime } from '../../copy/values.ts';
import { attachmentUrls } from '../../copy/customerRows.ts';
import { isId } from '../../ids.ts';
import type { Loose } from '../../../types/records.ts';
import { scheduleOnDay } from '../scheduleStart.ts';
import { insertActivityLog } from './activityLog.ts';
import type { ActivityEntry } from './activityLog.ts';
import {
  dropInStartTime, addMinutesToLocal, activityTypeForVisit, DROP_IN_MINUTES
} from '../../../services/visitSchedule.ts';
import { YMD_RE } from '../../../utils/visitDates.ts';
import type {
  AddVisitInput, AddVisitResult, EditVisitInput, AfterAnswer, FollowUpInput, ReactionInput,
  ReactionResult, ScheduleEvent, VisitLogLine
} from './visits.types.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The clock local strings are read on when they carry a real instant (they never do: the app writes local strings). */
const ZONE = 'America/Los_Angeles';

/** Mongoose casts a value to text; a list or an object is refused. null / undefined store nothing. */
function text(value: unknown, field: string): string {
  if (value == null) return '';
  if (typeof value === 'object') throw new Error(`Cast to string failed for ${field}`);
  return String(value);
}

/** A local clock string as the column holds it, or null. */
function localOf(value: unknown): string | null {
  const r = toLocalTime(value, ZONE);
  return r.ok ? r.value : null;
}

/** Back to the app's own form, 'YYYY-MM-DDTHH:MM:SS.mmm'. */
const appTime = (v: string | null) => {
  if (v == null) return undefined;
  const t = v.replace(' ', 'T');
  // The column drops a zero fraction ('…:00'); the app writes '…:00.000'.
  return /\.\d+$/.test(t) ? t.padEnd(t.indexOf('.') + 4, '0') : `${t}.000`;
};

/** Mongoose stamps the customer's updatedAt on every save that touches one of its visits. */
const touchCustomer = (tx: Tx, customerId: string) =>
  tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, customerId));

/** A day column from what the app sends ('' = none). */
const dayOrNull = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 10));

/** Who a stored id is: a user, else a customer (a visit can be logged by either), else nobody. */
async function whoIs(tx: Tx, raw: unknown): Promise<{ userId: string | null; customerId: string | null }> {
  const id = raw == null ? null : String(raw).toLowerCase();
  if (!id || !isId(id)) return { userId: null, customerId: null };
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (u) return { userId: id, customerId: null };
  const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, id));
  return c ? { userId: null, customerId: id } : { userId: null, customerId: null };
}

const logEntry = (
  line: VisitLogLine, e: Pick<ActivityEntry, 'entityId' | 'customerId' | 'action' | 'timestamp'>
): ActivityEntry => ({
  ...line, entityType: 'Visit', performedByRole: (line.performedByRole ?? null) as ActivityEntry['performedByRole'],
  details: line.details ?? null, ...e
});

/** The visit as MongoDB sends it (the lean visit), from its rows. */
async function visitDoc(tx: Tx, id: string): Promise<Loose | null> {
  const [v] = await tx.select().from(visits).where(eq(visits.id, id));
  if (!v) return null;
  const [files, reactions, events, placed] = await Promise.all([
    tx.select().from(visitAttachments).where(eq(visitAttachments.visitId, id)).orderBy(asc(visitAttachments.position)),
    tx.select().from(visitReactions).where(eq(visitReactions.visitId, id)).orderBy(asc(visitReactions.position)),
    tx.select().from(visitFollowUpEvents).where(eq(visitFollowUpEvents.visitId, id)).orderBy(asc(visitFollowUpEvents.position)),
    tx.select({ id: resources.id }).from(resources).where(eq(resources.placementVisitId, id))
  ]);
  const doc: Loose = {
    _id: v.id,
    resourceId: placed[0]?.id ?? null,
    date: v.visitDate,
    purpose: v.visitType,
    notes: v.notes,
    outcome: v.outcome,
    followUp: v.followUp,
    followUpDate: v.followUpDate ?? '',
    followUpDoneAt: appTime(v.followUpDoneAt) ?? '',
    followUpDoneOn: v.followUpDoneOn ?? '',
    followUpDoneBy: v.followUpDoneById ?? '',
    followUpDoneByName: v.followUpDoneByName,
    followUpOutcome: v.followUpOutcome,
    followUpHistory: events.map(e => ({
      action: e.action, at: appTime(e.at), on: e.onDay ?? '', by: e.byId ?? '', byName: e.byName,
      from: e.fromDay ?? '', to: e.toDay ?? ''
    })),
    managerComment: v.managerComment,
    headquartersComment: v.headquartersComment,
    image: files.map(f => f.url),
    createdBy: v.createdById ?? v.createdByCustomerId ?? '',
    createdByName: v.createdByName,
    customerContactName: v.customerContactName,
    reactions: reactions.map(r => ({
      _id: r.id, type: r.type, userId: r.userId ?? r.customerId ?? '', userName: r.userName, createdAt: appTime(r.createdAt)
    })),
    createdAt: appTime(v.createdAt),
    updatedBy: v.updatedById ?? v.updatedByCustomerId ?? '',
    updatedByName: v.updatedByName,
    updatedAt: appTime(v.updatedAt) ?? ''
  };
  return doc;
}

/** One visit of this customer, as stored, or null. */
export async function findVisit(db: Db, customerId: string, visitId: string): Promise<Loose | null> {
  if (!isId(customerId) || !isId(visitId)) return null;
  const [row] = await db.select({ id: visits.id }).from(visits)
    .where(and(eq(visits.id, visitId), eq(visits.customerId, customerId)));
  return row ? db.transaction(tx => visitDoc(tx, visitId)) : null;
}

/** The customer a new visit is logged on (its name goes on the visit), or null. */
export async function visitCustomer(db: Db, customerId: string): Promise<Loose | null> {
  if (!isId(customerId)) return null;
  const [c] = await db.select({ company: customers.company, contactName: customers.contactName })
    .from(customers).where(eq(customers.id, customerId));
  return c ?? null;
}

/** A reacting customer's name (contactName || email), or null when there is no such customer. */
export async function reactorCustomerName(db: Db, customerId: string): Promise<string | null> {
  if (!isId(customerId)) return null;
  const [c] = await db.select({ contactName: customers.contactName, email: customers.email })
    .from(customers).where(eq(customers.id, customerId));
  return c ? (c.contactName || c.email) : null;
}

/** The visit type of that name in the shape the form rules read (`fields`), or null. */
export async function visitTypeByName(db: Db, name: string): Promise<Loose | null> {
  const [t] = await db.select().from(visitTypes).where(eq(visitTypes.name, name));
  if (!t) return null;
  return {
    name: t.name, label: t.label, active: t.active, system: t.system, order: t.sortOrder,
    fields: { notes: t.usesNotes, outcome: t.usesOutcome, followUp: t.followUp }
  };
}

/* ---- The calendar entry a visit save creates or moves (src/services/visitSchedule.ts) ---- */

const startOf = (v: string) => v.replace(' ', 'T');

/** Complete the logger's own Scheduled entry that day, else add a drop-in already Completed. */
async function linkToSchedule(tx: Tx, o: {
  customerId: string; visitId: string; visitDate: string; userId: unknown; purpose?: unknown;
  startTime?: string; dropInId: string; events: ScheduleEvent[];
}): Promise<void> {
  const uid = o.userId == null ? '' : String(o.userId).toLowerCase();
  if (!uid || !isId(uid) || !YMD_RE.test(String(o.visitDate || ''))) return;

  const [planned] = await tx.select().from(schedules)
    .where(and(
      eq(schedules.userId, uid), eq(schedules.customerId, o.customerId), eq(schedules.status, 'Scheduled'),
      scheduleOnDay(o.visitDate)
    ))
    .orderBy(asc(schedules.startsAt), asc(schedules.id)).limit(1);
  if (planned) {
    await tx.update(schedules).set({ status: 'Completed', visitId: o.visitId, updatedAt: new Date() })
      .where(eq(schedules.id, planned.id));
    o.events.push({ type: 'upsert', userId: planned.userId, id: planned.id });
    return;
  }

  const [user] = await tx.select({ home: locations.name }).from(users)
    .leftJoin(locations, eq(locations.id, users.homeLocationId)).where(eq(users.id, uid));
  if (!user) return;
  let branch = user.home || '';
  if (!branch) {
    const [first] = await tx.select({ name: locations.name }).from(userLocations)
      .innerJoin(locations, eq(locations.id, userLocations.locationId))
      .where(eq(userLocations.userId, uid)).orderBy(asc(locations.name)).limit(1);
    branch = first?.name || '';
  }
  const start = o.startTime || dropInStartTime(o.visitDate, branch);
  const purpose = o.purpose == null ? '' : String(o.purpose);
  await tx.insert(schedules).values({
    id: o.dropInId, userId: uid, customerId: o.customerId,
    startsAt: localOf(start)!, endsAt: localOf(addMinutesToLocal(start, DROP_IN_MINUTES)),
    activityType: activityTypeForVisit(purpose), notes: purpose, status: 'Completed',
    visitId: o.visitId, source: 'visit_log', createdAt: new Date(), updatedAt: new Date()
  });
  o.events.push({ type: 'upsert', userId: uid, id: o.dropInId });
}

/** Take a visit back off the calendar; the deleted drop-in's start (for a move to keep its time of day). */
async function unlinkFromSchedule(tx: Tx, visitId: string, events: ScheduleEvent[]): Promise<string | null> {
  const [dropIn] = await tx.select().from(schedules)
    .where(and(eq(schedules.visitId, visitId), eq(schedules.source, 'visit_log')))
    .orderBy(asc(schedules.id)).limit(1);
  if (dropIn) {
    await tx.delete(schedules).where(eq(schedules.id, dropIn.id));
    events.push({ type: 'delete', userId: dropIn.userId, id: dropIn.id });
  }
  const planned = await tx.select({ id: schedules.id, userId: schedules.userId }).from(schedules)
    .where(and(eq(schedules.visitId, visitId), ne(schedules.source, 'visit_log')));
  for (const p of planned) {
    await tx.update(schedules).set({ status: 'Scheduled', visitId: null, updatedAt: new Date() }).where(eq(schedules.id, p.id));
    events.push({ type: 'upsert', userId: p.userId, id: p.id });
  }
  return dropIn ? startOf(dropIn.startsAt) : null;
}

const emitAll = (events: ScheduleEvent[]): AfterAnswer => async emit => { for (const e of events) emit(e); };

/* ---- The saves ---- */

/** POST /api/customers/:customerId/visits — the write, after the route's checks. */
export async function addVisit(db: Db, { customerId, visit, calendar, log, now }: AddVisitInput): Promise<AddVisitResult> {
  const visitId = String(visit._id).toLowerCase();
  return db.transaction(async tx => {
    const events: ScheduleEvent[] = [];
    const [customer] = isId(customerId) ? await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)) : [];
    if (!customer) return { kind: 'notFound' as const };
    const same = async () => {
      const [row] = await tx.select({ id: visits.id }).from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.customerId, customerId)));
      return row ? visitDoc(tx, visitId) : null;
    };
    const existing = await same();
    if (existing) return { kind: 'alreadySaved' as const, visit: existing };

    const date = String(visit.date);
    const by = await whoIs(tx, visit.createdBy);
    const [{ n }] = await tx.select({ n: count() }).from(visits).where(eq(visits.customerId, customerId));
    const inserted = await tx.insert(visits).values({
      id: visitId, customerId, position: n, visitDate: date,
      visitType: text(visit.purpose, 'purpose'), customerContactName: text(visit.customerContactName, 'customerContactName'),
      notes: text(visit.notes, 'notes'), outcome: text(visit.outcome, 'outcome'),
      managerComment: text(visit.managerComment, 'managerComment'), headquartersComment: text(visit.headquartersComment, 'headquartersComment'),
      followUp: text(visit.followUp, 'followUp'), followUpDate: dayOrNull(visit.followUpDate),
      createdById: by.userId, createdByCustomerId: by.customerId, createdByName: text(visit.createdByName, 'createdByName'),
      createdAt: localOf(visit.createdAt) ?? `${date} 00:00:00.000`
    }).onConflictDoNothing().returning({ id: visits.id });
    if (!inserted.length) {
      // Two tries racing: the other one saved it.
      const saved = await same();
      return saved ? { kind: 'alreadySaved' as const, visit: saved } : { kind: 'notFound' as const };
    }
    await touchCustomer(tx, customerId);
    const urls = attachmentUrls(visit.image);
    if (urls.length) await tx.insert(visitAttachments).values(urls.map((url, position) => ({ visitId, position, url })));

    await linkToSchedule(tx, {
      customerId, visitId, visitDate: date, userId: calendar.userId, purpose: visit.purpose,
      dropInId: calendar.dropInId, events
    });
    await insertActivityLog(tx as unknown as Db, logEntry(log, {
      entityId: visitId, customerId, action: 'CREATE', timestamp: now()
    }));
    return { kind: 'saved' as const, afterAnswer: emitAll(events) };
  });
}

/** PUT /api/customers/:customerId/visits/:visitId — null when there is no such visit. */
export async function editVisit(db: Db, { customerId, visitId, before, set, calendar, log, now }: EditVisitInput): Promise<{ visit: Loose | null; afterAnswer: AfterAnswer } | null> {
  if (!isId(customerId) || !isId(visitId)) return null;
  visitId = visitId.toLowerCase();
  return db.transaction(async tx => {
    const events: ScheduleEvent[] = [];
    const values: Partial<typeof visits.$inferInsert> = {};
    const given = (k: keyof typeof set) => set[k] !== undefined;
    if (given('date')) values.visitDate = String(set.date);
    if (given('followUpDate')) values.followUpDate = dayOrNull(set.followUpDate);
    if (given('purpose')) values.visitType = text(set.purpose, 'purpose');
    if (given('notes')) values.notes = text(set.notes, 'notes');
    if (given('outcome')) values.outcome = text(set.outcome, 'outcome');
    if (given('followUp')) values.followUp = text(set.followUp, 'followUp');
    if (given('managerComment')) values.managerComment = text(set.managerComment, 'managerComment');
    if (given('headquartersComment')) values.headquartersComment = text(set.headquartersComment, 'headquartersComment');
    if (given('updatedBy')) {
      const w = await whoIs(tx, set.updatedBy);
      values.updatedById = w.userId;
      values.updatedByCustomerId = w.customerId;
    }
    if (given('updatedByName')) values.updatedByName = text(set.updatedByName, 'updatedByName');
    if (given('updatedAt')) values.updatedAt = localOf(set.updatedAt);

    const touched = Object.keys(values).length
      ? await tx.update(visits).set(values).where(and(eq(visits.id, visitId), eq(visits.customerId, customerId))).returning({ id: visits.id })
      : await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.id, visitId), eq(visits.customerId, customerId)));
    if (!touched.length) return null;
    await touchCustomer(tx, customerId);

    if (given('image')) {
      await tx.delete(visitAttachments).where(eq(visitAttachments.visitId, visitId));
      const urls = attachmentUrls(set.image);
      if (urls.length) await tx.insert(visitAttachments).values(urls.map((url, position) => ({ visitId, position, url })));
    }

    // A visit moved to another day takes its calendar entry along.
    if (set.date && before.date !== set.date) {
      const oldStart = await unlinkFromSchedule(tx, visitId, events);
      const newDate = String(set.date);
      await linkToSchedule(tx, {
        customerId, visitId, visitDate: newDate, userId: calendar.userId, purpose: calendar.purpose,
        startTime: oldStart ? `${newDate}T${oldStart.split('T')[1]}` : undefined,
        dropInId: calendar.dropInId, events
      });
    }
    await insertActivityLog(tx as unknown as Db, logEntry(log, {
      entityId: visitId, customerId, action: 'UPDATE', timestamp: now()
    }));
    return { visit: await visitDoc(tx, visitId), afterAnswer: emitAll(events) };
  });
}

/** PATCH …/visits/:visitId/follow-up — the stored visit after, or null when there is no such visit. */
export async function setFollowUp(db: Db, { customerId, visitId, set, event, log }: FollowUpInput): Promise<{ visit: Loose | null; afterAnswer: AfterAnswer } | null> {
  if (!isId(customerId) || !isId(visitId)) return null;
  visitId = visitId.toLowerCase();
  return db.transaction(async tx => {
    const values: Partial<typeof visits.$inferInsert> = {};
    if ('followUpDate' in set) values.followUpDate = dayOrNull(set.followUpDate);
    if ('followUpDoneAt' in set) values.followUpDoneAt = localOf(set.followUpDoneAt);
    if ('followUpDoneOn' in set) values.followUpDoneOn = dayOrNull(set.followUpDoneOn);
    if ('followUpDoneBy' in set) values.followUpDoneById = (await whoIs(tx, set.followUpDoneBy)).userId;
    if ('followUpDoneByName' in set) values.followUpDoneByName = text(set.followUpDoneByName, 'followUpDoneByName');
    if ('followUpOutcome' in set) values.followUpOutcome = text(set.followUpOutcome, 'followUpOutcome');

    const touched = Object.keys(values).length
      ? await tx.update(visits).set(values).where(and(eq(visits.id, visitId), eq(visits.customerId, customerId))).returning({ id: visits.id })
      : await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.id, visitId), eq(visits.customerId, customerId)));
    if (!touched.length) return null;
    await touchCustomer(tx, customerId);

    if (event) {
      const [{ n }] = await tx.select({ n: count() }).from(visitFollowUpEvents).where(eq(visitFollowUpEvents.visitId, visitId));
      await tx.insert(visitFollowUpEvents).values({
        visitId, position: n, action: event.action, at: localOf(event.at)!, onDay: dayOrNull(event.on),
        byId: (await whoIs(tx, event.by)).userId, byName: text(event.byName, 'byName'),
        fromDay: dayOrNull(event.from), toDay: dayOrNull(event.to)
      });
    }
    await insertActivityLog(tx as unknown as Db, logEntry(log, {
      entityId: visitId, customerId, action: 'UPDATE', timestamp: log.timestamp
    }));
    return { visit: await visitDoc(tx, visitId), afterAnswer: (async () => {}) as AfterAnswer };
  });
}

/** POST …/visits/:visitId/react — one reaction per person, the same type again takes it off. */
export async function toggleReaction(db: Db, { customerId, visitId, type, userId, userName, reactionId, createdAt }: ReactionInput): Promise<ReactionResult> {
  if (!isId(customerId)) return { kind: 'noCustomer' };
  return db.transaction(async tx => {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
    if (!customer) return { kind: 'noCustomer' as const };
    const vid = isId(visitId) ? visitId.toLowerCase() : null;
    const [visit] = vid ? await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.id, vid), eq(visits.customerId, customerId))) : [];
    if (!visit) return { kind: 'noVisit' as const };

    const rows = await tx.select().from(visitReactions).where(eq(visitReactions.visitId, visit.id)).orderBy(asc(visitReactions.position));
    const list = rows.map(r => ({ id: r.id, type: r.type, userId: r.userId ?? r.customerId, userName: r.userName, createdAt: r.createdAt }));
    const mine = String(userId);
    const existingIndex = list.findIndex(r => r.userId === mine && r.type === type);
    if (existingIndex > -1) {
      list.splice(existingIndex, 1);
    } else {
      // Reactions are mutually exclusive: a person's other reaction on this visit is taken off first.
      const other = list.findIndex(r => r.userId === mine);
      if (other > -1) list.splice(other, 1);
      // Mongoose requires a type and casts it to text.
      if (type == null || type === '' || typeof type === 'object') throw new Error('Visit validation failed: reactions.type');
      const w = await whoIs(tx, mine);
      list.push({ id: reactionId, type: String(type), userId: w.userId ?? w.customerId ?? mine, userName: text(userName, 'userName'), createdAt: localOf(createdAt) });
    }

    await touchCustomer(tx, customerId);
    await tx.delete(visitReactions).where(eq(visitReactions.visitId, visit.id));
    const stored = [];
    for (const [position, r] of list.entries()) {
      const w = await whoIs(tx, r.userId);
      stored.push({ id: r.id, visitId: visit.id, position, type: r.type, userId: w.userId, customerId: w.customerId, userName: r.userName, createdAt: r.createdAt });
    }
    if (stored.length) await tx.insert(visitReactions).values(stored);
    const reactions = list.map(r => ({ _id: r.id, type: r.type, userId: r.userId, userName: r.userName, createdAt: appTime(r.createdAt) }));
    return { kind: 'saved' as const, reactions };
  });
}
