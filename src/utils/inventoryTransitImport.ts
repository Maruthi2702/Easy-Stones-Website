import type { TransitLine, TransitShipment, TransitParseResult } from '../types/inventory.ts';
import { read, utils } from 'xlsx';
import { parseHtmlRows } from './inventoryImport.ts';

const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const columns = {
  product: ['product'], sku: ['sku'], poNumber: ['po', 'ponumber'],
  poDate: ['podate'], poEtaDate: ['poetadate'], supplierSoNumber: ['supplierso'],
  siplNumber: ['sipl'], slabs: ['slabs'], quantity: ['quantity'], units: ['units'],
  location: ['location'], supplier: ['supplier'], freightForwarder: ['freightforwarder'],
  shipDate: ['shipdate'], portEtaDate: ['portetadate'], etaDate: ['etadate'],
  containerNumber: ['container', 'containernumber'], vessel: ['vessel'],
  customerReference: ['customerlocsoref'], status: ['status']
};
const dateFields = ['poDate', 'poEtaDate', 'shipDate', 'portEtaDate', 'etaDate'] as const;
const number = (value: unknown): number | null => {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const reportDate = (value: string): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
  const parsed = new Date(value);
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
};

export function parseInventoryTransitWorkbook(buffer: Buffer): TransitParseResult {
  let headers: string[], rows: Record<string, string>[];
  const text = buffer.toString('utf8');
  const binary = (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
    (buffer[0] === 0xd0 && buffer[1] === 0xcf);
  if (!binary && /<tr[\s>]/i.test(text)) {
    ({ headers, rows } = parseHtmlRows(text));
  } else {
    const workbook = read(binary ? buffer : text, { type: binary ? 'buffer' : 'string' });
    // SPS may place script/title rows above the actual column headings.
    for (const name of workbook.SheetNames) {
      const grid = utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '' });
      const index = grid.findIndex(row => row.some(c => key(c) === 'product') && row.some(c => ['po', 'ponumber'].includes(key(c))));
      if (index < 0) continue;
      headers = grid[index].map(c => String(c).trim());
      rows = grid.slice(index + 1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
      break;
    }
  }
  headers ||= [];
  rows ||= [];
  const mapping = Object.fromEntries(Object.entries(columns).map(([field, aliases]) =>
    [field, headers.find(h => aliases.includes(key(h))) || null]));
  const missingRequired = ['product', 'poNumber', 'containerNumber', 'location', 'slabs', 'quantity', 'status']
    .filter(field => !mapping[field]);
  const parsed: TransitLine[] = [];
  const errors: string[] = [];
  if (!missingRequired.length) rows.forEach((raw, index) => {
    const values = Object.fromEntries(Object.keys(columns).map(field => [field, String(raw[mapping[field] ?? ''] ?? '').trim()])) as Record<keyof TransitLine, string>;
    const row = { ...values, slabs: number(values.slabs), quantity: number(values.quantity),
      ...Object.fromEntries(dateFields.map(field => [field, values[field] ? reportDate(values[field]) : null]))
    } as unknown as TransitLine;
    // Status annotations occupy their own rows; they are not shipment lines.
    if (!row.product && !row.poNumber && !row.containerNumber) return;
    if (key(row.status) !== 'intransit') return;
    for (const field of ['product', 'poNumber', 'containerNumber', 'location'] as const) {
      if (!row[field]) errors.push(`Data row ${index + 1}: missing ${field}`);
    }
    for (const field of ['slabs', 'quantity'] as const) {
      if (row[field] === null || row[field] < 0) errors.push(`Data row ${index + 1}: invalid ${field}`);
    }
    for (const field of dateFields) {
      if (row[field] && Number.isNaN(row[field].getTime())) {
        errors.push(`Data row ${index + 1}: invalid ${field}`);
        row[field] = null;
      }
    }
    row.status = 'INTRANSIT';
    parsed.push(row);
  });
  return { headers, mapping, missingRequired, rows: parsed, errors };
}

// Replace all lines for each supplied PO/container/branch together. Repeated
// product names in one shipment are real lots and must survive re-imports.
export function groupTransitShipments(rows: TransitLine[]): TransitShipment[] {
  const groups = new Map<string, TransitShipment>();
  for (const row of rows) {
    const id = JSON.stringify([row.poNumber, row.containerNumber, row.location]);
    if (!groups.has(id)) groups.set(id, {
      poNumber: row.poNumber, containerNumber: row.containerNumber, location: row.location, lines: []
    });
    groups.get(id)!.lines.push(row);
  }
  return [...groups.values()];
}
