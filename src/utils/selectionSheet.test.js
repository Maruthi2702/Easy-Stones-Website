import { describe, it, expect } from 'vitest';
import {
  sheetValuesFromCheckIn, countSheetChanges, sheetPayload, salesRepOptions, buildSelectionSheetHtml,
  rowHasData, MIN_VISIBLE_ROWS, SHEET_ROWS, priceCentsOf, tidyPrice, formatSheetPrice, sheetPriceErrors,
  sheetPriceSummary, cleanSelections, repEmailSnapshot, PRICE_ERROR
} from './selectionSheet.js';

const checkIn = {
  _id: 'c1',
  name: 'Pat Visitor',
  location: 'Seattle',
  salesRep: 'Rita Rep',
  salesRepEmail: 'rita@x.com',
  specialNotes: 'Hold for Friday',
  internalNotes: 'Builder pricing — ask manager',
  selections: [
    { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800 },
    { material: '', lot: '', details: '', size: '' }
  ]
};

describe('sheetValuesFromCheckIn', () => {
  it('keeps saved rows, drops blank ones, pads to the minimum', () => {
    const v = sheetValuesFromCheckIn(checkIn);
    expect(v.rows.length).toBe(MIN_VISIBLE_ROWS);
    expect(v.rows[0].lot).toBe('13845');
    expect(v.rows.slice(1).every((r) => !rowHasData(r))).toBe(true);
  });

  it('never shows more than the row limit', () => {
    const many = { selections: Array.from({ length: 20 }, (_, i) => ({ material: `M${i}` })) };
    expect(sheetValuesFromCheckIn(many).rows.length).toBe(SHEET_ROWS);
  });

  it('copes with a check-in that has no sheet yet', () => {
    const v = sheetValuesFromCheckIn({});
    expect(v.salesRep).toBe('');
    expect(v.internalNotes).toBe('');
    expect(v.rows.length).toBe(MIN_VISIBLE_ROWS);
  });

  it('shows a stored price as dollars, and none as blank', () => {
    const v = sheetValuesFromCheckIn(checkIn);
    expect(v.rows[0].price).toBe('68.00');
    expect(v.rows[1].price).toBe('');
    expect(v.internalNotes).toBe('Builder pricing — ask manager');
  });

  it('a row with only a price still counts as data', () => {
    expect(rowHasData({ price: '12' })).toBe(true);
  });
});

describe('prices', () => {
  it('reads what people type, in whole cents', () => {
    expect(priceCentsOf('68')).toBe(6800);
    expect(priceCentsOf('$1,250.5')).toBe(125050);
    expect(priceCentsOf(' 12.05 ')).toBe(1205);
    expect(priceCentsOf('')).toBe(null);
    expect(priceCentsOf(null)).toBe(null);
  });
  it('rejects anything that isn\'t a positive price', () => {
    for (const bad of ['abc', '12.345', '-5', '0', '0.00', '1e3']) expect(priceCentsOf(bad)).toBe(undefined);
  });
  it('tidies a readable price and leaves the rest as typed', () => {
    expect(tidyPrice('68')).toBe('68.00');
    expect(tidyPrice('$1,250.5')).toBe('1250.50');
    expect(tidyPrice('')).toBe('');
    expect(tidyPrice('abc')).toBe('abc');
  });
  it('formats for paper', () => {
    expect(formatSheetPrice(6800)).toBe('$68.00');
    expect(formatSheetPrice(125050)).toBe('$1,250.50');
    expect(formatSheetPrice(null)).toBe('—');
  });
  it('flags only the rows whose price can\'t be read', () => {
    const rows = [{ price: '12' }, { price: 'twelve' }, { price: '' }, { price: '-1' }];
    expect(sheetPriceErrors({ rows })).toEqual({ 1: PRICE_ERROR, 3: PRICE_ERROR });
  });
  it('summarizes which materials have a price', () => {
    const rows = [{ material: 'A', price: '12' }, { material: 'B', price: '' }, { material: '', price: '' }];
    expect(sheetPriceSummary({ rows })).toEqual({ materials: 2, priced: 1, missing: 1, any: true });
    expect(sheetPriceSummary({ rows: [{ material: 'A' }] }).any).toBe(false);
  });
});

