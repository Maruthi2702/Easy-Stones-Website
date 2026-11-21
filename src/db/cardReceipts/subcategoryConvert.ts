/**
 * One-off (owner, 2026-11-20): move the old flat categories onto Gas and Food with sub-categories.
 *
 *   Fuel           → Gas  · Car       (Gas: Car default, Truck, Van, Forklift)
 *   Travel Lunch   → Food · Travel Lunch   (Food: Travel Lunch default, Customer Lunch [customer], Office Team Lunch)
 *   Customer Lunch → Food · Customer Lunch
 *
 * Gas and Food are created if they aren't there (a category the Admin screen already made is reused, and only
 * missing types are added). Each expense under an old category gets its new category and type and one history
 * line saying so; statuses, approvals and everything else stay. The old categories are then hidden, never deleted.
 * Run twice it finds nothing left to do. Postgres only (DATABASE_URL); `preview` counts and writes nothing.
 * Fuel → Car is a guess: nothing on an old expense says whether it was a car, truck, van or forklift.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { newId } from '../ids.ts';
import { receiptCategories, cardExpenses, cardExpenseHistory } from '../schema/cardsSuppliers.ts';
import { categoryKey, NO_FIELDS, type CategoryFields } from '../../utils/cardReceipts.ts';

type Sub = { label: string; fields?: Partial<CategoryFields> };
export const TARGETS: readonly { name: string; label: string; subs: readonly Sub[] }[] = [
  { name: 'gas', label: 'Gas', subs: [{ label: 'Car' }, { label: 'Truck' }, { label: 'Van' }, { label: 'Forklift' }] },
  { name: 'food', label: 'Food', subs: [{ label: 'Travel Lunch' }, { label: 'Customer Lunch', fields: { customer: true } }, { label: 'Office Team Lunch' }] }
];
export const MOVES: readonly { from: string; to: string; sub: string }[] = [
  { from: 'fuel', to: 'gas', sub: 'car' },
  { from: 'travel_lunch', to: 'food', sub: 'travel_lunch' },
  { from: 'customer_lunch', to: 'food', sub: 'customer_lunch' }
];

type Stored = { name: string; label: string; active: boolean; isDefault: boolean; fields: CategoryFields };
const storedOf = (v: unknown): Stored[] => (Array.isArray(v) ? v : []) as Stored[];

export type ConvertReport = {
  created: string[];
  addedTypes: string[];
  moves: { from: string; to: string; sub: string; expenses: number; byStatus: Record<string, number>; cents: number }[];
  hidden: string[];
  notFound: string[];
};

export async function convertToSubcategories(db: Db, by: string, { preview }: { preview: boolean }): Promise<ConvertReport> {
  return db.transaction(async tx => {
    const report: ConvertReport = { created: [], addedTypes: [], moves: [], hidden: [], notFound: [] };
    const cats = await tx.select().from(receiptCategories).orderBy(asc(receiptCategories.order));
    const byName = new Map(cats.map(c => [c.name, c]));
    const now = new Date();
    let order = Math.max(-1, ...cats.map(c => c.order)) + 1;

    // 1. Gas and Food: created, or the missing types added. A category already labelled the same (Fuel renamed to
    //    "Gas" in Admin keeps its stored name `fuel`) is the one to use, never a second copy.
    const actual = new Map<string, string>();
    for (const target of TARGETS) {
      const existing = byName.get(target.name) ?? cats.find(c => c.label.trim().toLowerCase() === target.label.toLowerCase());
      actual.set(target.name, existing?.name ?? target.name);
      const subs = storedOf(existing?.subcategories);
      const before = subs.length;
      for (const s of target.subs) {
        const name = categoryKey(s.label);
        if (subs.some(x => x.name === name)) continue;
        subs.push({ name, label: s.label, active: true, isDefault: subs.length === 0, fields: { ...NO_FIELDS, ...(s.fields || {}) } });
        if (existing) report.addedTypes.push(`${target.label} · ${s.label}`);
      }
      if (!existing) {
        report.created.push(target.label);
        if (!preview) {
          await tx.insert(receiptCategories).values({
            id: newId(), name: target.name, label: target.label, order: order++, active: true, subcategories: subs, updatedBy: by, createdAt: now, updatedAt: now
          });
        }
      } else if (subs.length !== before && !preview) {
        await tx.update(receiptCategories).set({ subcategories: subs, updatedBy: by, updatedAt: now }).where(eq(receiptCategories.id, existing.id));
      }
    }

    // 2. Move the old categories' expenses, with a history line each.
    const moved = new Set<string>();
    for (const m of MOVES) {
      const from = byName.get(m.from);
      if (!from) { report.notFound.push(m.from); continue; }
      const to = TARGETS.find(t => t.name === m.to)!;
      const toName = actual.get(m.to)!;
      // The old category IS the new one (Fuel already labelled Gas): its expenses only get the type, and it stays shown.
      const sameCategory = m.from === toName;
      const subLabel = to.subs.find(s => categoryKey(s.label) === m.sub)!.label;
      const rows = await tx.select({ id: cardExpenses.id, status: cardExpenses.status, cents: cardExpenses.cents }).from(cardExpenses)
        .where(sameCategory ? and(eq(cardExpenses.category, m.from), eq(cardExpenses.subcategory, '')) : eq(cardExpenses.category, m.from)).for('update');
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      report.moves.push({
        from: from.label, to: sameCategory ? `${from.label} · ${subLabel} (type only)` : `${to.label} · ${subLabel}`, sub: m.sub,
        expenses: rows.length, byStatus, cents: rows.reduce((t, r) => t + r.cents, 0)
      });
      if (from.active && !sameCategory) moved.add(m.from);
      if (preview || !rows.length) continue;
      const ids = rows.map(r => r.id);
      const counts = await tx.select({ id: cardExpenseHistory.expenseId, n: sql<number>`count(*)::int` }).from(cardExpenseHistory)
        .where(inArray(cardExpenseHistory.expenseId, ids)).groupBy(cardExpenseHistory.expenseId);
      const next = new Map(counts.map(c => [c.id, c.n]));
      await tx.update(cardExpenses).set({ category: toName, subcategory: m.sub, updatedAt: now }).where(inArray(cardExpenses.id, ids));
      await tx.insert(cardExpenseHistory).values(ids.map(expenseId => ({
        expenseId, position: next.get(expenseId) ?? 0, at: now, by, action: 'edited',
        changes: sameCategory ? `type set to ${subLabel} (sub-categories set up)` : `category ${from.label} → ${to.label} · ${subLabel} (sub-categories set up)`
      })));
    }

    // 3. Hide what was moved from (never delete): it can't start a new receipt but stays on nothing.
    for (const name of moved) {
      report.hidden.push(byName.get(name)!.label);
      if (!preview) await tx.update(receiptCategories).set({ active: false, updatedBy: by, updatedAt: now }).where(eq(receiptCategories.name, name));
    }
    return report;
  });
}
