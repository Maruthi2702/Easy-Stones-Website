/**
 * What kind of ticket this is, and — the part that keeps biting — where that
 * makes it live.
 *
 * The board, the Pending list, and Cancelled Orders are complements: every
 * ticket has to appear in exactly one of the three. That rule is enforced in
 * separate places (the server's week query, its ?pending=true and
 * ?cancelled=true queries, and the client's cache merge), written in two
 * different languages, and when they disagree a ticket simply vanishes — it
 * saves fine, broadcasts fine, and is never seen again. That has now happened
 * twice: a weekend delivery dropped by a hard-coded five-day week, and a will
 * call with no date that matched neither query. This module is the single JS
 * definition the client side uses, so at least the client cannot drift from
 * itself, and the server's queries carry comments pointing back here.
 *
 * Cancelled takes priority over everything else below: a cancelled ticket
 * keeps whatever truckId/date/deliveryType it had (so cancelling is
 * reversible — dragging it onto a truck cell or Pending restores it, see
 * PATCH /deliveries/:id/assignment in src/routes/deliveries.js), but it is
 * never on the board or in Pending while status stays 'cancelled'.
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
 *              is exactly what a customer-returned slab is). Which of the two
 *              it is has to be said explicitly (the `customerDropOff` flag) —
 *              see isCounterReturn below for why.
 *
 * A driverless return waits in Pending, same as a driverless jobsite, until
 * either a driver is picked or `customerDropOff` is set. It used to be
 * inferred from whether a date was set instead: any driverless return with a
 * date was assumed to be a customer drop-off, which silently moved a return
 * someone had merely scheduled — driver still undecided — into the Will Call
 * column the moment a date was entered, including when dragging a ticket
 * back onto the Pending list (clearing truckId but leaving its date behind).
 * `customerDropOff` makes that call explicit instead of guessing from a field
 * that means something else.
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
 *
 * Requires the explicit `customerDropOff` flag, not just "no driver and a
 * date" — a return can just as well be sitting in Pending with a date filled
 * in while nobody has decided who's collecting it yet.
 */
export const isCounterReturn = (delivery) =>
  isReturn(delivery) && !delivery?.truckId && Boolean(delivery?.date) && Boolean(delivery?.customerDropOff);

/**
 * Cancelled, and waiting on someone to drag it back onto a truck or Pending
 * before it becomes either one again. See PATCH /deliveries/:id/assignment
 * for how that restore clears this back to a fresh pending/scheduled status.
 */
export const isCancelledDelivery = (delivery) => delivery?.status === 'cancelled';

/**
 * Waiting on a driver, with no place on the board yet.
 *
 * Must stay the exact complement of the server's week query — see the
 * ?pending=true branch in GET /api/deliveries. A cancelled ticket is never
 * pending even with no truckId — it belongs to Cancelled Orders instead.
 */
