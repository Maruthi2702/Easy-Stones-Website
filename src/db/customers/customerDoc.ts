/**
 * A Postgres customer row → the customer record the API has always sent (MongoDB's
 * shape: `_id`, `address: {…}`, `location` as the branch's name, `salesRepName`,
 * `modaDisplay: 'Yes'`…). The screens never learn which database answered.
 *
 * What MongoDB stored as copies is read by a join now (src/db/README.md): the
 * branch name from `locations`, the rep's name from `users` (displayNameOf, the
 * rule every rep name follows).
 */
import type { customers, customerLogins, customerContacts, visits, resources, visitReactions, visitFollowUpEvents } from '../schema/customers.ts';
import type { Loose } from '../../types/records.ts';
import { displayNameOf } from '../../utils/salesReps.ts';

type CustomerRow = typeof customers.$inferSelect;
type LoginRow = typeof customerLogins.$inferSelect;

export interface CustomerJoins {
  locationName: string | null;
  repUsername: string | null;
  repDisplayName: string | null;
}

export interface CustomerLinks {
  associated: string[];
  notDuplicate: string[];
}

/** The rep's name as every screen shows it, '' when the account has no rep. */
export const repNameOf = (j: Pick<CustomerJoins, 'repUsername' | 'repDisplayName'>) =>
  j.repUsername == null ? '' : displayNameOf({ username: j.repUsername, displayName: j.repDisplayName });

const modaDisplayText = (v: boolean | null) => (v === true ? 'Yes' : v === false ? 'No' : undefined);

function spsOf(c: CustomerRow): Loose | undefined {
  const sps: Loose = {
    key: c.spsKey, name: c.spsName, code: c.spsCode, firstImportedAt: c.spsFirstImportedAt,
    lastSeenAt: c.spsLastSeenAt, connectedAt: c.spsConnectedAt, connectedBy: c.spsConnectedBy,
    reviewedAs: c.spsReviewedAs, runId: c.spsRunId
  };
  for (const k of Object.keys(sps)) if (sps[k] == null) delete sps[k];
  return Object.keys(sps).length ? sps : undefined;
}

/**
 * The whole customer as GET /api/customers sends it: everything but the password,
 * contacts, visits and resources.
 */
export function customerDoc(c: CustomerRow, j: CustomerJoins, links: CustomerLinks, login: LoginRow | null): Loose {
  const doc: Loose = {
    _id: c.id,
    contactName: c.contactName,
    email: c.email,
    marketingEmail: c.marketingEmail,
    receiveMarketing: c.receiveMarketing,
    status: c.status,
    customerType: c.customerType,
    level: c.level,
    modaDisplay: modaDisplayText(c.modaDisplay),
    modaBinder: String(c.modaBinders),
    createdBy: c.createdById,
    salesRep: c.salesRepId,
    salesRepName: repNameOf(j),
    location: j.locationName ?? '',
    company: c.company,
    phone: c.phone,
    address: { street: c.street, city: c.city, state: c.state, zipCode: c.zipCode },
    coordinates: { lat: c.lat, lng: c.lng },
    geocode: {
      status: c.geocodeStatus, precision: c.geocodePrecision, formattedAddress: c.geocodeFormattedAddress,
      addressKey: c.geocodeAddressKey, updatedAt: c.geocodeUpdatedAt, error: c.geocodeError
    },
    isVerified: c.isVerified,
    isActive: c.isActive,
    priceLevel: c.priceLevel,
    loginAttempts: login?.loginAttempts ?? 0,
    lockUntil: login?.lockUntil ?? undefined,
    loginIps: login?.loginIps ?? [],
    quickNote: c.quickNote,
    associatedCustomers: links.associated,
    notDuplicateOf: links.notDuplicate,
    sps: spsOf(c),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
  if (c.modaEarlierDisplay != null || c.modaEarlierBinders != null) {
    doc.modaEarlier = {};
    if (c.modaEarlierDisplay != null) doc.modaEarlier.display = c.modaEarlierDisplay;
    if (c.modaEarlierBinders != null) doc.modaEarlier.binders = c.modaEarlierBinders;
  }
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  return doc;
}

/** Timestamp-without-zone is the writer's clock, not a UTC instant. */
const localClock = (value: string | null) => {
  if (value == null) return null;
  const [clock, fraction = ''] = value.replace(' ', 'T').split('.');
  return `${clock}.${fraction.padEnd(3, '0')}`;
};
const nonNull = (doc: Loose): Loose => Object.fromEntries(Object.entries(doc).filter(([, value]) => value != null));

export function contactDoc(c: typeof customerContacts.$inferSelect): Loose {
  return nonNull({ _id: c.id, name: c.name, phone: c.phone, email: c.email, role: c.role, notes: c.notes,
    ...(c.isPrimary ? { isPrimary: true } : {}), createdAt: localClock(c.createdAt) });
}

export function reactionDoc(r: typeof visitReactions.$inferSelect): Loose {
  return nonNull({ _id: r.id, type: r.type, userId: r.userId ?? r.customerId, userName: r.userName, createdAt: localClock(r.createdAt) });
}

export function followUpEventDoc(h: typeof visitFollowUpEvents.$inferSelect): Loose {
  return nonNull({ action: h.action, at: localClock(h.at), on: h.onDay, by: h.byId, byName: h.byName, from: h.fromDay, to: h.toDay });
}

export function visitDoc(v: typeof visits.$inferSelect, image: string[], reactions: Loose[], followUpHistory: Loose[], resourceId: string | null): Loose {
  return nonNull({ _id: v.id, resourceId, date: v.visitDate, purpose: v.visitType, customerContactName: v.customerContactName,
    notes: v.notes, outcome: v.outcome, managerComment: v.managerComment, headquartersComment: v.headquartersComment,
    followUp: v.followUp, followUpDate: v.followUpDate, followUpDoneAt: localClock(v.followUpDoneAt),
    followUpDoneOn: v.followUpDoneOn, followUpDoneBy: v.followUpDoneById, followUpDoneByName: v.followUpDoneByName,
    followUpOutcome: v.followUpOutcome, followUpHistory, image, reactions,
    createdBy: v.createdById ?? v.createdByCustomerId, createdByName: v.createdByName, createdAt: localClock(v.createdAt),
    updatedBy: v.updatedById ?? v.updatedByCustomerId, updatedByName: v.updatedByName, updatedAt: localClock(v.updatedAt) });
}

export function resourceDoc(r: typeof resources.$inferSelect, image: string[], customer: string): Loose {
  return nonNull({ _id: r.id, visitId: r.placementVisitId, date: r.resourceDate, customer,
    resourceType: r.resourceType, qty: r.qty, title: r.title, image, description: r.description, notes: r.notes,
    status: r.status, url: r.url, uploadedBy: r.uploadedById, createdAt: localClock(r.createdAt) });
}