describe('countSheetChanges', () => {
  const initial = sheetValuesFromCheckIn(checkIn);
  it('is 0 for the loaded sheet, ignoring padding rows and surrounding spaces', () => {
    const same = { ...initial, specialNotes: ' Hold for Friday ', rows: [...initial.rows, { material: '', lot: '', details: '', size: '' }] };
    expect(countSheetChanges(same, initial)).toBe(0);
  });
  it('counts each changed field', () => {
    const rows = initial.rows.map((r) => ({ ...r }));
    rows[0].lot = '99999';
    rows[1].material = 'ICE';
    expect(countSheetChanges({ ...initial, salesRep: 'Other', rows }, initial)).toBe(3);
  });
  it('counts a price and the internal notes, but "68" is the same as "68.00"', () => {
    const same = initial.rows.map((r, i) => (i === 0 ? { ...r, price: '68' } : r));
    expect(countSheetChanges({ ...initial, rows: same }, initial)).toBe(0);
    const priced = initial.rows.map((r, i) => (i === 0 ? { ...r, price: '70' } : r));
    expect(countSheetChanges({ ...initial, rows: priced, internalNotes: 'new' }, initial)).toBe(2);
  });
});

describe('sheetPayload', () => {
  it('sends only rows with data, uppercases material, carries the loaded version', () => {
    const v = sheetValuesFromCheckIn(checkIn);
    v.rows[1] = { material: '', lot: '55555', details: '', size: '' };
    v.rows[0].material = 'calacatta gold';
    const p = sheetPayload(v, '2026-10-04T10:00:00.000Z');
    expect(p.selections).toEqual([
      { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800 },
      { material: '', lot: '55555', details: '', size: '', priceCentsPerSf: null }
    ]);
    expect(p.internalNotes).toBe('Builder pricing — ask manager');
    expect(p.specialNotes).toBe('Hold for Friday');
    expect(p.expectedUpdatedAt).toBe('2026-10-04T10:00:00.000Z');
  });
  it('leaves expectedUpdatedAt out when there is none', () => {
    expect(sheetPayload(sheetValuesFromCheckIn({}), null)).not.toHaveProperty('expectedUpdatedAt');
  });
});

describe('cleanSelections (server)', () => {
  it('keeps only the sheet\'s fields, capitalizes material, keeps whole-cent prices', () => {
    const { selections } = cleanSelections([
      { material: 'ice white', lot: 1, details: '2', size: '3', priceCentsPerSf: 4250, extra: 'x' },
      { material: 5, priceCentsPerSf: '' }
    ]);
    expect(selections).toEqual([
      { material: 'ICE WHITE', lot: '1', details: '2', size: '3', priceCentsPerSf: 4250 },
      { material: '', lot: '', details: '', size: '', priceCentsPerSf: null }
    ]);
  });
  it('refuses a list that isn\'t one, and any price that isn\'t positive whole cents', () => {
    expect(cleanSelections('nope').error).toBeTruthy();
    for (const bad of [12.5, -100, 0, '6800', NaN]) {
      expect(cleanSelections([{ material: 'A', priceCentsPerSf: bad }]).error).toBeTruthy();
    }
  });
});

describe('repEmailSnapshot', () => {
  it('changes with a price or the printed notes, not with internal notes', () => {
    const base = repEmailSnapshot(checkIn);
    expect(repEmailSnapshot({ ...checkIn, internalNotes: 'something else' })).toBe(base);
    expect(repEmailSnapshot({ ...checkIn, specialNotes: 'new' })).not.toBe(base);
    const repriced = { ...checkIn, selections: [{ ...checkIn.selections[0], priceCentsPerSf: 7000 }, checkIn.selections[1]] };
    expect(repEmailSnapshot(repriced)).not.toBe(base);
  });
  it('treats a missing price like no price, so old sheets don\'t re-send on their first save', () => {
    const old = { selections: [{ material: 'A', lot: '', details: '', size: '' }] };
    const saved = { selections: [{ material: 'A', lot: '', details: '', size: '', priceCentsPerSf: null }] };
    expect(repEmailSnapshot(saved)).toBe(repEmailSnapshot(old));
  });
});

