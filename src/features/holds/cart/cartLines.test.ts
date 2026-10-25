// The cart's lines as the drawer reads them: flattened, sold slabs named, and
// only in-stock, unheld slabs usable for a hold.
import { describe, it, expect } from 'vitest';
import { asLines, usable, groupsOf } from './cartLines';
import type { CartLine } from '../types';

const line = (slabKey: string, o: Partial<CartLine> = {}): CartLine => ({
  slabKey, note: '', slab: { serial: slabKey, product: 'Taj Mahal', bundle: 'B1', sfHundredths: 5500 }, inStock: true, lock: null, othersInCart: [], ...o
});

describe('asLines', () => {
  it('flattens the slab onto the line', () => {
    const [l] = asLines([line('A-1', { note: 'Island' })]);
    expect(l).toMatchObject({ slabKey: 'A-1', serial: 'A-1', product: 'Taj Mahal', bundle: 'B1', note: 'Island', sfHundredths: 5500, inStock: true, lock: null });
  });
  it('names a slab that left stock and counts it as 0 SF', () => {
    const [l] = asLines([line('GONE', { slab: null, inStock: false })]);
    expect(l.product).toBe('No longer in stock');
    expect(l.sfHundredths).toBe(0);
  });
});

describe('usable', () => {
  it('is in stock and not on a hold', () => {
    const [ok, held, gone] = asLines([line('A'), line('B', { lock: { holdNumber: 12 } }), line('C', { inStock: false })]);
    expect([usable(ok), usable(held), usable(gone)]).toEqual([true, false, false]);
  });
});

describe('groupsOf', () => {
  it('groups by product and notices mixed bundles', () => {
    const groups = groupsOf(asLines([line('A'), line('B', { slab: { product: 'Taj Mahal', bundle: 'B2', sfHundredths: 100 } }), line('C', { slab: { product: 'Black Pearl', bundle: 'P1' } })]));
    expect(groups.map((g) => [g.product, g.slabs, g.mixedLots])).toEqual([['Taj Mahal', 2, true], ['Black Pearl', 1, false]]);
    expect(groups[0].sfHundredths).toBe(5600);
  });
});
