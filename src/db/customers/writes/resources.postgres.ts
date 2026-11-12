/**
 * Resource saves on Postgres. Each writes what the copy would make of the MongoDB
 * record after the same save (src/db/copy/customerRows.ts, linkedRows.ts) and answers
 * what its MongoDB twin in resources.mongo.ts answers (resources.parity.test.ts).
 *
 * Differences in shape, not in result: a visit has no `resourceId` here (the resource's
 * `placement_visit_id` is the one link), so the customer's records are read as the
 * documents the matching rules (resourcePlacement.ts) expect, with both sides filled
 * from that one link. Removing a visit or resource renumbers the rest (`position`), as
 * pulling it out of the customer's list does; an edited one goes to the end of its list,
 * as an edit there pulls and pushes it.
 */
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import {
  customers, visits, visitAttachments, resources, resourceAttachments, schedules
} from '../../schema/customers.ts';
import { users, locations, userLocations, resourceTypes } from '../../schema/reference.ts';
import { attachmentUrls } from '../../copy/customerRows.ts';
import { textOf, toDay, toLocalTime } from '../../copy/values.ts';
import { isId } from '../../ids.ts';
import { canModifyVisit, canDeleteVisit } from '../../../utils/visitAccess.ts';
import { placementVisit, placementResource, PlacementConflict } from '../../../services/resourcePlacement.ts';
import { dropInStartTime, addMinutesToLocal, activityTypeForVisit, DROP_IN_MINUTES } from '../../../services/visitSchedule.ts';
import {
  familyLookup, earlierCount, modaFields, modaKindOf, type FamilyOf, type ModaResource, type ModaCustomer
} from '../../../utils/modaTotals.ts';
import { YMD_RE } from '../../../utils/visitDates.ts';
import type { Loose } from '../../../types/records.ts';
import { scheduleOnDay } from '../scheduleStart.ts';
import { insertActivityLog } from './activityLog.ts';
import {
  ResourceError, type AddResourceInput, type UpdateResourceInput, type DeleteResourceInput,
  type DeleteVisitInput, type DeleteVisitResult, type ResourceForEdit, type ScheduleEvent
} from './resources.rules.ts';

const ZONE = 'America/Los_Angeles';
const PLACEMENT = 'Resource Placement: ';
const text = (value: unknown) => String(value ?? '').trim();
const sameText = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const nameOf = (customer: Loose) => customer.company || customer.contactName || '';
const ownerOf = (resource: Loose) => ({ createdBy: resource.uploadedBy || resource.createdBy });
const clock = (value: unknown): string | null => { const r = toLocalTime(value, ZONE); return r.ok ? r.value : null; };
const dayOf = (value: unknown): string | null => { const r = toDay(value, ZONE); return r.ok ? r.value : null; };

/** MongoDB refuses a value that isn't an id with a cast error; so does this (the route answers 500). */
function castId(value: unknown): string {
  if (!isId(value)) throw new Error('Cast to ObjectId failed');
  return value;
}

// ── Reading a customer as the matching rules expect it ─────────────────────────────

interface CustomerDocs { doc: Loose; visits: Loose[]; resources: Loose[] }

async function loadCustomer(tx: Db, id: string): Promise<CustomerDocs | null> {
  const [row] = await tx.select().from(customers).where(eq(customers.id, id));
  if (!row) return null;
  const resourceRows = await tx.select().from(resources).where(eq(resources.customerId, id)).orderBy(asc(resources.position), asc(resources.id));
  const visitRows = await tx.select().from(visits).where(eq(visits.customerId, id)).orderBy(asc(visits.position), asc(visits.id));
  const resourceOfVisit = new Map(resourceRows.filter(r => r.placementVisitId).map(r => [r.placementVisitId!, r.id]));
  return {
    doc: { _id: row.id, company: row.company, contactName: row.contactName },
    visits: visitRows.map(v => ({
      _id: v.id, resourceId: resourceOfVisit.get(v.id) ?? null, purpose: v.visitType, date: v.visitDate, notes: v.notes,
      createdBy: v.createdById ?? v.createdByCustomerId ?? undefined, createdAt: v.createdAt
    })),
    resources: resourceRows.map(r => ({
      _id: r.id, visitId: r.placementVisitId, resourceType: r.resourceType, title: r.title, qty: r.qty, status: r.status,
      date: r.resourceDate, notes: r.notes, description: r.description, uploadedBy: r.uploadedById ?? undefined, createdAt: r.createdAt
    }))
  };
}

