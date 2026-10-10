/**
 * A hold as a PDF — the Hold Information Letter (2026-10-10), laid out after
 * SPS's customer copy. Served by GET /api/holds/:id/pdf (?hide= for the print
 * preview's boxes) and built on the server with pdf-lib, like the Daily
 * Report and Check-In Log PDFs, so it looks the same everywhere. What it says
 * is worked out in holdLetter.js; this file only draws it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { letterModel } from './holdLetter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARK_PATH = path.join(HERE, '..', '..', 'public', 'favicon.png');

const PAGE = { w: 612, h: 792 }; // Letter portrait, points
const M = 36;
const W = PAGE.w - M * 2;
const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.38, 0.38, 0.38);
const FAINT = rgb(0.58, 0.58, 0.58);
const LINE = rgb(0.15, 0.15, 0.15);
const BAND = rgb(0.955, 0.95, 0.93);
const AMBER = rgb(0.6, 0.38, 0.05);
const FOOT = M + 14; // footer baseline; signatures sit above it

// Slab detail columns inside the Description area, each as wide as its widest entry.
const SUB = [
  { key: 'serial', label: 'Serial #' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'bundle', label: 'Bundle' },
  { key: 'slabNumber', label: 'Slab #' },
  { key: 'block', label: 'Block' },
  { key: 'bin', label: 'Bin' }
];
const ROW_SIZE = 8.6;

async function loadMark(doc) {
  try {
    return await doc.embedPng(fs.readFileSync(MARK_PATH));
  } catch {
    return null;
  }
}

/**
 * `hold` as the API presents it (state, totals). `letterhead` is
 * letterheadFor(the branch's Location); `hide` the preview's boxes.
 * Resolves the PDF's bytes.
 */
