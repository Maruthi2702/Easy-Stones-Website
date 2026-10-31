import type { Loose } from '../../types/records.ts';
/**
 * Monroe's permits, from the city's monthly "Issued Permits Report"
 * spreadsheets (rules/monroe.js): open the city's reports page, pick the
 * months that can hold permits issued since the start of the window,
 * download them (no account) and read the first sheet.
 *
 * Each file holds one month, named on its second line; a permit issued in
 * another month, a layout without the columns the rules need, or a download
 * that isn't a spreadsheet stops the run rather than save a short or wrong
 * list. The page lists only the latest few months, and the newest month is
 * posted some days after it ends.
 *
 * Server-only. `fetchImpl` is injectable for tests.
 */
import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';
import { cleanText, dayOf } from '../common.ts';
import { MONROE_REPORTS_PAGE, parseMonroeReports, monroeReportRows } from '../rules/monroe.ts';
import { BROWSER_UA } from './http.ts';

const TIMEOUT_MS = 60000;
const SHEET_TYPE = /spreadsheetml|ms-excel|octet-stream/i;

export function createMonroeSource({ fetchImpl = globalThis.fetch, page = MONROE_REPORTS_PAGE }: Loose = {}) {
  const get = (url: string) => fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });

  async function list() {
    const res = await get(page);
    if (!res.ok) throw new Error(`Monroe’s reports page answered ${res.status}`);
    const reports = parseMonroeReports(await res.text());
    if (!reports.length) throw new Error('No “Issued Permits Report” files on Monroe’s reports page — it may have moved');
    return reports;
  }

  async function read(file: Loose) {
    const res = await get(file.url);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !SHEET_TYPE.test(type)) throw new Error(`Monroe’s “${file.title}” answered ${res.status} (${type || 'no type'}) — not a spreadsheet`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error(`Monroe’s “${file.title}” has no sheet in it`);
    const { rows } = monroeReportRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }));
    for (const r of rows) {
      const day = dayOf(r['Issue Date']);
      if (!day || !day.startsWith(file.month)) {
        throw new Error(`Monroe’s “${file.title}” has permit ${r['Permit No']} issued ${r['Issue Date'] || 'on no date'} — stopped so nothing is missed`);
      }
    }
    return rows;
  }

  /** Every permit in the reports issued on or after `since`, as one row per permit. */
  async function issuedSince(since: string) {
    const rows = [];
    let pages = 0;
    for (const file of (await list()).filter((f) => f.month >= since.slice(0, 7))) {
      for (const r of await read(file)) {
        if ((dayOf(r['Issue Date']) || '') >= since) rows.push(r);
      }
      pages += 1;
    }
    return { rows, pages, total: rows.length };
  }

  return { issuedSince };
}
