import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { checkInExportRows, CHECKIN_PDF_MAX_ROWS } from './checkInExport.js';

/**
 * The Check-In Log as a PDF (2026-10-08) — the "View as PDF" / "Download as
 * PDF" items in the log's More menu, served by GET /api/checkin/export.pdf.
 *
 * Built on the server like the Daily Work Report's PDF (dailyReportPdf.js),
 * so it looks the same for everyone, and with the same columns as the Excel
 * download (checkInExportRows), so the two can't disagree.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(HERE, '..', '..', 'public', 'logo.png');

// Letter landscape, in points: eight columns need the width.
const PAGE = { w: 792, h: 612 };
const M = 36;
const CONTENT_W = PAGE.w - M * 2;

const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.42, 0.42, 0.42);
const FAINT = rgb(0.62, 0.62, 0.62);
const RULE = rgb(0.80, 0.80, 0.80);
const BAND = rgb(0.972, 0.972, 0.972);
const AMBER = rgb(0.60, 0.46, 0.08);

// Same keys, in the same order, as the Excel file. Widths add up to CONTENT_W.
const COLS = [
  { key: 'Date', label: 'DATE', width: 72 },
  { key: 'Time', label: 'TIME', width: 70 },
  { key: 'Location', label: 'LOCATION', width: 72 },
  { key: 'Name', label: 'NAME', width: 118 },
  { key: 'Phone', label: 'PHONE', width: 82 },
  { key: 'Company/Contact Name', label: 'COMPANY / CONTACT', width: 158 },
  { key: 'Fabricator Phone', label: 'FABRICATOR PHONE', width: 82 },
  { key: 'Sales Rep', label: 'SALES REP', width: 66 }
];

const ROW_H = 16;
const SIZE = 8.4;

/**
 * The standard PDF fonts only cover Western European letters; anything else
 * (an emoji in a name, say) would stop the whole PDF, so it becomes "?".
 */
const makeSafe = (font) => {
  const ok = new Set(font.getCharacterSet());
  return (value) => [...String(value ?? '').replace(/\s+/g, ' ')]
    .map((ch) => (ok.has(ch.codePointAt(0)) ? ch : '?'))
    .join('');
};

async function loadLogo(doc) {
  try {
    return await doc.embedPng(fs.readFileSync(LOGO_PATH));
  } catch (err) {
    console.warn('[checkInLogPdf] logo unavailable, falling back to the wordmark:', err.message);
    return null;
  }
}

/**
 * `list` is the check-ins (newest first), `total` how many matched, `scope`
 * the filter line ("Seattle · October 2026"), `generated` the time line.
 * Resolves the PDF's bytes.
 */
export async function buildCheckInLogPdf({ list = [], total = list.length, scope = '', generated = '', viewerZone } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('Visitor Check-In Log');
  doc.setAuthor('Easy Stones');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const safe = makeSafe(fonts.regular);
  const logo = await loadLogo(doc);
  const rows = checkInExportRows(list, { viewerZone });
  const shown = rows.length;

  let page;
  let y = 0;
  const pages = [];

  const text = (str, x, yy, { size = SIZE, font = fonts.regular, color = INK } = {}) =>
    page.drawText(safe(str), { x, y: yy, size, font, color });
  const right = (str, xRight, yy, { size = SIZE, font = fonts.regular, color = INK } = {}) => {
    const s = safe(str);
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y: yy, size, font, color });
  };
  const fit = (str, maxWidth, { size = SIZE, font = fonts.regular } = {}) => {
    let s = safe(str);
    if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  };
  const line = (yy, { color = RULE, thickness = 0.5 } = {}) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: PAGE.w - M, y: yy }, thickness, color });

  const columnHeads = () => {
    let x = M;
    for (const col of COLS) {
      text(col.label, x + 4, y, { size: 6.6, font: fonts.bold, color: SOFT });
      x += col.width;
    }
    y -= 6;
    line(y, { color: INK, thickness: 0.7 });
    y -= 12;
  };

  const startPage = (first) => {
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
    right(first ? 'Visitor Check-In Log' : 'Visitor Check-In Log (continued)', PAGE.w - M, top - 12, { size: 15, font: fonts.bold });
    const count = shown < total
      ? `First ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} check-ins`
      : `${total.toLocaleString('en-US')} check-in${total === 1 ? '' : 's'}`;
    right([scope, count].filter(Boolean).join(' · '), PAGE.w - M, top - 26, { size: 9, color: SOFT });
    y = top - 40;
    line(y, { color: INK, thickness: 1.2 });
    y -= 16;
    if (first && shown < total) {
      text(`This PDF stops at ${CHECKIN_PDF_MAX_ROWS.toLocaleString('en-US')} check-ins. Pick a month or a branch for the rest, or download the Excel file.`,
        M, y, { size: 8, color: AMBER });
      y -= 16;
    }
    columnHeads();
  };

  startPage(true);

  if (!rows.length) {
    text('No check-ins match these filters.', M + 4, y, { color: FAINT });
  }

  rows.forEach((row, i) => {
    if (y - ROW_H < M + 24) startPage(false);
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 5, width: CONTENT_W, height: ROW_H, color: BAND });
    let x = M;
    for (const col of COLS) {
      const value = row[col.key];
      if (value) {
        const font = col.key === 'Name' ? fonts.bold : fonts.regular;
        text(fit(value, col.width - 8, { font }), x + 4, y, { font });
      }
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
