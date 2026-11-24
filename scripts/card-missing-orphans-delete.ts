/**
 * Deletes the Missing receipt rows left behind when statement uploads were removed (one-time, 2026-11-24).
 *
 *   node scripts/card-missing-orphans-delete.ts            dry run: counts, by who made them and by cardholder
 *   node scripts/card-missing-orphans-delete.ts --apply    deletes them (their history goes with them)
 *
 * Only a row that is still Missing, has no receipt, was never edited or voided, and that no statement line
 * points at. Rules: src/db/cardStatements/purge.ts. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { planOrphanMissingRows, applyOrphanMissingRows } from '../src/db/cardStatements/purge.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-missing-orphans-delete.ts [--apply]'); process.exit(1); }

const tally = (rows: string[]) => [...rows.reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}  ${k || '(blank)'}`).join('\n');

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const rows = apply ? await applyOrphanMissingRows(d) : await planOrphanMissingRows(d);
  if (!rows.length) { console.log('No orphaned Missing receipt rows. Nothing to do.'); process.exit(0); }
  console.log(`${apply ? 'Deleted' : 'Would delete'}: ${rows.length} Missing receipt rows\n\nMade by:\n${tally(rows.map(r => r.createdBy))}\n\nCardholder:\n${tally(rows.map(r => `${r.holderName} · ${r.cardLabel}`))}`);
  const days = rows.map(r => r.day).sort();
  console.log(`\nCharge days: ${days[0]} to ${days.at(-1)}`);
  if (!apply) console.log('\nDry run. Run again with --apply to delete them.');
} finally {
  await close();
}
