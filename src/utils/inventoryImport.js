/**
 * Parses the two SPS exports the Inventory Analysis tab is built on:
 *
 * - "Inventory In Stock - Detail" (a real .xlsx workbook, one row per
 *   slab/lot) — parseInventoryStockWorkbook
 * - "Fast Moving Inventory - by Company ..." (an HTML document dressed up as
 *   .xls, one row per product, aggregated over a date range/location baked
 *   into its title) — parseInventorySalesWorkbook
 *
 * Column headers are matched by keyword rather than exact string, the same
 * approach src/utils/customerImport.js uses, because SPS renames columns
 * between exports and nothing here should silently import the wrong field
 * just because a heading changed case or wording.
 */
import { read, utils } from 'xlsx';

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * SPS's HTML export isn't a real workbook: it's an HTML document with the
 * real data table nested inside a decorative outer one and mismatched
 * closing tags, so a strict table parser grabs the wrong table. Scanning for
 * <tr>/<td>/<th> directly (same trick as customerImport.js's
 * parseHtmlWorkbook) finds the real grid regardless of the broken nesting —
 * the header row is whichever all-<th> row is widest.
 */
const TR_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const TH_RE = /<th[^>]*>([\s\S]*?)<\/th>/gi;
const TD_RE = /<td[^>]*>([\s\S]*?)<\/td>/gi;

const parseHtmlRows = (text) => {
  const stripTags = (s) => s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  // Reusing these two compiled patterns across every row (matchAll clones a
  // global regex internally, so this is safe) avoids recompiling the same
  // pattern from scratch twice per row — the previous version constructed a
  // fresh RegExp per cellsOf() call, i.e. per row per tag.
  const cellsOf = (rowHtml, re) =>
    [...rowHtml.matchAll(re)].map(c => stripTags(c[1]));

  const rows = [...text.matchAll(TR_RE)]
    .map(m => {
      const th = cellsOf(m[1], TH_RE);
      const td = cellsOf(m[1], TD_RE);
      return th.length && !td.length
        ? { type: 'header', cells: th }
        : td.length ? { type: 'data', cells: td } : null;
    })
    .filter(Boolean);

  const headerRow = rows
    .filter(r => r.type === 'header')
    .sort((a, b) => b.cells.length - a.cells.length)[0];

  // Some SPS exports use <td> for the header row too (no <th> at all) — fall
  // back to the widest data-shaped row that looks like text, not numbers.
  const fallbackHeaderRow = !headerRow && rows.length
    ? rows.reduce((best, r) => (r.cells.length > (best?.cells.length || 0) ? r : best), null)
    : null;

  const effectiveHeaderRow = headerRow || fallbackHeaderRow;
  if (!effectiveHeaderRow) return { rawText: text, headers: [], rows: [] };

  const rawHeaders = effectiveHeaderRow.cells;
  const headerRowIndex = rows.indexOf(effectiveHeaderRow);
  const dataRows = rows.slice(headerRowIndex + 1)
    .filter(r => r.cells.length === rawHeaders.length)
    .map(r => Object.fromEntries(rawHeaders.map((h, i) => [h, r.cells[i] ?? ''])));

  return { rawText: text, headers: rawHeaders, rows: dataRows };
};

/** Real xlsx (zip) starts with 'PK'; real binary xls (OLE) starts with D0CF11E0. Same check as customerImport.js's isBinaryWorkbook. */
const isBinaryWorkbook = (buffer) =>
  (buffer[0] === 0x50 && buffer[1] === 0x4b) ||
  (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);

/**
 * Loads a workbook buffer as either a real xlsx/xls binary or SPS's
 * HTML-disguised export, decided by magic bytes rather than guessing from
 * content shape.
 */