/** What Display / Binders count from (resourcesOf in modaCount.ts). */
const resourcesOf = (list: Loose[]): ModaResource[] =>
  list.map(r => ({ resourceType: r.resourceType, title: r.title, qty: r.qty, status: r.status }));

/** Type name → family, from the Resource Types list (a copy until that area moves). */
async function loadFamilies(tx: Db): Promise<FamilyOf> {
  return familyLookup(await tx.select({ name: resourceTypes.name, family: resourceTypes.family }).from(resourceTypes));
}

// ── Display / Binders (modaCount.ts's recountModa, on the customer's columns) ───────

/**
 * Sets Display, Binders and the earlier count from the resources as they were and are.
 * `touch`: the save always stamps updatedAt ('always'), or only when a value changed
 * ('changed', as a Mongoose save of nothing new does).
 */
async function recount(tx: Db, customerId: string, before: ModaResource[], after: ModaResource[],
  familiesBefore: FamilyOf, familiesAfter: FamilyOf = familiesBefore, touch: 'always' | 'changed' = 'always'): Promise<void> {
  const [row] = await tx.select().from(customers).where(eq(customers.id, customerId));
  const stored: ModaCustomer = {
    modaDisplay: row.modaDisplay === true ? 'Yes' : row.modaDisplay === false ? 'No' : undefined,
    modaBinder: String(row.modaBinders),
    modaEarlier: row.modaEarlierDisplay != null && row.modaEarlierBinders != null
      ? { display: row.modaEarlierDisplay, binders: row.modaEarlierBinders } : undefined
  };
  const fields = modaFields(earlierCount(stored, before, familiesBefore), after, familiesAfter);
  const next = {
    modaDisplay: fields.modaDisplay === 'Yes', modaBinders: Number(fields.modaBinder),
    modaEarlierDisplay: fields.modaEarlier.display, modaEarlierBinders: fields.modaEarlier.binders
  };
  const changed = row.modaDisplay !== next.modaDisplay || row.modaBinders !== next.modaBinders
    || row.modaEarlierDisplay !== next.modaEarlierDisplay || row.modaEarlierBinders !== next.modaEarlierBinders;
  if (touch === 'changed' && !changed) return;
  await tx.update(customers).set({ ...next, updatedAt: new Date() }).where(eq(customers.id, customerId));
}

const touchCustomer = (tx: Db, id: string) => tx.update(customers).set({ updatedAt: new Date() }).where(eq(customers.id, id));

/** Pulling a record out of a list closes the gap; the list's order is its position. */
async function compactPositions(tx: Db, customerId: string): Promise<void> {
  await tx.execute(sql`update visits v set position = r.n - 1
    from (select id, row_number() over (order by position, id) as n from visits where customer_id = ${customerId}) r
    where v.id = r.id and v.position <> r.n - 1`);
  await tx.execute(sql`update resources v set position = r.n - 1
    from (select id, row_number() over (order by position, id) as n from resources where customer_id = ${customerId}) r
    where v.id = r.id and v.position <> r.n - 1`);
}
const LAST = 1_000_000;

/** Who a record's author id is: a user, else a customer, else blank (the copy's rule). */
async function whoIs(tx: Db, id: unknown): Promise<{ userId: string | null; customerId: string | null }> {
  if (!isId(id)) return { userId: null, customerId: null };
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (u) return { userId: id, customerId: null };
  const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, id));
  return c ? { userId: null, customerId: id } : { userId: null, customerId: null };
}

async function typeOrNull(tx: Db, type: unknown): Promise<string | null> {
  if (!type) return null;
  const [t] = await tx.select({ name: resourceTypes.name }).from(resourceTypes).where(eq(resourceTypes.name, String(type)));
  return t ? t.name : null;
}

