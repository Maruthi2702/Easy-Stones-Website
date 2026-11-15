/**
 * What Supplier POs and the supplier portal ask of their database. One store per unit of work (a
 * transaction, or none for a plain read / single write): `mongo.ts` answers with Mongoose, `postgres.ts`
 * with SQL, both in MongoDB's record shape (`_id`, `__v`, `lines` / `bundles` / `history` inside the
 * record, a note as `{ text, lang, translations, by, at }`).
 *
 * Every id is the 24-character string; a bad one finds nothing. A record the route edits comes back
 * with its `__v`; a PO or block is saved only if it is still at the `__v` the route read (→ null if not).
 */
import type { Loose } from '../../types/records.ts';

/** One history line: who (the staff or the supplier side) did what. */
export interface HistoryLine { at: Date; by: string; side: 'staff' | 'supplier'; action: string; changes: string }

export interface PoQuery {
  status?: 'open' | 'closed' | 'cancelled';
  /** Every PO but the cancelled ones. */
  notCancelled?: boolean;
  supplierId?: string;
  /** Open ones, plus any changed since this moment. */
  openOrSince?: Date;
  /** Newest change first; default 3000. */
  limit?: number;
}

export interface SuppliersStore {
  // ── Suppliers ──
  /** Active ones first, then A–Z by name. */
  listSuppliers(): Promise<Loose[]>;
  supplierById(id: string): Promise<Loose | null>;
  suppliersByIds(ids: string[]): Promise<Loose[]>;
  /** A supplier with exactly this name (any case), other than `exceptId`. */
  supplierNamed(name: string, exceptId: string | null): Promise<Loose | null>;
  supplierBySpsKey(key: string, exceptId: string | null): Promise<Loose | null>;
  /** Saves a new supplier (its `_id` made by the caller). */
  createSupplier(doc: Loose): Promise<Loose>;
  /** Changes fields and appends history lines. → null when there is no such supplier. */
  updateSupplier(id: string, set: Loose, add: HistoryLine[]): Promise<Loose | null>;

  // ── Portal logins ──
  allLogins(): Promise<Loose[]>;
  /** A supplier's logins, optionally only the active ones that have chosen a password. */
  loginsOf(supplierId: string, options?: { reachable?: boolean; activeOnly?: boolean }): Promise<Loose[]>;
  loginById(id: string): Promise<Loose | null>;
  loginByEmail(email: string, options?: { activeOnly?: boolean }): Promise<Loose | null>;
  loginByLinkHash(hash: string): Promise<Loose | null>;
  loginCount(supplierId: string): Promise<number>;
  /** Another login (not `exceptId`) already uses this email. */
  emailTaken(email: string, exceptId: string | null): Promise<boolean>;
  /** A new login; a repeated email → error code 11000. */
  createLogin(doc: Loose): Promise<Loose>;
  /** Changes fields. A `password` in `set` is the new plain password: the store keeps only its hash. → null when there is none. */
  updateLogin(id: string, set: Loose): Promise<Loose | null>;
  /** Every login of a supplier is signed out (their session version goes up by one). */
  endSessionsOf(supplierId: string): Promise<void>;

  // ── POs ──
  poById(id: string, options?: { history?: boolean }): Promise<Loose | null>;
  poByNumber(poNumber: string): Promise<Loose | null>;
  /** These POs, without history. */
  posByIds(ids: string[]): Promise<Loose[]>;
  /** Another PO (not `exceptId`) already has this number. */
  poNumberTaken(poNumber: string, exceptId: string | null): Promise<boolean>;
  /** Without history. */
  listPos(query: PoQuery): Promise<Loose[]>;
  /** A new PO (its `_id` made by the caller); a repeated id or number → error code 11000. */
  createPo(doc: Loose): Promise<Loose>;
  /** Saves only if the PO is still at `version`; appends the history lines. → null when it isn't. */
  updatePo(id: string, version: number, set: Loose, add: HistoryLine[]): Promise<Loose | null>;
  /** A history line alone, with no version check (emailing the supplier). */
  addPoHistory(id: string, line: HistoryLine): Promise<void>;

  // ── Blocks ──
  blockById(id: string): Promise<Loose | null>;
  /** A PO's blocks, oldest first (`sent`: by the day each was first sent, drafts first). Without history unless asked. */
  blocksOfPo(poId: string, options?: { supplierId?: string; order?: 'sent' | 'created'; history?: boolean }): Promise<Loose[]>;
  blocksOfPos(poIds: string[], options?: { supplierId?: string }): Promise<Loose[]>;
  /** Blocks with a bundle at this status, longest waiting first. Without history. */
  blocksWithBundleStatus(status: string, limit: number): Promise<Loose[]>;
  blocksFirstSentSince(since: Date): Promise<Loose[]>;
  /** Blocks of these POs with an approved bundle. */
  blocksWithApproved(poIds: string[]): Promise<Loose[]>;
  /** A new block (its `_id` made by the caller); a repeated id → error code 11000. */
  createBlock(doc: Loose): Promise<Loose>;
  /** Saves only if the block is still at `version`; appends the history lines. → null when it isn't. */
  updateBlock(id: string, version: number, set: Loose, add: HistoryLine[]): Promise<Loose | null>;
  /** Removes a block that was never sent. */
  deleteUnsentBlock(id: string): Promise<void>;
  /** A PO line's material renamed on the blocks of it that were not sent yet. */
  renameUnsentBlocks(poId: string, lineId: string, to: { material: string; thickness: string; finish: string }): Promise<void>;
}
