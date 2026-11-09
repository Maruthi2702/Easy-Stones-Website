/**
 * Open a Postgres database with Drizzle and bring its tables up to date.
 *
 * `DATABASE_URL` is a postgres:// URL; RDS from Render adds `?auth=iam`
 * (rdsConnection.ts: IAM tokens, verified TLS). `pglite:<folder>` (or
 * `pglite:memory`) opens PGlite — Postgres running inside Node, no server —
 * for tests and a local dry run of the copy; PGlite is a dev dependency only.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema/index.ts';
import type { Db } from './copy/plan.ts';
import { iamPoolConfig, iamTargetFrom } from './rdsConnection.ts';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export interface OpenDb {
  db: Db;
  close: () => Promise<void>;
}

export async function openDb(url: string): Promise<OpenDb> {
  if (url.startsWith('pglite:')) {
    const where = url.slice('pglite:'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite(where === 'memory' ? undefined : where);
    return { db: drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db, close: () => client.close() };
  }
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  // RDS from Render: `?auth=iam` signs IAM tokens and verifies TLS (rdsConnection.ts).
  // Any other URL goes to pg as written (sslmode in the URL).
  const target = iamTargetFrom(url, process.env.AWS_REGION);
  const pool = target ? new pg.Pool({ ...(await iamPoolConfig(target)), max: 2 }) : new pg.Pool({ connectionString: url, max: 2 });
  return { db: drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db, close: () => pool.end() };
}

/**
 * Apply drizzle/ migrations not yet run on this database. `migrationsFolder` is for a
 * bundle (the copy Lambda ships drizzle/ beside its code).
 */
export async function migrateDb(db: Db, url: string, migrationsFolder = MIGRATIONS): Promise<void> {
  if (url.startsWith('pglite:')) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db as never, { migrationsFolder });
  }
}
