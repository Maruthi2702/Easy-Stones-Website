/**
 * Postgres rows → the records as MongoDB held them (`_id`, the branch's name in `location`,
 * `date`, the approval and send-back decisions as objects, the history lines inside), so the route
 * and the screens never learn which database answered.
 */
import type { companyCards, receiptCategories, cardExpenses, cardExpenseHistory } from '../schema/cardsSuppliers.ts';
import type { Loose } from '../../types/records.ts';

export function cardDoc(c: typeof companyCards.$inferSelect): Loose {
  return {
    _id: c.id, userId: c.userId ?? '', label: c.label, issuer: c.issuer, lastDigits: c.lastDigits, active: c.active,
    updatedBy: c.updatedBy, createdAt: c.createdAt, updatedAt: c.updatedAt
  };
}

export function categoryDoc(c: typeof receiptCategories.$inferSelect): Loose {
  return {
    _id: c.id, name: c.name, label: c.label, order: c.order, active: c.active,
    fields: { customer: c.needsCustomer, attendees: c.needsAttendees, purpose: c.needsPurpose, recurring: c.needsRecurring },
    subcategories: c.subcategories,
    updatedBy: c.updatedBy, createdAt: c.createdAt, updatedAt: c.updatedAt
  };
}

export function expenseDoc(e: typeof cardExpenses.$inferSelect, locationName: string | null,
  history: (typeof cardExpenseHistory.$inferSelect)[]): Loose {
  return {
    _id: e.id,
    // Null only when the person or card was removed since; MongoDB kept the old id as text.
    userId: e.userId ?? '', holderName: e.holderName, cardId: e.cardId ?? '', cardLabel: e.cardLabel,
    location: locationName ?? '', date: e.day, month: e.month, merchant: e.merchant, cents: e.cents,
    subtotalCents: e.subtotalCents, taxCents: e.taxCents, tipCents: e.tipCents,
    category: e.category ?? '', subcategory: e.subcategory, customerId: e.customerId ?? '', customerName: e.customerName,
    attendees: e.attendees, purpose: e.purpose, note: e.note, recurring: e.recurring,
    receiptUrl: e.receiptUrl, lostReason: e.lostReason, status: e.status,
    approval: e.approvedById == null ? null
      : { by: e.approvedById, byName: e.approvedByName ?? '', at: e.approvedAt, comment: e.approvalComment ?? '' },
    sentBack: e.sentBackById == null ? null
      : { by: e.sentBackById, byName: e.sentBackByName ?? '', at: e.sentBackAt, comment: e.sentBackComment ?? '' },
    createdBy: e.createdBy, voidedAt: e.voidedAt, voidedBy: e.voidedBy, voidReason: e.voidReason,
    history: [...history].sort((a, b) => a.position - b.position)
      .map(h => ({ at: h.at, by: h.by, action: h.action, changes: h.changes })),
    createdAt: e.createdAt, updatedAt: e.updatedAt
  };
}
