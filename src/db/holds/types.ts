/**
 * What Cart & Holds asks of its database. One store per unit of work (a transaction, or none for a
 * plain read / single write): `mongo.ts` answers with Mongoose, `postgres.ts` with SQL, both in
 * MongoDB's record shape (`_id`, `__v`, `customer: { id, name… }`, `createdBy: { id, name }`, `lines` inside the hold).
 */
import type { ClientSession } from 'mongoose';
import type { Loose } from '../../types/records.ts';

/** Which holds a list shows: the scope's own rule, then search, created-between and the status tab. */
export interface HoldQuery {
  scope: { createdById?: string; branch?: string; branches?: string[] };
  search?: string;
  /** "YYYY-MM-DD", inclusive, on the UTC day the hold was made. */
  from?: string;
  to?: string;
  status: string;
  now: Date;
  page: number;
  limit: number;
}

export const HOLD_TABS = ['active', 'expiring', 'expired', 'released', 'converted', 'all'] as const;

export interface HoldsStore {
  /** The MongoDB session the unit of work runs in (null outside a transaction, and on Postgres). */
  session: ClientSession | null;

  // ── Holds ──
  /** The next hold number: 1, 2, 3… */
  nextHoldNumber(): Promise<number>;
  findHold(id: string): Promise<Loose | null>;
  findHoldByRequestId(requestId: string): Promise<Loose | null>;
  /** Saves a new hold (its `_id` made by the caller). A requestId already used → error with code 11000 and keyPattern.requestId. */
  createHold(doc: Loose): Promise<Loose>;
  /** Saves the whole hold only if it is still at its `__v` (→ null otherwise); the saved hold has the next `__v`. */
  saveHold(hold: Loose): Promise<Loose | null>;
  listHolds(query: HoldQuery): Promise<{ total: number; items: Loose[]; counts: Record<(typeof HOLD_TABS)[number], number> }>;
  /** Active holds whose expiry has passed and that haven't been noted yet, up to `limit` ids. */
  holdsToNote(now: Date, limit: number): Promise<string[]>;
  /** Active holds past their release time, up to `limit` ids. */
  holdsToRelease(now: Date, limit: number): Promise<string[]>;

  // ── History (append-only) ──
  addHistory(entries: Loose[]): Promise<void>;
  /** Newest first. */
  history(holdId: string, limit: number): Promise<Loose[]>;

  // ── Slab locks ──
  reservationsFor(keys: string[]): Promise<Loose[]>;
  /** Locks every slab of `lines` for `hold`. [] = done; otherwise nothing is promised and this is every lock on those slabs now (someone else has one). */
  lockSlabs(hold: Loose, lines: Loose[], by: Loose): Promise<Loose[]>;
  unlockSlabs(holdId: string, slabKeys: string[]): Promise<void>;
  /** Every lock of a hold. */
  unlockHold(holdId: string): Promise<void>;
  /** Carry a hold's customer name or expiry day onto its locks. */
  updateLocks(holdId: string, set: { customerName?: string; expiresOn?: string }): Promise<void>;
  /** Purchasing's read: the locks at these branches, oldest first. */
  locksAtBranches(branches: string[]): Promise<Loose[]>;

  // ── Carts ──
  getCart(userId: string): Promise<Loose | null>;
  /** The person's cart (made if there is none) with its slab keys. */
  ensureCart(userId: string, userName: string): Promise<{ slabKeys: string[] }>;
  /** Adds the lines only if none of their slabs is in the cart already (→ true). */
  addCartLines(userId: string, lines: Loose[]): Promise<boolean>;
  setCartCustomer(userId: string, userName: string, customer: { id: string; name: string } | null): Promise<void>;
  /** → whether the slab was in the cart. */
  setCartNote(userId: string, slabKey: string, note: string): Promise<boolean>;
  removeCartSlabs(userId: string, slabKeys: string[]): Promise<void>;
  /** Empties the cart and clears its customer; → the slab keys it held. */
  clearCart(userId: string): Promise<string[]>;
  /** Someone else's carts that hold any of these slabs: who, and which. */
  othersWith(userId: string, slabKeys: string[]): Promise<{ userName: string; slabKeys: string[] }[]>;
  /** After a hold: the cart has none of `slabKeys`, and loses its customer when that leaves it empty. */
  releaseFromCart(userId: string, slabKeys: string[]): Promise<void>;
}
