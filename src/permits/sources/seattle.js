/**
 * Seattle's permits, from the city's "Building Permits" dataset on its open
 * data portal (Socrata). Socrata answers real SoQL, so the filter is the
 * server's: building permits issued on or after `since`. Completeness is
 * checked like the ArcGIS layers — count first, read every page in row-id
 * order, and fail the run unless the rows received equal that count.
 *
 * `details` reads a lead's public page on the city's permit portal for the
 * contractor's license number. `recheck` is the month-so-far check's second,
 * separate query: the same days' building permits, numbers only, in
 * permit-number order.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay, dayOf, cleanText } from '../common.js';
import { SEATTLE_DATASET, SEATTLE_FIELDS, seattlePermitPage, seattleLicense } from '../rules/seattle.js';
import { BROWSER_UA, fetchJson } from './http.js';

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

export const seattleWhere = (since) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `issueddate >= '${since}' AND permittypemapped = 'Building'`;
};

export function createSeattleSource({ dataset = SEATTLE_DATASET, pageOf = seattlePermitPage, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 250 } = {}) {
  const query = (params) => fetchJson(`${dataset}?${new URLSearchParams(params)}`, {
    fetchImpl, sleep, pauseMs, name: 'Seattle',
    errorOf: (data) => (!Array.isArray(data) ? data?.message || data?.error || 'error' : null)
  });

  async function countWhere(where) {
    const [row] = await query({ $select: 'count(*) AS n', $where: where });
    const n = Number(row?.n);
    if (!Number.isInteger(n)) throw new Error('Seattle didn’t say how many permits there are');
    return n;
  }

  async function readAll(where, { select, order }) {
    const total = await countWhere(where);
    const rows = [];
    let pages = 0;
    for (let offset = 0; offset < total && pages < MAX_PAGES; offset += PAGE_SIZE) {
      await sleep(pauseMs);
      const page = await query({ $select: select, $where: where, $order: order, $limit: String(PAGE_SIZE), $offset: String(offset) });
      pages += 1;
      rows.push(...page);
      if (!page.length) break;
    }
    return { rows, pages, total };
  }

  /** Every building permit issued on or after `since`, as dataset rows. */
  async function issuedSince(since) {
    const { rows, pages, total } = await readAll(seattleWhere(since), { select: [':id', ...SEATTLE_FIELDS].join(','), order: ':id' });
    const ids = new Set(rows.map((r) => r[':id']));
    if (rows.length !== total || ids.size !== total) {
      throw new Error(`Seattle said ${total} permits but sent ${rows.length} (${ids.size} different) — stopped so nothing is missed`);
    }
    return { rows, pages, total };
  }

  /** The month so far, a second way: numbers and types only, in permit-number order. */
  async function recheck(from) {
    const { rows, total } = await readAll(seattleWhere(from), { select: 'permitnum,permitclass,permittypedesc,issueddate', order: 'permitnum' });
    if (rows.length !== total) throw new Error(`Seattle said ${total} permits but sent ${rows.length} on the second count`);
    return rows.map((r) => ({ number: cleanText(r.permitnum), type: r.permitclass, subtype: r.permittypedesc, issuedOn: dayOf(r.issueddate) }));
  }

  /** One permit's page: `{ license }` ('' when it names no contractor). */
  async function details(permitNumber) {
    await sleep(pauseMs);
    const res = await fetchImpl(pageOf(permitNumber), { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Seattle’s page for ${permitNumber} answered ${res.status}`);
    const html = await res.text();
    // A real record page names its own permit; anything else is an error or sign-in page.
    if (!html.includes(permitNumber)) throw new Error(`Seattle’s page for ${permitNumber} didn’t show the permit`);
    return { license: seattleLicense(html) };
  }

  return { issuedSince, recheck, details };
}
