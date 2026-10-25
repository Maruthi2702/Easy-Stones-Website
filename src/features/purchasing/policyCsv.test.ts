import { describe, it, expect } from 'vitest';
import { parsePolicyCsv } from './policyCsv';
const head = 'product,supplier,bundleSlabs,minimumSlabs,sfPerSlab,weightKg,mixGroup,active\n';
describe('bulk variant policy import', () => {
  it('loads actual per-variant unit and loading constraints', () => {
    expect(parsePolicyCsv(head + 'Quartz 3CM,ABC,6,12,60.5,410,origin-window,true')[0]).toMatchObject({
      product: 'Quartz 3CM',
      bundleSlabs: 6,
      minimumSlabs: 12,
      sfPerSlab: 60.5,
      weightKg: 410,
      active: true,
    });
  });
  it('does not turn missing weights or fractional bundles into usable policies', () => {
    expect(() => parsePolicyCsv(head + 'Quartz,ABC,6,0,60,,mix,true')).toThrow(/weightKg/);
    expect(() => parsePolicyCsv(head + 'Quartz,ABC,1.5,0,60,400,mix,true')).toThrow(/bundleSlabs/);
  });
});
