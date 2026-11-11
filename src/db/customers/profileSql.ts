/** Scoped nested profile reads, batched by parent; never load another team's history into Node. */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { visits, visitAttachments, visitReactions, visitFollowUpEvents, resources, resourceAttachments, customerContacts as customerContactsTable, customers } from '../schema/customers.ts';
import { users } from '../schema/reference.ts';
import type { Loose } from '../../types/records.ts';
import type { CustomerHistoryScope } from './types.ts';
import { visitDoc, resourceDoc, contactDoc, reactionDoc, followUpEventDoc, repNameOf } from './customerDoc.ts';

const bytewise = (column: unknown) => sql`${column} collate "C"`;

/** Group once by parent id so attaching children is linear, not a scan per parent. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) { const k = key(item); const list = out.get(k); if (list) list.push(item); else out.set(k, [item]); }
  return out;
}

export const historyScope = (owner: SQL | typeof resources.uploadedById, people: CustomerHistoryScope['people']): SQL =>
  people === '*' ? sql`true` : people.size ? inArray(sql`${owner}`, [...people]) : sql`false`;

export async function customerVisits(db: Db, customerIds: string[], people: CustomerHistoryScope['people'], entryId?: string): Promise<Loose[]> {
  if (!customerIds.length) return [];
  const rows = await db.select({ v: visits, resourceId: resources.id }).from(visits)
    .leftJoin(resources, eq(resources.placementVisitId, visits.id))
    .where(and(inArray(visits.customerId, customerIds), entryId ? eq(visits.id, entryId) : undefined,
      historyScope(sql`coalesce(${visits.createdById}, ${visits.createdByCustomerId})`, people)))
    .orderBy(visits.position, bytewise(visits.id));
  if (!rows.length) return [];
  const ids = rows.map(r => r.v.id);
  const [images, reactions, history] = await Promise.all([
    db.select().from(visitAttachments).where(inArray(visitAttachments.visitId, ids)).orderBy(visitAttachments.position),
    db.select().from(visitReactions).where(inArray(visitReactions.visitId, ids)).orderBy(visitReactions.position, bytewise(visitReactions.id)),
    db.select().from(visitFollowUpEvents).where(inArray(visitFollowUpEvents.visitId, ids)).orderBy(visitFollowUpEvents.position)
  ]);
  const imagesOf = groupBy(images, i => i.visitId), reactionsOf = groupBy(reactions, r => r.visitId), historyOf = groupBy(history, h => h.visitId);
  return rows.map(({ v, resourceId }) => visitDoc(v, (imagesOf.get(v.id) ?? []).map(i => i.url),
    (reactionsOf.get(v.id) ?? []).map(reactionDoc), (historyOf.get(v.id) ?? []).map(followUpEventDoc), resourceId));
}

export async function customerResources(db: Db, customerId: string, people: CustomerHistoryScope['people'], entryId?: string,
  nameUploaders = false): Promise<Loose[]> {
  const rows = await db.select({ r: resources, company: customers.company, contactName: customers.contactName,
    repUsername: users.username, repDisplayName: users.displayName }).from(resources)
    .innerJoin(customers, eq(customers.id, resources.customerId))
    .leftJoin(users, eq(users.id, resources.uploadedById))
    .where(and(eq(resources.customerId, customerId), entryId ? eq(resources.id, entryId) : undefined, historyScope(resources.uploadedById, people)))
    .orderBy(resources.position, bytewise(resources.id));
  if (!rows.length) return [];
  const images = await db.select().from(resourceAttachments).where(inArray(resourceAttachments.resourceId, rows.map(r => r.r.id)))
    .orderBy(resourceAttachments.position);
  const imagesOf = groupBy(images, i => i.resourceId);
  // Always named on the profile ('' when nobody is left to name), as MongoDB's reply does.
  return rows.map(row => ({ ...resourceDoc(row.r, (imagesOf.get(row.r.id) ?? []).map(i => i.url),
    row.company || row.contactName), ...(nameUploaders ? { uploadedByName: repNameOf(row) } : {}) }));
}

export async function customerContacts(db: Db, customerId: string): Promise<Loose[]> {
  return (await db.select().from(customerContactsTable).where(eq(customerContactsTable.customerId, customerId))
    .orderBy(customerContactsTable.position, bytewise(customerContactsTable.id))).map(contactDoc);
}

