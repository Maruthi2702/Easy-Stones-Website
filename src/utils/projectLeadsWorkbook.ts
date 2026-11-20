/**
 * Reads a ConstructConnect export workbook for Project Leads: the "Design Team" sheet (else the
 * first), plus the "Custom" sheet when there is one. Synchronous and CPU-bound, so the server runs
 * it in a worker thread (runWorkbookParse.ts, kind 'project-leads'); the rules are in projectLeads.ts.
 */
import { read, utils } from 'xlsx';
import { readConstructConnect, type ReadLeads } from './projectLeads.ts';

export function readProjectLeadsWorkbook(buffer: Buffer): ReadLeads {
  const workbook = read(buffer, { type: 'buffer' });
  const names = workbook.SheetNames;
  const designName = names.find(n => /design/i.test(n)) ?? names[0];
  const design = designName ? workbook.Sheets[designName] : undefined;
  if (!design) return { projects: [], problems: ['The file has no readable sheet.'], skippedRows: 0 };
  const customName = names.find(n => /^custom$/i.test(n) && n !== designName);
  const rows = utils.sheet_to_json<Record<string, unknown>>(design, { defval: '' });
  const custom = customName ? utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[customName], { defval: '' }) : [];
  return readConstructConnect(rows, custom);
}
