import type { CategoryFields, SubcategoryLike } from '../../utils/cardReceipts';

/** A user as the shell hands it down. */
export type ReceiptsUser = { id?: string; _id?: string; displayName?: string; username?: string; role?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };

/** A type under a category (Gas → Truck): `name` is what expenses store, one shown type is the default. */
export type Subcategory = SubcategoryLike & { name: string; label: string; active: boolean; isDefault: boolean; fields: CategoryFields };
export type Category = { _id: string; name: string; label: string; order: number; active: boolean; fields: CategoryFields; subcategories: Subcategory[] };
export type Card = { _id: string; userId: string; label: string; issuer: 'amex' | 'encore' | 'other'; lastDigits: string; active: boolean;
  /** The name Amex prints for this card, as kept on it ('' until typed). */ amexName?: string;
  /** The Card Member name on the uploaded Amex statements ('' until one has a charge on this card). */ statementName?: string;
  /** The branch kept on the card, for one with no holder yet ('' until set). */ location?: string };
export type Person = { id: string; name: string; role: string; location: string; active: boolean };
/** Which approval a decision gave (src/utils/receiptApproval.ts). */
export type ApproverAs = 'accounting' | 'admin' | 'manager';
export type Decision = { by: string; byName: string; at: string; comment: string; as?: ApproverAs | null };
/** A question Accounting / an Admin sent about the receipt; open while `answeredAt` is empty. */
export type Ask = { to: string; toName: string; by: string; byName: string; at: string; question: string; answer: string; answeredAt: string | null };
/** "Accounting ✓ Maria" · "Manager or Admin — waiting" (approvalChips). */
export type ApprovalChip = { key: 'accounting' | 'second'; label: string; by: string; done: boolean };
/** Why the receipt is in the viewer's Waiting for me. */
export type WaitingReason = 'asked' | 'accounting' | 'second';
/** What the viewer may do to it (the server works it out from receiptApproval.ts). */
export type ExpenseActions = {
  approve: 'accounting' | 'second' | null; sendBack: boolean; ask: boolean; withdrawAsk: boolean;
  answer: boolean; reopen: boolean; fillDetails: boolean;
};
/** Reminders sent about it: the automatic day-2 / day-3 ones, and the last one sent by hand. */
export type Reminders = { missing2At?: string | null; missing3At?: string | null; lastDay?: string | null; lastAt?: string | null; lastByName?: string | null };

/** An expense as /api/card-receipts sends it (src/routes/cardReceipts.ts's `expenseView`). */
export type Expense = {
  id: string; userId: string; holderName: string; cardId: string; cardLabel: string; location: string;
  /** The cardholder's role now. */ holderRole?: string;
  /** The bank of the card it's on ('amex' | 'encore' | 'other'). */ issuer: string;
  date: string; merchant: string; cents: number; subtotalCents: number | null; taxCents: number | null; tipCents: number | null;
  category: string; subcategory: string; customerId: string; customerName: string; attendees: string[]; purpose: string; note: string; recurring: boolean;
  receiptUrl: string; lostReason: string; status: string;
  /** The Accounting approval. */ approval: Decision | null;
  /** The second approval ($150 and up). */ secondApproval?: Decision | null;
  ask?: Ask | null;
  needsSecond?: boolean;
  chips?: ApprovalChip[];
  waitingReason?: WaitingReason | null;
  actions?: ExpenseActions;
  reminders?: Reminders;
  sentBack: Decision | null;
  voided: { at: string; by: string; reason: string } | null;
  createdAt: string; updatedAt: string; history: { at: string; by: string; action: string; changes: string }[];
  mine: boolean;
  /** actions.approve != null || actions.answer. */ canDecide: boolean;
};

export type Me = { user: { id: string; name: string; location: string }; card: Card | null; categories: Category[]; role?: string; today: string };

/** Someone a question may go to (GET /expenses/:id/ask-targets). */
export type AskTarget = { id: string; name: string; role: string; branch: string };

/** Send reminder… (POST /expenses/remind). */
export type RemindGroups = { holder: boolean; managers: boolean; accounting: boolean; admins: boolean; approvers: boolean };
export type RemindBody = { ids: string[]; to: RemindGroups; email: boolean; push: boolean; message?: string };
export type RemindResult = {
  sent: { people: number; receipts: number };
  skipped: { id: string; merchant: string; reason: string }[];
  noPhone: string[]; noEmail: string[];
};
