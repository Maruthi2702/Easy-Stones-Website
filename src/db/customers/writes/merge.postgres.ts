/**
 * Duplicate customers on Postgres: the twin of merge.mongo.ts (src/services/customerMerge.ts
 * on MongoDB). One transaction per Resolve and per Undo.
 *
 * MongoDB keeps a customer's links as arrays that may name customers that no longer
 * exist; the copy keeps only the ones that do, numbered from 0 (src/db/copy/customerRows.ts).
 * So every list here is edited as MongoDB edits its array and then written back the way
 * the copy would write it (`setLinkList`).
 *
 * The backup (`customer_merge_backups.group`) can't be MongoDB's: that holds whole
 * MongoDB documents, which Postgres can't rebuild field for field. It holds the same
 * survivorId / losers / moved, plus `pg`: the rows as they were, and what deleting the
 * duplicates blanked that MongoDB would have left pointing at them (they come back on
 * Undo, as MongoDB's do). Undo here reads `pg`; a backup copied from MongoDB has none and
 * is refused (undo it before the cutover).
 */
import { and, eq, inArray, desc, asc, isNull, sql } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../copy/plan.ts';
import {
  customers, customerLogins, customerContacts, customerLinks, visits, visitAttachments, visitReactions,
  visitFollowUpEvents, resources, resourceAttachments, schedules, activityLogs, customerMergeBackups
} from '../../schema/customers.ts';
import { locations, users, resourceTypes } from '../../schema/reference.ts';
import { deliveries, paymentsReceived } from '../../schema/operations.ts';
import { lostSales } from '../../schema/misc.ts';
import { salesCarts, salesHolds } from '../../schema/checkInsHolds.ts';
import { cardExpenses } from '../../schema/cardsSuppliers.ts';
import { contactIdFor } from '../../copy/customerRows.ts';
import { toLocalTime } from '../../copy/values.ts';
import { planFields, contactsFromLosers } from '../../../services/customerMerge.ts';
import { familyLookup, earlierCount, modaFields } from '../../../utils/modaTotals.ts';
import type { Loose } from '../../../types/records.ts';
import { customerDoc } from '../customerDoc.ts';
import type { ResolveDuplicatesInput, ResolveDuplicatesResult, UndoDuplicatesResult } from './mergeTypes.ts';

type LinkKind = 'associated' | 'not_duplicate';
const KINDS: LinkKind[] = ['associated', 'not_duplicate'];

// ── link lists, as MongoDB arrays ────────────────────────────────────────────

export async function linkList(tx: Db, customerId: string, kind: LinkKind): Promise<string[]> {
  const rows = await tx.select({ other: customerLinks.otherCustomerId }).from(customerLinks)
    .where(and(eq(customerLinks.customerId, customerId), eq(customerLinks.kind, kind)))
    .orderBy(asc(customerLinks.position));
  return rows.map(r => r.other);
}

/** Write a customer's list as the copy would make it: existing customers only, no self, no repeats, numbered from 0. */
export async function setLinkList(tx: Db, customerId: string, kind: LinkKind, ids: string[]): Promise<void> {
  await tx.delete(customerLinks).where(and(eq(customerLinks.customerId, customerId), eq(customerLinks.kind, kind)));
  const wanted = [...new Set(ids.filter(id => id !== customerId))];
  if (!wanted.length) return;
  const there = new Set((await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, wanted))).map(r => r.id));
  const rows = wanted.filter(id => there.has(id)).map((other, position) => ({ customerId, otherCustomerId: other, kind, position }));
  if (rows.length) await tx.insert(customerLinks).values(rows);
}

async function exists(tx: Db, id: string): Promise<boolean> {
  return (await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, id))).length > 0;
}

// ── what a customer is, as rows (the backup's `pg`) ──────────────────────────

export interface CustomerSnapshot {
  customer: Loose;
  login: Loose | null;
  contacts: Loose[];
  links: Loose[];
  visits: Loose[];
  visitAttachments: Loose[];
  visitReactions: Loose[];
  visitFollowUpEvents: Loose[];
  resources: Loose[];
  resourceAttachments: Loose[];
}

