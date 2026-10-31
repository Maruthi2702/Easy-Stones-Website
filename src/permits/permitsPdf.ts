import type { Loose } from '../types/records.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { permitPdfRows, PERMIT_PDF_MAX_ROWS } from '../utils/permitView.ts';

/**
 * The Permits list as a PDF (2026-10-11) — "View as PDF" / "Download as PDF"
 * in the Permits page's More menu, served by GET /api/permits/export.pdf.
 * Built on the server like the Check-In Log's PDF (src/utils/checkInLogPdf.ts),
 * so it looks the same for everyone. Rows are permitPdfRows (permitView.js).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(HERE, '..', '..', 'public', 'logo.png');

// Letter landscape, in points.
const PAGE = { w: 792, h: 612 };
const M = 36;
const CONTENT_W = PAGE.w - M * 2;

const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.42, 0.42, 0.42);
const FAINT = rgb(0.62, 0.62, 0.62);
const RULE = rgb(0.80, 0.80, 0.80);
const BAND = rgb(0.972, 0.972, 0.972);
const AMBER = rgb(0.60, 0.46, 0.08);

// Each column shows `main` over `sub`; `work` wraps onto both lines instead.
// Widths add up to CONTENT_W.
const COLS = [
  { label: 'ISSUED', main: 'issued', sub: 'issuer', width: 66 },
  { label: 'PERMIT', main: 'number', sub: 'kind', width: 100, bold: true },
  { label: 'ADDRESS', main: 'address', sub: 'city', width: 150 },
  { label: 'WORK', main: 'work', wrap: true, width: 218 },
  { label: 'VALUE', main: 'value', width: 62, right: true },
  { label: 'CONTRACTOR', main: 'lead', sub: 'leadSub', width: 124 }
];

const ROW_H = 26;
const SIZE = 8.4;
const SUB_SIZE = 7.4;

/**
 * The standard PDF fonts only cover Western European letters; anything else
 * would stop the whole PDF, so it becomes "?".
 */
const makeSafe = (font: Loose) => {
  const ok = new Set(font.getCharacterSet());
  return (value: unknown) => [...String(value ?? '').replace(/\s+/g, ' ')]
    .map((ch) => (ok.has(ch.codePointAt(0)) ? ch : '?'))
    .join('');
};

async function loadLogo(doc: Loose) {
  try {
    return await doc.embedPng(fs.readFileSync(LOGO_PATH));
  } catch (err) {
    console.warn('[permitsPdf] logo unavailable, falling back to the wordmark:', (err as Error).message);
    return null;
  }
}

/**
 * `items` are the permits (as the list shows them), `total` how many matched,
 * `scope` the filter line (permitPdfScope), `generated` the time line.
 * Resolves the PDF's bytes.
 */
export async function buildPermitsPdf({ items = [], total = items.length, scope = '', generated = '' }: Loose = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('Building Permits');
  doc.setAuthor('Easy Stones');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const safe = makeSafe(fonts.regular);
  const logo = await loadLogo(doc);
  const rows = permitPdfRows(items.slice(0, PERMIT_PDF_MAX_ROWS));
  const shown = rows.length;

  let page: import('pdf-lib').PDFPage;
  let y = 0;
  const pages: import('pdf-lib').PDFPage[] = [];

  const text = (str: unknown, x: number, yy: number, { size = SIZE, font = fonts.regular, color = INK }: Loose = {}) =>
    page.drawText(safe(str), { x, y: yy, size, font, color });
  const right = (str: unknown, xRight: number, yy: number, { size = SIZE, font = fonts.regular, color = INK }: Loose = {}) => {
    const s = safe(str);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const fit = (str: unknown, maxWidth: number, { size = SIZE, font = fonts.regular }: Loose = {}) => {
    let s = safe(str);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  };
  // Two lines at most: as many whole words as fit on the first, the rest cut to fit the second.
  const wrap2 = (str: unknown, maxWidth: number, opts: Loose = {}) => {
    const { size = SIZE, font = fonts.regular } = opts;
    const words = safe(str).split(' ');
    let first = '';
    while (words.length) {
      const next = first ? `${first} ${words[0]}` : words[0];
      if (font.widthOfTextAtSize(next, size) > maxWidth) break;
      first = next;
      words.shift();
    }
    if (!first) return [fit(str, maxWidth, opts)];
    return words.length ? [first, fit(words.join(' '), maxWidth, opts)] : [first];
  };
  const line = (yy: number, { color = RULE, thickness = 0.5 }: Loose = {}) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE.w - M, y: yy }, thickness, color });

  const columnHeads = () => {
    let x = M;
    for (const col of COLS) {
      if (col.right) right(col.label, x + col.width - 4, y, { size: 6.6, font: fonts.bold, color: SOFT });
      else text(col.label, x + 4, y, { size: 6.6, font: fonts.bold, color: SOFT });
      x += col.width;
    }
    y -= 6;
    line(y, { color: INK, thickness: 0.7 });
    y -= 12;
  };

  const startPage = (first: unknown) => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    const top = PAGE.h - M;
    if (logo) {
      const w = 132;
      const h = (logo.height / logo.width) * w;
      page.drawImage(logo, { x: M, y: top - h + 4, width: w, height: h });
    } else {
      text('EASY STONES', M, top - 14, { size: 14, font: fonts.bold });
    }
    right(first ? 'Building Permits' : 'Building Permits (continued)', PAGE.w - M, top - 12, { size: 15, font: fonts.bold });
    const count = shown < total
      ? `First ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} permits`
      : `${total.toLocaleString('en-US')} permit${total === 1 ? '' : 's'}`;
    right([scope, count].filter(Boolean).join(' · '), PAGE.w - M, top - 26, { size: 9, color: SOFT });
    y = top - 40;
    line(y, { color: INK, thickness: 1.2 });
    y -= 16;
    if (first && shown < total) {
      text(`This PDF stops at ${PERMIT_PDF_MAX_ROWS.toLocaleString('en-US')} permits. Narrow the dates, city or kind of work for the rest, or download the Excel file.`,
        M, y, { size: 8, color: AMBER });
      y -= 16;
    }
    columnHeads();
  };

  startPage(true);

  if (!rows.length) {
    text('No permits match these filters.', M + 4, y, { color: FAINT });
  }

  rows.forEach((row, i) => {
    if (y - ROW_H < M + 24) startPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - ROW_H + 9, width: CONTENT_W, height: ROW_H, color: BAND });
    let x = M;
    for (const col of COLS) {
      const inner = col.width - 8;
      const font = col.bold ? fonts.bold : fonts.regular;
      if (col.wrap) {
        wrap2((row as Loose)[col.main], inner).forEach((l, n) => text(l, x + 4, y - n * 10, { color: n ? rgb(0.25, 0.25, 0.25) : INK }));
      } else if ((row as Loose)[col.main]) {
        const s = fit((row as Loose)[col.main], inner, { font });
        if (col.right) right(s, x + col.width - 4, y, { font });
        else text(s, x + 4, y, { font });
      }
      if (col.sub && (row as Loose)[col.sub]) text(fit((row as Loose)[col.sub], inner, { size: SUB_SIZE }), x + 4, y - 10, { size: SUB_SIZE, color: SOFT });
      x += col.width;
    }
    y -= ROW_H;
  });

  // Footers last, once the page count is known.
  pages.forEach((p, i) => {
    page = p;
    line(M + 14);
    text(generated, M, M + 3, { size: 7, color: FAINT });
    right(`Page ${i + 1} of ${pages.length}`, PAGE.w - M, M + 3, { size: 7, color: FAINT });
  });

  return doc.save();
}
