import type { CategoryFields } from '../../utils/cardReceipts';

/** A user as the shell hands it down. */
export type ReceiptsUser = { id?: string; _id?: string; displayName?: string; username?: string; role?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };

export type Category = { _id: string; name: string; label: string; order: number; active: boolean; fields: CategoryFields };
export type Card = { _id: string; userId: string; label: string; issuer: 'amex' | 'other'; lastDigits: string; active: boolean };
export type Person = { id: string; name: string; role: string; location: string; active: boolean };
export type Decision = { by: string; byName: string; at: string; comment: string };

/** An expense as /api/card-receipts sends it (src/routes/cardReceipts.ts's `expenseView`). */
export type Expense = {
  id: string; userId: string; holderName: string; cardId: string; cardLabel: string; location: string;
  date: string; merchant: string; cents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null;
  category: string; customerId: string; customerName: string; attendees: string[]; purpose: string; note: string; recurring: boolean;
  receiptUrl: string; lostReason: string; status: string; approval: Decision | null; sentBack: Decision | null;
  voided: { at: string; by: string; reason: string } | null;
  createdAt: string; updatedAt: string; history: { at: string; by: string; action: string; changes: string }[];
  mine: boolean; canDecide: boolean;
};

export type Me = { user: { id: string; name: string; location: string }; card: Card | null; categories: Category[]; approverRoles: string[]; today: string };