export async function snapshotCustomer(tx: Db, id: string): Promise<CustomerSnapshot> {
  const [customer] = await tx.select().from(customers).where(eq(customers.id, id));
  const [login] = await tx.select().from(customerLogins).where(eq(customerLogins.customerId, id));
  const contacts = await tx.select().from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(asc(customerContacts.position));
  const links = await tx.select().from(customerLinks).where(eq(customerLinks.customerId, id)).orderBy(asc(customerLinks.kind), asc(customerLinks.position));
  const vs = await tx.select().from(visits).where(eq(visits.customerId, id)).orderBy(asc(visits.position));
  const rs = await tx.select().from(resources).where(eq(resources.customerId, id)).orderBy(asc(resources.position));
  const vids = vs.map(v => v.id), rids = rs.map(r => r.id);
  return {
    customer, login: login ?? null, contacts, links, visits: vs, resources: rs,
    visitAttachments: vids.length ? await tx.select().from(visitAttachments).where(inArray(visitAttachments.visitId, vids)) : [],
    visitReactions: vids.length ? await tx.select().from(visitReactions).where(inArray(visitReactions.visitId, vids)) : [],
    visitFollowUpEvents: vids.length ? await tx.select().from(visitFollowUpEvents).where(inArray(visitFollowUpEvents.visitId, vids)) : [],
    resourceAttachments: rids.length ? await tx.select().from(resourceAttachments).where(inArray(resourceAttachments.resourceId, rids)) : []
  };
}

/** A snapshot read back from jsonb: real moments become Dates again. */
const CUSTOMER_MOMENTS = ['createdAt', 'updatedAt', 'geocodeUpdatedAt', 'spsFirstImportedAt', 'spsLastSeenAt', 'spsConnectedAt'];
const revive = (row: Loose, moments: string[]) => {
  const out = { ...row };
  for (const k of moments) if (out[k] != null) out[k] = new Date(out[k]);
  return out;
};

const withoutKey = (row: Loose, key: string) => { const { [key]: _, ...rest } = row; return rest; };

/** Put a customer's own rows back as the snapshot had them (its links are set apart, once every customer is back). */
export async function restoreCustomer(tx: Db, s: CustomerSnapshot): Promise<void> {
  const id = s.customer.id as string;
  // Replacing an existing survivor keeps its position; a deleted record restored
  // by Undo appends, just as MongoDB's insert does. Never reuse snapshot ordinals.
  const row = withoutKey(revive(s.customer, CUSTOMER_MOMENTS), 'matchOrder');
  await tx.insert(customers).values(row as typeof customers.$inferInsert)
    .onConflictDoUpdate({ target: customers.id, set: withoutKey(row, 'id') });
  await tx.delete(customerLogins).where(eq(customerLogins.customerId, id));
  if (s.login) await tx.insert(customerLogins).values(revive(s.login, ['lockUntil']) as typeof customerLogins.$inferInsert);
  await tx.delete(customerContacts).where(eq(customerContacts.customerId, id));
  if (s.contacts.length) await tx.insert(customerContacts).values(s.contacts as (typeof customerContacts.$inferInsert)[]);

  // Visits and resources the record didn't have go, as MongoDB's replace drops them.
  const keepVisits = s.visits.map(v => v.id as string);
  const keepResources = s.resources.map(r => r.id as string);
  const extraResources = (await tx.select({ id: resources.id }).from(resources).where(eq(resources.customerId, id)))
    .map(r => r.id).filter(r => !keepResources.includes(r));
  if (extraResources.length) await tx.delete(resources).where(inArray(resources.id, extraResources));
  const extraVisits = (await tx.select({ id: visits.id }).from(visits).where(eq(visits.customerId, id)))
    .map(v => v.id).filter(v => !keepVisits.includes(v));
  if (extraVisits.length) await tx.delete(visits).where(inArray(visits.id, extraVisits));

  for (const v of s.visits) {
    await tx.insert(visits).values(v as typeof visits.$inferInsert).onConflictDoUpdate({ target: visits.id, set: withoutKey(v, 'id') });
  }
  if (keepVisits.length) {
    await tx.delete(visitAttachments).where(inArray(visitAttachments.visitId, keepVisits));
    await tx.delete(visitReactions).where(inArray(visitReactions.visitId, keepVisits));
    await tx.delete(visitFollowUpEvents).where(inArray(visitFollowUpEvents.visitId, keepVisits));
  }
  if (s.visitAttachments.length) await tx.insert(visitAttachments).values(s.visitAttachments as (typeof visitAttachments.$inferInsert)[]);
  if (s.visitReactions.length) await tx.insert(visitReactions).values(s.visitReactions as (typeof visitReactions.$inferInsert)[]);
  if (s.visitFollowUpEvents.length) await tx.insert(visitFollowUpEvents).values(s.visitFollowUpEvents as (typeof visitFollowUpEvents.$inferInsert)[]);

  for (const r of s.resources) {
    await tx.insert(resources).values(r as typeof resources.$inferInsert).onConflictDoUpdate({ target: resources.id, set: withoutKey(r, 'id') });
  }
  if (keepResources.length) await tx.delete(resourceAttachments).where(inArray(resourceAttachments.resourceId, keepResources));
  if (s.resourceAttachments.length) await tx.insert(resourceAttachments).values(s.resourceAttachments as (typeof resourceAttachments.$inferInsert)[]);
}

