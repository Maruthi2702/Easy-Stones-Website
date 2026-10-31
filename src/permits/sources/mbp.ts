import type { Loose } from '../../types/records.ts';
/**
 * Permits from MyBuildingPermit's public permit search
 * (permitsearch.mybuildingpermit.com) — no login, but no published API
 * either: these are the calls its own search page makes (checked 2026-10-14).
 *
 *   GET  /                                    the page: a session cookie and the form's token
 *   GET  /SearchPermits/GetPermitStatuses     an office's statuses
 *   POST /SearchPermits/GetSearchResults      a search: office, issued from–to, statuses
 *   GET  /PermitDetails/PeopleData/:num/:id   one permit's contractor (with WA license #) and applicant
 *   GET  /PermitDetails/:num/:OFFICE          one permit's page: parcel, project name
 *
 * A search must name at least one status, so it names every status the
 * office has — which is no filter at all. A search that would return too
 * many permits is refused outright ("Search returned too many results"), so
 * the reader asks a week at a time and halves any window that's refused, down
 * to a single day, then splits that day's statuses.
 *
 * The search's "to" date means midnight at the start of that day. Most
 * offices stamp every permit at midnight, so that's exact; Kirkland stamps
 * the time of issue, so a permit issued 4:30 PM on the last day isn't found
 * (checked 2026-10-14: its Oct 6 asked alone gave 18, Oct 6–7 gave 58 issued
 * Oct 6). For an office that stamps times (`stampsTime`) each search asks one
 * day further and keeps only the rows inside the window; a midnight office is
 * asked for exactly its days — asking further would double what a busy day
 * returns (Burien's Sept 22 + 23 was refused) — and a timed row from it stops
 * the run, since it means the office changed. Any row outside the days asked
 * stops the run too: a date filter the server quietly ignored would otherwise
 * look like a quiet week.
 *
 * Gentle on purpose: one request at a time per office, with a pause.
 *
 * Server-only. `fetchImpl`, `sleep` and `today` are injectable for tests.
 */
import { cleanText, htmlText, shiftDay, pacificNow } from '../common.ts';
import { MBP_SITE, mbpDay } from '../rules/mbp.ts';
import { BROWSER_UA, fetchJson } from './http.ts';

const WINDOW_DAYS = 7;
const TOO_MANY = /too many results/i;

/** 'MM/DD/YYYY' from 'YYYY-MM-DD', as the search's date boxes take it. */
export const mbpDate = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;

