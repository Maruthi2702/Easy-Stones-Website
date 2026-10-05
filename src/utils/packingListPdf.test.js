import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  itemsToLines, parsePackingList, looksLikePackingList, normalizeCompany,
  matchCustomerOption, planPackingListAutofill
} from './packingListPdf.js';
import { extractPdfTextItems } from './pdfTextItems.js';

// Laid out like StoneProfits' documents (positions taken from real ones,
// names and addresses made up). Drawn in the same order StoneProfits draws
// them: header, Bill To box, Ship To box, order row, items.
//
// A packing list, pick ticket and invoice share one order row with an SO#
// column; a Sales Order's row has no SO# and its slab rows leave off "SF".
function documentItems({
  title = 'Packinglist#', number = '149942', salesOrder = false,
  poNumber = '92426', wrapPo = false,
  shipLabel = 'Ship To:', jobName = 'Acme Granite, Inc.', shipTo = null,
  materials = [{ name: 'Taj Mahal PST Face M Matte 3CM', n: 3 }]
} = {}) {
  const t = (str, x, y) => ({ str, x, y });
  const items = [
    t(title, 491, 748), t(number, 554, 748),
    t('Date:', 507, 735), t('10/3/2026', 538, 735),
    t('printed on Monday, October 05, 2026 12:22 am', 468, 706),
    t('Easy Stones - Seattle', 75, 750), t('6012 S 196th St', 75, 738), t('Kent, WA 98032', 75, 727),
    t('Packing List', 257, 675),
    t('Bill To:', 27, 645),
    t('Acme Granite, Inc.', 27, 626), t('100 Main St', 27, 617), t('Everett, WA 98201', 27, 607),
    t('United States', 27, 598), t('P: (425) 555-0100', 27, 588), t('E:', 27, 578), t('OFFICE@ACME.TEST', 38, 578),
    t(shipLabel, 320, 645)
  ];
  const ship = shipTo || ['Acme Granite, Inc.', '100 Main St', 'Everett, WA 98201', 'United States'];
  let y = 626;
  if (jobName) { items.push(t(`Job Name: ${jobName}`, 320, y)); y -= 9; }
  for (const line of ship) { items.push(t(line, 320, y)); y -= 9; }

  if (salesOrder) {
    items.push(
      t('Sales Rep', 56, 538), t('PO #', 177, 538), t('Terms', 287, 538), t('Weight', 397, 538), t('Prepared By', 499, 538),
      t('Krish', 65, 520)
    );
    if (poNumber) items.push(t(poNumber, 173, 520));
    items.push(t('60 Days', 284, 520), t('0 LBS', 399, 520), t('Krish', 513, 520));
  } else {
    items.push(
      t('Sales Rep', 41, 538), t('PO #', 133, 538), t('Payment Terms', 195, 538), t('SO#', 298, 538),
      t('Est. Ship Date', 361, 538), t('Weight', 457, 538), t('Prepared By', 528, 538),
      t('Krish', 51, 520)
    );
    // A long PO # wraps the rest of the row down a couple of lines.
    let rowY = 520;
    if (wrapPo) { items.push(t('JOB #', 131, 512), t('Retail.Lieske…', 104, 504)); rowY = 496; } else if (poNumber) items.push(t(poNumber, 131, 520));
    items.push(t('60 Days', 209, rowY), t('149942', 293, rowY), t('10/5/2026', 370, rowY), t('0.00 LBS', 454, rowY), t('Krish', 543, rowY));
  }

  items.push(
    t('Description', 27, 480), t('Serial Num', 40, 465), t('Barcode', 92, 465),
    t('Quantity', 413, 480), t('Unit Price', 488, 480)
  );
  let my = 453;
  materials.forEach((m, mi) => {
    const unit = m.unit || 'SF';
    items.push(t(m.name, 27, my), t(`(${m.n})`, 165, my), t(unit === 'SF' ? `${(73.67 * m.n).toFixed(2)} SF` : `${m.n} EA`, 408, my));
    my -= 12;
    const rows = m.rows ?? (unit === 'SF' ? m.n : 0);
    for (let i = 0; i < rows; i++) {
      items.push(t(`1383${mi}-${15 + i}`, 38, my), t(`ES1137581${i}`, 92, my), t('3/13834', 146, my), t('SEA', 315, my),
        t(salesOrder ? '136" X 78" = 73.67' : '136" X 78" = 73.67 SF', 370, my));
      my -= 9;
    }
  });
  return items;
}

const parse = (opts) => parsePackingList(itemsToLines(documentItems(opts)));

