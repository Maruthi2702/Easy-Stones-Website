/**
 * MongoDB customer documents → Postgres rows (src/db/schema/customers.ts):
 * the customer, its website login, contacts, customer↔customer links, visits
 * (with attachments, reactions and follow-up history) and resources (with
 * attachments). Schedules and the activity log are in linkedRows.ts.
 *
 * A link that points at nothing (a deleted customer, an unknown user) is
 * blanked or the row is skipped, and every one is reported — never guessed.
 */
import { createHash } from 'node:crypto';
import type { Loose } from '../../types/records.ts';
import type {
  customers, customerLogins, customerContacts, customerLinks, visits, visitAttachments,
  visitReactions, visitFollowUpEvents, resources, resourceAttachments
} from '../schema/customers.ts';
import type { ReferenceIndex } from './referenceRows.ts';
import { stamp } from './referenceRows.ts';
import { idOf, textOf, rowConverter, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

/** An id for a contact saved without one: from its customer and place in the list, so every run gives the same. */
export const contactIdFor = (customerId: string, position: number) =>
  createHash('sha1').update(`customer_contacts:${customerId}:${position}`).digest('hex').slice(0, 24);

export interface CustomerRows {
  customers: Row<typeof customers>[];
  customerLogins: Row<typeof customerLogins>[];
  customerContacts: Row<typeof customerContacts>[];
  customerLinks: Row<typeof customerLinks>[];
  visits: Row<typeof visits>[];
  visitAttachments: Row<typeof visitAttachments>[];
  visitReactions: Row<typeof visitReactions>[];
  visitFollowUpEvents: Row<typeof visitFollowUpEvents>[];
  resources: Row<typeof resources>[];
  resourceAttachments: Row<typeof resourceAttachments>[];
}

/** What schedules and the log check against. */
export interface CustomerIndex {
  customerIds: Set<string>;
  visitIds: Set<string>;
  zoneOfCustomer: (id: string | null) => string;
}

const numOrNull = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A visit's / resource's photos: legacy single string or an array, blanks dropped. */
export function attachmentUrls(image: unknown): string[] {
  if (typeof image === 'string') return image.trim() ? [image] : [];
  if (Array.isArray(image)) return image.filter((u): u is string => typeof u === 'string' && u.trim() !== '');
  return [];
}

export function customerRows(docs: Loose[], ref: ReferenceIndex, problems: CopyProblem[],
  options: { preserveSourceOrder?: boolean } = {}): { rows: CustomerRows; index: CustomerIndex } {
  const rows: CustomerRows = {
    customers: [], customerLogins: [], customerContacts: [], customerLinks: [], visits: [],
    visitAttachments: [], visitReactions: [], visitFollowUpEvents: [], resources: [], resourceAttachments: []
  };

  // Pass 1: which customers will exist, so links and "created by a customer" can be checked.
  const kept: { d: Loose; id: string; zone: string; locationId: string }[] = [];
  const customerIds = new Set<string>();
  const emails = new Set<string>();
  const zoneById = new Map<string, string>();
  for (const d of docs) {
    const id = idOf(d._id);
    const skip = (field: string, reason: string) => problems.push({ table: 'customers', id: id || String(d._id), field, reason, outcome: 'skipped' });
    if (!id) { skip('id', 'not an ObjectId'); continue; }
    const email = textOf(d.email).trim().toLowerCase();
    if (!email) { skip('email', 'no email'); continue; }
    if (emails.has(email)) { skip('email', 'email already used by another customer'); continue; }
    const locationId = ref.locationIdByName.get(textOf(d.location).trim());
    if (!locationId) { skip('location_id', 'branch is not a location'); continue; }
    emails.add(email);
    customerIds.add(id);
    const zone = ref.zoneOfLocation(textOf(d.location).trim());
    zoneById.set(id, zone);
    kept.push({ d, id, zone, locationId });
  }

  const who = (v: unknown) => {
    const id = idOf(v);
    if (id && ref.userIds.has(id)) return { userId: id, customerId: null };
    if (id && customerIds.has(id)) return { userId: null, customerId: id };
    return { userId: null, customerId: null, unknown: v != null && v !== '' };
  };

  const visitIds = new Set<string>();
  const resourceIds = new Set<string>();
  const contactIds = new Set<string>();
  const reactionIds = new Set<string>();
  const spsKeys = new Set<string>();
  const placed = new Set<string>();

  for (const { d, id, zone, locationId } of kept) {
    const c = rowConverter(problems, 'customers', id);
    const userLink = (field: string, v: unknown) => {
      const ref2 = idOf(v);
      if (v == null || v === '') return null;
      if (ref2 && ref.userIds.has(ref2)) return ref2;
      c.problem(field, 'not a user', 'blanked');
      return null;
    };

    let modaDisplay: boolean | null = null;
    if (d.modaDisplay === 'Yes') modaDisplay = true;
    else if (d.modaDisplay === 'No') modaDisplay = false;
    else if (d.modaDisplay != null && d.modaDisplay !== '') c.problem('moda_display', 'not Yes or No', 'blanked');
    let modaBinders = 0;
    if (d.modaBinder != null && d.modaBinder !== '') {
      if (/^\d+$/.test(String(d.modaBinder).trim())) modaBinders = Number(String(d.modaBinder).trim());
      else c.problem('moda_binders', 'not a whole number', 'blanked');
    }

    let spsKey: string | null = d.sps?.key ? String(d.sps.key) : null;
    if (spsKey && spsKeys.has(spsKey)) { c.problem('sps_key', 'SPS key already held by another customer', 'blanked'); spsKey = null; }
    if (spsKey) spsKeys.add(spsKey);

    const g = d.geocode || {};
    const a = d.address || {};
    const sps = d.sps || {};
    rows.customers.push({
      id, company: textOf(d.company), contactName: textOf(d.contactName), email: textOf(d.email).trim().toLowerCase(),
      // Only a snapshot copy assigns source ordinals. Saves leave this out: updates
      // retain their order and inserts/restores take the identity's next position.
      ...(options.preserveSourceOrder ? { matchOrder: rows.customers.length + 1 } : {}),
      marketingEmail: textOf(d.marketingEmail), receiveMarketing: d.receiveMarketing !== false, phone: textOf(d.phone),
      status: textOf(d.status) || 'Onboarded', customerType: d.customerType ? String(d.customerType) : null,
      level: textOf(d.level) || 'Level - 3', priceLevel: numOrNull(d.priceLevel) ?? 1,
      locationId, salesRepId: userLink('sales_rep_id', d.salesRep), createdById: userLink('created_by_id', d.createdBy),
      street: textOf(a.street), city: textOf(a.city), state: textOf(a.state), zipCode: textOf(a.zipCode),
      lat: numOrNull(d.coordinates?.lat), lng: numOrNull(d.coordinates?.lng),
      geocodeStatus: textOf(g.status) || 'pending', geocodePrecision: textOf(g.precision),
      geocodeFormattedAddress: textOf(g.formattedAddress), geocodeAddressKey: textOf(g.addressKey),
      geocodeUpdatedAt: c.moment('geocode_updated_at', g.updatedAt), geocodeError: textOf(g.error),
      modaDisplay, modaBinders,
      modaEarlierDisplay: typeof d.modaEarlier?.display === 'boolean' ? d.modaEarlier.display : null,
      modaEarlierBinders: numOrNull(d.modaEarlier?.binders),
      quickNote: textOf(d.quickNote), isVerified: !!d.isVerified, isActive: d.isActive !== false,
      spsKey, spsName: sps.name ?? null, spsCode: sps.code ?? null,
      spsFirstImportedAt: c.moment('sps_first_imported_at', sps.firstImportedAt),
      spsLastSeenAt: c.moment('sps_last_seen_at', sps.lastSeenAt),
      spsConnectedAt: c.moment('sps_connected_at', sps.connectedAt),
      spsConnectedBy: sps.connectedBy ?? null, spsReviewedAs: sps.reviewedAs ?? null, spsRunId: sps.runId ?? null,
      ...stamp(c, d)
    });

    const loginIps = Array.isArray(d.loginIps) ? d.loginIps.filter((x: unknown): x is string => typeof x === 'string') : [];
    if (d.password || (numOrNull(d.loginAttempts) ?? 0) > 0 || d.lockUntil || loginIps.length) {
      rows.customerLogins.push({
        customerId: id, passwordHash: d.password ? String(d.password) : null,
        loginAttempts: numOrNull(d.loginAttempts) ?? 0, lockUntil: c.moment('lock_until', d.lockUntil), loginIps
      });
    }

    (Array.isArray(d.contacts) ? d.contacts : []).forEach((ct: Loose, position: number) => {
      let cid = idOf(ct?._id);
      if (!cid && ct && typeof ct === 'object') {
        cid = contactIdFor(id, position);
        problems.push({ table: 'customer_contacts', id: cid, field: 'id', reason: `no id, given a new one (customer ${id}, contact ${position + 1})`, outcome: 'kept' });
      }
      if (!cid || contactIds.has(cid)) { problems.push({ table: 'customer_contacts', id, field: 'id', reason: cid ? 'id used twice' : 'not a contact', outcome: 'skipped' }); return; }
      contactIds.add(cid);
      const cc = rowConverter(problems, 'customer_contacts', cid);
      rows.customerContacts.push({
        id: cid, customerId: id, position, name: textOf(ct.name), phone: textOf(ct.phone), email: textOf(ct.email),
        role: textOf(ct.role), notes: textOf(ct.notes), isPrimary: !!ct.isPrimary, createdAt: cc.localTime('created_at', ct.createdAt, zone)
      });
    });

    for (const [kind, list] of [['associated', d.associatedCustomers], ['not_duplicate', d.notDuplicateOf]] as const) {
      const seen = new Set<string>();
      (Array.isArray(list) ? list : []).forEach((raw: unknown) => {
        const other = idOf(raw);
        if (!other || other === id || seen.has(other)) return;
        if (!customerIds.has(other)) { c.problem(`customer_links.${kind}`, 'linked customer does not exist', 'skipped'); return; }
        seen.add(other);
        rows.customerLinks.push({ customerId: id, otherCustomerId: other, kind, position: seen.size - 1 });
      });
    }

    // Visits (the resource ↔ visit placement link is settled after resources).
    const visitResourceClaims = new Map<string, string>();
    const ownVisitIds = new Set<string>();
    (Array.isArray(d.visits) ? d.visits : []).forEach((v: Loose, position: number) => {
      const vid = idOf(v?._id);
      if (!vid || visitIds.has(vid)) { problems.push({ table: 'visits', id: vid || id, field: 'id', reason: vid ? 'id used twice' : 'no id', outcome: 'skipped' }); return; }
      const vc = rowConverter(problems, 'visits', vid);
      const visitDate = vc.day('visit_date', v.date, zone);
      if (!visitDate) { vc.problem('visit_date', 'no visit day', 'skipped'); return; }
      visitIds.add(vid);
      ownVisitIds.add(vid);
      if (v.purpose && !ref.visitTypeNames.has(v.purpose)) vc.problem('visit_type', 'not on the Visit Types list (legacy name kept)', 'kept');
      const by = who(v.createdBy); const upd = who(v.updatedBy); const done = who(v.followUpDoneBy);
      if (by.unknown) vc.problem('created_by_id', 'neither a user nor a customer', 'blanked');
      if (upd.unknown) vc.problem('updated_by_id', 'neither a user nor a customer', 'blanked');
      if (done.unknown || done.customerId) vc.problem('follow_up_done_by_id', 'not a user', 'blanked');
      let createdAt = vc.localTime('created_at', v.createdAt, zone);
      if (!createdAt) { createdAt = `${visitDate} 00:00:00.000`; vc.problem('created_at', 'no time saved: the visit day at midnight', 'converted'); }
      const rid = idOf(v.resourceId);
      if (rid) visitResourceClaims.set(vid, rid);
      rows.visits.push({
        id: vid, customerId: id, position, visitDate, visitType: textOf(v.purpose),
        customerContactName: textOf(v.customerContactName), notes: textOf(v.notes), outcome: textOf(v.outcome),
        managerComment: textOf(v.managerComment), headquartersComment: textOf(v.headquartersComment),
        followUp: textOf(v.followUp), followUpDate: vc.day('follow_up_date', v.followUpDate, zone),
        followUpDoneAt: vc.localTime('follow_up_done_at', v.followUpDoneAt, zone),
        followUpDoneOn: vc.day('follow_up_done_on', v.followUpDoneOn, zone),
        followUpDoneById: done.userId, followUpDoneByName: textOf(v.followUpDoneByName), followUpOutcome: textOf(v.followUpOutcome),
        createdById: by.userId, createdByCustomerId: by.customerId, createdByName: textOf(v.createdByName), createdAt,
        updatedById: upd.userId, updatedByCustomerId: upd.customerId, updatedByName: textOf(v.updatedByName),
        updatedAt: vc.localTime('updated_at', v.updatedAt, zone)
      });
      attachmentUrls(v.image).forEach((url, i) => rows.visitAttachments.push({ visitId: vid, position: i, url }));
      (Array.isArray(v.reactions) ? v.reactions : []).forEach((r: Loose, i: number) => {
        const rid2 = idOf(r?._id);
        if (!rid2 || reactionIds.has(rid2) || !r.type) { vc.problem('visit_reactions', 'reaction without an id or type', 'skipped'); return; }
        reactionIds.add(rid2);
        const rw = who(r.userId);
        rows.visitReactions.push({
          id: rid2, visitId: vid, position: i, type: String(r.type), userId: rw.userId, customerId: rw.customerId,
          userName: textOf(r.userName), createdAt: rowConverter(problems, 'visit_reactions', rid2).localTime('created_at', r.createdAt, zone)
        });
      });
      (Array.isArray(v.followUpHistory) ? v.followUpHistory : []).forEach((h: Loose, i: number) => {
        const at = vc.localTime('visit_follow_up_events.at', h?.at, zone);
        if (!at || !h.action) { vc.problem('visit_follow_up_events', 'history entry without a time or action', 'skipped'); return; }
        const hb = who(h.by);
        rows.visitFollowUpEvents.push({
          visitId: vid, position: i, action: String(h.action), at,
          onDay: vc.day('visit_follow_up_events.on', h.on, zone), byId: hb.userId, byName: textOf(h.byName),
          fromDay: vc.day('visit_follow_up_events.from', h.from, zone), toDay: vc.day('visit_follow_up_events.to', h.to, zone)
        });
      });
    });

    (Array.isArray(d.resources) ? d.resources : []).forEach((r: Loose, position: number) => {
      const rid = idOf(r?._id);
      if (!rid || resourceIds.has(rid)) { problems.push({ table: 'resources', id: rid || id, field: 'id', reason: rid ? 'id used twice' : 'no id', outcome: 'skipped' }); return; }
      resourceIds.add(rid);
      const rc = rowConverter(problems, 'resources', rid);
      let resourceType: string | null = r.resourceType ? String(r.resourceType) : null;
      if (resourceType && !ref.resourceTypeNames.has(resourceType)) { rc.problem('resource_type', 'not a resource type', 'blanked'); resourceType = null; }
      let qty = numOrNull(r.qty);
      if (qty != null && (!Number.isInteger(qty) || qty < 1 || qty > 999)) { rc.problem('qty', 'not a whole number 1–999', 'blanked'); qty = null; }
      // The placement visit: the resource's own link, else a visit on this customer that names it.
      let placement = idOf(r.visitId);
      if (placement && !ownVisitIds.has(placement)) { rc.problem('placement_visit_id', 'placement visit is not on this customer', 'blanked'); placement = null; }
      if (!placement) {
        const claim = [...visitResourceClaims].find(([, res]) => res === rid);
        if (claim) { placement = claim[0]; rc.problem('placement_visit_id', 'taken from the visit side of the link', 'converted'); }
      }
      if (placement && placed.has(placement)) { rc.problem('placement_visit_id', 'visit already places another resource', 'blanked'); placement = null; }
      if (placement) placed.add(placement);
      // Dashboard/profile ownership accepts legacy createdBy when uploadedBy is null/missing.
      const uploaderValue = r.uploadedBy ?? r.createdBy;
      const uploader = idOf(uploaderValue);
      if (uploaderValue && !(uploader && ref.userIds.has(uploader))) rc.problem('uploaded_by_id', 'not a user', 'blanked');
      rows.resources.push({
        id: rid, customerId: id, position, placementVisitId: placement, resourceType,
        resourceDate: rc.day('resource_date', r.date, zone), title: textOf(r.title), description: textOf(r.description),
        notes: textOf(r.notes), status: textOf(r.status) || 'Active', qty, url: textOf(r.url),
        uploadedById: uploader && ref.userIds.has(uploader) ? uploader : null,
        createdAt: rc.localTime('created_at', r.createdAt, zone)
      });
      attachmentUrls(r.image).forEach((url, i) => rows.resourceAttachments.push({ resourceId: rid, position: i, url }));
    });
    for (const [vid, rid] of visitResourceClaims) {
      if (!rows.resources.some(r => r.id === rid && r.placementVisitId === vid)) {
        problems.push({ table: 'visits', id: vid, field: 'resource_id', reason: 'names a resource that does not point back to it', outcome: 'blanked' });
      }
    }
  }

  return { rows, index: { customerIds, visitIds, zoneOfCustomer: cid => (cid && zoneById.get(cid)) || 'America/Los_Angeles' } };
}