export const listOf = (s: CustomerSnapshot, kind: LinkKind) =>
  s.links.filter(l => l.kind === kind).sort((a, b) => a.position - b.position).map(l => l.otherCustomerId as string);

// ── what points at a customer ────────────────────────────────────────────────

/** Moved to the kept customer, as REFERENCES in customerMerge.ts (MongoDB's names, for the backup). */
const REFERENCES: { collection: string; field: string; type: string; table: PgTable; id: PgColumn; column: PgColumn }[] = [
  { collection: 'schedules', field: 'customerId', type: 'objectId', table: schedules, id: schedules.id, column: schedules.customerId },
  { collection: 'activitylogs', field: 'customerId', type: 'objectId', table: activityLogs, id: activityLogs.id, column: activityLogs.customerId },
  { collection: 'lostsales', field: 'customerId', type: 'either', table: lostSales, id: lostSales.id, column: lostSales.customerId },
  { collection: 'deliveries', field: 'customerId', type: 'string', table: deliveries, id: deliveries.id, column: deliveries.customerId }
];

/**
 * Not moved by MongoDB: they keep pointing at the removed record (the copy blanks them),
 * and point at it again once Undo brings it back. Postgres blanks them and remembers which.
 */
export const LEFT_POINTING: Record<string, { table: PgTable; id: PgColumn; column: PgColumn }> = {
  payments_received: { table: paymentsReceived, id: paymentsReceived.id, column: paymentsReceived.customerId },
  sales_carts: { table: salesCarts, id: salesCarts.id, column: salesCarts.customerId },
  sales_holds: { table: salesHolds, id: salesHolds.id, column: salesHolds.customerId },
  card_expenses: { table: cardExpenses, id: cardExpenses.id, column: cardExpenses.customerId },
  'visits.created_by': { table: visits, id: visits.id, column: visits.createdByCustomerId },
  'visits.updated_by': { table: visits, id: visits.id, column: visits.updatedByCustomerId },
  visit_reactions: { table: visitReactions, id: visitReactions.id, column: visitReactions.customerId }
};

export interface Detached { kind: string; ids: string[]; value: string }
interface NotDuplicateMark { customerId: string; other: string; index: number }

export async function idsWhere(tx: Db, idCol: PgColumn, table: PgTable, column: PgColumn, value: string): Promise<string[]> {
  const rows = await tx.select({ id: idCol }).from(table).where(eq(column, value)) as { id: string }[];
  return rows.map(r => String(r.id));
}

// ── Resolve ──────────────────────────────────────────────────────────────────

interface Snapshot {
  survivorId: string;
  survivorBefore: Loose;
  losers: Loose[];
  moved: Loose[];
  pg: { survivor: CustomerSnapshot; losers: CustomerSnapshot[]; detached: Detached[]; notDuplicateOf: NotDuplicateMark[] };
}

/** The customer as the API sends it (the backup's readable part). */
export async function customerShape(tx: Db, id: string): Promise<Loose> {
  const [r] = await tx.select({ c: customers, locationName: locations.name, repUsername: users.username, repDisplayName: users.displayName })
    .from(customers)
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .where(eq(customers.id, id));
  const [login] = await tx.select().from(customerLogins).where(eq(customerLogins.customerId, id));
  const assoc = await linkList(tx, id, 'associated');
  const notDup = await linkList(tx, id, 'not_duplicate');
  const contacts = await tx.select().from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(asc(customerContacts.position));
  const doc = customerDoc(r.c, r, { associated: assoc, notDuplicate: notDup }, login ?? null);
  doc.contacts = contacts.map(c => ({ _id: c.id, name: c.name, phone: c.phone, email: c.email, role: c.role, notes: c.notes, isPrimary: c.isPrimary, createdAt: c.createdAt }));
  return doc;
}

