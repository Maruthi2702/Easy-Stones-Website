import type { Loose } from '../types/records.ts';
/**
 * King County's monthly "Issued Permits" report — the spreadsheet the
 * Department of Local Services posts around the 1st of each month for the
 * month before (every permit it issued outside city limits, with the job
 * value and the site's city). The morning run checks each new one against
 * what the app pulled for that month, permit number by permit number
 * (sync.js `checkKingReport`), and fills in what the pull can't read.
 *
 * Server-only.
 */
import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';
import { BROWSER_UA } from './sources/http.ts';
import { KING_REPORTS_PAGE, parseKingReports, kingReportRows } from './rules/kingCounty.ts';

const TIMEOUT_MS = 60000;

export function createKingReports({ fetchImpl = globalThis.fetch, page = KING_REPORTS_PAGE }: Loose = {}) {
  const get = (url: string) => fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });

  /** The reports linked from the county's page, newest month first. */
  async function list() {
    const res = await get(page);
    if (!res.ok) throw new Error(`King County’s reports page answered ${res.status}`);
    const reports = parseKingReports(await res.text(), page);
    if (!reports.length) throw new Error('No “issued permits” spreadsheets on King County’s reports page — it may have moved');
    return reports;
  }

  /** One report's rows (kingReportRows). */
  async function rows(url: string) {
    const res = await get(url);
    if (!res.ok) throw new Error(`King County’s report answered ${res.status}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('King County’s report has no sheet in it');
    const out = kingReportRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }));
    if (!out.length) throw new Error('No permits in King County’s report — its layout may have changed');
    return out;
  }

  return { list, rows };
}
