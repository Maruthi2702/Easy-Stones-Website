import type { ScopeRecord, PurchasingUser, StockSource, SaleSource, ReservationSource, InboundSource, Session } from './serverContracts.ts';
import type { PlanningCohort, PlanInputs } from './planInputs.ts';
import { reportIdentity } from './reportIdentity.ts';
import { createHash } from 'node:crypto';
import InventoryItem from '../models/InventoryItem.ts';
import InventorySalesRecord from '../models/InventorySalesRecord.ts';
import Location from '../models/Location.ts';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import { SlabReservation } from '../holds/models.ts';
import { PurchasingScope, PurchasingInbound, PurchasingLock } from './models.ts';
import { HttpError } from '../server/http.ts';
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const allowed = (user: PurchasingUser, branches: string[]) =>
  branches.every(
    (branch) => user.assignedLocations?.includes('*') || user.assignedLocations?.includes(branch),
  );
export async function getScope(id: string, user: PurchasingUser, session: Session = null): Promise<ScopeRecord> {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new HttpError(400, 'Invalid purchasing scope');
  const scope = await PurchasingScope.findById(id).session(session).lean();
  if (!scope) throw new HttpError(404, 'Purchasing scope not found');
  if (!allowed(user, scope.branches))
    throw new HttpError(403, 'This purchasing scope includes branches outside your access');
  return scope as ScopeRecord;
}
export async function sourceData(user: PurchasingUser, session: Session = null) {
  const branches = (await Location.find({}, 'name').session(session).sort({ name: 1 }).lean())
    .map((row) => row.name)
    .filter((name) => allowed(user, [name]));
  const reads = [
    () => InventoryItem.find(
      { location: { $in: branches } },
      'product location units type instockQty availableSlabs availableQuantity slabStatus remnant serialNumber importedAt',
    )
      .session(session).sort({ _id: 1 })
      .lean(),
    () => InventorySalesRecord.find(
      {},
      'product uom slabsSold quantitySold location periodStart periodEnd importedAt',
    )
      .session(session).sort({ _id: 1 })
      .lean(),
    () => PurchasingScope.find({}).session(session).sort({ name: 1 }).lean(),
    () => SlabReservation.find({ branch: { $in: branches } }, 'slabKey branch holdId updatedAt')
      .session(session).sort({ _id: 1 })
      .lean(),
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
export async function loadInputs(id: string, user: PurchasingUser, session: Session = null): Promise<PlanInputs> {
  const stored = await getScope(id, user, session), sources = await sourceData(user, session);
  const scope = sources.scopes.find(s => String(s._id) === String(id)) || stored;
  const cohort = sources.cohorts.find((c) => c.id === scope.cohortId) || null;
  const storedInbound = await PurchasingInbound.findOne({ scopeId: id }).session(session).sort({ createdAt: -1, _id: -1 }).lean();
  const inbound = storedInbound && (!storedInbound.branches || (storedInbound.branches.length === scope.branches.length && storedInbound.branches.every((branch: string) => scope.branches.includes(branch)))) ? storedInbound : null;
  const locks = await PurchasingLock.find({}).session(session).lean();
  const transitShipments = await InventoryTransitShipment.find({ location: { $in: scope.branches }, active: { $ne: false } }).session(session).sort({ _id: 1 }).lean();
  return { ...sources, scope, cohort, inbound: inbound as InboundSource | null, locks: locks.map(lock => ({ _id: String(lock._id), draftId: lock.draftId })), transitShipments };
}
