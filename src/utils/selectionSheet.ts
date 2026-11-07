/**
 * The Selection Sheet (Check-In Log → a visit's clipboard button): the rules
 * shared by the form (src/components/sales/selectionSheet/SelectionSheetForm.jsx)
 * and its tests. Pure functions only — no React, no network.
 *
 * A sheet is a check-in's sales rep, up to SHEET_ROWS material rows
 * (material / lot / slab numbers / size / price per SF), internal notes and
 * printed notes; the record lives on OfficeCheckIn and is saved with
 * PUT /api/checkin/:id.
 *
 * Who sees what (approved 2026-10-10):
 *  - Price per SF: optional, typed like Holds' ("68", "$1,250.50"), stored
 *    as whole cents (priceCentsPerSf). The printed sheet and the customer's
 *    email show it only when someone picks "…with prices"; the sales rep's
 *    automatic email always shows it.
 *  - Printed notes (specialNotes): on every printed/emailed copy.
 *  - Internal notes: staff only — never printed or emailed to anyone.
 */

import type { CheckInRecord, SavedSelection } from '../types/checkIn.ts';
import { toCents, formatCents, centsToPlain } from '../accounting/money.ts';

/** One material row on the sheet, as typed (price as text). */
export type SheetRow = { material: string; lot: string; details: string; size: string; price: string };
/** The sheet's values (the form's state). */
export type SheetValues = {
  salesRep: string;
  salesRepEmail: string;
  builderName: string;
  builderPhone: string;
  rows: SheetRow[];
  internalNotes: string;
  specialNotes: string;
};
export type SheetInput = Omit<Partial<SheetValues>, 'rows'> & { rows?: Partial<SheetRow>[] };
export type { SavedSelection };

/** A date as the API sent it (a string); a record read straight from the database holds a Date. */
export const wireDate = (value: string | Date | null | undefined): string | null =>
  value == null ? null : typeof value === 'string' ? value : value.toISOString();
/** The check-in fields the sheet reads — a stored record or the one the screen holds. */
export type SheetCheckIn = Partial<Omit<CheckInRecord, '_id' | 'sheetEditedAt' | 'createdAt' | 'updatedAt' | 'loggedBy'>> & {
  _id?: string | { toString(): string };
  sheetEditedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export const SHEET_ROWS = 12;
// How many rows a new or short sheet shows before anyone presses "Add".
export const MIN_VISIBLE_ROWS = 3;
export const ROW_FIELDS: (keyof SheetRow)[] = ['material', 'lot', 'details', 'size', 'price'];
export const PRICE_ERROR = 'Enter the price like 12.50';

export const emptyRow = (): SheetRow => ({ material: '', lot: '', details: '', size: '', price: '' });

// A row is kept on save if *any* field is filled — a lot or slab numbers
// typed before the material is known still count.
export const rowHasData = (row: Partial<SheetRow> | null | undefined): boolean => ROW_FIELDS.some((k) => String(row?.[k] || '').trim());

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const isPriceCents = (c: unknown): c is number => Number.isSafeInteger(c) && (c as number) > 0;

/**
 * A typed price per SF → whole cents. '' → null (no price). Anything that
 * isn't a positive amount with at most two decimals → undefined.
 */
export const priceCentsOf = (typed: unknown): number | null | undefined => {
  const c = toCents(typed);
  if (c === null) return null;
  return isPriceCents(c) ? c : undefined;
};

/** "68" → "68.00", "$1,250.5" → "1250.50"; anything unreadable stays as typed. */
export const tidyPrice = (typed: unknown): string => {
  const c = priceCentsOf(typed);
  return c === undefined ? str(typed) : centsToPlain(c as number);
};

// ── Slab size ──────────────────────────────────────────────────────────────
// One way to write a slab's size everywhere (2026-10-10): width * height in
// inches, "142 * 79". People type "142 79", paste "142x79" or "142" x 79"",
// and tags read "142 x 79"; all of them become "142 * 79". Anything that
// isn't clearly two numbers (a third number for thickness, cm / mm / ft, a
// word) is left exactly as typed rather than guessed at.
const SIZE_NUM = String.raw`\d+(?:\.\d+)?(?:[ -]\d+\/\d+)?|\d+\/\d+`;
const SIZE_WITH_SEPARATOR = new RegExp(`^(${SIZE_NUM}) ?\\* ?(${SIZE_NUM})$`);
// No x / * / by: two plain numbers apart by a space, or by , / - when both
// have 2+ digits (so "1/2" is never read as 1 * 2).
const SIZE_BARE = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)$|^(\d{2,}(?:\.\d+)?) ?[,/-] ?(\d{2,}(?:\.\d+)?)$/;

