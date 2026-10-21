/**
 * Shoreline's permits, from the city's eTRAKiT permit search (no account
 * needed), the way a person would: open the search page, search "ISSUED DATE
 * equals <day>", then press its "Export to Excel" button, which answers a CSV
 * of the results. (ASP.NET WebForms: each step posts the page's hidden fields
 * back.)
 *
 * The export holds one page of results — 100 rows — so the reader asks one
 * day at a time (Shoreline issues ~10 a day) and stops the run if a day ever
 * fills the page, rather than save a day short.
 *
 * The site keeps the last results in the session: after a search that finds
 * nothing, "Export" hands back the *previous* search's rows (found
 * 2026-10-14, a Saturday answering Friday's permits). So each day starts a
 * fresh session, a search whose page shows no result rows counts as an empty
 * day and isn't exported, and every exported row must carry the day asked.
 *
 * Server-only. `fetchImpl`, `sleep` and `today` are injectable for tests.
 */
import { shiftDay, pacificNow } from '../common.js';
import { SHORELINE_SEARCH } from '../rules/shoreline.js';
import { BROWSER_UA } from './http.js';

const EXPORT_PAGE = 100;
const TRIES = 3;

/** Every hidden input on a WebForms page, decoded. */
export function hiddenFields(html) {
  const out = {};
  for (const m of String(html).matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const value = m[0].match(/value="([^"]*)"/)?.[1] ?? '';
    out[name] = value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, '\'');
  }
  return out;
}

/** CSV text → rows keyed by the header line (quoted fields, doubled quotes, a leading BOM). */
export function parseCsv(text) {
  const lines = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); lines.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  const [head, ...rest] = lines.filter((l) => l.some((c) => c.trim()));
  if (!head) return [];
  return rest.map((l) => Object.fromEntries(head.map((h, i) => [h.trim(), (l[i] ?? '').trim()])));
}

/** The export columns Shoreline's eTRAKiT uses; other cities' exports name theirs differently. */
export const SHORELINE_COLUMNS = Object.freeze({ number: 'PERMIT NUMBER', issued: 'ISSUED DATE', type: 'Permit Type' });

/**
 * `label` and `columns` let another city's eTRAKiT (Marysville) use the same
 * walk: the search is the same ASP.NET page, only the export's column names
 * and the words in the errors differ.
 */
export function createShorelineSource({ url = SHORELINE_SEARCH, label = 'Shoreline', columns = SHORELINE_COLUMNS, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 400, today = () => pacificNow().day } = {}) {
  let cookies = '';
  const keep = (res) => {
    const set = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
    if (set.length) {
      const jar = new Map(cookies.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
      for (const c of set) jar.set(c.split('=')[0], c);
      cookies = [...jar.values()].join('; ');
    }
  };
  const call = async (init) => {
    const res = await fetchImpl(url, { ...init, headers: { 'User-Agent': BROWSER_UA, ...(cookies && { Cookie: cookies }), ...(init?.headers || {}) }, signal: AbortSignal.timeout(60000) });
    keep(res);
    return res;
  };

  /** One day's permits: page → search → export. */
  async function day(d) {
    const us = `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
    cookies = '';
    const page = await call({});
    if (!page.ok) throw new Error(`${label}’s permit search answered ${page.status}`);
    let html = await page.text();
    const post = (extra) => call({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...hiddenFields(html),
        'ctl00$cplMain$ddSearchBy': 'Permit_Main.ISSUED',
        'ctl00$cplMain$ddSearchOper': 'EQUALS',
        'ctl00$cplMain$txtSearchString': us,
        ...extra
      })
    });
    const searched = await post({ 'ctl00$cplMain$btnSearch': 'Search' });
    if (!searched.ok) throw new Error(`${label}’s permit search answered ${searched.status}`);
    html = await searched.text();
    if (!/btnExportToExcel/.test(html)) throw new Error(`${label}’s permit search has changed — no Export button after searching`);
    // The results grid's rows on the page (its first page of them); none → nothing issued that day.
    const shown = (html.match(/<tr[^>]*class="rg(?:Alt)?Row/g) || []).length;
    if (!shown) return [];
    const exported = await post({ 'ctl00$cplMain$btnExportToExcel': 'Export' });
    const type = exported.headers.get('content-type') || '';
    if (!exported.ok || !/csv|text\/plain/i.test(type)) throw new Error(`${label}’s export answered ${exported.status} (${type || 'no type'}) — not a CSV`);
    const rows = parseCsv(await exported.text());
    if (rows.length && !(columns.number in rows[0] && columns.issued in rows[0] && columns.type in rows[0])) {
      throw new Error(`${label}’s export has changed — no ${columns.number} / ${columns.issued} / ${columns.type} columns`);
    }
    if (rows.length < shown) throw new Error(`${label}’s export for ${us} had ${rows.length} permits but its page showed ${shown} — stopped so nothing is missed`);
    if (rows.length >= EXPORT_PAGE) throw new Error(`${label} issued ${rows.length}+ permits on ${d} — more than its export holds, so the pull stopped`);
    for (const r of rows) {
      if (r[columns.issued] !== us) throw new Error(`${label}’s search for ${us} answered a permit issued ${r[columns.issued] || 'on no date'} — stopped so nothing is missed`);
    }
    return rows;
  }

  async function dayWithRetry(d) {
    let last;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        return await day(d);
      } catch (err) {
        last = err;
        if (/has changed|more than its export|stopped so nothing/.test(err.message)) throw err;
        cookies = '';
        if (attempt < TRIES) await sleep(pauseMs * 4 * attempt);
      }
    }
    throw last;
  }

  /** Every permit issued on or after `since`, all types, as export rows. */
  async function issuedSince(since) {
    const end = today();
    const rows = [];
    let pages = 0;
    for (let d = since; d <= end; d = shiftDay(d, 1)) {
      await sleep(pauseMs);
      rows.push(...await dayWithRetry(d));
      pages += 1;
    }
    return { rows, pages, total: rows.length };
  }

  return { issuedSince };
}
