import { createHash } from 'node:crypto';
import InventoryItem from '../models/InventoryItem.ts';
import InventorySalesRecord from '../models/InventorySalesRecord.js';
import Location from '../models/Location.js';
import InventoryTransitShipment from '../models/InventoryTransitShipment.ts';
import { SlabReservation } from '../holds/models.js';
import { PurchasingScope, PurchasingInbound, PurchasingLock } from './models.js';
import { HttpError } from '../server/http.js';
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const allowed = (user, branches) =>
  branches.every(
    (branch) => user.assignedLocations?.includes('*') || user.assignedLocations?.includes(branch),
  );
export async function getScope(id, user) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new HttpError(400, 'Invalid purchasing scope');
  const scope = await PurchasingScope.findById(id).lean();
  if (!scope) throw new HttpError(404, 'Purchasing scope not found');
  if (!allowed(user, scope.branches))
    throw new HttpError(403, 'This purchasing scope includes branches outside your access');
  return scope;
}
export async function sourceData(user) {
  const branches = (await Location.find({}, 'name').sort({ name: 1 }).lean())
    .map((row) => row.name)
    .filter((name) => allowed(user, [name]));
  const [stock, sales, scopes, reservations] = await Promise.all([
    InventoryItem.find(
      { location: { $in: branches } },
      'product location units availableSlabs availableQuantity slabStatus remnant serialNumber importedAt',
    )
      .sort({ _id: 1 })
      .lean(),
    InventorySalesRecord.find(
      {},
      'product uom slabsSold quantitySold location periodStart periodEnd importedAt',
    )
      .sort({ _id: 1 })
      .lean(),
    PurchasingScope.find({}).sort({ name: 1 }).lean(),
    SlabReservation.find({ branch: { $in: branches } }, 'slabKey branch holdId updatedAt')
      .sort({ _id: 1 })
      .lean(),
  ]);
  const cohorts = new Map();
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
    id: digest([
      c.location,
      c.start,
      c.end,
      c.records.map((r) => [String(r._id), r.importedAt, r.quantitySold, r.slabsSold]),
    ]),
    count: c.records.length,
  }));
  // Legacy combined reports are visible to all-branch users until an explicit
  // structured scope is assigned; never split their location string by spaces.
  const visible = allCohorts.filter(
    (c) =>
      user.assignedLocations?.includes('*') ||
      branches.includes(c.location) ||
      scopes.some((s) => s.cohortId === c.id && allowed(user, s.branches)),
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
    scopes: scopes.filter((s) => allowed(user, s.branches)),
  };
}
export async function loadInputs(id, user) {
  const scope = await getScope(id, user),
    sources = await sourceData(user);
  const cohort = sources.cohorts.find((c) => c.id === scope.cohortId) || null;
  const inbound = await PurchasingInbound.findOne({ scopeId: id }).sort({ createdAt: -1, _id: -1 }).lean();
  const [locks, transitShipments] = await Promise.all([
    PurchasingLock.find({}).lean(),
    InventoryTransitShipment.find({ location: { $in: scope.branches } }).sort({ _id: 1 }).lean(),
  ]);
  return { scope, ...sources, cohort, inbound, locks, transitShipments };
}
