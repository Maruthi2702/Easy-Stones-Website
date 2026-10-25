import { lotGroups } from '../../../holds/holdRules';
import type { CartLine, LotGroup as Groups, SlabLock } from '../types';

/*
 * The cart's lines as the drawer and the checkout read them (moved out of
 * CartDrawer, 2026-10-24): flattened, grouped by product and bundle, and
 * which of them can go on a hold.
 */

/** A cart line as the drawer shows it: the slab's fields, flattened. */
export type ShownLine = {
  slabKey: string;
  product: string;
  note?: string;
  othersInCart: string[];
  lock: SlabLock | null;
  inStock: boolean;
  sfHundredths: number;
  serial?: string;
  barcode?: string;
  bundle?: string;
  slabNumber?: string;
  block?: string;
  bin?: string;
  dimensions?: string;
  [key: string]: unknown;
};

export type LotGroup = Groups<ShownLine>;
export const groupsOf = (lines: ShownLine[]): LotGroup[] => lotGroups(lines) as LotGroup[];

/** A customer in the pickers (useCustomerOptions). */
export type CustomerChoice = { value: string; label: string; description?: string; keywords?: string };

/** Cart lines → the shape lotGroups and holdTotals read. */
export const asLines = (cartLines: CartLine[]): ShownLine[] => cartLines.map((l) => ({
  ...(l.slab || {}),
  slabKey: l.slabKey,
  product: l.slab?.product || 'No longer in stock',
  note: l.note,
  othersInCart: l.othersInCart,
  lock: l.lock,
  inStock: l.inStock,
  sfHundredths: l.slab?.sfHundredths || 0
}));

export const usable = (line: ShownLine): boolean => line.inStock && !line.lock;
