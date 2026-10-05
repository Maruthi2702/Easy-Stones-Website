/**
 * Reading a StoneProfits packing list (or Sales Order, Pick Ticket, Invoice)
 * PDF back into the Delivery form.
 *
 * The office downloads "Packing List - #149942.pdf" (or the Sales Order,
 * Pick Ticket or Invoice for the same order) from StoneProfits and attaches
 * it to the delivery anyway, so the upload route reads the text out
 * of it (src/utils/pdfTextItems.js) and these rules turn that text into
 * the form's fields: customer, SO / Invoice#, No. of Slabs and the delivery
 * address.
 *
 * Everything here is pure — it takes text items with their page positions,
 * not a PDF — so it runs in the browser, on the server and in tests alike.
 *
 * Layout this is written against (StoneProfits' standard packing list):
 *
 *   Packinglist# 149942                      ← top right
 *   Bill To:  <company> / street / city…     ← left box
 *   Ship To:  Job Name: … / <name> / street / city, ST 12345 / country
 *   Sales Rep | PO # | Payment Terms | SO# | Est. Ship Date | Weight | Prepared By
 *   Krish     | 92426| 60 Days       |149942| 10/5/2026     | …
 *   <material> (10)                 736.70 SF
 *     13834-15  ES11375814  3/13834  SEA   136" X 78" = 73.67 SF   ← one per slab
 */

// Items closer together than this vertically are on the same printed line.
const SAME_LINE_TOLERANCE = 2.5;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Group pdf.js text items into printed lines, each a list of cells with the
 * x position they start at.
 *
 * Lines are built in the order the PDF draws them rather than sorted top to
 * bottom, because the Bill To and Ship To boxes sit side by side: sorting by
 * height would splice "Five Star Granite, Inc." from one box onto
 * "Job Name: …" from the other. StoneProfits draws each box top to bottom
 * before moving on, so a jump in height starts a new line.
 *
 * @param {{str: string, x: number, y: number}[]} items
 * @returns {{y: number, cells: {text: string, x: number}[], text: string}[]}
 */
export function itemsToLines(items = []) {
  const lines = [];
  let current = null;
  for (const item of items) {
    const text = clean(item?.str);
    if (!text) continue;
    const x = Number(item.x) || 0;
    const y = Number(item.y) || 0;
    if (!current || Math.abs(y - current.y) > SAME_LINE_TOLERANCE) {
      current = { y, cells: [] };
      lines.push(current);
    }
    current.cells.push({ text, x });
  }
  return lines.map(l => ({ ...l, text: l.cells.map(c => c.text).join(' ') }));
}

const CITY_STATE_ZIP = /,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/;
const COUNTRY = /^(united states|usa|us|canada)$/i;

// A labelled box ("Bill To:" / "Ship To:") is the run of lines after its label
// that start at the label's x, so the neighbouring box never bleeds in.
function boxLines(lines, label) {
  const start = lines.findIndex(l => l.cells[0]?.text.toLowerCase().startsWith(label));
  if (start === -1) return [];
  const x = lines[start].cells[0].x;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const first = lines[i].cells[0];
    if (Math.abs(first.x - x) > 4) break;
    if (/^(bill|ship) to:/i.test(first.text)) break;
    out.push(lines[i].text);
  }
  return out;
}

// street → city line, joined the way addresses are typed elsewhere in the app.
function addressFrom(lines) {
  const startIdx = lines.findIndex(l => /^\d/.test(l));
  if (startIdx === -1) return '';
  const parts = [];
  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i];
    if (COUNTRY.test(l) || /^[PE]:/.test(l)) break;
    parts.push(l);
    if (CITY_STATE_ZIP.test(l)) break;
  }
  return parts.join(', ');
}

// The values under the order row's headers: each header's value is the cells
// sitting nearest beneath it, so a blank PO # doesn't shift SO# into its
// place. A long value (a PO # like "JOB # Retail.Lieske…") wraps the row onto
// several lines, so everything down to the item table is read.
function headerValues(lines, headerIdx) {
  const out = {};
  const headers = lines[headerIdx].cells;
  for (let i = headerIdx + 1; i < lines.length && i <= headerIdx + 6; i++) {
    if (/^(description|serial num)\b/i.test(lines[i].cells[0]?.text || '')) break;
    for (const cell of lines[i].cells) {
      let best = null;
      for (const h of headers) {
        const d = Math.abs(h.x - cell.x);
        if (!best || d < best.d) best = { h, d };
      }
      if (best && best.d < 60) out[best.h.text] = clean(`${out[best.h.text] || ''} ${cell.text}`);
    }
  }
  return out;
}

