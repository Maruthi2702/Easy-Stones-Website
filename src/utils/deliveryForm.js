/**
 * The Delivery form's rules (src/components/sales/delivery/DeliveryForm.jsx),
 * kept here, free of React and the network, so they can be tested.
 *
 * The form's values use the same names the old DeliveryModal kept in state
 * (soNumber, numberOfSlabs, customerName, selectedCustomerId, …), so a draft
 * saved when a session expired, and planPackingListAutofill in
 * packingListPdf.js, read and write them unchanged.
 *
 * Approved design: the "Add & Edit Delivery" canvas
 * (claude.ai/artifact/MUFMQHSj2xPKo3o9JeXjXC), owner's field order of
 * 2026-10-05: Date | Delivery type, Customer | Sales rep, SO | No. of slabs,
 * Driver | Status, Stop | Delivery address, then a 3rd-party truck's Carrier
 * name | BOL # | Agreed price (optional), then Packing list and Notes.
 */
import { formatForDateInput } from './dateUtils.js';
import { defaultStatusFor, transferArrivalFor } from './deliveryTypes.js';
import { isThirdPartyTruck } from './deliveryPickup.js';
import { formatAmount, parseAmount } from './money.js';

export const DELIVERY_TYPE_OPTIONS = [
  { value: 'jobsite', label: 'Delivery' },
  { value: 'transfer', label: 'Inter-branch transfer' },
  { value: 'will_call', label: 'Will call pickup' },
  { value: 'return', label: 'Return pickup' }
];

// Picking Cancelled here is the same as dragging the ticket onto Cancelled
// Orders on the board: driver and date are left as they are so it can be
// restored later.
export const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'delayed', label: 'Delayed / running late' },
  { value: 'completed', label: 'Completed / delivered' },
  { value: 'cancelled', label: 'Cancelled' }
];

// "Pending" and "Customer drop-off" both mean no truck, so the Driver picker
// needs a stand-in value to tell which one is chosen.
export const CUSTOMER_DROPOFF_VALUE = '__customer_dropoff__';

const NOUN = { jobsite: 'delivery', transfer: 'transfer', will_call: 'will call', return: 'return' };
export const nounFor = (type) => NOUN[type] || 'delivery';

const isTransfer = (v) => v.deliveryType === 'transfer';
const isWillCall = (v) => v.deliveryType === 'will_call';
const isReturnType = (v) => v.deliveryType === 'return';
const trim = (s) => String(s ?? '').trim();

/**
 * No driver yet, so it waits in the Pending list and needs no date. A will
 * call never has a driver but has a pickup date, and so does a return the
 * customer is bringing back themselves.
 */
export const isPendingOrder = (v) =>
  !v.truckId && !isWillCall(v) && !(isReturnType(v) && v.customerDropOff);

export const dateLabelFor = (v) => {
  if (isTransfer(v)) return 'Ship date';
  if (isWillCall(v)) return 'Pickup date';
  if (isReturnType(v)) return v.customerDropOff && !v.truckId ? 'Drop-off date' : 'Pickup date';
  return 'Delivery date';
};

/** The selected driver is contract freight (any of the 3rd-party columns). */
export const isThirdPartyPick = (v, trucks = []) =>
  !isWillCall(v) && isThirdPartyTruck(trucks.find((t) => t.id === v.truckId));

/** A 3rd-party truck asks for its paperwork: carrier, BOL and the agreed price (optional). */
export const needsFreightDetails = (v, trucks = []) => isThirdPartyPick(v, trucks);

// Order matches the form, top to bottom, so the error banner reads the same way.
const ERROR_ORDER = ['date', 'customer', 'transferOrigin', 'transferDestination', 'expectedArrivalDate'];

export const fieldLabelsFor = (v) => ({
  date: dateLabelFor(v),
  customer: 'Customer',
  transferOrigin: 'From',
  transferDestination: 'To',
  expectedArrivalDate: 'Expected arrival'
});

const today = () => formatForDateInput(new Date());

/**
 * What the form opens with. `delivery` is the saved ticket, or for a new one
 * the board's prefill (the driver column and day the + was in) with no id.
 */
