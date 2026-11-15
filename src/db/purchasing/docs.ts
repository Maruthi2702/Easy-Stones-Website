/**
 * Postgres rows → the records as MongoDB held them (`_id`, `__v`, `createdBy: { id, name }`,
 * the draft's history inside it, a scope's container as one object), so the route and the
 * screens never learn which database answered. A column that is null is left out, as
 * MongoDB left out a field nobody set — except `cohortRevision` and `salesCoverageConfirmation`,
 * which MongoDB holds as null on every scope the router saved. The key order is MongoDB's too:
 * a plan's fingerprint hashes the scope's JSON, so a different order would change it.
 */
import type {
  purchasingScopes, purchasingScopeAliases, purchasingScopePolicies, purchasingInbound, purchasingDrafts, purchasingDraftHistory
} from '../schema/purchasing.ts';
import type { Loose } from '../../types/records.ts';

const present = (o: Loose, keep: string[] = []): Loose =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => (v !== null && v !== undefined) || keep.includes(k)));
const num = (v: string | null): number | null => (v == null ? null : Number(v));

export function scopeDoc(
  s: typeof purchasingScopes.$inferSelect,
  aliases: (typeof purchasingScopeAliases.$inferSelect)[],
  policies: (typeof purchasingScopePolicies.$inferSelect)[]
): Loose {
  const confirmed = s.salesCoverageCohortId != null || s.salesCoverageThrough != null || s.salesCoverageConfirmedAt != null;
  const container = present({
    payloadKg: num(s.containerPayloadKg), tareKg: num(s.containerTareKg), maxSlabs: s.containerMaxSlabs,
    layoutConfirmed: s.containerLayoutConfirmed, mixingConfirmed: s.containerMixingConfirmed
  });
  return present({
    _id: s.id, name: s.name, branches: s.branches, cohortId: s.cohortId, cohortRevision: s.cohortRevision,
    observedThrough: s.observedThrough,
    salesCoverageConfirmation: confirmed ? present({
      cohortId: s.salesCoverageCohortId, through: s.salesCoverageThrough, confirmedAt: s.salesCoverageConfirmedAt,
      confirmedBy: { id: s.salesCoverageConfirmedById ?? null, name: s.salesCoverageConfirmedByName },
      source: s.salesCoverageSource
    }) : null,
    fullSalesCoverage: s.fullSalesCoverage, stockSnapshotId: s.stockSnapshotId,
    stockCoverageConfirmed: s.stockCoverageConfirmed, freeStockValidated: s.freeStockValidated, policyConfirmed: s.policyConfirmed,
    reviewDays: s.reviewDays, bufferDays: s.bufferDays, stockMaxHours: s.stockMaxHours, salesMaxDays: s.salesMaxDays,
    aliases: [...aliases].sort((a, b) => a.position - b.position).map(a => present({ salesProduct: a.salesProduct, stockProduct: a.stockProduct })),
    policies: [...policies].sort((a, b) => a.position - b.position).map(p => present({
      product: p.product, supplier: p.supplier, bundleSlabs: num(p.bundleSlabs), minimumSlabs: num(p.minimumSlabs),
      sfPerSlab: num(p.sfPerSlab), weightKg: num(p.weightKg), mixGroup: p.mixGroup, active: p.active
    })),
    container: Object.keys(container).length ? container : undefined,
    updatedBy: s.updatedBy, createdAt: s.createdAt, updatedAt: s.updatedAt, __v: s.version
  }, ['cohortRevision', 'salesCoverageConfirmation']);
}

export function inboundDoc(i: typeof purchasingInbound.$inferSelect): Loose {
  return present({
    _id: i.id, scopeId: i.scopeId, complete: i.complete, branches: i.branches, importedBy: i.importedBy,
    rows: i.rows, receipts: i.receipts, createdAt: i.createdAt, updatedAt: i.updatedAt, __v: i.version
  });
}

export function draftDoc(d: typeof purchasingDrafts.$inferSelect, history: (typeof purchasingDraftHistory.$inferSelect)[]): Loose {
  return present({
    _id: d.id, scopeId: d.scopeId, status: d.status, fingerprint: d.fingerprint, inputSnapshot: d.inputSnapshot,
    lines: d.lines, loads: d.loads, note: d.note,
    createdBy: d.createdById == null && d.createdByName == null ? undefined : present({ id: d.createdById, name: d.createdByName }),
    existingPoLines: d.existingPoLines, existingTransitParents: d.existingTransitParents, linkedPoLines: d.linkedPoLines,
    history: [...history].sort((a, b) => a.position - b.position).map(h => present({ action: h.action, at: h.at, name: h.name, note: h.note })),
    createdAt: d.createdAt, updatedAt: d.updatedAt, __v: d.version
  });
}