describe('salesRepOptions', () => {
  const reps = [
    { name: 'Rita Rep', email: 'rita@x.com', role: 'sales_rep', location: 'Seattle' },
    { name: 'Gone Rep', email: 'gone@x.com', role: 'sales_rep', location: 'Seattle', isActive: false },
    { name: 'Spokane Rep', email: 's@x.com', role: 'sales_rep', location: 'Spokane' },
    { name: 'Everywhere Mgr', email: 'm@x.com', role: 'manager', assignedLocations: ['*'] },
    { name: 'Driver Dan', email: 'd@x.com', role: 'driver', location: 'Seattle' }
  ];

  it('offers active selling staff at this branch, sorted', () => {
    expect(salesRepOptions(reps, 'Seattle').map((o) => o.value)).toEqual(['Everywhere Mgr', 'Rita Rep']);
  });

  it('never offers someone deactivated…', () => {
    expect(salesRepOptions(reps, 'Seattle').some((o) => o.value === 'Gone Rep')).toBe(false);
  });

  it('…but keeps them visible, marked, when the sheet already names them', () => {
    const opts = salesRepOptions(reps, 'Seattle', { name: 'Gone Rep', email: 'gone@x.com' });
    expect(opts[0]).toEqual({ value: 'Gone Rep', label: 'Gone Rep (inactive)', email: 'gone@x.com' });
  });

  it('keeps a hand-typed name from an older sheet as it was', () => {
    expect(salesRepOptions(reps, 'Seattle', { name: 'Old Typed Name', email: '' })[0].label).toBe('Old Typed Name');
  });
});

describe('buildSelectionSheetHtml', () => {
  const letterhead = { addressLine: '1440 Westinghouse Blvd, Charlotte, NC 28273', contactLine: '(980) 201-9506' };

  it('escapes everything a visitor or staff member typed', () => {
    const html = buildSelectionSheetHtml({
      checkIn: { ...checkIn, name: '<img src=x onerror=alert(1)>', fabricatorCompany: 'Acme <b>Fab</b>' },
      dateStr: 'Oct 4, 2026',
      values: { ...sheetValuesFromCheckIn(checkIn), specialNotes: '<script>x</script>\nline 2' },
      letterhead
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Acme &lt;b&gt;Fab&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;<br>line 2');
  });

  it('prints the branch letterhead and only rows with data', () => {
    const html = buildSelectionSheetHtml({ checkIn, dateStr: 'Oct 4', values: sheetValuesFromCheckIn(checkIn), letterhead });
    expect(html).toContain('1440 Westinghouse Blvd, Charlotte, NC 28273');
    expect(html).toContain('CALACATTA GOLD');
    expect((html.match(/<tr style="border-bottom/g) || []).length).toBe(1);
  });

  it('adds the Price / SF column only when asked, and never prints internal notes', () => {
    const values = sheetValuesFromCheckIn({ ...checkIn, selections: [...checkIn.selections, { material: 'ICE WHITE' }] });
    const plain = buildSelectionSheetHtml({ checkIn, dateStr: '', values, letterhead });
    expect(plain).not.toContain('Price / SF');
    expect(plain).not.toContain('$68.00');
    const priced = buildSelectionSheetHtml({ checkIn, dateStr: '', values, letterhead, showPrices: true });
    expect(priced).toContain('Price / SF');
    expect(priced).toContain('$68.00');
    expect(priced).toContain('—');
    for (const html of [plain, priced]) {
      expect(html).toContain('Hold for Friday');
      expect(html).not.toContain('Builder pricing');
    }
  });

  it('says so when there are no selections', () => {
    const html = buildSelectionSheetHtml({ checkIn: {}, dateStr: '', values: sheetValuesFromCheckIn({}), letterhead });
    expect(html).toContain('No selections registered.');
  });
});
