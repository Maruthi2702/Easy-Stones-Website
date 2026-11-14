/** One line of an expense's history (what the route pushes on every change). */
export interface ExpenseHistoryEntry {
  at: Date;
  by: string;
  action: 'added' | 'edited' | 'approved' | 'sent back' | 'voided';
  changes?: string;
}

/** What the Expenses list asks for: a month (the caller's, or everyone's), or what is waiting for approval. */
export type ExpenseFilter =
  | { kind: 'waiting'; userIds: readonly string[] }
  | { kind: 'month'; month: string; userId?: string };
