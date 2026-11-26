import { describe, it, expect } from 'vitest';
import { cleanScan, fillFromScan, scanIsEmpty, scanLine, scanSchema, scanPrompt, type ReceiptScan } from './receiptScan.ts';

const categories = [
  { name: 'customer_lunch', label: 'Customer Lunch' },
  { name: 'fuel', label: 'Fuel' },
  { name: 'old_one', label: 'Old one', active: false }
];
const today = '2026-11-20';
const blankForm = { date: today, merchant: '', total: '', subtotal: '', fees: '', tax: '', tip: '', category: '' };
const read = (over: Partial<ReceiptScan> = {}): ReceiptScan => ({
  isReceipt: true, date: '2026-11-18', merchant: 'Chevron', totalCents: 6497, subtotalCents: null, feesCents: null, taxCents: null, tipCents: null, category: 'fuel', ...over
});

describe('scanSchema / scanPrompt', () => {
  it('offers only shown categories, plus blank', () => {
    const schema = scanSchema(categories);
    expect(schema.properties.category.enum).toEqual(['customer_lunch', 'fuel', '']);
    expect(schema.required).toContain('total');
    expect(schema.additionalProperties).toBe(false);
  });
  it('lists the shown categories and today in the prompt', () => {
    const p = scanPrompt(categories, today);
    expect(p).toContain('- fuel: Fuel');
    expect(p).not.toContain('old_one');
    expect(p).toContain('Today is 2026-11-20');
  });
});

describe('cleanScan', () => {
  it('turns a good answer into cents', () => {
    const s = cleanScan({ isReceipt: true, date: '2026-11-18', merchant: '  Jinya   Ramen ', total: '98.17', subtotal: '80.00', fees: '', tax: '8.17', tip: '10.00', category: 'customer_lunch' }, { categories, today });
    expect(s).toEqual({ isReceipt: true, date: '2026-11-18', merchant: 'Jinya Ramen', totalCents: 9817, subtotalCents: 8000, feesCents: null, taxCents: 817, tipCents: 1000, category: 'customer_lunch' });
  });
  it('blanks a date that is not real, in the future, or far back', () => {
    for (const date of ['2026-02-30', '11/18/2026', '2026-11-21', '2025-01-01', '']) {
      expect(cleanScan({ date }, { categories, today }).date).toBe('');
    }
    expect(cleanScan({ date: today }, { categories, today }).date).toBe(today);
  });
  it('blanks amounts that are not money, zero or negative', () => {
    const s = cleanScan({ total: 'about 40', subtotal: '0.00', tax: '-3.00', tip: '$1,250.50' }, { categories, today });
    expect([s.totalCents, s.subtotalCents, s.taxCents, s.tipCents]).toEqual([null, null, null, 125050]);
  });
  it('reads fees (delivery charge + service fee) and fills them into an empty field', () => {
    const s = cleanScan({ total: '75.66', subtotal: '61.75', fees: '9.17', tax: '4.74', tip: '' }, { categories, today });
    expect([s.subtotalCents, s.feesCents, s.taxCents, s.tipCents]).toEqual([6175, 917, 474, null]);
    const { values, filled } = fillFromScan(blankForm, read({ totalCents: 7566, subtotalCents: 6175, feesCents: 917, taxCents: 474 }), { startDate: today });
    expect(values).toMatchObject({ total: '75.66', subtotal: '61.75', fees: '9.17', tax: '4.74' });
    expect(filled).toContain('fees');
  });
  it('drops a category that is hidden or unknown', () => {
    expect(cleanScan({ category: 'old_one' }, { categories, today }).category).toBe('');
    expect(cleanScan({ category: 'travel' }, { categories, today }).category).toBe('');
  });
  it('survives garbage', () => {
    expect(scanIsEmpty(cleanScan(null, { categories, today }))).toBe(true);
    expect(cleanScan('nope', { categories, today }).isReceipt).toBe(true);
    expect(cleanScan({ isReceipt: false }, { categories, today }).isReceipt).toBe(false);
  });
});

describe('fillFromScan', () => {
  it('fills a new form, replacing the untouched starting date', () => {
    const { values, filled } = fillFromScan(blankForm, read(), { startDate: today });
    expect(values).toMatchObject({ date: '2026-11-18', merchant: 'Chevron', total: '64.97', category: 'fuel', tip: '' });
    expect(filled).toEqual(['date', 'merchant', 'total', 'category']);
  });
  it('never overwrites what the person typed', () => {
    const typed = { ...blankForm, date: '2026-11-15', merchant: 'Chevron Kent', total: '70.00', category: 'customer_lunch' };
    const { values, filled } = fillFromScan(typed, read({ tipCents: 500 }), { startDate: today });
    expect(values).toMatchObject({ date: '2026-11-15', merchant: 'Chevron Kent', total: '70.00', category: 'customer_lunch', tip: '5.00' });
    expect(filled).toEqual(['tip']);
  });
  it('keeps today when the receipt is from today', () => {
    const { filled } = fillFromScan(blankForm, read({ date: today }), { startDate: today });
    expect(filled).not.toContain('date');
  });
  it('fills nothing from an empty reading', () => {
    const empty = cleanScan({}, { categories, today });
    expect(fillFromScan(blankForm, empty, { startDate: today }).filled).toEqual([]);
  });
});

describe('scanLine', () => {
  it('names what was filled', () => {
    expect(scanLine([])).toBe('');
    expect(scanLine(['total'])).toBe('Filled in the total from the receipt. Check it.');
    expect(scanLine(['date', 'merchant', 'total'])).toBe('Filled in the date, merchant and total from the receipt. Check them.');
  });
});