describe('itemsToLines', () => {
  it('keeps the side-by-side Bill To and Ship To boxes apart', () => {
    const lines = itemsToLines(documentItems()).map(l => l.text);
    expect(lines).toContain('Acme Granite, Inc.');
    expect(lines).toContain('Job Name: Acme Granite, Inc.');
    expect(lines.some(l => l.includes('Inc. Job Name'))).toBe(false);
  });

  it('puts cells drawn at the same height on one line', () => {
    const lines = itemsToLines(documentItems());
    const header = lines.find(l => l.text.startsWith('Sales Rep'));
    expect(header.cells.map(c => c.text)).toEqual(['Sales Rep', 'PO #', 'Payment Terms', 'SO#', 'Est. Ship Date', 'Weight', 'Prepared By']);
  });

  it('skips blank items', () => {
    expect(itemsToLines([{ str: ' ', x: 0, y: 0 }, { str: '', x: 0, y: 0 }])).toEqual([]);
  });
});

describe('parsePackingList', () => {
  it('reads a packing list', () => {
    expect(parse()).toEqual({
      documentType: 'Packing List',
      documentNumber: '149942',
      date: '10/3/2026',
      billToName: 'Acme Granite, Inc.',
      billToAddress: '100 Main St, Everett, WA 98201',
      jobName: 'Acme Granite, Inc.',
      shipToName: 'Acme Granite, Inc.',
      shipToAddress: '100 Main St, Everett, WA 98201',
      pickupOrder: false,
      salesRep: 'Krish',
      poNumber: '92426',
      soNumber: '149942',
      shipDate: '10/5/2026',
      slabCount: 3
    });
  });

  it('reads a Pick Ticket and an Invoice the same way', () => {
    const pick = parse({ title: 'Pick Ticket#', number: '149942' });
    expect(pick.documentType).toBe('Pick Ticket');
    expect(pick.soNumber).toBe('149942');
    expect(looksLikePackingList(pick)).toBe(true);
    expect(parse({ title: 'Invoice#', number: '150519' }).documentType).toBe('Invoice');
  });

  it('takes a Sales Order\'s own number as the SO#, with no SO# column and no SF on its slab rows', () => {
    const so = parse({ title: 'SaleOrder#', number: '150229', salesOrder: true, materials: [{ name: 'Steel Grey Dual P/LF 3CM', n: 7 }] });
    expect(so.documentType).toBe('Sales Order');
    expect(so.soNumber).toBe('150229');
    expect(so.poNumber).toBe('92426');
    expect(so.salesRep).toBe('Krish');
    expect(so.slabCount).toBe(7);
  });

  it('reads a partial shipment\'s number, and takes the SO# from its column', () => {
    const p = parse({ number: '137611/2' });
    expect(p.documentNumber).toBe('137611/2');
    expect(p.soNumber).toBe('149942');
  });

  it('reads an order row that a long PO # wrapped onto several lines', () => {
    const p = parse({ title: 'Pick Ticket#', wrapPo: true });
    expect(p.soNumber).toBe('149942');
    expect(p.poNumber).toBe('JOB # Retail.Lieske…');
    expect(p.shipDate).toBe('10/5/2026');
  });

  it('lines a blank PO # up by column, so SO# stays in place', () => {
    const p = parse({ poNumber: '' });
    expect(p.poNumber).toBe('');
    expect(p.soNumber).toBe('149942');
    expect(p.salesRep).toBe('Krish');
  });

  it('counts one slab per slab row, across materials', () => {
    expect(parse({ materials: [{ name: 'Taj Mahal 3CM', n: 10 }, { name: 'Calacatta 2CM', n: 2 }] }).slabCount).toBe(12);
  });

  it('counts "(n)" for slabs not picked yet, but not items sold each', () => {
    const p = parse({ materials: [
      { name: 'Taj Mahal 3CM', n: 2 },
      { name: 'Calacatta 2CM', n: 4, rows: 0 },
      { name: 'Undermount Sink', n: 3, unit: 'EA' }
    ] });
    expect(p.slabCount).toBe(6);
  });

  it('takes a jobsite Ship To that differs from the account address', () => {
    const p = parse({ jobName: 'Smith Kitchen', shipTo: ['Jane Smith', '22 Lake Dr', 'Bothell, WA 98011', 'United States'] });
    expect(p.billToName).toBe('Acme Granite, Inc.');
    expect(p.jobName).toBe('Smith Kitchen');
    expect(p.shipToName).toBe('Jane Smith');
    expect(p.shipToAddress).toBe('22 Lake Dr, Bothell, WA 98011');
  });

  it('works with no Job Name line', () => {
    expect(parse({ jobName: '' }).shipToAddress).toBe('100 Main St, Everett, WA 98201');
  });

  it('marks a pickup order, which has no address', () => {
    const p = parse({ shipLabel: 'Pickup Order:', jobName: '', shipTo: ['Acme Granite, Inc.'] });
    expect(p.pickupOrder).toBe(true);
    expect(p.shipToAddress).toBe('');
  });

  it('returns blanks for a PDF that is not one of these documents', () => {
    const p = parsePackingList(itemsToLines([{ str: 'Quarterly newsletter', x: 20, y: 700 }]));
    expect(p.documentType).toBe('');
    expect(p.slabCount).toBeNull();
    expect(looksLikePackingList(p)).toBe(false);
    expect(looksLikePackingList(parse())).toBe(true);
  });

  it('leaves an intercompany transfer alone', () => {
    expect(looksLikePackingList(parse({ title: 'Transfer#', number: '18817' }))).toBe(false);
  });
});

