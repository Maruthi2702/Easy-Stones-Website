import { describe, it, expect } from 'vitest';
import { confirmSalesThrough, hasConfirmedSalesThrough } from './salesCoverage';
import { buildPlan, stockId } from './buildPlan.js';

describe('source-bound sales coverage confirmation', () => {
  const confirmation = () => confirmSalesThrough('report-1', '2026-09-30', { id: null, name: 'Workspace owner' }, 'owner-confirmation', new Date('2026-10-25T20:00:00Z'));
  it('binds confirmation to the exact cohort and observed date', () => {
    const scope = { cohortId: 'report-1', observedThrough: '2026-09-30', salesCoverageConfirmation: confirmation() };
    expect(hasConfirmedSalesThrough(scope, 'report-1')).toBe(true);
    expect(hasConfirmedSalesThrough(scope, 'replacement-report')).toBe(false);
    expect(hasConfirmedSalesThrough({ ...scope, observedThrough: '2026-09-29' }, 'report-1')).toBe(false);
    expect(hasConfirmedSalesThrough({ ...scope, cohortId: 'other' }, 'report-1')).toBe(false);
  });
  it('uses confirmed report coverage for an estimate without rewriting import timestamps or enabling buying', () => {
    const now = new Date('2026-10-25T20:00:00Z');
    const importedAt = new Date('2026-09-08T07:14:03.565Z');
    const stock = [{ _id: '1', product: 'Quartz', location: 'Seattle', type: 'SLAB', serialNumber: 'S1',
      instockQty: 75, availableSlabs: 1, availableQuantity: 75, units: 'SF', slabStatus: '', remnant: '', importedAt: now }];
    const input = { stock, reservations: [], locks: [], transitShipments: [], inbound: null,
      scope: { branches: ['Seattle'], cohortId: 'report-1', observedThrough: '2026-09-30',
        salesCoverageConfirmation: confirmation(), fullSalesCoverage: false, stockSnapshotId: stockId(stock),
        stockCoverageConfirmed: false, freeStockValidated: false, policyConfirmed: false,
        stockMaxHours: 24, salesMaxDays: 14, reviewDays: 7, bufferDays: 21, aliases: [], policies: [] },
      cohort: { id: 'report-1', location: 'Seattle', start: '2026-09-25', end: '2026-09-30', importedAt: importedAt.toISOString(),
        records: [{ product: 'Quartz', uom: 'SF', quantitySold: 150, importedAt }] },
    };
    const row = buildPlan(input, now).rows[0];
    expect(row.coverage).toMatchObject({ state: 'estimated', days: 3, reasons: [] });
    expect(row.protective).toBeNull();
    expect(input.cohort.importedAt).toBe('2026-09-08T07:14:03.565Z');
    expect(input.scope.fullSalesCoverage).toBe(false);
  });
});