export async function buildHoldPdf(hold, { hide = {}, letterhead = {}, now = new Date() } = {}) {
  const m = letterModel(hold, { hide, letterhead, now });
  const doc = await PDFDocument.create();
  doc.setTitle(`Hold #${m.number} - ${hold.customer?.name || ''}`.trim());
  doc.setAuthor('Easy Stones');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique)
  };
  const okChars = new Set(fonts.regular.getCharacterSet());
  const safe = (v) => [...String(v ?? '').replace(/\s+/g, ' ')].map((ch) => (okChars.has(ch.codePointAt(0)) ? ch : '?')).join('');
  const mark = await loadMark(doc);
  const pages = [];
  let page;
  let y = 0;

  const width = (s, size, font = fonts.regular) => font.widthOfTextAtSize(safe(s), size);
  const text = (s, x, yy, { size = 10, font = fonts.regular, color = INK } = {}) => page.drawText(safe(s), { x, y: yy, size, font, color });
  const right = (s, xr, yy, o = {}) => text(s, xr - width(s, o.size || 10, o.font), yy, o);
  const center = (s, xc, yy, o = {}) => text(s, xc - width(s, o.size || 10, o.font) / 2, yy, o);
  const fit = (s, max, { size = 10, font = fonts.regular } = {}) => {
    let v = safe(s);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 1 && font.widthOfTextAtSize(`${v}…`, size) > max) v = v.slice(0, -1);
    return `${v}…`;
  };
  const wrap = (s, max, { size = 10, font = fonts.regular } = {}) => {
    const out = [];
    for (const para of String(s || '').split(/\n/)) {
      let ln = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = ln ? `${ln} ${word}` : word;
        if (font.widthOfTextAtSize(safe(next), size) > max && ln) { out.push(ln); ln = word; } else ln = next;
      }
      if (ln) out.push(ln);
    }
    return out;
  };
  const hline = (x1, x2, yy, thickness = 0.8, color = LINE) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  const vline = (x, y1, y2, thickness = 0.8) => page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color: LINE });
  const box = (x, yTop, w, h) => page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: LINE, borderWidth: 0.8 });

  const newPage = () => {
    page = doc.addPage([PAGE.w, PAGE.h]);
    pages.push(page);
    y = PAGE.h - M;
  };

  // ── Letterhead ──
  newPage();
  const top = y;
  if (mark) {
    const h = 62;
    page.drawImage(mark, { x: M, y: top - h, width: (mark.width / mark.height) * h, height: h });
  }
  const tx = M + (mark ? 64 : 0);
  text(m.company, tx, top - 12, { size: 13, font: fonts.bold });
  m.address.forEach((ln, i) => text(ln, tx, top - 28 - i * 14, { size: 11 }));
  const holdLabel = 'Hold# ';
  right(m.number, PAGE.w - M, top - 13, { size: 16, font: fonts.bold });
  right(holdLabel, PAGE.w - M - width(m.number, 16, fonts.bold), top - 13, { size: 16 });
  right(m.date, PAGE.w - M, top - 33, { size: 14, font: fonts.bold });
  right('Date: ', PAGE.w - M - width(m.date, 14, fonts.bold), top - 33, { size: 14 });
  right(m.printed, PAGE.w - M, top - 47, { size: 7.5, font: fonts.italic, color: SOFT });
  y = top - 96;
  center(m.title, PAGE.w / 2, y, { size: 19, font: fonts.bold });
  y -= 24;

  // ── Bill to · Job ──
  const gap = 14;
  const half = (W - gap) / 2;
  const jobLines = m.job ? wrap(m.job, half - 20, { size: 10.5 }).slice(0, 6) : ['—'];
  const boxH = Math.max(100, 34 + Math.max(m.billTo.length, jobLines.length) * 13 + 10);
  for (const [i, label, lines] of [[0, 'Bill To:', m.billTo], [1, 'Job / Reference:', jobLines]]) {
    const x = M + i * (half + gap);
    box(x, y, half, boxH);
    text(label, x + 10, y - 15, { size: 10.5 });
    hline(x, x + half, y - 22);
    lines.forEach((ln, j) => text(fit(ln, half - 20, { size: 10.5, font: i === 0 && j === 0 ? fonts.bold : fonts.regular }), x + 10, y - 38 - j * 13, { size: 10.5, font: i === 0 && j === 0 ? fonts.bold : fonts.regular }));
  }
  y -= boxH + 14;

  // ── Job · sales rep · hold until · branch ──
  const cellW = W / m.info.length;
  box(M, y, W, 42);
  hline(M, M + W, y - 18);
  m.info.forEach((cell, i) => {
    const xc = M + cellW * i + cellW / 2;
    if (i) vline(M + cellW * i, y, y - 42);
    center(cell.label, xc, y - 12.5, { size: 9, font: fonts.bold });
    center(fit(cell.value, cellW - 12, { size: 10 }), xc, y - 33, { size: 10 });
  });
  y -= 42;

  // ── Description table ──
  const extW = m.columns.extended ? 82 : 0;
  const unitW = m.columns.unit ? 68 : 0;
  const qtyW = 94;
  const descW = W - qtyW - unitW - extW;
  const xQty = M + descW;
  const xUnit = xQty + qtyW;
  const xExt = xUnit + unitW;
  // Each slab column as wide as its widest entry; room left over is shared out.
  const rows = m.groups.flatMap((g) => g.rows);
  const natural = SUB.map((col) => Math.max(width(col.label, 7.5), ...rows.map((r) => width(r[col.key], ROW_SIZE, col.key === 'serial' ? fonts.bold : fonts.regular))) + 8);
  const avail = descW - 24;
  const used = natural.reduce((a, b) => a + b, 0);
  const widths = natural.map((w) => (used <= avail ? w + (avail - used) / SUB.length : w * (avail / used)));
  const subX = [];
  widths.reduce((x, w) => { subX.push(x); return x + w; }, M + 16);
  let tableTop = y;

  const tableHead = () => {
    tableTop = y;
    const h = m.columns.inventory ? 34 : 24;
    text('Description', M + 8, y - 15, { size: 11, font: fonts.bold });
    if (m.columns.inventory) SUB.forEach((col, i) => text(col.label, subX[i], y - 28, { size: 7.5, color: SOFT }));
    right('Quantity', xQty + qtyW - 8, y - 15, { size: 10.5, font: fonts.bold });
    if (unitW) right('Unit Price', xUnit + unitW - 8, y - 15, { size: 10.5, font: fonts.bold });
    if (extW) right('Extended', xExt + extW - 8, y - 15, { size: 10.5, font: fonts.bold });
    y -= h;
    hline(M, M + W, y);
    y -= 16;
  };
  const tableClose = () => {
    const bottom = y + 6;
    box(M, tableTop, W, tableTop - bottom);
    for (const x of [xQty, ...(unitW ? [xUnit] : []), ...(extW ? [xExt] : [])]) vline(x, tableTop, bottom);
    y = bottom;
  };
  const room = (needed) => {
    if (y - needed >= FOOT + 24) return;
    tableClose();
    newPage();
    tableHead();
  };

  tableHead();
  for (const g of m.groups) {
    room(m.columns.inventory ? 36 : 18);
    if (m.groups.length > 1 || m.columns.inventory) page.drawRectangle({ x: M + 0.5, y: y - 4, width: descW - 1, height: 16, color: BAND });
    text(fit(g.title, descW - 16, { size: 11 }), M + 8, y, { size: 11 });
    right(g.quantity, xQty + qtyW - 8, y, { size: 10.5 });
    if (unitW) right(g.unit, xUnit + unitW - 8, y, { size: 10.5 });
    if (extW) right(g.extended, xExt + extW - 8, y, { size: 10.5 });
    y -= 16;
    for (const r of g.rows) {
      room(14);
      SUB.forEach((col, i) => {
        const max = (SUB[i + 1] ? subX[i + 1] : xQty) - subX[i] - 4;
        const font = col.key === 'serial' ? fonts.bold : fonts.regular;
        text(fit(r[col.key], max, { size: ROW_SIZE, font }), subX[i], y, { size: ROW_SIZE, font });
      });
      right(fit(r.quantity, qtyW - 12, { size: 8.3 }), xQty + qtyW - 8, y, { size: 8.3 });
      if (unitW && r.unit) right(r.unit, xUnit + unitW - 8, y, { size: ROW_SIZE });
      if (extW && r.extended) right(r.extended, xExt + extW - 8, y, { size: ROW_SIZE });
      y -= 12.5;
      if (r.note) {
        room(11);
        text(fit(`Note: ${r.note}`, xQty - subX[1] - 8, { size: 7.8, font: fonts.italic }), subX[1], y + 1.5, { size: 7.8, font: fonts.italic, color: SOFT });
        y -= 11;
      }
    }
    y -= 6;
  }
  tableClose();

  // ── Totals ──
  if (m.totals) {
    if (y - 56 < FOOT + 60) { newPage(); }
    y -= 18;
    right(m.totals.count, PAGE.w - M - 8, y, { size: 9.5, color: SOFT });
    y -= 20;
    right(m.totals.amount, PAGE.w - M - 8, y, { size: 14, font: fonts.bold });
    right(m.totals.label, PAGE.w - M - 8 - width(m.totals.amount, 14, fonts.bold) - 24, y, { size: 12, font: fonts.bold });
    if (m.totals.missing) {
      y -= 14;
      right(m.totals.missing, PAGE.w - M - 8, y, { size: 8.5, color: AMBER });
    }
  }

  // ── Where it stands, then signatures on the last page ──
  if (y - 30 < FOOT + 60) newPage();
  y -= 24;
  for (const ln of wrap(m.standing, W, { size: 10 })) { text(ln, M, y, { size: 10 }); y -= 13; }
  const sigY = FOOT + 34;
  const sigW = (W - 2 * 24) / 3;
  ['Name:', 'Signature:', 'Date:'].forEach((label, i) => {
    const x = M + i * (sigW + 24);
    text(label, x, sigY, { size: 10 });
    hline(x + width(label, 10) + 6, x + sigW, sigY - 2, 0.6);
  });

  // Footers last, once the page count is known.
  pages.forEach((p, i) => {
    page = p;
    text(`Easy Stones · Hold #${m.number}${m.state && m.state !== 'Active' ? ` · ${m.state}` : ''}`, M, FOOT - 10, { size: 7.5, color: FAINT });
    right(`Page ${i + 1} of ${pages.length}`, PAGE.w - M, FOOT - 10, { size: 7.5, color: FAINT });
  });

  return doc.save();
}

export const holdPdfFileName = (hold) => `hold-${hold.number}.pdf`;
