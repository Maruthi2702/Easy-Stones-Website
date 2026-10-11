/**
 * City of Bellingham's permits, from the permit layer the city publishes on
 * its ArcGIS server (the data behind its Development Dashboard). The city's
 * eTRAKiT permit search needs a contractor login, so this is the public copy.
 *
 * ArcGIS answers real SQL, so here the filter is the server's: building
 * permit types issued on or after `since`. Completeness is checked the
 * ArcGIS way — ask for the count, read every page in OBJECTID order, and fail
 * the run unless the rows received equal that count.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { BELLINGHAM_LAYER, BELLINGHAM_FIELDS, BELLINGHAM_PERMIT_TYPES, isDay } from '../permitRules.js';
import { fetchJson } from './http.js';

const PAGE_SIZE = 1000;   // the layer allows 2000
const MAX_PAGES = 50;

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const bellinghamWhere = (since) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `ISSUED >= DATE ${sqlString(since)} AND PermitType IN (${BELLINGHAM_PERMIT_TYPES.map(sqlString).join(', ')})`;
};

export function createBellinghamSource({ fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 250, layer = BELLINGHAM_LAYER } = {}) {
  const query = (params) => fetchJson(`${layer}/query?${new URLSearchParams({ f: 'json', ...params })}`, {
    fetchImpl, sleep, pauseMs, name: 'Bellingham', errorOf: (data) => data?.error?.message || (data?.error ? 'error' : null)
  });

  /** Every building permit issued on or after `since`, as feature attributes. */
  async function issuedSince(since) {
    const where = bellinghamWhere(since);
    const counted = await query({ where, returnCountOnly: 'true' });
    const total = counted.count;
    if (!Number.isInteger(total)) throw new Error('Bellingham didn’t say how many permits there are');
    const rows = [];
    let pages = 0;
    for (let offset = 0; offset < total && pages < MAX_PAGES; offset += PAGE_SIZE) {
      await sleep(pauseMs);
      const data = await query({
        where,
        outFields: BELLINGHAM_FIELDS.join(','),
        returnGeometry: 'false',
        orderByFields: 'OBJECTID',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE)
      });
      pages += 1;
      if (!Array.isArray(data.features)) throw new Error('Bellingham answered without a feature list');
      rows.push(...data.features.map((f) => f.attributes || {}));
      if (!data.features.length) break;
    }
    const ids = new Set(rows.map((r) => r.OBJECTID));
    if (rows.length !== total || ids.size !== total) {
      throw new Error(`Bellingham said ${total} permits but sent ${rows.length} (${ids.size} different) — stopped so nothing is missed`);
    }
    return { rows, pages, total };
  }

  return { issuedSince };
}
