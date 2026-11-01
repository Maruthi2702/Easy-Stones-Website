import type { Loose } from '../../types/records.ts';
/**
 * Anacortes' permits, from the city's public "Issued Permits with Valuation"
 * report on its SmartGov Community portal (rules/anacortes.js). The report is
 * an Exago page; this runs it the way the page's own scripts do, with no
 * browser (checked 2026-10-22):
 *
 *   1. open the portal's Reports page and post its form for the report — it
 *      answers with a redirect into the report server and a session cookie
 *   2. read the report server's start-up settings (its temp path) from the page
 *   3. wrajax/Client.BaseExecuteCtrl.LoadCallback → the report's own saved state
 *   4. wrajax/Callbacks.Execute.StartExecute with the Date Issued range
 *      ("Permits.Date Issued|^|bt|^|from|~|to|…") and the CSV export type
 *   5. wrajax/Callbacks.Execute.GetStatus until it is done, then
 *      TransmitExecution, then ExecuteExport.aspx?eid=… → the CSV
 *
 * The range's end is midnight and leaves out its own day, so the end asked is
 * tomorrow; a row outside what was asked, a changed layout, an error from the
 * report server or a download that isn't a CSV stops the run rather than save
 * a short or wrong list.
 *
 * Server-only. `fetchImpl`, `sleep` and `now` are injectable for tests.
 */
import { cleanText, pacificNow, shiftDay } from '../common.ts';
import { ANACORTES_HOME, ANACORTES_REPORT_ID, anacortesRows } from '../rules/anacortes.ts';
import { parseCsv } from './shoreline.ts';
import { createExagoRunner } from './smartgovReport.ts';

export { dateFilter } from './smartgovReport.ts';

export function createAnacortesSource({ fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = () => new Date(), pollMs = 1000 }: Loose = {}) {
  // The portal's report runner is shared with Yakima (smartgovReport.ts).
  const runner = createExagoRunner({ home: ANACORTES_HOME, reportId: ANACORTES_REPORT_ID, owner: 'Anacortes’', fetchImpl, sleep, pollMs });

  /** Every permit issued on or after `since` (YYYY-MM-DD), one row each. */
  async function issuedSince(since: string) {
    const today = pacificNow(now()).day;
    const to = shiftDay(today, 1);
    const text = await runner.run(since, to);
    // The report starts with its title lines; the table begins at its header row.
    const head = text.search(/^"?Issued Date"?,/m);
    if (head < 0) {
      // No table at all is what an empty range looks like (the header is printed with the rows).
      if (!/Issued Permits with Valuation/.test(text)) throw new Error('Anacortes’ report has changed — it is not the issued-permits report');
      return { rows: [], pages: 1, total: 0 };
    }
    const rows = anacortesRows(parseCsv(text.slice(head)));
    for (const r of rows) {
      if (r.issuedOn < since || r.issuedOn >= to) throw new Error(`Anacortes’ report has permit ${r.number} issued ${r.issuedOn}, outside ${since} to ${today} — stopped so nothing is missed`);
    }
    return { rows, pages: 1, total: rows.length };
  }

  return { issuedSince };
}