async function replaceAttachments(tx: Db, kind: 'visit' | 'resource', id: string, urls: string[]): Promise<void> {
  if (kind === 'visit') {
    await tx.delete(visitAttachments).where(eq(visitAttachments.visitId, id));
    if (urls.length) await tx.insert(visitAttachments).values(urls.map((url, position) => ({ visitId: id, position, url })));
  } else {
    await tx.delete(resourceAttachments).where(eq(resourceAttachments.resourceId, id));
    if (urls.length) await tx.insert(resourceAttachments).values(urls.map((url, position) => ({ resourceId: id, position, url })));
  }
}

const qtyOrNull = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999 ? v : null;

// ── The calendar (visitSchedule.ts's link / unlink / move) ───────────────────────────

/** A rep's branch name: their home location, else the first they're assigned. */
async function branchOf(tx: Db, userId: string): Promise<string | null> {
  const [u] = await tx.select({ home: locations.name }).from(users).leftJoin(locations, eq(users.homeLocationId, locations.id)).where(eq(users.id, userId));
  if (!u) return null;
  if (u.home) return u.home;
  const [first] = await tx.select({ name: locations.name }).from(userLocations).innerJoin(locations, eq(userLocations.locationId, locations.id))
    .where(eq(userLocations.userId, userId)).orderBy(asc(locations.name)).limit(1);
  return first?.name ?? '';
}

async function linkVisit(tx: Db, o: { customerId: string; visitId: string; visitDate: string; userId: unknown; purpose?: string;
  startTime?: string; dropInId: string; events: ScheduleEvent[] }): Promise<void> {
  const { customerId, visitId, visitDate, userId, purpose, startTime, dropInId, events } = o;
  if (!userId || !isId(userId) || !YMD_RE.test(String(visitDate || ''))) return;

  const [planned] = await tx.select({ id: schedules.id, userId: schedules.userId }).from(schedules)
    .where(and(eq(schedules.userId, userId), eq(schedules.customerId, customerId), eq(schedules.status, 'Scheduled'),
      scheduleOnDay(visitDate))).orderBy(asc(schedules.id)).limit(1);
  if (planned) {
    await tx.update(schedules).set({ status: 'Completed', visitId, updatedAt: new Date() }).where(eq(schedules.id, planned.id));
    events.push({ type: 'upsert', userId: planned.userId, id: planned.id });
    return;
  }

  const branch = await branchOf(tx, userId);
  if (branch === null) return;
  const start = startTime || dropInStartTime(visitDate, branch);
  const now = new Date();
  await tx.insert(schedules).values({
    id: dropInId, userId, customerId, startsAt: clock(start)!, endsAt: clock(addMinutesToLocal(start, DROP_IN_MINUTES)),
    activityType: activityTypeForVisit(purpose), notes: purpose || '', status: 'Completed', visitId, source: 'visit_log',
    createdAt: now, updatedAt: now
  });
  events.push({ type: 'upsert', userId, id: dropInId });
}

/** The drop-in's start time (local 'YYYY-MM-DD HH:MM:SS.mmm'), if it had one. */
async function unlinkVisit(tx: Db, visitId: string, events: ScheduleEvent[]): Promise<string | null> {
  if (!isId(visitId)) return null;
  const [drop] = await tx.select({ id: schedules.id, userId: schedules.userId, startsAt: schedules.startsAt }).from(schedules)
    .where(and(eq(schedules.visitId, visitId), eq(schedules.source, 'visit_log'))).orderBy(asc(schedules.id)).limit(1);
  if (drop) {
    await tx.delete(schedules).where(eq(schedules.id, drop.id));
    events.push({ type: 'delete', userId: drop.userId, id: drop.id });
  }
  const planned = await tx.select({ id: schedules.id, userId: schedules.userId }).from(schedules)
    .where(and(eq(schedules.visitId, visitId), ne(schedules.source, 'visit_log'))).orderBy(asc(schedules.id));
  if (planned.length) {
    await tx.update(schedules).set({ status: 'Scheduled', visitId: null, updatedAt: new Date() }).where(inArray(schedules.id, planned.map(p => p.id)));
    for (const p of planned) events.push({ type: 'upsert', userId: p.userId, id: p.id });
  }
  return drop?.startsAt ?? null;
}

