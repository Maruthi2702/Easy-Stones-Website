import type { InboundRow } from '../../purchasing/types';
export const inboundHeaders = [
  'po',
  'line',
  'product',
  'branch',
  'supplier',
  'ordered',
  'received',
  'cancelled',
  'eta',
  'confirmed',
  'shipment',
  'shipped',
  'shipmentReceived',
  'shipmentEta',
];
// Quoted fields, escaped quotes, CRLF, embedded newlines and a UTF-8 BOM.
export function parseCsv(text: string): string[][] {
  if (text.length > 5_000_000) throw new Error('Use a CSV smaller than 5 MB');
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (value === '') quoted = true;
      else throw new Error('Invalid CSV quoting');
    } else if (c === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length > 5001) throw new Error('Import at most 5,000 rows');
  return rows;
}
export function parseInboundCsv(text: string): InboundRow[] {
  const [headers, ...data] = parseCsv(text.replace(/^\uFEFF/, ''));
  if (!headers) throw new Error('The CSV is empty');
  const keys = headers.map((h) => h.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate CSV column headers');
  const required = ['po', 'line', 'product', 'branch', 'supplier', 'ordered', 'received', 'cancelled'];
  for (const name of required)
    if (!keys.includes(name)) throw new Error(`Missing ${name}. Use the SPS adapter template.`);
  return data.map((row, index) => {
    const raw = (key: string) => row[keys.indexOf(key.toLowerCase())]?.trim() || '';
    const number = (key: string, optional = false) => {
      const v = raw(key);
      if (optional && !v) return 0;
      const n = Number(v);
      if (!v || !Number.isSafeInteger(n) || n < 0)
        throw new Error(`Row ${index + 2}: ${key} needs a nonnegative whole slab count`);
      return n;
    };
    const flag = raw('confirmed').toLowerCase();
    if (flag && !['true', 'false', 'yes', 'no', '1', '0'].includes(flag))
      throw new Error(`Row ${index + 2}: confirmed must be true or false`);
    return {
      po: raw('po'),
      line: raw('line'),
      product: raw('product'),
      branch: raw('branch'),
      supplier: raw('supplier'),
      ordered: number('ordered'),
      received: number('received'),
      cancelled: number('cancelled'),
      eta: raw('eta'),
      confirmed: ['true', 'yes', '1'].includes(flag),
      shipment: raw('shipment'),
      shipped: number('shipped', true),
      shipmentReceived: number('shipmentReceived', true),
      shipmentEta: raw('shipmentEta'),
    };
  });
}
