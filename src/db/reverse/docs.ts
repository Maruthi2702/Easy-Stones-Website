/**
 * Postgres rows → the MongoDB documents the app wrote before the move (the reverse copy,
 * src/db/reverse/README.md). The inverse of src/db/copy/customerRows.ts, linkedRows.ts
 * and miscRows.ts for the customer area; the field-by-field reading half already exists
 * in src/db/customers/customerDoc.ts, so the shapes the screens saw and the shapes
 * written back here cannot drift apart.
 */
import { ObjectId, Binary } from 'mongodb';
import { EJSON } from 'bson';
import type { Loose } from '../../types/records.ts';
import type * as S from '../schema/index.ts';
import { customerDoc, contactDoc, visitDoc, resourceDoc, reactionDoc, followUpEventDoc, nonNull, type CustomerJoins } from '../customers/customerDoc.ts';

type Rows<T extends { $inferSelect: unknown }> = T['$inferSelect'][];

/** Everything the reverse copy reads from Postgres. */
export interface ReverseSource {
  locations: Rows<typeof S.locations>;
  users: Rows<typeof S.users>;
  customers: Rows<typeof S.customers>;
  customerLogins: Rows<typeof S.customerLogins>;
  customerContacts: Rows<typeof S.customerContacts>;
  customerLinks: Rows<typeof S.customerLinks>;
  visits: Rows<typeof S.visits>;
  visitAttachments: Rows<typeof S.visitAttachments>;
  visitReactions: Rows<typeof S.visitReactions>;
  visitFollowUpEvents: Rows<typeof S.visitFollowUpEvents>;
  resources: Rows<typeof S.resources>;
  resourceAttachments: Rows<typeof S.resourceAttachments>;
  schedules: Rows<typeof S.schedules>;
  activityLogs: Rows<typeof S.activityLogs>;
  customerDeleteBackups: Rows<typeof S.customerDeleteBackups>;
  customerMergeBackups: Rows<typeof S.customerMergeBackups>;
  importMemories: Rows<typeof S.importMemories>;
  spsImportRuns: Rows<typeof S.spsImportRuns>;
  spsImportItems: Rows<typeof S.spsImportItems>;
}

/** MongoDB collection → documents, for the collections this copy owns. */
export type ReverseDocs = Record<(typeof REVERSE_COLLECTIONS)[number], Loose[]>;
export const REVERSE_COLLECTIONS = [
  'customers', 'schedules', 'activitylogs', 'customerdeletebackups', 'customermergebackups',
  'importmemories', 'spsimportruns', 'spsimportitems'
] as const;

const oid = (v: unknown): ObjectId | undefined => (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) ? new ObjectId(v) : undefined);
/** Set the named fields of a document to ObjectIds where they hold a 24-character id. */
function asIds(doc: Loose, fields: string[]): Loose {
  for (const f of fields) if (f in doc) { const id = oid(doc[f]); if (id) doc[f] = id; }
  return doc;
}
const group = <T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (k == null) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};
const byPosition = <T extends { position: number }>(rows: T[] | undefined) => [...(rows ?? [])].sort((a, b) => a.position - b.position);

/** A Postgres local clock as the text MongoDB held: 'YYYY-MM-DDTHH:MM:SS.mmm'. */
const isoLocal = (v: string | null) => {
  if (v == null) return null;
  const [clock, fraction = ''] = v.replace(' ', 'T').split('.');
  return `${clock}.${fraction.padEnd(3, '0')}`;
};

