/**
 * Inventory, in-transit and Purchasing move on ONE switch (`DB_INVENTORY`). The places they meet:
 * Purchasing's stock / sales reads, its receiving-date confirmation, the shared revision counter that Holds
 * bumps too, and the sales import re-keying Purchasing scopes. Each runs on MongoDB, then on Postgres.
 */
import mongoose from 'mongoose';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { asc } from 'drizzle-orm';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import InventoryItem from '../../models/InventoryItem.ts';
import InventorySalesRecord from '../../models/InventorySalesRecord.ts';
import InventoryTransitShipment from '../../models/InventoryTransitShipment.ts';
import { InventoryStockState } from '../../models/InventoryStockImport.ts';
import { PurchasingScope } from '../../purchasing/models.ts';
import { purchasingScopes } from '../schema/purchasing.ts';
import { stockForPurchasing, salesRecordsForPurchasing, replaceSalesPeriod } from './index.ts';
import { shipmentsForBranches, findShipmentForReceipt, saveReceiptConfirmation } from '../inventoryTransit/index.ts';
import { rekeyScopeCohorts } from '../purchasing/rekey.ts';
import { inventoryRevision, inInventoryTransaction } from '../../services/inventoryTransaction.ts';
import type { Loose } from '../../types/records.ts';

const made = vi.hoisted(() => ({ ids: [] as string[], used: 0 }));
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { made.ids[made.used] ??= real.newId(); return made.ids[made.used++]; } };
});
const rewind = () => { made.used = 0; };

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const item = (product: string, over: Loose = {}) => ({
  genericSku: '', subCategory: '', group: '', kind: '', bundle: '', slabNumber: '', idFour: '', idFive: '', suppBarcodeId: '', bin: '', dimensions: '', notes: '', remnant: '',
  product, sku: `SKU-${product}`, type: 'SLAB', category: 'Quartz', units: 'SF', serialNumber: `SN-${product}`, barcodeId: `BC-${product}`,
  location: 'Seattle', slabStatus: '', instockQty: 75, availableSlabs: 1, availableQuantity: 75, assetValue: 1125, unitLandedCost: 15, unitFobCost: 10, purchaseCost: 12,
  supplier: 'Acme', block: 'B1', receivedDate: day('2026-10-01'), importedAt: day('2026-11-01'), importedByName: 'Buyer', ...over
});
const sale = (product: string, over: Loose = {}) => ({
  product, category: 'Quartz', uom: 'SF', slabsSold: 2, quantitySold: 150, saleValue: 3000, cost: 2000, avgSellingPrice: 20, avgCost: 13, margin: 1000, marginPercent: 33,
  location: 'Seattle', periodStart: day('2026-09-01'), periodEnd: day('2026-09-30'), importedAt: day('2026-11-01'), importedByName: 'Buyer', ...over
});
const SHIP = '5'.repeat(24);
const oid = (h: string) => new mongoose.Types.ObjectId(h) as never;

let t: WriteParity;
beforeAll(async () => {
  t = await openWriteParity(async () => {
    await InventoryItem.insertMany([item('Calacatta'), item('Calacatta', { serialNumber: 'sn-2', location: 'Spokane' }), item('Nero', { location: 'Portland' })]);
    await InventorySalesRecord.insertMany([sale('Calacatta'), sale('Nero', { location: 'Portland' })]);
    await InventoryTransitShipment.collection.insertMany([
      { _id: oid(SHIP), poNumber: 'PO1', containerNumber: 'C1', location: 'Seattle', active: true, sourceSignature: 's'.repeat(64), importedAt: day('2026-11-02'), lines: [{ product: 'Calacatta', slabs: 4 }], __v: 0, createdAt: day('2026-11-02'), updatedAt: day('2026-11-02') },
      { _id: oid('6'.repeat(24)), poNumber: 'PO2', containerNumber: 'C2', location: 'Seattle', active: false, importedAt: day('2026-11-02'), lines: [], __v: 0, createdAt: day('2026-11-02'), updatedAt: day('2026-11-02') },
      { _id: oid('7'.repeat(24)), poNumber: 'PO3', containerNumber: 'C3', location: 'Portland', active: true, importedAt: day('2026-11-02'), lines: [{ product: 'Nero', slabs: 1 }], __v: 0, createdAt: day('2026-11-02'), updatedAt: day('2026-11-02') }
    ]);
    await InventoryStockState.collection.insertOne({ _id: 'stock' as never, version: 0 });
    await PurchasingScope.collection.insertOne({ _id: oid('8'.repeat(24)), name: 'Seattle', branches: ['Seattle'], cohortId: 'legacy-1', __v: 0, createdAt: day('2026-11-01'), updatedAt: day('2026-11-01') });
  }, 'DB_INVENTORY');
}, 240000);
afterAll(async () => { await t?.close(); });

