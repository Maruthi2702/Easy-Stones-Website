/**
 * One-time (owner, 2026-11-25): remove the Amex report and expenses before a day, and one old report file whole.
 *
 *   DATABASE_URL=… node scripts/amex-before-remove.ts --before=2026-10-26 --file="Oct'26"          dry run: counts, nothing written
 *   DATABASE_URL=… node scripts/amex-before-remove.ts --before=2026-10-26 --file="Oct'26" --apply    saves each expense, then deletes
 *
 * Amex only. Statements lines dated before the day, the lines only the named file's uploads carry (and those uploads),
 * and the placeholder expenses (Approved "without a receipt" backfill rows, untouched Missing rows) that went with them.
 * Every deleted expense is saved whole to card_expense_deletions first. Expenses with a receipt file or a lost-receipt
 * reason, and anything a person made or touched, are listed and kept. Rules: src/db/cardStatements/removeBefore.ts.
 */
import { openDb } from '../src/db/client.ts';
import { planRemoveBefore, applyRemoveBefore } from '../src/db/cardStatements/removeBefore.ts';
import type { Db } from '../src/db/copy/plan.ts';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? '';
const before = flag('before'), file = flag('file');
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url || !before) { console.error('Usage: DATABASE_URL=… node scripts/amex-before-remove.ts --before=YYYY-MM-DD [--file=part of a file name] [--apply]'); process.exit(1); }

const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const tally = (rows: string[]) => [...rows.reduce((m, r) => m.set(r, (m.get(r) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(5)}  ${k || '(blank)'}`).join('\n');

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const reason = `Cleanup 2026-11-25: Amex before ${before}${file ? ` and the "${file}" report` : ''}`;
  const plan = apply ? await applyRemoveBefore(d, { before, file }, reason) : await planRemoveBefore(d, { before, file });
  const days = plan.expenses.map(e => e.day).sort();
  console.log(`${apply ? 'Removed' : 'Would remove'}: ${plan.removeLines.length} statement lines, ${plan.imports.length} uploads${plan.imports.length ? ` (${plan.imports.map(i => i.fileName).join(', ')})` : ''}`);
  console.log(`${apply ? 'Deleted' : 'Would delete'}: ${plan.expenses.length} expenses · ${money(plan.expenses.reduce((t, e) => t + e.cents, 0))}${days.length ? ` (charge days ${days[0]} to ${days.at(-1)})` : ''}`);
  console.log(`\nBy status:\n${tally(plan.expenses.map(e => e.status))}\nBy reason:\n${tally(plan.expenses.map(e => e.why))}\nBy cardholder:\n${tally(plan.expenses.map(e => e.holderName))}`);
  console.log(`\nKept (a receipt file or lost-receipt reason, dated before ${before}): ${plan.keptReal.length}`);
  plan.keptReal.slice(0, 30).forEach(e => console.log(`  ${e.day}  ${e.holderName}  ${e.merchant}  ${money(e.cents)}  ${e.status}`));
  console.log(`Kept (a person's work or still answering a remaining line, dated before ${before}): ${plan.keptOther.length}`);
  plan.keptOther.slice(0, 30).forEach(e => console.log(`  ${e.day}  ${e.holderName}  ${e.merchant}  ${money(e.cents)}  ${e.status}`));
  if (plan.sharedLines.length) console.log(`\n${plan.sharedLines.length} lines are also in another upload: kept.`);
  if (!apply) console.log('\nDry run: nothing changed. Check the counts, then run again with --apply.');
  else console.log('\nEach expense was saved whole to card_expense_deletions first.');
} finally {
  await close();
}
