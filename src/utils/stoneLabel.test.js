import { describe, it, expect } from 'vitest';
import {
  readStoneLabel, resolveLabelRead, matchProduct, scoreLabelRead, isUsableRead, isConfidentRead,
} from './stoneLabel.js';

const products = [
  { name: 'Absolute Black', bundles: [{ bundleNumber: '13846' }, { bundleNumber: '22001' }], sizes: ['126x63'] },
  { name: 'Calacatta Gold', bundles: [{ bundleNumber: '13845' }, { bundleNumber: '13900' }], sizes: ['126x63', '130x65'] },
  { name: 'Ice', bundles: [{ bundleNumber: '50120' }] },
  { name: 'Ice White', bundles: [{ bundleNumber: '50121' }] },
  { name: 'Taj Mahal', bundles: [{ bundleNumber: 'A2207' }, { bundleNumber: '77010' }, { bundleNumber: '77012' }] },
];

const fields = (r) => r && { lot: r.lot, slab: r.slab, size: r.size, material: r.material };

describe('readStoneLabel — tag layouts', () => {
  it('reads a one-line tag', () => {
    expect(fields(readStoneLabel('13845 - 7 (7/13845) 126 x 63 CALACATTA GOLD', products)))
      .toEqual({ lot: '13845', slab: '7', size: '126 x 63', material: 'CALACATTA GOLD' });
  });

  it('reads a multi-line tag, keeping a single-digit slab number', () => {
    expect(fields(readStoneLabel('13845 - 7\n(7/13845)\n126 x 63\nCALACATTA GOLD', products)))
      .toEqual({ lot: '13845', slab: '7', size: '126 x 63', material: 'CALACATTA GOLD' });
  });

  it('survives OCR reading the bundle "/" as a 1 (real Tesseract output)', () => {
    const r = readStoneLabel('13845 - 7\n\n(7113845)\n\n126 x 63\nCALACATTA GOLD', products);
    expect(r.slab).toBe('7');
    expect(r.lot).toBe('13845');
  });

  it('takes the slab from the bundle when the tag has no "lot - slab" pair', () => {
    expect(fields(readStoneLabel('(7/13845)\n126 x 63\nCALACATTA GOLD', products)))
      .toEqual({ lot: '13845', slab: '7', size: '126 x 63', material: 'CALACATTA GOLD' });
  });

  it('reads labeled LOT / SLAB lines', () => {
    expect(fields(readStoneLabel('LOT 13845\nSLAB 12\n126 x 63\nCALACATTA GOLD', products)))
      .toEqual({ lot: '13845', slab: '12', size: '126 x 63', material: 'CALACATTA GOLD' });
  });

  it('accepts inch marks and decimals in the size', () => {
    expect(readStoneLabel('13845 - 7 126" x 63" CALACATTA GOLD', products).size).toBe('126 x 63');
    expect(readStoneLabel('13845-7\n126.5 x 63.5\nCALACATTA GOLD', products).size).toBe('126.5 x 63.5');
    expect(readStoneLabel('13845-7\n126.5 x 63.5\nCALACATTA GOLD', products).slab).toBe('7');
  });

  it('ignores thickness so "3 cm" is not taken as a slab number', () => {
    const r = readStoneLabel('LOT 13845\n126 x 63 3 CM\nCALACATTA GOLD', products);
    expect(r.slab).toBe('');
  });

  it('does not turn plain words into numbers ("lot" is not 107)', () => {
    expect(fields(readStoneLabel('lot 13845 slab 7\n126 x 63\nCalacatta Gold', products)))
      .toEqual({ lot: '13845', slab: '7', size: '126 x 63', material: 'CALACATTA GOLD' });
  });

  it('fixes digit look-alikes inside numbers ("1384S" → 13845)', () => {
    expect(readStoneLabel('1384S - 7\n126 x 63\nCALACATTA GOLD', products).lot).toBe('13845');
  });

  it('keeps letters that are part of a lot number', () => {
    expect(readStoneLabel('LOT A2207\n126 x 63\nTAJ MAHAL', products).lot).toBe('A2207');
  });

  it('snaps a misspelled material to the catalog name', () => {
    expect(readStoneLabel('13845 - 7\n126 x 63\nCALACATA G0LD', products).material).toBe('CALACATTA GOLD');
  });

  it('keeps a material that is not in the catalog as read', () => {
    const r = readStoneLabel('13845 - 7 126 x 63 STATUARIO VENATO', products);
    expect(r.material).toBe('STATUARIO VENATO');
    expect(r.product).toBeNull();
  });
});

