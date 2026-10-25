import { describe, it, expect } from 'vitest';
import { buildPlan, stockId } from './buildPlan.ts';
import { transitSupply } from './transitSupply';
import { transitSignature } from './transitSignature';
import { normalizeInbound } from './planning';
import type { TransitLine } from '../types/inventory';

const now = new Date('2026-10-25T20:00:00Z');
const line = (extra: Partial<TransitLine> = {}): TransitLine => ({
  product: 'Quartz 3CM', sku: '', poNumber: 'P1', containerNumber: 'CONT1', location: 'Seattle',
  poDate: null, poEtaDate: null, supplierSoNumber: '', siplNumber: 'S1', slabs: 24, quantity: 24,
  units: 'SF', supplier: 'ABC', freightForwarder: '', shipDate: null, portEtaDate: null,
  etaDate: new Date('2026-12-08'), vessel: '', customerReference: '', supplierPurchaseNote: '', status: 'INTRANSIT', ...extra,
});
const shipment = (lines = [line()]) => { const source = { poNumber: 'P1', containerNumber: 'CONT1', location: 'Seattle', importedAt: now, lines }; return { ...source, usableReceiptDate: new Date('2026-12-08'), confirmedSignature: transitSignature(source) }; };
const inputs = () => {
  const stock = Array.from({ length: 42 }, (_, i) => ({ _id: `stock${i}`, product: 'Quartz 3CM', type: 'SLAB', instockQty: 1, units: 'SF', location: 'Seattle', availableSlabs: 1,
    availableQuantity: 1, slabStatus: '', remnant: '', serialNumber: `SER${i}`, importedAt: now }));
  return {
    scope: { branches: ['Seattle'], observedThrough: '2026-10-25', fullSalesCoverage: true,
      stockSnapshotId: stockId(stock), stockCoverageConfirmed: true, freeStockValidated: true,
      policyConfirmed: true, stockMaxHours: 24, salesMaxDays: 14, reviewDays: 7, bufferDays: 21, aliases: [],
      policies: [{ product: 'Quartz 3CM', supplier: 'ABC', bundleSlabs: 6, minimumSlabs: 0, sfPerSlab: 1,
        weightKg: 400, mixGroup: '', active: true }] },
    stock, reservations: [], locks: [],
    cohort: { id: 'sales', start: '2026-09-26', end: '2026-10-31', importedAt: now.toISOString(),
      records: [{ product: 'Quartz 3CM', uom: 'SF', quantitySold: 54, slabsSold: 54, importedAt: now }] },
    inbound: { _id: 'inbound', complete: true, createdAt: now, rows: [] as any[], receipts: [] as any[] },
    transitShipments: [shipment()],
  };
};
describe('uploaded transit in purchasing', () => {
  it('shows imported PO/container data even when a receiving-policy validation blocks buying', () => {
    const input = inputs();
    input.scope.policyConfirmed = false;
    input.cohort.importedAt = '2026-10-25T06:45:00Z'; // Oct 24 in Pacific time.
    input.cohort.records[0].importedAt = new Date(input.cohort.importedAt);
    const plan = buildPlan(input, now);
    expect(plan.rows[0].transit).toHaveLength(1);
    expect(plan.rows[0].transit[0]).toMatchObject({ poNumber: 'P1', containerNumber: 'CONT1', slabs: 24, eta: '2026-12-08' });
    expect(plan.rows[0].protective).toBeNull();
    expect(plan.rows[0].blockers.join(' ')).toMatch(/receiving lead-time/);
  });
  it('does not treat a reported ETA as a confirmed usable receipt', () => {
    const input = inputs(); input.transitShipments[0].confirmedSignature = '';
    const row = buildPlan(input, now).rows[0];
    expect(row.transit[0].eta).toBe('2026-12-08');
    expect(row.transit[0].receiptConfirmed).toBe(false);
    expect(row.coverage.days).toBeGreaterThan(0);
    expect(row.protective).toBeNull();
  });
  it('subtracts eligible imported containers from the proposed buy', () => {
    const plan = buildPlan(inputs(), now);
    expect(plan.rows[0].blockers).toEqual([]);
    expect(plan.rows[0].protective!.inbound).toBe(24);
    expect(plan.rows[0].protective!.proposedSlabs).toBe(150);
    const noTransit = inputs(); noTransit.transitShipments = [];
    expect(buildPlan(noTransit, now).rows[0].protective!.proposedSlabs).toBe(174);
  });
  it('does not add transit to the same PO parent balance a second time', () => {
    const input = inputs();
    input.inbound.rows = [{ po: 'P1', line: '1', product: 'Quartz 3CM', branch: 'Seattle', supplier: 'ABC',
      ordered: 120, received: 0, cancelled: 0, eta: '2026-12-08', confirmed: true, shipment: 'CONT1',
      shipped: 24, shipmentReceived: 0, shipmentEta: '2026-12-08' }];
    input.inbound.receipts = normalizeInbound(input.inbound.rows);
    expect(buildPlan(input, now).rows[0].protective!.inbound).toBe(120);
  });
  it('blocks conflicting parent totals rather than silently losing reported containers', () => {
    const input = inputs();
    input.inbound.rows = [{ po: 'P1', line: '1', product: 'Quartz 3CM', branch: 'Seattle', ordered: 12, received: 0, cancelled: 0 }];
    const row = buildPlan(input, now).rows[0];
    expect(row.transit[0].slabs).toBe(24);
    expect(row.protective).toBeNull();
    expect(row.blockers.join(' ')).toMatch(/exceed the remaining quantity/);
  });
  it('keeps branches, units, thickness and missing slab counts distinct', () => {
    const input = inputs();
    input.transitShipments = [shipment([line({ units: 'EA' }), line({ product: 'Quartz 2CM' }), line({ location: 'Spokane' })])];
    const plan = buildPlan(input, now);
    expect(plan.rows.find((row: { key: string }) => row.key === 'quartz 3cm::SF')!.transit).toEqual([]);
    expect(plan.transitLineCount).toBe(2);
    input.transitShipments = [shipment([line({ slabs: null })])];
    const unknown = buildPlan(input, now).rows[0];
    expect(unknown.transit[0].slabs).toBeNull();
    expect(unknown.blockers.join(' ')).toMatch(/unknown slab count/);
  });
  it('excludes other branches and does not substitute port ETA for destination ETA', () => {
    expect(transitSupply([shipment()], ['Spokane'])).toEqual([]);
    const supply = transitSupply([shipment([line({ etaDate: null, portEtaDate: new Date('2026-11-10') })])], ['Seattle']);
    expect(supply[0].eta).toBeNull();
  });
  it('invalidates an open plan when container quantities or ETAs change', () => {
    const initial = buildPlan(inputs(), now);
    const changed = inputs(); changed.transitShipments[0].lines[0].slabs = 30;
    expect(buildPlan(changed, now).fingerprint).not.toBe(initial.fingerprint);
  });
});
