/**
 * Reads Encore's transactions export (.xlsx) for the Credit Card Receipts Encore check: the first
 * sheet, as rows of cells. Synchronous and CPU-bound, so the server runs it in a worker thread
 * (runWorkbookParse.ts, kind 'encore-activity'); the rules are in encoreStatement.ts.
 */
import { read, utils } from 'xlsx';
import { readEncoreActivity } from './encoreStatement.ts';
import type { AmexRead } from './amexStatement.ts';

export function readEncoreActivityWorkbook(buffer: Buffer): AmexRead {
  const workbook = read(buffer, { type: 'buffer' });
  const name = workbook.SheetNames.find(n => workbook.Sheets[n] && utils.sheet_to_json(workbook.Sheets[n]!, { header: 1 }).length > 1) ?? workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) return { lines: [], problems: ['The file has no readable sheet.'], period: null, skippedRows: 0 };
  // raw: dates arrive as Excel day numbers and amounts as numbers; references stay text (they are 23 digits).
  return readEncoreActivity(utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' }));
}
