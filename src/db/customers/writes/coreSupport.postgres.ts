/**
 * What the Postgres customer saves need beside the write itself: the customer as
 * MongoDB's record (the saves answer in that shape, so the routes keep calling
 * `customerHistoryResponse` unchanged), the lookups the copy's row builder checks
 * against, and who a rep id names. Private to the core saves.
 */
import { eq, inArray, asc } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import type { ReferenceIndex } from '../../copy/referenceRows.ts';
import { branchZone } from '../../../config/branches.ts';
import {
  customers, customerLogins, customerContacts, customerLinks, visits, visitAttachments,
  visitReactions, visitFollowUpEvents, resources, resourceAttachments
} from '../../schema/customers.ts';
import { locations, users, resourceTypes, visitTypes } from '../../schema/reference.ts';
import type { Loose } from '../../../types/records.ts';
import { customerDoc } from '../customerDoc.ts';
import { displayNameOf } from '../../../utils/salesReps.ts';
import type { ResolvedRep } from './coreTypes.ts';

/** The text MongoDB's own cast gives for an id that isn't one (the routes answer with it). */
export const castIdError = (id: unknown) =>
  new Error(`Cast to ObjectId failed for value "${String(id)}" (type ${typeof id}) at path "_id" for model "Customer"`);

const HEX24 = /^[0-9a-f]{24}$/i;
/** A record id for a query: lowercase, or the error MongoDB would have thrown. */
export function idForQuery(id: unknown): string {
  if (typeof id !== 'string' || !HEX24.test(id)) throw castIdError(id);
  return id.toLowerCase();
}

/** What the copy's row builder looks things up in, read from Postgres. */
export async function referenceIndexOf(db: Db): Promise<ReferenceIndex> {
  const [locs, people, rtypes, vtypes] = await Promise.all([
    db.select({ id: locations.id, name: locations.name }).from(locations),
    db.select({ id: users.id }).from(users),
    db.select({ name: resourceTypes.name }).from(resourceTypes),
    db.select({ name: visitTypes.name }).from(visitTypes)
  ]);
  return {
    locationIdByName: new Map(locs.map(l => [l.name, l.id])),
    zoneOfLocation: name => branchZone(typeof name === 'string' ? name : ''),
    userIds: new Set(people.map(p => p.id)),
    zoneOfUser: () => 'America/Los_Angeles', // customers don't use it
    resourceTypeNames: new Set(rtypes.map(t => t.name)),
    visitTypeNames: new Set(vtypes.map(t => t.name))
  };
}

/** A rep id → { salesRep, salesRepName }, as MongoDB's resolveSalesRep (an unknown id clears both). */
export async function resolveSalesRep(db: Db, salesRepId: unknown): Promise<ResolvedRep> {
  const none = { salesRep: null, salesRepName: '' };
  if (!salesRepId || typeof salesRepId !== 'string' || !HEX24.test(salesRepId)) return none;
  const [u] = await db.select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users).where(eq(users.id, salesRepId.toLowerCase()));
  return u ? { salesRep: u.id, salesRepName: displayNameOf(u) } : none;
}

/** '2026-10-23 14:05:00.000' (a local clock time column) → '2026-10-23T14:05:00.000', as the app wrote it. */
const asWritten = (t: string | null) => {
  if (t == null) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(t);
  return m ? `${m[1]}T${m[2]}.${(m[3] || '').padEnd(3, '0')}` : t.replace(' ', 'T'); // Postgres prints no trailing zero milliseconds
};

/**
 * One customer as MongoDB's record: the customer, its contacts, visits (with photos,
 * reactions and follow-up history) and resources. null when there is none.
 */