describe('readStoneLabel — rejects what is not a tag', () => {
  // Real Tesseract output from the upright pass of a sideways tag. The old
  // parser accepted these, which stopped the rotation loop and filled in junk.
  it.each([
    ['=\nWw\n[oo]\nSH\n[3]\n[|\n~J\n=\n=\nWw\n(oo\nFN\ned\n—\nN\n[2]\nby\n[<}]\nw\n0\n>\n-\n>\n5'],
    ['ORI\n2636\nZag\non.\n3 =\n>\n®\n(@)\nr-\nlw]'],
    ["|' ;.\n~ a@ ee =\nWw fT ‘\nSs:"],
    ['ee\nTI\nBe SO'],
    [''],
  ])('%j → null', (text) => {
    expect(readStoneLabel(text, products)).toBeNull();
  });
});

describe('matchProduct', () => {
  it('prefers the longest whole-word name ("Ice White", not "Ice")', () => {
    expect(matchProduct('ICE WHITE 3CM', products).name).toBe('Ice White');
  });
  it('never matches an empty name', () => {
    expect(matchProduct('', products)).toBeNull();
  });
});

describe('resolveLabelRead — checking against stock', () => {
  const read = (over) => ({ lot: '', slab: '7', size: '', material: '', product: null, bundleLot: '', ...over });

  it('leaves the lot alone when no product was matched', () => {
    const r = resolveLabelRead(read({ lot: '13847', material: '' }), products);
    expect(r.lot).toBe('13847');
    expect(r.notes).toEqual([]);
  });

  it('corrects a single one-digit slip to the stock lot and says so', () => {
    const r = resolveLabelRead(read({ lot: '13945', material: 'CALACATTA GOLD', product: products[1] }), products);
    expect(r.lot).toBe('13845');
    expect(r.notes[0]).toMatch(/matched to stock lot 13845/);
  });

  it('does not guess between two equally close stock lots', () => {
    const r = resolveLabelRead(read({ lot: '77011', material: 'TAJ MAHAL', product: products[4] }), products);
    expect(r.lot).toBe('77011');
    expect(r.notes[0]).toMatch(/isn't in stock/);
  });

  it('uses the bundle lot when it is the one that is in stock', () => {
    const r = resolveLabelRead(read({ lot: '19845', bundleLot: '13845', product: products[1], material: 'CALACATTA GOLD' }), products);
    expect(r.lot).toBe('13845');
  });

  it('flags two different lots on a tag with no stock to check against', () => {
    const r = resolveLabelRead(read({ lot: '19845', bundleLot: '13845', material: 'STATUARIO' }), products);
    expect(r.lot).toBe('19845');
    expect(r.notes[0]).toMatch(/two lot numbers/);
  });

  it('keeps lot letters and the stock spelling', () => {
    const r = resolveLabelRead(read({ lot: 'a2207', product: products[4], material: 'TAJ MAHAL' }), products);
    expect(r.lot).toBe('A2207');
  });

  it('formats the size the way the product lists it', () => {
    const r = resolveLabelRead(read({ size: '126 x 63', product: products[1], material: 'CALACATTA GOLD' }), products);
    expect(r.size).toBe('126x63');
  });
});

describe('choosing a rotation', () => {
  const good = readStoneLabel('13845 - 7 (7/13845) 126 x 63 CALACATTA GOLD', products);
  const weak = readStoneLabel('aloo VLIVOVIVO 13845\nSTATUARIO', products);

  it('scores the clean read above a weak one, and no read lowest', () => {
    expect(scoreLabelRead(good, 91)).toBeGreaterThan(scoreLabelRead(weak, 45));
    expect(scoreLabelRead(null, 99)).toBe(-1);
  });

  it('only treats a low-confidence read as usable when it matched the catalog', () => {
    expect(isUsableRead(good, 40)).toBe(true);
    expect(isUsableRead(weak, 40)).toBe(false);
    expect(isUsableRead(weak, 80)).toBe(true);
  });

  it('stops early only on a confident, complete read', () => {
    expect(isConfidentRead(good, 91)).toBe(true);
    expect(isConfidentRead(good, 50)).toBe(false);
  });
});
