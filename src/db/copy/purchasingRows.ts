/** MongoDB → Postgres rows for Purchasing (src/db/schema/purchasing.ts). */
import type { Loose } from '../../types/records.ts';
import type {
  purchasingScopes, purchasingScopeAliases, purchasingScopePolicies, purchasingInbound, purchasingDrafts,
  purchasingDraftHistory, purchasingLocks, purchasingPoLinks
} from '../schema/purchasing.ts';
import { PURCHASING_DRAFT_STATUSES } from '../schema/purchasing.ts';
import { stamp } from './referenceRows.ts';
import { plainJson } from './linkedRows.ts';
import { idOf, textOf, rowConverter, intOf, pickOf, decimalOf, stringsOf, linkOf, type CopyProblem } from './values.ts';

type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'];

export interface PurchasingSource {
  purchasingScopes: Loose[];
  purchasingInbound: Loose[];
  purchasingDrafts: Loose[];
  purchasingLocks: Loose[];
  purchasingPoLinks: Loose[];
}

export interface PurchasingRows {
  purchasingScopes: Row<typeof purchasingScopes>[];
  purchasingScopeAliases: Row<typeof purchasingScopeAliases>[];
  purchasingScopePolicies: Row<typeof purchasingScopePolicies>[];
  purchasingInbound: Row<typeof purchasingInbound>[];
  purchasingDrafts: Row<typeof purchasingDrafts>[];
  purchasingDraftHistory: Row<typeof purchasingDraftHistory>[];
  purchasingLocks: Row<typeof purchasingLocks>[];
  purchasingPoLinks: Row<typeof purchasingPoLinks>[];
}

const optText = (v: unknown): string | null => v == null ? null : String(v);
const optBool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const obj = (v: unknown): Loose => (v && typeof v === 'object' ? v : {}) as Loose;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

