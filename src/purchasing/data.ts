import type { ScopeRecord, PurchasingUser, StockSource, SaleSource, ReservationSource, InboundSource } from './serverContracts.ts';
import type { PurchasingStore } from '../db/purchasing/index.ts';
import { readBranchNames, readStockForPurchasing, readSalesRecordsForPurchasing, readReservationsForPurchasing } from '../db/purchasing/sources.ts';
import type { PlanningCohort, PlanInputs } from './planInputs.ts';
import { reportIdentity } from './reportIdentity.ts';
import { createHash } from 'node:crypto';
import { shipmentsForBranches } from '../db/inventoryTransit/index.ts';
import { HttpError } from '../server/http.ts';
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const allowed = (user: PurchasingUser, branches: string[]) =>
  branches.every(
    (branch) => user.assignedLocations?.includes('*') || user.assignedLocations?.includes(branch),
  );
export async function getScope(id: string, user: PurchasingUser, store: PurchasingStore): Promise<ScopeRecord> {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new HttpError(400, 'Invalid purchasing scope');
  const scope = await store.findScope(id);
  if (!scope) throw new HttpError(404, 'Purchasing scope not found');
  if (!allowed(user, scope.branches))
    throw new HttpError(403, 'This purchasing scope includes branches outside your access');
  return scope as ScopeRecord;
}
export async function sourceData(user: PurchasingUser, store: PurchasingStore) {
  const session = store.session;
  const branches = (await readBranchNames(session)).filter((name) => allowed(user, [name]));
  const reads = [
    () => readStockForPurchasing(branches, session, store.tx),
    () => readSalesRecordsForPurchasing(session, store.tx),
    () => store.listScopes(),
    () => readReservationsForPurchasing(branches, session),
  ];
  const loaded: unknown[] = [];
  if (session) { for (const read of reads) loaded.push(await read()); }
  else loaded.push(...await Promise.all(reads.map(read => read())));
  const [stock, sales, scopes, reservations] = loaded as [StockSource[], SaleSource[], ScopeRecord[], ReservationSource[]];
  const cohorts = new Map<string, Omit<PlanningCohort, 'id' | 'records'> & { location: string; records: SaleSource[] }>();
  for (const sale of sales) {
    const key = JSON.stringify([sale.location, sale.periodStart, sale.periodEnd]);
    const old = cohorts.get(key) || {
      location: sale.location,
      start: sale.periodStart.toISOString().slice(0, 10),
      end: sale.periodEnd.toISOString().slice(0, 10),
      importedAt: '',
      records: [],
    };
    old.records.push(sale);
    if (String(sale.importedAt?.toISOString()) > old.importedAt)
      old.importedAt = sale.importedAt.toISOString();
    cohorts.set(key, old);
  }
  const allCohorts = [...cohorts.values()].map((c) => ({
    ...c,
    ...reportIdentity(c.location, c.start, c.end, c.importedAt, c.records),
    count: c.records.length,
  }));
  // Legacy combined reports are visible to all-branch users until an explicit
  // structured scope is assigned; never split their location string by spaces.
  const visible = allCohorts.filter(
    (c) =>
      user.assignedLocations?.includes('*') ||
      branches.includes(c.location) ||
      scopes.some((s) => (s.cohortId === c.id || s.cohortId === c.legacyId) && allowed(user, s.branches)),
  );
  const stockSnapshotId = digest(
    stock.map((s) => [String(s._id), s.importedAt, s.availableSlabs, s.availableQuantity, s.slabStatus]),
  );
  const stockImportedAt =
    stock
      .map((r) => r.importedAt?.toISOString())
      .filter(Boolean)
      .sort()[0] || null;
  return {
    branches,
    stock,
    reservations,
    stockSnapshotId,
    stockImportedAt,
    cohorts: visible,
    scopes: scopes.filter((s) => allowed(user, s.branches)).map(s => {
      const report = allCohorts.find(c => c.id === s.cohortId || c.legacyId === s.cohortId);
      const verifiedRevision = s.cohortRevision || (report?.legacyId === s.cohortId ? report.revision : null);
      const stockCoverageConfirmed = !!s.stockCoverageConfirmed && s.stockSnapshotId === digest(
        stock.filter(row => s.branches.includes(row.location)).map(row => [String(row._id), row.importedAt, row.availableSlabs, row.availableQuantity, row.slabStatus]));
      return { ...s, stockCoverageConfirmed, ...(report ? { cohortId: report.id, cohortRevision: verifiedRevision,
        fullSalesCoverage: !!s.fullSalesCoverage && verifiedRevision === report.revision } : {}) };
    }),
  };
}
export async function loadInputs(id: string, user: PurchasingUser, store: PurchasingStore): Promise<PlanInputs> {
  const session = store.session;
  const stored = await getScope(id, user, store), sources = await sourceData(user, store);
  const scope = sources.scopes.find(s => String(s._id) === String(id)) || stored;
  const cohort = sources.cohorts.find((c) => c.id === scope.cohortId) || null;
  const storedInbound = await store.latestInbound(id);
  const inbound = storedInbound && (!storedInbound.branches || (storedInbound.branches.length === scope.branches.length && storedInbound.branches.every((branch: string) => scope.branches.includes(branch)))) ? storedInbound : null;
  const locks = await store.listLocks();
  const transitShipments = await shipmentsForBranches(scope.branches, session, store.tx) as unknown as PlanInputs['transitShipments'];
  return { ...sources, scope, cohort, inbound: inbound as InboundSource | null, locks, transitShipments };
}
