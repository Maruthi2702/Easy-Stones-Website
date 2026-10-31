import type { Loose } from '../types/records.ts';
import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { parseInventoryTransitWorkbook, groupTransitShipments } from './inventoryTransitImport.ts';
import { runWorkbookParse } from './runWorkbookParse.ts';

const headers = ['Image', 'Product', 'SKU', 'PO#', 'PO Date', 'PO ETA Date', 'Supplier SO#', 'SIPL#', 'Slabs', 'Quantity', 'Units', 'Location', 'Supplier', 'Freight Forwarder', 'Ship Date', 'Port ETA Date', 'ETADate', 'Container#', 'Vessel', 'Customer/Loc/SO Ref.', 'Status'];
const line = (extra = {}): Loose => ({ Image: 'No Image', Product: 'Carrara Prima Select 3CM', 'PO#': '15364',
  'PO Date': '27-Aug-26', 'Supplier SO#': '5153', 'SIPL#': '15364', Slabs: '31 Slabs',
  Quantity: '2,237.89', Units: 'SF', Location: 'Richmond', Supplier: 'MODA Surfaces Corp',
  'Ship Date': '10/26/26', ETADate: '11/24/26', 'Container#': 'TEMU1379996', Status: 'INTRANSIT', ...extra });
const cells = (row: Record<string, string>) => headers.map(h => row[h] || '');
const tsv = (rows: Record<string, string>[]) => Buffer.from(["document.write('');", headers.join('\t'), ...rows.map(r => cells(r).join('\t'))].join('\r\n'));
const excel = (rows: Record<string, string>[]) => {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.aoa_to_sheet([["document.write('');"], headers, ...rows.map(cells)]), 'SPS');
  return write(wb, { type: 'buffer', bookType: 'xlsx' });
};

