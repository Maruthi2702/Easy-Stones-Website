/** What the duplicate saves take and answer (merge.ts and its two twins). */

export type DuplicateAction = 'merge' | 'delete' | 'separate';

export interface ResolveDuplicatesInput {
  /** The record that stays. */
  keepId: string;
  /** Every other member and what happens to it, in the order the screen sent them. */
  actions: [string, DuplicateAction][];
  /** Who resolved it (the backup's createdBy). */
  who: string;
  /** newId() from the route, one per backup a resolve can save. */
  backupIds: { delete: string; merge: string };
}

export type ResolveDuplicatesResult =
  | { missing: true }
  | { merged: number; deleted: number; separate: number; undoIds: string[] };

export type UndoDuplicatesResult = { alreadyUndone: true } | { restored: number };
