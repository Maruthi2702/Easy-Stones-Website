/**
 * What Purchasing asks of its database. One store per unit of work (a transaction or a
 * snapshot read): `mongo.ts` answers with Mongoose, `postgres.ts` with SQL, both in
 * MongoDB's record shape (`_id`, `__v`, `createdBy: { id, name }`, history inside the draft).
 */
import type { ClientSession } from 'mongoose';
import type { Loose } from '../../types/records.ts';

export interface DraftChange {
  /** The draft must still have this version and status, or nothing changes (→ null). */
  version: number;
  fromStatus: string;
  status: string;
  linkedPoLines?: string[];
  entry: { action: string; at: Date; name: string; note: string };
}

export interface PurchasingStore {
  /** The MongoDB session the stock, sales and transit reads join (null outside a transaction). */
  session: ClientSession | null;
  /** On Postgres: this unit of work's own transaction, which the stock / sales / transit / revision reads join (null on MongoDB). */
  tx: unknown;

  listScopes(): Promise<Loose[]>;
  findScope(id: string): Promise<Loose | null>;
  createScope(id: string, fields: Loose): Promise<Loose>;
  /** Saves only if the scope is still at `version` (→ null otherwise). */
  updateScope(id: string, version: number | undefined, fields: Loose): Promise<Loose | null>;
  /** Does any draft of the scope have a line at a branch outside `branches`? */
  draftUsesOtherBranch(scopeId: string, branches: string[]): Promise<boolean>;
  /** Imports saved before branches were recorded take the scope's branches as they are now. */
  stampLegacyInboundBranches(scopeId: string, branches: string[]): Promise<void>;

  createInbound(id: string, doc: Loose): Promise<Loose>;
  latestInbound(scopeId: string): Promise<Loose | null>;

  findDraft(id: string): Promise<Loose | null>;
  activeDrafts(scopeId: string): Promise<Loose[]>;
  /** Not-active drafts, newest first, strictly older than `before` when given. */
  pastDrafts(scopeId: string, opts: { before?: string; limit: number }): Promise<Loose[]>;
  /** The draft and its locks, together or not at all. A lock already held → error with code 11000. */
  createDraft(id: string, doc: Loose, locks: { _id: string; scopeId: string }[]): Promise<Loose>;
  changeDraft(id: string, change: DraftChange): Promise<Loose | null>;
  insertPoLinks(keys: string[], draftId: string): Promise<void>;
  releaseLocks(draftId: string): Promise<void>;
  listLocks(): Promise<{ _id: string; draftId: unknown }[]>;
}
