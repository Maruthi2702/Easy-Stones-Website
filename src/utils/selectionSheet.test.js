import { describe, it, expect } from 'vitest';
import {
  sheetValuesFromCheckIn, countSheetChanges, sheetPayload, salesRepOptions, buildSelectionSheetHtml,
  rowHasData, MIN_VISIBLE_ROWS, SHEET_ROWS
} from './selectionSheet.js';

const checkIn = {
  _id: 'c1',
  name: 'Pat Visitor',
  location: 'Seattle',
  salesRep: 'Rita Rep',
  salesRepEmail: 'rita@x.com',
  specialNotes: 'Hold for Friday',
  selections: [
    { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63' },
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
    expect(v.rows.length).toBe(MIN_VISIBLE_ROWS);
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
});

describe('sheetPayload', () => {
  it('sends only rows with data, uppercases material, carries the loaded version', () => {
    const v = sheetValuesFromCheckIn(checkIn);
    v.rows[1] = { material: '', lot: '55555', details: '', size: '' };
    v.rows[0].material = 'calacatta gold';
    const p = sheetPayload(v, '2026-10-04T10:00:00.000Z');
    expect(p.selections).toEqual([
      { material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63' },
      { material: '', lot: '55555', details: '', size: '' }
    ]);
    expect(p.expectedUpdatedAt).toBe('2026-10-04T10:00:00.000Z');
  });
  it('leaves expectedUpdatedAt out when there is none', () => {
    expect(sheetPayload(sheetValuesFromCheckIn({}), null)).not.toHaveProperty('expectedUpdatedAt');
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

  it('says so when there are no selections', () => {
    const html = buildSelectionSheetHtml({ checkIn: {}, dateStr: '', values: sheetValuesFromCheckIn({}), letterhead });
    expect(html).toContain('No selections registered.');
  });
});
