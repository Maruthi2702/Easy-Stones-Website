/**
 * A Postgres customer row → the customer record the API has always sent (MongoDB's
 * shape: `_id`, `address: {…}`, `location` as the branch's name, `salesRepName`,
 * `modaDisplay: 'Yes'`…). The screens never learn which database answered.
 *
 * What MongoDB stored as copies is read by a join now (src/db/README.md): the
 * branch name from `locations`, the rep's name from `users` (displayNameOf, the
 * rule every rep name follows).
 */
import type { customers, customerLogins } from '../schema/customers.ts';
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
