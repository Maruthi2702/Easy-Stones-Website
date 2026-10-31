import type { Loose } from '../../types/records.ts';
/**
 * A King County parcel's postal city and ZIP, from the county's parcel layer
 * (KingCo_PropertyInfo). MyBuildingPermit gives the county's permits a street
 * address with no city; the parcel number on the permit's page finds it here.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { cleanText } from '../common.ts';
import { titleCase } from '../rules/kingCounty.ts';
import { fetchJson } from './http.ts';
import { sqlString } from './arcgis.ts';

export const KING_PARCELS_LAYER = 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2';

export function createKingParcels({ layer = KING_PARCELS_LAYER, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 250 }: Loose = {}) {
  /** PIN → { city, zip } for the parcels found (ten-digit PINs; anything else is skipped). */
  async function lookup(pins: unknown) {
    const wanted = [...new Set((pins || []).map(cleanText).filter((p: Loose) => /^\d{10}$/.test(p)))];
    const out = new Map();
    if (!wanted.length) return out;
    const data = await fetchJson(`${layer}/query?${new URLSearchParams({
      f: 'json', where: `PIN IN (${wanted.map(sqlString).join(',')})`, outFields: 'PIN,POSTALCTYNAME,ZIP5', returnGeometry: 'false'
    })}`, { fetchImpl, sleep, pauseMs, name: 'King County’s parcel map', errorOf: (d: Loose) => d?.error?.message || null });
    for (const f of data.features || []) {
      const a = f.attributes || {};
      out.set(cleanText(a.PIN), { city: titleCase(a.POSTALCTYNAME), zip: cleanText(a.ZIP5) });
    }
    return out;
  }
  return { lookup };
}
