import type { Loose } from '../types/records.ts';
/**
 * Whatcom County's monthly "Permits Issued" report — the PDF the county posts
 * in its archive a few days after each month ends. The morning run checks
 * each new one against what the app pulled for that month, permit number by
 * permit number (sync.js `checkCountyReport`), so a gap in the pull shows up
 * on the Permits page instead of going unnoticed.
 *
 * The county's main site sits behind a firewall that turns some servers away;
 * the same archive is also served from the county's CivicPlus host, tried
 * second.
 *
 * Server-only.
 */
import { Buffer } from 'node:buffer';
import { extractPdfTextItems } from '../utils/pdfTextItems.ts';
import { reportMonthOf, reportPermitNumbers } from './permitRules.ts';
import { BROWSER_UA } from './sources/http.ts';

export const REPORT_ARCHIVES = Object.freeze([
  'https://www.whatcomcounty.us/Archive.aspx?AMID=56',
  'https://wa-whatcomcounty.civicplus.com/Archive.aspx?AMID=56'
]);

const TIMEOUT_MS = 60000;

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"');

/** Every single-month "Permits Issued" report linked from the archive page. */
export function parseArchive(html: unknown, pageUrl: unknown) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="(Archive\.aspx\?ADID=\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = decode(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const month = reportMonthOf(title);
    if (!month || seen.has(month)) continue;
    seen.add(month);
    out.push({ month, title, url: new URL(m[1], pageUrl).toString() });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}

export function createCountyReports({ fetchImpl = globalThis.fetch, archives = REPORT_ARCHIVES }: Loose = {}) {
  const get = (url: string) => fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });

  /** The reports, newest month first, from the first archive copy that answers. */
  async function list() {
    const problems = [];
    for (const url of archives) {
      try {
        const res = await get(url);
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const reports = parseArchive(await res.text(), url);
        if (!reports.length) throw new Error('no “Permits Issued” reports on the page');
        return reports;
      } catch (err) {
        problems.push(`${new URL(url).host}: ${(err as Error).message}`);
      }
    }
    throw new Error(`Couldn’t read the county’s report archive (${problems.join('; ')})`);
  }

  /** Every permit number in one report. */
  async function permitNumbers(reportUrl: unknown) {
    const res = await get(reportUrl);
    if (!res.ok) throw new Error(`The county’s report answered ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/pdf/i.test(type)) throw new Error(`The county’s report wasn’t a PDF (${type || 'no type'})`);
    const items = await extractPdfTextItems(Buffer.from(await res.arrayBuffer()), { maxPages: 200 });
    const numbers = reportPermitNumbers(items);
    if (!numbers.length) throw new Error('No permit numbers found in the county’s report — its layout may have changed');
    return numbers;
  }

  return { list, permitNumbers };
}
