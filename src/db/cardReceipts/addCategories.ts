/**
 * One-off (owner, 2026-11-20): accounting's expense account list, added as receipt categories exactly as
 * they write it. A name already on the list (same label, any case, or same stored key) is skipped, so it
 * is safe to run twice. Each is added shown, asking for nothing extra, with no types; Admin → Receipt
 * Categories edits them afterwards. Postgres only; `preview` lists what would be added and writes nothing.
 */
import { asc } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { newId } from '../ids.ts';
import { receiptCategories } from '../schema/cardsSuppliers.ts';
import { categoryKey } from '../../utils/cardReceipts.ts';

export const ACCOUNTING_CATEGORIES: readonly string[] = [
  'Automobile Insurance', 'Card Interest Charges', 'Computer And Network and Software Expenses', 'Dues and Subscriptions', 'Electricity',
  'Equipment Rental', 'Equipments', 'Furniture', 'Gas Cars', 'Gas Forklifts', 'Gas Trucks', 'Rent-Others', 'Legal Services', 'Insurance',
  'Meals And Entertainment', 'Mis Expenses', 'Miscellaneous Freight', 'Mobile Phones Charges', 'Mobile Phones Cost', 'Ocean Freight',
  'Office Internet', 'Office Landline', 'Other Supplies and Materials', 'Permits and Fees', 'Postage and Stationery', 'Repairs And Maintenance',
  'Trash Service', 'Travel and Hotel Bills', 'Warehouse Consumables', 'Warehouse Expenses'
];

export async function addCategories(db: Db, labels: readonly string[], by: string, { preview }: { preview: boolean }) {
  return db.transaction(async tx => {
    const cats = await tx.select().from(receiptCategories).orderBy(asc(receiptCategories.order));
    const labelsUsed = new Set(cats.map(c => c.label.trim().toLowerCase()));
    const namesUsed = new Set(cats.map(c => c.name));
    let order = Math.max(-1, ...cats.map(c => c.order)) + 1;
    const added: string[] = [];
    const skipped: string[] = [];
    const now = new Date();
    for (const label of labels) {
      let name = categoryKey(label) || 'category';
      if (labelsUsed.has(label.trim().toLowerCase()) || namesUsed.has(name)) { skipped.push(label); continue; }
      labelsUsed.add(label.trim().toLowerCase());
      namesUsed.add(name);
      added.push(label);
      if (!preview) {
        await tx.insert(receiptCategories).values({ id: newId(), name, label, order: order++, active: true, subcategories: [], updatedBy: by, createdAt: now, updatedAt: now });
      }
    }
    return { added, skipped };
  });
}
