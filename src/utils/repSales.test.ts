import { describe, it, expect } from 'vitest';
import { readRepSalesSheet } from './repSales.ts';

const HEAD = ['Sales Person', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26', 'Oct 26', 'Nov 26', 'Dec 26', 'Total'];
const row = (name: string, m: Record<number, number>) => {
  const cells = Array.from({ length: 12 }, (_, i) => m[i] ?? '');
  return [name, ...cells, Object.values(m).reduce((a, b) => a + b, 0)];
};
const totals = (rows: unknown[][]) => {
  const cells = Array.from({ length: 12 }, (_, i) => rows.reduce<number>((a, r) => a + (Number((r as unknown[])[i + 1]) || 0), 0));
  return ['', ...cells, cells.reduce((a, b) => a + b, 0)];
};
const body = [row('', { 2: 35.5, 10: 70 }), row('Abhi', { 0: 357152.45, 1: 366212.14 }), row('Krish', { 0: 85185.32, 10: 363198.28 }), row('administrator', { 3: -1694.78 })];

describe('readRepSalesSheet', () => {
  it('reads each sales person in whole cents, the year from the headings, and leaves the grand-total row out', () => {
    const s = readRepSalesSheet([HEAD, ...body, totals(body)]);
    expect(s.problems).toEqual([]);
    expect(s.year).toBe(2026);
    expect(s.entries.map((e) => e.name)).toEqual(['Abhi', 'Krish', 'administrator']);
    expect(s.entries[1].key).toBe('krish');
    expect(s.entries[1].cents[0]).toBe(8_518_532);
    expect(s.entries[1].cents[1]).toBeNull();
    expect(s.entries[2].cents[3]).toBe(-169_478);                 // a return is negative, kept
    expect(s.noRepCents).toBe(10_550);                              // the nameless row that isn't the totals
    expect(s.totalCents).toBe(Math.round((357152.45 + 366212.14 + 85185.32 + 363198.28 - 1694.78 + 35.5 + 70) * 100));
  });

  it('a nameless last row that is NOT the columns\' sum is sales with no sales person, not a total', () => {
    const s = readRepSalesSheet([HEAD, ...body, row('', { 5: 12 })]);
    expect(s.problems).toEqual([]);
    expect(s.noRepCents).toBe(10_550 + 1_200);
  });

  it('works without a Total column, and with four-digit years', () => {
    const head = HEAD.slice(0, 13).map((h) => h.replace(/ 26$/, ' 2026'));
    const s = readRepSalesSheet([head, ['Abhi', 100, ...Array(11).fill('')]]);
    expect(s.problems).toEqual([]);
    expect(s.year).toBe(2026);
    expect(s.entries[0].cents[0]).toBe(10_000);
  });

  it('refuses what it can\'t trust: not the report, a missing month, mixed years, a repeated name, a non-number, a Total that disagrees', () => {
    expect(readRepSalesSheet([['Customer'], ['x']]).problems[0]).toMatch(/Sales Person/);
    expect(readRepSalesSheet([HEAD.filter((h) => h !== 'Mar 26'), ['A']]).problems[0]).toMatch(/Mar/);
    expect(readRepSalesSheet([HEAD.map((h) => (h === 'Dec 26' ? 'Dec 25' : h)), ['A']]).problems[0]).toMatch(/same year/);
    expect(readRepSalesSheet([HEAD, row('Abhi', { 0: 1 }), row('ABHI', { 1: 1 })]).problems[0]).toMatch(/appears on rows 2 and 3/);
    expect(readRepSalesSheet([HEAD, ['Abhi', 'abc', ...Array(12).fill('')]]).problems[0]).toMatch(/isn't a number/);
    expect(readRepSalesSheet([HEAD, ['Abhi', 500, ...Array(11).fill(''), 9000]]).problems[0]).toMatch(/don't add up/);
    expect(readRepSalesSheet('nope').problems[0]).toMatch(/no rows/);
    expect(readRepSalesSheet([HEAD]).problems[0]).toMatch(/no rows/);
  });
});