describe('customer matching', () => {
  it('ignores case, punctuation and Inc/LLC', () => {
    expect(normalizeCompany('Five Star Granite, Inc.')).toBe('five star granite');
    expect(normalizeCompany('FIVE STAR GRANITE INC')).toBe('five star granite');
    expect(normalizeCompany('Stone & Tile LLC')).toBe('stone and tile');
  });

  it('matches exactly one dropdown option, or none', () => {
    const opts = [{ value: 'a', label: 'ACME GRANITE INC' }, { value: 'b', label: 'Acme Granite Supply' }];
    expect(matchCustomerOption('Acme Granite, Inc.', opts)?.value).toBe('a');
    expect(matchCustomerOption('Unknown Co', opts)).toBeNull();
    expect(matchCustomerOption('Acme', [{ value: 'x', label: 'Acme' }, { value: 'y', label: 'ACME Inc' }])).toBeNull();
  });
});

describe('planPackingListAutofill', () => {
  const parsed = parse();
  const options = [{ value: 'c1', label: 'ACME GRANITE INC', salesRepName: 'Dana' }];

  it('fills an empty jobsite form, linking the matching customer', () => {
    const { updates, filled, kept } = planPackingListAutofill({ deliveryType: 'jobsite', numberOfSlabs: '0' }, parsed, options);
    expect(updates).toEqual({
      soNumber: '149942',
      numberOfSlabs: '3',
      customerName: 'ACME GRANITE INC',
      selectedCustomerId: 'c1',
      salesRepName: 'Dana',
      address: '100 Main St, Everett, WA 98201'
    });
    expect(filled).toEqual(['SO / Invoice#', 'No. of Slabs', 'Customer', 'Delivery Address']);
    expect(kept).toEqual([]);
  });

  it('fills the SO# from a Sales Order', () => {
    const so = parse({ title: 'SaleOrder#', number: '150229', salesOrder: true });
    expect(planPackingListAutofill({ numberOfSlabs: '0' }, so, []).updates.soNumber).toBe('150229');
  });

  it('types the name in when no customer matches', () => {
    const { updates } = planPackingListAutofill({ numberOfSlabs: '0' }, parsed, []);
    expect(updates.customerName).toBe('Acme Granite, Inc.');
    expect(updates.selectedCustomerId).toBe('Acme Granite, Inc.');
    expect(updates.salesRepName).toBeUndefined();
  });

  it('never overwrites a filled field, and reports where the PDF disagrees', () => {
    const { updates, filled, kept } = planPackingListAutofill({
      soNumber: '777', numberOfSlabs: '3', customerName: 'Other Co', selectedCustomerId: 'z', address: ''
    }, parsed, options);
    expect(updates).toEqual({ address: '100 Main St, Everett, WA 98201' });
    expect(filled).toEqual(['Delivery Address']);
    expect(kept).toEqual([
      { field: 'SO / Invoice#', current: '777', pdf: '149942' },
      { field: 'Customer', current: 'Other Co', pdf: 'ACME GRANITE INC' }
    ]);
  });

  it('gives a will call no address', () => {
    const { updates } = planPackingListAutofill({ deliveryType: 'will_call', numberOfSlabs: '0' }, parsed, []);
    expect(updates.address).toBeUndefined();
    expect(updates.soNumber).toBe('149942');
  });

  it('gives a pickup order no address, not even the Bill To one', () => {
    const pickup = parse({ shipLabel: 'Pickup Order:', jobName: '', shipTo: ['Acme Granite, Inc.'] });
    expect(planPackingListAutofill({ numberOfSlabs: '0' }, pickup, []).updates.address).toBeUndefined();
  });

  it('fills only the slab count on a transfer', () => {
    const { updates } = planPackingListAutofill({ deliveryType: 'transfer', numberOfSlabs: '0' }, parsed, options);
    expect(updates).toEqual({ numberOfSlabs: '3' });
  });
});

describe('reading a real PDF', () => {
  it('extracts and parses text drawn into a PDF', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const it of documentItems({ materials: [{ name: 'Taj Mahal 3CM', n: 5 }] })) {
      page.drawText(it.str.replace(/[^\x20-\x7E]/g, ''), { x: it.x, y: it.y, size: 8, font });
    }
    const bytes = await doc.save();
    const parsedPdf = parsePackingList(itemsToLines(await extractPdfTextItems(bytes)));
    expect(parsedPdf.documentNumber).toBe('149942');
    expect(parsedPdf.billToName).toBe('Acme Granite, Inc.');
    expect(parsedPdf.shipToAddress).toBe('100 Main St, Everett, WA 98201');
    expect(parsedPdf.slabCount).toBe(5);
  });
});
