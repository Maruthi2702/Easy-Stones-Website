/** One line of an expense's history (what the route pushes on every change). */
export interface ExpenseHistoryEntry {
  at: Date;
  by: string;
  action: 'added' | 'edited' | 'approved' | 'sent back' | 'voided';
  changes?: string;
}

/** What the Expenses list asks for: a month (the caller's, or everyone's), or what is waiting for approval. */
export type ExpenseFilter =
  /** `overCents`: also every waiting receipt above that total, whoever's it is (for the roles that decide big ones). */
  | { kind: 'waiting'; userIds: readonly string[]; overCents?: number }
  /** `userIds`: only these people's (a team); an empty list matches nobody. */
  | { kind: 'month'; month: string; userId?: string; userIds?: readonly string[] };