export function deliveryToFormValues(delivery, { currentUser = null, customerOptions = [], todayStr = today() } = {}) {
  const d = delivery || {};
  const type = d.deliveryType || 'jobsite';
  const customerName = d.customerName || '';
  let customerId = d.customerId || '';
  if (!customerId && customerName) {
    const match = customerOptions.find((o) => o.label?.toLowerCase() === customerName.toLowerCase() || o.value === customerName);
    if (match) customerId = match.value;
  }
  // A transfer drawn on its arrival day (showOnArrivalDay — the receiving
  // branch's board, or the arrival week) carries the arrival date in `date`
  // and the real one in `shipDate`. Opening it with `date` made the arrival
  // the "Ship date", and any save wrote it back, moving the shipment and the
  // sender's Daily Report count.
  const storedDate = d.isIncomingView && d.shipDate !== undefined ? d.shipDate : d.date;
  const date = formatForDateInput(storedDate) || todayStr;
  return {
    deliveryType: type,
    date,
    time: d.time || '09:00 AM',
    truckId: d.truckId || '',
    customerDropOff: Boolean(d.customerDropOff),
    routeNumber: String(Number(d.routeNumber) || 1),
    numberOfSlabs: d.numberOfSlabs === null || d.numberOfSlabs === undefined ? '0' : String(d.numberOfSlabs),
    // Shown exactly as stored: re-deriving it here would quietly turn a
    // ticket someone left as Pending into Scheduled on the next save.
    status: d.status || 'pending',
    customerName,
    selectedCustomerId: customerId || customerName,
    salesRepName: d.salesRepName || currentUser?.name || 'Admin',
    soNumber: d.soNumber || d.invoiceNumber || '',
    address: d.address || '',
    pickupInfo: d.pickupInfo || '',
    transferOrigin: d.location || currentUser?.location || '',
    transferDestination: d.transferDestination || '',
    // An older transfer saved before arrival was required opens with the ship
    // date, the same default a save would apply.
    expectedArrivalDate: formatForDateInput(d.expectedArrivalDate || (type === 'transfer' ? date : '')),
    carrierName: d.carrierName || '',
    proNumber: d.proNumber || '',
    // Blank rather than "0.00": the model defaults freightFee to 0, and a
    // filled-in zero would claim someone agreed a price of nothing.
    freightFee: d.freightFee ? formatAmount(d.freightFee) : '',
    packingListUrl: d.packingListUrl || '',
    packingListFilename: d.packingListFilename || '',
    notes: d.notes || ''
  };
}

/** Errors keyed by field, in form order. Empty object = OK to save. */
// Carrier name, BOL # and Agreed price are optional (owner's call,
// 2026-10-05), so a 3rd-party truck adds no checks.
export function validateDeliveryValues(v) {
  const e = {};
  if (!isPendingOrder(v) && !v.date) {
    e.date = isWillCall(v) || (isReturnType(v) && v.customerDropOff)
      ? 'Pick the date the customer is collecting it'
      : isTransfer(v) ? 'Pick the ship date, or set Driver to Pending' : 'Pick a date, or set Driver to Pending';
  }
  if (!isTransfer(v) && !trim(v.customerName) && !trim(v.selectedCustomerId)) e.customer = 'Pick a customer';
  if (isTransfer(v)) {
    if (!v.transferOrigin) e.transferOrigin = 'Pick the branch it’s coming from';
    if (!v.transferDestination) e.transferDestination = 'Pick the branch it’s going to';
    else if (v.transferOrigin && v.transferOrigin === v.transferDestination) e.transferDestination = 'Can’t be the same branch as From';
    // Required once it ships: the receiving branch only sees a transfer by
    // this date. A Pending one has no ship date to follow yet.
    if (v.date && !v.expectedArrivalDate) e.expectedArrivalDate = 'Pick the arrival date';
    else if (v.date && v.expectedArrivalDate < v.date) e.expectedArrivalDate = 'Can’t be before the ship date';
  }
  return Object.fromEntries(ERROR_ORDER.filter((k) => e[k]).map((k) => [k, e[k]]));
}

/** How many fields differ from where the form started. */
export function countDeliveryChanges(values, initial) {
  return Object.keys(values).filter((k) => String(values[k] ?? '') !== String(initial?.[k] ?? '')).length;
}

