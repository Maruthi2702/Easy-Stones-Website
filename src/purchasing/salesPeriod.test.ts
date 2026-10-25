import { describe, it, expect } from 'vitest';
import { reportSalesPeriod } from './salesPeriod';
describe('sales period from the uploaded report', () => {
  it('uses all 273 days in January–September without a manual cutoff or upload date', () => {
    expect(reportSalesPeriod({ start: '2026-01-01', end: '2026-09-30' }, '2026-10-25'))
      .toMatchObject({ through: '2026-09-30', days: 273, source: 'report', errors: [] });
  });
  it('ignores a leftover manual cutoff for a completed report', () => {
    expect(reportSalesPeriod({ start: '2026-01-01', end: '2026-09-30' }, '2026-10-25', '2026-09-08').days).toBe(273);
  });
  it('uses a real reported-through date for a future requested end without inventing observed days', () => {
    expect(reportSalesPeriod({ start: '2026-10-01', end: '2026-10-31' }, '2026-10-25', '2026-10-24'))
      .toMatchObject({ days: 24, through: '2026-10-24', source: 'reported-through', errors: [] });
    expect(reportSalesPeriod({ start: '2026-10-01', end: '2026-10-31' }, '2026-10-25').errors).not.toHaveLength(0);
    expect(reportSalesPeriod({ start: '2026-10-01', end: '2026-10-31' }, '2026-10-25', '2026-10-29').errors).not.toHaveLength(0);
  });
  it('rejects absent and impossible file periods', () => {
    for (const report of [null, { start: 'invalid', end: '2026-09-30' }, { start: '2026-10-01', end: '2026-09-30' }])
      expect(reportSalesPeriod(report, '2026-10-25').errors).not.toHaveLength(0);
  });
});