// A slab's own row: '136" X 78" = 73.67 SF' (Sales Orders leave off the SF).
const DIMENSION_ROW = /\d+(\.\d+)?"\s*X\s*\d+(\.\d+)?"\s*=\s*[\d.]+/i;
const ITEM_COUNT_CELL = /^\((\d+)\)$/;

// The StoneProfits documents that carry an order's slabs, by the title printed
// top right ("Packinglist# 149942", "SaleOrder# 150229", "Pick Ticket# 150226",
// "Invoice# 150519"). All four share the Bill To / Ship To / order-row layout.
const DOCUMENT_TITLES = [
  { re: /^packing\s*list$/i, label: 'Packing List' },
  { re: /^sales?\s*order$/i, label: 'Sales Order' },
  { re: /^pick\s*ticket$/i, label: 'Pick Ticket' },
  { re: /^invoice$/i, label: 'Invoice' }
];

function documentTitle(lines) {
  for (const l of lines) {
    // A partial shipment is numbered "137611/2".
    const m = l.text.match(/^([A-Za-z ]+?)\s*#\s*:?\s*(\d{3,}(?:[/-]\d+)?)$/);
    if (!m) continue;
    const known = DOCUMENT_TITLES.find(t => t.re.test(m[1].trim()));
    if (known) return { documentType: known.label, documentNumber: m[2] };
  }
  return { documentType: '', documentNumber: '' };
}

// Slabs on the order. Each material line ("Taj Mahal … (10)  736.70 SF")
// is followed by one row per slab with its dimensions, which is what the
// driver actually loads, so those rows are counted. A material with no slab
// rows under it yet (not picked) counts its "(n)" instead — but only when it's
// sold by the square foot, so a sink or a bottle of sealer isn't a slab.
function countSlabs(lines) {
  let total = 0;
  let block = null;
  const close = () => {
    if (block) total += block.rows || (block.bySqFt ? block.n : 0);
    block = null;
  };
  for (const l of lines) {
    const countCell = l.cells.find(c => ITEM_COUNT_CELL.test(c.text));
    if (countCell && !DIMENSION_ROW.test(l.text)) {
      close();
      block = { n: Number(countCell.text.match(ITEM_COUNT_CELL)[1]), bySqFt: /\bSF\b/.test(l.text), rows: 0 };
    } else if (DIMENSION_ROW.test(l.text)) {
      if (block) block.rows += 1;
      else total += 1;
    }
  }
  close();
  return total || null;
}

/**
 * Pull the fields the Delivery form cares about out of a packing list's (or
 * Sales Order's, Pick Ticket's, Invoice's) lines.
 * Anything not found comes back as '' (or null for the slab count) rather
 * than a guess.
 */
export function parsePackingList(lines = []) {
  const joined = lines.map(l => l.text).join('\n');

  const { documentType, documentNumber } = documentTitle(lines);
  const dateMatch = joined.match(/^Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/m);

  const billTo = boxLines(lines, 'bill to:');
  const shipTo = boxLines(lines, 'ship to:');

  const jobLine = shipTo.find(l => /^job name:/i.test(l));
  const shipToBody = shipTo.filter(l => l !== jobLine);

  // The order row's columns differ by document (a Sales Order has no SO#
  // column, an Invoice has Due Date) but all start with Sales Rep.
  const headerIdx = lines.findIndex(l => /^sales rep$/i.test(l.cells[0]?.text || ''));
  const header = headerIdx === -1 ? {} : headerValues(lines, headerIdx);

  // A customer pickup prints "Pickup Order" where the Ship To would be, so
  // there's no delivery address to take.
  const pickupOrder = lines.some(l => /^pickup order:?$/i.test(l.text));

  return {
    documentType,
    documentNumber,
    date: dateMatch ? dateMatch[1] : '',
    billToName: billTo[0] || '',
    billToAddress: addressFrom(billTo.slice(1)),
    jobName: jobLine ? clean(jobLine.replace(/^job name:/i, '')) : '',
    shipToName: shipToBody[0] && !/^\d/.test(shipToBody[0]) ? shipToBody[0] : '',
    shipToAddress: addressFrom(shipToBody),
    pickupOrder,
    salesRep: header['Sales Rep'] || '',
    poNumber: header['PO #'] || '',
    // A Sales Order is filed under its own number, so it has no SO# column.
    soNumber: header['SO#'] || (documentType === 'Sales Order' ? documentNumber : ''),
    shipDate: header['Est. Ship Date'] || '',
    slabCount: countSlabs(lines)
  };
}

/** True when the text is one of the StoneProfits documents above at all. */
export function looksLikePackingList(parsed) {
  return Boolean(parsed && parsed.documentType && (parsed.billToName || parsed.slabCount));
}

// "Five Star Granite, Inc." and "five star granite inc" are the same account.
const COMPANY_SUFFIX = /\b(inc|incorporated|llc|l l c|ltd|limited|co|corp|corporation|company|the)\b/g;
export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The customer dropdown option this company name refers to, if exactly one does. */
export function matchCustomerOption(name, options = []) {
  const key = normalizeCompany(name);
  if (!key) return null;
  const hits = options.filter(o => normalizeCompany(o?.label) === key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Decide what a packing list fills in on the Delivery form.
 *
 * Only empty fields are filled — a value someone typed, or one the ticket was
 * saved with, is never overwritten by a PDF. Where the PDF disagrees with a
 * filled field it's reported in `kept`, so the person can fix it by hand.
 *
 * @param {object} current  { deliveryType, customerName, selectedCustomerId, soNumber, numberOfSlabs, address }
 * @param {object} parsed   from parsePackingList
 * @param {object[]} customerOptions  the form's customer dropdown options
 * @returns {{ updates: object, filled: string[], kept: {field: string, current: string, pdf: string}[] }}
 */
export function planPackingListAutofill(current = {}, parsed = {}, customerOptions = []) {
  const updates = {};
  const filled = [];
  const kept = [];
  const type = current.deliveryType || 'jobsite';
  const isTransfer = type === 'transfer';
  const isWillCall = type === 'will_call';

  const consider = (field, label, currentValue, pdfValue, isEmpty, apply) => {
    const pdf = clean(pdfValue);
    if (!pdf) return;
    if (isEmpty) {
      apply(pdf);
      filled.push(label);
    } else if (clean(currentValue).toLowerCase() !== pdf.toLowerCase()) {
      kept.push({ field: label, current: clean(currentValue), pdf });
    }
  };

  // The SO# printed on the document; a packing list or pick ticket carries
  // the same number as its sales order. A transfer's number field is its own
  // Transfer #, so it's left alone.
  if (!isTransfer) {
    const pl = parsed.soNumber || parsed.documentNumber;
    consider('soNumber', 'SO / Invoice#', current.soNumber, pl, !clean(current.soNumber),
      v => { updates.soNumber = v; });
  }

  if (parsed.slabCount) {
    const n = Number(current.numberOfSlabs);
    consider('numberOfSlabs', 'No. of Slabs', current.numberOfSlabs, String(parsed.slabCount),
      !Number.isFinite(n) || n <= 0, v => { updates.numberOfSlabs = v; });
  }

  // Customer: the account billed. Picked from the dropdown when the name
  // matches one customer exactly, so it links to their record (and brings
  // their sales rep, like choosing them by hand); otherwise typed in as a
  // custom name, the same as someone typing it.
  let matched = null;
  if (!isTransfer && parsed.billToName) {
    matched = matchCustomerOption(parsed.billToName, customerOptions);
    const shownName = matched ? matched.label : parsed.billToName;
    const empty = !clean(current.customerName) && !clean(current.selectedCustomerId);
    consider('customer', 'Customer', current.customerName, shownName, empty, () => {
      if (matched) {
        updates.customerName = matched.label;
        updates.selectedCustomerId = matched.value;
        if (matched.salesRepName) updates.salesRepName = matched.salesRepName;
      } else {
        updates.customerName = parsed.billToName;
        updates.selectedCustomerId = parsed.billToName;
      }
    });
  }

  // Address: where the slabs are going, which is Ship To — a jobsite can
  // differ from the account's own address. A will call or a pickup order has
  // no address.
  if (!isTransfer && !isWillCall && !parsed.pickupOrder) {
    const addr = parsed.shipToAddress || parsed.billToAddress;
    consider('address', 'Delivery Address', current.address, addr, !clean(current.address),
      v => { updates.address = v; });
  }

  return { updates, filled, kept };
}