/** Tickets already on this truck that day, not counting this one or will calls. */
export function bookedOn(deliveries = [], truckId, date, exceptId) {
  return deliveries.filter((d) => d.truckId === truckId && d.date === date && d.id !== exceptId && d.deliveryType !== 'will_call').length;
}

/**
 * The Driver picker: our drivers first (with how full their truck is that
 * day — a full one can't be picked), contract freight after them, then for a
 * return "Customer drop-off", and "Pending" last — "who is taking this",
 * ending in "nobody yet". A deactivated driver is only listed on a ticket
 * that's already theirs.
 */
export function driverOptions(trucks = [], values, { deliveries = [], exceptId, max = 12 } = {}) {
  const ours = trucks
    .filter((t) => !t.inactive || t.id === values.truckId)
    .sort((a, b) => Number(isThirdPartyTruck(a)) - Number(isThirdPartyTruck(b)))
    .map((t) => {
      if (isThirdPartyTruck(t)) return { value: t.id, label: '3rd party · contract freight' };
      const booked = bookedOn(deliveries, t.id, values.date, exceptId);
      const full = booked >= max;
      return {
        value: t.id,
        label: `${t.driver || t.name}${t.inactive ? ' (former driver)' : ''}`,
        description: full ? `Full · ${booked} of ${max}` : `${booked} of ${max} booked`,
        disabled: full && t.id !== values.truckId ? true : undefined
      };
    });
  return [
    ...ours,
    ...(isReturnType(values) ? [{ value: CUSTOMER_DROPOFF_VALUE, label: 'Customer drop-off · no driver' }] : []),
    { value: '', label: 'Pending · no driver yet' }
  ];
}

/** What the Driver picker shows as chosen. */
export const driverPickerValue = (v) => (isReturnType(v) && !v.truckId && v.customerDropOff ? CUSTOMER_DROPOFF_VALUE : v.truckId);

/**
 * Picking a driver schedules the order; taking the driver off puts it back in
 * Pending. Unlike opening a ticket, this is a decision about it, and the new
 * status is on screen to be changed before anything is saved.
 */
export function applyDriverPick(v, picked, savedTicket = null) {
  const dropOff = picked === CUSTOMER_DROPOFF_VALUE;
  const truckId = dropOff ? '' : picked;
  const status = defaultStatusFor({ ...(savedTicket || {}), deliveryType: v.deliveryType, date: v.date, truckId, status: v.status, customerDropOff: dropOff });
  return { ...v, truckId, customerDropOff: dropOff, status };
}

/**
 * A transfer goes out on contract freight, so on a new ticket it replaces the
 * driver that came from the column the + was in (never an empty one: that's
 * how an order stays in Pending). Its arrival starts as the ship date.
 */
export function applyTypeChange(v, nextType, { isNew = false, thirdPartyTruckId = '' } = {}) {
  const out = { ...v, deliveryType: nextType };
  if (nextType === 'transfer' && isNew && thirdPartyTruckId && v.truckId) out.truckId = thirdPartyTruckId;
  if (nextType === 'transfer') out.expectedArrivalDate = transferArrivalFor({ date: v.date, expectedArrivalDate: v.expectedArrivalDate });
  if (nextType !== 'return') out.customerDropOff = false;
  return out;
}

/** A transfer's arrival follows the ship date forward, as the server does. */
export function applyDateChange(v, date) {
  return {
    ...v,
    date,
    expectedArrivalDate: isTransfer(v) ? transferArrivalFor({ date, expectedArrivalDate: v.expectedArrivalDate }) : v.expectedArrivalDate
  };
}

const pickedAddress = (option) => {
  const addr = option ? (option.city || option.fullAddress || option.address || '') : '';
  return addr === '[object Object]' ? '' : addr;
};

/**
 * Picking a customer brings the rep who owns the account, and their address —
 * but only into an empty Delivery address, or one the previously picked
 * customer filled in. A jobsite address someone typed, or the packing list's
 * Ship To, is kept: it used to be replaced by the customer's city.
 */
