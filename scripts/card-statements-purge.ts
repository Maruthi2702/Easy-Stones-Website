/**
 * Deletes the Amex / Encore statement uploads one person made, and the lines they brought (one-time, 2026-11-24).
 *
 *   node scripts/card-statements-purge.ts --by=krish                          dry run: what would go, what stays
 *   node scripts/card-statements-purge.ts --by=krish --apply                  deletes the uploads and their lines
 *   node scripts/card-statements-purge.ts --by=krish --missing-rows --apply   also deletes the untouched Missing receipt rows
 *
 * `--by` matches the uploader's name (part of it is enough) or user id. Receipts people uploaded, approved rows and
 * company cards are never deleted. Rules: src/db/cardStatements/purge.ts. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { planPurge, applyPurge } from '../src/db/cardStatements/purge.ts';
import type { Db } from '../src/db/copy/plan.ts';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const by = arg('by');
const apply = process.argv.includes('--apply');
const missingRows = process.argv.includes('--missing-rows');
const url = process.env.DATABASE_URL;
if (!url || !by) { console.error('Usage: DATABASE_URL=… node scripts/card-statements-purge.ts --by=<name> [--missing-rows] [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const plan = apply ? await applyPurge(d, by, { missingRows }) : await planPurge(d, by);
  if (!plan.imports.length) { console.log(`No upload by "${by}" found. Nothing to do.`); process.exit(0); }
  console.log(`Uploads by "${by}":`);
  for (const i of plan.imports) console.log(`  ${i.at.toISOString().slice(0, 10)}  ${i.issuer.padEnd(6)} ${i.lines} lines  ${i.fileName}  (${i.byName})`);
  console.log(`\n${apply ? 'Deleted' : 'Would delete'}: ${plan.imports.length} uploads, ${plan.removeLines.length} lines`);
  console.log(`Kept (another person's upload carries them too): ${plan.keptLines.length} lines`);
  console.log(`Lines that answered a real receipt (the receipt stays): ${plan.answeredByReceipts}`);
  const m = plan.missingRows;
  console.log(`Missing receipt rows of the removed lines: ${m.removable.length} untouched${missingRows ? (apply ? ' (deleted)' : ' (would delete)') : ' (kept — add --missing-rows to delete them)'}; ${m.keptApproved} approved-without-receipt and ${m.keptOther} edited / voided kept`);
  if (!apply) console.log('\nDry run. Run again with --apply to change them.');
} finally {
  await close();
}
