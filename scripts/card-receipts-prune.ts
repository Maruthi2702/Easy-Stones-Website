/**
 * Deletes every card receipt NOT made by the people to keep, except Approved ones (one-time, 2026-11-24, owner's ask).
 *
 *   node scripts/card-receipts-prune.ts --keep=krish,karunakar            dry run: who made what, what would go
 *   node scripts/card-receipts-prune.ts --keep=krish,karunakar --apply    saves each to card_expense_deletions, then deletes
 *   node scripts/card-receipts-prune.ts --delete=krish,karunakar          the other way round: only what THOSE people made
 *   … --status=missing                                                    limit either to one status (missing, draft, waiting, sent_back)
 *
 * "Made by" is the name an expense was created under (the cardholder for a receipt they uploaded; the statement's
 * uploader for a Missing row). A name is kept when it holds the whole word (krish ≠ Krishna). Approved receipts and rows
 * with no creator name are never deleted. A statement line that pointed at a deleted receipt is unlinked, so its charge
 * reads "no receipt" again. Receipt files in storage stay. Rules: src/db/cardStatements/purge.ts. Needs DATABASE_URL.
 */
import { openDb } from '../src/db/client.ts';
import { planPrune, applyPrune } from '../src/db/cardStatements/purge.ts';
import type { Db } from '../src/db/copy/plan.ts';

const list = (flag: string) => (process.argv.find(a => a.startsWith(`--${flag}=`))?.slice(flag.length + 3) ?? '').split(',').map(s => s.trim()).filter(Boolean);
const mode = list('delete').length ? 'delete' as const : 'keep' as const;
const keep = mode === 'delete' ? list('delete') : list('keep');
const apply = process.argv.includes('--apply');
const status = process.argv.find(a => a.startsWith('--status='))?.slice(9).trim() ?? '';
const url = process.env.DATABASE_URL;
if (!url || !keep.length || (list('delete').length && list('keep').length)) { console.error('Usage: DATABASE_URL=… node scripts/card-receipts-prune.ts (--keep=name,name | --delete=name,name) [--apply]'); process.exit(1); }

const tally = (rows: string[]) => [...rows.reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(5)}  ${k || '(blank)'}`).join('\n');

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const plan = apply ? await applyPrune(d, keep, `Cleanup 2026-11-24: ${mode === 'delete' ? 'made by' : 'not made by'} ${keep.join(' or ')}, ${status ? `${status} only` : 'not approved'}`, 'script', mode, status) : await planPrune(d, keep, mode, status);
  const days = plan.remove.map(r => r.day).sort();
  console.log(`${apply ? 'Deleted' : 'Would delete'}: ${plan.remove.length} receipts${days.length ? ` (charge days ${days[0]} to ${days.at(-1)})` : ''}`);
  console.log(`\nBy who made them:\n${tally(plan.remove.map(r => r.createdBy))}`);
  console.log(`\nBy status:\n${tally(plan.remove.map(r => r.status))}`);
  console.log(`\nBy cardholder:\n${tally(plan.remove.map(r => r.holderName))}`);
  console.log(`\nOf these, answering a bank statement line: ${plan.remove.filter(r => r.onStatement).length}${apply ? ' (unlinked)' : ' (would be unlinked)'}`);
  console.log(`Kept: ${plan.keptByName} ${mode === 'delete' ? 'made by anyone else' : `made by ${keep.join(' / ')}`}, ${plan.keptApproved} approved, ${plan.noCreator} with no creator name${status ? `, ${plan.keptOtherStatus} not ${status}` : ''}`);
  if (!apply) console.log('\nDry run. Check "By who made them" for any name that should stay, then run again with --apply.');
  else console.log('\nEach one was saved whole to card_expense_deletions first.');
} finally {
  await close();
}
