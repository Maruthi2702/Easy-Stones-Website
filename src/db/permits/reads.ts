/**
 * Permits' reads (the screen's API, src/permits/router.ts): each call picks MongoDB or Postgres by the area's switch
 * (`DB_PERMITS`, src/db/appDb.ts). Both answer the same (permits.reads.parity.test.ts).
 */
import { appDb, areaOn } from '../appDb.ts';
import * as mongo from './readsMongo.ts';
import * as pg from './readsPostgres.ts';
import type { PermitSpec, SortKey, PermitPageOptions } from './readTypes.ts';

export { SORT_KEYS } from './readTypes.ts';
export type { PermitSpec, SortKey, PermitPageOptions, PermitPage, PermitMeta, ContractorPermitData } from './readTypes.ts';

const onPostgres = () => areaOn('permits') === 'postgres';

/** A page (or every row, or the first N) of what the filters match, in order: with its total and the tabs' counts when asked. */
export async function permitPage(spec: PermitSpec, sort: SortKey, options: PermitPageOptions = {}) {
  return onPostgres() ? pg.permitPage(await appDb(), spec, sort, options) : mongo.permitPage(spec, sort, options);
}
export async function countPermits(spec: PermitSpec) {
  return onPostgres() ? pg.countPermits(await appDb(), spec) : mongo.countPermits(spec);
}
/** Each source's last / last good / first backfill run, the latest checks and every city, for the page's header. */
export async function permitMeta(sourceIds: string[], checkLimit: number) {
  return onPostgres() ? pg.permitMeta(await appDb(), sourceIds, checkLimit) : mongo.permitMeta(sourceIds, checkLimit);
}
/** What the contractor pop-up shows of their permits here. */
export async function contractorPermitData(spec: PermitSpec) {
  return onPostgres() ? pg.contractorPermitData(await appDb(), spec) : mongo.contractorPermitData(spec);
}