describe('SPS in-transit import', () => {
  it('reads PO/container fields and skips standalone status annotations', () => {
    const result = parseInventoryTransitWorkbook(tsv([line(), { Status: 'Initiated On 10/26/2026' }, { Status: 'ETA Nov 24, 2026' }]));
    expect(result.missingRequired).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', sku: '',
      product: 'Carrara Prima Select 3CM', slabs: 31, quantity: 2237.89, location: 'Richmond',
      supplierSoNumber: '5153', siplNumber: '15364', poEtaDate: null,
      poDate: new Date('2026-08-27T00:00:00Z'), etaDate: new Date('2026-11-24T00:00:00Z') });
  });
  it('reads a real Excel workbook through the upload worker', async () => {
    const result = await runWorkbookParse('inventory-transit', excel([line()]));
    expect(result.rows[0].poNumber).toBe('15364');
    expect(result.rows[0].etaDate).toEqual(new Date('2026-11-24T00:00:00Z'));
  });
  it('reads SPS HTML disguised as xls without running scripts', () => {
    const html = `<script>document.write('');</script><table><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr><tr>${cells(line()).map(c => `<td>${c}</td>`).join('')}</tr></table>`;
    expect(parseInventoryTransitWorkbook(Buffer.from(html)).rows[0].poNumber).toBe('15364');
  });
  it('selects the complete mixed-cell header instead of a partial all-th heading', () => {
    const partial = `<tr>${headers.slice(0, 8).map(h => `<th>${h}</th>`).join('')}</tr>`;
    const full = `<tr>${headers.map((h, i) => i < 8 ? `<th>${h}</th>` : `<td>${h}</td>`).join('')}</tr>`;
    const values = `<tr>${cells(line()).map(c => `<td>${c}</td>`).join('')}</tr>`;
    const result = parseInventoryTransitWorkbook(Buffer.from(`<table>${partial}${full}${values}</table>`));
    expect(result.missingRequired).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', slabs: 31, quantity: 2237.89, location: 'Richmond' });
  });
  it('handles merged report titles and multi-row headings', () => {
    const first = '<tr><th colspan="3">SPS In Transit</th></tr><tr><th rowspan="2">Product</th><th rowspan="2">PO&#35;</th><th colspan="5">Shipment</th></tr>';
    const second = '<tr><td>Container&#x23;</td><td>Location</td><td>Slabs</td><td>Quantity</td><td>Status</td></tr>';
    const values = '<tr><td>Carrara 3CM</td><td>15364</td><td>TEMU1379996</td><td>Richmond</td><td>31 Slabs</td><td>2,237.89</td><td>INTRANSIT</td></tr>';
    const result = parseInventoryTransitWorkbook(Buffer.from(`<table>${first}${second}${values}</table>`));
    expect(result.missingRequired).toEqual([]);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', slabs: 31, quantity: 2237.89 });
  });
  it('finds the full report on a later sheet and accepts equivalent headings', () => {
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet([['Product', 'PO#'], ['Summary', '15364']]), 'Summary');
    const aliases: Record<string, string> = { 'Container#': 'Container No.', Location: 'Destination Location', Slabs: 'No. of Slabs', Quantity: 'Qty', Status: 'Shipment Status' };
    utils.book_append_sheet(wb, utils.aoa_to_sheet([headers.map(h => aliases[h] || h), cells(line())]), 'In Transit');
    const result = parseInventoryTransitWorkbook(write(wb, { type: 'buffer', bookType: 'xlsx' }));
    expect(result.missingRequired).toEqual([]);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', slabs: 31, quantity: 2237.89 });
  });
  it.each([',', ';', '\t'])('reads the SPS CSV preamble, 22 columns and quoted quantities with delimiter %j', delimiter => {
    const csvHeaders = [...headers, 'Supp./Pur. Note'];
    const encode = (row: Record<string, string>) => csvHeaders.map(header => `"${String(row[header] || '').replace(/"/g, '""')}"`).join(delimiter);
    const note = 'Supplier says "on water", shipment confirmed\nKeep both product lines';
    const csv = [encode({ Image: "document.write('');" }), csvHeaders.map(h => `"${h}"`).join(delimiter),
      encode(line({ 'Supp./Pur. Note': note })), encode({ Image: 'Initiated On 10/26/2026' }),
      encode(line({ Product: 'Calacatta Savoy Select 3CM', Slabs: '21 Slabs', Quantity: '1,515.99' })),
      encode({ Image: 'ETA Nov 24, 2026' })].join('\r\n');
    const result = parseInventoryTransitWorkbook(Buffer.from(csv));
    expect(result.missingRequired).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', slabs: 31, quantity: 2237.89, supplierPurchaseNote: note });
    expect(groupTransitShipments(result.rows)).toHaveLength(1);
  });
  it('reads Excel UTF-16 CSV exports', () => {
    const csv = `document.write('');,,,,\r\n${headers.join(',')}\r\n${cells(line()).map(c => `"${c}"`).join(',')}`;
    const result = parseInventoryTransitWorkbook(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, 'utf16le')]));
    expect(result.missingRequired).toEqual([]);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', quantity: 2237.89 });
  });
  it('reads product rows whose image and status cells contain nested SPS tables', () => {
    const headings = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const values = cells(line()).map((value, index) => index === 0
      ? '<td><table><tr><td>No Image</td></tr><tr><td>Initiated On 10/26/2026</td></tr></table></td>'
      : index === 20 ? `<td><table><tr><td>${value}</td></tr><tr><td>ETA Nov 24, 2026</td></tr></table></td>`
        : `<td>${value}</td>`).join('');
    const html = `<table><tr><td><table>${headings}<tr>${values}</tr></table></td></tr></table>`;
    const result = parseInventoryTransitWorkbook(Buffer.from(html));
    expect(result.missingRequired).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', slabs: 31, quantity: 2237.89 });
  });
  it('keeps separate lots of the same product in a container', () => {
    const result = parseInventoryTransitWorkbook(tsv([line(), line({ Slabs: '21 Slabs', Quantity: '1515.99' })]));
    const shipments = groupTransitShipments(result.rows);
    expect(shipments).toHaveLength(1);
    expect(shipments[0].lines.map(row => row.slabs)).toEqual([31, 21]);
  });
  it('separates containers and branches within a PO', () => {
    const result = parseInventoryTransitWorkbook(excel([line(), line({ 'Container#': 'OTHER' }), line({ Location: 'Seattle' })]));
    expect(groupTransitShipments(result.rows)).toHaveLength(3);
  });
  it('flags invalid quantities without dropping unknown PO references', () => {
    const result = parseInventoryTransitWorkbook(excel([line({ 'PO#': '', Quantity: 'bad' })]));
    expect(result.rows[0].poNumber).toBe('');
    expect(result.warnings.join(' ')).toMatch(/no PO#/);
    expect(result.errors.join(' ')).toMatch(/invalid quantity/);
  });
  it('reads the actual SPS status annotations and blank legacy fields', () => {
    const rawHeaders = [...headers, 'Supp./Pur. Note', ''];
    const data = [line(), line({ Product: 'Legacy slab', 'PO#': '', 'Container#': '', Slabs: '' }),
      line({ Product: 'Display rack', Units: 'EA', Slabs: '', Quantity: '20' })];
    const html = `<html><body><table><tr><td><table><tr><td><table><tr>${rawHeaders.map(h => `<th>${h}</th>`).join('')}</tr>${data.map(row => `<tr>${headers.map(h => h === 'Status'
      ? '<td><span>INTRANSIT</span><br>Initiated On 10/26/2026</td>'
      : `<td>${(row as Record<string, string>)[h] || ''}</td>`).join('')}<td></td></tr>`).join('')}</table></td></tr></table></td></tr></table></body></html>`;
    const result = parseInventoryTransitWorkbook(Buffer.from(html));
    expect(result.missingRequired).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ poNumber: '15364', containerNumber: 'TEMU1379996', quantity: 2237.89, status: 'INTRANSIT' });
    expect(result.rows[1]).toMatchObject({ poNumber: '', containerNumber: '', slabs: null, quantity: 2237.89 });
    expect(result.rows[2]).toMatchObject({ slabs: null, quantity: 20, units: 'EA' });
    expect(result.warnings).toHaveLength(3);
  });
  it('reports statuses that cannot be imported instead of silently returning no rows', () => {
    const result = parseInventoryTransitWorkbook(excel([line({ Status: 'RECEIVED' }), line({ Status: 'CANCELLED' })]));
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual({ productRows: 2, skippedStatusCounts: { RECEIVED: 1, CANCELLED: 1 } });
  });
  it('rejects a stock report with no transit columns', () => {
    const result = parseInventoryTransitWorkbook(Buffer.from('Product\tQuantity\nCarrara\t12'));
    expect(result.missingRequired).toContain('poNumber');
    expect(result.rows).toEqual([]);
  });
  it('keeps overdue shipments in transit and excludes other statuses', () => {
    const result = parseInventoryTransitWorkbook(excel([line({ ETADate: '10/13/26' }), line({ Status: 'RECEIVED' })]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('INTRANSIT');
  });
});
