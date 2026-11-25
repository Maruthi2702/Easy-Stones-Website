/**
 * Live card expense rows by kind: receipts, Missing receipt rows, and the rows made from the bank statement
 * (refund, fee, refunded_charge — src/utils/statementRows.ts). Voided rows are left out. Read-only; used by
 * scripts/card-statement-rows.ts to show what a run changes.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';

export type RowCounts = Record<string, { n: number; cents: number }>;

export async function rowCounts(db: Db): Promise<RowCounts> {
  const res = await db.execute(sql`
    select coalesce(nullif(statement_kind, ''), case when status = 'missing' then 'missing receipt' else 'receipt' end) as kind,
           count(*)::int as n, coalesce(sum(cents), 0)::bigint as cents
    from card_expenses where voided_at is null group by 1 order by 1`);
  // node-postgres answers { rows }, postgres-js and PGlite an array-like of rows.
  const list = ((res as unknown as { rows?: unknown[] }).rows ?? res) as { kind: string; n: number; cents: string | number }[];
  return Object.fromEntries(list.map(r => [r.kind, { n: Number(r.n), cents: Number(r.cents) }]));
}