/** Read-only: everything Undo needs, before anything is written (snapshotMerge's twin). */
async function snapshotMergePg(tx: Db, survivorId: string, loserIds: string[], copyDetails: boolean): Promise<Snapshot> {
  const moved: Loose[] = [];
  const detached: Detached[] = [];
  const notDuplicateOf: NotDuplicateMark[] = [];
  const involved = new Set([survivorId, ...loserIds]);
  for (const loser of loserIds) {
    for (const ref of REFERENCES) {
      const ids = await idsWhere(tx, ref.id, ref.table, ref.column, loser);
      if (ids.length) moved.push({ collection: ref.collection, field: ref.field, type: ref.type, from: loser, ids });
    }
    const pointing = (await tx.select({ id: customerLinks.customerId }).from(customerLinks)
      .where(and(eq(customerLinks.otherCustomerId, loser), eq(customerLinks.kind, 'associated')))).map(r => r.id);
    if (pointing.length) moved.push({ collection: 'customers', field: 'associatedCustomers', type: 'objectId', from: loser, ids: pointing });

    for (const [kind, spec] of Object.entries(LEFT_POINTING)) {
      const ids = await idsWhere(tx, spec.id, spec.table, spec.column, loser);
      if (ids.length) detached.push({ kind, ids, value: loser });
    }
    const marks = await tx.select({ customerId: customerLinks.customerId }).from(customerLinks)
      .where(and(eq(customerLinks.otherCustomerId, loser), eq(customerLinks.kind, 'not_duplicate')));
    for (const { customerId } of marks) {
      if (involved.has(customerId)) continue; // put back with that record itself
      notDuplicateOf.push({ customerId, other: loser, index: (await linkList(tx, customerId, 'not_duplicate')).indexOf(loser) });
    }
  }
  const survivor = await snapshotCustomer(tx, survivorId);
  const losers: CustomerSnapshot[] = [];
  for (const id of loserIds) losers.push(await snapshotCustomer(tx, id));
  // A delete takes the visits with it: calendar entries on them point at nothing until Undo
  // brings them back (a merge keeps the visits, on the survivor).
  const loserVisitIds = losers.flatMap(l => l.visits.map(v => v.id as string));
  if (!copyDetails && loserVisitIds.length) {
    const rows = await tx.select({ id: schedules.id, visitId: schedules.visitId }).from(schedules).where(inArray(schedules.visitId, loserVisitIds));
    for (const r of rows) detached.push({ kind: 'schedules.visit', ids: [r.id], value: r.visitId! });
  }
  return {
    survivorId,
    survivorBefore: await customerShape(tx, survivorId),
    losers: await Promise.all(loserIds.map(id => customerShape(tx, id))),
    moved,
    pg: { survivor, losers, detached, notDuplicateOf }
  };
}

const DETACHED_EXTRA: Record<string, { table: PgTable; id: PgColumn; column: PgColumn }> = {
  'schedules.visit': { table: schedules, id: schedules.id, column: schedules.visitId }
};
const detachedSpec = (kind: string) => LEFT_POINTING[kind] ?? DETACHED_EXTRA[kind];

interface ExecuteOptions { set?: Loose; newContacts?: Loose[]; copyDetails: boolean; snap: Snapshot }