describe('Purchasing reads stock and sales through the Inventory layer', () => {
  it('stock at its branches and every sales record answer the same', async () => {
    const stock = await t.both(() => stockForPurchasing(['Seattle', 'Spokane']));
    expect(stock.mongo).toHaveLength(2);
    expect(normalize(stock.postgres)).toEqual(normalize(stock.mongo));
    expect((await t.both(() => stockForPurchasing([]))).postgres).toEqual([]);
    const sales = await t.both(() => salesRecordsForPurchasing());
    expect(sales.mongo).toHaveLength(2);
    expect(normalize(sales.postgres)).toEqual(normalize(sales.mongo));
  });
});

describe('Purchasing reads and confirms in-transit shipments through the transit layer', () => {
  it('lists the active shipments at its branches and finds the one a receiving date may be set for', async () => {
    const list = await t.both(async () => (await shipmentsForBranches(['Seattle'])).map(s => String(s._id)));
    expect(list.mongo).toEqual([SHIP]);
    expect(list.postgres).toEqual(list.mongo);
    const one = await t.both(() => findShipmentForReceipt(SHIP, ['Seattle']));
    expect(normalize(one.postgres)).toEqual(normalize(one.mongo));
    expect((await t.both(() => findShipmentForReceipt('6'.repeat(24), ['Seattle']))).postgres).toBeNull(); // inactive
    expect((await t.both(() => findShipmentForReceipt(SHIP, ['Portland']))).postgres).toBeNull(); // other branch
  });

  it('saves the confirmed date and its history line, the same rows on both', async () => {
    const at = new Date('2026-11-14T20:00:00.000Z');
    await t.both(async () => {
      rewind();
      const shipment = (await findShipmentForReceipt(SHIP, ['Seattle']))!;
      await saveReceiptConfirmation(shipment, { date: '2026-12-01', signature: 's'.repeat(64), at, by: 'Buyer' });
    }, at);
    expect(await t.differences()).toEqual([]);
    const after = await t.both(() => findShipmentForReceipt(SHIP, ['Seattle']));
    expect(after.postgres?.receiptConfirmedBy).toBe('Buyer');
    expect(after.postgres?.confirmedSignature).toBe('s'.repeat(64));
  });
});

describe('one revision counter for stock, holds and Purchasing', () => {
  it('a writer that still works in a MongoDB transaction bumps the counter that is in use', async () => {
    const run = async () => { const before = await inventoryRevision(); await inInventoryTransaction(async () => {}); return (await inventoryRevision()) - before; };
    const { mongo, postgres } = await t.both(run);
    expect(mongo).toBe(1);
    expect(postgres).toBe(1);
  });
});

describe('the sales import re-keys Purchasing scopes in its own transaction', () => {
  it('moves a legacy cohort id to the new one, atomically with the replacement', async () => {
    rewind();
    const period = { location: 'Seattle', periodStart: day('2026-09-01'), periodEnd: day('2026-09-30') };
    const rows = [sale('Calacatta', { quantitySold: 999 })].map(({ importedAt: _i, importedByName: _n, ...r }) => r);
    await t.both(async () => {
      rewind();
      await replaceSalesPeriod({ ...period, rows, importedAt: new Date(), importedByName: 'Buyer', importedById: null }, async (_previous, { session, tx }) => {
        if (tx) await rekeyScopeCohorts(tx as never, 'legacy-1', 'new-1');
        else await PurchasingScope.updateMany({ cohortId: 'legacy-1' }, { $set: { cohortId: 'new-1' }, $inc: { __v: 1 } }, session ? { session } : {});
      });
    });
    expect((await PurchasingScope.findById('8'.repeat(24)).lean())?.cohortId).toBe('new-1');
    const [row] = await t.pg.db.select().from(purchasingScopes).orderBy(asc(purchasingScopes.id));
    expect(row.cohortId).toBe('new-1');
    expect(row.version).toBe(1);
    expect(await t.differences()).toEqual([]);
  });
});