export const isPendingDelivery = (delivery) =>
  !delivery || (
    !isCancelledDelivery(delivery) &&
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
 *
 * A cancelled ticket has no column at all, even if truckId still names one —
 * that field is kept only as a record of what to restore it to.
 */
export const columnIdFor = (delivery) => {
  if (isCancelledDelivery(delivery)) return '';
  if (isWillCall(delivery) || isCounterReturn(delivery)) return WILL_CALL_COLUMN_ID;
  return delivery?.truckId || '';
};

/**
 * Whether `viewerLocations` (a user's assignedLocations, or ['*'] for admin)
 * relates to a transfer as its origin — the branch that shipped it, as
 * opposed to the branch it's due to arrive at.
 */
export const isTransferOrigin = (delivery, viewerLocations = []) =>
  viewerLocations.includes('*') || !delivery?.location || viewerLocations.includes(delivery.location);

/**
 * A transfer's stored `date` is its ship date — right for the origin branch,
 * meaningless to a branch that only relates to it as the destination (see
 * "Placement by type" above: the destination sees it on its arrival date).
 *
 * GET /api/deliveries (src/routes/deliveries.js) already reshapes its list
 * response this way, but two live-update paths bypass that route entirely —
 * a session's own optimistic merge of its save response, and every open
 * board's socket handler reacting to a `delivery_update` broadcast (see
 * upsertDeliveryIntoCache in src/api/deliverySchedule.js). Both have to
 * apply this same rule themselves, or a transfer edited by the origin sits
 * under its old date on the destination's board until a full reload
 * re-fetches the already-shaped list.
 */
export const applyTransferPerspective = (delivery, viewerLocations = []) => {
  if (delivery?.deliveryType !== 'transfer') return delivery;
  if (isTransferOrigin(delivery, viewerLocations)) return delivery;
  return delivery.expectedArrivalDate ? showOnArrivalDay(delivery, 'destination') : delivery;
};

/**
 * A transfer redrawn on its arrival day instead of its ship date. `shipDate`
 * keeps the real one, because once `date` is overwritten nothing else on the
 * card can say the ticket left earlier — and the sender's Daily Work Report
 * counts it on that earlier day, so a card with no hint of it reads as a
 * transfer the report forgot. `viewedAs` is which side of the transfer the
 * viewer is on, which changes how that note is worded.
 */
export const showOnArrivalDay = (delivery, viewedAs) => ({
  ...delivery,
  date: delivery.expectedArrivalDate,
  isIncomingView: true,
  shipDate: delivery.date,
  viewedAs
});

/**
 * The expected arrival date a transfer should be stored with. The destination
 * branch only ever sees a transfer through this date — its board and its Daily
 * Work Report's inbound line both key off it — so a blank one left the ticket
 * invisible to the branch receiving it. Blank defaults to the ship date, and
 * an arrival earlier than the ship date follows it forward, since nothing
 * arrives before it leaves. A transfer with no ship date yet (still in
 * Pending) keeps whatever it has: there's nothing to default from.
 */
export const transferArrivalFor = ({ date, expectedArrivalDate } = {}) => {
  const arrival = expectedArrivalDate || '';
  if (!date) return arrival;
  return !arrival || arrival < date ? date : arrival;
};

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' → "Fri 9/25", read from its date parts so no timezone can move it. */
export const shortDayLabel = (dateStr) => {
  const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${SHORT_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
};

/**
 * The line a transfer card carries when it is drawn on a different day from
 * the one it shipped, or '' when it needs none. `today` is 'YYYY-MM-DD'.
 */
export const transferShipNote = (delivery, today = '') => {
  if (!delivery?.isIncomingView || !delivery.shipDate || delivery.shipDate === delivery.date) return '';
  const shipped = shortDayLabel(delivery.shipDate);
  if (delivery.viewedAs === 'destination') return `Incoming · shipped ${shipped}`;
  return `Shipped ${shipped} · arrives ${delivery.date === today ? 'today' : shortDayLabel(delivery.date)}`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * What a Pending Delivery card shows where a scheduled card shows "Stop #N":
 * the day the customer wants it, coloured by how soon a truck is needed, so
 * whoever books the trucks can see what's coming up. A pending order has no
 * route yet, so its stop number meant nothing.
 *
 * `date` is the ticket's stored 'YYYY-MM-DD' (optional on a pending order);
 * `today` is the same shape (formatForDateInput(new Date())). Worked from the
 * strings' own parts, never through Date parsing, which would read a bare date
 * as UTC midnight and show the day before for anyone west of Greenwich.
 *
 * Returns { text, tone }, weeks running Monday–Sunday:
 *   'overdue'   the date has passed and it still has no truck — earlier days
 *               of this week included
 *   'this-week' today through Sunday
 *   'next-week' the Monday–Sunday after that
 *   'later'     beyond next week
 *   'none'      no date entered yet
 * Without a `today` there's nothing to measure against, so a date is 'later'.
 */
const ymdToDayNumber = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
};

export const pendingDeliveryDateLabel = (date, today = '') => {
  const day = ymdToDayNumber(date);
  if (day === null) return { text: 'No date', tone: 'none' };
  const [, mo, d] = String(date).split('-').map(Number);
  const asDate = new Date(day * 86400000);
  // Compact on purpose: it shares the card's top line with the SO#, which has
  // to stay whole on a 260px card.
  const text = `${WEEKDAYS[asDate.getUTCDay()]} ${MONTHS[mo - 1]} ${d}`;

  const now = ymdToDayNumber(today);
  if (now === null) return { text, tone: 'later' };
  if (day === now) return { text: 'Today', tone: 'this-week' };
  if (day < now) return { text, tone: 'overdue' };
  const daysSinceMonday = (new Date(now * 86400000).getUTCDay() + 6) % 7;
  const sunday = now + (6 - daysSinceMonday);
  if (day <= sunday) return { text, tone: 'this-week' };
  if (day <= sunday + 7) return { text, tone: 'next-week' };
  return { text, tone: 'later' };
};

/**
 * Pending Delivery's order: by delivery date, soonest first — which puts
 * overdue orders at the top on its own — then orders with no date yet at the
 * end. Orders due the same day keep the one waiting longest (created first)
 * ahead. Returns a new array; the list it's given is left alone.
 */
export const sortPendingByDate = (deliveries = []) => {
  const dayOf = (d) => ymdToDayNumber(d?.date);
  const createdOf = (d) => {
    const t = new Date(d?.createdAt || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return [...deliveries].sort((a, b) => {
    const da = dayOf(a);
    const db = dayOf(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return createdOf(a) - createdOf(b);
  });
};
