import { describe, it, expect } from 'vitest';
import { stockBreakdown, stockCoverage } from './stockOverview';
import { buildPlan, stockId } from './buildPlan.js';
const slab = (serialNumber: string, slabStatus = '') => ({ type: 'SLAB', serialNumber,
  instockQty: 75, availableSlabs: slabStatus ? 0 : 1, availableQuantity: slabStatus ? 0 : 75, slabStatus, remnant: '' });
describe('physical stock overview', () => {
  it('counts allocated SPS slabs even with zero available slabs and deduplicates an app hold', () => {
    const summary = stockBreakdown([slab('free'), slab('so', 'ONSO'), slab('held', 'ONHOLD'), slab('transfer', 'ONTRANSFER'),
      { ...slab('sample'), type: 'SAMPLE' }], new Set(['held']));
    expect(summary).toEqual({ total: 4, allocated: 2, otherUnavailable: 1, available: 1, availableQuantity: 75, problems: [] });
  });
  it('subtracts app-only holds once and excludes remnants from free stock', () => {
    expect(stockBreakdown([slab('held'), { ...slab('remnant'), remnant: 'YES' }], new Set(['held'])))
      .toMatchObject({ total: 2, allocated: 1, otherUnavailable: 1, available: 0, availableQuantity: 0 });
  });
  it('keeps ambiguous physical counts unknown instead of summing SF or duplicates', () => {
    for (const rows of [[slab('dup'), slab('dup')], [{ ...slab(''), serialNumber: '' }], [{ availableSlabs: 42, availableQuantity: 42 }]])
      expect(stockBreakdown(rows, new Set())).toMatchObject({ total: null, allocated: null, available: null });
  });
  it('computes exact fractional days in SF regardless of slab size or packing policy', () => {
    const stock = stockBreakdown([slab('one'), { ...slab('two'), availableQuantity: 50 }], new Set());
    expect(stockCoverage({ stock, sold: 100, days: 2, blockers: [], today: '2026-10-25', uom: 'SF' }))
      .toMatchObject({ state: 'known', days: 2.5, dailyQuantity: 50, availableQuantity: 125, stockoutDate: '2026-10-28' });
  });
  it('distinguishes zero stock, zero sales, and invalid sales coverage', () => {
    const stock = stockBreakdown([], new Set());
    const input = { stock, sold: 10, days: 5, blockers: [] as string[], today: '2026-10-25', uom: 'SF' };
    expect(stockCoverage(input)).toMatchObject({ state: 'known', days: 0 });
    expect(stockCoverage({ ...input, sold: 0 })).toMatchObject({ state: 'no-sales', days: null });
    expect(stockCoverage({ ...input, blockers: ['Invalid cutoff'] })).toMatchObject({ state: 'unknown', days: null });
  });
  it('keeps physical counts visible when an unfinished report has an invalid actual cutoff', () => {
    const now = new Date('2026-10-25T20:00:00Z');
    const stock = [{ ...slab('one'), _id: '1', product: 'Quartz', units: 'SF', location: 'Seattle', importedAt: now }];
    const plan = buildPlan({ stock, reservations: [], locks: [], transitShipments: [], inbound: null,
      scope: { branches: ['Seattle'], observedThrough: '2026-10-30', fullSalesCoverage: true,
        stockSnapshotId: stockId(stock), stockCoverageConfirmed: true, freeStockValidated: true,
        policyConfirmed: false, stockMaxHours: 24, salesMaxDays: 14, aliases: [], policies: [], reviewDays: 7, bufferDays: 21 },
      cohort: { id: 'c', start: '2026-10-01', end: '2026-10-31', importedAt: '2026-10-24T20:00:00.000Z',
        records: [{ product: 'Quartz', uom: 'SF', quantitySold: 100, importedAt: new Date('2026-10-24T20:00:00Z') }] },
    }, now);
    expect(plan.rows[0].stockBreakdown).toMatchObject({ total: 1, available: 1 });
    expect(plan.rows[0].coverage.state).toBe('unknown');
    expect(plan.rows[0].coverage.reasons.join(' ')).toContain('future dates');
  });
});

describe('estimated coverage versus purchase validation', () => {
  const inputs = () => {
    const now = new Date('2026-10-25T20:00:00Z');
    const stock = [{ ...slab('one'), _id: '1', product: 'Quartz', units: 'SF', location: 'Seattle', importedAt: now }];
    return { now, stock, reservations: [], locks: [], transitShipments: [], inbound: null,
      scope: { branches: ['Seattle'], observedThrough: '2026-09-30', fullSalesCoverage: false,
        stockSnapshotId: stockId(stock), stockCoverageConfirmed: false, freeStockValidated: false,
        policyConfirmed: false, stockMaxHours: 24, salesMaxDays: 14, aliases: [], policies: [], reviewDays: 7, bufferDays: 21 },
      cohort: { id: 'c', location: 'Seattle', start: '2026-09-25', end: '2026-09-30', importedAt: '2026-10-01T20:00:00.000Z',
        records: [{ product: 'Quartz', uom: 'SF', quantitySold: 150, importedAt: new Date('2026-10-01T20:00:00Z') }] },
    };
  };
  it('shows a useful estimate with all four advisory checks while buying remains blocked', () => {
    const input = inputs();
    const row = buildPlan(input, input.now).rows[0];
    expect(row.coverage).toMatchObject({ state: 'estimated', days: 3, dailyQuantity: 25, reasons: [],
      salesPeriod: { start: '2026-09-25', through: '2026-09-30' } });
    expect(row.coverage.warnings).toHaveLength(4);
    expect(row.baseline).toBeNull();
    expect(row.protective).toBeNull();
    expect(row.action).toBe('Resolve inputs');
  });
  it('does not estimate across an unverified branch mismatch or combined report', () => {
    for (const location of ['Spokane', 'Seattle Spokane']) {
      const input = inputs(); input.cohort.location = location;
      expect(buildPlan(input, input.now).rows[0].coverage.state).toBe('unknown');
    }
  });
  it('does not invent zero stock or zero demand when report coverage is unconfirmed', () => {
    const input = inputs(); input.stock = [];
    expect(buildPlan(input, input.now).rows[0].coverage.state).toBe('unknown');
    const noSales = inputs(); noSales.cohort.records = [];
    expect(buildPlan(noSales, noSales.now).rows[0].coverage.state).toBe('unknown');
  });
  it('uses a completed file period even when its upload timestamp is earlier', () => {
    const input = inputs(); input.cohort.importedAt = '2026-09-26T20:00:00.000Z';
    input.cohort.records[0].importedAt = new Date(input.cohort.importedAt);
    const coverage = buildPlan(input, input.now).rows[0].coverage;
    expect(coverage).toMatchObject({ state: 'estimated', days: 3, reasons: [] });
  });
});
