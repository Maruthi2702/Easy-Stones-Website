import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { parseInventoryTransitWorkbook, groupTransitShipments } from './inventoryTransitImport.ts';
import { runWorkbookParse } from './runWorkbookParse.ts';

const headers = ['Image', 'Product', 'SKU', 'PO#', 'PO Date', 'PO ETA Date', 'Supplier SO#', 'SIPL#', 'Slabs', 'Quantity', 'Units', 'Location', 'Supplier', 'Freight Forwarder', 'Ship Date', 'Port ETA Date', 'ETADate', 'Container#', 'Vessel', 'Customer/Loc/SO Ref.', 'Status'];
const line = (extra = {}) => ({ Image: 'No Image', Product: 'Carrara Prima Select 3CM', 'PO#': '15364',
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
  it('flags missing identity and invalid quantities instead of dropping them', () => {
    const result = parseInventoryTransitWorkbook(excel([line({ 'PO#': '', Quantity: 'bad' })]));
    expect(result.errors.join(' ')).toMatch(/missing poNumber/);
    expect(result.errors.join(' ')).toMatch(/invalid quantity/);
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
