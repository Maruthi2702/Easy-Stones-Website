import type { Loose } from '../../types/records.ts';
/**
 * Runs a public report on a SmartGov Community portal without a browser
 * (Anacortes 2026-10-22, Yakima 2026-11-02). The reports are Exago pages that
 * ask for a Date Issued range; this does what the page's own scripts do:
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
 * The range's end is midnight and leaves out its own day, so callers ask to
 * tomorrow. A report that doesn't allow CSV, an error from the report server
 * or a download that isn't a CSV throws.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { cleanText } from '../common.ts';
import { BROWSER_UA } from './http.ts';

const TIMEOUT_MS = 60000;
export const REPORT_SERVER = 'https://reports-new.smartgovcommunity.com/exago/';
const SETTINGS = JSON.stringify({
  BrowserType: 'Chrome', Language: 'en-us,en-us-getting-started', SessionNum: '0', ShowErrorDetail: true, IsAdmin: false, DevicePixelRatio: 1, IsExceptionServerEvent: true
});
const MAX_POLLS = 120;

const arg = (value: unknown) => ({ className: '', value, isArray: false });
const typed = (className: unknown, value?: unknown, isArray = false) => ({ className, ...(value !== undefined && { value }), isArray });
/** The report server's way of naming a Date Issued range. */
export const dateFilter = (from: string, to: string, field = 'Permits.Date Issued') => `${field}|^|bt|^|${from} 00:00:00.000|~|${to} 00:00:00.000|^||^|true|^|false|^|0|^|0|^|0`;


/** `owner` is how errors name the city ("Anacortes’", "Yakima’s"); `home` is the portal's address. */
export function createExagoRunner({ home, reportId, owner, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pollMs = 1000 }: Loose) {
  async function session() {
    const jar = new Map();
    const get = async (url: string, init: Loose = {}) => {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetchImpl(url, { redirect: 'manual', ...init, headers: { 'User-Agent': BROWSER_UA, ...(cookie && { Cookie: cookie }), ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      for (const c of res.headers.getSetCookie?.() || []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
      return res;
    };
    return get;
  }

  async function run(from: string, to: string, field = 'Permits.Date Issued') {
    const get = await session();
    const reports = await get(`${home}/Public/ReportsView`);
    const page = await reports.text();
    const viewState = page.match(/__VIEWSTATE" value="([^"]+)/)?.[1];
    if (!reports.ok || !viewState) throw new Error(`${owner} reports page answered ${reports.status} without its form — it may have changed`);
    // The portal wants a throwaway token made the way its own script makes one.
    const letter = () => String.fromCharCode(97 + Math.floor(Math.random() * 26));
    const stamp = letter() + Date.now() + letter();
    const at = Math.floor(Math.random() * 10);
    const form = new FormData();
    form.set('__VIEWSTATE', viewState);
    form.set('__VIEWSTATEGENERATOR', page.match(/__VIEWSTATEGENERATOR" value="([^"]+)/)?.[1] || '');
    form.set('__submitFormValidator__', stamp.slice(0, at) + letter() + letter() + letter() + stamp.slice(at));
    let hop = await get(`${home}/Public/ReportsView/ViewReport?reportId=${reportId}&reportType=Exago`, { method: 'POST', body: form, headers: { Referer: `${home}/Public/ReportsView` } });
    // Two redirects into the report server; its page then carries the start-up settings.
    for (let n = 0; n < 3 && hop.status >= 300 && hop.status < 400; n++) {
      hop = await get(new URL(hop.headers.get('location'), REPORT_SERVER).href);
    }
    const html = await hop.text();
    const configAt = html.indexOf('ApiAction');
    const valueAt = html.lastIndexOf('value="', configAt);
    let config;
    try {
      config = JSON.parse(html.slice(valueAt + 7, html.indexOf('"', valueAt + 7)).replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    } catch { config = null; }
    if (!hop.ok || !config?.TempPath || !config.ApiReportId) throw new Error(`${owner} report server answered ${hop.status} without its start-up settings — it may have changed`);

    const call = async (method: string, args: unknown[]) => {
      const res = await get(`${REPORT_SERVER}wrajax/${method}.ashx?t=${encodeURIComponent(config.TempPath)}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify({ args: [...args, typed('Settings', SETTINGS)] })
      });
      let data;
      try { data = JSON.parse(await res.text()); } catch { throw new Error(`${owner} report server answered ${res.status} to ${method} with something other than JSON`); }
      if (!res.ok || data.isError) throw new Error(`${owner} report server refused ${method}: ${cleanText(data.messageText || data.value || res.status).slice(0, 200)}`);
      return data.value;
    };

    const loaded = await call('Client.BaseExecuteCtrl.LoadCallback', [
      arg(config.ApiReportId), arg('csv'), arg(true), arg(true), typed(''),
      typed('Client.ClientJsApiPromptingFilterValueList'), typed('Client.ClientJsApiExecuteReportFiltersList'), typed('Client.ClientJsApiExecuteReportParameterList')
    ]);
    const state = loaded?.Data?.ReportData;
    if (!state) throw new Error(`${owner} report server sent no report to run — it may have changed`);
    const started = await call('Callbacks.Execute.StartExecute', [
      arg(state), arg(dateFilter(from, to, field)), arg(null), typed('Client.ClientParameterValueList'), arg('csv'), arg(true),
      typed('Client.ClientReportAdjustments', 'null'), typed('Client.ClientJsApiExecuteReportFiltersList', 'null'),
      typed('Client.ClientJsApiPromptingFilterValueList'), typed('Client.ClientJsApiExecuteReportParameterList'), typed('Client.ClientReportLevelParameter', '[]', true)
    ]);
    const eid = started?.ExecutionId;
    if (!eid) throw new Error(`${owner} report server did not start the report`);
    let done = false;
    for (let n = 0; n < MAX_POLLS && !done; n++) {
      const status = await call('Callbacks.Execute.GetStatus', [arg(config.TempPath), arg(eid), arg(false)]);
      if (status?.msg) throw new Error(`${owner} report failed: ${cleanText(status.msg).slice(0, 200)}`);
      done = status?.phase >= 4 && status?.percent >= 100;
      if (!done) await sleep(pollMs);
    }
    if (!done) throw new Error(`${owner} report was still running after two minutes — stopped`);
    await call('Callbacks.Execute.TransmitExecution', [arg(eid)]);
    const exported = await get(`${REPORT_SERVER}ExecuteExport.aspx?eid=${encodeURIComponent(eid)}&bt=Chrome&l=${config.Language || 'en-us,en-us-getting-started'}&ii=1&eit=1`);
    const type = exported.headers.get('content-type') || '';
    if (!exported.ok || !/csv|text\/plain/i.test(type)) throw new Error(`${owner} report export answered ${exported.status} (${type || 'no type'}) — not a CSV`);
    return exported.text();
  }

  return { run };
}
