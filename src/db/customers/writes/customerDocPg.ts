/**
 * Helpers for Postgres twins that save a customer as MongoDB would have saved it
 * (imports, SPS runs): a whole MongoDB-shaped customer document → the rows the copy
 * would make of it, so the result is what `copyFromMongo` would produce by construction.
 */
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import {
  customers, customerLogins, customerContacts, customerLinks, visits, visitAttachments,
  visitReactions, visitFollowUpEvents, resources, resourceAttachments
} from '../../schema/customers.ts';
import { locations, users, resourceTypes, visitTypes } from '../../schema/reference.ts';
import { customerRows } from '../../copy/customerRows.ts';
import { idOf } from '../../copy/values.ts';
import { branchZone } from '../../../config/branches.ts';
import type { ReferenceIndex } from '../../copy/referenceRows.ts';
import type { Loose } from '../../../types/records.ts';

/** What the row builders look names up in, read from Postgres. */
export async function referenceIndexFromPg(db: Db): Promise<ReferenceIndex> {
  const locs = await db.select({ id: locations.id, name: locations.name }).from(locations);
  const locationIdByName = new Map(locs.map(l => [l.name, l.id]));
  return {
    locationIdByName,
    zoneOfLocation: name => branchZone(typeof name === 'string' ? name : ''),
    userIds: new Set((await db.select({ id: users.id }).from(users)).map(u => u.id)),
    zoneOfUser: () => 'America/Los_Angeles',
    resourceTypeNames: new Set((await db.select({ n: resourceTypes.name }).from(resourceTypes)).map(r => r.n)),
    visitTypeNames: new Set((await db.select({ n: visitTypes.name }).from(visitTypes)).map(r => r.n))
  };
}

/**
 * Insert a MongoDB-shaped customer (as `doc.toObject()` or a stored document) with its
 * login, contacts, visits and resources. Links to other customers are kept only where
 * that customer exists, numbered from 0, as the copy numbers them.
 * `createdAt` / `updatedAt` must be on the document (a Mongoose insert stamps them).
 * Throws what Postgres throws (a held email or SPS key is a unique violation).
 * Returns false when the copy would have left the customer out (no email, unknown branch).
 */
export async function insertCustomerDoc(tx: Db, doc: Loose, ref?: ReferenceIndex): Promise<boolean> {
  const index = ref ?? await referenceIndexFromPg(tx);
  const { rows } = customerRows([{ ...doc, associatedCustomers: [], notDuplicateOf: [] }], index, []);
  if (!rows.customers.length) return false;
  const id = rows.customers[0].id as string;
  await tx.insert(customers).values(rows.customers);
  if (rows.customerLogins.length) await tx.insert(customerLogins).values(rows.customerLogins);
  if (rows.customerContacts.length) await tx.insert(customerContacts).values(rows.customerContacts);
  if (rows.visits.length) await tx.insert(visits).values(rows.visits);
  if (rows.visitAttachments.length) await tx.insert(visitAttachments).values(rows.visitAttachments);
  if (rows.visitReactions.length) await tx.insert(visitReactions).values(rows.visitReactions);
  if (rows.visitFollowUpEvents.length) await tx.insert(visitFollowUpEvents).values(rows.visitFollowUpEvents);
  if (rows.resources.length) await tx.insert(resources).values(rows.resources);
  if (rows.resourceAttachments.length) await tx.insert(resourceAttachments).values(rows.resourceAttachments);
  for (const [kind, list] of [['associated', doc.associatedCustomers], ['not_duplicate', doc.notDuplicateOf]] as const) {
    const wanted = [...new Set((Array.isArray(list) ? list : []).map(idOf).filter((o): o is string => !!o && o !== id))];
    if (!wanted.length) continue;
    const there = new Set((await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, wanted))).map(r => r.id));
    const kept = wanted.filter(o => there.has(o));
    if (kept.length) await tx.insert(customerLinks).values(kept.map((other, position) => ({ customerId: id, otherCustomerId: other, kind, position })));
  }
  return true;
}

/** True for a Postgres unique violation (23505), however the driver wraps it. */
export const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
};
/** The constraint a unique violation names. */
export const violatedConstraint = (err: unknown): string => {
  const e = err as { constraint?: string; constraint_name?: string; cause?: { constraint?: string; constraint_name?: string } } | null;
  return e?.constraint ?? e?.constraint_name ?? e?.cause?.constraint ?? e?.cause?.constraint_name ?? '';
};

type Patch = Record<string, unknown>;

const day = (v: unknown): Date | null => (v == null || v === '' ? null : new Date(v as string));
const text = (v: unknown) => (v == null ? '' : String(v));

/**
 * A Mongo `$set` (dotted paths, as the import plans write them) → the customers
 * row's columns. Only the paths an import can set; salesRepName is a join now, and
 * a branch that isn't a location is left alone. `unset` paths go back to what a
 * missing field reads as in the copy.
 */
export async function customerPatch(tx: Db, set: Loose = {}, unset: string[] = []): Promise<Patch> {
  const patch: Patch = {};
  const put = async (path: string, value: unknown) => {
    switch (path) {
      case 'sps.key': patch.spsKey = value == null ? null : String(value); break;
      case 'sps.name': patch.spsName = value == null ? null : String(value); break;
      case 'sps.code': patch.spsCode = value == null ? null : String(value); break;
      case 'sps.firstImportedAt': patch.spsFirstImportedAt = day(value); break;
      case 'sps.lastSeenAt': patch.spsLastSeenAt = day(value); break;
      case 'sps.connectedAt': patch.spsConnectedAt = day(value); break;
      case 'sps.connectedBy': patch.spsConnectedBy = value == null ? null : String(value); break;
      case 'sps.reviewedAs': patch.spsReviewedAs = value == null ? null : String(value); break;
      case 'sps.runId': patch.spsRunId = value == null ? null : String(value); break;
      case 'salesRep': {
        const id = idOf(value);
        patch.salesRepId = id && (await tx.select({ id: users.id }).from(users).where(eq(users.id, id))).length ? id : null;
        break;
      }
      case 'salesRepName': break;
      case 'location': {
        const [l] = await tx.select({ id: locations.id }).from(locations).where(eq(locations.name, text(value).trim()));
        if (l) patch.locationId = l.id;
        break;
      }
      case 'email': patch.email = text(value).trim().toLowerCase(); break;
      case 'company': case 'contactName': case 'phone': case 'quickNote': patch[path] = text(value); break;
      case 'address.street': patch.street = text(value); break;
      case 'address.city': patch.city = text(value); break;
      case 'address.state': patch.state = text(value); break;
      case 'address.zipCode': patch.zipCode = text(value); break;
      case 'geocode.status': patch.geocodeStatus = text(value) || 'pending'; break;
      default: throw new Error(`customerPatch: no column for ${path}`);
    }
  };
  for (const [path, value] of Object.entries(set)) await put(path, value);
  for (const path of unset) {
    const blank: Loose = { 'geocode.status': 'pending', email: '' };
    if (path === 'location') continue;
    await put(path, path.startsWith('sps.') || path === 'salesRep' ? null : (blank[path] ?? ''));
  }
  return patch;
}
