import type { Id } from '../../types/api';
import type { Loose } from '../../types/records';
import type { HoldLine } from '../../utils/holdView';

/**
 * Cart & Holds shapes as /api/holds sends them (src/holds/router.js). Holds
 * themselves stay loose (`Hold`, `HoldLine` from holdView) until the server's
 * models are typed.
 */
export type { HoldLine };

/** A hold as GET /api/holds/:id (or a list row) sends it; loose apart from what the calls need. */
export type Hold = Loose & { _id: Id; version?: number };

/** lotGroups' answer (src/holds/holdRules.js): one product's lines, by bundle. */
export type LotGroup<L> = {
  product: string;
  bundles: { bundle: string; lines: L[] }[];
  lines: L[];
  slabs: number;
  sfHundredths: number;
  mixedLots: boolean;
};

/** A slab's lock: the hold it's on (presentCart / POST /slabs/status). */
export type SlabLock = { holdId?: Id; holdNumber: number; by?: string; expiresOn?: string; branch?: string };

/** One slab as the cart has it (slabSnapshot in src/holds/holdRules.js). */
export type SlabSnapshot = {
  slabKey?: string;
  serial?: string;
  barcode?: string;
  product?: string;
  category?: string;
  bundle?: string;
  slabNumber?: string;
  block?: string;
  bin?: string;
  dimensions?: string;
  sfHundredths?: number;
  [key: string]: unknown;
};

/** One cart line (presentCart). `slab` is null once it's no longer in stock. */
export type CartLine = {
  slabKey: string;
  note?: string;
  addedAt?: string;
  slab: SlabSnapshot | null;
  inStock: boolean;
  lock: SlabLock | null;
  othersInCart: string[];
};

export type CartCustomer = { id: Id; name: string };

export type Cart = { customer: CartCustomer | null; updatedAt?: string | null; lines: CartLine[] };

/** A refused slab and why (POST /cart/slabs, /cart/scan). */
export type Skipped = { slabKey: string; reason: string };

/** POST /cart/slabs. */
export type AddResult = { added: string[]; skipped: Skipped[]; cart: Cart };

/** POST /cart/scan: the add result plus the slab scanned. */
export type ScanResult = AddResult & { slab?: SlabSnapshot | null };

export type CartToastState = {
  kind: 'added' | 'removed' | 'held' | 'error';
  text: string;
  undo?: string[] | null;
  holdId?: Id;
};

export type CartView = 'cart' | 'checkout';

export type CartState = {
  cart: Cart;
  loaded: boolean;
  loading: boolean;
  error: string;
  open: boolean;
  expanded: boolean;
  view: CartView;
  toast: CartToastState | null;
  reservationsTick: number;
  changedKeys: string[];
  pendingAdd: Set<string>;
  pendingRemove: Set<string>;
};
