import { isPendingDelivery, isCancelledDelivery, isTransferOrigin } from './deliveryTypes.js';

/**
 * "Find an order" on the Delivery Schedule — search by SO#/invoice # or
 * company name across every date, not just the week on screen. Shared by the
 * server route (GET /api/deliveries/search in src/routes/deliveries.js) and
 * the search box (src/components/sales/delivery/DeliveryOrderSearch.jsx), so
 * the two can't disagree about who may search, what matches, or what a
 * result says.
 *
 * Deliberately stricter than the board's scopeDeliveryQueryToLocations: the
 * board also shows tickets with no location at all, but search only ever
 * returns orders belonging to one of the user's own assignedLocations (or,
 * for a transfer, heading to one). Admins/directors hold '*' and see all.
 */

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 100;
export const SEARCH_RESULT_LIMIT = 25;
// How many matches the server pulls before sorting and trimming to the
// limit — enough that a big customer's undated Pending orders aren't cut off
// by its long delivery history.
export const SEARCH_SCAN_LIMIT = 200;

// Who may search: not drivers — anyone whose role has Delivery Schedule →
// Driver view (isDeliveryDriver in deliveryAccess.js), the same switch that
// gives them the driver screen. It used to go by the role being named
// "driver" or "logistics".

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The cleaned-up search text, plus the bare order number when it looks like
 * one: "SO#18356", "so 18356", "#18356" → "18356". Company names are matched
 * on the raw text, so "Solid Surface" isn't mangled into "lid Surface".
 */
export const normalizeSearchTerm = (raw) => {
  const text = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, SEARCH_MAX_CHARS);
  const m = text.match(/^(?:s\.?\s*o\.?)?\s*#?\s*(\d[\d-]*)$/i);
  return { text, orderNumber: m ? m[1] : '' };
};

/**
 * Mongo filter for a search, or null when there's nothing to run: the text is
 * too short, or the user has no locations assigned (so no orders are theirs).
 */
export const buildDeliverySearchFilter = (raw, assignedLocations = []) => {
  const { text, orderNumber } = normalizeSearchTerm(raw);
  if (text.length < SEARCH_MIN_CHARS) return null;

  const locations = (assignedLocations || []).filter(Boolean);
  if (locations.length === 0) return null;

  const anywhere = new RegExp(escapeRegex(text), 'i');
  const number = new RegExp(escapeRegex(orderNumber || text), 'i');
  const match = {
    $or: [
      { customerName: anywhere },
      { soNumber: number },
      { invoiceNumber: number }
    ]
  };
  if (locations.includes('*')) return match;

  return {
    $and: [
      match,
      {
        $or: [
          { location: { $in: locations } },
          { deliveryType: 'transfer', transferDestination: { $in: locations } }
        ]
      }
    ]
  };
};

/** Undated (Pending) orders first, then newest date first — upcoming before past. */
export const sortSearchResults = (list = []) => [...list].sort((a, b) => {
  const ad = a?.date || '';
  const bd = b?.date || '';
  if (!ad !== !bd) return ad ? 1 : -1;
  return bd.localeCompare(ad);
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' → "Tue, Sep 30, 2026", read from its parts so no timezone can shift it. */
export const longDateLabel = (dateStr) => {
  const [y, m, d] = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
};

const DONE_WORD = { will_call: 'Picked up', return: 'Returned', transfer: 'Transferred' };

/**
 * What a search result says and where clicking it should go.
 *
 *   status  — 'delivered' | 'scheduled' | 'overdue' | 'delayed' | 'pending' | 'cancelled'
 *   label   — the status in words ("Delivered", "Scheduled", …)
 *   when    — the date line ("Tue, Sep 30, 2026", "No date yet", "Ships … → arrives …")
 *   place   — 'board' | 'pending' | 'cancelled': which part of the screen holds it
 *   boardDate — the day it's drawn on for this viewer (arrival day for an
 *               incoming transfer), or '' when it isn't on the board
 *
 * `today` is 'YYYY-MM-DD'; `viewerLocations` is the user's assignedLocations.
 */
export const describeSearchResult = (d, { today = '', viewerLocations = [] } = {}) => {
  const isTransfer = d?.deliveryType === 'transfer';
  const place = isCancelledDelivery(d) ? 'cancelled' : (isPendingDelivery(d) ? 'pending' : 'board');
  const incoming = isTransfer && !isTransferOrigin(d, viewerLocations);
  const shownDate = (incoming && d.expectedArrivalDate) ? d.expectedArrivalDate : (d?.date || '');

  let when = shownDate ? longDateLabel(shownDate) : 'No date yet';
  if (isTransfer && d.date) {
    const arrival = d.expectedArrivalDate && d.expectedArrivalDate !== d.date
      ? ` → arrives ${longDateLabel(d.expectedArrivalDate)}` : '';
    when = `Ships ${longDateLabel(d.date)}${arrival}`;
  }

  let status;
  let label;
  if (place === 'cancelled') {
    status = 'cancelled'; label = 'Cancelled';
  } else if (d.status === 'completed') {
    status = 'delivered'; label = DONE_WORD[d.deliveryType] || 'Delivered';
  } else if (d.status === 'delayed') {
    status = 'delayed'; label = 'Delayed';
  } else if (place === 'pending') {
    status = 'pending';
    label = 'Pending';
    if (!d.date) when = 'No date yet · waiting on customer';
    else if (!isTransfer) when = `${longDateLabel(d.date)} · no driver yet`;
  } else if (today && shownDate && shownDate < today) {
    status = 'overdue'; label = 'Not marked delivered';
  } else {
    status = 'scheduled'; label = 'Scheduled';
  }

  return { status, label, when, place, boardDate: place === 'board' ? shownDate : '' };
};
