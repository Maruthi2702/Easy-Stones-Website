import type { CategoryFields, SubcategoryLike } from '../../utils/cardReceipts';

/** A user as the shell hands it down. */
export type ReceiptsUser = { id?: string; _id?: string; displayName?: string; username?: string; role?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };

/** A type under a category (Gas → Truck): `name` is what expenses store, one shown type is the default. */
export type Subcategory = SubcategoryLike & { name: string; label: string; active: boolean; isDefault: boolean; fields: CategoryFields };
export type Category = { _id: string; name: string; label: string; order: number; active: boolean; fields: CategoryFields; subcategories: Subcategory[] };
export type Card = { _id: string; userId: string; label: string; issuer: 'amex' | 'other'; lastDigits: string; active: boolean;
  /** The Card Member name on Amex's report for this card ('' until a statement is uploaded). */ amexName?: string };
export type Person = { id: string; name: string; role: string; location: string; active: boolean };
export type Decision = { by: string; byName: string; at: string; comment: string };

/** An expense as /api/card-receipts sends it (src/routes/cardReceipts.ts's `expenseView`). */
export type Expense = {
  id: string; userId: string; holderName: string; cardId: string; cardLabel: string; location: string;
  date: string; merchant: string; cents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null;
  category: string; subcategory: string; customerId: string; customerName: string; attendees: string[]; purpose: string; note: string; recurring: boolean;
  receiptUrl: string; lostReason: string; status: string; approval: Decision | null; sentBack: Decision | null;
  voided: { at: string; by: string; reason: string } | null;
  createdAt: string; updatedAt: string; history: { at: string; by: string; action: string; changes: string }[];
  mine: boolean; canDecide: boolean;
  /** Next approval it needs: 1, 2 (Accounting, over $150 after step 1) or 0 (not waiting). */
  step: 0 | 1 | 2;
};

export type Me = { user: { id: string; name: string; location: string }; card: Card | null; categories: Category[]; approverRoles: string[]; today: string };