export async function loadCustomerRecord(db: Db, id: string): Promise<Loose | null> {
  const [row] = await db.select({
    c: customers, login: customerLogins, locationName: locations.name,
    repUsername: users.username, repDisplayName: users.displayName
  })
    .from(customers)
    .leftJoin(customerLogins, eq(customerLogins.customerId, customers.id))
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .where(eq(customers.id, id));
  if (!row) return null;

  const linkRows = await db.select().from(customerLinks).where(eq(customerLinks.customerId, id))
    .orderBy(customerLinks.kind, customerLinks.position);
  const links = {
    associated: linkRows.filter(l => l.kind === 'associated').map(l => l.otherCustomerId),
    notDuplicate: linkRows.filter(l => l.kind === 'not_duplicate').map(l => l.otherCustomerId)
  };
  const doc = customerDoc(row.c, { locationName: row.locationName, repUsername: row.repUsername, repDisplayName: row.repDisplayName }, links, row.login);
  doc.id = id;

  const contactRows = await db.select().from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(asc(customerContacts.position));
  doc.contacts = contactRows.map(ct => {
    const out: Loose = { _id: ct.id, id: ct.id, name: ct.name, phone: ct.phone, email: ct.email, role: ct.role, notes: ct.notes, createdAt: asWritten(ct.createdAt) };
    if (ct.isPrimary) out.isPrimary = true;
    return out;
  });

  const visitRows = await db.select().from(visits).where(eq(visits.customerId, id)).orderBy(asc(visits.position));
  const visitIds = visitRows.map(v => v.id);
  const [photos, reactions, events] = visitIds.length ? await Promise.all([
    db.select().from(visitAttachments).where(inArray(visitAttachments.visitId, visitIds)).orderBy(visitAttachments.position),
    db.select().from(visitReactions).where(inArray(visitReactions.visitId, visitIds)).orderBy(visitReactions.position),
    db.select().from(visitFollowUpEvents).where(inArray(visitFollowUpEvents.visitId, visitIds)).orderBy(visitFollowUpEvents.position)
  ]) : [[], [], []];

  const resourceRows = await db.select().from(resources).where(eq(resources.customerId, id)).orderBy(asc(resources.position));
  const resourceIds = resourceRows.map(r => r.id);
  const resourcePhotos = resourceIds.length
    ? await db.select().from(resourceAttachments).where(inArray(resourceAttachments.resourceId, resourceIds)).orderBy(resourceAttachments.position)
    : [];
  const placedBy = new Map(resourceRows.filter(r => r.placementVisitId).map(r => [r.placementVisitId as string, r.id]));

  doc.visits = visitRows.map(v => ({
    _id: v.id, resourceId: placedBy.get(v.id) ?? null, date: v.visitDate, purpose: v.visitType,
    notes: v.notes, outcome: v.outcome, followUp: v.followUp, followUpDate: v.followUpDate ?? undefined,
    followUpDoneAt: asWritten(v.followUpDoneAt), followUpDoneOn: v.followUpDoneOn ?? undefined,
    followUpDoneBy: v.followUpDoneById ?? undefined, followUpDoneByName: v.followUpDoneByName, followUpOutcome: v.followUpOutcome,
    followUpHistory: events.filter(e => e.visitId === v.id).map(e => ({
      action: e.action, at: asWritten(e.at), on: e.onDay ?? undefined, by: e.byId ?? undefined,
      byName: e.byName, from: e.fromDay ?? undefined, to: e.toDay ?? undefined
    })),
    managerComment: v.managerComment, headquartersComment: v.headquartersComment,
    image: photos.filter(p => p.visitId === v.id).map(p => p.url),
    createdBy: v.createdById ?? v.createdByCustomerId ?? undefined, createdByName: v.createdByName,
    customerContactName: v.customerContactName,
    reactions: reactions.filter(r => r.visitId === v.id).map(r => ({
      _id: r.id, id: r.id, type: r.type, userId: r.userId ?? r.customerId ?? undefined, userName: r.userName, createdAt: asWritten(r.createdAt)
    })),
    createdAt: asWritten(v.createdAt),
    updatedBy: v.updatedById ?? v.updatedByCustomerId ?? undefined, updatedByName: v.updatedByName, updatedAt: asWritten(v.updatedAt)
  }));

  doc.resources = resourceRows.map(r => ({
    _id: r.id, id: r.id, visitId: r.placementVisitId ?? null, date: r.resourceDate ?? null, resourceType: r.resourceType ?? undefined,
    qty: r.qty ?? undefined, title: r.title, image: resourcePhotos.filter(p => p.resourceId === r.id).map(p => p.url),
    description: r.description, notes: r.notes, status: r.status, url: r.url,
    uploadedBy: r.uploadedById ?? undefined, createdAt: asWritten(r.createdAt)
  }));

  return doc;
}
