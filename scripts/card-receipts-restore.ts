/**
 * Puts back receipts the 2026-11-24 cleanup (scripts/card-receipts-prune.ts) deleted, from card_expense_deletions.
 *
 *   node scripts/card-receipts-restore.ts --status=waiting            dry run: which would come back
 *   node scripts/card-receipts-restore.ts --status=waiting --apply    puts them back, as they were, with a "restored" line
 *
 * Only rows that cleanup saved (deleted by 'script', reason "Cleanup 2026-11-24…") and only the status you name. A receipt
 * already there is skipped. A statement line its history names and nothing points at is linked to it again.
 * Rules: src/db/cardStatements/purge.ts. Needs DATABASE_URL.
 */
import { openDb } from '../src/db/client.ts';
import { planRestore, applyRestore } from '../src/db/cardStatements/purge.ts';
import type { Db } from '../src/db/copy/plan.ts';

const status = process.argv.find(a => a.startsWith('--status='))?.slice(9).trim() ?? '';
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url || !status) { console.error('Usage: DATABASE_URL=… node scripts/card-receipts-restore.ts --status=waiting [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const found = apply ? (await applyRestore(d, status)).found : await planRestore(d, status);
  if (!found.length) { console.log(`Nothing deleted by the cleanup has status "${status}".`); process.exit(0); }
  console.log(`${apply ? 'Restored' : 'Would restore'}: ${found.length} receipts\n`);
  for (const f of found) {
    console.log(`  ${f.day}  $${(f.cents / 100).toFixed(2).padStart(9)}  ${f.holderName.padEnd(18)} ${f.merchant.slice(0, 30).padEnd(30)} made by ${f.createdBy}${f.hasReceipt ? '  [has a receipt file]' : ''}`);
  }
  if (!apply) console.log('\nDry run. Run again with --apply to put them back.');
} finally {
  await close();
}
