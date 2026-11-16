/**
 * Permits' data layer: each call picks MongoDB or Postgres by the area's switch (`DB_PERMITS`, src/db/appDb.ts).
 * Reads (the screen's API) are `reads.ts`; writes (the pull, contractor registry cache) are `writes.ts`.
 */
export * from './reads.ts';
export * from './writes.ts';
