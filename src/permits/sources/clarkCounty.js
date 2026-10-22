/**
 * Clark County's permits, from the county's "Permits - Building" layer. The
 * layer has no address, so each lead's address, city and ZIP are looked up by
 * parcel serial number in the county's address layer. Residential, new-home
 * and commercial permits issued on or after `since` (and not after tomorrow:
 * the layer has a few typo dates years ahead), read and counted by the shared
 * ArcGIS reader (arcgis.js): the run fails unless the rows received equal the
 * count asked. If the address lookup fails the run fails too.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { isDay } from '../common.js';
import { CLARK_LAYER, CLARK_ADDRESS_LAYER, CLARK_FIELDS, CLARK_CASE_TYPES, clarkAddress } from '../rules/clarkCounty.js';
import clark from '../rules/clarkCounty.js';
import { createArcgisReader, sqlString } from './arcgis.js';
import { fetchJson } from './http.js';

const SN_BATCH = 25;
const ADDRESS_FIELDS = 'SN,HsNbr,HsSub,StDir,StName,Stype,Building,Unit,Zip,USPS_CITY,Jurisdiction';

const dayAfter = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

export const clarkWhere = (since, today = new Date().toISOString().slice(0, 10)) => {
  if (!isDay(since)) throw new Error(`Not a date: ${since}`);
  return `issued >= DATE ${sqlString(since)} AND issued < DATE ${sqlString(dayAfter(dayAfter(today)))} AND case_type IN (${CLARK_CASE_TYPES.map(sqlString).join(', ')})`;
};

export function createClarkCountySource({ layer = CLARK_LAYER, addressLayer = CLARK_ADDRESS_LAYER, today, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 250 } = {}) {
  const permits = createArcgisReader({
    layer, name: 'Clark County', fields: CLARK_FIELDS, where: (since) => clarkWhere(since, today), fetchImpl, sleep, pauseMs
  });

  /** Address points for these serial numbers, grouped by number. */
  async function addressesFor(serials) {
    const bySn = new Map();
    for (let i = 0; i < serials.length; i += SN_BATCH) {
      const batch = serials.slice(i, i + SN_BATCH);
      for (let offset = 0; ; offset += 1000) {
        await sleep(pauseMs);
        const params = new URLSearchParams({
          f: 'json', where: `SN IN (${batch.join(', ')})`, outFields: ADDRESS_FIELDS, returnGeometry: 'false',
          orderByFields: 'OID', resultOffset: String(offset), resultRecordCount: '1000'
        });
        const data = await fetchJson(`${addressLayer}/query?${params}`, {
          fetchImpl, sleep, pauseMs, name: 'Clark County addresses', errorOf: (d) => d?.error?.message || (d?.error ? 'error' : null)
        });
        if (!Array.isArray(data.features)) throw new Error('Clark County’s address layer answered without a feature list');
        for (const f of data.features) {
          const sn = f.attributes.SN;
          if (!bySn.has(sn)) bySn.set(sn, []);
          bySn.get(sn).push(f.attributes);
        }
        if (!data.exceededTransferLimit || !data.features.length) break;
      }
    }
    return bySn;
  }

  /** Every matching permit issued on or after `since`, with its address added to the leads. */
  async function issuedSince(since) {
    const result = await permits.issuedSince(since);
    const isLead = (r) => Boolean(clark.categoryFor(r.case_type, r.WorkType));
    const serials = [...new Set(result.rows.filter(isLead).map((r) => r.sn).filter((sn) => Number.isInteger(sn)))];
    const bySn = await addressesFor(serials);
    for (const r of result.rows) {
      if (isLead(r)) r._address = clarkAddress(bySn.get(r.sn)) || undefined;
    }
    return result;
  }

  return { issuedSince };
}
