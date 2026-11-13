/**
 * Postgres payment rows → the payment as MongoDB held it (`_id`, the branch's name in
 * `location`, `date`, the history lines inside it), so the route and screen never learn
 * which database answered.
 */
import type { paymentsReceived, paymentHistory } from '../schema/operations.ts';
import type { Loose } from '../../types/records.ts';

export function paymentDoc(p: typeof paymentsReceived.$inferSelect, locationName: string | null,
  history: (typeof paymentHistory.$inferSelect)[]): Loose {
  return {
    _id: p.id,
    location: locationName ?? '',
    date: p.day,
    // Null only when the customer was deleted since; MongoDB kept the old id as text.
    customerId: p.customerId ?? '',
    customerName: p.customerName,
    method: p.method,
    cents: p.cents,
    invoice: p.invoice,
    reference: p.reference,
    note: p.note,
    enteredBy: p.enteredBy,
    updatedBy: p.updatedBy,
    voidedAt: p.voidedAt,
    voidedBy: p.voidedBy,
    voidReason: p.voidReason,
    history: [...history].sort((a, b) => a.position - b.position)
      .map(h => ({ at: h.at, by: h.by, action: h.action, ...(h.changes ? { changes: h.changes } : {}) })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  };
}
