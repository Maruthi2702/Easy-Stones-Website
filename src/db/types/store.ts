/**
 * What the Visit Types / Resource Types / Families router (src/routes/typeLists.ts) needs from a
 * database. `mongo.ts` is the router's old logic, moved here unchanged; `postgres.ts` does the same on
 * Postgres. The router never learns which one answered. Documents are MongoDB-shaped (`_id`, `order`,
 * `fields: { notes, outcome, followUp }`, `family`).
 */
import type { Loose } from '../../types/records.ts';
import type { TypeKind } from '../../utils/typeLists.ts';

export type { TypeKind };

export interface RemoveResult {
  /** 'ok': removed (records moved first). 'uses': records still use it and no target was given. */
  status: 'ok' | 'uses';
  uses: number;
  moved: number;
}

export interface TypeStore {
  /** Every record, in the list's order (`order`, then when it was made). */
  list(): Promise<Loose[]>;
  byId(id: string): Promise<Loose | null>;
  /** A new record at `order`, its id made by the caller; `duplicate` when the name is taken. */
  add(id: string, value: Loose, order: number, by: string): Promise<{ type: Loose } | { duplicate: true }>;
  /** Saves `order` = position for every id (already checked to be the whole list); returns the list. */
  reorder(ids: string[], by: string): Promise<Loose[]>;
  /**
   * Rename / hide / family / fields. A resource type's family change recounts the customers holding it
   * in the same transaction as the save. null when the record is gone.
   */
  edit(id: string, value: Loose, by: string): Promise<{ type: Loose; recounted?: number } | null>;
  /** How many records carry this one's stored name; null when it isn't there. */
  uses(id: string): Promise<number | null>;
  /** Delete, moving what uses it to `target` first, in one transaction. */
  remove(doc: Loose, target: Loose | null): Promise<RemoveResult>;
  /** Resource Types: the families a type's family is checked against (name, shown or hidden). */
  families(): Promise<{ name: string; active?: boolean }[]>;
}
