import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The Daily Work Report as paper.
 *
 * Generated on the server rather than from the browser's print dialog, so the
 * document is identical for everyone — a browser's "Print to PDF" varies by
 * browser, by printer settings, and by whoever last touched the margins.
 *
 * pdf-lib ships the fourteen standard PDF fonts, so this sets in Helvetica.
 * On a page of numbers that reads well and keeps generation instant.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(HERE, '..', '..', 'public', 'logo.png');

// Letter portrait, in points.
const PAGE = { w: 612, h: 792 };
const M = 46;                       // margin
const CONTENT_W = PAGE.w - M * 2;

const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.42, 0.42, 0.42);
const FAINT = rgb(0.62, 0.62, 0.62);
const HAIR = rgb(0.90, 0.90, 0.90);
const RULE = rgb(0.80, 0.80, 0.80);
const BAND = rgb(0.976, 0.976, 0.976);
const GREEN = rgb(0.12, 0.48, 0.26);
const AMBER = rgb(0.60, 0.46, 0.08);

const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (v) => Number(v || 0).toLocaleString('en-US');

/** A figure nobody entered is a dash, not a zero — they mean different things. */
const orDash = (v) => (Number(v) ? int(v) : '—');

const longDate = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
};

const shortDay = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const monthName = (ym) => {
  const d = new Date(`${ym}-01T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** A tiny drawing surface over a pdf-lib page, so the layout code reads as layout. */
function makeCanvas(page, fonts) {
  return {
    page,
    text(str, x, y, { size = 9.5, font = fonts.regular, color = INK } = {}) {
      page.drawText(String(str ?? ''), { x, y, size, font, color });
    },
    right(str, xRight, y, { size = 9.5, font = fonts.regular, color = INK } = {}) {
      const s = String(str ?? '');
      page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color });
    },
    line(x1, y, x2, { color = HAIR, thickness = 0.5 } = {}) {
      page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
    },
    rect(x, y, w, h, opts = {}) {
      page.drawRectangle({ x, y, width: w, height: h, ...opts });
    },
    /** Truncate rather than let a long material name run into the next column. */
    fit(str, maxWidth, { size = 9.5, font = fonts.regular } = {}) {
      let s = String(str ?? '');
      if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
      while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > maxWidth) s = s.slice(0, -1);
      return s + '…';
    }
  };
}

async function loadLogo(doc) {
  try {
    return await doc.embedPng(fs.readFileSync(LOGO_PATH));
  } catch (err) {
    console.warn('[dailyReportPdf] logo unavailable, falling back to the wordmark:', err.message);
    return null;
  }
}

/** Shared masthead: logo left, title and meta right, rule underneath. */
function drawHeader(c, fonts, logo, { title, meta, status }) {
  const top = PAGE.h - M;

  if (logo) {
    const w = 148;
    const h = (logo.height / logo.width) * w;
    c.page.drawImage(logo, { x: M, y: top - h + 4, width: w, height: h });
  } else {
    c.text('EASY STONES', M, top - 14, { size: 14, font: fonts.bold });
    c.text('YOUR GLOBAL DESIGN SOURCE', M, top - 24, { size: 6.5, font: fonts.regular, color: SOFT });
  }

  const rightEdge = PAGE.w - M;
  c.right(title, rightEdge, top - 12, { size: 15, font: fonts.bold });
  c.right(meta, rightEdge, top - 25, { size: 9, color: SOFT });

  let y = top - 34;
  if (status) {
    const label = status.toUpperCase();
    const size = 7;
    const w = fonts.bold.widthOfTextAtSize(label, size) + 12;
    const colour = status === 'submitted' ? GREEN : AMBER;
    c.rect(rightEdge - w, y - 10, w, 13, { borderColor: colour, borderWidth: 0.8 });
    c.right(label, rightEdge - 6, y - 6, { size, font: fonts.bold, color: colour });
    y -= 16;
  }

  const ruleY = Math.min(y - 6, top - 46);
  c.line(M, ruleY, PAGE.w - M, { color: INK, thickness: 1.2 });
  return ruleY - 18;
}

/** The five headline figures, boxed and divided. */
function drawGlance(c, fonts, y, cells) {
  const h = 46;
  const colW = CONTENT_W / cells.length;
  c.rect(M, y - h, CONTENT_W, h, { borderColor: RULE, borderWidth: 0.6 });

  cells.forEach((cell, i) => {
    const x = M + colW * i;
    if (i > 0) {
      c.page.drawLine({
        start: { x, y: y - h }, end: { x, y },
        thickness: 0.5, color: HAIR
      });
    }
    c.text(cell.label.toUpperCase(), x + 9, y - 13, { size: 6.4, font: fonts.bold, color: SOFT });
    c.text(cell.value, x + 9, y - 30, { size: 15, font: fonts.bold });
    if (cell.sub) c.text(c.fit(cell.sub, colW - 18, { size: 6.6 }), x + 9, y - 40, { size: 6.6, color: FAINT });
  });

  return y - h - 16;
}

function drawSectionTitle(c, fonts, x, y, w, title) {
  c.text(title.toUpperCase(), x, y, { size: 7.6, font: fonts.bold, color: rgb(0.2, 0.2, 0.2) });
  c.line(x, y - 4, x + w, { color: INK, thickness: 0.8 });
  return y - 14;
}

/**
 * A section table. `cols` are [{ key, align, width }]; a row flagged `total`
 * gets the banded treatment the spreadsheet's yellow rows had.
 */
function drawTable(c, fonts, x, y, w, { head, rows, cols }) {
  let cursor = y;

  if (head) {
    let cx = x;
    cols.forEach((col, i) => {
      const label = head[i];
      if (label) {
        if (col.align === 'right') c.right(label, cx + col.width, cursor, { size: 6.4, font: fonts.bold, color: FAINT });
        else c.text(label, cx, cursor, { size: 6.4, font: fonts.bold, color: FAINT });
      }
      cx += col.width;
    });
    cursor -= 4;
    c.line(x, cursor, x + w, { color: HAIR });
    cursor -= 10;
  }

  rows.forEach(row => {
    if (row.total) {
      c.rect(x, cursor - 4, w, 14, { color: BAND });
      c.line(x, cursor + 10, x + w, { color: RULE });
      c.line(x, cursor - 4, x + w, { color: RULE });
    }
    const font = row.total ? fonts.bold : fonts.regular;

    // "No containers recorded" is a sentence, not a value — give it the whole
    // width rather than truncating it inside the first column.
    if (row.span) {
      c.text(c.fit(row.cells[0], w - 6, { size: 8.6, font }), x, cursor, { size: 8.6, font, color: FAINT });
      c.line(x, cursor - 4, x + w, { color: rgb(0.95, 0.95, 0.95) });
      cursor -= 14;
      return;
    }

    let cx = x;
    cols.forEach((col, i) => {
      const cell = row.cells[i];
      if (cell !== null && cell !== undefined && cell !== '') {
        const colour = row.muted && i > 0 ? FAINT : INK;
        if (col.align === 'right') c.right(cell, cx + col.width, cursor, { size: 8.6, font, color: colour });
        else c.text(c.fit(cell, col.width - 6, { size: 8.6, font }), cx, cursor, { size: 8.6, font, color: colour });
      }
      cx += col.width;
    });
    if (!row.total) c.line(x, cursor - 4, x + w, { color: rgb(0.95, 0.95, 0.95) });
    cursor -= 14;
  });

  return cursor - 4;
}

function drawFooter(c, fonts, leftText, rightText) {
  c.line(M, M + 18, PAGE.w - M, { color: RULE });
  if (leftText) c.text(leftText, M, M + 7, { size: 7.4, color: rgb(0.3, 0.3, 0.3) });
  c.right(rightText, PAGE.w - M, M + 7, { size: 6.8, color: FAINT });
}

const stamp = (d = new Date()) =>
  `${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}, ` +
  `${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

/* ─────────────────────────────────────────────────────────────────────────────
   One day, one branch
   ───────────────────────────────────────────────────────────────────────────── */
export async function buildDayPdf(report) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const logo = await loadLogo(doc);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const c = makeCanvas(page, fonts);

  const v = report.visitors || {};
  const visitors = Number(v.homeowners || 0) + Number(v.fabricators || 0) + Number(v.designers || 0);
  const assigned = Number(report.deliveries?.assigned || 0) + Number(report.pickups?.assigned || 0);
  // Stored as `capacity` — the column the sheet shows is "Slabs".
  const slabsOut = Number(report.deliveries?.capacity || 0) + Number(report.pickups?.capacity || 0);
  const transfers = report.transfers || [];
  const containers = report.containers || [];
  const transferSlabs = transfers.reduce((s, t) => s + Number(t.slabs || 0), 0);
  const transferCount = transfers.reduce((s, t) => s + Number(t.count || 0), 0);
  const containerSlabs = containers.reduce((s, x) => s + Number(x.slabs || 0), 0);
  const pay = report.payments || {};
  const payCount = ['cash', 'card', 'check'].reduce((s, k) => s + Number(pay[k]?.count || 0), 0);
  const payAmount = ['cash', 'card', 'check'].reduce((s, k) => s + Number(pay[k]?.amount || 0), 0);

  let y = drawHeader(c, fonts, logo, {
    title: 'Daily Work Report',
    meta: `${report.location} · ${longDate(report.date)}`,
    status: report.status
  });

  y = drawGlance(c, fonts, y, [
    { label: 'Visitors', value: int(visitors), sub: `${int(v.homeowners || 0)} homeowners` },
    { label: 'Deliveries', value: int(assigned), sub: slabsOut ? `${int(slabsOut)} slabs` : 'no slabs counted yet' },
    { label: 'Slabs in', value: int(containerSlabs), sub: `${containers.length} line${containers.length === 1 ? '' : 's'}` },
    { label: 'Slabs out', value: int(transferSlabs), sub: `${transfers.length} transfer${transfers.length === 1 ? '' : 's'}` },
    { label: 'Payments', value: money(payAmount), sub: `${payCount} transaction${payCount === 1 ? '' : 's'}` }
  ]);

  // Two columns, matching the tab: Visitors/Transfers/Payments | Delivery/Containers/Notes
  const gap = 20;
  const colW = (CONTENT_W - gap) / 2;
  const leftX = M;
  const rightX = M + colW + gap;
  let ly = y;
  let ry = y;

  // ── left column ──
  ly = drawSectionTitle(c, fonts, leftX, ly, colW, 'Visitors');
  ly = drawTable(c, fonts, leftX, ly, colW, {
    cols: [{ align: 'left', width: colW - 70 }, { align: 'right', width: 70 }],
    rows: [
      { cells: ['Homeowners', int(v.homeowners || 0)] },
      { cells: ['Fabricators', int(v.fabricators || 0)] },
      { cells: ['Designers', int(v.designers || 0)] },
      { cells: ['Total', int(visitors)], total: true }
    ]
  });

  ly -= 8;
  ly = drawSectionTitle(c, fonts, leftX, ly, colW, 'Transfers');
  ly = drawTable(c, fonts, leftX, ly, colW, {
    head: ['From — To', 'Count', 'Slabs'],
    cols: [{ align: 'left', width: colW - 110 }, { align: 'right', width: 55 }, { align: 'right', width: 55 }],
    rows: transfers.length
      ? [...transfers.map(t => ({ cells: [t.fromTo || '—', int(t.count), int(t.slabs)] })),
         { cells: ['Total', int(transferCount), int(transferSlabs)], total: true }]
      : [{ cells: ['No transfers recorded'], span: true },
         { cells: ['Total', '0', '0'], total: true }]
  });

  ly -= 8;
  ly = drawSectionTitle(c, fonts, leftX, ly, colW, 'Payments');
  // Last block in the column — nothing follows it now that the footer carries
  // the sign-off, so its finishing cursor is nobody's business.
  drawTable(c, fonts, leftX, ly, colW, {
    head: ['Method', 'Trans.', 'Amount'],
    cols: [{ align: 'left', width: colW - 130 }, { align: 'right', width: 45 }, { align: 'right', width: 85 }],
    rows: [
      { cells: ['Cash', int(pay.cash?.count), money(pay.cash?.amount)] },
      { cells: ['Credit Card (CC)', int(pay.card?.count), money(pay.card?.amount)] },
      { cells: ['Check', int(pay.check?.count), money(pay.check?.amount)] },
      { cells: ['Total', int(payCount), money(payAmount)], total: true }
    ]
  });

  // ── right column ──
  ry = drawSectionTitle(c, fonts, rightX, ry, colW, 'Delivery & Pick-Up');
  ry = drawTable(c, fonts, rightX, ry, colW, {
    head: ['', 'Count', 'Slabs'],
    cols: [{ align: 'left', width: colW - 130 }, { align: 'right', width: 65 }, { align: 'right', width: 65 }],
    rows: [
      { cells: ['Deliveries', int(report.deliveries?.assigned), int(report.deliveries?.capacity)] },
      { cells: ['Pick-ups', int(report.pickups?.assigned), int(report.pickups?.capacity)] },
      { cells: ['Total', int(assigned), int(slabsOut)], total: true },
      { cells: ['Returns', orDash(report.returns), ''], muted: !Number(report.returns) },
      { cells: ['Sinks', orDash(report.sinks), ''], muted: !Number(report.sinks) }
    ]
  });

  ry -= 8;
  ry = drawSectionTitle(c, fonts, rightX, ry, colW, 'Containers');
  ry = drawTable(c, fonts, rightX, ry, colW, {
    head: ['PO#', 'Material', 'Slabs'],
    cols: [{ align: 'left', width: 58 }, { align: 'left', width: colW - 113 }, { align: 'right', width: 55 }],
    rows: containers.length
      ? [...containers.map(x => ({ cells: [x.poNumber || '', x.material || '', int(x.slabs)] })),
         { cells: ['Total', '', int(containerSlabs)], total: true }]
      : [{ cells: ['No containers recorded'], span: true },
         { cells: ['Total', '', '0'], total: true }]
  });

  if (report.notes) {
    ry -= 8;
    ry = drawSectionTitle(c, fonts, rightX, ry, colW, 'Notes');
    // Wrap by hand — pdf-lib draws a single line at a time.
    const words = String(report.notes).split(/\s+/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (fonts.regular.widthOfTextAtSize(next, 8.4) > colW) {
        c.text(line, rightX, ry, { size: 8.4, color: rgb(0.25, 0.25, 0.25) });
        ry -= 11;
        line = word;
      } else {
        line = next;
      }
    }
    if (line) { c.text(line, rightX, ry, { size: 8.4, color: rgb(0.25, 0.25, 0.25) }); ry -= 11; }
  }

  // Who stands behind the figures, read from the status rather than from the
  // presence of a name: a reopened day still carries the name of whoever
  // submitted it last, and printing that under a DRAFT badge said two opposite
  // things on one page.
  const when = (d) => (d ? ` · ${stamp(new Date(d))}` : '');
  const signedOff =
    report.status === 'submitted'
      ? (report.autoSubmitted
          ? `Submitted automatically${when(report.submittedAt)}`
          : `Submitted by ${report.submittedBy || 'unknown'}${when(report.submittedAt)}`)
      : report.reopenedBy
        ? `Draft · reopened by ${report.reopenedBy}${when(report.reopenedAt)}`
        : 'Draft · not submitted';

  // The branch and the title are in the header already, so the footer carries
  // the one thing the page doesn't say twice.
  drawFooter(c, fonts, signedOff, `Generated ${stamp()} · Page 1 of 1`);

  return doc.save();
}

/* ─────────────────────────────────────────────────────────────────────────────
   A month, one branch or all of them
   ───────────────────────────────────────────────────────────────────────────── */
export async function buildMonthPdf({ month, rows, scopeLabel }) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  const logo = await loadLogo(doc);

  const byBranch = new Map();
  for (const r of rows) {
    if (!byBranch.has(r.location)) byBranch.set(r.location, []);
    byBranch.get(r.location).push(r);
  }

  const sum = (list, key) => list.reduce((s, r) => s + Number(r[key] || 0), 0);
  const grand = {
    visitors: sum(rows, 'visitors'), deliveries: sum(rows, 'deliveries'), pickups: sum(rows, 'pickups'),
    containerSlabs: sum(rows, 'containerSlabs'), transferSlabs: sum(rows, 'transferSlabs'), payments: sum(rows, 'payments')
  };

  const cols = [
    { align: 'left', width: 92 },   // day
    { align: 'right', width: 62 },  // visitors
    { align: 'right', width: 62 },  // deliveries
    { align: 'right', width: 62 },  // pick-ups
    { align: 'right', width: 66 },  // slabs in
    { align: 'right', width: 66 },  // slabs out
    { align: 'right', width: 90 }   // payments
  ];
  const head = ['Day', 'Visitors', 'Deliveries', 'Pick-ups', 'Slabs in', 'Slabs out', 'Payments'];

  let page = doc.addPage([PAGE.w, PAGE.h]);
  let c = makeCanvas(page, fonts);
  let pageNo = 1;
  let y = 0;

  const ROW_H = 13;

  const drawColumnHeads = () => {
    let cx = M;
    cols.forEach((col, i) => {
      if (col.align === 'right') c.right(head[i], cx + col.width, y, { size: 6.4, font: fonts.bold, color: FAINT });
      else c.text(head[i], cx, y, { size: 6.4, font: fonts.bold, color: FAINT });
      cx += col.width;
    });
    y -= 5;
    c.line(M, y, PAGE.w - M, { color: INK, thickness: 0.7 });
    y -= 12;
  };

  /** One row, advancing the cursor exactly once. */
  const drawRow = (cells, { total = false, grand = false } = {}) => {
    if (total || grand) {
      c.rect(M, y - 4, CONTENT_W, ROW_H, { color: grand ? rgb(0.949, 0.933, 0.882) : BAND });
      c.line(M, y + ROW_H - 4, PAGE.w - M, { color: grand ? INK : RULE, thickness: grand ? 1 : 0.5 });
      c.line(M, y - 4, PAGE.w - M, { color: grand ? INK : RULE, thickness: grand ? 1 : 0.5 });
    }
    const font = (total || grand) ? fonts.bold : fonts.regular;
    let cx = M;
    cols.forEach((col, i) => {
      const val = cells[i];
      if (val !== '' && val !== null && val !== undefined) {
        if (col.align === 'right') c.right(val, cx + col.width, y, { size: 8.4, font });
        else c.text(c.fit(val, col.width - 6, { size: 8.4, font }), cx, y, { size: 8.4, font });
      }
      cx += col.width;
    });
    if (!total && !grand) c.line(M, y - 4, PAGE.w - M, { color: rgb(0.95, 0.95, 0.95) });
    y -= ROW_H;
  };

  const startPage = (continued) => {
    y = drawHeader(c, fonts, logo, {
      title: 'Daily Work Report — Month',
      meta: `${scopeLabel} · ${monthName(month)}${continued ? ' (continued)' : ''}`
    });
    if (!continued) {
      y = drawGlance(c, fonts, y, [
        { label: 'Visitors', value: int(grand.visitors), sub: `${byBranch.size} branch${byBranch.size === 1 ? '' : 'es'}` },
        { label: 'Deliveries', value: int(grand.deliveries), sub: `+${int(grand.pickups)} pick-ups` },
        { label: 'Slabs in', value: int(grand.containerSlabs), sub: 'containers' },
        { label: 'Slabs out', value: int(grand.transferSlabs), sub: 'transfers' },
        { label: 'Payments', value: money(grand.payments), sub: `${rows.length} day${rows.length === 1 ? '' : 's'}` }
      ]);
    }
    drawColumnHeads();
  };

  const nextPage = () => {
    drawFooter(c, fonts, '', `Generated ${stamp()} · Page ${pageNo}`);
    page = doc.addPage([PAGE.w, PAGE.h]);
    c = makeCanvas(page, fonts);
    pageNo += 1;
    startPage(true);
  };

  const room = (needed = ROW_H) => { if (y - needed < M + 34) nextPage(); };

  startPage(false);

  for (const [branch, list] of byBranch) {
    room(ROW_H * 3);

    c.rect(M, y - 4, CONTENT_W, ROW_H, { color: rgb(0.955, 0.955, 0.955) });
    c.text(branch.toUpperCase(), M + 4, y, { size: 7, font: fonts.bold, color: rgb(0.35, 0.35, 0.35) });
    y -= ROW_H + 2;

    for (const r of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      room();
      drawRow([
        `${shortDay(r.date)}${r.status === 'draft' ? '  (draft)' : ''}`,
        orDash(r.visitors), orDash(r.deliveries), orDash(r.pickups),
        orDash(r.containerSlabs), orDash(r.transferSlabs),
        r.payments ? money(r.payments) : '—'
      ]);
    }

    room();
    drawRow([branch, int(sum(list, 'visitors')), int(sum(list, 'deliveries')), int(sum(list, 'pickups')),
             int(sum(list, 'containerSlabs')), int(sum(list, 'transferSlabs')), money(sum(list, 'payments'))],
            { total: true });
    y -= 6;
  }

  if (byBranch.size > 1) {
    room(ROW_H + 6);
    drawRow(['ALL BRANCHES', int(grand.visitors), int(grand.deliveries), int(grand.pickups),
             int(grand.containerSlabs), int(grand.transferSlabs), money(grand.payments)], { grand: true });
  }

  drawFooter(c, fonts, '', `Generated ${stamp()} · Page ${pageNo}`);
  return doc.save();
}

export const dayPdfFileName = (report) =>
  `daily_report_${report.date}_${String(report.location).replace(/\s+/g, '_')}.pdf`;

export const monthPdfFileName = (month, scopeLabel) =>
  `daily_report_${month}_${String(scopeLabel).replace(/\s+/g, '_')}.pdf`;
