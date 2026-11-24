/** One line of an expense's history (what the route pushes on every change). */
export interface ExpenseHistoryEntry {
  at: Date;
  by: string;
  action: 'added' | 'edited' | 'approved' | 'sent back' | 'voided' | 'asked' | 'answered' | 'question withdrawn' | 'reopened';
  changes?: string;
  /**
   * The `updatedAt` of the expense the caller read and decided on. If the row has moved on by the time the
   * write runs (inside the same lock / transaction), the write is refused with a StaleExpenseError instead of
   * overwriting a change the caller never saw. Never stored in the history.
   */
  expectedUpdatedAt?: Date | string | null;
}

/** Another live receipt for the same holder, day and amount was saved first (found under the lock). */
export class RepeatExpenseError extends Error {
  readonly existing: Record<string, unknown>;
  constructor(existing: Record<string, unknown>) {
    super('This receipt looks already uploaded.');
    this.name = 'RepeatExpenseError';
    this.existing = existing;
  }
}

/** The expense changed between the caller reading it and the write: nothing was written. */
export class StaleExpenseError extends Error {
  constructor() {
    super('This receipt just changed. Open it again, then retry.');
    this.name = 'StaleExpenseError';
  }
}

/** The most expenses one list answers with. A month never gets near it; if one does, the answer says `truncated`. */
export const EXPENSE_LIST_CAP = 20_000;
/** What a cardholder still has to finish (the To-do list): a Missing receipt, a Draft, one Sent back. */
export const TODO_STATUSES = ['missing', 'draft', 'sent_back'] as const;

/**
 * A statement charge's stand-in row an upload may still replace: a Missing receipt row, or an Admin's own
 * charge that waits for Accounting with nothing on it yet (no receipt, no lost-receipt reason, no approval).
 */
export const isChargePlaceholder = (e: { status?: unknown; receiptUrl?: unknown; lostReason?: unknown; approval?: unknown; secondApproval?: unknown; voidedAt?: unknown }) =>
  !e.voidedAt && (e.status === 'missing'
    || (e.status === 'waiting' && !e.receiptUrl && !e.lostReason && !e.approval && !e.secondApproval));

/** What the Expenses list asks for: a month (the caller's, or everyone's), or what is waiting for approval. */
export type ExpenseFilter =
  /** Every waiting, not voided receipt (the route keeps those waiting for the caller: receiptApproval.ts's waitingReason). */
  | { kind: 'waiting' }
  /** One person's receipts still to finish, any month (review B1): Missing receipt, Draft, Sent back; not voided. */
  | { kind: 'todo'; userId: string }
  /** `userIds`: only these people's (a team); an empty list matches nobody. */
  | { kind: 'month'; month: string; userId?: string; userIds?: readonly string[] }
  /** A custom From–To (both days included, 'YYYY-MM-DD'), the same people rules as 'month'. */
  | { kind: 'range'; from: string; to: string; userId?: string; userIds?: readonly string[] }
  /** Every month (Export all): the same people rules as 'month', newest first, capped like it. */
  | { kind: 'all'; userId?: string; userIds?: readonly string[] };