// ── Saves ────────────────────────────────────────────────────────────────────────────

/** POST /api/customers/:customerId/resources. */
export async function addResource(tx: Db, { customerId, fields, performer, scheduleUserId, now, ids }: AddResourceInput) {
  castId(customerId);
  const found = await loadCustomer(tx, customerId);
  if (!found) throw new ResourceError(404, 'Customer not found');
  const createdAt = now();
  const resource = {
    ...fields, _id: ids.resourceId, visitId: ids.visitId, uploadedBy: performer.id,
    customer: nameOf(found.doc), createdAt, image: fields.image || [], status: fields.status || 'Active'
  };
  const visit = {
    _id: ids.visitId, resourceId: ids.resourceId, date: fields.date, purpose: `${PLACEMENT}${fields.resourceType || fields.title}`,
    notes: fields.notes || fields.description || `Added resource: ${fields.title}`,
    image: resource.image, createdBy: performer.id, createdByName: performer.name,
    customerContactName: nameOf(found.doc), createdAt, followUp: '', followUpDate: ''
  };
  const before = resourcesOf(found.resources);
  const families = await loadFamilies(tx);

  const visitDate = dayOf(fields.date);
  if (!visitDate) throw new Error('Visit validation failed: date is required');
  const by = await whoIs(tx, performer.id);
  await tx.insert(visits).values({
    id: ids.visitId, customerId, position: found.visits.length, visitDate, visitType: textOf(visit.purpose),
    customerContactName: textOf(visit.customerContactName), notes: textOf(visit.notes), followUp: '', followUpDate: null,
    createdById: by.userId, createdByCustomerId: by.customerId, createdByName: textOf(performer.name),
    createdAt: clock(createdAt) ?? `${visitDate} 00:00:00.000`
  });
  const urls = attachmentUrls(resource.image);
  await replaceAttachments(tx, 'visit', ids.visitId, urls);
  await tx.insert(resources).values({
    id: ids.resourceId, customerId, position: found.resources.length, placementVisitId: ids.visitId,
    resourceType: await typeOrNull(tx, fields.resourceType), resourceDate: visitDate, title: textOf(fields.title),
    description: textOf(fields.description), notes: textOf(fields.notes), status: textOf(resource.status) || 'Active',
    qty: qtyOrNull(fields.qty), url: textOf(fields.url), uploadedById: (await whoIs(tx, performer.id)).userId, createdAt: clock(createdAt)
  });
  await replaceAttachments(tx, 'resource', ids.resourceId, urls);
  await recount(tx, customerId, before, [...before, ...resourcesOf([resource])], families);
  const events: ScheduleEvent[] = [];
  await linkVisit(tx, { customerId, visitId: ids.visitId, visitDate: fields.date, userId: scheduleUserId, purpose: visit.purpose,
    dropInId: ids.dropInId, events });
  return { resource: resource as Loose, visit: visit as Loose, events };
}

/** The resource's type and owner, before attachments are processed. */
export async function resourceForEdit(tx: Db, resourceId: string): Promise<ResourceForEdit | null> {
  castId(resourceId);
  const [r] = await tx.select({ type: resources.resourceType, by: resources.uploadedById }).from(resources).where(eq(resources.id, resourceId));
  return r ? { resourceType: r.type ?? undefined, uploadedBy: r.by ?? undefined } : null;
}

