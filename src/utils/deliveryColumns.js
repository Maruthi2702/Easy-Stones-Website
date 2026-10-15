/**
 * The left-to-right order of the delivery board's columns.
 *
 * Every branch can have its own order, set by an admin (Delivery Schedule →
 * Search & filters → Arrange columns) and stored on the Location as column ids
 * (`drv_<username>`, and WILL_CALL_COLUMN_ID for Will Call). A branch nobody
 * has arranged, and the All Locations board, use the default: our own drivers
 * A–Z, then contract (3rd-party) trucks, then Will Call. It used to be the
 * order the logins were created in, which put "3rd Party - Contract" first.
 *
 * Shared by the board (BoardGrid), the Arrange columns window and the server's
 * save route, so all three agree on what an order is.
 */
import { WILL_CALL_COLUMN_ID } from './deliveryTypes.js';
import { isThirdPartyTruck } from './deliveryPickup.js';

// A will call is collected by the customer, so it belongs to no driver and to
// no truck's daily load. It gets a column of its own rather than sitting under
// whoever happened to be selected when the ticket was made.
export const WILL_CALL_COLUMN = {
  id: WILL_CALL_COLUMN_ID,
  driver: 'Will Call',
  // Same as `driver` on purpose. The board's header renders `name` underneath
  // as a subtitle only when the two differ, which is how a truck shows its
  // driver — so matching them drops the second line here without the column
  // having to be special-cased in the markup. It used to read "Customer
  // Pickup", which said nothing "Will Call" doesn't already say, and now that
  // customer-returned slabs share this column it was not even true of
  // everything in it.
  name: 'Will Call',
  color: '#2dd4bf',
  isWillCall: true
};

// Enough for any branch's drivers; stops a bad request storing a huge list.
export const MAX_SAVED_COLUMNS = 100;

export const columnLabel = (col) => String(col?.driver || col?.name || col?.id || '');

// 0 our drivers, 1 contract trucks, 2 Will Call.
const rankOf = (col) => {
  if (col?.id === WILL_CALL_COLUMN_ID || col?.isWillCall) return 2;
  return isThirdPartyTruck(col) ? 1 : 0;
};

const byLabel = (a, b) => columnLabel(a).localeCompare(columnLabel(b), undefined, { sensitivity: 'base' });

/** Our drivers A–Z, then contract trucks A–Z, then Will Call. */
export const defaultColumnOrder = (columns = []) =>
  [...columns].sort((a, b) => rankOf(a) - rankOf(b) || byLabel(a, b));

/**
 * The columns in a branch's saved order. A column the saved order doesn't name
 * (a driver added since it was arranged) goes in by the default rule, just
 * ahead of the first saved column of a later group, so a new driver lands
 * before the contract trucks and Will Call rather than after them. Saved ids
 * with no column (a driver who left) are skipped.
 */
export const orderBoardColumns = (columns = [], savedOrder = null) => {
  const byDefault = defaultColumnOrder(columns);
  if (!Array.isArray(savedOrder) || savedOrder.length === 0) return byDefault;

  const position = new Map(savedOrder.map((id, i) => [id, i]));
  const ordered = byDefault
    .filter((c) => position.has(c.id))
    .sort((a, b) => position.get(a.id) - position.get(b.id));

  byDefault.filter((c) => !position.has(c.id)).forEach((col) => {
    const at = ordered.findIndex((c) => rankOf(c) > rankOf(col));
    if (at === -1) ordered.push(col);
    else ordered.splice(at, 0, col);
  });
  return ordered;
};

/** True when `ids` is just the default order for these columns (nothing to save). */
export const isDefaultOrder = (columns = [], ids = []) => {
  const def = defaultColumnOrder(columns).map((c) => c.id);
  return def.length === ids.length && def.every((id, i) => id === ids[i]);
};

/**
 * What the server stores from a request body: unique, non-empty id strings,
 * at most MAX_SAVED_COLUMNS. Anything else → null (a 400). An empty list is
 * valid and means "back to the default order".
 */
export const cleanColumnOrder = (value) => {
  if (!Array.isArray(value) || value.length > MAX_SAVED_COLUMNS) return null;
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string') return null;
    const trimmed = id.trim();
    if (!trimmed || trimmed.length > 200 || seen.has(trimmed)) return null;
    seen.add(trimmed);
  }
  return [...seen];
};

/** Move the item at `from` to `to` (both indexes into `list`); a new array. */
export const moveItem = (list, from, to) => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
