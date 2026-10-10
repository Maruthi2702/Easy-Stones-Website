/**
 * The Delivery Schedule tells Accounting which deliveries just changed, so a
 * completed 3rd-party delivery gets its freight charge within moments.
 *
 * Deliberately one-way and fire-and-forget: the schedule never waits on
 * Accounting and an Accounting failure never fails a delivery save. Anything
 * missed here (a crash, a write path that doesn't call this) is caught by the
 * regular reconcile run (src/accounting/sync.js).
 */
let handler = null;

/** server.js registers the sync once it's ready. */
export const setDeliveriesChangedHandler = (fn) => { handler = typeof fn === 'function' ? fn : null; };

/** Call after any delivery write with the delivery `id`s (not _id) it touched. */
export function deliveriesChanged(ids) {
  if (!handler) return;
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String))];
  if (!list.length) return;
  Promise.resolve()
    .then(() => handler(list))
    .catch((err) => console.error('[accounting] freight sync after delivery change failed:', err));
}
