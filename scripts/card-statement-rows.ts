/**
 * Makes the refund, fee and refunded-charge rows for the statement lines already loaded, and the Missing receipt rows the
 * moved start days now ask for (owner, 2026-11-25): so Expenses and the Excel the accounting team downloads match the bank
 * report row for row. It is the same check an upload runs, for both banks.
 *
 *   DATABASE_URL=… node scripts/card-statement-rows.ts           dry run: what it would make, nothing kept
 *   DATABASE_URL=… node scripts/card-statement-rows.ts --apply   makes them
 *
 * Refunds become negative rows, fees positive ones, a refunded charge keeps a row (a Missing row becomes it); each is
 * Waiting for Accounting with no receipt asked. Card payments get no row. A row a person voided or deleted is not made
 * again; a card with no holder waits. Safe to run twice. Rules: src/utils/statementRows.ts. Needs DATABASE_URL.
 */
import { openDb } from '../src/db/client.ts';
import { recheck, type CheckResult } from '../src/db/cardStatements/index.ts';
import { rowCounts as counts, type RowCounts as Counts } from '../src/db/cardStatements/rowCounts.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-statement-rows.ts [--apply]'); process.exit(1); }

class Rollback extends Error {
  result: unknown;
  constructor(result: unknown) { super('dry run'); this.result = result; }
}
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const { db, close } = await openDb(url);
try {
  const real = db as unknown as Db;
  const before = await counts(real);
  const by = { id: 'script', name: 'Statement rows script' };
  const banks = ['amex', 'encore'] as const;
  const results: Record<string, CheckResult> = {};
  const after: Counts = JSON.parse(JSON.stringify(before));

  for (const bank of banks) {
    if (apply) {
      results[bank] = await recheck(by, { issuer: bank }, real);
      continue;
    }
    // A dry run does the real work inside a transaction, reads what it made, and throws it away. The banks are
    // checked on their own, so their changes simply add up.
    const target = ({
      transaction: async (fn: (tx: Db) => Promise<unknown>) => {
        try { return await (real as any).transaction(async (tx: Db) => { const result = await fn(tx); throw new Rollback({ result, counts: await counts(tx) }); }); }
        catch (e) { if (e instanceof Rollback) return e.result; throw e; }
      }
    } as unknown as Db);
    const out = await recheck(by, { issuer: bank }, target) as unknown as { result: CheckResult; counts: Counts };
    results[bank] = out.result;
    for (const k of Object.keys(out.counts)) {
      const was = before[k] ?? { n: 0, cents: 0 };
      const cur = after[k] ?? { n: 0, cents: 0 };
      after[k] = { n: cur.n + out.counts[k]!.n - was.n, cents: cur.cents + out.counts[k]!.cents - was.cents };
    }
  }
  if (apply) Object.assign(after, await counts(real));

  for (const bank of banks) {
    const r = results[bank]!;
    console.log(`${bank.toUpperCase()}: ${apply ? 'made' : 'would make'} ${r.statementRows} refund / fee / refunded-charge rows, ${r.created} Missing receipt rows; ${r.linked} linked to receipts, ${r.retired} stand-in rows voided`);
  }
  const kinds = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  console.log(`\nExpense rows (voided left out)            now                 ${apply ? 'after' : 'after the run'}`);
  for (const k of kinds) {
    const a = before[k] ?? { n: 0, cents: 0 }, b = after[k] ?? { n: 0, cents: 0 };
    console.log(`  ${k.padEnd(16)} ${String(a.n).padStart(6)} ${money(a.cents).padStart(16)}   →   ${String(b.n).padStart(6)} ${money(b.cents).padStart(16)}`);
  }
  console.log(apply ? '\nDone.' : '\nDry run: nothing changed. Run again with --apply to make them.');
} finally {
  await close();
}
