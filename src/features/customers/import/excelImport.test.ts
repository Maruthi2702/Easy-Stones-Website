import { describe, it, expect } from 'vitest';
import { plural, withEntry, importForm, describeFailure, reviewCsvText } from './excelImport';

const res = (body: string, status = 400) => new Response(body, { status, statusText: 'Bad' });

describe('Excel import window rules', () => {
  it('pluralises', () => {
    expect(plural(1, 'row')).toBe('1 row');
    expect(plural(0, 'row')).toBe('0 rows');
  });
  it('sets or drops an answer', () => {
    expect(withEntry({ a: '1' }, 'b', '2')).toEqual({ a: '1', b: '2' });
    expect(withEntry({ a: '1', b: '2' }, 'b', '')).toEqual({ a: '1' });
  });
  it('posts the file and only the answers that were given', () => {
    const body = importForm(new File(['x'], 'f.xls'), { mapping: { company: 'Name' }, repAliases: {} });
    expect([...body.keys()]).toEqual(['file', 'mapping']);
    expect(body.get('mapping')).toBe('{"company":"Name"}');
  });
  it('words a failure from message, error and hint, always with the status', async () => {
    expect(await describeFailure(res('{"message":"Bad file"}'))).toBe('Bad file (HTTP 400)');
    expect(await describeFailure(res('{"error":"Not found","hint":"Restart the server"}', 404))).toBe('Not found — Restart the server (HTTP 404)');
    expect(await describeFailure(res('  oops  ', 500))).toBe('HTTP 500 — oops');
    expect(await describeFailure(res('', 502))).toBe('HTTP 502 — Bad');
  });
  it('lists each review row once per possible match', () => {
    const csv = reviewCsvText([
      { action: 'create', rowNumber: 1 },
      { action: 'review', rowNumber: 5, company: 'PG', reason: 'Looks like', matches: [{ label: 'Pacific', signals: ['phone', 'name'], score: 0.9 }, { label: 'Other', signals: ['name'], score: 0.4 }] }
    ]).split('\n');
    expect(csv).toHaveLength(3);
    expect(csv[1]).toBe('"5","PG","","","","","Looks like","Pacific","phone + name","0.9"');
  });
});
