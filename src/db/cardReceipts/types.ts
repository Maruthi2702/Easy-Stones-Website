/** One line of an expense's history (what the route pushes on every change). */
export interface ExpenseHistoryEntry {
  at: Date;
  by: string;
  action: 'added' | 'edited' | 'approved' | 'sent back' | 'voided';
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

/** What the Expenses list asks for: a month (the caller's, or everyone's), or what is waiting for approval. */
export type ExpenseFilter =
  /** `overCents`: also every waiting receipt above that total, whoever's it is (for the roles that decide big ones). */
  | { kind: 'waiting'; userIds: readonly string[]; overCents?: number }
  /** `userIds`: only these people's (a team); an empty list matches nobody. */
  | { kind: 'month'; month: string; userId?: string; userIds?: readonly string[] };
