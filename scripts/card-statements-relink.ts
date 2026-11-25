/**
 * Runs the Amex / Encore check again, **linking only** — it never makes a Missing receipt row (2026-11-24).
 *
 *   node scripts/card-statements-relink.ts --bank=amex            dry run: how many charges would find their receipt
 *   node scripts/card-statements-relink.ts --bank=amex --apply    links them (a Missing / Admin stand-in row it replaces is voided)
 *
 * Why: a charge links to a receipt of the same holder at that bank (same card, exact amount, at most 2 days apart) only
 * when the check runs — on an upload, a card change or a saved receipt. After a cleanup deleted and restored receipts the
 * lines can read "No receipt" while the receipt is sitting in Expenses. Unlike re-uploading the file this makes no new
 * Missing rows (it passes a `missingFrom` no charge reaches). Needs DATABASE_URL.
 */
import { openDb } from '../src/db/client.ts';
import { recheck } from '../src/db/cardStatements/index.ts';
import type { Db } from '../src/db/copy/plan.ts';

const bank = process.argv.find(a => a.startsWith('--bank='))?.slice(7).trim() ?? '';
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url || (bank !== 'amex' && bank !== 'encore')) { console.error('Usage: DATABASE_URL=… node scripts/card-statements-relink.ts --bank=amex|encore [--apply]'); process.exit(1); }

class Rollback extends Error {
  result: unknown;
  constructor(result: unknown) { super('dry run'); this.result = result; }
}

const { db, close } = await openDb(url);
try {
  const real = db as unknown as Db;
  // A dry run does the real work inside a transaction and throws it away.
  const target = apply ? real : ({
    transaction: async (fn: (tx: Db) => Promise<unknown>) => {
      try { return await (real as any).transaction(async (tx: Db) => { throw new Rollback(await fn(tx)); }); }
      catch (e) { if (e instanceof Rollback) return e.result; throw e; }
    }
  } as unknown as Db);
  const by = { id: 'script', name: 'Relink script' };
  const r = await recheck(by, { issuer: bank, missingFrom: '9999-12-31' }, target) as { linked: number; created: number; retired: number; cardsFound: number };
  console.log(`${apply ? 'Linked' : 'Would link'}: ${r.linked} charges to their receipts (${r.retired} stand-in rows ${apply ? 'voided' : 'would be voided'}, ${r.cardsFound} cards found, ${r.created} Missing rows made).`);
  if (!apply) console.log('\nDry run. Run again with --apply to link them.');
} finally {
  await close();
}
