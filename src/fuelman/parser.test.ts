import { describe, expect, it } from 'vitest';
import { pageRows } from './parserRows';
import { contentSignature, parseReport } from './parseReport';
import { fixturePages, fixtureReport } from './testing/fixtures';
describe('Fuelman PDF adapter', () => {
  it('uses detail rather than the exception summary, preserving taxes, DEF and credits', () => {
    const report = parseReport(fixturePages());
    expect(report.totalCents).toBe(5250); expect(report.lines).toHaveLength(5);
    expect(report.amounts).toEqual({ fuel: 4200, def: 600, supplies: 500, tax: 50, adjustment: -100, other: 0 });
    expect(report.employees[0]!.reportedTotalCents).toBe(5250);
  });
  it('recognizes antifreeze as fleet supplies and leaves ambiguous miscellaneous purchases for review', () => {
    const pages = fixturePages();
    const supply = pages[1]!.rows.find(r => r.text.includes('Automotive Supplies'))!;
    supply.text = supply.text.replace('Automotive Supplies', 'Antifreeze');
    expect(parseReport(pages).lines[2]!.category).toBe('supplies');
    supply.text = supply.text.replace('Antifreeze', 'Driver Purchase Miscellaneous');
    expect(parseReport(pages).lines[2]!.category).toBe('other');
  });
  it('rejects missing and reordered report pages', () => {
    expect(() => parseReport(fixturePages().slice(0, 1))).toThrow(/pages.*missing/);
    const pages = fixturePages(); pages[1]!.number = 3; expect(() => parseReport(pages)).toThrow(/out of order/);
  });
  it('refuses mismatched amounts, missing totals and truncated employee sections', () => {
    const bad = fixturePages(); bad[1]!.rows.find(r => r.text.includes('Employee Total'))!.text = 'Employee Total: $50.00';
    expect(() => parseReport(bad)).toThrow(/reconcile/);
    const absent = fixturePages(); absent[1]!.rows = absent[1]!.rows.filter(r => !r.text.includes('No. Transactions'));
    expect(() => parseReport(absent)).toThrow(/reconcile/);
  });
  it('retains continuation context and flags purchases before the statement month', () => {
    const pages = fixturePages(), rows = pages[1]!.rows;
    rows.splice(4, 0, { text: 'Employee Name: Driver Alp Employee Number :A (continued)', parts: [], y: 400 });
    rows[3]!.text = rows[3]!.text.replace('07/01', '06/30');
    const report = parseReport(pages); expect(report.employees).toHaveLength(1); expect(report.lines[0]!.date).toBe('2026-06-30');
    expect(report.warnings.join(' ')).toMatch(/predate/);
  });
  it('preserves repeated identical purchases and hashes a multiset rather than deleting them', () => {
    const report = fixtureReport(), changed = { ...report, lines: [...report.lines, report.lines[0]!] };
    expect(contentSignature(changed)).not.toBe(contentSignature(report));
    expect(contentSignature({ ...report, lines: [...report.lines].reverse() })).toBe(contentSignature(report));
  });
  it('groups slightly displaced amount baselines and keeps vehicle continuation text separate', () => {
    const page = pageRows(1, 612, 792, [{ str: 'Employee Total:', transform: [1, 0, 0, 1, 20, 100], width: 40, height: 8 },
      { str: '$52.50', transform: [1, 0, 0, 1, 480, 101.4], width: 30, height: 8 }]);
    expect(page.rows).toHaveLength(1); expect(page.rows[0]!.text).toBe('Employee Total: $52.50');
  });
});
