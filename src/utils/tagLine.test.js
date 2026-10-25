import { describe, it, expect } from 'vitest';
import { parseTagLine, combineTagReads, placeTagRows, closestProduct } from './tagLine';

// Real OCR of tag lines cut out beside their barcodes (Mystique and Enigma tags).
const READ_51 = '.  13583-51/(8/13583)/ 1265 / 137x79 / Mystique SJ MQ 3CM r';
const READ_52 = '19989 -52/(8/13583) / 1265 / 137x79 / Mystique SJ MQ 30';
const ENIGMA = '14180 - 3/ (1/14180) / 142x79 / Enjgma SJ MABCM';

const products = [
  { name: 'Mystique SJ MQ 3CM' },
  { name: 'Enigma SJ MQ 3CM' },
  { name: 'Calacatta Gold' },
];

describe('parseTagLine', () => {
  it('reads every field of a clean line, the other number ignored', () => {
    expect(parseTagLine(READ_51)).toEqual({ lot: '13583', slab: '51', lotCopy: '13583', size: '137x79', material: 'MYSTIQUE SJ MQ 3CM' });
  });

  it('reads the older layout without the extra number', () => {
    expect(parseTagLine(ENIGMA)).toEqual({ lot: '14180', slab: '3', lotCopy: '14180', size: '142x79', material: 'ENJGMA SJ MABCM' });
  });

  it('keeps both lot copies so a misread one shows', () => {
    expect(parseTagLine(READ_52)).toMatchObject({ lot: '19989', lotCopy: '13583', slab: '52' });
  });

  it('fixes letters read for digits, but not inside words', () => {
    expect(parseTagLine('I3S83 - 5l / (8/13583) / I265 / 137x79 / Mystique SJ MQ 3CM')).toMatchObject({ lot: '13583', slab: '51', material: 'MYSTIQUE SJ MQ 3CM' });
    expect(parseTagLine('13845 - 7 / (7/13845) / 126 x 63 / CALACATTA GOLD').material).toBe('CALACATTA GOLD');
  });

  it('doesn’t take a misread run of digits for a size', () => {
    expect(parseTagLine('49583 - 52 / (8/13583) / 1265 / 137x791 MySTHEE ZF 22').size).toBe('');
    expect(parseTagLine('13583 - 52 / 137 x 79.5 / X').size).toBe('137x79.5');
  });

  it('gives empty fields for noise', () => {
    expect(parseTagLine('RRR FRR 20 1 naar cr fam aren')).toEqual({ lot: '', slab: '', lotCopy: '', size: '', material: '' });
    expect(parseTagLine('')).toEqual({ lot: '', slab: '', lotCopy: '', size: '', material: '' });
  });
});

describe('combineTagReads', () => {
  it('puts the slabs of one lot in one row, with the catalog’s material name', () => {
    const { rows, unread } = combineTagReads([
      { texts: [READ_51] },
      { texts: [READ_52] },
      { texts: ['13583 - 53 / (8/13583) / 1265 / 137x79 / Mystique SJ MQ 3CM'] },
    ], products);
    expect(unread).toBe(0);
    expect(rows).toEqual([{ material: 'MYSTIQUE SJ MQ 3CM', lot: '13583', details: '51, 52, 53', size: '137x79', notes: [] }]);
  });

  it('settles a misread lot by the tag’s other copy and the rest of the photo', () => {
    const { rows } = combineTagReads([{ texts: [READ_52] }, { texts: [READ_51] }], products);
    expect(rows).toHaveLength(1);
    expect(rows[0].lot).toBe('13583');
  });

  it('matches a misspelled material to the catalog', () => {
    expect(combineTagReads([{ texts: [ENIGMA] }], products).rows[0].material).toBe('ENIGMA SJ MQ 3CM');
    // Not in the catalog: what was read.
    expect(combineTagReads([{ texts: [ENIGMA] }], []).rows[0].material).toBe('ENJGMA SJ MABCM');
  });

  it('takes each field from most of a tag’s reads', () => {
    const { rows } = combineTagReads([{ texts: [
      '14180 - 3 / (1/14180) / 142x79 / Enigma SJ MQ 3CM',
      '14180 - 8 / (1/14180) / 142x70 / Enigma SJ MQ 3CM',
      '14180 - 3 / (1/14180) / 142x79 / Enigma SJ MQ 3CM',
    ] }], products);
    expect(rows[0]).toMatchObject({ details: '3', size: '142x79' });
  });

  it('flags a lot it couldn’t confirm, and counts tags it couldn’t read', () => {
    const { rows, unread } = combineTagReads([
      { texts: ['13583 - 51 / (8/19583) / 137x79 / Mystique SJ MQ 3CM'] },
      { texts: ['RRR FRR 20 1 naar'] },
    ], products);
    expect(unread).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].notes[0]).toMatch(/Check the lot/);
  });

  it('makes a row per lot', () => {
    const { rows } = combineTagReads([{ texts: [READ_51] }, { texts: [ENIGMA] }], products);
    expect(rows.map((r) => [r.lot, r.details])).toEqual([['13583', '51'], ['14180', '3']]);
  });

  it('reads nothing from nothing', () => {
    expect(combineTagReads([], products)).toEqual({ rows: [], unread: 0 });
  });
});

describe('closestProduct', () => {
  it('finds the product a misread name is close to, and nothing when it’s a guess', () => {
    expect(closestProduct('ENJGMA SJ MABCM', products)?.name).toBe('Enigma SJ MQ 3CM');
    expect(closestProduct('MYSTIQUE SJ MQ 30', products)?.name).toBe('Mystique SJ MQ 3CM');
    expect(closestProduct('STATUARIO', products)).toBeNull();
    expect(closestProduct('SJ', products)).toBeNull();
    // Two products about as close: don't pick one.
    expect(closestProduct('ICE WHITF', [{ name: 'Ice White' }, { name: 'Ice Whitd' }])).toBeNull();
  });
});

describe('placeTagRows', () => {
  const empty = () => ({ material: '', lot: '', details: '', size: '', price: '' });
  const scanned = (lot) => ({ material: 'M', lot, details: '1', size: '120x60' });

  it('fills the row whose scan was pressed, keeping a typed price', () => {
    const { rows, filled } = placeTagRows([{ ...empty(), price: '28.00' }, empty()], 0, [scanned('100')], 12, empty);
    expect(rows[0]).toEqual({ material: 'M', lot: '100', details: '1', size: '120x60', price: '28.00' });
    expect(filled).toEqual([0]);
  });

  it('only writes the fields the tag gave', () => {
    const { rows } = placeTagRows([{ ...empty(), material: 'TYPED' }], 0, [{ material: '', lot: '7', details: '2', size: '' }], 12, empty);
    expect(rows[0]).toMatchObject({ material: 'TYPED', lot: '7', details: '2' });
  });

  it('puts more lots in the next empty rows, then new rows, up to the limit', () => {
    const start = [scanned('1'), empty(), { ...empty(), material: 'KEEP' }, empty()];
    const { rows, filled } = placeTagRows(start, 1, [scanned('A'), scanned('B'), scanned('C')], 5, empty);
    expect(filled).toEqual([1, 3, 4]);
    expect(rows.map((r) => r.lot || r.material)).toEqual(['1', 'A', 'KEEP', 'B', 'C']);
    const full = placeTagRows(start, 1, [scanned('A'), scanned('B'), scanned('C')], 4, empty);
    expect(full.dropped).toBe(1);
  });
});