/** executeMerge's twin: remove the losers, pointing everything that referenced them at the survivor. */
async function executeMergePg(tx: Db, survivorId: string, loserIds: string[], { set = {}, newContacts = [], copyDetails, snap }: ExecuteOptions) {
  // 1. Move the history over.
  for (const loser of loserIds) {
    for (const ref of REFERENCES) {
      await tx.update(ref.table).set({ [ref.column.name === 'customer_id' ? 'customerId' : ref.column.name]: survivorId } as never).where(eq(ref.column, loser));
    }
    const pointingAll = (await tx.select({ id: customerLinks.customerId }).from(customerLinks)
      .where(and(eq(customerLinks.otherCustomerId, loser), eq(customerLinks.kind, 'associated')))).map(r => r.id);
    const pointing = pointingAll.filter(id => id !== survivorId);
    for (const id of pointingAll) await setLinkList(tx, id, 'associated', (await linkList(tx, id, 'associated')).filter(o => o !== loser));
    for (const id of pointing) {
      const list = await linkList(tx, id, 'associated');
      if (!list.includes(survivorId)) await setLinkList(tx, id, 'associated', [...list, survivorId]);
    }
  }

  // What would be left pointing at the removed records is blanked (MongoDB's copy blanks it).
  for (const d of snap.pg.detached) {
    const spec = detachedSpec(d.kind);
    await tx.update(spec.table).set({ [columnKey(spec.table, spec.column)]: null } as never).where(inArray(spec.id, d.ids));
  }

  // 2. Remove the duplicates. Their visits and resources go to the survivor on a merge,
  // and with the record on a delete.
  const survivorVisits = await tx.select({ p: sql<number>`coalesce(max(${visits.position}) + 1, 0)` }).from(visits).where(eq(visits.customerId, survivorId));
  const survivorResources = await tx.select({ p: sql<number>`coalesce(max(${resources.position}) + 1, 0)` }).from(resources).where(eq(resources.customerId, survivorId));
  let visitBase = Number(survivorVisits[0].p), resourceBase = Number(survivorResources[0].p);
  const inboundMarks = new Set<string>();
  for (const loser of snap.pg.losers) {
    const id = loser.customer.id as string;
    if (copyDetails) {
      for (const v of loser.visits) await tx.update(visits).set({ customerId: survivorId, position: visitBase + v.position }).where(eq(visits.id, v.id));
      for (const r of loser.resources) await tx.update(resources).set({ customerId: survivorId, position: resourceBase + r.position }).where(eq(resources.id, r.id));
      visitBase += loser.visits.length ? Math.max(...loser.visits.map(v => v.position as number)) + 1 : 0;
      resourceBase += loser.resources.length ? Math.max(...loser.resources.map(r => r.position as number)) + 1 : 0;
    } else {
      await tx.delete(resources).where(eq(resources.customerId, id));
      await tx.delete(visits).where(eq(visits.customerId, id));
    }
    for (const r of await tx.select({ id: customerLinks.customerId }).from(customerLinks).where(eq(customerLinks.otherCustomerId, id))) inboundMarks.add(r.id);
  }
  await tx.delete(customers).where(inArray(customers.id, loserIds));
  // The copy numbers a list's links from 0 among the customers that still exist.
  for (const id of inboundMarks) {
    if (loserIds.includes(id)) continue;
    for (const kind of KINDS) await setLinkList(tx, id, kind, await linkList(tx, id, kind));
  }

  if (!copyDetails) return;

  // 3. The survivor takes the better values and anything worth keeping.
  const patch: Loose = {};
  const text = (v: unknown) => (v == null ? '' : String(v));
  for (const [field, value] of Object.entries(set)) {
    if (field === 'email') patch.email = text(value).trim().toLowerCase();
    else if (field === 'contactName' || field === 'company' || field === 'phone') patch[field] = text(value);
    else if (field.startsWith('address.')) patch[field.slice('address.'.length)] = text(value);
    else if (field === 'salesRep') {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, String(value)));
      patch.salesRepId = u?.id ?? null;
    } else if (field === 'location') {
      const [l] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.name, text(value).trim()));
      if (l) patch.locationId = l.id;
    }
  }
  if (Object.keys(patch).length) await tx.update(customers).set(patch).where(eq(customers.id, survivorId));

  if (newContacts.length) {
    const [{ p }] = await tx.select({ p: sql<number>`coalesce(max(${customerContacts.position}) + 1, 0)` }).from(customerContacts).where(eq(customerContacts.customerId, survivorId));
    const [{ zone }] = await tx.select({ zone: locations.timeZone }).from(customers).innerJoin(locations, eq(locations.id, customers.locationId)).where(eq(customers.id, survivorId));
    await tx.insert(customerContacts).values(newContacts.map((c, i) => {
      const position = Number(p) + i;
      const at = toLocalTime(c.createdAt, zone);
      return {
        id: contactIdFor(survivorId, position), customerId: survivorId, position, name: text(c.name), phone: text(c.phone),
        email: text(c.email), role: text(c.role), notes: text(c.notes), isPrimary: !!c.isPrimary, createdAt: at.ok ? at.value : null
      };
    }));
  }

  const extraAssoc = [...new Set(snap.pg.losers.flatMap(l => listOf(l, 'associated')))].filter(id => id !== survivorId);
  if (extraAssoc.length) {
    const list = await linkList(tx, survivorId, 'associated');
    await setLinkList(tx, survivorId, 'associated', [...list, ...extraAssoc.filter(id => !list.includes(id))]);
  }

  // The losers' towers and binders now count on the survivor, on top of what it had counted before.
  if (snap.pg.losers.some(l => l.resources.length)) {
    const familyOf = familyLookup(await tx.select({ name: resourceTypes.name, family: resourceTypes.family }).from(resourceTypes));
    const before = snap.pg.survivor.customer;
    const asResource = (r: Loose) => ({ resourceType: r.resourceType, title: r.title, qty: r.qty ?? undefined, status: r.status });
    const earlier = earlierCount(modaCustomer(before), snap.pg.survivor.resources.map(asResource), familyOf);
    const merged = await tx.select().from(resources).where(eq(resources.customerId, survivorId)).orderBy(asc(resources.position));
    const f = modaFields(earlier, merged.map(asResource), familyOf);
    await tx.update(customers).set({
      modaDisplay: f.modaDisplay === 'Yes', modaBinders: Number(f.modaBinder),
      modaEarlierDisplay: f.modaEarlier.display, modaEarlierBinders: f.modaEarlier.binders
    }).where(eq(customers.id, survivorId));
  }
}

