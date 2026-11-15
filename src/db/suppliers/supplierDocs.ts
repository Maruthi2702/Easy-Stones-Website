/** Postgres rows → the records MongoDB held (the shape the routes, the views and the screens read). */
import type {
  suppliers, supplierHistory, supplierLogins, supplierPos, supplierPoLines, supplierPoHistory, supplierBlocks, supplierBundles, supplierBlockHistory
} from '../schema/cardsSuppliers.ts';
import type { Loose } from '../../types/records.ts';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];
type HistoryRow = Row<typeof supplierHistory> | Row<typeof supplierPoHistory> | Row<typeof supplierBlockHistory>;

const asDate = (v: unknown): Date | null => (typeof v === 'string' && v ? new Date(v) : v instanceof Date ? v : null);

/** A note as the model keeps it: every key there, its time a Date again. */
const noteDoc = (n: unknown): Loose | null => {
  if (!n || typeof n !== 'object') return null;
  const x = n as Loose;
  return { text: x.text ?? '', lang: x.lang ?? 'en', translations: x.translations ?? null, by: x.by ?? '', at: asDate(x.at) };
};

export const historyDocs = (rows: HistoryRow[]): Loose[] => [...rows].sort((a, b) => a.position - b.position)
  .map(h => ({ at: h.at, by: h.by, side: h.side, action: h.action, changes: h.changes }));

export const supplierDoc = (s: Row<typeof suppliers>, history: HistoryRow[]): Loose => ({
  _id: s.id, name: s.name, spsName: s.spsName, spsKey: s.spsKey, country: s.country, language: s.language, timeZone: s.timeZone,
  contactName: s.contactName, email: s.email, phone: s.phone, notes: s.notes, active: s.active, createdBy: s.createdBy,
  history: historyDocs(history), createdAt: s.createdAt, updatedAt: s.updatedAt, __v: 0
});

export const loginDoc = (l: Row<typeof supplierLogins>): Loose => ({
  _id: l.id, supplierId: l.supplierId, name: l.name, email: l.email, password: l.password, language: l.language, active: l.active,
  sessionVersion: l.sessionVersion, linkTokenHash: l.linkTokenHash, linkExpiresAt: l.linkExpiresAt, loginAttempts: l.loginAttempts,
  lockUntil: l.lockUntil, lastLoginAt: l.lastLoginAt, lastSeenAt: l.lastSeenAt, invitedAt: l.invitedAt, invitedBy: l.invitedBy,
  createdAt: l.createdAt, updatedAt: l.updatedAt, __v: 0
});

export const poDoc = (p: Row<typeof supplierPos>, lines: Row<typeof supplierPoLines>[], history: HistoryRow[] | null): Loose => ({
  _id: p.id, poNumber: p.poNumber, supplierId: p.supplierId, supplierName: p.supplierName, shipTo: p.shipTo, readyBy: p.readyBy ?? '',
  buyerId: p.buyerId, buyerName: p.buyerName,
  lines: [...lines].sort((a, b) => a.position - b.position)
    .map(l => ({ _id: l.id, material: l.material, thickness: l.thickness, finish: l.finish, slabs: l.slabs, note: l.note })),
  note: noteDoc(p.note), source: p.source, status: p.status, statusReason: p.statusReason, assignedAt: p.assignedAt, createdBy: p.createdBy,
  ...(history ? { history: historyDocs(history) } : {}),
  createdAt: p.createdAt, updatedAt: p.updatedAt, __v: p.version
});

const step = (decision: string | null, by: string | null, byName: string | null, at: Date | null, reason: string | null) =>
  decision == null ? null : { decision, by: by ?? '', byName: byName ?? '', at, reason: reason ?? '' };

const bundleDoc = (b: Row<typeof supplierBundles>): Loose => ({
  _id: b.id, n: b.n, slabs: b.slabs, photoUrl: b.photoUrl, photoAt: b.photoAt,
  previousPhotos: (Array.isArray(b.previousPhotos) ? b.previousPhotos as Loose[] : []).map(p => ({ url: p.url ?? '', at: asDate(p.at) })),
  status: b.status, round: b.round, sentAt: b.sentAt,
  step1: step(b.step1Decision, b.step1By, b.step1ByName, b.step1At, b.step1Reason),
  step2: step(b.step2Decision, b.step2By, b.step2ByName, b.step2At, b.step2Reason),
  reason: b.reason, comment: noteDoc(b.comment),
  unlock: b.unlockBy == null && b.unlockAt == null && b.unlockReason == null ? null : { by: b.unlockBy ?? '', at: b.unlockAt, reason: b.unlockReason ?? '' }
});

export const blockDoc = (b: Row<typeof supplierBlocks>, bundles: Row<typeof supplierBundles>[], history: HistoryRow[] | null): Loose => ({
  _id: b.id, poId: b.poId, poNumber: b.poNumber, supplierId: b.supplierId, lineId: b.lineId, material: b.material, thickness: b.thickness,
  finish: b.finish, blockNumber: b.blockNumber,
  size: b.sizeLength == null && b.sizeHeight == null ? null : { length: b.sizeLength == null ? undefined : Number(b.sizeLength), height: b.sizeHeight == null ? undefined : Number(b.sizeHeight), unit: b.sizeUnit ?? 'in' },
  note: noteDoc(b.note), decisionNote: noteDoc(b.decisionNote),
  bundles: [...bundles].sort((x, y) => x.position - y.position).map(bundleDoc),
  stage: b.stage, firstSentAt: b.firstSentAt, enteredBy: b.enteredBy, enteredById: b.enteredById, sentAt: b.sentAt, createdBy: b.createdBy,
  ...(history ? { history: historyDocs(history) } : {}),
  createdAt: b.createdAt, updatedAt: b.updatedAt, __v: b.version
});
