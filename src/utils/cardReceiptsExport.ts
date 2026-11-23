import { BANK_FILTERS } from './cardReceipts.ts';

/**
 * What the Credit Card Receipts "Export…" pop-up offers and names (2026-11-23;
 * claude.ai artifact "Card Receipts Export Pop-up"). One pop-up with three
 * choices — Card, Months, Format — instead of a menu item for every mix.
 *
 * - **This month** needs the Export switch, **All months** needs Export all.
 * - A PDF is one month only (a company month is already ~1,000 lines; every
 *   month would run to hundreds of pages), so PDF and All months exclude each
 *   other: the one left out is greyed in its list.
 */

export type ExportFormat = 'xlsx' | 'pdf';
export type ExportMonths = 'month' | 'all';
export type ExportChoice = { bank: string; months: ExportMonths; format: ExportFormat };
export type ExportPermissions = { canExport: boolean; canExportAll: boolean };

/** Where the pop-up opens: this month if the login may, else all months; Excel; the Card filter's bank. */
export const startingChoice = (perms: ExportPermissions, bank = ''): ExportChoice => ({
  bank: BANK_FILTERS.some((b) => b.key === bank) ? bank : '',
  months: perms.canExport ? 'month' : 'all',
  format: 'xlsx'
});

/** A PDF is this month's only, and only for a login that may export a month. */
export const pdfAllowed = (choice: ExportChoice, perms: ExportPermissions) => perms.canExport && choice.months === 'month';

/** All months needs its own switch and is Excel's alone. */
export const allMonthsAllowed = (choice: ExportChoice, perms: ExportPermissions) => perms.canExportAll && choice.format === 'xlsx';

/** The month needs the Export switch. */
export const thisMonthAllowed = (perms: ExportPermissions) => perms.canExport;

/** The Months field is only worth showing a login that can pick between the two. */
export const showMonths = (perms: ExportPermissions) => perms.canExportAll;

/** card-receipts-2026-11-amex.pdf · card-receipts-all.xlsx */
export const exportFileName = (choice: ExportChoice, month: string) =>
  `card-receipts-${choice.months === 'all' ? 'all' : month}${choice.bank ? `-${choice.bank}` : ''}.${choice.format}`;

/** The line under the PDF's title: "November 2026 · Amex". */
export const exportScope = (choice: ExportChoice, monthText: string) =>
  [monthText, BANK_FILTERS.find((b) => b.key === choice.bank)?.label || 'Amex and Encore'].join(' · ');
