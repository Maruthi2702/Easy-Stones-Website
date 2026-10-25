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

// Keep nested SPS tables separate: closing an image/status subtable's row
// must not close its parent product row or shift the PO/container columns.
type HtmlCell = { text: string; colspan: number; rowspan: number };
type HtmlTable = { rows: HtmlCell[][]; row: HtmlCell[] | null; cell: HtmlCell | null };
const htmlGrids = (text: string): string[][][] => {
  const createTable = (): HtmlTable => ({ rows: [], row: null, cell: null });
  const tables: HtmlTable[] = [];
  const stack = [createTable()];
  const finishCell = (table: HtmlTable) => {
    if (table.cell && table.row) table.row.push(table.cell);
    table.cell = null;
  };
  const finishRow = (table: HtmlTable) => {
    finishCell(table);
    if (table.row?.length) table.rows.push(table.row);
    table.row = null;
  };
  for (const match of text.matchAll(/<[^>]*>|[^<]+/g)) {
    const token = match[0];
    const table = stack[stack.length - 1];
    const tag = token.match(/^<\s*(\/?)\s*(table|tr|td|th)\b([^>]*)>/i);
    if (!tag) { if (table.cell) table.cell.text += token; continue; }
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (name === 'table') {
      if (!closing) stack.push(createTable());
      else if (stack.length > 1) {
        finishRow(table);
        tables.push(table);
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent.cell) parent.cell.text += ' ' + table.rows.flat().map(cell => htmlText(cell.text)).join(' ').slice(0, 2048);
      }
    } else if (name === 'tr') {
      finishRow(table);
      if (!closing) table.row = [];
    } else if (closing) finishCell(table);
    else {
      finishCell(table);
      table.row ||= [];
      const span = (attribute: string) => Math.min(256, Math.max(1, Number(tag[3].match(new RegExp(attribute + `\\s*=\\s*["']?(\\d+)`, 'i'))?.[1]) || 1));
      table.cell = { text: '', colspan: span('colspan'), rowspan: span('rowspan') };
    }
  }
  for (const table of stack) { finishRow(table); tables.push(table); }
  return tables.map(table => {
    const pending = new Map<number, { value: string; remaining: number }>();
    return table.rows.map(cells => {
      const row: string[] = [];
      const occupied = new Set<number>();
      for (const [column, span] of pending) {
        row[column] = span.value;
        occupied.add(column);
        if (--span.remaining === 0) pending.delete(column);
      }
      let column = 0;
      for (const cell of cells) {
        while (occupied.has(column)) column++;
        const value = htmlText(cell.text);
        for (let i = 0; i < cell.colspan; i++, column++) {
          row[column] = value;
          occupied.add(column);
          if (cell.rowspan > 1) pending.set(column, { value, remaining: cell.rowspan - 1 });
        }
      }
      return Array.from({ length: row.length }, (_, i) => row[i] || '');
    });
  });
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
    grids = htmlGrids(text);
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
  const diagnostics = { productRows: 0, skippedStatusCounts: {} as Record<string, number> };
  if (!missingRequired.length) rows.forEach((raw, index) => {
    const values = Object.fromEntries(Object.keys(columns).map(field => [field, String(raw[mapping[field] ?? ''] ?? '').trim()])) as Record<keyof TransitLine, string>;
    const row = { ...values, slabs: number(values.slabs), quantity: number(values.quantity),
      ...Object.fromEntries(dateFields.map(field => [field, values[field] ? reportDate(values[field]) : null]))
    } as unknown as TransitLine;
    // Status annotations occupy their own rows; they are not shipment lines.
    if (!row.product && !row.poNumber && !row.containerNumber) return;
    diagnostics.productRows++;
    const status = htmlText(row.status);
    // Status cells can include SPS's display annotations after the status.
    const inTransit = /^in[\s_-]*transit(?:$|\s+(?:initiated\b|eta\b|\d+\s+days?\s+ago\b))/i.test(status);
    if (!inTransit) {
      const label = status.slice(0, 80) || '(blank)';
      diagnostics.skippedStatusCounts[label] = (diagnostics.skippedStatusCounts[label] || 0) + 1;
      return;
    }
    for (const field of ['product', 'location'] as const) {
      if (!row[field]) errors.push(`Data row ${index + 1}: missing ${field}`);
    }
    for (const field of ['slabs', 'quantity'] as const) {
      if ((row[field] === null && (field === 'quantity' || values[field] !== '')) || (row[field] !== null && row[field] < 0)) errors.push(`Data row ${index + 1}: invalid ${field}`);
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
  const warnings: string[] = [];
  for (const [field, label] of [['poNumber', 'PO#'], ['containerNumber', 'Container#'], ['slabs', 'slab count']] as const) {
    const count = parsed.filter(row => field === 'slabs' ? row.slabs === null : !row[field]).length;
    if (count) warnings.push(`${count} product line${count === 1 ? ' has' : 's have'} no ${label} in SPS. These values remain unknown; supplied quantities and references are preserved.`);
  }
  return { headers, mapping, missingRequired, rows: parsed, errors, diagnostics, warnings };
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
