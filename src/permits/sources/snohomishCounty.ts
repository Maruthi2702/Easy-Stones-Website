import type { Loose } from '../../types/records.ts';
/**
 * Snohomish County's permits, from the county's monthly spreadsheets of
 * issued permits (rules/snohomishCounty.js): open each report's archive page,
 * pick the files that can hold permits issued since the start of the window,
 * download them (no account) and read the first sheet.
 *
 * The county's files hold exactly their own month, so a row issued in another
 * month, a layout without the columns the rules need, or a download that
 * isn't a spreadsheet stops the run rather than save a short or wrong list.
 * The latest month is posted some days into the next, so the newest
 * permits are up to a month behind; a month still missing a month after it
 * ended stops the run too. Months are read whole, so a window that has moved
 * past a month's first days while it waited to be posted still reads them.
 *
 * Server-only. `fetchImpl` and `now` are injectable for tests.
 */
import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';
import { cleanText, dayOf, monthlyReadFrom, monthName, pacificNow } from '../common.ts';
import {
  SNOHOMISH_ARCHIVE, SNOHOMISH_REPORTS, SNOHOMISH_COLUMNS, parseSnohomishArchive, snohomishFilesSince, rowBelongsToFile
} from '../rules/snohomishCounty.ts';
import { BROWSER_UA } from './http.ts';

const TIMEOUT_MS = 60000;
const SHEET_TYPE = /spreadsheetml|ms-excel|octet-stream/i;

/** A sheet's rows as objects keyed by the header text, trimmed (the county's " Valuation " has spaces). */
export function reportRows(grid: unknown[][]) {
  const [head, ...rest] = grid;
  if (!head) return [];
  const names = head.map((h: unknown) => cleanText(h));
  const missing = SNOHOMISH_COLUMNS.filter((c: string) => !names.includes(c));
  if (missing.length) throw new Error(`Snohomish County’s report has changed — no ${missing.join(' / ')} column`);
  return rest
    .filter((r) => r.some((c: unknown) => c !== null && c !== ''))
    .map((r) => Object.fromEntries(names.map((n: string, i: number) => [n, r[i] ?? null])));
}

export function createSnohomishCountySource({ fetchImpl = globalThis.fetch, now = () => new Date() }: Loose = {}) {
  const get = (url: string) => fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });

  /** One report's files, newest first. */
  async function list(report: Loose) {
    const res = await get(`${SNOHOMISH_ARCHIVE}?AMID=${report.amid}`);
    if (!res.ok) throw new Error(`Snohomish County’s ${report.label} page answered ${res.status}`);
    const files = parseSnohomishArchive(await res.text());
    if (!files.length) throw new Error(`No files on Snohomish County’s ${report.label} page — it may have moved`);
    return files;
  }

  /** One file's rows, each marked with the report it came from. */
  async function read(report: Loose, file: Loose) {
    const res = await get(`${SNOHOMISH_ARCHIVE}?ADID=${file.id}`);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !SHEET_TYPE.test(type)) throw new Error(`Snohomish County’s “${file.title}” answered ${res.status} (${type || 'no type'}) — not a spreadsheet`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error(`Snohomish County’s “${file.title}” has no sheet in it`);
    const rows = reportRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }));
    for (const r of rows) {
      const day = dayOf(r.Issue_Date);
      if (!rowBelongsToFile(file, day)) {
        throw new Error(`Snohomish County’s “${file.title}” has permit ${r.Project_File_Number} issued ${r.Issue_Date || 'on no date'} — stopped so nothing is missed`);
      }
    }
    return rows.map((r): Loose => ({ ...r, _report: report.id }));
  }

  /**
   * Every permit in the reports issued in since's month or later, as report
   * rows — whole months, and the newest posted month while since's isn't up
   * yet (monthlyReadFrom), so the first days of a month posted late are read.
   */
  async function issuedSince(since: string) {
    const rows = [];
    let pages = 0;
    const seen = new Set();
    for (const report of SNOHOMISH_REPORTS) {
      const files = await list(report);
      const { from, newest, overdue } = monthlyReadFrom(files.map((f: Loose) => f.month), since, pacificNow(now()).day);
      if (overdue) throw new Error(`Snohomish County hasn’t posted its ${monthName(overdue)} ${report.label} report yet${newest ? ` — the newest is ${monthName(newest)}` : ''}`);
      for (const file of snohomishFilesSince(files, from)) {
        for (const r of await read(report, file)) {
          const n = cleanText(r.Project_File_Number);
          if (seen.has(n) || (dayOf(r.Issue_Date) || '') < from) continue;
          seen.add(n);
          rows.push(r);
        }
        pages += 1;
      }
    }
    return { rows, pages, total: rows.length };
  }

  return { issuedSince };
}