/**
 * The Moda fields as MongoDB holds them, from a customer row. Private on purpose:
 * src/services/modaCount.ts is getting its own Postgres twin; switch to it at merge.
 */
function modaCustomer(c: Loose) {
  return {
    modaDisplay: c.modaDisplay === true ? 'Yes' : c.modaDisplay === false ? 'No' : undefined,
    modaBinder: String(c.modaBinders ?? 0),
    modaEarlier: c.modaEarlierDisplay != null || c.modaEarlierBinders != null
      ? { display: c.modaEarlierDisplay ?? undefined, binders: c.modaEarlierBinders ?? undefined }
      : undefined
  };
}

export function columnKey(table: PgTable, column: PgColumn): string {
  for (const [key, col] of Object.entries(table as unknown as Record<string, unknown>)) if (col === column) return key;
  throw new Error(`column ${column.name} is not on its table`);
}

/** The fields planFields and contactsFromLosers read, from a customer row. */
async function planShape(tx: Db, id: string): Promise<Loose> {
  const [r] = await tx.select({ c: customers, locationName: locations.name, repUsername: users.username, repDisplayName: users.displayName })
    .from(customers)
    .leftJoin(locations, eq(locations.id, customers.locationId))
    .leftJoin(users, eq(users.id, customers.salesRepId))
    .where(eq(customers.id, id));
  const doc = customerDoc(r.c, r, { associated: [], notDuplicate: [] }, null);
  const contacts = await tx.select({ email: customerContacts.email }).from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(asc(customerContacts.position));
  return { ...doc, contacts };
}

/** markSeparate's twin. */
async function markSeparatePg(tx: Db, ids: string[]) {
  for (const id of ids) {
    const others = ids.filter(o => o !== id);
    if (!others.length) continue;
    const list = await linkList(tx, id, 'not_duplicate');
    await setLinkList(tx, id, 'not_duplicate', [...list, ...others.filter(o => !list.includes(o))]);
  }
}