/** PUT …/resources/:resourceId: an edit, or a move to another customer. */
export async function updateResource(tx: Db, { customerId, resourceId, fields, actor, team, dropInId }: UpdateResourceInput) {
  castId(resourceId);
  const [at] = await tx.select({ customerId: resources.customerId }).from(resources).where(eq(resources.id, resourceId));
  const source = at ? await loadCustomer(tx, at.customerId) : null;
  const resource = source?.resources.find(r => r._id === resourceId);
  if (!source || !resource) throw new ResourceError(404, 'Resource not found');
  if (!canModifyVisit(actor as Loose, ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to edit this resource.');
  const moving = String(source.doc._id) !== String(customerId);
  const target = moving ? (castId(customerId), await loadCustomer(tx, customerId)) : source;
  if (!target) throw new ResourceError(404, 'Customer not found');
  const visit = placementVisit({ visits: source.visits, resources: source.resources }, resource);
  if (visit && !canModifyVisit(actor as Loose, visit, team)) throw new ResourceError(403, 'You do not have permission to edit the linked placement visit.');
  const oldDate = visit?.date;
  const carried: Loose = { ...resource, ...fields, customer: nameOf(target.doc) };
  if (!carried.title) throw new Error('Customer validation failed: resources.title is required');
  const carriedVisit: Loose | null = visit ? {
    ...visit, resourceId: resource._id, date: carried.date,
    purpose: `${PLACEMENT}${carried.resourceType || carried.title}`,
    notes: carried.notes || carried.description || `Added resource: ${carried.title}`,
    customerContactName: nameOf(target.doc)
  } : null;
  if (visit) carried.visitId = visit._id;
  const sourceBefore = resourcesOf(source.resources), targetBefore = resourcesOf(target.resources);
  const families = await loadFamilies(tx);

  // Their lists as they are after: the resource gone from its customer, then on the target's.
  const sourceAfter = source.resources.filter(r => r._id !== resourceId);
  const targetAfter = [...(moving ? target.resources : sourceAfter), carried];

  if (carriedVisit && !dayOf(carriedVisit.date)) throw new Error('Customer validation failed: visits.date is required');
  const urls = fields.image !== undefined ? attachmentUrls(fields.image) : (await tx.select().from(resourceAttachments)
    .where(eq(resourceAttachments.resourceId, resourceId)).orderBy(asc(resourceAttachments.position))).map(a => a.url);
  await tx.update(resources).set({
    customerId: String(target.doc._id), position: LAST, placementVisitId: visit ? String(visit._id) : null,
    resourceType: await typeOrNull(tx, carried.resourceType), resourceDate: dayOf(carried.date),
    title: textOf(carried.title), description: textOf(carried.description), notes: textOf(carried.notes),
    status: textOf(carried.status) || 'Active', qty: qtyOrNull(carried.qty), url: textOf(carried.url)
  }).where(eq(resources.id, resourceId));
  await replaceAttachments(tx, 'resource', resourceId, urls);
  if (carriedVisit) {
    await tx.update(visits).set({
      customerId: String(target.doc._id), position: LAST, visitDate: dayOf(carriedVisit.date)!, visitType: textOf(carriedVisit.purpose),
      notes: textOf(carriedVisit.notes), customerContactName: textOf(carriedVisit.customerContactName)
    }).where(eq(visits.id, String(carriedVisit._id)));
    await replaceAttachments(tx, 'visit', String(carriedVisit._id), urls);
  }
  await compactPositions(tx, String(source.doc._id));
  if (moving) await compactPositions(tx, String(target.doc._id));

  if (moving) await recount(tx, String(source.doc._id), sourceBefore, resourcesOf(sourceAfter), families);
  await recount(tx, String(target.doc._id), targetBefore, resourcesOf(targetAfter), families);

  const events: ScheduleEvent[] = [];
  if (carriedVisit) {
    const linked = await tx.select({ id: schedules.id, userId: schedules.userId }).from(schedules)
      .where(eq(schedules.visitId, String(carriedVisit._id))).orderBy(asc(schedules.id));
    await tx.update(schedules).set({ customerId: String(target.doc._id), notes: textOf(carriedVisit.purpose), updatedAt: new Date() })
      .where(eq(schedules.visitId, String(carriedVisit._id)));
    if (oldDate !== carriedVisit.date) {
      const oldStart = await unlinkVisit(tx, String(carriedVisit._id), events);
      await linkVisit(tx, {
        customerId: String(target.doc._id), visitId: String(carriedVisit._id), visitDate: carriedVisit.date,
        userId: carriedVisit.createdBy, purpose: carriedVisit.purpose, dropInId,
        startTime: oldStart ? `${carriedVisit.date}T${String(oldStart).split(' ')[1]}` : undefined, events
      });
    } else {
      for (const entry of linked) events.push({ type: 'upsert', userId: entry.userId, id: entry.id });
    }
  }
  return { moving, events };
}

/** DELETE …/resources/:resourceId, with its placement visit and calendar entry. */
export async function deleteResource(tx: Db, { customerId, resourceId, actor, team }: DeleteResourceInput) {
  castId(customerId);
  const found = await loadCustomer(tx, customerId);
  const resource = isId(resourceId) ? found?.resources.find(r => r._id === resourceId) : undefined;
  if (!found || !resource) throw new ResourceError(404, 'Resource not found');
  if (!canDeleteVisit(actor as Loose, ownerOf(resource), team)) throw new ResourceError(403, 'You do not have permission to delete this resource.');
  const visit = placementVisit({ visits: found.visits, resources: found.resources }, resource);
  if (visit && !canDeleteVisit(actor as Loose, visit, team)) throw new ResourceError(403, 'You do not have permission to delete the linked placement visit.');
  const before = resourcesOf(found.resources);
  const events: ScheduleEvent[] = [];
  if (visit) await unlinkVisit(tx, String(visit._id), events);
  await tx.delete(resources).where(eq(resources.id, resourceId));
  if (visit) await tx.delete(visits).where(eq(visits.id, String(visit._id)));
  await compactPositions(tx, customerId);
  await recount(tx, customerId, before, resourcesOf(found.resources.filter(r => r._id !== resourceId)), await loadFamilies(tx));
  return events;
}

/** DELETE /api/customers/:customerId/visits/:visitId, with a placement visit's resource. */
export async function deleteVisitWithResource(tx: Db, { customerId, visitId, actor, team, performer, performedByRole, logId }: DeleteVisitInput): Promise<DeleteVisitResult> {
  castId(customerId);
  const found = await loadCustomer(tx, customerId);
  if (!found) return { outcome: 'no-customer' };
  const visit = isId(visitId) ? found.visits.find(v => v._id === visitId) : undefined;
  if (visit && !canDeleteVisit(actor as Loose, visit, await team())) return { outcome: 'forbidden-visit' };
  const resource = visit && /^Resource Placement:/i.test(visit.purpose || '')
    ? placementResource({ visits: found.visits, resources: found.resources }, visit) : null;
  if (resource && !canDeleteVisit(actor as Loose, { createdBy: resource.uploadedBy || resource.createdBy }, await team())) {
    return { outcome: 'forbidden-resource' };
  }
  const events: ScheduleEvent[] = [];
  if (visit) {
    await unlinkVisit(tx, visitId, events);
    if (resource) await tx.delete(resources).where(eq(resources.id, String(resource._id)));
    await tx.delete(visits).where(eq(visits.id, visitId));
    await compactPositions(tx, customerId);
    if (resource) {
      await recount(tx, customerId, resourcesOf(found.resources), resourcesOf(found.resources.filter(r => r._id !== resource._id)), await loadFamilies(tx));
    } else {
      await touchCustomer(tx, customerId);
    }
  } else if (isId(visitId)) {
    // Nothing to remove, but a calendar entry may still name it (the route always tried).
    await unlinkVisit(tx, visitId, events);
  }
  if (isId(visitId)) {
    await insertActivityLog(tx, {
      id: logId, entityType: 'Visit', entityId: visitId, customerId, action: 'DELETE',
      performedBy: performer.id, performedByName: performer.name, performedByRole: performedByRole as 'admin' | 'customer' | null,
      details: { visitDate: visit ? visit.date : null, purpose: visit ? visit.purpose : null },
      // The MongoDB route never stamped this line's time; none here either.
      timestamp: undefined as unknown as string
    });
  }
  return { outcome: 'deleted', async after(emit) { for (const event of events) emit(event); } };
}

// ── Type lists: records moved to another type ─────────────────────────────────────────

export async function countVisitTypeUses(db: Db, name: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(visits).where(eq(visits.visitType, name));
  return Number(row?.n || 0);
}

export async function countResourceTypeUses(db: Db, name: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(resources).where(eq(resources.resourceType, name));
  return Number(row?.n || 0);
}

/** Every visit of type `from` becomes `to`. Returns how many moved. */
export async function replaceVisitType(tx: Db, from: string, to: string): Promise<number> {
  const rows = await tx.select({ id: visits.id, customerId: visits.customerId }).from(visits).where(eq(visits.visitType, from));
  if (!rows.length) return 0;
  const ids = rows.map(r => r.id);
  await tx.update(visits).set({ visitType: to }).where(eq(visits.visitType, from));
  // The customers are touched, as an update through their records stamps them.
  await tx.update(customers).set({ updatedAt: new Date() }).where(inArray(customers.id, [...new Set(rows.map(r => r.customerId))]));
  await tx.update(schedules).set({ notes: to, updatedAt: new Date() }).where(and(inArray(schedules.visitId, ids), eq(schedules.notes, from)));
  return ids.length;
}

/**
 * Every resource of type `from` becomes `to`, with its title, placement visit and
 * calendar entry kept in step; an older one whose placement can't be told apart
 * throws PlacementConflict (the caller's transaction then changes nothing).
 */
export async function replaceResourceType(tx: Db, from: string, to: string): Promise<number> {
  const owners = await tx.selectDistinct({ id: resources.customerId }).from(resources).where(eq(resources.resourceType, from)).orderBy(asc(resources.customerId));
  const families = await loadFamilies(tx);
  let moved = 0;
  for (const { id: customerId } of owners) {
    const found = (await loadCustomer(tx, customerId))!;
    const before = resourcesOf(found.resources);
    const customer = { visits: found.visits, resources: found.resources };
    const mine = found.resources.filter(r => r.resourceType === from);
    const pairs = mine.map(resource => ({ resource, visit: placementVisit(customer, resource) }));
    const claimed = pairs.map(p => p.visit && String(p.visit._id)).filter(Boolean);
    if (new Set(claimed).size !== claimed.length) throw new PlacementConflict();

    const calendar: { visitId: string; before: string; after: string }[] = [];
    for (const { resource, visit } of pairs) {
      const oldTitle = resource.title;
      resource.resourceType = to;
      if (sameText(resource.title, from)) resource.title = to;
      moved += 1;
      const update: Partial<typeof resources.$inferInsert> = { resourceType: to, title: resource.title };
      if (visit) update.placementVisitId = String(visit._id);
      await tx.update(resources).set(update).where(eq(resources.id, String(resource._id)));
      if (!visit) continue;
      const visitBefore = text(visit.purpose);
      const visitSet: Partial<typeof visits.$inferInsert> = {};
      if (sameText(visitBefore.replace(/^Resource Placement:\s*/i, ''), from)) {
        visit.purpose = `${PLACEMENT}${to}`;
        visitSet.visitType = visit.purpose;
        calendar.push({ visitId: String(visit._id), before: visitBefore, after: visit.purpose });
      }
      if (text(visit.notes) === `Added resource: ${text(oldTitle)}`) { visit.notes = `Added resource: ${resource.title}`; visitSet.notes = visit.notes; }
      if (Object.keys(visitSet).length) await tx.update(visits).set(visitSet).where(eq(visits.id, String(visit._id)));
    }
    await recount(tx, customerId, before, resourcesOf(found.resources), families);
    for (const entry of calendar) {
      await tx.update(schedules).set({ notes: entry.after, updatedAt: new Date() })
        .where(and(eq(schedules.visitId, entry.visitId), eq(schedules.notes, entry.before)));
    }
  }
  return moved;
}

/**
 * Resource Types: a type moved into or out of Display towers / Sample binders recounts
 * every customer holding it. `before` reads the families as they are now (the type
 * list is still MongoDB's; the caller reads it). Returns how many were recounted.
 */
export async function recountForFamilyChange(tx: Db, typeName: string, from: string | undefined, to: string | undefined, before: FamilyOf): Promise<number> {
  if (modaKindOf(from) === modaKindOf(to)) return 0;
  const after: FamilyOf = name => (name === typeName ? to : before(name));
  const owners = await tx.selectDistinct({ id: resources.customerId }).from(resources)
    .where(or(eq(resources.resourceType, typeName), eq(resources.title, typeName)));
  for (const { id } of owners) {
    const found = (await loadCustomer(tx, id))!;
    const list = resourcesOf(found.resources);
    await recount(tx, id, list, list, before, after, 'changed');
  }
  return owners.length;
}