export function reverseDocs(src: ReverseSource): ReverseDocs {
  const locName = new Map(src.locations.map(l => [l.id, l.name]));
  const userById = new Map(src.users.map(u => [u.id, u]));
  const loginOf = new Map(src.customerLogins.map(l => [l.customerId, l]));
  const contactsOf = group(src.customerContacts, c => c.customerId);
  const linksOf = group(src.customerLinks, l => l.customerId);
  const visitsOf = group(src.visits, v => v.customerId);
  const resourcesOf = group(src.resources, r => r.customerId);
  const photosOfVisit = group(src.visitAttachments, a => a.visitId);
  const photosOfResource = group(src.resourceAttachments, a => a.resourceId);
  const reactionsOf = group(src.visitReactions, r => r.visitId);
  const eventsOf = group(src.visitFollowUpEvents, e => e.visitId);
  const visitOfResource = new Map<string, string>();
  for (const r of src.resources) if (r.placementVisitId) visitOfResource.set(r.placementVisitId, r.id);

  const customers = src.customers.map(c => {
    const rep = c.salesRepId ? userById.get(c.salesRepId) : undefined;
    const joins: CustomerJoins = {
      locationName: locName.get(c.locationId) ?? null,
      repUsername: rep ? rep.username : null,
      repDisplayName: rep ? rep.displayName : null
    };
    const links = linksOf.get(c.id) ?? [];
    const kinds = (kind: string) => byPosition(links.filter(l => l.kind === kind)).map(l => l.otherCustomerId);
    const login = loginOf.get(c.id) ?? null;
    const doc = customerDoc(c, joins, { associated: kinds('associated'), notDuplicate: kinds('not_duplicate') }, login);
    if (login?.passwordHash) doc.password = login.passwordHash;
    if (login?.loginIps?.length) doc.lastLoginIp = login.loginIps[login.loginIps.length - 1];
    if (doc.coordinates && doc.coordinates.lat == null && doc.coordinates.lng == null) delete doc.coordinates;
    if (!doc.associatedCustomers.length) delete doc.associatedCustomers;
    if (!doc.notDuplicateOf.length) delete doc.notDuplicateOf;
    // The model's own default for a customer who has none yet.
    doc.contacts = byPosition(contactsOf.get(c.id)).map(ct => asIds(contactDoc(ct), ['_id']));
    doc.visits = byPosition(visitsOf.get(c.id)).map(v => asIds(visitDoc(v,
      byPosition(photosOfVisit.get(v.id)).map(a => a.url),
      byPosition(reactionsOf.get(v.id)).map(r => reactionDoc(r)).map(r => asIds(r, ['_id'])),
      byPosition(eventsOf.get(v.id)).map(e => followUpEventDoc(e)),
      visitOfResource.get(v.id) ?? null), ['_id', 'resourceId']));
    doc.resources = byPosition(resourcesOf.get(c.id)).map(r => asIds(resourceDoc(r, byPosition(photosOfResource.get(r.id)).map(a => a.url), c.company || c.contactName || ''), ['_id', 'visitId']));
    asIds(doc, ['_id', 'salesRep', 'createdBy']);
    return doc;
  });

  const clock = (legacy: { kind: 'date' | 'string'; value: string } | null, canonical: string | null): Date | string | undefined => {
    if (legacy) return legacy.kind === 'date' ? new Date(legacy.value) : legacy.value;
    return canonical == null ? undefined : isoLocal(canonical)!;
  };
  const schedules = src.schedules.map(s => nonNull(asIds({
    _id: s.id, userId: s.userId, customerId: s.customerId, startTime: clock(s.legacyStartTime, s.startsAt),
    endTime: clock(s.legacyEndTime, s.endsAt), activityType: s.activityType, notes: s.notes, status: s.status,
    linkedVisitId: s.visitId, source: s.source, createdAt: s.createdAt, updatedAt: s.updatedAt
  }, ['_id', 'userId', 'customerId', 'linkedVisitId'])));

  const activitylogs = src.activityLogs.map(a => {
    return nonNull(asIds({
      _id: a.id, entityType: a.entityType, entityId: a.entityId, customerId: a.customerId, action: a.action,
      performedBy: a.performedBy, performedByName: a.performedByName, performedByRole: a.performedByRole,
      details: a.details, timestamp: isoLocal(a.loggedAt)
    }, ['_id', 'entityId', 'customerId']));
  });

  const snapshot = (j: unknown) => EJSON.deserialize(j as Loose, { relaxed: true }) as Loose;
  const customerdeletebackups = src.customerDeleteBackups.map(b => nonNull(asIds({
    _id: b.id, batchId: b.batchId, customerId: b.customerId, customer: snapshot(b.customer), source: b.source,
    deletedBy: b.deletedBy, spsKeepDeleted: b.spsKeepDeleted, spsKeepRun: b.spsKeepRun, undoneAt: b.undoneAt,
    undoneBy: b.undoneBy, createdAt: b.createdAt, updatedAt: b.updatedAt
  }, ['_id', 'customerId'])));
  const customermergebackups = src.customerMergeBackups.map(b => nonNull(asIds({
    _id: b.id, group: snapshot(b.group), action: b.action, createdBy: b.createdBy, undoneAt: b.undoneAt,
    createdAt: b.createdAt, updatedAt: b.updatedAt
  }, ['_id'])));
  const importmemories = src.importMemories.map(m => nonNull(asIds({
    _id: m.id, kind: m.kind, repAliases: m.repAliases, branchAliases: m.branchAliases, decisions: m.decisions,
    updatedBy: m.updatedBy, createdAt: m.createdAt, updatedAt: m.updatedAt
  }, ['_id'])));
  const spsimportruns = src.spsImportRuns.map(r => nonNull(asIds({
    _id: r.id, fileName: r.fileName, fingerprint: r.fingerprint, file: r.file ? new Binary(Buffer.from(r.file)) : null,
    createdBy: r.createdBy, createdById: r.createdById, status: r.status, mapping: r.mapping, repAliases: r.repAliases,
    branchAliases: r.branchAliases, answers: r.answers, fileCheck: r.fileCheck, rowsRead: r.rowsRead, total: r.total,
    done: r.done, results: r.results, planCounts: r.planCounts, verify: r.verify, error: r.error, startedAt: r.startedAt,
    finishedAt: r.finishedAt, undoneAt: r.undoneAt, undoneBy: r.undoneBy, __v: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt
  }, ['_id'])));
  const spsimportitems = src.spsImportItems.map(i => nonNull(asIds({
    _id: i.id, runId: i.runId, seq: i.seq, key: i.key, rowNumber: i.rowNumber, name: i.name, action: i.action,
    customerId: i.customerId, connect: i.connect, create: i.create, apply: i.apply, before: i.before, unset: i.unset,
    changes: i.changes, deleted: i.deleted, warnings: i.warnings, state: i.state, result: i.result, reason: i.reason,
    createdId: i.createdId, __v: i.version
  }, ['_id'])));

  return { customers, schedules, activitylogs, customerdeletebackups, customermergebackups, importmemories, spsimportruns, spsimportitems };
}
