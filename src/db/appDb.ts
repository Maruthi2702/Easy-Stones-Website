/**
 * The server's one Postgres connection, and which database each area reads.
 *
 * Every area starts on MongoDB. `DB_<AREA>=postgres` on the server (e.g.
 * `DB_CUSTOMERS=postgres`) moves that area's routes to Postgres — the data layer in
 * `src/db/<area>/` picks the database per call with `areaOn()`. Anything else, or
 * nothing, is MongoDB, so a deploy with no setting changes nothing.
 *
 * While MongoDB is still the database the app writes, Postgres only holds what the
 * last copy put there (scripts/pg-copy.ts). So an area is switched on the live server
 * only at its cutover; before that, only on a test copy (src/db/README.md).
 */
import { openDb, type OpenDb } from './client.ts';
import type { Db } from './copy/plan.ts';

export type DbArea = 'customers' | 'deliveries' | 'payments';
export type AreaDatabase = 'mongo' | 'postgres';

const envName = (area: DbArea) => `DB_${area.toUpperCase()}`;

/** Which database an area reads and writes now. Read on every call, so a test can flip it. */
export function areaOn(area: DbArea): AreaDatabase {
  return String(process.env[envName(area)] || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'mongo';
}

/** Areas switched to Postgres, for the start-up log line. */
export function areasOnPostgres(areas: DbArea[] = ['customers', 'deliveries', 'payments']): DbArea[] {
  return areas.filter(a => areaOn(a) === 'postgres');
}

let opened: Promise<OpenDb> | null = null;

/** The shared connection, opened on first use from DATABASE_URL. Fails loudly without it. */
export async function appDb(): Promise<Db> {
  if (!opened) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('An area is switched to Postgres (DB_<AREA>=postgres) but DATABASE_URL is not set.');
    // Several requests at once; RDS t4g.micro allows ~80 connections.
    opened = openDb(url, { max: 10 });
    opened.catch(() => { opened = null; });
  }
  return (await opened).db;
}

/** Tests hand in their own database (PGlite) instead of DATABASE_URL. */
export function useAppDbForTests(db: Db | null): void {
  opened = db ? Promise.resolve({ db, close: async () => {} }) : null;
}
