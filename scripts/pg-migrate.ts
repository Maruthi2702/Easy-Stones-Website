/**
 * Bring the live database's tables up to date with drizzle/ — and nothing else (no copy,
 * no data written). Prints the migrations not yet applied; changes nothing until `--apply`.
 *
 *   npm run pg:migrate               (on Render: the service → Shell) dry run: lists what's pending
 *   npm run pg:migrate -- --apply    applies them, then lists tables that now exist
 *
 * Needs DATABASE_URL like pg:ping, and a database user allowed to create tables. Applied
 * migrations are remembered in drizzle.__drizzle_migrations, so running it twice is harmless.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, migrateDb } from '../src/db/client.ts';
import { sql } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const apply = process.argv.includes('--apply');

const journal = JSON.parse(fs.readFileSync(path.join('drizzle', 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
const { db, close } = await openDb(url);
try {
  let done = 0;
  try {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    done = Number((r as unknown as { rows: { n: number }[] }).rows[0].n);
  } catch { done = 0; }
  const pending = journal.entries.slice(done).map(e => e.tag);
  console.log(`Applied: ${done} of ${journal.entries.length}. Pending: ${pending.length ? pending.join(', ') : 'none'}.`);
  if (apply && pending.length) {
    await migrateDb(db, url);
    // The tables the applied migrations create, each checked against the database.
    const created = pending.flatMap(tag => [...fs.readFileSync(path.join('drizzle', `${tag}.sql`), 'utf8')
      .matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"(?:public"\.")?([a-z0-9_]+)"/gi)].map(m => m[1]!));
    const t = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const present = new Set((t as unknown as { rows: { table_name: string }[] }).rows.map(r => r.table_name));
    console.log(created.length ? 'Applied. Tables they create:' : 'Applied. (They create no new tables.)');
    for (const name of created) console.log(' -', name, present.has(name) ? '✓' : '✗ MISSING');
  } else if (!apply && pending.length) console.log('Dry run: nothing changed. Re-run with --apply to apply them.');
} finally { await close(); }
