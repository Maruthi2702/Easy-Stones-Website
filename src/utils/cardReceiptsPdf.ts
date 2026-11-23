import type { PDFFont, PDFPage } from 'pdf-lib';
import { exportRows, formatMoney } from './cardReceipts.ts';
import type { CategoryLike, ExportExpense } from './cardReceipts.ts';

/**
 * A month of card receipts as a PDF (2026-11-23): the same rows and order as
 * the Excel file (`exportRows`, so the two can't disagree), minus the columns
 * that don't fit a page — the receipt link, approver and notes stay in Excel.
 * Built in the browser like the Excel file, with pdf-lib loaded on demand, and
 * laid out like the Check-In Log's PDF (checkInLogPdf.ts).
 */

/** A PDF holds this many lines; more points the reader to Excel. */
export const CARD_RECEIPTS_PDF_MAX_ROWS = 2000;

// Letter landscape, in points. The column widths add up to CONTENT_W.
const PAGE = { w: 792, h: 612 };
const M = 36;
const CONTENT_W = PAGE.w - M * 2;
const ROW_H = 16;
const SIZE = 8.4;

const COLS = [
  { key: 'Transaction Date', label: 'DATE', width: 62 },
  { key: 'Location', label: 'LOCATION', width: 58 },
  { key: 'C C Holder Name', label: 'CARDHOLDER', width: 110 },
  { key: 'Credit Card Number', label: 'CARD', width: 72 },
  { key: 'Description', label: 'DESCRIPTION', width: 150 },
  { key: 'Bank', label: 'BANK', width: 44 },
  { key: 'Category', label: 'CATEGORY', width: 100 },
  { key: 'Status', label: 'STATUS', width: 64 },
  { key: 'Spent Amount', label: 'AMOUNT', width: 60, right: true }
] as const;

/** The standard PDF fonts cover Western European letters only; anything else becomes "?" instead of stopping the file. */
const makeSafe = (font: PDFFont) => {
  const ok = new Set(font.getCharacterSet());
  return (value: unknown) => [...String(value ?? '').replace(/\s+/g, ' ')]
    .map((ch) => (ok.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
};

export type CardReceiptsPdfInput = {
  list: readonly ExportExpense[];
  categories: readonly CategoryLike[];
  /** "November 2026 · Amex" */
  scope?: string;
  /** "Generated Nov 23, 2026, 9:05 AM" */
  generated?: string;
  /** The logo's PNG bytes; without them the page says EASY STONES in type. */
  logo?: Uint8Array | null;
};

/** Resolves the PDF's bytes. Voided receipts are left out, as in the Excel file. */
export async function buildCardReceiptsPdf({ list, categories, scope = '', generated = '', logo = null }: CardReceiptsPdfInput) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const INK = rgb(0.07, 0.07, 0.07);
  const SOFT = rgb(0.42, 0.42, 0.42);
  const FAINT = rgb(0.62, 0.62, 0.62);
  const RULE = rgb(0.80, 0.80, 0.80);
  const BAND = rgb(0.972, 0.972, 0.972);
  const AMBER = rgb(0.60, 0.46, 0.08);

  const doc = await PDFDocument.create();
  doc.setTitle('Credit Card Receipts');
  doc.setAuthor('Easy Stones');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const safe = makeSafe(fonts.regular);
  let logoImage = null;
  if (logo) {
    try { logoImage = await doc.embedPng(logo); } catch { logoImage = null; }
  }

  const live = list.filter((e) => !e.voided);
  const total = live.length;
  const totalCents = live.reduce((sum, e) => sum + e.cents, 0);
  const rows = exportRows(live, categories).slice(0, CARD_RECEIPTS_PDF_MAX_ROWS);
  const shown = rows.length;
  const num = (n: number) => n.toLocaleString('en-US');

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  type Style = { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> };
  const text = (str: unknown, x: number, yy: number, { size = SIZE, font = fonts.regular, color = INK }: Style = {}) =>
    page.drawText(safe(str), { x, y: yy, size, font, color });
  const right = (str: unknown, xRight: number, yy: number, { size = SIZE, font = fonts.regular, color = INK }: Style = {}) => {
    const s = safe(str);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const fit = (str: unknown, maxWidth: number, { size = SIZE, font = fonts.regular }: Style = {}) => {
    let s = safe(str);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  };
  const line = (yy: number, { color = RULE, thickness = 0.5 }: { color?: ReturnType<typeof rgb>; thickness?: number } = {}) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE.w - M, y: yy }, thickness, color });

  const columnHeads = () => {
    let x = M;
    for (const col of COLS) {
      if ('right' in col) right(col.label, x + col.width - 4, y, { size: 6.6, font: fonts.bold, color: SOFT });
      else text(col.label, x + 4, y, { size: 6.6, font: fonts.bold, color: SOFT });
      x += col.width;
    }
    y -= 6;
    line(y, { color: INK, thickness: 0.7 });
    y -= 12;
  };

  const startPage = (first: boolean) => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    const top = PAGE.h - M;
    if (logoImage) {
      const w = 132;
      const h = (logoImage.height / logoImage.width) * w;
      page.drawImage(logoImage, { x: M, y: top - h + 4, width: w, height: h });
    } else {
      text('EASY STONES', M, top - 14, { size: 14, font: fonts.bold });
    }
    right(first ? 'Credit Card Receipts' : 'Credit Card Receipts (continued)', PAGE.w - M, top - 12, { size: 15, font: fonts.bold });
    const count = shown < total
      ? `First ${num(shown)} of ${num(total)} expenses`
      : `${num(total)} expense${total === 1 ? '' : 's'}`;
    right([scope, count].filter(Boolean).join(' · '), PAGE.w - M, top - 26, { size: 9, color: SOFT });
    y = top - 40;
    line(y, { color: INK, thickness: 1.2 });
    y -= 16;
    if (first && shown < total) {
      text(`This PDF stops at ${num(CARD_RECEIPTS_PDF_MAX_ROWS)} expenses. Download the Excel file for the rest.`, M, y, { size: 8, color: AMBER });
      y -= 16;
    }
    columnHeads();
  };

  startPage(true);

  if (!rows.length) text('No receipts for this month.', M + 4, y, { color: FAINT });

  rows.forEach((row, i) => {
    if (y - ROW_H < M + 24) startPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 5, width: CONTENT_W, height: ROW_H, color: BAND });
    let x = M;
    for (const col of COLS) {
      if ('right' in col) {
        right(formatMoney(Math.round(Number(row['Spent Amount']) * 100)), x + col.width - 4, y);
      } else {
        const value = row[col.key];
        if (value) {
          const font = col.key === 'C C Holder Name' ? fonts.bold : fonts.regular;
          text(fit(value, col.width - 8, { font }), x + 4, y, { font });
        }
      }
      x += col.width;
    }
    y -= ROW_H;
  });

  // The total of everything the month holds, even past the page cap.
  if (rows.length) {
    if (y - ROW_H < M + 24) startPage(false);
    y += 3;
    line(y, { color: INK, thickness: 0.7 });
    y -= 12;
    text(`TOTAL · ${num(total)} expense${total === 1 ? '' : 's'}`, M + 4, y, { font: fonts.bold });
    right(formatMoney(totalCents), PAGE.w - M - 4, y, { font: fonts.bold });
  }

  // Footers last, once the page count is known.
  pages.forEach((p, i) => {
    page = p;
    line(M + 14);
    text(generated, M, M + 3, { size: 7, color: FAINT });
    right(`Page ${i + 1} of ${pages.length}`, PAGE.w - M, M + 3, { size: 7, color: FAINT });
  });

  return doc.save();
}
