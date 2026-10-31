import { describe, it, expect } from 'vitest';
import { spsKey, checkSheet, spsCoverage } from './spsSheet.ts';
import { readCustomerSheet } from './customerImport.ts';

const mapping = { company: 'Name' };
const rowsOf = (...names) => names.map((Name) => ({ Name }));

const html = (rowsHtml: unknown) => Buffer.from(`<html><body><table><tr><td>Customers</td><td>Export</td></tr>
<tr><th>Name</th><th>Email</th><th>Phone1</th></tr>${rowsHtml}</table></body></html>`);

describe('spsKey', () => {
  it('trims and ignores case', () => {
    expect(spsKey('  GREAT FLOORS LLC-KENT ')).toBe('great floors llc-kent');
  });
  it('keeps spaces inside the name: SPS has two customers that differ only by one', () => {
    expect(spsKey('MARTINEZ  GRANITE AND MARBLE')).not.toBe(spsKey('Martinez granite and marble'));
  });
  it('keeps punctuation, so look-alike names stay different', () => {
    expect(spsKey('Affordable Granite')).not.toBe(spsKey('AFFORDABLE GRANITE.'));
  });
  it('is blank for no name', () => {
    expect(spsKey(undefined)).toBe('');
    expect(spsKey('   ')).toBe('');
  });
});

describe('readCustomerSheet reports what it could not read', () => {
  it('reads every well-formed row and reports none malformed', () => {
    const out = readCustomerSheet(html('<tr><td>A</td><td>a@a.com</td><td>1</td></tr><tr><td>B</td><td>b@b.com</td><td>2</td></tr>'));
    expect(out.rows).toHaveLength(2);
    expect(out.parse).toEqual({ format: 'html', malformed: [] });
  });

  it('reports a row whose cells do not line up, instead of dropping it silently', () => {
    const out = readCustomerSheet(html('<tr><td>A</td><td>a@a.com</td><td>1</td></tr><tr><td>Broken</td><td>x</td></tr><tr><td>C</td><td>c@c.com</td><td>3</td></tr>'));
    expect(out.rows.map((r) => r.Name)).toEqual(['A', 'C']);
    expect(out.parse.malformed).toEqual([{ position: 2, cells: 2, expected: 3 }]);
  });
});

describe('readCustomerSheet reads cell text', () => {
  const nameOf = (cell: unknown) => readCustomerSheet(html(`<tr><td>${cell}</td><td>a@a.com</td><td>1</td></tr>`)).rows[0].Name;

  it('decodes the common entities', () => {
    expect(nameOf('Tom&nbsp;&amp;&nbsp;Jerry &quot;Stone&quot; &lt;Co&gt;')).toBe('Tom & Jerry "Stone" <Co>');
  });
  it('decodes each entity once: "&amp;lt;" is the text "&lt;", not "<"', () => {
    expect(nameOf('A &amp;lt; B')).toBe('A &lt; B');
  });
  it('decodes numeric entities and leaves unknown ones as written', () => {
    expect(nameOf('Joe&#39;s &#x41;rt &eacute;')).toBe("Joe's Art &eacute;");
  });
  it('turns <br> into a space and drops other tags', () => {
    expect(nameOf('Line one<br/>line <b>two</b>')).toBe('Line one line two');
  });
});

describe('checkSheet', () => {
  it('passes a clean file and counts it', () => {
    const r = checkSheet({ rows: rowsOf('A', 'B', 'C'), mapping, parse: { malformed: [] } });
    expect(r).toMatchObject({ ok: true, rowsRead: 3, distinctNames: 3, blocking: [], warnings: [] });
  });

  it('blocks a file with an unreadable row, naming it', () => {
    const r = checkSheet({ rows: rowsOf('A'), mapping, parse: { malformed: [{ position: 7, cells: 2, expected: 34 }] } });
    expect(r.ok).toBe(false);
    expect(r.blocking[0]).toMatchObject({ code: 'unreadable-rows', rows: [7] });
  });

  it('blocks a file with no name column', () => {
    const r = checkSheet({ rows: rowsOf('A'), mapping: { company: null }, parse: {} });
    expect(r.ok).toBe(false);
    expect(r.blocking[0].code).toBe('no-name-column');
  });

  it('warns, with row numbers, when a name repeats (ignoring case and spaces)', () => {
    const r = checkSheet({ rows: rowsOf('Acme', 'Bay', 'ACME '), mapping });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatchObject({ code: 'repeated-names', rows: [2, 4] });
    expect(r.distinctNames).toBe(2);
  });

  it('does not repeat-flag two names that differ only by an inner space', () => {
    expect(checkSheet({ rows: rowsOf('MARTINEZ  GRANITE', 'Martinez granite'), mapping }).warnings).toEqual([]);
  });

  it('warns about rows with no name', () => {
    const r = checkSheet({ rows: rowsOf('Acme', ' ', ''), mapping });
    expect(r.warnings[0]).toMatchObject({ code: 'nameless-rows', rows: [3, 4] });
  });
});

describe('spsCoverage', () => {
  const existing = [{ company: 'Acme Stone' }, { company: 'Bay Granite', sps: { key: 'bay granite llc' } }];

  it('counts a customer present by company name or by SPS key', () => {
    const c = spsCoverage({ rows: rowsOf('ACME STONE ', 'Bay Granite LLC', 'Cobalt'), mapping, existing });
    expect(c).toMatchObject({ total: 3, present: 2, absent: 1 });
    expect(c.absentRows).toEqual([{ rowNumber: 4, name: 'Cobalt' }]);
  });

  it('ignores rows with no name and an empty database holds none', () => {
    expect(spsCoverage({ rows: rowsOf('A', ''), mapping, existing: [] })).toMatchObject({ total: 1, present: 0, absent: 1 });
  });
});
