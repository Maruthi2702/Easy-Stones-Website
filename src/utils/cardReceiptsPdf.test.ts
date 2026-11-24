import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildCardReceiptsPdf, CARD_RECEIPTS_PDF_MAX_ROWS } from './cardReceiptsPdf';

const categories = [{ name: 'fuel', label: 'Fuel', order: 0, active: true, fields: { customer: false, attendees: false, purpose: false, recurring: false } }];
const exp = (i: number, o: Record<string, unknown> = {}) => ({
  date: '2026-11-03', location: 'Seattle', holderName: 'Maruthi Ponugupati', cardLabel: 'MARU92069', issuer: 'amex', merchant: `Shop ${i}`,
  cents: 1000 + i, category: 'fuel', status: 'approved', ...o
});
const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
const head = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5));

describe('the card receipts PDF', () => {
  it('builds a PDF for a few receipts', async () => {
    const bytes = await buildCardReceiptsPdf({ list: [exp(1), exp(2)], categories, scope: 'November 2026 · Amex' });
    expect(head(bytes)).toBe('%PDF-');
    expect(await pages(bytes)).toBe(1);
  });

  it('builds an empty month and survives letters its font lacks', async () => {
    expect(await pages(await buildCardReceiptsPdf({ list: [], categories }))).toBe(1);
    const odd = await buildCardReceiptsPdf({ list: [exp(1, { merchant: 'Café 😀 東京' })], categories });
    expect(head(odd)).toBe('%PDF-');
  });

  it('adds pages for a long month and leaves voided receipts out', async () => {
    const list = [...Array.from({ length: 120 }, (_, i) => exp(i)), exp(999, { voided: { at: 'x' } })];
    expect(await pages(await buildCardReceiptsPdf({ list, categories }))).toBeGreaterThan(2);
  });

  it('stops at the page cap', async () => {
    const list = Array.from({ length: CARD_RECEIPTS_PDF_MAX_ROWS + 5 }, (_, i) => exp(i));
    const bytes = await buildCardReceiptsPdf({ list, categories });
    expect(head(bytes)).toBe('%PDF-');
  }, 60000);
});
