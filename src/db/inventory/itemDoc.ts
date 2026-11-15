/**
 * A Postgres inventory row → the record as MongoDB held it (`_id`, plain numbers), so routes
 * and screens never learn which database answered. Quantities and money are exact numerics
 * in Postgres and come back as numbers, as MongoDB's were.
 */
import type { inventoryItems, inventorySalesRecords } from '../schema/inventory.ts';
import type { Loose } from '../../types/records.ts';

const ITEM_NUMBERS = ['instockQty', 'availableSlabs', 'availableQuantity', 'unitFobCost', 'unitLandedCost', 'purchaseCost', 'assetValue'] as const;
const SALE_NUMBERS = ['slabsSold', 'quantitySold', 'saleValue', 'cost', 'avgSellingPrice', 'avgCost', 'margin', 'marginPercent'] as const;

function docOf(row: Loose, numbers: readonly string[]): Loose {
  const { id, ...rest } = row;
  const out: Loose = { _id: id, ...rest };
  for (const k of numbers) out[k] = Number(out[k]);
  return out;
}

export const itemDoc = (r: typeof inventoryItems.$inferSelect): Loose => docOf(r, ITEM_NUMBERS);
export const salesDoc = (r: typeof inventorySalesRecords.$inferSelect): Loose => docOf(r, SALE_NUMBERS);
