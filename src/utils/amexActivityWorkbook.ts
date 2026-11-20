/**
 * Reads Amex's activity export (.xlsx) for the Credit Card Receipts Amex check: the
 * "Transaction Details" sheet (else the first), as rows of cells. Synchronous and CPU-bound,
 * so the server runs it in a worker thread (runWorkbookParse.ts, kind 'amex-activity'); the
 * rules are in amexStatement.ts.
 */
import { read, utils } from 'xlsx';
import { readAmexActivity, type AmexRead } from './amexStatement.ts';

export function readAmexActivityWorkbook(buffer: Buffer): AmexRead {
  const workbook = read(buffer, { type: 'buffer' });
  const name = workbook.SheetNames.find(n => /transaction details/i.test(n)) ?? workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) return { lines: [], problems: ['The file has no readable sheet.'], period: null, skippedRows: 0 };
  // raw: amounts stay numbers; the dates are text in Amex's file ("10/29/2026").
  return readAmexActivity(utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' }));
}