const loadRows = (buffer, sheetHint) => {
  if (!isBinaryWorkbook(buffer)) {
    const parsed = parseHtmlRows(buffer.toString('utf8'));
    return { headers: parsed.headers, rows: parsed.rows, rawFirstCell: parsed.rawText };
  }

  const wb = read(buffer, { type: 'buffer' });
  const sheetName = sheetHint && wb.SheetNames.includes(sheetHint) ? sheetHint : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error('The file has no readable sheet');

  const grid = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const headerIndex = grid.findIndex(r => r.some(c => c !== ''));
  if (headerIndex === -1) throw new Error('The sheet has no header row');

  const headers = grid[headerIndex].map(h => String(h).trim());
  const rows = grid.slice(headerIndex + 1)
    .filter(r => r.some(c => c !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows, rawFirstCell: String(grid[0]?.[0] || '') };
};

const resolveMapping = (headers, columns) => {
  const mapping = {};
  const claimed = new Set();
  for (const [field, keywords] of columns) {
    mapping[field] = null;
    for (const word of keywords) {
      const hit = headers.find(h => !claimed.has(h) && h.toLowerCase().trim() === word);
      if (hit) { claimed.add(hit); mapping[field] = hit; break; }
    }
    if (mapping[field]) continue;
    for (const word of keywords) {
      const hit = headers.find(h => !claimed.has(h) && h.toLowerCase().includes(word));
      if (hit) { claimed.add(hit); mapping[field] = hit; break; }
    }
  }
  return mapping;
};

// Fields that need conversion instead of a plain trimmed string. Driving both
// parsers' row-building off their COLUMNS list (below) plus these two sets
// means a field only has to be named once — previously each parser repeated
// its full field list a second time as a hand-written object literal, and
// the two lists could silently drift apart (a field present in COLUMNS but
// missing from the row builder would just never get imported).
const NUMERIC_FIELDS = new Set([
  'instockQty', 'availableSlabs', 'availableQuantity', 'unitFobCost', 'unitLandedCost',
  'purchaseCost', 'assetValue', 'slabsSold', 'quantitySold', 'saleValue', 'cost',
  'avgSellingPrice', 'avgCost', 'margin', 'marginPercent'
]);
const DATE_FIELDS = new Set(['receivedDate']);

const buildRow = (r, mapping, columns) => {
  const row = {};
  for (const [field] of columns) {
    const raw = r[mapping[field]];
    if (DATE_FIELDS.has(field)) row[field] = dateOrNull(raw);
    else if (NUMERIC_FIELDS.has(field)) row[field] = num(raw);
    else row[field] = String(raw ?? '').trim();
  }
  return row;
};

// ---------------------------------------------------------------------------
// Inventory In Stock - Detail
// ---------------------------------------------------------------------------

export const STOCK_COLUMNS = [
  ['product', ['product']],
  ['sku', ['sku']],
  ['genericSku', ['generic sku']],
  ['type', ['type']],
  ['category', ['category']],
  ['subCategory', ['sub category']],
  ['group', ['group']],
  ['kind', ['kind']],
  ['serialNumber', ['serial#', 'serial']],
  ['barcodeId', ['barcodeid', 'barcode']],
  ['bundle', ['bundle']],
  ['slabNumber', ['slab number']],
  ['block', ['block']],
  ['idFour', ['idfour']],
  ['idFive', ['idfive']],
  ['suppBarcodeId', ['supp barcodeid', 'supplier barcode']],
  ['bin', ['bin']],
  ['dimensions', ['dimensions']],
  ['instockQty', ['instock qty', 'in stock qty']],
  ['availableSlabs', ['available slabs']],
  ['availableQuantity', ['available quantity']],
  ['units', ['units']],
  ['supplier', ['supplier']],
  ['unitFobCost', ['unit fob cost']],
  ['unitLandedCost', ['unit landed cost']],
  ['purchaseCost', ['purchase cost']],
  ['assetValue', ['asset value']],
  ['location', ['location']],
  ['slabStatus', ['slab status']],
  ['notes', ['notes']],
  ['remnant', ['remnant']],
  ['receivedDate', ['received date']]
];

const STOCK_REQUIRED = ['product', 'receivedDate', 'instockQty'];

export const parseInventoryStockWorkbook = (buffer) => {
  const { headers, rows } = loadRows(buffer, 'Sheet 1');
  const mapping = resolveMapping(headers, STOCK_COLUMNS);
  const missingRequired = STOCK_REQUIRED.filter(f => !mapping[f]);

  const parsedRows = missingRequired.length ? [] : rows
    .map(r => buildRow(r, mapping, STOCK_COLUMNS))
    .filter(r => r.product);

  return { headers, mapping, missingRequired, rows: parsedRows };
};

// ---------------------------------------------------------------------------
// Fast Moving Inventory (sold / velocity)
// ---------------------------------------------------------------------------

export const SALES_COLUMNS = [
  ['product', ['name']],
  ['sku', ['sku']],
  ['type', ['type']],
  ['category', ['category']],
  ['subCategory', ['sub category']],
  ['group', ['group']],
  ['origin', ['origin']],
  ['slabsSold', ['slabs']],
  ['quantitySold', ['quantity']],
  ['uom', ['uom']],
  ['saleValue', ['sale value']],
  ['cost', ['cost']],
  ['avgSellingPrice', ['avg. selling price', 'avg selling price']],
  ['avgCost', ['avg. cost', 'avg cost']],
  ['margin', ['margin']],
  ['marginPercent', ['margin%']]
];

const SALES_REQUIRED = ['product', 'quantitySold'];

// The report title — e.g. "Fast Moving Inventory - by Company Sort By
// Quantity (Jan 1 2026 - Sep 30 2026) Location - Seattle" — is the only place
// SPS records which period/location a sales export covers. Excel's HTML
// export carries it as the worksheet name (<x:Name>), not as visible cell
// text, so that's checked first; a plain title string (e.g. typed by an
// admin, or a binary workbook's first cell) is used as a fallback. Either
// way this is only a convenience default for the import modal — the admin
// still confirms or overrides both before anything is written, since a
// mis-parsed date range would silently mislabel every velocity number
// computed from it.
export const parseSalesReportTitle = (rawText) => {
  const full = String(rawText || '');
  // Multiple <x:Name> tags can appear (e.g. a plain "Sheet 1" tab name
  // alongside the real report title) — the title is reliably the longest one.
  const nameTags = [...full.matchAll(/<x:Name>([^<]*)<\/x:Name>/gi)].map(m => m[1]);
  const bestNameTag = nameTags.sort((a, b) => b.length - a.length)[0];
  const text = (bestNameTag || full).replace(/\s+/g, ' ').trim();

  const locationMatch = text.match(/Location\s*-\s*([A-Za-z0-9 &'.,-]+?)\s*$/);
  const rangeMatch = text.match(/\(([A-Za-z]+ \d{1,2} \d{4})\s*-\s*([A-Za-z]+ \d{1,2} \d{4})\)/);

  const periodStart = rangeMatch ? dateOrNull(rangeMatch[1]) : null;
  const periodEnd = rangeMatch ? dateOrNull(rangeMatch[2]) : null;
  const location = locationMatch ? locationMatch[1].trim() : '';

  return { location, periodStart, periodEnd };
};

export const parseInventorySalesWorkbook = (buffer) => {
  const { headers, rows, rawFirstCell } = loadRows(buffer);
  const mapping = resolveMapping(headers, SALES_COLUMNS);
  const missingRequired = SALES_REQUIRED.filter(f => !mapping[f]);
  const detected = parseSalesReportTitle(rawFirstCell);

  const parsedRows = missingRequired.length ? [] : rows
    .map(r => buildRow(r, mapping, SALES_COLUMNS))
    .filter(r => r.product);

  return { headers, mapping, missingRequired, rows: parsedRows, detected };
};
