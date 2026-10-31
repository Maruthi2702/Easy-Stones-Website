import type { Loose } from '../../types/records.ts';
/**
 * Permits from a city's ArcGIS permit layer (Bellingham, Bellevue). ArcGIS
 * answers real SQL, so the filter is the server's: building permits issued on
 * or after `since`. Completeness is checked the ArcGIS way — ask for the
 * count, read every page in id order, and fail the run unless the rows
 * received equal that count.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { fetchJson } from './http.ts';

const PAGE_SIZE = 1000;   // both layers allow 2000
const MAX_PAGES = 50;

export const sqlString = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * `where(since)` builds the layer's filter; `idField` is its object id
 * ('OBJECTID', or 'ObjectId' on ArcGIS Online); `name` goes in errors.
 */
export function createArcgisReader({ layer, name, fields, where, idField = 'OBJECTID', numberField = null, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 250 }: Loose) {
  const query = (params: unknown) => fetchJson(`${layer}/query?${new URLSearchParams({ f: 'json', ...params })}`, {
    fetchImpl, sleep, pauseMs, name, errorOf: (data: Loose) => data?.error?.message || (data?.error ? 'error' : null)
  });

  /** Every matching permit issued on or after `since`, as feature attributes. */
  async function issuedSince(since: string) {
    const filter = where(since);
    const counted = await query({ where: filter, returnCountOnly: 'true' });
    const total = counted.count;
    if (!Number.isInteger(total)) throw new Error(`${name} didn’t say how many permits there are`);
    const rows = [];
    let pages = 0;
    for (let offset = 0; offset < total && pages < MAX_PAGES; offset += PAGE_SIZE) {
      await sleep(pauseMs);
      const data = await query({
        where: filter,
        outFields: fields.join(','),
        returnGeometry: 'false',
        orderByFields: idField,
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE)
      });
      pages += 1;
      if (!Array.isArray(data.features)) throw new Error(`${name} answered without a feature list`);
      rows.push(...data.features.map((f: Loose) => f.attributes || {}));
      if (!data.features.length) break;
    }
    const ids = new Set(rows.map((r) => r[idField]));
    if (rows.length !== total || ids.size !== total) {
      throw new Error(`${name} said ${total} permits but sent ${rows.length} (${ids.size} different) — stopped so nothing is missed`);
    }
    return { rows, pages, total };
  }

  // A saved permit can disappear from a date-filtered query when the source
  // moves or clears its issue date. Look it up by number before calling that
  // disappearance a missing permit; a missing/ambiguous answer proves nothing.
  async function findByNumber(number: unknown) {
    const data = await query({
      where: `${numberField} = ${sqlString(number)}`,
      outFields: fields.join(','), returnGeometry: 'false', resultRecordCount: '2'
    });
    if (!Array.isArray(data.features)) throw new Error(`${name} answered without a feature list`);
    if (data.features.length > 1 || data.exceededTransferLimit) throw new Error(`${name} returned more than one permit for ${number}`);
    return data.features[0]?.attributes || null;
  }

  return { issuedSince, ...(numberField && { findByNumber }) };
}