// "126.50" → "126.5", "126.0" → "126", "063" → "63", "126-1/2" → "126 1/2".
const tidySizeNumber = (n: string): string => n
  .replace(/^0+(?=\d)/, '')
  .replace(/^(\d+)\.(\d*?)0+$/, (m: string, whole: string, frac: string) => (frac ? `${whole}.${frac}` : whole))
  .replace(/-(\d+\/\d+)$/, ' $1');

export const formatSlabSize = (typed: unknown): string => {
  const raw = str(typed).trim();
  if (!raw) return '';
  const s = raw.toLowerCase()
    .replace(/[“”″"'’′]/g, ' ')                  // inch (and stray foot) marks
    .replace(/(?:\b|(?<=\d))(?:inches|inch|in)\b\.?/g, ' ')  // "142in", "79 inches", "79in."
    .replace(/\bby\b/g, '*')
    .replace(/[×✕✖x*]/g, ' * ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/[a-z]/.test(s)) return raw;
  const m = s.match(SIZE_WITH_SEPARATOR);
  if (m) return `${tidySizeNumber(m[1])} * ${tidySizeNumber(m[2])}`;
  const bare = s.match(SIZE_BARE);
  if (bare) return `${tidySizeNumber(bare[1] || bare[3])} * ${tidySizeNumber(bare[2] || bare[4])}`;
  return raw;
};

/** A stored price → what the printed sheet and emails show: "$68.00" or "—". */
export const formatSheetPrice = (cents: unknown): string => (isPriceCents(cents) ? formatCents(cents) : '—');

/** { [row index]: message } for every price that can't be read. Empty = fine to save. */
export const sheetPriceErrors = (values: SheetInput | null | undefined): Record<number, string> => Object.fromEntries(
  (values?.rows || [])
    .map((r, i): [number, string | null] => [i, priceCentsOf(r?.price) === undefined ? PRICE_ERROR : null])
    .filter(([, msg]) => msg)
) as Record<number, string>;

/**
 * What the Print / Email pop-ups need: whether any material has a price
 * (no price anywhere → no "with prices" choice at all) and how many filled
 * rows would print "—".
 */
export const sheetPriceSummary = (values: SheetInput | null | undefined): { materials: number; priced: number; missing: number; any: boolean } => {
  const rows = (values?.rows || []).filter(rowHasData);
  const priced = rows.filter((r) => isPriceCents(priceCentsOf(r.price))).length;
  return { materials: rows.length, priced, missing: rows.length - priced, any: priced > 0 };
};

/** A check-in → the form's values. */
export const sheetValuesFromCheckIn = (checkIn: SheetCheckIn = {}): SheetValues => {
  const saved = (Array.isArray(checkIn.selections) ? checkIn.selections as SavedSelection[] : [])
    .map((r): SheetRow => ({
      material: str(r?.material), lot: str(r?.lot), details: str(r?.details), size: formatSlabSize(r?.size),
      price: isPriceCents(r?.priceCentsPerSf) ? centsToPlain(r.priceCentsPerSf as number) : ''
    }))
    .filter(rowHasData)
    .slice(0, SHEET_ROWS);
  const rows = [...saved];
  while (rows.length < MIN_VISIBLE_ROWS) rows.push(emptyRow());
  return {
    salesRep: str(checkIn.salesRep),
    salesRepEmail: str(checkIn.salesRepEmail),
    builderName: str(checkIn.builderName),
    builderPhone: str(checkIn.builderPhone),
    rows,
    internalNotes: str(checkIn.internalNotes),
    specialNotes: str(checkIn.specialNotes)
  };
};

// What a save would send, normalized so two snapshots compare field by field
// ("68" and "68.00" are the same price, "126 63" and "126 * 63" the same size).
const comparableField = (r: Partial<SheetRow>, k: keyof SheetRow): string => {
  if (k === 'size') return formatSlabSize(r.size);
  if (k !== 'price') return str(r[k]).trim();
  const c = priceCentsOf(r.price);
  return c === undefined ? str(r.price).trim() : str(c);
};
const NOTE_FIELDS: (keyof SheetValues)[] = ['salesRep', 'builderName', 'builderPhone', 'internalNotes', 'specialNotes'];
const comparable = (v: SheetInput): { rows: string[][]; [field: string]: string | string[][] } => ({
  ...Object.fromEntries(NOTE_FIELDS.map((k) => [k, str(v[k]).trim()])),
  rows: (v.rows || []).filter(rowHasData).map((r) => ROW_FIELDS.map((k) => comparableField(r, k)))
});

/** How many fields differ — the number the unsaved-changes check reports. */
export const countSheetChanges = (values: SheetInput | null | undefined, initial: SheetInput | null | undefined): number => {
  if (!values || !initial) return 0;
  const a = comparable(values);
  const b = comparable(initial);
  let n = NOTE_FIELDS.filter((k) => a[k] !== b[k]).length;
  for (let i = 0; i < Math.max(a.rows.length, b.rows.length); i++) {
    n += ROW_FIELDS.filter((_, f) => (a.rows[i]?.[f] || '') !== (b.rows[i]?.[f] || '')).length;
  }
  return n;
};

/**
 * The PUT body. `expectedUpdatedAt` is the check-in's updatedAt when the
 * sheet was loaded — the server answers 409 if someone saved since. Prices
 * go as whole cents; check sheetPriceErrors first (an unreadable one would
 * be sent as no price).
 */
export const sheetPayload = (values: SheetInput, expectedUpdatedAt?: string | null) => ({
  builderName: str(values.builderName),
  builderPhone: str(values.builderPhone),
  salesRep: str(values.salesRep),
  salesRepEmail: str(values.salesRepEmail),
  internalNotes: str(values.internalNotes),
  specialNotes: str(values.specialNotes),
  selections: (values.rows || []).filter(rowHasData).map((r) => ({
    material: str(r.material).trim().toUpperCase(),
    lot: str(r.lot).trim(),
    details: str(r.details).trim(),
    size: formatSlabSize(r.size),
    priceCentsPerSf: priceCentsOf(r.price) ?? null
  })),
  ...(expectedUpdatedAt ? { expectedUpdatedAt } : {})
});

/**
 * The server's read of a PUT's `selections` (PUT /api/checkin/:id): only the
 * sheet's own fields, material in capitals, and a price that is whole cents
 * or none. → { selections } or { error } for a 400.
 */
export const cleanSelections = (selections: unknown): { selections: SavedSelection[]; error?: undefined } | { error: string; selections?: undefined } => {
  if (!Array.isArray(selections)) return { error: 'Selections must be a list' };
  const out: SavedSelection[] = [];
  for (const sel of selections) {
    const raw = sel?.priceCentsPerSf;
    const blank = raw === null || raw === undefined || raw === '';
    if (!blank && !isPriceCents(raw)) return { error: 'A price on the sheet isn’t a valid amount.' };
    out.push({
      material: typeof sel?.material === 'string' ? sel.material.toUpperCase() : '',
      lot: str(sel?.lot),
      details: str(sel?.details),
      size: formatSlabSize(sel?.size),
      priceCentsPerSf: blank ? null : (raw as number)
    });
  }
  return { selections: out };
};

/**
 * What the sales rep's automatic email shows — the server re-sends it only
 * when this changes, so a new price re-sends it and an internal-notes-only
 * edit (never in any email) doesn't.
 */
export const repEmailSnapshot = (checkIn: SheetCheckIn = {}): string => JSON.stringify({
  // Sizes compared tidied, so an older sheet's "126x63" re-saved as "126 * 63"
  // isn't a change that re-emails the rep.
  selections: ((checkIn.selections || []) as SavedSelection[]).map(({ material, details, size, lot, priceCentsPerSf }) => (
    { material, details, size: formatSlabSize(size), lot, priceCentsPerSf: priceCentsPerSf ?? null }
  )),
  specialNotes: checkIn.specialNotes || '',
  salesRep: checkIn.salesRep || '',
  salesRepEmail: checkIn.salesRepEmail || ''
});

// Everything written into the print window is visitor- or staff-entered text
// in our own origin, so every value is escaped (the kiosk name used to run as
// script).
export const escapeHtml = (value: unknown): string => str(value).replace(/[&<>"']/g, (c) => (
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]
));

// ── The sheet a customer gets: print and email (2026-11-07) ──────────────
// One template for the printed sheet and every email (owner, on the claude.ai
// canvas "Selection Sheet — customer copy", direction A,
// https://claude.ai/artifact/F6qJqYpyfiuWiqyvaS8Viz): logo + "Stone Selection"
// with the day and branch; Prepared for / Fabricator / Your sales rep, each a
// name over a phone or email; Your selections (#, material, lot, slabs, size,
// and Price / SF only when asked — no slab count per row); Notes (the printed
// notes); the Hold Policy with three steps; a footer with the branch address on
// the left and its phone on the right. `sheetDoc` decides what's on it; the
// print page below and selectionSheetEmailHtml (src/services/emailService.ts)
// only lay it out.

/** The hold policy, word for word as it has always printed. */
export const HOLD_POLICY = "Items will not automatically be held. Once a final selection is made, you or your fabricator may choose to hold under the fabricator's account for 7 days. After 7 days, tags may be removed without notice to you or your fabricator.";

/** The three steps under the policy; the last names the sheet's rep when there is one. */
export const holdSteps = (rep: unknown): string[] => [
  'Give this sheet to your fabricator.',
  'They hold the slabs on their account — a hold lasts 7 days.',
  str(rep).trim() ? `Questions? Ask ${str(rep).trim()} or call the showroom.` : 'Questions? Call the showroom.'
];

/** A material's price on the customer's sheet: "$68.00", or "Ask your rep" when it has none. */
export const sheetPriceLabel = (cents: unknown): string => (isPriceCents(cents) ? formatCents(cents) : 'Ask your rep');

export type SheetDocRow = { material: string; lot: string; details: string; size: string; priceCents: number | null };
export type SheetDoc = {
  date: string;
  location: string;
  customer: { name: string; phone: string };
  fabricator: { name: string; phone: string };
  rep: { name: string; email: string };
  rows: SheetDocRow[];
  /** "3 materials" over the list. */
  count: string;
  notes: string;
  address: string;
  phone: string;
  /** "Easy Stones Kent · 6012 S 196th St, Kent, WA 98032". */
  footer: string;
  showPrices: boolean;
  steps: string[];
};

/** The form's rows (typed prices) → the sheet's rows. Empty rows are left out. */
export const docRowsFromValues = (rows: Partial<SheetRow>[] = []): SheetDocRow[] => rows.filter(rowHasData).map((r) => {
  const c = priceCentsOf(r.price);
  return { material: str(r.material).trim(), lot: str(r.lot).trim(), details: str(r.details).trim(), size: formatSlabSize(r.size), priceCents: isPriceCents(c) ? c : null };
});

/** A saved check-in's selections → the sheet's rows. */
export const docRowsFromSelections = (selections: unknown): SheetDocRow[] => (Array.isArray(selections) ? selections as SavedSelection[] : [])
  .map((r) => ({ material: str(r?.material).trim(), lot: str(r?.lot).trim(), details: str(r?.details).trim(), size: formatSlabSize(r?.size), priceCents: isPriceCents(r?.priceCentsPerSf) ? r.priceCentsPerSf as number : null }))
  .filter((r) => r.material || r.lot || r.details || r.size || r.priceCents);

/** Everything the printed or emailed sheet says, as plain text (the renderers escape it). */
export const sheetDoc = ({ checkIn = {}, rows, salesRep, salesRepEmail, notes, letterhead, date = '', showPrices = false }: {
  checkIn?: SheetCheckIn; rows: SheetDocRow[]; salesRep?: unknown; salesRepEmail?: unknown; notes?: unknown;
  letterhead?: { addressLine?: string; phone?: string } | null; date?: string; showPrices?: boolean;
}): SheetDoc => {
  const location = str(checkIn.location).trim();
  const address = str(letterhead?.addressLine).trim();
  const rep = str(salesRep).trim();
  return {
    date: str(date).trim(),
    location,
    customer: { name: str(checkIn.name).trim(), phone: str(checkIn.phone).trim() },
    fabricator: { name: str(checkIn.fabricatorCompany).trim(), phone: str(checkIn.fabricatorPhone).trim() },
    rep: { name: rep, email: rep ? str(salesRepEmail).trim() : '' },
    rows,
    count: rows.length === 1 ? '1 material' : `${rows.length} materials`,
    notes: str(notes).trim(),
    address,
    phone: str(letterhead?.phone).trim(),
    footer: [location ? `Easy Stones ${location}` : 'Easy Stones', address].filter(Boolean).join(' · '),
    showPrices,
    steps: holdSteps(rep)
  };
};

/**
 * The printable page for a sheet — what's on screen, saved or not.
 * `letterhead` is letterheadFor(location) from src/utils/locationForm.ts;
 * `logoUrl` an absolute address of the logo (the print window is about:blank,
 * so a relative one wouldn't load; without one the name prints as text).
 * `showPrices` adds the Price / SF column ("Print with prices"). Internal
 * notes are never on it.
 *
 * `@page { margin: 0 }` leaves the browser no room for its own header and
 * footer (the date, "about:blank", "1/1" it used to print); the page's own
 * padding is the margin, cloned onto a second page when a long sheet runs over.
 */
export const buildSelectionSheetHtml = ({ checkIn = {}, dateStr = '', values, letterhead, showPrices = false, logoUrl = '' }: {
  checkIn?: SheetCheckIn; dateStr?: string; values: SheetInput;
  letterhead?: { addressLine?: string; phone?: string } | null; showPrices?: boolean; logoUrl?: string;
}): string => {
  const doc = sheetDoc({
    checkIn, rows: docRowsFromValues(values.rows), salesRep: values.salesRep, salesRepEmail: values.salesRepEmail,
    notes: values.specialNotes, letterhead, date: dateStr, showPrices
  });
  const e = escapeHtml;
  const person = (label: string, name: string, sub: string) => `
        <div class="person">
          <p class="label">${label}</p>
          <p class="name">${e(name) || '—'}</p>
          ${sub ? `<p class="sub">${e(sub)}</p>` : ''}
        </div>`;
  const cols = doc.showPrices ? 6 : 5;
  const rowsHtml = doc.rows.length === 0
    ? `<tr><td colspan="${cols}" class="empty">No selections registered.</td></tr>`
    : doc.rows.map((r, i) => `
          <tr>
            <td class="num">${i + 1}</td>
            <td class="material">${e(r.material)}</td>
            <td>${e(r.lot)}</td>
            <td>${e(r.details)}</td>
            <td>${e(r.size)}</td>
            ${doc.showPrices ? `<td class="price${r.priceCents ? '' : ' none'}">${e(sheetPriceLabel(r.priceCents))}</td>` : ''}
          </tr>`).join('');
  const heading = [doc.date, doc.location].filter(Boolean).join(' · ');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Selection Sheet - ${e(doc.customer.name)}</title>
    <style>
      @page { size: letter; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1F2328; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width: 8.5in; min-height: 10.95in; margin: 0 auto; padding: 0.58in 0.67in 0.46in; display: flex; flex-direction: column; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
      p { margin: 0; }
      h1, h2 { margin: 0; font-family: Montserrat, Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-weight: 700; }
      .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
      .logo { height: 46px; width: auto; display: block; }
      .wordmark { font-size: 24px; font-weight: 800; letter-spacing: 0.12em; }
      .head-right { text-align: right; }
      .head-right h1 { font-size: 26px; }
      .head-right p { margin-top: 4px; font-size: 15px; color: #5B616B; }
      .rule { height: 2px; background: #C9A13B; margin: 20px 0 28px; }
      .people { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
      .label { margin-bottom: 6px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #5B616B; }
      .name { font-size: 18px; font-weight: 600; }
      .sub { margin-top: 2px; font-size: 15px; color: #3D434B; overflow-wrap: anywhere; }
      .section { margin-top: 32px; }
      .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
      .section-head h2, .notes h2 { font-size: 17px; }
      .count { font-size: 14px; color: #5B616B; }
      table { width: 100%; border-collapse: collapse; font-size: 16px; }
      thead tr { border-top: 1px solid #1F2328; border-bottom: 1px solid #1F2328; }
      th { text-align: left; padding: 10px 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #3D434B; white-space: nowrap; }
      td { padding: 13px 8px; border-bottom: 1px solid #D9D4C7; font-variant-numeric: tabular-nums; vertical-align: top; overflow-wrap: anywhere; }
      tr { break-inside: avoid; }
      .num { width: 40px; color: #7A5C10; font-weight: 700; white-space: nowrap; overflow-wrap: normal; }
      .material { font-weight: 600; letter-spacing: 0.02em; }
      .price, th.price { text-align: right; white-space: nowrap; }
      .price { font-weight: 700; }
      .price.none { font-weight: 400; color: #5B616B; }
      .empty { padding: 14px 8px; text-align: center; color: #5B616B; font-style: italic; }
      .price-note { margin-top: 10px; font-size: 13px; color: #5B616B; }
      .notes { margin-top: 28px; break-inside: avoid; }
      .notes h2 { margin-bottom: 8px; }
      .notes p { font-size: 16px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
      .policy { margin-top: 32px; border: 1px solid #D9C27A; border-radius: 12px; padding: 20px 22px; background: #FBF8EF; break-inside: avoid; }
      .policy-top { display: flex; gap: 12px; align-items: flex-start; }
      .policy-top svg { flex: none; margin-top: 1px; }
      .policy h2 { font-family: inherit; font-size: 17px; }
      .policy-top p { margin-top: 6px; font-size: 14px; line-height: 1.55; color: #3D434B; }
      .steps { margin: 18px 0 0; padding: 16px 0 0; border-top: 1px solid #E6DAB3; list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
      .steps li { display: flex; gap: 10px; font-size: 14px; line-height: 1.45; }
      .step-num { flex: none; width: 24px; height: 24px; border-radius: 12px; border: 1.5px solid #7A5C10; color: #7A5C10; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
      .foot { margin-top: auto; padding-top: 14px; border-top: 1px solid #D9D4C7; display: flex; justify-content: space-between; gap: 24px; font-size: 13px; color: #5B616B; }
      .foot-gap { height: 28px; flex: none; }
      .foot .phone { white-space: nowrap; }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="head">
        ${logoUrl ? `<img class="logo" src="${e(logoUrl)}" alt="Easy Stones">` : '<div class="wordmark">EASY STONES</div>'}
        <div class="head-right">
          <h1>Stone Selection</h1>
          ${heading ? `<p>${e(heading)}</p>` : ''}
        </div>
      </header>
      <div class="rule"></div>

      <section class="people">${person('Prepared for', doc.customer.name, doc.customer.phone)}${person('Fabricator', doc.fabricator.name, doc.fabricator.phone)}${person('Your sales rep', doc.rep.name, doc.rep.email)}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Your selections</h2>
          <p class="count">${e(doc.count)}${doc.showPrices ? ' · prices per square foot' : ''}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Material</th>
              <th>Lot / bundle</th>
              <th>Slabs</th>
              <th>Size (in)</th>
              ${doc.showPrices ? '<th class="price">Price / SF</th>' : ''}
            </tr>
          </thead>
          <tbody>${rowsHtml}
          </tbody>
        </table>
        ${doc.showPrices ? `<p class="price-note">Prices per square foot, as quoted on ${e(doc.date)}.</p>` : ''}
      </section>

      ${doc.notes ? `<section class="notes">
        <h2>Notes</h2>
        <p>${e(doc.notes).replace(/\n/g, '<br>')}</p>
      </section>` : ''}

      <section class="policy">
        <div class="policy-top">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7A5C10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
          <div>
            <h2>Hold Policy</h2>
            <p>${e(HOLD_POLICY)}</p>
          </div>
        </div>
        <ol class="steps">${doc.steps.map((t, i) => `<li><span class="step-num">${i + 1}</span><span>${e(t)}</span></li>`).join('')}</ol>
      </section>

      <div class="foot-gap"></div>
      <footer class="foot">
        <span>${e(doc.footer)}</span>
        <span class="phone">${e(doc.phone)}</span>
      </footer>
    </div>
    <script>
      window.onload = function() {
        window.print();
        setTimeout(function() { window.close(); }, 500);
      };
    </script>
  </body>
</html>
`;
};