export async function resolveDuplicates(db: Db, input: ResolveDuplicatesInput): Promise<ResolveDuplicatesResult> {
  const { keepId, actions, who, backupIds } = input;
  return db.transaction(async tx => {
    const ids = [keepId, ...actions.map(([id]) => id)];
    const found = new Set((await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, ids))).map(r => r.id));
    if (ids.some(id => !found.has(id))) return { missing: true } as const;

    const merging = actions.filter(([, a]) => a === 'merge').map(([id]) => id);
    const deleting = actions.filter(([, a]) => a === 'delete').map(([id]) => id);
    const separate = actions.filter(([, a]) => a === 'separate').map(([id]) => id);
    const undoIds: string[] = [];
    const now = new Date();
    const saveBackup = async (id: string, group: Snapshot, action: string) => {
      await tx.insert(customerMergeBackups).values({ id, group: JSON.parse(JSON.stringify(group)), action, createdBy: who, createdAt: now, updatedAt: now });
      undoIds.push(id);
    };

    if (deleting.length) {
      const snap = await snapshotMergePg(tx, keepId, deleting, false);
      await saveBackup(backupIds.delete, snap, 'delete');
      await executeMergePg(tx, keepId, deleting, { copyDetails: false, snap });
    }
    if (merging.length) {
      const current = await planShape(tx, keepId);
      const losers = await Promise.all(merging.map(id => planShape(tx, id)));
      const { set } = planFields(current, losers);
      const newContacts = contactsFromLosers(set.email ?? current.email, current, losers);
      const snap = await snapshotMergePg(tx, keepId, merging, true);
      await saveBackup(backupIds.merge, snap, 'merge');
      await executeMergePg(tx, keepId, merging, { set, newContacts, copyDetails: true, snap });
    }
    if (separate.length) await markSeparatePg(tx, [keepId, ...separate]);

    return { merged: merging.length, deleted: deleting.length, separate: separate.length, undoIds };
  });
}

// ── Undo ─────────────────────────────────────────────────────────────────────

/** undoMerge's twin, from the backup's `pg` rows. */
async function undoMergePg(tx: Db, group: Snapshot) {
  if (!group.pg) throw new Error('This was resolved before the move to Postgres and can only be undone on MongoDB.');
  const { pg } = group;
  // The removed records first, then what pointed at them.
  for (const loser of pg.losers) await restoreCustomer(tx, loser);
  for (const loser of pg.losers) {
    for (const kind of KINDS) await setLinkList(tx, loser.customer.id, kind, listOf(loser, kind));
  }
  for (const m of group.moved) {
    if (m.collection === 'customers') {
      for (const id of m.ids as string[]) if (await exists(tx, id)) await setLinkList(tx, id, 'associated', (await linkList(tx, id, 'associated')).filter(o => o !== group.survivorId));
      for (const id of m.ids as string[]) {
        if (!(await exists(tx, id))) continue;
        const list = await linkList(tx, id, 'associated');
        if (!list.includes(m.from)) await setLinkList(tx, id, 'associated', [...list, m.from]);
      }
    } else {
      const ref = REFERENCES.find(r => r.collection === m.collection)!;
      await tx.update(ref.table).set({ [columnKey(ref.table, ref.column)]: m.from } as never).where(inArray(ref.id, m.ids));
    }
  }
  // What MongoDB had left pointing at them points at them again.
  for (const d of pg.detached) {
    const spec = detachedSpec(d.kind);
    await tx.update(spec.table).set({ [columnKey(spec.table, spec.column)]: d.value } as never).where(inArray(spec.id, d.ids));
  }
  for (const mark of [...pg.notDuplicateOf].sort((a, b) => a.index - b.index)) {
    if (!(await exists(tx, mark.customerId))) continue;
    const list = await linkList(tx, mark.customerId, 'not_duplicate');
    if (list.includes(mark.other)) continue;
    list.splice(Math.min(Math.max(mark.index, 0), list.length), 0, mark.other);
    await setLinkList(tx, mark.customerId, 'not_duplicate', list);
  }
  // The survivor as it was (MongoDB's replaceOne: only if it's still there).
  if (await exists(tx, group.survivorId)) {
    await restoreCustomer(tx, pg.survivor);
    for (const kind of KINDS) await setLinkList(tx, group.survivorId, kind, listOf(pg.survivor, kind));
  }
}

export async function undoDuplicates(db: Db, ids: string[]): Promise<UndoDuplicatesResult> {
  return db.transaction(async tx => {
    const backups = await tx.select().from(customerMergeBackups)
      .where(and(inArray(customerMergeBackups.id, ids), isNull(customerMergeBackups.undoneAt)))
      .orderBy(desc(sql`${customerMergeBackups.id} collate "C"`));
    if (backups.length !== ids.length) return { alreadyUndone: true } as const;
    let restored = 0;
    for (const b of backups) {
      const group = b.group as Snapshot;
      await undoMergePg(tx, group);
      const now = new Date();
      await tx.update(customerMergeBackups).set({ undoneAt: now, updatedAt: now }).where(eq(customerMergeBackups.id, b.id));
      restored += group.losers?.length || 0;
    }
    return { restored };
  });
}