export function applyCustomerPick(v, option, previousOption = null) {
  if (!option) return v;
  const addr = pickedAddress(option);
  const current = trim(v.address);
  const replaceable = !current || (previousOption && current === trim(pickedAddress(previousOption)));
  return {
    ...v,
    customerName: option.label,
    selectedCustomerId: option.value,
    address: addr && replaceable ? addr : v.address,
    // An account with no owner yet leaves the rep alone: blanking it would be
    // worse than a stale guess.
    salesRepName: option.salesRepName || v.salesRepName
  };
}

/** A name typed in that isn't one of the customers. */
export const applyCustomName = (v, name, titleCase = (s) => s) => ({ ...v, customerName: titleCase(name), selectedCustomerId: titleCase(name) });

const newId = () => `del_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * What POST /api/deliveries gets. Fields a type doesn't use are cleared so
 * they can't linger: a will call has no address, stop or truck; a transfer
 * has no customer (its card names both branches instead).
 */
export function buildDeliveryPayload(v, { savedTicket = null, currentUser = null, customerOptions = [], trucks = [], makeId = newId, now = new Date() } = {}) {
  const transfer = isTransfer(v);
  const willCall = isWillCall(v);
  let customerName = trim(v.customerName);
  if (!customerName && v.selectedCustomerId) {
    const found = customerOptions.find((o) => o.value === v.selectedCustomerId);
    if (found) customerName = found.label;
  }
  // Both branches see this ticket, so its card names both ends.
  if (transfer) customerName = `Transfer: ${v.transferOrigin} → ${v.transferDestination}`;
  // A 3rd-party transfer keeps its carrier paperwork too; a transfer on one
  // of our own trucks has none.
  const keepFreight = needsFreightDetails(v, trucks) || !transfer;
  return {
    id: savedTicket?.id || makeId(),
    customerId: transfer ? null : (v.selectedCustomerId || null),
    customerName,
    address: transfer || willCall ? '' : trim(v.address),
    soNumber: trim(v.soNumber),
    invoiceNumber: trim(v.soNumber),
    routeNumber: transfer || willCall ? 1 : (Number(v.routeNumber) || 1),
    date: v.date,
    time: v.time,
    truckId: willCall ? '' : v.truckId,
    salesRepName: trim(v.salesRepName),
    status: v.status,
    notes: trim(v.notes),
    location: transfer ? v.transferOrigin : (savedTicket?.location || currentUser?.location || ''),
    deliveryType: v.deliveryType,
    // Only means something on a driverless return; cleared otherwise so it
    // can't later reroute a ticket to Will Call.
    customerDropOff: isReturnType(v) && !v.truckId ? Boolean(v.customerDropOff) : false,
    transferDestination: v.transferDestination,
    expectedArrivalDate: transfer ? v.expectedArrivalDate : '',
    pickupInfo: transfer ? '' : trim(v.pickupInfo),
    carrierName: keepFreight ? trim(v.carrierName) : '',
    proNumber: keepFreight ? trim(v.proNumber) : '',
    // parseAmount, not Number: the box holds "1,400.00", which Number reads as NaN.
    freightFee: keepFreight ? (parseAmount(v.freightFee) ?? 0) : 0,
    packingListUrl: v.packingListUrl,
    packingListFilename: v.packingListFilename,
    numberOfSlabs: v.numberOfSlabs === '' ? 0 : Number(v.numberOfSlabs),
    updatedAt: now.toISOString()
  };
}

/** Header title, main button and delete label for this kind of ticket. */
export function formWording(values, { isEdit = false, saved = values } = {}) {
  const noun = nounFor(values.deliveryType);
  const sub = isTransfer(saved)
    ? [saved.transferOrigin, saved.transferDestination].filter(Boolean).join(' → ')
    : trim(saved.customerName);
  return {
    title: isEdit ? `Edit ${noun}` : `Add a ${noun}`,
    titleSub: isEdit ? sub : '',
    submitLabel: isEdit ? 'Save changes' : `Add ${noun}`,
    deleteLabel: `Delete ${noun}`,
    discardTitle: isEdit ? 'Discard your changes?' : `Discard this ${noun}?`
  };
}

/** Footer note on an edit. Deliveries record when they changed, not who changed them. */
export function deliveryLastChangedText(delivery) {
  const at = delivery?.updatedAt ? new Date(delivery.updatedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return `Last changed ${at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

/** Keep the ticket's own rep in the list even if they've left the branch's list. */
export function repOptions(names = [], current = '') {
  return [...new Set([...names, current].filter(Boolean))].map((n) => ({ value: n, label: n }));
}

/**
 * Sales reps offered for the ticket: people on the user's branches (or
 * everyone, for an all-branch user) in a sales, manager, director or admin
 * role, plus "Admin".
 */
export function salesRepNamesFor(list = [], currentUser = null) {
  let users = Array.isArray(list) ? list : [];
  const userAssigned = currentUser?.assignedLocations || [];
  const filterLocs = userAssigned.length > 0 ? userAssigned : (currentUser?.location ? [currentUser.location] : []);
  if (filterLocs.length > 0 && !filterLocs.includes('*')) {
    users = users.filter((u) => {
      const uLocs = u.assignedLocations || (u.location ? [u.location] : []);
      return uLocs.includes('*') || uLocs.some((loc) => filterLocs.includes(loc));
    });
  }
  users = users.filter((u) => {
    const r = (u.role || '').toLowerCase();
    return !u.role || r.includes('sales') || r.includes('manager') || r.includes('director') || r.includes('admin');
  });
  return [...new Set(['Admin', ...users.map((u) => u.name || u.username).filter(Boolean)])];
}

/**
 * A customer from /api/customers/dropdown → a picker option, with the city and
 * street the form fills in. The one rule every customer dropdown uses now
 * (src/utils/customerOptions.js); kept under this name for the form's imports.
 */
export { customerOption as customerOptionFromRecord } from './customerOptions.js';

/**
 * Whether a ticket counts on a Daily Report at all, the way deriveFromSystem
 * reads them: not cancelled, and on a truck — except a will call or a return,
 * which never ride one.
 */
const countsOnReport = (v) =>
  v.status !== 'cancelled' && (Boolean(v.truckId) || isWillCall(v) || isReturnType(v));

/**
 * The branch Daily Report days this ticket is counted on: its own branch on
 * its date, and for a transfer the destination on its arrival date too.
 * `location` is the branch a non-transfer ticket is filed under.
 */
export function reportDaysFor(v, location) {
  if (!v || !countsOnReport(v)) return [];
  const days = [];
  const origin = isTransfer(v) ? v.transferOrigin : location;
  if (origin && v.date) days.push({ location: origin, date: v.date });
  if (isTransfer(v) && v.transferDestination && v.expectedArrivalDate) {
    days.push({ location: v.transferDestination, date: v.expectedArrivalDate });
  }
  return days;
}

/**
 * Every report day an edit can change: the ones the ticket was counted on
 * when it opened, and the ones it would be counted on now. One entry per
 * branch and date.
 */
export function reportDaysTouched(values, { initial = null, location = '' } = {}) {
  const all = [...(initial ? reportDaysFor(initial, location) : []), ...reportDaysFor(values, location)];
  const seen = new Set();
  return all.filter((d) => {
    const key = `${d.location}|${d.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "Seattle's Daily Report for Fri, Oct 2" — for the submitted-day warning. */
export const submittedDayLabel = ({ location, date }) => {
  const at = new Date(`${date}T12:00:00Z`);
  const day = Number.isNaN(at.getTime()) ? date : at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${location}'s Daily Report for ${day}`;
};

/**
 * A saved ticket (as the board holds it) in the shape reportDaysFor reads.
 * A transfer the board draws on its arrival day keeps its real ship date in
 * shipDate (showOnArrivalDay).
 */
export const ticketReportValues = (d = {}) => ({
  deliveryType: d.deliveryType || 'jobsite',
  status: d.status,
  truckId: d.truckId || '',
  customerDropOff: Boolean(d.customerDropOff),
  date: d.isIncomingView && d.shipDate !== undefined ? d.shipDate : d.date,
  transferOrigin: d.location || '',
  transferDestination: d.transferDestination || '',
  expectedArrivalDate: d.expectedArrivalDate || ''
});

/** The report days a board move touches: where the ticket was counted, and where it is now. */
export const reportDaysForMove = (before, after) =>
  reportDaysTouched(ticketReportValues(after), { initial: ticketReportValues(before), location: before?.location || after?.location || '' });
