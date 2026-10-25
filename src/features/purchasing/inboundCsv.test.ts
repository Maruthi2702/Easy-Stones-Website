import { describe, it, expect } from 'vitest';
import { parseInboundCsv, parseCsv } from './inboundCsv';
describe('SPS CSV adapter', () => {
  it('preserves quoted color names and handles a BOM and CRLF', () => {
    const rows = parseInboundCsv(
      '\ufeffpo,line,product,branch,supplier,ordered,received,cancelled,confirmed\r\nP1,1,"Quartz, White",Seattle,ABC,120,30,0,true',
    );
    expect(rows[0]).toMatchObject({ product: 'Quartz, White', ordered: 120, received: 30, confirmed: true });
  });
  it('rejects missing identities, duplicate headers, malformed quotes and fractional slabs', () => {
    expect(() => parseInboundCsv('product,ordered\nQuartz,2')).toThrow(/Missing/);
    expect(() => parseInboundCsv('po,po')).toThrow(/Duplicate/);
    expect(() => parseCsv('"unfinished')).toThrow(/Unclosed/);
    expect(() =>
      parseInboundCsv(
        'po,line,product,branch,supplier,ordered,received,cancelled\nP1,1,Q,Seattle,ABC,1.5,0,0',
      ),
    ).toThrow(/whole/);
  });
});
