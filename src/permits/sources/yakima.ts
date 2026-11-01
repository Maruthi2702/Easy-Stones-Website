import type { Loose } from '../../types/records.ts';
/**
 * Yakima's permits, from the city's public "Issued Permits for New Buildings"
 * report on its SmartGov Community portal (rules/yakima.ts), run without a
 * browser by the same runner as Anacortes' (smartgovReport.ts).
 *
 * The range's end is midnight and leaves out its own day, so the end asked is
 * tomorrow. A row outside what was asked, a changed layout, an error from the
 * report server or a download that isn't a CSV stops the run rather than save
 * a short or wrong list.
 *
 * Server-only. `fetchImpl`, `sleep` and `now` are injectable for tests.
 */
import { pacificNow, shiftDay } from '../common.ts';
import { YAKIMA_HOME, YAKIMA_REPORT_ID, yakimaRows } from '../rules/yakima.ts';
import { parseCsv } from './shoreline.ts';
import { createExagoRunner } from './smartgovReport.ts';

export function createYakimaSource({ fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = () => new Date(), pollMs = 1000 }: Loose = {}) {
  const runner = createExagoRunner({ home: YAKIMA_HOME, reportId: YAKIMA_REPORT_ID, owner: 'Yakima’s', fetchImpl, sleep, pollMs });

  /** Every new-building permit issued on or after `since` (YYYY-MM-DD), one row each. */
  async function issuedSince(since: string) {
    const today = pacificNow(now()).day;
    const to = shiftDay(today, 1);
    const text = await runner.run(since, to);
    // The report starts with its title lines; the table begins at its header row.
    const head = text.search(/^"?Permit Number"?,/m);
    if (head < 0) {
      // No table at all is what an empty range looks like (the header is printed with the rows).
      if (!/Issued Permits for New Buildings/.test(text)) throw new Error('Yakima’s report has changed — it is not the new-buildings report');
      return { rows: [], pages: 1, total: 0 };
    }
    const rows = yakimaRows(parseCsv(text.slice(head)));
    for (const r of rows) {
      if (r.issuedOn < since || r.issuedOn >= to) throw new Error(`Yakima’s report has permit ${r.number} issued ${r.issuedOn}, outside ${since} to ${today} — stopped so nothing is missed`);
    }
    return { rows, pages: 1, total: rows.length };
  }

  return { issuedSince };
}