/** The parcel and project name from a permit's detail page. */
export function parseMbpDetail(html: unknown) {
  const field = (label: unknown) => {
    const m = String(html).match(new RegExp(`<th[^>]*>\\s*${label}:\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i'));
    return m ? htmlText(m[1]) : '';
  };
  return { parcel: field('Parcel'), projectName: field('Project Name') };
}

/**
 * The shared connection: one session (cookie + form token), each office's
 * statuses, and the calls. A failed call starts a new session and tries once
 * more — the token expires with the session.
 */
export function createMbpClient({ base = MBP_SITE, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 400 }: Loose = {}) {
  let session: { token: string; cookies: string } | null = null;
  const statuses = new Map();

  async function open() {
    const res = await fetchImpl(`${base}/`, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`MyBuildingPermit answered ${res.status}`);
    const html = await res.text();
    const token = html.match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
    if (!token) throw new Error('MyBuildingPermit’s search page has changed — no form token on it');
    const cookies = (res.headers.getSetCookie?.() || []).map((c: string) => c.split(';')[0]).join('; ');
    session = { token, cookies };
    return session;
  }

  const get = (path: unknown, { name = 'MyBuildingPermit', errorOf }: Loose = {}) => fetchJson(`${base}${path}`, {
    fetchImpl, sleep, pauseMs, name, errorOf, init: { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }
  });

  async function statusesOf(jurisId: unknown) {
    if (!statuses.has(jurisId)) {
      const list = await get(`/SearchPermits/GetPermitStatuses?jurisId=${jurisId}`, { errorOf: (d: unknown) => (!Array.isArray(d) ? 'no status list' : null) });
      const values = list.map((s: Loose) => s.Value).filter(Boolean);
      if (!values.length) throw new Error(`MyBuildingPermit lists no permit statuses for office ${jurisId}`);
      statuses.set(jurisId, values);
    }
    return statuses.get(jurisId);
  }

  /** One search. An array of rows, or null when the server says there are too many. */
  async function search(jurisId: unknown, from: string, to: string, statusList: string[]) {
    const attempt = async () => {
      const s = session || await open();
      const body = new URLSearchParams([
        ['__RequestVerificationToken', s.token], ['JurisId', String(jurisId)], ['SearchBy', 'ProjectInfo'],
        ['SelectedDateRanges', 'Issued'], ['FromDate', mbpDate(from)], ['ToDate', mbpDate(to)],
        ...statusList.map((x) => ['SelectedPermitStatuses', x])
      ]);
      await sleep(pauseMs);
      const data = await fetchJson(`${base}/SearchPermits/GetSearchResults`, {
        fetchImpl, sleep, pauseMs, name: 'MyBuildingPermit',
        errorOf: (d: Loose) => (Array.isArray(d) || TOO_MANY.test(d?.ErrorMessage || '') ? null : d?.ErrorMessage || 'error'),
        init: { method: 'POST', body, headers: { 'User-Agent': BROWSER_UA, Cookie: s.cookies, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } }
      });
      return Array.isArray(data) ? data : null;
    };
    try {
      return await attempt();
    } catch {
      session = null;
      return attempt();
    }
  }

  async function people(permitNumber: string | number, jurisId: unknown) {
    await sleep(pauseMs);
    return get(`/PermitDetails/PeopleData/${encodeURIComponent(permitNumber)}/${jurisId}`, { errorOf: (d: unknown) => (!Array.isArray(d) ? 'no people list' : null) });
  }

  async function detailPage(permitNumber: string | number, office: string) {
    await sleep(pauseMs);
    const res = await fetchImpl(`${base}/PermitDetails/${encodeURIComponent(permitNumber)}/${encodeURIComponent(office)}`, {
      headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`MyBuildingPermit’s page for ${permitNumber} answered ${res.status}`);
    return parseMbpDetail(await res.text());
  }

  return { search, statusesOf, people, detailPage };
}

/**
 * One office's reader. `places` (King County's parcels, kingParcels.js) adds
 * the site's postal city and ZIP to the county's permits.
 */
/** Whether an ASP.NET date is midnight on the Pacific clock. */
const atMidnight = (value: unknown) => {
  const m = String(value ?? '').match(/\/Date\((-?\d+)/);
  return !m || (Number(m[1]) % 60000 === 0 && pacificNow(new Date(Number(m[1]))).minutes === 0);
};

export function createMbpSource({ client, jurisId, office, label, places = null, stampsTime = false, today = () => pacificNow().day }: Loose) {
  /** Every row the office issued from `from` to `to`, refused windows split until they're answered. */
  async function readWindow(from: string, to: string, statusList: string[], out: Loose, counter: Loose) {
    counter.pages += 1;
    const asked = stampsTime ? shiftDay(to, 1) : to;
    const rows = await client.search(jurisId, from, asked, statusList);
    if (rows) {
      for (const row of rows) {
        const day = mbpDay(row.IssuedDate);
        if (!day || day < from || day > asked) {
          throw new Error(`MyBuildingPermit sent a ${label} permit issued ${day || 'on no date'} for ${from}–${to} — its date filter isn’t working, so the pull stopped`);
        }
        if (!stampsTime && !atMidnight(row.IssuedDate)) {
          throw new Error(`${label} now stamps permits with the time they're issued, so a day's last permits would be missed — mark it stampsTime in src/permits/rules/ (the pull stopped)`);
        }
        // A permit stamped midnight the day after belongs to the next window.
        if (day <= to) out.set(cleanText(row.PermitNumber), row);
      }
      return;
    }
    if (from < to) {
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
      const mid = shiftDay(from, Math.floor(days / 2));
      await readWindow(from, mid, statusList, out, counter);
      await readWindow(shiftDay(mid, 1), to, statusList, out, counter);
      return;
    }
    if (statusList.length > 1) {
      const half = Math.ceil(statusList.length / 2);
      await readWindow(from, to, statusList.slice(0, half), out, counter);
      await readWindow(from, to, statusList.slice(half), out, counter);
      return;
    }
    throw new Error(`MyBuildingPermit has too many ${label} permits on ${from} in status “${statusList[0]}” to list`);
  }

  /** Every permit the office issued on or after `since` (YYYY-MM-DD), all types, as search rows. */
  async function issuedSince(since: string) {
    const statusList = await client.statusesOf(jurisId);
    const end = today();
    const out = new Map();
    const counter = { pages: 0 };
    for (let from = since; from <= end; from = shiftDay(from, WINDOW_DAYS)) {
      const to = shiftDay(from, WINDOW_DAYS - 1) < end ? shiftDay(from, WINDOW_DAYS - 1) : end;
      await readWindow(from, to, statusList, out, counter);
    }
    return { rows: [...out.values()], pages: counter.pages, total: out.size };
  }

  /** One permit's people, parcel and project name (and, for the county, the parcel's city). */
  async function details(permitNumber: string | number) {
    const [people, page] = await Promise.all([client.people(permitNumber, jurisId), client.detailPage(permitNumber, office)]);
    let place = null;
    if (places && page.parcel) {
      try {
        place = (await places.lookup([page.parcel])).get(page.parcel) || null;
      } catch {
        place = null;   // no city this time; the county's monthly report fills it in
      }
    }
    return { people, parcel: page.parcel, projectName: page.projectName, place };
  }

  return { issuedSince, details };
}

