/**
 * Rows made from the bank statement itself (owner, 2026-11-25): so the Expenses list and the Excel the accounting team
 * downloads at month end hold the same rows and totals as the bank report, which is final.
 *
 * Besides a charge's own receipt (or Missing row) three kinds of line become an expense row for the card's holder:
 *  - **refund**   a credit that isn't a card payment, saved **negative** (as the report shows it);
 *  - **fee**      interest and bank fees (annual, card delivery, foreign transaction…), positive;
 *  - **refunded_charge**  a charge a later credit returned: it stays a row, so the charge and its refund net to zero
 *    in a total, as they do in the report. It used to lose its Missing row.
 * Card payments ("AUTO PAYMENT DEDUCTION", "ONLINE PAYMENT - THANK YOU") are money sent to the bank, not spending: no row.
 * None of the three needs a receipt. Each is made **Waiting for Accounting** (owner's pick): Accounting approves it, nobody
 * else, and a $150+ one asks for no second approval (`secondNeeded`). Shared by the check (src/db/cardStatements/) and
 * the screens.
 */
import { isPaymentLine, type LineKind } from './amexStatement.ts';

export const STATEMENT_KINDS = ['refund', 'fee', 'refunded_charge'] as const;
export type StatementKind = typeof STATEMENT_KINDS[number];

export const isStatementKind = (v: unknown): v is StatementKind => (STATEMENT_KINDS as readonly unknown[]).includes(v);

/** What a statement line should become, or null when it needs no row of this kind (a plain charge, a card payment). */
export function statementKindFor(line: { kind: LineKind; cents: number; description: string }, refunded: boolean): StatementKind | null {
  if (line.kind === 'fee') return 'fee';
  if (line.kind === 'credit') return line.cents < 0 && !isPaymentLine(line.description) ? 'refund' : null;
  return refunded ? 'refunded_charge' : null;
}

export const statementKindLabel = (kind: string | null | undefined) =>
  kind === 'refund' ? 'Refund' : kind === 'fee' ? 'Fee' : kind === 'refunded_charge' ? 'Refunded charge' : '';

/** The first line of such a row's history. */
export function statementRowWords(kind: StatementKind, bank: string, reference: string): string {
  if (kind === 'refund') return `A ${bank} credit (${reference}) from the bank statement: a refund. No receipt is needed; Accounting approves it.`;
  if (kind === 'fee') return `A ${bank} fee (${reference}) from the bank statement. No receipt is needed; Accounting approves it.`;
  return `The ${bank} charge (${reference}) was refunded: no receipt is needed; Accounting approves it.`;
}
