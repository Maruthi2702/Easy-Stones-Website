import { describe, it, expect } from 'vitest';
import {
  allMonthsAllowed, exportFileName, exportScope, pdfAllowed, showMonths, startingChoice, thisMonthAllowed
} from './cardReceiptsExport';

const both = { canExport: true, canExportAll: true };
const monthOnly = { canExport: true, canExportAll: false };
const allOnly = { canExport: false, canExportAll: true };

describe('the Export pop-up rules', () => {
  it('opens on this month, Excel and the Card filter', () => {
    expect(startingChoice(both, 'encore')).toEqual({ bank: 'encore', months: 'month', format: 'xlsx' });
    expect(startingChoice(both, '')).toMatchObject({ bank: '' });
    expect(startingChoice(both, 'visa')).toMatchObject({ bank: '' });
  });

  it('opens on all months for a login that only has Export all', () => {
    expect(startingChoice(allOnly).months).toBe('all');
  });

  it('shows the Months field only where there is a choice', () => {
    expect(showMonths(both)).toBe(true);
    expect(showMonths(allOnly)).toBe(true);
    expect(showMonths(monthOnly)).toBe(false);
    expect(thisMonthAllowed(allOnly)).toBe(false);
    expect(thisMonthAllowed(monthOnly)).toBe(true);
  });

  it('keeps PDF and All months apart', () => {
    const month = startingChoice(both);
    expect(pdfAllowed(month, both)).toBe(true);
    expect(pdfAllowed({ ...month, months: 'all' }, both)).toBe(false);
    expect(allMonthsAllowed(month, both)).toBe(true);
    expect(allMonthsAllowed({ ...month, format: 'pdf' }, both)).toBe(false);
  });

  it('needs the right switch for each', () => {
    expect(allMonthsAllowed(startingChoice(monthOnly), monthOnly)).toBe(false);
    expect(pdfAllowed({ bank: '', months: 'all', format: 'xlsx' }, allOnly)).toBe(false);
  });

  it('names the file by month, bank and format', () => {
    expect(exportFileName({ bank: '', months: 'month', format: 'xlsx' }, '2026-11')).toBe('card-receipts-2026-11.xlsx');
    expect(exportFileName({ bank: 'amex', months: 'month', format: 'pdf' }, '2026-11')).toBe('card-receipts-2026-11-amex.pdf');
    expect(exportFileName({ bank: 'encore', months: 'all', format: 'xlsx' }, '2026-11')).toBe('card-receipts-all-encore.xlsx');
  });

  it('says what the PDF covers', () => {
    expect(exportScope({ bank: '', months: 'month', format: 'pdf' }, 'November 2026')).toBe('November 2026 · Amex and Encore');
    expect(exportScope({ bank: 'encore', months: 'month', format: 'pdf' }, 'November 2026')).toBe('November 2026 · Encore');
  });
});
