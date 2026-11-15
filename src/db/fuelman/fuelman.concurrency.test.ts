/**
 * The races Fuel Man must never lose, on a REAL Postgres (PGlite runs one connection, so the parity test can't
 * make two writes overlap). Skipped unless PG_RACE_URL points at a scratch database, e.g.
 *
 *   createdb es_race && PG_RACE_URL=postgres:///es_race npx vitest run src/db/fuelman/fuelman.concurrency.test.ts
 *
 * The database is migrated and its Fuel Man tables emptied by the test; never point it at anything you keep.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb, migrateDb, type OpenDb } from '../client.ts';
import { useAppDbForTests } from '../appDb.ts';
import { fuelReports, fuelState, fuelHistory, fuelSources } from '../schema/accounting.ts';
import { importReport } from '../../fuelman/importReport.ts';
import { fixtureReport } from '../../fuelman/testing/fixtures.ts';
import { fuelStore } from './index.ts';

const url = process.env.PG_RACE_URL;
let conn: OpenDb;
const who = { id: 'finance', name: 'Finance' };
const pdf = (marker: string) => Buffer.from(`pdf ${marker}`);

describe.skipIf(!url)('on a real Postgres', { timeout: 60000 }, () => {
  beforeAll(async () => {
    process.env.DB_FUELMAN = 'postgres';
    conn = await openDb(url!, { max: 12 });
    await migrateDb(conn.db, url!);
    useAppDbForTests(conn.db);
    await conn.db.execute(sql`truncate acct_fuelman_reports, acct_fuelman_state, acct_fuelman_periods, acct_fuelman_history cascade`);
  }, 120000);
  afterAll(async () => { useAppDbForTests(null); delete process.env.DB_FUELMAN; await conn?.close(); }, 30000);

  it('eight different corrections of one month at once: each gets its own revision, none skipped, none lost', async () => {
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => importReport(fixtureReport('2026-07', ['A'], i + 1), pdf(`m${i}`), `r${i}.pdf`, who)));
    expect(made.every(r => !r.duplicate)).toBe(true);
    const revisions = (await conn.db.select({ r: fuelReports.revision }).from(fuelReports)).map(r => r.r).sort((a, b) => a! - b!);
    expect(revisions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await conn.db.select().from(fuelSources)).toHaveLength(8);
    expect(await conn.db.select().from(fuelHistory)).toHaveLength(8);
    expect((await conn.db.select().from(fuelState))[0]!.revision).toBe(8);
    expect(await (await fuelStore()).revisionTotal()).toBe(8);
  });

  it('the same file sent six times at once is saved once, and the others answer duplicate', async () => {
    const same = fixtureReport('2026-08', ['A']);
    const answers = await Promise.all(Array.from({ length: 6 }, () => importReport(same, pdf('same'), 'same.pdf', who)));
    expect(answers.filter(a => !a.duplicate)).toHaveLength(1);
    expect(new Set(answers.map(a => a.id)).size).toBe(1);
    expect((await conn.db.select().from(fuelReports).where(sql`period_key like '%:2026-08'`))).toHaveLength(1);
  });
});
