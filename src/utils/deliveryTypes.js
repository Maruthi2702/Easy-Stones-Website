/**
 * What kind of ticket this is, and — the part that keeps biting — where that
 * makes it live.
 *
 * The board and the Pending list are complements: every ticket has to appear
 * in exactly one of them. That rule is enforced in three separate places (the
 * server's week query, the server's ?pending=true query, and the client's
 * cache merge), written in two different languages, and when they disagree a
 * ticket simply vanishes — it saves fine, broadcasts fine, and is never seen
 * again. That has now happened twice: a weekend delivery dropped by a
 * hard-coded five-day week, and a will call with no date that matched neither
 * query. This module is the single JS definition the client side uses, so at
 * least the client cannot drift from itself, and the server's two queries
 * carry comments pointing back here.
 *
 * Placement by type:
 *
 *   jobsite    driver's column on its date; Pending when it has no driver
 *   transfer   same, but the destination branch sees it on its arrival date
 *   will_call  the customer collects, so it never has a driver and never
 *              waits in Pending — it sits in the board's Will Call column
 *   return     material coming back to us, which happens two ways:
 *              a driver goes out and collects it (a normal stop in that
 *              driver's column), or the customer brings it back themselves
 *              (no driver, so it sits in the board's Will Call column — the
 *              column for orders that move without one of our drivers, which
 *              is exactly what a customer-returned slab is)
 *
 * A return with no date yet is the one case that waits in Pending, for the
 * same reason a jobsite does: there is no day to draw it on. Without that
 * carve-out it would match neither query and go invisible, which is exactly
 * the bug described above.
 */

export const DELIVERY_TYPES = ['jobsite', 'transfer', 'will_call', 'return'];

export const isWillCall = (delivery) => delivery?.deliveryType === 'will_call';

export const isReturn = (delivery) => delivery?.deliveryType === 'return';

/**
 * A return the customer brings back themselves: no driver of ours goes out
 * for it, but it still happens on a known day, so it belongs on the board
 * rather than in Pending. It keeps its own type rather than becoming a will
 * call — the material is still coming back in, which is what the red flag on
 * the card and the Returns line on the Daily Work Report are counting.
 */
export const isCounterReturn = (delivery) =>
  isReturn(delivery) && !delivery?.truckId && Boolean(delivery?.date);

/**
 * Waiting on a driver, with no place on the board yet.
 *
 * Must stay the exact complement of the server's week query — see the
 * ?pending=true branch in GET /api/deliveries.
 */
export const isPendingDelivery = (delivery) =>
  !delivery || (
    !delivery.truckId &&
    !isWillCall(delivery) &&
    !isCounterReturn(delivery)
  );

/**
 * What a ticket's status should say, given where it actually sits.
 *
 * "Pending" on this board means the same thing the Pending list does: nobody
 * is driving this yet. A ticket with a driver on it, or one sitting in a
 * column of its own with an agreed date, is scheduled — so the two are the
 * same question, and asking it twice is how they drifted apart. Every ticket
 * added from a truck column used to be written as Pending regardless of the
 * driver prefilled next to it.
 *
 * Never touches 'completed' or 'delayed': those are statements about what
 * happened on the day, not about whether a driver is assigned, and neither is
 * anybody's default.
 */
export const defaultStatusFor = (delivery) => {
  const status = delivery?.status;
  if (status === 'completed' || status === 'delayed') return status;
  return isPendingDelivery(delivery) ? 'pending' : 'scheduled';
};

// The one driverless column, pinned to the right of the real drivers so the
// board still reads left to right.
export const WILL_CALL_COLUMN_ID = '__will_call__';

/**
 * Which board column a ticket belongs in.
 *
 * A return collected by one of our drivers is an ordinary stop in that
 * driver's column, which is how nearly all of them arrive. The rare one the
 * customer brings back themselves shares the Will Call column rather than
 * getting a column of its own: both are orders that move without one of our
 * drivers, and a column that sits empty most weeks costs every reader of the
 * board more than it gives the few tickets in it.
 */
export const columnIdFor = (delivery) => {
  if (isWillCall(delivery) || isCounterReturn(delivery)) return WILL_CALL_COLUMN_ID;
  return delivery?.truckId || '';
};
