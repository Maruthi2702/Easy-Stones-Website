import type { Loose } from '../../types/records.ts';
/**
 * City of Bellevue's permits: the list and each lead's people from
 * MyBuildingPermit (office 1), and for each lead the city's own record on its
 * ArcGIS permit layer (value, owner, units, floor area, the building's kind).
 * See rules/bellevue.js for why the list doesn't come from the layer.
 *
 * Server-only. `fetchImpl` and `sleep` are injectable for tests.
 */
import { cleanText } from '../common.ts';
import { BELLEVUE_LAYER, BELLEVUE_FIELDS } from '../rules/bellevue.ts';
import { fetchJson } from './http.ts';
import { sqlString } from './arcgis.ts';

/** The city's record for one permit number, or null when the layer doesn't have it. */
export function createBellevueLayer({ layer = BELLEVUE_LAYER, fetchImpl = globalThis.fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), pauseMs = 250 }: Loose = {}) {
  async function byNumber(permitNumber: string | number) {
    const data = await fetchJson(`${layer}/query?${new URLSearchParams({
      f: 'json', where: `PERMITNUMBER = ${sqlString(cleanText(permitNumber))}`, outFields: BELLEVUE_FIELDS.join(','), returnGeometry: 'false'
    })}`, { fetchImpl, sleep, pauseMs, name: 'Bellevue', errorOf: (d: Loose) => d?.error?.message || (d?.error ? 'error' : null) });
    return data.features?.[0]?.attributes || null;
  }
  return { byNumber };
}

/** `mbp` is the MyBuildingPermit reader for office 1; `layer` the city's (createBellevueLayer). */
export function createBellevueSource({ mbp, layer = createBellevueLayer() }: Loose) {
  return {
    issuedSince: mbp.issuedSince,
    async details(permitNumber: string | number) {
      const detail = await mbp.details(permitNumber);
      let record = null;
      try {
        record = await layer.byNumber(permitNumber);
      } catch {
        record = null;   // the people still count; value and owner wait for the next read
      }
      return { ...detail, record };
    }
  };
}