export function purchasingRows(src: PurchasingSource, problems: CopyProblem[]): PurchasingRows {
  const rows: PurchasingRows = {
    purchasingScopes: [], purchasingScopeAliases: [], purchasingScopePolicies: [], purchasingInbound: [],
    purchasingDrafts: [], purchasingDraftHistory: [], purchasingLocks: [], purchasingPoLinks: []
  };
  const scopeIds = new Set<string>(), draftIds = new Set<string>();
  const zone = 'America/Los_Angeles';

  for (const d of src.purchasingScopes) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'purchasing_scopes', id);
    scopeIds.add(id);
    const cov = d.salesCoverageConfirmation && typeof d.salesCoverageConfirmation === 'object' ? d.salesCoverageConfirmation as Loose : null;
    const box = obj(d.container);
    rows.purchasingScopes.push({
      id, name: optText(d.name), branches: stringsOf(d.branches), cohortId: optText(d.cohortId),
      cohortRevision: optText(d.cohortRevision), observedThrough: c.day('observed_through', d.observedThrough, zone),
      salesCoverageCohortId: cov ? textOf(cov.cohortId) : null,
      salesCoverageThrough: cov ? c.day('sales_coverage_through', cov.through, zone) : null,
      salesCoverageConfirmedAt: cov ? c.moment('sales_coverage_confirmed_at', cov.confirmedAt) : null,
      salesCoverageConfirmedById: cov ? optText(obj(cov.confirmedBy).id) : null,
      salesCoverageConfirmedByName: cov ? textOf(obj(cov.confirmedBy).name) : null,
      salesCoverageSource: cov ? pickOf(c, 'sales_coverage_source', cov.source, ['scope-form', 'owner-confirmation'] as const, null) : null,
      fullSalesCoverage: optBool(d.fullSalesCoverage), stockSnapshotId: optText(d.stockSnapshotId),
      stockCoverageConfirmed: optBool(d.stockCoverageConfirmed), freeStockValidated: optBool(d.freeStockValidated),
      policyConfirmed: optBool(d.policyConfirmed),
      reviewDays: intOf(c, 'review_days', d.reviewDays) ?? 7, bufferDays: intOf(c, 'buffer_days', d.bufferDays) ?? 21,
      stockMaxHours: intOf(c, 'stock_max_hours', d.stockMaxHours) ?? 24, salesMaxDays: intOf(c, 'sales_max_days', d.salesMaxDays) ?? 14,
      containerPayloadKg: decimalOf(box.payloadKg), containerTareKg: decimalOf(box.tareKg),
      containerMaxSlabs: intOf(c, 'container_max_slabs', box.maxSlabs),
      containerLayoutConfirmed: optBool(box.layoutConfirmed), containerMixingConfirmed: optBool(box.mixingConfirmed),
      updatedBy: optText(d.updatedBy), version: intOf(c, 'version', d.__v) ?? 0,
      ...stamp(c, d)
    });
    list(d.aliases).forEach((a, position) => {
      const x = obj(a);
      rows.purchasingScopeAliases.push({ scopeId: id, position, salesProduct: optText(x.salesProduct), stockProduct: optText(x.stockProduct) });
    });
    list(d.policies).forEach((p, position) => {
      const x = obj(p);
      rows.purchasingScopePolicies.push({
        scopeId: id, position, product: optText(x.product), supplier: optText(x.supplier),
        bundleSlabs: decimalOf(x.bundleSlabs), minimumSlabs: decimalOf(x.minimumSlabs), sfPerSlab: decimalOf(x.sfPerSlab),
        weightKg: decimalOf(x.weightKg), mixGroup: optText(x.mixGroup), active: optBool(x.active)
      });
    });
  }

  for (const d of src.purchasingInbound) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'purchasing_inbound', id);
    const scopeId = linkOf(c, 'scope_id', d.scopeId, scopeIds, 'scope');
    if (!scopeId) { c.problem('scope_id', 'import of no scope', 'skipped'); continue; }
    rows.purchasingInbound.push({
      id, scopeId, complete: optBool(d.complete), branches: Array.isArray(d.branches) ? stringsOf(d.branches) : null,
      importedBy: optText(d.importedBy), rows: plainJson(list(d.rows)), receipts: plainJson(list(d.receipts)),
      version: intOf(c, 'version', d.__v) ?? 0, ...stamp(c, d)
    });
  }

  for (const d of src.purchasingDrafts) {
    const id = idOf(d._id);
    if (!id) continue;
    const c = rowConverter(problems, 'purchasing_drafts', id);
    const scopeId = linkOf(c, 'scope_id', d.scopeId, scopeIds, 'scope');
    if (!scopeId) { c.problem('scope_id', 'draft of no scope', 'skipped'); continue; }
    draftIds.add(id);
    const by = obj(d.createdBy);
    rows.purchasingDrafts.push({
      id, scopeId, status: pickOf(c, 'status', d.status, PURCHASING_DRAFT_STATUSES, 'draft'),
      fingerprint: optText(d.fingerprint), inputSnapshot: d.inputSnapshot == null ? null : plainJson(d.inputSnapshot),
      lines: plainJson(list(d.lines)), loads: plainJson(list(d.loads)), note: optText(d.note),
      createdById: optText(by.id), createdByName: optText(by.name),
      existingPoLines: stringsOf(d.existingPoLines), existingTransitParents: stringsOf(d.existingTransitParents),
      linkedPoLines: stringsOf(d.linkedPoLines), version: intOf(c, 'version', d.__v) ?? 0, ...stamp(c, d)
    });
    list(d.history).forEach((h, position) => {
      const x = obj(h);
      rows.purchasingDraftHistory.push({
        draftId: id, position, action: optText(x.action), at: c.moment('history.at', x.at), name: optText(x.name), note: optText(x.note)
      });
    });
  }

  for (const d of src.purchasingLocks) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'purchasing_locks', d._id);
    const draftId = linkOf(c, 'draft_id', d.draftId, draftIds, 'draft');
    if (!draftId) { c.problem('draft_id', 'lock of no draft', 'skipped'); continue; }
    rows.purchasingLocks.push({ id: d._id, draftId, scopeId: idOf(d.scopeId) });
  }

  for (const d of src.purchasingPoLinks) {
    if (typeof d._id !== 'string') continue;
    const c = rowConverter(problems, 'purchasing_po_links', d._id);
    const draftId = linkOf(c, 'draft_id', d.draftId, draftIds, 'draft');
    if (!draftId) { c.problem('draft_id', 'link of no draft', 'skipped'); continue; }
    rows.purchasingPoLinks.push({ id: d._id, draftId });
  }

  return rows;
}
