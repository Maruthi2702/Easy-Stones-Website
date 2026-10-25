import type { TransitLine, TransitShipment, TransitParseResult } from '../types/inventory.ts';
import { read, utils } from 'xlsx';

const key = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const columns = {
  product: ['product'], sku: ['sku'], poNumber: ['po', 'ponumber'],
  poDate: ['podate'], poEtaDate: ['poetadate'], supplierSoNumber: ['supplierso'],
  siplNumber: ['sipl'], slabs: ['slabs', 'slabcount', 'noofslabs', 'numberofslabs', 'totalslabs'], quantity: ['quantity', 'qty', 'totalquantity'], units: ['units'],
  location: ['location', 'branch', 'destination', 'destinationlocation', 'warehouselocation'], supplier: ['supplier'], freightForwarder: ['freightforwarder'],
  shipDate: ['shipdate'], portEtaDate: ['portetadate'], etaDate: ['etadate'],
  containerNumber: ['container', 'containernumber', 'containerno'], vessel: ['vessel'],
  customerReference: ['customerlocsoref'], supplierPurchaseNote: ['supppurnote', 'supplierpurchasenote'], status: ['status', 'shipmentstatus']
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

const htmlText = (value: string): string => value
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, code: string) => {
    const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  })
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();

// SPS uses both th and td for column headings, sometimes within the same row.
// Read cells in their original order and expand merged heading cells so data
// stays under its original column. Decorative tables need no special status.
const htmlGrid = (text: string): string[][] => {
  const grid: string[][] = [];
  const pending = new Map<number, { value: string; remaining: number }>();
  for (const match of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = [];
    const occupied = new Set<number>();
    for (const [column, span] of pending) {
      row[column] = span.value;
      occupied.add(column);
      if (--span.remaining === 0) pending.delete(column);
    }
    let column = 0;
    for (const cell of match[1].matchAll(/<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/gi)) {
      while (occupied.has(column)) column++;
      const value = htmlText(cell[2]);
      const span = (name: string) => Math.min(256, Math.max(1, Number(cell[1].match(new RegExp(name + `\\s*=\\s*["']?(\\d+)`, 'i'))?.[1]) || 1));
      const width = span('colspan'), height = span('rowspan');
      for (let i = 0; i < width; i++, column++) {
        row[column] = value;
        occupied.add(column);
        if (height > 1) pending.set(column, { value, remaining: height - 1 });
      }
    }
    if (row.length) grid.push(Array.from({ length: row.length }, (_, i) => row[i] || ''));
  }
  return grid;
};

const aliases = new Set(Object.values(columns).flat());
const score = (row: string[]) => new Set(row.map(key).filter(value => aliases.has(value))).size;

export function parseInventoryTransitWorkbook(buffer: Buffer): TransitParseResult {
  // Excel can save CSV as UTF-8 or UTF-16; decode before detecting delimiters.
  const text = (buffer[0] === 0xff && buffer[1] === 0xfe
    ? buffer.subarray(2).toString('utf16le')
    : buffer[0] === 0xfe && buffer[1] === 0xff
      ? Buffer.from(buffer.subarray(2)).swap16().toString('utf16le')
      : buffer.toString('utf8')).replace(/^\uFEFF/, '');
  const binary = (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
    (buffer[0] === 0xd0 && buffer[1] === 0xcf);
  let grids: string[][][];
  if (!binary && /<tr[\s>]/i.test(text)) {
    grids = [htmlGrid(text)];
  } else if (binary) {
    const workbook = read(buffer, { type: 'buffer' });
    grids = workbook.SheetNames.map(name => utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '' }));
  } else {
    // The first line contains document.write('');, which can mislead CSV
    // delimiter guessing. Rank explicit delimiter parses by the real headings.
    // SheetJS handles quoted commas, escaped quotes and multiline notes.
    grids = [',', '\t', ';'].flatMap(FS => {
      const workbook = read(text, { type: 'string', FS, raw: true });
      return workbook.SheetNames.map(name => utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '' }));
    });
  }
  let headers: string[] = [], data: string[][] = [], bestScore = 0;
  for (const grid of grids) {
    grid.forEach((row, index) => {
      const candidate = row.map(value => String(value).trim());
      const candidateScore = score(candidate);
      if (candidateScore <= bestScore) return;
      bestScore = candidateScore;
      headers = candidate;
      data = grid.slice(index + 1);
    });
  }
  const rows = data.map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])));
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
